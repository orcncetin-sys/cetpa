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
    // 4xx = kalıcı ret; tekrar denemek anlamsız, token'ı at.
    if (res.status >= 400 && res.status < 500) clearPendingInvite();
    return { ok: false, error: data.error || 'Davet uygulanamadı.' };
  } catch (e) {
    // Ağ hatası — token dursun, sonraki girişte yeniden denenir.
    console.warn('[invite] Davet uygulanamadı (geçici):', e);
    return { ok: false, error: 'Davet sunucuya iletilemedi.' };
  }
}
