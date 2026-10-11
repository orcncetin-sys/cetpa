// @vitest-environment node
/**
 * magazaAcikSayim.test.ts — açık talep sayımının SAF yarısı (dilim 2a, § 6): satır çözücü, okuyucu, yaş metni, sorgu metni.
 *
 * Sorgunun ANLAMI (hangi satır açık sayılır, en eski hangisi, biçimsiz tarih nereye düşer) gerçek motorda sınanır:
 * `magazaDurum.pglite.test.ts` «açık talep sayımı» bloğu (gerçek motor testleri TEK dosyada toplanır — V10).
 *
 * Dilim 2b (§ 10.7): SİLİNMİŞ talep sayımının saf yarısı da burada (`magazaSilinmisSayimi`); gerçek motordaki anlamı
 * (`silindi` nesne / JSON null / yok; pencere; biçimsiz silinme zamanı) `magazaSayim.pglite.test.ts`'te.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, oku, SRC_KOK } from '../../test/kaynakTarama';
import { MAGAZA_ACIK_ASAMALAR, MAGAZA_TALEP_ASAMALARI, MAGAZA_UTC_ZAMAN_DESENI } from '../../lib/magazaTalep';
import { MAGAZA_ACIK_SQL, MAGAZA_SILINMIS_SQL } from './magazaDurum';
import {
  MAGAZA_ACIK_SAYIM_SQL, MAGAZA_SILINMIS_PENCERESI_GUN, MAGAZA_SILINMIS_SAYIM_SQL,
  magazaAcikSayimi, magazaAcikSayiminiCoz, magazaSilinmisSayimi, magazaSilinmisSayiminiCoz, magazaYasMetni,
} from './magazaAcikSayim';

const SATIR = { acik: 7, asama_yeni: 2, asama_teyit: 1, asama_hazirlaniyor: 3, asama_sevk: 1, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: '2026-10-05T09:00:00.000Z' };

describe('magazaAcikSayiminiCoz — sorgu satırı → sayım (saf)', () => {
  it('tam satır: toplam, aşama dağılımı (dört açık aşama + bilinmiyor), tarihsiz, en eski', () => {
    expect(magazaAcikSayiminiCoz(SATIR)).toEqual({
      toplam: 7, asama: { yeni: 2, teyit: 1, hazirlaniyor: 3, sevk: 1, bilinmiyor: 0 }, tarihsiz: 0, enEski: '2026-10-05T09:00:00.000Z',
    });
  });

  it('açık talep yok: sayılar 0, en eski `null` (NULL ve eksik sütun aynı — «tarih yok»)', () => {
    const bos = { acik: 0, asama_yeni: 0, asama_teyit: 0, asama_hazirlaniyor: 0, asama_sevk: 0, asama_bilinmiyor: 0, tarihsiz: 0 };
    const beklenen = { toplam: 0, asama: { yeni: 0, teyit: 0, hazirlaniyor: 0, sevk: 0, bilinmiyor: 0 }, tarihsiz: 0, enEski: null };
    expect(magazaAcikSayiminiCoz({ ...bos, en_eski: null })).toEqual(beklenen);
    expect(magazaAcikSayiminiCoz(bos)).toEqual(beklenen);
  });

  it('satırdan YALNIZ bilinen sütunlar alınır: fazladan sütun (metin, kişisel veri) sayıma geçmez', () => {
    const sonuc = magazaAcikSayiminiCoz({ ...SATIR, musteri: 'AHMET YILMAZ 0532', asama_teslim: 9, durum: 'x' });
    expect(JSON.stringify(sonuc)).not.toMatch(/AHMET|teslim|durum/);
    expect(Object.keys(sonuc?.asama ?? {}).sort()).toEqual([...MAGAZA_ACIK_ASAMALAR, 'bilinmiyor'].sort());
  });

  it.each([
    ['satır yok (undefined)', undefined], ['null', null], ['dizi', [SATIR]], ['dizge', 'acik'], ['sayı', 7],
    ['toplam eksik', { ...SATIR, acik: undefined }],
    ['toplam metin (sürücü sayıyı metin döndürürse sıfır SAYILMAZ)', { ...SATIR, acik: '7' }],
    ['toplam eksi', { ...SATIR, acik: -1 }],
    ['toplam kesirli', { ...SATIR, acik: 1.5 }],
    ['toplam NaN', { ...SATIR, acik: Number.NaN }],
    ['aşama null', { ...SATIR, asama_teyit: null }],
    ['aşama sütunu eksik', { acik: 1, asama_yeni: 1, asama_teyit: 0, asama_sevk: 0, asama_bilinmiyor: 0, tarihsiz: 0, en_eski: null }],
    ['bilinmiyor eksik', { acik: 1, asama_yeni: 1, asama_teyit: 0, asama_hazirlaniyor: 0, asama_sevk: 0, tarihsiz: 0, en_eski: null }],
    ['tarihsiz eksik', { acik: 1, asama_yeni: 1, asama_teyit: 0, asama_hazirlaniyor: 0, asama_sevk: 0, asama_bilinmiyor: 0, en_eski: null }],
    ['en eski biçimsiz (yerel biçim)', { ...SATIR, en_eski: '05.10.2026 09:00' }],
    ['en eski +03:00 ekli', { ...SATIR, en_eski: '2026-10-05T12:00:00.000+03:00' }],
    ['en eski milisaniyesiz', { ...SATIR, en_eski: '2026-10-05T09:00:00Z' }],
    ['en eski boş dizge', { ...SATIR, en_eski: '' }],
    ['en eski sayı', { ...SATIR, en_eski: 1759654800000 }],
    ['en eski Date nesnesi', { ...SATIR, en_eski: new Date(0) }],
  ] as const)('okunamayan satır `null` döner — uydurma sıfır / uydurma tarih yok (%s)', (_ad, satir) => {
    expect(magazaAcikSayiminiCoz(satir)).toBeNull();
  });
});

describe('magazaAcikSayimi — okuyucu', () => {
  it('TEK sorgu, tek parametre (koleksiyon adı); ilk satır çözülür', async () => {
    const query = vi.fn(async () => ({ rows: [SATIR, { acik: 99 }] }));
    const sonuc = await magazaAcikSayimi({ query });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(MAGAZA_ACIK_SAYIM_SQL, ['magazaTalepleri']);
    expect(sonuc?.toplam).toBe(7);
  });

  it('satır dönmezse / `rows` dizi değilse `null`', async () => {
    expect(await magazaAcikSayimi({ query: async () => ({ rows: [] }) })).toBeNull();
    const bozuk: unknown = { rows: null };
    expect(await magazaAcikSayimi({ query: async () => bozuk as { rows: unknown[] } })).toBeNull();
  });

  it('sorgu hatası FIRLATILIR (yutulmaz): çağıran hata kodunu ayrıntıya yazar', async () => {
    const hata = Object.assign(new Error('x'), { code: '57014' });
    await expect(magazaAcikSayimi({ query: async () => { throw hata; } })).rejects.toBe(hata);
  });
});

describe('magazaYasMetni — yaş metni (saf)', () => {
  const DK = 60_000;
  const SA = 60 * DK;
  const GUN = 24 * SA;
  it.each([
    [0, '0 dk'], [59_999, '0 dk'], [DK, '1 dk'], [59 * DK + 59_999, '59 dk'],
    [SA, '1 sa'], [SA + 59 * DK, '1 sa'], [47 * SA + 59 * DK, '47 sa'],
    [2 * GUN, '2 gün'], [3 * GUN - 1, '2 gün'], [3 * GUN, '3 gün'], [400 * GUN, '400 gün'],
  ] as const)('%i ms → «%s» (aşağı yuvarlanır)', (ms, beklenen) => {
    expect(magazaYasMetni(ms)).toBe(beklenen);
  });
  it('eksi değer (saat kayması) 0 sayılır; sonlu olmayan değer «—» (uydurma yaş yok)', () => {
    expect(magazaYasMetni(-5 * DK)).toBe('0 dk');
    expect(magazaYasMetni(Number.NaN)).toBe('—');
    expect(magazaYasMetni(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('MAGAZA_ACIK_SAYIM_SQL — kaynak çitleri', () => {
  const tekSatir = MAGAZA_ACIK_SAYIM_SQL.replace(/\s+/g, ' ');

  it('açıklık ölçütü panel listesiyle AYNI sabit (`MAGAZA_ACIK_SQL`); kiracı / tarih penceresi yok; tek parametre', () => {
    expect(tekSatir.endsWith(`FROM docs WHERE coll = $1 AND ${MAGAZA_ACIK_SQL}`)).toBe(true);
    expect([...new Set(tekSatir.match(/\$\d+/g))]).toEqual(['$1']);
    expect(tekSatir).not.toContain('${');
    // Ölçüt modülde yeniden YAZILMADI (kopya ölçüt ayrışır): `NOT IN ('teslim', 'iptal')` kaynakta yalnız magazaDurum.ts'te.
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaAcikSayim.ts')).map(s => s.kod).join('\n');
    expect(kod).not.toContain(`'teslim'`);
    expect(kod).toContain('${MAGAZA_ACIK_SQL}');
  });

  it('aşama sütunları kapalı kümeden üretilir: dört açık aşama + bilinmiyor; kapalı aşamalar (teslim / iptal) sütun DEĞİL', () => {
    expect([...tekSatir.matchAll(/AS (asama_[a-z]+)/g)].map(e => e[1])).toEqual([...MAGAZA_ACIK_ASAMALAR.map(a => `asama_${a}`), 'asama_bilinmiyor']);
    for (const a of MAGAZA_ACIK_ASAMALAR) expect(tekSatir).toContain(`(count(*) FILTER (WHERE data->>'durum' = '${a}'))::int AS asama_${a}`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE COALESCE(data->>'durum', '') NOT IN ('yeni', 'teyit', 'hazirlaniyor', 'sevk')))::int AS asama_bilinmiyor`);
    for (const kapali of MAGAZA_TALEP_ASAMALARI.filter(a => !(MAGAZA_ACIK_ASAMALAR as readonly string[]).includes(a))) expect(tekSatir).not.toContain(`asama_${kapali}`);
    expect(tekSatir).not.toContain('GROUP BY');   // dokümandaki metin (bilinmeyen `durum` değeri) yanıta geçemez
  });

  it('yaş `olusturma`dan ve METİN sırasıyla: `min(… COLLATE "C")` yalnız biçimli değerlerde; `::timestamptz` yok', () => {
    const bicimli = `(data->>'olusturma') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`;
    expect(tekSatir).toContain(`min((data->>'olusturma') COLLATE "C") FILTER (WHERE ${bicimli}) AS en_eski`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE NOT COALESCE(${bicimli}, false)))::int AS tarihsiz`);
    for (const yasak of ['timestamptz', 'updated_at', 'durumZamani', 'kalemTeslim', 'etiketBasildi', 'bildirim']) expect(tekSatir, yasak).not.toContain(yasak);
  });

  it('SQL deseni `MAGAZA_UTC_ZAMAN_DESENI` ile aynı dili tanır (ters bölüsüz yazım; şablon dizgesi ters bölüyü yutardı)', () => {
    const desenler = [...new Set([...tekSatir.matchAll(/~ '([^']+)'/g)].map(e => e[1]))];
    expect(desenler).toHaveLength(1);
    expect(desenler[0]).not.toContain('\\');
    const sql = new RegExp(desenler[0]);
    const ornekler = [
      new Date(0).toISOString(), '2026-10-08T09:00:00.000Z', '', '0', '2020-bozuk', '1759900000000', '08.10.2026 09:00', '2026-09-01T09:00:00Z',
      '2026-10-08T09:00:00.000Z ', 'x2026-10-08T09:00:00.000Z', '2026-10-08T12:00:00.000+03:00', '2026-10-08t09:00:00.000z',
    ];
    for (const o of ornekler) expect(sql.test(o), JSON.stringify(o)).toBe(MAGAZA_UTC_ZAMAN_DESENI.test(o));
  });

  it('modül YAPRAK: pgShim / server.ts / bekçi içe aktarılmaz (ops özeti ve bekçi onu içe aktarır; ters yön döngü olurdu)', () => {
    const kaynak = oku(join(SRC_KOK, 'server', 'kanal', 'magazaAcikSayim.ts'));
    const hedefler = [...kaynak.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(e => e[1]);
    expect(hedefler.sort()).toEqual(['../../lib/magazaTalep.js', './magazaDurum.js']);
  });
});

// ── Dilim 2b (§ 10.7): silinmiş talep sayımı ─────────────────────────────────────────────────────────────────────────
describe('magazaSilinmisSayimi — «silinmiş: N (son 30 gün)» (saf yarı)', () => {
  const SIMDI = Date.parse('2026-10-31T09:00:00.000Z');

  it('satır çözücü: iki sayı; fazladan sütun (silen kişi, müşteri) sayıma geçmez', () => {
    expect(magazaSilinmisSayiminiCoz({ pencerede: 4, tarihsiz: 1 })).toEqual({ pencerede: 4, tarihsiz: 1 });
    const sonuc = magazaSilinmisSayiminiCoz({ pencerede: 0, tarihsiz: 0, kim: 'AHMET YILMAZ', kanal: 'erp' });
    expect(sonuc).toEqual({ pencerede: 0, tarihsiz: 0 });
    expect(JSON.stringify(sonuc)).not.toMatch(/AHMET|kanal/);
  });

  it.each([
    ['satır yok', undefined], ['null', null], ['dizi', [{ pencerede: 1, tarihsiz: 0 }]], ['dizge', 'x'],
    ['pencerede eksik', { tarihsiz: 0 }], ['tarihsiz eksik', { pencerede: 1 }],
    ['metin sayı (sıfır SAYILMAZ)', { pencerede: '1', tarihsiz: 0 }], ['eksi', { pencerede: -1, tarihsiz: 0 }],
    ['kesirli', { pencerede: 1, tarihsiz: 0.5 }], ['NaN', { pencerede: Number.NaN, tarihsiz: 0 }], ['null hücre', { pencerede: 1, tarihsiz: null }],
  ] as const)('okunamayan satır `null` döner — uydurma sıfır yok (%s)', (_ad, satir) => {
    expect(magazaSilinmisSayiminiCoz(satir)).toBeNull();
  });

  it('okuyucu: TEK sorgu; parametreler koleksiyon + pencerenin başı (şimdi − 30 gün, `toISOString()`); ilk satır çözülür', async () => {
    const query = vi.fn(async () => ({ rows: [{ pencerede: 3, tarihsiz: 0 }, { pencerede: 99, tarihsiz: 99 }] }));
    expect(await magazaSilinmisSayimi({ query }, SIMDI)).toEqual({ pencerede: 3, tarihsiz: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(MAGAZA_SILINMIS_SAYIM_SQL, ['magazaTalepleri', '2026-10-01T09:00:00.000Z']);
    expect(MAGAZA_SILINMIS_PENCERESI_GUN).toBe(30);
  });

  it('satır dönmezse / `rows` dizi değilse `null`; sorgu hatası FIRLATILIR (çağıran yalnız kodu yazar)', async () => {
    expect(await magazaSilinmisSayimi({ query: async () => ({ rows: [] }) }, SIMDI)).toBeNull();
    const bozuk: unknown = { rows: null };
    expect(await magazaSilinmisSayimi({ query: async () => bozuk as { rows: unknown[] } }, SIMDI)).toBeNull();
    const hata = Object.assign(new Error('x'), { code: '57014' });
    await expect(magazaSilinmisSayimi({ query: async () => { throw hata; } }, SIMDI)).rejects.toBe(hata);
  });
});

describe('MAGAZA_SILINMIS_SAYIM_SQL — kaynak çitleri', () => {
  const tekSatir = MAGAZA_SILINMIS_SAYIM_SQL.replace(/\s+/g, ' ');
  const bicimli = `(data->'silindi'->>'zaman') COLLATE "C" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'`;

  it('evren SİLİNMİŞ talepler: ölçüt her yerdeki AYNI sabit (`MAGAZA_SILINMIS_SQL`, `jsonb_typeof … = \'object\'`); `IS NULL` YOK (JSON null ile yokluğu karıştırırdı)', () => {
    expect(MAGAZA_SILINMIS_SQL).toBe(`jsonb_typeof(data->'silindi') = 'object'`);
    expect(tekSatir.endsWith(`FROM docs WHERE coll = $1 AND ${MAGAZA_SILINMIS_SQL}`)).toBe(true);
    expect(tekSatir).not.toContain('${');
    expect(tekSatir).not.toMatch(/IS (NOT )?NULL/);
    // Ölçüt modülde yeniden YAZILMADI: `jsonb_typeof(data->'silindi')` kaynakta yalnız magazaDurum.ts'te.
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaAcikSayim.ts')).map(k => k.kod).join('\n');
    expect(kod).not.toContain('jsonb_typeof');
    expect(kod).toContain('${MAGAZA_SILINMIS_SQL}');
  });

  it('iki sütun, iki parametre; yaş `silindi.zaman` METNİYLE ve yalnız biçimli değerde; biçimsiz / eksik zaman `tarihsiz`', () => {
    expect([...tekSatir.matchAll(/::int AS ([a-z_]+)/g)].map(e => e[1])).toEqual(['pencerede', 'tarihsiz']);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE COALESCE(${bicimli} AND (data->'silindi'->>'zaman') COLLATE "C" >= $2, false)))::int AS pencerede`);
    expect(tekSatir).toContain(`(count(*) FILTER (WHERE NOT COALESCE(${bicimli}, false)))::int AS tarihsiz`);
    expect([...new Set(tekSatir.match(/\$\d+/g))].sort()).toEqual(['$1', '$2']);
    for (const yasak of ['timestamptz', 'updated_at', 'olusturma', 'GROUP BY', `'kim'`, `'kanal'`, 'musteri']) expect(tekSatir, yasak).not.toContain(yasak);
  });

  it('biçim deseni açık sayımındaki desenle AYNI metin (tek sabit: iki sorgu aynı zamana farklı hüküm vermez)', () => {
    const desen = (sql: string): string[] => [...new Set([...sql.matchAll(/~ '([^']+)'/g)].map(e => e[1]))];
    expect(desen(MAGAZA_SILINMIS_SAYIM_SQL)).toEqual(desen(MAGAZA_ACIK_SAYIM_SQL));
    expect(desen(MAGAZA_SILINMIS_SAYIM_SQL)).toHaveLength(1);
    const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaAcikSayim.ts')).map(k => k.kod).join('\n');
    expect(kod.match(/\[0-9\]\{4\}-/g)).toHaveLength(1);   // desen literali modülde TEK kez yazılı
  });
});
