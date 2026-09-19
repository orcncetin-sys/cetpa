/**
 * govdeSiparis.test.ts — SiparisKaydetV2 gövdesi. ÖNCE YAZILDI (Faz 3 3/n, 2026-09-19).
 *
 * Kilitlenen sözleşme: Mikro'ya YAZAN gövdede varsayılan YOKTUR. Eski rota
 * (mikroRoutes.ts:509-519) beş ayrı yerde uyduruyordu —
 *   sip_b_fiyat: price || 0 · sip_miktar: quantity || 1 · sip_tutar: (||0)*(||1)
 *   sip_vergi_pntr: 4 (sabit "%20 KDV") · sip_depono: 1 (HAVALİMANI)
 * — ve hepsi Mikro defterinde GEÇERLİ GÖRÜNEN sahte kayıt üretiyordu. Buradaki
 * her "throw" testi o sitelerden birini ölçer: kapıyı `?? 0` / `|| 1` / sabit 4
 * yapan bir mutasyon EN AZ bir testi kırmak zorundadır.
 */
import { describe, it, expect } from 'vitest';
import { siparisGovdesi, mikroTarih } from './govdeSiparis';
import { MikroGovdeHatasi } from './govdeHatasi';

/** Mikro VergiListesiV2'nin canlıdaki hâli: sıra→oran (mikroClient.mikroVergiOranlari). */
const VERGI = new Map<number, number>([[1, 0], [2, 1], [3, 10], [4, 20]]);

/** 14.09.2026 10:30 — YEREL kurulur; testin makine saat dilimine bağlı kalmaması için. */
const TARIH = new Date(2026, 8, 14, 10, 30, 0);

/** Şirin İnşaat'ın iki kalemli çimento+demir siparişi (bilinen, eksiksiz girdi). */
function siparis(ek?: Record<string, unknown>): Record<string, unknown> {
  return {
    customerName: 'Şirin İnşaat Ltd. Şti.',
    mikroCariKod: '120 01 0042',
    createdAt: TARIH,
    depoNo: 2,
    lineItems: [
      { sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 3, price: 250, vatRate: 20 },
      { sku: 'DMR-12', name: 'NERVÜRLÜ DEMİR 12MM', quantity: 1.5, unitPrice: 1840.75, total: 2761.13, vatRate: 10 },
    ],
    ...ek,
  };
}

/** Tek kalemli sipariş — kalem alanlarını tek tek bozmak için. */
function tekKalem(kalem: Record<string, unknown>, ek?: Record<string, unknown>): Record<string, unknown> {
  return siparis({ lineItems: [kalem], ...ek });
}

describe('siparisGovdesi — parite', () => {
  it('bilinen girdide gövde eski rotayla BİREBİR aynı (alan adları, sıra, sabitler)', () => {
    const { satirlar } = siparisGovdesi(siparis(), { vergiTablosu: VERGI });
    expect(satirlar).toEqual([
      {
        sip_tarih: '14.09.2026',
        sip_tip: '0',              // '0' = SATIŞ (2026-08-22 denetim bulgusu C14) — '1' ALIŞ'tır
        sip_cins: '0',
        sip_evrakno_seri: 'T',
        sip_musteri_kod: '120 01 0042',
        sip_stok_kod: 'CIM-50',
        sip_b_fiyat: 250,
        sip_miktar: 3,
        sip_tutar: 750,            // total yok → fiyat × miktar (para.ts satirTutari)
        sip_vergi_pntr: 4,         // %20 → sıra 4; eskiden SABİT 4 idi, burada TABLODAN geliyor
        sip_depono: 2,             // eskiden SABİT 1 (HAVALİMANI) idi
        sip_vergisiz_fl: false,
      },
      {
        sip_tarih: '14.09.2026',
        sip_tip: '0',
        sip_cins: '0',
        sip_evrakno_seri: 'T',
        sip_musteri_kod: '120 01 0042',
        sip_stok_kod: 'DMR-12',
        sip_b_fiyat: 1840.75,      // unitPrice, price'tan önce gelir (eski `unitPrice || price`)
        sip_miktar: 1.5,
        sip_tutar: 2761.13,        // kalemde total varsa o kullanılır (eski `total || ...`)
        sip_vergi_pntr: 3,         // %10 → sıra 3. SABİT 4 olsaydı bu satır %20 yazardı
        sip_depono: 2,
        sip_vergisiz_fl: false,
      },
    ]);
  });

  it('gövde V17 evrak kalıbıyla sarılır: { evraklar: [{ satirlar }] }', () => {
    const { satirlar, govde } = siparisGovdesi(siparis(), { vergiTablosu: VERGI });
    expect(govde).toEqual({ evraklar: [{ satirlar }] });
    expect(govde.evraklar[0].satirlar).toBe(satirlar); // ayna (mikro_siparisler) aynı diziyi yazar
  });

  it('kalem sırası korunur', () => {
    const { satirlar } = siparisGovdesi(siparis(), { vergiTablosu: VERGI });
    expect(satirlar.map(s => s.sip_stok_kod)).toEqual(['CIM-50', 'DMR-12']);
  });
});

describe('siparisGovdesi — fiyat (eski: price || 0)', () => {
  it('fiyat bilinmiyorsa MikroGovdeHatasi — 0 TL yazılmaz', () => {
    const cagir = () => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 3, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(cagir).toThrow(MikroGovdeHatasi);
    expect(cagir).toThrow("Mikro'ya gönderilemedi: 1. kalemin birim fiyatı bilinmiyor");
  });

  it('fiyat null/boş/metin ise de hata (eski kod hepsini 0 yapıyordu)', () => {
    for (const bozuk of [null, undefined, '', 'bedava', Number.NaN, Infinity]) {
      expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: bozuk, vatRate: 20 }), { vergiTablosu: VERGI }))
        .toThrow(MikroGovdeHatasi);
    }
  });

  it('BİLİNEN sıfır fiyat geçerlidir (promosyon kalemi) — hata değil', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 2, price: 0, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_b_fiyat).toBe(0);
    expect(satirlar[0].sip_tutar).toBe(0);
  });

  it('negatif fiyat gövdeye girmez', () => {
    expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: -5, vatRate: 20 }), { vergiTablosu: VERGI }))
      .toThrow("Mikro'ya gönderilemedi: 1. kalemin birim fiyatı bilinmiyor (fiyat negatif)");
  });

  it('sayısal metin fiyat kabul edilir (istemci formu string gönderebiliyor)', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: '4', price: '125.5', vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_b_fiyat).toBe(125.5);
    expect(satirlar[0].sip_miktar).toBe(4);
    expect(satirlar[0].sip_tutar).toBe(502);
  });

  it('unitPrice bilinmiyorsa price devreye girer', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, unitPrice: null, price: 310, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_b_fiyat).toBe(310);
  });
});

describe('siparisGovdesi — miktar (eski: quantity || 1)', () => {
  it('miktar bilinmiyorsa MikroGovdeHatasi — 1 adet yazılmaz', () => {
    const cagir = () => siparisGovdesi(tekKalem({ sku: 'CIM-50', price: 250, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(cagir).toThrow(MikroGovdeHatasi);
    expect(cagir).toThrow("Mikro'ya gönderilemedi: 1. kalemin miktarı bilinmiyor");
  });

  it('miktar 0 ise hata — eski kod `0 || 1` ile SESSİZCE 1 adet yazıyordu', () => {
    expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', price: 250, quantity: 0, vatRate: 20 }), { vergiTablosu: VERGI }))
      .toThrow("Mikro'ya gönderilemedi: 1. kalemin miktarı bilinmiyor (miktar 0 veya negatif)");
  });

  it('negatif miktar da gövdeye girmez', () => {
    expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', price: 250, quantity: -2, vatRate: 20 }), { vergiTablosu: VERGI }))
      .toThrow(MikroGovdeHatasi);
  });

  it('hata İLK bozuk kalemi 1-tabanlı sırasıyla bildirir', () => {
    const s = siparis({
      lineItems: [
        { sku: 'CIM-50', quantity: 3, price: 250, vatRate: 20 },
        { sku: 'DMR-12', quantity: 2, price: 1840, vatRate: 20 },
        { sku: 'KUM-01', price: 90, vatRate: 20 },   // miktar yok
      ],
    });
    expect(() => siparisGovdesi(s, { vergiTablosu: VERGI }))
      .toThrow("Mikro'ya gönderilemedi: 3. kalemin miktarı bilinmiyor");
  });
});

describe('siparisGovdesi — tutar (eski: total || fiyat*miktar, ikisi de ||0/||1 ile)', () => {
  it('total yoksa fiyat × miktar', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 7, price: 250, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tutar).toBe(1750);
  });

  it('total 0 / bilinmiyorsa fiyat × miktar (0 TL satır yazılmaz)', () => {
    for (const bozuk of [0, null, '', 'yok']) {
      const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 2, price: 100, total: bozuk, vatRate: 20 }), { vergiTablosu: VERGI });
      expect(satirlar[0].sip_tutar).toBe(200);
    }
  });

  it('bilinen pozitif total fiyat × miktara TERCİH edilir (satır iskontosu eski rotada da böyleydi)', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 2, price: 100, total: 180, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tutar).toBe(180);
  });
});

describe('siparisGovdesi — vergi işaretçisi (eski: sabit 4)', () => {
  it('KDV oranı tablodan TERS aramayla işaretçiye çevrilir', () => {
    const oranlar: Array<[number, number]> = [[0, 1], [1, 2], [10, 3], [20, 4]];
    for (const [oran, sira] of oranlar) {
      const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: 100, vatRate: oran }), { vergiTablosu: VERGI });
      expect(satirlar[0].sip_vergi_pntr).toBe(sira);
    }
  });

  it('kalemde oran yoksa siparişin kdvOran başlığı kullanılır', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: 100 }, { kdvOran: 10 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_vergi_pntr).toBe(3);
  });

  it('hiçbir yerde KDV oranı yoksa hata — %20 VARSAYILMAZ', () => {
    const cagir = () => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: 100 }), { vergiTablosu: VERGI });
    expect(cagir).toThrow(MikroGovdeHatasi);
    expect(cagir).toThrow("Mikro'ya gönderilemedi: 1. kalemin KDV oranı bilinmiyor");
  });

  it('tabloda karşılığı olmayan oran (%18) hata verir — en yakına yuvarlanmaz', () => {
    expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: 100, vatRate: 18 }), { vergiTablosu: VERGI }))
      .toThrow("Mikro'ya gönderilemedi: 1. kalemin vergi işaretçisi bilinmiyor (KDV %18 Mikro vergi tablosunda yok)");
  });

  it('vergi tablosu BOŞSA (VergiListesiV2 okunamadı) sessizce 4 yazılmaz', () => {
    expect(() => siparisGovdesi(siparis(), { vergiTablosu: new Map() }))
      .toThrow("Mikro'ya gönderilemedi: 1. kalemin vergi işaretçisi bilinmiyor (Mikro vergi tablosu okunamadı — VergiListesiV2)");
  });

  it('ESKİ VERİ TUZAĞI: vatRate işaretçi (4) olarak kalmışsa %4 diye eşleşmez, hata verir', () => {
    // 2026-07-31 öncesi envantere `vatRate: 4` (=sıra) yazılıyordu; %4 diye okunup
    // tabloda karşılığı aranırsa hiçbir sıra bulunmaz — sessiz yanlış KDV yerine hata.
    expect(() => siparisGovdesi(tekKalem({ sku: 'CIM-50', quantity: 1, price: 100, vatRate: 4 }), { vergiTablosu: VERGI }))
      .toThrow(/vergi işaretçisi bilinmiyor \(KDV %4 /);
  });
});

// Ters aramanın kendi vakaları TEK KAYNAKTA: vergiIsaretci.test.ts. Burada yalnız
// bu gövdenin o kaynağa bağlı olduğu ve toleransın kardeş gövdelerle AYNI olduğu kilitli.
describe('siparisGovdesi — vergi işaretçisi tek kaynaktan (vergiIsaretci.ts)', () => {
  it('kayan nokta gürültüsü (%20 = 19,9999999) sipariş satırında da eşleşir', () => {
    const { satirlar } = siparisGovdesi(
      tekKalem({ sku: 'CIM-50', quantity: 1, price: 100, vatRate: 20 }),
      { vergiTablosu: new Map([[4, 19.9999999]]) },
    );
    expect(satirlar[0].sip_vergi_pntr).toBe(4);
  });

  it('gerçekten farklı oran (%19,99) hâlâ reddedilir — tolerans yuvarlama değildir', () => {
    expect(() => siparisGovdesi(
      tekKalem({ sku: 'CIM-50', quantity: 1, price: 100, vatRate: 20 }),
      { vergiTablosu: new Map([[4, 19.99]]) },
    )).toThrow(/vergi işaretçisi bilinmiyor/);
  });
});

describe('siparisGovdesi — stok kodu ve cari kodu (eski: || \'\')', () => {
  it('sku yoksa productId kullanılır', () => {
    const { satirlar } = siparisGovdesi(tekKalem({ productId: 'urn-9912', quantity: 1, price: 100, vatRate: 20 }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_stok_kod).toBe('urn-9912');
  });

  it('ikisi de yoksa hata — Mikro\'ya stok kodsuz satır yazılmaz', () => {
    expect(() => siparisGovdesi(tekKalem({ quantity: 1, price: 100, vatRate: 20 }), { vergiTablosu: VERGI }))
      .toThrow("Mikro'ya gönderilemedi: 1. kalemin stok kodu bilinmiyor");
  });

  it('yalnız boşluktan oluşan stok kodu da yok sayılır', () => {
    expect(() => siparisGovdesi(tekKalem({ sku: '   ', quantity: 1, price: 100, vatRate: 20 }), { vergiTablosu: VERGI }))
      .toThrow(MikroGovdeHatasi);
  });

  it('cari kod yoksa hata — satır numarası UYDURULMAZ (belge başlığı alanı)', () => {
    const cagir = () => siparisGovdesi(siparis({ mikroCariKod: undefined }), { vergiTablosu: VERGI });
    expect(cagir).toThrow("Mikro'ya gönderilemedi: müşteri cari kodu bilinmiyor (sipariş bir Mikro carisine bağlanmamış — önce cariyi eşleştirin)");
    expect(cagir).not.toThrow(/kalem/);
  });
});

describe('siparisGovdesi — depo (eski: sabit 1 = HAVALİMANI)', () => {
  it('siparişin deposu gövdeye aynen geçer', () => {
    const { satirlar } = siparisGovdesi(siparis({ depoNo: 3 }), { vergiTablosu: VERGI });
    expect(satirlar.every(s => s.sip_depono === 3)).toBe(true);
  });

  it('seçenekteki depo siparişin alanını EZER (rota kiracı ayarından çözebilsin)', () => {
    const { satirlar } = siparisGovdesi(siparis({ depoNo: 3 }), { vergiTablosu: VERGI, depoNo: 5 });
    expect(satirlar[0].sip_depono).toBe(5);
  });

  it('depo bilinmiyorsa hata — 1 (HAVALİMANI) varsayılmaz', () => {
    const cagir = () => siparisGovdesi(siparis({ depoNo: undefined }), { vergiTablosu: VERGI });
    expect(cagir).toThrow(MikroGovdeHatasi);
    expect(cagir).toThrow(/depo numarası bilinmiyor/);
  });

  it('0, negatif ve ondalıklı depo numarası reddedilir', () => {
    for (const bozuk of [0, -1, 2.5, 'depo 2']) {
      expect(() => siparisGovdesi(siparis({ depoNo: bozuk }), { vergiTablosu: VERGI })).toThrow(MikroGovdeHatasi);
    }
  });

  it('sayısal metin depo kabul edilir ("2" → 2)', () => {
    const { satirlar } = siparisGovdesi(siparis({ depoNo: '2' }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_depono).toBe(2);
  });
});

describe('siparisGovdesi — tarih', () => {
  it('dd.MM.yyyy, tek haneli gün/ay sıfırla doldurulur', () => {
    const { satirlar } = siparisGovdesi(siparis({ createdAt: new Date(2026, 0, 5, 9, 0) }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tarih).toBe('05.01.2026');
  });

  it('Timestamp zarfı ({ seconds }) çözülür — eski kod "NaN.NaN.NaN" yazıyordu', () => {
    const sn = Math.floor(new Date(2026, 8, 14, 10, 30).getTime() / 1000);
    const { satirlar } = siparisGovdesi(siparis({ createdAt: { seconds: sn, nanoseconds: 0 } }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tarih).toBe('14.09.2026');
  });

  it('tarih-only string YEREL gün olarak okunur (UTC kayması gün atlatmaz)', () => {
    const { satirlar } = siparisGovdesi(siparis({ createdAt: '2026-09-14' }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tarih).toBe('14.09.2026');
  });

  it('çözülemeyen tarih hata verir — "NaN.NaN.NaN" Mikro\'ya gitmez', () => {
    const cagir = () => siparisGovdesi(siparis({ createdAt: 'geçen hafta' }), { vergiTablosu: VERGI });
    expect(cagir).toThrow(MikroGovdeHatasi);
    expect(cagir).toThrow(/sipariş tarihi bilinmiyor/);
  });

  it('tarih hiç yoksa push anı kullanılır (eski rotayla aynı davranış)', () => {
    const { satirlar } = siparisGovdesi(siparis({ createdAt: undefined }), { vergiTablosu: VERGI, simdi: new Date(2026, 11, 31, 23, 59) });
    expect(satirlar[0].sip_tarih).toBe('31.12.2026');
  });
});

describe('mikroTarih', () => {
  it('Date → dd.MM.yyyy', () => {
    expect(mikroTarih(new Date(2026, 8, 14))).toBe('14.09.2026');
  });
  it('çözülemeyen değer → null (çağıran karar verir)', () => {
    expect(mikroTarih('abc')).toBeNull();
    expect(mikroTarih(null)).toBeNull();
    expect(mikroTarih({})).toBeNull();
  });
});

describe('siparisGovdesi — kalem listesi', () => {
  it('kalemsiz sipariş gövde kurmaz', () => {
    expect(() => siparisGovdesi(siparis({ lineItems: [] }), { vergiTablosu: VERGI })).toThrow(MikroGovdeHatasi);
    expect(() => siparisGovdesi(siparis({ lineItems: undefined }), { vergiTablosu: VERGI })).toThrow(MikroGovdeHatasi);
  });

  it('lineItems dizi değilse gövde kurmaz', () => {
    expect(() => siparisGovdesi(siparis({ lineItems: { sku: 'CIM-50' } }), { vergiTablosu: VERGI })).toThrow(MikroGovdeHatasi);
  });

  it('kalem nesne değilse o kalemin sırasıyla hata verir', () => {
    expect(() => siparisGovdesi(siparis({ lineItems: [null] }), { vergiTablosu: VERGI })).toThrow(/1\. kalem/);
  });
});

// 2026-09-19: kesirli miktar satır tutarını kuruş-altına taşıyor. Fatura/irsaliye gövdesi yuvarlanmıştı, SİPARİŞ gövdesi
// ham `satirTutari` gönderiyordu (yarım düzeltme — para.ts `kurusaYuvarla` başlığı `sip_tutar`ı da sayıyor).
describe('siparisGovdesi — KESİRLİ miktarda sip_tutar KURUŞA yuvarlanır', () => {
  it('2,5 × 175,07 → 437,68 (ham 437,67499… gitmez) — mutasyon-ayırt-edici', () => {
    const { satirlar } = siparisGovdesi(siparis({ lineItems: [{ sku: 'BRD-8', name: 'BORDÜR 8cm', quantity: 2.5, price: 175.07, vatRate: 20 }] }), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_miktar).toBe(2.5);
    expect(satirlar[0].sip_tutar).toBe(437.68);
  });
  it('tam sayılı miktarda değer DEĞİŞMEZ', () => {
    const { satirlar } = siparisGovdesi(siparis(), { vergiTablosu: VERGI });
    expect(satirlar[0].sip_tutar).toBe(750);
  });
});

