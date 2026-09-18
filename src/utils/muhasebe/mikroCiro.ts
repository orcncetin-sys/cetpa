/**
 * mikroCiro.ts — Mikro faturalarından ciro/maliyet TOPLAMI, tek kaynak (Faz 3 2/n, grup "hook", 2026-09-18).
 * Test: mikroCiro.test.ts (ÖNCE yazıldı).
 *
 * NEDEN VAR — aynı üç satırlık hesap ÜÇ ekranda kopyaydı:
 *   FinancePanel   87-88     `mikroGiden.reduce((s, f) => s + f.tutar, 0)`
 *   SubeModule    179-180    şube+ay süzgeçli aynı reduce
 *   DashboardPage 171/432/496 `reduce((s, f) => s + (f.tutar || 0), 0)`  ← açık sahte sıfır
 * Hook grubu `MikroFatura.tutar`ı NaN (= bilinmiyor) yaptıktan sonra bu reduce'lar ya NaN'ı toplama
 * bulaştırır ya da `|| 0` ile eski sahte sıfıra geri düşerdi. Kural (CLAUDE.md): bilinmeyen tutar
 * toplama GİRMEZ, `Tutar.bilinmeyen` olarak SAYILIR; ekran `ekranTutari` + "N fatura tutarsız" notu.
 *
 * PARİTE: süzgeçler (yön / 'YYYY-MM' tarih öneki / şube no) sayfalardaki hâliyle AYNI —
 * tarihi boş fatura hiçbir döneme girmez, şube no çözülemezse o şubeye Mikro geliri EKLENMEZ
 * (yanlış şubeye yazmaktansa görünür boşluk; SubeModule'ün 2026-08 kararı korunuyor).
 *
 * Girdi tipi MİNİMAL ve yapısal (`MikroFatura`'ya bağlı DEĞİL) — yarım-düzeltme sınıfı tekrarlanmasın.
 */
import { bilinenSayi, toplaBilinen, tamTutar, type Tutar } from '../para';
import { odemeTakipli } from '../siparis';

/** Mikro faturasının bu modülün okuduğu alanları (useMikroFaturalar `MikroFatura` yapısal olarak uyar). */
export interface MikroCiroFaturasi {
  /** 'giden' = satış (ciro), 'gelen' = alış (maliyet). */
  yon?: string;
  /** Fatura toplamı; NaN/null/'' = BİLİNMİYOR. */
  tutar?: unknown;
  /** 'YYYY-MM-DD' beklenir; dönem süzgeci `startsWith` ile (hook zaten bu biçimde verir). */
  tarih?: unknown;
  /** cha_subeno. */
  subeNo?: unknown;
}

export interface MikroSuzgec {
  yon: 'giden' | 'gelen';
  /** 'YYYY', 'YYYY-MM' ya da 'YYYY-MM-DD' öneki. Verilmezse tarih süzgeci UYGULANMAZ. */
  tarihOneki?: string;
  /** Verilirse yalnız bu şube. Çözülemeyen şube no (undefined/NaN/metin) hiçbir faturayı eşleştirmez. */
  subeNo?: unknown;
}

/** Yön + (varsa) dönem + (varsa) şube süzgeci. Toplama YAPMAZ — sayım/liste isteyen ekranlar için ayrı. */
export function mikroFaturaSuz(
  faturalar: readonly MikroCiroFaturasi[],
  s: MikroSuzgec,
): MikroCiroFaturasi[] {
  // `subeNo` süzgeci İSTENDİ ama çözülemiyorsa hiçbir şey eşleşmemeli: eskiden sayfa
  // `Number.isFinite(subeNoNum) ? ...reduce : 0` ile aynı kararı veriyordu (şubesiz şubeye
  // Mikro geliri yazılmaz). Burada da öyle — `undefined` ise süzgeç HİÇ İSTENMEMİŞ demektir.
  const subeIstendi = s.subeNo !== undefined;
  if (subeIstendi && !bilinenSayi(s.subeNo)) return [];
  const sube = subeIstendi ? Number(s.subeNo) : null;

  return faturalar.filter(f => {
    if (f.yon !== s.yon) return false;
    if (s.tarihOneki !== undefined && !String(f.tarih ?? '').startsWith(s.tarihOneki)) return false;
    if (sube !== null && !(bilinenSayi(f.subeNo) && Number(f.subeNo) === sube)) return false;
    return true;
  });
}

/** Süzülen faturaların tutar toplamı. Bilinmeyen tutar toplama girmez, SAYILIR. Boş küme gerçek 0. */
export function mikroToplam(faturalar: readonly MikroCiroFaturasi[], s: MikroSuzgec): Tutar {
  return toplaBilinen(mikroFaturaSuz(faturalar, s), f => f.tutar);
}

/**
 * Ciro (giden/satış) ve maliyet (gelen/alış) birlikte.
 *
 * SINIR (FinancePanel'den taşınan not): "maliyet" burada GERÇEK COGS değil, ALIŞ FATURALARI
 * toplamıdır — Mikro fatura başlığında ürün maliyeti yok (aynı kısıt Finansal Oranlar'da da var).
 */
export function mikroCiroMaliyet(
  faturalar: readonly MikroCiroFaturasi[],
  tarihOneki?: string,
): { ciro: Tutar; maliyet: Tutar } {
  return {
    ciro:    mikroToplam(faturalar, { yon: 'giden', tarihOneki }),
    maliyet: mikroToplam(faturalar, { yon: 'gelen', tarihOneki }),
  };
}

/** Cetpa-native siparişin bu modülün okuduğu alanları (yapısal; FinancePanel'in yerel `Order`'ı uyar). */
export interface NativeCiroSiparisi {
  /** Sipariş tutarı; NaN/null/'' = BİLİNMİYOR. */
  totalPrice?: unknown;
  /** Sipariş maliyeti (düz alan); NaN/null/'' = BİLİNMİYOR. */
  cost?: unknown;
  /** 'mikro' önekli kaynak = Mikro faturasından türetilmiş kayıt. */
  source?: string;
}

/**
 * Cetpa-native siparişlerden ciro + maliyet — İKİ TOPLAM DA AYNI KÜMEDEN (Faz 3 2/n hakem turu,
 * 2026-09-18). Mikro kaynaklı (`source` 'mikro*') siparişler HER İKİSİNDEN de dışlanır.
 *
 * NEDEN — bulgu: ciro `orders.filter(odemeTakipli)` üzerinden, maliyet TÜM `orders` üzerinden
 * sayılıyordu. Mikro faturasından türetilen sipariş ciroya bilerek girmiyor (çift sayım koruması:
 * aynı fatura `mikroCiroMaliyet` tarafından zaten toplanıyor) ama maliyet kovasında kalıyor ve
 * orada maliyeti YOKTUR (Mikro fatura başlığında ürün maliyeti yok — tasarım gereği). Eski
 * `(o.cost || 0)` bu kayıtlara sessizce ₺0 maliyet yazıyordu; `toplaBilinen` onları haklı olarak
 * "bilinmeyen" saydı ve `tamTutar` kapısı marjı + Net Kâr'ı KALICI '—' yaptı. Doğrusu: bu
 * kayıtların maliyeti "bilinmeyen" değil, BU KOVADA ARANMAYAN'dır — Mikro tarafının maliyeti
 * `mikroCiroMaliyet(...).maliyet` (alış faturaları) ile zaten ayrıca geliyor.
 *
 * `odemeTakipli` ile aynı süzgeç: adı tahsilat semantiğinden gelir ama tanımı "Mikro kaynaklı
 * DEĞİL"dir (src/utils/siparis.ts) — iki kovanın aynı kümede kalması için tek kaynak odur.
 */
export function nativeCiroMaliyet(
  siparisler: readonly NativeCiroSiparisi[],
): { ciro: Tutar; maliyet: Tutar } {
  const takipli = siparisler.filter(o => odemeTakipli(o));
  return {
    ciro:    toplaBilinen(takipli, o => o.totalPrice),
    maliyet: toplaBilinen(takipli, o => o.cost),
  };
}

/**
 * Kâr = gelir − gider, TÜRETME kapısıyla (`tamTutar`): bir kayıt bile bilinmiyorsa NaN.
 * "Kısmi gelir − tam gider" bir net kâr DEĞİL, bilinmeyen kadar yanlış bir sayıdır; ekran '—'
 * basar ve yanına "N kayıt tutarsız" notu düşer (bkz. para.ts ekranTutari/tamTutar ayrımı).
 */
export function birlesikKar(gelir: Tutar, gider: Tutar): number {
  return tamTutar(gelir) - tamTutar(gider);
}
