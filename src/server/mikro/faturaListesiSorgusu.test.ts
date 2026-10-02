/** faturaListesiSorgusu — import + önizlemenin ORTAK SQL metni (kapı E1/E2, 2026-09-28). */
import { describe, it, expect } from 'vitest';
import { faturaListesiSorgusu, faturaListesiSaglamasi } from './faturaListesiSorgusu';

const ANA = ['cha_Guid', 'cha_tip', 'cha_meblag', 'cha_aratoplam', 'cha_ft_iskonto1', 'cha_ft_iskonto2', 'cha_isk_mas1'];
const SATIR = ['sth_evraktip', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_tutar', 'sth_vergi', 'sth_vergi_pntr', 'sth_iptal', 'sth_iskonto1', 'sth_masraf1', 'sth_masraf_vergi'];

describe('faturaListesiSorgusu', () => {
  it('matrah başlıktan (CROSS APPLY b.bm), yedek satır neti; KDV satırdan AMA ortak anahtarda/satırsızda meblağ − matrah', () => {
    const q = faturaListesiSorgusu({ ana: ANA, satir: SATIR });
    expect(q.matrahYazilir).toBe(true);
    expect(q.fromEk).toContain('CROSS APPLY (SELECT (cha.cha_aratoplam - (ISNULL(cha.cha_ft_iskonto1, 0) + ISNULL(cha.cha_ft_iskonto2, 0))) AS bm) b');
    expect(q.fromEk).toContain('SUM(sth_tutar - (ISNULL(sth_iskonto1, 0)) + (ISNULL(sth_masraf1, 0))) AS matrahNet');
    expect(q.fromEk).toContain('COUNT(*) AS satirSayisi');
    expect(q.fromEk).toContain('WHERE sth_evraktip IN (3, 4) AND ISNULL(sth_iptal, 0) = 0 GROUP BY');   // iptal satırı matraha karışmaz
    expect(q.fromEk).toContain('AND sat.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END');
    const W = 'COUNT(*) OVER (PARTITION BY cha.cha_tip, cha.cha_evrakno_seri, cha.cha_evrakno_sira)';
    const M = `CASE WHEN ${W} > 1 THEN b.bm ELSE COALESCE(b.bm, sat.matrahNet) END`;
    expect(q.secim).toContain(`${M} AS matrah`);                            // ortak anahtarda satır toplamına düşmez (çift yazım)
    expect(q.secim).toContain(`CASE WHEN ${W} > 1 OR sat.kdv IS NULL THEN cha.cha_meblag - ${M} ELSE sat.kdv END AS kdvTutari`);
    expect(q.secim).toContain(`CASE WHEN b.bm IS NOT NULL THEN 'baslik' WHEN sat.matrahNet IS NOT NULL AND ${W} = 1 THEN 'satir' END AS matrahKaynagi`);
    expect(q.secim).toContain('END AS ortakAnahtar');
    expect(q.notlar).toEqual([]);
  });

  it('T-SQL kuralları: aynı SELECT\'teki takma ada başvuru YOK, yalnız ASCII (kapı E1 — lokalde Mikro yok, test yakalamalı)', () => {
    const q = faturaListesiSorgusu({ ana: ANA, satir: SATIR });
    const sql = `SELECT ${q.secim} FROM CARI_HESAP_HAREKETLERI cha${q.fromEk}`;
    expect(sql).not.toMatch(/[^\x00-\x7F]/);
    expect(q.secim).not.toMatch(/-\s*matrah\b|WHEN\s+baslikSayisi|WHEN\s+ortakAnahtar|\bmatrah\s*[+-]/);
    // Her takma ad yalnız bir kez, tanımlandığı yerde geçer.
    for (const ad of ['matrah', 'kdvTutari', 'matrahKaynagi', 'ortakAnahtar']) expect(q.secim.match(new RegExp(`AS ${ad}\\b`, 'g'))).toHaveLength(1);
  });

  it('ft kolonu yoksa başlık matrahı NULL → satır netine düşer (brüt aratoplam YAZILMAZ); not düşer', () => {
    const q = faturaListesiSorgusu({ ana: ['cha_Guid', 'cha_aratoplam'], satir: SATIR });
    expect(q.fromEk).toContain('CROSS APPLY (SELECT CAST(NULL AS FLOAT) AS bm) b');
    expect(q.notlar.join(' ')).toContain('matrah satırlardan');
  });

  it('iskonto ailesi yoksa satır matrahı brüt olabilir diye not; sth_tutar yoksa satır matrahı NULL', () => {
    expect(faturaListesiSorgusu({ ana: ANA, satir: ['sth_tutar', 'sth_vergi'] }).notlar.join(' ')).toContain('iskontosuz (brüt)');
    const q = faturaListesiSorgusu({ ana: ANA, satir: ['sth_vergi'] });
    expect(q.fromEk).toContain('CAST(NULL AS FLOAT) AS matrahNet');
  });

  it('şema OKUNAMADIYSA (boş liste) matrah/KDV alanları SEÇİLMEZ → merge önceki değerleri korur (kapı E2)', () => {
    for (const sema of [{ ana: [], satir: SATIR }, { ana: ANA, satir: [] }]) {
      const q = faturaListesiSorgusu(sema);
      expect(q).toMatchObject({ secim: 'cha.*', fromEk: '', matrahYazilir: false });
      expect(q.secim).not.toMatch(/matrah|kdvTutari/);
      expect(q.notlar[0]).toContain('GÜNCELLENMEDİ');
    }
  });
});

describe('faturaListesiSaglamasi (kapanış ölçüsü)', () => {
  const f = (o: Record<string, unknown>) => ({ matrahKaynagi: 'baslik', ortakAnahtar: 0, satirSayisi: 1, ...o });
  it('tutarlı fatura tutar; tevkifat (311: meblağ KDV/2 kadar düşük) tutmayan sayılır', () => {
    expect(faturaListesiSaglamasi([f({ matrah: 283500, kdvTutari: 33736.5, cha_meblag: 317236.5 })])).toBe('matrah sağlaması: tümü tutuyor');
    expect(faturaListesiSaglamasi([f({ matrah: 11190.86, kdvTutari: 2238.17, cha_meblag: 12309.95, satirSayisi: 4 })]))
      .toContain('1 faturada matrah + KDV ≠ meblağ');
  });
  it('KDV\'si türetilen (ortak anahtar / satırsız) sağlamaya girmez, ayrı sayılır; satır kaynaklı, bilinmeyen, eksi KDV sayılır', () => {
    const t = faturaListesiSaglamasi([
      f({ matrah: 10000, kdvTutari: 2000, cha_meblag: 12000, ortakAnahtar: 1, satirSayisi: 2 }),
      f({ matrah: 16769.52, kdvTutari: 3353.9, cha_meblag: 20123.42, satirSayisi: null }),
      f({ matrah: 100, kdvTutari: 20, cha_meblag: 120, matrahKaynagi: 'satir' }),
      f({ matrah: null, kdvTutari: null, cha_meblag: 50 }),
      f({ matrah: 500, kdvTutari: -1, cha_meblag: 499 }),
    ]);
    expect(t).toContain('2 faturada KDV meblağdan türetildi');
    expect(t).toContain('1 faturada matrah satırlardan');
    expect(t).toContain('1 faturada matrah BİLİNMİYOR');
    expect(t).toContain('⚠ 1 faturada KDV eksi');
    expect(t).not.toContain('≠ meblağ');
  });
  it('şema okunamadığı koşuda (satırlarda matrah alanı yok) boş metin', () => {
    expect(faturaListesiSaglamasi([{ cha_meblag: 100 }])).toBe('');
  });
});
