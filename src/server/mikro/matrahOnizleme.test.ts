/** matrahOnizleme — yeni import SQL'inin gerçek motorda SALT OKUMA önizlemesi + fatura dışı satır bağlantı ölçümü (2026-09-28). */
import { describe, it, expect } from 'vitest';
import { onizlemeSorgulari, baglantiSorgulari, onizlemeSatiri, ONIZLEME_EVRAKLARI } from './matrahOnizleme';
import { faturaListesiSorgusu } from './faturaListesiSorgusu';

const KOSUL = '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))';
const ANA = ['cha_Guid', 'cha_tip', 'cha_meblag', 'cha_aratoplam', 'cha_ft_iskonto1'];
const SATIR = ['sth_evraktip', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_tutar', 'sth_vergi', 'sth_vergi_pntr', 'sth_iptal', 'sth_iskonto1', 'sth_fat_uid', 'sth_fat_recid_recno'];

describe('onizlemeSorgulari', () => {
  const q = faturaListesiSorgusu({ ana: ANA, satir: SATIR });
  const o = onizlemeSorgulari(q, KOSUL);

  it('örnek: importun BİREBİR biçimi (SELECT secim FROM tablo fromEk WHERE ekKosul … ORDER BY cha.cha_Guid OFFSET/FETCH) + bilinen faturalar', () => {
    expect(o.ornek.startsWith(`SELECT ${q.secim} FROM CARI_HESAP_HAREKETLERI cha${q.fromEk} WHERE ${KOSUL} AND ISNULL(cha.cha_iptal, 0) = 0 AND cha.cha_evrakno_sira IN (`)).toBe(true);
    expect(o.ornek).toContain(`IN (${ONIZLEME_EVRAKLARI.join(', ')}) ORDER BY cha.cha_Guid OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`);
  });

  it('genel ve tutmayan: TÜM iptalsiz faturalar üzerinde türetilmiş tablo; sağlama payı tek kaynaktan (0,06 + 0,02·satır)', () => {
    expect(o.genel).toMatch(/^SELECT COUNT\(\*\) AS fatura, /);
    expect(o.genel).toContain(`FROM (SELECT ${q.secim} FROM CARI_HESAP_HAREKETLERI cha${q.fromEk} WHERE ${KOSUL} AND ISNULL(cha.cha_iptal, 0) = 0) t`);
    expect(o.genel).not.toContain('evrakno_sira IN');
    expect(o.genel).toContain('ABS(t.matrah + t.kdvTutari - t.cha_meblag) > (0.06 + 0.02 * (CASE WHEN ISNULL(t.satirSayisi, 0) < 1 THEN 1 ELSE t.satirSayisi END))');
    expect(o.genel).toContain('SUM(CASE WHEN t.ortakAnahtar = 1 OR t.satirSayisi IS NULL THEN 1 ELSE 0 END) AS turetilmisKdv');
    expect(o.genel).toContain('SUM(CASE WHEN t.kdvTutari < 0 THEN 1 ELSE 0 END) AS negatifKdv');
    expect(o.genel).toContain('SUM(CASE WHEN t.satirSayisi IS NULL THEN 1 ELSE 0 END) AS satirsiz');
    expect(o.tutmayan).toMatch(/^SELECT TOP 40 /);
    expect(o.tutmayan).toContain('WHERE (t.matrah IS NULL OR t.kdvTutari IS NULL OR ABS(');
  });

  it('yalnız ASCII; yazım yok (INSERT/UPDATE/DELETE/MERGE geçmez)', () => {
    for (const sql of Object.values(o)) {
      expect(sql).not.toMatch(/[^\x00-\x7F]/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|DROP)\b/i);
    }
  });

  it('onizlemeSatiri: 186 kolonluk cha.* satırından yalnız karar alanları; eksik alan null', () => {
    expect(onizlemeSatiri({ cha_tip: 1, cha_evrakno_sira: 420, matrah: 283500, cha_aciklama: 'x', cha_kod: 'C' }))
      .toMatchObject({ cha_tip: 1, cha_evrakno_sira: 420, matrah: 283500, kdvTutari: null });
    expect(Object.keys(onizlemeSatiri({}))).not.toContain('cha_aciklama');
  });
});

describe('baglantiSorgulari (kapı E3 — K-M4 ölçümü)', () => {
  it('bağlama kolonu şemada VARSA (gerçek yazımıyla) faturaya bağlı satır sayılır ve bağlı faturalar listelenir', () => {
    const b = baglantiSorgulari(['sth_evraktip', 'STH_FAT_UID', 'sth_fat_recid_recno']);
    expect(b.bagKolonu).toBe('STH_FAT_UID');
    expect(b.dagilim).toContain('LEFT JOIN CARI_HESAP_HAREKETLERI c ON c.cha_Guid = s.STH_FAT_UID');
    expect(b.dagilim).toContain('AS faturayaBagli');
    expect(b.dagilim).toContain('WHERE s.sth_evraktip NOT IN (3, 4) AND ISNULL(s.sth_iptal, 0) = 0');
    expect(b.bagliFaturalar).toContain('JOIN CARI_HESAP_HAREKETLERI c ON c.cha_Guid = s.STH_FAT_UID');
    expect(b.bagliFaturalar).toContain('AS kendiSatir FROM (SELECT TOP 30 ');            // satırsız (0) / karma (> 0) ayrımı
    // Faturanın KENDİ satırı: evrak no + YÖN (satış 4 / alış 3) + iptalsiz — sat JOIN'iyle aynı eşleşme.
    expect(b.bagliFaturalar).toContain('WHERE f.sth_evrakno_seri = x.cha_evrakno_seri AND f.sth_evrakno_sira = x.cha_evrakno_sira '
      + 'AND f.sth_evraktip = CASE WHEN x.cha_tip = 0 THEN 4 ELSE 3 END AND ISNULL(f.sth_iptal, 0) = 0) AS kendiSatir');
    expect(b.adaylar).toEqual([]);
  });
  it('bağlama kolonu YOKSA ad uydurulmaz: bağlantı sorgusu yok, yalnız dağılım + örnek; adaylar bilgi olarak', () => {
    const b = baglantiSorgulari(['sth_evraktip', 'sth_fatura_guid_x']);
    expect(b.bagKolonu).toBeNull();
    expect(b.bagliFaturalar).toBeNull();
    expect(b.dagilim).not.toMatch(/JOIN|faturayaBagli/);
    expect(b.adaylar).toEqual(['sth_fatura_guid_x']);
  });
});
