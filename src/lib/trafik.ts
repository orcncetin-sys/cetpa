/**
 * trafik.ts — çerezsiz sayfa görüntüleme ping'i (istemci tarafı).
 *
 * Her yol değişiminde `POST /api/hit`e {p: yol, r: referrer} gönderir.
 * KİMLİK YOK, ÇEREZ YOK: gönderilen tek şey sayfa yolu (sorgu dizesi
 * ATILMIŞ hâlde) ve ilk sayfada tarayıcının referrer'ı. Sunucu yolu bilinen
 * kovalara indirger, IP saklamaz — ayrıntı: src/server/routes/trafikRoutes.ts.
 *
 * `navigator.sendBeacon` tercih edilir: sayfa kapanırken bile gider ve asla
 * render'ı bloklamaz. Yoksa keepalive'lı fetch'e düşülür; o da yoksa sayım
 * sessizce atlanır — sayaç uygulamayı HİÇBİR koşulda yavaşlatmaz/kırmaz.
 *
 * Aynı yol art arda iki kez sayılmaz (React yeniden render'ları sayfa
 * görüntülemesi değildir).
 */

let sonYol: string | null = null;

export function sayfaGoruntulendi(pathname: string): void {
  try {
    // Sorgu ve parça HİÇ gönderilmez — ?track=<id> gibi değerler PII olabilir.
    const yol = pathname.split('?')[0].split('#')[0] || '/';
    if (yol === sonYol) return;
    const ilkSayfa = sonYol === null;
    sonYol = yol;

    const govde = JSON.stringify({
      p: yol,
      // Referrer yalnız İLK sayfada anlamlı (nereden geldi); site içi
      // gezinmede tarayıcı zaten kendi adresimizi verir, sunucu da onu eliyor.
      r: ilkSayfa ? document.referrer || undefined : undefined,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/hit', new Blob([govde], { type: 'application/json' }));
    } else {
      void fetch('/api/hit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: govde,
        keepalive: true,
      }).catch(() => { /* sayaç asla gürültü çıkarmaz */ });
    }
  } catch {
    /* sayaç asla uygulamayı kırmaz */
  }
}
