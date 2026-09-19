/**
 * lojistikKpi.ts — OrdersPage lojistik/destek KPI'larının hesap sözleşmesi (Faz 3 4/n, 2026-09-19).
 * Test: lojistikKpi.test.ts (ÖNCE yazıldı). Saf modül — React/DB yok.
 *
 * NEDEN VAR — kapatılan sahte-kesinlik siteleri (src/pages/OrdersPage.tsx, satırlar yaklaşık):
 *   ~2627-2629  fillRate / onTimeRate / cancelRate `x.length > 0 ? … : 0`
 *               Siparişsiz dönemde "%0 Sipariş Doluluk" KIRMIZI, "%0 İptal" YEŞİL rozetle basılıyordu:
 *               ikisi de ölçüm değil, uydurulmuş iyi/kötü haber. Payda 0 → oran BİLİNMİYOR ('—', rozet yok).
 *   ~2622-2625  onTime576 = delivered576.filter(o => { const est = …; if (!est) return true; … })
 *               Tahmini teslim tarihi OLMAYAN her teslimat "zamanında" sayılıyordu; üstelik teslim anı
 *               `o.deliveryPhoto ? now : est` ile yaklaşıklanıyor, fotoğrafsız teslimat `est <= est` ile
 *               yine "zamanında" çıkıyordu. Pratikte KPI kalıcı %100'dü. BİLİNÇLİ FARK: artık gerçek
 *               `deliveredAt` (OrdersPage 385/3470 ve App.tsx 6221 bu alanı yazıyor) ile tahmini tarih
 *               KARŞILAŞTIRILIR; ikisinden biri okunamıyorsa teslimat ÖLÇÜLEMEZ sayılır ve SAYILIR.
 *   ~2631-2636  avgProcessDays = shipped576.reduce(…) / shipped576.length : 0
 *               Sevkiyatsız dönemde "0,0 gün" + YEŞİL "≤3 gün" rozeti. Ayrıca `if (crMs === null) return s;`
 *               dalı tarihi okunamayan siparişi toplamdan çıkarıp PAYDADA bırakıyordu (ortalamayı 0'a
 *               doğru çekerdi); bugün dönem filtresi sayesinde erişilemez ama sözleşme burada doğru kurulur.
 *   ~2637-2638  lowStockRatio = inventory.length > 0 ? … : 0 → `oranYuzde` ile kapatılır.
 *   ~2851       totalValue = p622Shipments.reduce((s,sh) => s + (sh.value||0), 0)
 *               (a) değeri bilinmeyen sevkiyat ₺0 sayılıyordu, (b) USD/EUR/TRY değerleri TEK sayıda
 *               toplanıp `paraYaz(totalValue, { birim: 'USD' })` ile HEPSİ dolar gibi basılıyordu —
 *               ₺150.000'lik yurt içi bir kaydın $150.000 görünmesi demek. Birim başına ayrı Tutar.
 *   ~1572-1573  avgSatScore = …reduce((s,t) => s + (t.satisfaction||0), 0)/…
 *               `filter(t => t.satisfaction)` truthy elemesi 1-5 dışı değerleri (7, '4 yıldız') toplama
 *               sokuyordu; metin girince `s + 'abc'` string birleştirmesine dönüyordu. Artık yalnız 1-5
 *               tam sayı oy sayılır, oy yoksa null ('—').
 *   ~2648-2653  cargoMap576 `(cargoMap576[c]||0) + 1` SAYAÇ'tır, sahte kesinlik değil — DOKUNULMADI.
 *   ~601        fulfillRate = total522 > 0 ? Math.round(…) : 0 — KAPANIŞ GREP'İNİN KAÇIRDIĞI kopya
 *               (2026-09-19). Grup ölçüsü `grep -nE "(\|\||\?\?)\s*0\b"` yalnız `||`/`??` kalıbını
 *               arıyordu; ÜÇLÜ dal (`> 0 ? … : 0`) bu desene uymuyor. Şerit `activeOrders.length >= 3`
 *               ile açılıyor ama payda İPTAL OLMAYAN siparişleri sayıyor: hepsi 'Cancelled' ise kart
 *               KIRMIZI "0%" + "0 / 0" basıyor, aynı sayfadaki Lojistik KPI kartları ise gri '—'
 *               basıyordu — iki yüzey iki sözleşme. Artık ikisi de `oranYuzde`den geçiyor.
 *               KAPANIŞ ÖLÇÜSÜNE EKLE: `grep -nE "> 0 \? .*: 0\b" <dosya>`.
 *
 * SAYFA PARİTESİ: girdilerin hepsi bilinenken doluluk/iptal oranı ve ortalama gün sayısı eski kodla
 * BİREBİR aynı; ihracat toplamı tek para biriminde eski `reduce` ile aynı; memnuniyet ortalaması geçerli
 * 1-5 puanlarda aynı. Tek bilinçli fark yukarıdaki "zamanında teslim" ölçümüdür.
 *
 * AÇIK KALAN (kod değil, etiket sorunu): "Ort. İşlem Süresi (created → shipped)" etiketinin arkasındaki
 * hesap aslında `şimdi − createdAt`, yani siparişin YAŞI — kayıtta `shippedAt` yok. Parite bozulmasın diye
 * formül korundu; fonksiyon adı (`gecenGunOrtalamasi`) ve dönüş alanı (`ortGecenGun`) gerçeği söyler.
 */
import { bilinenSayi, toplaBilinen, ekranTutari, type Tutar } from '../para';
import { zamanMs, gunFarki } from '../zaman';
import { paraYaz } from '../currency';

const GUN_MS = 86400000;

/**
 * Yüzde oranı — payda 0/negatif ya da taraflardan biri bilinmiyorsa null ("%0" UYDURULMAZ).
 * Yuvarlama YOK: çağıran yüzey `.toFixed(1)` ile biçimler (eski davranışla birebir).
 */
export function oranYuzde(pay: unknown, payda: unknown): number | null {
  if (!bilinenSayi(pay) || !bilinenSayi(payda)) return null;
  const alt = Number(payda);
  if (alt <= 0) return null;
  return (Number(pay) / alt) * 100;
}

export interface GecenGunSiparisi { createdAt?: unknown }

/**
 * Siparişlerin `şimdi − createdAt` gün ortalaması. Tarihi okunamayan sipariş ne paya ne PAYDAYA girer,
 * `olculemeyen` olarak SAYILIR (ekran "N sipariş tarihsiz" notu koyabilir). Hiç ölçülebilir sipariş yoksa
 * ortalama null — türetilen sayı, tek bir ölçüm bile yoksa hesaplanmaz ('—', rozet çizilmez).
 */
export function gecenGunOrtalamasi(
  siparisler: readonly GecenGunSiparisi[],
  simdi: Date | number,
): { ortalama: number | null; olculen: number; olculemeyen: number } {
  const simdiMs = zamanMs(simdi);
  if (simdiMs === null) return { ortalama: null, olculen: 0, olculemeyen: siparisler.length };
  let toplam = 0, olculen = 0, olculemeyen = 0;
  for (const o of siparisler) {
    const ms = zamanMs(o.createdAt);
    if (ms === null) { olculemeyen++; continue; }
    toplam += (simdiMs - ms) / GUN_MS;
    olculen++;
  }
  return { ortalama: olculen > 0 ? toplam / olculen : null, olculen, olculemeyen };
}

export interface ZamanindaSiparisi { deliveredAt?: unknown; estimatedDelivery?: unknown }

/**
 * Zamanında teslim oranı. ÖLÇÜLEBİLİR = gerçek teslim tarihi VE tahmini teslim tarihi okunabilen kayıt;
 * biri eksikse "zamanında" DA "gecikmiş" DE sayılmaz, `olculemeyen` olur. Karşılaştırma `gunFarki` ile
 * GÜN bazlıdır (zaman.ts): söz verilen günün akşamı yapılan teslimat gecikme sayılmaz.
 */
export function zamanindaTeslimat(
  siparisler: readonly ZamanindaSiparisi[],
): { oran: number | null; zamaninda: number; olculen: number; olculemeyen: number } {
  let zamaninda = 0, olculen = 0, olculemeyen = 0;
  for (const o of siparisler) {
    const fark = gunFarki(o.deliveredAt, o.estimatedDelivery);
    if (fark === null) { olculemeyen++; continue; }
    olculen++;
    if (fark <= 0) zamaninda++;
  }
  return { oran: oranYuzde(zamaninda, olculen), zamaninda, olculen, olculemeyen };
}

/**
 * Sipariş alanları YAPISAL — kanonik `Order`a bağlı değil (siparis.ts'teki gerekçe: bazı yüzeyler kendi
 * daraltılmış sipariş arayüzünü taşıyor). `deliveredAt` types.ts'te ilan EDİLMEMİŞ olsa da OrdersPage 385
 * ve 3470 ile App.tsx 6221 bu alanı yazıyor; burada opsiyonel okunur (bkz. açık sorular).
 */
export interface PerformansSiparisi {
  status?: string;
  createdAt?: unknown;
  deliveredAt?: unknown;
  estimatedDelivery?: unknown;
}

export interface PerformansPenceresi {
  baslangic: Date | number;
  bitis: Date | number;
  /** `şimdi − createdAt` için referans an; verilmezse `bitis`. */
  simdi?: Date | number;
}

export interface TeslimPerformansi<T> {
  /** Tarihi okunabilen ve pencereye düşen siparişler — çağıran (kargo dağılımı vb.) bunu kullanır. */
  donem: readonly T[];
  /** Tarihi HİÇ okunamayan sipariş sayısı: dönemden düşer ama yutulmaz. */
  tarihsiz: number;
  sevkEdilen: number;
  teslimEdilen: number;
  iptal: number;
  aktif: number;
  dolulukOrani: number | null;
  iptalOrani: number | null;
  zamanindaOrani: number | null;
  zamanindaOlculen: number;
  zamanindaOlculemeyen: number;
  ortGecenGun: number | null;
  gunOlculen: number;
  gunOlculemeyen: number;
}

const SEVK_DURUMLARI = ['Shipped', 'Delivered'];
const AKTIF_DURUMLAR = ['Pending', 'Processing'];

/**
 * Phase 576 "Tedarik Zinciri Performans KPI" kartlarının tek kaynağı. Pencere filtresini de yapar ki
 * "tarihi okunamayan sipariş" kuralı tek yerde yaşasın ve `donem` listesi çağıranla aynı tanımı paylaşsın.
 */
export function teslimPerformansi<T extends PerformansSiparisi>(
  siparisler: readonly T[],
  pencere: PerformansPenceresi,
): TeslimPerformansi<T> {
  const bas = zamanMs(pencere.baslangic);
  const bit = zamanMs(pencere.bitis);
  const simdi = pencere.simdi === undefined ? pencere.bitis : pencere.simdi;

  const donem: T[] = [];
  let tarihsiz = 0;
  for (const o of siparisler) {
    const ms = zamanMs(o.createdAt);
    if (ms === null) { tarihsiz++; continue; }
    // Pencere sınırı okunamıyorsa dönem kurulamaz — "tüm siparişler" diye geniş bir varsayım yapılmaz.
    if (bas === null || bit === null) continue;
    if (ms >= bas && ms <= bit) donem.push(o);
  }

  const sevkEdilenler = donem.filter(o => SEVK_DURUMLARI.includes(o.status ?? ''));
  const teslimEdilenler = donem.filter(o => o.status === 'Delivered');
  const iptal = donem.filter(o => o.status === 'Cancelled').length;
  const aktif = donem.filter(o => AKTIF_DURUMLAR.includes(o.status ?? '')).length;

  const gun = gecenGunOrtalamasi(sevkEdilenler, simdi);
  const zam = zamanindaTeslimat(teslimEdilenler);

  return {
    donem,
    tarihsiz,
    sevkEdilen: sevkEdilenler.length,
    teslimEdilen: teslimEdilenler.length,
    iptal,
    aktif,
    dolulukOrani: oranYuzde(sevkEdilenler.length, donem.length),
    iptalOrani: oranYuzde(iptal, donem.length),
    zamanindaOrani: zam.oran,
    zamanindaOlculen: zam.olculen,
    zamanindaOlculemeyen: zam.olculemeyen,
    ortGecenGun: gun.ortalama,
    gunOlculen: gun.olculen,
    gunOlculemeyen: gun.olculemeyen,
  };
}

export interface IhracatSevkiyati { currency?: unknown; value?: unknown }

export interface IhracatBirimi { birim: string; tutar: Tutar }

export interface IhracatToplamlari {
  /** Para birimi başına ayrı toplam — sabit sırada (bkz. BIRIM_SIRASI). */
  birimler: readonly IhracatBirimi[];
  /** Para birimi okunamayan sevkiyatların tutarı — hiçbir birimin toplamına GİRMEZ, sayılır. */
  birimsiz: Tutar;
  /** Para birimi bilinse de tutarı bilinmeyen sevkiyat sayısı (tüm kovalar toplamı). */
  bilinmeyenTutar: number;
  kayit: number;
}

/**
 * Görüntüleme sırası SABİT. Tutar büyüklüğüne göre sıralamak YANILTIR: ₺150.000 ile $15.000 aynı eksende
 * karşılaştırılamaz, büyükten küçüğe dizmek "TL kalemi en büyük ihracat" izlenimi verir.
 */
const BIRIM_SIRASI = ['TRY', 'USD', 'EUR'];

/** ISO-4217 kodunu normalleştirir; okunamazsa null. Kod bir TANIMLAYICIDIR, ekrana basılan Türkçe metin
 *  değil — `paraYaz` da aynı normalizasyonu yapar (CLAUDE.md'nin Türkçe büyük-harf kuralı görünür metin içindir). */
function birimKodu(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  return s === '' ? null : s.toUpperCase();
}

/**
 * Phase 622 ihracat sevkiyatlarının para birimi BAŞINA toplamı. Tek bir "toplam değer" sayısı
 * üretmez: farklı birimler kur olmadan toplanamaz ve bu ekranda kur da yok (CLAUDE.md "kur yoksa
 * uydurma YOK"). Tutarı bilinmeyen sevkiyat kendi kovasında `bilinmeyen` olarak sayılır.
 */
export function ihracatToplami<T extends IhracatSevkiyati>(sevkiyatlar: readonly T[]): IhracatToplamlari {
  const kovalar = new Map<string, T[]>();
  const birimsizler: T[] = [];
  for (const sh of sevkiyatlar) {
    const birim = birimKodu(sh.currency);
    if (birim === null) { birimsizler.push(sh); continue; }
    const mevcut = kovalar.get(birim);
    if (mevcut) mevcut.push(sh); else kovalar.set(birim, [sh]);
  }

  const birimler = [...kovalar.entries()]
    .map(([birim, liste]) => ({ birim, tutar: toplaBilinen(liste, sh => sh.value) }))
    .sort((a, b) => {
      const ia = BIRIM_SIRASI.indexOf(a.birim), ib = BIRIM_SIRASI.indexOf(b.birim);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
      return a.birim < b.birim ? -1 : a.birim > b.birim ? 1 : 0;
    });

  return {
    birimler,
    birimsiz: toplaBilinen(birimsizler, sh => sh.value),
    bilinmeyenTutar: birimler.reduce((a, b) => a + b.tutar.bilinmeyen, 0),
    kayit: sevkiyatlar.length,
  };
}

/**
 * KPI kartı metni: '₺150.000 + $15.000 + €2.000'. Sevkiyat yoksa '—'. Bir kovanın hiçbir tutarı
 * bilinmiyorsa o kova '0' DEĞİL '— <BİRİM>' basar (birim kaybolmasın, sıfır uydurulmasın).
 * Dil'e bağlı metin YOK — çeviri gerekmez.
 */
export function ihracatToplamiYaz(s: IhracatToplamlari, ondalik = 0): string {
  if (s.birimler.length === 0) return '—';
  return s.birimler
    .map(b => {
      const deger = ekranTutari(b.tutar);
      return Number.isFinite(deger) ? paraYaz(deger, { birim: b.birim, ondalik }) : `— ${b.birim}`;
    })
    .join(' + ');
}

export interface MemnuniyetTalebi { satisfaction?: unknown }

/**
 * Destek bileti memnuniyet özeti. GEÇERLİ oy = 1-5 arası TAM SAYI (sayısal string kabul). Aralık dışı,
 * metin ya da boş puan oy sayılmaz — `oysuz` olarak sayılır. Hiç oy yoksa ortalama null ('—').
 */
export function memnuniyetOzeti(
  talepler: readonly MemnuniyetTalebi[],
): { ortalama: number | null; oy: number; oysuz: number } {
  let toplam = 0, oy = 0, oysuz = 0;
  for (const t of talepler) {
    const n = bilinenSayi(t.satisfaction) ? Number(t.satisfaction) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 5) { oysuz++; continue; }
    toplam += n;
    oy++;
  }
  return { ortalama: oy > 0 ? toplam / oy : null, oy, oysuz };
}

/** `memnuniyetOzeti().ortalama` kısayolu — puan yoksa null ('—'). */
export function memnuniyetOrtalamasi(talepler: readonly MemnuniyetTalebi[]): number | null {
  return memnuniyetOzeti(talepler).ortalama;
}
