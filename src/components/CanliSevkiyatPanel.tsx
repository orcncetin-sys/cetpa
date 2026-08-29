import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, setDoc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';
import {
  Truck, Phone, MessageSquare, MapPin, Clock, CheckCircle2, Package,
  Navigation, AlertTriangle, Radio, RadioTower,
} from 'lucide-react';
import type { Shipment, Vehicle, Warehouse, VehiclePosition } from '../types';
import { birlesikAraclar } from '../utils/filo';
import { KONUM_ARAC_ANAHTARI, KONUM_OLAYI } from '../hooks/useKonumYayini';
import { useToast } from './Toast';

/**
 * CanliSevkiyatPanel — sevkiyatın canlı durumu (Getir/Yemeksepeti düzeni).
 *
 * ## Düzen (kullanıcının paylaştığı referansla aynı)
 *   üst   : müşteri + adres + tahmini varış
 *   orta  : harita (aracın son konumu)
 *   alt   : yatay durum çubuğu → sürücü kartı (Ara / Mesaj)
 *
 * ## Konum kaynağı
 *
 * Sürücünün telefonundaki tarayıcı GPS'i (kullanıcı kararı, 2026-08-28).
 * Sürücü "Konum Paylaş"ı açar; `navigator.geolocation.watchPosition` her
 * güncellemede `vehiclePositions/<vehicleId>` dokümanını EZER. İzlek (geçmiş
 * rota) SAKLANMAZ — araç başına tek kayıt. Bu bilinçli: konum geçmişi tutmak
 * KVKK'da ayrı aydınlatma ve saklama süresi sorusu doğurur; operasyon için
 * "şu an nerede" yetiyor.
 *
 * ## ⚠ Bu yöntemin GERÇEK sınırı — ve neden gizlemiyoruz
 *
 * Tarayıcı GPS'i yalnız sayfa açık ve genelde ÖN PLANDAYKEN çalışır. iOS
 * Safari'de sekme arka plana düşünce ya da ekran kilitlenince `watchPosition`
 * pratikte DURUR. Yani konum kolayca eskir.
 *
 * Bu yüzden panel konumun YAŞINA bakar: `BAYAT_ESIK_SN`den eskiyse haritada
 * "canlı" gibi göstermez, açıkça "konum bayat (N dk önce)" der. Donmuş bir
 * kurye ikonunu canlıymış gibi göstermek, hiç göstermemekten kötüdür
 * (CLAUDE.md: "sahte kesinlik gösterme").
 *
 * Aynı sebeple TAHMİNİ VARIŞ yalnız araç konumu VE hedef koordinatı birlikte
 * varken hesaplanır; yoksa '—' basılır, uydurma dakika ÜRETİLMEZ.
 *
 * ## HTTPS şartı
 *
 * `navigator.geolocation` güvenli bağlam ister. Sertifika uyarısı veren bir
 * adreste sürücünün telefonu konum vermez — panel bunu da açıkça söyler.
 */

/** Bu süreden eski konum "canlı" sayılmaz. */
const BAYAT_ESIK_SN = 180;
/** Konum gönderme aralığı (saniye) — pil ve veri için üst sınır. */
const PING_ARALIK_SN = 25;

const ADIMLAR = [
  { key: 'Pending',   tr: 'Hazırlanıyor',  en: 'Preparing',   icon: Package },
  { key: 'In Transit', tr: 'Yola Çıktı',   en: 'On the way',  icon: Truck },
  { key: 'Delivered', tr: 'Teslim Edildi', en: 'Delivered',   icon: CheckCircle2 },
];

function zamanaCevir(v: unknown): Date | null {
  if (!v) return null;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') { try { return t.toDate(); } catch { /* düş */ } }
  if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
  const d = new Date(v as string | number);
  return isNaN(d.getTime()) ? null : d;
}

interface Props {
  currentLanguage: string;
  shipments: Shipment[];
  vehicles: Vehicle[];
  /** Plaka-adlı Mikro depoları araç listesine katmak için (utils/filo.ts). */
  warehouses: Warehouse[];
  aracKonumlari: VehiclePosition[];
  /** Konum gönderme yetkisi (Admin/Manager/Logistics) — yoksa 403 alırdı. */
  konumYazabilir: boolean;
  /** Konumu KİMİN paylaştığını kaydetmek için (denetlenebilirlik). */
  kullaniciUid?: string;
}

export default function CanliSevkiyatPanel({
  currentLanguage, shipments, vehicles: hamAraclar, warehouses, aracKonumlari, konumYazabilir, kullaniciUid,
}: Props) {
  const tr = currentLanguage === 'tr';
  const toast = useToast();
  // 3 araçtan yalnız 1'i vehicles'taydı; diğer 2'si Mikro'da plaka-adlı DEPO
  // (2026-08-28 kullanıcı bildirimi). Birleşim: utils/filo.ts.
  const vehicles = useMemo(() => birlesikAraclar(hamAraclar, warehouses), [hamAraclar, warehouses]);
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [paylasilanAracId, setPaylasilanAracId] = useState<string>(() => {
    try { return localStorage.getItem(KONUM_ARAC_ANAHTARI) ?? ''; } catch { return ''; }
  });
  const [paylasimAktif, setPaylasimAktif] = useState(() => {
    try { return !!localStorage.getItem(KONUM_ARAC_ANAHTARI); } catch { return false; }
  });
  const [paylasimHatasi, setPaylasimHatasi] = useState<string | null>(null);
  const [simdi, setSimdi] = useState(() => Date.now());

  // Bayatlık göstergesi zamana bağlı. Timer YALNIZ gösterilecek bir konum
  // varken döner — aksi hâlde ekranda hiç konum yokken de saniyede bir tüm
  // paneli yeniden çizerdi (gereksiz iş, mobilde pil).
  const konumVarMi = aracKonumlari.length > 0;
  useEffect(() => {
    if (!konumVarMi) return;
    const id = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(id);
  }, [konumVarMi]);

  const aktifSevkiyatlar = useMemo(
    () => shipments.filter(s => s.status === 'Pending' || s.status === 'In Transit'),
    [shipments],
  );
  const secili = aktifSevkiyatlar.find(s => s.id === seciliId) ?? aktifSevkiyatlar[0] ?? null;

  const arac = secili?.vehicleId ? vehicles.find(v => v.id === secili.vehicleId) : undefined;
  const konum = arac ? aracKonumlari.find(k => k.vehicleId === arac.id) : undefined;

  const konumYasiSn = useMemo(() => {
    const d = zamanaCevir(konum?.updatedAt);
    return d ? Math.max(0, Math.round((simdi - d.getTime()) / 1000)) : null;
  }, [konum?.updatedAt, simdi]);
  const konumBayat = konumYasiSn === null || konumYasiSn > BAYAT_ESIK_SN;

  // ── Konum paylaşımı (sürücü tarafı) ────────────────────────────────────
  // Yayının kendisi ARTIK BURADA DEĞİL: useKonumYayini (AppContent'te) yapar.
  // Kullanıcı düzeltmesi (2026-08-28): "sürücü bu ekranı açık tutmalı diye bir
  // şey yok — app açıkken hep çeksin." Panel yalnız aracı seçip kalıcı bayrağı
  // yazar; yayın, uygulama açık olduğu sürece hangi sekmede olursa olsun sürer.
  function paylasimiDurdur() {
    try { localStorage.removeItem(KONUM_ARAC_ANAHTARI); } catch { /* yoksay */ }
    window.dispatchEvent(new Event(KONUM_OLAYI));
    setPaylasimAktif(false);
  }

  function paylasimiBaslat() {
    setPaylasimHatasi(null);
    if (!paylasilanAracId) {
      setPaylasimHatasi(tr ? 'Önce araç seçin.' : 'Select a vehicle first.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setPaylasimHatasi(tr ? 'Bu tarayıcı konum desteklemiyor.' : 'This browser has no geolocation.');
      return;
    }
    if (!window.isSecureContext) {
      setPaylasimHatasi(tr
        ? 'Konum yalnız güvenli bağlantıda (HTTPS) çalışır. Sertifika uyarısı veren bir adreste telefon konum vermez.'
        : 'Geolocation requires a secure (HTTPS) context.');
      return;
    }
    // İzni ŞİMDİ iste ki ret burada, kullanıcının gözü önünde görünsün —
    // arka plan kancası sessiz kalır.
    navigator.geolocation.getCurrentPosition(
      () => {
        try { localStorage.setItem(KONUM_ARAC_ANAHTARI, paylasilanAracId); } catch { /* yoksay */ }
        window.dispatchEvent(new Event(KONUM_OLAYI));
        setPaylasimAktif(true);
        toast(tr ? 'Konum paylaşımı başladı — uygulama açık olduğu sürece sürer' : 'Location sharing started', 'success');
      },
      err => {
        setPaylasimHatasi(
          err.code === err.PERMISSION_DENIED
            ? (tr ? 'Konum izni verilmedi.' : 'Location permission denied.')
            : (tr ? `Konum alınamadı: ${err.message}` : `Location error: ${err.message}`));
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }


  // ── Tahmini varış — YALNIZ iki koordinat da varken ─────────────────────
  // Hedef koordinatı henüz hiçbir yerde tutulmuyor (sipariş adresleri
  // koordinata çevrilmiyor). Bu yüzden ETA şu an daima '—'. Uydurma dakika
  // ÜRETMİYORUZ; adres→koordinat çözümü eklenince burası kendiliğinden dolar.
  // ŞU AN DAİMA null. Hedef koordinatı hiçbir yerde tutulmuyor: sipariş
  // adresleri koordinata çevrilmiyor (kod tabanında geocode/nominatim → 0
  // isabet). Uydurma dakika ÜRETMİYORUZ, ekranda '—' çıkıyor.
  //
  // Adres→koordinat çözümü eklendiğinde burası şöyle olur:
  //   const km = haversineDistance({ lat: konum.lat, lng: konum.lng }, hedef);
  //   return Math.max(1, Math.round((km / ORT_HIZ_KMS) * 60));
  // Hesabı ŞİMDİ yazıp `if (!hedef) return null` ile ulaşılamaz bırakmak,
  // okuyana "ETA çalışıyor" izlenimi verirdi — o yüzden yazılmadı.
  const etaDk: number | null = null;

  const adimIdx = secili ? ADIMLAR.findIndex(a => a.key === secili.status) : -1;

  return (
    <div className="space-y-4">
      {/* ── Sürücü: konum paylaşımı ─────────────────────────────────────── */}
      <div className="apple-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          {paylasimAktif
            ? <RadioTower className="w-4 h-4 text-emerald-500" />
            : <Radio className="w-4 h-4 text-gray-400" />}
          <h3 className="font-bold text-sm">{tr ? 'Sürücü — Konum Paylaşımı' : 'Driver — Location Sharing'}</h3>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          {tr
            ? 'Konum, UYGULAMA AÇIK OLDUĞU SÜRECE otomatik gönderilir — bu sekmede durmak gerekmez. Telefon kilitlenince/tarayıcı arka plana düşünce tarayıcı konumu duraklatır; o zaman aşağıda "konum bayat" görünür.'
            : 'The driver must keep this screen open. The browser only reports location while the page is in the foreground.'}
        </p>
        {!konumYazabilir && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            {tr
              ? 'Bu roldeki kullanıcı konum gönderemez (yalnız Admin, Yönetici ve Lojistik).'
              : 'This role cannot send location (Admin, Manager and Logistics only).'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="apple-input text-sm flex-1 min-w-[160px]"
            value={paylasilanAracId}
            disabled={paylasimAktif || !konumYazabilir}
            onChange={e => setPaylasilanAracId(e.target.value)}
          >
            <option value="">{tr ? 'Araç seçin' : 'Select vehicle'}</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.plate}{v.driver ? ` — ${v.driver}` : ''}</option>
            ))}
          </select>
          {paylasimAktif ? (
            <button onClick={paylasimiDurdur} className="apple-button-secondary text-sm">
              {tr ? 'Paylaşımı Durdur' : 'Stop sharing'}
            </button>
          ) : (
            <button onClick={paylasimiBaslat} disabled={!konumYazabilir} className="apple-button-primary text-sm disabled:opacity-40">
              {tr ? 'Konum Paylaş' : 'Share location'}
            </button>
          )}
        </div>
        {paylasimHatasi && (
          <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{paylasimHatasi}</p>
        )}
      </div>

      {/* ── Aktif sevkiyat seçimi ───────────────────────────────────────── */}
      {aktifSevkiyatlar.length === 0 ? (
        <div className="apple-card p-8 text-center">
          <Truck className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">{tr ? 'Aktif sevkiyat yok.' : 'No active shipments.'}</p>
        </div>
      ) : (
        <>
          {aktifSevkiyatlar.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
              {aktifSevkiyatlar.map(s => (
                <button key={s.id} onClick={() => setSeciliId(s.id)}
                  className={`px-3 py-2 rounded-xl text-xs whitespace-nowrap border transition-colors ${
                    secili?.id === s.id ? 'bg-brand text-white border-brand' : 'bg-white border-gray-100 text-gray-600'}`}>
                  {s.customerName}
                </button>
              ))}
            </div>
          )}

          {secili && (
            <div className="apple-card overflow-hidden">
              {/* ÜST: müşteri + adres + tahmini varış */}
              <div className="p-4 flex items-start justify-between gap-3 border-b border-gray-100">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{secili.customerName}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{secili.destination}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-gray-400 uppercase font-bold">{tr ? 'Tahmini Varış' : 'ETA'}</p>
                  <p className="text-lg font-black text-brand leading-tight">
                    {etaDk !== null ? `${etaDk} dk` : '—'}
                  </p>
                </div>
              </div>

              {/* ORTA: konum durumu */}
              <div className="p-4 border-b border-gray-100">
                {!arac ? (
                  <p className="text-xs text-gray-400 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    {tr ? 'Bu sevkiyata araç atanmamış — konum izlenemiyor.' : 'No vehicle assigned to this shipment.'}
                  </p>
                ) : !konum ? (
                  <p className="text-xs text-gray-400 flex items-center gap-2">
                    <Navigation className="w-3.5 h-3.5" />
                    {tr ? `${arac.plate} henüz konum paylaşmadı.` : `${arac.plate} has not shared a location yet.`}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-gray-600">
                        {konum.lat.toFixed(5)}, {konum.lng.toFixed(5)}
                        {konum.accuracyM ? <span className="text-gray-400"> ±{konum.accuracyM}m</span> : null}
                      </span>
                      {konumBayat ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                          {tr ? 'konum bayat' : 'stale'}
                          {konumYasiSn !== null && ` · ${Math.round(konumYasiSn / 60)} dk`}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {tr ? 'canlı' : 'live'} · {konumYasiSn}s
                        </span>
                      )}
                    </div>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${konum.lat}&mlon=${konum.lng}#map=15/${konum.lat}/${konum.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3" /> {tr ? 'Haritada aç' : 'Open in map'}
                    </a>
                  </div>
                )}
              </div>

              {/* ALT: yatay durum çubuğu */}
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center">
                  {ADIMLAR.map((a, i) => {
                    const gecildi = adimIdx >= i;
                    const Icon = a.icon;
                    return (
                      <div key={a.key} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                            gecildi ? 'bg-brand text-white' : 'bg-gray-100 text-gray-300'}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <span className={`text-[10px] whitespace-nowrap ${gecildi ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>
                            {tr ? a.tr : a.en}
                          </span>
                        </div>
                        {i < ADIMLAR.length - 1 && (
                          <div className={`flex-1 h-0.5 mx-1 -mt-4 ${adimIdx > i ? 'bg-brand' : 'bg-gray-100'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SÜRÜCÜ KARTI */}
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <Truck className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">
                      {secili.driver || arac?.driver || (tr ? 'Sürücü atanmamış' : 'No driver')}
                    </p>
                    <p className="text-xs text-gray-500">{arac?.plate ?? '—'}</p>
                  </div>
                </div>
                {(() => {
                  const tel = (secili.driverPhone || arac?.driverPhone || '').trim();
                  if (!tel) {
                    return (
                      <span className="text-[10px] text-gray-400">
                        {tr ? 'telefon kayıtlı değil' : 'no phone on file'}
                      </span>
                    );
                  }
                  return (
                    <div className="flex gap-2 shrink-0">
                      <a href={`tel:${tel}`} aria-label={tr ? 'Ara' : 'Call'}
                        className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center">
                        <Phone className="w-4 h-4" />
                      </a>
                      <a href={`sms:${tel}`} aria-label={tr ? 'Mesaj' : 'Message'}
                        className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center">
                        <MessageSquare className="w-4 h-4" />
                      </a>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-[10px] text-gray-400 leading-relaxed flex items-start gap-1.5">
        <Clock className="w-3 h-3 mt-0.5 shrink-0" />
        {tr
          ? `Konum ${PING_ARALIK_SN} saniyede bir gönderilir ve yalnız SON konum saklanır (geçmiş rota tutulmaz). ${BAYAT_ESIK_SN / 60} dakikadan eski konum "bayat" işaretlenir.`
          : `Location is sent every ${PING_ARALIK_SN}s and only the LAST position is stored (no route history).`}
      </p>
    </div>
  );
}
