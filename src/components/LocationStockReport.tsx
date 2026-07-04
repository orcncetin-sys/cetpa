/**
 * LocationStockReport.tsx — her depo/araçta hangi üründen ne kadar var.
 * locationStocks'u lokasyona göre gruplar; miktarı 0 olan satırları gizler.
 */
import { Warehouse as WarehouseIcon, Truck, PackageSearch } from 'lucide-react';
import type { LocationStock } from '../types';

interface Props {
  currentLanguage: 'tr' | 'en';
  locationStocks: LocationStock[];
}

export default function LocationStockReport({ currentLanguage, locationStocks }: Props) {
  const tr = currentLanguage === 'tr';

  // locationId'ye göre grupla (yalnız miktarı > 0 olanlar)
  const groups = new Map<string, { type: 'warehouse' | 'vehicle'; name: string; items: LocationStock[] }>();
  for (const s of locationStocks) {
    if ((s.quantity ?? 0) <= 0) continue;
    const key = `${s.locationType}:${s.locationId}`;
    if (!groups.has(key)) groups.set(key, { type: s.locationType, name: s.locationName || s.locationId, items: [] });
    groups.get(key)!.items.push(s);
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="apple-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <PackageSearch className="w-4 h-4 text-brand" />
        <h4 className="font-bold text-gray-900 text-sm">{tr ? 'Lokasyon Stok Durumu' : 'Stock by Location'}</h4>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-gray-400">{tr ? 'Henüz lokasyon-bazlı stok kaydı yok. QR transfer ile stok bir lokasyona atandığında burada görünür.' : 'No location-based stock yet. It appears here once stock is moved to a location via QR transfer.'}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map(g => {
            const total = g.items.reduce((s, i) => s + (i.quantity || 0), 0);
            return (
              <div key={g.name} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50">
                  <div className="flex items-center gap-2 min-w-0">
                    {g.type === 'warehouse' ? <WarehouseIcon className="w-3.5 h-3.5 text-brand shrink-0" /> : <Truck className="w-3.5 h-3.5 text-brand shrink-0" />}
                    <span className="text-sm font-bold text-gray-800 truncate">{g.name}</span>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 shrink-0">{tr ? 'toplam' : 'total'}: {total}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {g.items.sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).map(i => (
                    <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{i.productName || i.sku || i.productId}</p>
                        {i.sku && <p className="text-[10px] text-gray-400">{i.sku}</p>}
                      </div>
                      <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">{i.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
