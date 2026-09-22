/**
 * GenelOzet.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 50–389).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 */
/*
 * Faz 3 · 6a BAĞLAMA (2026-09-19) — dokuz panelin satır içi hesapları testli saf
 * modüllere bağlandı; bu dosyada artık SAYI ÜRETEN kural yok, yalnız yerleşim + metin.
 *
 * Bağlanan siteler (eski satır → yeni kaynak):
 *   P1  KPI düşük stok ipucu  :60          → rapor/kapsamNotu + ctx.stokDurum
 *   P3  kategori pastası notu :122         → ctx.stokOzet.toplamAdet
 *   P4  MRR/ARR               :127-158     → rapor/abonelik (tekrarlayanGelir, sablonAylikTutari)
 *   P5  sipariş değeri kovası :169-194     → rapor/dagilim (kovayaYerlestir) + pano/cubuk
 *   P6  CCC / DSO / DIO       :213-259     → rapor/nakitDongusu + pano/stokSevkiyat
 *   P7  saate göre            :309-337     → rapor/zamanDagilimi + pano/cubuk
 *   P8  güne göre (ciro)      :359-386     → rapor/zamanDagilimi + pano/cubuk
 *   P9  stok tükenme          :402-443     → rapor/stokTalep (urunTalebi, tukenmeSatirlari, tukenmeListesi)
 *
 * İKİ SÖZLEŞME (src/utils/para.ts — KARIŞTIRMA): ekranda basılan toplam `ekranTutari`
 * (kısmi olabilir, yanında `<KapsamNotu>` durur); BAŞKA bir sayıya girecek toplam
 * `tamTutar` (tek girdi bile bilinmiyorsa NaN → '—', çubuk/rozet ÇİZİLMEZ). İkinci sözleşme
 * bu dosyada ARTIK ÇAĞRILMAZ: türetme kapıları yardımcıların içindedir (`stokDevirGunuTutar`).
 *
 * ÖLÇEK AİLESİ (pano/cubuk — karıştırma): ADET serileri `sayacOlcegi` + `oranYuzde`
 * (P5, P7, P9), PARA serileri `olcekReferansi` + `cubukOrani` (P8).
 *
 * 2026-09-20 HAKEM TURU — iki düzeltme:
 *   (a) P9'un aday kapısı/ufku/sayaçları satır içiydi ve TESTSİZDİ → `rapor/stokTalep.tukenmeListesi`.
 *       P6'nın stok `Tutar` → sayı seçimi de öyleydi → `rapor/nakitDongusu.stokDevirGunuTutar`.
 *   (b) P5 ve P8'de HER kova boşken ölçek yoktu ve `OlcekCubugu` tam boy "bilinmiyor" taralı
 *       çubuk çiziyordu. Adet 0 BİLİNEN bir sayıdır → boş kovanın çubuğu ÇİZİLMEZ (aşağıda).
 */
import React, { useMemo } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { Package, AlertCircle } from 'lucide-react';
import { type ReportsCtx, brutMarj } from '../useReportsData';
import { odemeTakipli, siparisTarih, siparisTutari } from '../../../utils/siparis';
import { KpiCard, KpiGrid, KpiCurrencyToggle, KapsamNotu, OlcekCubugu } from '../ReportKit';
import { paraYaz } from '../../../utils/currency';
import { oc } from '../../../i18n/ortak';
import { toplaBilinen, ekranTutari } from '../../../utils/para';
import { kapsamNotu } from '../../../utils/rapor/kapsamNotu';
import { tekrarlayanGelir, sablonAylikTutari } from '../../../utils/rapor/abonelik';
import { kovayaYerlestir, type KovaSiniri } from '../../../utils/rapor/dagilim';
import { zamanKovalari } from '../../../utils/rapor/zamanDagilimi';
import { alacakDevirGunu, nakitDongusu, stokDevirGunuTutar } from '../../../utils/rapor/nakitDongusu';
import { talepKartCozucu, urunTalebi, tukenmeSatirlari, tukenmeListesi } from '../../../utils/rapor/stokTalep';
import { sayacOlcegi, olcekReferansi, cubukOrani, tutarSatiri } from '../../../utils/pano/cubuk';
import { oranYuzde } from '../../../utils/siparisler/lojistikKpi';
import { degerToplami } from '../../../utils/pano/stokSevkiyat';
import { kartMaliyetiTL, cevrilemeyenler, cevrilemeyenMesaji } from '../../../utils/cost';
import { adetYaz } from '../../../utils/muhasebe/depoDeger';

/*
 * K20 — kullanıcı 2026-09-19: "ok kalsın." Koda gömülü eşik/kova DEĞERLERİ DEĞİŞMEZ;
 * yalnız adlandırılır (ve ekranda dipnotu olan yerlerde dipnotu kalır).
 */
/** P189 sipariş değeri kovaları — üst sınır HARİÇ, son kova `Infinity` (üst taşma olmaz). */
const SIPARIS_DEGERI_KOVALARI: readonly KovaSiniri[] = [
  { etiket: '<₺1K', ust: 1000 },
  { etiket: '₺1-5K', ust: 5000 },
  { etiket: '₺5-20K', ust: 20000 },
  { etiket: '₺20-100K', ust: 100000 },
  { etiket: '₺100K+', ust: Infinity },
];
/** P185 CCC penceresi (gün) — DSO paydası ve DIO günlük COGS'u AYNI pencereden. */
const CCC_PENCERE_GUN = 90;
/** P148 talep penceresi (gün) — "son 30 gün satış hızı". */
const TUKENME_PENCERE_GUN = 30;
/** P148 aday kapısı: stok ≤ kritik eşik × bu çarpan. */
const TUKENME_ESIK_CARPANI = 3;
/** P148 ufku (gün): bu sürenin ötesinde tükenecek ürün listelenmez; çubuk tavanı da budur. */
const TUKENME_UFUK_GUN = 45;
/** P148 kırmızı eşiği (gün). */
const TUKENME_ACIL_GUN = 7;
/** P148 sarı eşiği (gün). */
const TUKENME_UYARI_GUN = 20;
/** P148 listede gösterilen en çok satır. */
const TUKENME_SATIR = 8;

/**
 * `ciroTutar`: ciro kartının KISMİ olup olmadığını söyleyen sayaç (`useReportsData`).
 * `revenueFormatted` `ekranTutari` ile üretilir — tutarı okunamayan sipariş toplamın
 * DIŞINDADIR — ama 2026-09-19'a kadar bu sayaç hiçbir ekrana geçmiyordu: kullanıcı
 * kısmi ciroyu kesin rakam sanıyordu (EKRAN sözleşmesi: '—' VEYA açık not).
 */
type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'exchangeRates' | 'currentT' | 'currentLanguage' | 'onNavigate' | 'recurringOrders' | 'fmtAna' | 'totalOrders' | 'revenueSymbol' | 'revenueFormatted' | 'avgOrderFormatted' | 'ciroTutar' | 'lowStockItems' | 'stokDurum' | 'stokOzet' | 'trendData' | 'categoryChartData' | 'COLORS' | 'revenueCurrency' | 'setRevenueCurrency'>;

export default function GenelOzet({ reportsTab, orders, inventory, exchangeRates, currentT, currentLanguage, onNavigate, recurringOrders, fmtAna, totalOrders, revenueSymbol, revenueFormatted, avgOrderFormatted, ciroTutar, lowStockItems, stokDurum, stokOzet, trendData, categoryChartData, COLORS, revenueCurrency, setRevenueCurrency }: Props) {
  // Tutarı okunamayan sipariş sayısı — ciro toplamına GİRMEZ, ortalamayı da hesaplatmaz.
  const tutarsizSiparis = ciroTutar.bilinmeyen;
  const ciroNotu = tutarsizSiparis > 0
    ? (currentLanguage === 'tr'
        ? `${tutarsizSiparis} siparişin tutarı bilinmiyor — toplama dâhil değil`
        : `${tutarsizSiparis} order(s) unpriced — excluded from the total`)
    : undefined;
  const ortalamaNotu = tutarsizSiparis > 0
    ? (currentLanguage === 'tr'
        ? `${tutarsizSiparis} siparişin tutarı bilinmiyor — ortalama hesaplanamıyor`
        : `${tutarsizSiparis} order(s) unpriced — average not computed`)
    : undefined;
  // Trend grafiğinin GÖSTERİLEN 30 gününde tutarı okunamayan sipariş sayısı (ciro kartının
  // sayacından AYRI: grafik son 30 kovayla sınırlı, kart tüm dönemi kapsıyor).
  const trendGunlukTutarsiz = trendData.reduce((s, g) => s + g.bilinmeyen, 0);
  // Düşük Stok KPI ipucu: seviyesi okunamayan ve eşiği tanımsız ürünler SAYIYA GİRMEZ
  // (`stokDurumu` kuralı) — 2026-09-19'a kadar kart bunu söylemiyordu, kullanıcı
  // "N ürün kritik" rakamını tam sanıyordu. İki sayaç da ÜRÜN birimindedir (tek çağrı).
  const dusukStokNotu = kapsamNotu(
    { miktarsiz: stokDurum.seviyesiBilinmeyen, esiksiz: stokDurum.esigiBilinmeyen },
    {
      birim: 'urun',
      dil: currentLanguage,
      sonuc: currentLanguage === 'tr' ? 'sayıya dâhil değil' : 'not included in the count',
    },
  ) ?? undefined;

  // ── P148 stok tükenme: TEK geçişli talep ──────────────────────────────────
  // Eski kod kalem BAŞINA tüm sipariş listesini yeniden tarıyordu (O(kart × sipariş)) ve
  // sipariş içinde yalnız İLK eşleşen kalemi sayıyordu (`find`) — aynı üründen iki satır
  // içeren sipariş günlük tüketimi DÜŞÜK gösterip uyarıyı geciktiriyordu.
  // Hook olduğu için bileşenin ÜST DÜZEYİNDE durur (panel IIFE'sinin içinde olamaz).
  const talep148 = useMemo(
    () => urunTalebi(orders, {
      pencereGun: TUKENME_PENCERE_GUN,
      simdi: new Date(),
      kartSec: talepKartCozucu(inventory),
    }),
    [orders, inventory],
  );
  const satirlar148 = useMemo(
    () => (talep148 === null ? [] : tukenmeSatirlari(talep148, TUKENME_PENCERE_GUN)),
    [talep148],
  );
  // Aday kapısı + ufuk süzgeci + sıralama/kesme + üç sayaç: `rapor/stokTalep.tukenmeListesi`
  // (2026-09-20 hakem turu). Blok buraya kadar satır içiydi ve testsizdi; eşiği tanımsız karta
  // uydurma 5 varsayılanını geri koyan bir mutasyon yakalanmadan geçti — kural artık testli
  // modülde, burada yalnız sabitler geçiliyor.
  const p148 = useMemo(
    () => tukenmeListesi(satirlar148, inventory, {
      carpan: TUKENME_ESIK_CARPANI,
      ufukGun: TUKENME_UFUK_GUN,
      satir: TUKENME_SATIR,
    }),
    [satirlar148, inventory],
  );
  return (
    <>
      {reportsTab === 'genel' && (
        <div className="space-y-6">
          {/* KPI Cards — ortak KpiCard/KpiGrid (ReportKit) ile tek tip */}
          <KpiGrid>
            {([
              { label: currentT.kpi_revenue, value: revenueFormatted, hint: ciroNotu, icon: undefined, symbol: revenueSymbol, accent: 'text-brand', accentBg: 'bg-brand/10', tab: 'crm', money: true },
              { label: currentT.kpi_orders, value: String(totalOrders), hint: undefined, icon: Package, symbol: undefined, accent: 'text-blue-500', accentBg: 'bg-blue-50', tab: 'crm', money: false },
              { label: currentT.kpi_avg_order, value: avgOrderFormatted, hint: ortalamaNotu, icon: undefined, symbol: revenueSymbol, accent: 'text-green-500', accentBg: 'bg-green-50', tab: 'crm', money: false },
              { label: currentT.kpi_low_stock, value: String(lowStockItems), hint: dusukStokNotu, icon: AlertCircle, symbol: undefined, accent: 'text-orange-500', accentBg: 'bg-orange-50', tab: 'inventory', money: false },
            ] as { label: string; value: string; hint?: string; icon?: React.ElementType; symbol?: string; accent: string; accentBg: string; tab: string; money: boolean }[]).map((kpi, i) => (
              <KpiCard
                key={kpi.tab + i}
                index={i}
                label={kpi.label}
                value={kpi.value}
                hint={kpi.hint}
                icon={kpi.icon}
                symbol={kpi.symbol}
                accent={kpi.accent}
                accentBg={kpi.accentBg}
                action={kpi.money ? <KpiCurrencyToggle value={revenueCurrency} onChange={setRevenueCurrency} /> : undefined}
                onClick={() => onNavigate?.(kpi.tab)}
                linkHint={oc(currentLanguage).detaya_git}
              />
            ))}
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.sales_trend}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff4000" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#ff4000" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5F7" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#86868B' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="value" stroke="#ff4000" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {/* Grafikte tutarı okunamayan gün `null` olduğu için nokta ATLANIR (çizgi
                  sıfıra çakılmaz) — ama atlandığı da söylenmeli: sayaç veri katmanında
                  (`trendData[].bilinmeyen`) üretiliyor, 2026-09-19'a dek basılmıyordu. */}
              {trendGunlukTutarsiz > 0 && (
                <p className="text-[11px] text-amber-600 mt-2">
                  {currentLanguage === 'tr'
                    ? `${trendGunlukTutarsiz} siparişin tutarı okunamadı — grafikteki günlere dâhil değil.`
                    : `${trendGunlukTutarsiz} order(s) unpriced — not included in the daily points.`}
                </p>
              )}
            </div>
            <div className="apple-card p-8">
              <h3 className="text-lg font-bold mb-6">{currentT.category_dist}</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={categoryChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                      {categoryChartData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
              {/* Stok seviyesi okunamayan kalem dilime GİRMEZ (`grupStokDegeri` kuralı); kategorisi
                  yalnız o kalemlerden oluşan grup pastada 0 çizer — kaybolmasın diye sayısı yazılır. */}
              <KapsamNotu
                sayaclar={{ miktarsiz: stokOzet.toplamAdet.bilinmeyen }}
                birim="urun"
                dil={currentLanguage}
                sonuc={currentLanguage === 'tr' ? 'dilimlere dâhil değil' : 'not included in the slices'}
              />
            </div>
          </div>

          {/* ── Phase 181: Monthly Recurring Revenue (MRR) ── */}
      {reportsTab === 'genel' && (() => {
        // K19 — kullanıcı 2026-09-19: "Daha satışa başlamadık ama önerin ok."
        // Haftalık katsayı 52 ÷ 12 (eski satır içi ×4 değil); sıklığı bilinmeyen şablon
        // TOPLANMAZ, SAYILIR. Katsayının TEK evi `utils/rapor/abonelik.ts` — burada yok.
        const tg = tekrarlayanGelir(recurringOrders);
        if (tg.aktif === 0) return null;
        const activeRO = recurringOrders.filter(r => r.active);
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🔁 Aylık Tekrarlayan Gelir (MRR)' : '🔁 Monthly Recurring Revenue (MRR)'}</h3>
              <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">{tg.aktif} {currentLanguage==='tr'?'aktif şablon':'active templates'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-emerald-50 rounded-2xl p-4">
                <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide">MRR</p>
                {/* EKRAN toplamı: kısmi olabilir, altındaki not kaç şablonun dışarıda kaldığını söyler. */}
                <p className="text-3xl font-black text-emerald-700 mt-1">{fmtAna(ekranTutari(tg.mrr),'K',1)}</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">{currentLanguage==='tr'?'Aylık tekrarlayan':'Monthly recurring'}</p>
              </div>
              <div className="bg-blue-50 rounded-2xl p-4">
                <p className="text-[10px] text-blue-700 font-bold uppercase tracking-wide">ARR</p>
                {/* TÜRETME: tek şablon bile bilinmiyorsa `tg.arr` NaN → '—' (kısmi MRR × 12 YOK). */}
                <p className="text-3xl font-black text-blue-700 mt-1">{fmtAna(tg.arr,'K',0)}</p>
                <p className="text-[10px] text-blue-600 mt-0.5">{currentLanguage==='tr'?'Yıllık projeksiyon':'Annual projection'}</p>
              </div>
            </div>
            {/* NEDEN KIRILIMI (delta 2026-09-22): `tg.mrr.bilinmeyen` TEK sayaç olarak geçilince
                sıklığı tanınmayan şablon da "tutarı okunamadı" diye raporlanıyordu — `abonelik.ts`
                `sablonAylikTutari` frekans tanınmazsa TUTAR BİLİNSE BİLE NaN döndürür. Kullanıcı
                ₺12.000'i yerinde bulup sorunu 'yok' sanıyor, ARR kalıcı '—' kalıyordu. `abonelik`
                kırılımı zaten üretiyordu (değişmez: `tutarsiz + bilinmeyenFrekans === mrr.bilinmeyen`),
                hiçbir yüzey okumuyordu. Toplam DEĞİŞMEZ; çift sayım YOK (iki sayaç ayrık). */}
            <KapsamNotu
              sayaclar={{ tutarsiz: tg.tutarsiz, sikligisiz: tg.bilinmeyenFrekans }}
              birim="sablon"
              dil={currentLanguage}
              sonuc={currentLanguage === 'tr' ? 'MRR kısmi toplam; ARR hesaplanmadı' : 'MRR is a partial total; ARR not calculated'}
            />
            <div className="space-y-1.5">
              {activeRO.slice(0, 4).map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700 truncate">{r.templateName} · {r.customerName}</span>
                  <span className="font-bold text-emerald-600 shrink-0 ml-2">{fmtAna(Math.round(sablonAylikTutari(r)))}/m</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Phase 189: Order Value Distribution ── */}
      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // Tutar seçici `siparisTutari` (`totalPrice ?? totalAmount`) — sayfanın TEK tanımı.
        // Eski `o.totalPrice || 0` tutarsız siparişi '<₺1K' kovasına yazıyor, negatif tutarlı
        // iadeyi ise hiçbir kovaya koymadan SESSİZCE düşürüyordu; ikisi de artık sayılıyor.
        const d189 = kovayaYerlestir(
          orders.filter(o => o.status !== 'Cancelled'),
          siparisTutari,
          SIPARIS_DEGERI_KOVALARI,
        );
        // ADET ölçeği (`, 1` uydurma tabanı YOK): boş kovanın %3'lük hayalet çubuğu kalkar.
        // `null` = HİÇBİR kovada pozitif adet yok (tüm siparişler iptal, ya da hepsinin tutarı
        // okunamadı → hepsi `bilinmeyen`e gitti). Adet BİLİNEN bir sayıdır: o durumda her kova
        // gerçek 0'dır, "bilinmiyor" DEĞİL — bkz. aşağıdaki `k.adet === 0 ? 0 : …`.
        const olcek189 = sayacOlcegi(d189.kovalar.map(k => k.adet));
        const colors = ['bg-blue-300', 'bg-blue-400', 'bg-brand/70', 'bg-brand', 'bg-purple-500'];
        return (
          <div className="apple-card p-6">
            <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '📊 Sipariş Değeri Dağılımı' : '📊 Order Value Distribution'}</h3>
            <div className="flex items-end gap-3 h-28 mb-3">
              {d189.kovalar.map((k, i) => (
                <div key={k.etiket} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                    {/* 2026-09-20 hakem turu: `oranYuzde(0, null)` → `null` → `OlcekCubugu` TAM BOY
                        taralı "bilinmiyor" çubuğu çiziyordu; altındaki rakam ise "0" diyordu. Ölçek
                        yalnız HER kova 0 iken yoktur ve o zaman kovanın adedi bilinen 0'dır —
                        çubuk çizilmez. Ölçek varken `oranYuzde(0, olcek)` zaten 0 verir (parite). */}
                    <OlcekCubugu
                      yon="dikey"
                      oran={k.adet === 0 ? 0 : oranYuzde(k.adet, olcek189)}
                      renkSinifi={colors[i]}
                      koseSinifi="rounded-t-lg"
                      dil={currentLanguage}
                      title={`${k.adet} ${oc(currentLanguage).siparis} · ${paraYaz(ekranTutari(k.tutar), { ondalik: 0 })}`}
                    />
                  </div>
                  <span className="text-[8px] text-gray-400 text-center leading-tight">{k.etiket}</span>
                  <span className="text-[9px] font-bold text-gray-600">{k.adet}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400">{currentLanguage==='tr'?'Sayı, sipariş başına sipariş değerine göre':'Order count by order value range'}</p>
            <KapsamNotu
              sayaclar={{ tutarsiz: d189.bilinmeyen, kapsamDisi: d189.kapsamDisi }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={currentLanguage === 'tr' ? 'dağılıma dâhil değil' : 'not included in the distribution'}
            />
          </div>
        );
      })()}

      {/* ── Phase 185: Cash Conversion Cycle (CCC) ── */}
      {reportsTab === 'genel' && orders.length >= 5 && inventory.length > 0 && (() => {
        const now185 = new Date();
        const cutoff185 = new Date(now185); cutoff185.setDate(cutoff185.getDate() - CCC_PENCERE_GUN);
        // PAY ve PAYDA AYNI KUMEDEN (2026-09-04 denetimi): AR yalniz Cetpa'da
        // odemesi izlenen siparislerden gelir (Mikro turevlerinde `paid` yok,
        // tahsilat Mikro cari hesapta). Payda tum ciroyu alirsa — Mikro dahil —
        // DSO yapay olarak DUSUK cikiyordu.
        const izlenen185 = orders.filter(o => odemeTakipli(o));
        // K15 — KARAR VERİLDİ, 6c'de uygulanacak (6a ARA DURUM). Kullanıcı bu kümeyi REDDETTİ (2026-09-19):
        //   "Teslim edilmiş ama parası alınmamış sipariş alacağa girmiyor." → "girmeli."
        //   "Teslim edilmemiş ama peşin ödenmiş sipariş alacak görünüyor." → "girmemeli. Sadece teslimat bekliyor olmalı."
        // Aşağıdaki süzgeç (iptal olmayan + teslim edilmemiş; ödenip ödenmediğine HİÇ bakmıyor) iki cümlenin de TERSİDİR.
        // Defter tanımı (B: Mikro cari bakiyeleri + faturalanmamış ödenmemiş Cetpa siparişleri) ve "teslimat bekleyenler"
        // kovası 6c'de gelir; o güne kadar DSO/CCC bu kümeden üretilir.
        const unPaidOrders = izlenen185.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered');
        const alacak185 = toplaBilinen(unPaidOrders, siparisTutari);
        const son90 = (list: typeof orders) => list.filter(o => {
          const od = siparisTarih(o);
          return !!od && od >= cutoff185 && o.status !== 'Cancelled';
        });
        const ciro90 = toplaBilinen(son90(izlenen185), siparisTutari);
        // DSO TÜRETİLEN sayıdır: alacak ya da ciro KISMİ ise üretilmez ('—' + neden).
        // Eski `dailyRev185 > 0 ? Math.round(ar / daily) : null` kısmi alacaktan küçük bir
        // DSO çıkarıp panelde "sağlıklı" yazdırabiliyordu.
        const { dso, neden: dsoNedeni } = alacakDevirGunu(alacak185, ciro90, CCC_PENCERE_GUN);
        // DIO: stok degeri / gunluk GERCEK maliyet.
        // Eskiden `monthly90Rev * 0.6` ile "%60 COGS varsayimi" kullaniliyordu —
        // gercek kalem maliyeti elde varken uydurma orandi (sahte kesinlik).
        // DIO'nun PAYI tum stok, PAYDASI yalniz KALEMLI siparislerin COGS'u: kalem verisi olmayan
        // (Mikro faturasindan turetilen) TEK siparis bile COGS'u eksik birakir → DIO ve dolayisiyla
        // CCC BILINMIYOR ('—'), 0 DEGIL. Kural + nedenler: `raporMarj.stokDevirGunu` (testli).
        // PAY da artık kısmi DEĞİL (2026-09-19, 6a): `kartMaliyetiTL` maliyeti çözülemeyen kaleme
        // `null` döner (`itemCostTRY`in 0'ı gibi sessizce toplamı düşürmez) ve `degerToplami`
        // onu `bilinmeyen` sayar → `stokDevirGunuTutar`ın `tamTutar` kapısı → 'stok-bilinmiyor'.
        // K8 (alış günü kuru / bugünün kuru çifti + son alış sütunu) 6h'de; burada taban MALİYET
        // olarak KALIR (rakam parite), yalnız alt etiket tabanı açıkça yazar.
        const stok185 = degerToplami(inventory, i => kartMaliyetiTL(i, exchangeRates));
        const marj90 = brutMarj(son90(orders), inventory, exchangeRates);
        // DIO ve CCC TÜRETİLEN sayılardır → `stokDevirGunuTutar` (2026-09-19 delta bulgusu).
        // `Tutar` GEÇİLİR, sayı değil (2026-09-20 hakem turu): stok değerinin TÜRETME sözleşmesiyle
        // (`tamTutar`) çevrildiğini kilitleyen test o köprünün yanında duruyor; burada satır içi
        // yapılan seçim `ekranTutari`ye çevrildiğinde hiçbir test kırılmıyordu.
        // `marj90.maliyet` bir EKRAN toplamıdır: maliyeti çözülemeyen sipariş toplama GİRMEZ,
        // SAYILIR. O kısmi COGS'tan DIO üretmek günlük maliyeti olduğundan küçük gösterir ve
        // DIO'yu şişirir — 100 siparişin 40'ında katalogda olmayan bir kalem varsa ~45 günlük
        // gerçek DIO ekranda ~75 gün çıkıyor, CCC kırmızı basılıyor ve "nakit sıkışıklığı riski
        // var" HÜKMÜ kısmi veriden üretiliyordu. Tek kayıt bile eksikse hesaplanmaz ('—').
        // Kapı artık `kapsamDisi`yi de görür (son inceleme: 300 kalemsiz fatura + 10 kalemli sipariş
        // "1350 gün — nakit sıkışıklığı riski var" basıyordu).
        const { dio, neden: dioNedeni } = stokDevirGunuTutar(stok185, marj90, CCC_PENCERE_GUN);
        const { ccc } = nakitDongusu({ dso, dio });
        const cccColor = ccc === null ? 'text-gray-400' : ccc <= 30 ? 'text-emerald-600' : ccc <= 60 ? 'text-amber-500' : 'text-red-500';
        // Stok değeri neden bilinmiyor: önce kur/birim ayrıntısını veren mevcut mesaj
        // (`cost.cevrilemeyenMesaji`), o da yoksa düz sayaç cümlesi. Yalnız ilgili dalda çağrılır.
        const stokBilinmeyenMetni = (): string => {
          const mesaj = cevrilemeyenMesaji(
            cevrilemeyenler(inventory, exchangeRates),
            currentLanguage === 'tr' ? 'tr' : 'en',
          );
          if (mesaj !== null) return mesaj;
          return currentLanguage === 'tr'
            ? `${stok185.bilinmeyen} kalemin maliyeti bilinmiyor`
            : `${stok185.bilinmeyen} item(s) have an unknown cost`;
        };
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '⏱️ Nakit Dönüşüm Döngüsü (CCC)' : '⏱️ Cash Conversion Cycle (CCC)'}</h3>
              <span className={`text-lg font-black ${cccColor}`}>{ccc === null ? '—' : `${ccc} ${currentLanguage === 'tr' ? 'gün' : 'days'}`}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'DSO', desc: currentLanguage === 'tr' ? 'Alacak Tahsilat Süresi' : 'Days Sales Outstanding', value: dso, color: dso === null ? 'text-gray-400' : dso > 45 ? 'text-red-500' : dso > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `${fmtAna(ekranTutari(alacak185), 'K', 0)} ödenmemiş` : `${fmtAna(ekranTutari(alacak185), 'K', 0)} outstanding` },
                { label: 'DIO', desc: currentLanguage === 'tr' ? 'Stok Elde Tutma Süresi' : 'Days Inventory Outstanding', value: dio, color: dio === null ? 'text-gray-400' : dio > 60 ? 'text-red-500' : dio > 30 ? 'text-amber-500' : 'text-emerald-600', sub: currentLanguage === 'tr' ? `${fmtAna(ekranTutari(stok185), 'K', 0)} stok (maliyetle)` : `${fmtAna(ekranTutari(stok185), 'K', 0)} stock (at cost)` },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-4">
                  <p className={`text-3xl font-black ${k.color}`}>{k.value === null ? '—' : <>{k.value}<span className="text-sm font-medium text-gray-400 ml-1">{oc(currentLanguage).gun}</span></>}</p>
                  <p className="text-[11px] text-gray-700 font-semibold mt-1">{k.label} · {k.desc}</p>
                  <p className="text-[10px] text-gray-400">{k.sub}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-3">
              <span className="text-blue-500 text-sm">💡</span>
              {/* '—' nedenini AYIRT EDEREK yaz (2026-09-19): "kalem maliyeti olan sipariş yok"
                  cümlesi, maliyeti çözülemeyen sipariş VARKEN yanlıştı. Sıra: önce DSO nedenleri
                  (yeni, 6a), sonra DIO nedenleri — ekranda TEK neden görünür. */}
              <p className="text-[11px] text-blue-700">{ccc === null
                ? (dsoNedeni === 'alacak-bilinmiyor'
                    ? (currentLanguage === 'tr'
                        ? `CCC = DSO + DIO. Şu an hesaplanamıyor: ${alacak185.bilinmeyen} alacağın tutarı okunamadı — DSO kısmi alacaktan üretilmez.`
                        : `CCC = DSO + DIO. Not computable: ${alacak185.bilinmeyen} receivable(s) with an unreadable amount — DSO is not derived from a partial receivable balance.`)
                    : dsoNedeni === 'ciro-bilinmiyor'
                    ? (currentLanguage === 'tr'
                        ? `CCC = DSO + DIO. Şu an hesaplanamıyor: ${ciro90.bilinmeyen} siparişin tutarı okunamadı — DSO kısmi bir cirodan üretilmez.`
                        : `CCC = DSO + DIO. Not computable: ${ciro90.bilinmeyen} order(s) with an unreadable amount — DSO is not derived from a partial revenue figure.`)
                    : dsoNedeni === 'ciro-yok'
                    ? (currentLanguage === 'tr'
                        ? 'CCC = DSO + DIO. Şu an hesaplanamıyor: son 90 günde ödemesi izlenen ciro yok.'
                        : 'CCC = DSO + DIO. Not computable: no payment-tracked revenue in the last 90 days.')
                    : dioNedeni === 'maliyet-bilinmiyor'
                    ? (currentLanguage === 'tr'
                        ? `CCC = DSO + DIO. Şu an hesaplanamıyor: ${marj90.maliyetTutar.bilinmeyen} siparişin maliyeti çözülemedi — DIO kısmi bir maliyetten üretilmez.`
                        : `CCC = DSO + DIO. Not computable: ${marj90.maliyetTutar.bilinmeyen} order(s) with unresolved cost — DIO is not derived from a partial COGS.`)
                    : dioNedeni === 'kalemsiz-siparis'
                    ? (currentLanguage === 'tr'
                        ? `CCC = DSO + DIO. Şu an hesaplanamıyor: ${marj90.kapsamDisi} siparişin kalem verisi yok (Mikro faturasından türetilen kayıtlar) — satılan malın maliyeti eksik, DIO kısmi bir maliyetten üretilmez.`
                        : `CCC = DSO + DIO. Not computable: ${marj90.kapsamDisi} order(s) have no line items (derived from Mikro invoices) — COGS is incomplete, DIO is not derived from a partial COGS.`)
                    : dioNedeni === 'maliyetli-siparis-yok'
                    ? (currentLanguage === 'tr'
                        ? 'CCC = DSO + DIO. Şu an hesaplanamıyor: son 90 günde kalem maliyeti olan sipariş yok.'
                        : 'CCC = DSO + DIO. Not computable: no orders with line-item cost data in the last 90 days.')
                    : dioNedeni === 'stok-bilinmiyor'
                    ? (currentLanguage === 'tr'
                        ? `CCC = DSO + DIO. Şu an hesaplanamıyor: ${stokBilinmeyenMetni()} — DIO kısmi bir stok değerinden üretilmez.`
                        : `CCC = DSO + DIO. Not computable: ${stokBilinmeyenMetni()} — DIO is not derived from a partial inventory value.`)
                    : (currentLanguage === 'tr'
                        ? 'CCC = DSO + DIO. Şu an hesaplanamıyor: DSO ya da DIO için yeterli veri yok.'
                        : 'CCC = DSO + DIO. Not computable: not enough data for DSO or DIO.'))
                : (currentLanguage === 'tr'
                    ? `CCC = DSO + DIO. Hedef: 30 günün altı. Şu an: ${ccc} gün${ccc > 60 ? ' — nakit sıkışıklığı riski var.' : ccc > 30 ? ' — iyileştirilebilir.' : ' — sağlıklı.'}`
                    : `CCC = DSO + DIO. Target: under 30 days. Now: ${ccc} days.`)}</p>
            </div>
            {/* DIO artık KISMİ bir COGS'tan ÜRETİLMİYOR (2026-09-19): maliyeti çözülemeyen tek
                sipariş bile varsa hesaplanmaz. Not, hangi kayıtların eksik olduğunu söyler —
                eski metin "DIO bu kayıtları İÇERMEZ (daha düşük olabilir)" diyerek kısmi
                COGS'tan üretilmiş bir sayıyı meşrulaştırıyordu. */}
            {(marj90.maliyetTutar.bilinmeyen > 0 || marj90.kapsamDisi > 0) && (
              <p className="text-[10px] text-amber-600 mt-2">
                {currentLanguage === 'tr'
                  ? `${marj90.maliyetTutar.bilinmeyen} siparişin maliyeti çözülemedi, ${marj90.kapsamDisi} siparişin kalem verisi yok — DIO ve CCC HESAPLANMADI.`
                  : `${marj90.maliyetTutar.bilinmeyen} order(s) with unresolved cost, ${marj90.kapsamDisi} without line items — DIO and CCC NOT computed.`}
              </p>
            )}
            {/* Alacak / ciro sayaçları BURADA toplanmaz: aynı sipariş iki kümede de olabilir
                (çift sayım). Sayılarını yukarıdaki `dsoNedeni` cümlesi tek tek yazar. */}
            <KapsamNotu
              sayaclar={{ maliyetsiz: stok185.bilinmeyen }}
              birim="urun"
              dil={currentLanguage}
              sonuc={currentLanguage === 'tr' ? 'stok değerine dâhil değil' : 'not included in the stock value'}
            />
          </div>
        );
      })()}

      {/* ── Phase 186: Sales by Hour of Day ── */}
      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // 8 × 3 saatlik kova. `rev` alanı eskiden toplanıyor ama HİÇ render edilmiyordu
        // (ölü toplam) — canlandırılmadı: `tutarSec` VERİLMEZ.
        const z186 = zamanKovalari(
          orders.filter(o => o.status !== 'Cancelled'),
          8,
          d => Math.floor(d.getHours() / 3),
          { tarihSec: o => o.createdAt },
        );
        // `enYogun === null` ⇔ hiçbir siparişin tarihi çözülemedi (eski `hasHours` kapısı).
        if (z186.enYogun === null) return null;
        const olcek186 = sayacOlcegi(z186.kovalar.map(k => k.adet));
        const zirveEtiketi = `${z186.enYogun * 3}:00-${z186.enYogun * 3 + 2}:59`;
        return (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '🕐 Saate Göre Satış Dağılımı' : '🕐 Sales by Hour of Day'}</h3>
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{currentLanguage === 'tr' ? `Zirve: ${zirveEtiketi}` : `Peak: ${zirveEtiketi}`}</span>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {z186.kovalar.map((k, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '72px' }}>
                    {/* Beraberlikte İLK kova boyanır (eski kod tepeyle AYNI adetli HER kovayı
                        marka rengine boyuyordu — "zirve" rozeti tekken birden çok zirve çiziliyordu). */}
                    <OlcekCubugu
                      yon="dikey"
                      oran={oranYuzde(k.adet, olcek186)}
                      renkSinifi={i === z186.enYogun ? 'bg-brand' : 'bg-blue-200'}
                      dil={currentLanguage}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 leading-none text-center">{i * 3}h</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-gray-400">0:00</span>
              <span className="text-[10px] text-gray-400">12:00</span>
              <span className="text-[10px] text-gray-400">21:00</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'Her çubuk 3 saatlik dilimi temsil eder' : 'Each bar represents a 3-hour window'}</p>
            <KapsamNotu
              sayaclar={{ tarihsiz: z186.tarihsiz }}
              birim="siparis"
              dil={currentLanguage}
              sonuc={currentLanguage === 'tr' ? 'dağılıma dâhil değil' : 'not included in the distribution'}
            />
          </div>
        );
      })()}

      {/* ── Phase 147: Revenue by Day of Week ── */}
          {orders.length >= 5 && (() => {
            const dayNames = currentLanguage === 'tr'
              ? ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const z147 = zamanKovalari(
              orders.filter(o => o.status !== 'Cancelled'),
              7,
              d => d.getDay(),
              { tarihSec: o => o.createdAt, tutarSec: siparisTutari },
            );
            // PARA ölçeği (`olcekReferansi`, ADET ölçeği DEĞİL): tepe günün cirosu KISMİYSE
            // ölçek yoktur ve o listede hiçbir çubuk çizilmez — kısmi bir tepeye göre çizilen
            // çubuklar alt günleri olduğundan uzun gösteriyordu.
            const olcek147 = olcekReferansi(z147.kovalar.map(k => tutarSatiri(k.ciro)));
            const tutarsiz147 = z147.kovalar.reduce((s, k) => s + k.ciro.bilinmeyen, 0);
            return (
              <div className="apple-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800">{currentLanguage === 'tr' ? '📅 Güne Göre Satış Dağılımı' : '📅 Revenue by Day of Week'}</h3>
                  {/* Hiçbir günün cirosu BİLİNMİYORSA rozet ÇİZİLMEZ — eski `reduce(..., dayCounts[0])`
                      boş veride "En iyi gün: Paz" uyduruyordu. */}
                  {z147.enCokCiro !== null && (
                    <span className="text-xs text-gray-500">{currentLanguage === 'tr' ? 'En iyi gün:' : 'Best day:'} <span className="font-bold text-brand">{dayNames[z147.enCokCiro]}</span></span>
                  )}
                </div>
                <div className="flex items-end gap-2 h-32">
                  {z147.kovalar.map((k, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-default">
                      <div className="w-full flex flex-col justify-end" style={{ height: '96px' }}>
                        {/* `k.adet === 0` = o güne HİÇ sipariş düşmedi → cirosu gerçek ₺0'dır.
                            2026-09-20 hakem turu: hiçbir günde sipariş yokken `olcekReferansi` NaN
                            döner ve `cubukOrani` yedi kovada da `null` verir — ekranda yedi tam boy
                            taralı "bilinmiyor" çubuğu, hem de notsuz. Ölçek varken bu ternary
                            no-op'tur (`cubukOrani({ciro: 0}, ref)` zaten 0). Tutarı okunamayan
                            SİPARİŞİ olan gün bu daldan geçmez: orada 'bilinmiyor' DOĞRU cevaptır. */}
                        <OlcekCubugu
                          yon="dikey"
                          oran={k.adet === 0 ? 0 : cubukOrani(tutarSatiri(k.ciro), olcek147)}
                          renkSinifi={i === z147.enCokCiro ? 'bg-brand' : 'bg-brand/30 hover:bg-brand/60'}
                          koseSinifi="rounded-t-lg"
                          dil={currentLanguage}
                          title={`${paraYaz(ekranTutari(k.ciro), { ondalik: 0 })} · ${k.adet} ${oc(currentLanguage).siparis}`}
                        />
                      </div>
                      <span className={`text-[10px] font-semibold ${i === z147.enCokCiro ? 'text-brand' : 'text-gray-400'}`}>{dayNames[i]}</span>
                    </div>
                  ))}
                </div>
                {/* İki sayaç da SİPARİŞ birimi (tek çağrı) ve kümeler AYRIK: tarihi çözülemeyen
                    sipariş hiçbir kovaya girmediği için `ciro.bilinmeyen`de SAYILMAZ. */}
                <KapsamNotu
                  sayaclar={{ tutarsiz: tutarsiz147, tarihsiz: z147.tarihsiz }}
                  birim="siparis"
                  dil={currentLanguage}
                  sonuc={currentLanguage === 'tr' ? 'günlük ciroya dâhil değil' : 'not included in daily revenue'}
                />
              </div>
            );
          })()}

          {/* ── Phase 148: Days-to-Stockout Forecast ── */}
          {inventory.length > 0 && (() => {
            // `urunTalebi` yalnız pencere ya da `simdi` geçersizse null döner; ikisi de burada
            // SABİT (TUKENME_PENCERE_GUN = 30, `new Date()`) → bu dal pratikte ULAŞILMAZ.
            // Yine de sıfır sayaç UYDURMAK yerine panel çizilmez.
            if (talep148 === null) return null;
            // Liste boş AMA dışarıda kalan ürün varsa panel NOT ile görünür (eskiden tümüyle
            // kayboluyordu); üçü de 0 ise (`bos`) bugünkü gibi hiç çizilmez.
            if (p148.bos) return null;
            return (
              <div className="apple-card p-6">
                <h3 className="font-bold text-gray-800 mb-2">{currentLanguage === 'tr' ? '⏱️ Stok Tükenme Tahmini' : '⏱️ Days-to-Stockout Forecast'}</h3>
                <p className="text-xs text-gray-400 mb-4">{currentLanguage === 'tr' ? 'Son 30 gün satış hızına göre tahmin' : 'Based on last 30-day sales velocity'}</p>
                <div className="space-y-3">
                  {p148.liste.map(s => {
                    const d = Math.round(s.kalan);
                    const cls = d <= TUKENME_ACIL_GUN ? 'bg-red-500' : d <= TUKENME_UYARI_GUN ? 'bg-amber-400' : 'bg-emerald-400';
                    const textCls = d <= TUKENME_ACIL_GUN ? 'text-red-600' : d <= TUKENME_UYARI_GUN ? 'text-amber-600' : 'text-emerald-600';
                    return (
                      <div key={s.kart.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-800 truncate">{s.kart.name}</span>
                            <span className={`text-xs font-bold ${textCls} shrink-0 ml-2`}>{d} {currentLanguage==='tr'?'gün':'days'}</span>
                          </div>
                          <OlcekCubugu
                            oran={oranYuzde(d, TUKENME_UFUK_GUN)}
                            renkSinifi={cls}
                            kalinlik="h-1.5"
                            dil={currentLanguage}
                          />
                          <p className="text-[10px] text-gray-400 mt-0.5">{oc(currentLanguage).stok}: {adetYaz(s.stok, currentLanguage === 'tr' ? 'tr' : 'en')} · {currentLanguage==='tr'?'Günlük':'Daily'}: {s.gunluk === null ? '—' : s.gunluk.toFixed(1)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* BİRİM BAŞINA AYRI not — karışık birim tek çağrıya VERİLMEZ (yoksa
                    "3 kalemin tarihi çözülemedi" gibi yanlış cümle çıkar). */}
                {/* (a) ÜRÜN: tahmin üretilemeyen kartlar. */}
                <KapsamNotu
                  sayaclar={{ esiksiz: p148.esiksiz, miktarsiz: p148.miktarsizUrun }}
                  birim="urun"
                  dil={currentLanguage}
                  sonuc={currentLanguage === 'tr' ? 'tahmin üretilmedi' : 'no forecast produced'}
                />
                {/* (b) KALEM: stok kartıyla eşleşmeyen sipariş satırları (`eslesmeyen` birimi SABİT). */}
                <KapsamNotu
                  sayaclar={{ eslesmeyen: talep148.eslesmeyenKalem }}
                  dil={currentLanguage}
                  sonuc={currentLanguage === 'tr' ? 'talebe dâhil değil' : 'not included in demand'}
                />
                {/* (c) SİPARİŞ: kalem verisi olmayan (Mikro türevi) ve tarihi çözülemeyen siparişler. */}
                <KapsamNotu
                  sayaclar={{ kalemsiz: talep148.kalemsizSiparis, tarihsiz: talep148.tarihsiz }}
                  birim="siparis"
                  dil={currentLanguage}
                  sonuc={currentLanguage === 'tr' ? 'talebe dâhil değil' : 'not included in demand'}
                />
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}
