import type { MikroFatura } from '../hooks/useMikroFaturalar';

/**
 * faturaEsle — bir stok hareketini/evrak numarasını mikroFaturalar'daki
 * faturayla eşleştirir.
 *
 * ## Neden ayrı modül
 *
 * İki ekran aynı işi istiyor (2026-08-28 kullanıcı isteği): Fiyat
 * Karşılaştırma'nın İşlem Detayı'nda evrak numarasına basınca fatura,
 * ürün detayının Son Hareketler'inde satıra basınca fatura. Eşleştirme
 * kuralını iki yerde ayrı yazmak, iki yerde ayrı bozulması demek.
 *
 * ## Eşleştirme kuralları — ve neden MUHAFAZAKÂR
 *
 * Stok hareketi (STOK_HAREKETLERI) fatura başlığına (CARI_HESAP_HAREKETLERI)
 * doğrudan anahtar taşımıyor; elimizdeki köprüler evrak sıra no, cari kodu ve
 * tarih. Bunlar TEK BAŞINA benzersiz değildir (aynı gün aynı cariye iki
 * fatura kesilebilir). Bu yüzden:
 *
 *   - Verilen HER ölçüt eşleşmek zorunda (VE bağlacı).
 *   - Sonuç TEK fatura değilse `null` döner — "muhtemelen budur" diye bir
 *     fatura AÇMAYIZ; yanlış faturayı göstermek hiç göstermemekten kötüdür
 *     (CLAUDE.md: sahte kesinlik gösterme). Çağıran, null'da düğmeyi
 *     gizler ya da "eşleşen fatura bulunamadı" der.
 */
export interface EslesmeOlcutu {
  /** Evrak sıra numarası (faturaNo'nun '-' sonrası kısmı ile karşılaştırılır). */
  evrakSira?: string | number | null;
  /** Mikro cari kodu (cha_kod). */
  cariKod?: string | null;
  /** 'YYYY-MM-DD' — fatura tarihiyle GÜN bazında eşleşir. */
  tarih?: string | null;
}

export function faturaEsle(faturalar: readonly MikroFatura[], olcut: EslesmeOlcutu): MikroFatura | null {
  const sira = olcut.evrakSira != null && String(olcut.evrakSira).trim() !== ''
    ? String(olcut.evrakSira).trim() : null;
  const cari = olcut.cariKod?.trim() || null;
  const gun = olcut.tarih?.slice(0, 10) || null;
  // Hiç ölçüt yoksa eşleştirme YAPILMAZ — "ilk fatura" döndürmek tuzaktır.
  if (!sira && !cari && !gun) return null;

  const adaylar = faturalar.filter(f => {
    if (sira) {
      // faturaNo 'SERI-SIRA' ya da yalnız 'SIRA' biçiminde (mapMikroFatura).
      const fSira = f.faturaNo.includes('-') ? f.faturaNo.split('-').pop() : f.faturaNo;
      if (fSira !== sira) return false;
    }
    if (cari && f.cariKod !== cari) return false;
    if (gun && f.tarih.slice(0, 10) !== gun) return false;
    return true;
  });
  return adaylar.length === 1 ? adaylar[0] : null;
}
