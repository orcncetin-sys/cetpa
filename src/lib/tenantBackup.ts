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
import { SERVER_ONLY_COLLECTIONS } from './collections.js';


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
/** Sırsız yedeklenen tek sunucuya özel koleksiyon ve atılan sır alanı — gerekçe `sunucuyaOzelListesi` üstünde. */
export const SIRSIZ_YEDEKLENEN = 'shopifyBaglantilari';
export const SIR_ALANI = 'webhookSecret';
export const KIRACI_SORGUSU =
  `SELECT coll, id, CASE WHEN coll = '${SIRSIZ_YEDEKLENEN}' THEN data - '${SIR_ALANI}' ELSE data END AS data ` +
  `FROM docs WHERE data->>'companyId' = $1 AND coll NOT IN (${sunucuyaOzelListesi()}) ORDER BY coll, id`;

/**
 * SUNUCUYA ÖZEL koleksiyonlar kiracı yedeğine GİRMEZ (2026-10-02): webhook imza sırrı taşıyan doküman `companyId`
 * etiketlidir — yedeğe girseydi sır düz metin dosyaya (ve uzak hedefe) yazılırdı. TEK İSTİSNA (2026-10-09, etkileşim
 * incelemesi): `shopifyBaglantilari` SIRSIZ girer (`data - 'webhookSecret'`) — aynı doküman sipariş kimliği TUZUNU taşır;
 * yedekten dönüp bağlantıyı yeniden kurmak yeni tuz üretirdi ve açık siparişlerin sonraki olayları ikinci kopya olarak
 * yazılırdı. `shopifyRoutes` yeniden kurulumda yarım kayıttaki tuzu zaten alır («Bağlantıyı kaldır» yolu). Liste koddaki
 * sabitten üretilir (kullanıcı girdisi değil); yine de yalnız tanımlayıcı biçimindeki adlar SQL'e girer.
 */
function sunucuyaOzelListesi(): string {
  const adlar = SERVER_ONLY_COLLECTIONS.filter(a => /^[A-Za-z][A-Za-z0-9_]*$/.test(a));
  if (adlar.length !== SERVER_ONLY_COLLECTIONS.length) throw new Error('SERVER_ONLY_COLLECTIONS içinde tanımlayıcı olmayan ad var');
  if (!adlar.includes(SIRSIZ_YEDEKLENEN)) throw new Error(`${SIRSIZ_YEDEKLENEN} SERVER_ONLY_COLLECTIONS içinde değil`);
  return adlar.filter(a => a !== SIRSIZ_YEDEKLENEN).map(a => `'${a}'`).join(', ');
}

/** Etiketsiz satır sayısı — operatörün görmesi gereken boşluk. */
export const ETIKETSIZ_SAYIM_SORGUSU =
  "SELECT count(*)::int AS n FROM docs WHERE NOT (data ? 'companyId')";
