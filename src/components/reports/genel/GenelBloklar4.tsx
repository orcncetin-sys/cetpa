/**
 * GenelBloklar4.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 2030–2599).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * ── 6c bağlama notu (Faz 3 "Genel II", 2026-10-17; şartname faz3-2n-specs/6n-kesif/6c/baglama-genel-bloklar4.md) ──
 * 14 panelden üçü KALDIRILDI (K14), kalan 11 panel testli yardımcılara BAĞLANDI; satır içi para / ölçek / sayaç kuralı
 * kalmadı (`src/utils/para`, `pano/*`, `rapor/*`, `siparisler/*`). Kullanıcı kararları (KARARLAR.md, kullanıcının cümleleri):
 *
 * K2  — kullanıcı 2026-09-19: "İptaller ciroya girsin mi → hayır." Tek süzgeç bileşen üst düzeyinde (`iptalsiz`);
 *       kalan 11 panelin 11'i de iptali katıyordu → rakamlar DÜŞER (beklenen).
 * K14 — kullanıcı 2026-09-19: "kaldır" (aynı işi yapan çift paneller; her çiftten TEK panel kalır). Bu dosyadan üç panel
 *       kalktı: ödeme yöntemi dağılımı ve ciro yoğunlaşması (kalanlar GenelBloklar2), aylık brüt marj eğilimi (kalan
 *       GenelBloklar3). Yerlerinde karar yorumu durur.
 * K16 — kullanıcı: "Ok." (0–10.000; 1.500 / 2.500; tek panel + "Cironun %X'i ilk 3 müşteriden") — kalan panel GenelBloklar2.
 * K9  — PLAN-v2 §8 sıra 12: "× 0,6 uydurma maliyet kalkıyor" (kullanıcı onayı "Evet"); tek sitesi silinen panelle düştü.
 * K23 — kullanıcı: "Önerin ok. Sorunun cevabı dediğin gibi olacak." P&L bordrosu YALNIZ aktif + maaşı girilmiş
 *       çalışanlardan; girilmeyen hesaba katılmaz + not; dövizli bordro TL'ye toplanmaz, ayrı sayılır.
 * K15 — kullanıcı: "girmemeli. Sadece teslimat bekliyor olmalı." Fatura ödeme durumu paneli zaten TAHSİLATA bakıyor
 *       (teslimat okumaz) → rakamı değişmedi. "Teslimat bekleyen" kovası 6c kapsamı DIŞI (orkestratör O19).
 * K21 — kullanıcı 2026-09-24: "Tüm ciro" ("ilk N" paydası). Kategori yüzdeleri TÜM kalem cirosuna bölünür.
 * K13 — kullanıcı: "veri eklenebiliyorsa ver, mikro yüzünden verilemiyorsa N/A yaz, CETPA App verisi varsa N/A+ "xx,xx"
 *       göster." + O22: şehir ve kategori panelleri YAZICISI OLAN alandan okur (siparişin teslimat ili, stok kartının
 *       kategorisi) → iki panel ilk kez dolar.
 * K20 — kullanıcı: "ok kalsın." Eşik / pencere / kova DEĞERLERİ aynen; yalnız adlandırıldı (aşağıdaki sabitler).
 * K-YÜZDE — kullanıcı 2026-09-25: "%42 şeklinde olsun" → tüm yüzdeler `bicim.yuzdeYaz`.
 * K-KALEM — ürün cirosu KDV HARİÇ: kalem tutarı `stokSevkiyat.kalemTutari` (tek tanım).
 * "Kur yoksa uydurma yok" (kullanıcı) + O21: TRY dışı mağaza siparişi TL toplamına / paya / paydaya girmez, panel notunda
 *       "N siparişin para birimi TL değil — toplanmadı" diye ayrı sayılır.
 *
 * Bilinçli farklar (bilinen girdide sayılar eskiyle BİREBİR; değişenler kullanıcı / orkestratör kararı ya da kısmi veri):
 *  • Tutarı okunamayan sipariş 0 SAYILMAZ: ekran toplamı kısmi + kapsam notu; türetilen sayı (marj, pay, trend, hareketli
 *    ortalama noktası) HESAPLANMAZ ('—'); çubukta bilinmeyen gri taralı, gerçek 0 boş ray (piksel tabanları kalktı).
 *  • P&L: maliyet TEK çözücüden (O24 — kalemin kendi maliyeti ÖNCE, yoksa eşleşen stok kartı; eskiden kart önceydi,
 *    çevrilemeyen kart 0 sayılıyordu); brüt kâr yalnız kalemi olan siparişlerden (O12 — kalemsiz Mikro siparişi maliyetsiz
 *    kâr gibi girmez); EBITDA hesaplanır + not + dipnot (gider yalnız bordro); marjlar HAM oran, 1 ondalık (O13).
 *  • Saate göre ortalama sepet ve yüzdelik dilimler bilinen tutarlardan + not (O6); siparişsiz gün dilimi '—'.
 *  • Hareketli ortalama: penceresinde tutarı bilinmeyen sipariş olan nokta '—' (O8); tarih kuralı `createdAt` (parite).
 *  • Isı haritası: sütun sırası düzeldi (sol = en eski, sağ = şimdi — O17); gelecek tarihli sipariş ölçeğe girmez.
 *  • Süreklilik serisi: tek aktif gün = en uzun seri 1 (O17). Tutar dağılımı paneli "sipariş" sayar (O17 — etiket düzeldi).
 *  • Tutar `siparis.siparisTutari` ile okunur (`totalPrice ?? totalAmount`).
 *  • O16 (gözlem, davranış DEĞİŞMEDİ): "Overdue 30d+" sipariş tarihinden; "Ciro Süreklilik Serisi" sipariş varlığından.
 *  • 6c inceleme 1 (2026-10-17; testi `genel/GenelBloklar4.test.tsx` çizerek): P&L «Revenue» (KDV dâhil başlık tutarı) ile
 *    «Gross Profit» (KDV hariç marj tabanı) ayrışan Mikro faturası sayılır + dipnot (sayılar DEĞİŞMEDİ); şehir panelinin
 *    "tutarı okunamadı" sayacı TÜM şehirlerden (P66 kuralı; anahtarsız hariç).
 */
import { useMemo } from 'react';
import { type ReportsCtx } from '../useReportsData';
import { type OrderLineItem } from '../../../types';
import { odemeTakipli, siparisIptalMi, siparisTutari } from '../../../utils/siparis';
import { tryDisiMi, magazaSiparisiMi } from '../../../utils/siparisler/magazaSiparisi';
import { siparisSehri } from '../../../utils/siparisler/teslimatAdresi';
import { paraYaz } from '../../../utils/currency';
import { zamanDate, gunAnahtari, gunFarki } from '../../../utils/zaman';
import { toplaBilinen, ekranTutari, tamTutar, tutarBirlestir, sayiSirala, kurusaYuvarla, type Tutar } from '../../../utils/para';
import { BOS_TUTAR, kovayaEkle } from '../../../utils/pano/raporVeriKatmani';
import { tutarSatiri, olcekReferansi, cubukOrani, sayacOlcegi, seriCubukOrani } from '../../../utils/pano/cubuk';
import { oranYuzde } from '../../../utils/siparisler/lojistikKpi';
import { stokKartiCozucu, stokMaliyetCozucu, brutMarjHesabi, hamMarj, marjCirosu } from '../../../utils/pano/raporMarj';
import { kartMaliyetiTL } from '../../../utils/cost';
import { hareketliOrtalama } from '../../../utils/pano/ciroDonem';
import { segmentCirosu } from '../../../utils/pano/musteriAnaliz';
import { kalemTutari, kdvDahilKalemVar } from '../../../utils/pano/stokSevkiyat';
import { zamanKovalari, haftaGunIzgarasi, aktifGunSerisi } from '../../../utils/rapor/zamanDagilimi';
import { kovayaYerlestir, yuzdelikler, type KovaSiniri } from '../../../utils/rapor/dagilim';
import { maasKutlesi } from '../../../utils/rapor/ikBordro';
import { yuzdeYaz } from '../../../utils/rapor/bicim';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';
import { rc } from '../../../i18n/rapor';

// O5 (orkestratör): `leadCariKodu` GenelRapor'dan GB2 / GB3 / GB4'e aynı biçimde geçer. Bu dosyada tüketicisi YOK (müşteri
// gruplayan tek site, ciro yoğunlaşması paneli, K14 ile kalktı) → parametre yıkımına EKLENMEDİ.
type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'exchangeRates' | 'currentLanguage' | 'fmtAna' | 'leadCariKodu'>;

/* K20 — kullanıcı 2026-09-19: "ok kalsın." Gömülü eşik / pencere / kova DEĞERLERİ aynen korunur, yalnız adlandırılır. */
const GUN_MS = 86400000;
/** Tüm zamanların gösterilen en yüksek ciro günü sayısı ("Top 10 Revenue Days"). */
const ZIRVE_GUN_N = 10;
/** Hareketli ortalama: pencere (takvim günü) ve ortalama genişliği (takvim günü; sipariş olmayan gün gerçek ₺0). */
const HAREKETLI_PENCERE_GUN = 28, HAREKETLI_ORTALAMA_GUN = 7;
/**
 * Saate göre ortalama sepet — gün dilimleri (saat, yerel). Gece 22–6 iki güne yayılır; 24 saatin tamamı kapsanır.
 * `as const` YAZILMAZ: sabit birleşim tipinde `saatler.includes(d.getHours())` derlenmez.
 */
const GUN_DILIMLERI: readonly { etiket: string; altEtiket: string; saatler: readonly number[]; renk: string }[] = [
  { etiket: 'Morning', altEtiket: '6–12', saatler: [6, 7, 8, 9, 10, 11], renk: '#f59e0b' },
  { etiket: 'Afternoon', altEtiket: '12–17', saatler: [12, 13, 14, 15, 16], renk: '#3b82f6' },
  { etiket: 'Evening', altEtiket: '17–22', saatler: [17, 18, 19, 20, 21], renk: '#8b5cf6' },
  { etiket: 'Night', altEtiket: '22–6', saatler: [22, 23, 0, 1, 2, 3, 4, 5], renk: '#94a3b8' },
];
/** Fatura ödeme durumu — "Overdue 30d+": SİPARİŞ tarihinden bu yana gün (vade DEĞİL — O16; davranış parite). */
const GECIKME_GUN = 30;
/** Şehir paneli — gösterilen şehir sayısı ve panel kapısı. */
const SEHIR_N = 8, SEHIR_ASGARI = 2;
/** Yüzdelik dilimler, renkleri ve panel kapısı. */
const YUZDELIKLER: readonly number[] = [10, 25, 50, 75, 90, 99];
const YUZDELIK_RENKLERI = ['#94a3b8', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
const YUZDELIK_ASGARI = 5;
/** Tutar dağılımı — bantlar; üst sınır HARİÇ, son bant `Infinity` (eski `v >= min && v < max` ile aynı). */
const TUTAR_BANTLARI: readonly KovaSiniri[] = [
  { etiket: '<₺500', ust: 500 },
  { etiket: '₺0.5–2K', ust: 2000 },
  { etiket: '₺2–10K', ust: 10000 },
  { etiket: '₺10–50K', ust: 50000 },
  { etiket: '₺50K+', ust: Infinity },
];
const TUTAR_BANT_RENKLERI = ['#94a3b8', '#6366f1', '#3b82f6', '#10b981', '#f59e0b'];
const TUTAR_BANDI_ASGARI = 5;
/** Isı haritası — kayan 7-gün blokları (takvim haftası DEĞİL), dolu hücre kapısı, yoğunluk eşikleri (YÜZDE; eski 0,25 / 0,5 / 0,75). */
const ISI_HAFTA = 8, ISI_ASGARI_HUCRE = 3;
const ISI_ESIKLERI = [25, 50, 75] as const;
/** Kategori paneli — gösterilen kategori sayısı ve panel kapısı. Yüzde paydası TÜM kalem cirosu (K21). */
const KATEGORI_N = 7, KATEGORI_ASGARI = 2;
/** Süreklilik serisi — son N gün kareleri ve panel kapısı (aktif gün). */
const SERI_SON_GUN = 30, SERI_ASGARI_GUN = 3;

/** Dolu metin ya da `null` (boş / boşluk / metin olmayan değer anahtar değildir). */
const doluMetin = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null);

export default function GenelBloklar4({ reportsTab, orders, inventory, employees, exchangeRates, currentLanguage, fmtAna }: Props) {
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  // K2 (kullanıcı, 2026-09-19): "İptaller ciroya girsin mi → hayır." Rapor ekranlarında ciro = iptaller
  // HARİÇ, TEK kural (`siparis.siparisIptalMi`). Bu dosyanın kalan 11 panelinin 11'i iptali katıyordu
  // (sipariş durumu okuması yoktu — 2026-10-02 ölçümü) → rakamlar DÜŞER, beklenen.
  const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);
  // O21 (orkestratör; kullanıcı kararı "kur yoksa uydurma yok" + K23 ilkesi "dövizli ayrı sayılır"): TRY dışı mağaza
  // siparişinde `totalPrice` YOK (tutar `dovizTutar` + `paraBirimi`). BOZUK VERİ DEĞİLDİR: TL toplamına, paya, paydaya ve
  // "tutarı okunamadı" sayacına GİRMEZ; `dovizliler` kümesinde ayrı sayılır, panel notu `KapsamNotu` dövizli sayacıdır.
  // Süzgeç burada, ÇAĞIRANDA — yardımcı imzaları değişmez. İptal edilmiş dövizli sipariş satış değildir (K2) → ikisinde de yok.
  const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);
  const dovizliler = useMemo(() => iptalsiz.filter(o => tryDisiMi(o)), [iptalsiz]);
  // K9 (PLAN-v2 §8 sıra 12): "× 0,6 uydurma maliyet kalkıyor". O14 / O24: TEK çözücü — kalemin costPrice'ı ÖNCE, yoksa
  // eşleşen kartın kartMaliyetiTL'si; ikisi de yoksa maliyet BİLİNMİYOR. P&L paneli 6c öncesi kartı önce okuyordu (bilinçli
  // fark); Genel sekmesinde GB2 `brutMarj` ve GB3 aynı çözücüyü okur — ikinci bir sıra YAZILMAZ.
  const kalemMaliyeti = useMemo(
    () => stokMaliyetCozucu(inventory, k => kartMaliyetiTL(k, exchangeRates)),
    [inventory, exchangeRates],
  );
  // O22 (orkestratör; K13 "veri eklenebiliyorsa ver"): kalem → stok KARTI eşlemesinin TEK kuralı (maliyet çözücüsünün
  // kullandığı eşlemenin aynısı; kopya kart araması YAZILMAZ). Kategori paneli kategoriyi kartın `category`'sinden okur.
  const kartBul = useMemo(() => stokKartiCozucu(inventory), [inventory]);
  return (
    <>
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now = new Date();
        const currMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        // K2: ayın siparişleri iptalsiz kümeden; tarih kuralı `createdAt` (parite). Tarihsiz kayıt artık SAYILIR.
        const buAyHepsi = iptalsiz.filter(o => {
          const d = zamanDate(o.createdAt);
          return d !== null && d >= currMonth;
        });
        // O21: ay süzgeci TEK yerde; ayın TL siparişleri ↔ dövizli siparişleri.
        const buAy = buAyHepsi.filter(o => !tryDisiMi(o));
        const dovizli22 = buAyHepsi.length - buAy.length;
        // `iptalsiz`'den: tarihsiz dövizli sipariş de bir kez, burada sayılır (kümeler ayrık ve eksiksiz).
        const tarihsiz22 = iptalsiz.filter(o => zamanDate(o.createdAt) === null).length;
        // O12 (orkestratör): brüt kâr marj KAPSAMINDAN (kalemi olan siparişler); kalemsiz Mikro siparişinin cirosu "Revenue"da
        // durur ama maliyetsiz kâr gibi GİRMEZ; kapsamda tek siparişin tutarı / maliyeti bilinmiyorsa brüt kâr '—'.
        const marj22 = brutMarjHesabi(buAy, kalemMaliyeti);
        // Ayın TÜM siparişleri kalemsizken "COGS ₺0 / brüt kâr ₺0" sahte kesinliktir → bilinmiyor.
        const kapsamli22 = buAy.length - marj22.kapsamDisi;
        const kapsamBos = buAy.length > 0 && kapsamli22 === 0;
        const maliyet22 = kapsamBos ? NaN : marj22.maliyet;
        const brutKar22 = kapsamBos ? NaN : marj22.brutKar;
        // 6c inceleme 1: «Revenue» başlık tutarıdır (`siparisTutari`; Mikro faturasında `cha_meblag`, KDV DÂHİL), «Gross Profit» marj
        // tabanından (`raporMarj.marjCirosu`; sürüm-2 MF kaleminde KDV HARİÇ Σ `netTutar`). İki taban ayrışınca Revenue − COGS
        // satırları Gross Profit'i vermez → SAYILAR DEĞİŞMEZ, ayrışan sipariş sayılır ve kartın altına dipnot düşer. Yalnız İKİ
        // taban da bilinen ve kuruşta farklı olan sipariş sayılır: taban bilinmiyorsa brüt kâr zaten '—', başlık tutarı bilinmiyorsa
        // sipariş «Revenue»ya girmez (notta). Kalemsiz ve yerel siparişte `marjCirosu` = `siparisTutari` (yapısal olarak AYNI) →
        // ayrışma yalnız kalemli MF siparişinde olur, ayrı kalem süzgeci gerekmez. Kuruş yuvarlaması Σ net'in kayan noktası için.
        const kdvAyrisan22 = buAy.filter(o => {
          const taban = marjCirosu(o), baslik = siparisTutari(o);
          return Number.isFinite(taban) && Number.isFinite(baslik) && kurusaYuvarla(taban) !== kurusaYuvarla(baslik);
        }).length;
        // K23 (kullanıcı): "Önerin ok. Sorunun cevabı dediğin gibi olacak." — YALNIZ aktif + maaşı girilmiş; girilmeyen hesaba katılmaz + "N çalışanın maaşı girilmemiş" notu; dövizli bordro TL'ye TOPLANMAZ, ayrı sayılır.
        const maas22 = maasKutlesi(employees);
        // Girilmiş aktif TL maaşların KISMİ toplamı; aktif TL çalışan var ama hiçbirinin maaşı girilmemişse NaN ('—');
        // kadro boşsa ya da aktiflerin tümü dövizliyse gerçek ₺0.
        const bordro22 = ekranTutari(maas22.tutar);
        // O12 (orkestratör): K23 lafzı — maaş kütlesi girilmiş aktiflerden; EBITDA hesaplanır + not.
        // Maaşı girilmemiş / dövizli çalışan EBITDA'yı '—' YAPMAZ (nota girer); biri NaN ise sonuç NaN → '—'.
        const ebitda22 = brutKar22 - bordro22;
        const pnlItems = [
          { label: 'Revenue', value: marj22.toplamCiro, type: 'revenue' },
          { label: 'Cost of Goods Sold', value: -maliyet22, type: 'expense' },
          { label: 'Gross Profit', value: brutKar22, type: 'subtotal' },
          { label: 'Payroll & Benefits', value: -bordro22, type: 'expense' },
          { label: 'EBITDA', value: ebitda22, type: 'total' },
        ];
        const bordroNotu = [
          maas22.maasiGirilmemis > 0
            ? (currentLanguage === 'tr' ? `${maas22.maasiGirilmemis} çalışanın maaşı girilmemiş` : `${maas22.maasiGirilmemis} employees have no salary entered`)
            : null,
          maas22.dovizli > 0
            ? (currentLanguage === 'tr' ? `${maas22.dovizli} dövizli bordro dâhil değil` : `${maas22.dovizli} foreign-currency salaries not included`)
            : null,
          maas22.durumBilinmeyen > 0
            ? (currentLanguage === 'tr' ? `${maas22.durumBilinmeyen} çalışanın durumu okunamadı` : `${maas22.durumBilinmeyen} employees have an unreadable status`)
            : null,
        ].filter((x): x is string => x !== null).join('; ');
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">P&L Summary — Current Month</h3>
            <p className="text-xs text-gray-500 mb-4">Month-to-date · {buAy.length} orders processed</p>
            <div className="space-y-2">
              {pnlItems.map((item,i) => (
                <div key={i} className={`flex justify-between items-center px-3 py-2 rounded-lg ${item.type==='subtotal'?'bg-blue-50':item.type==='total'?'bg-gray-100 font-black':'bg-gray-50'}`}>
                  <span className={`text-xs ${item.type==='total'?'font-black text-gray-800':'font-medium text-gray-700'}`}>{item.label}</span>
                  {/* Bilinmeyen değer: '—' + nötr renk, işaret YOK (eski `>= 0` kuralı NaN'ı kırmızı "-₺0" gibi basardı). */}
                  <span className={`text-sm font-bold ${!Number.isFinite(item.value) ? 'text-gray-400' : item.value>=0?'text-green-600':'text-red-500'}`}>
                    {Number.isFinite(item.value) ? <>{item.value>=0?'+':''}{fmtAna(Math.abs(item.value),'full',0)}</> : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center">
              {/* O13: HAM oran (`hamMarj`, yuvarlanmamış) 1 ondalıkla; payda iki oranda da marj kapsamındaki ciro. Hesaplanamayan → '—'. */}
              <span className="text-xs text-gray-400">Gross margin: {yuzdeYaz(hamMarj(marj22), 1, dil)} · EBITDA margin: {yuzdeYaz(oranYuzde(ebitda22, tamTutar(marj22.ciroTutar)), 1, dil)}</span>
            </div>
            {/* "Revenue" satırının notu ile brüt kârın "kısmi" notu FARKLI iddialardır, TOPLANMAZ (aynı sipariş ikisinde de geçebilir). */}
            <KapsamNotu sayaclar={{ tutarsiz: marj22.toplamCiroTutar.bilinmeyen, tarihsiz: tarihsiz22 }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).toplama_dahil_degil} />
            <KapsamNotu sayaclar={{ tutarsiz: marj22.ciroTutar.bilinmeyen, maliyetsiz: marj22.maliyetTutar.bilinmeyen, kalemsiz: marj22.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).marj_hesabina_girmedi} />
            {/* O12 bordro notu — tek satır. Çalışan sayar (sipariş sayan dövizli satış notuyla KARIŞMAZ). */}
            {bordroNotu !== '' && <p className="text-[11px] text-amber-600 mt-2">{bordroNotu}</p>}
            <KapsamNotu sayaclar={{ dovizli: dovizli22 }} birim="siparis" dil={currentLanguage} />
            {kdvAyrisan22 > 0 && (
              <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr'
                ? `Brüt kâr KDV hariç kalem netinden; «Revenue» ${kdvAyrisan22.toLocaleString('tr-TR')} Mikro faturasında KDV dâhil tutardır`
                : `Gross profit uses net-of-VAT line totals; «Revenue» is VAT-inclusive for ${kdvAyrisan22.toLocaleString('en-US')} Mikro invoice(s)`}</p>
            )}
            {/* O12: "EBITDA" adı kalır + dipnot. */}
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'EBITDA: gider yalnız bordro — diğer faaliyet giderleri dâhil değil' : 'EBITDA: expenses are payroll only — other operating expenses not included'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // Gün kovası: bilinenler toplanır, bilinmeyenler SAYILIR. Tarih kuralı `createdAt` (parite); pencere yok.
        const gunler = new Map<string, Tutar>();
        // Sayaç başlangıcı — gerçek sıfır: henüz tarihsiz kayıt görülmedi.
        let tarihsiz66 = 0;
        for (const o of satislar) {
          const k = gunAnahtari(o.createdAt);
          if (k === null) { tarihsiz66++; continue; }
          gunler.set(k, kovayaEkle(gunler.get(k) ?? BOS_TUTAR, siparisTutari(o)));
        }
        // Hiç bilineni olmayan gün (NaN) SONDA.
        const zirve = [...gunler.entries()].map(([gun, tutar]) => ({ gun, tutar }))
          .sort((a, b) => sayiSirala(ekranTutari(a.tutar), ekranTutari(b.tutar), true)).slice(0, ZIRVE_GUN_N);
        if (zirve.length === 0) return null;
        // Tepe gün kısmiyse ölçek YOK (çubuklar çizilmez).
        const olcek66 = olcekReferansi(zirve.map(g => tutarSatiri(g.tutar)));
        // Sayaç toplamı: TÜM günlerin tutarı okunamayan siparişleri (günler ayrık → çift sayım yok; gösterilmeyen
        // günlerin bilinmeyeni de sıralamayı etkiler).
        const tutarsiz66 = [...gunler.values()].reduce((s, t) => s + t.bilinmeyen, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">Top 10 Revenue Days — All Time</h3>
            <div className="space-y-2">
              {zirve.map((g, i) => (
                <div key={g.gun} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-gray-400 w-4">#{i+1}</span>
                  <span className="text-xs text-gray-600 w-20">{g.gun}</span>
                  <div className="flex-1">
                    <OlcekCubugu oran={cubukOrani(tutarSatiri(g.tutar), olcek66)} renk={i===0?'#f59e0b':i<3?'#10b981':'#3b82f6'} kalinlik="h-4" dil={currentLanguage} />
                  </div>
                  <span className="text-xs font-bold text-gray-800 w-24 text-right">{fmtAna(ekranTutari(g.tutar),'full',0)}</span>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz66, tarihsiz: tarihsiz66 }} birim="siparis" dil={currentLanguage} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        // O8 (orkestratör): `ciroDonem.gunlukCiro` KULLANILMAZ (Mikro faturası siparişlerini native taraftan atıyor; fatura listesi
        // boş verilince o ciro kaybolurdu) → `zamanKovalari` + `hareketliOrtalama`. Tarih kuralı `createdAt` (parite).
        const bugun96 = new Date();
        // İndeks = 27 − (bugün − gün) TAKVİM günü: sol = 27 gün önce, sağ = bugün (eski gün dizisinin sırası — parite).
        // Gelecek tarihli ve 27 günden eski kayıt aralık dışı indeks alır → `kapsamDisi` sayılır.
        const indeks96 = (d: Date) => { const f = gunFarki(bugun96, d); return f === null ? -1 : HAREKETLI_PENCERE_GUN - 1 - f; };
        const g96 = zamanKovalari(satislar, HAREKETLI_PENCERE_GUN, indeks96, { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        // O21: penceredeki dövizli sipariş — ikinci pencere tanımı yazılmadı, AYNI indeks; yalnız adet okunur.
        const dz96 = zamanKovalari(dovizliler, HAREKETLI_PENCERE_GUN, indeks96, { tarihSec: o => o.createdAt });
        // O6: penceresinde tutarı bilinmeyen kayıt olan NOKTA `null`; sipariş olmayan gün GERÇEK ₺0. İlk 6 nokta `null` → 22 nokta.
        const kayan96 = hareketliOrtalama(g96.kovalar.map(k => k.ciro), HAREKETLI_ORTALAMA_GUN).slice(HAREKETLI_ORTALAMA_GUN - 1);
        // Yalnız "hiç satış yok" gizler; bilinmeyen varsa panel görünür ve bunu söyler.
        if (!kayan96.some(v => v === null || v > 0)) return null;
        const olcek96 = sayacOlcegi(kayan96);
        const ilk = kayan96[0], son = kayan96[kayan96.length - 1];
        const trend = ilk !== null && son !== null ? son - ilk : null;
        // Sayaç toplamı: penceredeki tutarı okunamayan siparişler (günler ayrık → çift sayım yok).
        const tutarsiz96 = g96.kovalar.reduce((s, k) => s + k.ciro.bilinmeyen, 0);
        // Sayaç toplamı: penceredeki dövizli sipariş (ikinci pencere tanımı yazılmadı, aynı indeks).
        const dovizli96 = dz96.kovalar.reduce((s, k) => s + k.adet, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">Rolling 7-Day Avg Revenue — Last 28 Days</h3>
            <p className="text-xs text-gray-500 mb-4">
              Trend: {trend === null
                ? <span className="text-gray-400 font-bold">—</span>
                : <span className={trend >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{trend >= 0 ? '↑' : '↓'} {fmtAna(Math.abs(trend),'full',0)}/day avg</span>}
            </p>
            <div className="flex items-end gap-0.5 h-20">
              {kayan96.map((v, i) => (
                <div key={i} className="flex-1 h-full" style={{ opacity: 0.6 + i / kayan96.length * 0.4 }}>
                  <OlcekCubugu yon="dikey" oran={v === null ? null : seriCubukOrani(v, olcek96)} renk={i === kayan96.length - 1 ? '#f97316' : '#6366f1'} koseSinifi="rounded-t" title={v === null ? '—' : paraYaz(v, { ondalik: 0 })} dil={currentLanguage} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>28d ago</span><span>Today</span>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz96, tarihsiz: g96.tarihsiz, kapsamDisi: g96.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'hareketli ortalamaya girmedi' : 'not included in the rolling average'} />
            <KapsamNotu sayaclar={{ dovizli: dovizli96 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const z140 = zamanKovalari(satislar, GUN_DILIMLERI.length, d => GUN_DILIMLERI.findIndex(p => p.saatler.includes(d.getHours())), { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        // O6 (K23 ilkesi "girilmeyen hesaba katılmaz + not"): ortalama, tutarı BİLİNEN siparişlerden; bilinmeyen sayılır.
        // `finansKpi.ortalamaSiparisTutari` ile aynı kural (liste yerine kovanın Tutar'ından). Siparişi olmayan ya da hiç bilinen
        // tutarı olmayan dilimin ortalaması bilinmiyor (NaN → '—'; eski ₺0 kalktı).
        const dilimler = GUN_DILIMLERI.map((p, i) => {
          const k = z140.kovalar[i];
          return { ...p, adet: k.adet, aov: k.ciro.bilinen > 0 ? k.ciro.toplam / k.ciro.bilinen : NaN };
        });
        const hasData = dilimler.some(d => d.adet > 0);
        if (!hasData) return null;
        const olcek140 = sayacOlcegi(dilimler.map(d => d.aov));
        // Sayaç toplamı: dilimlerin tutarı okunamayan siparişleri (dilimler ayrık → çift sayım yok).
        const tutarsiz140 = z140.kovalar.reduce((s, k) => s + k.ciro.bilinmeyen, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-3">{currentLanguage === 'tr' ? 'Saate Göre Ortalama Sepet' : 'AOV by Time of Day'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {dilimler.map(d => (
                <div key={d.etiket} className="rounded-xl p-4" style={{background: `${d.renk}15`}}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xs font-bold text-gray-700">{d.etiket}</div>
                      <div className="text-[10px] text-gray-400">{d.altEtiket}h</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{d.adet} orders</span>
                  </div>
                  <div className="mb-2">
                    {/* Siparişsiz dilim GERÇEK "sipariş yok" → boş ray (bilinmiyor DEĞİL); siparişi olup hiç bilinen tutarı olmayan dilim taralı. */}
                    <OlcekCubugu oran={d.adet === 0 ? 0 : seriCubukOrani(d.aov, olcek140)} renk={d.renk} kalinlik="h-1.5" dil={currentLanguage} />
                  </div>
                  <div className="text-base font-black" style={{color: d.renk}}>
                    {fmtAna(d.aov,'full',0)}
                  </div>
                  <div className="text-[9px] text-gray-400">avg order value</div>
                </div>
              ))}
            </div>
            {/* 24 saat kapsandığı için `z140.kapsamDisi` yapısal olarak 0 — nota konmaz. */}
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz140, tarihsiz: z140.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).ortalamaya_dahil_degil} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const faturaliHepsi = iptalsiz.filter(o => o.hasInvoice || o.faturali);
        if (faturaliHepsi.length === 0) return null;
        // O21: fatura süzgeci TEK yerde; TL ↔ dövizli bölünmesi.
        const faturali = faturaliHepsi.filter(o => !tryDisiMi(o));
        const dovizli189 = faturaliHepsi.length - faturali.length;
        // K15 (kullanıcı): "Teslim edilmemiş ama peşin ödenmiş sipariş alacak görünüyor." → "girmemeli. Sadece teslimat bekliyor olmalı." Bu panel TAHSİLATA bakar (teslimat okumaz) — ödenmiş sipariş, teslim edilmemiş olsa da "Paid"dedir, alacak DEĞİL.
        const odenenler = faturali.filter(o => Boolean(o.paid || o.paidAt));
        // Mikro türevi siparişler `faturali: true` taşır ama `paid` / `paidAt` HİÇ YOK —
        // ödeme durumu Cetpa'da izlenmiyor, "ödenmedi" demek yanıltıcı (2026-09-04).
        const odenmeyenler = faturali.filter(o => !o.paid && !o.paidAt && odemeTakipli(o));
        // Faturalı ama ödemesi izlenmeyen (Mikro türevi) kayıt hiçbir kutuda değil — artık sayılır.
        const izlenmeyen189 = faturali.length - odenenler.length - odenmeyenler.length;
        const odendi = toplaBilinen(odenenler, siparisTutari);
        const odenmedi = toplaBilinen(odenmeyenler, siparisTutari);
        const simdi = new Date();
        // O16: "Overdue 30d+" SİPARİŞ tarihinden 30+ gün demektir (vade tarihi DEĞİL) — davranış parite; vade tabanlı tahsilatVade.odenmemisOzeti KULLANILMAZ.
        const gecikenler = odenmeyenler.filter(o => {
          const d = zamanDate(o.createdAt);
          return d !== null && (simdi.getTime() - d.getTime()) / GUN_MS > GECIKME_GUN;
        });
        const geciken = toplaBilinen(gecikenler, siparisTutari);
        // Tarihsiz ödenmemiş sipariş gecikmiş SAYILMAZ (parite) — not olarak sayılır.
        const tarihsiz189 = odenmeyenler.filter(o => zamanDate(o.createdAt) === null).length;
        // Oranlı çubuk TÜRETMEDİR: payda ya da paylardan biri tam bilinmiyorsa hiçbir dilim çizilmez (kısmi dilimler yanıltır).
        // Yuvarlamasız `oranYuzde` (dilim genişlikleri toplamı 100'ü aşmasın); geciken ⊂ ödenmeyen → üçü %100 eder.
        const payda = tamTutar(tutarBirlestir(odendi, odenmedi));
        const oranOdendi = oranYuzde(tamTutar(odendi), payda);
        const oranGeciken = oranYuzde(tamTutar(geciken), payda);
        const oranBekleyen = oranYuzde(tamTutar(odenmedi) - tamTutar(geciken), payda);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Fatura Ödeme Durumu' : 'Invoice Payment Status'}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-green-600">{odenenler.length}</div>
                <div className="text-[10px] text-gray-500">Paid</div>
                <div className="text-[9px] text-green-500">{fmtAna(ekranTutari(odendi),'K',0)}</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-amber-600">{odenmeyenler.length}</div>
                <div className="text-[10px] text-gray-500">Awaiting</div>
                <div className="text-[9px] text-amber-500">{fmtAna(ekranTutari(odenmedi),'K',0)}</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-xl font-black text-red-600">{gecikenler.length}</div>
                <div className="text-[10px] text-gray-500" title={currentLanguage === 'tr' ? 'Sipariş tarihinden 30+ gün (vade tarihi değil)' : '30+ days since the order date (not the due date)'}>Overdue 30d+</div>
                <div className="text-[9px] text-red-500">{fmtAna(ekranTutari(geciken),'K',0)}</div>
              </div>
            </div>
            {oranOdendi !== null && oranGeciken !== null && oranBekleyen !== null ? (
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-0.5">
                {oranOdendi > 0 && <div className="h-full bg-green-400 rounded-l-full" style={{width: `${oranOdendi}%`}} />}
                {oranGeciken > 0 && <div className="h-full bg-red-400" style={{width: `${oranGeciken}%`}} />}
                {oranBekleyen > 0 && <div className="h-full bg-amber-300 rounded-r-full" style={{width: `${oranBekleyen}%`}} />}
              </div>
            ) : Number.isFinite(payda) ? (
              // Tutarlar tam biliniyor ama toplam ₺0: gerçek sıfır → boş ray (eski görünüm).
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden" />
            ) : (
              // Tutarı okunamayan sipariş var: oranlar bilinmiyor → taralı "bilinmiyor".
              <OlcekCubugu oran={null} kalinlik="h-3" dil={currentLanguage} />
            )}
            <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />Paid</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Overdue</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />Awaiting</span>
            </div>
            {/* Ödenen ∩ ödenmeyen = ∅ → iki sayaç toplanabilir; geciken ödenmeyenin alt kümesi, EKLENMEZ. */}
            <KapsamNotu sayaclar={{ tutarsiz: odendi.bilinmeyen + odenmedi.bilinmeyen, tarihsiz: tarihsiz189 }} birim="siparis" dil={currentLanguage} />
            {izlenmeyen189 > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${izlenmeyen189} faturalı siparişin ödeme durumu Cetpa'da izlenmiyor (Mikro) — bu kutulara girmedi` : `${izlenmeyen189} invoiced order(s) have no payment tracking in Cetpa (Mikro) — not included in these boxes`}</p>
            )}
            <KapsamNotu sayaclar={{ dovizli: dovizli189 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // O22 (orkestratör; K13 "veri eklenebiliyorsa ver"): şehir = siparişin teslimat ili (siparisSehri — tek okuyucu). Mağaza siparişinde il ayrı alan değil → null → anahtarsız, notta.
        const s238 = segmentCirosu(satislar, o => siparisSehri(o), undefined, { tutarSec: siparisTutari, anahtarsizSay: true });
        // Yardımcı azalan ciroya göre sıralar (bilinmeyen SONDA).
        const sehirler = s238.segmentler.slice(0, SEHIR_N);
        if (s238.segmentler.length < SEHIR_ASGARI) return null;
        // Anahtarsız kümenin iki ayrık nedeni (toplamları yardımcının anahtarsız adedine eşit — o ayrıca basılmaz):
        // mağaza siparişi (il ayrı alan değil, tanım gereği şehirsiz) ↔ şehri girilmemiş sipariş.
        const magaza238 = satislar.filter(o => magazaSiparisiMi(o)).length;
        const sehirsiz238 = satislar.filter(o => !magazaSiparisiMi(o) && siparisSehri(o) === null).length;
        const olcek238 = olcekReferansi(sehirler.map(s => ({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz })));
        // Sayaç toplamı: TÜM şehirlerin tutarı okunamayan siparişleri (şehirler ayrık → çift sayım yok; P66 kuralı). 6c inceleme 1:
        // yalnız gösterilen 8 şehirden toplanıyordu — cirosu bilinmeyen şehir sıralamada sona düşüp kesilince not HİÇ basılmıyordu.
        // Anahtarsız küme GİRMEZ: o siparişler «şehir sıralamasına girmedi» notlarında (sehirsiz238 / magaza238) zaten sayılıyor.
        const tutarsiz238 = s238.segmentler.reduce((t, s) => t + s.tutarsiz, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Hacmine Göre En İyi Şehirler' : 'Top Cities by Order Volume'}</h3>
            <p className="text-xs text-gray-500 mb-4">Revenue and order count by shipping destination</p>
            <div className="space-y-2">
              {sehirler.map(s => (
                <div key={s.anahtar} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-700 w-24 truncate">{s.anahtar}</span>
                  <div className="flex-1">
                    <OlcekCubugu oran={cubukOrani({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz }, olcek238)} renkSinifi="bg-blue-400" kalinlik="h-4" dil={currentLanguage} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-10 text-right">{s.siparisSayisi} ord</span>
                  <span className="text-xs font-bold text-blue-600 w-24 text-right">{fmtAna(s.ciro,'full',0)}</span>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz238 }} birim="siparis" dil={currentLanguage} />
            {sehirsiz238 > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${sehirsiz238} siparişin şehri girilmemiş — şehir sıralamasına girmedi` : `${sehirsiz238} order(s) have no city entered — excluded from the city ranking`}</p>
            )}
            {magaza238 > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${magaza238} mağaza siparişinde il ayrı alan değil — şehir sıralamasına girmedi` : `${magaza238} online store order(s) have no separate province field — excluded from the city ranking`}</p>
            )}
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır.
          Bu dosyadaki ikinci "Ödeme Yöntemi Dağılımı" paneli KALDIRILDI (orkestratör O3: liste K14'ün bilinen
          çiftleriydi; kural geneldir). Kalan tek panel GenelBloklar2.tsx'tedir: iptaller hariç, yalnız yazıcısı
          olan `paymentMethod` alanı, "Belirtilmemiş" satırı. */}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan:
          testli yardımcıya bağlı olan). Bu dosyadaki aylık brüt marj eğilimi paneli KALDIRILDI (orkestratör O23;
          K14 genel kuralı O3). Bu çiftten kalan panel GenelBloklar3.tsx P9 "Gross Margin % — 12-Month Trend" (6b'de testli
          brutMarjHesabi'na bağlı, son 12 takvim ayı). GenelBloklar1 «Aylık Brüt Marj Trendi» (6 aylık ciro / maliyet /
          kâr tutarı çubukları + ortalama marj etiketi) farklı içeriktir; bu kararın DIŞINDADIR, çift sayılmaz (orkestratör). */}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // O6 (K23 ilkesi "girilmeyen hesaba katılmaz + not"): tutarı bilinmeyen sipariş dilimlere / ortalamaya GİRMEZ, SAYILIR —
        // dilimler bilinenlerden yine hesaplanır. ₺0 / negatif tutar kapsam dışı (eski kodda da hariçti). Yöntem parite
        // (`floor(p/100·(n−1))`, yardımcının içinde).
        const y337 = yuzdelikler(satislar, siparisTutari, YUZDELIKLER, { sadecePozitif: true });
        if (y337.bilinen < YUZDELIK_ASGARI) return null;
        const dilimler337 = YUZDELIKLER.map((p, i) => ({ etiket: `P${p}`, deger: y337.degerler[i], renk: YUZDELIK_RENKLERI[i] }));
        // Ölçek = en büyük bilinen dilim (P99); uydurma ₺1 paydası yok.
        const olcek337 = sayacOlcegi(y337.degerler);
        // O6: ayrı elle toplama YOK — sıralamaya giren kümenin toplamı (bilinmeyeni yapısal olarak 0).
        const ort337 = y337.bilinen > 0 ? tamTutar(y337.toplam) / y337.bilinen : null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Tutarı Yüzdelik Dilimleri' : 'Order Value Percentile Bands'}</h3>
            <p className="text-xs text-gray-500 mb-4">{y337.bilinen} orders · Avg: {ort337 === null ? '—' : fmtAna(ort337,'full',0)}</p>
            <div className="space-y-1.5">
              {dilimler337.map(b => (
                <div key={b.etiket} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-8" style={{color: b.renk}}>{b.etiket}</span>
                  <div className="flex-1">
                    <OlcekCubugu oran={b.deger === null ? null : seriCubukOrani(b.deger, olcek337)} renk={b.renk} kalinlik="h-3" dil={currentLanguage} />
                  </div>
                  <span className="text-xs text-gray-600 w-24 text-right">{b.deger === null ? '—' : fmtAna(b.deger,'full',0)}</span>
                </div>
              ))}
            </div>
            {/* O6 gereği ZORUNLU not: `kapsamDisi` = ₺0 / negatif tutarlı sipariş. */}
            <KapsamNotu sayaclar={{ tutarsiz: y337.bilinmeyen, kapsamDisi: y337.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'yüzdelik dilimlere ve ortalamaya dâhil değil' : 'excluded from the percentiles and the average'} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." + K16: "Ok." — HHI 0–10.000;
          1.500 / 2.500; TEK panel + "Cironun %X'i ilk 3 müşteriden". Bu dosyadaki 0–1 ölçekli, 0,25/0,10
          eşikli ikinci yoğunlaşma paneli KALDIRILDI (orkestratör O4); kalan tek panel GenelBloklar2.tsx
          (Gelir Konsantrasyon Endeksi). */}

      {reportsTab === 'genel' && orders.length >= 8 && (() => {
        // Gerçek ₺0 tutarlı sipariş bantlara girmez (eski `> 0` süzgeci — parite); tutarı okunamayan (NaN) listede kalır ve
        // bilinmeyen SAYILIR; negatif tutar yardımcıda kapsam dışı.
        const pozitifAday = satislar.filter(o => siparisTutari(o) !== 0);
        const sifir415 = satislar.length - pozitifAday.length;
        const k415 = kovayaYerlestir(pozitifAday, siparisTutari, TUTAR_BANTLARI);
        // Yardımcının değişmezi: Σ adet + bilinmeyen + kapsamDisi === liste uzunluğu → bantlara giren adet.
        const sayilan415 = pozitifAday.length - k415.bilinmeyen - k415.kapsamDisi;
        if (sayilan415 < TUTAR_BANDI_ASGARI) return null;
        const olcek415 = sayacOlcegi(k415.kovalar.map(k => k.adet));
        // En sık bant: beraberlikte İLK bant (eski kuralla aynı — `>` ile tek geçiş).
        let modal = k415.kovalar[0];
        for (const k of k415.kovalar) if (k.adet > modal.adet) modal = k;
        return (
          <div className="apple-card p-6">
            {/* O17: panel fatura süzgeci OLMADAN tüm siparişleri sayıyor → etiket "sipariş" (süzgeç eklenmedi — parite). */}
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Sipariş Tutarı Dağılımı' : 'Order Amount Distribution'}</h3>
            <p className="text-xs text-gray-500 mb-4">Most common range: <span className="font-bold text-[#ff4000]">{modal.etiket}</span> · {sayilan415} orders</p>
            <div className="flex items-end gap-3 h-20">
              {k415.kovalar.map((k, i) => (
                <div key={k.etiket} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-bold" style={{color: TUTAR_BANT_RENKLERI[i]}}>{k.adet}</span>
                  {/* Eski 60 px ölçek kabı; 4 px taban kalktı (adedi 0 olan bant boş). */}
                  <div className="w-full" style={{ height: '60px' }}>
                    <OlcekCubugu yon="dikey" oran={seriCubukOrani(k.adet, olcek415)} renk={TUTAR_BANT_RENKLERI[i]} koseSinifi="rounded-t-lg" dil={currentLanguage} />
                  </div>
                  <span className="text-[9px] text-gray-500 text-center">{k.etiket}</span>
                </div>
              ))}
            </div>
            {/* `sifir415` (₺0) ile yardımcının kapsam dışı (negatif) kümesi ayrık. */}
            <KapsamNotu sayaclar={{ tutarsiz: k415.bilinmeyen, kapsamDisi: sifir415 + k415.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).dagilima_dahil_degil} />
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // Build week × day grid for last 8 weeks — kayan 7-gün blokları (son 7×24 saat; takvim haftası DEĞİL — parite).
        // 8 haftadan eski ve gelecek tarihli kayıt `kapsamDisi` (gelecek tarihli sipariş eskiden ölçeği şişiriyordu).
        const simdi445 = new Date();
        const iz445 = haftaGunIzgarasi(satislar, ISI_HAFTA, simdi445, { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        // O21: AYNI pencere ve AYNI `simdi` — yalnız hücre adedi okunur.
        const dz445 = haftaGunIzgarasi(dovizliler, ISI_HAFTA, simdi445, { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        const hucreler445 = iz445.hucreler.flat();
        // Tepe hücre kısmiyse ölçek YOK → hücreler taralı "bilinmiyor".
        const olcek445 = olcekReferansi(hucreler445.map(h => tutarSatiri(h.ciro)));
        if (hucreler445.filter(h => ekranTutari(h.ciro) > 0).length < ISI_ASGARI_HUCRE) return null;
        const days351 = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        // Sayaç toplamı: hücrelerin tutarı okunamayan siparişleri (hücreler ayrık → çift sayım yok).
        const tutarsiz445 = hucreler445.reduce((s, h) => s + h.ciro.bilinmeyen, 0);
        // Sayaç toplamı: penceredeki dövizli sipariş (ikinci pencere tanımı yazılmadı, aynı yardımcı).
        const dovizli445 = dz445.hucreler.flat().reduce((s, h) => s + h.adet, 0);
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Haftalık Ciro Isı Haritası' : 'Weekly Revenue Heatmap'}</h3>
            <p className="text-xs text-gray-500 mb-3">Last 8 weeks · darker = more revenue</p>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-[300px]">
                <div className="flex flex-col gap-1 mr-1">
                  {days351.map(d => <span key={d} className="text-[9px] text-gray-400 h-5 flex items-center">{d}</span>)}
                </div>
                {/* O17: sol = en eski hafta, sağ = içinde bulunulan hafta ("8w ago … Now" altbilgisi artık doğru). */}
                {[...iz445.hucreler].reverse().map((hafta, wi) => (
                  <div key={wi} className="flex flex-col gap-1 flex-1">
                    {days351.map((gunAdi, di) => {
                      const hucre = hafta[di];
                      const ekran = ekranTutari(hucre.ciro);
                      const baslik = ekran > 0 ? paraYaz(ekran, { ondalik: 0 }) : (hucre.ciro.bilinmeyen > 0 ? '—' : '');
                      const oran = cubukOrani(tutarSatiri(hucre.ciro), olcek445);
                      if (oran === null) {
                        return (
                          <div key={gunAdi} className="h-5">
                            <OlcekCubugu yon="dikey" oran={null} koseSinifi="rounded-sm" title={baslik} dil={currentLanguage} />
                          </div>
                        );
                      }
                      const bg = oran === 0 ? '#f3f4f6'
                        : oran < ISI_ESIKLERI[0] ? '#bbf7d0'
                        : oran < ISI_ESIKLERI[1] ? '#4ade80'
                        : oran < ISI_ESIKLERI[2] ? '#16a34a'
                        : '#166534';
                      return <div key={gunAdi} className="h-5 rounded-sm" style={{background: bg}} title={baslik} />;
                    })}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                <span>8w ago</span><span>Now</span>
              </div>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz445, tarihsiz: iz445.tarihsiz, kapsamDisi: iz445.kapsamDisi }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'ısı haritasına girmedi' : 'not included in the heatmap'} />
            <KapsamNotu sayaclar={{ dovizli: dovizli445 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K-KALEM: kalem tutarı TEK okuyucudan (`kalemTutari`: netTutar → total → price × quantity); bilinmeyen 0 sayılmaz.
        const kalemler495 = satislar.flatMap(o => o.lineItems ?? []);
        // O22 (orkestratör; K13 "veri eklenebiliyorsa ver"): kalemde kategori alanı yok (hayalet) — kategori eşleşen stok kartından. Kartı bulunamayan / kartında kategori boş kalem anahtarsız sayılır, notta.
        const kategori495 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);
        // K21 (kullanıcı, 2026-09-24): "İlk N" paydası → "Tüm ciro". Yüzde paydası ilk 7 kategori değil TÜM kalem cirosu (kategorisiz kalemler dâhil).
        const s495 = segmentCirosu(kalemler495, kategori495, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });
        // Gerçek sıfır / negatif cirolu kategori gösterilmez (eski `> 0` süzgeci — parite); cirosu bilinmeyen ATILMAZ ('—' satırı).
        const gosterilen = s495.segmentler.filter(s => !(s.ciro <= 0)).slice(0, KATEGORI_N);
        if (gosterilen.length < KATEGORI_ASGARI) return null;
        const kalemsiz495 = satislar.filter(o => (o.lineItems ?? []).length === 0).length;
        // Anahtarsız kalemin iki ayrık nedeni (toplamları yardımcının anahtarsız adedine eşit — o ayrıca basılmaz):
        // kart YOK ↔ kart var, kategorisi boş. `kartBul` saf ve aynı listeyle çağrılır → üç sayım aynı eşlemeyi görür.
        const eslesmeyen495 = kalemler495.filter(li => kartBul(li) === null).length;
        const kategorisiz495 = kalemler495.filter(li => { const k = kartBul(li); return k !== null && doluMetin(k.category) === null; }).length;
        const olcek495 = olcekReferansi(gosterilen.map(s => ({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz })));
        const colors361 = ['#6366f1','#3b82f6','#10b981','#f59e0b','#f97316','#ef4444','#8b5cf6'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Ürün Kategorisine Göre Ciro' : 'Revenue by Product Category'}</h3>
            <p className="text-xs text-gray-500 mb-4">Line-item revenue share · Total: {fmtAna(s495.toplam,'full',0)}</p>
            <div className="space-y-2">
              {gosterilen.map((s, i) => (
                <div key={s.anahtar} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-28 truncate">{s.anahtar}</span>
                  <div className="flex-1">
                    <OlcekCubugu oran={cubukOrani({ ciro: s.ciro, tutarsizSiparis: s.tutarsiz }, olcek495)} renk={colors361[i % colors361.length]} kalinlik="h-4" dil={currentLanguage} />
                  </div>
                  {/* Tek kalemin tutarı bilinmiyorsa TÜM yüzdeler '—' (yardımcının kuralı — eksik paydadan pay üretilmez). */}
                  <span className="text-[10px] text-gray-400 w-8 text-right">{yuzdeYaz(s.yuzde, 0, dil)}</span>
                  <span className="text-xs font-bold w-24 text-right" style={{color: colors361[i % colors361.length]}}>{fmtAna(s.ciro,'full',0)}</span>
                </div>
              ))}
            </div>
            {/* `tutarsiz` burada KALEM sayar; not modülü bu sayaçta `kalem` birimine izin vermez → nötr `kayit`. `kalemsiz` (sipariş) ve `eslesmeyen` (kalem) birimleri sabit. */}
            <KapsamNotu sayaclar={{ tutarsiz: s495.tutarsiz, kalemsiz: kalemsiz495, eslesmeyen: eslesmeyen495 }} birim="kayit" dil={currentLanguage} />
            {kategorisiz495 > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${kategorisiz495} kalemin stok kartında kategori girilmemiş — kategori satırlarına girmedi, toplamda var` : `${kategorisiz495} line item(s) have no category on their stock card — not shown as a row, included in the total`}</p>
            )}
            <KapsamNotu sayaclar={{ dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
            {/* K-KALEM dipnotu (GB1 ile AYNI kapı ve cümle): yalnız `total` yolu en az bir kalemde kullanıldıysa. */}
            {kdvDahilKalemVar(satislar) && (
              <p className="text-[10px] text-gray-400 mt-1">{rc(currentLanguage).mikro_faturasindan_tureyen_kalemlerde_satir_tuta}</p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 7 && (() => {
        // O16: "Ciro Süreklilik" adı SİPARİŞ VARLIĞINI ölçer (tutarı bilinmeyen sipariş de günü aktif sayar) — davranış parite.
        // O21: panel tutar okumaz → `iptalsiz` (dövizli sipariş de satıştır, günü aktif sayar; dövizli notu YOK). K2: iptal
        // edilmiş siparişin günü aktif SAYILMAZ. Mevcut seri (bugün sipariş yoksa 0), en uzun seri (tek aktif gün = 1 — O17)
        // ve son 30 günün varlığı yardımcıda; tarih kuralı `createdAt` parite için AÇIKÇA verilir.
        const s528 = aktifGunSerisi(iptalsiz, new Date(), SERI_SON_GUN, o => o.createdAt);
        if (s528.aktifGun < SERI_ASGARI_GUN) return null;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-1" title={currentLanguage === 'tr' ? 'Aktif gün: en az bir sipariş olan gün (sipariş varlığı; tutar aranmaz)' : 'Active day: a day with at least one order (order presence; amount not required)'}>{currentLanguage === 'tr' ? 'Ciro Süreklilik Serisi' : 'Revenue Activity Streak'}</h3>
            <div className="flex gap-6 mb-4">
              <div className="text-center"><p className="text-2xl font-black text-[#ff4000]">{s528.mevcutSeri}</p><p className="text-[10px] text-gray-400">current streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-indigo-600">{s528.enUzunSeri}</p><p className="text-[10px] text-gray-400">longest streak</p></div>
              <div className="text-center"><p className="text-2xl font-black text-gray-700">{s528.aktifGun}</p><p className="text-[10px] text-gray-400">active days total</p></div>
            </div>
            <p className="text-[10px] text-gray-400 mb-1">Last 30 days</p>
            <div className="flex gap-0.5 flex-wrap">
              {s528.sonGunler.map(g => (
                <div key={g.anahtar} className={`w-4 h-4 rounded-sm ${g.aktif ? 'bg-[#ff4000]' : 'bg-gray-100'}`} />
              ))}
            </div>
            <KapsamNotu sayaclar={{ tarihsiz: s528.tarihsiz }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}
    </>
  );
}
