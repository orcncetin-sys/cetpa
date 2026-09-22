/**
 * sayac.test.ts — Rapor ekranlarının ADET SAYACI sözleşmesi (Faz 3 6a, grup "sayac", 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı). Saf — React/DB yok.
 *
 * Kapatılan kalıp (rapor dosyalarında 58 satır):
 *   src/components/reports/useReportsData.ts
 *     102  acc[e.department] = (acc[e.department] || 0) + 1   → departman pastası
 *     210  acc[o.status]     = (acc[o.status]     || 0) + 1   → sipariş durumu pastası
 *
 * Kalıbın taşıdığı arıza: anahtar boşken (`undefined`/`null`/`''`) obje anahtarı `'undefined'`
 * METNİ oluyor ve ekranda gerçek bir kova gibi çiziliyor (İK departman pastasındaki 'undefined'
 * dilimi). Doğrusu: anahtarı çözülemeyen kayıt hiçbir kovaya girmez ama SAYILIR (`anahtarsiz`),
 * çağıran ya "Belirtilmemiş" dilimi olarak dürüstçe gösterir ya da kapsam notu basar.
 *
 * Burada 0 başlangıcı MEŞRUDUR: sayım bir tutar değil, kayıt adedidir — "hiç görülmedi" gerçekten
 * 0'dır. Sahte kesinlik yasağı sayıya değil, UYDURMA ANAHTARA karşı uygulanır.
 */
import { describe, it, expect } from 'vitest';
import { adetSay, sayimSatirlari } from './sayac';

/** Türkçe fikstür: Şirin İnşaat'ın siparişleri + Cetpa kadrosu (inşaat malzemesi toptancısı). */
interface Calisan { ad: string; departman?: unknown }
interface Siparis { musteri: string; urun: string; status?: unknown }

const KADRO: readonly Calisan[] = [
  { ad: 'Mehmet Yılmaz', departman: 'Satış' },
  { ad: 'Ayşe Demir', departman: 'Depo' },
  { ad: 'Fatma Şahin', departman: 'Satış' },
];

const SIPARISLER: readonly Siparis[] = [
  { musteri: 'Şirin İnşaat', urun: 'ÇİMENTO 50KG', status: 'Pending' },
  { musteri: 'Şirin İnşaat', urun: 'Demir Ø12', status: 'Delivered' },
  { musteri: 'Bozkurt Yapı', urun: 'ÇİMENTO 50KG', status: 'Pending' },
];

describe('adetSay — parite (bilinen anahtar)', () => {
  it('1 · eski reduce kalıbıyla BİREBİR aynı sayılar, sıra = ilk görülme', () => {
    const s = adetSay(SIPARISLER, o => o.status);

    expect(s.sayilar.get('Pending')).toBe(2);
    expect(s.sayilar.get('Delivered')).toBe(1);
    expect(s.sayilar.size).toBe(2);
    expect(s.anahtarsiz).toBe(0);
    expect(s.toplam).toBe(3);
    // Eski `Object.entries(reduce)` sırası = ekleme sırası (metin anahtarlarda).
    expect([...s.sayilar.keys()]).toEqual(['Pending', 'Delivered']);

    // Paritenin kendisi: aynı girdide eski kalıbın ürettiği obje ile aynı sayılar.
    // (Eski kalıp `(acc[k] || 0) + 1` idi; burada AYNI davranış `|| 0` yazmadan kuruldu —
    //  anahtarı bilinen bu fikstürde ikisi birebir aynıdır ve kapanış ölçüsü temiz kalır.)
    const eski = SIPARISLER.reduce((acc: Record<string, number>, o) => {
      const k = String(o.status);
      const mevcut = acc[k];
      acc[k] = (mevcut === undefined ? 0 : mevcut) + 1;
      return acc;
    }, {});
    expect(Object.fromEntries(s.sayilar)).toEqual(eski);
  });

  it('1b · departman sayımı (İK pastası) — kadro toplamı korunur', () => {
    const d = adetSay(KADRO, e => e.departman);
    expect(Object.fromEntries(d.sayilar)).toEqual({ 'Satış': 2, 'Depo': 1 });
    expect(d.toplam).toBe(KADRO.length);
  });
});

describe('adetSay — bilinmeyen anahtar 0 SAYILMAZ, uydurma kova AÇILMAZ', () => {
  it("2 · undefined / null / '' / boşluk → anahtarsiz, 'undefined' kovası YOK", () => {
    // MUTASYON AYIRT EDİCİ: koruma kaldırılıp düz `String(k)` yazılırsa
    // 'undefined' + 'null' kovaları doğar ve bu test kırmızı olur.
    const bos: readonly Calisan[] = [
      { ad: 'A', departman: undefined },
      { ad: 'B', departman: null },
      { ad: 'C', departman: '' },
      { ad: 'D', departman: '   ' },
    ];
    const d = adetSay(bos, e => e.departman);

    expect(d.anahtarsiz).toBe(4);
    expect(d.sayilar.size).toBe(0);
    expect(d.sayilar.has('undefined')).toBe(false);
    expect(d.sayilar.has('null')).toBe(false);
    expect(d.sayilar.has('')).toBe(false);
    expect(d.toplam).toBe(4);
  });

  it('3 · trim BİRLEŞTİRİR: "Satış " ile "Satış" tek kovadır', () => {
    // MUTASYON AYIRT EDİCİ: trim kaldırılırsa iki ayrı dilim çizilir.
    const d = adetSay(
      [{ ad: 'A', departman: 'Satış ' }, { ad: 'B', departman: 'Satış' }] as readonly Calisan[],
      e => e.departman,
    );
    expect([...d.sayilar.keys()]).toEqual(['Satış']);
    expect(d.sayilar.get('Satış')).toBe(2);
    expect(d.anahtarsiz).toBe(0);
  });

  it("4 · nesne / NaN / Infinity / boolean → anahtarsiz; '[object Object]' kovası YOK", () => {
    const karisik: readonly Calisan[] = [
      { ad: 'A', departman: { id: 7 } },
      { ad: 'B', departman: Number.NaN },
      { ad: 'C', departman: Number.POSITIVE_INFINITY },
      { ad: 'D', departman: true },
      { ad: 'E', departman: false },
      { ad: 'F', departman: ['Satış'] },
    ];
    const d = adetSay(karisik, e => e.departman);

    expect(d.anahtarsiz).toBe(6);
    expect(d.sayilar.size).toBe(0);
    expect(d.sayilar.has('[object Object]')).toBe(false);
    expect(d.sayilar.has('NaN')).toBe(false);
    expect(d.sayilar.has('true')).toBe(false);
  });

  it("5 · sayısal anahtar: 5 → '5', 0 → '0' kovası OLUŞUR (0 meşru anahtardır)", () => {
    // MUTASYON AYIRT EDİCİ: `if (!k)` koruması 0'ı (ve '0' metnini) düşürürdü.
    const d = adetSay(
      [{ ad: 'A', departman: 5 }, { ad: 'B', departman: 0 }, { ad: 'C', departman: 0 }] as readonly Calisan[],
      e => e.departman,
    );
    expect(d.sayilar.get('5')).toBe(1);
    expect(d.sayilar.get('0')).toBe(2);
    expect(d.anahtarsiz).toBe(0);
  });

  it('6 · DEĞİŞMEZ: Σ sayilar + anahtarsiz === toplam (karışık girdide)', () => {
    const karisik: readonly Calisan[] = [
      { ad: 'A', departman: 'Satış' },
      { ad: 'B', departman: undefined },
      { ad: 'C', departman: 'Depo' },
      { ad: 'D', departman: '  Depo  ' },
      { ad: 'E', departman: {} },
      { ad: 'F', departman: 0 },
      { ad: 'G', departman: '' },
      { ad: 'H', departman: 'Muhasebe' },
    ];
    const d = adetSay(karisik, e => e.departman);

    const kovaToplami = [...d.sayilar.values()].reduce((s, n) => s + n, 0);
    expect(kovaToplami + d.anahtarsiz).toBe(d.toplam);
    expect(d.toplam).toBe(karisik.length);
    // Bilinmeyenler ÇİFT SAYILMAZ: anahtarsız kayıt hiçbir kovaya da yazılmamıştır.
    expect(kovaToplami).toBe(5);
    expect(d.anahtarsiz).toBe(3);
  });

  it('7 · boş liste → boş Map; donmuş (Object.freeze) girdi hata atmaz ve MUTASYONA uğramaz', () => {
    const bos = adetSay([] as readonly Calisan[], e => e.departman);
    expect(bos.sayilar.size).toBe(0);
    expect(bos.anahtarsiz).toBe(0);
    expect(bos.toplam).toBe(0);

    const donmus = Object.freeze([
      Object.freeze({ ad: 'A', departman: 'Satış' }),
      Object.freeze({ ad: 'B', departman: undefined }),
    ]) as readonly Calisan[];
    const kopya = JSON.parse(JSON.stringify(donmus)) as Calisan[];
    expect(() => adetSay(donmus, e => e.departman)).not.toThrow();
    expect(JSON.parse(JSON.stringify(donmus))).toEqual(kopya);
  });

  it('9 · BİLİNÇLİ FARK: sayısal anahtarda sıra ilk görülmedir (Object.entries sayısal sıralardı)', () => {
    const d = adetSay(
      [{ ad: 'A', departman: 10 }, { ad: 'B', departman: 2 }] as readonly Calisan[],
      e => e.departman,
    );
    expect([...d.sayilar.keys()]).toEqual(['10', '2']);
    // Eski kalıp tamsayı-benzeri anahtarları ARTAN sayısal sıraya sokuyordu:
    expect(Object.keys({ '10': 1, '2': 1 })).toEqual(['2', '10']);
    // Gerçek çağrı yerlerinde (departman, sipariş durumu) anahtar metindir → parite bozulmaz.
  });
});

describe('sayimSatirlari — recharts şekli', () => {
  it('8a · etiket verilir + anahtarsiz > 0 → SONA tek satır eklenir, toplam korunur', () => {
    const d = adetSay(
      [
        { ad: 'A', departman: 'Satış' },
        { ad: 'B', departman: undefined },
        { ad: 'C', departman: 'Depo' },
        { ad: 'D', departman: null },
      ] as readonly Calisan[],
      e => e.departman,
    );
    // Etiket ÇAĞIRANDAN gelir (modülde metin yok) — canlıda `oc(dil).belirtilmemis`.
    const satirlar = sayimSatirlari(d, { anahtarsizEtiketi: 'Belirtilmemiş' });

    expect(satirlar).toEqual([
      { name: 'Satış', value: 1 },
      { name: 'Depo', value: 1 },
      { name: 'Belirtilmemiş', value: 2 },
    ]);
    expect(satirlar.reduce((s, r) => s + r.value, 0)).toBe(d.toplam);
  });

  it('8b · anahtarsiz 0 → etiket verilse bile ek satır YOK', () => {
    const d = adetSay(SIPARISLER, o => o.status);
    expect(sayimSatirlari(d, { anahtarsizEtiketi: 'Belirtilmemiş' })).toEqual([
      { name: 'Pending', value: 2 },
      { name: 'Delivered', value: 1 },
    ]);
  });

  it('8c · etiket verilmezse anahtarsızlar satır OLMAZ (çağıran kapsam notu basar)', () => {
    // MUTASYON AYIRT EDİCİ: etiketsizken varsayılan bir metin ('Diğer' gibi) uydurulursa kırmızı.
    const d = adetSay(
      [{ ad: 'A', departman: 'Satış' }, { ad: 'B', departman: '' }] as readonly Calisan[],
      e => e.departman,
    );
    const satirlar = sayimSatirlari(d);
    expect(satirlar).toEqual([{ name: 'Satış', value: 1 }]);
    // Dilimlerin toplamı kadroyu VERMEZ — fark çağıranın notudur (anahtarsiz = 1).
    expect(satirlar.reduce((s, r) => s + r.value, 0)).toBe(1);
    expect(d.anahtarsiz).toBe(1);
  });

  it('8d · satır sırası = ilk görülme; boş sayımda boş dizi', () => {
    const d = adetSay(SIPARISLER, o => o.status);
    expect(sayimSatirlari(d).map(r => r.name)).toEqual(['Pending', 'Delivered']);

    const bos = adetSay([] as readonly Siparis[], o => o.status);
    expect(sayimSatirlari(bos, { anahtarsizEtiketi: 'Belirtilmemiş' })).toEqual([]);
  });

  it('8e · dönen dizi ve satırlar sayımı ETKİLEMEZ (kopya)', () => {
    const d = adetSay(SIPARISLER, o => o.status);
    const satirlar = sayimSatirlari(d);
    satirlar.push({ name: 'Uydurma', value: 99 });
    expect(sayimSatirlari(d)).toHaveLength(2);
    expect(d.sayilar.size).toBe(2);
  });
});
