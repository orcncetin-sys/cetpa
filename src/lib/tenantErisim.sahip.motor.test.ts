// @vitest-environment node
/**
 * tenantErisim.sahip.motor.test.ts — SAHİP satır süzgecinin (K10) SQL'i GERÇEK PostgreSQL motorunda (PostgreSQL WASM;
 * tablo DDL'i `server/docsSema.ts`'ten — kopya yok, server.ts aynı sabiti kurar).
 *
 * NEDEN: `/api/db` rotaları içe aktarılamıyor (K10-5); rotaların koştuğu SQL'in iki parçası saf işlevden gelir ve burada
 * gerçek jsonb işleçleriyle sınanır:
 *   • LİSTE — `SELECT id, data FROM docs WHERE coll = $1${kiraciWhere(...).sql}` (server.ts GET /api/db/:coll ile AYNI metin;
 *     rota satırının bu metni kurduğunu server/satirSuzgeci.degismez.test çitler);
 *   • KOŞULLU YAZMA — `UPDATE docs SET data = data || $4::jsonb … WHERE … data->>$3 = $5` gövdesi `kiraciDamgala`'dan geçer:
 *     sahip alanı birleştirmeyle DÜŞMEZ / değişmez (sahiplenme atomik kalır);
 *   • AKIŞ init'inin satır kovası — `coll = $n AND data->>'companyId' = $4 AND data->>$m = $5` (kova `akisKovalari`'ndan).
 * Sahte depo bunları sınayamaz: `data->>` bir METİN döndürür, `NOT (data ? 'companyId')` anahtar varlığına bakar.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../server/docsSema';
import { akisKovalari, kiraciDamgala, kiraciWhere } from './tenantErisim';
import { STAFF_ROLES, EXTERNAL_ROLES, type AppRole } from './rbac';

const COLL = 'syncJobs';
const kimlik = (uid: string, rol: AppRole | null) => ({ uid, cid: async () => 'A', superAdmin: false, rol: async () => rol });
const YONETICI_DISI = [...STAFF_ROLES.filter(r => r !== 'Admin'), ...EXTERNAL_ROLES, null] as Array<AppRole | null>;

let db: PGlite;
const ekle = (id: string, data: Record<string, unknown>, coll = COLL) =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3)', [coll, id, JSON.stringify(data)]);
const oku = async (id: string) => (await db.query<{ data: Record<string, unknown> }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, id])).rows[0]?.data;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM docs');
  await ekle('kendi', { companyId: 'A', sahipUid: 'ben', status: 'queued' });
  await ekle('baskasinin', { companyId: 'A', sahipUid: 'muhasebe', status: 'queued' });
  await ekle('damgasiz', { companyId: 'A', status: 'queued' });
  await ekle('bos-damga', { companyId: 'A', sahipUid: '', status: 'queued' });
  await ekle('sayi-damga', { companyId: 'A', sahipUid: 7, status: 'queued' });
  await ekle('baska-kiraci', { companyId: 'B', sahipUid: 'ben', status: 'queued' });
  await ekle('etiketsiz', { sahipUid: 'ben', status: 'queued' });
  await ekle('baska-koleksiyon', { companyId: 'A', sahipUid: 'ben' }, 'inventory');
});

/** server.ts `GET /api/db/:coll` ile AYNI sorgu. */
async function liste(uid: string, rol: AppRole | null): Promise<string[]> {
  const t = await kiraciWhere(COLL, kimlik(uid, rol));
  const { rows } = await db.query<{ id: string }>(`SELECT id, data FROM docs WHERE coll = $1${t.sql}`, [COLL, ...t.params]);
  return rows.map(r => r.id).sort();
}

describe('liste — okuma = yazma kuralı gerçek motorda', () => {
  it('Yönetici dışındaki HER rol (Müdür dâhil) yalnız KENDİ damgalı işini alır: başkasının, damgasız, bozuk damgalı, başka kiracının, kiracı etiketsiz iş gelmez', async () => {
    for (const r of YONETICI_DISI) expect(await liste('ben', r), String(r)).toEqual(['kendi']);
  });
  it('Yönetici kiracının bütün kuyruğunu alır (damgasız eski iş dâhil; kiracı etiketsiz eski kayıt da — mevcut esnek kural); başka kiracınınkini almaz', async () => {
    expect(await liste('ben', 'Admin')).toEqual(['baskasinin', 'bos-damga', 'damgasiz', 'etiketsiz', 'kendi', 'sayi-damga']);
  });
  it('başka kullanıcı: yalnız kendi işi — kimse kimsenin işini listeleyemez', async () => {
    expect(await liste('muhasebe', 'Accounting')).toEqual(['baskasinin']);
    expect(await liste('ik', 'HR')).toEqual([]);
  });
});

describe('koşullu yazma — sahiplenme sahip alanını değiştiremez', () => {
  /** server.ts `PATCH /api/db/:coll/:id/cas` ile AYNI yazma: gövde damgadan geçer, tek UPDATE. */
  async function kosulluYaz(id: string, k: ReturnType<typeof kimlik>, set: Record<string, unknown>): Promise<boolean> {
    const mevcut = await oku(id);
    const yazilacak = await kiraciDamgala(COLL, set, k, mevcut);
    const { rows } = await db.query(
      'UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>$3 = $5 RETURNING data',
      [COLL, id, 'status', JSON.stringify(yazilacak), 'queued'],
    );
    return rows.length > 0;
  }
  it('sahibi sahiplenir: durum değişir, sahip AYNI kalır — yamada başka sahip gönderse de', async () => {
    expect(await kosulluYaz('kendi', kimlik('ben', 'Sales'), { status: 'in-progress', sahipUid: 'baskasi' })).toBe(true);
    expect(await oku('kendi')).toEqual({ companyId: 'A', sahipUid: 'ben', status: 'in-progress' });
  });
  it('Yönetici başkasının işini kapatır: sahip DEĞİŞMEZ (işi kimin koyduğu kayıtta kalır)', async () => {
    expect(await kosulluYaz('baskasinin', kimlik('yonetici', 'Admin'), { status: 'dead', lastError: 'kapatıldı' })).toBe(true);
    expect(await oku('baskasinin')).toEqual({ companyId: 'A', sahipUid: 'muhasebe', status: 'dead', lastError: 'kapatıldı' });
  });
  it('damgasız eski iş: Yönetici sahiplenince sahibi olur (sonraki turda da onun işidir)', async () => {
    expect(await kosulluYaz('damgasiz', kimlik('yonetici', 'Admin'), { status: 'in-progress' })).toBe(true);
    expect(await oku('damgasiz')).toEqual({ companyId: 'A', sahipUid: 'yonetici', status: 'in-progress' });
  });
  it('yarış: iki sahiplenmeden yalnız BİRİ tutar (durum artık `queued` değil)', async () => {
    const k = kimlik('ben', 'Sales');
    expect(await kosulluYaz('kendi', k, { status: 'in-progress' })).toBe(true);
    expect(await kosulluYaz('kendi', k, { status: 'in-progress' })).toBe(false);
  });
});

describe('akış init\'i — satır kovası', () => {
  it('Yönetici dışında kova koşulu yalnız kendi damgalı işi getirir; Yönetici\'de kova boştur (kiracı kovasına düşer)', async () => {
    const kova = akisKovalari([COLL], 'Manager');
    expect(kova.satir).toEqual([{ coll: COLL, alan: 'sahipUid' }]);
    // server.ts akış sorgusundaki satır kovası parçası: `coll = $n AND data->>'companyId' = $4 AND data->>$m = $5`.
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM docs WHERE (coll = $1 AND data->>'companyId' = $2 AND data->>$3 = $4)",
      [kova.satir[0].coll, 'A', kova.satir[0].alan, 'ben'],
    );
    expect(rows.map(r => r.id)).toEqual(['kendi']);
    expect(akisKovalari([COLL], 'Admin')).toMatchObject({ tenant: [COLL], satir: [] });
  });
});
