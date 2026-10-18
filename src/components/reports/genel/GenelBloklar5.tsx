/**
 * GenelBloklar5.tsx — GenelRapor bölmesi (2026-08-31)
 *
 * GenelRapor.tsx'ten mekanik olarak çıkarıldı (bölme öncesi satır 2600–3199).
 * Bloklar ORİJİNAL SIRASIYLA ve içeriği DEĞİŞTİRİLMEDEN taşındı; bloklardaki
 * `reportsTab === 'genel'` koşulları BİLEREK korundu (bkz. GenelRapor.tsx
 * başlık notu — ebeveyn zaten sekmeye göre render ediyor, koşulu silmek
 * "saf kopya" güvencesini bozardı).
 * Props yalnız bu dosyanın gerçekten kullandığı ctx alanlarıdır
 * (tsc "Cannot find name" listesinden çıkarıldı).
 *
 * ── 6d bağlama notu (Faz 3 "Genel III", 2026-10-18; şartname faz3-2n-specs/6n-kesif/6d/baglama-genel-bloklar5.md) ──
 * 13 panelden dördü KALDIRILDI (K14 — ikisi O25 çifti, ikisi kullanıcının 2026-10-18 K14 aday kararıyla), bir panelin ilk 5
 * ürün listesi KALDIRILDI (orkestratör N3); kalan 9 panel testli yardımcılara BAĞLANDI (`src/utils/para`, `pano/*`, `rapor/*`,
 * `siparisler/*`). Kullanıcı kararları (KARARLAR.md, kullanıcının cümleleri) ve orkestratör kararları (6d/ORKESTRATOR-KARARLARI.md):
 *
 * K2  — kullanıcı 2026-09-19: "İptaller ciroya girsin mi → hayır." Tek süzgeç bileşen üst düzeyinde (`iptalsiz`); kalan
 *       9 panelin 9'u da iptali katıyordu → rakamlar DÜŞER (beklenen). Sayım panelleri de iptali saymaz (orkestratör O28).
 * K14 — kullanıcı 2026-09-19: "kaldır" (aynı işi yapan çift paneller; her çiftten TEK panel kalır — kalan: testli yardımcıya
 *       bağlı olan / daha doğru tanım). + K-TAHMİN (PLAN-v2 §8 sıra 10, plan varsayılanı: tek tahmin modeli). Orkestratör O25:
 *       çift = aynı ölçü × aynı kırılım × aynı pencere. Kalkanlar: 30 günlük ciro tahmini (kalan: RaporlarPage "Satış Tahmini"
 *       + GenelBloklar1 P190), bu ay / geçen ay karşılaştırması (kalan: GenelBloklar2 P245 "Bu Ay Ciro" kartı). Yerlerinde
 *       karar yorumu durur. P11'in ilk 5 ürün listesi kaldırıldı (orkestratör N3; kalan GenelBloklar1 P217), panel Pareto
 *       rozeti ve notlarıyla kalır.
 *       K14 adayları (yalnız pencere uzunluğu farkı — O25) kullanıcıya soruldu; kullanıcı 2026-10-18 «ok» = tablonun altı satırı
 *       da «kaldır». Bu dosyada P2 (yılın en yüksek ciro günleri; kalan GenelBloklar1 P202 + GenelBloklar4 P66) ve P7 (yıl içi
 *       çeyrekler; kalan GenelBloklar1 P156) KALDIRILDI, yerlerinde karar yorumu durur. YTD toplam rozeti P156'da yoktur (kayıp).
 * K1  — PLAN-v2 §8 sıra 6 (plan önerisi; KARARLAR.md'de K1 için AYRI kullanıcı cümlesi YOK) + orkestratör O26: sipariş
 *       tutarı TEK seçiciden (`SEC = siparisTutari`); kalem toplamından YEDEK YOK; başlığı okunamayan sipariş "tutarı
 *       okunamadı" sayılır ve notta görünür.
 * K20 — kullanıcı: "ok kalsın." Eşik / pencere / basamak DEĞERLERİ aynen; yalnız adlandırıldı (aşağıdaki sabitler) ve
 *       iki panelde dipnot sabitten üretilir.
 * K21 — kullanıcı 2026-09-24: "Tüm ciro" — Pareto paydası TÜM ürün cirosu.
 * K-KALEM — kullanıcı 2026-09-25: "KDV dahil mi hariç mi olacak hangisi doğruysa onu seç." → KDV HARİÇ; ürün cirosu
 *       `stokSevkiyat.kalemTutari` (tek tanım) + KDV dipnotu.
 * K-YÜZDE — kullanıcı 2026-09-25: "%42 şeklinde olsun" → tüm yüzdeler `bicim.yuzdeYaz`.
 * K3  — kullanıcı: "evet / ana program zaten bu." — kalem verisi olmayan sipariş Pareto notunda sayılır.
 * "Kur yoksa uydurma yok" (kullanıcı) + O21: TRY dışı mağaza siparişi TL toplamına / paya / paydaya girmez, panel notunda
 *       "N siparişin para birimi TL değil — toplanmadı" diye ayrı sayılır (panel kapsamında — yerel kural YK1).
 *
 * Bilinçli farklar (bilinen girdide sayılar eskiyle BİREBİR; değişenler kullanıcı / orkestratör kararı ya da kısmi veri):
 *  • Ciro tabanı kalem toplamından sipariş başlık tutarına geçti (O26; KDV dâhil, Genel sekmesinin tek tanımı); kalemsiz
 *    sipariş 0 TL sayılmaz; başlığı olmayan sipariş kalemlerinden hesaplanmaz → '—' + not.
 *  • Tutarı okunamayan sipariş 0 SAYILMAZ: ekran toplamı kısmi + not; türetilen sayı (yüzde, oran, skor, basamak, pay) '—';
 *    çubukta bilinmeyen gri taralı, gerçek 0 boş (hayalet piksel tabanları ve ölçek tabanları kalktı — K26 / O15).
 *  • Aylık artış ve haftalık sipariş grafiği son N TAKVİM dönemine oturur (O27): boş dönem 0, boş aydan artış '—'.
 *  • İş Sağlığı Puanı: bilinmeyen bileşen uydurma 50 değil '—' + "N/4 bileşen ölçüldü"; "Inventory" → "Ürün çeşidi (SKU)" (O16).
 *  • Kilometre taşları: sipariş sayısı iptalsiz tüm siparişler (O28); ciro basamağı kısmi ya da negatif toplamda '—' (O33).
 *  • Kümülatif seyir gün başına nokta, tarihsiz sipariş eğriye girmez (1970 yok), rozet gerçek toplam; tutarı okunamayan
 *    sipariş varken eğri çizilmez (GENEL-1).
 *  • Isı haritası başlığı "Gün × Ayın Haftası" + W4 dipnotu (O16). Tutarlar seçili para biriminde (sabit simge kalktı);
 *    kısaltılmış tutar sıfıra yuvarlanırsa tam tutar basılır (GENEL-2). Tarih kuralı: `ciroDonem` panelleri `ciroTarihi`
 *    (createdAt → syncedAt), öteki paneller `createdAt` (parite).
 */
import { useMemo } from 'react';
import { type ReportsCtx } from '../useReportsData';
import { type Order } from '../../../types';
import { ayAnahtari, gunAnahtari, gunFarki, tarihYaz } from '../../../utils/zaman';
import { siparisIptalMi, siparisTutari } from '../../../utils/siparis';
import { tryDisiMi } from '../../../utils/siparisler/magazaSiparisi';
import { toplaBilinen, ekranTutari, tamTutar, donemKarsilastir, sayiSirala } from '../../../utils/para';
import { aylikCiro, kumulatifSeyir, ciroTarihi } from '../../../utils/pano/ciroDonem';
import { tutarSatiri, olcekReferansi, cubukOrani, sayacOlcegi, seriCubukOrani } from '../../../utils/pano/cubuk';
import { hizDegisimi } from '../../../utils/pano/hedefButce';
import { urunSatislari, kalemTutari, kdvDahilKalemVar } from '../../../utils/pano/stokSevkiyat';
import { oranYuzde } from '../../../utils/siparisler/lojistikKpi';
import { zamanKovalari, tarihliKovala } from '../../../utils/rapor/zamanDagilimi';
import { panelDurumu } from '../../../utils/rapor/kapsamNotu';
import { kumulatifPaylar } from '../../../utils/rapor/yogunlasma';
import { bilesikSkor, esikBandi, type BantTanimi } from '../../../utils/rapor/skor';
import { yuzdeYaz } from '../../../utils/rapor/bicim';
import { adetYaz } from '../../../utils/muhasebe/depoDeger';
import { KapsamNotu, OlcekCubugu } from '../ReportKit';
import { rc } from '../../../i18n/rapor';

type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'currentLanguage' | 'fmtAna'>;

/* K20 — kullanıcı 2026-09-19: "ok kalsın." Gömülü eşik / pencere / basamak DEĞERLERİ aynen; yalnız adlandırıldı. */
const GUN_MS = 86400000;
/** P3 — hafta günü (Pzt–Paz) × ayın haftası. W4 = ayın 22–31. günü (eski 3'te kırpma). Hücre metni bu TL tutardan kısaltılır. */
const HAFTA_GUNU = 7, AY_HAFTA_SAYISI = 4, HUCRE_K_ESIGI = 1000;
/** P4 — takvim ayı penceresi (7 ay → 6 karşılaştırma), panel kapısı (siparişi olan ay), çubuk yüksekliği (px). */
const MOM_AY = 7, MOM_ASGARI_AY = 3, MOM_CUBUK_PX = 48;
/** P6 — kilometre taşları (sipariş adedi; ciro TL). */
const KILOMETRE_TASLARI = {
  siparis: [10, 50, 100, 250, 500, 1000, 5000],
  ciro: [100000, 500000, 1000000, 5000000, 10000000],
} as const;
/** P6 — O33: basamak `rapor/skor.esikBandi` ile bulunur (yeni merdiven yardımcısı YAZILMAZ). Bant k = [önceki taş, taş k)
 *  → hedef taş k; ilk bandın alt sınırı merdivenin TABANI 0 (tanım — sayı varsayılanı değil); son bant = bütün taşlar
 *  aşıldı → hedef son taş, önceki sondan bir önceki. Bantlar taşlardan TÜRETİLİR (literal tekrar yok; merdiven ≥ 2 taş).
 *  Değerler eski koda karşı `GenelBloklar5.test.tsx` merdiven paritesi testinde kilitli. */
const KILOMETRE_TABANI = 0;
type Basamak = { onceki: number; hedef: number };
const basamakBantlari = (taslar: readonly number[]): readonly BantTanimi<Basamak>[] => [
  ...taslar.map((hedef, k) => {
    const onceki = k === 0 ? KILOMETRE_TABANI : taslar[k - 1];
    return { altSinir: onceki, deger: { onceki, hedef } };
  }),
  { altSinir: taslar[taslar.length - 1], deger: { onceki: taslar[taslar.length - 2], hedef: taslar[taslar.length - 1] } },
];
const KILOMETRE_BANTLARI = {
  siparis: basamakBantlari(KILOMETRE_TASLARI.siparis),
  ciro: basamakBantlari(KILOMETRE_TASLARI.ciro),
} as const;
/** P8 — takvim haftası (Pazartesi başı) penceresi ve panel kapısı (siparişi olan hafta). */
const HAFTA_N = 8, HAFTA_ASGARI = 3;
/** P9 — karşılaştırma penceresi (gün; ms tabanlı kayan pencere — parite). */
const DONEM_GUN = 90;
/** P10 — iş sağlığı puanı rubriği: oran × 50 → önceki döneme eşitlik 50 puan; her %1 iptal 5 puan düşürür; her ürün kartı
 *  2 puan; tavan 100; dört bileşen eşit ağırlık (`bilesikSkor` ağırlık VARSAYMAZ — açıkça geçilir). */
const ISS_PENCERE_GUN = 30;
const ISS_ORAN_KATSAYI = 50;
const ISS_TAVAN = 100;
const ISS_IPTAL_CARPANI = 5;
const ISS_SKU_CARPANI = 2;
const ISS_AGIRLIK = 0.25;
/** P10 — bant ve bileşen çubuğu rengi için TEK merdiven (eski iki kopya üçlü eşik). */
const ISS_BANTLARI: readonly BantTanimi<{ etiket: string; renk: string }>[] = [
  { altSinir: 75, deger: { etiket: 'Healthy', renk: '#22c55e' } },
  { altSinir: 50, deger: { etiket: 'Moderate', renk: '#f59e0b' } },
  { altSinir: -Infinity, deger: { etiket: 'At Risk', renk: '#ef4444' } },
];
/** P11 — Pareto oranı ve panel kapısı (ürün sayısı). İlk 5 ürün listesi orkestratör N3 ile kalktı (gösterilen ürün sayısı sabiti de). */
const PARETO_ORANI = 0.2, PARETO_ASGARI = 3;
/** P12 — gösterilen ay sayısı ve panel kapısı. */
const EN_IYI_AY_N = 5, EN_IYI_AY_ASGARI = 2;
/** P13 — eğrinin en çok nokta sayısı ve panel kapısı (GÜN). */
const KUMULATIF_NOKTA = 40, KUMULATIF_ASGARI = 3;

/*
 * K1 — sipariş tutarı (PLAN-v2 §8 sıra 6, plan önerisi; KARARLAR.md'de K1 için AYRI kullanıcı cümlesi YOK) + orkestratör
 * O26 (2026-10-18): kalem toplamından YEDEK YOK — sahte kesinlik ilkesi; Genel sekmesinde TEK tanım `siparisTutari`
 * (`totalPrice ?? totalAmount`), GenelBloklar1–4 ile aynı. Başlığı okunamayan sipariş "tutarı okunamadı" sayılır ve
 * notta görünür. Bu dosyanın sekiz paneli siparişin `total` alanını okuyordu: `Order` tipinde yok, yazıcısı yok → hep
 * kalem toplamına düşüyor, kalemsiz sipariş sıfır TL sayılıyordu. `total` / `unitPrice` OKUNMAZ.
 * Dosyanın TEK tutar seçicisi; ikinci bir tutar tanımı YAZILMAZ.
 */
const SEC = siparisTutari;

export default function GenelBloklar5({ reportsTab, orders, inventory, currentLanguage, fmtAna }: Props) {
  const dil = currentLanguage === 'tr' ? 'tr' : 'en';
  // K2 (kullanıcı, 2026-09-19): "İptaller ciroya girsin mi → hayır." TEK süzgeç (`siparis.siparisIptalMi`). Kalan 9
  // panelin 9'u iptali katıyordu → rakamlar DÜŞER, beklenen. Sayım panelleri de bu kümeyi sayar (O28).
  const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);
  // O21 (orkestratör; kullanıcı "kur yoksa uydurma yok" + K23 ilkesi "dövizli ayrı sayılır"): TRY dışı mağaza siparişinde
  // `totalPrice` YOK, kalemleri o para biriminde. BOZUK VERİ DEĞİL: TL toplamına / paya / paydaya / "tutarı okunamadı"
  // sayacına GİRMEZ, `dovizliler`de ayrı sayılır. Süzgeç ÇAĞIRANDA; iptal edilmiş dövizli sipariş ikisinde de yok (K2).
  const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);
  const dovizliler = useMemo(() => iptalsiz.filter(o => tryDisiMi(o)), [iptalsiz]);
  // P4 tarih notu: `aylikCiro` tarihi çözülemeyen kaydı BİLDİRMEZ (kapalı imza) → modülün TEK tarih kuralıyla
  // (`ciroTarihi`: createdAt → syncedAt) üst düzeyde bir kez sayılır (GB1 6b `tarihsizSiparis` emsali).
  const tarihsizCiro = useMemo(() => satislar.filter(o => ciroTarihi(o) === null).length, [satislar]);
  // Kısaltılmış tutar (GENEL-2, kapı gb5-7): `fmtAna` tutarı SEÇİLİ birime çevirip 1000'e böler → USD'de 5.000 TL "$0K" olur;
  // bilinen, sıfır olmayan tutar 0 gibi görünür. Kısaltmada 1–9 rakamı yoksa tam biçime düşülür. Dosyadaki BÜTÜN
  // kısaltmalar buradan; bilinmeyen (NaN) iki kolda da '—', bilinen 0 tam biçimde.
  const kisaEtiket = (e: number, ondalik = 0): string => {
    const k = fmtAna(e, 'K', ondalik);
    return /[1-9]/.test(k) ? k : fmtAna(e, 'full', 0);
  };
  return (
    <>
      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan:
          testli yardımcıya bağlı olan). Bu dosyadaki 30 günlük ciro tahmini paneli KALDIRILDI (orkestratör O25: aynı ölçü
          × aynı kırılım × aynı pencere; PLAN.md §4 K14 listesi "3 ayrı ciro tahmini formülü"; K-TAHMİN, PLAN-v2 §8 sıra 10:
          tek tahmin modeli). Aynı soruyu Genel sekmesinde RaporlarPage "Satış Tahmini" (1 / 3 / 6 ay ufku) ve GenelBloklar1
          P190 "Gelir Tahmini (3 Ay)", muhasebe/faturaTakipTahmin'in testli modeliyle cevaplıyor; büyüme katsayılı ikinci
          bir model YAZILMADI. */}

      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar1.tsx P202 «En Yüksek Ciro Günleri — Son 90 Gün» + GenelBloklar4.tsx P66 «Top 10 Revenue Days — All Time» kalır; bu dosyadaki «Bu Yılın En Yüksek Ciro Günleri» paneli KALDIRILDI.
          K14 aday tablosu satır 1. KARARLAR.md K14: «Aynı işi yapan çift paneller → kaldır.» Orkestratör O25: aynı ölçü ×
          aynı kırılım (gün cirosu × gün), fark yalnız pencere uzunluğuydu (bu takvim yılı / son 90 gün / tüm zaman); aday
          olarak soruldu, kullanıcının cevabı «kaldır». */}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // P3 · Revenue Heatmap (Day × Week of Month) — K2, K1 + O26, O21, O16, GENEL-2, K26
        const gunler3 = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const haftalar3 = Array.from({ length: AY_HAFTA_SAYISI }, (_, i) => `W${i + 1}`);
        // Hücre indeksi = hafta günü (Pzt = 0) × AY_HAFTA_SAYISI + ayın haftası (W4 = 22–31) — eski matris ile BİREBİR.
        const indeks3 = (d: Date) => ((d.getDay() + 6) % 7) * AY_HAFTA_SAYISI + Math.min(Math.floor((d.getDate() - 1) / 7), AY_HAFTA_SAYISI - 1);
        const z3 = zamanKovalari(satislar, HAFTA_GUNU * AY_HAFTA_SAYISI, indeks3, { tarihSec: o => o.createdAt, tutarSec: SEC });
        // Tepe hücre kısmiyse ölçek YOK → hücreler taralı "bilinmiyor" (GB4 P445 emsali).
        const olcek3 = olcekReferansi(z3.kovalar.map(k => tutarSatiri(k.ciro)));
        // Sayaç toplamı: hücrelerin tutarı okunamayan siparişleri (hücreler ayrık → çift sayım yok). Her tarih bir hücreye
        // düşer → `kapsamDisi` yapısal olarak 0, nota konmaz.
        const tutarsiz3 = z3.kovalar.reduce((s, k) => s + k.ciro.bilinmeyen, 0);
        // YK1: dövizli sipariş AYNI yardımcı + AYNI indeksle; sayaç toplamı = hücre adetleri.
        const kapsamda3 = (l: readonly Order[]): number =>
          zamanKovalari(l, HAFTA_GUNU * AY_HAFTA_SAYISI, indeks3, { tarihSec: o => o.createdAt }).kovalar.reduce((s, k) => s + k.adet, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ciro Isı Haritası (Gün × Ayın Haftası)' : 'Revenue Heatmap (Day × Week of Month)'}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-normal pr-2 pb-1 w-8"></th>
                    {haftalar3.map(w => <th key={w} className="text-gray-400 font-normal pb-1 px-1">{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {gunler3.map((gun, di) => (
                    <tr key={gun}>
                      <td className="text-gray-500 font-medium pr-2 py-0.5">{gun}</td>
                      {haftalar3.map((hafta, wi) => {
                        const h = z3.kovalar[di * AY_HAFTA_SAYISI + wi];
                        const e = ekranTutari(h.ciro);
                        const baslik = e > 0 ? fmtAna(e,'full',0) : h.ciro.bilinmeyen > 0 ? '—' : '';
                        const oran = cubukOrani(tutarSatiri(h.ciro), olcek3);
                        if (oran === null) {
                          return (
                            <td key={hafta} className="px-1 py-0.5">
                              <div className="h-5"><OlcekCubugu yon="dikey" oran={null} koseSinifi="rounded" title={baslik} dil={currentLanguage} /></div>
                            </td>
                          );
                        }
                        const yogunluk = oran / 100;
                        return (
                          <td key={hafta} className="px-1 py-0.5">
                            <div className="rounded w-full h-5 flex items-center justify-center text-[9px] font-medium" title={baslik} style={{background: oran > 0 ? `rgba(255,64,0,${0.15 + yogunluk * 0.85})` : '#f3f4f6', color: yogunluk > 0.5 ? 'white' : '#374151'}}>
                              {e > 0 ? (e >= HUCRE_K_ESIGI ? kisaEtiket(e) : fmtAna(e,'full',0)) : ''}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* O16 (dürüst adlandırma): "Week" takvim haftası değil, ayın yedişer günlük dilimleridir. */}
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr' ? 'W1–W3 ayın yedişer günü; W4 = ayın 22–31. günü.' : 'W1–W3 are 7-day blocks; W4 = days 22–31 of the month.'}</p>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz3, tarihsiz: z3.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'ısı haritasına girmedi' : 'not included in the heatmap'} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda3(dovizliler) }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 10 && (() => {
        // P4 · Month-over-Month Revenue Growth — K2, K1 + O26, O21, O27, K-YÜZDE, K20, O15
        const simdi4 = new Date();
        // O27: son 7 TAKVİM ayı, en eskiden bu aya, BOŞ aylar dâhil. `iptalHaric` alan zorunlu — `satislar` zaten iptalsiz (çifte güvence).
        const a4 = aylikCiro(satislar, MOM_AY, simdi4, { iptalHaric: true }, dil);
        if (a4.filter(a => a.adet > 0).length < MOM_ASGARI_AY) return null;
        // Önceki ay boş (0 TL) ya da iki aydan birinde tutarı okunamayan sipariş varsa yüzde null → '—'. Etiket 'MM' (parite).
        // Yön (renk, çubuğun yarısı, `+` öneki) YUVARLANMIŞ yüzdeden değil `donemKarsilastir(...).yon`'dan: küçük düşüş −0'a
        // yuvarlanır ve `−0 >= 0` doğrudur → yeşil «+-%0» basıyordu (inceleme B1). Düşüş kırmızı «-%0» basar (GB6 emsali).
        const satirlar4 = a4.slice(1).map((a, i) => {
          const k = donemKarsilastir(a.tutar, a4[i].tutar);
          return { ay: a.anahtar.slice(5), yuzde: k.yuzde, yon: k.yon };
        });
        const olcek4 = sayacOlcegi(satirlar4.map(r => (r.yuzde === null ? null : Math.abs(r.yuzde))));
        // Sayaç toplamı: penceredeki tutarı okunamayan siparişler (aylar ayrık → çift sayım yok).
        const tutarsiz4 = a4.reduce((s, a) => s + a.tutar.bilinmeyen, 0);
        // YK1: dövizli sipariş AYNI yardımcı + AYNI pencereyle; sayaç toplamı = ay adetleri.
        const kapsamda4 = (l: readonly Order[]): number =>
          aylikCiro(l, MOM_AY, simdi4, { iptalHaric: true }, dil).reduce((s, a) => s + a.adet, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aylık Ciro Artışı' : 'Month-over-Month Revenue Growth'}</h3>
            <div className="relative h-28">
              <div className="absolute inset-x-0" style={{top: '50%', height: 1, background: '#e5e7eb'}} />
              <div className="flex items-center h-full gap-2">
                {satirlar4.map(r => {
                  const o = r.yuzde === null ? null : seriCubukOrani(Math.abs(r.yuzde), olcek4);
                  const barH = o === null ? null : (o / 100) * MOM_CUBUK_PX;
                  if (r.yuzde === null || r.yon === null || barH === null) {
                    // Yön bilinmiyor: çubuk ÇİZİLMEZ, üst / alt yarıya yerleşmez.
                    return (
                      <div key={r.ay} className="flex-1 flex flex-col items-center">
                        <div className="flex-1" />
                        <span className="text-[9px] font-bold text-gray-400">—</span>
                        <div className="flex-1" />
                        <span className="text-[9px] text-gray-400 mt-1">{r.ay}</span>
                      </div>
                    );
                  }
                  const isPos = r.yon === 'artis';
                  return (
                    <div key={r.ay} className="flex-1 flex flex-col items-center">
                      {isPos ? (
                        <>
                          <div className="flex-1 flex items-end justify-center pb-0.5">
                            <div style={{height: `${barH}px`, background: '#22c55e', width: '70%', borderRadius: '3px 3px 0 0'}} />
                          </div>
                          <span className="text-[9px] font-bold text-green-600">+{yuzdeYaz(r.yuzde, 0, dil)}</span>
                          <div className="flex-1" />
                        </>
                      ) : (
                        <>
                          <div className="flex-1" />
                          <span className="text-[9px] font-bold text-red-500">{yuzdeYaz(r.yuzde, 0, dil)}</span>
                          <div className="flex-1 flex items-start justify-center pt-0.5">
                            <div style={{height: `${barH}px`, background: '#ef4444', width: '70%', borderRadius: '0 0 3px 3px'}} />
                          </div>
                        </>
                      )}
                      <span className="text-[9px] text-gray-400 mt-1">{r.ay}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz4, tarihsiz: tarihsizCiro }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'ilgili ayların artışı hesaplanmadı' : 'growth not computed for the affected months'} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda4(dovizliler) }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan:
          testli yardımcıya bağlı olan). Bu dosyadaki bu ay / geçen ay ciro karşılaştırma paneli KALDIRILDI (orkestratör
          O25: aynı ölçü × aynı kırılım × aynı pencere; K14 eki "6 kutu → 5" kutu düzeyi emsali). Bu ayın cirosu ve geçen
          aya göre değişimi Genel sekmesinde GenelBloklar2 P245 "Yönetici KPI Özeti" kartında kalır (6c, testli). */}

      {reportsTab === 'genel' && orders.length >= 1 && (() => {
        // P6 · Sales Milestones — K20, K2 + O28, K1 + O26, O21, O33, O16, GENEL-2
        // O28: sipariş basamağı TÜM iptalsiz siparişi sayar (dövizli ve tutarı okunamayan dâhil, iptal HARİÇ — K2).
        // Sipariş sayısı negatif olamaz → bant yapısal olarak bulunur; tip kapısı yine yazılır.
        const bs6 = esikBandi(iptalsiz.length, KILOMETRE_BANTLARI.siparis);
        const ciro6 = toplaBilinen(satislar, SEC);
        // O33: ciro basamağının girdisi TAM bilinen toplam (`tamTutar`) — kısmi toplam basamak seçmez ('—', taralı çubuk);
        // negatif toplam (iade ağırlıklı) merdivenin tabanının altında → bant yok → '—' (bilinçli fark 21).
        const bc6 = esikBandi(tamTutar(ciro6), KILOMETRE_BANTLARI.ciro);
        // YK1: penceresiz panel → dövizli sayısı kümenin uzunluğu.
        const kapsamda6 = (l: readonly Order[]): number => l.length;
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Sales Milestones</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Orders</span>
                  <span className="font-bold">{iptalsiz.length} <span className="text-gray-400">/ {bs6 === null ? '—' : bs6.hedef}</span></span>
                </div>
                <OlcekCubugu oran={bs6 === null ? null : oranYuzde(iptalsiz.length, bs6.hedef)} renk="linear-gradient(90deg, #ff4000, #ff8c00)" kalinlik="h-3" dil={currentLanguage} />
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{bs6 === null ? '—' : bs6.onceki}</span><span>{bs6 === null ? '—' : bs6.hedef}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Total Revenue</span>
                  <span className="font-bold">{kisaEtiket(ekranTutari(ciro6))} <span className="text-gray-400">/ {bc6 === null ? '—' : kisaEtiket(bc6.hedef)}</span></span>
                </div>
                <OlcekCubugu oran={bc6 === null ? null : oranYuzde(tamTutar(ciro6), bc6.hedef)} renk="linear-gradient(90deg, #6366f1, #a78bfa)" kalinlik="h-3" dil={currentLanguage} />
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>{bc6 === null ? '—' : kisaEtiket(bc6.onceki)}</span><span>{bc6 === null ? '—' : kisaEtiket(bc6.hedef)}</span>
                </div>
              </div>
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: ciro6.bilinmeyen }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'ciro basamağı hesaplanmadı' : 'revenue milestone not computed'} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda6(dovizliler) }} birim="siparis" dil={currentLanguage} />
            {/* K20 dipnotu SABİTTEN üretilir (literal tekrar yok); O16 / O28: sipariş sayısının kümesi açıkça yazılır. */}
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr'
              ? `Basamaklar sabittir — sipariş: ${KILOMETRE_TASLARI.siparis.map(n => adetYaz(n, dil)).join(' · ')}; ciro: ${KILOMETRE_TASLARI.ciro.map(v => kisaEtiket(v)).join(' · ')}. Sipariş sayısı iptal edilmeyen tüm siparişlerdir (TL dışı ve tutarı okunamayanlar dâhil).`
              : `Fixed steps — orders: ${KILOMETRE_TASLARI.siparis.map(n => adetYaz(n, dil)).join(' · ')}; revenue: ${KILOMETRE_TASLARI.ciro.map(v => kisaEtiket(v)).join(' · ')}. Order count is all non-cancelled orders (non-TRY and unreadable amounts included).`}</p>
          </div>
        );
      })()}

      {/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar1.tsx P156 «Çeyrek Bazlı Karşılaştırma» kalır; bu dosyadaki «YTD Revenue by Quarter» paneli KALDIRILDI.
          K14 aday tablosu satır 2. KARARLAR.md K14: «Aynı işi yapan çift paneller → kaldır.» Orkestratör O25: aynı ölçü ×
          aynı kırılım (ciro × takvim çeyreği), fark yalnız pencereydi (takvim yılının dört çeyreği / kayan son dört çeyrek;
          yılın son çeyreğinde ikisi aynı dört çeyreği çizer). Yıl içi toplam rozeti kalan panelde yoktur (kullanıcıya bildirilir). */}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P8 · Weekly Orders Trend — K2 + O28, O27, K20, O16
        const simdi8 = new Date();
        // Hafta Pazartesi başlar — eski `setDate(getDate() − ((getDay() + 6) % 7))` ile AYNI tanım.
        const haftaBasi8 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
        const buPzt8 = haftaBasi8(simdi8);
        // O27: indeks = 7 − (bu hafta − kaydın haftası) / 7 → sol = en eski, sağ = bu hafta. `gunFarki` yerel TAM gün → 7'nin
        // katı. 8 haftadan eski ve GELECEK haftalı kayıt aralık dışı → `kapsamDisi` (pencere TANIMI, not basılmaz — K28).
        const indeks8 = (d: Date) => { const f = gunFarki(buPzt8, haftaBasi8(d)); return f === null ? -1 : HAFTA_N - 1 - f / 7; };
        // O28: sayım paneli TÜM iptalsiz siparişi sayar (dövizli ve tutarı okunamayan dâhil); tutar okunmaz.
        const k8 = zamanKovalari(iptalsiz, HAFTA_N, indeks8, { tarihSec: o => o.createdAt });
        if (k8.kovalar.filter(k => k.adet > 0).length < HAFTA_ASGARI) return null;
        const adetler8 = k8.kovalar.map(k => k.adet);
        const olcek8 = sayacOlcegi(adetler8);
        // Sayaç toplamı: penceredeki sipariş adedi. Ortalama 8 TAKVİM haftası üzerinden (boş hafta gerçek 0 — O27).
        const toplam8 = adetler8.reduce((s, n) => s + n, 0);
        const ortalama8 = toplam8 / HAFTA_N;
        const w = 240; const h = 60; const pad = 8;
        const nokta8 = (v: number, i: number) => {
          const o = seriCubukOrani(v, olcek8);
          return o === null ? null : { x: pad + (i / (HAFTA_N - 1)) * (w - 2 * pad), y: h - pad - (o / 100) * (h - 2 * pad) };
        };
        // Adet her zaman bilinir; `null` yalnız tip kapısı.
        const noktalar8 = adetler8.map(nokta8);
        const pts = noktalar8.flatMap(p => (p === null ? [] : [`${p.x},${p.y}`])).join(' ');
        const ilkPzt8 = new Date(buPzt8.getFullYear(), buPzt8.getMonth(), buPzt8.getDate() - (HAFTA_N - 1) * 7);
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Haftalık Sipariş Eğilimi' : 'Weekly Orders Trend'}</h3>
              <span className="text-xs text-gray-500">avg {adetYaz(Math.round(ortalama8), dil)}/wk</span>
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height: 60}}>
              <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {noktalar8.map((p, i) => (p === null ? null : (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill="#ff4000" />
              )))}
            </svg>
            <div className="flex justify-between text-[9px] text-gray-400 mt-1">
              <span>{gunAnahtari(ilkPzt8)?.slice(5)}</span>
              <span>{gunAnahtari(buPzt8)?.slice(5)}</span>
            </div>
            <KapsamNotu sayaclar={{ tarihsiz: k8.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'grafiğe girmedi' : 'not included in the chart'} />
            <p className="text-[10px] text-gray-400 mt-1">{currentLanguage === 'tr' ? 'İptal edilmeyen tüm siparişler (TL dışı dâhil).' : 'All non-cancelled orders (non-TRY included).'}</p>
          </div>
        );
      })()}


      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P9 · Last 90d vs Prior 90d — K2, K1 + O26, O21, O28, K-YÜZDE, GENEL-2; K14 + O25: GB6 P2 «Revenue Growth Rates» 90 günlük kutusuyla ÇİFT, kalan BU panel (ciro + adet)
        const simdi9 = new Date();
        // ms tabanlı kayan pencere (parite — gelecek tarihli kayıt bugünkü gibi "son 90 gün"e düşer).
        const d90 = new Date(simdi9.getTime() - DONEM_GUN * GUN_MS);
        const d180 = new Date(simdi9.getTime() - 2 * DONEM_GUN * GUN_MS);
        // 0 = önceki 90 gün, 1 = son 90 gün; 180 günden eski kayıt `kapsamDisi` (pencere TANIMI, not basılmaz).
        const indeks9 = (d: Date) => (d >= d90 ? 1 : d >= d180 ? 0 : -1);
        const k9 = zamanKovalari(satislar, 2, indeks9, { tarihSec: o => o.createdAt, tutarSec: SEC });
        const [once9, son9] = k9.kovalar;
        if (panelDurumu(son9.ciro, once9.ciro) === 'bos') return null;
        const ciroK9 = donemKarsilastir(son9.ciro, once9.ciro);
        // O28: adet ciroyla AYNI kümeden (`satislar`).
        const adetYuzde9 = hizDegisimi(son9.adet, once9.adet);
        // `artis` (renk, ok): YUVARLANMIŞ yüzdeden değil karşılaştırmanın kendisinden — küçük düşüş −0'a yuvarlanır ve `−0 >= 0`
        // doğrudur → yeşil «▲ %0» basıyordu (inceleme B1). Ciro `donemKarsilastir(...).yon`; adet aynı kural (bu dönem ≥ önceki).
        // Yüzde hesaplanamıyorsa yön de YOK (null → gri '—').
        const kartlar9: { etiket: string; simdi: string; once: string; yuzde: number | null; artis: boolean | null }[] = [
          { etiket: 'Revenue', simdi: kisaEtiket(ciroK9.ekran, 1), once: kisaEtiket(ekranTutari(once9.ciro), 1), yuzde: ciroK9.yuzde,
            artis: ciroK9.yon === null ? null : ciroK9.yon === 'artis' },
          { etiket: 'Orders', simdi: String(son9.adet), once: String(once9.adet), yuzde: adetYuzde9,
            artis: adetYuzde9 === null ? null : son9.adet >= once9.adet },
        ];
        // YK1: dövizli sipariş AYNI yardımcı + AYNI pencereyle; sayaç toplamı = iki pencerenin adedi.
        const kapsamda9 = (l: readonly Order[]): number => {
          const z = zamanKovalari(l, 2, indeks9, { tarihSec: o => o.createdAt });
          return z.kovalar[0].adet + z.kovalar[1].adet;
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Son 90 Gün ve Önceki 90 Gün' : 'Last 90d vs Prior 90d'}</h3>
            <div className="grid grid-cols-2 gap-3">
              {kartlar9.map(r => (
                <div key={r.etiket} className="rounded-xl p-3" style={{background: r.yuzde === null || r.artis === null ? '#f3f4f6' : r.artis ? '#22c55e12' : '#ef444412'}}>
                  <p className="text-[10px] text-gray-500 mb-1">{r.etiket}</p>
                  <p className="text-lg font-bold text-gray-800">{r.simdi}</p>
                  <p className="text-xs" style={r.yuzde === null || r.artis === null ? undefined : {color: r.artis ? '#22c55e' : '#ef4444'}}>
                    {r.yuzde === null || r.artis === null
                      ? <span className="text-gray-400">—</span>
                      : <>{r.artis ? '▲' : '▼'} {yuzdeYaz(Math.abs(r.yuzde), 0, dil)}</>}
                    <span className="text-gray-400 ml-1">vs {r.once}</span>
                  </p>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: son9.ciro.bilinmeyen + once9.ciro.bilinmeyen, tarihsiz: k9.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'karşılaştırmaya girmedi' : 'not included in the comparison'} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda9(dovizliler) }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P10 · Business Health Score — K20, K2 + O28, K1 + O26, O21, O15, O16
        const simdi10 = new Date();
        const d30 = new Date(simdi10.getTime() - ISS_PENCERE_GUN * GUN_MS);
        const d60 = new Date(simdi10.getTime() - 2 * ISS_PENCERE_GUN * GUN_MS);
        // 0 = önceki 30 gün, 1 = son 30 gün (ms tabanlı — parite).
        const indeks10 = (d: Date) => (d >= d30 ? 1 : d >= d60 ? 0 : -1);
        // Ciro ve adet bileşenleri `satislar`dan (K2 + O21; O28: adet ciroyla aynı küme).
        const z10 = zamanKovalari(satislar, 2, indeks10, { tarihSec: o => o.createdAt, tutarSec: SEC });
        const [once10, son10] = z10.kovalar;
        // O28: iptal oranının paydası penceredeki TÜM siparişler (iptaller dâhil — eski küme ile AYNI); iptal tanımı TEK yerden.
        const tum10 = zamanKovalari(orders, 2, indeks10, { tarihSec: o => o.createdAt });
        const iptal10 = zamanKovalari(orders.filter(siparisIptalMi), 2, indeks10, { tarihSec: o => o.createdAt });
        // Oran × 50 puan, tavan 100 (K20). Oran bilinmiyorsa (önceki pencere boş ya da tutarı okunamayan sipariş var) bileşen
        // null — uydurma 50 puan YOK.
        const puan10 = (oran: number | null) => (oran === null ? null : Math.min(ISS_TAVAN, Math.round((oran / 100) * ISS_ORAN_KATSAYI)));
        // Son 30 günde sipariş yoksa oran null (0/0 "iptal yok" DEĞİLDİR).
        const iptalOrani10 = oranYuzde(iptal10.kovalar[1].adet, tum10.kovalar[1].adet);
        const bilesenler10 = [
          { ad: 'Revenue Growth', puan: puan10(oranYuzde(tamTutar(son10.ciro), tamTutar(once10.ciro))), agirlik: ISS_AGIRLIK },
          { ad: 'Order Volume', puan: puan10(oranYuzde(son10.adet, once10.adet)), agirlik: ISS_AGIRLIK },
          // O15: alt kırpma yerine üst kırpma — 100 − min(100, x) eski 0 tabanlı biçimle aynı değer.
          { ad: 'Low Cancellations', puan: iptalOrani10 === null ? null : ISS_TAVAN - Math.min(ISS_TAVAN, iptalOrani10 * ISS_IPTAL_CARPANI), agirlik: ISS_AGIRLIK },
          // O16: puan stok seviyesi değil ürün KARTI sayısıdır. Boş liste "yüklenmedi" ile "kartsız kiracı"yı ayırt etmez → bilinmiyor.
          { ad: currentLanguage === 'tr' ? 'Ürün çeşidi (SKU)' : 'Product range (SKUs)', puan: inventory.length > 0 ? Math.min(ISS_TAVAN, inventory.length * ISS_SKU_CARPANI) : null, agirlik: ISS_AGIRLIK },
        ];
        // Σ puan × 0,25 ≡ Σ / 4 (0,25 ikinin kuvveti — kayan noktada birebir). Tek bileşen bilinmiyorsa skor null → '—'.
        const s10 = bilesikSkor(bilesenler10);
        const genel10 = s10.skor === null ? null : Math.round(s10.skor);
        const bant10 = esikBandi(genel10, ISS_BANTLARI);
        // YK1: dövizli sipariş AYNI yardımcı + AYNI pencereyle; sayaç toplamı = iki pencerenin adedi.
        const kapsamda10 = (l: readonly Order[]): number => {
          const z = zamanKovalari(l, 2, indeks10, { tarihSec: o => o.createdAt });
          return z.kovalar[0].adet + z.kovalar[1].adet;
        };
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'İş Sağlığı Puanı' : 'Business Health Score'}</h3>
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  {genel10 !== null && bant10 !== null && (
                    <circle cx="40" cy="40" r="32" fill="none" stroke={bant10.renk} strokeWidth="8"
                      strokeDasharray={`${(genel10 / 100) * 201} 201`}
                      strokeDashoffset="50" strokeLinecap="round" />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-xl font-bold${bant10 === null ? ' text-gray-400' : ''}`} style={bant10 === null ? undefined : {color: bant10.renk}}>{genel10 === null ? '—' : genel10}</span>
                  <span className="text-[8px] text-gray-500">{bant10 === null ? '' : bant10.etiket}</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {bilesenler10.map(b => {
                  // Gösterilen puan, çubuk ve rengi eskisi gibi YUVARLANMIŞ puandan (iptal bileşeni kesirli olabilir — parite).
                  const p = b.puan === null ? null : Math.round(b.puan);
                  return (
                    <div key={b.ad} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 flex-1">{b.ad}</span>
                      <div className="w-16">
                        <OlcekCubugu oran={p} renk={p === null ? undefined : esikBandi(p, ISS_BANTLARI)?.renk} kalinlik="h-2" dil={currentLanguage} />
                      </div>
                      <span className="text-[9px] font-bold text-gray-600 w-6 text-right">{p === null ? '—' : p}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {s10.eksik.length > 0 && (
              <p className="text-[11px] text-amber-600 mt-2">{currentLanguage === 'tr' ? `${s10.kullanilan}/${s10.toplam} bileşen ölçüldü; hesaplanamayan: ${s10.eksik.join(', ')}` : `${s10.kullanilan}/${s10.toplam} components measured; not computable: ${s10.eksik.join(', ')}`}</p>
            )}
            {/* `tarihsiz` TÜM siparişlerden — iptal bileşeni de tarihi çözülemeyen kaydı göremez. */}
            <KapsamNotu sayaclar={{ tutarsiz: son10.ciro.bilinmeyen + once10.ciro.bilinmeyen, tarihsiz: tum10.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={rc(currentLanguage).skora_girmedi} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda10(dovizliler) }} birim="siparis" dil={currentLanguage} />
            {/* K20 dipnotu SABİTTEN üretilir (literal tekrar yok). */}
            <p className="text-[10px] text-gray-400 mt-2">{currentLanguage === 'tr'
              ? `Puan rubriği sabittir: ciro ve sipariş oranı ×${ISS_ORAN_KATSAYI} (önceki ${ISS_PENCERE_GUN} güne eşitlik = ${ISS_ORAN_KATSAYI} puan, tavan ${ISS_TAVAN}); her ${yuzdeYaz(1, 0, dil)} iptal −${ISS_IPTAL_CARPANI}; her ürün kartı +${ISS_SKU_CARPANI}; eşikler ${ISS_BANTLARI.filter(b => Number.isFinite(b.altSinir)).map(b => b.altSinir).join(' / ')}.`
              : `Score rubric is fixed: revenue and order ratio ×${ISS_ORAN_KATSAYI} (parity with the previous ${ISS_PENCERE_GUN} days = ${ISS_ORAN_KATSAYI} points, cap ${ISS_TAVAN}); each ${yuzdeYaz(1, 0, dil)} cancelled −${ISS_IPTAL_CARPANI}; each product card +${ISS_SKU_CARPANI}; thresholds ${ISS_BANTLARI.filter(b => Number.isFinite(b.altSinir)).map(b => b.altSinir).join(' / ')}.`}</p>
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P11 · Product Revenue Pareto — K-KALEM, K21, K3, K14 (N3: ilk 5 listesi kaldırıldı)
        // K-KALEM (kullanıcı 2026-09-25): "KDV dahil mi hariç mi olacak hangisi doğruysa onu seç." → KDV HARİÇ; kalem tutarı
        // `stokSevkiyat.kalemTutari` (GB1 P217 ile AYNI seçici). Anahtar `sku → name → title`; adsız kalemler TEK kova.
        const u11 = urunSatislari(satislar, { baslikYedegi: true, tutarSec: kalemTutari });
        if (u11.length < PARETO_ASGARI) return null;
        // K21 (kullanıcı 2026-09-24): "Tüm ciro" — payda TÜM ürün cirosu; payda `tamTutar` kapısından (tek kalem okunamazsa paylar null).
        const p11 = kumulatifPaylar(u11, u => u.ciro);
        const n11 = p11.satirlar.length;
        // Kapı ≥ 3 ürün → ilk %20 en az 1 satır; alt sınır gerekmez.
        const rozet11 = p11.satirlar[Math.ceil(n11 * PARETO_ORANI) - 1].kumulatif;
        // K3 (kullanıcı): "evet / ana program zaten bu." — PLAN-v2 §8 sıra 13: kalem verisi olmayan sipariş notta görünür.
        const kalemsiz11 = satislar.filter(o => !Array.isArray(o.lineItems) || o.lineItems.length === 0).length;
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Ürün Cirosu Pareto' : 'Product Revenue Pareto'}</h3>
              <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">Top {yuzdeYaz(PARETO_ORANI * 100, 0, dil)} → {yuzdeYaz(rozet11, 0, dil)} rev</span>
            </div>
            {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan:
                testli yardımcıya bağlı olan). Bu paneldeki ilk 5 ürün listesi KALDIRILDI (orkestratör N3, O25 kutu kuralı: ürün
                ciro payı × ürün × tüm zaman; aynı listeyi GenelBloklar1 P217 "Ürün Karma Analizi (Top 6)" 6b'nin testli
                yardımcısıyla gösteriyor). Pareto rozeti (ilk %20 ürünün kümülatif payı) Genel sekmesinde yalnız bu panelde
                olduğu için panel rozet ve notlarla kalır. */}
            {p11.neden === 'payda-yok' && (
              <p className="text-[10px] text-gray-400 mt-2">{rc(currentLanguage).urun_cirosu_sifir_ya_da_negatif_pay_hesaplanamad}</p>
            )}
            {/* Sayı okunamayan KALEM sayısı — `tutarsiz` birimi kalem kabul etmez → nötr kayıt (GB1 P217 emsali). */}
            <KapsamNotu sayaclar={{ tutarsiz: p11.toplam.bilinmeyen }} birim="kayit" dil={currentLanguage} sonuc={rc(currentLanguage).paylar_eksik_ciroyla_hesaplanmaz} />
            <KapsamNotu sayaclar={{ kalemsiz: kalemsiz11, dovizli: dovizliler.length }} birim="siparis" dil={currentLanguage} />
            {kdvDahilKalemVar(satislar) && (
              <p className="text-[10px] text-gray-400 mt-1">{rc(currentLanguage).mikro_faturasindan_tureyen_kalemlerde_satir_tuta}</p>
            )}
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P12 · Best Revenue Months — K2, K1 + O26, O21, K20, K26, GENEL-2
        // Tüm zaman (pencere yok); tarih `createdAt` (parite). Geçerli tarihte ay anahtarı hep çözülür → `anahtarsiz` 0.
        const a12 = tarihliKovala(satislar, o => o.createdAt, d => ayAnahtari(d));
        // Hiç bilineni olmayan ay (NaN) SONDA.
        const aylar12 = [...a12.kovalar].map(([ay, liste]) => ({ ay, tutar: toplaBilinen(liste, SEC) }))
          .sort((a, b) => sayiSirala(ekranTutari(a.tutar), ekranTutari(b.tutar), true));
        const ilk12 = aylar12.slice(0, EN_IYI_AY_N);
        if (ilk12.length < EN_IYI_AY_ASGARI) return null;
        // Tepe ay kısmiyse ölçek YOK (çubuklar taralı).
        const olcek12 = olcekReferansi(ilk12.map(a => tutarSatiri(a.tutar)));
        // Sayaç toplamı: TÜM ayların tutarı okunamayan siparişleri (aylar ayrık → çift sayım yok).
        const tutarsiz12 = aylar12.reduce((s, a) => s + a.tutar.bilinmeyen, 0);
        // YK1: dövizli sipariş AYNI yardımcı + AYNI anahtarla; sayaç toplamı = kova uzunlukları.
        const kapsamda12 = (l: readonly Order[]): number =>
          [...tarihliKovala(l, o => o.createdAt, d => ayAnahtari(d)).kovalar.values()].reduce((s, k) => s + k.length, 0);
        return (
          <div className="apple-card p-4 mb-4">
            <h3 className="font-semibold text-sm mb-3">🏆 Best Revenue Months</h3>
            <div className="space-y-2">
              {ilk12.map((a, i) => (
                <div key={a.ay} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 text-gray-400">#{i+1}</span>
                  <span className="text-xs w-16 text-gray-700">{a.ay}</span>
                  <div className="flex-1">
                    <OlcekCubugu oran={cubukOrani(tutarSatiri(a.tutar), olcek12)} renk={i === 0 ? '#ff4000' : '#6366f1'} kalinlik="h-4" dil={currentLanguage} />
                  </div>
                  {/* Tutar çubuğun DIŞINDA: taralı "bilinmiyor" çubuğun üstüne yazı yazılmaz. */}
                  <span className="text-[9px] font-bold w-14 text-right" style={{color: i === 0 ? '#ff4000' : '#6366f1'}}>{kisaEtiket(ekranTutari(a.tutar))}</span>
                </div>
              ))}
            </div>
            <KapsamNotu sayaclar={{ tutarsiz: tutarsiz12, tarihsiz: a12.tarihsiz }} birim="siparis" dil={currentLanguage} />
            <KapsamNotu sayaclar={{ dovizli: kapsamda12(dovizliler) }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}

      {reportsTab === 'genel' && orders.length >= 5 && (() => {
        // P13 · Cumulative Revenue Trajectory — K2, K1 + O26, O21, K20, GENEL-1, GENEL-2
        // Gün başına nokta (aynı günün siparişleri tek nokta), tarih `ciroTarihi`; tarihsiz eğriye girmez, SAYILIR (1970 yok);
        // en çok KUMULATIF_NOKTA nokta (ilk ve son her zaman); son noktanın kümülatifi = `toplam`.
        const s13 = kumulatifSeyir(satislar, { iptalHaric: true }, { enCokNokta: KUMULATIF_NOKTA });
        if (s13.noktalar.length < KUMULATIF_ASGARI) return null;
        // PARA ölçeği (GB1 P156 kuralı): tepe nokta kısmiyse ölçek YOK. Kümülatifin bilinmeyeni hiç azalmaz → tutarı
        // okunamayan tek sipariş o noktadan sonraki her noktayı kısmi yapar; kısmi tepeye göre ölçeklenen eğri yalan söyler.
        const olcek13 = olcekReferansi(s13.noktalar.map(n => tutarSatiri(n.kumulatif)));
        const ciz13 = s13.ilkKismi === null && Number.isFinite(olcek13);
        const w = 240; const h = 60; const pad = 8;
        const xy13 = s13.noktalar.map((n, i) => {
          const o = cubukOrani(tutarSatiri(n.kumulatif), olcek13);
          return o === null ? null : { x: pad + (i / (s13.noktalar.length - 1)) * (w - 2 * pad), y: h - pad - (o / 100) * (h - 2 * pad) };
        });
        // `ciz13` iken her nokta sonludur; süzgeç yalnız tip kapısı.
        const pts = xy13.flatMap(p => (p === null ? [] : [`${p.x},${p.y}`])).join(' ');
        // Eğriye giren sipariş: `toplaBilinen` her kaydı TAM BİR sayaca yazar (bilinen ya da bilinmeyen); tarihsiz HARİÇ.
        const adet13 = s13.toplam.bilinen + s13.toplam.bilinmeyen;
        // `ilkKismi` İNDEKSTİR (indeks tarihe verilmez — 1970 basardı). Notun tarihi ÖRNEKLEMESİZ seriden: örneklenmiş seride tutarı
        // okunamayan ilk siparişin günü düşebilir, `ilkKismi` o zaman onu İZLEYEN ilk örnek günü gösterir → not gerçek günden
        // sonraki bir tarihi basıyordu (inceleme B2). Aynı küme ve seçenek, yalnız `enCokNokta` YOK; çizim örneklenmiş seriyle kalır.
        // İki seride `ilkKismi`'nin null olması AYNIDIR (son nokta örneklemede hep var, bilinmeyeni hiç azalmaz).
        const tam13 = kumulatifSeyir(satislar, { iptalHaric: true });
        const kismiTarih13 = tam13.ilkKismi === null ? null : tarihYaz(tam13.noktalar[tam13.ilkKismi].tarih, { day: '2-digit', month: 'short', year: 'numeric' }, dil);
        // YK1: dövizli sipariş AYNI yardımcı + AYNI seçenekle; sayaç = eğriye giren kayıt sayısı (yukarıdaki kural).
        const kapsamda13 = (l: readonly Order[]): number => {
          const s = kumulatifSeyir(l, { iptalHaric: true }, { enCokNokta: KUMULATIF_NOKTA });
          return s.toplam.bilinen + s.toplam.bilinmeyen;
        };
        return (
          <div className="apple-card p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Kümülatif Ciro Seyri' : 'Cumulative Revenue Trajectory'}</h3>
              <span className="text-xs font-bold text-brand">{kisaEtiket(ekranTutari(s13.toplam))} total</span>
            </div>
            {ciz13 && (
              <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{height:60}}>
                <defs>
                  <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff4000" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="#ff4000" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <polygon points={`${pad},${h - pad} ${pts} ${w - pad},${h - pad}`} fill="url(#cumGrad)" />
                <polyline points={pts} fill="none" stroke="#ff4000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <p className="text-[10px] text-gray-400 text-center mt-1">{adet13} orders total</p>
            <KapsamNotu sayaclar={{ tutarsiz: s13.toplam.bilinmeyen, tarihsiz: s13.tarihsiz }} birim="siparis" dil={currentLanguage} sonuc={currentLanguage === 'tr' ? 'eğriye girmedi' : 'not included in the curve'} />
            {kismiTarih13 !== null && (
              <p className="text-[10px] text-amber-600 mt-1">{currentLanguage === 'tr'
                ? `Eğri çizilmedi: ${kismiTarih13} tarihinden itibaren tutarı okunamayan sipariş var; toplam alt sınırdır.`
                : `Curve not drawn: orders with unreadable amounts from ${kismiTarih13}; the total is a lower bound.`}</p>
            )}
            <KapsamNotu sayaclar={{ dovizli: kapsamda13(dovizliler) }} birim="siparis" dil={currentLanguage} />
          </div>
        );
      })()}
    </>
  );
}
