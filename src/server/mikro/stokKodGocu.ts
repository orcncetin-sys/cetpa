/**
 * stokKodGocu.ts — revize stok kodlarının Cetpa'ya taşınması: SAF çekirdek (şartname `.wf/SARTNAME-mikro-baglanti-d-kod.md`,
 * D0 + kapı hükümleri DH1 / DH3 / DH4 / DH6 / DH14 (yalnız sayım) / DH15 / DH16 / DH19 / DH20; 05.11.2026).
 *
 * GİRDİ / ÇIKTI YOK: veritabanı ve Mikro okuması kuru koşu motorundadır (`stokKodGocuKuru.ts`); bu dosya yalnız karar verir,
 * sayar ve imzalar. Bu dilimde YAZAN hiçbir şey yok (uygulama, geri alma, pasif liste D2–D5'tir).
 *
 * NEDEN: Cetpa kartı Mikro `sto_Guid`'ini saklamıyor; eşleme anahtarı KOD dizgisidir (B1). Mikro'da kod değişince saatlik senkron
 * ve elle import yeni kodu «yeni ürün» sayıp ikinci kart açtı (ölçü: 192 ikiz), eski kart sahipsiz kaldı. Hangi eski kartın hangi
 * yeni karta katlanacağı TABLO + GUID / hareket kanıtı + Mikro'nun GÜNCEL kod kümesiyle sınıflanır; tek başına tablo YETMEZ (DH3),
 * Cetpa'da kartın bulunması kanıt SAYILMAZ.
 */
// Karma ve kanonik JSON TEK yerden (K22 çiti: `src/server/mikro/**` içinde `createHash` yalnız gonderimOzeti.ts'te).
import { kanonikJson, sha256 } from './gonderimOzeti.js';
import { mikroStokKartiMi } from './eslemeStok.js';
import { magazaTabanSku } from '../../lib/magazaTalep.js';
import { guidAnahtari, guidBicimli } from '../../lib/ettn.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH15 · TEK KOD ANAHTARI
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Yön işaretleri (U+200E/F, U+202A–E): görünmez, `trim()` silmez; mağaza dökümünde görüldü (ikas-mikro-eslestirme). */
const YON_ISARETLERI = /[\u200E\u200F\u202A-\u202E]/g;

/**
 * Kod karşılaştırma anahtarı — D0 sınıflama, D1 sayımı, D3 referans araması, DH6 evreni ve 7. adımdaki kalan sayımı İÇİN TEK işlev
 * (DH15). Sıra: yön işaretleri silinir → U+00A0 (bölünmez boşluk) düz boşluğa çevrilir → Unicode NFC → `trim`.
 * HARF DÖNÜŞÜMÜ YOK: Mikro SQL karşılaştırması büyük / küçük harfe duyarsız, Cetpa haritası duyarlı (B6); dil ayarsız
 * `toUpperCase()` `ı` → `I` katlayıp iki ayrı kodu tek anahtara düşürürdü (DH20). Harf farkı yalnız UYARIdır (`harfIskeleti`).
 * Sıra gerekçesi: işaret NFC'den ÖNCE silinir — `I` + U+200E + U+0307 dizisi silindikten sonra `İ`'ye birleşmeli.
 * U+00A0 SİLİNMEZ, boşluğa çevrilir: `KLİPS SABİTLEME PARÇASI` gibi boşluklu kodda silmek iki sözcüğü birleştirirdi.
 */
export function kodAnahtari(deger: unknown): string {
  if (typeof deger !== 'string') return '';
  return deger.replace(YON_ISARETLERI, '').replace(/\u00A0/g, ' ').normalize('NFC').trim();
}

/**
 * Harf farkı UYARISININ iskeleti (D0 «yalnız uyarı, `tr-TR` katlama ile»; DH20). `tr-TR` büyütmesi `ı` → `I`, `i` → `İ` verir;
 * ardından `İ` → `I`: noktalı / noktasız dört harf (i, ı, I, İ) aynı iskelete düşer. Böylece `DEMIR-01` ~ `DEMİR-01` ve
 * `KAPı-02` ~ `KAPI-02` uyarı üretir. Bu değer EŞLEŞTİRME ANAHTARI DEĞİLDİR: iki kod yalnız iskeletle eşleşiyorsa birleşme YOK.
 */
export function harfIskeleti(deger: unknown): string {
  return kodAnahtari(deger).toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
}

/**
 * Mikro GUID'inin karşılaştırma biçimi — paylaşılan `lib/ettn.ts` `guidAnahtari` (süslü parantez atılır, küçük harf) + `guidBicimli`
 * (8-4-4-4-12 onaltılık). Biçimde değilse ya da metin değilse `''`: bu değer Mikro `IN ('…')` sorgusuna girer, biçim denetimi
 * SQL'e yalnız onaltılık + tire düşmesinin güvencesidir. Ayrı ad: `guidAnahtari` biçim denetimi YAPMAZ (sayıyı da metne çevirir).
 */
export function bicimliGuidAnahtari(deger: unknown): string {
  if (typeof deger !== 'string') return '';
  const s = guidAnahtari(deger);
  return guidBicimli(s) ? s : '';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH3 · TABLO KAYNAKLARI + kuru koşu gövdesi
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Tablo KANITI sayılan kaynaklar (DH3): 10.10 «1 ONAYLI» («Mikro'da işlendi»), 10.10 «5 Birleştirilen», 17.10 «Yeni stok kodları». */
export const GUCLU_TABLO_KAYNAKLARI = ['onayli1010', 'birlestirilen1010', 'yenikod1017'] as const;
/** Yalnız ADAY üreten kaynaklar (kanıt sayılmaz): 30.09 «Mikro aktarım», 30.09 «Mikro kod revize», 10.10 «2 ONAY BEKLEYEN». */
export const ADAY_TABLO_KAYNAKLARI = ['aktarim0930', 'revize0930', 'bekleyen1010'] as const;
export type TabloKaynagi = typeof GUCLU_TABLO_KAYNAKLARI[number] | typeof ADAY_TABLO_KAYNAKLARI[number];
const GUCLU_KUMESI: ReadonlySet<string> = new Set<string>(GUCLU_TABLO_KAYNAKLARI);
const KAYNAK_KUMESI: ReadonlySet<string> = new Set<string>([...GUCLU_TABLO_KAYNAKLARI, ...ADAY_TABLO_KAYNAKLARI]);
export function tabloKaynagiMi(x: unknown): x is TabloKaynagi {
  return typeof x === 'string' && KAYNAK_KUMESI.has(x);
}
export function gucluKaynakMi(x: TabloKaynagi): boolean {
  return GUCLU_KUMESI.has(x);
}

/** D1: gövde en çok 2.000 satır, kod uzunluğu ≤ 50 (anahtar biçiminde). Mikro `sto_kod` sınırı ayrıca 25'tir (değişmez denetimi). */
export const KURU_TABLO_SATIR_SINIRI = 2000;
export const KOD_UZUNLUK_SINIRI = 50;
export const MIKRO_KOD_UZUNLUK_SINIRI = 25;
const DENETIM_KARAKTERI = /[\u0000-\u001F\u007F-\u009F]/;

/** Kuru koşu girdisinin bir satırı — kodlar `kodAnahtari` biçimindedir. */
export interface TabloCifti { eski: string; yeni: string; kaynak: TabloKaynagi }

export type GovdeCozumu =
  | { tamam: true; ciftler: TabloCifti[]; yokSayilan: { ayniKod: number; tekrar: number } }
  | { tamam: false; error: string };

/**
 * Kuru koşu gövdesi (D1 + DH3) iki biçimde gelir: tablo dosyası OLDUĞU GİBİ `[{ eski, yeni, kaynak }]` (şartname D1 biçimi; DH16
 * «uygulama gövdesinin `ciftler`i kuru koşuya giden tablo dosyasıyla aynıdır») ya da `{ ciftler?: [...] }`. Gövde yok / `ciftler`
 * yok → tablosuz koşu (yalnız GUID kanıtı; DH3 gereği satırlar `kesin` olamaz). Bilinmeyen üst anahtar, nesne olmayan satır,
 * satırda fazladan alan, metin olmayan değer, boş kod, 50 karakteri aşan kod, denetim karakteri ve tanınmayan kaynak 400'dür
 * (satır numarasıyla). Aynı satırın tekrarı ve eskisi yenisine eşit satır yok sayılır, sayısı raporlanır.
 */
export function kuruGovdesiniCoz(govde: unknown): GovdeCozumu {
  if (govde === undefined || govde === null) return { tamam: true, ciftler: [], yokSayilan: { ayniKod: 0, tekrar: 0 } };
  if (Array.isArray(govde)) return kuruGovdesiniCoz({ ciftler: govde });
  if (typeof govde !== 'object') return { tamam: false, error: 'Gövde bir dizi ya da nesne olmalı: [{ eski, yeni, kaynak }] ya da { ciftler: [...] }.' };
  const fazla = Object.keys(govde).filter(k => k !== 'ciftler');
  if (fazla.length) return { tamam: false, error: `Tanınmayan alan: ${fazla.slice(0, 5).join(', ')}.` };
  const ham = (govde as { ciftler?: unknown }).ciftler;
  if (ham === undefined) return { tamam: true, ciftler: [], yokSayilan: { ayniKod: 0, tekrar: 0 } };
  if (!Array.isArray(ham)) return { tamam: false, error: '`ciftler` bir dizi olmalı.' };
  if (ham.length > KURU_TABLO_SATIR_SINIRI) return { tamam: false, error: `\`ciftler\` en çok ${KURU_TABLO_SATIR_SINIRI} satır olabilir (gelen ${ham.length}).` };
  const ciftler: TabloCifti[] = [];
  const gorulen = new Set<string>();
  let ayniKod = 0, tekrar = 0;
  for (const [i, satir] of ham.entries()) {
    const no = i + 1;
    if (!satir || typeof satir !== 'object' || Array.isArray(satir)) return { tamam: false, error: `${no}. satır bir nesne olmalı.` };
    const s = satir as Record<string, unknown>;
    const fazlaAlan = Object.keys(s).filter(k => k !== 'eski' && k !== 'yeni' && k !== 'kaynak');
    if (fazlaAlan.length) return { tamam: false, error: `${no}. satırda tanınmayan alan: ${fazlaAlan.slice(0, 5).join(', ')}.` };
    const kodlar: string[] = [];
    for (const ad of ['eski', 'yeni'] as const) {
      const v = s[ad];
      if (typeof v !== 'string') return { tamam: false, error: `${no}. satır: \`${ad}\` metin olmalı.` };
      if (DENETIM_KARAKTERI.test(v)) return { tamam: false, error: `${no}. satır: \`${ad}\` denetim karakteri taşıyor.` };
      const k = kodAnahtari(v);
      if (k === '') return { tamam: false, error: `${no}. satır: \`${ad}\` boş.` };
      if (k.length > KOD_UZUNLUK_SINIRI) return { tamam: false, error: `${no}. satır: \`${ad}\` ${KOD_UZUNLUK_SINIRI} karakteri aşıyor.` };
      kodlar.push(k);
    }
    const kaynak = s.kaynak;
    if (!tabloKaynagiMi(kaynak)) {
      return { tamam: false, error: `${no}. satır: \`kaynak\` tanınmıyor (geçerli: ${[...GUCLU_TABLO_KAYNAKLARI, ...ADAY_TABLO_KAYNAKLARI].join(', ')}).` };
    }
    const [eski, yeni] = kodlar;
    if (eski === yeni) { ayniKod++; continue; }
    const imza = JSON.stringify([eski, yeni, kaynak]);
    if (gorulen.has(imza)) { tekrar++; continue; }
    gorulen.add(imza);
    ciftler.push({ eski, yeni, kaynak });
  }
  return { tamam: true, ciftler, yokSayilan: { ayniKod, tekrar } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH6 · ESKİ KOD EVRENİ
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Kiracının stok kartı (kuru koşu motoru `inventory` belgesinden kurar). Ad TAŞINMAZ. `prices` yalnız kademe ADLARI için. */
export interface GocKarti { id: string; sku: unknown; source: unknown; companyId: unknown; prices?: unknown }

export interface GocEvreni {
  /** Mikro'nun güncel `STOKLAR` kod kümesi (anahtar biçiminde). */
  mikroKumesi: ReadonlySet<string>;
  /** Eski kod anahtarı → o koddaki kartlar (kaynağı Mikro olan ve kodu Mikro'da OLMAYAN). */
  eskiKodlar: ReadonlyMap<string, readonly GocKarti[]>;
  /** Kiracının TÜM kartları anahtara göre (kalan kart araması). */
  kodaGoreKartlar: ReadonlyMap<string, readonly GocKarti[]>;
  olcu: { kart: number; kod: number; etiketsizKart: number; mikroDisiKaynak: number; skusuz: number; toplamKart: number };
}

const etiketsizMi = (k: GocKarti): boolean => typeof k.companyId !== 'string' || k.companyId === '';

/**
 * DH6: D0'ın girdisi tablo çiftleri DEĞİL — kiracının `mikroStokKartiMi(source)` kartlarından kodu (`kodAnahtari`) Mikro'nun güncel
 * `STOKLAR` kümesinde OLMAYAN her kart. Elle açılmış kartlar (kaynak Mikro değil) evrene girmez, ayrı sayılır. Etiketsiz kart
 * (`companyId` boş) evrene girer ve ayrı sayılır (DH19).
 */
export function gocEvreni(kartlar: readonly GocKarti[], mikroKodlari: Iterable<string>): GocEvreni {
  const mikroKumesi = new Set<string>();
  for (const k of mikroKodlari) { const a = kodAnahtari(k); if (a) mikroKumesi.add(a); }
  const eskiKodlar = new Map<string, GocKarti[]>();
  const kodaGoreKartlar = new Map<string, GocKarti[]>();
  let etiketsizKart = 0, mikroDisiKaynak = 0, skusuz = 0, kart = 0;
  for (const k of kartlar) {
    const a = kodAnahtari(k.sku);
    if (a === '') { skusuz++; continue; }
    const grup = kodaGoreKartlar.get(a);
    if (grup) grup.push(k); else kodaGoreKartlar.set(a, [k]);
    if (mikroKumesi.has(a)) continue;
    if (!mikroStokKartiMi(k.source)) { mikroDisiKaynak++; continue; }
    kart++;
    if (etiketsizMi(k)) etiketsizKart++;
    const e = eskiKodlar.get(a);
    if (e) e.push(k); else eskiKodlar.set(a, [k]);
  }
  return {
    mikroKumesi, eskiKodlar, kodaGoreKartlar,
    olcu: { kart, kod: eskiKodlar.size, etiketsizKart, mikroDisiKaynak, skusuz, toplamKart: kartlar.length },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// B2 · GUID ve HAREKET KANITI
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type KanitTuru = 'tablo' | 'tablo_aday' | 'guid' | 'hareket' | 'zincir';
/** Tablodan bağımsız kanıt: eski kod → Mikro'daki güncel kod. */
export interface KodKaniti { eski: string; yeni: string; tur: 'guid' | 'hareket' }

/**
 * B2a: ayna `mikro_stoklar` satırı (`sto_kod` + `veri.sto_Guid`). Kanıt: kodu Mikro'da OLMAYAN ayna satırının GUID'i Mikro'nun güncel
 * `STOKLAR`'ında BAŞKA kodla duruyor. Mikro GUID haritası yoksa (`sto_Guid` kolonu okunamadı) aynanın kendi içindeki aynı GUID'li
 * gruptan: kodu Mikro'da olan üye yeni koddur. Yalnız ölçü + kanıt; DH13 kararını (aynayı kullan / kullanma) motor verir.
 */
export function aynaKanitlari(
  satirlar: ReadonlyArray<{ kod: unknown; guid: unknown }>,
  mikroGuidKod: ReadonlyMap<string, string> | null,
  mikroKumesi: ReadonlySet<string>,
): { kanitlar: KodKaniti[]; olcu: { guidliSatir: number; ayniGuidGrubu: number; ayniGuidCifti: number } } {
  const gruplar = new Map<string, Set<string>>();
  let guidliSatir = 0;
  for (const s of satirlar) {
    const g = bicimliGuidAnahtari(s.guid), k = kodAnahtari(s.kod);
    if (!g || !k) continue;
    guidliSatir++;
    const grup = gruplar.get(g);
    if (grup) grup.add(k); else gruplar.set(g, new Set([k]));
  }
  const kanitlar: KodKaniti[] = [];
  let ayniGuidGrubu = 0, ayniGuidCifti = 0;
  for (const [g, kodlar] of gruplar) {
    if (kodlar.size > 1) { ayniGuidGrubu++; ayniGuidCifti += kodlar.size * (kodlar.size - 1) / 2; }
    const guncel = mikroGuidKod ? mikroGuidKod.get(g) : undefined;
    const yeniler = guncel !== undefined ? [guncel] : [...kodlar].filter(k => mikroKumesi.has(k));
    for (const eski of kodlar) {
      if (mikroKumesi.has(eski)) continue;
      for (const yeni of yeniler) if (yeni && yeni !== eski && mikroKumesi.has(yeni)) kanitlar.push({ eski, yeni, tur: 'guid' });
    }
  }
  return { kanitlar, olcu: { guidliSatir, ayniGuidGrubu, ayniGuidCifti } };
}

export interface YetimHareket { id: string; eski: string }

/**
 * B2b: Cetpa `inventoryMovements` belge kimliği = `sth_Guid` (import). Mikro'da aynı GUID BAŞKA `sth_stok_kod` taşıyorsa kanıt
 * (eski → yeni). GUID Mikro'da yoksa satır YETİMDİR (DH2 tanımı); yetim yalnız raporlanır.
 */
export function hareketKanitlari(
  cetpa: ReadonlyArray<{ id: string; kod: unknown }>,
  mikro: ReadonlyMap<string, string>,
  mikroKumesi: ReadonlySet<string>,
): { kanitlar: KodKaniti[]; olcu: { guidli: number; mikrodaBulunan: number; koduDegisen: number; yetim: number }; yetimler: YetimHareket[] } {
  const kanitlar: KodKaniti[] = [];
  const yetimler: YetimHareket[] = [];
  let guidli = 0, mikrodaBulunan = 0, koduDegisen = 0;
  for (const h of cetpa) {
    const g = bicimliGuidAnahtari(h.id);
    if (!g) continue;
    guidli++;
    const eski = kodAnahtari(h.kod);
    const mk = mikro.get(g);
    if (mk === undefined) { yetimler.push({ id: h.id, eski }); continue; }
    mikrodaBulunan++;
    if (eski && mk && mk !== eski) {
      koduDegisen++;
      if (!mikroKumesi.has(eski) && mikroKumesi.has(mk)) kanitlar.push({ eski, yeni: mk, tur: 'hareket' });
    }
  }
  return { kanitlar, olcu: { guidli, mikrodaBulunan, koduDegisen, yetim: yetimler.length }, yetimler };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D0 · SINIFLAMA (DH3 / DH4 / DH6 / DH20)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type GocSinifi = 'kesin' | 'dogrula' | 'cok_anlamli' | 'karsiliksiz';
export const GOC_SINIFLARI: readonly GocSinifi[] = ['kesin', 'dogrula', 'cok_anlamli', 'karsiliksiz'];

/** DH2: eski kod Mikro'da hâlâ satır taşıyor mu (tablo başına sayım; `null` = ÖLÇÜLEMEDİ — o çift `kesin` olamaz). */
export interface MikroEskiKodSayimlari {
  hareket: ReadonlyMap<string, number> | null;
  fiyat: ReadonlyMap<string, number> | null;
  barkod: ReadonlyMap<string, number> | null;
}
const MIKRO_SAYIM_GEREKCESI = { hareket: 'mikro_hareket_eski_kodda', fiyat: 'mikro_fiyat_listesi_eski_kodda', barkod: 'mikro_barkod_eski_kodda' } as const;

export interface GocAdayi {
  yeni: string;
  kaynaklar: TabloKaynagi[];
  kanit: KanitTuru[];
  /** Mikro'nun güncel `STOKLAR`'ında var mı (DH3: adayların var / yok bitleri). */
  mikroda: boolean;
  /** Kiracıda bu kodda kaç kart var (bilgi; kanıt DEĞİL). */
  cetpaKart: number;
}

export interface GocSatiri {
  eski: string;
  sinif: GocSinifi;
  /** Tek hedef (Mikro'da var olan TEK aday). `cok_anlamli` / `karsiliksiz` / çelişkili `dogrula` satırında `null`. */
  yeni: string | null;
  /** Seçilen hedefin kanıt türleri (sıralı). */
  kanit: KanitTuru[];
  kaynaklar: TabloKaynagi[];
  adaylar: GocAdayi[];
  /** `dogrula` / `cok_anlamli` / `karsiliksiz` nedenleri (makine okur). `kesin` satırda boş. */
  gerekce: string[];
  /** Eski kodlu kartların kimlikleri (ad YOK). */
  kartlar: string[];
  etiketsizKart: number;
  /** DH4: bu satırın Mikro'da OLMAYAN tablo adaylarından Cetpa'da kartı bulunanlar (ara halka; kendi satırları vardır). */
  araKartlar: string[];
  /** Ara halka satırında: halkayı bağlayan eski kod(lar). */
  zincir: string[];
  mikroEskiKodda: { hareket: number | null; fiyat: number | null; barkod: number | null };
}

export interface HarfFarkiUyarisi { kod: string; benzer: string; nerede: 'mikro' | 'tablo_yeni' | 'tablo_eski' }

export interface SiniflamaGirdisi {
  evren: GocEvreni;
  tablo: readonly TabloCifti[];
  kanitlar: readonly KodKaniti[];
  mikroEskiKodda: MikroEskiKodSayimlari;
  /** DH14: `magazaTalepleri` kalemlerinde (sku ya da `-Dnnn` tabanı) geçen eski kod anahtarları. */
  magazaEskiKodlar: ReadonlySet<string>;
}

export interface SiniflamaSonucu {
  satirlar: GocSatiri[];
  /** Tablodaki eski kod Mikro'da HÂLÂ var → iş yok (D0 `degismemis`; evrene GİRMEZ). */
  degismemis: Array<{ eski: string; yeniler: string[] }>;
  sayilar: Record<GocSinifi | 'degismemis', number>;
  tablo: { satir: number; tekilEski: number; evrendeEslesen: number; degismemis: number; kartsizEski: number };
  harfFarki: HarfFarkiUyarisi[];
  /** DH6: `kesin + dogrula + cok_anlamli + karsiliksiz = evren`. `false` → kuru koşu `error` döner. */
  degismezTamam: boolean;
}

const sirali = <T extends string>(xs: Iterable<T>): T[] => [...new Set(xs)].sort();
/** TAM bir sayımın haritası: anahtar YOKSA o anahtarın sayısı sıfırdır (bilinmeyen değer değil — ölçülemeyen sayım haritası `null`). */
function sayacOku<K>(m: ReadonlyMap<K, number>, k: K): number {
  const n = m.get(k);
  return n === undefined ? 0 : n;
}

export function siniflandir(g: SiniflamaGirdisi): SiniflamaSonucu {
  const { evren } = g;
  const { mikroKumesi, eskiKodlar, kodaGoreKartlar } = evren;
  const kartSayisi = (k: string): number => { const grup = kodaGoreKartlar.get(k); return grup ? grup.length : 0; };

  // Tablo: eski → yeni → kaynaklar.
  const tablo = new Map<string, Map<string, Set<TabloKaynagi>>>();
  for (const c of g.tablo) {
    let m = tablo.get(c.eski);
    if (!m) { m = new Map(); tablo.set(c.eski, m); }
    const s = m.get(c.yeni);
    if (s) s.add(c.kaynak); else m.set(c.yeni, new Set([c.kaynak]));
  }
  // Tablodan bağımsız kanıt: eski → yeni → türler.
  const kanit = new Map<string, Map<string, Set<'guid' | 'hareket'>>>();
  for (const k of g.kanitlar) {
    let m = kanit.get(k.eski);
    if (!m) { m = new Map(); kanit.set(k.eski, m); }
    const s = m.get(k.yeni);
    if (s) s.add(k.tur); else m.set(k.yeni, new Set([k.tur]));
  }

  // Harf farkı iskeletleri (DH20) — yalnız uyarı.
  const iskeletHaritasi = (kodlar: Iterable<string>): Map<string, Set<string>> => {
    const h = new Map<string, Set<string>>();
    for (const k of kodlar) { const i = harfIskeleti(k); const s = h.get(i); if (s) s.add(k); else h.set(i, new Set([k])); }
    return h;
  };
  const mikroIskelet = iskeletHaritasi(mikroKumesi);
  const evrenIskelet = iskeletHaritasi(eskiKodlar.keys());
  const benzerler = (h: Map<string, Set<string>>, kod: string): string[] => [...(h.get(harfIskeleti(kod)) ?? [])].filter(b => b !== kod).sort();
  const uyarilar = new Map<string, HarfFarkiUyarisi>();
  const uyar = (u: HarfFarkiUyarisi): void => { uyarilar.set(`${u.nerede}\u0000${u.kod}\u0000${u.benzer}`, u); };

  const satirlar = new Map<string, GocSatiri>();
  const mikroSayim = (eski: string) => ({
    hareket: g.mikroEskiKodda.hareket ? sayacOku(g.mikroEskiKodda.hareket, eski) : null,
    fiyat: g.mikroEskiKodda.fiyat ? sayacOku(g.mikroEskiKodda.fiyat, eski) : null,
    barkod: g.mikroEskiKodda.barkod ? sayacOku(g.mikroEskiKodda.barkod, eski) : null,
  });

  for (const [eski, kartlar] of eskiKodlar) {
    const tabloAday = tablo.get(eski) ?? new Map<string, Set<TabloKaynagi>>();
    const kanitAday = kanit.get(eski) ?? new Map<string, Set<'guid' | 'hareket'>>();
    const adaylar: GocAdayi[] = sirali([...tabloAday.keys(), ...kanitAday.keys()]).map(yeni => {
      const kaynaklar = sirali(tabloAday.get(yeni) ?? []);
      const turler = new Set<KanitTuru>(kanitAday.get(yeni) ?? []);
      if (kaynaklar.some(gucluKaynakMi)) turler.add('tablo');
      if (kaynaklar.some(k => !gucluKaynakMi(k))) turler.add('tablo_aday');
      return { yeni, kaynaklar, kanit: sirali(turler), mikroda: mikroKumesi.has(yeni), cetpaKart: kartSayisi(yeni) };
    });
    const mikroda = adaylar.filter(a => a.mikroda);
    const tabloMikroda = mikroda.filter(a => a.kaynaklar.length > 0);
    const tabloMikrodaYok = adaylar.filter(a => !a.mikroda && a.kaynaklar.length > 0);
    const araKartlar = tabloMikrodaYok.filter(a => eskiKodlar.has(a.yeni)).map(a => a.yeni);
    const sayim = mikroSayim(eski);
    const gerekce: string[] = [];
    let sinif: GocSinifi;
    let yeni: string | null = null;
    let secilen: GocAdayi | undefined;

    for (const b of benzerler(mikroIskelet, eski)) uyar({ kod: eski, benzer: b, nerede: 'mikro' });

    if (mikroda.length === 0) {
      sinif = 'karsiliksiz';
      gerekce.push(adaylar.length ? 'aday_mikroda_yok' : 'tablo_ve_kanit_yok');
    } else if (tabloMikroda.length >= 2) {
      sinif = 'cok_anlamli';
      gerekce.push('birden_cok_tablo_adayi_mikroda');
    } else if (mikroda.length >= 2) {
      sinif = 'dogrula';
      gerekce.push('kanit_celiskisi');
    } else {
      secilen = mikroda[0];
      yeni = secilen.yeni;
      const tablolu = secilen.kaynaklar.length > 0;
      const guclu = secilen.kaynaklar.some(gucluKaynakMi);
      const bagimsiz = secilen.kanit.includes('guid') || secilen.kanit.includes('hareket');
      if (!tablolu) gerekce.push('yalniz_guid');
      else if (!guclu) gerekce.push('zayif_kaynak');
      if (tablolu && !bagimsiz) gerekce.push('yalniz_tablo');
      if (tabloMikrodaYok.length) gerekce.push('kaynaklar_celisiyor');
      for (const t of ['hareket', 'fiyat', 'barkod'] as const) {
        const n = sayim[t];
        if (n === null) gerekce.push(`mikro_olcum_yok_${t}`);
        else if (n > 0) gerekce.push(MIKRO_SAYIM_GEREKCESI[t]);
      }
      if (g.magazaEskiKodlar.has(eski)) gerekce.push('magaza_talebi_eski_kodda');
      if (benzerler(mikroIskelet, eski).length) gerekce.push('harf_farki');
      sinif = gerekce.length ? 'dogrula' : 'kesin';
    }

    satirlar.set(eski, {
      eski, sinif, yeni,
      kanit: secilen ? secilen.kanit : [],
      kaynaklar: secilen ? secilen.kaynaklar : sirali(adaylar.flatMap(a => a.kaynaklar)),
      adaylar, gerekce,
      kartlar: kartlar.map(k => k.id).sort(),
      etiketsizKart: kartlar.filter(etiketsizMi).length,
      araKartlar, zincir: [], mikroEskiKodda: sayim,
    });
  }

  // DH4 · ara halka: kendi başına karşılıksız kalan kart başka bir eski kodun (Mikro'da OLMAYAN) tablo adayıysa o satırın hedefine
  // bağlanır — ama ancak kullanıcının tek tek onayıyla (`dogrula`). «Ara kartlar da birleşir» kuralı KALDIRILDI: kendiliğinden
  // birleşme yok. Ebeveyn `cok_anlamli` ise ara halka da öyledir; ebeveynlerin hedefi ayrışıyorsa hedef `null`; hiçbir ebeveynin
  // hedefi yoksa satır karşılıksız KALIR.
  const hedefSec = (s: GocSatiri, hedefler: string[], tur: KanitTuru): void => {
    if (hedefler.length > 1) { s.gerekce.push('kanit_celiskisi'); return; }
    const [h] = hedefler;
    s.yeni = h;
    s.kanit = [tur];
    if (!s.adaylar.some(a => a.yeni === h)) s.adaylar.push({ yeni: h, kaynaklar: [], kanit: [tur], mikroda: mikroKumesi.has(h), cetpaKart: kartSayisi(h) });
  };
  const ebeveynler = new Map<string, string[]>();
  for (const s of satirlar.values()) for (const a of s.araKartlar) { const e = ebeveynler.get(a); if (e) e.push(s.eski); else ebeveynler.set(a, [s.eski]); }
  // SABİT NOKTA: her ara halka, ebeveynlerinin GÜNCEL hâlinden hiçbir satır değişmeyene dek yeniden hesaplanır; satırlar kod
  // sırasıyla gezilir. Tek geçiş kart OKUMA SIRASINA bağlıydı: halka, ebeveyni ondan sonra çözülünce karşılıksız kalıyor; çok
  // ebeveynli halka geç çözülen ebeveynin hedefini görmeden bağlanıyordu — aynı veride sınıf ve `planImza` değişiyordu.
  // Döngüsüz tabloda sonuç gezme sırasından bağımsızdır (tek sabit nokta); döngülü tabloda (A → B, B → A) kod sırası belirler —
  // yine okuma sırası DEĞİL. Tur sayısı ara halka sayısıyla sınırlı.
  const araHalkalar = [...ebeveynler].flatMap(([ara, ebeveyn]) => {
    const s = satirlar.get(ara);
    return s && s.sinif === 'karsiliksiz' ? [{ s, ebeveyn, gerekce: s.gerekce.slice(), adaylar: s.adaylar.slice() }] : [];
  }).sort((a, b) => (a.s.eski < b.s.eski ? -1 : a.s.eski > b.s.eski ? 1 : 0));
  for (let tur = 0, degisti = true; degisti && tur <= araHalkalar.length; tur++) {
    degisti = false;
    for (const { s, ebeveyn, gerekce, adaylar } of araHalkalar) {
      const ebeveynSatirlari = ebeveyn.map(e => satirlar.get(e)).filter((x): x is GocSatiri => x !== undefined);
      const hedefler = sirali(ebeveynSatirlari.flatMap(e => (e.yeni ? [e.yeni] : [])));
      const belirsiz = ebeveynSatirlari.some(e => e.sinif === 'cok_anlamli');
      const sinif: GocSinifi = belirsiz ? 'cok_anlamli' : hedefler.length ? 'dogrula' : 'karsiliksiz';
      const yeni = sinif === 'dogrula' && hedefler.length === 1 ? hedefler[0] : null;
      if (sinif === s.sinif && yeni === s.yeni) continue;
      degisti = true;
      Object.assign(s, { sinif, yeni: null, kanit: [], gerekce: gerekce.slice(), adaylar: adaylar.slice(), zincir: [] });
      if (sinif === 'karsiliksiz') continue;
      s.zincir = sirali(ebeveyn);
      s.gerekce = ['ara_halka'];
      if (sinif === 'dogrula') hedefSec(s, hedefler, 'zincir');
    }
  }
  // D0 · zincir (eski → ara → yeni): eski kodun TEK tablo adayı Mikro'da yoksa ama o ara kodun kendi satırı bir hedefe çözülüyorsa
  // eski kod da EN SON halkaya bağlanır — yine yalnız `dogrula` (DH4: kendiliğinden birleşme yok). Ölçü (05.11): tablolarda zincir 0.
  // Halka `cok_anlamli` ise eski kod da öyledir (ara halka döngüsüyle simetrik): belirsiz kod karşılıksız sayılıp pasife DÜŞMEZ.
  for (const s of satirlar.values()) {
    if (s.sinif !== 'karsiliksiz' || !s.araKartlar.length) continue;
    const halkalar = s.araKartlar.map(a => satirlar.get(a)).filter((x): x is GocSatiri => x !== undefined && x.zincir.length === 0);
    const hedefler = sirali(halkalar.flatMap(h => (h.yeni ? [h.yeni] : [])));
    const belirsiz = halkalar.some(h => h.sinif === 'cok_anlamli');
    if (!belirsiz && !hedefler.length) continue;
    s.zincir = s.araKartlar.slice();
    s.gerekce = ['zincir'];
    if (belirsiz) { s.sinif = 'cok_anlamli'; continue; }
    s.sinif = 'dogrula';
    hedefSec(s, hedefler, 'zincir');
  }

  // Tablonun evrene düşmeyen kısmı: eski kod Mikro'da (değişmemiş) ya da Cetpa'da kartı yok (iş yok).
  const degismemis: Array<{ eski: string; yeniler: string[] }> = [];
  let kartsizEski = 0, evrendeEslesen = 0;
  for (const [eski, yeniler] of tablo) {
    for (const y of yeniler.keys()) if (!mikroKumesi.has(y)) for (const b of benzerler(mikroIskelet, y)) uyar({ kod: y, benzer: b, nerede: 'tablo_yeni' });
    if (eskiKodlar.has(eski)) { evrendeEslesen++; continue; }
    if (mikroKumesi.has(eski)) { degismemis.push({ eski, yeniler: sirali(yeniler.keys()) }); continue; }
    kartsizEski++;
    for (const b of benzerler(evrenIskelet, eski)) uyar({ kod: eski, benzer: b, nerede: 'tablo_eski' });
  }
  degismemis.sort((a, b) => (a.eski < b.eski ? -1 : a.eski > b.eski ? 1 : 0));

  const liste = [...satirlar.values()].sort((a, b) => (a.eski < b.eski ? -1 : a.eski > b.eski ? 1 : 0));
  const sayilar: Record<GocSinifi | 'degismemis', number> = { kesin: 0, dogrula: 0, cok_anlamli: 0, karsiliksiz: 0, degismemis: degismemis.length };
  for (const s of liste) sayilar[s.sinif]++;
  const toplam = sayilar.kesin + sayilar.dogrula + sayilar.cok_anlamli + sayilar.karsiliksiz;
  return {
    satirlar: liste, degismemis, sayilar,
    tablo: { satir: g.tablo.length, tekilEski: tablo.size, evrendeEslesen, degismemis: degismemis.length, kartsizEski },
    harfFarki: [...uyarilar.values()].sort((a, b) => (a.kod + a.benzer < b.kod + b.benzer ? -1 : 1)),
    degismezTamam: toplam === evren.olcu.kod && liste.length === evren.olcu.kod,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DH1 · KOLEKSİYON → ALAN YOLU TABLOSU (kuru koşu ve — sonraki dilimde — uygulama YALNIZ bunu okur)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** `tur: 'sku'` → değer `kodAnahtari` ile eski koda; `'kartKimligi'` → değer eski kartın belge kimliğine karşılaştırılır. */
export interface AlanYolu { yol: string; tur: 'sku' | 'kartKimligi' }
export interface BagliKayitTanimi {
  koleksiyon: string;
  alanlar: readonly AlanYolu[];
  /** Ayna ya da müşteri beyanı: uygulama YAZMAZ, yalnız sayılır (D3 `barkodlar` / `mikroFiyatListeleri`, DH14 `magazaTalepleri`). */
  yalnizSayilir: boolean;
  /** Belge kimliği koddan türer (`mikroIdCozucu` + `/` `\` → `_`; DH18). */
  kimlikKoddan: boolean;
  /** `sku` değerinin `-Dnnn` paket soneki atılmış tabanı da sayılır (DH14). */
  paketTabani: boolean;
  /** Alan yolunun yazan / tanımlayan satırı (DH1 «dosya:satır»; 05.11.2026 `ded5f79` ağacında ölçüldü). */
  kaynak: string;
  not?: string;
}

const yolu = (yol: string, tur: AlanYolu['tur'] = 'sku'): AlanYolu => ({ yol, tur });
const tanim = (koleksiyon: string, alanlar: AlanYolu[], kaynak: string, ek: Partial<Pick<BagliKayitTanimi, 'yalnizSayilir' | 'kimlikKoddan' | 'paketTabani' | 'not'>> = {}): BagliKayitTanimi => ({
  koleksiyon, alanlar, kaynak, yalnizSayilir: ek.yalnizSayilir ?? false, kimlikKoddan: ek.kimlikKoddan ?? false, paketTabani: ek.paketTabani ?? false,
  ...(ek.not ? { not: ek.not } : {}),
});

/**
 * DH1 tablosu — kodda TEK kaynak. Şartname tablosundan SAPMALAR (ölçülerek, gerekçe `not`'ta):
 *  • `quotes` koleksiyonunun YAZANI YOK: teklif koleksiyonu `quotations`'tır (QuotationForm.tsx:117/121; collections.ts:29). İkisi de
 *    sayılır — `quotes` canlıdaki «0 satır» ölçüsünün nedeni budur.
 *  • `orders`, `quotations`, `quotes`: kalemin `inventoryId`'si (kart kimliği) de sayılır (types.ts:124 / :76; AddOrderModal.tsx:258).
 *  • `shipments`, `vehicles`: yazan satırların hiçbiri kod ya da kart kimliği yazmıyor → alan yok (okunmaz, «alan yok» raporlanır).
 * Alan adları `barkodlar` için Mikro şemasından gelir (motor ekler; burada boş).
 */
export const BAGLI_KAYIT_TABLOSU: readonly BagliKayitTanimi[] = [
  tanim('orders', [yolu('lineItems[].sku'), yolu('lineItems[].inventoryId', 'kartKimligi')],
    'types.ts:204 (lineItems), types.ts:96 / :124 (OrderLineItem.sku / inventoryId), mikroRoutes.ts:5274 (MF kalemi), AddOrderModal.tsx:258'),
  tanim('quotations', [yolu('items[].sku'), yolu('lineItems[].sku'), yolu('items[].inventoryId', 'kartKimligi'), yolu('lineItems[].inventoryId', 'kartKimligi')],
    'types.ts:69-84 (QuotationItem / Quotation), QuotationForm.tsx:117 / :121', { not: 'şartnamedeki `quotes` bu koleksiyondur' }),
  tanim('quotes', [yolu('items[].sku'), yolu('lineItems[].sku'), yolu('items[].inventoryId', 'kartKimligi'), yolu('lineItems[].inventoryId', 'kartKimligi')],
    'types.ts:83-84', { not: 'kodda yazanı yok (şartname adı); sayılır, beklenen 0' }),
  tanim('priceLists', [yolu('productId', 'kartKimligi'), yolu('items[].productId', 'kartKimligi'), yolu('items[].sku')],
    'types.ts:698-723 (PriceListItem / PriceList), PriceListForm.tsx:110 / :112'),
  tanim('inventoryMovements', [yolu('sth_stok_kod'), yolu('sku'), yolu('productId', 'kartKimligi')],
    'types.ts:296-308 (InventoryMovement), mikroRoutes.ts:1500 (Mikro satırı, `...row`)'),
  tanim('stockDiscrepancies', [yolu('sku'), yolu('productId', 'kartKimligi')], 'types.ts:328-339, crons.ts:227'),
  tanim('locationStocks', [yolu('sku'), yolu('productId', 'kartKimligi')], 'types.ts:681-691, server.ts:3161',
    { not: 'belge kimliği `<tür>:<yer>:<productId>` (kart kimliği taşır)' }),
  tanim('consignments', [yolu('sku'), yolu('productId', 'kartKimligi')], 'types.ts:312-326, InventoryView.tsx:374'),
  tanim('purchaseOrders', [yolu('sku'), yolu('inventoryId', 'kartKimligi'), yolu('items[].sku'), yolu('items[].id', 'kartKimligi')],
    'server.ts:3319-3325 (otomatik SAS: sku + inventoryId), PurchasingModule.tsx:413 / :486 (items[] = { id: kart kimliği, sku, … }, :361)'),
  tanim('bom', [yolu('productSku'), yolu('components[].sku'), yolu('components[].inventoryId', 'kartKimligi')],
    'mikroRoutes.ts:4895-4904, eslemeVarlik.ts:415-417, BOMPanel.tsx:149 / :151', { not: 'Mikro reçetesinin belge kimliği `productSku`\'dan türer' }),
  tanim('skuMappings', [yolu('mikroSku')], 'server.ts:3530-3532', { not: 'belge kimliği büyütülmüş + süzülmüş koddan türer' }),
  tanim('shipments', [], 'App.tsx:3279, OrdersPage.tsx:4304 / :4655, QuickShipmentModal.tsx:55, mikroRoutes.ts:6279',
    { not: 'yazan satırlarda kod / kart kimliği alanı yok' }),
  tanim('vehicles', [], 'OrdersPage.tsx:3563, mikroRoutes.ts:3405', { not: 'yazan satırlarda kod / kart kimliği alanı yok' }),
  tanim('warehouseItems', [yolu('sku')], 'mikroRoutes.ts:999-1001, :4221 (kimlik `mikroIdCozucu` + `/` → `_`)', { kimlikKoddan: true }),
  tanim('barkodlar', [], 'mikroRoutes.ts:3462 (BARKOD_TANIMLARI satırı, `SELECT *`)',
    { yalnizSayilir: true, not: 'alan adı Mikro `BARKOD_TANIMLARI` şemasından (motor ekler); saf Mikro aynası' }),
  tanim('mikroFiyatListeleri', [yolu('sfiyat_stokkod')], 'mikroRoutes.ts:3509-3531 (secimKolonlari)', { yalnizSayilir: true, not: 'saf Mikro aynası' }),
  tanim('magazaTalepleri', [yolu('kalemler[].sku'), yolu('teyit.kalemler[].sku')], 'magazaIcerik.ts:12, magazaRoutes.ts:255',
    { yalnizSayilir: true, paketTabani: true, not: 'müşteri beyanı — yeniden yazılmaz (DH14)' }),
];

/** Alan yolu değerleri: `a.b[].c` — `[]` dizi öğelerine iner; nesne olmayan ara düğüm sessizce atlanır. */
export function yolDegerleri(veri: unknown, yol: string): unknown[] {
  let simdiki: unknown[] = [veri];
  for (const parca of yol.split('.')) {
    const dizi = parca.endsWith('[]');
    const ad = dizi ? parca.slice(0, -2) : parca;
    const sonraki: unknown[] = [];
    for (const d of simdiki) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      const v = (d as Record<string, unknown>)[ad];
      if (dizi) { if (Array.isArray(v)) sonraki.push(...v); } else if (v !== undefined) sonraki.push(v);
    }
    simdiki = sonraki;
  }
  return simdiki;
}

export interface KoleksiyonSayimi {
  koleksiyon: string;
  alanlar: string[];
  yalnizSayilir: boolean;
  kaynak: string;
  not?: string;
  okunanBelge: number;
  /** En az bir eski koda bağlı belge sayısı. */
  bagliBelge: number;
  /** Alan yolu (ve `kimlik`) başına bağlı belge sayısı. */
  alanBasina: Record<string, number>;
  /** Eski kod → bağlı belge kimlikleri (iç kullanım; yanıta sayı olarak çıkar). */
  koduBasina: Map<string, Set<string>>;
}

/**
 * DH1 tablosuyla bağlı kayıt sayımı (DH15: değer `kodAnahtari` ile JS'te karşılaştırılır; SQL'de ham `= ANY` YOK).
 * `kartlar`: eski kod → eski kart kimlikleri. `kimlikEsleri`: koddan türeyen belge kimliği → eski kod (yalnız `kimlikKoddan`).
 */
export function bagliKayitlariSay(
  t: BagliKayitTanimi,
  belgeler: ReadonlyArray<{ id: string; veri: Readonly<Record<string, unknown>> }>,
  eskiKartlar: ReadonlyMap<string, readonly string[]>,
  kimlikEsleri?: ReadonlyMap<string, string>,
  ekAlanlar: readonly AlanYolu[] = [],
): KoleksiyonSayimi {
  const kartaGore = new Map<string, string>();
  for (const [kod, ids] of eskiKartlar) for (const id of ids) kartaGore.set(id, kod);
  const alanlar = [...t.alanlar, ...ekAlanlar];
  const alanBasina: Record<string, number> = Object.fromEntries(alanlar.map(a => [a.yol, 0]));
  if (t.kimlikKoddan) alanBasina['(kimlik)'] = 0;
  const koduBasina = new Map<string, Set<string>>();
  const bagli = new Set<string>();
  const ekle = (kod: string, id: string): void => { bagli.add(id); const s = koduBasina.get(kod); if (s) s.add(id); else koduBasina.set(kod, new Set([id])); };
  for (const b of belgeler) {
    for (const a of alanlar) {
      let tuttu = false;
      for (const v of yolDegerleri(b.veri, a.yol)) {
        if (a.tur === 'kartKimligi') {
          const kod = typeof v === 'string' ? kartaGore.get(v) : undefined;
          if (kod !== undefined) { ekle(kod, b.id); tuttu = true; }
          continue;
        }
        const k = kodAnahtari(v);
        if (!k) continue;
        if (eskiKartlar.has(k)) { ekle(k, b.id); tuttu = true; continue; }
        if (t.paketTabani) {
          const taban = magazaTabanSku(k);
          if (taban !== null && eskiKartlar.has(taban)) { ekle(taban, b.id); tuttu = true; }
        }
      }
      if (tuttu) alanBasina[a.yol]++;
    }
    if (t.kimlikKoddan && kimlikEsleri) {
      const kod = kimlikEsleri.get(b.id);
      if (kod !== undefined) { ekle(kod, b.id); alanBasina['(kimlik)']++; }
    }
  }
  return {
    koleksiyon: t.koleksiyon, alanlar: alanlar.map(a => a.yol), yalnizSayilir: t.yalnizSayilir, kaynak: t.kaynak,
    ...(t.not ? { not: t.not } : {}),
    okunanBelge: belgeler.length, bagliBelge: bagli.size, alanBasina, koduBasina,
  };
}

/** warehouseItems belge kimliğinin koddan türeyen parçası (import ile AYNI: `sku.replace(/[/\\]/g, '_')`; DH18). */
export const depoKimlikParcasi = (sku: string): string => sku.replace(/[/\\]/g, '_');

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D1 · DEĞİŞMEZLER + PLAN ÖZETİ + İMZA (DH16)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Aynı anahtarda birden çok kart (kaynağı ne olursa olsun). `haric`: plan sonrası arşive gidecek kartlar. */
export function ayniSkuGruplari(kartlar: readonly GocKarti[], haric: ReadonlySet<string> = new Set()): Array<{ sku: string; kart: number }> {
  const say = new Map<string, number>();
  for (const k of kartlar) {
    if (haric.has(k.id)) continue;
    const a = kodAnahtari(k.sku);
    if (a) say.set(a, sayacOku(say, a) + 1);
  }
  return [...say].filter(([, n]) => n > 1).map(([sku, kart]) => ({ sku, kart })).sort((a, b) => (a.sku < b.sku ? -1 : 1));
}

/** `prices` nesnesinin sonlu sayı taşıyan kademe ADLARI (değer yanıta çıkmaz). */
function kademeAdlari(prices: unknown): Set<string> {
  const s = new Set<string>();
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return s;
  for (const [ad, v] of Object.entries(prices)) if (typeof v === 'number' && Number.isFinite(v)) s.add(ad);
  return s;
}

export interface PlanSatiri {
  eski: string;
  yeni: string;
  sinif: GocSinifi;
  /** Kalacak kart (Mikro'nun açtığı yeni kodlu ikiz; D2). Kiracıda o kodda kart yoksa `null`, birden çoksa ilk ve `kalanKartSayisi`. */
  kalanKart: string | null;
  kalanKartSayisi: number;
  arsiveGiden: string[];
  /** Yeniden yazılacak bağlı belge sayısı (ayna ve mağaza talebi HARİÇ). */
  belge: Record<string, number>;
  /** DH5 ölçüsü: eski kartta olup kalan kartta olmayan fiyat kademesi ADLARI (fiyat taşınmaz; karar onay listesinde). */
  fiyatKademeFarki: string[];
}

export interface PlanOzeti {
  satirlar: PlanSatiri[];
  kesin: { cift: number; arsiveGidenKart: number; kalanKartsiz: number; belge: Record<string, number>; toplamBelge: number };
  dogrula: { cift: number; arsiveGidenKart: number; kalanKartsiz: number; belge: Record<string, number>; toplamBelge: number };
  /** Birden çok eski kodun aynı yeni koda katlandığı hedefler. */
  ortakHedef: Array<{ yeni: string; eskiler: string[] }>;
  /** Pasif listeye adaylar (karşılıksız; D5): kod + kart kimliği. */
  pasif: { kod: number; kart: number };
}

export function planOzeti(
  s: SiniflamaSonucu,
  evren: GocEvreni,
  sayimlar: readonly KoleksiyonSayimi[],
): PlanOzeti {
  const ozet = () => ({ cift: 0, arsiveGidenKart: 0, kalanKartsiz: 0, belge: {} as Record<string, number>, toplamBelge: 0 });
  const kesin = ozet(), dogrula = ozet();
  const satirlar: PlanSatiri[] = [];
  const hedefler = new Map<string, string[]>();
  for (const r of s.satirlar) {
    if (r.yeni === null || (r.sinif !== 'kesin' && r.sinif !== 'dogrula')) continue;
    const kalanlar = evren.kodaGoreKartlar.get(r.yeni) ?? [];
    const kalan = kalanlar.length ? [...kalanlar].sort((a, b) => (a.id < b.id ? -1 : 1))[0] : undefined;
    const belge: Record<string, number> = {};
    for (const c of sayimlar) {
      if (c.yalnizSayilir) continue;
      const ids = c.koduBasina.get(r.eski);
      const n = ids ? ids.size : 0;
      if (n > 0) belge[c.koleksiyon] = n;
    }
    const eskiKademe = new Set<string>();
    for (const k of evren.eskiKodlar.get(r.eski) ?? []) for (const a of kademeAdlari(k.prices)) eskiKademe.add(a);
    const kalanKademe = kademeAdlari(kalan?.prices);
    satirlar.push({
      eski: r.eski, yeni: r.yeni, sinif: r.sinif, kalanKart: kalan ? kalan.id : null, kalanKartSayisi: kalanlar.length,
      arsiveGiden: r.kartlar, belge, fiyatKademeFarki: [...eskiKademe].filter(a => !kalanKademe.has(a)).sort(),
    });
    const o = r.sinif === 'kesin' ? kesin : dogrula;
    o.cift++;
    o.arsiveGidenKart += r.kartlar.length;
    if (!kalan) o.kalanKartsiz++;
    for (const [c, n] of Object.entries(belge)) { o.belge[c] = (c in o.belge ? o.belge[c] : 0) + n; o.toplamBelge += n; }
    const h = hedefler.get(r.yeni);
    if (h) h.push(r.eski); else hedefler.set(r.yeni, [r.eski]);
  }
  const karsiliksiz = s.satirlar.filter(r => r.sinif === 'karsiliksiz');
  return {
    satirlar, kesin, dogrula,
    ortakHedef: [...hedefler].filter(([, e]) => e.length > 1).map(([yeni, eskiler]) => ({ yeni, eskiler: [...eskiler].sort() })).sort((a, b) => (a.yeni < b.yeni ? -1 : 1)),
    pasif: { kod: karsiliksiz.length, kart: karsiliksiz.reduce((t, r) => t + r.kartlar.length, 0) },
  };
}

/**
 * DH16 · `planImza` = girdilerin SHA-256'sı, sıralı:
 *   (eski, yeni, sınıf, kanıt türleri) · etkilenen kartların kimlik + sku + source + varlık · eski ve yeni kodların Mikro'da var / yok
 *   bitleri · bağlı kayıt kimlik kümesi (`koleksiyon/belge`).
 * İmzaya GİRMEYENLER: `stockLevel`, `prices`, `costPrice`, `mikroSyncedAt`, zaman damgaları, ad — saatlik senkronun yazdığı alan
 * imzayı bozmasın. ŞARTNAMEYE EK: kiracı kimliği de girer (başka kiracının kuru koşusunun imzası bu kiracıda geçmesin).
 */
export function planImzasi(kiraci: string, s: SiniflamaSonucu, evren: GocEvreni, sayimlar: readonly KoleksiyonSayimi[]): string {
  const satirlar = s.satirlar.map(r => [r.eski, r.yeni ?? '', r.sinif, r.kanit.join(',')]);
  const kodlar = new Set<string>();
  const kartIds = new Set<string>();
  for (const r of s.satirlar) {
    kodlar.add(r.eski);
    for (const id of r.kartlar) kartIds.add(id);
    for (const a of r.adaylar) {
      kodlar.add(a.yeni);
      for (const k of evren.kodaGoreKartlar.get(a.yeni) ?? []) kartIds.add(k.id);
    }
  }
  const kartlar: Array<[string, string, string, boolean]> = [];
  const kartHaritasi = new Map<string, GocKarti>();
  for (const grup of evren.kodaGoreKartlar.values()) for (const k of grup) kartHaritasi.set(k.id, k);
  for (const id of [...kartIds].sort()) {
    const k = kartHaritasi.get(id);
    kartlar.push([id, k ? String(k.sku) : '', k && typeof k.source === 'string' ? k.source : '', k !== undefined]);
  }
  const mikro = [...kodlar].sort().map(k => [k, evren.mikroKumesi.has(k) ? 1 : 0]);
  const bagli = sirali(sayimlar.flatMap(c => [...c.koduBasina.values()].flatMap(ids => [...ids].map(id => `${c.koleksiyon}/${id}`))));
  return sha256(kanonikJson({ surum: 1, kiraci, satirlar, kartlar, mikro, bagli }));
}
