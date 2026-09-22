/**
 * kapsamNotu.ts — "N kayıt tutarsız" notunun TEK metni (Faz 3 6a, grup "kapsam-notu", 2026-09-19).
 * Test: kapsamNotu.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — EKRAN sözleşmesi (para.ts `ekranTutari`): kısmi toplam basılıyorsa yanında
 * "neyin dışarıda kaldığı" notu ZORUNLU. Bugün o not her panelde satır içi iki dilli metin olarak
 * yeniden yazılıyor (GenelOzet:37–46 ciro/ortalama, RaporlarPage:398–404 ve :509–515 trend,
 * FinancePanel:348–349 / :518–519, AnalyticsPanel:274, SubeModule:366, PurchasingModule:696…).
 * 6a tek başına ~10 yeni not ekliyor, 6/n boyunca ~110 — satır içi yazılsa ~110 kopya metin +
 * ~110 ayrı "0 iken basma" koşulu olurdu (Faz 0 kök nedeni: kopya kod). Bileşen karşılığı
 * `ReportKit.tsx` `<KapsamNotu>`; metni BURADAN alır, kendi metni yoktur.
 *
 * ASIL YAMA — KARIŞIK BİRİM (doğrulayıcı bulgusu): eski satır içi notlarda birim ÇAĞRI başına
 * tekildi; P619/P148 tek çağrıda `miktarsiz` (ÜRÜN) + `eslesmeyen` (KALEM) + `kalemsiz`/`tarihsiz`
 * (SİPARİŞ) sayaçlarını `birim: 'kalem'` ile geçiriyordu → "2 kalemin tarihi çözülemedi" gibi
 * YANLIŞ cümle. Not, neyin dışarıda kaldığını DÜRÜSTÇE söylemek için var; yanlış birim = yanlış
 * bilgi. Bu yüzden birim SAYACIN özelliğidir, çağrının değil: SABİT sayaçlar `secenek.birim`'i yok
 * sayar, serbest sayaçlar yalnız kendi izinli kümesindeki birimi kabul eder (aksi hâlde
 * varsayılanına döner — hata fırlatılmaz, yanlış cümle de kurulmaz).
 *
 * PARİTE: cümle kalıpları canlıdaki metinlerle birebir — TR `RaporlarPage:513`
 * "N siparişin tutarı okunamadı", EN `RaporlarPage:514` "N order(s) have an unreadable amount".
 *
 * BİLİNÇLİ FARK — birim adları için `oc()` KULLANILMIYOR: ORTAK sözlükteki İngilizce karşılıklar
 * ('orders' / 'items' / 'records' / 'lines') ekrandaki mevcut metinden farklı; not kalıbı sayı
 * bilinmediği için tekil/çoğul ayıramaz ve "order(s)" biçimini kullanır (5/n'de hakemden geçti).
 * Türkçe İYELİK biçimleri ('siparişin', 'kaydın') zaten sözlükte yok. Bu yüzden birim adları bu
 * modülün kendi tablosunda; ünlü uyumu / ek üretimi ELLE HESAPLANMAZ, tablodan okunur.
 *
 * UYGULANAN KULLANICI KARARI (KARARLAR.md K4, 2026-09-19): müşteri gruplaması "kimlikle" —
 * "ikisi de yoksa 'kimliksiz N sipariş' NOTU (satır değil)". `kimliksiz` sayacı o notu basar;
 * birimi SABİT `siparis` (kimliksiz kayıt ekranda SATIR olmadığı için ürün/kalem sayılamaz).
 */

/**
 * Not cümlesinde geçebilecek birimler. 6a birimleri = 6a'da GERÇEK tüketicisi olanlar + nötr
 * 'kayit'. 'bordro' | 'calisan' (6l), 'teklif' | 'hareket' (6b+) İLK TÜKETİCİSİNİN alt fazında
 * eklenir (birim tablosuna bir satır + izinli küme + test) — tüketicisiz birim YAZMA.
 */
export type KapsamBirimi = 'siparis' | 'kalem' | 'urun' | 'sablon' | 'kayit';

/** Alan sırası = cümle sırası (SABİT). Sayaçlar TOPLANMAZ: aynı sipariş hem tarihsiz hem tutarsız olabilir. */
export interface KapsamSayaclari {
  /** tutarı okunamayan — birim: varsayılan `siparis` (çağıran `sablon` / `kayit` seçebilir) */
  tutarsiz?: number;
  /** sıklığı (frekansı) tanınmayan abonelik ŞABLONU — birim SABİT: `sablon` */
  sikligisiz?: number;
  /** tarihi çözülemeyen — birim: varsayılan `siparis` (çağıran `kayit` seçebilir) */
  tarihsiz?: number;
  /** maliyeti bilinmeyen / kuru çevrilemeyen — birim: ÇAĞIRAN SEÇER (`siparis` | `urun`); seçmezse nötr `kayit` */
  maliyetsiz?: number;
  /** miktarı / stok seviyesi / talebi okunamayan KART — birim SABİT: `urun` */
  miktarsiz?: number;
  /** kritik stok eşiği tanımlı olmayan KART — birim SABİT: `urun` */
  esiksiz?: number;
  /** müşterisi belirlenemeyen sipariş (K4) — birim SABİT: `siparis` */
  kimliksiz?: number;
  /** stok kartıyla eşleşmeyen sipariş KALEMİ — birim SABİT: `kalem` */
  eslesmeyen?: number;
  /** kalem verisi olmayan SİPARİŞ (Mikro türevi) — birim SABİT: `siparis` */
  kalemsiz?: number;
  /** sınır dışı (üst sınır, pencere, tanınmayan durum) — birim: varsayılan `siparis` (`urun` / `kayit` seçilebilir) */
  kapsamDisi?: number;
  /** TL dışı birim — toplanmadı; birim: varsayılan `kayit` (6a'da tüketicisi YOK; ilk: 6l bordro) */
  dovizli?: number;
}

export interface KapsamSecenekleri {
  /** YALNIZ serbest sayaçları ve yalnız o sayacın izinli kümesindeyse etkiler; SABİT sayaçlar yok sayar. */
  birim?: KapsamBirimi;
  /**
   * `oc()` ile AYNI daraltma (src/i18n/ortak.ts:1265): `undefined | 'tr'` → Türkçe, başka HER
   * string → İngilizce. Tip bilerek `string`: hook/GenelOzet `currentLanguage: string` taşır,
   * `'tr' | 'en'` yazılsaydı çağrılar DERLENMEZDİ.
   */
  dil?: string;
  /**
   * Çağıranın panel cümlesi ("toplama dâhil değil", "tahmine girmedi"…) — EN SONA bir kez
   * `" — "` ile eklenir. ÇAĞIRANIN DİLİNDE gelir (Türkçe sabit yazılırsa EN arayüzde karışık dil
   * çıkar); hiç sayaç yoksa TEK BAŞINA basılmaz.
   */
  sonuc?: string;
}

/** Birim adları — çoğul eki YOK ("3 siparişin"); iyelik eki TABLODAN, elle üretilmez. */
interface BirimAdi { readonly yalin: string; readonly iyelik: string; readonly en: string }

const BIRIMLER: Readonly<Record<KapsamBirimi, BirimAdi>> = {
  siparis: { yalin: 'sipariş', iyelik: 'siparişin', en: 'order(s)' },
  kalem: { yalin: 'kalem', iyelik: 'kalemin', en: 'line item(s)' },
  urun: { yalin: 'ürün', iyelik: 'ürünün', en: 'product(s)' },
  sablon: { yalin: 'şablon', iyelik: 'şablonun', en: 'template(s)' },
  kayit: { yalin: 'kayıt', iyelik: 'kaydın', en: 'record(s)' },
};

type Kalip = (n: string, b: BirimAdi) => string;

interface SayacTanimi {
  readonly alan: keyof KapsamSayaclari;
  readonly varsayilan: KapsamBirimi;
  /** SABİT sayaçta YOK → `secenek.birim` yok sayılır. Serbest sayaçta izinli küme. */
  readonly izinli?: readonly KapsamBirimi[];
  readonly tr: Kalip;
  readonly en: Kalip;
}

/** Cümle tablosu — SIRA = `KapsamSayaclari` alan sırası; metinler tek kaynak. */
const SAYACLAR: readonly SayacTanimi[] = [
  {
    alan: 'tutarsiz', varsayilan: 'siparis',
    // MRR şablonu (GenelOzet P-MRR) ve karışık geçmiş ('kayit') siteleri var.
    izinli: ['siparis', 'sablon', 'kayit'],
    tr: (n, b) => `${n} ${b.iyelik} tutarı okunamadı`,
    en: (n, b) => `${n} ${b.en} have an unreadable amount`,
  },
  {
    // SABİT: sıklık (frekans) abonelik ŞABLONUNUN alanıdır — siparişin/ürünün değil.
    // DELTA 2026-09-22: `abonelik.sablonAylikTutari` frekans tanınmazsa TUTAR BİLİNSE BİLE NaN
    // döner; ikisi tek `tutarsiz` sayacında birleştirilince not YANLIŞ NEDEN söylüyordu
    // ("tutarı okunamadı"), kullanıcı fiyatı arayıp bir şey bulamıyordu. Yanlış neden =
    // yanlış bilgi (bu modülün "yanlış birim" yamasının ikizi).
    alan: 'sikligisiz', varsayilan: 'sablon',
    tr: (n, b) => `${n} ${b.iyelik} sıklığı tanınmadı`,
    en: (n, b) => `${n} ${b.en} have an unrecognized frequency`,
  },
  {
    alan: 'tarihsiz', varsayilan: 'siparis',
    // 6a'da tarihi çözülen tek şey sipariş.
    izinli: ['siparis', 'kayit'],
    tr: (n, b) => `${n} ${b.iyelik} tarihi çözülemedi`,
    en: (n, b) => `${n} ${b.en} have an unparseable date`,
  },
  {
    alan: 'maliyetsiz', varsayilan: 'kayit',
    // DIO / stok değeri → 'urun'; sipariş kârı (6c+) → 'siparis'; seçilmezse nötr kalır.
    izinli: ['siparis', 'urun', 'kayit'],
    tr: (n, b) => `${n} ${b.iyelik} maliyeti bilinmiyor`,
    en: (n, b) => `${n} ${b.en} have an unknown cost`,
  },
  {
    // SABİT: 6a'daki 5 sitenin 5'i KART sayar (seviyesiBilinmeyen, toplamAdet.bilinmeyen, talebiBilinmeyenKart/Aday).
    alan: 'miktarsiz', varsayilan: 'urun',
    tr: (n, b) => `${n} ${b.iyelik} miktarı okunamadı`,
    en: (n, b) => `${n} ${b.en} have an unreadable quantity`,
  },
  {
    // SABİT: eşik KARTIN alanıdır.
    alan: 'esiksiz', varsayilan: 'urun',
    tr: (n, b) => `${n} ${b.iyelik} kritik stok eşiği tanımlı değil`,
    en: (n, b) => `${n} ${b.en} have no reorder threshold`,
  },
  {
    // SABİT (K4): "kimliksiz N sipariş" NOTU. Departman/dönem anahtarı (6l) AYRI sayaçla gelir — genelleştirme.
    alan: 'kimliksiz', varsayilan: 'siparis',
    tr: (n, b) => `${n} ${b.iyelik} müşterisi belirlenemedi`,
    en: (n, b) => `${n} ${b.en} have no identifiable customer`,
  },
  {
    // SABİT: urunTalebi.eslesmeyenKalem KALEM sayar. Cümle YALIN hâl kullanır.
    alan: 'eslesmeyen', varsayilan: 'kalem',
    tr: (n, b) => `${n} ${b.yalin} stok kartıyla eşleşmedi`,
    en: (n, b) => `${n} ${b.en} matched no stock card`,
  },
  {
    // SABİT: urunTalebi.kalemsizSiparis SİPARİŞ sayar.
    alan: 'kalemsiz', varsayilan: 'siparis',
    tr: (n, b) => `${n} ${b.iyelik} kalem verisi yok`,
    en: (n, b) => `${n} ${b.en} have no line items`,
  },
  {
    alan: 'kapsamDisi', varsayilan: 'siparis',
    // üst sınır / pencere / tanınmayan durum.
    izinli: ['siparis', 'urun', 'kayit'],
    tr: (n, b) => `${n} ${b.yalin} kapsam dışında`,
    en: (n, b) => `${n} ${b.en} fall outside the range`,
  },
  {
    alan: 'dovizli', varsayilan: 'kayit',
    // 6l'de 'bordro' birimi eklenecek.
    izinli: ['siparis', 'kayit'],
    tr: (n, b) => `${n} ${b.iyelik} para birimi TL değil — toplanmadı`,
    en: (n, b) => `${n} ${b.en} are not in TRY — not summed`,
  },
];

/**
 * Kısmi toplamın yanına basılacak tek satırlık kapsam notu; basılacak bir şey yoksa `null`.
 *
 * - Tüm sayaçlar 0 / eksik / sonlu-olmayan / negatif → `null` (boş `<p>` BASILMAZ; `''` değil `null`).
 * - Cümleler tablo sırasıyla `' · '` ile birleşir; `sonuc` varsa EN SONA bir kez `' — ' + sonuc`.
 * - Sayaçlar TOPLANMAZ ("toplam N kayıt" yazılmaz) — çift sayım yasağı.
 * - Sayı `toLocaleString` ile (tr `1.250`, en `1,250`).
 * - Saf: React döndürmez; `<KapsamNotu>` sarmalar.
 */
export function kapsamNotu(s: KapsamSayaclari, secenek?: KapsamSecenekleri): string | null {
  const turkce = secenek?.dil === undefined || secenek.dil === 'tr';
  const istenenBirim = secenek?.birim;
  const parcalar: string[] = [];

  for (const tanim of SAYACLAR) {
    const n = s[tanim.alan];
    // Bilinmeyen sayaç SESSİZCE atlanır: "NaN siparişin tutarı okunamadı" basmak, notun amacı olan
    // dürüstlüğü bozar. `Number.isFinite` (global isFinite DEĞİL) + pozitiflik kapısı.
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue;

    const birim = istenenBirim !== undefined && tanim.izinli?.includes(istenenBirim)
      ? istenenBirim
      : tanim.varsayilan;
    const b = BIRIMLER[birim];
    const sayi = n.toLocaleString(turkce ? 'tr-TR' : 'en-US');
    parcalar.push(turkce ? tanim.tr(sayi, b) : tanim.en(sayi, b));
  }

  if (parcalar.length === 0) return null;
  const govde = parcalar.join(' · ');
  const sonuc = secenek?.sonuc?.trim();
  return sonuc ? `${govde} — ${sonuc}` : govde;
}
