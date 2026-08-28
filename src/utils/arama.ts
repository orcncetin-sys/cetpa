/**
 * arama.ts — Türkçe-duyarlı metin arama.
 *
 * ## Neden gerekli
 *
 * `String.prototype.toLowerCase()` Türkçe'yi YANLIŞ katlar:
 *   'IŞIK'.toLowerCase()  → 'işık'   (doğrusu 'ışık' — I harfi ı olmalı)
 *   'İSTANBUL'.toLowerCase() → 'i̇stanbul' (birleşik nokta kalır)
 *
 * Sonuç: kullanıcı "ışık" yazar, kayıt "IŞIK"tır, EŞLEŞMEZ. Arama sessizce
 * "sonuç yok" der — kayıt orada durduğu hâlde. Bu, kod tabanında zaten bir kez
 * bulunmuştu (`TerritoryModule.tsx:72-76`, şehir eşleştirme).
 *
 * ## Ne yapıyor
 *
 * 1. `toLocaleLowerCase('tr')` ile doğru Türkçe küçültme.
 * 2. Türkçe'ye özgü harfleri ASCII karşılığına indirger (ş→s, ı→i, ğ→g,
 *    ü→u, ö→o, ç→c). Böylece arama İKİ YÖNDE de bağışlayıcı olur: "sisli"
 *    yazan "Şişli"yi, "ISIK" yazan "Işık"ı bulur. Klavyesinde Türkçe karakter
 *    olmayan kullanıcı da arayabilir.
 *
 * Bilinçli sınır: bu bir "arama motoru" değil — alt dize eşleşmesi.
 * Bulanık/typo toleransı YOK, çünkü fatura no ve cari kodda yanlış eşleşme
 * doğru cevaptan kötüdür.
 */

const TR_HARITA: Record<string, string> = {
  'ş': 's', 'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u',
};

/** Aramaya hazır biçim: Türkçe-doğru küçük harf + ASCII indirgeme. */
export function katla(metin: unknown): string {
  if (metin === null || metin === undefined) return '';
  return String(metin)
    .toLocaleLowerCase('tr')
    .replace(/[şığüöçâîû]/g, k => TR_HARITA[k] ?? k)
    // Birleşik noktalı i (U+0307) — bazı kaynaklarda 'İ' bunu bırakır.
    .replace(/̇/g, '');
}

/**
 * `alanlar` içindeki HERHANGİ biri `sorgu`yu içeriyor mu?
 * Boş/boşluklu sorgu her zaman `true` döner (filtre uygulanmaz).
 */
export function eslesir(sorgu: string, ...alanlar: unknown[]): boolean {
  const q = katla(sorgu).trim();
  if (!q) return true;
  return alanlar.some(a => katla(a).includes(q));
}
