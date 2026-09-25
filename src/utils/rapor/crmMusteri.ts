/**
 * crmMusteri.ts — CRM / müşteri hareketi: ciro köprüsü (Faz 3 6b, grup "utils-crm-musteri", 2026-09-24).
 * Test: crmMusteri.test.ts (ÖNCE yazıldı, kırmızı görüldü).
 *
 * ## Neden var
 * `components/reports/genel/GenelBloklar3.tsx:410-466` "Revenue Attribution Waterfall (MoM)" (HEAD 912d750):
 *   - `:430-431` `new Set(prevOrders.map(o=>o.customerName))` — müşteri AD METNİYLE gruplanıyor: `undefined` /
 *     '' / '—' TEK anahtara çöküyor; önceki ayda adsız tek sipariş varsa bu ayın TÜM adsız siparişleri "korunan
 *     müşteri" sayılıyor, aynı adlı iki firma tek müşteri, adı iki türlü yazılmış tek firma iki müşteri oluyor.
 *   - `:428-429, 432-434` `reduce((s,o)=>s+o.totalPrice,0)` — korumasız: eksik alanlı tek kayıt `prevRev`i NaN
 *     yapıyor, `:443` `Math.max(NaN, …, 1)` NaN → `:454` `maxVal>0` yanlış → TÜM çubuklar %0, `fmtAna(NaN)` '—'.
 *     Panel tek eksik tutar yüzünden SESSİZCE boşalıyor; `totalAmount` yedeği hiç okunmuyor.
 *   - `:443` `Math.max(…, 1)` sahte ölçek + `:454` `maxVal>0 ? … : 0` — bilinmeyen ile gerçek 0 aynı çizim.
 * Özdeşlik ise doğru kurulmuştu ve KORUNUR: `currRev − prevRev = newCustRev + (retainedRev − (prevRev − lostRev)) − lostRev`.
 * Bu modül onu "dört kalemin toplamı = net" değişmezi olarak kilitler (PLAN-v2 §3 Y24).
 *
 * ## UYGULANAN KULLANICI KARARLARI (KARARLAR.md — BAĞLAYICI), kullanıcının cümleleri:
 *   K4 · "Müşteriyi adla mı kimlikle mi gruplayacağız → kimlikle."
 *        Anahtar `musteriOzeti`nin ürettiği `anahtar`dır (`cari:` / `kayit:` / `ad:`). Bu modül KENDİ anahtarını
 *        ÜRETMEZ; kimliği de adı da olmayan sipariş satır olmaz, `kimliksiz` sayacına düşer.
 *   K2 · "İptaller ciroya girsin mi → hayır."
 *        Panelde ZATEN uygulanıyor (`:414-416`) → PARİTE. Süzgeç ÇAĞIRANDA; bu modül `status` OKUMAZ ve
 *        `tutarSec` içinde iptali NaN'a çevirmek YASAKTIR (`musteri.ts`: "bilinmeyen tutar" sayacını yalancı yapar).
 *   K28 (dönem tanımı; PLAN-v2.md karar tablosu #24 — KARARLAR.md'de kullanıcı cümlesi YOK, alıntı yapılmaz) ·
 *        parite + adlandırma — dönem ayrımı ÇAĞIRANDA, bu modül `Date` görmez.
 *
 * ## Parite
 * Tam veride (her siparişin tutarı ve müşterisi biliniyor, ad çakışması / yazım farkı yok) rakamlar eski formülle
 * BİREBİR: `yeni.tutar = newCustRev`, `-kaybedilen.tutar = lostRev`, `buyuyen.tutar + kuculen.tutar =
 * retainedRev − (prevRev − lostRev)`, `net = currRev − prevRev`, `oncekiTaban = prevRev`, `buTaban = currRev`
 * (test 1 eski formülü test içinde hesaplar).
 *
 * ## Bilinçli farklar (hepsi karar / sözleşme gereği)
 *   F1 K4 — aynı adlı FARKLI müşteriler AYRILIR, aynı kaydın farklı yazımları BİRLEŞİR; Cetpa kaydı + Mikro carisi
 *      `leadCariKodu` bağıyla TEK müşteri → üç kalem de değişebilir.
 *   F2 K4 — adsız/kimliksiz sipariş "korunan müşteri" değil; kalemlerden ÇIKAR, `kimliksiz` notuna düşer.
 *   F3 `tamTutar` — tutarı okunamayan sipariş TÜM paneli boşaltmaz; yalnız o MÜŞTERİ köprüden düşer, sayılır.
 *   F5 "Retained Growth" tek satır yerine `buyuyen` + `kuculen` iki kalem; toplamları eski tek satıra eşit.
 *   F6 Tabanlar artık KÖPRÜYE GİREN müşterilerin cirosu; dışlama varsa sayfadaki toplam cirodan düşük (not söyler).
 *
 * Saf modül: React / DB / metin / dil / tarih YOK. Bilmediği şeyler: takvim, `status`, `source`, `leadCariKodu`.
 * ÖZELLİKLE: iki dönemin `musteriOzeti` çağrısı AYNI `leadCariKodu` haritasıyla kurulmalıdır — farklı harita aynı
 * firmayı bir dönemde `kayit:L1`, diğerinde `cari:C1` yapar ve köprü "1 yeni + 1 kaybedilen" gösterir. Modül bunu
 * tespit EDEMEZ (hakem maddesi 1).
 */
import { tamTutar } from '../para';
import type { MusteriOzeti } from './musteri';

/** Selale kalemi. `tutar` İŞARETLİDİR: kaybedilen ve küçülen NEGATİF döner (çağıran `-` koymaz). */
export interface KopruKalemi {
  /** Bu kaleme giren BENZERSİZ müşteri sayısı. */
  musteri: number;
  /** İşaretli ciro etkisi. Köprüye hiç müşteri giremediyse NaN (bkz. "hiç kapsanan yok" kapısı). */
  tutar: number;
}

export interface CiroKoprusu {
  /** Köprüye GİREN müşterilerin ÖNCEKİ dönem cirosu — selalenin sol taban çubuğu. */
  oncekiTaban: number;
  /** Aynı müşterilerin BU dönem cirosu — sağ taban çubuğu. */
  buTaban: number;
  /** Dört kalemin İŞARETLİ toplamı. Değişmez: `oncekiTaban + net ≈ buTaban`. */
  net: number;
  /** Yalnız BU dönemde siparişi olan müşteri (+). */
  yeni: KopruKalemi;
  /** İki dönemde de var, farkı > 0 (+). */
  buyuyen: KopruKalemi;
  /** İki dönemde de var, farkı < 0 (−). */
  kuculen: KopruKalemi;
  /** Yalnız ÖNCEKİ dönemde siparişi olan müşteri (−). */
  kaybedilen: KopruKalemi;
  /** İki dönemde de var, farkı TAM 0 — kaleme girmez (tutarı 0), sayılır. */
  sabit: number;
  /** Köprüye giren benzersiz müşteri sayısı (dört kalem + `sabit`). */
  kapsananMusteri: number;
  /** Tutarı çözülemediği için köprüye GİRMEYEN benzersiz müşteri (iki dönemde de eksikse BİR kez sayılır). */
  tutarsizMusteri: number;
  /** O müşterilerin tutarı okunamayan SİPARİŞ sayısı (iki dönemin toplamı; dönemler kesişmez). */
  tutarsizSiparis: number;
  /** Kimliği de adı da olmayan sipariş — müşteri kırılımına giremez (`bu.kimliksiz + onceki.kimliksiz`). */
  kimliksiz: number;
}

/** Bir dönemin müşteri satırı — `MusteriOzeti`nin öğe tipi (ayrı içe aktarım açılmaz). */
type Satir = MusteriOzeti<unknown>['musteriler'][number];

/**
 * İki dönemin müşteri özetinden ciro köprüsü (selale).
 *
 * PARAMETRE SIRASI `para.donemKarsilastir(bu, onceki)` ile AYNI: **`bu` ÖNCE**. Sıra anlam taşır (ters çağrı
 * `yeni` ile `kaybedilen`i yer değiştirir) — test 14 kilitler.
 *
 * `MusteriOzeti<unknown>` bilerek: `ilk`/`son` alanları eşdeğişkendir, `MusteriOzeti<Order>` sorunsuz atanır.
 * Girdi MUTASYONA uğramaz (özetler, `musteriler` dizileri, `Tutar`lar yalnız okunur; yeniden sıralanmaz).
 */
export function ciroKopru(bu: MusteriOzeti<unknown>, onceki: MusteriOzeti<unknown>): CiroKoprusu {
  // Anahtar → satır. `musteriOzeti` anahtarı benzersiz üretir (Map kovası); burada yeniden kimlik ÜRETİLMEZ (K4).
  const buSatir = new Map<string, Satir>(bu.musteriler.map(m => [m.anahtar, m]));
  const oncekiSatir = new Map<string, Satir>(onceki.musteriler.map(m => [m.anahtar, m]));

  // Gezinme sırası: ÖNCE `bu`nun ilk-görülme sırası, SONRA yalnız `onceki`de olanlar. Sıra yalnız sayaçların
  // kararlılığı içindir; dönüşte liste yok.
  const anahtarlar: string[] = [...buSatir.keys()];
  for (const a of oncekiSatir.keys()) if (!buSatir.has(a)) anahtarlar.push(a);

  const yeni: KopruKalemi = { musteri: 0, tutar: 0 };
  const buyuyen: KopruKalemi = { musteri: 0, tutar: 0 };
  const kuculen: KopruKalemi = { musteri: 0, tutar: 0 };
  const kaybedilen: KopruKalemi = { musteri: 0, tutar: 0 };
  let oncekiTaban = 0;
  let buTaban = 0;
  let sabit = 0;
  let kapsananMusteri = 0;
  let tutarsizMusteri = 0;
  let tutarsizSiparis = 0;

  for (const a of anahtarlar) {
    const b = buSatir.get(a);
    const o = oncekiSatir.get(a);

    // Dönem tutarı — TÜRETME kapısı (`tamTutar`, `ekranTutari` DEĞİL): tek siparişi bile okunamayan müşterinin
    // farkı türetilmez — kısmi toplamdan çıkarılan fark "bilinmeyen kadar yanlış bir sayıdır" (`para.ts`).
    // Müşteri o dönemde HİÇ yoksa GERÇEK 0: iptal süzgecinden sonra o dönemde satışı yok — bilinmeyen DEĞİL.
    const bT = b ? tamTutar(b.ciro) : 0;
    const oT = o ? tamTutar(o.ciro) : 0;

    if (!Number.isFinite(bT) || !Number.isFinite(oT)) {
      // Dışlama: müşteri HİÇBİR kaleme girmez. Müşteri başına BİR kez sayılır (dönem başına değil —
      // "bilinmeyen sayaçları çift sayılmaz"). Sipariş sayacı iki dönemin `bilinmeyen`ini toplar: dönemler
      // kesişmez (çağıranın süzgeci ayrık). Müşteri o dönemde yoksa bilinmeyen siparişi de yoktur → 0 (bu bir
      // SAYAÇTIR, para değil; sahte kesinlik yasağı sayısal ölçüm içindir).
      tutarsizMusteri++;
      tutarsizSiparis += (b ? b.ciro.bilinmeyen : 0) + (o ? o.ciro.bilinmeyen : 0);
      continue;
    }

    kapsananMusteri++;
    oncekiTaban += oT;
    buTaban += bT;

    if (!o) {
      yeni.musteri++;
      yeni.tutar += bT;
    } else if (!b) {
      kaybedilen.musteri++;
      kaybedilen.tutar += -oT;
    } else {
      // `d >= 0 ? buyuyen : kuculen` YAZILMAZ: değişmeyen müşteriyi "büyüyen" saymak, eski `:439`
      // `>= 0 ? 'add'` kusurunun aynısıdır. Fark TAM 0 → `sabit` (hiçbir kaleme girmez).
      const d = bT - oT;
      if (d > 0) {
        buyuyen.musteri++;
        buyuyen.tutar += d;
      } else if (d < 0) {
        kuculen.musteri++;
        kuculen.tutar += d; // NEGATİF kalır — işaret modülde
      } else {
        sabit++;
      }
    }
  }

  // `net` = kalemlerin toplamı; `buTaban - oncekiTaban` olarak HESAPLANMAZ. Selalede kanıtlanan şey kalemlerin
  // toplamıdır, taban farkı ondan türer (kayan noktada kuruş altında sapabilir; test `toBeCloseTo(…, 6)`).
  const net = yeni.tutar + buyuyen.tutar + kuculen.tutar + kaybedilen.tutar;

  // "Hiç kapsanan yok" kapısı (`para.ekranTutari` emsali): bilinmeyen var, bilinen yok → tutarlar NaN, 0 DEĞİL
  // (ekran "Net değişim ₺0" yalanı basmasın). "Bilinmeyen" = tutarı okunamayan müşteri VEYA köprüye giremeyen
  // kimliksiz sipariş (inceleme 2026-09-25: yalnız kimliksiz siparişlerde tüm tutarlar gerçek 0 gibi dönüyordu).
  // Sayaçlar olduğu gibi döner. Tamamen boş girdi → gerçek 0.
  if (kapsananMusteri === 0 && (tutarsizMusteri > 0 || bu.kimliksiz + onceki.kimliksiz > 0)) {
    return {
      oncekiTaban: NaN,
      buTaban: NaN,
      net: NaN,
      yeni: { musteri: yeni.musteri, tutar: NaN },
      buyuyen: { musteri: buyuyen.musteri, tutar: NaN },
      kuculen: { musteri: kuculen.musteri, tutar: NaN },
      kaybedilen: { musteri: kaybedilen.musteri, tutar: NaN },
      sabit,
      kapsananMusteri,
      tutarsizMusteri,
      tutarsizSiparis,
      // Bir sipariş iki dönemde birden olamaz (çağıranın süzgeci ayrık) → toplanır. Satır değil NOT (K4).
      kimliksiz: bu.kimliksiz + onceki.kimliksiz,
    };
  }

  return {
    oncekiTaban,
    buTaban,
    net,
    yeni,
    buyuyen,
    kuculen,
    kaybedilen,
    sabit,
    kapsananMusteri,
    tutarsizMusteri,
    tutarsizSiparis,
    kimliksiz: bu.kimliksiz + onceki.kimliksiz,
  };
}
