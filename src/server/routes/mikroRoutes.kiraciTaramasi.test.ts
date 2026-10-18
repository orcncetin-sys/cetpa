/**
 * mikroRoutes.kiraciTaramasi.test.ts — gece ve aylık Mikro SQL senkronunun hedef kiracı çözümü (`sqlSenkronHedefTenant`),
 * GERÇEK `mikroRoutes.ts` gövdesiyle (şartname «dış rol kapanışı» D12 / T11 — taramanın ÜÇÜNCÜ kopyası).
 *
 * NEDEN VAR: kiracı taramasının üç kopyası vardı — `serverTenantId` (server.ts), `cronCompanyId` (crons.ts) ve buradaki.
 * İlk düzeltme ilk ikisine uygulanmış, bu kopya her `users` belgesini saymaya devam etmişti: giriş ekranından hesap açan
 * yabancının rolsüz belgesi ikinci kiracı sayılıyor, 03:20 SQL senkronu ve ayın 1'indeki tam senkron «hedef tenant belirsiz»
 * deyip atlıyordu (faturalar, cari hareketler, stok hareketleri güncellenmiyordu — hata vermeden).
 *
 * `sqlSenkronHedefTenant` rota kaydının kapanışında yaşar, dışarıdan çağrılamaz. Burada rotalar gerçek modülle kaydedilir,
 * zamanlayıcıya verilen iş yakalanır ve elle koşturulur. ÖLÇÜLEN: işin Mikro'dan çektiği satırı HANGİ kiracıyla yazdığı
 * (`companyId` damgası) ve belirsiz durumda Mikro'ya hiç sorgu gitmediği.
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting) — tarif: mikroRoutes.testDuzenegi `mikroMockTarifi`.
 * Mikro'ya, veritabanına, ağa istek YOK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroKolonlar, mikroPost, mikroSql } from '../mikroClient.js';

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
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

type Kullanicilar = Record<string, Record<string, unknown>>;
const SAHIP: Kullanicilar = { 'sahip-uid': { email: 'sahip@example.test', role: 'Admin' } };                       // kurucu: kiracı alanı yok → kiracı = kendi kimliği
const PERSONEL: Kullanicilar = { 'personel-uid': { role: 'Sales', companyId: 'sahip-uid' } };
const YABANCI: Kullanicilar = { 'yabanci-uid': { name: 'Yabancı', email: 'yabanci@example.test' } };                // istemcinin açılış yazımı: rol / kiracı alanı yok
const COP: Kullanicilar = { 'cop-uid': { role: 1, companyId: 'UYDURMA' } };                                         // rol alanında geçersiz değer
const IKINCI: Kullanicilar = { 'ikinci-sahip': { email: 'ikinci@example.test', role: 'Admin' } };

const GECE = '20 3 * * *';
const AYLIK = '0 2 1 * *';

interface Kosu { d: Duzenek; sorguSayisi: number; yazilanKiracilar: string[]; usersOkuma: number; belirsizIletisi: string[] }

/** Rotaları kurar, `users` içeriğini verir, zamanlanmış işi ELLE koşturur. Mikro her sorguya boş döner; yalnız sipariş listesinin
 *  ilk sayfası TEK satır verir (bu tanımın satır sonrası işlemi yok) — o satırın hangi kiracıyla yazıldığı ölçülür. */
async function kostur(ifade: string, kullanicilar: Kullanicilar, ortamKiracisi?: string, belgeler: Record<string, Array<Record<string, unknown>>> = {}): Promise<Kosu> {
  vi.stubEnv('MIKRO_CRON_SYNC', 'true');
  vi.stubEnv('MIKRO_CRON_COMPANY_ID', ortamKiracisi);          // `undefined` → tanımsız (canlının bugünkü durumu)
  vi.mocked(cron.schedule).mockClear();
  const d = duzenekKur();
  d.snapAyarla('users', kullanicilar);
  // `loadCompanyDocs` sahtesi (koleksiyon → dokümanlar; yoksa []): gece faturadan-sipariş adımı (2026-10-18) bir satış faturası
  // görsün diye — boş liste adımı erken dönüş dalına düşürür ve «adım koştu mu» sorusu yazımdan okunamazdı.
  vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) => belgeler[coll] ?? []) as typeof d.C.loadCompanyDocs);
  let sorguSayisi = 0;
  vi.mocked(mikroSql).mockImplementation((async (sql: string) => {
    sorguSayisi++;
    const siparisIlkSayfa = / FROM SIPARISLER /.test(sql) && sql.includes('OFFSET 0 ROWS');
    return { rows: siparisIlkSayfa ? [{ sip_Guid: 'SIP-GUID-1', sip_evrakno_sira: 7 }] : [], hata: null };
  }) as unknown as typeof mikroSql);
  vi.mocked(mikroKolonlar).mockResolvedValue([]);
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
  const koleksiyon = vi.spyOn(d.C.getAdminDb(), 'collection');
  const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const kayit = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === ifade);
  expect(kayit, `${ifade} işi kayıtlı`).toBeDefined();
  if (!kayit) throw new Error('iş kayıtlı değil');
  await (kayit[1] as () => Promise<void>)();

  return {
    d, sorguSayisi,
    yazilanKiracilar: d.yazilan.filter(y => y.data?.source === 'mikro_sql').map(y => String(y.data?.companyId)),
    usersOkuma: koleksiyon.mock.calls.filter(c => c[0] === 'users').length,
    belirsizIletisi: hata.mock.calls.map(c => String(c[0])).filter(m => m.includes('tenant var')),
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('gece SQL senkronu (03:20) — hedef kiracı `users` taramasında yalnız ROLÜ olan belgelerden çözülür', () => {
  it('sahip + personel + giriş ekranından hesap açan yabancı (rolsüz) + rol alanı geçersiz belge → iş KOŞAR, satır SAHİBİN kiracısına yazılır', async () => {
    const k = await kostur(GECE, { ...SAHIP, ...PERSONEL, ...YABANCI, ...COP });
    expect(k.belirsizIletisi).toEqual([]);
    expect(k.sorguSayisi).toBeGreaterThanOrEqual(13);              // her tanım Mikro'ya en az bir sayfa sordu
    expect(k.yazilanKiracilar).toEqual(['sahip-uid']);
    expect(k.d.koleksiyon('mikroSiparisler').map(y => [y.ref.id, y.data?.companyId, y.data?.sip_evrakno_sira])).toEqual([['SIP-GUID-1', 'sahip-uid', 7]]);
    expect(k.usersOkuma).toBe(1);
  });

  it('yalnız sahip → sahibin kiracısı (bugünkü canlı: tek `users` belgesi)', async () => {
    const k = await kostur(GECE, SAHIP);
    expect([k.belirsizIletisi, k.yazilanKiracilar]).toEqual([[], ['sahip-uid']]);
  });

  it('iki GERÇEK kiracı (rolü olan ikinci firma) → belirsiz: iş ATLANIR, Mikro\'ya sorgu GİTMEZ, hiçbir şey yazılmaz', async () => {
    const k = await kostur(GECE, { ...SAHIP, ...PERSONEL, ...IKINCI });
    expect(k.belirsizIletisi).toEqual(['Mikro SQL senkron: 2 tenant var ve MIKRO_CRON_COMPANY_ID tanımsız → atlandı.']);
    expect([k.sorguSayisi, k.d.yazilan, k.d.syncLog.mock.calls.length]).toEqual([0, [], 0]);
  });

  it('rolü olan belge YOKSA (yalnız rolsüz hesaplar) → belirsiz: yabancının kimliği hedef kiracı OLAMAZ', async () => {
    const k = await kostur(GECE, { ...YABANCI, ...COP });
    expect(k.belirsizIletisi).toEqual(['Mikro SQL senkron: 0 tenant var ve MIKRO_CRON_COMPANY_ID tanımsız → atlandı.']);
    expect([k.sorguSayisi, k.d.yazilan]).toEqual([0, []]);
  });

  it('ortam değeri dolu → o; `users` HİÇ taranmaz (iki gerçek kiracı varken de)', async () => {
    const k = await kostur(GECE, { ...SAHIP, ...IKINCI, ...YABANCI }, 'ORTAM-KIRACISI');
    expect([k.belirsizIletisi, k.yazilanKiracilar, k.usersOkuma]).toEqual([[], ['ORTAM-KIRACISI'], 0]);
  });
});

// Şartname «fatura gövde + gece MF» § 3 / § 6 (gece-isi-4, 2026-10-18): gece faturadan-sipariş adımı YENİ çözücü yazmaz — işin
// yukarıda çözdüğü `companyId`'yi kullanır. Kiracı belirsizse adım HİÇ koşmaz: `orders` yazılmaz, syncLog yazılmaz (günlük =
// mevcut konsol iletisi, TEK).
describe('gece faturadan-sipariş adımı (03:20, son adım) — AYNI kiracı çözümü', () => {
  const SATIS_FATURASI = { cha_evrakno_seri: '', cha_evrakno_sira: 412, cha_tarihi: '2026-10-17T00:00:00', cha_tip: 0, cha_kod: '120.01.0042', cha_meblag: 15000 };
  const adimSatirlari = (k: Kosu) => k.d.syncLog.mock.calls.filter(c => c[0] === 'faturadan-siparis');

  it('iki GERÇEK kiracı, ortam değeri tanımsız → adım ÇAĞRILMAZ: orders yazılmaz, syncLog yazılmaz, «tenant var» iletisi TEK', async () => {
    const k = await kostur(GECE, { ...SAHIP, ...PERSONEL, ...IKINCI }, undefined, { mikroFaturalar: [SATIS_FATURASI] });
    expect(k.belirsizIletisi).toEqual(['Mikro SQL senkron: 2 tenant var ve MIKRO_CRON_COMPANY_ID tanımsız → atlandı.']);
    expect(k.d.koleksiyon('orders')).toEqual([]);
    expect(k.d.syncLog).not.toHaveBeenCalled();
    expect(vi.mocked(k.d.C.loadCompanyDocs)).not.toHaveBeenCalled();     // işlev hiç koşmadı (ilk okuması mikroFaturalar)
  });

  it('ortam değeri tanımsız ama rolü olan TEK kiracı (+ rolsüz yabancı) → adım KOŞAR ve o kiracıya yazar', async () => {
    const k = await kostur(GECE, { ...SAHIP, ...PERSONEL, ...YABANCI }, undefined, { mikroFaturalar: [SATIS_FATURASI] });
    expect(k.belirsizIletisi).toEqual([]);
    expect(k.d.koleksiyon('orders').map(y => [y.ref.id, y.data?.companyId])).toEqual([['mikrofat__sahip-uid__-412', 'sahip-uid']]);
    expect(adimSatirlari(k)).toHaveLength(1);
    expect(adimSatirlari(k)[0]?.[9]).toEqual({ denetimKiracisi: 'sahip-uid' });
    expect(k.usersOkuma).toBe(1);                                          // kopya çözücü yok: `users` yine TEK kez taranır
  });
});

describe('aylık TAM senkron (ayın 1\'i 02:00) — AYNI çözüm', () => {
  it('sahip + rolsüz yabancı → iş KOŞAR, sahibin kiracısına yazar; iki gerçek kiracı → atlanır', async () => {
    const tek = await kostur(AYLIK, { ...SAHIP, ...YABANCI });
    expect([tek.belirsizIletisi, tek.yazilanKiracilar]).toEqual([[], ['sahip-uid']]);
    const iki = await kostur(AYLIK, { ...SAHIP, ...IKINCI });
    expect(iki.belirsizIletisi).toHaveLength(1);
    expect([iki.sorguSayisi, iki.d.yazilan]).toEqual([0, []]);
  });
});
