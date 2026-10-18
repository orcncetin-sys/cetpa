/**
 * faturaBekletme.ts — faturadan sipariş türetmede Cetpa siparişleriyle BAĞ ve BEKLETME kararları (şartname «fatura gövde + gece
 * MF» § 8 H1 / H4 ve § 9.A A1–A7, § 9.B B3; 2026-10-19). SAF: veritabanı, ağ yok; «şimdi» çağırandan gelir.
 *
 * NEDEN (İnceleme 1, İ-1): G3a Cetpa'dan kesilmiş faturayı yalnız ETTN ile tanıyordu. Kaydet sonucu «belirsiz» / «gönderiliyor»
 * kalan (ya da `gonderildi` ama ETTN'si okunamamış) Cetpa siparişinin ETTN'si yok; o fatura gece aynaya düşünce aynı satış için
 * KALICI bir MF siparişi türüyordu (çift ciro, çift sevkiyat) — gece adımıyla bu artık elle değil her gece olurdu. Tahminle eşleme
 * YAPILMAZ: aynı müşterinin talep gününden sonraki yeni faturası, bağ çözülene kadar BEKLETİLİR (türetilmez, sayılır, nota düşer);
 * çözülünce («Mikro'da var» + ETTN, «ETTN ekle», «Mikro'da yok») sonraki koşuda türer ya da G3a ile bağlanır.
 *
 * İ-2: sıfır / biçimsiz ETTN Cetpa kümesine GİRMEZ (`cetpaEttnAnahtari`) — tek sıfır-ETTN'li sipariş `cha_uuid`'i sıfır olan TÜM
 * faturaları bastırırdı; böyle sipariş «ETTN'siz» sayılır, işaretliyse bekletmenin (b) dalına girer.
 */
import { MF_KAYNAGI } from '../../lib/mfKaynagi.js';
import { faturaIsareti, type MikroFaturaGonderimi } from '../../lib/faturaGonderimi.js';
import { cetpaEttnAnahtari } from '../../lib/ettn.js';
import { isGunu } from '../zamanla.js';

/** Cari karşılaştırma anahtarı (iki tarafta AYNI; § 9.A A5): kırp + Türkçe büyük harf. Metin / sayı dışı değer boş sayılır. */
export const cariAnahtari = (v: unknown): string =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().toLocaleUpperCase('tr-TR');

/** Gün biçimi (`YYYY-MM-DD`): fatura günü ve talep sınırı bu biçimde METİNLE karşılaştırılır (B3 yazma anı denetimi de bunu kullanır). */
export const GUN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * § 9.A A2 — işaretin TARİH SINIRI (`YYYY-MM-DD` metin; Date'e çevrilmez): (1) talepte gövdeye yazılan `faturaTarihi`
 * (`GG.AA.YYYY` — `faturaIsareti` biçimi sınamıştır); (2) yoksa `zaman`'ın İstanbul günü (gün kaydırması YOK; okunamayan `zaman`
 * `Number.isFinite` ile elenir — `isGunu(new Date(NaN))` fırlatırdı); (3) ikisi de yoksa `null` = SINIRSIZ.
 */
export function talepSiniri(isaret: Pick<MikroFaturaGonderimi, 'zaman' | 'faturaTarihi'>): string | null {
  if (isaret.faturaTarihi) {
    const [g, a, y] = isaret.faturaTarihi.split('.');
    return `${y}-${a}-${g}`;
  }
  const t = Date.parse(isaret.zaman);
  return Number.isFinite(t) ? isGunu(new Date(t)) : null;
}

/** Bekleten giriş: en erken sınır (`null` = sınırsız) ve bekleten Cetpa siparişlerinin adları (nota örnek). */
export interface BekletmeGirdisi { sinir: string | null; siparisler: string[] }

export interface CetpaBaglari {
  /** G3a — geçerli ETTN anahtarı → siparişin işaretindeki cari (varsa) ve adı. Yalnız `source !== 'mikro-fatura'`. */
  ettnler: Map<string, { cariKod?: string; siparis: string }>;
  /** «ETTN'siz Cetpa faturalı sipariş» notu (bugünkü ölçüt + H4): `hasInvoice: true` ve geçerli ETTN yok. */
  ettnsizFaturali: string[];
  /** H1 bekletme — carisi bilinen girişler (`cariAnahtari` → en erken sınır). `bekletme: false` iken boş. */
  cariler: Map<string, BekletmeGirdisi>;
  /** H1 bekletme — carisi bilinmeyen (işarette `cariKod` yok) girişlerin en erken sınırı; yoksa `null`. */
  carisiBilinmeyen: BekletmeGirdisi | null;
  /** § 9.A A7 — `gonderildi` + geçerli ETTN + sınır günü son 60 gün içinde olan siparişler (anahtar + ad). */
  yakinGonderilen: Array<{ ettn: string; siparis: string }>;
}

/** A7 penceresi (gün). */
export const ETTN_TUTMAYAN_PENCERE_GUN = 60;

const enErken = (eski: BekletmeGirdisi | undefined | null, sinir: string | null, siparis: string): BekletmeGirdisi => {
  if (!eski) return { sinir, siparisler: [siparis] };
  const yeni = eski.sinir === null || sinir === null ? null : (sinir < eski.sinir ? sinir : eski.sinir);
  return { sinir: yeni, siparisler: [...eski.siparisler, siparis] };
};

/**
 * Kiracının siparişlerinden bağ ve bekletme kümelerini kurar. Bekletme kümesi (§ 8 H1, § 9.A A3) — `source !== 'mikro-fatura'` ve
 * işaret (`faturaIsareti` ile okunur, ham alan değil; `hasInvoice` OKUNMAZ):
 *   (a) `durum` ∈ {`gonderiliyor`, `belirsiz`} (bayat `gonderiliyor` da);
 *   (b) `durum === 'gonderildi'` ve `cetpaEttnAnahtari(o.ettn) === ''` (ETTN yok / sıfır / biçimsiz).
 * İşaretsiz eski `hasInvoice: true` sipariş bekletmeye GİRMEZ (yalnız «ETTN'siz» notunda). `bekletme: false` (kalem modu) iken
 * bekletme kümeleri kurulmaz (§ 9.A A5).
 */
export function cetpaBaglariniKur(
  siparisler: readonly Readonly<Record<string, unknown>>[],
  siparisAdi: (o: Record<string, unknown>) => string,
  secenek: { bekletme: boolean; simdi: Date },
): CetpaBaglari {
  const ettnler = new Map<string, { cariKod?: string; siparis: string }>();
  const ettnsizFaturali: string[] = [];
  const cariler = new Map<string, BekletmeGirdisi>();
  let carisiBilinmeyen: BekletmeGirdisi | null = null;
  const yakinGonderilen: Array<{ ettn: string; siparis: string }> = [];
  const pencereBasi = isGunu(new Date(secenek.simdi.getTime() - ETTN_TUTMAYAN_PENCERE_GUN * 864e5));
  for (const ham of siparisler) {
    const o = ham as Record<string, unknown>;
    if (o.source === MF_KAYNAGI) continue;
    const ad = siparisAdi(o);
    const isaret = faturaIsareti(o);
    const ettn = cetpaEttnAnahtari(o.ettn);
    if (ettn) {
      if (!ettnler.has(ettn)) ettnler.set(ettn, { ...(isaret?.cariKod ? { cariKod: isaret.cariKod } : {}), siparis: ad });
      if (isaret?.durum === 'gonderildi') {
        const sinir = talepSiniri(isaret);
        if (sinir !== null && sinir >= pencereBasi) yakinGonderilen.push({ ettn, siparis: ad });
      }
    } else if (o.hasInvoice === true) {
      ettnsizFaturali.push(ad);
    }
    if (!secenek.bekletme || !isaret) continue;
    const bagiBilinmiyor = isaret.durum === 'gonderiliyor' || isaret.durum === 'belirsiz' || (isaret.durum === 'gonderildi' && ettn === '');
    if (!bagiBilinmiyor) continue;
    const sinir = talepSiniri(isaret);
    const cari = cariAnahtari(isaret.cariKod);
    if (cari) cariler.set(cari, enErken(cariler.get(cari), sinir, ad));
    else carisiBilinmeyen = enErken(carisiBilinmeyen, sinir, ad);
  }
  return { ettnler, ettnsizFaturali, cariler, carisiBilinmeyen, yakinGonderilen };
}

export type BekletmeNedeni = 'cari' | 'carisiBilinmeyen';

/**
 * § 8 H1 / § 9.A A2, A5 — yeni (MF siparişi henüz olmayan) satış faturası bekletilmeli mi? `faturaGunu` = `t.doc.orderDate`
 * (`cha_tarihi.slice(0, 10)` — `faturadanSiparis` türetir; kopya ayrıştırıcı yok). Sınır karşılaştırması METİNLE:
 * `faturaGunu >= sinir`; sınır `null` ise her tarih tutar; fatura günü okunamazsa (biçim dışı / boş) bekletilir (güvenli yön).
 *   • fatura carisi bilinen bir girişle tutar → `cari`;
 *   • fatura carisi BOŞ → kümedeki herhangi bir bilinen giriş tutunca `cari`;
 *   • carisi bilinmeyen giriş varsa tarih koşulunu sağlayan TÜM faturalar → `carisiBilinmeyen`.
 * Bekletilmiyorsa `null`.
 */
export function bekletmeKarari(
  b: Pick<CetpaBaglari, 'cariler' | 'carisiBilinmeyen'>, faturaCarisi: unknown, faturaGunu: unknown,
): { neden: BekletmeNedeni; siparisler: readonly string[] } | null {
  const gun = typeof faturaGunu === 'string' && GUN.test(faturaGunu) ? faturaGunu : null;
  const tutar = (g: BekletmeGirdisi): boolean => g.sinir === null || gun === null || gun >= g.sinir;
  const cari = cariAnahtari(faturaCarisi);
  if (cari) {
    const g = b.cariler.get(cari);
    if (g && tutar(g)) return { neden: 'cari', siparisler: g.siparisler };
  } else {
    for (const g of b.cariler.values()) if (tutar(g)) return { neden: 'cari', siparisler: g.siparisler };
  }
  if (b.carisiBilinmeyen && tutar(b.carisiBilinmeyen)) return { neden: 'carisiBilinmeyen', siparisler: b.carisiBilinmeyen.siparisler };
  return null;
}
