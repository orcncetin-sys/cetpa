/**
 * invite.ts — Davet bağlantısıyla gelen kullanıcının rolünü uygulayan yardımcı.
 *
 * SORUN: /api/admin/invite ve süper-admin daveti `invites/{token}` dokümanını
 * yazıp e-postayla `?invite=<token>` bağlantısı gönderiyordu, ama istemcide bu
 * parametreyi okuyan HİÇBİR kod yoktu. Davetteki rol ve companyId hiçbir zaman
 * uygulanmıyor, davetle gelen herkes App.tsx'in varsayılan dalına düşüp 'Sales'
 * + kendi uid'i ile açılıyordu.
 *
 * Token'ı sessionStorage'a almak ŞART: Google ile giriş sayfadan ayrılıp geri
 * döner (signInWithPopup/redirect) ve URL'deki `?invite=` parametresi bu turda
 * kaybolur. Kalıcı localStorage yerine sessionStorage seçildi — davet tek
 * seferlik, sekme kapanınca kalmasına gerek yok.
 */

const ANAHTAR = 'cetpa_pending_invite';

/**
 * Sayfa açılışında URL'deki `?invite=` parametresini yakalar ve saklar.
 * Parametreyi adres çubuğundan TEMİZLER: davet kodu tarayıcı geçmişinde,
 * yer imlerinde ve paylaşılan bağlantılarda durmasın.
 */
export function captureInviteFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    sessionStorage.setItem(ANAHTAR, token);
    params.delete('invite');
    const qs = params.toString();
    window.history.replaceState(
      {}, '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  } catch { /* sessionStorage kapalıysa (gizli sekme kısıtı) sessizce geç */ }
}

export function getPendingInvite(): string | null {
  try { return sessionStorage.getItem(ANAHTAR); } catch { return null; }
}

export function clearPendingInvite(): void {
  try { sessionStorage.removeItem(ANAHTAR); } catch { /* yok say */ }
}

/** `/api/invites/redeem` İŞLEYİCİSİNİN davet hakkındaki kalıcı hükümleri: kod yok / başka e-posta / bulunamadı / kullanılmış / süresi dolmuş / rol geçersiz.
 *  Aynı durum kodu zincirdeki başka bir kapıdan da gelebilir (403: askıya alınmış firma) — ayırt edici gövdedeki `success: false`'tur. */
const KALICI_RET: ReadonlySet<number> = new Set([400, 403, 404, 409, 410, 422]);

export type InviteRedeemResult =
  | { ok: true; role: string; companyId: string | null }
  | { ok: false; error: string };

/**
 * Bekleyen daveti sunucuya kullandırır. Kimlik doğrulaması yapılmış olmalı —
 * sunucu daveti çağıranın e-postasıyla eşleştirir.
 *
 * Başarılı ya da KALICI olarak başarısız (süresi dolmuş, kullanılmış, başka
 * e-posta) durumlarda token temizlenir; yalnız geçici hatalarda (ağ/5xx)
 * saklanır ki sonraki denemede tekrar denensin.
 */
export async function redeemPendingInvite(
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<InviteRedeemResult | null> {
  const token = getPendingInvite();
  if (!token) return null;
  try {
    const res = await authFetch('/api/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({})) as { success?: boolean; role?: string; companyId?: string | null; error?: string };
    if (res.ok && data.success && data.role) {
      clearPendingInvite();
      return { ok: true, role: data.role, companyId: data.companyId ?? null };
    }
    // Kalıcı ret = davet İŞLEYİCİSİNİN verdiği hüküm: durum kodu açık listede VE gövde `success: false` taşıyor (işleyicinin her
    // reddi öyle yazar — çit: invite.test.ts). Tekrar denemek anlamsız, token'ı at. Bunun dışındaki her 4xx davet hakkında DEĞİLDİR
    // ve geçicidir; uç daveti hiç okumadan dönmüştür: 429 hız sınırı (IP başına 20 / 15 dk; aynı ofisten art arda kabulde dolabilir),
    // 401 kimlik kapısı (belirteç yenilenemedi / sunucu sertifikayı çekemedi), 403 askıya alınmış firma (`requireAuth`), vekilin
    // kendi 403 / 404 sayfası. Onlarda token silinirse davet sessizce kaybolur, kullanıcı yeniden davet edilmek zorunda kalır.
    if (KALICI_RET.has(res.status) && data.success === false) clearPendingInvite();
    return { ok: false, error: data.error || 'Davet uygulanamadı.' };
  } catch (e) {
    // Ağ hatası — token dursun, sonraki girişte yeniden denenir.
    console.warn('[invite] Davet uygulanamadı (geçici):', e);
    return { ok: false, error: 'Davet sunucuya iletilemedi.' };
  }
}
