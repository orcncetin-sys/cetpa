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
import type { BankAccount } from '../../types';

const HESAP: BankAccount = {
  id: 'g-yeni', bankName: 'İŞ BANKASI', branch: '', accountHolder: '', accountNumber: '', iban: '',
  currency: 'TRY', balance: Number.NaN, accountType: 'Vadesiz',
};

function ciz(dil: 'tr' | 'en', bilinmeyen: Record<'TRY' | 'USD' | 'EUR', number>, tryBalance: number) {
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
      showBankModal={false} setShowBankModal={bos} editingBank={null}
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
