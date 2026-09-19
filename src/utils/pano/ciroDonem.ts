/**
 * ciroDonem.ts — Pano'nun DÖNEMSEL CİRO hesabı, tek kaynak (Faz 3 5/n, grup "ciroDonem", 2026-09-19).
 * Test: ciroDonem.test.ts (ÖNCE yazıldı). Saf fonksiyon: React/DB yok.
 *
 * ## NEDEN VAR
 * DashboardPage'de "dönem × ciro" hesabı BEŞ yerde elle kopyalanmıştı; ikisi Faz 2'de
 * düzeltilmiş, üçü sahte kesinlikle kalmıştı:
 *   • 436-447   Phase 35 sparkline      — `toplaBilinen` ile doğru, ama hesap sayfada inline
 *   • 500-520   Insight strip 7 gün     — doğru; KAYAN 7×24s penceresi (sparkline TAKVİM günü kullanıyor)
 *   • 770-776   Phase 56 MTD            — `reduce((s,o) => s + (o.totalPrice || 0), 0)` ×2; sapma yüzdesi
 *                                         ve "projeksiyon" KISMİ toplamdan türetiliyordu
 *   • 1379      Phase 103 6 aylık çubuk — aynı `|| 0`; `Math.max(...rev, 1)` bilinmeyenle NaN'a düşer
 *   • 1900-1903 6 aylık trend           — `bucket.revenue += o.totalPrice` (alan yoksa TÜM ay NaN olur ve
 *                                         recharts alanı çöker); `ayAnahtari(o.createdAt)` — yalnız
 *                                         `syncedAt`i olan sipariş SESSİZCE hiçbir aya girmiyordu
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): tutarı okunamayan sipariş ₺0 değildir. Toplama girmez,
 * `Tutar.bilinmeyen` olarak SAYILIR; ekran kısmi toplamı + "N kayıt tutarsız" notunu gösterir, hiç bilinen
 * yoksa '—'. Sapma / projeksiyon TÜRETİLEN sayıdır (para.ts `tamTutar`): tek girdi eksikse hesaplanmaz.
 * Grafik noktası bilinmeyende `null` — 0 değil, yoksa çizgi/çubuk sıfıra çakılır ve "o ay ciro yoktu" der.
 *
 * ## PARİTE (bilinen girdide sayı eskiyle BİREBİR aynı)
 *   • Günlük pencere TAKVİM günü (`gunAnahtari`), tarih çözümü `siparisTarih` (syncedAt ÖNCE) — sparkline'ın
 *     bugünkü hâli. Insight strip'in KAYAN penceresi ayrı fonksiyonda (`sonNGunToplami`) korunur.
 *   • Aylık/MTD tarih çözümü `ciroTarihi` = `createdAt ?? syncedAt` — sayfanın 9 sitesindeki çoğunluk kalıbı.
 *   • Mikro ADDITIVE birleşir (CLAUDE.md "EKLE, YERİNE KOYMA") ve yalnız GÜNLÜK tarafta — aylık siteler
 *     bugün Mikro faturalarını hiç saymıyor, bu davranış DEĞİŞTİRİLMEDİ (bkz. Bilinçli farklar / açık sorular).
 *   • Çift sayım koruması: `source` 'mikro*' olan sipariş native tarafta sayılmaz (`odemeTakipli`).
 *     Günlük taraftaki "native + Mikro giden faturası" TOPLAMASI burada KOPYALANMAZ, `mikroBirlesim`
 *     → `panoCirosu`ya devredilir: KPI kartı, sparkline ve 7 günlük şerit tek fonksiyonu çağırsın diye
 *     (sayfadaki "Kural + toplama TEK YERDE" notu). Bu modül yalnız DÖNEM penceresini (gün/ay) kurar.
 *   • MTD ay sınırları, ay ilerlemesi yuvarlaması ve projeksiyon formülü Phase 56'daki hâliyle aynı.
 *
 * ## BİLİNÇLİ FARKLAR
 *   1. 6 aylık TREND artık `createdAt ?? syncedAt` okuyor (eskiden yalnız `createdAt`): yalnız `syncedAt`i
 *      olan sipariş sessizce düşüyordu — yanındaki Phase 103 çubuğu onu sayarken trend saymıyordu, iki
 *      grafik aynı ekranda farklı ciro gösteriyordu.
 *   2. Sapma ve projeksiyon artık `tamTutar` kapısından geçiyor: bir kayıt bile tutarsızsa rozet/projeksiyon
 *      ÇİZİLMEZ ('—'). Eskiden kısmi toplamdan "▲ %25" üretiliyordu.
 *   3. Ölçek tavanı (`olcekTavani`) bilinmeyeni ölçeğe sokmaz — `Math.max(...rev, 1)` tek bir NaN'la
 *      bütün çubuk yüksekliklerini NaN yapıyordu.
 */
import {
  toplaBilinen,
  tutarBirlestir,
  ekranTutari,
  tamTutar,
  donemKarsilastir,
  type Tutar,
} from '../para';
import { siparisTarih, siparisTutari } from '../siparis';
import { zamanDate, zamanMs, gunAnahtari, ayAnahtari, tarihYaz, type ArayuzDili } from '../zaman';
// Günlük tarafın birleşim kuralı (çift sayım kapısı + yalnız 'giden' fatura + "tutarı okunamayan
// kayıt 0 SAYILMAZ, SAYILIR") TEK YERDE durur. Burada ikinci bir kopyası olsaydı iki modül sessizce
// ayrışabilirdi — 2026-09-04'te sparkline korumayı kaçırdığı için çubuklar gerçeğin iki katına çıkmıştı.
import { panoCirosu } from './mikroBirlesim';

/** Siparişin bu modülün okuduğu alanları — yapısal (types.ts `Order` uyar), tipe bağımlı DEĞİL. */
export interface CiroSiparisi {
  /** Tutar; NaN/null/''/undefined = BİLİNMİYOR. `totalAmount` yedeğiyle `siparisTutari` okur. */
  totalPrice?: unknown;
  totalAmount?: unknown;
  createdAt?: unknown;
  syncedAt?: unknown;
  /** Faturadan türetilen siparişin tarihi. GÜNLÜK tarafta `siparisTarih` okur; AYLIK tarafta okunmaz (parite). */
  orderDate?: unknown;
  status?: string;
  /** 'mikro*' önekli kayıt native ciroda sayılmaz (çift sayım koruması — `odemeTakipli`). */
  source?: string;
}

/** Mikro faturasının okunan alanları (useMikroFaturalar `MikroFatura` yapısal olarak uyar). */
export interface CiroFaturasi {
  /** 'giden' = satış (ciro), 'gelen' = alış. */
  yon?: string;
  /** Fatura toplamı; NaN = BİLİNMİYOR (hook artık sahte sıfır vermiyor). */
  tutar?: unknown;
  tarih?: unknown;
}

export interface DonemSecenek {
  /**
   * `status === 'Cancelled'` kayıtları dışla. PARİTE gereği her çağrı yerinde AÇIKÇA verilir:
   * sayfada Phase 103 ve Phase 99 iptali dışlıyor, Phase 35 / 56 / trend dışlamıyor.
   */
  iptalHaric: boolean;
}

export interface DonemSatiri {
  /** 'YYYY-MM-DD' (gün) ya da 'YYYY-MM' (ay). */
  anahtar: string;
  /** Ekran etiketi (gün numarası ya da kısa ay adı). */
  etiket: string;
  /** Dönemin başlangıç anı — çağıran başka biçim isterse. */
  tarih: Date;
  /** Kısmi toplam + bilinen/bilinmeyen sayaçları (not metni bundan doğar). */
  tutar: Tutar;
  /** Ekrana basılacak sayı: kısmi toplam, hiç bilinen yoksa NaN → fmtKpi/paraYaz '—'. */
  ekran: number;
  /** Grafik (recharts/çubuk) değeri: bilinmeyen dönem `null` — 0 DEĞİL. */
  grafik: number | null;
  /** Dönemdeki kayıt sayısı — tutarı bilinmeyenler DÂHİL (trend'in sipariş serisi paritesi). */
  adet: number;
}

export interface GunSatiri extends DonemSatiri {
  /** Ayın günü (sparkline tooltip'i "13. gün" der). */
  gun: number;
}

/**
 * AYLIK/MTD tarafın tarih çözümü: `createdAt` ÖNCE, `syncedAt` yedek.
 * Sayfanın 9 aylık/MTD sitesindeki kalıbın aynısı. `orderDate`e BİLEREK düşmez — o yedek yalnız
 * `siparisTarih` zincirinde var ve buraya eklemek Mikro faturasından türetilen siparişleri ay
 * kovalarına sokarak sayıyı DEĞİŞTİRİRDİ (bkz. açık sorular).
 * Çözülemezse `null` — ASLA "bugün"e düşmez.
 */
export function ciroTarihi(o: CiroSiparisi): Date | null {
  return zamanDate(o.createdAt) ?? zamanDate(o.syncedAt);
}

/** Bir `Tutar`ın grafik karşılığı: bilinen yoksa `null` (çizgi sıfıra çakılmasın). */
function grafikDegeri(t: Tutar): number | null {
  const e = ekranTutari(t);
  return Number.isFinite(e) ? e : null;
}

/** İptal süzgeci — tek yerde, iki fonksiyon da aynı kapıyı kullansın. */
function iptalSuz(siparisler: readonly CiroSiparisi[], sec: DonemSecenek): readonly CiroSiparisi[] {
  return sec.iptalHaric ? siparisler.filter(o => o.status !== 'Cancelled') : siparisler;
}

/**
 * Son `gunSayisi` TAKVİM gününün cirosu, en eskiden bugüne (Phase 35 sparkline).
 * Native siparişler + Mikro giden faturaları EKLENEREK birleşir; Mikro kaynaklı siparişler
 * (`source` 'mikro*') native tarafta sayılmaz — aynı fatura iki kez ciroya girmesin.
 */
export function gunlukCiro(
  siparisler: readonly CiroSiparisi[],
  faturalar: readonly CiroFaturasi[],
  gunSayisi: number,
  bugun: Date = new Date(),
  sec: DonemSecenek = { iptalHaric: false },
): GunSatiri[] {
  const liste = iptalSuz(siparisler, sec);

  return Array.from({ length: gunSayisi }, (_, i) => {
    const d = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate() - (gunSayisi - 1 - i));
    const anahtar = gunAnahtari(d) ?? '';

    // Gün süzgeci BURADA, birleşim kuralı ORADA (panoCirosu): çift sayım kapısı ve
    // 'giden' süzgeci onun içinde. `bilinen + bilinmeyen` = o güne düşen kayıt sayısı.
    const { tutar } = panoCirosu(
      liste.filter(o => gunAnahtari(siparisTarih(o)) === anahtar),
      faturalar.filter(f => gunAnahtari(f.tarih) === anahtar),
    );

    return {
      anahtar,
      etiket: String(d.getDate()),
      tarih: d,
      gun: d.getDate(),
      tutar,
      ekran: ekranTutari(tutar),
      grafik: grafikDegeri(tutar),
      adet: tutar.bilinen + tutar.bilinmeyen,
    };
  });
}

/**
 * KAYAN pencere toplamı: son `gunSayisi × 24` saat (insight strip'in "7 Günlük Ciro" kartı).
 * `gunlukCiro`dan BİLEREK farklı — o takvim günü kovalar, bu `simdi - t < N×86400000` der.
 * İki tanım aynı ekranda yan yana duruyor (kart + sparkline); birleştirme kararı kullanıcıya bırakıldı.
 */
export function sonNGunToplami(
  siparisler: readonly CiroSiparisi[],
  faturalar: readonly CiroFaturasi[],
  gunSayisi: number,
  simdi: Date = new Date(),
): Tutar {
  const sinir = simdi.getTime() - gunSayisi * 86400000;
  // Pencere süzgeci burada; çift sayım kapısı + 'giden' süzgeci `panoCirosu`nun içinde (tek kural).
  return panoCirosu(
    siparisler.filter(o => {
      const d = siparisTarih(o);
      return !!d && d.getTime() > sinir;
    }),
    faturalar.filter(f => {
      const ms = zamanMs(f.tarih);
      return ms !== null && ms > sinir;
    }),
  ).tutar;
}

/**
 * Son `aySayisi` ayın cirosu, en eskiden bu aya (Phase 103 çubuk grafiği + 6 aylık trend).
 * Tarih çözümü `ciroTarihi`; tarihi çözülemeyen sipariş HİÇBİR kovaya girmez.
 * Mikro faturaları BURAYA GİRMEZ — sayfadaki iki site de bugün yalnız `orders` okuyor (parite).
 */
export function aylikCiro(
  siparisler: readonly CiroSiparisi[],
  aySayisi: number,
  bugun: Date = new Date(),
  sec: DonemSecenek = { iptalHaric: false },
  dil: ArayuzDili = 'tr',
): DonemSatiri[] {
  const liste = iptalSuz(siparisler, sec);

  return Array.from({ length: aySayisi }, (_, i) => {
    const d = new Date(bugun.getFullYear(), bugun.getMonth() - (aySayisi - 1 - i), 1);
    const anahtar = ayAnahtari(d) ?? '';
    const ayinlar = liste.filter(o => ayAnahtari(ciroTarihi(o)) === anahtar);
    const tutar = toplaBilinen(ayinlar, siparisTutari);

    return {
      anahtar,
      etiket: tarihYaz(d, { month: 'short' }, dil),
      tarih: d,
      tutar,
      ekran: ekranTutari(tutar),
      grafik: grafikDegeri(tutar),
      adet: ayinlar.length,
    };
  });
}

/** Dönem satırlarının toplamı — "6 ay toplam ciro" gibi özet rakamlar için (sayaçlar da toplanır). */
export function donemToplami(satirlar: readonly DonemSatiri[]): Tutar {
  return tutarBirlestir(...satirlar.map(s => s.tutar));
}

/**
 * Çubuk/sparkline ölçeğinin tavanı. BİLİNMEYEN dönem ölçeğe girmez ve tek NaN bütün yükseklikleri
 * bozmaz (`Math.max(...rev, 1)` tam bunu yapıyordu). Alt sınır 1: sıfıra bölme koruması, para iddiası değil.
 */
export function olcekTavani(satirlar: readonly DonemSatiri[]): number {
  return Math.max(...satirlar.map(s => s.ekran).filter(v => Number.isFinite(v)), 1);
}

export interface MtdSonuc {
  /** Bu ayın 1'inden bugüne (üst sınır YOK — Phase 56 paritesi: ileri tarihli sipariş de sayılır). */
  buAy: Tutar;
  /** Geçen ayın tamamı. */
  gecenAy: Tutar;
  /** Ekrana basılacak MTD rakamı (kısmi toplam; hiç bilinen yoksa NaN → '—'). */
  ekran: number;
  /** Ekrana basılacak geçen ay rakamı. */
  gecenAyEkran: number;
  /** Sapma yüzdesi — iki dönem de TAM biliniyorsa; değilse `null` (rozet ÇİZİLMEZ). */
  yuzde: number | null;
  yon: 'artis' | 'azalis' | null;
  /** Ayın yüzde kaçı geçti (gün bazlı — para değil, her zaman bilinir). Phase 56 yuvarlaması aynen. */
  ayIlerlemesi: number;
  /** Ay sonu projeksiyonu — MTD tam bilinmiyorsa NaN ('—'); TÜRETİLEN sayıdır. */
  projeksiyon: number;
}

/**
 * "Bu Ay Ciro (MTD)" vs geçen ay (Phase 56). Ay sınırları sayfadaki hâliyle aynı:
 * bu ay `>= ayın 1'i` (üst sınır yok), geçen ay `[geçen ayın 1'i, geçen ayın son günü 23:59:59]`.
 */
export function mtdKarsilastir(
  siparisler: readonly CiroSiparisi[],
  bugun: Date = new Date(),
  sec: DonemSecenek = { iptalHaric: false },
): MtdSonuc {
  const liste = iptalSuz(siparisler, sec);
  const buAyBasi = new Date(bugun.getFullYear(), bugun.getMonth(), 1);
  const gecenAyBasi = new Date(bugun.getFullYear(), bugun.getMonth() - 1, 1);
  const gecenAySonu = new Date(bugun.getFullYear(), bugun.getMonth(), 0, 23, 59, 59);

  const buAy = toplaBilinen(
    liste.filter(o => { const d = ciroTarihi(o); return !!d && d >= buAyBasi; }),
    siparisTutari,
  );
  const gecenAy = toplaBilinen(
    liste.filter(o => { const d = ciroTarihi(o); return !!d && d >= gecenAyBasi && d <= gecenAySonu; }),
    siparisTutari,
  );

  const { ekran, yuzde, yon } = donemKarsilastir(buAy, gecenAy);

  const ayinGunSayisi = new Date(bugun.getFullYear(), bugun.getMonth() + 1, 0).getDate();
  const ayIlerlemesi = Math.round((bugun.getDate() / ayinGunSayisi) * 100);
  // Projeksiyon TÜRETMEDİR: `tamTutar` kapısı, bir kayıt bile tutarsızsa NaN verir ve ekran '—' basar.
  // Eskiden kısmi toplam ay sonuna yayılıyor, eksik veri "gerçekleşecek ciro" gibi sunuluyordu.
  const mtdTam = tamTutar(buAy);
  const projeksiyon = ayIlerlemesi > 0 ? Math.round(mtdTam * (100 / ayIlerlemesi)) : mtdTam;

  return { buAy, gecenAy, ekran, gecenAyEkran: ekranTutari(gecenAy), yuzde, yon, ayIlerlemesi, projeksiyon };
}
