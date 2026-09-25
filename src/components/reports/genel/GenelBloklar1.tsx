/**
 * GenelBloklar1.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 391–926).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * 6b bağlama (2026-09-24, Faz 3 6/n Genel I): sekiz panel testli yardımcılara BAĞLANDI (P166 zaten bağlıydı,
 * DOKUNULMADI; P197 utils-lojistik'in — DOKUNULMADI). Şartname: faz3-2n-specs/6n-kesif/6b/baglama-genel-bloklar1.md.
 * Uygulanan kullanıcı kararları (KARARLAR.md): K2 iptal hariç · K20/K28 sabitler adlandırıldı, değerler AYNEN ·
 * K21 "Tüm ciro" (P217 paydası) · K15 '∞' → 'borçsuz' (P216) UYGULANMADI — bkz. (4). K9 `× 0,6` uydurma maliyet
 * kalktı — K9'un KARARLAR.md'de kullanıcı CÜMLESİ YOK: PLAN-v2 §8 sıra 12 "Teyit (5/n emsali)" (hakem 2026-09-24
 * delta bulgu 7: K8'in "alış günü…" cümlesi K9'a mal edilmişti; `rapor6b.degismez.test.ts` §2 düzeltildi).
 * İKİ SÖZLEŞME (src/utils/para.ts): EKRAN toplamı `ekranTutari` (kısmi + not), TÜRETİLEN sayı `tamTutar`
 * (tek girdi bilinmiyorsa '—', çubuk/rozet çizilmez). Bilinmeyen sayaçları TOPLANMAZ (`<KapsamNotu>`).
 * Bilinçli farklar: (1) P190/P198/P215/P156 tarih kuralı `ciroTarihi` (= createdAt ?? syncedAt) — P166 hâlâ
 * `ayAnahtari(o.createdAt)` (açık soru A1, 6m); (2) rozet yüzdeleri `bicim.yuzdeYaz` ile '42%' (işaret SONDA;
 * eski `%42` — açık soru A5); (3) P217 anahtarı `sku ?? name` (eski `inventoryId || name` — A6);
 * (4) P216 "Kısa Vade Borç" bu panele BAĞLI DEĞİL → '—' (eski: `isPurchase`/`purchaseOrder` süzgeci; ÖLÜ YÜZEY —
 * 2026-09-24 hakem ölçümü: bu iki alanı bir sipariş belgesine YAZAN tek satır yok, satın alma siparişleri ayrı
 * `purchaseOrders` koleksiyonunda, `ctx.orders` yalnız `orders`'tan gelir → küme HER kiracıda boş → ₺0 borç + '∞'
 * (bağlamada 'borçsuz') basılıyordu. İzlenmeyen borç "sıfır borç" DEĞİL, BİLİNMİYOR'dur (K13-b) → KV/Net/Cari Oran
 * '—'. K15'in 'borçsuz' etiketi gerçek borç kaynağı (`finansalOranlar.cetpaBorc` ← `purchaseOrders` /
 * `cariBakiyeToplamlari.ap` ← Mikro) bağlandığında basılır; ikisi de bu dosyanın Props'unda yok — açık soru.
 *
 * Delta turu (hakem 2026-09-24, 16 bulgu — bu dosyaya düşenler):
 *  (5) P217 K-KALEM=A seçicisi (`tutarSec`: `total` biliniyorsa o, yoksa fiyat × adet) — UrunlerRapor ile AYNI
 *      tanım. Mikro faturası türevi kalem `price` TAŞIMAZ (eslemeFatura.ts SiparisSatiri {sku,name,quantity,total})
 *      → varsayılan yol onu "tutarı okunamadı" sayıp TÜM payları '—' yapıyor ve yanlış neden yazıyordu (bulgu 1/12).
 *      Pano `enCokSatanlar` paritesi (A6) KIRILDI, UrunlerRapor paritesi KURULDU — aynı sekmede tek 'ürün cirosu'.
 *      Kapanış turu (2026-09-24, bulgu 4/6): seçici `pano/stokSevkiyat.kalemTutari` (TEK tanım, testli; satır içi
 *      kopya KALKTI) + KDV-dâhil dipnotu `kdvDahilKalemVar` kapısıyla P217'de de basılır (UrunlerRapor ile aynı cümle).
 *
 * Kapanış turu (2026-09-24, 10 bulgu — bu dosyaya düşenler): (1) P197 `< 3` eşiği SAYIYA uygulanır (`TESLIM_ASGARI_OLCUM`;
 *  1-2 ölçümden ortalama/min/maks/dağılım basılmaz, neden notta); (2) P202 "N günün cirosu ölçülemedi" sayacı listede
 *  görünen ('—' satırı) ve listeye girmeyen günleri AYRI cümlelerle sayar (aynı gün "listede değil" denmez); (4/6) yukarıda.
 *  (6) P202 `tutarsiz` TÜM gün kovalarından (listeye girmeyen NaN günün siparişleri de sayılır; günler kesişmez →
 *      benzersiz, çift sayım yok) + "N günün cirosu ölçülemedi — listede değil" cümlesi (bulgu 2). Sıralama kısmi
 *      EKRAN toplamıyla KALIR (şartname :169 + `sayiSirala` sözleşmesi; madalya sırası belgeli görünür etki).
 *  (7) P197 Mikro türevi kayıt (`mikroTurevi`: sentetik `mikroOrders` + eslemeFatura türevi, ikisi de
 *      `source:'mikro-fatura'`, `status:'Delivered'`, `deliveredAt` YOK) teslim ölçümüne GİRMEZ ve "tarihi
 *      çözülemedi" diye SAYILMAZ — ayrı cümle ("N Mikro faturası…"); native ölçülebilir teslimat yoksa panel 6b
 *      öncesi gibi gizli (bulgu 14). K17 satırı: `estimatedDelivery`yi sipariş belgesine YAZAN kod YOK (ölçüm:
 *      types.ts ilanı + okuyucular; trackingService kargo SONUCUNA yazar; üretici 0) → `zamaninda`/`gec` bugün
 *      yapısal olarak hep 0; ölçülebilir teslimat HİÇ yokken 0/0/N/'—' yerine nedeni yazılır. Üretici alan/ekran
 *      (K13-a) OrdersPage'in — AÇIK SORU (bulgu 11).
 *  (8) P216 açık sorusu SOMUTLANDI (bulgu 13): `apPurchaseOrders` App.tsx'te ZATEN yüklü (`onSnapshot('purchaseOrders')`,
 *      Phase 110) ve `finansalOranlar.cetpaBorc` testli; eksik olan YALNIZ prop dizisi App.tsx → RaporlarPage →
 *      ReportsProps/useReportsData → ReportsCtx → GenelRapor → bu Props. Bağlanınca `ticariBorclar:` tek satır
 *      `tamTutar(cetpaBorc(purchaseOrders))` olur; K15 'borçsuz' dalı + rozet + KV/Net/Cari Oran canlanır. O güne
 *      dek rozet dalı hiçbir girdiyle çalışmaz (BİLEREK — ölü yüzeye burada onarım yazılmadı, hepsi başka grubun).
 */
import { useMemo } from 'react';
import { brutMarj, type ReportsCtx } from '../useReportsData';
import { olcekReferansi, cubukOrani, tutarSatiri, sayacOlcegi, seriCubukOrani } from '../../../utils/pano/cubuk';
import { paraYaz } from '../../../utils/currency';
import { ayAnahtari, zamanDate, tarihYaz } from '../../../utils/zaman';
import { oc } from '../../../i18n/ortak';
import { teslimSureleri } from '../../../utils/rapor/lojistik';
import { gunYaz, yuzdeYaz } from '../../../utils/rapor/bicim';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';
import { toplaBilinen, ekranTutari, tamTutar, sayiSirala, donemKarsilastir, type Tutar } from '../../../utils/para';
import { siparisTutari } from '../../../utils/siparis';
import { BOS_TUTAR, kovayaEkle, ortalamaSiparis } from '../../../utils/pano/raporVeriKatmani';
import { aylikCiro, ciroTarihi, ceyreklikCiro } from '../../../utils/pano/ciroDonem';
import { oranYuzde } from '../../../utils/siparisler/lojistikKpi';
import { degerToplami, urunSatislari, kalemTutari, kdvDahilKalemVar } from '../../../utils/pano/stokSevkiyat';
import { mikroTurevi } from '../../../utils/pano/mikroBirlesim';
import { kartMaliyetiTL } from '../../../utils/cost';
import { satisTahmini, tahminTutari } from '../../../utils/muhasebe/faturaTakipTahmin';
import { isletmeSermayesi } from '../../../utils/muhasebe/isletmeSermayesi';
import { kovayaYerlestir, type KovaSiniri } from '../../../utils/rapor/dagilim';
import { kumulatifPaylar } from '../../../utils/rapor/yogunlasma';
import { adetYaz } from '../../../utils/muhasebe/depoDeger';
import { rc } from '../../../i18n/rapor';

// ── P197 sabitleri (K20 kullanıcı: "ok kalsın" — değerler DEĞİŞMEZ, yalnız adlandırılır; utils-lojistik 6b) ──
// Eski satır 303: `days >= 0 && days < 365`. Sınır HARİÇ olduğu için değer AYNEN 365 kalır.
const TESLIM_UST_SINIR_GUN = 365;
// Eski satır `cycleTimes.length < 3 → return null` (HEAD 912d750): ortalama/en hızlı/en yavaş EN AZ 3 ölçülebilir
// teslimattan. Kapanış turu (2026-09-24, bulgu 1): eşik yalnız dış kapıda kalmış, 1-2 ölçümden sayı basılıyordu →
// artık SAYIYA uygulanır (aşağıda `yeterliOlcum197`). Değer AYNEN 3.
const TESLIM_ASGARI_OLCUM = 3;
// Eski satır 310-316: `max: 1 | 3 | 7 | 14 | Infinity` + `d <= max`. Tam sayı günde birebir aynı küme —
// `dagilim.KovaSiniri.ust` HARİÇ konvansiyonuyla [0,2) [2,4) [4,8) [8,15) [15,∞).
const TESLIM_SURESI_KOVA_USTLERI = [2, 4, 8, 15, Infinity] as const;

// ── 6b sabitleri — K20 kullanıcı 2026-09-19: "ok kalsın" (değerler DEĞİŞMEZ, yalnız adlandırılır);
//    K28 dönem tanımları parite + adlandırma. P197'nin TESLIM_* sabitleri utils-lojistik'indir (yukarıda). ──
/** P156 — karşılaştırılan çeyrek sayısı (eski `for (let i = 3; i >= 0; i--)`). */
const CEYREK_SAYISI = 4;
/** P190 — tahmin ufku (ay). `satisTahmini` varsayılanı da 3; AÇIKÇA geçilir. */
const TAHMIN_UFUK_AY = 3;
/** P198 — AOV penceresi (ay). */
const AOV_AY = 6;
/** P202 — "En Yüksek Ciro Günleri" penceresi (gün) ve gösterilen gün sayısı. */
const CIRO_GUNU_PENCERE_GUN = 90;
const CIRO_GUNU_SATIR = 6;
/** P203 — sipariş büyüklüğü kovaları; üst sınır HARİÇ (`dagilim.KovaSiniri.ust`), son kova `Infinity`. Eski `min/max` ile AYNI küme. */
const SIPARIS_BOYUT_KOVALARI: readonly KovaSiniri[] = [
  { etiket: '<₺5K', ust: 5000 },
  { etiket: '₺5-20K', ust: 20000 },
  { etiket: '₺20-50K', ust: 50000 },
  { etiket: '₺50K+', ust: Infinity },
];
/** P203 — marj renk eşikleri (yeşil / amber; altı kırmızı). P166 aynı eşikleri satır içi taşır (DOKUNMA). */
const MARJ_IYI = 30, MARJ_ORTA = 15;
/** P215 — adet vs ciro penceresi (ay) ve panel kapısı (dolu ay sayısı). */
const ADET_CIRO_AY = 12, ADET_CIRO_ASGARI_AY = 4;
/**
 * P216 — "Kısa Vade Borç" bu panele BAĞLI DEĞİL: NaN = BİLİNMİYOR (K13 kullanıcı 2026-09-19: "mikro yüzünden
 * verilemiyorsa N/A yaz"). Eski vekil (son 30 günün `isPurchase`/`purchaseOrder` siparişleri) ÖLÜ YÜZEYDİ —
 * alanları yazan kod yok, küme hep boş, "₺0 borç" uydurmaydı (dosya başı bilinçli fark 4). `isletmeSermayesi`
 * NaN'ı 'bilinmiyor' olarak işler: KV/net NaN → '—', `cariOran` null, rozet çizilmez; dönen taraf yine hesaplanır.
 * Gerçek kaynak bağlandığında YALNIZ bu girdi değişir (`finansalOranlar.cetpaBorc` / `cariBakiyeToplamlari.ap`).
 * Kaynak ZATEN YÜKLÜ (delta 2026-09-24, hakem bulgu 13): App.tsx `apPurchaseOrders` (`onSnapshot('purchaseOrders')`,
 * Phase 110) + PurchasingModule üreticisi canlı; eksik olan yalnız App.tsx → RaporlarPage → ReportsCtx → GenelRapor →
 * bu Props zinciri (hepsi başka grubun dosyası — 6b'de yapılamaz, AÇIK SORU). Bağlanana dek KV/Net/Cari Oran '—' ve
 * rozet dalı çalışmaz — bu, bilinmeyen borca "₺0 / Sağlıklı" basan eski hâlin dürüst karşılığıdır.
 */
const BORC_BAGLI_DEGIL = NaN;
/**
 * P216 — bu panelin TANIMINDA olmayan bilanço kalemi (kasa/banka, vergi-SGK, krediler). "Kasa bilinmiyor" DEĞİL,
 * "bu kartın kapsamında değil" demektir: kartın alt metni kapsamı ekranda yazar ('Stok + Alacak · kasa hariç').
 * Toplamda etkisiz eleman olduğu için `isletmeSermayesi` imzasına bu adla geçilir — çıplak `0` yazılmaz.
 */
const SERMAYE_KAPSAM_DISI = 0;
/** P217 — gösterilen ürün sayısı ve panel kapısı. */
const URUN_KARMA_N = 6, URUN_KARMA_ASGARI = 2;


type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function GenelBloklar1({ reportsTab, orders, inventory, exchangeRates, currentLanguage, fmtAna }: Props) {
  // `ArayuzDili` daraltması — `oc()` ile AYNI kural. (P197 kendi IIFE'sinde aynı adı yeniden kurar; o blok
  // utils-lojistik'indir, DOKUNULMAZ — gölgeleme zararsız.)
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  // Hook'lar bileşenin ÜST düzeyinde (koşullu IIFE içinde hook çağrılamaz).
  // Tarihi ÇÖZÜLEMEYEN (iptal olmayan) sipariş — P198/P215 notlarının ortak sayacı (`aylikCiro` KAPALI imza,
  // `tarihsiz` BİLDİRMEZ). P156 bunu KULLANMAZ: `ceyreklikCiro` kendi `tarihsiz` + `pencereDisi`ni döner.
  // `ciroTarihi` (createdAt ?? syncedAt) `aylikCiro`/`ceyreklikCiro`nun kullandığı KURALIN AYNISI — sayaç ile
  // kova aynı tanımı okumazsa "N sipariş" rakamı yalan olur. (P166 `ayAnahtari(o.createdAt)` ile kovalar: iki
  // tarih kuralı tek dosyada — açık soru A1, 6m'e devreder.)
  const tarihsizSiparis = useMemo(
    () => orders.filter(o => o.status !== 'Cancelled' && ciroTarihi(o) === null).length,
    [orders],
  );
  // K2 kullanıcı 2026-09-19: "İptaller ciroya girsin mi → hayır." → `iptalHaric: true` tek tanım.
  // Referans tarih memo içinde, AY ANAHTARI bağımlılıkta: `orders` değişmeden ay dönerse P198 "bu ay" ve P215 penceresi
  // önceki ayda kalıyordu, aynı ekranda P156/P190 (her render `new Date()`) yeni aya geçiyordu (inceleme 2026-09-25).
  const buAy = ayAnahtari(new Date());
  const aylar6 = useMemo(() => aylikCiro(orders, AOV_AY, new Date(), { iptalHaric: true }, dil), [orders, dil, buAy]);
  const aylar12 = useMemo(() => aylikCiro(orders, ADET_CIRO_AY, new Date(), { iptalHaric: true }, dil), [orders, dil, buAy]);
  // P217 gruplaması — `sku ?? name ?? title` (UrunlerRapor ile AYNI: `baslikYedegi: true`). Geçilmediğinde sku'su ve adı
  // olmayan Shopify kalemleri (webhook yalnız `title` yazar) TEK kovada toplanıp ilk kalemin başlığıyla basılıyordu:
  // üç ürünün cirosu bir ürün adıyla 1. sırada (inceleme 2026-09-25). Genel sekmesi ile Ürün Performansı artık uyuşur.
  // K-KALEM=A (delta 2026-09-24, hakem bulgu 1/12) — UrunlerRapor.tsx ile AYNI seçici: Mikro faturasından türeyen kalem
  // `price` TAŞIMAZ, tutarı `total`da (KDV dâhil; eslemeFatura.ts SiparisSatiri). Varsayılan `satirTutari(price, quantity)`
  // o kalemi "tutarı okunamadı" sayıyor, `kumulatifPaylar` paydası NaN → altı ürünün payı da '—' + YANLIŞ NEDEN notu
  // ("okunamadı" — tutar yazılı) + Mikro ürünü sıralamada SONA düşüyordu. Dayanak kullanıcı K3 (KARARLAR.md): "evet /
  // ana program zaten bu." Kapanış turu (bulgu 4/6): seçici `pano/stokSevkiyat.kalemTutari` (TEK tanım, ADDITIVE export,
  // testli) — satır içi kopya KALKTI; `total` KDV dâhil / native `price` hariç karışımı `kdvDahil217` kapılı dipnotla
  // P217'de de yazılır (UrunlerRapor ile aynı cümle). K2 iptal süzgeci ÇAĞIRANDA, iki yardımcıya AYNI liste gider.
  const iptalsiz217 = useMemo(() => orders.filter(o => o.status !== 'Cancelled'), [orders]);
  const urunler217 = useMemo(() => urunSatislari(iptalsiz217, { baslikYedegi: true, tutarSec: kalemTutari }), [iptalsiz217]);
  const kdvDahil217 = useMemo(() => kdvDahilKalemVar(iptalsiz217), [iptalsiz217]);
  return (
    <>

      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        const now166 = new Date();
        const months166 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now166.getFullYear(), now166.getMonth() - (5 - i), 1);
          const label = tarihYaz(d, { month: 'short' }, currentLanguage === 'tr' ? 'tr' : 'en');
          const ayKey = ayAnahtari(d);
          const mOrders = orders.filter(o => {
            if (o.status === 'Cancelled') return false;
            // Tarihi çözülemeyen sipariş (null) hiçbir aya girmez.
            return ayAnahtari(o.createdAt) === ayKey;
          });
          // Kalemi olmayan siparis (Mikro fatura turevi / sentetik) marj hesabina
          // GIRMEZ — aksi halde maliyet 0 sayilip marj %100'e sisiyordu (2026-09-04).
          const mm = brutMarj(mOrders, inventory, exchangeRates);
          // Üç AYRI sayaç — hiçbiri toplanmaz (2026-09-19 delta bulgusu):
          //  • `ciroBilinmeyen`  yalnız CİRO çubuğunun ölçeğini/oranını kapatır,
          //  • `maliyetBilinmeyen` yalnız maliyet/kâr BÖLMESİNİ kapatır (ölçeği DEĞİL),
          //  • `tutarsiz` karta basılacak BENZERSİZ sipariş sayısı (ikisinin toplamı değil —
          //    aynı sipariş iki sayaca da düşebilir, tek kayıt "2 kayıt" diye raporlanıyordu).
          return {
            label, rev: mm.ciro, cogs: mm.maliyet, margin: mm.marj, brutKar: mm.brutKar,
            kapsamDisi: mm.kapsamDisi, toplamCiro: mm.toplamCiro,
            ciroTutar: mm.ciroTutar,
            ciroBilinmeyen: mm.ciroTutar.bilinmeyen,
            maliyetBilinmeyen: mm.maliyetTutar.bilinmeyen,
            tutarsiz: mm.tutarsizSiparis,
          };
        });
        // Marji BILINMEYEN ay (kalem verisi yok) ortalamaya katilmaz; hicbiri
        // bilinmiyorsa ortalama da null'dur ('—' gosterilir, 0 degil).
        const marjliAylar = months166.filter(m => m.margin !== null);
        const avgMargin: number | null = marjliAylar.length > 0
          ? Math.round(marjliAylar.reduce((s, m) => s + (m.margin as number), 0) / marjliAylar.length)
          : null;
        const kapsamDisiToplam = months166.reduce((s, m) => s + m.kapsamDisi, 0);
        // Aylar kesişmez, bu yüzden BENZERSİZ aylık sayaçların toplamı da benzersizdir.
        const tutarsizToplam = months166.reduce((s, m) => s + m.tutarsiz, 0);
        const ciroTutarsizToplam = months166.reduce((s, m) => s + m.ciroBilinmeyen, 0);
        const maliyetTutarsizToplam = months166.reduce((s, m) => s + m.maliyetBilinmeyen, 0);
        // ÇUBUK ÖLÇEĞİ — src/utils/pano/cubuk.ts (testli, TEK kural; burada KOPYA YAZILMAZ).
        // Eski satır `Math.max(...months166.map(m => m.rev), 1)` idi: `m.rev` artık `ekranTutari`
        // ile geldiği ve hiç bilinen tutarı olmayan ayda NaN döndüğü için `Math.max` NaN'a
        // çakılıyor, `height: 'NaN%'` basılıyor ve TAM BİLİNEN diğer beş ayın çubukları da
        // kayboluyordu. Kural: tepe satır kısmiyse ölçek YOKTUR ve hiçbir çubuk çizilmez;
        // kısmi bir aya göre çizilen çubuk zaten alt satırları olduğundan uzun gösterirdi.
        //
        // KAPIYA YALNIZ CİRO BİLİNMEYENİ GİRER (2026-09-19 delta bulgusu): `cubuk.ts`in
        // `tutarsizSiparis` alanı "bu satırda TUTARI bilinmeyen kayıt sayısı" diye belgeli.
        // Maliyet bilinmeyenleri de buraya konunca, cirosu TAM bilinen tepe ayın tek bir
        // siparişinin maliyeti çözülemediğinde ölçek NaN oluyor ve ALTI ayın da ciro çubuğu
        // '—' görünüyordu — üstelik ekrana "tutar eksik" diye yanlış neden yazılıyordu.
        // Maliyet/kâr bölmesi zaten AYRI kapılı (`bolunebilir` → `Number.isFinite(brutKar)`).
        // Köprü elle kurulmaz: `tutarSatiri` (cubuk.ts, testli) `Tutar` → satır çevrimini yapar
        // ve yapısal olarak YALNIZ o `Tutar`ın kendi sayacını taşır — başka bir sayaç karışamaz.
        const cubukSatirlari166 = months166.map(m => tutarSatiri(m.ciroTutar));
        const olcek166 = olcekReferansi(cubukSatirlari166);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).aylik_brut_marj_trendi}</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avgMargin === null ? 'bg-gray-100 text-gray-500' : avgMargin >= 30 ? 'bg-emerald-100 text-emerald-700' : avgMargin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}
                title={kapsamDisiToplam > 0 ? (currentLanguage === 'tr' ? `${kapsamDisiToplam} sipariş kalem verisi olmadığı için marj hesabının DIŞINDA (cirosu grafikte, maliyeti bilinmiyor)` : `${kapsamDisiToplam} orders excluded from margin (no line items)`) : undefined}>
                {avgMargin === null ? 'Ø —' : `Ø %${avgMargin}`}
              </span>
            </div>
            <div className="flex items-end gap-3 h-28 mb-3">
              {months166.map((m, i) => {
                // Oran null → o ayın çubuğu ÇİZİLMEZ (ölçek yok, ya da ayın kendi CİROSU kısmi).
                // Maliyetin bilinmemesi çubuğu kaldırmaz, yalnız bölmeyi kaldırır (aşağıda gri).
                const oran166 = cubukOrani(cubukSatirlari166[i], olcek166);
                const revH = oran166 === null ? null : Math.round(oran166);
                // Maliyet/brüt kâr bölmesi yalnız İKİ taraf da tam bilinen ayda çizilir:
                // `brutKar` TÜRETME kapısından geçer (NaN = hesaplanamadı).
                const bolunebilir = revH !== null && revH > 0 && m.rev > 0 && Number.isFinite(m.brutKar);
                const cogsH = bolunebilir ? Math.round((m.cogs / m.rev) * revH) : 0;
                const gpH = bolunebilir ? Math.max(revH - cogsH, 0) : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group cursor-default">
                    <div className="w-full flex flex-col justify-end overflow-hidden rounded-t-md" style={{ height: '88px' }}>
                      {revH === null ? (
                        <div className="w-full h-full flex items-end justify-center pb-1 text-[10px] text-gray-300">—</div>
                      ) : (
                        <div className="w-full" style={{ height: `${revH}%` }}>
                          {bolunebilir ? (
                            <>
                              <div className="w-full bg-blue-100 rounded-t-md" style={{ height: `${cogsH > 0 ? (cogsH/revH)*100 : 0}%` }} />
                              <div className="w-full bg-emerald-400" style={{ height: `${gpH > 0 ? (gpH/revH)*100 : 0}%` }} />
                            </>
                          ) : (
                            // CİROSU bilinen ama maliyeti/kârı TÜRETİLEMEYEN ay: çubuk NÖTR gri
                            // çizilir. `bolunebilir` false iken cogsH = gpH = 0 olduğu için iki
                            // dilim de %0 yükseklikteydi ve çubuk görünmez kalıyordu — kullanıcı
                            // "o ay hiç satış yok" sanıyordu (2026-09-19 delta bulgusu).
                            <div className="w-full h-full bg-gray-200 rounded-t-md"
                              title={rc(currentLanguage).ciro_biliniyor_maliyet_cozulemedi_maliyet_kar_bo} />
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-gray-400">{m.label}</span>
                    <span className={`text-[9px] font-bold ${m.margin === null ? 'text-gray-400' : m.margin >= 30 ? 'text-emerald-600' : m.margin >= 15 ? 'text-amber-600' : 'text-red-500'}`}>{m.margin === null ? '—' : `%${m.margin}`}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block" />{oc(currentLanguage).brut_kar}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm inline-block" />{rc(currentLanguage).maliyet}</span>
            </div>
            {/* Marj/çubuk '—' iken NEDENİ yazılır. İKİ AYRI cümle (2026-09-19 delta bulgusu):
                tutar eksikliği ciro ÇUBUĞUNU, maliyet eksikliği yalnız maliyet/kâr BÖLMESİNİ
                kapatır — tek cümlede toplamak kullanıcıya yanlış neden gösteriyordu. Parantezdeki
                `tutarsizToplam` iki sayacın BENZERSİZ birleşimidir (kesişen kayıt bir kez sayılır). */}
            {ciroTutarsizToplam > 0 && (
              <p className="text-[10px] text-amber-600 mt-2">
                {currentLanguage === 'tr'
                  ? `${ciroTutarsizToplam} siparişin tutarı okunamadı — o aylarda ciro çubuğu gösterilmiyor.`
                  : `${ciroTutarsizToplam} order(s) with unknown amount — revenue bar hidden for those months.`}
              </p>
            )}
            {maliyetTutarsizToplam > 0 && (
              <p className="text-[10px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? `${maliyetTutarsizToplam} siparişin maliyeti çözülemedi — o aylarda marj ve maliyet/kâr bölmesi yok (çubuk gri).`
                  : `${maliyetTutarsizToplam} order(s) with unresolved cost — margin and cost/profit split hidden (grey bar).`}
              </p>
            )}
            {tutarsizToplam > 0 && ciroTutarsizToplam > 0 && maliyetTutarsizToplam > 0 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {currentLanguage === 'tr'
                  ? `Toplam ${tutarsizToplam} farklı sipariş etkileniyor.`
                  : `${tutarsizToplam} distinct order(s) affected in total.`}
              </p>
            )}
            {/* Tepe ayın TUTARI kısmiyse HİÇBİR çubuk çizilemez (ölçek yok) — kullanıcı boş
                grafiği "veri yok" sanmasın, nedeni yazılır. Kapı artık yalnız ciro bilinmeyenine
                bakıyor, metin de o nedene birebir karşılık geliyor. */}
            {!Number.isFinite(olcek166) && ciroTutarsizToplam > 0 && (
              <p className="text-[10px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? 'En yüksek cirolu ayın tutarı eksik olduğu için çubuk ölçeği kurulamıyor — kısmi bir tepeye göre çizilen çubuklar yanıltıcı olurdu.'
                  : 'The highest-revenue month has unknown amounts, so no bar scale can be established.'}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P156 · Çeyrek Bazlı Karşılaştırma — kovalama `pano/ciroDonem.ceyreklikCiro` (6b). K28: takvim çeyreği,
        // pencere CEYREK_SAYISI AYNEN. K2 kullanıcı 2026-09-19: "hayır" → iptal hariç. `useMemo` YOK: koşullu IIFE.
        const now156 = new Date();
        const c156 = ceyreklikCiro(orders, CEYREK_SAYISI, now156, { iptalHaric: true });
        // PARA ölçeği: tepe çeyrek kısmiyse ölçek YOK (P166 kuralı). `ciroDonem.olcekTavani` KULLANILMAZ —
        // `, 1` tabanını korur ve kısmi tepeyi ölçek yapar.
        const cubuklar156 = c156.satirlar.map(s => tutarSatiri(s.tutar));
        const olcek156 = olcekReferansi(cubuklar156);
        // QoQ = son iki satır (uzunluk = CEYREK_SAYISI ≥ 2, BOŞ çeyrekler dâhil). TÜRETME: iki çeyrekten birinde
        // tek bilinmeyen varsa ya da önceki çeyrek ≤ 0 ise `yuzde` null → rozet ÇİZİLMEZ (0'a bölme yok).
        const n156 = c156.satirlar.length;
        const qoq = donemKarsilastir(c156.satirlar[n156 - 1].tutar, c156.satirlar[n156 - 2].tutar);
        // Çeyrekler kesişmez → `tutarsiz` toplamı benzersizdir. `tarihsiz` ∩ `pencereDisi` = ∅ (pencere dışı sayılmak
        // için tarihin çözülmüş olması gerekir) ve ikisi `tutarsiz`dan ayrı sayaçtır (`kapsamNotu` TOPLAMAZ).
        const tutarsiz156 = c156.satirlar.reduce((s, q) => s + q.tutar.bilinmeyen, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).ceyrek_bazli_karsilastirma}</h3>
              {qoq.yuzde !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${qoq.yon === 'artis' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {qoq.yon === 'artis' ? '↑' : '↓'} {yuzdeYaz(Math.abs(qoq.yuzde), 0, dil)} QoQ
                </span>
              )}
            </div>
            <div className="flex items-end gap-4 h-36 mb-3">
              {c156.satirlar.map((s, i) => {
                const isLatest = i === n156 - 1;
                return (
                  <div key={s.anahtar} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{fmtAna(s.ekran,'K',0)}</span>
                    <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                      {/* Gerçek ₺0 çeyrek → oran 0 → çubuk ÇİZİLMEZ (eski `Math.max(h, 3)` hayalet tabanı kalktı);
                          hiç bilineni olmayan çeyrek → null → taralı "bilinmiyor". */}
                      <OlcekCubugu
                        yon="dikey"
                        oran={cubukOrani(cubuklar156[i], olcek156)}
                        renkSinifi={isLatest ? 'bg-brand' : 'bg-brand/30'}
                        koseSinifi="rounded-t-xl"
                        dil={currentLanguage}
                        title={`${s.etiket}: ${fmtAna(s.ekran,'K',0)}`}
                      />
                    </div>
                    <span className={`text-[10px] font-bold ${isLatest ? 'text-brand' : 'text-gray-400'}`}>{s.etiket}</span>
                    <span className="text-[9px] text-gray-400">{s.adet} {rc(currentLanguage).sip}</span>
                  </div>
                );
              })}
            </div>
            {/* `tarihsiz` ve `pencereDisi` YARDIMCININ sayaçları (üst düzey `tarihsizSiparis` DEĞİL — tek kaynak).
                Pencere dışı (5+ çeyrek önceki) sipariş ilk kez ekranda; bugün `find` ile sessizce düşüyordu. */}
            <KapsamNotu
              sayaclar={{ tutarsiz: tutarsiz156, tarihsiz: c156.tarihsiz, kapsamDisi: c156.pencereDisi }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).ceyrek_cirosuna_dahil_degil}
            />
            {!Number.isFinite(olcek156) && tutarsiz156 > 0 && (
              <p className="text-[10px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? 'En yüksek cirolu çeyreğin tutarı eksik olduğu için çubuk ölçeği kurulamıyor — kısmi bir tepeye göre çizilen çubuklar yanıltıcı olurdu.'
                  : 'The highest-revenue quarter has unknown amounts, so no bar scale can be established.'}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        // P190 · Gelir Tahmini (3 Ay) — model `muhasebe/faturaTakipTahmin.satisTahmini` (K-TAHMİN, PLAN-v2 §8 sıra 10:
        // testli TEK model — WMA + eğim·k, `Math.max(0, …)` kırpması İÇERİDE). Eski satır içi en küçük kareler
        // (ölü payda koruması dâhil) SİLİNDİ; yeni model YAZILMADI. İptal süzgeci (K2) ve ay kovalaması
        // fonksiyonun içinde; tutar `siparisTutari` (`totalPrice ?? totalAmount`).
        const t190 = satisTahmini(orders, new Date(), { ufuk: TAHMIN_UFUK_AY, tutarSec: siparisTutari });
        // TÜRETME kapısı: tahmin BAŞKA sayılardan üretilen bir sayıdır — pencerede tek sipariş bile tutarsızsa
        // `wma`/`egim` eksik ciroyla kurulur, tahmin ÜRETİLMEZ ('—', çubuk çizilmez). `tahminTutari` EKRAN
        // sözleşmesidir ve bu kapıdan SONRA gelir. `alt`/`ust` bandı bu panelde KULLANILMAZ (bugün band yok — parite).
        const tahminUretilebilir = t190.bilinmeyen === 0;
        // PARA ölçeği: geçmiş aylar (`TahminAyi extends Tutar` → `tutarSatiri`ye doğrudan) + üretilebiliyorsa tahmin
        // noktaları, TEK ölçek. Tahmin noktası da köprüden geçer (elle `CubukSatiri` kurulmaz).
        const gecmisCubuklari190 = t190.gecmis.map(a => tutarSatiri(a));
        const tahminCubuklari190 = tahminUretilebilir
          ? t190.tahmin.map(p => tutarSatiri({ toplam: p.deger, bilinen: 1, bilinmeyen: 0 }))
          : [];
        const olcek190 = olcekReferansi([...gecmisCubuklari190, ...tahminCubuklari190]);
        const tahminler190 = t190.tahmin.map(p => ({
          anahtar: p.anahtar,
          etiket: tarihYaz(p.ay, { month: 'short', year: '2-digit' }, dil),
          deger: p.deger,
        }));
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).gelir_tahmini_3_ay}</h3>
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{rc(currentLanguage).agirlikli_trend}</span>
            </div>
            <div className="flex items-end gap-1.5 h-28 mb-3">
              {t190.gecmis.map((a, i) => (
                <div key={a.anahtar} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    {/* Eski `Math.max(4, …)` hayalet tabanı kalktı: gerçek ₺0 ay boş, tutarsız ay taralı. */}
                    <OlcekCubugu
                      yon="dikey"
                      oran={cubukOrani(gecmisCubuklari190[i], olcek190)}
                      renkSinifi="bg-blue-300"
                      koseSinifi="rounded-t-md"
                      dil={currentLanguage}
                      title={`${tarihYaz(a.ay, { month: 'short', year: '2-digit' }, dil)}: ${fmtAna(ekranTutari(a),'K',0)}`}
                    />
                  </div>
                </div>
              ))}
              {tahminler190.map((f, i) => (
                <div key={f.anahtar} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    {tahminUretilebilir ? (
                      <OlcekCubugu
                        yon="dikey"
                        oran={cubukOrani(tahminCubuklari190[i], olcek190)}
                        renkSinifi="bg-emerald-300 border-2 border-dashed border-emerald-500"
                        koseSinifi="rounded-t-md"
                        dil={currentLanguage}
                        title={`${f.etiket}: ${fmtAna(tahminTutari(t190, f.deger),'K',0)}`}
                      />
                    ) : (
                      // Tahmin ÜRETİLEMEDİ (türetme kapısı): çubuk çizilmez, nedeni alttaki satırda.
                      <span className="text-[10px] text-gray-300 pb-1">—</span>
                    )}
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold leading-none">{f.etiket}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {tahminler190.map(f => (
                <div key={f.anahtar} className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs font-bold text-emerald-700">{f.etiket}</p>
                  {/* Kapı kapalıysa NaN → `fmtAna` '—' basar (kırılmaz). */}
                  <p className="text-lg font-black text-emerald-700">{fmtAna(tahminUretilebilir ? tahminTutari(t190, f.deger) : NaN,'K',0)}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{rc(currentLanguage).tahmini_degerler_son_6_ayin_agirlikli_ortalamasi}</p>
            {!tahminUretilebilir && (
              <p className="text-[10px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? `Son 6 ayın ${t190.bilinmeyen} siparişinin tutarı okunamadı — tahmin eksik ciroyla üretilmez.`
                  : `${t190.bilinmeyen} order(s) in the last 6 months have an unreadable amount — no forecast is produced from partial revenue.`}
              </p>
            )}
            <KapsamNotu
              sayaclar={{ tutarsiz: t190.bilinmeyen, tarihsiz: t190.tarihsiz }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).tahmine_dahil_degil}
            />
            {/* PLAN-v2 §8 K-TAHMİN: "Negatif → mevcut kırpma + not". */}
            {tahminUretilebilir && t190.egim < 0 && t190.tahmin.some(p => p.deger === 0) && (
              <p className="text-[10px] text-gray-400 mt-1">
                {rc(currentLanguage).dusen_trend_tahmin_sifirda_kirpildi}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.filter(o => o.status === 'Delivered').length >= TESLIM_ASGARI_OLCUM && (() => {
        // P197 · Ortalama Sipariş Teslim Süresi — hesap `rapor/lojistik.teslimSureleri` (6b, K17).
        // K17 kullanıcı 2026-09-19: "Önerin ok. Siparişin kendi teslim tarihini baz al. 2. soru kabul."
        // → gerçekleşen teslim YALNIZ `deliveredAt` (eski `updatedAt` yedeği KALKTI — B1); tarih kapısı
        // yardımcıya geçti, düşen kayıt artık SAYILIYOR (alttaki KapsamNotu — B3). Durum süzgeci ÇAĞIRANDA.
        // Delta 2026-09-24 (hakem bulgu 14): Mikro faturasından türeyen kayıt (RaporlarPage sentetik `mikroOrders` ve
        // eslemeFatura türevi — ikisi de `source:'mikro-fatura'`, `status:'Delivered'`, `deliveredAt` YOK) teslim
        // ölçümüne GİRMEZ: teslim tarihi "çözülemedi" DEĞİL, kavram olarak YOK. Küme `mikroTurevi` (tek kural,
        // `odemeTakipli`nin tersi — `source === 'mikro-fatura'` kopyası YAZILMADI) ile ayrılır ve AYRI cümleyle sayılır;
        // eski hâli 300 Mikro faturasını "300 siparişin tarihi çözülemedi" diye bozuk tarihli sipariş gibi anlatıyordu.
        // Ölçülebilir native teslimat yoksa iç kapı paneli 6b öncesi gibi gizler (dış kapı AYNEN: parite).
        const dil = currentLanguage === 'tr' ? 'tr' : 'en';
        const teslimEdilenTumu197 = orders.filter(o => o.status === 'Delivered');
        const teslimEdilen197 = teslimEdilenTumu197.filter(o => !mikroTurevi(o));
        const mikroFaturasi197 = teslimEdilenTumu197.length - teslimEdilen197.length;
        // Kova etiketleri dile bağlı → burada kurulur (VERİ, bileşen değil). Üstler HARİÇ
        // (`dagilim.KovaSiniri.ust`): eski `max: 1|3|7|14|∞` + `d <= max` ile tam sayı günde AYNI küme.
        const ETIKET_197 = [rc(currentLanguage)._1_gun, '2-3', '4-7', '8-14', '15+'];
        const kovalar197 = TESLIM_SURESI_KOVA_USTLERI.map((ust, i) => ({ etiket: ETIKET_197[i], ust }));
        // `useMemo` YOK: koşullu IIFE içinde hook çağrılamaz; hesap tek geçiş O(n).
        const t197 = teslimSureleri(teslimEdilen197, {
          ustSinir: { deger: TESLIM_UST_SINIR_GUN, birim: 'gun' },
          kovalar: kovalar197,
        });
        // Eşik AYNI (3, `TESLIM_ASGARI_OLCUM`). Kapanış turu (2026-09-24, bulgu 1): eşik yalnız KAPIDA duruyordu ve kapının
        // üçüncü terimi (`olculemedi === 0`) `estimatedDelivery` üreticisi olmadığı için her native teslimatta yanlış →
        // 1 native teslimattan 'Ortalama 4 gün · En hızlı 4 · En yavaş 4' + tek çubuk basılıyordu (HEAD `cycleTimes.length
        // < 3 → null` gizliyordu; yorum '—' basar diyor, kod sayı basıyordu). Artık eşik SAYIYA uygulanır: `olculen < 3`
        // iken ortalama/en hızlı/en yavaş '—' ve dağılım çubukları ÇİZİLMEZ (türetilen sayı — 6b tamTutar kuralı:
        // yetersiz örneklem = bilinmiyor, 0 ya da tek kayıt değil), neden alttaki notta; sayaçlar ekranda KALIR (K17).
        // Panel yalnız hiçbir şey anlatmayacaksa gizlenir: yetersiz ölçüm + ölçülemeyen/ölçülemedi 0 (6a P148 emsali).
        const yeterliOlcum197 = t197.ortalamaGun.olculen >= TESLIM_ASGARI_OLCUM;
        if (!yeterliOlcum197 && t197.ortalamaGun.olculemeyen === 0 && t197.olculemedi === 0) return null;
        const olcek197 = sayacOlcegi(t197.dagitim.kovalar.map(k => k.adet));
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).ortalama_siparis_teslim_suresi}</h3>
              {/* null-guard + yuvarlama (eski :306 `Math.round`) + birim `gunYaz`ın İÇİNDE — üç kez satır içi yazılmaz. */}
              <span className="text-2xl font-black text-blue-600">{gunYaz(yeterliOlcum197 ? t197.ortalamaGun.deger : null, 0, dil)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-emerald-600">{gunYaz(yeterliOlcum197 ? t197.enHizliGun : null, 0, dil)}</p>
                <p className="text-[10px] text-gray-500">{oc(currentLanguage).en_hizli}</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-500">{gunYaz(yeterliOlcum197 ? t197.enYavasGun : null, 0, dil)}</p>
                <p className="text-[10px] text-gray-500">{oc(currentLanguage).en_yavas}</p>
              </div>
            </div>
            {/* K17 satırı (YENİ — B5): zamanında / geç / ölçülemedi. `olculemedi` ile alttaki notun `tarihsiz`i
                AYNI siparişi sayabilir → iki sayaç AYRI cümlelerde, TOPLANMAZ. Oran bilinmiyorsa '—' (`yuzdeYaz`);
                eşik/renk rozeti YOK — uydurma eşik yazılmaz (K20). */}
            {/* Delta 2026-09-24 (hakem bulgu 11 — ÖLÜ DAL): `estimatedDelivery`yi sipariş belgesine YAZAN kod YOK
                (types.ts ilanı; OrdersPage/LojistikRapor/RaporlarPage OKUR; trackingService kargo sorgu SONUCUNA yazar,
                `orders`a değil) → `zamaninda`/`gec` bugün her kiracıda yapısal olarak 0, oran '—'. "0 · 0 · 50 · —"
                satırı kullanıcıya "50 siparişin tahmini tarihi bozuk" der; ölçülebilir teslimat HİÇ yokken satır
                yerine NEDEN yazılır (K17 "sayısı ekranda" korunur). Üretici alan/ekran (K13-a) OrdersPage'in — açık soru;
                bağlanınca bu dal kendiliğinden ölçülen satıra döner. Cümle OrdersPage P576 ("tahmini ya da gerçek teslim
                tarihi eksik") ile aynı tanımı anlatır: `olculemedi` iki alandan birini de kapsar. */}
            {t197.zamaninda + t197.gec === 0 ? (
              <p className="text-[11px] text-gray-500 mb-3">
                {currentLanguage === 'tr'
                  ? `Zamanında/geç oranı ölçülemedi — ${t197.olculemedi} siparişte tahmini ya da gerçek teslim tarihi yok`
                  : `On-time/late rate not measurable — ${t197.olculemedi} orders have no estimated or actual delivery date`}
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 mb-3">
                {rc(currentLanguage).zamaninda} {t197.zamaninda} · {rc(currentLanguage).gec} {t197.gec} · {rc(currentLanguage).olculemedi} {t197.olculemedi} · {yuzdeYaz(t197.zamanindaOrani, 0, dil)}
              </p>
            )}
            {/* Dağılım da eşiğin ARKASINDA: 1-2 ölçümden tek çubuklu "dağılım" çizilmez (bulgu 1). */}
            {yeterliOlcum197 ? (
              <div className="flex items-end gap-2 h-16">
                {t197.dagitim.kovalar.map(k => (
                  <div key={k.etiket} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '44px' }}>
                      {/* Boş kova = boş: eski sabit 4 px hayalet çubuk tabanı kalktı (B4). Ölçek `sayacOlcegi`, oran `seriCubukOrani`. */}
                      <OlcekCubugu
                        yon="dikey"
                        oran={seriCubukOrani(k.adet, olcek197)}
                        renkSinifi="bg-blue-300"
                        koseSinifi="rounded-t-md"
                        dil={currentLanguage}
                        title={`${k.etiket}: ${k.adet}`}
                      />
                    </div>
                    <span className="text-[9px] text-gray-400 leading-none">{k.etiket}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-amber-600">
                {currentLanguage === 'tr'
                  ? `${t197.ortalamaGun.olculen} ölçülebilir teslimat — ortalama, en hızlı/en yavaş ve dağılım en az ${TESLIM_ASGARI_OLCUM} teslimattan hesaplanır`
                  : `${t197.ortalamaGun.olculen} measurable deliveries — average, fastest/slowest and distribution need at least ${TESLIM_ASGARI_OLCUM}`}
              </p>
            )}
            {/* `olculemedi` BURAYA KONMAZ (aynı siparişi ikinci kez sayardı; üstteki satırda zaten görünür). */}
            <KapsamNotu
              sayaclar={{ tarihsiz: t197.tarihsiz, kapsamDisi: t197.kapsamDisi }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).ortalamaya_dahil_degil}
            />
            {/* Mikro türevi AYRI cümle: `kapsamNotu`nun sayaçları nedeni ("tarihi çözülemedi" / "kapsam dışında")
                yanlış anlatırdı — bu kayıtlarda teslim tarihi kavramı yok. Kümeler ayrık (yukarıda süzüldü) → çift sayım yok. */}
            {mikroFaturasi197 > 0 && (
              <p className="text-[11px] text-gray-400 mt-1">
                {currentLanguage === 'tr'
                  ? `${mikroFaturasi197} Mikro faturası teslim ölçümüne girmez (faturada teslim tarihi yok)`
                  : `${mikroFaturasi197} Mikro invoices are not part of the delivery measurement (invoices carry no delivery date)`}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        // P198 · Ortalama Sipariş Değeri Trendi — aylar üst düzey `aylar6` (`aylikCiro`; K2 iptal hariç; K28: 6 ay AYNEN).
        // AOV TÜRETME (`tamTutar`): ayın tek siparişi bile tutarsızsa NaN; sipariş yoksa NaN ("₺0 ortalama" UYDURULMAZ).
        // `Math.round` PARİTE (eski `:478` ay AOV'sini TAM SAYIYA yuvarlıyor, MoM/K-etiketi/ölçek o değerden kuruluyordu;
        // 1.004,5 → 1.005 → MoM %1 — yuvarlamasız %0 olurdu). NaN yuvarlanınca NaN kalır, bilinmeyen 0 olmaz.
        const aovlar = aylar6.map(m => Math.round(ortalamaSiparis(m.tutar, m.adet)));
        // Kapı: en az bir ayın AOV'si hesaplanabiliyor mu. Eski `some(m => m.aov > 0)` NaN'larda hep false dönüp
        // kartı KOMPLE kaybettiriyordu.
        if (!aovlar.some(a => Number.isFinite(a))) return null;
        // TÜRETİLMİŞ düz sayı ölçeği: `sayacOlcegi` sonlu olmayanı YOK SAYAR (tek NaN bütün çubukları söndüren
        // `Math.max(…, 1)` arızası kalktı).
        const olcek198 = sayacOlcegi(aovlar);
        const n198 = aovlar.length;
        // MoM: iki taraftan biri bilinmiyorsa ya da payda ≤ 0 ise null → rozet ÇİZİLMEZ.
        const aovDegisim = oranYuzde(aovlar[n198 - 1] - aovlar[n198 - 2], aovlar[n198 - 2]);
        // Aylar kesişmez → benzersiz.
        const tutarsiz198 = aylar6.reduce((s, m) => s + m.tutar.bilinmeyen, 0);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).ortalama_siparis_degeri_trendi}</h3>
              {aovDegisim !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${aovDegisim >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {aovDegisim >= 0 ? '↑' : '↓'} {yuzdeYaz(Math.abs(Math.round(aovDegisim)), 0, dil)} MoM
                </span>
              )}
            </div>
            <div className="flex items-end gap-3 h-24 mb-3">
              {aylar6.map((m, i) => {
                const isLatest = i === n198 - 1;
                const aov = aovlar[i];
                return (
                  <div key={m.anahtar} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: '72px' }}>
                      {Number.isFinite(aov) && <span className={`text-[9px] font-bold ${isLatest ? 'text-brand' : 'text-gray-500'}`}>{fmtAna(aov,'K',1)}</span>}
                      <div className="w-full flex items-end mt-auto" style={{ height: '52px' }}>
                        {/* İKİ AYRI durum: siparişi OLMAYAN ay gerçek boş → çubuk yok (0); siparişi olup tutarı
                            okunamayan ay BİLİNMİYOR → `seriCubukOrani` null → taralı çubuk. */}
                        <OlcekCubugu
                          yon="dikey"
                          oran={m.adet === 0 ? 0 : seriCubukOrani(aov, olcek198)}
                          renkSinifi={isLatest ? 'bg-brand' : 'bg-gray-200'}
                          koseSinifi="rounded-t-md"
                          dil={currentLanguage}
                        />
                      </div>
                    </div>
                    <span className={`text-[9px] ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{m.etiket}</span>
                  </div>
                );
              })}
            </div>
            {/* `paraYaz` NaN'ı '—' basar: "Bu ay: — ortalama sipariş değeri · 7 sipariş" — kabul (şartname). */}
            <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? `Bu ay: ${paraYaz(aovlar[n198 - 1], { ondalik: 0 })} ortalama sipariş değeri · ${aylar6[n198 - 1].adet} sipariş` : `This month: ${paraYaz(aovlar[n198 - 1], { ondalik: 0 })} AOV · ${aylar6[n198 - 1].adet} orders`}</p>
            <KapsamNotu
              sayaclar={{ tutarsiz: tutarsiz198, tarihsiz: tarihsizSiparis }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).aov_hesabina_dahil_degil}
            />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // P202 · En Yüksek Ciro Günleri — gün kovası `Tutar` (`raporVeriKatmani.kovayaEkle`; `?? BOS_TUTAR` MEŞRU kova
        // tohumudur, sayısal varsayılan değil; `Map` `Record`'un prototip anahtarı riskini de kapatır). K2 iptal hariç;
        // K28: 90 gün panelin TANIMIDIR, sayaç değil (pencere dışı kalan sipariş kapsam dışı sayılmaz — bilerek).
        // Tarih kuralı `zamanDate(o.createdAt)` AYNEN (parite; A1).
        const now202 = new Date();
        const cutoff202 = new Date(now202); cutoff202.setDate(cutoff202.getDate() - CIRO_GUNU_PENCERE_GUN);
        const gunKovalari = new Map<string, Tutar>();
        let tarihsiz202 = 0;
        for (const o of orders) {
          if (o.status === 'Cancelled') continue;
          const od = zamanDate(o.createdAt);
          if (!od) { tarihsiz202++; continue; }
          if (od < cutoff202) continue;
          const key = tarihYaz(od, { day: '2-digit', month: 'short' }, dil);
          gunKovalari.set(key, kovayaEkle(gunKovalari.get(key) ?? BOS_TUTAR, siparisTutari(o)));
        }
        // Sıralama `para.sayiSirala` (EKRAN toplamı; bilinmeyen HER İKİ yönde SONDA); `sort` kararlı → eşitlikte giriş sırası.
        const enIyiGunler = [...gunKovalari]
          .sort(([, a], [, b]) => sayiSirala(ekranTutari(a), ekranTutari(b), true))
          .slice(0, CIRO_GUNU_SATIR);
        // Kapı AYNEN (`< 3`): en az üç gün — `CIRO_GUNU_SATIR` (gösterilen 6) ile karıştırma.
        if (enIyiGunler.length < 3) return null;
        // PARA ölçeği GÖSTERİLEN listeye göre, döngü DIŞINDA bir kez (`enCokSatanlar` emsali). Tepe gün kısmiyse
        // ölçek yok → çubuklar çizilmez; eski korumasız `rev / maxRev` (`width: 'NaN%'`) kalktı.
        const olcek202 = olcekReferansi(enIyiGunler.map(([, t]) => tutarSatiri(t)));
        // `tutarsiz` TÜM gün kovalarından (delta 2026-09-24, hakem bulgu 2): şartname :175 "yalnız gösterilen altı gün"
        // demişti; ama hiç bilineni olmayan gün (ekranTutari NaN) `sayiSirala` ile SONA düşüp `slice` ile listeden
        // çıkınca o günün siparişleri HİÇBİR sayaçta görünmüyordu (10 Eyl'ün 4 tutarsız siparişi: not "2" diyordu,
        // gerçek 6). Günler kesişmez → pencere içindeki her sipariş tam bir kovada → benzersiz, çift sayım yok.
        // Pencere DIŞI sipariş yine sayılmaz (K28: 90 gün panelin tanımı). P217 `p217.toplam.bilinmeyen` ile aynı
        // kural: sayaç KESİLMEMİŞ kümeden, kesim sonra.
        const tutarsiz202 = [...gunKovalari.values()].reduce((s, t) => s + t.bilinmeyen, 0);
        // Cirosu HİÇ ölçülemeyen (bilinen 0, bilinmeyen > 0) gün: `sayiSirala` NaN'ı sona atar ama bilinen cirolu gün
        // `CIRO_GUNU_SATIR`dan AZSA NaN gün LİSTEYE GİRER ('—' hücresi, taralı çubuk, '#N' sırası). Kapanış turu
        // (2026-09-24, bulgu 2): eski tek sayaç TÜM NaN günleri "listede yer almıyor" diye anlatıyordu → aynı gün hem
        // listede hem "listede değil" (yanlış neden = yanlış bilgi). İKİ AYRIK küme (listede / dışında), iki ayrı cümle;
        // kesişmez, TOPLANMAZ. Birim GÜN (`kapsamNotu`da yok → elle). Siparişleri yukarıdaki `tutarsiz202` sayacında.
        const listelenenGun202 = new Set(enIyiGunler.map(([gun]) => gun));
        const olculemeyenGunler202 = [...gunKovalari].filter(([, t]) => !Number.isFinite(ekranTutari(t)));
        const listedeOlculemeyenGun202 = olculemeyenGunler202.filter(([gun]) => listelenenGun202.has(gun)).length;
        const disaridaOlculemeyenGun202 = olculemeyenGunler202.length - listedeOlculemeyenGun202;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{rc(currentLanguage).en_yuksek_ciro_gunleri_son_90_gun}</h3>
            <div className="space-y-2">
              {enIyiGunler.map(([day, t], i) => (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-sm">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                  <span className="text-xs font-medium text-gray-700 w-16 shrink-0">{day}</span>
                  <div className="flex-1">
                    {/* Ray kabı bileşenin İÇİNDE (`yon="yatay"` varsayılanı). */}
                    <OlcekCubugu oran={cubukOrani(tutarSatiri(t), olcek202)} renkSinifi="bg-brand" kalinlik="h-2" dil={currentLanguage} />
                  </div>
                  <span className="text-xs font-bold text-gray-700 w-16 text-right shrink-0">{fmtAna(ekranTutari(t),'K',1)}</span>
                </div>
              ))}
            </div>
            <KapsamNotu
              sayaclar={{ tutarsiz: tutarsiz202, tarihsiz: tarihsiz202 }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).gun_toplamina_dahil_degil}
            />
            {listedeOlculemeyenGun202 > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? `Listedeki ${listedeOlculemeyenGun202} günün cirosu ölçülemedi (hiçbir siparişinin tutarı okunamadı) — '—' ile görünür, sırası ciroya göre değil`
                  : `${listedeOlculemeyenGun202} listed days have no measurable revenue (no order amount readable) — shown as '—', not ranked by revenue`}
              </p>
            )}
            {disaridaOlculemeyenGun202 > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? `${disaridaOlculemeyenGun202} günün cirosu ölçülemedi (hiçbir siparişinin tutarı okunamadı) — listede yer almıyor`
                  : `${disaridaOlculemeyenGun202} days have no measurable revenue (no order amount readable) — not listed`}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // P203 · Sipariş Büyüklüğüne Göre Brüt Marj — kovalama `rapor/dagilim.kovayaYerlestir` (SIPARIS_BOYUT_KOVALARI,
        // K20 değerler AYNEN), marj `brutMarj` (`useReportsData` → `raporMarj.brutMarjHesabi`, testli — P166 ile AYNI
        // kaynak). K2 kullanıcı 2026-09-19: "hayır" → iptal hariç.
        // K9 (PLAN-v2 §8 sıra 12, 5/n emsali): "`× 0,6` uydurma maliyet kalkıyor" — eski
        // `inv ? <eski maliyet fonksiyonu>(inv, exchangeRates) : li.price × 0,6` satırı SİLİNDİ. `brutMarj` maliyeti
        // `stokMaliyetCozucu(inventory, i => kartMaliyetiTL(i, exchangeRates))` ile çözer: kart eşleşmezse ya da kartın
        // maliyeti girilmemişse `null` (bilinmiyor; eski maliyet fonksiyonunun 0 dönüşü DEĞİL) → o kovanın marjı '—' (nötr gri),
        // %100'e şişmez. Boş-anahtar eşleşmesi (`ii.id === li.inventoryId || ii.name === li.name`) da `stokKartiCozucu`
        // ile kapandı. Tutarı okunamayan sipariş artık '<₺5K' kovasına DÜŞMEZ (`d203.bilinmeyen`); negatif tutarlı
        // (iade) sipariş `d203.kapsamDisi` (bugün sessizce hiçbir kovaya girmiyordu).
        const d203 = kovayaYerlestir(orders.filter(o => o.status !== 'Cancelled'), siparisTutari, SIPARIS_BOYUT_KOVALARI);
        // Kapı AYNEN (`< 2`): en az iki dolu kova (`URUN_KARMA_ASGARI` DEĞİL — o P217'nin kapısı).
        const doluKovalar = d203.kovalar.filter(k => k.adet > 0);
        if (doluKovalar.length < 2) return null;
        // `mm` kova başına BİR kez; render içinde ikinci kez çağrılmaz.
        const kovaMarjlari = doluKovalar.map(k => ({ k, mm: brutMarj(k.ogeler, inventory, exchangeRates) }));
        // Çift sayım yok (değişmez): kovadaki her siparişin tutarı BİLİNİR (aksi hâlde `d203.bilinmeyen`) → kova başına
        // `mm.ciroTutar.bilinmeyen === 0`; `maliyetsiz` (kalemi var, maliyeti çözülemedi) ile `kalemsiz` (`lineItems`
        // boş) `brutMarjHesabi` tanımı gereği AYRIK; kovalar kesişmez → toplamlar benzersiz.
        const maliyetsiz203 = kovaMarjlari.reduce((s, x) => s + x.mm.maliyetTutar.bilinmeyen, 0);
        const kalemsiz203 = kovaMarjlari.reduce((s, x) => s + x.mm.kapsamDisi, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{rc(currentLanguage).siparis_buyuklugune_gore_brut_marj}</h3>
            <div className="grid grid-cols-2 gap-3">
              {kovaMarjlari.map(({ k, mm }) => (
                // `mm.marj` TÜRETME kapısından geçer (`ciro` VE `maliyet` tam bilinecek); null = NÖTR gri.
                // Eski `%0` KIRMIZI ("zarar ediyoruz") okunuyordu.
                <div key={k.etiket} className={`rounded-2xl p-4 ${mm.marj === null ? 'bg-gray-50' : mm.marj >= MARJ_IYI ? 'bg-emerald-50' : mm.marj >= MARJ_ORTA ? 'bg-amber-50' : 'bg-red-50'}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">{k.etiket}</p>
                  <p className={`text-3xl font-black ${mm.marj === null ? 'text-gray-400' : mm.marj >= MARJ_IYI ? 'text-emerald-600' : mm.marj >= MARJ_ORTA ? 'text-amber-600' : 'text-red-500'}`}>{yuzdeYaz(mm.marj, 0, dil)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.adet} {oc(currentLanguage).siparis} · {fmtAna(ekranTutari(k.tutar),'K',0)}</p>
                </div>
              ))}
            </div>
            {/* İKİ ayrı not — birimleri farklı kümeler (`<KapsamNotu>` sayaçları birime göre BÖLMEZ). */}
            <KapsamNotu
              sayaclar={{ tutarsiz: d203.bilinmeyen, kapsamDisi: d203.kapsamDisi }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).hicbir_kovaya_girmedi}
            />
            <KapsamNotu
              sayaclar={{ maliyetsiz: maliyetsiz203, kalemsiz: kalemsiz203 }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).marj_hesabinin_disinda}
              className="text-[11px] text-amber-600 mt-1"
            />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 6 && (() => {
        // P215 · Sipariş Adedi vs Ciro (12 Ay) — aylar üst düzey `aylar12` (`aylikCiro`; K2 iptal hariç; K28: 12 ay AYNEN).
        // ETİKET ÇAĞIRANDA: `aylikCiro`nun `etiket`i yıl TAŞIMAZ; 12 ay iki yıla yayıldığında ay adları tekrar ederdi
        // → `DonemSatiri.tarih` ile bugünkü `{ month:'short', year:'2-digit' }` biçimi KORUNUR.
        const dolu215 = aylar12.filter(m => m.adet > 0);
        if (dolu215.length < ADET_CIRO_ASGARI_AY) return null;
        // İKİ ölçek ailesi KARIŞTIRILMAZ: ADET → `sayacOlcegi` + `oranYuzde`; PARA → `tutarSatiri` + `olcekReferansi` + `cubukOrani`.
        const olcekAdet215 = sayacOlcegi(dolu215.map(m => m.adet));
        const cubuklar215 = dolu215.map(m => tutarSatiri(m.tutar));
        const olcekCiro215 = olcekReferansi(cubuklar215);
        // Aylar kesişmez → benzersiz.
        const tutarsiz215 = dolu215.reduce((s, m) => s + m.tutar.bilinmeyen, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{rc(currentLanguage).siparis_adedi_vs_ciro_12_ay}</h3>
            <div className="flex items-end gap-1.5 h-28 mb-2">
              {dolu215.map((m, i) => {
                const isLatest = i === dolu215.length - 1;
                return (
                  <div key={m.anahtar} className="flex-1 flex flex-col items-center gap-0.5">
                    {/* 72 px kap ve `flex items-end gap-px` ÇAĞIRANDA; her çubuk kendi `flex-1` kolonunda (bileşen
                        yalnız çubuğu çizer). Eski 2 px hayalet tabanları kalktı: ciro çubuğu (kırmızı)
                        tutarsız ayda taralı/çizilmez, adet çubuğu (mavi) DEĞİŞMEZ → "adet var, ciro yok" farkı görünür. */}
                    <div className="w-full flex items-end gap-px" style={{ height: '72px' }}>
                      <div className="flex-1 h-full">
                        <OlcekCubugu
                          yon="dikey"
                          oran={cubukOrani(cubuklar215[i], olcekCiro215)}
                          renkSinifi={isLatest ? 'bg-brand' : 'bg-red-200'}
                          koseSinifi="rounded-t-sm"
                          dil={currentLanguage}
                        />
                      </div>
                      <div className="flex-1 h-full">
                        {/* Liste `adet > 0` ile süzüldüğü için ölçek her zaman kurulur; tek fark 2 px tabanın kalkması. */}
                        <OlcekCubugu
                          yon="dikey"
                          oran={oranYuzde(m.adet, olcekAdet215)}
                          renkSinifi={isLatest ? 'bg-blue-500' : 'bg-blue-200'}
                          koseSinifi="rounded-t-sm"
                          dil={currentLanguage}
                        />
                      </div>
                    </div>
                    <span className="text-[8px] text-gray-400 leading-none">{tarihYaz(m.tarih, { month: 'short', year: '2-digit' }, dil)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" />{oc(currentLanguage).ciro}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300 inline-block" />{oc(currentLanguage).siparis_adedi}</span>
            </div>
            <KapsamNotu
              sayaclar={{ tutarsiz: tutarsiz215, tarihsiz: tarihsizSiparis }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).ciro_cubuguna_dahil_degil}
            />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && inventory.length > 0 && (() => {
        // P216 · İşletme Sermayesi Analizi — hesap `muhasebe/isletmeSermayesi.isletmeSermayesi` (testli); stok değeri
        // `pano/stokSevkiyat.degerToplami` + `cost.kartMaliyetiTL` (GenelOzet P6 `stok185` ile AYNI çağrı; K8 ARA
        // DURUM: taban `kartMaliyetiTL` KALIR — "alış günü maliyetinin dolar kurundan çek, bugünün dolar kuru ile ver"
        // 6h'nin işi). Birim maliyeti YA DA stoğu bilinmeyen kart toplama girmez, SAYILIR (eski maliyet fonksiyonunun 0 dönüşü kalktı).
        const stok216 = degerToplami(inventory, i => kartMaliyetiTL(i, exchangeRates));
        // Küme tanımı AYNEN (K15 parite — 6a'nın P6'da yaptığının aynısı; ödeme durumuna BAKMIYOR — açık soru A2).
        const alacaklilar216 = orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered');
        const alacak216 = toplaBilinen(alacaklilar216, siparisTutari);
        // "Kısa Vade Borç": ÖLÜ YÜZEY kaldırıldı (eski `isPurchase`/`purchaseOrder` süzgeci + 30 gün penceresi —
        // yazıcısı olmayan alanlar, küme hep boş → "₺0 borç"). Borç bu panele BAĞLI DEĞİL → `BORC_BAGLI_DEGIL` (NaN).
        // (Eski `estimatedPayroll = inventory.length` — hesaplanıp atılan ölü kod — SİLİNDİ, yardımcıya TAŞINMADI.)
        // TÜRETME: alacak/stok `tamTutar` kapısından — biri kısmiyse `donen` NaN; KV her durumda NaN (bağlı değil)
        // → `net` NaN, `cariOran` null, `durum` 'bilinmiyor'. Dönen taraf yine hesaplanır (bilinen taraf gizlenmez).
        const wc216 = isletmeSermayesi({
          kasaBanka: SERMAYE_KAPSAM_DISI,
          ticariAlacaklar: tamTutar(alacak216),
          stoklar: tamTutar(stok216),
          ticariBorclar: BORC_BAGLI_DEGIL,
          vergiSgk: SERMAYE_KAPSAM_DISI,
          krediler: SERMAYE_KAPSAM_DISI,
        });
        // K15 kullanıcı 2026-09-19: "Ok." — B'ye bağlı üç küçük noktadan biri, itirazsız: "'∞' → 'borçsuz'".
        // ERTELENDİ: '∞'yi üreten tek yol ölü dalın BOŞ kümesiydi; "borçsuz" demek için gerçek bir borç kaynağı
        // gerekir (dosya başı bilinçli fark 4). Bugün `cariOran` hep null → '—'. `toFixed(1)` PARİTE (bugünkü biçim),
        // kaynak bağlanınca aynı satırdan çalışır; `durum`un 1,5/1,0 eşikleri bu panelde benimsenmez (A4).
        const oranMetni216 = wc216.cariOran !== null ? wc216.cariOran.toFixed(1) : '—';
        // Tek küme (alacak) → sayaç zaten benzersiz (eski iki-küme `Set` birleşimi borç dalıyla birlikte kalktı).
        const tutarsizSiparis216 = alacak216.bilinmeyen;
        // Rozet `net`e bakmaya DEVAM EDER (parite). Asıl arıza kapandı: NaN'da `>= 0` false dönüp bilinmeyen
        // KIRMIZI "Risk" boyanıyordu → bilinmiyorsa rozet ÇİZİLMEZ. Borç bağlı olmadığı sürece `net` hep NaN →
        // rozet bugün HİÇ çizilmez ("Sağlıklı" da bir iddiadır; borcu bilinmeyen şirkete basılmaz).
        const netBiliniyor216 = Number.isFinite(wc216.net);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{rc(currentLanguage).isletme_sermayesi_analizi}</h3>
              {netBiliniyor216 && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${wc216.net >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {wc216.net >= 0 ? (oc(currentLanguage).saglikli) : (currentLanguage === 'tr' ? 'Risk' : 'Risk')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* `fmtAna` (seçili para birimi; NaN → '—') — eski elle `₺${(x/1000).toFixed(0)}K` (`₺NaNK`) kalktı; tek kartta
                  iki biçim kalmadı (alt bölüm zaten `fmtAna`). TR etiketi 'Kısa Vade Borç' AYNEN (ORTAK çiftiyle çakışmaz);
                  'Cari Oran' ORTAK sözlükten (`oc().cari_oran`). */}
              {[
                { label: oc(currentLanguage).donen_varliklar, value: fmtAna(wc216.donen,'K',0), color: 'text-emerald-600', sub: rc(currentLanguage).stok_alacak_kasa_haric },
                { label: rc(currentLanguage).kisa_vade_borc, value: fmtAna(wc216.kv,'K',0), color: 'text-gray-400', sub: rc(currentLanguage).borc_verisi_bu_panele_bagli_degil },
                { label: rc(currentLanguage).net_sermaye, value: fmtAna(wc216.net,'K',0), color: !netBiliniyor216 ? 'text-gray-400' : wc216.net >= 0 ? 'text-emerald-600' : 'text-red-500', sub: `${oc(currentLanguage).cari_oran}: ${oranMetni216}` },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-black ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            {/* EKRAN sözleşmesi (kısmi toplam + not): üstteki kart '—' basarken buranın kısmi rakam basması İKİ
                SÖZLEŞMENİN gereğidir. Pay çubuğu TÜRETME: payda (`wc216.donen`) kısmiyse oran null → çubuk ÇİZİLMEZ
                ("stokun payı %0" yalanı kalktı). */}
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{rc(currentLanguage).stok_degeri}</span>
                  <span>{fmtAna(ekranTutari(stok216),'K',0)}</span>
                </div>
                <OlcekCubugu oran={tamTutar(stok216) === 0 ? 0 : oranYuzde(tamTutar(stok216), wc216.donen)} renkSinifi="bg-blue-300" kalinlik="h-2" dil={currentLanguage} />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                  <span>{rc(currentLanguage).tahsil_edilecek_alacaklar}</span>
                  <span>{fmtAna(ekranTutari(alacak216),'K',0)}</span>
                </div>
                <OlcekCubugu oran={tamTutar(alacak216) === 0 ? 0 : oranYuzde(tamTutar(alacak216), wc216.donen)} renkSinifi="bg-amber-300" kalinlik="h-2" dil={currentLanguage} />
              </div>
            </div>
            {/* İKİ not — birimleri farklı (ürün / sipariş). */}
            <KapsamNotu
              sayaclar={{ maliyetsiz: stok216.bilinmeyen }}
              birim="urun"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).stok_degerine_dahil_degil}
            />
            <KapsamNotu
              sayaclar={{ tutarsiz: tutarsizSiparis216 }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).alacak_toplamina_dahil_degil}
              className="text-[11px] text-amber-600 mt-1"
            />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // P217 · Ürün Karma Analizi (Top 6) — gruplama üst düzey `urunler217` (`pano/stokSevkiyat.urunSatislari`:
        // anahtar `sku ?? name`, `satirTutari` ile `null * miktar === 0` tuzağı kapalı, ciroya göre azalan, KESİLMEZ),
        // pay/payda `rapor/yogunlasma.kumulatifPaylar` (utils-yogunlasma T1 ile AYNI kaynak; yerinde yeniden KURULMAZ).
        // K21 kullanıcı 2026-09-24: "Tüm ciro" — payda TÜM ürünlerin cirosu (eski `total217` yalnız ilk 6'ydı → ilk 6
        // = %100 yanılsaması; yüzdeler DÜŞER). Payda `tamTutar` kapısından: tek kalem bile tutarsızsa TÜM paylar '—'
        // (eski `total217 > 0 ? … : 0` altı üründe de `%0` basıyordu).
        const p217 = kumulatifPaylar(urunler217, u => u.ciro);
        const ilk6 = p217.satirlar.slice(0, URUN_KARMA_N);
        if (ilk6.length < URUN_KARMA_ASGARI) return null;
        const COLORS_217 = ['#ff4000', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#6b7280'];
        // `miktarsiz` SABİT 'urun' birimli → ÜRÜN sayısı (kalem toplamı DEĞİL). `tutarsiz` = okunamayan KALEM sayısı
        // (`p217.toplam.bilinmeyen`; birim 'kayit' — `kapsamNotu.tutarsiz.izinli`de 'kalem' YOK).
        const miktarsiz217 = urunler217.filter(u => u.adet.bilinmeyen > 0).length;
        const payYaz217 = (pay: number | null) => yuzdeYaz(pay === null ? null : Math.round(pay), 0, dil);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{rc(currentLanguage).urun_karma_analizi_top_6}</h3>
            <p className="text-[10px] text-gray-400 mb-4">{rc(currentLanguage).paylar_tum_urun_cirosuna_goredir_ilk_6_urun_gost}</p>
            <div className="flex gap-2 mb-4">
              {ilk6.map((s, i) => (
                <div key={s.oge.anahtar ?? 'tanimsiz'} className="flex-1" style={{ minWidth: 0 }}>
                  <div className="h-16 rounded-xl flex items-end justify-center pb-2" style={{ backgroundColor: COLORS_217[i] + '20' }}>
                    <span className="text-[10px] font-bold" style={{ color: COLORS_217[i] }}>{payYaz217(s.pay)}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full mt-1" style={{ backgroundColor: COLORS_217[i] }} />
                  {/* `ad` null olabilir → '—' (METİN yedeği, sayısal varsayılan değil). */}
                  <p className="text-[9px] text-gray-600 text-center mt-1 truncate">{s.oge.ad ?? '—'}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {ilk6.map((s, i) => (
                <div key={s.oge.anahtar ?? 'tanimsiz'} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS_217[i] }} />
                  <span className="text-gray-700 truncate flex-1">{s.oge.ad ?? '—'}</span>
                  <span className="text-gray-400 shrink-0">{adetYaz(ekranTutari(s.oge.adet), dil)} {oc(currentLanguage).adet}</span>
                  <span className="font-bold text-gray-700 shrink-0">{payYaz217(s.pay)}</span>
                </div>
              ))}
            </div>
            {p217.neden === 'payda-yok' && (
              <p className="text-[10px] text-gray-400 mt-2">
                {rc(currentLanguage).urun_cirosu_sifir_ya_da_negatif_pay_hesaplanamad}
              </p>
            )}
            <KapsamNotu
              sayaclar={{ tutarsiz: p217.toplam.bilinmeyen, miktarsiz: miktarsiz217 }}
              birim="kayit"
              dil={currentLanguage}
              sonuc={rc(currentLanguage).paylar_eksik_ciroyla_hesaplanmaz}
            />
            {/* K-KALEM=A dipnotu (kapanış bulgu 4 — UrunlerRapor ile AYNI kapı ve cümle): Mikro `total` KDV DÂHİL, native
                `price × quantity` KDV HARİÇ — TEK paydada yüzdeye çevrilir; kullanıcı karışık birimi görmeden payları
                karşılaştırmasın. Yalnız `total` yolu en az bir kalemde kullanıldıysa (`kdvDahil217`); Mikro'suz kiracıda yok. */}
            {kdvDahil217 && (
              <p className="text-[10px] text-gray-400 mt-1">
                {rc(currentLanguage).mikro_faturasindan_tureyen_kalemlerde_satir_tuta}
              </p>
            )}
          </div>
        );
      })()}
    </>
  );
}
