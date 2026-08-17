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
  /** Değerin altındaki opsiyonel yardımcı satır (ör. "geçen aya göre +%12"). */
  hint?: React.ReactNode;
  /** Sol üstteki ikon. */
  icon?: React.ReactNode;
  /** İkon arka plan sınıfı, ör. 'bg-blue-50'. */
  iconBg?: string;
  /** Değer rengi sınıfı, ör. 'text-emerald-600'. Varsayılan koyu gri. */
  valueColor?: string;
  /** Tıklanabilirse verilir — kart hover/pointer alır. */
  onClick?: () => void;
  className?: string;
}

/**
 * Tek tip KPI kutusu. Rakam boyutu/rengi, etiket tipografisi ve iç boşluk
 * burada sabitlenmiştir — sayfalar bunları kendi başına belirlemez.
 */
export function KpiCard({
  label, value, hint, icon, iconBg = 'bg-gray-50',
  valueColor = 'text-[#1D1D1F]', onClick, className = '',
}: KpiCardProps) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`apple-card p-4 ${clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${className}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }) : undefined}
    >
      {icon && (
        <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center mb-2`}>{icon}</div>
      )}
      <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
      {hint && <p className="text-[11px] text-[#86868B] mt-1">{hint}</p>}
    </div>
  );
}

// ── KPI şeridi ────────────────────────────────────────────────────────────────

/** KPI kartlarını standart ızgarada dizer (mobilde 2, geniş ekranda 4 sütun). */
export function KpiGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 ${className}`}>{children}</div>;
}
