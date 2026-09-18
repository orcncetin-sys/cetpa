/**
 * gelirTablosu.ts — Muhasebe → "Gelir Tablosu" sekmesinin (GelirTablosuTab.tsx) HESAP katmanı
 * (Faz 3 2/n, 2026-09-14). Test: gelirTablosu.test.ts (önce yazıldı).
 *
 * NEDEN VAR — sekmedeki sahte kesinlik siteleri (GelirTablosuTab.tsx, 2026-09-14 satırları):
 *   • 30-36 elle createdAt parse: `toDate()` yoksa `new Date(raw)`. dbClient Timestamp'i
 *     (`{_seconds,_nanoseconds}`) `Invalid Date` olur → sipariş SESSİZCE dönem dışı kalır
 *     (zaman.ts tuzak A); tarihsiz sipariş de hiç sayılmadan düşer.
 *   • 39-40 `s + o.totalPrice`: bir siparişin tutarı bilinmiyorsa NaN bütün tabloya yayılır —
 *     hangi satırın kaç kaydının eksik olduğu görünmez.
 *   • 45-46 `(o.lineItems || [])` + `(li.costPrice || 0) * li.quantity`: satırsız sipariş
 *     (Mikro faturasından türetilen) ve maliyeti girilmemiş satır 0 maliyetli → %100 brüt marj.
 *   • 51 / 61 `netSatislar > 0 ? … : 0`: ciro yokken "%0 marj" — rakam yok, bilgi yok.
 *   • 54 `(e.salary || 0)`: maaşı bilinmeyen aktif personel 0 gider sayılıyor, EBIT şişiyor.
 *   • 68 `vergionceKar > 0 ? … : 0`: kâr BİLİNMİYORKEN (NaN) karşılık ₺0 basılıyordu.
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama
 * girmez, SAYILIR. Satır toplamları `Tutar {toplam, bilinen, bilinmeyen}` döner: ekran
 * `ekranTutari` (kısmi toplam + "N kayıt tutarsız" notu; hiç bilinen yoksa '—'). Türetmeler
 * (net satış, brüt kâr, faaliyet kârı, vergi, net dönem kârı) `tamTutar` kapısından geçer: bir
 * kayıt bile bilinmiyorsa NaN ('—'). ORANLAR (marjlar) payda ≤ 0 ya da herhangi bir taraf
 * bilinmiyorsa null ('—'); "%0" basılmaz. Boş dönem GERÇEK 0 (hareketsiz ay), bilinmeyen değil.
 *
 * SAYFA PARİTESİ (tamamen bilinen veride aynı sayı — test "eski kodla birebir"):
 *   • Brüt satış = dönemdeki TÜM siparişler, iptal DAHİL; iptal ayrı "iade" satırında düşülür.
 *   • SMM = dönemdeki TÜM siparişlerin Σ costPrice × quantity — iptal DAHİL (sayfadaki gibi;
 *     iptalin maliyetini düşmek hesap sonucunu değiştirirdi → açık soru olarak bırakıldı).
 *   • Personel gideri yalnız `status === 'Aktif'`; `salaryCurrency` sayfadaki gibi yok sayılır
 *     (döviz maaş TL sayılıyor — açık soru).
 *   • Pazarlama / genel yönetim / finansman / diğer sabit 0 (yevmiyeden gelecek — sayfadaki gibi).
 *   • Kurumlar vergisi karşılığı: vergi öncesi kâr > 0 ise %20, zararda GERÇEK 0.
 *
 * BİLİNÇLİ FARKLAR:
 *   1. Dönem anahtarı karZarar `ayAnahtariYerel` (gunAnahtari tabanlı): Timestamp biçimi artık
 *      döneme girer; tarih-only string yerel gün olarak çözülür (UTC batısında bir gün kaymaz).
 *   2. Çözülemeyen tarih `tarihsiz` sayacında — sayfa "N sipariş tarihsiz" diyebilir.
 *   3. Bilinmeyen tutar tabloyu NaN'a boğmaz: satır kısmi toplam + sayaç, türetme NaN, oran null.
 *
 * karZarar.ayKarZarar İLE FARKI (bu yüzden onu çağırmıyor): P&L iptali dışlar, faturalı /
 * Mikro-türetme siparişini native gelirden çıkarıp Mikro giden faturayı ekler. Gelir Tablosu ise
 * dönemin TÜM siparişlerini brüte alır (iptal iade satırı), Mikro faturasına bakmaz. Ortak
 * yardımcılar paylaşılır: `ayAnahtariYerel` (aynı sipariş iki panelde aynı aya düşer),
 * `siparisMaliyeti` (COGS tek kaynak), `toplaBilinen` / `tamTutar` (para.ts).
 */
import { toplaBilinen, tamTutar, siparisMaliyeti, type Tutar, type MaliyetliSatir } from '../para';
import { ayAnahtariYerel } from './karZarar';

// ── Girdi tipleri: MİNİMAL ve yapısal — kanonik Order / Employee uyar, bağımlı değil ─────────
export type GtSatir = MaliyetliSatir;
export interface GtSiparis {
  id?: string;
  totalPrice?: unknown;
  status?: string;
  createdAt?: unknown;
  lineItems?: readonly GtSatir[] | null;
}
export interface GtPersonel { name?: string; salary?: unknown; status?: string }

/** %20 kurumlar vergisi — sayfadaki sabit (`vergiOrani = 0.20`). */
export const VERGI_ORANI = 0.20;

export interface GelirTablosu {
  /** Dönemdeki sipariş sayısı (iptal dahil) — başlık "N sipariş" ve boş-dönem durumu. */
  siparisSayisi: number;
  /** createdAt'i çözülemeyen sipariş (girdinin tamamında) — hiçbir döneme girmez, sayılır. */
  tarihsiz: number;
  /** I. Brüt satışlar — dönemdeki tüm siparişlerin totalPrice'ı. */
  brutSatis: Tutar;
  /** Satış iadeleri — iptal (`status === 'Cancelled'`) siparişler; brütün alt kümesi. */
  iade: Tutar;
  /** II. Net satışlar = brüt − iade; herhangi bir tutar bilinmiyorsa NaN. */
  netSatis: number;
  /** III. Satışların maliyeti — Σ siparisMaliyeti; satırsız / eksik satırlı sipariş SAYILIR. */
  smm: Tutar;
  /** IV. Brüt kâr = net − SMM; NaN = bilinmiyor. */
  brutKar: number;
  /** Yüzde (45.2 = %45,2); net ≤ 0 ya da bilinmiyor → null. */
  brutKarMarji: number | null;
  /** Aktif personel maaşları. */
  personel: Tutar;
  /** Yevmiyeden gelecek — şimdilik 0 sabit (sayfadaki gibi). */
  pazarlama: number;
  genelYonetim: number;
  /** V. Faaliyet giderleri = personel + pazarlama + genel yönetim (sayaçlar personelden). */
  faaliyetGideri: Tutar;
  /** VI. Faaliyet kârı (EBIT) = brüt kâr − faaliyet gideri; NaN = bilinmiyor. */
  faaliyetKari: number;
  faaliyetKarMarji: number | null;
  /** VII. Finansman gideri ve diğer — 0 sabit (sayfadaki gibi). */
  finansmanGideri: number;
  diger: number;
  /** VIII. Vergi öncesi kâr = faaliyet kârı + diğer − finansman; NaN = bilinmiyor. */
  vergiOncesiKar: number;
  /** Kurumlar vergisi karşılığı: kâr > 0 ise × VERGI_ORANI, zararda 0; kâr bilinmiyorsa NaN. */
  vergiKarsiligi: number;
  /** IX. Net dönem kârı = vergi öncesi − karşılık; NaN = bilinmiyor. */
  netDonemKari: number;
}

/** Marj (%): pay ve payda bilinir, payda > 0 → yüzde; aksi hâlde null — "%0" sahte kesinliktir. */
const marj = (pay: number, netSatis: number): number | null =>
  Number.isFinite(pay) && Number.isFinite(netSatis) && netSatis > 0 ? (pay / netSatis) * 100 : null;

/**
 * Gelir tablosu — `yil`/`ay` (1-12) dönemi. `siparisler` tüm siparişler (dönem burada süzülür),
 * `personel` çalışan listesi (yoksa gider gerçek 0).
 */
export function gelirTablosu(
  siparisler: readonly GtSiparis[],
  personel: readonly GtPersonel[] | null | undefined,
  yil: number,
  ay: number,
): GelirTablosu {
  // Filter orders for selected period
  const anahtar = `${yil}-${String(ay).padStart(2, '0')}`;
  const donem: GtSiparis[] = [];
  let tarihsiz = 0;
  for (const o of siparisler) {
    const k = ayAnahtariYerel(o.createdAt);
    if (k === null) { tarihsiz++; continue; }
    if (k === anahtar) donem.push(o);
  }

  // Revenue (Satış Gelirleri)
  const brutSatis = toplaBilinen(donem, o => o.totalPrice);
  const iade = toplaBilinen(donem.filter(o => o.status === 'Cancelled'), o => o.totalPrice);
  const netSatis = tamTutar(brutSatis) - tamTutar(iade);

  // COGS (Satışların Maliyeti) — sipariş sayılır (kalem değil); satırsız sipariş bilinmeyen.
  const smm = toplaBilinen(donem, siparisMaliyeti);

  const brutKar = netSatis - tamTutar(smm);
  const brutKarMarji = marj(brutKar, netSatis);

  // Operating Expenses (Faaliyet Giderleri)
  const personelGideri = toplaBilinen((personel ?? []).filter(e => e.status === 'Aktif'), e => e.salary);
  // Other op expenses approximated from journal entries if available
  const pazarlama = 0; // would come from journal entries
  const genelYonetim = 0;
  const faaliyetGideri: Tutar = {
    toplam: personelGideri.toplam + pazarlama + genelYonetim,
    bilinen: personelGideri.bilinen,
    bilinmeyen: personelGideri.bilinmeyen,
  };

  const faaliyetKari = brutKar - tamTutar(faaliyetGideri);
  const faaliyetKarMarji = marj(faaliyetKari, netSatis);

  // Financial items
  const finansmanGideri = 0;
  const diger = 0;
  const vergiOncesiKar = faaliyetKari + diger - finansmanGideri;
  // %20 kurumlar vergisi — kâr bilinmiyorsa karşılık da bilinmiyor (eski `> 0 ? … : 0` NaN'da ₺0 basıyordu).
  const vergiKarsiligi = Number.isFinite(vergiOncesiKar) ? (vergiOncesiKar > 0 ? vergiOncesiKar * VERGI_ORANI : 0) : NaN;
  const netDonemKari = vergiOncesiKar - vergiKarsiligi;

  return {
    siparisSayisi: donem.length, tarihsiz,
    brutSatis, iade, netSatis,
    smm, brutKar, brutKarMarji,
    personel: personelGideri, pazarlama, genelYonetim, faaliyetGideri,
    faaliyetKari, faaliyetKarMarji,
    finansmanGideri, diger, vergiOncesiKar, vergiKarsiligi, netDonemKari,
  };
}
