/**
 * kdvAylik.ts — MuhasebePage'in iki panelinin HESAPLARI, tek kaynak (Faz 3 1/n, 2026-09-13).
 * Test: kdvAylik.test.ts (ÖNCE yazıldı).
 *
 *   • Genel › "KDV Özeti (Son 6 Ay)"        (Phase 146, MuhasebePage ~378-439)
 *   • Tahsilat › "Tahsilat Hatırlatma Otomasyonu" (Phase 607, MuhasebePage ~448-505)
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` YASAK):
 *   kdvCollected = reduce(kdvTutari || 0)                  KDV'si bilinmeyen kayıt 0 sayılıyordu
 *   netRevenue   = reduce(kdvHaricTutar || totalPrice || 0) net yoksa BRÜT (KDV dahil) net sayılıyordu
 *   totalUnpaid  = reduce(totalPrice || 0)                  tutarı bilinmeyen açık sipariş 0 sayılıyordu
 *   daysPast     = floor((now - createdAt) / 86400000)      UTC/yerel gün farkı — zaman.ts `gunFarki` tuzağı
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`bilinmeyen`); ekran `ekranTutari` ile '—' basar
 * ve "N kayıt tutarsız" notu düşer. Oran hesaplanamıyorsa null — %0 uydurulmaz.
 *
 * Girdi tipleri MİNİMAL ve yapısal (`Order`'a bağlı DEĞİL) — FinancePanel/AnalyticsPanel gibi yerel
 * daraltılmış tipler de uyar; yarım-düzeltme sınıfı (bkz. siparis.ts) tekrarlanmasın.
 */
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';
import { odemeTakipli } from '../siparis';
import { ayAnahtari, gunFarki } from '../zaman';

/** para.ts `Tutar` (toplaBilinen dönüşü) — eski importlar için yeniden dışa aktarım. Ekran köprüsü `ekranTutari` de para.ts'te (tek sözleşme). */
export type { Tutar };

// ── Phase 146: KDV aylık özet ───────────────────────────────────────────────────────────────

export interface KdvKaydi { kdvTutari?: unknown; kdvHaricTutar?: unknown; faturali?: unknown; createdAt?: unknown }

/**
 * KDV panosuna giren kayıt. Üretici (App.tsx AddOrder) faturasız siparişe `kdvTutari: 0` yazar;
 * sayfanın `!!kdvTutari` süzgeci bu yüzden "0 = KDV yok, dışarıda" demektir — korunur.
 * Fark: alan DOLU ama sayı değilse (NaN/'abc') eskiden sessizce düşüyordu; artık girer ve
 * `bilinmeyen` sayılır. Alan yoksa (undefined/null/'') KDV kaydı değildir.
 */
export function kdvKaydiMi(o: KdvKaydi): boolean {
  const k = o.kdvTutari;
  if (k == null || k === '') return false;
  return bilinenSayi(k) ? Number(k) !== 0 : true;
}

export interface AyOzeti {
  /** 'YYYY-MM' (zaman.ts ayAnahtari). */
  ay: string;
  /** Ayın 1'i, yerel — etiketi sayfa `tarihYaz(tarih, { month: 'short', year: '2-digit' }, dil)` ile basar. */
  tarih: Date;
  kdv: Tutar;
  net: Tutar;
  /** `faturali` işaretli kayıt adedi (sayfadaki "N fatura"). */
  faturali: number;
}

export interface KdvAylikOzet {
  /** Eskiden yeniye, son eleman içinde bulunulan ay. */
  aylar: AyOzeti[];
  toplamKdv: Tutar;
  toplamNet: Tutar;
  /** ΣKDV / Σnet × 100 — yalnız İKİSİ DE bilinen kayıtlardan; net ≤ 0 ise null. Yuvarlama çağıranın işi. */
  efektifOran: number | null;
}

const bos = (): Tutar => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
const ekle = (a: Tutar, b: Tutar): Tutar => ({ toplam: a.toplam + b.toplam, bilinen: a.bilinen + b.bilinen, bilinmeyen: a.bilinmeyen + b.bilinmeyen });

/**
 * Son `ayAdedi` ayın KDV / KDV-hariç ciro özeti. Net için `totalPrice`'a DÜŞÜLMEZ: o brüttür,
 * eski `kdvHaricTutar || totalPrice` KDV kadar şişiriyordu — net bilinmiyorsa bilinmiyor.
 * İptal kaydı sayfadaki gibi dışlanmaz (ayrı iş kararı; bkz. bağlama notu).
 */
export function kdvAylikOzet(siparisler: readonly KdvKaydi[], simdi: Date, ayAdedi = 6): KdvAylikOzet {
  const kayitlar = siparisler.filter(kdvKaydiMi);
  const aylar: AyOzeti[] = [];
  for (let i = ayAdedi - 1; i >= 0; i--) {
    const tarih = new Date(simdi.getFullYear(), simdi.getMonth() - i, 1);
    const ay = ayAnahtari(tarih);
    if (ay === null) continue; // yalnız geçersiz `simdi` — ay uydurulmaz
    const ayKayitlari = kayitlar.filter(o => ayAnahtari(o.createdAt) === ay);
    aylar.push({
      ay,
      tarih,
      kdv: toplaBilinen(ayKayitlari, o => o.kdvTutari),
      net: toplaBilinen(ayKayitlari, o => o.kdvHaricTutar),
      faturali: ayKayitlari.filter(o => !!o.faturali).length,
    });
  }
  const pencere = new Set(aylar.map(a => a.ay));
  let oranKdv = 0, oranNet = 0;
  for (const o of kayitlar) {
    const ay = ayAnahtari(o.createdAt);
    if (ay === null || !pencere.has(ay)) continue;
    if (bilinenSayi(o.kdvTutari) && bilinenSayi(o.kdvHaricTutar)) { oranKdv += Number(o.kdvTutari); oranNet += Number(o.kdvHaricTutar); }
  }
  return {
    aylar,
    toplamKdv: aylar.reduce((t, a) => ekle(t, a.kdv), bos()),
    toplamNet: aylar.reduce((t, a) => ekle(t, a.net), bos()),
    efektifOran: oranNet > 0 ? (oranKdv / oranNet) * 100 : null,
  };
}

// ── Phase 607: Tahsilat hatırlatma ─────────────────────────────────────────────────────────

/**
 * Gün sayısının eşik kovası: 0 = eşik altı ("Normal"), i+1 = `esikler[i]`'yi aşan en yüksek eşik.
 * Sayfadaki getBucket ile aynı sıra ([2] → [1] → [0]); sayı olmayan eşik (boş input → NaN) atlanır.
 */
export function yaslandirmaSeviyesi(gun: number, esikler: readonly number[]): number {
  for (let i = esikler.length - 1; i >= 0; i--) {
    const e = esikler[i];
    if (typeof e === 'number' && Number.isFinite(e) && gun >= e) return i + 1;
  }
  return 0;
}

export interface AcikSiparis { totalPrice?: unknown; paid?: boolean; status?: string; source?: string; createdAt?: unknown }

export interface TahsilatHatirlatma<T> {
  /** Açık siparişler, geçen gün azalan sırada; orijinal alanlar + `gunGecti`. */
  satirlar: Array<T & { gunGecti: number }>;
  /** Üst eşiği (`esikler[son]`) aşan satır adedi. */
  kritik: number;
  /** Açık bakiye — bilinen toplam + tutarı bilinmeyen satır sayısı. */
  bakiye: Tutar;
  /** Açık olup tarihi çözülemeyen kayıt adedi (listeye giremez; "N kaydın tarihi yok" notu). */
  tarihsiz: number;
}

/**
 * Ödenmemiş + iptal olmayan + ödemesi Cetpa'da izlenen (Mikro kaynaklı DEĞİL — `paid` yokluğu
 * "bilinmiyor"dur, siparis.ts) siparişlerin yaşlandırması. Gün farkı `gunFarki` (yerel gün, tam gün).
 */
export function tahsilatHatirlatma<T extends AcikSiparis>(siparisler: readonly T[], esikler: readonly number[], bugun: Date): TahsilatHatirlatma<T> {
  const satirlar: Array<T & { gunGecti: number }> = [];
  let tarihsiz = 0;
  for (const o of siparisler) {
    if (o.paid || o.status === 'Cancelled' || !odemeTakipli(o)) continue;
    const gunGecti = gunFarki(bugun, o.createdAt);
    if (gunGecti === null) { tarihsiz++; continue; }
    satirlar.push({ ...o, gunGecti });
  }
  satirlar.sort((a, b) => b.gunGecti - a.gunGecti);
  const kritik = esikler.length > 0 ? satirlar.filter(s => yaslandirmaSeviyesi(s.gunGecti, esikler) === esikler.length).length : 0;
  return { satirlar, kritik, bakiye: toplaBilinen(satirlar, s => s.totalPrice), tarihsiz };
}
