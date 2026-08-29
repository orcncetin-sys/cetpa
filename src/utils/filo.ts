import type { Vehicle, Warehouse } from '../types';

/**
 * filo.ts — araç listesini Mikro depo kayıtlarıyla BİRLEŞTİRİR.
 *
 * ## Neden
 *
 * Mikro'da araçlar ayrı bir tablo değil: müşterinin 5 "deposunun" 3'ü araç
 * plakası (07 AGU 291, 07 ACR 832, 34 CGC 119 — DEPOLAR tablosundan geliyor,
 * QR transfer sistemi de bunları kullanıyor). `vehicles` koleksiyonunda ise
 * yalnız elle eklenen araç(lar) var. Sonuç: Canlı Sevkiyat'ta 1 araç
 * görünüyordu, oysa 3 araç tanımlı (2026-08-28 kullanıcı bildirimi:
 * "3 tane araç tanımlı aslında, araçları depo QR etiketlerde görebilirsin").
 *
 * Bu yardımcı, `warehouses` içindeki PLAKA-adlı kayıtları araç olarak türetir
 * ve `vehicles` ile birleştirir (plaka bazında tekilleştirme — elle eklenen
 * kayıt kazanır, çünkü sürücü/telefon bilgisi orada olur).
 *
 * Türetilmiş araçların id'si `wh-<warehouseDocId>` — kalıcı ve deterministik,
 * yani `vehiclePositions/<id>` konum kaydı da kararlı kalır.
 */

/** TR plaka: "07 AGU 291", "34 CGC 119", "06ABC123" gibi. */
const PLAKA_DESENI = /^\d{2}\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}$/;

export function plakaMi(ad: string | undefined | null): boolean {
  return !!ad && PLAKA_DESENI.test(ad.trim().toUpperCase());
}

export function birlesikAraclar(vehicles: readonly Vehicle[], warehouses: readonly Warehouse[]): Vehicle[] {
  const plakalar = new Set(vehicles.map(v => v.plate.replace(/\s+/g, '').toUpperCase()));
  const turetilen: Vehicle[] = [];
  for (const w of warehouses) {
    const ad = (w.name ?? '').trim();
    if (!plakaMi(ad)) continue;
    const anahtar = ad.replace(/\s+/g, '').toUpperCase();
    if (plakalar.has(anahtar)) continue; // elle eklenen kayıt kazanır
    plakalar.add(anahtar);
    turetilen.push({
      id: `wh-${w.id}`,
      plate: ad.toUpperCase(),
      status: 'Müsait',
      // Sürücü/telefon Mikro depo kaydında yok — uydurulmaz, boş kalır.
    });
  }
  return [...vehicles, ...turetilen];
}
