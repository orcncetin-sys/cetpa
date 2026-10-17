/**
 * magazaTalep.ts — mağaza sipariş talebinin ORTAK sözleşmesi.
 *
 * Sunucu (yazar: `src/server/routes/magazaRoutes.ts`, `src/server/kanal/magazaDurum.ts`, bildirim işçisi) ile
 * ekran (okur: `src/components/siparis/MagazaTalepleri.tsx`) ve site paneli yanıtı aynı biçimi buradan
 * okur. Yaprak modül: ne sunucuyu ne istemciyi içe aktarır (saat çözümü de burada, `src/utils` yüklenmez).
 *
 * NEDEN AYRI KOLEKSİYON (kullanıcı kararı K1, 2026-10-08): talep `orders`'a
 * YAZILMAZ. Kimliksiz bir uçtan gelen, fiyatı / stok kartı doğrulanmamış kayıt
 * sipariş değildir; ciroya, KPI'lara, Mikro'ya giden yollara karışmamalıdır.
 *
 * TUTARLAR BEYANDIR: `talepFiyat` ve `talepEdilen.*` müşterinin sitede gördüğü
 * rakamlardır. Hiçbir yerde ERP tutarı gibi kullanılmaz; ekran bunlardan toplam
 * TÜRETMEZ. `null` = BİLİNMİYOR («fiyat sorulacak»), sıfır değil.
 *
 * DİLİM 2a (şartname v6 § 1, 2026-10-09): aşama kümesi, geçiş tablosu, panel sözlüğü, kalem teslim işareti,
 * «Etiket basıldı», bildirim rozeti kuralı. Geçiş tablosunun TEK kaynağı `magazaGecisi`'dir; panel ve ERP ekranı
 * tabloyu kopyalamaz (`magazaIzinliGecisler`). Kalem teslim saf işlevleri `Siparis` eşlemesi, takip yanıtı ve ERP
 * ekranı tarafından ORTAK okunur; kopya `durum === 'teslim'` karşılaştırması yazılmaz.
 *
 * DİLİM 2b (şartname v6 § 10.1, 2026-10-10): teyit edilen içerik (`teyit` — müşterinin BEYANI `kalemler` / `talepEdilen`
 * hiçbir yazma yolunda değişmez, V16), kalem başına KDV oranı ve kaynağı, içerik sürümü, yumuşak silme (`silindi`), elle
 * açılan talep (`elle`), revize bildirimi (`bildirimRevize`) ve liste süzgeci (V24 «Silinen / İptal» sekmesi). PARA KURALI
 * (V19): teyit kalemi birim fiyatı KDV HARİÇ net; toplamlar TEK işlevde (`magazaTeyitToplamlari`) tam sayı KURUŞLA türetilir —
 * sunucu kayıtlı tutarı, form canlı önizlemeyi AYNI işlevle üretir. KDV oranının varsayılanı da tek zincirdir:
 * `magazaKdvVarsayilani(magazaUrunKdvOrani(kayitlar, sku))`. Yazma yolu `src/server/kanal/magazaIcerik.ts`.
 */

export const MAGAZA_TALEP_KOLEKSIYONU = 'magazaTalepleri';

/** Mağaza istemcisinin ürettiği talep numarası (ör. `T261008-5Y9P`). */
export const MAGAZA_TALEP_NO_DESENI = /^T\d{6}-[A-Z0-9]{4}$/;

/**
 * Doküman kimliği: `mt-` + sha256(kiracı | talep no | telefonun son 10 hanesi)
 * özetinin ilk 32 onaltılık hanesi. TİRE: `__` bu kod tabanında kiracı öneki
 * ayracıdır (bkz. `server.ts` `<cid>__anahtar`), kimlikte kullanılmaz.
 */
export const MAGAZA_TALEP_KIMLIK_DESENI = /^mt-[0-9a-f]{32}$/;

/** «bekliyor» bu süreden eskiyse ekranda ve bekçide «bildirim gönderilmedi» sayılır. */
export const MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS = 10 * 60_000;

/** KAPALI küme — DÖRT değer (kapı 3, K1); bu dördü dışında değer adı yoktur. Çalışma zamanı dizisi `magazaBildirimSayim.ts`'te. */
export type MagazaBildirimDurumu = 'bekliyor' | 'gitti' | 'gonderilemedi' | 'yapilandirilmamis';

/** KAPALI küme: dokümana, günlüğe, yanıta hata METNİ değil yalnız bu sınıf yazılır. */
export const MAGAZA_BILDIRIM_HATA_SINIFLARI = ['kimlik', 'tls', 'baglanti', 'gonderen-reddi', 'alici-reddi', 'diger'] as const;
export type MagazaBildirimHataSinifi = typeof MAGAZA_BILDIRIM_HATA_SINIFLARI[number];

/** ORTAK bildirim tipi (kapı 3, K17): `bildirim` ve 2b'nin `bildirimRevize`'si aynı tiptir. */
export interface MagazaBildirim {
  durum: MagazaBildirimDurumu;
  /** Son durum değişikliğinin sunucu saati (UTC, ISO-8601 metin). */
  zaman: string;
  /** Kaçıncı deneme başarısız oldu (yalnız kuyruk yolunda). */
  deneme?: number;
  hataSinifi?: MagazaBildirimHataSinifi;
}

// ── Aşama kümesi (V4) ───────────────────────────────────────────────────────────────────────────────────────────────

/** Saklanan aşama değerleri: `yeni` → `teyit` → `hazirlaniyor` → `sevk` → `teslim`; ayrıca `iptal`. */
export const MAGAZA_TALEP_ASAMALARI = ['yeni', 'teyit', 'hazirlaniyor', 'sevk', 'teslim', 'iptal'] as const;
export type MagazaTalepAsamasi = typeof MAGAZA_TALEP_ASAMALARI[number];
/** Açık aşamalar (iptalden dönüşün hedefi yalnız bunlardan biri olabilir — V12). */
export const MAGAZA_ACIK_ASAMALAR = ['yeni', 'teyit', 'hazirlaniyor', 'sevk'] as const;
export type MagazaAcikAsama = typeof MAGAZA_ACIK_ASAMALAR[number];

/** Kapalı küme denetimi (akış / satır güvenilmez biçimdedir). */
export function magazaAsamasiMi(v: unknown): v is MagazaTalepAsamasi {
  return typeof v === 'string' && (MAGAZA_TALEP_ASAMALARI as readonly string[]).includes(v);
}
export function magazaAcikAsamaMi(v: unknown): v is MagazaAcikAsama {
  return typeof v === 'string' && (MAGAZA_ACIK_ASAMALAR as readonly string[]).includes(v);
}

/**
 * Süzgeç, sayım ve bekçi ölçütü BUDUR: `null` (aşaması okunamayan / bilinmeyen satır) AÇIKTIR — kaybolmaz.
 * `MAGAZA_ACIK_ASAMALAR.includes` süzgeç olarak KULLANILMAZ (bilinmeyen aşamalı satırı kaybeder; kapı 2 S-C).
 */
export function magazaAcikMi(asama: MagazaTalepAsamasi | null): boolean {
  return asama !== 'teslim' && asama !== 'iptal';
}

// ── Panel sözlüğü ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Panel ve takip sözlüğü: saklanan `yeni` = `alindi` (mağaza şartnamesi § 7.1). */
export type PanelDurumu = 'alindi' | 'teyit' | 'hazirlaniyor' | 'sevk' | 'teslim' | 'iptal';
export const PANEL_DURUMLARI = ['alindi', 'teyit', 'hazirlaniyor', 'sevk', 'teslim', 'iptal'] as const satisfies readonly PanelDurumu[];
/** Yalnız `Siparis.durum` için; istek gövdelerinde `onceki` / `durum` `PanelDurumu`'dur (`'bilinmiyor'` → 400). */
export type PanelKartDurumu = PanelDurumu | 'bilinmiyor';

export function panelDurumuna(asama: MagazaTalepAsamasi): PanelDurumu {
  return asama === 'yeni' ? 'alindi' : asama;
}
/** Bilinmeyen değer (ve `'bilinmiyor'`, saklanan `'yeni'`) `alindi`'ye ÇEVRİLMEZ: `null`. */
export function paneldenAsamaya(deger: unknown): MagazaTalepAsamasi | null {
  if (deger === 'alindi') return 'yeni';
  if (typeof deger !== 'string' || deger === 'yeni' || !(PANEL_DURUMLARI as readonly string[]).includes(deger)) return null;
  return deger as MagazaTalepAsamasi;
}

// ── Sınırlar ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Müşteriye görünen açıklama: tek satır, en çok bu kadar UTF-16 birimi (aşım kırpma). */
export const MAGAZA_DURUM_ACIKLAMA_SINIRI = 500;
/** Geçmiş en çok bu kadar giriş tutar; taşarsa en eskiler düşer (`durumGecmisiDusen` sayar). */
export const MAGAZA_DURUM_GECMISI_SINIRI = 50;
/** `kim.ad` (panel belirteci ve geçmiş girişi) en çok bu kadar birim. */
export const MAGAZA_PANEL_AD_SINIRI = 80;

/** Sunucunun yazdığı zaman biçimi — `toISOString()`: aynı biçimdeki iki metnin bayt sırası zaman sırasıdır. */
export const MAGAZA_UTC_ZAMAN_DESENI = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Panel bağlanma parametreleri (§ 3): 32 bayt → 43 karakter base64url; `tur` 16 bayt → 22 karakter. */
export const MAGAZA_PANEL_43_DESENI = /^[A-Za-z0-9_-]{43}$/;
export const MAGAZA_PANEL_TUR_DESENI = /^[A-Za-z0-9_-]{22}$/;

// ── Doküman alanları ────────────────────────────────────────────────────────────────────────────────────────────────

export type MagazaKanal = 'panel' | 'erp';

/** Geçmiş girişi — yalnız aşama GEÇİŞLERİ (V9); açıklama metni ve kalem işareti geçmişe girmez. */
export interface MagazaDurumGecisi {
  onceki: MagazaTalepAsamasi;
  yeni: MagazaTalepAsamasi;
  zaman: string;
  kim: { uid: string; ad: string };
  kanal: MagazaKanal;
}

export type MagazaKalemTeslimDurumu = 'bekliyor' | 'teslim';
/** Kalem işareti; `'bekliyor'` girişi işareti KALDIRANI (kim / ne zaman) tutar. */
export interface MagazaKalemTeslimGirisi {
  durum: MagazaKalemTeslimDurumu;
  zaman: string;
  kim: { uid: string; ad: string };
}

/** (V23) Koli etiketi basıldı işareti — yalnız panel ucu yazar; `kim.uid` belirteçten. */
export interface MagazaEtiketBasildi {
  zaman: string;
  koli?: number;
  kim: { uid?: string; panel?: true };
}

export interface MagazaTalepMusteri {
  ad: string;
  firma: string;
  telefon: string;
  eposta: string;
  il: string;
  adres: string;
  vergi: string;
}

export interface MagazaTalepKalemi {
  id: string;
  sku: string;
  ad: string;
  marka: string;
  adet: number;
  /** Müşterinin sitede gördüğü birim fiyat. `null` = fiyat sorulacak (0 DEĞİL). */
  talepFiyat: number | null;
  /** Mağazanın «tedarik edilecek» işareti. */
  tedarik: boolean;
}

export interface MagazaTalebi {
  companyId: string;
  talepNo: string;
  /** Aşama (V4). Dilim 1 kayıtları `'yeni'` taşır; göç gerekmez. */
  durum: MagazaTalepAsamasi;
  /** Sunucunun kayıt saati (UTC, ISO-8601 metin). Sıralama ve «yeni» sayacı bunu okur. */
  olusturma: string;
  /** Müşteri cihazının saati; çözülemediyse `null`. Güvenilmez — yalnız bilgi. */
  istemciTarihi: string | null;
  musteri: MagazaTalepMusteri;
  /** Telefonun son 10 rakamı (durum sorgusunun anahtarı). */
  telefonSon10: string;
  not: string;
  /** Müşterinin BEYANI — hiçbir yazma yolunda değişmez (V16); kalem teslim işareti bu diziye YAZILMAZ. */
  kalemler: MagazaTalepKalemi[];
  /** İstemci BEYANI; alan gönderilmediyse `null`. */
  talepEdilen: { araToplam: number | null; kdv: number | null; toplam: number | null };
  /** Sunucuda kalemlerden türetilir: herhangi bir `talepFiyat === null`. */
  fiyatiSorulacakVar: boolean;
  /** Herhangi bir metin alanı üst sınırda kırpıldıysa. */
  kirpildi?: true;
  bildirim: MagazaBildirim;
  // ── Dilim 2a alanları (hepsi isteğe bağlı; dilim 1 kayıtlarında yok) ──
  /** Müşteriye görünen açıklama (tek satır, ≤ `MAGAZA_DURUM_ACIKLAMA_SINIRI`). */
  durumAciklama?: string;
  /** Son aşama / açıklama yazımı (UTC `toISOString()`; yoksa `olusturma`). Kalem teslim yazımı İLERLETMEZ. */
  durumZamani?: string;
  /** Yoksa 0; her aşama / açıklama / kalem teslim yazımında +1 (CAS). Bildirim ve etiket yazımı artırmaz. */
  durumSurum?: number;
  /** Yalnız `iptal`e geçişte yazılır (önceki aşama); `null` = iptalden çıkılmış. */
  iptalOncesi?: MagazaAcikAsama | null;
  durumGecmisi?: MagazaDurumGecisi[];
  durumGecmisiDusen?: number;
  /** Kalem anahtarı → işaret; girişi olmayan kalem «bekliyor». */
  kalemTeslim?: Record<string, MagazaKalemTeslimGirisi>;
  /** (V23) yok / `null` = etiket basılmadı. */
  etiketBasildi?: MagazaEtiketBasildi | null;
  // ── Dilim 2b alanları (hepsi isteğe bağlı; 2a ve dilim 1 kayıtlarında yok — § 10.1) ──
  /** Personelin TEYİT ETTİĞİ içerik; yok = teyit yazılmadı (ekranın ikinci sütunu «—»). BEYAN (`kalemler`) değişmez (V16). */
  teyit?: MagazaTeyit;
  /** Yoksa 0; `musteri` / `not` / `teyit` yazımında +1. `durumSurum`'dan BAĞIMSIZ; kalem teslim yazımı artırmaz ama KOŞUL olarak okur. */
  icerikSurum?: number;
  /** Son içerik yazımı (UTC `toISOString()`); revize bildirimi rozetinin ve bekçi yaşının dayanağı. */
  icerikZamani?: string;
  /** Nesne = silinmiş; `null` = geri alınmış (`||` alan silemez); yok = hiç silinmemiş. Ölçüt `magazaSilinmisMi`. */
  silindi?: MagazaSilindi | null;
  /** Yalnız ERP'de elle açılan talepte; yok = mağazadan geldi. */
  elle?: MagazaElle;
  /** İçerik revizyonunun AYRI bildirim durumu; ilk bildirim alanı (`bildirim`) ezilmez. */
  bildirimRevize?: MagazaBildirimRevize;
}

/** Akıştan / veritabanından gelen değer güvenilmez biçimdedir: düz nesne mi (dizi ve `null` değil). */
const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── Dilim 2b: teyit edilen içerik, KDV, silme, elle talep, revize bildirimi (§ 10.1) ───────────────────────────────────

/**
 * Teyit kaleminin KDV oranları — sabitin TEK tanımı (mağaza yolu içe aktarır, kopyalamaz; çit: magazaTalep.icerik.test.ts).
 * ERP sipariş formunun sunduğu 8 ve 18 bu kümede YOK: ürün kaydında o oranlar varsa kalem `varsayilan`a düşer (V19, bilinçli).
 */
export const MAGAZA_KDV_ORANLARI = [0, 1, 10, 20] as const;
export type MagazaKdvOrani = typeof MAGAZA_KDV_ORANLARI[number];
/** Ürün kaydından oran okunamadığında gelen oran (`kdvKaynagi: 'varsayilan'` imiyle birlikte — tek başına basılmaz). */
export const MAGAZA_KDV_VARSAYILAN_ORANI = 20 satisfies MagazaKdvOrani;

export function magazaKdvOraniMi(v: unknown): v is MagazaKdvOrani {
  return typeof v === 'number' && (MAGAZA_KDV_ORANLARI as readonly number[]).includes(v);
}

/**
 * Oranın KAYNAĞI — sunucunun çıkarımıdır, istekte kabul edilmez: `urun` = ERP ürün kaydının `vatRate`'i; `varsayilan` =
 * ürün kaydından okunamadı (eşleşen SKU yok / `vatRate` yok ya da küme dışı / çelişen kayıt) → 20 + ekranda «varsayılan»
 * imi; `personel` = personel kalem başına seçti.
 */
export const MAGAZA_KDV_KAYNAKLARI = ['urun', 'varsayilan', 'personel'] as const;
export type MagazaKdvKaynagi = typeof MAGAZA_KDV_KAYNAKLARI[number];

export function magazaKdvKaynagiMi(v: unknown): v is MagazaKdvKaynagi {
  return typeof v === 'string' && (MAGAZA_KDV_KAYNAKLARI as readonly string[]).includes(v);
}

/**
 * Teyit edilen kalem. `anahtar` `t:<12 onaltılık>` — SUNUCU üretir, kalem ekle / sil / sırala ile KAYMAZ; teslim işareti
 * kalemin İÇİNE yazılmaz, `kalemTeslim[anahtar]`'da tutulur. `birimFiyat` KDV HARİÇ net; `null` = «fiyat sorulacak» (0 DEĞİL).
 */
export interface MagazaTeyitKalemi {
  anahtar: string;
  id: string;
  sku: string;
  ad: string;
  marka: string;
  /** Güvenli tam sayı > 0. */
  adet: number;
  birimFiyat: number | null;
  kdvOrani: MagazaKdvOrani;
  kdvKaynagi: MagazaKdvKaynagi;
  tedarik: boolean;
}

/**
 * `MagazaTeyitKalemi`'nin BÜTÜN alanları — `degisenAlanlar` kalemleri bu listeyle alan alan karşılaştırır. Tipe yeni alan
 * eklenip buraya eklenmezse derleme aşağıdaki satırda kırılır (unutulan alanın değişikliği «değişiklik yok» sayılmasın).
 */
export const MAGAZA_TEYIT_KALEM_ALANLARI = [
  'anahtar', 'id', 'sku', 'ad', 'marka', 'adet', 'birimFiyat', 'kdvOrani', 'kdvKaynagi', 'tedarik',
] as const satisfies readonly (keyof MagazaTeyitKalemi)[];
const teyitKalemAlanlariTam: Exclude<keyof MagazaTeyitKalemi, typeof MAGAZA_TEYIT_KALEM_ALANLARI[number]> extends never ? true : never = true;
void teyitKalemAlanlariTam;

/** Üç toplam BİRLİKTE dolu ya da BİRLİKTE `null`'dır (kısmi toplam basılmaz). */
export interface MagazaTeyitToplami {
  /** KDV hariç ara toplam (matrah). */
  araToplam: number | null;
  kdv: number | null;
  toplam: number | null;
}

export interface MagazaTeyit extends MagazaTeyitToplami {
  /** En az 1 kalem (bütün kalemleri silmek isteyen talebi `iptal` eder — aşama). */
  kalemler: MagazaTeyitKalemi[];
  zaman: string;
  kim: { uid: string; ad: string };
}

export interface MagazaSilindi {
  zaman: string;
  kim: { uid: string; ad: string };
  kanal: MagazaKanal;
}

export interface MagazaElle {
  zaman: string;
  kim: { uid: string; ad: string };
}

/** Müşteri bloğunun yedi alanı — içerik yazımında YEDİSİ birden gelir (`||` sığ birleştirir; kısmi nesne eski alanı silerdi). */
export const MAGAZA_MUSTERI_ALANLARI = ['ad', 'firma', 'telefon', 'eposta', 'il', 'adres', 'vergi'] as const satisfies readonly (keyof MagazaTalepMusteri)[];
const musteriAlanlariTam: Exclude<keyof MagazaTalepMusteri, typeof MAGAZA_MUSTERI_ALANLARI[number]> extends never ? true : never = true;
void musteriAlanlariTam;

/** İçerik revizyonunda değişebilen alan adları (bildirim gövdesi ve denetim ayrıntısı yalnız bu ADLARI basar; değer basmaz). */
export const MAGAZA_REVIZE_ALANLARI = ['musteri', 'not', 'teyit'] as const;
export type MagazaRevizeAlani = typeof MAGAZA_REVIZE_ALANLARI[number];

/**
 * Revize bildirimi — `bildirim` ile AYNI sözlük (`MagazaBildirimDurumu`, `MAGAZA_BILDIRIM_HATA_SINIFLARI`; kopya küme yok).
 * `alanlar` o revizyonda GERÇEKTEN değişen alanlar (sunucu ölçer); önceki revize bildirimi GİTMEMİŞKEN (`bekliyor` /
 * `gonderilemedi` / `yapilandirilmamis` — inceleme 2b, bulgu 10) yeni revizyon gelirse SQL'de dizi
 * birleştirilir ve yinelenen ad kalabilir — okuyan `alanlariBirlestir` ile tekilleştirir. `icerikSurum` = yazımın ürettiği
 * sürüm (işçi bayat işi tanır).
 */
export interface MagazaBildirimRevize extends MagazaBildirim {
  alanlar: MagazaRevizeAlani[];
  kim: { uid: string; ad: string };
  icerikSurum: number;
}

/**
 * `fiyat × 100`, kayan nokta kalıntısı 15 anlamlı haneyle TEMİZLENMİŞ (1,005 × 100 = 100,49999999999999 → 100,5; 1,15 × 100 =
 * 114,99999999999999 → 115). Toplam işlevinin birim kuruşu ve kuruş denetimi (`magazaKurusluMu`) bu TEK adımı paylaşır:
 * denetimin kabul ettiği fiyatın kuruşu, toplamın yuvarladığı kuruşla aynı tam sayıdır.
 */
function temizKurus(fiyat: number): number {
  return Number((fiyat * 100).toPrecision(15));
}

/**
 * Teyit toplamları — kuruş formülünün TEK kaynağı (V19; sunucu kayıtlı tutarı, form önizlemeyi bununla üretir):
 *   satirKurus = Math.round(birimFiyat × 100) × adet · araToplamKurus = Σ satirKurus
 *   kdvKurus = Σ Math.round(satirKurus × kdvOrani / 100) (KDV KALEM oranıyla; tek orandan değil) · toplam = ara + kdv
 * Birim fiyatın kuruşa yuvarlanmasında YARIM KURUŞ YUKARI (inceleme 2b, bulgu 2): `birimFiyat × 100` çarpımının kayan nokta
 * kalıntısı yuvarlamadan önce 15 anlamlı haneyle temizlenir (`temizKurus`, `toPrecision(15)`) — yoksa 1,005 → 100 kuruş, 0,145 → 14 kuruş
 * çıkar ve yön fiyata göre değişirdi. İki ondalıklı fiyatta sonuç eskisiyle AYNIDIR (95 → 9.500 kuruş) — birim fiyat 1e15
 * kuruşun (10 trilyon TL) altındayken; üstü üçünü `null` yapar (inceleme 2b ikinci tur: 15 anlamlı hane o büyüklükte kuruşun
 * kendisini yuvarlar, 12.345.678.901.234,56 → …,60 yazılırdı).
 * Örnek: 2 × 95,00 (%20) + 1 × 40,00 (%20) → 230,00 / 46,00 / 276,00; ikinci kalem %10 ise 230,00 / 42,00 / 272,00.
 * Herhangi bir `birimFiyat === null` → ÜÇÜ de `null` («fiyat sorulacak»; kısmi toplam basılmaz, sıfır değil). Sonlu olmayan
 * fiyat / adet, 1e15 kuruş ve üstü birim fiyat YA DA satır tutarı, güvenli tam sayıyı aşan kuruş tutarı da üçünü `null` yapar (yuvarlanmış
 * sahte tutar yazılmaz).
 */
export function magazaTeyitToplamlari(
  kalemler: ReadonlyArray<{ adet: number; birimFiyat: number | null; kdvOrani: MagazaKdvOrani }>,
): MagazaTeyitToplami {
  const bilinmiyor: MagazaTeyitToplami = { araToplam: null, kdv: null, toplam: null };
  let araKurus = 0, kdvKurus = 0;
  for (const k of kalemler) {
    if (k.birimFiyat === null || !Number.isFinite(k.birimFiyat) || !Number.isFinite(k.adet)) return bilinmiyor;
    // Yarım kuruş HER ZAMAN yukarı: çarpımın kayan nokta kalıntısı (1,005 × 100 = 100,49999999999999) önce 15 anlamlı
    // haneyle temizlenir, sonra yuvarlanır — 1,005 → 101 kuruş, 0,145 → 15 kuruş (kalıntıyla 100 ve 14 çıkıyordu).
    // 15 anlamlı hane kuruşu ancak 1e15 kuruşun (10 trilyon TL) ALTINDA tam taşır; üstünde temizlik kuruşun kendisini
    // yuvarlar (12.345.678.901.234,56 → …,60) — o aralıkta tutar yazılmaz.
    if (k.birimFiyat * 100 >= 1e15) return bilinmiyor;
    const satirKurus = Math.round(temizKurus(k.birimFiyat)) * k.adet;
    // Aynı sınır SATIR tutarı için de geçerli: adet ≥ 2 ile satır 1e15 kuruşu geçerse KDV 1 kuruş kayık çıkabiliyordu.
    if (satirKurus >= 1e15) return bilinmiyor;
    const satirKdvKurus = Math.round(satirKurus * k.kdvOrani / 100);
    araKurus += satirKurus;
    kdvKurus += satirKdvKurus;
    if (!Number.isSafeInteger(satirKurus) || !Number.isSafeInteger(araKurus) || !Number.isSafeInteger(araKurus + kdvKurus)) return bilinmiyor;
  }
  return { araToplam: araKurus / 100, kdv: kdvKurus / 100, toplam: (araKurus + kdvKurus) / 100 };
}

/**
 * Birim fiyat EN ÇOK İKİ ONDALIK mı (kuruş) — kullanıcı kararı 2026-10-17 («kuruştan ince birim fiyat kabul edilsin mi? —
 * hayır»; şartname «kayıt kapanışı ve kuruş» B1–B3). ERP'nin TEYİT kalemi ve ELLE TALEP kalemi `birimFiyat`'ı bu TEK işlevle
 * süzülür: sunucu şeması (`src/server/schemas.ts` `ErpIcerikGovdesi` / `ErpElleTalepGovdesi`) ve form
 * (`magazaTalepFormu.ts` `magazaFiyatCoz` — önizleme de gövde de oradan okur). Kimliksiz talep ucu (dilim 1, müşterinin
 * BEYANI) bu denetimden GEÇMEZ (B3: mağazanın talebi kaybolmasın); toplamdaki kuruş yuvarlaması savunma olarak kalır.
 *
 * KAYAN NOKTA KALINTISINA DAYANIKLI: `n × 100` önce 15 anlamlı haneyle temizlenir — `magazaTeyitToplamlari` ile AYNI adım
 * (`temizKurus`) — sonra tam sayı mı diye bakılır. 95,1 · 1,15 (× 100 = 114,99999999999999) · 0,1 + 0,2 (= 0,30000000000000004) · 9.999.999,99
 * KABUL; 83,3333 · 0,001 · 1,005 (yarım kuruş; × 100 = 100,49999999999999 → temizlenince 100,5) · 1,005001 RED. Kabul edilen
 * fiyatın kuruşu, toplam işlevinin yuvarlayarak bulduğu kuruşla AYNI tam sayıdır: yuvarlama artık hiçbir şeyi değiştirmez.
 * SINIRLAR: NaN / sonsuz → red. Kuruştan ince basamağı (yarım kuruş dâhil) GÖRMEK için 15 anlamlı hanenin en az BİRİ kuruşun
 * ALTINDA kalmalıdır: bu ancak 1e14 kuruşun (1 trilyon TL) altında olur — üstünde temizlik kuruşun altını yuvarlar ve kuruştan ince
 * fiyat «kuruşlu» görünür (1.000.000.000.000,555 × 100 → 100.000.000.000.056 kuruş: KABUL ediliyordu). Sınır bu yüzden 1e14 kuruş
 * (inceleme 1, İ1-b, 2026-10-17; eskiden 1e15): ≥ 1 trilyon TL → RED. Toplam işlevinin (`magazaTeyitToplamlari`) 1e15 sınırı
 * DEĞİŞMEDİ — o savunma olarak kalır. 15 anlamlı haneyi aşan basamak kalıntı sayılır. İşaret burada sınanmaz (negatif fiyat şemanın
 * `nonnegative` kuralıdır; form eksi işareti zaten okumaz).
 */
export function magazaKurusluMu(n: number): boolean {
  if (!Number.isFinite(n) || magazaFiyatSinirUstu(n)) return false;
  return Number.isInteger(temizKurus(n));
}

/**
 * Birim fiyat kuruş denetiminin ÖLÇEBİLDİĞİ aralığın dışında mı: `|n × 100| ≥ 1e14` kuruş (1 trilyon TL; İ1-b, 2026-10-17). TEK kaynak:
 * `magazaKurusluMu` (bu aralıkta RED) ve form ayrıştırıcısı (`magazaTalepFormu.ts` `magazaFiyatCoz` — bu aralıkta `gecersiz`, kuruş
 * sorusundan ÖNCE) aynı sınırı buradan okur; formda kuruş çarpımı yazılmaz (formun kaynak çiti).
 */
export function magazaFiyatSinirUstu(n: number): boolean {
  return Math.abs(n * 100) >= 1e14;
}

/** Kuruştan ince birim fiyatın hata metni — sunucu şemasının iletisi ve formun alan hatası AYNI metin (B1, B2). */
export const MAGAZA_BIRIM_FIYAT_KURUS_HATASI = 'Birim fiyat en çok iki ondalık olabilir (kuruş).';

/**
 * Ürün kaydının `vatRate`'inden teyit kaleminin BAŞLANGIÇ oranı. Sonlu sayı VE kümede ise o oran (`urun`); `undefined`
 * (eşleşme yok / çelişen kayıt), `null`, `'20'` dizgesi, küme dışı sayı (4, 8, 18) → 20 + `varsayilan` (ekran im basar).
 */
export function magazaKdvVarsayilani(vatRate: unknown): { kdvOrani: MagazaKdvOrani; kdvKaynagi: 'urun' | 'varsayilan' } {
  return magazaKdvOraniMi(vatRate) ? { kdvOrani: vatRate, kdvKaynagi: 'urun' } : { kdvOrani: MAGAZA_KDV_VARSAYILAN_ORANI, kdvKaynagi: 'varsayilan' };
}

/** Mağaza kataloğunun paket soneki: `<kod>-Dnnn` = ERP kartı `<kod>` (çarpan nnn). TAM üç rakam; iki / dört haneli son ek sayılmaz. */
const PAKET_SONEKI = /-D\d{3}$/;

/** `DEKOR-1325-D002` → `DEKOR-1325`; son ek yoksa (ya da taban boş kalıyorsa) `null`. Başka dönüşüm YOK (büyütme / kırpma yok). */
export function magazaTabanSku(sku: string): string | null {
  if (!PAKET_SONEKI.test(sku)) return null;
  const taban = sku.replace(PAKET_SONEKI, '');
  return taban === '' ? null : taban;
}

/**
 * Kalem SKU'sunun ERP ürün kaydındaki KDV oranı — eşleme sırasının TEK kaynağı (sunucu `URUN_KDV_SQL` satırlarını,
 * OrdersPage `inventory` kopyasını verir): önce `sku` BİREBİR eşit kayıt(lar); yoksa `-D\d{3}` son eki atılmış TABAN SKU'ya
 * birebir eşit kayıt(lar). Seçilen kümede `vatRate`'i sonlu sayı olan değerler TEK bir sayıysa o sayı; birden fazla ve
 * FARKLIYSA `undefined` (çelişen ürün kaydı sessizce bir oran uydurmaz); hiç yoksa `undefined`. `sku` boşsa `undefined`.
 * `vatRate` İSTEĞE BAĞLI: `InventoryItem[]` (dizin imzalı tip) daraltma / `as` olmadan doğrudan geçer.
 */
export function magazaUrunKdvOrani(kayitlar: ReadonlyArray<{ sku: string; vatRate?: unknown }>, sku: string): number | undefined {
  if (sku === '') return undefined;
  let secilen = kayitlar.filter(k => k.sku === sku);
  if (secilen.length === 0) {
    const taban = magazaTabanSku(sku);
    if (taban === null) return undefined;
    secilen = kayitlar.filter(k => k.sku === taban);
  }
  let oran: number | undefined;
  for (const k of secilen) {
    const v = k.vatRate;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (oran !== undefined && oran !== v) return undefined;
    oran = v;
  }
  return oran;
}

/** Silinmiş mi: `silindi` NESNE ise. `null` (geri alınmış) ve yok (hiç silinmemiş) → false. SQL eşi `jsonb_typeof(…) = 'object'`. */
export function magazaSilinmisMi(t: { silindi?: unknown }): boolean {
  return nesneMi(t.silindi);
}

/** `degisenAlanlar`'ın ESKİ tarafı — veritabanından okunur, güvenilmez biçimdedir. `teyit` = `{ kalemler }` taşıyan nesne. */
export interface MagazaIcerikOnceki { musteri?: unknown; not?: unknown; teyit?: unknown }
/** `degisenAlanlar`'ın YENİ tarafı — temizlenmiş, KDV'si çözülmüş, anahtarı atanmış içerik; verilmeyen alan karşılaştırılmaz. */
export interface MagazaIcerikYeni {
  musteri?: MagazaTalepMusteri;
  not?: string;
  teyit?: { kalemler: ReadonlyArray<MagazaTeyitKalemi> };
}

/**
 * Bir içerik yazımında GERÇEKTEN değişen alan adları (sıra sabit: `musteri`, `not`, `teyit`). Form her zaman TAM gövde
 * gönderir; «ne değişti» burada ölçülür. `musteri` yedi alan alan alan eşitse; `not` metni eşitse; `teyit` kalem dizisi —
 * her kalemin BÜTÜN alanları (`MAGAZA_TEYIT_KALEM_ALANLARI`) ve SIRA — eşitse listede YOK. `teyit.zaman` / `teyit.kim`
 * karşılaştırmaya girmez. Eski değer beklenen biçimde değilse (alan yok, nesne / dizge değil) alan DEĞİŞMİŞ sayılır.
 */
export function degisenAlanlar(onceki: MagazaIcerikOnceki, yeni: MagazaIcerikYeni): MagazaRevizeAlani[] {
  const alanlar: MagazaRevizeAlani[] = [];
  if (yeni.musteri !== undefined) {
    const yeniMusteri = yeni.musteri, eski = onceki.musteri;
    if (!nesneMi(eski) || MAGAZA_MUSTERI_ALANLARI.some(a => eski[a] !== yeniMusteri[a])) alanlar.push('musteri');
  }
  if (yeni.not !== undefined && onceki.not !== yeni.not) alanlar.push('not');
  if (yeni.teyit !== undefined) {
    const yeniKalemler = yeni.teyit.kalemler;
    const eskiKalemler = nesneMi(onceki.teyit) ? onceki.teyit.kalemler : undefined;
    const esit = Array.isArray(eskiKalemler) && eskiKalemler.length === yeniKalemler.length
      && yeniKalemler.every((k, i) => { const e: unknown = eskiKalemler[i]; return nesneMi(e) && MAGAZA_TEYIT_KALEM_ALANLARI.every(a => e[a] === k[a]); });
    if (!esit) alanlar.push('teyit');
  }
  return alanlar;
}

/**
 * Saklanan `bildirimRevize.alanlar`'ın okunuşu: küme birleşimi, İLK görülme sırası; bilinmeyen ad düşer; dizi değilse `[]`.
 * (SQL birleştirmesi `['not'] || ['not', 'teyit']` yinelenen ad bırakır — tekilleştirme okuyandadır: işçi gövdeyi, kanca
 * daraltıcısı ekranı bununla üretir.)
 */
export function alanlariBirlestir(deger: unknown): MagazaRevizeAlani[] {
  if (!Array.isArray(deger)) return [];
  const sonuc: MagazaRevizeAlani[] = [];
  for (const v of deger) {
    const ad = MAGAZA_REVIZE_ALANLARI.find(a => a === v);
    if (ad !== undefined && !sonuc.includes(ad)) sonuc.push(ad);
  }
  return sonuc;
}

// ── Liste süzgeci (V24 — «Silinen / İptal» sekmesi; V17'deki «silinenleri gizle» onay kutusunun YERİNE) ──────────────────

/** ERP «Mağaza Talepleri» listesinin dört düğmesi, ekran sırasıyla: Açık · Kapalı · Silinen / İptal · Hepsi. */
export const MAGAZA_DURUM_SUZGECLERI = ['acik', 'kapali', 'silinenIptal', 'hepsi'] as const;
export type MagazaDurumSuzgeci = typeof MAGAZA_DURUM_SUZGECLERI[number];

/** Süzgecin okuduğu alanlar (kanca satırı buna uyar; kanca tipi burada içe aktarılmaz — yaprak modül). */
export interface MagazaSuzgecSatiri { durum: MagazaTalepAsamasi | null; silindi?: unknown }

/**
 * Süzgeç kuralı — TEK yer (düğme sayıları da buradan):
 *   • Açık            = silinmemiş VE aşaması açık (`magazaAcikMi`; aşaması okunamayan `null` satır AÇIKTIR, kaybolmaz).
 *   • Kapalı          = silinmemiş VE aşaması `teslim` (`iptal` artık BURADA DEĞİL — 2a'da «Kapalı» teslim + iptal idi).
 *   • Silinen / İptal = silinmiş (`magazaSilinmisMi`) YA DA aşaması `iptal` (silinmiş + iptal tek satırdır, bir kez sayılır).
 *   • Hepsi           = silinmemişlerin tamamı (açık + teslim + iptal). Silinmişler «Hepsi»de GÖRÜNMEZ.
 * Tutarlılık: Açık + Kapalı + (iptal ama silinmemiş) = Hepsi.
 */
export function magazaSuzgeceUyar(t: MagazaSuzgecSatiri, suzgec: MagazaDurumSuzgeci): boolean {
  const silinmis = magazaSilinmisMi(t);
  switch (suzgec) {
    case 'acik': return !silinmis && magazaAcikMi(t.durum);
    case 'kapali': return !silinmis && t.durum === 'teslim';
    case 'silinenIptal': return silinmis || t.durum === 'iptal';
    case 'hepsi': return !silinmis;
  }
}

/** Sıra korunur; girdi dizisi değişmez (yeni dizi döner). */
export function magazaSuzgecle<T extends MagazaSuzgecSatiri>(talepler: readonly T[], suzgec: MagazaDurumSuzgeci): T[] {
  return talepler.filter(t => magazaSuzgeceUyar(t, suzgec));
}

/** Dört düğmenin sayıları — `magazaSuzgecle` ile AYNI kuraldan (ayrı sayım formülü yazılmaz). */
export function magazaSuzgecSayilari(talepler: readonly MagazaSuzgecSatiri[]): Record<MagazaDurumSuzgeci, number> {
  const sayilar: Record<MagazaDurumSuzgeci, number> = { acik: 0, kapali: 0, silinenIptal: 0, hepsi: 0 };
  for (const t of talepler) for (const s of MAGAZA_DURUM_SUZGECLERI) if (magazaSuzgeceUyar(t, s)) sayilar[s] += 1;
  return sayilar;
}

// ── Kalem teslim işareti (V6) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Kalem anahtarı — kurallı biçim, öncü sıfır YOK (kapı 3, K5): `b:01` desene uymaz; `b:1` ile `b:01` aynı dizine çözülüp
 * iki ayrı anahtar olmasın. Beyan kalemi `b:<dizin>` (dizin `kalemler` içindeki sıra; V16 gereği SABİT). Teyit kalemi (2b)
 * `t:<12 onaltılık>` — SUNUCU üretir, dizinle kaymaz. Beyan kaleminin `id`'si anahtar OLAMAZ (isteğe bağlı, boş olabilir,
 * tekil değil). Desen kurallı olduğu için yineleme denetimi METİN eşitliğiyle yeterlidir.
 */
export const MAGAZA_KALEM_ANAHTARI_DESENI = /^(b:(0|[1-9]\d{0,3})|t:[0-9a-f]{12})$/;

/**
 * Anahtarın kaynağı (desenin TEK yorumu; ikinci desen yazılmaz): `b:<dizin>` → beyan + dizin, `t:…` → teyit; desene uymayan → `null`.
 * 2b içerik yazımı bununla ayırır: `b:` «form bu kalemi beyandan kopyaladı», `t:` «mevcut teyit kalemi».
 */
export function magazaKalemAnahtariCoz(anahtar: string): { kaynak: 'beyan'; dizin: number } | { kaynak: 'teyit' } | null {
  if (!MAGAZA_KALEM_ANAHTARI_DESENI.test(anahtar)) return null;
  return anahtar.startsWith('b:') ? { kaynak: 'beyan', dizin: Number(anahtar.slice(2)) } : { kaynak: 'teyit' };
}

/** Kaynağı belirleyen alanlar — akış güvenilmez biçimdedir, `unknown` okunur. 2b'nin `teyit` nesnesi burada tiplenmez. */
export interface MagazaTeslimKaynakGirdisi {
  kalemler?: unknown;
  teyit?: unknown;
}

/** `teyit` nesne VE `teyit.kalemler` boş olmayan dizi ise `'teyit'`, yoksa `'beyan'` (2a'da hep `'beyan'`). */
export function magazaTeslimKaynagi(t: MagazaTeslimKaynakGirdisi): 'beyan' | 'teyit' {
  return nesneMi(t.teyit) && Array.isArray(t.teyit.kalemler) && t.teyit.kalemler.length > 0 ? 'teyit' : 'beyan';
}

/**
 * Aktif kaynağın anahtarları, kalem sırasıyla: beyanda `b:0 … b:(n−1)`; teyitte `teyit.kalemler[].anahtar` (dizge
 * olmayan anahtar atlanır — sunucu üretir, eksikliği bozuk kayıttır). `kalemler` dizi değilse `[]`.
 */
export function magazaKalemAnahtarlari(t: MagazaTeslimKaynakGirdisi): string[] {
  if (magazaTeslimKaynagi(t) === 'teyit') {
    const kalemler = (t.teyit as { kalemler: unknown[] }).kalemler;
    return kalemler.flatMap(k => (nesneMi(k) && typeof k.anahtar === 'string' ? [k.anahtar] : []));
  }
  return Array.isArray(t.kalemler) ? t.kalemler.map((_, i) => `b:${i}`) : [];
}

/** Giriş var VE `durum === 'teslim'`. Nesne olmayan `kalemTeslim` → false, fırlatmaz. */
export function magazaKalemTeslimMi(kalemTeslim: unknown, anahtar: string): boolean {
  if (!nesneMi(kalemTeslim)) return false;
  const giris = kalemTeslim[anahtar];
  return nesneMi(giris) && giris.durum === 'teslim';
}

/** Kaynak kalem sayısı − teslim işaretli sayısı (öbür kaynağın anahtarındaki işaret SAYILMAZ; 50 kesiminden bağımsız). */
export function magazaTeslimIsaretsiz(t: MagazaTeslimKaynakGirdisi & { kalemTeslim?: unknown }): number {
  const anahtarlar = magazaKalemAnahtarlari(t);
  return anahtarlar.length - anahtarlar.filter(a => magazaKalemTeslimMi(t.kalemTeslim, a)).length;
}

/**
 * «Son güncelleme» = max(`durumZamani` ?? `olusturma`, `kalemTeslim[*].zaman`) — hepsi `toISOString()` biçimidir,
 * karşılaştırma METİN sırasıyla (§ 4 KAPALI süzgeciyle aynı dayanak). Biçime uymayan değer yok sayılır; `'bekliyor'`
 * girişinin zamanı da kapsanır (işaret kaldırma da güncellemedir). `etiketBasildi.zaman` bu formüle GİRMEZ (V23).
 */
export function magazaGuncellemeZamani(t: { olusturma: string; durumZamani?: unknown; kalemTeslim?: unknown }): string {
  const taban = typeof t.durumZamani === 'string' && MAGAZA_UTC_ZAMAN_DESENI.test(t.durumZamani) ? t.durumZamani : t.olusturma;
  const adaylar: string[] = [];
  if (nesneMi(t.kalemTeslim)) {
    for (const giris of Object.values(t.kalemTeslim)) {
      if (nesneMi(giris) && typeof giris.zaman === 'string' && MAGAZA_UTC_ZAMAN_DESENI.test(giris.zaman)) adaylar.push(giris.zaman);
    }
  }
  if (MAGAZA_UTC_ZAMAN_DESENI.test(taban)) adaylar.push(taban);
  if (adaylar.length === 0) return taban;
  return adaylar.reduce((enBuyuk, z) => (z > enBuyuk ? z : enBuyuk));
}

// ── Geçiş tablosu (V5, V12) ─────────────────────────────────────────────────────────────────────────────────────────

export type MagazaGecisTuru = 'aciklama' | 'ileri' | 'iptal' | 'geri' | 'iptalden-donus';
export type MagazaGecisSonucu =
  | { izinli: false }
  | { izinli: true; tur: MagazaGecisTuru; iptalOncesi?: MagazaAcikAsama | null };

/** İleri / geri zinciri (iptal dışı). */
const ZINCIR: readonly MagazaTalepAsamasi[] = ['yeni', 'teyit', 'hazirlaniyor', 'sevk', 'teslim'];

/**
 * Tek geçiş kuralı. Kural sırası: aynı aşama → ileri → iptal → geri → iptalden dönüş. `teslim` → `iptal` İZİNSİZ (V12).
 * `iptalOncesi` belgeden okunurken dört açık aşamadan biri değilse YOK sayılır; yokken iptalden dönüş izinsiz (aşama
 * uydurulmaz). Sonuç yaması: `iptal`e geçişte `iptalOncesi: <önceki>`; iptalden ÇIKAN geçişte açıkça `null` (`||` alan
 * silemez); aynı aşama (`iptal` → `iptal` dâhil) `iptalOncesi`'ne DOKUNMAZ.
 */
export function magazaGecisi(onceki: MagazaTalepAsamasi, yeni: MagazaTalepAsamasi, iptalOncesi: unknown): MagazaGecisSonucu {
  if (onceki === yeni) return { izinli: true, tur: 'aciklama' };
  const o = ZINCIR.indexOf(onceki), y = ZINCIR.indexOf(yeni);
  if (o >= 0 && y === o + 1) return { izinli: true, tur: 'ileri' };
  if (yeni === 'iptal' && onceki !== 'teslim' && onceki !== 'iptal') return { izinli: true, tur: 'iptal', iptalOncesi: onceki };
  if (o >= 0 && y === o - 1) return { izinli: true, tur: 'geri' };
  if (onceki === 'iptal' && magazaAcikAsamaMi(iptalOncesi) && yeni === iptalOncesi) return { izinli: true, tur: 'iptalden-donus', iptalOncesi: null };
  return { izinli: false };
}

/** Aynı işlevden türetilir (kendisi hariç). Geçiş tablosunun TEK kaynağı `magazaGecisi`'dir. */
export function magazaIzinliGecisler(asama: MagazaTalepAsamasi, iptalOncesi: unknown): MagazaTalepAsamasi[] {
  return MAGAZA_TALEP_ASAMALARI.filter(yeni => yeni !== asama && magazaGecisi(asama, yeni, iptalOncesi).izinli);
}

// ── Bildirim rozeti (K17, Y1, Y2) ───────────────────────────────────────────────────────────────────────────────────

export type BildirimGorunumu =
  | { tur: 'isaretsiz' }                                                                                   // gitti
  | { tur: 'gonderiliyor' }                                                                                // taze «bekliyor»
  | { tur: 'uyari'; neden: 'gonderilemedi' | 'yapilandirilmamis' | 'bekleme-asildi' | 'okunamadi' };

/** ISO-8601 tarih-saat, dilim belirteçli (`Z` / `±ss:dd`); gevşek biçim (`"1"` → 2001) çözülmemiş sayılır. */
const ISO_TARIH_SAAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const zamanMsCoz = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const metin = v.trim();
  if (!ISO_TARIH_SAAT.test(metin)) return null;
  const ms = Date.parse(metin);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * «bekliyor» ne zamandır sürüyor: `max(taban, b.zaman)` (kapı 4, Y2) — ikisi de çözülüyorsa BÜYÜĞÜ, biri çözülmüyorsa
 * diğeri, ikisi de çözülmüyorsa `null`. `taban` ilk bildirimde `olusturma`, revize (2b) için `icerikZamani`. Elle «Yeniden
 * gönder» sonrası rozet eski talepte de 10 dk «gönderiliyor» olur; işçinin denemeleri `zaman`ı tazelediği için denemeler
 * sürerken uzar — BİLİNÇLİ (işçi deneme sınırında `gonderilemedi` yazar). Dilim 1'in `min` kuralı bilerek değişti.
 */
export function bildirimBeklemeBaslangiciMs(b: Pick<MagazaBildirim, 'zaman'> | null | undefined, taban: string | undefined): number | null {
  const tabanMs = zamanMsCoz(taban);
  const durumMs = b ? zamanMsCoz(b.zaman) : null;
  if (tabanMs === null) return durumMs;
  return durumMs === null ? tabanMs : Math.max(tabanMs, durumMs);
}

/**
 * Bildirim e-postasının ekrandaki durumu (DÖRT hâl). `b` yok / `null` → `okunamadi` (ne gönderileceği okunamıyor).
 * Uyarı çizilenler: `gonderilemedi`, `yapilandirilmamis`, `MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS`'ten eski `bekliyor` ve
 * OKUNAMAYAN durum. Süresi ölçülemeyen «bekliyor» TAZE SAYILMAZ («gönderiliyor» sahte güvence olurdu).
 */
export function bildirimGorunumu(b: MagazaBildirim | null | undefined, taban: string | undefined, simdiMs: number): BildirimGorunumu {
  if (!b) return { tur: 'uyari', neden: 'okunamadi' };
  if (b.durum === 'gitti') return { tur: 'isaretsiz' };
  if (b.durum === 'gonderilemedi' || b.durum === 'yapilandirilmamis') return { tur: 'uyari', neden: b.durum };
  if (b.durum !== 'bekliyor') return { tur: 'uyari', neden: 'okunamadi' };
  const baslangic = bildirimBeklemeBaslangiciMs(b, taban);
  if (baslangic === null) return { tur: 'uyari', neden: 'okunamadi' };
  return simdiMs - baslangic <= MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS ? { tur: 'gonderiliyor' } : { tur: 'uyari', neden: 'bekleme-asildi' };
}

/**
 * «Yeniden gönder» düğmesi (V22; kapı 4, Y1 — TEK ad): rozetin SONUCUNDAN türer; kopya `durum ===` karşılaştırması yok.
 * `gitti`de YOK (çift posta); taze `bekliyor` (`gonderiliyor`) ve `okunamadi`'da YOK. Küme açık yazılır: gelecekte eklenecek
 * bir `neden` sessizce kapsanmaz.
 */
export function magazaYenidenGonderilebilir(g: BildirimGorunumu): boolean {
  return g.tur === 'uyari' && (g.neden === 'gonderilemedi' || g.neden === 'yapilandirilmamis' || g.neden === 'bekleme-asildi');
}
