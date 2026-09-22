/**
 * sayac.ts — Rapor ekranlarının ADET SAYACI (Faz 3 6a, grup "sayac", 2026-09-19).
 * Test: sayac.test.ts (ÖNCE yazıldı, kırmızı görüldü). Saf modül — React/DB/metin yok,
 * içe aktarım yok.
 *
 * ## Neden var
 *
 * Rapor dosyalarında `acc[k] = (acc[k] || 0) + 1` kalıbı 58 satırda yaşıyor. İki sebeple
 * tek yere toplanıyor:
 *
 *  1. Kapanış ölçüsü `grep -nE "(\|\||\?\?)\s*0\b"` bu satırlara takılıyor. Sayaçta 0
 *     başlangıcı MEŞRUDUR (sayım bir tutar değil, kayıt adedidir — "hiç görülmedi"
 *     gerçekten 0'dır), ama 58 satırı tek tek istisna diye raporlamak ölçüyü işlevsiz
 *     kılardı. Emsal: 1/n, 2/n ve 5/n sayaçları utils'e taşıyıp ölçüyü 0'la kapattı.
 *
 *  2. Kalıbın KENDİSİ hata taşıyor: anahtar boşken obje anahtarı `'undefined'` METNİ
 *     oluyor ve ekranda gerçek bir kova gibi çiziliyor. Somut arıza — İK departman
 *     pastasındaki 'undefined' dilimi:
 *
 *       src/components/reports/useReportsData.ts
 *         102  acc[e.department] = (acc[e.department] || 0) + 1   → departman pastası
 *         210  acc[o.status]     = (acc[o.status]     || 0) + 1   → sipariş durumu pastası
 *
 *     Departmanı girilmemiş çalışan "undefined departmanında çalışıyor" gibi görünüyordu.
 *     Doğrusu (CLAUDE.md): bilinmeyen anahtar UYDURULMAZ — kayıt hiçbir kovaya girmez ama
 *     SAYILIR; çağıran ya dürüst bir "Belirtilmemiş" dilimi çizer ya da kapsam notu basar.
 *
 * ## Parite
 *
 * Anahtarı bilinen girdide sayılar eskiyle BİREBİR aynıdır; satır sırası da aynıdır
 * (metin anahtarlarda `Object.entries(reduce)` sırası = ekleme sırası = `Map` sırası).
 * `toplam` her zaman `liste.length`'tir: Σ sayilar + anahtarsiz === toplam.
 *
 * ## Bilinçli farklar (eski kalıba göre)
 *
 *  1. `undefined` / `null` / `''` / yalnız boşluk / nesne / dizi / `NaN` / `Infinity` /
 *     boolean anahtar → `anahtarsiz++`. `'undefined'`, `'null'`, `'[object Object]'`,
 *     `'NaN'`, `'true'` kovaları ASLA oluşmaz.
 *  2. Metin anahtar `trim`'lenir: `'Satış '` ile `'Satış'` TEK kovadır (eskiden iki dilim).
 *  3. Sonlu SAYI anahtar `String(n)` olur; `0` geçerli anahtardır (`if (!k)` biçimli bir
 *     koruma 0'ı düşürürdü — düşürmüyoruz).
 *  4. Tamsayı-benzeri anahtarlarda sıra: `Map` ilk görülme sırasını korur, eski
 *     `Object.entries` ise artan sayısal sıraya sokuyordu. Gerçek çağrı yerlerinde anahtar
 *     metindir (departman, sipariş durumu) → görünür fark yok. (Test 9 bunu kilitler.)
 *
 * ## Kapsam
 *
 * Bu modülde KULLANICI METNİ yoktur; "Belirtilmemiş" gibi etiketler çağırandan gelir
 * (canlıda ORTAK sözlük: `oc(dil).belirtilmemis`). 2026-09-19 KARARLAR.md'deki hiçbir
 * madde bu modülün RAKAMINI değiştirmez — sayım paritesi korunur; değişen tek şey
 * uydurma anahtarın kalkmasıdır.
 *
 * JIT: `sira: 'azalan'` seçeneği 6a'da tüketicisiz (ölçüldü: 0 kullanım) → YAZILMADI.
 * İlk ihtiyaç duyan alt faz, testleriyle ADDITIVE ekler (isteğe bağlı parametre).
 *
 * Kardeş sözleşme: `pano/stokSevkiyat.durumDagilimi` SABİT anahtar listesiyle çalışır
 * (bilinmeyen → `diger`) ve AYRI bir sözleşmedir — anahtar kümesi önceden belli olan
 * paneller ona, açık uçlu sayımlar buraya bağlanır.
 */

export interface AdetSayimi {
  /** Anahtar → adet. Sıra = İLK GÖRÜLME (eski `Object.entries(reduce)` sırasıyla parite). */
  sayilar: Map<string, number>;
  /** Anahtarı çözülemeyen kayıt — hiçbir kovaya girmez, SAYILIR. */
  anahtarsiz: number;
  /** liste.length — değişmez: Σ sayilar + anahtarsiz === toplam. */
  toplam: number;
}

/**
 * Ham anahtarı kova adına çevirir; çözülemiyorsa `null` (kayıt `anahtarsiz` sayılır).
 * Global `isFinite` DEĞİL `Number.isFinite`: `isFinite('5')` true döndürüp metni sayıya
 * zorlardı.
 */
function anahtarCoz(ham: unknown): string | null {
  if (typeof ham === 'string') {
    const t = ham.trim();
    return t === '' ? null : t;
  }
  if (typeof ham === 'number') {
    // `0` MEŞRU anahtardır; `NaN`/`Infinity` değildir.
    return Number.isFinite(ham) ? String(ham) : null;
  }
  return null;
}

/**
 * `liste`yi `anahtarSec`'in döndürdüğü anahtara göre SAYAR.
 * Girdi dizisi ve öğeleri okunur, değiştirilmez.
 */
export function adetSay<T>(liste: readonly T[], anahtarSec: (o: T) => unknown): AdetSayimi {
  const sayilar = new Map<string, number>();
  let anahtarsiz = 0;

  for (const o of liste) {
    const k = anahtarCoz(anahtarSec(o));
    if (k === null) {
      // Bilinmeyen anahtar ÇİFT SAYILMAZ: kovaya yazılmaz, yalnız burada sayılır.
      anahtarsiz += 1;
      continue;
    }
    const mevcut = sayilar.get(k);
    sayilar.set(k, mevcut === undefined ? 1 : mevcut + 1);
  }

  return { sayilar, anahtarsiz, toplam: liste.length };
}

/**
 * Sayımı recharts'ın beklediği `{ name, value }` dizisine çevirir. Sıra = ilk görülme.
 *
 * `anahtarsizEtiketi` verildiyse VE anahtarsız kayıt varsa SONA tek satır eklenir —
 * sayım olduğu için bu dürüsttür: dilimlerin toplamı yine `toplam`'dır. Etiket
 * verilmezse anahtarsızlar satır OLMAZ; farkı çağıran kapsam notuyla ("N kayıt
 * belirtilmemiş") anlatır. Boş/yalnız boşluk etiket, adsız bir dilim çizmemek için
 * "verilmemiş" sayılır.
 */
export function sayimSatirlari(
  s: AdetSayimi,
  secenek?: { anahtarsizEtiketi?: string },
): { name: string; value: number }[] {
  const satirlar: { name: string; value: number }[] = [];
  for (const [name, value] of s.sayilar) satirlar.push({ name, value });

  const etiket = secenek?.anahtarsizEtiketi;
  if (etiket !== undefined && etiket.trim() !== '' && s.anahtarsiz > 0) {
    satirlar.push({ name: etiket, value: s.anahtarsiz });
  }
  return satirlar;
}
