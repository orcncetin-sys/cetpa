import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMikroStatus, syncInventoryItemToMikro, syncLeadToMikro } from './mikroService';

// Mock firebase auth
vi.mock('../firebase', () => ({
  auth: {
    currentUser: { getIdToken: vi.fn().mockResolvedValue('test-token') },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getMikroStatus', () => {
  it('returns status when API responds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ configured: true, connected: true, message: 'ok' }),
    });
    const result = await getMikroStatus();
    expect(result.configured).toBe(true);
    expect(result.connected).toBe(true);
  });

  it('returns not configured when API returns 503', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ configured: false, connected: false }),
    });
    const result = await getMikroStatus();
    expect(result.configured).toBe(false);
  });

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await getMikroStatus();
    expect(result.configured).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('syncInventoryItemToMikro', () => {
  const mockItem = {
    id: 'item-1',
    name: 'Test Ürün',
    sku: 'SKU-001',
    stockLevel: 10,
    prices: { Retail: 100, 'B2B Standard': 90, 'B2B Premium': 80, Dealer: 70 },
    category: 'Elektronik',
    unit: 'Adet',
  };

  it('sends correct payload and returns success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, mikroStoKod: 'STK-001', duration: 150 }),
    });
    const result = await syncInventoryItemToMikro(mockItem as never, 'item-1');
    expect(result.success).toBe(true);
    expect(result.mikroStoKod).toBe('STK-001');

    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('/api/mikro/stok/kaydet');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body.item.sku).toBe('SKU-001');
  });

  it('returns notConfigured when Mikro not set up', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ success: false, notConfigured: true }),
    });
    const result = await syncInventoryItemToMikro(mockItem as never, 'item-1');
    expect(result.success).toBe(false);
    expect(result.notConfigured).toBe(true);
  });
});

describe('syncLeadToMikro', () => {
  const mockLead = {
    id: 'lead-1',
    name: 'Test Firma',
    taxId: '1234567890',
    taxOffice: 'Kadıköy',
    email: 'test@firma.com',
    phone: '05001234567',
    address: 'İstanbul',
    eFaturaKayitli: true,
    creditLimit: 50000,
    paymentTerms: 30,
  };

  it('sends lead data and returns cariKod', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, cariKod: 'CARI-001', duration: 200 }),
    });
    const result = await syncLeadToMikro(mockLead as never, 'lead-1');
    expect(result.success).toBe(true);
    expect(result.cariKod).toBe('CARI-001');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.lead.name).toBe('Test Firma');
  });

  it('handles API error with message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false, error: 'Cari zaten mevcut' }),
    });
    const result = await syncLeadToMikro(mockLead as never, 'lead-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cari zaten mevcut');
  });
});
