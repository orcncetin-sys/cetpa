/**
 * satislar.qSerisi.test.ts — Satışlar «Tümü» çift sayımının kapanışı (kullanıcı S1 (a)) ve seri Q Mikro satırının «Faturasız»a geçişi
 * (K4, k11). Şartname `.wf/SARTNAME-q-serisi-v3.md` «Kapı sonrası hükümler — Dilim 1» QH2 / QH3 / QH4; testler T10 (yeniden), T10 EK
 * (yıl, arama, `cetpaEvrakNolari`, ikizsiz, «Cetpa» görünümü), T11 (önce / sonra kimliği), T-FİNANS.
 *
 * Fikstür (hepsi 2026 — şartname T10): Mikro F0 100.000 (boş seri, no '101') + ondan türemiş MF-F0 · Mikro Q-1 5.500,20 (seri Q,
 * faturasız) + MF-Q1 (geri doldurmadan önce `faturali: true`) · yerel faturasız S0 2.000.
 */
import { describe, it, expect } from 'vitest';
import {
  cetpaEvrakNolari, mikroSatisSatirlari, cetpaSatisSatirlari, satisKayitlari, satisKpi,
  satisIkizAnahtarlari, satisYerelListesi, satisCiftSayimOzeti,
  type SatisSiparisi, type SatisFaturasi,
} from './satislar';
import { finansSiparisSayaclari } from './mikroCiro';
import { mfIkiziListede } from '../pano/mikroBirlesim';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import { kurusaYuvarla, ekranTutari, tutarBirlestir } from '../para';
import { join } from 'path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';

// ── Fikstür ──────────────────────────────────────────────────────────────────────────────────────
const F0: SatisFaturasi = { id: 'f0', yon: 'giden', tarih: '2026-06-10', cariKod: 'C1', tutar: 100000, kdv: 16666.67, oran: 20, oranKarma: false, faturaNo: '101', faturasiz: false };
const Q1: SatisFaturasi = { id: 'q1', yon: 'giden', tarih: '2026-06-06', cariKod: '0120037047', tutar: 5500.2, kdv: 916.7, oran: 20, oranKarma: false, faturaNo: 'Q-1', faturasiz: true };
const F2025: SatisFaturasi = { id: 'f25', yon: 'giden', tarih: '2025-03-01', cariKod: 'C2', tutar: 50000, kdv: 8333.33, oran: 20, oranKarma: false, faturaNo: '90', faturasiz: false };

const mf = (seri: string, sira: string, tutar: unknown, ek: Partial<SatisSiparisi> = {}): SatisSiparisi => ({
  customerName: `MF-${seri}${sira}`, totalPrice: tutar, faturali: true, source: MF_KAYNAGI, mikroEvrak: { seri, sira }, ...ek,
});
const MF_F0 = mf('', '101', 100000);
const MF_Q1 = mf('Q', '1', 5500.2);
const MF_F2025 = mf('', '90', 50000);
const S0: SatisSiparisi = { customerName: 'Şirin Yapı', totalPrice: 2000, faturali: false, kdvOran: 0, kdvTutari: 0 };

/** AccountingModule ile AYNI çağrı sırası: ikiz kümesi → yerel liste → kart / drill-down / tablo. */
function ekran(orders: readonly SatisSiparisi[], faturalar: readonly SatisFaturasi[], s: { yil: string; kaynak: 'cetpa' | 'mikro' | 'hepsi'; arama?: string }) {
  const evrak = cetpaEvrakNolari(orders);
  const mikroDahil = s.kaynak !== 'cetpa';
  const ikizler = satisIkizAnahtarlari(faturalar, evrak);
  const yerel = satisYerelListesi(orders, { mikroDahil, ikizAnahtarlari: ikizler });
  const mikro = mikroSatisSatirlari(faturalar, { yil: s.yil, cetpaEvrakNolari: evrak, cariAdMap: new Map(), arama: s.arama });
  return {
    kpi: satisKpi(yerel, mikro, mikroDahil),
    kayitlar: satisKayitlari(yerel, mikro, mikroDahil),
    tablo: cetpaSatisSatirlari(yerel, { arama: s.arama }),
    yerel,
    ozet: satisCiftSayimOzeti(orders, ikizler),
  };
}
const kurus = (n: number) => kurusaYuvarla(n);
const toplam = (liste: readonly { totalPrice?: unknown }[]) => kurus(liste.reduce((t, o) => t + Number(o.totalPrice), 0));

/** «Mikro bağlantı B» B2 #2: Finans sayaçlarının kaynaksız MF dışlanma sayacı (bu fikstürlerde işaretli MF yok). */
const KAYNAKSIZ_YOK = { adet: 0, tutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 } };

describe('T10 — S1 (a): «Tümü»de MF ikizi düşer, satış Mikro faturasından BİR KEZ; Q-1 «Faturasız»da', () => {
  const orders = [MF_F0, MF_Q1, S0];
  const faturalar = [F0, Q1];
  const e = ekran(orders, faturalar, { yil: '2026', kaynak: 'hepsi' });

  it('ciro = F0 + Q-1 + S0; faturalı = F0; faturasız = Q-1 + S0; adetler 1 / 2; Toplam Sipariş 1; Ortalama 2.000 / 1', () => {
    expect(kurus(e.kpi.ciro.toplam)).toBe(kurus(100000 + 5500.2 + 2000));
    expect(kurus(e.kpi.faturaliCiro.toplam)).toBe(100000);
    expect(kurus(e.kpi.faturasizCiro.toplam)).toBe(kurus(5500.2 + 2000));
    expect([e.kpi.faturaliAdet, e.kpi.faturasizAdet, e.kpi.adet]).toEqual([1, 2, 1]);
    expect(e.kpi.ortalama).toBe(2000);
    // Çit (QH2-7): toplam = faturalı + faturasız, kuruşu kuruşuna.
    expect(kurus(e.kpi.ciro.toplam)).toBe(kurus(e.kpi.faturaliCiro.toplam + e.kpi.faturasizCiro.toplam));
    expect(e.kpi.ciro).toEqual(tutarBirlestir(e.kpi.faturaliCiro, e.kpi.faturasizCiro));
  });

  it('drill-down «Faturalı» toplamı = faturaliCiro, «Faturasız» = faturasizCiro; kart, drill-down ve tablo AYNI yerel liste', () => {
    expect(toplam(e.kayitlar.filter(k => k.faturali))).toBe(kurus(e.kpi.faturaliCiro.toplam));
    expect(toplam(e.kayitlar.filter(k => !k.faturali))).toBe(kurus(e.kpi.faturasizCiro.toplam));
    expect(e.yerel).toEqual([S0]);
    expect(e.tablo).toEqual([S0]);
    expect(e.kayitlar.slice(0, e.yerel.length)).toEqual(e.yerel);
  });

  it('Mikro şeridi DEĞİŞMEZ: Mikro payı iki faturanın tamamı (seri Q dâhil)', () => {
    expect(e.kpi.mikro.adet).toBe(2);
    expect(kurus(e.kpi.mikro.ciro.toplam)).toBe(kurus(105500.2));
  });

  it('ölçü: eşleşen 2 MF, tutarları; faturasız eşleşen 0 (MF-Q1 geri doldurmadan önce faturalı); ikizsiz 0', () => {
    expect(e.ozet).toEqual({ eslesenAdet: 2, eslesenTutar: { toplam: 105500.2, bilinen: 2, bilinmeyen: 0 }, eslesenFaturasizAdet: 0, ikizsizMfAdet: 0,
      kaynaksizAdet: 0, kaynaksizTutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 } });   // «Mikro bağlantı B» BH8 ayrık sayaç (işaretli MF yok)
    // Geri doldurmadan SONRA (MF-Q1 `faturali: false`) aynı kümede faturasız eşleşen 1; ciro aynı.
    const sonra = ekran([MF_F0, { ...MF_Q1, faturali: false }, S0], faturalar, { yil: '2026', kaynak: 'hepsi' });
    expect(sonra.ozet.eslesenFaturasizAdet).toBe(1);
    expect(kurus(sonra.kpi.ciro.toplam)).toBe(kurus(e.kpi.ciro.toplam));
  });
});

describe('T10 EK — yıl: ikiz kümesi süzgeç ÖNCESİ (M41)', () => {
  const orders = [MF_F0, MF_Q1, S0, MF_F2025];
  const faturalar = [F0, Q1, F2025];

  it('«2026»: F-2025 de MF-F-2025 de SAYILMAZ (2025 satışı 2026 görünümünde yok)', () => {
    const e = ekran(orders, faturalar, { yil: '2026', kaynak: 'hepsi' });
    expect(kurus(e.kpi.ciro.toplam)).toBe(kurus(107500.2));
    expect(e.kpi.adet).toBe(1);
  });
  it('«Tüm yıllar»: F-2025 bir kez (Mikro satırı), MF-F-2025 düşer; `satisCiftSayimOzeti` iki görünümde AYNI', () => {
    const tum = ekran(orders, faturalar, { yil: 'hepsi', kaynak: 'hepsi' });
    const yil = ekran(orders, faturalar, { yil: '2026', kaynak: 'hepsi' });
    expect(kurus(tum.kpi.ciro.toplam)).toBe(kurus(157500.2));
    expect(tum.ozet).toEqual(yil.ozet);
    expect(tum.ozet.eslesenAdet).toBe(3);
  });
});

describe('T10 EK — arama: Mikro payı aramaya bugünkü gibi uyar; yerel KPI aramadan bağımsız (M41)', () => {
  it('F0 aramaya uymuyor → F0 de MF-F0 da sayılmaz; yerel S0 sayılır', () => {
    const e = ekran([MF_F0, S0], [F0], { yil: '2026', kaynak: 'hepsi', arama: 'zzz-yok' });
    expect(kurus(e.kpi.ciro.toplam)).toBe(2000);
    expect(e.kpi.mikro.adet).toBe(0);
    expect(e.yerel).toEqual([S0]);
  });
});

describe('T10 EK — `cetpaEvrakNolari` F0\'ı eliyorsa MF-F0 sayılır (M34: satış kaybolmaz)', () => {
  it('yerel siparişin Mikro evrak no\'su = F0 → F0 Mikro satırından düşer, MF-F0 yerelde KALIR', () => {
    const gonderilmis: SatisSiparisi = { customerName: 'Gönderilen', totalPrice: 1, faturali: true, mikroEvrakNo: '101' };
    const e = ekran([MF_F0, gonderilmis], [F0], { yil: '2026', kaynak: 'hepsi' });
    expect(e.yerel).toEqual([MF_F0, gonderilmis]);
    expect(e.kpi.mikro.adet).toBe(0);
    expect(kurus(e.kpi.ciro.toplam)).toBe(100001);
  });
});

describe('T10 EK — ikizsiz MF bir kez sayılır (M34)', () => {
  it('MF-X\'in Mikro faturası `mikroFaturalar`\'da yok → listede kalır; `ikizsizMfAdet` 1', () => {
    const mfX = mf('', '555', 7000);
    const mikroEvraksiz = { ...mf('', '556', 3000), mikroEvrak: undefined };
    const e = ekran([MF_F0, mfX, mikroEvraksiz], [F0], { yil: '2026', kaynak: 'hepsi' });
    expect(e.yerel).toEqual([mfX, mikroEvraksiz]);
    expect(kurus(e.kpi.ciro.toplam)).toBe(110000);
    expect(e.ozet).toMatchObject({ eslesenAdet: 1, ikizsizMfAdet: 2 });
  });
  it('anahtar `mikroFaturaNo`\'dan DEĞİL `mikroEvrak`\'tan (M33): Q çifti eşleşir ("Q1" ≠ "Q-1")', () => {
    expect(mfIkiziListede({ ...MF_Q1, mikroFaturaNo: 'Q1' } as SatisSiparisi, new Set(['Q-1']))).toBe(true);
    expect(mfIkiziListede({ source: MF_KAYNAGI, mikroEvrak: { seri: ' q ', sira: 1 } }, new Set(['q-1']))).toBe(true);
    expect(mfIkiziListede({ source: 'cetpa', mikroEvrak: { seri: 'Q', sira: '1' } }, new Set(['Q-1']))).toBe(false);
    expect(mfIkiziListede({ source: MF_KAYNAGI }, new Set(['Q-1']))).toBe(false);
    expect(mfIkiziListede({ source: MF_KAYNAGI, mikroEvrak: { seri: '', sira: '' } }, new Set(['']))).toBe(false);
  });
});

describe('T10 EK — «Cetpa» görünümü bugünkü `satisKpi` ile BİREBİR', () => {
  it('MF\'ler yerelde kalır; kart, drill-down ve tablo aynı liste; ciro = faturalı + faturasız', () => {
    const orders = [MF_F0, MF_Q1, S0];
    const e = ekran(orders, [F0, Q1], { yil: '2026', kaynak: 'cetpa' });
    expect(e.yerel).toEqual(orders);
    expect(e.tablo).toEqual(orders);
    expect(e.kayitlar).toEqual(orders);
    // Bugünkü formül: Cetpa siparişleri, Mikro yok.
    expect(kurus(e.kpi.ciro.toplam)).toBe(kurus(100000 + 5500.2 + 2000));
    expect(kurus(e.kpi.faturaliCiro.toplam)).toBe(kurus(105500.2));
    expect(kurus(e.kpi.faturasizCiro.toplam)).toBe(2000);
    expect([e.kpi.adet, e.kpi.faturaliAdet, e.kpi.faturasizAdet]).toEqual([3, 2, 1]);
    expect(e.kpi.mikro.adet).toBe(0);
    expect(e.kpi.ciro).toEqual(tutarBirlestir(e.kpi.faturaliCiro, e.kpi.faturasizCiro));
  });
});

describe('T11 — önce / sonra kimliği (QH4-2)', () => {
  it('aynı girdide eskiCiro − yeniCiro = eslesenTutar (kuruş); tutarı bilinmeyen MF SAYILIR, 0 sayılmaz', () => {
    const bilinmeyenMf = mf('', '777', null);
    const F777: SatisFaturasi = { ...F0, id: 'f777', faturaNo: '777', tutar: 300 };
    const orders = [MF_F0, MF_Q1, S0, bilinmeyenMf];
    const faturalar = [F0, Q1, F777];
    const evrak = cetpaEvrakNolari(orders);
    const mikro = mikroSatisSatirlari(faturalar, { yil: 'hepsi', cetpaEvrakNolari: evrak, cariAdMap: new Map() });
    const eski = satisKpi(orders, mikro, true);                       // bugünkü çağrı: ham `orders`
    const ikizler = satisIkizAnahtarlari(faturalar, evrak);
    const yeni = satisKpi(satisYerelListesi(orders, { mikroDahil: true, ikizAnahtarlari: ikizler }), mikro, true);
    const o = satisCiftSayimOzeti(orders, ikizler);
    expect(kurus(eski.ciro.toplam - yeni.ciro.toplam)).toBe(kurus(o.eslesenTutar.toplam));
    expect(o.eslesenAdet).toBe(3);
    expect(o.eslesenTutar).toEqual({ toplam: 105500.2, bilinen: 2, bilinmeyen: 1 });
    expect(eski.ciro.bilinmeyen - yeni.ciro.bilinmeyen).toBe(1);
    expect(ekranTutari(o.eslesenTutar)).toBe(105500.2);
    expect(eski.adet - yeni.adet).toBe(o.eslesenAdet);
  });
});

describe('T-FİNANS — Faturalı / Faturasız / Toplam Sipariş (QH3)', () => {
  const sip = (ek: Record<string, unknown>) => ek as { hasInvoice?: boolean; source?: string; mikroEvrak?: { seri?: unknown; sira?: unknown } };
  it('aynı fikstür → Faturalı 1 (F0) / Faturasız 2 (Q-1 + S0) / Toplam 3 (M38)', () => {
    const orders = [sip({ ...MF_F0 }), sip({ ...MF_Q1 }), sip({ ...S0 })];
    expect(finansSiparisSayaclari(orders, [F0, Q1])).toEqual({ faturali: 1, faturasiz: 2, toplam: 3, kaynaksizDisi: KAYNAKSIZ_YOK });
  });
  it('ikizsiz MF bugünkü gibi sayılır (hasInvoice yok → faturasız)', () => {
    const orders = [sip({ ...MF_F0 }), sip({ ...mf('', '555', 1) }), sip({ customerName: 'K', hasInvoice: true })];
    expect(finansSiparisSayaclari(orders, [F0])).toEqual({ faturali: 2, faturasiz: 1, toplam: 3, kaynaksizDisi: KAYNAKSIZ_YOK });
  });
  it('`faturasiz` alanı olmayan Mikro satırı faturalı sayılır (eski doküman paritesi)', () => {
    const eski = { yon: 'giden', faturaNo: 'Z-9' };
    expect(finansSiparisSayaclari([], [eski])).toEqual({ faturali: 1, faturasiz: 0, toplam: 1, kaynaksizDisi: KAYNAKSIZ_YOK });
  });
});

describe('BAĞLANTI — AccountingModule çağrı zinciri (yazıldı ama bağlanmadı çiti; M35, M41)', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'components/AccountingModule.tsx')).map(x => x.kod).join('\n');
  it('ikiz kümesi HAM `mikroFaturalar`\'dan (süzülmüş Mikro satırlarından DEĞİL — M41)', () => {
    expect(kod).toMatch(/satisIkizAnahtarlari\(mikroFaturalar, cetpayaAitEvrakNo\)/);
    expect(kod).not.toMatch(/satisIkizAnahtarlari\(mikroSatisSatirlari/);
  });
  it('kart, drill-down ve tablo AYNI yerel listeyi alır (M35); ham `orders` bu üç çağrıya gitmez', () => {
    expect(kod).toMatch(/satisYerelListesi\(orders, \{ mikroDahil, ikizAnahtarlari: satisIkizleri \}\)/);
    expect(kod).toMatch(/satisKpi\(satisYerel, mikroSatisSatirlari, mikroDahil\)/);
    expect(kod).toMatch(/satisKayitlariHesapla\(satisYerel, mikroSatisSatirlari, mikroDahil\)/);
    expect(kod).toMatch(/cetpaSatisSatirlari\(satisYerel, \{/);
    expect(kod).not.toMatch(/(satisKpi|satisKayitlariHesapla|cetpaSatisSatirlari)\(orders\b/);
  });
  it('ekran notu bağlı: SatislarTab `satisCiftSayim` alır ve `mfIkiziSayilmadi` basar', () => {
    expect(kod).toMatch(/satisCiftSayim=\{satisCiftSayim\}/);
    const sekme = kodSatirlari(join(SRC_KOK, 'components/accounting/SatislarTab.tsx')).map(x => x.kod).join('\n');
    expect(sekme).toMatch(/mfIkiziSayilmadi\(satisCiftSayim\.eslesenAdet/);
    const finans = kodSatirlari(join(SRC_KOK, 'components/FinancePanel.tsx')).map(x => x.kod).join('\n');
    expect(finans).toMatch(/finansSiparisSayaclari\(orders, mikroGiden\)/);
  });
});

