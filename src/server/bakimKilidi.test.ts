/** bakimKilidi.test.ts — bakım kilidi sözleşmesi (2026-09-05): koy / var / kaldır; ikinci koyma hata; pool yoksa kilit yok. */
import { describe, it, expect, vi } from 'vitest';
import { bakimKilidiVar, bakimKilidiKoy, bakimKilidiKaldir, BAKIM_KILIDI, yaziciOlarakCalistir, yazicilariBekle, aktifYazicilar, yaziciKaydet, YAZICI_BAYAT_MS, yaziciyiIstegeBagla } from './bakimKilidi';
import { SERVER_ONLY_COLLECTIONS } from '../lib/collections';

function sahtePool() {
  const satirlar = new Map<string, Record<string, unknown>>();
  return {
    satirlar,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const k = `${params[0]}/${params[1]}`;
      if (sql.includes('LIKE')) { const on = `${params[0]}/${String(params[1]).replace(/%$/, '')}`; const rows = [...satirlar.entries()].filter(([kk]) => kk.startsWith(on)).map(([kk, v]) => ({ id: kk.split('/')[1], data: v })); return { rows, rowCount: rows.length }; }
      if (sql.startsWith('SELECT')) return { rows: satirlar.has(k) ? [{ data: satirlar.get(k) }] : [], rowCount: satirlar.has(k) ? 1 : 0 };
      if (sql.startsWith('INSERT')) { if (satirlar.has(k) && sql.includes('DO NOTHING')) return { rows: [], rowCount: 0 }; satirlar.set(k, JSON.parse(String(params[2]))); return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('DELETE')) { const v = satirlar.delete(k); return { rows: [], rowCount: v ? 1 : 0 }; }
      throw new Error('beklenmeyen sql ' + sql);
    }),
  };
}

describe('bakım kilidi', () => {
  it("kilit koleksiyonu SERVER_ONLY (API'ye kapalı)", () => { expect(SERVER_ONLY_COLLECTIONS).toContain(BAKIM_KILIDI.coll); });
  it('koy → var (açıklama+başlangıç) → kaldır → yok', async () => {
    const p = sahtePool();
    expect(await bakimKilidiVar(p)).toBeNull();
    await bakimKilidiKoy(p, 'lead-birlestir', '2026-09-05T12:00:00.000Z');
    expect(await bakimKilidiVar(p)).toEqual({ aciklama: 'lead-birlestir', baslangic: '2026-09-05T12:00:00.000Z' });
    await bakimKilidiKaldir(p);
    expect(await bakimKilidiVar(p)).toBeNull();
  });
  it('ikinci koyma HATA — mevcut kilidin açıklamasını söyler', async () => {
    const p = sahtePool();
    await bakimKilidiKoy(p, 'ilk', '2026-09-05T12:00:00.000Z');
    await expect(bakimKilidiKoy(p, 'ikinci', '2026-09-05T13:00:00.000Z')).rejects.toThrow(/zaten var \(ilk/);
  });
  it('pool yoksa (lokal Firestore fallback) kilit yok sayılır', async () => {
    expect(await bakimKilidiVar(null)).toBeNull();
  });
});

describe('yazıcı kaydı — koşan cron/import bakım scriptini bekletir (yeniden inceleme, KRİTİK)', () => {
  it('yaziciOlarakCalistir: kilit yoksa iş koşar ve kayıt silinir; kilit varsa iş KOŞMAZ, kayıt yine silinir', async () => {
    const p = sahtePool(); const is = vi.fn(async () => 42);
    expect(await yaziciOlarakCalistir(p, 'mikro-cron', is)).toEqual({ sonuc: 42 });
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
    await bakimKilidiKoy(p, 'lead-birlestir', '2026-09-11T10:00:00.000Z');
    const r = await yaziciOlarakCalistir(p, 'mikro-cron', is);
    expect('kilit' in r && r.kilit.aciklama).toBe('lead-birlestir');
    expect(is).toHaveBeenCalledTimes(1);
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
  });
  it('iş hata verse de kayıt silinir (finally)', async () => {
    const p = sahtePool();
    await expect(yaziciOlarakCalistir(p, 'x', async () => { throw new Error('patladı'); })).rejects.toThrow('patladı');
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
  });
  it('yazicilariBekle: kayıtlı yazıcı bitince döner; zaman aşımında yazıcı adlarıyla hata', async () => {
    const p = sahtePool(); let t = 0; const simdi = () => t; const uyu = async (ms: number) => { t += ms; };
    await yaziciKaydet(p, 'mikro-cron', new Date(0).toISOString());
    // 25 sn sonra yazıcı biter
    const bitir = setTimeout(() => {}, 0); clearTimeout(bitir);
    const uyuVeBitir = async (ms: number) => { t += ms; if (t >= 25_000) p.satirlar.delete(`${BAKIM_KILIDI.coll}/yazici:mikro-cron`); };
    await expect(yazicilariBekle(p, { zamanAsimiMs: 60_000, aralikMs: 10_000, simdi, uyu: uyuVeBitir })).resolves.toBeUndefined();
    t = 0; await yaziciKaydet(p, 'import-cari', new Date(0).toISOString());
    await expect(yazicilariBekle(p, { zamanAsimiMs: 30_000, aralikMs: 10_000, simdi, uyu })).rejects.toThrow(/import-cari/);
  });
  it('bayat kayıt (2 saatten eski) beklemeyi bloklamaz', async () => {
    const p = sahtePool();
    await yaziciKaydet(p, 'cokmus', new Date(Date.now() - YAZICI_BAYAT_MS - 1000).toISOString());
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
  });
  it('pool yoksa yazıcı kaydı atlanır, iş yine koşar', async () => {
    expect(await yaziciOlarakCalistir(null, 'x', async () => 'ok')).toEqual({ sonuc: 'ok' });
  });
});

describe('yaziciyiIstegeBagla — HTTP ucu yanıt kapanınca kaydı bırakır', () => {
  it('kilit yoksa kaydolur, finish/close ile silinir; kilit varsa kilidi döner ve kayıt bırakmaz', async () => {
    const p = sahtePool();
    const dinleyici: Record<string, () => void> = {};
    const res = { once: (olay: string, fn: () => void) => { dinleyici[olay] = fn; } };
    expect(await yaziciyiIstegeBagla(p, 'import-cari:u1', res)).toBeNull();
    expect((await aktifYazicilar(p, Date.now())).map(y => y.ad)).toEqual(['import-cari:u1']);
    dinleyici.finish(); await new Promise(r => setTimeout(r, 0));
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
    await bakimKilidiKoy(p, 'bakım', '2026-09-11T10:00:00.000Z');
    const k = await yaziciyiIstegeBagla(p, 'import-cari:u2', res);
    expect(k?.aciklama).toBe('bakım');
    expect(await aktifYazicilar(p, Date.now())).toEqual([]);
  });
});
