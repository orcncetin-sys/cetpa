/**
 * bakiyeDamgasi.ts: «son bakiye çekimi: {tarih}» damgası TEK kaynak (şartname «Mikro bağlantı A» A3.4, 2026-11-05).
 * Test: bakiyeDamgasi.test.ts.
 *
 * NEDEN: `cariBalances` 17.10.2026'dan beri tazelenmiyordu (yalnız elle düğme); Risk, Muhasebe AR/AP + Bilanço ve Siparişler
 * «Alacak Toplam» 19 günlük bakiyeyi tarihsiz gösteriyordu. Gece 03:20 artık bakiyeyi çekiyor; ekran yine de bakiyenin YAŞINI
 * söylemeli (gece adımı düşerse bayatlık görünür). En son zaman tek yardımcıdan (`utils/zaman.sonGuncellemeMs`); belge yoksa
 * damga BASILMAZ (uydurma tarih yok, «şimdi» de değil).
 *
 * BAYAT EŞİĞİ 48 saat: kullanıcı kararı (05.11.2026, şartname soru 18 önerisi). Gece adımı her gün koştuğu için bir gece
 * kaçarsa damga henüz sarı değildir; iki gece üst üste kaçarsa sarı.
 */
import { tarihSaatYaz, type ArayuzDili } from '../zaman';

export const BAYAT_BAKIYE_ESIGI_SAAT = 48;
const ESIK_MS = BAYAT_BAKIYE_ESIGI_SAAT * 3600 * 1000;

export interface BakiyeDamgasi {
  /** Ekrana basılacak metin (bayatsa uyarı eki dâhil). */
  metin: string;
  /** Son çekim eşikten eski mi (ekran sarı basar). */
  bayat: boolean;
}

/** `sonMs` null → damga yok (null). `simdiMs` çağırandan gelir (test edilebilirlik). */
export function bakiyeDamgasi(sonMs: number | null, simdiMs: number, dil: ArayuzDili): BakiyeDamgasi | null {
  if (sonMs === null || !Number.isFinite(sonMs)) return null;
  const tarih = tarihSaatYaz(sonMs, undefined, dil);
  const bayat = simdiMs - sonMs > ESIK_MS;
  const govde = dil === 'tr' ? `son bakiye çekimi: ${tarih}` : `last balance pull: ${tarih}`;
  const ek = dil === 'tr' ? ` · ${BAYAT_BAKIYE_ESIGI_SAAT} saatten eski` : ` · older than ${BAYAT_BAKIYE_ESIGI_SAAT} hours`;
  return { metin: bayat ? govde + ek : govde, bayat };
}
