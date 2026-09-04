/**
 * buyukHarf.ts — Türkçe'ye uygun büyük/küçük harf dönüşümü. TEK KAYNAK.
 *
 * NEDEN VAR (2026-09-04, kullanıcı bildirdi: "büyük harf İ?"):
 * `String.prototype.toUpperCase()` locale-duyarsızdır ve HER ZAMAN İngilizce
 * kuralını uygular: 'i' → 'I'. Türkçe'de 'i' → 'İ'dir. Kullanıcı ekranda
 * "TESLIM EDILDI" gördü (doğrusu "TESLİM EDİLDİ").
 *
 * ⚠️ ASCII SLUG'A UYGULAMA — BU TURDA TAM BU HATA YAPILDI.
 * Bir alanın değeri translit edilmiş bir slug ise ('e-arsiv', 'ihracat',
 * 'siparis'), büyütmek doğru Türkçe ÜRETMEZ: 'e-arsiv' → 'E-ARSİV' çıkar,
 * doğrusu 'E-ARŞİV'dir ve eksik 'ş' harfini hiçbir casing geri getiremez.
 * Üstelik 'İ' eklemek metni kasıtlı Türkçe göstererek hatayı gizler.
 * Slug'ların ekran karşılığı `durumEtiketi.ts`'teki EŞLEME tablolarındadır
 * (`faturaTipiEtiketi`, `oncelikEtiketi`) — casing değil, çeviri sorunudur.
 * Aynı sebeple İngilizce enum'a da uygulama: 'high' → 'HİGH' olurdu.
 *
 * ⚠️ BU YARDIMCI YALNIZ EKRANA/BELGEYE BASILAN METİN İÇİNDİR.
 * KARŞILAŞTIRMA ve ARAMA'da KULLANMA — orada `toUpperCase()` doğru olandır:
 * locale-duyarlı casing 'I' ile 'İ'yi ayırır, dolayısıyla `sku.toUpperCase()
 * === aranan.toUpperCase()` gibi eşleştirmeler (MobileWMSModule barkod/SKU
 * taraması) Türkçe'ye çevrilirse SESSİZCE eşleşmeyi bırakır. Aynı sebeple
 * ID/hex/base36 üreten yerlere de dokunma — onlar zaten ASCII.
 */

/** Ekranda gösterilecek metni Türkçe kurallarıyla büyütür ('i' → 'İ'). */
export function buyukHarf(metin: string): string {
  return metin.toLocaleUpperCase('tr-TR');
}

/** Ekranda gösterilecek metni Türkçe kurallarıyla küçültür ('I' → 'ı'). */
export function kucukHarf(metin: string): string {
  return metin.toLocaleLowerCase('tr-TR');
}

/**
 * Baş harf(ler)i — avatar rozetleri için. Boş/eksik girdide '?' döner:
 * `''[0]` `undefined` verip `.toUpperCase()`'te çökerdi.
 */
export function basHarf(metin: string | null | undefined, adet = 1): string {
  const t = (metin ?? '').trim();
  return t ? buyukHarf(t.slice(0, adet)) : '?';
}
