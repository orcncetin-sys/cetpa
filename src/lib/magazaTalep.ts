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
}

// ── Kalem teslim işareti (V6) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Kalem anahtarı — kurallı biçim, öncü sıfır YOK (kapı 3, K5): `b:01` desene uymaz; `b:1` ile `b:01` aynı dizine çözülüp
 * iki ayrı anahtar olmasın. Beyan kalemi `b:<dizin>` (dizin `kalemler` içindeki sıra; V16 gereği SABİT). Teyit kalemi (2b)
 * `t:<12 onaltılık>` — SUNUCU üretir, dizinle kaymaz. Beyan kaleminin `id`'si anahtar OLAMAZ (isteğe bağlı, boş olabilir,
 * tekil değil). Desen kurallı olduğu için yineleme denetimi METİN eşitliğiyle yeterlidir.
 */
export const MAGAZA_KALEM_ANAHTARI_DESENI = /^(b:(0|[1-9]\d{0,3})|t:[0-9a-f]{12})$/;

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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
