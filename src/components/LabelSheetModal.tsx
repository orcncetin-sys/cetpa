/**
 * LabelSheetModal.tsx — Printable inventory label sheet
 *
 * Renders a print-optimised A4 sheet of product labels (3×3 grid).
 * Each label contains: product name, SKU, price, and a QR code
 * (encoding the SKU for warehouse scanning).
 *
 * Uses qrcode.react for QR generation and window.print() for printing.
 * A <style> tag injects @media print rules so ONLY the label sheet prints.
 */

import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LabelItem {
  id:    string;
  name:  string;
  sku:   string;
  price: number;       // retail price in TRY
  unit?: string;
}

interface LabelSheetModalProps {
  items:           LabelItem[];
  currentLanguage?: string;
  onClose:         () => void;
}

// ── Single label ──────────────────────────────────────────────────────────────

function Label({ item, lang }: { item: LabelItem; lang: boolean }) {
  return (
    <div
      style={{
        width: '62mm', height: '38mm',
        border: '0.5pt solid #d1d5db',
        borderRadius: '3mm',
        padding: '3mm',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'Arial, sans-serif',
        boxSizing: 'border-box',
        pageBreakInside: 'avoid',
        backgroundColor: '#fff',
      }}
    >
      {/* Top: name + SKU */}
      <div>
        <p style={{ fontSize: '8pt', fontWeight: 700, margin: 0, lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: '43mm' }}>
          {item.name}
        </p>
        <p style={{ fontSize: '6.5pt', color: '#6b7280', margin: '1mm 0 0', fontFamily: 'monospace' }}>
          {item.sku}
        </p>
      </div>

      {/* Bottom: price + QR */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: '5.5pt', color: '#9ca3af', margin: '0 0 0.5mm', fontWeight: 600 }}>
            {lang ? 'FİYAT' : 'PRICE'}
          </p>
          <p style={{ fontSize: '11pt', fontWeight: 800, color: '#1a3a5c', margin: 0 }}>
            ₺{item.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </p>
          {item.unit && (
            <p style={{ fontSize: '5.5pt', color: '#9ca3af', margin: '0.5mm 0 0' }}>/ {item.unit}</p>
          )}
        </div>
        <QRCodeSVG
          value={item.sku || item.id}
          size={52}
          level="M"
          includeMargin={false}
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LabelSheetModal({ items, currentLanguage = 'tr', onClose }: LabelSheetModalProps) {
  const lang = currentLanguage === 'tr';
  const sheetRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const style = document.createElement('style');
    style.id = '__label_print_style__';
    // Use textContent instead of innerHTML to avoid XSS foothold
    style.textContent = [
      '@media print {',
      '  body > *:not(#__label_sheet__) { display: none !important; }',
      '  #__label_sheet__ { display: block !important; position: fixed; top: 0; left: 0; width: 100%; }',
      '  @page { size: A4 portrait; margin: 8mm; }',
      '}',
    ].join('\n');
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.getElementById('__label_print_style__')?.remove(), 500);
  };

  // Pad to multiple of 9 (3×3 grid)
  const padded = [...items];
  while (padded.length % 9 !== 0) padded.push({ id: '', name: '', sku: '', price: 0 });

  const pages: LabelItem[][] = [];
  for (let i = 0; i < padded.length; i += 9) pages.push(padded.slice(i, i + 9));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-base text-gray-900">
              {lang ? 'Etiket Yazdır' : 'Print Labels'}
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {items.length} {lang ? 'ürün etiketi — A4 kağıda 9 etiket/sayfa' : 'labels — 9 per A4 page'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-sm font-bold transition-colors"
            >
              <Printer className="w-4 h-4" />
              {lang ? 'Yazdır' : 'Print'}
            </button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Label preview */}
        <div id="__label_sheet__" ref={sheetRef} className="p-5">
          {pages.map((page, pi) => (
            <div
              key={pi}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 62mm)',
                gap: '4mm',
                pageBreakAfter: pi < pages.length - 1 ? 'always' : 'auto',
                marginBottom: pi < pages.length - 1 ? '16px' : 0,
              }}
            >
              {page.map((item, li) =>
                item.name
                  ? <Label key={`${pi}-${li}`} item={item} lang={lang} />
                  : <div key={`${pi}-${li}`} style={{ width: '62mm', height: '38mm' }} />
              )}
            </div>
          ))}
        </div>

        <p className="text-[10px] text-gray-400 text-center px-5 pb-4">
          {lang
            ? 'Yazdırma öncesinde tarayıcı baskı önizlemesinde "Kenar boşluklarını kaldır" ve "Arka plan grafiklerini yazdır" seçeneklerini etkinleştirin.'
            : 'Before printing, enable "Remove margins" and "Print background graphics" in the browser print preview.'}
        </p>
      </div>
    </div>
  );
}
