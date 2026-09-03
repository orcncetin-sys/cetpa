/**
 * geminiDayanikli.ts — Gemini çağrılarında geçici hataya dayanıklılık. TEK KAYNAK.
 *
 * NEDEN VAR (2026-09-03): Ticaret ajanı panelinde kullanıcıya Google'ın ham
 * 503 JSON yığını gösterildi ("high demand"). O uçta retry + sınıflandırma
 * yazıldı, ama code review ölçtü: aynı geçici hata sınıfına açık ÜÇ üretim ucu
 * daha var (/api/ai/generate, /api/ai/chat, /api/ai/demand-forecast) ve hepsi
 * retry'sız, jenerik 500 dönüyordu. Kural: bandaid'i tek uca değil, mekanizmaya
 * uygula — bu yüzden mantık burada tek yerde.
 *
 * İKİ İŞ:
 *   1. `geminiDene`: geçici hatada (503/UNAVAILABLE/overloaded) artan beklemeyle
 *      3 deneme; kalıcı hatada (anahtar/kota) beklemeden çıkar.
 *   2. `geminiHataMesaji`: SDK hatasını kullanıcıya gösterilebilir TÜRKÇE mesaja
 *      çevirir — ham JSON/stack asla istemciye sızmaz.
 */

/** Geçici (yeniden denenebilir) hata imzaları — tek yerde tanımlı. */
const GECICI = /high demand|UNAVAILABLE|overloaded|\b503\b/i;
const ANAHTAR = /API key|PERMISSION_DENIED|API_KEY_INVALID|\b401\b|\b403\b/i;
const KOTA = /quota|RESOURCE_EXHAUSTED|\b429\b/i;

/** Hata → kullanıcıya gösterilebilir Türkçe mesaj + HTTP kodu. */
export function geminiHataMesaji(hata: unknown): { mesaj: string; kod: number } {
  const m = hata instanceof Error ? hata.message : String(hata);
  if (ANAHTAR.test(m)) {
    return { kod: 503, mesaj: 'Gemini anahtarı geçersiz/yetkisiz görünüyor — Ayarlar → AI bölümünden anahtarı yenileyin (aistudio.google.com/apikey) ve "Test Et" ile doğrulayın.' };
  }
  if (KOTA.test(m)) {
    return { kod: 503, mesaj: 'Gemini kotası dolu (429) — ücretsiz katman günlük sınırına takılmış olabilir; bir süre sonra deneyin ya da anahtarı faturalı projeye taşıyın.' };
  }
  if (GECICI.test(m)) {
    return { kod: 503, mesaj: 'Google Gemini şu an yoğun (503) — birkaç deneme yapıldı, model yanıt veremedi. Birkaç dakika sonra tekrar deneyin; sorun bizde değil, Google tarafında geçici.' };
  }
  return { kod: 502, mesaj: 'AI çağrısı başarısız: ' + m.slice(0, 180) };
}

/**
 * `cagri`'yı geçici hatada yeniden dener (varsayılan 3 deneme, 0/2/4 sn bekleme).
 * Kalıcı hatada ilk denemede fırlatır — beklemek anlamsız. Son hata olduğu gibi
 * fırlatılır; çağıran `geminiHataMesaji` ile insanileştirir.
 */
export async function geminiDene<T>(cagri: () => Promise<T>, denemeSayisi = 3): Promise<T> {
  let sonHata: unknown;
  for (let deneme = 0; deneme < denemeSayisi; deneme++) {
    if (deneme > 0) await new Promise(res => setTimeout(res, deneme * 2000));
    try {
      return await cagri();
    } catch (e) {
      sonHata = e;
      const m = e instanceof Error ? e.message : String(e);
      if (!GECICI.test(m)) break;
    }
  }
  throw sonHata;
}
