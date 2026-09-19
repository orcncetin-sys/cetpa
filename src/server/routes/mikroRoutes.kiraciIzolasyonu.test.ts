/**
 * mikroRoutes.kiraciIzolasyonu.test.ts — Faz 3 3/n kapanışında bulunan ÜÇ kiracı izolasyonu açığı
 * (2026-09-19). Üçü de ÖNCEDEN vardı (2026-08-12'de 8 uçta kapatılan sınıfın kaçan üyeleri); canlıda tek kiracı
 * olduğu için bugün sızıntı yok, 2. müşteriyle birlikte veri bozulması olurdu.
 *
 *  1. POST /api/mikro/pull/bakiye      — `leads` TÜM kiracılardan çekiliyor, her eşleşene koşulsuz `bakiye` yazılıyordu.
 *  2. POST /api/mikro/stok/listesi     — `inventory.where('sku','==',sku).limit(1)`: ilk eşleşen BAŞKA kiracının
 *                                        ürünü olabilir; ona `stockLevel` yazılıyordu.
 *  3. POST /api/mikro/gelen-fatura/kabul|ret — istemciden gelen `firebaseId` doğrulanmadan o dokümana çağıranın
 *                                        `companyId`'si DAMGALANIYORDU (başka kiracının faturasını sahiplenme).
 *
 * Desen (CLAUDE.md): `const dc = veri.companyId || ''; if (dc && dc !== companyId) continue;` — yabancı kiracı
 * atlanır, etiketsiz (companyId'siz) eski kayıt hâlâ eşleşir/onarılır.
 *
 * vi.mock blokları burada KALMAK ZORUNDA (vitest hoisting) — tarif: `mikroRoutes.testDuzenegi.ts` `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => { d = duzenekKur(); vi.mocked(mikroPost).mockReset(); });   // varsayılan çağıran: companyId 'A'; modül mock'unun çağrı sayacı testler arası SIFIRLANIR
afterEach(() => { vi.restoreAllMocks(); });

const yanitla = (metotlar: Record<string, unknown>) => {
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => {
    if (metot in metotlar) return { ok: true, status: 200, data: { result: [{ Data: metotlar[metot] }] } };
    return { ok: false, status: 500, data: null };
  }) as unknown as typeof mikroPost);
};

describe('POST /api/mikro/pull/bakiye — yabancı kiracının lead\'ine bakiye YAZILMAZ', () => {
  it('aynı cari koduna sahip B kiracısının lead\'i atlanır; A ve etiketsiz eski kayıt yazılır (mutasyon-ayırt-edici)', async () => {
    d.snapAyarla('leads', {
      'L-A':    { name: 'Şirin İnşaat',  mikroCariKod: '120.01.001', companyId: 'A' },
      'L-B':    { name: 'Başka Firma',   mikroCariKod: '120.01.001', companyId: 'B' },
      'L-eski': { name: 'Çelik Yapı',    mikroCariKod: '120.01.002' },                 // etiketsiz eski kayıt
    });
    yanitla({ SqlVeriOkuV2: { SQLResult1: [{ cha_kod: '120.01.001', bakiye: 15000 }, { cha_kod: '120.01.002', bakiye: -4200 }] } });

    const res = await d.cagir('POST', '/api/mikro/pull/bakiye', {});
    expect((res.govde as Record<string, unknown>).success).toBe(true);

    const yazilanLeadler = d.koleksiyon('leads').map(y => y.ref.id).sort();
    expect(yazilanLeadler).toEqual(['L-A', 'L-eski']);
    expect(d.koleksiyon('leads').find(y => y.ref.id === 'L-A')?.data).toEqual({ bakiye: 15000 });
  });
});

describe('POST /api/mikro/stok/listesi — eşleşme çağıranın kiracısında aranır', () => {
  it('aynı SKU B kiracısında da varsa (ve sorguda ÖNCE geliyorsa) B\'nin ürününe DOKUNULMAZ (mutasyon-ayırt-edici)', async () => {
    d.snapAyarla('inventory', {
      'I-B': { sku: 'CIMENTO-50KG', name: 'Çimento (B)', stockLevel: 7, companyId: 'B' },
      'I-A': { sku: 'CIMENTO-50KG', name: 'ÇİMENTO 50KG', stockLevel: 10, companyId: 'A' },
    });
    yanitla({ StokListesiV2: { StokListesi: [{ sto_kod: 'CIMENTO-50KG', sto_isim: 'ÇİMENTO 50KG' }] } });

    await d.cagir('POST', '/api/mikro/stok/listesi', {});

    const idler = d.koleksiyon('inventory').map(y => y.ref.id);
    expect(idler).toEqual(['I-A']);
    expect(d.koleksiyon('inventory')[0].data).toMatchObject({ mikroStoKod: 'CIMENTO-50KG', mikroSynced: true });
  });

  it('etiketsiz eski ürün hâlâ eşleşir (self-heal deseni)', async () => {
    d.snapAyarla('inventory', { 'I-eski': { sku: 'KUM-0-3', name: 'Kum', stockLevel: 3 } });
    yanitla({ StokListesiV2: { StokListesi: [{ sto_kod: 'KUM-0-3' }] } });
    await d.cagir('POST', '/api/mikro/stok/listesi', {});
    expect(d.koleksiyon('inventory').map(y => y.ref.id)).toEqual(['I-eski']);
  });
});

describe('POST /api/mikro/gelen-fatura/kabul|ret — firebaseId sahipliği Mikro çağrısından ÖNCE doğrulanır', () => {
  for (const uc of ['kabul', 'ret'] as const) {
    it(`${uc}: başka kiracının fatura dokümanı → 404, GİB'e hiçbir şey gitmez, dokümana damga basılmaz (mutasyon-ayırt-edici)`, async () => {
      d.snapAyarla('mikroFaturalar', { 'F-B': { evrakNo: 'GIB-1', companyId: 'B' } });
      yanitla({ GelenFaturalarKabulV2: {}, GelenFaturalarRedV2: {} });

      const res = await d.cagir('POST', `/api/mikro/gelen-fatura/${uc}`, { faturaGuid: 'guid-1', firebaseId: 'F-B', aciklama: 'Hatalı tutar' });

      expect(res.kod).toBe(404);
      expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
      expect(d.koleksiyon('mikroFaturalar')).toEqual([]);
    });

    it(`${uc}: var olmayan doküman id'si → 404 (eski kod {companyId, gibDurumu} ile ÇÖP doküman yaratıyordu)`, async () => {
      yanitla({ GelenFaturalarKabulV2: {}, GelenFaturalarRedV2: {} });
      const res = await d.cagir('POST', `/api/mikro/gelen-fatura/${uc}`, { faturaGuid: 'guid-1', firebaseId: 'yok-boyle-bir-id', aciklama: 'x' });
      expect(res.kod).toBe(404);
      expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
    });

    it(`${uc}: kendi (ya da etiketsiz) dokümanı → Mikro çağrılır ve damga basılır; firebaseId'siz çağrı da çalışır`, async () => {
      d.snapAyarla('mikroFaturalar', { 'F-A': { evrakNo: 'GIB-2', companyId: 'A' }, 'F-eski': { evrakNo: 'GIB-3' } });
      yanitla({ GelenFaturalarKabulV2: {}, GelenFaturalarRedV2: {} });

      await d.cagir('POST', `/api/mikro/gelen-fatura/${uc}`, { faturaGuid: 'guid-2', firebaseId: 'F-A', aciklama: 'x' });
      await d.cagir('POST', `/api/mikro/gelen-fatura/${uc}`, { faturaGuid: 'guid-3', firebaseId: 'F-eski', aciklama: 'x' });
      const r3 = await d.cagir('POST', `/api/mikro/gelen-fatura/${uc}`, { faturaGuid: 'guid-4', aciklama: 'x' });

      expect(vi.mocked(mikroPost)).toHaveBeenCalledTimes(3);
      expect(d.koleksiyon('mikroFaturalar').map(y => y.ref.id)).toEqual(['F-A', 'F-eski']);
      expect(d.koleksiyon('mikroFaturalar')[0].data).toMatchObject({ companyId: 'A', gibDurumu: uc });
      expect((r3.govde as Record<string, unknown>).success).toBe(true);
    });
  }
});

describe('Mikro\'ya YAZAN rotalar — istemciden gelen firebaseId başka kiracınınsa Mikro\'ya GİDİLMEZ', () => {
  const FATURA = { order: { mikroCariKod: '120.01.001', lineItems: [{ sku: 'CIMENTO-50KG', name: 'ÇİMENTO 50KG', price: 180, quantity: 10 }], kdvOran: 20 } };
  const IRSALIYE = { shipment: { mikroCariKod: '120.01.001', items: [{ sku: 'CIMENTO-50KG', name: 'ÇİMENTO 50KG', quantity: 10, price: 180 }], kdvOran: 20, depoNo: 2 } };

  it('fatura/kaydet + siparis/kaydet: yabancı `orders` dokümanı → 404, mikroPost çağrılmaz, damga basılmaz', async () => {
    d.snapAyarla('orders', { 'O-B': { customerName: 'Başka Firma', companyId: 'B' } });
    const f = await d.cagir('POST', '/api/mikro/fatura/kaydet', { ...FATURA, firebaseId: 'O-B' });
    const s = await d.cagir('POST', '/api/mikro/siparis/kaydet', { order: { mikroCariKod: '120.01.001' }, firebaseId: 'O-B' });
    expect([f.kod, s.kod]).toEqual([404, 404]);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
    expect(d.koleksiyon('orders')).toEqual([]);
  });

  it('irsaliye/kaydet: yabancı `shipments` dokümanı → 404; faturasız sevkiyat → 400 — ikisinde de mikroPost çağrılmaz', async () => {
    d.snapAyarla('shipments', { 'S-B': { irsaliyeNo: 'IRS-1', companyId: 'B' } });
    const yabanci = await d.cagir('POST', '/api/mikro/irsaliye/kaydet', { ...IRSALIYE, firebaseId: 'S-B' });
    const faturasiz = await d.cagir('POST', '/api/mikro/irsaliye/kaydet', { shipment: { ...IRSALIYE.shipment, faturali: false }, firebaseId: 'yeni-sevkiyat' });
    expect(yabanci.kod).toBe(404);
    expect(faturasiz.kod).toBe(400);
    expect((faturasiz.govde as Record<string, unknown>).error).toMatch(/Faturasız/);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
  });

  it('cari/kaydet: `collection` ÇALIŞMA ANINDA beyaz listeden — istemci `settings` gönderse de yazım `leads`e gider (mutasyon-ayırt-edici)', async () => {
    d.snapAyarla('settings', { mikroConfig: { gizli: true } });
    d.snapAyarla('leads', { 'L-A': { name: 'Şirin İnşaat', companyId: 'A' } });
    yanitla({ CariKaydetV2: {} });
    await d.cagir('POST', '/api/mikro/cari/kaydet', {
      lead: { name: 'Şirin İnşaat', company: 'ŞİRİN İNŞAAT LTD. ŞTİ.', mikroCariKod: '120.01.001' }, firebaseId: 'mikroConfig', collection: 'settings',
    });
    expect(d.koleksiyon('settings')).toEqual([]);
  });
});

describe('Mikro REDDİ (IsError, HTTP 200) — yanıt `error` alanını TAŞIR', () => {
  // 2026-09-19 son parti incelemesi: irsaliye rotası redde `{ success:false }` dönüyor, `error` alanı YOKTU;
  // istemcideki Shipped toast'ı `d.error` şartına takılıp Mikro'nun reddini SESSİZ geçiyordu.
  it('irsaliye/kaydet: Mikro reddederse success:false + error dolu (mutasyon-ayırt-edici)', async () => {
    const { mikroVergiOranlari } = await import('../mikroClient.js');
    vi.mocked(mikroVergiOranlari).mockResolvedValue(new Map([[4, 20]]));
    vi.mocked(mikroPost).mockImplementation((async () => ({
      ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'Stok kodu bulunamadı: CIMENTO-50KG' }] },
    })) as unknown as typeof mikroPost);

    const res = await d.cagir('POST', '/api/mikro/irsaliye/kaydet', {
      shipment: { mikroCariKod: '120.01.001', items: [{ sku: 'CIMENTO-50KG', name: 'ÇİMENTO 50KG', quantity: 10, price: 180 }], kdvOran: 20, depoNo: 2 },
      firebaseId: 'yeni-sevkiyat',
    });
    const g = res.govde as Record<string, unknown>;
    expect(vi.mocked(mikroPost)).toHaveBeenCalledTimes(1);
    expect(g.success).toBe(false);
    expect(g.error).toBe('Stok kodu bulunamadı: CIMENTO-50KG');
  });
});
