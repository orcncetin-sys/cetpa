/**
 * Bir Mikro faturasının kalemleri — `/api/mikro/fatura/kalemler` (seri + sıra + yön; Mikro'dan canlı).
 * Tek istemci kapısı: sipariş detayı (Mikro faturasından türeyip kalemleri Cetpa'ya aktarılmamış sipariş) ve sipariş
 * fişi PDF'i bunu kullanır. (MikroFaturaDetay kendi effect'inde aynı ucu çağırır — o bileşen ayrı turda buna bağlanır.)
 */
import { authFetch } from './authFetch';
import { kalemleriCoz, kalemSaglamasi, saglamaKur, type KalemSaglamasi, type NetKaynagi } from '../lib/stokFiyat';
import { toplaBilinen, bilinenSayi, type Tutar } from '../utils/para';

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
 * Faturadan-sipariş importunun yazdığı SÜRÜM-2 kalemler (2026-09-25) — yalnız MF siparişinde ve TÜM kalemler sürüm 2
 * iken; aksi hâlde null (eski/karışık kalem kendi tablosunda, kalemsiz sipariş canlı okumada kalır). Detay ekranı ve
 * fiş bu TEK kuralla seçer.
 */
export function kayitliMikroKalemleri(o: { source?: string; lineItems?: readonly unknown[] | null } | null | undefined): KayitliMikroKalem[] | null {
  if (!o || o.source !== 'mikro-fatura') return null;
  const k = o.lineItems ?? [];
  if (k.length === 0) return null;
  return k.every(l => !!l && typeof l === 'object' && (l as { kalemSurumu?: unknown }).kalemSurumu === 2) ? (k as KayitliMikroKalem[]) : null;
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
  if (araBilinmeyen > 0) notlar.push(tr ? `${araBilinmeyen} kalemin tutarı çözülemedi — brüt, iskonto ve ara toplama girmedi.` : `${araBilinmeyen} line(s) could not be resolved — excluded from gross, discount and subtotal.`);
  if (kdvBilinmeyen > 0) notlar.push(tr ? `${kdvBilinmeyen} kalemin KDV'si okunamadı — KDV toplamına girmedi.` : `${kdvBilinmeyen} line(s) with unreadable VAT — excluded from VAT total.`);
  if (saglama && !saglama.tutuyor && saglama.eksik === 0) {
    const f = (n: number) => n.toLocaleString(tr ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    notlar.push(tr
      ? `Sağlama tutmuyor: ara toplam + masraf + KDV = ₺${f(saglama.kalemToplami)}, fatura toplamı farklı (fark ₺${f(saglama.fark)}) — tevkifat, ÖTV ya da dağıtılamayan iskonto olabilir; faturayı Mikro'da kontrol edin.`
      : `Totals don't reconcile: subtotal + charges + VAT = ₺${f(saglama.kalemToplami)} (diff ₺${f(saglama.fark)}) — withholding, excise or undistributed discount; check the invoice in Mikro.`);
  }
  return notlar;
}

/** Kalem tablosunun bir satırı — ekran ve fiş AYNI modeli basar. */
export interface MikroKalemSatiri {
  ad: string;
  sku: string | null;
  /** "100 ADET" / "100" / "—". */
  miktarMetni: string;
  /** Liste birim fiyatı: brüt ÷ miktar (KDV hariç, iskonto ÖNCESİ). Miktar 0/bilinmiyor → null ('—'). */
  birimFiyat: number | null;
  /** Satır iskontosu + satıra dağıtılmış fatura altı iskonto (brüt − net). Bilinmiyorsa null. */
  iskonto: number | null;
  /** İskonto satırda yazılı DEĞİL, fatura altı: 'baslik' = fatura toplamından satırlara dağıtıldı (doğrulanmış);
   *  'kdv' = başlıkla doğrulanamadı, satırın KDV'sinden TAHMİN (eski oranlı iskontosuz satırla aynı aritmetik —
   *  lib/stokFiyat BİLİNEN SINIR). Satır/iskontosuz kaynakta null. */
  faturaAltiKaynagi: 'baslik' | 'kdv' | null;
  /** KDV hariç net tutar (iskonto düşülmüş). */
  net: number | null;
}
export interface MikroKalemTablosu {
  satirlar: MikroKalemSatiri[];
  /** İskonto ÖNCESİ toplam (KDV hariç). */
  brut: Tutar;
  iskonto: Tutar;
  /** Net ara toplam (KDV hariç). */
  ara: Tutar;
  kdv: Tutar;
  /** Satır masrafları; sağlama kurulamadıysa (genel toplam bilinmiyor) null — gösterilmez, 0 UYDURULMAZ. */
  masraf: number | null;
  notlar: string[];
}

/**
 * K-İSKONTO (2026-09-25, kullanıcı: "iskontoları atlama"): Mikro kalemleri brüt birim fiyat + iskonto + net ile gösterilir;
 * eskiden yalnız iskonto düşülmüş net basılıyordu, iskonto görünmüyordu. TEK model: ekran (MikroSiparisKalemleri) ve sipariş
 * fişi PDF'i bunu kullanır — ikisi ayrı ayrı tablo kuruyordu (kopya kod), bir sütun birinde eklenip ötekinde unutulurdu.
 * Hesap lib/stokFiyat.kalemleriCoz (fatura detayı ve Fiyat Karşılaştırma ile AYNI; fatura altı iskonto başlıkla hakemlenir).
 */
export function mikroKalemTablosu(kalemler: readonly Record<string, unknown>[], genelToplam: unknown, dil: string): MikroKalemTablosu {
  const tr = dil === 'tr';
  const cozumler = kalemleriCoz(kalemler, genelToplam);
  const satirlar = kalemler.map((k, i): MikroKalemSatiri => {
    const c = cozumler[i];
    const birim = typeof k.birim === 'string' && k.birim ? ` ${k.birim}` : '';
    const miktar = c?.miktar ?? null;
    const sku = k.sth_stok_kod != null && String(k.sth_stok_kod).trim() ? String(k.sth_stok_kod).trim() : null;
    return {
      ad: String(k.urunAdi ?? '').trim() || sku || '—',
      sku,
      miktarMetni: miktar === null ? '—' : `${miktar}${birim}`,
      birimFiyat: c && c.brut !== null && miktar !== null && miktar > 0 ? c.brut / miktar : null,
      iskonto: c?.iskonto ?? null,
      faturaAltiKaynagi: faturaAltiKaynagi(c?.kaynak),
      net: c?.net ?? null,
    };
  });
  const brut = toplaBilinen(cozumler, c => c.brut);
  const iskonto = toplaBilinen(cozumler, c => c.iskonto);
  const ara = toplaBilinen(cozumler, c => c.net);
  const kdv = toplaBilinen(kalemler, k => k.sth_vergi);
  const saglama = kalemSaglamasi(kalemler, cozumler, genelToplam);
  const notlar = mikroKalemNotlari(ara.bilinmeyen, kdv.bilinmeyen, saglama, dil);
  notlar.push(...faturaAltiNotlari(satirlar, tr));
  return { satirlar, brut, iskonto, ara, kdv, masraf: saglama ? saglama.masraf : null, notlar };
}

/** İki fatura altı kaynağının notu — ham ve kalıcı tablo AYNI metni basar. */
function faturaAltiNotlari(satirlar: readonly MikroKalemSatiri[], tr: boolean): string[] {
  const notlar: string[] = [];
  // İnceleme 2026-09-25: iki fatura altı kaynağı AYNI cümleyle ("faturanın toplamından") basılıyordu; KDV'den türetilen
  // tahmin doğrulanmış iskonto gibi görünüyordu. Metinler Fiyat Karşılaştırma ile aynı dilde, kaynağa göre ayrı.
  const iskontolu = satirlar.filter(s => (s.iskonto ?? 0) > 0);
  if (iskontolu.some(s => s.faturaAltiKaynagi === 'baslik')) {
    notlar.push(tr
      ? 'İskontonun bir kısmı fatura altı iskontodur — satırda yazılı değil, fatura toplamından satırlara dağıtıldı.'
      : 'Part of the discount is an invoice-level discount — not on the line; allocated to lines from the invoice total.');
  }
  if (iskontolu.some(s => s.faturaAltiKaynagi === 'kdv')) {
    notlar.push(tr
      ? "Bazı satırların iskontosu satırda yazılı değil ve fatura toplamıyla doğrulanamadı — satırın KDV'sinden TAHMİN edildi (eski oranlı iskontosuz satır da olabilir); faturayı Mikro'da kontrol edin."
      : 'Some line discounts are not on the line and could not be verified against the invoice total — ESTIMATED from the line VAT (could also be an old-rate line without discount); check the invoice in Mikro.');
  }
  return notlar;
}

const faturaAltiKaynagi = (k: unknown): MikroKalemSatiri['faturaAltiKaynagi'] =>
  (k === 'faturaAltiBasliktan' ? 'baslik' : k === 'faturaAltiKdvden' ? 'kdv' : null);

/** Kalıcı (sürüm-2) MF sipariş kalemi — server/mikro/eslemeFatura SiparisSatiri'nin istemci okuması. */
export interface KayitliMikroKalem {
  sku?: unknown; name?: unknown; quantity?: unknown; birim?: unknown;
  brutTutar?: unknown; iskonto?: unknown; netTutar?: unknown; kdv?: unknown; masraf?: unknown; netKaynagi?: unknown;
}
const sayiYaDaNull = (x: unknown): number | null => (bilinenSayi(x) ? Number(x) : null);

/**
 * Faturadan-sipariş importunun YAZDIĞI (sürüm-2) kalemden aynı tablo modeli (2026-09-25): kalem Cetpa'ya aktarıldıktan
 * sonra detay ekranı ve fiş canlı Mikro okumasıyla AYNI sütunları (birim fiyat → iskonto → net) ve alt satırları basar.
 * Hesap importta yapıldı (lib/stokFiyat); burada yalnız okunur. Sağlama `saglamaKur` ile AYNI formül.
 */
export function kayitliKalemTablosu(kalemler: readonly KayitliMikroKalem[], genelToplam: unknown, dil: string): MikroKalemTablosu {
  const tr = dil === 'tr';
  const satirlar = kalemler.map((k): MikroKalemSatiri => {
    const miktar = sayiYaDaNull(k.quantity), brutT = sayiYaDaNull(k.brutTutar);
    const sku = String(k.sku ?? '').trim() || null;
    const birim = typeof k.birim === 'string' && k.birim ? ` ${k.birim}` : '';
    return {
      ad: String(k.name ?? '').trim() || sku || '—',
      sku,
      miktarMetni: miktar === null ? '—' : `${miktar}${birim}`,
      birimFiyat: brutT !== null && miktar !== null && miktar > 0 ? brutT / miktar : null,
      iskonto: sayiYaDaNull(k.iskonto),
      faturaAltiKaynagi: faturaAltiKaynagi(k.netKaynagi as NetKaynagi | null),
      net: sayiYaDaNull(k.netTutar),
    };
  });
  const brut = toplaBilinen(kalemler, k => k.brutTutar);
  const iskonto = toplaBilinen(kalemler, k => k.iskonto);
  const ara = toplaBilinen(kalemler, k => k.netTutar);
  const kdv = toplaBilinen(kalemler, k => k.kdv);
  // Sağlama ham yolla AYNI: KDV mutlak değerle (kalemSaglamasi `Math.abs(sth_vergi)`), masraf her satırdan.
  const kdvMutlak = toplaBilinen(kalemler, k => (bilinenSayi(k.kdv) ? Math.abs(Number(k.kdv)) : k.kdv));
  const masrafT = toplaBilinen(kalemler, k => k.masraf);
  const saglama = kalemler.length && bilinenSayi(genelToplam)
    ? saglamaKur({ net: ara.toplam, kdv: kdvMutlak.toplam, masraf: masrafT.toplam, brut: brut.toplam, eksik: ara.bilinmeyen + kdv.bilinmeyen }, genelToplam)
    : null;
  const notlar = [...mikroKalemNotlari(ara.bilinmeyen, kdv.bilinmeyen, saglama, dil), ...faturaAltiNotlari(satirlar, tr)];
  return { satirlar, brut, iskonto, ara, kdv, masraf: saglama ? masrafT.toplam : null, notlar };
}
