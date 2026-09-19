/**
 * mikroRoutes.govdeStokCari.test.ts — `/api/mikro/stok/kaydet` ve `/api/mikro/cari/kaydet`
 * rotalarının gövde modülüne BAĞLANMASI (Faz 3 3/n, grup "govdeStokCari", 2026-09-19).
 *
 * Modül testi (`src/server/mikro/govdeStokCari.test.ts`, 29 test) gövdenin İÇERİĞİNİ
 * kilitler. Burada kilitlenen şey ROTA SÖZLEŞMESİ:
 *   1) Gövde kurulamazsa **mikroPost HİÇ çağrılmaz** ve yanıt **400** olur — 500 değil.
 *      (500, istemcide "sunucu bozuk, tekrar dene" anlamına gelir; burada bozuk olan
 *       ÜRÜN KARTIDIR ve kullanıcı alanı doldurmadan tekrar denemenin anlamı yok.)
 *   2) Başarısız denemenin `writeSyncLog` kaydı yine de düşer (400'den ÖNCE).
 *   3) Gövde kurulamadığında Firestore'a mikroSynced/mikroStoKod damgası YAZILMAZ.
 *   4) Bilinen girdide mikroPost ESKİ gövdeyle çağrılır (parite) — `{ stoklar: [...] }` /
 *      `{ cariler: [...] }` zarfı ve `inMikro=true` bayrağı dahil.
 *
 * ⚠️ `mikroVergiOranlari` sahtesi BOŞ MAP döner (düz `{}` DEĞİL — 2026-09-19 hakem
 * bulgusu: gerçek fonksiyon ağ hatasında da Map döndürür, `{}` ise kardeş gövdelerde
 * `for (… of tablo)` üstünde TypeError → 500 üretiyordu). "Tablo okunamadı" vakası
 * boş Map'le test edilir; başarılı push testleri dolu Map ile ezer (`vergiTablosuAyarla`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroVergiOranlari } from '../mikroClient.js';
import { mirrorMikroStoklar, mirrorMikroCariler } from '../mikroMirror.js';

// ── mikroMockTarifi (mikroRoutes.testDuzenegi.ts) — vitest hoisting yüzünden BURADA olmalı
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
    // Map — düz nesne DEĞİL: gerçek fonksiyon ağ hatasında da BOŞ MAP döner
    // (mikroClient.ts). `{}` fatura/sipariş gövdelerinde TypeError → 500 üretiyordu.
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mirrorMikroStoklar).mockClear();
  vi.mocked(mirrorMikroCariler).mockClear();
  vergiTablosuAyarla(new Map([[1, 0], [2, 1], [3, 10], [4, 20]]));
});

/** Müşterinin gerçek VergiListesiV2 tablosu (2026-07-31 canlı bulgusu). */
function vergiTablosuAyarla(tablo: Map<number, number>) {
  vi.mocked(mikroVergiOranlari).mockImplementation((async () => tablo) as typeof mikroVergiOranlari);
}

/** Mikro'nun BAŞARILI zarfı: `result[0]` var ve `IsError` yok (rota bunu şart koşuyor). */
const basariliYanit = () =>
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ IsError: false }] } })) as unknown as typeof mikroPost);

const CIMENTO = {
  sku: 'CIM-50',
  name: 'ÇİMENTO 50KG PORTLAND CEM I 42,5R',
  unit: 'ADET',
  vatRate: 20,
  prices: { 'Retail': 189.9, 'B2B Standard': 172.5, 'B2B Premium': 165, 'Dealer': 158.25 },
};
const fiyatSatiri = (listeSiraNo: number, fiyat: number) => ({
  sfiyat_listesirano: listeSiraNo, sfiyat_deposirano: 1, sfiyat_odemeplan: 0,
  sfiyat_birim_pntr: 1, sfiyat_fiyati: fiyat, sfiyat_doviz: 0,
});

// ── /api/mikro/stok/kaydet ───────────────────────────────────────────────────

describe('POST /api/mikro/stok/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('birimi bilinmeyen ürün: 400 + Türkçe alan adı; mikroPost ÇAĞRILMAZ; inventory damgalanmaz', async () => {
    basariliYanit();   // mikroPost başarılı olsa BİLE çağrılmamalı
    const { unit: _atilan, ...birimsiz } = CIMENTO;
    const res = await d.cagir('POST', '/api/mikro/stok/kaydet', { item: birimsiz, firebaseId: 'inv1' });

    expect(res.kod).toBe(400);
    expect(res.govde).toMatchObject({ success: false });
    expect(String((res.govde as { error?: string }).error)).toContain('birim bilinmiyor');
    expect(mikroPost, 'gövde kurulamadan Mikro defterine yazılmamalı').not.toHaveBeenCalled();
    expect(d.koleksiyon('inventory')).toEqual([]);
    expect(mirrorMikroStoklar).not.toHaveBeenCalled();
  });

  it("SKU'su olmayan ürün: 400 — `STK<zaman damgası>` kodlu bulunamaz kart AÇILMAZ", async () => {
    basariliYanit();
    const { sku: _atilan, ...skusuz } = CIMENTO;
    const res = await d.cagir('POST', '/api/mikro/stok/kaydet', { item: skusuz, firebaseId: 'inv1' });
    expect(res.kod).toBe(400);
    expect(String((res.govde as { error?: string }).error)).toContain('stok kodu (SKU)');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('hiçbir fiyat kademesi bilinmiyorsa 400 — fiyatsız stok kartı açılmaz', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/stok/kaydet', { item: { ...CIMENTO, prices: {} }, firebaseId: 'inv1' });
    expect(res.kod).toBe(400);
    expect(String((res.govde as { error?: string }).error)).toContain('satış fiyatı');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('Mikro vergi tablosu okunamadıysa 400 — sabit işaretçi (eski `20`) UYDURULMAZ', async () => {
    basariliYanit();
    vergiTablosuAyarla(new Map());   // VergiListesiV2 ağ hatası → boş Map
    const res = await d.cagir('POST', '/api/mikro/stok/kaydet', { item: CIMENTO, firebaseId: 'inv1' });
    expect(res.kod).toBe(400);
    expect(String((res.govde as { error?: string }).error)).toContain('vergi işaretçisi');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('başarısız denemenin writeSyncLog kaydı 400’den ÖNCE düşer (deneme izi kaybolmaz)', async () => {
    basariliYanit();
    const { unit: _atilan, ...birimsiz } = CIMENTO;
    await d.cagir('POST', '/api/mikro/stok/kaydet', { item: birimsiz, firebaseId: 'inv1' });
    expect(d.syncLog).toHaveBeenCalledWith(
      'StokKaydetV2', 'inventory', 'inv1', false, null,
      expect.stringContaining('birim bilinmiyor'), expect.any(Number), expect.anything(),
    );
  });
});

describe('POST /api/mikro/stok/kaydet — bilinen ürün: eski gövdeyle BİREBİR', () => {
  it('mikroPost(StokKaydetV2, { stoklar: [gövde] }, true) — vergi alanı İŞARETÇİ (4), yüzde değil', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/stok/kaydet', { item: CIMENTO, firebaseId: 'inv1' });

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledTimes(1);
    expect(mikroPost).toHaveBeenCalledWith('StokKaydetV2', {
      stoklar: [{
        sto_kod:             'CIM-50',
        sto_isim:            'ÇİMENTO 50KG PORTLAND CEM I 42,5R',
        sto_kisa_ismi:       'ÇİMENTO 50KG PORTLAND CE',
        sto_cins:            0,
        sto_doviz_cinsi:     0,
        sto_birim1_ad:       'ADET',
        sto_perakende_vergi: 4,
        sto_toptan_vergi:    4,
        satis_fiyatlari: [fiyatSatiri(1, 189.9), fiyatSatiri(2, 172.5), fiyatSatiri(3, 165), fiyatSatiri(4, 158.25)],
      }],
    }, true);
    expect(res.govde).toMatchObject({ success: true, mikroStoKod: 'CIM-50' });
    expect(d.koleksiyon('inventory')).toEqual([
      { op: 'update', ref: { id: 'inv1', coll: 'inventory' }, data: { mikroStoKod: 'CIM-50', mikroSynced: true, mikroSyncedAt: 'TS' } },
    ]);
  });
});

// ── /api/mikro/cari/kaydet ───────────────────────────────────────────────────

describe('POST /api/mikro/cari/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('mikroCariKod ve firebaseId yoksa 400 — `CAR<zaman damgası>` cari kodu uydurulmaz', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/cari/kaydet', { lead: { name: 'Şirin İnşaat' }, firebaseId: '' });
    expect(res.kod).toBe(400);
    expect(String((res.govde as { error?: string }).error)).toContain('cari kodu');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.koleksiyon('leads')).toEqual([]);
    expect(mirrorMikroCariler).not.toHaveBeenCalled();
  });

  it('unvansız cari (company/name boş) 400 verir ve syncLog `supplier` türüyle düşer', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/cari/kaydet', { lead: { name: '   ' }, firebaseId: 'sup1', collection: 'suppliers' });
    expect(res.kod).toBe(400);
    expect(String((res.govde as { error?: string }).error)).toContain('cari unvanı');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.syncLog).toHaveBeenCalledWith(
      'CariKaydetV2', 'supplier', 'sup1', false, null,
      expect.stringContaining('cari unvanı'), expect.any(Number), expect.anything(),
    );
  });
});

describe('POST /api/mikro/cari/kaydet — bilinen cari: eski gövdeyle BİREBİR', () => {
  it("PurchasingModule vakası (yalnız `name` + firebaseId) throw ETMEZ: kod CAR+ilk6, isteğe bağlı alanlar boş metin", async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/cari/kaydet', { lead: { name: 'Şirin İnşaat' }, firebaseId: 'abc123xyz', collection: 'suppliers' });

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledWith('CariKaydetV2', {
      cariler: [{
        cari_kod:               'CARABC123',
        cari_unvan1:            'Şirin İnşaat',
        cari_unvan2:            '',
        cari_vdaire_no:         '',
        cari_vdaire_adi:        '',
        cari_EMail:             '',
        cari_CepTel:            '',
        cari_efatura_fl:        0,
        cari_def_efatura_cinsi: 0,
        cari_doviz_cinsi1:      0,
        cari_doviz_cinsi2:      255,
        cari_doviz_cinsi3:      255,
        cari_KurHesapSekli:     1,
        cari_sevk_adres_no:     0,
        cari_fatura_adres_no:   0,
        adres: [{
          adr_cadde: '', adr_ilce: '', adr_il: '', adr_ulke: 'TÜRKİYE',
          adr_tel_ulke_kodu: '090', adr_tel_bolge_kodu: '', adr_tel_no1: '',
          adr_posta_kodu: 0, yetkili: [],
        }],
      }],
    }, true);
    expect(res.govde).toMatchObject({ success: true, cariKod: 'CARABC123' });
    expect(d.koleksiyon('suppliers')).toEqual([
      { op: 'update', ref: { id: 'abc123xyz', coll: 'suppliers' }, data: { mikroCariKod: 'CARABC123', mikroSynced: true, mikroSyncedAt: 'TS' } },
    ]);
  });

  it('mevcut mikroCariKod korunur (yeni kod türetilmez) ve yanıtta aynen döner', async () => {
    basariliYanit();
    const res = await d.cagir('POST', '/api/mikro/cari/kaydet', { lead: { mikroCariKod: '120.01.0042', company: 'Şirin İnşaat A.Ş.' }, firebaseId: 'lead9' });
    const [, govde] = vi.mocked(mikroPost).mock.calls[0] as [string, { cariler: Array<{ cari_kod: string; cari_unvan1: string }> }];
    expect(govde.cariler[0]).toMatchObject({ cari_kod: '120.01.0042', cari_unvan1: 'Şirin İnşaat A.Ş.' });
    expect(res.govde).toMatchObject({ success: true, cariKod: '120.01.0042' });
  });
});
