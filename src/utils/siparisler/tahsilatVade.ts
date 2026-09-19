/**
 * tahsilatVade.ts — Ödenmemiş sipariş (alacak) özeti + vade/yaş kovaları. TEK KAYNAK.
 * Test: tahsilatVade.test.ts (ÖNCE yazıldı). Faz 3 4/n (OrdersPage kapatma), 2026-09-19.
 *
 * NEDEN VAR — src/pages/OrdersPage.tsx'teki sahte kesinlik siteleri:
 *   542-543 (Phase 522 KPI şeridi, "Alacak Toplam"):
 *           `unpaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *   614     (Phase 521 "Alacak Yaşlandırma Raporu", kova kartı):
 *           `paraYaz(b.items.reduce((s,o)=>s+(o.totalPrice||0),0), { ondalik: 0 })`
 * Tutarı bilinmeyen (alan hiç gelmemiş / boş string / sayısal olmayan / NaN) ödenmemiş sipariş
 * ₺0 alacak sayılıyordu: "Alacak Toplam" sessizce EKSİK çıkıyor, üstelik hepsi bilinmiyorsa
 * `unpaidTotal > 0 ? kırmızı : yeşil` kapısı kartı YEŞİLE — "alacağın yok" — çeviriyordu.
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar toplama GİRMEZ, SAYILIR;
 * ekran '—' ya da kısmi toplam + "N kayıt tutarsız" notu basar (para.ts `ekranTutari`).
 *
 * İKİNCİ ARIZA SINIFI — 565'teki süzgeç:
 *   `activeOrders.filter(o => … && zamanMs(o.createdAt ?? o.syncedAt) !== null && …)`
 * tarihi çözülemeyen ödenmemiş siparişi yaşlandırmadan KOMPLE düşürüyordu: ne bir kovada
 * ne de ekranda görünüyordu, yalnız KPI sayacında kalıyordu (iki panel farklı küme sayıyordu).
 * Burada o kayıtlar `tarihsiz` olarak AYRI sayılır — yanlış kovaya da düşmez, sessizce de
 * kaybolmaz; `adet === yaslandirilanAdet + tarihsiz` değişmezi testle korunur.
 *
 * PARİTE: bilinen girdide sayılar eskiyle birebir — kova sırası/sınırları (≤30, ≤60, ≤90, 90+),
 * aday süzgeci (`!paid && status !== 'Cancelled' && odemeTakipli`), etiketler ('0–30' / '0–30 gün')
 * ve `hasOld` (31+ kovalarında kayıt var mı → `eskiVar`) korunur.
 *
 * BİLİNÇLİ FARKLAR (hepsi testli):
 *  1. Tutar `siparisTutari` ile okunur (`totalPrice ?? totalAmount`); sayfa yalnız `totalPrice`
 *     okuyordu, `totalAmount` ile gelen Mikro/Shopify kaydı ₺0 alacak görünüyordu. Meşru 0 yine 0.
 *  2. Gün farkı yerel güne göre (zaman.ts `gunFarki`, arYaslandirma `gecikmeGunu`), sayfanın ham
 *     `Math.floor((now - ms)/86400000)` bölmesiyle değil: "dün 23:00" bugün 01:00'de 1 gündür, 0 değil.
 *  3. Tarih sırası `createdAt` → `syncedAt` (arYaslandirma `alacakTarihi`); sayfanın `createdAt ?? syncedAt`
 *     kalıbı createdAt VARSA ama çözülemiyorsa syncedAt'a düşmüyor, kaydı tarihsiz sayıyordu.
 *  4. Yaşlandırma aday süzgeci `faturaliHaric: false` ile AÇIKÇA çağrılır — sayfanın bugünkü
 *     davranışı bu (faturalı sipariş de listelenir). Çift sayım sorusu için bkz. `acikSorular`.
 *
 * Yaş kovası mantığı KOPYALANMADI: `arYaslandirma` (Faz 3 1/n, MuhasebePage Phase 131) aynı iş
 * kuralının tek kaynağı — aday süzgeci, kova sınırları ve gecikme günü oradan içe aktarılır.
 * Girdi tipi MİNİMAL ve yapısal (`Order`'a bağlı değil; bkz. siparis.ts notu).
 */
import { toplaBilinen, ekranTutari, type Tutar } from '../para';
import { siparisTutari } from '../siparis';
import {
  yaslandirmaAdayi, yasKovasi, gecikmeGunu, KOVA_ADLARI, type KovaAdi,
} from '../muhasebe/arYaslandirma';

/** Yaşlandırma/alacak yüzeylerinin GERÇEKTEN okuduğu alanlar. */
export interface VadeSiparisi {
  totalPrice?: unknown;
  totalAmount?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
  /** Faturası Mikro'ya kesilmiş sipariş — sayfadaki mevcut davranışta yine listelenir (bkz. başlık, fark 4). */
  faturali?: boolean;
}

/** Bir yaş kovası — kart sırası ve etiketleri sayfadakiyle birebir. */
export interface VadeKovasi {
  ad: KovaAdi;
  /** Sayfadaki `label` (dar kart): '0–30' | '31–60' | '61–90' | '90+'. */
  etiket: string;
  /** Sayfadaki `labelTR`: '0–30 gün' … '90+ gün'. */
  etiketTR: string;
  /** Kovadaki sipariş SAYISI — tutarı bilinmeyen kayıt da sayılır (gecikme gerçektir). */
  adet: number;
  /** Kovanın tutarı: bilinen kısmi toplam + bilinen/bilinmeyen sayaçları (`kovaTutari` ile ekrana). */
  tutar: Tutar;
}

export interface OdenmemisOzet {
  /** KPI "Alacak Toplam" — TÜM ödenmemişler (tarihi çözülemeyenler DAHİL). Ekrana `ekranTutari`. */
  toplam: Tutar;
  /** Ödenmemiş sipariş adedi (KPI alt yazısı). */
  adet: number;
  /** Kovalar, kart sırasıyla: 0–30, 31–60, 61–90, 90+. */
  kovalar: VadeKovasi[];
  /** Kovalara giren (tarihi çözülebilen) sipariş adedi — yaşlandırma başlığındaki rozet. */
  yaslandirilanAdet: number;
  /** Vade/yaş günü okunamayan ödenmemiş sipariş — hiçbir kovaya düşmez, ayrı gösterilir. */
  tarihsiz: number;
  /** 31 gün ve üzeri kovalarda kayıt var mı (sayfadaki `hasOld`: kırmızı çerçeve + otomatik açılım). */
  eskiVar: boolean;
}

const KOVA_ETIKET: Readonly<Record<KovaAdi, { etiket: string; etiketTR: string }>> = {
  b0_30: { etiket: '0–30', etiketTR: '0–30 gün' },
  b31_60: { etiket: '31–60', etiketTR: '31–60 gün' },
  b61_90: { etiket: '61–90', etiketTR: '61–90 gün' },
  b90p: { etiket: '90+', etiketTR: '90+ gün' },
};

/**
 * Alacak sayılan siparişler: ödenmemiş, iptal değil, ödemesi Cetpa'da izlenen (Mikro kaynaklı
 * DEĞİL — orada `paid` yokluğu "bilinmiyor"dur, bkz. siparis.ts `odemeTakipli`).
 * Sayfa 542 süzgecinin tek kaynağı; faturalı kayıt bilerek DIŞLANMAZ (bkz. başlık, fark 4).
 */
export function odenmemisSiparisler<T extends VadeSiparisi>(siparisler: readonly T[]): T[] {
  return siparisler.filter(o => yaslandirmaAdayi(o, { faturaliHaric: false }));
}

/**
 * Phase 522 KPI şeridi + Phase 521 yaşlandırma kovalarının TEK hesabı.
 * `bugun` enjekte edilir (test belirlenimci olsun; sayfa `new Date()` geçer).
 */
export function odenmemisOzeti<T extends VadeSiparisi>(
  siparisler: readonly T[],
  bugun: Date = new Date(),
): OdenmemisOzet {
  const acik = odenmemisSiparisler(siparisler);
  const toplam = toplaBilinen(acik, siparisTutari);

  const gruplar = new Map<KovaAdi, T[]>(KOVA_ADLARI.map(ad => [ad, [] as T[]]));
  let tarihsiz = 0;
  for (const o of acik) {
    const gun = gecikmeGunu(o, bugun);
    // Tarihi çözülemeyen kayıt BUGÜNE düşürülmez (zaman.ts tuzağı) ve 0–30 kovasına da girmez.
    if (gun === null) { tarihsiz++; continue; }
    gruplar.get(yasKovasi(gun))!.push(o);
  }

  const kovalar: VadeKovasi[] = KOVA_ADLARI.map(ad => {
    const liste = gruplar.get(ad) ?? [];
    return { ad, ...KOVA_ETIKET[ad], adet: liste.length, tutar: toplaBilinen(liste, siparisTutari) };
  });

  return {
    toplam,
    adet: acik.length,
    kovalar,
    yaslandirilanAdet: acik.length - tarihsiz,
    tarihsiz,
    eskiVar: kovalar.slice(1).some(k => k.adet > 0),
  };
}

/**
 * Bir kovanın EKRAN tutarı — para.ts `ekranTutari` sözleşmesi: kovada hiç bilinen yokken NaN
 * (paraYaz '—'), kısmi bilinmeyende kısmi toplam (sayfa "N kayıt tutarsız" notu koyar).
 * Türetme (oran/marj) değildir; bkz. para.ts `tamTutar` ayrımı.
 */
export function kovaTutari(k: Pick<VadeKovasi, 'tutar'>): number {
  return ekranTutari(k.tutar);
}
