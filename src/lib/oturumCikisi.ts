/**
 * ERP çıkışında sunucuya giden istek.
 *
 * NEDEN AYRI (2026-10-09): `handleLogout` bu isteği `signOut`'tan SONRA, belirteç isteyen
 * `authedFetch` ile atıyordu. Kullanıcı çıkınca sarmalayıcı «not authenticated» diye
 * fırlatıyor, istek HİÇ gitmiyordu (ölçüldü: fetch çağrı sayısı 0); sunucu oturum çerezini
 * silmiyor, yenileme belirteçlerini iptal etmiyordu. Çıkış ucu belirteç İSTEMEZ: kullanıcıyı
 * çerezden tanır (`/api/db` yolu). Bu yüzden istek düz `fetch` ile, kimlik sarmalayıcısına
 * uğramadan gider.
 *
 * Değişmezler:
 *  • Gövde `{}` ve `Content-Type: application/json`: IIS gövdesiz POST'u Node'a iletmeden
 *    `411 Length Required` ile reddediyor (canlıda ölçüldü 2026-08-18; bkz. services/authFetch.ts).
 *  • `credentials: 'same-origin'` açıkça: çerez isteğe binsin (varsayılan da bu; bilinçli yazıldı).
 *  • `keepalive: true`: çıkış sayfayı değiştirse de istek tamamlansın.
 *  • ASLA fırlatmaz; ağ / sunucu hatası çıkışı engellemez. Süre sınırı aşılınca da `false`. Başarısızlık SESSİZ
 *    değildir: tek satır `console.warn` (sunucu çerezi silmemiş / yenileme belirteçlerini iptal etmemiş olabilir).
 *  • `handleLogout` bu isteği `signOut`tan ÖNCE BEKLER: sunucudaki iptal uid bazlı ve küreseldir; yanıt gecikirken
 *    kullanıcı aynı hesapla yeniden girseydi yeni oturumun belirteci de iptal olurdu (inceleme 2026-10-09). Bedeli:
 *    sunucu yanıt vermiyorsa çıkış en çok süre sınırı kadar (5 sn) bekler.
 */
export const CIKIS_UCU = '/api/db/session/logout';
export const CIKIS_SURE_SINIRI_MS = 5_000;

type FetchGibi = (girdi: string, init: RequestInit) => Promise<{ ok: boolean; status?: number }>;

function sureSinyali(ms: number): AbortSignal | undefined {
  // `AbortSignal.timeout` eski tarayıcılarda yok; o zaman sınırsız (istek yine keepalive ile gider).
  const A = typeof AbortSignal !== 'undefined' ? (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }) : undefined;
  return typeof A?.timeout === 'function' ? A.timeout(ms) : undefined;
}

export async function cikisIstegiGonder(fetchFn: FetchGibi = fetch, sureSiniriMs = CIKIS_SURE_SINIRI_MS): Promise<boolean> {
  try {
    const signal = sureSinyali(sureSiniriMs);
    const yanit = await fetchFn(CIKIS_UCU, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
      ...(signal ? { signal } : {}),
    });
    if (!yanit.ok) console.warn('[oturumCikisi] sunucu çıkışı başarısız: HTTP', yanit.status ?? '?');
    return yanit.ok;
  } catch (hata) {
    console.warn('[oturumCikisi] çıkış isteği gitmedi:', hata instanceof Error ? hata.message : String(hata));
    return false;
  }
}
