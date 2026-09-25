/**
 * Faturadan türeyen MF siparişini sunucu ucundan siler (K-MF-SİL, 2026-09-25) — mezar kaydı sunucuda yazılır; bir
 * sonraki "Faturadan Sipariş Türet" siparişi "silinmişti" notuyla geri getirir. İstemci `orders`tan DOĞRUDAN silmez.
 * Dönüş: hata metni ya da null (başarılı).
 */
import { authFetch } from './authFetch';
import { mfaGerekliMetni } from '../utils/siparisler/siparisIslemleri';

export async function mikroSiparisiSil(id: string, tr: boolean): Promise<string | null> {
  try {
    const r = await authFetch('/api/mikro/siparis/sil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    // IIS/ARR 502 gibi JSON olmayan gövde "sunucuya ulaşılamadı"ya düşmesin — durum kodu yine yanıtı belirler.
    const d = await r.json().catch(() => ({})) as { success?: boolean; error?: string; mfaRequired?: boolean };
    // MFA 403'ü yerel silmeyle AYNI talimatı alır (yarım düzeltme: talimat yalnız dbClient yolundaydı — delta 3 inceleme).
    if (r.status === 403 && d.mfaRequired) return mfaGerekliMetni(tr ? 'tr' : 'en');
    if (!r.ok || !d.success) return d.error || (tr ? 'Sipariş silinemedi.' : 'Could not delete the order.');
    return null;
  } catch {
    return tr ? 'Sunucuya ulaşılamadı.' : 'Server unreachable.';
  }
}
