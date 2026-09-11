/**
 * pgShim.test.ts — PgDocRef.update "diriltmez" sözleşmesi (2026-09-11). ÖNCE YAZILDI (kırmızı görüldü).
 *
 * Eski `update` UPSERT'ti: silinmiş doküman, T0 snapshot'ıyla koşan cron/import'un `batch.update(eskiRef, …)`
 * çağrısıyla aynı id'de yalnız birkaç alanlı zombi olarak geri geliyordu (mükerrer lead temizliği
 * incelemesi, KRİTİK). Firestore semantiği: update var olmayan dokümanda yazmaz. `set` ise oluşturur.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDocRef } from './pgShim';

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
