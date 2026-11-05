// @vitest-environment node
/**
 * stokKodGocuUygula.pglite.test.ts — stok kodu göçünün UYGULAMA / GERİ ALMA / PASİF motoru GERÇEK PostgreSQL motorunda (PGlite;
 * `docs` DDL'i `docsSema.ts`'ten) + sahte Mikro. Şartname «Mikro bağlantı D» D2–D5 + DH7–DH12, DH16, DH18, DH19.
 *
 * Kiracı A: kesin ikiz (hareket kanıtı), ortak hedef (`MA-HY-003` + `MITREAPEL-HY-003` → `APEL-HY-003`), NFD `İ`'li sipariş kalemi,
 * etiketsiz eski kart, `/` içeren kod, DH2 (Mikro'da eski kodla hareket) ve DH14 (mağaza talebi) engelli çiftler, karşılıksız kart;
 * bağlı sipariş / teklif / hareket (Mikro satırı, iki yetim, elle hareket) / depo / sayım farkı / konum stoğu / aynalar.
 * Kiracı B: AYNI eski kodlu kart ve sipariş. Her sınama kendi tohumuyla başlar.
 *
 * MUTASYON NOTLARI (her biri en az bir sınamayı kırmızıya çevirir):
 *   • kiracı süzgeci kaldırılır → «B'ye dokunulmaz» kırmızı;           • DH7 atlama kaldırılır → «ikinci koşu 0 değişiklik» kırmızı;
 *   • önce-görüntü yazımı kaldırılır → «geri al bayt bayt» kırmızı;      • kilit konmaz → «kilit varken saatlik senkron atlar» kırmızı;
 *   • `yazicilariBekle` kaldırılır → «kilit anında koşan yazıcı» kırmızı; • `finally` kaldırılır → «hata fırlatan işte kilit kalmaz» kırmızı;
 *   • çift işlemi kaldırılır (BEGIN / ROLLBACK) → «k. yazımda hata» kırmızı; • aynı sku değişmezi kaldırılır → «çift kartlı plan» kırmızı.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_TABLOSU_DDL } from '../docsSema';
import { bakimKilidiVar, yaziciKaydet, yaziciOlarakCalistir, yaziciSil } from '../bakimKilidi';
import { stokKodGocuKuruKos, type KuruBagimliliklari } from './stokKodGocuKuru';
import { uygulaGovdesiniCoz, type UygulaGovdesi } from './stokKodGocuTasima';
import {
  OPS_AKTORU, calismaBasligiOku, esKimligi, stokKodGocuAcilisTemizligi, stokKodGocuGeriAlBaslat, stokKodGocuPasifListesi,
  stokKodGocuUygulaBaslat, type CalismaBasligi, type UygulaBagimliliklari, type UygulaPgHavuzu,
} from './stokKodGocuUygula';

let db: PGlite;
/** İşlem içi yazım sayacı (DH9 hata enjeksiyonu): `kacinciIslem`'in `kacinciYazim`'ında fırlatır. */
const enjeksiyon = { kacinciIslem: 0, kacinciYazim: 0, islem: 0, yazim: 0, islemde: false };
const sorgu = async (sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> => {
  const s = sql.trim();
  if (/^BEGIN/i.test(s)) { enjeksiyon.islem++; enjeksiyon.yazim = 0; enjeksiyon.islemde = true; }
  else if (/^(COMMIT|ROLLBACK)/i.test(s)) enjeksiyon.islemde = false;
  else if (enjeksiyon.islemde && /^(UPDATE|INSERT|DELETE)/i.test(s)) {
    enjeksiyon.yazim++;
    if (enjeksiyon.islem === enjeksiyon.kacinciIslem && enjeksiyon.yazim === enjeksiyon.kacinciYazim) throw new Error('enjekte edilen yazım hatası');
  }
  if (!params.length) {
    const r = await db.exec(sql);
    const son = r[r.length - 1];
    return { rows: son ? son.rows as Array<Record<string, unknown>> : [], rowCount: son ? (son.affectedRows ?? son.rows.length) : 0 };
  }
  const r = await db.query<Record<string, unknown>>(sql, params);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const havuz: UygulaPgHavuzu = { query: sorgu, connect: async () => ({ query: sorgu, release() {} }) };
const koy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const oku = async (coll: string, id: string): Promise<Record<string, unknown> | null> => {
  const r = await db.query<{ data: Record<string, unknown> }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
  return r.rows.length ? r.rows[0].data : null;
};

const A = 'KIRACI-A', B = 'KIRACI-B';
const etiket = (cid: string): string => createHash('sha1').update(cid).digest('hex').slice(0, 8);
const cozucu = (ids: Iterable<string>, cid: string) => {
  const eski = new Set([...ids].filter(i => i.startsWith('mikro-')));
  return (a: string) => (eski.has(`mikro-${a}`) ? `mikro-${a}` : `mikro-${etiket(cid)}-${a}`);
};
const g = (n: number): string => `${String(n).padStart(8, '0')}-0000-1111-2222-333333333333`;

// ── Sahte Mikro (SQL metninden tanınan SELECT'ler) ─────────────────────────────────────────────────────────────────────────
interface MikroHareket { guid: string; kod: string; seri: string; sira: number; satir: number; tip: number }
const mikro = { stoklar: [] as Array<{ kod: string; guid: string }>, hareketler: [] as MikroHareket[], firlat: false };
const KOLONLAR: Record<string, string[]> = {
  STOKLAR: ['sto_Guid', 'sto_kod'],
  // `sth_satirno` (alt çizgisiz) — kuru koşunun şemadan iki yazımla bulduğu satır kolonu (D2 turu sapması).
  STOK_HAREKETLERI: ['sth_Guid', 'sth_stok_kod', 'sth_iptal', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_satirno', 'sth_evraktip'],
  STOK_SATIS_FIYAT_LISTELERI: ['sfiyat_Guid', 'sfiyat_stokkod'],
  BARKOD_TANIMLARI: ['bar_Guid', 'bar_stokkodu'],
};
const say = (kodlar: string[]) => { const m = new Map<string, number>(); for (const k of kodlar) m.set(k, (m.has(k) ? Number(m.get(k)) : 0) + 1); return [...m].map(([kod, adet]) => ({ kod, adet })); };
const mikroSql: KuruBagimliliklari['mikroSql'] = async q => {
  if (mikro.firlat) throw new Error('Mikro bağlantısı yok');
  const sayfa = /OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY/.exec(q);
  const sayfala = <T>(r: T[]): T[] => (sayfa ? r.slice(Number(sayfa[1]), Number(sayfa[1]) + Number(sayfa[2])) : r);
  if (/FROM STOKLAR/.test(q)) return { rows: sayfala(mikro.stoklar.map(s => ({ kod: s.kod, guid: `{${s.guid.toUpperCase()}}` }))), hata: null };
  if (/GROUP BY/.test(q)) {
    if (/FROM STOK_HAREKETLERI/.test(q)) return { rows: sayfala(say(mikro.hareketler.map(h => h.kod))), hata: null };
    return { rows: [], hata: null };
  }
  const inn = /WHERE sth_Guid IN \(([^)]*)\)/.exec(q);
  if (inn) {
    const istenen = new Set(inn[1].split(',').map(x => x.trim().replace(/'/g, '')));
    return { rows: mikro.hareketler.filter(h => istenen.has(h.guid)).map(h => ({ guid: h.guid.toUpperCase(), kod: h.kod })), hata: null };
  }
  if (/sth_evrakno_seri = N'/.test(q)) return { rows: mikro.hareketler.map(h => ({ seri: h.seri, sira: h.sira, satir: h.satir, tip: h.tip, kod: h.kod })), hata: null };
  return { rows: [], hata: `tanınmayan sorgu: ${q.slice(0, 60)}` };
};

const denetimler: Array<{ aktor: string; eylem: string; ayrinti: string; kiraci: string }> = [];
const yayinlar: Array<{ coll: string; tur: string; id: string }> = [];
const bagimlilik = (ek: Partial<UygulaBagimliliklari> = {}): UygulaBagimliliklari => ({
  havuz,
  kuru: { mikroSql, mikroKolonlar: async t => KOLONLAR[t] ?? [], mikroIdCozucuIds: cozucu, zamanAsimiMs: 1000 },
  yayinla: (coll, tur, id) => { yayinlar.push({ coll, tur, id }); },
  denetim: async (aktor, eylem, ayrinti, kiraci) => { denetimler.push({ aktor: aktor.uid, eylem, ayrinti, kiraci }); },
  bekleme: { aralikMs: 5, uyu: ms => new Promise(r => setTimeout(r, Math.min(ms, 5))) },
  ...ek,
});

// ── Tohum ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const AKC = 'AKCALI-AKÇ.00312', AKY = 'AKCALI-00312';
const YTONG = 'YTONG-60*25*10 PL/48';
const TABLO = [
  ...['onayli1010', 'aktarim0930', 'revize0930'].map(kaynak => ({ eski: AKC, yeni: AKY, kaynak })),
  { eski: 'MA-HY-003', yeni: 'APEL-HY-003', kaynak: 'onayli1010' }, { eski: 'MA-HY-003', yeni: 'MITREAPEL-HY-003', kaynak: 'aktarim0930' },
  { eski: 'ARGTGRİ', yeni: 'ARAGONIT-SDD-GRI-20', kaynak: 'yenikod1017' },
  { eski: 'ETK-ESKI', yeni: 'ETK-YENI', kaynak: 'onayli1010' },
  { eski: YTONG, yeni: 'YTONG-PL-48', kaynak: 'onayli1010' },
  { eski: 'MAG-ESKI', yeni: 'MAG-YENI', kaynak: 'onayli1010' },
  { eski: 'HAR-ESKI', yeni: 'HAR-YENI', kaynak: 'onayli1010' },
];
const ONAYLI = [
  { eski: AKC, yeni: AKY }, { eski: 'MA-HY-003', yeni: 'APEL-HY-003' }, { eski: 'MITREAPEL-HY-003', yeni: 'APEL-HY-003' },
  { eski: 'ARGTGRİ', yeni: 'ARAGONIT-SDD-GRI-20' }, { eski: 'ETK-ESKI', yeni: 'ETK-YENI' }, { eski: YTONG, yeni: 'YTONG-PL-48' },
];
const PASIF = ['RENKLENDİRME15LT'];
const ESKI_DEPO = `mikro-${etiket(A)}-${AKC}`;
const YTONG_DEPO = `mikro-${etiket(A)}-YTONG-60*25*10 PL_48`;

async function tohumla(): Promise<void> {
  await db.exec('DELETE FROM docs; DELETE FROM mikro_stoklar;');
  denetimler.length = 0; yayinlar.length = 0;
  Object.assign(enjeksiyon, { kacinciIslem: 0, kacinciYazim: 0, islem: 0, yazim: 0, islemde: false });
  mikro.firlat = false;
  mikro.stoklar = [AKY, 'APEL-HY-003', 'ARAGONIT-SDD-GRI-20', 'ETK-YENI', 'YTONG-PL-48', 'MAG-YENI', 'HAR-YENI', 'DUP-1'].map((kod, i) => ({ kod, guid: g(i + 1) }));
  mikro.hareketler = [
    { guid: g(101), kod: AKY, seri: 'MF', sira: 1, satir: 0, tip: 1 },
    { guid: g(103), kod: AKY, seri: 'MF', sira: 5, satir: 0, tip: 1 },      // yetim g(102)'nin evrak eşi (yeni GUID)
    { guid: g(104), kod: 'HAR-ESKI', seri: 'MF', sira: 7, satir: 0, tip: 1 }, // DH2: Mikro'da eski kodla duran hareket
  ];
  await db.query("INSERT INTO mikro_stoklar (sto_kod, veri) VALUES ($1, $2::jsonb), ($3, $4::jsonb)",
    [AKC, JSON.stringify({ sto_Guid: `{${g(900).toUpperCase()}}` }), AKY, JSON.stringify({ sto_Guid: `{${g(1).toUpperCase()}}` })]);
  const ka = (id: string, sku: string, ek: Record<string, unknown> = {}) => koy('inventory', id, { sku, name: 'GİZLİ AD', source: 'mikro_import', companyId: A, ...ek });
  await ka('k-eski', AKC, { lowStockThreshold: 20, notes: 'eski not', costPrice: 99, stockLevel: 0, prices: { Retail: 10 }, updatedAt: '2026-10-01T00:00:00.000Z' });
  await ka('k-yeni', AKY, { source: 'mikro_cron', lowStockThreshold: 5, prices: { Retail: 12 } });          // stockLevel YOK (DH5 mutasyonu)
  await ka('k-ma', 'MA-HY-003', { notes: 'ma notu', updatedAt: '2026-09-01T00:00:00.000Z' });
  await ka('k-mitre', 'MITREAPEL-HY-003', { notes: 'mitre notu', updatedAt: '2026-10-15T00:00:00.000Z' });
  await ka('k-apel', 'APEL-HY-003', { stockLevel: 4 });
  await ka('k-arg', 'ARGTGRİ'); await ka('k-argy', 'ARAGONIT-SDD-GRI-20');
  await koy('inventory', 'k-etk', { sku: 'ETK-ESKI', source: 'mikro_import', notes: 'etiketsiz not' });       // DH19
  await ka('k-etky', 'ETK-YENI');
  await ka('k-ytong', YTONG); await ka('k-ytongy', 'YTONG-PL-48');
  await ka('k-mag', 'MAG-ESKI'); await ka('k-magy', 'MAG-YENI');
  await ka('k-har', 'HAR-ESKI'); await ka('k-hary', 'HAR-YENI');
  await ka('k-kars', 'RENKLENDİRME15LT');
  await ka('k-dup', 'DUP-1');
  await koy('inventory', 'b-eski', { sku: AKC, source: 'mikro_import', companyId: B, notes: 'B notu' });
  await koy('inventory', 'b-yeni', { sku: AKY, source: 'mikro_cron', companyId: B });

  await koy('inventoryMovements', g(101), { sth_stok_kod: AKC, sth_miktar: 3, companyId: A, source: 'mikro_sql' });
  await koy('inventoryMovements', g(102), { sth_stok_kod: AKC, sth_evrakno_seri: 'MF', sth_evrakno_sira: 5, sth_satirno: 0, sth_evraktip: 1, companyId: A });
  await koy('inventoryMovements', g(105), { sth_stok_kod: AKC, sth_evrakno_seri: 'MF', sth_evrakno_sira: 9, sth_satirno: 0, sth_evraktip: 1, companyId: A });
  await koy('inventoryMovements', 'elle-1', { productId: 'k-eski', sku: AKC, quantity: 2, companyId: A });
  await koy('inventoryMovements', g(201), { sth_stok_kod: AKC, companyId: B });
  await koy('orders', 'mf-a', { source: 'mikro-fatura', companyId: A, updatedAt: '2026-10-02T00:00:00.000Z', lineItems: [{ sku: `${AKC}\u200E`, name: 'GİZLİ', price: 10, kalemSurumu: 2 }, { sku: 'BASKA-1', name: 'x', price: 1 }] });
  await koy('orders', 'mf-arg', { source: 'mikro-fatura', companyId: A, lineItems: [{ sku: 'ARGTGRI\u0307', name: 'GİZLİ' }] });  // NFD İ (DH15)
  await koy('orders', 'o-etk', { lineItems: [{ sku: 'ETK-ESKI' }] });                                                      // etiketsiz sipariş
  await koy('orders', 'mf-b', { source: 'mikro-fatura', companyId: B, lineItems: [{ sku: AKC }] });
  await koy('quotations', 'q-1', { companyId: A, items: [{ sku: AKC, inventoryId: 'k-eski' }], lineItems: [{ sku: AKC }] });
  await koy('warehouseItems', ESKI_DEPO, { sku: AKC, quantity: 0, companyId: A });
  await koy('warehouseItems', YTONG_DEPO, { sku: YTONG, quantity: 1, companyId: A });
  await koy('stockDiscrepancies', 'sd-1', { productId: 'k-eski', sku: AKC, companyId: A });
  await koy('locationStocks', 'depo__D1__k-eski', { id: 'depo__D1__k-eski', productId: 'k-eski', sku: AKC, quantity: 2, companyId: A });
  await koy('magazaTalepleri', 'mt-1', { companyId: A, kalemler: [{ sku: 'MAG-ESKI-D002' }] });
  await koy('mikroFiyatListeleri', 'fl-1', { sfiyat_stokkod: AKC, companyId: A });
}

const govde = (planImza: string, ek: Partial<{ onayli: unknown; pasif: unknown }> = {}): UygulaGovdesi => {
  const r = uygulaGovdesiniCoz({ planImza, ciftler: TABLO, onayli: ONAYLI, pasif: PASIF, ...ek });
  if (!r.tamam) throw new Error(r.error);
  return r.g;
};
async function imza(cid = A, aynaKullan = true): Promise<string> {
  const c = uygulaGovdesiniCoz({ planImza: 'a'.repeat(64), ciftler: TABLO, onayli: ONAYLI });
  if (!c.tamam) throw new Error(c.error);
  const r = await stokKodGocuKuruKos({ havuz, ...bagimlilik().kuru }, { companyId: cid, aynaKullan, ciftler: c.g.ciftler, yokSayilan: c.g.yokSayilan });
  if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
  return r.rapor.planImza;
}
async function uygula(ek: Partial<{ onayli: unknown; pasif: unknown }> = {}, d = bagimlilik()): Promise<CalismaBasligi> {
  const r = await stokKodGocuUygulaBaslat(d, { companyId: A, aynaKullan: true, govde: govde(await imza(), ek), aktor: OPS_AKTORU });
  if (!r.tamam) throw new Error(`${r.durum} ${r.error} ${JSON.stringify(r.gecersiz ?? [])}`);
  return r.is;
}
async function geriAl(calismaId: string): Promise<CalismaBasligi> {
  const r = await stokKodGocuGeriAlBaslat(bagimlilik(), { companyId: A, calismaId, aktor: OPS_AKTORU });
  if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
  return r.is;
}
/** İş verisinin içerik dökümü (geri alma «bayt bayt» kanıtı; çalışma kaydı ve kilit hariç). */
const dokum = async (): Promise<string> => JSON.stringify((await db.query("SELECT coll, id, data::text AS d FROM docs WHERE coll NOT IN ('stokKodGocuKayitlari', 'opsLocks') ORDER BY coll, id")).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  await db.exec('CREATE TABLE mikro_stoklar (sto_kod text PRIMARY KEY, veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now())');
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await tohumla(); });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D4 · uygulama — kiracı A', () => {
  it('kuru koşuyla AYNI imza; çiftler uygulanır, kilit bırakılır, denetim satırı «ops», ad yok', async () => {
    const b = await uygula();
    expect(b.durum, JSON.stringify(b.ciftler)).toBe('tamam');
    expect(b.ciftler.map(c => [c.eski, c.tur, c.durum])).toEqual([
      [AKC, 'tam', 'uygulandi'], ['MITREAPEL-HY-003', 'tam', 'uygulandi'], ['MA-HY-003', 'tam', 'uygulandi'],   // ortak hedef: en yeni önce
      ['ARGTGRİ', 'tam', 'uygulandi'], ['ETK-ESKI', 'tam', 'uygulandi'], [YTONG, 'tam', 'uygulandi'], ['RENKLENDİRME15LT', 'pasif', 'uygulandi'],
    ]);
    expect(await bakimKilidiVar(havuz)).toBeNull();
    expect(denetimler).toHaveLength(1);
    expect(denetimler[0]).toMatchObject({ aktor: 'ops', eylem: 'Stok kodu göçü uygulandı', kiraci: A });
    const kayit = await calismaBasligiOku(havuz, A, b.calismaId);
    expect(JSON.stringify(kayit)).not.toMatch(/GİZLİ/);
    expect(await calismaBasligiOku(havuz, B, b.calismaId)).toBeNull();                         // başka kiracı göremez
  });

  it('D2 · eski kart silinir; kalan karta yalnız eşik + not; Mikro alanları (costPrice, stockLevel, prices) kalan karttan', async () => {
    await uygula();
    expect(await oku('inventory', 'k-eski')).toBeNull();
    expect(await oku('inventory', 'k-yeni')).toEqual({ sku: AKY, name: 'GİZLİ AD', source: 'mikro_cron', companyId: A, lowStockThreshold: 20, notes: 'eski not', prices: { Retail: 12 } });
    // Ortak hedef: en yeni updatedAt'li eski kart (MITREAPEL, 15.10) kazanır; MA notu çakışma olarak parçaya yazılır.
    expect((await oku('inventory', 'k-apel'))?.notes).toBe('mitre notu');
    const parcalar = (await db.query<{ data: { eski: string; katlanmayan: unknown[] } }>("SELECT data FROM docs WHERE coll = 'stokKodGocuKayitlari' AND id LIKE '%~%'")).rows.map(r => r.data);
    expect(parcalar.find(p => p.eski === 'MA-HY-003')?.katlanmayan).toEqual([{ alan: 'notes', eskiKart: 'k-ma', neden: 'kalan_dolu' }]);
  });

  it('D3 · bağlı belgeler yeni koda; sipariş yalnız sku + iz; yetimin evrak eşi Mikro\'daysa YAZILMAZ; aynalar ve mağaza talebi YAZILMAZ', async () => {
    const b = await uygula();
    expect(await oku('orders', 'mf-a')).toEqual({ source: 'mikro-fatura', companyId: A, updatedAt: '2026-10-02T00:00:00.000Z', kodGocu: { calismaId: b.calismaId },
      lineItems: [{ sku: AKY, name: 'GİZLİ', price: 10, kalemSurumu: 2 }, { sku: 'BASKA-1', name: 'x', price: 1 }] });
    expect((await oku('orders', 'mf-arg'))?.lineItems).toEqual([{ sku: 'ARAGONIT-SDD-GRI-20', name: 'GİZLİ' }]);     // NFD İ sayıldı ve taşındı
    expect(await oku('orders', 'o-etk')).toMatchObject({ companyId: A, lineItems: [{ sku: 'ETK-YENI' }] });          // DH19
    expect(await oku('quotations', 'q-1')).toEqual({ companyId: A, items: [{ sku: AKY, inventoryId: 'k-yeni' }], lineItems: [{ sku: AKY }] });
    expect((await oku('inventoryMovements', g(101)))?.sth_stok_kod).toBe(AKY);                 // Mikro'da aynı GUID yeni kodla
    expect((await oku('inventoryMovements', g(102)))?.sth_stok_kod).toBe(AKC);                 // yetim, evrak eşi Mikro'da → yazılmaz
    expect((await oku('inventoryMovements', g(105)))?.sth_stok_kod).toBe(AKY);                 // yetim, evrak eşi yok → yazılır
    expect(await oku('inventoryMovements', 'elle-1')).toEqual({ productId: 'k-yeni', sku: AKY, quantity: 2, companyId: A });
    expect(await oku('stockDiscrepancies', 'sd-1')).toEqual({ productId: 'k-yeni', sku: AKY, companyId: A });
    expect(await oku('locationStocks', 'depo__D1__k-eski')).toBeNull();
    expect(await oku('locationStocks', 'depo__D1__k-yeni')).toEqual({ id: 'depo__D1__k-yeni', productId: 'k-yeni', sku: AKY, quantity: 2, companyId: A });
    expect(await oku('warehouseItems', ESKI_DEPO)).toBeNull();                                  // DH18: silinir, yeni kimliğe kopya yok
    expect(await oku('warehouseItems', YTONG_DEPO)).toBeNull();                                 // `/` → `_` kimliği import ile aynı
    expect(await oku('warehouseItems', `mikro-${etiket(A)}-${AKY}`)).toBeNull();
    expect(await oku('mikroFiyatListeleri', 'fl-1')).toEqual({ sfiyat_stokkod: AKC, companyId: A });
    expect(await oku('magazaTalepleri', 'mt-1')).toEqual({ companyId: A, kalemler: [{ sku: 'MAG-ESKI-D002' }] });
    // Açık istemcilere yayın: silinen kart + güncellenen sipariş; SERVER_ONLY koleksiyon yayınlanmaz.
    expect(yayinlar).toContainEqual({ coll: 'inventory', tur: 'delete', id: 'k-eski' });
    expect(yayinlar).toContainEqual({ coll: 'orders', tur: 'set', id: 'mf-a' });
    expect(yayinlar.filter(y => y.coll === 'stokKodEsleri' || y.coll === 'stokKodGocuKayitlari')).toEqual([]);
  });

  it('kiracı B\'ye dokunulmaz (aynı eski kodlu kart, sipariş, hareket)', async () => {
    const once = JSON.stringify(await Promise.all([oku('inventory', 'b-eski'), oku('inventory', 'b-yeni'), oku('orders', 'mf-b'), oku('inventoryMovements', g(201))]));
    await uygula();
    expect(JSON.stringify(await Promise.all([oku('inventory', 'b-eski'), oku('inventory', 'b-yeni'), oku('orders', 'mf-b'), oku('inventoryMovements', g(201))]))).toBe(once);
  });

  it('D3 + DH12 · eş belgesi: kimlik `<kiracı8>:<eski>`, `stoGuid` aynadan, eski kart kimlikleri; etiketsiz eski kartın eşi de kiracıda', async () => {
    const b = await uygula();
    expect(await oku('stokKodEsleri', esKimligi(A, AKC))).toMatchObject({
      companyId: A, eski: AKC, yeni: AKY, sinif: 'kesin', calismaId: b.calismaId, stoGuid: g(900), eskiKartlar: ['k-eski'], kalanKart: 'k-yeni',
    });
    expect(await oku('stokKodEsleri', esKimligi(A, 'MA-HY-003'))).toMatchObject({ sinif: 'dogrula', stoGuid: null });
    expect(await oku('stokKodEsleri', esKimligi(A, 'ETK-ESKI'))).toMatchObject({ companyId: A, eskiKartlar: ['k-etk'] });
  });

  it('D5 · pasif kart silinmez, işaretlenir; pasif listesi kod + kart kimliği (ad yok), kiracı süzgeçli', async () => {
    const b = await uygula();
    expect(await oku('inventory', 'k-kars')).toMatchObject({ sku: 'RENKLENDİRME15LT', mikroPasif: { neden: 'mikroda_yok', calismaId: b.calismaId } });
    const liste = await stokKodGocuPasifListesi(havuz, A);
    expect(liste).toEqual([{ kod: 'RENKLENDİRME15LT', kartId: 'k-kars', neden: 'mikroda_yok', calismaId: b.calismaId, tarih: expect.any(String) }]);
    expect(await stokKodGocuPasifListesi(havuz, B)).toEqual([]);
  });

  it('D4 değişmezi: uygulama sonrası aynı sku\'da iki kart → iş `hata` ile biter (çift kartlı plan geçmez)', async () => {
    await koy('inventory', 'k-dup2', { sku: 'DUP-1', source: 'mikro_cron', companyId: A });
    const b = await uygula({ onayli: [{ eski: AKC, yeni: AKY }], pasif: [] });
    expect(b.durum).toBe('hata');
    expect(b.ayniSkuSonrasi).toEqual([{ sku: 'DUP-1', kart: 2 }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D4 · reddedilen istekler (hiçbir şey yazılmaz, kilit bırakılır)', () => {
  it('imza tutmazsa 409; onaylı listede DH2 / DH14 engelli ya da kuru koşuda olmayan satır → 400 satır satır', async () => {
    const once = await dokum();
    const r409 = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde('b'.repeat(64)), aktor: OPS_AKTORU });
    expect(r409).toMatchObject({ tamam: false, durum: 409 });
    const r400 = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, aktor: OPS_AKTORU,
      govde: govde(await imza(), { onayli: [...ONAYLI, { eski: 'MAG-ESKI', yeni: 'MAG-YENI' }, { eski: 'HAR-ESKI', yeni: 'HAR-YENI' }, { eski: 'YOK-1', yeni: AKY }] }) });
    expect(r400.tamam).toBe(false);
    if (r400.tamam) return;
    expect([r400.durum, r400.gecersiz]).toEqual([400, [
      { eski: 'MAG-ESKI', yeni: 'MAG-YENI', neden: 'engel:magaza_talebi_eski_kodda' },
      { eski: 'HAR-ESKI', yeni: 'HAR-YENI', neden: 'engel:mikro_hareket_eski_kodda' },
      { eski: 'YOK-1', yeni: AKY, neden: 'kuru_kosuda_yok' },
    ]]);
    expect(await dokum()).toBe(once);
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  it('DH16 · kuru koşudan sonra senkron stockLevel / costPrice yazar → imza tutar; eski kodlu yeni sipariş eklenince 409', async () => {
    const i = await imza();
    await koy('inventory', 'k-yeni', { sku: AKY, name: 'GİZLİ AD', source: 'mikro_cron', companyId: A, lowStockThreshold: 5, stockLevel: 8, costPrice: 3, mikroSyncedAt: 'x' });
    await koy('inventory', 'k-eski', { sku: AKC, name: 'GİZLİ AD', source: 'mikro_import', companyId: A, lowStockThreshold: 20, notes: 'eski not', costPrice: 50, stockLevel: 1 });
    const tamam = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(i, { onayli: [{ eski: AKC, yeni: AKY }], pasif: [] }), aktor: OPS_AKTORU });
    expect(tamam.tamam).toBe(true);
    if (tamam.tamam) expect((await tamam.is).durum).toBe('tamam');
    await tohumla();
    const i2 = await imza();
    await koy('orders', 'yeni-siparis', { companyId: A, lineItems: [{ sku: 'MA-HY-003' }] });
    expect(await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(i2), aktor: OPS_AKTORU })).toMatchObject({ tamam: false, durum: 409 });
  });

  it('kilit varsa 423 (iki bakım aynı anda koşmaz)', async () => {
    await koy('opsLocks', 'bakim', { aciklama: 'lead-birlestir', baslangic: new Date().toISOString() });
    expect(await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(await imza()), aktor: OPS_AKTORU })).toMatchObject({ tamam: false, durum: 423 });
    expect(await bakimKilidiVar(havuz)).toMatchObject({ aciklama: 'lead-birlestir' });       // başkasının kilidine dokunulmaz
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH7 · idempotent', () => {
  it('ikinci koşu (yeni kuru koşu imzasıyla) 0 değişiklik', async () => {
    await uygula();
    const ikinci = await uygula();
    expect(ikinci.durum).toBe('tamam');
    expect(ikinci.ozet.toplamDegisiklik).toBe(0);
    expect(ikinci.ciftler.every(c => c.durum === 'atlandi')).toBe(true);
    // AKÇ'nin bağlı kaydı 1: evrak eşi Mikro'da olan yetim hareket (DH2 — yazılmaz, raporlanır) → yalnız referans adımı, değişiklik yok.
    expect(ikinci.ciftler.map(c => [c.eski, c.tur, c.neden])).toEqual([
      [AKC, 'referans', 'degisiklik_yok'], ['MA-HY-003', 'atla', 'zaten_uygulandi'], ['MITREAPEL-HY-003', 'atla', 'zaten_uygulandi'],
      ['ARGTGRİ', 'atla', 'zaten_uygulandi'], ['ETK-ESKI', 'atla', 'zaten_uygulandi'], [YTONG, 'atla', 'zaten_uygulandi'], ['RENKLENDİRME15LT', 'pasif', 'degisiklik_yok'],
    ]);
  });

  it('ilk koşudan sonra bir siparişe eski kod elle konur → ikinci koşu YALNIZ onu taşır (kart adımı yok)', async () => {
    await uygula();
    await koy('orders', 'sonradan', { companyId: A, lineItems: [{ sku: AKC, name: 'elle' }] });
    const ikinci = await uygula();
    expect(ikinci.ozet.belge).toEqual({ orders: 1 });
    expect(ikinci.ciftler.find(c => c.eski === AKC)).toMatchObject({ tur: 'referans', durum: 'uygulandi', belge: { orders: 1 } });
    expect((await oku('orders', 'sonradan'))?.lineItems).toEqual([{ sku: AKY, name: 'elle' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH9 · çift başına gerçek işlem', () => {
  it('çiftin 4. yazımında hata → o çiftin bütün belgeleri bayt bayt aynı; sonraki çift işlenir; iş `hata`', async () => {
    const once = JSON.stringify(await Promise.all([oku('inventory', 'k-eski'), oku('inventory', 'k-yeni'), oku('orders', 'mf-a'), oku('quotations', 'q-1'), oku('warehouseItems', ESKI_DEPO), oku('inventoryMovements', 'elle-1')]));
    const i = await imza();
    Object.assign(enjeksiyon, { islem: 0, kacinciIslem: 1, kacinciYazim: 4 });              // ilk çift (AKÇ) işleminin 4. yazımı
    const r = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(i), aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(r.error);
    const b = await r.is;
    expect(b.ciftler[0]).toMatchObject({ eski: AKC, durum: 'hata', neden: 'enjekte edilen yazım hatası' });
    expect(b.ciftler[1]).toMatchObject({ eski: 'MITREAPEL-HY-003', durum: 'uygulandi' });
    expect(b.durum).toBe('hata');
    expect(JSON.stringify(await Promise.all([oku('inventory', 'k-eski'), oku('inventory', 'k-yeni'), oku('orders', 'mf-a'), oku('quotations', 'q-1'), oku('warehouseItems', ESKI_DEPO), oku('inventoryMovements', 'elle-1')]))).toBe(once);
    expect(await oku('stokKodEsleri', esKimligi(A, AKC))).toBeNull();
    expect(await oku('stokKodGocuKayitlari', `${b.calismaId}~00001`)).toBeNull();            // parça da aynı işlemde geri döndü
    expect(await oku('inventory', 'k-mitre')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D4 + DH11 · geri alma', () => {
  it('geri al → iş verisi bayt bayt önceki hâli; eşler silinir; ikinci geri alma 409', async () => {
    const once = await dokum();
    const b = await uygula();
    expect(await dokum()).not.toBe(once);
    const g2 = await geriAl(b.calismaId);
    expect(g2.geriAlma, JSON.stringify(g2.geriAlma)).toMatchObject({ durum: 'tamam', atlanan: [] });
    expect(await dokum()).toBe(once);
    expect(await bakimKilidiVar(havuz)).toBeNull();
    expect(denetimler.map(x => x.eylem)).toEqual(['Stok kodu göçü uygulandı', 'Stok kodu göçü geri alındı']);
    expect(await stokKodGocuGeriAlBaslat(bagimlilik(), { companyId: A, calismaId: b.calismaId, aktor: OPS_AKTORU })).toMatchObject({ tamam: false, durum: 409 });
    expect(await stokKodGocuGeriAlBaslat(bagimlilik(), { companyId: B, calismaId: b.calismaId, aktor: OPS_AKTORU })).toMatchObject({ tamam: false, durum: 404 });
  });

  it('DH11 · uygula → senkron stockLevel + mikroSyncedAt yazar → geri al: katlanan alanlar döner, stockLevel KORUNUR; sipariş / hareket bayt bayt; yeni sayım farkı 0', async () => {
    const siparisOnce = JSON.stringify([await oku('orders', 'mf-a'), await oku('inventoryMovements', g(101)), await oku('inventoryMovements', 'elle-1')]);
    const farkOnce = (await db.query("SELECT count(*)::int AS n FROM docs WHERE coll = 'stockDiscrepancies'")).rows;
    const b = await uygula();
    const kalan = await oku('inventory', 'k-yeni');
    await koy('inventory', 'k-yeni', { ...kalan, stockLevel: 6, mikroSyncedAt: '2026-11-05T21:00:00.000Z' });
    await geriAl(b.calismaId);
    expect(await oku('inventory', 'k-yeni')).toEqual({ sku: AKY, name: 'GİZLİ AD', source: 'mikro_cron', companyId: A, lowStockThreshold: 5, prices: { Retail: 12 }, stockLevel: 6, mikroSyncedAt: '2026-11-05T21:00:00.000Z' });
    expect(JSON.stringify([await oku('orders', 'mf-a'), await oku('inventoryMovements', g(101)), await oku('inventoryMovements', 'elle-1')])).toBe(siparisOnce);
    expect((await db.query("SELECT count(*)::int AS n FROM docs WHERE coll = 'stockDiscrepancies'")).rows).toEqual(farkOnce);
    expect(await oku('inventory', 'k-eski')).toMatchObject({ sku: AKC, notes: 'eski not', costPrice: 99 });
  });

  it('geri almadan önce kullanıcı alanı değiştirdiyse o alan EZİLMEZ, listelenir', async () => {
    const b = await uygula();
    const kalan = await oku('inventory', 'k-yeni');
    await koy('inventory', 'k-yeni', { ...kalan, notes: 'kullanıcı yeni not yazdı' });
    const g2 = await geriAl(b.calismaId);
    expect((await oku('inventory', 'k-yeni'))?.notes).toBe('kullanıcı yeni not yazdı');
    expect((await oku('inventory', 'k-yeni'))?.lowStockThreshold).toBe(5);
    expect(g2.geriAlma?.atlanan).toContainEqual({ coll: 'inventory', id: 'k-yeni', neden: 'alan_sonradan_degisti', alanlar: ['notes'] });
  });

  it('DH10 · kayıtta `users` ya da yabancı kiracı belgesi → geri alma HİÇBİR ŞEY yazmadan reddeder (422)', async () => {
    const b = await uygula();
    const sonra = await dokum();
    await koy('stokKodGocuKayitlari', `${b.calismaId}~99999`, { companyId: A, calismaId: b.calismaId, sira: 99999, eski: 'x', yeni: null, tur: 'tam', atlanan: [], katlanmayan: [],
      degisiklikler: [{ coll: 'users', id: 'ic-Admin', tur: 'silindi', tam: { role: 'Admin' } }] });
    const r = await stokKodGocuGeriAlBaslat(bagimlilik(), { companyId: A, calismaId: b.calismaId, aktor: OPS_AKTORU });
    expect(r).toMatchObject({ tamam: false, durum: 422 });
    await koy('stokKodGocuKayitlari', `${b.calismaId}~99999`, { companyId: A, calismaId: b.calismaId, sira: 99999, eski: 'x', yeni: null, tur: 'tam', atlanan: [], katlanmayan: [],
      degisiklikler: [{ coll: 'orders', id: 'mf-b', tur: 'alan', once: { lineItems: [] }, onceYok: [], sonra: { lineItems: [{ sku: AKC }] } }] });
    expect(await stokKodGocuGeriAlBaslat(bagimlilik(), { companyId: A, calismaId: b.calismaId, aktor: OPS_AKTORU })).toMatchObject({ tamam: false, durum: 422 });
    expect(await dokum()).toBe(sonra);
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH8 · kilit', () => {
  it('kilit anında koşan yazıcı bitene kadar HİÇBİR şey yazılmaz; bu sırada saatlik senkron (yazıcı) kilit görüp atlar', async () => {
    await yaziciKaydet(havuz, 'mikro-cron', new Date().toISOString());
    const r = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(await imza()), aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(r.error);
    await new Promise(res => setTimeout(res, 80));
    expect(await oku('inventory', 'k-eski')).not.toBeNull();                                   // yazıcı bitmedi → iş beklemede
    let kostu = false;
    const s = await yaziciOlarakCalistir(havuz, 'mikro-cron:ikinci', async () => { kostu = true; });
    expect('kilit' in s && s.kilit.aciklama.startsWith('stok-kod-gocu ')).toBe(true);
    expect(kostu).toBe(false);
    await yaziciSil(havuz, 'mikro-cron');
    const b = await r.is;
    expect(b.durum).toBe('tamam');
    expect(await oku('inventory', 'k-eski')).toBeNull();
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  // Paket turu (05.11.2026): kilit ALTINDAKİ ikinci imza denetimi kaldırılınca hiçbir test kırmızıya dönmüyordu (mutasyon kaçtı).
  it('kilit beklenirken koşan yazıcı veriyi değiştirirse (eski kodlu sipariş) iş `imza_uyusmadi` ile biter; HİÇBİR şey yazılmaz, kilit kalmaz', async () => {
    await yaziciKaydet(havuz, 'mikro-cron', new Date().toISOString());
    const r = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(await imza()), aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(r.error);
    // Kilitten ÖNCE başlamış yazıcı (saatlik senkron / elle import) bekleme sırasında eski kodla belge yazar, sonra biter.
    await koy('orders', 'yazicinin-siparisi', { companyId: A, lineItems: [{ sku: 'MA-HY-003' }] });
    const once = await dokum();
    await yaziciSil(havuz, 'mikro-cron');
    const b = await r.is;
    expect([b.durum, b.ciftler]).toEqual(['imza_uyusmadi', []]);
    expect(await dokum()).toBe(once);
    expect(await bakimKilidiVar(havuz)).toBeNull();
    expect(denetimler).toEqual([]);
  });

  it('hata fırlatan işte (kilit altındaki kuru koşu Mikro\'ya ulaşamaz) kilit KALMAZ, başlık `hata`', async () => {
    const i = await imza();
    let ilk = true;
    const d = bagimlilik({ bekleme: { aralikMs: 5, uyu: async () => { if (!ilk) return; ilk = false; mikro.firlat = true; } } });
    const r = await stokKodGocuUygulaBaslat(d, { companyId: A, aynaKullan: true, govde: govde(i), aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(r.error);
    const b = await r.is;
    expect(b.durum).toBe('hata');
    expect(await bakimKilidiVar(havuz)).toBeNull();
    expect(await oku('inventory', 'k-eski')).not.toBeNull();
  });

  it('denetim yazımı fırlatsa da kilit kalmaz', async () => {
    const b = await uygula({}, bagimlilik({ denetim: async () => { throw new Error('denetim düştü'); } }));
    expect(b.durum).toBe('hata');
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  it('açılış temizliği: yalnız `stok-kod-gocu ` kilidi kaldırılır, başlık `yarida`; başka kilide dokunulmaz', async () => {
    const id = 'skg-20261105220000-abc123';
    await koy('stokKodGocuKayitlari', id, { companyId: A, calismaId: id, durum: 'kosuyor', ciftler: [] });
    await koy('opsLocks', 'bakim', { aciklama: `stok-kod-gocu ${id}`, baslangic: new Date().toISOString() });
    expect(await stokKodGocuAcilisTemizligi(havuz)).toEqual({ kaldirildi: true, calismaId: id });
    expect(await bakimKilidiVar(havuz)).toBeNull();
    expect((await oku('stokKodGocuKayitlari', id))?.durum).toBe('yarida');
    await koy('opsLocks', 'bakim', { aciklama: 'lead-birlestir', baslangic: new Date().toISOString() });
    expect(await stokKodGocuAcilisTemizligi(havuz)).toEqual({ kaldirildi: false, calismaId: null });
    expect(await bakimKilidiVar(havuz)).toMatchObject({ aciklama: 'lead-birlestir' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH18 · warehouseItems', () => {
  it('koddan türeyen kimlikteki belgenin sku\'su eski kod değilse SİLİNMEZ, listelenir', async () => {
    await koy('warehouseItems', ESKI_DEPO, { sku: 'BASKA-KOD', quantity: 0, companyId: A });
    const b = await uygula({ onayli: [{ eski: AKC, yeni: AKY }], pasif: [] });
    expect(b.durum).toBe('tamam');
    expect(await oku('warehouseItems', ESKI_DEPO)).toEqual({ sku: 'BASKA-KOD', quantity: 0, companyId: A });
  });

  // Paket turu (05.11.2026): motordaki çakışma denetimi kaldırılınca hiçbir test kırmızıya dönmüyordu (yalnız saf yardımcı sınanıyordu).
  it('değişmez: iki FARKLI kod `/` → `_` sonrası aynı depo kimliğine düşüyorsa o belge SİLİNMEZ, YENİDEN YAZILMAZ, listelenir', async () => {
    // Kiracıda `/` yerine `_` taşıyan ikinci kart: `YTONG-60*25*10 PL_48` ile eski kod `YTONG-60*25*10 PL/48` aynı depo kimliğine düşer.
    await koy('inventory', 'k-ytong-alt', { sku: 'YTONG-60*25*10 PL_48', source: 'mikro_import', companyId: A });
    const b = await uygula({ onayli: [{ eski: YTONG, yeni: 'YTONG-PL-48' }], pasif: [] });
    expect(b.ciftler.map(c => [c.eski, c.durum])).toEqual([[YTONG, 'uygulandi']]);
    expect(await oku('warehouseItems', YTONG_DEPO)).toEqual({ sku: YTONG, quantity: 1, companyId: A });
    expect(await oku('inventory', 'k-ytong')).toBeNull();                                      // kart adımı yine koşar
    const parca = await oku('stokKodGocuKayitlari', `${b.calismaId}~00001`);
    expect(parca?.atlanan).toContainEqual({ coll: 'warehouseItems', id: YTONG_DEPO, neden: 'depo_kimlik_cakismasi' });
  });
});

describe('kuru koşu (D4 sonrası): eşin eski kodu kartsız sayılır, kart kimliği yolu silinen kimlikle ölçülür', () => {
  it('uygulama sonrası eski koda bağlı kayıt 0 (aynalar ve mağaza talebi hariç); sonradan eski kart kimliğiyle yazılan sayım farkı sayılır', async () => {
    await uygula();
    const c = uygulaGovdesiniCoz({ planImza: 'a'.repeat(64), ciftler: [], onayli: ONAYLI });
    if (!c.tamam) throw new Error(c.error);
    const kos = async () => {
      const r = await stokKodGocuKuruKos({ havuz, ...bagimlilik().kuru }, { companyId: A, aynaKullan: true, ciftler: [], yokSayilan: c.g.yokSayilan });
      if (!r.tamam) throw new Error(r.error);
      return r.rapor;
    };
    const r1 = await kos();
    expect(r1.kartsizBagli.filter(x => Object.keys(x.bagli).some(k => !['mikroFiyatListeleri', 'magazaTalepleri', 'barkodlar'].includes(k)))).toEqual([
      { kod: AKC, bagli: { inventoryMovements: 1, mikroFiyatListeleri: 1 } },                // g(102): evrak eşi Mikro'da olan yetim (raporlanır)
    ]);
    expect(r1.kartsizKimlikOlculmedi).toEqual([]);
    expect(r1.pasifKart).toBe(1);
    await koy('stockDiscrepancies', 'sd-sonra', { productId: 'k-eski', companyId: A });
    const r2 = await kos();
    expect(r2.kartsizBagli.find(x => x.kod === AKC)?.bagli.stockDiscrepancies).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// İnceleme turu 05.11.2026 (MKD3 dizin 0–2). Mutasyonlar: tam çiftteki `throw` kaldırılır → «arka koruma» kırmızı; `throw`
// koşulsuz olur → «referans çifti» kırmızı; taşıma eşi atlaması kaldırılır → «yarım geri alma» iki sınaması kırmızı; `finally`
// denetimi kaldırılır → «arada fırlatan havuz» kırmızı; bayrak kaldırılır → «kuru koşuyla AYNI imza» (tek satır) kırmızı; açılış
// temizliğinin denetimi kaldırılır → «yarida tek satır» kırmızı.
// İnceleme turu 06.11.2026 (MKD4 dizin 0–1): `onayliDogrula`daki konum çakışması denetimi kaldırılır → «önizlemede geçersiz» iki
// sınaması kırmızı; geri almadaki `tasimaEsiDolu` kaldırılır → «eski kimlik doluysa iki belge de yerinde» kırmızı.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('MKD3 · locationStocks hedef belgesi (dizin 0)', () => {
  const anlik = async (ek: Array<[string, string]> = []): Promise<string> => JSON.stringify(await Promise.all([
    oku('inventory', 'k-eski'), oku('inventory', 'k-yeni'), oku('locationStocks', 'depo__D1__k-eski'), oku('locationStocks', 'depo__D1__k-yeni'),
    oku('orders', 'mf-a'), oku('stockDiscrepancies', 'sd-1'), oku('stokKodEsleri', esKimligi(A, AKC)), ...ek.map(([c, i]) => oku(c, i)),
  ]));

  it('MKD4 · tam çiftte hedef konum belgesi varsa çift önizlemede GEÇERSİZ (`hedef_konum_belgesi_var`): hiçbir şey yazılmaz, miktar birleştirilmez', async () => {
    await koy('locationStocks', 'depo__D1__k-yeni', { id: 'depo__D1__k-yeni', productId: 'k-yeni', sku: AKY, quantity: 7, companyId: A });
    const once = await anlik();
    const r = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(await imza(), { onayli: [{ eski: AKC, yeni: AKY }], pasif: [] }), aktor: OPS_AKTORU });
    // Çift geçerli sayılırsa arka plan işi bitmeden sınama düşmesin (iş sonraki sınamanın tohumuna yazmasın).
    if (r.tamam) { await r.is; throw new Error('çift önizlemede geçersiz sayılmadı'); }
    expect([r.durum, r.gecersiz]).toEqual([400, [{ eski: AKC, yeni: AKY, neden: 'hedef_konum_belgesi_var' }]]);
    expect(await anlik()).toBe(once);
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  it('MKD4 · iki eski kart aynı depoda (ikisi de aynı yeni kimliğe düşer) → önizlemede GEÇERSİZ `hedef_konum_belgesi_var`', async () => {
    await koy('inventory', 'k-eski2', { sku: AKC, name: 'GİZLİ AD', source: 'mikro_import', companyId: A });
    await koy('locationStocks', 'depo__D1__k-eski2', { id: 'depo__D1__k-eski2', productId: 'k-eski2', sku: AKC, quantity: 3, companyId: A });
    const once = await anlik([['inventory', 'k-eski2'], ['locationStocks', 'depo__D1__k-eski2']]);
    const r = await stokKodGocuUygulaBaslat(bagimlilik(), { companyId: A, aynaKullan: true, govde: govde(await imza(), { onayli: [{ eski: AKC, yeni: AKY }], pasif: [] }), aktor: OPS_AKTORU });
    // Çift geçerli sayılırsa arka plan işi bitmeden sınama düşmesin (iş sonraki sınamanın tohumuna yazmasın).
    if (r.tamam) { await r.is; throw new Error('çift önizlemede geçersiz sayılmadı'); }
    expect([r.durum, r.gecersiz]).toEqual([400, [{ eski: AKC, yeni: AKY, neden: 'hedef_konum_belgesi_var' }]]);
    expect(await anlik([['inventory', 'k-eski2'], ['locationStocks', 'depo__D1__k-eski2']])).toBe(once);
  });

  it('arka koruma: hedef konum belgesi kuru koşudan SONRA yazılırsa tam çift HATA ile geri döner: eski kart ve konum belgeleri bayt bayt aynı', async () => {
    const hedef = { id: 'depo__D1__k-yeni', productId: 'k-yeni', sku: AKY, quantity: 7, companyId: A };
    // Kilit altındaki kuru koşudan sonra, çiftin işlemi açılmadan hemen önce (ilk BEGIN) başka bir yazıcı hedef kimliği yazar.
    let yazildi = false;
    const q: UygulaPgHavuzu['query'] = async (sql, params = []) => {
      if (!yazildi && /^BEGIN/i.test(sql.trim())) { yazildi = true; await koy('locationStocks', hedef.id, hedef); }
      return sorgu(sql, params);
    };
    const araYazan: UygulaPgHavuzu = { query: q, connect: async () => ({ query: q, release() {} }) };
    const b = await uygula({ onayli: [{ eski: AKC, yeni: AKY }], pasif: [] }, bagimlilik({ havuz: araYazan }));
    expect(yazildi).toBe(true);
    expect(b.ciftler.map(c => [c.eski, c.tur, c.durum, c.neden])).toEqual([[AKC, 'tam', 'hata', 'hedef konum belgesi var: depo__D1__k-yeni']]);
    expect(b.durum).toBe('hata');
    expect(await oku('inventory', 'k-eski')).toMatchObject({ sku: AKC });
    expect(await oku('locationStocks', 'depo__D1__k-eski')).toMatchObject({ productId: 'k-eski', quantity: 2 });
    expect(await oku('locationStocks', 'depo__D1__k-yeni')).toEqual(hedef);
    expect(await oku('stokKodGocuKayitlari', `${b.calismaId}~00001`)).toBeNull();
  });

  it('referans çiftinde (eski kart önceki çalışmada silindi) hedef konum belgesi varsa eski belge ATLANIR, çift hata değildir', async () => {
    await uygula({ onayli: [{ eski: AKC, yeni: AKY }], pasif: [] });
    // İlk çalışmadan sonra silinmiş eski kart kimliğiyle konum belgesi yeniden yazılır; hedef kimlikte ilk çalışmanın taşıdığı belge durur.
    await koy('locationStocks', 'depo__D1__k-eski', { id: 'depo__D1__k-eski', productId: 'k-eski', sku: AKC, quantity: 3, companyId: A });
    const once = JSON.stringify([await oku('locationStocks', 'depo__D1__k-eski'), await oku('locationStocks', 'depo__D1__k-yeni')]);
    const b = await uygula({ onayli: [{ eski: AKC, yeni: AKY }], pasif: [] });
    expect(b.ciftler.map(c => [c.eski, c.tur, c.durum])).toEqual([[AKC, 'referans', 'atlandi']]);
    expect(b.durum).toBe('tamam');
    expect(JSON.stringify([await oku('locationStocks', 'depo__D1__k-eski'), await oku('locationStocks', 'depo__D1__k-yeni')])).toBe(once);
  });
});

describe('MKD3 · geri almada locationStocks taşıması bütün olarak döner (dizin 1)', () => {
  it('yeni kimlikli belge sonradan değiştiyse eski kimlikli belge de geri YAZILMAZ (stok iki kez sayılmaz); ikisi de listelenir', async () => {
    const b = await uygula();
    const yeni = await oku('locationStocks', 'depo__D1__k-yeni');
    await koy('locationStocks', 'depo__D1__k-yeni', { ...yeni, quantity: 1 });
    const g2 = await geriAl(b.calismaId);
    expect(await oku('locationStocks', 'depo__D1__k-eski')).toBeNull();
    expect(await oku('locationStocks', 'depo__D1__k-yeni')).toMatchObject({ productId: 'k-yeni', quantity: 1 });
    expect(g2.geriAlma?.atlanan).toEqual(expect.arrayContaining([
      { coll: 'locationStocks', id: 'depo__D1__k-yeni', neden: 'sonradan_degisti' },
      { coll: 'locationStocks', id: 'depo__D1__k-eski', neden: 'tasinan_konum_geri_alinmadi' },
    ]));
    expect(await oku('inventory', 'k-eski')).toMatchObject({ sku: AKC });                       // parçanın geri kalanı yine döner
  });

  it('MKD4 · eski kimlikte sonradan belge yazıldıysa yeni kimlikli belge de SİLİNMEZ (taşınan stok kaybolmaz); iki belge de yerinde, ikisi de listelenir', async () => {
    const b = await uygula();
    await koy('locationStocks', 'depo__D1__k-eski', { id: 'depo__D1__k-eski', productId: 'k-eski', sku: AKC, quantity: 3, companyId: A });
    const g2 = await geriAl(b.calismaId);
    expect(await oku('locationStocks', 'depo__D1__k-eski')).toEqual({ id: 'depo__D1__k-eski', productId: 'k-eski', sku: AKC, quantity: 3, companyId: A });
    expect(await oku('locationStocks', 'depo__D1__k-yeni')).toMatchObject({ productId: 'k-yeni', quantity: 2 });
    expect(g2.geriAlma?.atlanan).toEqual(expect.arrayContaining([
      { coll: 'locationStocks', id: 'depo__D1__k-yeni', neden: 'eski_kimlikte_belge_var' },
      { coll: 'locationStocks', id: 'depo__D1__k-eski', neden: 'tasinan_konum_geri_alinmadi' },
    ]));
    expect(g2.geriAlma?.atlanan.filter(a => a.coll === 'locationStocks')).toHaveLength(2);
    expect(await oku('inventory', 'k-eski')).toMatchObject({ sku: AKC });                       // parçanın geri kalanı yine döner
  });

  it('yeni kimlikli belge geri alma sırasında başka kiracıya geçtiyse de eşi geri yazılmaz', async () => {
    const b = await uygula();
    const yabanci = { id: 'depo__D1__k-yeni', productId: 'k-yeni', sku: AKY, quantity: 9, companyId: B };
    // DH10 ön denetiminden SONRA (bekleme payında) belge değişir — ön denetim geçer, iş içi kiracı denetimi yakalar.
    const d = bagimlilik({ bekleme: { aralikMs: 5, uyu: async () => { await koy('locationStocks', 'depo__D1__k-yeni', yabanci); } } });
    const r = await stokKodGocuGeriAlBaslat(d, { companyId: A, calismaId: b.calismaId, aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
    const g2 = await r.is;
    expect(await oku('locationStocks', 'depo__D1__k-eski')).toBeNull();
    expect(await oku('locationStocks', 'depo__D1__k-yeni')).toEqual(yabanci);
    expect(g2.geriAlma?.atlanan).toEqual(expect.arrayContaining([
      { coll: 'locationStocks', id: 'depo__D1__k-yeni', neden: 'yabanci_kiraci' },
      { coll: 'locationStocks', id: 'depo__D1__k-eski', neden: 'tasinan_konum_geri_alinmadi' },
    ]));
  });
});

describe('MKD3 · denetim satırı her çalışmada tek (dizin 2)', () => {
  /** `kacinci`. `connect()` çağrısından başlayarak fırlatan havuz (çift yazıldıktan sonra havuz bozulur). */
  const bozulanHavuz = (kacinci: number): UygulaPgHavuzu => {
    let n = 0;
    return { query: sorgu, connect: async () => { n++; if (n >= kacinci) throw new Error('havuz zaman aşımı'); return { query: sorgu, release() {} }; } };
  };

  it('uygulama: ikinci `connect()` fırlatır → yazılmış çift kalır, TEK denetim satırı «hata» durumuyla (ad yok)', async () => {
    const b = await uygula({}, bagimlilik({ havuz: bozulanHavuz(2) }));
    expect(b.durum).toBe('hata');
    expect(b.ozet.uygulanan).toBe(1);
    expect(await oku('inventory', 'k-eski')).toBeNull();                                        // ilk çift kalıcı
    expect(denetimler).toHaveLength(1);
    expect(denetimler[0]).toMatchObject({ aktor: 'ops', eylem: 'Stok kodu göçü uygulandı', kiraci: A });
    expect(denetimler[0].ayrinti).toContain(`${b.calismaId}: 1 çift / pasif uygulandı`);
    expect(denetimler[0].ayrinti).toContain('durum hata: havuz zaman aşımı');
    expect(denetimler[0].ayrinti).not.toMatch(/GİZLİ/);
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  it('uygulama: denetim yazımı bir kez düşerse `finally` aynı çalışma için tek satırı hata durumuyla yazar', async () => {
    let ilk = true;
    const d = bagimlilik({ denetim: async (aktor, eylem, ayrinti, kiraci) => {
      if (ilk) { ilk = false; throw new Error('denetim düştü'); }
      denetimler.push({ aktor: aktor.uid, eylem, ayrinti, kiraci });
    } });
    const b = await uygula({}, d);
    expect(b.durum).toBe('hata');
    expect(denetimler).toHaveLength(1);
    expect(denetimler[0].ayrinti).toContain('durum hata: denetim düştü');
  });

  it('geri alma: ikinci parçada `connect()` fırlatır → geri yazılmış parça kalır, TEK «geri alındı» satırı «hata» durumuyla', async () => {
    const b = await uygula();
    denetimler.length = 0;
    const r = await stokKodGocuGeriAlBaslat(bagimlilik({ havuz: bozulanHavuz(2) }), { companyId: A, calismaId: b.calismaId, aktor: OPS_AKTORU });
    if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
    const g2 = await r.is;
    expect(g2.geriAlma?.durum).toBe('hata');
    expect(Object.keys(g2.geriAlma?.geriYazilan ?? {}).length).toBeGreaterThan(0);
    expect(denetimler).toHaveLength(1);
    expect(denetimler[0]).toMatchObject({ aktor: 'ops', eylem: 'Stok kodu göçü geri alındı', kiraci: A });
    expect(denetimler[0].ayrinti).toContain('durum hata: havuz zaman aşımı');
    expect(await bakimKilidiVar(havuz)).toBeNull();
  });

  it('açılış temizliği: `kosuyor` çalışma `yarida` olunca TEK satır (aktör + kiracı başlıktan, parça sayısı); `tamam` başlıkta satır yok', async () => {
    const id = 'skg-20261105220000-abc123';
    await koy('stokKodGocuKayitlari', id, { companyId: A, calismaId: id, durum: 'kosuyor', aktor: OPS_AKTORU, ciftler: [] });
    await koy('stokKodGocuKayitlari', `${id}~00001`, { companyId: A, calismaId: id, sira: 1, degisiklikler: [] });
    await koy('stokKodGocuKayitlari', `${id}~00002`, { companyId: A, calismaId: id, sira: 2, degisiklikler: [] });
    await koy('opsLocks', 'bakim', { aciklama: `stok-kod-gocu ${id}`, baslangic: new Date().toISOString() });
    const denetim = bagimlilik().denetim;
    expect(await stokKodGocuAcilisTemizligi(havuz, '2026-11-06T00:00:00.000Z', denetim)).toEqual({ kaldirildi: true, calismaId: id });
    expect(denetimler).toEqual([{ aktor: 'ops', eylem: 'Stok kodu göçü yarıda kaldı', kiraci: A, ayrinti: expect.stringContaining(`${id}: uygulama yarıda kaldı`) }]);
    expect(denetimler[0].ayrinti).toContain('parçası 2');
    expect(await bakimKilidiVar(havuz)).toBeNull();
    // Başlık zaten bitmişse (yalnız kilit kalmış) yarıda işareti yok → denetim satırı da yok.
    denetimler.length = 0;
    await koy('stokKodGocuKayitlari', id, { companyId: A, calismaId: id, durum: 'tamam', aktor: OPS_AKTORU, ciftler: [] });
    await koy('opsLocks', 'bakim', { aciklama: `stok-kod-gocu ${id}`, baslangic: new Date().toISOString() });
    expect(await stokKodGocuAcilisTemizligi(havuz, '2026-11-06T00:00:00.000Z', denetim)).toEqual({ kaldirildi: true, calismaId: id });
    expect(denetimler).toEqual([]);
  });

  it('açılış temizliği: yarıda kalan GERİ ALMA geri almanın aktörüyle tek satır bırakır', async () => {
    const id = 'skg-20261105230000-def456';
    await koy('stokKodGocuKayitlari', id, { companyId: A, calismaId: id, durum: 'tamam', aktor: OPS_AKTORU, ciftler: [],
      geriAlma: { durum: 'kosuyor', aktor: { uid: 'yonetici-1', email: 'y@ornek.test' }, baslangic: 'x', bitis: null, geriYazilan: {}, atlanan: [], hata: null } });
    await koy('opsLocks', 'bakim', { aciklama: `stok-kod-gocu ${id} geri-al`, baslangic: new Date().toISOString() });
    await stokKodGocuAcilisTemizligi(havuz, '2026-11-06T00:00:00.000Z', bagimlilik().denetim);
    expect((await oku('stokKodGocuKayitlari', id))?.geriAlma).toMatchObject({ durum: 'yarida' });
    expect(denetimler).toEqual([{ aktor: 'yonetici-1', eylem: 'Stok kodu göçü yarıda kaldı', kiraci: A, ayrinti: expect.stringContaining(`${id}: geri alma yarıda kaldı`) }]);
  });
});
