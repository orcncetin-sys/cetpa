// @vitest-environment node
/**
 * crons.kiraciTaramasi.test.ts — Mikro zamanlanmış işlerinin hedef kiracı çözümü (`cronCompanyId`), GERÇEK `crons.ts` gövdesiyle
 * (şartname «dış rol kapanışı» D12 / T11).
 *
 * NEDEN VAR: `cronCompanyId` `crons.ts` içinde, `kur()`'un kapanışında yaşar — dışarıdan çağrılamaz. Saf kural
 * (kiraciOrtami.test.ts) ve metin çiti tek başına «tarama gerçekten yardımcıya bağlı ve sonucu işe AKIYOR» demez. Burada modül
 * olduğu gibi içe aktarılır, zamanlayıcı yerine işleri yakalayan bir sahte konur ve saatlik + gece işleri elle koşturulur:
 * ölçülen, işin kiracı çözümünden SONRAKİ ilk adımının (`tenantSnap('inventory', <kiracı>)`) hangi kiracıyla çağrıldığıdır.
 *
 * Giriş ekranından hesap açan yabancının rolsüz `users` belgesi eskiden ikinci kiracı sayılıyor, iki iş de «hedef tenant
 * belirsiz» deyip atlıyordu (stok, cari, gece stok miktarı güncellenmiyordu).
 *
 * SAHTE OLANLAR: zamanlayıcı (işler yakalanır, hiçbiri kendiliğinden koşmaz), Mikro istemcisi (kimlik var, liste boş — Mikro'ya
 * istek YOK) ve Mikro aynası. `bakimKilidi` gerçek: havuz verilmediği için kilit mekanizması devre dışı kalır.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDbLike } from './adminDbTypes.js';

const yakalanan = vi.hoisted(() => ({ isler: new Map<string, () => Promise<unknown>>() }));

vi.mock('./zamanla.js', () => ({
  IS_SAAT_DILIMI: 'Europe/Istanbul',
  zamanla: (ifade: string, is: () => Promise<unknown>) => { yakalanan.isler.set(ifade, is); return { stop() {}, start() {} }; },
}));
vi.mock('./mikroClient.js', () => ({
  getMikroCreds: async () => ({ firmaKodu: 'SINAMA' }),
  mikroPost: async () => ({ ok: false, data: '' }),              // liste gelmez → sayfalama hemen biter
  mikroData: () => ({}),
  mikroBugun: () => '2026-10-11',
  mikroStokMiktari: async () => null,
  mikroSatisFiyatlari: async () => new Map(),
  mikroVergiOranlari: async () => new Map(),
  vergiOraniCoz: () => null,
  MIKRO_JUMP_SURUM: 17,
}));
vi.mock('./mikroMirror.js', () => ({ mirrorMikroStoklar: async () => undefined, mirrorMikroCariler: async () => undefined }));

import { initCrons } from './crons.js';

type Belge = { id: string; veri: Record<string, unknown> };
const SAHIP: Belge = { id: 'sahip-uid', veri: { email: 'sahip@example.test', role: 'Admin' } };
const PERSONEL: Belge = { id: 'personel-uid', veri: { role: 'Sales', companyId: 'sahip-uid' } };
const YABANCI: Belge = { id: 'yabanci-uid', veri: { name: 'Yabancı', email: 'yabanci@example.test' } };       // rol / kiracı alanı yok
const COP: Belge = { id: 'cop-uid', veri: { role: 1, companyId: 'UYDURMA' } };                                 // rol alanında geçersiz değer

const DUR = new Error('sınama: kiracı çözüldü, iş burada durdurulur');
/** İşleri verilen `users` içeriğiyle kurar; `tenantSnap`'in çağrıldığı kiracıları ve `users` okuma sayısını döner. */
function kur(belgeler: Belge[]): { kiracilar: string[]; okuma: () => number } {
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
    tenantSnap: async (coll, cid) => { kiracilar.push(`${coll}:${cid}`); throw DUR; },
    serverTenantId: async () => '',
    pgServerTimestamp: () => ({ __op: 'serverTimestamp' }),
  });
  return { kiracilar, okuma: () => okuma };
}
const SAATLIK = '0 * * * *';
const GECE = '0 4 * * *';
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
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Mikro zamanlanmış işleri: hedef kiracı `users` taramasından (ortam değeri YOK)', () => {
  it('iki iş de kayıtlı (sınama gerçek işleri koşturuyor)', () => {
    kur([SAHIP]);
    expect([...yakalanan.isler.keys()]).toEqual(expect.arrayContaining([SAATLIK, GECE]));
  });

  it.each([SAATLIK, GECE])('%s — sahip + personel + rolsüz yabancı + geçersiz rollü belge → SAHİBİN kiracısıyla sürer', async ifade => {
    const d = kur([YABANCI, SAHIP, COP, PERSONEL]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual(['inventory:sahip-uid']);
    expect(d.okuma()).toBe(1);
  });

  it.each([SAATLIK, GECE])('%s — iki GERÇEK kiracı → iş atlanır (yanlış kiracıya yazmaz) ve bunu günlüğe yazar', async ifade => {
    const d = kur([SAHIP, PERSONEL, { id: 'ikinci-sahip', veri: { role: 'Admin' } }]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual([]);
    expect(hataSatirlari.join('\n')).toContain('2 tenant bulundu');
  });

  it.each([SAATLIK, GECE])('%s — yalnız rolsüz hesaplar varsa kiracı YOKTUR: yabancının kimliği hedef olamaz, iş atlanır', async ifade => {
    const d = kur([YABANCI, COP]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual([]);
    expect(hataSatirlari.join('\n')).toContain('0 tenant bulundu');
  });

  it.each([SAATLIK, GECE])('%s — ortam değeri doluysa o kullanılır; `users` hiç taranmaz (değişmedi)', async ifade => {
    vi.stubEnv('MIKRO_CRON_COMPANY_ID', 'ortam-kiracisi');
    const d = kur([SAHIP, { id: 'ikinci-sahip', veri: { role: 'Admin' } }, YABANCI]);
    await kostur(ifade);
    expect(d.kiracilar).toEqual(['inventory:ortam-kiracisi']);
    expect(d.okuma()).toBe(0);
  });
});
