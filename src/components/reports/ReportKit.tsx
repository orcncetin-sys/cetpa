/**
 * ReportKit.tsx — Rapor ekranlarının ORTAK yapı taşları.
 *
 * 2026-08-17: Rapor sayfaları (GenelRapor 3765, CrmRapor 4129, EnvanterRapor
 * 3720, LojistikRapor 2217, IKRapor 1814 satır) bölüm kartını ve KPI kartını
 * her yerde ELLE yazıyordu — `apple-card p-4 mb-4` + `<h3 className="font-
 * semibold text-sm mb-3">` deseni yüzlerce kez tekrarlanmış. Ortak bir bileşen
 * olmadığı için her sayfa kendi boşluk/tipografi/renk kararını veriyor ve
 * ekranlar birbirine benzemiyordu (kullanıcı: "raporlar tek tip olmalı,
 * renkler, fontlar").
 *
 * Buradaki bileşenler TEK stil kaynağıdır — rapor ekranları bunları kullanır,
 * kendi kart/başlık markup'ını yazmaz.
 */

import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { kapsamNotu, type KapsamSayaclari, type KapsamBirimi } from '../../utils/rapor/kapsamNotu';
import { oc } from '../../i18n/ortak';

// ── Bölüm kartı ───────────────────────────────────────────────────────────────

export interface ReportSectionProps {
  /** Bölüm başlığı. */
  title: React.ReactNode;
  /** Başlığın sağındaki opsiyonel aksiyon/filtre alanı. */
  action?: React.ReactNode;
  /** Başlık altındaki opsiyonel açıklama. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Rapor ekranlarındaki her grafik/tablo bloğunun standart sarmalayıcısı.
 * Boşluk, köşe yarıçapı ve başlık tipografisi TEK yerde tanımlı.
 */
export function ReportSection({ title, action, subtitle, children, className = '' }: ReportSectionProps) {
  return (
    <div className={`apple-card p-4 mb-4 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-[#1D1D1F] truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-[#86868B] mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

// ── KPI kartı ─────────────────────────────────────────────────────────────────

export interface KpiCardProps {
  /** Üstteki küçük büyük-harf etiket. */
  label: React.ReactNode;
  /** Ana değer (zaten biçimlendirilmiş metin bekler). */
  value: React.ReactNode;
  /** Değerin altındaki opsiyonel yardımcı satır (ör. "onay bekleyen talepler"). */
  hint?: React.ReactNode;
  /** Sol üstteki ikon (lucide bileşeni; renk/boyutu KpiCard verir). */
  icon?: React.ElementType;
  /** İkon yerine gösterilecek kısa simge, ör. para birimi işareti '₺'. */
  symbol?: React.ReactNode;
  /** İkonun vurgu rengi, ör. 'text-emerald-600'. */
  accent?: string;
  /** İkon kutusu zemini, ör. 'bg-emerald-50'. Verilmezse nötr gri. */
  accentBg?: string;
  /**
   * Rakamın rengi. VARSAYILAN NÖTR KOYU GRİ — bilerek: renk yalnız ikon
   * kutusunda durur, böylece dört kartlık şerit alacalı görünmez. Yalnız renk
   * gerçekten bilgi taşıdığında ez (ör. OTD oranı kırmızı/sarı/yeşil).
   */
  valueColor?: string;
  /**
   * Sağ üstteki aksiyon alanı (ör. TRY/USD/EUR para birimi düğmeleri).
   * Tıklamaları kartın kendi onClick'ine SIZDIRMAZ.
   */
  action?: React.ReactNode;
  /** Tıklanabilirse verilir — kart hover/pointer ve "detaya git" ipucu alır. */
  onClick?: () => void;
  /** Tıklanabilir kartın hover'da gösterdiği ipucu metni. */
  linkHint?: React.ReactNode;
  /** Şerit içindeki sıra — giriş animasyonunu kademelendirir. */
  index?: number;
  className?: string;
}

/**
 * Tek tip KPI kutusu — TÜM rapor ekranlarının ortak KPI görünümü.
 *
 * 2026-08-17 öncesinde her rapor kendi kartını yazıyordu ve hiçbiri diğerine
 * benzemiyordu: GenelRapor `p-6`+beyaz kart+renkli ikon kutusu, CrmRapor
 * `p-5`+renkli zemin+`text-3xl`, Lojistik/Envanter `p-5`+renkli zemin+
 * `text-2xl`, IKRapor ikonu etiketin yanında. Kullanıcı: "raporlar tek tip
 * olmalı, renkler, fontlar". Referans olarak GenelRapor'un (ana gösterge
 * ekranı) deseni seçildi: BEYAZ kart gövdesi + vurgu rengini yalnız ikon
 * kutusu ve rakam taşır. Renkli kart zeminleri kaldırıldı — 4 kartın 4 ayrı
 * pastel zemini ekranı alacalı gösteriyordu.
 */
export function KpiCard({
  label, value, hint, icon: Icon, symbol,
  accent = 'text-[#1D1D1F]', accentBg = 'bg-gray-100', valueColor = 'text-[#1D1D1F]',
  action, onClick, linkHint, index = 0, className = '',
}: KpiCardProps) {
  const clickable = typeof onClick === 'function';
  return (
    // KART ARTIK BIR DUGME DEGIL.
    //
    // Daha once tiklanabilir kart `role="button"` + tabIndex aliyordu; ama
    // icinde GERCEK <button> ogeleri var (para birimi secici). Ic ice
    // interaktif oge gecersiz ARIA'dir: ekran okuyucular ic dugmeleri hic
    // duyurmayabilir ve klavye olaylari karta baloncuklanir (o semptomu
    // stopPropagation ile bastirmistik — asil sorun yapinin kendisiydi).
    //
    // Cozum: kart notr bir kapsayici; tiklama sorumlulugu asagidaki gercek
    // <button>'a tasindi. Klavye erisimi, odak halkasi ve ekran okuyucu
    // duyurusu artik tarayicidan ucretsiz geliyor — el yapimi onKeyDown yok.
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`apple-card p-5 relative ${clickable ? 'hover:shadow-md hover:scale-[1.01] transition-all duration-200 group' : ''} ${className}`}
    >
      {(Icon || symbol || action) && (
        <div className="flex items-start justify-between mb-3">
          {(Icon || symbol) ? (
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accentBg}`}>
              {symbol
                ? <span className={`text-xl font-black leading-none ${accent}`}>{symbol}</span>
                : Icon && <Icon className={`w-5 h-5 ${accent}`} />}
            </div>
          ) : <span />}
          {/* Aksiyon alani (para birimi secici) artik kartin tiklama alaniyla
              CAKISMIYOR: tiklama ayri bir <button>'a tasindi, dolayisiyla
              stopPropagation gibi bir bastirmaya gerek kalmadi. `relative
              z-10` ile tam kapsayan tiklama katmaninin ustunde durur. */}
          {action && <div className="flex-shrink-0 relative z-10">{action}</div>}
        </div>
      )}
      <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{label}</p>
      {/* Dar ekranda 2 sütunlu şeritte kart ~130px içeriğe düşüyor; toptancı
          cirosu gibi uzun bir tutar (`₺12.345.678,90`) sabit `text-2xl` ile
          karttan taşıyordu. Telefonda bir kademe küçük + kelime kırma ile
          hangi ızgarada olursa olsun taşma olmuyor (code-review bulgusu). */}
      <p className={`text-xl sm:text-2xl font-bold mt-1 break-words ${valueColor}`}>{value}</p>
      {hint && <p className="text-[11px] text-[#86868B] mt-1">{hint}</p>}
      {clickable && linkHint && (
        <p className="text-[10px] text-brand mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-3 h-3" />{linkHint}
        </p>
      )}
      {clickable && (
        // Karti kaplayan gercek dugme. Gorsel icerik zaten yukarida; bu oge
        // yalnizca tiklama/odak tasir, bu yuzden metni sr-only.
        // `inset-0` ile tum karti kaplar ama `action` alani z-10 ile ustte
        // kaldigi icin para birimi dugmeleri erisilebilir kalir.
        <button
          type="button"
          onClick={onClick}
          className="absolute inset-0 w-full h-full rounded-2xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <span className="sr-only">{typeof label === 'string' ? label : 'Detaya git'}</span>
        </button>
      )}
    </motion.div>
  );
}

// ── KPI şeridi ────────────────────────────────────────────────────────────────

/**
 * KPI kartlarını standart ızgarada dizer. Boşluk (`gap-4`) ve kırılma noktaları
 * TEK yerde — ekranlar arasında gap-4/gap-6 farkı buradan kalktı.
 */
export function KpiGrid({ cols = 4, children, className = '' }: {
  /** Geniş ekrandaki sütun sayısı. Mobilde her zaman 2 (3'lük şeritte 1). */
  cols?: 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  // 4'lük şeritte `md:grid-cols-4` KORUNDU: Crm/Envanter/Lojistik zaten
  // tablette 4 sütundu, ara bir `md:grid-cols-2` kademesi onları 2 sütuna
  // düşürüp mevcut yerleşimi bozuyordu (code-review bulgusu).
  const grid = cols === 3
    ? 'grid-cols-1 md:grid-cols-3'
    : 'grid-cols-2 md:grid-cols-4';
  return <div className={`grid ${grid} gap-4 ${className}`}>{children}</div>;
}

// ── Para birimi seçici ────────────────────────────────────────────────────────

/**
 * KPI kartının sağ üstündeki TRY/USD/EUR düğmeleri. Envanter, IK ve Genel
 * raporlarında birebir aynı markup üç kez kopyalanmıştı (biri `bg-white/70`,
 * biri `bg-gray-100`, seçili rengi biri yeşil biri marka kırmızısı).
 */
export function KpiCurrencyToggle({ value, onChange }: {
  value: 'TRY' | 'USD' | 'EUR';
  onChange: (c: 'TRY' | 'USD' | 'EUR') => void;
}) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {(['TRY', 'USD', 'EUR'] as const).map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          aria-pressed={value === c}
          className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold transition-colors ${
            value === c ? 'bg-white text-brand shadow-sm' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {c === 'TRY' ? '₺' : c === 'USD' ? '$' : '€'}
        </button>
      ))}
    </div>
  );
}

// ── Kapsam notu ───────────────────────────────────────────────────────────────

export interface KapsamNotuProps {
  /** Yardımcı çıktılarından AYNEN gelen sayaçlar — bileşende toplanmaz/çıkarılmaz. */
  sayaclar: KapsamSayaclari;
  /**
   * YALNIZ serbest sayaçlar (tutarsiz / tarihsiz / maliyetsiz / kapsamDisi / dovizli) için;
   * SABİT birimli sayaçlar (miktarsiz, esiksiz, kimliksiz, eslesmeyen, kalemsiz) bunu yok sayar.
   * Bu yüzden KARIŞIK birimli bir sayaç kümesi TEK `<KapsamNotu>` ile geçer — bileşen sayaçları
   * bölmez, `birim`'e göre dallanmaz, metin birleştirmez.
   */
  birim?: KapsamBirimi;
  /** `currentLanguage` AYNEN geçer; daraltma `kapsamNotu` içinde (`oc()` kuralı: 'tr' değilse İngilizce). */
  dil: string;
  /** Çağıranın panel cümlesi, ÇAĞIRANIN DİLİNDE (tr/en çifti çağıranda kurulur). */
  sonuc?: string;
  className?: string;
}

/**
 * Kısmi toplamın altındaki tek satırlık "neyin dışarıda kaldığı" notu.
 *
 * NEDEN BİLEŞEN: EKRAN sözleşmesi (`para.ts` `ekranTutari`) kısmi toplamın yanında notu ZORUNLU
 * kılıyor; 6/n boyunca ~110 panel bu notu basacak. Satır içi yazılsaydı ~110 kopya metin + ~110
 * ayrı "0 iken basma" koşulu olurdu (Faz 0 kök nedeni: kopya kod).
 *
 * METNİ BU BİLEŞEN ÜRETMEZ — `rapor/kapsamNotu` üretir; burada yalnız `<p>` sarmalaması ve
 * "basılacak bir şey yoksa HİÇ düğüm çizme" kuralı var (boş `<p>` mt-2 boşluğu bırakırdı).
 * Varsayılan sınıf, yerini aldığı mevcut satır içi notlarla aynı (`GenelOzet:103`,
 * `RaporlarPage:399,510` → `text-[11px] text-amber-600 mt-2/3`) — tek tip görünüm.
 *
 * KPI kartında KULLANILMAZ: orada `KpiCard.hint={kapsamNotu(…) ?? undefined}` yeter (kartın kendi
 * ipucu tipografisi var).
 */
export function KapsamNotu({
  sayaclar, birim, dil, sonuc, className = 'text-[11px] text-amber-600 mt-2',
}: KapsamNotuProps): React.ReactElement | null {
  const metin = kapsamNotu(sayaclar, { birim, dil, sonuc });
  if (metin === null) return null;
  return <p className={className}>{metin}</p>;
}

// ── Ölçek çubuğu ──────────────────────────────────────────────────────────────

/**
 * BİLİNMEYEN oranın deseni — gri çapraz tarama. Dolu bir renk kullanılamaz: o zaman "bilinmiyor"
 * ile "gerçek değer" görsel olarak ayırt edilemezdi (eski kod bilinmeyeni düz `#d1d5db` çiziyordu,
 * gerçek bir gri çubuktan farksızdı).
 */
const BILINMEYEN_DESENI = 'repeating-linear-gradient(45deg, #e5e7eb 0 4px, #f3f4f6 4px 8px)';

export interface OlcekCubuguProps {
  /**
   * Yüzde (0–100+). `null` / `undefined` / `NaN` / `±Infinity` = BİLİNMİYOR.
   * Bileşen ORAN HESAPLAMAZ; kaynak testli yardımcılardır: `lojistikKpi.oranYuzde(deger, olcek)` ·
   * `cubuk.cubukOrani` · `gelirGider.cubukYuzdesi` · `kpiTrend.hedefOrani` — hepsi bilinmeyende
   * `null` döner, buraya doğrudan geçirilir.
   */
  oran: number | null | undefined;
  /** 'yatay' = ilerleme çubuğu (ray İÇERİDE), 'dikey' = sparkline sütunu (yükseklik kabı ÇAĞIRANDA). */
  yon?: 'yatay' | 'dikey';
  /** CSS rengi (`style.background`) — dikey sparkline'lar bunu kullanıyor. */
  renk?: string;
  /** Tailwind renk sınıfı (`bg-blue-500` …) — yatay ilerleme çubukları bunu kullanıyor. */
  renkSinifi?: string;
  /** Yatay: rayın kalınlığı ('h-1.5' | 'h-3' …). Dikey: sütunun genişliği ('w-full'). */
  kalinlik?: string;
  /** Varsayılan: yatay 'rounded-full', dikey 'rounded-t-md'. */
  koseSinifi?: string;
  title?: string;
  /**
   * ADDITIVE (şartname imzasında yoktu): "bilinmiyor" `aria-label`'ının dili. Verilmezse Türkçe —
   * `oc()` ile AYNI daraltma. Metin ORTAK sözlükten (`oc(dil).bilinmiyor`) gelir, satır içi
   * yazılmaz.
   */
  dil?: string;
}

/**
 * Tek çubuk — ÜÇ DURUMU ayıran tek yer.
 *
 * KAYNAK, DÜRÜSTÇE: bu davranış PLAN'ın K26 VARSAYILANIDIR, kullanıcı kararı DEĞİL —
 * `PLAN-v2.md:188` K26'yı açıkça "karar metni olmayan satırlar" arasında sayıyor
 * (`PLAN.md:358` "min 2–4 px kalksın; bilinmeyen = gri taralı, gerçek 0 = boş" cümlesi PLAN'ın
 * ÖNERİSİDİR). Kullanıcı bunu onaylarsa/değiştirirse tek dokunulacak yer burasıdır; o zaman
 * kullanıcının kendi cümlesi bu yoruma yazılır (KARARLAR.md kuralı).
 *
 *   BİLİNMİYOR → tam boy gri çapraz taralı + `aria-label`, çağıranın rengi UYGULANMAZ.
 *   ≤ 0        → dolgu hiç çizilmez (yatayda yalnız boş ray kalır).
 *   > 0        → `Math.min(oran, 100)%` dolgu, verilen renk/sınıf.
 *
 * NEDEN: bugün ~80 çağrı yeri `style={{ height: `${Math.max(h, 2)}%` }}` ya da
 * `Math.max(4, Math.round(...))` yazıyor (`RaporlarPage:503,584`, `GenelOzet:193,337,385`). O taban
 * üç ayrı yalanı aynı anda söylüyordu: (1) veri yokken "az da olsa hareket var", (2) gerçek 0 ile
 * bilinmeyen aynı görünüyor, (3) tepe değer bilinmiyorsa bütün seri tabana yapışıyor. Ölçek
 * tarafındaki karşılığı `pano/cubuk.sayacOlcegi` (`, 1` uydurma tabanı yok) — ikisi birlikte
 * çalışır: ölçek `null` → oran `null` → taralı çubuk.
 *
 * DİKEY'DE RAY YOKTUR: dış öğe saydam bir `h-full` kolondur, yükseklik kabı (`h-20` /
 * `style={{ height: '80px' }}`) ÇAĞIRANDA kalır — mevcut yerleşim bozulmaz. Dolgu yine de dış
 * öğenin ÇOCUĞUDUR, böylece "≤ 0 → dolgu öğesi yok" kuralı iki yönde de aynıdır.
 */
export function OlcekCubugu({
  oran, yon = 'yatay', renk, renkSinifi, kalinlik, koseSinifi, title, dil,
}: OlcekCubuguProps): React.ReactElement {
  const dikey = yon === 'dikey';
  const kose = koseSinifi ?? (dikey ? 'rounded-t-md' : 'rounded-full');
  const kalin = kalinlik ?? (dikey ? 'w-full' : 'h-1.5');

  // `Number.isFinite` (global `isFinite` DEĞİL: `isFinite(null) === true`). `typeof` daraltması
  // `sayi`yi `number | null` yapar — `as` / `!` gerekmez.
  const sayi = typeof oran === 'number' && Number.isFinite(oran) ? oran : null;
  const bilinmiyor = sayi === null;
  const cizilir = bilinmiyor || sayi > 0;
  const yuzde = bilinmiyor ? 100 : Math.min(sayi, 100);

  const dolguSinifi = [
    dikey ? kalin : 'h-full',
    kose,
    'transition-all duration-500',
    bilinmiyor ? '' : renkSinifi ?? '',
  ].filter(Boolean).join(' ');

  const dolguStili: React.CSSProperties = dikey ? { height: `${yuzde}%` } : { width: `${yuzde}%` };
  if (bilinmiyor) dolguStili.background = BILINMEYEN_DESENI;
  else if (renk !== undefined) dolguStili.background = renk;

  const dolgu = cizilir
    ? (
      <div
        className={dolguSinifi}
        style={dolguStili}
        // Ekran okuyucu "bilinmiyor"u duysun diye GERÇEK bir rol gerekiyor: etiketli ama rolsüz
        // <div> çoğu okuyucuda hiç duyurulmaz. Bilinen çubukta rol/etiket YOK — sayı zaten
        // çubuğun yanında metin olarak basılı, ikinci kez okutmak gürültü olur.
        {...(bilinmiyor ? { role: 'img' as const, 'aria-label': oc(dil).bilinmiyor } : {})}
      />
    )
    : null;

  return dikey
    ? <div className="w-full h-full flex flex-col justify-end" title={title}>{dolgu}</div>
    : <div className={`w-full ${kalin} bg-gray-100 ${kose} overflow-hidden`} title={title}>{dolgu}</div>;
}
