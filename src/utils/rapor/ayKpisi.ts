/**
 * ayKpisi.ts — "Bu Ay" KPI kartlarının (RaporlarPage Phase 570) TEK hesabı.
 * Test: `ayKpisi.test.ts` (ÖNCE yazıldı, kırmızı görüldü). Saf modül — React/DB/metin yok.
 * Faz 3 6a hakem turu (2026-09-20).
 *
 * ## NEDEN VAR
 * Hesap sayfada inline duruyordu (`RaporlarPage.tsx:435-450`) ve bu yüzden ÖLÇÜSÜ YOKTU.
 * Hakem şu mutasyonu denedi ve tek bir test bile kırılmadı:
 *
 *     const actOrders570 = monthOrders570.length;        // (eski hâlin ta kendisi)
 *
 * Bu satır K2'yi ("iptaller ciroya girmez" — kullanıcı: *"hayır"*) yarım uyguluyor: Sipariş
 * Adedi iptalleri SAYAR, Aylık Ciro saymaz; Ort. Sipariş Değeri'nin PAYI iptal hariç,
 * PAYDASI iptal dahil olur — yani ortalama, iptal sayısı kadar küçülür. Ciro, adet ve
 * ortalama artık TEK kümeden çıkar ve kümeyi bozan her mutasyon bu modülün testinde ölür.
 *
 * ## K2 (kullanıcı kararı, KARARLAR.md)
 * *"İptaller ciroya girsin mi → **hayır**."* Süzgeç ikinci kez elle yazılmaz: küme
 * `pano/raporVeriKatmani.raporCirosu`'nun (`status !== 'Cancelled'`) ta kendisidir ve adet
 * o kümenin sayacıdır (`bilinen + bilinmeyen`).
 *
 * ## İKİ SÖZLEŞME (src/utils/para.ts — karıştırma)
 *   • `ekranCiro` = EKRAN toplamı (`ekranTutari`): kısmi olabilir, yanında "N sipariş
 *     tutarsız" notu durur; hiç bilinen yoksa NaN → '—'.
 *   • `tamCiro` / `ortalama` = TÜRETİLEN sayı (`tamTutar`): tek sipariş bile tutarsızsa
 *     hesaplanmaz (NaN → '—', hedef çubuğu çizilmez).
 *
 * ## Parite
 * Bilinen girdide sayılar sayfanın bugünkü hâliyle BİREBİR: aynı `raporCirosu`, aynı
 * `ortalamaSiparis`, aynı `zamanMs` tarih çözümü, aynı `>= ayBasi` sınırı.
 *
 * ## Bilinçli sınır (devir)
 * Tarihi okunamayan sipariş aya GİRMEZ ve burada SAYILMAZ — sayfanın bugünkü davranışı
 * (parite). Dürüst olan, düşen kaydı sayıp ekranda "N sipariş tarihsiz" demektir; sayacın
 * hem modüle hem karta eklenmesi ayrı bir iştir (bir sonraki alt faz), yarım bağlanmasın
 * diye bu turda AÇILMADI.
 */
import { ekranTutari, tamTutar, type Tutar } from '../para';
import { zamanMs } from '../zaman';
import { BOS_TUTAR, raporCirosu, ortalamaSiparis, type RaporSiparisi } from '../pano/raporVeriKatmani';

/** Ay KPI'sının sipariş girdisi — yapısal (kanonik `Order` ve sentetik Mikro kaydı uyar). */
export interface AyKpiSiparisi extends RaporSiparisi {
  createdAt?: unknown;
}

export interface AyKpiSonucu {
  /** Ay içindeki İPTAL OLMAYAN siparişlerin tutar kovası (kısmi toplam + sayaçlar). */
  ciro: Tutar;
  /** EKRAN sözleşmesi: kısmi toplam olabilir; hiç bilinen yoksa NaN ('—'). */
  ekranCiro: number;
  /** Ciro kümesinin KENDİ adedi (iptaller hariç); pencere çözülemezse NaN. */
  adet: number;
  /** TÜRETME kapısı: bir sipariş bile tutarsızsa NaN. */
  tamCiro: number;
  /** Ort. sipariş değeri — TÜRETME; adet 0 ya da ciro kısmiysa NaN. */
  ortalama: number;
  /**
   * Ay içindeki İPTAL edilmiş sipariş sayısı — `ciro`/`adet`/`ortalama`nın DIŞINDA; pencere
   * çözülemezse NaN (sessiz 0 DEĞİL). Faz 3 6a düzeltme turu (2026-09-22) ADDITIVE ekledi.
   *
   * NEDEN VAR: K2 uygulandıktan sonra aynı sayfada İKİ "sipariş adedi" belirdi — bu kart
   * iptalleri düşüyor, hemen altındaki P603 trend grafiği 'orders' metriğinde PARİTE gereği
   * düşmüyor — ve farkı açıklayan hiçbir satır yoktu (panelin tek kapsam notu YALNIZ tutarı
   * okunamayan kayıtları sayıyor). Sayaç, kartın altına "N sipariş iptal edildi" notunu
   * bastırmak içindir; trend grafiğinin süzgeci DEĞİŞTİRİLMEDİ (parite korunur).
   */
  iptalAdedi: number;
}

/** Pencere çözülemediğinde dönen "bilinmiyor" sonucu — sessiz sıfır DEĞİL. */
const BILINMEYEN_AY: AyKpiSonucu = {
  ciro: BOS_TUTAR, ekranCiro: NaN, adet: NaN, tamCiro: NaN, ortalama: NaN, iptalAdedi: NaN,
};

/**
 * `ayBasi`'ndan (dahil) bugüne kadarki siparişlerin ciro / adet / ortalamasını verir.
 *
 * `ayBasi` çözülemezse (geçersiz tarih) hiçbir sipariş pencerenin içinde ya da dışında
 * SAYILAMAZ: sonuç bilinmez (NaN) — "bu ay hiç sipariş yok" (0) demek uydurma olurdu.
 * Girdi dizisi ve öğeleri okunur, DEĞİŞTİRİLMEZ.
 */
export function ayKpisi(siparisler: readonly AyKpiSiparisi[], ayBasi: unknown): AyKpiSonucu {
  const baslangic = zamanMs(ayBasi);
  if (baslangic === null) return BILINMEYEN_AY;

  // `new Date(o.createdAt as string)` KALDIRILDI (2026-08-24 tarih denetimi; yorum kodla
  // BİRLİKTE RaporlarPage'den taşındı). Girdi iki kaynağı birleştirir: Cetpa-native
  // siparişlerde `createdAt` bir `Timestamp` ÖRNEĞİ, Mikro sözde-siparişlerinde ISO string.
  // Timestamp sınıfının toString/valueOf'u YOK, dolayısıyla `new Date(örnek)` HER ZAMAN
  // Invalid Date verir ve `d >= ayBasi` sessizce false döner: bu KPI paneli (Aylık Ciro /
  // Sipariş Adedi / Ort. Sipariş Değeri) ayın BÜTÜN native siparişlerini sayımdan düşürüyor,
  // yalnız Mikro faturalarını sayıyordu. Tarihi okunamayan sipariş aya giremez — `zamanMs`
  // ASLA "şimdi"ye düşmez.
  const ayIcinde = siparisler.filter(o => {
    const ms = zamanMs(o.createdAt);
    return ms !== null && ms >= baslangic;
  });

  // K2 süzgeci `raporCirosu`'nun İÇİNDE (iptal hariç) — burada ikinci kez yazılmaz.
  const ciro = raporCirosu(ayIcinde);
  // Adet, cironun toplandığı kümenin TA KENDİSİDİR: tutarı okunamayan sipariş de bir
  // kayıttır (bilinmeyen SAYILIR), iptal edilen ise kümede hiç yoktur.
  const adet = ciro.bilinen + ciro.bilinmeyen;
  // İptal sayısı ÇIKARMAYLA bulunur: `status === 'Cancelled'` karşılaştırması ikinci kez
  // YAZILMAZ (K2'nin tek kuralı `raporCirosu`'nun içindedir; kopya süzgeç, biri değişince
  // sessizce ayrışır). `ayIcinde` pencerenin tamamı, `adet` iptalsiz kümenin sayacı.
  const iptalAdedi = ayIcinde.length - adet;

  return {
    ciro,
    ekranCiro: ekranTutari(ciro),
    adet,
    tamCiro: tamTutar(ciro),
    ortalama: ortalamaSiparis(ciro, adet),
    iptalAdedi,
  };
}
