/**
 * mikroBirlesim.test.ts — ÖNCE YAZILDI (Faz 3 5/n, grup "mikroBirlesim", 2026-09-19).
 *
 * İki sınıf vaka var ve etiketleri bilerek ayrı:
 *   • [PARİTE]  — bilinen girdide sayı DashboardPage'in bugünkü davranışıyla BİREBİR aynı.
 *   • [MUTASYON] — kapıyı `|| 0` / `?? 0` yapan bir mutasyon bu vakayı KIRAR.
 */
import { describe, it, expect } from 'vitest';
import { siparisTutari } from '../siparis';
import {
  mikroSiparisTutari,
  mikroSiparisindenPanoSiparisi,
  mikroFaturadanPanoSiparisi,
  panoMikroSiparisleri,
  panoSiparisleri,
  panoCirosu,
  type PanoMikroSiparis,
  type PanoMikroFatura,
} from './mikroBirlesim';

// ── Türkçe fikstürler ────────────────────────────────────────────────────────
/** Mikro SIPARISLER satırı (mikroSiparisler dokümanı: `SELECT *` ham kolonlarıyla yazılır). */
const ms = (o: Partial<PanoMikroSiparis> = {}): PanoMikroSiparis => ({
  id: 'sip-1',
  evrakNo: 'T9001',
  cariKodu: '120-SIRIN',
  tarih: '2026-09-10',
  tip: 0,                       // 0 = Alınan (satış)
  sip_tutar: 48_250.75,         // ₺48.250,75 — ÇİMENTO 50KG × 355
  ...o,
});

/** useMikroFaturalar'ın normalize ettiği fatura (tutar NaN = BİLİNMİYOR). */
const mf = (o: Partial<PanoMikroFatura> = {}): PanoMikroFatura => ({
  id: 'fat-1',
  faturaNo: '-321',
  cariKod: '120-SIRIN',
  tarih: '2026-09-10',
  tutar: 21_600,                // canlı doğrulanmış fatura 321: 18.000 matrah + 3.600 KDV
  yon: 'giden',
  ...o,
});

describe('mikroSiparisTutari — HAM sip_tutar kolonu, hook sahte sıfırı DEĞİL', () => {
  it('[PARİTE] bilinen tutar aynen okunur (sayısal string dahil)', () => {
    expect(mikroSiparisTutari(ms())).toBe(48_250.75);
    expect(mikroSiparisTutari(ms({ sip_tutar: '48250.75' }))).toBe(48_250.75);
  });

  it('[MUTASYON] sip_tutar NULL → BİLİNMİYOR (NaN); hook alanındaki `tutar: 0` KANIT SAYILMAZ', () => {
    // useMikroSiparisler `tutar: Number(d.sip_tutar || 0)` üretir: okunamayan tutar
    // "bilinen ₺0" olarak nesnede durur. Modül ham kolona bakar, o türetmeye DEĞİL.
    const kayit = { ...ms({ sip_tutar: null }), tutar: 0 } as PanoMikroSiparis & { tutar: number };
    expect(mikroSiparisTutari(kayit)).toBeNaN();
  });

  it('[MUTASYON] sip_tutar hiç yok / boş metin / metin → NaN', () => {
    expect(mikroSiparisTutari(ms({ sip_tutar: undefined }))).toBeNaN();
    expect(mikroSiparisTutari(ms({ sip_tutar: '' }))).toBeNaN();
    expect(mikroSiparisTutari(ms({ sip_tutar: 'okunamadı' }))).toBeNaN();
  });

  it('[PARİTE] MEŞRU ₺0 sipariş 0 KALIR — bilinmeyene düşmez', () => {
    expect(mikroSiparisTutari(ms({ sip_tutar: 0 }))).toBe(0);
  });
});

describe('mikroSiparisindenPanoSiparisi — Mikro siparişi → pano siparişi', () => {
  it('[PARİTE] alanlar DashboardPage eşlemesiyle birebir', () => {
    const s = mikroSiparisindenPanoSiparisi(ms());
    expect(s).toMatchObject({
      id: 'sip-1',
      orderNumber: 'T9001',
      customerName: '120-SIRIN',
      totalPrice: 48_250.75,
      status: 'Pending',
      // syncedAt = MİKRO'NUN TARİHİ, bugün DEĞİL (Faz 1 3/n)
      createdAt: '2026-09-10',
      syncedAt: '2026-09-10',
      source: 'mikro-siparis',
    });
    expect(siparisTutari(s)).toBe(48_250.75);
  });

  it('[MUTASYON] tutarı okunamayan sipariş `totalPrice` ALANI OLMADAN eşlenir → siparisTutari NaN', () => {
    const s = mikroSiparisindenPanoSiparisi(ms({ sip_tutar: null }));
    expect('totalPrice' in s).toBe(false);
    expect(siparisTutari(s)).toBeNaN();
    // `?? 0` mutasyonu burada 0 döndürür ve "bedava sipariş" iddiası üretir.
  });

  it('[PARİTE] meşru ₺0 siparişte alan YAZILIR (0 bilinen değerdir)', () => {
    const s = mikroSiparisindenPanoSiparisi(ms({ sip_tutar: 0 }));
    expect(s.totalPrice).toBe(0);
    expect(siparisTutari(s)).toBe(0);
  });

  it('[PARİTE] evrak no / cari kodu okunamazsa boş metin (eski `|| \'\'` davranışı)', () => {
    const s = mikroSiparisindenPanoSiparisi(ms({ evrakNo: undefined, cariKodu: null }));
    expect(s.orderNumber).toBe('');
    expect(s.customerName).toBe('');
  });
});

describe('panoMikroSiparisleri — yalnız ALINAN (satış) siparişleri', () => {
  it('[PARİTE] tip 0 girer, tip 1 (verilen/alış) GİRMEZ', () => {
    const liste = panoMikroSiparisleri([
      ms({ id: 'a', tip: 0 }),
      ms({ id: 'b', tip: 1 }),
      ms({ id: 'c', tip: 0 }),
    ]);
    expect(liste.map(s => s.id)).toEqual(['a', 'c']);
  });

  it('[PARİTE] sayısal string tip (`sip_tip` aynada TEXT) satış sayılır', () => {
    expect(panoMikroSiparisleri([ms({ id: 'a', tip: '0' })]).map(s => s.id)).toEqual(['a']);
  });

  it('[PARİTE] tipi okunamayan kayıt BUGÜNKÜ gibi satış sayılır (birleşim kuralı değişmedi — Açık İş)', () => {
    // useMikroSiparisler `tip: Number(d.sip_tip || 0)` ile NULL tipi 0'a indirir ve sayfa onu
    // satış sayar. Bu bir SINIFLANDIRMA varsayımı; kaldırmak üç ekranın listesini birden
    // değiştirir (Dashboard, OrdersPage, PurchasingModule) → bu turun kapsamı dışında.
    const tipsiz: PanoMikroSiparis & { tutar: number } = { ...ms({ id: 'a', tip: null }), tutar: 0 };
    expect(panoMikroSiparisleri([tipsiz]).map(s => s.id)).toEqual(['a']);
  });
});

describe('mikroFaturadanPanoSiparisi — Mikro satış faturası → pano siparişi', () => {
  it('[PARİTE] bilinen tutar totalPrice olur; kimlik/etiket alanları dolu', () => {
    const s = mikroFaturadanPanoSiparisi(mf());
    expect(s).toMatchObject({
      id: 'fat-1',
      orderNumber: 'MF--321',
      customerName: '120-SIRIN',
      totalPrice: 21_600,
      status: 'Delivered',
      source: 'mikro-fatura',
      orderDate: '2026-09-10',
    });
    expect(siparisTutari(s)).toBe(21_600);
  });

  it('[MUTASYON] hook NaN verdiğinde (`cha_meblag` okunamadı) totalPrice ALANI YAZILMAZ', () => {
    const s = mikroFaturadanPanoSiparisi(mf({ tutar: NaN }));
    expect('totalPrice' in s).toBe(false);
    expect(siparisTutari(s)).toBeNaN();
  });

  it('[PARİTE] istisna/ihracat ₺0 faturası 0 KALIR', () => {
    expect(mikroFaturadanPanoSiparisi(mf({ tutar: 0 })).totalPrice).toBe(0);
  });
});

describe('panoSiparisleri — ADDITIVE birleşim (EKLE, YERİNE KOYMA)', () => {
  const native = [
    { id: 'n1', customerName: 'Şirin İnşaat', totalPrice: 12_000 },
    { id: 'n2', customerName: 'Çelik Yapı', totalPrice: 8_500 },
  ];

  it('[PARİTE] native önce, Mikro sonra; hiçbir kayıt düşmez', () => {
    const mikro = panoMikroSiparisleri([ms({ id: 'sip-1' }), ms({ id: 'sip-2' })]);
    const hepsi = panoSiparisleri(native, mikro);
    expect(hepsi.map(o => o.id)).toEqual(['n1', 'n2', 'sip-1', 'sip-2']);
  });

  it('[PARİTE] boş Mikro listesi native listeyi AYNEN döndürür', () => {
    expect(panoSiparisleri(native, []).map(o => o.id)).toEqual(['n1', 'n2']);
  });

  it('aynı id iki listede de varsa TEK satır kalır (mükerrer satır / React key çakışması yok) ve o MİKRO satırıdır', () => {
    // Çakışmanın bilinen tek yolu HAYALET: Siparişler → Mikro sekmesinden yazım `orders/sip-1` doğuruyordu.
    const hayaletli = [...native, { id: 'sip-1', status: 'Processing' }];
    const mikro = panoMikroSiparisleri([ms({ id: 'sip-1' }), ms({ id: 'sip-2' })]);
    const hepsi = panoSiparisleri(hayaletli, mikro);
    expect(hepsi.map(o => o.id)).toEqual(['n1', 'n2', 'sip-1', 'sip-2']);
    expect((hepsi[2] as { source?: string }).source).toBe('mikro-siparis');
  });

  it('[SON İNCELEME] ADI OLAN hayalet de atılır — düzenleme kaydı hayalete customerName/totalPrice yazar', () => {
    // İlk kural "müşteri adı yoksa hayalettir" diyordu; bu biçim "gerçek native" sayılıp Mikro satırını atıyordu.
    const duzenlemeHayaleti = [...native, { id: 'sip-1', customerName: '120.01.001', totalPrice: 1500 }];
    const hepsi = panoSiparisleri(duzenlemeHayaleti, panoMikroSiparisleri([ms({ id: 'sip-1' })]));
    expect(hepsi.map(o => o.id)).toEqual(['n1', 'n2', 'sip-1']);
    expect((hepsi[2] as { source?: string }).source).toBe('mikro-siparis');
  });

  it('Mikro karşılığı OLMAYAN native kayıt atılmaz (kural yalnız id çakışmasında çalışır)', () => {
    expect(panoSiparisleri([{ id: 'n9' }], panoMikroSiparisleri([ms({ id: 'sip-1' })])).map(o => o.id)).toEqual(['n9', 'sip-1']);
  });
});

describe('panoCirosu — native sipariş + Mikro faturası (çift sayım korumalı)', () => {
  it('[PARİTE] bilinen girdide toplam eskiyle birebir', () => {
    const ciro = panoCirosu(
      [{ totalPrice: 12_000 }, { totalAmount: 8_500 }],
      [mf({ tutar: 21_600 }), mf({ id: 'fat-2', tutar: 13_062 })],
    );
    expect(ciro.ekran).toBe(12_000 + 8_500 + 21_600 + 13_062);
    expect(ciro.tutar.bilinmeyen).toBe(0);
    expect(ciro.native.toplam).toBe(20_500);
    expect(ciro.mikro.toplam).toBe(34_662);
  });

  it('[PARİTE] ÇİFT SAYIM: source Mikro türevi olan native sipariş ciroya GİRMEZ', () => {
    const ciro = panoCirosu(
      [
        { totalPrice: 12_000 },
        { totalPrice: 21_600, source: 'mikro-fatura' },   // aynı fatura zaten mikro tarafında
        { totalPrice: 5_000, source: 'mikro-siparis' },
      ],
      [mf({ tutar: 21_600 })],
    );
    expect(ciro.ekran).toBe(12_000 + 21_600);
    expect(ciro.native.bilinen).toBe(1);
    expect(ciro.native.bilinmeyen).toBe(0);   // dışlanan kayıt "tutarsız" diye de SAYILMAZ
  });

  it('[PARİTE] GELEN (alış) faturası ciroya girmez', () => {
    const ciro = panoCirosu([], [mf({ tutar: 21_600, yon: 'gelen' }), mf({ id: 'f2', tutar: 1_000, yon: 'giden' })]);
    expect(ciro.ekran).toBe(1_000);
    expect(ciro.tutar.bilinmeyen).toBe(0);    // dışlanan alış faturası sayaca da girmez
  });

  it('[MUTASYON] tutarı okunamayan kayıt 0 SAYILMAZ, SAYILIR — toplam KISMİ kalır', () => {
    const ciro = panoCirosu(
      [{ totalPrice: 12_000 }, { totalPrice: null }],
      [mf({ tutar: 21_600 }), mf({ id: 'fat-2', tutar: NaN })],
    );
    expect(ciro.ekran).toBe(33_600);          // `|| 0` mutasyonunda da 33.600 çıkar…
    expect(ciro.tutar.bilinmeyen).toBe(2);    // …ama sayaç 0'a düşer: not ekrandan kaybolur
    expect(ciro.tutar.bilinen).toBe(2);
  });

  it('[MUTASYON] HİÇ bilinen yokken toplam NaN → ekranda "—" (₺0 DEĞİL)', () => {
    const ciro = panoCirosu([{ totalPrice: undefined }], [mf({ tutar: NaN })]);
    expect(ciro.ekran).toBeNaN();
    expect(ciro.tutar.bilinmeyen).toBe(2);
  });

  it('[PARİTE] iki liste de boşsa GERÇEK ₺0 (hareketsiz dönem) — NaN değil', () => {
    const ciro = panoCirosu([], []);
    expect(ciro.ekran).toBe(0);
    expect(ciro.tutar.bilinmeyen).toBe(0);
  });

  it('[PARİTE] sparkline günü: gün süzgeci çağıranda, kural burada (7 günlük şerit ile aynı hesap)', () => {
    const gun = panoCirosu(
      [{ totalPrice: 3_400 }],
      [mf({ tutar: 1_600 })],
    );
    expect(gun.ekran).toBe(5_000);
  });
});
