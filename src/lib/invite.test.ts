/** invite.test.ts — bekleyen davet belirtecinin hangi yanıtta silindiği (2026-10-08). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { redeemPendingInvite, getPendingInvite } from './invite';

const ANAHTAR = 'cetpa_pending_invite';
const yanit = (kod: number, govde: unknown) => async () => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { sessionStorage.setItem(ANAHTAR, 'davet-kodu'); });
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe('redeemPendingInvite — belirteç ne zaman silinir', () => {
  it('başarı → silinir, rol döner', async () => {
    expect(await redeemPendingInvite(yanit(200, { success: true, role: 'Sales', companyId: 'c1' }))).toEqual({ ok: true, role: 'Sales', companyId: 'c1' });
    expect(getPendingInvite()).toBeNull();
  });
  it.each([400, 403, 404, 409, 410, 422])('işleyicinin kalıcı reddi (%i + success: false) → silinir', async kod => {
    expect(await redeemPendingInvite(yanit(kod, { success: false, error: 'Davet geçersiz.' }))).toEqual({ ok: false, error: 'Davet geçersiz.' });
    expect(getPendingInvite()).toBeNull();
  });
  it('403 zincirdeki kimlik kapısından da gelir (askıya alınmış firma — daveti okumadan döner) → belirteç DURUR', async () => {
    expect((await redeemPendingInvite(yanit(403, { error: 'Firma hesabınız askıya alınmıştır. Lütfen yönetici ile iletişime geçin.', code: 'COMPANY_SUSPENDED' })))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it.each([403, 404])('vekilin kendi hata sayfası (%i, JSON değil) davet hükmü değil → belirteç durur', async kod => {
    const html = async () => new Response('<html><body>Hata</body></html>', { status: kod, headers: { 'Content-Type': 'text/html' } });
    expect((await redeemPendingInvite(html))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it.each([401, 408, 413, 423, 429])('listede OLMAYAN 4xx (%i) davet hükmü değil → belirteç durur (gövde success: false dese de)', async kod => {
    expect((await redeemPendingInvite(yanit(kod, { success: false, error: 'x' })))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it('429 (hız sınırı) GEÇİCİDİR → belirteç DURUR; silinseydi davet sessizce kaybolurdu', async () => {
    // Davet ucu IP başına 20 / 15 dk sayar: aynı ofisten art arda kabulde dolabilir (hız sınırı IP başına saymaya başladıktan sonra erişilebilir).
    expect((await redeemPendingInvite(yanit(429, { error: 'Too many authentication attempts, please try again later.' })))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it('401 davet hakkında hüküm DEĞİL (kimlik kapısı; belirteç yenilenemedi / sertifika çekilemedi) → belirteç DURUR', async () => {
    expect((await redeemPendingInvite(yanit(401, { error: 'Missing Authorization header.' })))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it('kalıcı ret listesi İŞLEYİCİ GÖVDESİNİN kodlarıyla birebir ve her reddi `success: false` taşır (ayırt edici o alan)', async () => {
    // Zincirdeki ara katmanları (hız sınırı 429, kimlik kapısı 401 / 403) KAPSAMAZ — onlar `success` alanı yazmaz, istemci onları geçici sayar.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const kaynak = readFileSync(join(process.cwd(), 'src', 'server', 'routes', 'epostaRoutes.ts'), 'utf8');
    const bas = kaynak.indexOf("app.post('/api/invites/redeem'");
    expect(bas, 'davet ucu epostaRoutes.ts içinde bulunamadı (taşındıysa bu çiti de taşı)').toBeGreaterThan(-1);
    const sonrakiRota = kaynak.slice(bas + 10).search(/\n  app\.(get|post|put|patch|delete|use)\(/);
    const govde = sonrakiRota < 0 ? kaynak.slice(bas) : kaynak.slice(bas, bas + 10 + sonrakiRota);
    const retler = [...govde.matchAll(/res\.status\((4\d\d)\)\.json\(\{([^}]*)\}/g)].map(m => ({ kod: Number(m[1]), govde: m[2] }));
    expect(retler.length, 'işleyici gövdesinde 4xx ret bulunamadı — dilim yanlış kesildi').toBeGreaterThanOrEqual(6);
    expect([...new Set(retler.map(r => r.kod))].sort()).toEqual([400, 403, 404, 409, 410, 422]);
    expect(retler.filter(r => !/success: false/.test(r.govde)).map(r => r.kod)).toEqual([]);
    // Gövdede `.json({…})` ile yazılmayan 4xx yok (olsaydı yukarıdaki desen onu görmezdi).
    expect((govde.match(/res\.status\(4\d\d\)/g) ?? []).length).toBe(retler.length);
  });
  it('ayırt edicinin ÖBÜR yarısı: uç yalnız `authLimiter → requireAuth` arkasında ve kimlik kapısının hiçbir reddi `success` alanı yazmaz', async () => {
    // Yazsaydı 403 askıya alınmış firma (403 kalıcı ret listesinde) işleyicinin hükmü sayılır, bekleyen davet sessizce silinirdi.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const rota = readFileSync(join(process.cwd(), 'src', 'server', 'routes', 'epostaRoutes.ts'), 'utf8');
    // Zincire yeni bir ara katman girerse bu satır kırılır: onun listedeki kodlu reddi de `success` yazmamalı (çite eklenir).
    expect(rota).toContain("app.post('/api/invites/redeem', C.authLimiter, C.requireAuth, async (");
    const sunucu = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const kapiBas = sunucu.indexOf('async function requireAuth(');
    expect(kapiBas, 'requireAuth server.ts içinde bulunamadı (taşındıysa bu çiti de taşı)').toBeGreaterThan(-1);
    const kapi = sunucu.slice(kapiBas, sunucu.indexOf('\n}\n', kapiBas));
    const kapiRetleri = [...kapi.matchAll(/res\.status\((4\d\d)\)\.json\(\{([^}]*)\}/g)].map(m => ({ kod: Number(m[1]), govde: m[2] }));
    expect(kapiRetleri.map(r => r.kod)).toContain(403);
    expect((kapi.match(/res\.status\(4\d\d\)/g) ?? []).length).toBe(kapiRetleri.length);
    expect(kapiRetleri.filter(r => /\bsuccess\b/.test(r.govde)).map(r => r.kod)).toEqual([]);
  });
  it.each([500, 502, 503])('sunucu hatası (%i) → belirteç durur', async kod => {
    expect((await redeemPendingInvite(yanit(kod, {})))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it('ağ hatası → belirteç durur', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await redeemPendingInvite(async () => { throw new TypeError('Failed to fetch'); }))?.ok).toBe(false);
    expect(getPendingInvite()).toBe('davet-kodu');
  });
  it('bekleyen davet yoksa istek atılmaz', async () => {
    sessionStorage.clear();
    const f = vi.fn();
    expect(await redeemPendingInvite(f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
