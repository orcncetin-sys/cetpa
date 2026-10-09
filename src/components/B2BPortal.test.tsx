/**
 * B2BPortal.test.tsx — Shopify senkron kartı yalnız İÇ rolde çizilir (2026-10-07, satır süzgeci inceleme bulgusu).
 *
 * `POST /api/shopify/sync` personel kapılı (requireStaff — çiti `server/satirSuzgeci.degismez.test.ts`). Kart dış rolde
 * çizilirse her tıklama 403 → kırmızı hata iletisi. Tek kapı bileşendeki `icRol` koşulu ve hiçbir testi yoktu: koşul
 * kalksa `tsc` de `vitest` de susuyordu. Bileşen GERÇEKTEN çizilir (varsayılan alt sekme: Teklifler — kart orada).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import type { User } from 'firebase/auth';
import B2BPortal from './B2BPortal';
import { UserRole } from '../types';
import { STAFF_ROLES } from '../lib/rbac';

vi.mock('../lib/dbClient', () => ({
  collection: vi.fn(() => ({})), doc: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('../services/shopifyService', () => ({ syncShopify: vi.fn() }));
vi.mock('../utils/pdf', () => ({ exportOrderPDF: vi.fn() }));

const KULLANICI = { uid: 'u1', email: 'bayi@example.com' } as User;
const DIS_ROLLER = [UserRole.B2B, UserRole.Dealer];
const IC_ROLLER = Object.values(UserRole).filter(r => !DIS_ROLLER.includes(r));
const ciz = (rol: UserRole) => render(
  <B2BPortal user={KULLANICI} userRole={rol} leads={[]} inventory={[]} orders={[]} currentT={{}} currentLanguage="tr" exchangeRates={null} />,
);

afterEach(cleanup);

describe('B2BPortal — Shopify senkron kartı yalnız iç rolde', () => {
  it.each(DIS_ROLLER)('dış rol %s: kart ÇİZİLMEZ (sunucu ucu personel kapılı — düğme her tıklamada 403 verirdi)', rol => {
    ciz(rol);
    expect(screen.getByText('Teklifler')).toBeInTheDocument();        // portal ve Teklifler sekmesi çizildi (boş çizim yanlış yeşil vermesin)
    expect(screen.queryByText('Shopify Senkronize Et')).toBeNull();
    expect(screen.queryByText('Shopify Entegrasyonu')).toBeNull();
  });
  it.each(IC_ROLLER)('iç rol %s: kart çizilir', rol => {
    ciz(rol);
    expect(screen.getByRole('button', { name: 'Shopify Senkronize Et' })).toBeEnabled();
    expect(screen.getByText('Shopify Entegrasyonu')).toBeInTheDocument();
  });
  it('iç rol kümesi sunucudaki `requireStaff` ile AYNI listeden (lib/rbac STAFF_ROLES) — bileşende kopya rol listesi yok', () => {
    expect([...IC_ROLLER].map(String).sort()).toEqual([...STAFF_ROLES].sort());
    const kaynak = readFileSync(join(__dirname, 'B2BPortal.tsx'), 'utf8');
    expect(kaynak.split('const icRol = (STAFF_ROLES as readonly string[]).includes(userRole);').length - 1).toBe(1);
  });
});
