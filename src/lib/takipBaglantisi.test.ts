/**
 * takipBaglantisi.test.ts — pano yardımcısı ve kod alma (şartname `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` TE; 2026-10-19).
 * Sayfadaki iki düğme `pages/OrdersPage.takipBaglantisi.test.tsx`'te.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PanoHatasi, TakipKoduHatasi, panoyaSozle, takipBaglantisiAl, takipKoduHataMetni } from './takipBaglantisi';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

const KOD = 'Ab12Cd34Ef56Gh78Ij90Kl';
const yanit = (ok: boolean, govde: unknown, durum = ok ? 200 : 400) =>
  Promise.resolve({ ok, status: durum, json: () => (govde === undefined ? Promise.reject(new SyntaxError('gövde yok')) : Promise.resolve(govde)) });

class SahteClipboardItem {
  constructor(public readonly ogeler: Record<string, Blob | Promise<Blob>>) {}
}
const panoKur = (p: { write?: unknown; writeText?: unknown } | undefined) =>
  Object.defineProperty(navigator, 'clipboard', { value: p, configurable: true });

beforeEach(() => { authFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('takipBaglantisiAl', () => {
  it('POST `/api/siparis/<kodlanmış kimlik>/takip-kodu` → `<köken>/?track=<kod>`', async () => {
    authFetch.mockImplementation(() => yanit(true, { success: true, takipKodu: KOD }));
    expect(await takipBaglantisiAl('mikrofat__C__A-1')).toBe(`${window.location.origin}/?track=${KOD}`);
    expect(authFetch).toHaveBeenCalledWith('/api/siparis/mikrofat__C__A-1/takip-kodu', { method: 'POST' });
    await takipBaglantisiAl('a/b c');
    expect(authFetch).toHaveBeenLastCalledWith('/api/siparis/a%2Fb%20c/takip-kodu', { method: 'POST' });
  });

  it('başarısızlık sınıfları → `TakipKoduHatasi` (sunucu iletisi varsa taşır); biçimsiz kod KABUL EDİLMEZ (kimliğe geri düşülmez)', async () => {
    const vakalar: Array<[() => unknown, string | null]> = [
      [() => yanit(false, { success: false, error: 'Sipariş bulunamadı.' }, 404), 'Sipariş bulunamadı.'],
      [() => yanit(false, { error: 'Bu veri için yetkiniz yok.' }, 403), 'Bu veri için yetkiniz yok.'],
      [() => yanit(true, { success: true, takipKodu: 'kisa' }), null],
      [() => yanit(true, { success: true, takipKodu: `${KOD.slice(0, 20)}__` }), null],
      [() => yanit(true, { success: false }), null],
      [() => yanit(false, undefined, 502), null],
      [() => Promise.reject(new TypeError('Failed to fetch')), 'sunucuya ulaşılamadı'],
    ];
    for (const [cevap, ileti] of vakalar) {
      authFetch.mockImplementationOnce(cevap);
      const h = await takipBaglantisiAl('s-1').then(() => null, (e: unknown) => e);
      expect(h).toBeInstanceOf(TakipKoduHatasi);
      expect((h as TakipKoduHatasi).sunucuIletisi).toBe(ileti);
    }
  });

  it('ekran metni iki dilde', () => {
    expect(takipKoduHataMetni(new TakipKoduHatasi('Sipariş bulunamadı.'), 'tr')).toBe('Takip bağlantısı alınamadı: Sipariş bulunamadı.');
    expect(takipKoduHataMetni(new TakipKoduHatasi(null), 'tr')).toBe('Takip bağlantısı alınamadı.');
    expect(takipKoduHataMetni(new TakipKoduHatasi(null), 'en')).toBe('Tracking link could not be created.');
  });
});

describe('panoyaSozle', () => {
  it('`ClipboardItem` yolu: `write` EŞZAMANLI çağrılır (metnin sözü çözülmeden), metin söz çözülünce dolar', async () => {
    vi.stubGlobal('ClipboardItem', SahteClipboardItem);
    let yazilan = '';
    const write = vi.fn((ogeler: SahteClipboardItem[]) => Promise.resolve(ogeler[0].ogeler['text/plain']).then(b => b.text()).then(m => { yazilan = m; }));
    const writeText = vi.fn();
    panoKur({ write, writeText });
    let coz: (m: string) => void = () => {};
    const soz = new Promise<string>(r => { coz = r; });
    const sonuc = panoyaSozle(soz);
    expect(write).toHaveBeenCalledTimes(1);          // söz HENÜZ çözülmedi
    expect(writeText).not.toHaveBeenCalled();
    coz('https://app.example.test/?track=X');
    await sonuc;
    expect(yazilan).toBe('https://app.example.test/?track=X');
  });

  it('geri dönüş yolu (`ClipboardItem` yok): söz çözülünce `writeText`', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const writeText = vi.fn(() => Promise.resolve());
    panoKur({ writeText });
    await panoyaSozle(Promise.resolve('metin'));
    expect(writeText).toHaveBeenCalledWith('metin');
  });

  it('hata ayrımı: metnin sözü düşerse ONUN hatası (iki yolda); metin hazır + pano reddi → `PanoHatasi`; pano yoksa `PanoHatasi`', async () => {
    const kodHatasi = new TakipKoduHatasi('Sipariş bulunamadı.');
    vi.stubGlobal('ClipboardItem', SahteClipboardItem);
    panoKur({ write: (o: SahteClipboardItem[]) => Promise.resolve(o[0].ogeler['text/plain']).then(() => undefined) });
    await expect(panoyaSozle(Promise.reject(kodHatasi))).rejects.toBe(kodHatasi);
    panoKur({ write: () => Promise.reject(new DOMException('izin yok', 'NotAllowedError')) });
    await expect(panoyaSozle(Promise.resolve('m'))).rejects.toBeInstanceOf(PanoHatasi);
    vi.stubGlobal('ClipboardItem', undefined);
    panoKur({ writeText: () => Promise.reject(new DOMException('izin yok', 'NotAllowedError')) });
    await expect(panoyaSozle(Promise.reject(kodHatasi))).rejects.toBe(kodHatasi);
    await expect(panoyaSozle(Promise.resolve('m'))).rejects.toBeInstanceOf(PanoHatasi);
    panoKur(undefined);
    await expect(panoyaSozle(Promise.resolve('m'))).rejects.toBeInstanceOf(PanoHatasi);
    await expect(panoyaSozle(Promise.reject(kodHatasi))).rejects.toBe(kodHatasi);
  });
});
