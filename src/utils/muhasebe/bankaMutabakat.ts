/**
 * bankaMutabakat.ts — Muhasebe → Banka sekmesi hesapları TEK KAYNAK (Faz 3 1/n, 2026-09-13).
 * Test: bankaMutabakat.test.ts (önce yazıldı).
 *
 * NEDEN VAR: MuhasebePage'in Phase 118 (Banka Mutabakatı) ve Phase 638 (Otomatik Ödeme
 * Eşleştirme) panelleri para hesabını JSX içinde elle yapıyor ve dört yerde bilinmeyeni
 * sıfır sayıyordu (CLAUDE.md "sahte kesinlik gösterme" ihlali):
 *
 *   ~814  bookReceipts = reduce(s + (o.totalPrice || 0))
 *         → tutarı bilinmeyen tahsilat ₺0 girip "Hesaplanan Bakiye"yi ve "✓ Mutabık" rozetini
 *           yanıltıyordu
 *   ~820  reduce(s + po.totalAmount)      (PurchaseOrder.totalAmount OPSİYONEL)
 *         → tek bir undefined tüm toplamı NaN yapıp ekrana "₺NaN"/"—" düşürüyordu, neden yoktu
 *   ~865  setBankBalance(Number(draft) || 0)
 *         → boş/bozuk giriş "banka bakiyesi ₺0" oluyor, fark hesabına gerçek sayı gibi giriyordu
 *   ~998  invoiceAmount: o.totalPrice || 0   +   ~1002  (o.totalPrice || 0) === inv.invoiceAmount
 *         → iki bilinmeyen tutar 0 === 0 ile "Tam eşleşme, %100 güven" üretiyordu
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`bilinmeyen`); ekran kısmi toplamı '—' ya da
 * "N kayıt tutarsız" notuyla basar. Bilinmeyeni YA DA tarihsiz kaydı olan dönemde "Mutabık / Fark Var"
 * HÜKMÜ VERİLMEZ (`mutabik: null`) — tarihsiz ödenmiş sipariş / açık alış bu döneme ait olabilir, dönem
 * belirsizken hüküm de belirsizdir. Tutarı bilinmeyen fatura eşleştirilmez, sayılır.
 *
 * Formüller sayfadakiyle AYNI tutuldu (davranış değişmesin diye). Dikkat çeken bir nokta:
 * fark = bakiye − (bakiye + tahsilat − açıkAlış) = açıkAlış − tahsilat; yani "Açıklanamayan
 * Fark" banka bakiyesinden matematiksel olarak bağımsız. Bu panel TASARIMI sorusudur, burada
 * korunuyor — düzeltilecekse ayrı karar.
 */
import { bilinenSayi, toplaBilinen } from '../para';
import { odemeTakipli } from '../siparis';
import { ayAnahtari } from '../zaman';

// ── Phase 118: Banka Mutabakatı ──────────────────────────────────────────────────────────

/** Sayfanın `orders` kaydından bu hesabın ihtiyaç duyduğu alanlar — Order tipine bağımlı değil. */
export interface MutabakatSiparisi {
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  createdAt?: unknown;
  syncedAt?: unknown;
}

/** Sayfanın `apPurchaseOrders` kaydından gereken alanlar. */
export interface MutabakatAlisSiparisi {
  totalAmount?: unknown;
  status?: string;
  createdAt?: unknown;
}

export interface MutabakatGirdisi {
  siparisler: readonly MutabakatSiparisi[];
  alisSiparisleri: readonly MutabakatAlisSiparisi[];
  /** `<input type="month">` değeri: 'YYYY-MM'. */
  donem: string;
  /** Ekstredeki bakiye; bilinmiyorsa NaN / '' / undefined — 0 DEĞİL. */
  bankaBakiyesi: unknown;
  /** Mutabakat toleransı (₺). Varsayılan 1000 — sayfadaki `gapAbs < 1000`. */
  esik?: number;
}

export interface BilinenToplam { toplam: number; bilinen: number; bilinmeyen: number }

export interface MutabakatOzeti {
  /** + Tahsil edilen (ödendi): dönemde ödenmiş, ödemesi Cetpa'da izlenen siparişler. */
  tahsilat: BilinenToplam;
  /** − Açık satın alma siparişleri: dönemde açılmış, 'Teslim Alındı'/'İptal Edildi' olmayanlar. */
  acikAlis: BilinenToplam;
  /** Tarihi çözülemediği için döneme yerleştirilemeyen kayıt sayısı (toplama girmez). */
  tarihsiz: number;
  /** = Hesaplanan Bakiye. NaN ↔ banka bakiyesi bilinmiyor. */
  hesaplananBakiye: number;
  /** Açıklanamayan fark (bakiye − hesaplanan). NaN ↔ banka bakiyesi bilinmiyor. */
  fark: number;
  /** Rozet hükmü. null ↔ hüküm verilemez (bakiye, en az bir tutar ya da en az bir kaydın tarihi bilinmiyor). */
  mutabik: boolean | null;
  /** tahsilat.bilinmeyen + acikAlis.bilinmeyen — "N kayıt tutarsız" notu için. */
  bilinmeyen: number;
}

/** Kapanmış/iptal alış siparişi açık borç değildir — sayfadaki liste. */
const KAPALI_ALIS_DURUMLARI: ReadonlySet<string> = new Set(['Teslim Alındı', 'İptal Edildi']);

/** Ekstre bakiyesi girişi: boş/bozuk metin 0 DEĞİL bilinmiyor (NaN). Sayısal string kabul. */
export function bankaBakiyesiOku(metin: unknown): number {
  return bilinenSayi(metin) ? Number(metin) : NaN;
}

export function bankaMutabakati(g: MutabakatGirdisi): MutabakatOzeti {
  const esik = g.esik ?? 1000;
  let tarihsiz = 0;

  // Ödenmiş + ödemesi Cetpa'da izlenen (Mikro kaynaklı kayıtta `paid` anlamsız — siparis.ts).
  const donemTahsilatlari = g.siparisler.filter(o => {
    if (!odemeTakipli(o) || o.paid !== true) return false;
    const ay = ayAnahtari(o.createdAt ?? o.syncedAt);
    if (ay === null) { tarihsiz++; return false; }
    return ay === g.donem;
  });
  const donemAcikAlislari = g.alisSiparisleri.filter(po => {
    if (KAPALI_ALIS_DURUMLARI.has(po.status ?? '')) return false;
    const ay = ayAnahtari(po.createdAt);
    if (ay === null) { tarihsiz++; return false; }
    return ay === g.donem;
  });

  const tahsilat = toplaBilinen(donemTahsilatlari, o => o.totalPrice);
  const acikAlis = toplaBilinen(donemAcikAlislari, po => po.totalAmount);
  const bilinmeyen = tahsilat.bilinmeyen + acikAlis.bilinmeyen;

  const bakiye = bankaBakiyesiOku(g.bankaBakiyesi);
  // Sayfadaki formül birebir: estimated = bank + receipts − openAP; gap = bank − estimated.
  // TÜRETME kapısı (para.ts tamTutar kuralı, 2026-09-14 hakem turu): tutarı bilinmeyen kayıt varken kısmi
  // tahsilattan "hesaplanan bakiye" ve fark üretilmez — rozet zaten "hüküm verilemez" diyordu, rakam da '—'.
  const hesaplananBakiye = Number.isFinite(bakiye) && bilinmeyen === 0 ? bakiye + tahsilat.toplam - acikAlis.toplam : NaN;
  const fark = Number.isFinite(hesaplananBakiye) ? bakiye - hesaplananBakiye : NaN;
  // Tarihsiz kayıt bu döneme ait olabilir → dönem belirsizken de hüküm yok. Sayfadaki not zaten
  // "tarihsiz — mutabakat hükmü verilemedi" diyordu; rozet onunla çelişmesin (hakem, 2026-09-13).
  const mutabik = !Number.isFinite(fark) || bilinmeyen > 0 || tarihsiz > 0 ? null : Math.abs(fark) < esik;

  return { tahsilat, acikAlis, tarihsiz, hesaplananBakiye, fark, mutabik, bilinmeyen };
}

// ── Phase 638: Otomatik Ödeme Eşleştirme ─────────────────────────────────────────────────

export interface EslestirmeSiparisi {
  id: string;
  customerName?: string;
  totalPrice?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
}

/** Sayfadaki `p638MatchResults` state öğesiyle aynı şekil (useSekmeVerileri.ts). */
export interface EslestirmeSonucu {
  invoiceId: string;
  invoiceNo: string;
  customer: string;
  invoiceAmount: number;
  matchedAmount: number;
  confidence: number;
  status: 'Tam' | 'Kısmi' | 'Eşleşmedi';
}

/** Eşleştirmeye aday faturalar: ödenmemiş, iptal olmayan, ödemesi Cetpa'da izlenen. Sayfadaki `!o.paid` korunur. */
export function odenmemisFaturalar<T extends EslestirmeSiparisi>(siparisler: readonly T[]): T[] {
  return siparisler.filter(o => odemeTakipli(o) && !o.paid && o.status !== 'Cancelled');
}

/**
 * Sayfadaki puanlama korunur: aynı müşterinin AYNI tutarlı ödenmiş siparişi → Tam %100;
 * müşterinin başka ödemesi var → Kısmi %80 (tutarın %80'i, yuvarlak); hiç yok → Eşleşmedi %60.
 * Farklar: tutarı bilinmeyen fatura sonuç üretmez (`bilinmeyen` sayılır); tutarı bilinmeyen
 * ödeme tam eşleşme sayılmaz; müşteri adı boşsa aday aranmaz ('' === '' sahte eşleşmesi yok);
 * ad karşılaştırması kenar boşluğu kırpılarak yapılır.
 */
export function odemeEslestir(siparisler: readonly EslestirmeSiparisi[]): { sonuclar: EslestirmeSonucu[]; bilinmeyen: number } {
  const odenenler = siparisler.filter(o => odemeTakipli(o) && o.paid === true);
  const sonuclar: EslestirmeSonucu[] = [];
  let bilinmeyen = 0;

  for (const o of odenmemisFaturalar(siparisler)) {
    if (!bilinenSayi(o.totalPrice)) { bilinmeyen++; continue; }
    const invoiceAmount = Number(o.totalPrice);
    const customer = (o.customerName ?? '').trim();
    const adaylar = customer === '' ? [] : odenenler.filter(p => (p.customerName ?? '').trim() === customer);
    const tam = adaylar.some(p => bilinenSayi(p.totalPrice) && Number(p.totalPrice) === invoiceAmount);
    const confidence = tam ? 100 : adaylar.length > 0 ? 80 : 60;
    const matchedAmount = confidence === 100 ? invoiceAmount : confidence === 80 ? Math.round(invoiceAmount * 0.8) : 0;
    const status: EslestirmeSonucu['status'] = confidence === 100 ? 'Tam' : matchedAmount > 0 ? 'Kısmi' : 'Eşleşmedi';
    sonuclar.push({ invoiceId: o.id, invoiceNo: `INV-${o.id.slice(-6)}`, customer, invoiceAmount, matchedAmount, confidence, status });
  }
  return { sonuclar, bilinmeyen };
}

/** Kart sayaçları (Tam / Kısmi / Eşleşmedi). */
export function eslestirmeOzeti(sonuclar: readonly Pick<EslestirmeSonucu, 'status'>[]): { tam: number; kismi: number; eslesmedi: number } {
  let tam = 0, kismi = 0, eslesmedi = 0;
  for (const s of sonuclar) {
    if (s.status === 'Tam') tam++;
    else if (s.status === 'Kısmi') kismi++;
    else eslesmedi++;
  }
  return { tam, kismi, eslesmedi };
}

/**
 * "N faturanın tutarı bilinmiyor, eşleştirilemedi" notu için O(n) sayaç — render yolunda
 * `odemeEslestir(orders).bilinmeyen` (O(ödenmemiş × ödenmiş)) çağırmamak için.
 */
export function tutariBilinmeyenFaturaSayisi(siparisler: readonly EslestirmeSiparisi[]): number {
  return odenmemisFaturalar(siparisler).filter(o => !bilinenSayi(o.totalPrice)).length;
}
