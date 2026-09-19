/**
 * raporKdvMizan.ts — Mikro'dan OKUNAN KDV özeti ve mizan satırlarının Cetpa
 * `taxSummary` / `accountingPeriods` dokümanlarına eşlenmesi.
 * SAF: ağ, DB, express yok (Faz 3 3/n, grup "raporKdvMizan", 2026-09-19).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * İki rota da BEYANA giden rakam üretiyor (KDV özeti, mizan) ve ikisinde de
 * "okunamayan sayıyı 0 say" kalıbı vardı. Mikro okuması geçici bozulduğunda
 * (kolon adı sürümle değişti — `cha_vergi`/`cha_ettn` üç kez sessizce öldü;
 * `SUM()` tüm değerler NULL'ken NULL döner) bu kalıp "hata" değil "sıfır"
 * üretir: iş başarılı görünür, rakam yanlıştır. Sessiz-sıfır arıza sınıfı.
 *
 * Kaldırılan sahte-varsayılan siteleri (mikroRoutes.ts, 2026-09-19 ölçümü):
 *   • ~3116 `const kdv = Number(r.kdv ?? 0)` → SUM(sth_vergi) NULL dönünce oran
 *       kovası ₺0 KDV ile kırılıma giriyordu. Alttaki `if (!Number.isFinite(kdv))
 *       continue` kapısı FİİLEN ÖLÜYDÜ: `?? 0` zaten sonlu bir sayı üretiyor,
 *       kapı yalnız 'abc' gibi çöp metinlerde devreye giriyordu.
 *   • ~3117 `r.matrah === undefined ? null : Number(r.matrah)` → `undefined`
 *       korunuyordu ama NULL matrah `Number(null) === 0` ile ₺0 MATRAH oluyordu;
 *       çöp metin ise NaN olarak dokümana yazılıyordu.
 *   • ~3118 `const cikis = Number(r.tip) === 1` → yön okunamayan satır NaN→false
 *       ile ALIŞ sayılıp İNDİRİLECEK KDV'ye ekleniyordu. En pahalı varsayım:
 *       ödenecek KDV olduğundan az görünür.
 *   • ~3147 `.reduce((acc, k) => acc + (k.matrah || 0), 0)` → istemcide gösterilen
 *       KDV matrahı, okunamayan kovaları ₺0 sayıp OLDUĞUNDAN AZ çıkıyordu.
 *   • ~4471-4474 mizan `Number(r.borc ?? 0)` / `Number(r.alacak ?? 0)` ve bunlardan
 *       türetilen `bakiye` → okunamayan hesap "hareketsiz" görünüyordu; dahası
 *       aşağıdaki ÇİFT TARAFLI KAYIT DENETİMİ (borç toplamı = alacak toplamı)
 *       iki tarafı da 0 sayılan satırlarla TUTUYOR ve eksik mizan "doğrulanmış"
 *       diye yazılıyordu. Çöp metin gelirse `bakiye` NaN olarak dokümana giriyordu.
 *
 * ── PARİTE ──────────────────────────────────────────────────────────────────
 * BİLİNEN girdide kırılım satırları, toplamlar, mizan satırları ve dengesizlik
 * mesajı bugünküyle BİREBİR aynıdır; `raporKdvMizan.test.ts` `toEqual` ile kilitler.
 * Davranış yalnız BİLİNMEYEN girdide değişir.
 *
 * ── BİLİNÇLİ FARKLAR (bilinen girdide görünmez) ─────────────────────────────
 *  1. KDV'si ya da YÖNÜ okunamayan satır kırılıma HİÇ girmez (₺0'lık sahte kova
 *     yerine sayaç). Matrahı okunamayan satır kırılımda KALIR, `matrah: null` ile
 *     — o satırın KDV'si gerçek bir rakamdır, atmak bilgi kaybı olurdu. Dizi alanı
 *     `merge:true` ile korunmaz (dizi bütün olarak değişir), bu yüzden burada
 *     "alanı hiç yazma" yerine `null` doğru gösterimdir: 0 yalan, null bilinmiyor.
 *  2. Mizan: borç/alacak bilinmiyorsa `null`, `bakiye` de `null` (NaN yazılmaz).
 *     Tutarı okunamayan SATIR VARSA mizanın tamamı YAZILMAZ (`mizanToplami.hata`) —
 *     eksik bir mizan, yok bir mizandan daha tehlikelidir ve denge denetimi
 *     böyle bir tabloda hiçbir şey ispat etmez. Rotanın mevcut iki "dur" kapısıyla
 *     (satır yok / denge tutmuyor) aynı çizgide, üçüncü kapı.
 *  3. Boş metin (`''`) ve yalnız boşluk BİLİNMEYENDİR (`Number('') === 0` tuzağı).
 *     Gerçek ₺0 (sayı olarak 0) bilinen bir cevaptır, sayaca girmez.
 *  4. Bir alan satırların TAMAMINDA (≥ ARIZA_ESIGI satır) okunamıyorsa bu veri
 *     değil OKUMA ARIZASIDIR: `okumaArizasi` döner, rota notun BAŞINA uyarı yazar
 *     + `console.warn` basar.
 *
 * ── MATRAH TANIMI: AÇIK SORU, DEĞİŞTİRİLMEDİ ────────────────────────────────
 * KDV sorgusundaki `SUM(sth_tutar) AS matrah` iskontolu faturada ŞİŞİK olabilir
 * (2026-09-18, canlı teyit bekliyor — bkz. Karar Defteri "Mikro iskonto / net tutar").
 * Bu modül matrahın NE OLDUĞUNU değiştirmez; yalnız "okunamadı → 0" zorlamasını
 * kaldırır. Net tutar gerekirse src/lib/stokFiyat.ts (satirTutarlari/kalemleriCoz)
 * kullanılır — burada kopya hesap YAZILMAZ.
 *
 * ── TAŞINAN CANLI DOĞRULAMA NOTLARI (rotadan) ───────────────────────────────
 * • KDV kaynağı 2026-07-31'de İKİNCİ KEZ yeniden yazıldı: önce `KdvOzetV2` (V17'de
 *   YOK → sıfır yazıyordu), sonra muhasebe hesapları (191/391) denendi — ama bu
 *   kurulumda MUHASEBE_FISLERI BOŞ. Doğru kaynak STOK_HAREKETLERI: `sth_vergi`
 *   her satırın GERÇEK KDV tutarını taşır. Ürün kartındaki orandan hesaplamak
 *   YANLIŞ olurdu; gelen faturalarda satır satır farklı oran olabilir (kullanıcı
 *   2026-07-31'de özellikle belirtti). `sth_tip`: 0 = giriş (alış → indirilecek),
 *   1 = çıkış (satış → hesaplanan).
 * • KDV özeti bir TÜRETME'dir: tevkifat, iade, devreden ve ÖTV/OİV beyannamede
 *   ayrıca işlenir, bu özet onları KAPSAMAZ. Yanıt ve kayıt bunu açıkça söyler.
 * • Oran işaretçisi YÜZDE DEĞİLDİR: `sth_vergi_pntr` bir sıra numarasıdır, gerçek
 *   yüzdeye `mikroVergiOranlari()` tablosundan TERS arama ile çevrilir
 *   (`vergiOraniCoz`). Çözülemezse sabit bir oran UYDURULMAZ → null + sayaç.
 * • Mizan 2026-07-30'da yeniden yazıldı: eski hâli `MizanV2` çağırıyordu, o metot
 *   V17'de YOK. Mikro'da ayrı borç/alacak kolonu da YOK: `fis_meblag0` İŞARETLİ
 *   tutulur (borç +, alacak −); MUHASEBE_FISLERI_OZET'teki mfo_Grp0_B_Meblag /
 *   mfo_Grp0_A_Meblag ayrımı bu kuralı bağımsız olarak doğruluyor.
 * • ÇİFT TARAFLI KAYIT DENETİMİ: mizan tanımı gereği borç toplamı alacak toplamına
 *   EŞİT olmalıdır. Tutmuyorsa işaret varsayımı ya da grup seçimi yanlış demektir;
 *   yanlış mizan yazmaktansa dur. Eşik `Math.max(1, toplam * 0,0001)` — kuruş
 *   yuvarlamasına takılmamak için, ondan büyüğüne göz yummamak için.
 */
import { bilinenSayi, toplaBilinen, ekranTutari } from '../../utils/para.js';

/** Bir alanın "hiçbir satırda okunamadı" sayılması için gereken en az satır sayısı.
 *  Altında iddia edilmez: 3 hesaplı bir dönemde hepsinin boş olması normaldir. */
export const ARIZA_ESIGI = 5;

type Satir = Record<string, unknown>;

/** Metin değeri: kırpılmış string; boş/boşluk/nesne → null (= bilinmiyor). */
function metin(x: unknown): string | null {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t === '' ? null : t;
}

/** Bilinen sonlu sayı ya da null — `?? 0` / `|| 0` yerine TEK kapı. */
function sayi(x: unknown): number | null {
  return bilinenSayi(x) ? Number(x) : null;
}

// ── Ortak özet (sayaç + okuma arızası + not) ─────────────────────────────────
export interface RaporOzeti {
  /** Alan adı → o alanın bilinmediği satır sayısı. */
  sayac: Record<string, number>;
  /** Satırların TAMAMINDA okunamayan alanlar (≥ ARIZA_ESIGI satır varsa). */
  okumaArizasi: string[];
  /** Yanıtın `note`'una eklenecek Türkçe cümle; eksik yoksa ''. */
  not: string;
  /** Değerlendirilen satır sayısı. */
  satir: number;
}

/**
 * `bilinmeyen` listelerinden özet kurar. Sıra: önce arıza uyarıları, sonra sayaçlar.
 * NOT (2026-09-19): aynı yardımcı eslemeCari/eslemeFatura/eslemeVarlik'ta da var —
 * dört grup paralel yazıldı. Birleştirme açık sorulara yazıldı; şimdi birleştirmek
 * hâlâ inmemiş kardeş modüllere bağımlılık kurardı.
 */
function ozetKur(bilinmeyenListeleri: readonly (readonly string[])[], alanSirasi: readonly string[]): RaporOzeti {
  const satir = bilinmeyenListeleri.length;
  const sayac: Record<string, number> = {};
  for (const liste of bilinmeyenListeleri) {
    for (const alan of liste) sayac[alan] = (sayac[alan] ?? 0) + 1;
  }
  // Sıra: çağıranın verdiği alan sırası (deterministik not — test edilebilir).
  const eksikAlanlar = alanSirasi.filter(a => (sayac[a] ?? 0) > 0);
  const okumaArizasi = satir >= ARIZA_ESIGI ? eksikAlanlar.filter(a => sayac[a] === satir) : [];
  const arizaSeti = new Set(okumaArizasi);
  const parcalar = [
    ...okumaArizasi.map(a => `UYARI: ${a} alanı hiçbir satırda okunamadı — kolon adı/şema kontrol edin`),
    ...eksikAlanlar.filter(a => !arizaSeti.has(a)).map(a => `${sayac[a]} satırın ${a} alanı bilinmiyor`),
  ];
  return { sayac, okumaArizasi, not: parcalar.join('; '), satir };
}

// ── 1) KDV kırılımı ──────────────────────────────────────────────────────────
/** `taxSummary.oranKirilimi` dizisinin bir elemanı — ALAN ADLARI VE SIRASI SABİT. */
export interface KdvKirilimSatiri {
  yon: 'satis' | 'alis';
  /** Gerçek yüzde (işaretçi DEĞİL); çözülemezse null — sabit oran uydurulmaz. */
  oran: number | null;
  /** Bilinen KDV tutarı; bilinmeyen satır bu diziye HİÇ girmez. */
  kdv: number;
  /** Bilinen matrah; okunamazsa null (₺0 DEĞİL). */
  matrah: number | null;
}

export interface KdvSecenek {
  /** `mikroVergiOranlari()` sonucu — işaretçi → yüzde. Modül saf kalsın diye DIŞARIDAN. */
  vergiTablosu: Map<number, number>;
  /** Oran işaretçisi kolonu sorguya GİRDİ mi? Girmediyse oran null'u arıza değildir. */
  oranKolonuVar: boolean;
}

export interface KdvOzeti {
  kirilim: KdvKirilimSatiri[];
  kdvHesaplanan: number;
  kdvIndirilecek: number;
  /** Ödenecek KDV — negatife düşmez (fark devreden tarafa yazılır). */
  kdvOdenmesi: number;
  devredenKdv: number;
  /** İstemcide gösterilen satış matrahı: bilinenlerin KISMİ toplamı; hiç bilinen yoksa NaN → '—'. */
  matrahSatis: number;
  /** KDV'si ya da yönü okunamadığı için kırılıma girmeyen satır sayısı. */
  atlananSatir: number;
  ozet: RaporOzeti;
}

/** Not/sayaç sırası — deterministik `note` için. */
const KDV_ALANLARI = ['yon', 'kdv', 'matrah', 'oran'] as const;

/**
 * `SELECT sth_vergi_pntr AS oranPntr, sth_tip AS tip, SUM(sth_vergi) AS kdv,
 *  SUM(sth_tutar) AS matrah ... GROUP BY` satırları → KDV özeti.
 *
 * Her satır bir ORAN KOVASIDIR (yön × oran). Kovanın KDV'si ya da yönü okunamazsa
 * kova atlanır ve sayılır: ₺0'lık sahte bir kova, beyan öncesi karşılaştırmada
 * "bu oranda hiç işlem yok" diye okunur ve hatayı gizler.
 */
export function kdvKirilimi(rows: readonly Satir[], secenek: KdvSecenek): KdvOzeti {
  const kirilim: KdvKirilimSatiri[] = [];
  const bilinmeyenListeleri: string[][] = [];
  let kdvHesaplanan = 0, kdvIndirilecek = 0, atlananSatir = 0;

  for (const r of rows) {
    const bilinmeyen: string[] = [];
    bilinmeyenListeleri.push(bilinmeyen);

    // YÖN — BAYRAK/TİP kodu. `Number(r.tip ?? 0)` burada meşru GÖRÜNÜR ama 0 bu
    // alanda ANLAMLI bir cevaptır (0 = giriş = alış), yani okunamayan hücre gerçek
    // bir iddiaya dönüşür ve indirilecek KDV'yi şişirir. Bu yüzden bilinmiyorsa atla.
    const tip = sayi(r.tip);
    if (tip === null) bilinmeyen.push('yon');

    const kdv = sayi(r.kdv);
    if (kdv === null) bilinmeyen.push('kdv');

    const matrah = sayi(r.matrah);
    if (matrah === null) bilinmeyen.push('matrah');

    // Oran: işaretçi → yüzde TERS arama. Kolon sorguya hiç girmediyse null'u
    // "bilinmiyor" saymayız — sorulmamış soruya cevap yok, bu bir arıza değil.
    let oran: number | null = null;
    if (secenek.oranKolonuVar) {
      const p = sayi(r.oranPntr);
      oran = p === null ? null : secenek.vergiTablosu.get(p) ?? null;
      if (oran === null) bilinmeyen.push('oran');
    }

    if (tip === null || kdv === null) { atlananSatir++; continue; }

    const cikis = tip === 1;                 // 1 = çıkış = satış
    if (cikis) kdvHesaplanan += kdv; else kdvIndirilecek += kdv;
    kirilim.push({ yon: cikis ? 'satis' : 'alis', oran, kdv, matrah });
  }

  // Ekrana giden sayı (MikroSyncPanel "Matrah: …"): bilinenlerin kısmi toplamı,
  // hiç bilinen yoksa NaN → paraYaz '—' basar. `|| 0` burada ₺0 diye gösteriyordu.
  const matrahTutari = toplaBilinen(kirilim.filter(k => k.yon === 'satis'), k => k.matrah);

  return {
    kirilim,
    kdvHesaplanan,
    kdvIndirilecek,
    kdvOdenmesi: Math.max(kdvHesaplanan - kdvIndirilecek, 0),
    devredenKdv: Math.max(kdvIndirilecek - kdvHesaplanan, 0),
    matrahSatis: ekranTutari(matrahTutari),
    atlananSatir,
    ozet: ozetKur(bilinmeyenListeleri, KDV_ALANLARI),
  };
}

// ── 2) Mizan ─────────────────────────────────────────────────────────────────
/** `accountingPeriods.rows` dizisinin bir elemanı — ALAN ADLARI VE SIRASI SABİT. */
export interface MizanSatiri {
  hesapKodu: string;
  /** Bilinen borç toplamı; okunamazsa null (₺0 DEĞİL — hesap "hareketsiz" görünürdü). */
  borc: number | null;
  alacak: number | null;
  /** borç − alacak; İŞARET KORUNUR (Math.abs YOK). Bir taraf bilinmiyorsa null. */
  bakiye: number | null;
}

const MIZAN_ALANLARI = ['hesapKodu', 'borc', 'alacak'] as const;

/**
 * `SELECT hesap_kodu AS hesapKodu, SUM(CASE ... > 0) AS borc, SUM(CASE ... < 0) AS alacak`
 * satırı → mizan satırı. Hesap kodu yoksa null (satır atlanır — bugünkü `.filter` paritesi).
 */
export function mizanSatiri(row: Satir): MizanSatiri | null {
  const hesapKodu = metin(row.hesapKodu);
  if (!hesapKodu) return null;
  const borc = sayi(row.borc);
  const alacak = sayi(row.alacak);
  return {
    hesapKodu,
    borc,
    alacak,
    bakiye: borc === null || alacak === null ? null : borc - alacak,
  };
}

export interface MizanSonucu { satirlar: MizanSatiri[]; ozet: RaporOzeti }

/** Tüm mizan satırları + sayaç/arıza özeti. Kodsuz satır düşer ve `hesapKodu` olarak sayılır. */
export function mizanSatirlari(rows: readonly Satir[]): MizanSonucu {
  const satirlar: MizanSatiri[] = [];
  const bilinmeyenListeleri: string[][] = [];
  for (const r of rows) {
    const bilinmeyen: string[] = [];
    bilinmeyenListeleri.push(bilinmeyen);
    const s = mizanSatiri(r);
    if (!s) { bilinmeyen.push('hesapKodu'); continue; }
    if (s.borc === null) bilinmeyen.push('borc');
    if (s.alacak === null) bilinmeyen.push('alacak');
    satirlar.push(s);
  }
  return { satirlar, ozet: ozetKur(bilinmeyenListeleri, MIZAN_ALANLARI) };
}

export interface MizanToplami {
  /** Bilinen borç toplamı. */
  borc: number;
  alacak: number;
  fark: number;
  dengeli: boolean;
  /** Borç ya da alacağı okunamayan satır sayısı. */
  bilinmeyenSatir: number;
  /** Dolu ise rota 502 döner ve HİÇBİR ŞEY YAZMAZ. */
  hata: string | null;
}

/**
 * Çift taraflı kayıt denetimi. İki "dur" hâli var:
 *   • Tutarı okunamayan satır VARSA → denge hiçbir şey ispat etmez (eski kod bu
 *     satırları 0/0 sayıp "dengeli" diyordu), eksik mizan yazılmaz.
 *   • Bilinen toplamlar eşit değilse → işaret varsayımı ya da grup seçimi yanlış.
 * Eşik ve dengesizlik mesajı bugünkü rotayla birebir aynıdır.
 */
export function mizanToplami(satirlar: readonly MizanSatiri[]): MizanToplami {
  const b = toplaBilinen(satirlar, r => r.borc);
  const a = toplaBilinen(satirlar, r => r.alacak);
  const bilinmeyenSatir = satirlar.filter(r => r.borc === null || r.alacak === null).length;
  const fark = Math.abs(b.toplam - a.toplam);

  if (bilinmeyenSatir > 0) {
    return {
      borc: b.toplam, alacak: a.toplam, fark, dengeli: false, bilinmeyenSatir,
      hata: `Mizan okunamadı: ${bilinmeyenSatir} hesabın borç/alacak tutarı Mikro’dan alınamadı — ` +
            'denge doğrulanamaz, hiçbir şey yazılmadı. Kolon adı/şema kontrol edin.',
    };
  }

  const dengeli = fark <= Math.max(1, (b.toplam + a.toplam) * 0.0001);
  return {
    borc: b.toplam, alacak: a.toplam, fark, dengeli, bilinmeyenSatir,
    hata: dengeli ? null
      : `Mizan dengesiz: borç ${b.toplam.toFixed(2)} ≠ alacak ${a.toplam.toFixed(2)} (fark ${fark.toFixed(2)}). ` +
        'Borç/alacak işaret kuralı bu kurulumda farklı olabilir — hiçbir şey yazılmadı.',
  };
}
