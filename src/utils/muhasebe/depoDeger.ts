/**
 * depoDeger.ts — AccountingModule "Depolar" sekmesinin (WarehousesTab: depo kartı adet toplamı, envanter
 * detayı Toplam Adet / Stok Değeri, satır adedi, adet sıralaması) ve İşletme Sermayesi ön-doldurmasındaki
 * (prefillWC) stok değerinin HESAP katmanı (Faz 3 2/n, 2026-09-14). Test: depoDeger.test.ts (önce yazıldı).
 *
 * NEDEN VAR — sahte kesinlik siteleri (2026-09-14 ölçümü):
 *   • WarehousesTab.tsx 44 / 78  `reduce((s, wi) => s + (Number(wi.quantity) || 0), 0)` → adedi null/metin olan
 *     kalem 0 adet sayılıyor, kart "N adet" eksik basıyor, kimse fark etmiyor.
 *   • WarehousesTab.tsx 79       `(Number(wi.quantity) || 0) * (Number(costPrice) || 0)` → maliyeti bilinmeyen
 *     kalem ₺0 değerli; `WarehouseItem` tipinde `costPrice` alanı YOK (cast ile okunuyor) → toplam hep 0,
 *     sayfa `> 0 ? … : '—'` süzgeciyle "—" gösteriyor ama NEDEN bilinmediği (kaç kalem maliyetsiz) görünmüyor.
 *   • WarehousesTab.tsx 77       `(Number(b.quantity) || 0) - (Number(a.quantity) || 0)` → bilinmeyen adet
 *     listenin ortasına 0 gibi diziliyor.
 *   • WarehousesTab.tsx 125      `(Number(wi.quantity) || 0).toLocaleString('tr-TR')` → bilinmeyen adet "0".
 *   • AccountingModule.tsx 979   prefillWC `stok = Σ (quantity||0) × (costPrice||0)` → KALICI settings/
 *     workingCapital.stoklar'a 0 yazılıyor; cari oran/likidite o sahte 0'la hesaplanıyor.
 *
 * KURAL (CLAUDE.md): bilinmeyen adet/maliyet 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR (`bilinmeyen`),
 * ekranda '—' ya da "N kalem maliyetsiz". Toplamlar para.ts `Tutar`; ekran `ekranTutari` (hiç bilinen yokken
 * '—', kısmi → kısmi toplam + not); başka sayıya girecek değer (prefillWC → cari oran) `tamTutar` (bir kalem
 * bile bilinmiyorsa NaN — yazılmaz). Boş depo GERÇEK 0 (hareketsiz).
 *
 * SAYFA PARİTESİ (adedi ve maliyeti bilinen kalemde sayı aynı): adet = Σ quantity; değer = Σ costPrice × quantity
 * (para.ts `satirTutari`); sayısal string kabul (eski `Number(x)` gibi); bilinen 0 maliyet → değer 0 (tutarsız değil).
 * Kalem listesi sayfanın `depoKalemleriIcin` çıktısıdır — Mikro ürününün o depodaki miktarı depoBreakdown'dan
 * gelir, `bd[depoNo] ?? 0` orada GERÇEK 0'dır (o depoda yok), bilinmeyen değil; bu modül o süzgeci değiştirmez.
 *
 * BİLİNÇLİ FARKLAR: (1) costPrice alanı yok/null → kalem "maliyetsiz" SAYILIR (eski: sessiz ₺0). Bilinen 0 adet
 * için de maliyet aranır — finansalOranlar.stokDegeri'ndeki "0 stok → fiyat gerekmez" istisnası burada YOK
 * (görev spesifikasyonu; ayrı karar). (2) Tüm maliyetler biliniyor ve toplam 0 ise ekran '₺0,00' basar (eski `> 0`
 * süzgeci '—' basıyordu; gerçek 0 gizlenmez). (3) Bilinmeyen adet sıralamada sona gider (`sayiSirala`), 0 gibi ortaya
 * dizilmez. (4) Satır adedi bilinmiyorsa "—" (eski "0").
 */
import { bilinenSayi, satirTutari, toplaBilinen, type Tutar } from '../para';

// ── Girdi tipi: MİNİMAL ve yapısal — kanonik WarehouseItem (+ cast edilen costPrice) uyar, bağımlı değil ──
/** Depo kalemi: `quantity` o depodaki adet; `costPrice` birim maliyet (WarehouseItem tipinde yok, DB'de olabilir). */
export interface DepoKalemi { quantity?: unknown; costPrice?: unknown }

export interface DepoToplamlari {
  /** Σ quantity — adedi bilinmeyen (null/metin/NaN) kalem SAYILIR. */
  adet: Tutar;
  /** Σ costPrice × quantity — adet YA DA maliyet bilinmiyorsa kalem `bilinmeyen`e girer ("N kalem maliyetsiz"). */
  deger: Tutar;
}

/**
 * Depo (ya da tüm depolar) toplamları. Ekran: `ekranTutari(deger)` + `deger.bilinmeyen > 0` ise
 * "N kalem maliyetsiz" notu; adet kartı `ekranTutari(adet)` + `adet.bilinmeyen` notu. Prefill (kalıcı yazım):
 * `tamTutar(deger)` — NaN ise yazma.
 */
export function depoToplamlari(kalemler: readonly DepoKalemi[]): DepoToplamlari {
  return {
    adet: toplaBilinen(kalemler, k => k.quantity),
    deger: toplaBilinen(kalemler, k => satirTutari(k.costPrice, k.quantity)),
  };
}

/**
 * Adet metni (para değil, sembol yok): '3.000' / '1.250,5' — bilinmeyen '—' (eski `|| 0` "0" basıyordu).
 *
 * `dil` ADDITIVE (2026-09-22 delta bulgusu): yerel SABİT 'tr-TR'ydi, yani EN arayüzde de Türkçe
 * ayraç basıyordu. 'Target: 1.500' okuyan İngiliz kullanıcı için nokta ONDALIK ayracıdır → hedef
 * bin kat küçük okunur (RaporlarPage:493 P570 'Sipariş Adedi' hem gerçekleşeni hem hedefi basar).
 * Daraltma `rapor/bicim.yuzdeYaz` ile BİREBİR aynı desendir. Varsayılan 'tr': `dil` geçirmeyen
 * mevcut çağrılar (WarehousesTab, pano/stokSevkiyat, DashboardPage) DEĞİŞMEZ.
 */
export function adetYaz(x: unknown, dil: 'tr' | 'en' = 'tr'): string {
  return bilinenSayi(x) ? Number(x).toLocaleString(dil === 'tr' ? 'tr-TR' : 'en-US') : '—';
}
