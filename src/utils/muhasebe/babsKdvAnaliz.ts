/**
 * babsKdvAnaliz.ts — MuhasebePage üç panelinin HESAPLARI, tek kaynak (Faz 3 1/n, 2026-09-13).
 * Test: babsKdvAnaliz.test.ts (ÖNCE yazıldı).
 *
 *   • Ba/Bs Formu            (Phase 555, MuhasebePage ~2013-2110)
 *   • Senaryo Bütçesi        (Phase 557, ~2112-2207)
 *   • KDV Analiz Raporu      (Phase 558, ~2209-2373)
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK):
 *   555  baMap[ad] = (baMap[ad] || 0) + f.tutar     tutarı bilinmeyen fatura 0 sayılıyor → cari ₺5.000
 *                                                  eşiğinin ALTINA düşüp VERGİ BEYANINDAN sessizce düşüyordu;
 *        f.tarih.startsWith(donem)                 tarihi boş fatura hiçbir döneme girmiyor, sayılmıyordu
 *   557  reduce(s + (o.totalPrice || 0))           tutarsız sipariş 0 ciro
 *        Σ / (cirolu ay || 1)                      hiç ciro yokken taban ₺0 → 12 ay "₺0K" projeksiyon
 *        margin = ciro > 0 ? … : 0                 ciro yokken %0 marj
 *   558  reduce(s + f.kdv)                         KDV'si bilinmeyen fatura NaN'ı toplama bulaştırır (hook 0'a
 *                                                  zorluyor → ₺0 KDV görünür); `f.kdv > 0` süzgeci bilinmeyeni
 *                                                  dağılımdan sessizce düşürüyordu; rateMap[key] || 0
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`Tutar.bilinmeyen`); ekran `ekranTutari` ile '—' basar ve
 * "N kayıt tutarsız" notu düşer. Oran/ortalama hesaplanamıyorsa null. Tarihi çözülemeyen kayıt bugüne
 * düşmez, `tarihsiz` sayılır. Dönem anahtarı zaman.ts `gunAnahtari` (YEREL gün) üstünden — 'YYYY-MM-DD'
 * string'i `Date.parse` ile UTC'ye sabitlenip batı saat diliminde önceki aya kaymasın.
 *
 * ÜST AKIŞ DÜZELDİ (Faz 3 2/n, grup "hook", 2026-09-18): `src/hooks/useMikroFaturalar.ts` artık okunamayan
 * `tutar`/`kdv`/`matrah`ı NaN (= bilinmiyor) veriyor ve sunucudaki `ISNULL(…, 0)` son yedeği kalktı — bilinmeyen
 * bu fonksiyonlara GERÇEKTEN ulaşır, sayaçlar dolar. Tipler `unknown` kaldı: `number` demek dolu demek değildir.
 * (2026-09-18 ÖNCESİ import edilmiş dokümanlar o eski yedeğin yazdığı ₺0'ı taşır; hook'taki "bayat ₺0"
 * koruması onları da bilinmeyen sayar, ama kesin çözüm tam yeniden import — Açık İşler.)
 *
 * Girdi tipleri MİNİMAL ve yapısal (`MikroFatura`/`Order`'a bağlı DEĞİL) — yarım-düzeltme sınıfı
 * (bkz. siparis.ts) tekrarlanmasın.
 */
import { bilinenSayi, toplaBilinen, type Tutar, tamTutar } from '../para';
import { gunAnahtari } from '../zaman';

const bosTutar = (): Tutar => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
const tutarEkle = (a: Tutar, b: Tutar): Tutar => ({ toplam: a.toplam + b.toplam, bilinen: a.bilinen + b.bilinen, bilinmeyen: a.bilinmeyen + b.bilinmeyen });

/** Kaydın 'YYYY-MM' dönemi, YEREL güne göre (zaman.ts gunAnahtari). Çözülemezse null — bugüne düşmez. */
export function donemAnahtari(tarih: unknown): string | null {
  const g = gunAnahtari(tarih);
  return g ? g.slice(0, 7) : null;
}

/** Mikro faturasının bu modülün okuduğu alanları (useMikroFaturalar `MikroFatura` yapısal olarak uyar). */
export interface FaturaKaydi {
  cariKod?: string;
  /** 'gelen' (alış) | 'giden' (satış) — başka değer her iki formdan da dışarıda kalır. */
  yon?: string;
  tarih?: unknown;
  tutar?: unknown;
  kdv?: unknown;
  oran?: unknown;
  oranKarma?: boolean;
}

// ── Phase 555: Ba/Bs ───────────────────────────────────────────────────────────────────────

/** Ba/Bs beyan eşiği (₺). */
export const BABS_ESIK = 5000;

export interface BabsSatir { ad: string; tutar: Tutar }

export interface BabsFormu {
  /** Bilinen toplamı eşiğe ulaşan cariler, azalan. Satırın `tutar.bilinmeyen > 0` ise yanına not düşülür. */
  satirlar: BabsSatir[];
  /**
   * Bilinen toplamı eşik ALTINDA ama tutarı bilinmeyen faturası olan cariler — eşik kararı verilemez,
   * beyandan sessizce düşürülemez. Eski kod bilinmeyeni 0 sayıp bu carileri yok sayıyordu.
   */
  belirsiz: BabsSatir[];
  /** `satirlar` toplamı (bilinmeyen sayacı dahil). */
  toplam: Tutar;
  /** Döneme düşen fatura adedi. */
  faturaSayisi: number;
  /** Bu yöndeki, tarihi çözülemeyen fatura adedi — hiçbir döneme giremez ("N faturanın tarihi yok"). */
  tarihsiz: number;
}

/**
 * Dönemdeki `yon` faturalarını cari bazında toplar. Cari adı: `cariAd(kod)` → kod → '—' (sayfadaki sıra).
 */
export function babsFormu(
  faturalar: readonly FaturaKaydi[],
  yon: 'gelen' | 'giden',
  donem: string,
  cariAd: (kod: string) => string | undefined,
  esik = BABS_ESIK,
): BabsFormu {
  const cariler = new Map<string, FaturaKaydi[]>();
  let tarihsiz = 0, faturaSayisi = 0;
  for (const f of faturalar) {
    if (f.yon !== yon) continue;
    const d = donemAnahtari(f.tarih);
    if (d === null) { tarihsiz++; continue; }
    if (d !== donem) continue;
    faturaSayisi++;
    const kod = f.cariKod ?? '';
    const ad = (kod ? cariAd(kod) : undefined) || kod || '—';
    const liste = cariler.get(ad);
    if (liste) liste.push(f); else cariler.set(ad, [f]);
  }
  const satirlar: BabsSatir[] = [], belirsiz: BabsSatir[] = [];
  for (const [ad, liste] of cariler) {
    const tutar = toplaBilinen(liste, f => f.tutar);
    if (tutar.toplam >= esik) satirlar.push({ ad, tutar });
    else if (tutar.bilinmeyen > 0) belirsiz.push({ ad, tutar });
  }
  const azalan = (a: BabsSatir, b: BabsSatir) => b.tutar.toplam - a.tutar.toplam;
  satirlar.sort(azalan);
  belirsiz.sort(azalan);
  return { satirlar, belirsiz, toplam: satirlar.reduce((t, s) => tutarEkle(t, s.tutar), bosTutar()), faturaSayisi, tarihsiz };
}

// ── Phase 557: Senaryo Bütçesi ─────────────────────────────────────────────────────────────

export interface CiroSiparisi { totalPrice?: unknown; status?: string; createdAt?: unknown }

export interface AylikCiro {
  /** 'YYYY-MM'. */
  ay: string;
  /** Ayın 1'i, yerel. */
  tarih: Date;
  ciro: Tutar;
}

export interface CiroTemeli {
  /** Eskiden yeniye, son eleman içinde bulunulan ay. */
  aylar: AylikCiro[];
  /** Σ(bilinen aylık ciro) / cirolu ay sayısı; hiç cirolu ay yoksa null — ₺0 taban uydurulmaz. */
  ortalama: number | null;
  /** Bilinen toplamı > 0 olan ay adedi (sayfadaki `v > 0` süzgeci). */
  ciroluAy: number;
  /** Penceredeki, tutarı bilinmeyen (iptal olmayan) sipariş adedi. */
  bilinmeyen: number;
  /** İptal olmayan ama tarihi çözülemeyen sipariş adedi — hiçbir aya giremez. */
  tarihsiz: number;
}

/**
 * Son `ayAdedi` ayın ciro tabanı. İptal (`status === 'Cancelled'`) dışarıda; kaynak (Mikro/Cetpa) ayrımı
 * YOK — sayfa da yapmıyordu, ciro ciro (tahsilat değil). Tarih alanı `createdAt` (sayfadaki gibi; Shopify
 * `syncedAt`/türetme `orderDate` için siparis.ts `siparisTarih` ayrı bir karar — bkz. bağlama notu).
 */
export function ciroTemeli(siparisler: readonly CiroSiparisi[], simdi: Date, ayAdedi = 6): CiroTemeli {
  const anahtarli = siparisler
    .filter(o => o.status !== 'Cancelled')
    .map(o => ({ o, ay: donemAnahtari(o.createdAt) }));
  const aylar: AylikCiro[] = [];
  for (let i = ayAdedi - 1; i >= 0; i--) {
    const tarih = new Date(simdi.getFullYear(), simdi.getMonth() - i, 1);
    const ay = donemAnahtari(tarih);
    if (ay === null) continue; // yalnız geçersiz `simdi` — ay uydurulmaz
    aylar.push({ ay, tarih, ciro: toplaBilinen(anahtarli.filter(x => x.ay === ay), x => x.o.totalPrice) });
  }
  const ciroluAy = aylar.filter(a => a.ciro.toplam > 0).length;
  const toplam = aylar.reduce((s, a) => s + a.ciro.toplam, 0);
  return {
    aylar,
    ortalama: ciroluAy > 0 ? toplam / ciroluAy : null,
    ciroluAy,
    bilinmeyen: aylar.reduce((s, a) => s + a.ciro.bilinmeyen, 0),
    tarihsiz: anahtarli.filter(x => x.ay === null).length,
  };
}

export interface Senaryo {
  /** Aylık bileşik ciro büyümesi (0.20 = +%20). */
  buyume: number;
  /** Aylık bileşik gider büyümesi. */
  giderBuyume: number;
}

/** Gider tahmini: tabanın bu oranı (sayfadaki "%65 varsayıldı"). */
export const GIDER_ORANI = 0.65;

export interface ProjeksiyonAyi {
  /** Ayın 1'i, yerel — etiketi sayfa `tarihYaz(tarih, { month: 'short', year: '2-digit' }, dil)` ile basar. */
  tarih: Date;
  ciro: number;
  gider: number;
  net: number;
  /** net/ciro × 100 yuvarlanmış; ciro ≤ 0 ise null (%0 değil). */
  marj: number | null;
}

export interface Projeksiyon {
  aylar: ProjeksiyonAyi[];
  /** Aylık YUVARLANMIŞ değerlerin toplamı (sayfadaki gibi). */
  toplamCiro: number;
  toplamGider: number;
  toplamNet: number;
}

/**
 * `ortalama` tabanından `ayAdedi` aylık bileşik projeksiyon; ilk ay `simdi`den sonraki ay.
 * Taban null/NaN ise null — sayfa üç KPI'ı ve tabloyu '—' basar, "₺0K" DEĞİL.
 */
export function senaryoProjeksiyonu(
  ortalama: number | null,
  senaryo: Senaryo,
  simdi: Date,
  ayAdedi = 12,
  giderOrani = GIDER_ORANI,
): Projeksiyon | null {
  if (ortalama === null || !Number.isFinite(ortalama)) return null;
  const aylar: ProjeksiyonAyi[] = Array.from({ length: ayAdedi }, (_, i) => {
    const tarih = new Date(simdi.getFullYear(), simdi.getMonth() + i + 1, 1);
    const ciro = Math.round(ortalama * (1 + senaryo.buyume) ** (i + 1));
    const gider = Math.round(ortalama * giderOrani * (1 + senaryo.giderBuyume) ** (i + 1));
    const net = ciro - gider;
    return { tarih, ciro, gider, net, marj: ciro > 0 ? Math.round((net / ciro) * 100) : null };
  });
  const toplamCiro = aylar.reduce((s, m) => s + m.ciro, 0);
  const toplamGider = aylar.reduce((s, m) => s + m.gider, 0);
  return { aylar, toplamCiro, toplamGider, toplamNet: toplamCiro - toplamGider };
}

// ── Phase 558: KDV Analiz ──────────────────────────────────────────────────────────────────

/**
 * Oran dağılımı kovası: 'karma' (faturada birden fazla oran) | sayısal oran ('20') | 'bilinmiyor'.
 * Sayfa `oran == null ? 'bilinmiyor' : String(oran)` diyordu — sayı olmayan oran 'NaN' kovası açardı.
 */
export function kdvOranAnahtari(f: Pick<FaturaKaydi, 'oran' | 'oranKarma'>): string {
  if (f.oranKarma) return 'karma';
  return bilinenSayi(f.oran) ? String(Number(f.oran)) : 'bilinmiyor';
}

export interface KdvAyi {
  /** 1-12. */
  ay: number;
  /** 'YYYY-MM'. */
  anahtar: string;
  /** Giden (satış) faturalarının KDV'si. */
  tahsil: Tutar;
  /** Gelen (alış) faturalarının KDV'si. */
  odenen: Tutar;
  /** tamTutar(tahsil) − tamTutar(odenen): bir taraf KISMİ bile bilinmiyorsa NaN ('—' + satır notu) — kısmi KDV'den net türetilmez. */
  net: number;
  /** tahsil.bilinmeyen + odenen.bilinmeyen — satır notu için. */
  bilinmeyen: number;
}

export interface KdvAnalizi {
  /** 12 ay, Ocak→Aralık. */
  aylar: KdvAyi[];
  toplamTahsil: Tutar;
  toplamOdenen: Tutar;
  /** tamTutar(toplamTahsil) − tamTutar(toplamOdenen) — türetme kapısı (para.ts). */
  toplamNet: number;
  /** Yalnız GİDEN ve KDV > 0 (ya da KDV'si bilinmeyen) faturalardan; anahtar `kdvOranAnahtari`. */
  oranDagilimi: Record<string, Tutar>;
  /** Yıla düşen fatura adedi (sayfadaki "fatura bulunamadı" uyarısı). */
  faturaSayisi: number;
  /** Tarihi çözülemeyen fatura adedi — hiçbir yıla giremez. */
  tarihsiz: number;
}

export function kdvAnalizi(faturalar: readonly FaturaKaydi[], yil: number): KdvAnalizi {
  const yilStr = String(yil);
  let tarihsiz = 0;
  const yilFaturalari: Array<{ f: FaturaKaydi; ay: string }> = [];
  for (const f of faturalar) {
    const d = donemAnahtari(f.tarih);
    if (d === null) { tarihsiz++; continue; }
    if (d.slice(0, 4) === yilStr) yilFaturalari.push({ f, ay: d });
  }
  const aylar: KdvAyi[] = Array.from({ length: 12 }, (_, i) => {
    const ay = i + 1;
    const anahtar = `${yilStr}-${String(ay).padStart(2, '0')}`;
    const ayin = yilFaturalari.filter(x => x.ay === anahtar);
    const tahsil = toplaBilinen(ayin.filter(x => x.f.yon === 'giden'), x => x.f.kdv);
    const odenen = toplaBilinen(ayin.filter(x => x.f.yon === 'gelen'), x => x.f.kdv);
    return { ay, anahtar, tahsil, odenen, net: tamTutar(tahsil) - tamTutar(odenen), bilinmeyen: tahsil.bilinmeyen + odenen.bilinmeyen };
  });
  const toplamTahsil = aylar.reduce((t, a) => tutarEkle(t, a.tahsil), bosTutar());
  const toplamOdenen = aylar.reduce((t, a) => tutarEkle(t, a.odenen), bosTutar());
  const oranDagilimi: Record<string, Tutar> = {};
  for (const { f } of yilFaturalari) {
    if (f.yon !== 'giden') continue;
    if (bilinenSayi(f.kdv) && Number(f.kdv) <= 0) continue; // KDV'siz/iade — sayfadaki `kdv > 0`; bilinmeyen DÜŞMEZ, sayılır
    const k = kdvOranAnahtari(f);
    oranDagilimi[k] = tutarEkle(oranDagilimi[k] ?? bosTutar(), toplaBilinen([f], x => x.kdv));
  }
  return {
    aylar,
    toplamTahsil,
    toplamOdenen,
    toplamNet: tamTutar(toplamTahsil) - tamTutar(toplamOdenen),
    oranDagilimi,
    faturaSayisi: yilFaturalari.length,
    tarihsiz,
  };
}
