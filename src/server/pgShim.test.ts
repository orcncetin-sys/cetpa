/**
 * pgShim.test.ts — PgDocRef.update "diriltmez" sözleşmesi (2026-09-11). ÖNCE YAZILDI (kırmızı görüldü).
 *
 * Eski `update` UPSERT'ti: silinmiş doküman, T0 snapshot'ıyla koşan cron/import'un `batch.update(eskiRef, …)`
 * çağrısıyla aynı id'de yalnız birkaç alanlı zombi olarak geri geliyordu (mükerrer lead temizliği
 * incelemesi, KRİTİK). Firestore semantiği: update var olmayan dokümanda yazmaz. `set` ise oluşturur.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDocRef, dbEvents, broadcastDocChange } from './pgShim';

function sahtePool(mevcut: Record<string, Record<string, unknown>>) {
  const sorgular: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sorgular.push({ sql, params });
      if (sql.startsWith('SELECT')) { const d = mevcut[`${params[0]}/${params[1]}`]; return { rows: d ? [{ data: d }] : [], rowCount: d ? 1 : 0 }; }
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool, sorgular };
}

describe('PgDocRef.update', () => {
  it('doküman YOKSA hiçbir şey yazmaz (INSERT/UPDATE yok), uyarı loglar', async () => {
    const { pool, sorgular } = sahtePool({});
    const uyar = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await new PgDocRef(pool as never, 'leads', 'silinmis').update({ name: 'ZOMBİ' });
    expect(sorgular.map(q => q.sql.split(' ')[0])).toEqual(['SELECT']);
    expect(uyar).toHaveBeenCalledWith(expect.stringContaining('leads/silinmis yok'));
    uyar.mockRestore();
  });
  it('doküman varsa yama birleşir ve UPDATE (INSERT değil) yazılır', async () => {
    const { pool, sorgular } = sahtePool({ 'leads/a': { name: 'Şirin Yapı', phone: '1' } });
    await new PgDocRef(pool as never, 'leads', 'a').update({ phone: '2' });
    const yaz = sorgular.find(q => q.sql.startsWith('UPDATE'));
    expect(yaz, 'UPDATE beklenir').toBeDefined();
    expect(JSON.parse(String(yaz?.params[2]))).toEqual({ name: 'Şirin Yapı', phone: '2' });
    expect(sorgular.some(q => q.sql.startsWith('INSERT'))).toBe(false);
  });
  it('set ise yeni doküman OLUŞTURUR (INSERT … ON CONFLICT) — oluşturma yolu bu', async () => {
    const { pool, sorgular } = sahtePool({});
    await new PgDocRef(pool as never, 'leads', 'yeni').set({ name: 'X' });
    expect(sorgular.some(q => q.sql.includes('INSERT INTO docs'))).toBe(true);
  });
});

// İnceleme 2026-09-25: etiketsiz silme olayı SSE'de (`ev.cid && ev.cid !== streamCid`) BÜTÜN kiracılara gidiyordu.
describe('silme olayı kiracı/kullanıcı ETİKETİ taşır, içerik taşımaz', () => {
  const dinle = async (is: () => Promise<void> | void) => {
    const olaylar: unknown[] = [];
    const f = (e: unknown) => { olaylar.push(e); };
    dbEvents.on('change', f);
    try { await is(); } finally { dbEvents.off('change', f); }
    return olaylar;
  };

  it('PgDocRef.delete silinen satırı RETURNING ile okur; olay cid/uid taşır, data TAŞIMAZ', async () => {
    const pool = { query: vi.fn(async (sql: string) => ({ rows: sql.startsWith('DELETE') ? [{ data: { companyId: 'A', userId: 'u1', notes: 'iç not' } }] : [], rowCount: 1 })) };
    const olaylar = await dinle(() => new PgDocRef(pool as never, 'orders', 'mikrofat__A__-321').delete());
    expect(pool.query.mock.calls[0][0]).toMatch(/^DELETE FROM docs WHERE coll = \$1 AND id = \$2 RETURNING data$/);
    expect(olaylar).toEqual([{ coll: 'orders', type: 'delete', id: 'mikrofat__A__-321', cid: 'A', uid: 'u1' }]);
  });

  it('olmayan dokümanın silinmesi etiketsiz olay (önceki davranış) — hata yok', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const olaylar = await dinle(() => new PgDocRef(pool as never, 'orders', 'yok').delete());
    expect(olaylar).toEqual([{ coll: 'orders', type: 'delete', id: 'yok', cid: undefined, uid: undefined }]);
  });

  it('broadcastDocChange: silmede data yalnız etiket için okunur; set\'te olaya iliştirilir', async () => {
    const olaylar = await dinle(() => {
      broadcastDocChange('leads', 'delete', 'l1', { companyId: 'B', name: 'Gizli Firma' });
      broadcastDocChange('leads', 'set', 'l1', { companyId: 'B', name: 'Açık' });
    });
    expect(olaylar[0]).toEqual({ coll: 'leads', type: 'delete', id: 'l1', cid: 'B', uid: undefined });
    expect(olaylar[1]).toMatchObject({ type: 'set', cid: 'B', data: { name: 'Açık' } });
  });
});
