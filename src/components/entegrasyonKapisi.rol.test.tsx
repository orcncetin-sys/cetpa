/**
 * entegrasyonKapisi.rol.test.tsx — dış sistem / yapay zekâ uçlarını çağıran bileşenler kapıyı ORTAK TABLODAN sorar
 * (2026-10-17, iç rol daraltma — `.wf/SARTNAME-ic-rol-daraltma.md` § 2 İ3, § 3 «Bileşen», § 7 K3 / K5).
 *
 * Değişmez (İ3 — ölü düğme yok): rol ucun sunucudaki kapısından geçemiyorsa düğme / panel ÇİZİLMEZ ve istek HİÇ atılmaz;
 * geçen rolde düğme çizilir ve tıklama KENDİ ucuna gider. Her yüzey 12 rolün tamamıyla ortak tabloya karşı sınanır —
 * bileşende kopya rol listesi kalırsa ya da çizim koşulu kalkarsa kırılır.
 *
 * Yüzeyler: Satış Ajanı (Y2), Satın Alma Ajanı (Y3), SKU eşleştirme (S3), LUCA paneli (L4 / L5), Stok ekranı otomatik SAS (A1).
 * e-Belge Merkezi (L1 / L2) `EBelgeMerkezi.rol.test.tsx`'te, B2B Portalı (S1 / S2) `B2BPortal.test.tsx`'te.
 *
 * Bileşenler GERÇEKTEN çizilir; rol gerçek depodan, kapı gerçek ortak tablodan. Yalnız ağ (`authFetch`), veri katmanı
 * (`dbClient`) ve Mikro düğmesi sahte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { UserRole, type InventoryItem } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { entegrasyonUcKapisindanGecer, type EntegrasyonKapiliUc } from '../lib/entegrasyonUcKapilari';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';
import SatisAjaniPanel from './SatisAjaniPanel';
import SatinAlmaAjaniPanel from './SatinAlmaAjaniPanel';
import SkuMappingPanel from './SkuMappingPanel';
import LucaSyncPanel from './LucaSyncPanel';
import InventoryView from './InventoryView';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), setDoc: vi.fn(), serverTimestamp: () => 'TS',
  getDocs: vi.fn(() => Promise.resolve({ docs: [], empty: true, size: 0 })), incrementField: vi.fn(),
}));
vi.mock('./MikroPushButton', () => ({ default: () => null }));
vi.mock('../services/auditLog', () => ({ logAudit: vi.fn() }));

const TUM_ROLLER = Object.values(UserRole);
const json = (govde: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 403, json: () => Promise.resolve(govde) });
/** Belirli uca giden istekler. */
const istekler = (yol: string) => authFetch.mock.calls.filter(c => c[0] === yol);
const gecenler = (uc: EntegrasyonKapiliUc): UserRole[] => TUM_ROLLER.filter(r => entegrasyonUcKapisindanGecer(r, uc)).sort();
const sirali = (a: readonly UserRole[]): UserRole[] => [...a].sort();

beforeEach(() => {
  sifirla();
  authFetch.mockReset();
  authFetch.mockImplementation((url: string) => {
    if (url === '/api/ai/satis-ajani') return json({ success: true, bos: true, mesaj: 'Bu cari için Mikro satış hareketi bulunamadı.' });
    if (url === '/api/ai/satinalma-ajani') return json({ success: true, bos: true, mesaj: 'Kritik stok yok — öneri gerekmedi.' });
    if (url === '/api/sku-mapping/auto-match') return json({ success: true, matched: 3, unmatched: 1, shopifyVariants: 4 });
    if (url === '/api/luca/status') return json({ configured: false, connected: false });
    if (url === '/api/luca/sync/stok') return json({ success: true, total: 4, created: 1, updated: 2, yabanci: 1, duration: 12 });
    if (url === '/api/luca/sync/fatura') return json({ success: true, lucaFaturaNo: 'LF-1', duration: 9 });
    if (url === '/api/inventory/auto-reorder') return json({ success: true, created: 1, lowStockCount: 1, message: '1 taslak SAS oluşturuldu.' });
    return json({ success: false, error: `beklenmeyen istek ${url}` }, false);
  });
});
afterEach(cleanup);

it('rol listesi: enum ↔ rbac (eksik / fazla rol yok — 12 rol döngüleri gerçekten 12 rolü dolaşır)', () => {
  expect([...TUM_ROLLER].map(String).sort()).toEqual([...APP_ROLES].map(String).sort());
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Y2 — Satış Ajanı paneli (`POST /api/ai/satis-ajani` — `invoices` okuma)', () => {
  const ciz = (rol: UserRole) => {
    useAppStore.setState({ userRole: rol });
    return render(<SatisAjaniPanel currentLanguage="tr" aiOnayli musteriler={[{ ad: 'Şirin Yapı Ltd.', cariKod: '120.01.001' }]} />);
  };

  it.each([UserRole.Purchasing, UserRole.Logistics, UserRole.HR])('kilitli rol %s: panel ÇİZİLMEZ, istek atılmaz (K5: Satın Alma CRM\'de salt okunur)', rol => {
    const { container } = ciz(rol);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('AI Satış Ajanı')).toBeNull();
    expect(istekler('/api/ai/satis-ajani')).toEqual([]);
  });
  it('geçen rol (Satış): panel çizilir, müşteri seçilince istek KENDİ ucuna cari koduyla gider', async () => {
    ciz(UserRole.Sales);
    fireEvent.change(screen.getByPlaceholderText('Müşteri ara (Mikro carisi)…'), { target: { value: 'Şirin' } });
    fireEvent.click(screen.getByText('Şirin Yapı Ltd.'));
    await waitFor(() => expect(istekler('/api/ai/satis-ajani')).toHaveLength(1));
    expect(JSON.parse(String((istekler('/api/ai/satis-ajani')[0][1] as { body: string }).body))).toEqual({ cariKod: '120.01.001' });
  });
  it('12 rolün HEPSİ: panel ⇔ ortak tablo', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(screen.queryByText('AI Satış Ajanı') !== null, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/ai/satis-ajani'));
      unmount();
    }
    expect(gecenler('POST /api/ai/satis-ajani')).toEqual(sirali([UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Accounting]));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Y3 — Satın Alma Ajanı paneli (`POST /api/ai/satinalma-ajani` — `purchaseOrders` okuma)', () => {
  const ciz = (rol: UserRole) => {
    useAppStore.setState({ userRole: rol });
    return render(<SatinAlmaAjaniPanel currentLanguage="tr" aiOnayli />);
  };

  it.each([UserRole.Sales, UserRole.HR, UserRole.Quality])('kapıdan geçemeyen rol %s: panel ÇİZİLMEZ, istek atılmaz', rol => {
    const { container } = ciz(rol);
    expect(container.innerHTML).toBe('');
    expect(istekler('/api/ai/satinalma-ajani')).toEqual([]);
  });
  it('geçen rol (Satın Alma): «Öneri Üret» KENDİ ucuna gider', async () => {
    ciz(UserRole.Purchasing);
    fireEvent.click(screen.getByRole('button', { name: /Öneri Üret/ }));
    await waitFor(() => expect(istekler('/api/ai/satinalma-ajani')).toHaveLength(1));
  });
  it('12 rolün HEPSİ: panel ⇔ ortak tablo', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(screen.queryByText('AI Satın Alma Ajanı') !== null, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/ai/satinalma-ajani'));
      unmount();
    }
    expect(gecenler('POST /api/ai/satinalma-ajani')).toEqual(sirali([UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Accounting, UserRole.Purchasing]));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('S3 — SKU eşleştirme «Otomatik Eşleştir» (`POST /api/sku-mapping/auto-match` — `skuMappings` yazma)', () => {
  const ciz = (rol: UserRole) => {
    useAppStore.setState({ userRole: rol });
    koleksiyonAyarla('skuMappings', [{ id: 'DYO001', veri: { mikroSku: 'DYO-001', productName: 'DYO Boya 15 L', status: 'unmatched' } }]);
    return render(<SkuMappingPanel currentLanguage="tr" />);
  };

  it.each([UserRole.Purchasing, UserRole.Accounting])('kilitli rol %s: panel ve liste yerinde, düğme ÇİZİLMEZ, istek atılmaz', async rol => {
    ciz(rol);
    expect(screen.getByText('Stok Kodu Eşleştirme')).toBeTruthy();
    expect(await screen.findByText('DYO-001')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Otomatik Eşleştir/ })).toBeNull();
    expect(istekler('/api/sku-mapping/auto-match')).toEqual([]);
  });
  it.each([UserRole.Admin, UserRole.Logistics])('geçen rol %s: düğme KENDİ ucuna gider, sonuç gösterilir', async rol => {
    ciz(rol);
    fireEvent.click(screen.getByRole('button', { name: /Otomatik Eşleştir/ }));
    expect(await screen.findByText('✓ 3 eşleşti, 1 eşleşmedi (Shopify: 4 varyant)')).toBeTruthy();
    expect(istekler('/api/sku-mapping/auto-match')).toHaveLength(1);
  });
  it('12 rolün HEPSİ: düğme ⇔ ortak tablo', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(screen.queryByRole('button', { name: /Otomatik Eşleştir/ }) !== null, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/sku-mapping/auto-match'));
      unmount();
    }
    expect(gecenler('POST /api/sku-mapping/auto-match')).toEqual(sirali([UserRole.Admin, UserRole.Manager, UserRole.Sales, UserRole.Logistics]));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('L4 / L5 — LUCA paneli: fatura gönder (`invoices` yazma) ve stok çek (`inventory` yazma) kartları', () => {
  const ciz = (rol: UserRole) => {
    useAppStore.setState({ userRole: rol });
    return render(<LucaSyncPanel currentLanguage="tr" />);
  };
  const FATURA = 'Fatura Gönder (Luca)';
  const STOK = 'Stok Çek (Luca → Firebase)';

  it('Satış (iki kapıdan da geçemez): iki kart da ÇİZİLMEZ; yalnız durum ucu (kapısı değişmedi) sorulur', async () => {
    ciz(UserRole.Sales);
    await waitFor(() => expect(istekler('/api/luca/status')).toHaveLength(1));
    expect(screen.queryByText(FATURA)).toBeNull();
    expect(screen.queryByText(STOK)).toBeNull();
    expect(authFetch.mock.calls.map(c => c[0]).filter(u => u !== '/api/luca/status')).toEqual([]);
  });
  it('Müdür (iki kapıdan da geçer — Ayarlar sekmesi): stok kartı KENDİ ucuna gider; sonuç gerçek alanlardan, atlanan yabancı kart sayısıyla', async () => {
    ciz(UserRole.Manager);
    expect(screen.getByText(FATURA)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByText(/✓ 1 yeni, 2 güncellendi, 1 kart başka firmaya ait olduğu için atlandı/)).toBeTruthy();
    expect(istekler('/api/luca/sync/stok')).toHaveLength(1);
  });
  it('stok sonucu: yanıtta sayı alanı yoksa «0» UYDURULMAZ — «—» yazılır; atlanan kart yoksa atlama cümlesi de yok', async () => {
    // Eskiden var olmayan `upserted` alanı `?? 0` ile okunup her seferinde «0 ürün güncellendi» yazılıyordu.
    authFetch.mockImplementation((url: string) => (url === '/api/luca/sync/stok'
      ? json({ success: true, total: 4, duration: 7 })
      : json({ configured: false, connected: false })));
    ciz(UserRole.Manager);
    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(await screen.findByText('✓ — yeni, — güncellendi (7ms)')).toBeTruthy();
    expect(screen.queryByText(/başka firmaya ait/)).toBeNull();
  });
  it('12 rolün HEPSİ: fatura kartı ⇔ `POST /api/luca/sync/fatura`, stok kartı ⇔ `POST /api/luca/sync/stok`', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(screen.queryByText(FATURA) !== null, `fatura × ${rol}`).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/luca/sync/fatura'));
      expect(screen.queryByText(STOK) !== null, `stok × ${rol}`).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/luca/sync/stok'));
      unmount();
    }
    // Panel Ayarlar sekmesinde (Yönetici + Müdür): ikisi de iki kapıdan geçer — arayüzde kilit yok (K5).
    for (const rol of [UserRole.Admin, UserRole.Manager]) {
      expect(entegrasyonUcKapisindanGecer(rol, 'POST /api/luca/sync/fatura')).toBe(true);
      expect(entegrasyonUcKapisindanGecer(rol, 'POST /api/luca/sync/stok')).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('A1 — Stok ekranı «Otomatik SAS» (`POST /api/inventory/auto-reorder` — `purchaseOrders` yazma)', () => {
  const KRITIK = { id: 'mikro-DYO-001', name: 'DYO Boya 15 L', sku: 'DYO-001', category: 'Boya', stockLevel: 0, lowStockThreshold: 5, price: 100 } as unknown as InventoryItem;
  const ciz = (rol: UserRole) => {
    useAppStore.setState({ userRole: rol });
    return render(
      <InventoryView inventory={[KRITIK]} categories={['Boya']} selectedCategory="all" setSelectedCategory={() => {}} currentT={{}} currentLanguage="tr"
        inventoryMovements={[]} warehouses={[]} />,
    );
  };
  const dugmeler = () => screen.queryAllByRole('button', { name: /Otomatik SAS/ });

  it.each([UserRole.Logistics, UserRole.Accounting, UserRole.Sales])('kilitli rol %s (Stok sekmesini görür): iki düğme de ÇİZİLMEZ, istek atılmaz', rol => {
    ciz(rol);
    expect(screen.getAllByText('DYO Boya 15 L').length).toBeGreaterThan(0);   // ekran ve kritik stok uyarısı çizildi
    expect(dugmeler()).toEqual([]);
    expect(istekler('/api/inventory/auto-reorder')).toEqual([]);
  });
  it('geçen rol (Satın Alma): başlık ve kritik stok uyarısındaki iki düğme çizilir; tıklama KENDİ ucuna gider', async () => {
    ciz(UserRole.Purchasing);
    expect(dugmeler()).toHaveLength(2);
    fireEvent.click(dugmeler()[0]);
    await waitFor(() => expect(istekler('/api/inventory/auto-reorder')).toHaveLength(1));
  });
  it('12 rolün HEPSİ: düğmeler ⇔ ortak tablo', () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = ciz(rol);
      expect(dugmeler().length, rol).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/inventory/auto-reorder') ? 2 : 0);
      unmount();
    }
    expect(gecenler('POST /api/inventory/auto-reorder')).toEqual(sirali([UserRole.Admin, UserRole.Manager, UserRole.Purchasing]));
  });
});
