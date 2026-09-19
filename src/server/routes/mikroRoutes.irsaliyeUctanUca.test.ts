/**
 * mikroRoutes.irsaliyeUctanUca.test.ts — e-İrsaliye akışının UÇTAN UCA sözleşme testi (2026-09-19, kullanıcı isteği:
 * "onay alsın, uçtan uca kontrol edelim").
 *
 * Zincirin HER halkası GERÇEK koddur; yalnız Mikro'nun kendisi (mikroPost) sahtedir:
 *   sipariş + müşteri ─► irsaliyeIstegi()            (istemci: src/utils/siparisler/irsaliyeGonder.ts)
 *                     ─► JSON gidiş-dönüş             (ağ: undefined alanlar düşer, NaN null olur)
 *                     ─► POST /api/mikro/irsaliye/kaydet (şema + sahiplik + mükerrer kapısı + irsaliyeGovdesi)
 *                     ─► mikroPost('IrsaliyeKaydetV2') (Mikro'ya GİDEN gövde burada doğrulanır)
 *                     ─► yanıt ─► irsaliyeYanitMesaji() + irsaliyeSonucYamasi() (istemci: toast + orders/{id} yaması)
 *
 * NEDEN: istemci ve sunucu AYRI ajanlarca, ayrı turlarda yazıldı (4/n istemci, 3/n sunucu). Her birinin kendi testi
 * yeşilken ikisi birbirine uymayabilir — 2026-08-22'de tam bu oldu: istemci `quantity/price` yerine başka alan adı
 * gönderiyordu, HER istek 400'dü ve kimse fark etmedi. Bu test o sınıfı kilitler.
 *
 * vi.mock blokları burada KALMAK ZORUNDA (vitest hoisting) — tarif: `mikroRoutes.testDuzenegi.ts` `mikroMockTarifi`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroVergiOranlari } from '../mikroClient.js';
import { irsaliyeIstegi, irsaliyeYanitMesaji, irsaliyeSonucYamasi, type IrsaliyeYaniti } from '../../utils/siparisler/irsaliyeGonder';

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
beforeEach(() => {
  d = duzenekKur();
  vi.mocked(mikroPost).mockReset();
  // Müşterinin gerçek VergiListesiV2 tablosu (2026-07-31 canlı bulgusu): sıra 4 = %20, 3 = %10.
  vi.mocked(mikroVergiOranlari).mockImplementation((async () => new Map([[1, 0], [2, 1], [3, 10], [4, 20]])) as typeof mikroVergiOranlari);
});

const mikroYaniti = (r0: Record<string, unknown>) =>
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [r0] } })) as unknown as typeof mikroPost);

/** Ağ: istemcinin kurduğu gövde JSON'dan geçer (undefined düşer, NaN → null). */
const agdanGecir = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const LEAD = { id: 'L1', name: 'Şirin İnşaat', mikroCariKod: '120.01.001', eFaturaKayitli: true };
const SIPARIS = {
  id: 'SIP-1', leadId: 'L1', customerName: 'Şirin İnşaat', shippingAddress: 'Eski Sanayi Sit. 12. Sk. No:4 Kayseri',
  faturali: true, kdvOran: 20, depoNo: 2, status: 'Shipped', trackingNumber: 'TR123',
  lineItems: [
    { sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR Ø12', quantity: 2.5, price: 24500 },     // 2,5 TON — kesirli
    { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 312.5 },
  ],
};

async function gonder(siparis: typeof SIPARIS | Record<string, unknown>, lead: typeof LEAD | undefined = LEAD) {
  const istek = irsaliyeIstegi(siparis as never, lead as never);
  if (!istek.gonderilebilir || !istek.govde) return { istek, res: null };
  const res = await d.cagir('POST', '/api/mikro/irsaliye/kaydet', agdanGecir({ ...istek.govde, firebaseId: (siparis as { id: string }).id }));
  return { istek, res };
}

describe('e-İrsaliye UÇTAN UCA: istemci gövdesi → rota → Mikro gövdesi → yanıt → sipariş yaması', () => {
  it('MUTLU YOL: kesirli miktarlı, depolu, KDV\'li sipariş Mikro\'ya doğru satırlarla gider ve numara siparişe yazılır', async () => {
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-2026-000045', ettn: 'ETTN-1' } });

    const { istek, res } = await gonder(SIPARIS);
    expect(istek.gonderilebilir).toBe(true);
    expect(res?.kod).toBe(200);

    // Mikro'ya GİDEN gövde
    expect(vi.mocked(mikroPost)).toHaveBeenCalledTimes(1);
    const [metot, govde] = vi.mocked(mikroPost).mock.calls[0] as unknown as [string, { evraklar: Array<{ satirlar: Array<Record<string, unknown>> }> }];
    expect(metot).toBe('IrsaliyeKaydetV2');
    const satirlar = govde.evraklar[0].satirlar;
    expect(satirlar).toHaveLength(2);
    expect(satirlar[0]).toMatchObject({ sth_stok_kod: 'DMR-12', sth_miktar: 2.5, sth_cari_kodu: '120.01.001', sth_vergi_pntr: 4 });
    expect(satirlar[0].sth_cikis_depo_no).toBe(2);          // seçilen depo — sabit 1 (HAVALİMANI) DEĞİL
    expect(satirlar[0].sth_tutar).toBeCloseTo(2.5 * 24500, 6);
    expect(satirlar[1]).toMatchObject({ sth_stok_kod: 'CIM-50', sth_miktar: 40 });

    // İstemcinin yanıtı yorumlaması
    const yanit = res!.govde as IrsaliyeYaniti;
    const mesaj = irsaliyeYanitMesaji(res!.kod, yanit, 'tr');
    expect(mesaj.tur).toBe('success');
    expect(mesaj.metin).toContain('IRS-2026-000045');
    expect(irsaliyeSonucYamasi(yanit)).toMatchObject({ irsaliyeNo: 'IRS-2026-000045', irsaliyeGonderildi: true });
  });

  it('MÜKERRER: aynı sevkiyat ikinci kez gönderilirse sunucu 409 döner, Mikro\'ya İKİNCİ belge gitmez; istemci durumu onarır', async () => {
    d.snapAyarla('shipments', { 'SIP-1': { companyId: 'A', mikroSynced: true, irsaliyeNo: 'IRS-2026-000045' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-YENI' } });

    const { res } = await gonder(SIPARIS);
    expect(res?.kod).toBe(409);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
    const yanit = res!.govde as IrsaliyeYaniti;
    expect(irsaliyeSonucYamasi(yanit)).toMatchObject({ irsaliyeNo: 'IRS-2026-000045', irsaliyeGonderildi: true });
  });

  it('MİKRO REDDİ (HTTP 200 + IsError): kullanıcı SEBEBİ görür, siparişe "gönderildi" YAZILMAZ', async () => {
    mikroYaniti({ IsError: true, ErrorMessage: 'Stok kodu bulunamadı: DMR-12' });
    const { res } = await gonder(SIPARIS);
    const yanit = res!.govde as IrsaliyeYaniti;
    const mesaj = irsaliyeYanitMesaji(res!.kod, yanit, 'tr');
    expect(mesaj.tur).toBe('error');
    expect(mesaj.metin).toContain('Stok kodu bulunamadı: DMR-12');
    expect(irsaliyeSonucYamasi(yanit)).toBeNull();
  });

  it('İSTEMCİ KAPISI sunucuyla AYNI kararı verir: faturasız / deposuz / KDV\'siz / carisiz sipariş için istek HİÇ kurulmaz', async () => {
    mikroYaniti({ IsError: false, Data: {} });
    expect((await gonder({ ...SIPARIS, faturali: false })).istek.neden).toBe('faturasiz');
    expect((await gonder({ ...SIPARIS, depoNo: undefined })).istek.neden).toBe('depoYok');
    expect((await gonder({ ...SIPARIS, kdvOran: undefined })).istek.neden).toBe('kdvYok');
    expect((await gonder(SIPARIS, { ...LEAD, mikroCariKod: '' })).istek.neden).toBe('cariYok');
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
  });

  it('SAVUNMA KATMANI: istemci kapısı atlanıp ham istek atılırsa sunucu da reddeder (deposuz → 400, faturasız → 400)', async () => {
    mikroYaniti({ IsError: false, Data: {} });
    const govde = irsaliyeIstegi(SIPARIS as never, LEAD as never).govde!;
    const deposuz = agdanGecir({ shipment: { ...govde.shipment, depoNo: undefined }, firebaseId: 'SIP-2' });
    const faturasiz = agdanGecir({ shipment: { ...govde.shipment, faturali: false }, firebaseId: 'SIP-3' });
    expect((await d.cagir('POST', '/api/mikro/irsaliye/kaydet', deposuz)).kod).toBe(400);
    expect((await d.cagir('POST', '/api/mikro/irsaliye/kaydet', faturasiz)).kod).toBe(400);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
  });
});

// ── 2026-09-19 uçtan uca inceleme bulguları ────────────────────────────────────────────────────────────────────
describe('e-İrsaliye — yetki, sipariş işareti, mükerrer koruması', () => {
  it('ROL KAPISI: rota zincirinde `shipments:write` erişim kapısı var (eski: yalnız requireAuth+MFA — salt-okunur rol resmî belge kesebiliyordu)', () => {
    const zincir = d.app.zincirler['POST /api/mikro/irsaliye/kaydet'] as Array<{ erisimKapisi?: string }>;
    expect(zincir.some(m => m?.erisimKapisi === 'shipments:write')).toBe(true);
  });

  it('başarıda `orders/{id}` işaretini SUNUCU yazar (istemcinin RBAC\'a takılabilen yazımına bağımlı değil) ve sevkiyat satırı anlamlı alanlar taşır', async () => {
    d.snapAyarla('orders', { 'SIP-1': { customerName: 'Şirin İnşaat', companyId: 'A' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-2026-000045' } });
    await gonder(SIPARIS);
    const sip = d.koleksiyon('orders').find(y => y.ref.id === 'SIP-1');
    expect(sip?.data).toMatchObject({ irsaliyeGonderildi: true, irsaliyeNo: 'IRS-2026-000045' });
    const sevk = d.koleksiyon('shipments').find(y => y.ref.id === 'SIP-1');
    expect(sevk?.data).toMatchObject({ customerName: 'Şirin İnşaat', mikroSynced: true, irsaliyeNo: 'IRS-2026-000045' });
    expect(String(sevk?.data?.destination ?? '')).not.toBe('');     // Lojistik → Sevkiyatlar'da BOŞ iskelet satır olmasın
  });

  it('MÜKERRER kapısı SİPARİŞ işaretine de bakar: `shipments` iskeleti silinmiş olsa bile ikinci belge gitmez (mutasyon-ayırt-edici)', async () => {
    d.snapAyarla('orders', { 'SIP-1': { customerName: 'Şirin İnşaat', companyId: 'A', irsaliyeGonderildi: true, irsaliyeNo: 'IRS-2026-000045' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-YENI' } });
    const { res } = await gonder(SIPARIS);
    expect(res?.kod).toBe(409);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
  });

  it('başka kiracının SİPARİŞİ → 404, Mikro\'ya gidilmez', async () => {
    d.snapAyarla('orders', { 'SIP-1': { customerName: 'Başka Firma', companyId: 'B' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'X' } });
    const { res } = await gonder(SIPARIS);
    expect(res?.kod).toBe(404);
    expect(vi.mocked(mikroPost)).not.toHaveBeenCalled();
  });

  it('KURUŞ: kesirli miktarın satır tutarı kuruşa yuvarlanır (2,5 × 175,07 = 437,68 — ham 437,67499… gitmez)', async () => {
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-K' } });
    await gonder({ ...SIPARIS, lineItems: [{ sku: 'BRD-8', name: 'BORDÜR 8cm', quantity: 2.5, price: 175.07 }] });
    const [, govde] = vi.mocked(mikroPost).mock.calls[0] as unknown as [string, { evraklar: Array<{ satirlar: Array<Record<string, number>> }> }];
    const satir = govde.evraklar[0].satirlar[0];
    expect(satir.sth_tutar).toBe(437.68);     // (irsaliye satırında KDV TUTARI yazılmaz — sth_vergi 0; KDV yuvarlaması fatura testinde)
  });
});

describe('e-İrsaliye — Mikro BAŞARILI ama yerel yazım düştü (mükerrer belge riski)', () => {
  it('yanıt yine success:true + localUpdateFailed:true döner — 500 dönseydi kullanıcı YENİDEN gönderir, Mikro\'da ikinci resmî belge oluşurdu (mutasyon-ayırt-edici)', async () => {
    d.snapAyarla('orders', { 'SIP-1': { customerName: 'Şirin İnşaat', companyId: 'A' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-2026-000046' } });
    // DB kesintisi: `shipments` yazımı reddedilir (okuma çalışır).
    const db = d.C.getAdminDb() as unknown as { collection: (c: string) => { doc: (id?: string) => Record<string, unknown> } };
    const asil = db.collection.bind(db);
    db.collection = (c: string) => {
      const kol = asil(c);
      if (c !== 'shipments') return kol;
      return { ...kol, doc: (id?: string) => ({ ...kol.doc(id), set: async () => { throw new Error('PG bağlantısı koptu'); } }) };
    };
    const hataGunlugu = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { res } = await gonder(SIPARIS);

    expect(res?.kod).toBe(200);
    expect(res?.govde).toMatchObject({ success: true, irsaliyeNo: 'IRS-2026-000046', localUpdateFailed: true });
    expect(hataGunlugu).toHaveBeenCalled();
    hataGunlugu.mockRestore();
  });

  it('sipariş işareti `update` ile yazılır (set-merge DEĞİL): arada silinmiş siparişi 3 alanlı, companyId\'siz zombi olarak DİRİLTMEZ', async () => {
    d.snapAyarla('orders', { 'SIP-1': { customerName: 'Şirin İnşaat', companyId: 'A' } });
    mikroYaniti({ IsError: false, Data: { irsaliyeNo: 'IRS-2026-000047' } });
    await gonder(SIPARIS);
    expect(d.koleksiyon('orders').map(y => y.op)).toEqual(['update']);
  });
});

