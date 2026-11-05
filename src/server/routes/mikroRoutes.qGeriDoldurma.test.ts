/**
 * mikroRoutes.qGeriDoldurma.test.ts — MF siparişinin `faturali` alanı SERİDEN (şartname `.wf/SARTNAME-q-serisi-v3.md` «Kapı sonrası
 * hükümler» QH5, 2026-11-05; test T6 + T6 EK; mutasyonlar M6, M37). Q serisi faturasızdır (K1, K4): seri Q başlığından türeyen MF
 * `faturali: false` doğar; GECE GERİ DOLDURMASI (03:20, `faturadanSiparisCalistir`) mevcut MF'lerin hedefini de seriden kurar —
 * MF-Q1 ilk gece kendiliğinden `true → false` döner, ikinci gece hiçbir şey yazılmaz (geri dönüş yok).
 *
 * Düzenek `mikroRoutes.geceFaturadanSiparis.test.ts` ile AYNI kalıp (GERÇEK rota modülü + sahte saat + `node-cron` sahtesinden
 * yakalanan 03:20 işi). Mikro'ya, veritabanına, ağa istek YOK.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { getMikroCreds, mikroKolonlar, mikroPost, mikroSql } from '../mikroClient.js';
import { faturadanSiparis } from '../mikro/eslemeFatura.js';

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
    mikroPost: vi.fn(),
    mikroSql: vi.fn(),
    mikroKolonlar: vi.fn(async () => [] as string[]),
    mikroVergiOranlari: vi.fn(async () => new Map<number, number>()),
    vergiOraniCoz: vi.fn(() => null),
  };
});

const GECE = '20 3 * * *';
/** Satış faturası başlığı (fatura-listesi importunun `mikroFaturalar`'a yazdığı ham cha_* biçimi). */
const BASLIK = { cha_evrakno_seri: '', cha_evrakno_sira: 412, cha_tarihi: '2026-10-17T00:00:00', cha_tip: 0, cha_kod: '120.01.0042', cha_meblag: 15000 };

interface KosuSecenegi {
  /** `loadCompanyDocs` sahtesi: koleksiyon → dokümanlar (yoksa []). Fırlatan işlev istisna dalını açar. */
  belgeler?: Record<string, Array<Record<string, unknown>> | (() => never)>;
  /** Hedef kiracı ortam değeri (`MIKRO_CRON_COMPANY_ID`); `undefined` → tanımsız, `users` taranır. */
  ortamKiracisi?: string | undefined;
  kullanicilar?: Record<string, Record<string, unknown>>;
  kilit?: { aciklama: string; baslangic: string };
  /** Mikro kimliği yok (`getMikroCreds` → null): iş adıma VARMADAN biter (§ 3 uzlaştırma). */
  kimlikYok?: boolean;
}

/** Rotaları GERÇEK modülle kurar, zamanlayıcıya verilen 03:20 işini yakalar ve sahte saatle koşturur. */
async function kostur(s: KosuSecenegi = {}): Promise<{ d: Duzenek; hata: ReturnType<typeof vi.spyOn>; uyari: ReturnType<typeof vi.spyOn> }> {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T00:20:00.000Z') });   // 03:20 İstanbul
  vi.stubEnv('MIKRO_CRON_SYNC', 'true');
  vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'ortamKiracisi' in s ? s.ortamKiracisi : 'A');
  vi.mocked(cron.schedule).mockClear();
  const d = duzenekKur();
  if (s.kullanicilar) d.snapAyarla('users', s.kullanicilar);
  if (s.kilit) d.kilitAyarla(s.kilit);
  vi.mocked(mikroSql).mockImplementation((async () => ({ rows: [], hata: null })) as unknown as typeof mikroSql);
  vi.mocked(mikroKolonlar).mockResolvedValue([]);
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
  vi.mocked(d.C.loadCompanyDocs).mockImplementation((async (coll: string) => {
    const k = s.belgeler?.[coll];
    if (typeof k === 'function') return k();
    return k ?? [];
  }) as typeof d.C.loadCompanyDocs);
  const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const kayit = vi.mocked(cron.schedule).mock.calls.find(c => c[0] === GECE);
  expect(kayit, `${GECE} işi kayıtlı`).toBeDefined();
  if (!kayit) throw new Error('iş kayıtlı değil');
  // Yalnız BU koşunun tek kimlik okuması: işin içinde kiracı çözüldükten hemen sonra (3704).
  if (s.kimlikYok) vi.mocked(getMikroCreds).mockResolvedValueOnce(null);
  await (kayit[1] as () => Promise<void>)();
  return { d, hata, uyari };
}

/** Bir MF siparişi (mevcut doküman). */
const mf = (seri: string, sira: string, ek: Record<string, unknown> = {}) => ({
  id: `mikrofat__A__${seri}-${sira}`, source: 'mikro-fatura', companyId: 'A', orderNumber: `MF-${seri}${sira}`,
  mikroEvrak: { seri, sira }, faturali: true, mikroFaturaNo: `${seri}${sira}`, lineItems: [], ...ek,
});
const yazimlar = (d: Duzenek) => d.koleksiyon('orders').map(y => [y.op, y.ref.id, y.data?.faturali] as const);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('T6 — faturadanSiparis: `faturali` seriden (QH5-2)', () => {
  it('Q başlık → `faturali: false`, kimlik `mikrofat__c1__Q-1`, `MF-Q1`, `mikroFaturaNo` Q1 (biçimler DEĞİŞMEZ); boş seri → true', () => {
    const q = faturadanSiparis({ ...BASLIK, cha_evrakno_seri: 'Q', cha_evrakno_sira: 1 }, [], { companyId: 'c1' });
    expect([q?.id, q?.doc.orderNumber, q?.doc.faturali, q?.doc.mikroFaturaNo]).toEqual(['mikrofat__c1__Q-1', 'MF-Q1', false, 'Q1']);
    const kucuk = faturadanSiparis({ ...BASLIK, cha_evrakno_seri: ' q ', cha_evrakno_sira: 3 }, [], { companyId: 'c1' });
    expect(kucuk?.doc.faturali).toBe(false);
    const f = faturadanSiparis(BASLIK, [], { companyId: 'c1' });
    expect([f?.id, f?.doc.faturali]).toEqual(['mikrofat__c1__-412', true]);
  });
});

describe('T6 — gece geri doldurması hedefi SERİDEN; iki ardışık koşu (M6, M37)', () => {
  it('ilk koşu: yeni Q MF `false` doğar; MF-Q1 true → false; boş serili MF false → true; hedefiyle aynı olana YAZIM YOK; `mikroEvrak` yok → true (parite)', async () => {
    const qBaslik = { ...BASLIK, cha_evrakno_seri: 'Q', cha_evrakno_sira: 2 };
    const mevcut = [
      mf('Q', '1'),                                              // canlıdaki MF-Q1: faturalı yazılmış
      mf('', '300', { faturali: false }),                        // boş seri yanlışlıkla faturasız
      mf('', '301'),                                             // hedefiyle aynı → yazılmaz
      mf('Q', '5', { faturali: false }),                         // hedefiyle aynı (Q) → yazılmaz
      { ...mf('', '302'), mikroEvrak: undefined, faturali: true },   // anahtarsız eski kayıt → hedef true, yazılmaz
    ];
    const { d } = await kostur({ belgeler: { mikroFaturalar: [qBaslik], orders: mevcut } });
    expect(yazimlar(d)).toEqual([
      ['update', 'mikrofat__A__Q-1', false],
      ['update', 'mikrofat__A__-300', true],
      ['set', 'mikrofat__A__Q-2', false],
    ]);
    // Kimlik / sipariş no / fatura no BİÇİMİ değişmez (yalnız `faturali` onarılır).
    const q2 = d.koleksiyon('orders').find(y => y.ref.id === 'mikrofat__A__Q-2');
    expect([q2?.data?.orderNumber, q2?.data?.mikroFaturaNo]).toEqual(['MF-Q2', 'Q2']);
  });

  it('ikinci koşu: geri doldurma yazımı 0 — Q MF `false` KALIR (eski seçim `faturali !== true` onu her gece true\'ya çevirirdi)', async () => {
    const qBaslik = { ...BASLIK, cha_evrakno_seri: 'Q', cha_evrakno_sira: 2 };
    const ilkKosudanSonra = [mf('Q', '1', { faturali: false }), mf('', '300'), mf('Q', '2', { faturali: false })];
    const { d } = await kostur({ belgeler: { mikroFaturalar: [qBaslik], orders: ilkKosudanSonra } });
    expect(yazimlar(d)).toEqual([]);
  });

  it('`mikroFaturaNo` eksikse hedef korunarak onarılır (seri Q → false yazılır, numara mikroEvrak\'tan)', async () => {
    const eksik = { ...mf('Q', '7', { faturali: false }), mikroFaturaNo: undefined };
    // Uç satış faturası yoksa erken döner (geri doldurmaya varmaz) — bir boş serili başlık verilir.
    const { d } = await kostur({ belgeler: { mikroFaturalar: [BASLIK], orders: [eksik] } });
    const y = d.koleksiyon('orders').filter(x => x.op === 'update');
    expect(y.map(x => [x.op, x.ref.id, x.data?.faturali, x.data?.mikroFaturaNo])).toEqual([['update', 'mikrofat__A__Q-7', false, 'Q7']]);
  });
});
