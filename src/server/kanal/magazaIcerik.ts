/**
 * magazaIcerik.ts — mağaza talebinin İÇERİK yazma yolu (dilim 2b, şartname v6 § 10.2): içerik düzenleme, yumuşak silme,
 * geri alma, ERP'de elle talep açma.
 *
 * ERP uçları (`routes/magazaErpRoutes.ts`) ve — yalnız silme için — site paneli (`routes/magazaPanelZinciri.ts`) bu
 * işlevleri çağırır; yazma kuralı tek yerdedir. `/api/db` bu koleksiyona YAZAMAZ (`SUNUCU_YAZAR_COLLECTIONS` değişmez).
 * Bağlam, yardımcılar ve ortak kurallar `kanal/magazaDurum.ts` ile AYNIDIR (kimlik deseni, dar okuma, koşullu yazım,
 * kapalı yama kümesi, `RETURNING` satırının yayını, elle kurulan denetim ayrıntısı, `toISOString()` zamanı) — oradan içe
 * aktarılır, kopyalanmaz.
 *
 * BU DOSYANIN EK KURALLARI:
 *  • MÜŞTERİNİN İLK TALEBİ DOKUNULMAZDIR (V16): `kalemler` ve `talepEdilen` hiçbir yamada YOKTUR. Personelin adet / fiyat /
 *    kalem değişikliği AYRI nesnededir (`teyit`); ekran ikisini yan yana basar.
 *  • PARA KURALI (V19): teyit kalemi `birimFiyat` KDV HARİÇ net; KDV oranı kalem başına; üç toplam SUNUCUDA, tam sayı kuruşla,
 *    TEK işlevle türetilir (`magazaTeyitToplamlari`) — istemciden toplam ALINMAZ. Herhangi bir fiyat `null` ise üçü de `null`.
 *  • KDV ORANININ KAYNAĞI sunucunun çıkarımıdır: personel verdiyse `personel`; vermediyse ERP ürün kaydından (`URUN_KDV_SQL` +
 *    `magazaUrunKdvOrani` + `magazaKdvVarsayilani`) — okunamayan oran 20 + `varsayilan` imi. Ürün okuması FIRLATIRSA yazım
 *    YAPILMAZ (rota 503): varsayılan 20 ile sessizce yazmak sahte kesinliktir. İSTİSNA (inceleme 2b, bulgu 1): oranı
 *    gönderilmeyen MEVCUT teyit kaleminin (`t:`) kayıtlı oranı ve kaynağı KORUNUR — `personel` her zaman, `urun` /
 *    `varsayilan` stok kodu değişmedikçe; ürün kaydından yeniden çözüm yalnız yeni kalemde, beyandan kopyada ve stok kodu
 *    değişen kalemde koşar (yalnız not düzenlemesi teyit tutarını değiştirmez).
 *  • İKİ SAYAÇ BAĞIMSIZDIR: içerik yazımı `icerikSurum`'u, aşama / kalem teslim / silme / geri alma `durumSurum`'u artırır.
 *    Silme `durumSurum`'u artırır ki bayat aşama ve kalem teslim ekranları 409 alıp silinmişi görsün.
 *  • `kalemTeslim` ve `bildirimRevize` yamaya GİRMEZ: ikisi yalnız `ICERIK_SQL` içinde, OKUNAN KOPYADAN DEĞİL satırın güncel
 *    değerinden türetilir (araya giren kalem teslim yazımı ya da işçinin `gitti` yazımı ezilmesin).
 *  • BİLDİRİM: yalnız içerik yazımı (revize bildirimi, ikinci kuyruk) ve elle talep (ilk bildirim, dilim 1 kuyruğu) ister;
 *    silme ve geri alma bildirim ÜRETMEZ (V20). İstek yazım GERÇEKTEN yapıldıysa ve dönüşten ÖNCE beklenir; kuyruğa ekleme
 *    başarısız olursa yazım geri alınmaz (belge `bekliyor` taşır; kaçan süpürmesi sahiplenir).
 *  • DENETİM ayrıntısına alan DEĞERİ, müşteri verisi, tutar, KDV oranı, kalem anahtarı, kopyalanan işaret sayısı GİRMEZ —
 *    yalnız talep no, kanal ve değişen alan ADLARI.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  MAGAZA_MUSTERI_ALANLARI, MAGAZA_REVIZE_ALANLARI, MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI,
  degisenAlanlar, magazaKalemAnahtariCoz, magazaKdvOraniMi, magazaKdvVarsayilani, magazaTabanSku, magazaTeyitToplamlari, magazaUrunKdvOrani,
} from '../../lib/magazaTalep.js';
import type {
  MagazaBildirimRevize, MagazaElle, MagazaKanal, MagazaKdvKaynagi, MagazaKdvOrani, MagazaRevizeAlani, MagazaSilindi, MagazaTalebi, MagazaTalepMusteri,
  MagazaTeyit, MagazaTeyitKalemi,
} from '../../lib/magazaTalep.js';
import {
  MAGAZA_SILINMEMIS_SQL, MAGAZA_SILINMIS_SQL, SILINDI_OKU_SQL, denetle, hataKodu, havuz, metin, nesneMi, yayinla, zaman,
} from './magazaDurum.js';
import type { MagazaDurumDeps, MagazaIcerikDeps, MagazaYazan, Satir } from './magazaDurum.js';
import { kalemEsle, musteriEsle, notEsle, talepEsle } from './magazaTalep.js';
import type { MagazaTalepGirdisi } from './magazaTalep.js';
import { EKLEME_SQL } from './magazaTalepSql.js';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes.js';

/**
 * Sürüm sayacının metni (`COALESCE(data->>'…Surum', '0')`) → sayı. Sayaçları yalnız bu modül ve `magazaDurum.ts` yazar, hep
 * tam sayı; başka bir değer bozuk kayıttır — üstüne `NaN + 1` (JSON'da `null`) yazmak yerine yüksek sesle dur.
 */
function surumSayisi(metinDegeri: string, alan: 'icerikSurum' | 'durumSurum'): number {
  const n = /^(0|[1-9]\d{0,14})$/.test(metinDegeri) ? Number(metinDegeri) : NaN;
  if (!Number.isSafeInteger(n)) throw new Error(`magazaIcerik: saklı ${alan} tam sayı değil — bozuk kayıt, yazılmadı`);
  return n;
}

// ── § 10.2 (a) İçerik düzenleme ─────────────────────────────────────────────────────────────────────────────────────

/** İstekteki teyit kalemi — şemadan (`schemas.ts` `ErpIcerikGovdesi`) çıkan, henüz TEMİZLENMEMİŞ biçim. */
export interface IcerikTeyitKalemGirdisi {
  /**
   * «Hangi kalem» bilgisi (işaret DEĞİL): mevcut teyit kaleminin `t:` anahtarı → aynı kalem, anahtar korunur; `b:<i>` → form bu
   * kalemi BEYANDAN kopyaladı (sunucu yeni `t:` üretir, beyan kaleminin teslim işaretini yeni anahtara kopyalar); yok → yeni kalem.
   */
  anahtar?: string;
  id?: string;
  sku?: string;
  ad: string;
  marka?: string;
  adet: number;
  /** KDV HARİÇ net; `null` = «fiyat sorulacak». */
  birimFiyat: number | null;
  /**
   * Verilmişse `MAGAZA_KDV_ORANLARI` içinde olmalı → kaynak `personel`. Verilmemişse: mevcut `t:` kaleminde kayıtlı oran ve
   * kaynak korunur (`urun` / `varsayilan` için stok kodu değişmediyse); öbür her durumda sunucu ürün kaydından çözer.
   */
  kdvOrani?: number;
  tedarik?: boolean;
}

export interface IcerikDegistirGirdisi {
  id: string;
  companyId: string;
  /** Ekranda görülen `icerikSurum` (CAS). */
  icerikSurum: number;
  /** YEDİ alan birden (`''` = boş): `||` sığ birleştirir, kısmi nesne eski alanları SİLERDİ. */
  musteri?: MagazaTalepMusteri;
  not?: string;
  teyit?: { kalemler: IcerikTeyitKalemGirdisi[] };
  kim: MagazaYazan;
  /** İçerik yalnız ERP'de düzenlenir (V15). */
  kanal: 'erp';
}

export type IcerikDegistirSonucu =
  /** `alanlar` = bu yazımda GERÇEKTEN değişen (ve yazılan) alan adları. */
  | { sonuc: 'tamam'; belge: Satir; alanlar: MagazaRevizeAlani[] }
  /** Verilen hiçbir alan saklıdan farklı değil: yazım, yayın, denetim, bildirim YOK (rota `200 { ok: true, degisti: false }`). */
  | { sonuc: 'degisiklik-yok' }
  | { sonuc: 'bulunamadi' }
  | { sonuc: 'silindi' }
  | { sonuc: 'surum-eski'; icerikSurum: number }
  | { sonuc: 'gecersiz' };

/** Dar okumanın HER ZAMAN okunan sütunları. */
const OKUMA_SABIT_SUTUNLARI = `jsonb_typeof(data->'silindi') AS silindi_turu, COALESCE(data->>'icerikSurum', '0') AS surum, data->>'talepNo' AS talep_no`;
/** Alan başına eski değer sütunu — YALNIZ `degisenAlanlar` karşılaştırması (ve teyitte anahtar denetimi) için. */
const OKUMA_ALAN_SUTUNLARI: Record<MagazaRevizeAlani, string> = {
  musteri: `data->'musteri' AS eski_musteri`,
  not: `data->>'not' AS eski_not`,
  teyit: `data->'teyit'->'kalemler' AS teyit_kalemleri, (CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN jsonb_array_length(data->'kalemler') ELSE 0 END) AS beyan_sayisi`,
};

/**
 * İçerik yazımının dar okumasının sütun listesi — verilen alanlara göre DİNAMİK (kapı 4, Y12): sabit sütunlar her zaman;
 * `eski_musteri` yalnız `musteri`, `eski_not` yalnız `not`, `teyit_kalemleri` + `beyan_sayisi` yalnız `teyit` verilmişse.
 * Parçalar bu dosyadaki SABİT dizgelerden seçilir: tanınmayan ad hiçbir şey üretmez, istek metni SQL'e GİRMEZ. Sıra sabittir
 * (`musteri`, `not`, `teyit`); yinelenen ad tek sütun üretir. Eski değerler denetime, günlüğe, yayına ve yamaya GİRMEZ.
 */
export function revizeOkumaSutunlari(alanlar: ReadonlyArray<MagazaRevizeAlani>): string {
  return [OKUMA_SABIT_SUTUNLARI, ...MAGAZA_REVIZE_ALANLARI.filter(a => alanlar.includes(a)).map(a => OKUMA_ALAN_SUTUNLARI[a])].join(', ');
}

/** Dar okumanın tam metni (kimlik + kiracı; tek satır). `talepEdilen`, `bildirim*`, `kalemTeslim`, `durumGecmisi` çekilmez. */
export function icerikOkuSql(alanlar: ReadonlyArray<MagazaRevizeAlani>): string {
  return `SELECT ${revizeOkumaSutunlari(alanlar)} FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;
}

/**
 * Teyit kalemlerinin KDV oranı için ERP ürün kaydının dar okuması: yalnız `inventory`, yalnız `sku` ve `vatRate` (ürün
 * belgesinin başka alanı belleğe çekilmez). $1 kiracı, $2 SKU dizisi (her kalemin `sku`'su VE `-Dnnn` son eki atılmış tabanı).
 * KİRACI KOŞULU depodaki JS kalıbıyla (`dc && dc !== companyId`) BİREBİR (kapı 4, Y11): yabancı kiracının kartı eşleşmez;
 * etiketsiz, `companyId: ''` ve `companyId: null` kart KENDİ sayılır (`->>` üçünde de NULL ya da `''` verir). Mikro'dan yeni
 * kolon OKUNMAZ; `vatRate`'i yazan üç yol (StokListesi importu, saatlik senkron, Paraşüt) bu dilimde değişmez.
 */
export const URUN_KDV_SQL = `SELECT data->>'sku' AS sku, data->'vatRate' AS vat_rate FROM docs WHERE coll = 'inventory' AND (data->>'companyId' = $1 OR data->>'companyId' IS NULL OR data->>'companyId' = '') AND data->>'sku' = ANY($2::text[])`;

/**
 * `URUN_KDV_SQL` okumasında fırlayan hata NESNELERİ (hata değiştirilmez / sarılmaz — ileti ve kod AYNEN yükselir; küme zayıf
 * tutar, bellek biriktirmez). Rota `talepIcerigiDegistir`'in fırlattığı hatayı bununla tanır: ürün KDV okuması → `503`
 * (yazım yapılmadı, varsayılan 20 ile sessizce yazılmaz); başka her hata → `500`.
 */
const urunKdvOkumaHatalari = new WeakSet<object>();
export function urunKdvOkumaHatasiMi(hata: unknown): boolean {
  return typeof hata === 'object' && hata !== null && urunKdvOkumaHatalari.has(hata);
}

/**
 * İçerik yazımı — TEK ifade. $4 yama (KAPALI küme: değişen `musteri` / `not` / `teyit`, kırpıldıysa `kirpildi`, her zaman
 * `icerikSurum` + `icerikZamani`), $5 okunan `icerikSurum` (CAS), $6 kalem teslim TAŞIMA eşlemesi `{ "<yeni t:>": "b:<i>" }`,
 * $7 `bildirimRevize` nesnesi (`{ durum: 'bekliyor', zaman, alanlar, kim, icerikSurum }` — `deneme` / `hataSinifi` yok: önceki
 * giriş ezilince düşer; birleştirme dalında da nesne $7'den kurulur, yalnız `alanlar` eskiyle birleşir), $8 bu revizyonun
 * `alanlar` DİZİSİ ($7.alanlar ile aynı değer).
 *  • TAŞIMA ($6): formun beyandan kopyaladığı kalemin teslim işareti, satırın GÜNCEL `kalemTeslim['b:<i>']` girişinden yeni
 *    `t:` anahtarına AYNEN kopyalanır (kim / zaman dâhil); beyan girişi SİLİNMEZ (tarihçe). `$6 = {}` → `kalemTeslim`'e
 *    DOKUNULMAZ (alan yoksa yaratılmaz). Girişi olmayan beyan kalemi kopyalanmaz (işaret yok = bekliyor).
 *  • REVİZE BİRLEŞTİRME: saklı revize bildirimi GİTMEMİŞ her durumda (`bekliyor` / `gonderilemedi` / `yapilandirilmamis`)
 *    gelen yeni revizyonda `alanlar` DİZİ olarak birleşir (yinelenen ad kalabilir; okuyan `alanlariBirlestir` ile
 *    tekilleştirir), `zaman` / `kim` / `icerikSurum` sonuncusunundur. Yalnız `gitti` (ve tanınmayan / çöp durum) nesneyi
 *    BÜTÜNÜYLE yeniler: gitmiş alan yeniden duyurulmaz. Gitmemiş önceki revizyonun alanları ezilseydi posta eksik alan
 *    bildirirdi (inceleme 2b, bulgu 10). Küme ADLI üç durumdur — `IS DISTINCT FROM 'gitti'` DEĞİL: tanınmayan durumda çöp
 *    `alanlar` da taşınırdı. BEDELİ: haftalar önce gitmemiş bir revizyonun alanları, yeni revizyonun postasına son revize
 *    edenin adı ve zamanıyla girer (`bekliyor` penceresinde zaten kabul edilen atıf; pencere süresiz genişledi).
 *    $8 AYRI parametredir ve birleştirme PARANTEZLİDİR: `… || $7::jsonb->'alanlar'` yazımı `||` ile aynı öncelikte sola
 *    bağlanıp `(… || $7)->'alanlar'` = NULL okunuyordu (PGlite 18.3, kapı 3 ölçümü — ikinci revizyonda `alanlar: null`).
 *    `alanlar` dizi değilse / `bildirimRevize` nesne değilse hata fırlatmaz.
 *  • Silinmiş satıra yazılmaz (V17). İlk bildirim alanı (`bildirim`) bu ifadede GEÇMEZ.
 */
export const ICERIK_SQL = `UPDATE docs SET data = (data || $4::jsonb) || (CASE WHEN $6::jsonb = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('kalemTeslim', (CASE WHEN jsonb_typeof(data->'kalemTeslim') = 'object' THEN data->'kalemTeslim' ELSE '{}'::jsonb END) || (SELECT COALESCE(jsonb_object_agg(e.key, data->'kalemTeslim'->e.value), '{}'::jsonb) FROM jsonb_each_text($6::jsonb) e WHERE jsonb_typeof(data->'kalemTeslim'->e.value) = 'object')) END) || jsonb_build_object('bildirimRevize', (CASE WHEN data->'bildirimRevize'->>'durum' IN ('bekliyor', 'gonderilemedi', 'yapilandirilmamis') THEN ($7::jsonb || jsonb_build_object('alanlar', (COALESCE(data->'bildirimRevize'->'alanlar', '[]'::jsonb) || $8::jsonb))) ELSE $7::jsonb END)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'icerikSurum', '0') = $5 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

interface IcerikSatiri { silindi: boolean; surum: string; talepNo: string; eskiMusteri: unknown; eskiNot: unknown; teyitKalemleri: unknown; beyanSayisi: number }

async function icerikOku(h: MagazaPgHavuzu, id: string, companyId: string, alanlar: ReadonlyArray<MagazaRevizeAlani>): Promise<IcerikSatiri | null> {
  const { rows } = await h.query(icerikOkuSql(alanlar), [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  if (!s) return null;
  const beyan = typeof s.beyan_sayisi === 'number' ? s.beyan_sayisi : Number(s.beyan_sayisi);
  return {
    silindi: s.silindi_turu === 'object', surum: metin(s.surum), talepNo: metin(s.talep_no), eskiMusteri: s.eski_musteri, eskiNot: s.eski_not,
    teyitKalemleri: s.teyit_kalemleri, beyanSayisi: Number.isSafeInteger(beyan) && beyan >= 0 ? beyan : 0,
  };
}

/** Teyit kalemi anahtarı: `t:` + 6 rastgele baytın 12 onaltılık hanesi (`MAGAZA_KALEM_ANAHTARI_DESENI`). */
export function teyitAnahtariUret(): string {
  return `t:${randomBytes(6).toString('hex')}`;
}

/** Aynı istekte üretim en çok bu kadar denenir (48 bit rastgelede çakışma pratikte yoktur; yine de denetlenir). */
const ANAHTAR_URETIM_DENEMESI = 8;

type TeyitHazirlamaSonucu =
  | { ok: true; kalemler: MagazaTeyitKalemi[]; /** `{ "<yeni t:>": "b:<i>" }` — yalnız beyandan kopyalanan kalemler. */ tasima: Record<string, string>; kirpildi: boolean }
  | { ok: false };

/**
 * Teyit kalemlerini kurar: temizlik (`kalemEsle` — dilim 1 ile AYNI kural), anahtar denetimi / ataması, KDV oranı çözümü.
 * `ok: false` = `gecersiz` (hiçbir şey yazılmaz). `URUN_KDV_SQL` okuması FIRLATIRSA bu işlev de fırlatır.
 */
async function teyitHazirla(D: MagazaIcerikDeps, h: MagazaPgHavuzu, companyId: string, girdi: IcerikTeyitKalemGirdisi[], okunan: IcerikSatiri): Promise<TeyitHazirlamaSonucu> {
  // En az 1 kalem: bütün kalemleri silmek isteyen talebi `iptal` eder (aşama).
  if (girdi.length === 0) return { ok: false };
  const eskiKalemler = new Map<string, Satir>();
  if (Array.isArray(okunan.teyitKalemleri)) {
    for (const k of okunan.teyitKalemleri) if (nesneMi(k) && typeof k.anahtar === 'string') eskiKalemler.set(k.anahtar, k);
  }

  // 1. Temizlik + anahtar denetimi (hepsi geçmeden hiçbir şey okunmaz / yazılmaz).
  interface Hazir { kalem: Omit<MagazaTeyitKalemi, 'anahtar' | 'kdvOrani' | 'kdvKaynagi'>; mevcut: string | null; beyan: string | null; istenenOran: MagazaKdvOrani | null }
  const hazir: Hazir[] = [];
  const gorulen = new Set<string>();
  let kirpildi = false;
  for (const k of girdi) {
    const esleme = kalemEsle({ ad: k.ad, adet: k.adet, id: k.id, sku: k.sku, marka: k.marka, birimFiyat: k.birimFiyat, tedarik: k.tedarik });
    if (!esleme.ok) return { ok: false };
    if (esleme.kirpildi) kirpildi = true;
    let istenenOran: MagazaKdvOrani | null = null;
    if (k.kdvOrani !== undefined) {
      if (!magazaKdvOraniMi(k.kdvOrani)) return { ok: false };
      istenenOran = k.kdvOrani;
    }
    let mevcut: string | null = null, beyan: string | null = null;
    if (k.anahtar !== undefined) {
      // Yineleme METİN eşitliğiyle (desen kurallı, öncü sıfırsız — K5).
      if (gorulen.has(k.anahtar)) return { ok: false };
      gorulen.add(k.anahtar);
      const cozum = magazaKalemAnahtariCoz(k.anahtar);
      if (cozum === null) return { ok: false };
      if (cozum.kaynak === 'teyit') {
        if (!eskiKalemler.has(k.anahtar)) return { ok: false };   // tanınmayan `t:`
        mevcut = k.anahtar;
      } else {
        if (cozum.dizin >= okunan.beyanSayisi) return { ok: false };   // aralık dışı `b:`
        beyan = k.anahtar;
      }
    }
    const { id, sku, ad, marka, adet, talepFiyat, tedarik } = esleme.kalem;
    hazir.push({ kalem: { id, sku, ad, marka, adet, birimFiyat: talepFiyat, tedarik }, mevcut, beyan, istenenOran });
  }

  // 2. KDV: personel verdiyse `personel`. Vermediyse — mevcut teyit kaleminin KAYITLI oranı ve kaynağı KORUNUR (form tam gövde
  //    gönderir ama yalnız bu oturumda seçilen oranı taşır): daha önce PERSONELİN seçtiği oran her zaman; `urun` / `varsayilan`
  //    kaynaklı oran stok kodu DEĞİŞMEDİKÇE. Yalnız notu düzenleyen kişinin kaydı — envanter arada değişmiş olsa bile — teyit
  //    tutarını sessizce değiştirmesin, `teyit.zaman` / `teyit.kim` de ona geçmesin (inceleme 2b, bulgu 1; formun önizlemesi
  //    de kayıtlı oranı basar). Ürün kaydından YENİDEN çözüm yalnız üç yerde: yeni kalem, beyandan kopya (`b:`) ve stok kodu
  //    değişen mevcut kalem. Kartı sonradan eşlenen `varsayilan` kalem kendiliğinden ürün oranına DÖNMEZ; oranı personel seçer.
  const kayitliOran = (z: Hazir): { kdvOrani: MagazaKdvOrani; kdvKaynagi: MagazaKdvKaynagi } | null => {
    if (z.mevcut === null) return null;
    const eski = eskiKalemler.get(z.mevcut);
    if (!eski || !magazaKdvOraniMi(eski.kdvOrani)) return null;
    const kaynak = eski.kdvKaynagi;
    if (kaynak === 'personel') return { kdvOrani: eski.kdvOrani, kdvKaynagi: kaynak };
    // `urun` / `varsayilan`: stok kodu DEĞİŞMEDİYSE kayıtlı oran korunur (formun `magazaTaslakKdv` kural 2'siyle birebir).
    if ((kaynak === 'urun' || kaynak === 'varsayilan') && eski.sku === z.kalem.sku) return { kdvOrani: eski.kdvOrani, kdvKaynagi: kaynak };
    return null;
  };
  const cozulecek = hazir.filter(z => z.istenenOran === null && kayitliOran(z) === null);
  const sorgulanan = new Set<string>();
  for (const z of cozulecek) {
    if (z.kalem.sku === '') continue;   // SKU'suz kalem sorguya GİRMEZ (→ `varsayilan`)
    sorgulanan.add(z.kalem.sku);
    const taban = magazaTabanSku(z.kalem.sku);
    if (taban !== null) sorgulanan.add(taban);
  }
  let urunSatirlari: Array<{ sku: string; vatRate: unknown }> = [];
  if (sorgulanan.size > 0) {
    // Okuma hatası YUTULMAZ: çağıran (rota) 503 döner, yazım yapılmaz. Hata AYNEN yükselir; yalnız «ürün KDV okuması»
    // diye işaretlenir ki rota onu öbür veritabanı hatalarından (500) ayırabilsin (`urunKdvOkumaHatasiMi`).
    let rows: Array<Record<string, unknown>>;
    try {
      ({ rows } = await h.query(URUN_KDV_SQL, [companyId, [...sorgulanan]]));
    } catch (e) {
      if (typeof e === 'object' && e !== null) urunKdvOkumaHatalari.add(e);
      throw e;
    }
    urunSatirlari = rows.flatMap(r => (typeof r.sku === 'string' ? [{ sku: r.sku, vatRate: r.vat_rate }] : []));
  }

  // 3. Anahtar ataması: üretilen `t:` okunan teyit anahtarlarıyla ve birbirleriyle ÇAKIŞMAZ.
  const kullanilan = new Set<string>(eskiKalemler.keys());
  const uret = (): string => {
    for (let i = 0; i < ANAHTAR_URETIM_DENEMESI; i++) {
      const a = (D.teyitAnahtariUret ?? teyitAnahtariUret)();
      if (magazaKalemAnahtariCoz(a)?.kaynak !== 'teyit') throw new Error('magazaIcerik: teyit anahtarı üreteci desene uymayan değer döndürdü');
      if (!kullanilan.has(a)) { kullanilan.add(a); return a; }
    }
    throw new Error('magazaIcerik: çakışmayan teyit anahtarı üretilemedi');
  };
  const tasima: Record<string, string> = {};
  const kalemler: MagazaTeyitKalemi[] = hazir.map(z => {
    const anahtar = z.mevcut ?? uret();
    if (z.beyan !== null) tasima[anahtar] = z.beyan;
    const korunan = kayitliOran(z);
    let kdv: { kdvOrani: MagazaKdvOrani; kdvKaynagi: MagazaKdvKaynagi };
    if (z.istenenOran !== null) kdv = { kdvOrani: z.istenenOran, kdvKaynagi: 'personel' };
    else if (korunan !== null) kdv = korunan;
    else kdv = magazaKdvVarsayilani(magazaUrunKdvOrani(urunSatirlari, z.kalem.sku));
    const { id, sku, ad, marka, adet, birimFiyat, tedarik } = z.kalem;
    return { anahtar, id, sku, ad, marka, adet, birimFiyat, kdvOrani: kdv.kdvOrani, kdvKaynagi: kdv.kdvKaynagi, tedarik };
  });
  return { ok: true, kalemler, tasima, kirpildi };
}

export async function talepIcerigiDegistir(D: MagazaIcerikDeps, g: IcerikDegistirGirdisi): Promise<IcerikDegistirSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  // En az bir alan verilmiş olmalı (rota şeması da süzer).
  const verilen: MagazaRevizeAlani[] = MAGAZA_REVIZE_ALANLARI.filter(a => g[a] !== undefined);
  if (verilen.length === 0) return { sonuc: 'gecersiz' };
  const h = havuz(D);
  const okunan = await icerikOku(h, g.id, g.companyId, verilen);
  if (!okunan) return { sonuc: 'bulunamadi' };
  if (okunan.silindi) return { sonuc: 'silindi' };
  const okunanSurum = surumSayisi(okunan.surum, 'icerikSurum');
  if (okunanSurum !== g.icerikSurum) return { sonuc: 'surum-eski', icerikSurum: okunanSurum };

  // Temizlik. `telefonSon10`, `talepNo` ve kimlik DEĞİŞMEZ (V21): takip ilk telefonla çalışır.
  const kirpilan = new Set<MagazaRevizeAlani>();
  let musteri: MagazaTalepMusteri | undefined;
  if (g.musteri !== undefined) {
    const ham = g.musteri;
    // Şemasız çağrıya karşı: yedi alanın yedisi de dizge olmalı (kısmi nesne `||` ile eski alanları silerdi).
    if (!nesneMi(ham) || !MAGAZA_MUSTERI_ALANLARI.every(a => typeof ham[a] === 'string')) return { sonuc: 'gecersiz' };
    const esleme = musteriEsle(ham);
    if (!esleme.ok) return { sonuc: 'gecersiz' };
    musteri = esleme.musteri;
    if (esleme.kirpildi) kirpilan.add('musteri');
  }
  let not: string | undefined;
  if (g.not !== undefined) {
    if (typeof g.not !== 'string') return { sonuc: 'gecersiz' };
    const esleme = notEsle(g.not);
    not = esleme.not;
    if (esleme.kirpildi) kirpilan.add('not');
  }
  let teyitKalemleri: MagazaTeyitKalemi[] | undefined;
  let tasima: Record<string, string> = {};
  if (g.teyit !== undefined) {
    if (!nesneMi(g.teyit) || !Array.isArray(g.teyit.kalemler)) return { sonuc: 'gecersiz' };
    const hazir = await teyitHazirla(D, h, g.companyId, g.teyit.kalemler, okunan);
    if (!hazir.ok) return { sonuc: 'gecersiz' };
    teyitKalemleri = hazir.kalemler;
    tasima = hazir.tasima;
    if (hazir.kirpildi) kirpilan.add('teyit');
  }

  // «Ne değişti» SUNUCUDA ölçülür (form her zaman tam gövde gönderir). Eski değerler yalnız bu karşılaştırmaya girer.
  const alanlar = degisenAlanlar(
    { musteri: okunan.eskiMusteri, not: okunan.eskiNot, teyit: { kalemler: okunan.teyitKalemleri } },
    { ...(musteri !== undefined ? { musteri } : {}), ...(not !== undefined ? { not } : {}), ...(teyitKalemleri !== undefined ? { teyit: { kalemler: teyitKalemleri } } : {}) },
  );
  if (alanlar.length === 0) return { sonuc: 'degisiklik-yok' };

  // Yama: YALNIZ gerçekten değişen alanlar (değişmeyen `teyit` yeniden yazılsaydı `teyit.zaman` / `teyit.kim` notu düzenleyen
  // kişiye geçerdi). `kalemler`, `talepEdilen`, `telefonSon10`, `talepNo`, `olusturma`, `companyId`, `durum*`, `bildirim`,
  // `silindi`, `elle`, `kalemTeslim`, `bildirimRevize` yamaya GİREMEZ.
  const simdi = zaman(D);
  const yeniSurum = okunanSurum + 1;
  const kim = { uid: g.kim.uid, ad: g.kim.ad };
  const degisti = (a: MagazaRevizeAlani): boolean => alanlar.includes(a);
  const teyit: MagazaTeyit | undefined = teyitKalemleri !== undefined && degisti('teyit')
    ? { kalemler: teyitKalemleri, ...magazaTeyitToplamlari(teyitKalemleri), zaman: simdi, kim }
    : undefined;
  const yama = {
    ...(musteri !== undefined && degisti('musteri') ? { musteri } : {}),
    ...(not !== undefined && degisti('not') ? { not } : {}),
    ...(teyit !== undefined ? { teyit } : {}),
    ...(alanlar.some(a => kirpilan.has(a)) ? { kirpildi: true as const } : {}),
    icerikSurum: yeniSurum, icerikZamani: simdi,
  };
  const revize: MagazaBildirimRevize = { durum: 'bekliyor', zaman: simdi, alanlar, kim, icerikSurum: yeniSurum };
  const { rows } = await h.query(ICERIK_SQL, [
    MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), okunan.surum,
    JSON.stringify(teyit !== undefined ? tasima : {}), JSON.stringify(revize), JSON.stringify(alanlar),
  ]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    // Araya başka yazım girdi (içerik yazımı ya da silme): yeniden okunur.
    const guncel = await icerikOku(h, g.id, g.companyId, []);
    if (!guncel) return { sonuc: 'bulunamadi' };
    if (guncel.silindi) return { sonuc: 'silindi' };
    if (guncel.surum !== okunan.surum) return { sonuc: 'surum-eski', icerikSurum: surumSayisi(guncel.surum, 'icerikSurum') };
    throw new Error('magazaIcerik: içerik yazımı satır döndürmedi');
  }

  yayinla(D, g.id, satir);
  await denetle(D, g.kim, 'Mağaza talebi içeriği', `${okunan.talepNo} · ${g.kanal} · ${alanlar.join(', ')}`);
  // Revize bildirimi: yalnız satır GERÇEKTEN yazıldıysa ve dönüşten ÖNCE (sözleşmece reddetmez; reddederse yazım geri alınmaz).
  try {
    await D.revizeBildirimiIste(g.id);
  } catch (e) {
    console.error('[magaza-icerik] içerik yazıldı, revize bildirimi istenemedi:', hataKodu(e));
  }
  return { sonuc: 'tamam', belge: satir, alanlar };
}

// ── § 10.2 (b), (c) Yumuşak silme ve geri alma (V17) ────────────────────────────────────────────────────────────────

export interface TalepSilGirdisi {
  id: string;
  companyId: string;
  /** Ekranda görülen `durumSurum` (teslim'e geçmiş talep bayat ekrandan silinmesin). */
  surum: number;
  kim: MagazaYazan;
  kanal: MagazaKanal;
}

export type TalepSilSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  | { sonuc: 'zaten-silindi' }
  | { sonuc: 'surum-eski'; surum: number };

/**
 * Yumuşak silme: kayıt DURUR, `silindi` işareti alır. $4 yama KAPALI: `{ silindi: { zaman, kim, kanal }, durumSurum }` —
 * `durumZamani`'ye DOKUNULMAZ (kapanış zamanı değildir), `kalemTeslim` / `bildirim` / `bildirimRevize` / `icerikSurum`
 * yamaya GİRMEZ. $5 okunan `durumSurum`. Zaten silinmiş satıra yazılmaz (iki eşzamanlı silmeden biri 0 satır alır).
 */
export const SIL_SQL = `UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $5 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

/**
 * Geri alma: yalnız SİLİNMİŞ satıra. $4 yama KAPALI: `{ silindi: null, durumSurum }` — alan açıkça JSON `null` yazılır (`||`
 * alan silemez); `null` nesne değildir, talep yeniden canlıdır (takip ucunda yeniden bulunur). $5 okunan `durumSurum`.
 */
export const GERI_AL_SQL = `UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $5 AND ${MAGAZA_SILINMIS_SQL} RETURNING data`;

interface SilSatiri { surum: string; talepNo: string; silindi: boolean }

async function silOku(h: MagazaPgHavuzu, id: string, companyId: string): Promise<SilSatiri | null> {
  const { rows } = await h.query(SILINDI_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  return s ? { surum: metin(s.surum), talepNo: metin(s.talep_no), silindi: s.silindi_turu === 'object' } : null;
}

/** Site paneli (yalnız Yönetici) ve ERP ortak çağırır — dar bağlam yeter (bildirim istenmez). Yetki rotada: `magazaTalepSilmeYetkisi`. */
export async function talepSil(D: MagazaDurumDeps, g: TalepSilGirdisi): Promise<TalepSilSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  const h = havuz(D);
  const okunan = await silOku(h, g.id, g.companyId);
  if (!okunan) return { sonuc: 'bulunamadi' };
  if (okunan.silindi) return { sonuc: 'zaten-silindi' };
  const okunanSurum = surumSayisi(okunan.surum, 'durumSurum');
  if (okunanSurum !== g.surum) return { sonuc: 'surum-eski', surum: okunanSurum };

  const silindi: MagazaSilindi = { zaman: zaman(D), kim: { uid: g.kim.uid, ad: g.kim.ad }, kanal: g.kanal };
  const yama = { silindi, durumSurum: okunanSurum + 1 };
  const { rows } = await h.query(SIL_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), okunan.surum]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    const guncel = await silOku(h, g.id, g.companyId);
    if (!guncel) return { sonuc: 'bulunamadi' };
    if (guncel.silindi) return { sonuc: 'zaten-silindi' };
    if (guncel.surum !== okunan.surum) return { sonuc: 'surum-eski', surum: surumSayisi(guncel.surum, 'durumSurum') };
    throw new Error('magazaIcerik: silme yazımı satır döndürmedi');
  }
  // Kayıt silinmedi, işaret aldı: akışa `set` olayı gider (ekran satırı «Silindi» rozetiyle günceller).
  yayinla(D, g.id, satir);
  await denetle(D, g.kim, 'Mağaza talebi silindi', `${okunan.talepNo} · ${g.kanal}`);
  return { sonuc: 'tamam', belge: satir };
}

export interface TalepGeriAlGirdisi {
  id: string;
  companyId: string;
  /** Ekranda görülen `durumSurum` (silme onu artırmıştır; akıştan gelen güncel değer). */
  surum: number;
  kim: MagazaYazan;
}

export type TalepGeriAlSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  /** Geri alınacak bir şey yok: talep silinmiş değil (rota `409 { kod: 'silinmemis' }`). */
  | { sonuc: 'silinmemis' }
  | { sonuc: 'surum-eski'; surum: number };

/** Yalnız ERP (panelden geri alma YOK — V18). Yetki rotada: `magazaTalepSilmeYetkisi`. */
export async function talepGeriAl(D: MagazaDurumDeps, g: TalepGeriAlGirdisi): Promise<TalepGeriAlSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  const h = havuz(D);
  const okunan = await silOku(h, g.id, g.companyId);
  if (!okunan) return { sonuc: 'bulunamadi' };
  if (!okunan.silindi) return { sonuc: 'silinmemis' };
  const okunanSurum = surumSayisi(okunan.surum, 'durumSurum');
  if (okunanSurum !== g.surum) return { sonuc: 'surum-eski', surum: okunanSurum };

  const yama = { silindi: null, durumSurum: okunanSurum + 1 };
  const { rows } = await h.query(GERI_AL_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), okunan.surum]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    const guncel = await silOku(h, g.id, g.companyId);
    if (!guncel) return { sonuc: 'bulunamadi' };
    if (!guncel.silindi) return { sonuc: 'silinmemis' };
    if (guncel.surum !== okunan.surum) return { sonuc: 'surum-eski', surum: surumSayisi(guncel.surum, 'durumSurum') };
    throw new Error('magazaIcerik: geri alma yazımı satır döndürmedi');
  }
  yayinla(D, g.id, satir);
  await denetle(D, g.kim, 'Mağaza talebi geri alındı', `${okunan.talepNo} · erp`);
  return { sonuc: 'tamam', belge: satir };
}

// ── § 10.2 (d) ERP'de elle talep açma (V15, V20) ────────────────────────────────────────────────────────────────────

/** Elle talebin gövdesi: `MagazaSiparisTalebiSchema`'nın `no` ve `tarih`'siz hâli (`schemas.ts` `ErpElleTalepGovdesi`). */
export type ElleTalepGovdesi = Omit<MagazaTalepGirdisi, 'no' | 'tarih'>;

export interface ElleTalepGirdisi {
  companyId: string;
  girdi: ElleTalepGovdesi;
  kim: MagazaYazan;
}

export type ElleTalepSonucu =
  | { sonuc: 'tamam'; id: string; talepNo: string; belge: MagazaTalebi }
  /** Temizlikten sonra zorunlu alan boş ya da telefonda 10 rakam yok (takip ucu aynı `no` + telefonla çalışır — V20). */
  | { sonuc: 'gecersiz' }
  /** Üretilen talep numarası art arda `ELLE_TALEP_DENEME_SINIRI` kez mevcut kayıtla çakıştı (rota 503). */
  | { sonuc: 'cakisti' };

/** `ON CONFLICT … DO NOTHING` 0 satır dönerse yeni numarayla en çok bu kadar denenir. */
export const ELLE_TALEP_DENEME_SINIRI = 3;

const NO_ALFABESI = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Gün İSTANBUL saatiyle: sürecin saat dilimine güvenilmez (sunucu bir dönem Pasifik saatindeydi). */
const ISTANBUL_GUNU = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: '2-digit', month: '2-digit', day: '2-digit' });

/**
 * Elle talebin numarası — mağazanın ürettiği biçimle AYNI (`MAGAZA_TALEP_NO_DESENI`): `T` + yyaagg (İstanbul günü) + `-` +
 * 4 karakter `[A-Z0-9]` (kripto rastgele). Kimlik türetimi dilim 1'le aynıdır: takip ucu bu `no` + telefonla sorgulanır.
 */
export function elleTalepNoUret(simdi: Date): string {
  const parcalar = ISTANBUL_GUNU.formatToParts(simdi);
  const parca = (tur: 'year' | 'month' | 'day'): string => parcalar.find(p => p.type === tur)?.value ?? '';
  let sonek = '';
  for (let i = 0; i < 4; i++) sonek += NO_ALFABESI.charAt(randomInt(NO_ALFABESI.length));
  return `T${parca('year')}${parca('month')}${parca('day')}-${sonek}`;
}

export async function elleTalepAc(D: MagazaIcerikDeps, g: ElleTalepGirdisi): Promise<ElleTalepSonucu> {
  const h = havuz(D);
  const simdi = D.simdi?.() ?? new Date();
  const elle: MagazaElle = { zaman: simdi.toISOString(), kim: { uid: g.kim.uid, ad: g.kim.ad } };
  for (let deneme = 0; deneme < ELLE_TALEP_DENEME_SINIRI; deneme++) {
    const no = (D.elleNoUret ?? elleTalepNoUret)(simdi);
    // Üreteç hatası girdi hatası DEĞİLDİR: `gecersiz` (400) yerine yüksek sesle dur.
    if (!MAGAZA_TALEP_NO_DESENI.test(no)) throw new Error('magazaIcerik: elle talep numarası üreteci desene uymayan değer döndürdü');
    // Aynı temizlik / kırpma / kimlik (dilim 1 eşleyicisi); `bildirim: { durum: 'bekliyor', zaman }` oradan gelir.
    const esleme = talepEsle({ ...g.girdi, no, tarih: undefined }, { companyId: g.companyId, simdi });
    if (!esleme.ok) return { sonuc: 'gecersiz' };
    const belge: MagazaTalebi = { ...esleme.belge, istemciTarihi: null, elle };
    const { rows } = await h.query(EKLEME_SQL, [MAGAZA_TALEP_KOLEKSIYONU, esleme.id, JSON.stringify(belge)]);
    if (rows.length !== 1) continue;   // çakıştı: mevcut kayda dokunulmadı; yayın / bildirim / denetim YOK → yeni numara

    // Satır yazıldı: bundan sonra hiçbir şey sonucu DEĞİŞTİREMEZ (yayın, bildirim ya da denetim arızası talebi geri almaz).
    yayinla(D, esleme.id, { ...belge });
    // İlk bildirim — mağazadan gelen taleple AYNI kuyruk, aynı işçi, aynı gövde kalıbı (elle talep AYIRT EDİLMEZ).
    try {
      await D.bildirimIste(esleme.id);
    } catch (e) {
      console.error('[magaza-icerik] elle talep yazıldı, bildirim istenemedi:', hataKodu(e));
    }
    await denetle(D, g.kim, 'Mağaza talebi elle açıldı', `${belge.talepNo} · erp`);
    return { sonuc: 'tamam', id: esleme.id, talepNo: belge.talepNo, belge };
  }
  return { sonuc: 'cakisti' };
}
