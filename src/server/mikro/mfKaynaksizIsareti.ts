/**
 * mfKaynaksizIsareti.ts: Mikro'da aynı numarada SATIŞ faturası olmayan MF siparişinin («kaynaksız») işaretini yazan ve kaldıran TEK
 * yazıcı (şartname `.wf/SARTNAME-mikro-baglanti-b.md` B2 § 4.2, BH12; 05.11.2026). Kullanıcı kararı: «Rozet + ciro dışı»; sipariş
 * SİLİNMEZ, `status` / `iptalKaynagi` / `totalPrice` DEĞİŞMEZ.
 *
 * NEDEN DOĞRUDAN SQL: `orders.mfKaynaksiz` ve `mfKaynaksizGoruldu` sunucunun türettiği alanlardır (collections.SUNUCU_TURETILEN_ALANLAR).
 * pgShim `set(merge)` / `update` bu alanları satırdaki GÜNCEL değerle korur (pgShim.ts `PgDocRef.set`); `batch.update(ref,
 * { mfKaynaksiz: null })` sessizce DÜŞERDİ. Desen `faturaGonderimi.ts`: koşullu `UPDATE … RETURNING`, yayın RETURNING satırından.
 *
 * KURAL (çağıran `mfIptalEsle`, routes/mikroRoutes):
 *   • YAZ: kaynaksız aday (geçerli satış faturası VARKEN sayılan, iptal edilmemiş MF) işaretlenir; işaretli olana ikinci yazım yok
 *     (idempotent; `mfKaynaksizGoruldu` İLK görülme zamanıdır).
 *   • OLAĞANDIŞILIK EŞİĞİ: aday sayısı `MF_KAYNAKSIZ_ESIGI`'ni (10) AŞARSA hiçbir işaret YAZILMAZ (Mikro kayıt silebiliyor, boş sonuç
 *     kanıt değil; bugün beklenen ≤ 3). Kaldırma eşikten etkilenmez.
 *   • KALDIR: faturası geçerli ya da iptal listesinde görünen (kaynak VAR) işaretli MF'nin işareti kalkar.
 *   • İki SQL de yazanla aynı koşulları taşır: kiracı, `source = MF_KAYNAGI` (BH12, derinlemesine savunma).
 */
import { MF_KAYNAGI, MF_KAYNAKSIZ_ALANI, MF_KAYNAKSIZ_GORULDU_ALANI } from '../../lib/mfKaynagi.js';

/** Bir koşuda bundan FAZLA kaynaksız aday çıkarsa işaret yazılmaz (koruma; iş kuralı değil). */
export const MF_KAYNAKSIZ_ESIGI = 10;

// Gömülen sabitler biçim çitinden geçer (SQL'e metin olarak girer).
for (const [ad, deger, desen] of [
  ['MF_KAYNAGI', MF_KAYNAGI, /^[A-Za-z0-9_-]+$/], ['MF_KAYNAKSIZ_ALANI', MF_KAYNAKSIZ_ALANI, /^[A-Za-z0-9_]+$/],
  ['MF_KAYNAKSIZ_GORULDU_ALANI', MF_KAYNAKSIZ_GORULDU_ALANI, /^[A-Za-z0-9_]+$/],
] as const) if (!desen.test(deger)) throw new Error(`mfKaynaksizIsareti: ${ad} SQL'e gömülemez ('${deger}')`);

/** $1 = id listesi, $2 = kiracı, $3 = ilk görülme zamanı (ISO). */
export const MF_KAYNAKSIZ_YAZ_SQL =
  `UPDATE docs SET data = data || jsonb_build_object('${MF_KAYNAKSIZ_ALANI}', true, '${MF_KAYNAKSIZ_GORULDU_ALANI}', $3::text), updated_at = now() ` +
  `WHERE coll = 'orders' AND id = ANY($1::text[]) AND data->>'companyId' = $2 AND data->>'source' = '${MF_KAYNAGI}' ` +
  `AND COALESCE(data->>'${MF_KAYNAKSIZ_ALANI}', '') <> 'true' RETURNING id, data`;

/** $1 = id listesi, $2 = kiracı (BH12). */
export const MF_KAYNAKSIZ_KALDIR_SQL =
  `UPDATE docs SET data = data - '${MF_KAYNAKSIZ_ALANI}' - '${MF_KAYNAKSIZ_GORULDU_ALANI}', updated_at = now() ` +
  `WHERE coll = 'orders' AND id = ANY($1::text[]) AND data->>'companyId' = $2 AND data->>'source' = '${MF_KAYNAGI}' ` +
  `AND data ? '${MF_KAYNAKSIZ_ALANI}' RETURNING id, data`;

export interface IsaretHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

export interface IsaretGirdisi {
  /** Bu koşuda kaynaksız sayılan (iptal edilmemiş) MF siparişlerinin kimlikleri; işaretli olanlar dâhil (eşik bunu sayar). */
  adaylar: readonly string[];
  /** Kaynağı görünen (geçerli / iptal listesinde) ve işaret taşıyan MF siparişlerinin kimlikleri. */
  kaldirilacak: readonly string[];
  /** İlk görülme zamanı (ISO). */
  simdiIso: string;
}

export interface IsaretSonucu {
  /** Bu koşuda YENİ işaretlenen sipariş sayısı (zaten işaretli olan sayılmaz). */
  isaretlenen: number;
  /** İşareti kaldırılan sipariş sayısı. */
  kaldirilan: number;
  /** Eşik aşıldıysa aday sayısı (hiçbir işaret yazılmadı); aşılmadıysa `null`. */
  esikAsildi: number | null;
}

/** İşaret yaz / kaldır. Havuz yoksa (lokal Firestore yedeği) hiçbir şey yapılmaz (`null`). SQL hatası fırlar (çağıranın try'ı). */
export async function mfKaynaksizIsaretle(
  havuz: IsaretHavuzu | null, cid: string, g: IsaretGirdisi, yayinla: (id: string, data: unknown) => void,
): Promise<IsaretSonucu | null> {
  if (!havuz || !cid) return null;
  let isaretlenen = 0, kaldirilan = 0;
  const esikAsildi = g.adaylar.length > MF_KAYNAKSIZ_ESIGI ? g.adaylar.length : null;
  if (g.kaldirilacak.length > 0) {
    const { rows } = await havuz.query(MF_KAYNAKSIZ_KALDIR_SQL, [[...g.kaldirilacak], cid]);
    for (const r of rows) { kaldirilan++; yayinla(String(r.id), r.data); }
  }
  if (esikAsildi === null && g.adaylar.length > 0) {
    const { rows } = await havuz.query(MF_KAYNAKSIZ_YAZ_SQL, [[...g.adaylar], cid, g.simdiIso]);
    for (const r of rows) { isaretlenen++; yayinla(String(r.id), r.data); }
  }
  return { isaretlenen, kaldirilan, esikAsildi };
}
