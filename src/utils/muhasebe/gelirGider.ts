/**
 * gelirGider.ts — AccountingModule "Gelir/Gider" sekmesinin (GelirGiderTab: KPI kartları, yıllık grafik,
 * hesap kırılımı) HESAP katmanı (Faz 3 2/n, 2026-09-14). Test: gelirGider.test.ts (önce yazıldı).
 *
 * NEDEN VAR — AccountingModule.tsx 2098-2161'deki sahte kesinlik siteleri (2026-09-14 ölçümü):
 *   • 2133 `fisTutari = e.alacak || e.borc || 0`  → iki tarafı da bilinmeyen (DB null) fiş 0 sayılıp gelir
 *     eksik toplanıyor; sayısal string ('1500') reduce'a metin olarak giriyordu.
 *   • 2136 / 2148 `reduce((s, e) => s + e.borc, 0)` → tek bir null borç TÜM gider toplamını (KPI + o ayın
 *     çubuğu) NaN'a çeviriyor, hangi kayıt olduğu görünmüyordu.
 *   • 2121 / 2151 `reduce((s, f) => s + f.matrah, 0)` → Mikro matrahı bilinmeyen fatura burada SAYILIR.
 *     (Faz 3 2/n, 2026-09-18: hook ve sunucudaki sıfıra-zorlama kalktı — bilinmeyen matrah artık gerçekten
 *     buraya ulaşıp gelire '—' / "N kayıt tutarsız" bastırıyor.)
 *   • 2159 / 2161 `(breakdown[k] || 0) + …` → hesap kırılımında bilinmeyen 0.
 *   • 2100 / 2143 `if (!e.date) return false` → tarihsiz fiş SESSİZCE dönem dışı; sayılmıyordu.
 *
 * KURAL (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`bilinmeyen`),
 * ekranda '—' ya da "N kayıt tutarsız". Toplamlar para.ts `Tutar`; ekran `ekranTutari` (hiç bilinen yokken
 * '—', kısmi → kısmi toplam + not), NET `tamTutar` (bir kayıt bile bilinmiyorsa NaN — kısmi gelir − tam
 * gider bir net değildir). Boş dönem GERÇEK 0 (hareketsiz ay).
 *
 * SAYFA PARİTESİ (tutarı bilinen girdide sayı aynı): gelir = alacak hesabı 6xx fişleri (`fisTutari`) +
 * Mikro GİDEN matrahı; gider = borç hesabı 6xx/7xx/8xx fişlerinin BORCU; tarihsiz fiş hiçbir döneme girmez
 * (KDV bloğundaki "aylık P&L ile tutarlı" notu); aylık grafik seçili YILIN 12 ayı, aralıktan bağımsız;
 * Mikro kırılım anahtarı yalnız toplam > 0 iken (ya da bilinmeyen varken — satır '—' basabilsin diye).
 *
 * BİLİNÇLİ FARKLAR: (1) tarih çözümü zaman.ts `gunAnahtari` (YEREL gün) — eski `new Date('YYYY-MM-DD')`
 * UTC'ye sabitleyip TR'de doğru, UTC batısında bir gün kayık çalışıyordu; aralık kıyası da gün anahtarı
 * üstünden, saatli tarih son günde artık dahil (eski string kıyası '…T12:00' <= '2026-08-31'ı düşürüyordu).
 * (2) `fisTutari`: alacak bilinen 0 + borç bilinmiyor → NaN (eski `|| 0` bunu 0 sayıyordu; tutar borçta
 * olabilirdi). (3) `tarihsiz` sayacı yeni: yalnız gelir/gider fişleri + Mikro giden (ilgisiz hesap ve
 * Mikro alış sayılmaz).
 */
import { bilinenSayi, toplaBilinen, tutarBirlestir, tamTutar, ekranTutari, type Tutar } from '../para';
import { gunAnahtari } from '../zaman';

// ── Girdi tipleri: MİNİMAL ve yapısal — kanonik JournalEntry / MikroFatura uyar, bağımlı değil ──
export interface GgFis { date?: unknown; debitHesap?: string; alacakHesap?: string; borc?: unknown; alacak?: unknown }
export interface GgMikroFatura { yon?: string; tarih?: unknown; matrah?: unknown }
/** Seçili dönem: ay/yıl; `aralik.from` ve `.to` İKİSİ de doluysa aralık modu (eski `gelirUseRange && from && to`). */
export interface GgDonem { yil: number; ay: number; aralik?: { from?: string; to?: string } | null }

export interface GelirGiderAyi { ay: number; gelir: Tutar; gider: Tutar }
export interface GelirGiderOzeti {
  gelir: Tutar;
  gider: Tutar;
  /** tamTutar(gelir) − tamTutar(gider); herhangi bir kayıt bilinmiyorsa NaN → ekran '—'. */
  net: number;
  /** Seçili yılın 12 ayı (ay 1..12), aralıktan bağımsız. */
  aylik: GelirGiderAyi[];
  /** Ekleme sırası: Mikro anahtarı önce, sonra fiş hesapları (eski Object.entries sırası). */
  gelirKirilimi: Record<string, Tutar>;
  giderKirilimi: Record<string, Tutar>;
  /** Tarihi çözülemeyen gelir/gider fişi + Mikro giden faturası — döneme GİRMEDİ, sayfa not düşer. */
  tarihsiz: number;
}

/** Mikro satış faturalarının gelir kırılımındaki anahtarı (sayfadaki sabit metin). */
export const MIKRO_SATIS_HESABI = '600 - Yurt İçi Satışlar (Mikro)';

const hesapKodu = (x: unknown): string => (typeof x === 'string' ? x : '');
/** Gelir fişi: alacak hesabı 6xx. */
export const gelirFisiMi = (e: GgFis): boolean => hesapKodu(e.alacakHesap).startsWith('6');
/** Gider fişi: borç hesabı 6xx / 7xx / 8xx. */
export const giderFisiMi = (e: GgFis): boolean => /^[678]/.test(hesapKodu(e.debitHesap));

/**
 * Bir gelir fişinin tutarı. `alacak ?? borc` DEĞİL, `alacak || borc`.
 *
 * NEDEN (2026-08-22 denetim bulgusu C2): `??` yalnız null/undefined'da
 * devreye girer, SAYISAL 0'da girmez. 2026-08-22 öncesi banka CSV import'u
 * fişleri TEK TARAFLI yazıyordu (borc=X, alacak=0) — o kayıtlar için
 * `alacak ?? borc` → 0 dönüyor ve aktarılmış tahsilatlar gelir tablosunda
 * 0 TL görünüyordu. Import artık dengeli yazıyor (borç=alacak) ama
 * VERİTABANINDAKİ ESKİ KAYITLAR öyle kaldı; `||` onları da kurtarır.
 * Dengeli fişte borç=alacak olduğundan `||` doğru sonucu değiştirmez.
 *
 * Faz 3 eki: sondaki `|| 0` YOK — bilinen sıfır-dışı taraf; yoksa iki taraf da BİLİNİYORSA 0 (gerçek
 * sıfır), aksi hâlde NaN (tutar bilinmiyor; `toplaBilinen` sayar). Sayısal string kabul (bilinenSayi).
 */
export function fisTutari(e: { alacak?: unknown; borc?: unknown }): number {
  const a = bilinenSayi(e.alacak) ? Number(e.alacak) : NaN;
  const b = bilinenSayi(e.borc) ? Number(e.borc) : NaN;
  if (Number.isFinite(a) && a !== 0) return a;
  if (Number.isFinite(b) && b !== 0) return b;
  return Number.isFinite(a) && Number.isFinite(b) ? 0 : NaN;
}

const ayAnahtariMetni = (yil: number, ay: number): string => `${yil}-${String(ay).padStart(2, '0')}`;

/** Gün anahtarı ('YYYY-MM-DD') için dönem süzgeci: aralık modu (iki sınır da dolu) ya da ay/yıl. */
const donemSuzgeci = (d: GgDonem): ((gun: string) => boolean) => {
  const aralik = d.aralik;
  if (aralik && aralik.from && aralik.to) {
    const from = gunAnahtari(aralik.from), to = gunAnahtari(aralik.to);
    // Çözülemeyen sınır hiçbir kaydı eşleştirmez — bugüne düşmez (zaman.ts ilkesi).
    return gun => from !== null && to !== null && gun >= from && gun <= to;
  }
  const ay = ayAnahtariMetni(d.yil, d.ay);
  return gun => gun.slice(0, 7) === ay;
};

/** Hesap bazında kırılım: aynı anahtara düşen kayıtların `Tutar`ı (bilinmeyen sayılır, 0 sayılmaz). */
function kirilim<T>(liste: readonly T[], anahtar: (e: T) => string, sec: (e: T) => unknown): Record<string, Tutar> {
  const gruplar = new Map<string, T[]>();
  for (const e of liste) {
    const k = anahtar(e);
    const g = gruplar.get(k);
    if (g) g.push(e); else gruplar.set(k, [e]);
  }
  const sonuc: Record<string, Tutar> = {};
  for (const [k, g] of gruplar) sonuc[k] = toplaBilinen(g, sec);
  return sonuc;
}

interface Gunlu<T> { kayit: T; gun: string | null }
const gunle = <T>(liste: readonly T[], tarih: (k: T) => unknown): Gunlu<T>[] => liste.map(kayit => ({ kayit, gun: gunAnahtari(tarih(kayit)) }));
const gunuOlan = <T>(liste: readonly Gunlu<T>[], sec: (gun: string) => boolean): T[] =>
  liste.filter((x): x is Gunlu<T> & { gun: string } => x.gun !== null && sec(x.gun)).map(x => x.kayit);

/** Native fiş + Mikro giden → gelir; native borç → gider. Dönem ve ay için aynı toplama. */
const topla = (fisler: readonly GgFis[], mikroGiden: readonly GgMikroFatura[]): { gelir: Tutar; gider: Tutar; nativeGelir: Tutar; mikroGelir: Tutar } => {
  const nativeGelir = toplaBilinen(fisler.filter(gelirFisiMi), fisTutari);
  const mikroGelir = toplaBilinen(mikroGiden, f => f.matrah);
  return { gelir: tutarBirlestir(nativeGelir, mikroGelir), gider: toplaBilinen(fisler.filter(giderFisiMi), e => e.borc), nativeGelir, mikroGelir };
};

/**
 * Gelir/Gider özeti — KPI (gelir/gider/net), seçili yılın aylık grafiği, hesap kırılımı.
 *
 * Mikro GİDEN (satış) faturaları GELİR tarafına eklenir (KDV/Satışlar'daki
 * additive desenin aynısı, 2026-08-13). Mikro GELEN (alış) faturaları
 * GİDER'e EKLENMEZ — alış tutarı stok (153-Ticari Mallar) hesabına düşer,
 * Gider'e ancak satış anında COGS (620) olarak yansır; Mikro fatura satırında
 * maliyet bilgisi olmadığından bu ayrım yapılamaz (Finansal Oranlar'daki
 * "COGS bilinmiyor" ilkesiyle tutarlı — yanlış bir gider rakamı üretmemek
 * için alış kasıtlı olarak dışarıda bırakıldı).
 */
export function gelirGiderOzeti(journalEntries: readonly GgFis[], mikroFaturalar: readonly GgMikroFatura[], donem: GgDonem): GelirGiderOzeti {
  // Yalnız gelir ya da gider fişi olabilecek kayıtlar; tarihsizleri SAYMAK için gün anahtarı bir kez çözülür.
  const fisler = gunle(journalEntries.filter(e => gelirFisiMi(e) || giderFisiMi(e)), e => e.date);
  const mikroGiden = gunle(mikroFaturalar.filter(f => f.yon === 'giden'), f => f.tarih);
  const tarihsiz = fisler.filter(x => x.gun === null).length + mikroGiden.filter(x => x.gun === null).length;

  const donemde = donemSuzgeci(donem);
  const donemFisleri = gunuOlan(fisler, donemde);
  const donemMikro = gunuOlan(mikroGiden, donemde);
  const { gelir, gider, mikroGelir } = topla(donemFisleri, donemMikro);
  const net = tamTutar(gelir) - tamTutar(gider); // gelir = alacak (kredi) + Mikro; gider = borç (debit) — yalnız native, bkz. yukarıdaki not

  const aylik: GelirGiderAyi[] = Array.from({ length: 12 }, (_, i) => {
    const ay = ayAnahtariMetni(donem.yil, i + 1);
    const ayda = (gun: string) => gun.slice(0, 7) === ay;
    const t = topla(gunuOlan(fisler, ayda), gunuOlan(mikroGiden, ayda));
    return { ay: i + 1, gelir: t.gelir, gider: t.gider };
  });

  const gelirKirilimi: Record<string, Tutar> = {};
  if (mikroGelir.toplam > 0 || mikroGelir.bilinmeyen > 0) gelirKirilimi[MIKRO_SATIS_HESABI] = mikroGelir;
  Object.assign(gelirKirilimi, kirilim(donemFisleri.filter(gelirFisiMi), e => hesapKodu(e.alacakHesap), fisTutari));
  const giderKirilimi = kirilim(donemFisleri.filter(giderFisiMi), e => hesapKodu(e.debitHesap), e => e.borc);

  return { gelir, gider, net, aylik, gelirKirilimi, giderKirilimi, tarihsiz };
}

/**
 * Çubuk grafiğin ölçek tavanı: bilinen ay değerlerinin (ekran sözleşmesi) en büyüğü, taban 1
 * (eski `Math.max(…, 1)` — sıfıra bölme yok). Hiç bilineni olmayan ay ('—') NaN sızdırıp ölçeği bozmaz.
 */
export function grafikTavani(aylik: readonly GelirGiderAyi[]): number {
  return Math.max(1, ...aylik.flatMap(a => [ekranTutari(a.gelir), ekranTutari(a.gider)]).filter(Number.isFinite));
}

/**
 * Bir ay çubuğunun yükseklik yüzdesi; tutarı BİLİNMEYEN ay için null — çağıran onu gri taban
 * çubuğuyla çizer (DashboardPage'in 7 günlük eğilim grafiğindeki karar).
 *
 * NEDEN VAR (2026-09-18 delta turu): GelirGiderTab 187/192 yüksekliği satır içi hesaplıyordu —
 * `height: ${(d.gelir / maxChartVal) * 100}%`, `minHeight: d.gelir > 0 ? 4 : 0`. `monthlyData`
 * `ekranTutari` ile NaN taşıyabildiği için tutarı hiç bilinmeyen ay `height: "NaN%"` (tarayıcı
 * yok sayar) + `minHeight: 0` veriyordu: çubuk HİÇ çizilmiyor, yani HAREKETSİZ ayla aynı
 * görünüyordu — "o ay ciro yoktu" demek, sahte kesinlik. "N kayıt tutarsız" notu da yalnız
 * SEÇİLİ dönemin sayacından beslendiği için (ggOzeti.gelir.bilinmeyen) başka bir aydaki
 * bilinmeyen ekranda hiçbir iz bırakmıyordu.
 *
 * Bilinen değerlerde formül BİREBİR aynı (sayfa paritesi). Hareketsiz ay gerçek 0 → 0.
 */
export function cubukYuzdesi(deger: number, tavan: number): number | null {
  if (!Number.isFinite(deger) || !Number.isFinite(tavan) || tavan <= 0) return null;
  return (deger / tavan) * 100;
}
