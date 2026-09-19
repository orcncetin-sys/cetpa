/**
 * jumpSurum.ts — `MIKRO_JUMP_SURUM` ortam değerini ANA sürüm sayısına çevirir (SAF; env'i çağıran okur).
 *
 * Eski okuma `Number(process.env.MIKRO_JUMP_SURUM || 16)` idi. Mikro'nun "Hakkında" penceresi sürümü
 * "17.07d (Jump)" biçiminde yazar; bu metin ortam dosyasına aynen konursa `Number(...)` NaN verir ve
 * `NaN >= 17` false olduğu için V17'ye bağlı HER davranış (belge tipi `cha_ebelge_turu`, fatura çekimi,
 * maliyet listesi cron'u) SESSİZCE kapanır — log'da tek satır iz bırakmadan (2026-09-19 kullanıcı yanıtı).
 *
 * Kural: baştaki sayı okunur ("17", "17.07d", "v17", " 17.07d(jump) " → 17). Değer VARSA ama sayı
 * çıkmıyorsa bu bir yapılandırma hatasıdır: `gecersiz: true` döner, çağıran YÜKSEK SESLE uyarır.
 * Değer hiç yoksa varsayılan 16'dır (bilinen en eski kurulum; V17 uçlarını canlı yoklama ayrıca dener).
 */
export const JUMP_SURUM_VARSAYILAN = 16;

export interface JumpSurumSonucu {
  /** Karşılaştırmalarda kullanılan ANA sürüm (tam sayı): 16, 17… */
  surum: number;
  /** Ortam değeri doluydu ama içinden sürüm okunamadı — varsayılana düşüldü, uyarılmalı. */
  gecersiz: boolean;
}

export function jumpSurumOku(ham: string | null | undefined): JumpSurumSonucu {
  const metin = (ham ?? '').trim();
  if (!metin) return { surum: JUMP_SURUM_VARSAYILAN, gecersiz: false };
  const eslesme = metin.match(/^[vV]?\s*(\d{1,3})(?:[.,]\d+)?/);
  const ana = eslesme ? Number(eslesme[1]) : NaN;
  if (!Number.isFinite(ana) || ana <= 0) return { surum: JUMP_SURUM_VARSAYILAN, gecersiz: true };
  return { surum: ana, gecersiz: false };
}
