/**
 * schemas.ts - Paylasilan zod semalari.
 *
 * server.ts'ten AYRILDI (2026-08-24, D4 adim 8). Bu semalar hem server.ts'te
 * hem `routes/mikroRoutes.ts`'te gerekiyor. Alternatifler ve neden bu secildi:
 *   - mikroRoutes server.ts'ten IMPORT etseydi -> DONGUSEL bagimlilik.
 *   - Baglam nesnesiyle gecirilseydi -> tipi ELLE yazmak gerekirdi ve
 *     sema degisince tip sessizce bayatlardi (`any` verilince de z.infer
 *     calismiyor, dogrulanmis govdenin alanlari "does not exist" veriyor).
 * Semalari ortak bir modulde tutmak iki sorunu da cozer: tek kaynak, tip
 * z.infer ile SEMADAN turer, dongu yok. Bu dosya yalniz zod'a ve YAPRAK ortak
 * sozlesmeye (`src/lib/magazaTalep.ts`: asama kumesi, kalem anahtari deseni —
 * 2026-10-09, dilim 2a) bagli; sunucu modulu ice aktarmaz.
 */
import { z } from 'zod';
import {
  MAGAZA_BIRIM_FIYAT_KURUS_HATASI, MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_PANEL_43_DESENI, MAGAZA_PANEL_TUR_DESENI, MAGAZA_TALEP_ASAMALARI, PANEL_DURUMLARI,
  magazaKdvOraniMi, magazaKurusluMu,
} from '../lib/magazaTalep.js';
import type { MagazaKdvOrani } from '../lib/magazaTalep.js';

/** `validate()`in kabul ettigi sema tipi.
 *  Baglamda `{ parse: ... }` diye YAKLASIK yazmak strictFunctionTypes
 *  altinda reddediliyor: gerceklestirim `safeParse` cagiriyor, yani
 *  yaklasik tip hem DAR hem YANLIS yontemi ilan ediyordu. */
export type Sema<T> = z.ZodSchema<T>;

// Fatura kaydetme şeması
export const FaturaKaydetSchema = z.object({
  // ZORUNLU (2026-10-17, şartname «e-Fatura çift kesim» E2): gönderim işareti siparişin KENDİ belgesine yazılır — kimliksiz istekte
  // ne «zaten faturalandı mı» sorulabilir ne sonuç siparişe yazılabilirdi. Boş / yalnız boşluk da reddedilir (değer KIRPILMAZ:
  // kırpılmış kimlik başka belgeye işaret ederdi). Tek istemci çağıranı (App.tsx handleMikroFatura) her istekte `order.id` geçer.
  firebaseId: z.string().refine(v => v.trim() !== '', { message: 'Sipariş kimliği (firebaseId) zorunludur.' }),
  order: z.object({
    mikroCariKod:  z.string().min(1, 'Cari kod zorunludur.'),
    lineItems:     z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      price:    z.number().nonnegative(),
      // KESİRLİ miktar geçerli (2,5 ton / 0,75 m³ — 2026-09-19 kullanıcı kararı); eski `.int()` bunları 400'lüyordu.
      quantity: z.number().positive().finite(),
      // Satır KDV tutarı (sipariş penceresinin kaleme yazdığı değer). zod bilinmeyen alanı SİLER — şemada yoksa gövdeye
      // hiç ulaşmaz ve KDV matrahtan yeniden hesaplanır (KDV dâhil yazılan 50,01 belgede 50,02 olurdu).
      kdv:      z.number().nonnegative().finite().optional(),
    })).min(1, 'En az bir satır gerekli.'),
    faturaTipi:   z.enum(['e-fatura', 'e-arsiv', 'ihracat']).optional(),
    kdvOran:      z.number().min(0).max(100).optional(),
    // Siparişte seçilmiş sevk deposu (AddOrderModal + OrdersPage sipariş düzenleme modalı).
    // zod bilinmeyen alanı SİLER — şemada yoksa
    // rotaya hiç ulaşmaz. Varsayılan YOK; yoksa gövde pariteye düşer (bkz. govdeFaturaIrsaliye başlığı).
    depoNo:       z.number().int().positive().optional(),
    createdAt:    z.string().optional(),
  }),
});

// Belirsiz e-Fatura kaydını çözme (şartname «e-Fatura çift kesim» E3 / D6). `numara` yalnız `mikrodaVar`'da kullanılır; boş /
// yalnız boşluk «verilmedi» sayılır (uydurulmaz), kırpılarak saklanır.
// `ettnEkle` + `ettn` (2026-10-19, şartname «fatura gövde + gece MF» § 9.B B2): boş / yalnız boşluk ETTN «verilmedi» sayılır.
// Biçim sınaması ŞEMADA DEĞİL rotada (`cetpaEttnAnahtari` → 400 `FATURA_ETTN_GECERSIZ`, Türkçe ileti); şema yalnız kararla
// alanın birlikteliğini sınar. İletiler `issues[0].message` ile istemciye gider.
// Her alanın iletisi Türkçe (zod'un İngilizce varsayılanı istemciye gitmesin — rota `issues[0].message`'ı döner).
export const FaturaSonucSchema = z.object({
  firebaseId: z.string({ error: 'Sipariş kimliği (firebaseId) zorunludur.' }).refine(v => v.trim() !== '', { message: 'Sipariş kimliği (firebaseId) zorunludur.' }),
  karar: z.enum(['mikrodaVar', 'mikrodaYok', 'ettnEkle'], { error: 'Geçersiz karar: mikrodaVar, mikrodaYok ya da ettnEkle olmalı.' }),
  numara: z.string({ error: 'Fatura numarası metin olmalı.' }).max(64, { error: 'Fatura numarası en çok 64 karakter olabilir.' }).optional()
    .transform(v => (v !== undefined && v.trim() !== '' ? v.trim() : undefined)),
  ettn: z.string({ error: 'ETTN metin olmalı.' }).max(64, { error: 'ETTN en çok 64 karakter olabilir.' }).optional()
    .transform(v => (v !== undefined && v.trim() !== '' ? v.trim() : undefined)),
}, { error: 'Geçersiz istek gövdesi.' }).superRefine((v, ctx) => {
  if (v.karar === 'ettnEkle' && v.ettn === undefined) {
    ctx.addIssue({ code: 'custom', path: ['ettn'], message: 'ETTN eklemek için geçerli bir ETTN girin.' });
  }
  if (v.karar === 'mikrodaYok' && v.ettn !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['ettn'], message: '«Mikro\'da yok» kararında ETTN verilmez.' });
  }
});

// İrsaliye kaydetme şeması
export const IrsaliyeKaydetSchema = z.object({
  firebaseId: z.string().optional(),
  shipment: z.object({
    mikroCariKod:   z.string().min(1, 'Cari kod zorunludur.'),
    customerName:   z.string().optional(),
    destination:    z.string().optional(),
    trackingNo:     z.string().optional(),
    cargoFirm:      z.string().optional(),
    items:          z.array(z.object({
      sku:      z.string().optional(),
      name:     z.string().min(1),
      // KESİRLİ miktar geçerli (2,5 ton / 0,75 m³ — 2026-09-19 kullanıcı kararı); eski `.int()` bunları 400'lüyordu.
      quantity: z.number().positive().finite(),
      price:    z.number().optional(),
    })).optional(),
    date:           z.string().optional(),
    // Mikro gövdesinde ZORUNLU iki alan: kdvOran (vergi işaretçisi ters araması) ve
    // depoNo (sth_giris/cikis_depo_no). Şemada optional — çünkü VARSAYILAN VERMEK
    // Mikro defterine sahte kayıt demek; eksikse gövde kurucusu 400 ile reddeder
    // (bkz. src/server/mikro/govdeFaturaIrsaliye.ts).
    kdvOran:        z.number().min(0).max(100).optional(),
    depoNo:         z.number().int().positive().optional(),
    // Faturasız (`false`) sevkiyat Mikro'ya yazılmaz — rota 400 döner. Alan yoksa (eski/kanal siparişi) karışılmaz.
    faturali:       z.boolean().optional(),
  }),
});

// Gelen fatura kabul/ret şeması
export const GelenFaturaActionSchema = z.object({
  faturaGuid:  z.string().min(1, 'faturaGuid zorunludur.'),
  firebaseId:  z.string().optional(),
  aciklama:    z.string().optional(),
});

/**
 * `POST /api/mikro/cari/ara` gövdesi (şartname `.wf/SARTNAME-mikro-cari-arama.md` C1). `.strict()`: tanınmayan alan 400 (eski
 * `nameSearch` / `whereStr` alanları bu uca giremez). Metin KIRPILIR, kırpılmış hâli 2–100 karakter; fazlası 400 (kesilmez —
 * kesilmiş arama başka bir şeyi bulurdu). İletiler kullanıcıya gösterilir (rota ilk sorunun iletisini döner; ortak `validate()`
 * yardımcısının genel iletisi ekranda «neden» demiyordu). Arama metni POST gövdesindedir: kişi adı olabilir (şahıs firması),
 * sorgu dizesi erişim günlüklerine düşer.
 */
export const MikroCariAraGovdesi = z.object({
  metin: z.string({ error: 'Arama metni yazı olmalı.' })
    .trim()
    .min(2, { error: 'En az iki karakter yazın.' })
    .max(100, { error: 'Arama metni en çok 100 karakter olabilir.' }),
}, { error: 'Geçersiz istek gövdesi.' }).strict();

// AI chat şeması
export const AiChatSchema = z.object({
  message:    z.string().min(1).max(4000),
  context:    z.string().max(8000).optional(),
  language:   z.enum(['tr', 'en']).optional(),
});

// server.ts'ten TASINDI (2026-08-26): epostaRoutes de kullaniyor.
// E-posta gönderim şeması
export const EmailSendSchema = z.object({
  to:      z.string().email('Geçerli bir e-posta adresi girin.'),
  subject: z.string().min(1, 'Konu boş olamaz.').max(200),
  html:    z.string().min(1, 'İçerik boş olamaz.'),
  from:    z.string().email().optional(),
  replyTo: z.string().email().optional(),
});

// Mağaza sipariş talebi şeması — KİMLİKSİZ uç `POST /api/magaza/siparis-talebi` (routes/magazaRoutes.ts).
// Rota ortak `validate()` yardımcısını KULLANMAZ (400'de zod ayrıntısı döndürür); kendi `safeParse` + sabit 400.
//  • Metinlerde `.max()` YOK: aşım ret değil KIRPMA (üst sınırı 64 KB gövde koyar; mağaza yanıtı okumuyor — ret
//    sessiz kayıp olurdu). Temizlik, kırpma ve «temizlikten sonra boş mu / telefonda 10 rakam var mı» denetimi
//    şemanın ardındaki saf eşleyicide: kanal/magazaTalep.ts `talepEsle` (bağlam ister — şema dönüşümü DEĞİL).
//  • `adet` üst sınırı YOK (kullanıcı kararı K4 — «sınır koyma»); `.int()` güvenli tam sayı dışını zaten reddeder.
//  • `birimFiyat` yok ya da null = «fiyat sorulacak»; varsayılan YOK, 0'a ÇEVRİLMEZ. Toplamlar da isteğe bağlı:
//    gönderilmediyse eşleyici `null` yazar (0 DEĞİL).
//  • `fiyatiSorulacakVar` şemada BİLEREK yok: zod bilinmeyen alanı SİLER — istemciden alınmaz, sunucuda kalemlerden türetilir.
//  • `no` deseni src/lib/magazaTalep.ts `MAGAZA_TALEP_NO_DESENI` ile AYNI olmalı (bu dosya yalnız zod'a bağlı kalsın
//    diye kopya; ayrışmayı kanal/magazaTalep.test.ts kilitler).
//  • `birimFiyat`'ta KURUŞ DENETİMİ YOK (B3, 2026-10-17): müşterinin beyanıdır, mağaza fiyatları iki ondalıktır; bu uçta ret
//    mağazanın talebini kaybettirirdi. Kuruş kuralı yalnız ERP'nin kendi gövdelerinde (`KurusluBirimFiyat`, aşağıda).

/** Kimliksiz talebin kalemi — `ErpElleTalepGovdesi` aynı nesneyi `birimFiyat`'ı kuruşla sınırlayarak genişletir (kopya yok). */
const MagazaTalepKalemSemasi = z.object({
  ad:         z.string(),
  adet:       z.number().int().positive(),
  id:         z.string().optional(),
  sku:        z.string().optional(),
  marka:      z.string().optional(),
  birimFiyat: z.number().nonnegative().nullable().optional(),
  tedarik:    z.boolean().optional(),
});

export const MagazaSiparisTalebiSchema = z.object({
  no:      z.string().regex(/^T\d{6}-[A-Z0-9]{4}$/),
  tarih:   z.string().optional(),
  musteri: z.object({
    ad:      z.string(),
    telefon: z.string(),
    firma:   z.string().optional(),
    eposta:  z.string().optional(),
    il:      z.string().optional(),
    adres:   z.string().optional(),
    vergi:   z.string().optional(),
  }),
  not:     z.string().optional(),
  kalemler: z.array(MagazaTalepKalemSemasi).min(1),
  araToplam: z.number().nonnegative().optional(),
  kdv:       z.number().nonnegative().optional(),
  toplam:    z.number().nonnegative().optional(),
});

/**
 * Mağaza sipariş takibi gövdesi — KİMLİKSİZ uç `POST /api/magaza/siparis-durumu` (dilim 2a, § 4). Yalnız tür denetimi:
 * `no` deseni ve telefonun 10 rakamı rotada ölçülür ve «biçim bozuk» ile «bulunamadı» AYNI yanıtı alır (`404 bulunamadi`,
 * bayt bayt eşit) — desen şemada olsaydı biçim bozuk 400'e ayrışır, uç bir talep numarasının biçimini doğrulayan kâhin olurdu.
 * Tanınmayan alan atılır (mağaza biçimi genişlese de uç kırılmasın; `.strict()` değil — talep şemasıyla aynı tutum).
 */
export const MagazaSiparisDurumuSchema = z.object({
  no:      z.string(),
  telefon: z.string(),
});

// ── Mağaza dilim 2a (şartname v6 § 3, § 4; 2026-10-09) ─────────────────────────────────────────────────────────────────
// Hepsi `.strict()`: tanınmayan alan 400 (panel `oturum` gövdesine `eposta` / `sifre` gelirse de 400 — V2). Rotalar ortak
// `validate()` yardımcısını KULLANMAZ (zod ayrıntısı dönmesin): `safeParse` + sabit `400 { ok: false }`.

/** Aşama ve açıklama yazımının ORTAK gövdesi; sözlük çağıranın (panel `PanelDurumGovdesi`, ERP `ErpDurumGovdesi`). */
const durumGovdesi = <const T extends readonly [string, ...string[]]>(sozluk: T) => z.object({
  onceki:   z.enum(sozluk),
  // İstemcinin EKRANDA gördüğü sürüm; ZORUNLU (bayat ekran sessiz geri almaya dönüşemez — § 2.3).
  surum:    z.number().int().min(0),
  durum:    z.enum(sozluk),
  // Ham en çok 2.000 karakter; temizlik + 500 birime kırpma yazma işlevinde (`magazaDurum.ts`).
  aciklama: z.string().max(2000).optional(),
}).strict().refine(g => g.durum !== g.onceki || g.aciklama !== undefined, { message: 'aynı aşamada açıklama zorunlu' });

/** `POST /panel/siparisler/:id/durum` — panel sözlüğü (`alindi`; `'bilinmiyor'` ve saklanan `'yeni'` 400). */
export const PanelDurumGovdesi = durumGovdesi(PANEL_DURUMLARI);
/** `POST /api/magaza-talepleri/:id/durum` — SAKLANAN sözlük (`yeni`). */
export const ErpDurumGovdesi = durumGovdesi(MAGAZA_TALEP_ASAMALARI);

/**
 * Kalem teslim gövdesi — TEK zod sabiti; panel (`magazaPanelZinciri.ts`) ve ERP (`magazaErpRoutes.ts`) rotaları bunu içe
 * aktarır, ikinci `z.object(` kopyası yazılmaz (§ 4). `kalemler`: 1–500 anahtar, her biri kurallı desen (öncü sıfırlı `b:01`
 * şemada 400), yinelenen yok; ya da `'hepsi'` («tümünü işaretle / kaldır» TEK istek).
 */
export const KalemTeslimGovdesi = z.object({
  surum:    z.number().int().min(0),
  teslim:   z.boolean(),
  kalemler: z.union([
    z.literal('hepsi'),
    z.array(z.string().regex(MAGAZA_KALEM_ANAHTARI_DESENI)).min(1).max(500)
      .refine(liste => new Set(liste).size === liste.length, { message: 'yinelenen anahtar' }),
  ]),
}).strict();

/** `POST /panel/siparisler/:id/etiket-basildi` — `surum` YOK (aşama ile yarışmaz); `{}` geçerli (V23). */
export const EtiketBasildiGovdesi = z.object({
  koli: z.number().int().min(1).optional(),
}).strict();

/** `POST /api/magaza-talepleri/:id/bildirim-gonder` — boş nesne (IIS gövdesiz POST'u Node'a iletmez; V22). */
export const BildirimGonderGovdesi = z.object({}).strict();

// ── Mağaza dilim 2b (şartname v6 § 10.3; 2026-10-10) ───────────────────────────────────────────────────────────────────
// 2a ile AYNI tutum: `.strict()` (tanınmayan alan 400), rotalar `safeParse` + sabit `400 { ok: false }`. Temizlik, kırpma,
// «temizlikten sonra boş mu / telefonda 10 rakam var mı», anahtarın kaynağa aitliği ve KDV oranının çözümü şemanın ardındaki
// yazma yolundadır (`kanal/magazaIcerik.ts`); şema yalnız TÜR ve BİÇİM süzer.

/**
 * `POST /api/magaza-talepleri/:id/bildirim-gonder` sorgu dizesi (2b; kapı 4, Y8): `tur` YALNIZ `revize` değerini alır — yok =
 * ilk bildirim (2a davranışı); `ilk` dâhil başka her değer ve tanınmayan parametre 400.
 */
export const BildirimGonderSorgusu = z.object({
  tur: z.enum(['revize']).optional(),
}).strict();

/**
 * ERP gövdelerinin birim fiyatı (B1, kullanıcı kararı 2026-10-17 «kuruştan ince birim fiyat — hayır»): negatif değil VE en çok
 * iki ondalık. Denetim saf ortak işlevde (`magazaKurusluMu` — kayan nokta kalıntısına dayanıklı; form aynı işlevle süzer),
 * ileti de oradan (`MAGAZA_BIRIM_FIYAT_KURUS_HATASI`). Rotalar yine sabit `400 { ok: false }` döner (zod ayrıntısı yanıta
 * girmez); metni kullanıcı formun alan hatasında görür. `null` («fiyat sorulacak») çağıran yerde `.nullable()` ile — DEĞİŞMEZ.
 */
const KurusluBirimFiyat = z.number().nonnegative().refine(magazaKurusluMu, { message: MAGAZA_BIRIM_FIYAT_KURUS_HATASI });

/**
 * İçerik gövdesinin müşteri bloğu: YEDİ alan birden ZORUNLU (`''` = boş). Yazma yolu `data || yama` ile SIĞ birleştirir —
 * kısmi `musteri` nesnesi eski alanları SİLERDİ. Metinlerde `.max()` yok: aşım ret değil KIRPMA (dilim 1 kuralı).
 */
const IcerikMusteriGovdesi = z.object({
  ad:      z.string(),
  firma:   z.string(),
  telefon: z.string(),
  eposta:  z.string(),
  il:      z.string(),
  adres:   z.string(),
  vergi:   z.string(),
}).strict();

/**
 * Teyit kalemi. `birimFiyat` KDV HARİÇ net ve ZORUNLU anahtar: EN ÇOK İKİ ONDALIKLI sayı (`KurusluBirimFiyat`; 83,3333 → 400)
 * ya da açıkça `null` («fiyat sorulacak»; varsayılan YOK, 0'a çevrilmez). `kdvOrani` İSTEĞE BAĞLI: verilmişse kümede olmalı
 * (`MAGAZA_KDV_ORANLARI` — sabit içe aktarılır, kopyalanmaz; 8 / 18 → 400), verilmemişse sunucu ürün kaydından çözer. `kdvKaynagi` şemada BİLEREK yok: kaynak sunucunun çıkarımıdır,
 * gövdede gelirse `.strict()` 400 verir. `anahtar` kurallı desen (öncü sıfırlı `b:01` → 400); yalnız «hangi kalem» bilgisidir.
 */
const IcerikTeyitKalemGovdesi = z.object({
  anahtar:    z.string().regex(MAGAZA_KALEM_ANAHTARI_DESENI).optional(),
  id:         z.string().optional(),
  sku:        z.string().optional(),
  ad:         z.string(),
  marka:      z.string().optional(),
  adet:       z.number().int().positive(),
  birimFiyat: KurusluBirimFiyat.nullable(),
  kdvOrani:   z.custom<MagazaKdvOrani>(magazaKdvOraniMi).optional(),
  tedarik:    z.boolean().optional(),
}).strict();

/**
 * `POST /api/magaza-talepleri/:id/icerik` — içerik düzenleme (V15: yalnız ERP). `icerikSurum` = ekranda görülen sürüm (CAS).
 * Üç bölümden EN AZ BİRİ; form her zaman tam gövde gönderir, «ne değişti» sunucuda ölçülür. `not` ham en çok 4.000 karakter
 * (temizlik + 1.000 birime kırpma yazma yolunda). `teyit.kalemler` en az 1 kalem (bütün kalemleri silmek isteyen talebi
 * iptal eder — aşama); aynı istekte yinelenen `anahtar` 400. Müşterinin BEYANI (`kalemler`, `talepEdilen`) ve toplamlar
 * gövdede KABUL EDİLMEZ (`.strict()`): beyan değişmez, toplamları sunucu türetir.
 */
export const ErpIcerikGovdesi = z.object({
  icerikSurum: z.number().int().min(0),
  musteri:     IcerikMusteriGovdesi.optional(),
  not:         z.string().max(4000).optional(),
  teyit:       z.object({
    kalemler: z.array(IcerikTeyitKalemGovdesi).min(1)
      .refine(liste => {
        const anahtarlar = liste.flatMap(k => (k.anahtar !== undefined ? [k.anahtar] : []));
        return new Set(anahtarlar).size === anahtarlar.length;
      }, { message: 'yinelenen anahtar' }),
  }).strict().optional(),
}).strict().refine(g => g.musteri !== undefined || g.not !== undefined || g.teyit !== undefined, { message: 'en az bir bölüm' });

/**
 * `POST /api/magaza-talepleri/:id/sil` — yumuşak silme / geri alma (yalnız Yönetici; yetki rotada `magazaTalepSilmeYetkisi`).
 * `surum` = ekranda görülen `durumSurum`; `geriAl: true` → geri alma.
 */
export const ErpSilGovdesi = z.object({
  surum:  z.number().int().min(0),
  geriAl: z.boolean().optional(),
}).strict();

/** `POST /panel/siparisler/:id/sil` — site paneli yalnız SİLER (panelden geri alma YOK — V18; `geriAl` gelirse 400). */
export const PanelSilGovdesi = z.object({
  surum: z.number().int().min(0),
}).strict();

/**
 * `POST /api/magaza-talepleri` — ERP'de elle talep. Mağaza talebi gövdesinin `no` ve `tarih`'siz hâli: numarayı SUNUCU üretir,
 * müşteri cihazı saati yoktur. Kimliksiz uçtan iki farkı var: `.strict()` (ERP'nin kendi formu tanınmayan alan göndermez —
 * gelirse 400) ve kalem `birimFiyat`'ı EN ÇOK İKİ ONDALIK (`KurusluBirimFiyat`, B1; kalem nesnesinin geri kalanı kimliksiz
 * uçla AYNI nesne — `MagazaTalepKalemSemasi.extend`). Telefonda 10 rakam ZORUNLU — eşleyicide ölçülür (takip ucu aynı `no` +
 * telefonla çalışır).
 */
export const ErpElleTalepGovdesi = MagazaSiparisTalebiSchema.omit({ no: true, tarih: true }).extend({
  kalemler: z.array(MagazaTalepKalemSemasi.extend({ birimFiyat: KurusluBirimFiyat.nullable().optional() })).min(1),
}).strict();

/** `POST /api/magaza-panel/yetki-kodu` — § 3.2. */
export const YetkiKoduGovdesi = z.object({
  meydan: z.string().regex(MAGAZA_PANEL_43_DESENI),
  tur:    z.string().regex(MAGAZA_PANEL_TUR_DESENI),
}).strict();

/** `POST /api/magaza/panel/oturum` — § 3.3; `eposta` / `sifre` gibi tanınmayan alan 400, gövde günlüğe YAZILMAZ. */
export const PanelOturumGovdesi = z.object({
  kod:         z.string().regex(MAGAZA_PANEL_43_DESENI),
  dogrulayici: z.string().regex(MAGAZA_PANEL_43_DESENI),
}).strict();
