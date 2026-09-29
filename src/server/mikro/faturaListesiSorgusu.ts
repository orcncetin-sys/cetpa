/**
 * faturaListesiSorgusu.ts — fatura-listesi importunun SELECT + JOIN metni (2026-09-28, şartname faz3-2n-specs/matrah-2026-09-28 v2).
 * Tek üretici: önizleme (`GET /api/mikro/matrah-tani?onizleme=1`, aşama 1) ve import (aşama 2: makeMikroSqlImport → secimUret) AYNI metni kullanır —
 * lokalde Mikro olmadığı için SQL, içe aktarma değişmeden ÖNCE gerçek motorda önizlemeyle sınanır (kapı E1).
 *
 * Kurallar (lib/faturaMatrahi — tek kaynak):
 *   matrah       = COALESCE(başlık: cha_aratoplam − Σcha_ft_iskonto, satır: Σ(tutar − Σisk + Σmasraf))
 *   kdvTutari    = satırların KDV'si (hesaplanan KDV'nin tamamı; tevkifat modellenmez) — AMA aynı yön|seri|sıra'da birden çok
 *                  başlık varsa ya da satır yoksa `cha_meblag − matrah` (satır grubu iki başlığa ÇİFT yazılmasın: giden 246)
 *   matrahKaynagi 'baslik' | 'satir' | NULL; ortakAnahtar 0/1 — HER koşuda yazılır (koşullu yazım merge'de bayat bırakır).
 * SQL takma ada başvurmaz (T-SQL aynı SELECT'teki takma adı görmez): başlık matrahı CROSS APPLY ile `b.bm`; pencere sayımı
 * açıkça tekrarlanır. Yalnız ASCII.
 * Şema OKUNAMADIYSA (boş liste ≠ "kolon yok") matrah/KDV alanları SEÇİLMEZ → merge önceki değerleri korur (kapı E2).
 * Sınır: `COUNT(*) OVER` WHERE sonrası (tarih penceresi) sayar — dar HTTP penceresi aynı numaralı ikinci başlığı dışarıda
 * bırakırsa o koşuda çift KDV geri gelir; gece koşusu 'tam' penceredir.
 */
import { baslikMatrahSql, satirNetSql } from '../../lib/faturaMatrahi.js';

export interface FaturaListesiSorgusu {
  secim: string;
  fromEk: string;
  /** false: şema okunamadı, matrah/KDV bu koşuda yazılmaz. */
  matrahYazilir: boolean;
  notlar: string[];
}

const PENCERE = 'COUNT(*) OVER (PARTITION BY cha.cha_tip, cha.cha_evrakno_seri, cha.cha_evrakno_sira)';

export function faturaListesiSorgusu(sema: { ana: readonly string[]; satir: readonly string[] }): FaturaListesiSorgusu {
  if (!sema.ana.length || !sema.satir.length) {
    return { secim: 'cha.*', fromEk: '', matrahYazilir: false,
      notlar: ['Mikro şeması okunamadı — matrah/KDV bu koşuda GÜNCELLENMEDİ (önceki değerler korunur)'] };
  }
  const notlar: string[] = [];
  const bm = baslikMatrahSql(sema.ana);
  if (!bm) notlar.push('başlıkta cha_aratoplam / cha_ft_iskonto kolonu yok — matrah satırlardan');
  const sn = satirNetSql(sema.satir);
  if (!sn) notlar.push('STOK_HAREKETLERI şemasında sth_tutar yok — satır matrahı hesaplanamaz');
  else if (!sn.iskonto.length) notlar.push('sth_iskonto kolonu yok — satır matrahı iskontosuz (brüt) olabilir');
  const matrahNet = sn ? `SUM(${sn.ifade})` : 'CAST(NULL AS FLOAT)';
  const fromEk =
    ' LEFT JOIN (' +
      'SELECT sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, ' +
      `SUM(sth_vergi) AS kdv, ${matrahNet} AS matrahNet, COUNT(*) AS satirSayisi, MIN(sth_vergi_pntr) AS vergiPntr, ` +
      // CAST ONCE, ISNULL SONRA: sth_vergi_pntr tinyint — ISNULL(col, -1) tinyint taşmasıyla TÜM importu öldürüyordu (2026-08-18).
      'COUNT(DISTINCT ISNULL(CAST(sth_vergi_pntr AS INT), -1)) AS oranSayisi ' +
      'FROM STOK_HAREKETLERI WHERE sth_evraktip IN (3, 4) AND ISNULL(sth_iptal, 0) = 0 ' +
      'GROUP BY sth_evrakno_seri, sth_evrakno_sira, sth_evraktip' +
    ') sat ON sat.sth_evrakno_seri = cha.cha_evrakno_seri AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
    // Yön eşleşmesi ŞART: satış ve alış aynı evrak numarasını kullanabiliyor (seri boş).
    'AND sat.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END ' +
    `CROSS APPLY (SELECT ${bm ?? 'CAST(NULL AS FLOAT)'} AS bm) b`;
  // Aynı numaralı birden çok başlıkta satır grubu PAYLAŞILIR: başlık matrahı yoksa satır toplamına düşmek onu iki başlığa ÇİFT
  // yazardı (aşama 1 incelemesi) → NULL kalır (bilinmiyor; sağlama NULL'u sayar).
  const matrah = `CASE WHEN ${PENCERE} > 1 THEN b.bm ELSE COALESCE(b.bm, sat.matrahNet) END`;
  const secim = [
    'cha.*',
    `${matrah} AS matrah`,
    `CASE WHEN ${PENCERE} > 1 OR sat.kdv IS NULL THEN cha.cha_meblag - ${matrah} ELSE sat.kdv END AS kdvTutari`,
    'sat.vergiPntr', 'sat.oranSayisi', 'sat.satirSayisi',
    `CASE WHEN b.bm IS NOT NULL THEN 'baslik' WHEN sat.matrahNet IS NOT NULL AND ${PENCERE} = 1 THEN 'satir' END AS matrahKaynagi`,
    `CASE WHEN ${PENCERE} > 1 THEN 1 ELSE 0 END AS ortakAnahtar`,
  ].join(', ');
  return { secim, fromEk, matrahYazilir: true, notlar };
}
