/**
 * eslemeVarlik.test.ts — Mikro'dan OKUNAN varlık eşlemelerinin sözleşmesi
 * (Faz 3 3/n, grup "eslemeVarlik", 2026-09-19). ÖNCE YAZILDI.
 *
 * Kilitlenen iki şey:
 *
 *  1. **PARİTE** — bilinen girdide eşleme, rotadaki eski gövdeyle BİREBİR aynı
 *     (alan adları, sabit Mikro/UI kodları, kod'a düşen ad yedeği). `toEqual`
 *     ile snapshot gibi kilitlenir; bir alan sessizce düşerse test kırılır.
 *
 *  2. **BİLİNMEYEN 0 YAZILMAZ** — Mikro okumasında bir sayı çözülemiyorsa alan
 *     HİÇ yazılmaz (merge:true mevcut değeri korur) ve sayaca girer. `alisBedeli: 0`
 *     amortismanı sessizce 0'lar; `faydaliOmur: 0` ömrü yok eder; `quantity: 0`
 *     reçeteyi "0 adet çimento" yapar; `salary: 0` bordroyu sıfırlar. Hepsi
 *     GEÇERLİ görünen, sessiz yanlış kayıtlardır.
 *
 * Fikstürler Türkçe ve gerçek alandan: Şirin İnşaat, ÇİMENTO 50KG, ₺.
 */
import { describe, it, expect } from 'vitest';
import {
  mikroKod,
  demirbasEsle,
  maliyetMerkeziEsle,
  personelEsle,
  receteKalemiEsle,
  receteBilesen,
  ozetBaslat,
  ozetEkle,
  okumaArizasi,
  bilinmeyenNotu,
  okumaArizasiUyarisi,
  DEMIRBAS_KRITIK,
  MALIYET_MERKEZI_KRITIK,
  PERSONEL_KRITIK,
  RECETE_KRITIK,
  type DemirbasKolonlari,
  type ReceteKolonlari,
} from './eslemeVarlik';

// ── Fikstürler ───────────────────────────────────────────────────────────────

const DEM_KOLON: DemirbasKolonlari = {
  kod: 'dem_kod',
  ad: 'dem_isim',
  tarih: 'dem_alis_tarihi',
  bedel: 'dem_alis_bedeli',
  omur: 'dem_faydali_omur',
  grup: 'dem_grup_kodu',
};

/** Mikro DEMIRBASLAR satırı — tüm alanlar dolu (parite tabanı). */
const demSatir = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  dem_Guid: '{A1}',
  dem_kod: 'DMB-001',
  dem_isim: 'Beton Mikseri',
  dem_alis_tarihi: '2024-03-15',
  dem_alis_bedeli: 1250000,
  dem_faydali_omur: 10,
  dem_grup_kodu: 'Makine',
  ...ek,
});

const RECETE_KOLON: ReceteKolonlari = {
  ana: 'rec_ana_stok_kod',
  alt: 'rec_alt_stok_kod',
  miktar: 'rec_miktar',
  birim: 'rec_birim',
};

const recSatir = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  rec_ana_stok_kod: 'HAZIR-BETON-C30',
  rec_alt_stok_kod: 'ÇİMENTO 50KG',
  rec_miktar: 6,
  rec_birim: 'ÇUVAL',
  ...ek,
});

const perSatir = (ek: Record<string, unknown> = {}): Record<string, unknown> => ({
  mikroPersKod: 'PER-014',
  name: 'Ayşe',
  surname: 'Şirin',
  email: 'ayse@sirininsaat.com.tr',
  phone: '0532 000 00 00',
  department: 'Muhasebe',
  position: 'Ön Muhasebe Sorumlusu',
  salary: 68500,
  startDate: '2021-09-01',
  status: '0',
  tcId: '12345678901',
  ...ek,
});

// ── mikroKod ─────────────────────────────────────────────────────────────────

describe('mikroKod', () => {
  it('kolon adı null ise boş döner, değer kırpılır', () => {
    expect(mikroKod({ a: '  DMB-001 ' }, 'a')).toBe('DMB-001');
    expect(mikroKod({ a: 'x' }, null)).toBe('');
    expect(mikroKod({ a: null }, 'a')).toBe('');
    expect(mikroKod({}, 'yok')).toBe('');
  });
});

// ── Demirbaş ─────────────────────────────────────────────────────────────────

describe('demirbasEsle — parite', () => {
  it('bilinen satır: eski rotayla BİREBİR aynı alanlar (yeni kayıt)', () => {
    const r = demSatir();
    const s = demirbasEsle(r, DEM_KOLON);
    expect(s.alanlar).toEqual({
      demirbasNo: 'DMB-001',
      ad: 'Beton Mikseri',
      kategori: 'Makine',
      mikroGrupKodu: 'Makine',
      alisTarihi: '2024-03-15',
      alisBedeli: 1250000,
      faydaliOmur: 10,
      durum: 'Aktif',
      amortYontemi: 'Doğrusal',
      paraBirimi: 'TRY',
      birikmisSalinma: 0,
      departman: '',
      mikroHam: r,
      source: 'mikro_import',
    });
    expect(s.bilinmeyen).toEqual([]);
  });

  it('var olan kayıtta kullanıcının elle girdiği alanlar EZİLMEZ', () => {
    const eski = {
      kategori: 'Taşıt', durum: 'Hurda', amortYontemi: 'Azalan Bakiyeler',
      paraBirimi: 'EUR', departman: 'Şantiye', birikmisSalinma: 400000,
    };
    const s = demirbasEsle(demSatir(), DEM_KOLON, eski);
    expect(s.alanlar.kategori).toBe('Taşıt');
    expect(s.alanlar.durum).toBe('Hurda');
    expect(s.alanlar.amortYontemi).toBe('Azalan Bakiyeler');
    expect(s.alanlar.paraBirimi).toBe('EUR');
    expect(s.alanlar.departman).toBe('Şantiye');
  });

  it("geçersiz Mikro grup kodu kategori UYDURMAZ: 'Diğer' + ham kod ayrı alanda", () => {
    const s = demirbasEsle(demSatir({ dem_grup_kodu: 'MK-01' }), DEM_KOLON);
    expect(s.alanlar.kategori).toBe('Diğer');
    expect(s.alanlar.mikroGrupKodu).toBe('MK-01');
  });

  it('ad boşsa demirbaş koduna düşer (parite)', () => {
    const s = demirbasEsle(demSatir({ dem_isim: '   ' }), DEM_KOLON);
    expect(s.alanlar.ad).toBe('DMB-001');
    expect(s.bilinmeyen).toContain('ad');
  });
});

describe('demirbasEsle — bilinmeyen sayı YAZILMAZ', () => {
  it('alış bedeli kolonu çözülemediyse alisBedeli YAZILMAZ (0 değil)', () => {
    const s = demirbasEsle(demSatir(), { ...DEM_KOLON, bedel: null });
    expect('alisBedeli' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('alisBedeli');
  });

  it('alış bedeli satırda boşsa/metinse YAZILMAZ — amortisman 0 bedelden hesaplanmasın', () => {
    for (const ham of [null, undefined, '', '   ', 'yok', Number.NaN]) {
      const s = demirbasEsle(demSatir({ dem_alis_bedeli: ham }), DEM_KOLON);
      expect('alisBedeli' in s.alanlar).toBe(false);
      expect(s.bilinmeyen).toContain('alisBedeli');
    }
  });

  it('Mikro GERÇEKTEN 0 yazdıysa 0 yazılır (bilinen sıfır ≠ bilinmeyen)', () => {
    const s = demirbasEsle(demSatir({ dem_alis_bedeli: 0 }), DEM_KOLON);
    expect(s.alanlar.alisBedeli).toBe(0);
    expect(s.bilinmeyen).not.toContain('alisBedeli');
  });

  it('sayısal metin kabul edilir (sürücü string döndürebilir)', () => {
    const s = demirbasEsle(demSatir({ dem_alis_bedeli: '1250000.5' }), DEM_KOLON);
    expect(s.alanlar.alisBedeli).toBe(1250000.5);
  });

  it('faydalı ömür bilinmiyorsa YAZILMAZ (0 ömür sonsuz/sıfır amortisman üretir)', () => {
    const s = demirbasEsle(demSatir({ dem_faydali_omur: '' }), DEM_KOLON);
    expect('faydaliOmur' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('faydaliOmur');
  });

  it('alış tarihi çözülemezse YAZILMAZ — elle girilen tarih silinmesin', () => {
    const s = demirbasEsle(demSatir({ dem_alis_tarihi: null }), DEM_KOLON);
    expect('alisTarihi' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('alisTarihi');
  });

  it('Date nesnesi ve TR biçimi gün anahtarına çevrilir (String().slice(0,10) çöp üretiyordu)', () => {
    expect(demirbasEsle(demSatir({ dem_alis_tarihi: new Date(2024, 2, 15) }), DEM_KOLON).alanlar.alisTarihi)
      .toBe('2024-03-15');
    expect(demirbasEsle(demSatir({ dem_alis_tarihi: '15.03.2024' }), DEM_KOLON).alanlar.alisTarihi)
      .toBe('2024-03-15');
  });
});

describe('demirbasEsle — birikmiş amortisman', () => {
  it('YENİ kayıtta 0 yazılır (Cetpa\'da henüz amortisman işlenmedi — gerçek başlangıç)', () => {
    expect(demirbasEsle(demSatir(), DEM_KOLON).alanlar.birikmisSalinma).toBe(0);
  });

  it('VAR OLAN kayıtta HİÇ yazılmaz — `Number(eski) || 0` elle girilen değeri siliyordu', () => {
    // '12.500,50' → Number(...) NaN → eski kod 0 yazıyordu: birikmiş amortisman uçardı.
    const s = demirbasEsle(demSatir(), DEM_KOLON, { birikmisSalinma: '12.500,50' });
    expect('birikmisSalinma' in s.alanlar).toBe(false);
    const s2 = demirbasEsle(demSatir(), DEM_KOLON, { birikmisSalinma: 400000 });
    expect('birikmisSalinma' in s2.alanlar).toBe(false);
  });
});

// ── Maliyet merkezi ──────────────────────────────────────────────────────────

describe('maliyetMerkeziEsle', () => {
  const kolon = { kod: 'som_kodu', ad: 'som_adi' };
  const satir = { som_Guid: '{B2}', som_kodu: 'MM-10', som_adi: 'Şantiye Giderleri' };

  it('parite: bilinen satırda alanlar birebir (yeni kayıt)', () => {
    const s = maliyetMerkeziEsle(satir, kolon);
    expect(s.alanlar).toEqual({
      kod: 'MM-10',
      ad: 'Şantiye Giderleri',
      aktif: true,
      mikroHam: satir,
      source: 'mikro_import',
    });
    expect(s.bilinmeyen).toEqual([]);
  });

  it('ad kolonu çözülemezse koda düşer ve sayaca girer', () => {
    const s = maliyetMerkeziEsle(satir, { ...kolon, ad: null });
    expect(s.alanlar.ad).toBe('MM-10');
    expect(s.bilinmeyen).toContain('ad');
  });

  it('VAR OLAN kayıtta aktif YAZILMAZ — kullanıcının pasife aldığı merkez her senkronda dirilmesin', () => {
    const s = maliyetMerkeziEsle(satir, kolon, { aktif: false });
    expect('aktif' in s.alanlar).toBe(false);
  });
});

// ── Personel ─────────────────────────────────────────────────────────────────

describe('personelEsle — parite', () => {
  it('bilinen satır, YENİ kayıt: eski rotayla birebir', () => {
    const s = personelEsle(perSatir(), true);
    expect(s.alanlar).toEqual({
      mikroPersKod: 'PER-014',
      name: 'Ayşe Şirin',
      email: 'ayse@sirininsaat.com.tr',
      phone: '0532 000 00 00',
      department: 'Muhasebe',
      position: 'Ön Muhasebe Sorumlusu',
      salary: 68500,
      startDate: '2021-09-01',
      status: 'Aktif',
      tcId: '12345678901',
      source: 'mikro_import',
    });
    expect(s.bilinmeyen).toEqual([]);
  });

  it("Mikro durum kodu '0' → 'Aktif'; başka değer AYNEN korunur (uydurulmaz)", () => {
    expect(personelEsle(perSatir({ status: 'Pasif' }), true).alanlar.status).toBe('Pasif');
    expect(personelEsle(perSatir({ status: 'aktif' }), true).alanlar.status).toBe('Aktif');
  });

  it('ad/soyad boşsa personel koduna düşer (parite)', () => {
    expect(personelEsle(perSatir({ name: '', surname: '' }), true).alanlar.name).toBe('PER-014');
  });
});

describe('personelEsle — bilinmeyen YAZILMAZ', () => {
  it('maaş bilinmiyorsa YENİ kayıtta bile salary YAZILMAZ (0 bordroyu sıfırlar)', () => {
    for (const ham of [null, undefined, '', 'yok', Number.NaN]) {
      const s = personelEsle(perSatir({ salary: ham }), true);
      expect('salary' in s.alanlar).toBe(false);
      expect(s.bilinmeyen).toContain('salary');
    }
  });

  it('maaş 0 da bilinmeyen sayılır (parite: eski kod da >0 arıyordu)', () => {
    const s = personelEsle(perSatir({ salary: 0 }), true);
    expect('salary' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('salary');
  });

  it('TC kimlik bilinmiyorsa null YAZILMAZ — elle girilen TC silinmesin', () => {
    const s = personelEsle(perSatir({ tcId: '' }), false);
    expect('tcId' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('tcId');
  });

  it('durum bilinmiyorsa VAR OLAN kayıtta status YAZILMAZ — İK\'nın "Pasif"i her senkronda dirilmesin', () => {
    const s = personelEsle(perSatir({ status: '' }), false);
    expect('status' in s.alanlar).toBe(false);
    expect(s.bilinmeyen).toContain('status');
  });

  it('durum bilinmiyorsa YENİ kayıtta "Aktif" yazılır (UI sözlük anahtarı, fallback yok) ama sayaca girer', () => {
    const s = personelEsle(perSatir({ status: '' }), true);
    expect(s.alanlar.status).toBe('Aktif');
    expect(s.bilinmeyen).toContain('status');
  });

  it('metin alanları: Mikro boş bıraktıysa VAR OLAN kayıtta yazılmaz, YENİ kayıtta \'\' (UI fallback\'siz okuyor)', () => {
    const bos = { email: '', phone: '', department: '', position: '', startDate: '' };
    const varOlan = personelEsle(perSatir(bos), false);
    for (const a of ['email', 'phone', 'department', 'position', 'startDate']) {
      expect(a in varOlan.alanlar).toBe(false);
      expect(varOlan.bilinmeyen).toContain(a);
    }
    const yeni = personelEsle(perSatir(bos), true);
    for (const a of ['email', 'phone', 'department', 'position', 'startDate']) {
      expect(yeni.alanlar[a]).toBe('');
    }
  });

  it('işe giriş tarihi gün anahtarına çevrilir, çözülemezse yazılmaz', () => {
    expect(personelEsle(perSatir({ startDate: '2021-09-01T00:00:00' }), true).alanlar.startDate).toBe('2021-09-01');
    expect(personelEsle(perSatir({ startDate: new Date(2021, 8, 1) }), true).alanlar.startDate).toBe('2021-09-01');
    const bozuk = personelEsle(perSatir({ startDate: 'bilinmiyor' }), false);
    expect('startDate' in bozuk.alanlar).toBe(false);
  });
});

// ── Üretim reçetesi ──────────────────────────────────────────────────────────

describe('receteKalemiEsle', () => {
  it('parite: bilinen satırda ana kod + kalem birebir', () => {
    const s = receteKalemiEsle(recSatir(), RECETE_KOLON);
    expect(s.ana).toBe('HAZIR-BETON-C30');
    expect(s.kalem).toEqual({ sku: 'ÇİMENTO 50KG', unit: 'ÇUVAL', quantity: 6 });
    expect(s.bilinmeyen).toEqual([]);
  });

  it('miktar bilinmiyorsa quantity ANAHTARI HİÇ yazılmaz — "0 çuval çimento" reçetesi üretilmesin', () => {
    for (const ham of [null, undefined, '', 'yok']) {
      const s = receteKalemiEsle(recSatir({ rec_miktar: ham }), RECETE_KOLON);
      expect(s.kalem).not.toBeNull();
      expect('quantity' in (s.kalem as object)).toBe(false);
      expect(s.bilinmeyen).toContain('quantity');
    }
  });

  it('miktar kolonu hiç çözülemediyse de quantity yazılmaz', () => {
    const s = receteKalemiEsle(recSatir(), { ...RECETE_KOLON, miktar: null });
    expect('quantity' in (s.kalem as object)).toBe(false);
    expect(s.bilinmeyen).toContain('quantity');
  });

  it('ana ya da bileşen kodu yoksa satır ATLANIR (kalem null) ve sayaca girer', () => {
    const a = receteKalemiEsle(recSatir({ rec_ana_stok_kod: '' }), RECETE_KOLON);
    expect(a.kalem).toBeNull();
    expect(a.bilinmeyen).toContain('productSku');
    const b = receteKalemiEsle(recSatir(), { ...RECETE_KOLON, alt: null });
    expect(b.kalem).toBeNull();
    expect(b.bilinmeyen).toContain('componentSku');
  });

  it('receteBilesen: envanterde eşleşen ürün varsa ad/id dolar, yoksa SKU\'ya düşer', () => {
    const kalem = receteKalemiEsle(recSatir(), RECETE_KOLON).kalem!;
    expect(receteBilesen(kalem, { id: 'inv-9', name: 'Portland Çimento 50 KG' })).toEqual({
      inventoryId: 'inv-9', name: 'Portland Çimento 50 KG', sku: 'ÇİMENTO 50KG', unit: 'ÇUVAL', quantity: 6,
    });
    expect(receteBilesen(kalem)).toEqual({
      inventoryId: '', name: 'ÇİMENTO 50KG', sku: 'ÇİMENTO 50KG', unit: 'ÇUVAL', quantity: 6,
    });
  });

  it('receteBilesen: miktar bilinmiyorsa quantity anahtarı bileşende de YOK (undefined bile yazılmaz)', () => {
    const kalem = receteKalemiEsle(recSatir({ rec_miktar: null }), RECETE_KOLON).kalem!;
    const b = receteBilesen(kalem);
    expect('quantity' in b).toBe(false);
    expect(JSON.stringify(b)).not.toMatch(/quantity/);
  });
});

// ── Özet / okuma arızası ─────────────────────────────────────────────────────

describe('ozet + okumaArizasi', () => {
  it('bir alan TÜM satırlarda bilinmiyorsa okuma arızasıdır (≥5 satır)', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 6; i++) {
      ozetEkle(ozet, demirbasEsle(demSatir({ dem_kod: `DMB-00${i}` }), { ...DEM_KOLON, bedel: null }));
    }
    expect(okumaArizasi(ozet, DEMIRBAS_KRITIK)).toEqual(['alisBedeli']);
    expect(okumaArizasiUyarisi(okumaArizasi(ozet, DEMIRBAS_KRITIK)))
      .toBe('UYARI: alisBedeli alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin.');
  });

  it('bazı satırlarda bilinmiyorsa arıza DEĞİL, yalnız sayaç', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 6; i++) {
      ozetEkle(ozet, demirbasEsle(demSatir({ dem_alis_bedeli: i < 2 ? null : 1000 }), DEM_KOLON));
    }
    expect(okumaArizasi(ozet, DEMIRBAS_KRITIK)).toEqual([]);
    expect(bilinmeyenNotu(ozet, [])).toBe('2 satırın alisBedeli alanı bilinmiyor');
  });

  it('küçük importta (5 satırdan az) arıza ilan edilmez — kanıt yetersiz', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 4; i++) ozetEkle(ozet, demirbasEsle(demSatir(), { ...DEM_KOLON, bedel: null }));
    expect(okumaArizasi(ozet, DEMIRBAS_KRITIK)).toEqual([]);
  });

  it('birden çok alan: uyarı çoğul yazılır, not alanları ayırır', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 5; i++) {
      ozetEkle(ozet, demirbasEsle(demSatir(), { ...DEM_KOLON, bedel: null, omur: null }));
    }
    expect(okumaArizasi(ozet, DEMIRBAS_KRITIK)).toEqual(['alisBedeli', 'faydaliOmur']);
    expect(okumaArizasiUyarisi(okumaArizasi(ozet, DEMIRBAS_KRITIK)))
      .toBe('UYARI: alisBedeli, faydaliOmur alanları hiçbir satırda okunamadı — kolon adı/şema kontrol edin.');
    // Arıza listesi BOŞ verilirse ham sayaç metni (iki alan da görünür) — dışlama testi aşağıda.
    expect(bilinmeyenNotu(ozet, [])).toBe('5 satırın alisBedeli alanı bilinmiyor; 5 satırın faydaliOmur alanı bilinmiyor');
  });

  it('hiç bilinmeyen yoksa not boş, uyarı boş', () => {
    const ozet = ozetBaslat();
    ozetEkle(ozet, demirbasEsle(demSatir(), DEM_KOLON));
    expect(bilinmeyenNotu(ozet, [])).toBe('');
    expect(okumaArizasiUyarisi([])).toBe('');
  });

  it('ozetEkle reçete sonucunu da sayar (farklı şekil, aynı sayaç)', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 5; i++) ozetEkle(ozet, receteKalemiEsle(recSatir({ rec_miktar: null }), RECETE_KOLON));
    expect(okumaArizasi(ozet, RECETE_KRITIK)).toEqual(['quantity']);
  });
});

// ── Okuma arızası YALNIZ kritik alanlarda (kalıcı yanlış alarm yok) ──────────
//
// 2026-09-19 hakem bulgusu: `okumaArizasi` sayaçtaki TÜM alanları arıza adayı
// sayıyordu. Personelde e-posta/telefon/TC/maaş meşru olarak boş kalabilir (Mikro
// maaşı boş bırakınca 0 döner) — 8 personelin hiçbirinde e-posta yoksa her senkron
// "UYARI: email alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin"
// basıyordu. Kalıcı yanlış alarm, GERÇEK okuma arızası kapısını değersizleştirir
// (eslemeFatura aynı sınıfı `cha_evrakno_seri`yi kritik listeye almayarak önlemişti).
describe('okumaArizasi — yalnız KRİTİK alanlar arıza sayılır', () => {
  it('personelde e-posta/telefon/TC/maaş hiç girilmemişse ARIZA DEĞİL (meşru boş alan)', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 8; i++) {
      ozetEkle(ozet, personelEsle(
        perSatir({ mikroPersKod: `P-${i}`, email: '', phone: '', tcId: '', salary: 0 }), true));
    }
    expect(okumaArizasi(ozet, PERSONEL_KRITIK)).toEqual([]);
    // Sayaç yine de bildirir — "yok sayıldı" değil, "arıza ilan edilmedi".
    expect(bilinmeyenNotu(ozet, [])).toContain('8 satırın email alanı bilinmiyor');
  });

  it('personelde ad/soyad HİÇBİR satırda okunamıyorsa bu ARIZADIR (kritik alan)', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 6; i++) {
      ozetEkle(ozet, personelEsle(perSatir({ mikroPersKod: `P-${i}`, name: '', surname: '' }), true));
    }
    expect(okumaArizasi(ozet, PERSONEL_KRITIK)).toEqual(['name']);
  });

  it('reçetede birim boş olabilir (arıza değil), miktar/kod okunamazsa arızadır', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 5; i++) {
      ozetEkle(ozet, receteKalemiEsle(recSatir({ rec_miktar: null }), { ...RECETE_KOLON, birim: null }));
    }
    expect(okumaArizasi(ozet, RECETE_KRITIK)).toEqual(['quantity']);
  });

  it('demirbaşta kategori (Mikro grup kodu) arıza sayılmaz — geçerli "Diğer" yedeği var', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 6; i++) {
      ozetEkle(ozet, demirbasEsle(demSatir({ dem_kod: `DMB-${i}`, dem_grup_kodu: '' }), DEM_KOLON));
    }
    expect(okumaArizasi(ozet, DEMIRBAS_KRITIK)).toEqual([]);
  });

  it('maliyet merkezinde ad tüm satırlarda boşsa arızadır', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 5; i++) {
      ozetEkle(ozet, maliyetMerkeziEsle({ som_kodu: `MM-${i}`, som_adi: '' },
        { kod: 'som_kodu', ad: 'som_adi' }));
    }
    expect(okumaArizasi(ozet, MALIYET_MERKEZI_KRITIK)).toEqual(['ad']);
  });

  it('bilinmeyenNotu arıza ilan edilen alanı TEKRAR saymaz (aynı alan üç kez geçmesin)', () => {
    const ozet = ozetBaslat();
    for (let i = 0; i < 6; i++) {
      ozetEkle(ozet, demirbasEsle(
        demSatir({ dem_kod: `DMB-${i}`, dem_alis_bedeli: null, dem_faydali_omur: i < 2 ? null : 5 }),
        DEM_KOLON));
    }
    const ariza = okumaArizasi(ozet, DEMIRBAS_KRITIK);
    expect(ariza).toEqual(['alisBedeli']);
    expect(bilinmeyenNotu(ozet, ariza)).toBe('2 satırın faydaliOmur alanı bilinmiyor');
  });
});
