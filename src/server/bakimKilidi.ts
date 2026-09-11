/**
 * bakimKilidi.ts — VERİ BAKIMI KİLİDİ (2026-09-05).
 *
 * Neden: `scripts/lead-birlestir.ts` üretim `docs` tablosunda lead SİLER. Saatlik Mikro cari
 * cron'u ve elle "Carileri İçeri Al" aynı anda koşarsa pgShim.update UPSERT'i silinen kopyayı
 * aynı id ile (yalnız Mikro alanlarıyla) DİRİLTİR — kaynağı bilinmeyen zombi lead (inceleme,
 * 2026-09-05). Bu yüzden bakım scripti başlarken kilit koyar; cron ve import uçları kilit varken
 * ÇALIŞMAZ (cron atlar + loglar, uç 423 döner). Kilit `docs` tablosunda tek satır:
 * coll='opsLocks' (SERVER_ONLY — /api/db'ye kapalı), id='bakim'.
 *
 * Saf: pool `{ query }` ile gelir, sahte pool ile test edilir (bakimKilidi.test.ts).
 */
export interface SqlCalistirici { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> }

export const BAKIM_KILIDI = { coll: 'opsLocks', id: 'bakim' } as const;

/** Kilit varsa açıklamasını döner, yoksa null. Pool yoksa (lokal Firestore fallback) null — kilit mekanizması PG'ye özel. */
export async function bakimKilidiVar(pool: SqlCalistirici | null | undefined): Promise<{ aciklama: string; baslangic: string } | null> {
  if (!pool) return null;
  const { rows } = await pool.query("SELECT data FROM docs WHERE coll = $1 AND id = $2", [BAKIM_KILIDI.coll, BAKIM_KILIDI.id]);
  if (!rows.length) return null;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  return { aciklama: String(d.aciklama ?? ''), baslangic: String(d.baslangic ?? '') };
}

/** Kilit koyar; zaten varsa HATA (iki bakım aynı anda koşmasın). */
export async function bakimKilidiKoy(pool: SqlCalistirici, aciklama: string, simdiIso: string): Promise<void> {
  const r = await pool.query(
    "INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING",
    [BAKIM_KILIDI.coll, BAKIM_KILIDI.id, JSON.stringify({ aciklama, baslangic: simdiIso })]);
  if (!r.rowCount) {
    const mevcut = await bakimKilidiVar(pool);
    throw new Error(`Bakım kilidi zaten var (${mevcut?.aciklama ?? '?'}, ${mevcut?.baslangic ?? '?'}). Önce kaldırın: bakimKilidiKaldir / DELETE FROM docs WHERE coll='opsLocks' AND id='bakim'.`);
  }
}

export async function bakimKilidiKaldir(pool: SqlCalistirici): Promise<void> {
  await pool.query("DELETE FROM docs WHERE coll = $1 AND id = $2", [BAKIM_KILIDI.coll, BAKIM_KILIDI.id]);
}

// ── Yazıcı kaydı (2026-09-11, yeniden inceleme KRİTİK bulgusu) ─────────────────────────────
// Kilit yalnız BAŞLANGIÇTA okunuyordu: kilit konduğunda zaten koşan cron/import T0 snapshot'ındaki
// ref'lerle yazmaya devam eder ve silinen kopyayı aynı id ile diriltir. Bu yüzden uzun süren lead
// yazıcıları çalışırken kendilerini kaydeder; bakım scripti kilidi koyduktan sonra kayıtlı yazıcı
// kalmayana kadar BEKLER. Yarış penceresi: yazıcı ÖNCE kaydolur, SONRA kilide bakar; script kilidi
// koyduktan sonra kısa bir bekleme + tekrar tekrar yoklama yapar.
const YAZICI_ONEK = 'yazici:';
/** Çökmüş süreçten kalan kayıt sonsuza dek bloklamasın: bu kadar eski kayıt bayat sayılır. */
export const YAZICI_BAYAT_MS = 2 * 60 * 60 * 1000;

export async function yaziciKaydet(pool: SqlCalistirici, ad: string, simdiIso: string): Promise<void> {
  await pool.query(
    "INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
    [BAKIM_KILIDI.coll, YAZICI_ONEK + ad, JSON.stringify({ baslangic: simdiIso })]);
}
export async function yaziciSil(pool: SqlCalistirici, ad: string): Promise<void> {
  await pool.query("DELETE FROM docs WHERE coll = $1 AND id = $2", [BAKIM_KILIDI.coll, YAZICI_ONEK + ad]);
}
/** Kayıtlı (bayat olmayan) yazıcılar. */
export async function aktifYazicilar(pool: SqlCalistirici, simdiMs: number): Promise<Array<{ ad: string; baslangic: string }>> {
  const { rows } = await pool.query("SELECT id, data FROM docs WHERE coll = $1 AND id LIKE $2", [BAKIM_KILIDI.coll, YAZICI_ONEK + '%']);
  return rows
    .map(r => ({ ad: String(r.id).slice(YAZICI_ONEK.length), baslangic: String((r.data as Record<string, unknown> | undefined)?.baslangic ?? '') }))
    .filter(y => { const t = Date.parse(y.baslangic); return !Number.isFinite(t) || simdiMs - t < YAZICI_BAYAT_MS; });
}

/**
 * Lead yazan uzun işi "yazıcı" olarak koşturur: kaydol → kilit var mı bak (varsa kaydı sil, `null` dön,
 * iş KOŞMAZ) → işi koş → finally kaydı sil. Cron ve import uçları bunu kullanır.
 */
export async function yaziciOlarakCalistir<T>(pool: SqlCalistirici | null | undefined, ad: string, is: () => Promise<T>): Promise<{ kilit: { aciklama: string; baslangic: string } } | { sonuc: T }> {
  if (!pool) return { sonuc: await is() };   // lokal Firestore fallback: kilit mekanizması yok
  await yaziciKaydet(pool, ad, new Date().toISOString());
  try {
    const kilit = await bakimKilidiVar(pool);
    if (kilit) return { kilit };
    return { sonuc: await is() };
  } finally {
    await yaziciSil(pool, ad);
  }
}

/** Bakım scripti: kilidi koyduktan sonra kayıtlı yazıcı kalmayana kadar bekler (yoklama). Süre dolarsa hata. */
export async function yazicilariBekle(pool: SqlCalistirici, secenek: { zamanAsimiMs?: number; aralikMs?: number; simdi?: () => number; uyu?: (ms: number) => Promise<void>; log?: (m: string) => void } = {}): Promise<void> {
  const zamanAsimi = secenek.zamanAsimiMs ?? 15 * 60 * 1000, aralik = secenek.aralikMs ?? 10_000;
  const simdi = secenek.simdi ?? (() => Date.now());
  const uyu = secenek.uyu ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const bas = simdi();
  await uyu(Math.min(aralik, 3000));   // kilidi henüz görmemiş bir yazıcı kaydolsun diye kısa pay
  for (;;) {
    const aktif = await aktifYazicilar(pool, simdi());
    if (!aktif.length) return;
    if (simdi() - bas > zamanAsimi) throw new Error(`Yazıcılar ${Math.round(zamanAsimi / 60000)} dk içinde bitmedi: ${aktif.map(a => `${a.ad} (${a.baslangic})`).join(', ')} — bekleyip tekrar deneyin ya da bayat kaydı silin.`);
    secenek.log?.(`bekleniyor: ${aktif.map(a => a.ad).join(', ')}`);
    await uyu(aralik);
  }
}

/**
 * HTTP uçları için yazıcı kaydı: kilit varsa `kilit` döner (çağıran 423 verir), yoksa kaydolur ve
 * yanıt kapanınca (finish/close) kaydı siler — handler gövdesini try/finally ile sarmaya gerek kalmaz.
 */
export async function yaziciyiIstegeBagla(
  pool: SqlCalistirici | null | undefined,
  ad: string,
  res: { once: (olay: string, fn: () => void) => unknown },
): Promise<{ aciklama: string; baslangic: string } | null> {
  if (!pool) return null;
  await yaziciKaydet(pool, ad, new Date().toISOString());
  const kilit = await bakimKilidiVar(pool);
  if (kilit) { await yaziciSil(pool, ad); return kilit; }
  let silindi = false;
  const sil = () => { if (silindi) return; silindi = true; void yaziciSil(pool, ad).catch(() => {}); };
  res.once('finish', sil); res.once('close', sil);
  return null;
}
