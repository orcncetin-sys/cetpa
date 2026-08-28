/**
 * BarcodeScannerCamera.tsx — kamera ile barkod okuma (ZXing, ESM).
 *
 * NEDEN KENDI BILESENIMIZ (2026-08-18):
 * Eskiden `react-qr-barcode-scanner` kullaniliyordu. O paket kendi icinde
 * `react-webcam`'e bagimli ve react-webcam CJS ("type": "module" yok).
 * rolldown, bir CJS modulun `require('react/jsx-runtime')` cagrisi icin AYRI
 * bir jsx-runtime kopyasi uretiyor; bu kopya `manualChunks` atamasini YOK
 * SAYIP onu ilk ceken chunk'a yapisiyor — pratikte `vendor-barcode`'a.
 * Sonuc: JSX render eden HER chunk (olcum: 79 chunk) 404 kB'lik barkod
 * paketini STATIK import ediyordu, yani kullanici kamerayi hic acmasa bile
 * ilk acilista iniyordu. Kanit: vendor-barcode ciktisinin icinde
 * `react.transitional.element`, `e.jsx=r`, `e.Fragment=n`.
 *
 * Bes ayri vite yapilandirmasi denendi (chunk sirasi, ayri chunk, kural
 * kaldirma, hoistTransitiveImports, react-webcam'i izole etme) ve HICBIRI
 * olcumde ise yaramadi — sorun yapilandirmayla cozulmuyor, CJS bagimliliginin
 * KENDISI. Bu bilesen `@zxing/library`'nin ESM build'ini dogrudan kullanir
 * (`module: ./esm/index.js`), araya react-webcam girmez, dolayisiyla CJS
 * jsx-runtime kopyasi hic olusmaz.
 *
 * Davranis, degistirdigi bilesenle ayni: surekli tarama yapar, ilk okumada
 * onScan cagirir. Kamera akisi unmount'ta MUTLAKA kapatilir.
 */
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';

interface Props {
  onScan: (text: string) => void;
  /** Kamera acilamazsa gosterilecek metin dili. */
  currentLanguage: 'tr' | 'en';
}

export default function BarcodeScannerCamera({ onScan, currentLanguage }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  // onScan'i ref'te tut: her render'da degisen bir callback yuzunden kamera
  // akisinin yeniden kurulmasini (goruntunun titremesini) engeller.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    // QR ZATEN DESTEKLENIYOR — ek yapilandirma GEREKMIYOR.
    // BrowserMultiFormatReader argumansiz kurulunca hints null kalir; ZXing'in
    // MultiFormatReader'i bu durumda "format listesi bos" dalina girip TUM
    // cozuculeri yukler: QRCodeReader, MicroQRCodeReader, DataMatrix, Aztec,
    // PDF417, MaxiCode + 1B barkodlar. Yani eklenecek bir 'qr_code' bayragi YOK.
    // (2026-08-28: kullanici "barkod yaninda QR da tarat" dedi; olcum QR'in
    // zaten calistigini gosterdi — eksik olan yalnizca ARAYUZ ETIKETIYDI.)
    const reader = new BrowserMultiFormatReader();
    let durduruldu = false;

    reader
      .decodeFromConstraints(
        // Arka kamera tercih edilir; yoksa tarayici oleni verir.
        { video: { facingMode: 'environment' } },
        videoRef.current as HTMLVideoElement,
        (result) => {
          if (durduruldu || !result) return;
          // Ilk basarili okumadan sonra tarama durur — ayni barkodun
          // saniyede onlarca kez tetiklenmesini engeller.
          durduruldu = true;
          onScanRef.current(result.getText());
        },
      )
      .catch((e: unknown) => {
        console.warn('[BarcodeScannerCamera] kamera acilamadi:', e);
        setHata(
          currentLanguage === 'tr'
            ? 'Kamera açılamadı. İzin verildiğinden emin olun veya manuel giriş kullanın.'
            : 'Could not open the camera. Check permissions or use manual entry.',
        );
      });

    return () => {
      durduruldu = true;
      // reset() akisi ve tarama dongusunu kapatir; cagrilmazsa kamera isigi
      // modal kapandiktan sonra da yanik kalir.
      try { reader.reset(); } catch { /* zaten kapali */ }
    };
  }, [currentLanguage]);

  if (hata) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
        <p className="text-white/80 text-sm leading-relaxed">{hata}</p>
      </div>
    );
  }

  return <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />;
}
