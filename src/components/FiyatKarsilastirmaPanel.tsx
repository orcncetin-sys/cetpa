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
import { hareketFaturasi } from '../utils/faturaEsle';
import { BIRIM_SAPMA_KATI, type FaturaAnahtari } from '../lib/stokFiyat';
import { yuzdeYaz } from '../utils/rapor/bicim';
import { eslesir } from '../utils/arama';
import { authFetch } from '../services/authFetch';
import type { MikroFatura } from '../hooks/useMikroFaturalar';
import { oc } from '../i18n/ortak';
import type { NetKaynagi } from '../lib/stokFiyat';

interface FiyatKarsilastirmaRow {
  sku: string; ad: string;
  /** Ortalamalar NET tutardan (satır + fatura altı iskontoları düşülmüş) — hesap src/lib/stokFiyat.ts (2026-09-18). */
  alisOrtFiyat: number | null; alisMiktar: number; alisTutar: number; alisBrutTutar: number; alisIskonto: number; alisAdet: number;
  satisOrtFiyat: number | null; satisMiktar: number; satisTutar: number; satisBrutTutar: number; satisIskonto: number; satisAdet: number;
  marjTL: number | null; marjYuzde: number | null;
  /** Tutarı/miktarı bilinmediği ya da iskontosu tutarsız olduğu için ortalamaya GİRMEYEN satır sayısı (yön bazında). */
  bilinmeyenSatir: number; alisBilinmeyen: number; satisBilinmeyen: number;
  /** Miktarı 0 ama tutarı dolu satır (fiyat farkı / dönem sonu iskonto faturası olabilir) — birim fiyata bölünemez. */
  miktarsizSatir: number;
  /** inventory.stockLevel'dan — hareket netine değil gerçek stoğa dayanır; SKU inventory'de yoksa null. */
  kalanStok: number | null;
  /** Birim fiyatı ürünün fiyat düzeyinden ≥ BIRIM_SAPMA_KATI kat sapan satır sayısı (koli/adet karışıklığı olabilir).
   *  null = değerlendirilemedi (< 3 fiyatı bilinen satır); eski yanıtta alan yok (undefined). */
  sapmaSayisi?: number | null;
}

/** Sunucu: lib/stokFiyat.BirimSapmasi + ürün adı. */
interface BirimSapmaSatiri {
  sku: string; ad: string; tarih: string | null; yon: 'alis' | 'satis'; miktar: number;
  birimFiyat: number; medyan: number; kat: number; belirsiz: boolean; cariKod: string | null; evrakNo: string | null; fatura: FaturaAnahtari | null;
}
interface FiyatDetaySatiri {
  tarih: string | null; yon: 'alis' | 'satis'; miktar: number | null;
  /** null = hesaplanamadı (tutar/miktar bilinmiyor ya da iskonto brütü aşıyor) → '—', ₺0 değil. `tutar` NET'tir. */
  brutTutar: number | null; iskonto: number | null; tutar: number | null;
  birimFiyat: number | null; cariKod: string | null; evrakNo: string | null;
  /** Netin hangi yolla belirlendiği (lib/stokFiyat NetKaynagi); hesaplanamayan satırda null. */
  kaynak: NetKaynagi | null;
  /** Hareketin faturası (lib/stokFiyat.faturaAnahtari); irsaliye/sayımda null. Eski sunucu yanıtında alan yok → undefined. */
  fatura?: FaturaAnahtari | null;
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
  /** Aynada GERÇEKTEN bulunan sth_iskonto<N> kolonları; null = henüz yüklenmedi, [] = iskonto kolonu yok (uyarı basılır). */
  const [fkIskontoKolonlari, setFkIskontoKolonlari] = useState<string[] | null>(null);
  /** Ortalamaya giren satırların net kaynağı dökümü — hesabın hangi yolla yapıldığı ekranda görünsün. */
  const [fkNetKaynaklari, setFkNetKaynaklari] = useState<Partial<Record<NetKaynagi, number>>>({});
  const [fkSearch, setFkSearch] = useState('');
  /** Birim sapması listesi (koli/adet karışıklığı — 2026-09-25 kullanıcı isteği) ve açık/kapalı. */
  const [fkSapmalar, setFkSapmalar] = useState<BirimSapmaSatiri[]>([]);
  const [fkSapmaAcik, setFkSapmaAcik] = useState(false);
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
        if (json.success) { setFkRows(json.rows); setFkSapmalar(Array.isArray(json.sapmalar) ? json.sapmalar : []); setFkIskontoKolonlari(Array.isArray(json.iskontoKolonlari) ? json.iskontoKolonlari : null); setFkNetKaynaklari(json.netKaynaklari && typeof json.netKaynaklari === 'object' ? json.netKaynaklari : {}); }
        else setFkError(json.error || (oc(currentLanguage).veri_alinamadi));
      })
      .catch(() => { if (!iptal) setFkError(oc(currentLanguage).veri_alinamadi); })
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
  // Arama TEK kural (iki liste de): projenin ortak katlayıcısı (utils/arama) — İ/i/I/ı iki yönde de eşleşir.
  // `toLowerCase()` 'MASTİK' ↔ 'mastik'i, `toLocaleLowerCase('tr-TR')` 'SIKA' ↔ 'sika'yı kaçırıyordu (inceleme 2026-09-25).
  const aramaEsler = (sku: string, ad: string) => eslesir(fkSearch, sku, ad);
  const filtered = fkRows
    .filter(r => aramaEsler(r.sku, r.ad))
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

  // Şüpheli satır listesi arama kutusuna uyar (ekrandaki "dayson" araması listeyi de daraltır).
  const sapmaFiltreli = fkSapmalar.filter(s => aramaEsler(s.sku, s.ad));

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
        {!fkLoading && sapmaFiltreli.length > 0 && (
          <button onClick={() => setFkSapmaAcik(a => !a)}
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
            title={trFk ? `Birim fiyatı ürünün kendi medyanından ${BIRIM_SAPMA_KATI} kat ve üzeri sapan satırlar — koli/adet karışıklığı olabilir` : `Lines whose unit price deviates ${BIRIM_SAPMA_KATI}× or more from the product median — possible box/unit mix-up`}>
            ⚠ {trFk ? `Birim şüpheli satır: ${sapmaFiltreli.length}` : `Suspicious unit lines: ${sapmaFiltreli.length}`}
          </button>
        )}
      </div>
      {fkSapmaAcik && sapmaFiltreli.length > 0 && (
        <div className="apple-card overflow-hidden border border-amber-200">
          <p className="px-4 pt-3 text-[11px] text-amber-700">
            {trFk
              ? `Satırın net birim fiyatı, ürünün diğer satırlarının fiyat düzeyinden en az ${BIRIM_SAPMA_KATI} kat yüksek ya da düşük — koli/adet karışıklığı olabilir (fatura koli kesilip miktar adet sanılmış ya da tersi). "Belirsiz" satırlarda ürünün fiyatları iki dengeli gruba ayrılıyor, hangisinin yanlış olduğu fiyattan anlaşılamaz. Ortalama alış/satış ve marj bu satırları İÇERİR; düzeltme Mikro'da yapılır, sonra "Stok Hareketleri" yeniden çekilir.`
              : `Line net unit price is ${BIRIM_SAPMA_KATI}× or more above/below the product's price level — possible box/unit mix-up. "Unclear" rows: the product's prices split into two balanced groups; which one is wrong can't be told from price. Averages and margin INCLUDE these lines; fix in Mikro, then re-pull stock movements.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-amber-50/60 border-b border-amber-100 text-[10px] font-bold text-gray-500 uppercase">
                  <th className="text-left py-2 px-3">{trFk ? 'Ürün' : 'Product'}</th>
                  <th className="text-left py-2 px-2">{trFk ? 'Tarih' : 'Date'}</th>
                  <th className="text-left py-2 px-2">{trFk ? 'Yön' : 'Dir.'}</th>
                  <th className="text-right py-2 px-2">{trFk ? 'Miktar' : 'Qty'}</th>
                  <th className="text-right py-2 px-2">{trFk ? 'Net birim fiyat' : 'Net unit price'}</th>
                  <th className="text-right py-2 px-2">{trFk ? 'Ana grup medyanı' : 'Main group median'}</th>
                  <th className="text-right py-2 px-2">{trFk ? 'Kat' : 'Ratio'}</th>
                  <th className="text-left py-2 px-3">{trFk ? 'Evrak' : 'Doc'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sapmaFiltreli.map((s, i) => {
                  const f = s.evrakNo ? hareketFaturasi(mikroFaturalar, { evrakSira: s.fatura?.sira ?? s.evrakNo, cariKod: s.cariKod, tarih: s.tarih ? String(s.tarih).slice(0, 10) : null }, s.fatura) : null;
                  return (
                    <tr key={`${s.sku}|${s.evrakNo ?? ''}|${i}`} className="hover:bg-amber-50/40">
                      <td className="py-2 px-3"><p className="font-semibold text-gray-800">{s.ad}</p><p className="text-[10px] text-gray-400 font-mono">{s.sku}</p></td>
                      <td className="py-2 px-2 text-gray-600">{s.tarih ? String(s.tarih).slice(0, 10) : '—'}</td>
                      <td className="py-2 px-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.yon === 'alis' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>{s.yon === 'alis' ? (trFk ? 'Alış' : 'Purchase') : (trFk ? 'Satış' : 'Sale')}</span></td>
                      <td className="py-2 px-2 text-right">{s.miktar.toLocaleString(trFk ? 'tr-TR' : 'en-US')}</td>
                      <td className="py-2 px-2 text-right font-semibold text-gray-800">{fmtF(s.birimFiyat)}</td>
                      <td className="py-2 px-2 text-right text-gray-500">{fmtF(s.medyan)}</td>
                      <td className="py-2 px-2 text-right font-bold text-amber-700">
                        {s.kat.toLocaleString(trFk ? 'tr-TR' : 'en-US', s.kat >= 1 ? { maximumFractionDigits: 1 } : { maximumSignificantDigits: 2 })}×
                        {s.belirsiz && <span className="block text-[9px] font-semibold text-gray-500">{trFk ? 'belirsiz' : 'unclear'}</span>}
                      </td>
                      <td className="py-2 px-3">
                        {!s.evrakNo ? <span className="text-gray-400">—</span>
                          : f ? <button onClick={() => setFkFatura(f)} className="text-brand hover:underline font-medium">{s.evrakNo}</button>
                          : <span className="text-gray-400" title={trFk ? 'Fatura değil (irsaliye/sayım)' : 'Not an invoice'}>{s.evrakNo}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
                      <p className="font-semibold text-gray-800">{r.ad}
                        {typeof r.sapmaSayisi === 'number' && r.sapmaSayisi > 0 && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                            title={trFk ? `${r.sapmaSayisi} satırın birim fiyatı ürünün ana fiyat grubundan ${BIRIM_SAPMA_KATI}+ kat farklı (koli/adet karışıklığı olabilir; dengeli gruplarda hangisinin yanlış olduğu belirsiz) — ortalama ve marj bu satırları içeriyor` : `${r.sapmaSayisi} lines differ ${BIRIM_SAPMA_KATI}×+ from the product's main price group (box/unit mix-up?) — averages include them`}>
                            ⚠ {r.sapmaSayisi}
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400 font-mono">{r.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-blue-600"
                      title={r.alisIskonto > 0 ? `${trFk ? 'Brüt' : 'Gross'} ${fmtF(r.alisBrutTutar)} − ${trFk ? 'iskonto' : 'discount'} ${fmtF(r.alisIskonto)} = ${trFk ? 'net' : 'net'} ${fmtF(r.alisTutar)}` : undefined}>
                      {fmtF(r.alisOrtFiyat)}
                      {(r.alisBilinmeyen > 0 || r.miktarsizSatir > 0) && <span className="text-amber-600" title={[r.alisBilinmeyen > 0 ? `${r.alisBilinmeyen} ${trFk ? 'alış satırının tutarı/miktarı bilinmiyor ya da iskontosu tutarsız — ortalamaya girmedi' : 'purchase lines unknown/inconsistent — excluded from average'}` : '', r.miktarsizSatir > 0 ? `${r.miktarsizSatir} ${trFk ? 'satır miktarsız (fiyat farkı / dönem sonu iskonto faturası olabilir) — birim fiyata yansımadı' : 'lines without quantity (price-difference invoice?) — not reflected in unit price'}` : ''].filter(Boolean).join(' · ')}> *</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{r.alisMiktar.toLocaleString('tr-TR')}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600"
                      title={r.satisIskonto > 0 ? `${trFk ? 'Brüt' : 'Gross'} ${fmtF(r.satisBrutTutar)} − ${trFk ? 'iskonto' : 'discount'} ${fmtF(r.satisIskonto)} = ${trFk ? 'net' : 'net'} ${fmtF(r.satisTutar)}` : undefined}>
                      {fmtF(r.satisOrtFiyat)}
                      {r.satisBilinmeyen > 0 && <span className="text-amber-600" title={`${r.satisBilinmeyen} ${trFk ? 'satış satırının tutarı/miktarı bilinmiyor ya da iskontosu tutarsız — ortalamaya girmedi' : 'sale lines unknown/inconsistent — excluded from average'}`}> *</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{r.satisMiktar.toLocaleString('tr-TR')}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.kalanStok == null ? 'text-gray-300' : r.kalanStok <= 0 ? 'text-red-500' : 'text-gray-700'}`}>
                      {r.kalanStok == null ? '—' : r.kalanStok.toLocaleString('tr-TR')}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${r.marjTL == null ? 'text-gray-300' : r.marjTL >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {r.marjTL == null ? '—' : `${fmtF(r.marjTL)}${r.marjYuzde != null ? ` (${yuzdeYaz(r.marjYuzde, 0, trFk ? 'tr' : 'en')})` : ''}`}
                    </td>
                    <td className="px-4 py-3 text-right"><ChevronRight size={14} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {fkIskontoKolonlari !== null && fkIskontoKolonlari.length === 0 && fkRows.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">{trFk ? 'Stok hareketi verisinde iskonto kolonu (sth_iskonto…) bulunamadı — fiyatlar BRÜT tutardan hesaplandı. "Stok Hareketleri"ni yeniden çekin.' : 'No discount columns (sth_iskonto…) found in the stock movement data — prices are computed from GROSS amounts. Re-pull "Stock Movements".'}</p>
      )}
      {Object.keys(fkNetKaynaklari).length > 0 && (
        <p className="text-[10px] text-gray-400 text-center">
          {trFk ? 'Net tutar nasıl belirlendi: ' : 'How net was determined: '}
          {([
            ['iskontosuz', trFk ? 'iskontosuz' : 'no discount'],
            ['satirIskontosu', trFk ? 'satır iskontosu düşüldü' : 'line discount deducted'],
            ['faturaAltiBasliktan', trFk ? 'fatura altı iskonto fatura toplamından dağıtıldı' : 'invoice-level discount allocated from invoice total'],
            ['faturaAltiKdvden', trFk ? "fatura altı iskonto KDV'den türetildi (fatura başlığı yok)" : 'invoice-level discount derived from VAT (no invoice header)'],
            ['tutarZatenNet', trFk ? 'tutar zaten net' : 'amount already net'],
            ['dogrulanamadi', trFk ? "KDV'yle doğrulanamadı" : 'not verifiable via VAT'],
          ] as [NetKaynagi, string][]).filter(([k]) => (fkNetKaynaklari[k] ?? 0) > 0).map(([k, ad]) => `${fkNetKaynaklari[k]} ${trFk ? 'satır' : 'lines'} ${ad}`).join(' · ')}
        </p>
      )}
      <p className="text-[10px] text-gray-400 text-center">{trFk ? 'Fiyatlar KDV hariç ve NET: satır iskontoları ile satırlara dağıtılmış fatura altı iskontoları düşülmüştür. Satır bazlı gerçek Mikro stok hareketlerinden (STOK_HAREKETLERI) ağırlıklı ortalamadır.' : 'Prices are VAT-excluded and NET: line discounts and invoice-level discounts distributed to lines are deducted. Weighted averages from real Mikro stock movement lines.'}</p>

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
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Net Birim Fiyat (KDV hariç)' : 'Net Unit Price (excl. VAT)'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase hidden sm:table-cell">{trFk ? 'Brüt Tutar' : 'Gross'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'İskonto' : 'Discount'}</th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold text-gray-400 uppercase">{trFk ? 'Net Tutar' : 'Net Amount'}</th>
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
                        <td className="py-2 px-2 text-right text-gray-700">{s.miktar == null ? '—' : s.miktar.toLocaleString('tr-TR')}</td>
                        <td className="py-2 px-2 text-right font-medium text-gray-800" title={s.birimFiyat == null ? (trFk ? 'Tutar/miktar bilinmiyor ya da iskonto tutarsız — ortalamaya girmedi' : 'Unknown amount/quantity or inconsistent discount — excluded from average') : undefined}>{fmtF(s.birimFiyat)}</td>
                        <td className="py-2 px-2 text-right text-gray-400 hidden sm:table-cell">{fmtF(s.brutTutar)}</td>
                        <td className={`py-2 px-2 text-right ${s.iskonto ? 'text-amber-700 font-medium' : 'text-gray-300'}`}
                          title={s.kaynak === 'faturaAltiBasliktan' ? (trFk ? 'Fatura altı iskonto — fatura toplamı (başlık) ile satırlar arasındaki farktan, satırlara orantılı dağıtıldı' : 'Invoice-level discount — allocated pro rata from the gap between the invoice total and its lines')
                            : s.kaynak === 'faturaAltiKdvden' ? (trFk ? "Fatura altı iskonto — satırda yazılı değil, fatura başlığı bulunamadı; satırın KDV'sinden türetildi. (\"Faturaları Çek\" çalıştırılırsa başlıkla kesinleşir.)" : 'Invoice-level discount — not on the line and no invoice header found; derived from the line VAT. (Pull invoices to confirm via the header.)')
                            : s.kaynak === 'tutarZatenNet' ? (trFk ? 'Mikro tutarı zaten iskontolu yazmış — tekrar düşülmedi' : 'Mikro amount already net — not deducted again')
                            : s.kaynak === 'dogrulanamadi' ? (trFk ? "KDV'yle doğrulanamadı (KDV'siz satır) — satırdaki iskonto alanları düşüldü" : 'Not verifiable via VAT — line discount fields deducted') : undefined}>
                          {s.iskonto == null ? '—' : s.iskonto > 0 ? `−${fmtF(s.iskonto)}` : fmtF(0)}{(s.kaynak === 'faturaAltiKdvden' || s.kaynak === 'faturaAltiBasliktan') && <span className="text-[9px] text-amber-600"> ᶠ</span>}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-600">{fmtF(s.tutar)}</td>
                        <td className="py-2 px-2 hidden sm:table-cell">
                          {(() => {
                            if (!s.evrakNo) return <span className="text-gray-400">—</span>;
                            // Başlık TEKİL eşleşirse başlıklı; yoksa hareketin FATURA ANAHTARINDAN (seri+sıra+yön)
                            // başlıksız açılır — kalemler zaten Mikro'dan o anahtarla okunur (utils/faturaEsle.hareketFaturasi).
                            // Eskiden başlık bulunamayınca numara düz metin kalıyordu (2026-09-25 kullanıcı bildirimi).
                            // Sıra no'su yalnız fatura anahtarından: seri-sıra biçimli `evrakNo` ile karşılaştırılmaz.
                            const f = hareketFaturasi(mikroFaturalar, {
                              evrakSira: s.fatura?.sira ?? s.evrakNo, cariKod: s.cariKod,
                              tarih: s.tarih ? String(s.tarih).slice(0, 10) : null,
                            }, s.fatura ?? null);
                            if (!f) return <span className="text-gray-400" title={trFk ? 'Fatura değil (irsaliye/sayım) ya da eşleşen fatura kaydı yok' : 'Not an invoice, or no matching invoice'}>{s.evrakNo}</span>;
                            return (
                              <button
                                onClick={() => setFkFatura(f)}
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
