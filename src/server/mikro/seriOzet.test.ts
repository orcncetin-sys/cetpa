// @vitest-environment node
/**
 * seriOzet — «Q serisi» ADIM 0 ölçümünün SAF yarısı (şartname T8): sorgu kurucuları yalnız SELECT üretir, kolon adı yalnız
 * şemadan (gerçek yazımıyla) girer, şemada olmayan ad `eksik`'e düşer ve SQL'de GEÇMEZ, seri yalnız doğrulanmış biçimde
 * metne girer; biçimleyicilerde sayı olmayan değer null'dır.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CHA_ADLARI, STH_ADLARI, FT_ISKONTO_ADLARI, CETPA_FATURA_SORGUSU, CETPA_SIPARIS_SORGUSU, SATIR_BAGI,
  seriGecerli, seriAnahtari, siraSayisi, sayi, bagEvrakTipi, chaPlani, sthPlani, faturaKosuluIfadesi,
  serilerSorgusu, eBelgeSorgusu, sonBasliklarSorgusu, satirOzetiSorgusu,
  serilerBicimle, eBelgeBicimle, sonBasliklarBicimle, cetpaFaturaOzeti, cetpaSiparisOzeti,
  type SorguPlani,
} from './seriOzet';
import { SRC_KOK } from '../../test/kaynakTarama';

// Şemadaki GERÇEK yazım kodda geçenden farklı olabilir (Türkçe harmanlama): fikstür bilerek karışık harfli.
const CHA_TAM = ['cha_Guid', 'cha_evrakno_seri', 'cha_evrakno_sira', 'cha_evrak_tip', 'cha_cinsi', 'cha_tip', 'cha_meblag', 'cha_tarihi',
  'cha_kod', 'cha_iptal', 'cha_aratoplam', ...FT_ISKONTO_ADLARI, 'cha_vergi', 'cha_uuid', 'cha_ebelge_turu', 'cha_efatura_belge_tipi',
  'cha_ebelge_Islemturu'];
const STH_TAM = ['sth_Guid', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_evraktip', 'sth_tutar', 'sth_vergi', 'sth_vergi_pntr',
  'sth_giris_depo_no', 'sth_cikis_depo_no', 'sth_iptal'];
const olmadan = (sema: readonly string[], ...adlar: string[]) => sema.filter(k => !adlar.includes(k));

const YASAK = /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|TRUNCATE|CREATE|GRANT|INTO)\b/i;
/** Salt okunur tek deyim: SELECT ile başlar; yazım / yönetim sözcüğü, deyim ayırıcı, yorum ve ASCII dışı karakter içermez. */
const saltOkunur = (sql: string) => {
  expect(sql).toMatch(/^SELECT /);
  expect(sql).not.toMatch(YASAK);
  expect(sql).not.toContain(';');
  expect(sql).not.toContain('--');
  expect(sql).not.toContain('/*');
  expect(sql).not.toMatch(/[^\x20-\x7E]/);
};
const sqlOf = (s: SorguPlani): string => {
  if ('atlandi' in s) throw new Error(`sorgu kurulmadı: ${s.atlandi}`);
  return s.sql;
};
const BOZUK_SERILER = ['Q;DROP', 'Q'.repeat(21), 'Ş', 'Q Q', ' Q', 'Q\n', "Q'", '', 'Q-1', 'q_1', 7, null, undefined, ['Q']];

describe('seri biçimi', () => {
  it('yalnız İngilizce harf ve rakam, 1-20 karakter', () => {
    for (const s of ['Q', 'q', 'F', 'CTA', 'LUCA', 'Q9a', 'A'.repeat(20), '0']) expect(seriGecerli(s), s).toBe(true);
    for (const s of BOZUK_SERILER) expect(seriGecerli(s), JSON.stringify(s)).toBe(false);
  });
  it('Cetpa tarafı karşılaştırma anahtarı: kırpılmış + ASCII büyük harf (q = Q); boş ve null aynı anahtar', () => {
    expect(seriAnahtari(' q ')).toBe('Q');
    expect(seriAnahtari('Q')).toBe(seriAnahtari('q'));
    expect(seriAnahtari(null)).toBe('');
    expect(seriAnahtari('')).toBe('');
  });
  it('evrak sırası SQL\'e yalnız rakam olarak girer', () => {
    expect([389, '389', ' 12 ', '0389'].map(siraSayisi)).toEqual([389, 389, 12, 389]);
    for (const v of ['1; DROP', '1 OR 1=1', '-1', '1.5', 1.5, '1234567890', '', null, undefined, true, {}, [1]]) expect(siraSayisi(v), JSON.stringify(v)).toBeNull();
  });
});

describe('kolon adları: yalnız depoda ZATEN geçen adlar, yalnız şemada VARSA', () => {
  // Her adın geçtiği BAŞKA bir kaynak dosya (yorumdaki `dosya:satır` kanıtının dosya düzeyi çiti). Yeni ad eklenince bu tabloya
  // kanıtıyla girmek ZORUNDADIR — tahmin edilen ad burada kırılır.
  const KANIT: Record<string, string> = {
    cha_evrakno_seri: 'server/mikro/eslemeFatura.ts', cha_evrakno_sira: 'server/mikro/eslemeFatura.ts', cha_evrak_tip: 'server/mikroMirror.ts',
    cha_cinsi: 'server/mikroMirror.ts', cha_tip: 'server/mikro/eslemeFatura.ts', cha_meblag: 'server/mikro/eslemeFatura.ts',
    cha_tarihi: 'server/mikro/eslemeFatura.ts', cha_kod: 'server/mikro/eslemeFatura.ts', cha_iptal: 'server/mikro/kdvOzetSorgusu.ts',
    cha_aratoplam: 'lib/faturaMatrahi.ts', cha_vergi: 'server/mikroMirror.ts', cha_uuid: 'server/mikro/ebelgeDurumTani.ts',
    cha_ebelge_turu: 'server/mikro/ebelgeDurumTani.ts', cha_efatura_belge_tipi: 'server/mikro/ebelgeDurumTani.ts',
    cha_ebelge_Islemturu: 'server/mikro/ebelgeDurumTani.ts',
    ...Object.fromEntries(FT_ISKONTO_ADLARI.map(ad => [ad, 'server/routes/mikroRoutes.ts'])),
    sth_evrakno_seri: 'server/mikro/faturaListesiSorgusu.ts', sth_evrakno_sira: 'server/mikro/faturaListesiSorgusu.ts',
    sth_evraktip: 'server/mikro/faturaListesiSorgusu.ts', sth_tutar: 'lib/faturaMatrahi.ts', sth_vergi: 'server/mikro/faturaListesiSorgusu.ts',
    sth_vergi_pntr: 'server/mikro/faturaListesiSorgusu.ts', sth_giris_depo_no: 'server/mikro/govdeFaturaIrsaliye.ts',
    sth_cikis_depo_no: 'server/mikro/govdeFaturaIrsaliye.ts', sth_iptal: 'server/mikro/faturaListesiSorgusu.ts',
  };
  const TUM_ADLAR = [...Object.values(CHA_ADLARI), ...FT_ISKONTO_ADLARI, ...Object.values(STH_ADLARI)];

  it('her ad kanıt tablosunda ve kanıt dosyasında TAM SÖZCÜK olarak (büyük / küçük harf dâhil) geçiyor', () => {
    expect([...TUM_ADLAR].sort()).toEqual(Object.keys(KANIT).sort());
    for (const ad of TUM_ADLAR) {
      const metin = readFileSync(join(SRC_KOK, KANIT[ad]), 'utf-8');
      expect(new RegExp(`(?<![A-Za-z0-9_])${ad}(?![A-Za-z0-9_])`).test(metin), `${ad} → ${KANIT[ad]}`).toBe(true);
    }
  });

  it('plan şemadaki GERÇEK yazımı taşır; kodda geçen yazım SQL\'e girmez', () => {
    const p = chaPlani(['CHA_EVRAKNO_SERI', 'Cha_Evrakno_Sira', 'cha_evrak_tip', 'cha_cinsi', 'CHA_TIP', 'cha_ebelge_Islemturu']);
    expect(p.kolon).toEqual({ seri: 'CHA_EVRAKNO_SERI', sira: 'Cha_Evrakno_Sira', evrakTip: 'cha_evrak_tip', cinsi: 'cha_cinsi', tip: 'CHA_TIP',
      ebelgeIslemTuru: 'cha_ebelge_Islemturu' });
    const sql = sqlOf(serilerSorgusu(p));
    expect(sql).toBe('SELECT cha.CHA_EVRAKNO_SERI AS seri, cha.cha_evrak_tip AS evrakTip, cha.cha_cinsi AS cinsi, cha.CHA_TIP AS tip, COUNT(*) AS adet '
      + 'FROM CARI_HESAP_HAREKETLERI cha GROUP BY cha.CHA_EVRAKNO_SERI, cha.cha_evrak_tip, cha.cha_cinsi, cha.CHA_TIP '
      + 'ORDER BY cha.CHA_EVRAKNO_SERI, cha.cha_evrak_tip, cha.cha_cinsi, cha.CHA_TIP');
    expect(sql).not.toContain('cha_evrakno_seri');
    expect(sqlOf(eBelgeSorgusu(p, 'Q'))).toContain('cha.cha_ebelge_Islemturu AS cha_ebelge_Islemturu');
  });

  it('şemada olmayan ad `eksik`\'te ADIYLA; tam şemada eksik yok', () => {
    expect(chaPlani(CHA_TAM).eksik).toEqual([]);
    expect(sthPlani(STH_TAM).eksik).toEqual([]);
    expect(chaPlani(olmadan(CHA_TAM, 'cha_vergi', 'cha_uuid', 'cha_ft_iskonto6')).eksik).toEqual(['cha_vergi', 'cha_uuid', 'cha_ft_iskonto6']);
    expect(sthPlani(olmadan(STH_TAM, 'sth_cikis_depo_no')).eksik).toEqual(['sth_cikis_depo_no']);
    expect(chaPlani([]).eksik.sort()).toEqual([...Object.values(CHA_ADLARI), ...FT_ISKONTO_ADLARI].sort());
  });

  it('tanımlayıcı biçimine uymayan şema adı YOK sayılır (SQL\'e hiçbir koşulda girmez)', () => {
    const p = chaPlani([...olmadan(CHA_TAM, 'cha_uuid', 'cha_ft_iskonto2'), 'cha_uuid; DROP TABLE x', 'cha_ft_iskonto2]', 'cha_ft_iskonto9 x']);
    expect(p.kolon.uuid).toBeUndefined();
    expect(p.eksik).toEqual(['cha_uuid', 'cha_ft_iskonto2']);
    expect(p.ftIskonto).toEqual(['cha_ft_iskonto1', 'cha_ft_iskonto3', 'cha_ft_iskonto4', 'cha_ft_iskonto5', 'cha_ft_iskonto6']);
    for (const s of [serilerSorgusu(p), eBelgeSorgusu(p, 'Q'), sonBasliklarSorgusu(p, 'Q')]) saltOkunur(sqlOf(s));
  });

  it('fatura altı iskonto ailesi şemadan: aynı aileden yedinci üye varsa o da; bayrak kolonları (cha_isk_mas…) ve GUID girmez', () => {
    const p = chaPlani([...CHA_TAM, 'cha_ft_iskonto7', 'cha_isk_mas1', 'cha_ft_iskonto_Guid']);
    expect(p.ftIskonto).toEqual([...FT_ISKONTO_ADLARI, 'cha_ft_iskonto7']);
  });
});

describe('sorgu kurucuları: yalnız SELECT, yalnız şemadaki kolon', () => {
  const tam = chaPlani(CHA_TAM), sthTam = sthPlani(STH_TAM);

  it('tam şemada üretilen HER SQL salt okunur tek deyim', () => {
    const hepsi = [serilerSorgusu(tam), eBelgeSorgusu(tam, 'Q'), sonBasliklarSorgusu(tam, 'Q'), satirOzetiSorgusu(sthTam, 'Q', [1, 2])].map(sqlOf);
    for (const sql of hepsi) saltOkunur(sql);
    for (const s of [CETPA_FATURA_SORGUSU, CETPA_SIPARIS_SORGUSU]) saltOkunur(s.sql);
  });

  it('her tekil kolon eksilince: sorgu yine salt okunur VE o ad metinde YOK (ya da bölüm `atlandi`)', () => {
    for (const ad of [...Object.values(CHA_ADLARI), ...FT_ISKONTO_ADLARI]) {
      const p = chaPlani(olmadan(CHA_TAM, ad));
      expect(p.eksik, ad).toEqual([ad]);
      for (const s of [serilerSorgusu(p), eBelgeSorgusu(p, 'Q'), sonBasliklarSorgusu(p, 'Q')]) {
        if ('atlandi' in s) { expect(s.atlandi, ad).toContain(ad); continue; }
        saltOkunur(s.sql);
        expect(new RegExp(`\\b${ad}\\b`).test(s.sql), `${ad} sorguda geçmemeli: ${s.sql}`).toBe(false);
      }
    }
    for (const ad of Object.values(STH_ADLARI)) {
      const s = satirOzetiSorgusu(sthPlani(olmadan(STH_TAM, ad)), 'Q', [5]);
      if ('atlandi' in s) { expect(s.atlandi, ad).toContain(ad); continue; }
      saltOkunur(s.sql);
      expect(new RegExp(`\\b${ad}\\b`).test(s.sql), `${ad} sorguda geçmemeli`).toBe(false);
    }
  });

  it('zorunlu kolon yoksa bölüm ATLANIR (neden adıyla); isteğe bağlı kolon yoksa alan `atlananAlanlar`\'da', () => {
    expect(serilerSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_evrakno_seri', 'cha_cinsi')))).toEqual({ atlandi: 'şemada yok: cha_evrakno_seri, cha_cinsi' });
    expect(eBelgeSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_evrakno_seri')), 'Q')).toEqual({ atlandi: 'şemada yok: cha_evrakno_seri' });
    expect(eBelgeSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_uuid', 'cha_ebelge_turu', 'cha_efatura_belge_tipi', 'cha_ebelge_Islemturu')), 'Q'))
      .toEqual({ atlandi: 'şemada yok: cha_ebelge_turu, cha_efatura_belge_tipi, cha_ebelge_Islemturu, cha_uuid' });
    expect(sonBasliklarSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_evrakno_sira')), 'Q')).toEqual({ atlandi: 'şemada yok: cha_evrakno_sira' });
    expect(satirOzetiSorgusu(sthPlani(olmadan(STH_TAM, 'sth_evraktip')), 'Q', [1])).toEqual({ atlandi: 'şemada yok: sth_evraktip' });

    const s1 = serilerSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_meblag', 'cha_iptal')));
    expect('atlananAlanlar' in s1 && s1.atlananAlanlar).toEqual({ toplam: 'şemada yok: cha_meblag', iptalAdet: 'şemada yok: cha_iptal', iptalToplam: 'şemada yok: cha_iptal, cha_meblag' });
    const s3 = sonBasliklarSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_vergi', 'cha_uuid', ...FT_ISKONTO_ADLARI)), 'Q');
    expect('atlananAlanlar' in s3 && s3.atlananAlanlar).toEqual({
      vergi: 'şemada yok: cha_vergi', ettnVar: 'şemada yok: cha_uuid', ftIskonto: `şemada yok: ${FT_ISKONTO_ADLARI.join(', ')}`,
    });
    const s4 = satirOzetiSorgusu(sthPlani(olmadan(STH_TAM, 'sth_vergi_pntr', 'sth_iptal', 'sth_vergi')), 'Q', [1]);
    expect('atlananAlanlar' in s4 && s4.atlananAlanlar).toEqual({
      vergiIsaretcisi: 'şemada yok: sth_vergi_pntr', iptalSatirAdedi: 'şemada yok: sth_iptal', vergi: 'şemada yok: sth_vergi',
    });
  });

  it('seri SQL\'e yalnız doğrulanmış biçimde girer: bozuk seride HİÇBİR kurucu SQL üretmez', () => {
    for (const seri of BOZUK_SERILER) {
      for (const s of [eBelgeSorgusu(tam, seri), sonBasliklarSorgusu(tam, seri), satirOzetiSorgusu(sthTam, seri, [1])]) {
        expect(s, JSON.stringify(seri)).toEqual({ atlandi: 'seri biçimi geçersiz — SQL üretilmedi' });
      }
    }
    for (const seri of ['Q', 'q', 'F', 'Q9a', 'A'.repeat(20)]) {
      const sqller = [eBelgeSorgusu(tam, seri), sonBasliklarSorgusu(tam, seri), satirOzetiSorgusu(sthTam, seri, [1])].map(sqlOf);
      for (const sql of sqller) {
        saltOkunur(sql);
        // Boş metin sabitleri ('') dışında metinde TEK tırnaklı sabit var: seri.
        expect(sql.replace(/''/g, '').split("'").length - 1, 'seri tek bir tırnaklı sabit olarak girer').toBe(2);
        expect(sql).toContain(`= '${seri}'`);
      }
    }
  });

  it('(1) tüm seriler: fatura koşulu ÖNCEDEN uygulanmaz (WHERE yok); iptal ayrı sayılır', () => {
    const sql = sqlOf(serilerSorgusu(tam));
    expect(sql).not.toMatch(/\bWHERE\b/);
    expect(sql).toContain('SUM(cha.cha_meblag) AS toplam');
    expect(sql).toContain('MIN(cha.cha_tarihi) AS enEski, MAX(cha.cha_tarihi) AS enYeni');
    expect(sql).toContain('SUM(CASE WHEN ISNULL(cha.cha_iptal, 0) <> 0 THEN 1 ELSE 0 END) AS iptalAdet');
    expect(sql).toContain('SUM(CASE WHEN ISNULL(cha.cha_iptal, 0) <> 0 THEN cha.cha_meblag END) AS iptalToplam');
    expect(sql).toMatch(/GROUP BY cha\.cha_evrakno_seri, cha\.cha_evrak_tip, cha\.cha_cinsi, cha\.cha_tip ORDER BY/);
  });

  it('(2) e-belge: kod kolonları × ETTN var / yok × iptal; ETTN metne çevrilerek; seçim ile grup AYNI ifadeler', () => {
    const sql = sqlOf(eBelgeSorgusu(tam, 'Q'));
    const ettn = "CASE WHEN REPLACE(REPLACE(ISNULL(CAST(cha.cha_uuid AS nvarchar(40)), ''), NCHAR(48), ''), NCHAR(45), '') = '' THEN 0 ELSE 1 END";
    expect(sql).toBe(
      `SELECT cha.cha_ebelge_turu AS cha_ebelge_turu, cha.cha_efatura_belge_tipi AS cha_efatura_belge_tipi, cha.cha_ebelge_Islemturu AS cha_ebelge_Islemturu, `
      + `${ettn} AS ettnVar, ISNULL(cha.cha_iptal, 0) AS iptal, COUNT(*) AS adet FROM CARI_HESAP_HAREKETLERI cha WHERE cha.cha_evrakno_seri = 'Q' `
      + `GROUP BY cha.cha_ebelge_turu, cha.cha_efatura_belge_tipi, cha.cha_ebelge_Islemturu, ${ettn}, ISNULL(cha.cha_iptal, 0) `
      + `ORDER BY cha.cha_ebelge_turu, cha.cha_efatura_belge_tipi, cha.cha_ebelge_Islemturu, ${ettn}, ISNULL(cha.cha_iptal, 0)`);
  });

  it('(3a) 20 başlık: fatura koşuluna uyanlar önce, sonra tarih ve sıra (yeniden eskiye) — kural `siralama` ile yazılır; fatura altı iskonto kolonları HAM (SQL\'de ISNULL ile sıfırlanmaz)', () => {
    const sql = sqlOf(sonBasliklarSorgusu(tam, 'Q'));
    // Uygulanan sıralama kuralı plana METİN olarak yazılır (rota yanıta taşır) — dört dal: koşul var / yok × tarih var / yok.
    const siralama = (...eksikler: string[]) => {
      const plan = sonBasliklarSorgusu(chaPlani(olmadan(CHA_TAM, ...eksikler)), 'Q');
      return 'siralama' in plan ? plan.siralama : undefined;
    };
    expect(siralama()).toBe('fatura koşuluna uyanlar önce; sonra tarih, sonra evrak sırası — yeniden eskiye');
    expect(siralama('cha_tarihi')).toBe('fatura koşuluna uyanlar önce; sonra evrak sırası — yeniden eskiye');
    expect(siralama('cha_cinsi')).toBe('tarih, sonra evrak sırası — yeniden eskiye');
    expect(siralama('cha_cinsi', 'cha_tarihi')).toBe('evrak sırası — yeniden eskiye');
    expect(sql).toMatch(/^SELECT TOP 20 cha\.cha_evrakno_sira AS sira, cha\.cha_evrakno_seri AS seri, cha\.cha_tarihi AS tarih, cha\.cha_kod AS cariKod, /);
    expect(sql).toContain('cha.cha_meblag AS meblag, cha.cha_aratoplam AS araToplam, cha.cha_vergi AS vergi, cha.cha_ft_iskonto1 AS cha_ft_iskonto1, ');
    expect(sql).not.toContain('ISNULL(cha.cha_ft_iskonto');
    // Fatura koşuluna uyan başlıklar etiketlenir ve TOP penceresinde ÖNE alınır; koşul dışı kayıt SÜZÜLMEZ (WHERE yalnız seri).
    const kosul = '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))';
    expect(sql).toContain(`CASE WHEN ${kosul} THEN 1 ELSE 0 END AS faturaKosulu FROM CARI_HESAP_HAREKETLERI cha WHERE cha.cha_evrakno_seri = 'Q' ORDER BY `);
    expect(sql.endsWith(`WHERE cha.cha_evrakno_seri = 'Q' ORDER BY CASE WHEN ${kosul} THEN 0 ELSE 1 END, cha.cha_tarihi DESC, cha.cha_evrakno_sira DESC`)).toBe(true);
    expect(sqlOf(sonBasliklarSorgusu(chaPlani(olmadan(CHA_TAM, 'cha_tarihi')), 'Q')).endsWith(`ORDER BY CASE WHEN ${kosul} THEN 0 ELSE 1 END, cha.cha_evrakno_sira DESC`)).toBe(true);
    // Koşulun iki kolonundan biri şemada yoksa: etiket ve öne alma YOK, neden adıyla yazılır; sorgu yine kurulur (sessiz değil).
    for (const eksik of ['cha_cinsi', 'cha_evrak_tip']) {
      const plan = sonBasliklarSorgusu(chaPlani(olmadan(CHA_TAM, eksik)), 'Q');
      expect(sqlOf(plan)).not.toContain('faturaKosulu');
      expect(sqlOf(plan)).toMatch(/WHERE cha\.cha_evrakno_seri = 'Q' ORDER BY cha\.cha_tarihi DESC, cha\.cha_evrakno_sira DESC$/);
      expect('atlananAlanlar' in plan && plan.atlananAlanlar.faturaKosulu).toBe(`şemada yok: ${eksik}`);
    }
    for (const adet of [0, -1, 1.5, 101, Number.NaN]) expect(sqlOf(sonBasliklarSorgusu(tam, 'Q', adet))).toMatch(/^SELECT TOP 20 /);
    expect(sqlOf(sonBasliklarSorgusu(tam, 'Q', 5))).toMatch(/^SELECT TOP 5 /);
  });

  it('(3b) satır özeti: seri + sayısal sıralar; sayı olmayan sıra SQL\'e girmez; NULL tutar / vergi satırı ayrıca sayılır', () => {
    const sql = sqlOf(satirOzetiSorgusu(sthTam, 'Q', ['12', 7, 7, "8; DROP TABLE x", null, '9 OR 1=1']));
    expect(sql).toBe(
      'SELECT sth_evrakno_sira AS sira, sth_evraktip AS evraktip, sth_vergi_pntr AS vergiPntr, sth_giris_depo_no AS girisDepo, sth_cikis_depo_no AS cikisDepo, '
      + 'ISNULL(sth_iptal, 0) AS iptal, COUNT(*) AS adet, SUM(sth_tutar) AS tutar, SUM(CASE WHEN sth_tutar IS NULL THEN 1 ELSE 0 END) AS tutarBos, '
      + 'SUM(sth_vergi) AS vergi, SUM(CASE WHEN sth_vergi IS NULL THEN 1 ELSE 0 END) AS vergiBos '
      + "FROM STOK_HAREKETLERI WHERE sth_evrakno_seri = 'Q' AND sth_evrakno_sira IN (7, 12) "
      + 'GROUP BY sth_evrakno_sira, sth_evraktip, sth_vergi_pntr, sth_giris_depo_no, sth_cikis_depo_no, ISNULL(sth_iptal, 0) ORDER BY sth_evrakno_sira, sth_evraktip');
    expect(satirOzetiSorgusu(sthTam, 'Q', ['x', null])).toEqual({ atlandi: 'sayısal evrak sırası olan başlık yok' });
    expect(satirOzetiSorgusu(sthTam, 'Q', [])).toEqual({ atlandi: 'sayısal evrak sırası olan başlık yok' });
  });

  it('(4) / (5) Cetpa sorguları: yalnız SELECT, değerler PARAMETREYLE (metne gömülü koleksiyon / seri yok)', () => {
    expect(CETPA_FATURA_SORGUSU.sql).toBe(`SELECT data->>'companyId' AS "companyId", data->>'cha_evrakno_seri' AS seri, COUNT(*)::int AS adet FROM docs WHERE coll = $1 GROUP BY 1, 2`);
    expect(CETPA_FATURA_SORGUSU.params).toEqual(['mikroFaturalar']);
    expect(CETPA_SIPARIS_SORGUSU.sql).toMatch(/^SELECT data->>'companyId' AS "companyId", data->'mikroEvrak'->>'seri' AS seri, jsonb_typeof\(data->'faturali'\) AS tur, /);
    expect(CETPA_SIPARIS_SORGUSU.sql).toMatch(/FROM docs WHERE coll = \$1 AND data->>'source' = \$2 GROUP BY 1, 2, 3, 4$/);
    expect(CETPA_SIPARIS_SORGUSU.params).toEqual(['orders', 'mikro-fatura']);
  });
});

describe('biçimleyiciler: sayı olmayan değer null (bilinmeyen ≠ 0)', () => {
  it('sayi: boş / boşluk / boolean / metin / NaN → null; sayısal metin ve 0 korunur', () => {
    expect([0, 12.5, '0', '8500', ' 3 ', -4].map(sayi)).toEqual([0, 12.5, 0, 8500, 3, -4]);
    for (const v of [null, undefined, '', '   ', true, false, 'abc', '12abc', Number.NaN, Number.POSITIVE_INFINITY, {}, [], [5]]) expect(sayi(v), JSON.stringify(v)).toBeNull();
  });

  it('(1) seriler: boş seri (\'\' ve NULL) AYRI satır; alan yoksa çıktıda da yok', () => {
    const cikti = serilerBicimle([
      { seri: 'Q', evrakTip: 63, cinsi: '7', tip: 0, adet: 12, toplam: '120000.5', enEski: '2025-01-02T00:00:00', enYeni: '2026-10-01T00:00:00', iptalAdet: 1, iptalToplam: 500 },
      { seri: '', evrakTip: 63, cinsi: 6, tip: 1, adet: 700, toplam: null, enEski: null, enYeni: null, iptalAdet: 0, iptalToplam: null },
      { seri: null, evrakTip: 'x', cinsi: null, tip: undefined, adet: '' },
    ]);
    expect(cikti[0]).toEqual({ seri: 'Q', evrakTip: 63, cinsi: 7, tip: 0, adet: 12, toplam: 120000.5, enEski: '2025-01-02T00:00:00', enYeni: '2026-10-01T00:00:00', iptalAdet: 1, iptalToplam: 500 });
    expect(cikti[1]).toEqual({ seri: '', evrakTip: 63, cinsi: 6, tip: 1, adet: 700, toplam: null, enEski: null, enYeni: null, iptalAdet: 0, iptalToplam: null });
    expect(cikti[2]).toEqual({ seri: null, evrakTip: null, cinsi: null, tip: null, adet: null });
  });

  it('(2) e-belge: kodlar sayı ya da null; ETTN var / yok ve iptal boolean ya da null', () => {
    expect(eBelgeBicimle([
      { cha_ebelge_turu: 0, cha_efatura_belge_tipi: '0', cha_ebelge_Islemturu: 2, ettnVar: 1, iptal: false, adet: 37 },
      { cha_ebelge_turu: null, cha_ebelge_Islemturu: 'x', ettnVar: 0, iptal: true, adet: '4' },
      { ettnVar: null, adet: 1 },
    ])).toEqual([
      { cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 2, ettnVar: true, iptal: false, adet: 37 },
      { cha_ebelge_turu: null, cha_ebelge_Islemturu: null, ettnVar: false, iptal: true, adet: 4 },
      { ettnVar: null, adet: 1 },
    ]);
  });

  const cha = chaPlani(CHA_TAM), sth = sthPlani(STH_TAM);
  const baslik = (sira: unknown, o: Record<string, unknown> = {}) => ({
    sira, seri: 'Q', tarih: '2026-10-01T00:00:00', cariKod: '120.01.001', evrakTip: 63, cinsi: 7, tip: 0, meblag: 12000, araToplam: 10000, vergi: 2000,
    ...Object.fromEntries(FT_ISKONTO_ADLARI.map(k => [k, 0])), cha_ebelge_turu: 0, cha_efatura_belge_tipi: 0, cha_ebelge_Islemturu: 0, ettnVar: 0, iptal: false, ...o,
  });
  const grup = (sira: unknown, o: Record<string, unknown> = {}) => ({
    sira, evraktip: 4, vergiPntr: 4, girisDepo: 2, cikisDepo: 2, iptal: false, adet: 1, tutar: 1000, tutarBos: 0, vergi: 200, vergiBos: 0, ...o,
  });

  it('(3) satırlar okunmadıysa satirOzeti null (neden bölümde); başlık alanları sayı değilse null', () => {
    const [b] = sonBasliklarBicimle([baslik('15', { meblag: 'yok', cha_ft_iskonto3: null, ettnVar: 1, iptal: 1 })], cha, null);
    expect(b).toMatchObject({ sira: 15, seri: 'Q', tarih: '2026-10-01T00:00:00', cariKod: '120.01.001', evrakTip: 63, cinsi: 7, tip: 0,
      meblag: null, araToplam: 10000, vergi: 2000, ftIskonto: null, cha_ebelge_Islemturu: 0, ettnVar: true, iptal: true, satirOzeti: null });
    expect(b.bagDisiSatirlar).toBeUndefined();
  });

  it('(3) faturaKosulu etiketi: sorgu alanı döndürdüyse 1 → true, 0 → false, sayı değilse null; alan yoksa etiket de yok (uydurulmaz)', () => {
    const [evet, hayir, bozuk, yok] = sonBasliklarBicimle(
      [baslik(15, { faturaKosulu: 1 }), baslik(16, { evrakTip: 33, faturaKosulu: 0 }), baslik(17, { faturaKosulu: 'x' }), baslik(18)], cha, null);
    expect(evet.faturaKosulu).toBe(true);
    expect(hayir.faturaKosulu).toBe(false);
    expect(bozuk.faturaKosulu).toBeNull();
    expect('faturaKosulu' in yok).toBe(false);
  });

  it('(3) koşul dışı başlığa satır özeti YAZILMAZ: aynı sırada fatura (etiket 1) ve fatura dışı (etiket 0) başlık → satırlar yalnız faturada özetlenir, ötekinde `bagDisiSatirlar`\'da kalır', () => {
    const gruplar = [grup(15, { adet: 3, tutar: 3000, vergi: 600 })];
    const [fatura, disi, etiketsiz, bozuk] = sonBasliklarBicimle(
      [baslik(15, { faturaKosulu: 1 }), baslik(15, { evrakTip: 33, meblag: 700, faturaKosulu: 0 }), baslik(15), baslik(15, { faturaKosulu: 'x' })],
      cha, { gruplar, plan: sth });
    const tamOzet = { evraktip: 4, satirAdedi: 3, tutar: 3000, vergi: 600, iptalSatirAdedi: 0, vergiIsaretcisi: { '4': 3 }, girisDeposu: { '2': 3 }, cikisDeposu: { '2': 3 } };
    expect(fatura.satirOzeti).toEqual(tamOzet);
    expect(fatura.bagDisiSatirlar).toBeUndefined();
    // Aynı satırlar ikinci kez SAYILMAZ; gizlenmez de: evrak tipi + adet olarak görünür.
    expect(disi.faturaKosulu).toBe(false);
    expect(disi.satirOzeti).toEqual({ atlandi: 'başlık fatura koşulu dışında — satır bağı yalnız fatura başlığında doğrulanmış (aynı seri + sıradaki satırlar: bagDisiSatirlar)' });
    expect(disi.bagDisiSatirlar).toEqual([{ evraktip: 4, satirAdedi: 3, iptalSatirAdedi: 0 }]);
    // Etiket yokken (kolon şemada yok) ya da okunamadığında (null) davranış DEĞİŞMEZ: karar verilemeyen başlık özet alır.
    expect(etiketsiz.satirOzeti).toEqual(tamOzet);
    expect(bozuk.faturaKosulu).toBeNull();
    expect(bozuk.satirOzeti).toEqual(tamOzet);
  });

  it('(3) bagDisiSatirlar iptal ayrımını korur: `satirAdedi` iptalsiz, `iptalSatirAdedi` ayrı — fatura başlığındaki özetle AYNI anlam; satırsız koşul dışı başlıkta boş dizi', () => {
    const gruplar = [grup(15, { adet: 3, tutar: 3000, vergi: 600 }), grup(15, { iptal: true, adet: 2, tutar: 2000, vergi: 400 }), grup(15, { evraktip: 13, adet: 1 })];
    const [fatura, disi, satirsiz] = sonBasliklarBicimle(
      [baslik(15, { faturaKosulu: 1 }), baslik(15, { evrakTip: 33, faturaKosulu: 0 }), baslik(19, { evrakTip: 33, faturaKosulu: 0 })], cha, { gruplar, plan: sth });
    expect(fatura.satirOzeti).toMatchObject({ satirAdedi: 3, iptalSatirAdedi: 2 });
    expect(fatura.bagDisiSatirlar).toEqual([{ evraktip: 13, satirAdedi: 1, iptalSatirAdedi: 0 }]);
    expect(disi.bagDisiSatirlar).toEqual([{ evraktip: 4, satirAdedi: 3, iptalSatirAdedi: 2 }, { evraktip: 13, satirAdedi: 1, iptalSatirAdedi: 0 }]);
    expect(satirsiz.bagDisiSatirlar).toEqual([]);
    // İptal kolonu şemada yoksa ayrım YAPILAMAZ: alan yazılmaz (sıfır uydurulmaz), tüm satırlar `satirAdedi`'nde.
    const [iptalsiz] = sonBasliklarBicimle([baslik(15, { evrakTip: 33, faturaKosulu: 0 })], cha, { gruplar, plan: sthPlani(olmadan(STH_TAM, 'sth_iptal')) });
    expect(iptalsiz.bagDisiSatirlar).toEqual([{ evraktip: 4, satirAdedi: 5 }, { evraktip: 13, satirAdedi: 1 }]);
  });

  it('(3) ikiz başlık: aynı sıra + aynı yönde iki fatura başlığı AYNI satır özetini taşır ve `satirOzetiPaylasanBaslik: 2` ile işaretlenir; tek başlıkta alan yok', () => {
    const gruplar = [grup(17, { adet: 2, tutar: 2000, vergi: 400 }), grup(16, { adet: 1, tutar: 500, vergi: 100 }), grup(16, { evraktip: 3, adet: 1, tutar: 300, vergi: 60 }),
      grup(15, { adet: 3, tutar: 3000, vergi: 600 }), grup(18, { adet: 1, tutar: 100, vergi: 20 })];
    const [ikizA, ikizB, satis, alis, fatura, disi, tek] = sonBasliklarBicimle([
      baslik(17, { faturaKosulu: 1 }), baslik(17, { faturaKosulu: 1 }),          // ikiz: iki satış fatura başlığı
      baslik(16, { faturaKosulu: 1 }), baslik(16, { tip: 1, faturaKosulu: 1 }),   // aynı sıra, FARKLI yön → ayrı özet
      baslik(15, { faturaKosulu: 1 }), baslik(15, { evrakTip: 33, faturaKosulu: 0 }), // fatura + koşul dışı → özet yalnız faturada
      baslik(18, { faturaKosulu: 1 }),
    ], cha, { gruplar, plan: sth });
    expect([ikizA.satirOzetiPaylasanBaslik, ikizB.satirOzetiPaylasanBaslik]).toEqual([2, 2]);
    expect(ikizA.satirOzeti).toEqual(ikizB.satirOzeti);
    for (const b of [satis, alis, fatura, disi, tek]) expect('satirOzetiPaylasanBaslik' in b).toBe(false);
  });

  it('ÇİT — fatura koşulu TEK küme: saf modülün ifadesi `mikroRoutes.ts` `FATURA_EVRAK_KOSULU` metniyle harfi harfine aynı', () => {
    const rota = readFileSync(join(SRC_KOK, 'server/routes/mikroRoutes.ts'), 'utf8');
    const m = /const FATURA_EVRAK_KOSULU = '([^']+)';/.exec(rota);
    expect(m, 'mikroRoutes.ts içinde FATURA_EVRAK_KOSULU tanımı bulunamadı (çit kör kalmasın)').not.toBeNull();
    expect(faturaKosuluIfadesi('cha_evrak_tip', 'cha_cinsi')).toBe(m?.[1]);
  });

  it('(3) satır bağı MEVCUT koşulla: satış başlığı (cha_tip 0) → evrak tipi 4, alış → 3; başka evrak tipli satır gizlenmez, ayrı sayılır', () => {
    expect([bagEvrakTipi(0), bagEvrakTipi(1), bagEvrakTipi(2)]).toEqual([4, 3, 3]);
    expect(SATIR_BAGI).toContain('sth_evrakno_seri = cha_evrakno_seri');
    const gruplar = [
      grup(15, { adet: 3, tutar: 3000, vergi: 600 }),
      grup(15, { vergiPntr: 1, adet: 2, tutar: 500, vergi: 0, cikisDepo: 3 }),
      grup(15, { iptal: true, adet: 1, tutar: 999, vergi: 199 }),
      grup(15, { evraktip: 1, adet: 4 }),                     // aynı seri + sırada irsaliye satırları
      grup('16', { evraktip: 3, adet: 6, tutar: 60, vergi: 12 }),
    ];
    const [satis, alis, satirsiz] = sonBasliklarBicimle([baslik(15, { cha_ft_iskonto1: 100, cha_ft_iskonto2: '50' }), baslik(16, { tip: 1 }), baslik(17)], cha, { gruplar, plan: sth });
    expect(satis.ftIskonto).toBe(150);
    expect(satis.satirOzeti).toEqual({
      evraktip: 4, satirAdedi: 5, tutar: 3500, vergi: 600, iptalSatirAdedi: 1,
      vergiIsaretcisi: { '4': 3, '1': 2 }, girisDeposu: { '2': 5 }, cikisDeposu: { '2': 3, '3': 2 },
    });
    expect(satis.bagDisiSatirlar).toEqual([{ evraktip: 1, satirAdedi: 4, iptalSatirAdedi: 0 }]);
    expect(alis.satirOzeti).toMatchObject({ evraktip: 3, satirAdedi: 6, tutar: 60, vergi: 12, iptalSatirAdedi: 0 });
    expect(alis.bagDisiSatirlar).toBeUndefined();
    // Satırı olmayan başlık: adet 0, tutar / vergi NULL (toplanacak satır yok — «0 TL» değil).
    expect(satirsiz.satirOzeti).toEqual({ evraktip: 4, satirAdedi: 0, tutar: null, vergi: null, iptalSatirAdedi: 0, vergiIsaretcisi: {}, girisDeposu: {}, cikisDeposu: {} });
  });

  it('(3) NULL tutar / vergi satırı varsa o toplam BİLİNMİYOR; sayı olmayan toplam null; yönü okunamayan başlıkta bağ kurulmaz', () => {
    const ozet = (gruplar: Record<string, unknown>[], b = baslik(15)) => sonBasliklarBicimle([b], cha, { gruplar, plan: sth })[0].satirOzeti;
    expect(ozet([grup(15, { adet: 2, tutar: 100, tutarBos: 1, vergi: 20 })])).toMatchObject({ satirAdedi: 2, tutar: null, vergi: 20 });
    expect(ozet([grup(15, { vergi: null, vergiBos: 1 })])).toMatchObject({ tutar: 1000, vergi: null });
    expect(ozet([grup(15, { tutar: 'x' }), grup(15, { vergiPntr: 1 })])).toMatchObject({ satirAdedi: 2, tutar: null, vergi: 400 });
    expect(ozet([grup(15, { tutarBos: undefined })])).toMatchObject({ tutar: null });           // sayaç okunamadıysa da bilinmiyor
    expect(ozet([grup(15, { adet: 'x' })])).toMatchObject({ satirAdedi: null, vergiIsaretcisi: {} });
    expect(ozet([grup(15)], baslik(15, { tip: null }))).toEqual({ atlandi: 'başlığın cha_tip değeri okunamadı — satır bağı kurulamadı' });
    expect(ozet([grup(15)], baslik('15a'))).toEqual({ atlandi: 'evrak sırası sayı değil — satırlar sorulmadı' });
    // Boş vergi işaretçisi / depo ayrı etikette görünür (sıfıra ya da başka değere katılmaz).
    expect(ozet([grup(15, { vergiPntr: null, girisDepo: '' })])).toMatchObject({ vergiIsaretcisi: { '(boş)': 1 }, girisDeposu: { '(boş)': 1 }, cikisDeposu: { '2': 1 } });
  });

  it('(3) şemada olmayan satır kolonunun alanı çıktıda YOK (0 ya da boş dağılım olarak uydurulmaz)', () => {
    const dar = sthPlani(olmadan(STH_TAM, 'sth_vergi', 'sth_vergi_pntr', 'sth_cikis_depo_no', 'sth_iptal'));
    const [b] = sonBasliklarBicimle([baslik(15)], cha, { gruplar: [{ sira: 15, evraktip: 4, girisDepo: 2, adet: 2, tutar: 10, tutarBos: 0 }], plan: dar });
    expect(b.satirOzeti).toEqual({ evraktip: 4, satirAdedi: 2, tutar: 10, girisDeposu: { '2': 2 } });
  });

  it('(4) Cetpa fatura kopyaları: seri q = Q; saklanan yazım ve kiracı kırılımı; tüm kopya sayısı ayrı', () => {
    expect(cetpaFaturaOzeti([
      { companyId: 'K1', seri: 'Q', adet: 12 }, { companyId: 'K1', seri: 'q', adet: 1 }, { companyId: null, seri: ' Q', adet: 2 },
      { companyId: 'K1', seri: '', adet: 700 }, { companyId: 'K2', seri: 'QQ', adet: 5 }, { companyId: 'K1', seri: null, adet: 3 },
    ], 'Q')).toEqual({ adet: 15, kiracilar: { K1: 13, '(etiketsiz)': 2 }, yazimlar: { Q: 12, q: 1, ' Q': 2 }, toplamKopya: 723 });
    expect(cetpaFaturaOzeti([], 'Q')).toEqual({ adet: 0, kiracilar: {}, yazimlar: {}, toplamKopya: 0 });
    expect(cetpaFaturaOzeti([{ companyId: 'constructor', seri: 'Q', adet: 1 }], 'q').kiracilar).toEqual({ constructor: 1 });
    expect(() => cetpaFaturaOzeti([{ companyId: 'K1', seri: 'Q', adet: null }], 'Q')).toThrow('PG adet değeri sayı değil');
  });

  it('(5) MF siparişleri: `faturali` true / false / yok / başka tip AYRI sayılır (Y14, Q6-4 kapsamı)', () => {
    expect(cetpaSiparisOzeti([
      { companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'true', adet: 9 },
      { companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'false', adet: 2 },
      { companyId: 'K1', seri: 'Q', tur: null, deger: null, adet: 1 },          // alan hiç yok
      { companyId: 'K1', seri: 'q', tur: 'null', deger: null, adet: 1 },        // JSON null
      { companyId: 'K2', seri: 'Q', tur: 'string', deger: 'true', adet: 1 },    // metin "true" boolean true SAYILMAZ
      { companyId: 'K1', seri: '', tur: 'boolean', deger: 'true', adet: 300 },
    ], 'Q')).toEqual({
      adet: 14, faturali: { true: 9, false: 2, yok: 2, diger: 1 }, kiracilar: { K1: 13, K2: 1 }, yazimlar: { Q: 13, q: 1 }, toplamMikroFaturaSiparisi: 314,
    });
    expect(() => cetpaSiparisOzeti([{ companyId: 'K1', seri: 'Q', tur: 'boolean', deger: 'true', adet: 'x' }], 'Q')).toThrow('PG adet değeri sayı değil');
  });
});
