/**
 * magazaTalepIstemcisi.test.ts — ERP'den mağaza talebine yazan üç isteğin SÖZLEŞMESİ (dilim 2a, şartname v6 § 5.1 / § 7 «İstemci»).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Üçü de `authFetch` ile DÜZ POST: yol `/api/magaza-talepleri/:id/{durum,kalem-teslim,bildirim-gonder}`, gövde JSON,
 *      `Content-Type: application/json`; `X-Cetpa-Method` tüneli YOK; `bildirim-gonder` gövdesi `{}` (IIS gövdesiz POST'u iletmez).
 *   2. Durum kodu → kapalı `kod` eşlemesi (şartnamedeki tablo); 409 gövdesindeki aşama SAKLANAN sözlükle ve kapalı kümeden.
 *   3. ASLA fırlatmaz: ağ hatası, 5xx, JSON olmayan gövde → `kod: 'ag'`. Sunucunun `error` metni sonuca TAŞINMAZ.
 *   4. `eksik` yalnız ortam değişkeni ADLARI: değer / adres / sır görünümlü öğe düşer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { oku, SRC_KOK } from '../test/kaynakTarama';
import { yorumsuz } from '../test/degismezTarayici';
import { magazaTalepDurumuYaz, magazaKalemTeslimYaz, magazaBildirimGonder, MAGAZA_TALEP_UCU } from './magazaTalepIstemcisi';
import { authFetch } from './authFetch';

vi.mock('./authFetch', () => ({ authFetch: vi.fn() }));
const istek = vi.mocked(authFetch);

const ID = 'mt-0123456789abcdef0123456789abcdef';
const yanit = (status: number, govde: unknown): Response => new Response(JSON.stringify(govde), { status, headers: { 'Content-Type': 'application/json' } });
const htmlYanit = (status: number): Response => new Response('<html><body>IIS 502 - Bad Gateway</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
/** Son isteğin [adres, seçenekler] çifti. */
const son = (): [unknown, RequestInit | undefined] => { const c = istek.mock.calls[istek.mock.calls.length - 1]; return [c[0], c[1]]; };

/** Her çağrıya YENİ yanıt nesnesi (gövde bir kez okunur; aynı nesne iki çağrıya verilmez). */
const hepYanitla = (status: number, govde: unknown): void => { istek.mockImplementation(async () => yanit(status, govde)); };

beforeEach(() => { istek.mockReset(); });

// ── 1. İsteğin biçimi ───────────────────────────────────────────────────────────────────────────────────────────────
describe('istek biçimi — düz POST, JSON gövde, tünel yok', () => {
  it('uç kökü `/api/magaza-talepleri`', () => { expect(MAGAZA_TALEP_UCU).toBe('/api/magaza-talepleri'); });

  it('`magazaTalepDurumuYaz`: `POST …/:id/durum`; gövde `{ onceki, surum, durum, aciklama? }` SAKLANAN sözlükle', async () => {
    hepYanitla(200, { ok: true });
    expect(await magazaTalepDurumuYaz(ID, { onceki: 'yeni', surum: 4, durum: 'teyit' })).toEqual({ ok: true });
    expect(istek).toHaveBeenCalledTimes(1);
    const [adres, secenek] = son();
    expect(adres).toBe(`/api/magaza-talepleri/${ID}/durum`);
    expect(secenek).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"onceki":"yeni","surum":4,"durum":"teyit"}' });

    await magazaTalepDurumuYaz(ID, { onceki: 'sevk', surum: 9, durum: 'sevk', aciklama: '' });
    expect(JSON.parse(String(son()[1]?.body))).toEqual({ onceki: 'sevk', surum: 9, durum: 'sevk', aciklama: '' });   // `''` gönderilir (siler)
  });

  it('`magazaKalemTeslimYaz`: `POST …/:id/kalem-teslim`; «tümü» TEK istek (`kalemler: \'hepsi\'`)', async () => {
    hepYanitla(200, { ok: true });
    expect(await magazaKalemTeslimYaz(ID, { surum: 11, teslim: true, kalemler: ['b:1'] })).toEqual({ ok: true });
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/kalem-teslim`);
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"surum":11,"teslim":true,"kalemler":["b:1"]}' });

    await magazaKalemTeslimYaz(ID, { surum: 12, teslim: false, kalemler: 'hepsi' });
    expect(istek).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(son()[1]?.body))).toEqual({ surum: 12, teslim: false, kalemler: 'hepsi' });
  });

  it('`magazaBildirimGonder`: `POST …/:id/bildirim-gonder`; gövde `{}` ve `Content-Type` VAR; sorgu parametresi yok (`?tur` 2b\'nindir)', async () => {
    hepYanitla(200, { ok: true });
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: true });
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/bildirim-gonder`);
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });

  it('kimlik yol parçası olarak KAÇIRILIR (eğik çizgi / soru işareti başka yola taşımaz)', async () => {
    istek.mockResolvedValue(yanit(404, { ok: false }));
    await magazaBildirimGonder('../x?y=1#z');
    expect(son()[0]).toBe('/api/magaza-talepleri/..%2Fx%3Fy%3D1%23z/bildirim-gonder');
  });
});

// ── 2. Yanıt eşlemesi ───────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalepDurumuYaz — yanıt eşlemesi', () => {
  const cagir = () => magazaTalepDurumuYaz(ID, { onceki: 'yeni', surum: 0, durum: 'teyit' });

  it('409 `gecis-yok` → `gecis-yok` + güncel aşama (saklanan sözlük); aşama yoksa / bilinmiyorsa alan YOK', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'gecis-yok', durum: 'sevk' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecis-yok', durum: 'sevk' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'gecis-yok' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecis-yok' });
    // Panel sözlüğü (`alindi`) ve çöp değer saklanan aşama DEĞİLDİR: taşınmaz.
    for (const durum of ['alindi', 'bilinmiyor', '', null, 3, { durum: 'sevk' }]) {
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'gecis-yok', durum }));
      expect(await cagir(), JSON.stringify(durum)).toEqual({ ok: false, kod: 'gecis-yok' });
    }
  });

  it('409 `silindi` → `silindi`; 403 → `yetki`; 404 → `bulunamadi`', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silindi' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'silindi' });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(403, { error: 'MFA verification required', mfaRequired: true }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(404, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'bulunamadi' });
  });

  it('ağ hatası / 5xx / 503 / JSON olmayan gövde / tanınmayan 409 → `ag`; ASLA fırlatmaz', async () => {
    istek.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(500, { error: 'boom' }), yanit(503, { ok: false }), htmlYanit(502), yanit(429, { error: 'Too many requests' }), yanit(400, { ok: false }),
      yanit(409, { ok: false }), yanit(409, { ok: false, kod: 'baska-bir-sey' }), yanit(409, 'gecis-yok'), yanit(409, [{ kod: 'gecis-yok' }])]) {
      istek.mockResolvedValue(y);
      await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });

  it('JSON olmayan gövdeyle 2xx yine başarıdır (durum kodu okunur); sunucunun `error` metni sonuca TAŞINMAZ', async () => {
    istek.mockResolvedValue(htmlYanit(200));
    expect(await cagir()).toEqual({ ok: true });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol', error: 'Bu işlem için rolünüz yetersiz: Satış' }));
    expect(JSON.stringify(await cagir())).toBe('{"ok":false,"kod":"yetki"}');
  });
});

describe('magazaKalemTeslimYaz — yanıt eşlemesi', () => {
  const cagir = () => magazaKalemTeslimYaz(ID, { surum: 3, teslim: true, kalemler: ['b:0'] });

  it('409 `gecis-yok` (+ aşama) / `surum-eski` / `silindi` ayrı kodlar', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'gecis-yok', durum: 'iptal' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecis-yok', durum: 'iptal' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'gecis-yok' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecis-yok' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'surum-eski' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silindi' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'silindi' });
  });

  it('400 → `gecersiz` (şema ya da kaynağa ait olmayan anahtar); 403 → `yetki`; 404 → `bulunamadi`', async () => {
    istek.mockResolvedValue(yanit(400, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecersiz' });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(404, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'bulunamadi' });
  });

  it('ağ hatası / 5xx / tanınmayan 409 → `ag`; fırlatmaz', async () => {
    istek.mockRejectedValue(new Error('ağ yok'));
    await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(500, {}), yanit(503, { ok: false }), htmlYanit(504), yanit(409, { ok: false }), yanit(429, {})]) {
      istek.mockResolvedValue(y);
      await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });
});

describe('magazaBildirimGonder — yanıt eşlemesi', () => {
  it('409 `yapilandirilmamis` → kod + `eksik` AD dizisi; `kip` ve başka alan taşınmaz', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', kip: 'yerel', eksik: ['APP_URL'] }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'yapilandirilmamis', eksik: ['APP_URL'] });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', kip: 'kimlikli', eksik: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'yapilandirilmamis', eksik: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] });
    // `eksik` yok / dizi değil → boş dizi (ekran iki noktasız «Sunucu posta ayarı eksik» basar).
    for (const eksik of [undefined, null, 'APP_URL', { ad: 'APP_URL' }]) {
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', eksik }));
      expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'yapilandirilmamis', eksik: [] });
    }
  });

  it('`eksik` yalnız ortam değişkeni ADI taşır: değer / adres / sır görünümlü öğe DÜŞER; en çok 10 ad', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', eksik: [
      'APP_URL', 'SMTP_PASS=hunter2', 'smtp://kullanici:parola@posta.example:587', 'app_url', 'APP URL', '', 7, null, { ad: 'X' }, 'A'.repeat(65), '_GIZLI', 'SMTP_HOST',
    ] }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'yapilandirilmamis', eksik: ['APP_URL', 'SMTP_HOST'] });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', eksik: Array.from({ length: 25 }, (_, i) => `AYAR_${i}`) }));
    const s = await magazaBildirimGonder(ID);
    expect(s.ok === false && s.eksik).toHaveLength(10);
  });

  it('409 `kapali` → `kapali` (`eksik` yok); 409 `zaten-gitti` → `zaten-gitti`; 403 → `yetki`; 404 → `bulunamadi`', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'kapali' }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'kapali' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'zaten-gitti' }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'zaten-gitti' });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(404, { ok: false }));
    expect(await magazaBildirimGonder(ID)).toEqual({ ok: false, kod: 'bulunamadi' });
  });

  it('ağ hatası / 5xx / 400 / tanınmayan 409 → `ag`; fırlatmaz', async () => {
    istek.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(magazaBildirimGonder(ID)).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(500, {}), yanit(503, { ok: false }), htmlYanit(502), yanit(400, { ok: false }), yanit(409, { ok: false }), yanit(409, { ok: false, kod: 'revize-yok' })]) {
      istek.mockResolvedValue(y);
      await expect(magazaBildirimGonder(ID)).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });
});

// ── 3. Kaynak çiti ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaTalepIstemcisi.ts — kaynak çiti (yorumlar süzülür)', () => {
  const kod = yorumsuz('src/services/magazaTalepIstemcisi.ts', oku(join(SRC_KOK, 'services', 'magazaTalepIstemcisi.ts'))).join('\n');

  it('kaynak okunuyor (çit boş metne bakmasın)', () => { expect(kod.length).toBeGreaterThan(2000); });

  it('TEK istek yolu `authFetch`; düz `fetch(` yok; `X-Cetpa-Method` tüneli yok; yalnız POST', () => {
    expect((kod.match(/authFetch\(/g) ?? [])).toHaveLength(1);
    expect(kod).not.toMatch(/(^|[^\w.])fetch\(/);
    expect(kod).not.toMatch(/X-Cetpa-Method|X-HTTP-Method/i);
    expect([...kod.matchAll(/method: '(\w+)'/g)].map(m => m[1])).toEqual(['POST']);
    expect(kod).toContain("headers: { 'Content-Type': 'application/json' },");
  });

  it('üç yol da aynı kökten ve kimlik kaçırılarak kurulur; `/api/db` ve koleksiyon yazımı yok', () => {
    expect(kod).toContain("const yol = (id: string, son: 'durum' | 'kalem-teslim' | 'bildirim-gonder'): string => `${MAGAZA_TALEP_UCU}/${encodeURIComponent(id)}/${son}`;");
    expect(kod).not.toMatch(/\/api\/db|dbClient|setDoc|updateDoc|addDoc|deleteDoc/);
  });

  it('«yazıldı ama bağlanmadı»: istemcinin üç yolu sunucuda GERÇEKTEN kayıtlı (`routes/magazaErpRoutes.ts`, düz `app.post`)', () => {
    const sunucu = yorumsuz('src/server/routes/magazaErpRoutes.ts', oku(join(SRC_KOK, 'server', 'routes', 'magazaErpRoutes.ts'))).join('\n');
    expect(sunucu.length).toBeGreaterThan(2000);
    for (const son of ['durum', 'kalem-teslim', 'bildirim-gonder']) {
      expect((sunucu.match(new RegExp(`app\\.post\\('${MAGAZA_TALEP_UCU}/:id/${son}',`, 'g')) ?? []), son).toHaveLength(1);
    }
    // İstemci PUT / PATCH / DELETE göndermez; sunucuda da bu yollar yalnız POST'tur (IIS'in engellediği fiiller ve tünel gerekmez).
    expect(sunucu).not.toMatch(/app\.(put|patch|delete)\('\/api\/magaza-talepleri/);
  });

  it('sunucunun hata METNİ okunmaz (`error` / `message` alanı); `throw` yok', () => {
    expect(kod).not.toMatch(/govde\.(error|message|hata)\b/);
    expect(kod).not.toMatch(/\bthrow\b/);
  });
});
