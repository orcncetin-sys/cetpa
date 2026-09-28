/**
 * reportsRoutes.stokFiyat.test.ts — /api/reports/stok-fiyat-karsilastirma yanıt SÖZLEŞMESİ (D3, 2026-09-26).
 *
 * Kullanıcı: "net tutar iskontolu halde göstermeli". Mikro kaydı KENDİ İÇİNDE TUTARSIZ olan alışlar (evrak 420/435:
 * iskonto brüte bir kez daha eklenmiş) Fiyat Karşılaştırma ekranında "Mikro'da düzeltilecek" listesi olarak görünür.
 * Liste ve ürün başına sayaç SUNUCUDAN gelir (birim sapması kalıbıyla birebir):
 *   • `tutarsizliklar`: lib `mikroTutarsizliklari` satırları + envanter adı (yoksa SKU) — fazlası büyükten küçüğe;
 *   • `rows[].tutarsizlikSayisi`: değerlendirilen üründe listede yoksa 0, değerlendirilemeyen üründe `null` (bilinmiyor
 *     — 0 DEĞİL);
 *   • hareketler İKİ KEZ çözülmez: özet, sapma ve tutarsızlık AYNI `netCozumleri` sonucunu paylaşır.
 * Detay ucu (`/:sku/detay`) `stokFiyatDetay`'ı olduğu gibi döndürür — `mikroTutar` (Mikro'daki ham sth_tutar) yalnız
 * tutarsız satırda yanıta geçer.
 * Kalıp: trackingRoutes.test.ts (sahte Express, handler yakalama). Ağ/DB YOK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/stokFiyat.js', async (orig) => {
  const gercek = await orig<typeof import('../../lib/stokFiyat.js')>();
  return {
    ...gercek,
    netCozumleri: vi.fn(gercek.netCozumleri),
    mikroTutarsizliklari: vi.fn(gercek.mikroTutarsizliklari),
    birimSapmalari: vi.fn(gercek.birimSapmalari),
  };
});

import { reportsRoutes, type ReportsRouteCtx } from './reportsRoutes';
import * as stokFiyat from '../../lib/stokFiyat.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function sahteApp() {
  const handlers: Record<string, Handler> = {};
  const kaydet = (yol: string, ...mw: unknown[]) => { handlers[yol] = mw[mw.length - 1] as Handler; };
  return { handlers, get: kaydet, post: kaydet, put: kaydet, patch: kaydet, delete: kaydet };
}
const gecir = (_r: unknown, _s: unknown, next: () => void) => next();

// ── Fikstürler (lib/stokFiyat.test.ts ile AYNI evrak 420/435 değerleri — şartname D7) ─────────────────────────
// Tedarikçi e-faturası: 1.050 × 270 = 283.500 BRÜT, iskonto 114.817,50, NET 168.682,50, KDV %20 = 33.736,50.
// Mikro: sth_tutar 398.317,50 (= brüt + Σiskonto), başlık cha_meblag 317.236,50.
const E420 = {
  sth_stok_kod: 'RULO1081', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 420, sth_tarih: '2026-08-31',
  sth_miktar: 1050, sth_tutar: 398317.5, sth_iskonto1: 85050, sth_iskonto2: 29767.5, sth_vergi: 33736.5, sth_vergi_pntr: 4,
};
const B420 = { cha_evrakno_seri: '', cha_evrakno_sira: 420, cha_tip: 1, cha_meblag: 317236.5 };
const E435 = {
  sth_stok_kod: 'RULO1081', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 435,
  sth_miktar: 2, sth_tutar: 758.7, sth_iskonto1: 162, sth_iskonto2: 56.7, sth_vergi: 64.26, sth_vergi_pntr: 4,
};
const B435 = { cha_evrakno_seri: '', cha_evrakno_sira: 435, cha_tip: 1, cha_meblag: 604.26 };
// RULO1081'in TUTARLI (iskontosuz) bir alışı — detayda `mikroTutar` TAŞIMAMALI.
const E600 = {
  sth_stok_kod: 'RULO1081', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 600, sth_tarih: '2026-09-01',
  sth_miktar: 10, sth_tutar: 2700, sth_vergi: 540, sth_vergi_pntr: 4,
};
// Envanterde OLMAYAN ürünün tutarsız alışı: e-fatura brüt 1.000, iskonto 300, net 700, KDV %20 = 140; Mikro sth_tutar
// 1.300 (= brüt + Σisk), başlık 1.140 (= Mikro neti 1.000 + 140). Mikro okuması 1.000 hiçbir oranda 140 vermez.
const E421 = {
  sth_stok_kod: 'ADSIZ-1', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 421, sth_tarih: '2026-08-30',
  sth_miktar: 10, sth_tutar: 1300, sth_iskonto1: 300, sth_vergi: 140, sth_vergi_pntr: 4,
};
const B421 = { cha_evrakno_seri: '', cha_evrakno_sira: 421, cha_tip: 1, cha_meblag: 1140 };
// Temiz ürün: iskontolu ama KDV'si Mikro okumasına oturuyor (900 × %20 = 180) → değerlendirilmiş, tutarsız satırı YOK.
const TEMIZ = { sth_stok_kod: 'CIM-50', sth_tip: 0, sth_evraktip: 3, sth_evrakno_seri: '', sth_evrakno_sira: 500, sth_tarih: '2026-08-31', sth_miktar: 10, sth_tutar: 1000, sth_iskonto1: 100, sth_vergi: 180, sth_vergi_pntr: 4 };
// Değerlendirilemeyen ürün: iskontolu, KDV'si yok → çift iskonto sağlanamaz (bilinmiyor, 0 DEĞİL).
const KDVSIZ = { ...TEMIZ, sth_stok_kod: 'KDVSIZ', sth_evrakno_sira: 14, sth_vergi: 0 };
const B14 = { cha_evrakno_seri: '', cha_evrakno_sira: 14, cha_tip: 1, cha_meblag: 900 };

// Tur 2 (2026-09-28): ADSIZ-1'in BAŞKA faturası (422, başlıksız) imzalı ama onaysız → hüküm verilemez; 421 bulgusu kesin.
const E422 = { ...E421, sth_evrakno_sira: 422, sth_miktar: 10, sth_tutar: 2300, sth_iskonto1: 300, sth_iskonto2: 0, sth_vergi: 340, sth_vergi_pntr: 4 };
const HAREKETLER = [E435, TEMIZ, E600, E421, KDVSIZ, E420, E422];
const ENVANTER = [
  { sku: 'RULO1081', name: 'Rulo 1081', stockLevel: 40 },
  { sku: 'CIM-50', name: 'Çimento 50 kg', stockLevel: 7 },
  { sku: 'KDVSIZ', name: 'KDV\'siz ürün', stockLevel: 1 },
];
const BASLIKLAR = [B420, B435, B421, B14];

async function calistir(yol: string, params: Record<string, string> = {}) {
  const app = sahteApp();
  const C: ReportsRouteCtx = {
    getAdminDb: () => ({}) as ReturnType<ReportsRouteCtx['getAdminDb']>,
    requireAuth: gecir,
    getUserCompanyId: async () => 'cid-1',
    loadCompanyDocs: async (coll: string) =>
      coll === 'inventoryMovements' ? HAREKETLER : coll === 'inventory' ? ENVANTER : coll === 'mikroFaturalar' ? BASLIKLAR : [],
    requireCollectionAccess: () => gecir,
  };
  reportsRoutes(app as unknown as Parameters<typeof reportsRoutes>[0], C);
  let govde: unknown = null; let kod = 200;
  const res = { json: (b: unknown) => { govde = b; return res; }, status: (n: number) => { kod = n; return res; } };
  await app.handlers[yol]({ params, uid: 'u1' }, res);
  return { govde: govde as Record<string, unknown>, kod };
}

type Satir = Record<string, unknown>;

beforeEach(() => { vi.mocked(stokFiyat.netCozumleri).mockClear(); vi.mocked(stokFiyat.mikroTutarsizliklari).mockClear(); vi.mocked(stokFiyat.birimSapmalari).mockClear(); });

describe("GET /api/reports/stok-fiyat-karsilastirma — \"Mikro'da düzeltilecek\" tutarsızlık listesi (D3)", () => {
  it('evrak 420: yanıtta `tutarsizliklar` — gerçek net KDV\'den (iskontolu), Mikro tutarı ve fazlası; envanter adıyla', async () => {
    const { govde, kod } = await calistir('/api/reports/stok-fiyat-karsilastirma');
    expect(kod).toBe(200);
    expect(govde.success).toBe(true);
    const t = govde.tutarsizliklar as Satir[];
    expect(Array.isArray(t)).toBe(true);
    const r420 = t.find(x => x.evrakNo === '420') as Satir;
    expect(r420).toMatchObject({
      sku: 'RULO1081', ad: 'Rulo 1081', tarih: '2026-08-31', yon: 'alis', miktar: 1050, oran: 20,
      fatura: { seri: '', sira: '420', yon: 'gelen' },
    });
    expect(r420.mikroTutar as number).toBeCloseTo(398317.5, 2);   // Mikro sth_tutar
    expect(r420.iskonto as number).toBeCloseTo(114817.5, 2);
    expect(r420.kdv as number).toBeCloseTo(33736.5, 2);
    expect(r420.net as number).toBeCloseTo(168682.5, 2);          // DOĞRU net = e-faturanın neti (iskontolu)
    expect(r420.mikroNet as number).toBeCloseTo(283500, 2);       // Mikro'nun okuduğu = e-faturanın brütü
    expect(r420.fazla as number).toBeCloseTo(114817.5, 2);        // Mikro'nun fazladan eklediği
    // Sağlama: net + KDV = e-fatura toplamı 202.419; Mikro toplamı 317.236,50 − fazla.
    expect((r420.net as number) + (r420.kdv as number)).toBeCloseTo(202419, 2);
    expect((r420.mikroNet as number) + (r420.kdv as number) - (r420.fazla as number)).toBeCloseTo(202419, 2);
  });

  it('liste YALNIZ tutarsız satırları içerir, fazlası büyükten küçüğe; envanterde olmayan ürünün adı SKU\'dur', async () => {
    const { govde } = await calistir('/api/reports/stok-fiyat-karsilastirma');
    const t = govde.tutarsizliklar as Satir[];
    expect(t.map(x => x.evrakNo)).toEqual(['420', '421', '435']);   // 114.817,50 > 300 > 218,70
    expect(t.find(x => x.evrakNo === '421')).toMatchObject({ sku: 'ADSIZ-1', ad: 'ADSIZ-1' });
    expect((t.find(x => x.evrakNo === '421') as Satir).fazla as number).toBeCloseTo(300, 2);
    expect(t.find(x => x.evrakNo === '435')).toMatchObject({ sku: 'RULO1081', ad: 'Rulo 1081', tarih: null });
  });

  it('ürün başına sayaç: tutarsız ürün N, değerlendirilmiş temiz ürün 0, değerlendirilemeyen ürün null (0 DEĞİL)', async () => {
    const { govde } = await calistir('/api/reports/stok-fiyat-karsilastirma');
    const rows = govde.rows as Satir[];
    const say = (sku: string) => rows.find(r => r.sku === sku);
    expect(say('RULO1081')).toMatchObject({ ad: 'Rulo 1081', tutarsizlikSayisi: 2 });   // 420 + 435 (600 temiz)
    expect(say('ADSIZ-1')).toMatchObject({ ad: 'ADSIZ-1', tutarsizlikSayisi: 1, tutarsizlikEnAz: true });   // 422 belirsiz → "en az 1"
    expect(say('RULO1081')).toMatchObject({ tutarsizlikEnAz: false });
    expect(say('CIM-50')).toMatchObject({ tutarsizlikSayisi: 0 });
    expect(say('KDVSIZ')).toBeDefined();
    expect(say('KDVSIZ')?.tutarsizlikSayisi).toBeNull();
    // Sapma sayacı ve mevcut alanlar bozulmadı.
    for (const r of rows) expect(r).toHaveProperty('sapmaSayisi');
    expect(govde).toMatchObject({ toplamSku: rows.length });
    expect(Array.isArray(govde.sapmalar)).toBe(true);
    expect(govde).toHaveProperty('iskontoKolonlari');
    expect((govde.netKaynaklari as Record<string, number>).mikroKaydiTutarsiz).toBe(3);
  });

  it('özet satırı iskontolu neti kullanır: RULO1081 alış ortalaması 420/435 için KDV\'den gelen net', async () => {
    const { govde } = await calistir('/api/reports/stok-fiyat-karsilastirma');
    const r = (govde.rows as Satir[]).find(x => x.sku === 'RULO1081') as Satir;
    // 168.682,50 + 321,30 + 2.700 = 171.703,80 / 1.062 adet (brüt 283.500 + 540 + 2.700 DEĞİL).
    expect(r.alisTutar as number).toBeCloseTo(171703.8, 2);
  });

  it('hareketler İKİ KEZ çözülmez: tek netCozumleri; sapma ve tutarsızlık AYNI çözümü alır', async () => {
    await calistir('/api/reports/stok-fiyat-karsilastirma');
    const nc = vi.mocked(stokFiyat.netCozumleri);
    expect(nc).toHaveBeenCalledTimes(1);
    const cozum = nc.mock.results[0].value;
    const mt = vi.mocked(stokFiyat.mikroTutarsizliklari);
    expect(mt).toHaveBeenCalledTimes(1);
    expect(mt.mock.calls[0][0]).toBe(HAREKETLER);
    expect(mt.mock.calls[0][2]).toBe(cozum);
    expect(vi.mocked(stokFiyat.birimSapmalari).mock.calls[0][2]).toBe(cozum);
  });
});

describe('GET /api/reports/stok-fiyat-karsilastirma/:sku/detay — `mikroTutar` yanıta geçer (D4)', () => {
  it('420 ve 435: mikroTutar = Mikro sth_tutar; net iskontolu; tutarlı satır (600) alanı HİÇ taşımaz', async () => {
    const { govde, kod } = await calistir('/api/reports/stok-fiyat-karsilastirma/:sku/detay', { sku: 'RULO1081' });
    expect(kod).toBe(200);
    expect(govde).toMatchObject({ success: true, sku: 'RULO1081', toplam: 3 });
    const s = govde.satirlar as Satir[];
    const r420 = s.find(x => x.evrakNo === '420') as Satir;
    expect(r420).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', mikroTutar: 398317.5, brutTutar: 283500 });
    expect(r420.tutar as number).toBeCloseTo(168682.5, 2);
    expect(r420.birimFiyat as number).toBeCloseTo(160.65, 6);
    expect(s.find(x => x.evrakNo === '435')).toMatchObject({ kaynak: 'mikroKaydiTutarsiz', mikroTutar: 758.7 });
    const r600 = s.find(x => x.evrakNo === '600') as Satir;
    expect(r600.kaynak).not.toBe('mikroKaydiTutarsiz');
    expect('mikroTutar' in r600).toBe(false);
  });
});
