/**
 * tenantBackup.ts — kiracı-bazlı yedek planlaması (saf mantık, testlenebilir).
 *
 * 2026-08-21 kararı: "her yeni şirket kendi setup'ını gerektirsin" — yani her
 * kiracı KENDİ hesabına (kendi Drive/Mega/... remote'una) yedeklenir. Tam
 * izolasyon: A firmasının verisi B firmasının deposuna asla düşmez, ve veri
 * müşterinin kendi elinde durur (KVKK açısından da en temiz kurgu).
 *
 * ÖNCEKİ DURUM: tek bir `pg_dump` TÜM kiracıları birlikte alıyordu. Bu, çok
 * kiracılı bir SaaS için kabul edilemez — bir müşteriye yedeğini vermek
 * diğerlerinin verisini de vermek anlamına gelirdi.
 *
 * NEDEN pg_dump DEĞİL: pg_dump kiracıya göre süzemiyor. Tüm veri tek bir
 * `docs (coll, id, data JSONB)` tablosunda olduğu için kiracı export'u basit
 * bir sorgu + NDJSON dosyası. Taşınabilir ve geri yüklenebilir.
 *
 * Bu dosya SADECE karar mantığını taşır (hangi kiracı, hangi koleksiyon,
 * hangi dosya adı, hangi uyarı) — I/O yok, böylece testlenebilir.
 */

export interface YedekAyari {
  companyId: string;
  /** rclone remote, ör. "musteri-a-gdrive:cetpa-yedek". Boşsa kurulum yapılmamış. */
  rcloneRemote?: string;
  enabled?: boolean;
  retentionDays?: number;
  lastRunAt?: unknown;
  lastStatus?: 'ok' | 'error';
}

export interface YedekPlani {
  companyId: string;
  remote: string;
  retentionDays: number;
  dbDosyaAdi: string;
  uploadsDosyaAdi: string;
}

/** Kurulum yapılmamış kiracılar için sebep — onboarding kapısı bunu gösterir. */
export type AtlamaSebebi = 'kurulum-yok' | 'devre-disi';

export const VARSAYILAN_SAKLAMA_GUN = 30;

/** rclone remote biçimi: "isim:yol" — iki nokta ZORUNLU, isim boş olamaz. */
export function remoteGecerliMi(v: string | undefined): boolean {
  if (!v || !v.trim()) return false;
  const i = v.indexOf(':');
  return i > 0 && i < v.length; // "ad:" geçerli (kök), ":yol" değil
}

/**
 * Bir kiracı için yedek planı üretir; kurulum yoksa SEBEBİYLE birlikte atlar.
 * Sessizce atlamak YASAK: çağıran taraf atlananları raporlamak zorunda —
 * "yedek alınıyor sanılan ama alınmayan kiracı" bu projedeki en pahalı
 * hata sınıfının (sessiz başarısızlık) tam örneği olurdu.
 */
export function yedekPlani(
  ayar: YedekAyari,
  zamanDamgasi: string,
): { plan: YedekPlani } | { atla: AtlamaSebebi } {
  if (ayar.enabled === false) return { atla: 'devre-disi' };
  if (!remoteGecerliMi(ayar.rcloneRemote)) return { atla: 'kurulum-yok' };
  const guvenliId = ayar.companyId.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    plan: {
      companyId: ayar.companyId,
      remote: ayar.rcloneRemote as string,
      retentionDays: ayar.retentionDays && ayar.retentionDays > 0
        ? ayar.retentionDays
        : VARSAYILAN_SAKLAMA_GUN,
      dbDosyaAdi: `cetpa_${guvenliId}_${zamanDamgasi}.ndjson.gz`,
      uploadsDosyaAdi: `cetpa_${guvenliId}_uploads_${zamanDamgasi}.tar.gz`,
    },
  };
}

/**
 * Kiracı verisini süzen SQL. ETİKETSİZ (companyId'siz) satırlar BİLEREK
 * DIŞARIDA: hangi kiracıya ait oldukları belirsiz, bir kiracının yedeğine
 * koymak diğerinin verisini sızdırmak olabilir. Bunlar operatör tarafında
 * ayrıca ele alınır — çağıran taraf sayısını raporlar.
 */
export const KIRACI_SORGUSU =
  "SELECT coll, id, data FROM docs WHERE data->>'companyId' = $1 ORDER BY coll, id";

/** Etiketsiz satır sayısı — operatörün görmesi gereken boşluk. */
export const ETIKETSIZ_SAYIM_SORGUSU =
  "SELECT count(*)::int AS n FROM docs WHERE NOT (data ? 'companyId')";
