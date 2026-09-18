/**
 * butceGerceklesme.ts — AccountingModule → "Bütçe" sekmesi (ButceTab: kalem başına gerçekleşen çubuğu +
 * "Genel Bütçe Durumu" halkası) hesabı. TEK KAYNAK. Test: butceGerceklesme.test.ts (ÖNCE yazıldı,
 * kırmızı görüldü). Faz 3 2/n, 2026-09-18.
 *
 * NEDEN VAR — sayfadaki dört sahte kesinlik (src/components/accounting/ButceTab.tsx 40-95):
 *   1. 44-46 / 87-90 `filter(...).reduce((sum, e) => sum + (e.borc || 0), 0)`
 *      → borcu bilinmeyen (DB null) fiş 0 sayılıp "gerçekleşen" sessizce EKSİK çıkıyordu: ₺5.000 harcama
 *        + tutarı girilmemiş kira, "₺5.000 / ₺20.000 → %25" olarak okunuyordu. Şimdi `toplaBilinen`:
 *        bilinenler toplanır, bilinmeyen SAYILIR; hiç bilinen yoksa ekran '—' (₺0 DEĞİL). Yan etki:
 *        sayısal string ('1500') artık sayı olarak okunur — eski reduce `0 + '1500'` ile '01500' metni
 *        üretip sonraki toplamaları da bozuyordu.
 *   2. 48 `b.amount > 0 ? Math.min(100, Math.round(actual / b.amount * 100)) : 0`
 *      → bütçesi 0/null/okunamayan kalem "%0" gösteriyordu (yani "hiç bütçenin %0'ı") ve boş çubuk
 *        "harcama yok" izlenimi veriyordu. Şimdi `yuzde: null` → ekranda '—'.
 *   3. 86 `budgets.reduce((sum, b) => sum + b.amount, 0)`
 *      → `amount` null ise JS `+ null === 0` (sessiz sıfır), undefined ise tüm toplam NaN → halka "%NaN".
 *   4. 92 `totalBudget > 0 ? Math.round(totalActual / totalBudget * 100) : 0`
 *      → toplam bütçe bilinmiyorken "Toplam bütçenin %0'i kullanıldı" cümlesi basılıyordu.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez,
 * SAYILIR; ekranda `paraYaz(ekranTutari(t))` ('—' ya da kısmi toplam + "N kayıt tutarsız" notu).
 * Oran TÜRETMEDİR (`tamTutar` kapısı): bütçe bilinmiyor/≤0 ya da gerçekleşenin BİR kaydı bile
 * bilinmiyorsa null — kısmi toplamdan yüzde üretilmez, "%0" basılmaz.
 * Boş dönem GERÇEK %0'dır (fiş yok = harcama yok), bilinmeyen değildir.
 *
 * SAYFA PARİTESİ (bilinçli, DEĞİŞTİRİLMEDİ):
 *   • Eşleşme ölçütü aynı: kategori TAM eşitlik + `date.startsWith(period)` ÖNEK eşleşmesi. Önek
 *     semantiği korunuyor — form `<input type="month">` ile "YYYY-MM" verir ama eski kayıtta "2026"
 *     duruyorsa yılın tamamı sayılır (eski davranış).
 *   • İptal/Mikro kaynaklı fiş dışlaması YOK (sayfada da yoktu; eklemek ayrı ürün kararı).
 *   • Aynı kategori+dönem iki bütçe kaleminde varsa fişler HER İKİSİNE de sayılır (toplam çift) —
 *     sayfa da öyle yapıyordu; düzeltmek gerçekleşen toplamını değiştirirdi.
 *   • Yüzde KIRPILMAZ: aşım %120 olarak döner. Sayfa çubuk GENİŞLİĞİ için 100'e kırpıyordu; kırpma
 *     sunum kararıdır, bağlamada (`Math.min(100, …)`) kalır — ekrana basılan sayı gerçek oran olmalı.
 *
 * BİLİNÇLİ FARKLAR (hesap sonucunu yalnız "bilinmeyen 0 sayılmaz" yönünde değiştirir):
 *   • Tarihi string olmayan fiş (DB null, Date nesnesi) hiçbir döneme girmez. Eski kod bu kayıtta
 *     `null.startsWith(...)` ile TÜM SEKMEYİ çökertiyordu (beyaz ekran, hesap değil kaza).
 *   • Dönemi string olmayan / boş bütçe kalemi hiçbir fişle eşleşmez. Eski kod `startsWith(undefined)`
 *     ile zaten boş dönüyordu; boş dönem ('') ise TÜM kategoriyi sayardı — dönemi bilinmeyen kaleme
 *     "gerçekleşen" atamak sahte kesinliktir.
 *
 * Girdi tipleri MİNİMAL ve yapısal: yalnız gerçekten okunan alanlar, hepsi `unknown` (types.ts
 * `JournalEntry.borc: number` / `Budget.amount: number` der ama DB'den null gelebilir — tip "number"
 * demek dolu demek DEĞİL). Kanonik tipler de yerel türevler de yapısal olarak uyar.
 */
import { bilinenSayi, toplaBilinen, tamTutar, tutarBirlestir, type Tutar } from '../para';

/** Bütçe kalemi (types.ts `Budget`); `amount`/`period` DB'den null gelebilir. */
export interface BgButce { id: string; category?: unknown; amount?: unknown; period?: unknown }

/** Yevmiye fişi (types.ts `JournalEntry`) — bu hesapta yalnız bu üç alan okunur. */
export interface BgFis { kategori?: unknown; date?: unknown; borc?: unknown }

/**
 * Kalemin dönemine düşen fişler: kategori TAM eşit + `date` ÖNEKİ döneme uyuyor (sayfa paritesi).
 * Tarihi string olmayan fiş dışarıda kalır (eski kod orada çöküyordu); dönem string değilse/boşsa
 * hiçbir fiş eşleşmez — dönemi bilinmeyen kaleme gerçekleşen atanmaz.
 */
export function donemFisleri<T extends BgFis>(fisler: readonly T[], kategori: unknown, donem: unknown): T[] {
  if (typeof donem !== 'string' || donem === '') return [];
  return fisler.filter(f => f.kategori === kategori && typeof f.date === 'string' && f.date.startsWith(donem));
}

/**
 * Bütçe kullanım yüzdesi. Bütçe bilinmiyor (NaN) ya da ≤ 0 → null; gerçekleşende BİR bilinmeyen bile
 * varsa → null (`tamTutar` kapısı: kısmi toplamdan oran türetilmez). Fişsiz dönem gerçek %0.
 * Kırpma YOK — aşım gerçek oranıyla döner (bkz. başlık, "SAYFA PARİTESİ").
 */
export function butceYuzdesi(butce: number, gerceklesen: Tutar): number | null {
  const tam = tamTutar(gerceklesen);
  if (!Number.isFinite(butce) || butce <= 0 || !Number.isFinite(tam)) return null;
  return Math.round((tam / butce) * 100);
}

export interface BgKalem {
  /** React key + silme hedefi (`deleteBudget`). */
  id: string;
  kategori: string;
  donem: string;
  /** TRY; NaN = kalem var ama tutarı okunamıyor → ekranda '—' (eski kod ₺0 basıyordu). */
  butce: number;
  /**
   * Dönemin bilinen borç toplamı + sayaçlar. Ekran: `paraYaz(ekranTutari(gerceklesen))`.
   * `bilinen + bilinmeyen === 0` → döneme HİÇ fiş düşmemiş (kategori hiç eşleşmemiş olabilir —
   * bkz. acikSorular: bütçe formunun kategorileri fiş kategorileriyle örtüşmüyor).
   */
  gerceklesen: Tutar;
  /** null = hesaplanamaz ('—'); aşımda 100'ü aşabilir (çubuk kırpması bağlamada). */
  yuzde: number | null;
}

/** Tek bütçe kalemi: bütçe tutarı + dönemin gerçekleşeni + yüzde. */
export function kalemGerceklesme(butce: BgButce, fisler: readonly BgFis[]): BgKalem {
  // Kalem VAR ama tutarı okunamıyorsa NaN ('—'); ₺0 girilmişse gerçek 0 (kullanıcı sıfır hedef koymuş).
  const tutar = bilinenSayi(butce.amount) ? Number(butce.amount) : NaN;
  const gerceklesen = toplaBilinen(donemFisleri(fisler, butce.category, butce.period), f => f.borc);
  return {
    id: butce.id,
    kategori: typeof butce.category === 'string' ? butce.category : '',
    donem: typeof butce.period === 'string' ? butce.period : '',
    butce: tutar,
    gerceklesen,
    yuzde: butceYuzdesi(tutar, gerceklesen),
  };
}

export interface BgOzet {
  /** Bütçe listesiyle AYNI sırada (React key = id). */
  kalemler: BgKalem[];
  /** Kalem bütçeleri; `bilinmeyen` = tutarı okunamayan kalem sayısı (eski kod bunları 0 topluyordu). */
  toplamButce: Tutar;
  /** Kalem gerçekleşenlerinin birleşimi; `bilinmeyen` = borcu okunamayan fiş sayısı. */
  toplamGerceklesen: Tutar;
  /** "Genel Bütçe Durumu" halkası; null = '—' ("%0 kullanıldı" cümlesi basılmaz). */
  toplamYuzde: number | null;
}

/** Sekmenin tamamı tek çağrıda: kalem satırları + Genel Bütçe Durumu halkası. */
export function butceGerceklesme(butceler: readonly BgButce[], fisler: readonly BgFis[]): BgOzet {
  const kalemler = butceler.map(b => kalemGerceklesme(b, fisler));
  const toplamButce = toplaBilinen(kalemler, k => k.butce);
  const toplamGerceklesen = tutarBirlestir(...kalemler.map(k => k.gerceklesen));
  // Toplam yüzde TÜRETMEDİR: tek bir kalemin bütçesi ya da tek bir fişin borcu bilinmiyorsa halka '—'.
  return { kalemler, toplamButce, toplamGerceklesen, toplamYuzde: butceYuzdesi(tamTutar(toplamButce), toplamGerceklesen) };
}
