/**
 * nakitDongusu.ts — Alacak Devir Günü (DSO) + Nakit Dönüşüm Döngüsü (CCC), tek kaynak
 * (Faz 3 6/n · 6a, 2026-09-19). Test: nakitDongusu.test.ts (ÖNCE yazıldı, kırmızı görüldü).
 * Saf: React/DB/kur yok.
 *
 * ## NEDEN VAR — sayfadaki sahte kesinlik siteleri
 * `src/components/reports/genel/GenelOzet.tsx` P185 "Nakit Dönüşüm Döngüsü (CCC)" kartı:
 *   :221 `unPaidOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *        → tutarı okunamayan ödenmemiş sipariş alacağa ₺0 giriyor. Alacak olduğundan KÜÇÜK
 *          çıkıyor, DSO düşüyor, kart yeşil "tahsilat sağlıklı" basıyor. Sayaç YOK.
 *   :226 `son90(izlenen185).reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *        → aynı arıza PAYDADA: ciro küçülünce DSO ŞİŞİYOR. İki arıza ters yönde çalıştığı için
 *          birbirini gizliyor — ekrandaki sayının hangi yöne saptığı bile bilinmiyor.
 *   :228 `dailyRev185 > 0 ? Math.round(arBalance / dailyRev185) : null`
 *        → TEK kapı günlük ciro; payın ya da paydanın KISMİ olup olmadığı hiç sorulmuyor.
 *   :248 `(dso !== null && dio !== null) ? dso + dio : null`
 *        → aritmetiği doğru ama hangi terimin eksik olduğunu söylemiyor; ekran '—' basıp
 *          nedenini yazamıyor (DIO tarafında `stokDevirGunu` bunu `neden` ile zaten çözmüştü).
 *
 * KURAL (CLAUDE.md): TÜRETİLEN sayı (gün/oran/fark) tek girdisi bile bilinmiyorsa HESAPLANMAZ →
 * `null`, ekran '—' + "N kayıt tutarsız" notu. Kısmi toplamdan gün üretilmez.
 *
 * ## PARİTE
 * Girdilerin hepsi biliniyorsa sayı eski satır içi hesapla BİREBİR: aynı bölme, aynı `Math.round`
 * (test 1 ve 10 eski `reduce` + bölmeyi yeniden kurup karşılaştırır). Değişen tek şey, girdisi
 * eksik olan vakanın artık sayı ÜRETMEMESİ.
 *
 * ## İKİZİ
 * DIO tarafı MEVCUT: `pano/raporMarj.stokDevirGunu` (aynı dönüş şekli `{ gün, neden }`, aynı kapı
 * `para.tamTutar`). Bu modül onun alacak tarafıdır; ikisi `nakitDongusu` ile toplanır. `raporMarj`
 * DOKUNULMADI. Bölme kopyası da yok: günlük ciro `pano/hedefButce.satisHizi` (testli).
 * 2026-09-20 hakem turunda `stokDevirGunuTutar` köprüsü eklendi (ADDITIVE): stok değerinin
 * `Tutar`dan sayıya hangi sözleşmeyle çevrildiği artık BAĞLAMADA değil, burada ve testli.
 *
 * ## İKİ AYRI DSO TANIMI (kasıtlı — karıştırma)
 *   (a) `muhasebe/finansalOranlar().oranlar.dso` (finansalOranlar.ts:125): `alacak / ciro × 365`,
 *       YIL geneli, Mikro cari + Mikro ciro ADDITIVE, `Oran { deger, bilinmeyen }` döner
 *       (bilinmeyen varken de DEĞER üretir — defter/oran paneli sözleşmesi).
 *   (b) Bu modülün çağıranı GenelOzet P185: 90 GÜNLÜK pencere, yalnız ödemesi Cetpa'da izlenen
 *       siparişler (`odemeTakipli`).
 * `alacakDevirGunu` KÜME-BAĞIMSIZDIR: hangi siparişlerin alacak sayıldığına ÇAĞIRAN karar verir.
 * Bu yüzden tanım değişince imza değişmez.
 *
 * ## UYGULANAN KULLANICI KARARI — K15 (2026-09-19). ARA DURUM UYARISI
 * Kullanıcının kendi cümleleri (BAĞLAYICI):
 *   • "Teslim edilmiş ama parası alınmamış sipariş alacağa girmiyor." → "girmeli."
 *   • "Teslim edilmemiş ama peşin ödenmiş sipariş alacak görünüyor." → "girmemeli. Sadece teslimat
 *     bekliyor olmalı. - eğer stok eksiği varsa, malzeme satın al şeklinde uyarı ver."
 *   • Defter tanımı (B: Mikro cari bakiyeleri + faturalanmamış ödenmemiş Cetpa siparişleri) → "Ok."
 * Yani alacak TAHSİLATA bakar, teslimata değil. GenelOzet P185'in bugünkü kümesi bunun TERSİDİR
 * (`status !== 'Delivered'` ile teslim edilmişi DIŞLAR, peşin ödenmişi İÇERİR) — bu ARA DURUMDUR,
 * 6c'de (K15-B) küme değişecek. 6a'da küme DEĞİŞMEZ; bu yardımcı o değişiklikten ETKİLENMEZ,
 * çünkü kümeyi çağıran kurar.
 *
 * ## BİLİNÇLİ FARKLAR (eski satıra göre)
 *   • Payda `≤ 0` iken eski kod da `null` dönüyordu ama NEDENİ yoktu: artık 'ciro-yok' ile
 *     'ciro-bilinmiyor' ayrı — ekran "satış yok" ile "veri eksik" arasını yazabiliyor.
 *   • Negatif günlük ciro (iade fazlası) 'ciro-yok'tur: negatif gün sayısı basılmaz.
 *   • Elle kurulmuş `Tutar`ın toplamı NaN/Infinity ise DSO üretilmez (savunma kapısı;
 *     `toplaBilinen` çıktısında gözlenemez — toplam her zaman sonludur).
 */
import { tamTutar, type Tutar } from '../para';
import { satisHizi } from '../pano/hedefButce';
import { stokDevirGunu, type DioNedeni } from '../pano/raporMarj';

/** DSO'nun hesaplanamama nedeni — ekran TEK neden yazar (`DioNedeni` deseni). `null` = hesaplandı. */
export type DsoNedeni = 'alacak-bilinmiyor' | 'ciro-bilinmiyor' | 'ciro-yok' | null;

/**
 * DSO = alacak / (dönem cirosu / gün sayısı) — TÜRETİLEN sayı: alacak ya da ciro KISMİ ise `null`.
 *
 * Kapı sırası (ekranda tek neden görüneceği için sabit):
 *   1. `alacak.bilinmeyen > 0`                      → 'alacak-bilinmiyor'
 *   2. ciroda bilinmeyen VAR ya da gün geçersiz      → 'ciro-bilinmiyor'  (`satisHizi.gunluk === null`)
 *   3. günlük ciro `≤ 0`                             → 'ciro-yok'         (0'a bölme / "0 gün" yok)
 *
 * Alacak 0 + ciro > 0 GERÇEK `0` gündür (bilinmeyen değil): hiç açık alacağı olmayan firma.
 *
 * @param alacak       Açık alacak toplamı — hangi siparişler olduğu ÇAĞIRANIN kararı (üstteki K15 notu).
 * @param donemCirosu  Aynı pencerenin cirosu (pay ve payda AYNI kümeden gelmeli).
 * @param gunSayisi    Pencerenin gün sayısı (P185'te 90).
 */
export function alacakDevirGunu(
  alacak: Tutar,
  donemCirosu: Tutar,
  gunSayisi: number,
): { dso: number | null; neden: DsoNedeni } {
  if (alacak.bilinmeyen > 0) return { dso: null, neden: 'alacak-bilinmiyor' };
  // `satisHizi` gün sayısını da doğrular (0 / negatif / okunamaz → gunluk null) ve ciroda tek
  // bilinmeyen kayıt varsa hız üretmez — iki geçersizlik de ekranda "ciro bilinmiyor"dur.
  const { gunluk } = satisHizi(donemCirosu, gunSayisi);
  if (gunluk === null) return { dso: null, neden: 'ciro-bilinmiyor' };
  if (gunluk <= 0) return { dso: null, neden: 'ciro-yok' };
  const acik = tamTutar(alacak);
  if (!Number.isFinite(acik)) return { dso: null, neden: 'alacak-bilinmiyor' };
  return { dso: Math.round(acik / gunluk), neden: null };
}

/**
 * DIO'nun `Tutar` kapısı — CCC'nin öteki terimi. `pano/raporMarj.stokDevirGunu`'ya SAYI geçirir;
 * o sayının hangi sözleşmeden çıkacağını (TÜRETME `tamTutar`, EKRAN `ekranTutari` DEĞİL) burada
 * kilitler. Gövde tek satırdır ve BİLEREK öyledir: kopya kural yok, yalnız köprü.
 *
 * ## NEDEN VAR (2026-09-20 hakem turu)
 * `GenelOzet.tsx:353` bu seçimi satır içi yapıyordu (`const stokDegeri185 = tamTutar(stok185)`).
 * Hakem onu `ekranTutari(stok185)` ile değiştirdi ve HİÇBİR test kırılmadı: `stokDevirGunu`'nun
 * kendi `stok-bilinmiyor` dalı testliydi ama ona kısmi bir toplam verilmesini engelleyen bir ölçü
 * yoktu. O hâlde maliyeti çözülemeyen kalemler ₺0 sayılır, eksik stoktan TAM görünen bir DIO
 * çıkar ve CCC kartı "sağlıklı" basar — `cubuk.ts`'in kısmi tepe ölçeğiyle aynı arıza sınıfı.
 *
 * Kapı SIRASI `stokDevirGunu`'nundur ve DEĞİŞTİRİLMEZ: maliyet → kalemsiz → COGS → stok
 * (ekranda TEK neden görünür). `raporMarj` DOKUNULMADI; bu modül onu yalnız çağırır.
 *
 * @param stok  Stok değeri toplamı + `bilinmeyen` sayacı (`pano/stokSevkiyat.degerToplami`).
 */
export function stokDevirGunuTutar(
  stok: Tutar,
  marj: Parameters<typeof stokDevirGunu>[1],
  gunSayisi: number,
): { dio: number | null; neden: DioNedeni } {
  return stokDevirGunu(tamTutar(stok), marj, gunSayisi);
}

/** CCC'nin eksik terimi — ekran hangi kutunun '—' olduğunu yazar. */
export type CccTerimi = 'dso' | 'dio';

/**
 * CCC = DSO + DIO (GenelOzet:248 paritesi). Terimlerden biri bilinmiyorsa CCC YOKTUR (`null`) ve
 * `eksik` hangi terim(ler) olduğunu SABİT sırayla adlandırır (dso, dio) — `(dso ?? 0) + (dio ?? 0)`
 * kalıbı "stok hiç beklemiyor" / "nakit döngüsü kısa" hükmünü bilinmeyen terimden üretirdi.
 *
 * `dpo` terimi 6a'da YOK (JIT): üretim tüketicisi yok, sabit 30 gün de uydurulmaz — K15 eki
 * "DPO yoksa CCC '—'". İlk gerçek tüketicinin alt fazında testleriyle birlikte ADDITIVE eklenecek
 * (isteğe bağlı alan; `undefined` → bugünkü iki terimli parite, `null` → `ccc null` + `eksik ['dpo']`).
 */
export function nakitDongusu(g: { dso: number | null; dio: number | null }): {
  ccc: number | null;
  eksik: CccTerimi[];
} {
  const dso = sonluGun(g.dso);
  const dio = sonluGun(g.dio);
  const eksik: CccTerimi[] = [];
  if (dso === null) eksik.push('dso');
  if (dio === null) eksik.push('dio');
  if (dso === null || dio === null) return { ccc: null, eksik };
  return { ccc: dso + dio, eksik };
}

/** Gün terimi bilinen sonlu sayı mı? (NaN/Infinity savunma kapısı — `null` ile aynı muamele.) */
function sonluGun(x: number | null): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}
