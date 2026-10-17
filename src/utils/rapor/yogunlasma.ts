/**
 * yogunlasma.ts — kümülatif pay + ABC (Pareto) sınıflandırması, tek kaynak (Faz 3 6/n · 6b, 2026-09-24).
 * Test: yogunlasma.test.ts (ÖNCE yazıldı, kırmızı görüldü). Saf: React / DB / dil / metin YOK.
 * Tarih ÇÖZMEZ, sipariş durumu OKUMAZ — iptal süzgeci ÇAĞIRANDADIR (K2, aşağıda).
 * HHI (`yogunlasma()`) 6c adım 0'da AYNI dosyaya ADDITIVE eklenir; 6b'de tüketicisi yok, yazılmadı. (6c: eklendi — aşağıdaki "## HHI (6c)" bölümü.)
 *
 * ## NEDEN VAR — "bir satırın toplam içindeki payı" DÖRT panelde elle yazılmıştı ve dördü de aynı iki
 * arızayı taşıyordu (HEAD `b95fc18`'de `grep -n` ile yeniden ölçüldü; satırlar şartnameyle birebir):
 *   genel/GenelBloklar1.tsx:601  `const total217 = sorted217.reduce((s, p) => s + p.rev, 0);`
 *        → payda YALNIZ ilk 6 ürün: ekrandaki yüzde "toplam cironun payı" değil "ilk 6'nın payı" (K21).
 *   genel/GenelBloklar1.tsx:608 ve :622  `total217 > 0 ? Math.round((p.rev / total217) * 100) : 0`
 *        → payda bilinmezken altı ürüne de '%0' basılıyor; 622, 608'in birebir KOPYASI (aynı panelde iki kez).
 *   genel/GenelBloklar3.tsx:33   `totalRev256 > 0 ? Math.round((top30pct / totalRev256) * 100) : 0`
 *        → veri yokken rozet "Üst %30 → %0 ciro" der; "veri yok" ile "gerçekten %0" aynı görünür.
 *   genel/GenelBloklar3.tsx:154  `maxRev > 0 ? ((data[3].revenue / data.reduce(...)) * 100).toFixed(0) : 0`
 *        → aynı `: 0` sahte kesinliği + paydada ikinci bir `reduce` kopyası (:133'ün aynısı).
 *   reports/UrunlerRapor.tsx:81  `const pct = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;`
 *        → EN AĞIR SONUÇ: pct 0 olunca `cumPct` hiç artmaz → :83 `cumPct <= 70` HER ürün için doğru →
 *          TÜM ürünler 'A Sınıfı', üstteki üç KPI kartı (:87-89) tamamen yanlış sayı gösterir.
 *   reports/UrunlerRapor.tsx:83  `cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C'` → 70/90 gerçek Pareto
 *        geleneği ama koda gömülü sabit (K20: değer kalır, adlandırılır → `ABC_ESIKLERI`).
 *   reports/UrunlerRapor.tsx:179 `<td …>100%</td>` → tfoot pay sütunu SABİT; paylar bilinmezken bile '100%'.
 *
 * KURAL (CLAUDE.md, sahte kesinlik yasağı): bilinmeyen sayı 0 DEĞİL bilinmiyordur; paydaya da paya da
 * girmez, AYRI sayılır. TÜRETİLEN sayı (pay, kümülatif, sınıf) tek girdi bile eksikse HESAPLANMAZ (null,
 * ekranda '—'). Kapılar `Number.isFinite` + `para.bilinenSayi` + `para.tamTutar`; `?? 0` / `|| 0` YOK.
 *
 * ## PAYDA — TEK KAPI (bilerek)
 * `toplam = tutarBirlestir(TÜM satırlar)`, `payda = tamTutar(toplam)`. Payda sonluysa HİÇBİR satır kısmi
 * olamaz (toplam satırların birleşimidir). "Kısmi paydadan pay üretme" ikinci bir dal olarak YAZILMAZ:
 * kısmi paydadan çıkan yüzdeler bilinmeyen kadar ŞİŞİKTİR (bilinen satırlar yapay olarak %100'e
 * tamamlanır) — UrunlerRapor'daki "her ürün A Sınıfı" tam bu şişmenin sonucudur.
 *
 * ## UYGULANAN KULLANICI KARARLARI (KARARLAR.md — kullanıcının cümlesiyle)
 *   • K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md) — "ilk N" paydası TÜM toplamdır. Modül paydayı
 *     KENDİ hesaplar; çağıran "ilk 6"yı yalnız GÖSTERİM için `slice` eder. Payda dışarıdan verilemez
 *     (`payda?` parametresi JIT: 6c/6f'de tüketici çıkarsa ADDITIVE eklenir).
 *   • K20 kullanıcı: "ok kalsın." — koda gömülü 70 / 90 eşikleri DEĞER OLARAK DEĞİŞMEZ; yalnız
 *     adlandırılır (`ABC_ESIKLERI`) ve ekranda dipnot edilir.
 *   • K2 kullanıcı: "hayır." — iptaller ciroya girmez. Süzgeç ÇAĞIRANDA (`raporVeriKatmani.raporCirosu`
 *     tek kural); bu modül kendisine ne verilirse onu paylar.
 *   • K14 ("kaldır.") bu modülün kapsamı DIŞINDA: panel silmez.
 *
 * ## PARİTE
 * Tüm değerlerin bilindiği ve payda > 0 olduğu girdide `pay` / `kumulatif` / `sinif` eski satır-içi
 * hesapla BİREBİR: aynı `(deger / toplam) * 100` ifadesi, aynı yürüyen toplam (`cumPct += pct`), aynı
 * `<=` sınır. `pay` YUVARLANMAZ (yuvarlama ekranda `bicim.yuzdeYaz`); bu yüzden `Math.round` ve
 * `toFixed(1)` sonuçları da eskiyle aynıdır (test 1, 9 eski ifadeyi yeniden kurup karşılaştırır).
 *
 * ## BİLİNÇLİ FARKLAR
 *   1. (K21) GenelBloklar1:601 paydası ilk 6 ürünken artık TÜM ürünler → o paneldeki yüzdeler DÜŞER ve
 *      altı blok %100'e tamamlanmaz. Kullanıcı kararı; panelde dipnot edilir.
 *   2. Payda bilinmiyorken ya da ≤ 0 iken pay / kümülatif / sınıf ÜRETİLMEZ (null → '—'); eskiden '%0',
 *      '0%', sabit '100%' ve "her ürün A Sınıfı" basılıyordu. `neden` ekrana TEK cümle yazdırır.
 *   3. Değeri okunamayan satır listeden DÜŞMEZ, SONDA durur ve sayılır (eski `b.rev - a.rev`
 *      karşılaştırıcısı NaN dönünce sıra rastgeleleşiyordu).
 *
 * ## KAPSAM DIŞI (bilerek — mevcut testli yardımcılar)
 * `Tutar` üretimi: `para.toplaBilinen` / `raporVeriKatmani.kovayaEkle` · çubuk ölçeği: `pano/cubuk.*` ·
 * yüzde METNİ: `rapor/bicim.yuzdeYaz` · alt küme payı ("üst %30"): `pano/finansKpi.yuzdeOrani(
 * tamTutar(tutarBirlestir(...altKume)), tamTutar(toplam))` — üçüncü fonksiyon YAZILMAZ · iptal süzgeci,
 * tarih penceresi, kur çevirimi, HHI (→ ayrı export `yogunlasma()`; `kumulatifPaylar` HHI üretmez).
 *
 * ## HHI (6c, 2026-10-17) — `yogunlasma()` + `HHI_ESIKLERI`
 * Test: yogunlasma.test.ts sonundaki `describe('yogunlasma — HHI …')` (ÖNCE yazıldı, kırmızı görüldü).
 *
 * NEDEN VAR — aynı metrik Genel sekmesinde İKİ ÇELİŞEN tanımla, iki panelde satır içi yazılmıştı:
 *   GenelBloklar2 P220 (müşteri konsantrasyonu)  `custRev220[name] = (custRev220[name] ?? 0) + (o.totalPrice || 0)`
 *        → okunamayan tutar ₺0: payda şişer, konsantrasyon olduğundan DÜŞÜK görünür.
 *   GenelBloklar2 P220  `const name = o.customerName || '—'`
 *        → adsız siparişlerin HEPSİ tek sahte '—' müşterisine çöker (K4 ihlali) → HHI yapay YÜKSELİR.
 *   GenelBloklar2 P220  `hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low'`
 *        → eşikler gömülü; yuvarlanmış tam 1.500'de kod 'low' derken aynı panelin metni "1500-2500 orta" diyor.
 *   GenelBloklar2 P220  `if (total220 === 0) return null;` → veri yokken panel SESSİZCE kaybolur.
 *   GenelBloklar4 "Ciro Yoğunlaşması"  `hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low'`
 *        → 0–1 ölçeği, orta eşiği 0,10 (= 1.000): aynı HHI iki kartta iki sınıf (1.400 → GB2 'low', GB4 'Moderate');
 *          HHI "%" işaretiyle basılıyor; iptaller DAHİL (K2 ihlali); 'Unknown' sahte müşterisi; "Top 5" (K16 "ilk 3").
 * Panel seçimi bu modülün işi DEĞİL (O4 + K14: GB2 P220 kalır, GB4 paneli kalkar — bağlamada).
 *
 * UYGULANAN KULLANICI KARARLARI (KARARLAR.md — kullanıcının cümlesiyle)
 *   • K16 kullanıcı 2026-09-19: "Ok." — 0–10.000; 1.500 / 2.500; tek panel + "Cironun %X'i ilk 3 müşteriden" (KARARLAR.md)
 *   • K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md) — `ilk3Pay` paydası TÜM bilinen ciro (kimliksiz DÂHİL);
 *     payda dışarıdan verilemez, fonksiyon kendisi kurar.
 *   • K4 kullanıcı 2026-09-19: "kimlikle" (KARARLAR.md) — gruplama ÇAĞIRANDA (`rapor/musteri.musteriOzeti`); bu
 *     fonksiyon satır kurmaz. Kimliksiz sipariş SATIR OLMAZ: `atfedilemeyen` seçeneğiyle girer.
 *   • K2 kullanıcı: "hayır." — iptaller ciroya girmez; süzgeç ÇAĞIRANDA (`siparis.siparisIptalMi`).
 *   • K20 kullanıcı: "ok kalsın." (emsal `ABC_ESIKLERI`) — eşik değerleri adlandırılır (`HHI_ESIKLERI`); ekrandaki
 *     eşik dipnotu bu sabitten üretilir, elle '2500' yazılmaz.
 * ORKESTRATÖR KARARLARI (kullanıcı kararı DEĞİL — teknik seçim, ORKESTRATOR-KARARLARI.md)
 *   • O4 · eşikler: `< 1.500` düşük · `1.500–2.500` orta (1.500 DAHİL, 2.500 DAHİL) · `> 2.500` yüksek — panelin
 *     kendi metniyle aynı. Sınıf YUVARLANMIŞ HHI'dan (ekranda basılan sayıyla rozet çelişmesin).
 *   • O4 · tutarı BİLİNMEYEN tek değer bile (satırda YA DA atfedilemeyende) → HHI ve `ilk3Pay` `null` (katı).
 *   • O4 · müşteriye bağlanamayan ciro HHI'ya girmez, `endeksDisiCiro` ile not olur. Dayanak K23 İLKESİ (kullanıcı:
 *     "Önerin ok. Sorunun cevabı dediğin gibi olacak." / "girilmeyen hesaba katılmaz + not"); K23'ün konusu İK'dır,
 *     burada yalnız ilkesi uygulanır — HHI için verilmiş bir kullanıcı kararı DEĞİLDİR.
 *   • O21 · TRY dışı mağaza siparişi (`dovizTutar` + `paraBirimi`, `totalPrice` yok) bu fonksiyona HİÇ ulaşmaz: ayrım
 *     ÇAĞIRANDA (`siparisler/magazaSiparisi.tryDisiMi`), not `kapsamNotu` `dovizli` sayacıyla. Ulaşırsa
 *     'payda-bilinmiyor' (₺0 sayılmaz, `dovizTutar` TL'ye eklenmez). İmza ve dönüş şekli bunun için DEĞİŞMEDİ.
 *
 * İKİ PAYDA (bilerek farklı): `ilk3Pay` paydası = satırlar ⊕ atfedilemeyen (K21); `hhi` paydası = YALNIZ satırlar
 * (O4). Kimliksiz ciro yokken ikisi eşittir. Atfedilemeyen ciroyu SATIR yapıp `kumulatifPaylar`a vermek onu
 * "ilk 3 müşteri"ye sokabilirdi — bu yüzden `kumulatifPaylar` ÇAĞRILMAZ.
 *
 * PARİTE: tüm tutarlar biliniyor, payda > 0, negatif yok, kimliksiz ciro 0 ve gruplama eskisiyle aynıyken `hhi`
 * GenelBloklar2 P220 ile BİT-BİT aynı (aynı `Math.pow((v / payda) * 100, 2)`, payda satırların girdi sırasıyla
 * 0'dan toplamı, aynı toplama sırası — `musteriOzeti` İLK GÖRÜLME = eski `Object.values` ekleme sırası).
 * `seviye` aynı yuvarlanmış değerden — TEK istisna yuvarlanmış tam 1.500 (eskiden 'low', şimdi 'orta').
 *
 * BİLİNÇLİ FARKLAR (HHI)
 *   1. (K16 + K14 + O4) GB4'ün 0–1 ölçeği, "%" işaretli HHI'sı ve 0,10 orta eşiği gider; 1.400 artık yalnız 'dusuk'.
 *   2. (K16) "Top 5" → "ilk 3"; müşteri < 3 iken `ilkN` gerçek sayıdır (2 müşteride "ilk 3" denmez).
 *   3. (K4 + O4) '—' sahte müşterisi kalkar; kimliksiz ciro HHI'ya girmez, ilk 3 paydasında kalır + not.
 *   4. (O4 katı) okunamayan tutar eskiden ₺0 → şimdi HHI ve ilk 3 '—'; negatif net müşteri (eski formülle
 *      HHI > 10.000) → '—'.
 *   5. Veri yok / ₺0 ciro: eskiden panel sessizce kayboluyordu; şimdi `neden` döner (gösterim bağlamada).
 *   6. (O4) Yuvarlanmış tam 1.500 artık 'orta' (kod panel metnine uyar: alt eşik `>=`).
 *   7. (O21) TRY dışı mağaza siparişi eskiden ₺0 müşteri cirosuydu; şimdi çağıran ayırır, HHI'yı '—' YAPMAZ.
 */
import { bilinenSayi, ekranTutari, sayiSirala, tamTutar, tutarBirlestir, type Tutar } from '../para';

/** Bir satırın payı — `oge` KİMLİĞİ korunur (spread YOK: çağıranın kendi `pay` alanıyla çakışmasın). */
export interface PaySatiri<T> {
  oge: T;
  /** Satırın kendi toplamı (kısmi olabilir; EKRAN için `ekranTutari`, TÜRETME için `tamTutar`). */
  tutar: Tutar;
  /** Satırın payı, % — TÜRETİLEN sayı. Payda kurulamadıysa `null` (yuvarlanmaz; metni `bicim.yuzdeYaz` yazar). */
  pay: number | null;
  /**
   * DÖNEN SIRAYA göre, bu satır DÂHİL kümülatif pay (%). `pay` null ise `null`.
   * `sira: 'girdi'` iken "ilk N'in payı" anlamı TAŞIMAZ (sıra çağıranın verdiği sıradır).
   * Son satır kayan nokta artığıyla 99,999…'a inebilir; `yuzdeYaz(x, 0)` yine '100%' yazar.
   */
  kumulatif: number | null;
}

/** Payların neden kurulamadığı — ekran TEK neden yazar (`nakitDongusu.DsoNedeni` deseni). `null` = hesaplandı. */
export type PayNedeni = 'payda-bilinmiyor' | 'payda-yok' | null;

export type PaySirasi = 'azalan' | 'girdi';

export interface KumulatifPaylar<T> {
  satirlar: PaySatiri<T>[];
  /** TÜM satırların birleşik `Tutar`ı — payda BURADAN (K21). `toplam.bilinmeyen` = okunamayan DEĞER sayısı. */
  toplam: Tutar;
  /** En az bir okunamayan değer taşıyan SATIR sayısı (değer sayacıyla AYNI küme değildir — birimi farklıdır). */
  bilinmeyenSatir: number;
  neden: PayNedeni;
  /** Dönen sıra — `abcSiniflandir` bunu DOĞRULAR (Pareto yalnız azalan sırada anlamlıdır). */
  sira: PaySirasi;
}

/** Yapısal `Tutar` mı? Üç alan da sonlu sayı olmalı (`{ toplam: 'x', … }` gibi yarım nesne bilinmeyendir). */
function tutarMi(x: unknown): x is Tutar {
  if (typeof x !== 'object' || x === null) return false;
  // `in` daraltması (TS ≥ 4.9): cast yok; üç alan tek tek doğrulanır.
  return 'toplam' in x && typeof x.toplam === 'number' && Number.isFinite(x.toplam)
    && 'bilinen' in x && typeof x.bilinen === 'number' && Number.isFinite(x.bilinen)
    && 'bilinmeyen' in x && typeof x.bilinmeyen === 'number' && Number.isFinite(x.bilinmeyen);
}

/**
 * Ham değeri `Tutar`a normalize eder (export EDİLMEZ):
 *   yapısal `Tutar` → değerleri aynen (yeni nesne: girdiye alias yok);
 *   `bilinenSayi` → `{ Number(x), 1, 0 }` (meşru 0 bilinen sayıdır; sayısal string kabul);
 *   diğer her şey (undefined/null/''/'abc'/NaN/±Infinity/nesne) → `{ 0, 0, 1 }` — `Number(undefined)` toplama sızmaz.
 * Global `isFinite` DEĞİL: `isFinite(null) === true` bilinmeyeni 0 sayardı.
 * BOŞ `Tutar` (`{0,0,0}` — hiç kalemi olmayan ürün/çeyrek) GERÇEK 0'dır, bilinmeyen değildir (`para.ts` sözleşmesi).
 */
function tutarOku(x: unknown): Tutar {
  if (tutarMi(x)) return { toplam: x.toplam, bilinen: x.bilinen, bilinmeyen: x.bilinmeyen };
  if (bilinenSayi(x)) return { toplam: Number(x), bilinen: 1, bilinmeyen: 0 };
  return { toplam: 0, bilinen: 0, bilinmeyen: 1 };
}

/**
 * Her satırın TÜM toplam içindeki payı ve dönen sıraya göre kümülatifi.
 *
 * - `sec` verilmezse öğenin KENDİSİ değerdir (`Tutar[]` ya da `number[]`).
 * - Payda TEK KAPI: `tamTutar(tutarBirlestir(TÜM satırlar))`. Sonlu değilse `'payda-bilinmiyor'`, ≤ 0 ise
 *   (boş liste, hepsi 0, iadelerden negatif) `'payda-yok'` — iki durumda da HER satır `pay = kumulatif = null`
 *   (0'a bölme yok, "%0" sahte kesinliği yok, negatif/Infinity pay yok).
 * - `'azalan'` (varsayılan): `sayiSirala(ekranTutari(a), ekranTutari(b), true)` — okunamayan satır SONDA,
 *   kısmi satır kısmi toplamına göre yerleşir; beraberlikte ilk görülme korunur (`sort` kararlı).
 *   Yön `-cmp` ile ÇEVRİLMEZ (bilinmeyenler başa gelirdi — `para.sayiSirala` sözleşmesi).
 * - `'girdi'`: giriş sırası AYNEN korunur (desil D1..D10, çeyrek Q1..Q4 gibi sırası anlam taşıyan panellerde ŞART).
 * - `pay` YUVARLANMAZ; `kumulatif = Σ pay` yürüyen toplam (bugünkü `cumPct += pct` ile birebir).
 * - Girdi dizisi ve öğeleri MUTASYONA UĞRAMAZ (donmuş girdide çalışır); `oge` nesne kimliğini korur.
 *
 * DEĞİŞMEZ: `satirlar.length === degerler.length` (hiçbir satır sessizce düşmez).
 */
export function kumulatifPaylar<T>(
  degerler: readonly T[],
  /** Satırın değeri: `Tutar` ya da düz sayı. VERİLMEZSE öğenin KENDİSİ değerdir. */
  sec?: (o: T) => unknown,
  secenek?: { sira?: PaySirasi },
): KumulatifPaylar<T> {
  const sira: PaySirasi = secenek?.sira ?? 'azalan';

  // `map` yeni dizi üretir; aşağıdaki `sort` yalnız bu yerel diziyi sıralar, `degerler` dokunulmaz kalır.
  const okunan = degerler.map(oge => ({ oge, tutar: tutarOku(sec === undefined ? oge : sec(oge)) }));
  const sirali = sira === 'azalan'
    ? okunan.sort((a, b) => sayiSirala(ekranTutari(a.tutar), ekranTutari(b.tutar), true))
    : okunan;

  // K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md)
  // Payda TÜM satırlardan; "ilk N" için `slice` ÇAĞIRANDA (yalnız gösterim), burada değil.
  // Çift çift birleştirme: `tutarBirlestir(...dizi)` yayması motorun argüman tavanına takılabilir; sonuç aynı.
  const toplam = sirali.reduce<Tutar>((a, s) => tutarBirlestir(a, s.tutar), tutarBirlestir());
  const bilinmeyenSatir = sirali.filter(s => s.tutar.bilinmeyen > 0).length;

  // TEK KAPI: türetme (`tamTutar`), ekran sözleşmesi (`ekranTutari`) DEĞİL — kısmi paydadan pay üretilmez.
  const payda = tamTutar(toplam);
  const neden: PayNedeni = !Number.isFinite(payda) ? 'payda-bilinmiyor' : payda <= 0 ? 'payda-yok' : null;

  let kumulatif = 0;
  const satirlar: PaySatiri<T>[] = sirali.map(({ oge, tutar }) => {
    if (neden !== null) return { oge, tutar, pay: null, kumulatif: null };
    // `payda` sonluysa hiçbir satır kısmi olamaz (toplam satırların birleşimi) → `tamTutar(tutar)` sonludur.
    const pay = (tamTutar(tutar) / payda) * 100;
    kumulatif += pay;
    return { oge, tutar, pay, kumulatif };
  });

  return { satirlar, toplam, bilinmeyenSatir, neden, sira };
}

export type AbcSinifi = 'A' | 'B' | 'C' | null;

/**
 * ABC (Pareto) eşikleri: kümülatif ≤ 70 → A, ≤ 90 → B, üstü C.
 * K20 kullanıcı: "ok kalsın." — bugün `UrunlerRapor.tsx:83`'te gömülü 70 / 90; DEĞER DEĞİŞMEZ, yalnız
 * adlandırılır ve ekranda dipnot edilir (dipnot metni bu sabitten üretilir, elle '70' yazılmaz).
 */
export const ABC_ESIKLERI: readonly [number, number] = [70, 90];

export interface AbcSatiri<T> extends PaySatiri<T> { sinif: AbcSinifi }

/**
 * `kumulatifPaylar` çıktısını A/B/C'ye ayırır (ikinci bir sıralama / payda hesabı YOK).
 *
 * - `paylar.sira !== 'azalan'` → `throw`: Pareto yalnız azalan sırada anlamlıdır; girdi sırasındaki bir
 *   listeyi sınıflandırmak sessizce yanlış A/B/C üretirdi.
 * - `esikler` iki sonlu sayı ve `0 < e1 ≤ e2 ≤ 100` değilse `throw` (mesaj değerleri yazar —
 *   `dagilim.kovayaYerlestir` emsali: sessiz yanlış sınıf yerine gürültü).
 * - Sınıf: `kumulatif <= e1` → 'A', `<= e2` → 'B', aksi 'C'. `<=` DAHİL (bugünkü `:83` ile parite).
 * - `kumulatif` bilinmiyorsa (null ya da elle kurulmuş NaN) `sinif: null`, `siniflandirilamayan++`.
 *   Payda kurulamadıysa TÜM satırlar böyledir (A/B/C 0) — çağıran KPI kartında '—' basar, '0' DEĞİL.
 *
 * DEĞİŞMEZ: `A + B + C + siniflandirilamayan === satirlar.length`.
 */
export function abcSiniflandir<T>(
  paylar: KumulatifPaylar<T>,
  esikler: readonly [number, number] = ABC_ESIKLERI,
): {
  satirlar: AbcSatiri<T>[];
  sayilar: { A: number; B: number; C: number; siniflandirilamayan: number };
} {
  if (paylar.sira !== 'azalan') {
    throw new Error(
      `abcSiniflandir: Pareto sınıflandırması yalnız azalan sırada anlamlıdır — gelen sıra '${paylar.sira}'. ` +
      `kumulatifPaylar'ı { sira: 'azalan' } (varsayılan) ile çağır.`,
    );
  }
  const [e1, e2] = esikler;
  // `!(a <= b)` NaN'ı da yakalar: eşiğin kendisi bilinmiyorsa sınıflandırma anlamsızdır.
  if (!Number.isFinite(e1) || !Number.isFinite(e2) || !(e1 > 0) || !(e1 <= e2) || !(e2 <= 100)) {
    throw new Error(
      `abcSiniflandir: eşikler 0 < A ≤ B ≤ 100 olmalı — gelen [${String(e1)}, ${String(e2)}].`,
    );
  }

  const sayilar = { A: 0, B: 0, C: 0, siniflandirilamayan: 0 };
  const satirlar: AbcSatiri<T>[] = paylar.satirlar.map(s => {
    const k = s.kumulatif;
    const sinif: AbcSinifi = !bilinenSayi(k) ? null : k <= e1 ? 'A' : k <= e2 ? 'B' : 'C';
    if (sinif === null) sayilar.siniflandirilamayan++;
    else sayilar[sinif]++;
    return { oge: s.oge, tutar: s.tutar, pay: s.pay, kumulatif: s.kumulatif, sinif };
  });

  return { satirlar, sayilar };
}

// ── HHI (6c) ──

/** K16 seviyesi. Ekran metni BAĞLAMADA (`ortak.ts` `dusuk_risk` / `orta_risk` / `yuksek_risk` anahtarları). */
export type YogunlasmaSeviyesi = 'dusuk' | 'orta' | 'yuksek';

/**
 * HHI'nın neden kurulamadığı — ekran TEK neden yazar (`PayNedeni` / `nakitDongusu.DsoNedeni` deseni).
 * `null` = HHI hesaplandı. Öncelik sırası tablodaki sıradır (ilk tutan kazanır).
 */
export type YogunlasmaNedeni =
  // O4: satırlarda YA DA atfedilemeyende en az bir okunamayan değer → HHI ve ilk3Pay null
  | 'payda-bilinmiyor'
  // TÜM ciro ≤ 0 (boş liste, hepsi 0, iadelerden negatif toplam)
  | 'payda-yok'
  // bir müşterinin (ya da atfedilemeyenin) net cirosu < 0 — HHI 0–10.000 dışına taşar
  | 'negatif-pay'
  // TÜM ciro > 0 ama müşteriye bağlanan ciro 0 (satır yok / hepsi ₺0): HHI kurulamaz; ilk3Pay KURULUR (ilkN > 0 ise)
  | 'atfedilebilen-yok'
  | null;

/**
 * K16 kullanıcı 2026-09-19: "Ok." — 0–10.000; 1.500 / 2.500; tek panel + "Cironun %X'i ilk 3 müşteriden" (KARARLAR.md)
 * O4 (orkestratör 2026-09-25): `< 1.500` düşük · `1.500–2.500` orta (1.500 DAHİL, 2.500 DAHİL) · `> 2.500` yüksek —
 * panelin kendi metni ("1500-2500 orta, < 1500 düşük") ile aynı.
 * [orta alt sınırı (DAHİL), yüksek eşiği (HARİÇ)] — sınıf YUVARLANMIŞ HHI'dan (ekranda basılan sayıyla çelişmesin).
 * Ekrandaki eşik dipnotu BU sabitten üretilir (K20 emsali `ABC_ESIKLERI`); elle '2500' yazılmaz.
 */
export const HHI_ESIKLERI: readonly [number, number] = [1500, 2500];

/** K16 "ilk 3" — modül İÇİ (export EDİLMEZ: ekran sayıyı `sonuc.ilkN`den okur). */
const YOGUNLASMA_ILK_N = 3;

export interface YogunlasmaSonucu {
  /**
   * 0–10.000, YUVARLANMAZ (ekran `Math.round` + binlik ayraç). YALNIZ atfedilebilen müşteri satırlarından (O4):
   * paylar satırlar toplamına göre. `neden !== null` ⇔ `hhi === null`.
   */
  hhi: number | null;
  /** `Math.round(hhi)` üzerinden K16/O4 sınıfı; `hhi === null` ⇔ `seviye === null`. */
  seviye: YogunlasmaSeviyesi | null;
  /**
   * Ciroya göre AZALAN ilk `ilkN` satırın TÜM bilinen ciro içindeki payı, % (YUVARLANMAZ; metni `bicim.yuzdeYaz`).
   * K21: payda = satırlar + atfedilemeyen. `neden` ∈ {payda-bilinmiyor, payda-yok, negatif-pay} ya da `ilkN === 0` ise `null`.
   */
  ilk3Pay: number | null;
  /** `min(3, satır sayısı)` — ekran "ilk {ilkN} müşteriden" yazar; 2 müşteride "ilk 3" DEMEZ. */
  ilkN: number;
  /** TÜM ciro (satırlar ⊕ atfedilemeyen) — `ilk3Pay` paydası BURADAN. `toplam.bilinmeyen` = okunamayan DEĞER sayısı (siparişten gelen `Tutar`larda SİPARİŞ sayısı). */
  toplam: Tutar;
  /** En az bir okunamayan değer taşıyan SATIR (müşteri) sayısı. Atfedilemeyen satır DEĞİLDİR, buraya girmez. */
  bilinmeyenSatir: number;
  /**
   * O4: HHI'ya GİRMEYEN (müşteriye bağlanamayan) ciro, TL — not cümlesindeki ₺X. `neden` ∈ {null, 'atfedilebilen-yok'}
   * iken SAYI (≥ 0; atfedilemeyen verilmediyse 0), diğer nedenlerde `null` (tutar bilinmiyor / anlamsız).
   */
  endeksDisiCiro: number | null;
  neden: YogunlasmaNedeni;
}

/**
 * Herfindahl-Hirschman endeksi (0–10.000) + K16 seviyesi + "cironun ilk 3 müşteriden gelen payı".
 *
 * - Satırlar HAZIR müşteri satırlarıdır (`musteriOzeti().musteriler` AYNEN; değer `sec` ile, ör. `m => m.ciro`).
 *   Bu fonksiyon GRUPLAMAZ, sipariş durumu / para birimi OKUMAZ — iptal (K2), kimlik (K4) ve TRY dışı (O21)
 *   ayrımları ÇAĞIRANDADIR.
 * - TEK türetme kapısı `tamTutar(toplam)`: tek okunamayan değer → 'payda-bilinmiyor'; toplam ≤ 0 → 'payda-yok'
 *   (`kumulatifPaylar` ile AYNI iki koşul, AYNI sıra); negatif satır / atfedilemeyen → 'negatif-pay';
 *   atfedilebilen ciro ≤ 0 → 'atfedilebilen-yok' (ilk3Pay yine kurulur).
 * - Girdi dizisi, öğeleri ve `secenek.atfedilemeyen` MUTASYONA UĞRAMAZ (donmuş girdide çalışır).
 *
 * DEĞİŞMEZLER: `hhi !== null` ⇒ `10.000 / satirlar.length ≤ hhi ≤ 10.000` (kayan nokta payıyla);
 * `hhi === null ⇔ seviye === null ⇔ neden !== null`; `ilk3Pay !== null` ⇒ `0 ≤ ilk3Pay ≤ 100`;
 * `toplam` = satırlar ⊕ atfedilemeyen (atfedilemeyenin bilinmeyeni `toplam.bilinmeyen`e BİR kez girer,
 * `bilinmeyenSatir`a HİÇ girmez); `endeksDisiCiro !== null ⇔ neden ∈ {null, 'atfedilebilen-yok'}`.
 */
export function yogunlasma<T>(
  satirlar: readonly T[],
  /** Satırın değeri: `Tutar` ya da düz sayı. VERİLMEZSE öğenin KENDİSİ (`kumulatifPaylar` ile AYNI kural). */
  sec?: (o: T) => unknown,
  secenek?: {
    /**
     * Müşteriye ATFEDİLEMEYEN ciro (K4 kimliksiz — `musteriOzeti().kimliksizCiro`). `ilk3Pay` paydasına girer (K21),
     * HHI'ya GİRMEZ (O4), satır OLMAZ. `bilinmeyen > 0` ise HHI ve ilk3Pay `null` ('payda-bilinmiyor').
     * BOŞ `Tutar` (`{0,0,0}`) GERÇEK 0'dır → hiçbir şeyi ENGELLEMEZ. Verilmezse boş sayılır.
     */
    atfedilemeyen?: Tutar;
  },
): YogunlasmaSonucu {
  // K4 kullanıcı 2026-09-19: "kimlikle" (KARARLAR.md) — gruplama ÇAĞIRANDA (`rapor/musteri.musteriOzeti`); bu fonksiyon satır kurmaz.
  // `map` yeni dizi üretir; girdi dokunulmaz. Modül-içi `tutarOku` (kopya normalizasyon YOK).
  const okunan = satirlar.map(o => tutarOku(sec === undefined ? o : sec(o)));
  const atf = secenek?.atfedilemeyen === undefined ? tutarBirlestir() : tutarOku(secenek.atfedilemeyen);

  // K21 kullanıcı 2026-09-24: "Tüm ciro" (KARARLAR.md)
  // Çift çift birleştirme: `tutarBirlestir(...dizi)` yayması motorun argüman tavanına takılabilir; sonuç aynı.
  const toplam = okunan.reduce<Tutar>((a, t) => tutarBirlestir(a, t), atf);
  const bilinmeyenSatir = okunan.filter(t => t.bilinmeyen > 0).length;
  const ilkN = Math.min(YOGUNLASMA_ILK_N, okunan.length);

  const durdur = (neden: 'payda-bilinmiyor' | 'payda-yok' | 'negatif-pay'): YogunlasmaSonucu => ({
    hhi: null, seviye: null, ilk3Pay: null, ilkN, toplam, bilinmeyenSatir, endeksDisiCiro: null, neden,
  });

  // TEK KAPI: türetme (`tamTutar`), ekran sözleşmesi (`ekranTutari`) DEĞİL — kısmi paydadan HHI üretilmez.
  // O4 (katı): tutarı bilinmeyen tek değer bile varsa HHI ve ilk3Pay null.
  // Neden 1-2: `kumulatifPaylar` ile AYNI iki koşul, AYNI sıra.
  const payda = tamTutar(toplam);
  if (!Number.isFinite(payda)) return durdur('payda-bilinmiyor');
  if (payda <= 0) return durdur('payda-yok');

  // Payda sonluysa hiçbir satır kısmi olamaz (toplam satırların birleşimi). Savunma: sayaçları birbirini
  // götüren bozuk `Tutar` (+1 / −1) toplamı tam gösterebilir — NaN'lı bir HHI 'dusuk' rozeti basmasın.
  const degerler = okunan.map(tamTutar);
  const atfDeger = tamTutar(atf);
  if (!degerler.every(v => Number.isFinite(v)) || !Number.isFinite(atfDeger)) return durdur('payda-bilinmiyor');
  // Negatif net müşteri (iade): eski formül 0–10.000 ölçeğinin dışına taşıyordu.
  if (degerler.some(v => v < 0) || atfDeger < 0) return durdur('negatif-pay');

  // İlk N: azalan, `sayiSirala(a, b, true)` (yön `-cmp` ile ÇEVRİLMEZ); toplam ÖNCE, bölme SONRA.
  // Bu noktada tüm satırlar TAM → düz sayı üzerinden sıralanır. Payda K21 paydası (kimliksiz DÂHİL).
  const ilkToplam = [...degerler].sort((a, b) => sayiSirala(a, b, true)).slice(0, ilkN).reduce((s, v) => s + v, 0);
  const ilk3Pay = ilkN > 0 ? (ilkToplam / payda) * 100 : null;

  // O4 (orkestratör 2026-09-25, K23 ilkesi — kullanıcı: "Önerin ok. Sorunun cevabı dediğin gibi olacak." / "girilmeyen hesaba katılmaz + not"): müşteriye bağlanamayan ciro HHI'ya girmez, not olur.
  // HHI paydası YALNIZ atfedilebilen satırlar; GİRDİ sırasıyla 0'dan toplanır = eski `total220` ifadesi (bit-bit parite).
  const hhiPaydasi = degerler.reduce((s, v) => s + v, 0);
  if (hhiPaydasi <= 0) {
    return { hhi: null, seviye: null, ilk3Pay, ilkN, toplam, bilinmeyenSatir, endeksDisiCiro: atfDeger, neden: 'atfedilebilen-yok' };
  }

  // HHI = sum of (market share %)^2 — normalized 0-10000
  // GİRDİ sırasıyla toplanır (musteriOzeti = İLK GÖRÜLME = eski Object.values sırası) → bilinen girdide bit-bit parite.
  const hhi = degerler.reduce((s, v) => s + Math.pow((v / hhiPaydasi) * 100, 2), 0);
  // Sınıf YUVARLANMIŞ değerden: ekranda basılan sayı ile rozet ÇELİŞMESİN (eski GenelBloklar2 P220 `hhiRounded`).
  const yuvarlak = Math.round(hhi);
  const [orta, yuksek] = HHI_ESIKLERI;
  // O4: 1.500 DAHİL orta, 2.500 DAHİL orta (panel metni "1500-2500 orta") — alt eşik `>=`, üst eşik `>`.
  const seviye: YogunlasmaSeviyesi = yuvarlak > yuksek ? 'yuksek' : yuvarlak >= orta ? 'orta' : 'dusuk';
  return { hhi, seviye, ilk3Pay, ilkN, toplam, bilinmeyenSatir, endeksDisiCiro: atfDeger, neden: null };
}
