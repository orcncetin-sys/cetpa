/**
 * magazaTalepIstemcisi.test.ts — ERP'den mağaza talebine yazan isteklerin SÖZLEŞMESİ (dilim 2a: üç istek, şartname v6 § 5.1 / § 7
 * «İstemci»; dilim 2b: + içerik, silme / geri alma, elle talep ve `?tur=revize`, § 10.4 / § 10.8).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Üçü de `authFetch` ile DÜZ POST: yol `/api/magaza-talepleri/:id/{durum,kalem-teslim,bildirim-gonder}`, gövde JSON,
 *      `Content-Type: application/json`; `X-Cetpa-Method` tüneli YOK; `bildirim-gonder` gövdesi `{}` (IIS gövdesiz POST'u iletmez).
 *   2. Durum kodu → kapalı `kod` eşlemesi (şartnamedeki tablo); 409 gövdesindeki aşama SAKLANAN sözlükle ve kapalı kümeden.
 *   3. ASLA fırlatmaz: ağ hatası, 5xx, JSON olmayan gövde → `kod: 'ag'`. Sunucunun `error` metni sonuca TAŞINMAZ.
 *   4. `eksik` yalnız ortam değişkeni ADLARI: değer / adres / sır görünümlü öğe düşer.
 *   5. DİLİM 2b: `…/:id/icerik` (gövde formun ürettiği nesnenin aynısı; `degisti` yanıttan), `…/:id/sil` (`{ surum, geriAl? }`),
 *      kök `POST /api/magaza-talepleri` (elle talep; `id` / `talepNo` biçim denetimiyle), `…/bildirim-gonder?tur=revize`.
 *      503 (ürün KDV okuması / numara çakışması) → `ag`; 409 gövdesindeki sürüm sayacı negatif olmayan tam sayı değilse taşınmaz.
 *
 * BİLEREK DEĞİŞEN dilim 2a sabitleri (2b; gevşetilmedi — yeni değerleriyle): `yol` yardımcısının son parça kümesi (+ `icerik`,
 * + `sil`); `bildirim-gonder`'de 409 `revize-yok` artık kendi koduna eşlenir (2a'da tanınmayan 409 = `ag` idi); «yazıldı ama
 * bağlanmadı» çiti altı yolu sayar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { oku, SRC_KOK } from '../test/kaynakTarama';
import { yorumsuz } from '../test/degismezTarayici';
import {
  magazaTalepDurumuYaz, magazaKalemTeslimYaz, magazaBildirimGonder, magazaTalepIcerigiYaz, magazaTalepSil, magazaElleTalepAc, MAGAZA_TALEP_UCU,
} from './magazaTalepIstemcisi';
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

  it('`magazaBildirimGonder`: `POST …/:id/bildirim-gonder`; gövde `{}` ve `Content-Type` VAR; `tur`\'suz çağrıda sorgu parametresi yok', async () => {
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
    for (const y of [yanit(500, {}), yanit(503, { ok: false }), htmlYanit(502), yanit(400, { ok: false }), yanit(409, { ok: false }), yanit(409, { ok: false, kod: 'surum-eski' })]) {
      istek.mockResolvedValue(y);
      await expect(magazaBildirimGonder(ID)).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });

  it('(2b) 409 `revize-yok` → `revize-yok` (talepte revize bildirimi yok); 409 `silindi` → `silindi` (silinmiş talep donuk) — iki `tur`da da', async () => {
    for (const tur of [undefined, 'revize'] as const) {
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'revize-yok' }));
      expect(await magazaBildirimGonder(ID, tur)).toEqual({ ok: false, kod: 'revize-yok' });
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silindi' }));
      expect(await magazaBildirimGonder(ID, tur)).toEqual({ ok: false, kod: 'silindi' });
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'yapilandirilmamis', eksik: ['APP_URL'] }));
      expect(await magazaBildirimGonder(ID, tur)).toEqual({ ok: false, kod: 'yapilandirilmamis', eksik: ['APP_URL'] });
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'kapali' }));
      expect(await magazaBildirimGonder(ID, tur)).toEqual({ ok: false, kod: 'kapali' });
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'zaten-gitti' }));
      expect(await magazaBildirimGonder(ID, tur)).toEqual({ ok: false, kod: 'zaten-gitti' });
    }
  });
});

// ── 2b. Dilim 2b: içerik, silme / geri alma, elle talep, revize bildirimi ───────────────────────────────────────────
describe('dilim 2b — istek biçimi', () => {
  const MUSTERI = { ad: 'Şükrü Çağlayan', firma: '', telefon: '0532 111 22 33', eposta: '', il: 'İzmir', adres: '', vergi: '' };

  it('`magazaTalepIcerigiYaz`: `POST …/:id/icerik`; gövde formun ürettiği nesnenin AYNISI (alan eklenmez / çıkarılmaz); `birimFiyat: null` korunur', async () => {
    hepYanitla(200, { ok: true, degisti: true });
    const govde = {
      icerikSurum: 3, musteri: MUSTERI, not: 'Öğleden sonra arayın',
      teyit: { kalemler: [{ anahtar: 'b:0', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, tedarik: false }, { ad: 'Fırça', adet: 1, birimFiyat: null, kdvOrani: 10 as const }] },
    };
    expect(await magazaTalepIcerigiYaz(ID, govde)).toEqual({ ok: true, degisti: true });
    expect(istek).toHaveBeenCalledTimes(1);
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/icerik`);
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde) });
    expect(JSON.parse(String(son()[1]?.body))).toEqual(govde);
    expect(String(son()[1]?.body)).toContain('"birimFiyat":null');
    expect(String(son()[1]?.body)).not.toMatch(/kdvKaynagi|talepEdilen|toplam/);
  });

  it('`magazaTalepSil`: `POST …/:id/sil`; silmede gövde `{ surum }`, geri almada `{ surum, geriAl: true }`', async () => {
    hepYanitla(200, { ok: true });
    expect(await magazaTalepSil(ID, { surum: 7 })).toEqual({ ok: true });
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/sil`);
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"surum":7}' });
    expect(await magazaTalepSil(ID, { surum: 8, geriAl: true })).toEqual({ ok: true });
    expect(son()[1]?.body).toBe('{"surum":8,"geriAl":true}');
    expect(istek).toHaveBeenCalledTimes(2);
  });

  it('`magazaElleTalepAc`: `POST /api/magaza-talepleri` (kimliksiz yol — numarayı SUNUCU üretir); 201 → `id` + `talepNo`', async () => {
    hepYanitla(201, { ok: true, id: ID, talepNo: 'T261011-AB12' });
    const govde = { musteri: MUSTERI, not: '', kalemler: [{ ad: 'Dış cephe boyası', adet: 3, sku: 'DYO-0042', marka: 'DYO', birimFiyat: null, tedarik: false }] };
    expect(await magazaElleTalepAc(govde)).toEqual({ ok: true, id: ID, talepNo: 'T261011-AB12' });
    expect(son()[0]).toBe('/api/magaza-talepleri');
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde) });
    expect(String(son()[1]?.body)).not.toMatch(/"no"|"tarih"/);
  });

  it('`magazaBildirimGonder(id, \'revize\')`: AYNI uç + `?tur=revize`, gövde `{}`; `tur` verilmezse sorgu dizesi HİÇ yok (`tur=ilk` gönderilmez)', async () => {
    hepYanitla(200, { ok: true });
    expect(await magazaBildirimGonder(ID, 'revize')).toEqual({ ok: true });
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/bildirim-gonder?tur=revize`);
    expect(son()[1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await magazaBildirimGonder(ID);
    expect(son()[0]).toBe(`/api/magaza-talepleri/${ID}/bildirim-gonder`);
    await magazaBildirimGonder(ID, undefined);
    expect(String(son()[0])).not.toContain('?');
    // Kimlik kaçırılır; sorgu dizesi kimlikten SONRA ve sabittir.
    await magazaBildirimGonder('a/b?c', 'revize');
    expect(son()[0]).toBe('/api/magaza-talepleri/a%2Fb%3Fc/bildirim-gonder?tur=revize');
  });
});

describe('magazaTalepIcerigiYaz — yanıt eşlemesi', () => {
  const cagir = () => magazaTalepIcerigiYaz(ID, { icerikSurum: 2, not: 'yeni not' });

  it('200 `degisti: true` → yazıldı; 200 `degisti: false` → «değişiklik yok» (yazım YOK); gövde okunamıyorsa `degisti: true` (sahte «değişiklik yok» denmez)', async () => {
    istek.mockResolvedValue(yanit(200, { ok: true, degisti: true }));
    expect(await cagir()).toEqual({ ok: true, degisti: true });
    istek.mockResolvedValue(yanit(200, { ok: true, degisti: false }));
    expect(await cagir()).toEqual({ ok: true, degisti: false });
    for (const y of [yanit(200, { ok: true }), yanit(200, { ok: true, degisti: 'false' }), yanit(200, { ok: true, degisti: 0 }), yanit(200, { ok: true, degisti: null }), htmlYanit(200)]) {
      istek.mockResolvedValue(y);
      expect(await cagir()).toEqual({ ok: true, degisti: true });
    }
  });

  it('409 `surum-eski` → kod + güncel `icerikSurum` (negatif olmayan tam sayıysa; değilse alan YOK); 409 `silindi` → `silindi`', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski', icerikSurum: 5 }));
    expect(await cagir()).toEqual({ ok: false, kod: 'surum-eski', icerikSurum: 5 });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski', icerikSurum: 0 }));
    expect(await cagir()).toEqual({ ok: false, kod: 'surum-eski', icerikSurum: 0 });
    for (const icerikSurum of [undefined, null, '5', -1, 2.5, NaN]) {
      istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski', icerikSurum }));
      expect(await cagir(), String(icerikSurum)).toEqual({ ok: false, kod: 'surum-eski' });
    }
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silindi' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'silindi' });
  });

  it('400 → `gecersiz`; 403 / 401 → `yetki`; 404 → `bulunamadi`', async () => {
    istek.mockResolvedValue(yanit(400, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecersiz' });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(401, { error: 'Unauthorized' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(404, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'bulunamadi' });
  });

  it('503 (ürün KDV okuması başarısız — sunucu varsayılan oranla sessizce YAZMAZ) / ağ hatası / 5xx / tanınmayan 409 → `ag`; fırlatmaz', async () => {
    istek.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(503, { ok: false }), yanit(500, { error: 'boom' }), htmlYanit(502), yanit(429, {}), yanit(409, { ok: false }), yanit(409, { ok: false, kod: 'gecis-yok' })]) {
      istek.mockResolvedValue(y);
      await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });
});

describe('magazaTalepSil — yanıt eşlemesi', () => {
  const sil = () => magazaTalepSil(ID, { surum: 4 });
  const geriAl = () => magazaTalepSil(ID, { surum: 5, geriAl: true });

  it('409 `surum-eski` (+ güncel `surum`) / `silindi` (zaten silinmiş) / `silinmemis` (geri alınacak bir şey yok) AYRI kodlar', async () => {
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski', surum: 6 }));
    expect(await sil()).toEqual({ ok: false, kod: 'surum-eski', surum: 6 });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'surum-eski', surum: 'altı' }));
    expect(await sil()).toEqual({ ok: false, kod: 'surum-eski' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silindi' }));
    expect(await sil()).toEqual({ ok: false, kod: 'silindi' });
    istek.mockResolvedValue(yanit(409, { ok: false, kod: 'silinmemis' }));
    expect(await geriAl()).toEqual({ ok: false, kod: 'silinmemis' });
  });

  it('403 `rol` (Yönetici değil) → `yetki`; 404 → `bulunamadi`; ağ hatası / 5xx / 400 / tanınmayan 409 → `ag`; fırlatmaz', async () => {
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await sil()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockResolvedValue(yanit(404, { ok: false }));
    expect(await geriAl()).toEqual({ ok: false, kod: 'bulunamadi' });
    istek.mockRejectedValue(new Error('ağ yok'));
    await expect(sil()).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(500, {}), yanit(503, { ok: false }), htmlYanit(504), yanit(400, { ok: false }), yanit(409, { ok: false }), yanit(409, { ok: false, kod: 'gecis-yok' })]) {
      istek.mockResolvedValue(y);
      await expect(sil()).resolves.toEqual({ ok: false, kod: 'ag' });
    }
  });
});

describe('magazaElleTalepAc — yanıt eşlemesi', () => {
  const cagir = () => magazaElleTalepAc({ musteri: { ad: 'A', telefon: '0532 111 22 33' }, kalemler: [{ ad: 'Boya', adet: 1 }] });

  it('201\'de `id` / `talepNo` beklenen biçimde değilse `null` (talep yine AÇILMIŞTIR — numara uydurulmaz)', async () => {
    istek.mockResolvedValue(yanit(201, { ok: true, id: 'mt-kisa', talepNo: 'T-1' }));
    expect(await cagir()).toEqual({ ok: true, id: null, talepNo: null });
    istek.mockResolvedValue(yanit(201, { ok: true }));
    expect(await cagir()).toEqual({ ok: true, id: null, talepNo: null });
    istek.mockResolvedValue(htmlYanit(201));
    expect(await cagir()).toEqual({ ok: true, id: null, talepNo: null });
    istek.mockResolvedValue(yanit(201, { ok: true, id: ID, talepNo: '<b>T261011-AB12</b>' }));
    expect(await cagir()).toEqual({ ok: true, id: ID, talepNo: null });
  });

  it('400 → `gecersiz` (ad boş / telefonda 10 rakam yok); 403 → `yetki`; 503 (numara çakışması / kiracı) ve ağ hatası → `ag`; fırlatmaz', async () => {
    istek.mockResolvedValue(yanit(400, { ok: false }));
    expect(await cagir()).toEqual({ ok: false, kod: 'gecersiz' });
    istek.mockResolvedValue(yanit(403, { ok: false, kod: 'rol' }));
    expect(await cagir()).toEqual({ ok: false, kod: 'yetki' });
    istek.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
    for (const y of [yanit(503, { ok: false }), yanit(500, {}), htmlYanit(502), yanit(409, { ok: false, kod: 'silindi' }), yanit(404, { ok: false })]) {
      istek.mockResolvedValue(y);
      await expect(cagir()).resolves.toEqual({ ok: false, kod: 'ag' });
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

  it('kimlikli beş yol da aynı kökten ve kimlik kaçırılarak kurulur; elle talep kökün kendisidir; `/api/db` ve koleksiyon yazımı yok', () => {
    expect(kod).toContain("const yol = (id: string, son: 'durum' | 'kalem-teslim' | 'bildirim-gonder' | 'icerik' | 'sil'): string => `${MAGAZA_TALEP_UCU}/${encodeURIComponent(id)}/${son}`;");
    expect(kod).toContain('const y = await gonder(MAGAZA_TALEP_UCU, g);');
    // Uç adresi TEK sabittedir; sorgu dizesi yalnız `?tur=revize` (istek metninden üretilmez).
    expect((kod.match(/\/api\/magaza-talepleri/g) ?? [])).toHaveLength(1);
    expect([...kod.matchAll(/\?(\w+)=(\w+)/g)].map(m => m[0])).toEqual(['?tur=revize']);
    expect(kod).not.toMatch(/\/api\/db|dbClient|setDoc|updateDoc|addDoc|deleteDoc/);
  });

  it('«yazıldı ama bağlanmadı»: istemcinin ALTI yolu sunucuda GERÇEKTEN kayıtlı (`routes/magazaErpRoutes.ts`, düz `app.post`)', () => {
    const sunucu = yorumsuz('src/server/routes/magazaErpRoutes.ts', oku(join(SRC_KOK, 'server', 'routes', 'magazaErpRoutes.ts'))).join('\n');
    expect(sunucu.length).toBeGreaterThan(2000);
    for (const son of ['durum', 'kalem-teslim', 'bildirim-gonder', 'icerik', 'sil']) {
      expect((sunucu.match(new RegExp(`app\\.post\\('${MAGAZA_TALEP_UCU}/:id/${son}',`, 'g')) ?? []), son).toHaveLength(1);
    }
    // Elle talep: kökün kendisi (kimliksiz yol).
    expect((sunucu.match(new RegExp(`app\\.post\\('${MAGAZA_TALEP_UCU}',`, 'g')) ?? [])).toHaveLength(1);
    // İstemcinin okuduğu yanıt alanları sunucuda gerçekten yazılıyor: içerikte `degisti`, elle talepte `id` + `talepNo`.
    expect(sunucu).toMatch(/status\(200\)\.json\(\{\s*ok: true,\s*degisti: true\s*\}\)/);
    expect(sunucu).toMatch(/status\(200\)\.json\(\{\s*ok: true,\s*degisti: false\s*\}\)/);
    expect(sunucu).toMatch(/status\(201\)\.json\(\{\s*ok: true,\s*id: [\w.]+,\s*talepNo: [\w.]+\s*\}\)/);
    // İstemci PUT / PATCH / DELETE göndermez; sunucuda da bu yollar yalnız POST'tur (IIS'in engellediği fiiller ve tünel gerekmez).
    expect(sunucu).not.toMatch(/app\.(put|patch|delete)\('\/api\/magaza-talepleri/);
  });

  it('sunucunun hata METNİ okunmaz (`error` / `message` alanı); `throw` yok', () => {
    expect(kod).not.toMatch(/govde\.(error|message|hata)\b/);
    expect(kod).not.toMatch(/\bthrow\b/);
  });
});
