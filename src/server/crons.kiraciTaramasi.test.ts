// @vitest-environment node
/**
 * crons.kiraciTaramasi.test.ts — Mikro zamanlanmış işlerinin hedef kiracı çözümü (`cronCompanyId`), GERÇEK `crons.ts` gövdesiyle
 * (şartname «dış rol kapanışı» D12 / T11).
 *
 * NEDEN VAR: `cronCompanyId` `crons.ts` içinde, `kur()`'un kapanışında yaşar — dışarıdan çağrılamaz. Saf kural
 * (kiraciOrtami.test.ts) ve metin çiti tek başına «tarama gerçekten yardımcıya bağlı ve sonucu işe AKIYOR» demez. Burada modül
 * olduğu gibi içe aktarılır, zamanlayıcı yerine işleri yakalayan bir sahte konur ve saatlik iş elle koşturulur:
 * ölçülen, işin kiracı çözümünden SONRAKİ ilk adımının (`tenantSnap('inventory', <kiracı>)`) hangi kiracıyla çağrıldığıdır.
 * Gece 04:00 stok miktarı işi bu dosyadan ÇIKTI (şartname «Mikro bağlantı A» A1 / AH1 / AH8, 2026-11-05): 03:20 Mikro bloğunun son
 * adımıdır; kiracı senaryoları `routes/mikroRoutes.kiraciTaramasi.test.ts`'e taşındı.
 *
 * Giriş ekranından hesap açan yabancının rolsüz `users` belgesi eskiden ikinci kiracı sayılıyor, iki iş de «hedef tenant
 * belirsiz» deyip atlıyordu (stok, cari, gece stok miktarı güncellenmiyordu).
 *
 * SAHTE OLANLAR: zamanlayıcı (işler yakalanır, hiçbiri kendiliğinden koşmaz), Mikro istemcisi (kimlik var, liste boş — Mikro'ya
 * istek YOK) ve Mikro aynası. `bakimKilidi` gerçek: havuz verilmediği için kilit mekanizması devre dışı kalır.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDbLike } from './adminDbTypes.js';
import type { SqlCalistirici } from './bakimKilidi.js';

const yakalanan = vi.hoisted(() => ({ isler: new Map<string, () => Promise<unknown>>() }));
// Saatlik işin Mikro çağrısı ve arka plan işi kapısı (AH1 ters yön) ölçülür.
const sahte = vi.hoisted(() => ({
  mikroPost: vi.fn(async () => ({ ok: false, data: '' })),
  arkaPlanIsiKosan: vi.fn((): string | null => null),
}));

vi.mock('./zamanla.js', () => ({
  IS_SAAT_DILIMI: 'Europe/Istanbul',
  zamanla: (ifade: string, is: () => Promise<unknown>) => { yakalanan.isler.set(ifade, is); return { stop() {}, start() {} }; },
}));
vi.mock('./mikroClient.js', () => ({
  getMikroCreds: async () => ({ firmaKodu: 'SINAMA' }),
  mikroPost: sahte.mikroPost,                                    // liste gelmez → sayfalama hemen biter
  mikroData: () => ({}),
  mikroBugun: () => '2026-10-11',
  mikroStokMiktari: async () => null,
  mikroSatisFiyatlari: async () => new Map(),
  mikroVergiOranlari: async () => new Map(),
  vergiOraniCoz: () => null,
  MIKRO_JUMP_SURUM: 17,
}));
vi.mock('./mikroMirror.js', () => ({ mirrorMikroStoklar: async () => undefined, mirrorMikroCariler: async () => undefined }));
vi.mock('./mikro/arkaPlanIsi.js', () => ({ arkaPlanIsiKosan: sahte.arkaPlanIsiKosan }));

import { initCrons } from './crons.js';

type Belge = { id: string; veri: Record<string, unknown> };
const SAHIP: Belge = { id: 'sahip-uid', veri: { email: 'sahip@example.test', role: 'Admin' } };
const PERSONEL: Belge = { id: 'personel-uid', veri: { role: 'Sales', companyId: 'sahip-uid' } };
const YABANCI: Belge = { id: 'yabanci-uid', veri: { name: 'Yabancı', email: 'yabanci@example.test' } };       // rol / kiracı alanı yok
const COP: Belge = { id: 'cop-uid', veri: { role: 1, companyId: 'UYDURMA' } };                                 // rol alanında geçersiz değer

const DUR = new Error('sınama: kiracı çözüldü, iş burada durdurulur');
/** İşleri verilen `users` içeriğiyle kurar; `tenantSnap`'in çağrıldığı kiracıları ve `users` okuma sayısını döner. */
function kur(belgeler: Belge[], pool: SqlCalistirici | null = null): { kiracilar: string[]; okuma: () => number } {
  const kiracilar: string[] = [];
  let okuma = 0;
  const db = {
    collection: (ad: string) => ({
      get: async () => {
        if (ad !== 'users') throw new Error(`beklenmeyen koleksiyon: ${ad}`);
        okuma++;
        return { docs: belgeler.map(b => ({ id: b.id, data: () => b.veri })) };
      },
    }),
  } as unknown as AdminDbLike;
  yakalanan.isler.clear();
  initCrons({
    getAdminDb: () => db,
    getPgPool: () => pool,
    tenantSnap: async (coll, cid) => { kiracilar.push(`${coll}:${cid}`); throw DUR; },
    serverTenantId: async () => '',
    pgServerTimestamp: () => ({ __op: 'serverTimestamp' }),
  });
  return { kiracilar, okuma: () => okuma };
}
const SAATLIK = '0 * * * *';
async function kostur(ifade: string): Promise<void> {
  const is = yakalanan.isler.get(ifade);
  expect(is, `iş kayıtlı değil: ${ifade}`).toBeTypeOf('function');
  // Gece işi `tenantSnap` hatasını kendi yakalar ya da dışarı atar — iki durumda da ölçülen çağrı kaydıdır.
  try { await is?.(); } catch (e) { expect(e).toBe(DUR); }
}

/** `console.error`'a yazılan satırlar (ilk bağımsız değişken). */
const hataSatirlari: string[] = [];
beforeEach(() => {
  vi.stubEnv('MIKRO_CRON_SYNC', 'true');
  vi.stubEnv('MIKRO_CRON_COMPANY_ID', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  hataSatirlari.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { hataSatirlari.push(String(a[0])); });
  sahte.mikroPost.mockClear();
  sahte.arkaPlanIsiKosan.mockReset().mockReturnValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Mikro zamanlanmış işleri: hedef kiracı `users` taramasından (ortam değeri YOK)', () => {
  it('saatlik iş kayıtlı (sınama gerçek işi koşturuyor); gece 04:00 stok miktarı kaydı YOK (03:20 bloğunun son adımı, AH1)', () => {
    kur([SAHIP]);
    expect([...yakalanan.isler.keys()]).toContain(SAATLIK);
    expect([...yakalanan.isler.keys()]).not.toContain('0 4 * * *');
  });

  it.each([SAATLIK])('%s — sahip + personel + rolsüz yabancı + geçersiz rollü belge → SAHİBİN kiracısıyla sürer', async ifade => {
    const d = kur([YABANCI, SAHIP, COP, PERSONEL]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual(['inventory:sahip-uid']);
    expect(d.okuma()).toBe(1);
  });

  it.each([SAATLIK])('%s — iki GERÇEK kiracı → iş atlanır (yanlış kiracıya yazmaz) ve bunu günlüğe yazar', async ifade => {
    const d = kur([SAHIP, PERSONEL, { id: 'ikinci-sahip', veri: { role: 'Admin' } }]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual([]);
    expect(hataSatirlari.join('\n')).toContain('2 tenant bulundu');
  });

  it.each([SAATLIK])('%s — yalnız rolsüz hesaplar varsa kiracı YOKTUR: yabancının kimliği hedef olamaz, iş atlanır', async ifade => {
    const d = kur([YABANCI, COP]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual([]);
    expect(hataSatirlari.join('\n')).toContain('0 tenant bulundu');
  });

  it.each([SAATLIK])('%s — ortam değeri doluysa o kullanılır; `users` hiç taranmaz (değişmedi)', async ifade => {
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'ortam-kiracisi');
    const d = kur([SAHIP, { id: 'ikinci-sahip', veri: { role: 'Admin' } }, YABANCI]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual(['inventory:ortam-kiracisi']);
    expect(d.okuma()).toBe(0);
  });
});

// Şartname «Mikro bağlantı A» AH1 ters yön (2026-11-05): koşan arka plan işi (gece stok miktarı adımı / elle import) varken saatlik
// senkron aynı `inventory` / `leads` belgelerine yazmasın (pgShim kilitsiz birleştirme). O saat atlanır, sonraki saat dener.
describe('saatlik senkron: koşan arka plan işi varken o saat ATLANIR', () => {
  it('`arkaPlanIsiKosan` boş değilken Mikro\'ya çağrı YOK, kiracı taranmaz; boşken iş bugünkü gibi sürer', async () => {
    sahte.arkaPlanIsiKosan.mockReturnValue('stokMiktarImport');
    const d = kur([SAHIP]);
    await kostur(SAATLIK);
    expect(sahte.mikroPost).not.toHaveBeenCalled();
    expect([d.kiracilar, d.okuma()]).toEqual([[], 0]);
    sahte.arkaPlanIsiKosan.mockReturnValue(null);
    const d2 = kur([SAHIP]);
    await kostur(SAATLIK);
    expect(sahte.mikroPost).toHaveBeenCalled();
    expect(d2.kiracilar).toEqual(['inventory:sahip-uid']);
  });

  // İnceleme MBA1 #2 (2026-11-05): baştaki kapı ile yazıcı kaydı arasında gece stok işi başlarsa, kayıttan SONRAKİ ikinci bakış
  // saatlik koşuyu çeker (önce kaydol, sonra bak).
  it('baştaki kapıda boş, yazıcı kaydından sonra dolu → Mikro\'ya çağrı YOK, kiracı taranmaz', async () => {
    sahte.arkaPlanIsiKosan.mockReturnValueOnce(null).mockReturnValueOnce('stokMiktarImport');
    const d = kur([SAHIP]);
    await kostur(SAATLIK);
    expect(sahte.arkaPlanIsiKosan).toHaveBeenCalledTimes(2);
    expect(sahte.mikroPost).not.toHaveBeenCalled();
    expect([d.kiracilar, d.okuma()]).toEqual([[], 0]);
  });

  // İnceleme MBS #1 (2026-11-05) ters yön: gece cari bakiye adımı arka plan işi değildir; yazıcı kaydı (`'mikro-cron:pull-bakiye'`)
  // varken saatlik koşu kendi kaydından SONRA bakar ve o saat atlanır. Başka önekli gece kaydı saatlik koşuyu durdurmaz.
  it.each([
    ['mikro-cron:pull-bakiye', true],
    ['mikro-cron:faturadan-siparis', false],
  ])("yazıcı kaydı '%s' varken saatlik koşu atlanır mı: %s (bakış kendi `yazici:mikro-cron` kaydından SONRA)", async (ad, atlanir) => {
    const sorgular: Array<{ sql: string; params: unknown[] }> = [];
    const pool: SqlCalistirici = { query: async (sql: string, params: unknown[] = []) => {
      sorgular.push({ sql, params });
      return /id LIKE/.test(sql) ? { rows: [{ id: `yazici:${ad}`, data: { baslangic: new Date().toISOString() } }] } : { rows: [] };
    } };
    const d = kur([SAHIP], pool);
    await kostur(SAATLIK);
    if (atlanir) {
      expect(sahte.mikroPost).not.toHaveBeenCalled();
      expect([d.kiracilar, d.okuma()]).toEqual([[], 0]);
    } else {
      expect(sahte.mikroPost).toHaveBeenCalled();
      expect(d.kiracilar).toEqual(['inventory:sahip-uid']);
    }
    const kayit = sorgular.findIndex(q => /^INSERT/.test(q.sql) && q.params[1] === 'yazici:mikro-cron');
    const bakis = sorgular.findIndex(q => /id LIKE/.test(q.sql));
    expect(kayit).toBeGreaterThanOrEqual(0);
    expect(kayit).toBeLessThan(bakis);
  });

  // Baştaki kapı ikinci bakışla aynı sonucu verdiği için tek başına görünmüyordu (paket mutasyonu kaçtı, 2026-11-05). Ayırt edici:
  // iş koşarken saatlik koşu `'mikro-cron'` yazıcı kaydını HİÇ açmaz. Açsaydı gece stok adımı (AH1 kapı 1) o anda bakarsa
  // «atlandı: saatlik senkron koşuyor» der; kayıt boşuna PG gidiş-dönüşüdür.
  it('baştaki kapı: arka plan işi koşarken `yazici:mikro-cron` kaydı AÇILMAZ (PG\'ye tek sorgu bile gitmez)', async () => {
    const sorgular: string[] = [];
    const pool: SqlCalistirici = { query: async (sql: string) => { sorgular.push(sql); return { rows: [] }; } };
    sahte.arkaPlanIsiKosan.mockReturnValue('stokMiktarImport');
    kur([SAHIP], pool);
    await kostur(SAATLIK);
    expect(sahte.arkaPlanIsiKosan).toHaveBeenCalledTimes(1);
    expect(sorgular).toEqual([]);
    expect(sahte.mikroPost).not.toHaveBeenCalled();
  });
});
