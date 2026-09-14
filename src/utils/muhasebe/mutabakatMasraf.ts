/**
 * mutabakatMasraf.ts — MuhasebePage Phase 550 (e-Mutabakat) + Phase 548 (Masraf Yönetimi)
 * hesapları, sayfadan çıkarıldı (Faz 3 1/n, 2026-09-13). Test: mutabakatMasraf.test.ts (önce yazıldı).
 *
 * NEDEN VAR — sayfadaki sahte kesinlik:
 *   Phase 550: `arMap[k].ar += o.totalPrice || o.totalAmount || 0` — tutarı bilinmeyen sipariş
 *              ₺0 alacak sayılıyor, satır "kapalı" rozeti alıyordu. `||` ayrıca meşru 0 tutarı
 *              totalAmount'a düşürüyordu (sunucu `??` kullanıyor: server.ts 2883/3157).
 *              Mikro kaynaklı siparişlerde (`source: 'mikro-*'`) `paid` alanı HİÇ yok; sayfa
 *              onları "ödenmedi" sayıp hem Mikro cari AR'ı hem sipariş satırını topluyordu
 *              (çifte sayım + ₺17,6M sahte alacak sınıfı, bkz. siparis.ts başlığı).
 *   Phase 548: `tlTopla(pending, m => m.amount || 0, …)` — tutarı bilinmeyen masraf 0 sayılıyor,
 *              kuru olsa bile 0 × kur = 0 "çevrildi" kovasına giriyordu (kurAtlanan'a değil).
 *              Sayfa-yerel `tlYap` global `isFinite` kullanıyordu (null → 0 → true) — hakem turunda
 *              (2026-09-13) ölü kopya olarak SİLİNDİ; çeviri artık currency.ts `tlyeCevir` (tek kaynak).
 *
 * KURAL (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR
 * (`bilinmeyen`), ekranda '—' + "N kayıt tutarsız" notu (sayfa kdvAylik `ekranTutari` ile basar:
 * hiç bilinen yokken '—', '₺0' değil). Kur yoksa uydurma yok (null).
 *
 * TEK KAYNAKLAR: sipariş tutarı siparis.ts `siparisTutari` (`totalPrice ?? totalAmount`, sunucuyla
 * aynı — nakitBilanco da aynı fonksiyonu kullanır, iki kopya yok); döviz→TL currency.ts `tlyeCevir`.
 *
 * Tipler yapısal ve MİNİMAL — kanonik `Order` şart değil (yarım düzeltme sınıfını önlemek için;
 * bkz. siparis.ts "TİPLER YAPISAL" notu).
 */
import { bilinenSayi, toplaBilinen } from '../para';
import { odemeTakipli, siparisTutari } from '../siparis';
import { tlyeCevir, type ExchangeRates } from '../currency';

// ── Phase 550: e-Mutabakat ──────────────────────────────────────────────────────────

export interface MutabakatSiparisi {
  customerName?: string;
  totalPrice?: unknown;
  totalAmount?: unknown;
  paid?: boolean;
  status?: string;
  source?: string;
  faturali?: boolean;
}

export interface MutabakatSatiri {
  name: string;
  /** Bilinen tutarların toplamı (Toplam Borç). */
  ar: number;
  /** `paid === true` ve tutarı bilinen siparişlerin toplamı. */
  paid: number;
  balance: number;
  bilinen: number;
  /** Tutarı bilinmeyen sipariş sayısı — ar/paid/balance bu kadar kayıt için EKSİK. */
  bilinmeyen: number;
  /** balance / ar; ar ≤ 0 ise null (0/0 "kapalı" değildir). */
  oran: number | null;
}

export type MutabakatDurum = 'kapali' | 'yuksek' | 'kismi' | 'belirsiz';

/**
 * Müşteri bazında alacak/tahsilat satırları, bakiye azalan sırada.
 * Dışlananlar (sayılır, satıra girmez): iptal; faturalı (Mikro carisine gitti, üstteki
 * cariBalanceToplam.ar'da); Mikro kaynaklı (`odemeTakipli` false — tahsilat gerçeği Mikro'da,
 * `paid` yokluğu "ödenmedi" değil).
 */
export function mutabakatSatirlari(siparisler: readonly MutabakatSiparisi[]): {
  satirlar: MutabakatSatiri[];
  disi: { iptal: number; faturali: number; mikro: number };
} {
  const disi = { iptal: 0, faturali: 0, mikro: 0 };
  const gruplar = new Map<string, MutabakatSiparisi[]>();
  for (const o of siparisler) {
    if (o.status === 'Cancelled') { disi.iptal++; continue; }
    if (o.faturali) { disi.faturali++; continue; }
    if (!odemeTakipli(o)) { disi.mikro++; continue; }
    const name = (o.customerName ?? '').trim() || '—';
    const grup = gruplar.get(name);
    if (grup) grup.push(o); else gruplar.set(name, [o]);
  }
  const satirlar: MutabakatSatiri[] = [];
  for (const [name, grup] of gruplar) {
    const { toplam: ar, bilinen, bilinmeyen } = toplaBilinen(grup, siparisTutari);
    const { toplam: paid } = toplaBilinen(grup.filter(o => o.paid === true), siparisTutari);
    const balance = ar - paid;
    satirlar.push({ name, ar, paid, balance, bilinen, bilinmeyen, oran: ar > 0 ? balance / ar : null });
  }
  satirlar.sort((a, b) => b.balance - a.balance);
  return { satirlar, disi };
}

/** Rozet: bilinmeyen tutar varsa 'belirsiz' — kısmi toplamdan "kapalı"/"yüksek" üretilmez. */
export function mutabakatDurumu(r: Pick<MutabakatSatiri, 'balance' | 'oran' | 'bilinmeyen'>): MutabakatDurum {
  if (r.bilinmeyen > 0) return 'belirsiz';
  if (r.balance <= 0) return 'kapali';
  return r.oran !== null && r.oran > 0.5 ? 'yuksek' : 'kismi';
}

/**
 * KPI kartları. `cariAr` = Mikro cari bakiyelerinin net pozitif toplamı (cariBalanceToplam.ar);
 * bilinmiyorsa (NaN/undefined) alacak ve bakiye NaN — ₺0 cari bakiye uydurulmaz.
 */
export function mutabakatOzeti(satirlar: readonly MutabakatSatiri[], cariAr: unknown): {
  toplamAlacak: number; tahsilEdilen: number; bakiye: number; bilinmeyen: number;
} {
  const cari = bilinenSayi(cariAr) ? Number(cariAr) : NaN;
  let ar = 0, paid = 0, balance = 0, bilinmeyen = 0;
  for (const r of satirlar) { ar += r.ar; paid += r.paid; balance += r.balance; bilinmeyen += r.bilinmeyen; }
  return { toplamAlacak: ar + cari, tahsilEdilen: paid, bakiye: balance + cari, bilinmeyen };
}

// ── Phase 548: Masraf Yönetimi ──────────────────────────────────────────────────────

export interface MasrafKaydi {
  amount?: unknown;
  currency?: string;
  status?: string;
}

export interface MasrafToplami {
  /** TL toplam — yalnız tutarı bilinen VE çevrilebilen kayıtlar. */
  toplam: number;
  bilinen: number;
  /** Tutarı bilinmeyen kayıt (undefined/null/''/NaN) — 0 sayılmaz, kur kovasına da girmez. */
  bilinmeyen: number;
  /** Tutarı bilinen ama kuru olmayan döviz kaydı — toplama KATILMAZ, kur gelince düzelir. */
  kurAtlanan: number;
  /** Kuru bulunamayan birimler, tekil ve sıralı (uyarı metni için). */
  kurEksikBirimler: string[];
}

/** Masraf kayıtlarını TL'ye çevirip toplar (currency.ts `tlyeCevir`); bilinmeyen tutar ve kursuz döviz AYRI sayılır. */
export function masrafToplami(kayitlar: readonly MasrafKaydi[], kurlar: ExchangeRates | null | undefined): MasrafToplami {
  let toplam = 0, bilinen = 0, bilinmeyen = 0, kurAtlanan = 0;
  const eksik = new Set<string>();
  for (const m of kayitlar) {
    if (!bilinenSayi(m.amount)) { bilinmeyen++; continue; }
    const tl = tlyeCevir(Number(m.amount), m.currency, kurlar);
    if (tl === null) { kurAtlanan++; eksik.add(String(m.currency)); continue; }
    toplam += tl; bilinen++;
  }
  return { toplam, bilinen, bilinmeyen, kurAtlanan, kurEksikBirimler: [...eksik].sort() };
}

/** Phase 548 KPI kartları: durum bazlı adet + TL toplam; kur uyarısı için birleşik sayaçlar. */
export function masrafOzeti(masraflar: readonly MasrafKaydi[], kurlar: ExchangeRates | null | undefined): {
  bekleyen: MasrafToplami & { adet: number };
  onaylanan: MasrafToplami & { adet: number };
  reddedilenAdet: number;
  toplamAdet: number;
  kurAtlanan: number;
  kurEksikBirimler: string[];
  bilinmeyen: number;
} {
  const bekleyenler = masraflar.filter(m => m.status === 'Bekliyor');
  const onaylananlar = masraflar.filter(m => m.status === 'Onaylandı');
  const bekleyen = { adet: bekleyenler.length, ...masrafToplami(bekleyenler, kurlar) };
  const onaylanan = { adet: onaylananlar.length, ...masrafToplami(onaylananlar, kurlar) };
  return {
    bekleyen, onaylanan,
    reddedilenAdet: masraflar.filter(m => m.status === 'Reddedildi').length,
    toplamAdet: masraflar.length,
    kurAtlanan: bekleyen.kurAtlanan + onaylanan.kurAtlanan,
    kurEksikBirimler: [...new Set([...bekleyen.kurEksikBirimler, ...onaylanan.kurEksikBirimler])].sort(),
    bilinmeyen: bekleyen.bilinmeyen + onaylanan.bilinmeyen,
  };
}
