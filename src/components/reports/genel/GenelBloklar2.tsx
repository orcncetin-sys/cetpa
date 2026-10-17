/**
 * GenelBloklar2.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 927–1462).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * ## 6c bağlaması (2026-10-17) — on panel testli yardımcılara bağlandı
 *
 * Satır içi sahte kesinlik (bilinmeyen tutarı ₺0 sayan toplamlar, elle HHI ve gömülü eşikleri, uydurma maliyet
 * oranı, uydurma stok eşiği, hayalet çubuk tabanları) testli yardımcılara bağlandı; kural ve sayaçlar o
 * modüllerde, burada yalnız çağrı + ekran + "neyin dışarıda kaldığı" notu (`KapsamNotu`) var. Panel kapıları
 * (`reportsTab === 'genel' && orders.length >= N …`) DOKUNULMADI.
 * Kullanıcı kararları (KARARLAR.md / PLAN-v2 §8) ilgili panelde kullanıcının cümlesiyle yazılıdır: K2, K4, K9, K10,
 * K13, K14, K15, K16, K20, K21, K23, K24, K28, K-YÜZDE. Orkestratör kararları (teknik seçim — kullanıcı kararı
 * DEĞİL; 6c/ORKESTRATOR-KARARLARI.md): O3, O4, O5, O6, O7, O9, O10, O11, O14, O15, O16, O18, O20, O21, O24.
 *
 * 6c inceleme 1 (2026-10-17, orkestratör kararları; testi `genel/GenelBloklar2.test.tsx` çizerek): Finansal Sağlık «Inventory»
 * harfi kalemsiz sipariş varken verilmez (kısmi COGS); alacak tarafının dövizli satırı «Cetpa alacağı: » önekli (pencere
 * satırıyla aynı cümleydi); «eksik bileşen» adları arayüz dilinde (`eksikAdi` her öğede zorunlu); Ödeme Yöntemi Dağılımı
 * enum kodunu değil `siparisler/odemeYontemi.odemeYontemiEtiketi` metnini basar (OrdersPage rozetiyle aynı sözlük).
 *
 * AR Health eşikleri (0,5 × / 1 × aylık hız; aylık hız = pencere cirosu / 3) Mikro cari bakiyesi bu ekrana
 * bağlanınca geri gelir (açık iş, O18). Bugün AR harfi hesaplanmıyor; sabitleri tüketicisiz kalacağı için YAZILMADI.
 *
 * O16 gözlemleri — davranış ve ekran metni parite gereği DEĞİŞMEDİ, kod adı / yorum dürüstleşti; kullanıcıya
 * gözlem olarak bildirilir:
 *   1. Finansal Sağlık "Revenue Trend" harfi totolojidir: ciro > 0 ise A, değilse C; bir eğilim ölçmez.
 *   2. Aylık İlerleme "hedefin önünde / gerisinde" rozeti ≈ ayın geçen gün oranıdır (yalnız ayın son günü ▲).
 *   3. Finansal Sağlık / 360° "son 3 ay" penceresi 3 önceki ayın 1'inden bugüne uzanır (≈3–4 ay).
 *   4. Haftalık "Yıllık projeksiyon" içinde bulunulan (bitmemiş) haftanın cirosu × 52; WoW da bitmemiş haftayı
 *      tam haftayla kıyaslar.
 *   5. "YoY" yıl başından bugüne ↔ geçen yılın tamamıdır.
 */
import { type ReportsCtx, brutMarj } from '../useReportsData';
import { type Order } from '../../../types';
import { zamanDate, zamanMs, tarihYaz } from '../../../utils/zaman';
import { oc } from '../../../i18n/ortak';
import { rc } from '../../../i18n/rapor';
import { toplaBilinen, ekranTutari, tamTutar, tutarBirlestir, donemKarsilastir } from '../../../utils/para';
import { siparisIptalMi, siparisTutari } from '../../../utils/siparis';
import { tryDisiMi } from '../../../utils/siparisler/magazaSiparisi';
import { raporSiparisi, raporCirosu } from '../../../utils/pano/raporVeriKatmani';
import { siparisAni, donemCirosu, donemProjeksiyonu, hizDegisimi } from '../../../utils/pano/hedefButce';
import { yilAylikCiro, donemToplami } from '../../../utils/pano/ciroDonem';
import { tutarSatiri, olcekReferansi, cubukOrani } from '../../../utils/pano/cubuk';
import { yuzdeOrani, ortalamaSiparisTutari } from '../../../utils/pano/finansKpi';
import { degerToplami, dusukStokKalemleri } from '../../../utils/pano/stokSevkiyat';
import { segmentCirosu, odemeYontemiSegmenti, ODEME_YONTEMI_BELIRTILMEMIS } from '../../../utils/pano/musteriAnaliz';
import { odemeYontemiEtiketi, odemeYontemiMi } from '../../../utils/siparisler/odemeYontemi';
import { kartMaliyetiTL } from '../../../utils/cost';
import { cetpaAlacak } from '../../../utils/muhasebe/finansalOranlar';
import { musteriOzeti } from '../../../utils/rapor/musteri';
import { yogunlasma, HHI_ESIKLERI, type YogunlasmaSeviyesi } from '../../../utils/rapor/yogunlasma';
import { calisanDurumu } from '../../../utils/rapor/ikBordro';
import { zamanKovalari } from '../../../utils/rapor/zamanDagilimi';
import { bilesikSkor, esikBandi, type BantTanimi } from '../../../utils/rapor/skor';
import { yuzdeYaz } from '../../../utils/rapor/bicim';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'exchangeRates' | 'currentLanguage' | 'fmtAna' | 'leadCariKodu'>;

/* K20 — kullanıcı 2026-09-19: "ok kalsın." Gömülü eşik / pencere DEĞERLERİ aynen korunur, yalnız adlandırılır.
   K28 (PLAN-v2 §8 sıra 24) — dönem tanımları: parite + adlandırma (takvim haftası / ayı / yılı değişmez). */
type Harf = 'A' | 'B' | 'C' | 'D';
/** Haftalık Ciro — gösterilen TAKVİM haftası sayısı (bağlama öncesi `Array.from({ length: 8 })`). Pazar başı; KAYAN hafta DEĞİL (K28). */
const HAFTA_SAYISI = 8;
/** Haftalık Ciro — yıllık projeksiyon katsayısı (bağlama öncesi `lastWeek * 52`). O16: çarpılan hafta İÇİNDE BULUNULAN (henüz bitmemiş) takvim haftasıdır. */
const YIL_HAFTA = 52;
/** Finansal Sağlık / 360° — pencere başı "N önceki ayın 1'i" (bağlama öncesi `getMonth() - 3`). O16: içinde bulunulan ay DA dâhil (≈3–4 ay); ekran metni parite gereği "son 3 ay". */
const SON_AY_FARKI = 3;
/** Finansal Sağlık Gross Margin harf eşikleri (bağlama öncesi `grossMargin >= 30 ? 'A' …` üçlüsü; `esikBandi` altSinir DÂHİL → `>=` paritesi). */
const MARJ_HARF: readonly BantTanimi<Harf>[] = [
  { altSinir: 30, deger: 'A' }, { altSinir: 20, deger: 'B' }, { altSinir: 10, deger: 'C' }, { altSinir: -Infinity, deger: 'D' },
];
const STOK_A_KAT = 1.5;     // stok <= COGS × 1,5 → A (bağlama öncesi Inventory harfi üçlüsü)
const STOK_B_KAT = 2.5;     // stok <= COGS × 2,5 → B, aksi C
/** Finansal Sağlık genel not: ortalama puan bantları (bağlama öncesi `overallGrade` üçlüsü). Eski `Math.round`'lu hâliyle DENK:
 *  ortalama 0,25'in katıdır (4 bileşen × tam puan) ve `round(x) >= 3.5 ⟺ x >= 3.5` (2,5 ve 1,5 eşiğinde de) → yuvarlama gereksiz. */
const GENEL_HARF: readonly BantTanimi<Harf>[] = [
  { altSinir: 3.5, deger: 'A' }, { altSinir: 2.5, deger: 'B' }, { altSinir: 1.5, deger: 'C' }, { altSinir: -Infinity, deger: 'D' },
];
const HARF_PUANI: Record<Harf, number> = { A: 4, B: 3, C: 2, D: 1 };   // bağlama öncesi `(4 - i)`
/** HHI seviyesinin rozet / KPI renkleri (bağlama öncesi `hhiLevel` üçlüsünün üç kopyası tek tabloda). */
const HHI_SEVIYE_RENGI: Record<YogunlasmaSeviyesi, { rozet: string; kpi: string }> = {
  yuksek: { rozet: 'bg-red-100 text-red-700', kpi: 'text-red-500' },
  orta: { rozet: 'bg-amber-100 text-amber-700', kpi: 'text-amber-500' },
  dusuk: { rozet: 'bg-emerald-100 text-emerald-700', kpi: 'text-emerald-600' },
};

export default function GenelBloklar2({ reportsTab, orders, inventory, employees, exchangeRates, currentLanguage, fmtAna, leadCariKodu }: Props) {
  // Bugünkü kod her render'da hesaplıyordu → aşağıdakiler de düz `const` (hook YOK — parite).
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  const bugun = new Date();
  // O21 (orkestratör; K23 ilkesi "dövizli TL'ye TOPLANMAZ, ayrı sayılır", emsal lojistikKpi.ihracatToplami): TRY dışı mağaza
  // siparişi (dovizTutar + paraBirimi, totalPrice YOK) BOZUK VERİ DEĞİLDİR → TL ciroya, paya, paydaya ve `bilinmeyen` sayacına
  // GİRMEZ; her panelde KENDİ penceresiyle ayrı sayılır (KapsamNotu `dovizli`). Süzgeç ÇAĞIRANDA — yardımcı imzaları değişmez.
  // Aynı kümeden türeyen ADETLER (sipariş / müşteri sayısı) de TL kümesindendir; tutar okumayan 360° "işleme bekliyor" sayacı hariç.
  const tlSiparisler = orders.filter(o => !tryDisiMi(o));
  const dovizliler = orders.filter(tryDisiMi);
  // K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." Tek kural: siparisIptalMi (raporCirosu ile aynı).
  const iptalsiz = tlSiparisler.filter(o => !siparisIptalMi(o));
  const dovizliIptalsiz = dovizliler.filter(o => !siparisIptalMi(o));
  // K4 — kullanıcı: "kimlikle". useReportsData musteriListesi ve GenelBloklar3 musteriSecenek ile AYNI seçenek (tek tanım).
  // O5: leadCariKodu GenelRapor.tsx'ten gelir (verilmezse Cetpa kaydı ile Mikro carisi BİRLEŞTİRİLMEZ).
  const musteriSecenek = { tutarSec: raporSiparisi, tarihSec: (o: Order) => zamanMs(o.createdAt), leadCariKodu };
  // Finansal Sağlık + 360° ORTAK pencere (bağlama öncesi iki panelde BİREBİR kopya). O16: "SON_AY_FARKI önceki ayın 1'i → bugün";
  // içinde bulunulan ay dâhil olduğu için ≈3–4 aydır — ekrandaki "son 3 ay" metni parite gereği değişmedi.
  const pencereBas = new Date(bugun.getFullYear(), bugun.getMonth() - SON_AY_FARKI, 1);
  const penceredeMi = (o: Order): boolean => { const od = zamanDate(o.createdAt); return od !== null && od >= pencereBas; };
  const pencereSiparisleri = iptalsiz.filter(penceredeMi);
  const pencereCirosu = raporCirosu(pencereSiparisleri);
  const pencereDovizli = dovizliIptalsiz.filter(penceredeMi).length;   // O21 — Finansal Sağlık ve 360° notu; AYNI yüklem
  // K8 ara durum: taban kartMaliyetiTL (parite; bağlama öncesi iki panelde BİREBİR kopya). Stoğu ya da maliyeti bilinmeyen kart 0 DEĞİL → `bilinmeyen`.
  const stokDegeri = degerToplami(inventory, i => kartMaliyetiTL(i, exchangeRates));
  // `degerToplami.bilinmeyen` stoğu YA DA maliyeti bilinmeyen kartı sayar → KapsamNotu'nun `maliyetsiz` kalıbı ("maliyeti bilinmiyor")
  // yanlış neden söylerdi; tek cümle, iki panelde aynı metin.
  const stokDegeriNotu = stokDegeri.bilinmeyen > 0
    ? (currentLanguage === 'tr'
        ? `${stokDegeri.bilinmeyen} ürünün stok miktarı ya da maliyeti bilinmiyor — stok değerine dâhil değil`
        : `${stokDegeri.bilinmeyen} product(s) with unknown stock level or cost — excluded from stock value`)
    : null;

  return (
    <>
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K14 kullanıcı: "kaldır" — HHI çiftinden bu panel KALIR (testli `yogunlasma`'ya bağlı); GenelBloklar4'teki ikizi kalkar (O4).
        // K4 — kullanıcı: "kimlikle" · K2 — iptaller hariç (iptalsiz) · O5: gruplama ÇAĞIRANDA (musteriOzeti), yogunlasma satır kurmaz.
        const mo220 = musteriOzeti(iptalsiz, musteriSecenek);
        // K16 kullanıcı 2026-09-19: "Ok." — 0–10.000; 1.500 / 2.500; tek panel + "Cironun %X'i ilk 3 müşteriden" (KARARLAR.md)
        // O4 (orkestratör): müşteriye bağlanamayan ciro HHI'ya girmez (not olur), ilk-3 paydasında KALIR (K21 kullanıcı: "Tüm ciro").
        // HHI = sum of (market share %)^2 — normalized 0-10000 (formül ve seviye sınırları util içinde; eşik dipnotu HHI_ESIKLERI'nden).
        const y220 = yogunlasma(mo220.musteriler, m => m.ciro, { atfedilemeyen: mo220.kimliksizCiro });
        if (y220.neden === 'payda-yok') return null;                     // sipariş yok ya da tüm ciro GERÇEK ₺0 (bağlama öncesi `total === 0` kapısının paritesi)
        const hhi220 = y220.hhi === null ? null : Math.round(y220.hhi);
        const tamSayiYaz = (n: number): string => n.toLocaleString(dil === 'tr' ? 'tr-TR' : 'en-US');
        const [ortaEsik, yuksekEsik] = HHI_ESIKLERI;
        // O6 (orkestratör, K23 ilkesi — kullanıcı: "Önerin ok. Sorunun cevabı dediğin gibi olacak." / "girilmeyen hesaba katılmaz + not"):
        // cirosu TAM bilinen müşterilerin ortalaması; tam bilinmeyen müşteri ayrı notta sayılır.
        const cm220 = toplaBilinen(mo220.musteriler, m => tamTutar(m.ciro));
        const ort220 = cm220.bilinen > 0 ? cm220.toplam / cm220.bilinen : NaN;
        // HHI kurulamadıysa TEK neden yazılır ('payda-yok' yukarıda paneli gizledi).
        const neden220 = y220.neden === 'payda-bilinmiyor'
          ? (currentLanguage === 'tr' ? 'Endeks hesaplanmadı: tutarı okunamayan sipariş var.' : 'Index not computed: some order amounts are unreadable.')
          : y220.neden === 'negatif-pay'
            ? (currentLanguage === 'tr' ? 'Endeks hesaplanmadı: bir müşterinin net cirosu negatif.' : 'Index not computed: a customer has negative net revenue.')
            : y220.neden === 'atfedilebilen-yok'
              ? (currentLanguage === 'tr' ? 'Endeks hesaplanmadı: müşteriye bağlanabilen ciro yok.' : 'Index not computed: no revenue could be attributed to a customer.')
              : null;
        const durum220 = hhi220 !== null && y220.seviye !== null
          ? (currentLanguage === 'tr'
              ? ` Şu an: ${tamSayiYaz(hhi220)} — ${y220.seviye === 'dusuk' ? 'müşteri tabanı sağlıklı dağılmış.' : y220.seviye === 'orta' ? 'birkaç müşteriye bağımlılık var.' : 'kritik müşteri bağımlılığı!'}`
              : ` Currently: ${tamSayiYaz(hhi220)} — ${y220.seviye === 'dusuk' ? 'healthy diversification.' : y220.seviye === 'orta' ? 'moderate concentration.' : 'critical dependency!'}`)
          : neden220 === null ? '' : ` ${neden220}`;
        // K16 kullanıcı: "Cironun %X'i ilk 3 müşteriden" — O4: ek sayıya göre değiştiği için (%40'ı / %50'si) ekran metni eksiz.
        // Sayı `y220.ilkN`'den: 3'ten az müşteride "ilk 3" YAZILMAZ; `null` → '—' ve `%` işaretini yuzdeYaz basar (K-YÜZDE).
        const ilkNMetni220 = currentLanguage === 'tr'
          ? `Cironun ilk ${y220.ilkN} müşteriden gelen payı: ${yuzdeYaz(y220.ilk3Pay, 1, dil)}`
          : `Share of revenue from top ${y220.ilkN} customers: ${yuzdeYaz(y220.ilk3Pay, 1, dil)}`;
        // O4 kimliksiz notu; tutarı bilinmiyorsa ₺X eki düşer ama SAYAÇ kalır (K4 kullanıcı: "ikisi de yoksa 'kimliksiz N sipariş' NOTU").
        const kimliksizSonuc220 = y220.endeksDisiCiro === null ? undefined : `${fmtAna(y220.endeksDisiCiro, 'full', 0)} · ${rc(currentLanguage).endekse_dahil_degil}`;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📐 Gelir Konsantrasyon Endeksi (HHI)' : '📐 Revenue Concentration Index (HHI)'}</h3>
              {y220.seviye !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${HHI_SEVIYE_RENGI[y220.seviye].rozet}`}>
                  {y220.seviye === 'yuksek' ? (oc(currentLanguage).yuksek_risk) : y220.seviye === 'orta' ? (oc(currentLanguage).orta_risk) : (currentLanguage === 'tr' ? 'Düşük Risk' : 'Diversified')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'HHI', value: hhi220 === null ? '—' : tamSayiYaz(hhi220), color: y220.seviye === null ? 'text-gray-400' : HHI_SEVIYE_RENGI[y220.seviye].kpi, desc: currentLanguage === 'tr' ? 'Herfindahl Endeksi' : 'Herfindahl Index' },
                { label: oc(currentLanguage).musteri_sayisi, value: String(mo220.musteriler.length), color: 'text-blue-600', desc: currentLanguage === 'tr' ? 'Toplam aktif' : 'Total active' },
                { label: currentLanguage === 'tr' ? 'Müşteri Başı' : 'Avg per Customer', value: fmtAna(ort220, 'K', 0), color: 'text-gray-700', desc: currentLanguage === 'tr' ? 'Ort. gelir' : 'Avg revenue' },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-gray-600 font-medium mt-0.5">{k.label}</p>
                  <p className="text-[9px] text-gray-400">{k.desc}</p>
                </div>
              ))}
            </div>
            {y220.ilkN > 0 && <p className="text-xs text-gray-600 mb-3">{ilkNMetni220}</p>}
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500">💡</span>
              <p className="text-[11px] text-blue-700">
                {currentLanguage === 'tr'
                  ? `HHI > ${tamSayiYaz(yuksekEsik)} yüksek, ${tamSayiYaz(ortaEsik)}–${tamSayiYaz(yuksekEsik)} orta, < ${tamSayiYaz(ortaEsik)} düşük konsantrasyon.${durum220}`
                  : `HHI > ${tamSayiYaz(yuksekEsik)} concentrated, ${tamSayiYaz(ortaEsik)}–${tamSayiYaz(yuksekEsik)} moderate, < ${tamSayiYaz(ortaEsik)} diversified.${durum220}`}
              </p>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: y220.toplam.bilinmeyen, dovizli: dovizliIptalsiz.length }} birim="siparis" dil={currentLanguage} />
            <KapsamNotu sayaclar={{ kimliksiz: mo220.kimliksiz }} birim="siparis" dil={currentLanguage} sonuc={kimliksizSonuc220} />
            {cm220.bilinmeyen > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                {currentLanguage === 'tr'
                  ? `${cm220.bilinmeyen} müşterinin cirosu tam bilinmiyor — müşteri başı ortalamaya girmedi`
                  : `${cm220.bilinmeyen} customer(s) with incomplete revenue — excluded from the per-customer average`}
              </p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now222 = new Date();
        void now222;
        // O21: durum kümeleri TL siparişlerden; durum yüklemi TEK yerde (dövizli sayaç aynı yüklemle). İptal zaten seçilmiyor.
        const birikimde = (o: Order): boolean => o.status === 'Pending' || o.status === 'Processing';
        const kargoda = (o: Order): boolean => o.status === 'Shipped';
        const backlogOrders = tlSiparisler.filter(birikimde);
        const shippedOrders = tlSiparisler.filter(kargoda);
        const dvz222 = dovizliler.filter(o => birikimde(o) || kargoda(o)).length;
        const birikim222 = toplaBilinen(backlogOrders, siparisTutari);
        const kargo222 = toplaBilinen(shippedOrders, siparisTutari);
        const toplam222 = tutarBirlestir(birikim222, kargo222);   // iki durum kümesi AYRIK → sayaçlar benzersiz
        // Gerçekten veri yokken (sipariş yok ya da bilinen toplam GERÇEK ₺0) panel çizilmez; tutarı okunamayan sipariş varsa panel KALIR.
        if (backlogOrders.length + shippedOrders.length === 0 || (toplam222.bilinmeyen === 0 && toplam222.toplam === 0)) return null;
        // Pay TÜRETMEDİR: iki taraf da tam bilinmiyorsa çubuk ÇİZİLMEZ (yuzdeOrani = bağlama öncesi Math.round(pay/payda×100)).
        const pb222 = yuzdeOrani(tamTutar(birikim222), tamTutar(toplam222));
        const pk222 = yuzdeOrani(tamTutar(kargo222), tamTutar(toplam222));
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📋 Sipariş Biriktirme & Boru Hattı Değeri' : '📋 Order Backlog & Pipeline Value'}</h3>
              <span className="text-sm font-black text-blue-600">{fmtAna(ekranTutari(toplam222),'K',0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {[
                { label: currentLanguage === 'tr' ? 'Sipariş Birikimi' : 'Order Backlog', count: backlogOrders.length, value: ekranTutari(birikim222), color: 'text-amber-600', bg: 'bg-amber-50', icon: '⏳' },
                { label: oc(currentLanguage).kargoda, count: shippedOrders.length, value: ekranTutari(kargo222), color: 'text-blue-600', bg: 'bg-blue-50', icon: '🚚' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-2xl p-4`}>
                  <p className="text-xl mb-1">{k.icon}</p>
                  <p className={`text-2xl font-black ${k.color}`}>{fmtAna(k.value,'K',0)}</p>
                  <p className="text-xs text-gray-600 font-medium mt-1">{k.label}</p>
                  <p className="text-[10px] text-gray-400">{k.count} {oc(currentLanguage).siparis}</p>
                </div>
              ))}
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex">
              {pb222 !== null && pk222 !== null && (
                <>
                  <div className="h-full bg-amber-400" style={{ width: `${pb222}%` }} />
                  <div className="h-full bg-blue-400" style={{ width: `${pk222}%` }} />
                </>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'İşlenmemiş ve kargodaki siparişlerin toplam değeri' : 'Total value of unprocessed and in-transit orders'}</p>
            <KapsamNotu sayaclar={{ tutarsiz: toplam222.bilinmeyen, dovizli: dvz222 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now225 = new Date();
        const monthStart225 = new Date(now225.getFullYear(), now225.getMonth(), 1);
        const daysInMonth = new Date(now225.getFullYear(), now225.getMonth() + 1, 0).getDate();
        const dayOfMonth = now225.getDate();
        const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);
        // K28: takvim ayı, yalnız createdAt (siparisAni(o, false) = zamanDate(o.createdAt) — bağlama öncesi kural). Aynı süzgecin
        // üç kopyası TEK yükleme indi; ciro testli pencereden (iptal hariç, üst sınır YOK). O21: girdi TL siparişler.
        // DEĞİŞMEZ: p225.ciro.bilinen + p225.ciro.bilinmeyen === buAy225.length (iki taraf da aynı TL kümesinden).
        const buAyMi225 = (o: Order): boolean => { const od = siparisAni(o, false); return od !== null && od >= monthStart225; };
        const buAy225 = iptalsiz.filter(buAyMi225);
        const p225 = donemCirosu(tlSiparisler, monthStart225, null, false);
        const dvz225 = dovizliIptalsiz.filter(buAyMi225).length;
        // K4 — kullanıcı: "kimlikle" (eski ad kümesi boş adlı siparişleri tek '—' müşterisinde topluyordu).
        const mo225 = musteriOzeti(buAy225, musteriSecenek);
        // Pace = what we'd expect at current run rate by end of month
        // O9: hız kuralı TEK yerde (donemProjeksiyonu → satisHizi); kısmi ciroda projeksiyon YOK (null → '—'). Yuvarlama çağıranda.
        const yuvarla = (p: number | null): number | null => (p === null ? null : Math.round(p));
        const ciroPj225 = yuvarla(donemProjeksiyonu(p225.ciro, dayOfMonth, daysInMonth).projeksiyon);
        const goals: { label: string; current: number; pace: number | null; icon: string; format: (v: number | null) => string }[] = [
          { label: oc(currentLanguage).aylik_ciro, current: ekranTutari(p225.ciro), pace: ciroPj225, icon: '💰', format: v => (v === null ? '—' : fmtAna(v, 'K', 0)) },
          // Adet bilinen sayıdır (her sipariş 1 → bilinmeyen sayacı sıfır); hız kuralı elle üçüncü kez yazılmaz.
          { label: oc(currentLanguage).siparis_adedi, current: buAy225.length, pace: yuvarla(donemProjeksiyonu(toplaBilinen(buAy225, () => 1), dayOfMonth, daysInMonth).projeksiyon), icon: '📦', format: v => (v === null ? '—' : String(v)) },
          // Kimliksiz sipariş varken müşteri sayısı alt sınırdır → projeksiyon TÜRETİLMEZ.
          { label: oc(currentLanguage).aktif_musteri, current: mo225.musteriler.length, pace: mo225.kimliksiz === 0 ? yuvarla(donemProjeksiyonu(toplaBilinen(mo225.musteriler, () => 1), dayOfMonth, daysInMonth).projeksiyon) : null, icon: '👥', format: v => (v === null ? '—' : String(v)) },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🎯 Aylık İlerleme Göstergesi' : '🎯 Monthly Goal Progress'}</h3>
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {currentLanguage === 'tr' ? `Ay: %${monthProgress} tamamlandı (${dayOfMonth}/${daysInMonth} gün)` : `Month: ${monthProgress}% complete (day ${dayOfMonth}/${daysInMonth})`}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${monthProgress}%` }} />
            </div>
            <div className="space-y-4">
              {goals.map(g => {
                // Bu oran ≈ ayın geçen gün oranıdır (current / (current/gün × ayGünü) = gün/ayGünü); bir HEDEF kıyası değildir.
                // Formül parite gereği değişmedi (O16) — kullanıcıya gözlem olarak bildirildi. Payda ≤ 0 / bilinmiyor → null
                // (eski uydurma «1» paydası kalktı — O15): rozet ve renkli çubuk ÇİZİLMEZ, mavi gün çizgisi kalır.
                const projeksiyonaOran = g.pace === null ? null : yuzdeOrani(g.current, g.pace);
                const isAhead = projeksiyonaOran !== null && projeksiyonaOran >= 100;
                return (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span>{g.icon}</span>
                        <span className="text-xs font-medium text-gray-700">{g.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-gray-700 font-bold">{g.format(g.current)}</span>
                        <span className="text-[10px] text-gray-400">→ {g.format(g.pace)} {currentLanguage === 'tr' ? 'tahmini' : 'projected'}</span>
                        {projeksiyonaOran !== null && (
                          <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${isAhead ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {isAhead ? '▲' : '▼'} {yuzdeYaz(Math.abs(projeksiyonaOran - 100), 0, dil)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      {projeksiyonaOran !== null && (
                        <div className={`h-full rounded-full ${isAhead ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(projeksiyonaOran, 100)}%` }} />
                      )}
                      <div className="absolute top-0 h-full w-px bg-blue-400 opacity-60" style={{ left: `${monthProgress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: p225.ciro.bilinmeyen, tarihsiz: p225.tarihsiz, kimliksiz: mo225.kimliksiz, dovizli: dvz225 }} birim="siparis" dil={currentLanguage} />
            <p className="text-[10px] text-gray-400 mt-3">{currentLanguage === 'tr' ? 'Mavi çizgi = ayın şu anki günü. Yeşil = hedefin önünde, Sarı = hedefin gerisinde.' : 'Blue line = current day in month. Green = ahead of pace, Amber = behind pace.'}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        const now234 = new Date();
        // Last 8 weeks — K28: TAKVİM haftası (Pazar başı) KALIR; hedefButce.haftalikCiro (KAYAN hafta) KULLANILMAZ.
        // Hafta sınırları bağlama öncesiyle AYNI (`(8 - 1 - i) * 7` geri + getDay() → Pazar; HAFTA_SAYISI = 8).
        const haftalar234 = Array.from({ length: HAFTA_SAYISI }, (_, i) => {
          const weekStart = new Date(now234);
          weekStart.setDate(weekStart.getDate() - (HAFTA_SAYISI - 1 - i) * 7 - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
          const label = `W${tarihYaz(weekStart, { month: 'short', day: 'numeric' }, currentLanguage === 'tr' ? 'tr' : 'en')}`;
          return { label, bas: weekStart, son: weekEnd };
        });
        // Tek geçiş: 8 ayrı süzgeç yerine kovalar. Tarih AÇIKÇA createdAt (bağlama öncesi kural; varsayılan createdAt ?? syncedAt DEĞİL).
        // -1 (8 haftadan eski) → kapsamDisi; pencere tanımı gereği dışarıdadır, veri kusuru değil → notta BASILMAZ.
        const haftaIndeksi234 = (d: Date): number => haftalar234.findIndex(h => d >= h.bas && d <= h.son);
        const k234 = zamanKovalari(iptalsiz, HAFTA_SAYISI, haftaIndeksi234, { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
        // O21: AYNI indeks işlevi (zamanKovalari da zamanDate(tarihSec(o)) okur).
        const dvz234 = dovizliIptalsiz.filter(o => { const d = zamanDate(o.createdAt); return d !== null && haftaIndeksi234(d) >= 0; }).length;
        // Bilinen pozitif hafta YA DA tutarı bilinmeyen kayıt varsa panel çizilir (tümü okunamayınca sessizce kaybolmaz).
        if (!k234.kovalar.some(k => k.ciro.toplam > 0 || k.ciro.bilinmeyen > 0)) return null;
        // O15: eski `, 1` uydurma ölçek tabanı kalktı — tepe hafta kısmiyse ölçek YOK → çubuklar taralı.
        const olcek234 = olcekReferansi(k234.kovalar.map(k => tutarSatiri(k.ciro)));
        const son234 = k234.kovalar[HAFTA_SAYISI - 1].ciro, onceki234 = k234.kovalar[HAFTA_SAYISI - 2].ciro;
        const wow234 = donemKarsilastir(son234, onceki234);
        // O9: argümanlar (son234, 1, YIL_HAFTA) — birim HAFTA ("geçen 1 hafta → 52 hafta"; x / 1 × 52 === x × 52). Kısmi son hafta → null.
        // O16: son234 İÇİNDE BULUNULAN (henüz bitmemiş) takvim haftasıdır; '× 52' bu yüzden hafta başında düşük okur. Formül ve
        // 'Yıllık projeksiyon' etiketi parite gereği değişmedi — kullanıcıya gözlem.
        const yillik234 = donemProjeksiyonu(son234, 1, YIL_HAFTA).projeksiyon;
        const toplam234 = tutarBirlestir(...k234.kovalar.map(k => k.ciro));   // haftalar kesişmez → sayaç benzersiz
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Haftalık Ciro & Yıllık Projeksiyon' : '📅 Weekly Revenue & Annual Run Rate'}</h3>
              {wow234.yuzde !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${wow234.yon === 'artis' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {wow234.yon === 'artis' ? '↑' : '↓'} {`${yuzdeYaz(Math.abs(wow234.yuzde), 0, dil)} WoW`}
                </span>
              )}
            </div>
            <div className="flex items-end gap-1.5 h-24 mb-3">
              {k234.kovalar.map((k, i) => {
                const isLatest = i === HAFTA_SAYISI - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end" style={{ height: '68px' }}>
                      <OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(k.ciro), olcek234)} renkSinifi={isLatest ? 'bg-brand' : 'bg-gray-200'} koseSinifi="rounded-t-md" dil={currentLanguage} />
                    </div>
                    <span className={`text-[8px] leading-none ${isLatest ? 'font-bold text-brand' : 'text-gray-400'}`}>{haftalar234[i].label}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-gray-700">{fmtAna(ekranTutari(son234),'K',0)}</p>
                <p className="text-[10px] text-gray-400">{oc(currentLanguage).bu_hafta}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xl font-black text-blue-600">{yillik234 === null ? '—' : fmtAna(yillik234,'K',0)}</p>
                <p className="text-[10px] text-gray-400">{currentLanguage === 'tr' ? 'Yıllık projeksiyon' : 'Annual run rate'}</p>
              </div>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: toplam234.bilinmeyen, tarihsiz: k234.tarihsiz, dovizli: dvz234 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now235 = new Date();
        const prevMonthStart235 = new Date(now235.getFullYear(), now235.getMonth() - 1, 1);
        const prevMonthEnd235 = new Date(now235.getFullYear(), now235.getMonth(), 0, 23, 59, 59);
        const currMonthStart235 = new Date(now235.getFullYear(), now235.getMonth(), 1);
        // Ortak brutMarj (2026-09-04): kalemi olmayan siparis kapsam disidir,
        // aksi halde maliyet 0 sayilip marj %100'e sisiyordu.
        const calcMargin = (ordersList: Order[]) => {
          const m = brutMarj(ordersList, inventory, exchangeRates);
          // `gross` ARTIK `m.brutKar` (2026-09-19 delta bulgusu): eski `m.ciro - m.maliyet`
          // KISMİ cirodan TAM maliyeti çıkarıyordu. `brutKar` iki taraf da tam bilinmiyorsa
          // NaN döner; köprü zaten `margin === null` dalında çizilmiyor, ama formülün kendisi
          // de artık asimetrik değil.
          // `tutarsiz`: kapsamdaki siparişlerden kaçının TUTARI ya da MALİYETİ okunamadı —
          // BENZERSİZ sayaç (`raporMarj.tutarsizSiparis`). İki sayacı TOPLAMAK, aynı `kapsamli`
          // kümesinden çıktıkları için kesişimi iki kez sayıyordu: tutarı da maliyeti de
          // okunamayan tek sipariş ekrana "2 sipariş" diye basılıyordu (2026-09-19 delta bulgusu;
          // aynı arıza `finansKpi.nakitPozisyonu`da Phase 130'da Set ile kapatılmıştı).
          // `adet` (6c): kapsamdaki (kalemli) sipariş sayısı — "iki ayda da sipariş yok" kapısı için.
          return {
            rev: m.ciro, cogs: m.maliyet, margin: m.marj, gross: m.brutKar,
            kapsamDisi: m.kapsamDisi, tutarsiz: m.tutarsizSiparis, adet: m.ciroTutar.bilinen + m.ciroTutar.bilinmeyen,
          };
        };
        // K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." Tek tanım: `iptalsiz` (TL veride rakam DEĞİŞMEZ).
        // O21: dövizli sayaç AYNI pencereyle (`liste` parametresi) — pencere ikinci kez yazılmaz.
        const filterOrders = (start: Date, end: Date, liste: readonly Order[] = iptalsiz) => liste.filter(o => {
          const od = zamanDate(o.createdAt);
          return od !== null && od >= start && od <= end;
        });
        const prev235 = calcMargin(filterOrders(prevMonthStart235, prevMonthEnd235));
        const curr235 = calcMargin(filterOrders(currMonthStart235, new Date()));
        const dvz235 = filterOrders(prevMonthStart235, prevMonthEnd235, dovizliIptalsiz).length + filterOrders(currMonthStart235, new Date(), dovizliIptalsiz).length;   // iki ay AYRIK
        // İki ayda da hiç sipariş yoksa ya da ciro GERÇEKTEN ₺0 ise panel çizilmez; aksi hâlde (tutarı okunamayan sipariş dâhil)
        // aşağıdaki açıklama dalı devralır.
        const bosAy = (a: typeof prev235) => a.adet === 0 && a.kapsamDisi === 0;
        if ((bosAy(prev235) || (prev235.tutarsiz === 0 && prev235.rev === 0)) && (bosAy(curr235) || (curr235.tutarsiz === 0 && curr235.rev === 0))) return null;
        // O21: dövizli sipariş iki dalda da dışarıdadır (bağlama öncesi tutarsız sayılıp köprüyü "kurulamadı" dalına itiyordu).
        const dovizliNotu235 = <KapsamNotu sayaclar={{ dovizli: dvz235 }} birim="siparis" dil={currentLanguage} />;
        // Marj koprusu iki ayin da marjini BILMEYI gerektirir. Kalem verisi olmayan
        // (Mikro turevi) siparislerden olusan bir ayda marj null'dur — o durumda uydurma
        // bir "etki" ayristirmasi YAPILMAZ. 2026-09-19 hakem turu: panel eskiden sessizce
        // KAYBOLUYORDU; kullanici ne eksik oldugunu goremiyordu. Artik NEDENI yaziliyor.
        if (prev235.margin === null || curr235.margin === null) {
          const tutarsiz235 = prev235.tutarsiz + curr235.tutarsiz;
          const kapsamDisi235 = prev235.kapsamDisi + curr235.kapsamDisi;
          return (
            <div className="apple-card p-6">
              <h3 className="font-bold text-gray-800 mb-2">{currentLanguage === 'tr' ? '🌉 Marj Köprü Analizi (MoM)' : '🌉 Margin Bridge Analysis (MoM)'}</h3>
              <p className="text-xs text-gray-500">
                {currentLanguage === 'tr'
                  ? 'Köprü, iki ayın da brüt marjı bilinmeden kurulamaz — eksik veriden "etki" ayrıştırması üretilmiyor.'
                  : 'The bridge needs a known gross margin for both months — no effect split is produced from incomplete data.'}
              </p>
              {(tutarsiz235 > 0 || kapsamDisi235 > 0) && (
                <p className="text-[11px] text-amber-600 mt-1">
                  {currentLanguage === 'tr'
                    ? `${tutarsiz235} siparişin tutarı ya da maliyeti okunamadı, ${kapsamDisi235} siparişin kalem (maliyet) verisi yok.`
                    : `${tutarsiz235} order(s) with unknown amount or cost, ${kapsamDisi235} without line-item cost data.`}
                </p>
              )}
              {dovizliNotu235}
            </div>
          );
        }
        const revChange = curr235.rev - prev235.rev;
        const grossChange = curr235.gross - prev235.gross;
        const marginChange = curr235.margin - prev235.margin;
        const bridges = [
          { label: currentLanguage === 'tr' ? 'Önceki Ay Brüt Kâr' : 'Prior Month Gross Profit', value: prev235.gross, neutral: true },
          { label: currentLanguage === 'tr' ? 'Ciro Değişimi Etkisi' : 'Revenue Volume Effect', value: revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Marj Değişimi Etkisi' : 'Margin Mix Effect', value: grossChange - revChange * (prev235.margin / 100), neutral: false },
          { label: currentLanguage === 'tr' ? 'Bu Ay Brüt Kâr' : 'Current Month Gross Profit', value: curr235.gross, neutral: true, total: true },
        ];
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🌉 Marj Köprü Analizi (MoM)' : '🌉 Margin Bridge Analysis (MoM)'}</h3>
              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${marginChange >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {marginChange >= 0 ? '+' : ''}{marginChange}pp {oc(currentLanguage).marj_2}
              </span>
            </div>
            <div className="space-y-2">
              {bridges.map((b, i) => (
                <div key={i} className={`flex items-center justify-between p-2.5 rounded-xl ${b.total ? 'bg-blue-50' : b.neutral ? 'bg-gray-50' : b.value >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <span className={`text-xs font-medium ${b.total ? 'text-blue-800 font-bold' : 'text-gray-700'}`}>{b.label}</span>
                  <span className={`text-sm font-bold shrink-0 ml-2 ${b.total ? 'text-blue-700' : b.neutral ? 'text-gray-700' : b.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {!b.neutral && b.value >= 0 ? '+' : ''}{b.neutral ? '' : b.value >= 0 ? '' : ''}{fmtAna(Math.abs(b.value),'K',0)}{!b.neutral && b.value < 0 ? ' ▼' : !b.neutral ? ' ▲' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
              <span>{currentLanguage === 'tr' ? 'Önceki: ' : 'Prior: '}{fmtAna(prev235.rev,'K',0)} · {yuzdeYaz(prev235.margin, 0, dil)}</span>
              <span>{currentLanguage === 'tr' ? 'Bu ay: ' : 'Current: '}{fmtAna(curr235.rev,'K',0)} · {yuzdeYaz(curr235.margin, 0, dil)}</span>
            </div>
            {dovizliNotu235}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        // K9 (PLAN-v2 §8 sıra 12): "`× 0,6` uydurma maliyet kalkıyor". O14 + O24 (orkestratör): maliyet TEK çözücüden
        // (raporMarj.stokMaliyetCozucu, Marj Köprüsü ile AYNI): kalemin costPrice'ı → eşleşen kartın kartMaliyetiTL'si →
        // ikisi de yoksa null ("maliyet bilinmiyor" sayacı = m239.maliyetTutar.bilinmeyen); kalemsiz sipariş m239.kapsamDisi.
        const m239 = brutMarj(pencereSiparisleri, inventory, exchangeRates);
        // K15 — kullanıcı: "Teslim edilmiş ama parası alınmamış sipariş alacağa girmiyor." → "girmeli." ·
        // "Teslim edilmemiş ama peşin ödenmiş sipariş alacak görünüyor." → "girmemeli. Sadece teslimat bekliyor olmalı."
        // Cetpa rakamı TAHSİLATA bakar (cetpaAlacak: ödenmemiş + iptal değil + ödemesi Cetpa'da izlenen); tanım (B)'nin YALNIZ
        // Cetpa yarısıdır, pencere YOK (alacak tüm zamanlıdır). "Teslimat bekleyen" kovası 6c'de YAZILMADI (O19 — açık iş).
        // O21: girdi TL siparişler — TRY dışı mağaza siparişi ödemesi izlenen ama totalPrice'ı olmayan adaydır; ayrı sayılır.
        const alacak239 = cetpaAlacak(tlSiparisler);
        const alacakDvz239 = cetpaAlacak(dovizliler);
        const dvzAlacak239 = alacakDvz239.bilinen + alacakDvz239.bilinmeyen;   // dövizli ADAY sayısı (aday tanımı tek yerde)
        // Aday kümesi BOŞ ya da gerçek ₺0 (sayılmış sıfır) → '✓'. Açık dövizli alacak varken '✓' "alacak yok" iddiası olurdu (O21).
        const alacakYok = dvzAlacak239 === 0 && (alacak239.bilinen + alacak239.bilinmeyen === 0 || (alacak239.bilinmeyen === 0 && alacak239.toplam === 0));
        const ciroTam239 = tamTutar(pencereCirosu);
        const stokTam = tamTutar(stokDegeri), cogsTam = tamTutar(m239.maliyetTutar);
        // O20 + dil (6c inceleme 1): `eksikAdi` her öğede ZORUNLU — «Genel not verilmedi — eksik bileşen: …» cümlesine çağıranın
        // dilinde girer (`SkorBileseni.ad`); kutu etiketi `label` iki dilde İngilizce kalır (bugünkü hâl, CSS `uppercase`). EN metni AYNEN.
        const kpis239: { label: string; eksikAdi: string; value: string; score: Harf | null; desc: string }[] = [
          { label: 'Gross Margin', eksikAdi: currentLanguage === 'tr' ? 'Brüt marj' : 'Gross Margin', value: yuzdeYaz(m239.marj, 0, dil), score: esikBandi(m239.marj, MARJ_HARF), desc: currentLanguage === 'tr' ? 'Brüt marj' : 'Gross margin' },
          // O16 — davranış AYNI, kod dürüst: eski formül `ciro > (ciro/3)×2,5 ? A : ciro > ciro/3 ? B : C` idi = `ciro > 0 ? A : C`
          // (B dalı ulaşılamaz). Bir EĞİLİM ölçmez; etiket ve davranış parite gereği değişmedi (O16) — kullanıcıya gözlem.
          // Kısmi ciroda harf verilmez (türetme), ayrıca not verilmez (aşağıdaki pencere notu sayar).
          // `eksikAdi` «3 aylık ciro»: O16 gereği «eğilim» sözcüğü kullanılmaz (harf bir eğilim ölçmez).
          { label: 'Revenue Trend', eksikAdi: currentLanguage === 'tr' ? '3 aylık ciro' : 'Revenue Trend', value: Number.isFinite(ciroTam239) && ciroTam239 > 0 ? '▲' : '—', score: !Number.isFinite(ciroTam239) ? null : ciroTam239 > 0 ? 'A' : 'C', desc: currentLanguage === 'tr' ? '3 aylık ciro' : '3-month revenue' },
          // O18: GB2'ye Mikro cari bakiyesi gelmiyor → K15 tanım (B) hesaplanamaz → harf verilmez (sahte kesinlik yok). Mikro cari
          // girdisini bağlamak ayrı iş. K13 — kullanıcı: "veri eklenebiliyorsa ver, mikro yüzünden verilemiyorsa N/A yaz, CETPA App
          // verisi varsa N/A+ "xx,xx" göster." · eki: "ok, yanına para birimi de ekle" (simge fmtAna'dan).
          // O20: eksik bileşen adı bu öğede — `SkorBileseni.ad` çağıranın dilinde; kutu etiketi AYNEN.
          { label: 'AR Health', eksikAdi: currentLanguage === 'tr' ? 'Alacak (Mikro cari bakiyesi bu ekrana bağlı değil)' : 'AR Health (Mikro account balance not connected to this screen)', value: `N/A · Cetpa: ${alacakYok ? '✓' : fmtAna(ekranTutari(alacak239), 'K', 0)}`, score: null, desc: currentLanguage === 'tr' ? 'Tahsilat bekleyen' : 'Outstanding AR' },
          // `<= X × kat` karşılaştırması esikBandi'ye ÇEVRİLMEDİ (o `>=` bantlarıdır; sınırda paritesizlik doğurur) — girdiler tamTutar kapısından.
          // 6c inceleme 1: kalemsiz (Mikro türevi) siparişin maliyeti bilinmiyor → COGS kısmi → harf verilmez (şartname: "Inventory
          // harfi kısmi veride '—'"). Kalemsiz sayısı aşağıdaki pencere notunda (`kalemsiz: m239.kapsamDisi`) zaten basılıyor.
          { label: 'Inventory', eksikAdi: currentLanguage === 'tr' ? 'Stok / satılan malın maliyeti oranı' : 'Inventory', value: fmtAna(ekranTutari(stokDegeri),'K',0), score: m239.kapsamDisi > 0 || !Number.isFinite(stokTam) || !Number.isFinite(cogsTam) ? null : stokTam <= cogsTam * STOK_A_KAT ? 'A' : stokTam <= cogsTam * STOK_B_KAT ? 'B' : 'C', desc: currentLanguage === 'tr' ? 'Stok değeri' : 'Stock value' },
        ];
        const gradeColor: Record<Harf, string> = { A: 'text-emerald-600 bg-emerald-100', B: 'text-blue-600 bg-blue-100', C: 'text-amber-600 bg-amber-100', D: 'text-red-600 bg-red-100' };
        // O20: AR (O18) koşulsuz null → bilesikSkor genel harfi üretmez; Mikro cari bağlanınca kendiliğinden geri gelir.
        // Formül DEĞİŞMEDİ (kısmi / üç bileşenli skor YOK); dört bileşen bilindiğinde eski `Math.round` notuyla DENK (GENEL_HARF).
        const genel239 = bilesikSkor(kpis239.map(k => ({ ad: k.eksikAdi, puan: k.score === null ? null : HARF_PUANI[k.score], agirlik: 1 })));
        const genelHarf239 = genel239.skor === null ? null : esikBandi(genel239.skor / genel239.toplam, GENEL_HARF);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🏦 Finansal Sağlık Göstergesi' : '🏦 Financial Health Dashboard'}</h3>
              <span className={`text-2xl font-black px-3 py-1 rounded-xl ${genelHarf239 === null ? 'text-gray-400 bg-gray-100' : gradeColor[genelHarf239]}`}>{genelHarf239 ?? '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis239.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{k.label}</p>
                    <span className={`text-xs font-black px-1.5 py-0.5 rounded ${k.score === null ? 'text-gray-400 bg-gray-100' : gradeColor[k.score]}`}>{k.score ?? '—'}</span>
                  </div>
                  <p className="text-xl font-black text-gray-700">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.desc}</p>
                </div>
              ))}
            </div>
            {genel239.eksik.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                {currentLanguage === 'tr' ? `Genel not verilmedi — eksik bileşen: ${genel239.eksik.join(', ')}` : `No overall grade — missing: ${genel239.eksik.join(', ')}`}
              </p>
            )}
            <p className="text-[11px] text-gray-500 mt-1">
              {currentLanguage === 'tr'
                ? `AR notu verilmedi: Mikro cari bakiyesi bu ekrana bağlı değil. Cetpa rakamı yalnız Cetpa'da ödemesi izlenen, ödenmemiş siparişlerdir (teslimata değil tahsilata bakar).`
                : `No AR grade: the Mikro account balance is not connected to this screen. The Cetpa figure covers only unpaid orders whose payment is tracked in Cetpa (collection, not delivery).`}
            </p>
            {/* Dört AYRI önerme (toplanmaz): pencere cirosu (Revenue Trend), maliyet, kalemsiz, dövizli (pencere kümesinin dışında). */}
            <KapsamNotu sayaclar={{ tutarsiz: pencereCirosu.bilinmeyen, maliyetsiz: m239.maliyetTutar.bilinmeyen, kalemsiz: m239.kapsamDisi, dovizli: pencereDovizli }} birim="siparis" dil={currentLanguage} />
            {/* Marjın ciro tabanı marjCirosu'dur (MF siparişinde Σ kalem neti), pencere cirosu DEĞİL: başlık tutarı bilinen ama kalem
                neti bilinmeyen (ya da sürüm-1 kalemli) MF siparişi bir üstteki notta görünmez. İkisi kesişebilir → ayrı önermeler. */}
            <KapsamNotu sayaclar={{ tutarsiz: m239.ciroTutar.bilinmeyen }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'marj hesaplanmadı' : 'margin not computed'} />
            <KapsamNotu sayaclar={{ tutarsiz: alacak239.bilinmeyen }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'Cetpa alacağına dâhil değil' : 'not included in the Cetpa receivable'} />
            {/* O21: dövizli aday AYRI satır — cümle «— toplanmadı» ile biter, `sonuc` eklenmez (çift tire). 6c inceleme 1: pencere
                notundaki (yukarıda) dövizli cümlesiyle AYNI metin iki satırda basılıyordu → hangisinin neyi saydığı ayırt edilemiyordu;
                bu satır «Cetpa alacağı: » önekini alır. Cümle `kapsamNotu`'ndan (yeni metin yok); 0 iken düğüm çizilmez. */}
            {(() => {
              const dvzNotu239 = kapsamNotu({ dovizli: dvzAlacak239 }, { birim: 'siparis', dil: currentLanguage });
              return dvzNotu239 === null ? null : (
                <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? 'Cetpa alacağı: ' : 'Cetpa receivable: '}{dvzNotu239}</p>
              );
            })()}
            {stokDegeriNotu !== null && <p className="text-[11px] text-amber-600 mt-1">{stokDegeriNotu}</p>}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 3 && (() => {
        const now245 = new Date();
        const monthStart245 = new Date(now245.getFullYear(), now245.getMonth(), 1);
        const prevMonthStart245 = new Date(now245.getFullYear(), now245.getMonth() - 1, 1);
        const prevMonthEnd245 = new Date(now245.getFullYear(), now245.getMonth(), 0, 23, 59, 59);
        // K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." Tek tanım: `iptalsiz`. O21: dövizli sayaç AYNI pencereyle (`liste`).
        const filterOrders245 = (start: Date, end: Date, liste: readonly Order[] = iptalsiz) => liste.filter(o => {
          const od = zamanDate(o.createdAt);
          return od !== null && od >= start && od <= end;
        });
        const currOrders = filterOrders245(monthStart245, new Date());
        const prevOrders = filterOrders245(prevMonthStart245, prevMonthEnd245);
        const dvz245 = filterOrders245(monthStart245, new Date(), dovizliIptalsiz).length + filterOrders245(prevMonthStart245, prevMonthEnd245, dovizliIptalsiz).length;   // iki ay AYRIK
        const ciroBu245 = raporCirosu(currOrders), ciroOnce245 = raporCirosu(prevOrders);
        const ciroKars245 = donemKarsilastir(ciroBu245, ciroOnce245);   // kısmi ay → yüzde null (rozet yok)
        // K4 — kullanıcı: "kimlikle". Kimliksiz sipariş varken müşteri sayısı alt sınırdır → değişim yüzdesi TÜRETİLMEZ.
        const moBu245 = musteriOzeti(currOrders, musteriSecenek), moOnce245 = musteriOzeti(prevOrders, musteriSecenek);
        const custGrowth = moBu245.kimliksiz === 0 && moOnce245.kimliksiz === 0 ? hizDegisimi(moBu245.musteriler.length, moOnce245.musteriler.length) : null;
        // O6 (orkestratör, K23 ilkesi "girilmeyen hesaba katılmaz + not"): tutarı bilinmeyen sipariş ne paya ne paydaya girer;
        // hiç bilinen yoksa NaN → '—'. Değişim yüzdesi TÜRETMEDİR: iki aydan birinde tek bilinmeyen varsa rozet ÇİZİLMEZ.
        const aovBu245 = ortalamaSiparisTutari(currOrders), aovOnce245 = ortalamaSiparisTutari(prevOrders);
        const aovBuY = Math.round(aovBu245.deger), aovOnceY = Math.round(aovOnce245.deger);
        const aovGrowth245 = aovBu245.bilinmeyen > 0 || aovOnce245.bilinmeyen > 0 ? null : hizDegisimi(aovBuY, aovOnceY);
        const kpis245 = [
          { icon: '💰', label: currentLanguage === 'tr' ? 'Bu Ay Ciro' : 'Month Revenue', value: fmtAna(ekranTutari(ciroBu245),'K',0), growth: ciroKars245.yuzde },
          { icon: '📦', label: oc(currentLanguage).siparis_2, value: String(currOrders.length), growth: hizDegisimi(currOrders.length, prevOrders.length) },
          { icon: '👥', label: oc(currentLanguage).aktif_musteri, value: String(moBu245.musteriler.length), growth: custGrowth },
          { icon: '🛒', label: 'AOV', value: fmtAna(aovBuY,'K',1), growth: aovGrowth245 },
        ];
        return (
          <div className="apple-card p-6 border-2 border-brand/20">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">📋</span>
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? 'Yönetici KPI Özeti' : 'Executive KPI Summary'}</h3>
              <span className="text-[10px] text-gray-400 ml-auto">{tarihYaz(now245, { month: 'long', year: 'numeric' }, currentLanguage === 'tr' ? 'tr' : 'en')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {kpis245.map(k => (
                <div key={k.label} className="bg-gray-50 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{k.icon}</span>
                    {k.growth !== null && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.growth >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {k.growth >= 0 ? '↑' : '↓'} {yuzdeYaz(Math.abs(k.growth), 0, dil)}
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-black text-gray-800">{k.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: ciroBu245.bilinmeyen + ciroOnce245.bilinmeyen, kimliksiz: moBu245.kimliksiz + moOnce245.kimliksiz, dovizli: dvz245 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // K14 kullanıcı: "kaldır" — ödeme yöntemi çiftinden bu panel KALIR (testli odemeYontemiSegmenti); GenelBloklar4'teki ikizi kalkar (O3).
        // O3: yalnız kodda yazıcısı olan alan okunur (`paymentMethod` — yazıcı `utils/siparisler/odemeYontemi.ts` `odemeAlindiYamasi`;
        // geri alma `null`); `payment` hayalet alandı (yazıcısı yok); `shopifyRaw.odemeYontemi` serbest metin, okunmaz.
        // "Belirtilmemiş" SATIR olarak kalır (parite). K2 — kullanıcı: "İptaller ciroya girsin mi → hayır." (`iptalsiz`, dövizlisiz — O21).
        // K21 kullanıcı: "Tüm ciro" — payların paydası TÜM iptalsiz ciro (yardımcının tamToplam'ı; bağlama öncesi de öyle → parite).
        // O10: 4. parametre GEÇİLMEZ. Segmentler yardımcıda ZATEN azalan ciroyla sıralı (bilinmeyen ciro sona) — ikinci sıralama yok.
        const s249 = segmentCirosu(iptalsiz, odemeYontemiSegmenti);
        if (s249.segmentler.length < 2) return null;
        const COLORS249 = ['bg-brand', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-purple-400'];
        // Segment anahtarı `odemeYontemiSegmenti`'nden gelir: ya ODEME_YONTEMLERI'nden bir kod ya `ODEME_YONTEMI_BELIRTILMEMIS`.
        // Tanıma TEK liste (`odemeYontemiMi`); başka bir anahtar yapısal olarak gelmez — gelirse ham değil «Belirtilmemiş» basılır.
        const etiket249 = (anahtar: string): string =>
          anahtar !== ODEME_YONTEMI_BELIRTILMEMIS && odemeYontemiMi(anahtar) ? odemeYontemiEtiketi(anahtar, currentLanguage) : oc(currentLanguage).belirtilmemis;
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💳 Ödeme Yöntemi Dağılımı' : '💳 Payment Method Distribution'}</h3>
            <div className="space-y-2.5">
              {s249.segmentler.slice(0, 5).map((s, i) => {
                // SegmentCiro.yuzde HAM; tutarı bilinmeyen sipariş varken null → yüzde '—', çubuk taralı (eski %4 taban kalktı — O15).
                const pct = s.yuzde === null ? null : Math.round(s.yuzde);
                return (
                  <div key={s.anahtar}>
                    <div className="flex items-center justify-between mb-0.5">
                      {/* 6c inceleme 1: enum kodu ham basılmaz — OrdersPage rozetiyle AYNI sözlük metni (`odemeYontemiEtiketi`); sözlük
                          metni doğru büyük harfle gelir, `capitalize` kalktı (lang="tr" olmadan «i»yi yanlış büyütebilirdi). */}
                      <span className="text-xs font-medium text-gray-700">{etiket249(s.anahtar)}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-gray-400">{s.siparisSayisi} {oc(currentLanguage).siparis}</span>
                        <span className="text-[10px] font-bold text-gray-500">{yuzdeYaz(pct, 0, dil)}</span>
                        <span className="text-xs font-bold text-gray-700">{fmtAna(s.ciro,'K',0)}</span>
                      </div>
                    </div>
                    <OlcekCubugu oran={s.yuzde} kalinlik="h-2" renkSinifi={COLORS249[i] ?? 'bg-gray-400'} dil={currentLanguage} />
                  </div>
                );
              })}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: s249.tutarsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'paylar hesaplanmadı' : 'shares not computed'} />
            {/* O21: AYRI çağrı — üstteki `sonuc` dövizli için YANLIŞ olurdu (dövizli sipariş payları bozmaz). */}
            <KapsamNotu sayaclar={{ dovizli: dovizliIptalsiz.length }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && employees.length > 0 && (() => {
        // Pencere ve ciro üst düzeyde (Finansal Sağlık ile ORTAK — bağlama öncesi BİREBİR kopyaydı).
        // K23 (kullanıcı: "Önerin ok. Sorunun cevabı dediğin gibi olacak.") / O11: aktif çalışan = calisanDurumu(e) === 'aktif'
        // (kanonik veride sayı DEĞİŞMEZ; yalnız yazım varyantları — ' aktif ', 'AKTİF' — artık aktif sayılır).
        const activeEmp250 = employees.filter(e => calisanDurumu(e) === 'aktif').length;
        // K10 (PLAN-v2 §8 sıra 11): "`?? 5` kalkıyor; eşiği tanımsız ürün listeden düşer + 'N ürünün eşiği tanımlı değil'".
        // Uydurma stok (0) ve uydurma eşik (5) kalktı: stoğu ya da eşiği bilinmeyen kart kıyaslanmaz, ayrı sayılır.
        const ds250 = dusukStokKalemleri(inventory);
        // K4 — kullanıcı: "kimlikle".
        const mo250 = musteriOzeti(pencereSiparisleri, musteriSecenek);
        // Tutar okumayan saf durum sayacı: O21 süzgeci UYGULANMAZ (açık dövizli sipariş bağlama öncesi gibi sayılır).
        const openOrds = orders.filter(o => o.status === 'Pending' || o.status === 'Processing').length;
        const e250 = ekranTutari(pencereCirosu);
        const insights = [
          // Ciro satırı tutarı okunamayan sipariş varken de görünür ('—' ya da kısmi + not); eskiden sessizce kayboluyordu.
          ((Number.isFinite(e250) && e250 > 0) || pencereCirosu.bilinmeyen > 0) && `💰 ${currentLanguage === 'tr' ? `Son 3 ayda ${fmtAna(e250,'K',0)} ciro` : `${fmtAna(e250,'K',0)} revenue in last 3 months`}`,
          `📦 ${currentLanguage === 'tr' ? `${pencereSiparisleri.length} sipariş, ${mo250.musteriler.length} benzersiz müşteri` : `${pencereSiparisleri.length} orders from ${mo250.musteriler.length} unique customers`}`,
          `👥 ${currentLanguage === 'tr' ? `${activeEmp250} aktif çalışan` : `${activeEmp250} active employees`}`,
          `🏭 ${currentLanguage === 'tr' ? `${fmtAna(ekranTutari(stokDegeri),'K',0)} stok değeri` : `${fmtAna(ekranTutari(stokDegeri),'K',0)} inventory value`}`,
          ds250.dusuk.length > 0 && `⚠️ ${currentLanguage === 'tr' ? `${ds250.dusuk.length} ürün kritik stok seviyesinde` : `${ds250.dusuk.length} items at critical stock level`}`,
          openOrds > 0 && `⏳ ${currentLanguage === 'tr' ? `${openOrds} sipariş işleme bekliyor` : `${openOrds} orders awaiting processing`}`,
        ].filter(Boolean) as string[];
        return (
          <div className="apple-card p-6 bg-gradient-to-br from-gray-50 to-white border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl">🔭</span>
              <div>
                <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '360° İş Zekası Özeti' : '360° Business Intelligence Summary'}</h3>
                <p className="text-[10px] text-gray-400">{tarihYaz(bugun, { day: 'numeric', month: 'long', year: 'numeric' }, currentLanguage === 'tr' ? 'tr' : 'en')}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 bg-white rounded-xl shadow-sm border border-gray-50">
                  <p className="text-xs text-gray-700 leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: pencereCirosu.bilinmeyen, kimliksiz: mo250.kimliksiz, dovizli: pencereDovizli }} birim="siparis" dil={currentLanguage} />
            {/* İki küme AYRIK (stoğu bilinmeyen kart eşik sayacına girmez); birimleri SABİT 'urun'. Stok değeri cümlesiyle KESİŞİR → ayrı önerme. */}
            <KapsamNotu sayaclar={{ miktarsiz: ds250.stokBilinmeyen.length, esiksiz: ds250.esikBilinmeyen.length }} dil={currentLanguage} />
            {stokDegeriNotu !== null && <p className="text-[11px] text-amber-600 mt-1">{stokDegeriNotu}</p>}
            {/* K24 — kullanıcı: "kalsın, hafızaya at sonra bakarız." Aşağıdaki metin DOKUNULMADI (ERTELENDİ). */}
            <div className="mt-4 p-3 bg-brand/5 rounded-xl border border-brand/10">
              <p className="text-[11px] text-brand font-semibold">{currentLanguage === 'tr' ? '🚀 Cetpa ERP Analytics · 250 Faz tamamlandı' : '🚀 Cetpa ERP Analytics · 250 Phases Complete'}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{currentLanguage === 'tr' ? 'Finansal, satış, lojistik, envanter ve İK analizleri entegre edildi.' : 'Financial, sales, logistics, inventory, and HR analytics fully integrated.'}</p>
            </div>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        const now251 = new Date();
        const currYear = now251.getFullYear();
        const prevYear = currYear - 1;
        // O7 (orkestratör): yilAylikCiro = aylikCiro sarmalayıcısı → tarih kuralı modülün ciroTarihi'si (createdAt → syncedAt) ve tutar
        // siparisTutari (totalAmount yedeği). Bilinçli fark: createdAt'i olmayıp syncedAt'i olan sipariş artık sayılır (6b ceyreklikCiro emsali).
        // K2 süzgeci { iptalHaric: true } ile — girdi TL siparişler (O21); sayaçlar süzgeci yardımcıdan alır. Ay etiketi aylar[i].etiket.
        const bu251 = yilAylikCiro(tlSiparisler, currYear, { iptalHaric: true }, dil);
        const once251 = yilAylikCiro(tlSiparisler, prevYear, { iptalHaric: true }, dil);
        // O21: dövizli sayaç AYNI yardımcıdan (yıl / ay / iptal kuralı ikinci kez yazılmaz). Her kayıt ya bilinen ya bilinmeyen sayılır
        // → bilinen + bilinmeyen = ADAY sayısı; iki yıl AYRIK.
        const yilDovizli251 = (yil: number) => donemToplami(yilAylikCiro(dovizliler, yil, { iptalHaric: true }, dil).aylar);
        const dvzT251 = tutarBirlestir(yilDovizli251(currYear), yilDovizli251(prevYear));
        const dvz251 = dvzT251.bilinen + dvzT251.bilinmeyen;
        const hasPrev = once251.aylar.some(s => s.tutar.toplam > 0 || s.tutar.bilinmeyen > 0);
        const buYilT = donemToplami(bu251.aylar), gecenYilT = donemToplami(once251.aylar);
        // O16: karşılaştırma YIL BAŞINDAN BUGÜNE (kısmi yıl) ↔ GEÇEN YILIN TAMAMI'dır; yıl bitene kadar rozet aşağı yönlü okur.
        // Tanım ve 'YoY' etiketi parite gereği değişmedi (K28) — kullanıcıya gözlem. İki yıl da TAM bilinmedikçe yüzde null.
        const yoy251 = donemKarsilastir(buYilT, gecenYilT);
        if (buYilT.bilinen + buYilT.bilinmeyen === 0 || (buYilT.bilinmeyen === 0 && buYilT.toplam === 0)) return null;
        // O15: eski `, 1` uydurma ölçek tabanı ve 2 px çubuk tabanı kalktı — ₺0 ay çubuksuz, bilinmeyen ay taralı.
        const olcek251 = olcekReferansi([...bu251.aylar, ...once251.aylar].map(s => tutarSatiri(s.tutar)));
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Yıllık Ciro Karşılaştırması (YoY)' : '📅 Year-over-Year Revenue Comparison'}</h3>
              {yoy251.yuzde !== null && (
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${yoy251.yon === 'artis' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {yoy251.yon === 'artis' ? '↑' : '↓'} {`${yuzdeYaz(Math.abs(yoy251.yuzde), 0, dil)} YoY`}
                </span>
              )}
            </div>
            <div className="flex items-end gap-1 h-28 mb-2">
              {bu251.aylar.map((s, i) => (
                <div key={s.anahtar} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex items-end gap-px" style={{ height: '80px' }}>
                    <OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(s.tutar), olcek251)} renkSinifi="bg-brand" koseSinifi="rounded-t-sm" dil={currentLanguage} />
                    {hasPrev && <OlcekCubugu yon="dikey" oran={cubukOrani(tutarSatiri(once251.aylar[i].tutar), olcek251)} renkSinifi="bg-gray-200" koseSinifi="rounded-t-sm" dil={currentLanguage} />}
                  </div>
                  <span className="text-[8px] text-gray-400 leading-none">{s.etiket}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-brand" /><span className="text-[10px] text-gray-500">{currYear}: {fmtAna(ekranTutari(buYilT),'K',0)}</span></div>
              {hasPrev && <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-gray-300" /><span className="text-[10px] text-gray-500">{prevYear}: {fmtAna(ekranTutari(gecenYilT),'K',0)}</span></div>}
            </div>
            {/* İki yıl AYRIK → tutarsız ve dövizli toplamları benzersiz; tarihsiz TEK çağrıdan (iki çağrı aynı kaydı sayar). Yıl dışı BASILMAZ. */}
            <KapsamNotu sayaclar={{ tutarsiz: buYilT.bilinmeyen + gecenYilT.bilinmeyen, tarihsiz: bu251.tarihsiz, dovizli: dvz251 }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}
    </>
  );
}
