import type { MikroFatura } from '../hooks/useMikroFaturalar';
import type { MikroFaturaDetayVerisi } from '../components/MikroFaturaDetay';
import type { FaturaAnahtari } from '../lib/stokFiyat';

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

/**
 * Stok hareketindeki evrak numarasına basınca AÇILACAK fatura (2026-09-25 kullanıcı bildirimi: Fiyat Karşılaştırma →
 * İşlem Detayı'nda "evraka basınca evrak detayları gelmiyor").
 *
 * Eskiden düğme yalnız başlık listesinde (`mikroFaturalar`) TEKİL eşleşme bulunursa çıkıyordu; bulunamazsa numara düz
 * metin kalıyordu — gece importu 90 günle sınırlı olduğu için eski faturaların HİÇBİRİ açılmıyordu. Oysa fatura
 * kalemleri başlığa ihtiyaç duymaz: `/api/mikro/fatura/kalemler` seri + sıra + yön ile doğrudan Mikro'dan okur.
 *
 * Sıra: (1) başlık TEKİL eşleşir ve yönü hareketin faturasıyla çelişmezse → başlıklı (tutar/KDV dolu); (2) yoksa
 * hareketin FATURA ANAHTARINDAN başlıksız kayıt (`baslikYok`, tutar/KDV/matrah NaN → '—', kalemler Mikro'dan);
 * (3) hareket fatura değilse (irsaliye, sayım — anahtar `null`) ve başlık da yoksa `null` → düğme yok.
 * Yanlış faturayı açma riski yok: anahtar Mikro'nun kendi evrak kimliğidir, tahmin değil.
 */
export function hareketFaturasi(
  faturalar: readonly MikroFatura[],
  olcut: EslesmeOlcutu,
  anahtar: FaturaAnahtari | null,
): MikroFaturaDetayVerisi | null {
  const baslik = faturaEsle(faturalar, olcut);
  if (baslik && (anahtar === null || baslik.yon === anahtar.yon)) return { ...baslik, musteri: baslik.cariKod };
  if (anahtar === null) return null;
  const cari = olcut.cariKod?.trim() || '';
  return {
    id: `hareket|${anahtar.yon}|${anahtar.seri}|${anahtar.sira}`,
    faturaNo: anahtar.seri ? `${anahtar.seri}-${anahtar.sira}` : anahtar.sira,
    musteri: cari || '—',
    cariKod: cari,
    tarih: olcut.tarih?.slice(0, 10) ?? '',
    tutar: NaN, kdv: NaN, matrah: NaN, oran: null,
    yon: anahtar.yon,
    baslikYok: true,
  };
}
