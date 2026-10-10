// @vitest-environment node
/**
 * magazaDurum.pglite.test.ts — yazma işlevlerinin GERÇEK PostgreSQL motorunda sınanması (dilim 2a, V10, § 7 «Yazma işlevi»).
 *
 * `@electric-sql/pglite` (PostgreSQL WASM; yerel derleme yok). Kapının iki engelleyicisi (geçmiş girişinin sessizce silinmesi)
 * yalnız gerçek jsonb işleçleriyle göründü; sahte havuz bunu sınayamaz. Örnek DOSYA başına bir kez kurulur (`beforeAll`,
 * ~1–2 sn); testler arasında `DELETE FROM docs`. Tablo DDL'i `src/server/docsSema.ts`'ten (kopya yok; server.ts aynı sabiti kurar).
 *
 * Gerçek motor testleri TEK dosyada toplanır: aşama / açıklama (§ 2.1–2.8), kalem teslim (§ 2.9), elle bildirim (§ 2.10),
 * etiket (§ 2.11), bekçi / ops sayımları (§ 6: açık talep sayımı `magazaAcikSayim.ts`, bildirim sayımının yaşı `opsWatchdog.ts`)
 * + kaynak çitleri (SQL metni, parametre sırası, kapalı yama kümesi, denetim gövdesi, `pglite` içe aktarım yasağı).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { kaynakDosyalari, kodSatirlari, oku as dosyaOku, SRC_KOK, suclular } from '../../test/kaynakTarama';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_DURUM_GECMISI_SINIRI, MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_UTC_ZAMAN_DESENI, magazaAcikMi,
  magazaAsamasiMi, magazaGuncellemeZamani, magazaKalemTeslimMi, magazaTeslimIsaretsiz,
} from '../../lib/magazaTalep';
import { magazaAcikSayimi } from './magazaAcikSayim';
import type { MagazaAcikSayimi } from './magazaAcikSayim';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';
import {
  BILDIRIM_OKU_SQL, BILDIRIM_YENIDEN_SQL, DURUM_ACIKLAMA_SQL, DURUM_GECIS_SQL, DURUM_OKU_SQL, ETIKET_BASILDI_SQL, KALEM_OKU_SQL,
  KALEM_TESLIM_SQL, MAGAZA_ACIK_SQL,
  bildirimiYenidenKuyrugaAl, etiketBasildiYaz, kalemTeslimYaz, talepDurumunuDegistir,
} from './magazaDurum';
import type { KalemTeslimGirdisi, MagazaDurumDeps } from './magazaDurum';

type Satir = Record<string, unknown>;
const COLL = MAGAZA_TALEP_KOLEKSIYONU;
const CID = 'kiraci-1';
const SAAT = new Date('2026-10-09T12:00:00.000Z');
const KIM = { uid: 'u-personel', ad: 'Ayşe Yılmaz', eposta: 'ayse@example.com' };

let db: PGlite;
let sayac = 0;
const havuz: MagazaPgHavuzu = {
  async query(sql, params = []) {
    sayac += 1;
    const r = await db.query<Satir>(sql, params as unknown[]);
    return { rows: r.rows };
  },
};
/** İlk eşleşen sorgudan SONRA `araya`yı koşturan havuz (okuma ile yazma arasına giren başka yazımı taklit eder). */
function arayaGiren(secici: (sql: string) => boolean, araya: () => Promise<void>): MagazaPgHavuzu {
  let yapildi = false;
  return {
    async query(sql, params) {
      const sonuc = await havuz.query(sql, params);
      if (!yapildi && secici(sql)) { yapildi = true; await araya(); }
      return sonuc;
    },
  };
}

function deps(ek: Partial<MagazaDurumDeps> = {}) {
  const yayin = vi.fn<MagazaDurumDeps['broadcastDocChange']>();
  const denetim = vi.fn<MagazaDurumDeps['writeAuditLog']>(async () => undefined);
  const iste = vi.fn<MagazaDurumDeps['bildirimIste']>(async () => undefined);
  const D: MagazaDurumDeps = { getPgPool: () => havuz, broadcastDocChange: yayin, writeAuditLog: denetim, bildirimIste: iste, simdi: () => SAAT, ...ek };
  return { D, yayin, denetim, iste };
}

let sira = 0;
const kimlik = (): string => `mt-${String(++sira).padStart(32, '0')}`;
function taban(ek: Satir = {}): Satir {
  return {
    companyId: CID, talepNo: 'T261009-AB12', durum: 'sevk', durumSurum: 3, olusturma: '2026-10-09T09:00:00.000Z',
    durumZamani: '2026-10-09T10:00:00.000Z', durumAciklama: 'Kargoya verildi', musteri: { ad: 'GİZLİ MÜŞTERİ', telefon: '0532 111 22 33' },
    telefonSon10: '5321112233', not: 'gizli not', kalemler: [{ ad: 'x', adet: 1, sku: 'S1', talepFiyat: 9 }, { ad: 'y', adet: 2 }, { ad: 'z', adet: 3 }],
    talepEdilen: { araToplam: 100, kdv: 20, toplam: 120 }, bildirim: { durum: 'gitti', zaman: '2026-10-09T09:00:01.000Z' }, ...ek,
  };
}
async function talep(ek: Satir = {}, id = kimlik()): Promise<string> {
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [COLL, id, JSON.stringify(taban(ek))]);
  return id;
}
async function belge(id: string): Promise<Satir> {
  const r = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, id]);
  return r.rows[0].data;
}
const sahte = (ek: Partial<MagazaDurumDeps> = {}) => deps(ek).D;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DELETE FROM docs'); sayac = 0; });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('talepDurumunuDegistir — aşama / açıklama (§ 2.1–2.8)', () => {
  it('ileri geçiş: durum, durumZamani (toISOString), durumSurum +1, geçmişe TEK giriş; yayınlanan belge RETURNING satırı; denetim diff elle', async () => {
    const id = await talep();
    const { D, yayin, denetim } = deps();
    const s = await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.durum).toBe('teslim');
    expect(b.durumSurum).toBe(4);
    expect(b.durumZamani).toBe(SAAT.toISOString());
    expect(MAGAZA_UTC_ZAMAN_DESENI.test(String(b.durumZamani))).toBe(true);
    expect(b.durumGecmisi).toEqual([{ onceki: 'sevk', yeni: 'teslim', zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad }, kanal: 'erp' }]);
    expect(b.durumGecmisiDusen).toBe(0);
    expect(b.durumAciklama).toBe('Kargoya verildi');   // açıklama gönderilmedi → KORUNDU (V7)
    expect(b.bildirim).toEqual({ durum: 'gitti', zaman: '2026-10-09T09:00:01.000Z' });
    if (s.sonuc === 'tamam') expect(s.belge).toEqual(b);
    expect(yayin).toHaveBeenCalledTimes(1);
    expect(yayin.mock.calls[0]).toEqual([COLL, 'set', id, b, { cid: CID }]);
    expect(denetim).toHaveBeenCalledTimes(1);
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi durumu', 'T261009-AB12 · erp · açıklama yok', { durum: { from: 'sevk', to: 'teslim' } }]);
  });
  it('bayat `onceki` ile ileri / geri / açıklama → gecis-yok + güncel aşama; belge DEĞİŞMEZ; sorgu yalnız okuma', async () => {
    const id = await talep();
    const once = await belge(id);
    for (const [onceki, yeni] of [['hazirlaniyor', 'sevk'], ['teslim', 'sevk'], ['teyit', 'teyit']] as const) {
      sayac = 0;
      const s = await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki, surum: 3, yeni, aciklama: 'x', kim: KIM, kanal: 'panel' });
      expect(s, `${onceki} → ${yeni}`).toEqual({ sonuc: 'gecis-yok', durum: 'sevk' });
      expect(sayac).toBe(1);
    }
    expect(await belge(id)).toEqual(once);
  });
  it('aynı aşamada bayat `surum` ile açıklama → gecis-yok; saklı açıklama değişmez (kapı 2 S-A)', async () => {
    const id = await talep();
    const s = await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 2, yeni: 'sevk', aciklama: 'panel notu', kim: KIM, kanal: 'panel' });
    expect(s).toEqual({ sonuc: 'gecis-yok', durum: 'sevk' });
    expect((await belge(id)).durumAciklama).toBe('Kargoya verildi');
  });
  it('aynı aşamada iki eşzamanlı okuma + iki açıklama yazımı → tam biri tamam, öbürü gecis-yok', async () => {
    const id = await talep();
    const [a, b] = await Promise.all([
      talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'sevk', aciklama: 'A notu', kim: KIM, kanal: 'erp' }),
      talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'sevk', aciklama: 'B notu', kim: KIM, kanal: 'panel' }),
    ]);
    expect([a.sonuc, b.sonuc].sort()).toEqual(['gecis-yok', 'tamam']);
    const son = await belge(id);
    expect(son.durumSurum).toBe(4);
    expect(['A notu', 'B notu']).toContain(son.durumAciklama);
  });
  it('A-B-A dönüşü: bayat sürümle yazım gecis-yok; geçmiş boyu korunur', async () => {
    const id = await talep({ durum: 'hazirlaniyor', durumSurum: 0 });
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'hazirlaniyor', surum: 0, yeni: 'sevk', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 1, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    // Ekran ilk hâli (hazirlaniyor, sürüm 0) gösteriyor: aşama tutuyor, sürüm tutmuyor → gecis-yok
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'hazirlaniyor', surum: 0, yeni: 'sevk', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: 'hazirlaniyor' });
    const b = await belge(id);
    expect((b.durumGecmisi as unknown[]).length).toBe(2);
    expect(b.durumSurum).toBe(2);
  });
  it('55 geçiş → geçmiş 50, `durumGecmisiDusen` 5, sırası korunur (en eskiler düşer)', async () => {
    const id = await talep({ durum: 'yeni', durumSurum: 0 });
    let onceki: 'yeni' | 'teyit' = 'yeni';
    for (let i = 0; i < 55; i++) {
      const yeni: 'yeni' | 'teyit' = onceki === 'yeni' ? 'teyit' : 'yeni';
      const s = await talepDurumunuDegistir(sahte({ simdi: () => new Date(SAAT.getTime() + i * 1000) }), { id, companyId: CID, onceki, surum: i, yeni, kim: KIM, kanal: 'erp' });
      expect(s.sonuc, `geçiş ${i}`).toBe('tamam');
      onceki = yeni;
    }
    const b = await belge(id);
    const gecmis = b.durumGecmisi as Array<{ zaman: string }>;
    expect(gecmis).toHaveLength(MAGAZA_DURUM_GECMISI_SINIRI);
    expect(b.durumGecmisiDusen).toBe(5);
    expect(gecmis[0].zaman).toBe(new Date(SAAT.getTime() + 5 * 1000).toISOString());
    expect(gecmis[49].zaman).toBe(new Date(SAAT.getTime() + 54 * 1000).toISOString());
    expect(b.durumSurum).toBe(55);
  });
  it('dizi olmayan `durumGecmisi` / sayı olmayan sayaç → hata yok, boş dizi + 0 sayılır', async () => {
    const id = await talep({ durumGecmisi: 'çöp', durumGecmisiDusen: 'çöp' });
    const s = await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect((b.durumGecmisi as unknown[]).length).toBe(1);
    expect(b.durumGecmisiDusen).toBe(0);
  });
  it('başka kiracı → bulunamadi; bozuk kimlik → sorgu 0; bilinmeyen saklı aşama → gecis-yok + null, belge değişmez', async () => {
    const id = await talep();
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: 'kiraci-2', onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'bulunamadi' });
    sayac = 0;
    expect(await talepDurumunuDegistir(sahte(), { id: 'mt-bozuk', companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'bulunamadi' });
    expect(sayac).toBe(0);
    const id2 = await talep({ durum: 'onaylandi' });
    const once = await belge(id2);
    expect(await talepDurumunuDegistir(sahte(), { id: id2, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: null });
    expect(await belge(id2)).toEqual(once);
  });
  it('araya giren bildirim yazımı aşama yazımını DÜŞÜRMEZ ve `bildirim: gitti` korunur (yama bildirim taşımaz)', async () => {
    const id = await talep({ bildirim: { durum: 'bekliyor', zaman: '2026-10-09T09:00:01.000Z' } });
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query("UPDATE docs SET data = jsonb_set(data, '{bildirim}', $3::jsonb) WHERE coll = $1 AND id = $2", [COLL, id, JSON.stringify({ durum: 'gitti', zaman: SAAT.toISOString() })]);
    });
    const s = await talepDurumunuDegistir(sahte({ getPgPool: () => h }), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.bildirim).toEqual({ durum: 'gitti', zaman: SAAT.toISOString() });
    expect(b.durum).toBe('teslim');
  });
  it('açıklama: yokken korunur; `""` siler (denetim «silindi», diff yok); yalnız boşluk da siler; `undefined` + aynı aşama → gecis-yok, yazım yok', async () => {
    const id = await talep();
    const { D, denetim } = deps();
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'sevk', aciklama: '', kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    expect((await belge(id)).durumAciklama).toBe('');
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi durumu', 'T261009-AB12 · panel · açıklama silindi']);
    expect(denetim.mock.calls[0]).toHaveLength(3);
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 4, yeni: 'sevk', aciklama: 'Yarın teslim', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect(denetim.mock.calls[1]?.[2]).toBe('T261009-AB12 · erp · açıklama güncellendi');
    expect(denetim.mock.calls[1]).toHaveLength(3);
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 5, yeni: 'sevk', aciklama: ' \t ', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await belge(id)).durumAciklama).toBe('');
    sayac = 0;
    expect(await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 6, yeni: 'sevk', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: 'sevk' });
    expect(sayac).toBe(1);
    expect((await belge(id)).durumSurum).toBe(6);
    // geçiş + açıklama birlikte: «açıklama var»
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 6, yeni: 'teslim', aciklama: 'Teslim edildi', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect(denetim.mock.calls[2]?.[2]).toBe('T261009-AB12 · erp · açıklama silindi');   // yalnız boşluk da «silindi»
    expect(denetim.mock.calls[3]?.[2]).toBe('T261009-AB12 · erp · açıklama var');
    expect(denetim.mock.calls[3]?.[3]).toEqual({ durum: { from: 'sevk', to: 'teslim' } });
    expect((await belge(id)).durumAciklama).toBe('Teslim edildi');
  });
  it('satır sonlu 600 birimlik açıklama tek satır ve 500 birim yazılır; durumZamani her açıklama yazımında ilerler', async () => {
    const id = await talep();
    const ham = ('ğ'.repeat(99) + '\n').repeat(6);
    const sonra = new Date(SAAT.getTime() + 60_000);
    expect((await talepDurumunuDegistir(sahte({ simdi: () => sonra }), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'sevk', aciklama: ham, kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    const b = await belge(id);
    const yazilan = String(b.durumAciklama);
    expect(yazilan.length).toBe(500);
    expect(yazilan).not.toMatch(/[\n\r]/);
    expect(b.durumZamani).toBe(sonra.toISOString());
    expect(b.durumSurum).toBe(4);
    expect((b.durumGecmisi ?? [])).toEqual([]);   // yalnız açıklama geçmişe GİRMEZ (V9)
  });
  it('iptal: `iptalOncesi` yazılır; iptalden dönüşte açıkça `null`; `teslim` → `iptal` izinsiz; yeniden iptal üzerine yazar', async () => {
    const id = await talep({ durum: 'hazirlaniyor', durumSurum: 0 });
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'hazirlaniyor', surum: 0, yeni: 'iptal', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await belge(id)).iptalOncesi).toBe('hazirlaniyor');
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'iptal', surum: 1, yeni: 'sevk', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: 'iptal' });
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'iptal', surum: 1, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.iptalOncesi).toBeNull();
    expect('iptalOncesi' in b).toBe(true);
    expect(b.durum).toBe('hazirlaniyor');
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'hazirlaniyor', surum: 2, yeni: 'sevk', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'iptal', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await belge(id)).iptalOncesi).toBe('sevk');
    const id2 = await talep({ durum: 'teslim' });
    expect(await talepDurumunuDegistir(sahte(), { id: id2, companyId: CID, onceki: 'teslim', surum: 3, yeni: 'iptal', kim: KIM, kanal: 'panel' })).toEqual({ sonuc: 'gecis-yok', durum: 'teslim' });
  });
  it('iptalOncesi çöpse (`teslim`) iptalden dönüş izinsiz; aynı aşama yazımı iptalOncesi\'ne dokunmaz', async () => {
    const id = await talep({ durum: 'iptal', iptalOncesi: 'teslim', durumSurum: 0 });
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'iptal', surum: 0, yeni: 'teslim', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: 'iptal' });
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'iptal', surum: 0, yeni: 'iptal', aciklama: 'iptal notu', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await belge(id)).iptalOncesi).toBe('teslim');
  });
  it('yayın arızası ve denetim arızası yazımı GERİ ALMAZ; kiracısız satır yayınlanmaz', async () => {
    const id = await talep();
    const s = await talepDurumunuDegistir(sahte({ broadcastDocChange: () => { throw new Error('akış yok'); }, writeAuditLog: async () => { throw new Error('denetim yok'); } }),
      { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    expect((await belge(id)).durum).toBe('teslim');
  });
  it('havuz yoksa FIRLATIR (rota 503 döner, işlev çağrılmaz)', async () => {
    const id = await talep();
    await expect(talepDurumunuDegistir(sahte({ getPgPool: () => null }), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' })).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kalemTeslimYaz — kalem teslim işareti (§ 2.9)', () => {
  const G = (ek: Partial<KalemTeslimGirdisi> & { id: string }): KalemTeslimGirdisi => ({ companyId: CID, surum: 3, teslim: true, kalemler: ['b:1'], kim: KIM, kanal: 'panel', ...ek });

  it('[b:1] teslim → tamam; giriş kim / zaman dolu; b:0 / b:2 YOK; durumSurum +1; diğer alanlar DEĞİŞMEZ; kalemler alan alan eşit (V16)', async () => {
    const id = await talep();
    const once = await belge(id);
    const { D, yayin, denetim } = deps();
    const s = await kalemTeslimYaz(D, G({ id }));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.kalemTeslim).toEqual({ 'b:1': { durum: 'teslim', zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad } } });
    expect(b.durumSurum).toBe(4);
    for (const alan of ['durum', 'durumZamani', 'durumAciklama', 'iptalOncesi', 'bildirim', 'kalemler', 'musteri', 'talepEdilen', 'olusturma', 'durumGecmisi', 'icerikSurum', 'teyit'])
      expect(b[alan], alan).toEqual(once[alan]);
    expect(magazaKalemTeslimMi(b.kalemTeslim, 'b:1')).toBe(true);
    expect(magazaTeslimIsaretsiz(b)).toBe(2);
    expect(magazaGuncellemeZamani({ olusturma: String(b.olusturma), durumZamani: b.durumZamani, kalemTeslim: b.kalemTeslim })).toBe(SAAT.toISOString());
    expect(b.durumZamani).toBe('2026-10-09T10:00:00.000Z');
    if (s.sonuc === 'tamam') expect(s.belge).toEqual(b);
    expect(yayin.mock.calls[0]).toEqual([COLL, 'set', id, b, { cid: CID }]);
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi kalem teslimi', 'T261009-AB12 · panel · beyan · işaretlendi 1 / kaldırıldı 0']);
  });
  it('geri alma: aynı kalem `teslim: false` → bekliyor girişi kaldıranın kim / zamanıyla, giriş SİLİNMEZ', async () => {
    const id = await talep({ kalemTeslim: { 'b:1': { durum: 'teslim', zaman: '2026-10-09T11:00:00.000Z', kim: { uid: 'u-eski', ad: 'Eski' } } } });
    const { D, denetim } = deps();
    expect((await kalemTeslimYaz(D, G({ id, teslim: false, kanal: 'erp' }))).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.kalemTeslim).toEqual({ 'b:1': { durum: 'bekliyor', zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad } } });
    expect(magazaKalemTeslimMi(b.kalemTeslim, 'b:1')).toBe(false);
    expect(denetim.mock.calls[0]?.[2]).toBe('T261009-AB12 · erp · beyan · işaretlendi 0 / kaldırıldı 1');
    expect(magazaGuncellemeZamani({ olusturma: String(b.olusturma), durumZamani: b.durumZamani, kalemTeslim: b.kalemTeslim })).toBe(SAAT.toISOString());
  });
  it('`hepsi` → üç anahtar teslim, TEK yazım, durumSurum +1 (3 değil); `hepsi` + false → üç bekliyor (K3)', async () => {
    const id = await talep();
    sayac = 0;
    expect((await kalemTeslimYaz(sahte(), G({ id, kalemler: 'hepsi' }))).sonuc).toBe('tamam');
    expect(sayac).toBe(2);   // dar okuma + tek UPDATE
    let b = await belge(id);
    expect(Object.keys(b.kalemTeslim as object).sort()).toEqual(['b:0', 'b:1', 'b:2']);
    expect(Object.values(b.kalemTeslim as Record<string, { durum: string }>).every(g => g.durum === 'teslim')).toBe(true);
    expect(b.durumSurum).toBe(4);
    expect(magazaTeslimIsaretsiz(b)).toBe(0);
    expect(b.durum).toBe('sevk');   // aşama kendiliğinden teslim OLMAZ
    expect((await kalemTeslimYaz(sahte(), G({ id, kalemler: 'hepsi', teslim: false, surum: 4 }))).sonuc).toBe('tamam');
    b = await belge(id);
    expect(Object.values(b.kalemTeslim as Record<string, { durum: string; kim: { uid: string } }>).every(g => g.durum === 'bekliyor' && g.kim.uid === KIM.uid)).toBe(true);
    expect(b.durumSurum).toBe(5);
    expect(magazaTeslimIsaretsiz(b)).toBe(3);
  });
  it('sürüm çakışması: bayat sürüm → gecis-yok + güncel aşama, hiçbir şey değişmez; aşama ve kalem yazımı AYNI sayacı paylaşır', async () => {
    const id = await talep();
    const once = await belge(id);
    expect(await kalemTeslimYaz(sahte(), G({ id, surum: 2 }))).toEqual({ sonuc: 'gecis-yok', durum: 'sevk' });
    expect(await belge(id)).toEqual(once);
    // aşama yazımı araya girince (sürüm +1) bekleyen kalem yazımı gecis-yok
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'teslim', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    });
    expect(await kalemTeslimYaz(sahte({ getPgPool: () => h }), G({ id }))).toEqual({ sonuc: 'gecis-yok', durum: 'teslim' });
    expect((await belge(id)).kalemTeslim).toBeUndefined();
    // kalem yazımından SONRA eski sürümle aşama yazımı → gecis-yok
    expect((await kalemTeslimYaz(sahte(), G({ id, surum: 4 }))).sonuc).toBe('tamam');
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teslim', surum: 4, yeni: 'sevk', kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecis-yok', durum: 'teslim' });
    // aynı sürümle iki eşzamanlı kalem yazımı → ikincisi gecis-yok
    const [a, c] = await Promise.all([kalemTeslimYaz(sahte(), G({ id, surum: 5, kalemler: ['b:0'] })), kalemTeslimYaz(sahte(), G({ id, surum: 5, kalemler: ['b:2'] }))]);
    expect([a.sonuc, c.sonuc].sort()).toEqual(['gecis-yok', 'tamam']);
    expect((await belge(id)).durumSurum).toBe(6);
  });
  it('kaynak değişimi yarışı (K6): araya içerik yazımı (icerikSurum +1, teyit) girince → surum-eski; hayalet b: işareti YAZILMAZ; durumSurum artmaz', async () => {
    const id = await talep();
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query(`UPDATE docs SET data = data || '{"icerikSurum": 1, "teyit": {"kalemler": [{"anahtar": "t:aaaaaaaaaaaa"}]}}' WHERE coll = $1 AND id = $2`, [COLL, id]);
    });
    expect(await kalemTeslimYaz(sahte({ getPgPool: () => h }), G({ id, kalemler: ['b:0'] }))).toEqual({ sonuc: 'surum-eski' });
    const b = await belge(id);
    expect(b.kalemTeslim).toBeUndefined();
    expect(b.durumSurum).toBe(3);
    expect(b.icerikSurum).toBe(1);
    // kalem yazımı icerikSurum'u ARTIRMAZ, yalnız koşul olarak okur: teyit kaynağında t: anahtarıyla yazım
    expect((await kalemTeslimYaz(sahte(), G({ id, kalemler: ['t:aaaaaaaaaaaa'] }))).sonuc).toBe('tamam');
    const c = await belge(id);
    expect(c.icerikSurum).toBe(1);
    expect(c.durumSurum).toBe(4);
    expect(Object.keys(c.kalemTeslim as object)).toEqual(['t:aaaaaaaaaaaa']);
    // teyit kaynağındayken b: anahtarı öbür kaynağındır → gecersiz
    expect(await kalemTeslimYaz(sahte(), G({ id, surum: 4, kalemler: ['b:0'] }))).toEqual({ sonuc: 'gecersiz' });
  });
  it('bilinmeyen kalem: aralık dışı / öbür kaynak / yinelenen / karışık liste → gecersiz, HİÇBİR anahtar yazılmaz, durumSurum artmaz', async () => {
    const id = await talep();
    const once = await belge(id);
    for (const kalemler of [['b:3'], ['t:0123456789ab'], ['b:0', 'b:0'], ['b:0', 'b:7'], ['b:01'], ['c:0']]) {
      expect(await kalemTeslimYaz(sahte(), G({ id, kalemler })), JSON.stringify(kalemler)).toEqual({ sonuc: 'gecersiz' });
    }
    expect(await belge(id)).toEqual(once);
    sayac = 0;
    expect(await kalemTeslimYaz(sahte(), G({ id, kalemler: [] }))).toEqual({ sonuc: 'gecersiz' });
    expect(sayac).toBe(0);
    expect(await kalemTeslimYaz(sahte(), G({ id: 'mt-ffffffffffffffffffffffffffffffff' }))).toEqual({ sonuc: 'bulunamadi' });
    expect(await kalemTeslimYaz(sahte(), G({ id, companyId: 'kiraci-2' }))).toEqual({ sonuc: 'bulunamadi' });
    sayac = 0;
    expect(await kalemTeslimYaz(sahte(), G({ id: 'mt-bozuk' }))).toEqual({ sonuc: 'bulunamadi' });
    expect(sayac).toBe(0);
    // kalemsiz (dizi olmayan) belge: `hepsi` → kaynak boş → gecersiz
    const id2 = await talep({ kalemler: 'çöp' });
    expect(await kalemTeslimYaz(sahte(), G({ id: id2, kalemler: 'hepsi' }))).toEqual({ sonuc: 'gecersiz' });
  });
  it('aşama: `iptal` → gecis-yok iptal; bilinmeyen → null; `yeni` ve `teslim` İZİNLİ', async () => {
    const iptal = await talep({ durum: 'iptal' });
    const once = await belge(iptal);
    expect(await kalemTeslimYaz(sahte(), G({ id: iptal }))).toEqual({ sonuc: 'gecis-yok', durum: 'iptal' });
    expect(await belge(iptal)).toEqual(once);
    const bilinmeyen = await talep({ durum: 'onaylandi' });
    expect(await kalemTeslimYaz(sahte(), G({ id: bilinmeyen }))).toEqual({ sonuc: 'gecis-yok', durum: null });
    for (const durum of ['yeni', 'teyit', 'hazirlaniyor', 'teslim']) {
      const id = await talep({ durum });
      expect((await kalemTeslimYaz(sahte(), G({ id }))).sonuc, durum).toBe('tamam');
    }
  });
  it('aşama ilişkisi: teslim geçişi işaretsizi İŞARETLEMEZ; geri alma / iptal / iptalden dönüş kalemTeslim\'e DOKUNMAZ; üçü işaretliyken sevk KALIR', async () => {
    const id = await talep();
    expect((await kalemTeslimYaz(sahte(), G({ id, kalemler: ['b:0'] }))).sonuc).toBe('tamam');
    const isaret = (await belge(id)).kalemTeslim;
    expect(magazaTeslimIsaretsiz(await belge(id))).toBe(2);
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 4, yeni: 'teslim', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect(magazaTeslimIsaretsiz(await belge(id))).toBe(2);
    expect((await belge(id)).kalemTeslim).toEqual(isaret);
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teslim', surum: 5, yeni: 'sevk', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'sevk', surum: 6, yeni: 'iptal', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'iptal', surum: 7, yeni: 'sevk', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await belge(id)).kalemTeslim).toEqual(isaret);
    expect((await kalemTeslimYaz(sahte(), G({ id, surum: 8, kalemler: 'hepsi' }))).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(magazaTeslimIsaretsiz(b)).toBe(0);
    expect(b.durum).toBe('sevk');
  });
  it('çöp `kalemTeslim` (dizge / sayı / dizi) `{}` sayılır; araya giren bildirim yazımı düşürmez, gitti korunur; yayın RETURNING', async () => {
    for (const cop of ['çöp', 7, ['b:0']]) {
      const id = await talep({ kalemTeslim: cop });
      const { D, yayin } = deps();
      const s = await kalemTeslimYaz(D, G({ id }));
      expect(s.sonuc, String(cop)).toBe('tamam');
      const b = await belge(id);
      expect(Object.keys(b.kalemTeslim as object)).toEqual(['b:1']);
      expect(yayin.mock.calls[0]?.[3]).toEqual(b);
      expect(MAGAZA_UTC_ZAMAN_DESENI.test((b.kalemTeslim as Record<string, { zaman: string }>)['b:1'].zaman)).toBe(true);
    }
    const id = await talep({ bildirim: { durum: 'bekliyor', zaman: '2026-10-09T09:00:01.000Z' } });
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query("UPDATE docs SET data = jsonb_set(data, '{bildirim}', $3::jsonb) WHERE coll = $1 AND id = $2", [COLL, id, JSON.stringify({ durum: 'gitti', zaman: SAAT.toISOString() })]);
    });
    expect((await kalemTeslimYaz(sahte({ getPgPool: () => h }), G({ id }))).sonuc).toBe('tamam');
    expect((await belge(id)).bildirim).toEqual({ durum: 'gitti', zaman: SAAT.toISOString() });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('bildirimiYenidenKuyrugaAl — elle «Yeniden gönder» (§ 2.10, V22)', () => {
  const G = (id: string, companyId = CID) => ({ id, companyId, tur: 'ilk' as const, kim: KIM });

  it('gonderilemedi + deneme + hataSinifi → bildirim TAM OLARAK { bekliyor, zaman }; sürüm / durum* / kalemTeslim / kalemler eşit; kuyruk 1 kez, yayın, denetim', async () => {
    const id = await talep({ bildirim: { durum: 'gonderilemedi', zaman: '2026-10-09T09:05:00.000Z', deneme: 3, hataSinifi: 'diger' }, kalemTeslim: { 'b:0': { durum: 'teslim', zaman: '2026-10-09T11:00:00.000Z', kim: { uid: 'u', ad: 'U' } } } });
    const once = await belge(id);
    const { D, yayin, denetim, iste } = deps();
    const s = await bildirimiYenidenKuyrugaAl(D, G(id));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.bildirim).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString() });
    for (const alan of ['durum', 'durumSurum', 'durumZamani', 'durumAciklama', 'kalemTeslim', 'kalemler', 'musteri', 'icerikSurum']) expect(b[alan], alan).toEqual(once[alan]);
    expect(iste).toHaveBeenCalledTimes(1);
    expect(iste).toHaveBeenCalledWith(id);
    expect(iste.mock.invocationCallOrder[0]).toBeLessThan(yayin.mock.invocationCallOrder[0]);
    expect(yayin.mock.calls[0]).toEqual([COLL, 'set', id, b, { cid: CID }]);
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi bildirimi elle kuyruğa alındı', 'T261009-AB12 · erp']);
    if (s.sonuc === 'tamam') expect(s.belge).toEqual(b);
  });
  it('yapilandirilmamis → aynı; süresi geçmiş bekliyor → zaman yenilenir; alan yok / çöp → yazılır (jsonb_set yoktan yaratır)', async () => {
    for (const bildirim of [{ durum: 'yapilandirilmamis', zaman: '2026-10-09T09:05:00.000Z' }, { durum: 'bekliyor', zaman: '2026-10-09T08:00:00.000Z', deneme: 8 }, undefined, 'çöp']) {
      const id = await talep(bildirim === undefined ? { bildirim: undefined } : { bildirim });
      expect((await bildirimiYenidenKuyrugaAl(sahte(), G(id))).sonuc, JSON.stringify(bildirim)).toBe('tamam');
      expect((await belge(id)).bildirim).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString() });
    }
  });
  it('gitti → zaten-gitti (0 satır; kuyruk / yayın / denetim YOK); dar okuma ile yazım arasına giren işçi `gitti` yazımı da zaten-gitti', async () => {
    const id = await talep();
    const { D, yayin, denetim, iste } = deps();
    expect(await bildirimiYenidenKuyrugaAl(D, G(id))).toEqual({ sonuc: 'zaten-gitti' });
    expect(iste).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled();
    expect((await belge(id)).bildirim).toEqual({ durum: 'gitti', zaman: '2026-10-09T09:00:01.000Z' });
    // yarış: ilk UPDATE 0 satır (işçi tam o anda gitti yazdı) → dar okuma gitti görür
    const id2 = await talep({ bildirim: { durum: 'bekliyor', zaman: '2026-10-09T08:00:00.000Z' } });
    let ilk = true;
    const yarisli: MagazaPgHavuzu = {
      async query(sql, params) {
        if (ilk && sql.startsWith('UPDATE')) {
          ilk = false;
          await db.query("UPDATE docs SET data = jsonb_set(data, '{bildirim}', '{\"durum\":\"gitti\",\"zaman\":\"z\"}') WHERE coll = $1 AND id = $2", [COLL, id2]);
        }
        return havuz.query(sql, params);
      },
    };
    expect(await bildirimiYenidenKuyrugaAl(sahte({ getPgPool: () => yarisli }), G(id2))).toEqual({ sonuc: 'zaten-gitti' });
  });
  it('başka kiracı → bulunamadi; bozuk kimlik → sorgu 0; kuyruğa ekleme fırlatsa da yazım geri alınmaz ve tamam döner', async () => {
    const id = await talep({ bildirim: { durum: 'gonderilemedi', zaman: 'z' } });
    expect(await bildirimiYenidenKuyrugaAl(sahte(), G(id, 'kiraci-2'))).toEqual({ sonuc: 'bulunamadi' });
    expect((await belge(id)).bildirim).toEqual({ durum: 'gonderilemedi', zaman: 'z' });
    sayac = 0;
    expect(await bildirimiYenidenKuyrugaAl(sahte(), G('mt-bozuk'))).toEqual({ sonuc: 'bulunamadi' });
    expect(sayac).toBe(0);
    const s = await bildirimiYenidenKuyrugaAl(sahte({ bildirimIste: async () => { throw new Error('kuyruk yok'); } }), G(id));
    expect(s.sonuc).toBe('tamam');
    expect((await belge(id)).bildirim).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString() });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('etiketBasildiYaz — «Etiket basıldı» (§ 2.11, V23)', () => {
  it('{} → etiketBasildi TAM OLARAK { zaman, kim: { uid, panel: true } }; { koli: 3 }; ikinci basış üstüne yazar (önceki koli taşınmaz); sürümler eşit', async () => {
    const id = await talep({ kalemTeslim: { 'b:0': { durum: 'teslim', zaman: 'z', kim: { uid: 'u', ad: 'U' } } } });
    const once = await belge(id);
    const { D, yayin, denetim } = deps();
    const s = await etiketBasildiYaz(D, { id, companyId: CID, kim: { uid: 'u-panel' } });
    expect(s.sonuc).toBe('tamam');
    const beklenen = { zaman: SAAT.toISOString(), kim: { uid: 'u-panel', panel: true } };
    if (s.sonuc === 'tamam') { expect(s.etiketBasildi).toEqual(beklenen); expect(s.belge).toEqual(await belge(id)); }
    let b = await belge(id);
    expect(b.etiketBasildi).toEqual(beklenen);
    for (const alan of ['durum', 'durumSurum', 'durumZamani', 'durumAciklama', 'icerikSurum', 'kalemTeslim', 'kalemler', 'bildirim']) expect(b[alan], alan).toEqual(once[alan]);
    expect(yayin.mock.calls[0]).toEqual([COLL, 'set', id, b, { cid: CID }]);
    expect(denetim).not.toHaveBeenCalled();
    const sonra = new Date(SAAT.getTime() + 5000);
    expect((await etiketBasildiYaz(sahte({ simdi: () => sonra }), { id, companyId: CID, koli: 3, kim: { uid: 'u-panel' } })).sonuc).toBe('tamam');
    b = await belge(id);
    expect(b.etiketBasildi).toEqual({ zaman: sonra.toISOString(), koli: 3, kim: { uid: 'u-panel', panel: true } });
    expect((await etiketBasildiYaz(sahte(), { id, companyId: CID, kim: { uid: 'u-2' } })).sonuc).toBe('tamam');
    b = await belge(id);
    expect(b.etiketBasildi).toEqual({ zaman: SAAT.toISOString(), kim: { uid: 'u-2', panel: true } });
    expect(b.durumSurum).toBe(3);
    expect(magazaGuncellemeZamani({ olusturma: String(b.olusturma), durumZamani: b.durumZamani, kalemTeslim: b.kalemTeslim })).toBe('2026-10-09T10:00:00.000Z');
  });
  it('iptal ve teslim aşamasında da yazılır; başka kiracı → bulunamadi; bozuk kimlik → sorgu 0; çöp koli FIRLATIR (şema süzer)', async () => {
    for (const durum of ['iptal', 'teslim', 'yeni']) {
      const id = await talep({ durum });
      expect((await etiketBasildiYaz(sahte(), { id, companyId: CID, kim: { uid: 'u' } })).sonuc, durum).toBe('tamam');
    }
    const id = await talep();
    expect(await etiketBasildiYaz(sahte(), { id, companyId: 'kiraci-2', kim: { uid: 'u' } })).toEqual({ sonuc: 'bulunamadi' });
    expect((await belge(id)).etiketBasildi).toBeUndefined();
    sayac = 0;
    expect(await etiketBasildiYaz(sahte(), { id: 'mt-bozuk', companyId: CID, kim: { uid: 'u' } })).toEqual({ sonuc: 'bulunamadi' });
    expect(sayac).toBe(0);
    for (const koli of [0, -1, 1.5, Number.NaN]) await expect(etiketBasildiYaz(sahte(), { id, companyId: CID, koli, kim: { uid: 'u' } }), String(koli)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('bekçi / ops sayımları gerçek motorda — açık talep sayımı ve bildirim sayımının yaşı (§ 6)', () => {
  /** Tabandan bağımsız ham ekleme (alanı HİÇ olmayan / çöp değerli satır için). */
  let hamSira = 0;
  async function ham(data: Satir, coll = COLL): Promise<string> {
    const id = `mt-${'f'.repeat(24)}${String(++hamSira).padStart(8, '0')}`;
    await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [coll, id, JSON.stringify(data)]);
    return id;
  }
  const acikSay = async (): Promise<MagazaAcikSayimi | null> => magazaAcikSayimi({ query: (sql, params) => db.query<Satir>(sql, params) });

  it('boş tablo: satır yine döner — açık 0, dağılım 0, en eski null', async () => {
    expect(await acikSay()).toEqual({ toplam: 0, asama: { yeni: 0, teyit: 0, hazirlaniyor: 0, sevk: 0, bilinmiyor: 0 }, tarihsiz: 0, enEski: null });
  });

  it('açıklık ölçütü `magazaAcikMi` ile AYNI: teslim / iptal kapalı; dört açık aşama açık; aşamasız / null / bilinmeyen / dizge olmayan / boş aşama AÇIK ve «bilinmiyor»; başka koleksiyon sayılmaz', async () => {
    const T = '2026-10-09T09:00:00.000Z';
    const durumlar: unknown[] = ['yeni', 'yeni', 'teyit', 'hazirlaniyor', 'sevk', 'teslim', 'teslim', 'iptal', null, 'kargoda', 5, '', 'TESLIM', { a: 1 }];
    for (const durum of durumlar) await ham({ companyId: CID, durum, olusturma: T });
    await ham({ companyId: CID, olusturma: T });                               // `durum` alanı HİÇ yok (dilim 1 öncesi biçim)
    await ham({ companyId: 'kiraci-2', durum: 'yeni', olusturma: T });         // kiracı süzgeci yok: bekçinin bildirim sayımıyla aynı evren
    await ham({ companyId: CID, durum: 'yeni', olusturma: T }, 'orders');      // başka koleksiyon
    const s = await acikSay();
    expect(s).toEqual({ toplam: 13, asama: { yeni: 3, teyit: 1, hazirlaniyor: 1, sevk: 1, bilinmiyor: 7 }, tarihsiz: 0, enEski: T });
    // JS ölçütüyle çapraz denetim: saklı değer kapalı kümede değilse aşama `null`dır ve `magazaAcikMi(null)` AÇIK der.
    const jsAcik = [...durumlar, undefined, 'yeni'].filter(d => magazaAcikMi(magazaAsamasiMi(d) ? d : null)).length;
    expect(s?.toplam).toBe(jsAcik);
    // Dağılımın toplamı açık sayısına eşit (tek ifade, tek anlık görüntü).
    expect(Object.values(s?.asama ?? {}).reduce((a, b) => a + b, 0)).toBe(s?.toplam);
    // Panel listesinin ölçütü AYNI sabit: aynı tabloda `MAGAZA_ACIK_SQL` ile sayılan satır sayısı eşit.
    const liste = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM docs WHERE coll = $1 AND ${MAGAZA_ACIK_SQL}`, [COLL]);
    expect(liste.rows[0].n).toBe(s?.toplam);
  });

  it('en eski açık = AÇIK taleplerin en küçük `olusturma`sı: daha eski KAPALI talep girmez; biçimsiz / eksik `olusturma` girmez ve `tarihsiz` sayılır', async () => {
    await ham({ durum: 'sevk', olusturma: '2026-10-03T08:00:00.000Z' });
    await ham({ durum: 'yeni', olusturma: '2026-10-01T07:30:00.000Z' });        // en eski AÇIK
    await ham({ durum: 'teyit', olusturma: '2026-10-09T11:59:59.999Z' });
    await ham({ durum: 'teslim', olusturma: '2026-09-01T00:00:00.000Z' });      // daha eski ama KAPALI
    await ham({ durum: 'iptal', olusturma: '2026-08-01T00:00:00.000Z' });
    // Bayt sırasında her gerçek zamandan «küçük» çıkan ama zaman OLMAYAN değerler: süzülmeseydi «en eski» bunlardan biri olurdu.
    for (const bozuk of ['', '0', '2020-bozuk', '2026-09-01T09:00:00Z', '2026-09-30T12:00:00.000+03:00', 1759900000000, null]) await ham({ durum: 'yeni', olusturma: bozuk });
    await ham({ durum: 'yeni' });                                               // `olusturma` alanı yok
    const s = await acikSay();
    expect(s?.enEski).toBe('2026-10-01T07:30:00.000Z');
    expect(s?.tarihsiz).toBe(8);
    expect(s?.toplam).toBe(11);
  });

  it('açıkların hiçbirinin tarihi okunamıyorsa en eski `null` (uydurma tarih yok), `tarihsiz` = açık sayısı', async () => {
    await ham({ durum: 'yeni', olusturma: '08.10.2026 09:00' });
    await ham({ durum: 'sevk' });
    await ham({ durum: 'teslim', olusturma: '2026-10-01T07:30:00.000Z' });      // biçimli ama KAPALI: en eskiye girmez
    expect(await acikSay()).toMatchObject({ toplam: 2, tarihsiz: 2, enEski: null });
  });

  it('kalem teslim işareti ve «etiket basıldı» açık sayısını da en eski açığın yaşını da DEĞİŞTİRMEZ; `teslim`e geçiş düşürür, geri alma geri getirir (gerçek yazma işlevleri)', async () => {
    const id = await talep({ durum: 'sevk', olusturma: '2026-10-02T09:00:00.000Z' });
    await talep({ durum: 'yeni', olusturma: '2026-10-08T09:00:00.000Z' });
    const once = await acikSay();
    expect(once).toEqual({ toplam: 2, asama: { yeni: 1, teyit: 0, hazirlaniyor: 0, sevk: 1, bilinmiyor: 0 }, tarihsiz: 0, enEski: '2026-10-02T09:00:00.000Z' });
    const { D } = deps();
    // Üç kalemin üçü de işaretli + etiket basıldı: talep aşaması `teslim` olana kadar AÇIKTIR (V6); yaş `olusturma`dan.
    expect((await kalemTeslimYaz(D, { id, companyId: CID, surum: 3, teslim: true, kalemler: 'hepsi', kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    expect((await etiketBasildiYaz(D, { id, companyId: CID, koli: 2, kim: { uid: 'u-panel' } })).sonuc).toBe('tamam');
    expect(magazaTeslimIsaretsiz(await belge(id))).toBe(0);
    expect(await acikSay()).toEqual(once);
    // Aşama `teslim` olunca düşer (en eski açık öbür talebe geçer); geri alınca (teslim → sevk) geri gelir.
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 4, yeni: 'teslim', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect(await acikSay()).toMatchObject({ toplam: 1, asama: { yeni: 1, sevk: 0 }, enEski: '2026-10-08T09:00:00.000Z' });
    expect((await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'teslim', surum: 5, yeni: 'sevk', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect(await acikSay()).toEqual(once);
  });

  it('bekçinin bildirim sayımı: elle «Yeniden gönder» `bildirim.zaman`ı tazelese de yaş `olusturma`dan ölçülür — 1 günlük talep «bekleyen» kalır, 8 günlük talep «eski gitmeyen» kalır (kapı 4, Y2)', async () => {
    // Bekçi modülü gerçek zinciriyle yüklenir (başka taklit yok); yalnız SQL üreticisi kullanılır, bekçi koşturulmaz.
    const { magazaTalepSayimSql } = await import('../opsWatchdog');
    const simdi = SAAT.getTime();
    const GUN = 86_400_000;
    const iso = (ms: number): string => new Date(ms).toISOString();
    // Bekçinin parametreleri (opsWatchdog.magazaTalep.test.ts kilitler): koleksiyon · 24 saat · bekleme eşiği · üst sınır (+5 dk) · kırmızı penceresi (7 gün).
    const say = async (): Promise<Satir> => (await db.query<Satir>(magazaTalepSayimSql('bildirim'), [
      COLL, iso(simdi - GUN), iso(simdi - MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS), iso(simdi + 5 * 60_000), iso(simdi - 7 * GUN),
    ])).rows[0];
    const birGunluk = await talep({ olusturma: iso(simdi - GUN - 3_600_000), bildirim: { durum: 'gonderilemedi', zaman: iso(simdi - GUN), deneme: 3, hataSinifi: 'baglanti' } });
    const sekizGunluk = await talep({ olusturma: iso(simdi - 8 * GUN), bildirim: { durum: 'gonderilemedi', zaman: iso(simdi - 8 * GUN), deneme: 3, hataSinifi: 'diger' } });
    await talep({ olusturma: iso(simdi - 2 * 60_000), bildirim: { durum: 'bekliyor', zaman: iso(simdi - 2 * 60_000) } });   // taze bekleyen: hiçbir sütuna düşmez
    expect(await say()).toEqual({ toplam: 3, son24: 1, gonderilemedi: 1, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 1 });
    // Elle «Yeniden gönder»: iki talep de `{ durum: 'bekliyor', zaman: ŞİMDİ }` olur.
    const { D } = deps();
    for (const id of [birGunluk, sekizGunluk]) expect((await bildirimiYenidenKuyrugaAl(D, { id, companyId: CID, tur: 'ilk', kim: KIM })).sonuc).toBe('tamam');
    expect((await belge(birGunluk)).bildirim).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString() });
    // `bildirim.zaman` ŞİMDİ olsa da: 1 günlük talep taze SAYILMAZ (bekleyen 1 — bekçi susmaz), 8 günlük talep pencereden eski kalır (bilgi).
    expect(await say()).toEqual({ toplam: 3, son24: 1, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 1, eski_gitmeyen: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kaynak çitleri — SQL metni, parametre sırası, kapalı yama kümesi, denetim gövdesi, pglite yasağı', () => {
  const DOSYA = join(SRC_KOK, 'server', 'kanal', 'magazaDurum.ts');
  const kod = kodSatirlari(DOSYA).map(s => s.kod).join('\n');

  it('dar okumalar: musteri / not / talepEdilen / bildirim* SELECT metninde YOK; kalem okuması teyit->kalemler, beyan sayısı ve icerikSurum çeker', () => {
    for (const sql of [DURUM_OKU_SQL, KALEM_OKU_SQL]) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/musteri|'not'|talepEdilen|bildirim|durumGecmisi|SELECT data FROM|SELECT \*/);
      expect(sql).toContain("data->>'companyId' = $3");
    }
    expect(DURUM_OKU_SQL).toContain("COALESCE(data->>'durumSurum', '0') AS surum");
    expect(DURUM_OKU_SQL).toContain("data->'iptalOncesi' AS iptal_oncesi");
    expect(KALEM_OKU_SQL).toContain("COALESCE(data->>'icerikSurum', '0') AS icerik_surum");
    expect(KALEM_OKU_SQL).toContain("data->'teyit'->'kalemler' AS teyit_kalemleri");
    expect(KALEM_OKU_SQL).toContain("jsonb_array_length(data->'kalemler')");
    expect(BILDIRIM_OKU_SQL).toBe(`SELECT data->'bildirim'->>'durum' AS durum FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`);
  });
  it('iki aşama sabiti: koşul kiracı + okunan durum + okunan sürüm; geçmiş SQL içinde (sınır − 1 + yeni giriş); `now()` yalnız updated_at', () => {
    expect(DURUM_ACIKLAMA_SQL).toBe(`UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND data->>'durum' = $5 AND COALESCE(data->>'durumSurum', '0') = $6 RETURNING data`);
    expect(DURUM_GECIS_SQL).toMatch(/^UPDATE docs SET data = \(data \|\| \$4::jsonb\) \|\| jsonb_build_object\('durumGecmisi', /);
    expect(DURUM_GECIS_SQL).toContain(`LIMIT ${MAGAZA_DURUM_GECMISI_SINIRI - 1}`);
    expect(DURUM_GECIS_SQL).toContain("|| jsonb_build_array($5::jsonb), 'durumGecmisiDusen',");
    expect(DURUM_GECIS_SQL).toContain("jsonb_typeof(data->'durumGecmisi') = 'array'");
    expect(DURUM_GECIS_SQL).toContain("jsonb_typeof(data->'durumGecmisiDusen') = 'number'");
    expect(DURUM_GECIS_SQL).toMatch(/WHERE coll = \$1 AND id = \$2 AND data->>'companyId' = \$3 AND data->>'durum' = \$6 AND COALESCE\(data->>'durumSurum', '0'\) = \$7 RETURNING data$/);
    for (const sql of [DURUM_ACIKLAMA_SQL, DURUM_GECIS_SQL, KALEM_TESLIM_SQL, BILDIRIM_YENIDEN_SQL, ETIKET_BASILDI_SQL]) {
      expect((sql.match(/UPDATE /g) ?? []).length, sql.slice(0, 40)).toBe(1);
      expect((sql.match(/now\(\)/g) ?? []).length, sql.slice(0, 40)).toBe(1);
      expect(sql).toContain('updated_at = now()');
      expect(sql).not.toContain('durumZamani');   // zaman uygulamada toISOString ile; SQL damgalamaz
      expect(sql).toMatch(/RETURNING data$/);
    }
  });
  it('`KALEM_TESLIM_SQL`: $4 yama, $5 işaret nesnesi, $6 durumSurum, $7 icerikSurum; kalemTeslim nesne koruması metinde', () => {
    expect(KALEM_TESLIM_SQL).toBe(`UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('kalemTeslim', (CASE WHEN jsonb_typeof(data->'kalemTeslim') = 'object' THEN data->'kalemTeslim' ELSE '{}'::jsonb END) || $5::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $6 AND COALESCE(data->>'icerikSurum', '0') = $7 RETURNING data`);
  });
  it('`BILDIRIM_YENIDEN_SQL`: jsonb_set {bildirim} + jsonb_build_object + IS DISTINCT FROM gitti; `ETIKET_BASILDI_SQL`: jsonb_set {etiketBasildi}, aşama / sürüm koşulu YOK', () => {
    expect(BILDIRIM_YENIDEN_SQL).toBe(`UPDATE docs SET data = jsonb_set(data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $4::text)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND (data->'bildirim'->>'durum') IS DISTINCT FROM 'gitti' RETURNING data`);
    expect(ETIKET_BASILDI_SQL).toBe(`UPDATE docs SET data = jsonb_set(data, '{etiketBasildi}', $4::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 RETURNING data`);
    expect(ETIKET_BASILDI_SQL).not.toMatch(/durum'|durumSurum|icerikSurum/);
    expect(MAGAZA_ACIK_SQL).toBe(`COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal')`);
  });
  it('yama anahtar kümesi KAPALI (havuz gözlemi): geçişte durum / durumZamani / durumSurum (+ iptalOncesi, durumAciklama); açıklamada üç anahtar; kalemde yalnız durumSurum; etikette yalnız { zaman, koli?, kim }', async () => {
    const yamalar: Array<{ sql: string; params: unknown[] }> = [];
    const gozlem: MagazaPgHavuzu = { async query(sql, params) { if (sql.startsWith('UPDATE')) yamalar.push({ sql, params: params ?? [] }); return havuz.query(sql, params); } };
    const D = sahte({ getPgPool: () => gozlem });
    const id = await talep({ durum: 'hazirlaniyor', durumSurum: 0 });
    await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'hazirlaniyor', surum: 0, yeni: 'iptal', aciklama: 'n', kim: KIM, kanal: 'erp' });
    await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'iptal', surum: 1, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' });
    await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'hazirlaniyor', surum: 2, yeni: 'hazirlaniyor', aciklama: 'm', kim: KIM, kanal: 'erp' });
    await kalemTeslimYaz(D, { id, companyId: CID, surum: 3, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'erp' });
    await etiketBasildiYaz(D, { id, companyId: CID, koli: 2, kim: { uid: 'u' } });
    await bildirimiYenidenKuyrugaAl(D, { id, companyId: CID, tur: 'ilk', kim: KIM });
    const anahtarlar = (i: number, p = 3): string[] => Object.keys(JSON.parse(String(yamalar[i].params[p])) as object).sort();
    expect(anahtarlar(0)).toEqual(['durum', 'durumAciklama', 'durumSurum', 'durumZamani', 'iptalOncesi']);
    expect(JSON.parse(String(yamalar[1].params[3]))).toEqual({ durum: 'hazirlaniyor', durumZamani: SAAT.toISOString(), durumSurum: 2, iptalOncesi: null });
    expect(anahtarlar(2)).toEqual(['durumAciklama', 'durumSurum', 'durumZamani']);
    expect(JSON.parse(String(yamalar[3].params[3]))).toEqual({ durumSurum: 4 });
    expect(JSON.parse(String(yamalar[3].params[4]))).toEqual({ 'b:0': { durum: 'teslim', zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad } } });
    expect(yamalar[3].params.slice(5)).toEqual(['3', '0']);
    expect(JSON.parse(String(yamalar[4].params[3]))).toEqual({ zaman: SAAT.toISOString(), koli: 2, kim: { uid: 'u', panel: true } });
    expect(yamalar[5].params).toEqual([COLL, id, CID, SAAT.toISOString()]);
    // geçiş girişi ($5) yalnız beş alan
    expect(Object.keys(JSON.parse(String(yamalar[0].params[4])) as object).sort()).toEqual(['kanal', 'kim', 'onceki', 'yeni', 'zaman']);
    expect(yamalar[0].params.slice(5)).toEqual(['hazirlaniyor', '0']);
  });
  it('kaynak: yamada okunan belgenin yayılımı yok; `bildirim` / `durumGecmisi` / `kalemTeslim` / `etiketBasildi` yama anahtarı değil; `computeFieldDiff` yok; `pgShim` / `server` içe aktarımı yok', () => {
    expect(kod).not.toMatch(/\.\.\.okunan|\.\.\.satir|\.\.\.belge|computeFieldDiff|pgShim|from '\.\.\/\.\.\/\.\.\/server|adminDb/);
    // yama nesnelerinde yasak anahtarlar: `bildirim:`, `durumGecmisi:`, `kalemTeslim:`, `etiketBasildi:` nesne sabiti olarak geçmez
    const yamaSatirlari = kodSatirlari(DOSYA).filter(s => /const yama = |const kayit: EtiketBasildiKaydi = /.test(s.kod)).map(s => s.kod);
    expect(yamaSatirlari.length).toBeGreaterThanOrEqual(3);
    for (const s of yamaSatirlari) expect(s).not.toMatch(/bildirim|durumGecmisi|kalemTeslim|etiketBasildi:|kalemler|teyit|icerikSurum/);
    expect(kod).toMatch(/writeAuditLog\(/);
  });
  it('denetim kaydına giden ayrıntıda müşteri adı / telefon / açıklama metni / anahtar listesi yok; yalnız-açıklamada diff yok', async () => {
    const id = await talep({ musteri: { ad: 'ÇOK GİZLİ', telefon: '0532 999 88 77' } });
    const { D, denetim } = deps();
    await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 3, yeni: 'sevk', aciklama: 'ÖZEL AÇIKLAMA METNİ', kim: KIM, kanal: 'erp' });
    await talepDurumunuDegistir(D, { id, companyId: CID, onceki: 'sevk', surum: 4, yeni: 'teslim', aciklama: 'İKİNCİ METİN', kim: KIM, kanal: 'erp' });
    await kalemTeslimYaz(D, { id, companyId: CID, surum: 5, teslim: true, kalemler: ['b:0', 'b:2'], kim: KIM, kanal: 'panel' });
    await bildirimiYenidenKuyrugaAl(D, { id, companyId: CID, tur: 'ilk', kim: KIM });
    expect(denetim).toHaveBeenCalledTimes(3);   // gitti → zaten-gitti denetime GİRMEZ
    for (const cagri of denetim.mock.calls) {
      const metin = JSON.stringify(cagri);
      expect(metin).not.toMatch(/ÇOK GİZLİ|0532|ÖZEL AÇIKLAMA|İKİNCİ METİN|b:0|b:2|durumGecmisi|durumAciklama|musteri/);
    }
    expect(denetim.mock.calls[0]).toHaveLength(3);
    expect(denetim.mock.calls[1]?.[3]).toEqual({ durum: { from: 'sevk', to: 'teslim' } });
    expect(denetim.mock.calls[2]?.[2]).toBe('T261009-AB12 · panel · beyan · işaretlendi 2 / kaldırıldı 0');
  });
  it('`src/` altında test dışı dosyada `pglite` içe aktarımı yok; `docs` DDL\'i yalnız `docsSema.ts`te (server.ts sabiti okur)', () => {
    const kaynaklar = [...kaynakDosyalari(join(SRC_KOK)), join(SRC_KOK, '..', 'server.ts')];
    expect(suclular(kaynaklar, /pglite/i)).toEqual([]);
    expect(suclular(kaynaklar, /CREATE TABLE IF NOT EXISTS docs/).map(s => s.site.replace(/:\d+$/, ''))).toEqual(['src/server/docsSema.ts']);
    const server = dosyaOku(join(SRC_KOK, '..', 'server.ts'));
    expect(server).toContain('await pgPool.query(DOCS_TABLOSU_DDL);');
    expect(server).toContain('for (const ddl of DOCS_INDEKS_DDL) {');
    expect(server).toMatch(/import \{ DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL \} from "\.\/src\/server\/docsSema\.js";/);
  });
});
