/**
 * eslemeVarlik.ts — Mikro'dan OKUNAN varlık eşlemeleri, saf fonksiyon olarak
 * (Faz 3 3/n, grup "eslemeVarlik", 2026-09-19). Ağ/DB/express YOK; test: eslemeVarlik.test.ts.
 *
 * NEDEN VAR — dört import rotasında "bilinmeyen sayı 0 yazılır" siteleri:
 *
 *   • mikroRoutes.ts ~2347-2360 (/api/mikro/import/demirbas)
 *       alisBedeli:  bedel ? Number(r[bedel]) || 0 : 0
 *       faydaliOmur: omur  ? Number(r[omur])  || 0 : 0
 *       birikmisSalinma: Number(eski?.birikmisSalinma) || 0
 *       alisTarihi:  tarih ? String(r[tarih] ?? '').slice(0, 10) : ''
 *   • mikroRoutes.ts ~2420-2432 (/api/mikro/import/maliyet-merkezi)  aktif: true
 *   • mikroRoutes.ts ~3244-3258 (/api/mikro/pull/personel)
 *       tcId: ... || null · salary: 0 (yeni kayıt) · status: ... || 'Aktif'
 *   • mikroRoutes.ts ~3330-3334 (/api/mikro/pull/uretim-receteleri)
 *       quantity: miktarK ? Number(r[miktarK]) || 0 : 0
 *
 * Bunların hepsi GEÇERLİ görünen kayıt üretir, bu yüzden sessizdir:
 *   `alisBedeli: 0`   → amortisman tablosu her demirbaş için ₺0 yazar (SabitKiymetModule
 *                       calcYillikAmort alisBedeli/faydaliOmur okuyor); "amortisman yok"
 *                       ile "bedeli bilmiyoruz" ayırt edilemez hâle gelir.
 *   `faydaliOmur: 0`  → aynı ekranda ömür 0 yıl; azalan bakiyelerde 2/0 = Infinity.
 *   `quantity: 0`     → "0 çuval çimento" reçetesi; üretim planı hiç malzeme istemez.
 *   `salary: 0`       → bordro/maaş toplamı sessizce eksik.
 *   `status: 'Aktif'` → İK'nın elle 'Pasif'e aldığı personel HER senkronda dirilir.
 *   `aktif: true`     → kullanıcının pasife aldığı maliyet merkezi HER senkronda dirilir.
 *   `tcId: null`      → elle girilen TC kimlik numarası senkronda silinir.
 *
 * KURAL (CLAUDE.md, Faz 3): Mikro'dan OKUYAN eşlemede bilinmeyen sayı 0 YAZILMAZ ve
 * `null` YAZILMAZ — alan HİÇ yazılmaz; `merge:true` mevcut değeri korur (bayat değer,
 * silinmiş değerden iyidir). Yazılmayan her alan `bilinmeyen` listesine girer, rota
 * sayacı `note`'a ekler. Bir KRİTİK alan satırların TAMAMINDA (≥5 satırlık importta)
 * bilinmiyorsa bu veri değil OKUMA ARIZASIDIR (kolon adı değişmiş / şema keşfi boş dönmüş):
 * `okumaArizasi()` onu ilan eder, rota `note`'un BAŞINA uyarı yazar ve `console.warn` basar.
 * Arıza taraması YALNIZ kritik kümelerde yapılır (`DEMIRBAS_KRITIK` vb.) — meşru olarak
 * boş kalabilen alanlar (personelde e-posta/TC/maaş, reçetede birim) her senkronda
 * yanlış alarm üretiyordu (2026-09-19 hakem bulgusu).
 *
 * BİLİNÇLİ İSTİSNALAR (parite, hepsi test edilmiş):
 *   • `ad` boşsa Mikro KODUNA düşer — kod bilinen bir değerdir, uydurma değil; ekran
 *     boş satır göstermesin.
 *   • `kategori`/`durum`/`amortYontemi`/`paraBirimi`/`departman` UI SÖZLÜK ANAHTARLARI:
 *     SabitKiymetModule KATEGORI_CFG[kategori].icon / DURUM_CFG[durum].bg okuyor, fallback
 *     YOK — eksikse ekran ilk satırda TypeError ile çöker. Bu yüzden YENİ kayıtta
 *     varsayılan yazılır; VAR OLAN kayıtta kullanıcı değeri aynen korunur.
 *   • Personelde email/phone/department/position/startDate YENİ kayıtta '' — HRModule
 *     arama filtresi `e.position.toLowerCase()` çağırıyor (fallback yok).
 *   • `birikmisSalinma: 0` YENİ kayıtta gerçek bir başlangıç değeridir (Cetpa'da henüz
 *     amortisman işlenmedi), Mikro'dan okunan bir sayı değil.
 *   • Mikro GERÇEKTEN 0 yazdıysa 0 yazılır — bilinen sıfır ≠ bilinmeyen (`bilinenSayi`).
 *
 * BİLİNÇLİ FARK (parite değil, düzeltme): tarih alanları artık `String(x).slice(0, 10)`
 * yerine `gunAnahtari` (utils/zaman.ts, TEK KAYNAK) ile çözülür. Sürücü `Date` nesnesi
 * döndürdüğünde eski kod "Mon Mar 15" gibi çöp bir metin yazıyordu; TR biçimi `15.03.2024`
 * ise olduğu gibi kaydediliyordu. Çözülemeyen tarih artık YAZILMAZ (eskiden '' ile elle
 * girilen tarihi siliyordu).
 *
 * KOLON ADI TAHMİN EDİLMEZ: bu modül kolon ADI çözmez — rota `kolonSec`/`kolonBul`
 * (src/lib/mikroKolon.ts, mikroClient) ile şemadan çözer ve çözülmüş adları buraya
 * geçirir; `null` = "o kolon şemada bulunamadı".
 */
import { bilinenSayi } from '../../utils/para.js';
import { gunAnahtari } from '../../utils/zaman.js';

// ── Ortak ────────────────────────────────────────────────────────────────────

/** Bir satırın eşleme çıktısı: yazılacak alanlar + bu satırda BİLİNMEYEN alan adları. */
export interface EslemeSonucu {
  /** `batch.set(..., { merge: true })`'e verilecek alanlar. Bilinmeyen alan HİÇ yok. */
  alanlar: Record<string, unknown>;
  /** Bu satırda Mikro'dan okunamayan alanlar (rota sayacı bunları toplar). */
  bilinmeyen: string[];
}

/** İçinde `bilinmeyen` taşıyan her sonuç özete girebilir (reçete sonucu ayrı şekilde). */
export interface BilinmeyenTasiyan { bilinmeyen: readonly string[] }

/** İmport boyunca biriken sayaç: kaç satır işlendi, hangi alan kaç satırda bilinmiyordu. */
export interface EslemeOzeti {
  satir: number;
  /** alan → bilinmeyen satır sayısı. Anahtar sırası ilk görülme sırasıdır (deterministik not). */
  sayac: Record<string, number>;
}

export function ozetBaslat(): EslemeOzeti {
  return { satir: 0, sayac: {} };
}

/** Sonucu sayaca ekler ve AYNI sonucu döndürür (zincirleme çağrı için). */
export function ozetEkle<T extends BilinmeyenTasiyan>(ozet: EslemeOzeti, sonuc: T): T {
  ozet.satir++;
  for (const alan of sonuc.bilinmeyen) ozet.sayac[alan] = (ozet.sayac[alan] ?? 0) + 1;
  return sonuc;
}

/**
 * KRİTİK alan kümeleri — okuma arızası YALNIZ burada aranır.
 *
 * 2026-09-19 hakem bulgusu: arıza taraması sayaçtaki TÜM alanları aday sayıyordu ve
 * MEŞRU olarak boş kalabilen alanlar (personelde e-posta/telefon/TC/maaş, reçetede
 * birim, demirbaşta Mikro grup kodu) her senkronda "UYARI: … kolon adı/şema kontrol
 * edin" üretiyordu. Kalıcı yanlış alarm, gerçek arıza kapısını değersizleştirir —
 * `eslemeFatura` aynı sınıfı `cha_evrakno_seri`yi kritik listeye ALMAYARAK önlemişti
 * (o kurulumda seri meşru olarak boş). Kritik alan = boşluğu ancak kolon adının
 * değişmesiyle / şema keşfinin boş dönmesiyle açıklanabilen alan.
 */
/** Demirbaş: `kategori` YOK — Mikro grup kodu bu sözlükle birebir eşleşmez, 'Diğer' meşru yedeği. */
export const DEMIRBAS_KRITIK = ['ad', 'alisTarihi', 'alisBedeli', 'faydaliOmur'] as const;
export const MALIYET_MERKEZI_KRITIK = ['ad'] as const;
/** Personel: geri kalan her alan (e-posta/telefon/TC/maaş/departman…) meşru olarak boş olabilir. */
export const PERSONEL_KRITIK = ['name'] as const;
/** Reçete: `unit` YOK — birim boş bırakılmış olabilir, '' bir ölçü uydurması değil. */
export const RECETE_KRITIK = ['productSku', 'componentSku', 'quantity'] as const;

/**
 * TÜM satırlarda bilinmeyen KRİTİK alanlar = okuma arızası (kolon adı/şema sorunu),
 * veri değil. `esik` altındaki küçük importlarda ilan edilmez: 2 satırın ikisinde de
 * boş olması kolonun yanlış çözüldüğünün kanıtı değildir.
 *
 * `kritikAlanlar` ZORUNLUDUR (hakem önerisinde üçüncü, isteğe bağlı parametreydi):
 * unutulabilen bir süzgeç yanlış alarmı sessizce geri getirirdi — eksik bırakan
 * çağrı artık DERLENMEZ. Sıra çağıranın verdiği kritik liste sırasıdır (deterministik
 * not; raporKdvMizan'daki `alanSirasi` ile aynı yaklaşım).
 */
export function okumaArizasi(
  ozet: EslemeOzeti,
  kritikAlanlar: readonly string[],
  esik = 5,
): string[] {
  if (ozet.satir < esik) return [];
  return kritikAlanlar.filter(alan => ozet.sayac[alan] === ozet.satir);
}

/** `note`'un BAŞINA yazılacak uyarı. Arıza yoksa ''. */
export function okumaArizasiUyarisi(arizalar: readonly string[]): string {
  if (!arizalar.length) return '';
  const cogul = arizalar.length > 1 ? 'alanları' : 'alanı';
  return `UYARI: ${arizalar.join(', ')} ${cogul} hiçbir satırda okunamadı — kolon adı/şema kontrol edin.`;
}

/**
 * `note`'a eklenecek sayaç metni: "3 satırın alisBedeli alanı bilinmiyor; …". Yoksa ''.
 * `arizalar` zaten uyarı cümlesinde geçtiği için burada ATLANIR — aynı alan yoksa
 * notta üç kez (uyarı + sayaç + yanıt alanı) görünürdü. Parametre ZORUNLU: eslemeCari
 * ve raporKdvMizan bu dışlamayı modül içinde yapıyor, burada çağıran yapar.
 */
export function bilinmeyenNotu(ozet: EslemeOzeti, arizalar: readonly string[]): string {
  const arizaSeti = new Set(arizalar);
  return Object.entries(ozet.sayac)
    .filter(([alan]) => !arizaSeti.has(alan))
    .map(([alan, n]) => `${n} satırın ${alan} alanı bilinmiyor`)
    .join('; ');
}

/** Satırdan kod/metin oku: kolon çözülmediyse (null) ya da değer yoksa ''. */
export function mikroKod(row: Record<string, unknown>, kolon: string | null): string {
  if (!kolon) return '';
  return String(row[kolon] ?? '').trim();
}

/** Bilinen sonlu sayıyı döndürür; bilinmiyorsa null (0 BİLİNEN bir değerdir). */
function sayiOku(row: Record<string, unknown>, kolon: string | null): number | null {
  if (!kolon) return null;
  const ham = row[kolon];
  return bilinenSayi(ham) ? Number(ham) : null;
}

// ── Demirbaş (/api/mikro/import/demirbas → sabitKiymetler) ───────────────────

/**
 * Şemadan ÇÖZÜLMÜŞ kolon adları (rota `kolonSec` ile bulur). `null` = şemada yok.
 *
 * 2026-08-11 CANLI BULGU: beklenen önek `dbs_` DEĞİL `dem_` çıktı. Kesin bilinen
 * kolonlar: dem_Guid, dem_kod, dem_isim, dem_aciklama, dem_firmano, dem_subeno.
 * Alış tarihi/bedeli/ömür/grup 135 kolonun görünmeyen kısmında — adları HÂLÂ
 * bilinmiyor, tahmin EDİLMEZ; bulunamazsa alan yazılmaz (ham satır `mikroHam`'da durur).
 */
export interface DemirbasKolonlari {
  kod: string;
  ad: string | null;
  tarih: string | null;
  bedel: string | null;
  omur: string | null;
  grup: string | null;
}

/**
 * SabitKiymetModule.tsx sözlük araması yapıyor — fallback YOK:
 * KATEGORI_CFG[kategori].icon (satır 262). Mikro grup kodu ham metin (örn. "MK-01")
 * ve bu kümeyle BİREBİR eşleşmiyor (farklı sözlük), o yüzden UYDURULMAZ: geçerli
 * değilse 'Diğer'e düşer, ham Mikro değeri `mikroGrupKodu`'nda saklanır.
 */
export const DEMIRBAS_KATEGORI_GECERLI: ReadonlySet<string> =
  new Set(['Taşıt', 'Makine', 'Bilgisayar', 'Mobilya', 'Bina', 'Diğer']);

/**
 * Mikro DEMIRBASLAR satırı → `sabitKiymetler` dokümanı.
 * `eski`: aynı docId'de VAR OLAN doküman verisi (yoksa undefined = yeni kayıt).
 * `companyId` / `mikroSyncedAt` rotada eklenir (saf olmayan alanlar).
 */
export function demirbasEsle(
  row: Record<string, unknown>,
  kolonlar: DemirbasKolonlari,
  eski?: Record<string, unknown>,
): EslemeSonucu {
  const bilinmeyen: string[] = [];
  const kod = mikroKod(row, kolonlar.kod);
  const adHam = mikroKod(row, kolonlar.ad);
  const grupHam = mikroKod(row, kolonlar.grup);
  if (!adHam) bilinmeyen.push('ad');

  const alanlar: Record<string, unknown> = {
    demirbasNo: kod,
    // Ad bilinmiyorsa KOD yazılır — kod bilinen bir değer, uydurma değil.
    ad: adHam || kod,
    // UI sözlük anahtarı: var olan kullanıcı değeri korunur, yoksa Mikro grubu
    // ancak GEÇERLİ ise kullanılır. (`||` parite: eski '' de yedeğe düşer.)
    kategori: (eski?.kategori as string) || (DEMIRBAS_KATEGORI_GECERLI.has(grupHam) ? grupHam : 'Diğer'),
    mikroGrupKodu: grupHam,          // ham Mikro grup kodu — kategori eşleşmese de kaybolmasın
    // UI SÖZLÜK ANAHTARLARI — eksikse ekran çöker (KategoriBadge/DurumBadge fallback'siz).
    // Yeni kayıtta varsayılan; mevcut kayıtta kullanıcı değeri korunur.
    durum:        (eski?.durum as string) ?? 'Aktif',
    amortYontemi: (eski?.amortYontemi as string) ?? 'Doğrusal',
    paraBirimi:   (eski?.paraBirimi as string) ?? 'TRY',
    departman:    (eski?.departman as string) ?? '',
    mikroHam: row,                   // eşleme eksikse veri yine de durur
    source: 'mikro_import',
  };
  if (!grupHam) bilinmeyen.push('kategori');

  // Tarih: çözülemezse YAZILMAZ ('' elle girilen tarihi siliyordu).
  const gun = kolonlar.tarih ? gunAnahtari(row[kolonlar.tarih]) : null;
  if (gun) alanlar.alisTarihi = gun;
  else bilinmeyen.push('alisTarihi');

  // Alış bedeli: 0 YAZILMAZ — amortisman 0 bedelden hesaplanmasın.
  const bedel = sayiOku(row, kolonlar.bedel);
  if (bedel !== null) alanlar.alisBedeli = bedel;
  else bilinmeyen.push('alisBedeli');

  // Faydalı ömür: 0 YAZILMAZ — 0 ömür "hemen tamamen amortismana tabi" demektir.
  const omur = sayiOku(row, kolonlar.omur);
  if (omur !== null) alanlar.faydaliOmur = omur;
  else bilinmeyen.push('faydaliOmur');

  // Birikmiş amortisman Mikro'dan OKUNMAZ. Yeni kayıtta 0 gerçek başlangıç değeridir;
  // var olan kayıtta DOKUNULMAZ — eski `Number(eski?.birikmisSalinma) || 0` elle girilmiş
  // '12.500,50' gibi bir değeri NaN üzerinden 0'a çeviriyordu (sessiz veri kaybı).
  if (!eski) alanlar.birikmisSalinma = 0;

  return { alanlar, bilinmeyen };
}

// ── Maliyet merkezi (/api/mikro/import/maliyet-merkezi → maliyetMerkezleri) ──

export interface MaliyetMerkeziKolonlari { kod: string; ad: string | null }

/**
 * Mikro SORUMLULUK_MERKEZLERI satırı → `maliyetMerkezleri` dokümanı.
 * `aktif` Mikro'dan OKUNMUYOR (35 kolonun gerçek adları hâlâ görülmedi, tahmin edilmez):
 * yalnız YENİ kayıtta `true` yazılır. Eskiden koşulsuz `aktif: true` yazılıyordu ve
 * MaliyetMerkeziModule'den pasife alınan merkez her senkronda diriliyordu.
 */
export function maliyetMerkeziEsle(
  row: Record<string, unknown>,
  kolonlar: MaliyetMerkeziKolonlari,
  eski?: Record<string, unknown>,
): EslemeSonucu {
  const bilinmeyen: string[] = [];
  const kod = mikroKod(row, kolonlar.kod);
  const adHam = mikroKod(row, kolonlar.ad);
  if (!adHam) bilinmeyen.push('ad');

  const alanlar: Record<string, unknown> = {
    kod,
    ad: adHam || kod,
    mikroHam: row,
    source: 'mikro_import',
  };
  if (!eski) alanlar.aktif = true;
  return { alanlar, bilinmeyen };
}

// ── Personel (/api/mikro/pull/personel → employees) ──────────────────────────

/**
 * Mikro PERSONEL_TANIMLARI satırı (SELECT'te ALIAS'lanmış: mikroPersKod/name/surname/…)
 * → `employees` dokümanı. `yeniKayit`: bu docId koleksiyonda YOK.
 *
 * SATIR BAZLI BOŞALTMA guard'ı korunuyor: kolon şemada bulunsa bile o personelin
 * Mikro kaydında alan boşsa (çok normal), `String(undefined ?? '').trim()` boş string
 * üretip İK'nın Cetpa'da elle girdiği değeri her senkronda siliyordu.
 */
export function personelEsle(row: Record<string, unknown>, yeniKayit: boolean): EslemeSonucu {
  const bilinmeyen: string[] = [];
  const kod = mikroKod(row, 'mikroPersKod');
  const ad = mikroKod(row, 'name');
  const soy = mikroKod(row, 'surname');

  // Ad/soyadın İKİSİ de boşsa personel koduna düşer (parite) — ama bu personelin
  // KRİTİK alanıdır: her satırda boşsa okunan kolon yanlıştır (PERSONEL_KRITIK).
  if (!ad && !soy) bilinmeyen.push('name');

  const alanlar: Record<string, unknown> = {
    mikroPersKod: kod,
    name: [ad, soy].filter(Boolean).join(' ') || kod,
    source: 'mikro_import',
  };

  // Metin alanları: Mikro'da değer VARSA yazılır; yoksa YENİ kayıtta '' (HRModule
  // `e.position.toLowerCase()` çağırıyor, fallback yok), var olan kayıtta hiç dokunulmaz.
  const metin = (alan: string, anahtar: string): void => {
    const v = mikroKod(row, anahtar);
    if (v) { alanlar[alan] = v; return; }
    bilinmeyen.push(alan);
    if (yeniKayit) alanlar[alan] = '';
  };
  metin('email', 'email');
  metin('phone', 'phone');
  metin('department', 'department');
  metin('position', 'position');

  // İşe giriş tarihi — gün anahtarı (TEK KAYNAK); çözülemezse yazılmaz.
  const gun = gunAnahtari(row.startDate);
  if (gun) alanlar.startDate = gun;
  else { bilinmeyen.push('startDate'); if (yeniKayit) alanlar.startDate = ''; }

  // TC kimlik: bilinmiyorsa `null` YAZILMAZ — elle girilen TC senkronda silinmesin.
  const tc = mikroKod(row, 'tcId');
  if (tc) alanlar.tcId = tc;
  else bilinmeyen.push('tcId');

  // Maaş: bilinmiyorsa YENİ kayıtta bile 0 YAZILMAZ (paraYaz undefined'ı '—' basar;
  // 0 ise "maaşı sıfır" iddiasıdır). 0'ın kendisi de bilinmeyen sayılır — parite:
  // eski kod da `sal > 0` arıyordu (Mikro maaş alanını boş bırakınca 0 döndürüyor).
  const sal = row.salary;
  if (bilinenSayi(sal) && Number(sal) > 0) alanlar.salary = Number(sal);
  else bilinmeyen.push('salary');

  // Durum: Mikro'nun bilinen tek eşleşmesi çevrilir, gerisi AYNEN korunur. Bilinmiyorsa
  // YENİ kayıtta 'Aktif' (UI sözlük anahtarı), VAR OLAN kayıtta YAZILMAZ — İK'nın
  // elle 'Pasif'e aldığı personel her senkronda dirilmesin.
  const durum = mikroKod(row, 'status');
  const durumCevrilen = durum === '0' || durum.toLowerCase() === 'aktif' ? 'Aktif' : durum;
  if (durumCevrilen) alanlar.status = durumCevrilen;
  else { bilinmeyen.push('status'); if (yeniKayit) alanlar.status = 'Aktif'; }

  return { alanlar, bilinmeyen };
}

// ── Üretim reçetesi (/api/mikro/pull/uretim-receteleri → bom) ────────────────

/**
 * Şemadan çözülmüş STOK_URETIM_RECETELERI kolonları. Rota `ana === alt` çakışmasında
 * İKİSİNİ DE null'lar (yanlış reçete göstermektense hiç gösterme) — o guard rotada kalır.
 */
export interface ReceteKolonlari {
  ana: string | null;
  alt: string | null;
  miktar: string | null;
  birim: string | null;
}

/** Tek reçete satırının bileşeni. `quantity` YOKSA miktar bilinmiyordur (0 değil). */
export interface ReceteKalemi {
  sku: string;
  unit: string;
  quantity?: number;
}

export interface ReceteSatirSonucu {
  /** Ana (mamul) stok kodu — gruplama anahtarı. Çözülemezse ''. */
  ana: string;
  /** Ana ya da bileşen kodu yoksa satır anlamsızdır → null (rota `continue` eder). */
  kalem: ReceteKalemi | null;
  bilinmeyen: string[];
}

export function receteKalemiEsle(
  row: Record<string, unknown>,
  kolonlar: ReceteKolonlari,
): ReceteSatirSonucu {
  const bilinmeyen: string[] = [];
  const ana = mikroKod(row, kolonlar.ana);
  const alt = mikroKod(row, kolonlar.alt);
  if (!ana) bilinmeyen.push('productSku');
  if (!alt) bilinmeyen.push('componentSku');
  if (!ana || !alt) return { ana, kalem: null, bilinmeyen };

  // Birim: '' bir ÖLÇÜ UYDURMASI değil (uydurma olan 'adet' yazmak olurdu), o yüzden
  // parite korunuyor; yine de sayaca girer ki kolon hiç çözülmediyse fark edilsin.
  const unit = mikroKod(row, kolonlar.birim);
  if (!unit) bilinmeyen.push('unit');

  const kalem: ReceteKalemi = { sku: alt, unit };
  // Miktar: bilinmiyorsa anahtar HİÇ yazılmaz — "0 çuval çimento" reçetesi üretilmesin.
  const miktar = sayiOku(row, kolonlar.miktar);
  if (miktar !== null) kalem.quantity = miktar;
  else bilinmeyen.push('quantity');

  return { ana, kalem, bilinmeyen };
}

/**
 * `bom.components[]` elemanı. BOMPanel.tsx tek doküman/ürün + içinde `components`
 * dizisi bekliyor; `merge:true` dizi İÇİNİ korumaz, bu yüzden bilinmeyen miktar
 * burada da `undefined` olarak DEĞİL, anahtarın kendisi yazılmayarak temsil edilir
 * (JSON'a `"quantity": null` sızmasın).
 */
export function receteBilesen(
  kalem: ReceteKalemi,
  urun?: { id: string; name: string },
): Record<string, unknown> {
  const bilesen: Record<string, unknown> = {
    inventoryId: urun?.id || '',
    name: urun?.name || kalem.sku,
    sku: kalem.sku,
    unit: kalem.unit,
  };
  if (kalem.quantity !== undefined) bilesen.quantity = kalem.quantity;
  return bilesen;
}
