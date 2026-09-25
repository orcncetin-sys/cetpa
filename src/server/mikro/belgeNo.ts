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

/**
 * Mikro yanıtının ANAHTAR YOLLARI — DEĞERLER ASLA (İkiz ölçümü I2, 2026-09-25).
 *
 * NEDEN: `FaturaKaydetV2` yanıtında evrak SIRA numarasının hangi anahtarda döndüğü bilinmiyor; yukarıdaki
 * `belgeNoMetni(md?.faturaNo, md?.FaturaNo, md?.evrakNo, …)` zinciri TAHMİNDİR (bkz. mikro-kolon-adi-tahmin-etme).
 * Cetpa'nın kestiği fatura "Faturadan Sipariş Türet"te ikinci bir MF siparişi (ikiz) olarak geri gelmesin diye
 * siparişe Mikro'nun `seri|sira` anahtarı yazılmalı — önce yanıtın biçimi ÖLÇÜLÜR. Yalnız yol adları syncLog'a
 * gider ('result[0].Data.faturaNo' gibi); değer (numara, ETTN, cari, tutar) yazılmaz.
 * Diziden yalnız İLK öğe gezilir ([0]); derinlik ve yol sayısı sınırlı; uzun anahtar kırpılır.
 */
export function yanitAnahtarYollari(v: unknown, sinir = 60, derinlik = 8): string[] {
  // Derinlik 8: zarf (`result`, `[0]`, `Data`) üç seviye yer; toplu gövdenin (`evraklar[0]…`) sırası da görünsün
  // (I2 incelemesi 2026-09-25: 4'te `Data.evraklar[…]`da kesiliyordu — her ölçüm gerçek bir e-Fatura demek).
  const yollar: string[] = [];
  let toplam = 0;
  const ekle = (y: string): void => { toplam++; if (yollar.length < sinir) yollar.push(y); };
  const dalMi = (x: unknown): boolean => x !== null && typeof x === 'object';
  const gez = (x: unknown, yol: string, kalan: number): void => {
    if (toplam > 5000) return;   // kaçak büyüklükte yanıt — sayım alt sınır olur
    if (Array.isArray(x)) {
      if (x.length === 0) { if (yol) ekle(yol + '[]'); return; }
      // Derinlik dizi dalında da uygulanır — iç içe dizide özyineleme sınırsız kalıyordu (delta inceleme 2026-09-25).
      // Eşik 0 (nesne dalıyla AYNI sınır): 1'de kesmek satır düzeyindeki `detay[0].sth_evrakno_sira`yı gizliyordu.
      if (kalan <= 0) { ekle(yol + '[…]'); return; }
      gez(x[0], yol + '[0]', kalan - 1);
      return;
    }
    if (dalMi(x)) {
      const o = x as Record<string, unknown>;
      const anahtarlar = Object.keys(o).sort();
      if (anahtarlar.length === 0) { if (yol) ekle(yol + '{}'); return; }
      // Yapraklar ÖNCE: zarf alanları (IsError, ErrorMessage) büyük bir `Data` dalının arkasında kırpılmasın.
      for (const k of [...anahtarlar.filter(a => !dalMi(o[a])), ...anahtarlar.filter(a => dalMi(o[a]))]) {
        if (toplam > 5000) return;
        const ad = k.length > 40 ? k.slice(0, 40) + '…' : k;
        const alt = yol ? `${yol}.${ad}` : ad;
        const deger = o[k];
        if (!dalMi(deger)) ekle(alt);
        else if (kalan > 1) gez(deger, alt, kalan - 1);
        // Sınıra gelen dal İŞARETLİ — yaprak (değer) sanılmasın.
        else ekle(alt + (Array.isArray(deger) ? '[…]' : '{…}'));
      }
      return;
    }
    if (yol) ekle(yol);
  };
  gez(v, '', derinlik);
  // Kırpma SESSİZ değil: eksik liste tam liste gibi okunup "yanıtta sıra anahtarı yok" sonucuna varılmasın.
  if (toplam > yollar.length) yollar.push(`…(+${toplam - yollar.length}${toplam > 5000 ? '+' : ''} yol kırpıldı)`);
  return yollar;
}
