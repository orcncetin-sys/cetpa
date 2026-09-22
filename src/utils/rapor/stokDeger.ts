/**
 * stokDeger.ts — rapor ekranlarının GRUP BAZLI stok adedi/değeri (Faz 3 6/n · 6a).
 * Test: stokDeger.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — src/components/reports/useReportsData.ts bugün AYNI envanteri üç kez, üç ayrı
 * kuralla tarıyor ve dördü de "bilinmeyen = 0" sayıyor:
 *   :202-206 `acc[category] = (acc[category] || 0) + item.stockLevel` → stoğu BİLİNMEYEN tek kart
 *            korumasız `+=` yüzünden TÜM kategoriyi NaN yapıyor; "kaç kartın stoğu bilinmiyor" yok.
 *   :232-234 `s + (i.stockLevel * itemPriceTRY(i, 'Retail', exchangeRates))` → `itemPriceTRY`
 *            çevrilemeyen/kursuz karta ₺0 döndüğü için kalem toplamdan SESSİZCE düşüyor.
 *   :235-241 `acc[cat].count += item.stockLevel` + `acc[cat].value += ... itemPriceTRY(...)` →
 *            yukarıdaki iki arıza kategori tablosunda da.
 *   :203 `item.category || currentT.other` ↔ :236 `item.category || 'Diğer'` → aynı boş kategori
 *            adet tablosunda "Other", değer tablosunda "Diğer" etiketiyle iki ayrı isimde çıkıyor.
 * TEK çağrı üçünü de besler (adet + değer + toplam), tek boş-kategori etiketiyle.
 *
 * KOPYA DEĞİL: "birim değer × stok" kuralı ve BİLİNEN 0 stok istisnası zaten testli —
 * `pano/stokSevkiyat.degerToplami`. Burada eksik olan YALNIZ gruplama; çarpım kuralı ikinci
 * kez yazılmaz, her grup için `degerToplami` ÇAĞRILIR.
 *
 * PARİTE: girdiler biliniyorsa sayı eskiyle birebir (test 1 eski iki `reduce`ı yeniden kurup
 * karşılaştırır). BİLİNÇLİ FARKLAR: (a) bilinmeyen stok/değer artık toplamı bozmaz, `Tutar`
 * sayaçlarına düşer (ekran "N kart tutarsız" notu basar); (b) boş kategori TEK kova.
 *
 * TABAN — 6a çağrısı PERAKENDE SATIŞ fiyatıdır, MALİYET DEĞİL (parite: bugünkü
 * `itemPriceTRY(i, 'Retail', …)`). Kullanıcı kararı K8 (2026-09-19): "alış günü maliyetinin
 * dolar kurundan çek, bugünün dolar kuru ile ver - ikisini de tabloda göster." + "bunu da
 * ekranda görebilelim". O karar tabanı MALİYETE çevirir ve 6h'de (Envanter) uygulanır —
 * `grupStokDegeri` tabanı BİLMEZ (`birimDeger` çağırandan gelir), bu yüzden K8 imzayı
 * DEĞİŞTİRMEDEN yaşar: 6h yalnız çağrıdaki `birimDeger`i değiştirir / ikinci çağrı ekler.
 */
import { satirTutari, toplaBilinen, type Tutar } from '../para';
import { degerToplami, type StokKalemi } from '../pano/stokSevkiyat';
import { stokSeviyesi } from '../pano/finansKpi';

export interface StokGrubu {
  /** Grup anahtarı; çözülemeyen → null. DİKKAT (etiket çarpışması): çağıran null'a bir ETİKET basacaksa ve o etiket gerçek
   *  bir grup adı OLABİLİYORSA ('Diğer' kategorisi) etiketi `grupSec` İÇİNDE uygulamalı — sonradan basılırsa iki grup aynı ada
   *  çarpışır (`Object.fromEntries` birini SESSİZCE ezer, pastada iki 'Diğer' dilimi çıkar). */
  anahtar: string | null;
  /** Kart (SKU) sayısı — stoğu/değeri bilinmeyen kart da SAYILIR (kayıt var, sayısı yok). */
  kart: number;
  /** Σ stockLevel — seviyesi bilinmeyen kart toplama girmez, `bilinmeyen` olarak sayılır. */
  adet: Tutar;
  /** Σ birimDeger × stockLevel — `degerToplami` sözleşmesi (bilinen 0 stok = gerçek 0). */
  deger: Tutar;
}

/**
 * Envanteri `grupSec` anahtarına göre kovalara ayırır; her kova için adet ve değer `Tutar`ı üretir.
 *
 * - Anahtar: `grupSec` çıktısı DOLU METİNSE trim'lisi, aksi hâlde `null` (tek kova). Başka tipte bir
 *   anahtar isteyen çağıran `grupSec` içinde metne çevirir — anahtarın TAMAMI çağıranın denetiminde
 *   olsun diye (bkz. `StokGrubu.anahtar` etiket çarpışması notu).
 * - Sıra = ilk görülme (bugünkü `reduce` sırasıyla parite). Sıralama ÇAĞIRANDA, `para.sayiSirala` ile.
 * - DEĞİŞMEZ: aynı anahtar iki kez geçmez; Σ `kart` === `envanter.length` (hiçbir kart kaybolmaz /
 *   iki gruba girmez); grupların `tutarBirlestir`i toplamlara eşittir.
 * - `birimDeger` SAF olmalı: toplamlar envanterin tamamı üzerinden ayrıca hesaplandığı için
 *   (parite: bugün `totalInventoryValueTRY` ayrı bir `reduce`) kart başına iki kez çağrılır.
 *   `cost.kartSatisTL` / `cost.kartMaliyetiTL` saftır. `itemPriceTRY` GEÇİRİLMEZ — çevrilemeyene
 *   0 döner ve kalem sessizce toplamdan düşer.
 * - Kanonik alan `stockLevel`. Eski `stock` alanı `degerToplami` okumadığı için burada da okunmaz
 *   (aksi hâlde adet ile değer ayrışırdı).
 */
export function grupStokDegeri<K extends StokKalemi>(
  envanter: readonly K[],
  grupSec: (k: K) => unknown,
  birimDeger: (k: K) => unknown,
): { gruplar: StokGrubu[]; toplamAdet: Tutar; toplamDeger: Tutar } {
  // Map: ekleme sırasını korur ve `null`ı gerçek bir anahtar olarak tutar (nesne anahtarı olsaydı
  // `null` "null" metnine dönüp gerçek bir 'null' kategorisiyle çarpışırdı).
  const kovalar = new Map<string | null, K[]>();
  for (const k of envanter) {
    const ham = grupSec(k);
    const anahtar = typeof ham === 'string' && ham.trim() !== '' ? ham.trim() : null;
    const kova = kovalar.get(anahtar);
    if (kova) kova.push(k);
    else kovalar.set(anahtar, [k]);
  }

  const gruplar: StokGrubu[] = [...kovalar].map(([anahtar, liste]) => ({
    anahtar,
    kart: liste.length,
    adet: toplaBilinen(liste, k => k.stockLevel),
    deger: degerToplami(liste, birimDeger),
  }));

  return {
    gruplar,
    toplamAdet: toplaBilinen(envanter, k => k.stockLevel),
    toplamDeger: degerToplami(envanter, birimDeger),
  };
}

/**
 * Bir stok KARTININ perakende değeri: `prices.Retail` (yoksa tek fiyatlı kartların `price`
 * alanı) × stok seviyesi. Faz 3 6a düzeltme turu (2026-09-22) ADDITIVE ekledi.
 *
 * ## NEDEN VAR
 * `EnvanterRapor` "Depo Özeti" tablosunun Değer hücresi
 * `item.stockLevel * (item.prices?.['Retail'] || 0)` yazıyordu. Aynı SATIRDA Stok ve Durum
 * hücreleri "karar verilemiyorsa BİLİNMİYOR" kuralına geçirilmişken bu hücre eski `|| 0`
 * sahte kesinliğinde kaldı: `Retail` fiyatı OLMAYAN kart (Mikro'da yalnız bayi/B2B kademesi
 * tanımlıysa `Retail` HİÇ yoktur — `server/mikro/eslemeStok.ts`) 120 adetlik ÇİMENTO 50KG'yi
 * "₺0" diye gösteriyor, kullanıcı fiyatı girilmemiş kalemi "değeri sıfır" okuyup stok değeri
 * sıralamasında en alta düşürüyordu. Klasik "null × miktar === 0" tuzağı; asimetri kanıtı:
 * stok bilinmiyorsa `undefined * 0 = NaN` → '—', fiyat bilinmiyorsa '₺0' çıkıyordu.
 *
 * ## SÖZLEŞME
 * TÜRETİLEN sayı (`para.satirTutari`): fiyat ya da stok bilinmiyorsa NaN — ekran '—' basar,
 * `fmtAna(0)` DEĞİL. MEŞRU sıfır korunur (0 stok / bedelsiz kalem gerçek ₺0'dır).
 * Stok seviyesi `pano/finansKpi.stokSeviyesi` ile okunur (kanonik `stockLevel`, eski kayıtta
 * `stock`) — satırın Stok hücresi de onu okuduğu için iki hücre AYRIŞAMAZ.
 *
 * ## PARİTE / BİLİNÇLİ FARK
 * Fiyat ve stok biliniyorsa sayı eskiyle BİREBİR. `priceCurrency` ÇEVRİLMEZ — bugünkü hücre de
 * çevirmiyordu (parite); döviz kademesi için `cost.kartSatisTL` ayrı bir iştir.
 */
export function kartPerakendeDegeri(k: StokKalemi & { stock?: unknown }): number {
  return satirTutari(k.prices?.['Retail'] ?? k.price, stokSeviyesi(k));
}
