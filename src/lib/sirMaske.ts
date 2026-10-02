/**
 * sirMaske.ts — `settings` (ve denetim kaydı) içindeki SIR alanlarının maskelenmesi: TEK KAYNAK, saf (2026-10-02).
 *
 * NEDEN AYRI MODÜL: çekirdek (`SECRET_FIELD_RE` / `maskSecrets` / `redactForRole` / `stripRedacted`) server.ts `startServer` içinde
 * kapanış olarak duruyordu — import edilemediği için HİÇ testi yoktu ve dört ayrı sızıntı bu yüzden fark edilmedi (2026-10-02 ölçümü):
 *   • PUT / PATCH / POST / increment / cas yanıtı birleştirilmiş dokümanı MASKESİZ döndürüyordu → Manager maskeyi aşıyordu;
 *   • denetim kaydının alan farkı (`computeFieldDiff`) sırrın eski ve yeni değerini DÜZ METİN yazıyordu;
 *   • maskeli gelen alan yalnız ÜST düzeyde ayıklanıyordu → iç içe nesnedeki (`companySettings.shopify_access_token`) maske
 *     gerçek sırrın ÜZERİNE '***REDACTED***' olarak yazılıyordu (maskeli formu kaydeden Manager sırrı siliyordu).
 * Kural: sır, ALAN ADINDAN tanınır (değerinden değil). Yalnız metin değerler maskelenir; boş metin maskelenmez ("kayıtlı değil"
 * bilgisi kaybolmasın).
 */
import type { AppRole } from './rbac';

/** Sır taşıyan alan adları (harf duyarsız, alt dize). Yeni entegrasyon alanı eklerken adı buna UYMALI — uymuyorsa deseni genişlet. */
export const SIR_ALANI_DESENI = /(password|passwd|sifre|parola|secret|apikey|api_key|accesstoken|access_token|token|privatekey|private_key|credential|smtppass|smtp_pass)/i;
export const MASKE = '***REDACTED***';

export const sirAlaniMi = (alan: string | undefined): boolean => !!alan && SIR_ALANI_DESENI.test(alan);

/**
 * Derinlemesine maskeler. İç içe nesnede anahtar adı kendi düzeyinde aranır; dizi elemanlarına DİZİNİN anahtarı geçer
 * (`apiKeys: ['a','b']` — eleman düzeyinde anahtar yoktur). Sır adlı bir alanın değeri NESNE ise (`token: { value }`) altındaki
 * tüm metinler de maskelenir (üst anahtar miras kalır).
 */
export function sirMaskele(v: unknown, anahtar?: string): unknown {
  if (typeof v === 'string') return sirAlaniMi(anahtar) && v !== '' ? MASKE : v;
  if (Array.isArray(v)) return v.map(x => sirMaskele(x, anahtar));
  if (v && typeof v === 'object') {
    const ustSir = sirAlaniMi(anahtar);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = sirMaskele(val, ustSir ? anahtar : k);
    return out;
  }
  return v;
}

/** `settings` dokümanı Admin DIŞINDAKİ role maskeli döner. Başka koleksiyon ve Admin: aynen. */
export function rolIcinMaskele(rol: AppRole | null, coll: string, data: unknown): unknown {
  return coll !== 'settings' || data == null || rol === 'Admin' ? data : sirMaskele(data);
}

/**
 * Yazma gövdesindeki MASKE değerlerini (maskeli formu geri gönderen istemci) gerçek sırrın üzerine YAZDIRMAZ: maske gelen her yolda
 * `onceki` dokümandaki değer geri konur; öncesi yoksa alan düşürülür. DERİN çalışır — yama sığ birleştirildiği için iç içe nesne
 * bütün olarak yer değiştirir; maskeyi yalnız ayıklamak iç içe sırrı SİLERDİ, olduğu gibi bırakmak '***REDACTED***' ile EZERDİ.
 * Dizi: aynı sıradaki eski eleman geri konur (yoksa eleman düşer). `settings` dışı koleksiyonda dokunulmaz.
 */
export function maskeyiGeriYukle(coll: string, gelen: Record<string, unknown>, onceki: Record<string, unknown> | undefined): Record<string, unknown> {
  if (coll !== 'settings' || !gelen) return gelen;
  return nesneGeriYukle(gelen, onceki) as Record<string, unknown>;
}
const YOK = Symbol('yok');
const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function degerGeriYukle(g: unknown, o: unknown): unknown {
  if (g === MASKE) return o === undefined || o === MASKE ? YOK : o;
  if (Array.isArray(g)) {
    const eski = Array.isArray(o) ? o : [];
    return g.map((x, i) => degerGeriYukle(x, eski[i])).filter(x => x !== YOK);
  }
  if (nesneMi(g)) return nesneGeriYukle(g, nesneMi(o) ? o : undefined);
  return g;
}
function nesneGeriYukle(g: Record<string, unknown>, o: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    // Nokta-yollu yama anahtarı ('a.b.c': v — mergeDocData): önceki değer o yoldan okunur.
    const eski = k.includes('.') ? k.split('.').reduce<unknown>((c, p) => (nesneMi(c) ? c[p] : undefined), o) : o?.[k];
    const yeni = degerGeriYukle(v, eski);
    if (yeni !== YOK) out[k] = yeni;
  }
  return out;
}

/**
 * Denetim kaydı alan farkı için değer: sır adlı alan (ya da içinde sır adlı alan taşıyan nesne) maskelenir. KOLEKSİYONDAN
 * BAĞIMSIZ — sır alanı hangi koleksiyonda olursa olsun günlüğe düz metin girmez. `MASKE` değişikliğin OLDUĞUNU gösterir
 * (from ≠ to karşılaştırması çağıranda ham değerlerle yapılır), değerini göstermez.
 */
export function farkDegeriMaskele(alan: string, deger: unknown): unknown {
  return sirMaskele(deger, alan);
}

/**
 * Entegrasyonun BAĞLANTI ADRESİ alanları (taban adres, sunucu, uç, alan adı). Sunucu saklı kimlik bilgisini bu adrese KENDİSİ
 * gönderir; adresi değiştirebilen sırrı görmeden çalabilir (2026-10-02: Manager `settings/luca.baseUrl`'i kendi sunucusuna çevirip
 * `Authorization: Bearer <apiKey>` başlığını alabiliyordu). Görsel / site adresi gibi zararsız alanlar hariç.
 */
const ADRES_ALANI_DESENI = /(url|uri|host|endpoint|domain|server|sunucu)$/i;
// TAM AD (ön ek + doğrudan url/uri): `logoUrl`, `websiteUrl`, `photoURL` zararsız; `webhookUrl` ve `logoApiUrl` (Logo ERP'nin
// bağlantı adresi — yalnız ön eke bakılırken "logo görseli" sayılıyordu) zararsız DEĞİL.
const ZARARSIZ_ADRES_DESENI = /^(logo|website|site|photo|image|resim|gorsel|görsel|avatar|icon|profil)_?(url|uri)$/i;
export const adresAlaniMi = (alan: string): boolean => ADRES_ALANI_DESENI.test(alan) && !ZARARSIZ_ADRES_DESENI.test(alan);

/**
 * Yazma gövdesi bir bağlantı adresi alanını DEĞİŞTİRİYOR mu? Değiştiriyorsa alanın yolunu, yoksa null döner. Derin; nokta-yollu yama
 * anahtarı (`a.b.baseUrl`) da tanınır. Aynı değeri yeniden göndermek değişiklik DEĞİLDİR (form bütün dokümanı geri yollar).
 */
export function ayarAdresAlaniDegisti(gelen: Record<string, unknown>, onceki: Record<string, unknown> | undefined): string | null {
  return adresFarki(gelen, onceki, '');
}
const bos = (x: unknown): boolean => x == null || x === '';
function adresFarki(g: Record<string, unknown>, o: Record<string, unknown> | undefined, yol: string): string | null {
  for (const [k, v] of Object.entries(g)) {
    const parcalar = k.split('.');
    const eski = parcalar.reduce<unknown>((c, p) => (nesneMi(c) ? c[p] : undefined), o);
    const tamYol = yol ? `${yol}.${k}` : k;
    if (nesneMi(v)) {
      const alt = adresFarki(v, nesneMi(eski) ? eski : undefined, tamYol);
      if (alt) return alt;
      continue;
    }
    // Boş ile EKSİK aynıdır (form dokunulmamış adres kutusunu '' olarak yollar; okuyucular `x || varsayılan` kullanır) — yoksa
    // adrese hiç dokunmayan Manager her kayıtta 403 alırdı. Dolu adresi boşaltmak ise değişikliktir.
    if (adresAlaniMi(parcalar[parcalar.length - 1]) && !(bos(v) && bos(eski)) && JSON.stringify(v ?? null) !== JSON.stringify(eski ?? null)) return tamYol;
  }
  return null;
}
