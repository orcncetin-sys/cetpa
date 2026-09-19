/**
 * govdeFaturaIrsaliye.ts — Mikro'ya YAZILAN e-Fatura / e-İrsaliye gövdeleri (Faz 3 3/n, 2026-09-19).
 * SAF: ağ, DB, express yok. Test: govdeFaturaIrsaliye.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — rotadaki (src/server/routes/mikroRoutes.ts) iki gövde, karşı tarafın
 * DEFTERİNE bilinmeyen değerleri uydurarak yazıyordu. Sökülen sahte-varsayılan siteleri
 * (satır numaraları 2026-09-19 hâli):
 *
 *   /api/mikro/fatura/kaydet  (~3954-4121)
 *     :3976  `Number(order.kdvOran ?? 20)`              → KDV oranı bilinmiyorsa %20 uydurup
 *                                                         sth_vergi'yi (VERGİ TUTARI) ona göre yazıyordu
 *     :3985  `Number(item.price ?? 0) * Number(item.quantity ?? 1)`
 *                                                       → fiyatsız satır 0 ₺, miktarsız satır 1 adet
 *     :3997  `Number(item.quantity ?? 1)`               → aynı, sth_miktar
 *     :3992  `kdvOran >= 20 ? 4 : >= 10 ? 3 : 1`        → vergi işaretçisi TAHMİNİ (Mikro'nun kendi
 *                                                         vergi tablosu hiç okunmuyordu)
 *   /api/mikro/irsaliye/kaydet (~4122-4226)
 *     :4143  `Number(item.quantity ?? 1)` / `: 1`       → kalemsiz sevkiyatta "1 adet"
 *     :4145  `Number(item.price ?? 0) * ... : 0`        → kalemsiz sevkiyatta 0 ₺'lik SAHTE belge
 *     :4146  `sth_vergi_pntr: 4`                        → sabit tahmin
 *     :4152  `sth_giris_depo_no: 1 / sth_cikis_depo_no: 1` → SABİT DEPO 1 = HAVALİMANI
 *
 * Son sitenin bedeli ölçüldü: 2026-09-05'te yedi ayrı gövde üreticisi her kaydı depo 1
 * yazıyordu, mal ise depo 2 (ESKİ SANAYİ)'deydi — hata SESSİZDİ, çünkü varsayılan değer
 * geçerli bir Mikro kaydı üretir. Sözleşme (CLAUDE.md, `src/services/mikroEvrak.ts`
 * `depoGerekli`): DIŞ SİSTEME YAZAN GÖVDEDE VARSAYILAN YOKTUR. Bilinmeyen alan →
 * `throw new MikroGovdeHatasi(alan, satirNo?)`; rota 400 döner ve `mikroPost` HİÇ çağrılmaz.
 *
 * PARİTE: bilinen girdide üretilen gövde eski kodun ürettiğinin BİREBİR aynısı — sabit
 * Mikro kodları (evraktip 4/1, seri 'F'/'I', cha_evrak_tip 63, cha_cinsi 7, cha_tip 0,
 * sth_tip 1, birim_pntr 1), alan adları ve sth_vergi yuvarlaması (`round(tutar*oran)/100`)
 * korunur; testte `toEqual` ile kilitli.
 *
 * BİLİNÇLİ FARKLAR (parite dışı, hepsi "uydurma değer yazma" kuralının sonucu):
 *   1. Bilinmeyen fiyat/miktar/KDV oranı/cari kod/tarih/kalem yokluğu → throw (eskiden sessiz varsayılan).
 *   2. Vergi işaretçisi Mikro'nun VergiListesiV2 tablosundan TERS arama ile; bulunamazsa throw.
 *   3. İrsaliyede depo çağırandan gelir (`depoGerekli` sözleşmesi); yoksa throw.
 *   4. Tarih `zamanDate` ile çözülür: TR biçimi (`19.09.2026`) artık doğru okunur; eski
 *      `new Date(str)` onu Invalid Date yapıp gövdeye "NaN.NaN.NaN" yazıyordu.
 *   5. Kalemin STOK KODU boşsa throw (2026-09-19 hakem bulgusu). Eskiden — ilk taşımada
 *      da — `sth_stok_kod: metin(kalem.sku)` yazılıyordu, yani SKU'suz kalem Mikro
 *      defterine kodu boş, SAHİPSİZ bir stok hareketi düşürüyordu; aynı modül kalemsiz
 *      irsaliyeyi zaten bu gerekçeyle reddediyor, kardeş gövde (govdeSiparis) aynı
 *      alanda throw ediyordu. Şema `sku`yu optional bırakıyor (schemas.ts), yani
 *      doğrulanmış gövde bile SKU'suz kalem taşıyabilir — kapı burada.
 *
 * AÇIK MADDE — FATURA SATIRINDA DEPO: `sth_giris_depo_no/sth_cikis_depo_no` fatura
 * tarafında hâlâ 1. Bu, irsaliyedekiyle AYNI arıza sınıfı, ama burada throw'a çevirmek
 * e-Fatura kesmeyi (yasal belge) tamamen durdurur ve hiçbir çağıran bugün depo
 * göndermiyor. Bu yüzden eski davranış AYNEN korundu, ama artık `secenek.depoNo` ile
 * geçersiz kılınabiliyor (çağıran depo öğrenir öğrenmez tek satırla bağlanır) ve karar
 * kullanıcıya açık madde olarak taşındı. Ayrıca çıkış faturasında giriş deposunun 0
 * olması gerekip gerekmediği TEYİTSİZ (`mikroEvrak.ts` deseni `type==='in' ? depo : 0`).
 */
import { bilinenSayi, satirTutari, kurusaYuvarla } from '../../utils/para.js';
import { zamanDate } from '../../utils/zaman.js';
import { MikroGovdeHatasi } from './govdeHatasi.js';
import { vergiIsaretcisiCoz } from './vergiIsaretci.js';

// ── Girdi tipleri ────────────────────────────────────────────────────────────
// Alanlar bilerek `unknown`: bu modül şemadan (zod) SONRA da tek kapı olmalı —
// IrsaliyeKaydetSchema'da `price` optional, dolayısıyla doğrulanmış gövde bile
// bilinmeyen para taşıyabiliyor.

/** Fatura/irsaliye kalemi — şemanın (schemas.ts) doğruladığı alanların gevşek karşılığı. */
export interface GovdeKalemi {
  sku?: unknown;
  name?: unknown;
  quantity?: unknown;
  price?: unknown;
}

export interface FaturaGirdisi {
  mikroCariKod?: unknown;
  lineItems?: readonly GovdeKalemi[];
  /** 'e-fatura' | 'e-arsiv' | 'ihracat'; yoksa e-Fatura sayılır (eski davranış). */
  faturaTipi?: unknown;
  /** KDV yüzdesi. Bilinmiyorsa VARSAYILMAZ — throw. */
  kdvOran?: unknown;
  createdAt?: unknown;
}

export interface IrsaliyeGirdisi {
  mikroCariKod?: unknown;
  customerName?: unknown;
  destination?: unknown;
  trackingNo?: unknown;
  cargoFirm?: unknown;
  kdvOran?: unknown;
  items?: readonly GovdeKalemi[];
  date?: unknown;
  /** Sevk deposu — kayıtta varsa buradan okunur (seçenekteki önceliklidir). */
  depoNo?: unknown;
}

// ── Seçenekler ───────────────────────────────────────────────────────────────
export interface FaturaSecenekleri {
  /** `mikroVergiOranlari()` çıktısı: vergiSiraNo → oran (%). Ters arama için. */
  vergiTablosu: ReadonlyMap<number, number>;
  /** `MIKRO_JUMP_SURUM` — 17+ ise `cha_ebelge_turu` gönderilir. Env okumak SAF modülün işi değil. */
  jumpSurum: number;
  /** Belge tarihi yoksa kullanılacak "şimdi" — yalnız test saati enjeksiyonu. */
  simdi?: Date;
  /** Fatura satırı deposu. Verilmezse eski davranış (1) korunur — bkz. başlıktaki AÇIK MADDE. */
  depoNo?: unknown;
}

export interface IrsaliyeSecenekleri {
  vergiTablosu: ReadonlyMap<number, number>;
  /** Sevk deposu. Bilinmiyorsa belge Mikro'ya GİTMEZ (depoGerekli sözleşmesi). */
  depoNo?: unknown;
  simdi?: Date;
}

// ── Çıktı tipleri ────────────────────────────────────────────────────────────
export interface FaturaSatiri {
  sth_tarih: string; sth_tip: number; sth_cins: number; sth_normal_iade: number;
  sth_evraktip: number; sth_evrakno_seri: string;
  sth_stok_kod: string; sth_cari_cinsi: number; sth_cari_kodu: string;
  sth_miktar: number; sth_birim_pntr: number; sth_tutar: number;
  sth_vergi: number; sth_vergi_pntr: number; sth_vergisiz_fl: boolean;
  sth_aciklama: string;
  sth_cari_srm_merkezi: string; sth_stok_srm_merkezi: string;
  sth_subeno: number; sth_giris_depo_no: number; sth_cikis_depo_no: number;
}

export interface FaturaEvraki {
  cha_tip: number; cha_cinsi: number; cha_normal_Iade: number; cha_evrak_tip: number;
  cha_cari_cins: number; cha_ebelge_turu?: number;
  cha_d_cins: number; cha_d_kur: number; cha_tarihi: string; cha_evrakno_seri: string;
  cha_kod: string; cha_projekodu: string; cha_srmrkkodu: string;
  cha_vade: number; cha_subeno: number; cha_aciklama: string; kdv_istisna_kodu: string;
  detay: FaturaSatiri[];
}

export interface FaturaGovdesiSonucu {
  evrak: FaturaEvraki;
  /** `evrak.detay` ile AYNI dizi — rota bunu ayrıca `mikro_stok_hareketleri`'ne aynalıyor. */
  satirlar: FaturaSatiri[];
  /** `cha_meblag` aynası için satır tutarları toplamı. */
  toplamTutar: number;
  /** `DD.MM.YYYY` — rota `orders/{id}.mikroFaturaDate` olarak geri yazıyor. */
  faturaDate: string;
}

export interface IrsaliyeSatiri {
  sth_tarih: string; sth_tip: number; sth_cins: number; sth_normal_iade: number;
  sth_evraktip: number; sth_evrakno_seri: string;
  sth_stok_kod: string; sth_cari_cinsi: number; sth_cari_kodu: string;
  sth_miktar: number; sth_birim_pntr: number; sth_tutar: number;
  sth_vergi_pntr: number; sth_vergi: number; sth_vergisiz_fl: boolean;
  sth_iskonto1: number; sth_iskonto2: number;
  sth_aciklama: string;
  sth_giris_depo_no: number; sth_cikis_depo_no: number; sth_subeno: number;
  sth_malkbl_sevk_tarihi: string;
}

export interface IrsaliyeEvraki {
  evrak_aciklamalari: { aciklama: string }[];
  e_irsaliye_detaylari: {
    eir_tasiyici_firma_kodu: string;
    eir_tasiyici_arac_plaka: string;
    eir_eirs_olrk_gonderilsin: number;
  };
  satirlar: IrsaliyeSatiri[];
}

export interface IrsaliyeGovdesiSonucu {
  evrak: IrsaliyeEvraki;
  /** `evrak.satirlar` ile AYNI dizi (rota aynalıyor). */
  satirlar: IrsaliyeSatiri[];
  irsDate: string;
}

// ── Ortak kapılar ────────────────────────────────────────────────────────────
/** Bilinen sonlu sayı; değilse gövde Mikro'ya GİTMEZ. `bilinenSayi` tek kaynak (utils/para). */
function sayiGerekli(deger: unknown, alan: string, satirNo?: number, aciklama?: string): number {
  if (!bilinenSayi(deger)) throw new MikroGovdeHatasi(alan, satirNo, aciklama);
  return Number(deger);
}

/** Boş olmayan metin (cari kod gibi kimlik alanları); `''` yazmak sahipsiz evrak demektir. */
function metinGerekli(deger: unknown, alan: string): string {
  const s = typeof deger === 'string' ? deger.trim() : '';
  if (!s) throw new MikroGovdeHatasi(alan);
  return s;
}

/** Serbest metin alanı (açıklama, plaka, adres) — para değil, boş kalabilir (eski davranış). */
function metin(deger: unknown): string {
  return typeof deger === 'string' ? deger : '';
}

/**
 * Kalemin stok kodu (`sth_stok_kod`). Boşsa gövde Mikro'ya GİTMEZ.
 *
 * `sth_*` satırı bir STOK HAREKETİDİR; stok kodu onun kimliğidir. Eski kod burada
 * `metin(kalem.sku)` yazıyordu, yani SKU'suz kalemde Mikro defterine kodu boş —
 * sahipsiz — bir hareket düşüyordu. Aynı modül kalemsiz irsaliyeyi tam bu gerekçeyle
 * reddediyor ("tamamen uydurma bir stok hareketi") ve kardeş gövde (govdeSiparis)
 * aynı alanda throw ediyordu; fatura/irsaliye satırı bu kapının dışında kalmıştı
 * (hakem bulgusu 2026-09-19). Şema `sku`yu optional bıraktığı için doğrulanmış
 * gövde bile SKU'suz kalem taşıyabiliyor — tek kapı burasıdır.
 *
 * Sayı da kabul edilir (doc id'leri sayı gelebiliyor) — `metinGerekli`den farkı bu.
 */
function stokKoduGerekli(deger: unknown, satirNo: number): string {
  if (typeof deger === 'number' && Number.isFinite(deger)) return String(deger);
  const s = typeof deger === 'string' ? deger.trim() : '';
  if (!s) throw new MikroGovdeHatasi('stok kodu', satirNo);
  return s;
}

/**
 * Depo numarası — `src/services/mikroEvrak.ts` `depoGerekli` ile AYNI sözleşme
 * (0/negatif/sayı-olmayan reddedilir). Oraya import bağı KURULMADI: o dosya istemci
 * tarafı (Firestore/tip zinciri taşır), sunucudan import etmek istemci grafiğini
 * sunucuya sokardı — sözleşme aynı, gerçekleştirim ayrı.
 */
function depoGerekli(deger: unknown, alan = 'depo numarası'): number {
  const n = Number(deger);
  if (!Number.isFinite(n) || n <= 0) throw new MikroGovdeHatasi(alan);
  return n;
}

/**
 * `DD.MM.YYYY` — Mikro evrak tarihi. Ham değer YOKSA belge bugün kesiliyor demektir
 * (eski davranış: `new Date()`), ama VARSA ve çözülemiyorsa gövdeye "NaN.NaN.NaN"
 * yazmak yerine yüksek sesle düşülür.
 */
function mikroTarihi(ham: unknown, simdi: Date, alan: string): string {
  const bos = ham === undefined || ham === null || (typeof ham === 'string' && ham.trim() === '');
  const d = bos ? simdi : zamanDate(ham);
  if (!d || !Number.isFinite(d.getTime())) {
    throw new MikroGovdeHatasi(alan, undefined, `"${String(ham)}" tarih olarak çözülemedi`);
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// KDV yüzdesinden Mikro vergi işaretçisini (vergiSiraNo) TERS arama ile bulmak TEK
// KAYNAKTA: ./vergiIsaretci.ts. Eski rota `oran >= 20 ? 4 : >= 10 ? 3 : 1` diye TAHMİN
// ediyordu — sıra numaraları firma veritabanına göre değişir, tahmin faturaya yanlış
// vergi kodu yazar. Burada yerel bir kopya duruyordu ve toleransı 1e-9'du; kardeş
// gövde (sipariş) 1e-6, stok kartı ise KESİN eşitlik kullanıyordu, yani Mikro tablosu
// oranı float döndürdüğünde aynı mal siparişte geçip faturasında 400 alıyordu
// (hakem bulgusu 2026-09-19). Tolerans gerekçesi ve "en küçük sıra" belirlenimi
// vergiIsaretci.ts başlığında.

/** Oranı işaretçiye çevir; çözülemezse gövde Mikro'ya gitmez (sebebi mesajda). */
function vergiIsaretcisiGerekli(oran: number, tablo: ReadonlyMap<number, number>): number {
  const pntr = vergiIsaretcisiCoz(oran, tablo);
  if (pntr === null) {
    throw new MikroGovdeHatasi('KDV vergi işaretçisi', undefined,
      tablo.size === 0
        ? 'Mikro vergi listesi (VergiListesiV2) okunamadı — işaretçi tahmin edilmez'
        : `%${oran} oranı Mikro vergi tablosunda yok`);
  }
  return pntr;
}

/** Fiyat × miktar — ikisi de bilinmiyorsa hangi alanın eksik olduğunu SÖYLEYEREK düşer. */
function kalemMiktarTutar(kalem: GovdeKalemi, satirNo: number): { miktar: number; tutar: number } {
  const miktar = sayiGerekli(kalem.quantity, 'miktarı', satirNo);
  sayiGerekli(kalem.price, 'birim fiyatı', satirNo);
  // KURUŞA yuvarla (2026-09-19): kesirli miktar satır tutarını ilk kez kuruş-altına taşıdı (2,5 × 175,07 = 437,675;
  // IEEE-754'te 437,67499…). Resmî belgeye ham kayan nokta gitmez; KDV de yuvarlanmış matrahtan hesaplanır.
  // Tam sayılı miktarda değer DEĞİŞMEZ (yalnız float artığı temizlenir).
  const tutar = kurusaYuvarla(satirTutari(kalem.price, miktar));  // utils/para tek kaynak
  if (!Number.isFinite(tutar)) throw new MikroGovdeHatasi('satır tutarı', satirNo);
  return { miktar, tutar };
}

// ── e-Fatura gövdesi ─────────────────────────────────────────────────────────
/**
 * `FaturaKaydetV2` gövdesi. V17 gerçek formatı (MikroAPI.postman_collection_V17.json
 * ile doğrulandı, 2026-06-12): evrak başlığı cha_* (CARI_HESAP_HAREKETLERI), satırlar
 * `detay[]` içinde sth_* (STOK_HAREKETLERI, sth_evraktip=4). Payload Mikro zarfının
 * İÇİNDE gönderilir (`mikroPost(..., true)`).
 */
export function faturaGovdesi(fatura: FaturaGirdisi, secenek: FaturaSecenekleri): FaturaGovdesiSonucu {
  const cariKod    = metinGerekli(fatura.mikroCariKod, 'cari kodu');
  const kalemler   = fatura.lineItems;
  if (!Array.isArray(kalemler) || kalemler.length === 0) {
    throw new MikroGovdeHatasi('fatura kalemleri', undefined, 'faturada en az bir kalem olmalı');
  }
  const faturaDate = mikroTarihi(fatura.createdAt, secenek.simdi ?? new Date(), 'fatura tarihi');
  // KDV oranı sth_vergi'yi (vergi TUTARINI) belirler — bilinmiyorsa %20 varsayılmaz.
  const kdvOran    = sayiGerekli(fatura.kdvOran, 'KDV oranı');
  const vergiPntr  = vergiIsaretcisiGerekli(kdvOran, secenek.vergiTablosu);
  // AÇIK MADDE (bkz. dosya başlığı): fatura satırı deposu çağırandan gelmiyorsa eski
  // sabit 1 korunur — throw e-Fatura kesmeyi tamamen durdururdu.
  const depo       = secenek.depoNo === undefined || secenek.depoNo === null
    ? 1
    : depoGerekli(secenek.depoNo);

  const satirlar: FaturaSatiri[] = kalemler.map((kalem, i) => {
    const { miktar, tutar } = kalemMiktarTutar(kalem, i + 1);
    const stokKod = stokKoduGerekli(kalem.sku, i + 1);
    return {
      sth_tarih:           faturaDate,
      sth_tip:             1,
      sth_cins:            0,
      sth_normal_iade:     0,
      sth_evraktip:        4,   // fatura
      sth_evrakno_seri:    'F',
      sth_stok_kod:        stokKod,
      sth_cari_cinsi:      0,
      sth_cari_kodu:       cariKod,
      sth_miktar:          miktar,
      sth_birim_pntr:      1,
      sth_tutar:           tutar,
      // Kuruşa yuvarlama ESKİ FORMÜLÜN AYNISI: round(tutar × oran) / 100.
      sth_vergi:           Math.round(tutar * kdvOran) / 100,
      sth_vergi_pntr:      vergiPntr,
      sth_vergisiz_fl:     false,
      sth_aciklama:        metin(kalem.name),
      sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
      sth_subeno:          0,
      sth_giris_depo_no:   depo,
      sth_cikis_depo_no:   depo,
    };
  });

  const toplamTutar = satirlar.reduce((t, s) => t + s.sth_tutar, 0);

  // faturaTipi: 1=e-Fatura, 2=e-Arşiv, 3=İhracat (eski eşleme birebir)
  // VARSAYILAN YOK (2026-09-19): eskiden tip 'e-arsiv'/'ihracat' değilse 1 (e-FATURA) sayılıyordu; istemci ise
  // aynı siparişi `|| 'e-arsiv'` ile e-ARŞİV sayıyordu. e-Fatura'ya kayıtlı OLMAYAN alıcıya e-Fatura kesilemez,
  // kayıtlı olana e-Arşiv kesmek usulsüz belgedir — tip bilinmiyorsa belge kesilmez. Tipin kaynağı:
  // src/utils/siparisler/belgeTipi.ts (sipariş üzerindeki seçim → müşterinin `eFaturaKayitli` kaydı).
  const FATURA_TIPLERI: Readonly<Record<string, 1 | 2 | 3>> = { 'e-fatura': 1, 'e-arsiv': 2, 'ihracat': 3 };
  const faturaType = typeof fatura.faturaTipi === 'string' ? FATURA_TIPLERI[fatura.faturaTipi] : undefined;
  if (faturaType === undefined) {
    throw new MikroGovdeHatasi('belge tipi', undefined, "belge tipi (e-Fatura / e-Arşiv / ihracat) bilinmiyor — müşterinin e-Fatura kaydı okunamadı; siparişte belge tipini seçin");
  }

  const evrak: FaturaEvraki = {
    cha_tip:          0,   // satış
    cha_cinsi:        7,   // V17 örnek değeri (toptan satış faturası)
    cha_normal_Iade:  0,
    cha_evrak_tip:    63,  // fatura
    cha_cari_cins:    0,
    // cha_ebelge_turu V17'de eklendi (V16 gövdesinde YOK) — yalnız V17+
    // kurulumlarda gönderilir.
    //
    // ⚠️ ESKİDEN YANLIŞTI (2026-08-25'te düzeltildi). Eski eşleme
    //    `faturaType === 2 ? 8 : faturaType === 3 ? 0 : 1` idi, yani
    //    e-fatura için 1, e-arşiv için 8 yazıyordu. Bu, uygulamanın KENDİ
    //    okuma tarafıyla çelişiyordu: Cetpa'dan kesilen bir e-Fatura,
    //    Cetpa'nın kendi Faturalar ekranında "e-Arşiv" görünürdü; 8'in ise
    //    okuma tarafında karşılığı yok, -1/bilinmiyor'a düşerdi.
    //
    //    Doğru eşleme İKİ BAĞIMSIZ kaynakla sabitlendi (tahmin değil):
    //      1. Okuma tarafı — canlı tie-out ile ölçüldü (HANDOFF.md:119:
    //         satış 200×tür0 / 5×tür1, alış 91×tür0 / 58×tür1) →
    //         src/hooks/useMikroFaturalar.ts:21 «0=e-Fatura, 1=e-Arşiv,
    //         2=e-İrsaliye».
    //      2. Mikro API spec'i — mikroRoutes.ts «EBelgeTipi 0=EFatura
    //         1=EArsiv 2=EIrsaliye» ve aynı eşlemeyi kullanan gelen-fatura yolu.
    //
    //    İhracat 0'da BIRAKILDI: ihracat faturası e-Fatura ailesindendir ve
    //    okuma tarafında ayrı bir kodu yok. Uydurma bir kod yazmaktansa e-Fatura
    //    olarak işaretlemek hem doğru hem okuma tarafıyla tutarlı.
    //
    // ⚠️ ŞU AN ETKİSİZ: MIKRO_JUMP_SURUM varsayılanı 16, yani bu alan hiç
    //    gönderilmiyor. V17'ye geçildiğinde AKTİFLEŞİR — ilk gerçek kayıtta
    //    Mikro'da belge tipinin doğru göründüğü GÖZLE doğrulanmalı.
    ...(secenek.jumpSurum >= 17
      ? { cha_ebelge_turu: faturaType === 2 ? 1 : 0 }  // 2=e-arşiv → 1, e-fatura & ihracat → 0
      : {}),
    cha_d_cins:       0,
    cha_d_kur:        1,
    cha_tarihi:       faturaDate,
    cha_evrakno_seri: 'F',
    cha_kod:          cariKod,
    cha_projekodu:    '',
    cha_srmrkkodu:    '',
    cha_vade:         0,
    cha_subeno:       0,
    cha_aciklama:     '',
    kdv_istisna_kodu: '',
    detay:            satirlar,
  };

  return { evrak, satirlar, toplamTutar, faturaDate };
}

// ── e-İrsaliye gövdesi ───────────────────────────────────────────────────────
/**
 * `IrsaliyeKaydetV2` gövdesi. V17 gerçek formatı (MikroAPI.postman_collection_V17.json
 * ile doğrulandı, 2026-06-12): irsaliye satırları sth_* alanlarıdır (STOK_HAREKETLERI,
 * sth_evraktip=1); kargo/araç bilgisi `e_irsaliye_detaylari`'nda taşınır. Payload Mikro
 * zarfının İÇİNDE gönderilir (`mikroPost(..., true)`).
 *
 * Depo: seçenekteki `depoNo` önceliklidir, yoksa sevkiyat kaydındaki `depoNo`. İkisi de
 * yoksa belge GÖNDERİLMEZ — sevkiyat Cetpa'da durur, Mikro'ya elle işlenir (aynı karar
 * `mikroEvrak.ts` `depoGerekli` başlığında gerekçelendirildi).
 */
export function irsaliyeGovdesi(sevkiyat: IrsaliyeGirdisi, secenek: IrsaliyeSecenekleri): IrsaliyeGovdesiSonucu {
  const cariKod = metinGerekli(sevkiyat.mikroCariKod, 'cari kodu');
  const kalemler = sevkiyat.items;
  if (!Array.isArray(kalemler) || kalemler.length === 0) {
    // ESKİDEN: kalem yoksa tek satırlık, stok kodu boş, miktar 1, tutar 0 bir belge
    // üretiliyordu — Mikro defterinde tamamen uydurma bir stok hareketi.
    throw new MikroGovdeHatasi('sevkiyat kalemleri', undefined, 'irsaliyede en az bir kalem olmalı');
  }
  const irsDate   = mikroTarihi(sevkiyat.date, secenek.simdi ?? new Date(), 'irsaliye tarihi');
  const depo      = depoGerekli(secenek.depoNo ?? sevkiyat.depoNo);
  // sth_vergi irsaliyede 0 (vergi faturada tahakkuk eder) ama işaretçi yine de
  // gönderiliyor — eski kod sabit 4 yazıyordu; artık firmanın kendi tablosundan.
  const kdvOran   = sayiGerekli(sevkiyat.kdvOran, 'KDV oranı');
  const vergiPntr = vergiIsaretcisiGerekli(kdvOran, secenek.vergiTablosu);

  const satirlar: IrsaliyeSatiri[] = kalemler.map((kalem, i) => {
    const { miktar, tutar } = kalemMiktarTutar(kalem, i + 1);
    const stokKod = stokKoduGerekli(kalem.sku, i + 1);
    return {
      sth_tarih:            irsDate,
      sth_tip:              1,
      sth_cins:             0,
      sth_normal_iade:      0,
      sth_evraktip:         1,   // irsaliye
      sth_evrakno_seri:     'I',
      sth_stok_kod:         stokKod,
      sth_cari_cinsi:       0,
      sth_cari_kodu:        cariKod,
      sth_miktar:           miktar,
      sth_birim_pntr:       1,
      sth_tutar:            tutar,
      sth_vergi_pntr:       vergiPntr,
      sth_vergi:            0,
      sth_vergisiz_fl:      false,
      sth_iskonto1:         0,
      sth_iskonto2:         0,
      sth_aciklama:         metin(kalem.name),
      sth_giris_depo_no:    depo,
      sth_cikis_depo_no:    depo,
      sth_subeno:           0,
      sth_malkbl_sevk_tarihi: irsDate,
    };
  });

  const evrak: IrsaliyeEvraki = {
    evrak_aciklamalari: [{ aciklama: metin(sevkiyat.destination) }],
    e_irsaliye_detaylari: {
      eir_tasiyici_firma_kodu: metin(sevkiyat.cargoFirm),
      eir_tasiyici_arac_plaka: metin(sevkiyat.trackingNo),
      eir_eirs_olrk_gonderilsin: 0,
    },
    satirlar,
  };

  return { evrak, satirlar, irsDate };
}
