/**
 * BankaTab.test.tsx: Banka sekmesi GERÇEKTEN çizilir (şartname «Mikro bağlantı A» A5.3, 2026-11-05). Saf sayım
 * `utils/muhasebe/bankaHesap.test.ts`'te (`dovizBakiyeleri` null'u bilinmeyen sayar); burada «yazıldı ama bağlanmadı» çiti:
 * bakiyesi bilinmeyen hesap sayısı KPI kartının altında «N hesabın bakiyesi bilinmiyor · toplama girmedi» olarak görünür
 * (eski metin «N hesap tutarsız»: Mikro'nun açtığı yeni hesap `balance: null` yazar, tutarsızlık değil bilinmezlik), bilinmeyen
 * yoksa not yok; hiç bilinen yoksa tutar «—» (0 değil).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BankaTab from './BankaTab';
import { ac } from '../../i18n/accounting';
import { oc } from '../../i18n/ortak';
import type { BankAccount } from '../../types';

const HESAP: BankAccount = {
  id: 'g-yeni', bankName: 'İŞ BANKASI', branch: '', accountHolder: '', accountNumber: '', iban: '',
  currency: 'TRY', balance: Number.NaN, accountType: 'Vadesiz',
};

function ciz(dil: 'tr' | 'en', bilinmeyen: Record<'TRY' | 'USD' | 'EUR', number>, tryBalance: number, modal: { duzenlenen: BankAccount | null } | null = null) {
  const bos = vi.fn();
  return render(
    <BankaTab
      t={ac(dil)} currentLanguage={dil} bankAccounts={[HESAP]}
      tryBalance={tryBalance} usdBalance={0} eurBalance={0} bakiyeBilinmeyen={bilinmeyen}
      setDrillDown={bos} handleBankFileImport={bos} openAddBank={bos}
      bankSearch="" setBankSearch={bos} bankImportStatus={null} setBankImportStatus={bos}
      bankSortKey="bankName" bankSortDir="asc" toggleBankSort={bos} displayedAccounts={[HESAP]}
      openEditBank={bos} deleteBank={bos} mikroEnabled={false} mikroConnected={false}
      bankTxLastPull={null} bankTxAutoSync={false} setBankTxAutoSync={bos} pullBankTransactions={bos}
      bankTxPulling={false} bankTxSearch="" setBankTxSearch={bos} bankTxFilter="all" setBankTxFilter={bos}
      bankTransactions={[]} bankTxSort={{ key: 'date', dir: 'desc' }} setBankTxSort={bos}
      showBankModal={modal !== null} setShowBankModal={bos} editingBank={modal?.duzenlenen ?? null}
      bankForm={{ bankName: '', branch: '', accountHolder: '', accountNumber: '', iban: '', currency: 'TRY', balance: '', accountType: 'Vadesiz' }}
      setBankForm={bos} saveBank={bos}
    />,
  );
}

describe('BankaTab · bakiyesi bilinmeyen hesap notu (A5.3)', () => {
  it('TRY\'de 1 bilinmeyen → «1 hesabın bakiyesi bilinmiyor · toplama girmedi»; eski «tutarsız» metni YOK; tutar «—»', () => {
    ciz('tr', { TRY: 1, USD: 0, EUR: 0 }, Number.NaN);
    expect(screen.getByText('1 hesabın bakiyesi bilinmiyor · toplama girmedi')).toBeInTheDocument();
    expect(screen.queryByText(/tutarsız/)).toBeNull();
    expect(screen.getByText(ac('tr').tryBalance).closest('button')?.textContent).toContain('—');
  });

  it('en: «1 account(s) with unknown balance · excluded from total»', () => {
    ciz('en', { TRY: 0, USD: 1, EUR: 0 }, 0);
    expect(screen.getByText('1 account(s) with unknown balance · excluded from total')).toBeInTheDocument();
  });

  it('bilinmeyen yoksa not çizilmez', () => {
    ciz('tr', { TRY: 0, USD: 0, EUR: 0 }, 0);
    expect(screen.queryByText(/bakiyesi bilinmiyor/)).toBeNull();
  });
});

// Şartname «Mikro bağlantı B» § 3.6 / T-B1-5: Mikro hesabının bakiye girdisi SALT OKUNUR (bakiye gece Mikro'dan gelir); elle hesapta
// sayı girdisi bugünkü gibi. Mutasyon: koşul kaldırılırsa (her hesapta sayı girdisi) birinci test kırmızı.
describe('BankaTab · hesap formu · Mikro hesabında bakiye kilitli (T-B1-5)', () => {
  it('Mikro hesabı düzenlenirken bakiye alanı salt okunur, «—» ve açıklama; sayı girdisi YOK', () => {
    ciz('tr', { TRY: 1, USD: 0, EUR: 0 }, Number.NaN, { duzenlenen: { ...HESAP, source: 'mikro', balance: null } });
    const alan = screen.getByLabelText(oc('tr').bakiye);
    expect(alan).toHaveAttribute('readonly');
    expect(alan).toHaveValue('—');
    expect(screen.getByText(ac('tr').mikro_hesabi_bakiye_geceden)).toBeInTheDocument();
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });
  it('elle hesap (ve yeni hesap) düzenlenirken bakiye sayı girdisi; kilit notu yok', () => {
    ciz('tr', { TRY: 0, USD: 0, EUR: 0 }, 0, { duzenlenen: { ...HESAP, balance: 500 } });
    expect(document.querySelector('input[type="number"]')).not.toBeNull();
    expect(screen.queryByText(ac('tr').mikro_hesabi_bakiye_geceden)).toBeNull();
    ciz('tr', { TRY: 0, USD: 0, EUR: 0 }, 0, { duzenlenen: null });
    expect(screen.queryAllByText(ac('tr').mikro_hesabi_bakiye_geceden)).toEqual([]);
  });
});
