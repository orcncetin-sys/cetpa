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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import cron from 'node-cron';
import { duzenekKur, pgliteDocs, type Duzenek, type PgliteDocs, type SahteSorgu } from './mikroRoutes.testDuzenegi';
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

  // Şartname «Mikro bağlantı B» T-B1-2 (BH2 tablosu, § 3.4): gece bakiye adımı hareketleri Mikro hesap koduyla eşler → import her
  // belgeye `mikroKod` yazar (var olan ve yeni); kod alanı bulunamazsa / boşsa alan YAZILMAZ (merge önceki değere dokunmaz).
  it('T-B1-2: var olan ve yeni hesapta `mikroKod` (kırpılmış ban_kod); var olanda bakiye anahtarı yok; kodsuz satırda alan yok', async () => {
    d.snapAyarla('bankAccounts', { 'g-var': { companyId: 'A', bankName: 'Ziraat', balance: 125000 } });
    mikroSatirlari([
      { ban_Guid: 'g-var', ban_adi: 'ZİRAAT', ban_kod: ' 102.01 ' },
      { ban_Guid: 'g-yeni', ban_adi: 'VAKIF', ban_kod: '102.02' },
      { ban_Guid: 'g-kodsuz', ban_adi: 'HALK', ban_kod: '' },
    ]);
    await kos('/api/mikro/import/banka', 'mikroImport-banka');
    const v = yazim('bankAccounts', 'g-var')?.data ?? {};
    expect(v).toMatchObject({ mikroKod: '102.01' });
    expect(['balance', 'currency', 'accountHolder', 'accountType'].filter(k => k in v)).toEqual([]);
    expect(yazim('bankAccounts', 'g-yeni')?.data).toMatchObject({ mikroKod: '102.02', balance: null });
    expect('mikroKod' in (yazim('bankAccounts', 'g-kodsuz')?.data ?? {})).toBe(false);
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

  // BH18 (şartname «Mikro bağlantı B»): her gece yazılan `currency: 'TRY'` elle düzeltilen dövizi geri çeviriyordu; artık yalnız
  // yeni belgede. Kasa kodu da `mikroKod` olarak yazılır (T-B1-2).
  it("BH18: VAR OLAN kasada `currency` anahtarı YOK (elle 'USD' korunur); YENİ kasa `currency: 'TRY'`; ikisinde de `mikroKod`", async () => {
    d.snapAyarla('kasalar', { 'k-usd': { companyId: 'A', kasaAdi: 'Döviz', currency: 'USD', bakiye: 10 } });
    mikroSatirlari([{ kas_Guid: 'k-usd', kas_adi: 'DÖVİZ KASASI', kas_kod: 'K2' }, { kas_Guid: 'k-tl', kas_adi: 'TL KASA', kas_kod: 'K1' }]);
    await kos('/api/mikro/import/kasa', 'mikroImport-kasa');
    const v = yazim('kasalar', 'k-usd')?.data ?? {};
    expect(v).toMatchObject({ kasaAdi: 'DÖVİZ KASASI', mikroKod: 'K2', source: 'mikro' });
    expect(['currency', 'bakiye'].filter(k => k in v)).toEqual([]);
    expect(yazim('kasalar', 'k-tl')?.data).toMatchObject({ kasaAdi: 'TL KASA', mikroKod: 'K1', currency: 'TRY', bakiye: null });
  });

  it('yabancı kiracının kasası «var olan» sayılmaz', async () => {
    d.snapAyarla('kasalar', { 'k-yabanci': { companyId: 'B', kasaAdi: 'Başka', bakiye: 100 } });
    mikroSatirlari([{ kas_Guid: 'k-yabanci', kas_adi: 'KASA' }]);
    await kos('/api/mikro/import/kasa', 'mikroImport-kasa');
    expect(yazim('kasalar', 'k-yabanci')?.data).toMatchObject({ bakiye: null });
  });
});

// ── Şartname «Mikro bağlantı B» T-B1-4 (BH2 / BH7 / BH17): 03:20 gece adımı GERÇEK SQL ile (PGlite) ───────────────────────────────
describe('T-B1-4 · 03:20 banka / kasa adımı · her dalda TAM BİR syncLog satırı', () => {
  let pg: PgliteDocs;
  beforeAll(async () => { pg = await pgliteDocs(); }, 60_000);
  /** 03:20 işini PGlite havuzuyla koşturur; diğer adımlar boş Mikro yanıtıyla geçer. */
  const geceKos = async (sorgu: SahteSorgu): Promise<Duzenek> => {
    vi.stubEnv('MIKRO_CRON_SYNC', 'true');
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'A');
    vi.mocked(cron.schedule).mockClear();
    const dc = duzenekKur();
    dc.pgAyarla(sorgu);
    vi.mocked(mikroSql).mockResolvedValue({ rows: [], hata: null });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gece = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === '20 3 * * *');
    if (!gece) throw new Error('03:20 işi kayıtlı değil');
    try { await (gece[1] as () => Promise<void>)(); } finally { vi.unstubAllEnvs(); }
    return dc;
  };
  const satir = (dc: Duzenek) => dc.syncLog.mock.calls.filter(c => c[0] === 'banka-kasa-bakiye');
  const kur = async () => {
    await pg.temizle();
    await pg.belgeKoy('bankAccounts', 'b-sifir', { companyId: 'A', source: 'mikro', bankName: 'ZİRAAT', balance: 0 });
    await pg.belgeKoy('bankAccounts', 'b-elle', { companyId: 'A', source: 'mikro', bankName: 'İŞ', balance: 125000, mikroKod: '102.02' });
    await pg.belgeKoy('bankAccounts', 'b-yabanci', { companyId: 'B', source: 'mikro', bankName: 'BAŞKA', balance: 0 });
    await pg.belgeKoy('kasalar', 'k-sifir', { companyId: 'A', source: 'mikro', kasaAdi: 'MERKEZ', bakiye: 0 });
  };

  it('tamam: 0 → null (yalnız kiracının Mikro belgesi), elle 125000 KALIR ve özette N = 1; TEK başarılı satır, hedef kiracıya; yayın', async () => {
    await kur();
    const dc = await geceKos(pg.sorgu);
    expect(satir(dc)).toEqual([['banka-kasa-bakiye', 'bankAccounts',
      '0 → null geçişi: 1 banka (b-sifir) · 1 kasa (k-sifir) · elle girilmiş değer korundu: 1 (banka b-elle [102.02]: 125000) · '
      + 'etiketsiz Mikro belgesi: banka 0, kasa 0 · bakiye hesabı yok (Ö-B1 ölçüsü ve Mikro açılış fişi bekleniyor)',
      true, null, null, expect.any(Number), { uid: 'system', email: '' }, undefined, { denetimKiracisi: 'A' }]]);
    expect((await pg.belgeOku('bankAccounts', 'b-sifir'))?.balance).toBeNull();
    expect((await pg.belgeOku('bankAccounts', 'b-elle'))?.balance).toBe(125000);
    expect((await pg.belgeOku('bankAccounts', 'b-yabanci'))?.balance).toBe(0);
    expect((await pg.belgeOku('kasalar', 'k-sifir'))?.bakiye).toBeNull();
    expect(vi.mocked(dc.C.broadcastDocChange).mock.calls.filter(c => c[0] === 'bankAccounts' || c[0] === 'kasalar').map(c => [c[0], c[2]]))
      .toEqual([['bankAccounts', 'b-sifir'], ['kasalar', 'k-sifir']]);
    // İkinci gece: 0 satır değişir (idempotent), yine TEK satır.
    const dc2 = await geceKos(pg.sorgu);
    expect(satir(dc2).map(c => String(c[2]).split(' · ').slice(0, 2).join(' · '))).toEqual(['0 → null geçişi: 0 banka · 0 kasa']);
  });

  it('SQL hatası: TEK başarısız satır (hata metniyle); değerler değişmez, yayın yok', async () => {
    await kur();
    const bozuk: SahteSorgu = async (sql, p) => {
      if (sql.startsWith('UPDATE docs SET data = jsonb_set')) throw new Error('bağlantı koptu');
      return pg.sorgu(sql, p);
    };
    const dc = await geceKos(bozuk);
    expect(satir(dc)).toEqual([['banka-kasa-bakiye', 'bankAccounts', 'gece senkronu', false, null, 'bağlantı koptu',
      expect.any(Number), { uid: 'system', email: '' }, undefined, { denetimKiracisi: 'A' }]]);
    expect((await pg.belgeOku('bankAccounts', 'b-sifir'))?.balance).toBe(0);
    expect((await pg.belgeOku('kasalar', 'k-sifir'))?.bakiye).toBe(0);
    expect(vi.mocked(dc.C.broadcastDocChange).mock.calls.filter(c => c[0] === 'bankAccounts' || c[0] === 'kasalar')).toEqual([]);
  });
});
