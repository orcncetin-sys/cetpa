// @vitest-environment node
/**
 * gonderimDefteri.olcum.test.ts — gönderim defterinin ÖLÇÜM parçası, gerçek PostgreSQL motoruyla (PGlite) (şartname
 * `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K0b, § 8.2 commit 0-B; v2 T0; M0.4, M0.6, M0.7, M0.18, M0.19, M0.21).
 *
 * Modül düzeyindeki durum (kip önbelleği, uçuş kümesi, hata sayacı) sınamalar arasında taşınmasın diye her sınama modülü
 * `vi.resetModules` + dinamik içe aktarımla TAZE yükler. PGlite tek oturumdur: `connect()` aynı oturumu döndürür.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_TABLOSU_DDL } from '../docsSema';
import { SERVER_ONLY_COLLECTIONS } from '../../lib/collections';
import { join } from 'path';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari } from '../../test/kaynakTarama';

type Defter = typeof import('./gonderimDefteri');
interface Havuz {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  connect: () => Promise<Havuz & { release: () => void }>;
}

let db: PGlite;
let havuz: Havuz;
/** Sorgu öncesi kanca (yavaş / hatalı INSERT, okuma hatası). */
let kanca: ((sql: string, p: unknown[] | undefined) => Promise<void> | void) | null = null;

async function havuzKur(): Promise<void> {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  const query = async (sql: string, params?: unknown[]) => {
    if (kanca) await kanca(sql, params);
    const r = await db.query<Record<string, unknown>>(sql, params ?? []);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  havuz = { query, connect: async () => ({ ...havuz, release: () => undefined }) };
}
const oku = async (coll: string, id: string): Promise<Record<string, unknown> | undefined> =>
  (await db.query<{ data: Record<string, unknown> }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id])).rows[0]?.data;
const koy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const olcumler = async (): Promise<Array<{ id: string; data: Record<string, unknown> }>> =>
  (await db.query<{ id: string; data: Record<string, unknown> }>("SELECT id, data FROM docs WHERE coll = 'mikroGonderimleri' ORDER BY id")).rows;

let D: Defter;
beforeEach(async () => {
  vi.resetModules();
  D = await import('./gonderimDefteri');
  kanca = null;
  await havuzKur();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('defter koleksiyonu', () => {
  it('`mikroGonderimleri` SERVER_ONLY listesinde (API, akış ve kiracı yedeği kapalı)', () => {
    expect(SERVER_ONLY_COLLECTIONS).toContain(D.DEFTER_KOLEKSIYONU);
    expect(D.KIP_BELGESI.coll).toBe('opsLocks');
    expect(SERVER_ONLY_COLLECTIONS).toContain(D.KIP_BELGESI.coll);
  });
});

describe('K22 çiti — defter koleksiyonuna yazım YALNIZ gonderimDefteri.ts\'te; SSE yayını yok', () => {
  it("`mikroGonderimleri` adı üretim kodunda yalnız gonderimDefteri.ts'te (src/server/**, server.ts); dosyada broadcastDocChange yok", () => {
    const dosyalar = [...kaynakDosyalari(join(SRC_KOK, 'server')), join(SRC_KOK, '..', 'server.ts')];
    const yerler = dosyalar.flatMap(yol => kodSatirlari(yol).filter(s => s.kod.includes('mikroGonderimleri')).map(() => gorece(yol)));
    expect([...new Set(yerler)]).toEqual(['src/server/mikro/gonderimDefteri.ts']);
    const defterKodu = kodSatirlari(join(SRC_KOK, 'server', 'mikro', 'gonderimDefteri.ts')).map(s => s.kod).join('\n');
    expect(defterKodu).not.toMatch(/broadcastDocChange/);
    expect(defterKodu).not.toMatch(/getAdminDb|adminDb\./);
  });
});

describe('kip okuma — varsayılan `kapali`; 10 sn önbellek', () => {
  it('satır yok / havuz yok / okuma fırlatır / `kip` alanı tanınmıyor → kapali', async () => {
    // Hata dalı ÖNCE (önbellek boşken): başarılı bir okuma 10 sn önbelleğe yazar ve ardından gelen hatalı havuz hiç
    // sorgulanmaz — o sırada sınanan önbellek olurdu, hata dalı değil (M0.6 bu sırayla burada da kırmızı).
    const hatali = { query: async () => { throw new Error('bağlantı yok'); } };
    expect(await D.gonderimKipiOku(hatali)).toBe('kapali');
    expect(await D.gonderimKipiOku(havuz)).toBe('kapali');
    expect(await D.gonderimKipiOku(null)).toBe('kapali');
    expect(await D.gonderimKipiOku(undefined)).toBe('kapali');
  });

  it('test düzeneğinin kilit satırı (her sorguya `{ aciklama, baslangic }`) ve Dilim 1 kipleri `kapali` sayılır (M0.18)', async () => {
    const kilitDuzenegi = { query: async () => ({ rows: [{ data: { aciklama: 'lead-birlestir', baslangic: '2026-10-18T08:00:00.000Z' } }] }) };
    expect(await D.gonderimKipiOku(kilitDuzenegi)).toBe('kapali');
    for (const kip of ['tam', 'durdur', 'OLCUM', 1, null]) {
      vi.resetModules(); const taze = await import('./gonderimDefteri');
      expect(await taze.gonderimKipiOku({ query: async () => ({ rows: [{ data: { kip } }] }) }), String(kip)).toBe('kapali');
    }
    vi.resetModules(); const taze = await import('./gonderimDefteri');
    expect(await taze.gonderimKipiOku({ query: async () => ({ rows: [{ data: { kip: 'olcum' } }] }) })).toBe('olcum');
  });

  it('başarılı okuma 10 sn önbellekte; süre dolunca yeniden okunur', async () => {
    const t0 = 1_800_000_000_000;
    expect(await D.gonderimKipiOku(havuz, t0)).toBe('kapali');
    await koy('opsLocks', 'mikroGonderim:kip', { kip: 'olcum' });
    expect(await D.gonderimKipiOku(havuz, t0 + 5_000)).toBe('kapali');
    expect(await D.gonderimKipiOku(havuz, t0 + 9_999)).toBe('kapali');
    expect(await D.gonderimKipiOku(havuz, t0 + 10_001)).toBe('olcum');
  });

  it('okuma hatası önbelleğe YAZILMAZ: hemen sonraki başarılı okuma gerçek değeri verir', async () => {
    await koy('opsLocks', 'mikroGonderim:kip', { kip: 'olcum' });
    kanca = () => { throw new Error('geçici PG hatası'); };
    expect(await D.gonderimKipiOku(havuz, 1000)).toBe('kapali');
    kanca = null;
    expect(await D.gonderimKipiOku(havuz, 1001)).toBe('olcum');
  });
});

describe('kip yazımı — `neden` zorunlu, yalnız `kapali | olcum`, belge birleştirilir, geçmiş 10', () => {
  it('`neden`siz, boş, 201 karakter → 400; 200 karakter geçer', async () => {
    expect(await D.gonderimKipiYaz(havuz, { kip: 'olcum' })).toMatchObject({ tamam: false, durum: 400 });
    expect(await D.gonderimKipiYaz(havuz, { kip: 'olcum', neden: '   ' })).toMatchObject({ tamam: false, durum: 400 });
    expect(await D.gonderimKipiYaz(havuz, { kip: 'olcum', neden: 'ş'.repeat(201) })).toMatchObject({ tamam: false, durum: 400 });
    expect(await oku('opsLocks', 'mikroGonderim:kip')).toBeUndefined();
    expect(await D.gonderimKipiYaz(havuz, { kip: 'olcum', neden: 'ş'.repeat(200) })).toMatchObject({ tamam: true, kip: 'olcum', onceki: 'kapali' });
  });

  it('`tam` / `durdur` (Dilim 1) ve tanınmayan değer → 400, belge yazılmaz; havuz yok → 503', async () => {
    for (const kip of ['tam', 'durdur', 'acik', undefined, 3]) {
      const r = await D.gonderimKipiYaz(havuz, { kip, neden: 'deneme' });
      expect(r, String(kip)).toMatchObject({ tamam: false, durum: 400 });
    }
    expect(await oku('opsLocks', 'mikroGonderim:kip')).toBeUndefined();
    expect(await D.gonderimKipiYaz(null, { kip: 'olcum', neden: 'deneme' })).toMatchObject({ tamam: false, durum: 503 });
  });

  it('yazım bu süreçte HEMEN etkir (önbellek yenilenir); öteki alanlar (Dilim 1 `ilkNumaraliAt`) KORUNUR (M0.19)', async () => {
    await koy('opsLocks', 'mikroGonderim:kip', { kip: 'kapali', ilkNumaraliAt: 1_700_000_000_000, baskaAlan: 'dokunulmaz' });
    expect(await D.gonderimKipiOku(havuz, 5000)).toBe('kapali');
    const r = await D.gonderimKipiYaz(havuz, { kip: 'olcum', neden: 'Dilim 0 ölçümü' }, 5001);
    expect(r).toEqual({ tamam: true, kip: 'olcum', onceki: 'kapali', at: 5001 });
    expect(await D.gonderimKipiOku(havuz, 5002)).toBe('olcum');
    expect(await oku('opsLocks', 'mikroGonderim:kip')).toMatchObject({
      kip: 'olcum', neden: 'Dilim 0 ölçümü', at: 5001, kaynak: 'ops', ilkNumaraliAt: 1_700_000_000_000, baskaAlan: 'dokunulmaz',
      gecmis: [{ kip: 'olcum', onceki: 'kapali', neden: 'Dilim 0 ölçümü', at: 5001 }],
    });
  });

  it('11. değişiklikte `gecmis` 10 öğe, en eski düşer (M0.21)', async () => {
    for (let i = 1; i <= 11; i++) {
      const r = await D.gonderimKipiYaz(havuz, { kip: i % 2 ? 'olcum' : 'kapali', neden: `değişiklik ${i}` }, 1000 + i);
      expect(r.tamam).toBe(true);
    }
    const belge = await oku('opsLocks', 'mikroGonderim:kip');
    const gecmis = belge?.gecmis as Array<{ neden: string }>;
    expect(gecmis).toHaveLength(10);
    expect(gecmis[0].neden).toBe('değişiklik 2');
    expect(gecmis[9].neden).toBe('değişiklik 11');
  });
});

const GIRDI = {
  companyId: Promise.resolve('CETPA'), uc: '/api/mikro/evrak/kaydet', method: 'PersonelizinKaydetV2',
  entityType: 'leaveRequest', entityId: 'izin-ayse-2110', payload: { izin: { personel: 'Ayşe Yılmaz', gun: 5 } },
};
const BASARI = { ok: true, status: 200, data: { result: [{ IsError: false, Data: { evrakNo: 'IZN-77' } }] } };

describe('ölçüm kaydı — gövdesiz, Mikro çağrısını bekletmez', () => {
  it('kayıt: tür, kiracı, yöntem, özetler VAR; gövde, düz entityId, sahip, hata METNİ YOK; bitir → `bitti` + ölçü', async () => {
    const k = D.olcumBaslat(havuz, GIRDI);
    expect(k).not.toBeNull();
    if (!k) return;
    await k.bitir({ tur: 'yanit', yanit: BASARI, gonderilmedi: false, stub: false, sureMs: 42 });
    const [satir] = await olcumler();
    expect(satir.id).toMatch(/^o_[0-9a-f-]{36}$/);
    expect(satir.data).toMatchObject({
      kayitTuru: 'olcum', companyId: 'CETPA', uc: '/api/mikro/evrak/kaydet', method: 'PersonelizinKaydetV2', entityType: 'leaveRequest',
      durum: 'bitti', gonderilmedi: false, stub: false, evrakSayisi: null,
      sonuc: { httpDurum: 200, jsonMu: true, resultUzunlugu: 1, hataliOgeSayisi: 0, evrakSayisi: null, hataAdi: null, hataKodu: null, sureMs: 42 },
      yanitAnahtarlari: expect.arrayContaining(['result[0].Data.evrakNo']),
    });
    expect(satir.data.govdeOzeti).toMatch(/^[0-9a-f]{64}$/);
    expect(satir.data.varlikOzeti).toMatch(/^[0-9a-f]{64}$/);
    const metin = JSON.stringify(satir.data);
    for (const yasak of ['izin-ayse-2110', 'Ayşe', 'IZN-77', 'sahipUid', 'govde"', 'payload']) expect(metin, yasak).not.toContain(yasak);
  });

  it('hata sonucu: ad + neden kodu, ileti METNİ yok; `gonderilmedi` işareti taşınır', async () => {
    const k = D.olcumBaslat(havuz, GIRDI);
    if (!k) throw new Error('kayıt yok');
    const hata = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:8094'), { code: 'ECONNREFUSED' }) });
    await k.bitir({ tur: 'hata', hata, gonderilmedi: true, sureMs: 7 });
    const [satir] = await olcumler();
    expect(satir.data).toMatchObject({ durum: 'bitti', gonderilmedi: true, stub: false, sonuc: { hataAdi: 'TypeError', hataKodu: 'ECONNREFUSED', httpDurum: null } });
    expect(JSON.stringify(satir.data)).not.toContain('10.1.2.3');
    expect(JSON.stringify(satir.data)).not.toContain('fetch failed');
  });

  it('INSERT Mikro çağrısını BEKLETMEZ: `olcumBaslat` yavaş INSERT bitmeden döner; sonuç INSERT\'ten SONRA yazılır (M0.7)', async () => {
    let insertBitti = false;
    kanca = async (sql) => { if (sql.startsWith('INSERT')) { await new Promise(r => setTimeout(r, 150)); insertBitti = true; } };
    const k = D.olcumBaslat(havuz, GIRDI);
    expect(insertBitti).toBe(false);                                  // çağıran Mikro'ya hemen geçebilir
    if (!k) throw new Error('kayıt yok');
    await k.bitir({ tur: 'yanit', yanit: BASARI, gonderilmedi: false, stub: false, sureMs: 1 });
    expect(insertBitti).toBe(true);
    expect((await olcumler())[0].data.durum).toBe('bitti');
  });

  it('INSERT hatası yutulur: sayaç 1, `bitir` hiçbir şey yazmaz; ikinci `bitir` yok sayılır', async () => {
    kanca = (sql) => { if (sql.startsWith('INSERT')) throw new Error('disk dolu'); };
    const k = D.olcumBaslat(havuz, GIRDI);
    if (!k) throw new Error('kayıt yok');
    await k.bitir({ tur: 'yanit', yanit: BASARI, gonderilmedi: false, stub: false, sureMs: 1 });
    await k.bitir({ tur: 'yanit', yanit: BASARI, gonderilmedi: false, stub: false, sureMs: 1 });
    kanca = null;
    expect(await olcumler()).toEqual([]);
    const ozet = await D.mikroGonderimOzetiOku(havuz);
    expect(ozet.surec).toMatchObject({ kayitAcmaHatasi: 1, sonucYazmaHatasi: 0, ucustaki: 0 });
  });

  it('havuz yok → kayıt yok (`null`)', () => {
    expect(D.olcumBaslat(null, GIRDI)).toBeNull();
  });
});

describe('açılış işareti — süreç öncesi `suruyor` → `kesildi`; bu süreçte açılan ve uçuştaki kayıt dokunulmaz (M0.4)', () => {
  it('üç kayıt: eski yarım → kesildi (kesenSurec), bu süreçte açılan ve uçuştaki → suruyor; `bitti` dokunulmaz', async () => {
    const SUREC = 1_800_000_000_000;
    await koy('mikroGonderimleri', 'o_eski', { kayitTuru: 'olcum', durum: 'suruyor', olusturmaAt: SUREC - 60_000, guncellemeAt: SUREC - 60_000 });
    await koy('mikroGonderimleri', 'o_bu_surec', { kayitTuru: 'olcum', durum: 'suruyor', olusturmaAt: SUREC + 5, guncellemeAt: SUREC + 5 });
    await koy('mikroGonderimleri', 'o_eski_bitti', { kayitTuru: 'olcum', durum: 'bitti', olusturmaAt: SUREC - 90_000, guncellemeAt: SUREC - 89_000 });
    // Uçuştaki kayıt: saati süreç başlangıcından ÖNCE gösteren bir saatle açılır (süzgeç yalnız uçuş kümesiyle korur).
    const ucusta = D.olcumBaslat(havuz, GIRDI, () => SUREC - 30_000);
    if (!ucusta) throw new Error('kayıt yok');
    await vi.waitFor(async () => expect((await olcumler()).some(s => s.id === ucusta.id)).toBe(true));

    const r = await D.olcumAcilisIsareti(havuz, SUREC, SUREC + 1000);
    expect(r).toEqual({ kesilen: 1 });
    expect((await D.mikroGonderimOzetiOku(havuz, SUREC + 2000)).surec.sonAcilisIsareti).toEqual({ at: new Date(SUREC + 1000).toISOString(), kesilen: 1 });
    expect(await oku('mikroGonderimleri', 'o_eski')).toMatchObject({ durum: 'kesildi', kesenSurec: SUREC, guncellemeAt: SUREC + 1000 });
    expect(await oku('mikroGonderimleri', 'o_bu_surec')).toMatchObject({ durum: 'suruyor' });
    expect(await oku('mikroGonderimleri', 'o_eski_bitti')).toMatchObject({ durum: 'bitti' });
    expect(await oku('mikroGonderimleri', ucusta.id)).toMatchObject({ durum: 'suruyor' });
    // Uçuş biter: sonuç yazılır (açılış işareti onu `kesildi` yapmadığı için).
    await ucusta.bitir({ tur: 'yanit', yanit: BASARI, gonderilmedi: false, stub: false, sureMs: 3 });
    expect(await oku('mikroGonderimleri', ucusta.id)).toMatchObject({ durum: 'bitti' });
  });

  it('havuz yok → 0; sorgu hatası fırlatmaz', async () => {
    expect(await D.olcumAcilisIsareti(null, 1)).toEqual({ kesilen: 0 });
    expect(await D.olcumAcilisIsareti({ query: async () => { throw new Error('yok'); } }, 1)).toEqual({ kesilen: 0 });
  });
});

describe('ops özeti — saf toplayıcılar (gövde, kiracı, kullanıcı, varlık kimliği YOK)', () => {
  const SIMDI = 1_800_000_000_000;
  const satir = (o: Record<string, unknown>): Record<string, unknown> => ({
    kayitTuru: 'olcum', companyId: 'gizli-kiraci-uid', method: 'PersonelizinKaydetV2', govdeOzeti: 'g1', varlikOzeti: 'v1', durum: 'bitti',
    sonuc: { httpDurum: 200, jsonMu: true, resultUzunlugu: 1, hataliOgeSayisi: 0, evrakSayisi: null, hataAdi: null, hataKodu: null, sureMs: 5 },
    yanitAnahtarlari: ['result[0].IsError'], ...o,
  });

  it('15 dk içinde aynı içerik; 7 gün içinde aynı varlık — ikincisi başarılı / başarısız / bilinmiyor', () => {
    const o = D.olcumOzeti([
      satir({ olusturmaAt: SIMDI - 3 * 86_400_000, stub: true, sonuc: { httpDurum: 200, jsonMu: true, resultUzunlugu: null, hataliOgeSayisi: null } }),
      satir({ olusturmaAt: SIMDI - 3 * 86_400_000 + 10 * 60_000 }),                                  // aynı içerik 10 dk sonra, başarılı
      satir({ olusturmaAt: SIMDI - 86_400_000, govdeOzeti: 'g2', sonuc: { httpDurum: 200, jsonMu: true, resultUzunlugu: 1, hataliOgeSayisi: 1 } }),
      satir({ olusturmaAt: SIMDI - 1000, govdeOzeti: 'g3', durum: 'kesildi', kesenSurec: SIMDI - 2000, sonuc: undefined }),
      satir({ olusturmaAt: SIMDI - 500, varlikOzeti: null, govdeOzeti: 'g4', gonderilmedi: true,
        sonuc: { hataAdi: 'TypeError', hataKodu: 'ECONNREFUSED', httpDurum: null, jsonMu: null } }),
    ], SIMDI);
    expect(o.toplam).toBe(5);
    expect(o.son24Saat).toBe(2);
    expect(o.durumBasina).toEqual({ bitti: 4, kesildi: 1 });
    expect(o.stub).toBe(1);
    expect(o.gonderilmedi).toBe(1);
    expect(o.tekrar.ayniGovde15dk).toBe(1);
    expect(o.tekrar.ayniVarlik7gun).toEqual({ toplam: 3, ikincisiBasarili: 1, ikincisiBasarisiz: 1, ikincisiBilinmiyor: 1 });
    expect(o.hata).toEqual({ 'TypeError/ECONNREFUSED': 1 });
    expect(o.httpDurumu).toEqual({ 200: 3 });                 // kesilen ve fırlatan kayıtta HTTP durumu yok
    expect(o.resultEvrak).toEqual({ '-/-': 1, '1/-': 2 });
    expect(o.kesildiSurecBasina).toEqual([{ surecBaslangici: new Date(SIMDI - 2000).toISOString(), sayi: 1 }]);
    expect(o.yanitAnahtarlari).toEqual({ PersonelizinKaydetV2: { 'result[0].IsError': 5 } });
    expect(JSON.stringify(o)).not.toContain('gizli-kiraci-uid');
    expect(JSON.stringify(o)).not.toContain('"g1"');
  });

  it('16 dk ve 8 gün aralık tekrar SAYILMAZ; zamanı sayı olmayan satır sayılmaz', () => {
    const o = D.olcumOzeti([
      satir({ olusturmaAt: SIMDI - 9 * 86_400_000 }),
      satir({ olusturmaAt: SIMDI - 9 * 86_400_000 + 16 * 60_000, varlikOzeti: 'v2' }),
      satir({ olusturmaAt: SIMDI - 86_400_000 }),
      satir({ olusturmaAt: 'dün' }),
    ], SIMDI);
    expect(o.toplam).toBe(3);
    expect(o.tekrar.ayniGovde15dk).toBe(0);
    expect(o.tekrar.ayniVarlik7gun.toplam).toBe(0);
  });

  it('syncJobsOzeti: durum sayıları, son 30 günde ölü, en eski createdAt; tanınmayan durum «diger»', () => {
    const o = D.syncJobsOzeti([
      { durum: 'queued', olusturma: SIMDI - 5000, guncelleme: SIMDI - 5000 },
      { durum: 'dead', olusturma: SIMDI - 40 * 86_400_000, guncelleme: SIMDI - 2 * 86_400_000 },
      { durum: 'dead', olusturma: SIMDI - 50 * 86_400_000, guncelleme: SIMDI - 45 * 86_400_000 },
      { durum: '<script>', olusturma: null, guncelleme: null },
    ], SIMDI);
    expect(o).toEqual({
      toplam: 4, durumBasina: { queued: 1, dead: 2, diger: 1 }, son30GunOlu: 1,
      enEskiCreatedAt: new Date(SIMDI - 50 * 86_400_000).toISOString(),
    });
    expect(D.syncJobsOzeti([], SIMDI)).toEqual({ toplam: 0, durumBasina: {}, son30GunOlu: 0, enEskiCreatedAt: null });
  });
});
