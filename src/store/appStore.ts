/**
 * appStore.ts — Global Zustand store
 *
 * Holds the three most widely-shared pieces of state that were previously
 * prop-drilled through App.tsx into every component:
 *   1. language      — 'tr' | 'en'
 *   2. exchangeRates — fetched once, read by currency formatters everywhere
 *   3. auth          — current Firebase user + resolved role
 *
 * App.tsx still owns the state lifecycle (auth subscriptions, rate fetching)
 * but writes here on change so any component can read without prop drilling.
 *
 * Usage:
 *   const { language, exchangeRates } = useAppStore();
 *   const { setLanguage } = useAppStore();
 */

import { create } from 'zustand';
import type { User } from 'firebase/auth';
import { UserRole } from '../types';
import type { Language } from '../translations';

interface AppState {
  // ── Language ────────────────────────────────────────────────────────────────
  language: Language;
  setLanguage: (lang: Language) => void;

  // ── Exchange Rates ──────────────────────────────────────────────────────────
  exchangeRates: Record<string, number> | null;
  setExchangeRates: (rates: Record<string, number>) => void;

  // ── Auth ────────────────────────────────────────────────────────────────────
  user: User | null;
  userRole: UserRole;
  companyId: string | null;
  setUser: (user: User | null) => void;
  setUserRole: (role: UserRole) => void;
  setCompanyId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Language
  language: (typeof localStorage !== 'undefined' && (localStorage.getItem('cetpa-lang') as Language)) || 'tr',
  setLanguage: (language) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('cetpa-lang', language);
    set({ language });
  },

  // Exchange rates — null until first fetch completes
  exchangeRates: null,
  setExchangeRates: (exchangeRates) => set({ exchangeRates }),

  // Auth — null until Firebase auth resolves
  user: null,
  userRole: UserRole.Sales,
  companyId: null,
  setUser: (user) => set({ user }),
  setUserRole: (userRole) => set({ userRole }),
  setCompanyId: (companyId) => set({ companyId }),
}));
