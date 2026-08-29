/**
 * LabelSheetModal.tsx — Printable inventory label sheet (A4, 3×3)
 *
 * 2026-08-28 yeniden yazımı — üç kullanıcı bildirimi:
 *
 * 1. "Yazdıra basınca boş ekran geliyor." KÖK NEDEN: eski yazdırma,
 *    `body > *:not(#__label_sheet__) { display:none }` kuralına dayanıyordu.
 *    Ama etiket sayfası body'nin DOĞRUDAN çocuğu değil — modalın İÇİNDE.
 *    Kural modalın kök div'ini gizleyince içindeki etiketler de gizleniyor
 *    ve yazıcıya boş sayfa gidiyordu. Çözüm: yazdırma artık GİZLİ IFRAME ile
 *    yapılır — etiket HTML'i (QR SVG'leri dahil) iframe'e kopyalanır ve
 *    iframe yazdırılır. Sayfadaki hiçbir CSS/DOM yapısına bağımlı değildir.
 *
 * 2. "Filtre olmalı." Arama kutusu eklendi (Türkçe-duyarlı, utils/arama.ts —
 *    'ISIK' yazan 'Işık'ı bulur).
 *
 * 3. "Kaç adet yazdıracağıma karar verebilmeliyim." Her etikette adet alanı
 *    (varsayılan 1, 0 = bu etiket basılmaz); yazdırılan sayfa adet kadar
 *    kopya içerir. Mikro Etiket Kuyruğu da aynı adetleri gönderir.
 *
 * Önizleme İLK 90 etiketle sınırlıdır (10 sayfa) — 2.376 ürünün tamamına QR
 * çizmek tarayıcıyı kilitliyordu; kalanlar için üstte "filtreleyin" notu
 * çıkar. YAZDIRMA da görünen (filtrelenmiş) listeyi basar, yani önizlemede
 * ne varsa kağıtta o vardır — sürpriz yok.
 */

import { useMemo, useRef, useState } from 'react';
import MikroPushButton from './MikroPushButton';
import { etiketPayload } from '../services/mikroEvrak';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer, Search } from 'lucide-react';
import { eslesir } from '../utils/arama';

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

/** Önizlemede aynı anda çizilecek en çok etiket (QR başına bir SVG). */
const ONIZLEME_TAVANI = 90;

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
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: '9pt', fontWeight: 700, lineHeight: 1.15, maxHeight: '9mm', overflow: 'hidden' }}>
        {item.name}
      </div>
      <div style={{ fontSize: '7pt', fontFamily: 'monospace', color: '#374151' }}>{item.sku}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '6pt', color: '#9ca3af', letterSpacing: '0.5px' }}>{lang ? 'FİYAT' : 'PRICE'}</div>
          <div style={{ fontSize: '11pt', fontWeight: 800, color: '#111827' }}>
            ₺{item.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '5.5pt', color: '#9ca3af' }}>/{item.unit || (lang ? 'ADET' : 'PC')}</div>
        </div>
        <QRCodeSVG value={item.sku || item.id} size={62} level="M" />
      </div>
    </div>
  );
}

export default function LabelSheetModal({ items, currentLanguage = 'tr', onClose }: LabelSheetModalProps) {
  const lang = currentLanguage === 'tr';
  const sheetRef = useRef<HTMLDivElement>(null);
  const [ara, setAra] = useState('');
  /** SKU → basılacak adet. Haritada olmayan = 1 (varsayılan). 0 = basılmaz. */
  const [adetler, setAdetler] = useState<Record<string, number>>({});

  const adet = (sku: string) => adetler[sku] ?? 1;

  const filtreli = useMemo(
    () => items.filter(i => eslesir(ara, i.name, i.sku)),
    [items, ara],
  );

  // Adet kadar kopya + 0 adetliler dışarıda; sonra önizleme tavanı.
  const basilacak = useMemo(() => {
    const liste: LabelItem[] = [];
    for (const i of filtreli) {
      for (let k = 0; k < Math.min(99, adet(i.sku)); k++) liste.push(i);
    }
    return liste;
  }, [filtreli, adetler]);
  const gorunen = basilacak.slice(0, ONIZLEME_TAVANI);
  const gizliAdet = basilacak.length - gorunen.length;

  const pages: LabelItem[][] = [];
  for (let i = 0; i < gorunen.length; i += 9) pages.push(gorunen.slice(i, i + 9));

  const handlePrint = () => {
    const kaynak = sheetRef.current;
    if (!kaynak) return;
    // Gizli iframe: sayfanın DOM/CSS yapısından TAMAMEN bağımsız yazdırma.
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0'; frame.style.bottom = '0';
    frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
    document.body.appendChild(frame);
    const idoc = frame.contentDocument;
    if (!idoc) { frame.remove(); return; }
    idoc.open();
    idoc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: A4 portrait; margin: 8mm; }
      body { margin: 0; }
    </style></head><body>${kaynak.innerHTML}</body></html>`);
    idoc.close();
    // SVG'ler inline olduğu için ek yükleme beklenmez; yine de bir frame bekle.
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      // Yazdırma diyaloğu kapanana kadar iframe yaşamalı — geç temizle.
      setTimeout(() => frame.remove(), 60_000);
    }, 50);
  };

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
              {basilacak.length} {lang ? 'etiket — A4 kağıda 9 etiket/sayfa' : 'labels — 9 per A4 page'}
              {filtreli.length !== items.length && ` · ${filtreli.length}/${items.length} ${lang ? 'ürün filtrede' : 'products match'}`}
            </p>
            <div className="mt-1.5">
              <MikroPushButton
                compact
                label="Mikro Etiket Kuyruğu"
                method="EtiketBasimKaydetV2"
                entityType="labelBatch"
                entityId={String(basilacak.length)}
                buildPayload={() => {
                  const valid = filtreli.filter(i => i.sku && adet(i.sku) > 0);
                  if (valid.length === 0) return null;
                  return etiketPayload(valid.map(i => ({ sku: i.sku, adet: adet(i.sku) })));
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              disabled={basilacak.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a3a5c] hover:bg-[#1a3a5c]/90 text-white text-sm font-bold transition-colors disabled:opacity-40"
            >
              <Printer className="w-4 h-4" />
              {lang ? 'Yazdır' : 'Print'}
            </button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl" aria-label={lang ? 'Kapat' : 'Close'}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filtre + adet listesi */}
        <div className="px-5 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={ara}
              onChange={e => setAra(e.target.value)}
              placeholder={lang ? 'Ürün adı veya SKU ile filtrele…' : 'Filter by name or SKU…'}
              className="apple-input w-full pl-9 text-sm"
            />
          </div>
          {gizliAdet > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {lang
                ? `Önizleme ilk ${ONIZLEME_TAVANI} etiketi gösteriyor (${gizliAdet} etiket daha var). Yazdırma da yalnız GÖRÜNENLERİ basar — hepsini basmak için filtreleyerek parti parti yazdırın.`
                : `Preview shows the first ${ONIZLEME_TAVANI} labels (${gizliAdet} more). Printing outputs the visible labels only.`}
            </p>
          )}
          {/* Adet düzenleme: filtrelenmiş İLK 30 ürün için kompakt liste.
              2.376 ürünün hepsine input çizmek anlamsız — adet ayarı zaten
              filtreleyip belirli ürünlere yapılır. */}
          {ara.trim() && (
            <div className="max-h-44 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
              {filtreli.slice(0, 30).map(i => (
                <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 truncate">{i.name}</p>
                    <p className="text-[10px] font-mono text-gray-400">{i.sku}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-gray-400">{lang ? 'adet' : 'qty'}</span>
                    <input
                      type="number" min={0} max={99}
                      value={adet(i.sku)}
                      onChange={e => setAdetler(a => ({ ...a, [i.sku]: Math.max(0, Math.min(99, Number(e.target.value) || 0)) }))}
                      className="w-14 apple-input text-xs text-center py-1"
                      aria-label={`${i.name} ${lang ? 'etiket adedi' : 'label count'}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Label preview */}
        <div ref={sheetRef} className="p-5">
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
              {page.map((item, li) => <Label key={`${pi}-${li}`} item={item} lang={lang} />)}
            </div>
          ))}
          {pages.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-10">
              {lang ? 'Filtreye uyan etiket yok.' : 'No labels match the filter.'}
            </p>
          )}
        </div>

        <p className="text-[10px] text-gray-400 text-center px-5 pb-4">
          {lang
            ? 'Baskı önizlemesinde "Arka plan grafiklerini yazdır" seçeneğini etkinleştirin.'
            : 'Enable "Print background graphics" in the browser print preview.'}
        </p>
      </div>
    </div>
  );
}
