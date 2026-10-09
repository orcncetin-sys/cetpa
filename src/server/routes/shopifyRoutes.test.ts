/**
 * shopifyRoutes.test.ts — mağaza bağlantısı uçları + webhook (2026-10-02).
 * Sır hiçbir yanıtta / denetim kaydında yok · kaydetme yalnız Yönetici · alan adı tek kiracıya · webhook yalnız O kiracının
 * sırrıyla doğrulanır · olay güvene alınmadan 200 dönülmez.
 * 2026-10-07: kaldırma tuzu KORUR · alan adı / sır değeri değişince durum silinir · imza reddi kısıtlı iz bırakır.
 * 2026-10-07 (2. tur): durum BAĞLANTI SÜRÜMÜNE bağlı — silinememiş kalıntı da, eski sürümle doğrulanmış kuyruk işi de yeni
 * bağlantıyı «doğrulanmış» göstermez.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { join } from 'path';
import type { Express } from 'express';
import type { AdminDbLike } from '../adminDbTypes';
import { shopifyRoutes, shopifyIsiIsle, SHOPIFY_KUYRUGU, RET_IZI_ARALIGI_MS, type ShopifyRouteCtx, type ShopifyIsi } from './shopifyRoutes';
import { shopifySiparisKimligi } from '../kanal/shopifyEsleme';
import { SRC_KOK as SRC, kodSatirlari } from '../../test/kaynakTarama';

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;
function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (fiil: string) => (yol: string, ...mw: unknown[]) => { handlers[`${fiil} ${yol}`] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet('GET'), post: kaydet('POST') };
}
/**
 * Bellek içi doküman deposu — `where(alan,'==',deger)` ve `set / delete` yeter.
 * `silmePatlat`: anahtar → o dokümanın sıradaki KAÇ silinmesinin fırlatacağı (geçici veritabanı hatası).
 */
function sahteDb(baslangic: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(baslangic));
  const silmePatlat = new Map<string, number>();
  const ref = (coll: string, id: string) => ({
    id,
    get: async () => ({ exists: docs.has(`${coll}/${id}`), id, data: () => docs.get(`${coll}/${id}`) }),
    set: async (veri: Record<string, unknown>, opts?: { merge?: boolean }) => { docs.set(`${coll}/${id}`, opts?.merge ? { ...(docs.get(`${coll}/${id}`) ?? {}), ...veri } : veri); },
    delete: async () => {
      const kalan = silmePatlat.get(`${coll}/${id}`);
      if (kalan !== undefined && kalan > 0) { silmePatlat.set(`${coll}/${id}`, kalan - 1); throw new Error('connection terminated unexpectedly'); }
      docs.delete(`${coll}/${id}`);
    },
  });
  const db = {
    collection: (coll: string) => ({
      doc: (id: string) => ref(coll, id),
      where: (alan: string, _op: string, deger: unknown) => ({
        get: async () => ({
          docs: [...docs.entries()].filter(([k, v]) => k.startsWith(`${coll}/`) && v[alan] === deger)
            .map(([k, v]) => ({ id: k.slice(coll.length + 1), data: () => v, ref: ref(coll, k.slice(coll.length + 1)) })),
        }),
      }),
    }),
  } as unknown as AdminDbLike;
  return { db, docs, silmePatlat };
}
const gecir = () => (_r: unknown, _s: unknown, next: () => void) => next();
const SIR_A = 'whsec_kiraciA_0123456789', SIR_B = 'whsec_kiraciB_0123456789';
const BAG_A = { companyId: 'kiraciA', shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR_A, tuz: 'tuz-a', baglantiSurumu: 'surum-a' };
const BAG_B = { companyId: 'kiraciB', shopDomain: 'diger.myshopify.com', webhookSecret: SIR_B, tuz: 'tuz-b', baglantiSurumu: 'surum-b' };
/** Kayıttaki güncel bağlantı sürümü (yeni sürüm rastgele üretilir — beklenti kayıttan okunur). */
const surumu = (docs: Map<string, Record<string, unknown>>, cid = 'kiraciA') => docs.get(`shopifyBaglantilari/${cid}`)?.baglantiSurumu;

function duzenek(o: { docs?: Record<string, Record<string, unknown>>; rol?: string | null; cid?: string; superAdmin?: boolean; kuyruk?: 'yok' | 'var' | 'kirik' } = {}) {
  const { db, docs, silmePatlat } = sahteDb(o.docs);
  const gonderilen: Array<{ kuyruk: string; veri: ShopifyIsi; secenek: Record<string, unknown> }> = [];
  const denetim = vi.fn(async () => undefined);
  const C: ShopifyRouteCtx = {
    getAdminDb: () => db,
    getBoss: () => (o.kuyruk === 'yok' ? null : {
      send: async (kuyruk, veri, secenek) => { if (o.kuyruk === 'kirik') throw new Error('kuyruk yok'); gonderilen.push({ kuyruk, veri, secenek }); },
    }),
    requireAuth: gecir(), requireMfaVerified: gecir(), requireStaff: gecir(), requireCollectionAccess: () => gecir(),
    getUserRole: async () => (o.rol === undefined ? 'Admin' : o.rol) as never,
    isSuperAdmin: () => o.superAdmin === true,
    reqActor: () => ({ uid: 'u1', email: 'yonetici@example.com' }),
    reqCompanyId: async () => o.cid ?? 'kiraciA',
    writeAuditLog: denetim,
    pgServerTimestamp: () => 'ZAMAN',
  };
  const app = sahteApp(); shopifyRoutes(app as unknown as Express, C);
  const cagir = async (yol: string, req: Record<string, unknown> = {}) => {
    const res = { kod: 200, govde: null as unknown, json(b: unknown) { res.govde = b; return res; }, send(b: unknown) { res.govde = b; return res; }, status(n: number) { res.kod = n; return res; } };
    await app.handlers[yol]({ headers: {}, body: {}, uid: 'u1', ...req }, res);
    return res;
  };
  return { C, docs, silmePatlat, gonderilen, denetim, cagir };
}
const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});
beforeEach(() => { hata.mockClear(); uyari.mockClear(); delete process.env.APP_URL; });

/** İmzalı Shopify bildirimi (imza `sir` ile üretilir — yanlış sır = imzası tutmayan istek). */
const siparis = { id: 9001, name: '#1001', currency: 'TRY', total_price: '120.00', taxes_included: true, financial_status: 'paid', line_items: [] };
const istek = (sir: string, domain: string, govde: unknown = siparis, topic = 'orders/create') => {
  const rawBody = Buffer.from(JSON.stringify(govde), 'utf8');
  return { rawBody, body: govde, headers: {
    'x-shopify-shop-domain': domain, 'x-shopify-topic': topic, 'x-shopify-api-version': '2026-07',
    'x-shopify-hmac-sha256': createHmac('sha256', sir).update(rawBody).digest('base64'),
  } };
};
const DURUM_A = 'shopifyBaglantilari/kiraciA__durum';

describe('GET /api/shopify/baglanti', () => {
  it('yanıt sır ve tuz TAŞIMAZ; durum dokümanı eklenir', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, 'shopifyBaglantilari/kiraciA__durum': { baglantiSurumu: 'surum-a', sonTopic: 'orders/create', toplamBildirim: 4 } } });
    const r = await d.cagir('GET /api/shopify/baglanti');
    expect(JSON.stringify(r.govde)).not.toContain(SIR_A);
    expect(JSON.stringify(r.govde)).not.toContain('tuz-a');
    expect(JSON.stringify(r.govde)).not.toMatch(/baglantiSurumu|surum-a/);
    expect(r.govde).toMatchObject({ success: true, configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true, durum: { sonTopic: 'orders/create', toplamBildirim: 4 } });
  });
  it('başka kiracının bağlantısı görünmez — çağıranın kiracısı okunur', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciB': BAG_B }, cid: 'kiraciA' });
    expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ configured: false, shopDomain: null, durum: null });
  });
  it('durum `sonImzaReddi` taşır (ISO metin); hiç ret yoksa null — iç alan `sonHataOlay` yanıta ÇIKMAZ', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-07T09:00:00.000Z', sonHataOlay: 'shopify__abc', sonHataTopic: 'orders/paid' } } });
    const r = await d.cagir('GET /api/shopify/baglanti');
    expect(r.govde).toMatchObject({ durum: { sonImzaReddi: '2026-10-07T09:00:00.000Z', sonBildirim: null, toplamBildirim: null } });
    expect(JSON.stringify(r.govde)).not.toMatch(/sonHataOlay|sonHataTopic|orders\/paid/);
    const y = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: { baglantiSurumu: 'surum-a', sonTopic: 'orders/create', toplamBildirim: 1 } } });
    expect((await y.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: { sonImzaReddi: null, toplamBildirim: 1 } });
  });
  it('durum dokümanı BAŞKA sürümünse (eski bağlantının kalıntısı / damgasız) yanıtta durum: null — kayıt «bağlı» kalır', async () => {
    for (const kalinti of [{ baglantiSurumu: 'surum-eski', sonBildirim: '2026-10-01T10:00:00.000Z', toplamBildirim: 7 }, { sonBildirim: '2026-10-01T10:00:00.000Z', toplamBildirim: 7 }]) {
      const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: kalinti } });
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ configured: true, shopDomain: 'cetpa.myshopify.com', durum: null });
    }
  });
});

describe('POST /api/shopify/baglanti', () => {
  const govde = { shopDomain: 'https://Cetpa.myshopify.com/admin', webhookSecret: `  ${SIR_A} ` };
  it('yalnız Yönetici: Manager 403, hiçbir şey yazılmaz; süper-admin geçer', async () => {
    const m = duzenek({ rol: 'Manager' });
    expect((await m.cagir('POST /api/shopify/baglanti', { body: govde })).kod).toBe(403);
    expect(m.docs.size).toBe(0);
    const s = duzenek({ rol: null, superAdmin: true });
    expect((await s.cagir('POST /api/shopify/baglanti', { body: govde })).kod).toBe(200);
  });
  it('ilk kurulum: alan adı normalleşir, sır kırpılır, tuz üretilir; yanıt ve denetim kaydı sır içermez', async () => {
    const d = duzenek();
    const r = await d.cagir('POST /api/shopify/baglanti', { body: govde });
    expect(r.kod).toBe(200);
    const kayit = d.docs.get('shopifyBaglantilari/kiraciA');
    expect(kayit).toMatchObject({ companyId: 'kiraciA', shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR_A, guncelleyenUid: 'u1' });
    expect(kayit?.tuz).toMatch(/^[0-9a-f]{64}$/);
    expect(kayit?.baglantiSurumu).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(r.govde)).not.toContain(SIR_A);
    expect(JSON.stringify(r.govde)).not.toContain(String(kayit?.baglantiSurumu));
    expect(JSON.stringify(d.denetim.mock.calls)).not.toContain(SIR_A);
    expect(JSON.stringify(d.denetim.mock.calls)).toContain('cetpa.myshopify.com');
  });
  it('ilk kurulumda sır zorunlu; geçersiz alan adı 400', async () => {
    const d = duzenek();
    expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com' } })).kod).toBe(400);
    expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.com.tr', webhookSecret: SIR_A } })).kod).toBe(400);
    expect(d.docs.size).toBe(0);
  });
  it('boş sır = mevcut sır KORUNUR; tuz DEĞİŞMEZ (sır değişse de)', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A } });
    await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: '' } });
    expect(d.docs.get('shopifyBaglantilari/kiraciA')).toMatchObject({ webhookSecret: SIR_A, tuz: 'tuz-a' });
    await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: 'yeni-sir-0123456789abcdef' } });
    expect(d.docs.get('shopifyBaglantilari/kiraciA')).toMatchObject({ webhookSecret: 'yeni-sir-0123456789abcdef', tuz: 'tuz-a' });
  });
  describe('durum dokümanı BU alan adı + sır çiftini doğrular', () => {
    const DURUM = { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonBildirim: '2026-10-01T10:00:00.000Z', sonTopic: 'orders/create', toplamBildirim: 7, sonImzaReddi: '2026-09-30T10:00:00.000Z' };
    const kurulu = () => duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: DURUM } });
    const YENI_SIR = 'yeni-sir-0123456789abcdef';

    it('alan adı değişti (yeni sırla) → durum silinir, yanıtta durum: null; tuz DEĞİŞMEZ', async () => {
      const d = kurulu();
      const r = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'yeni-magaza.myshopify.com', webhookSecret: YENI_SIR } });
      expect(r.kod).toBe(200);
      expect(r.govde).toMatchObject({ configured: true, shopDomain: 'yeni-magaza.myshopify.com', durum: null });
      expect(d.docs.has(DURUM_A)).toBe(false);
      expect(d.docs.get('shopifyBaglantilari/kiraciA')).toMatchObject({ shopDomain: 'yeni-magaza.myshopify.com', webhookSecret: YENI_SIR, tuz: 'tuz-a' });
      expect(surumu(d.docs)).toMatch(/^[0-9a-f]{32}$/);   // yeni bağlantı = yeni sürüm ('surum-a' değil)
    });
    it('sır DEĞERİ değişti (alan adı aynı) → durum silinir, yanıtta durum: null', async () => {
      const d = kurulu();
      const r = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR } });
      expect(r.kod).toBe(200);
      expect(r.govde).toMatchObject({ configured: true, durum: null });
      expect(d.docs.has(DURUM_A)).toBe(false);
      expect(surumu(d.docs)).toMatch(/^[0-9a-f]{32}$/);
    });
    it('durum silme BAŞARISIZ olursa (500) yeniden gönderim eski durumu DİRİLTMEZ: kalıntı yok sayılır, sonraki yazım onu birleştirmez', async () => {
      const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: DURUM }, kuyruk: 'yok' });
      d.silmePatlat.set(DURUM_A, 1);
      const govdeYeni = { shopDomain: 'yeni-magaza.myshopify.com', webhookSecret: YENI_SIR };
      // Kayıt yazıldı, durum silinemedi → 500. Yönetici aynı formu yeniden gönderir: kayıt artık «aynı bağlantı», silme dalına girilmez.
      expect((await d.cagir('POST /api/shopify/baglanti', { body: govdeYeni })).kod).toBe(500);
      const ilkSurum = surumu(d.docs);
      const r = await d.cagir('POST /api/shopify/baglanti', { body: govdeYeni });
      expect(r.kod).toBe(200);
      expect(surumu(d.docs)).toBe(ilkSurum);                    // yeniden gönderim sürümü DEĞİŞTİRMEZ
      expect(d.docs.get(DURUM_A)).toEqual(DURUM);               // kalıntı hâlâ veritabanında…
      expect(r.govde).toMatchObject({ configured: true, shopDomain: 'yeni-magaza.myshopify.com', durum: null });   // …ama yanıtta YOK
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: null });
      // Yeni mağazanın ilk bildirimi kalıntının üstüne BİRLEŞTİRMEDEN yazar: sayaç 8 değil 1, eski ret zamanı yok.
      expect((await d.cagir('POST /api/shopify/webhook', istek(YENI_SIR, 'yeni-magaza.myshopify.com'))).kod).toBe(200);
      expect(d.docs.get(DURUM_A)).toMatchObject({ baglantiSurumu: ilkSurum, toplamBildirim: 1 });
      expect(d.docs.get(DURUM_A)).not.toHaveProperty('sonImzaReddi');
    });
    it('silinememiş kalıntının üstüne gelen İMZA REDDİ de birleştirmez: yeni bağlantı «bildirim alınmış» görünmez; ret kısıtı silme fırlatsa da sıfırlanır', async () => {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T09:00:00.000Z'));
      const birDakikaSonra = () => vi.setSystemTime(new Date(Date.now() + 60_000));
      try {
        const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: DURUM } });
        // Eski bağlantıya bir ret düştü (kısıt kuruldu); bir dakika sonra sır değişti ama durum silinemedi.
        await d.cagir('POST /api/shopify/webhook', istek('uydurma-sir-0123456789', 'cetpa.myshopify.com'));
        expect(d.docs.get(DURUM_A)).toEqual({ ...DURUM, sonImzaReddi: '2026-10-07T09:00:00.000Z' });
        birDakikaSonra();
        d.silmePatlat.set(DURUM_A, 1);
        expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR } })).kod).toBe(500);
        // Kısıt aralığı (10 dk) dolmadan gelen ret YENİ bağlantının ilk izidir: yazılır, kalıntıyla birleşmez.
        birDakikaSonra();
        expect((await d.cagir('POST /api/shopify/webhook', istek('uydurma-sir-0123456789', 'cetpa.myshopify.com'))).kod).toBe(401);
        expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: surumu(d.docs), sonImzaReddi: '2026-10-07T09:02:00.000Z' });
        expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: { sonImzaReddi: '2026-10-07T09:02:00.000Z', sonBildirim: null, toplamBildirim: null } });
      } finally { vi.useRealTimers(); }
    });
    it('ESKİ sırla doğrulanıp kuyrukta beklemiş iş sır değiştikten SONRA işlenirse: sipariş yazılır, durum YAZILMAZ (yeni sır «doğrulanmış» görünmez)', async () => {
      const d = kurulu();
      // Bildirim eski sırla doğrulandı ve kuyruğa girdi (iş o anki sürümü taşır).
      expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(200);
      const bekleyen = d.gonderilen[0].veri;
      expect(bekleyen.baglantiSurumu).toBe('surum-a');
      // Yönetici sırrı değiştirir (yanlış yazdı) → durum silinir. Sonra işçi bekleyen işi alır.
      await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR } });
      expect(await shopifyIsiIsle(d.C, bekleyen)).toMatchObject({ sonuc: 'yazildi' });
      expect([...d.docs.keys()].filter(k => k.startsWith('orders/'))).toHaveLength(1);
      expect(d.docs.has(DURUM_A)).toBe(false);
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ configured: true, durum: null });
      // Karşı kontrol: YENİ sürümle doğrulanan iş durumu yazar ve damgalar.
      expect(await shopifyIsiIsle(d.C, { ...bekleyen, baglantiSurumu: String(surumu(d.docs)) })).toMatchObject({ sonuc: 'yazildi' });
      expect(d.docs.get(DURUM_A)).toMatchObject({ baglantiSurumu: surumu(d.docs), toplamBildirim: 1 });
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: { toplamBildirim: 1 } });
    });
    it('sürüm sırdan / alan adından TÜRETİLMEZ, durum dokümanına sır ya da alan adı DEĞERİ yazılmaz', async () => {
      const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A }, kuyruk: 'yok' });
      // Kaldır → AYNI alan adı + AYNI sırla yeniden kur: türetilmiş bir kimlik aynı çıkardı; rastgele sürüm her kurulumda farklıdır.
      const surumler = new Set<unknown>(['surum-a']);
      for (let i = 0; i < 2; i++) {
        await d.cagir('POST /api/shopify/baglanti/kaldir');
        expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR_A } })).kod).toBe(200);
        surumler.add(surumu(d.docs));
      }
      expect(surumler.size).toBe(3);
      expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(200);
      await d.cagir('POST /api/shopify/webhook', istek('uydurma-sir-0123456789', 'cetpa.myshopify.com'));
      const durum = JSON.stringify(d.docs.get(DURUM_A));
      expect(durum).toContain(String(surumu(d.docs)));
      for (const deger of [SIR_A, 'cetpa.myshopify.com', 'tuz-a']) expect(durum).not.toContain(deger);
    });
    it('sürümsüz (eski) kayıt ilk kaydedişte sürüm alır; damgasız durumu o andan sonra yok sayılır', async () => {
      const { baglantiSurumu: _surum, ...surumsuz } = BAG_A;
      const { baglantiSurumu: _damga, ...damgasiz } = DURUM;
      const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': surumsuz, [DURUM_A]: damgasiz } });
      // Kaydedilene kadar eski davranış: sürümsüz kayıt damgasız durumla eşleşir.
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: { toplamBildirim: 7 } });
      const r = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: '' } });
      expect(surumu(d.docs)).toMatch(/^[0-9a-f]{32}$/);
      expect(r.govde).toMatchObject({ configured: true, durum: null });
      expect(d.docs.has(DURUM_A)).toBe(false);
    });
    it('aynı alan adı + boş sır → durum KORUNUR; aynı sırrı yeniden yapıştırmak da korur (karşılaştırma değer üzerinden)', async () => {
      const d = kurulu();
      const bos = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: '' } });
      expect(bos.govde).toMatchObject({ durum: { toplamBildirim: 7, sonBildirim: '2026-10-01T10:00:00.000Z', sonImzaReddi: '2026-09-30T10:00:00.000Z' } });
      const ayni = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'https://CETPA.myshopify.com/', webhookSecret: ` ${SIR_A} ` } });
      expect(ayni.govde).toMatchObject({ durum: { toplamBildirim: 7 } });
      expect(d.docs.get(DURUM_A)).toEqual(DURUM);
      expect(surumu(d.docs)).toBe('surum-a');   // aynı bağlantı = aynı sürüm
    });
    it('alan adı değişti + sır boş → 400; bağlantı da durum da DEĞİŞMEZ, denetim kaydı yazılmaz', async () => {
      const d = kurulu();
      for (const webhookSecret of ['', '   ', undefined]) {
        const r = await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'yeni-magaza.myshopify.com', webhookSecret } });
        expect(r.kod).toBe(400);
        expect(r.govde).toEqual({ success: false, error: 'Mağaza alan adı değişti; yeni mağazanın imza sırrını gir.' });
      }
      expect(d.docs.get('shopifyBaglantilari/kiraciA')).toEqual(BAG_A);
      expect(d.docs.get(DURUM_A)).toEqual(DURUM);
      expect(d.denetim).not.toHaveBeenCalled();
    });
    it('başka kiracının durum dokümanına dokunulmaz', async () => {
      const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: DURUM, 'shopifyBaglantilari/kiraciB': BAG_B, 'shopifyBaglantilari/kiraciB__durum': { toplamBildirim: 3 } } });
      await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR } });
      expect(d.docs.get('shopifyBaglantilari/kiraciB__durum')).toEqual({ toplamBildirim: 3 });
    });
  });
  it('alan adı başka kiracıya bağlıysa 409 — kiracı gövdeden değil oturumdan', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciB': { ...BAG_B, shopDomain: 'cetpa.myshopify.com' } }, cid: 'kiraciA' });
    const r = await d.cagir('POST /api/shopify/baglanti', { body: { ...govde, companyId: 'kiraciB' } });
    expect(r.kod).toBe(409);
    expect(d.docs.has('shopifyBaglantilari/kiraciA')).toBe(false);
    expect(d.docs.get('shopifyBaglantilari/kiraciB')).toMatchObject({ webhookSecret: SIR_B });
  });
});

describe('POST /api/shopify/baglanti/kaldir', () => {
  const docs = { 'shopifyBaglantilari/kiraciA': BAG_A, [DURUM_A]: { sonTopic: 'x' }, 'shopifyBaglantilari/kiraciB': BAG_B };

  it('yalnız Yönetici; sır + alan adı + durum gider, TUZ KALIR; başka kiracıya dokunulmaz', async () => {
    const m = duzenek({ docs, rol: 'Manager' });
    expect((await m.cagir('POST /api/shopify/baglanti/kaldir')).kod).toBe(403);
    expect(m.docs.size).toBe(3);
    const d = duzenek({ docs });
    expect((await d.cagir('POST /api/shopify/baglanti/kaldir')).govde).toEqual({ success: true });
    expect([...d.docs.keys()].sort()).toEqual(['shopifyBaglantilari/kiraciA', 'shopifyBaglantilari/kiraciB']);
    // Yarım kayıt: yalnız kiracı + tuz (+ kim / ne zaman). Sır ve alan adı YOK — birleştirmesiz yazım.
    expect(d.docs.get('shopifyBaglantilari/kiraciA')).toEqual({ companyId: 'kiraciA', tuz: 'tuz-a', guncelleyenUid: 'u1', guncellendi: 'ZAMAN' });
    expect(JSON.stringify([...d.docs.entries()].filter(([k]) => k.includes('kiraciA')))).not.toContain(SIR_A);
    expect(d.docs.get('shopifyBaglantilari/kiraciB')).toEqual(BAG_B);
    expect(JSON.stringify(d.denetim.mock.calls)).toContain('kaldırıldı: cetpa.myshopify.com');
  });
  it('kaldırılan bağlantı her yüzeyde YOK sayılır: GET bağlı değil, webhook 503, kuyruk işçisi atlar', async () => {
    const d = duzenek({ docs });
    await d.cagir('POST /api/shopify/baglanti/kaldir');
    expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ configured: false, shopDomain: null, webhookSirriKayitli: false, durum: null });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(503);
    expect(d.gonderilen).toHaveLength(0);
    const is: ShopifyIsi = { topic: 'orders/create', body: siparis, cid: 'kiraciA', shopDomain: 'cetpa.myshopify.com', baglantiSurumu: 'surum-a' };
    expect(await shopifyIsiIsle(d.C, is)).toEqual({ sonuc: 'atlandi', neden: 'baglantiYok' });
    expect([...d.docs.keys()].some(k => k.startsWith('orders/'))).toBe(false);
  });
  it('kaldır → yeniden kur: tuz AYNI kalır — aynı Shopify siparişi AYNI dokümana düşer (ikinci kez yazılmaz)', async () => {
    const d = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': BAG_A }, kuyruk: 'yok' });
    const kimlik = shopifySiparisKimligi({ cid: 'kiraciA', tuz: 'tuz-a' }, '9001');
    const bekleyen = { ...siparis, financial_status: 'pending', updated_at: '2026-10-07T10:00:00+03:00' };
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com', bekleyen))).kod).toBe(200);
    expect(d.docs.get(`orders/${kimlik}`)).toMatchObject({ status: 'Pending', paid: false });

    await d.cagir('POST /api/shopify/baglanti/kaldir');
    // Yeniden kurulum İLK kurulum sayılır: sır yeniden istenir (eski sır silindi).
    expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com' } })).kod).toBe(400);
    const YENI_SIR = 'yeniden-kurulum-sirri-0123456789';
    expect((await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR } })).kod).toBe(200);
    expect(d.docs.get('shopifyBaglantilari/kiraciA')).toMatchObject({ shopDomain: 'cetpa.myshopify.com', webhookSecret: YENI_SIR, tuz: 'tuz-a' });
    expect(JSON.stringify(d.denetim.mock.calls)).toContain('kuruldu: cetpa.myshopify.com, imza sırrı girildi');

    // Mağazada açık duran siparişin SONRAKİ olayı (ödeme alındı): yeni kayıt açılmaz, eski satır güncellenir.
    const odenen = { ...siparis, financial_status: 'paid', updated_at: '2026-10-07T11:00:00+03:00' };
    expect((await d.cagir('POST /api/shopify/webhook', istek(YENI_SIR, 'cetpa.myshopify.com', odenen, 'orders/updated'))).kod).toBe(200);
    expect([...d.docs.keys()].filter(k => k.startsWith('orders/'))).toEqual([`orders/${kimlik}`]);
    expect(d.docs.get(`orders/${kimlik}`)).toMatchObject({ status: 'Processing', paid: true });
  });
  it('tuzu olmayan (bozuk) kayıt tümüyle silinir; ikinci basış ve kayıtsız kiracı denetim kaydı YAZMAZ', async () => {
    const tuzsuz = duzenek({ docs: { 'shopifyBaglantilari/kiraciA': { companyId: 'kiraciA', shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR_A } } });
    expect((await tuzsuz.cagir('POST /api/shopify/baglanti/kaldir')).govde).toEqual({ success: true });
    expect(tuzsuz.docs.size).toBe(0);
    expect(tuzsuz.denetim).toHaveBeenCalledTimes(1);

    const d = duzenek({ docs });
    await d.cagir('POST /api/shopify/baglanti/kaldir');
    await d.cagir('POST /api/shopify/baglanti/kaldir');   // yarım kayıt üstüne ikinci basış
    expect(d.docs.get('shopifyBaglantilari/kiraciA')).toMatchObject({ companyId: 'kiraciA', tuz: 'tuz-a' });
    expect(d.denetim).toHaveBeenCalledTimes(1);

    const bos = duzenek();
    expect((await bos.cagir('POST /api/shopify/baglanti/kaldir')).govde).toEqual({ success: true });
    expect(bos.docs.size).toBe(0);
    expect(bos.denetim).not.toHaveBeenCalled();
  });
});

describe('POST /api/shopify/webhook', () => {
  const docs = { 'shopifyBaglantilari/kiraciA': BAG_A, 'shopifyBaglantilari/kiraciB': BAG_B };

  it('bağlantısı olmayan mağaza / alan adı başlığı yok → 503 (ortam sırrı yedeği YOK)', async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = SIR_A;
    const d = duzenek({ docs });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'baska.myshopify.com'))).kod).toBe(503);
    expect((await d.cagir('POST /api/shopify/webhook', { ...istek(SIR_A, 'cetpa.myshopify.com'), headers: {} })).kod).toBe(503);
    expect(d.gonderilen).toHaveLength(0);
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
  });
  it('imza yok / yanlış / BAŞKA kiracının sırrıyla → 401, olay kuyruğa girmez', async () => {
    const d = duzenek({ docs });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_B, 'cetpa.myshopify.com'))).kod).toBe(401);
    expect((await d.cagir('POST /api/shopify/webhook', istek('uydurma-sir-0123456789', 'cetpa.myshopify.com'))).kod).toBe(401);
    const imzasiz = istek(SIR_A, 'cetpa.myshopify.com');
    expect((await d.cagir('POST /api/shopify/webhook', { ...imzasiz, headers: { ...imzasiz.headers, 'x-shopify-hmac-sha256': undefined } })).kod).toBe(401);
    expect((await d.cagir('POST /api/shopify/webhook', { ...istek(SIR_A, 'cetpa.myshopify.com'), rawBody: undefined })).kod).toBe(401);
    expect(d.gonderilen).toHaveLength(0);
  });
  describe('reddedilen bildirim iz bırakır (kısıtlı)', () => {
    const T0 = new Date('2026-10-07T09:00:00.000Z');
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); });
    afterEach(() => { vi.useRealTimers(); });
    const yanlis = () => istek('uydurma-sir-0123456789', 'cetpa.myshopify.com');
    const ileri = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

    it('imza tutmadı → 401 + durum dokümanına YALNIZ `sonImzaReddi`; sayaç / son bildirim yazılmaz, sır ve imza hiçbir yere düşmez', async () => {
      const d = duzenek({ docs });
      const r = await d.cagir('POST /api/shopify/webhook', yanlis());
      expect(r.kod).toBe(401);
      expect(r.govde).toBe('Invalid signature');
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-07T09:00:00.000Z' });
      expect(d.docs.has('shopifyBaglantilari/kiraciB__durum')).toBe(false);
      expect(d.gonderilen).toHaveLength(0);
      expect(uyari).toHaveBeenCalledTimes(1);
      const iz = JSON.stringify([uyari.mock.calls, d.docs.get(DURUM_A)]);
      expect(iz).toContain('cetpa.myshopify.com');
      for (const gizli of [SIR_A, 'uydurma-sir-0123456789', yanlis().headers['x-shopify-hmac-sha256']]) expect(iz).not.toContain(gizli);
      // Kart bunu GET'ten okur: bildirim «alınmadı» sayılır (sonBildirim / toplamBildirim null), ret zamanı dolu.
      expect((await d.cagir('GET /api/shopify/baglanti')).govde).toMatchObject({ durum: { sonImzaReddi: '2026-10-07T09:00:00.000Z', sonBildirim: null, toplamBildirim: null } });
    });
    it('kısıt kiracı başına: aralık dolmadan ikinci ret ne yazar ne günlükler; dolunca yeniden yazar', async () => {
      const d = duzenek({ docs });
      await d.cagir('POST /api/shopify/webhook', yanlis());
      ileri(RET_IZI_ARALIGI_MS - 1);
      expect((await d.cagir('POST /api/shopify/webhook', yanlis())).kod).toBe(401);
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-07T09:00:00.000Z' });
      expect(uyari).toHaveBeenCalledTimes(1);
      // Başka kiracının reddi kendi anahtarıyla sayılır — kiracıA'nın kısıtı onu susturmaz.
      expect((await d.cagir('POST /api/shopify/webhook', istek('uydurma-sir-0123456789', 'diger.myshopify.com'))).kod).toBe(401);
      expect(d.docs.get('shopifyBaglantilari/kiraciB__durum')).toEqual({ companyId: 'kiraciB', baglantiSurumu: 'surum-b', sonImzaReddi: '2026-10-07T09:09:59.999Z' });
      ileri(1);
      await d.cagir('POST /api/shopify/webhook', yanlis());
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonImzaReddi: '2026-10-07T09:10:00.000Z' });
      expect(uyari).toHaveBeenCalledTimes(3);
    });
    it('ret, önceki BAŞARILI bildirimin durumunu ezmez (birleştirmeli yazım); sonraki başarı da reddi silmez', async () => {
      const d = duzenek({ docs: { ...docs, [DURUM_A]: { companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonBildirim: '2026-10-06T08:00:00.000Z', sonTopic: 'orders/create', toplamBildirim: 5 } }, kuyruk: 'yok' });
      await d.cagir('POST /api/shopify/webhook', yanlis());
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: 'surum-a', sonBildirim: '2026-10-06T08:00:00.000Z', sonTopic: 'orders/create', toplamBildirim: 5, sonImzaReddi: '2026-10-07T09:00:00.000Z' });
      ileri(60_000);
      expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(200);
      expect(d.docs.get(DURUM_A)).toMatchObject({ toplamBildirim: 6, sonBildirim: '2026-10-07T09:01:00.000Z', sonImzaReddi: '2026-10-07T09:00:00.000Z' });
    });
    it('durum yazımı başarısız olsa da yanıt 401 kalır (500 olmaz)', async () => {
      const d = duzenek({ docs });
      const asil = d.C.getAdminDb();
      d.C.getAdminDb = () => ({
        ...asil,
        collection: (c: string) => {
          const k = asil.collection(c);
          return { ...k, doc: (id: string) => (id.endsWith('__durum') ? { ...k.doc(id), set: async () => { throw new Error('pg yok'); } } : k.doc(id)) };
        },
      }) as unknown as AdminDbLike;
      expect((await d.cagir('POST /api/shopify/webhook', yanlis())).kod).toBe(401);
      expect(d.docs.has(DURUM_A)).toBe(false);
      expect(hata).not.toHaveBeenCalled();
      expect(JSON.stringify(uyari.mock.calls)).toContain('imza reddi yazılamadı');
    });
    it('bağlantıyı kaydetmek / kaldırmak kısıtı sıfırlar: yeni sır da yanlışsa İLK ret hemen iz bırakır', async () => {
      const d = duzenek({ docs });
      await d.cagir('POST /api/shopify/webhook', yanlis());
      ileri(60_000);
      // Yönetici sırrı değiştirir (yine yanlış) → durum silinir; bir dakika sonraki ret kısıta takılmadan yazılır.
      await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com', webhookSecret: 'yine-yanlis-sir-0123456789' } });
      expect(d.docs.has(DURUM_A)).toBe(false);
      const yeniSurum = surumu(d.docs);
      expect(yeniSurum).not.toBe('surum-a');
      ileri(60_000);
      await d.cagir('POST /api/shopify/webhook', yanlis());
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: yeniSurum, sonImzaReddi: '2026-10-07T09:02:00.000Z' });
      // Aynı alan adı + boş sır durumu KORUR, kısıtı da sıfırlamaz.
      await d.cagir('POST /api/shopify/baglanti', { body: { shopDomain: 'cetpa.myshopify.com' } });
      ileri(60_000);
      await d.cagir('POST /api/shopify/webhook', yanlis());
      expect(d.docs.get(DURUM_A)).toEqual({ companyId: 'kiraciA', baglantiSurumu: yeniSurum, sonImzaReddi: '2026-10-07T09:02:00.000Z' });
    });
    it('bağlantısı olmayan mağaza (503): veritabanına YAZILMAZ; uyarı günlüğü tek ortak sayaçla kısıtlı', async () => {
      const d = duzenek({ docs });
      const once = new Map(d.docs);
      for (const alan of ['baska.myshopify.com', 'ucuncu.myshopify.com']) expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, alan))).kod).toBe(503);
      expect((await d.cagir('POST /api/shopify/webhook', { ...istek(SIR_A, 'cetpa.myshopify.com'), headers: {} })).kod).toBe(503);
      expect(uyari).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(uyari.mock.calls)).toContain('baska.myshopify.com');
      expect(JSON.stringify(uyari.mock.calls)).not.toContain(SIR_A);
      ileri(RET_IZI_ARALIGI_MS);
      await d.cagir('POST /api/shopify/webhook', { ...istek(SIR_A, 'cetpa.myshopify.com'), headers: {} });
      expect(uyari).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(uyari.mock.calls[1])).toContain('alan adı başlığı yok');
      expect(d.docs).toEqual(once);
    });
  });
  it('doğru imza → kiracısıyla kuyruğa yazılır (sır / tuz işte YOK), sonra 200', async () => {
    const d = duzenek({ docs });
    const r = await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'Cetpa.myshopify.com'));
    expect(r.kod).toBe(200);
    expect(d.gonderilen).toEqual([{
      kuyruk: SHOPIFY_KUYRUGU, secenek: { retryLimit: 8, retryDelay: 60, retryBackoff: true },
      veri: { topic: 'orders/create', body: siparis, cid: 'kiraciA', shopDomain: 'cetpa.myshopify.com', baglantiSurumu: 'surum-a', apiSurumu: '2026-07' },
    }]);
    expect(JSON.stringify(d.gonderilen)).not.toMatch(/whsec_|tuz-a/);
  });
  it('olay kimliği (`X-Shopify-Webhook-Id`) işe girer (100 karakterle sınırlı); başlık yoksa alan HİÇ yazılmaz', async () => {
    const d = duzenek({ docs });
    const kimlikli = istek(SIR_A, 'cetpa.myshopify.com');
    await d.cagir('POST /api/shopify/webhook', { ...kimlikli, headers: { ...kimlikli.headers, 'x-shopify-webhook-id': 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043' } });
    await d.cagir('POST /api/shopify/webhook', { ...kimlikli, headers: { ...kimlikli.headers, 'x-shopify-webhook-id': 'x'.repeat(300) } });
    await d.cagir('POST /api/shopify/webhook', kimlikli);
    expect(d.gonderilen.map(g => g.veri.olayNo)).toEqual(['b54557e4-bdd9-4b37-8a5f-bf7d70bcd043', 'x'.repeat(100), undefined]);
    expect('olayNo' in d.gonderilen[2].veri).toBe(false);
  });
  it('kuyruk yazımı başarısız → 500 (Shopify yeniden dener); 200 dönülmez', async () => {
    const d = duzenek({ docs, kuyruk: 'kirik' });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(500);
  });
  it('kuyruk yoksa istek içinde işlenir: sipariş kiracının dokümanına yazılır', async () => {
    const d = duzenek({ docs, kuyruk: 'yok' });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(200);
    const kimlik = shopifySiparisKimligi({ cid: 'kiraciA', tuz: 'tuz-a' }, '9001');
    expect(d.docs.get(`orders/${kimlik}`)).toMatchObject({ companyId: 'kiraciA', source: 'shopify_webhook', shopifyOrderId: '#1001', totalPrice: 120, paid: true });
  });
  it('aynı alan adı iki kayıtta görünürse (bozuk veri) hiçbiri kullanılmaz → 503', async () => {
    const d = duzenek({ docs: { ...docs, 'shopifyBaglantilari/kiraciC': { ...BAG_B, companyId: 'kiraciC', shopDomain: 'cetpa.myshopify.com' } } });
    expect((await d.cagir('POST /api/shopify/webhook', istek(SIR_A, 'cetpa.myshopify.com'))).kod).toBe(503);
  });
});

describe('shopifyIsiIsle — kuyruk işçisi', () => {
  const is: ShopifyIsi = { topic: 'orders/create', body: { id: 9001, name: '#1001', line_items: [] }, cid: 'kiraciA', shopDomain: 'cetpa.myshopify.com', baglantiSurumu: 'surum-a' };
  it('bağlantı kaldırıldıysa ya da başka mağazaya çevrildiyse olay ATLANIR (eski mağazanın olayı yeni bağlantıya yazılmaz)', async () => {
    const bos = sahteDb();
    expect(await shopifyIsiIsle({ getAdminDb: () => bos.db, pgServerTimestamp: () => 'Z' }, is)).toEqual({ sonuc: 'atlandi', neden: 'baglantiYok' });
    const baska = sahteDb({ 'shopifyBaglantilari/kiraciA': { ...BAG_A, shopDomain: 'yeni.myshopify.com' } });
    expect(await shopifyIsiIsle({ getAdminDb: () => baska.db, pgServerTimestamp: () => 'Z' }, is)).toEqual({ sonuc: 'atlandi', neden: 'baglantiYok' });
    expect([...baska.docs.keys()].some(k => k.startsWith('orders/'))).toBe(false);
  });
  it('bağlantı duruyorsa tuzu bağlantıdan alıp yazar', async () => {
    const d = sahteDb({ 'shopifyBaglantilari/kiraciA': BAG_A });
    const r = await shopifyIsiIsle({ getAdminDb: () => d.db, pgServerTimestamp: () => 'Z' }, is);
    expect(r).toMatchObject({ sonuc: 'yazildi', docId: shopifySiparisKimligi({ cid: 'kiraciA', tuz: 'tuz-a' }, '9001') });
    expect(d.docs.get(DURUM_A)).toMatchObject({ baglantiSurumu: 'surum-a', toplamBildirim: 1, sonSonuc: 'olusturuldu' });
  });
  it('işteki olay kimliği işleyiciye geçer: yazım düşerse hata izi o kimliği taşır (yeniden deneme aynı işi, yani aynı kimliği getirir)', async () => {
    const d = sahteDb({ 'shopifyBaglantilari/kiraciA': BAG_A });
    const kimlik = shopifySiparisKimligi({ cid: 'kiraciA', tuz: 'tuz-a' }, '9001');
    // Sipariş dokümanı BAŞKA kiracıya etiketli → işleyici fırlatır ve hatayı durum dokümanına yazar.
    d.docs.set(`orders/${kimlik}`, { companyId: 'baskaKiraci' });
    await expect(shopifyIsiIsle({ getAdminDb: () => d.db, pgServerTimestamp: () => 'Z' }, { ...is, olayNo: 'wh-77' })).rejects.toThrow(/başka kiracıya ait/);
    expect(d.docs.get(DURUM_A)).toMatchObject({ sonSonuc: 'hata', sonHataOlay: kimlik, sonHataOlayNo: 'wh-77' });
    // Kimliksiz işte alan null yazılır (uydurma kimlik yok).
    await expect(shopifyIsiIsle({ getAdminDb: () => d.db, pgServerTimestamp: () => 'Z' }, is)).rejects.toThrow();
    expect(d.docs.get(DURUM_A)).toMatchObject({ sonHataOlayNo: null });
  });
  it('işteki sürüm kayıttakini TUTMUYORSA (eksik / boş dâhil) sipariş yazılır, durum dokümanına dokunulmaz', async () => {
    for (const baglantiSurumu of ['surum-eski', '', null]) {
      const d = sahteDb({ 'shopifyBaglantilari/kiraciA': BAG_A });
      expect(await shopifyIsiIsle({ getAdminDb: () => d.db, pgServerTimestamp: () => 'Z' }, { ...is, baglantiSurumu })).toMatchObject({ sonuc: 'yazildi' });
      expect([...d.docs.keys()].sort()).toEqual([`orders/${shopifySiparisKimligi({ cid: 'kiraciA', tuz: 'tuz-a' }, '9001')}`, 'shopifyBaglantilari/kiraciA']);
    }
    // Sürümsüz kayıt + sürümsüz iş (eski kayıt, eski iş) eşleşir: durum yazılır, damga konmaz.
    const { baglantiSurumu: _surum, ...surumsuz } = BAG_A;
    const eski = sahteDb({ 'shopifyBaglantilari/kiraciA': surumsuz });
    await shopifyIsiIsle({ getAdminDb: () => eski.db, pgServerTimestamp: () => 'Z' }, { ...is, baglantiSurumu: null });
    expect(eski.docs.get(DURUM_A)).toMatchObject({ toplamBildirim: 1 });
    expect(eski.docs.get(DURUM_A)).not.toHaveProperty('baglantiSurumu');
  });
});

describe('kapılar rota satırında (kaynak çiti)', () => {
  const DOSYA = join(SRC, 'server', 'routes', 'shopifyRoutes.ts');
  const satir = (desen: RegExp) => kodSatirlari(DOSYA).filter(({ kod }) => desen.test(kod));
  it('GET: kimlik + iç personel + orders okuma; yazma uçları: kimlik + MFA + yalnızYönetici; webhook kimliksiz', () => {
    expect(satir(/app\.get\('\/api\/shopify\/baglanti', C\.requireAuth, C\.requireStaff, C\.requireCollectionAccess\('orders', 'read'\),/)).toHaveLength(1);
    expect(satir(/app\.post\('\/api\/shopify\/baglanti(\/kaldir)?', C\.requireAuth, C\.requireMfaVerified, async/)).toHaveLength(2);
    expect(satir(/if \(!\(await yalnizYonetici\(req, res\)\)\) return;/)).toHaveLength(2);
    expect(satir(/SHOPIFY_WEBHOOK_SECRET/)).toHaveLength(0);
  });
});
