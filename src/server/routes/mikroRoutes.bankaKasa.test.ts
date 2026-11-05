/**
 * mikroRoutes.bankaKasa.test.ts: banka / kasa importu artık sahte ₺0 YAZMAZ (şartname «Mikro bağlantı A» A5, 2026-11-05).
 *
 * NEDEN VAR: banka importu her satıra `balance: 0`, kasa importu `bakiye: 0` yazıyordu; `merge: true` alanı her gece (00:20Z,
 * 03:20 bloğunun SQL tanımı) ezdiği için elle girilen bakiye de ertesi gece 0 oluyordu. 0 bilinen sayı sayıldığı için ekranda
 * «tutarsız / bilinmiyor» notu da çıkmıyordu. Kural: VAR OLAN belgede bakiye anahtarı HİÇ konmaz (merge alana dokunmaz); YENİ
 * belgede `null` (bilinmiyor). Gece ve elle yol AYNI `postProcess`'i koşar (makeMikroSqlImport); burada elle uç sınanır.
 * Canlıdaki mevcut 0 değerlerine bu dilimde dokunulmaz (veri düzeltmesi kullanıcı kararı).
 *
 * vi.mock blokları BURADA kalmak zorunda (vitest hoisting); tarif: mikroRoutes.testDuzenegi `mikroMockTarifi`.
 * Mikro'ya, veritabanına, ağa istek YOK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroSql } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS', resolveSentinels: (v: unknown) => v }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })),
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => { d = duzenekKur(); vi.mocked(mikroSql).mockReset(); });
afterEach(async () => {
  for (const ad of ['mikroImport-banka', 'mikroImport-kasa']) await d.isBitisi(ad);
  vi.restoreAllMocks();
});

/** Mikro'nun ilk sayfası `rows`, sonrakiler boş (sayfalama biter). */
const mikroSatirlari = (rows: Record<string, unknown>[]) =>
  vi.mocked(mikroSql).mockImplementation((async (sql: string) => ({ rows: sql.includes('OFFSET 0 ROWS') ? rows : [], hata: null })) as unknown as typeof mikroSql);
const kos = async (yol: '/api/mikro/import/banka' | '/api/mikro/import/kasa', is: string) => {
  const res = await d.cagir('POST', yol);
  expect(res.govde).toMatchObject({ success: true, started: true, job: is });
  return d.isBitisi(is);
};
const yazim = (coll: string, id: string) => d.koleksiyon(coll).find(y => y.ref.id === id && y.op === 'set');

describe('banka importu (bankAccounts) · bakiye Mikro tanımında YOK: 0 yazılmaz', () => {
  it('elle 125000 girilmiş VAR OLAN hesap gece / elle import sonrası 125000 KALIR: gövdede `balance` anahtarı yok, yazım merge', async () => {
    d.snapAyarla('bankAccounts', { 'g-var': { companyId: 'A', bankName: 'Ziraat', balance: 125000, currency: 'TRY' } });
    mikroSatirlari([{ ban_Guid: 'g-var', ban_adi: 'ZİRAAT BANKASI' }]);
    await kos('/api/mikro/import/banka', 'mikroImport-banka');
    const y = yazim('bankAccounts', 'g-var');
    expect(y?.data).toMatchObject({ companyId: 'A', bankName: 'ZİRAAT BANKASI', source: 'mikro' });
    // Yazım toplu `batch.set(…, { merge: true })`: anahtarı olmayan alan KORUNUR (pgShim mergeDocData). Düzenek batch seçeneğini
    // kaydetmediği için iddia gövdededir: anahtar yoksa 125000'e dokunulmaz; `balance: 0` geri gelirse bu satır kırmızı.
    expect(y && 'balance' in (y.data ?? {})).toBe(false);
  });

  it('YENİ hesap `balance: null` (bilinmiyor) ile açılır; 0 DEĞİL', async () => {
    mikroSatirlari([{ ban_Guid: 'g-yeni', ban_adi: 'İŞ BANKASI' }]);
    await kos('/api/mikro/import/banka', 'mikroImport-banka');
    expect(yazim('bankAccounts', 'g-yeni')?.data).toMatchObject({ bankName: 'İŞ BANKASI', balance: null, currency: 'TRY', accountType: 'Vadesiz', accountHolder: '' });
  });

  // İnceleme MBA1 #3 (2026-11-05): korunan USD bakiyesi, her gece yazılan `currency: 'TRY'` ile TRY toplamına giriyordu.
  it('VAR OLAN USD hesabında döviz / hesap sahibi / hesap türü / bakiye anahtarlarının HİÇBİRİ gövdede yok', async () => {
    d.snapAyarla('bankAccounts', { 'g-usd': { companyId: 'A', bankName: 'Garanti USD', balance: 10000, currency: 'USD', accountHolder: 'X' } });
    mikroSatirlari([{ ban_Guid: 'g-usd', ban_adi: 'GARANTİ' }]);
    await kos('/api/mikro/import/banka', 'mikroImport-banka');
    const veri = yazim('bankAccounts', 'g-usd')?.data ?? {};
    expect(veri).toMatchObject({ companyId: 'A', bankName: 'GARANTİ', source: 'mikro' });
    expect(['currency', 'accountHolder', 'accountType', 'balance'].filter(k => k in veri)).toEqual([]);
  });

  it("yabancı kiracının belgesi «var olan» SAYILMAZ (bakiyesi korunacak hesap gibi davranılmaz); etiketsiz eski belge sayılır", async () => {
    d.snapAyarla('bankAccounts', {
      'g-yabanci': { companyId: 'B', bankName: 'Başka', balance: 9000 },
      'g-eski':    { bankName: 'Eski Hesap', balance: 500 },                      // companyId'siz eski kayıt
    });
    mikroSatirlari([{ ban_Guid: 'g-yabanci', ban_adi: 'A BANKASI' }, { ban_Guid: 'g-eski', ban_adi: 'ESKİ' }]);
    await kos('/api/mikro/import/banka', 'mikroImport-banka');
    expect(yazim('bankAccounts', 'g-yabanci')?.data).toMatchObject({ balance: null });
    const eski = yazim('bankAccounts', 'g-eski');
    expect(eski && 'balance' in (eski.data ?? {})).toBe(false);
  });
});

describe('kasa importu (kasalar) · aynı kural', () => {
  it('VAR OLAN kasada `bakiye` anahtarı konmaz; YENİ kasa `bakiye: null`', async () => {
    d.snapAyarla('kasalar', { 'k-var': { companyId: 'A', kasaAdi: 'Merkez', bakiye: 3200 } });
    mikroSatirlari([{ kas_Guid: 'k-var', kas_adi: 'MERKEZ KASA' }, { kas_Guid: 'k-yeni', kas_adi: 'ŞUBE KASA' }]);
    await kos('/api/mikro/import/kasa', 'mikroImport-kasa');
    const v = yazim('kasalar', 'k-var');
    expect(v?.data).toMatchObject({ companyId: 'A', kasaAdi: 'MERKEZ KASA', source: 'mikro' });
    expect(v && 'bakiye' in (v.data ?? {})).toBe(false);
    expect(yazim('kasalar', 'k-yeni')?.data).toMatchObject({ kasaAdi: 'ŞUBE KASA', bakiye: null });
  });

  it('yabancı kiracının kasası «var olan» sayılmaz', async () => {
    d.snapAyarla('kasalar', { 'k-yabanci': { companyId: 'B', kasaAdi: 'Başka', bakiye: 100 } });
    mikroSatirlari([{ kas_Guid: 'k-yabanci', kas_adi: 'KASA' }]);
    await kos('/api/mikro/import/kasa', 'mikroImport-kasa');
    expect(yazim('kasalar', 'k-yabanci')?.data).toMatchObject({ bakiye: null });
  });
});
