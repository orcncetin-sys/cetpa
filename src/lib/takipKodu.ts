/**
 * takipKodu.ts — kimliksiz sipariş takip bağlantısının TAHMİN EDİLEMEZ kodu: biçimin ORTAK tanımı (şartname
 * `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` T1 / TA / TC; 2026-10-19). Yaprak, saf modül: sunucu (üretici, takip ucu, korunan
 * alan listesi) ve istemci (pano yardımcısı) AYNI sabiti okur.
 *
 * NEDEN: kimliksiz `GET /api/track/:orderId` siparişi doküman kimliğiyle okuyordu ve güvenlik varsayımı «kimlik rastgele»ydi. Mikro
 * faturasından türeyen siparişin kimliği `mikrofat__<cid>__<seri>-<sıra>` — tek MF bağlantısı kiracı kimliğini verir, öteki MF
 * siparişleri sırayla okunurdu (durum, il, kargo numarası). Bağlantı artık siparişe sunucunun yazdığı bu kodu taşır.
 *
 * Biçim: 22 karakter base62 (`[0-9A-Za-z]`) ≈ 131 bit. base64url KULLANILMAZ: `-` / `_` taşımaz, dolayısıyla hiçbir kod `__`
 * içeremez ve ayrılmış kimliklerle (`__`) karışmaz. Üretici yalnız sunucuda (server/takipKodu — `crypto.randomInt`, sapmasız).
 * Alanı YALNIZ sunucu yazar (`/api/db` yazamaz — collections.SUNUCU_TURETILEN_ALANLAR); tekillik küresel (docsSema tekil dizin).
 */

/** Siparişteki alanın adı. Korunan alan listesi ve SQL bu sabitten okur. */
export const TAKIP_KODU_ALANI = 'takipKodu' as const;

/** Kod uzunluğu (karakter). 62^22 ≈ 2^131. */
export const TAKIP_KODU_UZUNLUK = 22;

/** Alfabe (base62). Üretici bu dizgiden seçer; biçim deseni aynı kümeyi tanır. */
export const TAKIP_KODU_ALFABESI = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Geçerli kodun biçimi. Takip ucu yalnız bu biçimdeki parametreyi kod olarak veritabanına sorar. */
export const TAKIP_KODU_BICIMI = /^[0-9A-Za-z]{22}$/;

/** Değer geçerli biçimde bir takip kodu mu. */
export function takipKoduMu(v: unknown): v is string {
  return typeof v === 'string' && TAKIP_KODU_BICIMI.test(v);
}

/**
 * Takip ucunun ESKİ yolu (doküman kimliğiyle okuma) bu parametreye açık mı (TC (2) / (3)). `__` içeren kimlikleri sunucu üretir
 * (`mikrofat__…`, `shopify__…`) ve tahmin edilebilir olanları vardır → o yoldan OKUNMAZ (404, «yok» ile aynı yanıt). Müşterinin
 * elindeki eski rastgele kimlikli bağlantılar (`genDocId` / istemci kimliği — `__` taşımaz) çalışmaya devam eder.
 */
export function eskiTakipYoluAcik(parametre: string): boolean {
  return parametre !== '' && !parametre.includes('__');
}

/**
 * Takip kodu taşıyan bağlantının müşteriye gösterdiği sipariş numarası: `orderNumber` (boş olmayan metin) → `shopifyOrderId`
 * (metin / sayı) → `null`. Doküman kimliğinden HİÇBİR ŞEY türetilmez (TC) — MF kimliği (`mikrofat__<cid>__<seri>-<sıra>`)
 * kiracıyı ve fatura sırasını verirdi; `kimlik.slice(0, 8)` MF'de «MIKROFAT» basıyordu.
 * TEK tanım (2026-10-20): takip ucunun kod yolu (server.ts `takipYaniti`) ve sipariş durum e-postası (routes/epostaRoutes — konu
 * satırı ve «SİPARİŞ NO» bloğu) AYNI numarayı basar; e-postadaki bağlantı kod yoluna gider, müşteri iki yerde aynı numarayı görür.
 */
export function gorunenTakipNo(o: Record<string, unknown>): string | null {
  if (typeof o.orderNumber === 'string' && o.orderNumber.trim() !== '') return o.orderNumber;
  const s = o.shopifyOrderId;
  if (typeof s === 'string' && s.trim() !== '') return s;
  if (typeof s === 'number' && Number.isFinite(s)) return String(s);
  return null;
}
