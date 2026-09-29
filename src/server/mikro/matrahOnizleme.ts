/**
 * matrahOnizleme.ts — matrah düzeltmesinin İKİ AŞAMALI gönderiminin 1. aşaması (şartname faz3-2n-specs/matrah-2026-09-28 v2, kapı E1/E3).
 *
 * Lokalde Mikro yok; fatura-listesi importunun yeni SELECT'i (faturaListesiSorgusu) gerçek SQL Server'da içe aktarma değişmeden
 * ÖNCE sınanmalı — hatalı bir ifade gece 'tam' koşusunu ve aylık senkronu tümden durdurur. Bu modül yalnız SALT OKUMA sorgu
 * metinleri üretir; `GET /api/mikro/matrah-tani?onizleme=1` koşar, HİÇBİR ŞEY YAZILMAZ:
 *   ornek  — importun BİREBİR biçimi (SELECT secim FROM tablo fromEk WHERE … ORDER BY cha.cha_Guid OFFSET/FETCH) + bilinen faturalar
 *   genel  — tüm iptalsiz faturalarda yeni matrah/KDV kaynak dağılımı ve sağlama (matrah + KDV ≈ meblağ) sayısı
 *   tutmayan — sağlaması tutmayan / matrahı ya da KDV'si NULL kalan faturalar
 * Kapı E3 (K-M4 ölçümü): fatura DIŞI satırlar (evraktip ∉ {3,4}) faturaya bağlanıyor mu — bağlama kolonu ŞEMADAN doğrulanır
 * (`sth_fat_uid` adayı; yoksa ölçüm "kolon yok" der, ad uydurulmaz).
 */
import type { FaturaListesiSorgusu } from './faturaListesiSorgusu.js';
import { gercekAd, saglamaPayiSql } from '../../lib/faturaMatrahi.js';

/** Şartname §4.2 kapanış değerlerinin faturaları: 420 çift iskonto · 246 aynı numaralı iki başlık · 311/312 tevkifat ·
 *  119/1 satırsız · 267 iskontolu ve tutarlı. */
export const ONIZLEME_EVRAKLARI = [420, 246, 311, 312, 119, 1, 267] as const;

export interface OnizlemeSorgulari { ornek: string; genel: string; tutmayan: string }

export function onizlemeSorgulari(q: FaturaListesiSorgusu, faturaKosulu: string): OnizlemeSorgulari {
  const govde = `SELECT ${q.secim} FROM CARI_HESAP_HAREKETLERI cha${q.fromEk} WHERE ${faturaKosulu} AND ISNULL(cha.cha_iptal, 0) = 0`;
  const tutmuyor = `(t.matrah IS NULL OR t.kdvTutari IS NULL OR ABS(t.matrah + t.kdvTutari - t.cha_meblag) > ${saglamaPayiSql('t.satirSayisi')})`;
  return {
    ornek: `${govde} AND cha.cha_evrakno_sira IN (${ONIZLEME_EVRAKLARI.join(', ')}) ORDER BY cha.cha_Guid OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`,
    genel:
      'SELECT COUNT(*) AS fatura, ' +
      "SUM(CASE WHEN t.matrahKaynagi = 'baslik' THEN 1 ELSE 0 END) AS baslikKaynakli, " +
      "SUM(CASE WHEN t.matrahKaynagi = 'satir' THEN 1 ELSE 0 END) AS satirKaynakli, " +
      'SUM(CASE WHEN t.matrah IS NULL THEN 1 ELSE 0 END) AS matrahNull, SUM(CASE WHEN t.kdvTutari IS NULL THEN 1 ELSE 0 END) AS kdvNull, ' +
      `SUM(t.ortakAnahtar) AS ortakAnahtar, SUM(CASE WHEN ${tutmuyor} THEN 1 ELSE 0 END) AS saglamaTutmayan, ` +
      // Sağlama KDV'si meblağdan TÜRETİLEN faturada (satırsız / ortak anahtar) yapı gereği tutar — kör nokta ayrı sayılır
      // (aşama 1 incelemesi); negatif KDV ayrıca.
      'SUM(CASE WHEN t.satirSayisi IS NULL THEN 1 ELSE 0 END) AS satirsiz, ' +
      'SUM(CASE WHEN t.ortakAnahtar = 1 OR t.satirSayisi IS NULL THEN 1 ELSE 0 END) AS turetilmisKdv, ' +
      'SUM(CASE WHEN t.kdvTutari < 0 THEN 1 ELSE 0 END) AS negatifKdv, ' +
      'SUM(t.matrah) AS matrahToplam, SUM(t.kdvTutari) AS kdvToplam, SUM(t.cha_meblag) AS meblagToplam, SUM(t.cha_aratoplam) AS aratoplamToplam ' +
      `FROM (${govde}) t`,
    tutmayan:
      'SELECT TOP 40 t.cha_tip, t.cha_evrakno_seri, t.cha_evrakno_sira, t.cha_tarihi, t.cha_kod, t.cha_meblag, t.cha_aratoplam, ' +
      't.matrah, t.kdvTutari, t.matrahKaynagi, t.ortakAnahtar, t.satirSayisi ' +
      `FROM (${govde}) t WHERE ${tutmuyor} ORDER BY t.cha_tarihi DESC`,
  };
}

/** Önizleme satırından yanıta yalnız karar için gereken alanlar (cha.* 186 kolon döner). */
export const ONIZLEME_ALANLARI = ['cha_tip', 'cha_evrakno_seri', 'cha_evrakno_sira', 'cha_tarihi', 'cha_meblag', 'cha_aratoplam',
  'matrah', 'kdvTutari', 'matrahKaynagi', 'ortakAnahtar', 'vergiPntr', 'oranSayisi', 'satirSayisi'] as const;
export const onizlemeSatiri = (r: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(ONIZLEME_ALANLARI.map(k => [k, r[k] ?? null]));

export interface BaglantiSorgulari {
  /** Şemada doğrulanan faturaya bağlama kolonu (gerçek yazım) — yoksa null. */
  bagKolonu: string | null;
  /** Bilgi: adı fatura + uid/guid içeren diğer satır kolonları (KULLANILMAZ, yalnız rapor). */
  adaylar: string[];
  dagilim: string;
  bagliFaturalar: string | null;
  irsaliyeOrnek: string;
}

export function baglantiSorgulari(sthKolonlari: readonly string[]): BaglantiSorgulari {
  const bag = gercekAd(sthKolonlari, 'sth_fat_uid');
  const adaylar = sthKolonlari.filter(k => /fat/i.test(k) && /(uid|guid)/i.test(k) && k !== bag);
  const dagilim =
    `SELECT s.sth_evraktip, s.sth_tip, COUNT(*) AS n, SUM(s.sth_tutar) AS tutar, SUM(s.sth_vergi) AS vergi` +
    (bag ? ', SUM(CASE WHEN c.cha_Guid IS NULL THEN 0 ELSE 1 END) AS faturayaBagli' : '') +
    ` FROM STOK_HAREKETLERI s${bag ? ` LEFT JOIN CARI_HESAP_HAREKETLERI c ON c.cha_Guid = s.${bag}` : ''}` +
    ' WHERE s.sth_evraktip NOT IN (3, 4) AND ISNULL(s.sth_iptal, 0) = 0 GROUP BY s.sth_evraktip, s.sth_tip ORDER BY s.sth_evraktip, s.sth_tip';
  // Bağlı faturanın KENDİ fatura satırı (evraktip 3/4) sayısı da gelir: 0 = satırsız fatura (irsaliyeden kesilmiş olabilir),
  // > 0 = karma (bağlama koşulu onu çift sayabilir) — karar bu ayrıma göre verilir (aşama 1 incelemesi).
  const bagliFaturalar = bag
    ? 'SELECT x.*, (SELECT COUNT(*) FROM STOK_HAREKETLERI f WHERE f.sth_evrakno_seri = x.cha_evrakno_seri AND f.sth_evrakno_sira = x.cha_evrakno_sira ' +
      'AND f.sth_evraktip = CASE WHEN x.cha_tip = 0 THEN 4 ELSE 3 END AND ISNULL(f.sth_iptal, 0) = 0) AS kendiSatir FROM (' +
      'SELECT TOP 30 c.cha_tip, c.cha_evrakno_seri, c.cha_evrakno_sira, c.cha_tarihi, COUNT(*) AS n, SUM(s.sth_tutar) AS tutar, SUM(s.sth_vergi) AS vergi ' +
      `FROM STOK_HAREKETLERI s JOIN CARI_HESAP_HAREKETLERI c ON c.cha_Guid = s.${bag} ` +
      'WHERE s.sth_evraktip NOT IN (3, 4) AND ISNULL(s.sth_iptal, 0) = 0 GROUP BY c.cha_tip, c.cha_evrakno_seri, c.cha_evrakno_sira, c.cha_tarihi ORDER BY c.cha_tarihi DESC' +
      ') x'
    : null;
  const irsaliyeOrnek =
    'SELECT TOP 10 s.sth_evraktip, s.sth_tip, s.sth_evrakno_seri, s.sth_evrakno_sira, s.sth_tarih, s.sth_stok_kod, s.sth_miktar, s.sth_tutar, s.sth_vergi' +
    `${bag ? `, s.${bag}` : ''} FROM STOK_HAREKETLERI s WHERE s.sth_evraktip NOT IN (3, 4) AND ISNULL(s.sth_iptal, 0) = 0 ORDER BY s.sth_tarih DESC`;
  return { bagKolonu: bag, adaylar, dagilim, bagliFaturalar, irsaliyeOrnek };
}
