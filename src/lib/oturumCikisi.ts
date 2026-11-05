/**
 * ERP çıkışında sunucuya giden istek.
 *
 * NEDEN AYRI (2026-10-09): `handleLogout` bu isteği `signOut`'tan SONRA, belirteç isteyen
 * `authedFetch` ile atıyordu. Kullanıcı çıkınca sarmalayıcı «not authenticated» diye
 * fırlatıyor, istek HİÇ gitmiyordu (ölçüldü: fetch çağrı sayısı 0); sunucu oturum çerezini
 * silmiyor, yenileme belirteçlerini iptal etmiyordu. Çıkış ucu belirteç İSTEMEZ, varsa gönderilir
 * (dış rolde çerez yok): sunucu kullanıcıyı önce `Authorization: Bearer` belirtecinden, yoksa
 * çerezden tanır (`/api/db` yolu; 2026-10-21, şartname «müşteri siparişlerim» H2 — dış rol akış
 * açmadığı için oturum çerezi hiç kurulmuyor, iptal yazılmıyordu). İstek yine düz `fetch` ile, kimlik
 * sarmalayıcısına uğramadan gider; belirteci çağıran verir (bu modül `auth` içe AKTARMAZ — saf kalır).
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
 *  • (2026-10-21, şartname «müşteri siparişlerim» H17) `handleLogout` belirteci `cikisBelirteciAl` ile en çok
 *    `CIKIS_BELIRTEC_SURE_SINIRI_MS` (2 sn) bekler; alınamazsa ya da süre dolarsa istek belirteçsiz gider. İstek kalan süreyle
 *    sınırlıdır (`CIKIS_SURE_SINIRI_MS − CIKIS_BELIRTEC_SURE_SINIRI_MS` = 3 sn): çıkış TOPLAM en çok 5 sn, hiçbir adım fırlatmaz.
 */
export const CIKIS_UCU = '/api/db/session/logout';
export const CIKIS_SURE_SINIRI_MS = 5_000;
export const CIKIS_BELIRTEC_SURE_SINIRI_MS = 2_000;

/**
 * Çıkış isteğine eklenecek kimlik belirteci. `getir` verilmezse (oturum yok) `null`; verilirse en çok `sureMs` beklenir:
 * süre dolarsa, `getir` fırlatırsa / reddedilirse ya da boş dönerse `null` (ASLA fırlatmaz). Süre zamanlayıcısı her durumda
 * temizlenir. Belirteci kimin verdiğini bilmez (bu modül `auth` içe AKTARMAZ); çağıran `() => kullanici.getIdToken()` verir.
 */
export async function cikisBelirteciAl(
  getir: (() => Promise<string>) | undefined, sureMs = CIKIS_BELIRTEC_SURE_SINIRI_MS,
): Promise<string | null> {
  if (!getir) return null;
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(getir)
        .then((t): string | null => (typeof t === 'string' && t !== '' ? t : null), (): null => null),
      new Promise<null>((coz) => { zamanlayici = setTimeout(() => coz(null), sureMs); }),
    ]);
  } finally {
    if (zamanlayici !== undefined) clearTimeout(zamanlayici);
  }
}

type FetchGibi = (girdi: string, init: RequestInit) => Promise<{ ok: boolean; status?: number }>;

function sureSinyali(ms: number): AbortSignal | undefined {
  // `AbortSignal.timeout` eski tarayıcılarda yok; o zaman sınırsız (istek yine keepalive ile gider).
  const A = typeof AbortSignal !== 'undefined' ? (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }) : undefined;
  return typeof A?.timeout === 'function' ? A.timeout(ms) : undefined;
}

export async function cikisIstegiGonder(
  fetchFn: FetchGibi = fetch, sureSiniriMs = CIKIS_SURE_SINIRI_MS, kimlikBelirteci?: string | null,
): Promise<boolean> {
  try {
    const signal = sureSinyali(sureSiniriMs);
    const yanit = await fetchFn(CIKIS_UCU, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(typeof kimlikBelirteci === 'string' && kimlikBelirteci !== '' ? { Authorization: `Bearer ${kimlikBelirteci}` } : {}),
      },
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
