/**
 * mikroRoutes.govdeSiparis.test.ts — `/api/mikro/siparis/kaydet` rotasının gövde
 * modülüne BAĞLANMASI (Faz 3 3/n, grup "govdeSiparis", 2026-09-19).
 *
 * Modül testi (`src/server/mikro/govdeSiparis.test.ts`, 44 test) gövdenin İÇERİĞİNİ
 * kilitler. Burada kilitlenen şey ROTA SÖZLEŞMESİ:
 *   1) Gövde kurulamazsa **mikroPost HİÇ çağrılmaz** ve yanıt **400** olur — 500 değil.
 *      (500 istemcide "sunucu bozuk, tekrar dene" demektir; burada eksik olan SİPARİŞTİR.)
 *   2) Başarısız denemenin `writeSyncLog` kaydı yine de düşer (400'den ÖNCE).
 *   3) Gövde kurulamadığında `orders` dokümanına mikroSynced damgası YAZILMAZ ve
 *      ayna tablosuna (`mikro_siparisler`) satır düşmez.
 *   4) Bilinen siparişte mikroPost ESKİ gövdeyle çağrılır (parite): `{ evraklar: [{ satirlar }] }`
 *      zarfı + `inMikro=true` bayrağı, ve ayna AYNI diziyi yazar (referans eşitliği).
 *   5) Rotanın kendi ön kontrolü ("Sipariş satırı bulunamadı.") korunur.
 *
 * ⚠️ Bu rota BUGÜN üretimde 400 döner: hiçbir sipariş `depoNo` taşımıyor (Order tipinde
 * alan yok, AddOrderModal sormuyor) ve eski sabit `sip_depono: 1` bu kiracıda HAVALİMANI
 * deposudur (2026-09-05). Sahte kayıt yerine hata — bilinçli, aşağıda testle kilitli.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroVergiOranlari } from '../mikroClient.js';
import { mirrorMikroInsert } from '../mikroMirror.js';

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
  vi.mocked(mirrorMikroInsert).mockClear();
  vergiTablosuAyarla(new Map([[1, 0], [2, 1], [3, 10], [4, 20]]));
});

/** Müşterinin gerçek VergiListesiV2 tablosu (2026-07-31 canlı bulgusu): sıra 4 = %20, 3 = %10. */
function vergiTablosuAyarla(tablo: Map<number, number> | Record<string, never>) {
  vi.mocked(mikroVergiOranlari).mockImplementation((async () => tablo) as typeof mikroVergiOranlari);
}

/** Mikro'nun BAŞARILI zarfı: `result[0]` var ve `IsError` yok (rota bunu şart koşuyor). */
const basariliYanit = () =>
  vi.mocked(mikroPost).mockImplementation((async () => ({
    ok: true, status: 200, data: { result: [{ IsError: false, Data: { evrakNo: 'T000123' } }] },
  })) as unknown as typeof mikroPost);

/** Depo seçilmiş, eksiksiz sipariş. İkinci kalem BİLEREK farklı: %10 KDV + satır iskontolu `total`. */
const SIPARIS = {
  mikroCariKod: '120.01.0042',
  createdAt: '2026-09-15',
  depoNo: 2,                       // gerçek stok deposu (depo 1 = HAVALİMANI)
  lineItems: [
    { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 3, price: 150, vatRate: 20 },
    { sku: 'KUM-01', name: 'YIKANMIŞ KUM', quantity: 2, unitPrice: 55, total: 100, vatRate: 10 },
  ],
};
const siparisAt = (atilan: string) => {
  const { [atilan]: _yok, ...kalan } = SIPARIS as Record<string, unknown>;
  return kalan;
};
const gonder = (order: Record<string, unknown>, firebaseId = 'ord1') =>
  d.cagir('POST', '/api/mikro/siparis/kaydet', { order, firebaseId });
const hata = (res: { govde: unknown }) => String((res.govde as { error?: string }).error);

// ── Gövde kurulamayan hâller ─────────────────────────────────────────────────

describe('POST /api/mikro/siparis/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('depo seçilmemiş sipariş: 400 — eski sabit `sip_depono: 1` (HAVALİMANI) UYDURULMAZ', async () => {
    basariliYanit();   // mikroPost başarılı olsa BİLE çağrılmamalı
    const res = await gonder(siparisAt('depoNo'));

    expect(res.kod).toBe(400);
    expect(res.govde).toMatchObject({ success: false });
    expect(hata(res)).toContain('depo numarası bilinmiyor');
    expect(mikroPost, 'gövde kurulamadan Mikro defterine yazılmamalı').not.toHaveBeenCalled();
    expect(d.koleksiyon('orders'), 'başarısız push mikroSynced damgalamamalı').toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it('miktarı olmayan 2. kalem: 400 + satır numaralı Türkçe mesaj — `quantity || 1` yok', async () => {
    basariliYanit();
    const { quantity: _yok, ...miktarsiz } = SIPARIS.lineItems[1];
    const res = await gonder({ ...SIPARIS, lineItems: [SIPARIS.lineItems[0], miktarsiz] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: 2. kalemin miktarı bilinmiyor");
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('birim fiyatı olmayan kalem: 400 — `price || 0` ile 0 TL satır yazılmaz', async () => {
    basariliYanit();
    const { price: _yok, ...fiyatsiz } = SIPARIS.lineItems[0];
    const res = await gonder({ ...SIPARIS, lineItems: [fiyatsiz] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('1. kalemin birim fiyatı bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('cariye bağlanmamış sipariş: 400 — `mikroCariKod || \'\'` ile sahipsiz evrak açılmaz', async () => {
    basariliYanit();
    const res = await gonder(siparisAt('mikroCariKod'));

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('müşteri cari kodu bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('Mikro vergi tablosu okunamadıysa 400 — sabit işaretçi (eski `4` = %20) UYDURULMAZ', async () => {
    basariliYanit();
    vergiTablosuAyarla(new Map());   // VergiListesiV2 ağ hatası → boş Map
    const res = await gonder(SIPARIS);

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('vergi işaretçisi bilinmiyor');
    expect(hata(res)).toContain('VergiListesiV2');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('başarısız denemenin writeSyncLog kaydı 400’den ÖNCE düşer (deneme izi kaybolmaz)', async () => {
    basariliYanit();
    await gonder(siparisAt('depoNo'), 'ord9');
    expect(d.syncLog).toHaveBeenCalledWith(
      'SiparisKaydetV2', 'order', 'ord9', false, null,
      expect.stringContaining('depo numarası bilinmiyor'), expect.any(Number), expect.anything(),
    );
  });

  it('kalemsiz sipariş: rotanın KENDİ mesajı korunur (gövde kurucuya hiç gidilmez)', async () => {
    basariliYanit();
    const res = await gonder({ ...SIPARIS, lineItems: [] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe('Sipariş satırı bulunamadı.');
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.syncLog, 'ön kontrol syncLog yazmaz (eski davranış)').not.toHaveBeenCalled();
  });
});

// ── Parite: bilinen siparişte eski gövdeyle BİREBİR ──────────────────────────

describe('POST /api/mikro/siparis/kaydet — bilinen sipariş: eski gövdeyle BİREBİR', () => {
  const SATIR_1 = {
    sip_tarih: '15.09.2026', sip_tip: '0', sip_cins: '0', sip_evrakno_seri: 'T',
    sip_musteri_kod: '120.01.0042', sip_stok_kod: 'CIM-50',
    sip_b_fiyat: 150, sip_miktar: 3, sip_tutar: 450,
    sip_vergi_pntr: 4, sip_depono: 2, sip_vergisiz_fl: false,
  };
  const SATIR_2 = {
    sip_tarih: '15.09.2026', sip_tip: '0', sip_cins: '0', sip_evrakno_seri: 'T',
    sip_musteri_kod: '120.01.0042', sip_stok_kod: 'KUM-01',
    // `total: 100` (satır iskontosu) fiyat×miktar = 110'a TERCİH edilir — eski rotanın kuralı.
    sip_b_fiyat: 55, sip_miktar: 2, sip_tutar: 100,
    sip_vergi_pntr: 3, sip_depono: 2, sip_vergisiz_fl: false,   // %10 → sıra 3, sabit 4 DEĞİL
  };

  it('mikroPost(SiparisKaydetV2, { evraklar: [{ satirlar }] }, true) — alan adları/sıra/sabitler aynı', async () => {
    basariliYanit();
    const res = await gonder(SIPARIS);

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledTimes(1);
    expect(mikroPost).toHaveBeenCalledWith('SiparisKaydetV2', { evraklar: [{ satirlar: [SATIR_1, SATIR_2] }] }, true);
    expect(res.govde).toMatchObject({ success: true, mikroEvrakNo: 'T000123' });
    expect(d.koleksiyon('orders')).toEqual([
      { op: 'update', ref: { id: 'ord1', coll: 'orders' }, data: { mikroEvrakNo: 'T000123', mikroSynced: true, mikroSyncedAt: 'TS' } },
    ]);
  });

  it('ayna (mikro_siparisler) mikroPost’a giden DİZİNİN TA KENDİSİNİ yazar — kopya değil', async () => {
    basariliYanit();
    await gonder(SIPARIS);

    const govde = vi.mocked(mikroPost).mock.calls[0][1] as { evraklar: [{ satirlar: unknown[] }] };
    const aynaCagrisi = vi.mocked(mirrorMikroInsert).mock.calls[0];
    expect(aynaCagrisi[0]).toBe('mikro_siparisler');
    expect(aynaCagrisi[1], 'ayna kopya değil, gövdenin TA KENDİSİ olmalı').toBe(govde.evraklar[0].satirlar);
  });

  it('sipariş tarihi yoksa push anına düşer (eski davranış), ama BOZUK tarih 400 verir', async () => {
    basariliYanit();
    const bugun = new Date();
    const beklenen = `${String(bugun.getDate()).padStart(2, '0')}.${String(bugun.getMonth() + 1).padStart(2, '0')}.${bugun.getFullYear()}`;
    await gonder(siparisAt('createdAt'));
    const [, govde] = vi.mocked(mikroPost).mock.calls[0] as [string, { evraklar: [{ satirlar: Array<{ sip_tarih: string }> }] }];
    expect(govde.evraklar[0].satirlar[0].sip_tarih).toBe(beklenen);

    vi.mocked(mikroPost).mockClear();
    const res = await gonder({ ...SIPARIS, createdAt: 'çarşamba' });
    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('sipariş tarihi bilinmiyor');
    expect(mikroPost, 'çözülemeyen tarih "NaN.NaN.NaN" olarak yazılmamalı').not.toHaveBeenCalled();
  });

  it('Mikro reddederse (IsError) 200/success:false — bu 400 DEĞİLDİR, gövde kurulmuştu', async () => {
    vi.mocked(mikroPost).mockImplementation((async () => ({
      ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'Cari bulunamadı' }] },
    })) as unknown as typeof mikroPost);
    const res = await gonder(SIPARIS);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: false });
    expect(d.koleksiyon('orders'), 'başarısız Mikro yanıtı damgalamaz').toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });
});
