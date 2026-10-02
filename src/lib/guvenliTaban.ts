/**
 * guvenliTaban.ts — `settings`'ten okunan entegrasyon TABAN ADRESİNİN doğrulaması (2026-10-02).
 *
 * Arıza sınıfı (tarama bulgusu «ozel-uclar:1», CONFIRMED): Luca / SAP / iyzico kimlik bilgisi `settings` dokümanında
 * duruyorsa taban adres de oradan okunuyor ve HİÇ doğrulanmıyordu. Ayarı yazabilen biri `baseUrl`'i kendi sunucusuna
 * çevirdiğinde sunucu saklı sırrı (Bearer anahtarı, SAP kullanıcı adı + parolası, iyzico imzası) o adrese KENDİSİ
 * gönderiyordu — sır yanıtta maskelense de böyle dışarı çıkıyordu.
 *
 * Kural: sağlayıcının adresi sabitse (Luca, iyzico) yalnız izin listesindeki host kabul edilir; müşterinin kendi
 * sunucusuysa (SAP Service Layer) https + genel ağ adresi şartı aranır. Uymayan değer için varsayılana SESSİZCE
 * dönülmez — `TabanAdresHatasi` fırlar, çağıran kimlik bilgisini hiçbir yere göndermez ve kullanıcı nedenini görür.
 * Dönen değer ham metin DEĞİL, ayrıştırılmış adresin kendisidir (denetlenen ile kullanılan aynı şey olsun).
 *
 * Ortam değişkeninden (.env) gelen adres bu kapıdan GEÇMEZ: onu sunucu işletmecisi yazar, uygulama kullanıcısı değil.
 */

export class TabanAdresHatasi extends Error {
  constructor(mesaj: string) { super(mesaj); this.name = 'TabanAdresHatasi'; }
}

export interface TabanKurali { ad: string; hostlar: readonly string[]; varsayilan: string }

export const LUCA_TABAN: TabanKurali = { ad: 'Luca', hostlar: ['api.luca.com.tr'], varsayilan: 'https://api.luca.com.tr' };
export const IYZICO_TABAN: TabanKurali = {
  ad: 'iyzico', hostlar: ['api.iyzipay.com', 'sandbox-api.iyzipay.com'], varsayilan: 'https://sandbox-api.iyzipay.com',
};

/**
 * SSRF kapısı — yalnız GENEL http(s) adresine izin verir (iç ağ / döngü / bulut metadata engeli). server.ts `isSafePublicUrl`
 * bunun takma adıdır (webhook hedefi ve SAP taban adresi aynı kapıdan geçer).
 * 2026-10-02 incelemesi: eski sürüm IPv6'yı HİÇ yakalamıyordu — WHATWG URL IPv6 hostname'ini köşeli parantezle verir (`[::1]`),
 * `h === '::1'` asla eşleşmez; `fd…` / `fc…` / `fe80…` ön ek denetimi ise parantez yüzünden IPv6'ya değil, o harflerle başlayan
 * meşru ALAN ADLARINA (`fc-erp.musteri.com`) uyuyordu. Ondalık / onaltılık IPv4 yazımını URL ayrıştırıcı noktalı biçime çevirir
 * (`http://2130706433` → `127.0.0.1`), ayrıca ele almak gerekmez. DNS'in iç ağa çözülmesi (rebinding) bu kapının DIŞINDADIR.
 */
export function genelAdresMi(ham: string): boolean {
  let u: URL;
  try { u = new URL(ham); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');   // sondaki nokta: `localhost.` da localhost'tur
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    // ::1 döngü, :: belirsiz, fc00::/7 yerel, fe80::/10 bağlantı-yerel, ::ffff:… IPv4-eşlemeli ve 64:ff9b::… NAT64 (iç ağ IPv4'ü taşır).
    return !(v6 === '::1' || v6 === '::' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('::ffff:') || v6.startsWith('64:ff9b:'));
  }
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  // Sayısal aralık kuralları YALNIZ IPv4 yazımına: rakamla başlayan ALAN ADI (`10.musteri.com`, `0.pool.ntp.org`) iç ağ değildir —
  // aynı hata harf ön eklerinde (fc/fd) düzeltilirken sayısal ön eklerde kalmıştı (hakem 2026-10-02).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (/^(0|10|127)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  }
  return true;
}

/** Ayrıştır + ortak şartlar: https, adres içinde kullanıcı adı/parola yok. Sorgu dizesi ve parça atılır. */
function ayristir(ham: unknown, ad: string): URL {
  let u: URL;
  try { u = new URL(String(ham).trim()); } catch { throw new TabanAdresHatasi(`${ad} taban adresi geçerli bir adres değil.`); }
  if (u.protocol !== 'https:') throw new TabanAdresHatasi(`${ad} taban adresi https olmalı.`);
  if (u.username || u.password) throw new TabanAdresHatasi(`${ad} taban adresi kullanıcı adı/parola içeremez.`);
  return u;
}

const duz = (u: URL): string => `${u.origin}${u.pathname.replace(/\/+$/, '')}`;

/** Sağlayıcı adresi SABİT olan entegrasyon: boşsa varsayılan; doluysa host izin listesinde ve varsayılan kapıda olmalı. */
export function izinliTaban(ham: unknown, kural: TabanKurali): string {
  if (ham === undefined || ham === null || String(ham).trim() === '') return kural.varsayilan;
  const u = ayristir(ham, kural.ad);
  if (u.port !== '' || !kural.hostlar.includes(u.hostname.toLowerCase())) {
    throw new TabanAdresHatasi(`${kural.ad} taban adresi izin listesinde değil (kabul edilen: ${kural.hostlar.join(', ')}).`);
  }
  return duz(u);
}

/** Müşterinin kendi sunucusu (SAP Service Layer): https + iç ağ / döngü adresi değil. `genelMi` = sunucunun SSRF kapısı. */
export function genelHttpsTaban(ham: unknown, ad: string, genelMi: (adres: string) => boolean): string {
  const u = ayristir(ham, ad);
  if (!genelMi(u.href)) throw new TabanAdresHatasi(`${ad} taban adresi iç ağ ya da yerel bir adres olamaz.`);
  return duz(u);
}
