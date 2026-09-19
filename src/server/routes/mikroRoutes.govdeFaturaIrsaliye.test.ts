/**
 * mikroRoutes.govdeFaturaIrsaliye.test.ts — `/api/mikro/fatura/kaydet` ve
 * `/api/mikro/irsaliye/kaydet` rotalarının gövde modülüne BAĞLANMASI
 * (Faz 3 3/n, grup "govdeFaturaIrsaliye", 2026-09-19).
 *
 * Modül testi (`src/server/mikro/govdeFaturaIrsaliye.test.ts`, 33 test) gövdenin
 * İÇERİĞİNİ kilitler. Burada kilitlenen şey ROTA SÖZLEŞMESİ:
 *   1) Gövde kurulamazsa **mikroPost HİÇ çağrılmaz** ve yanıt **400** olur — 500 değil.
 *      (500 istemcide "sunucu bozuk, tekrar dene" demektir; burada eksik olan BELGEDİR.)
 *   2) Başarısız denemenin `writeSyncLog` kaydı yine de düşer (400'den ÖNCE).
 *   3) Gövde kurulamadığında `orders`/`shipments` dokümanına mikroSynced damgası
 *      YAZILMAZ ve ayna tablosuna satır düşmez.
 *   4) Bilinen belgede mikroPost ESKİ gövdeyle çağrılır (parite): `{ evraklar: [evrak] }`
 *      zarfı + `inMikro=true` bayrağı.
 *
 * ⚠️ ŞEMA KAPISI: `IrsaliyeKaydetSchema`ya `kdvOran` + `depoNo` eklendi (schemas.ts).
 * zod bilinmeyen anahtarları KIRPAR — o alanlar şemadan düşerse buradaki BAŞARILI
 * irsaliye testi 400 görür. Yani şema değişikliği bu testle de kilitli.
 *
 * ⚠️ e-İrsaliye BUGÜN üretimde 400 döner: Cetpa'da sevkiyat/sipariş kaydında Mikro
 * depo numarası alanı YOK (types.ts). Eski sabit `sth_*_depo_no: 1` bu kiracıda
 * HAVALİMANI deposudur (2026-09-05). Sahte kayıt yerine hata — bilinçli, testle kilitli.
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
function vergiTablosuAyarla(tablo: Map<number, number>) {
  vi.mocked(mikroVergiOranlari).mockImplementation((async () => tablo) as typeof mikroVergiOranlari);
}

/** Mikro'nun BAŞARILI zarfı: `result[0]` var ve `IsError` yok (rota bunu şart koşuyor). */
const basariliYanit = (veri: Record<string, unknown>) =>
  vi.mocked(mikroPost).mockImplementation((async () => ({
    ok: true, status: 200, data: { result: [{ IsError: false, Data: veri }] },
  })) as unknown as typeof mikroPost);

// 40 × 312,50 ₺ = 12.500 ₺ ve 2 × 1.249,50 ₺ = 2.499 ₺ — float artığı olmayan sayılar.
const CIMENTO = { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 };
const DEMIR   = { sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR Ø12', quantity: 2, price: 1249.5 };

/** Saat taşıyan ISO: makinenin saat diliminden bağımsız olarak 19.09.2026. */
const TARIH = '2026-09-19T12:00:00.000Z';

const hata = (res: { govde: unknown }) => String((res.govde as { error?: string }).error);
const at = <T extends Record<string, unknown>>(kaynak: T, atilan: string) => {
  const { [atilan]: _yok, ...kalan } = kaynak;
  return kalan;
};

// ═════════════════════════════════════════════════════════════════════════════
// e-FATURA
// ═════════════════════════════════════════════════════════════════════════════
const SIPARIS = {
  mikroCariKod: '120.01.0042',
  lineItems: [CIMENTO, DEMIR],
  faturaTipi: 'e-arsiv',
  kdvOran: 20,
  createdAt: TARIH,
};
const faturaGonder = (order: Record<string, unknown>, firebaseId = 'ord1') =>
  d.cagir('POST', '/api/mikro/fatura/kaydet', { order, firebaseId });

describe('POST /api/mikro/fatura/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('KDV oranı girilmemiş sipariş: 400 — eski `kdvOran ?? 20` KDV TUTARINI uyduruyordu', async () => {
    basariliYanit({ faturaNo: 'F1' });   // mikroPost başarılı olsa BİLE çağrılmamalı
    const res = await faturaGonder(at(SIPARIS, 'kdvOran'));

    expect(res.kod).toBe(400);
    expect(res.govde).toMatchObject({ success: false });
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: KDV oranı bilinmiyor");
    expect(mikroPost, 'gövde kurulamadan yasal belge kesilmemeli').not.toHaveBeenCalled();
    expect(d.koleksiyon('orders'), 'başarısız push mikroSynced damgalamamalı').toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it('Mikro vergi tablosu okunamadıysa 400 — sabit işaretçi (eski `kdvOran>=20?4:…`) UYDURULMAZ', async () => {
    basariliYanit({ faturaNo: 'F1' });
    vergiTablosuAyarla(new Map());   // VergiListesiV2 ağ hatası → boş Map
    const res = await faturaGonder(SIPARIS);

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('KDV vergi işaretçisi bilinmiyor');
    expect(hata(res)).toContain('VergiListesiV2');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('Mikro tablosunda olmayan oran (%18): 400 — en yakın işaretçiye YUVARLANMAZ', async () => {
    basariliYanit({ faturaNo: 'F1' });
    const res = await faturaGonder({ ...SIPARIS, kdvOran: 18 });

    expect(res.kod).toBe(400);
    expect(hata(res)).toMatch(/%18/);
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('çözülemeyen createdAt: 400 — gövdeye "NaN.NaN.NaN" tarihi yazılmaz', async () => {
    basariliYanit({ faturaNo: 'F1' });
    const res = await faturaGonder({ ...SIPARIS, createdAt: 'dün' });

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('fatura tarihi bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('SKU’suz kalem: 400 — Mikro defterine stok kodu BOŞ, sahipsiz hareket yazılmaz', async () => {
    // Şema `sku`yu optional bırakıyor (schemas.ts) ve App.tsx `sku: l.sku` gönderiyor:
    // Shopify'dan/elle açılmış SKU'suz kalemde JSON'da alan hiç yoktu ve gövde yine
    // kuruluyordu. İrsaliye bugün depo kapısında zaten 400 alıyor; asıl açık YOL BUYDU.
    basariliYanit({ faturaNo: 'F1' });
    const res = await faturaGonder({ ...SIPARIS, lineItems: [CIMENTO, at(DEMIR, 'sku')] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: 2. kalemin stok kodu bilinmiyor");
    expect(mikroPost, 'stok kodsuz sth_* satırı FaturaKaydetV2’ye gitmemeli').not.toHaveBeenCalled();
    expect(d.koleksiyon('orders')).toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it('başarısız denemenin writeSyncLog kaydı 400’den ÖNCE düşer (deneme izi kaybolmaz)', async () => {
    basariliYanit({ faturaNo: 'F1' });
    await faturaGonder(at(SIPARIS, 'kdvOran'), 'ord9');

    expect(d.syncLog).toHaveBeenCalledWith(
      'FaturaKaydetV2', 'order', 'ord9', false, null,
      expect.stringContaining('KDV oranı bilinmiyor'), expect.any(Number), expect.anything(),
    );
  });

  it('şemanın kendi doğrulaması (kalemsiz fatura) DEĞİŞMEDİ: 400 + zod mesajı', async () => {
    basariliYanit({ faturaNo: 'F1' });
    const res = await faturaGonder({ ...SIPARIS, lineItems: [] });

    expect(res.kod).toBe(400);
    expect(res.govde).toMatchObject({ error: 'Geçersiz istek gövdesi.' });
    expect(mikroPost).not.toHaveBeenCalled();
    expect(d.syncLog, 'şema reddi syncLog yazmaz (eski davranış)').not.toHaveBeenCalled();
  });
});

describe('POST /api/mikro/fatura/kaydet — bilinen sipariş: eski gövdeyle BİREBİR', () => {
  const ORTAK = {
    sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
    sth_evraktip: 4, sth_evrakno_seri: 'F',
    sth_cari_cinsi: 0, sth_cari_kodu: '120.01.0042',
    sth_birim_pntr: 1, sth_vergi_pntr: 4, sth_vergisiz_fl: false,
    sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
    // AÇIK MADDE: fatura satırında depo hâlâ sabit 1 (parite) — irsaliyenin aksine
    // throw'a çevirmek e-Fatura kesmeyi tamamen durdururdu.
    sth_subeno: 0, sth_giris_depo_no: 1, sth_cikis_depo_no: 1,
  };
  const SATIR_1 = { ...ORTAK, sth_stok_kod: 'CIM-50', sth_miktar: 40, sth_tutar: 12500, sth_vergi: 2500, sth_aciklama: 'ÇİMENTO 50KG' };
  const SATIR_2 = { ...ORTAK, sth_stok_kod: 'DMR-12', sth_miktar: 2,  sth_tutar: 2499,  sth_vergi: 499.8, sth_aciklama: 'NERVÜRLÜ DEMİR Ø12' };
  const EVRAK = {
    cha_tip: 0, cha_cinsi: 7, cha_normal_Iade: 0, cha_evrak_tip: 63, cha_cari_cins: 0,
    cha_d_cins: 0, cha_d_kur: 1, cha_tarihi: '19.09.2026', cha_evrakno_seri: 'F',
    cha_kod: '120.01.0042', cha_projekodu: '', cha_srmrkkodu: '', cha_vade: 0, cha_subeno: 0,
    cha_aciklama: '', kdv_istisna_kodu: '',
    detay: [SATIR_1, SATIR_2],
  };

  it('mikroPost(FaturaKaydetV2, { evraklar: [evrak] }, true) — alan adları/sıra/sabitler aynı', async () => {
    basariliYanit({ faturaNo: 'FTR-000123', ettn: 'E-1111' });
    const res = await faturaGonder(SIPARIS);

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledTimes(1);
    expect(mikroPost).toHaveBeenCalledWith('FaturaKaydetV2', { evraklar: [EVRAK] }, true);
    expect(res.govde).toMatchObject({ success: true, mikroFaturaNo: 'FTR-000123', ettn: 'E-1111' });
  });

  it('başarılı push siparişi damgalar (mikroFaturaDate gövdedeki tarihin AYNISI)', async () => {
    basariliYanit({ faturaNo: 'FTR-000123', ettn: 'E-1111' });
    await faturaGonder(SIPARIS);

    expect(d.koleksiyon('orders')).toEqual([{
      op: 'set', ref: { id: 'ord1', coll: 'orders' },
      data: {
        companyId: 'A', mikroFaturaNo: 'FTR-000123', ettn: 'E-1111',
        hasInvoice: true, mikroFaturaDate: '19.09.2026',
        mikroSynced: true, mikroSyncedAt: 'TS',
      },
    }]);
  });

  it('createdAt yoksa belge BUGÜN kesilir (eski davranış korunur)', async () => {
    basariliYanit({ faturaNo: 'F1' });
    const bugun = new Date();
    const beklenen = `${String(bugun.getDate()).padStart(2, '0')}.${String(bugun.getMonth() + 1).padStart(2, '0')}.${bugun.getFullYear()}`;
    await faturaGonder(at(SIPARIS, 'createdAt'));

    const [, govde] = vi.mocked(mikroPost).mock.calls[0] as [string, { evraklar: [{ cha_tarihi: string }] }];
    expect(govde.evraklar[0].cha_tarihi).toBe(beklenen);
  });

  it('Mikro reddederse (IsError) 200/success:false — bu 400 DEĞİLDİR, gövde kurulmuştu', async () => {
    vi.mocked(mikroPost).mockImplementation((async () => ({
      ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'Cari bulunamadı' }] },
    })) as unknown as typeof mikroPost);
    const res = await faturaGonder(SIPARIS);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: false });
    expect(d.koleksiyon('orders'), 'başarısız Mikro yanıtı damgalamaz').toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// e-İRSALİYE
// ═════════════════════════════════════════════════════════════════════════════
const SEVKIYAT = {
  mikroCariKod: '120.01.0042',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  destination: 'Organize Sanayi 5. Cadde No:12, Kocaeli',
  trackingNo: '41 ABC 123',
  cargoFirm: 'ARAS',
  items: [CIMENTO, DEMIR],
  date: TARIH,
  kdvOran: 20,
  depoNo: 2,          // gerçek stok deposu (depo 1 = HAVALİMANI)
};
const irsaliyeGonder = (shipment: Record<string, unknown>, firebaseId = 'shp1') =>
  d.cagir('POST', '/api/mikro/irsaliye/kaydet', { shipment, firebaseId });

describe('POST /api/mikro/irsaliye/kaydet — gövde kurulamazsa Mikro’ya GİDİLMEZ', () => {
  it('depo seçilmemiş sevkiyat: 400 — eski sabit `sth_*_depo_no: 1` (HAVALİMANI) UYDURULMAZ', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    const res = await irsaliyeGonder(at(SEVKIYAT, 'depoNo'));

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: depo numarası bilinmiyor");
    expect(mikroPost, 'gövde kurulamadan Mikro defterine yazılmamalı').not.toHaveBeenCalled();
    expect(d.koleksiyon('shipments'), 'başarısız push mikroSynced damgalamamalı').toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });

  it('KDV oranı yoksa 400 — eski sabit `sth_vergi_pntr: 4` UYDURULMAZ', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    const res = await irsaliyeGonder(at(SEVKIYAT, 'kdvOran'));

    expect(res.kod).toBe(400);
    expect(hata(res)).toContain('KDV oranı bilinmiyor');
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('kalemsiz sevkiyat: 400 — eski "tek satır, stok kodsuz, 1 adet, 0 ₺" SAHTE belge üretilmez', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    for (const items of [[], undefined]) {
      vi.mocked(mikroPost).mockClear();
      const res = await irsaliyeGonder({ ...SEVKIYAT, items });
      expect(res.kod).toBe(400);
      expect(hata(res)).toContain('sevkiyat kalemleri bilinmiyor');
      expect(mikroPost).not.toHaveBeenCalled();
    }
  });

  it('fiyatsız 2. kalem: 400 + satır numaralı Türkçe mesaj — şema `price`i optional bırakıyor, son kapı burası', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    const res = await irsaliyeGonder({ ...SEVKIYAT, items: [CIMENTO, at(DEMIR, 'price')] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: 2. kalemin birim fiyatı bilinmiyor");
    expect(mikroPost, '`price ?? 0` ile 0 ₺ satır yazılmamalı').not.toHaveBeenCalled();
  });

  it('SKU’suz kalem: 400 — irsaliye satırı da stok kodsuz gitmez', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    const res = await irsaliyeGonder({ ...SEVKIYAT, items: [at(CIMENTO, 'sku')] });

    expect(res.kod).toBe(400);
    expect(hata(res)).toBe("Mikro'ya gönderilemedi: 1. kalemin stok kodu bilinmiyor");
    expect(mikroPost).not.toHaveBeenCalled();
  });

  it('başarısız denemenin writeSyncLog kaydı 400’den ÖNCE düşer', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    await irsaliyeGonder(at(SEVKIYAT, 'depoNo'), 'shp9');

    expect(d.syncLog).toHaveBeenCalledWith(
      'IrsaliyeKaydetV2', 'shipment', 'shp9', false, null,
      expect.stringContaining('depo numarası bilinmiyor'), expect.any(Number), expect.anything(),
    );
  });
});

describe('POST /api/mikro/irsaliye/kaydet — bilinen sevkiyat: eski gövdeyle BİREBİR', () => {
  const ORTAK = {
    sth_tarih: '19.09.2026', sth_tip: 1, sth_cins: 0, sth_normal_iade: 0,
    sth_evraktip: 1, sth_evrakno_seri: 'I',
    sth_cari_cinsi: 0, sth_cari_kodu: '120.01.0042',
    sth_birim_pntr: 1, sth_vergi_pntr: 4, sth_vergi: 0, sth_vergisiz_fl: false,
    sth_iskonto1: 0, sth_iskonto2: 0,
    sth_giris_depo_no: 2, sth_cikis_depo_no: 2, sth_subeno: 0,
    sth_malkbl_sevk_tarihi: '19.09.2026',
  };
  const SATIR_1 = { ...ORTAK, sth_stok_kod: 'CIM-50', sth_miktar: 40, sth_tutar: 12500, sth_aciklama: 'ÇİMENTO 50KG' };
  const SATIR_2 = { ...ORTAK, sth_stok_kod: 'DMR-12', sth_miktar: 2,  sth_tutar: 2499,  sth_aciklama: 'NERVÜRLÜ DEMİR Ø12' };
  const EVRAK = {
    evrak_aciklamalari: [{ aciklama: 'Organize Sanayi 5. Cadde No:12, Kocaeli' }],
    e_irsaliye_detaylari: {
      eir_tasiyici_firma_kodu: 'ARAS',
      eir_tasiyici_arac_plaka: '41 ABC 123',
      eir_eirs_olrk_gonderilsin: 0,
    },
    satirlar: [SATIR_1, SATIR_2],
  };

  it('mikroPost(IrsaliyeKaydetV2, { evraklar: [evrak] }, true) — depo kayıttan gelir, sabit 1 DEĞİL', async () => {
    basariliYanit({ irsaliyeNo: 'IRS-000777', ettn: 'E-2222' });
    const res = await irsaliyeGonder(SEVKIYAT);

    expect(res.kod).toBe(200);
    expect(mikroPost).toHaveBeenCalledTimes(1);
    // Bu iddia AYNI ZAMANDA şema kapısını kilitler: IrsaliyeKaydetSchema'dan
    // `depoNo`/`kdvOran` düşerse zod onları kırpar ve bu çağrı hiç yapılmaz (400).
    expect(mikroPost).toHaveBeenCalledWith('IrsaliyeKaydetV2', { evraklar: [EVRAK] }, true);
    expect(res.govde).toMatchObject({ success: true, irsaliyeNo: 'IRS-000777', irsaliyeEttn: 'E-2222' });
  });

  it('başarılı push sevkiyatı damgalar ve ayna satırlarını gövdedeki satırlardan yazar', async () => {
    basariliYanit({ irsaliyeNo: 'IRS-000777', ettn: 'E-2222' });
    await irsaliyeGonder(SEVKIYAT);

    expect(d.koleksiyon('shipments')).toEqual([{
      op: 'set', ref: { id: 'shp1', coll: 'shipments' },
      data: {
        companyId: 'A', irsaliyeNo: 'IRS-000777', irsaliyeEttn: 'E-2222',
        mikroSynced: true, mikroSyncedAt: 'TS',
      },
    }]);

    const aynaCagrisi = vi.mocked(mirrorMikroInsert).mock.calls[0];
    expect(aynaCagrisi[0]).toBe('mikro_stok_hareketleri');
    expect(aynaCagrisi[1]).toEqual([
      { ...SATIR_1, __kaynak: 'irsaliye_push' },
      { ...SATIR_2, __kaynak: 'irsaliye_push' },
    ]);
  });

  it('adres/kargo/plaka boşsa boş string (metin alanı, para değil — eski davranış)', async () => {
    basariliYanit({ irsaliyeNo: 'I1' });
    await irsaliyeGonder(at(at(SEVKIYAT, 'destination'), 'cargoFirm'));

    const [, govde] = vi.mocked(mikroPost).mock.calls[0] as [string, { evraklar: [typeof EVRAK] }];
    expect(govde.evraklar[0].evrak_aciklamalari).toEqual([{ aciklama: '' }]);
    expect(govde.evraklar[0].e_irsaliye_detaylari.eir_tasiyici_firma_kodu).toBe('');
  });

  it('Mikro reddederse (IsError) 200/success:false — ayna yazılmaz, damga basılmaz', async () => {
    vi.mocked(mikroPost).mockImplementation((async () => ({
      ok: true, status: 200, data: { result: [{ IsError: true, ErrorMessage: 'Stok kodu yok' }] },
    })) as unknown as typeof mikroPost);
    const res = await irsaliyeGonder(SEVKIYAT);

    expect(res.kod).toBe(200);
    expect(res.govde).toMatchObject({ success: false });
    expect(d.koleksiyon('shipments')).toEqual([]);
    expect(mirrorMikroInsert).not.toHaveBeenCalled();
  });
});
