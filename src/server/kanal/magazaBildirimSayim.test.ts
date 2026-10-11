// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kaynakDosyalari, kodSatirlari, gorece, SRC_KOK } from '../../test/kaynakTarama';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import { magazaBildirimSayimi, MAGAZA_BILDIRIM_SAYIM_SQL, MAGAZA_BILDIRIM_DURUMLARI, MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN } from './magazaBildirimSayim';

const SIMDI = Date.UTC(2026, 9, 9, 12, 0, 0);
const GIZLI = 'Zeynep Kaya 0532 111 22 33';

/** Sorgunun tek satırı: ilk bildirim sütunları + (dilim 2b) revize sütunları. Biri eksikse sayım `null`'a düşer (aşağıda). */
function tamSatir(): Record<string, unknown> {
  const satir: Record<string, unknown> = {
    toplam: 7, durum_bekliyor: 1, durum_gitti: 4, durum_gonderilemedi: 1, durum_yapilandirilmamis: 1,
    revize_durum_bekliyor: 0, revize_durum_gitti: 2, revize_durum_gonderilemedi: 1, revize_durum_yapilandirilmamis: 0,
  };
  for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) {
    satir[`sinif_${s.replace(/-/g, '_')}`] = s === 'gonderen-reddi' ? 1 : 0;
    satir[`revize_sinif_${s.replace(/-/g, '_')}`] = s === 'baglanti' ? 1 : 0;
  }
  return satir;
}
const havuz = (rows: unknown[]) => {
  const sorgular: Array<[string, unknown[]]> = [];
  return { sorgular, query: async (sql: string, params: unknown[]) => { sorgular.push([sql, params]); return { rows }; } };
};

describe('magazaBildirimSayimi — kapalı kümelerden sayım, kişisel veri sızmaz', () => {
  it('SQL: koleksiyon + pencere parametresi (7 gün); her durum ve her hata sınıfı için FILTER sütunu; GROUP BY yok', async () => {
    const h = havuz([tamSatir()]);
    const sonuc = await magazaBildirimSayimi(h, SIMDI);
    expect(h.sorgular).toHaveLength(1);
    const [sql, params] = h.sorgular[0];
    expect(sql).toBe(MAGAZA_BILDIRIM_SAYIM_SQL);
    // Pencere yüklemi (totolojik `toBe` tek başına çit değil). Dilim 2b (bilerek değişen çit): satır kümesi iki pencerenin
    // BİRLEŞİMİ — ilk bildirim `olusturma`, revize `icerikZamani` ile; her sütun kendi penceresini FILTER'da yeniden söyler.
    expect(sql).toContain(`FROM docs WHERE coll = $1 AND ((data->>'olusturma') COLLATE "C" >= $2 OR (data->>'icerikZamani') COLLATE "C" >= $2)`);
    expect(sql).toContain(`(count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" >= $2))::int AS toplam`);
    expect(params).toEqual([MAGAZA_TALEP_KOLEKSIYONU, new Date(SIMDI - 7 * 24 * 60 * 60 * 1000).toISOString()]);
    expect(MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN).toBe(7);
    expect(sql).not.toMatch(/GROUP BY/i);
    expect([...new Set(sql.match(/\$\d+/g))].sort()).toEqual(['$1', '$2']);
    for (const d of MAGAZA_BILDIRIM_DURUMLARI) expect(sql).toContain(`durum' = '${d}'))::int AS durum_${d}`);
    for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) expect(sql).toContain(`hataSinifi' = '${s}'))::int AS sinif_${s.replace(/-/g, '_')}`);
    expect(sonuc).toEqual({
      toplam: 7,
      durum: { bekliyor: 1, gitti: 4, gonderilemedi: 1, yapilandirilmamis: 1 },
      hataSinifi: { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 1, 'alici-reddi': 0, diger: 0 },
      revize: {
        durum: { bekliyor: 0, gitti: 2, gonderilemedi: 1, yapilandirilmamis: 0 },
        hataSinifi: { kimlik: 0, tls: 0, baglanti: 1, 'gonderen-reddi': 0, 'alici-reddi': 0, diger: 0 },
      },
    });
  });

  it('(2b, § 10.7 (b)) revize sütunları: her durum ve her hata sınıfı için `revize_durum_<d>` / `revize_sinif_<s>`; alan `bildirimRevize`, pencere `icerikZamani`', () => {
    const sql = MAGAZA_BILDIRIM_SAYIM_SQL;
    for (const d of MAGAZA_BILDIRIM_DURUMLARI) {
      expect(sql).toContain(`(count(*) FILTER (WHERE (data->>'icerikZamani') COLLATE "C" >= $2 AND data->'bildirimRevize'->>'durum' = '${d}'))::int AS revize_durum_${d}`);
      // İlk bildirimin sütunu KENDİ penceresiyle (anlamı dilim 1'dekiyle aynı: pencerede OLUŞTURULAN talepler).
      expect(sql).toContain(`(count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" >= $2 AND data->'bildirim'->>'durum' = '${d}'))::int AS durum_${d}`);
    }
    for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) {
      // (İnceleme 2b, bulgu 7 — bilerek değişen çit) revize sınıf sütunu durum koşulu TAŞIR: yalnız `bekliyor` / `gonderilemedi`.
      expect(sql).toContain(`(count(*) FILTER (WHERE (data->>'icerikZamani') COLLATE "C" >= $2 AND data->'bildirimRevize'->>'durum' IN ('bekliyor', 'gonderilemedi') AND data->'bildirimRevize'->>'hataSinifi' = '${s}'))::int AS revize_sinif_${s.replace(/-/g, '_')}`);
      // İlk bildirimin sınıf sütunu DEĞİŞMEDİ (dilim 1 anlamı): durum koşulu yok — `YAZ_SQL` nesneyi bütünüyle değiştirir, kalıntı oluşmaz.
      expect(sql).toContain(`(count(*) FILTER (WHERE (data->>'olusturma') COLLATE "C" >= $2 AND data->'bildirim'->>'hataSinifi' = '${s}'))::int AS sinif_${s.replace(/-/g, '_')}`);
    }
    // Durum koşulu sınıf sütunu başına TEK kez; kümede `gitti` ve `yapilandirilmamis` YOK (ikisinde `hataSinifi` kalıntıdır).
    expect(sql.match(/data->'bildirimRevize'->>'durum' IN \('bekliyor', 'gonderilemedi'\)/g)).toHaveLength(MAGAZA_BILDIRIM_HATA_SINIFLARI.length);
    expect(sql).not.toMatch(/'durum' IN \([^)]*'(gitti|yapilandirilmamis)'/);
    expect(sql).not.toMatch(/data->'bildirim'->>'durum' IN/);
    // Sütun sayısı: toplam + 2 × (4 durum + 6 sınıf). Başka sütun yok (kapalı küme).
    expect(sql.match(/\)::int AS [a-z_]+/g)).toHaveLength(1 + 2 * (MAGAZA_BILDIRIM_DURUMLARI.length + MAGAZA_BILDIRIM_HATA_SINIFLARI.length));
    // İki alan birbirinin penceresini KULLANMAZ; revize yaşı işçinin tazelediği `bildirimRevize.zaman` DEĞİLDİR.
    expect(sql).not.toMatch(/icerikZamani'\) COLLATE "C" >= \$2 AND data->'bildirim'->/);
    expect(sql).not.toMatch(/olusturma'\) COLLATE "C" >= \$2 AND data->'bildirimRevize'->/);
    expect(sql).not.toContain(`->>'zaman'`);
    // İki bildirim alanından okunan alt alanlar yalnız `durum` ve `hataSinifi` (alan adı, kim, sürüm, deneme sayısı yanıta taşınmaz).
    expect([...new Set([...sql.matchAll(/data->'bildirim(?:Revize)?'->>'([A-Za-z]+)'/g)].map(e => e[1]))].sort()).toEqual(['durum', 'hataSinifi']);
  });

  it('durum kümesi sözleşmedeki dört değer; sınıf kümesi sözleşmenin altı değeri (altı sütun)', () => {
    expect([...MAGAZA_BILDIRIM_DURUMLARI].sort()).toEqual(['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis']);
    expect(MAGAZA_BILDIRIM_HATA_SINIFLARI).toHaveLength(6);
  });

  it('bilinmeyen sütun ve metin yanıta GEÇMEZ; sayılar dize gelse de tam sayıya çevrilir', async () => {
    const satir = { ...tamSatir(), hata_metni: GIZLI, revize_alanlar: GIZLI, toplam: '7', revize_durum_gitti: '2' };
    const sonuc = await magazaBildirimSayimi(havuz([satir]), SIMDI);
    expect(JSON.stringify(sonuc)).not.toContain('Zeynep');
    expect(JSON.stringify(sonuc)).not.toContain('hata_metni');
    expect(JSON.stringify(sonuc)).not.toContain('revize_alanlar');
    expect(sonuc?.toplam).toBe(7);
    expect(sonuc?.revize.durum.gitti).toBe(2);
  });

  it.each([
    ['satır yok', []],
    ['bir sütun eksik', [(() => { const s = tamSatir(); delete s.durum_gitti; return s; })()]],
    ['sütun sayı değil', [{ ...tamSatir(), durum_gitti: 'çok' }]],
    ['eksi sayı', [{ ...tamSatir(), toplam: -1 }]],
    ['ondalık', [{ ...tamSatir(), toplam: 1.5 }]],
    // Dilim 2b: revize sütunları da ZORUNLU — eski (2a) biçimli satır «revize sıfır» sayılmaz.
    ['revize durum sütunu eksik', [(() => { const s = tamSatir(); delete s.revize_durum_bekliyor; return s; })()]],
    ['revize sınıf sütunu eksik', [(() => { const s = tamSatir(); delete s.revize_sinif_diger; return s; })()]],
    ['revize sütunu null', [{ ...tamSatir(), revize_durum_gitti: null }]],
    ['revize sütunlarının hiçbiri yok (2a satırı)', [Object.fromEntries(Object.entries(tamSatir()).filter(([ad]) => !ad.startsWith('revize_')))]],
  ])('%s → null (uydurma sıfır yok)', async (_ad, rows) => {
    expect(await magazaBildirimSayimi(havuz(rows), SIMDI)).toBeNull();
  });

  it('sorgu fırlatırsa null, fırlatmaz', async () => {
    expect(await magazaBildirimSayimi({ query: async () => { throw new Error(`relation docs: ${GIZLI}`); } }, SIMDI)).toBeNull();
  });
});

describe('ÇİT: bildirim durumu kümesinin TEK tanımı (§ 10.8; kapı 3, K1 / K2)', () => {
  const BEKCI = join(SRC_KOK, 'server', 'opsWatchdog.ts');
  const kodu = (dosya: string): string => kodSatirlari(dosya).map(s => s.kod).join('\n');

  it("`['bekliyor', 'gitti'` literali `src/` altındaki üretim kodunda YALNIZ bu modülde: bekçi içe aktarır, kopyalamaz", () => {
    const tasiyanlar = kaynakDosyalari(SRC_KOK).filter(d => /\[\s*'bekliyor',\s*'gitti'/.test(kodu(d))).map(gorece);
    expect(tasiyanlar).toEqual(['src/server/kanal/magazaBildirimSayim.ts']);
  }, 60_000);   // `src/`in tamamı tek testte taranır: yük altında 5 sn'lik varsayılan süre yetmez (depo kalıbı)

  it('bekçi kümeyi BU modülden içe aktarır ve saydığı durumları ondan SÜZER (ikinci bir durum listesi yazmaz)', () => {
    const bekci = kodu(BEKCI);
    expect(bekci).toContain("import { MAGAZA_BILDIRIM_DURUMLARI } from './kanal/magazaBildirimSayim.js';");
    expect(bekci).toMatch(/const GITMEYEN_DURUMLAR: readonly GitmeyenDurum\[\] = MAGAZA_BILDIRIM_DURUMLARI\s+\.filter\(\(d\): d is GitmeyenDurum => d !== 'gitti'\)/);
    // Sayım sorgusunun üreticisinde durum dizgesi ELLE yazılmaz: sütunlar ve `IN (…)` listesi süzülmüş kümeden kurulur.
    const uretici = bekci.slice(bekci.indexOf('export function magazaTalepSayimSql('), bekci.indexOf('const MAGAZA_TALEP_SAYIM_SQL'));
    expect(uretici).toContain('GITMEYEN_DURUMLAR.map(');
    expect(uretici).not.toMatch(/'(gonderilemedi|yapilandirilmamis|gitti)'/);
    expect(uretici.match(/'bekliyor'/g)).toEqual(["'bekliyor'"]);   // tek kullanım: «bekleyen» sütununun ek yaş koşulu
  });
});
