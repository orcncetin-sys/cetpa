/**
 * Bir Mikro faturasının kalemleri — `/api/mikro/fatura/kalemler` (seri + sıra + yön; Mikro'dan canlı).
 * Tek istemci kapısı: sipariş detayı (Mikro faturasından türeyip kalemleri Cetpa'ya aktarılmamış sipariş) ve sipariş
 * fişi PDF'i bunu kullanır. (MikroFaturaDetay kendi effect'inde aynı ucu çağırır — o bileşen ayrı turda buna bağlanır.)
 */
import { authFetch } from './authFetch';
import type { KalemSaglamasi } from '../lib/stokFiyat';

export interface FaturaEvragi { seri: string; sira: string; yon: 'gelen' | 'giden' }
export type KalemSonucu = { ok: true; kalemler: Record<string, unknown>[] } | { ok: false; hata: string };

export async function mikroFaturaKalemleriGetir(e: FaturaEvragi, tr: boolean): Promise<KalemSonucu> {
  try {
    const r = await authFetch('/api/mikro/fatura/kalemler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seri: e.seri, sira: e.sira, yon: e.yon }),
    });
    const d = await r.json() as { success?: boolean; error?: string; kalemler?: Record<string, unknown>[] };
    if (!r.ok || !d.success) return { ok: false, hata: d.error || (tr ? 'Fatura kalemleri alınamadı.' : 'Failed to load invoice lines.') };
    return { ok: true, kalemler: Array.isArray(d.kalemler) ? d.kalemler : [] };
  } catch {
    return { ok: false, hata: tr ? 'Sunucuya ulaşılamadı.' : 'Server unreachable.' };
  }
}

/**
 * Siparişin Mikro faturası (yalnız faturadan türeyen sipariş: `source === 'mikro-fatura'` + `mikroEvrak.sira`).
 * Kalemleri Cetpa'ya ZATEN aktarılmışsa `null` (canlı okumaya gerek yok).
 */
export function kalemleriMikrodanOkunacak(o: {
  source?: string; lineItems?: readonly unknown[] | null; mikroEvrak?: { seri?: string; sira?: string } | null;
} | null | undefined): FaturaEvragi | null {
  if (!o || o.source !== 'mikro-fatura') return null;
  if ((o.lineItems ?? []).length > 0) return null;
  const sira = String(o.mikroEvrak?.sira ?? '').trim();
  if (!/^\d{1,12}$/.test(sira)) return null;
  return { seri: String(o.mikroEvrak?.seri ?? '').trim(), sira, yon: 'giden' };
}

/**
 * Mikro kalem tablosunun altındaki uyarılar — ekran (MikroSiparisKalemleri) ve sipariş fişi PDF'i AYNI metni basar
 * (inceleme 2026-09-25: PDF'te kısmi ara toplam / KDV uyarısız, tutmayan sağlama açıklamasız basılıyordu).
 */
export function mikroKalemNotlari(araBilinmeyen: number, kdvBilinmeyen: number, saglama: KalemSaglamasi | null, dil: string): string[] {
  const tr = dil === 'tr';
  const notlar: string[] = [];
  if (araBilinmeyen > 0) notlar.push(tr ? `${araBilinmeyen} kalemin neti hesaplanamadı — ara toplama girmedi.` : `${araBilinmeyen} line(s) could not be netted — excluded from subtotal.`);
  if (kdvBilinmeyen > 0) notlar.push(tr ? `${kdvBilinmeyen} kalemin KDV'si okunamadı — KDV toplamına girmedi.` : `${kdvBilinmeyen} line(s) with unreadable VAT — excluded from VAT total.`);
  if (saglama && !saglama.tutuyor && saglama.eksik === 0) {
    const f = (n: number) => n.toLocaleString(tr ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    notlar.push(tr
      ? `Sağlama tutmuyor: ara toplam + masraf + KDV = ₺${f(saglama.kalemToplami)}, fatura toplamı farklı (fark ₺${f(saglama.fark)}) — tevkifat, ÖTV ya da dağıtılamayan iskonto olabilir; faturayı Mikro'da kontrol edin.`
      : `Totals don't reconcile: subtotal + charges + VAT = ₺${f(saglama.kalemToplami)} (diff ₺${f(saglama.fark)}) — withholding, excise or undistributed discount; check the invoice in Mikro.`);
  }
  return notlar;
}

