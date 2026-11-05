/**
 * seriOzetOlcum.test.ts — `seri-ozet` ölçüm bölümleri (6)–(14) (şartname `.wf/SARTNAME-q-serisi-v3.md` § 4.3 + «Kapı sonrası
 * hükümler» QH8-4 / QH8-5, 2026-11-05; test T9, mutasyon M8). Saf modül: SQL metni + yanıt biçimi. Kural YAZMAZ, hiçbir yere yazmaz.
 *
 * KOLON ADI TAHMİN EDİLMEZ: EK adlar depoda ZATEN geçer (aşağıdaki kanıt tablosu dosya düzeyi çittir — yeni ad kanıtsız eklenince
 * kırılır); şemada olmayan ad SQL'e girmez, `eksik`'te adıyla, bağlı alan `atlananAlanlar`'da.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STH_EK_ADLARI, CHA_EK_ADLARI, sthEkPlani, chaEkPlani, sthPlani, chaPlani, STH_ADLARI, CHA_ADLARI, FT_ISKONTO_ADLARI,
  vergiDeseniSorgusu, vergiDeseniBicimle, qSatirDeseniSorgusu, qSatirDeseniBicimle, qBaslikDeseniSorgusu, qBaslikDeseniBicimle,
  vergiKolonAdlari, vergiTablosuOzeti, kuyrukEttnSorgusu, kuyrukEttnBicimle, FATURASIZ_SIPARIS_SORGUSU, leadCariSorgusu, SUBE_SORGUSU,
  MF_IKIZ_SIPARIS_SORGUSU, MF_IKIZ_FATURA_SORGUSU, CETPA_EVRAK_SORGUSU, faturasizHavuzOzeti, leadCariHaritasi, subeOzeti,
  qIkizAdaylari, satisCiftSayimOlcumu, createdAtBicimi, type SorguPlani, type BaslikOzeti,
} from './seriOzet';
import { satisIkizAnahtarlari, satisCiftSayimOzeti } from '../../utils/muhasebe/satislar';
import { mapMikroFatura } from '../../hooks/useMikroFaturalar';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import { SRC_KOK } from '../../test/kaynakTarama';

const STH_TAM = [...Object.values(STH_ADLARI), ...Object.values(STH_EK_ADLARI)];
const CHA_TAM = [...Object.values(CHA_ADLARI), ...FT_ISKONTO_ADLARI, ...Object.values(CHA_EK_ADLARI)];
const sqlOf = (p: SorguPlani): string => { if ('atlandi' in p) throw new Error(`atlandı: ${p.atlandi}`); return p.sql; };
const salt = (s: string) => {
  expect(s).toMatch(/^SELECT /);
  expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|TRUNCATE|CREATE|GRANT|INTO)\b/i);
  expect(s).not.toContain(';');
  expect(s).not.toContain('--');
  expect(s).not.toMatch(/[^\x20-\x7E]/);
};

describe('T9 — EK kolon adları: yalnız depoda ZATEN geçen adlar (dosya düzeyi çit)', () => {
  const KANIT: Record<string, string> = {
    sth_tip: 'server/mikro/govdeFaturaIrsaliye.ts', sth_cins: 'server/mikro/govdeFaturaIrsaliye.ts',
    sth_normal_iade: 'server/mikro/govdeFaturaIrsaliye.ts', sth_vergisiz_fl: 'server/mikro/govdeFaturaIrsaliye.ts',
    cha_normal_Iade: 'server/mikro/govdeFaturaIrsaliye.ts', cha_cari_cins: 'server/mikro/govdeFaturaIrsaliye.ts',
    cha_d_cins: 'server/mikro/govdeFaturaIrsaliye.ts', cha_Guid: 'server/mikro/eslemeFatura.ts',
  };
  it('her EK ad kanıt tablosunda ve kanıt dosyasında TAM SÖZCÜK olarak (harf büyüklüğü dâhil) geçiyor', () => {
    const adlar = [...Object.values(STH_EK_ADLARI), ...Object.values(CHA_EK_ADLARI)];
    expect([...adlar].sort()).toEqual(Object.keys(KANIT).sort());
    for (const ad of adlar) {
      const metin = readFileSync(join(SRC_KOK, KANIT[ad]), 'utf-8');
      expect(new RegExp(`(?<![A-Za-z0-9_])${ad}(?![A-Za-z0-9_])`).test(metin), `${ad} → ${KANIT[ad]}`).toBe(true);
    }
  });
  it('plan GERÇEK yazımı taşır; şemada olmayan EK ad `eksik`\'te ADIYLA', () => {
    expect(sthEkPlani(['STH_TIP', 'sth_cins']).kolon).toEqual({ tip: 'STH_TIP', cins: 'sth_cins' });
    expect(sthEkPlani(['STH_TIP', 'sth_cins']).eksik).toEqual(['sth_normal_iade', 'sth_vergisiz_fl']);
    expect(chaEkPlani(CHA_TAM).eksik).toEqual([]);
    expect(chaEkPlani([]).eksik).toEqual(Object.values(CHA_EK_ADLARI));
  });
});

describe('T9 — (6) giden satış satırı vergi deseni (Q3-3)', () => {
  const sp = sthPlani(STH_TAM), se = sthEkPlani(STH_TAM);
  it('SQL: yalnız SELECT, tek deyim, ASCII; evrak tipi 4, iptal dışı; işaretçi × bayrak × (vergi = 0)', () => {
    const s = sqlOf(vergiDeseniSorgusu(sp, se));
    salt(s);
    expect(s).toBe('SELECT sth_vergi_pntr AS vergiPntr, sth_vergisiz_fl AS vergisizFl, CASE WHEN sth_vergi IS NULL THEN NULL WHEN sth_vergi = 0 THEN 1 ELSE 0 END AS vergiSifir, '
      + 'COUNT(*) AS adet FROM STOK_HAREKETLERI WHERE sth_evraktip = 4 AND ISNULL(sth_iptal, 0) = 0 GROUP BY sth_vergi_pntr, sth_vergisiz_fl, '
      + 'CASE WHEN sth_vergi IS NULL THEN NULL WHEN sth_vergi = 0 THEN 1 ELSE 0 END ORDER BY sth_vergi_pntr, sth_vergisiz_fl, CASE WHEN sth_vergi IS NULL THEN NULL WHEN sth_vergi = 0 THEN 1 ELSE 0 END');
    expect(s).not.toContain("'");
  });
  it('şemada olmayan bayrak SQL\'e GİRMEZ (M8): `atlananAlanlar`\'da; durum «ölçülemedi»', () => {
    const sema = STH_TAM.filter(k => k !== 'sth_vergisiz_fl');
    const p = vergiDeseniSorgusu(sthPlani(sema), sthEkPlani(sema));
    expect(sqlOf(p)).not.toMatch(/sth_vergisiz_fl/);
    expect('atlananAlanlar' in p && p.atlananAlanlar).toEqual({ vergisizFl: 'şemada yok: sth_vergisiz_fl' });
    expect(vergiDeseniBicimle([{ vergiPntr: 1, vergiSifir: 1, adet: 5 }], sthPlani(sema), sthEkPlani(sema)).kdvsiz.durum).toBe('olculemedi');
    expect(vergiDeseniSorgusu(sthPlani(['sth_evraktip']), sthEkPlani([]))).toEqual({ atlandi: 'şemada yok: sth_vergi' });
  });
  it('biçim: KDV\'siz desen tek / karışık / yok; NULL vergi «bilinmiyor» (0 sayılmaz)', () => {
    const tek = vergiDeseniBicimle([{ vergiPntr: 4, vergisizFl: 0, vergiSifir: 0, adet: 900 }, { vergiPntr: 1, vergisizFl: 0, vergiSifir: 1, adet: 12 },
      { vergiPntr: 4, vergisizFl: 0, vergiSifir: null, adet: 2 }], sp, se);
    expect(tek.kdvsiz).toEqual({ durum: 'tek', desenler: [{ vergiIsaretcisi: '1', vergisizFl: false, adet: 12 }] });
    expect(tek.satirlar[2]).toEqual({ vergiIsaretcisi: '4', vergisizFl: false, vergiSifir: null, adet: 2 });
    const karisik = vergiDeseniBicimle([{ vergiPntr: 1, vergisizFl: 0, vergiSifir: 1, adet: 3 }, { vergiPntr: 4, vergisizFl: 1, vergiSifir: 1, adet: 1 }], sp, se);
    expect(karisik.kdvsiz.durum).toBe('karisik');
    expect(vergiDeseniBicimle([{ vergiPntr: 4, vergisizFl: 0, vergiSifir: 0, adet: 9 }], sp, se).kdvsiz.durum).toBe('yok');
  });
});

describe('T9 — (7) Q satır / başlık sabitleri (a1-8(1))', () => {
  it('(7a) SQL: seri tek tırnaklı sabit; gövde sabitinden farklı satış satırı işaretlenir', () => {
    const s = sqlOf(qSatirDeseniSorgusu(sthPlani(STH_TAM), sthEkPlani(STH_TAM), 'Q'));
    salt(s);
    expect(s).toContain("WHERE sth_evrakno_seri = 'Q' GROUP BY");
    expect(s.replace(/''/g, '').split("'").length - 1).toBe(2);
    const b = qSatirDeseniBicimle([
      { evraktip: 4, tip: 1, cins: 0, normalIade: 0, vergisizFl: 0, iptal: 0, adet: 1 },
      { evraktip: 4, tip: 1, cins: 0, normalIade: 0, vergisizFl: 1, iptal: 0, adet: 1 },
      { evraktip: 1, tip: 0, cins: 0, normalIade: 0, vergisizFl: 0, iptal: 0, adet: 2 },
    ]);
    expect(b.map(x => x.sabittenFarkli)).toEqual([false, true, null]);
    expect(qSatirDeseniSorgusu(sthPlani(STH_TAM), sthEkPlani(STH_TAM), "Q'--")).toEqual({ atlandi: 'seri biçimi geçersiz — SQL üretilmedi' });
  });
  it('(7b) SQL: başlık sabitleri; bir kolon okunamazsa «farklı mı» bilinmiyor (null)', () => {
    const s = sqlOf(qBaslikDeseniSorgusu(chaPlani(CHA_TAM), chaEkPlani(CHA_TAM), 'Q'));
    salt(s);
    expect(s).toContain('cha.cha_normal_Iade AS normalIade');
    const b = qBaslikDeseniBicimle([
      { evrakTip: 63, cinsi: 6, tip: 0, normalIade: 0, cariCins: 0, dCins: 0, adet: 1 },
      { evrakTip: 63, cinsi: 6, tip: 0, normalIade: 1, cariCins: 0, dCins: 0, adet: 1 },
      { evrakTip: 63, cinsi: 6, tip: 0, normalIade: 0, adet: 1 },
      { evrakTip: 29, cinsi: 0, tip: 0, normalIade: 0, cariCins: 0, dCins: 0, adet: 4 },
    ]);
    expect(b.map(x => x.sabittenFarkli)).toEqual([false, true, null, null]);
    const sema = CHA_TAM.filter(k => k !== 'cha_d_cins');
    const p = qBaslikDeseniSorgusu(chaPlani(sema), chaEkPlani(sema), 'Q');
    expect(sqlOf(p)).not.toMatch(/cha_d_cins/);
    expect('atlananAlanlar' in p && p.atlananAlanlar).toEqual({ dCins: 'şemada yok: cha_d_cins' });
  });
});

describe('T9 — (8) ad listesi, (9) vergi tablosu, (14) kuyruk', () => {
  it('(8) adı vergi / kdv / istisna içeren kolon ADLARI; tanımlayıcı olmayan ad yok sayılır', () => {
    expect(vergiKolonAdlari(['sth_vergi', 'sth_vergi_pntr', 'sth_tutar', 'sth_vergisiz_fl', 'kdv_istisna_kodu', 'bad name vergi', 'STH_ISTISNA'])).toEqual(
      ['kdv_istisna_kodu', 'STH_ISTISNA', 'sth_vergi', 'sth_vergi_pntr', 'sth_vergisiz_fl']);
  });
  it('(9) tablo + %0 işaretçisi; %0 yoksa null', () => {
    expect(vergiTablosuOzeti(new Map([[4, 20], [1, 0], [3, 10]]))).toEqual({ tablo: { '1': 0, '3': 10, '4': 20 }, sifirIsaretcisi: 1 });
    expect(vergiTablosuOzeti(new Map([[4, 20]])).sifirIsaretcisi).toBeNull();
  });
  it('(14) kuyruğun HER kolonu karşılaştırılır (kolon adı tahmin edilmez); tırnaklı sabit yalnız seri; ETTN geçerlilik koşulu', () => {
    const s = sqlOf(kuyrukEttnSorgusu(chaPlani(CHA_TAM), chaEkPlani(CHA_TAM), ['kyr_id', 'kyr_belge', 'bad name'], 'Q'));
    salt(s);
    expect(s).toMatch(/^SELECT COUNT\(\*\) AS adet FROM EBELGE_GONDERIM_KUYRUK_LOG k WHERE EXISTS \(SELECT 1 FROM CARI_HESAP_HAREKETLERI cha WHERE cha\.cha_evrakno_seri = 'Q' AND \(cha\.cha_evrak_tip = 63 OR/);
    for (const k of ['k.kyr_id', 'k.kyr_belge']) expect(s).toContain(`CAST(${k} AS nvarchar(100))`);
    expect(s).not.toContain('bad name');
    expect(s).toContain('cha.cha_uuid');
    expect(s).toContain('cha.cha_Guid');
    expect(s.replace(/''/g, '').split("'").length - 1).toBe(2);
    expect(kuyrukEttnSorgusu(chaPlani(CHA_TAM), chaEkPlani(CHA_TAM), [], 'Q')).toEqual({ atlandi: 'kuyruk tablosunun kolonu yok' });
    const ettnsiz = CHA_TAM.filter(k => k !== 'cha_uuid' && k !== 'cha_Guid');
    expect(kuyrukEttnSorgusu(chaPlani(ettnsiz), chaEkPlani(ettnsiz), ['kyr_id'], 'Q')).toEqual({ atlandi: 'şemada yok: cha_uuid, cha_Guid' });
    expect(kuyrukEttnBicimle([{ adet: 0 }])).toEqual({ adet: 0 });
    expect(kuyrukEttnBicimle([])).toEqual({ adet: null });
  });
});

describe('T9 — Cetpa (PG) sorguları (10)(11)(13): yalnız SELECT, değer parametreyle, `FROM docs WHERE coll = $1`', () => {
  it('her PG sorgusu salt okunur; koleksiyon ve kaynak değeri parametrede', () => {
    for (const q of [FATURASIZ_SIPARIS_SORGUSU, leadCariSorgusu(['l1']), SUBE_SORGUSU, MF_IKIZ_SIPARIS_SORGUSU, MF_IKIZ_FATURA_SORGUSU, CETPA_EVRAK_SORGUSU]) {
      expect(q.sql).toMatch(/^SELECT /);
      expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
      expect(q.sql).not.toContain(';');
      expect(q.sql).toContain('FROM docs WHERE coll = $1');
    }
    expect(MF_IKIZ_SIPARIS_SORGUSU.params).toEqual(['orders', MF_KAYNAGI]);
    expect(MF_IKIZ_SIPARIS_SORGUSU.sql).not.toContain(MF_KAYNAGI);
    // (10) MF DIŞI (QH5 geri doldurması MF-Q1'e `faturali:false` yazar): kaynak parametrede, NULL kaynaklı yerel sipariş kalır.
    expect(FATURASIZ_SIPARIS_SORGUSU.params).toEqual(['orders', 'mikro-fatura']);
    expect(FATURASIZ_SIPARIS_SORGUSU.sql).toContain(`data->>'source' IS DISTINCT FROM $2`);
    expect(FATURASIZ_SIPARIS_SORGUSU.sql).not.toContain(MF_KAYNAGI);
    expect(leadCariSorgusu(['l1', 'l2']).params).toEqual(['leads', ['l1', 'l2']]);
  });
});

describe('(10)(12) faturasız sipariş havuzu ve Q ikiz adayı — kimlik dökülmez', () => {
  const leadler = leadCariHaritasi([
    { id: 'L1', companyId: 'K1', mikroCariKod: ' 0120037047 ', cariKod: '' },
    { id: 'L2', companyId: 'K1', mikroCariKod: '', cariKod: '' },
    { id: 'L3', companyId: 'K2', mikroCariKod: 'X' },
  ]);
  const satirlar = [
    { companyId: 'K1', kdvOran: 0, kdvTutari: 0, totalPrice: 4583.5, lineItems: [{ price: 4583.5, quantity: 1 }], depoNo: 2, leadId: 'L1', paid: false, createdAt: { _seconds: 1780700000, _nanoseconds: 0 }, status: 'Pending', source: null },
    { companyId: 'K1', kdvOran: 20, kdvTutari: 0, totalPrice: 4500, lineItems: [{ price: 4583.5, quantity: 1 }], depoNo: null, leadId: 'L2', paid: true, createdAt: '2026-06-10T10:00:00Z', status: 'Delivered', source: 'shopify_webhook' },
    { companyId: 'K1', kdvOran: null, totalPrice: null, lineItems: [], leadId: 'L3', createdAt: null, status: 'Cancelled' },
    { companyId: 'K1', kdvOran: 0, totalPrice: 100, lineItems: [{ price: 100, quantity: 1 }], depoNo: '1', leadId: '', createdAt: 'dün', source: 'mikro-fatura' },
  ];
  const h = faturasizHavuzOzeti(satirlar, leadler);
  it('kiracı başına sayılar: adet, kdvOran ≠ 0 / bilinmiyor, Σ kalem ≠ tutar, depo yok, lead yok / bulunamadı (yabancı kiracı dâhil) / carisiz, ödenmiş, createdAt biçimi', () => {
    expect(h.kiracilar.K1).toEqual({
      adet: 4, iptal: 1, kaynakUygunDegil: 2, kdvOranSifirDegil: 1, kdvOranBilinmiyor: 1, kdvTutariSifirDegil: 0,
      kalemOkunamadi: 1, tutarBilinmiyor: 1, kalemTutarUyusmuyor: 1, depoYok: 2, leadYok: 1, leadBulunamadi: 1, leadCarisiz: 1, odenmis: 1,
      createdAt: { seconds: 1, iso: 1, yok: 1, metin: 1 },
    });
    expect(JSON.stringify(h.kiracilar)).not.toMatch(/L1|L2|0120037047/);
  });
  it('createdAt biçimi: sunucu nöbetçisi / ISO / metin / yok / diğer', () => {
    expect([createdAtBicimi({ _seconds: 1 }), createdAtBicimi('2026-06-06T10:00:00Z'), createdAtBicimi('x'), createdAtBicimi(undefined), createdAtBicimi(5)])
      .toEqual(['seconds', 'iso', 'metin', 'yok', 'diger']);
  });
  it('(12) aynı cari + aynı ay faturasız sipariş Q başlığının ikiz adayıdır; adet + tutarlar (kimlik yok)', () => {
    const haziran = { ...satirlar[0], createdAt: '2026-06-20T10:00:00' };
    // MF-Q1 biçimli satır (QH5 sonrası `faturali:false`): Q-1'in kendi aynası — aynı cari, aynı ay, aynı tutar. Aday DEĞİLDİR.
    const mfQ1 = { ...haziran, leadId: '', source: MF_KAYNAGI, siparisCari: '0120037047', createdAt: '2026-06-06T12:00:00.000Z', totalPrice: 5500.2 };
    const havuz = faturasizHavuzOzeti([haziran, { ...haziran, createdAt: '2026-07-01T10:00:00' }, mfQ1], leadler);
    const aday = havuz.adaylar;
    expect(havuz.kiracilar.K1.kaynakUygunDegil).toBe(1);               // sayaç aynen: MF satırı (10)'da sayılır
    expect(aday.map(a => a.tutar)).not.toContain(5500.2);
    const basliklar: BaslikOzeti[] = [
      { sira: 1, seri: 'Q', tarih: '2026-06-06T00:00:00', cariKod: '0120037047', tip: 0, faturaKosulu: true, satirOzeti: null },
      { sira: 9, seri: 'Q', tarih: '2026-06-06T00:00:00', cariKod: '0120037047', tip: 0, faturaKosulu: false, satirOzeti: null },
    ];
    expect(qIkizAdaylari(basliklar, aday)).toEqual([{ sira: 1, ay: '2026-06', adayAdet: 1, adayTutarlari: [4583.5] }]);
  });
});

describe('(11) şube kodu 0', () => {
  it('SubeModule eşleşmesi sayısal: "0", 0, "00" sıfır; "", null, "A" değil', () => {
    expect(subeOzeti([{ companyId: 'K1', subeKodu: '0' }, { companyId: 'K1', subeKodu: 0 }, { companyId: 'K1', subeKodu: '00' },
      { companyId: 'K1', subeKodu: '' }, { companyId: 'K1', subeKodu: null }, { companyId: 'K1', subeKodu: 'A' }, { companyId: 'K2', subeKodu: '3' }]))
      .toEqual({ K1: { toplam: 6, kodSifir: 3 }, K2: { toplam: 1, kodSifir: 0 } });
  });
});

describe('(13) Satışlar çift sayımı — istemci kuralıyla (QH2) AYNI sonuç (QH4-8 çapraz ölçü)', () => {
  // PG satırları (sorgu takma adlarıyla) ve aynı verinin istemci biçimi.
  const fatura = [
    { companyId: 'K1', seri: '', sira: '101', tip: '0', meblag: 100000 },
    { companyId: 'K1', seri: 'Q', sira: '1', tip: '0', meblag: 5500.2 },
    { companyId: '', seri: '', sira: '102', tip: '0', meblag: 700 },         // etiketsiz — kiracıya görünür
    { companyId: 'K1', seri: '', sira: '200', tip: '1', meblag: 9 },          // alış
    { companyId: 'K1', seri: '', sira: '300', tip: '0', meblag: 1, iptal: 1 },  // iptal — Satışlar görmez
    { companyId: 'K1', seri: '', sira: '301', tip: '0', meblag: 2, gibRed: true },
    { companyId: 'K1', seri: '', sira: '500', tip: '0', meblag: 3 },          // Cetpa evrak no ile elenir
    { companyId: 'K2', seri: '', sira: '101', tip: '0', meblag: 1 },          // başka kiracı
  ];
  const mf = [
    { companyId: 'K1', seri: '', sira: '101', totalPrice: 100000, orderDate: '2026-06-15' },
    { companyId: 'K1', seri: 'Q', sira: '1', totalPrice: 5500.2, orderDate: '2026-06-06' },
    { companyId: 'K1', seri: '', sira: '102', totalPrice: null, orderDate: '2025-02-01' },
    { companyId: 'K1', seri: '', sira: '300', totalPrice: 1, orderDate: null },       // ikizi iptal → ikizsiz
    { companyId: 'K1', seri: '', sira: '500', totalPrice: 3, orderDate: '2026-01-01' }, // ikizi elenmiş → ikizsiz
  ];
  const evrak = [{ companyId: 'K1', mikroEvrakNo: ' 500 ' }];
  it('kiracı K1: ikizli 3 MF (biri tutarsız), ikizsiz 2, elenen 1; seri × yıl kırılımı', () => {
    const o = satisCiftSayimOlcumu(mf, fatura, evrak).K1;
    expect(o).toEqual({
      mfAdet: 5, mfTutar: { toplam: 105504.2, bilinen: 4, bilinmeyen: 1 },
      seriYil: {
        '(boş)|2026': { adet: 2, tutar: { toplam: 100003, bilinen: 2, bilinmeyen: 0 } },
        'Q|2026': { adet: 1, tutar: { toplam: 5500.2, bilinen: 1, bilinmeyen: 0 } },
        '(boş)|2025': { adet: 1, tutar: { toplam: 0, bilinen: 0, bilinmeyen: 1 } },
        '(boş)|(tarihsiz)': { adet: 1, tutar: { toplam: 1, bilinen: 1, bilinmeyen: 0 } },
      },
      ikizliMfAdet: 3, ikizliMfTutar: { toplam: 105500.2, bilinen: 2, bilinmeyen: 1 }, ikizliMikroTutar: { toplam: 106200.2, bilinen: 3, bilinmeyen: 0 },
      ikizsizMfAdet: 2, kaynaksizMfAdet: 0, kaynaksizMfTutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, cetpaEvrakIleElenen: 1, mikroGidenAdet: 4,
    });
  });
  // Şartname «Mikro bağlantı B» BH8: kaynaksız sayacı ayrık; ikizli + işaretli olan yalnız «ikizli»de, ikizsiz + işaretli yalnız
  // «kaynaksız»da. İstemci (`satisCiftSayimOzeti`) ile AYNI sonuç.
  it('BH8: işaretli ikizsiz MF `kaynaksizMf*`da (ikizsizden düşer); işaretli ikizli MF yalnız ikizlide; istemci yolu aynı sayıyı verir', () => {
    const isaretli = mf.map(r => (r.sira === '300' || r.sira === '101' ? { ...r, mfKaynaksiz: true } : r));
    const o = satisCiftSayimOlcumu(isaretli, fatura, evrak).K1;
    expect([o.ikizliMfAdet, o.ikizsizMfAdet, o.kaynaksizMfAdet]).toEqual([3, 1, 1]);
    expect(o.kaynaksizMfTutar).toEqual({ toplam: 1, bilinen: 1, bilinmeyen: 0 });
    const orders = isaretli.map(r => ({ source: MF_KAYNAGI, mikroEvrak: { seri: r.seri, sira: r.sira }, totalPrice: r.totalPrice, faturali: true, mfKaynaksiz: (r as { mfKaynaksiz?: boolean }).mfKaynaksiz }));
    const gorunen = fatura.filter(f => (!f.companyId || f.companyId === 'K1') && !f.iptal && !f.gibRed)
      .map((f, i) => mapMikroFatura(`f${i}`, { cha_evrakno_seri: f.seri, cha_evrakno_sira: f.sira, cha_tip: Number(f.tip), cha_meblag: f.meblag }));
    const istemci = satisCiftSayimOzeti(orders, satisIkizAnahtarlari(gorunen, new Set(['500'])));
    expect([istemci.eslesenAdet, istemci.ikizsizMfAdet, istemci.kaynaksizAdet]).toEqual([o.ikizliMfAdet, o.ikizsizMfAdet, o.kaynaksizMfAdet]);
    expect(istemci.kaynaksizTutar).toEqual(o.kaynaksizMfTutar);
  });
  it('iki başlıklı fatura (aynı seri-sıra, iki giden doküman 12.000 + 3.000): Mikro meblağı İKİSİNİN toplamı (Satışlar paritesi)', () => {
    const o = satisCiftSayimOlcumu(
      [{ companyId: 'K1', seri: '', sira: '246', totalPrice: 3000, orderDate: '2026-03-01' }],
      [{ companyId: 'K1', seri: '', sira: '246', tip: '0', meblag: 12000 }, { companyId: 'K1', seri: '', sira: '246', tip: '0', meblag: 3000 }],
      [],
    ).K1;
    expect(o.ikizliMfAdet).toBe(1);
    expect(o.ikizliMfTutar).toEqual({ toplam: 3000, bilinen: 1, bilinmeyen: 0 });
    expect(o.ikizliMikroTutar).toEqual({ toplam: 15000, bilinen: 2, bilinmeyen: 0 });
    expect(o.mikroGidenAdet).toBe(2);                                    // istemci de doküman sayar (faturalar.ts mikroGidenAdet)
    // Sıra bağımsız (sorguda ORDER BY yok): ters sırada aynı sonuç.
    const ters = satisCiftSayimOlcumu(
      [{ companyId: 'K1', seri: '', sira: '246', totalPrice: 3000, orderDate: '2026-03-01' }],
      [{ companyId: 'K1', seri: '', sira: '246', tip: '0', meblag: 3000 }, { companyId: 'K1', seri: '', sira: '246', tip: '0', meblag: 12000 }],
      [],
    ).K1;
    expect(ters.ikizliMikroTutar).toEqual({ toplam: 15000, bilinen: 2, bilinmeyen: 0 });
  });
  it('istemci yolu (mapMikroFatura → satisIkizAnahtarlari → satisCiftSayimOzeti) aynı eşleşen adet / tutarı verir', () => {
    const gorunen = fatura.filter(f => (!f.companyId || f.companyId === 'K1') && !f.iptal && !f.gibRed)
      .map((f, i) => mapMikroFatura(`f${i}`, { cha_evrakno_seri: f.seri, cha_evrakno_sira: f.sira, cha_tip: Number(f.tip), cha_meblag: f.meblag }));
    const orders = [
      ...mf.map(r => ({ source: MF_KAYNAGI, mikroEvrak: { seri: r.seri, sira: r.sira }, totalPrice: r.totalPrice, faturali: true })),
      { mikroEvrakNo: ' 500 ', totalPrice: 1, faturali: true },
    ];
    const ikiz = satisIkizAnahtarlari(gorunen, new Set(['500']));
    const istemci = satisCiftSayimOzeti(orders, ikiz);
    const sunucu = satisCiftSayimOlcumu(mf, fatura, evrak).K1;
    expect(istemci.eslesenAdet).toBe(sunucu.ikizliMfAdet);
    expect(istemci.eslesenTutar).toEqual(sunucu.ikizliMfTutar);
    expect(istemci.ikizsizMfAdet).toBe(sunucu.ikizsizMfAdet);
  });
});
