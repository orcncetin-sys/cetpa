// @vitest-environment node
/**
 * magazaSayim.pglite.test.ts — bekçinin ve ops özetinin mağaza SAYIM sorguları GERÇEK PostgreSQL motorunda (dilim 2b;
 * şartname v6 § 10.7, § 10.8; V10).
 *
 * `@electric-sql/pglite` (PostgreSQL WASM). Sahte havuz sayım sorgusunun ANLAMINI sınayamaz (hangi satır hangi sütuna
 * düşer, yaş hangi alandan ölçülür, `silindi` nesne / JSON null / yok nasıl ayrışır); o testler sorgu METNİNİ kilitler
 * (`opsWatchdog.magazaTalep.test.ts`, `magazaBildirimSayim.test.ts`, `magazaAcikSayim.test.ts`). Burada dört sorgu gerçek
 * satırlarla koşar:
 *   · bekçi — `magazaTalepSayimSql('bildirim' | 'bildirimRevize')` (`opsWatchdog.ts`): iki alan AYNI kalıptan; revize yaşı
 *     `icerikZamani` ile (işçinin tazelediği `bildirimRevize.zaman` ile DEĞİL — kapı 4, Y2);
 *   · ops özeti — `MAGAZA_BILDIRIM_SAYIM_SQL` (`magazaBildirimSayim.ts`): `revize_durum_*` / `revize_sinif_*` sütunları;
 *   · açık talepler — `MAGAZA_ACIK_SAYIM_SQL`: yumuşak silinen talep açık SAYILMAZ, geri alınınca döner;
 *   · silinmiş talepler — `MAGAZA_SILINMIS_SAYIM_SQL`: «silinmiş: N (son 30 gün)».
 * Hiçbir sorgu satır YAZMAZ (her blok sayımdan sonra tablonun değişmediğini de doğrular).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import { MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';
import { magazaTalepSayimSql } from '../opsWatchdog';
import type { MagazaIcerikDeps } from './magazaDurum';
import { talepGeriAl, talepIcerigiDegistir, talepSil } from './magazaIcerik';
import { MAGAZA_SILINMIS_PENCERESI_GUN, magazaAcikSayimi, magazaSilinmisSayimi } from './magazaAcikSayim';
import { REVIZE_YAZ_SQL } from './magazaBildirim';
import { magazaBildirimSayimi } from './magazaBildirimSayim';

type Satir = Record<string, unknown>;
const COLL = MAGAZA_TALEP_KOLEKSIYONU;
const CID = 'kiraci-1';
const KIM = { uid: 'u-personel', ad: 'Ayşe Yılmaz', eposta: 'ayse@example.com' };
const SIMDI = Date.parse('2026-10-10T12:00:00.000Z');
const DK = 60_000;
const SA = 60 * DK;
const GUN = 24 * SA;
const once = (ms: number): string => new Date(SIMDI - ms).toISOString();

let db: PGlite;
const havuz: MagazaPgHavuzu = { async query(sql, params = []) { const r = await db.query<Satir>(sql, params as unknown[]); return { rows: r.rows }; } };

let sira = 0;
const kimlik = (): string => `mt-${String(++sira).padStart(32, '0')}`;
/** Varsayılan: iki gün önce gelmiş, ilk bildirimi gitmiş, revizyonu olmayan açık talep. */
async function talep(ek: Satir = {}, coll = COLL): Promise<string> {
  const id = kimlik();
  const veri = { companyId: CID, talepNo: 'T261008-AB12', durum: 'teyit', durumSurum: 1, olusturma: once(2 * GUN), bildirim: { durum: 'gitti', zaman: once(2 * GUN) }, kalemler: [], ...ek };
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [coll, id, JSON.stringify(veri)]);
  return id;
}
const tablo = async (): Promise<unknown[]> => (await db.query('SELECT coll, id, data FROM docs ORDER BY coll, id')).rows;
const REVIZE = { zaman: once(1 * SA), alanlar: ['not'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 1 };
const revizeli = (durum: string, icerikZamani: unknown, ek: Satir = {}, revizeEk: Satir = {}): Satir =>
  ({ ...(icerikZamani === undefined ? {} : { icerikZamani }), icerikSurum: 1, bildirimRevize: { ...REVIZE, durum, ...revizeEk }, ...ek });

/** Bekçinin beş parametresi (`opsWatchdog.ts` `magazaTalepKontrolu` ile AYNI formül): koleksiyon, son 24 sa, bekleme eşiği, üst sınır (+5 dk), kırmızı penceresi (7 gün). */
const BEKCI_PARAMETRELERI = [COLL, once(GUN), once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS), new Date(SIMDI + 5 * DK).toISOString(), once(7 * GUN)];
const bekciSayimi = async (yol: 'bildirim' | 'bildirimRevize'): Promise<Satir> => (await db.query<Satir>(magazaTalepSayimSql(yol), BEKCI_PARAMETRELERI)).rows[0];

function yazmaBaglami(simdi: () => Date = () => new Date(SIMDI)): MagazaIcerikDeps {
  return { getPgPool: () => havuz, broadcastDocChange: vi.fn(), writeAuditLog: vi.fn(async () => undefined), bildirimIste: vi.fn(async () => undefined), revizeBildirimiIste: vi.fn(async () => undefined), simdi };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DELETE FROM docs'); });

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('bekçi — magazaTalepSayimSql(\'bildirimRevize\'): revize bildirimi sayımı (§ 10.7 (a))', () => {
  it('her satır DOĞRU sütuna düşer: kırmızı üç sütun pencere içi, eskiler bilgi sütununda; taze `bekliyor`, `gitti`, revizyonsuz ve çöp alan hiçbirine', async () => {
    await talep(revizeli('gonderilemedi', once(1 * SA)));                              // → gonderilemedi
    await talep(revizeli('gonderilemedi', once(8 * GUN)));                             // → eski_gitmeyen (pencereden KANITLI eski)
    await talep(revizeli('yapilandirilmamis', once(2 * GUN)));                         // → yapilandirilmamis
    await talep(revizeli('bekliyor', once(5 * DK)));                                   // taze: hiçbiri
    await talep(revizeli('bekliyor', once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + DK)));   // → bekleyen (10 dk + 1 dk)
    await talep(revizeli('bekliyor', once(9 * GUN)));                                  // → eski_gitmeyen
    await talep(revizeli('gitti', once(1 * SA)));                                      // gitti: hiçbiri
    await talep({});                                                                   // revizyon yok: hiçbiri
    await talep({ icerikZamani: once(1 * SA), bildirimRevize: 'çöp' });                // çöp alan: hiçbiri (hata da yok)
    await talep({ icerikZamani: once(1 * SA), bildirimRevize: null });                 // JSON null: hiçbiri
    await talep(revizeli('gonderilemedi', once(1 * SA)), 'baskaKoleksiyon');           // başka koleksiyon: evren dışı
    const onceki = await tablo();
    expect(await bekciSayimi('bildirimRevize')).toEqual({ toplam: 10, son24: 6, gonderilemedi: 1, yapilandirilmamis: 1, bekleyen: 1, eski_gitmeyen: 2 });
    expect(await tablo()).toEqual(onceki);                                             // sayım hiçbir satırı değiştirmedi
  });

  it('(kapı 4, Y2) YAŞ `icerikZamani`dan ölçülür — işçinin / «Yeniden gönder»in tazelediği `bildirimRevize.zaman` bekçiyi SUSTURMAZ', async () => {
    // Revizyon 3 saat önce; işçi 1 dk önce yeniden denedi (`zaman` taze, `deneme` 5). Yaş `zaman`dan ölçülseydi «taze» sayılırdı.
    await talep(revizeli('bekliyor', once(3 * SA), {}, { zaman: once(1 * DK), deneme: 5, hataSinifi: 'baglanti' }));
    // Revizyon 8 gün önce; `zaman` bugün tazelenmiş: yine «pencereden eski» (bilgi) — kırmızıya geri DÖNMEZ.
    await talep(revizeli('gonderilemedi', once(8 * GUN), {}, { zaman: once(1 * DK) }));
    // Tersi: revizyon 2 dk önce, `zaman` çok eski (bozuk saatli bir yazım): `icerikZamani` taze olduğu için bekleyen DEĞİL.
    await talep(revizeli('bekliyor', once(2 * DK), {}, { zaman: once(30 * GUN) }));
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 1, eski_gitmeyen: 1 });
  });

  it('yaş `olusturma`dan DEĞİL: aylar önce gelen talebin DÜNKÜ revizyonu kırmızı penceresindedir; dün gelen talebin 8 günlük revizyonu olamaz ama ölçüt yine `icerikZamani`dır', async () => {
    await talep(revizeli('gonderilemedi', once(1 * GUN), { olusturma: once(90 * GUN) }));    // eski talep, taze revizyon → KIRMIZI
    await talep(revizeli('yapilandirilmamis', once(8 * GUN), { olusturma: once(1 * SA) }));  // (kurgusal) taze talep, eski revizyon → bilgi
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ gonderilemedi: 1, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 1 });
  });

  it('yaşı OKUNAMAYAN satır ne «taze» ne «pencereden eski» sayılır: kırmızıda kalır (eksik, boş, biçimsiz, milisaniyesiz, sayı, ileri tarih)', async () => {
    // Milisaniyesiz ISO (`…T09:00:00Z`) dokuz gün ÖNCESİNİ gösterir ama sunucu biçiminde değildir: «pencereden eski» KANITLANAMAZ, kırmızıda kalır.
    for (const icerikZamani of [undefined, null, '', '0', '2020-bozuk', '2026-10-01T09:00:00Z', 1760097540000, '10.10.2026 14:59']) {
      await talep(revizeli('bekliyor', icerikZamani));
      await talep(revizeli('gonderilemedi', icerikZamani));
    }
    await talep(revizeli('bekliyor', new Date(SIMDI + 1 * SA).toISOString()));          // üst sınırın (şimdi + 5 dk) ötesi: taze KANITLANAMAZ
    await talep(revizeli('bekliyor', new Date(SIMDI + 4 * DK).toISOString()));          // tolerans içinde ileri saat: taze
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ gonderilemedi: 8, yapilandirilmamis: 0, bekleyen: 9, eski_gitmeyen: 0 });
  });

  it('eşikler: bekleme sınırı ve kırmızı penceresinin sınır değerleri (metin karşılaştırması `toISOString()` biçiminde zaman sırasıdır)', async () => {
    await talep(revizeli('bekliyor', once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS)));         // tam eşikte: BETWEEN kapsar → taze
    await talep(revizeli('bekliyor', once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1)));     // 1 ms eski → bekleyen
    await talep(revizeli('gonderilemedi', once(7 * GUN)));                              // tam pencere başı: `< $5` değil → kırmızı
    await talep(revizeli('gonderilemedi', once(7 * GUN + 1)));                          // 1 ms eski → bilgi
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ gonderilemedi: 1, bekleyen: 1, eski_gitmeyen: 1 });
  });

  it('iki alan BAĞIMSIZ sayılır: ilk bildirim sorgusu `bildirimRevize`\'ye, revize sorgusu `bildirim`\'e bakmaz; aynı satır iki sayımda ayrı ayrı görünebilir', async () => {
    await talep({ bildirim: { durum: 'gonderilemedi', zaman: once(1 * SA), hataSinifi: 'tls' }, olusturma: once(1 * SA) });                    // yalnız ilk
    await talep(revizeli('gonderilemedi', once(1 * SA)));                                                                                    // yalnız revize
    await talep(revizeli('bekliyor', once(2 * SA), { bildirim: { durum: 'yapilandirilmamis', zaman: once(3 * GUN) }, olusturma: once(3 * GUN) }));   // ikisi de
    expect(await bekciSayimi('bildirim')).toEqual({ toplam: 3, son24: 1, gonderilemedi: 1, yapilandirilmamis: 1, bekleyen: 0, eski_gitmeyen: 0 });
    expect(await bekciSayimi('bildirimRevize')).toEqual({ toplam: 3, son24: 2, gonderilemedi: 1, yapilandirilmamis: 0, bekleyen: 1, eski_gitmeyen: 0 });
  });

  it('ilk bildirim sorgusu dilim 1 anlamını KORUR: yaş `olusturma`dan; revizyon (`icerikZamani`) ilk bildirimin yaşını değiştirmez', async () => {
    // Dokuz gün önce gelen, bildirimi gitmemiş talep BUGÜN revize edildi: ilk bildirim yine «pencereden eski» (bilgi).
    await talep({ olusturma: once(9 * GUN), bildirim: { durum: 'gonderilemedi', zaman: once(9 * GUN) }, icerikZamani: once(1 * SA), icerikSurum: 1, bildirimRevize: { ...REVIZE, durum: 'gitti' } });
    expect(await bekciSayimi('bildirim')).toMatchObject({ gonderilemedi: 0, eski_gitmeyen: 1 });
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0 });
  });

  it('uçtan uca: gerçek içerik yazımı → sayımda «bekleyen» OLMAZ (taze); 11 dk sonra olur; işçinin «yeniden dene» yazımı onu DÜŞÜRMEZ; `gitti` yazımı düşürür', async () => {
    const id = await talep({});
    const yazimAni = new Date(SIMDI - 11 * DK);
    const s = await talepIcerigiDegistir(yazmaBaglami(() => yazimAni), { id, companyId: CID, icerikSurum: 0, not: 'yeni not', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    // Yazım 11 dk önce: bekleme sınırı (10 dk) aşıldı → bekleyen 1.
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ bekleyen: 1, gonderilemedi: 0 });
    // İşçi şimdi yeniden denedi (`zaman` = şimdi, deneme 2): bekçi yine bekleyen sayar.
    expect((await db.query(REVIZE_YAZ_SQL, [COLL, id, JSON.stringify({ durum: 'bekliyor', deneme: 2, hataSinifi: 'baglanti', zaman: new Date(SIMDI).toISOString() }), 1])).rows).toHaveLength(1);
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ bekleyen: 1 });
    // Ops özeti (inceleme 2b, bulgu 7): deneme sürerken hata sınıfı MEŞRU sayılır (`bekliyor` + `baglanti`).
    const sinifsiz = { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 };
    expect((await magazaBildirimSayimi(havuz, SIMDI))?.revize).toEqual({ durum: { bekliyor: 1, gitti: 0, gonderilemedi: 0, yapilandirilmamis: 0 }, hataSinifi: { ...sinifsiz, baglanti: 1 } });
    expect((await db.query(REVIZE_YAZ_SQL, [COLL, id, JSON.stringify({ durum: 'gitti', zaman: new Date(SIMDI).toISOString() }), 1])).rows).toHaveLength(1);
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ bekleyen: 0, gonderilemedi: 0, yapilandirilmamis: 0, eski_gitmeyen: 0 });
    // Posta GİTTİ: belgede önceki denemenin `hataSinifi` kalıntısı DURUR (işçi yazımı birleştirir) ama özet onu hata SAYMAZ.
    const giden = (await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, id])).rows[0].data.bildirimRevize;
    expect(giden).toMatchObject({ durum: 'gitti', deneme: 2, hataSinifi: 'baglanti' });
    expect((await magazaBildirimSayimi(havuz, SIMDI))?.revize).toEqual({ durum: { bekliyor: 0, gitti: 1, gonderilemedi: 0, yapilandirilmamis: 0 }, hataSinifi: sinifsiz });
  });

  it('(inceleme 2b, bulgu 8 — bilerek tersine dönen ÖLÇÜM) SİLİNMİŞ talebin gitmeyen bildirimi üç KIRMIZI sütuna SAYILMAZ (iki yolda da); geri alınınca (`silindi: null`) yeniden sayılır', async () => {
    const SILINDI = { silindi: { zaman: once(30 * DK), kim: { uid: 'u', ad: 'A' }, kanal: 'erp' } };
    // Revize yolu: silinmiş üç satır (her kırmızı sütundan bir tane) + canlı bir `gonderilemedi` (kırmızıda KALIR).
    await talep(revizeli('gonderilemedi', once(1 * SA), SILINDI));
    await talep(revizeli('yapilandirilmamis', once(1 * SA), SILINDI));
    await talep(revizeli('bekliyor', once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + DK), SILINDI));
    await talep(revizeli('gonderilemedi', once(1 * SA)));
    // İlk bildirim yolu: aynı üç hâl silinmiş + geri alınmış (`silindi: null`) bir `yapilandirilmamis` (yeniden SAYILIR).
    await talep({ bildirim: { durum: 'gonderilemedi', zaman: once(1 * SA) }, olusturma: once(1 * SA), ...SILINDI, silindi: { ...SILINDI.silindi, kanal: 'panel' } });
    await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: once(1 * SA) }, olusturma: once(1 * SA), ...SILINDI });
    await talep({ bildirim: { durum: 'bekliyor', zaman: once(1 * SA) }, olusturma: once(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + DK), ...SILINDI });
    await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: once(1 * SA) }, olusturma: once(1 * SA), silindi: null });
    // `toplam` ve `son24` DEĞİŞMEDİ (koleksiyonun satır sayısı; silinmiş dâhil): 8 satır.
    expect(await bekciSayimi('bildirimRevize')).toEqual({ toplam: 8, son24: 4, gonderilemedi: 1, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 0 });
    expect(await bekciSayimi('bildirim')).toEqual({ toplam: 8, son24: 4, gonderilemedi: 0, yapilandirilmamis: 1, bekleyen: 0, eski_gitmeyen: 0 });
  });

  it('(bulgu 8) gerçek `talepSil` / `talepGeriAl` ile: gitmeyen bildirimli talep silinince bekçinin kırmızısından DÜŞER, geri alınınca DÖNER; pencereden eski silinmiş satır bilgi sütununda KALIR', async () => {
    const ilk = await talep({ bildirim: { durum: 'gonderilemedi', zaman: once(1 * SA), hataSinifi: 'tls' }, olusturma: once(1 * SA) });
    const rev = await talep(revizeli('yapilandirilmamis', once(2 * SA)));
    // Pencereden KANITLI eski + silinmiş: `eski_gitmeyen` (bilgi) silinmişi dışlamaz — sayı aynı kalır.
    await talep({ bildirim: { durum: 'gonderilemedi', zaman: once(9 * GUN) }, olusturma: once(9 * GUN), silindi: { zaman: once(1 * GUN), kim: { uid: 'u', ad: 'A' }, kanal: 'erp' } });
    expect(await bekciSayimi('bildirim')).toMatchObject({ gonderilemedi: 1, eski_gitmeyen: 1 });
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ yapilandirilmamis: 1 });
    const D = yazmaBaglami();
    await expect(talepSil(D, { id: ilk, companyId: CID, surum: 1, kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepSil(D, { id: rev, companyId: CID, surum: 1, kim: KIM, kanal: 'panel' })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await bekciSayimi('bildirim')).toMatchObject({ toplam: 3, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0, eski_gitmeyen: 1 });
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ toplam: 3, gonderilemedi: 0, yapilandirilmamis: 0, bekleyen: 0 });
    // Silinmişler ayrı parçada görünür («silinmiş: N (son 30 gün)»): görünürlük kaybolmadı.
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 3, tarihsiz: 0 });
    await expect(talepGeriAl(D, { id: ilk, companyId: CID, surum: 2, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepGeriAl(D, { id: rev, companyId: CID, surum: 2, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await bekciSayimi('bildirim')).toMatchObject({ gonderilemedi: 1, eski_gitmeyen: 1 });
    expect(await bekciSayimi('bildirimRevize')).toMatchObject({ yapilandirilmamis: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('ops özeti — MAGAZA_BILDIRIM_SAYIM_SQL: revize sütunları (§ 10.7 (b))', () => {
  it('iki alan KENDİ penceresiyle: ilk bildirim `olusturma`, revize `icerikZamani` (son 7 gün); sayılar birbirine karışmaz', async () => {
    await talep({ olusturma: once(1 * GUN) });                                                                                                   // A: yeni talep, gitti, revizyon yok
    await talep(revizeli('gitti', once(1 * GUN), { olusturma: once(10 * GUN), bildirim: { durum: 'gonderilemedi', zaman: 'z', hataSinifi: 'kimlik' } }));   // B: ESKİ talep, dün revize
    await talep(revizeli('gonderilemedi', once(1 * GUN), { olusturma: once(2 * GUN), bildirim: { durum: 'bekliyor', zaman: 'z' } }, { hataSinifi: 'tls' }));   // C: ikisi de pencerede
    await talep(revizeli('yapilandirilmamis', once(9 * GUN), { olusturma: once(10 * GUN) }));                                                    // D: ikisi de pencere DIŞI
    await talep(revizeli('bekliyor', undefined, { olusturma: once(3 * GUN), bildirim: { durum: 'yapilandirilmamis', zaman: 'z' } }));             // E: revizyon zamanı YOK → revize sayılmaz
    await talep(revizeli('gonderilemedi', once(1 * GUN), { olusturma: once(1 * GUN) }, { hataSinifi: 'diger' }), 'baskaKoleksiyon');              // evren dışı
    const onceki = await tablo();
    expect(await magazaBildirimSayimi(havuz, SIMDI)).toEqual({
      toplam: 3,   // A, C, E — pencerede OLUŞTURULAN talepler (B ve D eski; dilim 1 anlamı aynen)
      durum: { bekliyor: 1, gitti: 1, gonderilemedi: 0, yapilandirilmamis: 1 },   // B'nin `gonderilemedi`si pencere dışı: SAYILMAZ
      hataSinifi: { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 },
      revize: {
        durum: { bekliyor: 0, gitti: 1, gonderilemedi: 1, yapilandirilmamis: 0 },   // B (eski talebin dünkü revizyonu GÖRÜNÜR) + C
        hataSinifi: { kimlik: 0, tls: 1, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 },
      },
    });
    expect(await tablo()).toEqual(onceki);
  });

  it('(inceleme 2b, bulgu 7) revize hata sınıfı YALNIZ durumu gitmemiş belgede sayılır: yeniden denemeyle GİTMİŞ bildirimin bayat `hataSinifi`si hata DEĞİLDİR; `yapilandirilmamis`taki kalıntı da sayılmaz', async () => {
    // A: işçi iki kez denedi, sonra GÖNDERDİ — gerçek `REVIZE_YAZ_SQL` ile (yazım birleştirir: `hataSinifi` belgede kalır).
    const a = await talep(revizeli('bekliyor', once(2 * SA), { olusturma: once(20 * GUN) }));
    for (const yama of [{ durum: 'bekliyor', deneme: 1, hataSinifi: 'baglanti', zaman: once(90 * DK) }, { durum: 'gitti', zaman: once(80 * DK) }]) {
      expect((await db.query(REVIZE_YAZ_SQL, [COLL, a, JSON.stringify(yama), 1])).rows).toHaveLength(1);
    }
    expect((await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, a])).rows[0].data.bildirimRevize).toMatchObject({ durum: 'gitti', hataSinifi: 'baglanti' });
    // B: kalıcı hata (meşru) · C: deneme sürüyor (meşru) · D: deneme sırasında ayar eksildi → `yapilandirilmamis` + kalıntı (sayılmaz).
    await talep(revizeli('gonderilemedi', once(1 * SA), { olusturma: once(20 * GUN) }, { deneme: 8, hataSinifi: 'tls' }));
    await talep(revizeli('bekliyor', once(1 * SA), { olusturma: once(20 * GUN) }, { deneme: 2, hataSinifi: 'diger' }));
    await talep(revizeli('yapilandirilmamis', once(1 * SA), { olusturma: once(20 * GUN) }, { deneme: 1, hataSinifi: 'kimlik' }));
    // E: durumu kapalı küme DIŞI (çöp) + sınıf: hiçbir sınıf sütununa düşmez.
    await talep(revizeli('çöp', once(1 * SA), { olusturma: once(20 * GUN) }, { hataSinifi: 'alici-reddi' }));
    const sonuc = await magazaBildirimSayimi(havuz, SIMDI);
    expect(sonuc?.revize).toEqual({
      durum: { bekliyor: 1, gitti: 1, gonderilemedi: 1, yapilandirilmamis: 1 },   // durum sütunları DEĞİŞMEDİ: dört belge dört sütunda
      hataSinifi: { kimlik: 0, tls: 1, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 1 },   // yalnız B ve C
    });
    // Sınıf toplamı ≤ gitmemiş (bekliyor + gonderilemedi) belge sayısı: «gitti»li belge hata sınıfı üretemez.
    const sinifToplami = Object.values(sonuc?.revize.hataSinifi ?? {}).reduce((t, n) => t + n, 0);
    expect(sinifToplami).toBe(2);
    expect(sonuc?.toplam).toBe(0);   // beş talep de pencereden eski: ilk bildirim evreni boş (iki pencere karışmaz)
  });

  it('(bulgu 7) İLK bildirimin sınıf sütunları DEĞİŞMEDİ: durum koşulu yok (nesne bütünüyle yazılır, kalıntı oluşmaz) — dilim 1 anlamı aynen', async () => {
    await talep({ olusturma: once(1 * SA), bildirim: { durum: 'gonderilemedi', zaman: 'z', hataSinifi: 'gonderen-reddi' } });
    await talep({ olusturma: once(1 * SA), bildirim: { durum: 'bekliyor', zaman: 'z', deneme: 1, hataSinifi: 'baglanti' } });
    // Kurgusal (işçi böyle yazmaz): `gitti` + sınıf. İlk bildirim sütunu dilim 1'deki gibi sınıfı sayar — bu düzeltme ona DOKUNMADI.
    await talep({ olusturma: once(1 * SA), bildirim: { durum: 'gitti', zaman: 'z', hataSinifi: 'tls' } });
    expect((await magazaBildirimSayimi(havuz, SIMDI))?.hataSinifi).toEqual({ kimlik: 0, tls: 1, baglanti: 1, 'gonderen-reddi': 1, 'alici-reddi': 0, diger: 0 });
  });

  it('boş koleksiyon: sayım `null` DEĞİL, bütün sütunlar 0 (satır yokken de tek satır döner); revizyonsuz taleplerde revize sütunları 0', async () => {
    const sifir = { bekliyor: 0, gitti: 0, gonderilemedi: 0, yapilandirilmamis: 0 };
    const sinifsiz = { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 };
    expect(await magazaBildirimSayimi(havuz, SIMDI)).toEqual({ toplam: 0, durum: sifir, hataSinifi: sinifsiz, revize: { durum: sifir, hataSinifi: sinifsiz } });
    await talep({ olusturma: once(1 * SA) });
    await talep({ olusturma: once(2 * SA), bildirim: { durum: 'gonderilemedi', zaman: 'z', hataSinifi: 'gonderen-reddi' } });
    expect(await magazaBildirimSayimi(havuz, SIMDI)).toEqual({
      toplam: 2, durum: { ...sifir, gitti: 1, gonderilemedi: 1 }, hataSinifi: { ...sinifsiz, 'gonderen-reddi': 1 }, revize: { durum: sifir, hataSinifi: sinifsiz },
    });
  });

  it('dokümandaki metin (bilinmeyen durum / sınıf dizgesi, müşteri alanı) yanıta GEÇMEZ: kapalı küme dışı değer hiçbir sütuna düşmez', async () => {
    await talep(revizeli('AHMET YILMAZ 0532', once(1 * SA), { olusturma: once(1 * SA), bildirim: { durum: 'x', zaman: 'z', hataSinifi: '550 kutu yok' }, musteri: { ad: 'Zeynep' } }, { hataSinifi: 'serbest metin' }));
    const sonuc = await magazaBildirimSayimi(havuz, SIMDI);
    expect(sonuc?.toplam).toBe(1);
    expect(JSON.stringify(sonuc)).not.toMatch(/AHMET|0532|550|Zeynep|serbest/);
    expect(Object.values(sonuc?.durum ?? {}).concat(Object.values(sonuc?.revize.durum ?? {}), Object.values(sonuc?.revize.hataSinifi ?? {}))).toEqual(Array(14).fill(0));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('açık ve silinmiş talep sayımı (§ 10.7): açık sayımı silinmiş HARİÇ; «silinmiş: N (son 30 gün)»', () => {
  const SIL = (ms: number, kanal = 'erp'): Satir => ({ silindi: { zaman: once(ms), kim: { uid: 'u', ad: 'Silen Kişi' }, kanal } });

  it('yumuşak silinen AÇIK talep açık sayımdan ve «en eski açık»tan DÜŞER; geri alınınca (JSON `null`) DÖNER — gerçek `talepSil` / `talepGeriAl` ile', async () => {
    const eski = await talep({ olusturma: once(20 * GUN), durum: 'yeni' });
    await talep({ olusturma: once(3 * GUN), durum: 'hazirlaniyor' });
    await talep({ olusturma: once(40 * GUN), durum: 'teslim' });                       // kapalı: zaten sayılmaz
    expect(await magazaAcikSayimi(havuz)).toMatchObject({ toplam: 2, asama: { yeni: 1, hazirlaniyor: 1 }, enEski: once(20 * GUN) });
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 0, tarihsiz: 0 });
    const D = yazmaBaglami();
    await expect(talepSil(D, { id: eski, companyId: CID, surum: 1, kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await magazaAcikSayimi(havuz)).toMatchObject({ toplam: 1, asama: { yeni: 0, hazirlaniyor: 1 }, enEski: once(3 * GUN) });
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 1, tarihsiz: 0 });
    await expect(talepGeriAl(D, { id: eski, companyId: CID, surum: 2, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await magazaAcikSayimi(havuz)).toMatchObject({ toplam: 2, enEski: once(20 * GUN) });
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 0, tarihsiz: 0 });
  });

  it('`jsonb_typeof` ölçütü üç hâli doğru ayırır: nesne = silinmiş · JSON null (geri alınmış) ve alanın yokluğu = silinmemiş; nesne OLMAYAN çöp değer de silinmiş SAYILMAZ', async () => {
    await talep(SIL(1 * GUN));                          // nesne → silinmiş
    await talep({ silindi: null });                     // geri alınmış
    await talep({});                                    // hiç silinmemiş
    await talep({ silindi: 'evet' });                   // çöp dizge
    await talep({ silindi: true });                     // çöp mantıksal
    await talep({ silindi: [{ zaman: once(1 * GUN) }] });   // dizi
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 1, tarihsiz: 0 });
    expect((await magazaAcikSayimi(havuz))?.toplam).toBe(5);   // silinmiş tek satır DIŞINDA hepsi açık
  });

  it('pencere `silindi.zaman` ile (talebin `olusturma`sı ile DEĞİL), sınır dâhil; pencereden eski silinmiş ne «pencerede» ne «tarihsiz»', async () => {
    const penBasi = MAGAZA_SILINMIS_PENCERESI_GUN * GUN;
    await talep({ ...SIL(1 * SA), olusturma: once(200 * GUN) });      // eski talep, bugün silindi → pencerede
    await talep({ ...SIL(penBasi), olusturma: once(1 * SA) });        // tam pencere başı (`>= $2`) → pencerede
    await talep({ ...SIL(penBasi + 1), olusturma: once(1 * SA) });    // 1 ms eski → dışarıda
    await talep({ ...SIL(90 * GUN) });                                // çok eski → dışarıda
    await talep({ ...SIL(1 * SA, 'panel'), durum: 'iptal' });         // kapalı aşamadaki silinmiş de sayılır (evren: silinmişler)
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 3, tarihsiz: 0 });
  });

  it('silinme zamanı OKUNAMAYAN satır pencereye UYDURULMAZ, ayrı sayılır (`tarihsiz`): eksik, boş, biçimsiz, milisaniyesiz, sayı', async () => {
    for (const zaman of [undefined, '', '0', 'dün', '2026-10-10T11:00:00Z', 1760094000000]) {
      await talep({ silindi: { ...(zaman === undefined ? {} : { zaman }), kim: { uid: 'u', ad: 'A' }, kanal: 'erp' } });
    }
    await talep(SIL(2 * GUN));
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 1, tarihsiz: 6 });
  });

  it('başka koleksiyondaki `silindi` alanı sayılmaz; sayım hiçbir satırı değiştirmez; satır yokken de tek satır (0 / 0) döner', async () => {
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 0, tarihsiz: 0 });
    await talep(SIL(1 * SA), 'baskaKoleksiyon');
    await talep(SIL(1 * SA));
    const onceki = await tablo();
    expect(await magazaSilinmisSayimi(havuz, SIMDI)).toEqual({ pencerede: 1, tarihsiz: 0 });
    expect(await tablo()).toEqual(onceki);
  });
});
