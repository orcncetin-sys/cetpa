/**
 * govdeStokCari.ts — Mikro **StokKaydetV2** ve **CariKaydetV2** gövdeleri, TEK KAYNAK
 * (Faz 3 3/n, grup "govdeStokCari", 2026-09-19). Saf fonksiyon: ağ/DB/express YOK.
 * Test: `govdeStokCari.test.ts` (önce yazıldı).
 *
 * NEDEN VAR — rotadaki sahte-varsayılan siteleri (mikroRoutes.ts, taşımadan önceki hâl):
 *   184-199 `/api/mikro/stok/kaydet`
 *     · 186 `item.sku || \`STK${Date.now()}\`` — SKU'su olmayan ürün her gönderimde
 *       Mikro defterine YENİ ve bulunamaz bir stok kartı açardı (zaman damgalı kod).
 *     · 187-188 `item.name || ''` — isimsiz stok kartı.
 *     · 191 `sto_birim1_ad: 'ADET'` sabit — inşaat malzemesinde birim TON/KG/M³ olabilir;
 *       yanlış birim kartın TÜM gelecek miktarlarını anlamsız yapar (kalıcı hasar).
 *     · 192-193 `sto_perakende_vergi: 20`, `sto_toptan_vergi: 20` — **EN AĞIR HATA**.
 *       O alan YÜZDE DEĞİL, VergiListesiV2'deki `vergiSiraNo`ya İŞARETÇİdir
 *       (mikroClient.ts `mikroVergiOranlari` başlığı, 2026-07-31 canlı bulgusu:
 *        sıra 1 "YOK" %0 · 2 "KDV %1" · 3 "KDV %10" · 4 "KDV %20"). Müşterinin
 *       tablosunda 20 diye bir sıra YOK; gönderilen her kart tanımsız vergi
 *       işaretçisiyle açılıyordu. Artık oran→işaretçi TERS arama yapılıyor.
 *     · 195-198 `prices[kademe] || 0` — okuma arızası/çöp değer sessizce ₺0'a düşüyordu.
 *       (Satır 199'daki `.filter(> 0)` bunları eliyordu, yani ₺0 Mikro'ya YAZILMIYORDU;
 *        ama kademe SESSİZCE kayboluyordu ve hiçbir kademe kalmazsa fiyatsız kart açılıyordu.)
 *   292-327 `/api/mikro/cari/kaydet`
 *     · 292 `CAR${(firebaseId || Date.now().toString()).substring(0,6)}` — firebaseId
 *       yoksa zaman damgasından cari kodu uydurur.
 *     · 298 `lead.company || lead.name || ''` — unvansız cari.
 *
 * PARİTE (bilinen girdide gövde eskisiyle BİREBİR): alan adları, sıra ve sabit Mikro
 * kodları aynen korundu — `sto_cins: 0`, `sto_doviz_cinsi: 0`, `sfiyat_deposirano: 1`,
 * `sfiyat_odemeplan: 0`, `sfiyat_birim_pntr: 1`, `sfiyat_doviz: 0`, `sto_kisa_ismi` =
 * adın ilk 24 karakteri; cari tarafında `cari_unvan2:''`, `cari_def_efatura_cinsi:0`,
 * `cari_doviz_cinsi1/2/3: 0/255/255`, `cari_KurHesapSekli:1`, `adr_ulke:'TÜRKİYE'`,
 * `adr_tel_ulke_kodu:'090'`, `adr_posta_kodu:0`. Bunlar UYDURMA DEĞİL, Mikro'nun sabit
 * kodları/uygulamanın tek pazarı; `acikSorular`da işaretlendi.
 *
 * BİLİNÇLİ FARKLAR (parite dışı, hepsi testte kilitli):
 *   1. Zorunlu alanlar (stok kodu, stok adı, birim, KDV oranı, en az bir fiyat kademesi;
 *      cari kodu, cari unvanı) bilinmiyorsa `MikroGovdeHatasi` — rota 400 döner,
 *      `mikroPost` HİÇ çağrılmaz.
 *   2. Zorunlu alanlar `trim`lenir: yalnız boşluktan oluşan kod/ad "bilinmiyor" sayılır.
 *   3. Sayısal metin fiyat ('1250.5') gerçek sayıya çevrilir — rota metni olduğu gibi
 *      JSON'a koyuyordu.
 *   4. Fiyat dövizi TL değilse throw: `sto_doviz_cinsi: 0` (TL) sabit olduğu için USD
 *      fiyatı TL tutar gibi yazılırdı. Mikro'nun döviz kodları TAHMİN EDİLMEZ.
 *   5. İsteğe bağlı metin alanları sayı gelirse `String(...)` ile yazılır (rota sayıyı
 *      JSON'a sayı olarak koyuyordu; Mikro alanları metin).
 *
 * DOKUNULMAYAN: `lead.contactName` okuması — Lead tipinde alan adı `authorizedContact`
 * (bkz. acikSorular). Alan adını burada değiştirmek, bugüne kadar hiç yazılmamış
 * `yetkili` satırlarını Mikro'ya göndermeye başlardı; bu ayrı bir karardır.
 */
import { bilinenSayi } from '../../utils/para.js';
import { MikroGovdeHatasi } from './govdeHatasi.js';
import { vergiIsaretcisiCoz } from './vergiIsaretci.js';

// ── Tipler ───────────────────────────────────────────────────────────────────
// `type` (interface DEĞİL): mirrorMikroStoklar/mirrorMikroCariler `Record<string,
// unknown>[]` bekliyor ve TypeScript yalnız type alias'lara örtük indeks imzası verir.

export type MikroStokFiyatSatiri = {
  sfiyat_listesirano: number; sfiyat_deposirano: number; sfiyat_odemeplan: number;
  sfiyat_birim_pntr: number; sfiyat_fiyati: number; sfiyat_doviz: number;
};

export type MikroStokGovdesi = {
  sto_kod: string; sto_isim: string; sto_kisa_ismi: string;
  sto_cins: number; sto_doviz_cinsi: number; sto_birim1_ad: string;
  sto_perakende_vergi: number; sto_toptan_vergi: number;
  satis_fiyatlari: MikroStokFiyatSatiri[];
};

export type MikroCariYetkili = {
  mye_isim: string; mye_soyisim: string; mye_email_adres: string;
  mye_cep_telno: string; mye_dahili_telno: string;
};

export type MikroCariAdres = {
  adr_cadde: string; adr_ilce: string; adr_il: string; adr_ulke: string;
  adr_tel_ulke_kodu: string; adr_tel_bolge_kodu: string; adr_tel_no1: string;
  adr_posta_kodu: number; yetkili: MikroCariYetkili[];
};

export type MikroCariGovdesi = {
  cari_kod: string; cari_unvan1: string; cari_unvan2: string;
  cari_vdaire_no: string; cari_vdaire_adi: string;
  cari_EMail: string; cari_CepTel: string;
  cari_efatura_fl: number; cari_def_efatura_cinsi: number;
  cari_doviz_cinsi1: number; cari_doviz_cinsi2: number; cari_doviz_cinsi3: number;
  cari_KurHesapSekli: number; cari_sevk_adres_no: number; cari_fatura_adres_no: number;
  adres: MikroCariAdres[];
};

/** Fiyat kademesi → Mikro fiyat listesi sıra no. Sıra ANLAMLIDIR (Mikro liste no'su). */
export const STOK_FIYAT_KADEMELERI: ReadonlyArray<{ kademe: string; listeSiraNo: number }> = [
  { kademe: 'Retail',       listeSiraNo: 1 },
  { kademe: 'B2B Standard', listeSiraNo: 2 },
  { kademe: 'B2B Premium',  listeSiraNo: 3 },
  { kademe: 'Dealer',       listeSiraNo: 4 },
];

// ── Küçük yardımcılar ────────────────────────────────────────────────────────

/** İsteğe bağlı metin alanı: metin aynen, sonlu sayı metne çevrilir, gerisi ''. */
function metin(x: unknown): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

/** Zorunlu metin alanı: boş/boşluk ise `MikroGovdeHatasi`. */
function zorunluMetin(x: unknown, alan: string, aciklama?: string): string {
  const s = metin(x).trim();
  if (!s) throw new MikroGovdeHatasi(alan, undefined, aciklama);
  return s;
}

// Oran → Mikro vergi işaretçisi TERS araması TEK KAYNAKTA: ./vergiIsaretci.ts.
// Burada yerel bir kopyası vardı ve `deger === o` (KESİN eşitlik) kullanıyordu;
// kardeş gövdeler 1e-9 / 1e-6 tolerans kullanıyordu. Tablo %20'yi 19.999999999 diye
// döndürdüğünde aynı ürün siparişte geçip stok kartında 400 alıyordu (hakem bulgusu
// 2026-09-19). Kural — "en yakın orana yuvarla" YOK, sabit 4 YOK, bulunamazsa throw —
// aynen korunuyor; yalnız eşitlik kuralı üç yüzeyde ortaklaştı.

// ── StokKaydetV2 gövdesi ─────────────────────────────────────────────────────

/**
 * Bir envanter kaydından Mikro stok kartı gövdesi üretir.
 *
 * @param urun          `inventory` dokümanı (rota `req.body.item`).
 * @param vergiTablosu  `mikroVergiOranlari()` sonucu — sıraNo → yüzde. BOŞ ise
 *                      (Mikro okunamadı) gövde kurulmaz: tahmini işaretçi yazmaktansa
 *                      kullanıcı "tekrar dene" görsün.
 * @throws MikroGovdeHatasi  SKU / ad / birim / KDV oranı / fiyat bilinmiyorsa.
 */
export function stokGovdesi(
  urun: Record<string, unknown>,
  vergiTablosu: ReadonlyMap<number, number>,
): MikroStokGovdesi {
  const stoKod = zorunluMetin(urun.sku, 'stok kodu (SKU)', 'ürün kartında SKU yok — zaman damgalı kod üretilmez');
  const isim   = zorunluMetin(urun.name, 'stok adı');
  // Birim: ekranda 'ADET' gösteriliyor ama Mikro kartına YAZILAN birim kalıcıdır.
  // mikroEvrak.ts'teki `depoGerekli` ile aynı duruş: ekranda alan yoksa bile uydurma.
  const birim  = zorunluMetin(urun.unit, 'birim', "ürün kartında birim yok — Mikro stok kartına 'ADET' varsayılamaz");

  // Fiyat dövizi: gövdede `sto_doviz_cinsi`/`sfiyat_doviz` = 0 (TL) SABİT. Ürün fiyatı
  // başka para biriminde tutuluyorsa tutar TL sanılırdı. Mikro'nun döviz kodu TAHMİN EDİLMEZ.
  const doviz = metin(urun.priceCurrency).trim().toUpperCase();
  if (doviz && doviz !== 'TRY' && doviz !== 'TL') {
    throw new MikroGovdeHatasi('fiyat dövizi', undefined, `fiyatlar ${doviz} cinsinden; Mikro döviz kodu eşlemesi yok`);
  }

  // KDV: alan İNDEKS, yüzde değil (bkz. başlık). Önce oran bilinmeli, sonra tersi çözülmeli.
  if (!vergiTablosu.size) {
    throw new MikroGovdeHatasi('KDV vergi işaretçisi', undefined, 'Mikro vergi tablosu (VergiListesiV2) okunamadı');
  }
  if (!bilinenSayi(urun.vatRate)) {
    throw new MikroGovdeHatasi('KDV oranı', undefined, 'ürün kartında KDV oranı yok');
  }
  const isaretci = vergiIsaretcisiCoz(urun.vatRate, vergiTablosu);
  if (isaretci === null) {
    throw new MikroGovdeHatasi('KDV vergi işaretçisi', undefined, `%${Number(urun.vatRate)} oranı Mikro vergi tablosunda yok`);
  }

  const fiyatlar = (urun.prices as Record<string, unknown> | undefined) || {};
  const satisFiyatlari: MikroStokFiyatSatiri[] = [];
  for (const { kademe, listeSiraNo } of STOK_FIYAT_KADEMELERI) {
    const ham = fiyatlar[kademe];
    if (!bilinenSayi(ham)) continue;          // bilinmeyen kademe SATIR ÜRETMEZ (₺0 yazılmaz)
    const fiyat = Number(ham);
    if (!(fiyat > 0)) continue;               // rota paritesi: `.filter(p => p.sfiyat_fiyati > 0)`
    satisFiyatlari.push({
      sfiyat_listesirano: listeSiraNo,
      sfiyat_deposirano:  1,   // Mikro fiyat listesi depo sırası (rotadan aynen) — bkz. acikSorular
      sfiyat_odemeplan:   0,
      sfiyat_birim_pntr:  1,
      sfiyat_fiyati:      fiyat,
      sfiyat_doviz:       0,   // TL; TL dışı fiyat yukarıda throw'la engellendi
    });
  }
  if (!satisFiyatlari.length) {
    throw new MikroGovdeHatasi('satış fiyatı', undefined, 'hiçbir fiyat kademesi bilinmiyor — fiyatsız stok kartı açılmaz');
  }

  return {
    sto_kod:             stoKod,
    sto_isim:            isim,
    sto_kisa_ismi:       isim.substring(0, 24),
    sto_cins:            0,
    sto_doviz_cinsi:     0,
    sto_birim1_ad:       birim,
    sto_perakende_vergi: isaretci,
    sto_toptan_vergi:    isaretci,   // uygulama tek KDV oranı tutuyor (perakende/toptan ayrımı yok)
    satis_fiyatlari:     satisFiyatlari,
  };
}

// ── CariKaydetV2 gövdesi ─────────────────────────────────────────────────────

/**
 * Bir lead/müşteri/tedarikçi kaydından Mikro cari kartı gövdesi üretir.
 *
 * @param cari        `leads` veya `suppliers` dokümanı (rota `req.body.lead`).
 * @param firebaseId  Doküman kimliği — `mikroCariKod` yoksa cari kodu BUNDAN türetilir
 *                    (`CAR` + ilk 6 karakter, büyük harf; rota paritesi). Yoksa throw:
 *                    zaman damgasından kod üretilmez.
 * @throws MikroGovdeHatasi  Cari kodu veya unvan bilinmiyorsa.
 *
 * NOT — bilinmeyen İSTEĞE BAĞLI alanlar boş metin geçer (vergi dairesi no/adı, e-posta,
 * telefon, adres). Boş metin UYDURMA DEĞİL, "bilmiyorum"un Mikro'daki karşılığıdır ve
 * rota davranışıyla aynıdır; tek gerçek çağıran (PurchasingModule → syncSupplierToMikro)
 * yalnız `name` gönderiyor, bunlara throw koymak tedarikçi kaydını tamamen keserdi.
 */
export function cariGovdesi(cari: Record<string, unknown>, firebaseId?: string): MikroCariGovdesi {
  const mevcutKod = metin(cari.mikroCariKod).trim();
  const fbId      = metin(firebaseId).trim();
  if (!mevcutKod && !fbId) {
    throw new MikroGovdeHatasi('cari kodu', undefined, 'mikroCariKod ve Firebase kimliği yok — zaman damgasından kod üretilmez');
  }
  const cariKod = mevcutKod || `CAR${fbId.substring(0, 6).toUpperCase()}`;

  const unvan = metin(cari.company).trim() || zorunluMetin(cari.name, 'cari unvanı', 'company/name boş');

  const eposta  = metin(cari.email);
  const telefon = metin(cari.phone);
  // Lead → taxId, Supplier → taxNo, eski kayıtlar → vkn (üçü de aynı VKN/TCKN alanı).
  const vergiNo = metin(cari.taxId) || metin(cari.taxNo) || metin(cari.vkn);

  const yetkiliAdi = metin(cari.contactName).trim();
  const adParcalari = yetkiliAdi.split(' ');

  return {
    cari_kod:               cariKod,
    cari_unvan1:            unvan,
    cari_unvan2:            '',
    cari_vdaire_no:         vergiNo,
    cari_vdaire_adi:        metin(cari.taxOffice),
    cari_EMail:             eposta,
    cari_CepTel:            telefon,
    // BAYRAK (para/miktar değil): bilinmiyorsa 0 = "e-fatura mükellefi değil", Mikro'nun
    // kendi varsayılanı. Yalnız gerçek `true` 1 yazar — metin 'true' bayrağı açmaz.
    cari_efatura_fl:        cari.eFaturaKayitli === true ? 1 : 0,
    cari_def_efatura_cinsi: 0,
    cari_doviz_cinsi1:      0,
    cari_doviz_cinsi2:      255,
    cari_doviz_cinsi3:      255,
    cari_KurHesapSekli:     1,
    cari_sevk_adres_no:     0,
    cari_fatura_adres_no:   0,
    adres: [{
      adr_cadde:          metin(cari.address),
      adr_ilce:           metin(cari.district),
      adr_il:             metin(cari.city),
      adr_ulke:           'TÜRKİYE',   // uygulamanın tek pazarı; ülke alanı hiç tutulmuyor
      adr_tel_ulke_kodu:  '090',
      adr_tel_bolge_kodu: '',
      adr_tel_no1:        telefon,
      adr_posta_kodu:     0,           // Mikro sayısal alan; posta kodu hiç tutulmuyor (0 = boş)
      yetkili: yetkiliAdi ? [{
        mye_isim:         adParcalari[0] || '',
        mye_soyisim:      adParcalari.slice(1).join(' '),
        mye_email_adres:  eposta,
        mye_cep_telno:    telefon,
        mye_dahili_telno: '',
      }] : [],
    }],
  };
}
