/**
 * eslemeCari.b3.test.ts: aynı VKN'li iki Mikro cari = iki ayrı lead, SAF işlevler (şartname «Mikro bağlantı B» § 5.2, § 5.5 T-B3-1 …
 * T-B3-5, BH9, BH19; 05.11.2026). Bu turda (B3-a) işlevler yazıcılara bağlı DEĞİL; yalnız `cari-kod-tani` kuru koşusu çağırır.
 * Fikstürler inşaat malzemesi toptancısı carileri; VKN'ler uydurma.
 *
 * Mutasyonlar (yapılıp geri alındı, raporda): `cariBaglandi` boş gövde → T-B3-1 kırmızı; `bagliDegil`'de kodsuz koşulu kaldırılır
 * (her lead adaydır) → T-B3-2 kırmızı; `byKod` atlanır → T-B3-3 kırmızı; indeks tek değer tutar (ilk lead) → T-B3-4 kırmızı;
 * lead tarafında `firmaAnahtari` yerine `toLowerCase` → T-B3-5 kırmızı; kiracı `continue`'su silinir → BH19 «yabancı kiracı»
 * kırmızı; eşik kaldırılır → BH19 «6 aday» kırmızı; ilk import muafiyeti silinir → BH19 «239 aday» kırmızı.
 */
import { describe, it, expect } from 'vitest';
import {
  cariIndeksiKur, cariHedefi, cariBaglandi, cariKuruKosu, vknAnahtari, yeniLeadKapisi, yenidenBaglamaKapisi,
  YENI_LEAD_ESIGI, CARI_LISTESI_GOVDESI,
} from './eslemeCari';
import { isimAnahtari } from '../../lib/isimAnahtari';

const VKN = '1234567890';
const cari = (kod: string, ek: Record<string, unknown> = {}) => ({ cari_kod: kod, cari_unvan1: 'ŞİRİN YAPI MALZEMELERİ', cari_vdaire_no: VKN, cari_efatura_fl: 1, cari_hareket_tipi: 0, ...ek });
const lead = (id: string, data: Record<string, unknown>) => ({ id, data: { companyId: 'A', ...data } });
const kuru = (leads: Array<{ id: string; data: Record<string, unknown> }>, cariler: Record<string, unknown>[], canli: ReadonlySet<string> | null = null) =>
  cariKuruKosu(leads, 'A', cariler, canli);

describe('T-B3-1 · aynı VKN, iki kod, lead yok → İKİ lead', () => {
  it('ikinci kod ilk kodun yeni lead\'ini alamaz (`cariBaglandi` indeksi doldurur)', () => {
    const k = kuru([], [cari('120.01.001'), cari('120.01.002')]);
    expect(k.plan.map(p => [p.kod, p.yol])).toEqual([['120.01.001', 'yeni'], ['120.01.002', 'yeni']]);
  });
  it('aynı VKN\'li TEK kodsuz lead + iki kod: ilk kod lead\'e bağlanır, ikinci kod AYNI lead\'i alamaz → yeni', () => {
    const k = kuru([lead('L-E', { taxId: VKN })], [cari('120.01.001'), cari('120.01.002')]);
    expect(k.plan).toEqual([
      { kod: '120.01.001', yol: 'vkn', leadId: 'L-E', oncekiKod: null },
      { kod: '120.01.002', yol: 'yeni', leadId: null, oncekiKod: null },
    ]);
  });
});

describe('T-B3-2 · aynı VKN, A koduyla lead var, B gelir → yeni lead; A\'nınki EZİLMEZ', () => {
  it('B için «yeni»; A kodla bulunur (plan dışı)', () => {
    const k = kuru([lead('L-A', { mikroCariKod: '120.01.001', taxId: VKN, company: 'Şirin Yapı Malzemeleri' })], [cari('120.01.001'), cari('120.01.002')]);
    expect(k.kodla).toBe(1);
    expect(k.plan).toEqual([{ kod: '120.01.002', yol: 'yeni', leadId: null, oncekiKod: null }]);
  });
});

describe('T-B3-3 · ikinci koşu 0 yeni lead (byKod)', () => {
  it('her kodun kendi lead\'i varken plan boş', () => {
    const leads = [lead('L-A', { mikroCariKod: '120.01.001', taxId: VKN }), lead('mikro-A-120.01.002', { mikroCariKod: '120.01.002', taxId: VKN })];
    const k = kuru(leads, [cari('120.01.001'), cari('120.01.002')]);
    expect([k.kodla, k.plan.length, k.yeniLead.kodlar]).toEqual([2, 0, []]);
  });
});

describe('T-B3-4 · aynı VKN\'li kodsuz elle lead + kodlu lead: kod KODSUZA bağlanır (ilk lead kodlu olsa bile)', () => {
  it('liste: [kodlu L-A, kodsuz L-E] → B → L-E (vkn)', () => {
    const leads = [lead('L-A', { mikroCariKod: '120.01.001', taxId: VKN }), lead('L-E', { taxNo: '123 456 7890', company: 'Şirin Yapı' })];
    const k = kuru(leads, [cari('120.01.001'), cari('120.01.002')]);
    expect(k.plan).toEqual([{ kod: '120.01.002', yol: 'vkn', leadId: 'L-E', oncekiKod: null }]);
  });
});

describe('T-B3-5 · Türkçe büyük / küçük harf: isim yolu kodsuz lead\'e bağlar, mükerrer açmaz', () => {
  it('«ŞİRİN YAPI MALZEMELERİ» ↔ lead «Şirin Yapı Malzemeleri» (VKN yok)', () => {
    const k = kuru([lead('L-Elle', { company: 'Şirin Yapı Malzemeleri' })], [cari('120.01.009', { cari_vdaire_no: '' })]);
    expect(k.plan).toEqual([{ kod: '120.01.009', yol: 'isim', leadId: 'L-Elle', oncekiKod: null }]);
    expect(isimAnahtari('ŞİRİN YAPI MALZEMELERİ')).toBe(isimAnahtari('Şirin Yapı Malzemeleri'));
  });
  it('lead tarafı da Türkçe kuralla: Mikro biçimli BÜYÜK harfli lead («IŞIK YAPI MARKETİ») aynı unvanlı kodsuz lead olarak bulunur', () => {
    const k = kuru([lead('L-Buyuk', { company: 'IŞIK YAPI MARKETİ' })], [cari('120.01.010', { cari_vdaire_no: '', cari_unvan1: 'Işık Yapı Marketi' })]);
    expect(k.plan).toEqual([{ kod: '120.01.010', yol: 'isim', leadId: 'L-Buyuk', oncekiKod: null }]);
  });
});

describe('BH9 · Mikro\'da artık olmayan kodu taşıyan lead yeniden bağlanır (canlı küme)', () => {
  const leads = [lead('L-A', { mikroCariKod: '120.01.Eski', taxId: VKN })];
  it('A canlı kümede yok, aynı VKN\'li B gelir → aynı lead B\'ye geçer, `oncekiKod = A`, yeni lead yok', () => {
    const k = kuru(leads, [cari('120.01.002')], new Set(['120.01.002']));
    expect(k.plan).toEqual([{ kod: '120.01.002', yol: 'vkn', leadId: 'L-A', oncekiKod: '120.01.Eski' }]);
    expect(k.yenidenBaglama).toEqual({ kodlar: ['120.01.002'], kapi: { yapilir: true, not: null } });
    expect(k.canliKumeDali).toBe(true);
  });
  it('küme okunamadı (null) ya da boş → dal KAPALI: B için yeni lead, A korunur', () => {
    expect(kuru(leads, [cari('120.01.002')], null).plan).toEqual([{ kod: '120.01.002', yol: 'yeni', leadId: null, oncekiKod: null }]);
    expect(kuru(leads, [cari('120.01.002')], new Set()).canliKumeDali).toBe(false);
  });
  it('eşik: 3\'ten fazla yeniden bağlama → hiçbiri yapılmaz + ⚠', () => {
    expect(yenidenBaglamaKapisi(['a', 'b', 'c']).yapilir).toBe(true);
    expect(yenidenBaglamaKapisi(['a', 'b', 'c', 'd'])).toEqual({ yapilir: false, not: '⚠ olağandışı: 4 lead yeniden bağlanacaktı (eşik 3) · yapılmadı · kodlar: a, b, c, d' });
  });
});

describe('BH19 · eşik, kiracı süzgeci, tek anahtar', () => {
  it('yabancı kiracının kodlu lead\'i `byKod`\'a girmez; etiketsiz eski lead girer', () => {
    const i = cariIndeksiKur([{ ref: 'yabanci', data: { companyId: 'B', mikroCariKod: 'K1' } }, { ref: 'eski', data: { mikroCariKod: 'K2' } }], 'A');
    expect([...i.byKod.keys()]).toEqual(['K2']);
    expect(cariHedefi(i, { kod: 'K1', vkn: '', nameKey: '' })).toBeNull();
  });
  it(`\`byKod\` dolu, ${YENI_LEAD_ESIGI + 1} yeni aday → açılmaz + ⚠ (kod listesiyle, unvan / VKN yok); var olan kodla eşleşmeler sürer`, () => {
    const adaylar = Array.from({ length: YENI_LEAD_ESIGI + 1 }, (_, i) => cari(`120.02.00${i}`, { cari_vdaire_no: String(9000000000 + i) }));
    const k = kuru([lead('L-A', { mikroCariKod: '120.01.001' })], [cari('120.01.001'), ...adaylar]);
    expect(k.kodla).toBe(1);
    expect(k.yeniLead.kapi.acilir).toBe(false);
    expect(k.yeniLead.kapi.not).toBe(`⚠ olağandışı: 6 yeni lead açılacaktı (eşik 5) · açılmadı · elle «Cari İçe Aktar» ile açılabilir · kodlar: ${adaylar.map(a => a.cari_kod).join(', ')}`);
    expect(k.yeniLead.kapi.not).not.toMatch(/ŞİRİN|9000000000/);
  });
  it('`byKod` boş (ilk import), 239 aday → 239 yeni lead, eşik uygulanmaz', () => {
    const adaylar = Array.from({ length: 239 }, (_, i) => cari(`120.${String(i).padStart(3, '0')}`, { cari_vdaire_no: String(8000000000 + i), cari_unvan1: `FİRMA ${i}` }));
    const k = kuru([], adaylar);
    expect([k.yeniLead.kodlar.length, k.yeniLead.kapi.acilir]).toEqual([239, true]);
    expect(yeniLeadKapisi(0, adaylar.map(a => a.cari_kod)).acilir).toBe(true);
  });
  it("gelen VKN '123 456-7890' ↔ lead `taxNo: '1234567890'` aynı lead'e bağlanır; `vknAnahtari` yalnız rakam", () => {
    const k = kuru([lead('L-E', { taxNo: '1234567890' })], [cari('120.01.003', { cari_vdaire_no: '123 456-7890' })]);
    expect(k.plan).toEqual([{ kod: '120.01.003', yol: 'vkn', leadId: 'L-E', oncekiKod: null }]);
    expect([vknAnahtari(' 12-34 '), vknAnahtari(1234), vknAnahtari(null), vknAnahtari({})]).toEqual(['1234', '1234', '', '']);
  });
  it('cariBaglandi: yeni lead VKN ve isimle indekse girer (aynı koşuda isimle ikinci bağlama yok)', () => {
    const i = cariIndeksiKur<string>([], 'A');
    cariBaglandi(i, 'yeni-1', 'K1', { vkn: VKN, nameKey: 'şirin' });
    expect(cariHedefi(i, { kod: 'K2', vkn: VKN, nameKey: 'şirin' })).toBeNull();
    expect(i.byKod.get('K1')).toBe('yeni-1');
  });
  it('kuru koşu girdisi cron ile aynı gövde (`CARI_LISTESI_GOVDESI`)', () => {
    expect(CARI_LISTESI_GOVDESI).toEqual({
      FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
      WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'", Sort: 'cari_kod',
    });
  });
});
