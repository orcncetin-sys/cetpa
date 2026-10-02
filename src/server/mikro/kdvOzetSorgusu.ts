/**
 * kdvOzetSorgusu.ts — aylık KDV özetinin (`POST /api/mikro/pull/kdv` → taxSummary) STOK_HAREKETLERI sorgusu (2026-09-29).
 *
 * Neden ayrı ve saf (şartname faz3-2n-specs/matrah-2026-09-28 M2 + kapı E3 ÖLÇÜMÜ):
 *   • MATRAH iskonto düşülerek: `SUM(tutar − Σiskonto + Σmasraf)` — tek kaynak lib/faturaMatrahi.satirNetSql (eskiden
 *     `SUM(sth_tutar)` = BRÜT, iskontolu satırda matrah iskonto kadar şişikti).
 *   • YALNIZ FATURA SATIRLARI + FATURAYA BAĞLI İRSALİYE SATIRLARI. Canlı önizleme (351ded6, `matrah-tani?onizleme=1`):
 *     evraktip 2 = 45 depo TRANSFERİ satırı (sth_tip 2, KDV 0, tutar 1,1 M ₺) süzgeçsiz sorguda raporKdvMizan'da `tip !== 1`
 *     olduğu için ALIŞ MATRAHINA giriyordu; evraktip 1 = 2 İRSALİYE satırı, `sth_fat_uid` ile iptalsiz satış faturası 1'e
 *     bağlı ve o faturanın kendi satırı YOK (KDV 935 yalnız bu satırlarda) — "yalnız 3/4" süzgeci onu düşürürdü. Bağlama kolonu
 *     şemadan doğrulanır; yoksa yalnız 3/4 + not.
 *   • Kolon desenleri TAM ad (`^sth_vergi_pntr$`, `^sth_iptal$`): gevşek `/vergi_pntr/` şemadaki `sth_masraf_vergi_pntr`'yi
 *     yakalayabiliyordu (sfiyat_Guid arıza sınıfı).
 *   • DÖNEM: fatura satırı kendi tarihiyle (sth_tarih), faturaya bağlı irsaliye satırı FATURANIN tarihiyle (cha_tarihi) —
 *     irsaliye önceki ayda kesilip bu ay faturalanırsa KDV'si bu aya girer (inceleme 2026-09-29: satır tarihi hiçbir aya
 *     sokmayabiliyordu; Faturalar/Mizan dönemi de cha_tarihi).
 * Sınırlar: fatura satırı dalında iptal yalnız sth_iptal'den okunur (başlık iptali satıra işlenmezse satır sayılır — canlıda
 * iptal başlık 0, ölçülmedi); `sth_vergisiz_fl` süzülmez (ölçülmedi); tevkifat/iade/devreden kapsam dışı. Yalnız ASCII SQL.
 */
import { satirNetSql, gercekAd } from '../../lib/faturaMatrahi.js';

export type KdvOzetSorgusu =
  | { ok: true; sql: string; oranKolonuVar: boolean; notlar: string[] }
  | { ok: false; hata: string };

const tamAd = (kolonlar: readonly string[], ad: string) => gercekAd(kolonlar, ad);
const guvenli = (k: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);

export function kdvOzetSorgusu(kolonlar: readonly string[], ilkTarih: string, sonTarih: string, faturaKosulu: string): KdvOzetSorgusu {
  const vergi = tamAd(kolonlar, 'sth_vergi'), tip = tamAd(kolonlar, 'sth_tip'), tarih = tamAd(kolonlar, 'sth_tarih');
  if (!vergi || !tip || !tarih) {
    return { ok: false, hata: `KDV kolonları eşleşmedi (vergi=${vergi}, tip=${tip}, tarih=${tarih}). taxSummary'ye dokunulmadı.` };
  }
  const pntr = tamAd(kolonlar, 'sth_vergi_pntr'), iptal = tamAd(kolonlar, 'sth_iptal');
  const evraktip = tamAd(kolonlar, 'sth_evraktip'), bag = tamAd(kolonlar, 'sth_fat_uid');
  const sn = satirNetSql(kolonlar);
  const tumu = [vergi, tip, tarih, pntr, iptal, evraktip, bag, ...(sn ? [...sn.iskonto, ...sn.masraf] : [])].filter((k): k is string => !!k);
  if (!tumu.every(guvenli)) return { ok: false, hata: 'Geçersiz kolon adı.' };

  const notlar: string[] = [];
  const aralik = (kolon: string) => `${kolon} BETWEEN '${ilkTarih}' AND '${sonTarih}'`;
  const kosul: string[] = [];
  if (iptal) kosul.push(`ISNULL(${iptal}, 0) = 0`);
  if (evraktip) {
    kosul.push(bag
      // İki dal AYRIK: fatura satırı (3/4) YALNIZ kendi tarihiyle; bağlı-fatura dalı yalnız fatura DIŞI satırlar için. Fatura satırı
      // da `sth_fat_uid` ile kendi başlığına bağlıysa ve `sth_tarih` ≠ `cha_tarihi` ise (ay sınırında) iki dalın birleşimi onu İKİ
      // döneme sokardı (hakem 2026-09-29, K1).
      ? `((${evraktip} IN (3, 4) AND ${aralik(tarih)}) OR (${evraktip} NOT IN (3, 4) AND EXISTS (SELECT 1 FROM CARI_HESAP_HAREKETLERI cha WHERE cha.cha_Guid = STOK_HAREKETLERI.${bag} ` +
        `AND ${faturaKosulu} AND ISNULL(cha.cha_iptal, 0) = 0 AND ${aralik('cha.cha_tarihi')})))`
      : `${evraktip} IN (3, 4) AND ${aralik(tarih)}`);
    if (!bag) notlar.push('faturaya bağlı irsaliye satırları ayırt edilemedi (sth_fat_uid şemada yok) — yalnız fatura satırları');
  } else {
    kosul.push(aralik(tarih));
    notlar.push('sth_evraktip şemada yok — fatura dışı satırlar (transfer/irsaliye) SÜZÜLMEDİ');
  }
  const secim = [`${tip} AS tip`, `SUM(${vergi}) AS kdv`];
  if (sn) {
    secim.push(`SUM(${sn.ifade}) AS matrah`);
    if (!sn.iskonto.length) notlar.push('sth_iskonto kolonu yok — matrah iskontosuz (brüt) olabilir');
  }
  const grup = [tip];
  if (pntr) { secim.unshift(`${pntr} AS oranPntr`); grup.push(pntr); }
  return {
    ok: true, oranKolonuVar: Boolean(pntr), notlar,
    sql: `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${kosul.join(' AND ')} GROUP BY ${grup.join(', ')} ORDER BY ${tip}`,
  };
}
