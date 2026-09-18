/**
 * isletmeSermayesi.ts — Muhasebe → "İşletme Sermayesi" sekmesinin (IsletmeSermayesiTab.tsx 16-40) ve
 * "Verilerden Doldur" ön-doldurmasının (AccountingModule.tsx 970-983 prefillWC) HESAP katmanı
 * (Faz 3 2/n, 2026-09-14). Test: isletmeSermayesi.test.ts (önce yazıldı).
 *
 * NEDEN VAR — sahte kesinlik siteleri (2026-09-14 ölçümü):
 *   • IsletmeSermayesiTab.tsx 22  `cariOran = kv > 0 ? donen / kv : 0` → HİÇ borcu olmayan şirkete
 *     "0.00" ve kırmızı "Riskli" rozeti basıyor; alt metin de "Cari oran 0.00 — likiditeyi yakından
 *     izleyin" diyor. Borçsuz olmak likidite riski değildir; oranın paydası yoksa oran YOKTUR.
 *   • IsletmeSermayesiTab.tsx 32  `onChange={e => updateWC(field, Number(e.target.value) || 0)}` →
 *     alanı boşaltan kullanıcı "0 TL kasam var" demiş sayılıyor ve bu 0, settings/workingCapital'a
 *     KALICI yazılıyor; ertesi gün ekran hiç uyarmadan yanlış cari oran gösteriyor.
 *   • IsletmeSermayesiTab.tsx 32  `value={wc[field] || ''}` → GERÇEKTEN girilmiş 0 ile hiç girilmemiş
 *     alan ekranda birbirinin aynı (ikisi de boş); kullanıcı 0'ı yeniden yazmak zorunda kalıyor.
 *   • IsletmeSermayesiTab.tsx 19-21 `wc.a + wc.b + wc.c` → alan bilinmiyorsa (DB'den null) toplam
 *     sessizce NaN; ekranda "NaN ₺" yerine paraYaz '—' basmalı, hangi tarafın bilinmediği görünmeli.
 *   • AccountingModule.tsx 978    prefillWC `(Number(o.totalPrice) || 0)` → tutarı bilinmeyen
 *     ödenmemiş sipariş ₺0 alacak sayılıyor; sonuç KALICI ayara yazıldığı için hata silinmiyor.
 *   • AccountingModule.tsx 979    prefillWC `(Number(q) || 0) * (Number(costPrice) || 0)` → maliyeti
 *     girilmemiş stok kalemi ₺0 değerli; "Verilerden Doldur" stok kutusuna 0 yazıp cari oranı düşürüyor.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez,
 * SAYILIR, ekranda '—' olur; oranın paydası bilinmiyor ya da ≤ 0 ise oran null ('—'), "%0"/"0.00" basılmaz.
 * Boş liste GERÇEK 0'dır (hareketsiz dönem), bilinmeyen değil.
 *
 * SAYFA PARİTESİ (tüm kalemler biliniyorken sayı birebir aynı): dönen = kasa+alacak+stok;
 * KV = borç+vergi+kredi; net = dönen − KV; oran = dönen/KV; eşikler 1,5 → ideal, 1,0 → yeterli, altı riskli.
 * Ön-doldurmada dışlamalar AYNEN korunur: ödenmiş (`paid`), iptal (`status === 'Cancelled'`) ve
 * Mikro kaynaklı (`odemeTakipli`) siparişler alacağa girmez.
 *
 * BİLİNÇLİ FARKLAR: (1) KV ≤ 0 → `cariOran` null + durum 'borcsuz' (eski: 0 → "Riskli"). (2) Bir kalem
 * bilinmiyorsa o TARAF NaN, durum 'bilinmiyor'; öbür taraf yine hesaplanır (bilinen taraf gizlenmez).
 * (3) Ön-doldurma `Tutar` döner: kısmi toplam + "N kayıt tutarsız" sayacı — eski sessiz 0 yok.
 */
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';
import { odemeTakipli } from '../siparis';
import { depoToplamlari, type DepoKalemi } from './depoDeger';

// ── Girdiler: MİNİMAL ve yapısal — kanonik tiplere bağlı değil, DB'den null gelebilir ────────────
/**
 * İşletme sermayesi kalemleri. Alanlar `unknown`: tipte "number" yazması DOLU demek DEĞİL —
 * settings/workingCapital belgesi eski sürümlerde eksik alanla kaydedilmiş olabilir.
 */
export interface WCKalemleri {
  kasaBanka: unknown;
  ticariAlacaklar: unknown;
  stoklar: unknown;
  ticariBorclar: unknown;
  vergiSgk: unknown;
  krediler: unknown;
}

/** Ön-doldurmada okunan sipariş alanları (kanonik `Order` ve yerel türevleri yapısal olarak uyar). */
export interface PrefillSiparis {
  id?: string;
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
}

/** Ön-doldurmada okunan depo kalemi — depoDeger'in girdisiyle AYNI tip (kopya tanım yok). */
export type PrefillKalemi = DepoKalemi;

/**
 * Likidite durumu. 'borcsuz' = kısa vadeli yükümlülük yok/negatif → oran tanımsız (eski kod burada
 * "Riskli" basıyordu). 'bilinmiyor' = kalemlerden en az biri girilmemiş → ekran '—'.
 */
export type WCDurum = 'ideal' | 'yeterli' | 'riskli' | 'borcsuz' | 'bilinmiyor';

export interface WCSonuc {
  /** Dönen varlıklar (kasa/banka + ticari alacaklar + stoklar); bir kalem bilinmiyorsa NaN. */
  donen: number;
  /** Kısa vadeli yükümlülükler (ticari borçlar + vergi/SGK + krediler); bir kalem bilinmiyorsa NaN. */
  kv: number;
  /** Net işletme sermayesi = dönen − KV; taraflardan biri bilinmiyorsa NaN ('—'). */
  net: number;
  /** Cari oran = dönen / KV. Payda bilinmiyor ya da ≤ 0 ise null — "0.00" BASILMAZ. */
  cariOran: number | null;
  durum: WCDurum;
}

/** Bilinen sonlu sayı ya da NaN — `|| 0` / `?? 0` YOK (girilmemiş alan 0 sayılmaz). */
const oku = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);
/** Üç kalemin toplamı; biri bile bilinmiyorsa NaN (kısmi toplam bilanço tarafı olarak sunulamaz). */
const tarafToplami = (...kalemler: readonly unknown[]): number =>
  kalemler.reduce<number>((t, k) => t + oku(k), 0);

/**
 * Dönen/KV/net/cari oran ve likidite durumu. Ekran: `paraYaz(donen)` (NaN → '—'),
 * `cariOran === null ? '—' : cariOran.toFixed(2)`, rozet `durum`.
 */
export function isletmeSermayesi(wc: WCKalemleri): WCSonuc {
  const donen = tarafToplami(wc.kasaBanka, wc.ticariAlacaklar, wc.stoklar);
  const kv = tarafToplami(wc.ticariBorclar, wc.vergiSgk, wc.krediler);
  const net = donen - kv;
  if (!Number.isFinite(donen) || !Number.isFinite(kv)) return { donen, kv, net, cariOran: null, durum: 'bilinmiyor' };
  // Payda ≤ 0: oran tanımsız. Sıfıra bölmek Infinity, "0 yaz" ise yalan — ikisi de ekrana çıkmaz.
  if (kv <= 0) return { donen, kv, net, cariOran: null, durum: 'borcsuz' };
  const cariOran = donen / kv;
  const durum: WCDurum = cariOran >= 1.5 ? 'ideal' : cariOran >= 1 ? 'yeterli' : 'riskli';
  return { donen, kv, net, cariOran, durum };
}

export interface PrefillSonuc {
  /** Ödemesi Cetpa'da izlenen, iptal olmayan, ödenmemiş siparişlerin tutarı. */
  alacak: Tutar;
  /** Depo kalemlerinin maliyet × adet değeri (depoDeger.depoToplamlari). */
  stok: Tutar;
}

/**
 * "Verilerden Doldur" ön-doldurması: alacak = ödenmemiş siparişler, stok = depo değeri.
 *
 * Mikro faturasindan turetilen siparislerde `paid` YOKTUR — tahsilat gercegi Mikro cari hesabinda.
 * Suzgec olmadan bu buton, bilinmeyeni "alacak" sayip settings/workingCapital'a KALICI yaziyordu;
 * sonrasinda cari oran/likidite rakamlari silinmeyecek sekilde sisiyordu (2026-09-04 denetimi).
 *
 * Dönüş `Tutar`: `ekranTutari` ile kutuya yazılır (hiç bilinen yoksa NaN → '—'), `bilinmeyen > 0` ise
 * kullanıcıya "N kayıt tutarsız, dahil edilmedi" bildirilir. Kalıcı yazımda `tamTutar` de tercih
 * edilebilir; sayfa sözleşmesi kısmi değeri yazıp notu göstermektir.
 */
export function prefillDegerleri(
  siparisler: readonly PrefillSiparis[],
  kalemler: readonly PrefillKalemi[],
): PrefillSonuc {
  const alacaklilar = siparisler.filter(o => !o.paid && o.status !== 'Cancelled' && odemeTakipli(o));
  return {
    alacak: toplaBilinen(alacaklilar, o => o.totalPrice),
    stok: depoToplamlari(kalemler).deger,
  };
}

/**
 * Form alanı → state. Boş ya da sayısal olmayan metin NaN'dır (bilinmiyor), 0 DEĞİL —
 * eski `Number(e.target.value) || 0` alanı boşaltan kullanıcıyı "0 TL" beyan etmiş sayıyordu.
 */
export function wcGirdiOku(metin: string): number {
  return bilinenSayi(metin) ? Number(metin) : NaN;
}

/**
 * State → form alanı. Bilinen 0 '0' olarak GÖRÜNÜR (eski `wc[field] || ''` girilmiş sıfırı
 * bilinmeyenle aynı gösteriyordu); bilinmeyen boş kalır ve placeholder'ı devreye sokar.
 */
export function wcGirdiYaz(deger: unknown): string {
  return bilinenSayi(deger) ? String(Number(deger)) : '';
}
