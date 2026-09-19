/**
 * govdeSiparis.ts — SiparisKaydetV2 (POST /api/mikro/siparis/kaydet) gövdesi.
 * TEK KAYNAK, saf fonksiyon: ağ/DB/express yok. (Faz 3 3/n, 2026-09-19)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Gövde rotanın içinde kuruluyordu (mikroRoutes.ts:509-519) ve BEŞ ayrı yerde
 * bilinmeyen değeri uyduruyordu:
 *
 *   sip_b_fiyat:    Number(item.unitPrice || item.price || 0)      → fiyatsız satır 0 TL
 *   sip_miktar:     Number(item.quantity || 1)                     → miktarsız satır 1 adet
 *   sip_tutar:      total || ((unitPrice||0) * (quantity||1))      → iki uydurmanın çarpımı
 *   sip_vergi_pntr: 4                          // "20% KDV"        → %10'luk malzeme de %20 yazılır
 *   sip_depono:     1                                              → 2026-09-05: depo 1 = HAVALİMANI
 *
 * Bunların hiçbiri hata vermez: Mikro geçerli bir kayıt alır, kullanıcı "başarılı"
 * görür, sahte satır MÜŞTERİNİN RESMİ DEFTERİNE düşer. Ayrıca `sip_tarih` bir
 * Timestamp zarfı geldiğinde sessizce "NaN.NaN.NaN" yazıyordu (`new Date(ts)`
 * her zaman Invalid Date — bkz. utils/zaman.ts başlığı).
 *
 * KURAL (CLAUDE.md): dış sisteme yazan gövdede VARSAYILAN YOKTUR. Bilinmeyen alan
 * `MikroGovdeHatasi` fırlatır; rota 400 döner ve `mikroPost` HİÇ çağrılmaz. İstemci
 * (App.tsx → syncOrderWithCari → toast) hata metnini kullanıcıya zaten gösteriyor.
 *
 * ── PARİTE ──────────────────────────────────────────────────────────────────
 * Bilinen, eksiksiz girdide gövde eski rotayla BİREBİR aynıdır: alan adları, sıra
 * ve Mikro sabitleri (sip_tip '0', sip_cins '0', seri 'T', sip_vergisiz_fl false)
 * korunur; `unitPrice` önce/`price` sonra ve `total` varsa tutara tercih kuralı da
 * aynen sürüyor. BİLİNÇLİ FARKLAR (hepsi testle kilitli):
 *   1. vergi işaretçisi sabit 4 değil, kalemin KDV oranından TERS aramayla bulunur;
 *   2. depo numarası sabit 1 değil, siparişten/rotadan gelir — yoksa hata;
 *   3. bilinmeyen fiyat/miktar/stok kodu/cari kodu 0/1/'' ile doldurulmaz, hata verir;
 *   4. tarih Timestamp/epoch/tarih-only biçimlerinde de doğru çözülür (zaman.ts),
 *      çözülemiyorsa hata — "NaN.NaN.NaN" yazılmaz.
 *
 * ── ROTADAN TAŞINAN CANLI DOĞRULAMA NOTU ────────────────────────────────────
 * sip_tip '0' → SATIŞ (2026-08-22 denetim bulgusu C14). Eskiden '1' idi ('1' =
 * ALIŞ/verilen sipariş). Bu uç bir MÜŞTERİ satış siparişini Mikro'ya yazıyor;
 * okuma tarafı satışı tip 0 sayıyor (OrdersPage.tsx:209, DashboardPage.tsx:145),
 * tip 1'i satın alma (PurchasingModule.tsx:76). '1' yazınca resmi satış Mikro'da
 * alış siparişi oluyordu VE Cetpa satış ekranında hiç görünmüyordu.
 */
import { bilinenSayi, satirTutari, kurusaYuvarla } from '../../utils/para.js';
import { gunBasi } from '../../utils/zaman.js';
import { MikroGovdeHatasi } from './govdeHatasi.js';
import { vergiIsaretcisiCoz } from './vergiIsaretci.js';

/** Sipariş ve kalemleri rotaya `Record<string, unknown>` olarak geliyor (istemci gövdesi). */
export type SiparisGirdisi = Readonly<Record<string, unknown>>;

export interface SiparisSecenekleri {
  /** `mikroVergiOranlari()` çıktısı: vergiSiraNo → yüzde. Ters arama BUNUN üstünde yapılır. */
  vergiTablosu: ReadonlyMap<number, number>;
  /** Rota depoyu başka bir yerden çözdüyse (kiracı ayarı, ekran seçimi) buradan geçirir; siparişin alanını ezer. */
  depoNo?: unknown;
  /** Siparişte tarih YOKSA kullanılacak push anı. Test belirlenimi için dışarıdan verilebilir. */
  simdi?: Date;
}

/** SiparisKaydetV2'nin tek satırı. Alan adları ve tipleri Mikro şemasıdır — değiştirme. */
export interface SiparisSatiri {
  sip_tarih: string;
  sip_tip: string;
  sip_cins: string;
  sip_evrakno_seri: string;
  sip_musteri_kod: string;
  sip_stok_kod: string;
  sip_b_fiyat: number;
  sip_miktar: number;
  sip_tutar: number;
  sip_vergi_pntr: number;
  sip_depono: number;
  sip_vergisiz_fl: boolean;
}

export interface SiparisGovdesiSonucu {
  /** Ayna (mirrorMikroInsert → mikro_siparisler) bu diziyi yazar. */
  satirlar: SiparisSatiri[];
  /** `mikroPost('SiparisKaydetV2', govde, true)` — V17 evrak kalıbı. */
  govde: { evraklar: [{ satirlar: SiparisSatiri[] }] };
}

/** Bilinen sonlu sayı → number, değilse null. `0` BİLİNEN bir değerdir (`||` tuzağı yok). */
function sayi(x: unknown): number | null {
  return bilinenSayi(x) ? Number(x) : null;
}

/** Dolu metin → kırpılmış hâli, değilse null. Sayı da kabul (doc id'leri sayı gelebiliyor). */
function metin(x: unknown): string | null {
  if (typeof x === 'string') { const s = x.trim(); return s === '' ? null : s; }
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return null;
}

// KDV YÜZDESİ → Mikro vergi İŞARETÇİSİ (vergiSiraNo) TERS araması TEK KAYNAKTA:
// ./vergiIsaretci.ts. Yön önemli: `sip_vergi_pntr` bir yüzde DEĞİL, VergiListesiV2
// satır sırasıdır (1 "YOK" %0 · 2 "%1" · 3 "%10" · 4 "%20" — mikroClient.ts); tolerans
// gerekçesi (Mikro oranları float döner, %20 → 19.999999999) ve "en küçük sıra"
// belirlenimi o dosyanın başlığına taşındı. Burada yerel bir kopyası vardı; kardeş
// gövdeler farklı toleransla arıyordu, aynı sipariş geçip faturası 400 alıyordu.

/**
 * Mikro evrak tarihi `dd.MM.yyyy`. Çözülemezse `null` — çağıran "bugün"e DÜŞMEZ.
 * `gunBasi` (utils/zaman.ts) Timestamp zarfını, epoch'u, ISO'yu, `DD.MM.YYYY`yi ve
 * tarih-only `YYYY-MM-DD`yi YEREL güne indirger; `new Date(x)` ile elle yapıldığında
 * ilki Invalid Date, sonuncusu UTD kayması yüzünden bir gün geri gidiyordu.
 */
export function mikroTarih(v: unknown): string | null {
  const g = gunBasi(v);
  if (!g) return null;
  const gg = String(g.getDate()).padStart(2, '0');
  const aa = String(g.getMonth() + 1).padStart(2, '0');
  return `${gg}.${aa}.${g.getFullYear()}`;
}

/**
 * Sipariş → SiparisKaydetV2 gövdesi. Bilinmeyen her alan için `MikroGovdeHatasi`.
 * Doğrulama sırası: kalem listesi → belge başlığı (cari/depo/tarih) → kalemler.
 */
export function siparisGovdesi(siparis: SiparisGirdisi, secenek: SiparisSecenekleri): SiparisGovdesiSonucu {
  const kalemler = siparis.lineItems;
  if (!Array.isArray(kalemler) || kalemler.length === 0) {
    throw new MikroGovdeHatasi('sipariş satırları', undefined, 'sipariş hiç kalem içermiyor');
  }

  // ── Belge başlığı ──────────────────────────────────────────────────────────
  const cariKod = metin(siparis.mikroCariKod);
  if (!cariKod) {
    throw new MikroGovdeHatasi('müşteri cari kodu', undefined,
      'sipariş bir Mikro carisine bağlanmamış — önce cariyi eşleştirin');
  }

  // Depo: seçenek (rota çözdüyse) > siparişin kendi alanı. Yoksa HATA — eski sabit
  // `1` bu kiracıda HAVALİMANI deposu; her sipariş yanlış depodan rezerve ediliyordu.
  const hamDepo = secenek.depoNo ?? siparis.depoNo ?? siparis.mikroDepoNo ?? siparis.warehouseNo;
  const depoNo = sayi(hamDepo);
  if (depoNo === null || !Number.isInteger(depoNo) || depoNo <= 0) {
    throw new MikroGovdeHatasi('depo numarası', undefined,
      "Mikro'ya depo 1 (HAVALİMANI) varsayılarak yazılamaz — siparişe depo seçin");
  }

  // Tarih: sipariş tarihi varsa o, hiç yoksa push anı (eski rotanın davranışı).
  // Ama BOZUK bir tarih "bugün"e düşmez — sessizce yanlış güne yazmaktansa hata.
  const hamTarih = siparis.createdAt;
  const tarihVar = hamTarih !== null && hamTarih !== undefined && hamTarih !== '';
  const sipTarih = mikroTarih(tarihVar ? hamTarih : (secenek.simdi ?? new Date()));
  if (!sipTarih) {
    throw new MikroGovdeHatasi('sipariş tarihi', undefined, 'tarih biçimi çözülemedi');
  }

  // ── Kalemler ───────────────────────────────────────────────────────────────
  const satirlar: SiparisSatiri[] = kalemler.map((ham, i) => {
    const no = i + 1; // kullanıcı satırları 1'den sayar
    if (!ham || typeof ham !== 'object') {
      throw new MikroGovdeHatasi('içeriği', no, 'kalem nesnesi değil');
    }
    const k = ham as Record<string, unknown>;

    const stokKod = metin(k.sku) ?? metin(k.productId);
    if (!stokKod) throw new MikroGovdeHatasi('stok kodu', no);

    const fiyat = sayi(k.unitPrice) ?? sayi(k.price);
    if (fiyat === null) throw new MikroGovdeHatasi('birim fiyatı', no);
    if (fiyat < 0) throw new MikroGovdeHatasi('birim fiyatı', no, 'fiyat negatif');

    const miktar = sayi(k.quantity);
    if (miktar === null) throw new MikroGovdeHatasi('miktarı', no);
    if (miktar <= 0) throw new MikroGovdeHatasi('miktarı', no, 'miktar 0 veya negatif');

    // Kalem toplamı: eski rotadaki `total || fiyat*miktar` tercihi korunuyor (satır
    // iskontosu total'de duruyor olabilir). Fark: bilinmeyen/0 total artık `0` yazmaz,
    // fiyat × miktara döner — ve çarpım para.ts'ten (null*qty = 0 tuzağı yok).
    const hamTutar = sayi(k.total);
    // KURUŞA yuvarla (2026-09-19): kesirli miktar tutarı kuruş-altına taşır; fatura/irsaliye gövdesiyle AYNI kural.
    const tutar = kurusaYuvarla(hamTutar !== null && hamTutar > 0 ? hamTutar : satirTutari(fiyat, miktar));
    if (!Number.isFinite(tutar)) throw new MikroGovdeHatasi('satır tutarı', no);

    // KDV: kalemin oranı, yoksa siparişin başlık oranı (AddOrderModal ikisini de yazar).
    const oran = sayi(k.vatRate) ?? sayi(siparis.kdvOran);
    if (oran === null) throw new MikroGovdeHatasi('KDV oranı', no);
    const vergiPntr = vergiIsaretcisiCoz(oran, secenek.vergiTablosu);
    if (vergiPntr === null) {
      throw new MikroGovdeHatasi('vergi işaretçisi', no, secenek.vergiTablosu.size === 0
        ? 'Mikro vergi tablosu okunamadı — VergiListesiV2'
        : `KDV %${oran} Mikro vergi tablosunda yok`);
    }

    return {
      sip_tarih:        sipTarih,
      sip_tip:          '0',   // SATIŞ — C14, başlıktaki nota bak
      sip_cins:         '0',
      sip_evrakno_seri: 'T',
      sip_musteri_kod:  cariKod,
      sip_stok_kod:     stokKod,
      sip_b_fiyat:      fiyat,
      sip_miktar:       miktar,
      sip_tutar:        tutar,
      sip_vergi_pntr:   vergiPntr,
      sip_depono:       depoNo,
      sip_vergisiz_fl:  false,
    };
  });

  return { satirlar, govde: { evraklar: [{ satirlar }] } };
}
