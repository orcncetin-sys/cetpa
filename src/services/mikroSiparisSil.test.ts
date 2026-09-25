/**
 * mikroSiparisiSil — MF silme ucunun istemci sarmalayıcısı (K-MF-SİL). Hata metni kullanıcıya toast olarak gider:
 * MFA 403'ü yerel silmeyle AYNI talimatı alır; JSON olmayan gövde (IIS/ARR 502) "sunucuya ulaşılamadı"ya düşmez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const yanit = vi.hoisted(() => ({ durum: 200, govde: '{}' as string }));
vi.mock('./authFetch', () => ({
  authFetch: vi.fn(async () => new Response(yanit.govde, { status: yanit.durum, headers: { 'Content-Type': 'application/json' } })),
}));
import { mikroSiparisiSil } from './mikroSiparisSil';
import { authFetch } from './authFetch';

beforeEach(() => { vi.mocked(authFetch).mockClear(); });
const kur = (durum: number, govde: unknown) => { yanit.durum = durum; yanit.govde = typeof govde === 'string' ? govde : JSON.stringify(govde); };

describe('mikroSiparisiSil', () => {
  it('başarı → null; gövde yalnız { id }', async () => {
    kur(200, { success: true });
    expect(await mikroSiparisiSil('mikrofat__A__-321', true)).toBeNull();
    const [yol, init] = vi.mocked(authFetch).mock.calls[0] as [string, RequestInit];
    expect(yol).toBe('/api/mikro/siparis/sil');
    expect(JSON.parse(String(init.body))).toEqual({ id: 'mikrofat__A__-321' });
  });

  it('MFA 403 → talimatlı metin (iki dilde), sunucunun çıplak metni DEĞİL', async () => {
    kur(403, { error: 'İki faktörlü doğrulama gerekli.', mfaRequired: true });
    expect(await mikroSiparisiSil('x', true)).toBe('İki faktörlü doğrulama gerekli — sayfayı yenileyip kodu girin.');
    expect(await mikroSiparisiSil('x', false)).toBe('Two-factor verification required — reload the page and enter your code.');
  });

  it('öteki ret: sunucu metni; metin yoksa yerel yedek; JSON olmayan 502 → yedek (ulaşılamadı DEĞİL)', async () => {
    kur(403, { error: "Bu koleksiyon üzerinde 'delete' yetkiniz yok." });
    expect(await mikroSiparisiSil('x', true)).toBe("Bu koleksiyon üzerinde 'delete' yetkiniz yok.");
    kur(500, { success: false });
    expect(await mikroSiparisiSil('x', false)).toBe('Could not delete the order.');
    kur(502, '<html>Bad Gateway</html>');
    expect(await mikroSiparisiSil('x', true)).toBe('Sipariş silinemedi.');
  });

  it('ağ hatası → "Sunucuya ulaşılamadı."', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await mikroSiparisiSil('x', true)).toBe('Sunucuya ulaşılamadı.');
  });
});
