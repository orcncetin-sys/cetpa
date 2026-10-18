// @vitest-environment node
/**
 * tenantErisim.kaynak.test.ts — sunucunun koruduğu KAYNAK DEĞERLERİ (collections.SUNUCU_KAYNAK_DEGERLERI — `orders.source`:
 * `MF_KAYNAGI` / `MAGAZA_KAYNAGI`; şartname «sipariş kaynak kapısı» H2 / H3 / H5). Saf kural (`kaynakDegeriniUygula`,
 * `kiraciDamgala` bağlantısı) ve yazım anı ifadesi (`sunucuAlanKorumaSql`) GERÇEK PostgreSQL motorunda (PGlite; tablo DDL'i
 * `server/docsSema.ts`'ten). Gerçek `/api/db` zinciri ve yarışlar: server/siparisKaynakKapisi.zincir.test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../server/docsSema';
import { SUNUCU_KAYNAK_DEGERLERI, TENANT_COLLECTIONS } from './collections';
import { MF_KAYNAGI } from './mfKaynagi';
import { MAGAZA_KAYNAGI } from './magazaKaynagi';
import { kaynakDegeriniUygula, kiraciDamgala, sunucuAlanKorumaSql, sunucuKaynakDegerleri, sunucuKorumaVar } from './tenantErisim';
import type { AppRole } from './rbac';

const kimlik = (rol: AppRole | null, superAdmin = false) => ({ uid: 'u1', cid: async () => 'A', superAdmin, rol: async () => rol });
const KORUNAN = [MF_KAYNAGI, MAGAZA_KAYNAGI];
const BICIMLER = ['EXCLUDED.data', '$3::jsonb', '(docs.data || $4::jsonb)'];

describe('SUNUCU_KAYNAK_DEGERLERI — tek kaynak, SQL\'e gömülebilir biçim', () => {
  it('orders → source: [MF_KAYNAGI, MAGAZA_KAYNAGI]; başka koleksiyon yok; anahtarlar kiracı koleksiyonu', () => {
    expect([...SUNUCU_KAYNAK_DEGERLERI.entries()]).toEqual([['orders', { alan: 'source', degerler: [MF_KAYNAGI, MAGAZA_KAYNAGI] }]]);
    for (const coll of SUNUCU_KAYNAK_DEGERLERI.keys()) expect(TENANT_COLLECTIONS).toContain(coll);
    expect(sunucuKaynakDegerleri('orders')).toEqual({ alan: 'source', degerler: [MF_KAYNAGI, MAGAZA_KAYNAGI] });
    expect(sunucuKaynakDegerleri('inventory')).toBeNull();
    expect(MF_KAYNAGI).toBe('mikro-fatura');
  });
  it('biçim denetimi: alan `[A-Za-z0-9_]`, değer `[A-Za-z0-9_-]` dışındaysa fırlatır (alan ve değer SQL\'e gömülür)', async () => {
    for (const [alan, deger] of [["sour'ce", 'x'], ['source', "x'); DROP TABLE docs; --"], ['source', 'a b']]) {
      vi.resetModules();
      vi.doMock('./collections', async (asil: () => Promise<Record<string, unknown>>) => ({
        ...(await asil()), SUNUCU_KAYNAK_DEGERLERI: new Map([['orders', { alan, degerler: [deger] }]]),
      }));
      const m = await import('./tenantErisim');
      expect(() => m.sunucuKaynakDegerleri('orders'), `${alan} / ${deger}`).toThrow(/SUNUCU_KAYNAK_DEGERLERI/);
      expect(() => m.sunucuAlanKorumaSql('orders')).toThrow(/SUNUCU_KAYNAK_DEGERLERI/);
      vi.doUnmock('./collections');
    }
    vi.resetModules();
  });
  it('sunucuKorumaVar: türetilen alan VEYA kaynak değeri olan koleksiyon; korumasız koleksiyonda ifade `yeni`nin kendisi', () => {
    expect(sunucuKorumaVar('orders')).toBe(true);
    expect(sunucuKorumaVar('inventory')).toBe(false);
    for (const yeni of BICIMLER) expect(sunucuAlanKorumaSql('inventory', yeni)).toBe(yeni);
  });
});

describe('kaynakDegeriniUygula — gelen korunan değer düşer; önceki korunan değer KALIR; korunan değer JS\'te ASLA eklenmez', () => {
  it('yeni kayıt (POST: önceki yok; satırsız PUT / PATCH: önceki `{}`): korunan değer düşer, alan yok; nokta yolu düşer; öteki değer yazılır', () => {
    for (const onceki of [undefined, {}]) {
      for (const v of KORUNAN) expect(kaynakDegeriniUygula('orders', { source: v, x: 1 }, onceki), v).toEqual({ x: 1 });
      expect(kaynakDegeriniUygula('orders', { 'source.ic': MF_KAYNAGI, x: 1 }, onceki)).toEqual({ x: 1 });
      expect(kaynakDegeriniUygula('orders', { source: 'Trendyol', x: 1 }, onceki)).toEqual({ source: 'Trendyol', x: 1 });
    }
  });
  it('Cetpa siparişi: gelen korunan değer düşer, önceki değer (ya da yokluğu) korunur; öteki değer serbest', () => {
    expect(kaynakDegeriniUygula('orders', { source: MF_KAYNAGI, notes: 'n' }, { source: 'manual' })).toEqual({ source: 'manual', notes: 'n' });
    expect(kaynakDegeriniUygula('orders', { source: MAGAZA_KAYNAGI }, { source: null })).toEqual({ source: null });
    expect(kaynakDegeriniUygula('orders', { source: MF_KAYNAGI, notes: 'n' }, { notes: 'eski' })).toEqual({ notes: 'n' });
    expect(kaynakDegeriniUygula('orders', { source: 'Trendyol' }, { source: 'manual' })).toEqual({ source: 'Trendyol' });
    expect(kaynakDegeriniUygula('orders', {}, { source: 'manual' })).toEqual({});   // tam değiştirmede korumasız değer korunmaz (bugünkü PUT)
  });
  it('MF / mağaza siparişi: gelen başka değer, `null`, alanın yokluğu, öteki korunan değer → önceki korunan değer KALIR', () => {
    for (const eski of KORUNAN) {
      for (const gelen of [{ source: 'manual' }, { source: null }, {}, { source: eski === MF_KAYNAGI ? MAGAZA_KAYNAGI : MF_KAYNAGI }, { 'source.x': 1 }]) {
        expect(kaynakDegeriniUygula('orders', { ...gelen, notes: 'n' }, { source: eski, notes: 'eski' }), `${eski} ← ${JSON.stringify(gelen)}`)
          .toEqual({ source: eski, notes: 'n' });
      }
    }
  });
  it('özellik: sonuçtaki korunan değer YALNIZ öncekinden gelir (her gelen × her önceki birleşimi)', () => {
    const degerler: unknown[] = [MF_KAYNAGI, MAGAZA_KAYNAGI, 'manual', 'Trendyol', null, 7, { ic: MF_KAYNAGI }, undefined];
    for (const g of degerler) for (const o of degerler) for (const oncekiVar of [true, false]) {
      const gelen: Record<string, unknown> = g === undefined ? { a: 1 } : { source: g, a: 1 };
      const onceki = oncekiVar ? (o === undefined ? {} : { source: o }) : undefined;
      const sonuc = kaynakDegeriniUygula('orders', gelen, onceki);
      const s = sonuc.source;
      if (typeof s === 'string' && KORUNAN.includes(s)) expect(s, `${String(g)} / ${String(o)}`).toBe(onceki?.source);
      if (typeof onceki?.source === 'string' && KORUNAN.includes(onceki.source)) expect(s).toBe(onceki.source);
      expect(sonuc.a).toBe(1);
    }
  });
  it('kuralsız koleksiyonda dokunulmaz', () => {
    expect(kaynakDegeriniUygula('inventory', { source: MF_KAYNAGI }, { source: 'manual' })).toEqual({ source: MF_KAYNAGI });
  });
  it('kiraciDamgala bağlı: ROLDEN BAĞIMSIZ (Satış, Yönetici, süper yönetici, dış rol) — POST düşer, MF satırı MF kalır', async () => {
    for (const [rol, sa] of [['Sales', false], ['Admin', false], ['Admin', true], ['Dealer', false]] as Array<[AppRole, boolean]>) {
      const k = kimlik(rol, sa);
      expect(await kiraciDamgala('orders', { source: MF_KAYNAGI, x: 1 }, k), rol).not.toHaveProperty('source');
      expect((await kiraciDamgala('orders', { source: 'manual' }, k, { source: MF_KAYNAGI })).source, rol).toBe(MF_KAYNAGI);
      expect((await kiraciDamgala('orders', { source: MF_KAYNAGI }, k, { source: 'manual' })).source, rol).toBe('manual');
    }
  });
});

describe('sunucuAlanKorumaSql — kaynak değeri TEK YÖNLÜ: yalnız yazım anındaki satıra (`docs.data`) bakar', () => {
  it('üç biçimde de `docs.data->>\'source\' IN (…)` VAR, gelen tarafa bakan `->>\'source\'` YOK; değerler kümeden', () => {
    for (const yeni of BICIMLER) {
      const ifade = sunucuAlanKorumaSql('orders', yeni);
      expect(ifade, yeni).toContain(`CASE WHEN docs.data->>'source' IN ('${MF_KAYNAGI}', '${MAGAZA_KAYNAGI}') THEN jsonb_build_object('source', docs.data->'source') ELSE '{}'::jsonb END`);
      expect(ifade.match(/->>'source'/g), yeni).toHaveLength((ifade.match(/docs\.data->>'source'/g) ?? []).length);
      expect(ifade.startsWith(`(${yeni}`) || ifade.startsWith(yeni), yeni).toBe(true);
    }
  });

  let db: PGlite;
  const ekle = (id: string, data: Record<string, unknown>) =>
    db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)', ['orders', id, JSON.stringify(data)]);
  const oku = async (id: string) => (await db.query<{ data: Record<string, unknown> }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', ['orders', id])).rows[0]?.data;
  const SATIRLAR: Array<[string, Record<string, unknown>]> = [
    ['mf', { source: MF_KAYNAGI, notes: 'eski' }], ['magaza', { source: MAGAZA_KAYNAGI, notes: 'eski' }],
    ['cetpa', { source: 'manual', notes: 'eski' }], ['kaynaksiz', { notes: 'eski' }],
  ];
  /** Üç yazım biçimi (server.ts PUT / PATCH ve pgShim `set` çakışma dalı; pgShim `update`; `/api/db` cas). */
  const YAZ: Array<[string, (id: string, gelen: Record<string, unknown>) => Promise<unknown>]> = [
    ['EXCLUDED.data', (id, g) => db.query(`INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3) ON CONFLICT (coll, id) DO UPDATE SET data = ${sunucuAlanKorumaSql('orders')}, updated_at = now()`, ['orders', id, JSON.stringify(g)])],
    ['$3::jsonb', (id, g) => db.query(`UPDATE docs SET data = ${sunucuAlanKorumaSql('orders', '$3::jsonb')}, updated_at = now() WHERE coll = $1 AND id = $2`, ['orders', id, JSON.stringify(g)])],
    ['cas', (id, g) => db.query(`UPDATE docs SET data = ${sunucuAlanKorumaSql('orders', '(docs.data || $4::jsonb)')}, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>$3 = $5`, ['orders', id, 'notes', JSON.stringify(g), 'eski'])],
  ];
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(DOCS_TABLOSU_DDL);
    for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec('DELETE FROM docs');
    for (const [id, d] of SATIRLAR) await ekle(id, d);
  });

  it('satır MF / mağaza → gelen başka değer, `null`, alanın yokluğu fark etmez: korunan değer KALIR; öteki alan yazılır', async () => {
    for (const [bicim, yaz] of YAZ) for (const gelen of [{ source: 'manual' }, { source: null }, {}]) for (const id of ['mf', 'magaza']) {
      await db.exec('DELETE FROM docs'); for (const [i, d] of SATIRLAR) await ekle(i, d);
      await yaz(id, { ...gelen, notes: 'yeni' });
      const beklenen = id === 'mf' ? MF_KAYNAGI : MAGAZA_KAYNAGI;
      expect(await oku(id), `${bicim} / ${id} / ${JSON.stringify(gelen)}`).toMatchObject({ source: beklenen, notes: 'yeni' });
    }
  });
  it('satır korumasız → gelen veri OLDUĞU GİBİ yazılır (sunucunun kendi MF yazımı dâhil: iki yönlü dal YOK)', async () => {
    for (const [bicim, yaz] of YAZ) for (const id of ['cetpa', 'kaynaksiz']) {
      await db.exec('DELETE FROM docs'); for (const [i, d] of SATIRLAR) await ekle(i, d);
      await yaz(id, { source: MF_KAYNAGI, notes: 'yeni' });
      expect(await oku(id), `${bicim} / ${id}`).toMatchObject({ source: MF_KAYNAGI, notes: 'yeni' });
    }
    await db.exec('DELETE FROM docs'); for (const [i, d] of SATIRLAR) await ekle(i, d);
    await YAZ[0][1]('cetpa', { source: 'Trendyol', notes: 'yeni' });
    expect((await oku('cetpa'))?.source).toBe('Trendyol');
  });
  it('INSERT dalı (satır yok) ifadeyi koşturmaz: gelen veri aynen (sunucunun boş tabloda MF yaratması)', async () => {
    await YAZ[0][1]('yeni-mf', { source: MF_KAYNAGI, notes: 'n' });
    expect(await oku('yeni-mf')).toEqual({ source: MF_KAYNAGI, notes: 'n' });
  });
});
