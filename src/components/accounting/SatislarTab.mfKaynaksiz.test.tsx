/**
 * SatislarTab.mfKaynaksiz.test.tsx: Satışlar sekmesinin kaynaksız MF notu GERÇEK hesap zinciriyle çizilir (şartname «Mikro bağlantı
 * B» B2 #1, BH8, BH16 «yazıldı ama bağlanmadı»; 05.11.2026). AccountingModule ile AYNI çağrı sırası: ikiz kümesi → yerel liste →
 * çift sayım özeti → `satisKaynaksizDisi` → `mfKaynaksizNotu` → sekme prop'u. Kalıp: `qSerisi.sekmeler.test.tsx`.
 *
 * Fikstür: işaretli MF 325 (Mikro'da satış faturası yok), işaretsiz ikizsiz MF 400 (QH2-1: listede kalır), yerel sipariş, Mikro
 * F0 (101) ve onun MF ikizi. Mutasyon: `satisYerelListesi`'nden kaynaksız kapısı kaldırılırsa MF-325 tabloya döner → kırmızı;
 * not prop'u sekmede basılmazsa → kırmızı.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import SatislarTab from './SatislarTab';
import { mapMikroFatura } from '../../hooks/useMikroFaturalar';
import { ac } from '../../i18n/accounting';
import {
  cetpaEvrakNolari, mikroSatisSatirlari, cetpaSatisSatirlari, satisKayitlari, satisKpi,
  satisIkizAnahtarlari, satisYerelListesi, satisCiftSayimOzeti, satisKaynaksizDisi,
} from '../../utils/muhasebe/satislar';
import { mfKaynaksizNotu } from '../../utils/muhasebe/faturasizDisi';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import type { Order } from '../../types';

vi.mock('../../lib/dbClient', async () => (await import('../../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

afterEach(() => cleanup());
const bos = () => {};

const F0 = mapMikroFatura('f0', { cha_tip: 0, cha_evrakno_seri: '', cha_evrakno_sira: 101, cha_tarihi: '2026-06-15', cha_meblag: 100000,
  cha_ebelge_Islemturu: 1, kdvTutari: 16666.67, matrah: 83333.33 });
const mf = (id: string, sira: string, tutar: number, ek: Partial<Order> = {}) => ({
  id, customerName: `MF-${sira}`, totalPrice: tutar, status: 'Delivered', faturali: true, source: MF_KAYNAGI,
  mikroEvrak: { seri: '', sira }, mikroFaturaNo: sira, ...ek,
} as Order);
const ISARETLI = mf('mf-325', '325', 7080, { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' });
const ISARETSIZ = mf('mf-400', '400', 1200);
const IKIZLI = mf('mf-101', '101', 100000);
const YEREL = { id: 's0', customerName: 'Şirin Yapı', totalPrice: 2000, status: 'Delivered', faturali: false, kdvOran: 0, kdvTutari: 0 } as Order;
const ORDERS = [ISARETLI, ISARETSIZ, IKIZLI, YEREL];

/** AccountingModule ile AYNI zincir (bkz. AccountingModule.tsx «Kaynaksız MF notu»). */
const ciz = (kaynak: 'cetpa' | 'hepsi', dil: 'tr' | 'en' = 'tr') => {
  const evrak = cetpaEvrakNolari(ORDERS);
  const mikroDahil = kaynak !== 'cetpa';
  const ikizler = satisIkizAnahtarlari([F0], evrak);
  const yerel = satisYerelListesi(ORDERS, { mikroDahil, ikizAnahtarlari: ikizler });
  const mikro = mikroSatisSatirlari([F0], { yil: '2026', cetpaEvrakNolari: evrak, cariAdMap: new Map(), arama: '' });
  const ciftSayim = mikroDahil ? satisCiftSayimOzeti(ORDERS, ikizler) : null;
  return render(<SatislarTab
    t={ac(dil)} currentLanguage={dil} satisKayitlari={satisKayitlari(yerel, mikro, mikroDahil)}
    setDrillDown={bos} formatConv={n => String(n)} kpiCurrency="TRY" setKpiCurrency={bos}
    satisKaynak={kaynak} setSatisKaynak={bos} satisOzet={satisKpi(yerel, mikro, mikroDahil)} mikroDahil={mikroDahil}
    mikroSatisSatirlari={mikro} satisCiftSayim={ciftSayim}
    satisKaynaksizNotu={mfKaynaksizNotu(satisKaynaksizDisi(ORDERS, ciftSayim), dil)}
    satisSearch="" setSatisSearch={bos} satisYil="2026" setSatisYil={bos}
    satisSortKey="date" satisSortDir="desc" toggleSatisSort={bos} displayedSatis={cetpaSatisSatirlari(yerel, { arama: '' })}
  />).container;
};

describe('SatislarTab · kaynaksız MF notu ve tablosu (B2 #1)', () => {
  it('«Tümü»: not «₺7.080,00 Mikro\'da satış faturası olmayan MF siparişi dâhil değil · 1 kayıt»; MF-325 tabloda YOK, işaretsiz MF-400 VAR', () => {
    const c = ciz('hepsi');
    expect(c.querySelector('[data-mf-kaynaksiz-notu="satislar"]')?.textContent).toBe("₺7.080,00 Mikro'da satış faturası olmayan MF siparişi dâhil değil · 1 kayıt");
    expect(c.textContent).not.toContain('MF-325');
    expect(c.textContent).toContain('MF-400');
    expect(c.textContent).not.toContain('MF-101');   // ikizi Mikro'da: satış Mikro faturasından (QH2-1)
  });
  it('«Cetpa»: not yine basılır (işaretli MF «Cetpa» görünümünde de ciro dışı); ikizli ve işaretsiz MF tabloda', () => {
    const c = ciz('cetpa');
    expect(c.querySelector('[data-mf-kaynaksiz-notu="satislar"]')?.textContent).toContain('1 kayıt');
    expect(c.textContent).not.toContain('MF-325');
    expect(c.textContent).toContain('MF-400');
    expect(c.textContent).toContain('MF-101');
  });
  it('en: «MF orders without a Mikro sales invoice not included · 1 record»; işaretli MF yoksa not ÇİZİLMEZ', () => {
    expect(ciz('hepsi', 'en').querySelector('[data-mf-kaynaksiz-notu="satislar"]')?.textContent).toBe('₺7.080,00 MF orders without a Mikro sales invoice not included · 1 record');
    cleanup();
    expect(mfKaynaksizNotu(satisKaynaksizDisi([ISARETSIZ, YEREL], null), 'tr')).toBeNull();
  });
});
