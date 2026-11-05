/**
 * stokKodGocuKuru.ts — stok kodu göçünün KURU KOŞU motoru (şartname «Mikro bağlantı D» D1 + DH1 / DH2 / DH13 / DH16 / DH19;
 * 05.11.2026). SALT OKUMA: `docs` ve `mikro_stoklar` yalnız SELECT, Mikro yalnız `SqlVeriOkuV2` SELECT. HİÇBİR şey yazılmaz.
 * Ürün ADI dönmez: yanıtta yalnız kod, kart / belge kimliği, sayı, kolon adı ve imza.
 *
 * İki uç (ops jetonu + Yönetici; `routes/stokKodGocuRoutes.ts`) AYNI gövdeyi çağırır. Bağımlılıklar açık parametredir (havuz,
 * Mikro okuyucuları, kimlik çözücü) — motor `server.ts`'i ve rota modüllerini içe AKTARMAZ (döngü), testte PGlite + sahte Mikro.
 *
 * SIRA: Mikro `STOKLAR` (kod kümesi; okunamazsa HİÇBİR sınıf hesaplanmaz) → kiracı kartları → DH6 evreni → Mikro'da eski kodla
 * duran satır sayımı (DH2) → ayna GUID kanıtı (DH13) → hareket GUID kanıtı + yetim (B2b / DH2) → DH1 tablosuyla bağlı kayıt sayımı
 * → sınıflama → değişmezler, plan özeti, imza. DH6 değişmezi bozulursa sonuç `error`'dur.
 */
import { kolonSec } from '../../lib/mikroKolon.js';
import { zamanAsimiMi } from './adaptifSayfalama.js';
import {
  BAGLI_KAYIT_TABLOSU, GOC_SINIFLARI, MIKRO_KOD_UZUNLUK_SINIRI,
  aynaKanitlari, ayniSkuGruplari, bagliKayitlariSay, depoKimlikParcasi, gocEvreni, bicimliGuidAnahtari, hareketKanitlari, kodAnahtari,
  planImzasi, planOzeti, siniflandir,
  type AlanYolu, type GocKarti, type GocSatiri, type KodKaniti, type KoleksiyonSayimi, type MikroEskiKodSayimlari, type PlanOzeti,
  type SiniflamaSonucu, type TabloCifti, type HarfFarkiUyarisi, type GocSinifi,
} from './stokKodGocu.js';

/** Ham SQL çalıştıran en dar havuz yüzeyi (pg `Pool` buna uyar). */
export interface KuruPgHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}
export type MikroSqlOkuyucu = (sorgu: string, secenek?: { zamanAsimiMs?: number }) => Promise<{ rows: Record<string, unknown>[]; hata: string | null }>;

export interface KuruBagimliliklari {
  havuz: KuruPgHavuzu;
  mikroSql: MikroSqlOkuyucu;
  /** `mikroClient.mikroKolonlar` — Mikro kolon adı TAHMİN EDİLMEZ; her kolon şemadan süzülür. */
  mikroKolonlar: (tablo: string) => Promise<string[]>;
  /** server.ts `mikroIdCozucuIds` — `warehouseItems` kimliği import ile AYNI çözücüden (DH18). */
  mikroIdCozucuIds: (ids: Iterable<string>, cid: string) => (anahtar: string) => string;
  /** Mikro sayfa çağrısı zaman aşımı (ms; `listeZamanAsimiMs()`). */
  zamanAsimiMs: number;
  /**
   * Bütün Mikro okumalarının TOPLAM süre sınırı (ms; yoksa `KURU_TOPLAM_SURE_MS`). Uç yanıtı aynı HTTP isteğinde bekler; IIS ARR
   * ~120 sn'de keser. Her okuma kalan süreyle sınırlanır, süre dolunca kalan okumalar Mikro'ya gitmez ve «ölçülemedi» olur.
   */
  toplamSureMs?: number;
}

/**
 * Varsayılan toplam süre (inceleme MBS #4, 2026-11-05): 80 sn + `mikroKolonlar`'ın global 30 sn sınırı (çağrıya süre verilemiyor)
 * = 110 sn < ARR ~120 sn. Böylece «ölçülemedi» içeren kısmi rapor istemciye ARR kesmeden döner.
 */
export const KURU_TOPLAM_SURE_MS = 80_000;
/** Süre sınırı dolduğu için yapılmayan (ya da sınır içinde yanıtlanmayan) okumanın nedeni. */
export const KURU_SURE_DOLDU = 'kuru koşu süre sınırı doldu';

export interface KuruGirdisi {
  companyId: string;
  /** DH13: ayna (`mikro_stoklar`, kiracısız) GUID kanıtı yalnız çalışma kiracısı Mikro işlerinin kiracısıyken kullanılır. */
  aynaKullan: boolean;
  ciftler: readonly TabloCifti[];
  yokSayilan: { ayniKod: number; tekrar: number };
}

/** Mikro sayfa boyu / tavanı. Tavana çarpan okuma «kesildi» sayılır ve o ölçü KULLANILMAZ (yarım küme sahte kesinlik üretir). */
const SAYFA = 1000;
const SAYFA_TAVANI = 60;
/** Mikro `IN (…)` öbek boyu: GUID 38 karakter → ~12 KB sorgu. */
const GUID_OBEGI = 300;
const EVRAK_OBEGI = 50;
/** Yanıttaki yetim listesinin tavanı (sayı her zaman tamdır). */
const YETIM_LISTE_SINIRI = 500;

const KIRACI_BELGELERI_SQL = "SELECT id, data FROM docs WHERE coll = $1 AND COALESCE(data->>'companyId', '') IN ($2, '')";

interface Belge { id: string; veri: Record<string, unknown> }

/** Kiracı belgeleri: süzgeç SQL'de, aynı kural JS'te bir kez daha (CLAUDE.md deseni: yabancı kiracı atlanır, etiketsiz dâhil — DH19). */
async function kiraciBelgeleri(h: KuruPgHavuzu, coll: string, cid: string): Promise<Belge[]> {
  const { rows } = await h.query(KIRACI_BELGELERI_SQL, [coll, cid]);
  const out: Belge[] = [];
  for (const r of rows) {
    const veri = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};
    const dc = typeof veri.companyId === 'string' ? veri.companyId : '';
    if (dc && dc !== cid) continue;
    out.push({ id: String(r.id), veri });
  }
  return out;
}

/** Şema kolonunun GERÇEK adı (büyük / küçük harfe duyarsız tam eşleşme) ya da `null`. */
const kolon = (kolonlar: readonly string[], ad: string): string | null => kolonlar.find(k => k.toLowerCase() === ad.toLowerCase()) ?? null;

/** Mikro okuyucularının FIRLATMAYAN sürümü: ağ / zaman aşımı / kimlik hatası `hata` olur (ölçü «ölçülemedi»ye düşer, uç 500'e değil).
 *  TOPLAM SÜRE: her SQL okuması kalan süreyle sınırlanır (`zamanAsimiMs` = min(çağrı sınırı, kalan)); süre dolunca okuma Mikro'ya
 *  GİTMEZ, `hata` / boş şema döner. Süre dolduktan sonra düşen okumanın nedeni `KURU_SURE_DOLDU` (`sureDoldu` şema yolunu ayırır). */
interface GuvenliMikro { sql: MikroSqlOkuyucu; kolonlar: (tablo: string) => Promise<string[]>; zamanAsimiMs: number; sureDoldu: () => boolean }
function guvenliMikro(d: KuruBagimliliklari): GuvenliMikro {
  const bitis = Date.now() + (d.toplamSureMs ?? KURU_TOPLAM_SURE_MS);
  const kalan = (): number => bitis - Date.now();
  return {
    zamanAsimiMs: d.zamanAsimiMs,
    sureDoldu: () => kalan() <= 0,
    sql: async (q, o) => {
      const kalanMs = kalan();
      if (kalanMs <= 0) return { rows: [], hata: KURU_SURE_DOLDU };
      const cagriSiniri = o?.zamanAsimiMs ?? d.zamanAsimiMs;
      // Sınır toplam süreden geldiyse (kalan < çağrı sınırı) bu çağrının zaman aşımı «süre sınırı doldu» demektir.
      const sureyeBagli = kalanMs < cagriSiniri;
      try { return await d.mikroSql(q, { ...o, zamanAsimiMs: Math.max(1, Math.min(cagriSiniri, kalanMs)) }); } catch (e) {
        const sureDoldu = kalan() <= 0 || (sureyeBagli && zamanAsimiMi(e));
        return { rows: [], hata: sureDoldu ? KURU_SURE_DOLDU : e instanceof Error ? e.message : String(e) };
      }
    },
    kolonlar: async t => {
      if (kalan() <= 0) return [];
      try { return await d.mikroKolonlar(t); } catch { return []; }
    },
  };
}

/** `SELECT … ORDER BY <tekil> OFFSET … FETCH NEXT …` ile sayfalı okuma. */
async function sayfali(d: GuvenliMikro, govde: string, siralama: string): Promise<{ rows: Record<string, unknown>[]; hata: string | null; kesildi: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let sayfa = 0; sayfa < SAYFA_TAVANI; sayfa++) {
    const r = await d.sql(`${govde} ORDER BY ${siralama} OFFSET ${sayfa * SAYFA} ROWS FETCH NEXT ${SAYFA} ROWS ONLY`, { zamanAsimiMs: d.zamanAsimiMs });
    if (r.hata) return { rows, hata: r.hata, kesildi: false };
    rows.push(...r.rows);
    if (r.rows.length < SAYFA) return { rows, hata: null, kesildi: false };
  }
  return { rows, hata: null, kesildi: true };
}

const kisa = (hata: string): string => hata.replace(/\s+/g, ' ').slice(0, 200);

/** Mikro tablosunda kod başına satır sayımı (DH2). Ölçülemezse `null` + neden. Kod anahtarı JS'te (`kodAnahtari`) toplanır. */
interface TabloSayimi { sayim: Map<string, number> | null; kolon: string | null; neden: string | null; satir: number | null }
async function mikroKodSayimi(d: GuvenliMikro, tablo: string, desenler: RegExp[], iptalAdi: string | null = null): Promise<TabloSayimi> {
  const kolonlar = await d.kolonlar(tablo);
  if (!kolonlar.length) return { sayim: null, kolon: null, neden: d.sureDoldu() ? KURU_SURE_DOLDU : `${tablo} şeması okunamadı`, satir: null };
  const k = kolonSec(kolonlar, desenler);
  if (!k) return { sayim: null, kolon: null, neden: `${tablo} şemasında stok kodu kolonu bulunamadı`, satir: null };
  const iptal = iptalAdi ? kolon(kolonlar, iptalAdi) : null;
  const r = await sayfali(d, `SELECT ${k} AS kod, COUNT(*) AS adet FROM ${tablo}${iptal ? ` WHERE ISNULL(${iptal}, 0) = 0` : ''} GROUP BY ${k}`, k);
  if (r.hata) return { sayim: null, kolon: k, neden: kisa(r.hata), satir: null };
  if (r.kesildi) return { sayim: null, kolon: k, neden: 'sayfa tavanına çarptı', satir: null };
  const sayim = new Map<string, number>();
  let satir = 0;
  for (const row of r.rows) {
    const kod = kodAnahtari(typeof row.kod === 'string' ? row.kod : '');
    const n = Number(row.adet);
    if (!kod || !Number.isSafeInteger(n)) continue;
    satir += n;
    const onceki = sayim.get(kod);                          // iki ham kod (ör. sonda boşluk) aynı anahtara düşebilir
    sayim.set(kod, onceki === undefined ? n : onceki + n);
  }
  return { sayim, kolon: k, neden: null, satir };
}

const mikroMetni = (v: string): string => `N'${v.replace(/'/g, "''")}'`;
const DENETIM = /[\u0000-\u001F\u007F-\u009F]/;

export interface YetimSatiri { id: string; eski: string; evrakEsiMikroda: boolean | null; mikroKodu: string | null }

export interface KuruRaporu {
  success: true;
  uretim: string;
  kiraci: { aynaKanitiKullanildi: boolean };
  girdi: { tabloSatiri: number; tekilEski: number; kaynaklar: Record<string, number>; yokSayilan: { ayniKod: number; tekrar: number } };
  mikro: {
    stokKarti: number;
    stoGuidKolonu: boolean;
    kolonlar: Record<string, string | null>;
    eskiKoddaSayim: Record<'hareket' | 'fiyat' | 'barkod', { olculdu: boolean; neden: string | null; toplamSatir: number | null; eskiKodlu: number | null }>;
  };
  evren: { kart: number; kod: number; etiketsizKart: number; mikroDisiKaynak: number; skusuz: number; toplamKart: number };
  siniflar: Record<GocSinifi | 'degismemis', number>;
  satirlar: Record<GocSinifi, Array<GocSatiri & { bagli: Record<string, number> }>> & { degismemis: SiniflamaSonucu['degismemis'] };
  tablo: SiniflamaSonucu['tablo'];
  kanitOlcumu: {
    ayna: { okundu: boolean; neden: string | null; satir: number | null; guidliSatir: number | null; ayniGuidGrubu: number | null; ayniGuidCifti: number | null; guidAnahtarlari: Record<string, number>; kanit: number };
    hareket: { okundu: boolean; neden: string | null; cetpaHareket: number; guidli: number | null; mikrodaBulunan: number | null; koduDegisen: number | null; yetim: number | null; kanit: number };
  };
  /** `eskiKodlu: null` = hareketler Mikro'yla birleştirilemedi (yetim ölçülmedi). */
  mikroYetim: { eskiKodlu: number | null; liste: YetimSatiri[]; kesildi: boolean; evrakDenetimi: string | null };
  bagliKayit: Record<string, Omit<KoleksiyonSayimi, 'koduBasina'>>;
  /** Kartı Cetpa'da olmayan (Mikro'da da olmayan) tablo eski kodlarından bağlı kaydı kalanlar; kod sıralı, yalnız dolu olanlar. */
  kartsizBagli: Array<{ kod: string; bagli: Record<string, number> }>;
  /**
   * Kartsız kod varken ÖLÇÜLEMEYEN kart kimliği yolları (`koleksiyon.yol`): silinen kartın kimliği bilinmediği için bu yollardaki
   * bağ sayılamaz; `alanBasina` sayısı orada «0» değil «ölçülmedi»dir (MKD2 delta). D4 geri alma kaydı silinen kimlikleri tutunca
   * bu liste yalnız kaydı olmayan kodlar için dolar.
   */
  kartsizKimlikOlculmedi: string[];
  okunanAlanlar: Record<string, string[]>;
  okunmadi: string[];
  degismezler: {
    ayniSkuOnce: Array<{ sku: string; kart: number }>;
    ayniSkuPlanSonrasi: Array<{ sku: string; kart: number }>;
    uzunHedef: Array<{ eski: string; yeni: string; uzunluk: number }>;
    harfFarki: HarfFarkiUyarisi[];
    evrenToplami: { tamam: boolean; siniflarToplami: number; evren: number };
  };
  planOzeti: PlanOzeti;
  planImza: string;
}

export type KuruSonucu = { tamam: true; rapor: KuruRaporu } | { tamam: false; durum: number; error: string };

export async function stokKodGocuKuruKos(d: KuruBagimliliklari, g: KuruGirdisi): Promise<KuruSonucu> {
  const cid = g.companyId;
  if (!cid) return { tamam: false, durum: 400, error: 'Kiracı çözülemedi.' };
  const m = guvenliMikro(d);

  // ── 1. Mikro STOKLAR (güncel kod kümesi). Okunamazsa evren kurulamaz → HİÇBİR satır sınıflanmaz.
  const stokKolonlari = await m.kolonlar('STOKLAR');
  const stoKod = kolon(stokKolonlari, 'sto_kod');
  if (!stokKolonlari.length || !stoKod) {
    return { tamam: false, durum: 502, error: stokKolonlari.length ? 'Mikro STOKLAR şemasında sto_kod yok.' : 'Mikro STOKLAR şeması okunamadı.' };
  }
  const stoGuid = kolon(stokKolonlari, 'sto_Guid');
  const stok = await sayfali(m, `SELECT ${stoKod} AS kod${stoGuid ? `, ${stoGuid} AS guid` : ''} FROM STOKLAR`, stoGuid ?? stoKod);
  if (stok.hata) return { tamam: false, durum: 502, error: `Mikro STOKLAR okunamadı: ${kisa(stok.hata)}` };
  if (stok.kesildi) return { tamam: false, durum: 502, error: 'Mikro STOKLAR sayfa tavanına çarptı; kod kümesi eksik olurdu.' };
  const mikroKodlari: string[] = [];
  const mikroGuidKod = new Map<string, string>();
  for (const r of stok.rows) {
    const kod = kodAnahtari(typeof r.kod === 'string' ? r.kod : '');
    if (!kod) continue;
    mikroKodlari.push(kod);
    const gk = bicimliGuidAnahtari(r.guid);
    if (gk) mikroGuidKod.set(gk, kod);
  }
  // Boş küme = Mikro boş döndü (bağlantı / izin) — her kart «Mikro'da yok» sayılır, 2.700 sahte karşılıksız doğardı.
  if (!mikroKodlari.length) return { tamam: false, durum: 502, error: 'Mikro STOKLAR boş döndü; kuru koşu yapılmadı.' };

  // ── 2. Kiracı kartları + DH6 evreni.
  const envanter = await kiraciBelgeleri(d.havuz, 'inventory', cid);
  const kartlar: GocKarti[] = envanter.map(b => ({ id: b.id, sku: b.veri.sku, source: b.veri.source, companyId: b.veri.companyId, prices: b.veri.prices }));
  const evren = gocEvreni(kartlar, mikroKodlari);
  const eskiKartlar = new Map<string, string[]>([...evren.eskiKodlar].map(([k, ks]) => [k, ks.map(x => x.id)]));
  // Kartı Cetpa'dan silinmiş (ya da hiç açılmamış) eski kod: tabloda var, Mikro'da ve evrende yok. Bağlı kaydı yine sayılır —
  // yoksa 7. adımın «eski koda bağlı kayıt 0» değişmezi D4 eski kartı sildiği anda kendiliğinden yeşil çıkar. Kimlik listesi boş:
  // `kartKimligi` yolları etkilenmez; yalnız `sku` dizgisi ve koddan türeyen belge kimliği (DH18) eşleşir.
  const kartsizKodlar: string[] = [];
  for (const c of g.ciftler) {
    const k = kodAnahtari(c.eski);
    // Kartı Cetpa'da DURAN ama kaynağı Mikro dışı olan kod (elle açılmış kart; DH6 `mikroDisiKaynak`) kartsız DEĞİLDİR (MKD2 delta).
    if (k && !evren.mikroKumesi.has(k) && !eskiKartlar.has(k) && !evren.kodaGoreKartlar.has(k)) { eskiKartlar.set(k, []); kartsizKodlar.push(k); }
  }
  kartsizKodlar.sort();

  // ── 3. DH2: Mikro'da eski kodla duran satırlar (hareket, fiyat listesi, barkod). Tablo ve kolon adları şemadan.
  const hareketSayimi = await mikroKodSayimi(m, 'STOK_HAREKETLERI', [/^sth_stok_kod$/i], 'sth_iptal');
  const fiyatSayimi = await mikroKodSayimi(m, 'STOK_SATIS_FIYAT_LISTELERI', [/^sfiyat_stokkod$/i]);
  const barkodSayimi = await mikroKodSayimi(m, 'BARKOD_TANIMLARI', [/^bar_stokkodu$/i, /^bar_stok_?kodu?$/i, /stok_?kodu?$/i]);
  const mikroEskiKodda: MikroEskiKodSayimlari = { hareket: hareketSayimi.sayim, fiyat: fiyatSayimi.sayim, barkod: barkodSayimi.sayim };
  const eskiKodluSay = (s: Map<string, number> | null): number | null => (s ? [...evren.eskiKodlar.keys()].filter(k => s.has(k)).length : null);

  // ── 4. B2a / DH13: ayna GUID kanıtı. Ölçü her zaman; kanıt yalnız Mikro işlerinin kiracısında.
  const kanitlar: KodKaniti[] = [];
  const ayna: KuruRaporu['kanitOlcumu']['ayna'] = { okundu: false, neden: null, satir: null, guidliSatir: null, ayniGuidGrubu: null, ayniGuidCifti: null, guidAnahtarlari: {}, kanit: 0 };
  try {
    const sayi = await d.havuz.query('SELECT count(*)::int AS n FROM mikro_stoklar');
    const anahtarlar = await d.havuz.query(
      "SELECT k AS anahtar, count(*)::int AS n FROM mikro_stoklar, jsonb_object_keys(CASE WHEN jsonb_typeof(veri) = 'object' THEN veri ELSE '{}'::jsonb END) AS k "
      + "WHERE k ILIKE '%guid%' GROUP BY k ORDER BY k");
    const guidli = await d.havuz.query("SELECT sto_kod AS kod, veri->>'sto_Guid' AS guid FROM mikro_stoklar WHERE jsonb_typeof(veri) = 'object' AND veri ? 'sto_Guid'");
    const a = aynaKanitlari(guidli.rows.map(r => ({ kod: r.kod, guid: r.guid })), stoGuid ? mikroGuidKod : null, evren.mikroKumesi);
    Object.assign(ayna, {
      okundu: true, satir: Number(sayi.rows[0]?.n), ...a.olcu,
      guidAnahtarlari: Object.fromEntries(anahtarlar.rows.filter(r => typeof r.anahtar === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(r.anahtar)).map(r => [String(r.anahtar), Number(r.n)])),
    });
    if (g.aynaKullan) { kanitlar.push(...a.kanitlar); ayna.kanit = a.kanitlar.length; }
    else ayna.neden = 'çalışma kiracısı Mikro işlerinin kiracısı değil — ayna kanıtı yok sayıldı (DH13)';
  } catch (e) {
    ayna.neden = `ayna okunamadı: ${kisa(e instanceof Error ? e.message : String(e))}`;
  }

  // ── 5. B2b: hareket GUID kanıtı + yetim (DH2). Cetpa belge kimliği = sth_Guid.
  const hareketler = await kiraciBelgeleri(d.havuz, 'inventoryMovements', cid);
  const sthKolonlari = await m.kolonlar('STOK_HAREKETLERI');
  const sth = {
    guid: kolon(sthKolonlari, 'sth_Guid'), kod: kolon(sthKolonlari, 'sth_stok_kod'), seri: kolon(sthKolonlari, 'sth_evrakno_seri'),
    sira: kolon(sthKolonlari, 'sth_evrakno_sira'), satir: kolon(sthKolonlari, 'sth_satir_no'), tip: kolon(sthKolonlari, 'sth_evraktip'),
  };
  const hareket: KuruRaporu['kanitOlcumu']['hareket'] = { okundu: false, neden: null, cetpaHareket: hareketler.length, guidli: null, mikrodaBulunan: null, koduDegisen: null, yetim: null, kanit: 0 };
  const mikroYetim: KuruRaporu['mikroYetim'] = { eskiKodlu: null, liste: [], kesildi: false, evrakDenetimi: null };
  if (!sth.guid || !sth.kod) {
    hareket.neden = sthKolonlari.length ? 'STOK_HAREKETLERI şemasında sth_Guid / sth_stok_kod yok'
      : m.sureDoldu() ? KURU_SURE_DOLDU : 'STOK_HAREKETLERI şeması okunamadı';
  } else {
    const guidler = [...new Set(hareketler.map(h => bicimliGuidAnahtari(h.id)).filter(Boolean))];
    const mikroHareket = new Map<string, string>();
    let hata: string | null = null;
    for (let i = 0; i < guidler.length && !hata; i += GUID_OBEGI) {
      const obek = guidler.slice(i, i + GUID_OBEGI);
      const r = await m.sql(`SELECT ${sth.guid} AS guid, ${sth.kod} AS kod FROM STOK_HAREKETLERI WHERE ${sth.guid} IN (${obek.map(x => `'${x}'`).join(', ')})`, { zamanAsimiMs: d.zamanAsimiMs });
      if (r.hata) { hata = r.hata; break; }
      for (const row of r.rows) { const gk = bicimliGuidAnahtari(row.guid); if (gk) mikroHareket.set(gk, kodAnahtari(typeof row.kod === 'string' ? row.kod : '')); }
    }
    if (hata) hareket.neden = `Mikro hareketleri okunamadı: ${kisa(hata)}`;
    else {
      const hk = hareketKanitlari(hareketler.map(h => ({ id: h.id, kod: h.veri.sth_stok_kod })), mikroHareket, evren.mikroKumesi);
      Object.assign(hareket, { okundu: true, ...hk.olcu, kanit: hk.kanitlar.length });
      kanitlar.push(...hk.kanitlar);
      // Yetim (GUID Mikro'da yok) + eski kodlu: aynı evrak seri / sıra / satır / tip Mikro'da yeni GUID'le var mı (DH2).
      const veriById = new Map(hareketler.map(h => [h.id, h.veri]));
      const eskiYetim = hk.yetimler.filter(y => evren.eskiKodlar.has(y.eski));
      mikroYetim.eskiKodlu = eskiYetim.length;
      mikroYetim.kesildi = eskiYetim.length > YETIM_LISTE_SINIRI;
      const liste: YetimSatiri[] = eskiYetim.slice(0, YETIM_LISTE_SINIRI).map(y => ({ id: y.id, eski: y.eski, evrakEsiMikroda: null, mikroKodu: null }));
      const { seri, sira, satir, tip } = sth;
      if (!seri || !sira || !satir || !tip) mikroYetim.evrakDenetimi = 'STOK_HAREKETLERI şemasında evrak seri / sıra / satır / tip kolonu yok';
      else {
        const anahtar = (s: unknown, n1: unknown, n2: unknown, n3: unknown): string | null => {
          if (typeof s !== 'string' || s.length > 20 || DENETIM.test(s)) return null;
          const sayilar = [n1, n2, n3].map(Number);
          return sayilar.every(Number.isSafeInteger) ? JSON.stringify([s.trim(), ...sayilar]) : null;
        };
        const sorulacak: Array<{ y: YetimSatiri; a: string; v: Record<string, unknown> }> = [];
        for (const y of liste) {
          const v = veriById.get(y.id);
          if (!v) continue;
          const a = anahtar(v[seri], v[sira], v[satir], v[tip]);
          if (a) sorulacak.push({ y, a, v });
        }
        const bulunan = new Map<string, string>();
        for (let i = 0; i < sorulacak.length && !mikroYetim.evrakDenetimi; i += EVRAK_OBEGI) {
          const obek = sorulacak.slice(i, i + EVRAK_OBEGI);
          const kosul = obek.map(({ v }) => `(${seri} = ${mikroMetni(String(v[seri]).trim())} AND ${sira} = ${Number(v[sira])} AND ${satir} = ${Number(v[satir])} AND ${tip} = ${Number(v[tip])})`).join(' OR ');
          const r = await m.sql(`SELECT ${seri} AS seri, ${sira} AS sira, ${satir} AS satir, ${tip} AS tip, ${sth.kod} AS kod FROM STOK_HAREKETLERI WHERE ${kosul}`, { zamanAsimiMs: d.zamanAsimiMs });
          if (r.hata) { mikroYetim.evrakDenetimi = `evrak eşi okunamadı: ${kisa(r.hata)}`; break; }
          for (const row of r.rows) {
            const a = anahtar(typeof row.seri === 'string' ? row.seri : '', row.sira, row.satir, row.tip);
            if (a) bulunan.set(a, kodAnahtari(typeof row.kod === 'string' ? row.kod : ''));
          }
        }
        if (!mikroYetim.evrakDenetimi) {
          for (const { y, a } of sorulacak) { const k = bulunan.get(a); y.evrakEsiMikroda = k !== undefined; y.mikroKodu = k !== undefined ? k : null; }
        }
      }
      mikroYetim.liste = liste;
    }
  }

  // ── 6. DH1 tablosuyla bağlı kayıt sayımı. Tablodaki alanı olmayan koleksiyon (shipments, vehicles) okunmaz.
  const barkodAlani: AlanYolu[] = barkodSayimi.kolon ? [{ yol: barkodSayimi.kolon, tur: 'sku' }] : [];
  const depoKimlikleri = new Map<string, string>();
  const sayimlar: KoleksiyonSayimi[] = [];
  const okunmadi: string[] = [];
  for (const t of BAGLI_KAYIT_TABLOSU) {
    const ek = t.koleksiyon === 'barkodlar' ? barkodAlani : [];
    if (!t.alanlar.length && !ek.length) { okunmadi.push(t.koleksiyon); continue; }
    const belgeler = t.koleksiyon === 'inventoryMovements' ? hareketler : await kiraciBelgeleri(d.havuz, t.koleksiyon, cid);
    if (t.kimlikKoddan) {
      // Kimlik import ile AYNI çözücüden: eski biçim `mikro-<kod>` belgede varsa o, yoksa `mikro-<kiracı8>-<kod>` (DH18).
      const coz = d.mikroIdCozucuIds(belgeler.map(b => b.id), cid);
      for (const [kod, ks] of evren.eskiKodlar) {
        const hamlar = new Set([kod, ...ks.map(k => (typeof k.sku === 'string' ? k.sku.trim() : ''))].filter(Boolean));
        for (const ham of hamlar) depoKimlikleri.set(coz(depoKimlikParcasi(ham)), kod);
      }
      for (const kod of kartsizKodlar) { const id = coz(depoKimlikParcasi(kod)); if (!depoKimlikleri.has(id)) depoKimlikleri.set(id, kod); }
    }
    sayimlar.push(bagliKayitlariSay(t, belgeler, eskiKartlar, t.kimlikKoddan ? depoKimlikleri : undefined, ek));
  }
  const magazaSayimi = sayimlar.find(c => c.koleksiyon === 'magazaTalepleri');
  const magazaEskiKodlar = new Set<string>(magazaSayimi ? magazaSayimi.koduBasina.keys() : []);

  // ── 7. Sınıflama (D0) + değişmezler + plan + imza.
  const s = siniflandir({ evren, tablo: g.ciftler, kanitlar, mikroEskiKodda, magazaEskiKodlar });
  const toplam = s.sayilar.kesin + s.sayilar.dogrula + s.sayilar.cok_anlamli + s.sayilar.karsiliksiz;
  if (!s.degismezTamam) {
    console.error(`[stok-kod-gocu/kuru] DH6 değişmezi bozuldu: sınıflar ${toplam}, evren ${evren.olcu.kod}`);
    return { tamam: false, durum: 500, error: `Değişmez bozuldu: sınıf toplamı (${toplam}) evren büyüklüğüne (${evren.olcu.kod}) eşit değil.` };
  }
  const plan = planOzeti(s, evren, sayimlar);
  const arsiv = new Set(plan.satirlar.flatMap(p => p.arsiveGiden));
  const bagliKod = (kod: string): Record<string, number> => {
    const b: Record<string, number> = {};
    for (const c of sayimlar) { const ids = c.koduBasina.get(kod); if (ids && ids.size) b[c.koleksiyon] = ids.size; }
    return b;
  };
  const sinifSatirlari = Object.fromEntries(GOC_SINIFLARI.map(k => [k, s.satirlar.filter(r => r.sinif === k).map(r => ({ ...r, bagli: bagliKod(r.eski) }))])) as Record<GocSinifi, Array<GocSatiri & { bagli: Record<string, number> }>>;
  const kartsizBagli = kartsizKodlar.map(kod => ({ kod, bagli: bagliKod(kod) })).filter(x => Object.keys(x.bagli).length > 0);
  const kaynaklar: Record<string, number> = {};
  for (const c of g.ciftler) kaynaklar[c.kaynak] = (c.kaynak in kaynaklar ? kaynaklar[c.kaynak] : 0) + 1;
  const olcu = (t: TabloSayimi): KuruRaporu['mikro']['eskiKoddaSayim']['hareket'] => ({ olculdu: t.sayim !== null, neden: t.neden, toplamSatir: t.satir, eskiKodlu: eskiKodluSay(t.sayim) });
  const disari = (c: KoleksiyonSayimi): Omit<KoleksiyonSayimi, 'koduBasina'> => {
    const { koduBasina: _ic, ...geri } = c;
    void _ic;
    return geri;
  };

  return {
    tamam: true,
    rapor: {
      success: true,
      uretim: new Date().toISOString(),
      kiraci: { aynaKanitiKullanildi: g.aynaKullan && ayna.okundu },
      girdi: { tabloSatiri: g.ciftler.length, tekilEski: s.tablo.tekilEski, kaynaklar, yokSayilan: g.yokSayilan },
      mikro: {
        stokKarti: mikroKodlari.length, stoGuidKolonu: stoGuid !== null,
        kolonlar: {
          'STOK_HAREKETLERI.kod': hareketSayimi.kolon, 'STOK_SATIS_FIYAT_LISTELERI.kod': fiyatSayimi.kolon, 'BARKOD_TANIMLARI.kod': barkodSayimi.kolon,
          'STOK_HAREKETLERI.guid': sth.guid, 'STOKLAR.guid': stoGuid,
        },
        eskiKoddaSayim: { hareket: olcu(hareketSayimi), fiyat: olcu(fiyatSayimi), barkod: olcu(barkodSayimi) },
      },
      evren: evren.olcu,
      siniflar: s.sayilar,
      satirlar: { ...sinifSatirlari, degismemis: s.degismemis },
      tablo: s.tablo,
      kanitOlcumu: { ayna, hareket },
      mikroYetim,
      bagliKayit: Object.fromEntries(sayimlar.map(c => [c.koleksiyon, disari(c)])),
      kartsizBagli,
      kartsizKimlikOlculmedi: kartsizKodlar.length
        ? BAGLI_KAYIT_TABLOSU.flatMap(t => t.alanlar.filter(a => a.tur === 'kartKimligi').map(a => `${t.koleksiyon}.${a.yol}`)).sort()
        : [],
      okunanAlanlar: Object.fromEntries(sayimlar.map(c => [c.koleksiyon, c.alanlar])),
      okunmadi,
      degismezler: {
        ayniSkuOnce: ayniSkuGruplari(kartlar),
        ayniSkuPlanSonrasi: ayniSkuGruplari(kartlar, arsiv),
        uzunHedef: s.satirlar.flatMap(r => (r.yeni && r.yeni.length > MIKRO_KOD_UZUNLUK_SINIRI ? [{ eski: r.eski, yeni: r.yeni, uzunluk: r.yeni.length }] : [])),
        harfFarki: s.harfFarki,
        evrenToplami: { tamam: true, siniflarToplami: toplam, evren: evren.olcu.kod },
      },
      planOzeti: plan,
      planImza: planImzasi(cid, s, evren, sayimlar),
    },
  };
}
