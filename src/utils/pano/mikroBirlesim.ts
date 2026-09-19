/**
 * mikroBirlesim.ts — Pano (Dashboard) ile Mikro verisinin BİRLEŞİMİ.
 * Faz 3 5/n, grup "mikroBirlesim" (2026-09-19). Saf fonksiyonlar: React, DB, ağ YOK.
 * Test ÖNCE yazıldı: `mikroBirlesim.test.ts`.
 *
 * ## Neden var — kaldırılan sahte-kesinlik siteleri
 *
 *   • `src/hooks/useMikroSiparisler.ts` (~35): `tutar: Number(d.sip_tutar || 0)`.
 *     Aynadaki kolon NULL inebiliyor (`mikroMirror.ts` → `sip_tutar: numOrNull`),
 *     import de ham satırı `SELECT *` ile yazıyor. Yani tutarı okunamayan Mikro
 *     siparişi hook'tan "bilinen ₺0" olarak çıkıyor ve ÜÇ ekrana birden yayılıyor:
 *     DashboardPage (`mappedMikroSiparisler`), OrdersPage (Siparişler → Mikro sekmesi),
 *     PurchasingModule (Alış Siparişleri). Bu modül HAM `sip_tutar` kolonunu okur —
 *     hook'un türettiği `tutar` alanını DEĞİL; hook'a dokunulmadı (bkz. Açık İşler).
 *
 *   • `src/pages/DashboardPage.tsx` (~198-212): eşleme `totalPrice: ms.tutar` yazıyordu.
 *     Alan HER ZAMAN yazıldığı için `siparisTutari` bilinmeyeni ayırt edemiyordu —
 *     "bedava sipariş" iddiası. Artık bilinmiyorsa ALAN YAZILMAZ (sunucudaki
 *     `faturadanSiparis` ile aynı sözleşme: `...(tutarVar ? { totalPrice } : {})`).
 *
 *   • `src/pages/DashboardPage.tsx` (~1809): `fmtKpi(o.totalPrice||o.totalAmount||0)`.
 *     Mikro faturasından türetilen siparişte (`source:'mikro-fatura'`) tutar alanı
 *     BİLEREK yok — bu satır onu ekrana ₺0 diye basıyordu. `eslemeFatura.ts`'in
 *     "OKUYAN TARAF TAMAMLANMADI" notunun pano ayağı. Çözümü `siparisTutari` (mevcut).
 *
 * ## Parite
 *
 *   Bilinen girdide sayılar bugünkü DashboardPage ile BİREBİR aynıdır. Birleşim
 *   kuralı DEĞİŞMEDİ (CLAUDE.md "EKLE, YERİNE KOYMA"): native + Mikro toplanır,
 *   çift sayım yalnız kaynak etiketiyle (`source` 'mikro…') engellenir, alış (`gelen`)
 *   faturası ve `tip !== 0` Mikro siparişi eskisi gibi dışarıda kalır.
 *
 * ## Bilinçli farklar
 *
 *   1. `panoCirosu` native tarafta `odemeTakipli` kuralını (source 'mikro' ÖNEKİ)
 *      kullanır. Pano'nun üç ciro sitesinden ikisi zaten böyleydi; KPI kartı dar
 *      `!== 'mikro-fatura'` eşitliğini kullanıyordu. Fark yalnız `orders`
 *      koleksiyonunda 'mikro-siparis' kaynaklı DOKÜMAN bulunsaydı görünürdü —
 *      o kaynak etiketi yalnız istemci eşlemesinde üretilir, hiç kaydedilmez
 *      (ölçüldü: `grep -rn "mikro-siparis" src/` → yalnız eşleme + test).
 *      Kazanç: üç site tek kuralı paylaşır, ikisi üçüncüsünden sessizce ayrışamaz.
 *   2. `panoSiparisleri` aynı `id` iki listede de varsa TEK satır bırakır (mükerrer satır ve
 *      React `key` çakışmasına karşı kapı). Koleksiyon id'leri ayrıdır; çakışmanın bilinen TEK
 *      yolu HAYALET kayıttır: Siparişler → Mikro sekmesinde sözde siparişin durumu değiştirilince
 *      istemci `updateDoc`'u `orders/<mikro id>` diye alansız bir doküman UPSERT ediyordu
 *      (2026-09-19 son inceleme; yazım kapısı OrdersPage `yazilabilirSiparis` ile kapatıldı, ama
 *      canlıda ÖNCEDEN doğmuş hayaletler olabilir). Bu yüzden çakışmada MİKRO satırı kalır,
 *      native kayıt atılır — aksi hâlde gerçek sipariş panodan düşer, yerine alansız bir satır
 *      gelirdi. Hayaleti ALANLARINDAN tanımaya ÇALIŞMIYORUZ: ilk sürüm "müşteri adı yoksa
 *      hayalettir" diyordu, oysa hayalet üreten dört yazım yerinden biri (düzenleme kaydı) ad da
 *      yazar; o hayalet "gerçek native" sayılıp Mikro satırını atmaya devam ediyordu.
 *   3. `mikroFaturadanPanoSiparisi` doküman id'si olarak faturanın KENDİ id'sini
 *      kullanır. Sunucunun `mikrofat__<cid>__<seri>-<sira>` biçimi BİLEREK taklit
 *      EDİLMEZ: bu eşleme yalnız ekranda toplanır, hiçbir yere yazılmaz; aynı
 *      biçimi üretmek "bu kayıt kalıcıdır" iddiası olurdu.
 *
 * ## Kapsam dışı (Açık İşler'e yazıldı)
 *
 *   `status: 'Pending'` (Mikro siparişi) ve `tip`/`yon` okunamadığında satış sayma
 *   varsayımları SINIFLANDIRMA kararlarıdır; birini kaldırmak üç ekranın listesini
 *   birden değiştirir. Bu tur yalnız "bilinmeyen tutarı 0'a zorlama"yı kaldırır.
 */
import { bilinenSayi, toplaBilinen, ekranTutari, tutarBirlestir, type Tutar } from '../para';
import { odemeTakipli, siparisTutari, type SiparisKaynakAlani, type SiparisTutarAlanlari } from '../siparis';

/** Mikro SIPARISLER satırının pano için OKUNAN alanları (yapısal — hook tipine bağlı değil). */
export interface PanoMikroSiparis {
  id: string;
  evrakNo?: unknown;
  cariKodu?: unknown;
  tarih?: unknown;
  /** 0 = Alınan (satış), 1 = Verilen (alış). Aynada TEXT → sayısal string olabilir. */
  tip?: unknown;
  /** HAM Mikro kolonu (`SELECT *` ile dokümana yazılır). NULL inebilir = BİLİNMİYOR. */
  sip_tutar?: unknown;
}

/** `useMikroFaturalar`ın normalize ettiği fatura. `tutar` NaN ise BİLİNMİYOR. */
export interface PanoMikroFatura {
  id?: string;
  faturaNo?: unknown;
  cariKod?: unknown;
  tarih?: unknown;
  /** cha_meblag (KDV dahil). **NaN = BİLİNMİYOR** — hook sözleşmesi. */
  tutar?: unknown;
  /** 'giden' = satış (ciro), 'gelen' = alış. */
  yon?: unknown;
}

/**
 * Pano listelerine giren sipariş biçimi. `totalPrice` BİLİNMİYORSA ALAN HİÇ YOKTUR
 * (bu yüzden isteğe bağlı): `siparisTutari` o zaman NaN döner ve `toplaBilinen`
 * kaydı toplama katmaz, SAYAR.
 */
export interface PanoSiparisi {
  id: string;
  orderNumber: string;
  customerName: string;
  totalPrice?: number;
  status: string;
  createdAt: unknown;
  syncedAt: unknown;
  orderDate?: unknown;
  source: 'mikro-siparis' | 'mikro-fatura';
}

/** `sip_tip` / `cha_tip` karşılığı: 0 = Alınan (satış) sipariş. */
export const MIKRO_SATIS_SIPARIS_TIPI = 0;

/** Boş/okunamayan metin alanı → '' (hook'un `|| ''` davranışı; para değil, kimlik alanı). */
const metin = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** `totalPrice` alanı — yalnız BİLİNİYORSA yazılır (yoksa nesnede hiç bulunmaz). */
const tutarAlani = (n: number): { totalPrice?: number } => (Number.isFinite(n) ? { totalPrice: n } : {});

/**
 * Mikro siparişinin tutarı; bilinmiyorsa NaN.
 *
 * HAM `sip_tutar` kolonundan okunur, `useMikroSiparisler`ın türettiği `tutar`
 * alanından DEĞİL: o alan `Number(d.sip_tutar || 0)` olduğu için okunamayan tutarı
 * "bilinen ₺0" yapar ve bilinmeyen ile meşru sıfırı ayırt edilemez hâle getirir.
 * Ham kolon dokümanda zaten duruyor (import `SELECT *` yazar, hook `...d` yayar).
 */
export function mikroSiparisTutari(ms: PanoMikroSiparis): number {
  return bilinenSayi(ms.sip_tutar) ? Number(ms.sip_tutar) : NaN;
}

/**
 * Mikro siparişini pano siparişine eşler.
 *
 * `syncedAt` = MİKRO'NUN TARİHİ, bugün DEĞİL (Faz 1 3/n): eskiden `new Date()`
 * yazılıyordu → her Mikro siparişi panoda "bugün" görünüp 7 günlük ciro/KPI'ya
 * sızıyordu. `source` etiketi `odemeTakipli` ayrımı için şart (ödeme Cetpa'da
 * izlenmiyor; `paid` yokluğu "ödenmedi" değil "bilinmiyor"dur).
 *
 * NOT: `status: 'Pending'` sabiti de bir varsayımdır (Mikro sipariş durumu
 * bilinmiyor) — parite için korundu, Açık İş.
 */
export function mikroSiparisindenPanoSiparisi(ms: PanoMikroSiparis): PanoSiparisi {
  return {
    id: ms.id,
    orderNumber: metin(ms.evrakNo),
    customerName: metin(ms.cariKodu),
    ...tutarAlani(mikroSiparisTutari(ms)),
    status: 'Pending',                 // Mikro'daki açık siparişler
    createdAt: ms.tarih,
    syncedAt: ms.tarih,
    source: 'mikro-siparis',
  };
}

/**
 * Mikro satış faturasını pano siparişine eşler — sunucudaki `faturadanSiparis`
 * (src/server/mikro/eslemeFatura.ts) ile AYNI sözleşme: tutar bilinmiyorsa
 * `totalPrice` alanı yazılmaz, `status` 'Delivered' (faturası kesilmiş satış).
 * Doküman id'si için bkz. başlıktaki "Bilinçli farklar" 3.
 */
export function mikroFaturadanPanoSiparisi(f: PanoMikroFatura): PanoSiparisi {
  const no = metin(f.faturaNo);
  return {
    id: metin(f.id),
    orderNumber: no ? `MF-${no}` : '',
    customerName: metin(f.cariKod),
    ...tutarAlani(bilinenSayi(f.tutar) ? Number(f.tutar) : NaN),
    status: 'Delivered',
    createdAt: f.tarih,
    syncedAt: f.tarih,
    orderDate: f.tarih,
    source: 'mikro-fatura',
  };
}

/** Mikro siparişleri → pano siparişleri. Yalnız ALINAN (satış, `tip === 0`) kayıtlar. */
export function panoMikroSiparisleri(liste: readonly PanoMikroSiparis[]): PanoSiparisi[] {
  return liste
    .filter(ms => bilinenSayi(ms.tip) ? Number(ms.tip) === MIKRO_SATIS_SIPARIS_TIPI : true)
    .map(mikroSiparisindenPanoSiparisi);
}

/**
 * Pano'nun birleşik sipariş listesi: native kayıtlar + Mikro eşlemeleri (ADDITIVE).
 * Sıra korunur; aynı `id` iki listede de varsa TEK satır kalır ve o, MİKRO satırıdır
 * (çakışan native kayıt hayalettir — bkz. Bilinçli farklar 2).
 */
export function panoSiparisleri<T extends { id: string }>(
  native: readonly T[],
  mikro: readonly PanoSiparisi[],
): Array<T | PanoSiparisi> {
  const mikroIdler = new Set(mikro.map(m => m.id));
  return [...native.filter(o => !mikroIdler.has(o.id)), ...mikro];
}

/** Bu kayıt Mikro'dan mı türedi? (çift sayım kapısı — `odemeTakipli`nin tersi, TEK kural) */
export function mikroTurevi(o: SiparisKaynakAlani): boolean {
  return !odemeTakipli(o);
}

export interface PanoCiro {
  /** Birleşik tutar (native + Mikro): toplam + bilinen/bilinmeyen sayaçları. */
  tutar: Tutar;
  native: Tutar;
  mikro: Tutar;
  /** Ekrana giden sayı: kısmi toplam; HİÇ bilinen yokken NaN → `fmtKpi` '—' basar. */
  ekran: number;
}

/**
 * Pano cirosu — native siparişler + Mikro SATIŞ faturaları.
 *
 * Süzgeçler ÇAĞIRANDA kalır (tarih aralığı, gün, son 7 gün); burada yalnız
 * DEĞİŞMEYEN iki kural uygulanır:
 *   • ÇİFT SAYIM: Mikro'dan türeyen native sipariş (`source` 'mikro…') dışlanır —
 *     aynı fatura hem `orders` hem `mikroFaturalar` üzerinden iki kez sayılmasın.
 *     Dışlanan kayıt "tutarsız" sayacına da GİRMEZ (ekrandaki not şişmesin).
 *   • Yalnız `yon === 'giden'` (satış) faturası ciroya girer.
 * Tutarı okunamayan kayıt 0 SAYILMAZ, SAYILIR: `tutar.bilinmeyen` ekrandaki
 * "N kaydın tutarı okunamadı (kısmi toplam)" notunu besler.
 */
export function panoCirosu(
  nativeSiparisler: readonly (SiparisTutarAlanlari & SiparisKaynakAlani)[],
  mikroFaturalar: readonly PanoMikroFatura[],
): PanoCiro {
  const native = toplaBilinen(nativeSiparisler.filter(o => !mikroTurevi(o)), siparisTutari);
  const mikro = toplaBilinen(
    mikroFaturalar.filter(f => f.yon === 'giden').map(mikroFaturadanPanoSiparisi),
    siparisTutari,
  );
  const tutar = tutarBirlestir(native, mikro);
  return { tutar, native, mikro, ekran: ekranTutari(tutar) };
}
