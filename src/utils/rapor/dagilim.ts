/**
 * dagilim.ts — rapor ekranlarının DEĞER KOVASI (histogram) çekirdeği. Test: dagilim.test.ts (önce yazıldı).
 * Faz 3 6/n (rapor ekranları), 2026-09-19.
 *
 * NEDEN VAR — "sayısal değeri sınır listesine göre kovala" işi kodda 10+ panelde elle yazılmış,
 * her kopyada aynı iki sahte kesinlik hatasıyla. Ölçülen ilk site
 * src/components/reports/genel/GenelOzet.tsx:168-205 (Phase 189 "Sipariş Değeri Dağılımı"):
 *   178  `const v = o.totalPrice || 0;`
 *   180  `const b = buckets189.find(b => v >= b.min && v < b.max);`
 *   181  `if (b) { b.count++; b.total += v; }`
 * (1) Tutarı bilinmeyen sipariş ₺0 sayılıp `'<₺1K'` kovasını şişiriyor — histogramın sol ucu
 *     gerçek küçük siparişlerle değil, VERİ EKSİĞİYLE dolu görünüyor.
 * (2) `find` eşleşmezse (negatif tutar; ya da son sınır sonlu olduğunda taşan değer) öğe
 *     SESSİZCE düşüyor — hiçbir yerde izi kalmıyor.
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur, toplama
 * girmez ve SAYILIR; sessiz eleme de yoktur, ayrı sayılır. Bu modül o kararı tek yerde uygular.
 *
 * PARİTE: bilinen ve kapsam içi girdide adetler ve kova toplamları P189 ile BİREBİR aynıdır
 * (dagilim.test.ts test 1: `500, 1000, 4999, 250000` → `[1, 2, 0, 0, 1]`).
 *
 * BİLİNÇLİ FARKLAR (rakamı değiştirenler — hepsi yukarıdaki iki arızanın düzeltmesi):
 *   • Tutarı bilinmeyen öğe artık ilk kovada DEĞİL, `bilinmeyen` sayacında.
 *   • Kapsam dışı (negatif / sonlu son sınırı aşan) öğe artık `kapsamDisi` sayacında.
 *   • Kova toplamı çıplak `number` değil `Tutar` — kısmi toplam + bilinen/bilinmeyen sayaçları
 *     (`tutarSec` JIT olarak eklendiğinde kova içi bilinmeyen tutar da sayılabilsin diye).
 * Çağıran bu iki sayacı ekranda göstermeli (CLAUDE.md: '—' ya da açık not).
 *
 * KAPSAM DIŞI (bilerek): iptal süzgeci bu modülde YOK. Rapor ekranlarında ciro = iptaller hariç
 * (kullanıcı kararı K2, 2026-09-19: "İptaller ciroya girsin mi → hayır") ve bu kural TEK yerde,
 * `raporCirosu`/çağıranın süzgecinde durur — kovalayıcı kendisine ne verilirse onu kovalar.
 * `siraliDilimler` (6b eki) de aynı karardadır: `status` OKUMAZ; GB3 çeyreklik paneli (`:121`) bugün HAM
 * `orders` geçiyor (iptaller dâhil) — K2 gereği bağlama süzgeci ÇAĞIRANA konur, rakam DEĞİŞİR (beklenen).
 *
 * ## 6b EKİ (2026-09-24, Faz 3 6/n Genel I) — `siraliDilimler` (ADDITIVE; `kovayaYerlestir` DOKUNULMADI)
 * `kovayaYerlestir` DEĞER SINIRINA göre kovalar; `siraliDilimler` POZİSYONA göre böler (sırala → eşit parçalar).
 * İki ayrı iş, tek fonksiyona sıkıştırılmadı. Neden var — iki panel aynı işi elle ve FARKLI bölerek yapıyor
 * (src/components/reports/genel/GenelBloklar3.tsx, HEAD 912d750):
 *   A · :21-57 Sipariş Büyüklüğü Desil Analizi (Phase 256)
 *     :22  `orders.filter(o => o.status !== 'Cancelled' && (o.totalPrice || 0) > 0)` — bilinmeyen '0' sayılıp
 *          ELENİYOR ama SAYILMIYOR; `totalAmount` yedeği yok
 *     :24  `sort((a, b) => (a.totalPrice || 0) - (b.totalPrice || 0))`             — `|| 0` bilinmeyeni D1'e koyar
 *     :25  `decileSize = Math.ceil(n / 10)`; `slice(i*size, (i+1)*size)`           — 'tavan' bölmesi (artık: son dilimler BOŞ)
 *     :28  `reduce((s,o) => s + (o.totalPrice || 0), 0)`                            — kısmi toplam sessiz
 *   B · :120-157 Ciro Çeyreklik Analizi
 *     :121 `[...orders].sort((a,b) => a.totalPrice - b.totalPrice)`                 — KORUMASIZ: `undefined - undefined`
 *          → NaN karşılaştırıcı sıralamayı RASTGELE bırakır; ayrıca `orders` HAM (iptaller dâhil → K2)
 *     :123 `q = Math.floor(n / 4)`; `slice(3q)` son dilim kalanı alır                — 'taban' bölmesi
 *     :133 `reduce((s, o) => s + o.totalPrice, 0)`                                  — tek bilinmeyen TÜM çeyreği NaN yapar
 *     :134 `avgOrder: … : 0`                                                        — ortalama TÜRETMEdir → `ortalamaSiparis`
 * PARİTE (K28): iki bölme kuralı da KORUNUR — `DilimBolmesi.bolme: 'tavan' | 'taban'` seçeneğiyle, kopya fonksiyonla
 *   değil; her çağrı yerinde AÇIKÇA verilir (varsayılan YOK). Dilim sınırları POZİSYONA göredir, DEĞERE göre değil:
 *   eşit tutarlı iki sipariş komşu dilimlere düşebilir (bugün de öyle) — arıza değil, TANIM.
 * BİLİNÇLİ FARKLAR (siraliDilimler): bilinmeyen değer sıralamaya bile girmez (`bilinmeyen` sayacı); `sadecePozitif`
 *   ile elenen bilinen `<= 0` değer `kapsamDisi`de (sessiz eleme YOK); `toplam` üst düzey `bilinmeyen` sayacını
 *   TAŞIR → `tamTutar(toplam)` tek tutarsız siparişte NaN, "Üst %30 → %X" rozeti eksik veriyle basılmaz.
 *   Boş dilim TÜRETMEYE KAPI DEĞİLDİR: `'tavan'` n katı değilken son dilimleri boş bırakır; boş dilimin `tutar`ı
 *   `{0,0,0}` ve `tamTutar` 0'dır (NaN DEĞİL — "boş liste gerçek 0", para.ts). Pay kapısını ÇAĞIRAN koyar:
 *   `dilimler.slice(-k).every(d => d.adet > 0)`. Boş dilimi `bilinmeyen++` ile NaN'a çevirmek YASAK (KapsamNotu
 *   "N kayıt tutarsız" diye YALAN söylerdi). Pay / kümülatif / ABC → `rapor/yogunlasma` (kardeş şartname).
 *
 * DOKUNULMADI: `muhasebe/arYaslandirma.yasKovasi` (sabit 4 yaş kovası) ve
 * `siparisler/tahsilatVade` (vade kovaları) alacak yaşlandırmasının AYRI sözleşmesidir
 * (gelecek tarihli kayıt 0–30 kovasına düşer) — buraya indirilmez.
 */
import { bilinenSayi, sayiSirala, tutarBirlestir, type Tutar } from '../para';
import { BOS_TUTAR, kovayaEkle } from '../pano/raporVeriKatmani';

/** Tek bir kovanın tanımı: etiket + ÜST sınır (HARİÇ). Son kova için `ust: Infinity` (üst taşma olmaz). */
export interface KovaSiniri {
  etiket: string;
  /** ÜST sınır, HARİÇ. Son kova için `Infinity`. */
  ust: number;
}

/** Dolu kova: `[alt, ust)` aralığı, öğe adedi, kova içi `Tutar` ve öğelerin kendisi (girdi sırasında). */
export interface DegerKovasi<T> {
  etiket: string;
  alt: number;
  ust: number;
  adet: number;
  tutar: Tutar;
  ogeler: T[];
}

/**
 * İlk kovanın ALT sınırı — SABİT. Bunun altındaki (negatif) değer hiçbir kovaya girmez,
 * `kapsamDisi` sayılır. Negatif değerin de kovalanması gerektiğinde 4. parametre
 * `secenek?: { alt?: number }` ADDITIVE eklenecek (JIT: ilk üretim tüketicisi 6f CB8 yaş dağılımı);
 * 3 parametreli çağrılar aynen derlenir.
 */
const ILK_KOVA_ALT = 0;

/**
 * `liste`yi `degerSec`in verdiği sayıya göre `sinirlar`daki kovalara dağıtır.
 *
 * - Kova aralığı `[alt, ust)`; ilk kovanın `alt`'ı `ILK_KOVA_ALT`, sonrakilerin `alt`'ı bir
 *   öncekinin `ust`'u. Kovalar `sinirlar` sırasında ve BOŞ kovalar dâhil döner (histogram şekli sabit).
 * - `degerSec` bilinmiyorsa (`bilinenSayi` false) öğe hiçbir kovaya girmez → `bilinmeyen++`.
 *   Meşru `0` bilinen bir sayıdır, ilk kovaya girer.
 * - Değer ilk `alt`'ın altında ya da son `ust`'un üstünde/eşitse → `kapsamDisi++` (sessiz eleme yok).
 * - `sinirlar` artan olmalıdır; değilse `throw` (sessizce yanlış kovaya yazmak yerine gürültü).
 *   Boş `sinirlar` ise bilinen her değer `kapsamDisi` olur — çağıranın ekranında görünür.
 * - Girdi (liste ve sınırlar) mutasyona uğramaz; `ogeler` girdi sırasını ve nesne kimliğini korur.
 *
 * DEĞİŞMEZ: `Σ kovalar.adet + bilinmeyen + kapsamDisi === liste.length`.
 */
export function kovayaYerlestir<T>(
  liste: readonly T[],
  degerSec: (o: T) => unknown,
  sinirlar: readonly KovaSiniri[],
): { kovalar: DegerKovasi<T>[]; bilinmeyen: number; kapsamDisi: number } {
  const kovalar: DegerKovasi<T>[] = [];
  let alt = ILK_KOVA_ALT;
  for (const s of sinirlar) {
    // `!(ust > alt)` NaN'ı da yakalar: sınırın kendisi bilinmiyorsa kovalama anlamsızdır.
    if (!(s.ust > alt)) {
      throw new Error(
        `kovayaYerlestir: sınırlar artan olmalı — '${s.etiket}' üst sınırı ${String(s.ust)}, ` +
        `önceki üst sınır (bu kovanın alt sınırı) ${String(alt)}.`,
      );
    }
    kovalar.push({ etiket: s.etiket, alt, ust: s.ust, adet: 0, tutar: BOS_TUTAR, ogeler: [] });
    alt = s.ust;
  }

  let bilinmeyen = 0;
  let kapsamDisi = 0;
  for (const oge of liste) {
    const ham = degerSec(oge);
    if (!bilinenSayi(ham)) { bilinmeyen++; continue; }   // `|| 0` DEĞİL: bilinmeyen kovayı şişirmez
    const deger = Number(ham);
    const kova = kovalar.find(k => deger >= k.alt && deger < k.ust);
    if (kova === undefined) { kapsamDisi++; continue; } // P189'un sessiz düşürdüğü öğe: artık sayılıyor
    kova.adet++;
    kova.tutar = kovayaEkle(kova.tutar, ham);           // BOS_TUTAR donmuş; kovayaEkle YENİ nesne döner
    kova.ogeler.push(oge);
  }

  return { kovalar, bilinmeyen, kapsamDisi };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sıralı eşit dilimler — desil / çeyreklik (6b eki, 2026-09-24)
// ─────────────────────────────────────────────────────────────────────────────

/** Sıralı listenin tek dilimi. Ekran etiketi ('D3', 'Q2 (25–50%)') ÇAĞIRANDA kurulur. */
export interface SiraliDilim<T> {
  /** 1'den başlayan dilim numarası (D1 = en KÜÇÜK değerler). */
  sira: number;
  adet: number;
  /** Dilim içi toplam — `degerSec`in değerlerinden (`kovayaEkle`). `bilinmeyen` her zaman 0'dır:
   *  bilinmeyen değer hiçbir dilime GİRMEZ (üst düzey `bilinmeyen` sayacındadır). */
  tutar: Tutar;
  /** Girdi sırasını ve nesne kimliğini koruyan öğeler (dilim içinde DEĞERE göre artan). */
  ogeler: T[];
}

export interface DilimBolmesi {
  /**
   * PARİTE gereği her çağrı yerinde AÇIKÇA verilir (varsayılan YOK — sessiz yanlış bölme olmasın):
   *  • 'tavan' → `boyut = Math.ceil(n / dilimSayisi)`, dilim i = `[i*boyut, (i+1)*boyut)`.
   *    Artık SON dilimlerde BOŞLUK bırakır (GB3 desil paritesi, `:25`).
   *  • 'taban' → `boyut = Math.floor(n / dilimSayisi)`; SON dilim kalanı da alır
   *    (GB3 çeyreklik paritesi, `:123-129`).
   */
  bolme: 'tavan' | 'taban';
  /** true → bilinen ama `<= 0` değer dilime GİRMEZ, `kapsamDisi` sayılır (GB3 desil `:22`'deki `> 0` süzgecinin
   *  dürüst hâli). Varsayılan false (GB3 çeyreklik paritesi: her değer girer). */
  sadecePozitif?: boolean;
}

/**
 * `liste`yi `degerSec`in verdiği sayıya göre ARTAN sıralar ve `dilimSayisi` eşit parçaya (POZİSYONA göre) böler.
 *
 * - Bilinmeyen değer (`bilinenSayi` false) sıralamaya bile girmez → `bilinmeyen++`. Meşru `0` bilinen bir sayıdır;
 *   `sadecePozitif` verilmedikçe dilime girer.
 * - Sıralama `sayiSirala` ile ARTAN (hücre ile sıralayıcı aynı tanım); `Array.prototype.sort` kararlıdır → eşit
 *   değerler girdi sırasını korur (bugünkü davranış). `[...]` kopya üzerinde sıralanır; girdi mutasyona uğramaz.
 * - `dilimSayisi` pozitif TAM SAYI olmalı; değilse `throw`. `dilimler` uzunluğu HER ZAMAN `dilimSayisi`
 *   (boş dilimler dâhil — grafik şekli sabit).
 * - `toplam`: `tutarBirlestir(...dilimler)` + üst düzey `bilinmeyen` sayacı → `toplam.bilinmeyen === bilinmeyen`.
 *   Böylece `tamTutar(toplam)` tek tutarsız siparişte NaN (rozet ÇİZİLMEZ), `ekranTutari(toplam)` kısmi toplam.
 *   `kapsamDisi` (bilinen ama kapsam dışı) `toplam`ı bilinmez YAPMAZ — o kayıt okunmuştur, yalnız kapsam dışıdır.
 * - Boş dilimin `tutar`ı `{0,0,0}` → `tamTutar` 0 (NaN DEĞİL); "üst dilimlerin payı" kapısı ÇAĞIRANDA
 *   (`dilimler.slice(-k).every(d => d.adet > 0)`).
 * - İptal süzgeci YOK (K2 — çağıranda; bu modül `status` okumaz).
 *
 * DEĞİŞMEZ: `Σ dilimler.adet + bilinmeyen + kapsamDisi === liste.length`.
 */
export function siraliDilimler<T>(
  liste: readonly T[],
  degerSec: (o: T) => unknown,
  dilimSayisi: number,
  secenek: DilimBolmesi,
): {
  dilimler: SiraliDilim<T>[];
  /** TÜM dilimlerin toplamı + `bilinmeyen` sayacı TAŞINMIŞ hâli (türetmeye kapalı). */
  toplam: Tutar;
  /** `degerSec` bilinmeyen (bilinenSayi false) — hiçbir dilime girmez, SAYILIR. */
  bilinmeyen: number;
  /** `sadecePozitif` ile elenen bilinen `<= 0` değer — sessiz eleme YOK. */
  kapsamDisi: number;
} {
  if (!Number.isInteger(dilimSayisi) || dilimSayisi <= 0) {
    throw new Error(`siraliDilimler: dilimSayisi pozitif tam sayı olmalı (geldi: ${String(dilimSayisi)})`);
  }

  let bilinmeyen = 0;
  let kapsamDisi = 0;
  const bilinenler: { oge: T; deger: number }[] = [];
  for (const oge of liste) {
    const ham = degerSec(oge);
    if (!bilinenSayi(ham)) { bilinmeyen += 1; continue; }        // `|| 0` DEĞİL: bilinmeyen D1'i şişirmez
    const deger = Number(ham);
    if (secenek.sadecePozitif === true && deger <= 0) { kapsamDisi += 1; continue; }   // sessiz `filter` DEĞİL
    bilinenler.push({ oge, deger });
  }
  // Kararlı sıralama: eşit değerler girdi sırasını korur (kopya üzerinde; girdi dizisi değişmez).
  bilinenler.sort((a, b) => sayiSirala(a.deger, b.deger));

  const n = bilinenler.length;
  const boyut = secenek.bolme === 'tavan' ? Math.ceil(n / dilimSayisi) : Math.floor(n / dilimSayisi);
  const dilimler: SiraliDilim<T>[] = Array.from({ length: dilimSayisi }, (_, i) => {
    const bas = i * boyut;
    // 'taban': SON dilim kalanı da alır (GB3 `slice(3q)`); 'tavan': her dilim tam `boyut` (son dilimler boş kalabilir).
    const son = secenek.bolme === 'taban' && i === dilimSayisi - 1 ? n : (i + 1) * boyut;
    const parca = bilinenler.slice(bas, son);
    let tutar: Tutar = BOS_TUTAR;
    for (const p of parca) tutar = kovayaEkle(tutar, p.deger);   // hepsi bilinen → `bilinmeyen` 0 kalır
    return { sira: i + 1, adet: parca.length, tutar, ogeler: parca.map(p => p.oge) };
  });

  const dilimToplami = tutarBirlestir(...dilimler.map(d => d.tutar));
  // Üst düzey sayaç TAŞINIR: tek tutarsız sipariş `tamTutar(toplam)`ı NaN yapar (rozet çizilmez).
  const toplam: Tutar = { ...dilimToplami, bilinmeyen: dilimToplami.bilinmeyen + bilinmeyen };
  return { dilimler, toplam, bilinmeyen, kapsamDisi };
}
