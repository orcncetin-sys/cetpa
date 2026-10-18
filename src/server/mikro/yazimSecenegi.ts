/**
 * yazimSecenegi.ts — Mikro'ya YAZAN çağrıların ortak `mikroPost` seçeneği ve «stub» yanıtının tek tanımı
 * (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md` K0a + § 8.2 commit 0-A; kullanıcı kararı S2, 2026-10-18).
 *
 * NEDEN: `mikroPost`, `result` anahtarı olmayan 200 yanıtında (stub — `{ "Method": "…" }`) BULUT kipinde belirteci tazeleyip AYNI
 * gövdeyi İKİNCİ kez gönderir. Stub «Mikro isteği aldı mı» sorusunu yanıtlamaz: ilk istek işlendiyse ikinci gönderim ikinci kayıttır
 * (S2: sonucu bilinmeyen gönderim ASLA kendiliğinden yeniden gönderilmez). Bu yalnız `FaturaKaydetV2`'de kapatılmıştı; bütün yazan
 * çağrılar (`src/server/routes/mikroRoutes.ts` 12 çağrı + `scripts/luca-dekont-aktar.ts`) artık AYNI sabiti geçer. Okuyan çağrılar
 * (liste, SQL, durum sorgusu, PDF / XML) DEĞİŞMEZ: varsayılan `true`, ikinci gönderim zararsızdır.
 * Canlı LOKAL kipte (Ö20, 2026-10-18) stub tekrarı zaten koşmaz; orada değişen yalnız ileti metnidir (bugün «HTTP 200»).
 * Çit: `yazimSecenegi.degismez.test.ts` (yazan çağrı sabitsiz → kırmızı).
 *
 * YAPRAK modül: hiçbir şey içe aktarmaz (`mikroClient` ve rotalar bunu içe aktarır; döngü olmaz).
 */

/** Yazan çağrının 4. argümanı. `as const`: değer derin eşitlikte bugünkü satır içi `{ stubYenidenDeneme: false }` ile aynıdır. */
export const MIKRO_YAZIM_SECENEGI = { stubYenidenDeneme: false } as const;

/**
 * Mikro «stub» gövdesi: nesne ama `result` anahtarı yok (`{ "Method": "StokKaydetV2" }`). TEK tanım — `mikroClient.mikroPost`'un
 * stub dalı ve hata iletisi bunu çağırır. Gövde dizeyse (HTML hata sayfası) ya da `null` ise stub DEĞİLDİR.
 */
export function mikroStubMu(d: unknown): boolean {
  return !!d && typeof d === 'object' && !('result' in (d as Record<string, unknown>));
}

/**
 * Stub yanıtında kullanıcıya gösterilen ileti. `MikroPushButton` hata metnini 90 karakterde keser (`slice(0, 90)`) — metin ona
 * sığacak kadar kısa tutulur (şartname § 8.1 H1 «Kesinleştirme»; çit: `yazimSecenegi.test.ts`, en çok 90 karakter).
 */
export const MIKRO_STUB_METNI = "Mikro yanıtı eksik; kayıt Mikro'da OLABİLİR. Göndermeden önce Mikro'yu kontrol edin.";

/**
 * Başarısız yazımın hata metni: stub (HTTP başarılı + `result` yok — `mikroPost` stub dalıyla aynı koşul) → `MIKRO_STUB_METNI`;
 * değilse bugünkü ifade `result[0].ErrorMessage || HTTP <durum>`. Başarı koşulu çağıranda kalır, bu işlev yalnız metni üretir.
 */
export function yazimHataMetni(ok: boolean, status: number, data: unknown): string {
  if (ok && mikroStubMu(data)) return MIKRO_STUB_METNI;
  const sonuc = data && typeof data === 'object' ? (data as Record<string, unknown>).result : undefined;
  const ilk: unknown = Array.isArray(sonuc) ? sonuc[0] : undefined;
  const ileti = ilk && typeof ilk === 'object' ? (ilk as Record<string, unknown>).ErrorMessage : undefined;
  // Bugünkü `(r0?.ErrorMessage || …) as string` ile aynı doğruluk sınaması; dize olmayan dolu değer (yalnız derleme zamanı
  // dökümüyle geçiyordu) metne çevrilir.
  if (ileti) return typeof ileti === 'string' ? ileti : String(ileti);
  return `HTTP ${status}`;
}
