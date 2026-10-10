/**
 * faturaUstBilgisi.ts — fatura detay pencerelerinin ÜST BİLGİSİ: Fatura No · Belge No · Tarih (2026-10-10).
 *
 * Kullanıcı isteği (ekran görüntüsüyle): «fatura detay ekranlarına tarih ve fatura no + belge no ekle.» Üç alan pencere
 * gövdesinin EN ÜSTÜNDE, her zaman çizilir; bilinmeyen '—' (alan gizlenmez — «yok» ile «yüklenmedi» ayrılsın).
 *
 * İki yüzey buradan beslenir:
 *   • `MikroFaturaDetay` (Mikro faturasının penceresi; dört üretici) — yalnız `faturaTarihMetni` (fatura no / belge no veride).
 *   • `MuhasebePage` «Fatura / Sipariş Detayı» (sekme `fatura-takip`, kaynak `orders`) — `faturaUstBilgisi`.
 *
 * Saf: bileşen / Intl seçeneği / dil yok (tarih iki dilde de GG.AA.YYYY).
 */
import type { Order } from '../../types';
import type { MikroFatura } from '../../hooks/useMikroFaturalar';
import { gunBasi, tarihYaz } from '../zaman';

/**
 * Fatura tarihinin ekran metni: GG.AA.YYYY.
 *
 * Girdi dört hâlde gelir: `YYYY-AA-GG` (mikroFaturalar — `cha_tarihi.slice(0, 10)`), `GG.AA.YYYY` (Cari Ekstre satırı zaten
 * `tarihYaz` ile basılmış; `orders.mikroFaturaDate`), boş metin, '—'. Çözüm `gunBasi` ile: salt tarih metnini YEREL gün kurar
 * (`Date.parse('2026-08-31')` UTC gece yarısıdır — bkz. utils/zaman başlık notu). Çözülemeyen metin HAM basılır (bir şey
 * yazıyorsa kullanıcı onu görsün; tarih uydurulmaz), boşsa '—'.
 */
export function faturaTarihMetni(tarih: string | null | undefined): string {
  const ham = (tarih ?? '').trim();
  if (!ham) return '—';
  const gun = gunBasi(ham);
  return gun ? tarihYaz(gun) : ham;
}

/** Üç alanın EKRAN metni; bilinmeyen '—'. */
export interface FaturaUstBilgisi {
  faturaNo: string;
  belgeNo: string;
  tarih: string;
}

type SiparisUstAlanlari = Pick<Order,
  'mikroFaturaNo' | 'lucaFaturaNo' | 'irsaliyeNo' | 'mikroFaturaDate' | 'orderDate' | 'source' | 'mikroEvrak' | 'createdAt' | 'syncedAt'>;

/**
 * Sipariş satırından açılan «Fatura / Sipariş Detayı» penceresinin üst bilgisi.
 *
 * - **Fatura No:** listedeki ifadenin aynısı (`mikroFaturaNo ‖ lucaFaturaNo ‖ irsaliyeNo`).
 * - **Tarih:** FATURA tarihi biliniyorsa o — Cetpa'dan kesilen faturada `mikroFaturaDate` (`GG.AA.YYYY`, `/api/mikro/fatura/kaydet`),
 *   faturadan türetilen siparişte (`source === 'mikro-fatura'`) `orderDate` (`YYYY-AA-GG`); yoksa listedeki ifade
 *   (`createdAt ?? syncedAt`).
 * - **Belge No:** sipariş dokümanında alan YOK. Faturadan türetilen siparişte, sayfada zaten yüklü `mikroFaturalar`'dan yönü
 *   «giden» ve numarası `mikroEvrak` (seri + sıra) olan başlık TEKİLSE onun `belgeNo`'su; başlık yoksa ya da aynı numaralı
 *   birden çok başlık varsa (canlıda giden 246) '—' — «muhtemelen budur» diye belge no SEÇİLMEZ. Native siparişte '—':
 *   `/fatura/kaydet` yanıtından yalnız `mikroFaturaNo` + `ettn` saklanıyor (canlıda henüz hiç fatura kesilmedi).
 *   Sınır: `mikroFaturalar` okuma rolü yoksa (kanca `[]` döner) ve reddedilen / iptal faturada başlık listede değildir → '—'.
 */
export function faturaUstBilgisi(
  siparis: SiparisUstAlanlari,
  mikroFaturalar: readonly Pick<MikroFatura, 'faturaNo' | 'yon' | 'belgeNo'>[],
): FaturaUstBilgisi {
  const turetilmis = siparis.source === 'mikro-fatura';
  const faturaTarihi = siparis.mikroFaturaDate || (turetilmis ? siparis.orderDate : undefined);
  return {
    faturaNo: siparis.mikroFaturaNo || siparis.lucaFaturaNo || siparis.irsaliyeNo || '—',
    belgeNo: (turetilmis ? turetilmisBelgeNo(siparis.mikroEvrak, mikroFaturalar) : undefined) ?? '—',
    tarih: faturaTarihi ? faturaTarihMetni(faturaTarihi) : tarihYaz(siparis.createdAt ?? siparis.syncedAt),
  };
}

/** `mapMikroFatura` ile AYNI birleşim: seri boşsa yalnız sıra, doluysa `SERİ-SIRA`. */
function turetilmisBelgeNo(
  evrak: Order['mikroEvrak'],
  mikroFaturalar: readonly Pick<MikroFatura, 'faturaNo' | 'yon' | 'belgeNo'>[],
): string | undefined {
  const seri = String(evrak?.seri ?? '').trim();
  const sira = String(evrak?.sira ?? '').trim();
  if (!sira) return undefined;
  const hedef = seri ? `${seri}-${sira}` : sira;
  const adaylar = mikroFaturalar.filter(f => f.yon === 'giden' && f.faturaNo === hedef);
  return adaylar.length === 1 ? adaylar[0].belgeNo?.trim() || undefined : undefined;
}
