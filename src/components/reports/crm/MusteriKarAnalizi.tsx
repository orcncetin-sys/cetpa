/**
 * MusteriKarAnalizi — CrmRapor.tsx'ten mekanik bölme ile çıkarıldı (2026-08-31).
 * Gövde BİREBİR taşındı (davranış değişmedi; yalnız girinti düzeltildi).
 * Render koşulu `reportsTab === 'crm' && orders.length >= 3 && inventory.length > 0` ebeveyn CrmRapor.tsx'te durur.
 * Props: ReportsCtx'in tamamı DEĞİL — yalnız bu kartın gerçekten kullandığı alanlar.
 */
import { itemCostTRY, type ReportsCtx } from '../useReportsData';
import { stokFiyatOzeti } from '../../../lib/stokFiyat';
import { bilinenSayi } from '../../../utils/para';
import { marjCirosu, stokKartiCozucu, type MarjSiparisi } from '../../../utils/pano/raporMarj';

type Props = Pick<ReportsCtx, 'orders' | 'inventory' | 'inventoryMovements' | 'exchangeRates' | 'currentLanguage' | 'fmtAna'>;

export default function MusteriKarAnalizi({ orders, inventory, inventoryMovements, exchangeRates, currentLanguage, fmtAna }: Props) {
  // Ortalama alış fiyatı — gerçek Mikro stok hareketlerinden (STOK_HAREKETLERI,
  // sth_tip=0 alış) SKU bazında ağırlıklı ortalama. inventory.costPrice (itemCostTRY)
  // birçok kalemde 0/boş çıkıyordu (2026-08-13 kullanıcı bildirimi — bu yüzden
  // her müşteri "%100 kâr" gösteriyordu, maliyet hiç düşülmüyordu). HESAP TEK KAYNAKTA: lib/stokFiyat.stokFiyatOzeti
  // — /api/reports/stok-fiyat-karsilastirma ile AYNI fonksiyon (NET: satır + fatura altı iskontoları düşülmüş; tutarı
  // bilinmeyen satır ortalamaya girmez). Eskiden burada brüt `sth_tutar || 0` kopyası vardı: iskontolu alımda SMM
  // şişiyor, müşteri marjı olduğundan düşük çıkıyordu (2026-09-18).
  const avgAlisFiyatMap = new Map<string, number>();
  for (const r of stokFiyatOzeti(inventoryMovements as unknown as readonly Record<string, unknown>[]).satirlar) {
    if (r.alisOrtFiyat !== null) avgAlisFiyatMap.set(r.sku, r.alisOrtFiyat);
  }
  // Maliyeti ya da miktarı BİLİNMEYEN kalem maliyete EKLENMEZ, sayılır (inceleme 2026-09-25): eski `li.price * 0.6`
  // yedeği uydurma maliyetti ve sürüm-2 Mikro kaleminde (`price` yok) NaN üretip müşterinin tüm kârını bozuyordu;
  // `unitCost * null` ise sessiz 0 maliyetti. Maliyetsiz kalemi olan müşteride kâr KISMİDİR — kartta yazılır.
  // Ciro TABANI raporMarj ile AYNI (`marjCirosu`, delta hakem 2026-09-25): sürüm-2 MF siparişinde KDV hariç Σ net —
  // eskiden `o.totalPrice || 0` (Mikro'da KDV + masraf DÂHİL) KDV hariç maliyetle kıyaslanıyordu. Kalemsiz ya da cirosu
  // bilinmeyen sipariş kâr hesabı DIŞINDA kalır ve sayılır (ciro eklenip maliyet 0 kalması uydurma kârdı).
  // Kart eşleşmesi ortak çözücüden (kimlik / stok kodu / ad; boş anahtar eşleşmez).
  const kartBul = stokKartiCozucu(inventory);
  const custProfit: Record<string, { rev: number; cogs: number; maliyetsiz: number; hesapDisi: number }> = {};
  for (const o of orders) {
    if (o.status === 'Cancelled') continue;
    const name = o.customerName || '—';
    if (!custProfit[name]) custProfit[name] = { rev: 0, cogs: 0, maliyetsiz: 0, hesapDisi: 0 };
    const ciro = (o.lineItems ?? []).length > 0 ? marjCirosu(o as unknown as MarjSiparisi) : NaN;
    if (!Number.isFinite(ciro)) { custProfit[name].hesapDisi++; continue; }
    custProfit[name].rev += ciro;
    for (const li of (o.lineItems ?? [])) {
      const inv = kartBul(li);
      const avgAlis = inv ? avgAlisFiyatMap.get(inv.sku) : undefined;
      const storedCost = inv ? itemCostTRY(inv, exchangeRates) : 0;
      const unitCost = avgAlis && avgAlis > 0 ? avgAlis : (storedCost > 0 ? storedCost : NaN);
      const miktar = bilinenSayi(li.quantity) ? Number(li.quantity) : NaN;
      if (!Number.isFinite(unitCost) || !Number.isFinite(miktar)) { custProfit[name].maliyetsiz++; continue; }
      custProfit[name].cogs += unitCost * miktar;
    }
  }
  // Hesap dışı kalan müşteri/sipariş SESSİZCE düşmez (delta hakem 2026-09-25): kart genelinde sayılır ve yazılır;
  // hesaplanabilen müşteri 2'den az olsa bile hesap dışı sipariş varsa kart bu notla çizilir.
  const tumMusteriler = Object.entries(custProfit);
  const hesapDisiSiparis = tumMusteriler.reduce((n, [, d]) => n + d.hesapDisi, 0);
  const listeDisiMusteri = tumMusteriler.filter(([, d]) => !(d.rev > 0)).length;
  const profitList = tumMusteriler
    .filter(([, d]) => d.rev > 0)
    .map(([name, d]) => ({ name, rev: d.rev, cogs: d.cogs, maliyetsiz: d.maliyetsiz, hesapDisi: d.hesapDisi, profit: d.rev - d.cogs, margin: Math.round(((d.rev - d.cogs) / d.rev) * 100) }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);
  if (profitList.length < 2 && hesapDisiSiparis === 0) return null;
  const maxProfit = Math.max(...profitList.map(p => p.profit), 1);
  return (
    <div className="apple-card p-6">
      <h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? '💹 Müşteri Bazlı Kâr Analizi' : '💹 Profit by Customer'}</h3>
      {(hesapDisiSiparis > 0 || listeDisiMusteri > 0) && (
        <p role="status" className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">
          {currentLanguage === 'tr'
            ? `${listeDisiMusteri} müşteri / ${hesapDisiSiparis} sipariş kâr hesabına girmedi (kalemsiz, Mikro kalemi yenilenmemiş ya da ciro bilinmiyor) — Entegrasyon → "MF Sipariş Kalemlerini Yenile".`
            : `${listeDisiMusteri} customers / ${hesapDisiSiparis} orders excluded from profit (no lines, Mikro lines not refreshed or unknown revenue) — Integration → "Refresh MF Order Lines".`}
        </p>
      )}
      <div className="space-y-2.5">
        {profitList.map(p => (
          <div key={p.name}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium text-gray-700 truncate">
                {p.name}
                {p.hesapDisi > 0 && (
                  <span className="ml-1 text-[10px] font-normal text-gray-500" title={currentLanguage === 'tr' ? 'Kalemi olmayan ya da cirosu bilinmeyen siparişler kâr hesabına girmedi' : 'Orders without lines or with unknown revenue were excluded'}>
                    {currentLanguage === 'tr' ? `(${p.hesapDisi} sipariş hesap dışı)` : `(${p.hesapDisi} orders excluded)`}
                  </span>
                )}
                {p.maliyetsiz > 0 && (
                  <span className="ml-1 text-[10px] font-normal text-amber-700" title={currentLanguage === 'tr' ? 'Bu kalemlerin maliyeti bilinmiyor — kâr ve marj KISMİ (maliyetleri eklenmedi)' : 'Cost unknown for these lines — profit and margin are PARTIAL'}>
                    {currentLanguage === 'tr' ? `(${p.maliyetsiz} kalem maliyetsiz — kâr kısmi)` : `(${p.maliyetsiz} lines without cost — partial)`}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.margin >= 30 ? 'bg-emerald-100 text-emerald-700' : p.margin >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>%{p.margin}</span>
                <span className="text-xs font-bold text-gray-700">{fmtAna(p.profit,'K',0)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${p.margin >= 30 ? 'bg-emerald-400' : p.margin >= 15 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(4, Math.round((p.profit / maxProfit) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
