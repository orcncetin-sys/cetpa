// @vitest-environment node
/**
 * stokKodGocuKuru.pglite.test.ts — kuru koşu motoru GERÇEK PostgreSQL motorunda (PGlite; `docs` DDL'i `docsSema.ts`'ten) + sahte
 * Mikro (`SqlVeriOkuV2` SELECT'lerini metinden tanıyan okuyucu). Şartname «Mikro bağlantı D» D1 + DH1 / DH2 / DH13 / DH16 / DH19.
 *
 * Kiracı A'da ikiz + bağlı `orders` / `inventoryMovements` / `warehouseItems` / `stockDiscrepancies` / mağaza talebi / aynalar;
 * kiracı B'de AYNI kodlu kart ve sipariş. Sınananlar: sınıflar ve sayılar, kiracı süzgeci, etiketsiz kart, ayna kanıtının kiracıya
 * bağlılığı, yetimin evrak eşi, Mikro okuma hatası, imzanın neye duyarlı olduğu ve HİÇBİR yazım yapılmadığı.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_TABLOSU_DDL } from '../docsSema';
import { KURU_SURE_DOLDU, stokKodGocuKuruKos, type KuruBagimliliklari, type KuruPgHavuzu, type KuruRaporu } from './stokKodGocuKuru';
import { kuruGovdesiniCoz } from './stokKodGocu';

let db: PGlite;
const havuz: KuruPgHavuzu = {
  async query(sql, params = []) {
    const r = await db.query<Record<string, unknown>>(sql, params as unknown[]);
    return { rows: r.rows };
  },
};
const koy = (coll: string, id: string, data: Record<string, unknown>): Promise<unknown> =>
  db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data', [coll, id, JSON.stringify(data)]);
const sil = (coll: string, id: string): Promise<unknown> => db.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [coll, id]);

const A = 'KIRACI-A', B = 'KIRACI-B';
const etiket = (cid: string): string => createHash('sha1').update(cid).digest('hex').slice(0, 8);
/** server.ts `mikroIdCozucuIds`'in davranışı (zincir testinde gerçeği koşar). */
const cozucu = (ids: Iterable<string>, cid: string) => {
  const eski = new Set([...ids].filter(i => i.startsWith('mikro-')));
  return (a: string) => (eski.has(`mikro-${a}`) ? `mikro-${a}` : `mikro-${etiket(cid)}-${a}`);
};

const g = (n: number): string => `${String(n).padStart(8, '0')}-0000-1111-2222-333333333333`;
// ── Sahte Mikro ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface MikroHareket { guid: string; kod: string; seri: string; sira: number; satir: number; tip: number; iptal?: number }
const mikro = {
  stoklar: [] as Array<{ kod: string; guid: string }>,
  hareketler: [] as MikroHareket[],
  fiyat: [] as string[],
  barkod: [] as string[],
  kolonlar: {
    STOKLAR: ['sto_Guid', 'sto_kod', 'sto_isim'],
    STOK_HAREKETLERI: ['sth_Guid', 'sth_stok_kod', 'sth_iptal', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_satir_no', 'sth_evraktip'],
    STOK_SATIS_FIYAT_LISTELERI: ['sfiyat_Guid', 'sfiyat_stokkod', 'sfiyat_fiyati'],
    BARKOD_TANIMLARI: ['bar_Guid', 'bar_kodu', 'bar_stokkodu'],
  } as Record<string, string[]>,
  hataDeseni: null as RegExp | null,
  firlatDeseni: null as RegExp | null,
  sorgular: [] as string[],
};
const say = (kodlar: string[]): Array<{ kod: string; adet: number }> => {
  const m = new Map<string, number>();
  for (const k of kodlar) m.set(k, (m.has(k) ? Number(m.get(k)) : 0) + 1);
  return [...m].map(([kod, adet]) => ({ kod, adet })).sort((x, y) => (x.kod < y.kod ? -1 : 1));
};
const mikroSql: KuruBagimliliklari['mikroSql'] = async q => {
  mikro.sorgular.push(q);
  if (mikro.firlatDeseni?.test(q)) throw new Error('bağlantı reddedildi');
  if (mikro.hataDeseni?.test(q)) return { rows: [], hata: 'Invalid object name' };
  const sayfa = /OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY/.exec(q);
  const sayfala = <T>(r: T[]): T[] => (sayfa ? r.slice(Number(sayfa[1]), Number(sayfa[1]) + Number(sayfa[2])) : r);
  if (/FROM STOKLAR/.test(q)) return { rows: sayfala(mikro.stoklar.map(s => ({ kod: s.kod, guid: `{${s.guid.toUpperCase()}}` }))), hata: null };
  if (/GROUP BY/.test(q)) {
    if (/FROM STOK_HAREKETLERI/.test(q)) return { rows: sayfala(say(mikro.hareketler.filter(h => !h.iptal).map(h => h.kod))), hata: null };
    if (/FROM STOK_SATIS_FIYAT_LISTELERI/.test(q)) return { rows: sayfala(say(mikro.fiyat)), hata: null };
    if (/FROM BARKOD_TANIMLARI/.test(q)) return { rows: sayfala(say(mikro.barkod)), hata: null };
  }
  const inn = /WHERE sth_Guid IN \(([^)]*)\)/.exec(q);
  if (inn) {
    const istenen = new Set(inn[1].split(',').map(x => x.trim().replace(/'/g, '')));
    return { rows: mikro.hareketler.filter(h => istenen.has(h.guid)).map(h => ({ guid: h.guid.toUpperCase(), kod: h.kod })), hata: null };
  }
  if (/sth_evrakno_seri = N'/.test(q)) {
    return { rows: mikro.hareketler.map(h => ({ seri: h.seri, sira: h.sira, satir: h.satir, tip: h.tip, kod: h.kod })), hata: null };
  }
  return { rows: [], hata: `tanınmayan sorgu: ${q.slice(0, 60)}` };
};
const bag = (): KuruBagimliliklari => ({
  havuz, mikroSql, mikroKolonlar: async t => mikro.kolonlar[t] ?? [], mikroIdCozucuIds: cozucu, zamanAsimiMs: 1000,
});

const GOVDE = {
  ciftler: [
    ...['onayli1010', 'aktarim0930', 'revize0930'].map(kaynak => ({ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak })),
    { eski: 'ARGTGRİ', yeni: 'ARAGONIT-SDD-GRI-20', kaynak: 'yenikod1017' },
    { eski: 'MA-HY-003', yeni: 'APEL-HY-003', kaynak: 'onayli1010' },
    { eski: 'MA-HY-003', yeni: 'MITREAPEL-HY-003', kaynak: 'aktarim0930' },
    { eski: 'MA-HY-003', yeni: 'MITREAPEL-HY-003', kaynak: 'revize0930' },
    { eski: 'ARAG0003', yeni: 'ARAGONIT-GK-25', kaynak: 'yenikod1017' },
  ],
};
async function kosA(cid = A, aynaKullan = true, govde: unknown = GOVDE): Promise<KuruRaporu> {
  const c = kuruGovdesiniCoz(govde);
  if (!c.tamam) throw new Error(c.error);
  const r = await stokKodGocuKuruKos(bag(), { companyId: cid, aynaKullan, ciftler: c.ciftler, yokSayilan: c.yokSayilan });
  if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
  return r.rapor;
}
const hepsi = async (): Promise<string> =>
  JSON.stringify((await db.query('SELECT coll, id, data::text AS d, updated_at FROM docs ORDER BY coll, id')).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  // Ayna tablosunun bu sınamanın okuduğu kolonları (mikroMirror.ts DDL'inin alt kümesi).
  await db.exec('CREATE TABLE mikro_stoklar (sto_kod text PRIMARY KEY, veri jsonb, guncelleme timestamptz NOT NULL DEFAULT now())');
  mikro.stoklar = [
    { kod: 'AKCALI-00312', guid: g(1) }, { kod: 'ARAGONIT-SDD-GRI-20', guid: g(2) }, { kod: 'APEL-HY-003', guid: g(3) },
    { kod: 'MIKRODA-1', guid: g(4) }, { kod: 'ARAG0003', guid: g(5) },
  ];
  mikro.hareketler = [
    { guid: g(101), kod: 'AKCALI-00312', seri: 'MF', sira: 1, satir: 0, tip: 1 },        // Cetpa'da eski kodla duran hareketin güncel hâli
    { guid: g(103), kod: 'AKCALI-00312', seri: 'MF', sira: 5, satir: 0, tip: 1 },        // yetimin (g102) evrak eşi, yeni GUID
  ];
  await db.query("INSERT INTO mikro_stoklar (sto_kod, veri) VALUES ('ARGTGRİ', $1::jsonb), ('ARAGONIT-SDD-GRI-20', $1::jsonb), ('ESKI-AYNA', '{\"sto_isim\":\"x\"}'::jsonb)",
    [JSON.stringify({ sto_Guid: `{${g(2).toUpperCase()}}` })]);

  const ka = (id: string, sku: string, ek: Record<string, unknown> = {}) => koy('inventory', id, { sku, name: 'GİZLİ AD', source: 'mikro_import', companyId: A, stockLevel: 3, ...ek });
  // `location`: Y29 bulgu 3 ölçüsü (arşive giden eski kartta elle girilmiş raf konumu); `k-elle` eski kart değil, sayılmaz.
  await ka('k-eski', 'AKCALI-AKÇ.00312', { prices: { Retail: 10, Bayi: 8 }, costPrice: 4, location: 'A-3 raf', warehouseId: '  ' });
  await ka('k-yeni', 'AKCALI-00312', { source: 'mikro_cron', prices: { Retail: 12 } });
  await koy('inventory', 'k-arg', { sku: 'ARGTGRI\u0307', source: 'mikro_import' });           // etiketsiz (DH19), NFD İ
  await ka('k-argy', 'ARAGONIT-SDD-GRI-20');
  await ka('k-ma', 'MA-HY-003'); await ka('k-mitre', 'MITREAPEL-HY-003'); await ka('k-apel', 'APEL-HY-003');
  await ka('k-kars', 'RENKLENDİRME15LT');
  await ka('k-elle', 'ELLE-1', { source: 'manual', location: 'Z-9 raf', warehouseId: 'depo-9' });
  await ka('k-mikroda', 'MIKRODA-1');
  await ka('k-arag', 'ARAG0003');
  await koy('inventory', 'b-eski', { sku: 'AKCALI-AKÇ.00312', source: 'mikro_import', companyId: B });

  await koy('inventoryMovements', g(101), { sth_stok_kod: 'AKCALI-AKÇ.00312', companyId: A, source: 'mikro_sql' });
  await koy('inventoryMovements', g(102), { sth_stok_kod: 'AKCALI-AKÇ.00312', sth_evrakno_seri: 'MF', sth_evrakno_sira: 5, sth_satir_no: 0, sth_evraktip: 1, companyId: A });
  await koy('inventoryMovements', g(201), { sth_stok_kod: 'AKCALI-AKÇ.00312', companyId: B });
  await koy('orders', 'mf-a', { source: 'mikro_fatura', companyId: A, lineItems: [{ sku: 'AKCALI-AKÇ.00312\u200E', name: 'GİZLİ' }] });
  await koy('orders', 'mf-b', { source: 'mikro_fatura', companyId: B, lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] });
  await koy('warehouseItems', `mikro-${etiket(A)}-AKCALI-AKÇ.00312`, { sku: 'AKCALI-AKÇ.00312', companyId: A });
  await koy('stockDiscrepancies', 'sd-1', { productId: 'k-eski', sku: 'AKCALI-AKÇ.00312', companyId: A });
  await koy('magazaTalepleri', 'mt-1', { companyId: A, kalemler: [{ sku: 'RENKLENDİRME15LT-D002' }] });
  await koy('barkodlar', 'bar-1', { bar_stokkodu: 'AKCALI-AKÇ.00312', companyId: A });
  await koy('mikroFiyatListeleri', 'fl-1', { sfiyat_stokkod: 'MA-HY-003', companyId: A });
  await koy('shipments', 'sh-1', { companyId: A, customerName: 'x' });
}, 60_000);

afterAll(async () => { await db.close(); });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kuru koşu — kiracı A (Mikro kiracısı, ayna kanıtı açık)', () => {
  it('sınıflar: 2 kesin (hareket kanıtı / ayna GUID kanıtı), 2 doğrula (çelişkili kaynak + ara halka), 1 karşılıksız; değişmemiş 1', async () => {
    const r = await kosA();
    expect(r.siniflar).toEqual({ kesin: 2, dogrula: 2, cok_anlamli: 0, karsiliksiz: 1, degismemis: 1 });
    expect(r.satirlar.kesin.map(x => [x.eski, x.yeni, x.kanit])).toEqual([
      ['AKCALI-AKÇ.00312', 'AKCALI-00312', ['hareket', 'tablo', 'tablo_aday']], ['ARGTGRİ', 'ARAGONIT-SDD-GRI-20', ['guid', 'tablo']]]);
    expect(r.satirlar.dogrula.map(x => [x.eski, x.yeni, x.gerekce])).toEqual([
      ['MA-HY-003', 'APEL-HY-003', ['yalniz_tablo', 'kaynaklar_celisiyor']], ['MITREAPEL-HY-003', 'APEL-HY-003', ['ara_halka']]]);
    expect(r.satirlar.karsiliksiz.map(x => x.eski)).toEqual(['RENKLENDİRME15LT']);
    expect(r.satirlar.degismemis).toEqual([{ eski: 'ARAG0003', yeniler: ['ARAGONIT-GK-25'] }]);
    expect(r.degismezler.evrenToplami).toEqual({ tamam: true, siniflarToplami: 5, evren: 5 });
  });

  it('DH6 / DH19 evren: B\'nin aynı kodlu kartı YOK, etiketsiz kart VAR (ayrı sayılır), elle açılmış kart dışarıda', async () => {
    const r = await kosA();
    expect(r.evren).toEqual({ kart: 5, kod: 5, etiketsizKart: 1, mikroDisiKaynak: 1, skusuz: 0, toplamKart: 11 });
    expect(r.satirlar.kesin[0].kartlar).toEqual(['k-eski']);
    expect(r.satirlar.kesin[1].etiketsizKart).toBe(1);
  });

  it('DH1 bağlı kayıt: yalnız A\'nın belgeleri; alan yolları tablodan; alanı olmayan koleksiyon «okunmadı»', async () => {
    const r = await kosA();
    const bagli = Object.fromEntries(Object.entries(r.bagliKayit).map(([c, v]) => [c, v.bagliBelge]));
    expect(bagli).toMatchObject({ orders: 1, inventoryMovements: 2, warehouseItems: 1, stockDiscrepancies: 1, magazaTalepleri: 1, barkodlar: 1, mikroFiyatListeleri: 1, quotations: 0 });
    expect(r.bagliKayit.warehouseItems.alanBasina).toEqual({ sku: 1, '(kimlik)': 1 });
    expect(r.okunanAlanlar.orders).toEqual(['lineItems[].sku', 'lineItems[].inventoryId']);
    expect(r.okunanAlanlar.barkodlar).toEqual(['bar_stokkodu']);           // kolon adı Mikro şemasından
    expect(r.okunmadi).toEqual(['shipments', 'vehicles']);
    expect(r.satirlar.kesin[0].bagli).toEqual({ orders: 1, inventoryMovements: 2, warehouseItems: 1, stockDiscrepancies: 1, barkodlar: 1 });
    expect(r.satirlar.karsiliksiz[0].bagli).toEqual({ magazaTalepleri: 1 });
  });

  it('DH2 · yetim (GUID Mikro\'da yok) ve evrak eşi Mikro\'da yeni GUID\'le var → yeni koda YAZILMAZ, listelenir', async () => {
    const r = await kosA();
    expect(r.kanitOlcumu.hareket).toEqual({ okundu: true, neden: null, cetpaHareket: 2, guidli: 2, mikrodaBulunan: 1, koduDegisen: 1, yetim: 1, kanit: 1 });
    expect(r.mikroYetim).toEqual({ eskiKodlu: 1, kesildi: false, evrakDenetimi: null, liste: [{ id: g(102), eski: 'AKCALI-AKÇ.00312', evrakEsiMikroda: true, mikroKodu: 'AKCALI-00312' }] });
    expect(r.mikro.eskiKoddaSayim.hareket).toEqual({ olculdu: true, neden: null, toplamSatir: 2, eskiKodlu: 0 });
  });

  it('ayna ölçüsü: satır, GUID\'li satır, aynı GUID\'li çift, GUID anahtar adları (değer yok)', async () => {
    const r = await kosA();
    expect(r.kanitOlcumu.ayna).toEqual({ okundu: true, neden: null, satir: 3, guidliSatir: 2, ayniGuidGrubu: 1, ayniGuidCifti: 1, guidAnahtarlari: { sto_Guid: 2 }, kanit: 1 });
    expect(r.kiraci.aynaKanitiKullanildi).toBe(true);
  });

  it('plan: kalan kart yeni kodlu ikiz; arşive giden eski kart; yeniden yazılacak belge (aynalar + mağaza HARİÇ); fiyat kademesi adı', async () => {
    const r = await kosA();
    expect(r.planOzeti.satirlar.find(p => p.eski === 'AKCALI-AKÇ.00312')).toEqual({
      eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', sinif: 'kesin', kalanKart: 'k-yeni', kalanKartSayisi: 1, arsiveGiden: ['k-eski'],
      belge: { orders: 1, inventoryMovements: 2, warehouseItems: 1, stockDiscrepancies: 1 }, fiyatKademeFarki: ['Bayi'] });
    expect(r.planOzeti.kesin).toEqual({ cift: 2, arsiveGidenKart: 2, kalanKartsiz: 0, belge: { orders: 1, inventoryMovements: 2, warehouseItems: 1, stockDiscrepancies: 1 }, toplamBelge: 5 });
    expect(r.planOzeti.ortakHedef).toEqual([{ yeni: 'APEL-HY-003', eskiler: ['MA-HY-003', 'MITREAPEL-HY-003'] }]);
    expect(r.planOzeti.pasif).toEqual({ kod: 1, kart: 1 });
    // Y29 bulgu 3: arşive giden eski kartlarda dolu raf konumu / depo SAYISI (boşluk dolu sayılmaz; eski olmayan kart sayılmaz).
    expect(r.eskiKartElleAlan).toEqual({ location: 1, warehouseId: 0 });
    expect(JSON.stringify(r)).not.toContain('A-3 raf');
    expect(r.degismezler.ayniSkuOnce).toEqual([]);
    expect(r.degismezler.uzunHedef).toEqual([]);
  });

  it('yanıtta ürün ADI yok; hiçbir belge yazılmadı (içerik ve damga aynı)', async () => {
    const once = await hepsi();
    const r = await kosA();
    expect(JSON.stringify(r)).not.toMatch(/GİZLİ/);
    expect(await hepsi()).toBe(once);
  });
});

describe('DH13 · ayna kiracısız: çalışma kiracısı Mikro kiracısı değilse ayna kanıtı YOK SAYILIR', () => {
  it('aynı veri, `aynaKullan: false` → ARGTGRİ `dogrula` (`yalniz_tablo`); ölçü yine raporlanır', async () => {
    const r = await kosA(A, false);
    expect(r.satirlar.dogrula.find(x => x.eski === 'ARGTGRİ')?.gerekce).toEqual(['yalniz_tablo']);
    expect(r.kanitOlcumu.ayna).toMatchObject({ okundu: true, kanit: 0, guidliSatir: 2 });
    expect(r.kanitOlcumu.ayna.neden).toMatch(/DH13/);
    expect(r.kiraci.aynaKanitiKullanildi).toBe(false);
  });

  it('kiracı B: yalnız B\'nin kartı ve belgeleri (A\'nınkiler sayılmaz)', async () => {
    const r = await kosA(B, false);
    expect(r.evren).toMatchObject({ kart: 2, kod: 2, etiketsizKart: 1 });     // B'nin kartı + etiketsiz kart (DH19: her kiracıda dâhil)
    const k = [...r.satirlar.kesin, ...r.satirlar.dogrula].find(x => x.eski === 'AKCALI-AKÇ.00312');
    expect(k?.kartlar).toEqual(['b-eski']);
    expect(r.bagliKayit.orders.bagliBelge).toBe(1);
    expect(r.bagliKayit.inventoryMovements.bagliBelge).toBe(1);
    expect(r.bagliKayit.warehouseItems.bagliBelge).toBe(0);
  });
});

describe('DH16 · imza', () => {
  it('saatlik senkronun yazdığı alanlar (stockLevel / costPrice / mikroSyncedAt) imzayı DEĞİŞTİRMEZ; eski kodlu yeni sipariş DEĞİŞTİRİR', async () => {
    const once = (await kosA()).planImza;
    expect((await kosA()).planImza).toBe(once);
    await db.query(`UPDATE docs SET data = data || '{"stockLevel": 99, "costPrice": 7, "mikroSyncedAt": "2026-11-05T10:00:00Z"}'::jsonb WHERE coll = 'inventory' AND id IN ('k-eski', 'k-yeni')`);
    expect((await kosA()).planImza).toBe(once);
    await koy('orders', 'yeni-sip', { companyId: A, lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] });
    try {
      expect((await kosA()).planImza).not.toBe(once);
    } finally {
      await sil('orders', 'yeni-sip');
    }
    expect((await kosA()).planImza).toBe(once);
  });
});

describe('Mikro okuma hatası: sahte kesinlik yok', () => {
  it('STOKLAR okunamazsa / boş dönerse kuru koşu 502 (hiçbir sınıf hesaplanmaz)', async () => {
    mikro.hataDeseni = /FROM STOKLAR/;
    try {
      const c = kuruGovdesiniCoz(GOVDE);
      if (!c.tamam) throw new Error(c.error);
      expect(await stokKodGocuKuruKos(bag(), { companyId: A, aynaKullan: true, ciftler: c.ciftler, yokSayilan: c.yokSayilan })).toMatchObject({ tamam: false, durum: 502 });
    } finally { mikro.hataDeseni = null; }
    const yedek = mikro.stoklar;
    mikro.stoklar = [];
    try {
      expect(await stokKodGocuKuruKos(bag(), { companyId: A, aynaKullan: true, ciftler: [], yokSayilan: { ayniKod: 0, tekrar: 0 } }))
        .toEqual({ tamam: false, durum: 502, error: 'Mikro STOKLAR boş döndü; kuru koşu yapılmadı.' });
    } finally { mikro.stoklar = yedek; }
  });

  it('DH2 sayımı okunamazsa (hata ya da fırlatma) o ölçü «ölçülemedi», çift `kesin` OLAMAZ', async () => {
    mikro.firlatDeseni = /GROUP BY sth_stok_kod/;
    try {
      const r = await kosA();
      expect(r.mikro.eskiKoddaSayim.hareket).toMatchObject({ olculdu: false, eskiKodlu: null });
      expect(r.siniflar.kesin).toBe(0);
      expect(r.satirlar.dogrula.find(x => x.eski === 'AKCALI-AKÇ.00312')?.gerekce).toEqual(['mikro_olcum_yok_hareket']);
    } finally { mikro.firlatDeseni = null; }
  });

  it('DH2 · Mikro\'da eski kodla duran hareket → çift `dogrula` (`mikro_hareket_eski_kodda`)', async () => {
    mikro.hareketler.push({ guid: g(104), kod: 'AKCALI-AKÇ.00312', seri: 'X', sira: 9, satir: 0, tip: 1 });
    try {
      const r = await kosA();
      expect(r.mikro.eskiKoddaSayim.hareket.eskiKodlu).toBe(1);
      expect(r.satirlar.dogrula.find(x => x.eski === 'AKCALI-AKÇ.00312')?.gerekce).toEqual(['mikro_hareket_eski_kodda']);
    } finally { mikro.hareketler.pop(); }
  });

  it('Mikro kolon adı tahmin edilmez: barkod tablosunda stok kodu kolonu yoksa barkod sayımı ölçülmez, Cetpa `barkodlar` okunmaz', async () => {
    const yedek = mikro.kolonlar.BARKOD_TANIMLARI;
    mikro.kolonlar.BARKOD_TANIMLARI = ['bar_Guid', 'bar_kodu'];
    try {
      const r = await kosA();
      expect(r.mikro.eskiKoddaSayim.barkod).toMatchObject({ olculdu: false, neden: 'BARKOD_TANIMLARI şemasında stok kodu kolonu bulunamadı' });
      expect(r.okunmadi).toContain('barkodlar');
      expect(r.siniflar.kesin).toBe(0);
    } finally { mikro.kolonlar.BARKOD_TANIMLARI = yedek; }
  });
});

// İnceleme MBS #4 (2026-11-05): uç senkron, IIS ARR ~120 sn'de keser; her okumanın kendi zaman aşımı 120 sn olduğu için «ölçülemedi»li
// kısmi rapor istemciye hiç ulaşamıyordu. Toplam süre sınırı: her okuma kalan süreyle sınırlanır, süre dolunca okuma Mikro'ya gitmez.
describe('MBS #4 · toplam süre sınırı: kısmi rapor sınır içinde döner', () => {
  it('STOKLAR dışındaki Mikro okumaları çağrı sınırına kadar ASILI, çağrı sınırı 5 sn, toplamSureMs 300 → koşu < 2,5 sn\'de `tamam`; üç sayım ve hareket kanıtı «kuru koşu süre sınırı doldu»; sahte kesinlik yok', async () => {
    const asiliCagrilar: number[] = [];
    const asili: KuruBagimliliklari['mikroSql'] = (q, o) => {
      if (/FROM STOKLAR/.test(q)) return mikroSql(q, o);
      const sinir = o?.zamanAsimiMs;
      if (sinir === undefined) throw new Error('çağrı sınırı verilmedi');
      asiliCagrilar.push(sinir);
      // `AbortSignal.timeout` gibi: yanıt gelmez, sınırda TimeoutError (ret birkaç ms sonra ulaşır).
      return new Promise((_, reddet) => setTimeout(() => reddet(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), sinir + 5));
    };
    // Şema okuması (`mikroKolonlar`) çağrıya süre ALAMAZ (global 30 sn): süre dolduktan sonra hiç çağrılmamalı.
    const semaOkunan: string[] = [];
    const c = kuruGovdesiniCoz(GOVDE);
    if (!c.tamam) throw new Error(c.error);
    const t0 = Date.now();
    const r = await stokKodGocuKuruKos({
      ...bag(), mikroSql: asili, zamanAsimiMs: 5_000, toplamSureMs: 300,
      mikroKolonlar: async t => { semaOkunan.push(t); return mikro.kolonlar[t] ?? []; },
    }, { companyId: A, aynaKullan: true, ciftler: c.ciftler, yokSayilan: c.yokSayilan });
    const gecen = Date.now() - t0;
    if (!r.tamam) throw new Error(`${r.durum} ${r.error}`);
    // Sınırsız koşu: 3 sayım × 5 sn + GUID öbeği ≥ 15 sn. Tek bir çağrı sınırına (5 sn) bile ulaşılmadı.
    expect(gecen).toBeLessThan(2_500);
    // Asılı okuma TEK: hareket sayımı süreyi tüketti; fiyat / barkod / hareket kanıtı Mikro'ya hiç gitmedi (şema dâhil).
    expect(asiliCagrilar).toHaveLength(1);
    expect(asiliCagrilar[0]).toBeLessThanOrEqual(300);
    expect(semaOkunan).toEqual(['STOKLAR', 'STOK_HAREKETLERI']);
    const { hareket, fiyat, barkod } = r.rapor.mikro.eskiKoddaSayim;
    for (const o of [hareket, fiyat, barkod]) expect(o).toMatchObject({ olculdu: false, neden: KURU_SURE_DOLDU, eskiKodlu: null });
    expect(r.rapor.kanitOlcumu.hareket.okundu).toBe(false);
    expect(String(r.rapor.kanitOlcumu.hareket.neden)).toContain(KURU_SURE_DOLDU);
    // Ölçülemeyen Mikro sayımı kesinlik üretmez (D0): hiçbir çift `kesin` değil.
    expect(r.rapor.siniflar.kesin).toBe(0);
  }, 30_000);

  it('süre şema okumasında dolarsa sonraki SQL Mikro\'ya GİTMEZ: STOKLAR sorgusu gönderilmeden 502 «… kuru koşu süre sınırı doldu»', async () => {
    const gonderilen: string[] = [];
    const sayan: KuruBagimliliklari['mikroSql'] = (q, o) => { gonderilen.push(q); return mikroSql(q, o); };
    const r = await stokKodGocuKuruKos({
      ...bag(), mikroSql: sayan, toplamSureMs: 30,
      // Şema yanıtı 60 ms sürer (süre içinde başladı, dışında bitti).
      mikroKolonlar: async t => { await new Promise(coz => setTimeout(coz, 60)); return mikro.kolonlar[t] ?? []; },
    }, { companyId: A, aynaKullan: true, ciftler: [], yokSayilan: { ayniKod: 0, tekrar: 0 } });
    expect(r).toEqual({ tamam: false, durum: 502, error: `Mikro STOKLAR okunamadı: ${KURU_SURE_DOLDU}` });
    expect(gonderilen).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('eksik teslim sınamaları (paket turu)', () => {
  it('kiracı süzgecinin JS yarısı tek başına: SQL süzgeci olmayan havuzda bile B\'nin kartı / siparişi / hareketi A\'ya girmez', async () => {
    // SQL'deki `companyId` koşulunu düşüren havuz: motorun ikinci (JS) denetimi `dc && dc !== cid` yabancı kiracıyı yine eler.
    const suzgecsiz: KuruPgHavuzu = {
      async query(sql, params = []) {
        if (sql.includes("COALESCE(data->>'companyId', '') IN ($2, '')")) {
          const r = await db.query<Record<string, unknown>>('SELECT id, data FROM docs WHERE coll = $1', [params[0]]);
          return { rows: r.rows };
        }
        return havuz.query(sql, params);
      },
    };
    const c = kuruGovdesiniCoz(GOVDE);
    if (!c.tamam) throw new Error(c.error);
    const r = await stokKodGocuKuruKos({ ...bag(), havuz: suzgecsiz }, { companyId: A, aynaKullan: true, ciftler: c.ciftler, yokSayilan: c.yokSayilan });
    if (!r.tamam) throw new Error(r.error);
    expect(r.rapor.evren).toMatchObject({ kart: 5, kod: 5, toplamKart: 11 });
    expect(r.rapor.satirlar.kesin[0].kartlar).toEqual(['k-eski']);
    expect([r.rapor.bagliKayit.orders.bagliBelge, r.rapor.bagliKayit.inventoryMovements.bagliBelge]).toEqual([1, 2]);
  });

  it('değişmez · 25 karakteri aşan hedef kod `uzunHedef`te listelenir (Mikro `sto_kod` sınırı)', async () => {
    const UZUN = 'UZUN-HEDEF-KODU-26-KARAKTER';
    mikro.stoklar.push({ kod: UZUN, guid: g(9) });
    await koy('inventory', 'k-uzun', { sku: 'UZUN-ESKI', source: 'mikro_import', companyId: A });
    try {
      const r = await kosA(A, true, [...GOVDE.ciftler, { eski: 'UZUN-ESKI', yeni: UZUN, kaynak: 'onayli1010' }]);
      expect(r.degismezler.uzunHedef).toEqual([{ eski: 'UZUN-ESKI', yeni: UZUN, uzunluk: UZUN.length }]);
      expect(UZUN.length).toBeGreaterThan(25);
    } finally {
      mikro.stoklar.pop();
      await sil('inventory', 'k-uzun');
    }
  });

  it('DH18 · `/` içeren eski kodun depo belgesi import kimliğiyle (`/` → `_`) ve eski biçimle (`mikro-<kod>`) sayılır', async () => {
    await koy('inventory', 'k-made', { sku: 'MADE/002', source: 'mikro_import', companyId: A });
    await koy('inventory', 'k-0014', { sku: '000014/2', source: 'mikro_import', companyId: A });
    await koy('warehouseItems', `mikro-${etiket(A)}-MADE_002`, { sku: 'MADE/002', companyId: A });
    await koy('warehouseItems', 'mikro-000014_2', { sku: 'DEPO-SKU-ESKIMIS', companyId: A });     // eski kimlik biçimi (kiracı etiketi yok)
    try {
      const r = await kosA();
      expect(r.bagliKayit.warehouseItems.alanBasina).toEqual({ sku: 2, '(kimlik)': 3 });
      const satir = r.satirlar.karsiliksiz.find(x => x.eski === '000014/2');
      expect(satir?.bagli).toEqual({ warehouseItems: 1 });
    } finally {
      for (const [c, id] of [['inventory', 'k-made'], ['inventory', 'k-0014'], ['warehouseItems', `mikro-${etiket(A)}-MADE_002`], ['warehouseItems', 'mikro-000014_2']]) await sil(c, id);
    }
  });

  it('7. adım · kartı Mikro dışı kaynaklı olarak DURAN eski kod kartsız sayılmaz (MKD2 delta)', async () => {
    const { rows } = await db.query<{ data: Record<string, unknown> }>("SELECT data FROM docs WHERE coll = 'inventory' AND id = 'k-eski'");
    const eskiKart = rows[0].data;
    await koy('inventory', 'k-eski', { ...eskiKart, source: 'manual' });
    try {
      const r = await kosA();
      expect(r.kartsizBagli).toEqual([]);
      expect(r.kartsizKimlikOlculmedi).toEqual([]);
    } finally { await koy('inventory', 'k-eski', eskiKart); }
  });

  it('7. adım · kartı SİLİNMİŞ eski kodun bağlı kayıtları yine sayılır (`kartsizBagli`); Mikro\'da duran eski kod sayılmaz', async () => {
    const ilk = await kosA();
    expect(ilk.kartsizBagli).toEqual([]);                                  // kart varken satırın `bagli`sında; kartsız liste boş
    expect(ilk.kartsizKimlikOlculmedi).toEqual([]);                        // kartsız kod yok: ölçülmeyen kimlik yolu da yok
    const { rows } = await db.query<{ data: Record<string, unknown> }>("SELECT data FROM docs WHERE coll = 'inventory' AND id = 'k-eski'");
    const eskiKart = rows[0].data;
    await sil('inventory', 'k-eski');                                       // D4 sonrası: eski kart kaldırıldı, bağlı belgeler duruyor
    await koy('orders', 'sip-degismemis', { companyId: A, lineItems: [{ sku: 'ARAG0003' }] });   // ARAG0003 Mikro'da: eski kod DEĞİL
    try {
      const r = await kosA();
      expect(r.satirlar.kesin.map(x => x.eski)).not.toContain('AKCALI-AKÇ.00312');
      expect(r.kartsizBagli).toEqual([{ kod: 'AKCALI-AKÇ.00312', bagli: { orders: 1, inventoryMovements: 2, warehouseItems: 1, stockDiscrepancies: 1, barkodlar: 1 } }]);
      expect(r.bagliKayit.orders.bagliBelge).toBe(1);
      expect(r.bagliKayit.warehouseItems.alanBasina).toEqual({ sku: 1, '(kimlik)': 1 });   // koddan türeyen kimlik de (DH18)
      expect(r.bagliKayit.stockDiscrepancies.alanBasina).toEqual({ sku: 1, productId: 0 }); // kart kimliği yok: yalnız dizgi
      expect(r.kartsizKimlikOlculmedi).toContain('stockDiscrepancies.productId');   // «0» değil «ölçülmedi» (MKD2 delta)
      const imza = r.planImza;
      await koy('orders', 'sip-kartsiz', { companyId: A, lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] });
      expect((await kosA()).planImza).not.toBe(imza);                     // DH16: bağlı kayıt kimlik kümesi imzada
    } finally {
      await koy('inventory', 'k-eski', eskiKart);
      await sil('orders', 'sip-degismemis');
      await sil('orders', 'sip-kartsiz');
    }
  });
});
