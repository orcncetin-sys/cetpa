/**
 * sunucuHatasi.ts — veritabanı istemcisinin (`lib/dbClient`) fırlattığı hatadan sunucunun KULLANICIYA yazdığı nedeni çıkarır.
 *
 * dbClient hatayı `dbClient PUT /settings/luca → 403 {"error":"Bağlantı adresi (baseUrl) yalnız Yönetici …"}` biçiminde fırlatır.
 * Ekranlar bunu genel "Hata oluştu" bildirimine çeviriyordu; kullanıcı NEDEN reddedildiğini göremiyordu (2026-10-02 incelemesi:
 * bağlantı adresini değiştirmeye çalışan Manager). Yalnız 4xx yanıtın `error` metni döner — 5xx metni (iç ayrıntı) dönmez.
 */
export function sunucuHataMetni(hata: unknown): string | null {
  const ileti = hata instanceof Error ? hata.message : typeof hata === 'string' ? hata : '';
  const m = /→ (4\d\d) (\{.*)$/s.exec(ileti);
  if (!m) return null;
  try {
    const govde = JSON.parse(m[2]) as { error?: unknown };
    return typeof govde.error === 'string' && govde.error.trim() !== '' ? govde.error : null;
  } catch {
    return null;   // gövde 200 karakterde kesilmiş ya da JSON değil
  }
}
