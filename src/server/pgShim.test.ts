/**
 * pgShim.test.ts — PgDocRef.update "diriltmez" sözleşmesi (2026-09-11). ÖNCE YAZILDI (kırmızı görüldü).
 *
 * Eski `update` UPSERT'ti: silinmiş doküman, T0 snapshot'ıyla koşan cron/import'un `batch.update(eskiRef, …)`
 * çağrısıyla aynı id'de yalnız birkaç alanlı zombi olarak geri geliyordu (mükerrer lead temizliği
 * incelemesi, KRİTİK). Firestore semantiği: update var olmayan dokümanda yazmaz. `set` ise oluşturur.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDocRef, dbEvents, broadcastDocChange, genDocId } from './pgShim';
import { join } from 'node:path';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';

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

// 2026-10-02 — dış rol satır süzgeci: akış, sipariş olayını `satirSahibi` etiketine göre süzer (server.ts onChange).
describe('broadcastDocChange — satır sahibi etiketi (orders.assignedTo)', () => {
  const dinle = (is: () => void) => {
    const olaylar: Array<Record<string, unknown>> = [];
    const d = (e: Record<string, unknown>) => olaylar.push(e);
    dbEvents.on('change', d);
    try { is(); } finally { dbEvents.off('change', d); }
    return olaylar;
  };
  it('set ve delete olayında etiket taşınır; silmede içerik yine iliştirilmez', () => {
    const o = dinle(() => {
      broadcastDocChange('orders', 'set', 'o1', { companyId: 'A', assignedTo: 'u1', customerName: 'Şirin Yapı' });
      broadcastDocChange('orders', 'delete', 'o1', { companyId: 'A', assignedTo: 'u1', customerName: 'Şirin Yapı' });
    });
    expect(o[0]).toMatchObject({ coll: 'orders', type: 'set', id: 'o1', cid: 'A', satirSahibi: 'u1' });
    expect(o[1]).toMatchObject({ coll: 'orders', type: 'delete', id: 'o1', cid: 'A', satirSahibi: 'u1' });
    expect(o[1]).not.toHaveProperty('data');
  });
  it('sahiplik alanı olmayan sipariş (Mikro faturası, mağaza) etiketsizdir → dış role gitmez; süzgeçsiz koleksiyonda etiket yok', () => {
    const o = dinle(() => {
      broadcastDocChange('orders', 'set', 'mf1', { companyId: 'A', source: 'mikro-fatura' });
      broadcastDocChange('orders', 'set', 'o2', { companyId: 'A', assignedTo: null });
      broadcastDocChange('leads', 'set', 'l1', { companyId: 'A', assignedTo: 'u1' });
    });
    for (const e of o) expect(e).not.toHaveProperty('satirSahibi');
  });
});

describe('genDocId — kriptografik üreteç (2026-10-19, şartname «takip kodu + LUCA reddi» TD)', () => {
  it('biçim ve uzunluk aynı (20 karakter, base62); iki çağrı farklı; 2.000 kimlikte tekrar yok', () => {
    for (let i = 0; i < 200; i++) expect(genDocId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(genDocId()).not.toBe(genDocId());
    expect(new Set(Array.from({ length: 2000 }, () => genDocId())).size).toBe(2000);
  });

  it('kaynak çiti: gövdede `Math.random` YOK, `crypto.randomInt` var (eski yolun tek sırrı tahmin edilebilir üreteçle kurulmaz)', () => {
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'pgShim.ts')).map(s => s.kod);
    const bas = kod.findIndex(k => /^export function genDocId\(\): string \{$/.test(k));
    expect(bas).toBeGreaterThan(-1);
    const son = kod.findIndex((k, i) => i > bas && /^\}$/.test(k));
    const govde = kod.slice(bas, son + 1).join('\n');
    expect(govde).not.toMatch(/Math\.random/);
    expect(govde).toMatch(/DOC_ID_CHARS\[randomInt\(DOC_ID_CHARS\.length\)\]/);
    expect(kod).toContain("import { randomInt } from 'node:crypto';");
    expect(kod.join('\n')).not.toMatch(/Math\.random/);
  });
});
