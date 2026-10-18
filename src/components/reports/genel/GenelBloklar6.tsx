/**
 * GenelBloklar6.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 3200–3754).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * ── 6d bağlama notu (Faz 3 "Genel III", 2026-10-18; şartname faz3-2n-specs/6n-kesif/6d/baglama-genel-bloklar6.md v2) ──
 * 15 panelden yedisi KALDIRILDI (K14 — üçü O25 çifti, dördü kullanıcının 2026-10-18 K14 aday kararıyla), yedisi testli
 * yardımcılara BAĞLANDI, biri (P15) K24 gereği dokunulmadı; kalan panellerden on kutu kalktı.
 * K1  — PLAN-v2 §8 sıra 6 (KARARLAR.md'de kullanıcı cümlesi yok) + O26: sipariş tutarı hayalet `total` DEĞİL; seçici SEC; kalem
 *       toplamından yedek yok.
 * K2  — kullanıcı 2026-09-19: "İptaller ciroya girsin mi → hayır." Ciro okuyan sekiz panel iptali katıyordu (beşi kaldı) →
 *       rakamlar DÜŞER.
 * K4  — kullanıcı: "kimlikle" (en iyi müşteri; kimliksiz satır değil not).
 * K13 — kullanıcı: "veri eklenebiliyorsa ver, mikro yüzünden verilemiyorsa N/A yaz, CETPA App verisi varsa N/A+ "xx,xx"
 *       göster." → kategori stok kartından (veri Cetpa'da VAR — "N/A" dalına girmez).
 * K14 — kullanıcı 2026-09-19: "kaldır" — üç çift panel + on kutu kalktı (orkestratör O25, N1 / N2 / N4). Yalnız pencere
 *       farkı olan dört panel / kutu kullanıcıya aday olarak soruldu; kullanıcı 2026-10-18 «ok» = aday tablosunun altı satırı da
 *       «kaldır» → P2 (son kutusu «7d»; panel bütünüyle), P7, P11, P13 KALDIRILDI, yerlerinde karar yorumu durur.
 * K20 — kullanıcı: "ok kalsın." · K21 "Tüm ciro" · K24 "kalsın, hafızaya at sonra bakarız." · K-KALEM KDV hariç ("KDV dahil mi
 *       hariç mi olacak hangisi doğruysa onu seç.") · K-YÜZDE "%42 şeklinde olsun".
 * K26 / K28 / K-TAHMİN — PLAN-v2 §8 varsayılanları (kullanıcı cümlesi yok): hayalet çubuk tabanı yok; dönemler takvime oturur;
 *       tek tahmin modeli.
 * "Kur yoksa uydurma yok" (kullanıcı) + O21: TRY dışı mağaza siparişi TL toplamına / paya / paydaya girmez, ayrı notta sayılır.
 *
 * Bilinçli farklar (bilinen girdide sayılar eskiyle BİREBİR; değişenler kullanıcı / orkestratör kararı ya da kısmi veri):
 *  • Ciro tabanı sipariş BAŞLIK tutarı (KDV dâhil; GB1–GB4 ile aynı tanım) — eskiden KDV hariç kalem toplamıydı (Mikro faturası
 *    kalemi fiyat taşımadığı için ₺0) → rakamlar YÜKSELİR. Başlığı olmayan sipariş «tutarı okunamadı» sayılır (O26).
 *  • İptaller ciroya girmez (K2); iptal oranı yine TÜM sipariş üzerinden (O28).
 *  • Son N TAKVİM dönemi (O27): ay yarısı ve kategori 5 ay; boş dönem gerçek 0; pencerede yeterli kaydı olmayan kiracıda panel
 *    gizlenir.
 *  • Bilinmeyen 0 sayılmaz: ekran toplamı kısmi + kapsam notu; türetilen sayı (yüzde, pay, hız) '—'; çubukta
 *    bilinmeyen gri taralı, gerçek 0 boş ray (piksel tabanları kalktı).
 *  • Kısaltılmış tutar seçili birimde; sıfıra yuvarlanan küçük tutar tam yazılır (GENEL-2). Yüzdeler "%42" biçiminde.
 *  • Kategori stok kartından (O22 / O30), ürün anahtarı sku → ad → başlık; uydurma "Unknown" / "Other" kovaları kalktı.
 */
import { useMemo } from 'react';
import { type ReportsCtx } from '../useReportsData';
import { type Order, type OrderLineItem } from '../../../types';
import { siparisIptalMi, siparisTutari } from '../../../utils/siparis';
import { tryDisiMi } from '../../../utils/siparisler/magazaSiparisi';
import { zamanMs, ayAnahtari } from '../../../utils/zaman';
import { ekranTutari, tamTutar, tutarBirlestir } from '../../../utils/para';
import { tutarSatiri, olcekReferansi, cubukOrani, sayacOlcegi, seriCubukOrani } from '../../../utils/pano/cubuk';
import { stokKartiCozucu } from '../../../utils/pano/raporMarj';
import { segmentCirosu } from '../../../utils/pano/musteriAnaliz';
import { kalemTutari, kdvDahilKalemVar, durumDagilimi, PANO_DURUMLARI } from '../../../utils/pano/stokSevkiyat';
import { yuzdeOrani } from '../../../utils/pano/finansKpi';
import { satisHizi } from '../../../utils/pano/hedefButce';
import { zamanKovalari, tarihliKovala } from '../../../utils/rapor/zamanDagilimi';
import { kovayaYerlestir, enBuyukBilinen, type KovaSiniri } from '../../../utils/rapor/dagilim';
import { kumulatifPaylar } from '../../../utils/rapor/yogunlasma';
import { musteriOzeti, ciroSirali } from '../../../utils/rapor/musteri';
import { yuzdeYaz } from '../../../utils/rapor/bicim';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';
import { rc } from '../../../i18n/rapor';

// O5 genişlemesi (orkestratör, 6d): `leadCariKodu` GenelRapor'dan geçer (P1 en iyi müşteri — K4). N2 (orkestratör): stok
// prop'u GEREKMEZ (tek okuyucusu kalkan düşük stok kutusuydu) → Props'a EKLENMEDİ.
type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'quotations' | 'currentLanguage' | 'fmtAna'
  | 'leadCariKodu'>;

/*
 * K20 — kullanıcı 2026-09-19: "ok kalsın." Koda gömülü pencere / kova / eşik DEĞERLERİ DEĞİŞMEZ; yalnız adlandırılır.
 */
const GUN_MS = 86400000;
/** P5 — sipariş büyüklüğü kovaları. Sınırlar GenelOzet.tsx `SIPARIS_DEGERI_KOVALARI` (P189) ile BİREBİR (üst HARİÇ, son `Infinity`); etiketler bugünkü metin (K24 — çevrilmez). */
const SIPARIS_BUYUKLUK_KOVALARI: readonly KovaSiniri[] = [
  { etiket: '<₺1k', ust: 1000 },
  { etiket: '₺1-5k', ust: 5000 },
  { etiket: '₺5-20k', ust: 20000 },
  { etiket: '₺20-100k', ust: 100000 },
  { etiket: '₺100k+', ust: Infinity },
];
/** P6 — gösterilen TAKVİM ayı sayısı (O27), ay ortası (bu günden ≤ = ilk yarı), panel kapısı (pencerede kaydı olan ay). */
const AY_YARISI_AY = 5, AY_ORTASI_GUN = 15, AY_YARISI_ASGARI = 2;
/** P9 — TAKVİM ayı penceresi (O27), gösterilen kategori sayısı, kapılar (kategori sayısı; kalemi olan ay sayısı). */
const KATEGORI_AY = 5, KATEGORI_N = 3, KATEGORI_ASGARI = 2, KATEGORI_AY_ASGARI = 2;
/** P10 — hız pencereleri (gün), ARTAN sırada; son eleman en geniştir (notun kapsamı — YK1a). */
const HIZ_PENCERELERI: readonly number[] = [7, 30, 90, 365];

// K1 (PLAN-v2 §8 sıra 6; KARARLAR.md'de K1 için kullanıcı cümlesi yok) + O26 (orkestratör): sipariş tutarı hayalet `o.total`
// DEĞİLDİR; `total` / `unitPrice` OKUNMAZ; kalem toplamından YEDEK YOK. Seçici GenelBloklar5 ve GB1–GB4 ile AYNI (Genel sekmesinde
// tek sipariş tutarı tanımı); başlığı olmayan sipariş "tutarı okunamadı" sayılır.
const SEC = siparisTutari;
// O30 (orkestratör): kategori kuralı GenelBloklar4.tsx P495 ile AYNI — boş / yalnız boşluk metin kategori DEĞİLDİR (kırpılmaz).
// GenelBloklar4.tsx dosyasındaki tanımla BİREBİR bilinçli kopya; 6m'de tek yardımcıda birleşir (devir).
const doluMetin = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null);

export default function GenelBloklar6({ reportsTab, orders, inventory, employees, quotations, currentLanguage, fmtAna,
  leadCariKodu }: Props) {
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  // K2 (kullanıcı, 2026-09-19): "İptaller ciroya girsin mi → hayır." Tek kural `siparis.siparisIptalMi`. Bu dosyanın ciro
  // okuyan sekiz paneli bugün iptali katıyordu (sipariş durumu yalnız P8 / P12'de okunuyordu — 2026-10-18 ölçümü; beşi kaldı) →
  // rakamlar DÜŞER. O28 (orkestratör): tutar okumayan sayım paneli bu kümeyi sayardı — tek örneği (aylık sipariş adedi) kullanıcının
  // 2026-10-18 K14 aday kararıyla kalktı; küme `satislar` / `dovizliler`in tabanıdır.
  const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);
  // O21 (orkestratör; kullanıcı kararı "kur yoksa uydurma yok"): TRY dışı mağaza siparişinde `totalPrice` YOK. Bozuk veri DEĞİL:
  // TL toplamına, paya, paydaya, "tutarı okunamadı" sayacına GİRMEZ; `dovizliler`de ayrı sayılır. Süzgeç ÇAĞIRANDA.
  const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);
  const dovizliler = useMemo(() => iptalsiz.filter(o => tryDisiMi(o)), [iptalsiz]);
  // O22 (orkestratör; K13): kalem → stok KARTI eşlemesinin TEK kuralı (GB4 ile aynı; kopya kart araması YAZILMAZ).
  const kartBul = useMemo(() => stokKartiCozucu(inventory), [inventory]);
  // O28 (orkestratör): durum dağılımı TÜM siparişten (iptal dâhil) — P8'in iptal oranı paydası ve "Total Orders" satırı; P8 / P12
  // («Active Orders») aynı sayıyı okur.
  const durumlar = useMemo(() => durumDagilimi(orders, PANO_DURUMLARI), [orders]);
  // İşlemdeki sipariş (bekleyen + hazırlanan + kargoda; RaporlarPage P631 ile aynı kovalar): P8 «In Progress» satırı ve P12
  // «Active Orders» kutusu AYNI sayıdır → tek tanım burada (iki panelde kopya toplam yazılmaz). Tanınmayan durum buraya
  // KARIŞMAZ (`durumlar.diger`, P8 notu); iptal tanım gereği giremez.
  const islemdeSiparis = durumlar.sayilar.Pending + durumlar.sayilar.Processing + durumlar.sayilar.Shipped;
  // K4 (kullanıcı): "kimlikle". O5: harita GenelRapor'dan; verilmezse Cetpa kaydı ile Mikro carisi BİRLEŞTİRİLMEZ.
  const musteriSecenek = { tutarSec: SEC, tarihSec: (o: Order) => zamanMs(o.createdAt), leadCariKodu };
  // Kısaltılmış tutar (orkestratör GENEL-2; kapı gb5-7): `fmtAna` tutarı SEÇİLİ birime çevirip 1000'e böler → USD'de küçük tutar
  // "$0K" olur; bilinen, sıfır olmayan tutar 0 gibi görünür. Kısaltmada 1–9 rakamı yoksa tam biçime düşülür. GenelBloklar5 ile AYNI
  // tanım; dosyadaki BÜTÜN kısaltmalar buradan. Bilinmeyen (NaN) iki kolda da '—'; bilinen 0 tam biçim (meşru sıfır).
  const kisaEtiket = (e: number, ondalik = 0): string => {
    const k = fmtAna(e, 'K', ondalik);
    return /[1-9]/.test(k) ? k : fmtAna(e, 'full', 0);
  };
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        // O6 (orkestratör; K23 ilkesi "girilmeyen hesaba katılmaz + not") + O33: en büyük sipariş tutarı BİLİNENLERDEN; bilinmeyen
        // SAYILIR (`EnBuyukBilinen.bilinmeyen` — ikinci toplama geçişi YOK). Fonksiyon null DÖNMEZ: hiç bilinen yoksa oge / deger null.
        // Kimliksiz siparişin tutarı da adaydır (müşteri bilinmiyor, tutar biliniyor).
        const enBuyuk1 = enBuyukBilinen(satislar, SEC);
        // K4 (kullanıcı): "kimlikle" — kimliksiz sipariş SATIR olmaz, notta sayılır.
        const mus1 = musteriOzeti(satislar, musteriSecenek);
        // Taç yalnız cirosu BİLİNEN müşteriye: `ciroSirali` cirosu bilinmeyeni SONA dizer ama listeyi boşaltmaz → hiçbir müşterinin
        // cirosu okunamıyorsa ilk satır rastgele bir müşteriydi ve «Top Customer» onu adıyla taçlıyordu (inceleme B3). Sıralamanın
        // başı ekran tutarı sonlu değilse en iyi müşteri BİLİNMİYOR → kart '—' (tutarı okunamayan sipariş notta sayılır).
        const aday1 = ciroSirali(mus1.musteriler).at(0);
        const enIyiMusteri1 = aday1 !== undefined && Number.isFinite(ekranTutari(aday1.ciro)) ? aday1 : null;
        // En büyük siparişin müşterisi de AYNI kimlik kuralıyla (ham ad okunmaz; '—' yer tutucusu ad sayılmaz).
        const buyukMusteri1 = enBuyuk1.oge === null ? undefined : musteriOzeti([enBuyuk1.oge], musteriSecenek).musteriler[0];
        // K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır. Bu kartın en yüksek ciro
        // günü kutusu KALDIRILDI (orkestratör O25: aynı ölçü × aynı kırılım × aynı pencere, kutu düzeyi): kalan GenelBloklar4.tsx
        // «Top 10 Revenue Days — All Time» listesinin 1. satırı (aynı küme, aynı tarih ve gün anahtarı).
        // K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Bu kartın toplam sipariş adedi kutusu da KALDIRILDI
        // (orkestratör O25 + ölçüm notu N2: aynı ölçü × aynı kırılım × aynı pencere — sipariş adedi, tüm zaman): kalan Genel Özet
        // «Sipariş» KPI'sı ve GenelBloklar3.tsx P12 «Toplam Sipariş» kutusu.
        const kartlar1 = [
          { label: 'Largest Order', val: enBuyuk1.deger === null ? '—' : kisaEtiket(enBuyuk1.deger, 1), sub: buyukMusteri1 === undefined ? '—' : (buyukMusteri1.ad ?? buyukMusteri1.kimlik), icon: '💎' },
          { label: 'Top Customer', val: enIyiMusteri1 === null ? '—' : kisaEtiket(ekranTutari(enIyiMusteri1.ciro), 1), sub: enIyiMusteri1 === null ? '—' : (enIyiMusteri1.ad ?? enIyiMusteri1.kimlik), icon: '👑' },
        ];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Tüm Zamanların Rekorları' : 'All-Time Records'}</h3>
            <div className="grid grid-cols-2 gap-2">
              {kartlar1.map(r=>(
                <div key={r.label} className="rounded-xl p-3 bg-gray-50">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-sm">{r.icon}</span>
                    <span className="text-[10px] text-gray-400">{r.label}</span>
                  </div>
                  <p className="text-base font-bold text-gray-800">{r.val}</p>
                  <p className="text-[9px] text-gray-400 truncate">{r.sub}</p>
                </div>
              ))}
            </div>
            {/* İki sayaç farklı kartları açıklar, TOPLANMAZ: tutarı okunamayan sipariş en büyük siparişe ve en iyi müşterinin cirosuna girmez (aynı küme, aynı seçici); kimliksiz sipariş yalnız müşteri kartının dışında kalır. */}
            <KapsamNotu sayaclar={{ tutarsiz: enBuyuk1.bilinmeyen, kimliksiz: mus1.kimliksiz }} birim="siparis" dil={currentLanguage} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır. «Ciro Artış Oranları» panelinin 30 ve 90 günlük kutuları KALDIRILDI: 30 gün → GenelBloklar3.tsx P2 «Satış Momentum Skoru» «Ciro» kutusu, 90 gün → GenelBloklar5.tsx P9 «Son 90 Gün ve Önceki 90 Gün».
          Orkestratör O25: aynı ölçü × aynı kırılım × aynı pencere, kutu düzeyi (30 gün için ölçüm notu N1); kalanlar aynı
          sınırlarla dönem cirosunu ve değişim yüzdesini gösterir. */}
      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar2.tsx P234 «Haftalık Ciro & Yıllık Projeksiyon» haftalık ciro değişim rozeti kalır; panelin son kutusu «7d» de kalktığı için «Ciro Artış Oranları» paneli bütünüyle KALDIRILDI.
          K14 aday tablosu satır 6. Orkestratör O25: aynı ölçü × aynı kırılım (ciro değişim yüzdesi × toplam), fark yalnız
          pencereydi (kayan son 7 gün / içinde bulunulan takvim haftası); aday olarak soruldu, kullanıcının cevabı «kaldır». */}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan: testli
          yardımcıya bağlı olan). Bu dosyadaki ikinci "bu yıl ↔ geçen yıl, ay ay ciro" paneli KALDIRILDI (orkestratör O25: aynı ölçü ×
          aynı kırılım × aynı pencere). Kalan tek panel GenelBloklar2.tsx P251 (6c'de testli dönem yardımcısına bağlı; iptaller ve TL
          dışı siparişler hariç). */}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Bu dosyadaki ikinci "ay ortalaması ÷ genel
          ortalama (100 = ortalama ay)" paneli KALDIRILDI (orkestratör O25: aynı ölçü × aynı kırılım × aynı pencere). Kalan tek panel
          GenelBloklar3.tsx P13 — testli yardımcısının başlığı iki paneli AYNI tanım sayıyordu (taban: ay ortalama sipariş tutarı). */}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K1 / O26 + K2 + O21: kova tutarı başlık tutarından (SEC), iptalsiz TL satışlardan. O6: tutarı okunamayan sipariş HİÇBİR
        // kovaya girmez (bugün ilk kovayı şişiriyordu), SAYILIR; negatif tutar `kapsamDisi` (bugün sessizce düşüyordu); bilinen ₺0
        // ilk kovaya (parite). O28: kova ADEDİ ciroyla aynı kümeden (`satislar`).
        const k5 = kovayaYerlestir(satislar, SEC, SIPARIS_BUYUKLUK_KOVALARI);
        // K21 (kullanıcı, 2026-09-24): "Tüm ciro" — pay paydası TÜM kovalanan ciro (bilinmeyen / kapsam dışı paydada YOK + not);
        // kova sırası korunur ('girdi'). Payda yoksa ya da bilinmiyorsa yüzde '—'.
        const p5 = kumulatifPaylar(k5.kovalar, k => k.tutar, { sira: 'girdi' });
        // Ölçek: en büyük kovanın cirosu; o kova kısmiyse ölçek YOK (çubuklar taralı). Uydurma `, 1` tabanı YOK.
        const olcek5 = olcekReferansi(k5.kovalar.map(k => tutarSatiri(k.tutar)));
        const colors=['#94a3b8','#3b82f6','#f59e0b','#ff4000','#8b5cf6'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Büyüklüğüne Göre Ciro' : 'Revenue by Order Size'}</h3>
            <div className="space-y-2">
              {k5.kovalar.map((k, i) => k.adet > 0 && (
                <div key={k.etiket} className="flex items-center gap-2">
                  <span className="text-[10px] w-14 text-gray-600">{k.etiket}</span>
                  <div className="flex-1"><OlcekCubugu oran={cubukOrani(tutarSatiri(k.tutar), olcek5)} renk={colors[i]} kalinlik="h-4" dil={currentLanguage} /></div>
                  {/* Adet çubuğun DIŞINDA: dar çubukta beyaz etiket görünmüyordu. */}
                  <span className="text-[9px] font-bold text-gray-600 w-6 text-right">{k.adet}</span>
                  <span className="text-[9px] text-gray-400 w-8 text-right">{yuzdeYaz(p5.satirlar[i].pay, 0, dil)}</span>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: k5.bilinmeyen, kapsamDisi: k5.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).dagilima_dahil_degil} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const simdi6 = new Date();
        // O27 (orkestratör): "verisi olan son 5 ay" yerine son 5 TAKVİM ayı — kaydı olmayan ay GERÇEK ₺0 olarak görünür.
        // Kova 2i = ayın ilk yarısı (gün ≤ AY_ORTASI_GUN — bugünkü kural), 2i + 1 = ikinci yarısı; i = 0 en eski ay. Gelecek tarihli
        // ve 5 aydan eski kayıt aralık dışı → `kapsamDisi` (nota KONMAZ — pencere tanımdır).
        const indeks6 = (d: Date) => {
          const ayFarki = (simdi6.getFullYear() - d.getFullYear()) * 12 + (simdi6.getMonth() - d.getMonth());
          if (ayFarki < 0 || ayFarki >= AY_YARISI_AY) return -1;
          return (AY_YARISI_AY - 1 - ayFarki) * 2 + (d.getDate() <= AY_ORTASI_GUN ? 0 : 1);
        };
        // K1 / O26 + K2 + O21: iptalsiz TL satışların başlık tutarı; tarihsiz sipariş SAYILIR (bugün sessizdi).
        const z6 = zamanKovalari(satislar, 2 * AY_YARISI_AY, indeks6, { tarihSec: o => o.createdAt, tutarSec: SEC });
        const aylar6 = Array.from({ length: AY_YARISI_AY }, (_, i) => ({
          ay: new Date(simdi6.getFullYear(), simdi6.getMonth() - (AY_YARISI_AY - 1 - i), 1),
          ilk: z6.kovalar[2 * i], ikinci: z6.kovalar[2 * i + 1],
        }));
        // Kapı paritesi (bugünkü "2 aydan az veri → gizle"): pencerede kaydı olan ay sayısı (eski veri pencere dışındaysa gizlenir).
        if (aylar6.filter(a => a.ilk.adet + a.ikinci.adet > 0).length < AY_YARISI_ASGARI) return null;
        const ilk6 = tutarBirlestir(...aylar6.map(a => a.ilk.ciro)), ikinci6 = tutarBirlestir(...aylar6.map(a => a.ikinci.ciro));
        // Pay TÜRETMEDİR (`tamTutar`): tek bilinmeyen tutar ya da payda yoksa '—'.
        const ilkPay6 = yuzdeOrani(tamTutar(ilk6), tamTutar(tutarBirlestir(ilk6, ikinci6)));
        // Tamamlayıcı: iki yüzde ayrı yuvarlanınca toplam %101 olabiliyordu (harita `genel-6.json` P6 notu).
        const ikinciPay6 = ilkPay6 === null ? null : 100 - ilkPay6;
        // K26 (PLAN-v2 §8 sıra 21 varsayılanı: "bilinmeyen = gri taralı, gerçek 0 = boş"): ölçek tepe yarının cirosu; tepe kısmiyse
        // ölçek YOK (hepsi taralı — 6c kuralı). 2 px taban KALKTI.
        const olcek6 = olcekReferansi(z6.kovalar.map(k => tutarSatiri(k.ciro)));
        // Sayaç toplamı: penceredeki tutarı okunamayan siparişler (yarılar ayrık → çift sayım yok).
        const tutarsiz6 = z6.kovalar.reduce((s, k) => s + k.ciro.bilinmeyen, 0);
        // Sayaç toplamı: penceredeki dövizli sipariş (ikinci pencere tanımı yazılmadı, aynı `indeks6`; yalnız adet okunur).
        const dovizli6 = zamanKovalari(dovizliler, 2 * AY_YARISI_AY, indeks6, { tarihSec: o => o.createdAt }).kovalar.reduce((s, k) => s + k.adet, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue: First vs Second Half of Month</h3>
            <div className="flex items-end gap-2 h-20 mb-1">
              {aylar6.map(a=>(
                <div key={a.ay.getTime()} className="flex-1 flex items-end gap-0.5">
                  <div className="flex-1 h-16"><OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(a.ilk.ciro), olcek6)} renk="#3b82f6" koseSinifi="rounded-sm" dil={currentLanguage} /></div>
                  <div className="flex-1 h-16"><OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(a.ikinci.ciro), olcek6)} renk="#ff4000" koseSinifi="rounded-sm" dil={currentLanguage} /></div>
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-2">{aylar6.map(a=><span key={a.ay.getTime()} className="flex-1 text-center text-[9px] text-gray-400">{String(a.ay.getMonth() + 1).padStart(2, '0')}</span>)}</div>
            <div className="flex justify-between text-xs">
              <span className="text-blue-500">1st half: {yuzdeYaz(ilkPay6, 0, dil)}</span>
              <span className="text-brand">2nd half: {yuzdeYaz(ikinciPay6, 0, dil)}</span>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz6, tarihsiz: z6.tarihsiz }} birim="siparis" dil={currentLanguage} />
            <KapsamNotu sayaclar={{ dovizli: dovizli6 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar4.tsx P96 «Rolling 7-Day Avg Revenue — Last 28 Days» kalır; bu dosyadaki «7-Day Rolling Revenue Avg» paneli KALDIRILDI.
          K14 aday tablosu satır 3. Orkestratör O25: aynı ölçü × aynı kırılım (7 günlük kayan ortalama ciro × gün), fark
          yalnız pencere uzunluğuydu (30 / 28 takvim günü); aday olarak soruldu, kullanıcının cevabı «kaldır». Kalan panel 6c
          O8 reçetesiyle testli yardımcıya bağlıdır. */}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // O28 (orkestratör): iptal oranının paydası ve "Total Orders" satırı TÜM sipariş (iptal dâhil; tutar okunmaz → dövizli notu YOK).
        const teslim8 = durumlar.sayilar.Delivered;
        // K2: iptal yüklemi siparisIptalMi ile AYNI (status === 'Cancelled'); ikinci süzgeç yazılmaz.
        const iptal8 = durumlar.sayilar.Cancelled;
        // K-YÜZDE (kullanıcı): "%42 şeklinde olsun". Payda yoksa '—' (bugün uydurma %0).
        const iptalOrani8 = yuzdeOrani(iptal8, durumlar.toplam);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Karşılama Oranı' : 'Order Fulfillment Rate'}</h3>
            <div className="flex items-center gap-4 mb-3">
              {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan: testli
                  yardımcıya bağlı olan). Bu paneldeki teslim / karşılama oranı halkası KALDIRILDI (orkestratör O25 + ölçüm notu N4: aynı
                  ölçü × aynı kırılım × aynı pencere — teslim oranı, tüm zaman). Kalan GenelBloklar3.tsx P12 «Teslimat Oranı» kutusu
                  (iptalleri paydada sayması 6m devri). Panel sipariş durum satırları ve iptal oranıyla kalır. */}
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{durumlar.toplam}</span></div>
                <div className="flex justify-between"><span className="text-green-600">Delivered</span><span className="font-bold text-green-600">{teslim8}</span></div>
                <div className="flex justify-between"><span className="text-blue-500">In Progress</span><span className="font-bold text-blue-500">{islemdeSiparis}</span></div>
                <div className="flex justify-between"><span className="text-red-500">Cancelled ({yuzdeYaz(iptalOrani8, 0, dil)})</span><span className="font-bold text-red-500">{iptal8}</span></div>
              </div>
            </div>
            {/* `Order.status` birleşim tipi → pratikte 0; tanınmayan durum eskiden sessizce "In Progress"e karışıyordu. */}
            <KapsamNotu sayaclar={{ kapsamDisi: durumlar.diger }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'durumu tanınmadı — teslim / işlemde / iptal satırlarına girmedi' : 'status not recognized — not in delivered / in progress / cancelled'} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length >= 3 && (() => {
        const simdi9 = new Date();
        // O27 (orkestratör): son 5 TAKVİM ayı. Anahtar kova SEÇİMİNDE uygulanır; pencere dışı ay okunmaz.
        const aylar9 = Array.from({ length: KATEGORI_AY }, (_, i) => new Date(simdi9.getFullYear(), simdi9.getMonth() - (KATEGORI_AY - 1 - i), 1))
          .map(d => ayAnahtari(d)).filter((a): a is string => a !== null);
        // O29 (orkestratör): ay kovası `tarihliKovala` — tarihsiz sipariş kovaya girmez, SAYILIR (bugün sessizdi). K2 + O21: satislar.
        const t9 = tarihliKovala(satislar, o => o.createdAt, ayAnahtari);
        // O21: dövizli kova BİR KEZ, aynı anahtar kuralıyla (ikinci pencere tanımı yazılmadı).
        const dz9 = tarihliKovala(dovizliler, o => o.createdAt, ayAnahtari);
        const pencere9 = aylar9.flatMap(a => t9.kovalar.get(a) ?? []);
        const kalemler9 = pencere9.flatMap(o => o.lineItems ?? []);
        // O22 (orkestratör; K13): kalemde kategori alanı yok (hayalet) — kategori eşleşen stok KARTINDAN. O30 (orkestratör): kural
        // GenelBloklar4.tsx P495 ile AYNI (boş metin anahtar değildir); ortak kategori yardımcısı bu turda yazılmadı, kopya 6m'ye devir.
        const kategori9 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);
        // K-KALEM (kullanıcı): "KDV dahil mi hariç mi olacak hangisi doğruysa onu seç." → KDV HARİÇ kalem tutarı (`kalemTutari`;
        // Mikro kalemi de sayılır). 6c O10: 4 parametreli biçim — kategorisi çözülemeyen kalem uydurma kova yerine anahtarsız
        // (paydada kalır, satır olmaz). İlk 3 kategori BEŞ AYIN birleşik cirosundan (bugün tüm zaman — bilinçli fark).
        const birlesik9 = segmentCirosu(kalemler9, kategori9, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
        // Gerçek sıfır / negatif cirolu kategori gösterilmez; cirosu bilinmeyen ATILMAZ (sırada sonda).
        const ilk9 = birlesik9.segmentler.filter(s => !(s.ciro <= 0)).slice(0, KATEGORI_N);
        // Ay başına aynı çağrı `anahtarlar = ilk 3` ile: `segmentler[ci]` = `ilk9[ci]`; o ayda satışı yoksa GERÇEK ₺0.
        const aylik9 = aylar9.map(a => {
          const kalemler = (t9.kovalar.get(a) ?? []).flatMap(o => o.lineItems ?? []);
          return { ay: a, kalemVar: kalemler.length > 0,
            s: segmentCirosu(kalemler, kategori9, ilk9.map(k => k.anahtar), { tutarSec: kalemTutari, anahtarsizSay: true }) };
        });
        if (ilk9.length < KATEGORI_ASGARI || aylik9.filter(a => a.kalemVar).length < KATEGORI_AY_ASGARI) return null;
        // Anahtarsız kalemin iki ayrık nedeni (toplamları yardımcının anahtarsız adedine eşit — o ayrıca basılmaz): kart YOK ↔ kart
        // var, kategorisi boş. `kartBul` saf ve aynı listeyle çağrılır → sayımlar aynı eşlemeyi görür.
        const eslesmeyen9 = kalemler9.filter(li => kartBul(li) === null).length;
        const kategorisiz9 = kalemler9.filter(li => kartBul(li) !== null && doluMetin(kartBul(li)?.category) === null).length;
        const palette=['#ff4000','#3b82f6','#22c55e'];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En İyi Kategori Ciro Eğilimi' : 'Top Category Revenue Trend'}</h3>
            <div className="space-y-2">
              {ilk9.map((kat, ci)=>{
                const degerler = aylik9.map(a => a.s.segmentler[ci]);
                // Kategori başına KENDİ ölçeği (parite); tepe ay kısmiyse ölçek YOK (taralı). 2 px taban KALKTI (K26).
                const olcek = olcekReferansi(degerler.map(s => ({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz })));
                return (
                  <div key={kat.anahtar}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{background:palette[ci]}}/>
                      <span className="text-[10px] text-gray-600">{kat.anahtar}</span>
                    </div>
                    <div className="flex items-end gap-1 h-8">
                      {degerler.map((s, i) => <div key={aylik9[i].ay} className="flex-1 h-7" style={{ opacity: 0.7 + (i / (degerler.length - 1)) * 0.3 }}><OlcekCubugu yon="dikey" oran={cubukOrani({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz }, olcek)} renk={palette[ci]} koseSinifi="rounded-sm" dil={currentLanguage} /></div>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-0.5 mt-1">{aylar9.map(a=><span key={a} className="flex-1 text-center text-[8px] text-gray-400">{a.slice(5)}</span>)}</div>
            {/* `tutarsiz` burada KALEM sayar; not modülü bu sayaçta `kalem` birimine izin vermez → nötr `kayit` (GB4 P495 emsali). */}
            <KapsamNotu sayaclar={{ tutarsiz: birlesik9.tutarsiz, kalemsiz: pencere9.filter(o => (o.lineItems ?? []).length === 0).length, eslesmeyen: eslesmeyen9, tarihsiz: t9.tarihsiz }} birim="kayit" dil={currentLanguage} />
            {kategorisiz9 > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${kategorisiz9} kalemin stok kartında kategori girilmemiş — kategori satırlarına girmedi, toplamda var` : `${kategorisiz9} line item(s) have no category on their stock card — not shown as a row, included in the total`}</p>
            )}
            <KapsamNotu sayaclar={{ dovizli: aylar9.flatMap(a => dz9.kovalar.get(a) ?? []).length }} birim="siparis" dil={currentLanguage} />
            {/* K-KALEM dipnotu (GB4 P495 ile AYNI kapı ve cümle): yalnız KDV dâhil satır tutarı en az bir kalemde kullanıldıysa. */}
            {kdvDahilKalemVar(pencere9) && (
              <p className="text-[10px] text-gray-400 mt-1">{rc(currentLanguage).mikro_faturasindan_tureyen_kalemlerde_satir_tuta}</p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K24 (kullanıcı): "kalsın, hafızaya at sonra bakarız." — başlıktaki birim metni bu turda değişmez (6m).
        const simdi10 = new Date();
        // Pencere sınırı bugünkü ms hesabıyla AYNI (parite; gelecek tarihli sipariş bugünkü gibi pencerede).
        const pencere10 = (gun: number) => { const b = new Date(simdi10.getTime() - gun * GUN_MS); return (d: Date) => (d >= b ? 0 : -1); };
        // K1 / O26 + K2 + O21: iptalsiz TL satışların başlık tutarı; tarihsiz sipariş SAYILIR (bugün sessizdi, hız aşağı kayıyordu).
        // Hız TÜRETMEDİR: penceresinde tek bilinmeyen tutar → `gunluk: null` ('—', taralı çubuk).
        const hizlar10 = HIZ_PENCERELERI.map(gun => {
          const z = zamanKovalari(satislar, 1, pencere10(gun), { tarihSec: o => o.createdAt, tutarSec: SEC });
          return { etiket: `${gun}d`, z, h: satisHizi(z.kovalar[0].ciro, gun) };
        });
        // Düz sayı ölçeği: yalnız pozitif bilinen hızlar; uydurma `, 1` tabanı YOK.
        const olcek10 = sayacOlcegi(hizlar10.map(r => r.h.gunluk));
        // YK1a (bu şartnamenin yerel kararı): aynı uçta (bugün) biten iç içe kayan pencere ailesinde not sayaçları EN GENİŞ
        // pencereden TEK satır — pencere başına not YAZILMAZ (sayı panelin KAPSAMIDIR).
        const enGenis10 = HIZ_PENCERELERI[HIZ_PENCERELERI.length - 1];
        const genis10 = hizlar10[hizlar10.length - 1].z;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">Revenue Velocity (₺/day)</h3>
            <div className="space-y-2">
              {hizlar10.map(r=>(
                <div key={r.etiket} className="flex items-center gap-2">
                  <span className="text-xs w-10 text-gray-600">{r.etiket}</span>
                  {/* K26: 24 px taban KALKTI; etiket çubuğun DIŞINDA (dar çubukta beyaz etiket görünmüyordu). */}
                  <div className="flex-1"><OlcekCubugu oran={r.h.gunluk === null ? null : seriCubukOrani(r.h.gunluk, olcek10)} renk="#ff4000" kalinlik="h-5" dil={currentLanguage} /></div>
                  <span className="text-[10px] font-bold text-gray-700 w-12 text-right">{r.h.gunluk === null ? '—' : kisaEtiket(r.h.gunluk, 1)}</span>
                  <span className="text-[9px] text-gray-400 w-14 text-right">{kisaEtiket(r.h.ekran, 0)} tot</span>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: genis10.kovalar[0].ciro.bilinmeyen, tarihsiz: genis10.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'bu siparişleri içeren pencerelerin günlük hızı hesaplanmadı' : 'daily rate not computed for the windows that contain them'} />
            <KapsamNotu sayaclar={{ dovizli: zamanKovalari(dovizliler, 1, pencere10(enGenis10), { tarihSec: o => o.createdAt }).kovalar[0].adet }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar1.tsx P217 «Ürün Karma Analizi (Top 6)» kalır; bu dosyadaki «Bu Ayın En İyi Ürünleri» paneli KALDIRILDI.
          K14 aday tablosu satır 5. Orkestratör O25: aynı ölçü × aynı kırılım (ürün cirosu × ürün), fark yalnız pencereydi
          (bu takvim ayı / tüm zaman); aday olarak soruldu, kullanıcının cevabı «kaldır». */}

      {reportsTab === 'genel' && (() => {
        // K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Bu kartın beş kutusu KALDIRILDI (orkestratör O25 +
        // ölçüm notu N2: her biri aynı ölçü × aynı kırılım × aynı pencere): son 30 günün sipariş adedi → GenelBloklar3.tsx P2
        // «Satış Momentum Skoru» sipariş adedi kutusu; ürün çeşidi / çalışan / teklif sayıları → GenelBloklar3.tsx P12 «İzlenen
        // SKU» / «Aktif Çalışan» / «Teklifler»; düşük stok sayısı → Genel Özet «Düşük Stok» KPI'sı. Kart işlemdeki sipariş kutusuyla kalır.
        // Kalan kutu durum sayar (tutar / tarih okumaz) → not satırı YOK; tanınmayan durum P8'in notunda.
        const kutular12 = [{ label: 'Active Orders', val: String(islemdeSiparis), icon: '⚙️', color: '#f59e0b' }];
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Modüller Arası Genel Bakış' : 'Cross-Module Overview'}</h3>
            <div className="grid grid-cols-1 gap-2">
              {kutular12.map(s=>(
                <div key={s.label} className="rounded-xl p-2 text-center" style={{background:`${s.color}10`}}>
                  <p className="text-sm">{s.icon}</p>
                  <p className="text-xl font-bold" style={{color:s.color}}>{s.val}</p>
                  <p className="text-[9px] text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar1.tsx P215 «Sipariş Adedi vs Ciro (12 Ay)» kalır; bu dosyadaki «Aylık Sipariş Hacmi» paneli KALDIRILDI.
          K14 aday tablosu satır 4. Orkestratör O25: aynı ölçü × aynı kırılım (sipariş adedi × ay), fark yalnız pencere
          uzunluğuydu (son 10 / son 12 takvim ayı; RaporlarPage P603 sipariş metriği 3 / 6 / 12 ay); aday olarak soruldu,
          kullanıcının cevabı «kaldır». */}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." + K-TAHMİN (PLAN-v2 §8 sıra 10 varsayılanı: TEK
          tahmin modeli — testli Phase 565 modeli). Bu dosyadaki büyüme ortalamasıyla 3 ay ileri ciro paneli KALDIRILDI (orkestratör
          O25: aynı ölçü × aynı kırılım × aynı pencere); ikinci bir tahmin modeli YAZILMADI. Kalanlar: GenelBloklar1.tsx P190 (3 ay) ve
          RaporlarPage P620 (1 / 3 / 6 ay ufuk) — ikisi de Muhasebe'nin testli tahminine bağlı. */}

      {reportsTab === 'genel' && (() => {
        const totalOrders=orders.length;
        const totalInventory=inventory.length;
        const totalEmployees=employees.length;
        const totalQuotations=quotations.length;
        return (
          <div className="apple-card p-4 mb-4 overflow-hidden relative">
            <div className="absolute inset-0 opacity-5" style={{background:'repeating-linear-gradient(45deg,#ff4000,#ff4000 10px,transparent 10px,transparent 20px)'}}/>
            <div className="relative">
              <div className="text-center mb-3">
                <p className="text-4xl mb-1">🏆</p>
                <h3 className="font-bold text-base text-brand">500 Analytics Phases</h3>
                <p className="text-xs text-gray-500">Complete ERP Intelligence Dashboard</p>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(
                  <div key={m.label} className="rounded-xl p-2 bg-white/60 text-center">
                    <p className="text-sm">{m.icon}</p>
                    <p className="text-xl font-bold text-brand">{m.val}</p>
                    <p className="text-[9px] text-gray-500">{m.label}</p>
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400">Covering General · CRM · Inventory · Logistics · HR</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Cetpa B2B Analytics Engine v2026</p>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
