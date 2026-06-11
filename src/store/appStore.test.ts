import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';
import { UserRole } from '../types';

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    language: 'tr',
    exchangeRates: null,
    user: null,
    userRole: UserRole.Sales,
    companyId: null,
  });
});

describe('useAppStore', () => {
  it('starts with default language tr', () => {
    expect(useAppStore.getState().language).toBe('tr');
  });

  it('setLanguage updates language', () => {
    useAppStore.getState().setLanguage('en');
    expect(useAppStore.getState().language).toBe('en');
  });

  it('starts with null exchangeRates', () => {
    expect(useAppStore.getState().exchangeRates).toBeNull();
  });

  it('setExchangeRates updates rates', () => {
    const rates = { USD: 46.5, EUR: 50.2 };
    useAppStore.getState().setExchangeRates(rates);
    expect(useAppStore.getState().exchangeRates?.USD).toBe(46.5);
    expect(useAppStore.getState().exchangeRates?.EUR).toBe(50.2);
  });

  it('starts with default Sales role', () => {
    expect(useAppStore.getState().userRole).toBe(UserRole.Sales);
  });

  it('setUserRole updates role', () => {
    useAppStore.getState().setUserRole(UserRole.Admin);
    expect(useAppStore.getState().userRole).toBe(UserRole.Admin);
  });

  it('setCompanyId updates companyId', () => {
    useAppStore.getState().setCompanyId('company-123');
    expect(useAppStore.getState().companyId).toBe('company-123');
  });

  it('user starts null', () => {
    expect(useAppStore.getState().user).toBeNull();
  });
});
