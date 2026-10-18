/**
 * ettn.ts — GUID / ETTN ölçütlerinin TEK kaynağı (şartname «fatura gövde + gece MF» § 9.B B4, 2026-10-19). YAPRAK modül: içe
 * aktarması yok; sunucu (faturadan sipariş G3a / bekletme, `fatura/sonuc` «Mikro'da var» + ETTN ve «ETTN ekle») ve istemci
 * (düğme koşulu, girdi sınaması — ikinci tur) AYNI işlevleri okur.
 *
 * `guidAnahtari` / `guidBicimli` eskiden `server/mikro/faturaTani.ts`'te, `ettnGecerli` `server/mikro/ebelgeDurumTani.ts`'teydi;
 * gövdeler BİREBİR taşındı, iki dosya buradan içe aktarıp yeniden dışa aktarır (mevcut içe aktaranlar değişmedi).
 * `src/lib/gibDurum.ts`'teki katı yerel kopya bu işte DEĞİŞMEDİ (ayrı iş).
 */

/** GUID karşılaştırma anahtarı: süslü parantez ve harf büyüklüğü farkı eşleşmeyi bozmasın. */
export const guidAnahtari = (v: unknown): string => String(v ?? '').trim().replace(/^\{|\}$/g, '').toLowerCase();
export const guidBicimli = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(v);

/** ETTN biçimi (36 karakter, onaltılık + tire; sıfır GUID değil) — yalnız bu biçimdeki değer Mikro'ya gönderilir. */
export const ettnGecerli = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v.trim()) && !/^[0-]+$/.test(v.trim());

/**
 * Cetpa siparişindeki «geçerli ETTN»in anahtarı; geçerli değilse `''` (§ 9.A A4 + § 9.B B4). SIRA: önce normalleştir, sonra sına —
 * tersi süslü parantezli geçerli GUID'i (38 karakter) reddederdi. `guidBicimli` tire yerlerini de sınar (`ettnGecerli` yalnız
 * karakter kümesine ve uzunluğa bakar); `ettnGecerli` sıfır GUID'i eler (İnceleme 1, İ-2: tek sıfır-ETTN'li sipariş `cha_uuid`'i
 * sıfır olan TÜM faturaları bastırırdı). G3a Cetpa kümesi, bekletmenin H1 (b) dalı, `fatura/sonuc` ETTN sınaması ve istemci
 * düğme koşulu YALNIZ bunu çağırır. `FATURA_TALEP_SQL` / `FATURA_OKU_SQL`'deki düz «dolu» ölçütü bilerek bu değildir (çift kesim
 * korumasında güvenli yön: sıfır ETTN'li sipariş de «kesilmiş» sayılır).
 */
export const cetpaEttnAnahtari = (v: unknown): string => {
  const k = guidAnahtari(v);
  return guidBicimli(k) && ettnGecerli(k) ? k : '';
};
