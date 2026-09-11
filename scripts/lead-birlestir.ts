/**
 * lead-birlestir.ts — MÜKERRER LEAD sayımı, birleştirmesi ve GERİ ALMA (2026-09-05).
 *
 * NEDEN: Mikro cari import'u Türkçe unvanı ('ŞİRİN YAPI') elle açılmış lead'le ('Şirin Yapı')
 * eşleştiremediği için (toLowerCase → 'i̇'; düzeltme: src/lib/isimAnahtari.ts) her koşuda YENİ
 * lead açtı. Kod düzeltildi ama kopyalar `leads`te duruyor.
 *
 * MODLAR (sunucuda, C:\cetpa içinden; DATABASE_URL ortamdan okunur):
 *   npx tsx scripts/lead-birlestir.ts                       # KURU KOŞU: plan + kaybolacak alanlar + referanslar. Yazmaz.
 *   APPLY=1 npx tsx scripts/lead-birlestir.ts               # uygula (önce kuru koşu çıktısını OKU)
 *   ELLE_DE=1 …                                             # elle↔elle kopyaları da birleştir (varsayılan: yalnız Mikro kaynaklı kopya silinir)
 *   COMPANY_ID=<cid> …                                      # tek kiracı
 *   GERI_AL=backups/lead-birlestir-<zaman>.json npx tsx …   # yedekteki satırları GERİ YAZ (silinenler dahil)
 *
 * GÜVENLİK (inceleme 2026-09-05, 8 bulgu):
 *   - BAKIM KİLİDİ: APPLY süresince docs/opsLocks/bakim satırı konur; saatlik Mikro cron'u ve
 *     /api/mikro/import/* uçları kilit varken çalışmaz (pgShim UPSERT'i silinen kopyayı diriltiyordu).
 *   - Yama TRANSACTION İÇİNDE, FOR UPDATE ile kilitlenen TAZE satırlardan yeniden hesaplanır; kalan
 *     yoksa/kopya değişmişse grup atlanır (ROLLBACK). UPDATE ve DELETE satır sayıları doğrulanır.
 *   - Gruplama saf ve testli (src/lib/leadBirlestir.ts): FİRMA anahtarı (yetkili adı değil), farklı
 *     Mikro kodu / VKN / firma adı → çelişki (dokunulmaz), yer tutucu VKN anahtar üretmez.
 *   - Her grup COMMIT'ten ÖNCE backups/…json'a yazılır (kalan + kopyalar + referans veren dokümanlar).
 * SONRASI: SSE olayı üretilmez — açık istemciler sayfayı yenilemeli.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { mukerrerGruplari, type LeadKaydi, type MukerrerGrubu } from '../src/lib/leadBirlestir.js';
import { bakimKilidiVar, bakimKilidiKoy, bakimKilidiKaldir, yazicilariBekle } from '../src/server/bakimKilidi.js';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL eksik (ortam).'); process.exit(1); }
const APPLY = process.env.APPLY === '1';
const ELLE_DE = process.env.ELLE_DE === '1';
const COMPANY_ID = process.env.COMPANY_ID || '';
const GERI_AL = process.env.GERI_AL || '';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

type Satir = { coll: string; id: string; data: Record<string, unknown> };
const ad = (l: LeadKaydi): string => String(l.data.company || l.data.name || '').slice(0, 40);
const kisa = (l: LeadKaydi): string => `${l.id} "${ad(l)}"${l.data.name && l.data.name !== l.data.company ? ` (kişi: ${String(l.data.name).slice(0, 25)})` : ''} [${String(l.data.source ?? 'elle')}${l.data.mikroCariKod ? ` kod=${String(l.data.mikroCariKod)}` : ''}]`;
/** Silinecek kayıtta yamaya GİRMEYEN, kaybolacak CRM alanları — kullanıcı APPLY demeden görmeli. */
const kaybolacak = (l: LeadKaydi): string => {
  const d = l.data; const p: string[] = [];
  for (const k of ['status', 'assignedTo', 'score', 'nextFollowUpDate', 'priceTier', 'creditLimit'] as const) if (d[k] != null && d[k] !== '' && d[k] !== 0) p.push(`${k}=${String(d[k]).slice(0, 20)}`);
  if (Array.isArray(d.activities) && d.activities.length) p.push(`${d.activities.length} aktivite (yamaya taşınır)`);
  if (typeof d.notes === 'string' && d.notes.trim()) p.push(`not ${d.notes.trim().length} kr (yamaya taşınır)`);
  return p.length ? p.join(', ') : '-';
};

async function referansSayilari(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { rows } = await pool.query(
    "SELECT data->>'leadId' AS lead_id, coll, count(*)::int AS n FROM docs WHERE data->>'leadId' = ANY($1) GROUP BY 1, 2 ORDER BY 1, 2", [ids]);
  for (const r of rows as Array<{ lead_id: string; coll: string; n: number }>) out.set(r.lead_id, `${out.get(r.lead_id) ? out.get(r.lead_id) + ', ' : ''}${r.coll}=${r.n}`);
  return out;
}

/** Bir grubu TEK transaction'da uygular. Yama, kilit altındaki TAZE satırlardan yeniden hesaplanır. */
async function uygula(g: MukerrerGrubu, yedekDosya: string, yedek: unknown[]): Promise<{ referans: number } | { atlandi: string }> {
  const silinecekIds = g.silinecek.map(s => s.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eski = await client.query(
      "SELECT coll, id, data FROM docs WHERE (coll = 'leads' AND id = ANY($1)) OR data->>'leadId' = ANY($2) FOR UPDATE",
      [[g.kalan.id, ...silinecekIds], silinecekIds]);
    const satirlar = eski.rows as Satir[];
    const tazeKalan = satirlar.find(r => r.coll === 'leads' && r.id === g.kalan.id);
    const tazeKopyalar = silinecekIds.map(id => satirlar.find(r => r.coll === 'leads' && r.id === id));
    if (!tazeKalan) { await client.query('ROLLBACK'); return { atlandi: 'kalan kayıt artık yok (bu arada silinmiş)' }; }
    if (tazeKopyalar.some(k => !k)) { await client.query('ROLLBACK'); return { atlandi: 'kopya kayıt artık yok' }; }
    // TAZE veriden GRUBU YENİDEN KUR (kuru koşudan bu yana eklenen aktivite/not kaybolmasın; bu arada
    // biri kod/VKN/firma değiştirdiyse çelişki YENİDEN görülsün — yeniden inceleme bulgusu: eskiden
    // yalnız varlık kontrolü yapılıp doğrudan yama uygulanıyordu).
    const tazeUyeler: LeadKaydi[] = [{ id: tazeKalan.id, data: tazeKalan.data }, ...tazeKopyalar.map(k => ({ id: (k as Satir).id, data: (k as Satir).data }))];
    const taze = mukerrerGruplari(tazeUyeler, Date.now(), { elleDe: ELLE_DE });
    const tg = taze[0];
    if (taze.length !== 1 || tg.uyeler.length !== tazeUyeler.length) { await client.query('ROLLBACK'); return { atlandi: 'taze veride üyeler artık aynı grupta değil (bu arada değişmiş)' }; }
    if (tg.celiski) { await client.query('ROLLBACK'); return { atlandi: `taze veride çelişki: ${tg.celiski}` }; }
    if (tg.kalan.id !== g.kalan.id) { await client.query('ROLLBACK'); return { atlandi: `taze veride kalan değişti (${g.kalan.id} → ${tg.kalan.id}); kuru koşuyu yenileyin` }; }
    const yama = tg.yama;
    yedek.push({ zaman: new Date().toISOString(), kalan: g.kalan.id, silinen: silinecekIds, yama, satirlar });
    writeFileSync(yedekDosya, JSON.stringify(yedek, null, 1));   // COMMIT'ten ÖNCE diske
    const gun = await client.query(
      "UPDATE docs SET data = data || $2::jsonb, updated_at = now() WHERE coll = 'leads' AND id = $1",
      [g.kalan.id, JSON.stringify(yama)]);
    if (gun.rowCount !== 1) throw new Error(`kalan güncellenemedi (rowCount ${gun.rowCount})`);
    const ref = await client.query(
      "UPDATE docs SET data = jsonb_set(data, '{leadId}', to_jsonb($1::text)), updated_at = now() WHERE data->>'leadId' = ANY($2)",
      [g.kalan.id, silinecekIds]);
    const sil = await client.query("DELETE FROM docs WHERE coll = 'leads' AND id = ANY($1)", [silinecekIds]);
    if (sil.rowCount !== silinecekIds.length) throw new Error(`silinen satır sayısı beklenenden farklı (${sil.rowCount} ≠ ${silinecekIds.length})`);
    await client.query('COMMIT');
    return { referans: ref.rowCount ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

/**
 * GERİ AL — SEÇİCİ (yeniden inceleme bulgusu: eski sürüm yedekteki HER satırı T0 haliyle eziyordu; birleşmeden sonra
 * sevk edilen sipariş 'Pending'e, eklenen aktiviteler yok olurdu). Şimdi:
 *   kalan     → yalnız yamanın yazdığı anahtarlar T0 değerine döner (T0'da yoksa silinir); sonradan eklenen alanlar kalır
 *   silinenler→ ON CONFLICT DO NOTHING ile geri gelir (aynı id'de biri varsa dokunulmaz)
 *   referans  → `leadId` yalnız hâlâ kalanı gösteriyorsa T0'daki lead'e döner; dokümanın diğer alanlarına DOKUNULMAZ
 * Bakım kilidi konur ve yazıcılar beklenir. Kuru koşu (APPLY yok) planı ve 'bu arada değişen' satır sayısını basar.
 */
type YedekGrubu = { zaman?: string; kalan: string; silinen: string[]; yama?: Record<string, unknown>; satirlar: Satir[] };
async function geriAl(dosya: string): Promise<void> {
  const gruplar = JSON.parse(readFileSync(dosya, 'utf-8')) as YedekGrubu[];
  if (gruplar.some(g => !g.yama)) { console.error('Bu yedek eski biçimde (yama alanı yok) — seçici geri alma yapılamaz; satırları elle geri yazın.'); process.exitCode = 2; return; }
  console.log(`GERİ AL: ${dosya} — ${gruplar.length} grup`);
  for (const g of gruplar) {
    const zaman = g.zaman ?? '';
    const t0Kalan = g.satirlar.find(r => r.coll === 'leads' && r.id === g.kalan);
    const refler = g.satirlar.filter(r => !(r.coll === 'leads' && [g.kalan, ...g.silinen].includes(r.id)));
    const { rows } = zaman ? await pool.query("SELECT count(*)::int AS n FROM docs WHERE data->>'leadId' = $1 AND updated_at > $2::timestamptz", [g.kalan, zaman]) : { rows: [{ n: null }] };
    console.log(`  kalan ${g.kalan}: ${Object.keys(g.yama ?? {}).length} alan T0'a döner · ${g.silinen.length} kopya geri gelir · ${refler.length} referans leadId'si döner${rows[0].n != null ? ` · birleşmeden sonra değişen bağlı doküman: ${rows[0].n} (leadId dışı alanlarına dokunulmaz)` : ''}${t0Kalan ? '' : ' · UYARI: yedekte kalan satırı yok'}`);
  }
  if (!APPLY) { console.log('KURU KOŞU — uygulamak için: APPLY=1 GERI_AL=<dosya> npx tsx scripts/lead-birlestir.ts'); return; }
  await bakimKilidiKoy(pool, `lead-birlestir GERI_AL ${dosya}`, new Date().toISOString());
  try {
    await yazicilariBekle(pool, { log: m => console.log('  ' + m) });
    let kalanN = 0, kopyaN = 0, refN = 0;
    for (const g of gruplar) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t0Kalan = g.satirlar.find(r => r.coll === 'leads' && r.id === g.kalan);
        const anahtarlar = Object.keys(g.yama ?? {});
        if (t0Kalan && anahtarlar.length) {
          const t0Alt: Record<string, unknown> = {};
          for (const k of anahtarlar) if (k in t0Kalan.data) t0Alt[k] = t0Kalan.data[k];
          const r = await client.query("UPDATE docs SET data = (data - $2::text[]) || $3::jsonb, updated_at = now() WHERE coll = 'leads' AND id = $1", [g.kalan, anahtarlar, JSON.stringify(t0Alt)]);
          kalanN += r.rowCount ?? 0;
        }
        for (const id of g.silinen) {
          const t0 = g.satirlar.find(r => r.coll === 'leads' && r.id === id);
          if (!t0) continue;
          const r = await client.query("INSERT INTO docs (coll, id, data, updated_at) VALUES ('leads', $1, $2::jsonb, now()) ON CONFLICT (coll, id) DO NOTHING", [id, JSON.stringify(t0.data)]);
          kopyaN += r.rowCount ?? 0;
        }
        for (const ref of g.satirlar.filter(r => !(r.coll === 'leads' && [g.kalan, ...g.silinen].includes(r.id)))) {
          const eskiLead = String(ref.data.leadId ?? '');
          if (!eskiLead) continue;
          const r = await client.query("UPDATE docs SET data = jsonb_set(data, '{leadId}', to_jsonb($1::text)), updated_at = now() WHERE coll = $2 AND id = $3 AND data->>'leadId' = $4", [eskiLead, ref.coll, ref.id, g.kalan]);
          refN += r.rowCount ?? 0;
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    await yayinla('leads', [...gruplar.map(g => g.kalan), ...gruplar.flatMap(g => g.silinen)], []);   // geri gelenler de 'set'
    const refColl = new Map<string, string[]>();
    for (const g of gruplar) for (const r of g.satirlar) if (r.coll !== 'leads') refColl.set(r.coll, [...(refColl.get(r.coll) ?? []), r.id]);
    for (const [coll, ids] of refColl) await yayinla(coll, ids, []);
    console.log(`BİTTİ: ${kalanN} kalan geri alındı, ${kopyaN} kopya geri geldi, ${refN} referans döndü.`);
  } finally {
    await bakimKilidiKaldir(pool);
  }
}

/** Açık istemcilere değişikliği duyur: POST /api/ops/yayinla (X-Ops-Token). Token/URL yoksa uyarır, işi bozmaz. */
async function yayinla(coll: string, ids: string[], silinen: string[]): Promise<void> {
  if (!ids.length && !silinen.length) return;
  const token = process.env.OPS_SUMMARY_TOKEN || '';
  const url = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 5173}`;
  if (!token) { console.warn('UYARI: OPS_SUMMARY_TOKEN yok — SSE yayını yapılamadı; açık istemciler sayfayı YENİLEMELİ (bayat kopyayla üzerine yazma riski).'); return; }
  try {
    const r = await fetch(`${url}/api/ops/yayinla`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ops-token': token }, body: JSON.stringify({ coll, ids, silinen }) });
    const j = await r.json().catch(() => ({})) as { yayin?: number; error?: string };
    if (!r.ok) console.warn(`UYARI: SSE yayını ${r.status} ${j.error ?? ''} — açık istemciler sayfayı YENİLEMELİ.`); else console.log(`SSE yayını: ${j.yayin ?? 0} olay (${coll}).`);
  } catch (e) { console.warn(`UYARI: SSE yayını başarısız (${(e as Error).message}) — açık istemciler sayfayı YENİLEMELİ.`); }
}

async function main(): Promise<void> {
  const kilit = await bakimKilidiVar(pool);
  if (kilit) { console.error(`Bakım kilidi var: ${kilit.aciklama} (${kilit.baslangic}). Başka bir bakım koşuyor ya da yarım kalmış; kaldırmadan devam edilmez.`); process.exitCode = 2; return; }
  if (GERI_AL) { await geriAl(GERI_AL); return; }

  const { rows } = await pool.query(
    "SELECT id, data FROM docs WHERE coll = 'leads'" + (COMPANY_ID ? " AND (data->>'companyId' = $1 OR NOT (data ? 'companyId'))" : ''),
    COMPANY_ID ? [COMPANY_ID] : []);
  const leads: LeadKaydi[] = rows.map((r: { id: string; data: Record<string, unknown> }) => ({ id: r.id, data: r.data }));
  const gruplar = mukerrerGruplari(leads, Date.now(), { elleDe: ELLE_DE });
  const birlesecek = gruplar.filter(g => !g.celiski), celiskili = gruplar.filter(g => g.celiski);
  const silinecekToplam = birlesecek.reduce((s, g) => s + g.silinecek.length, 0);
  const refs = await referansSayilari(birlesecek.flatMap(g => g.silinecek.map(s => s.id)));

  console.log(`\n=== MÜKERRER LEAD ${APPLY ? 'BİRLEŞTİRME' : 'KURU KOŞU'}${ELLE_DE ? ' (ELLE_DE: elle kopyalar da)' : ''} ===`);
  console.log(`lead: ${leads.length}${COMPANY_ID ? ` (kiracı ${COMPANY_ID})` : ''} · grup: ${gruplar.length} · birleşecek: ${birlesecek.length} (silinecek ${silinecekToplam}) · DOKUNULMAYACAK: ${celiskili.length}`);
  const turSayac: Record<string, number> = {};
  for (const g of gruplar) for (const t of g.baglantilar) turSayac[t] = (turSayac[t] ?? 0) + 1;
  console.log(`bağlantı türleri: ${JSON.stringify(turSayac)}`);
  for (const g of birlesecek) {
    console.log(`\n[${g.baglantilar.join('+')}] KALAN ${kisa(g.kalan)}`);
    for (const s of g.silinecek) console.log(`   SİL   ${kisa(s)}\n         kaybolacak: ${kaybolacak(s)} · bağlı dokümanlar: ${refs.get(s.id) ?? 'yok'}`);
    const dolan = Object.keys(g.yama).filter(k => !['birlestirilen', 'updatedAt'].includes(k));
    if (dolan.length) console.log(`   kalana dolacak: ${dolan.join(', ')}`);
  }
  for (const g of celiskili) console.log(`\n[DOKUNULMAZ — ${g.celiski}] ${g.uyeler.map(kisa).join(' | ')}`);

  if (!APPLY) { console.log('\nKURU KOŞU — hiçbir şey yazılmadı. Uygulamak için: APPLY=1 npx tsx scripts/lead-birlestir.ts'); return; }
  if (!birlesecek.length) { console.log('\nBirleştirilecek grup yok.'); return; }

  mkdirSync('backups', { recursive: true });
  const yedekDosya = `backups/lead-birlestir-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const yedek: unknown[] = [];
  let tamam = 0, hata = 0, atlanan = 0, referans = 0;
  await bakimKilidiKoy(pool, 'lead-birlestir (mükerrer lead birleştirme)', new Date().toISOString());
  console.log('\nBakım kilidi kondu — Mikro cron/import bu sırada başlamaz; koşmakta olan bitene kadar bekleniyor.');
  try {
    await yazicilariBekle(pool, { log: m => console.log('  ' + m) });   // zaten koşan cron/import T0 ref'leriyle silinen kopyayı diriltirdi
    for (const g of birlesecek) {
      try {
        const r = await uygula(g, yedekDosya, yedek);
        if ('atlandi' in r) { atlanan++; console.warn(`ATLANDI grup (kalan ${g.kalan.id}): ${r.atlandi}`); }
        else { tamam++; referans += r.referans; }
      } catch (e) { hata++; console.error(`HATA grup (kalan ${g.kalan.id}):`, (e as Error).message); }
    }
  } finally {
    await bakimKilidiKaldir(pool);
    console.log('Bakım kilidi kaldırıldı.');
  }
  {   // SSE yayını: kalanlar 'set', kopyalar 'delete', referans veren dokümanlar 'set' (koleksiyon bazında)
    const y = yedek as Array<{ kalan: string; silinen: string[]; satirlar: Satir[] }>;
    await yayinla('leads', y.map(g => g.kalan), y.flatMap(g => g.silinen));
    const refColl = new Map<string, string[]>();
    for (const g of y) for (const r of g.satirlar) if (r.coll !== 'leads') refColl.set(r.coll, [...(refColl.get(r.coll) ?? []), r.id]);
    for (const [coll, ids] of refColl) await yayinla(coll, ids, []);
  }
  console.log(`\nBİTTİ: ${tamam} grup birleşti, ${referans} referans yönlendirildi, ${atlanan} atlandı, ${hata} hata (geri alındı). Yedek: ${yedekDosya}`);
  console.log(`Geri almak için: APPLY=1 GERI_AL=${yedekDosya} npx tsx scripts/lead-birlestir.ts · Açık istemciler sayfayı yenilemeli.`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
