// @vitest-environment node
/**
 * hizSiniri.uctanUca.test.ts — hız sınırı anahtarının GERÇEK express + express-rate-limit ile davranışı (2026-10-08).
 *
 * Canlıda ölçülen arıza: kova IP başına değil TCP bağlantısı başına sayıyordu (üç ayrı bağlantıda kalan hak üçü de 299).
 * Buradaki uygulama server.ts'teki BAĞLAMA DÜZENİNİ küçük tavanlarla kurar (aynı yardımcılar, aynı sıra); server.ts'in bu
 * yardımcıları gerçekten bu düzende kullandığını `hizSiniri.degismez.test.ts` kilitler. Her istek YENİ bağlantıdır (agent: false)
 * ve vekilin yazdığı gibi 'IP:kapı' taşır.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import express, { type Request } from 'express';
import http from 'node:http';
import rateLimit from 'express-rate-limit';
import {
  akisIstegiIsaretle, akisSorguBelirteci, apiSinirindanMuaf, ipSinirAnahtari, istekBasinaBirKez, kimligeGoreTavan, kullaniciSinirAnahtari, temizIstemciIp, type SinirBagimliliklari,
} from './istemciIp';

const varsayilanDep: SinirBagimliliklari = {
  belirtecDogrula: async t => (t === 'a.b.gecerliA' ? 'kullaniciA' : t === 'a.b.gecerliB' ? 'kullaniciB' : t === 'a.b.patlat' ? (() => { throw new Error('app/no-app'); })() : null),
  cerezdenUid: c => { if (c.includes('oturum=%')) throw new URIError('URI malformed'); return c.includes('oturum=imzaliA') ? 'kullaniciA' : null; },
};
let srv: http.Server | undefined;
afterEach(() => new Promise<void>(r => { vi.restoreAllMocks(); if (srv) srv.close(() => r()); else r(); srv = undefined; }));

type Yanit = { kod: number; kalan: number; govde: string };
/** server.ts düzeni: trust proxy → IP düzeltme → sel koruması → /api/db (kendi sınırlayıcısı) → muaf yolların sınırlayıcıları → genel → rotalar. */
async function kur(t: { sel?: number; genel?: [number, number]; mikro?: [number, number]; ipOzel?: number; db?: number } = {}, dep: SinirBagimliliklari = varsayilanDep) {
  const app = express();
  app.set('trust proxy', 1);
  app.use((req, _res, next) => {
    const temiz = temizIstemciIp(req.ip);
    if (temiz !== null && temiz !== req.ip) Object.defineProperty(req, 'ip', { value: temiz, configurable: true, enumerable: true });
    next();
  });
  const userOrIpKey = (istek: Request): Promise<string> => kullaniciSinirAnahtari(istek, dep);
  const yalnizIpAnahtari = (istek: Request): string => ipSinirAnahtari(istek);
  const ortak = { windowMs: 60_000, standardHeaders: true, legacyHeaders: false } as const;
  app.use('/api', rateLimit({ ...ortak, standardHeaders: false, max: t.sel ?? 1000, keyGenerator: yalnizIpAnahtari }));
  const dbLimiter = rateLimit({ ...ortak, max: t.db ?? 1000, keyGenerator: userOrIpKey });
  // server.ts akış işleyicisinin kimlik okuyuşu: çerez, yoksa `?token=`; ikisi de yoksa 401 (Authorization başlığı okunmaz).
  app.get('/api/db/stream', akisIstegiIsaretle, dbLimiter, async (q, r) => {
    let uid: string | null = null;
    try { uid = dep.cerezdenUid(q.headers.cookie ?? ''); } catch { uid = null; }
    if (!uid) { try { uid = await dep.belirtecDogrula(akisSorguBelirteci(q.query)); } catch { uid = null; } }
    if (!uid) { r.status(401).json({ ok: false }); return; }
    r.json({ ok: true, uid });
  });
  app.post('/api/db/orders', dbLimiter, (_q, r) => { r.status(401).json({ ok: false }); });
  const ipOzel = (max: number) => rateLimit({ ...ortak, max, keyGenerator: yalnizIpAnahtari });
  app.use(['/api/shopify/webhook', '/api/stripe/webhook'], ipOzel(t.ipOzel ?? 1000));
  const apiLimiter = rateLimit({ ...ortak, max: kimligeGoreTavan(dep, ...(t.genel ?? [1000, 2000])), keyGenerator: userOrIpKey, skip: apiSinirindanMuaf });
  const mikroLimiter = istekBasinaBirKez(rateLimit({ ...ortak, max: kimligeGoreTavan(dep, ...(t.mikro ?? [1000, 2000])), keyGenerator: userOrIpKey }));
  app.use('/api', apiLimiter);
  app.use(['/api/mikro/import'], mikroLimiter);
  app.get('/api/x', (q, r) => { r.json({ ip: q.ip }); });
  app.get('/api/track/1', ipOzel(t.ipOzel ?? 1000), (_q, r) => { r.json({ ok: true }); });
  app.post('/api/hit', ipOzel(t.ipOzel ?? 1000), (_q, r) => { r.json({ ok: true }); });
  // Ödeme oturumu: rol kapısız uç — sınırlayıcısı YALNIZ IP (server.ts paymentLimiter), kimlik kapısından önce.
  app.post('/api/stripe/create-checkout', ipOzel(t.ipOzel ?? 1000), (_q, r) => { r.json({ ok: true }); });
  app.post('/api/shopify/webhook', (_q, r) => { r.json({ ok: true }); });
  // Rota zincirinde İKİNCİ kez bağlı (mikroRoutes'taki dört uç böyle) — yine tek sayılmalı.
  app.post('/api/mikro/import/gib-durum', mikroLimiter, (_q, r) => { r.json({ ok: true }); });
  await new Promise<void>(r => { srv = app.listen(0, '127.0.0.1', () => r()); });
  const adres = srv?.address();
  if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
  const port = adres.port;
  let kapi = 40000;
  return (yol: string, o: { ip?: string; xff?: string; method?: string; belirtec?: string; cerez?: string; yetkiHam?: string } = {}) => new Promise<Yanit>(coz => {
    const basliklar: Record<string, string> = { 'X-Forwarded-For': o.xff ?? `${o.ip ?? '85.105.1.2'}:${kapi++}` };
    if (o.belirtec) basliklar.Authorization = `Bearer ${o.belirtec}`;
    if (o.yetkiHam) basliklar.Authorization = o.yetkiHam;
    if (o.cerez) basliklar.Cookie = o.cerez;
    http.request({ host: '127.0.0.1', port, path: yol, method: o.method ?? 'GET', agent: false, headers: basliklar }, s => {
      let govde = ''; s.on('data', d => { govde += d; });
      s.on('end', () => coz({ kod: s.statusCode ?? 0, kalan: Number(s.headers['ratelimit-remaining']), govde }));
    }).end();
  });
}
const A = { belirtec: 'a.b.gecerliA' }, B = { belirtec: 'a.b.gecerliB' };

describe('ASIL HATA — kova IP başına: ayrı bağlantılar / kapılar TEK kovayı tüketir', () => {
  it('aynı IP\'den beş ayrı bağlantı: sayaç AZALIR ve tavanda 429 (eskiden her bağlantı taze kova alıyordu)', async () => {
    const iste = await kur({ genel: [3, 9] });
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await iste('/api/x'));
    expect(r.map(x => x.kalan)).toEqual([2, 1, 0, 0, 0]);
    expect(r.map(x => x.kod)).toEqual([200, 200, 200, 429, 429]);
    expect((await iste('/api/x', { ip: '85.105.1.3' })).kalan).toBe(2);                       // başka IP ayrı kova
  });
  it('`req.ip` kaynağında düzelir: rota kapısız IP görür (ödeme sağlayıcısına giden alan dâhil her okuyucu)', async () => {
    const iste = await kur();
    expect(JSON.parse((await iste('/api/x', { xff: '85.105.1.2:51234' })).govde)).toEqual({ ip: '85.105.1.2' });
    expect(JSON.parse((await iste('/api/x', { xff: '[2a02:ff0:1::5]:4444' })).govde)).toEqual({ ip: '2a02:ff0:1::5' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(JSON.parse((await iste('/api/x', { xff: 'sahte' })).govde)).toEqual({ ip: 'sahte' }); // çözülemeyen değer uydurulmaz
  });
  it('istemcinin KENDİ yazdığı X-Forwarded-For girdisi kovayı değiştirmez (yalnız vekilin sağa eklediği sayılır)', async () => {
    const iste = await kur({ genel: [3, 9] });
    expect((await iste('/api/x', { xff: '1.1.1.1, 85.105.1.2:1' })).kalan).toBe(2);
    expect((await iste('/api/x', { xff: '9.9.9.9, 85.105.1.2:2' })).kalan).toBe(1);
    expect((await iste('/api/x', { xff: 'cop, [::ffff:85.105.1.2]:3' })).kalan).toBe(0);     // v4-eşlemli biçim de aynı kova
  });
});

describe('kullanıcı başına kova — aynı ofisteki personel birbirini kilitlemez', () => {
  it('aynı IP\'den iki DOĞRULANMIŞ kullanıcı AYRI kova; kimlikli tavan kimliksizden yüksek', async () => {
    const iste = await kur({ genel: [2, 4] });
    for (let i = 0; i < 4; i++) expect((await iste('/api/x', A)).kod).toBe(200);
    expect((await iste('/api/x', A)).kod).toBe(429);                                          // A kendi tavanında (4)
    expect((await iste('/api/x', B)).kalan).toBe(3);                                          // B etkilenmedi
    expect((await iste('/api/x')).kalan).toBe(1);                                             // kimliksiz: IP kovası, tavan 2
  });
  it('kullanıcının iki cihazı (farklı IP) AYNI kullanıcı kovasında', async () => {
    const iste = await kur({ genel: [2, 4] });
    expect((await iste('/api/x', { ...A, ip: '85.105.1.2' })).kalan).toBe(3);
    expect((await iste('/api/x', { ...A, ip: '31.1.1.1' })).kalan).toBe(2);
  });
  it('SAHTE belirteç taze kova ALAMAZ: her sahte belirteç ortak IP kovasına düşer', async () => {
    const iste = await kur({ genel: [2, 4] });
    expect((await iste('/api/x', { belirtec: 'x.y.sahte1' })).kalan).toBe(1);
    expect((await iste('/api/x', { belirtec: 'x.y.sahte2' })).kalan).toBe(0);
    expect((await iste('/api/x', { belirtec: 'x.y.sahte3' })).kod).toBe(429);
  });
  it('"Bearer" ÖNEKSİZ belirteç de aynı kullanıcı kovasında (kimlik kapısı onu kabul ediyor — IP kovasına kaçıp tavanı ikiye katlayamaz)', async () => {
    const iste = await kur({ genel: [2, 3] });
    expect((await iste('/api/x', A)).kalan).toBe(2);
    expect((await iste('/api/x', { yetkiHam: 'a.b.gecerliA' })).kalan).toBe(1);
  });
  it('oturum çerezi yalnız GET /api/db/stream\'de kimliktir; başka uçta çerezli istek SAHİBİNİN kovasını tüketmez', async () => {
    const iste = await kur({ db: 3 });
    const cerez = 'a=1; oturum=imzaliA';
    expect((await iste('/api/db/stream', { cerez, ip: '31.1.1.1' })).kalan).toBe(2);         // u:kullaniciA
    // Saldırgan (başka IP) kurbanın çereziyle belirteçsiz POST yağdırır: 401 alır ve KENDİ IP kovasını tüketir.
    for (let i = 0; i < 3; i++) expect((await iste('/api/db/orders', { method: 'POST', cerez, ip: '6.6.6.6' })).kod).toBe(401);
    expect((await iste('/api/db/orders', { method: 'POST', cerez, ip: '6.6.6.6' })).kod).toBe(429);
    expect((await iste('/api/db/stream', { cerez, ip: '31.1.1.1' })).kalan).toBe(1);         // kurbanın kovası yerinde
  });
  it('akış ucunun Express\'in işleyiciye götürdüğü HER yazımı aynı kullanıcı kovasında (eskiden IP kovasına kaçıp tavanı ikiye katlıyordu)', async () => {
    const iste = await kur({ db: 3 });
    const cerez = 'oturum=imzaliA';
    for (let i = 0; i < 3; i++) expect((await iste('/api/db/stream', { cerez })).kod).toBe(200);
    expect((await iste('/api/db/stream', { cerez })).kod).toBe(429);                           // u:kullaniciA doldu
    // Hepsi işleyiciye gider (kova boşken 200 dönerdi) — yol taklidi değil, rotanın kendi işareti tanıyor.
    for (const [yol, method] of [
      ['/api/db/stream/', 'GET'], ['/API/DB/STREAM', 'GET'], ['/api/db/stream', 'HEAD'], ['/api/db/stream#x', 'GET'],
      ['/api\\db\\stream#x', 'GET'], ['/api/db/stream\\#x', 'GET'], ['http://x/api/db/stream', 'GET'],
    ] as const) expect((await iste(yol, { cerez, method })).kod, `${method} ${yol}`).toBe(429);
    // Geriye uyum yolu: çerezsiz, kimlik sorguda — yine aynı kova.
    expect((await iste('/api/db/stream?token=a.b.gecerliA')).kod).toBe(429);
    // Başka kullanıcı etkilenmez.
    expect(await iste('/api/db/stream?token=a.b.gecerliB')).toMatchObject({ kod: 200, kalan: 2 });
  });
  it('akışta işleyicinin 401 verdiği istek KİMSENİN kullanıcı kovasında sayılmaz (IP kovası) — işleyici ile sınırlayıcı aynı kimliği okur', async () => {
    const iste = await kur({ db: 3 });
    // Başlıkta geçerli A ama akış başlığı okumaz → 401; tekrarlı / parça sonrası sorgu belirteci → 401. Hepsi saldırganın IP kovasında.
    expect(await iste('/api/db/stream', { ...A, ip: '6.6.6.6' })).toMatchObject({ kod: 401, kalan: 2 });
    expect(await iste('/api/db/stream?token=a.b.gecerliA&token=a.b.gecerliB', { ip: '6.6.6.6' })).toMatchObject({ kod: 401, kalan: 1 });
    expect(await iste('/api/db/stream#x?token=a.b.gecerliA', { ip: '6.6.6.6' })).toMatchObject({ kod: 401, kalan: 0 });
    expect((await iste('/api/db/stream', { ip: '6.6.6.6' })).kod).toBe(429);
    // A'nın ve B'nin kovaları yerinde.
    expect(await iste('/api/db/stream?token=a.b.gecerliA')).toMatchObject({ kod: 200, kalan: 2 });
    // Başlıkta A, sorguda B → işleyici B'yi kimlik sayar; kova da B'nin.
    expect(JSON.parse((await iste('/api/db/stream?token=a.b.gecerliB', A)).govde)).toEqual({ ok: true, uid: 'kullaniciB' });
    expect(await iste('/api/db/stream?token=a.b.gecerliA')).toMatchObject({ kod: 200, kalan: 1 });   // A'nın kovası B'nin isteğiyle azalmadı
  });
});

describe('akışta çerez başlığı var ama oturum geçersiz', () => {
  it('`?token=` kimliğine düşülür: 200 ve KULLANICI kovası (IP kovası değil)', async () => {
    const iste = await kur({ db: 3 });
    const cerez = 'baska=1; oturum=gecersiz';
    expect(await iste('/api/db/stream?token=a.b.gecerliB', { cerez, ip: '31.1.1.1' })).toMatchObject({ kod: 200, kalan: 2 });
    // Başka IP'den aynı kullanıcı → AYNI kova (IP kovası olsaydı kalan yine 2 olurdu).
    expect(await iste('/api/db/stream?token=a.b.gecerliB', { cerez, ip: '31.2.2.2' })).toMatchObject({ kod: 200, kalan: 1 });
  });
});

describe('kimliksiz yüzeyi koruyan sınırlayıcılar kullanıcıya ASLA yükselmez (hesap açmak serbest)', () => {
  it('takip / sayaç / webhook: geçerli belirteç taşıyan istek de IP kovasında — her hesap taze kova olmaz', async () => {
    const iste = await kur({ ipOzel: 2 });
    expect((await iste('/api/track/1', A)).kalan).toBe(1);
    expect((await iste('/api/track/1', B)).kalan).toBe(0);
    expect((await iste('/api/track/1')).kod).toBe(429);
  });
  it('ödeme oturumu (yalnız-IP anahtarının davranışı; gerçek bağlamayı çit kilitler): her hesap taze kova ALAMAZ — iki kullanıcı aynı IP kovasında', async () => {
    const iste = await kur({ ipOzel: 2 });
    expect((await iste('/api/stripe/create-checkout', { ...A, method: 'POST' })).kalan).toBe(1);
    expect((await iste('/api/stripe/create-checkout', { ...B, method: 'POST' })).kalan).toBe(0);
    expect((await iste('/api/stripe/create-checkout', { ...A, method: 'POST' })).kod).toBe(429);
    expect((await iste('/api/stripe/create-checkout', { ...A, method: 'POST', ip: '31.1.1.1' })).kalan).toBe(1);   // başka IP ayrı kova
  });
});

describe('muafiyetler ve tek sayım', () => {
  it('/api/hit ve webhook genel /api kovasını TÜKETMEZ: tavanı aşan sayaç isteğinden sonra aynı IP\'nin başka isteği 200', async () => {
    const iste = await kur({ genel: [2, 4], ipOzel: 50 });
    for (let i = 0; i < 6; i++) expect((await iste('/api/hit', { method: 'POST' })).kod).toBe(200);
    for (let i = 0; i < 6; i++) expect((await iste('/api/shopify/webhook', { method: 'POST' })).kod).toBe(200);
    expect((await iste('/api/x')).kalan).toBe(1);
  });
  it('muafiyet YALNIZ POST: aynı yola başka yöntemle gelen istek genel kovada sayılır (eskiden hiçbir tavana takılmıyordu)', async () => {
    const iste = await kur({ genel: [2, 4], ipOzel: 50 });
    expect((await iste('/api/hit')).kod).toBe(404);
    expect((await iste('/api/hit', { method: 'PUT' })).kod).toBe(404);
    expect((await iste('/api/hit')).kod).toBe(429);
    expect((await iste('/api/x')).kod).toBe(429);                                             // genel kova tükendi
  });
  it('parça taşıyan yazım (\'/api/hit#x\') da sayaç işleyicisine gider ve muaftır — muafiyet ile yönlendirme AYNI yolu görür', async () => {
    const iste = await kur({ genel: [2, 4], ipOzel: 3 });
    for (let i = 0; i < 3; i++) expect((await iste('/api/hit#x', { method: 'POST' })).kod).toBe(200);
    expect((await iste('/api/hit#x', { method: 'POST' })).kod).toBe(429);                      // kendi sınırlayıcısı (3)
    expect((await iste('/api/x')).kalan).toBe(1);                                             // genel kova tüketilmedi
  });
  it('sel koruması muaf yolları DA sayar (muafiyet yalnız genel sınırlayıcıdandır)', async () => {
    const iste = await kur({ sel: 3, ipOzel: 50 });
    for (let i = 0; i < 3; i++) expect((await iste('/api/hit', { method: 'POST' })).kod).toBe(200);
    expect((await iste('/api/hit', { method: 'POST' })).kod).toBe(429);
    expect((await iste('/api/shopify/webhook', { method: 'POST' })).kod).toBe(429);
  });
  it('muaf yolların KENDİ sınırlayıcısı çalışır (muafiyet sınırsızlık değildir)', async () => {
    const iste = await kur({ ipOzel: 2 });
    expect((await iste('/api/shopify/webhook', { method: 'POST' })).kod).toBe(200);
    expect((await iste('/api/shopify/webhook', { method: 'POST' })).kod).toBe(200);
    expect((await iste('/api/shopify/webhook', { method: 'POST' })).kod).toBe(429);
  });
  it('aynı sınırlayıcı hem önekle hem rota zincirinde bağlıyken istek BİR KEZ sayılır (eskiden tavan sessizce yarıya iniyordu)', async () => {
    const iste = await kur({ mikro: [2, 4] });
    const r = [];
    for (let i = 0; i < 5; i++) r.push((await iste('/api/mikro/import/gib-durum', { ...A, method: 'POST' })).kod);
    expect(r).toEqual([200, 200, 200, 200, 429]);                                             // tavan 4 — 2 değil
  });
  it('sel koruması: tek IP, kaç HESAPLA gelirse gelsin kaba tavanı aşamaz', async () => {
    const iste = await kur({ sel: 3 });
    expect((await iste('/api/x', A)).kod).toBe(200);
    expect((await iste('/api/x', B)).kod).toBe(200);
    expect((await iste('/api/x')).kod).toBe(200);
    expect((await iste('/api/x', A)).kod).toBe(429);
    expect((await iste('/api/x', { ...A, ip: '31.1.1.1' })).kod).toBe(200);                    // başka IP'den aynı kullanıcı geçer
  });
});

describe('anahtar üretici ASLA 500 üretmez (kitaplık üretici hatasını yutmaz, isteği 500\'e düşürür ve hiç saymaz)', () => {
  it('fırlatan doğrulayıcı (Firebase Admin yok) ve bozuk çerez → yanıt 200 / sayılır, IP kovası', async () => {
    const iste = await kur({ genel: [3, 9], db: 3 });
    expect(await iste('/api/x', { belirtec: 'a.b.patlat' })).toMatchObject({ kod: 200, kalan: 2 });
    expect(await iste('/api/x', { belirtec: 'a.b.patlat' })).toMatchObject({ kod: 200, kalan: 1 });
    expect(await iste('/api/db/stream', { cerez: 'oturum=%' })).toMatchObject({ kod: 401, kalan: 2 });               // 500 değil; sayıldı (IP kovası)
  });
  it('çözülemeyen istemci adresi de 500 değil: değere özgü kovada sayılır', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const iste = await kur({ genel: [2, 9] });
    expect(await iste('/api/x', { xff: 'sahte' })).toMatchObject({ kod: 200, kalan: 1 });
    expect(await iste('/api/x', { xff: 'sahte' })).toMatchObject({ kod: 200, kalan: 0 });
    expect((await iste('/api/x', { xff: 'sahte' })).kod).toBe(429);
    expect((await iste('/api/x', { xff: 'baska-sahte' })).kod).toBe(200);
  });
});

describe('doğrulama ASILI kalırsa (soğuk sertifika önbelleği)', () => {
  it('genel + Mikro sınırlayıcısından geçen istek TEK süre sınırı bekler; doğrulayıcı BİR kez çağrılır; istek IP kovasında sayılır', async () => {
    const belirtecDogrula = vi.fn(() => new Promise<string | null>(() => {}));
    const iste = await kur({ genel: [3, 9], mikro: [3, 9] }, { belirtecDogrula, cerezdenUid: () => null, zamanAsimiMs: 200 });
    const t0 = performance.now();
    const y = await iste('/api/mikro/import/gib-durum', { belirtec: 'a.b.asili', method: 'POST' });
    const sure = performance.now() - t0;
    expect(y).toMatchObject({ kod: 200, kalan: 2 });                                           // kimliksiz tavan (3), IP kovası
    expect(belirtecDogrula).toHaveBeenCalledTimes(1);
    expect(sure).toBeGreaterThanOrEqual(190);
    expect(sure).toBeLessThan(390);                                                            // iki ayrı bekleme ≥ 400 ms olurdu
  });
});

describe('kitaplık doğrulamaları', () => {
  it('`ipSinirAnahtari` DOĞRUDAN keyGenerator verildiğinde de kitaplık ERR_ERL_KEY_GEN_IPV6 basmaz', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = express();
    app.set('trust proxy', 1);
    app.use(rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: ipSinirAnahtari }));
    app.get('/x', (_q, r) => { r.json({ ok: true }); });
    await new Promise<void>(r => { srv = app.listen(0, '127.0.0.1', () => r()); });
    const adres = srv?.address();
    if (!adres || typeof adres === 'string') throw new Error('test sunucusu dinlemiyor');
    const kod = await new Promise<number>(coz => { http.get({ host: '127.0.0.1', port: adres.port, path: '/x', agent: false, headers: { 'X-Forwarded-For': '85.105.1.2:4000' } }, s => { s.resume(); s.on('end', () => coz(s.statusCode ?? 0)); }); });
    expect(kod).toBe(200);
    const satirlar = [...hata.mock.calls, ...uyari.mock.calls].map(c => String(c[0]));
    expect(satirlar.filter(s => /ERR_ERL|ValidationError|ChangeWarning/.test(s))).toEqual([]);
  });
  it('sınırlayıcılar kurulurken ve ilk istekte kitaplık HATA / uyarı günlüğü basmaz (ERR_ERL_*)', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const iste = await kur();
    await iste('/api/x'); await iste('/api/hit', { method: 'POST' }); await iste('/api/mikro/import/gib-durum', { ...A, method: 'POST' });
    const satirlar = [...hata.mock.calls, ...uyari.mock.calls].map(c => String(c[0]));
    expect(satirlar.filter(s => /ERR_ERL|ValidationError|ChangeWarning/.test(s))).toEqual([]);
  });
});
