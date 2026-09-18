/**
 * nakitBilanco.ts — Muhasebe → "Nakit Akışı" + "Phase 547: Bilanço" HESAPLARI, saf. TEK KAYNAK.
 * Sözleşme: nakitBilanco.test.ts (önce yazıldı). Faz 3 1/n (2026-09-13): MuhasebePage kapatma.
 *
 * NEDEN VAR — sayfadaki sahte kesinlik (MuhasebePage.tsx, satırlar yaklaşık):
 *   Nakit Akışı  ~1561  inflow  `+= o.totalPrice || 0`            → tutarı bilinmeyen ödenmiş sipariş 0 girişti
 *                ~1568  COGS    `(li.costPrice ?? 0) * li.quantity` → maliyeti bilinmeyen kalem 0 maliyet;
 *                                                                    quantity yoksa NaN sessizce aya karışıyordu
 *                        tarihsiz sipariş sessizce düşüyordu (sayılmıyordu)
 *   Bilanço 547  ~1680  ar547   `o.totalPrice||o.totalAmount||0`  → 0'a düşen tutar "alacak yok" oldu
 *                ~1686  stok547 `(i.stockLevel||0) * itemCostTRY`  → adet ya da maliyet yoksa 0 (itemCostTRY
 *                                                                    kur/maliyet yokken 0 döner, cost.ts notu)
 *                ~1690  ap547   `po.totalAmount||0`
 *                ~1697  kdv547  `o.faturali && o.kdvTutari` süzgeci bilinmeyen KDV'yi SESSİZCE ATIYORDU
 * Kural (CLAUDE.md, Faz 1): bilinmeyen tutar 0 DEĞİL BİLİNMİYOR — toplama girmez, `bilinmeyen` SAYILIR,
 * ekranda '—' ya da "N kayıt tutarsız" notu. Sayısal iş burada; UI/JSX sayfada kalır.
 *
 * Toplamlar `Tutar` (kdvAylik: toplam + bilinen + bilinmeyen) taşır; sayfa `ekranTutari` ile basar —
 * HİÇ bilinen kayıt yokken ama bilinmeyen varken '—' (hakem turu: eskiden '₺0*' basılıyordu).
 *
 * Kur çevirimi: `dovizTopla` döviz→TL çevirir — currency.ts `tlyeCevir` (kurCevir'in tersi, tek kaynak);
 * kur yoksa kayıt ATLANIR ve sayılır (`kurYok`) — uydurma kur yok (bkz. kur-yoksa-uydurma kararı).
 * Sipariş tutarı: siparis.ts `siparisTutari` (`totalPrice ?? totalAmount`, sunucuyla aynı; tek kaynak).
 *
 * BİLİNEN SINIR (hakem turu, Açık İşler): `ticariAlacak`/`ticariBorc` "Mikro cari toplamı yüklenmemişse
 * bilinmeyen +1" yolunu DESTEKLER, ama MuhasebePage `cariBalanceToplam`'ı `{ar:0, ap:0}` ile başlatıp hata
 * dalında da aynı değere döndüğü için sayfadan bu yol şu an TETİKLENMİYOR — snapshot gelene kadar Mikro
 * alacak/borç ₺0 görünür. Düzeltme, state'i null başlatmak (6 başka paneli de değiştirir) — ayrı tur.
 * Okunamayan cari bakiye DOKÜMANI sayısı (`cariBakiyeToplamlari.bilinmeyen`) ise `bilanco`'ya
 * `cariBilinmeyen` olarak geçer ve tabloya "N kayıt tutarsız" diye yansır (AR/AP yönü bilinmediğinden
 * satıra değil, tablo sayacına girer — iki satıra yazmak çift sayardı).
 */
import { bilinenSayi, toplaBilinen, satirTutari, type Tutar, tamTutar } from '../para';
import { odemeTakipli, siparisTutari } from '../siparis';
import { ayAnahtari } from '../zaman';
import { tlyeCevir } from '../currency';

/** kdvAylik `Tutar` ile aynı şekil (toplam + bilinen + bilinmeyen) — dışarıya bu adla açık kalır. */
export type Toplam = Tutar;

const sayi = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);
const bos = (): Toplam => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
const ekle = (a: Toplam, b: Toplam): Toplam => ({ toplam: a.toplam + b.toplam, bilinen: a.bilinen + b.bilinen, bilinmeyen: a.bilinmeyen + b.bilinmeyen });

// ── Nakit Akışı ───────────────────────────────────────────────────────────────────────────────

export interface NakitKalemi { costPrice?: unknown; quantity?: unknown }
export interface NakitSiparisi {
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
  /** Bilinçli `unknown`: alan hiç yoksa siparişin maliyeti BİLİNMİYOR (0 değil). */
  lineItems?: unknown;
}

export interface NakitAyi {
  key: string;
  /** Ödenmiş-takipli siparişlerin tutarı; `bilinmeyen` = tutarı bilinmeyen ödenmiş sipariş (girişe 0 girmedi). */
  giris: Toplam;
  /** Kalem maliyetleri; `bilinmeyen` = maliyeti/adedi bilinmeyen kalem + lineItems'ı olmayan sipariş (çıkışa 0 girmedi). */
  cikis: Toplam;
  /** tamTutar(giris) − tamTutar(cikis): bir taraf KISMİ bile bilinmiyorsa NaN ('—' + not — kısmi giriş − tam çıkış net değildir); hareketsiz ay gerçek 0. */
  net: number;
}

export interface NakitAkisi {
  aylar: NakitAyi[];
  toplamGiris: Toplam;
  toplamCikis: Toplam;
  /** tamTutar(toplamGiris) − tamTutar(toplamCikis) — türetme kapısı (para.ts). */
  toplamNet: number;
  /** İptal olmayan ama tarihi çözülemeyen sipariş sayısı — hiçbir aya girmedi. */
  tarihsiz: number;
  /** Grafik ölçeği: ayların en büyük bilinen giriş/çıkış toplamı, en az 1 (sıfıra bölme yok). */
  enBuyuk: number;
}

/** Son `adet` ayın 'YYYY-MM' anahtarları, eski→yeni. Ay sonu taşması yok (her ayın 1'i alınır). */
export function sonAyAnahtarlari(adet: number, simdi: Date = new Date()): string[] {
  const anahtarlar: string[] = [];
  for (let i = adet - 1; i >= 0; i--) {
    const k = ayAnahtari(new Date(simdi.getFullYear(), simdi.getMonth() - i, 1));
    if (k) anahtarlar.push(k);
  }
  return anahtarlar;
}

/** Sipariş kalemlerinin maliyet toplamı; bilinmeyen kalemler sayılır. `lineItems` dizi değilse tümü bilinmeyen. */
function siparisMaliyeti(lineItems: unknown): Toplam {
  if (!Array.isArray(lineItems)) return { toplam: 0, bilinen: 0, bilinmeyen: 1 };
  return toplaBilinen(lineItems as readonly NakitKalemi[], li => satirTutari(li?.costPrice, li?.quantity));
}

/**
 * Aylık nakit akışı. Giriş: ödenmiş + iptal olmayan + Cetpa-takipli (Mikro kaynaklı kayıtta `paid`
 * anlamsızdır, bkz. siparis.ts) siparişlerin tutarı. Çıkış: iptal olmayan tüm siparişlerin kalem
 * maliyeti (gider vekili — sayfadaki yaklaşım korunur). Ay: createdAt → syncedAt (sayfadaki sıra).
 */
export function nakitAkisi(siparisler: readonly NakitSiparisi[], adet = 6, simdi: Date = new Date()): NakitAkisi {
  const aylar = new Map<string, { giris: Toplam; cikis: Toplam }>();
  for (const key of sonAyAnahtarlari(adet, simdi)) aylar.set(key, { giris: bos(), cikis: bos() });
  let tarihsiz = 0;
  for (const o of siparisler) {
    if (o.status === 'Cancelled') continue;
    const key = ayAnahtari(o.createdAt) ?? ayAnahtari(o.syncedAt);
    if (!key) { tarihsiz++; continue; }
    const ay = aylar.get(key);
    if (!ay) continue; // pencere dışı
    if (o.paid && odemeTakipli(o)) ay.giris = ekle(ay.giris, toplaBilinen([o], x => x.totalPrice));
    ay.cikis = ekle(ay.cikis, siparisMaliyeti(o.lineItems));
  }
  let toplamGiris = bos(), toplamCikis = bos(), enBuyuk = 1;
  const liste: NakitAyi[] = [];
  for (const [key, a] of aylar) {
    liste.push({ key, giris: a.giris, cikis: a.cikis, net: tamTutar(a.giris) - tamTutar(a.cikis) });
    toplamGiris = ekle(toplamGiris, a.giris); toplamCikis = ekle(toplamCikis, a.cikis);
    enBuyuk = Math.max(enBuyuk, a.giris.toplam, a.cikis.toplam);
  }
  return { aylar: liste, toplamGiris, toplamCikis, toplamNet: tamTutar(toplamGiris) - tamTutar(toplamCikis), tarihsiz, enBuyuk };
}

// ── Bilanço (Phase 547) ───────────────────────────────────────────────────────────────────────

export interface DovizToplami extends Toplam {
  /** Birimi bilinip KURU olmayan kayıt sayısı — toplama girmedi (bilinen'e de girmedi), kur gelince düzelir. */
  kurYok: number;
  /** Kuru eksik birimler (sıralı, tekil) — "USD/EUR kuru bulunamadı" demek için. */
  birimler: string[];
}

/**
 * Döviz tutarlarını TL toplar. Sıra: tutar bilinmiyorsa `bilinmeyen`; birim yok/TRY ise aynen;
 * kur yok/0/negatif/NaN ise `kurYok` (uydurma kur YOK). Çeviri currency.ts `tlyeCevir` (tek kaynak).
 */
export function dovizTopla<T>(
  kayitlar: readonly T[],
  tutar: (x: T) => unknown,
  birim: (x: T) => unknown,
  kurlar: Readonly<Record<string, number>> | null | undefined,
): DovizToplami {
  let toplam = 0, bilinen = 0, bilinmeyen = 0, kurYok = 0;
  const eksik = new Set<string>();
  for (const x of kayitlar) {
    const v = sayi(tutar(x));
    if (!Number.isFinite(v)) { bilinmeyen++; continue; }
    const b = birim(x);
    const kod = typeof b === 'string' ? b : undefined;
    const tl = tlyeCevir(v, kod, kurlar);
    if (tl === null) { kurYok++; eksik.add(String(kod)); continue; } // v sonlu → null yalnız "kur yok" demektir
    toplam += tl; bilinen++;
  }
  return { toplam, bilinen, bilinmeyen, kurYok, birimler: [...eksik].sort() };
}

/** Bilinen bir tutara bilinmeyen-olabilecek dış toplamı (Mikro cari) ekler; yüklenmemişse sayar. */
function disToplamEkle(t: Toplam, dis: unknown): Toplam {
  const d = sayi(dis);
  return Number.isFinite(d)
    ? { toplam: t.toplam + d, bilinen: t.bilinen + 1, bilinmeyen: t.bilinmeyen }
    : { toplam: t.toplam, bilinen: t.bilinen, bilinmeyen: t.bilinmeyen + 1 };
}

export interface AlacakSiparisi { totalPrice?: unknown; totalAmount?: unknown; paid?: boolean; status?: string; source?: string }

/**
 * Ticari alacaklar: ödenmemiş + iptal olmayan + Cetpa-takipli siparişler (tutar: siparis.ts `siparisTutari`,
 * `totalPrice ?? totalAmount` — meşru 0 tutar 0 kalır) + Mikro cari alacak toplamı.
 * `mikroAr` null/undefined/NaN ise 0 DEĞİL — bilinmeyen +1 (sayfa şu an hep sonlu geçiyor; bkz. başlık).
 */
export function ticariAlacak(siparisler: readonly AlacakSiparisi[], mikroAr: unknown): Toplam {
  const acik = siparisler.filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o));
  return disToplamEkle(toplaBilinen(acik, siparisTutari), mikroAr);
}

export interface StokKalemi { stockLevel?: unknown }

/**
 * Stok değeri MALİYETLE (TMS 2): adet × TL maliyet. `maliyetTL` çağıranın seçicisi — kur yoksa,
 * maliyet alanı yoksa ya da birim tanınmıyorsa `null` döndürmeli (cost.ts `maliyetDurumu` ile;
 * `itemCostTRY` bu durumlarda 0 döndüğü için DOĞRUDAN kullanılmaz). Adet ya da maliyet bilinmiyorsa
 * kalem toplama girmez, sayılır.
 */
export function stokDegeri<T extends StokKalemi>(kalemler: readonly T[], maliyetTL: (k: T) => number | null): Toplam {
  return toplaBilinen(kalemler, k => satirTutari(maliyetTL(k), k.stockLevel));
}

export interface SabitKiymet { cost?: unknown; depreciation?: unknown }

/** Sabit kıymet net değeri: max(0, maliyet − birikmiş amortisman); ikisinden biri bilinmiyorsa sayılır. */
export function duranVarlik(kiymetler: readonly SabitKiymet[]): Toplam {
  return toplaBilinen(kiymetler, fa => {
    const c = sayi(fa.cost), d = sayi(fa.depreciation);
    return Number.isFinite(c) && Number.isFinite(d) ? Math.max(0, c - d) : NaN;
  });
}

export interface AlisSiparisi { totalAmount?: unknown; status?: string }
const KAPALI_ALIS_DURUMLARI: ReadonlySet<string> = new Set(['Teslim Alındı', 'İptal Edildi']);

/** Ticari borçlar: kapanmamış alış siparişleri + Mikro cari borç toplamı (null/NaN ise bilinmeyen +1). */
export function ticariBorc(alislar: readonly AlisSiparisi[], mikroAp: unknown): Toplam {
  const acik = alislar.filter(po => !KAPALI_ALIS_DURUMLARI.has(po.status ?? ''));
  return disToplamEkle(toplaBilinen(acik, po => po.totalAmount), mikroAp);
}

export interface KdvSiparisi { faturali?: boolean; kdvTutari?: unknown }
export interface KdvFaturasi { tarih?: unknown; yon?: unknown; kdv?: unknown }
export interface KdvBorcu extends Toplam {
  /** Cari ayın Mikro net KDV'si (giden − gelen); negatifse devreden — borca 0 olarak girer. */
  mikroNet: number;
}

/**
 * KDV borcu = faturalı siparişlerin KDV'si + max(0, cari ay Mikro giden−gelen KDV). Dönemsel kalem:
 * yalnız `ay` ('YYYY-MM') içindeki faturalar (sayfadaki 2026-08-13 düzeltmesi korunur).
 * Faturalı olup KDV tutarı bilinmeyen sipariş 0 DEĞİL — sayılır (eski `&& o.kdvTutari` süzgeci atıyordu).
 * ÜST AKIŞ DÜZELDİ (Faz 3 2/n, 2026-09-18): useMikroFaturalar `kdv`yi 0'a zorlamıyor ve sunucudaki
 * ISNULL(…, 0) son yedeği kalktı — Mikro faturasından gelen bilinmeyen KDV buraya ULAŞIR ve sayılır.
 * (2026-09-18 öncesi import edilmiş dokümanlardaki bayat ₺0'ı da hook'taki koruma yakalar; kesin
 * çözüm tam yeniden import.)
 */
export function kdvBorcu(siparisler: readonly KdvSiparisi[], faturalar: readonly KdvFaturasi[], ay: string): KdvBorcu {
  const s = toplaBilinen(siparisler.filter(o => o.faturali === true), o => o.kdvTutari);
  let mikroNet = 0, bilinenFatura = 0, bilinmeyenFatura = 0;
  for (const f of faturalar) {
    if (typeof f.tarih !== 'string' || !f.tarih.startsWith(ay)) continue;
    const k = sayi(f.kdv);
    if (!Number.isFinite(k)) { bilinmeyenFatura++; continue; }
    bilinenFatura++;
    mikroNet += f.yon === 'giden' ? k : -k;
  }
  return { toplam: s.toplam + Math.max(0, mikroNet), bilinen: s.bilinen + bilinenFatura, bilinmeyen: s.bilinmeyen + bilinmeyenFatura, mikroNet };
}

export interface BilancoGirdisi {
  kasa: Toplam; banka: Toplam; alacak: Toplam; stok: Toplam; duranVarlik: Toplam;
  borc: Toplam; kdv: Toplam;
  /**
   * Mikro cari havuzunda OKUNAMAYAN bakiye dokümanı sayısı (finansalOranlar `cariBakiyeToplamlari.bilinmeyen`).
   * AR mı AP mi bilinmediğinden hiçbir satıra girmez; yalnız tablo sayacına (`bilinmeyen`) eklenir.
   */
  cariBilinmeyen?: number;
}
export interface BilancoOzeti {
  /** Aktif kalemlerin toplamı + bilinen/bilinmeyen sayaçları (ekranTutari ile basılır). */
  aktif: Toplam;
  /** Borç kalemlerinin (ticari borç + KDV) toplamı + sayaçları. */
  borc: Toplam;
  /** Fark kalemi: tamTutar(aktif) − tamTutar(borc) — bir kalem bile bilinmiyorsa NaN ('—' + "N kayıt tutarsız"): eksik aktifle özkaynak yanlış olurdu. */
  ozkaynak: number;
  /** tamTutar(borc) + ozkaynak — sonluysa Aktif = Pasif her zaman sağlanır. */
  toplamPasif: number;
  /** Tüm kalemlerin bilinen sayaçları toplamı. */
  bilinen: number;
  /** Tüm kalemlerin bilinmeyen sayaçları + `cariBilinmeyen`; > 0 ise ekranda "N kayıt tutarsız" notu. */
  bilinmeyen: number;
}

/** Aktif/Pasif toplamları; girdilerin bilinen/bilinmeyen sayaçları toplanır. */
export function bilanco(g: BilancoGirdisi): BilancoOzeti {
  const aktif = [g.kasa, g.banka, g.alacak, g.stok, g.duranVarlik].reduce(ekle, bos());
  const borc = ekle(g.borc, g.kdv);
  const ozkaynak = tamTutar(aktif) - tamTutar(borc);
  const cari = Number.isFinite(g.cariBilinmeyen) && (g.cariBilinmeyen ?? 0) > 0 ? Number(g.cariBilinmeyen) : 0;
  return {
    aktif, borc, ozkaynak,
    toplamPasif: tamTutar(borc) + ozkaynak,
    bilinen: aktif.bilinen + borc.bilinen,
    bilinmeyen: aktif.bilinmeyen + borc.bilinmeyen + cari,
  };
}
