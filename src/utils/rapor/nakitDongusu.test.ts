/**
 * nakitDongusu.test.ts — Alacak Devir Günü (DSO) + Nakit Dönüşüm Döngüsü (CCC) sözleşmesi
 * (Faz 3 6/n · 6a). ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı).
 *
 * Sayfadaki sahte kesinlik siteleri (src/components/reports/genel/GenelOzet.tsx, 2026-09-19 ölçümü):
 *   221 `unPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)` → tutarı BİLİNMEYEN alacak
 *       kaydı ₺0 sayılıyor; alacak olduğundan KÜÇÜK → DSO "sağlıklı" çıkıyor (sayaç yok).
 *   226 `son90(izlenen185).reduce((s, o) => s + (o.totalPrice || 0), 0)` → aynı arıza paydada;
 *       ciro küçülünce DSO BÜYÜYOR — iki arıza ters yönde, birbirini gizliyor.
 *   228 `dailyRev185 > 0 ? Math.round(arBalance / dailyRev185) : null` → tek kapı günlük ciro;
 *       payın ya da paydanın KISMİ olması hiç sorulmuyor.
 *   248 `(dso !== null && dio !== null) ? dso + dio : null` → doğru ama hangi terimin eksik
 *       olduğunu söylemiyor (ekran "—" basıp nedenini yazamıyor).
 *
 * Kural (CLAUDE.md): TÜRETİLEN sayı (gün/oran/fark) tek girdisi bile bilinmiyorsa HESAPLANMAZ.
 * PARİTE: girdiler biliniyorsa sayı eskiyle birebir aynı (test 1 eski `reduce` + bölmeyi yeniden kurar).
 */
import { describe, it, expect } from 'vitest';
import { alacakDevirGunu, nakitDongusu, stokDevirGunuTutar } from './nakitDongusu';
import { toplaBilinen, ekranTutari, type Tutar } from '../para';
import { stokDevirGunu } from '../pano/raporMarj';

/** Ekrandaki sipariş kaydının yapısal karşılığı (tipe bağımlı değil — tutar alanı `unknown`). */
interface TestSiparis { musteri: string; totalPrice: unknown }

const s = (musteri: string, totalPrice: unknown): TestSiparis => ({ musteri, totalPrice });
const tutar = (l: readonly TestSiparis[]): Tutar => toplaBilinen(l, o => o.totalPrice);

/** 90 günlük pencerenin ödenmemiş siparişleri (GenelOzet P185 kümesi — TL). */
const ALACAK: TestSiparis[] = [
  s('Şirin İnşaat', 40000),
  s('Yıldız Yapı Malzemeleri', 30000),
  s('Kâhya Hafriyat', 20000),
];
/** Aynı pencerenin cirosu (TL): 270.000 → 90 günde günlük 3.000. */
const CIRO: TestSiparis[] = [
  s('Şirin İnşaat', 150000),
  s('Yıldız Yapı Malzemeleri', 70000),
  s('Kâhya Hafriyat', 50000),
];

describe('alacakDevirGunu — parite (GenelOzet.tsx:221-228)', () => {
  it('1 · bilinen girdide sayı eski satır içi hesapla BİREBİR', () => {
    const alacak = tutar(ALACAK), ciro = tutar(CIRO);
    expect([alacak.toplam, alacak.bilinmeyen]).toEqual([90000, 0]);
    expect([ciro.toplam, ciro.bilinmeyen]).toEqual([270000, 0]);

    // Eski satırların yeniden kurulumu: reduce → /90 → Math.round.
    const eskiArBalance = ALACAK.reduce((t, o) => t + (Number(o.totalPrice) || 0), 0);
    const eskiGunluk = CIRO.reduce((t, o) => t + (Number(o.totalPrice) || 0), 0) / 90;
    const eskiDso = eskiGunluk > 0 ? Math.round(eskiArBalance / eskiGunluk) : null;

    expect(alacakDevirGunu(alacak, ciro, 90)).toEqual({ dso: 30, neden: null });
    expect(alacakDevirGunu(alacak, ciro, 90).dso).toBe(eskiDso);
  });

  it('10 · yuvarlama GenelOzet:228 ile aynı (Math.round, yarım yukarı)', () => {
    // Günlük ciro 100 TL (9.000 / 90 gün) — alacak doğrudan "gün" okunuyor.
    const ciro = tutar([s('Şirin İnşaat', 9000)]);
    const dso = (alacakTL: number) => alacakDevirGunu(tutar([s('Şirin İnşaat', alacakTL)]), ciro, 90).dso;
    expect(dso(100)).toBe(1);
    expect(dso(140)).toBe(1);
    expect(dso(150)).toBe(2);
  });
});

describe('alacakDevirGunu — bilinmeyen 0 sayılmaz', () => {
  it('2 · alacağın TEK kaydı bilinmiyorsa DSO yok (mutasyon: kısmi toplamdan gün üretmek)', () => {
    const kismi = tutar([...ALACAK, s('Mermer Yapı Ltd.', null)]);
    expect([kismi.bilinen, kismi.bilinmeyen]).toEqual([3, 1]);
    // MUTASYON AYIRT EDİCİ: kapı `ekranTutari`ye (kısmi toplam) çevrilirse 90.000/3.000 = 30 gün
    // döner — alacak olduğundan KÜÇÜK olduğu için ekran "tahsilat sağlıklı" der. Eski davranış buydu:
    expect(Math.round(kismi.toplam / 3000)).toBe(30);
    expect(alacakDevirGunu(kismi, tutar(CIRO), 90)).toEqual({ dso: null, neden: 'alacak-bilinmiyor' });
  });

  it('3 · cironun tek kaydı bilinmiyorsa DSO yok (mutasyon: yalnız `gunluk > 0` kapısı)', () => {
    const kismiCiro = tutar([...CIRO, s('Mermer Yapı Ltd.', null), s('Aksu Beton', undefined)]);
    expect(kismiCiro.bilinmeyen).toBe(2);
    // MUTASYON AYIRT EDİCİ: GenelOzet:228'in tek kapısı (`dailyRev185 > 0`) kısmi ciroyu geçirir;
    // payda küçülür, DSO ŞİŞER (30 gün yerine aşağıdaki sayı) ve "yavaş tahsilat" hükmü basılır:
    expect(Math.round(90000 / (kismiCiro.toplam / 90))).toBe(30);
    expect(alacakDevirGunu(tutar(ALACAK), kismiCiro, 90)).toEqual({ dso: null, neden: 'ciro-bilinmiyor' });
  });

  it('7 · kapı önceliği: ikisi de kısmiyse TEK neden — alacak önce', () => {
    const kismiAlacak = tutar([...ALACAK, s('Mermer Yapı Ltd.', null)]);
    const kismiCiro = tutar([...CIRO, s('Aksu Beton', 'yok')]);
    expect(alacakDevirGunu(kismiAlacak, kismiCiro, 90)).toEqual({ dso: null, neden: 'alacak-bilinmiyor' });
  });
});

describe('alacakDevirGunu — sıfır/geçersiz payda', () => {
  it('4 · dönem cirosu 0 → "ciro-yok" (Infinity ya da 0 gün DEĞİL)', () => {
    const sonuc = alacakDevirGunu(tutar(ALACAK), tutar([]), 90);
    expect(sonuc).toEqual({ dso: null, neden: 'ciro-yok' });
    // Eski satır 0'a bölmüyordu (kapısı vardı) ama kapısız bir mutasyon Infinity üretir:
    expect(90000 / 0).toBe(Infinity);
  });

  it('6 · gün sayısı 0 / negatif / NaN / Infinity → "ciro-bilinmiyor"', () => {
    for (const gun of [0, -5, NaN, Infinity]) {
      expect(alacakDevirGunu(tutar(ALACAK), tutar(CIRO), gun)).toEqual({ dso: null, neden: 'ciro-bilinmiyor' });
    }
  });

  it('negatif günlük ciro (iade fazlası) → "ciro-yok" (negatif gün sayısı basılmaz)', () => {
    const iadeli = tutar([s('Şirin İnşaat', 50000), s('Yıldız Yapı Malzemeleri', -60000)]);
    expect(iadeli.bilinmeyen).toBe(0);
    expect(alacakDevirGunu(tutar(ALACAK), iadeli, 90)).toEqual({ dso: null, neden: 'ciro-yok' });
  });
});

describe('alacakDevirGunu — gerçek sıfır bilinmeyen DEĞİLDİR', () => {
  it('5 · alacak 0 + ciro > 0 → gerçek 0 gün (mutasyon: `if (!alacak.toplam) return null`)', () => {
    expect(alacakDevirGunu(tutar([]), tutar(CIRO), 90)).toEqual({ dso: 0, neden: null });
    // Tutarı GİRİLMİŞ ama sıfır olan kayıt da bilinendir:
    expect(alacakDevirGunu(tutar([s('Şirin İnşaat', 0)]), tutar(CIRO), 90)).toEqual({ dso: 0, neden: null });
  });

  it('savunma: elle kurulmuş Tutar.toplam sonsuz/NaN ise DSO yok', () => {
    const bozuk: Tutar = { toplam: NaN, bilinen: 1, bilinmeyen: 0 };
    expect(alacakDevirGunu(bozuk, tutar(CIRO), 90)).toEqual({ dso: null, neden: 'alacak-bilinmiyor' });
  });
});

describe('nakitDongusu — CCC', () => {
  it('8 · iki terim de biliniyorsa toplam (GenelOzet:248 paritesi)', () => {
    expect(nakitDongusu({ dso: 30, dio: 45 })).toEqual({ ccc: 75, eksik: [] });
    const eski = (dso: number | null, dio: number | null) => (dso !== null && dio !== null ? dso + dio : null);
    expect(nakitDongusu({ dso: 30, dio: 45 }).ccc).toBe(eski(30, 45));
    expect(nakitDongusu({ dso: null, dio: 45 })).toEqual({ ccc: null, eksik: ['dso'] });
  });

  it('9 · eksik terim ADLANDIRILIR (mutasyon: `(dso ?? 0) + (dio ?? 0)`)', () => {
    // MUTASYON AYIRT EDİCİ: `??  0` kalıbı aşağıdaki iki vakada 30 ve 0 basar — "stok hiç
    // beklemiyor" / "nakit döngüsü sıfır gün" hükmü bilinmeyen terimden üretilmiş olur.
    expect(nakitDongusu({ dso: 30, dio: null })).toEqual({ ccc: null, eksik: ['dio'] });
    expect(nakitDongusu({ dso: null, dio: null })).toEqual({ ccc: null, eksik: ['dso', 'dio'] });
    const mutasyon = (dso: number | null, dio: number | null) => (dso ?? 0) + (dio ?? 0);
    expect(mutasyon(30, null)).toBe(30);
    expect(mutasyon(null, null)).toBe(0);
  });

  it('gerçek 0 gün toplanır (0 bilinmeyen değildir)', () => {
    expect(nakitDongusu({ dso: 0, dio: 45 })).toEqual({ ccc: 45, eksik: [] });
    expect(nakitDongusu({ dso: 0, dio: 0 })).toEqual({ ccc: 0, eksik: [] });
  });

  it('savunma: NaN/Infinity terim toplama girmez, eksik sayılır', () => {
    expect(nakitDongusu({ dso: NaN, dio: 45 })).toEqual({ ccc: null, eksik: ['dso'] });
    expect(nakitDongusu({ dso: 30, dio: Infinity })).toEqual({ ccc: null, eksik: ['dio'] });
  });
});

// ── DIO'nun STOK TARAFI (2026-09-20 hakem turu) ─────────────────────────────────────────────
//
// Hakem, GenelOzet.tsx:353'teki `tamTutar(stok185)` çağrısını `ekranTutari(stok185)` ile
// değiştirdi ve `npx vitest run src/components/reports` YEŞİL kaldı: `stokDevirGunu`'nun kendi
// kapısı testliydi ama ona hangi sayının verileceği BAĞLAMADA, testsiz duruyordu. Çağıran artık
// `Tutar`ı geçiyor; seçim bu modülde ve aşağıdaki vakalarla kilitli.

describe('stokDevirGunuTutar — stok TÜRETME kapısı', () => {
  const tam = (n: number, bilinen = 1): Tutar => ({ toplam: n, bilinen, bilinmeyen: 0 });
  const marj = (maliyetTutar: Tutar, kapsamDisi = 0) => ({ maliyetTutar, kapsamDisi });
  /** Depoda ₺900.000 (40 kalem), son 90 günün COGS'u ₺200.000. */
  const STOK_TAM: Tutar = tam(900000, 40);
  const MARJ = marj(tam(200000, 9));

  it('PARİTE — stok TAM biliniyorsa sayı `stokDevirGunu(number)` ile birebir', () => {
    expect(stokDevirGunuTutar(STOK_TAM, MARJ, 90)).toEqual(stokDevirGunu(900000, MARJ, 90));
    expect(stokDevirGunuTutar(STOK_TAM, MARJ, 90)).toEqual({ dio: 405, neden: null });
  });

  it('MUTASYON-AYIRT EDİCİ — KISMİ stok değerinden DIO üretilmez', () => {
    const kismi: Tutar = { toplam: 900000, bilinen: 40, bilinmeyen: 3 };
    expect(stokDevirGunuTutar(kismi, MARJ, 90)).toEqual({ dio: null, neden: 'stok-bilinmiyor' });
    // `tamTutar` yerine `ekranTutari` sızarsa maliyeti çözülemeyen 3 kalem ₺0 sayılır ve
    // eksik stoktan TAM bir DIO çıkar — kart yeşil "sağlıklı" basar:
    expect(stokDevirGunu(ekranTutari(kismi), MARJ, 90)).toEqual({ dio: 405, neden: null });
  });

  it('hiç bilinen kalem yokken de DIO üretilmez (ekran `—`, sayaç notta)', () => {
    expect(stokDevirGunuTutar({ toplam: 0, bilinen: 0, bilinmeyen: 5 }, MARJ, 90))
      .toEqual({ dio: null, neden: 'stok-bilinmiyor' });
  });

  it('kapı SIRASI korunur — maliyet ve kalemsiz nedenleri stoktan ÖNCE gelir', () => {
    // Ekranda TEK neden görünür; hangisi olduğu `stokDevirGunu`'nun sırasına bağlıdır ve
    // bu sarmalayıcı onu DEĞİŞTİRMEZ (kısmi stok + kısmi maliyet → 'maliyet-bilinmiyor').
    const kismiStok: Tutar = { toplam: 900000, bilinen: 40, bilinmeyen: 3 };
    expect(stokDevirGunuTutar(kismiStok, marj({ toplam: 200000, bilinen: 9, bilinmeyen: 1 }), 90))
      .toEqual({ dio: null, neden: 'maliyet-bilinmiyor' });
    expect(stokDevirGunuTutar(kismiStok, marj(tam(200000, 9), 4), 90))
      .toEqual({ dio: null, neden: 'kalemsiz-siparis' });
  });

  it('boş depo GERÇEK 0 gündür (bilinmeyen değil)', () => {
    expect(stokDevirGunuTutar({ toplam: 0, bilinen: 0, bilinmeyen: 0 }, MARJ, 90))
      .toEqual({ dio: 0, neden: null });
  });
});
