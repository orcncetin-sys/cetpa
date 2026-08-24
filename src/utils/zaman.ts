/**
 * zaman.ts — Zaman damgası çözümleme. TEK KAYNAK.
 *
 * NEDEN VAR (2026-08-24 tarih denetimi, 6 CONFIRMED bulgu):
 * Bu kod tabanında `createdAt` / `syncedAt` / `tarih` alanları DÖRT farklı
 * biçimde dolaşıyor ve her ekran kendi çözücüsünü elle yazmıştı:
 *
 *   1. `Timestamp` sınıfı (src/lib/dbClient.ts) — PG'den gelen
 *      `{_seconds,_nanoseconds}` bunun örneğine dönüşür
 *   2. ISO/tarih string'i — `"2026-08-24"` veya `"2026-08-24T12:00:00Z"`
 *      (Mikro sözde-siparişleri, B2BPortal, bazı istemci yazmaları)
 *   3. epoch number (ms)
 *   4. `Date` örneği
 *
 * İKİ ÖLÜMCÜL TUZAK — ikisi de canlıda bulundu:
 *
 * **A) `new Date(timestampÖrneği)` HER ZAMAN `Invalid Date` verir.**
 *    `Timestamp` sınıfının `toString`/`valueOf`'u YOK, dolayısıyla
 *    ToPrimitive `"[object Object]"` üretir. Karşılaştırmalar sessizce
 *    `false` döner. RaporlarPage'in KPI paneli tam bu yüzden ayın BÜTÜN
 *    Cetpa-native siparişlerini sayımdan düşürüyordu — hata vermeden.
 *
 * **B) `?? new Date()` / `|| now` yedeği "veri yok"u "BUGÜN"e çevirir.**
 *    Çözülemeyen tarih içinde bulunulan aya yazılır: bayii komisyonu
 *    şişer, vadesi geçmiş sipariş hiç gecikmiş görünmez. Bu yüzden
 *    buradaki işlevler **null döner** — çağıran "bilmiyorum"u görmek
 *    zorunda, sessizce bugüne düşemez.
 *
 * Ayrıca tarih-only string'lerde (`"2026-08-24"`) `new Date()` UTC gece
 * yarısına sabitler; `setHours(0,0,0,0)` ise YEREL gece yarısına. TR'de
 * (UTC+3) bu 3 saatlik fark gün farkına dönüşüyordu: bir fatura KPI'da
 * "gecikmiş", aynı satırın durum sütununda "Bekliyor" görünüyordu.
 * `gunBasi()` bu ikisini tek kurala bağlar.
 */

/** Firestore/dbClient Timestamp'ine benzeyen her şey. */
type ZamanBenzeri =
  | { toMillis?: () => number; toDate?: () => Date }
  | { _seconds?: number; _nanoseconds?: number }
  | { seconds?: number; nanoseconds?: number }
  | string | number | Date | null | undefined;

/**
 * Herhangi bir zaman damgası biçimini epoch milisaniyeye çevirir.
 * ÇÖZEMEZSE `null` döner — ASLA "şimdi"ye düşmez.
 */
export function zamanMs(v: ZamanBenzeri): number | null {
  if (v == null) return null;

  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;

  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    // Türk biçimi `DD.MM.YYYY` — `new Date()` bunu ya Invalid Date yapar ya
    // da AY/GÜN'ü ters okur. Açıkça ele alınır.
    const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (tr) {
      const d = new Date(Number(tr[3]), Number(tr[2]) - 1, Number(tr[1]));
      return Number.isFinite(d.getTime()) ? d.getTime() : null;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }

  const o = v as Record<string, unknown>;

  // Timestamp sınıfı (ve Firestore Timestamp'i)
  if (typeof o.toMillis === 'function') {
    const ms = (o.toMillis as () => number)();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof o.toDate === 'function') {
    const d = (o.toDate as () => Date)();
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
  }

  // Ham zarf — revive edilmemiş hâli (admin SDK / istemci SDK adları)
  const sn = typeof o._seconds === 'number' ? o._seconds
           : typeof o.seconds  === 'number' ? o.seconds : null;
  if (sn !== null) {
    const ns = typeof o._nanoseconds === 'number' ? o._nanoseconds
             : typeof o.nanoseconds  === 'number' ? o.nanoseconds : 0;
    return sn * 1000 + Math.floor(ns / 1e6);
  }

  return null;
}

/** `zamanMs`'in Date karşılığı. Çözemezse `null`. */
export function zamanDate(v: ZamanBenzeri): Date | null {
  const ms = zamanMs(v);
  return ms === null ? null : new Date(ms);
}

/**
 * YEREL gün başlangıcı (00:00:00.000). Gün/vade karşılaştırmaları BUNU
 * kullanmalı.
 *
 * Tarih-only bir string (`"2026-08-24"`) `Date.parse` ile UTC gece yarısına
 * sabitlenir; kullanıcının "bugün"ü ise yereldir. TR'de 3 saatlik bu fark
 * gecikme gününü bir gün eksik hesaplatıyordu. Burada her iki taraf da
 * yerel güne indirgenir, böylece fark tam gün cinsinden çıkar.
 */
export function gunBasi(v: ZamanBenzeri): Date | null {
  if (typeof v === 'string') {
    const s = v.trim();
    // Saat bilgisi OLMAYAN tarih string'ini YEREL gün olarak kur — UTC'ye
    // sabitlenip sonra yerelde okunmasın.
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const tr = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (tr) return new Date(Number(tr[3]), Number(tr[2]) - 1, Number(tr[1]));
  }
  const d = zamanDate(v);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * İki zaman arasındaki TAM GÜN farkı (a - b), yerel güne göre.
 * Herhangi biri çözülemezse `null`.
 */
export function gunFarki(a: ZamanBenzeri, b: ZamanBenzeri): number | null {
  const ga = gunBasi(a), gb = gunBasi(b);
  if (!ga || !gb) return null;
  return Math.round((ga.getTime() - gb.getTime()) / 86400000);
}

/**
 * Bir kaydın dönem anahtarı: `"YYYY-MM"`. Çözemezse `null`.
 * Ay/yıl karşılaştırmalarını `getMonth()+1` aritmetiğiyle elle yapmak yerine
 * bunu kullan — 0/1-tabanlı ay karışması ortadan kalkar.
 */
export function ayAnahtari(v: ZamanBenzeri): string | null {
  const d = zamanDate(v);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `"YYYY-MM-DD"` yerel gün anahtarı. Çözemezse `null`. */
export function gunAnahtari(v: ZamanBenzeri): string | null {
  const d = gunBasi(v);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
