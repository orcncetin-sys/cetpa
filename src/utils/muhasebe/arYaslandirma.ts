/**
 * arYaslandirma.ts — Müşteri alacak yaşlandırması + gecikme eskalasyonu. TEK KAYNAK.
 * Test: arYaslandirma.test.ts (ÖNCE yazıldı). Faz 3 1/n (MuhasebePage kapatma), 2026-09-13.
 *
 * NEDEN VAR: MuhasebePage Phase 131 (Müşteri Alacak Yaşlandırması, ~satır 1087-1185) ve
 * Phase 178 (Eskalasyon Gerektiren Faturalar, ~1187-1225) hesabı JSX içinde IIFE olarak yazıyordu.
 * Sahte kesinlik sitesi: `const amt = o.totalPrice || 0` (~1111) — tutarı bilinmeyen sipariş
 * (Mikro'dan gelmemiş alan, boş string, NaN) ₺0 alacak olarak kovaya giriyor, müşteri "borcu yok"
 * görünüyor ve toplam alacak sessizce EKSİK çıkıyordu. Kural (CLAUDE.md "sahte kesinlik gösterme"):
 * bilinmeyen tutar toplama GİRMEZ, SAYILIR (`bilinmeyen`) — ekran '—' + "N kayıt tutarsız" basar.
 *
 * Ayrıca sayfada iki panel aynı süzgeci iki kez elle yazıyordu (`!o.paid && status !== 'Cancelled'
 * && odemeTakipli(o)`) ve gün farkını ham ms bölmesiyle alıyordu; burada zaman.ts `gunFarki`
 * (yerel gün) kullanılır — "dün 23:00" bugün 01:00'de 1 gün gecikmiştir, 0 değil.
 *
 * Girdi tipleri MİNİMAL ve yapısal (Order'a bağlı değil): yerel daraltılmış Order türevleri de uyar
 * (bkz. siparis.ts notu — yarım düzeltme sınıfından kaçınmak için).
 */
import { bilinenSayi, ekranTutari, type Tutar } from '../para';
import { odemeTakipli } from '../siparis';
import { zamanDate, gunFarki } from '../zaman';

export interface YaslandirmaSiparisi {
  customerName?: string;
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
  /** Faturası Mikro'ya kesilmiş sipariş — alacağı cariBalances'ta yaşar (çift sayım koruması). */
  faturali?: boolean;
}

/** Yaş kovaları — adlar sayfadaki kart/sütun sırasıyla aynı. */
export interface Kovalar { b0_30: number; b31_60: number; b61_90: number; b90p: number }
export type KovaAdi = keyof Kovalar;
export const KOVA_ADLARI: readonly KovaAdi[] = ['b0_30', 'b31_60', 'b61_90', 'b90p'];
export type EskalasyonSeviyesi = 'L1' | 'L2' | 'L3';

export interface MusteriYaslandirma {
  ad: string;
  /** Bilinen tutarların toplamı — `bilinmeyen > 0` ise alt sınırdır, ekranda '—' + not. */
  toplam: number;
  kovalar: Kovalar;
  /** Kova başına tutarı bilinen sipariş sayısı (`kovaTutari` sözleşmesi için). */
  kovaBilinen: Kovalar;
  /** Kova başına tutarı bilinmeyen sipariş SAYISI (yaşı bilinir, tutarı bilinmez). */
  kovaBilinmeyen: Kovalar;
  bilinen: number;
  bilinmeyen: number;
  /** En eski açık alacağın gün yaşı. */
  enEski: number;
}

export interface YaslandirmaOzeti {
  /** Bilinen toplama göre azalan. */
  musteriler: MusteriYaslandirma[];
  kovalar: Kovalar;
  kovaBilinen: Kovalar;
  kovaBilinmeyen: Kovalar;
  toplam: number;
  bilinen: number;
  bilinmeyen: number;
  /** Tarihi çözülemeyen aday sipariş — BUGÜNE düşürülmez, yaşlandırmaya girmez (zaman.ts tuzağı B). */
  tarihsiz: number;
}

const bosKovalar = (): Kovalar => ({ b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 });

/**
 * Alacak sayılacak sipariş: ödenmemiş, iptal değil, ödemesi Cetpa'da izlenen (Mikro kaynaklı DEĞİL —
 * orada `paid` yokluğu "bilinmiyor"dur, bkz. siparis.ts) ve varsayılan olarak faturasız.
 * `faturaliHaric:false` → Phase 178'in mevcut davranışı (faturalı da listelenir).
 */
export function yaslandirmaAdayi(o: YaslandirmaSiparisi, s: { faturaliHaric?: boolean } = {}): boolean {
  const faturaliHaric = s.faturaliHaric ?? true;
  return !o.paid && o.status !== 'Cancelled' && odemeTakipli(o) && !(faturaliHaric && o.faturali === true);
}

/** Gün yaşı → kova. Sınırlar sayfadaki gibi: ≤30, ≤60, ≤90, sonrası 90+. Negatif (gelecek tarihli) → 0-30. */
export function yasKovasi(gun: number): KovaAdi {
  if (gun <= 30) return 'b0_30';
  if (gun <= 60) return 'b31_60';
  if (gun <= 90) return 'b61_90';
  return 'b90p';
}

/** Eskalasyon: 31-60 L1, 61-90 L2, 90+ L3 (sayfadaki eşikler). */
export function eskalasyonSeviyesi(gun: number): EskalasyonSeviyesi {
  return gun > 90 ? 'L3' : gun > 60 ? 'L2' : 'L1';
}

/**
 * Alacağın doğduğu tarih: `createdAt` ÖNCE, yoksa `syncedAt` (Shopify aynasında tek tarih alanı).
 * siparis.ts `siparisTarih` bilerek KULLANILMADI: o syncedAt'ı önce okur; native AddOrder her iki
 * alanı da yazdığından yeniden senkronda alacak "tazelenir"di. Çözülemezse null — asla bugün.
 */
export function alacakTarihi(o: Pick<YaslandirmaSiparisi, 'createdAt' | 'syncedAt'>): Date | null {
  return zamanDate(o.createdAt) ?? zamanDate(o.syncedAt);
}

/** Yerel güne göre gecikme günü (zaman.ts gunFarki); tarih çözülemezse null. */
export function gecikmeGunu(o: Pick<YaslandirmaSiparisi, 'createdAt' | 'syncedAt'>, simdi: Date): number | null {
  const d = alacakTarihi(o);
  return d ? gunFarki(simdi, d) : null;
}

/** Phase 131: müşteri bazında yaş kovaları. Yalnız Cetpa-native, faturasız alacaklar (bkz. yaslandirmaAdayi). */
export function arYaslandirma(siparisler: readonly YaslandirmaSiparisi[], simdi: Date = new Date()): YaslandirmaOzeti {
  const harita = new Map<string, MusteriYaslandirma>();
  let tarihsiz = 0;
  for (const o of siparisler) {
    if (!yaslandirmaAdayi(o)) continue;
    const gun = gecikmeGunu(o, simdi);
    if (gun === null) { tarihsiz++; continue; }
    const ad = o.customerName || '—';
    let m = harita.get(ad);
    if (!m) {
      m = { ad, toplam: 0, kovalar: bosKovalar(), kovaBilinen: bosKovalar(), kovaBilinmeyen: bosKovalar(), bilinen: 0, bilinmeyen: 0, enEski: 0 };
      harita.set(ad, m);
    }
    const kova = yasKovasi(gun);
    m.enEski = Math.max(m.enEski, gun);
    if (bilinenSayi(o.totalPrice)) {
      const n = Number(o.totalPrice);
      m.toplam += n;
      m.kovalar[kova] += n;
      m.bilinen++;
      m.kovaBilinen[kova]++;
    } else {
      m.bilinmeyen++;
      m.kovaBilinmeyen[kova]++;
    }
  }
  const musteriler = [...harita.values()].sort((a, b) => b.toplam - a.toplam);
  const kovalar = bosKovalar(), kovaBilinen = bosKovalar(), kovaBilinmeyen = bosKovalar();
  let toplam = 0, bilinen = 0, bilinmeyen = 0;
  for (const m of musteriler) {
    toplam += m.toplam;
    bilinen += m.bilinen;
    bilinmeyen += m.bilinmeyen;
    for (const k of KOVA_ADLARI) { kovalar[k] += m.kovalar[k]; kovaBilinen[k] += m.kovaBilinen[k]; kovaBilinmeyen[k] += m.kovaBilinmeyen[k]; }
  }
  return { musteriler, kovalar, kovaBilinen, kovaBilinmeyen, toplam, bilinen, bilinmeyen, tarihsiz };
}

/**
 * Bir kovanın ekran tutarı — para.ts `ekranTutari` sözleşmesi: kovada hiç bilinen yokken NaN ('—'),
 * kısmi bilinmeyen kısmi toplam (sayfa "N kayıt tutarsız" notu koyar). Eskiden sayfa `kovaBilinmeyen > 0 ? NaN`
 * ile KDV/Bilanço panellerinden farklı davranıyordu.
 */
export function kovaTutari(x: Pick<YaslandirmaOzeti, 'kovalar' | 'kovaBilinen' | 'kovaBilinmeyen'>, k: KovaAdi): number {
  return ekranTutari({ toplam: x.kovalar[k], bilinen: x.kovaBilinen[k], bilinmeyen: x.kovaBilinmeyen[k] });
}

/**
 * "Toplam Alacak" = native kovalar + Mikro cari bakiyesi (sayfadaki `cariBalanceToplam.ar`; faturalı
 * siparişler orada sayıldığı için native taraftan dışlanır). Mikro bakiyesi bilinmiyorsa NaN —
 * paraYaz/tlYaz '—' basar. `bilinmeyen` native tarafın sayacıdır; `bilinen` native + (Mikro biliniyorsa 1) —
 * sayfa `ekranTutari(toplamAlacak(…))` basar (para.ts sözleşmesi).
 */
export function toplamAlacak(ozet: Pick<YaslandirmaOzeti, 'toplam' | 'bilinen' | 'bilinmeyen'>, mikroAlacak: unknown): Tutar {
  const mikroBilinen = bilinenSayi(mikroAlacak);
  return { toplam: mikroBilinen ? ozet.toplam + Number(mikroAlacak) : NaN, bilinen: ozet.bilinen + (mikroBilinen ? 1 : 0), bilinmeyen: ozet.bilinmeyen };
}

export interface GecikmeSecenek {
  simdi?: Date;
  /** Bu günden FAZLA gecikenler (varsayılan 30 → 31+). */
  esikGun?: number;
  /** Listede en fazla kaç kayıt (varsayılan 8). */
  enFazla?: number;
  /** Varsayılan false = sayfadaki Phase 178 davranışı (faturalı da listelenir). */
  faturaliHaric?: boolean;
}
export type GecikmisSiparis<T> = T & { gecikmeGunu: number; seviye: EskalasyonSeviyesi };

/**
 * Phase 178: eşiği aşan açık siparişler, en eski önce, `enFazla` ile kırpılmış; her kayda gün + seviye
 * eklenir, girdi alanları korunur (JSX id/customerName/totalPrice okumaya devam eder).
 * Tutarı bilinmeyen kayıt LİSTEDE KALIR — gecikme gerçektir, tutar '—' basılır (`tutarBilinmeyen` sayılır).
 */
export function gecikmisSiparisler<T extends YaslandirmaSiparisi>(
  siparisler: readonly T[],
  s: GecikmeSecenek = {},
): { liste: GecikmisSiparis<T>[]; tarihsiz: number; tutarBilinmeyen: number } {
  const simdi = s.simdi ?? new Date();
  const esik = s.esikGun ?? 30;
  const enFazla = s.enFazla ?? 8;
  const faturaliHaric = s.faturaliHaric ?? false;
  let tarihsiz = 0;
  const gecikenler: GecikmisSiparis<T>[] = [];
  for (const o of siparisler) {
    if (!yaslandirmaAdayi(o, { faturaliHaric })) continue;
    const gun = gecikmeGunu(o, simdi);
    if (gun === null) { tarihsiz++; continue; }
    if (gun > esik) gecikenler.push({ ...o, gecikmeGunu: gun, seviye: eskalasyonSeviyesi(gun) });
  }
  const liste = gecikenler.sort((a, b) => b.gecikmeGunu - a.gecikmeGunu).slice(0, enFazla);
  const tutarBilinmeyen = liste.filter(o => !bilinenSayi(o.totalPrice)).length;
  return { liste, tarihsiz, tutarBilinmeyen };
}
