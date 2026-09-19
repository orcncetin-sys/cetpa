/**
 * govdeStokCari.test.ts — StokKaydetV2 / CariKaydetV2 gövdeleri (Faz 3 3/n, grup
 * "govdeStokCari"). ÖNCE YAZILDI, kırmızı görüldü, sonra modül yazıldı.
 *
 * İki şeyi birden kilitler:
 *  1) PARİTE — bilinen girdide gövde, rotadaki eski satır içi nesneyle BİREBİR aynı
 *     (alan adları, sıra, sabit Mikro kodları). `toEqual` snapshot yerine açık yazıldı ki
 *     bir alanın sessizce düşmesi testte ADIYLA görünsün.
 *  2) VARSAYILAN YOK — her sahte-varsayılan sitesi için "bilinmiyorsa throw" vakası.
 *     Bu testlerin her biri mutasyon-ayırt-edici: kapıyı `|| 0` / `?? 1` / sabit değere
 *     geri çevirirsen İLGİLİ test kırılır (bkz. dosya sonundaki mutasyon notu).
 */
import { describe, it, expect } from 'vitest';
import { MikroGovdeHatasi } from './govdeHatasi';
import { stokGovdesi, cariGovdesi } from './govdeStokCari';

/** Müşterinin gerçek Mikro tablosu (VergiListesiV2): 1=YOK %0 · 2=%1 · 3=%10 · 4=%20. */
const VERGI_TABLOSU = new Map<number, number>([[1, 0], [2, 1], [3, 10], [4, 20]]);

const CIMENTO = {
  sku: 'CIM-50',
  name: 'ÇİMENTO 50KG PORTLAND CEM I 42,5R',
  unit: 'ADET',
  vatRate: 20,
  prices: { 'Retail': 189.9, 'B2B Standard': 172.5, 'B2B Premium': 165, 'Dealer': 158.25 },
} as Record<string, unknown>;

/** Kademe satırı kalıbı — sabitler (deposirano/odemeplan/birim_pntr/doviz) rotadan aynen. */
const fiyatSatiri = (listeSiraNo: number, fiyat: number) => ({
  sfiyat_listesirano: listeSiraNo, sfiyat_deposirano: 1, sfiyat_odemeplan: 0,
  sfiyat_birim_pntr: 1, sfiyat_fiyati: fiyat, sfiyat_doviz: 0,
});

describe('stokGovdesi — parite', () => {
  it('bilinen ürün: gövde rotadaki eski nesneyle birebir aynı', () => {
    expect(stokGovdesi(CIMENTO, VERGI_TABLOSU)).toEqual({
      sto_kod:             'CIM-50',
      sto_isim:            'ÇİMENTO 50KG PORTLAND CEM I 42,5R',
      sto_kisa_ismi:       'ÇİMENTO 50KG PORTLAND CE',   // ilk 24 karakter (rota ile aynı)
      sto_cins:            0,
      sto_doviz_cinsi:     0,
      sto_birim1_ad:       'ADET',
      sto_perakende_vergi: 4,                            // İNDEKS (%20'nin sıra no'su), yüzde DEĞİL
      sto_toptan_vergi:    4,
      satis_fiyatlari: [
        fiyatSatiri(1, 189.9), fiyatSatiri(2, 172.5), fiyatSatiri(3, 165), fiyatSatiri(4, 158.25),
      ],
    });
  });

  it('kademe sırası ve listesirano eşlemesi sabit: 1=Retail 2=B2B Standard 3=B2B Premium 4=Dealer', () => {
    const g = stokGovdesi({ ...CIMENTO, prices: { 'Dealer': 158.25, 'Retail': 189.9 } }, VERGI_TABLOSU);
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(1, 189.9), fiyatSatiri(4, 158.25)]);
  });

  it('%10 ürün: işaretçi 3 — yüzde asla olduğu gibi yazılmaz', () => {
    const g = stokGovdesi({ ...CIMENTO, vatRate: 10 }, VERGI_TABLOSU);
    expect(g.sto_perakende_vergi).toBe(3);
    expect(g.sto_toptan_vergi).toBe(3);
  });

  it('%0 (vergi YOK) ürün: işaretçi 1 — sıfır oran "bilinmiyor" sayılmaz', () => {
    expect(stokGovdesi({ ...CIMENTO, vatRate: 0 }, VERGI_TABLOSU).sto_perakende_vergi).toBe(1);
  });
});

describe('stokGovdesi — fiyat kademeleri (sahte ₺0 YOK)', () => {
  it('fiyatı bilinmeyen kademe satırı HİÇ üretilmez (₺0 satırı da yazılmaz)', () => {
    const g = stokGovdesi({ ...CIMENTO, prices: { 'Retail': 189.9, 'B2B Premium': 165 } }, VERGI_TABLOSU);
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(1, 189.9), fiyatSatiri(3, 165)]);
    expect(g.satis_fiyatlari.some(s => s.sfiyat_fiyati === 0)).toBe(false);
  });

  it('fiyat 0 veya negatifse satır üretilmez (rota `.filter(p => p.sfiyat_fiyati > 0)` paritesi)', () => {
    const g = stokGovdesi({ ...CIMENTO, prices: { 'Retail': 0, 'B2B Standard': -5, 'Dealer': 158.25 } }, VERGI_TABLOSU);
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(4, 158.25)]);
  });

  it('çöp fiyat (metin/NaN/null) satır üretmez — `|| 0` ile sessizce ₺0 olmaz', () => {
    const g = stokGovdesi(
      { ...CIMENTO, prices: { 'Retail': 'bilinmiyor', 'B2B Standard': Number.NaN, 'B2B Premium': null, 'Dealer': 158.25 } },
      VERGI_TABLOSU,
    );
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(4, 158.25)]);
  });

  it('sayı OLMAYAN doğru değer (true) fiyat sayılmaz — `Number(true)` ₺1 satırı açardı', () => {
    const g = stokGovdesi({ ...CIMENTO, prices: { 'Retail': true, 'Dealer': 158.25 } }, VERGI_TABLOSU);
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(4, 158.25)]);
  });

  it('sayısal metin fiyat SAYIya çevrilir (bilinçli fark: rota metni olduğu gibi gönderiyordu)', () => {
    const g = stokGovdesi({ ...CIMENTO, prices: { 'Retail': '1250.5' } }, VERGI_TABLOSU);
    expect(g.satis_fiyatlari).toEqual([fiyatSatiri(1, 1250.5)]);
    expect(typeof g.satis_fiyatlari[0].sfiyat_fiyati).toBe('number');
  });

  it('hiçbir kademe bilinmiyorsa throw — fiyatsız stok kartı Mikro\'ya AÇILMAZ', () => {
    expect(() => stokGovdesi({ ...CIMENTO, prices: {} }, VERGI_TABLOSU)).toThrow(MikroGovdeHatasi);
    expect(() => stokGovdesi({ ...CIMENTO, prices: undefined }, VERGI_TABLOSU))
      .toThrow(/satış fiyatı bilinmiyor/);
  });
});

describe('stokGovdesi — zorunlu alanlar (varsayılan YOK)', () => {
  it('SKU yoksa throw: `STK<zaman damgası>` kodu UYDURULMAZ', () => {
    const hata = (() => { try { stokGovdesi({ ...CIMENTO, sku: undefined }, VERGI_TABLOSU); } catch (e) { return e; } })();
    expect(hata).toBeInstanceOf(MikroGovdeHatasi);
    expect((hata as MikroGovdeHatasi).message).toMatch(/stok kodu \(SKU\) bilinmiyor/);
    expect((hata as MikroGovdeHatasi).message).not.toMatch(/STK\d/);
  });

  it('SKU yalnız boşluksa throw (boşluk dolu kod Mikro defterine kart açardı)', () => {
    expect(() => stokGovdesi({ ...CIMENTO, sku: '   ' }, VERGI_TABLOSU)).toThrow(/stok kodu/);
  });

  it('ürün adı yoksa throw — Mikro\'ya isimsiz (\'\') stok kartı gitmez', () => {
    expect(() => stokGovdesi({ ...CIMENTO, name: '' }, VERGI_TABLOSU)).toThrow(/stok adı bilinmiyor/);
  });

  it('birim yoksa throw — sabit \'ADET\' varsayılmaz (çimento TON/KG olabilir)', () => {
    expect(() => stokGovdesi({ ...CIMENTO, unit: undefined }, VERGI_TABLOSU)).toThrow(/birim bilinmiyor/);
  });

  it('KDV oranı bilinmiyorsa throw — sabit 20 yazılmaz (o alan İNDEKS, %20 değil)', () => {
    expect(() => stokGovdesi({ ...CIMENTO, vatRate: undefined }, VERGI_TABLOSU)).toThrow(/KDV oranı bilinmiyor/);
  });

  it('oran Mikro tablosunda yoksa throw (eski %18 kaydı) — en yakın orana YUVARLANMAZ', () => {
    const hata = (() => { try { stokGovdesi({ ...CIMENTO, vatRate: 18 }, VERGI_TABLOSU); } catch (e) { return e; } })();
    expect(hata).toBeInstanceOf(MikroGovdeHatasi);
    expect((hata as MikroGovdeHatasi).message).toMatch(/%18/);
  });

  it('vergi tablosu boşsa (Mikro okunamadı) throw — tahmin edilmez', () => {
    expect(() => stokGovdesi(CIMENTO, new Map())).toThrow(/vergi tablosu/i);
  });

  it('fiyat dövizi TL değilse throw — USD tutarı TL gibi yazılmaz', () => {
    expect(() => stokGovdesi({ ...CIMENTO, priceCurrency: 'USD' }, VERGI_TABLOSU)).toThrow(/döviz/i);
    expect(stokGovdesi({ ...CIMENTO, priceCurrency: 'TRY' }, VERGI_TABLOSU).sto_doviz_cinsi).toBe(0);
  });
});

// Ters aramanın kendi vakaları (yuvarlama yok, en küçük sıra, boş tablo) TEK KAYNAKTA:
// vergiIsaretci.test.ts. Burada yalnız BU gövdenin o kaynağa bağlı olduğu kilitli.
describe('stokGovdesi — vergi işaretçisi tek kaynaktan (vergiIsaretci.ts)', () => {
  it('Mikro tablosu %20 yerine 19,9999999 döndürse de kart kurulur (kesin eşitlik kopyası 400 veriyordu)', () => {
    // Kardeş gövdeler (sipariş/fatura) aynı tabloyla geçiyordu; bu modülün `===`
    // kopyası aynı ürünün stok kartını reddediyordu — hakem bulgusu 2026-09-19.
    expect(stokGovdesi(CIMENTO, new Map([[4, 19.9999999]])).sto_perakende_vergi).toBe(4);
  });

  it('tabloda olmayan oran hâlâ reddedilir — tolerans "en yakına yuvarla" DEĞİL', () => {
    expect(() => stokGovdesi(CIMENTO, new Map([[4, 19.99]]))).toThrow(/vergi işaretçisi/i);
  });
});

// ── Cari ─────────────────────────────────────────────────────────────────────

const SIRIN = {
  company:         'Şirin İnşaat Malzemeleri Ltd. Şti.',
  name:            'Şirin İnşaat',
  taxId:           '1234567890',
  taxOffice:       'Kadıköy',
  email:           'muhasebe@sirininsaat.com.tr',
  phone:           '05321234567',
  address:         'Bağdat Cad. No:12',
  district:        'Kadıköy',
  city:            'İstanbul',
  eFaturaKayitli:  true,
  contactName:     'Ayşe Şirin Demir',
} as Record<string, unknown>;

describe('cariGovdesi — parite', () => {
  it('tam lead: gövde rotadaki eski nesneyle birebir aynı', () => {
    expect(cariGovdesi(SIRIN, 'abc123XYZ')).toEqual({
      cari_kod:               'CARABC123',            // CAR + firebaseId ilk 6, BÜYÜK harf
      cari_unvan1:            'Şirin İnşaat Malzemeleri Ltd. Şti.',
      cari_unvan2:            '',
      cari_vdaire_no:         '1234567890',
      cari_vdaire_adi:        'Kadıköy',
      cari_EMail:             'muhasebe@sirininsaat.com.tr',
      cari_CepTel:            '05321234567',
      cari_efatura_fl:        1,
      cari_def_efatura_cinsi: 0,
      cari_doviz_cinsi1:      0,
      cari_doviz_cinsi2:      255,
      cari_doviz_cinsi3:      255,
      cari_KurHesapSekli:     1,
      cari_sevk_adres_no:     0,
      cari_fatura_adres_no:   0,
      adres: [{
        adr_cadde:          'Bağdat Cad. No:12',
        adr_ilce:           'Kadıköy',
        adr_il:             'İstanbul',
        adr_ulke:           'TÜRKİYE',
        adr_tel_ulke_kodu:  '090',
        adr_tel_bolge_kodu: '',
        adr_tel_no1:        '05321234567',
        adr_posta_kodu:     0,
        yetkili: [{
          mye_isim:         'Ayşe',
          mye_soyisim:      'Şirin Demir',
          mye_email_adres:  'muhasebe@sirininsaat.com.tr',
          mye_cep_telno:    '05321234567',
          mye_dahili_telno: '',
        }],
      }],
    });
  });

  it('mikroCariKod varsa aynen kullanılır — yeni CAR kodu üretilmez', () => {
    expect(cariGovdesi({ ...SIRIN, mikroCariKod: '120.01.0042' }, 'abc123XYZ').cari_kod).toBe('120.01.0042');
  });

  it('PurchasingModule gerçek çağrısı (yalnız ad): THROW ETMEZ, bilinmeyen alanlar boş kalır', () => {
    // src/components/PurchasingModule.tsx:240 → syncSupplierToMikro({ name }, docRef.id)
    const g = cariGovdesi({ name: 'Şirin İnşaat' }, 'sup999ZZ');
    expect(g.cari_kod).toBe('CARSUP999');
    expect(g.cari_unvan1).toBe('Şirin İnşaat');
    expect(g.cari_vdaire_no).toBe('');
    expect(g.cari_EMail).toBe('');
    expect(g.cari_efatura_fl).toBe(0);            // bayrak: bilinmiyorsa "kayıtlı değil" (parite)
    expect(g.adres[0].yetkili).toEqual([]);        // contactName yoksa yetkili dizisi BOŞ
  });

  it('tedarikçi alan adları geriye dönük: taxNo ve vkn de okunur', () => {
    expect(cariGovdesi({ name: 'A', taxNo: '9876543210' }, 'f1').cari_vdaire_no).toBe('9876543210');
    expect(cariGovdesi({ name: 'A', vkn: '5555555555' }, 'f1').cari_vdaire_no).toBe('5555555555');
  });

  it('company yoksa name unvana düşer (rota paritesi)', () => {
    expect(cariGovdesi({ name: 'Şirin İnşaat' }, 'f1').cari_unvan1).toBe('Şirin İnşaat');
  });

  it('tek kelimelik yetkili: soyisim boş kalır, ad UYDURULMAZ', () => {
    const y = cariGovdesi({ ...SIRIN, contactName: 'Ayşe' }, 'f1').adres[0].yetkili;
    expect(y).toEqual([{ mye_isim: 'Ayşe', mye_soyisim: '', mye_email_adres: SIRIN.email, mye_cep_telno: SIRIN.phone, mye_dahili_telno: '' }]);
  });
});

describe('cariGovdesi — zorunlu alanlar (varsayılan YOK)', () => {
  it('unvan (company/name) yoksa throw — Mikro\'ya unvansız (\'\') cari açılmaz', () => {
    expect(() => cariGovdesi({ email: 'a@b.c' }, 'f1')).toThrow(MikroGovdeHatasi);
    expect(() => cariGovdesi({ company: '   ' }, 'f1')).toThrow(/cari unvanı bilinmiyor/);
  });

  it('ne mikroCariKod ne firebaseId varsa throw: `CAR<zaman damgası>` UYDURULMAZ', () => {
    const hata = (() => { try { cariGovdesi(SIRIN); } catch (e) { return e; } })();
    expect(hata).toBeInstanceOf(MikroGovdeHatasi);
    expect((hata as MikroGovdeHatasi).message).toMatch(/cari kodu bilinmiyor/);
    expect((hata as MikroGovdeHatasi).message).not.toMatch(/CAR\d/);
  });

  it('e-fatura bayrağı: yalnız gerçek true 1 yazar (metin "true" sayılmaz)', () => {
    expect(cariGovdesi({ name: 'A', eFaturaKayitli: false }, 'f1').cari_efatura_fl).toBe(0);
    expect(cariGovdesi({ name: 'A', eFaturaKayitli: true }, 'f1').cari_efatura_fl).toBe(1);
  });
});

/* MUTASYON KANITI — hepsi GERÇEKTEN koşuldu ve geri alındı (iddia yazılmadı, ölçüldü):
 *  - `sto_perakende_vergi: isaretci` → `20` (rotadaki eski sabit): 3 test kırıldı
 *    ("parite", "%10 ürün", "%0 ürün").
 *  - fiyat kapıları eski `Number(ham) || 0` + filtresiz hâle çevrildi: 7 test kırıldı
 *    (₺0/₺1 satırları geri geldi, "hiçbir kademe yoksa throw" da sustu).
 *  - NOT: tek başına `bilenSayi` kapısını `Number(ham)`e çevirmek çoğu vakada `> 0` filtresiyle
 *    örtülür; ayırt eden vaka `prices: { Retail: true }` (`Number(true) === 1` → sahte ₺1 satırı).
 *  - `sto_birim1_ad` throw'unu `urun.unit ?? 'ADET'` yaparsan: "birim yoksa throw" kırılır.
 *  - `sto_kod` throw'unu `|| \`STK${Date.now()}\`` yaparsan: "SKU yoksa throw" kırılır.
 */
