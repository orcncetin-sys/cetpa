/**
 * kasaBakiye.ts: Kasa ekranının kasa kaydı okuması ve kart bakiyesi (şartname «Mikro bağlantı A» A5.4, 2026-11-05).
 * Test: kasaBakiye.test.ts. Tek çağıran: `components/KasaModule.tsx`.
 *
 * NEDEN:
 *   • Mikro kasa importu `kasaAdi` / `currency` yazıyor, ekran `ad` / `doviz` okuyordu: Mikro kasaları kartta ADSIZ görünüyordu
 *     (hakem [11]). Okuma iki adı da tanır; `durum` / `sorumlu` için varsayılan UYDURULMAZ (yoksa boş kalır).
 *   • Kart bakiyesi `kasaHareketleri`'nden hesaplanıyor; Mikro kasa hareketleri AKTARILMIYOR (canlı `kasaHareketleri` 0). Mikro
 *     kasasının kartı yeşil «₺0» gösteriyordu: bu bir ölçüm değil. Mikro kasası + ona ait hareket yok → `null` (BİLİNMİYOR).
 *     Cetpa'da açılmış kasanın bütün hareketleri Cetpa'dadır: hareketsiz Cetpa kasası GERÇEK 0 (açık dal, `?? 0` değil).
 */

export type KasaDurumu = 'Aktif' | 'Pasif';

export interface KasaKaydi {
  id: string;
  ad: string;
  /** Döviz kodu (ekranın üçlüsü TRY / USD / EUR; başka kod gelirse olduğu gibi taşınır, ₺ toplamına girmez). */
  doviz: string;
  /** Yoksa boş (uydurulmaz). */
  sorumlu?: string;
  /** Yoksa boş (uydurulmaz). */
  durum?: KasaDurumu;
  /** `'mikro'` = Mikro kasa importundan; yoksa Cetpa'da açılmış. */
  source?: string;
  createdAt?: unknown;
}

const metin = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** `kasalar` belgesi → ekran kaydı. Ad: `ad`, yoksa Mikro'nun `kasaAdi`'sı; döviz: `doviz`, yoksa `currency`. Döviz sınıflandırma
 *  varsayılanı (`'TRY'`) ekranın eski kuralıyla aynı (₺ toplamı `doviz ?? 'TRY'`); para değeri değildir. */
export function kasaKaydiOku(id: string, veri: Readonly<Record<string, unknown>>): KasaKaydi {
  const durum = veri.durum === 'Aktif' || veri.durum === 'Pasif' ? veri.durum : undefined;
  return {
    id,
    ad: metin(veri.ad) ?? metin(veri.kasaAdi) ?? '',
    doviz: metin(veri.doviz) ?? metin(veri.currency) ?? 'TRY',
    ...(metin(veri.sorumlu) !== undefined ? { sorumlu: metin(veri.sorumlu) } : {}),
    ...(durum !== undefined ? { durum } : {}),
    ...(metin(veri.source) !== undefined ? { source: metin(veri.source) } : {}),
    ...(veri.createdAt !== undefined ? { createdAt: veri.createdAt } : {}),
  };
}

export interface KasaHareketiGirdisi { kasaId: string; tur: string; tutar: number }

/** Kart bakiyesi: kasanın hareketlerinden (Giriş +, Çıkış −). Mikro kasası + hareket yok → null (bilinmiyor). */
export function kasaKartBakiyesi(kasa: { id: string; source?: string }, hareketler: readonly KasaHareketiGirdisi[]): number | null {
  const kendi = hareketler.filter(h => h.kasaId === kasa.id);
  if (kendi.length === 0) {
    // Mikro kasasının hareketleri Cetpa'ya aktarılmıyor: hareket yokluğu «0» demek DEĞİL.
    if (kasa.source === 'mikro') return null;
    // Cetpa kasası: bütün hareketleri burada, hareketsizse gerçek 0.
    return 0;
  }
  return kendi.reduce((s, h) => s + (h.tur === 'Giriş' ? h.tutar : -h.tutar), 0);
}
