/** kdvOzetSorgusu — KDV özeti: iskonto düşülmüş matrah, yalnız fatura + faturaya bağlı irsaliye satırları (2026-09-29). */
import { describe, it, expect } from 'vitest';
import { kdvOzetSorgusu } from './kdvOzetSorgusu';

const KOSUL = '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))';
const TAM = ['sth_tarih', 'sth_tip', 'sth_vergi', 'sth_masraf_vergi_pntr', 'sth_vergi_pntr', 'sth_tutar', 'sth_iptal', 'sth_evraktip',
  'sth_fat_uid', 'sth_iskonto1', 'sth_iskonto2', 'sth_masraf1', 'sth_masraf_vergi', 'sth_isk_mas1'];

describe('kdvOzetSorgusu', () => {
  it('matrah iskonto düşülerek (tek kaynak satır neti); pntr TAM ad (sth_masraf_vergi_pntr yakalanmaz)', () => {
    const q = kdvOzetSorgusu(TAM, '2026-08-01', '2026-08-31', KOSUL);
    if (!q.ok) throw new Error(q.hata);
    expect(q.sql).toContain('SUM(sth_tutar - (ISNULL(sth_iskonto1, 0) + ISNULL(sth_iskonto2, 0)) + (ISNULL(sth_masraf1, 0))) AS matrah');
    expect(q.sql).toMatch(/^SELECT sth_vergi_pntr AS oranPntr, sth_tip AS tip, SUM\(sth_vergi\) AS kdv, /);
    expect(q.sql).toContain('GROUP BY sth_tip, sth_vergi_pntr ORDER BY sth_tip');
    expect(q.sql).not.toMatch(/sth_masraf_vergi_pntr|sth_isk_mas1|ISNULL\(sth_masraf_vergi,/);
    expect(q.oranKolonuVar).toBe(true);
    expect(q.notlar).toEqual([]);
  });

  it('yalnız fatura satırları + İPTALSİZ faturaya bağlı irsaliye satırları (transfer satırı alış matrahına girmez)', () => {
    const q = kdvOzetSorgusu(TAM, '2026-08-01', '2026-08-31', KOSUL);
    if (!q.ok) throw new Error(q.hata);
    // Dönem: fatura satırı kendi tarihiyle, faturaya bağlı irsaliye satırı FATURANIN tarihiyle (cha_tarihi).
    expect(q.sql).toContain("WHERE ISNULL(sth_iptal, 0) = 0 AND ((sth_evraktip IN (3, 4) AND sth_tarih BETWEEN '2026-08-01' AND '2026-08-31') "
      // K1: bağlı-fatura dalı yalnız fatura DIŞI satırlar için — fatura satırı (3/4) ay sınırında iki döneme girmesin.
      + `OR (sth_evraktip NOT IN (3, 4) AND EXISTS (SELECT 1 FROM CARI_HESAP_HAREKETLERI cha WHERE cha.cha_Guid = STOK_HAREKETLERI.sth_fat_uid AND ${KOSUL} AND ISNULL(cha.cha_iptal, 0) = 0 `
      + "AND cha.cha_tarihi BETWEEN '2026-08-01' AND '2026-08-31')))");
    // Parantez dengesi (elle yazılmış OR/AND zinciri — SQL Server'da lokal sınanamıyor).
    expect((q.sql.match(/\(/g) ?? []).length).toBe((q.sql.match(/\)/g) ?? []).length);
    expect(q.sql.match(/sth_tarih BETWEEN/g)).toHaveLength(1);                 // irsaliye satırı kendi tarihiyle SÜZÜLMEZ
  });

  it('bağlama kolonu yoksa yalnız 3/4 + not; evraktip yoksa süzgeç yok + not (yüksek sesle)', () => {
    const b = kdvOzetSorgusu(TAM.filter(k => k !== 'sth_fat_uid'), 'a', 'b', KOSUL);
    if (!b.ok) throw new Error(b.hata);
    expect(b.sql).toContain("AND sth_evraktip IN (3, 4) AND sth_tarih BETWEEN 'a' AND 'b' GROUP BY");
    expect(b.notlar.join(' ')).toContain('sth_fat_uid şemada yok');
    const e = kdvOzetSorgusu(TAM.filter(k => k !== 'sth_evraktip'), 'a', 'b', KOSUL);
    if (!e.ok) throw new Error(e.hata);
    expect(e.sql).not.toContain('sth_evraktip');
    expect(e.sql).toContain("sth_tarih BETWEEN 'a' AND 'b'");                        // tarih süzgeci evraktip yokken de var
    expect(e.notlar.join(' ')).toContain('SÜZÜLMEDİ');
  });

  it('eski test şeması (evraktip/iskonto yok) çalışmaya devam eder: matrah SUM(sth_tutar) + iki not', () => {
    const q = kdvOzetSorgusu(['sth_tarih', 'sth_tip', 'sth_vergi', 'sth_vergi_pntr', 'sth_tutar', 'sth_iptal'], 'a', 'b', KOSUL);
    if (!q.ok) throw new Error(q.hata);
    expect(q.sql).toContain('SUM(sth_tutar) AS matrah');
    expect(q.notlar).toHaveLength(2);
  });

  it('zorunlu kolon yoksa hata (taxSummary\'ye dokunulmaz); tutar yoksa matrah seçilmez; pntr yoksa oran kolonu yok', () => {
    const h = kdvOzetSorgusu(['sth_tip', 'sth_tarih'], 'a', 'b', KOSUL);
    expect(h).toMatchObject({ ok: false });
    const t = kdvOzetSorgusu(['sth_tarih', 'sth_tip', 'sth_vergi'], 'a', 'b', KOSUL);
    if (!t.ok) throw new Error(t.hata);
    expect(t.sql).not.toContain('AS matrah');
    expect(t.oranKolonuVar).toBe(false);
  });

  it('yalnız ASCII; şemadan gelen tuhaf kolon adı reddedilir', () => {
    const q = kdvOzetSorgusu(TAM, '2026-08-01', '2026-08-31', KOSUL);
    if (q.ok) expect(q.sql).not.toMatch(/[^\x00-\x7F]/);
    expect(kdvOzetSorgusu([...TAM, 'sth_iskonto9; DROP'], 'a', 'b', KOSUL)).toMatchObject({ ok: true });   // desene uymaz → girmez
    expect(kdvOzetSorgusu(['sth_tarih', 'sth_tip', 'sth_vergi', 'STH_TUTAR'], 'a', 'b', KOSUL)).toMatchObject({ ok: true });
  });
});
