/**
 * FaturalarTab.test.tsx — Mikro satırına tıklanınca «Fatura Detayı» penceresine giden veri (2026-10-10).
 *
 * `MikroFaturaDetayVerisi.belgeNo` zorunlu anahtarı (derleyici çiti) yalnız anahtarın SİLİNMESİNİ yakalar: `belgeNo: undefined`
 * ya da yanlış alan (`f.faturaNo`) tsc'den geçer ve bu yüzeyde Belge No sessizce '—' / yanlış numara basılırdı. Öteki
 * üreticilerde (Cari Ekstre, `hareketFaturasi`) değer testle bağlı; Muhasebe → Faturalar'da değildi (inceleme 2026-10-10).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FaturalarTab from './FaturalarTab';
import { mapMikroFatura } from '../../hooks/useMikroFaturalar';

vi.mock('../../lib/dbClient', async () => (await import('../../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);

/** SİZGEN alış faturası 420 (kullanıcının ekran görüntüsündeki fatura; yön «gelen»). */
const HAM = { cha_tip: 1, cha_evrakno_seri: '', cha_evrakno_sira: 420, cha_tarihi: '2026-08-31', cha_meblag: 317236.5 };

/** Sekmeyi tek Mikro satırıyla çizer, satıra tıklar; `setFaturaDetay`'e giden nesneyi döndürür. */
function tiklaVeOku(ham: Record<string, unknown>): Record<string, unknown> {
  const setFaturaDetay = vi.fn();
  const bos = () => {};
  const f = mapMikroFatura('g420', ham);
  render(<FaturalarTab
    currentLanguage="tr" isAuthenticated={false}
    showInvoiceModal={false} setShowInvoiceModal={bos}
    invoiceForm={{ faturaNo: '', faturaTipi: 'e-fatura', customerName: '', customerEmail: '', taxId: '', taxOffice: '',
      address: '', kdvOran: 20, date: '', notes: '', orderId: '', tutar: '' }}
    setInvoiceForm={bos} invoiceSource={null} setInvoiceSource={bos} handleCreateInvoice={bos}
    faturaKaynak="mikro" setFaturaKaynak={bos} faturaYon="hepsi" setFaturaYon={bos} faturaYil="hepsi" setFaturaYil={bos}
    mikroFaturalar={[f]} mikroFaturaSatirlari={[{ ...f, musteri: 'SİZGEN' }]} invoices={[]}
    invoiceSearch="" setInvoiceSearch={bos} invoiceTypeFilter="all" setInvoiceTypeFilter={bos}
    invoiceSort={{ key: 'date', direction: 'desc' }} setInvoiceSort={bos}
    setFaturaDetay={setFaturaDetay}
  />);
  fireEvent.click(screen.getByText('SİZGEN'));
  expect(setFaturaDetay).toHaveBeenCalledTimes(1);
  const giden: Record<string, unknown> = setFaturaDetay.mock.calls[0][0];
  cleanup();
  return giden;
}

describe('FaturalarTab — Mikro satırından açılan fatura detayına belge no', () => {
  it('cha_belge_no dolu satır → pencere verisi belge noyu TAŞIR; fatura no ayrı kalır', () => {
    const giden = tiklaVeOku({ ...HAM, cha_belge_no: ' SZG2026000000420 ' });
    expect(giden.belgeNo).toBe('SZG2026000000420');
    expect(giden.faturaNo).toBe('420');
    expect(giden.id).toBe('g420');
  });

  it('belge no yok (eski doküman) → anahtar VAR ve undefined: pencere «—» basar, fatura noya DÜŞMEZ', () => {
    const giden = tiklaVeOku(HAM);
    expect('belgeNo' in giden).toBe(true);
    expect(giden.belgeNo).toBeUndefined();
    expect(giden.faturaNo).toBe('420');
  });
});
