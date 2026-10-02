// CSS burada import edilir, main.tsx'te DEGIL.
// main.tsx giris dosyasi oldugu icin oradaki statik `leaflet/dist/leaflet.css`
// importu tum leaflet paketini (148 kB) EAGER grafige sokuyordu — harita
// bileseni React.lazy ile ertelenmis olmasina ragmen. Artik CSS de bilesenle
// birlikte, yalniz harita acildiginda iniyor.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import type { Order, RouteStop } from '../types';

// Fix Leaflet default icon paths
// @ts-expect-error Leaflet types don't include _getIconUrl
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export const OSM_KARO_ADRESI = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** Boş/`no-referrer` OLAMAZ — OSM karoları engeller (bkz. TileLayer üstündeki not). */
export const OSM_REFERRER_POLITIKASI: ReferrerPolicy = 'strict-origin-when-cross-origin';

interface LogisticsMapProps {
  orders: Order[];
  routeStops: RouteStop[];
  depot: { lat: number; lng: number };
  currentT: Record<string, string>;
}

const LogisticsMap = ({ orders, routeStops, depot, currentT }: LogisticsMapProps) => {
  const routePositions: [number, number][] = routeStops.length > 0
    ? [[depot.lat, depot.lng], ...routeStops.map(s => [s.location.lat, s.location.lng] as [number, number])]
    : [];

  return (
    <div className="h-[400px] md:h-[600px] w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm relative z-0">
      <MapContainer
        center={[depot.lat, depot.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        {/* OSM karo sunucusu Referer'sız tarayıcı isteğini ENGELLER (yanıt başlığı `x-blocked: No referer sent`, karo yerine
            "403 Access blocked" görseli — canlıda ölçüldü 2026-10-02). Sitemiz helmet varsayılanıyla
            `Referrer-Policy: no-referrer` gönderdiği için harita tümüyle engelli karolarla doluyordu. Öğe düzeyindeki
            referrerPolicy belge politikasını EZER; yalnız köken (https://app.cetpa.com.tr/) gider, yol/sorgu gitmez.
            Site geneli politika değiştirilmedi (diğer dış isteklerde Referer sızmasın). Adres: OSM'nin önerdiği tek ana
            makine (alt alan adları {s} artık önerilmiyor). */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={OSM_KARO_ADRESI}
          referrerPolicy={OSM_REFERRER_POLITIKASI}
        />
        {routePositions.length > 1 && (
          <Polyline positions={routePositions} color="#ff4000" weight={3} dashArray="8 4" />
        )}
        {orders.filter(o => o.location).map(order => {
          const routeStop = routeStops.find(s => s.orderId === order.id);
          return (
            <Marker key={order.id} position={[order.location!.lat, order.location!.lng]}>
              <Popup>
                <div className="p-1">
                  <h4 className="font-bold text-sm text-[#1D2226]">{order.customerName}</h4>
                  <p className="text-xs text-gray-500 mt-1">{currentT.order}: {order.shopifyOrderId}</p>
                  <p className="text-xs font-medium text-brand mt-1">{currentT.status}: {currentT[order.status.toLowerCase()] || order.status}</p>
                  {routeStop && (
                    <p className="text-xs font-bold text-brand mt-1">
                      {currentT.stop} #{routeStop.sequence} — {currentT.eta}: {routeStop.estimatedMinutes} {currentT.min}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-2">{order.shippingAddress}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default LogisticsMap;
