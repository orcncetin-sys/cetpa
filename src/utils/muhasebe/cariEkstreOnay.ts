/**
 * cariEkstreOnay.ts — Müşteri cari hesap ekstresi + sipariş onay kapısı. TEK KAYNAK.
 * Test: cariEkstreOnay.test.ts (ÖNCE yazıldı). Faz 3 1/n (MuhasebePage kapatma), 2026-09-13.
 *
 * NEDEN VAR: MuhasebePage Phase 559 (Müşteri Cari Hesap Ekstresi, ~satır 2375-2506) ve Phase 560
 * (Sipariş Onay Akışı, ~2508-2560) hesabı JSX içinde IIFE olarak yazıyordu. Sahte kesinlik siteleri:
 *  - ~2386 `zamanMs(a.createdAt) ?? 0`    tarihi bilinmeyen sipariş 1970 sayılıp ekstrenin BAŞINA geliyor,
 *                                          yürüyen bakiyeyi de baştan kaydırıyordu → burada EN SONA + `tarihsiz`.
 *  - ~2391 `custLead?.creditLimit ?? 0`    limiti bilinmeyen müşteri "limit ₺0 / kullanım %0" görünüyordu → null.
 *  - ~2397 `const amt = o.totalPrice || 0` tutarı bilinmeyen hareket bakiyeye ₺0 giriyordu → satır `tutarBilinmiyor`,
 *                                          o satırdan itibaren bakiye NaN (paraYaz '—' basar; sonrası GERÇEKTEN bilinmez).
 *  - ~2402 `s+(o.totalPrice||0)`           Toplam Fatura / Tahsil Edilen eksik ama kesin görünüyordu → toplaBilinen.
 *  - ~2403 `.filter(o => o.paid)`          Mikro kaynaklı kayıtta `paid` alanı YOK; hepsi "ödenmedi" sayılıp Bekleyen
 *                                          Alacak şişiyordu (siparis.ts'teki ₺17,6M sınıfı) → odemeTakipli + `odemeBilinmeyen`.
 *  - ~2512 `(o.totalPrice || 0) >= esik`   tutarı bilinmeyen Pending sipariş 0 ≥ eşik olmadığından onay kapısından
 *                                          SESSİZCE geçiyordu → `tutarsiz` listesi (elle incelenmeli).
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez,
 * SAYILIR; ekran '—' + "N kayıt tutarsız" basar.
 *
 * Bilinçli sözleşme kararları (sayfadan sapmalar):
 *  - İptal (`status === 'Cancelled'`) satır ekstrede GÖRÜNÜR ama hiçbir toplama/bakiyeye girmez — sayfa iptal
 *    siparişi "bekleyen alacak" sayıyordu; para.ts `tahsilatOrani` ve arYaslandirma ile aynı süzgeç.
 *  - Sıralama tarihi `siparisTarih` (syncedAt → createdAt → orderDate) — sayfa yalnız createdAt'e bakıp
 *    Shopify kayıtlarını tarihsiz sayıyordu.
 *  - Yürüyen bakiye sayfadaki gibi KÜMÜLATİF fatura toplamıdır (ödeme düşülmez); semantik değiştirilmedi.
 *
 * Girdi tipleri MİNİMAL ve yapısal (Order/Lead'e bağlı değil) — yerel daraltılmış türevler de uyar.
 */
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';
import { odemeTakipli, siparisTarih } from '../siparis';

export interface EkstreSiparisi {
  id?: string;
  customerName?: string;
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
  orderDate?: unknown;
}
export interface EkstreMusterisi { name?: string; creditLimit?: unknown }

export type OdemeDurumu = 'odendi' | 'bekliyor' | 'bilinmiyor';
export interface CariHareketEk {
  tarih: Date | null;
  /** Bilinen tutar; bilinmiyorsa NaN. */
  tutar: number;
  tutarBilinmiyor: boolean;
  iptal: boolean;
  odeme: OdemeDurumu;
  /** Kümülatif fatura toplamı; ilk bilinmeyen tutardan itibaren NaN. */
  bakiye: number;
}
export type CariHareket<T> = T & CariHareketEk;
export interface CariHareketSonucu<T> { hareketler: CariHareket<T>[]; bilinmeyen: number; tarihsiz: number }

/**
 * KPI toplamları para.ts `Tutar` (toplam + bilinen + bilinmeyen): sayfa `ekranTutari(...)` basar — TEK sözleşme
 * (hiç bilinen yokken '—', kısmi bilinmeyen kısmi toplam + "N kaydın tutarı bilinmiyor" notu).
 */
export interface CariOzet {
  /** İptal olmayan tüm hareketler (Mikro kaynaklı dahil — fatura tutarı bilinir). */
  fatura: Tutar;
  /** Ödemesi Cetpa'da izlenen ve paid === true olanlar. */
  tahsil: Tutar;
  /** Ödemesi Cetpa'da izlenen ve ödenmemiş olanlar — Mikro kaynaklılar DAHİL DEĞİL (gerçeği Mikro caride). */
  bekleyen: Tutar;
  /** Tahsilatı Mikro'da izlenen kayıt sayısı — ekranda "N kaydın tahsilatı Mikro'da" notu. */
  odemeBilinmeyen: number;
}

const iptal = (o: EkstreSiparisi): boolean => o.status === 'Cancelled';
const tutar = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);

export function odemeDurumu(o: EkstreSiparisi): OdemeDurumu {
  if (!odemeTakipli(o)) return 'bilinmiyor';
  return o.paid === true ? 'odendi' : 'bekliyor';
}

/** Ekstre satırları: tarihe göre artan, tarihsizler sonda; kümülatif bakiye; sayaçlar. */
export function cariHareketleri<T extends EkstreSiparisi>(siparisler: readonly T[]): CariHareketSonucu<T> {
  const tarihli = siparisler.map(o => ({ o, tarih: siparisTarih(o) }));
  tarihli.sort((a, b) => {
    if (a.tarih === null) return b.tarih === null ? 0 : 1;
    if (b.tarih === null) return -1;
    return a.tarih.getTime() - b.tarih.getTime();
  });
  let bakiye = 0, bilinmeyen = 0, tarihsiz = 0;
  const hareketler = tarihli.map(({ o, tarih }): CariHareket<T> => {
    if (tarih === null) tarihsiz++;
    const t = tutar(o.totalPrice);
    const tutarBilinmiyor = !Number.isFinite(t);
    const ip = iptal(o);
    if (!ip) {
      if (tutarBilinmiyor) { bilinmeyen++; bakiye = NaN; } else bakiye += t;
    }
    return { ...o, tarih, tutar: t, tutarBilinmiyor, iptal: ip, odeme: odemeDurumu(o), bakiye };
  });
  return { hareketler, bilinmeyen, tarihsiz };
}

/** KPI toplamları — bilinmeyen tutar toplama girmez, sayılır. */
export function cariOzet(siparisler: readonly EkstreSiparisi[]): CariOzet {
  const gecerli = siparisler.filter(o => !iptal(o));
  const takipli = gecerli.filter(odemeTakipli);
  const sec = (o: EkstreSiparisi): unknown => o.totalPrice;
  return {
    fatura: toplaBilinen(gecerli, sec),
    tahsil: toplaBilinen(takipli.filter(o => o.paid === true), sec),
    bekleyen: toplaBilinen(takipli.filter(o => o.paid !== true), sec),
    odemeBilinmeyen: gecerli.length - takipli.length,
  };
}

/** Kredi limiti; lead yok ya da alan bilinmiyorsa null (0 DEĞİL). */
export function krediLimiti(musteri: EkstreMusterisi | undefined): number | null {
  if (!musteri || !bilinenSayi(musteri.creditLimit)) return null;
  return Number(musteri.creditLimit);
}

/**
 * Kredi kullanım yüzdesi. Limit yok/≤0, bekleyen tutarı bilinmeyen kayıt var ya da tahsilatı Mikro'da
 * izlenen kayıt varsa null — alacak o durumda alt sınırdır, yüzdesi sahte kesinlik olur.
 */
export function krediKullanimi(limit: number | null, ozet: CariOzet): number | null {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return null;
  if (ozet.bekleyen.bilinmeyen > 0 || ozet.odemeBilinmeyen > 0) return null;
  return (ozet.bekleyen.toplam / limit) * 100;
}

export interface OnayBekleyenler<T> {
  /** Pending + tutarı bilinen + tutar ≥ eşik. */
  liste: T[];
  /** Pending ama tutarı bilinmeyen — kapıdan sessizce geçmez, elle incelenmeli. */
  tutarsiz: T[];
  /** Eşik sonlu ve ≥ 0 mu? Değilse liste boş — geçersiz eşikle onay kararı verilmez. */
  esikGecerli: boolean;
}

/** Phase 560: onay bekleyen yüksek tutarlı Pending siparişler. */
export function onayBekleyenler<T extends EkstreSiparisi>(siparisler: readonly T[], esik: unknown): OnayBekleyenler<T> {
  const e = tutar(esik);
  const esikGecerli = Number.isFinite(e) && e >= 0;
  const liste: T[] = [], tutarsiz: T[] = [];
  for (const o of siparisler) {
    if (o.status !== 'Pending') continue;
    const t = tutar(o.totalPrice);
    if (!Number.isFinite(t)) { tutarsiz.push(o); continue; }
    if (esikGecerli && t >= e) liste.push(o);
  }
  return { liste, tutarsiz, esikGecerli };
}
