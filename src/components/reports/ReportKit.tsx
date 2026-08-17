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
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`apple-card p-5 ${clickable ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] transition-all duration-200 group' : ''} ${className}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }) : undefined}
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
          {action && (
            // Aksiyon alanı (para birimi düğmeleri) kartın KENDİ tıklamasını
            // tetiklememeli. onClick YETMEZ: kart tıklanabilir olduğunda
            // onKeyDown de kartta duruyor ve düğmeye Tab'layıp Enter'a basan
            // kullanıcının tuşu kartın üstüne baloncuklanıp para birimini
            // değiştirmek yerine başka sekmeye gönderiyordu (code-review bulgusu).
            <div
              className="flex-shrink-0"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            >
              {action}
            </div>
          )}
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
