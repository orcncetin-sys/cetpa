/**
 * skor.ts — Bileşik skor + eşik bandı (Faz 3 6b, grup "utils-skor", 2026-09-24).
 * Test: skor.test.ts (ÖNCE yazıldı, kırmızı görüldü). Saf modül — React/DB/metin/dil yok,
 * İÇE AKTARIM YOK (`para.ts` bile: puanlar buraya `number | null` olarak GELİR; `Tutar → number`
 * çevirimi `tamTutar` ile ÇAĞIRANDA yapılır, çünkü skor girdileri hem para hem adet olabilir —
 * modül birimden bağımsızdır).
 *
 * ## Neden var
 *
 * Tek canlı tüketici: `src/components/reports/genel/GenelBloklar3.tsx` P260 "⚡ Satış Momentum
 * Skoru" (satır 59-118). Erişilebilirlik ÖLÇÜLDÜ, panel CANLI: `ReportsDashboard.tsx:22` lazy +
 * `:90` `{reportsTab === 'genel' && <GenelRapor …/>}` → `GenelRapor.tsx:23` import + `:72`
 * `<GenelBloklar3 …/>`. (HEAD b95fc18; şartname teyidi 912d750 — arada GB3'e dokunulmadı.)
 *
 * Aynı kutuda üç ayrı arıza (satır numaraları HEAD'de `grep -n` ile teyitli):
 *
 *   83   score: m.prev > 0 ? (m.curr >= m.prev * 1.1 ? 25 : m.curr >= m.prev ? 15
 *                            : m.curr >= m.prev * 0.9 ? 5 : 0) : (m.curr > 0 ? 15 : 0)
 *        → Girdiler `:75`/`:78`'de `|| 0` ile eksiltilmiş toplamlar. Tutarı okunamayan TEK sipariş
 *          dönemin cirosunu düşürür, ekran bunu "düşüş" sanıp HÜKÜM basar. Önceki dönemin cirosu
 *          tamamen okunamıyorsa `prev` 0 çıkar, `prev > 0` kapısı düşer ve `(m.curr > 0 ? 15 : 0)`
 *          yedeği UYDURMA 15 PUAN yazar — "veri yok" ile "taban yok" ayrımı kayboluyor.
 *   85   const momentumScore = scored.reduce((s, m) => s + m.score, 0)
 *   86   const maxScore = 100
 *        → `reduce(…, 0)` boş/kısmi listede de SAYI döner; kısmi bileşenden üretilen skor ekranda
 *          `45/100` diye kesin bir rakam gibi basılır (`:97`).
 *   87-89 rozet merdiveni (>= 80 / >= 50 / >= 25 / diğer) — etiket + renk
 *   101  AYNI merdivenin İKİNCİ KOPYASI — ilerleme çubuğu rengi
 *        → Biri düzeltilip öteki unutulursa rozet ile çubuk farklı şey söyler (kopya kod sınıfı,
 *          KÖK NEDEN 2026-09-04).
 *
 * Kural (CLAUDE.md): skor TÜRETİLEN sayıdır. Tek girdisi bile bilinmiyorsa HESAPLANMAZ → `null`;
 * ekranda '—', rozet ve çubuk ÇİZİLMEZ. `0` gerçek bir puandır, bilinmeyen DEĞİLDİR.
 *
 * ## Kopya yazma kapısı
 *
 * `git grep -n "export function" -- src/utils src/lib` → bileşik/ağırlıklı skor üreten ya da eşik
 * merdivenini genelleyen yardımcı YOK. En yakın ikisi bilerek AYRI bırakıldı:
 *   - `muhasebe/kdvAylik.yaslandirmaSeviyesi(gun, esikler): number` — ARTAN gün eşiklerinde indeks,
 *     "yüksek = kötü", `null` kabul etmez; alacak yaşlandırma sözleşmesi. KAPALI, dokunulmadı.
 *   - `muhasebe/arYaslandirma.eskalasyonSeviyesi(gun)` — sabit gün eşikleri, aynı yön. Dokunulmadı.
 * İkisi de "yüksek iyi" yönünde çalışmıyor ve bilinmeyen girdiyi taşımıyor.
 *
 * PLAN-v2 Y15 ikinci fonksiyona `harfNotu(skor, esikler): string | null` diyordu; GB3'ün bandı
 * `string` değil, iki dilli etiket + iki Tailwind sınıfı taşır ve aynı merdiven şekli `:83`'te
 * ORAN üzerinde de var. Bu yüzden ikinci export genel adıyla `esikBandi<T>`; PLAN'ın `harfNotu`su
 * 6c'de AYRI FONKSİYON değil, bir çağrıdır: `esikBandi(skor, HARF_BANTLARI)`.
 *
 * ## Parite
 *
 * - Tam veride skor ve bant BİREBİR AYNI: GB3'ün dört bileşeni tamsayı puan (0/5/15/25) × ağırlık 1
 *   üretir; Σ aynı, eşikler (80/50/25) tamsayı olduğu için bant da aynı (test 1, 10, 10b).
 * - Büyüme merdiveni çarpanı PAYDA tarafında kalır: `esikBandi(curr, [{altSinir: prev * 1.1}, …])`
 *   eski `curr >= prev * 1.1` ile bit düzeyinde aynıdır. `curr / prev >= 1.1` biçimine ÇEVİRMEK
 *   YASAK — kayan noktada ayrışır (ölçüldü: prev 144, curr 129,6 → payda 5 puan, bölme 0 puan).
 *   Test 12 bunu kilitler; test 12b sonlu ızgarada eski satırla birebir parite.
 * - `prev > 0` kapısı çağıranda AYNEN kalır: negatif `prev` bugün de tabansız dala düşüyordu.
 * - Değişen tek şey: girdisi bilinmeyen vakanın artık sayı ÜRETMEMESİ.
 *
 * ## Bilinçli farklar (görünür değişiklik)
 *
 *  1. Kısmi veride skor BASILMAZ: `skor: null`, rozet ve çubuk yok, çağıran "N/4 bileşen
 *     hesaplanamadı: …" cümlesini `kullanilan`/`toplam`/`eksik`ten kurar. Uydurma 15 puan kalkar.
 *  2. Haritanın "maxScore paydadan düşsün" önerisi UYGULANMADI: paydası her dönem değişen skor
 *     dönemler arası kıyaslanamaz ve hâlâ kısmi veriden hüküm basar. Payda küçültülmez.
 *  3. Eşik merdiveninin ikinci kopyası (`:101`) kalkar — rozet ile çubuk matematiksel olarak
 *     ayrışamaz (çağıran `esikBandi`yi TEK kez çağırır).
 *  4. Boş bileşen listesi 0 değil `null` (bu panelde bileşen sayısı sabit 4, görünmez; yeniden
 *     kullanımda arızayı önler).
 *  5. Skor YUVARLANMADAN banda sokulur; GB3'te tüm terimler tamsayı → görünür fark yok. 6c GB2 harf
 *     notunda (`Math.round` yüzünden 'A' erişilemezdi) ve 6k'da fark olacak. Yuvarlama/kırpma
 *     (`Math.round`, `Math.min(100, …)`) ÇAĞIRANIN gösterim işidir.
 *  6. `-Infinity` taban bandı ÇAĞIRANCA açıkça yazılır; "hiçbir banda girmedi" artık sessizce en
 *     alt bandı seçmez → `null`.
 *
 * ## Kullanıcı kararları (KARARLAR.md, kullanıcının cümleleri)
 *
 * - K20 · koda gömülü sabitler → "ok kalsın": çarpanlar (1,1 / 1 / 0,9), puanlar (25/15/5/0),
 *   tabansız 15, azami 100 ve bantlar (80/50/25) ÇAĞIRANDA adlandırılır + dipnot; DEĞERLER DEĞİŞMEZ.
 *   Bu modül ölçek/eşik BİLMEZ — hepsi parametredir.
 * - K2 · iptaller ciroya girsin mi → "hayır": `:65` `o.status === 'Cancelled'` süzgeci zaten var,
 *   parite (çağıran tarafı).
 *
 * Sonraki tüketiciler (ADDITIVE, imza değişmeden): 6c GB2 `finansalSaglikNotu`/harf notu · 6d GB5
 * `isSagligiPuani` (4 eşit ağırlık) · 6i Envanter `stokSaglikSkoru` · 6k Lojistik `lojistikPuani`
 * (ağırlık 0,4/0,3/0,2/0,1 — test 8 bu vektörü şimdiden kilitler).
 */

/** Bileşik skorun TEK bileşeni. Puan bilinmiyorsa `null` — 0 DEĞİL (0 gerçek bir puandır). */
export interface SkorBileseni {
  /** Bileşenin ekranda ve `eksik` listesinde görünecek adı (çağıranın dilinde). */
  ad: string;
  /** Ham puan; bilinmiyorsa `null`. ÖLÇEK ÇAĞIRANIN (0-25, 0-100 …) — modül ölçek bilmez. */
  puan: number | null;
  /** Ağırlık. VARSAYILANI YOK: çağıran 1'i de açıkça yazar (gizli `= 1` yasak). */
  agirlik: number;
}

export interface SkorSonucu {
  /** Σ(puan × ağırlık). TEK bileşen bile bilinmiyorsa `null`. Yuvarlanmaz, kırpılmaz. */
  skor: number | null;
  /** Puanı bilinen bileşen sayısı. */
  kullanilan: number;
  /** Bileşen sayısı (= liste uzunluğu). Değişmez: `kullanilan + eksik.length === toplam`. */
  toplam: number;
  /** Puanı (ya da ağırlığı) okunamayan bileşenlerin adları — GİRDİ SIRASIYLA. */
  eksik: string[];
}

/**
 * "Biliniyor" kapısı — `Number.isFinite` (GLOBAL `isFinite` DEĞİL: `isFinite('5')` true döner ve
 * metin puanı sayı sanar). `typeof` yalnız TypeScript daraltması içindir; çalışma zamanında
 * `Number.isFinite` zaten sayı olmayan her şeye (metin, `null`, `undefined`, nesne) false döner.
 */
function sonluSayi(deger: unknown): deger is number {
  return typeof deger === 'number' && Number.isFinite(deger);
}

/**
 * Bileşik skor: hepsi biliniyorsa `Σ(puan × agirlik)`; tek bileşen bile bilinmiyorsa `null`.
 * Bileşen biliniyor ⟺ `Number.isFinite(puan) && Number.isFinite(agirlik)`. Ağırlığı okunamayan
 * bileşen de bilinmiyordur (katkısı hesaplanamaz) — sessizce 0 (ya da 1) ağırlık VARSAYILMAZ.
 * Boş liste → `skor: null`. Kısmi skor ÜRETİLMEZ, payda küçültülmez. Girdi mutasyona uğramaz.
 */
export function bilesikSkor(bilesenler: readonly SkorBileseni[]): SkorSonucu {
  const eksik: string[] = [];
  let kullanilan = 0;
  let toplamPuan = 0;   // yalnız bilinen bileşenlerin Σ'sı; eksik varsa ekrana ÇIKMAZ (aşağıda null)
  for (const b of bilesenler) {
    if (!sonluSayi(b.puan) || !sonluSayi(b.agirlik)) {
      eksik.push(b.ad);
      continue;
    }
    kullanilan += 1;
    toplamPuan += b.puan * b.agirlik;
  }
  const hesaplanabilir = bilesenler.length > 0 && eksik.length === 0;
  // Savunma kapısı: Σ sonlu değilse (taşma) skor bilinmez; `eksik` boş kalır, ekran '—' basar.
  const skor = hesaplanabilir && Number.isFinite(toplamPuan) ? toplamPuan : null;
  return { skor, kullanilan, toplam: bilesenler.length, eksik };
}

/** Bir eşik bandı. `altSinir` DÂHİLDİR (`deger >= altSinir`). Taban bandı: `-Infinity`. */
export interface BantTanimi<T> {
  altSinir: number;
  deger: T;
}

/**
 * `deger`i eşik merdivenine oturtur: eşleşen (`deger >= altSinir`) bantlar içinde `altSinir`i
 * EN BÜYÜK olan kazanır — dizi sırasından BAĞIMSIZ; eşit `altSinir`de dizide önce gelen (kararlı).
 * Bilinmeyen / sonlu olmayan `deger` → `null` (ekran rozeti ÇİZMEZ; sonsuz skor hesap hatasıdır,
 * en üst bandı kazanmasına izin verilmez). `altSinir` NaN olan bant ATLANIR. Hiçbir bant
 * eşleşmezse `null` — taban bandını çağıran `altSinir: -Infinity` ile AÇIKÇA yazar, sessiz yedek yok.
 * Dönen `deger` çağıranın nesnesidir (kopyalanmaz); girdi mutasyona uğramaz.
 */
export function esikBandi<T>(
  deger: number | null | undefined,
  bantlar: readonly BantTanimi<T>[],
): T | null {
  if (!sonluSayi(deger)) return null;
  let kazanan: BantTanimi<T> | null = null;
  for (const bant of bantlar) {
    if (Number.isNaN(bant.altSinir)) continue;                 // sınırı bilinmeyen bant eşleşmez
    if (deger < bant.altSinir) continue;                       // `deger >= altSinir` dâhil sınır
    if (kazanan === null || bant.altSinir > kazanan.altSinir) kazanan = bant;   // `>`: eşitlikte ilk kalır
  }
  return kazanan === null ? null : kazanan.deger;
}
