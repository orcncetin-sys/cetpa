/**
 * acilisTani.ts — "site açılırken veri çekmekle uğraşıyor" ve "veri geceleri güncellenmiyor" şikâyetlerinin ÖLÇÜMÜ
 * (2026-10-08). Saf; İŞ VERİSİ DÖNDÜRMEZ — yalnız koleksiyon adı, satır sayısı, bayt, zaman ve başarı bayrağı.
 *
 * NEDEN: iki şikâyet de tarayıcı oturumu olmadan ölçülemiyordu.
 *   • Açılış: istemci tek bir SSE bağlantısında abone olduğu koleksiyonların TÜM satırlarını alır (`/api/db/stream?init=*`).
 *     Hangi koleksiyonun kaç bayt taşıdığı bilinmeden "neyi açılıştan çıkaralım" kararı tahmin olur.
 *   • Gece senkronu: sonuç yalnız `syncLog` koleksiyonunda; jetonlu hiçbir uç onu okumuyordu. `docs.updated_at` her yazımda
 *     sunucuda damgalanır (pgShim) — koleksiyonun SON YAZIM zamanı "dün gece güncellendi mi" sorusunun doğrudan yanıtıdır.
 * Hata METNİ dönmez (Mikro/SQL hata metni cari adı, kod, sorgu parçası taşıyabilir) — yalnız kaba SINIFI.
 */

export type HataSinifi = 'zamanAsimi' | 'baglanti' | 'kolon' | 'kimlik' | 'diger';

/** Hata metninin kaba sınıfı; hata yoksa null. Metnin kendisi dışarı verilmez. */
export function hataSinifi(hata: unknown): HataSinifi | null {
  if (typeof hata !== 'string' || hata.trim() === '') return null;
  if (/timeout|timed out|zaman aşım|zaman asim|ETIMEDOUT|aborted|AbortError/i.test(hata)) return 'zamanAsimi';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|bağlant|baglant/i.test(hata)) return 'baglanti';
  if (/Invalid column|Invalid object name|kolon/i.test(hata)) return 'kolon';
  if (/\b401\b|\b403\b|unauthor|yetki|şifre|sifre|login|token/i.test(hata)) return 'kimlik';
  return 'diger';
}

export interface SenkronSatiri {
  /** ISO; `docs.updated_at` (syncLog salt-ekleme olduğu için = yazım anı). */
  zaman: string;
  /** İşlem adı — SQL importunda `SQL:<Mikro tablosu>`. */
  islem: string;
  /** Hedef koleksiyon / varlık türü. */
  hedef: string;
  basarili: boolean;
  /** null = ölçülemedi (yarıda kalan iş). */
  sureMs: number | null;
  /** Zamanlanmış iş (kullanıcı `system`) mi, elle mi. */
  sistem: boolean;
  /** SQL importu özetinin başındaki kayıt sayısı; özet öyle başlamıyorsa null (0 DEĞİL). */
  kayit: number | null;
  /** Özet "SAYFA TAVANINA ÇARPTI" diyor — veri eksik çekildi. */
  tavan: boolean;
  /** Özet ⚠ işareti taşıyor (süpürge hatası, GUID'siz satır…). */
  uyari: boolean;
  hataSinifi: HataSinifi | null;
}

const metin = (v: unknown): string => (typeof v === 'string' ? v : '');
/**
 * İşlem / hedef adı yalnız TANIMLAYICI biçimindeyse dışarı çıkar (`SQL:CARI_HESAP_HAREKETLERI`, `mikroCariHareketler`,
 * `EBelgeDurumSorgulamaV2`). Güvence çağıranların sabit ad göndermesine bırakılmaz: `/api/mikro/evrak/kaydet` `entityType`'ı
 * İSTEMCİDEN alıp günlüğe yazıyor — serbest metin (boşluk, rakamla başlayan, Türkçe harf: unvan, telefon) yer tutucuya döner.
 * Boş ad boş kalır. BİLİNEN SINIR: tek sözcüklük ASCII metin biçime uyar.
 */
const TANIMLAYICI = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
/** Sunucunun KENDİ yazdığı `SQL:<tablo>` adı takma ad (`SQL:CARI_HESAP_HAREKETLERI cha` — gece fatura / iptal fatura importu)
 *  ve parantezli ek (`SQL:STOK_HAREKETLERI(KDV)`) taşır; genel desen bunları boşluk / parantez yüzünden gizliyordu (inceleme
 *  2026-10-08). Dar tutulur: tek kısa küçük harfli takma ad + tek büyük harfli ek — serbest metne kapı açmaz. */
const SQL_ISLEM_ADI = /^SQL:[A-Z][A-Z0-9_]*(?: [a-z]{1,8})?(?:\([A-Z0-9_]{1,12}\))?$/;
export const TANIMSIZ_AD = '(tanımsız)';
/** Dışa açık (2026-10-18): Mikro gönderim ölçüm kaydı (`src/server/mikro/gonderimOzeti.ts`) istemcinin `entityType`'ını ve hata adını
 *  AYNI kuralla süzer — ikinci bir «tanımlayıcı mı» düzenli ifadesi yazılmaz. */
export const adAlani = (v: unknown, enUzun: number): string => {
  const s = metin(v);
  return s === '' ? '' : s.length <= enUzun && (TANIMLAYICI.test(s) || SQL_ISLEM_ADI.test(s)) ? s : TANIMSIZ_AD;
};

/** Bir `syncLog` dokümanını değer taşımayan tanı satırına çevirir. */
export function senkronSatiri(data: Readonly<Record<string, unknown>>, zaman: string): SenkronSatiri {
  const ozet = metin(data.entityId);
  const m = /^(\d+) kayıt/.exec(ozet);
  return {
    zaman,
    islem: adAlani(data.operation, 80),
    hedef: adAlani(data.entityType, 60),
    basarili: data.success === true,
    sureMs: typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : null,
    sistem: data.userId === 'system',
    kayit: m ? Number(m[1]) : null,
    tavan: ozet.includes('TAVANINA ÇARPTI'),
    uyari: ozet.includes('⚠'),
    hataSinifi: data.success === true ? null : hataSinifi(data.error),
  };
}

export interface GeceOzeti {
  /** İstanbul takvim günü (YYYY-AA-GG). */
  gun: string;
  basarili: number;
  hatali: number;
  /** O gün zamanlanmış koşuda görülen ilk ve son kayıt saati (İstanbul, SS:DD). */
  ilk: string;
  son: string;
}

const istanbul = (iso: string): { gun: string; saat: string } | null => {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return null;
  // sv-SE: "2026-10-08 03:21:07" — yerel ayardan bağımsız, sıralanabilir.
  const s = t.toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' });
  return { gun: s.slice(0, 10), saat: s.slice(11, 16) };
};

/**
 * Zamanlanmış (sistem) koşuların GÜN GÜN özeti, yeniden eskiye. Elle başlatılan işler sayılmaz — soru "gece kendiliğinden
 * koştu mu". Listede OLMAYAN gün = o gün zamanlanmış hiçbir iş günlüğe yazmadı (koşmadı ya da günlük penceresi dışında).
 */
export function geceOzeti(satirlar: readonly SenkronSatiri[]): GeceOzeti[] {
  const gunler = new Map<string, GeceOzeti>();
  for (const s of satirlar) {
    if (!s.sistem) continue;
    const z = istanbul(s.zaman);
    if (!z) continue;
    const g = gunler.get(z.gun) ?? { gun: z.gun, basarili: 0, hatali: 0, ilk: z.saat, son: z.saat };
    gunler.set(z.gun, g);
    if (s.basarili) g.basarili++; else g.hatali++;
    if (z.saat < g.ilk) g.ilk = z.saat;
    if (z.saat > g.son) g.son = z.saat;
  }
  return [...gunler.values()].sort((a, b) => b.gun.localeCompare(a.gun));
}

export interface KoleksiyonOlcusu { ad: string; satir: number; bayt: number; sonYazim: string | null }

/** `SELECT coll, count, sum(octet_length), max(updated_at)` satırlarını sayıya çevirir (pg bigint'i METİN döndürür). */
export function koleksiyonOlculeri(rows: readonly Readonly<Record<string, unknown>>[]): { koleksiyonlar: KoleksiyonOlcusu[]; toplam: { satir: number; bayt: number } } {
  const koleksiyonlar: KoleksiyonOlcusu[] = [];
  let satir = 0, bayt = 0;
  for (const r of rows) {
    const n = Number(r.satir), b = Number(r.bayt);
    if (!Number.isFinite(n) || !Number.isFinite(b)) continue;      // okunamayan satır toplamı BOZMASIN (0 diye de sayılmaz)
    const son = r.son instanceof Date ? r.son : typeof r.son === 'string' ? new Date(r.son) : null;
    koleksiyonlar.push({ ad: String(r.coll ?? ''), satir: n, bayt: b, sonYazim: son && Number.isFinite(son.getTime()) ? son.toISOString() : null });
    satir += n; bayt += b;
  }
  koleksiyonlar.sort((a, b) => b.bayt - a.bayt);
  return { koleksiyonlar, toplam: { satir, bayt } };
}
