/**
 * belgeNo.ts — Mikro yanıtındaki EVRAK NUMARASININ tek normalizasyonu
 * (Faz 3 4/n OrdersPage kapanışı, 2026-09-19). Test: belgeNo.test.ts (önce yazıldı).
 *
 * NEDEN VAR — `mikroRoutes.ts` üç kaydet rotasında da numarayı şöyle okuyordu:
 *   `const irsaliyeNo = (md?.irsaliyeNo || md?.IrsaliyeNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;`
 * `as string` YALNIZ derleme zamanı dökümüdür: Mikro `Data: { EvrakNo: 1042 }` gibi SAYISAL bir
 * numara dönerse değer JSON'da sayı olarak kalır ve istemciye sayı gider. İstemci tarafı ise
 * numarayı bilerek yalnız DOLU METİN olarak kabul ediyor (`irsaliyeGonder.doluMetin`; sahte
 * kesinlik kuralı: bozuk bir değer metne çevrilip resmî belge numarası gibi gösterilemez).
 * Sonuç: sayısal numara sessizce düşüyor — toast numarasız çıkıyor, `orders.irsaliyeNo` hiç
 * yazılmıyor, sipariş detayındaki rozet kalıcı olarak "gönderildi — numara gelmedi" diyor,
 * üstelik 409 mükerrer kapısı da (`typeof onceki?.irsaliyeNo === 'string'`) o damgayı göremiyor.
 * Numara yalnız hiçbir ekranın okumadığı `shipments/{orderId}` belgesinde kalıyordu.
 *
 * KARAR: dönüşüm İSTEMCİDE DEĞİL, sunucuda tek noktada yapılır — sınır normalizasyonu dış
 * sistemin bitişiğine aittir ve üç rota (SiparisKaydetV2 / FaturaKaydetV2 / IrsaliyeKaydetV2)
 * aynı kuralı paylaşır ("yarım düzeltme sınıfı": düzeltmeyi tek yüzeye uygulamak).
 *
 * SAHTE KESİNLİK: yalnız GERÇEKTEN bir evrak numarası olabilecek değer metne çevrilir —
 * dolu metin, ya da sonlu pozitif TAM sayı. `0`, negatif, kesirli, NaN/Infinity, güvenli tam
 * sayı aralığı dışı (üstel gösterim), boolean, nesne ve dizi REDDEDİLİR (`null` = numara yok).
 * `String([1042])` "1042" verirdi; `String(1e21)` "1e+21" verirdi — ikisi de evrak numarası değil.
 */

/**
 * Yedek zincirindeki İLK geçerli evrak numarasının metin karşılığı; hiçbiri geçerli değilse `null`.
 * Çağrı: `belgeNoMetni(md?.irsaliyeNo, md?.IrsaliyeNo, md?.evrakNo, md?.EvrakNo, md?.id)`.
 */
export function belgeNoMetni(...adaylar: readonly unknown[]): string | null {
  for (const x of adaylar) {
    if (typeof x === 'string') {
      const k = x.trim();
      if (k !== '') return k;
      continue;
    }
    if (typeof x === 'number' && Number.isSafeInteger(x) && x > 0) return String(x);
  }
  return null;
}
