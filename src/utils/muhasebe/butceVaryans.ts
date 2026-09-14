/**
 * butceVaryans.ts — MuhasebePage'in dört bütçe/KDV panelinin HESAPLARI, tek kaynak (Faz 3 1/n, 2026-09-13).
 * Test: butceVaryans.test.ts (ÖNCE yazıldı).
 *
 *   • Phase 580 Bütçe vs Gerçekleşen          (MuhasebePage ~3107-3212)  → butceGercekYili
 *   • Phase 617 KDV Mutabakat                 (~3381-3464)               → kdvMutabakat
 *   • Phase 625 Gelir/Gider Bütçe Karşılaştırma (~3466-3556)             → gelirButceYili
 *   • Phase 634 Varyans Analizi               (~3558-3639)               → varyansAnalizi
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK):
 *   ~3131/3481  reduce(o.totalPrice || 0)            tutarı bilinmeyen sipariş ciroya 0 giriyordu
 *   ~3135/3485  reduce(f.tutar || 0)                 tutarı bilinmeyen Mikro faturası 0 sayılıyordu
 *   ~3143       reduce(b.budgetTRY || 0)             değeri okunamayan bütçe kalemi 0 görünüyordu
 *   ~3147/3187  bud > 0 ? act/bud*100 : 0            bütçesiz ay "%0 gerçekleşme" (hiç bütçenin %0'ı)
 *   ~3402       reduce(Number(totalPrice) || 0)      faturasız satışta bilinmeyen 0
 *   ~3403-3405  düz reduce(f.tutar/matrah/kdv)       NaN yayılır (hook `|| 0` yaptığı için çoğu kez 0)
 *   ~3512       budgetMap[i]?.budgetRevenue || 0     okunamayan gelir bütçesi 0
 *   ~3593       actualCogs || revenue*0.48           SMM bilinmiyorsa cironun %48'i UYDURULUYORDU
 *
 * Kural: bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`Toplam.bilinmeyen`); ekran
 * para.ts `ekranTutari` TEK sözleşmesiyle basılır (hiç bilinen yoksa '—', aksi hâlde kısmi toplam +
 * "N kayıt tutarsız" notu — 2026-09-14 hakem turu: buradaki katı `ekranToplami` kopyası aynı ay gelirini
 * Kâr/Zarar'da kısmi, bütçede '—' gösteriyordu, silindi). TÜRETME (oran/fark/sapma/brüt kâr/FAVÖK/simüle
 * bütçe) ise iki taraf da tam bilinmeden hesaplanmaz (null/NaN) — kısmi toplamdan sapma üretilmez. Bu grupta kur çevirimi YOK: KPI kartı `kisaTutar(…, { rates })`
 * ile basılır, kur yoksa o zaten '—' döner.
 *
 * KOPYA YOK: aylık "native faturasız sipariş + Mikro giden fatura" geliri ve satır maliyeti
 * `karZarar.ayKarZarar`'dan (sayfada 580/625/634 üç kez elle yazılmıştı); toplama `para.toplaBilinen`;
 * ay anahtarı `zaman.gunAnahtari` (tarih-only string YEREL gün — bkz. karZarar'daki not).
 *
 * SAYFA PARİTESİ ve bilinçli farklar:
 *   • İptal (`status === 'Cancelled'`) dışarıda; native gelire `faturali`/`hasInvoice`/Mikro-kaynaklı
 *     (`source` 'mikro…') sipariş GİRMEZ — geliri `mikroFaturalar` "giden"de zaten sayılır (çift sayım).
 *     580/625/634 sayfada yalnız `faturali`ye bakıyordu; 617 `faturali ?? hasInvoice`. Burada 617 için
 *     üçü birden, 580/625/634 için ayKarZarar'ın kuralı (`faturali === true || source === 'mikro-fatura'`).
 *   • 617 sipariş ayı: `createdAt`, yoksa `syncedAt` (sayfadaki sıra). 580/625/634: `createdAt` (ayKarZarar).
 *   • 617 karma-oranlı bant: `oran` NULL — sayfa ilk faturanın oranını taşıyordu; %10+%20 karışımına
 *     "%20" demek sahte kesinliktir. Etiket zaten `oranKarma`dan.
 *   • 634 "bütçe" tarafı sayfadaki gibi SİMÜLASYON (ciro×1,15 / ×0,55 / ×0,20; OPEX gerçekleşen ×0,18) —
 *     katsayılar `VARYANS_VARSAYIMLARI`'nda açık, sonuçta `butceVarsayimsal: true` bayrağı; kaldırmak
 *     ürün kararı. `%48 SMM` yedeği ise KALDIRILDI: satır maliyeti bilinmiyorsa SMM/brüt kâr/FAVÖK '—'.
 *   • 634 "bu ay" penceresi sayfada `şimdi`ye kadar, burada ayın tamamı (ayKarZarar) — createdAt
 *     oluşturma anı olduğundan gelecek tarihli kayıt pratikte yok.
 *
 * Girdi tipleri MİNİMAL ve yapısal (`Order`/`MikroFatura`'ya bağlı DEĞİL) — yerel daraltılmış tipler de
 * uyar; yarım-düzeltme sınıfı (bkz. siparis.ts) tekrarlanmasın.
 */
import { bilinenSayi, toplaBilinen, ekranTutari, tamTutar, tutarBirlestir, type Tutar } from '../para';
import { ayKarZarar, ayAnahtariYerel, type KzFatura, type KzSiparis } from './karZarar';

export type { KzFatura, KzSiparis } from './karZarar';
/** para.ts `Tutar` (toplam + bilinen + bilinmeyen sayaçları) — karZarar ile aynı şekil; ekran `ekranTutari`. */
export type Toplam = Tutar;

const AYLAR: readonly number[] = Array.from({ length: 12 }, (_, i) => i);

// 'YYYY-MM' YEREL ay anahtarı karZarar `ayAnahtariYerel` (tek yer; tarih-only string UTC'ye kaymasın).
const ayKodu = (yil: number, ay: number): string => `${yil}-${String(ay + 1).padStart(2, '0')}`;

const topla = toplaBilinen;
const birlestir = tutarBirlestir;
/** Türetme kapısı para.ts `tamTutar` (bir kayıt bile bilinmiyorsa NaN); `fark`/`gerceklesmeOrani` aynı kuralı null ile uygular. */
const tamToplam = tamTutar;
/** Tek sayı → Toplam: null = kalem yok (bütçesiz, {0,0,0}); NaN = okunamıyor (1 bilinmeyen); sayı = 1 bilinen. */
const sayidan = (n: number | null): Toplam =>
  n === null ? { toplam: 0, bilinen: 0, bilinmeyen: 0 } : Number.isFinite(n) ? { toplam: n, bilinen: 1, bilinmeyen: 0 } : { toplam: 0, bilinen: 0, bilinmeyen: 1 };
/**
 * Bütçesi olan ay: en az bir kalem okunmuş ya da okunamamış. Kalemsiz ay BÜTÇESİZDİR — fark/oran hesaplanmaz
 * ('—'); eskiden ₺0 bütçe sayılıp "+₺450.000 fark / %∞" ve yıl toplamında "12 aylık ciro − 3 aylık bütçe"
 * basılıyordu (2026-09-14 hakem turu). Yıl farkı/oranı yalnız bütçeli ayların toplamından.
 */
const butceli = (b: Toplam): boolean => b.bilinen > 0 || b.bilinmeyen > 0;

// ── 580 / 625 / 634 ortak: yılın 12 ayının gerçekleşen geliri ───────────────────────────────

/** 12 ay × Toplam: native faturasız (iptal dışı) sipariş + Mikro giden fatura (ayKarZarar). */
export function yillikGerceklesen(siparisler: readonly KzSiparis[], faturalar: readonly KzFatura[], yil: number): Toplam[] {
  return AYLAR.map(ay => {
    const k = ayKarZarar(siparisler, faturalar, new Date(yil, ay, 1));
    return { toplam: k.gelir, bilinen: k.gelirBilinen, bilinmeyen: k.gelirBilinmeyen };
  });
}

/** Gerçekleşen − bütçe; iki taraftan biri eksikse null. */
export function fark(gerceklesen: Toplam, butce: Toplam): number | null {
  if (gerceklesen.bilinmeyen > 0 || butce.bilinmeyen > 0) return null;
  return gerceklesen.toplam - butce.toplam;
}

/** Gerçekleşme yüzdesi; bütçe ≤ 0 ya da bir taraf eksikse null (eski kod "%0" basıyordu). */
export function gerceklesmeOrani(gerceklesen: Toplam, butce: Toplam): number | null {
  if (fark(gerceklesen, butce) === null || !(butce.toplam > 0)) return null;
  return (gerceklesen.toplam / butce.toplam) * 100;
}

// ── Phase 580: Bütçe vs Gerçekleşen ────────────────────────────────────────────────────────

export interface ButceKalemi { budgetTRY?: unknown }

/** 12 ay × bütçe toplamı — `butceler['YYYY-MM']` kalemlerinden; değeri okunamayan kalem SAYILIR. */
export function yillikButce(butceler: Readonly<Record<string, readonly ButceKalemi[] | undefined>>, yil: number): Toplam[] {
  return AYLAR.map(ay => topla(butceler[ayKodu(yil, ay)] ?? [], b => b.budgetTRY));
}

export interface ButceAyi { ay: number; butce: Toplam; gerceklesen: Toplam; fark: number | null; oran: number | null }
export interface ButceGercekYili {
  aylar: ButceAyi[];
  /** Tüm yıl (KPI kartları). */
  toplamButce: Toplam;
  toplamGerceklesen: Toplam;
  /** YALNIZ bütçeli ayların gerçekleşen − bütçe toplamı; bütçeli ay yoksa null. */
  fark: number | null;
  oran: number | null;
  /** Bütçesi girilen ay sayısı — 12'den azsa sayfa "fark/oran N ay için" notu düşer. */
  butceliAyAdedi: number;
  /** Yıl için en az bir bütçeli ay var (okunamayan ya da ₺0 girilmiş kalem de "var" — "tanımlanmamış" uyarısı basılmaz; `butceli` ile aynı kural). */
  butceVar: boolean;
}

export function butceGercekYili(
  siparisler: readonly KzSiparis[],
  faturalar: readonly KzFatura[],
  butceler: Readonly<Record<string, readonly ButceKalemi[] | undefined>>,
  yil: number,
): ButceGercekYili {
  const butce = yillikButce(butceler, yil);
  const ger = yillikGerceklesen(siparisler, faturalar, yil);
  const aylar = AYLAR.map(ay => ({
    ay, butce: butce[ay], gerceklesen: ger[ay],
    fark: butceli(butce[ay]) ? fark(ger[ay], butce[ay]) : null,
    oran: butceli(butce[ay]) ? gerceklesmeOrani(ger[ay], butce[ay]) : null,
  }));
  const toplamButce = birlestir(...butce);
  const toplamGerceklesen = birlestir(...ger);
  const butceliAylar = AYLAR.filter(ay => butceli(butce[ay]));
  const bButce = birlestir(...butceliAylar.map(ay => butce[ay])), bGer = birlestir(...butceliAylar.map(ay => ger[ay]));
  return {
    aylar,
    toplamButce,
    toplamGerceklesen,
    fark: butceliAylar.length ? fark(bGer, bButce) : null,
    oran: butceliAylar.length ? gerceklesmeOrani(bGer, bButce) : null,
    butceliAyAdedi: butceliAylar.length,
    butceVar: butceliAylar.length > 0,
  };
}

// ── Phase 617: KDV Mutabakat ────────────────────────────────────────────────────────────────

export interface KdvFaturasi { yon?: string; tarih?: unknown; tutar?: unknown; matrah?: unknown; kdv?: unknown; oran?: number | null; oranKarma?: boolean }
export interface KdvSiparisi {
  totalPrice?: unknown; status?: string; source?: string; faturali?: boolean; hasInvoice?: boolean; createdAt?: unknown; syncedAt?: unknown;
}

/** Geliri Mikro faturasında sayılan sipariş — faturasız (KDV'siz) banda GİRMEZ. */
const faturaliMi = (o: KdvSiparisi): boolean => o.faturali === true || o.hasInvoice === true || (o.source ?? '').startsWith('mikro');
const siparisAyi = (o: KdvSiparisi): string | null => ayAnahtariYerel(o.createdAt) ?? ayAnahtariYerel(o.syncedAt);

/** Seçili ayın ('YYYY-MM') Mikro GİDEN (satış) faturaları. */
export function donemFaturalari<T extends KdvFaturasi>(faturalar: readonly T[], ay: string): T[] {
  if (!ay) return [];
  return faturalar.filter(f => f.yon === 'giden' && ayAnahtariYerel(f.tarih) === ay);
}

/** Seçili ayın faturasız Cetpa satışları: iptal değil, faturalı/hasInvoice/Mikro-kaynaklı değil. */
export function donemFaturasizSiparisler<T extends KdvSiparisi>(siparisler: readonly T[], ay: string): T[] {
  if (!ay) return [];
  return siparisler.filter(o => o.status !== 'Cancelled' && !faturaliMi(o) && siparisAyi(o) === ay);
}

export interface KdvBandi {
  /** '20' | '10' | '0' | … | 'karma' | 'bilinmiyor' */
  anahtar: string;
  /** Tek oran; karma/bilinmiyor bandında null (tek oran uydurulmaz). */
  oran: number | null;
  oranKarma: boolean;
  matrah: Toplam;
  kdv: Toplam;
  adet: number;
  /** Matrahı YA DA KDV'si bilinmeyen fatura sayısı (satır notu) — `Math.max(matrah.bilinmeyen, kdv.bilinmeyen)` ayrık kümelerde eksik sayıyordu. */
  tutarsiz: number;
}

/** Orana göre gruplar (veride hangi oran varsa), azalan oran; karma ve bilinmiyor sona. */
export function kdvBantlari(faturalar: readonly KdvFaturasi[]): KdvBandi[] {
  const gruplar = new Map<string, KdvFaturasi[]>();
  for (const f of faturalar) {
    const anahtar = f.oranKarma ? 'karma' : f.oran == null ? 'bilinmiyor' : String(f.oran);
    const g = gruplar.get(anahtar);
    if (g) g.push(f); else gruplar.set(anahtar, [f]);
  }
  const bantlar: KdvBandi[] = [...gruplar.entries()].map(([anahtar, liste]) => ({
    anahtar,
    oran: anahtar === 'karma' || anahtar === 'bilinmiyor' ? null : Number(anahtar),
    oranKarma: anahtar === 'karma',
    matrah: topla(liste, f => f.matrah),
    kdv: topla(liste, f => f.kdv),
    adet: liste.length,
    tutarsiz: liste.filter(f => !bilinenSayi(f.matrah) || !bilinenSayi(f.kdv)).length,
  }));
  return bantlar.sort((a, b) => (b.oran ?? -1) - (a.oran ?? -1));
}

export interface KdvMutabakatOzeti {
  faturaAdedi: number;
  faturasizAdedi: number;
  /** Faturasız satışlar (KDV=0 bandı). */
  faturasizTutar: Toplam;
  /** Fatura tutarları + faturasız satışlar. */
  ciro: Toplam;
  /** Fatura matrahları + faturasız satışlar (sayfa: faturasız tamamen matrah). */
  matrah: Toplam;
  /** Yalnız faturaların KDV'si. */
  kdv: Toplam;
  bantlar: KdvBandi[];
}

export function kdvMutabakat(faturalar: readonly KdvFaturasi[], siparisler: readonly KdvSiparisi[], ay: string): KdvMutabakatOzeti {
  const fl = donemFaturalari(faturalar, ay);
  const sl = donemFaturasizSiparisler(siparisler, ay);
  const faturasizTutar = topla(sl, o => o.totalPrice);
  return {
    faturaAdedi: fl.length,
    faturasizAdedi: sl.length,
    faturasizTutar,
    ciro: birlestir(topla(fl, f => f.tutar), faturasizTutar),
    matrah: birlestir(topla(fl, f => f.matrah), faturasizTutar),
    kdv: topla(fl, f => f.kdv),
    bantlar: kdvBantlari(fl),
  };
}

// ── Phase 625: Gelir/Gider Bütçe Karşılaştırması ───────────────────────────────────────────

export interface GelirButcesi { month?: unknown; budgetRevenue?: unknown }

/**
 * Ayın (0-11) gelir bütçesi. Kalem yok → 0 (girilmemiş = gerçek sıfır; sayfa zaten '—' basar).
 * Kalem var ama değer okunamıyor → NaN (eski `|| 0` bunu 0 gösteriyordu); kalem YOK → null (bütçesiz ay —
 * eskiden 0 dönüp yıl sapmasına "₺0 bütçe" olarak giriyordu). Aynı aya birden fazla kayıt varsa SON kazanır
 * (sayfadaki `forEach` üzerine yazma davranışı).
 */
export function aylikGelirButcesi(kalemler: readonly GelirButcesi[], ay: number): number | null {
  let kalem: GelirButcesi | undefined;
  for (const k of kalemler) if (Number(k.month) === ay) kalem = k;
  if (!kalem) return null;
  return bilinenSayi(kalem.budgetRevenue) ? Number(kalem.budgetRevenue) : NaN;
}

export interface GelirButceAyi {
  ay: number;
  /** TRY; NaN = kalem var ama değer okunamıyor; null = kalem yok (bütçesiz ay, sapma yok). */
  butce: number | null;
  gerceklesen: Toplam;
  sapma: number | null;
  /** Bütçeye göre sapma yüzdesi; bütçe ≤ 0 ya da bir taraf eksikse null. */
  sapmaYuzde: number | null;
}
export interface GelirButceYili {
  aylar: GelirButceAyi[];
  /** `bilinmeyen` = değeri okunamayan ay sayısı; `bilinen` = bütçesi okunan ay sayısı (kalemsiz ay sayılmaz). */
  toplamButce: Toplam;
  toplamGerceklesen: Toplam;
  /** YALNIZ bütçeli ayların sapması; bütçeli ay yoksa null (eskiden 12 aylık ciro − girilen aylar). */
  sapma: number | null;
  sapmaYuzde: number | null;
  butceliAyAdedi: number;
}

const sapmaHesabi = (gerceklesen: Toplam, butce: Toplam): { sapma: number | null; sapmaYuzde: number | null } => {
  const sapma = fark(gerceklesen, butce);
  return { sapma, sapmaYuzde: sapma !== null && butce.toplam > 0 ? (sapma / butce.toplam) * 100 : null };
};

export function gelirButceYili(
  siparisler: readonly KzSiparis[],
  faturalar: readonly KzFatura[],
  kalemler: readonly GelirButcesi[],
  yil: number,
): GelirButceYili {
  const ger = yillikGerceklesen(siparisler, faturalar, yil);
  const butceler = AYLAR.map(ay => aylikGelirButcesi(kalemler, ay));
  const bt = butceler.map(sayidan);
  const aylar = AYLAR.map(ay => ({ ay, butce: butceler[ay], gerceklesen: ger[ay], ...(butceli(bt[ay]) ? sapmaHesabi(ger[ay], bt[ay]) : { sapma: null, sapmaYuzde: null }) }));
  const toplamButce = birlestir(...bt);
  const toplamGerceklesen = birlestir(...ger);
  const butceliAylar = AYLAR.filter(ay => butceli(bt[ay]));
  const toplam = butceliAylar.length
    ? sapmaHesabi(birlestir(...butceliAylar.map(ay => ger[ay])), birlestir(...butceliAylar.map(ay => bt[ay])))
    : { sapma: null, sapmaYuzde: null };
  return { aylar, toplamButce, toplamGerceklesen, ...toplam, butceliAyAdedi: butceliAylar.length };
}

// ── Phase 634: Varyans Analizi ──────────────────────────────────────────────────────────────

export type VaryansDonemi = 'this_month' | 'last_month' | 'ytd';

/** Dönemin ay başları: bu ay → [1 gün], geçen ay → [1 gün], YTD → Ocak…bu ay. */
export function varyansAylari(donem: VaryansDonemi, simdi: Date = new Date()): Date[] {
  const y = simdi.getFullYear(), m = simdi.getMonth();
  if (donem === 'this_month') return [new Date(y, m, 1)];
  if (donem === 'last_month') return [new Date(y, m - 1, 1)];
  return Array.from({ length: m + 1 }, (_, i) => new Date(y, i, 1));
}

/** Sayfadaki "basit taban çizgisi" simülasyonu — GERÇEK bütçe değil; UI bunu etiketlemeli. */
export interface VaryansVarsayimlari {
  butceGelirKatsayisi: number;
  butceSmmOrani: number;
  butceOpexOrani: number;
  gerceklesenOpexOrani: number;
}
export const VARYANS_VARSAYIMLARI: Readonly<VaryansVarsayimlari> = Object.freeze({
  butceGelirKatsayisi: 1.15,
  butceSmmOrani: 0.55,
  butceOpexOrani: 0.20,
  gerceklesenOpexOrani: 0.18,
});

export type VaryansKalemi = 'gelir' | 'smm' | 'brutKar' | 'opex' | 'favok';
export interface VaryansSatiri {
  anahtar: VaryansKalemi;
  /** Simülasyon (bkz. VARYANS_VARSAYIMLARI); gelirde bilinmeyen kayıt varsa NaN (kısmi cirodan bütçe türetilmez). */
  butce: number;
  /** Gelir/SMM: para.ekranTutari (kısmi toplam; hiç bilinen yoksa NaN). Türetilen satırlar: bir girdi eksikse NaN. */
  gerceklesen: number;
  /** Yalnız gerçekleşen TAM bilinirken (kısmi toplamdan sapma üretilmez) ve bütçe sonluyken. */
  sapma: number | null;
  /** |bütçe|'ye göre; bütçe 0 ya da bir taraf eksikse null. */
  sapmaYuzde: number | null;
  /** Gelir/brüt kâr/FAVÖK: sapma ≥ 0 olumlu; SMM/OPEX: ≤ 0 olumlu. Sapma yoksa null. */
  olumlu: boolean | null;
  /** OPEX ve FAVÖK'ün gerçekleşeni de varsayımla türetilir (gerçek gider verisi yok). */
  gerceklesenVarsayimsal: boolean;
}
export interface VaryansAnalizi {
  aylar: Date[];
  gelir: Toplam;
  /** Satır maliyeti (Σ costPrice×quantity); satırsız/bilinmeyen sipariş SAYILIR (eski %48 yedeği yok). */
  smm: Toplam;
  satirlar: VaryansSatiri[];
  butceVarsayimsal: true;
}

const varyansSatiri = (anahtar: VaryansKalemi, butce: number, gerceklesen: number, gerceklesenVarsayimsal: boolean, gerceklesenTam = true): VaryansSatiri => {
  const sapma = gerceklesenTam && Number.isFinite(butce) && Number.isFinite(gerceklesen) ? gerceklesen - butce : null;
  const sapmaYuzde = sapma !== null && butce !== 0 ? (sapma / Math.abs(butce)) * 100 : null;
  const gelirTarafi = anahtar === 'gelir' || anahtar === 'brutKar' || anahtar === 'favok';
  const olumlu = sapma === null ? null : gelirTarafi ? sapma >= 0 : sapma <= 0;
  return { anahtar, butce, gerceklesen, sapma, sapmaYuzde, olumlu, gerceklesenVarsayimsal };
};

export function varyansAnalizi(
  siparisler: readonly KzSiparis[],
  faturalar: readonly KzFatura[],
  donem: VaryansDonemi,
  simdi: Date = new Date(),
  v: Readonly<VaryansVarsayimlari> = VARYANS_VARSAYIMLARI,
): VaryansAnalizi {
  const aylar = varyansAylari(donem, simdi);
  const donemAylari = aylar.map(a => ayKarZarar(siparisler, faturalar, a));
  const gelir = birlestir(...donemAylari.map(k => ({ toplam: k.gelir, bilinen: k.gelirBilinen, bilinmeyen: k.gelirBilinmeyen })));
  const smm = birlestir(...donemAylari.map(k => ({ toplam: k.maliyet, bilinen: k.maliyetBilinen, bilinmeyen: k.maliyetBilinmeyen })));
  const g = tamToplam(gelir), m = tamToplam(smm);   // türetme girdileri: eksik kayıt varsa NaN
  const bGelir = g * v.butceGelirKatsayisi, bSmm = g * v.butceSmmOrani, bOpex = g * v.butceOpexOrani, gOpex = g * v.gerceklesenOpexOrani;
  // Dönemde tutarı bilinen tek sipariş/fatura yoksa (boş dönem, veri yüklenmemiş) sapma/olumlu hükmü YOK —
  // eskiden beş satır "+₺0 olumlu" yeşil basılıyordu (2026-09-14 hakem turu). Gerçekleşen 0 basılır (gerçek 0).
  const veriVar = gelir.bilinen > 0;
  return {
    aylar, gelir, smm, butceVarsayimsal: true,
    satirlar: [
      varyansSatiri('gelir', bGelir, ekranTutari(gelir), false, veriVar && gelir.bilinmeyen === 0),
      varyansSatiri('smm', bSmm, ekranTutari(smm), false, veriVar && smm.bilinmeyen === 0),
      varyansSatiri('brutKar', bGelir - bSmm, g - m, false, veriVar),
      varyansSatiri('opex', bOpex, gOpex, true, veriVar),
      varyansSatiri('favok', bGelir - bSmm - bOpex, g - m - gOpex, true, veriVar),
    ],
  };
}
