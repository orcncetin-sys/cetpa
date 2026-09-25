/**
 * eslemeFatura.ts — Mikro'dan OKUNAN fatura verisinin Cetpa şemasına eşlenmesi
 * (Faz 3 3/n, grup "eslemeFatura", 2026-09-19). Saf fonksiyonlar: ağ, DB, express YOK.
 *
 * ## Neden var — kaldırılan sahte-varsayılan siteleri
 *
 * `src/server/routes/mikroRoutes.ts` içindeki üç rota, okunamayan Mikro değerini
 * sessizce 0 / "satış" yapıyordu:
 *
 *   • `/api/mikro/import/faturalar` (~3026): `Number(row.cha_tip ?? 0) === 0 ? 'satis' : 'alis'`
 *     → cha_tip okunamayan ALIŞ faturası SATIŞ olarak damgalanıyordu (ciro şişer).
 *     Ayrıca `{ ...row }` yayılımı `merge: true` ile null değerleri de yazıyordu:
 *     Mikro okuması bir kez bozulduğunda (kolon adı değişti, şema keşfi boş döndü)
 *     TÜM tutarlar null'lanıyordu. Bayat değer, silinmiş değerden iyidir.
 *   • `/api/mikro/import/faturadan-siparis` (~3455-3520): `quantity: Number(row.miktar) || 0`,
 *     `total: Number(row.toplam) || 0`, `totalPrice: Number(x.cha_meblag ?? 0) || 0`
 *     → tutarı okunamayan fatura ₺0 ciroya, miktarı okunamayan kalem 0 adede dönüyordu;
 *     SQL tarafındaki `COALESCE(sth_tutar,0) + COALESCE(sth_vergi,0)` ise KDV'si
 *     okunamayan satırın toplamını EKSİK gösteriyordu (sessizce, hatasız).
 *   • `/api/mikro/fatura/kalemler` (~1633): birim işaretçisi çözümü — burada sahte
 *     varsayılan YOKTU, davranış aynen taşındı ve testle kilitlendi.
 *
 * ## Sözleşme (CLAUDE.md + Faz 3 kuralları)
 *
 *   OKUNAN eşlemede bilinmeyen sayı 0 YAZILMAZ. Doküman alanı ise HİÇ yazılmaz
 *   (`merge: true` mevcut değeri korur); dizi elemanı ise (`lineItems`) `null` yazılır
 *   — dizide "alanı atlamak" diye bir şey yok. Her iki durumda da SAYILIR ve import
 *   yanıtındaki `note`'a girer.
 *
 *   Bir alan ≥ OKUMA_ARIZASI_ESIK satırlık importun TAMAMINDA bilinmiyorsa bu veri
 *   değil OKUMA ARIZASIDIR (kolon adı/şema): `okumaArizasi` listesine girer ve not'un
 *   BAŞINA uyarı yazılır. Rota ayrıca `console.warn` basar.
 *
 *   `?? 0` yalnız BAYRAK/TİP kodunda meşru olabilirdi (cha_tip); burada o da
 *   kullanılmıyor — yönü okunamayan fatura "satış" sayılmaz, yönsüz sayılır.
 *
 * ## Taşınan canlı doğrulama notları (kaybolmasın)
 *
 *   • cha_tip: 0 = borç (satış / Cetpa'nın kestiği), 1 = alacak (alış / gelen).
 *     Mikro fatura başlığı CARI_HESAP_HAREKETLERI, cha_evrak_tip = 63.
 *   • Kalem birleştirme anahtarı `seri|sıra` 2026-08-01'de CANLIDA doğrulandı:
 *     sth_evraktip = 4 (satış satırı), sth_evrakno_sira = cha_evrakno_sira.
 *     Fatura 321: başlık 21.600 = 18.000 matrah + 3.600 KDV ✓ · 322: 13.062 = 10.885 + 2.177 ✓
 *     Bu kurulumda seri BOŞ; yine de anahtara dahil (başka kurulumda dolu olabilir) —
 *     bu yüzden boş seri OKUMA ARIZASI SAYILMAZ.
 *   • Sipariş doküman id'si kiracı önekli (`mikrofat__<cid>__<seri>-<sira>`): evrak no
 *     küresel benzersiz DEĞİLDİR, docs tablosunun PK'sı (coll,id) olduğu için önek
 *     olmadan iki firma birbirinin kaydını ezer (eBelgeYaz dersi, recurringBilling'de
 *     bir kez yaşandı). Biçim DEĞİŞMEMELİ: değişirse idempotentlik kırılır ve her koşu
 *     mükerrer sipariş üretir.
 *   • AÇIK SORU (2026-09-18): satır tutarı `sth_tutar` BRÜTtür; iskontolu faturada
 *     matrah şişik olabilir. Bu modül matrah TANIMINI DEĞİŞTİRMEZ — yalnız sıfır
 *     zorlamasını kaldırır. Net gerekiyorsa `src/lib/stokFiyat.ts` (satirNet/kalemleriCoz).
 *
 * ## AD ÇAKIŞMASI UYARISI
 *
 *   `src/utils/faturaEsle.ts` BAŞKA bir şeydir (istemci: stok hareketini mikroFaturalar
 *   içindeki faturayla EŞLEŞTİRİR). Buradaki `faturaEsle` bir Mikro SATIRINI Cetpa
 *   dokümanına EŞLER. İkisini karıştırma.
 */
import { bilinenSayi } from '../../utils/para.js';

/** Bir alanın "hiçbir satırda okunamadı" sayılması için gereken en az satır sayısı. */
export const OKUMA_ARIZASI_ESIK = 5;

/**
 * Okuma arızası araması YALNIZ bu alanlarda yapılır. `cha_evrakno_seri` BİLEREK YOK:
 * bu kurulumda seri meşru olarak boş ve her importta yanlış alarm üretirdi.
 */
export const FATURA_KRITIK_ALANLAR = [
  'cha_Guid', 'cha_evrakno_sira', 'cha_tarihi', 'cha_tip', 'cha_kod', 'cha_meblag',
] as const;

export type FaturaYonu = 'satis' | 'alis';

/** Bilinmeyen değeri ayıklar: null/undefined "okunamadı"dır; '' ve 0 BİLİNEN değerdir. */
const bilinmiyor = (v: unknown): boolean => v === null || v === undefined;

const metin = (v: unknown): string => (bilinmiyor(v) ? '' : String(v));

/**
 * Fatura yönü. cha_tip 0 = satış, ≠0 = alış (eski davranış aynen). Okunamazsa `null`:
 * `?? 0` burada bir alış faturasını satış yapıyordu. Daha önce yazılmış `yon` alanı
 * varsa (mikroFaturalar dokümanı) ona düşer — tanınmayan etiket kabul edilmez.
 */
export function faturaYonu(row: Record<string, unknown>): FaturaYonu | null {
  if (bilinenSayi(row.cha_tip)) return Number(row.cha_tip) === 0 ? 'satis' : 'alis';
  const kayitli = row.yon;
  return kayitli === 'satis' || kayitli === 'alis' ? kayitli : null;
}

export interface FaturaEslemesi {
  /** cha_Guid — yoksa null (rota kendi doküman id'sini üretir). */
  guid: string | null;
  /** mikroFaturalar'a `merge: true` ile yazılacak alanlar. null/undefined DEĞER YOK. */
  doc: Record<string, unknown>;
  yon: FaturaYonu | null;
  /** Bu satırda okunamayan kolon adları (alfabetik) — sayaç ve okuma arızası için. */
  bilinmeyen: string[];
}

/**
 * Bir CARI_HESAP_HAREKETLERI satırını mikroFaturalar dokümanına eşler.
 * `companyId` / `source` / `syncedAt` rotanın işidir (kiracı + sunucu damgası).
 */
export function faturaEsle(row: Record<string, unknown>): FaturaEslemesi {
  const doc: Record<string, unknown> = {};
  const bilinmeyen: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (bilinmiyor(v)) { bilinmeyen.push(k); continue; }
    doc[k] = v;
  }
  const yon = faturaYonu(row);
  if (yon) doc.yon = yon;   // bilinmiyorsa YAZILMAZ: merge:true önceki yönü korur
  const guid = metin(row.cha_Guid).trim();
  return { guid: guid || null, doc, yon, bilinmeyen: bilinmeyen.sort() };
}

export interface FaturaImportOzeti {
  kayitlar: FaturaEslemesi[];
  satis: number;
  alis: number;
  /** Yönü okunamayan fatura sayısı — dokümana `yon` yazılmadı. */
  yonsuz: number;
  /** Kolon adı → kaç satırda okunamadı (tanı amaçlı, tüm kolonlar). */
  bilinmeyenAlan: Record<string, number>;
  /** TÜM satırlarda okunamayan kritik alanlar (≥ OKUMA_ARIZASI_ESIK satırda). */
  okumaArizasi: string[];
  /** Import yanıtının `note` alanı — uyarı en BAŞTA. Söylenecek bir şey yoksa null. */
  not: string | null;
}

/** Satırları eşler ve import özetini (sayaçlar + okuma arızası + not) üretir. */
export function faturalariEsle(rows: readonly Record<string, unknown>[]): FaturaImportOzeti {
  const kayitlar = rows.map(faturaEsle);
  let satis = 0, alis = 0, yonsuz = 0;
  const bilinmeyenAlan: Record<string, number> = {};
  for (const k of kayitlar) {
    if (k.yon === 'satis') satis++; else if (k.yon === 'alis') alis++; else yonsuz++;
    for (const alan of k.bilinmeyen) bilinmeyenAlan[alan] = (bilinmeyenAlan[alan] ?? 0) + 1;
  }

  const okumaArizasi = rows.length >= OKUMA_ARIZASI_ESIK
    ? FATURA_KRITIK_ALANLAR.filter(a => (bilinmeyenAlan[a] ?? 0) === rows.length)
    : [];

  const parcalar: string[] = [];
  const uyari = okumaArizasiUyarisi(okumaArizasi);
  if (uyari) parcalar.push(uyari);
  for (const alan of FATURA_KRITIK_ALANLAR) {
    // cha_tip ayrı cümleyle bildirilir (aşağıda) — iki kez sayma.
    if (alan === 'cha_tip' || okumaArizasi.includes(alan)) continue;
    const n = bilinmeyenAlan[alan] ?? 0;
    if (n > 0) parcalar.push(`${n} satırın ${alan} alanı bilinmiyor`);
  }
  if (yonsuz > 0) parcalar.push(`${yonsuz} faturanın yönü (cha_tip) okunamadı — yön yazılmadı`);

  return { kayitlar, satis, alis, yonsuz, bilinmeyenAlan, okumaArizasi, not: parcalar.join(' · ') || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Faturadan sipariş türetme
// ─────────────────────────────────────────────────────────────────────────────

/** Türetilen siparişin kalemi. Bilinmeyen miktar/tutar `null` — 0 DEĞİL. */
export interface SiparisSatiri {
  sku: string;
  name: string;
  quantity: number | null;
  total: number | null;
}

/** PG aynasından (mikro_stok_hareketleri ⋈ mikro_stoklar) gelen ham kalem satırı. */
export interface PgKalemSatiri {
  seri?: unknown;
  sira?: unknown;
  sku?: unknown;
  ad?: unknown;
  /** sth_miktar — COALESCE(...,0) YOK, null inebilir. */
  miktar?: unknown;
  /** sth_tutar (BRÜT — iskonto açık sorusu için başlık yorumuna bak). */
  tutar?: unknown;
  /** sth_vergi. */
  vergi?: unknown;
}

export interface KalemHaritasi {
  /** `${seri}|${sıra}` → kalemler (2026-08-01 canlı doğrulanan birleştirme anahtarı). */
  harita: Map<string, SiparisSatiri[]>;
  miktarsiz: number;
  tutarsiz: number;
}

/**
 * Kalem satırlarını evrak anahtarına göre gruplar.
 * total = sth_tutar + sth_vergi (KDV dahil satır toplamı) — İKİSİ DE biliniyorsa.
 * Biri bilinmiyorsa `null`: eski SQL `COALESCE(...,0)` ile KDV'siz tutarı toplam
 * sanıyordu ve fark hiçbir yerde görünmüyordu.
 */
export function kalemHaritasi(rows: readonly PgKalemSatiri[]): KalemHaritasi {
  const harita = new Map<string, SiparisSatiri[]>();
  let miktarsiz = 0, tutarsiz = 0;
  for (const row of rows) {
    const anahtar = `${metin(row.seri).trim()}|${metin(row.sira).trim()}`;
    const sku = metin(row.sku);
    const miktarVar = bilinenSayi(row.miktar);
    const toplamVar = bilinenSayi(row.tutar) && bilinenSayi(row.vergi);
    if (!miktarVar) miktarsiz++;
    if (!toplamVar) tutarsiz++;
    const liste = harita.get(anahtar) ?? [];
    liste.push({
      sku,
      name: metin(row.ad) || sku,
      quantity: miktarVar ? Number(row.miktar) : null,
      total: toplamVar ? Number(row.tutar) + Number(row.vergi) : null,
    });
    harita.set(anahtar, liste);
  }
  return { harita, miktarsiz, tutarsiz };
}

export interface SiparisTuretmesi {
  /** `mikrofat__<cid>__<seri>-<sira>` — BİÇİM DEĞİŞMEZ (idempotentlik anahtarı). */
  id: string;
  /** orders dokümanı. `createdAt` YOK: sunucu damgası gerekebilir (bkz. olusturmaTarihi). */
  doc: Record<string, unknown>;
  /** Fatura tarihinden türetilen createdAt ISO metni; tarih okunamadıysa null. */
  olusturmaTarihi: string | null;
  tutarBilinmiyor: boolean;
}

export interface SiparisTuretmeSecenegi {
  companyId: string;
  /** mikro_cari_hesaplar'dan gelen ünvan; yoksa cari koduna, o da yoksa '—'ye düşer. */
  cariUnvan?: string | null;
}

/**
 * Satış faturası başlığından Cetpa siparişi türetir.
 * Evrak sıra no yoksa `null` döner — sipariş UYDURULMAZ (rota `skipped++` sayar).
 */
export function faturadanSiparis(
  baslik: Record<string, unknown>,
  satirlar: readonly SiparisSatiri[],
  opts: SiparisTuretmeSecenegi,
): SiparisTuretmesi | null {
  const seri = metin(baslik.cha_evrakno_seri).trim();
  const sira = metin(baslik.cha_evrakno_sira).trim();
  if (!sira) return null;

  const id = `mikrofat__${opts.companyId}__${seri}-${sira}`.replace(/[/\\ ]/g, '_');
  const tarih = metin(baslik.cha_tarihi).slice(0, 10);
  const cariKod = metin(baslik.cha_kod).trim();
  const tutarVar = bilinenSayi(baslik.cha_meblag);

  const doc: Record<string, unknown> = {
    orderNumber: `MF-${seri}${sira}`,
    customerName: (opts.cariUnvan ?? '') || cariKod || '—',
    mikroCariKod: cariKod,
    customerType: 'B2B',
    status: 'Delivered',              // faturası kesilmiş satış — tamamlanmış kabul
    // Fatura toplamı (KDV dahil). BİLİNMİYORSA ALAN YAZILMAZ (eskiden `?? 0` ile
    // ₺0 yazılıyordu — tutarsız fatura bedava satış sayılıyordu).
    //
    // ⚠️ OKUYAN TARAF TAMAMLANMADI (2026-09-19 delta bulgusu). `siparisTutari`
    // (utils/siparis) bu alanı doğru okuyor ama ONU ÇAĞIRMAYAN yüzeyler var: rapor
    // ekranlarında `reduce((s,o)=>s+o.totalPrice,0)` biçiminde HAM toplama hâlâ
    // duruyor ve tek bir tutarsız sipariş toplamı NaN yapıyor. Kapatılanlar:
    // müşteri ekstresi PDF'i (utils/pdf) ve haftalık rapor e-postası (server/crons).
    // AÇIK: components/reports altı (LojistikRapor, GenelBloklar3/4, IKRapor, CrmBloklar8)
    // — Faz 3'ün rapor sayfası turuna bırakıldı (bkz. açık sorular). Buraya "istemci
    // siparisTutari ile okur" YAZMAYIN: doğru değil, ölçülmesi gereken bir iddiadır.
    ...(tutarVar ? { totalPrice: Number(baslik.cha_meblag) } : {}),
    lineItems: [...satirlar],
    orderDate: tarih || null,
    source: 'mikro-fatura',
    mikroEvrak: { seri, sira },
    // Kaynak zaten kesilmiş bir satış faturası — listede "FATURASIZ" rozeti yanlıştı
    // (2026-09-03 SS bulgusu); ✓ Mikro rozeti evrak no'sunu gösterir.
    faturali: true,
    mikroFaturaNo: `${seri}${sira}`,
    companyId: opts.companyId,
  };

  return {
    id,
    doc,
    // Fatura tarihi sipariş tarihi olarak işlenir (2026-09-01 kullanıcı isteği).
    olusturmaTarihi: tarih ? `${tarih}T12:00:00.000Z` : null,
    tutarBilinmiyor: !tutarVar,
  };
}

export interface SiparisTuretmeSayaci {
  turetilen: number;
  /** totalPrice yazılamayan sipariş sayısı. */
  tutarsiz: number;
  /** cha_tip okunamadığı için satış sayılmayan (atlanan) fatura sayısı. */
  yonsuz: number;
  miktarsizKalem: number;
  tutarsizKalem: number;
  /** PG havuzu yok (lokal dev) — kalemler ve cari adları hiç yüklenmedi. */
  pgYok: boolean;
}

/** Faturadan-sipariş import yanıtının `note` metni. Uyarı en BAŞTA; söylenecek yoksa null. */
export function siparisTuretmeNotu(s: SiparisTuretmeSayaci): string | null {
  const parcalar: string[] = [];
  const tamEksik = s.turetilen >= OKUMA_ARIZASI_ESIK && s.tutarsiz === s.turetilen;
  if (tamEksik) parcalar.push(okumaArizasiUyarisi(['cha_meblag'])!);
  else if (s.tutarsiz > 0) parcalar.push(`${s.tutarsiz} siparişin tutarı bilinmiyor`);
  if (s.yonsuz > 0) parcalar.push(`${s.yonsuz} faturanın yönü (cha_tip) okunamadı — satış sayılmadı`);
  if (s.miktarsizKalem > 0) parcalar.push(`${s.miktarsizKalem} kalemin miktarı bilinmiyor`);
  if (s.tutarsizKalem > 0) parcalar.push(`${s.tutarsizKalem} kalemin tutarı bilinmiyor`);
  if (s.pgYok) parcalar.push('PG yok — kalemler ve cari adları eklenemedi (lokal dev)');
  return parcalar.join(' · ') || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fatura kalemleri (POST /api/mikro/fatura/kalemler)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Birim ADI çözümü (2026-08-31 kullanıcı isteği: "BİRİM'i de ekle").
 *
 * `birim` = **MİKTARIN** birimi. `sth_birim_pntr` (1-3) satırın hangi birimle GİRİLDİĞİNİ söyler, `sth_miktar`'ın
 * hangi birimde SAKLANDIĞINI değil: Mikro miktarı ANA birime çevirip saklar. CANLI ÖLÇÜM (2026-09-19, kullanıcı
 * sunucuda koştu): alış faturası 234, Kalekim 3131 Elastikor 20 kg — ana birim ADET, 2. birim KILOGRAM, işaretçi 2,
 * `sth_miktar = 50`, tutar ₺57.916,66 → ₺1.158,33/birim = KOVA fiyatı (kg fiyatı olamaz). Eski eşleme işaretçinin
 * adını basıyordu → ekranda "50 · KILOGRAM · ₺1.158,33" (Net Birim sütunu eklenince yanlış FİYAT okumasına döndü).
 * Ölçüm tek satır (canlıda işaretçisi ≠ 1 olan başka fatura satırı yok: tip 3'te 1/557, tip 4'te 0/738); Mikro'nun
 * bilinen saklama kuralıyla tutarlı. Aksi bir örnek çıkarsa bu yorum + test güncellenir.
 *
 * `girisBirimi` = satır ana birim DIŞINDA girildiyse o birimin adı (bilgi notu: "KILOGRAM ile girilmiş"); ana
 * birimle aynıysa ya da adı boşsa YAZILMAZ. İşaretçi okunamaz/aralık dışıysa ya da ana birim adı boşsa birim
 * UYDURULMAZ — alan `undefined` kalır (JSON'da hiç görünmez).
 */
export function kalemleriBirimle(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const ad = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return rows.map(rec => {
    const p = bilinenSayi(rec.sth_birim_pntr) ? Number(rec.sth_birim_pntr) : NaN;
    if (!(p >= 1 && p <= 3)) return { ...rec, birim: undefined };
    const anaBirim = ad(rec.sto_birim1_ad);
    const giris = p === 1 ? undefined : ad(rec[`sto_birim${p}_ad`]);
    const farkli = giris !== undefined && giris.toLocaleLowerCase('tr-TR') !== anaBirim?.toLocaleLowerCase('tr-TR');
    return { ...rec, birim: anaBirim, ...(farkli ? { girisBirimi: giris } : {}) };
  });
}

/**
 * "Bu alan hiçbir satırda okunamadı" uyarısı — sessiz sıfır sınıfının import karşılığı.
 * Veri değil ARIZA bildirir: kolon adı değişmiş ya da şema keşfi boş dönmüş olabilir.
 */
export function okumaArizasiUyarisi(alanlar: readonly string[]): string | null {
  if (!alanlar.length) return null;
  return `UYARI: ${alanlar.join(', ')} alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin`;
}
