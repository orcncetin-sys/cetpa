/**
 * qSerisi.sekmeler.test.tsx — Q serisi Dilim 1'in SEKME düzeyi bağlantısı (şartname `.wf/SARTNAME-q-serisi-v3.md` Q9-2, QH2-10,
 * QH5-9; T3, T7, T10, T-RESMÎ'nin ekran kolu). Saf işlevler kendi testlerinde (`qSerisi.resmi.test.ts`, `satislar.qSerisi.test.ts`)
 * sınanıyor; burada GERÇEK sekme bileşeni o işlevlerin GERÇEK çıktısıyla çizilir ve not / çip / rozet ekranda aranır — «yazıldı ama
 * bağlanmadı» çiti (işlev doğru, ekran onu basmıyor sınıfı). Sahte olan yalnız veri istemcisi (FaturalarTab.test.tsx kalıbı).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FaturalarTab from './FaturalarTab';
import KdvTab from './KdvTab';
import GelirGiderTab from './GelirGiderTab';
import SatislarTab from './SatislarTab';
import { mapMikroFatura } from '../../hooks/useMikroFaturalar';
import { ac } from '../../i18n/accounting';
import { kdvDonemi } from '../../utils/muhasebe/kdvBeyan';
import {
  cetpaEvrakNolari, mikroSatisSatirlari, cetpaSatisSatirlari, satisKayitlari, satisKpi,
  satisIkizAnahtarlari, satisYerelListesi, satisCiftSayimOzeti,
} from '../../utils/muhasebe/satislar';
import { MF_KAYNAGI } from '../../lib/mfKaynagi';
import type { JournalEntry, Order } from '../../types';

vi.mock('../../lib/dbClient', async () => (await import('../../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

afterEach(() => cleanup());
const bos = () => {};
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Ham Mikro dokümanları — gerçek okuyucudan (`mapMikroFatura`) geçer: `seri` / `faturasiz` orada türetilir. */
const F0 = mapMikroFatura('f0', { cha_tip: 0, cha_evrakno_seri: '', cha_evrakno_sira: 101, cha_tarihi: '2026-06-15', cha_meblag: 100000,
  cha_ebelge_Islemturu: 1, kdvTutari: 16666.67, matrah: 83333.33 });
const Q1 = mapMikroFatura('q1', { cha_tip: 0, cha_evrakno_seri: 'Q', cha_evrakno_sira: 1, cha_tarihi: '2026-06-06', cha_meblag: 5500.2,
  cha_ebelge_Islemturu: 2, kdvTutari: 916.7, matrah: 4583.5 });

describe('ön koşul — fikstür gerçek okuyucudan geçti', () => {
  it('Q-1 faturasız, F0 değil; anahtarlar "Q-1" / "101"', () => {
    expect([Q1.faturasiz, Q1.faturaNo, F0.faturasiz, F0.faturaNo]).toEqual([true, 'Q-1', false, '101']);
  });
});

describe('FaturalarTab — «Faturasız (Q)» çipi ve KPI «içinde N faturasız (Q)» notu (Q9-2)', () => {
  it('«Tümü»nde Q-1 satırı e-belge çipi yerine «Faturasız (Q)» taşır; F0 taşımaz; satış tutarı notu Q-1\'i söyler', () => {
    const satirlar = [{ ...F0, musteri: 'BOŞ SERİ CARİ' }, { ...Q1, musteri: 'Q CARİ' }];
    const { container } = render(<FaturalarTab
      currentLanguage="tr" isAuthenticated={false}
      showInvoiceModal={false} setShowInvoiceModal={bos}
      invoiceForm={{ faturaNo: '', faturaTipi: 'e-fatura', customerName: '', customerEmail: '', taxId: '', taxOffice: '',
        address: '', kdvOran: 20, date: '', notes: '', orderId: '', tutar: '' }}
      setInvoiceForm={bos} invoiceSource={null} setInvoiceSource={bos} handleCreateInvoice={bos}
      faturaKaynak="mikro" setFaturaKaynak={bos} faturaYon="hepsi" setFaturaYon={bos} faturaYil="hepsi" setFaturaYil={bos}
      mikroFaturalar={[F0, Q1]} mikroFaturaSatirlari={satirlar} invoices={[]}
      invoiceSearch="" setInvoiceSearch={bos} invoiceTypeFilter="all" setInvoiceTypeFilter={bos}
      invoiceSort={{ key: 'date', direction: 'desc' }} setInvoiceSort={bos}
      setFaturaDetay={bos}
    />);
    expect(container.querySelector('[data-faturasiz-cip="q1"]')?.textContent).toBe('Faturasız (Q)');
    expect(container.querySelector('[data-faturasiz-cip="f0"]')).toBeNull();
    expect(container.textContent).toContain('içinde 1 faturasız (Q) · ₺5.500,20');
  });
});

describe('KdvTab — seçili ayın dışlanan Q-1\'i not satırında (T3 metni, T-RESMÎ ekran kolu)', () => {
  const ciz = (ay: number) => {
    const kdvDonem = kdvDonemi([] as JournalEntry[], [F0, Q1], 2026, ay);
    return render(<KdvTab
      t={ac('tr')} currentLanguage="tr" MONTHS={AYLAR} kdvMonth={ay} setKdvMonth={bos} kdvYear={2026} setKdvYear={bos}
      hesaplananKDV={kdvDonem.hesaplanan.toplam} indirilecekKDV={kdvDonem.indirilecek.toplam} odenecekKDV={0}
      kdvDonem={kdvDonem} setDrillDown={bos} kdvSearch="" setKdvSearch={bos} kdvSortBy="ay" kdvSortDir2="asc"
      setKdvSortBy={bos} setKdvSortDir2={bos} kdvOranBreakdown={{}}
      downloadVatDeclaration={bos} downloadVatDeclarationCSV={bos}
    />).container;
  };
  it('Haziran: «₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV\'si ₺916,70)»', () => {
    expect(ciz(6).querySelector('[data-faturasiz-notu="kdv-donemi"]')?.textContent)
      .toBe('₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV\'si ₺916,70)');
  });
  it('Temmuz: dışlanan yok → satır ÇİZİLMEZ', () => {
    expect(ciz(7).querySelector('[data-faturasiz-notu="kdv-donemi"]')).toBeNull();
  });
});

describe('GelirGiderTab — 600 (Mikro) notu prop\'tan çizilir', () => {
  const ciz = (faturasizNotu: string | null) => render(<GelirGiderTab
    t={ac('tr')} currentLanguage="tr" MONTHS={AYLAR} gelirMonth={6} setGelirMonth={bos} gelirYear={2026} setGelirYear={bos}
    gelirDateFrom="" setGelirDateFrom={bos} gelirDateTo="" setGelirDateTo={bos} gelirUseRange={false} setGelirUseRange={bos}
    gelirCurrency="TRY" setGelirCurrency={bos} exchangeRates={undefined} setDrillDown={bos}
    gelirBreakdown={{}} giderBreakdown={{}} toplamGelir={0} toplamGider={0} netKar={0} monthlyData={[]} maxChartVal={1}
    gelirTutarsiz={0} giderTutarsiz={0} tarihsiz={0} faturasizNotu={faturasizNotu}
  />).container;
  it('not verilince satır var; null → yok', () => {
    expect(ciz('₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV\'si ₺916,70)').querySelector('[data-faturasiz-notu="gelir-gider"]')?.textContent)
      .toContain('faturasız (Q) dâhil değil');
    expect(ciz(null).querySelector('[data-faturasiz-notu="gelir-gider"]')).toBeNull();
  });
});

describe('SatislarTab — MF ikizi notu (QH2-10) ve tablo rozeti (QH5-9) gerçek hesap zinciriyle', () => {
  const mf = (id: string, seri: string, sira: string, tutar: number) => ({
    id, customerName: `MF-${seri}${sira}`, totalPrice: tutar, status: 'Delivered', faturali: true, source: MF_KAYNAGI,
    mikroEvrak: { seri, sira }, mikroFaturaNo: `${seri}${sira}`,
  } as Order);
  const S0 = { id: 's0', customerName: 'Şirin Yapı', totalPrice: 2000, status: 'Delivered', faturali: false, kdvOran: 0, kdvTutari: 0 } as Order;
  const ORDERS = [mf('mf-f0', '', '101', 100000), mf('mf-q1', 'Q', '1', 5500.2), S0];

  type DrillDown = { title: string; rows: Array<{ label: string; badge?: string; badgeColor?: string }> };
  let sonDrill: DrillDown | null = null;
  const drillYakala = (d: DrillDown | null) => { sonDrill = d; };
  /** AccountingModule ile AYNI çağrı sırası (ikiz kümesi → yerel liste → kart / drill-down / tablo / not). */
  const ciz = (kaynak: 'cetpa' | 'hepsi', dil: 'tr' | 'en' = 'tr') => {
    const evrak = cetpaEvrakNolari(ORDERS);
    const mikroDahil = kaynak !== 'cetpa';
    const ikizler = satisIkizAnahtarlari([F0, Q1], evrak);
    const yerel = satisYerelListesi(ORDERS, { mikroDahil, ikizAnahtarlari: ikizler });
    const mikro = mikroSatisSatirlari([F0, Q1], { yil: '2026', cetpaEvrakNolari: evrak, cariAdMap: new Map(), arama: '' });
    return render(<SatislarTab
      t={ac(dil)} currentLanguage={dil} satisKayitlari={satisKayitlari(yerel, mikro, mikroDahil)}
      setDrillDown={drillYakala} formatConv={n => String(n)} kpiCurrency="TRY" setKpiCurrency={bos}
      satisKaynak={kaynak} setSatisKaynak={bos} satisOzet={satisKpi(yerel, mikro, mikroDahil)} mikroDahil={mikroDahil}
      mikroSatisSatirlari={mikro} satisCiftSayim={mikroDahil ? satisCiftSayimOzeti(ORDERS, ikizler) : null}
      satisSearch="" setSatisSearch={bos} satisYil="2026" setSatisYil={bos}
      satisSortKey="date" satisSortDir="desc" toggleSatisSort={bos} displayedSatis={cetpaSatisSatirlari(yerel, { arama: '' })}
    />).container;
  };

  it('«Tümü»: not «2 Mikro faturasından türetilen sipariş (MF-…) sayılmadı … · ₺105.500,20»; MF satırları tabloda yok', () => {
    const c = ciz('hepsi');
    const not = c.querySelector('[data-mf-ikizi-notu]')?.textContent ?? '';
    expect(not).toContain('2 Mikro faturasından türetilen sipariş (MF-…) sayılmadı; satış Mikro faturasından sayılır (yıl ve arama seçimine göre)');
    expect(not).toContain('105.500,20');
    expect(c.textContent).not.toContain('MF-Q1');
    expect(c.textContent).toContain('Şirin Yapı');
  });

  it('«Cetpa»: not YOK; MF-Q1 satırı «FATURASIZ · MİKRO Q», MF-F0 «FATURALI», yerel faturasız «FATURASIZ»', () => {
    const c = ciz('cetpa');
    expect(c.querySelector('[data-mf-ikizi-notu]')).toBeNull();
    const rozet = (ad: string) => [...c.querySelectorAll('tr')].find(tr => tr.textContent?.includes(ad))?.querySelectorAll('span');
    const metinler = (ad: string) => [...(rozet(ad) ?? [])].map(s => s.textContent);
    expect(metinler('MF-Q1')).toContain('FATURASIZ · MİKRO Q');
    expect(metinler('MF-101')).toContain('FATURALI');
    expect(metinler('Şirin Yapı')).toContain('FATURASIZ');
  });

  /** Tablo satırının rozet metni (son span). */
  const tabloRozeti = (c: HTMLElement, ad: string) => [...c.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(ad))
    ?.querySelector('td:nth-child(4) span')?.textContent;
  /** Drill-down düğmesine bas, rozetleri `etiket → rozet` olarak döndür. */
  const drillRozetleri = (c: HTMLElement, kart: string): Record<string, string | undefined> => {
    sonDrill = null;
    const dugme = [...c.querySelectorAll('button')].find(b => b.textContent?.includes(kart));
    if (!dugme) throw new Error(`kart yok: ${kart}`);
    fireEvent.click(dugme);
    const d: DrillDown | null = sonDrill;
    if (!d) throw new Error(`drill-down açılmadı: ${kart}`);
    return Object.fromEntries((d as DrillDown).rows.map(r => [r.label, r.badge]));
  };

  it('EN «Cetpa»: tablonun İKİ rozet kolu da İngilizce (INVOICED / NO INVOICE / NO INVOICE · MIKRO Q) — dil karışmaz (Q7)', () => {
    const c = ciz('cetpa', 'en');
    expect(tabloRozeti(c, 'MF-101')).toBe('INVOICED');
    expect(tabloRozeti(c, 'Şirin Yapı')).toBe('NO INVOICE');
    expect(tabloRozeti(c, 'MF-Q1')).toBe('NO INVOICE · MIKRO Q');
    expect(c.querySelector('tbody')?.textContent).not.toMatch(/FATURALI|FATURASIZ/);
  });

  it('drill-down rozetleri sözlükten ve `faturasizEtiketi`\'nden: MF-Q1 drill-down\'da da «FATURASIZ · MİKRO Q»; EN\'de İngilizce (Q7)', () => {
    const tr = ciz('cetpa', 'tr');
    expect(drillRozetleri(tr, 'Toplam Sipariş')).toEqual({ 'MF-101': 'FATURALI', 'MF-Q1': 'FATURASIZ · MİKRO Q', 'Şirin Yapı': 'FATURASIZ' });
    // «Faturalı» drill-down `o.faturali` ile süzülür (MF-Q1 geri doldurmadan önce `faturali: true`); rozet tablo ile AYNI kural.
    expect(drillRozetleri(tr, 'Faturalı / Faturasız')).toEqual({ 'MF-101': 'FATURALI', 'MF-Q1': 'FATURASIZ · MİKRO Q' });
    cleanup();
    const en = ciz('cetpa', 'en');
    expect(drillRozetleri(en, 'Toplam Sipariş')).toEqual({ 'MF-101': 'INVOICED', 'MF-Q1': 'NO INVOICE · MIKRO Q', 'Şirin Yapı': 'NO INVOICE' });
    expect(drillRozetleri(en, 'Faturalı / Faturasız')).toEqual({ 'MF-101': 'INVOICED', 'MF-Q1': 'NO INVOICE · MIKRO Q' });
  });

  it('MF ikizi notu `bg-blue-50` (koyu tema kuralı `.dark .bg-blue-50` tutar; `/60` tutmazdı — Q8); EN tekil / çoğul (Q9)', () => {
    const c = ciz('hepsi');
    const not = c.querySelector('[data-mf-ikizi-notu]');
    expect(not?.classList.contains('bg-blue-50')).toBe(true);
    expect(not?.className).not.toMatch(/bg-blue-50\//);
    // Zemin ve metin rengi BİRLİKTE koyu temaya eşlenir: yalnız zemin koyulursa koyu metin koyu zeminde okunmaz (delta incelemesi).
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');
    const renkler = (not?.className ?? '').split(/\s+/).filter(s => /^(bg|text)-[a-z]+-\d+$/.test(s));
    expect(renkler.length).toBeGreaterThanOrEqual(2);
    for (const r of renkler) expect(css, r).toMatch(new RegExp(`\\.dark \\.${r}\\s*\\{`));
    cleanup();
    expect(ciz('hepsi', 'en').querySelector('[data-mf-ikizi-notu]')?.textContent)
      .toMatch(/^2 orders derived from Mikro invoices \(MF-…\) are not counted; /);
  });
});

describe('i18n — EN «MF ikizi sayılmadı» notu tekil / çoğul (Q9); Türkçe satır aynen', () => {
  it('n=1 «1 order … is not counted»; n=2 «2 orders … are not counted»', () => {
    expect(ac('en').mfIkiziSayilmadi(1, '₺5.500,20'))
      .toBe('1 order derived from Mikro invoices (MF-…) is not counted; the sale is counted from the Mikro invoice (per the year and search selection) · ₺5.500,20');
    expect(ac('en').mfIkiziSayilmadi(2, '₺105.500,20'))
      .toBe('2 orders derived from Mikro invoices (MF-…) are not counted; the sale is counted from the Mikro invoice (per the year and search selection) · ₺105.500,20');
    expect(ac('tr').mfIkiziSayilmadi(1, '₺5.500,20'))
      .toBe('1 Mikro faturasından türetilen sipariş (MF-…) sayılmadı; satış Mikro faturasından sayılır (yıl ve arama seçimine göre) · ₺5.500,20');
  });
});
