// @vitest-environment node
/**
 * stokKodGocu.test.ts — stok kodu göçünün SAF çekirdeği (şartname «Mikro bağlantı D» D0 + DH1 / DH3 / DH4 / DH6 / DH14 sayımı /
 * DH15 / DH16 / DH20). Örnek kodlar ölçü dosyasındaki GERÇEK biçimlerdir (ad yok); kiracılar uydurma.
 *
 * MUTASYON NOTLARI (her biri en az bir sınamayı kırmızıya çevirir — elle denendi, sonuç son raporda):
 *   • `kodAnahtari`'na `toUpperCase()` eklenir → «DH20 · ı / I» ve «yalnız harf farklı çift» kırmızı;
 *   • NFC ya da yön işareti temizliği kaldırılır → «ARGTGRİ (NFD)» ve «görünmez işaretli kod» kırmızı;
 *   • DH3 güçlü kaynak şartı kaldırılır → «yalnız zayıf kaynak» kırmızı;
 *   • DH1 tablosunda `orders` yolu `lineItems` → `items` yapılır → «DH1 · orders» kırmızı;
 *   • imzaya `stockLevel` girer → «DH16 · imza» kırmızı;
 *   • zincir döngüsünde `cok_anlamli` taşınmaz → «zincirde halka `cok_anlamli`» kırmızı;
 *   • ara halka tek geçiş / yeniden hesapsız / kod sırasız / ilk hâl geri yüklenmeden → «sabit nokta» kırmızı.
 */
import { describe, it, expect } from 'vitest';
import {
  BAGLI_KAYIT_TABLOSU, KURU_TABLO_SATIR_SINIRI, aynaKanitlari, ayniSkuGruplari, bagliKayitlariSay, gocEvreni, bicimliGuidAnahtari,
  harfIskeleti, hareketKanitlari, kodAnahtari, kuruGovdesiniCoz, planImzasi, planOzeti, siniflandir,
  type GocKarti, type KodKaniti, type MikroEskiKodSayimlari, type TabloCifti, type TabloKaynagi, type BagliKayitTanimi,
} from './stokKodGocu';
import { cronKiracisi } from '../kiraciOrtami';

// ── Düzenek ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const kart = (id: string, sku: string, ek: Partial<GocKarti> = {}): GocKarti => ({ id, sku, source: 'mikro_import', companyId: 'A', ...ek });
const cift = (eski: string, yeni: string, kaynak: TabloKaynagi): TabloCifti => ({ eski: kodAnahtari(eski), yeni: kodAnahtari(yeni), kaynak });
const hareket = (eski: string, yeni: string): KodKaniti => ({ eski, yeni, tur: 'hareket' });
const guid = (eski: string, yeni: string): KodKaniti => ({ eski, yeni, tur: 'guid' });
const SIFIR: MikroEskiKodSayimlari = { hareket: new Map(), fiyat: new Map(), barkod: new Map() };

interface Kurulum { kartlar: GocKarti[]; mikro: string[]; tablo?: TabloCifti[]; kanitlar?: KodKaniti[]; mikroEskiKodda?: MikroEskiKodSayimlari; magaza?: string[] }
function kos(k: Kurulum) {
  const evren = gocEvreni(k.kartlar, k.mikro);
  const s = siniflandir({ evren, tablo: k.tablo ?? [], kanitlar: k.kanitlar ?? [], mikroEskiKodda: k.mikroEskiKodda ?? SIFIR, magazaEskiKodlar: new Set(k.magaza ?? []) });
  const satir = (eski: string) => {
    const r = s.satirlar.find(x => x.eski === kodAnahtari(eski));
    if (!r) throw new Error(`satır yok: ${eski}`);
    return r;
  };
  return { evren, s, satir };
}

// 10.10 «1 ONAYLI» + 30.09 iki taslak: 192 ikizin çoğunun kaynak biçimi.
const UC_KAYNAK = (eski: string, yeni: string): TabloCifti[] => [cift(eski, yeni, 'onayli1010'), cift(eski, yeni, 'aktarim0930'), cift(eski, yeni, 'revize0930')];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH15 · kodAnahtari — tek anahtar: trim + NFC + görünmez işaret; harf dönüşümü YOK', () => {
  it('trim, NFC (NFD `İ` → `İ`), yön işaretleri silinir, U+00A0 düz boşluk olur', () => {
    expect(kodAnahtari('  AKCALI-AKÇ.00312 ')).toBe('AKCALI-AKÇ.00312');
    expect(kodAnahtari('ARGTGRI\u0307')).toBe('ARGTGRİ');
    expect(kodAnahtari('\u200EAKCALI-AKÇ.00313\u200F')).toBe('AKCALI-AKÇ.00313');
    expect(kodAnahtari('A\u202AB\u202BC\u202CD\u202DE\u202EF')).toBe('ABCDEF');
    expect(kodAnahtari('KLİPS\u00A0SABİTLEME PARÇASI')).toBe('KLİPS SABİTLEME PARÇASI');
    expect(kodAnahtari('\u00A0X-1\u00A0')).toBe('X-1');
    // işaret NFC'den ÖNCE silinir: `I` + U+200E + birleşik nokta → `İ`
    expect(kodAnahtari('I\u200E\u0307')).toBe('İ');
  });

  it('harf DÖNÜŞÜMÜ yok: ı / I / i / İ ve büyük / küçük ayrı anahtar', () => {
    expect(kodAnahtari('KAPı-02')).not.toBe(kodAnahtari('KAPI-02'));
    expect(kodAnahtari('DEMIR-01')).not.toBe(kodAnahtari('DEMİR-01'));
    expect(kodAnahtari('Akcali-01')).not.toBe(kodAnahtari('AKCALI-01'));
    expect(kodAnahtari('kapı-02')).toBe('kapı-02');
  });

  it('metin olmayan değer boş anahtar', () => {
    for (const v of [undefined, null, 12, {}, []]) expect(kodAnahtari(v)).toBe('');
  });

  it('harfIskeleti (yalnız uyarı): noktalı / noktasız dört harf ve büyük / küçük aynı iskelet; Ç ≠ C', () => {
    expect(harfIskeleti('DEMIR-01')).toBe(harfIskeleti('DEMİR-01'));
    expect(harfIskeleti('KAPı-02')).toBe(harfIskeleti('KAPI-02'));
    expect(harfIskeleti('akcali-01')).toBe(harfIskeleti('AKCALI-01'));
    expect(harfIskeleti('AKÇ.001')).not.toBe(harfIskeleti('AKC.001'));
  });

  it('bicimliGuidAnahtari: süslü parantez + büyük harf → küçük; GUID değilse boş', () => {
    expect(bicimliGuidAnahtari('{1B2A3C4D-0000-1111-2222-AABBCCDDEEFF}')).toBe('1b2a3c4d-0000-1111-2222-aabbccddeeff');
    expect(bicimliGuidAnahtari('rastgele-kimlik')).toBe('');
    expect(bicimliGuidAnahtari(5)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('D0 + DH3 · sınıflar', () => {
  const IKIZ = [kart('k-eski', 'AKCALI-AKÇ.00312'), kart('k-yeni', 'AKCALI-00312', { source: 'mikro_cron' })];

  it('192 ikiz biçimi: güçlü tablo + hareket kanıtı + Mikro\'da eski yok / yeni var → `kesin`', () => {
    const { s, satir } = kos({ kartlar: IKIZ, mikro: ['AKCALI-00312'], tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312'), kanitlar: [hareket('AKCALI-AKÇ.00312', 'AKCALI-00312')] });
    const r = satir('AKCALI-AKÇ.00312');
    expect([r.sinif, r.yeni, r.gerekce]).toEqual(['kesin', 'AKCALI-00312', []]);
    expect(r.kanit).toEqual(['hareket', 'tablo', 'tablo_aday']);
    expect(r.kaynaklar).toEqual(['aktarim0930', 'onayli1010', 'revize0930']);
    expect(r.kartlar).toEqual(['k-eski']);
    expect(s.sayilar).toEqual({ kesin: 1, dogrula: 0, cok_anlamli: 0, karsiliksiz: 0, degismemis: 0 });
    expect(s.degismezTamam).toBe(true);
  });

  it('aynı ikiz, tablodan bağımsız kanıt YOK → `dogrula` (`yalniz_tablo`); Cetpa\'da yeni kart bulunması kanıt sayılmaz', () => {
    const { satir } = kos({ kartlar: IKIZ, mikro: ['AKCALI-00312'], tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312') });
    expect([satir('AKCALI-AKÇ.00312').sinif, satir('AKCALI-AKÇ.00312').gerekce]).toEqual(['dogrula', ['yalniz_tablo']]);
    expect(satir('AKCALI-AKÇ.00312').adaylar).toEqual([{ yeni: 'AKCALI-00312', kaynaklar: ['aktarim0930', 'onayli1010', 'revize0930'], kanit: ['tablo', 'tablo_aday'], mikroda: true, cetpaKart: 1 }]);
  });

  it('DH3 · yalnız zayıf kaynak (bekleyen1010 + revize0930), hareket kanıtı olsa da → `dogrula` (`zayif_kaynak`)', () => {
    const { satir } = kos({
      kartlar: IKIZ, mikro: ['AKCALI-00312'],
      tablo: [cift('AKCALI-AKÇ.00312', 'AKCALI-00312', 'bekleyen1010'), cift('AKCALI-AKÇ.00312', 'AKCALI-00312', 'revize0930')],
      kanitlar: [hareket('AKCALI-AKÇ.00312', 'AKCALI-00312')],
    });
    expect([satir('AKCALI-AKÇ.00312').sinif, satir('AKCALI-AKÇ.00312').gerekce, satir('AKCALI-AKÇ.00312').yeni]).toEqual(['dogrula', ['zayif_kaynak'], 'AKCALI-00312']);
  });

  it('DH3 · üç güçlü kaynağın her biri tek başına yeter (birlestirilen1010, yenikod1017)', () => {
    for (const k of ['birlestirilen1010', 'yenikod1017'] as const) {
      const { satir } = kos({ kartlar: IKIZ, mikro: ['AKCALI-00312'], tablo: [cift('AKCALI-AKÇ.00312', 'AKCALI-00312', k)], kanitlar: [guid('AKCALI-AKÇ.00312', 'AKCALI-00312')] });
      expect(satir('AKCALI-AKÇ.00312').sinif, k).toBe('kesin');
    }
  });

  it('tablo yok, yalnız GUID kanıtı → `dogrula` (`yalniz_guid`) — tablosuz koşu `kesin` üretmez', () => {
    const { satir } = kos({ kartlar: IKIZ, mikro: ['AKCALI-00312'], kanitlar: [guid('AKCALI-AKÇ.00312', 'AKCALI-00312')] });
    expect([satir('AKCALI-AKÇ.00312').sinif, satir('AKCALI-AKÇ.00312').gerekce, satir('AKCALI-AKÇ.00312').kanit]).toEqual(['dogrula', ['yalniz_guid'], ['guid']]);
  });

  it('tablo ile GUID çelişkisi (iki aday da Mikro\'da) → `dogrula` (`kanit_celiskisi`), hedef seçilmez', () => {
    const { satir } = kos({
      kartlar: [...IKIZ, kart('k-baska', 'AKCALI-09999')], mikro: ['AKCALI-00312', 'AKCALI-09999'],
      tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312'), kanitlar: [guid('AKCALI-AKÇ.00312', 'AKCALI-09999')],
    });
    const r = satir('AKCALI-AKÇ.00312');
    expect([r.sinif, r.yeni, r.gerekce]).toEqual(['dogrula', null, ['kanit_celiskisi']]);
    expect(r.adaylar.map(a => [a.yeni, a.mikroda, a.kanit])).toEqual([['AKCALI-00312', true, ['tablo', 'tablo_aday']], ['AKCALI-09999', true, ['guid']]]);
  });

  it('karşılıksız: tablo ve kanıt yok (`tablo_ve_kanit_yok`); tablodaki yeni kod Mikro\'da yok (`aday_mikroda_yok`)', () => {
    const { s, satir } = kos({
      kartlar: [kart('k1', 'RENKLENDİRME15LT'), kart('k2', 'AKCALI-AKÇ.00301')], mikro: ['BASKA-1'],
      tablo: UC_KAYNAK('AKCALI-AKÇ.00301', 'AKCALI-00301'),
    });
    expect([satir('RENKLENDİRME15LT').sinif, satir('RENKLENDİRME15LT').gerekce]).toEqual(['karsiliksiz', ['tablo_ve_kanit_yok']]);
    expect([satir('AKCALI-AKÇ.00301').sinif, satir('AKCALI-AKÇ.00301').gerekce]).toEqual(['karsiliksiz', ['aday_mikroda_yok']]);
    expect(satir('AKCALI-AKÇ.00301').adaylar[0]).toMatchObject({ yeni: 'AKCALI-00301', mikroda: false, cetpaKart: 0 });
    expect(s.sayilar.karsiliksiz).toBe(2);
  });

  it('değişmemiş: tablodaki eski kod Mikro\'da HÂLÂ var → evrene girmez, `degismemis` sayılır', () => {
    const { s, evren } = kos({ kartlar: [kart('k1', 'ARAG0003')], mikro: ['ARAG0003'], tablo: [cift('ARAG0003', 'ARAGONIT-GK-25', 'yenikod1017')] });
    expect(evren.olcu.kod).toBe(0);
    expect(s.satirlar).toEqual([]);
    expect(s.degismemis).toEqual([{ eski: 'ARAG0003', yeniler: ['ARAGONIT-GK-25'] }]);
    expect(s.sayilar.degismemis).toBe(1);
    expect(s.tablo).toMatchObject({ satir: 1, tekilEski: 1, evrendeEslesen: 0, degismemis: 1, kartsizEski: 0 });
  });

  it('`ARGTGRİ` (17.10 «Yeni stok kodları»; kart sku\'su NFD `İ`) + GUID kanıtı → `kesin`', () => {
    const { satir } = kos({
      kartlar: [kart('k-arg', 'ARGTGRI\u0307'), kart('k-yeni', 'ARAGONIT-SDD-GRI-20')], mikro: ['ARAGONIT-SDD-GRI-20'],
      tablo: [cift('ARGTGRİ', 'ARAGONIT-SDD-GRI-20', 'yenikod1017')], kanitlar: [guid('ARGTGRİ', 'ARAGONIT-SDD-GRI-20')],
    });
    expect([satir('ARGTGRİ').sinif, satir('ARGTGRİ').yeni, satir('ARGTGRİ').kartlar]).toEqual(['kesin', 'ARAGONIT-SDD-GRI-20', ['k-arg']]);
  });

  it('görünmez işaretli kod (kart sku\'sunda U+200E) tablo satırıyla eşleşir', () => {
    const { satir } = kos({
      kartlar: [kart('k1', 'AKCALI-AKÇ.00313\u200E'), kart('k2', 'AKCALI-00313')], mikro: ['AKCALI-00313'],
      tablo: UC_KAYNAK('AKCALI-AKÇ.00313', 'AKCALI-00313'), kanitlar: [hareket('AKCALI-AKÇ.00313', 'AKCALI-00313')],
    });
    expect(satir('AKCALI-AKÇ.00313').sinif).toBe('kesin');
  });

  it('DH2 · Mikro\'da eski kodla duran hareket / fiyat / barkod → `dogrula`; sayım ölçülemediyse `kesin` olamaz', () => {
    const temel = { kartlar: IKIZ, mikro: ['AKCALI-00312'], tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312'), kanitlar: [hareket('AKCALI-AKÇ.00312', 'AKCALI-00312')] };
    const say = (m: Partial<MikroEskiKodSayimlari>) => kos({ ...temel, mikroEskiKodda: { ...SIFIR, ...m } }).satir('AKCALI-AKÇ.00312');
    expect(say({ hareket: new Map([['AKCALI-AKÇ.00312', 3]]) }).gerekce).toEqual(['mikro_hareket_eski_kodda']);
    expect(say({ fiyat: new Map([['AKCALI-AKÇ.00312', 1]]) }).gerekce).toEqual(['mikro_fiyat_listesi_eski_kodda']);
    expect(say({ barkod: new Map([['AKCALI-AKÇ.00312', 1]]) }).gerekce).toEqual(['mikro_barkod_eski_kodda']);
    const olcusuz = say({ hareket: null });
    expect([olcusuz.sinif, olcusuz.gerekce, olcusuz.mikroEskiKodda]).toEqual(['dogrula', ['mikro_olcum_yok_hareket'], { hareket: null, fiyat: 0, barkod: 0 }]);
    // Başka koddaki sayım bu çifti etkilemez.
    expect(say({ hareket: new Map([['BASKA', 9]]) }).sinif).toBe('kesin');
  });

  it('DH14 · mağaza talebinde eski kod geçiyorsa → `dogrula` (`magaza_talebi_eski_kodda`)', () => {
    const { satir } = kos({ kartlar: IKIZ, mikro: ['AKCALI-00312'], tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312'), kanitlar: [hareket('AKCALI-AKÇ.00312', 'AKCALI-00312')], magaza: ['AKCALI-AKÇ.00312'] });
    expect(satir('AKCALI-AKÇ.00312').gerekce).toEqual(['magaza_talebi_eski_kodda']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH4 · çelişkili kaynak ve ara kart (ölçülmüş iki senaryo; uydurma zincir YOK)', () => {
  const tablo = [
    cift('MA-HY-003', 'APEL-HY-003', 'onayli1010'),
    cift('MA-HY-003', 'MITREAPEL-HY-003', 'aktarim0930'), cift('MA-HY-003', 'MITREAPEL-HY-003', 'revize0930'),
  ];
  const kartlar = [kart('k-ma', 'MA-HY-003'), kart('k-mitre', 'MITREAPEL-HY-003'), kart('k-apel', 'APEL-HY-003')];

  it('(a) iki aday da Mikro\'da → `cok_anlamli`, hedef yok, birleşme yok', () => {
    const { s, satir, evren } = kos({ kartlar, mikro: ['APEL-HY-003', 'MITREAPEL-HY-003'], tablo });
    expect([satir('MA-HY-003').sinif, satir('MA-HY-003').yeni, satir('MA-HY-003').gerekce]).toEqual(['cok_anlamli', null, ['birden_cok_tablo_adayi_mikroda']]);
    expect(satir('MA-HY-003').adaylar.map(a => [a.yeni, a.mikroda])).toEqual([['APEL-HY-003', true], ['MITREAPEL-HY-003', true]]);
    expect([...evren.eskiKodlar.keys()]).toEqual(['MA-HY-003']);           // Mikro'daki ara kod evrene girmez
    expect(planOzeti(s, evren, []).satirlar).toEqual([]);
  });

  it('(b) `MITREAPEL-HY-003` Mikro\'da yok → ikisi de `dogrula`; onaylanırsa iki eski kart `APEL-HY-003`\'e katlanır', () => {
    const { s, satir, evren } = kos({ kartlar, mikro: ['APEL-HY-003'], tablo });
    const ma = satir('MA-HY-003');
    expect([ma.sinif, ma.yeni, ma.araKartlar]).toEqual(['dogrula', 'APEL-HY-003', ['MITREAPEL-HY-003']]);
    expect(ma.gerekce).toEqual(['yalniz_tablo', 'kaynaklar_celisiyor']);
    expect(ma.adaylar.map(a => [a.yeni, a.mikroda, a.cetpaKart])).toEqual([['APEL-HY-003', true, 1], ['MITREAPEL-HY-003', false, 1]]);
    const ara = satir('MITREAPEL-HY-003');
    expect([ara.sinif, ara.yeni, ara.gerekce, ara.zincir, ara.kanit]).toEqual(['dogrula', 'APEL-HY-003', ['ara_halka'], ['MA-HY-003'], ['zincir']]);
    const p = planOzeti(s, evren, []);
    expect(p.satirlar.map(x => [x.eski, x.yeni, x.kalanKart, x.arsiveGiden])).toEqual([
      ['MA-HY-003', 'APEL-HY-003', 'k-apel', ['k-ma']], ['MITREAPEL-HY-003', 'APEL-HY-003', 'k-apel', ['k-mitre']]]);
    expect(p.ortakHedef).toEqual([{ yeni: 'APEL-HY-003', eskiler: ['MA-HY-003', 'MITREAPEL-HY-003'] }]);
    expect(p.kesin.cift).toBe(0);                                          // kendiliğinden birleşme YOK
    expect(s.degismezTamam).toBe(true);
  });

  it('D0 zincir (eski → ara → yeni; ölçüde 0): ara kodun kendi satırı çözülüyorsa eski kod EN SON halkaya bağlanır, yalnız `dogrula`', () => {
    const { satir, s, evren } = kos({
      kartlar: [kart('k-x', 'ZNC-ESKI'), kart('k-z', 'ZNC-ARA'), kart('k-y', 'ZNC-YENI')], mikro: ['ZNC-YENI'],
      tablo: [cift('ZNC-ESKI', 'ZNC-ARA', 'onayli1010'), cift('ZNC-ARA', 'ZNC-YENI', 'onayli1010')], kanitlar: [hareket('ZNC-ARA', 'ZNC-YENI')],
    });
    expect([satir('ZNC-ARA').sinif, satir('ZNC-ARA').yeni]).toEqual(['kesin', 'ZNC-YENI']);
    const x = satir('ZNC-ESKI');
    expect([x.sinif, x.yeni, x.gerekce, x.zincir, x.kanit]).toEqual(['dogrula', 'ZNC-YENI', ['zincir'], ['ZNC-ARA'], ['zincir']]);
    expect(planOzeti(s, evren, []).ortakHedef).toEqual([{ yeni: 'ZNC-YENI', eskiler: ['ZNC-ARA', 'ZNC-ESKI'] }]);
  });

  it('ebeveyni de karşılıksız olan ara kod karşılıksız KALIR (hedefsiz «ara halka» doğmaz)', () => {
    const { satir } = kos({ kartlar: [kart('k-x', 'ZNC-ESKI'), kart('k-z', 'ZNC-ARA')], mikro: ['BASKA'], tablo: [cift('ZNC-ESKI', 'ZNC-ARA', 'onayli1010')] });
    expect([satir('ZNC-ARA').sinif, satir('ZNC-ARA').gerekce, satir('ZNC-ARA').zincir]).toEqual(['karsiliksiz', ['tablo_ve_kanit_yok'], []]);
    expect([satir('ZNC-ESKI').sinif, satir('ZNC-ESKI').gerekce]).toEqual(['karsiliksiz', ['aday_mikroda_yok']]);
  });

  it('ebeveyn `cok_anlamli` ise ara halka da `cok_anlamli`', () => {
    const { satir } = kos({
      kartlar: [...kartlar, kart('k-yeni2', 'APEL-HY-003B')], mikro: ['APEL-HY-003', 'APEL-HY-003B'],
      tablo: [...tablo, cift('MA-HY-003', 'APEL-HY-003B', 'onayli1010')],
    });
    expect(satir('MA-HY-003').sinif).toBe('cok_anlamli');
    expect([satir('MITREAPEL-HY-003').sinif, satir('MITREAPEL-HY-003').gerekce]).toEqual(['cok_anlamli', ['ara_halka']]);
  });

  it('zincirde halka `cok_anlamli` ise eski kod da `cok_anlamli` (ara halkayla simetrik); belirsiz kod pasif listeye DÜŞMEZ', () => {
    const { satir, s, evren } = kos({
      kartlar: [kart('k-a', 'ZNC-ESKI'), kart('k-b', 'ZNC-ARA')], mikro: ['ZNC-YENI-1', 'ZNC-YENI-2'],
      tablo: [cift('ZNC-ESKI', 'ZNC-ARA', 'onayli1010'), cift('ZNC-ARA', 'ZNC-YENI-1', 'onayli1010'), cift('ZNC-ARA', 'ZNC-YENI-2', 'onayli1010')],
    });
    expect(satir('ZNC-ARA').sinif).toBe('cok_anlamli');
    const x = satir('ZNC-ESKI');
    expect([x.sinif, x.yeni, x.gerekce, x.zincir]).toEqual(['cok_anlamli', null, ['zincir'], ['ZNC-ARA']]);
    expect(planOzeti(s, evren, []).pasif).toEqual({ kod: 0, kart: 0 });
    expect(s.degismezTamam).toBe(true);
  });

  it('sabit nokta: aynı veri FARKLI kart okuma sırasında aynı sınıf, aynı hedef ve aynı `planImza` (zincir, çok ebeveyn, döngü)', () => {
    const sonuc = (kodlar: string[], mikro: string[], tablo: TabloCifti[]) => {
      const kartlar = kodlar.map(k => kart(`k-${k}`, k));
      const { s, evren } = kos({ kartlar, mikro, tablo });
      return {
        sayilar: s.sayilar, imza: planImzasi('A', s, evren, []),
        satirlar: s.satirlar.map(r => [r.eski, r.sinif, r.yeni, r.gerekce, r.zincir, r.kanit, r.adaylar.map(a => a.yeni)]),
      };
    };
    // (1) ara halkanın ara halkası: SN-Q ebeveyni SN-X'ten, SN-P ebeveyni SN-Q'dan çözülür. Kod sırası bağımlılığın TERSİ (P < Q):
    // tek geçiş P'yi karşılıksız bırakırdı; hangi okuma sırası olursa olsun sonuç aynı.
    const zincir = [cift('SN-X', 'SN-C', 'onayli1010'), cift('SN-X', 'SN-Q', 'bekleyen1010'), cift('SN-Q', 'SN-P', 'revize0930')];
    const z = [['SN-X', 'SN-Q', 'SN-P'], ['SN-Q', 'SN-X', 'SN-P'], ['SN-P', 'SN-Q', 'SN-X']].map(k => sonuc(k, ['SN-C'], zincir));
    expect(z[0].satirlar).toEqual([
      ['SN-P', 'dogrula', 'SN-C', ['ara_halka'], ['SN-Q'], ['zincir'], ['SN-C']],
      ['SN-Q', 'dogrula', 'SN-C', ['ara_halka'], ['SN-X'], ['zincir'], ['SN-P', 'SN-C']],
      ['SN-X', 'dogrula', 'SN-C', ['yalniz_tablo', 'kaynaklar_celisiyor'], [], ['tablo'], ['SN-C', 'SN-Q']]]);
    expect(z[1]).toEqual(z[0]);
    expect(z[2]).toEqual(z[0]);
    // (2) çok ebeveynli halka SN-H: SN-E1 hemen (→ SN-C), SN-T ara halka olarak bir tur sonra (→ SN-D) çözülür → çelişki, hedef YOK.
    // H < T: önce çözülen ebeveyne bağlanıp kalmak (yeniden hesapsız sabit nokta) çelişkiyi kaybederdi. İlk turun izi kalmaz.
    const cok = [cift('SN-E1', 'SN-C', 'onayli1010'), cift('SN-E1', 'SN-H', 'bekleyen1010'), cift('SN-P', 'SN-D', 'onayli1010'),
      cift('SN-P', 'SN-T', 'bekleyen1010'), cift('SN-T', 'SN-H', 'bekleyen1010')];
    const c = [['SN-E1', 'SN-P', 'SN-T', 'SN-H'], ['SN-P', 'SN-E1', 'SN-T', 'SN-H'], ['SN-H', 'SN-T', 'SN-P', 'SN-E1']].map(k => sonuc(k, ['SN-C', 'SN-D'], cok));
    expect(c[0].satirlar.find(r => r[0] === 'SN-H')).toEqual(['SN-H', 'dogrula', null, ['ara_halka', 'kanit_celiskisi'], ['SN-E1', 'SN-T'], [], []]);
    expect(c[0].satirlar.find(r => r[0] === 'SN-T')).toEqual(['SN-T', 'dogrula', 'SN-D', ['ara_halka'], ['SN-P'], ['zincir'], ['SN-H', 'SN-D']]);
    expect(c[1]).toEqual(c[0]);
    expect(c[2]).toEqual(c[0]);
    // (3) döngülü tablo (SN-A → SN-B, SN-B → SN-A): sonuç okuma sırasından bağımsız.
    const dongu = [cift('SN-E1', 'SN-C', 'onayli1010'), cift('SN-E1', 'SN-A', 'bekleyen1010'), cift('SN-E2', 'SN-D', 'onayli1010'),
      cift('SN-E2', 'SN-B', 'bekleyen1010'), cift('SN-A', 'SN-B', 'bekleyen1010'), cift('SN-B', 'SN-A', 'bekleyen1010')];
    const d = [['SN-E1', 'SN-E2', 'SN-A', 'SN-B'], ['SN-E2', 'SN-E1', 'SN-B', 'SN-A']].map(k => sonuc(k, ['SN-C', 'SN-D'], dongu));
    expect(d[1]).toEqual(d[0]);
    for (const x of [...z, ...c, ...d]) expect(x.sayilar.karsiliksiz).toBe(0);
  });
});

describe('ortak hedef: `5555` + `AKCALI-AKÇ.07016` → `AKCALI-07016` (çelişkili kaynak satırı en çok `dogrula`)', () => {
  it('5555 iki kaynakta farklı yeni kod (biri Mikro\'da yok) → `dogrula`; AKÇ.07016 `kesin`; plan tek hedefte iki eski kod', () => {
    const { s, satir, evren } = kos({
      kartlar: [kart('k-5555', '5555'), kart('k-akc', 'AKCALI-AKÇ.07016'), kart('k-07016', 'AKCALI-07016', { source: 'mikro_cron' })],
      mikro: ['AKCALI-07016'],
      tablo: [cift('5555', 'AKCALI-07016', 'onayli1010'), cift('5555', 'AKCALI-5555', 'revize0930'), ...UC_KAYNAK('AKCALI-AKÇ.07016', 'AKCALI-07016')],
      kanitlar: [hareket('5555', 'AKCALI-07016'), hareket('AKCALI-AKÇ.07016', 'AKCALI-07016')],
    });
    expect([satir('5555').sinif, satir('5555').yeni, satir('5555').gerekce]).toEqual(['dogrula', 'AKCALI-07016', ['kaynaklar_celisiyor']]);
    expect(satir('5555').adaylar.map(a => [a.yeni, a.mikroda])).toEqual([['AKCALI-07016', true], ['AKCALI-5555', false]]);
    expect(satir('AKCALI-AKÇ.07016').sinif).toBe('kesin');
    const p = planOzeti(s, evren, []);
    expect(p.ortakHedef).toEqual([{ yeni: 'AKCALI-07016', eskiler: ['5555', 'AKCALI-AKÇ.07016'] }]);
    expect([p.kesin.cift, p.dogrula.cift, p.kesin.arsiveGidenKart, p.dogrula.arsiveGidenKart]).toEqual([1, 1, 1, 1]);
  });

  it('ölçülmüş üçlü ortak hedef: `MA-HY-004` + `MITREAPEL-FLXT100` + `APEL-8697464784496` → `APEL-FLXT100` (çelişkili kaynak `dogrula`)', () => {
    const { s, satir, evren } = kos({
      kartlar: [kart('k-ma4', 'MA-HY-004'), kart('k-mf', 'MITREAPEL-FLXT100'), kart('k-apel8', 'APEL-8697464784496'), kart('k-flx', 'APEL-FLXT100', { source: 'mikro_cron' })],
      mikro: ['APEL-FLXT100'],
      tablo: [
        cift('MA-HY-004', 'APEL-FLXT100', 'onayli1010'), cift('MA-HY-004', 'MITREAPEL-HY-004', 'aktarim0930'), cift('MA-HY-004', 'MITREAPEL-HY-004', 'revize0930'),
        cift('MITREAPEL-FLXT100', 'APEL-FLXT100', 'onayli1010'), cift('APEL-8697464784496', 'APEL-FLXT100', 'birlestirilen1010'),
      ],
      kanitlar: [hareket('MA-HY-004', 'APEL-FLXT100'), hareket('MITREAPEL-FLXT100', 'APEL-FLXT100'), guid('APEL-8697464784496', 'APEL-FLXT100')],
    });
    expect([satir('MA-HY-004').sinif, satir('MA-HY-004').yeni, satir('MA-HY-004').gerekce]).toEqual(['dogrula', 'APEL-FLXT100', ['kaynaklar_celisiyor']]);
    expect([satir('MITREAPEL-FLXT100').sinif, satir('APEL-8697464784496').sinif]).toEqual(['kesin', 'kesin']);
    const p = planOzeti(s, evren, []);
    expect(p.ortakHedef).toEqual([{ yeni: 'APEL-FLXT100', eskiler: ['APEL-8697464784496', 'MA-HY-004', 'MITREAPEL-FLXT100'] }]);
    expect(new Set(p.satirlar.map(x => x.kalanKart))).toEqual(new Set(['k-flx']));
    expect(s.degismezTamam).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH20 · harf farkı: yalnız UYARI, birleşme yok', () => {
  it('`DEMIR-01` ~ `DEMİR-01`, `KAPı-02` ~ `KAPI-02`, `Akcali-01` ~ `AKCALI-01`: evrende ayrı kod, karşılıksız, uyarı var', () => {
    const { s, satir, evren } = kos({
      kartlar: [kart('d1', 'DEMIR-01'), kart('d2', 'DEMİR-01'), kart('p1', 'KAPı-02'), kart('p2', 'KAPI-02'), kart('a1', 'Akcali-01'), kart('a2', 'AKCALI-01')],
      mikro: ['DEMİR-01', 'KAPI-02', 'AKCALI-01'],
    });
    expect([...evren.eskiKodlar.keys()].sort()).toEqual(['Akcali-01', 'DEMIR-01', 'KAPı-02']);
    for (const k of ['DEMIR-01', 'KAPı-02', 'Akcali-01']) expect([satir(k).sinif, satir(k).yeni], k).toEqual(['karsiliksiz', null]);
    expect(s.harfFarki).toEqual(expect.arrayContaining([
      { kod: 'DEMIR-01', benzer: 'DEMİR-01', nerede: 'mikro' },
      { kod: 'KAPı-02', benzer: 'KAPI-02', nerede: 'mikro' },
      { kod: 'Akcali-01', benzer: 'AKCALI-01', nerede: 'mikro' },
    ]));
    expect(s.harfFarki).toHaveLength(3);
    expect(planOzeti(s, evren, []).satirlar).toEqual([]);
  });

  it('tablo hedefi harf farkıyla Mikro\'da (birebir yok) → uyarı + karşılıksız; eski kod harf farklı tek aday Mikro\'daysa `harf_farki`', () => {
    const a = kos({ kartlar: [kart('k1', 'ESKI-1')], mikro: ['YENİ-1'], tablo: [cift('ESKI-1', 'YENI-1', 'onayli1010')] });
    expect(a.satir('ESKI-1').sinif).toBe('karsiliksiz');
    expect(a.s.harfFarki).toEqual([{ kod: 'YENI-1', benzer: 'YENİ-1', nerede: 'tablo_yeni' }]);
    const b = kos({ kartlar: [kart('k1', 'KAPı-03')], mikro: ['KAPI-03', 'KAPI-YENI'], tablo: [cift('KAPı-03', 'KAPI-YENI', 'onayli1010')], kanitlar: [guid('KAPı-03', 'KAPI-YENI')] });
    expect([b.satir('KAPı-03').sinif, b.satir('KAPı-03').gerekce]).toEqual(['dogrula', ['harf_farki']]);
  });

  it('tablonun eski kodu kartla yalnız harf farkıyla eşleşiyor → satıra BAĞLANMAZ, `tablo_eski` uyarısı', () => {
    const { s, satir } = kos({ kartlar: [kart('k1', 'KAPı-04')], mikro: ['YENI-4'], tablo: [cift('KAPI-04', 'YENI-4', 'onayli1010')] });
    expect(satir('KAPı-04').sinif).toBe('karsiliksiz');
    expect(s.harfFarki).toEqual([{ kod: 'KAPI-04', benzer: 'KAPı-04', nerede: 'tablo_eski' }]);
    expect(s.tablo.kartsizEski).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH6 · eski kod evreni ve toplam değişmezi', () => {
  it('evren: Mikro kaynaklı (`mikro_import` / `mikro_cron`) + kodu Mikro\'da olmayan; elle açılmış ayrı sayılır; etiketsiz dâhil', () => {
    const { evren, s } = kos({
      kartlar: [
        kart('k1', 'ESKI-1'), kart('k2', 'ESKI-2', { source: 'mikro_cron' }), kart('k3', 'ESKI-3', { companyId: '' }), kart('k4', 'ESKI-4', { companyId: null }),
        kart('k5', 'ELLE-1', { source: 'manual' }), kart('k6', 'ELLE-2', { source: undefined }), kart('k7', '   '), kart('k8', 'MIKRODA'),
      ],
      mikro: ['MIKRODA'],
    });
    expect(evren.olcu).toEqual({ kart: 4, kod: 4, etiketsizKart: 2, mikroDisiKaynak: 2, skusuz: 1, toplamKart: 8 });
    expect(s.sayilar.karsiliksiz).toBe(4);
    expect(s.satirlar.find(r => r.eski === 'ESKI-3')?.etiketsizKart).toBe(1);
    expect(s.degismezTamam).toBe(true);
  });

  it('aynı koddaki iki eski kart TEK satır (kod başına); kart listesi ikisini taşır', () => {
    const { s } = kos({ kartlar: [kart('k1', 'ESKI-1'), kart('k2', ' ESKI-1')], mikro: ['X'] });
    expect(s.satirlar.map(r => [r.eski, r.kartlar])).toEqual([['ESKI-1', ['k1', 'k2']]]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kuru koşu gövdesi (D1 / DH3: `[{ eski, yeni, kaynak }]`, ≤ 2.000 satır, kod ≤ 50, yalnız metin)', () => {
  it('geçerli gövde anahtar biçiminde döner; tekrar ve eskisi = yenisi satırı yok sayılır', () => {
    const r = kuruGovdesiniCoz({ ciftler: [
      { eski: ' AKCALI-AKÇ.00312\u200E', yeni: 'AKCALI-00312', kaynak: 'onayli1010' },
      { eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak: 'onayli1010' },
      { eski: 'X', yeni: 'X\u00A0', kaynak: 'revize0930' },
    ] });
    expect(r).toEqual({ tamam: true, ciftler: [{ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak: 'onayli1010' }], yokSayilan: { ayniKod: 1, tekrar: 1 } });
  });

  it('gövdesiz / `ciftler`siz istek tablosuz koşudur', () => {
    expect(kuruGovdesiniCoz(undefined)).toMatchObject({ tamam: true, ciftler: [] });
    expect(kuruGovdesiniCoz({})).toMatchObject({ tamam: true, ciftler: [] });
  });

  it('tablo dosyası OLDUĞU GİBİ (çıplak dizi, şartname D1 / DH16 biçimi) `{ ciftler }` ile aynı sonucu verir', () => {
    const satirlar = [{ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak: 'onayli1010' }, { eski: 'X', yeni: 'X', kaynak: 'revize0930' }];
    expect(kuruGovdesiniCoz(satirlar)).toEqual(kuruGovdesiniCoz({ ciftler: satirlar }));
    expect(kuruGovdesiniCoz(satirlar)).toMatchObject({ tamam: true, ciftler: [{ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', kaynak: 'onayli1010' }] });
    expect(kuruGovdesiniCoz([])).toEqual({ tamam: true, ciftler: [], yokSayilan: { ayniKod: 0, tekrar: 0 } });
    const sinir = kuruGovdesiniCoz(Array.from({ length: KURU_TABLO_SATIR_SINIRI + 1 }, () => ({ eski: 'a', yeni: 'b', kaynak: 'onayli1010' })));
    expect(sinir.tamam).toBe(false);
  });

  it('reddedilenler (400): metin / sayı gövde, bilinmeyen alan, dizi olmayan `ciftler`, sınır, metin olmayan, boş, uzun, denetim karakteri, kaynak', () => {
    const red = (g: unknown): string => { const r = kuruGovdesiniCoz(g); if (r.tamam) throw new Error('kabul edildi'); return r.error; };
    expect(red('x')).toMatch(/dizi ya da nesne/);
    expect(red(5)).toMatch(/dizi ya da nesne/);
    expect(red({ cifler: [] })).toMatch(/Tanınmayan alan: cifler/);
    expect(red({ ciftler: {} })).toMatch(/dizi/);
    expect(red({ ciftler: Array.from({ length: KURU_TABLO_SATIR_SINIRI + 1 }, () => ({ eski: 'a', yeni: 'b', kaynak: 'onayli1010' })) })).toMatch(/2000/);
    expect(red({ ciftler: [{ eski: 5, yeni: 'b', kaynak: 'onayli1010' }] })).toMatch(/1\. satır: `eski` metin/);
    expect(red({ ciftler: [{ eski: 'a', yeni: '  ', kaynak: 'onayli1010' }] })).toMatch(/`yeni` boş/);
    expect(red({ ciftler: [{ eski: 'a'.repeat(51), yeni: 'b', kaynak: 'onayli1010' }] })).toMatch(/50/);
    expect(red({ ciftler: [{ eski: 'a\u0001', yeni: 'b', kaynak: 'onayli1010' }] })).toMatch(/denetim/);
    expect(red({ ciftler: [{ eski: 'a', yeni: 'b', kaynak: 'uydurma' }] })).toMatch(/kaynak/);
    expect(red({ ciftler: [{ eski: 'a', yeni: 'b', kaynak: 'onayli1010', ad: 'Ürün' }] })).toMatch(/tanınmayan alan: ad/);
    expect(red({ ciftler: ['a'] })).toMatch(/1\. satır bir nesne/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('B2 · ayna ve hareket GUID kanıtı', () => {
  const G1 = '{AAAAAAAA-0000-1111-2222-333333333333}', G2 = 'bbbbbbbb-0000-1111-2222-333333333333';
  it('ayna: eski kodun GUID\'i Mikro\'da yeni kodla → kanıt; Mikro GUID haritası yoksa aynadaki aynı GUID\'li gruptan', () => {
    const mikroKumesi = new Set(['YENI-1', 'YENI-2']);
    const harita = new Map([[bicimliGuidAnahtari(G1), 'YENI-1']]);
    const a = aynaKanitlari([{ kod: 'ESKI-1', guid: G1 }, { kod: 'YENI-1', guid: G1 }, { kod: 'ESKI-2', guid: G2 }, { kod: 'X', guid: 'bozuk' }], harita, mikroKumesi);
    expect(a.kanitlar).toEqual([{ eski: 'ESKI-1', yeni: 'YENI-1', tur: 'guid' }]);
    expect(a.olcu).toEqual({ guidliSatir: 3, ayniGuidGrubu: 1, ayniGuidCifti: 1 });
    const b = aynaKanitlari([{ kod: 'ESKI-2', guid: G2 }, { kod: 'YENI-2', guid: G2 }], null, mikroKumesi);
    expect(b.kanitlar).toEqual([{ eski: 'ESKI-2', yeni: 'YENI-2', tur: 'guid' }]);
  });

  it('hareket: aynı GUID Mikro\'da başka kodla → kanıt (yalnız eski Mikro\'da yok + yeni Mikro\'da var); aynı kod → kanıt yok; GUID Mikro\'da yok → yetim; GUID olmayan kimlik sayılmaz', () => {
    const mikro = new Map([[bicimliGuidAnahtari(G1), 'YENI-1'], [G2, 'AYNI-1']]);
    const G4 = 'dddddddd-0000-1111-2222-333333333333', G5 = 'eeeeeeee-0000-1111-2222-333333333333';
    mikro.set(G4, 'MIKRODA-OLMAYAN-KOD');                // Mikro hareketi güncel STOKLAR'da olmayan koda dönmüş → kanıt DEĞİL
    mikro.set(G5, 'YENI-1');                             // Cetpa'daki kod Mikro'da HÂLÂ var (evrende değil) → kanıt DEĞİL
    const h = hareketKanitlari([
      { id: G1, kod: 'ESKI-1' }, { id: G2, kod: 'AYNI-1' }, { id: 'cccccccc-0000-1111-2222-333333333333', kod: 'ESKI-1' }, { id: 'elle-123', kod: 'ESKI-1' },
      { id: G4, kod: 'ESKI-3' }, { id: G5, kod: 'AYNI-1' },
    ], mikro, new Set(['YENI-1', 'AYNI-1']));
    expect(h.kanitlar).toEqual([{ eski: 'ESKI-1', yeni: 'YENI-1', tur: 'hareket' }]);
    expect(h.olcu).toEqual({ guidli: 5, mikrodaBulunan: 4, koduDegisen: 3, yetim: 1 });
    expect(h.yetimler).toEqual([{ id: 'cccccccc-0000-1111-2222-333333333333', eski: 'ESKI-1' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH1 · koleksiyon → alan yolu tablosu (gerçek belge biçimleriyle)', () => {
  const t = (c: string): BagliKayitTanimi => {
    const x = BAGLI_KAYIT_TABLOSU.find(y => y.koleksiyon === c);
    if (!x) throw new Error(`tabloda yok: ${c}`);
    return x;
  };
  const eski = new Map([['AKCALI-AKÇ.00312', ['k-eski']], ['ARGTGRİ', ['k-arg']]]);

  it('tablo: şartname koleksiyonlarının hepsi + `quotations` + `consignments`; alanı olmayanlar adıyla', () => {
    expect(BAGLI_KAYIT_TABLOSU.map(x => x.koleksiyon)).toEqual([
      'orders', 'quotations', 'quotes', 'priceLists', 'inventoryMovements', 'stockDiscrepancies', 'locationStocks', 'consignments',
      'purchaseOrders', 'bom', 'skuMappings', 'shipments', 'vehicles', 'warehouseItems', 'barkodlar', 'mikroFiyatListeleri', 'magazaTalepleri']);
    expect(BAGLI_KAYIT_TABLOSU.filter(x => x.yalnizSayilir).map(x => x.koleksiyon)).toEqual(['barkodlar', 'mikroFiyatListeleri', 'magazaTalepleri']);
    expect(BAGLI_KAYIT_TABLOSU.filter(x => !x.alanlar.length).map(x => x.koleksiyon)).toEqual(['shipments', 'vehicles', 'barkodlar']);
    for (const x of BAGLI_KAYIT_TABLOSU) expect(x.kaynak, x.koleksiyon).toMatch(/\.tsx?:\d+/);
  });

  it('DH1 · HER koleksiyonun HER alan yolu kendi gerçek biçimli belgesiyle TEK BAŞINA sayılır (bir yol bozulursa o koleksiyon kırmızı)', () => {
    // Beklenen yollar ve örnek belgeler ELLE yazılı (şartname DH1 tablosu + yazan satırlar) — tablodan TÜRETİLMEZ: türetilseydi
    // `lineItems` → `items` gibi bir yol mutasyonu örneği de birlikte bozar, sınama yeşil kalırdı.
    const E = 'AKCALI-AKÇ.00312', KART = 'k-eski';
    const skuKart = { sku: { sku: E }, productId: { productId: KART } };
    const TEKLIF = { 'items[].sku': { items: [{ sku: E }] }, 'lineItems[].sku': { lineItems: [{ sku: E }] }, 'items[].inventoryId': { items: [{ sku: 'YENI', inventoryId: KART }] }, 'lineItems[].inventoryId': { lineItems: [{ sku: 'YENI', inventoryId: KART }] } };
    const ornekler: Record<string, Record<string, Record<string, unknown>>> = {
      orders: { 'lineItems[].sku': { lineItems: [{ sku: E }] }, 'lineItems[].inventoryId': { lineItems: [{ sku: 'YENI', inventoryId: KART }] } },
      quotations: TEKLIF,
      quotes: TEKLIF,
      priceLists: { productId: { productId: KART }, 'items[].productId': { items: [{ productId: KART, sku: 'YENI' }] }, 'items[].sku': { items: [{ productId: 'x', sku: E }] } },
      inventoryMovements: { sth_stok_kod: { sth_stok_kod: E }, sku: { sku: E }, productId: { productId: KART } },
      stockDiscrepancies: skuKart, locationStocks: skuKart, consignments: skuKart,
      purchaseOrders: { sku: { sku: E }, inventoryId: { inventoryId: KART }, 'items[].sku': { items: [{ id: 'x', sku: E }] }, 'items[].id': { items: [{ id: KART, sku: 'YENI' }] } },
      bom: { productSku: { productSku: E }, 'components[].sku': { components: [{ sku: E }] }, 'components[].inventoryId': { components: [{ sku: 'YENI', inventoryId: KART }] } },
      skuMappings: { mikroSku: { mikroSku: E } },
      warehouseItems: { sku: { sku: E } },
      mikroFiyatListeleri: { sfiyat_stokkod: { sfiyat_stokkod: E } },
      magazaTalepleri: { 'kalemler[].sku': { kalemler: [{ sku: E }] }, 'teyit.kalemler[].sku': { teyit: { kalemler: [{ sku: E }] } } },
    };
    const alansiz = ['shipments', 'vehicles', 'barkodlar'];                 // yazan satırda alan yok / alan adı Mikro şemasından
    expect(BAGLI_KAYIT_TABLOSU.map(x => x.koleksiyon).sort()).toEqual([...Object.keys(ornekler), ...alansiz].sort());
    // Her belgede eski kodu taşımayan komşu alanlar da var: yanlış yoldan okuma sıfırdan büyük sayı üretmesin.
    const komsu = { id: 'komsu', veri: { sku: 'BASKA', productId: 'baska-kart', items: [{ sku: 'BASKA', id: 'baska-kart' }], lineItems: [{ sku: 'BASKA' }] } };
    for (const tn of BAGLI_KAYIT_TABLOSU) {
      if (alansiz.includes(tn.koleksiyon)) { expect(tn.alanlar, tn.koleksiyon).toEqual([]); continue; }
      const o = ornekler[tn.koleksiyon];
      expect(tn.alanlar.map(a => a.yol), tn.koleksiyon).toEqual(Object.keys(o));
      for (const [yol, veri] of Object.entries(o)) {
        const c = bagliKayitlariSay(tn, [{ id: 'b1', veri }, komsu], eski);
        expect([c.bagliBelge, c.alanBasina[yol]], `${tn.koleksiyon} · ${yol}`).toEqual([1, 1]);
        expect(Object.values(c.alanBasina).reduce((a, b) => a + b, 0), `${tn.koleksiyon} · ${yol} yalnız kendi yolundan`).toBe(1);
        expect([...(c.koduBasina.get(E) ?? [])], `${tn.koleksiyon} · ${yol}`).toEqual(['b1']);
      }
    }
  });

  it('DH1 + DH15 · orders `lineItems[].sku` — U+200E\'li ve NFD `İ`\'li eski kod sayılır; `items[]` (yanlış yol) sayılmaz', () => {
    const c = bagliKayitlariSay(t('orders'), [
      { id: 'mf-1', veri: { source: 'mikro_fatura', lineItems: [{ sku: 'AKCALI-AKÇ.00312\u200E' }, { sku: 'BASKA' }] } },
      { id: 'mf-2', veri: { lineItems: [{ sku: 'ARGTGRI\u0307' }] } },
      { id: 'yanlis-yol', veri: { items: [{ sku: 'AKCALI-AKÇ.00312' }] } },
      { id: 'kimlikle', veri: { lineItems: [{ sku: 'YENI', inventoryId: 'k-eski' }] } },
    ], eski);
    expect([c.okunanBelge, c.bagliBelge]).toEqual([4, 3]);
    expect(c.alanBasina).toEqual({ 'lineItems[].sku': 2, 'lineItems[].inventoryId': 1 });
    expect([...c.koduBasina].map(([k, ids]) => [k, [...ids].sort()])).toEqual([['AKCALI-AKÇ.00312', ['kimlikle', 'mf-1']], ['ARGTGRİ', ['mf-2']]]);
  });

  it('quotations iki dizinin ikisi; priceLists `productId` + `items[]`; inventoryMovements `sth_stok_kod`; purchaseOrders / bom gerçek biçim', () => {
    expect(bagliKayitlariSay(t('quotations'), [{ id: 'q1', veri: { items: [{ sku: 'ARGTGRİ' }] } }, { id: 'q2', veri: { lineItems: [{ sku: 'ARGTGRİ' }] } }], eski).bagliBelge).toBe(2);
    expect(bagliKayitlariSay(t('priceLists'), [{ id: 'p1', veri: { productId: 'k-eski' } }, { id: 'p2', veri: { items: [{ productId: 'x', sku: 'ARGTGRİ' }] } }], eski).alanBasina)
      .toEqual({ productId: 1, 'items[].productId': 0, 'items[].sku': 1 });
    expect(bagliKayitlariSay(t('inventoryMovements'), [{ id: 'g1', veri: { sth_stok_kod: 'AKCALI-AKÇ.00312' } }, { id: 'e1', veri: { sku: 'x', productId: 'k-arg' } }], eski).bagliBelge).toBe(2);
    expect(bagliKayitlariSay(t('purchaseOrders'), [{ id: 'po1', veri: { items: [{ id: 'k-eski', sku: 'YENI' }] } }, { id: 'sas', veri: { sku: 'ARGTGRİ', inventoryId: 'x' } }], eski).bagliBelge).toBe(2);
    expect(bagliKayitlariSay(t('bom'), [{ id: 'b1', veri: { productSku: 'X', components: [{ sku: 'ARGTGRİ', inventoryId: '' }] } }], eski).bagliBelge).toBe(1);
  });

  it('DH14 · magazaTalepleri: sku ve `-Dnnn` tabanı sayılır (iki dizi); renk varyantı / iki haneli son ek eşlenmez', () => {
    const c = bagliKayitlariSay(t('magazaTalepleri'), [
      { id: 't1', veri: { kalemler: [{ sku: 'AKCALI-AKÇ.00312-D025' }] } },
      { id: 't2', veri: { teyit: { kalemler: [{ sku: 'AKCALI-AKÇ.00312' }] } } },
      { id: 't3', veri: { kalemler: [{ sku: 'AKCALI-AKÇ.00312-MAVI' }, { sku: 'AKCALI-AKÇ.00312-D25' }] } },
    ], eski);
    expect([...(c.koduBasina.get('AKCALI-AKÇ.00312') ?? [])].sort()).toEqual(['t1', 't2']);
  });

  it('warehouseItems: `sku` + koddan türeyen kimlik (kimlik eşi verilir)', () => {
    const c = bagliKayitlariSay(t('warehouseItems'), [{ id: 'mikro-abcd1234-AKCALI-AKÇ.00312', veri: { sku: 'YENI' } }, { id: 'w2', veri: { sku: 'ARGTGRİ' } }], eski,
      new Map([['mikro-abcd1234-AKCALI-AKÇ.00312', 'AKCALI-AKÇ.00312']]));
    expect(c.alanBasina).toEqual({ sku: 1, '(kimlik)': 1 });
    expect(c.bagliBelge).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('DH16 · plan imzası + değişmezler', () => {
  const kur = (ek: { kartlar?: GocKarti[]; siparis?: Array<{ id: string; veri: Record<string, unknown> }>; kiraci?: string } = {}) => {
    const kartlar = ek.kartlar ?? [kart('k-eski', 'AKCALI-AKÇ.00312', { prices: { Retail: 10, Bayi: 8 } }), kart('k-yeni', 'AKCALI-00312', { prices: { Retail: 12 } })];
    const { s, evren } = kos({ kartlar, mikro: ['AKCALI-00312'], tablo: UC_KAYNAK('AKCALI-AKÇ.00312', 'AKCALI-00312'), kanitlar: [hareket('AKCALI-AKÇ.00312', 'AKCALI-00312')] });
    const sayim = bagliKayitlariSay(BAGLI_KAYIT_TABLOSU[0], ek.siparis ?? [{ id: 'mf-1', veri: { lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] } }], new Map([['AKCALI-AKÇ.00312', ['k-eski']]]));
    return { imza: planImzasi(ek.kiraci ?? 'A', s, evren, [sayim]), s, evren, sayim };
  };

  it('saatlik senkronun yazdığı alanlar (stockLevel, prices, costPrice, mikroSyncedAt, ad) imzayı DEĞİŞTİRMEZ', () => {
    const once = kur().imza;
    expect(once).toMatch(/^[0-9a-f]{64}$/);
    const sonra = kur({ kartlar: [
      { ...kart('k-eski', 'AKCALI-AKÇ.00312', { prices: { Retail: 99 } }), ...{ stockLevel: 5, costPrice: 1, mikroSyncedAt: 'x', name: 'Ad' } } as GocKarti,
      kart('k-yeni', 'AKCALI-00312', { prices: {} }),
    ] }).imza;
    expect(sonra).toBe(once);
  });

  it('eski kodlu yeni sipariş, kart kaynağı, kiracı ya da sınıf değişince imza DEĞİŞİR', () => {
    const once = kur().imza;
    expect(kur({ siparis: [{ id: 'mf-1', veri: { lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] } }, { id: 'mf-2', veri: { lineItems: [{ sku: 'AKCALI-AKÇ.00312' }] } }] }).imza).not.toBe(once);
    expect(kur({ kartlar: [kart('k-eski', 'AKCALI-AKÇ.00312', { source: 'mikro_cron' }), kart('k-yeni', 'AKCALI-00312')] }).imza).not.toBe(once);
    expect(kur({ kiraci: 'B' }).imza).not.toBe(once);
    const { s, evren, sayim } = kur();
    const dogrulaya = { ...s, satirlar: s.satirlar.map(r => ({ ...r, sinif: 'dogrula' as const })) };
    expect(planImzasi('A', dogrulaya, evren, [sayim])).not.toBe(once);
  });

  it('sınıf / hedef / kartlar AYNI kalıp yalnız bir adayın Mikro var / yok biti değişince imza DEĞİŞİR (DH16 «var / yok bitleri»)', () => {
    const kartlar = [kart('k-ma', 'MA-HY-003'), kart('k-apel', 'APEL-HY-003'), kart('k-mitre', 'MITREAPEL-HY-003')];
    const tablo = [cift('MA-HY-003', 'APEL-HY-003', 'onayli1010'), cift('MA-HY-003', 'MITREAPEL-HY-003', 'revize0930'), cift('MA-HY-003', 'UCUNCU-ADAY-003', 'aktarim0930')];
    const imzala = (mikro: string[]) => { const { s, evren } = kos({ kartlar, mikro, tablo }); return { imza: planImzasi('A', s, evren, []), s }; };
    const once = imzala(['APEL-HY-003', 'MITREAPEL-HY-003']);
    const sonra = imzala(['APEL-HY-003', 'MITREAPEL-HY-003', 'UCUNCU-ADAY-003']);
    const ozet = (x: typeof once) => x.s.satirlar.map(r => [r.eski, r.yeni, r.sinif, r.kanit, r.kartlar]);
    expect(ozet(sonra)).toEqual(ozet(once));
    expect(ozet(once)).toEqual([['MA-HY-003', null, 'cok_anlamli', [], ['k-ma']]]);
    expect(sonra.imza).not.toBe(once.imza);
  });

  it('plan özeti: kalan kart yeni kodlu ikiz, eski kart arşive, belge sayısı, eski kartta olup kalanda olmayan fiyat kademesi ADI', () => {
    const { s, evren, sayim } = kur();
    const p = planOzeti(s, evren, [sayim]);
    expect(p.satirlar).toEqual([{ eski: 'AKCALI-AKÇ.00312', yeni: 'AKCALI-00312', sinif: 'kesin', kalanKart: 'k-yeni', kalanKartSayisi: 1, arsiveGiden: ['k-eski'], belge: { orders: 1 }, fiyatKademeFarki: ['Bayi'] }]);
    expect(p.kesin).toEqual({ cift: 1, arsiveGidenKart: 1, kalanKartsiz: 0, belge: { orders: 1 }, toplamBelge: 1 });
  });

  it('aynı sku değişmezi: önce iki kart, plan sonrası (eski kartlar çıkınca) sayım', () => {
    const kartlar = [kart('a', 'X-1'), kart('b', 'X-1 '), kart('c', 'Y-1')];
    expect(ayniSkuGruplari(kartlar)).toEqual([{ sku: 'X-1', kart: 2 }]);
    expect(ayniSkuGruplari(kartlar, new Set(['b']))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('cronKiracisi (ops ucunun kiracısı; crons.ts `cronCompanyId` kuralı)', () => {
  const b = (id: string, role: unknown, companyId?: unknown) => ({ id, veri: { role, companyId } });
  it('önce MIKRO_CRON_COMPANY_ID; yoksa tek rollü kiracı; rolsüz belge sayılmaz; iki kiracı → boş; SERVER_TENANT_COMPANY_ID\'e bakmaz', () => {
    expect(cronKiracisi({ MIKRO_CRON_COMPANY_ID: 'ORTAM' }, [b('u1', 'Admin', 'A'), b('u2', 'Admin', 'B')])).toBe('ORTAM');
    expect(cronKiracisi({}, [b('u1', 'Admin', 'A'), b('u2', 'Sales', 'A'), b('yabanci', undefined)])).toBe('A');
    expect(cronKiracisi({}, [b('kurucu', 'Admin')])).toBe('kurucu');
    expect(cronKiracisi({}, [b('u1', 'Admin', 'A'), b('u2', 'Admin', 'B')])).toBe('');
    expect(cronKiracisi({ SERVER_TENANT_COMPANY_ID: 'SUNUCU' }, [b('u1', 'Admin', 'A'), b('u2', 'Admin', 'B')])).toBe('');
  });
});
