/**
 * RaporlarPage.mfKaynaksiz.test.tsx — Raporlar listesinde işaretli kaynaksız MF ile aynı numaralı Mikro satış satırı (Y29 son inceleme
 * bulgu 2, 06.11.2026; şartname «Mikro bağlantı B» BH8 / BH13).
 *
 *   • İşaretli MF listeden düşer (BH13 kapısı). Anahtarı `cetpaEvrak` kümesine GİRMEZ: işaret kalkmadan («Faturalar» tek başına
 *     çekildi, `mfIptalEsle` henüz koşmadı) aynı numaralı Mikro satış satırı görünürse o satır sentetik olarak BİR kez sayılır.
 *     Eskiden ikisi birden düşüyordu (satış sıfır kez); Satışlar «Tümü» aynı satışı bir kez sayıyordu.
 *   • İkizsiz işaretli MF: Mikro satırı yok, sentetik doğmaz (eskisiyle aynı).
 *   • İşaretsiz MF: anahtarı kümede kalır, aynı numaralı Mikro satırı sentetik olarak EKLENMEZ (çift sayım yok).
 *
 * Mutasyon (yapılıp geri alındı, raporda): `cetpaEvrak` döngüsündeki `&& !mfKaynaksizMi(o)` silinir → ilk test kırmızı (0 satır).
 * `ReportsDashboard` boş çizilir, listeyi yakalar; Mikro fatura kancası sabit liste döndürür (canlıya / Firebase'e istek yok).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import type { Order } from '../types';
import type { MikroFatura } from '../hooks/useMikroFaturalar';
import { MF_KAYNAGI } from '../lib/mfKaynagi';

const yakalanan: { orders: Order[] | null } = { orders: null };
let faturalar: MikroFatura[] = [];

vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: { currentUser: { uid: 'u-1', getIdToken: async () => 'belirtec' }, onAuthStateChanged: () => () => {} },
}));
vi.mock('../hooks/useMikroFaturalar', async (asil) => {
  const a = await asil<typeof import('../hooks/useMikroFaturalar')>();
  return { ...a, useMikroFaturalar: () => faturalar, useCariAdMap: () => new Map<string, string>() };
});
vi.mock('../components/ReportsDashboard', () => ({
  default: (p: { orders: Order[] }) => { yakalanan.orders = p.orders; return null; },
}));
vi.mock('../components/DemandForecastPanel', () => ({ default: () => null }));
vi.mock('../components/AnalyticsPanel', () => ({ default: () => null }));

import RaporlarPage from './RaporlarPage';

const YIL = String(new Date().getFullYear());
const TARIH = `${YIL}-03-10`;
const mf = (sira: number, ek: Record<string, unknown> = {}): Order => ({
  id: `mikrofat__A__-${sira}`, source: MF_KAYNAGI, mikroEvrak: { seri: '', sira: String(sira) }, mikroFaturaNo: String(sira),
  status: 'Delivered', totalPrice: 1200, createdAt: `${TARIH}T12:00:00.000Z`, customerName: 'MF Müşteri', lineItems: [], ...ek,
}) as unknown as Order;
const ISARETLI = mf(325, { mfKaynaksiz: true, mfKaynaksizGoruldu: '2026-11-06T00:20:00.000Z' });
const ISARETSIZ = mf(400);
const mikroSatir = (faturaNo: string): MikroFatura => ({
  id: `giden-${faturaNo}`, cariKod: '120.01.001', tarih: TARIH, tutar: 1200, faturaNo, seri: '', faturasiz: false,
  kdv: 200, matrah: 1000, oran: 20, oranKarma: false, yon: 'giden',
}) as unknown as MikroFatura;

async function ac(orders: Order[], mikro: MikroFatura[]): Promise<Order[]> {
  faturalar = mikro;
  yakalanan.orders = null;
  const bos = () => {};
  render(
    <RaporlarPage
      canAccess={() => true} hasFullAccess={() => true} currentLanguage="tr" currentT={{}}
      orders={orders} leads={[]} inventory={[]} exchangeRates={null} userRole="Admin" employees={[]}
      appQuotations={[]} inventoryMovements={[]} recurringOrders={[]} appReportsTab="ik" setAppReportsTab={bos}
      onNavigate={bos} onMusteriAc={bos} p570Targets={{ revenue: null, orders: null, avgOrderVal: null, leadConv: null }}
      setP570Targets={bos} fmtKpi={v => String(v)}
    />,
  );
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
  if (!yakalanan.orders) throw new Error('rapor listesi yakalanmadı');
  return yakalanan.orders;
}
/** Listede 325 numarasını taşıyan satırlar: MF siparişi ya da Mikro satırının sentetik kopyası. */
const numarali = (l: Order[], no: string) => l.filter(o => o.id === `mikrofat__A__-${no}` || o.id === `mikro-giden-${no}`).map(o => o.id);

afterEach(() => { cleanup(); faturalar = []; });

describe('RaporlarPage — işaretli MF ile aynı numaralı Mikro satış satırı (Y29 bulgu 2)', () => {
  it('işaretli + ikizli: Mikro satırı sentetik olarak TAM BİR kez sayılır; MF düşer', async () => {
    const l = await ac([ISARETLI], [mikroSatir('325')]);
    expect(numarali(l, '325')).toEqual(['mikro-giden-325']);
  });

  it('işaretli + ikizsiz: listede 325 yok (eskisiyle aynı)', async () => {
    const l = await ac([ISARETLI], []);
    expect(numarali(l, '325')).toEqual([]);
  });

  it('işaretsiz MF + aynı numaralı Mikro satırı: yalnız MF siparişi (sentetik kopya eklenmez)', async () => {
    const l = await ac([ISARETSIZ], [mikroSatir('400')]);
    expect(numarali(l, '400')).toEqual(['mikrofat__A__-400']);
  });
});

// Y29b delta (06.11.2026): not yalnız GERÇEKTEN dışarıda kalanı sayar. İkizli işaretli MF'nin satışı sentetik satırla bir kez sayıldığı
// için «dâhil değil» notuna girmez. Mutasyon: not satırı `mfKaynaksizSay(ordersProp)` hâline döndürülür → ilk test kırmızı.
describe('RaporlarPage — kaynaksız notu (Y29b delta)', () => {
  const not = () => document.querySelector('[data-mf-kaynaksiz-notu="raporlar"]')?.textContent ?? null;
  it('işaretli + ikizli: not YOK (satış sentetik satırla sayıldı)', async () => {
    await ac([ISARETLI], [mikroSatir('325')]);
    expect(not()).toBeNull();
  });
  it('işaretli + ikizsiz: not 1 kaydı ve tutarını basar', async () => {
    await ac([ISARETLI], []);
    expect(not()).toContain('1 kayıt');
    expect(not()).toContain('1.200');
  });
});

