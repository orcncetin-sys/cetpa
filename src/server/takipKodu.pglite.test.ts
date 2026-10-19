// @vitest-environment node
/**
 * takipKodu.pglite.test.ts — sipariş takip kodunun üretimi, alınması ve kodla arama GERÇEK PostgreSQL motorunda (şartname
 * `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` T1 / T2 / TA / TB / TC; 2026-10-19).
 *
 * `@electric-sql/pglite` (PostgreSQL WASM). Tablo ve dizinler `docsSema.ts`'ten (server.ts aynı sabiti kurar — kopya yok); tekil
 * kısmi dizin burada gerçekten kurulur, çakışma (23505) yeniden denemesi gerçek ihlalle sınanır. Uçtan uca (gerçek `server.ts`
 * zinciri, kapılar, kimliksiz takip ucu, e-posta) `takipKoduVeLuca.zincir.test.ts`'te.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from './docsSema';
import {
  TAKIP_KODU_ARA_SQL, TAKIP_KODU_OKU_SQL, TAKIP_KODU_YAZ_SQL, takipKoduAlVeyaUret, takipKoduUret, takipKoduylaSiparis, type TakipHavuzu,
} from './takipKodu';
import { TAKIP_KODU_ALFABESI, TAKIP_KODU_BICIMI, TAKIP_KODU_UZUNLUK, eskiTakipYoluAcik, takipKoduMu } from '../lib/takipKodu';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import { dbEvents } from './pgShim';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';

let db: PGlite;
const CID = 'CETPA';
const BASKA = 'BASKA-FIRMA';
/** Sorgu kaydı: her çağrının SQL metni (yazım / okuma sırası sınanır). */
let sorgular: string[] = [];
const havuz: TakipHavuzu = {
  query: async (sql, p) => {
    sorgular.push(sql);
    const r = await db.query<Record<string, unknown>>(sql, p);
    return { rows: r.rows };
  },
};
const koy = (id: string, data: Record<string, unknown>) =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['orders', id, JSON.stringify(data)]);
const oku = async (id: string): Promise<Record<string, unknown> | undefined> =>
  (await db.query<{ data: Record<string, unknown> }>("SELECT data FROM docs WHERE coll = 'orders' AND id = $1", [id])).rows[0]?.data;

let yayinlar: Array<{ coll: string; id: string; data?: Record<string, unknown> }> = [];
const dinle = (ev: { coll: string; id: string; data?: Record<string, unknown> }) => { yayinlar.push(ev); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM docs');
  sorgular = [];
  yayinlar = [];
  dbEvents.on('change', dinle);
});
afterEach(() => { dbEvents.off('change', dinle); });

describe('TA — biçim ve üretici', () => {
  it('22 karakter, base62 alfabesi, biçim deseni; ≥ 130 bit', () => {
    expect(TAKIP_KODU_UZUNLUK).toBe(22);
    expect(TAKIP_KODU_ALFABESI).toHaveLength(62);
    expect(new Set(TAKIP_KODU_ALFABESI).size).toBe(62);
    expect(TAKIP_KODU_UZUNLUK * Math.log2(TAKIP_KODU_ALFABESI.length)).toBeGreaterThanOrEqual(130);
    for (let i = 0; i < 200; i++) {
      const k = takipKoduUret();
      expect(k).toMatch(TAKIP_KODU_BICIMI);
      expect(k).not.toMatch(/[-_]/);
    }
  });

  it('rastgelelik: iki çağrı farklı; 2.000 kodda tekrar yok; her konumda alfabenin büyük kısmı görülür (sabit / sıralı üretici değil)', () => {
    expect(takipKoduUret()).not.toBe(takipKoduUret());
    const kodlar = Array.from({ length: 2000 }, () => takipKoduUret());
    expect(new Set(kodlar).size).toBe(2000);
    for (let i = 0; i < TAKIP_KODU_UZUNLUK; i++) expect(new Set(kodlar.map(k => k[i])).size, `konum ${i}`).toBeGreaterThan(55);
  });

  it('biçim yüklemi ve eski yol yüklemi', () => {
    expect(takipKoduMu('aB3dE5fG7hJ9kL1mN2pQ4r')).toBe(true);
    for (const v of ['aB3dE5fG7hJ9kL1mN2pQ4', 'aB3dE5fG7hJ9kL1mN2pQ4rs', 'aB3dE5fG7hJ9kL1mN2pQ_r', 'aB3dE5fG7hJ9kL1mN2pQ-r', 'aB3dE5fG7hJ9kL1mN2pQ4ş', '', null, 22]) {
      expect(takipKoduMu(v), String(v)).toBe(false);
    }
    expect(eskiTakipYoluAcik('Ab12Cd34Ef56Gh78Ij90')).toBe(true);
    expect(eskiTakipYoluAcik('mikrofat__CETPA__CTP-12')).toBe(false);
    expect(eskiTakipYoluAcik('shopify__abc')).toBe(false);
    expect(eskiTakipYoluAcik('a__b')).toBe(false);
    expect(eskiTakipYoluAcik('')).toBe(false);
  });

  it('kaynak çiti: üretici `crypto.randomInt` kullanır; `Math.random` ve kimlikten türetme yok', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'takipKodu.ts')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/import \{ randomInt \} from 'node:crypto';/);
    expect(kod).toMatch(/s \+= TAKIP_KODU_ALFABESI\[randomInt\(TAKIP_KODU_ALFABESI\.length\)\];/);
    expect(kod).not.toMatch(/Math\.random|createHash|orderId\.slice|\.where\(/);
  });
});

describe('TB — takipKoduAlVeyaUret', () => {
  it('kod yoksa yazar ve döner; yayın RETURNING satırıyla BİR kez; ikinci çağrı AYNI kodu döner ve yazmaz', async () => {
    await koy('s-1', { customerName: 'Şirin Yapı', companyId: CID });
    const k1 = await takipKoduAlVeyaUret(havuz, CID, 's-1');
    expect(k1).toMatch(TAKIP_KODU_BICIMI);
    expect(await oku('s-1')).toEqual({ customerName: 'Şirin Yapı', companyId: CID, takipKodu: k1 });
    expect(yayinlar.map(y => [y.coll, y.id, y.data?.takipKodu])).toEqual([['orders', 's-1', k1]]);
    sorgular = [];
    const k2 = await takipKoduAlVeyaUret(havuz, CID, 's-1');
    expect(k2).toBe(k1);
    expect(sorgular).toEqual([TAKIP_KODU_YAZ_SQL, TAKIP_KODU_OKU_SQL]);   // koşullu yazım 0 satır → yeniden okuma
    expect(yayinlar).toHaveLength(1);
  });

  it('eşzamanlı iki çağrı AYNI kodu alır (koşullu atomik yazım); satırda tek kod', async () => {
    await koy('s-2', { companyId: CID });
    const [a, b] = await Promise.all([takipKoduAlVeyaUret(havuz, CID, 's-2'), takipKoduAlVeyaUret(havuz, CID, 's-2')]);
    expect(a).toMatch(TAKIP_KODU_BICIMI);
    expect(b).toBe(a);
    expect((await oku('s-2'))?.takipKodu).toBe(a);
    expect(yayinlar).toHaveLength(1);
  });

  it('etiketsiz eski sipariş (alan yok / null / boş dize) kodu alır; yabancı kiracının siparişi → null, satıra DOKUNULMAZ', async () => {
    await koy('e-1', {});
    await koy('e-2', { companyId: null });
    await koy('e-3', { companyId: '' });
    for (const id of ['e-1', 'e-2', 'e-3']) expect(await takipKoduAlVeyaUret(havuz, CID, id), id).toMatch(TAKIP_KODU_BICIMI);
    await koy('y-1', { companyId: BASKA });
    expect(await takipKoduAlVeyaUret(havuz, CID, 'y-1')).toBeNull();
    expect(await oku('y-1')).toEqual({ companyId: BASKA });
    // Yabancı kiracının kodu VARSA da okunmaz (yeniden okuma aynı kiracı koşuluyla).
    await koy('y-2', { companyId: BASKA, takipKodu: 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3S' });
    expect(await takipKoduAlVeyaUret(havuz, CID, 'y-2')).toBeNull();
  });

  it('olmayan sipariş → null, satır YARATILMAZ; mağaza siparişine kod YAZILMAZ (ikinci çit)', async () => {
    expect(await takipKoduAlVeyaUret(havuz, CID, 'yok-1')).toBeNull();
    expect(await oku('yok-1')).toBeUndefined();
    await koy('m-1', { companyId: CID, source: MAGAZA_KAYNAGI });
    expect(await takipKoduAlVeyaUret(havuz, CID, 'm-1')).toBeNull();
    expect(await oku('m-1')).toEqual({ companyId: CID, source: MAGAZA_KAYNAGI });
  });

  it('23505 — üretilen kod başka siparişte var (tekil dizin) → YENİ kodla bir kez yeniden denenir; ikinci çakışma fırlatır', async () => {
    const CAKISAN = 'Ab12Cd34Ef56Gh78Ij90Kl';
    const YENI = 'Mn12Op34Qr56St78Uv90Wx';
    await koy('a-1', { companyId: CID, takipKodu: CAKISAN });
    await koy('a-2', { companyId: CID });
    const sira = [CAKISAN, YENI];
    expect(await takipKoduAlVeyaUret(havuz, CID, 'a-2', () => { const k = sira.shift(); if (!k) throw new Error('fazla üretim'); return k; })).toBe(YENI);
    expect(sira).toEqual([]);
    expect((await oku('a-2'))?.takipKodu).toBe(YENI);
    await koy('a-3', { companyId: CID });
    await expect(takipKoduAlVeyaUret(havuz, CID, 'a-3', () => CAKISAN)).rejects.toMatchObject({ code: '23505' });
    expect(await oku('a-3')).toEqual({ companyId: CID });
  });

  it('kayıtlı değer biçimsizse FIRLATIR (sessizce ezilmez, uydurulmaz)', async () => {
    await koy('b-1', { companyId: CID, takipKodu: 'kisa' });
    await expect(takipKoduAlVeyaUret(havuz, CID, 'b-1')).rejects.toThrow(/biçimsiz/);
    expect((await oku('b-1'))?.takipKodu).toBe('kisa');
  });
});

describe('TC — takipKoduylaSiparis', () => {
  it('kodla siparişi bulur (kiracıdan bağımsız); zaman damgaları `toDate` ile döner; olmayan kod → null', async () => {
    const KOD = 'Qw12Er34Ty56Ui78Op90As';
    await koy('mikrofat__CETPA__CTP-1', { companyId: CID, orderNumber: 'MF-CTP1', takipKodu: KOD, createdAt: { _seconds: 1760860800, _nanoseconds: 0 } });
    const s = await takipKoduylaSiparis(havuz, KOD);
    expect(s?.id).toBe('mikrofat__CETPA__CTP-1');
    expect(s?.data.orderNumber).toBe('MF-CTP1');
    expect((s?.data.createdAt as { toDate: () => Date }).toDate().toISOString()).toBe('2025-10-19T08:00:00.000Z');
    expect(await takipKoduylaSiparis(havuz, 'Zx98Cv76Bn54Mm32Lk10Jh')).toBeNull();
    expect(sorgular.filter(q => q === TAKIP_KODU_ARA_SQL)).toHaveLength(2);
  });

  it('arama sorgusu tekil kısmi dizini KULLANABİLİR (yüklem sorguda yazılı) — PostgreSQL planı', async () => {
    for (let i = 0; i < 300; i++) await koy(`d-${i}`, { companyId: CID, ...(i % 3 === 0 ? { takipKodu: takipKoduUret() } : {}) });
    await db.exec('ANALYZE docs');
    await db.exec('SET enable_seqscan = off');
    try {
      const plan = (await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${TAKIP_KODU_ARA_SQL.replace('$1', "'Zx98Cv76Bn54Mm32Lk10Jh'")}`)).rows.map(r => r['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/docs_orders_takip_kodu/);
    } finally { await db.exec('SET enable_seqscan = on'); }
  });

  it('tekil dizin gerçekten kurulu: aynı kod iki siparişe doğrudan SQL ile de yazılamaz', async () => {
    await koy('t-1', { takipKodu: 'Aa11Bb22Cc33Dd44Ee55Ff' });
    await expect(koy('t-2', { takipKodu: 'Aa11Bb22Cc33Dd44Ee55Ff' })).rejects.toMatchObject({ code: '23505' });
    // Başka koleksiyonda aynı değer serbest (dizin yalnız `orders`).
    await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['leads', 't-3', JSON.stringify({ takipKodu: 'Aa11Bb22Cc33Dd44Ee55Ff' })]);
  });
});
