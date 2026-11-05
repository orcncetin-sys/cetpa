// @vitest-environment node
/**
 * magazaBayiSiparis.pglite.test.ts — müşteri / bayi ekranı liste sorgusunun GERÇEK PostgreSQL motorunda davranışı ve planı
 * (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` H5, H12). `@electric-sql/pglite`; tablo ve dizinler `docsSema.ts`'ten
 * (server.ts aynı sabiti kurar — kopya yok). Uçtan uca zincir (kapı, bağ, opak kimlik) magazaBayi.zincir.test.ts'te.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';
import {
  BAYI_MF_SAYISI_SQL, BAYI_SIPARIS_ADAY_SQL, BAYI_SIPARIS_GOVDE_SQL, bayiSiparisListesi, bayiSiparisParametreleri, bayiSiparisSirasi,
  type BayiSiparisBagi,
} from './magazaBayiSiparis';

let db: PGlite;
const CID = 'CETPA';
const koy = (id: string, data: Record<string, unknown>, coll = 'orders') =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [coll, id, JSON.stringify(data)]);

/** Üretimdeki iki aşama (rota ile AYNI işlevler): aday → sıra → gövde → liste. `arada` iki sorgu arasına girer. */
async function listele(bag: BayiSiparisBagi, arada?: () => Promise<unknown>): Promise<Array<{ id: string; no: string; durum: string | null }>> {
  const p = bayiSiparisParametreleri(CID, bag, MAGAZA_KAYNAGI);
  const adaylar = (await db.query<Record<string, unknown>>(BAYI_SIPARIS_ADAY_SQL, p)).rows;
  if (arada) await arada();
  const sira = bayiSiparisSirasi(adaylar);
  const govdeler = sira.length === 0 ? [] : (await db.query<Record<string, unknown>>(BAYI_SIPARIS_GOVDE_SQL, [...p, sira])).rows;
  return bayiSiparisListesi(sira, govdeler, docId => docId).map(s => ({ id: s.id, no: s.no, durum: s.durum }));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DELETE FROM docs'); });

describe('H5 / K1 — hangi siparişler (gerçek motor)', () => {
  beforeEach(async () => {
    await koy('c-1', { companyId: CID, leadId: 'L1', orderNumber: 'SAS-1', status: 'Pending', createdAt: '2026-10-01T10:00:00.000Z' });
    await koy('c-iptal', { companyId: CID, leadId: 'L1', orderNumber: 'SAS-2', status: 'Cancelled', createdAt: '2026-10-02T10:00:00.000Z' });
    await koy('mikrofat__CETPA__CTP-1', { companyId: CID, mikroCariKod: '120.01.0042', orderNumber: 'MF-CTP1', status: 'Delivered', source: 'mikro-fatura', createdAt: '2026-09-01T12:00:00.000Z' });
    await koy('mikrofat__CETPA__CTP-2', { companyId: CID, mikroCariKod: '', orderNumber: 'MF-CTP2', status: 'Delivered', source: 'mikro-fatura', createdAt: '2026-09-02T12:00:00.000Z' });
    await koy('mikrofat__CETPA__CTP-3', { companyId: CID, mikroCariKod: 'abi', orderNumber: 'MF-CTP3', status: 'Delivered', source: 'mikro-fatura' });
    await koy('mikrofat__CETPA__CTP-4', { companyId: CID, mikroCariKod: 'abı', orderNumber: 'MF-CTP4', status: 'Delivered', source: 'mikro-fatura' });
    await koy('baska-cari', { companyId: CID, leadId: 'L2', orderNumber: 'SAS-9', status: 'Pending' });
    await koy('baska-kiraci', { companyId: 'BASKA', leadId: 'L1', mikroCariKod: '120.01.0042', orderNumber: 'SAS-X', status: 'Pending' });
    await koy('etiketsiz', { leadId: 'L1', mikroCariKod: '120.01.0042', orderNumber: 'SAS-E', status: 'Pending' });
    await koy('magaza', { companyId: CID, leadId: 'L1', orderNumber: '#1001', source: MAGAZA_KAYNAGI, status: 'Pending' });
    await koy('trendyol', { companyId: CID, leadId: 'L1', orderNumber: 'TY-1', source: 'Trendyol', status: 'Pending' });
    await koy('hb', { companyId: CID, mikroCariKod: '120.01.0042', orderNumber: 'HB-1', source: 'Hepsiburada', status: 'Pending' });
    await koy('lead-belgesi', { companyId: CID, leadId: 'L1', mikroCariKod: '120.01.0042' }, 'leads');
  });

  it('kırpılmış kodlu bağ: o carinin Cetpa + MF siparişleri; iptal «iptal»; başka cari / kiracı / etiketsiz / mağaza / pazar yeri / başka koleksiyon YOK', async () => {
    const l = await listele({ leadId: 'L1', cariKod: '120.01.0042' });
    expect(l.map(s => s.id)).toEqual(['c-iptal', 'c-1', 'mikrofat__CETPA__CTP-1']);
    expect(l.find(s => s.id === 'c-iptal')?.durum).toBe('iptal');
    expect(l.find(s => s.id === 'mikrofat__CETPA__CTP-1')?.no).toBe('MF-CTP1');
  });

  it('kodsuz lead\'e bağlı hesap: kendi `leadId`\'li siparişini görür, aynı kiracıdaki `mikroCariKod: \'\'` MF siparişini GÖRMEZ', async () => {
    expect((await listele({ leadId: 'L1', cariKod: null })).map(s => s.id)).toEqual(['c-iptal', 'c-1']);
  });

  it('elle bozulmuş bağ (`cariKod: \'\'` ya da `\'  \'`) da carisiz MF siparişini GÖRMEZ (ikinci kat)', async () => {
    for (const cariKod of ['', '  ']) expect((await listele({ leadId: 'L1', cariKod })).map(s => s.id), JSON.stringify(cariKod)).toEqual(['c-iptal', 'c-1']);
  });

  it('düz eşitlik: \'abı\' bağı \'abi\' siparişini görmez, tersi de; büyütme yok', async () => {
    expect((await listele({ leadId: 'YOK', cariKod: 'abı' })).map(s => s.id)).toEqual(['mikrofat__CETPA__CTP-4']);
    expect((await listele({ leadId: 'YOK', cariKod: 'abi' })).map(s => s.id)).toEqual(['mikrofat__CETPA__CTP-3']);
    expect(await listele({ leadId: 'YOK', cariKod: 'ABI' })).toEqual([]);
  });

  it('silinen sipariş görünmez; iki sorgu ARASINDA `leadId`\'si değişen sipariş yanıtta YOK (Aşama 2 yüklemi tekrarlar)', async () => {
    await db.query("DELETE FROM docs WHERE coll = 'orders' AND id = 'c-iptal'");
    const l = await listele({ leadId: 'L1', cariKod: '120.01.0042' }, () =>
      db.query(`UPDATE docs SET data = jsonb_set(data, '{leadId}', '"L2"') WHERE coll = 'orders' AND id = 'c-1'`));
    expect(l.map(s => s.id)).toEqual(['mikrofat__CETPA__CTP-1']);
  });

  it('MF sayısı (Yönetici uyarısı): yalnız cari kolu; mağaza / pazar yeri hariç', async () => {
    const say = async (kod: string): Promise<number> => Number((await db.query<{ n: number }>(BAYI_MF_SAYISI_SQL, [CID, kod, MAGAZA_KAYNAGI])).rows[0]?.n);
    expect(await say('120.01.0042')).toBe(1);
    expect(await say('abı')).toBe(1);
    expect(await say('yok')).toBe(0);
  });

  it('bozuk tarih metni sorguyu DÜŞÜRMEZ (SQL\'de tarih ifadesi yok); en sona düşer', async () => {
    await koy('bozuk', { companyId: CID, leadId: 'L1', orderNumber: 'B', status: 'Pending', createdAt: 'bozuk-tarih', orderDate: 'tarih yok' });
    const l = await listele({ leadId: 'L1', cariKod: null });
    expect(l.map(s => s.id)).toEqual(['c-iptal', 'c-1', 'bozuk']);
  });
});

describe('H5 — plan: iki kısmi dizin BitmapOr ile, Seq Scan YOK', () => {
  it('`docs_orders_sirket_lead` Index Cond\'unda `leadId`, `docs_orders_sirket_cari` Index Cond\'unda `mikroCariKod`', async () => {
    for (let i = 0; i < 400; i++) {
      await koy(`p-${i}`, {
        companyId: i % 4 === 0 ? 'BASKA' : CID,
        ...(i % 3 === 0 ? { leadId: `L${i % 50}` } : {}),
        ...(i % 5 === 0 ? { mikroCariKod: `120.01.${String(i % 40).padStart(4, '0')}` } : {}),
        status: 'Pending',
      });
    }
    await db.exec('ANALYZE docs');
    await db.exec('DROP INDEX IF EXISTS idx_docs_coll_company');
    await db.exec('SET enable_seqscan = off');
    try {
      const sql = BAYI_SIPARIS_ADAY_SQL.replaceAll('$1', `'${CID}'`).replaceAll('$2', "'L3'").replaceAll('$3', "'120.01.0005'").replaceAll('$4', `'${MAGAZA_KAYNAGI}'`);
      const plan = (await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`)).rows.map(r => r['QUERY PLAN']);
      const metin = plan.join('\n');
      expect(metin, metin).toMatch(/BitmapOr/);
      expect(metin, metin).not.toMatch(/Seq Scan/);
      const kosul = (dizin: string): string => {
        const i = plan.findIndex(s => s.includes(`on ${dizin}`));
        expect(i, `${dizin} planda yok:\n${metin}`).toBeGreaterThan(-1);
        return plan[i + 1] ?? '';
      };
      expect(kosul('docs_orders_sirket_lead')).toMatch(/Index Cond:.*leadId/);
      expect(kosul('docs_orders_sirket_cari')).toMatch(/Index Cond:.*mikroCariKod/);
    } finally {
      await db.exec('SET enable_seqscan = on');
      await db.exec(DOCS_INDEKS_DDL[0]);
    }
  });
});
