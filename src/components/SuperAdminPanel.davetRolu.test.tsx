// @vitest-environment jsdom
/**
 * SuperAdminPanel.davetRolu.test.tsx — süper yönetici kiracı çekmecesinin «Davet rolü» seçicisi dış rol (B2B / Bayi) TAŞIMAZ.
 *
 * NEDEN: `POST /api/superadmin/tenants/:companyId/invite` dış rol davetini 400 `DIS_ROL_DAVETLE_ACILMAZ` ile reddeder (şartname
 * «müşteri siparişlerim» H7): seçicide kalan B2B / Bayi seçeneği yalnız ret üreten ölü seçenek olurdu (kullanıcı kararı «ölü düğme
 * yok»). Satır içi rol seçicisi ve `USER_ROLES` dizisi DEĞİŞMEDİ (dış rol orada kalır — süper yönetici rol ucu ayrı not).
 *
 * GERÇEK `SuperAdminPanel` çizilir; sahte olan yalnız sunucu (`authedFetch`) ve çekmeceyle ilgisiz üç kart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EXTERNAL_ROLES } from '../lib/rbac';

const authedFetch = vi.hoisted(() => vi.fn());
vi.mock('../lib/dbClient', () => ({ authedFetch }));
vi.mock('./OpsWatchdogCard', () => ({ default: () => null }));
vi.mock('./TrafikKarti', () => ({ default: () => null }));
vi.mock('./ModuleStatusBoard', () => ({ default: () => null }));

import SuperAdminPanel from './SuperAdminPanel';

afterEach(() => { cleanup(); authedFetch.mockReset(); });

const json = (govde: unknown): Response => new Response(JSON.stringify(govde), { status: 200, headers: { 'content-type': 'application/json' } });

const KIRACI = {
  companyId: 'CETPA', companyName: 'Çetpa Yapı', ownerEmail: 'sahip@example.test', userCount: 2, plan: 'starter', subStatus: 'active',
  status: 'active', cycle: 'monthly', amount: 999, nextPaymentDate: null, lastPaymentDate: null, createdAt: null,
};
const DETAY = {
  companyId: 'CETPA',
  profile: { companyName: 'Çetpa Yapı', taxNo: '', taxOffice: '', address: '', email: 'sahip@example.test', phone: '', iban: '', website: '' },
  owner: null,
  users: [
    { uid: 'u-satis', email: 'satis@example.test', name: 'Satış Kişisi', role: 'Sales', lastLogin: null, createdAt: null },
    { uid: 'u-bayi', email: 'bayi@example.test', name: 'Bayi Kişisi', role: 'Dealer', lastLogin: null, createdAt: null },
  ],
  billing: { plan: 'starter', cycle: 'monthly' },
  status: 'active', note: '', invoices: [],
};

async function cekmeceyiAc(): Promise<void> {
  authedFetch.mockImplementation(async (url: string) => {
    if (url === '/api/superadmin/tenants') return json({ tenants: [KIRACI] });
    if (url === '/api/superadmin/tenants/CETPA') return json(DETAY);
    throw new Error(`beklenmeyen istek: ${url}`);
  });
  render(<SuperAdminPanel currentLanguage="tr" toast={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Detay' }));
  await screen.findByRole('combobox', { name: 'Davet rolü' });
}

const secenekler = (el: HTMLElement): string[] => Array.from((el as HTMLSelectElement).options).map(o => o.value);

describe('SuperAdminPanel — «Davet rolü» seçicisi', () => {
  it('dış rol (B2B / Bayi) seçeneği YOK; iç roller ve varsayılan «Satış» duruyor', async () => {
    await cekmeceyiAc();
    const davet = screen.getByRole('combobox', { name: 'Davet rolü' }) as HTMLSelectElement;
    const roller = secenekler(davet);
    expect(EXTERNAL_ROLES.length).toBeGreaterThan(0);
    for (const dis of EXTERNAL_ROLES) expect(roller, dis).not.toContain(dis);
    expect(roller).toEqual(['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'Legal', 'Corporate', 'Quality']);
    expect(davet.value).toBe('Sales');
  });

  it('satır içi rol seçicisi DEĞİŞMEDİ: dış rol seçenekleri orada kalır (yalnız davet seçicisi süzülür)', async () => {
    await cekmeceyiAc();
    const satirlar = screen.getAllByRole('combobox', { name: 'Rol' });
    expect(satirlar).toHaveLength(DETAY.users.length);
    for (const s of satirlar) for (const dis of EXTERNAL_ROLES) expect(secenekler(s)).toContain(dis);
  });
});
