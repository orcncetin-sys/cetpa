/**
 * kullaniciSayimi.ts — «canlıda kaç rolsüz / dış rol hesabı var?» ÖLÇÜMÜ (2026-10-11, şartname «dış rol kapanışı» D6).
 * Saf; yalnız SAYAR. `GET /api/ops/sir-tani` yanıtının `kullanici` bloğunu üretir.
 *
 * NEDEN: dış rol (B2B, Bayi) ve rolsüz hesap yüzeyi kapatılırken canlıda böyle hesap olup olmadığı ÖLÇÜLEMİYORDU (ölçen uç
 * yoktu). Yayından sonra bu blok okunur; sıfırdan büyükse hesaplar kullanıcıya ayrı bir adımda listelenir.
 *
 * NE DÖNER / NE DÖNMEZ: yalnız sayılar ve en yeni dış rol giriş ZAMANI. Ad, e-posta, kullanıcı / kiracı kimliği YOK — işlevin
 * girdisi de bunları taşımaz: çağıran veritabanından yalnız `role` ve `lastLogin` alanlarını seçer (ops jetonu kişi verisi
 * dökmez). Çıktının her alanı burada kurulur; girdideki fazladan alan yanıta GEÇEMEZ.
 */
import { APP_ROLES, EXTERNAL_ROLES } from '../lib/rbac.js';

/** Bir `users` belgesinden ölçüme giren İKİ alan (ham değerler). */
export interface KullaniciSatiri {
  rol: unknown;
  sonGiris: unknown;
}

export interface KullaniciSayimi {
  /** `users` belgesi sayısı. */
  toplam: number;
  /** `role` değeri bilinen bir rol OLMAYAN belge: alan yok, boş, ya da geçersiz değer (sayı, uydurma dizge). */
  rolsuz: number;
  /** Dış rol başına belge sayısı — anahtarlar `EXTERNAL_ROLES`'tan türer (küme büyürse blok da büyür). */
  disRol: Record<string, number>;
  /** Dış rol hesaplarının EN YENİ giriş zamanı (ISO 8601, UTC); dış rol yoksa ya da hiçbirinin giriş zamanı okunamıyorsa `null`. */
  disRolSonGiris: string | null;
}

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Giriş zamanı → epoch milisaniye; okunamıyorsa `null` (0 UYDURULMAZ). Tanınan biçimler: sunucu damgası `{ _seconds }`
 * (pgShim `resolveSentinels`), Firestore dışa aktarımı `{ seconds }`, ISO metni, epoch milisaniye sayısı.
 */
function girisMs(v: unknown): number | null {
  // Üst sınır `Date`'in gösterebildiği en büyük an: ötesinde `toISOString()` fırlatır (bozuk kayıt ölçümü düşürmesin).
  const gecerli = (ms: number): number | null => (Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? ms : null);
  if (typeof v === 'number') return gecerli(v);
  if (typeof v === 'string') return gecerli(Date.parse(v));
  if (nesneMi(v)) {
    const sn = typeof v._seconds === 'number' ? v._seconds : typeof v.seconds === 'number' ? v.seconds : null;
    return sn === null ? null : gecerli(sn * 1000);
  }
  return null;
}

export function kullaniciSayimi(satirlar: readonly KullaniciSatiri[]): KullaniciSayimi {
  const disRol: Record<string, number> = Object.fromEntries(EXTERNAL_ROLES.map(r => [r, 0]));
  let rolsuz = 0;
  let enYeni: number | null = null;
  for (const s of satirlar) {
    const rol = s.rol;
    if (typeof rol !== 'string' || !(APP_ROLES as readonly string[]).includes(rol)) { rolsuz++; continue; }
    if (!(EXTERNAL_ROLES as readonly string[]).includes(rol)) continue;
    disRol[rol]++;
    const ms = girisMs(s.sonGiris);
    if (ms !== null && (enYeni === null || ms > enYeni)) enYeni = ms;
  }
  return { toplam: satirlar.length, rolsuz, disRol, disRolSonGiris: enYeni === null ? null : new Date(enYeni).toISOString() };
}
