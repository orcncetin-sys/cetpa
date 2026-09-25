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
import { kalemleriCoz, faturaAnahtari, satirMasrafi, type StokHareketi, type NetKaynagi } from '../../lib/stokFiyat.js';

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

/**
 * MF sipariş kaleminin SÜRÜMÜ. 2 = kaynak kiracının `inventoryMovements`'ı + `lib/stokFiyat` (KDV hariç net, iskonto
 * ayrı — K-KALEM / K-İSKONTO, 2026-09-25). 1 / alan yok = eski PG aynası kalemi: `total` = sth_tutar + sth_vergi
 * (iskonto ÖNCESİ tutar + iskonto SONRASI KDV karışımı). Eski aynası YALNIZ Cetpa→Mikro push'unda doluyordu ve push
 * satırında evrak sırası yoktu → Mikro'da kesilen faturanın siparişi KALEMSİZ kalıyordu (MF-383 kök nedeni).
 */
export const MF_KALEM_SURUMU = 2;

/** Türetilen siparişin kalemi (sürüm 2). Bilinmeyen sayı `null` — 0 DEĞİL. */
export interface SiparisSatiri {
  sku: string;
  name: string;
  quantity: number | null;
  /** NET birim fiyat (KDV hariç, iskonto düşülmüş) = netTutar ÷ miktar — native kalemin `price`ı ile AYNI anlam; eski
   *  `price × quantity` okuyucuları (Envanter raporu, Muhasebe detayı, takip) böylece KDV hariç neti okur (inceleme
   *  2026-09-25: alan yokken NaN/boş görüyorlardı). Miktar 0/bilinmiyor ya da net bilinmiyorsa null. Yuvarlanmaz. */
  price: number | null;
  /** Bu kaynakta birim güvenilir çözülemez (ana birim adı yerel kayıtta yok) → null; 'ADET' UYDURULMAZ. */
  birim: string | null;
  /** KDV hariç, iskonto ÖNCESİ. */
  brutTutar: number | null;
  /** Satır iskontosu + satıra dağıtılmış fatura altı iskonto (brüt − net). */
  iskonto: number | null;
  /** KDV hariç, iskonto düşülmüş — ürün cirosu (K-KALEM). */
  netTutar: number | null;
  /** sth_vergi. */
  kdv: number | null;
  /** Satır masrafları (nakliye vb.): KDV matrahına girer, ürün cirosuna GİRMEZ. Kolon yoksa 0 (lib/stokFiyat satirMasrafi). */
  masraf: number | null;
  /** Net tutarın nasıl belirlendiği (lib/stokFiyat) — 'dogrulanamadi' / 'faturaAltiKdvden' kesin rakam gibi okunmasın. */
  netKaynagi: NetKaynagi | null;
  /** netTutar + kdv (ikisi de biliniyorsa), yoksa null. Eski sürümün karışık rakamı DEĞİL. */
  total: number | null;
  kalemSurumu: number;
}

/**
 * Kiracının `inventoryMovements` dokümanlarından (stok-hareket SQL importu, `source:'mikro_sql'`, iptaller importta
 * elenir) SATIŞ faturası anahtarı → satırlar. Anahtar `seri|sıra` (fatura başlığıyla AYNI); satış = `faturaAnahtari`
 * yön 'giden' (sth_evraktip 4). Başka kaynak (elle girilen hareket, push) karışmaz.
 */
export function satisFaturasiHareketleri(hareketler: readonly Record<string, unknown>[]): Map<string, StokHareketi[]> {
  const harita = new Map<string, StokHareketi[]>();
  for (const h of hareketler) {
    if (h.source !== 'mikro_sql') continue;
    const f = faturaAnahtari(h);
    if (!f || f.yon !== 'giden') continue;
    const k = `${f.seri}|${f.sira}`;
    const liste = harita.get(k) ?? [];
    liste.push(h);
    harita.set(k, liste);
  }
  return harita;
}

export interface MfKalemSonucu {
  kalemler: SiparisSatiri[];
  /** Miktarı okunamayan kalem. */
  miktarsiz: number;
  /** Net tutarı çözülemeyen kalem (tutar yok / iskonto tutarsız). */
  tutarsiz: number;
}

const kurus = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100);
/** `sth_satir_no` (fatura/kalemler rotasının şemadan doğruladığı sıra kolonu) — yoksa ya da okunamazsa sıra korunur. */
const satirNo = (h: StokHareketi): number | null => (bilinenSayi(h.sth_satir_no) ? Number(h.sth_satir_no) : null);

/**
 * Bir satış faturasının satırlarından sipariş kalemleri. Hesap `lib/stokFiyat.kalemleriCoz` (fatura başlığıyla
 * hakemli) — ekrandaki fatura detayı ve Fiyat Karşılaştırma ile AYNI; tutarlar kuruşa yuvarlanır.
 */
export function mfKalemleri(hareketler: readonly StokHareketi[], meblag: unknown, stokAdi: (sku: string) => string | undefined): MfKalemSonucu {
  const sirali = [...hareketler].sort((a, b) => {
    const x = satirNo(a), y = satirNo(b);
    return x !== null && y !== null ? x - y : 0;
  });
  const cozumler = kalemleriCoz(sirali, meblag);
  let miktarsiz = 0, tutarsiz = 0;
  const kalemler = sirali.map((h, i): SiparisSatiri => {
    const c = cozumler[i];
    const sku = metin(h.sth_stok_kod).trim();
    const kdv = bilinenSayi(h.sth_vergi) ? Number(h.sth_vergi) : null;
    const net = kurus(c.net);
    if (c.miktar === null) miktarsiz++;
    if (net === null) tutarsiz++;
    return {
      sku,
      name: stokAdi(sku) || sku,
      quantity: c.miktar,
      price: c.net !== null && c.miktar !== null && c.miktar > 0 ? c.net / c.miktar : null,
      birim: null,
      brutTutar: kurus(c.brut),
      iskonto: kurus(c.iskonto),
      netTutar: net,
      kdv,
      // Masraf satırın KENDİ kolonlarından — netin çözülmesine bağlı değil (ham tablo `kalemSaglamasi` ile AYNI kural).
      masraf: kurus(satirMasrafi(h)),
      netKaynagi: c.kaynak,
      total: net !== null && kdv !== null ? kurus(net + kdv) : null,
      kalemSurumu: MF_KALEM_SURUMU,
    };
  });
  return { kalemler, miktarsiz, tutarsiz };
}

const topla = (k: readonly unknown[], alan: 'netTutar' | 'kdv'): number | null => {
  let t = 0;
  for (const l of k) {
    const v = (l as Record<string, unknown> | null)?.[alan];
    if (!bilinenSayi(v)) return null;
    t += Number(v);
  }
  return Math.round(t * 100) / 100;
};

/**
 * Mevcut MF siparişinin kalemleri yenilenmeli mi: hiç kalem yok, sürüm-2 olmayan kalem var, ya da (verilirse) kaynaktan
 * kurulan kalemler kayıtlıdan FARKLI — kalem sayısı ya da Σ net / Σ KDV kuruş düzeyinde (inceleme 2026-09-25: stok
 * hareketi importu yarıda kalınca kısmi kalem sürüm 2 damgasıyla kalıcı oluyor, bir daha hiç yenilenmiyordu).
 * Sağlamaya BAKILMAZ: tevkifat/ÖTV'li fatura meşru olarak tutmaz.
 */
export function kalemYenilenmeli(lineItems: unknown, kaynak?: readonly SiparisSatiri[]): boolean {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return true;
  if (lineItems.some(l => !l || typeof l !== 'object' || (l as { kalemSurumu?: unknown }).kalemSurumu !== MF_KALEM_SURUMU)) return true;
  if (!kaynak) return false;
  if (kaynak.length !== lineItems.length) return true;
  return topla(kaynak, 'netTutar') !== topla(lineItems, 'netTutar') || topla(kaynak, 'kdv') !== topla(lineItems, 'kdv');
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
  /** Stok hareketi (inventoryMovements) bulunamayan fatura — sipariş kalemsiz yazıldı. */
  kalemKaynagiYok: number;
  /** PG havuzu yok (lokal dev) — cari adları yüklenmedi. */
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
  if (s.kalemKaynagiYok > 0) parcalar.push(`${s.kalemKaynagiYok} faturanın stok hareketi yok — kalemsiz yazıldı (önce "Stok Hareketleri"ni çekin)`);
  if (s.pgYok) parcalar.push('PG yok — cari adları eklenemedi (lokal dev)');
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
