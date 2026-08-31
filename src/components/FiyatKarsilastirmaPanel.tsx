/**
 * FiyatKarsilastirmaPanel — stok bazında ortalama alım vs satış fiyatı.
 *
 * MuhasebePage'den ÇIKARILDI (2026-08-31, kullanıcı isteği: "fiyat karşılaştırma
 * bence Satın Alma'da olmalı"). State tamamen izoleydi (fk* önekli, kendi API
 * uçları) — CLAUDE.md paylaşılan-state kontrolü yapıldı, başka sekmeyle hesap
 * paylaşımı YOK; fiziksel taşıma güvenli. Artık Satın Alma → Fiyat Karşılaştırma.
 *
 * ── Fiyat Karşılaştırma (2026-08-13 kullanıcı isteği) ───────────────────────
 * Mikro'da hazır olmayan bir rapor: stok bazında ortalama alım fiyatı vs
 * ortalama satış fiyatı. Sunucuda /api/reports/stok-fiyat-karsilastirma
 * STOK_HAREKETLERI kaynaklı inventoryMovements'ı SKU+yön bazında topluyor —
 * bu panel yalnız o özeti çeker; SKU'ya tıklayınca ayrı bir uçtan işlem detayı gelir.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Coins, Search, X, ChevronRight } from 'lucide-react';
import ModuleHeader from './ModuleHeader';
import MikroFaturaDetay, { type MikroFaturaDetayVerisi } from './MikroFaturaDetay';
import { SortHeader } from './accounting/shared';
import { faturaEsle } from '../utils/faturaEsle';
import { authFetch } from '../services/authFetch';
import type { MikroFatura } from '../hooks/useMikroFaturalar';

interface FiyatKarsilastirmaRow {
  sku: string; ad: string;
  alisOrtFiyat: number | null; alisMiktar: number; alisTutar: number; alisAdet: number;
  satisOrtFiyat: number | null; satisMiktar: number; satisTutar: number; satisAdet: number;
  marjTL: number | null; marjYuzde: number | null;
  /** inventory.stockLevel'dan — hareket netine değil gerçek stoğa dayanır; SKU inventory'de yoksa null. */
  kalanStok: number | null;
}
interface FiyatDetaySatiri {
  tarih: string | null; yon: 'alis' | 'satis'; miktar: number; tutar: number;
  birimFiyat: number; cariKod: string | null; evrakNo: string | null;
}
type FkSortKey = 'ad' | 'alisOrtFiyat' | 'alisMiktar' | 'satisOrtFiyat' | 'satisMiktar' | 'marjTL' | 'kalanStok';

interface Props {
  currentLanguage: string;
  userRole?: string | null;
  /** Paylaşılan KPI formatlayıcı — kendi TL-sabit formatlayıcımız kur değiştirme
   *  (kpiCurrency) desteğini atlıyordu (2026-08-13 code review bulgusu). */
  fmtKpi: (v: number, fmt?: 'full' | 'K', decimals?: number) => string;
  mikroFaturalar: MikroFatura[];
}

export default function FiyatKarsilastirmaPanel({ currentLanguage, userRole, fmtKpi, mikroFaturalar }: Props) {
  const [fkRows, setFkRows] = useState<FiyatKarsilastirmaRow[]>([]);
  const [fkLoading, setFkLoading] = useState(false);
  const [fkError, setFkError] = useState<string | null>(null);
  const [fkSearch, setFkSearch] = useState('');
  // Sıralama (2026-08-13 kullanıcı bildirimi: tablo hiç sıralanmıyordu — kolon
  // başlıkları tıklanabilir değildi). AccountingModule'deki SortHeader deseni
  // ortak modülden geliyor; sıralama mantığı bu tek tabloya özel ve hafif.
  const [fkSortKey, setFkSortKey] = useState<FkSortKey>('ad');
  const [fkSortDir, setFkSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleFkSort = (key: FkSortKey) => {
    if (fkSortKey === key) setFkSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setFkSortKey(key); setFkSortDir('asc'); }
  };
  const [fkDetaySku, setFkDetaySku] = useState<string | null>(null);
  const [fkDetaySatirlari, setFkDetaySatirlari] = useState<FiyatDetaySatiri[]>([]);
  /** Evrak numarasına basınca açılan fatura (2026-08-28 kullanıcı isteği). */
  const [fkFatura, setFkFatura] = useState<MikroFaturaDetayVerisi | null>(null);
  const [fkDetayLoading, setFkDetayLoading] = useState(false);
  /** Sessiz-başarısızlık taraması (2026-08-31): success:false gelince modal
   *  "Hareket bulunamadı" diyordu — hata ile boş liste ayrışmıyordu. */
  const [fkDetayHata, setFkDetayHata] = useState<string | null>(null);

  useEffect(() => {
    // Panel yalnız sekme açıkken mount olur — sekme kapısı yerine mount yeter.
    if (!userRole) return;
    let iptal = false;
    setFkLoading(true); setFkError(null);
    authFetch('/api/reports/stok-fiyat-karsilastirma')
      .then(r => r.json())
      .then(json => {
        if (iptal) return;
        if (json.success) setFkRows(json.rows);
        else setFkError(json.error || (currentLanguage === 'tr' ? 'Veri alınamadı.' : 'Failed to load.'));
      })
      .catch(() => { if (!iptal) setFkError(currentLanguage === 'tr' ? 'Veri alınamadı.' : 'Failed to load.'); })
      .finally(() => { if (!iptal) setFkLoading(false); });
    return () => { iptal = true; };
  }, [userRole, currentLanguage]);

  // AYNI ANDA TEK ISTEK GECERLI (2026-08-24 React denetimi).
  //
  // Eskiden iptal bayragi yoktu: kullanici A SKU'suna tiklayip (Mikro uclari
  // yavas, istek ucusta) modali kapatip hemen B'ye tiklayinca, B'nin yaniti
  // once basiliyor, ardindan A'nin GEC gelen yaniti onun ustune yaziyordu.
  // Modal basliginda B'nin kodu yazarken tabloda A urununun hareketleri
  // gorunuyordu - kullanici yanlis urunun fiyat gecmisine bakiyordu.
  const fkDetayIstekRef = useRef(0);
  const fkAcDetay = (sku: string) => {
    const istekNo = ++fkDetayIstekRef.current;
    setFkDetaySku(sku); setFkDetayLoading(true); setFkDetaySatirlari([]); setFkDetayHata(null);
    authFetch(`/api/reports/stok-fiyat-karsilastirma/${encodeURIComponent(sku)}/detay`)
      .then(r => r.json())
      .then(json => {
        if (istekNo !== fkDetayIstekRef.current) return;   // bayat yanit - yok say
        if (json.success) setFkDetaySatirlari(json.satirlar);
        else setFkDetayHata(json.error || (trFk ? 'Detay alınamadı.' : 'Failed to load detail.'));
      })
      .catch(() => { if (istekNo === fkDetayIstekRef.current) setFkDetayHata(trFk ? 'Detay alınamadı.' : 'Failed to load detail.'); })
      .finally(() => { if (istekNo === fkDetayIstekRef.current) setFkDetayLoading(false); });
  };

  const trFk = currentLanguage === 'tr';
  const fmtF = (v: number | null) => v == null ? '—' : fmtKpi(v, 'full', 2);
  const filtered = fkRows
    .filter(r =>
      !fkSearch || r.sku.toLowerCase().includes(fkSearch.toLowerCase()) || r.ad.toLowerCase().includes(fkSearch.toLowerCase())
    )
    .slice()
    .sort((a, b) => {
      const av = a[fkSortKey], bv = b[fkSortKey];
      if (typeof av === 'string' || typeof bv === 'string') {
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'tr');
        return fkSortDir === 'asc' ? cmp : -cmp;
      }
      // Sayısal alanlar: null'lar (henüz alım/satış yok) yön ne olursa
      // olsun sona düşsün — bu yüzden null karşılaştırması asc/desc
      // çevirisinin DIŞINDA, doğrudan döndürülüyor (2026-08-13 code
      // review bulgusu: eskiden `fkSortDir==='asc'?cmp:-cmp` null
      // sıralamasını da ters çeviriyordu, azalanda null'lar başa düşüyordu).
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av - bv;
      return fkSortDir === 'asc' ? cmp : -cmp;
    });

  return (
    <motion.div key="satinalma-fiyat-karsilastirma" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <ModuleHeader
        title={trFk ? 'Fiyat Karşılaştırma' : 'Price Comparison'}
        subtitle={trFk ? 'Stok bazında ortalama alım fiyatı ve satış fiyatı — Mikro hazır raporunda yok, stok hareketlerinden hesaplanır' : 'Average purchase vs. sale price per SKU — computed from stock movements'}
        icon={Coins}
      />
      <div className="flex items-center gap-2">
        <Search size={14} className="text-gray-400" />
        <input value={fkSearch} onChange={e => setFkSearch(e.target.value)} placeholder={trFk ? 'SKU veya ürün adı ara...' : 'Search SKU or name...'} className="apple-input px-3 py-2 text-sm flex-1 max-w-xs" />
        {!fkLoading && <span className="text-xs text-gray-400">{filtered.length} {trFk ? 'ürün' : 'items'}</span>}
      </div>
      {fkLoading && <p className="text-center text-gray-400 text-sm py-8">{trFk ? 'Yükleniyor…' : 'Loading…'}</p>}
      {fkError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700">{fkError}</div>}
      {!fkLoading && !fkError && filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm py-8">{trFk ? 'Mikro stok hareketi bulunamadı. "Stok Hareketleri" çekilmiş mi?' : 'No Mikro stock movements found.'}</p>
      )}
      {!fkLoading && !fkError && filtered.length > 0 && (
        <div className="apple-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <SortHeader label={trFk ? 'Ürün' : 'Product'} sortKey="ad" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} />
                  <SortHeader label={trFk ? 'Ort. Alım (KDV hariç)' : 'Avg. Purchase (excl. VAT)'} sortKey="alisOrtFiyat" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right" />
                  <SortHeader label={trFk ? 'Alım Miktarı' : 'Purchase Qty'} sortKey="alisMiktar" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right hidden md:table-cell" />
                  <SortHeader label={trFk ? 'Ort. Satış (KDV hariç)' : 'Avg. Sale (excl. VAT)'} sortKey="satisOrtFiyat" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right" />
                  <SortHeader label={trFk ? 'Satış Miktarı' : 'Sale Qty'} sortKey="satisMiktar" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right hidden md:table-cell" />
                  <SortHeader label={trFk ? 'Kalan Stok' : 'Remaining Stock'} sortKey="kalanStok" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right" />
                  <SortHeader label={trFk ? 'Marj' : 'Margin'} sortKey="marjTL" currentSort={{ key: fkSortKey, direction: fkSortDir }} onSort={k => toggleFkSort(k as FkSortKey)} className="text-right" />
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <tr key={r.sku} className="hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => fkAcDetay(r.sku)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800">{r.ad}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{r.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-blue-600">{fmtF(r.alisOrtFiyat)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{r.alisMiktar.toLocaleString('tr-TR')}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{fmtF(r.satisOrtFiyat)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{r.satisMiktar.toLocaleString('tr-TR')}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.kalanStok == null ? 'text-gray-300' : r.kalanStok <= 0 ? 'text-red-500' : 'text-gray-700'}`}>
                      {r.kalanStok == null ? '—' : r.kalanStok.toLocaleString('tr-TR')}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${r.marjTL == null ? 'text-gray-300' : r.marjTL >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {r.marjTL == null ? '—' : `${fmtF(r.marjTL)}${r.marjYuzde != null ? ` (%${r.marjYuzde.toFixed(0)})` : ''}`}
                    </td>
                    <td className="px-4 py-3 text-right"><ChevronRight size={14} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[10px] text-gray-400 text-center">{trFk ? 'Fiyatlar KDV hariç, satır bazlı gerçek Mikro stok hareketlerinden (STOK_HAREKETLERI) ağırlıklı ortalamadır.' : 'Prices are VAT-excluded, weighted averages from real Mikro stock movement lines.'}</p>

      {/* Evrak → fatura modalı */}
      {fkFatura && (
        <MikroFaturaDetay fatura={fkFatura} currentLanguage={currentLanguage} onClose={() => setFkFatura(null)} />
      )}

      {/* SKU detay modalı */}
      {fkDetaySku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFkDetaySku(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-bold text-gray-800">{trFk ? 'İşlem Detayı' : 'Transaction Detail'}</h3>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{fkDetaySku}</p>
              </div>
              <button onClick={() => setFkDetaySku(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>
            <div className="overflow-auto flex-1 p-4">
              {fkDetayLoading && <p className="text-center text-gray-400 text-sm py-8">{trFk ? 'Yükleniyor…' : 'Loading…'}</p>}
              {!fkDetayLoading && fkDetayHata && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700">{fkDetayHata}</div>
              )}
              {!fkDetayLoading && !fkDetayHata && fkDetaySatirlari.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-8">{trFk ? 'Hareket bulunamadı.' : 'No movements found.'}</p>
              )}
              {!fkDetayLoading && fkDetaySatirlari.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Tarih' : 'Date'}</th>
                      <th className="text-left py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Yön' : 'Direction'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Miktar' : 'Qty'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Birim Fiyat (KDV hariç)' : 'Unit Price (excl. VAT)'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Tutar' : 'Amount'}</th>
                      <th className="text-left py-2 px-2 text-[10px] font-bold text-gray-400 uppercase hidden sm:table-cell">{trFk ? 'Evrak' : 'Doc'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {fkDetaySatirlari.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="py-2 px-2 text-gray-600">{s.tarih ? String(s.tarih).slice(0, 10) : '—'}</td>
                        <td className="py-2 px-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${s.yon === 'alis' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {s.yon === 'alis' ? (trFk ? 'Alış' : 'Purchase') : (trFk ? 'Satış' : 'Sale')}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-700">{s.miktar.toLocaleString('tr-TR')}</td>
                        <td className="py-2 px-2 text-right font-medium text-gray-800">{fmtF(s.birimFiyat)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{fmtF(s.tutar)}</td>
                        <td className="py-2 px-2 hidden sm:table-cell">
                          {(() => {
                            if (!s.evrakNo) return <span className="text-gray-400">—</span>;
                            // Eşleşme MUHAFAZAKÂR (bkz. utils/faturaEsle.ts):
                            // sıra + cari + gün ÜÇÜ de tutmalı ve tek fatura
                            // çıkmalı; yoksa düğme yok, düz metin. Yanlış
                            // faturayı açmak hiç açmamaktan kötü.
                            const f = faturaEsle(mikroFaturalar, {
                              evrakSira: s.evrakNo, cariKod: s.cariKod,
                              tarih: s.tarih ? String(s.tarih).slice(0, 10) : null,
                            });
                            if (!f) return <span className="text-gray-400" title={trFk ? 'Eşleşen fatura kaydı yok (Faturaları Çek çalıştırılmamış olabilir)' : 'No matching invoice'}>{s.evrakNo}</span>;
                            return (
                              <button
                                onClick={() => setFkFatura({ ...f, musteri: f.cariKod })}
                                className="text-brand hover:underline font-medium"
                              >
                                {s.evrakNo}
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
