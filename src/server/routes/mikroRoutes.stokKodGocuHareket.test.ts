/**
 * mikroRoutes.stokKodGocuHareket.test.ts — stok kodu göçü şartnamesi DH2 (05.11.2026): «tam pencereli import yeniden koşunca kod
 * geri dönmez».
 *
 * Gece / elle «Stok hareketleri İçeri Al» `inventoryMovements`'ı `sth_Guid` kimliğiyle `...row` MERGE eder: Mikro'nun döndürdüğü
 * `sth_stok_kod` her koşuda Cetpa belgesine yazılır. Göç bir hareketi yeni koda YALNIZ Mikro'daki aynı GUID'li satır zaten yeni kodu
 * taşıyorsa yazar (`hareketYazilirMi`, D3 + DH2). Bu dosya iki tarafı GERÇEK yüzeyleriyle karşılaştırır: tam pencereli import
 * (`ilkTarih` 2020-01-01) her GUID'e göçün yazdığı değerin AYNISINI yazar — göç «yeni», import «eski» diye gece gece gidip gelmez.
 * Mikro'da eski kodda duran satırı göç YAZMAZ (import da eskiyi yazar; çelişki yok).
 *
 * vi.mock blokları `mikroRoutes.testDuzenegi` `mikroMockTarifi`nden (vitest hoisting).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost, mikroSql, mikroKolonlar } from '../mikroClient.js';
import { hareketYazilirMi } from '../mikro/stokKodGocuTasima.js';
import { bicimliGuidAnahtari } from '../mikro/stokKodGocu.js';

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

const ESKI = 'AKCALI-AKÇ.00312';
const YENI = 'AKCALI-00312';
/** Mikro'da kodu değişmiş hareket (göç yeni koda yazar) ve hâlâ eski kodda duran hareket (göç YAZMAZ). */
const G_DEGISEN = 'a1b2c3d4-0000-4000-8000-000000000001';
const G_ESKIDE = 'a1b2c3d4-0000-4000-8000-000000000002';
const MIKRO_SATIRLARI = [
  { sth_Guid: G_DEGISEN, sth_tarih: '2021-03-04 00:00:00', sth_stok_kod: YENI, sth_miktar: 2, sth_iptal: 0 },
  { sth_Guid: G_ESKIDE, sth_tarih: '2021-05-06 00:00:00', sth_stok_kod: ESKI, sth_miktar: 1, sth_iptal: 0 },
];
const KUME_SORGUSU = /^SELECT (\w+\.)?\w+ AS guid FROM /;

let d: Duzenek;
const sorgular: string[] = [];
beforeEach(() => {
  d = duzenekKur();
  sorgular.length = 0;
  vi.mocked(mikroPost).mockReset();
  vi.mocked(mikroSql).mockReset();
  vi.mocked(mikroKolonlar).mockResolvedValue(['sth_Guid', 'sth_iptal', 'sth_tarih', 'sth_stok_kod', 'sth_miktar']);
  vi.mocked(mikroPost).mockImplementation((async () => ({ ok: true, status: 200, data: { result: [{ Data: [] }] } })) as unknown as typeof mikroPost);
  let verildi = false;
  vi.mocked(mikroSql).mockImplementation((async (sql: string) => {
    sorgular.push(sql);
    if (KUME_SORGUSU.test(sql)) return { rows: MIKRO_SATIRLARI.map(r => ({ guid: r.sth_Guid })), hata: null };
    // Sayfalı okuma: ilk sayfa satırları, sonraki sayfa boş (import döngüsü biter).
    if (verildi) return { rows: [], hata: null };
    verildi = true;
    return { rows: MIKRO_SATIRLARI.map(r => ({ ...r })), hata: null };
  }) as unknown as typeof mikroSql);
});

describe('DH2 · tam pencereli «Stok hareketleri İçeri Al» göçün yazdığı kodu geri ÇEVİRMEZ', () => {
  it('her GUID için import\'un yazdığı `sth_stok_kod` = göçün yazdığı değer (göç yazmadıysa Mikro\'daki, yani eskisi)', async () => {
    // Göç SONRASI Cetpa: değişen hareket yeni kodda (göç yazdı); eskide duran hareket eski kodda (göç `mikro_kodu_farkli` ile atladı).
    d.snapAyarla('inventoryMovements', {
      [G_DEGISEN]: { companyId: 'A', sth_stok_kod: YENI, kodGocu: { calismaId: 'skg-20261105220000-abc123' } },
      [G_ESKIDE]: { companyId: 'A', sth_stok_kod: ESKI },
    });
    const mikroKodu = new Map(MIKRO_SATIRLARI.map(r => [bicimliGuidAnahtari(r.sth_Guid), r.sth_stok_kod]));
    // Göçün kararı (D3 + DH2): değişen GUID yazılır, eskide duran YAZILMAZ.
    expect(hareketYazilirMi(bicimliGuidAnahtari(G_DEGISEN), mikroKodu, new Map(), G_DEGISEN, YENI)).toBeNull();
    expect(hareketYazilirMi(bicimliGuidAnahtari(G_ESKIDE), mikroKodu, new Map(), G_ESKIDE, YENI)).toBe('mikro_kodu_farkli');

    const r = await d.cagir('POST', '/api/mikro/import/stok-hareket', { ilkTarih: '2020-01-01' });
    expect(r.kod).toBeLessThan(300);
    await d.isBitisi('mikroImport-stok-hareket');

    // Tam pencere: okuma sorgusu 2020-01-01'den başlar.
    expect(sorgular.some(q => !KUME_SORGUSU.test(q) && q.includes("'2020-01-01'"))).toBe(true);
    const yazimlar = d.koleksiyon('inventoryMovements').filter(y => y.op === 'set');
    const kod = (id: string): unknown[] => yazimlar.filter(y => y.ref.id === id).map(y => y.data?.sth_stok_kod);
    // Göçün yeni koda yazdığı hareket import'tan sonra da YENİ (merge Mikro'nun güncel kodunu yazar).
    expect(kod(G_DEGISEN)).toEqual([YENI]);
    // (Merge bayrağı düzenekte yalnız `ref.set` için izlenir; import `batch.set(…, { merge: true })` yazar — mikroRoutes.ts `...row`.)
    // Göçün dokunmadığı hareket eski kodda kalır — göç ile import AYNI değeri yazar, gidip gelme yok.
    expect(kod(G_ESKIDE)).toEqual([ESKI]);
  });
});
