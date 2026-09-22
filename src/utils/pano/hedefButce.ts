/**
 * hedefButce.ts — Pano (DashboardPage) hedef/bütçe/hız üçlüsünün HESABI, tek kaynak (Faz 3 5/n, 2026-09-19).
 * Test: hedefButce.test.ts (ÖNCE yazıldı, kırmızı görüldü). Saf: React/DB/kur yok.
 *
 *   • Phase 99  Bu Ay Satış Hedefi           (src/pages/DashboardPage.tsx ~830-893)
 *   • Phase 174 Satış / Bütçe (3 Ay)         (~894-936)
 *   • Phase 159 Satış Hızı + 8 hafta grafiği (~1105-1160)
 *
 * NEDEN VAR — sayfadaki sahte kesinlik siteleri (CLAUDE.md: sayısal `|| 0` / `?? 0` YASAK):
 *   ~834          `orders.filter(…).reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *                 → tutarı bilinmeyen sipariş ciroya ₺0 giriyor; "bu ay gerçekleşen" sessizce EKSİK.
 *   ~835          `monthlyTarget > 0 ? Math.min(Math.round(mtd / hedef * 100), 200) : 0`
 *                 → HEDEF GİRİLMEMİŞKEN "%0" + kırmızı boş çubuk. Ekran "hedefin çok gerisindeyiz"
 *                   diyor, gerçek "hedef yok". Hiç hedefin %0'ı diye bir sayı yoktur.
 *   ~836/~877/885 pct99'dan türeyen renk / büyük yüzde / çubuk genişliği — üçü de aynı uydurma 0'ı basıyor.
 *   ~906          `mOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)`     → aynı arıza, 3 ay için.
 *   ~907          `monthlyTarget > 0 ? Math.round(actual / monthlyTarget * 100) : 0`
 *   ~1113-1114    `last30/prev30.reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *   ~1126         `weeks[weekIdx] += o.totalPrice || 0`
 *                 → tutarı okunamayan siparişin haftası "₺0 ciro" çubuğu çiziyor (veri yok ≠ satış yok).
 *   ~853/~863     `const v = Number(targetDraft)` → `Number('') === 0`, `Number('abc') === NaN`:
 *                 'abc' / '-5' DOĞRULANMADAN kaydediliyor (NaN ya da negatif hedef DB'ye yazılıyor).
 *
 * KURAL: bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`Tutar.bilinmeyen`).
 *   • EKRAN toplamı  → `para.ekranTutari` (kısmi toplam + "N kayıt tutarsız" notu; hiç bilinen yoksa
 *     NaN → fmtKpi '—'). Bu modül `ekran` alanında hazır verir.
 *   • TÜRETİLEN sayı (oran, kalan, günlük hız, değişim yüzdesi) → `para.tamTutar` kapısı: tek girdi bile
 *     bilinmiyorsa HESAPLANMAZ (null → '—', çubuk/rozet ÇİZİLMEZ). Kısmi toplamdan yüzde üretilmez.
 *   • Hedef/bütçe yoksa gerçekleşme oranı hesaplanmaz — %0 da %100 de değildir (`hedef: null`).
 *   • Grafik verisinde bilinmeyen hafta `deger: null` (0 değil — çizgi sıfıra çakılmasın; bkz.
 *     `utils/recharts.ts` ve PANO kuralı).
 *   • Boş dönem GERÇEK 0'dır (satış yok), bilinmeyen değildir.
 *
 * KOPYA YOK — hazır tek kaynaklar içe aktarıldı, yeniden yazılmadı:
 *   sipariş tutarı `siparis.siparisTutari` · toplama/ekran/türetme kapısı `para.*` ·
 *   tarih çözümü `zaman.zamanDate` · yerel ay anahtarı `muhasebe/karZarar.ayAnahtariYerel` ·
 *   form sayısı ve kayıt kapısı `muhasebe/irsaliyeCalisan.formSayisi` / `pozitifSayi`.
 *   Oran kuralı `muhasebe/butceVaryans.gerceklesmeOrani` + `butceGerceklesme.butceYuzdesi` ile AYNI
 *   ("bütçe ≤ 0 ya da bir taraf eksik → null"); orada girdi `Toplam`, burada tek sayı (kullanıcının
 *   girdiği aylık hedef) olduğu için imza farklı, kural birebir aynı.
 *
 * SAYFA PARİTESİ (bilinen girdide sayı eskiyle BİREBİR aynı):
 *   • İptal (`status === 'Cancelled'`) her üç panelde de dışarıda.
 *   • Tarih çözümü sayfadaki SIRAYLA: Phase 99/159 `createdAt ?? syncedAt`, Phase 174 yalnız `createdAt`
 *     (`ayCirosu` varsayılanı `tarihYedegi = false`). Bu FARK sayfada gerçekten var ve korunuyor —
 *     `siparis.siparisTarih` (syncedAt → createdAt → orderDate) kullanılmadı: farklı öncelik ayları
 *     kaydırır, parite bozulurdu. Tutarsızlığın kendisi açık soru olarak bildirildi.
 *   • Hafta kovası eski formülle aynı: `daysAgo = floor((şimdi − tarih)/86400000)`,
 *     `indeks = (haftaSayisi − 1) − floor(daysAgo / 7)`; aralık dışı (8 haftadan eski ya da gelecek
 *     tarihli) kayıt düşer.
 *   • Yüzdeler `Math.round` ile (sayfadaki gibi).
 *
 * BİLİNÇLİ FARKLAR (hesabı yalnız "bilinmeyen 0 sayılmaz" yönünde değiştirir):
 *   • Tutar `siparisTutari` (`totalPrice ?? totalAmount`) — sayfa yalnız `totalPrice` okuyordu, yani
 *     `totalPrice` boş ama `totalAmount` dolu siparişi ₺0 sayıyordu. `totalPrice` biliniyorken sonuç aynı.
 *   • Aşım KIRPILMAZ: sayfa büyük yüzdeyi 200'de kırpıyordu (%300 gerçekleşme "%200" görünüyordu).
 *     Kırpma SUNUM kararıdır, bağlamada `Math.min(oran, 100)` ile çubuk genişliğinde kalır; ekrana
 *     basılan sayı gerçek oran olmalı (aynı karar `butceGerceklesme` başlığında da alındı).
 *   • Ay anahtarı `ayAnahtariYerel` (tarih-only string YEREL gün) — sayfadaki `zaman.ayAnahtari` bu
 *     string'i UTC gece yarısına sabitliyor; TR'de (UTC+3) sonuç aynı, negatif ofsetli makinede ayın
 *     ilk günü bir önceki aya kayıyordu. `butceVaryans` ile aynı seçim.
 *   • Tarihi çözülemeyen kayıt hâlâ döneme girmez (parite) ama artık SAYILIR (`tarihsiz`) — sayfa onu
 *     sessizce düşürüyordu.
 *
 * Girdi tipi MİNİMAL ve YAPISAL (`Order`'a bağlı DEĞİL): kanonik tip de, bileşenlerin kendi daraltılmış
 * yerel sipariş tipleri de uyar — yarım düzeltme sınıfı (bkz. siparis.ts başlığı) tekrarlanmasın.
 */
import { toplaBilinen, ekranTutari, tamTutar, type Tutar } from '../para';
import { siparisTutari } from '../siparis';
import { zamanDate } from '../zaman';
import { ayAnahtariYerel } from '../muhasebe/karZarar';
import { formSayisi, pozitifSayi } from '../muhasebe/irsaliyeCalisan';
import { sayacOlcegi } from './cubuk';

/** Panelin gerçekten okuduğu alanlar; hepsi `unknown` (DB'den null gelebilir, tip "number" demek dolu demek değil). */
export interface PanoSiparis {
  totalPrice?: unknown;
  totalAmount?: unknown;
  status?: unknown;
  createdAt?: unknown;
  syncedAt?: unknown;
}

const iptalDegil = (o: PanoSiparis): boolean => o.status !== 'Cancelled';

/** Sayfadaki tarih sırası. `tarihYedegi` açıkken `createdAt ?? syncedAt` (Phase 99/159), kapalıyken yalnız `createdAt` (Phase 174). */
const hamTarih = (o: PanoSiparis, tarihYedegi: boolean): unknown => (tarihYedegi ? (o.createdAt ?? o.syncedAt) : o.createdAt);

/**
 * Siparişin pano tarihi; çözülemezse null — ASLA "bugün"e düşmez (bkz. zaman.ts).
 * `siparis.siparisTarih` KULLANILMADI: onun önceliği syncedAt → createdAt → orderDate; pano panelleri
 * createdAt önce okuyor, öncelik değişimi ayları kaydırır (parite).
 */
export function siparisAni(o: PanoSiparis, tarihYedegi = true): Date | null {
  return zamanDate(hamTarih(o, tarihYedegi));
}

/** Bir zaman penceresinin cirosu + tarihi çözülemediği için pencere dışı kalan kayıt sayısı. */
export interface CiroPenceresi {
  /** Bilinen tutarların toplamı + bilinen/bilinmeyen sayaçları. Ekran: `ekranTutari(ciro)`. */
  ciro: Tutar;
  /** İptal olmayan ama tarihi çözülemeyen kayıt sayısı — hiçbir döneme giremez (sayfa sessizce düşürüyordu). */
  tarihsiz: number;
}

const pencere = (siparisler: readonly PanoSiparis[], tarihYedegi: boolean, kabul: (d: Date) => boolean): CiroPenceresi => {
  const aktif = siparisler.filter(iptalDegil);
  const icerde: PanoSiparis[] = [];
  let tarihsiz = 0;
  for (const o of aktif) {
    const d = siparisAni(o, tarihYedegi);
    if (!d) { tarihsiz++; continue; }
    if (kabul(d)) icerde.push(o);
  }
  return { ciro: toplaBilinen(icerde, siparisTutari), tarihsiz };
};

/**
 * `[baslangic, bitis)` penceresinin cirosu — yarı açık aralık (Phase 159'un `d >= d60ago && d < d30ago`
 * paritesi). `bitis` null ise üst sınır yoktur (Phase 99'un ay başından itibaren MTD penceresi).
 */
export function donemCirosu(
  siparisler: readonly PanoSiparis[],
  baslangic: Date,
  bitis: Date | null = null,
  tarihYedegi = true,
): CiroPenceresi {
  return pencere(siparisler, tarihYedegi, d => d >= baslangic && (bitis === null || d < bitis));
}

/**
 * Bir ayın ('YYYY-MM' YEREL anahtar) cirosu. `tarihYedegi` VARSAYILAN OLARAK KAPALI — Phase 174 yalnız
 * `createdAt` okuyor; açıldığında Phase 99 ile aynı kuralı uygular (bkz. açık sorular).
 */
export function ayCirosu(siparisler: readonly PanoSiparis[], ayAnahtar: string, tarihYedegi = false): CiroPenceresi {
  const aktif = siparisler.filter(iptalDegil);
  const icerde: PanoSiparis[] = [];
  let tarihsiz = 0;
  for (const o of aktif) {
    const k = ayAnahtariYerel(hamTarih(o, tarihYedegi));
    if (k === null) { tarihsiz++; continue; }
    if (k === ayAnahtar) icerde.push(o);
  }
  return { ciro: toplaBilinen(icerde, siparisTutari), tarihsiz };
}

// ── Hedef gerçekleşmesi (Phase 99 / Phase 174) ─────────────────────────────────────────────

export interface HedefDurumu {
  /** Kullanıcının girdiği aylık hedef; GİRİLMEMİŞ / okunamayan / ≤ 0 ise null → ekranda "Hedef belirle…". */
  hedef: number | null;
  /** Ekrana basılacak ciro (`ekranTutari`): kısmi toplam, hiç bilinen yoksa NaN → fmtKpi '—'. */
  ekran: number;
  /** Tutarı bilinmeyen kayıt sayısı — `> 0` ise sayfa "N kayıt tutarsız" notu koyar. */
  bilinmeyen: number;
  /**
   * Gerçekleşme yüzdesi (`Math.round`). null = HESAPLANAMAZ: hedef yok ya da ciroda bilinmeyen kayıt var.
   * Yüzde çubuğu / renk rozeti bu null'da ÇİZİLMEZ ("%0" basılmaz). Aşımda 100'ü aşar (kırpma bağlamada).
   */
  oranYuzde: number | null;
  /** Hedefe kalan tutar (hedef − ciro); negatif = hedef aşıldı. Oran null ise bu da null. */
  kalan: number | null;
}

/** Hedef alanı: bilinen ve sıfırdan büyük olmalı. 0 = "hedef yok" (kayıt tarafı 0 hedefi zaten siler). */
const hedefSayisi = (hedef: unknown): number | null => (pozitifSayi(hedef) ? Number(hedef) : null);

/**
 * Phase 99 kartı ve Phase 174'ün tek ayı. Hedef yoksa oran/kalan HESAPLANMAZ; ciroda tek bilinmeyen
 * kayıt varsa da hesaplanmaz (kısmi toplamdan yüzde üretilmez) — ekran kısmi toplamı notuyla gösterir.
 */
export function hedefGerceklesme(ciro: Tutar, hedef: unknown): HedefDurumu {
  const h = hedefSayisi(hedef);
  const tam = tamTutar(ciro);                       // tek kayıt bile bilinmiyorsa NaN
  const hesaplanabilir = h !== null && Number.isFinite(tam);
  return {
    hedef: h,
    ekran: ekranTutari(ciro),
    bilinmeyen: ciro.bilinmeyen,
    oranYuzde: hesaplanabilir ? Math.round((tam / h) * 100) : null,
    kalan: hesaplanabilir ? h - tam : null,
  };
}

export interface ButceGirdisi {
  /** Sütun etiketi ('Eyl') — çeviri/biçim çağıranda (`tarihYaz`), burada sadece taşınır. */
  etiket: string;
  ciro: Tutar;
  hedef: unknown;
}
export interface ButceAyi extends HedefDurumu { etiket: string }

/**
 * Phase 174'ün üç sütunu. Her ay KENDİ hedefiyle karşılaştırılır — sayfa üç aya da İÇİNDE BULUNULAN AYIN
 * hedefini uyguluyor (`monthlyTargets` geçmişi DashboardPage'e hiç geçilmiyor); bağlama bunu değiştirmez,
 * imza aylık hedef geçmişi bağlandığında hazır olsun diye ay başına hedef alır (bkz. açık sorular).
 */
export function butceKarsilastir(aylar: readonly ButceGirdisi[]): ButceAyi[] {
  return aylar.map(a => ({ etiket: a.etiket, ...hedefGerceklesme(a.ciro, a.hedef) }));
}

// ── Satış hızı (Phase 159) ─────────────────────────────────────────────────────────────────

export interface SatisHizi {
  /** Gün başına ciro; null = HESAPLANAMAZ (gün sayısı ≤ 0/okunamaz ya da ciroda bilinmeyen kayıt var). */
  gunluk: number | null;
  /** Dönem cirosunun ekran değeri (`ekranTutari`). */
  ekran: number;
  bilinmeyen: number;
  /** Bölen olarak kabul edilen gün sayısı; geçersizse null. */
  gun: number | null;
}

/**
 * Dönem cirosunu gün sayısına böler. Gün sayısı 0 / negatif / okunamazsa hız YOKTUR (null) — sıfıra
 * bölüp Infinity basmak ya da "₺0/gün" demek sahte kesinliktir. Ciroda tek bilinmeyen kayıt varsa da
 * hesaplanmaz. Satışsız dönem GERÇEK ₺0/gün.
 *
 * NOT: sayfa buraya TAKVİM günü (30) veriyor; panel başlığı "Revenue per Working Day" diyor — bölen
 * çağıranın kararı, iş günü sayacı bağlanırsa imza değişmeden çalışır (bkz. açık sorular).
 */
export function satisHizi(ciro: Tutar, gunSayisi: unknown): SatisHizi {
  const gun = pozitifSayi(gunSayisi) ? Number(gunSayisi) : null;
  const tam = tamTutar(ciro);
  return {
    gunluk: gun !== null && Number.isFinite(tam) ? tam / gun : null,
    ekran: ekranTutari(ciro),
    bilinmeyen: ciro.bilinmeyen,
    gun,
  };
}

/**
 * "vs önceki 30g" rozeti: iki günlük hızın yüzde değişimi. Önceki hız bilinmiyorsa ya da ≤ 0 ise
 * (sıfırdan artış sonsuzdur) rozet ÇİZİLMEZ — null. Sayfadaki `dailyPrev > 0 ? … : null` ile aynı.
 */
export function hizDegisimi(bu: number | null | undefined, onceki: number | null | undefined): number | null {
  if (bu == null || onceki == null) return null;
  if (!Number.isFinite(bu) || !Number.isFinite(onceki) || onceki <= 0) return null;
  return Math.round(((bu - onceki) / onceki) * 100);
}

// ── 8 haftalık kıvılcım grafiği (Phase 159) ────────────────────────────────────────────────

export interface Hafta {
  /** 0 = en eski kova, `haftaSayisi - 1` = içinde bulunulan hafta (sayfadaki dizilim). */
  indeks: number;
  ciro: Tutar;
  /**
   * Grafiğe verilecek değer: bilinen kısmi toplam, hiç bilinen yokken null (0 DEĞİL — çubuk/çizgi
   * sıfıra çakılmasın; `recharts` null'ı boşluk olarak çizer). Siparişsiz hafta gerçek 0'dır.
   */
  deger: number | null;
}

/**
 * Son `haftaSayisi` haftanın cirosu. Kova formülü sayfayla aynı: `floor(daysAgo / 7)` geriye sayar,
 * aralık dışı (daha eski ya da gelecek tarihli) kayıt düşer. İptaller ve tarihi çözülemeyen kayıtlar girmez.
 */
export function haftalikCiro(siparisler: readonly PanoSiparis[], simdi: Date, haftaSayisi = 8): Hafta[] {
  const kovalar: PanoSiparis[][] = Array.from({ length: haftaSayisi }, () => []);
  for (const o of siparisler) {
    if (!iptalDegil(o)) continue;
    const d = siparisAni(o);
    if (!d) continue;
    const gunOnce = Math.floor((simdi.getTime() - d.getTime()) / 86400000);
    const indeks = (haftaSayisi - 1) - Math.floor(gunOnce / 7);
    if (indeks >= 0 && indeks < haftaSayisi) kovalar[indeks].push(o);
  }
  return kovalar.map((liste, indeks) => {
    const ciro = toplaBilinen(liste, siparisTutari);
    const ekran = ekranTutari(ciro);
    return { indeks, ciro, deger: Number.isFinite(ekran) ? ekran : null };
  });
}

/**
 * Çubuk yüksekliklerinin ölçeği: bilinen en büyük hafta değeri. Hiç bilinen pozitif değer yoksa null —
 * sayfa `Math.max(...weeks, 1)` ile sahte bir ölçek uydurup HER haftaya en az %4'lük çubuk çiziyordu
 * (veri yokken "az da olsa satış var" izlenimi). null'da bağlama çubuk çizmez, "veri yok" der.
 */
export function enBuyukHafta(haftalar: readonly Hafta[]): number | null {
  // 6a (2026-09-19): gövde `cubuk.sayacOlcegi`ye indi — ADET/sayı serilerinin ölçek kuralı
  // artık tek evde (bu imza `Hafta`ya kilitli olduğu için saat dilimi/adet kovası geçemiyordu).
  // Davranış farkı: `sayacOlcegi` ek olarak NaN/±Infinity eler; `Hafta.deger: number | null`
  // sözleşmesinde gözlenebilir fark YOK (kabul ölçüsü: bu dosyanın testleri düzenlenmeden yeşil).
  return sayacOlcegi(haftalar.map(h => h.deger));
}

// ── Hedef düzenleme formu (Phase 99 inline input) ──────────────────────────────────────────

/**
 * Hedef girdisinin sonucu:
 *   • `temizle`  — alan boşaltıldı ya da açıkça 0 yazıldı: hedefi KALDIR. Kaydı `hedefYamasi`
 *     yapar (aşağıda): anahtar yamadan SİLİNMEZ, açıkça `null` yazılır — yoksa PATCH-merge
 *     silmeyi sessiz no-op'a çevirir. Boş alan `Number('') === 0` tuzağıyla değil, AÇIKÇA buradan.
 *   • `gecersiz` — 'abc', '-5', NaN, Infinity: KAYDEDİLMEZ, çağıran toast basar. Sayfa bunları
 *     doğrulamadan `Number(...)` ile DB'ye yazıyordu.
 *   • `gecerli`  — sıfırdan büyük bilinen sayı.
 *
 * METİN GİRDİSİ YALNIZ RAKAMDIR (2026-09-19 son inceleme). Hedef kutuları `type="number"` idi:
 * tarayıcı çözemediği metinde (`2.500.000`, WebKit'te `abc`) `e.target.value` olarak '' verir,
 * '' ise `temizle` demektir — kullanıcı 2,5M yazdığını sanırken hedef SESSİZCE siliniyordu ve
 * `gecersiz` dalına pratikte yalnız negatif sayı ulaşabiliyordu. Kutular artık `type="text"
 * inputMode="numeric"`: ham metin BURAYA ulaşır. Ayırıcılı yazım KABUL EDİLMEZ, çünkü anlamı
 * belirsizdir: `2.500` Türkçe yazımda 2500, `Number()`'da 2,5'tir — tahmin etmek yerine
 * `gecersiz` deyip kullanıcıya "yalnız rakam" dedirtiyoruz. (`1e6`, `2,5`, `+5` de aynı.)
 */
export type HedefGirdisiSonucu =
  | { durum: 'gecerli'; deger: number }
  | { durum: 'temizle' }
  | { durum: 'gecersiz' };

export function hedefGirdisi(ham: unknown): HedefGirdisiSonucu {
  if (ham == null || (typeof ham === 'string' && ham.trim() === '')) return { durum: 'temizle' };
  if (typeof ham === 'string' && !/^\d+$/.test(ham.trim())) return { durum: 'gecersiz' };
  if (pozitifSayi(ham)) return { durum: 'gecerli', deger: Number(ham) };
  return formSayisi(ham) === 0 ? { durum: 'temizle' } : { durum: 'gecersiz' };
}

/**
 * Hedef kutusunun ÖN-DOLDURMA metni — üç yüzeyin (Pano, CRM "bu ay", CRM 12 aylık tablo) TEK tanımı.
 * `hedefGirdisi` metinde yalnız rakam kabul eder; kayıtlı hedef ondalıklıysa (250000.5 — eski
 * `type="number"` kutusu yazdırabiliyordu) ham `String(x)` kullanıcının YAZMADIĞI bir değer için
 * "yalnız rakam" uyarısı doğururdu. Hedef yoksa kutu BOŞ açılır (uydurma '0' ile değil).
 * Değişmez: her pozitif sonlu x için `hedefGirdisi(hedefOnDoldur(x))` 'gecersiz' DEĞİLDİR (testli).
 */
export function hedefOnDoldur(hedef: unknown): string {
  if (!pozitifSayi(hedef)) return '';
  const tam = Math.round(Number(hedef));
  return tam > 0 ? String(tam) : '';
}

/** `settings/targets` dokümanının yerel hâli: ay anahtarı → hedef. */
export type AylikHedefler = Record<string, number>;

/**
 * Hedef kaydının iki yüzü: yerel state ve DB'ye gidecek PATCH-merge yaması.
 *
 * ## NEDEN VAR (2026-09-19 delta bulgusu)
 *
 * Silme YAPILMIYORDU. `App.tsx:1611-1614` (ve kopyası `CRMPage.tsx:276-284`):
 *
 *     const updated = { ...monthlyTargets, [monthKey]: value };
 *     if (value === 0) { delete updated[monthKey]; }
 *     setDoc(doc(db, 'settings', 'targets'), updated, { merge: true });
 *
 * Anahtar yamadan SİLİNİP merge ile gönderiliyordu. Merge'ün her katmanı yamada OLMAYAN anahtarı
 * olduğu gibi bırakır — sunucu (`server.ts:1949` → `pgShim.mergeDocData`: `out[key] = value`) ve
 * istemci önbelleği (`dbClient.ts:505`: `{...eski, ...data}`). Yani silme sessiz bir no-op'tu:
 * kullanıcı hedefi temizliyor, dinleyici (`App.tsx:2727`) eski hedefi anında geri yazıyor,
 * "Hedef belirle…" durumuna kalıcı olarak dönülemiyordu. Phase 99 yüzdesi ve Phase 174 bütçe
 * çubukları silinmiş sanılan hedefle çizilmeye devam ediyordu.
 *
 * FORM KURALI (`utils/muhasebe/irsaliyeCalisan.girilenAlanYamasi` ile aynı sözleşme):
 * boş + önceki BİLİNİYOR → alanı yamaya `null` olarak KOY. Yamaya koymamak silmeyi no-op yapar.
 *
 * `deger === null` temizlemedir. Yama yalnız DEĞİŞEN ayı taşır: tüm haritayı merge ile geri
 * göndermek eşzamanlı bir düzenlemede başka ayları ezebiliyordu.
 */
export function hedefYamasi(
  mevcut: AylikHedefler,
  ayAnahtari: string,
  deger: number | null,
): { yerel: AylikHedefler; yama: Record<string, number | null> } {
  const yerel: AylikHedefler = { ...mevcut };
  if (deger === null) delete yerel[ayAnahtari];
  else yerel[ayAnahtari] = deger;
  return { yerel, yama: { [ayAnahtari]: deger } };
}

/**
 * `settings/targets` dokümanını okur: yalnız SIFIRDAN BÜYÜK bilinen sayılar hedeftir.
 *
 * Silinen ay artık dokümanda `null` olarak durur (bkz. `hedefYamasi`) — dinleyici o anahtarı
 * state'e yazarsa hem tip sözü (`Record<string, number>`) bozulur hem de hedef "var" görünür.
 * 0 / negatif / okunamayan değer de hedef değildir (`hedefSayisi` ile aynı kapı).
 */
export function hedefleriOku(ham: unknown): AylikHedefler {
  if (typeof ham !== 'object' || ham === null) return {};
  const cikti: AylikHedefler = {};
  for (const [ay, v] of Object.entries(ham as Record<string, unknown>)) {
    const h = hedefSayisi(v);
    if (h !== null) cikti[ay] = h;
  }
  return cikti;
}
