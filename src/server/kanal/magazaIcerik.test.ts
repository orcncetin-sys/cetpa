// @vitest-environment node
/**
 * magazaIcerik.test.ts — dilim 2b yazma yolunun SAF parçaları, şemaları ve kaynak çitleri (şartname v6 § 10.8 «Saf» / «Çitler»).
 *
 * Gerçek motor testleri ayrı dosyadadır (`magazaIcerik.pglite.test.ts`). Burada veritabanı YOK:
 *  • `revizeOkumaSutunlari` yedi bileşimi (kapı 4, Y12) — istek metni SELECT'e girmez,
 *  • elle talep numarası üreteci (desen + İstanbul günü) ve teyit anahtarı üreteci,
 *  • rota şemaları (`schemas.ts`): kısmi müşteri, `kdvKaynagi`, küme dışı oran, öncü sıfırlı / yinelenen anahtar → ret,
 *  • SQL sabitlerinin METNİ ve parametre sırası (parantezli `$8` birleştirmesi, `silindi` ölçütü, ürün okumasının kiracı koşulu),
 *  • kaynak çitleri: kapalı yama kümeleri, BEYAN alanlarının hiçbir yamada geçmemesi, içe aktarımlar.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { z } from 'zod';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';
import { MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_KDV_ORANLARI, MAGAZA_REVIZE_ALANLARI, MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep';
import type { MagazaRevizeAlani } from '../../lib/magazaTalep';
import {
  BildirimGonderSorgusu, ErpElleTalepGovdesi, ErpIcerikGovdesi, ErpSilGovdesi, MagazaSiparisTalebiSchema, PanelSilGovdesi,
} from '../schemas';
import { MAGAZA_SILINMEMIS_SQL, MAGAZA_SILINMIS_SQL } from './magazaDurum';
import {
  ELLE_TALEP_DENEME_SINIRI, GERI_AL_SQL, ICERIK_SQL, SIL_SQL, URUN_KDV_SQL, elleTalepNoUret, icerikOkuSql, revizeOkumaSutunlari, teyitAnahtariUret,
} from './magazaIcerik';
import type { ElleTalepGovdesi, IcerikDegistirGirdisi } from './magazaIcerik';
import { EKLEME_SQL } from './magazaTalepSql';

const DOSYA = join(SRC_KOK, 'server', 'kanal', 'magazaIcerik.ts');
const satirlar = kodSatirlari(DOSYA).map(s => s.kod);
const kod = satirlar.join('\n');

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('revizeOkumaSutunlari — dar okumanın sütunları verilen alanlara göre (kapı 4, Y12)', () => {
  const SABIT = `jsonb_typeof(data->'silindi') AS silindi_turu, COALESCE(data->>'icerikSurum', '0') AS surum, data->>'talepNo' AS talep_no`;
  const MUSTERI = `data->'musteri' AS eski_musteri`;
  const NOT = `data->>'not' AS eski_not`;
  const TEYIT = `data->'teyit'->'kalemler' AS teyit_kalemleri, (CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN jsonb_array_length(data->'kalemler') ELSE 0 END) AS beyan_sayisi`;
  const BILESIMLER: Array<[MagazaRevizeAlani[], string[]]> = [
    [['musteri'], [MUSTERI]], [['not'], [NOT]], [['teyit'], [TEYIT]],
    [['musteri', 'not'], [MUSTERI, NOT]], [['musteri', 'teyit'], [MUSTERI, TEYIT]], [['not', 'teyit'], [NOT, TEYIT]],
    [['musteri', 'not', 'teyit'], [MUSTERI, NOT, TEYIT]],
  ];

  it('yedi bileşim (2³ − 1): sabit sütunlar HEPSİNDE; her alanın sütunu yalnız o alan verilmişse', () => {
    expect(BILESIMLER).toHaveLength(7);
    for (const [alanlar, beklenen] of BILESIMLER) {
      const sutunlar = revizeOkumaSutunlari(alanlar);
      expect(sutunlar, alanlar.join('+')).toBe([SABIT, ...beklenen].join(', '));
      expect(sutunlar.includes('eski_musteri'), alanlar.join('+')).toBe(alanlar.includes('musteri'));
      expect(sutunlar.includes('eski_not'), alanlar.join('+')).toBe(alanlar.includes('not'));
      expect(sutunlar.includes('teyit_kalemleri'), alanlar.join('+')).toBe(alanlar.includes('teyit'));
      expect(sutunlar.includes('beyan_sayisi'), alanlar.join('+')).toBe(alanlar.includes('teyit'));
      for (const sabit of ['silindi_turu', 'AS surum', 'talep_no']) expect(sutunlar, alanlar.join('+')).toContain(sabit);
    }
  });
  it('boş liste → yalnız sabit sütunlar (yeniden okuma bunu kullanır); sıra girdiden BAĞIMSIZ sabit; yinelenen ad tek sütun', () => {
    expect(revizeOkumaSutunlari([])).toBe(SABIT);
    expect(revizeOkumaSutunlari(['teyit', 'musteri'])).toBe(revizeOkumaSutunlari(['musteri', 'teyit']));
    expect(revizeOkumaSutunlari(['not', 'not', 'not'])).toBe([SABIT, NOT].join(', '));
  });
  it('istek metninden hiçbir parça SELECT\'e GİRMEZ: tanınmayan ad (SQL parçası dâhil) hiçbir şey üretmez', () => {
    const kotu = ['musteri; DROP TABLE docs', "not' OR '1'='1", 'data', '*', 'MUSTERI', ''] as unknown as MagazaRevizeAlani[];
    expect(revizeOkumaSutunlari(kotu)).toBe(SABIT);
    expect(revizeOkumaSutunlari([...kotu, 'not'])).toBe([SABIT, NOT].join(', '));
    expect(icerikOkuSql(kotu)).not.toMatch(/DROP|OR '1'|SELECT \*/);
  });
  it('tam metin: tek satır (kimlik + kiracı); belgenin tamamı, `talepEdilen`, `bildirim*`, `kalemTeslim`, `durumGecmisi` ÇEKİLMEZ', () => {
    for (const [alanlar] of BILESIMLER) {
      const sql = icerikOkuSql(alanlar);
      expect(sql).toBe(`SELECT ${revizeOkumaSutunlari(alanlar)} FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`);
      expect(sql).not.toMatch(/SELECT data FROM|SELECT \*|talepEdilen|bildirim|kalemTeslim|durumGecmisi|telefonSon10/);
      expect([...new Set(sql.match(/\$\d+/g))]).toEqual(['$1', '$2', '$3']);
    }
    expect([...MAGAZA_REVIZE_ALANLARI]).toEqual(['musteri', 'not', 'teyit']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('üreteçler — elle talep numarası ve teyit kalemi anahtarı', () => {
  it('`elleTalepNoUret`: mağaza deseniyle AYNI biçim (`MAGAZA_TALEP_NO_DESENI`); sonek [A-Z0-9] ve rastgele', () => {
    const simdi = new Date('2026-10-10T09:00:00.000Z');
    const nolar = Array.from({ length: 200 }, () => elleTalepNoUret(simdi));
    for (const no of nolar) {
      expect(MAGAZA_TALEP_NO_DESENI.test(no), no).toBe(true);
      expect(no.slice(0, 8)).toBe('T261010-');
    }
    expect(new Set(nolar).size).toBeGreaterThan(190);   // 36⁴ ≈ 1,68 milyon: 200 çekilişte yineleme pratikte yok
  });
  it('`elleTalepNoUret` İSTANBUL gününü basar — sürecin saat dilimine güvenmez: UTC 20:59 aynı gün, UTC 21:00 (İstanbul 00:00) ERTESİ gün', () => {
    expect(elleTalepNoUret(new Date('2026-10-10T20:59:59.999Z')).slice(0, 7)).toBe('T261010');
    expect(elleTalepNoUret(new Date('2026-10-10T21:00:00.000Z')).slice(0, 7)).toBe('T261011');
    expect(elleTalepNoUret(new Date('2026-10-10T22:30:00.000Z')).slice(0, 7)).toBe('T261011');
    // Yıl ve ay sınırı; tek haneli ay / gün iki haneye tamamlanır.
    expect(elleTalepNoUret(new Date('2026-12-31T21:30:00.000Z')).slice(0, 7)).toBe('T270101');
    expect(elleTalepNoUret(new Date('2027-03-04T08:00:00.000Z')).slice(0, 7)).toBe('T270304');
  });
  it('`teyitAnahtariUret`: `t:` + 12 onaltılık hane (`MAGAZA_KALEM_ANAHTARI_DESENI`); rastgele', () => {
    const anahtarlar = Array.from({ length: 200 }, () => teyitAnahtariUret());
    for (const a of anahtarlar) {
      expect(a).toMatch(/^t:[0-9a-f]{12}$/);
      expect(MAGAZA_KALEM_ANAHTARI_DESENI.test(a)).toBe(true);
    }
    expect(new Set(anahtarlar).size).toBe(200);
  });
  it('kaynak: rastgelelik `node:crypto`\'dan (`randomBytes` / `randomInt`); `Math.random` YOK; gün `Europe/Istanbul` ile', () => {
    expect(kod).toContain("import { randomBytes, randomInt } from 'node:crypto';");
    expect(kod).not.toMatch(/Math\.random/);
    expect(kod).toContain("timeZone: 'Europe/Istanbul'");
    expect(kod).not.toMatch(/getFullYear\(|getMonth\(|getDate\(|getHours\(|toLocaleDateString\(/);
    expect(ELLE_TALEP_DENEME_SINIRI).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('şemalar — `ErpIcerikGovdesi` (POST /api/magaza-talepleri/:id/icerik)', () => {
  const MUSTERI = { ad: 'Şükrü Öztürk', firma: '', telefon: '0532 111 22 33', eposta: '', il: 'Antalya', adres: '', vergi: '' };
  const KALEM = { ad: 'Boya', adet: 2, birimFiyat: 95 };
  const gecer = (v: unknown): boolean => ErpIcerikGovdesi.safeParse(v).success;

  it('geçerli gövdeler: yalnız not / yalnız müşteri / yalnız teyit / tam gövde; boş dizge alanlar ve `null` fiyat kabul', () => {
    expect(gecer({ icerikSurum: 0, not: '' })).toBe(true);
    expect(gecer({ icerikSurum: 3, musteri: MUSTERI })).toBe(true);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [KALEM] } })).toBe(true);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, birimFiyat: null }] } })).toBe(true);
    expect(gecer({
      icerikSurum: 1, musteri: MUSTERI, not: 'n',
      teyit: { kalemler: [{ anahtar: 'b:0', id: 'k', sku: 'ABC', ad: 'Boya', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 10, tedarik: true }, { anahtar: 't:0123456789ab', ad: 'x', adet: 1, birimFiyat: 0 }] },
    })).toBe(true);
  });
  it('en az bir bölüm zorunlu; `icerikSurum` zorunlu, eksi / kesirli / dizge → ret', () => {
    expect(gecer({ icerikSurum: 0 })).toBe(false);
    expect(gecer({ not: 'n' })).toBe(false);
    for (const icerikSurum of [-1, 1.5, '0', null]) expect(gecer({ icerikSurum, not: 'n' }), String(icerikSurum)).toBe(false);
  });
  it('KISMİ müşteri nesnesi ret: yedi alanın yedisi de zorunlu (`||` sığ birleştirir — eksik alan saklı değeri SİLERDİ); tanınmayan alan ret', () => {
    for (const alan of Object.keys(MUSTERI)) {
      const eksik: Record<string, string> = { ...MUSTERI };
      delete eksik[alan];
      expect(gecer({ icerikSurum: 0, musteri: eksik }), alan).toBe(false);
    }
    expect(gecer({ icerikSurum: 0, musteri: { ad: 'A', telefon: '0532 111 22 33' } })).toBe(false);
    expect(gecer({ icerikSurum: 0, musteri: { ...MUSTERI, telefonSon10: '5321112233' } })).toBe(false);
    expect(gecer({ icerikSurum: 0, musteri: { ...MUSTERI, il: null } })).toBe(false);
  });
  it('BEYAN ve sunucunun türettiği alanlar gövdede KABUL EDİLMEZ (`.strict()`): `kalemler`, `talepEdilen`, toplamlar, `kdvKaynagi`, `telefonSon10`, `talepNo`', () => {
    for (const ek of [{ kalemler: [KALEM] }, { talepEdilen: { toplam: 1 } }, { telefonSon10: '5321112233' }, { talepNo: 'T261010-AB12' }, { durum: 'teslim' }, { silindi: null }, { bildirimRevize: {} }]) {
      expect(gecer({ icerikSurum: 0, not: 'n', ...ek }), JSON.stringify(ek)).toBe(false);
    }
    for (const ek of [{ araToplam: 190 }, { kdv: 38 }, { toplam: 228 }, { zaman: 'z' }, { kim: { uid: 'u', ad: 'A' } }]) {
      expect(gecer({ icerikSurum: 0, teyit: { kalemler: [KALEM], ...ek } }), JSON.stringify(ek)).toBe(false);
    }
    // Kaynak sunucunun çıkarımıdır: istekteki `kdvKaynagi` 400.
    for (const kdvKaynagi of ['personel', 'urun', 'varsayilan']) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, kdvKaynagi }] } }), kdvKaynagi).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, teslim: true }] } })).toBe(false);
  });
  it('`kdvOrani` İSTEĞE BAĞLI; verilmişse kümede olmalı — şema sabiti içe aktarır: her küme üyesi geçer, 8 / 18 / dizge / `null` ret', () => {
    for (const kdvOrani of MAGAZA_KDV_ORANLARI) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, kdvOrani }] } }), String(kdvOrani)).toBe(true);
    for (const kdvOrani of [18, 8, 4, 20.5, -1, '20', null]) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, kdvOrani }] } }), String(kdvOrani)).toBe(false);
  });
  it('`birimFiyat` ZORUNLU anahtar (sayı ya da açıkça `null`): yoksa ret — «unutulan fiyat» sessizce «fiyat sorulacak»a dönmez; eksi / dizge ret; 0 geçer', () => {
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ad: 'x', adet: 1 }] } })).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ad: 'x', adet: 1, birimFiyat: 0 }] } })).toBe(true);
    for (const birimFiyat of [-1, '95', Number.NaN, Number.POSITIVE_INFINITY]) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ad: 'x', adet: 1, birimFiyat }] } }), String(birimFiyat)).toBe(false);
  });
  it('`adet` pozitif tam sayı: 0 / eksi / `12,5` (kesirli) / dizge ret; boş kalem dizisi ret (bütün kalemleri silmek isteyen talebi iptal eder)', () => {
    for (const adet of [0, -1, 12.5, '2', null]) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, adet }] } }), String(adet)).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [] } })).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: {} })).toBe(false);
  });
  it('`anahtar` kurallı desen: öncü sıfırlı `b:01` / `b:001` ret (K5); desene uymayan ret; aynı istekte YİNELENEN anahtar ret; anahtarsız kalemler serbest', () => {
    for (const anahtar of ['b:0', 'b:12', 't:0123456789ab']) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, anahtar }] } }), anahtar).toBe(true);
    for (const anahtar of ['b:01', 'b:001', 'b:', 't:0123456789AB', 't:012', 'c:0', '', 'hepsi', 7]) expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, anahtar }] } }), String(anahtar)).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, anahtar: 'b:1' }, { ...KALEM, anahtar: 'b:1' }] } })).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, anahtar: 'b:1' }, { ...KALEM, anahtar: 'b:01' }] } })).toBe(false);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, anahtar: 'b:1' }, { ...KALEM, anahtar: 'b:0' }, KALEM, KALEM] } })).toBe(true);
  });
  it('`not` ham en çok 4.000 karakter (temizlik + 1.000 birime kırpma yazma yolunda); metin alanlarında başka `.max()` yok (aşım ret değil KIRPMA)', () => {
    expect(gecer({ icerikSurum: 0, not: 'n'.repeat(4000) })).toBe(true);
    expect(gecer({ icerikSurum: 0, not: 'n'.repeat(4001) })).toBe(false);
    expect(gecer({ icerikSurum: 0, musteri: { ...MUSTERI, adres: 'a'.repeat(5000) } })).toBe(true);
    expect(gecer({ icerikSurum: 0, teyit: { kalemler: [{ ...KALEM, ad: 'a'.repeat(5000) }] } })).toBe(true);
  });
  it('TİP ÇİTİ: şemadan çıkan gövde yazma işlevinin girdisine daraltma / `as` olmadan atanır (şema değişip işlev tipi bayatlarsa derlenmez)', () => {
    type Govde = z.infer<typeof ErpIcerikGovdesi>;
    const cozum = ErpIcerikGovdesi.parse({ icerikSurum: 2, musteri: MUSTERI, not: 'n', teyit: { kalemler: [{ ...KALEM, kdvOrani: 10, anahtar: 'b:0' }] } });
    const govde: Govde = cozum;
    const girdi: IcerikDegistirGirdisi = {
      id: 'mt-0', companyId: 'c', kim: { uid: 'u', ad: 'A', eposta: '' }, kanal: 'erp',
      icerikSurum: govde.icerikSurum, musteri: govde.musteri, not: govde.not, teyit: govde.teyit,
    };
    expect(girdi.teyit?.kalemler[0]).toEqual({ ad: 'Boya', adet: 2, birimFiyat: 95, kdvOrani: 10, anahtar: 'b:0' });
    expect(girdi.musteri).toEqual(MUSTERI);
  });
});

describe('şemalar — silme, elle talep, bildirim sorgusu', () => {
  it('`ErpSilGovdesi`: `{ surum, geriAl? }`; `PanelSilGovdesi`: yalnız `{ surum }` — panelden geri alma YOK (`geriAl` 400)', () => {
    expect(ErpSilGovdesi.safeParse({ surum: 0 }).success).toBe(true);
    expect(ErpSilGovdesi.safeParse({ surum: 4, geriAl: true }).success).toBe(true);
    expect(ErpSilGovdesi.safeParse({ surum: 4, geriAl: false }).success).toBe(true);
    expect(PanelSilGovdesi.safeParse({ surum: 4 }).success).toBe(true);
    expect(PanelSilGovdesi.safeParse({ surum: 4, geriAl: true }).success).toBe(false);
    for (const sema of [ErpSilGovdesi, PanelSilGovdesi]) {
      for (const v of [{}, { surum: -1 }, { surum: 1.5 }, { surum: '3' }, { surum: 3, id: 'mt-0' }, { surum: 3, kim: 'x' }, null, []]) expect(sema.safeParse(v).success, JSON.stringify(v)).toBe(false);
    }
    expect(ErpSilGovdesi.safeParse({ surum: 3, geriAl: 'evet' }).success).toBe(false);
  });
  it('`ErpElleTalepGovdesi`: mağaza talebi gövdesinin `no` ve `tarih`\'siz hâli — ikisi de gövdede gelirse 400 (numarayı SUNUCU üretir); tanınmayan alan 400', () => {
    const govde = { musteri: { ad: 'A', telefon: '0532 111 22 33' }, kalemler: [{ ad: 'x', adet: 1 }] };
    expect(ErpElleTalepGovdesi.safeParse(govde).success).toBe(true);
    expect(ErpElleTalepGovdesi.safeParse({ ...govde, not: 'n', araToplam: 1, kdv: 0.2, toplam: 1.2 }).success).toBe(true);
    expect(ErpElleTalepGovdesi.safeParse({ ...govde, no: 'T261010-AB12' }).success).toBe(false);
    expect(ErpElleTalepGovdesi.safeParse({ ...govde, tarih: '2026-10-10T09:00:00.000Z' }).success).toBe(false);
    for (const ek of [{ elle: {} }, { bildirim: {} }, { durum: 'teslim' }, { companyId: 'x' }]) expect(ErpElleTalepGovdesi.safeParse({ ...govde, ...ek }).success, JSON.stringify(ek)).toBe(false);
    expect(ErpElleTalepGovdesi.safeParse({ ...govde, kalemler: [] }).success).toBe(false);
    expect(ErpElleTalepGovdesi.safeParse({ kalemler: govde.kalemler }).success).toBe(false);
    // Mağaza şeması DEĞİŞMEDİ: kimliksiz uç `no` ister ve tanınmayan alanı atar (strict değil).
    expect(MagazaSiparisTalebiSchema.safeParse({ ...govde, no: 'T261010-AB12', bilinmeyen: 1 }).success).toBe(true);
    expect(MagazaSiparisTalebiSchema.safeParse(govde).success).toBe(false);
  });
  it('TİP ÇİTİ: `ErpElleTalepGovdesi` çıktısı `elleTalepAc` girdisine daraltmasız atanır', () => {
    const cozum = ErpElleTalepGovdesi.parse({ musteri: { ad: 'A', telefon: '0532 111 22 33' }, kalemler: [{ ad: 'x', adet: 1, birimFiyat: null }] });
    const girdi: ElleTalepGovdesi = cozum;
    expect(girdi.kalemler).toHaveLength(1);
    expect('no' in girdi).toBe(false);
  });
  it('`BildirimGonderSorgusu`: `tur` YALNIZ `revize` (kapı 4, Y8) — yok = ilk bildirim; `ilk` dâhil başka her değer ve tanınmayan parametre ret', () => {
    expect(BildirimGonderSorgusu.safeParse({}).success).toBe(true);
    expect(BildirimGonderSorgusu.safeParse({ tur: 'revize' }).success).toBe(true);
    for (const v of [{ tur: 'ilk' }, { tur: 'x' }, { tur: '' }, { tur: 'REVIZE' }, { tur: ['revize'] }, { tur: 'revize', baska: '1' }, { baska: '1' }]) {
      expect(BildirimGonderSorgusu.safeParse(v).success, JSON.stringify(v)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('SQL sabitlerinin metni ve parametre sırası (§ 10.8 «Çitler»)', () => {
  it('`ICERIK_SQL` tam metin: $4 yama · $5 okunan icerikSurum · $6 kalem teslim taşıması · $7 revize nesnesi · $8 alanlar; `silindi` koşulu', () => {
    expect(ICERIK_SQL).toBe(`UPDATE docs SET data = (data || $4::jsonb) || (CASE WHEN $6::jsonb = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('kalemTeslim', (CASE WHEN jsonb_typeof(data->'kalemTeslim') = 'object' THEN data->'kalemTeslim' ELSE '{}'::jsonb END) || (SELECT COALESCE(jsonb_object_agg(e.key, data->'kalemTeslim'->e.value), '{}'::jsonb) FROM jsonb_each_text($6::jsonb) e WHERE jsonb_typeof(data->'kalemTeslim'->e.value) = 'object')) END) || jsonb_build_object('bildirimRevize', (CASE WHEN data->'bildirimRevize'->>'durum' IN ('bekliyor', 'gonderilemedi', 'yapilandirilmamis') THEN ($7::jsonb || jsonb_build_object('alanlar', (COALESCE(data->'bildirimRevize'->'alanlar', '[]'::jsonb) || $8::jsonb))) ELSE $7::jsonb END)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'icerikSurum', '0') = $5 AND jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object' RETURNING data`);
    expect([...new Set(ICERIK_SQL.match(/\$\d+/g))].sort()).toEqual(['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8']);
  });
  it('(inceleme 2b, bulgu 10 — bilerek değişen çit) revize birleştirme koşulu GİTMEMİŞ üç durumun ADLI kümesidir: `gitti` kümede YOK; `IS DISTINCT FROM \'gitti\'` yazımı YOK (tanınmayan durumda çöp `alanlar` taşırdı)', () => {
    expect(ICERIK_SQL).toContain(`CASE WHEN data->'bildirimRevize'->>'durum' IN ('bekliyor', 'gonderilemedi', 'yapilandirilmamis') THEN`);
    expect(ICERIK_SQL).not.toContain(`'durum' = 'bekliyor'`);
    expect(ICERIK_SQL).not.toContain(`'gitti'`);
    // Koşulda `bildirimRevize.durum` TEK kez okunur; birleştirme dalı yine `$7`'den kurulur (`deneme` / `hataSinifi` taşınmaz).
    expect(ICERIK_SQL.match(/data->'bildirimRevize'->>'durum'/g)).toHaveLength(1);
    expect(ICERIK_SQL).toContain(`THEN ($7::jsonb || jsonb_build_object('alanlar'`);
  });
  it('`ICERIK_SQL` revize birleştirmesi PARANTEZLİ ve `$8` ile (kapı 3, K9): `$7::jsonb->\'alanlar\'` metni YOK (ikinci revizyonda `alanlar: null` üretiyordu)', () => {
    expect(ICERIK_SQL).toContain(`(COALESCE(data->'bildirimRevize'->'alanlar', '[]'::jsonb) || $8::jsonb)`);
    expect(ICERIK_SQL).not.toContain(`$7::jsonb->'alanlar'`);
    expect(ICERIK_SQL).not.toMatch(/\$7(::jsonb)?\s*->/);
    // İlk bildirim alanı bu ifadede GEÇMEZ; `kalemTeslim` yalnız taşıma dalında, yeni değer üretmeden.
    expect(ICERIK_SQL).not.toMatch(/'bildirim'|'\{bildirim\}'/);
    expect(ICERIK_SQL).not.toMatch(/durumSurum|durumZamani|etiketBasildi|'kalemler'\s*,|talepEdilen/);
  });
  it('`SIL_SQL` / `GERI_AL_SQL` tam metin: $4 yama, $5 okunan `durumSurum`; silme SİLİNMEMİŞ satıra, geri alma SİLİNMİŞ satıra', () => {
    expect(SIL_SQL).toBe(`UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $5 AND jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object' RETURNING data`);
    expect(GERI_AL_SQL).toBe(`UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $5 AND jsonb_typeof(data->'silindi') = 'object' RETURNING data`);
    expect(SIL_SQL.endsWith(` AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`)).toBe(true);
    expect(GERI_AL_SQL.endsWith(` AND ${MAGAZA_SILINMIS_SQL} RETURNING data`)).toBe(true);
    // Kayıt SİLİNMEZ: `DELETE` metni bu dosyada hiç yok.
    expect(kod).not.toMatch(/\bDELETE\b/);
  });
  it('üç yazma sabiti: tek `UPDATE`, tek `now()` (yalnız `updated_at`), kiracı koşulu, `RETURNING data`; ölçüt `jsonb_typeof` (`IS NULL` yok); `etiketBasildi` yok', () => {
    for (const sql of [ICERIK_SQL, SIL_SQL, GERI_AL_SQL]) {
      expect((sql.match(/UPDATE /g) ?? []).length).toBe(1);
      expect((sql.match(/now\(\)/g) ?? []).length).toBe(1);
      expect(sql).toContain('updated_at = now()');
      expect(sql).toContain(`WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND`);
      expect(sql).toMatch(/RETURNING data$/);
      expect(sql).not.toMatch(/'silindi' IS (NOT )?NULL|etiketBasildi|icerikZamani|durumZamani/);
    }
  });
  it('`URUN_KDV_SQL` tam metin: yalnız `inventory`, yalnız `sku` + `vatRate`; kiracı koşulu JS kalıbıyla birebir (kapı 4, Y11); `ANY($2::text[])`', () => {
    expect(URUN_KDV_SQL).toBe(`SELECT data->>'sku' AS sku, data->'vatRate' AS vat_rate FROM docs WHERE coll = 'inventory' AND (data->>'companyId' = $1 OR data->>'companyId' IS NULL OR data->>'companyId' = '') AND data->>'sku' = ANY($2::text[])`);
    // Sıkı `= $1` TEK BAŞINA yok (etiketsiz eski kart dışlanırdı); `NOT (data ? 'companyId')` yok (`''` / `null` etiketi dışlardı).
    expect(URUN_KDV_SQL).not.toContain(`NOT (data ? 'companyId')`);
    expect(URUN_KDV_SQL).not.toMatch(/WHERE coll = 'inventory' AND data->>'companyId' = \$1 AND/);
    expect(URUN_KDV_SQL).not.toMatch(/SELECT data FROM|SELECT \*|'name'|'price'|'prices'|stockLevel|costPrice/);
    expect([...new Set(URUN_KDV_SQL.match(/\$\d+/g))]).toEqual(['$1', '$2']);
    // Dosyadaki TEK `inventory` okuması; başka koleksiyon adı SQL'de geçmez (talep koleksiyonu parametreyle gelir).
    expect(kod.match(/coll = '[^']+'/g)).toEqual([`coll = 'inventory'`]);
  });
  it('elle talep dilim 1\'in `INSERT` sabitini kullanır: bu dosyada ikinci `INSERT` metni yok; sabit `magazaTalepSql.ts`ten içe aktarılır', () => {
    expect(kod).not.toMatch(/INSERT INTO/);
    expect(kod).toContain("import { EKLEME_SQL } from './magazaTalepSql.js';");
    expect(kod.match(/h\.query\(EKLEME_SQL, /g)).toHaveLength(1);
    expect(EKLEME_SQL).toBe('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING RETURNING id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kaynak çitleri — magazaIcerik.ts', () => {
  it('içe aktarımlar: `node:crypto`, ortak sözleşme, 2a yardımcıları, dilim 1 eşleyicisi, ekleme sabiti, havuz tipi — pgShim / server.ts / kuyruk / şema YOK', () => {
    expect(kod.match(/^import .*$/gm)?.map(s => s.replace(/\{[^}]*\}/, '{…}'))).toEqual([
      "import {…} from 'node:crypto';",
      "import {",   // çok satırlı: ortak sözleşme
      "import type {",
      "import {",   // çok satırlı: magazaDurum yardımcıları
      "import type {…} from './magazaDurum.js';",
      "import {…} from './magazaTalep.js';",
      "import type {…} from './magazaTalep.js';",
      "import {…} from './magazaTalepSql.js';",
      "import type {…} from '../routes/magazaRoutes.js';",
    ]);
    expect([...new Set(kod.match(/from '[^']+'/g))].sort()).toEqual([
      "from '../../lib/magazaTalep.js'", "from '../routes/magazaRoutes.js'", "from './magazaDurum.js'", "from './magazaTalep.js'", "from './magazaTalepSql.js'", "from 'node:crypto'",
    ]);
    expect(kod).not.toMatch(/pgShim|pg-boss|magazaBildirim|adminDb|computeFieldDiff|\brequire\(|\bimport\(|from 'zod'/);
  });
  it('yama nesneleri KAPALI: BEYAN (`kalemler`, `talepEdilen`) ve içerik dışı alanlar hiçbir `const yama = {` gövdesinde yok', () => {
    const baslangiclar = satirlar.map((s, i) => (/^\s*const yama = \{/.test(s) ? i : -1)).filter(i => i >= 0);
    expect(baslangiclar).toHaveLength(3);   // içerik, silme, geri alma
    const govdeler = baslangiclar.map(bas => {
      const son = satirlar.findIndex((s, i) => i >= bas && /\};\s*$/.test(s));
      return satirlar.slice(bas, son + 1).join('\n');
    });
    for (const govde of govdeler) {
      expect(govde).not.toMatch(/\b(kalemler|talepEdilen|telefonSon10|talepNo|olusturma|companyId|bildirim|bildirimRevize|kalemTeslim|elle|etiketBasildi|durumZamani|fiyatiSorulacakVar)\b\s*[:,}]/);
      expect(govde).not.toMatch(/\.\.\.okunan|\.\.\.satir|\.\.\.guncel/);
    }
    // İçerik yaması: yalnız altı anahtar; silme: `silindi` + `durumSurum`; geri alma: `silindi: null` + `durumSurum`.
    expect(govdeler[0]).toMatch(/musteri/);
    expect(govdeler[0]).toContain('icerikSurum: yeniSurum, icerikZamani: simdi,');
    expect(govdeler[0]).not.toMatch(/durumSurum|silindi/);
    expect(govdeler[1]).toBe('  const yama = { silindi, durumSurum: okunanSurum + 1 };');
    expect(govdeler[2]).toBe('  const yama = { silindi: null, durumSurum: okunanSurum + 1 };');
  });
  it('okunan satırın yayılımı yamaya / yayına girmez; yayınlanan belge `RETURNING` satırıdır (elle talepte yazılan belgenin kendisi)', () => {
    expect(kod).not.toMatch(/\.\.\.okunan|\.\.\.guncel|\.\.\.satir\b/);
    expect(kod.match(/yayinla\(D, g\.id, satir\);/g)).toHaveLength(3);
    expect(kod.match(/yayinla\(/g)).toHaveLength(4);
    expect(kod).toContain('yayinla(D, esleme.id, { ...belge });');
    // Eski değerler (`eskiMusteri` / `eskiNot`) YALNIZ `degisenAlanlar` karşılaştırmasına girer.
    expect(kod.match(/okunan\.eskiMusteri/g)).toHaveLength(1);
    expect(kod.match(/okunan\.eskiNot/g)).toHaveLength(1);
    const karsilastirma = satirlar.find(s => s.includes('okunan.eskiMusteri'));
    expect(karsilastirma).toContain('{ musteri: okunan.eskiMusteri, not: okunan.eskiNot, teyit: { kalemler: okunan.teyitKalemleri } },');
  });
  it('denetim: dört eylem, ayrıntı yalnız talep no + kanal (+ alan adları); `diff` bağımsız değişkeni HİÇ verilmez', () => {
    const cagrilar = satirlar.filter(s => /await denetle\(/.test(s)).map(s => s.trim());
    expect(cagrilar).toEqual([
      "await denetle(D, g.kim, 'Mağaza talebi içeriği', `${okunan.talepNo} · ${g.kanal} · ${alanlar.join(', ')}`);",
      "await denetle(D, g.kim, 'Mağaza talebi silindi', `${okunan.talepNo} · ${g.kanal}`);",
      "await denetle(D, g.kim, 'Mağaza talebi geri alındı', `${okunan.talepNo} · erp`);",
      "await denetle(D, g.kim, 'Mağaza talebi elle açıldı', `${belge.talepNo} · erp`);",
    ]);
    expect(kod).not.toMatch(/writeAuditLog\(/);   // yalnız ortak `denetle` yardımcısı üzerinden (arıza yazımı geri almaz)
  });
  it('bildirim: revize isteği YALNIZ içerik yazımında, ilk bildirim isteği YALNIZ elle talepte — birer çağrı; silme / geri alma istemez', () => {
    expect(kod.match(/D\.revizeBildirimiIste\(/g)).toHaveLength(1);
    expect(kod.match(/D\.bildirimIste\(/g)).toHaveLength(1);
    expect(kod).toContain('await D.revizeBildirimiIste(g.id);');
    expect(kod).toContain('await D.bildirimIste(esleme.id);');
    const silBas = satirlar.findIndex(s => s.startsWith('export async function talepSil('));
    const elleBas = satirlar.findIndex(s => s.startsWith('export async function elleTalepAc('));
    expect(silBas).toBeGreaterThan(-1);
    expect(elleBas).toBeGreaterThan(silBas);
    expect(satirlar.slice(silBas, elleBas).join('\n')).not.toMatch(/bildirimIste|revizeBildirimiIste/);
  });
  it('para ve tip disiplini: toplam formülü burada YAZILMAZ (`magazaTeyitToplamlari`); `Math.round` / `?? 0` / `|| 0` / `as any` / `@ts-` / `!.` yok; saat yalnız bağlamdan', () => {
    expect(kod).toContain('...magazaTeyitToplamlari(teyitKalemleri)');
    expect(kod).not.toMatch(/Math\.round|toFixed\(|\* 100\b|\/ 100\b/);
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error|\w!\.|\w!\)/);
    expect(kod).not.toMatch(/Date\.now\(|process\.env/);
    expect(kod.match(/new Date\(\)/g)).toHaveLength(1);   // yalnız `D.simdi?.() ?? new Date()` (elle talep; öbürleri `zaman(D)`)
    expect(kod).not.toMatch(/toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase/);
    // KDV kümesi kopyalanmaz: oran denetimi ortak sözleşmenin işlevleriyle.
    expect(kod).not.toMatch(/\[\s*0\s*,\s*1\s*,\s*10\s*,\s*20\s*\]|=== 18|=== 20\b/);
  });
  it('günlüğe hata NESNESİ / iletisi yazılmaz: yalnız sabit metin + `hataKodu(e)`', () => {
    const gunlukler = satirlar.filter(s => /console\.(error|warn|log)\(/.test(s));
    expect(gunlukler).toHaveLength(2);
    for (const s of gunlukler) expect(s).toMatch(/console\.error\('\[magaza-icerik\] [^']+:', hataKodu\(e\)\);/);
  });
});
