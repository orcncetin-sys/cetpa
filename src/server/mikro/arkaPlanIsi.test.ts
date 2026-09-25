/**
 * arkaPlanIsi.test.ts — Mikro import ARKA PLAN İŞİ yardımcısı (mikro-import-arkaplan, 2026-09-24).
 * ÖNCE YAZILDI.
 *
 * Teşhis (teshis-mikro-import-2026-09-24.json): import işi HTTP isteğinin İÇİNDE bitiyor, IIS/ARR
 * ~120 sn'de kesiyor → 502. Desen `import/stok-miktar`'da hazırdı (bayrak + IIFE + jobs/<ad> +
 * anında `{started:true}`) ama tek yerdeydi ve yazıcı kaydı `res.finish`'e bağlıydı (iş dakikalarca
 * yazarken kayıt çoktan silinmişti). Bu modül o gövdenin TEK KAYNAĞI: 4 rota buna bağlanır.
 *
 * Saf: Express/req/res YOK; db/pool/syncLog ENJEKTE. Sahte db `merge:true`'yu GERÇEKTEN uygular
 * (pgShim `mergeDocData` shallow merge paritesi) — "ilerle sonrası companyId hâlâ var" iddiası
 * "hepsini kaydet" sahtesiyle sessizce yeşil olmasın.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AdminDbLike } from '../adminDbTypes.js';
import type { SqlCalistirici } from '../bakimKilidi.js';
import {
  arkaPlanIsiBaslat, arkaPlanIsiBekle, bakimKilidiMesaji, arkaPlanIsiKosan, arkaPlanOnKontrol,
  arkaPlanYaziciAdi, yetimIsleriKapat, YETIM_IS_HATASI,
  type ArkaPlanBagimlilik, type ArkaPlanIsi, type BaslatSonucu, type IsIlerleme, type IsOzeti, surecBaslangiciMs
} from './arkaPlanIsi';

vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));

type Yazim = { id: string; data: Record<string, unknown>; merge: boolean };

/** Sahte adminDb: yalnız `collection('jobs').doc(id).set` — merge SEMANTİĞİ gerçek (shallow). */
function sahteDb() {
  const yazimlar: Yazim[] = [];
  const dokumanlar = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (coll: string) => ({
      doc: (id: string) => ({
        id,
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          if (coll !== 'jobs') throw new Error(`beklenmeyen koleksiyon: ${coll}`);
          yazimlar.push({ id, data, merge: !!opts?.merge });
          dokumanlar.set(id, opts?.merge ? { ...(dokumanlar.get(id) ?? {}), ...data } : { ...data });
        },
      }),
    }),
  } as unknown as AdminDbLike;
  return { db, yazimlar, dokumanlar };
}

/** Sahte PG havuzu: yazıcı INSERT/DELETE'i kaydeder; `kilit` verilirse bakım kilidi VAR. */
function sahtePool(kilit: { aciklama: string; baslangic: string } | null = null) {
  const sorgular: Array<{ sql: string; params: unknown[] }> = [];
  const pool: SqlCalistirici = {
    query: async (sql, params) => {
      sorgular.push({ sql, params: params ?? [] });
      if (/^SELECT data FROM docs/.test(sql)) return { rows: kilit ? [{ data: kilit }] : [] };
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool, sorgular };
}

const AKTOR = { uid: 'u1', email: 'a@cetpa.com.tr' };

function bagimlilik(ek: Partial<ArkaPlanBagimlilik> = {}) {
  const sahte = sahteDb();
  const dep: ArkaPlanBagimlilik = {
    db: sahte.db,
    writeSyncLog: vi.fn(async () => {}),
    writeAuditLog: vi.fn(async () => {}),
    pgPool: null,
    ...ek,
  };
  return { dep, ...sahte };
}

/** Bekletilen `calistir`: test dışarıdan çözer/reddeder. */
function bekletilenIs(isAdi: string, ek: Partial<ArkaPlanIsi> = {}) {
  let coz!: (o: IsOzeti) => void; let reddet!: (e: unknown) => void;
  const soz = new Promise<IsOzeti>((r, j) => { coz = r; reddet = j; });
  const ilerleler: IsIlerleme[] = [];
  let ilerleFn: ((a: IsIlerleme) => Promise<void>) | null = null;
  const is: ArkaPlanIsi = {
    isAdi, companyId: 'A', actor: AKTOR,
    senkronKaydi: { operation: 'ImportStok', entityType: 'inventory' },
    calistir: async (ilerle) => { ilerleFn = ilerle; return soz; },
    ...ek,
  };
  return { is, coz, reddet, ilerleler, ilerle: (a: IsIlerleme) => { ilerleler.push(a); return ilerleFn!(a); /* ! : calistir çağrıldıktan sonra kullanılır (test) */ } };
}

const ozet = (ek: Partial<IsOzeti> = {}): IsOzeti => ({ jobAlanlari: { created: 3, updated: 4 }, ozet: '3 yeni / 4 güncel', basarili: true, hata: null, ...ek });

let reddedilmeyen: unknown[] = [];
const yakala = (e: unknown) => { reddedilmeyen.push(e); };
beforeEach(() => { reddedilmeyen = []; process.on('unhandledRejection', yakala); });
afterEach(async () => {
  // Kilit sızıntısı olmasın: her test kendi işini bitirir; yine de asılı kalan varsa bekle.
  await arkaPlanIsiBekle('mikroImport-x'); await arkaPlanIsiBekle('mikroImport-y'); await arkaPlanIsiBekle('stokMiktarImport');
  process.off('unhandledRejection', yakala);
  expect(reddedilmeyen, 'unhandledRejection = Node 24 süreç çöker').toEqual([]);
});

describe('arkaPlanIsiBaslat — anında döner, jobs/<isAdi> başlangıç dokümanı MERGE\'SİZ', () => {
  it('calistir bitmeden { started:true, job } döner; ilk yazım set (merge YOK): running/companyId/isAdi/startedAt/finishedAt:null/error:null', async () => {
    const { dep, yazimlar } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-x');
    const sonuc = await arkaPlanIsiBaslat(dep, is);
    expect(sonuc).toEqual({ started: true, job: 'mikroImport-x' });
    expect(yazimlar).toHaveLength(1);
    // operation/entityType: açılış taraması (yetimIsleriKapat) yarıda kalan koşunun syncLog satırını
    // DOĞRU işlem adıyla yazabilsin diye (delta bulgu 1c).
    expect(yazimlar[0]).toEqual({
      id: 'mikroImport-x', merge: false,
      data: { running: true, startedAt: 'TS', finishedAt: null, error: null, companyId: 'A', isAdi: 'mikroImport-x',
              operation: 'ImportStok', entityType: 'inventory' },
    });
    expect(dep.writeSyncLog).not.toHaveBeenCalled();
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    const son = yazimlar[yazimlar.length - 1];
    expect(son.merge).toBe(true);
    expect(son.data).toEqual({ running: false, finishedAt: 'TS', durationMs: expect.any(Number), created: 3, updated: 4, error: null });
    expect(Number.isFinite(son.data.durationMs)).toBe(true);
    expect(dep.writeSyncLog).toHaveBeenCalledTimes(1);
    expect(dep.writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', '3 yeni / 4 güncel', true, null, null, expect.any(Number), AKTOR);
    expect(dep.writeAuditLog).not.toHaveBeenCalled();   // denetimEtiketi yok
  });

  it('ilerle(alanlar) → merge:true + running:true; merge SONRASI dokümanda companyId ve isAdi HÂLÂ VAR (kapı yaması 3)', async () => {
    const { dep, yazimlar, dokumanlar } = bagimlilik();
    const { is, coz, ilerle } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    await ilerle({ processed: 10, total: 100, sonSayfaMs: 812 });
    await ilerle({ processed: 20, total: 100, sonSayfaMs: 640 });
    const ilerlemeler = yazimlar.slice(1);
    expect(ilerlemeler).toHaveLength(2);
    for (const y of ilerlemeler) expect(y.merge).toBe(true);
    expect(ilerlemeler[1].data).toMatchObject({ running: true, processed: 20, total: 100, sonSayfaMs: 640 });
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ companyId: 'A', isAdi: 'mikroImport-x', running: true, processed: 20 });
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ companyId: 'A', isAdi: 'mikroImport-x', running: false, processed: 20, created: 3 });
  });

  it('denetimEtiketi verilirse bitişte writeAuditLog(actor, etiket, ozet) (stok-miktar 2820 paritesi)', async () => {
    const { dep } = bagimlilik();
    const { is, coz } = bekletilenIs('stokMiktarImport', {
      senkronKaydi: { operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory', denetimEtiketi: 'Mikro Stok Miktarları' },
    });
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet({ ozet: '5 ürünün miktarı güncellendi, 0 hata' }));
    await arkaPlanIsiBekle('stokMiktarImport');
    expect(dep.writeAuditLog).toHaveBeenCalledWith(AKTOR, 'Mikro Stok Miktarları', '5 ürünün miktarı güncellendi, 0 hata');
  });

  it('basarili:false + hata → doküman error = hata, syncLog success=false ve error dolu', async () => {
    const { dep, dokumanlar } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet({ basarili: false, hata: '2 kayıt zaman aşımıyla atlandı' }));
    await arkaPlanIsiBekle('mikroImport-x');
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ running: false, error: '2 kayıt zaman aşımıyla atlandı' });
    expect(dep.writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', '3 yeni / 4 güncel', false, null, '2 kayıt zaman aşımıyla atlandı', expect.any(Number), AKTOR);
  });

  it("isHatasi VERİLİRSE doküman `error`u odur (syncLog'dan bağımsız): stok-miktar okunamayan SKU → syncLog false + hata, jobs error null (HEAD 2798-2803 paritesi)", async () => {
    const { dep, dokumanlar } = bagimlilik();
    const { is, coz } = bekletilenIs('stokMiktarImport');
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet({ jobAlanlari: { failed: 1 }, basarili: false, hata: '1 SKU okunamadı', isHatasi: null }));
    await arkaPlanIsiBekle('stokMiktarImport');
    expect(dokumanlar.get('stokMiktarImport')).toMatchObject({ running: false, failed: 1, error: null });
    expect(dep.writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', '3 yeni / 4 güncel', false, null, '1 SKU okunamadı', expect.any(Number), AKTOR);
  });

  it('kendiYazar:true → başarıda helper syncLog YAZMAZ (SQL import gövdesi 1174/1308 zaten yazıyor; çift satır YASAK)', async () => {
    const { dep } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-y', { senkronKaydi: { operation: 'SQL:SIPARISLER', entityType: 'mikroSiparisler', kendiYazar: true } });
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-y');
    expect(dep.writeSyncLog).not.toHaveBeenCalled();
  });
});

describe('arkaPlanIsiBaslat — KİLİT: süreç-geneli TEK İŞ (K-C)', () => {
  it('iş sürerken AYNI ve FARKLI isAdi ile ikinci istek alreadyRunning; job = ÇALIŞAN işin adı; hiçbir yazım/calistir yok', async () => {
    const { dep, yazimlar } = bagimlilik();
    const birinci = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, birinci.is);
    const ikinciCalistir = vi.fn(async () => ozet());
    const ayni = await arkaPlanIsiBaslat(dep, { ...bekletilenIs('mikroImport-x').is, calistir: ikinciCalistir });
    const farkli = await arkaPlanIsiBaslat(dep, { ...bekletilenIs('mikroImport-y').is, calistir: ikinciCalistir });
    expect(ayni).toEqual({ started: false, alreadyRunning: true, job: 'mikroImport-x' });
    expect(farkli).toEqual({ started: false, alreadyRunning: true, job: 'mikroImport-x' });
    expect(ikinciCalistir).not.toHaveBeenCalled();
    expect(yazimlar).toHaveLength(1);   // yalnız birincinin başlangıç dokümanı
    birinci.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    // Kilit sızmadı: bitince farklı iş başlar.
    const ucuncu = bekletilenIs('mikroImport-y');
    expect(await arkaPlanIsiBaslat(dep, ucuncu.is)).toEqual({ started: true, job: 'mikroImport-y' });
    ucuncu.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-y');
  });

  it('arkaPlanIsiBekle: koşmayan iş için hemen çözülür; asla reject etmez', async () => {
    await expect(arkaPlanIsiBekle('hic-yok')).resolves.toBeUndefined();
  });
});

describe('arkaPlanIsiBaslat — bakım kilidi + yazıcı kaydı (bakimKilidi.ts)', () => {
  it('yaziciAdi + pool: yazıcı INSERT yanıt DÖNMEDEN; DELETE ancak iş bitince (res.finish\'e BAĞLI DEĞİL)', async () => {
    const { pool, sorgular } = sahtePool();
    const { dep } = bagimlilik({ pgPool: pool });
    const { is, coz } = bekletilenIs('mikroImport-x', { yaziciAdi: 'mikro-import:mikroImport-x:abc' });
    const sonuc = await arkaPlanIsiBaslat(dep, is);
    expect(sonuc).toEqual({ started: true, job: 'mikroImport-x' });
    const insert = sorgular.find(s => /^INSERT/.test(s.sql));
    expect(insert?.params[1]).toBe('yazici:mikro-import:mikroImport-x:abc');
    expect(sorgular.some(s => /^DELETE/.test(s.sql)), 'iş sürerken yazıcı kaydı SİLİNMEZ').toBe(false);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    const del = sorgular.find(s => /^DELETE/.test(s.sql));
    expect(del?.params[1]).toBe('yazici:mikro-import:mikroImport-x:abc');
  });

  it('kilit varsa { started:false, kilit }: yazıcı kaydı silinir, jobs YAZILMAZ, calistir ÇAĞRILMAZ, slot bırakılır', async () => {
    const kilit = { aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' };
    const { pool, sorgular } = sahtePool(kilit);
    const { dep, yazimlar } = bagimlilik({ pgPool: pool });
    const calistir = vi.fn(async () => ozet());
    const sonuc = await arkaPlanIsiBaslat(dep, { ...bekletilenIs('mikroImport-x').is, yaziciAdi: 'mikro-import:mikroImport-x:k', calistir });
    expect(sonuc).toEqual({ started: false, kilit });
    expect(calistir).not.toHaveBeenCalled();
    expect(yazimlar).toEqual([]);
    expect(sorgular.filter(s => /^DELETE/.test(s.sql))).toHaveLength(1);
    // Slot bırakıldı: kilitsiz havuzla sonraki iş başlar.
    const { dep: dep2 } = bagimlilik();
    const sonraki = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(dep2, sonraki.is)).toEqual({ started: true, job: 'mikroImport-x' });
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
  });

  it('yaziciAdi YOK → havuz olsa da yazıcı/kilit sorgusu ATILMAZ (SQL import paritesi)', async () => {
    const { pool, sorgular } = sahtePool({ aciklama: 'x', baslangic: 'y' });
    const { dep } = bagimlilik({ pgPool: pool });
    const { is, coz } = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(dep, is)).toEqual({ started: true, job: 'mikroImport-x' });
    expect(sorgular).toEqual([]);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
  });

  it('bakimKilidiMesaji: 423 metni rotalardaki kopyayla BİREBİR', () => {
    expect(bakimKilidiMesaji({ aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' }))
      .toBe('Bakım kilidi: lead-birlestir (2026-09-05T12:00:00.000Z) — veri bakımı bitince tekrar deneyin.');
  });
});

describe('arkaPlanIsiBaslat — istisna yolu: kilit SIZMAZ, p REJECT ETMEZ, syncLog HER ZAMAN', () => {
  it("calistir throw → jobs merge { running:false, error, finishedAt } + writeSyncLog(op, ent, 'bulk', false, null, msg, ms, actor) TAM 1 KEZ; bekle çözülür; sonraki iş başlar", async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pool, sorgular } = sahtePool();
    const { dep, dokumanlar } = bagimlilik({ pgPool: pool });
    const { is, reddet } = bekletilenIs('mikroImport-x', { yaziciAdi: 'mikro-import:mikroImport-x:e' });
    await arkaPlanIsiBaslat(dep, is);
    reddet(new Error('ağ'));
    await expect(arkaPlanIsiBekle('mikroImport-x')).resolves.toBeUndefined();
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ running: false, error: 'ağ', finishedAt: 'TS', companyId: 'A' });
    expect(dep.writeSyncLog).toHaveBeenCalledTimes(1);
    expect(dep.writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', 'bulk', false, null, 'ağ', expect.any(Number), AKTOR);
    expect(hata).toHaveBeenCalled();   // 2825 mirası `.catch(() => {})` sessizliği YOK
    expect(sorgular.filter(s => /^DELETE/.test(s.sql))).toHaveLength(1);
    const sonraki = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(dep, sonraki.is)).toMatchObject({ started: true });
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    hata.mockRestore();
  });

  it('kendiYazar:true istisna yolunda GEÇERSİZ (calistir yazamadan öldü) → helper syncLog(false) yazar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dep } = bagimlilik();
    const { is, reddet } = bekletilenIs('mikroImport-y', { senkronKaydi: { operation: 'SQL:T', entityType: 'c', kendiYazar: true } });
    await arkaPlanIsiBaslat(dep, is);
    reddet(new Error('patladı'));
    await arkaPlanIsiBekle('mikroImport-y');
    expect(dep.writeSyncLog).toHaveBeenCalledWith('SQL:T', 'c', 'bulk', false, null, 'patladı', expect.any(Number), AKTOR);
    vi.restoreAllMocks();
  });

  it('writeSyncLog throw / bitiş set throw → yine kilit bırakılır, bekle çözülür, unhandledRejection yok', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dep } = bagimlilik({ writeSyncLog: vi.fn(async () => { throw new Error('syncLog kapalı'); }) });
    const a = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, a.is);
    a.coz(ozet());
    await expect(arkaPlanIsiBekle('mikroImport-x')).resolves.toBeUndefined();

    // Bitiş `set` patlıyor (başlangıç seti geçsin diye sayaçlı sahte).
    let setSayac = 0;
    const db = { collection: () => ({ doc: (id: string) => ({ id, set: async () => { if (++setSayac > 1) throw new Error('pg kapalı'); } }) }) } as unknown as AdminDbLike;
    const { dep: dep2 } = bagimlilik({ db });
    const b = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep2, b.is);
    b.coz(ozet());
    await expect(arkaPlanIsiBekle('mikroImport-x')).resolves.toBeUndefined();
    const c = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(bagimlilik().dep, c.is)).toMatchObject({ started: true });
    c.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    vi.restoreAllMocks();
  });

  it('BAŞLANGIÇ dokümanı yazılamazsa çağırana fırlatır (yanıt öncesi), yazıcı kaydı silinir, slot bırakılır', async () => {
    const db = { collection: () => ({ doc: (id: string) => ({ id, set: async () => { throw new Error('pg kapalı'); } }) }) } as unknown as AdminDbLike;
    const { pool, sorgular } = sahtePool();
    const { dep } = bagimlilik({ db, pgPool: pool });
    const calistir = vi.fn(async () => ozet());
    await expect(arkaPlanIsiBaslat(dep, { ...bekletilenIs('mikroImport-x').is, yaziciAdi: 'w', calistir })).rejects.toThrow('pg kapalı');
    expect(calistir).not.toHaveBeenCalled();
    expect(sorgular.filter(s => /^DELETE/.test(s.sql))).toHaveLength(1);
    const sonraki = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(bagimlilik().dep, sonraki.is)).toMatchObject({ started: true });
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
  });
});

// Hakem 2026-09-25 (bulgu 5): "hangi yoldan çıkılırsa çıkılsın slot bırakılır" iddiasının üç açığı.
describe('arkaPlanIsiBaslat — defter tutma işin SONUCUNU değiştirmez; slot HER yoldan bırakılır', () => {
  it('(a) rezervasyondan SONRA `doc()` senkron atarsa: çağırana fırlar, slot + yazıcı kaydı BIRAKILIR (eskiden try dışındaydı → kilit süreç ömrünce dolu)', async () => {
    const db = { collection: () => ({ doc: () => { throw new Error('geçersiz id'); } }) } as unknown as AdminDbLike;
    const { pool, sorgular } = sahtePool();
    const { dep } = bagimlilik({ db, pgPool: pool });
    await expect(arkaPlanIsiBaslat(dep, { ...bekletilenIs('mikroImport-x').is, yaziciAdi: 'w' })).rejects.toThrow('geçersiz id');
    const sonraki = bekletilenIs('mikroImport-y');
    expect(await arkaPlanIsiBaslat(bagimlilik().dep, sonraki.is)).toEqual({ started: true, job: 'mikroImport-y' });
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-y');
    // Açılan her yazıcı kaydı silindi — asılı kayıt YOK (hiç açılmadıysa DELETE zararsız no-op).
    const silinen = new Set(sorgular.filter(s => /^DELETE/.test(s.sql)).map(s => s.params[1]));
    for (const ins of sorgular.filter(s => /^INSERT/.test(s.sql))) expect(silinen.has(ins.params[1])).toBe(true);
  });

  it("(b) BAŞARILI iş, sonra writeSyncLog/audit atar → iş 'hata'ya DÖNMEZ: ikinci 'bulk'/false syncLog YOK, doküman error null", async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeSyncLog = vi.fn(async () => { throw new Error('syncLog kapalı'); });
    const writeAuditLog = vi.fn(async () => { throw new Error('audit kapalı'); });
    const { dep, dokumanlar } = bagimlilik({ writeSyncLog, writeAuditLog });
    const { is, coz } = bekletilenIs('mikroImport-x', { senkronKaydi: { operation: 'ImportStok', entityType: 'inventory', denetimEtiketi: 'E' } });
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    expect(writeSyncLog).toHaveBeenCalledTimes(1);
    expect(writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', '3 yeni / 4 güncel', true, null, null, expect.any(Number), AKTOR);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);   // syncLog'un düşmesi audit'i ATLATMAZ
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ running: false, error: null, created: 3 });
    expect(hata).toHaveBeenCalled();   // sessiz değil
    hata.mockRestore();
  });

  it("(b) BAŞARILI iş, bitiş `set`i atar → syncLog YİNE success=true ×1 (eskiden + 'bulk'/false = aynı koşuya iki zıt satır); doküman running:true'da KALMAZ (asgari bitiş)", async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sahte = sahteDb();
    let setSayac = 0;
    // 1. set = başlangıç (geçer), 2. set = tam bitiş (atar), sonrakiler (asgari bitiş) geçer.
    const db = { collection: (c: string) => ({ doc: (id: string) => {
      const ref = sahte.db.collection(c).doc(id);
      return { id, set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => { if (++setSayac === 2) throw new Error('pg: değer serileştirilemedi'); return ref.set(data, opts); } };
    } }) } as unknown as AdminDbLike;
    const { dep } = bagimlilik({ db });
    const { is, coz } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    expect(dep.writeSyncLog).toHaveBeenCalledTimes(1);
    expect(dep.writeSyncLog).toHaveBeenCalledWith('ImportStok', 'inventory', '3 yeni / 4 güncel', true, null, null, expect.any(Number), AKTOR);
    const dok = sahte.dokumanlar.get('mikroImport-x');
    expect(dok).toMatchObject({ running: false, finishedAt: 'TS', companyId: 'A' });
    expect(String(dok?.error)).toMatch(/^İş bitti ama sonucu kaydedilemedi: pg: değer serileştirilemedi/);
    expect(dok, 'sayaçlar yazılamadı → uydurulmaz').not.toHaveProperty('created');
    hata.mockRestore();
  });

  it('(c) istisna yolunda writeSyncLog SENKRON atarsa (async olmayan fn) → unhandledRejection YOK, slot bırakılır', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeSyncLog = vi.fn((): Promise<unknown> => { throw new Error('senkron patladı'); });
    const { dep, dokumanlar } = bagimlilik({ writeSyncLog });
    const { is, reddet } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    reddet(new Error('ağ'));
    await expect(arkaPlanIsiBekle('mikroImport-x')).resolves.toBeUndefined();
    expect(dokumanlar.get('mikroImport-x')).toMatchObject({ running: false, error: 'ağ' });
    const sonraki = bekletilenIs('mikroImport-x');
    expect(await arkaPlanIsiBaslat(bagimlilik().dep, sonraki.is)).toMatchObject({ started: true });
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    hata.mockRestore();
  });

  it('(c) BAŞARI yolunda writeSyncLog SENKRON atarsa → sonraki defter adımı (audit) YİNE yazılır; doküman başarılı bitiş', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeSyncLog = vi.fn((): Promise<unknown> => { throw new Error('senkron patladı'); });
    const { dep, dokumanlar } = bagimlilik({ writeSyncLog });
    const { is, coz } = bekletilenIs('stokMiktarImport', { senkronKaydi: { operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory', denetimEtiketi: 'Mikro Stok Miktarları' } });
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet());
    await arkaPlanIsiBekle('stokMiktarImport');
    expect(writeSyncLog).toHaveBeenCalledTimes(1);
    expect(dep.writeAuditLog).toHaveBeenCalledWith(AKTOR, 'Mikro Stok Miktarları', '3 yeni / 4 güncel');
    expect(dokumanlar.get('stokMiktarImport')).toMatchObject({ running: false, error: null, created: 3 });
    hata.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Delta hakem 2026-09-25 — bulgu 2 (CONFIRMED/orta): bitiş sinyali kilit bırakılmadan ÖNCE yayınlanıyordu.
// Sıra jobs.set(running:false) → [pgShim INSERT biter bitmez SSE'ye yayar] → syncLog + audit + yazıcı DELETE
// (3-5 PG turu) → birak(). İstemci isiBaslatVeBekle running:false'u "kilit boş" sayıp sonraki adımı hemen
// POST ediyor → sunucu hâlâ eski işi tutuyor → {alreadyRunning, job:'mikroImport-stok'} → Tümünü Çek
// 'Cariler' adımını hiç çalıştırmadan "Başka bir iş çalışıyor" diye hatalı sayıyordu (hakem yeniden üretti).
// ---------------------------------------------------------------------------
describe('arkaPlanIsiBaslat — bitiş sinyali EN SON: running:false yayınlandığında kilit ZATEN boş', () => {
  /** PG gidiş-dönüşü: makro görev (setTimeout) — mikro görevle çözülen sahte yarışı GİZLERDİ. */
  const pgTuru = () => new Promise<void>(r => setTimeout(r, 5));

  /** running:false yazılınca (SSE yayını = INSERT bitti) istemci bir makro görev sonra POST eder. */
  function sinyalliDb(olaylar: string[], sonrakiBaslat: () => Promise<BaslatSonucu>) {
    const sahte = sahteDb();
    let ikinci: Promise<BaslatSonucu> | null = null;
    const db = { collection: (c: string) => ({ doc: (id: string) => {
      const ref = sahte.db.collection(c).doc(id);
      return { id, set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        await ref.set(data, opts);
        if (data.running === false) {
          olaylar.push('bitis-set');
          setTimeout(() => { ikinci = sonrakiBaslat(); }, 0);
        }
      } };
    } }) } as unknown as AdminDbLike;
    return { db, ikinci: () => ikinci, sahte };
  }

  function yavasPool(olaylar: string[]) {
    const pool: SqlCalistirici = {
      query: async (sql) => {
        if (/^DELETE/.test(sql)) { olaylar.push('yazici-sil'); await pgTuru(); }
        if (/^SELECT data FROM docs/.test(sql)) return { rows: [] };
        return { rows: [], rowCount: 1 };
      },
    };
    return pool;
  }

  it('BAŞARI: syncLog → audit → yazıcı silme → bitiş set (EN SON); yayından sonra gelen başlatma started:true', async () => {
    const olaylar: string[] = [];
    const sonraki = bekletilenIs('mikroImport-y');
    const { db, ikinci } = sinyalliDb(olaylar, () => arkaPlanIsiBaslat(bagimlilik().dep, sonraki.is));
    const { dep } = bagimlilik({
      db, pgPool: yavasPool(olaylar),
      writeSyncLog: vi.fn(async () => { olaylar.push('syncLog'); await pgTuru(); }),
      writeAuditLog: vi.fn(async () => { olaylar.push('audit'); await pgTuru(); }),
    });
    const { is, coz } = bekletilenIs('stokMiktarImport', {
      yaziciAdi: 'mikro-import:stokMiktarImport:s',
      senkronKaydi: { operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory', denetimEtiketi: 'Mikro Stok Miktarları' },
    });
    await arkaPlanIsiBaslat(dep, is);
    coz(ozet());
    await arkaPlanIsiBekle('stokMiktarImport');
    await vi.waitFor(() => expect(ikinci()).not.toBeNull());
    expect(await ikinci()).toEqual({ started: true, job: 'mikroImport-y' });
    expect(olaylar).toEqual(['syncLog', 'audit', 'yazici-sil', 'bitis-set']);
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-y');
  });

  it('HATA: syncLog(false) → yazıcı silme → hata set (EN SON); yayından sonra gelen başlatma started:true', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const olaylar: string[] = [];
    const sonraki = bekletilenIs('mikroImport-y');
    const { db, ikinci } = sinyalliDb(olaylar, () => arkaPlanIsiBaslat(bagimlilik().dep, sonraki.is));
    const { dep } = bagimlilik({
      db, pgPool: yavasPool(olaylar),
      writeSyncLog: vi.fn(async () => { olaylar.push('syncLog'); await pgTuru(); }),
    });
    const { is, reddet } = bekletilenIs('mikroImport-x', { yaziciAdi: 'mikro-import:mikroImport-x:h' });
    await arkaPlanIsiBaslat(dep, is);
    reddet(new Error('ağ'));
    await arkaPlanIsiBekle('mikroImport-x');
    await vi.waitFor(() => expect(ikinci()).not.toBeNull());
    expect(await ikinci()).toEqual({ started: true, job: 'mikroImport-y' });
    expect(olaylar).toEqual(['syncLog', 'yazici-sil', 'bitis-set']);
    sonraki.coz(ozet());
    await arkaPlanIsiBekle('mikroImport-y');
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Delta hakem 2026-09-25 — bulgu 3/8 (CONFIRMED): stok-miktar'da kısa devre V17 yoklamasının ARKASINA
// kaymıştı (HEAD 2582 "kısa devre ÖNCE, hiçbir sorgu yok"). Kilit doluyken yoklama koşan işe paralel
// Mikro'ya gidiyor, yük altında düşerse false 10 dk önbelleğe giriyor → yanıltıcı 501 (hakem yeniden üretti).
// ---------------------------------------------------------------------------
describe('arkaPlanIsiKosan / arkaPlanOnKontrol — pahalı yoklamadan ÖNCE ucuz kısa devre', () => {
  it('arkaPlanIsiKosan: boşta null; iş sürerken ÇALIŞAN işin adı; bitince null', async () => {
    expect(arkaPlanIsiKosan()).toBeNull();
    const { dep } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    expect(arkaPlanIsiKosan()).toBe('mikroImport-x');
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
    expect(arkaPlanIsiKosan()).toBeNull();
  });

  it('arkaPlanOnKontrol: iş sürerken alreadyRunning(job = koşan iş) — PG\'ye HİÇ gidilmez', async () => {
    const { dep } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    const { pool, sorgular } = sahtePool({ aciklama: 'k', baslangic: 'b' });
    expect(await arkaPlanOnKontrol({ pgPool: pool }, { bakimKilidi: true })).toEqual({ started: false, alreadyRunning: true, job: 'mikroImport-x' });
    expect(sorgular).toEqual([]);
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
  });

  it('arkaPlanOnKontrol: boşta + bakım kilidi → { kilit } (yalnız OKUMA: yazıcı kaydı YOK); kilit yoksa null; bakimKilidi:false → havuza bakılmaz', async () => {
    const kilit = { aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' };
    const kilitli = sahtePool(kilit);
    expect(await arkaPlanOnKontrol({ pgPool: kilitli.pool }, { bakimKilidi: true })).toEqual({ started: false, kilit });
    expect(kilitli.sorgular.every(q => /^SELECT/.test(q.sql))).toBe(true);
    const bos = sahtePool(null);
    expect(await arkaPlanOnKontrol({ pgPool: bos.pool }, { bakimKilidi: true })).toBeNull();
    const atla = sahtePool(kilit);
    expect(await arkaPlanOnKontrol({ pgPool: atla.pool }, { bakimKilidi: false })).toBeNull();
    expect(atla.sorgular).toEqual([]);
    expect(await arkaPlanOnKontrol({ pgPool: null }, { bakimKilidi: true })).toBeNull();
  });

  it('arkaPlanYaziciAdi: `mikro-import:<isAdi>:<zaman36>` — açılış taraması önekle bulur (tek kaynak)', () => {
    expect(arkaPlanYaziciAdi('mikroImport-cari', 36 ** 3)).toBe('mikro-import:mikroImport-cari:1000');
  });
});

// ---------------------------------------------------------------------------
// Delta hakem 2026-09-25 — bulgu 1/11 (CONFIRMED/orta): yarıda kalan işin kaydını açılışta kapatan tarama
// yoktu. `calisanlar` süreçle sıfırlanıyor ama jobs/<isAdi> running:true KALIYOR (deploy = Stop/Restart-Service):
// kart sonsuza dek 'Çalışıyor…'; Tümünü Çek adımı 30 dk asılı kalıp yanıltıcı "30 dk içinde bitmedi" diyor;
// syncLog'da o koşunun satırı yok; `yazici:mikro-import:*` 2 saat (YAZICI_BAYAT_MS) aktif sayılıyor →
// lead-birlestir yazicilariBekle 15 dk sonra düşüyor. NSSM tek süreç: açılışta running:true = kesin yetim.
// ---------------------------------------------------------------------------
describe('yetimIsleriKapat — açılışta yarıda kalan işleri kapatır', () => {
  type Dok = Record<string, unknown>;
  function taramaDb(dokumanlar: Record<string, Dok>) {
    const yazimlar: Array<{ id: string; data: Dok; merge: boolean }> = [];
    const ref = (id: string) => ({
      id,
      set: async (data: Dok, opts?: { merge?: boolean }) => {
        yazimlar.push({ id, data, merge: !!opts?.merge });
        dokumanlar[id] = opts?.merge ? { ...(dokumanlar[id] ?? {}), ...data } : { ...data };
      },
    });
    const sorgu = (filtre: Array<[string, unknown]>) => ({
      where: (alan: string, _op: string, deger: unknown) => sorgu([...filtre, [alan, deger]]),
      get: async () => {
        const docs = Object.entries(dokumanlar)
          .filter(([, v]) => filtre.every(([a, d]) => v[a] === d))
          .map(([id, v]) => ({ id, data: () => ({ ...v }), ref: ref(id) }));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    });
    const db = { collection: (c: string) => {
      if (c !== 'jobs') throw new Error(`beklenmeyen koleksiyon: ${c}`);
      return { ...sorgu([]), doc: (id: string) => ref(id) };
    } } as unknown as AdminDbLike;
    return { db, yazimlar, dokumanlar };
  }
  /** Süreç başlangıcı sabit: bundan ÖNCE kaydolan yazıcı yarıda kalmıştır (silinir), SONRA kaydolan canlıdır. */
  const SUREC = Date.parse('2026-09-25T10:00:00Z');
  const ONCE = '2026-09-25T09:59:00.000Z';
  const SONRA = '2026-09-25T10:00:05.000Z';
  function yaziciPool(adlar: string[], baslangic: string | Record<string, string>) {
    const silinen: string[] = [];
    const pool: SqlCalistirici = {
      query: async (sql, params) => {
        if (/^SELECT id, data FROM docs/.test(sql)) return { rows: adlar.map(ad => ({ id: `yazici:${ad}`, data: { baslangic: typeof baslangic === 'string' ? baslangic : baslangic[ad] } })) };
        if (/^DELETE/.test(sql)) { silinen.push(String(params?.[1])); return { rows: [], rowCount: 1 }; }
        return { rows: [] };
      },
    };
    return { pool, silinen };
  }

  it("running:true + isAdi → { running:false, error, finishedAt } merge; syncLog(operation, entityType, 'bulk', false, null, hata, null) — süre BİLİNMİYOR (0 uydurulmaz); başkaları DOKUNULMAZ", async () => {
    const { db, yazimlar, dokumanlar } = taramaDb({
      'mikroImport-cari-hareket': { running: true, isAdi: 'mikroImport-cari-hareket', companyId: 'A', sayfa: 2, operation: 'SQL:CARI_HESAP_HAREKETLERI', entityType: 'mikroCariHareketler' },
      'stokMiktarImport': { running: false, isAdi: 'stokMiktarImport', companyId: 'A', error: null },
      'baskaIs': { running: true, companyId: 'A' },                           // bu yardımcının yazmadığı kayıt
      'mikroImport-stok': { running: true, isAdi: 'mikroImport-stok', companyId: 'A' },   // eski koşu: operation yok
    });
    const writeSyncLog = vi.fn(async () => {});
    const { pool, silinen } = yaziciPool(['mikro-import:mikroImport-cari-hareket:x1', 'mikro-import:1a2b', 'parasut-import-cari:zz', 'mikro-cron'], ONCE);
    const sonuc = await yetimIsleriKapat({ db, pgPool: pool, writeSyncLog, simdi: () => SUREC + 60_000, surecBaslangici: SUREC });
    expect(sonuc.kapatilan.sort()).toEqual(['mikroImport-cari-hareket', 'mikroImport-stok']);
    for (const id of ['mikroImport-cari-hareket', 'mikroImport-stok']) {
      expect(dokumanlar[id]).toMatchObject({ running: false, error: YETIM_IS_HATASI, finishedAt: 'TS', companyId: 'A', isAdi: id });
    }
    expect(dokumanlar['mikroImport-cari-hareket']).toMatchObject({ sayfa: 2 });   // son ilerleme KORUNUR (merge)
    expect(yazimlar.every(y => y.merge)).toBe(true);
    expect(dokumanlar.baskaIs).toEqual({ running: true, companyId: 'A' });
    expect(dokumanlar.stokMiktarImport).toMatchObject({ running: false, error: null });
    expect(writeSyncLog).toHaveBeenCalledTimes(1);   // operation'sız eski kayıt için işlem adı UYDURULMAZ
    expect(writeSyncLog).toHaveBeenCalledWith('SQL:CARI_HESAP_HAREKETLERI', 'mikroCariHareketler', 'bulk', false, null, YETIM_IS_HATASI, null);
    // Yalnız arka plan işlerinin yazıcı kayıtları (bu süreçten kalan) silinir; başka yazıcılar DOKUNULMAZ.
    expect(silinen.sort()).toEqual(['yazici:mikro-import:1a2b', 'yazici:mikro-import:mikroImport-cari-hareket:x1']);
    expect(sonuc.silinenYazici.sort()).toEqual(['mikro-import:1a2b', 'mikro-import:mikroImport-cari-hareket:x1']);
  });

  it('BU süreçte koşan iş (açılıştan sonra başladıysa) KAPATILMAZ — canlı işin dokümanı ezilmez', async () => {
    const { dep } = bagimlilik();
    const { is, coz } = bekletilenIs('mikroImport-x');
    await arkaPlanIsiBaslat(dep, is);
    const { db, dokumanlar } = taramaDb({ 'mikroImport-x': { running: true, isAdi: 'mikroImport-x', companyId: 'A' } });
    const sonuc = await yetimIsleriKapat({ db, pgPool: null, writeSyncLog: vi.fn(async () => {}) });
    expect(sonuc.kapatilan).toEqual([]);
    expect(dokumanlar['mikroImport-x']).toMatchObject({ running: true });
    coz(ozet());
    await arkaPlanIsiBekle('mikroImport-x');
  });

  it('ASLA reject etmez: jobs sorgusu atarsa loglanır, yazıcı temizliği yine denenir', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { collection: () => ({ where: () => ({ get: async () => { throw new Error('pg kapalı'); } }) }) } as unknown as AdminDbLike;
    const { pool, silinen } = yaziciPool(['mikro-import:mikroImport-stok:q'], ONCE);
    await expect(yetimIsleriKapat({ db, pgPool: pool, writeSyncLog: vi.fn(async () => {}), simdi: () => SUREC + 60_000, surecBaslangici: SUREC })).resolves.toMatchObject({ kapatilan: [] });
    expect(silinen).toEqual(['yazici:mikro-import:mikroImport-stok:q']);
    expect(hata).toHaveBeenCalled();
    hata.mockRestore();
  });

  // İnceleme bulgusu 2026-09-25: fabrikadan önceki sürüm `jobs/stokMiktarImport`u `isAdi`siz yazıyordu;
  // deploy anında koşuyorsa kayıt `running:true` kalır ve hiç kapanmazdı. Liste KAPALI: diğer isAdi'siz kayıt yine dokunulmaz.
  it("eski biçimli (isAdi'siz) jobs/stokMiktarImport running:true → kapatılır; başka isAdi'siz kayıt DOKUNULMAZ; operation yoksa syncLog YOK", async () => {
    const { db, dokumanlar } = taramaDb({
      stokMiktarImport: { running: true, startedAt: 'eski', companyId: 'A', processed: 40, total: 900 },
      digerEski: { running: true, companyId: 'A' },
    });
    const writeSyncLog = vi.fn(async () => {});
    const sonuc = await yetimIsleriKapat({ db, pgPool: null, writeSyncLog, surecBaslangici: SUREC });
    expect(sonuc.kapatilan).toEqual(['stokMiktarImport']);
    expect(dokumanlar.stokMiktarImport).toMatchObject({ running: false, error: YETIM_IS_HATASI, finishedAt: 'TS', processed: 40, total: 900 });
    expect(dokumanlar.digerEski).toEqual({ running: true, companyId: 'A' });
    expect(writeSyncLog).not.toHaveBeenCalled();
  });

  // İnceleme bulgusu 2026-09-25: süreç başladıktan SONRA kaydolan yazıcı canlı bir koşudur (bu süreçte dinleme
  // taramadan önce başladıysa ya da aynı PG'yi kullanan başka süreçte) → silinirse lead-birlestir onu beklemez.
  // Delta hakem 2026-09-25: varsayılan (surecBaslangici verilmezse) hesap hiçbir testte koşmuyordu — `?? 0`,
  // `?? simdi()` ya da `*1000`'siz uptime mutantları yeşil kalıyordu. Varsayılan = simdi − uptime × 1000.
  it('surecBaslangiciMs: şimdi − çalışma saniyesi × 1000 (server.ts ve varsayılan AYNI formül); varsayılanlar Date.now/process.uptime', () => {
    expect(surecBaslangiciMs(1_000_000, 30)).toBe(970_000);
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(2);
    const simdi = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    try { expect(surecBaslangiciMs()).toBe(48_000); } finally { uptime.mockRestore(); simdi.mockRestore(); }
  });

  it('surecBaslangici VERİLMEZSE simdi() − process.uptime()×1000: 29. sn\'de kaydolan silinir, 31. sn\'de kaydolan kalır', async () => {
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(30);
    try {
      const { db } = taramaDb({});
      const once = new Date(SUREC + 29_000).toISOString(), sonra = new Date(SUREC + 31_000).toISOString();
      const { pool, silinen } = yaziciPool(['mikro-import:a:eski', 'mikro-import:b:canli'], { 'mikro-import:a:eski': once, 'mikro-import:b:canli': sonra });
      await yetimIsleriKapat({ db, pgPool: pool, writeSyncLog: vi.fn(async () => {}), simdi: () => SUREC + 60_000 });
      expect(silinen).toEqual(['yazici:mikro-import:a:eski']);
    } finally {
      uptime.mockRestore();
    }
  });

  it('süreç başlangıcından SONRA kaydolan arka plan yazıcısı SİLİNMEZ; ÖNCE kaydolan silinir', async () => {
    const { db } = taramaDb({});
    const { pool, silinen } = yaziciPool(
      ['mikro-import:mikroImport-cari:eski', 'mikro-import:mikroImport-stok:canli'],
      { 'mikro-import:mikroImport-cari:eski': ONCE, 'mikro-import:mikroImport-stok:canli': SONRA });
    const sonuc = await yetimIsleriKapat({ db, pgPool: pool, writeSyncLog: vi.fn(async () => {}), simdi: () => SUREC + 60_000, surecBaslangici: SUREC });
    expect(silinen).toEqual(['yazici:mikro-import:mikroImport-cari:eski']);
    expect(sonuc.silinenYazici).toEqual(['mikro-import:mikroImport-cari:eski']);
  });
});
