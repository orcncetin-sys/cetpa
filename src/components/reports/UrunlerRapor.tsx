/**
 * UrunlerRapor.tsx — Raporlar > Ürün Performansı sekmesi
 *
 * ReportsDashboard.tsx'ten çıkarıldı (2026-07-30). O dosya 16.101 satırdı ve
 * altı sekmenin blokları dosya boyunca İÇ İÇE dağılmıştı; bu dosya yalnız
 * 'urunler' sekmesine ait 1 bloğu, ORİJİNAL SIRASIYLA ve içeriği
 * DEĞİŞTİRİLMEDEN taşır. Paylaşılan hesaplamalar useReportsData'dan gelir.
 *
 * Bloklardaki `reportsTab === 'urunler'` koşulları BİLEREK korundu: ebeveyn zaten
 * sekmeye göre render ediyor, ama koşulu silmek binlerce satırda metin
 * dönüşümü demekti ve bu taşımanın "saf kopya" güvencesini bozardı.
 *
 * ## Faz 3 6b bağlaması (2026-09-24) — hesap sayfadan ÇIKTI, testli yardımcılara BAĞLANDI
 * Şartname: faz3-2n-specs/6n-kesif/6b/baglama-urunler-rapor.md · harita: 6n-kesif/crm-kucuk-b.json.
 * Eski sayfa (HEAD 912d750, satırlar `cat -n` ile) beş sahte kesinlik taşıyordu:
 *   :63  `Number(liR.quantity ?? 1) || 1`        → miktarı okunamayan kalem 1 adet UYDURULUYORDU
 *   :64  `Number(liR.unitPrice ?? … ?? 0) || 0`   → fiyatı okunamayan kalem ₺0 sayılıyordu
 *   :81  `totalRevenue > 0 ? … : 0`               → payda 0/bilinmezken pct 0, cumPct hiç artmıyor →
 *   :83  `cumPct <= 70 ? 'A' …`                     TÜM ürünler 'A Sınıfı', üç KPI kartı yanlış (EN AĞIR SONUÇ)
 *   :147 `totalRevenue > 0 ? p.revenue / classified[0].revenue : 0` → koşul yanlış değişkende, çubuk sahte
 *   :179 `<td>100%</td>`                           → tfoot payı SABİT; paylar bilinmezken bile '100%'
 * Artık: gruplama/adet/ciro `pano/stokSevkiyat.urunSatislari` (Tutar kovaları: bilinen toplanır, bilinmeyen
 * SAYILIR); pay/kümülatif/ABC `rapor/yogunlasma.kumulatifPaylar + abcSiniflandir` (payda `tamTutar` kapısı:
 * tek kalem bile bilinmiyorsa pay da sınıf da '—'); çubuk `pano/cubuk`; metin `bicim.yuzdeYaz` /
 * `depoDeger.adetYaz` / `fmtAna`. Sayfada `reduce`, `?? 0`, `toFixed`, `as unknown` KALMADI.
 *
 * PARİTE (bilinen/tam girdide sayı DEĞİŞMEZ): kova anahtarı (sku → name → title), ad seçimi, ciroya göre
 * azalan sıra (EŞİT ciroda beraberlik sırası hariç — bilinçli fark 10), boş-durum kapısı, ABC eşikleri (70/90,
 * `<=` dâhil — `ABC_ESIKLERI`), kart etiket/renkleri, TRY'de para metni (`fmtAna` = `paraYaz(v,{ondalik:0})` —
 * currency.ts:104-114), tam veride tfoot '100%'.
 *
 * BİLİNÇLİ FARKLAR (kullanıcı kararı + sahte kesinlik yasağı):
 *   1. Miktarı okunamayan kalem "1 adet" DEĞİL → Adet sütunu düşer, not çıkar.
 *   2. Tutarı okunamayan kalem ₺0 DEĞİL → Gelir/Toplam düşer ya da '—', not çıkar.
 *   3. Payda bilinmiyorsa pay/sınıf '—' → A/B/C kartları "hepsi A" yanlışından çıkar, '—' basar.
 *   4. "Sipariş" sütunu KALEM değil BENZERSİZ SİPARİŞ sayar (PLAN-v2 Y16) → sayı düşebilir.
 *   5. USD/EUR seçiliyken tablo seçili birimi basar (kur yoksa '—', sahte kur YOK).
 *   6. `'Unknown'` sabiti → '—'; `productName`/`unitPrice`/`variant_price` okuması düşer (yazıcısı yok).
 *   7. K-KALEM=A (hakem turu 2026-09-24, bulgu 1): Mikro faturasından türeyen kalem (`total` var, `price` yok —
 *      eslemeFatura.ts:166-171) `total` ile BİLİNİR, ciro `tutarSec` seçicisinden. Eski kod onu ₺0 sayıyordu →
 *      Gelir/Toplam/pay/sınıf o kalemlerde DEĞİŞİR (görünür). B varsayılanı ("tutarı okunamadı") canlı veride
 *      TÜM ürünlerin payını '—' yapıyor ve tutarı yazılı faturaya "okunamadı" diyordu (yanlış neden = yanlış
 *      bilgi, kapsamNotu.ts:118-121). Dayanak: kullanıcı K3 (KARARLAR.md) "evet / ana program zaten bu."
 *      `total` KDV DÂHİL, native `price` KDV HARİÇ → tek sütunda karışır; tablo altında dipnot (yalnız `total`
 *      yolu en az bir kalemde kullanıldıysa). K-KALEM'in kendi kullanıcı cümlesi KARARLAR.md'de HENÜZ YOK.
 *      Kapanış turu (2026-09-24, bulgu 4/6): seçici + dipnot kapısı `pano/stokSevkiyat.kalemTutari` /
 *      `kdvDahilKalemVar` (TEK tanım; GenelBloklar1 P217 aynı ikiliyi kullanır — satır içi kopya KALKTI).
 *   8. KPI `desc` "Gelirin %70'i" → eşik biçimi "Kümülatif pay ≤ %70" (`ABC_ESIKLERI`'nden; K20 dipnot).
 *   9. TR'de pay ondalığı virgül (`bicim.yuzdeYaz` belgeli farkı); EN'de Adet `en-US` gruplaması.
 *  10. EŞİT ciroda beraberlik sırası: eski `prodMap: Record` + `Object.values` TAMSAYI-görünümlü anahtarları
 *      ("100", "200") artan sırada ÖNE alıyordu; `urunSatislari` `Map` → salt EKLEME sırası. `sort` iki tarafta
 *      da kararlı → yalnız sayısal SKU'lu ürünler AYNI ciroya sahipse `#` sırası ve eşik üstündeki A/B rozeti yer
 *      değiştirebilir (hakem 2026-09-24 bulgu 2; nadir, kök yardımcı başka grubun — burada yalnız belgelenir).
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  LayoutDashboard, List, Truck, UserCheck, Package, Users, BarChart3,
  AlertCircle, Calendar, Download, CheckCircle2, ChevronRight,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { tr, enUS } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  collection, onSnapshot, query, where,
} from '../../lib/dbClient';
import { db, auth } from '../../firebase';
import { logFirestoreError as importedLogFirestoreError, OperationType } from '../../utils/firebase';
import { sortByCreatedAt } from '../../utils/fsSort';
import { ekranTutari } from '../../utils/para';
import { urunSatislari, kalemTutari, kdvDahilKalemVar } from '../../utils/pano/stokSevkiyat';
import { tutarSatiri, olcekReferansi, cubukOrani } from '../../utils/pano/cubuk';
import { kumulatifPaylar, abcSiniflandir, ABC_ESIKLERI } from '../../utils/rapor/yogunlasma';
import { yuzdeYaz } from '../../utils/rapor/bicim';
import { adetYaz } from '../../utils/muhasebe/depoDeger';
import ModuleHeader from '../ModuleHeader';
import {
  type Order,
  type Employee,
  type Quotation,
  type InventoryItem,
  type InventoryMovement,
} from '../../types';
import { itemCostTRY, itemPriceTRY, type ReportsCtx } from './useReportsData';
import { KpiCard, KpiGrid, KapsamNotu, OlcekCubugu } from './ReportKit';
import { oc } from '../../i18n/ortak';
import { rc } from '../../i18n/rapor';

export default function UrunlerRapor(ctx: ReportsCtx) {
  const { orders, inventory, exchangeRates, currentT, currentLanguage, userRole, onNavigate, employees, quotations, inventoryMovements, recurringOrders, externalTab, setExternalTab, timeRange, setTimeRange, revenueCurrency, setRevenueCurrency, _localReportsTab, _setLocalReportsTab, reportsTab, setReportsTab, invSummarySort, setInvSummarySort, logisticsSummarySort, setLogisticsSummarySort, fmtAna, hrStats, setHrStats, totalRevenueTRY, revenueSymbol, revenueFormatted, totalOrders, avgOrderValueTRY, avgOrderFormatted, lowStockItems, salesByDate, trendData, categoryData, categoryChartData, ordersByStatus, statusChartData, topCustomers, totalInventoryValueTRY, categoryValueData, categoryValueChartData, COLORS, exportPDF } = ctx;
  void itemCostTRY; void itemPriceTRY; // sekmeye göre kullanılıyor olabilir

  // Türetme bileşen ÜST DÜZEYİNDE (hook kuralı: aşağıdaki IIFE içinde hook YASAK). Eski kod her
  // render'da IIFE içinde iki `for` + `reduce` + `map` ile yeniden hesaplıyordu.
  //
  // K2 — kullanıcı (KARARLAR.md): "İptaller ciroya girsin mi → hayır." Rapor ekranlarında ciro =
  // iptaller HARİÇ, tek kural (`pano/raporVeriKatmani.raporCirosu` ile aynı). Süzgeç ÇAĞIRANDA durur;
  // yardımcının içinde İKİNCİ bir kopya YOK. Eski `:58` de süzüyordu → rakam DEĞİŞMEZ, yalnız yer değişti.
  // `baslikYedegi`: Shopify webhook'u kaleme `name` değil `title` yazar (server.ts:431-435) — eski `:61`
  // `title` yedeğinin paritesi için AÇIK geçilir.
  const siparisler = useMemo(() => orders.filter(o => o.status !== 'Cancelled'), [orders]);
  // K-KALEM=A (hakem 2026-09-24, bulgu 1): Mikro faturasından türeyen kalem `price` TAŞIMAZ, tutarı `total`da
  // (KDV dâhil — eslemeFatura.ts:166-171, :262-283). Dayanak kullanıcı K3 (KARARLAR.md): "evet / ana program
  // zaten bu." → Mikro verisi KATILIR. Seçici `pano/stokSevkiyat.kalemTutari` (TEK tanım, testli — kapanış bulgu
  // 4/6: eskiden burada ve GenelBloklar1 P217'de satır içi KOPYAydı; GB1 ile AYNI 'ürün cirosu' bu import ile kurulur).
  const urunler = useMemo(
    () => urunSatislari(siparisler, { baslikYedegi: true, tutarSec: kalemTutari }),
    [siparisler],
  );
  // Dipnot kapısı `pano/stokSevkiyat.kdvDahilKalemVar` (seçicinin ilk dalıyla AYNI kural; Mikro'suz kiracıda
  // "Mikro kalemlerinde KDV dâhildir" dipnotu basılmaz — açıkladığı satır yoksa not gürültüdür).
  const kdvDahilKalem = useMemo(() => kdvDahilKalemVar(siparisler), [siparisler]);
  // Pay/kümülatif TÜRETİLMİŞ sayıdır: payda `tamTutar` kapısından geçer (para.ts:70) — tek kalemin tutarı
  // bilinmiyorsa pay da sınıf da '—'. Eski kod payda 0 iken pct'yi 0 yapıyor, cumPct hiç artmıyor ve BÜTÜN
  // ürünler 'A Sınıfı' çıkıyordu (crm-kucuk-b.json: "EN AĞIR SONUÇ").
  // `sec` ŞART: öğe nesne, değer `u.ciro` (zaten `Tutar`). Sıra varsayılan 'azalan' → abcSiniflandir doğrular.
  // K21 (payda TÜM ürünler) yardımcının içinde — payda dışarıdan verilmez.
  const pay = useMemo(() => kumulatifPaylar(urunler, u => u.ciro), [urunler]);
  // K20 — kullanıcı (KARARLAR.md): "ok kalsın." Eşikler `ABC_ESIKLERI` (70/90) — değer aynı, yalnız
  // adlandırıldı; ekranda dipnot kart `hint`inden ÜRETİLİR (elle '70' yazılmaz).
  const abc = useMemo(() => abcSiniflandir(pay), [pay]);
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';

  return (
    <>
      {reportsTab === 'urunler' && (() => {
        // Çubuk ölçeği liste DIŞINDA, BİR KEZ (saf hesap, hook değil): en büyük satır kısmiyse ölçek
        // YOK (NaN) → çubuk gri taralı. Eski `:147` koşulu `totalRevenue`, böleni `classified[0].revenue`
        // idi — koruma yanlış değişkendeydi.
        const olcek = olcekReferansi(abc.satirlar.map(s => tutarSatiri(s.oge.ciro)));
        // `miktarsiz` sayacının birimi SABİT 'urun' (kapsamNotu.ts:142) → KALEM değil ÜRÜN sayılır ki
        // cümle ("N ürünün miktarı okunamadı") doğru olsun. `> 0` burada süzgeç koşuludur, sıfır-yedeği değil.
        const miktarsizUrun = urunler.filter(u => u.adet.bilinmeyen > 0).length;
        // Kart dipnotu eşik SABİTİNDEN (K20: adlandırılır + ekranda dipnot). Eski metin ("Gelirin %70'i")
        // sayıyı Türkçe iyelik ekine gömdüğü için sabitten türetilemiyordu → eşik biçimine geçildi.
        const [e1, e2] = ABC_ESIKLERI;

        if (urunler.length === 0) return (
          <div className="apple-card p-12 text-center space-y-3">
            <Package className="w-12 h-12 text-gray-200 mx-auto" />
            <p className="text-gray-400 text-sm">
              {rc(currentLanguage).siparis_satir_kalemlerinde_urun_verisi_yok}
            </p>
          </div>
        );

        return (
          <div className="space-y-4">
            {/* KPI Strip — ortak KpiCard/KpiGrid (ReportKit) ile tek tip */}
            {/* Sınıflandırılamazken (payda bilinmiyor/yok) kart '0' DEĞİL '—' basar: 0 ürün "A" demek yanlış olurdu. */}
            <KpiGrid cols={3}>
              {([
                { label: rc(currentLanguage).a_sinifi_urun, value: pay.neden === null ? String(abc.sayilar.A) : '—', symbol: 'A', accent: 'text-emerald-600', accentBg: 'bg-emerald-50', desc: currentLanguage === 'tr' ? `Kümülatif pay ≤ %${e1}` : `Cumulative share ≤ ${e1}%` },
                { label: rc(currentLanguage).b_sinifi_urun, value: pay.neden === null ? String(abc.sayilar.B) : '—', symbol: 'B', accent: 'text-amber-600', accentBg: 'bg-amber-50', desc: currentLanguage === 'tr' ? `%${e1}–${e2} arası` : `${e1}–${e2}%` },
                { label: rc(currentLanguage).c_sinifi_urun, value: pay.neden === null ? String(abc.sayilar.C) : '—', symbol: 'C', accent: 'text-gray-600', accentBg: 'bg-gray-100', desc: currentLanguage === 'tr' ? `> %${e2}` : `> ${e2}%` },
              ] as const).map((k, i) => (
                <KpiCard key={k.label} index={i} label={k.label} value={k.value} symbol={k.symbol} accent={k.accent} accentBg={k.accentBg} hint={k.desc} />
              ))}
            </KpiGrid>
            {/* YALNIZ payda kurulamadığında: `tutarsiz` = okunamayan KALEM sayısı (`pay.toplam.bilinmeyen`,
                yardımcı üretir — sayfada ikinci sayaç/reduce YOK). `pay.bilinmeyenSatir` ÜRÜN sayar, ekrana
                BASILMAZ (iki birim yan yana çift sayım izlenimi verir). 'payda-yok' + bilinmeyen 0 → not boş,
                bileşen hiçbir şey basmaz; kartlar zaten '—'. */}
            {pay.neden !== null && (
              <KapsamNotu
                sayaclar={{ tutarsiz: pay.toplam.bilinmeyen }}
                birim="kayit"
                dil={currentLanguage}
                sonuc={rc(currentLanguage).abc_siniflandirmasi_ve_pay_sutunu_hesaplanmadi}
              />
            )}
            {/* 'payda-yok' (delta 2026-09-24, hakem bulgu 16): payda BİLİNİYOR ama ≤ 0 (ör. fiyatı yazılı ₺0 numune kalemleri) →
                `tutarsiz` 0, üstteki not null; kartlar/Pay/ABC/tfoot hep '—' ve hiçbir cümle NEDEN demiyordu. GB1 P217 aynı
                yardımcının aynı dalında nedeni yazıyor — burada eşdeğeri (yarım uygulama kapandı). Sabit metin, sayaç yok. */}
            {pay.neden === 'payda-yok' && (
              <p className="text-[11px] text-amber-600">
                {rc(currentLanguage).urun_cirosu_sifir_ya_da_negatif_abc_siniflandirm}
              </p>
            )}

            {/* Product table */}
            <div className="apple-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand" />
                <h3 className="font-bold text-gray-800 text-sm">
                  {rc(currentLanguage).urun_bazinda_satis_performansi}
                </h3>
                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full ml-auto">{urunler.length} {rc(currentLanguage).urun}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider w-8">#</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {oc(currentLanguage).urun}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">ABC</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {oc(currentLanguage).adet_2}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {oc(currentLanguage).siparis_2}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {oc(currentLanguage).gelir}
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">
                        {oc(currentLanguage).pay}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {/* `s.tutar` ile `s.oge.ciro` AYNI `Tutar`dır; tutarlılık için hep `s.oge.ciro` okunur. */}
                    {abc.satirlar.map((s, i) => (
                      <tr key={s.oge.anahtar ?? 'adsiz'} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-[10px] font-bold text-gray-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-semibold text-gray-800 text-xs truncate max-w-[200px]">{s.oge.ad ?? '—'}</p>
                            {/* Yardımcı `sku`yu ayrı taşımaz; anahtar addan farklıysa o SKU'dur (sku === name olan kalemde alt satır artık basılmaz). */}
                            {s.oge.anahtar !== null && s.oge.anahtar !== s.oge.ad && <p className="text-[10px] text-gray-400 font-mono">{s.oge.anahtar}</p>}
                            <div className="mt-1.5">
                              {/* Ray bileşenin İÇİNDE; bilinmeyen = gri taralı + aria-label (satırın kendi cirosu kısmiyse de çizilmez). */}
                              <OlcekCubugu oran={cubukOrani(tutarSatiri(s.oge.ciro), olcek)} kalinlik="h-1" renkSinifi="bg-brand/60" dil={currentLanguage} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${s.sinif === 'A' ? 'bg-emerald-100 text-emerald-700' : s.sinif === 'B' ? 'bg-amber-100 text-amber-700' : s.sinif === 'C' ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
                            {s.sinif ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-semibold text-gray-700">{adetYaz(ekranTutari(s.oge.adet), dil)}</td>
                        {/* PLAN-v2 Y16: BENZERSİZ sipariş sayısı (eski `:70` kalem sayıyordu; sütun başlığı "Sipariş"). */}
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{s.oge.siparisSayisi}</td>
                        <td className="px-4 py-3 text-right text-xs font-bold text-gray-800">{fmtAna(ekranTutari(s.oge.ciro))}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-[10px] font-bold text-gray-500">{yuzdeYaz(s.pay, 1, dil)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">{oc(currentLanguage).toplam}</td>
                      {/* EKRAN sözleşmesi: bilinenlerin kısmi toplamı + aşağıdaki not. */}
                      <td className="px-4 py-3 text-right text-sm font-black text-gray-800">{fmtAna(ekranTutari(pay.toplam))}</td>
                      {/* Sabit '100%' DEĞİL: SON satırın kümülatifi — tam veride '100%' (99,999… da 0 ondalıkla '100%'),
                          payda bilinmiyorsa/yoksa '—', boş listede `undefined` → '—'. */}
                      <td className="px-4 py-3 text-right text-xs font-bold text-gray-500">{yuzdeYaz(pay.satirlar.at(-1)?.kumulatif, 0, dil)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Aynı `pay.toplam.bilinmeyen` sayacı yukarıdaki notta da geçer; TOPLANMAZ, iki ayrı sonucu anlatır
                  (sınıflandırma yapılamadı / toplama dâhil değil). `sonuc` "TABLOYA dâhil değil" DEMEZ (hakem
                  2026-09-24 bulgu 3): miktarı okunamayan ÜRÜN tablodadır (satırı çizilir, Adet hücresi '—'/kısmi);
                  dışarıda kalan şey TOPLAMDIR — tutarsız kalem Gelir/Toplam'a, miktarsız kalem Adet'e girmez.
                  Sarmalayıcı `empty:hidden`: not da dipnot da basılmazsa (React null → çocuk yok) dolgu bandı
                  kalmaz; ikisi birlikte basılınca aralık tek yerden. */}
              <div className="px-5 pt-2 pb-4 space-y-1 empty:hidden">
                <KapsamNotu
                  sayaclar={{ tutarsiz: pay.toplam.bilinmeyen, miktarsiz: miktarsizUrun }}
                  birim="kayit"
                  dil={currentLanguage}
                  sonuc={rc(currentLanguage).toplama_dahil_degil_2}
                  className="text-[11px] text-amber-600"
                />
                {/* K-KALEM=A dipnotu (şartname §Açık sorular 1/A): Mikro `total` KDV DÂHİL, native `price` KDV HARİÇ —
                    tek sütunda karışır; kullanıcı bunu görmeden karşılaştırmasın. Yalnız `total` yolu kullanıldıysa. */}
                {kdvDahilKalem && (
                  <p className="text-[11px] text-gray-400">
                    {rc(currentLanguage).mikro_faturasindan_tureyen_kalemlerde_satir_tuta}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
