import { useEffect, useRef } from 'react';
import { doc, setDoc, serverTimestamp } from '../lib/dbClient';
import { db } from '../firebase';

/**
 * useKonumYayini — araç konumunu UYGULAMA AÇIKKEN sürekli yayınlar.
 *
 * ## Neden panelde değil burada
 *
 * İlk sürümde konum yayını Canlı Sevkiyat panelinin İÇİNDEYDİ: sürücü o
 * sekmeyi açık tutmak zorundaydı, başka sekmeye geçince yayın duruyordu.
 * Kullanıcı düzeltmesi (2026-08-28): "sürücü bu ekranı açık tutmalı diye bir
 * şey yok — app açıkken hep çeksin." Bu kanca AppContent'te, yani uygulamanın
 * kendisi açık olduğu sürece yaşar; sürücü CRM'de gezinirken de konum gider.
 *
 * ## Nasıl açılır/kapanır
 *
 * Panel yalnız `localStorage['cetpaKonumArac'] = <vehicleId>` yazar/temizler
 * ve `window`'a 'cetpa-konum-degisti' olayı yollar. Kalıcılık bilinçli:
 * sürücü uygulamayı yarın açtığında yayın kendiliğinden devam eder (tarayıcı
 * konum iznini zaten hatırlar). Kapatmak panelden tek tık.
 *
 * ## Değişmeyen sınırlar (panel başlığındaki KVKK/teknik notlar geçerli)
 *
 * - Araç başına TEK kayıt; izlek saklanmaz.
 * - Tarayıcı sekmesi ARKA PLANDAYKEN çoğu mobil tarayıcı watchPosition'ı
 *   duraklatır — bunu kod çözemez; arayüz konum yaşını gösterip "bayat" der.
 * - `PING_ARALIK_SN`den sık yazılmaz (pil + veri).
 */

const PING_ARALIK_SN = 25;
export const KONUM_ARAC_ANAHTARI = 'cetpaKonumArac';
export const KONUM_OLAYI = 'cetpa-konum-degisti';

export function useKonumYayini(opts: {
  aktif: boolean;          // oturum açık + konum yazma yetkisi var
  kullaniciUid?: string;
  plakaBul: (vehicleId: string) => string;
}): void {
  const { aktif, kullaniciUid, plakaBul } = opts;
  const watchRef = useRef<number | null>(null);
  const sonGonderimRef = useRef(0);
  // plakaBul her render'da yeni closure — efekt onu bağımlılığa almasın diye ref.
  const plakaBulRef = useRef(plakaBul);
  plakaBulRef.current = plakaBul;

  useEffect(() => {
    if (!aktif) return;

    function durdur() {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    }

    function baslat() {
      durdur();
      let vehicleId: string | null = null;
      try { vehicleId = localStorage.getItem(KONUM_ARAC_ANAHTARI); } catch { /* gizli mod vb. */ }
      if (!vehicleId) return;
      if (!('geolocation' in navigator) || !window.isSecureContext) return;
      const id = vehicleId;
      watchRef.current = navigator.geolocation.watchPosition(
        pos => {
          const now = Date.now();
          if (now - sonGonderimRef.current < PING_ARALIK_SN * 1000) return;
          sonGonderimRef.current = now;
          void setDoc(doc(db, 'vehiclePositions', id), {
            vehicleId: id,
            plate: plakaBulRef.current(id),
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Math.round(pos.coords.accuracy),
            updatedAt: serverTimestamp(),
            sharedByUid: kullaniciUid ?? null,
          }, { merge: true }).catch(() => {
            // Arka plan yayınında toast fırtınası olmaz; panel zaten konum
            // yaşını gösteriyor — gönderim düşerse orada "bayat" görünür.
          });
        },
        () => { /* izin reddi vb. — panel açılınca kullanıcıya orada söylenir */ },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
      );
    }

    baslat();
    window.addEventListener(KONUM_OLAYI, baslat);
    return () => {
      window.removeEventListener(KONUM_OLAYI, baslat);
      durdur();
    };
  }, [aktif, kullaniciUid]);
}
