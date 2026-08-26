import { authFetch } from '../services/authFetch';

/**
 * Tarih bazlı kur arşivi — "fatura tarihine göre kur al" (kullanıcı kararı,
 * 2026-08-26).
 *
 * ## Neden
 *
 * Bir kalemin maliyeti $100 ise, o kalemin TL değeri BUGÜNKÜ kurla değil,
 * maliyetin dayandığı FATURA TARİHİNDEKİ kurla hesaplanmalı. Güncel kuru
 * kullanmak, geçmiş dönem stok değerini ve marjı kur hareketi kadar kaydırır.
 *
 * ## Neden önbellek şart
 *
 * Kur çözümü rapor render'ının İÇİNDE gerekiyor ve raporlar binlerce satır
 * basıyor. Satır başına ağ isteği kabul edilemez. Bu yüzden:
 *   1. Ekran, veride geçen FARKLI tarihleri toplar (genelde birkaç düzine).
 *   2. `kurlariYukle()` eksik olanları TEK SEFERDE çeker (paralel, sınırlı).
 *   3. Render sırasında `kurAl()` SENKRON olarak önbellekten okur.
 *
 * ## Bulunamazsa
 *
 * `kurAl` **null** döner — uydurma kur YOK (bkz. hafıza: kur-yoksa-uydurma).
 * Çağıran bunu '—' olarak gösterir ve kalemi toplama katmaz.
 *
 * Sunucu ucu: `GET /api/exchange-rates/at?date=YYYY-MM-DD` (server.ts).
 * TCMB tarihsel arşivinden çeker; hafta sonu/tatilde en yakın önceki iş
 * gününe kayar. `source: 'fallback'` dönerse o tarihin GERÇEK kuru
 * bulunamamıştır — güncel kur dönmüştür; bunu ayırt ediyoruz.
 */

export interface GunlukKur {
  /** Kur haritası, ör. { USD: 40.12, EUR: 44.03 }. */
  kurlar: Record<string, number>;
  /** `true` ise bu, İSTENEN tarihin kuru DEĞİL — güncel kura düşülmüş. */
  yedek: boolean;
}

/** tarih (YYYY-MM-DD) → kur. `null` = denendi, bulunamadı (tekrar denenmez). */
const onbellek = new Map<string, GunlukKur | null>();
/** Uçuşta olan istekler — aynı tarih iki kez istenmesin. */
const ucusta = new Map<string, Promise<void>>();

const GECERLI_TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Aynı anda kaç tarih çekilsin (sunucuyu ve TCMB'yi boğmamak için). */
const ES_ZAMANLI = 4;

async function tekTarihYukle(tarih: string): Promise<void> {
  try {
    const r = await authFetch(`/api/exchange-rates/at?date=${tarih}`);
    if (!r.ok) { onbellek.set(tarih, null); return; }
    const d = await r.json() as { success?: boolean; rates?: Record<string, number>; source?: string };
    const kurlar = d?.rates;
    if (!d?.success || !kurlar || typeof kurlar.USD !== 'number') { onbellek.set(tarih, null); return; }
    onbellek.set(tarih, { kurlar, yedek: d.source === 'fallback' });
  } catch {
    // Ağ hatası KALICI değil — önbelleğe yazma ki sonraki denemede tekrar sorulsun.
  } finally {
    ucusta.delete(tarih);
  }
}

/**
 * Verilen tarihlerin kurlarını (eksik olanları) yükler. Zaten önbellekte
 * olanlar ve uçuşta olanlar tekrar istenmez.
 */
export async function kurlariYukle(tarihler: Iterable<string>): Promise<void> {
  const eksik = [...new Set([...tarihler])]
    .filter(t => GECERLI_TARIH.test(t) && !onbellek.has(t) && !ucusta.has(t));
  if (!eksik.length) return;

  for (let i = 0; i < eksik.length; i += ES_ZAMANLI) {
    const grup = eksik.slice(i, i + ES_ZAMANLI);
    await Promise.all(grup.map(t => {
      const p = tekTarihYukle(t);
      ucusta.set(t, p);
      return p;
    }));
  }
}

/**
 * O tarihteki kur — SENKRON, önbellekten. Yoksa `null`.
 *
 * `null` dönmesi iki anlama gelebilir: henüz yüklenmedi ya da bulunamadı.
 * İkisinde de doğru davranış aynı: rakam BASMA, '—' göster.
 */
export function kurAl(tarih: string | undefined | null, birim: string): number | null {
  if (birim === 'TRY') return 1;
  if (!tarih || !GECERLI_TARIH.test(tarih)) return null;
  const g = onbellek.get(tarih);
  // YEDEK KUR O TARİHİN KURU DEĞİLDİR. Uç, TCMB tarihsel kaydını çekemezse
  // `source:'fallback'` ile GÜNCEL kuru döndürüyor. Onu istenen tarihin kuru
  // gibi kullanmak, "fatura tarihine göre kur al" kuralını sessizce bozar —
  // rakam çıkar ama yanlış dönemin kurudur. Bilmiyorsak bilmiyoruz.
  if (!g || g.yedek) return null;
  const k = g.kurlar?.[birim];
  return (typeof k === 'number' && isFinite(k) && k > 0) ? k : null;
}

/** O tarihin kuru GERÇEK tarihsel kur mu, yoksa güncel kura mı düşüldü? */
export function kurYedekMi(tarih: string | undefined | null): boolean {
  if (!tarih) return false;
  return onbellek.get(tarih)?.yedek === true;
}

/** Test/oturum sıfırlama için. */
export function kurArsiviTemizle(): void {
  onbellek.clear();
  ucusta.clear();
}

/** Testlerin ağ olmadan kur yerleştirebilmesi için. */
export function kurArsiviDoldur(tarih: string, kurlar: Record<string, number>, yedek = false): void {
  onbellek.set(tarih, { kurlar, yedek });
}
