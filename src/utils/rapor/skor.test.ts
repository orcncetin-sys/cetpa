/**
 * skor.test.ts — Bileşik skor + eşik bandı sözleşmesi (Faz 3 6b, grup "utils-skor", 2026-09-24).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra modül yazıldı). Saf — React/DB yok, içe aktarım yalnız `./skor`.
 *
 * Kapatılan siteler (HEAD b95fc18; şartname teyidi 912d750 — iki HEAD arasında GB3'e dokunulmadı, ölçüldü):
 *   src/components/reports/genel/GenelBloklar3.tsx — P260 "⚡ Satış Momentum Skoru"
 *     83     score: m.prev > 0 ? (m.curr >= m.prev * 1.1 ? 25 : m.curr >= m.prev ? 15 : m.curr >= m.prev * 0.9 ? 5 : 0) : (m.curr > 0 ? 15 : 0)
 *     85     const momentumScore = scored.reduce((s, m) => s + m.score, 0)   → boş/kısmi listede de SAYI
 *     86     const maxScore = 100
 *     87-89  rozet merdiveni (>= 80 / 50 / 25 / diğer) — 1. kopya
 *     101    çubuk rengi merdiveni — AYNI merdivenin 2. kopyası
 *
 * Kural (CLAUDE.md): skor TÜRETİLEN sayıdır — tek girdisi bile bilinmiyorsa HESAPLANMAZ (`null`),
 * ekranda '—', rozet de çubuk da çizilmez. `0` gerçek bir puandır, bilinmeyen DEĞİLDİR.
 *
 * Bağlama sözleşmesi (baglama-genel-3 ajanına verilen tablo) burada test fikstürü olarak yeniden
 * kurulur: `metrikPuani` + `MOMENTUM_*` sabitleri GB3'e yazılacak biçimin birebir aynasıdır. Değerler
 * K20 gereği DEĞİŞMEZ — kullanıcı: "ok kalsın".
 */
import { describe, it, expect } from 'vitest';
import { bilesikSkor, esikBandi } from './skor';
import type { SkorBileseni, BantTanimi } from './skor';

// ---------------------------------------------------------------------------
// Fikstürler — Şirin İnşaat'ın son 30 gün / önceki 30 gün karşılaştırması (ÇİMENTO 50KG ağırlıklı
// ciro, TL). GB3 P260'ın dört bileşeni, bugünkü ekran sırasıyla.
// ---------------------------------------------------------------------------

const GB3_VEKTORU: readonly SkorBileseni[] = [
  { ad: 'Ciro', puan: 25, agirlik: 1 },
  { ad: 'Sipariş Adedi', puan: 15, agirlik: 1 },
  { ad: 'Müşteri Sayısı', puan: 5, agirlik: 1 },
  { ad: 'AOV', puan: 0, agirlik: 1 },
];

/** Tipi henüz doğrulanmamış (JSON / dış kaynak) bileşen — çalışma zamanı çöpünü sınamak için. */
interface HamBilesen { ad: string; puan: unknown; agirlik: unknown }
/** `SkorBileseni` → `HamBilesen` atanabilir olduğundan bu daraltma `any`siz derlenir. */
const ham = (liste: readonly HamBilesen[]): readonly SkorBileseni[] => liste as readonly SkorBileseni[];

// --- GB3 bağlama sözleşmesinin aynası (K20 — kullanıcı: "ok kalsın"; değerler DEĞİŞMEZ) ---
const MOMENTUM_BUYUME_CARPANI = { guclu: 1.1, artis: 1, hafifDusus: 0.9 } as const;
const MOMENTUM_PUANLARI = { guclu: 25, artis: 15, hafifDusus: 5, dusus: 0 } as const;
const MOMENTUM_TABANSIZ_PUAN = 15;
const MOMENTUM_AZAMI_SKOR = 100;
type MomentumBandi = 'guclu' | 'orta' | 'stabil' | 'dusus';
const MOMENTUM_BANTLARI: readonly BantTanimi<MomentumBandi>[] = [
  { altSinir: 80, deger: 'guclu' },
  { altSinir: 50, deger: 'orta' },
  { altSinir: 25, deger: 'stabil' },
  { altSinir: -Infinity, deger: 'dusus' },
];

/** Büyüme merdiveni — çarpan PAYDA tarafında (`curr >= prev * k`), bölmeye ÇEVRİLMEZ (test 12). */
const buyumeBantlari = (prev: number): readonly BantTanimi<number>[] => [
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.guclu, deger: MOMENTUM_PUANLARI.guclu },
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.artis, deger: MOMENTUM_PUANLARI.artis },
  { altSinir: prev * MOMENTUM_BUYUME_CARPANI.hafifDusus, deger: MOMENTUM_PUANLARI.hafifDusus },
  { altSinir: -Infinity, deger: MOMENTUM_PUANLARI.dusus },
];

/** GB3:83'ün bağlanacağı biçim (şartname tablosu, KAPI YAMASI sonrası: kapı `Number.isFinite`). */
const metrikPuani = (curr: number, prev: number): number | null =>
  !Number.isFinite(curr) || !Number.isFinite(prev)
    ? null
    : prev > 0
      ? esikBandi(curr, buyumeBantlari(prev))
      : (curr > 0 ? MOMENTUM_TABANSIZ_PUAN : MOMENTUM_PUANLARI.dusus);

/** GB3:83 — BUGÜNKÜ satır, birebir (parite referansı; yalnız sonlu girdide anlamlı). */
const eskiPuan = (curr: number, prev: number): number =>
  prev > 0 ? (curr >= prev * 1.1 ? 25 : curr >= prev ? 15 : curr >= prev * 0.9 ? 5 : 0) : (curr > 0 ? 15 : 0);

// ---------------------------------------------------------------------------
// bilesikSkor
// ---------------------------------------------------------------------------

describe('bilesikSkor — parite (tam veri)', () => {
  it('1 · GB3 vektörü: eski `reduce((s,m)=>s+m.score,0)` ile BİREBİR aynı skor (45/100)', () => {
    // Bugünkü satır 85, yeniden kurulmuş: score alanı number (eski tip), reduce başlangıcı 0.
    const eskiScored: readonly { label: string; score: number }[] = [
      { label: 'Ciro', score: 25 }, { label: 'Sipariş Adedi', score: 15 },
      { label: 'Müşteri Sayısı', score: 5 }, { label: 'AOV', score: 0 },
    ];
    const eski = eskiScored.reduce((s, m) => s + m.score, 0);
    expect(eski).toBe(45);

    const yeni = bilesikSkor(GB3_VEKTORU);
    expect(yeni).toEqual({ skor: 45, kullanilan: 4, toplam: 4, eksik: [] });
    expect(yeni.skor).toBe(eski);
    expect(MOMENTUM_AZAMI_SKOR).toBe(4 * MOMENTUM_PUANLARI.guclu);
  });

  it('5 · `0` GERÇEK puandır: tek bileşen 0 → skor 0, eksik yok', () => {
    // Mutasyon: `if (!puan)` koruması 0'ı bilinmeyene çevirir → skor null, test kırmızı.
    expect(bilesikSkor([{ ad: 'Ciro', puan: 0, agirlik: 1 }]))
      .toEqual({ skor: 0, kullanilan: 1, toplam: 1, eksik: [] });
  });

  it('8 · ağırlıklı toplam (6k Lojistik vektörü): 100/50/0/100 × 0,4/0,3/0,2/0,1 → 65, YUVARLANMAZ, KIRPILMAZ', () => {
    const lojistik = bilesikSkor([
      { ad: 'Zamanında Teslim', puan: 100, agirlik: 0.4 },
      { ad: 'Rota Verimi', puan: 50, agirlik: 0.3 },
      { ad: 'Hasar Oranı', puan: 0, agirlik: 0.2 },
      { ad: 'Araç Doluluk', puan: 100, agirlik: 0.1 },
    ]);
    expect(lojistik.skor).toBe(65);
    expect(lojistik.kullanilan).toBe(4);

    // Ondalık kalır — modül içinde Math.round → 33 → kırmızı.
    expect(bilesikSkor([{ ad: 'Ciro', puan: 33.33, agirlik: 1 }]).skor).toBe(33.33);
    // Kırpma çağıranın işi (GB5 emsali) — modülde Math.min(100, …) → 100 → kırmızı.
    expect(bilesikSkor([{ ad: 'Ciro', puan: 30, agirlik: 4 }]).skor).toBe(120);
    // Negatif puan da bilinen bir puandır (iade fazlası gibi); işaret korunur.
    expect(bilesikSkor([{ ad: 'Ciro', puan: -10, agirlik: 2 }]).skor).toBe(-20);
  });
});

describe('bilesikSkor — bilinmeyen 0 SAYILMAZ', () => {
  it.each(['Ciro', 'Sipariş Adedi', 'Müşteri Sayısı', 'AOV'])(
    '2 · yalnız "%s" bilinmiyor → skor null, kullanilan 3/4, eksik tek ve doğru ad',
    (eksikAd) => {
      const girdi = GB3_VEKTORU.map(b => (b.ad === eksikAd ? { ...b, puan: null } : b));
      const s = bilesikSkor(girdi);
      // Mutasyon: bilinenleri toplayan KISMİ skor (45 − o bileşen) → `skor` sayı olur → kırmızı.
      expect(s.skor).toBeNull();
      expect(s.kullanilan).toBe(3);
      expect(s.toplam).toBe(4);
      expect(s.eksik).toEqual([eksikAd]);
    },
  );

  it('3 · hepsi bilinmiyor → skor null, kullanilan 0, eksik dört ad GİRDİ SIRASIYLA', () => {
    const s = bilesikSkor(GB3_VEKTORU.map(b => ({ ...b, puan: null })));
    expect(s).toEqual({ skor: null, kullanilan: 0, toplam: 4, eksik: ['Ciro', 'Sipariş Adedi', 'Müşteri Sayısı', 'AOV'] });
  });

  it('4 · boş liste → skor null (0 DEĞİL), kullanilan 0, toplam 0, eksik []', () => {
    // Mutasyon: `reduce(…, 0)` → skor 0 → ekranda "📉 Düşüş" rozeti. Burada null: rozet çizilmez.
    expect(bilesikSkor([])).toEqual({ skor: null, kullanilan: 0, toplam: 0, eksik: [] });
  });

  it.each<[string, unknown]>([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ["'25' (metin)", '25'],
    ['undefined', undefined],
    ['nesne', { deger: 25 }],
  ])('6 · sonlu olmayan puan %s → eksik, skor null', (_ad, puan) => {
    // Mutasyon: global `isFinite('25')` true döner → metin puan toplanır → skor 25 → kırmızı.
    const s = bilesikSkor(ham([{ ad: 'Ciro', puan, agirlik: 1 }]));
    expect(s).toEqual({ skor: null, kullanilan: 0, toplam: 1, eksik: ['Ciro'] });
  });

  it('6b · karışık liste: sonlu olmayanların HEPSİ eksik, bilinen tek bileşen sayılır ama skor yine null', () => {
    const s = bilesikSkor(ham([
      { ad: 'Ciro', puan: NaN, agirlik: 1 },
      { ad: 'Sipariş Adedi', puan: 15, agirlik: 1 },
      { ad: 'Müşteri Sayısı', puan: '5', agirlik: 1 },
      { ad: 'AOV', puan: undefined, agirlik: 1 },
      { ad: 'İade', puan: -Infinity, agirlik: 1 },
    ]));
    expect(s.skor).toBeNull();
    expect(s.kullanilan).toBe(1);
    expect(s.toplam).toBe(5);
    expect(s.eksik).toEqual(['Ciro', 'Müşteri Sayısı', 'AOV', 'İade']);
  });

  it.each<[string, unknown]>([
    ['NaN', NaN],
    ['undefined (gizli `= 1` varsayılanı YOK)', undefined],
    ['Infinity', Infinity],
    ["'1' (metin)", '1'],
  ])('7 · ağırlık okunamıyor (%s) → bileşen eksik, skor null', (_ad, agirlik) => {
    // Mutasyon: ağırlığı 0 (ya da 1) sayıp skoru üretmek → skor sayı → kırmızı.
    const s = bilesikSkor(ham([{ ad: 'AOV', puan: 20, agirlik }]));
    expect(s).toEqual({ skor: null, kullanilan: 0, toplam: 1, eksik: ['AOV'] });
  });

  it('7b · ağırlığı 0 olan bileşen BİLİNİR (katkısı 0) — okunamayan ile karıştırılmaz', () => {
    const s = bilesikSkor([{ ad: 'Ciro', puan: 25, agirlik: 1 }, { ad: 'AOV', puan: 99, agirlik: 0 }]);
    expect(s).toEqual({ skor: 25, kullanilan: 2, toplam: 2, eksik: [] });
  });

  it('savunma kapısı · toplam sonlu değilse (taşma) skor null, eksik BOŞ kalır', () => {
    const s = bilesikSkor([{ ad: 'Ciro', puan: Number.MAX_VALUE, agirlik: 2 }]);
    expect(s).toEqual({ skor: null, kullanilan: 1, toplam: 1, eksik: [] });
  });

  it('ad tekrar edebilir; eksik girdi sırasını ve tekrarı korur', () => {
    const s = bilesikSkor([
      { ad: 'Ciro', puan: null, agirlik: 1 },
      { ad: 'AOV', puan: 5, agirlik: 1 },
      { ad: 'Ciro', puan: null, agirlik: 1 },
    ]);
    expect(s.eksik).toEqual(['Ciro', 'Ciro']);
    expect(s.kullanilan).toBe(1);
    expect(s.toplam).toBe(3);
  });
});

describe('bilesikSkor — değişmez + mutasyonsuzluk', () => {
  /** Deterministik LCG — "rastgele karışık" girdi, her koşuda aynı. */
  const lcg = (tohum: number) => () => { tohum = (tohum * 1103515245 + 12345) % 2147483648; return tohum / 2147483648; };

  it('9 · her karışık girdide kullanilan + eksik.length === toplam; eksik = bilinmeyenlerin girdi sırası', () => {
    const rnd = lcg(2026_09_24);
    const havuz: readonly unknown[] = [0, 5, 15, 25, 33.33, -4, null, undefined, NaN, Infinity, -Infinity, '25'];
    for (let tur = 0; tur < 40; tur++) {
      const n = Math.floor(rnd() * 9);
      const girdi: HamBilesen[] = Array.from({ length: n }, (_, i) => ({
        ad: `B${i}`,
        puan: havuz[Math.floor(rnd() * havuz.length)],
        agirlik: rnd() < 0.15 ? NaN : 1,
      }));
      const s = bilesikSkor(ham(girdi));
      expect(s.toplam).toBe(n);
      expect(s.kullanilan + s.eksik.length).toBe(n);
      const beklenenEksik = girdi
        .filter(b => !(typeof b.puan === 'number' && Number.isFinite(b.puan) && typeof b.agirlik === 'number' && Number.isFinite(b.agirlik)))
        .map(b => b.ad);
      expect(s.eksik).toEqual(beklenenEksik);
      if (s.eksik.length > 0) expect(s.skor).toBeNull();
      else if (n > 0) expect(typeof s.skor).toBe('number');
      else expect(s.skor).toBeNull();
    }
  });

  it('9b · `Object.freeze`li dizi/öğelerle çağrı hata ATMAZ, girdi değişmez', () => {
    const donmus = Object.freeze(GB3_VEKTORU.map(b => Object.freeze({ ...b })));
    const kopya = JSON.stringify(donmus);
    expect(() => bilesikSkor(donmus)).not.toThrow();
    expect(bilesikSkor(donmus).skor).toBe(45);
    expect(JSON.stringify(donmus)).toBe(kopya);
    // Dönen `eksik` çağıranın dizisi değil, yeni dizidir (çağıran değiştirse girdi bozulmaz).
    const s = bilesikSkor(donmus);
    s.eksik.push('x');
    expect(bilesikSkor(donmus).eksik).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// esikBandi
// ---------------------------------------------------------------------------

describe('esikBandi — parite merdiveni (GB3:87-89 ve :101 tek çağrıya iner)', () => {
  it.each<[number, MomentumBandi]>([
    [100, 'guclu'],
    [80, 'guclu'],      // sınır DÂHİL
    [79.9, 'orta'],
    [50, 'orta'],
    [49.9, 'stabil'],
    [25, 'stabil'],
    [24.9, 'dusus'],
    [0, 'dusus'],
    [-5, 'dusus'],
  ])('10 · %s → %s', (skor, bant) => {
    // Mutasyon: `>=` yerine `>` → 80/50/25 sınırları bir alt banda kayar → kırmızı.
    expect(esikBandi(skor, MOMENTUM_BANTLARI)).toBe(bant);
  });

  it('10b · eski satır içi merdivenle BİREBİR: 0..100 tam sayı taraması', () => {
    const eskiMerdiven = (s: number): MomentumBandi => (s >= 80 ? 'guclu' : s >= 50 ? 'orta' : s >= 25 ? 'stabil' : 'dusus');
    for (let s = -10; s <= 110; s++) expect(esikBandi(s, MOMENTUM_BANTLARI)).toBe(eskiMerdiven(s));
  });

  it.each<[string, number | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('11 · bilinmeyen değer %s → null (rozet ÇİZİLMEZ)', (_ad, deger) => {
    // Mutasyon: `Infinity >= 80` true → en üst bandı kazanır → kırmızı. Sonsuz skor hesap hatasıdır.
    expect(esikBandi(deger, MOMENTUM_BANTLARI)).toBeNull();
  });
});

describe('esikBandi — sıra bağımsızlığı, kararlılık, taban bandı', () => {
  it('13 · bantlar karışık sırada → aynı sonuç', () => {
    const karisik: readonly BantTanimi<MomentumBandi>[] = [
      { altSinir: 25, deger: 'stabil' },
      { altSinir: -Infinity, deger: 'dusus' },
      { altSinir: 80, deger: 'guclu' },
      { altSinir: 50, deger: 'orta' },
    ];
    // Mutasyon: "ilk eşleşen kazanır" → 100 için 'stabil' → kırmızı.
    for (const s of [100, 80, 79.9, 50, 49.9, 25, 24.9, 0, -5]) {
      expect(esikBandi(s, karisik)).toBe(esikBandi(s, MOMENTUM_BANTLARI));
    }
    expect(esikBandi(100, karisik)).toBe('guclu');
  });

  it('13b · eşit altSinir → dizide ÖNCE gelen kazanır (kararlı); dönen deger çağıranın nesnesidir', () => {
    const birinci = { etiket: 'A' };
    const ikinci = { etiket: 'B' };
    const bantlar: readonly BantTanimi<{ etiket: string }>[] = [
      { altSinir: 50, deger: birinci },
      { altSinir: 50, deger: ikinci },
      { altSinir: -Infinity, deger: { etiket: 'taban' } },
    ];
    expect(esikBandi(60, bantlar)).toBe(birinci);   // toBe: kopyalanmaz
    expect(esikBandi(60, [bantlar[1], bantlar[0], bantlar[2]])).toBe(ikinci);
  });

  it('13c · altSinir NaN olan bant hiç eşleşmez; +Infinity altSinir sonlu değere eşleşmez', () => {
    const bantlar: readonly BantTanimi<string>[] = [
      { altSinir: NaN, deger: 'bozuk' },
      { altSinir: Infinity, deger: 'ulasilmaz' },
      { altSinir: 10, deger: 'on' },
      { altSinir: -Infinity, deger: 'taban' },
    ];
    expect(esikBandi(1e9, bantlar)).toBe('on');
    expect(esikBandi(5, bantlar)).toBe('taban');
    expect(esikBandi(5, [{ altSinir: NaN, deger: 'bozuk' }])).toBeNull();
  });

  it('13d · hiçbir bant eşleşmezse null — taban bandı ÇAĞIRANIN açık yazımıdır, sessiz yedek YOK', () => {
    const tabansiz: readonly BantTanimi<string>[] = [{ altSinir: 80, deger: 'guclu' }, { altSinir: 50, deger: 'orta' }];
    // Mutasyon: "eşleşme yoksa son bandı ver" → 'orta' → kırmızı.
    expect(esikBandi(10, tabansiz)).toBeNull();
    expect(esikBandi(50, tabansiz)).toBe('orta');
    expect(esikBandi(10, [])).toBeNull();
  });

  it('13e · girdi dizisi ve bantlar MUTASYONA uğramaz (Object.freeze ile çağrı hata atmaz)', () => {
    const donmus = Object.freeze(MOMENTUM_BANTLARI.map(b => Object.freeze({ ...b })));
    const kopya = JSON.stringify(donmus);
    expect(() => esikBandi(45, donmus)).not.toThrow();
    expect(esikBandi(45, donmus)).toBe('stabil');
    expect(JSON.stringify(donmus)).toBe(kopya);
  });
});

// ---------------------------------------------------------------------------
// Büyüme merdiveni paritesi + uçtan uca panel senaryosu (GB3 P260)
// ---------------------------------------------------------------------------

describe('büyüme merdiveni — GB3:83 paritesi (çarpan PAYDA tarafında)', () => {
  it('12 · prev=144, curr=129,6: payda biçimi eski satırla AYNI bandı verir; `curr/prev >= k` biçimi AYRIŞIR', () => {
    // Şartnamenin örneği (prev 3, curr 3.3000000000000003) bu HEAD'de ölçüldü: iki biçim de aynı
    // sonucu veriyor — ayrışmıyor. Gerçek ayrışan çift 0,9 basamağında: 144 × 0,9 = 129,6 ama
    // 129,6 / 144 = 0.8999999999999999 < 0,9. Payda biçimi eski satırla bit düzeyinde aynıdır.
    const prev = 144;
    const curr = prev * MOMENTUM_BUYUME_CARPANI.hafifDusus;
    expect(curr).toBe(129.6);

    const paydaBicimi = esikBandi(curr, buyumeBantlari(prev));
    const eski = eskiPuan(curr, prev);
    const bolmeBicimi = curr / prev >= 1.1 ? 25 : curr / prev >= 1 ? 15 : curr / prev >= 0.9 ? 5 : 0;

    expect(eski).toBe(5);                         // hafif düşüş — bugünkü ekran
    expect(paydaBicimi).toBe(eski);               // KİLİT: payda biçimi
    expect(bolmeBicimi).not.toBe(eski);           // belge: bölme biçimi sessiz puan sapması üretir
    expect(bolmeBicimi).toBe(0);
  });

  it('12b · sonlu (curr, prev) ızgarasında `metrikPuani` eski satırla BİREBİR (prev ≤ 0 tabansız dal dâhil)', () => {
    const degerler = [-50, -1, 0, 0.5, 1, 9, 8.1, 10, 11, 89.9, 90, 99.99, 100, 110, 110.00001, 129.6, 144, 1_000_000];
    for (const prev of degerler) {
      for (const curr of degerler) {
        expect(metrikPuani(curr, prev), `curr=${curr} prev=${prev}`).toBe(eskiPuan(curr, prev));
      }
    }
  });
});

describe('uçtan uca — P260 panel senaryosu', () => {
  /** Metrik dizisi GB3 biçiminde: `curr/prev: number`, NaN = bilinmiyor (KAPI YAMASI: kaynaklar null değil NaN üretir). */
  const panel = (metrikler: readonly { ad: string; curr: number; prev: number }[]) => {
    const sonuc = bilesikSkor(metrikler.map(m => ({ ad: m.ad, puan: metrikPuani(m.curr, m.prev), agirlik: 1 })));
    return { ...sonuc, bant: esikBandi(sonuc.skor, MOMENTUM_BANTLARI) };
  };
  const tamVeri = [
    { ad: 'Ciro', curr: 132_000, prev: 120_000 },        // ≥ %110 → 25
    { ad: 'Sipariş Adedi', curr: 41, prev: 40 },         // ≥ %100 → 15
    { ad: 'Müşteri Sayısı', curr: 18, prev: 19 },        // ≥ %90 → 5
    { ad: 'AOV', curr: 3_219, prev: 3_800 },             // < %90 → 0
  ];

  it('14 · tam veri: 45 + "stabil"; AOV bilinmiyorsa skor null → bant null → rozet de çubuk da yok', () => {
    expect(panel(tamVeri)).toEqual({ skor: 45, kullanilan: 4, toplam: 4, eksik: [], bant: 'stabil' });

    const aovBilinmiyor = tamVeri.map(m => (m.ad === 'AOV' ? { ...m, curr: NaN } : m));
    const s = panel(aovBilinmiyor);
    expect(s.skor).toBeNull();
    expect(s.bant).toBeNull();
    expect(s.eksik).toEqual(['AOV']);
    expect(`${s.kullanilan}/${s.toplam}`).toBe('3/4');   // "3/4 bileşen hesaplanamadı" cümlesinin girdisi
  });

  it('14a · prev NaN, curr > 0 → puan null (UYDURMA 15 DEĞİL)', () => {
    // Mutasyon: `m.prev === null` kapısı → NaN geçer → `NaN > 0` false → tabansız dal → 15 → kırmızı.
    expect(metrikPuani(1_500, NaN)).toBeNull();
    const s = panel(tamVeri.map(m => (m.ad === 'Ciro' ? { ...m, prev: NaN } : m)));
    expect(s.skor).toBeNull();
    expect(s.eksik).toEqual(['Ciro']);
  });

  it('14b · prev ve curr ikisi NaN → puan null (0 DEĞİL); skor bu metriksiz HESAPLANMAZ', () => {
    // Mutasyon: `=== null` kapısı → tabansız dal → `NaN > 0` false → 0 puan (bilinmeyen 0 sayıldı) → kırmızı.
    expect(metrikPuani(NaN, NaN)).toBeNull();
    const s = panel(tamVeri.map(m => (m.ad === 'Müşteri Sayısı' ? { ...m, curr: NaN, prev: NaN } : m)));
    expect(s.skor).toBeNull();
    expect(s.bant).toBeNull();
    expect(s.kullanilan).toBe(3);
  });

  it('14c · prev sonlu ve > 0, curr NaN → puan null (bilinmeyen tarafta karşılaştırma yapılmaz)', () => {
    // Mutasyon: `NaN >= prev*0.9` hep false → 0 puan → kırmızı.
    expect(metrikPuani(NaN, 3_800)).toBeNull();
  });

  it('14d · tabansız dal PARİTE: prev = 0 iken curr > 0 → 15, curr = 0 → 0 (bugünkü davranış AYNEN)', () => {
    // Bilinçli: "önceki dönem gerçekten 0" (veri var, sipariş yok) ile "önceki dönem bilinmiyor" (NaN)
    // artık ayrışır; birincisi eski puanı korur, ikincisi null olur.
    expect(metrikPuani(500, 0)).toBe(MOMENTUM_TABANSIZ_PUAN);
    expect(metrikPuani(0, 0)).toBe(MOMENTUM_PUANLARI.dusus);
    expect(metrikPuani(500, -20)).toBe(MOMENTUM_TABANSIZ_PUAN);   // negatif prev (iade fazlası) tabansız
  });
});
