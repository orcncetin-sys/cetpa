/**
 * kdvBeyan.ts — AccountingModule KDV Beyannamesi HESABI, tek kaynak (Faz 3 2/n, 2026-09-14).
 * Test: kdvBeyan.test.ts (ÖNCE yazıldı).
 *
 *   • KDV sekmesi KPI'ları (hesaplanan / indirilecek / ödenecek)   (AccountingModule ~2164-2181 → KdvTab)
 *   • Oran kırılımı tablosu (journal 6xx + Mikro giden bantları)  (~2182-2205 → KdvTab 160-180)
 *   • Beyanname PDF/CSV                                            (~655-716: kırılımdan okur)
 *   • KdvTab drill-down listeleri (391 / 191 fişleri)              (KdvTab ~60-95)
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK):
 *   ~2165-2169 `if (!e.date) return false; new Date(e.date).getMonth()`  tarihsiz fiş SESSİZCE düşüyordu; `new Date(string)` yasak
 *   ~2173-2176 `String(f.tarih || '').slice(0,4)`                       tarihsiz Mikro faturası sessizce düşüyordu
 *   ~2177-2178 `reduce(Number(f.kdv) || 0)`                              KDV'si bilinmeyen Mikro faturası 0 sayılıyordu
 *   ~2179-2180 `reduce(s + e.alacak)` / `s + e.borc`                     null → +0 (sessiz), undefined → NaN yayılır
 *   ~2181      `hesaplanan - indirilecek`                                kısmi toplamdan NET türetiliyordu
 *   ~2188-2189 `(e.kdvOran ?? 0) > 0` / `e.kdvOran ?? 0`                 oranı bilinmeyen gelir fişi kırılımdan SESSİZCE düşüyordu
 *   ~2133/2190 `fisTutari = alacak || borc || 0`                         iki tarafı da bilinmeyen fiş 0 matrah, 0 KDV
 *   ~2199      `String(Number(f.oran) || 0)`                             oranı çözülemeyen Mikro faturası "%0" bandına yazılıyordu
 *   ~2201-2202 `Number(f.matrah) || 0` / `Number(f.kdv) || 0`            bilinmeyen matrah/KDV 0
 *   KdvTab 69/87 `formatTRY(e.alacak || 0)` / `e.borc || 0`              drill-down satırında bilinmeyen ₺0
 *
 * Kural: bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`Tutar.bilinmeyen`); ekran
 * para.ts `ekranTutari` sözleşmesiyle basılır (hiç bilinen yoksa '—', aksi hâlde kısmi toplam + "N kayıt
 * tutarsız" notu). Ödenecek/İade KDV TÜRETMEDİR (`tamTutar` farkı): bir taraf bir kayıt bile bilinmiyorsa
 * NaN — "kısmi hesaplanan − tam indirilecek" bir net değil, bilinmeyen kadar yanlış bir sayıdır. Boş dönem
 * GERÇEK 0 (hareketsiz ay). Tarihi çözülemeyen kayıt hiçbir döneme düşmez, `tarihsiz` sayılır.
 *
 * KOPYA YOK: Mikro giden faturalarının oran bantları `butceVaryans.kdvBantlari` (Phase 617 KDV Mutabakat
 * ile aynı kova anahtarları: '20' | '10' | '0' | 'karma' | 'bilinmiyor'); dönem anahtarı
 * `babsKdvAnaliz.donemAnahtari` (zaman.ts `gunAnahtari` → YEREL gün, 'YYYY-MM-DD' UTC'ye sabitlenip batı
 * saat diliminde önceki aya kaymasın); toplama `para.toplaBilinen` / `tutarBirlestir`.
 *
 * SAYFA PARİTESİ ve bilinçli farklar:
 *   • Hesaplanan = journal `alacakHesap` 391 fişlerinin ALACAĞI + Mikro GİDEN KDV; indirilecek = journal
 *     `debitHesap` 191 fişlerinin BORCU + Mikro GELEN KDV. Sayfada KPI `=== '391 - Hesaplanan KDV'`,
 *     drill-down `startsWith('391')` diyordu — HESAP_PLANI'nda tek 391 / tek 191 hesabı var, ikisi aynı
 *     kümedir; burada KPI ve liste TEK süzgeç (`startsWith`) — kart ile drill-down artık ayrışamaz.
 *   • Kırılımda journal tarafı yalnız GELİR (alacakHesap 6xx) fişleri; matrah = `fisTutari`, KDV =
 *     matrah × oran/100 (sayfadaki formül). `kdvOran` bilinen ve ≤ 0 → KDV'siz, kırılım DIŞI (sayfa `> 0`).
 *     `kdvOran` BİLİNMEYEN (yok/null/NaN) → sayfa `?? 0` ile düşürüyordu, burada 'bilinmiyor' kovası:
 *     matrah bilinir, KDV bilinmez (tek fark; bilinen oranlarda sayı aynı).
 *   • Mikro oranı çözülemeyen (null, karma değil) fatura sayfada '0' bandına gidiyordu; burada
 *     'bilinmiyor' (kdvBantlari). Gerçek %0 faturası yine '0'. Mikro GELEN faturalar kırılıma girmez.
 *   • `mikroFaturalar` iptal edilmişleri zaten dışlamış gelir (server + client `_iptal`) — burada
 *     ek dışlama yok, sayfayla aynı.
 *   • Tarih: journal `e.date` ve Mikro `f.tarih` ('YYYY-MM-DD' | TR 'DD.MM.YYYY' | ISO | Date | Timestamp)
 *     `donemAnahtari` ile; sayfadaki `new Date()`/`slice` TR saat diliminde aynı ayı verir.
 *
 * Girdi tipleri MİNİMAL ve yapısal (`JournalEntry`/`MikroFatura`'ya bağlı DEĞİL) — yerel daraltılmış tipler
 * de uyar; yarım-düzeltme sınıfı (bkz. siparis.ts) tekrarlanmasın.
 */
import { bilinenSayi, toplaBilinen, tamTutar, tutarBirlestir, type Tutar } from '../para';
import { kdvBantlari, type KdvFaturasi } from './butceVaryans';
import { donemAnahtari } from './babsKdvAnaliz';
import { fisTutari } from './gelirGider';

export type { KdvFaturasi };

const sayi = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);
const bosTutar = (): Tutar => ({ toplam: 0, bilinen: 0, bilinmeyen: 0 });

/** Yevmiye fişinin bu modülün okuduğu alanları (types.ts `JournalEntry` yapısal olarak uyar). */
export interface YevmiyeKaydi {
  date?: unknown;
  debitHesap?: string;
  alacakHesap?: string;
  borc?: unknown;
  alacak?: unknown;
  kdvOran?: unknown;
}

// `fisTutari` TEK EVİ gelirGider.ts (kaynak sitesi AccountingModule ~2133 o gruptaydı; 2026-08-22 C2 açıklaması orada).
// İki grup paralel yazarken aynı fonksiyonu iki kez üretmişti — sözleşme aynıydı, kopya 2026-09-18'de silindi.
export { fisTutari } from './gelirGider';

/** Oran kovası: '20' | '10' | '0' | … | 'karma' | 'bilinmiyor'. */
export interface OranKovasi {
  matrah: Tutar;
  kdv: Tutar;
  /** Kovaya düşen kayıt (journal fişi + Mikro faturası) adedi. */
  adet: number;
  /** Matrahı YA DA KDV'si bilinmeyen kayıt sayısı (satır notu). */
  tutarsiz: number;
}

/** Drill-down satırı: kaydın kendisi (etiket/açıklama için) + tutarı (bilinmiyorsa NaN, 0 DEĞİL). */
export interface KdvSatiri<J> { kayit: J; tutar: number }

export interface KdvDonemi<J> {
  /** journal 391 alacak + Mikro giden KDV. Ekran: `ekranTutari`, not: `.bilinmeyen`. */
  hesaplanan: Tutar;
  /** journal 191 borç + Mikro gelen KDV. */
  indirilecek: Tutar;
  /** tamTutar(hesaplanan) − tamTutar(indirilecek): bir taraf KISMİ bile bilinmiyorsa NaN ('—'). ≥ 0 ödenecek, < 0 devreden. */
  odenecek: number;
  /** Anahtar sırası: journal kovaları karşılaşma sırasıyla, ardından Mikro bantları (azalan oran; karma/bilinmiyor sonda). */
  oranKirilimi: Record<string, OranKovasi>;
  hesaplananListesi: KdvSatiri<J>[];
  indirilecekListesi: KdvSatiri<J>[];
  /**
   * Tarihi çözülemeyen ve KDV'YE GİREBİLECEK kayıt adedi — hiçbir döneme giremez.
   * Kapsam: journal 391 alacak / 191 borç / 6xx gelir (oranı bilinen ve ≤ 0 olanlar hariç —
   * onlar kırılıma da girmiyor) + Mikro giden/gelen faturası.
   */
  tarihsiz: number;
}

/** `kdvOran` kovası: bilinen sayı → String(sayı); bilinmeyen → 'bilinmiyor'. (≤ 0 elemesi çağıranda.) */
const journalOranAnahtari = (kdvOran: unknown): string => (bilinenSayi(kdvOran) ? String(Number(kdvOran)) : 'bilinmiyor');

/**
 * Bu fiş KDV beyanına GİREBİLİR mi? — `tarihsiz` sayacının kapsamı.
 *
 * Aşağıdaki dönem süzgeçlerinin birleşimi: 391 alacak (hesaplanan), 191 borç (indirilecek),
 * 6xx alacak (oran kırılımı — oranı BİLİNEN ve ≤ 0 olan KDV'siz fiş kırılıma girmediği için
 * burada da sayılmaz; oranı BİLİNMEYEN fiş 'bilinmiyor' kovasına girer, sayılır).
 *
 * NEDEN VAR (2026-09-18 delta turu): sayaç eskiden hesap süzgecinden ÖNCE artıyordu ve tarihi
 * çözülemeyen HER yevmiye kaydı — 100→102 kasa virmanı gibi KDV ile ilgisi olmayanlar dahil —
 * KDV sekmesindeki nota giriyordu. Kardeş modül gelirGider.ts sayacını zaten süzgeçten sonra
 * artırıyor; aynı `journalEntries` iki sekmede iki farklı "tarihsiz" sayısı gösteriyordu.
 */
const kdvIlgili = (e: YevmiyeKaydi): boolean => {
  if ((e.alacakHesap ?? '').startsWith('391') || (e.debitHesap ?? '').startsWith('191')) return true;
  if (!(e.alacakHesap ?? '').startsWith('6')) return false;
  return !(bilinenSayi(e.kdvOran) && Number(e.kdvOran) <= 0);
};

const kovaEkle = (kirilim: Record<string, OranKovasi>, anahtar: string, matrah: Tutar, kdv: Tutar, adet: number, tutarsiz: number): void => {
  const k = kirilim[anahtar] ?? { matrah: bosTutar(), kdv: bosTutar(), adet: 0, tutarsiz: 0 };
  kirilim[anahtar] = { matrah: tutarBirlestir(k.matrah, matrah), kdv: tutarBirlestir(k.kdv, kdv), adet: k.adet + adet, tutarsiz: k.tutarsiz + tutarsiz };
};

/**
 * Seçili ayın (yil, ay 1-12) KDV beyanname özeti — journal fişleri + Mikro faturaları birlikte.
 *
 * Mikro faturalarından KDV özeti (2026-08-02): journalEntries boş — Mikro'da
 * muhasebe fişi yok. Satış faturası (giden) KDV'si = HESAPLANAN (391); alış
 * faturası (gelen) = İNDİRİLECEK (191). Seçili döneme (ay/yıl) filtrelenir.
 * mikroFaturalar zaten iptal edilmişleri dışlamış (server + client _iptal).
 *
 * Matrah yalnız gelir (alacakHesap 6xx) fişlerinden, oran bazında; KDV = matrah*oran.
 * (Önceki sürüm her borç satırından matrah uyduruyordu.)
 * string key: Mikro'dan gelen karma oranlı faturalar (2026-08-17, task #27,
 * #18'in devamı — bu KDV Beyannamesi PDF/CSV'sini besliyor) 'karma' adında
 * ayrı bir kovaya gider; tek f.oran'a göre kovalarsak KDV yanlış orana yazılır.
 * Mikro satış faturaları oran bazında (2026-08-02): tablo journalEntries'ten
 * türüyordu, o boş → tablo boştu. mikroFaturaSatirlari matrah/kdv/oran taşır.
 */
export function kdvDonemi<J extends YevmiyeKaydi, F extends KdvFaturasi>(
  journalEntries: readonly J[],
  mikroFaturalar: readonly F[],
  yil: number,
  ay: number,
): KdvDonemi<J> {
  const hedef = `${yil}-${String(ay).padStart(2, '0')}`;
  let tarihsiz = 0;

  const donemJournal: J[] = [];
  for (const e of journalEntries) {
    const d = donemAnahtari(e.date);
    // Tarihsiz sayacı YALNIZ KDV'ye girebilecek kayıtları sayar (bkz. kdvIlgili) — ilgisiz
    // virman notu şişirip gerçek KDV kaydını gölgeliyordu.
    if (d === null) { if (kdvIlgili(e)) tarihsiz++; continue; }
    if (d === hedef) donemJournal.push(e);
  }
  const donemMikro: F[] = [];
  for (const f of mikroFaturalar) {
    const d = donemAnahtari(f.tarih);
    // Giden KDV'si hesaplanana, gelen KDV'si indirilecege girer; başka bir yön değeri
    // hiçbir KPI'ya girmediği için sayılmaz da.
    if (d === null) { if (f.yon === 'giden' || f.yon === 'gelen') tarihsiz++; continue; }
    if (d === hedef) donemMikro.push(f);
  }
  const mikroGiden = donemMikro.filter(f => f.yon === 'giden');
  const mikroGelen = donemMikro.filter(f => f.yon === 'gelen');

  // KPI: journal 391 alacak / 191 borç + Mikro KDV — bilinmeyen sayılır, toplama girmez.
  const hesaplananFisleri = donemJournal.filter(e => (e.alacakHesap ?? '').startsWith('391'));
  const indirilecekFisleri = donemJournal.filter(e => (e.debitHesap ?? '').startsWith('191'));
  const hesaplanan = tutarBirlestir(toplaBilinen(hesaplananFisleri, e => e.alacak), toplaBilinen(mikroGiden, f => f.kdv));
  const indirilecek = tutarBirlestir(toplaBilinen(indirilecekFisleri, e => e.borc), toplaBilinen(mikroGelen, f => f.kdv));

  // Oran kırılımı: journal gelir fişleri (matrah × oran) …
  const oranKirilimi: Record<string, OranKovasi> = {};
  for (const e of donemJournal) {
    if (!(e.alacakHesap ?? '').startsWith('6')) continue;
    const anahtar = journalOranAnahtari(e.kdvOran);
    const oran = anahtar === 'bilinmiyor' ? null : Number(e.kdvOran);
    if (oran !== null && oran <= 0) continue; // KDV'siz/iade fişi — sayfadaki `> 0`; BİLİNMEYEN oran düşmez, 'bilinmiyor'a sayılır
    const matrah = fisTutari(e);
    const kdv = oran === null ? NaN : matrah * (oran / 100);
    const m = toplaBilinen([matrah], x => x), k = toplaBilinen([kdv], x => x);
    kovaEkle(oranKirilimi, anahtar, m, k, 1, m.bilinmeyen > 0 || k.bilinmeyen > 0 ? 1 : 0);
  }
  // … + Mikro giden bantları (butceVaryans.kdvBantlari — Phase 617 ile aynı kovalar).
  for (const b of kdvBantlari(mikroGiden)) kovaEkle(oranKirilimi, b.anahtar, b.matrah, b.kdv, b.adet, b.tutarsiz);

  return {
    hesaplanan,
    indirilecek,
    odenecek: tamTutar(hesaplanan) - tamTutar(indirilecek),
    oranKirilimi,
    hesaplananListesi: hesaplananFisleri.map(e => ({ kayit: e, tutar: sayi(e.alacak) })),
    indirilecekListesi: indirilecekFisleri.map(e => ({ kayit: e, tutar: sayi(e.borc) })),
    tarihsiz,
  };
}
