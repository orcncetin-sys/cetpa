/**
 * butceGercek.ts — Muhasebe → Bütçe sekmesi (MuhasebePage "Phase 113: Budget vs Actuals") hesapları. TEK KAYNAK.
 * Test: butceGercek.test.ts (ÖNCE yazıldı). Faz 3 1/n, 2026-09-13.
 *
 * NEDEN VAR: Panel dört yerde sahte kesinlik üretiyordu (MuhasebePage.tsx ~652-801):
 *   1. `totalMonthRevenue = monthOrders.reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *      → tutarı bilinmeyen (undefined/null/''/NaN) sipariş ciroya 0 olarak giriyor, "gerçekleşen"
 *        sessizce eksik çıkıyordu. Şimdi: `toplaBilinen` — bilinenler toplanır, bilinmeyen SAYILIR;
 *        ayın HİÇBİR siparişinin tutarı bilinmiyorsa ciro 0 DEĞİL bilinmiyor → bölümler NaN ('—'), oran null.
 *   2. `getBudget = budgets.find(b => b.dept === key)?.budgetTRY || 0`
 *      → değeri okunamayan bütçe kalemi 0 görünüyordu. Şimdi: kalem YOK → 0 (kullanıcı bütçe girmemiş;
 *        sayfa 0 girişini kaydı silerek saklar, gerçek sıfır), kalem VAR ama değer bilinmiyor → NaN ('—').
 *   3. `totalActual = DEPTS.reduce((s, d) => s + (actualSplit[d.key] || 0), 0)`
 *      → payı tanımlı olmayan bölüm 0 sayılıyordu. Şimdi: NaN + `paysizBolum` sayacı.
 *   4. `pct = budget > 0 ? Math.round(actual / budget * 100) : 0`
 *      → bütçesi olmayan bölüm "%0" gösteriyordu (hiç bütçenin %0'ı). Şimdi: `oran: null` ('—').
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez,
 * sayılır, ekranda '—' + "N kayıt tutarsız" notu. `paraYaz`/`tlYaz` NaN'ı zaten '—' basar.
 *
 * SAYFA PARİTESİ (bilinçli, değiştirilmedi): ay süzgeci `createdAt ?? syncedAt`; iptal/Mikro kaynaklı
 * kayıtlar dışlanmaz (sayfada da dışlanmıyordu — değiştirmek ayrı ürün kararı). Bölüm payları
 * (%12/%6/%10/%8/%3/%5) sayfadaki sezgisel sabitler; gerçek ERP maliyet merkezi kullanır.
 *
 * Girdi tipleri MİNİMAL: yalnız gerçekten okunan alanlar; kanonik `Order` da yerel türevler de
 * yapısal olarak uyar (yarım-düzeltme sınıfını önlemek için — bkz. siparis.ts).
 */
import { bilinenSayi, toplaBilinen } from '../para';
import { ayAnahtari } from '../zaman';

export interface ButceSiparisi { totalPrice?: unknown; createdAt?: unknown; syncedAt?: unknown }
export interface ButceKalemi { dept?: string; budgetTRY?: unknown }

/** Ciro → bölüm harcaması sezgisel payları (sayfadaki `actualSplit` sabitleri, toplam %44). */
export const GERCEKLESEN_PAYLARI: Readonly<Record<string, number>> = Object.freeze({
  satis: 0.12,
  pazarlama: 0.06,
  operasyon: 0.10,
  ik: 0.08,
  it: 0.03,
  genel: 0.05,
});

/** Seçili ayın ("YYYY-MM") siparişleri — `createdAt ?? syncedAt`; tarihi çözülemeyen hiçbir aya girmez. */
export function ayinSiparisleri<T extends ButceSiparisi>(siparisler: readonly T[], ay: string): T[] {
  if (!ay) return [];
  return siparisler.filter(o => ayAnahtari(o.createdAt ?? o.syncedAt) === ay);
}

/** Ayın cirosu: bilinen tutarlar toplanır, bilinmeyenler sayılır (eski `|| 0` reduce yerine). */
export function aylikCiro(siparisler: readonly ButceSiparisi[], ay: string): { toplam: number; bilinen: number; bilinmeyen: number } {
  return toplaBilinen(ayinSiparisleri(siparisler, ay), o => o.totalPrice);
}

/** Ciroyu paylarla bölümlere dağıtır; ciro bilinmiyorsa her bölüm NaN. Payı olmayan bölüm sonuçta YOK. */
export function gerceklesenDagilimi(ciroToplam: number, paylar: Readonly<Record<string, number>> = GERCEKLESEN_PAYLARI): Record<string, number> {
  const dagilim: Record<string, number> = {};
  for (const [bolum, pay] of Object.entries(paylar)) {
    dagilim[bolum] = Number.isFinite(ciroToplam) && Number.isFinite(pay) ? ciroToplam * pay : NaN;
  }
  return dagilim;
}

/**
 * Bölümün bütçesi (TRY). Kalem yok → 0 (girilmemiş = gerçek sıfır; sayfa 0'ı kaydı silerek saklar).
 * Kalem var ama değer okunamıyor → NaN (eski `|| 0` bunu 0 gösteriyordu).
 */
export function butceTutari(kalemler: readonly ButceKalemi[], bolum: string): number {
  const kalem = kalemler.find(k => k.dept === bolum);
  if (!kalem) return 0;
  return bilinenSayi(kalem.budgetTRY) ? Number(kalem.budgetTRY) : NaN;
}

export interface ButceKullanim { oran: number | null; asim: boolean; asimTutari: number | null }

/**
 * Bütçe kullanım yüzdesi ve aşım. Bütçe 0/bilinmiyor ya da gerçekleşen bilinmiyor → oran null,
 * aşım iddiası yok (eski kod bütçesiz bölüme "%0" basıyordu).
 */
export function butceKullanimi(butce: number, gerceklesen: number): ButceKullanim {
  if (!Number.isFinite(butce) || !Number.isFinite(gerceklesen) || butce <= 0) {
    return { oran: null, asim: false, asimTutari: null };
  }
  const asim = gerceklesen > butce;
  return { oran: Math.round((gerceklesen / butce) * 100), asim, asimTutari: asim ? gerceklesen - butce : null };
}

export interface ButceSatiri extends ButceKullanim {
  /** TRY; NaN = kalem var ama değer okunamıyor. */
  butce: number;
  /** TRY; NaN = bölümün payı tanımsız. */
  gerceklesen: number;
}

export interface ButceGercekOzeti {
  /** Ayın siparişleri: bilinen tutar toplamı + sayaçlar. */
  ciro: { toplam: number; bilinen: number; bilinmeyen: number };
  /** Bölüm bütçeleri toplamı; `bilinmeyen` = değeri okunamayan kalem sayısı. */
  butce: { toplam: number; bilinmeyen: number };
  /** Gerçekleşen toplamı (NaN = ayın hiçbir siparişinin tutarı bilinmiyor → '—'); `bilinmeyen` = tutarı bilinmeyen sipariş sayısı; `paysizBolum` = payı tanımsız bölüm sayısı. */
  gerceklesen: { toplam: number; bilinmeyen: number; paysizBolum: number };
  /** Bölüm anahtarı → satır (sayfanın DEPTS sırasıyla). */
  satirlar: Record<string, ButceSatiri>;
}

/**
 * Panelin tamamı tek çağrıda: ay süzgeci → ciro → dağılım → bölüm satırları → toplamlar.
 * `bolumler` sayfanın DEPTS anahtarları (varsayılan: payları tanımlı altı bölüm).
 */
export function butceGercekOzeti(
  siparisler: readonly ButceSiparisi[],
  kalemler: readonly ButceKalemi[],
  ay: string,
  bolumler: readonly string[] = Object.keys(GERCEKLESEN_PAYLARI),
  paylar: Readonly<Record<string, number>> = GERCEKLESEN_PAYLARI,
): ButceGercekOzeti {
  const ciro = aylikCiro(siparisler, ay);
  // Ayın HİÇBİR siparişinin tutarı bilinmiyorsa `toplaBilinen` 0 döner ama bu "harcama yok" DEĞİLDİR:
  // dağılım NaN → her bölüm '—', oran null, toplam NaN; sayfadaki "N siparişin tutarı bilinmiyor" notuyla
  // tutarlı (hakem, 2026-09-13). Kısmi bilinmeyen: bilinen ciro dağıtılır (alt sınır) + aynı not.
  const ciroBilinmiyor = ciro.bilinen === 0 && ciro.bilinmeyen > 0;
  const dagilim = gerceklesenDagilimi(ciroBilinmiyor ? NaN : ciro.toplam, paylar);

  const satirlar: Record<string, ButceSatiri> = {};
  let paysizBolum = 0; // payı tanımsız bölüm — ciro bilinmiyor diye NaN olan bölümle KARIŞMASIN
  for (const bolum of bolumler) {
    const butce = butceTutari(kalemler, bolum);
    const payiVar = Object.prototype.hasOwnProperty.call(dagilim, bolum);
    if (!payiVar) paysizBolum++;
    const gerceklesen = payiVar ? dagilim[bolum] : NaN;
    satirlar[bolum] = { butce, gerceklesen, ...butceKullanimi(butce, gerceklesen) };
  }

  const butceToplam = toplaBilinen(bolumler, b => satirlar[b].butce);
  // Payı olan bölümlerin toplamı (paysız bölüm NaN, atlanır); ciro bilinmiyorsa toplam da bilinmiyor.
  const gerceklesenToplam = ciroBilinmiyor ? NaN : toplaBilinen(bolumler, b => satirlar[b].gerceklesen).toplam;

  return {
    ciro,
    butce: { toplam: butceToplam.toplam, bilinmeyen: butceToplam.bilinmeyen },
    gerceklesen: { toplam: gerceklesenToplam, bilinmeyen: ciro.bilinmeyen, paysizBolum },
    satirlar,
  };
}
