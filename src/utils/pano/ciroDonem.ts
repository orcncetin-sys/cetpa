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
 *
 * ## 6b EKİ (2026-09-24, Faz 3 6/n Genel I) — `ceyreklikCiro` (ADDITIVE; yukarıdaki gövdeler DOKUNULMADI)
 * Neden var: src/components/reports/genel/GenelBloklar1.tsx:171-224 (Phase 156 "Çeyrek Bazlı Karşılaştırma / QoQ")
 * çeyrek kovalarını ELLE kuruyor (HEAD 912d750'de teyit):
 *   • :181  `quarters.push({ …, revenue: 0, orders: 0 })`           — `revenue` `Tutar` kovası olmalı (BOS_TUTAR deseni)
 *   • :189  `entry.revenue += o.totalPrice || 0; entry.orders++;`    — tutarı okunamayan sipariş ₺0 giriyor ama adet
 *           artıyor → "adet var, ciro yok" = kullanıcı çeyreği "düşük satış" sanıyor; `find` eşleşmezse SESSİZCE düşüyor
 *   • :185  `if (!d) continue;`                                      — tarihi çözülemeyen kayıt sessizce düşüyor
 *   • :191  `Math.max(...quarters.map(q => q.revenue), 1)`           — kopya ölçek (para ölçeği `./cubuk`ta)
 *   • :194  `prevQ.revenue > 0 ? Math.round(…) : null`               — girdiler KISMİ toplam, `tamTutar` kapısı yok
 * PARİTE: çeyrek pencereleri (`new Date(y, m - i*3, 1)` geri sarma), etiket metni `Q${n} ${yıl}` (`getQLabel`),
 *   `adet` tanımı (tutarsızlar DÂHİL) ve iptal süzgeci (`{ iptalHaric }`) bugünküyle AYNI; bilinen girdide rakam BİREBİR.
 * BİLİNÇLİ FARKLAR (ceyreklikCiro):
 *   1. Tarih zinciri modülün TEK kuralı `ciroTarihi` (= `createdAt ?? syncedAt`); GB1 bugün YALNIZ `createdAt` okuyor.
 *      Gerekçe yukarıdaki "BİLİNÇLİ FARKLAR 1" ile aynı: yalnız `syncedAt`i olan sipariş sessizce düşüyor ve aynı
 *      sayfadaki `aylikCiro` tüketicileri (GB1:235 P190, :488 P215) onu SAYIYOR → tek sayfada iki ciro tanımı.
 *   2. `tarihsiz` / `pencereDisi` sayaçları BİLDİRİLİR (emsal: `hedefButce.CiroPenceresi`, `zamanKovalari`).
 *      `aylikCiro` bildirmez (eski imza, KAPALI) — ona aynı sayaçları eklemek AYRI iş, DEVREDEN.
 *   3. Tutar seçici `siparisTutari` (`totalPrice ?? totalAmount`) — sayfanın tek tanımı.
 * K28 (kullanıcı: "Dönem tanımları: parite + adlandırma") — çeyrek penceresi bugünkü tanımı KORUR, yalnız adlandırır.
 * K2 ("İptaller ciroya girsin mi → hayır") — süzgeç `DonemSecenek.iptalHaric` ile ÇAĞIRANDA; varsayılan `aylikCiro` ile aynı.
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
import { zamanDate, zamanMs, gunAnahtari, ayAnahtari, ceyrekAnahtari, tarihYaz, type ArayuzDili } from '../zaman';
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

// ─────────────────────────────────────────────────────────────────────────────
// ÇEYREKLİK pencere (6b eki, 2026-09-24 — GenelBloklar1 P156 QoQ)
// ─────────────────────────────────────────────────────────────────────────────

/** Çeyrek satırı — `GunSatiri` emsali: `DonemSatiri`ye çeyreğin kimliğini ekler. */
export interface CeyrekSatiri extends DonemSatiri {
  /** Takvim yılı (etiketin ikinci parçası). */
  yil: number;
  /** 1-4 (getMonth()/3 SIFIR tabanlıdır; burada İNSAN numarası tutulur — off-by-one tuzağı kapanır). */
  ceyrek: number;
}

export interface CeyreklikCiro {
  /** En eskiden bu çeyreğe; uzunluk = `ceyrekSayisi`; BOŞ çeyrekler dâhil (grafik şekli sabit). */
  satirlar: CeyrekSatiri[];
  /** İptal süzgecinden GEÇEN ama tarihi çözülemeyen kayıt — hiçbir çeyreğe girmez, SAYILIR. */
  tarihsiz: number;
  /** Tarihi çözülen ama pencerenin (son N çeyrek) dışında kalan kayıt — bugün SESSİZCE düşüyor. */
  pencereDisi: number;
}

/**
 * Son `ceyrekSayisi` çeyreğin cirosu, en eskiden bu çeyreğe (GenelBloklar1 P156 "Çeyrek Bazlı Karşılaştırma").
 *
 * - Tarih: modülün TEK kuralı `ciroTarihi` (`createdAt ?? syncedAt`; `orderDate`e DÜŞMEZ). Çözülemezse `tarihsiz++`.
 * - Pencere: `bugun`un çeyreğinden geriye `ceyrekSayisi` çeyrek (GB1:178 `new Date(y, m - i*3, 1)` ile aynı geri
 *   sarma — yıl sınırını JS `Date` normalleştirir). Çeyrek başı `new Date(yil, (ceyrek-1)*3, 1)` → `satir.tarih`.
 *   Pencere dışı → `pencereDisi++` (eskiden `find` eşleşmeyince sessizce düşüyordu).
 * - Anahtar `ceyrekAnahtari` → `'2026-Q3'` (kronolojik metin sırası); etiket `Q${ceyrek} ${yil}` → `'Q3 2026'`
 *   (`getQLabel` ile BİREBİR; iki dilde AYNI → `dil` parametresi YOK).
 * - Tutar `toplaBilinen(çeyreğin siparişleri, siparisTutari)`; `ekran` kısmi toplam (hiç bilinen yoksa NaN → '—'),
 *   `grafik` bilinen yoksa `null` (0 DEĞİL), `adet` çeyreğe düşen kayıt sayısı — tutarı bilinmeyenler DÂHİL
 *   (`entry.orders++` paritesi). QoQ yüzdesi ÇAĞIRANDA `para.donemKarsilastir` ile (`tamTutar` kapısı içinde).
 * - Tek geçiş: siparişler bir kez gezilip anahtar → indeks haritasıyla kovalanır (`aylikCiro`nun O(n·m) `filter`
 *   kalıbı KOPYALANMADI; `aylikCiro` DOKUNULMADI).
 * - `ceyrekSayisi` pozitif TAM SAYI olmalı; değilse `throw` (emsal `zamanDagilimi.zamanKovalari`: sessiz boş
 *   sonuç panelin bozuk yapılandırmayı fark etmeden "veri yok" basmasına yol açardı).
 *
 * DEĞİŞMEZ: `Σ satirlar.adet + tarihsiz + pencereDisi === iptalSuz(siparisler, sec).length`. Girdi mutasyona uğramaz.
 */
export function ceyreklikCiro(
  siparisler: readonly CiroSiparisi[],
  ceyrekSayisi: number,
  bugun: Date = new Date(),
  sec: DonemSecenek = { iptalHaric: false },
): CeyreklikCiro {
  if (!Number.isInteger(ceyrekSayisi) || ceyrekSayisi <= 0) {
    throw new Error(`ceyreklikCiro: ceyrekSayisi pozitif tam sayı olmalı (geldi: ${String(ceyrekSayisi)})`);
  }
  const liste = iptalSuz(siparisler, sec);

  // Bugünün çeyrek başı; oradan geriye 3'er ay (GB1:178 ile aynı geri sarma).
  const buCeyrekBasi = new Date(bugun.getFullYear(), Math.floor(bugun.getMonth() / 3) * 3, 1);
  const kovalar = Array.from({ length: ceyrekSayisi }, (_, i) => {
    const tarih = new Date(buCeyrekBasi.getFullYear(), buCeyrekBasi.getMonth() - (ceyrekSayisi - 1 - i) * 3, 1);
    // Kurulan Date her zaman geçerli → anahtar hiç null olmaz; `aylikCiro:212` ile aynı `?? ''` kalıbı (sayı değil).
    const anahtar = ceyrekAnahtari(tarih) ?? '';
    return { tarih, yil: tarih.getFullYear(), ceyrek: Math.floor(tarih.getMonth() / 3) + 1, anahtar, siparisler: [] as CiroSiparisi[] };
  });
  const indeks = new Map(kovalar.map((k, i) => [k.anahtar, i] as const));

  let tarihsiz = 0;
  let pencereDisi = 0;
  for (const o of liste) {
    const anahtar = ceyrekAnahtari(ciroTarihi(o));
    if (anahtar === null) { tarihsiz += 1; continue; }          // ASLA "bugün"e düşmez
    const i = indeks.get(anahtar);
    if (i === undefined) { pencereDisi += 1; continue; }         // eskiden `find` ile sessizce düşüyordu
    kovalar[i].siparisler.push(o);
  }

  const satirlar = kovalar.map((k): CeyrekSatiri => {
    const tutar = toplaBilinen(k.siparisler, siparisTutari);
    return {
      anahtar: k.anahtar,
      etiket: `Q${k.ceyrek} ${k.yil}`,
      tarih: k.tarih,
      yil: k.yil,
      ceyrek: k.ceyrek,
      tutar,
      ekran: ekranTutari(tutar),
      grafik: grafikDegeri(tutar),
      adet: k.siparisler.length,
    };
  });
  return { satirlar, tarihsiz, pencereDisi };
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
