/**
 * kapsamNotu.test.ts — "N kayıt tutarsız" notunun TEK metni (Faz 3 6a, grup "kapsam-notu",
 * 2026-09-19). ÖNCE YAZILDI.
 *
 * NEDEN VAR — EKRAN sözleşmesi (para.ts `ekranTutari`): kısmi toplam basılıyorsa yanında
 * "neyin dışarıda kaldığı" notu ZORUNLU. Bugün bu not her panelde satır içi iki dilli metin
 * olarak yeniden yazılıyor (GenelOzet:37–46, RaporlarPage:398–404 / :509–515, FinancePanel:348–349…);
 * 6/n boyunca ~110 kopya metin + ~110 ayrı "0 iken basma" koşulu oluşacaktı.
 *
 * DOĞRULAYICI BULGUSU (bu modülün asıl yaması) — KARIŞIK BİRİM: eski satır içi notlar birimi
 * ÇAĞRI başına tekil alıyordu; P619/P148 tek çağrıda `miktarsiz` (ÜRÜN) + `eslesmeyen` (KALEM) +
 * `kalemsiz`/`tarihsiz` (SİPARİŞ) geçirip `birim: 'kalem'` veriyordu → "2 kalemin tarihi çözülemedi"
 * gibi YANLIŞ cümle. Not dürüstlük için var; yanlış birim = yanlış bilgi. Bu yüzden birim
 * SAYACIN özelliğidir, çağrının değil (test 9/10/11 bunu kilitler).
 *
 * PARİTE: cümle kalıpları canlıdaki metinlerle birebir — TR `RaporlarPage:513`
 * "N siparişin tutarı okunamadı", EN `RaporlarPage:514` "N order(s) have an unreadable amount".
 */
import { describe, it, expect } from 'vitest';
import { kapsamNotu, type KapsamSayaclari } from './kapsamNotu';

describe('kapsamNotu — parite ve sonuç eki', () => {
  it('PARİTE: tek sayaç + sonuç, canlıdaki cümlenin birebir aynısı', () => {
    // Şirin İnşaat'ın 3 siparişinde tutar okunamadı → ciro kısmi toplam.
    expect(kapsamNotu({ tutarsiz: 3 }, { birim: 'siparis', sonuc: 'toplama dâhil değil' }))
      .toBe('3 siparişin tutarı okunamadı — toplama dâhil değil');
  });

  it('`sonuc` BİR KEZ ve EN SONDA; sayaç cümleleri " · " ile', () => {
    expect(kapsamNotu({ tutarsiz: 3, tarihsiz: 2 }, { sonuc: 'dağılıma dâhil değil' }))
      .toBe('3 siparişin tutarı okunamadı · 2 siparişin tarihi çözülemedi — dağılıma dâhil değil');
  });

  it('hiç sayaç yokken `sonuc` TEK BAŞINA basılmaz', () => {
    expect(kapsamNotu({ tutarsiz: 0 }, { sonuc: 'toplama dâhil değil' })).toBeNull();
  });
});

describe('kapsamNotu — not BASILMAYACAK durumlar (null, "" DEĞİL)', () => {
  // MUTASYON: '' dönerse bağlamadaki `not && <p>` yine gizler ama <KapsamNotu> BOŞ <p> basar.
  it('boş nesne / hepsi 0 → null', () => {
    expect(kapsamNotu({})).toBeNull();
    expect(kapsamNotu({ tutarsiz: 0, tarihsiz: 0 })).toBeNull();
  });

  it('bozuk sayaç (NaN / negatif / undefined) → null — "NaN siparişin…" BASILMAZ', () => {
    expect(kapsamNotu({ tutarsiz: NaN })).toBeNull();
    expect(kapsamNotu({ tutarsiz: -1 })).toBeNull();
    expect(kapsamNotu({ tutarsiz: undefined })).toBeNull();
    expect(kapsamNotu({ tutarsiz: Infinity })).toBeNull();
  });

  it('bozuk sayaç DİĞER sayacı susturmaz (kısmi dürüstlük)', () => {
    expect(kapsamNotu({ tutarsiz: NaN, tarihsiz: 2 })).toBe('2 siparişin tarihi çözülemedi');
  });
});

describe('kapsamNotu — sıra SABİT (alan sırası = cümle tablosu sırası)', () => {
  // MUTASYON: `Object.entries(s)` ile dönülürse metin GİRDİ sırasına bağlı olur.
  it('girdi sırası tersse bile tutarsız ÖNCE gelir', () => {
    expect(kapsamNotu({ tarihsiz: 2, tutarsiz: 3 }))
      .toBe('3 siparişin tutarı okunamadı · 2 siparişin tarihi çözülemedi');
  });

  it('sayaçlar TOPLANMAZ — "toplam N kayıt" yazılmaz (aynı sipariş hem tarihsiz hem tutarsız olabilir)', () => {
    const not = kapsamNotu({ tutarsiz: 3, tarihsiz: 2 });
    expect(not).toBe('3 siparişin tutarı okunamadı · 2 siparişin tarihi çözülemedi');
    expect(not).not.toContain('5');
  });
});

describe('kapsamNotu — dil (oc() ile AYNI daraltma)', () => {
  it('dil verilmezse Türkçe, "en" İngilizce, tanınmayan string İngilizce', () => {
    const s: KapsamSayaclari = { tutarsiz: 3 };
    expect(kapsamNotu(s)).toBe('3 siparişin tutarı okunamadı');
    expect(kapsamNotu(s, { dil: 'tr' })).toBe('3 siparişin tutarı okunamadı');
    expect(kapsamNotu(s, { dil: 'en' })).toBe('3 order(s) have an unreadable amount');
    expect(kapsamNotu(s, { dil: 'de' })).toBe('3 order(s) have an unreadable amount');
  });

  it('TİP: `currentLanguage: string` daraltma olmadan geçer (dar tip yazılsaydı çağrı DERLENMEZDİ)', () => {
    const currentLanguage: string = 'tr';
    expect(kapsamNotu({ tarihsiz: 1 }, { dil: currentLanguage })).toBe('1 siparişin tarihi çözülemedi');
  });

  it('binlik ayracı dile göre', () => {
    expect(kapsamNotu({ tutarsiz: 1250 })).toBe('1.250 siparişin tutarı okunamadı');
    expect(kapsamNotu({ tutarsiz: 1250 }, { dil: 'en' })).toBe('1,250 order(s) have an unreadable amount');
  });
});

describe('kapsamNotu — birim SAYACIN özelliğidir, çağrının değil', () => {
  it('SERBEST sayaç: izinli birimi kabul eder', () => {
    expect(kapsamNotu({ tutarsiz: 1 })).toBe('1 siparişin tutarı okunamadı');
    expect(kapsamNotu({ tutarsiz: 1 }, { birim: 'kayit' })).toBe('1 kaydın tutarı okunamadı');
    // MRR şablonu (GenelOzet P-MRR): abonelik ŞABLONU sayılır, sipariş değil.
    expect(kapsamNotu({ tutarsiz: 1 }, { birim: 'sablon' })).toBe('1 şablonun tutarı okunamadı');
  });

  it('`maliyetsiz` varsayılanı NÖTR "kayıt" — çağıran seçerse ürün/sipariş', () => {
    expect(kapsamNotu({ maliyetsiz: 1 })).toBe('1 kaydın maliyeti bilinmiyor');
    // DIO / stok değeri: maliyeti bilinmeyen KART.
    expect(kapsamNotu({ maliyetsiz: 1 }, { birim: 'urun' })).toBe('1 ürünün maliyeti bilinmiyor');
    expect(kapsamNotu({ maliyetsiz: 1 }, { birim: 'siparis' })).toBe('1 siparişin maliyeti bilinmiyor');
  });

  it('SABİT sayaç `birim`i YOK SAYAR', () => {
    expect(kapsamNotu({ miktarsiz: 1, esiksiz: 1 }, { birim: 'siparis' }))
      .toBe('1 ürünün miktarı okunamadı · 1 ürünün kritik stok eşiği tanımlı değil');
    // K4 (kullanıcı: "ikisi de yoksa 'kimliksiz N sipariş' NOTU") — birim SABİT sipariş.
    expect(kapsamNotu({ kimliksiz: 3 }, { birim: 'urun' })).toBe('3 siparişin müşterisi belirlenemedi');
  });

  it('İZİNLİ KÜME DIŞI birim varsayılana döner — yanlış cümle KURULMAZ, hata da fırlatılmaz', () => {
    // "şablonun tarihi çözülemedi" diye bir şey yok: tarihi çözülen tek şey sipariş.
    expect(kapsamNotu({ tarihsiz: 2 }, { birim: 'sablon' })).toBe('2 siparişin tarihi çözülemedi');
    // kapsamDisi YALIN hâl kullanır ("5 ürün kapsam dışında", "5 ürünün" DEĞİL).
    expect(kapsamNotu({ kapsamDisi: 5 }, { birim: 'urun' })).toBe('5 ürün kapsam dışında');
    expect(kapsamNotu({ kapsamDisi: 5 }, { birim: 'kalem' })).toBe('5 sipariş kapsam dışında');
  });

  it('MUTASYON AYIRT EDİCİ — KARIŞIK BİRİM (P619/P148): tek çağrıda ürün + kalem + sipariş', () => {
    const s: KapsamSayaclari = { miktarsiz: 2, eslesmeyen: 4, kalemsiz: 7, tarihsiz: 1 };
    const beklenenTr = '1 siparişin tarihi çözülemedi · 2 ürünün miktarı okunamadı'
      + ' · 4 kalem stok kartıyla eşleşmedi · 7 siparişin kalem verisi yok';
    // `birim` hiç verilmeden:
    expect(kapsamNotu(s)).toBe(beklenenTr);
    // Bağlamadaki eski `birim: 'kalem'` argümanıyla: SONUÇ AYNI (ETKİSİZ).
    // Mutasyon: birim tüm sayaçlara uygulanırsa "1 kalemin tarihi çözülemedi · 2 kalemin miktarı…".
    expect(kapsamNotu(s, { birim: 'kalem' })).toBe(beklenenTr);
    expect(kapsamNotu(s, { birim: 'kalem', dil: 'en' })).toBe(
      '1 order(s) have an unparseable date · 2 product(s) have an unreadable quantity'
      + ' · 4 line item(s) matched no stock card · 7 order(s) have no line items',
    );
  });
});

describe('kapsamNotu — cümle tablosu TAM (11 sayaç × 2 dil)', () => {
  // MUTASYON: bir sayaç tabloda unutulursa o sayaç > 0 iken null döner — SESSİZ KAYIP.
  const vakalar: ReadonlyArray<[keyof KapsamSayaclari, string, string]> = [
    ['tutarsiz', '1 siparişin tutarı okunamadı', '1 order(s) have an unreadable amount'],
    ['sikligisiz', '1 şablonun sıklığı tanınmadı', '1 template(s) have an unrecognized frequency'],
    ['tarihsiz', '1 siparişin tarihi çözülemedi', '1 order(s) have an unparseable date'],
    ['maliyetsiz', '1 kaydın maliyeti bilinmiyor', '1 record(s) have an unknown cost'],
    ['miktarsiz', '1 ürünün miktarı okunamadı', '1 product(s) have an unreadable quantity'],
    ['esiksiz', '1 ürünün kritik stok eşiği tanımlı değil', '1 product(s) have no reorder threshold'],
    ['kimliksiz', '1 siparişin müşterisi belirlenemedi', '1 order(s) have no identifiable customer'],
    ['eslesmeyen', '1 kalem stok kartıyla eşleşmedi', '1 line item(s) matched no stock card'],
    ['kalemsiz', '1 siparişin kalem verisi yok', '1 order(s) have no line items'],
    ['kapsamDisi', '1 sipariş kapsam dışında', '1 order(s) fall outside the range'],
    ['dovizli', '1 kaydın para birimi TL değil — toplanmadı', '1 record(s) are not in TRY — not summed'],
  ];

  it.each(vakalar)('%s — TR', (alan, tr) => {
    expect(kapsamNotu({ [alan]: 1 })).toBe(tr);
  });

  it.each(vakalar)('%s — EN', (alan, _tr, en) => {
    expect(kapsamNotu({ [alan]: 1 }, { dil: 'en' })).toBe(en);
  });

  it('`dovizli` kendi sonucunu taşır; çağıranın `sonuc`u yine sona eklenir', () => {
    expect(kapsamNotu({ dovizli: 2 })).toBe('2 kaydın para birimi TL değil — toplanmadı');
    expect(kapsamNotu({ dovizli: 2 }, { sonuc: 'toplama dâhil değil' }))
      .toBe('2 kaydın para birimi TL değil — toplanmadı — toplama dâhil değil');
  });

  it('ON BİR sayaç birlikte: tablo sırasıyla, tek `sonuc` ekiyle', () => {
    const not = kapsamNotu(
      { tutarsiz: 1, sikligisiz: 11, tarihsiz: 2, maliyetsiz: 3, miktarsiz: 4, esiksiz: 5,
        kimliksiz: 6, eslesmeyen: 7, kalemsiz: 8, kapsamDisi: 9, dovizli: 10 },
      { sonuc: 'listeye alınmadı' },
    );
    expect(not).toBe(
      '1 siparişin tutarı okunamadı · 11 şablonun sıklığı tanınmadı'
      + ' · 2 siparişin tarihi çözülemedi · 3 kaydın maliyeti bilinmiyor'
      + ' · 4 ürünün miktarı okunamadı · 5 ürünün kritik stok eşiği tanımlı değil'
      + ' · 6 siparişin müşterisi belirlenemedi · 7 kalem stok kartıyla eşleşmedi'
      + ' · 8 siparişin kalem verisi yok · 9 sipariş kapsam dışında'
      + ' · 10 kaydın para birimi TL değil — toplanmadı — listeye alınmadı',
    );
  });
});

/**
 * DELTA 2026-09-22 — hakem bulgusu (GenelOzet.tsx:269 MRR kapsam notu).
 * `sayaclar={{ tutarsiz: tg.mrr.bilinmeyen }}` KONFLASYON yapıyordu: `mrr.bilinmeyen`
 * hem tutarı okunamayan hem SIKLIĞI tanınmayan şablonu içerir (`abonelik.ts`:
 * `sablonAylikTutari` frekans tanınmazsa tutar BİLİNSE BİLE NaN döner). Frekansı bozuk
 * şablon için not "1 şablonun tutarı okunamadı" diyordu — YANLIŞ NEDEN; kullanıcı fiyatı
 * aramaya gider, fiyat yerinde olduğu için sorunu 'yok' sanır, ARR kalıcı '—' kalır.
 * Bu, bu modülün başlığındaki "yanlış birim = yanlış bilgi" yamasının ikizidir: yanlış
 * NEDEN de yanlış bilgidir. `abonelik.ts` kırılımı zaten üretiyordu (`tutarsiz` +
 * `bilinmeyenFrekans`), hiçbir yüzey okumuyordu ("yazıldı ama bağlanmadı").
 */
describe('kapsamNotu — `sikligisiz`: NEDEN ayrımı (MRR şablonu)', () => {
  it('SABİT birim `sablon` — çağıran başka birim isterse YOK SAYILIR', () => {
    expect(kapsamNotu({ sikligisiz: 2 })).toBe('2 şablonun sıklığı tanınmadı');
    expect(kapsamNotu({ sikligisiz: 2 }, { birim: 'siparis' })).toBe('2 şablonun sıklığı tanınmadı');
    expect(kapsamNotu({ sikligisiz: 2 }, { birim: 'urun' })).toBe('2 şablonun sıklığı tanınmadı');
  });

  it('MUTASYON AYIRT EDİCİ: tutarsız ile sıklıksız AYRI cümleler, TOPLANMAZ', () => {
    // Şirin İnşaat'ın yıllık çimento şablonu (frekans tanınmıyor, tutar ₺12.000 OKUNUYOR)
    // + tutarı okunamayan bir şablon. Tek sayaçta birleştirilirse neden yanlış olur.
    const not = kapsamNotu(
      { tutarsiz: 1, sikligisiz: 1 },
      { birim: 'sablon', dil: 'tr', sonuc: 'MRR kısmi toplam; ARR hesaplanmadı' },
    );
    expect(not).toBe(
      '1 şablonun tutarı okunamadı · 1 şablonun sıklığı tanınmadı'
      + ' — MRR kısmi toplam; ARR hesaplanmadı',
    );
    expect(not).not.toContain('2');
  });

  it('yalnız sıklık bozuksa "tutarı okunamadı" cümlesi BASILMAZ', () => {
    expect(kapsamNotu({ tutarsiz: 0, sikligisiz: 1 }, { birim: 'sablon' }))
      .toBe('1 şablonun sıklığı tanınmadı');
  });
});
