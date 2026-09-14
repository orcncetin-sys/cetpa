/**
 * faturaTakipTahmin.ts — e-Fatura Takip kalem satırı, Fatura Yaşlandırma (dönem pencereli), Satış
 * Tahmini (ağırlıklı hareketli ortalama) ve Kar Merkezi hesapları. TEK KAYNAK.
 * Test: faturaTakipTahmin.test.ts (ÖNCE yazıldı). Faz 3 1/n (MuhasebePage kapatma), 2026-09-13.
 *
 * NEDEN VAR: MuhasebePage'in dört paneli hesabı JSX içinde IIFE olarak yazıyordu ve her biri
 * bilinmeyen tutarı sıfır sayıyordu (sayfa satırları yaklaşık):
 *
 *   Phase 564 e-Fatura Takip  ~2776  `(li.price||0)*(li.quantity||1)` — fiyatı bilinmeyen kalem ₺0,
 *                                    miktarı bilinmeyen kalem ×1 basılıyordu. Çözüm para.ts `satirTutari`
 *                                    (burada yeni fonksiyon YOK; bağlama doğrudan onu import eder).
 *   Phase 630 Fatura Yaşlandırma ~2819 `totalUnpaid = reduce(s+(o.totalPrice||0))` ve ~2836 kova
 *                                    reduce'u — tutarı bilinmeyen açık sipariş "₺0 bekleyen" oluyor,
 *                                    Toplam Bekleyen sessizce EKSİK çıkıyordu. Ayrıca gün yaşı ham ms
 *                                    bölmesiyle alınıyordu (zaman.ts: yerel gün farkı kuralı).
 *   Phase 565 Satış Tahmini  ~2857  ay cirosu `s+(o.totalPrice||0)` — tahmin eksik ciroyla besleniyor,
 *                                    tarihi çözülemeyen sipariş sessizce düşüyordu.
 *   Phase 566 Kar Merkezi    ~2946  `revenue += o.totalPrice || 0`; ~2947 `(li.costPrice??0)*li.quantity`
 *                                    — maliyeti bilinmeyen kalem ₺0 maliyet sayılıp kanal %100 marjlı
 *                                    görünüyordu; gelir 0 iken marj "%0,0" basılıyordu.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar toplama GİRMEZ, SAYILIR
 * (`bilinmeyen`). Toplamlar para.ts `Tutar` (toplam + bilinen + bilinmeyen) taşır; ekran para.ts
 * `ekranTutari` ile basar — TEK sözleşme: hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam +
 * "N kayıt tutarsız" notu. (Buradaki eski `gosterTutar` = `bilinmeyen > 0 ? NaN` kopyası 2026-09-14
 * hakem turunda silindi: Fatura Takip '—' basarken Bilanço/KDV aynı veriye kısmi toplam basıyordu.)
 * Oran/marj paydası 0 ise `null` ("%0 marj" sahte kesinliktir).
 *
 * Girdi tipleri MİNİMAL ve yapısal (Order'a bağlı değil): yerel daraltılmış Order türevleri de uyar
 * (bkz. siparis.ts notu — yarım düzeltme sınıfından kaçınmak için).
 */
import { bilinenSayi, toplaBilinen, satirTutari, ekranTutari, type Tutar, tamTutar, tutarBirlestir } from '../para';
import { gunFarki, ayAnahtari } from '../zaman';
import { yaslandirmaAdayi, yasKovasi, alacakTarihi, type Kovalar } from './arYaslandirma';

// ── Phase 630: Fatura Yaşlandırma (dönem pencereli) ─────────────────────────────────────────────

export interface YaslandirmaGirdisi {
  customerName?: string;
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
  faturali?: boolean;
}

/**
 * para.ts `Tutar` şekli (toplam + bilinen + bilinmeyen): sayfa `ekranTutari(sonuc)` basar. Kova tarafı
 * arYaslandirma `YaslandirmaOzeti` ile aynı şekil — `kovaTutari(sonuc, kova)` doğrudan çalışır.
 */
export interface FaturaYaslandirma extends Tutar {
  /** Pencereye giren açık sipariş sayısı (tutarı bilinmeyenler DAHİL — gecikme gerçektir). */
  adet: number;
  /** Bilinen tutarların toplamı — `bilinmeyen > 0` ise alt sınırdır (ekranTutari: kısmi toplam + not). */
  toplam: number;
  bilinen: number;
  bilinmeyen: number;
  /** Tarihi çözülemeyen aday — BUGÜNE düşürülmez, pencereye giremez (zaman.ts tuzağı B). */
  tarihsiz: number;
  kovalar: Kovalar;
  kovaAdet: Kovalar;
  kovaBilinen: Kovalar;
  kovaBilinmeyen: Kovalar;
}

const bosKovalar = (): Kovalar => ({ b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 });

/**
 * Phase 630: son `donemGun` gün içinde açılmış, ödenmemiş, iptal olmayan, ödemesi Cetpa'da izlenen
 * siparişlerin yaş kovaları. Sayfadaki gibi faturalı sipariş DIŞLANMAZ (`faturaliHaric:false`);
 * tarih kuralı Phase 131 ile aynı (`alacakTarihi`: createdAt, yoksa syncedAt — Shopify aynası).
 * Gün yaşı yerel gün farkıdır (`gunFarki`): 31 gün önce 23:00 açılan sipariş bugün 08:00'de 31 gündür,
 * ham ms bölmesinin dediği gibi 30 değil. Pencere de aynı ölçüyle: `gun <= donemGun`.
 * Gelecek tarihli (negatif gün) sipariş 0-30 kovasına düşer (yasKovasi) — sayfa onu kovasız bırakıp
 * yalnız toplama katıyordu; burada kova ve toplam tutarlıdır.
 */
export function faturaYaslandirma(
  siparisler: readonly YaslandirmaGirdisi[],
  s: { donemGun: number; simdi?: Date },
): FaturaYaslandirma {
  const simdi = s.simdi ?? new Date();
  const r: FaturaYaslandirma = { adet: 0, toplam: 0, bilinen: 0, bilinmeyen: 0, tarihsiz: 0, kovalar: bosKovalar(), kovaAdet: bosKovalar(), kovaBilinen: bosKovalar(), kovaBilinmeyen: bosKovalar() };
  for (const o of siparisler) {
    if (!yaslandirmaAdayi(o, { faturaliHaric: false })) continue;
    const d = alacakTarihi(o);
    const gun = d ? gunFarki(simdi, d) : null;
    if (gun === null) { r.tarihsiz++; continue; }
    if (gun > s.donemGun) continue;
    const kova = yasKovasi(gun);
    r.adet++;
    r.kovaAdet[kova]++;
    if (bilinenSayi(o.totalPrice)) {
      const n = Number(o.totalPrice);
      r.toplam += n;
      r.bilinen++;
      r.kovalar[kova] += n;
      r.kovaBilinen[kova]++;
    } else {
      r.bilinmeyen++;
      r.kovaBilinmeyen[kova]++;
    }
  }
  return r;
}

// ── Phase 565: Satış Tahmini ────────────────────────────────────────────────────────────────────

export interface TahminSiparisi {
  totalPrice?: unknown;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
}

/** Ayın cirosu para.ts `Tutar` şeklinde (toplam + bilinen + bilinmeyen) + adet. */
export interface TahminAyi extends Tutar {
  /** 'YYYY-MM' (zaman.ts ayAnahtari). */
  anahtar: string;
  /** Ayın 1'i, yerel — etiket için (`toLocaleString`) sayfada kalır. */
  ay: Date;
  toplam: number;
  adet: number;
  bilinen: number;
  bilinmeyen: number;
}

export interface TahminNoktasi {
  anahtar: string;
  ay: Date;
  /** max(0, wma + eğim·k) — bilinen cirolarla; ekrana `tahminTutari(sonuc, deger)` ile (para.ts sözleşmesi). */
  deger: number;
  alt: number;
  ust: number;
}

export interface SatisTahmini {
  /** En eski → bu ay (6 ay). */
  gecmis: TahminAyi[];
  tahmin: TahminNoktasi[];
  /** Pencereye giren, tutarı bilinen sipariş sayısı (ayların toplamı) — `tahminTutari` için. */
  bilinen: number;
  /** Pencereye giren, tutarı bilinmeyen sipariş sayısı (ayların toplamı). */
  bilinmeyen: number;
  /** Tarihi çözülemeyen (iptal olmayan) sipariş — bu aya YAZILMAZ, sayılır. */
  tarihsiz: number;
  wma: number;
  egim: number;
}

export const TAHMIN_GECMIS_AY = 6;

/**
 * Phase 565: son 6 ayın cirosu (iptal hariç; Mikro kaynaklı DAHİL — ciro cirodur, tahsilat değil),
 * ağırlıklı hareketli ortalama (ağırlık 1, 1.5, …, 3.5 = 1 + 0.5·i) + en küçük kareler eğimi,
 * `ufuk` ay ileri tahmin ve ±`bant` aralığı. Sayfadaki formüller birebir; tek fark bilinmeyen tutarın
 * sıfır değil sayaç olması ve tarihi çözülemeyen siparişin sessizce düşmeyip `tarihsiz` sayılması.
 * Ay anahtarı `ayAnahtari` (yerel) — `getMonth()` aritmetiği ve UTC kayması yok.
 */
export function satisTahmini(
  siparisler: readonly TahminSiparisi[],
  simdi: Date = new Date(),
  s: { ufuk?: number; bant?: number } = {},
): SatisTahmini {
  const { ufuk = 3, bant = 0.15 } = s;
  const aylar = new Map<string, TahminAyi>();
  const gecmis: TahminAyi[] = [];
  for (let i = TAHMIN_GECMIS_AY - 1; i >= 0; i--) {
    const ay = new Date(simdi.getFullYear(), simdi.getMonth() - i, 1);
    const a: TahminAyi = { anahtar: ayAnahtari(ay) ?? '', ay, toplam: 0, adet: 0, bilinen: 0, bilinmeyen: 0 };
    aylar.set(a.anahtar, a);
    gecmis.push(a);
  }
  let tarihsiz = 0;
  for (const o of siparisler) {
    if (o.status === 'Cancelled') continue;
    const anahtar = ayAnahtari(alacakTarihi(o));
    if (anahtar === null) { tarihsiz++; continue; }
    const a = aylar.get(anahtar);
    if (!a) continue; // pencere dışı (6 aydan eski ya da gelecek ay)
    a.adet++;
    if (bilinenSayi(o.totalPrice)) { a.toplam += Number(o.totalPrice); a.bilinen++; } else a.bilinmeyen++;
  }
  const bilinen = gecmis.reduce((t, a) => t + a.bilinen, 0);
  const bilinmeyen = gecmis.reduce((t, a) => t + a.bilinmeyen, 0);

  // Ağırlıklı hareketli ortalama: ağırlık_i = 1 + 0.5·i (sayfadaki [1, 1.5, 2, 2.5, 3, 3.5]).
  let agirlikToplam = 0, agirlikliToplam = 0;
  gecmis.forEach((a, i) => { const w = 1 + 0.5 * i; agirlikToplam += w; agirlikliToplam += a.toplam * w; });
  const wma = agirlikToplam > 0 ? agirlikliToplam / agirlikToplam : 0;

  // En küçük kareler eğimi (x = ay sırası 0..n-1).
  const n = gecmis.length;
  const xOrt = (n - 1) / 2;
  const yOrt = n > 0 ? gecmis.reduce((t, a) => t + a.toplam, 0) / n : 0;
  let pay = 0, payda = 0;
  gecmis.forEach((a, i) => { pay += (i - xOrt) * (a.toplam - yOrt); payda += (i - xOrt) ** 2; });
  const egim = payda > 0 ? pay / payda : 0;

  const tahmin: TahminNoktasi[] = [];
  for (let k = 1; k <= ufuk; k++) {
    const deger = Math.max(0, wma + egim * k);
    const ay = new Date(simdi.getFullYear(), simdi.getMonth() + k, 1);
    tahmin.push({ anahtar: ayAnahtari(ay) ?? '', ay, deger, alt: deger * (1 - bant), ust: deger * (1 + bant) });
  }
  return { gecmis, tahmin, bilinen, bilinmeyen, tarihsiz, wma, egim };
}

/**
 * Tahmin/bant değerinin ekran hâli — para.ts `ekranTutari` sözleşmesi, pencerenin sayaçlarıyla: pencerede
 * hiç bilinen ciro yokken ama bilinmeyen varken NaN ('—'); kısmi bilinmeyen → değer basılır, sayfa
 * "N sipariş tutarsız — eksik ciroyla hesaplandı" notu koyar; boş pencere gerçek 0.
 */
export function tahminTutari(t: Pick<SatisTahmini, 'bilinen' | 'bilinmeyen'>, deger: number): number {
  return ekranTutari({ toplam: deger, bilinen: t.bilinen, bilinmeyen: t.bilinmeyen });
}

// ── Phase 566: Kar Merkezi ──────────────────────────────────────────────────────────────────────

export interface KarKalemi { name?: string; costPrice?: unknown; quantity?: unknown }
export interface KarSiparisi {
  totalPrice?: unknown;
  status?: string;
  customerType?: string;
  lineItems?: readonly KarKalemi[];
}

export interface KarMerkezi {
  ad: string;
  adet: number;
  /** Gelir, SİPARİŞ bazında `toplaBilinen` (para.ts `Tutar`) — sayfa `ekranTutari(gelir)` + `gelir.bilinmeyen` notu. */
  gelir: Tutar;
  /** Kalem maliyetleri (costPrice × quantity), KALEM bazında `toplaBilinen` — eskiden ₺0 maliyet = %100 marj. */
  maliyet: Tutar;
  /**
   * tamTutar(gelir) − tamTutar(maliyet): bir sipariş tutarı ya da bir kalem maliyeti bilinmiyorsa NaN ('—') —
   * kısmi gelirden/maliyetten brüt kâr TÜRETİLMEZ (eksik maliyet = şişkin marj; 2026-09-14 hakem turu).
   * Gelir/maliyet hücreleri ekranTutari ile kısmi basılır, notlar orada. nakitBilanco `net` ile aynı desen.
   */
  brutKar: number;
  /** brutKar / gelir × 100; brutKar bilinmiyor ya da gelir 0 ise null ("%0,0" sahte kesinlikti). */
  marj: number | null;
}

/**
 * Phase 566: iptal olmayan siparişleri `customerType`'a göre kanallar; boş/eksik tür `digerAdi`
 * (çağıran dil etiketini verir: 'Diğer' / 'Other'). Bilinen gelire göre azalan.
 */
export function karMerkezleri(siparisler: readonly KarSiparisi[], digerAdi = 'Diğer'): KarMerkezi[] {
  const kanallar = new Map<string, KarSiparisi[]>();
  for (const o of siparisler) {
    if (o.status === 'Cancelled') continue;
    const ad = o.customerType || digerAdi;
    const liste = kanallar.get(ad);
    if (liste) liste.push(o); else kanallar.set(ad, [o]);
  }
  const sonuc = [...kanallar].map(([ad, liste]): KarMerkezi =>
    karSatiri(ad, liste.length, toplaBilinen(liste, o => o.totalPrice), toplaBilinen(liste.flatMap(o => o.lineItems ?? []), li => satirTutari(li.costPrice, li.quantity))),
  );
  return sonuc.sort((a, b) => b.gelir.toplam - a.gelir.toplam);
}

/** Kanal satırı ve toplam satırı AYNI kuralla: brüt kâr/marj yalnız iki taraf da tam bilinirken. */
const karSatiri = (ad: string, adet: number, gelir: Tutar, maliyet: Tutar): KarMerkezi => {
  const brutKar = tamTutar(gelir) - tamTutar(maliyet);
  const marj = Number.isFinite(brutKar) && gelir.toplam > 0 ? (brutKar / gelir.toplam) * 100 : null;
  return { ad, adet, gelir, maliyet, brutKar, marj };
};

/**
 * Phase 610 toplam satırı: kanalların gelir/maliyet sayaçları birleşir (tutarBirlestir); brüt kâr/marj satırlarla
 * aynı kapıdan geçer — bir kanalda bilinmeyen varsa toplam marj da '—' (eskiden `totalRev>0 ? … : '0'`).
 */
export function karMerkeziToplami(kanallar: readonly KarMerkezi[], ad = 'Toplam'): KarMerkezi {
  return karSatiri(ad, kanallar.reduce((s, k) => s + k.adet, 0), tutarBirlestir(...kanallar.map(k => k.gelir)), tutarBirlestir(...kanallar.map(k => k.maliyet)));
}
