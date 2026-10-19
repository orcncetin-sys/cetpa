/**
 * OrdersPage.takipBaglantisi.test.tsx — Siparişler ayrıntısındaki iki takip bağlantısı üreticisi, sayfa GERÇEKTEN çizilerek
 * (2026-10-19, şartname `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` T4 / TE).
 *
 * Sınanan: «Takip Linki» ve «Özet Kopyala» bağlantıyı doküman kimliğinden DEĞİL takip kodundan kurar (kod sunucudan —
 * `POST /api/siparis/:orderId/takip-kodu`); pano yazımı tıklamanın İÇİNDE, hiçbir `await`'ten önce başlar (`ClipboardItem` +
 * söz); kod alınırken düğme pasif; kod hatası ile pano izni ayrı ileti; mağaza siparişinde kod İSTENMEZ; tutarı bilinmeyen
 * siparişte istek atılmaz. Pano yardımcısının iki yolu ayrıca `lib/takipBaglantisi.test.ts`'te; sunucu ucu
 * `server/takipKoduVeLuca.zincir.test.ts`'te. Yalnız ağ (`authFetch`), veri katmanı ve pano sahte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { join } from 'node:path';
import OrdersPage from './OrdersPage';
import { translations } from '../translations';
import { useAppStore } from '../store/appStore';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi';
import { SRC_KOK, kodSatirlari } from '../test/kaynakTarama';
import type { Order } from '../types';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../lib/dbClient', async (asil) => ({
  ...(await asil<typeof import('../lib/dbClient')>()),
  onSnapshot: () => () => {},
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

type Props = ComponentProps<typeof OrdersPage>;
const bos = () => {};
const sozBos = () => Promise.resolve();
const KOD = 'Qw12Er34Ty56Ui78Op90As';
const ID = 'mikrofat__CETPA__CTP-77';

const siparis = (ek: Partial<Order> = {}): Order =>
  ({ id: ID, customerName: 'Şirin Yapı', totalPrice: 1200, status: 'Processing', customerType: 'B2B', orderNumber: 'MF-CTP77', lineItems: [], faturali: true, kdvOran: 20, ...ek });

function ciz(secili: Order, oteki: Order[] = []) {
  const toast = vi.fn();
  const ozellikler = (sec: Order): Props => ({
    selectedOrder: sec, setSelectedOrder: vi.fn(), lojistikTab: 'sevkiyat', setLojistikTab: bos,
    routeStops: [], isRouteOptimized: false, selectedDepot: 'eski_sanayi', setSelectedDepot: bos,
    DEPOTS: { eski_sanayi: { name: 'Eski Sanayi', lat: 36.9, lng: 30.7 }, havalimani: { name: 'Havalimanı', lat: 36.9, lng: 30.8 } },
    recurringOrders: [], hasFullAccess: () => true, siparisDetayiAcilabilir: true,
    currentLanguage: 'tr', currentT: translations.tr,
    orders: [secili, ...oteki], leads: [], inventory: [], exchangeRates: null, employees: [],
    userRole: 'Admin', user: { uid: 'uid-7', email: 'yonetici@ornek.com.tr', displayName: 'Yönetici' },
    kpiCurrency: 'TRY', setKpiCurrency: bos, activeTab: 'orders', darkMode: false,
    warehouses: [], vehicles: [], aracKonumlari: [], konumYazabilir: false, irsaliyeKesebilir: false, kullaniciUid: 'uid-7',
    locationStocks: [], shipments: [], setSiparisTohumu: vi.fn(),
    handleMikroFatura: sozBos, handleMikroFaturaSonuc: sozBos, handleMikroFaturaEttnEkle: sozBos, mikroFaturaGonderiliyor: {},
    mikroFaturaKesebilir: false, mikroFaturaSonucuCozebilir: false,
    handleEIrsaliye: sozBos, eIrsaliyeGonderiliyor: {}, handleIyzicoPaymentLink: sozBos,
    setRouteStops: bos, p554Bins: [], handleBuildRoute: bos, handleClearRoute: bos, handleToggleOrderPaid: bos,
    trackView: bos, openConfirm: bos, toast, setActiveTab: bos, setSelectedLead: bos, setIsAddingOrder: bos,
    logAuditAction: sozBos,
  });
  const sonuc = render(<OrdersPage {...ozellikler(secili)} />);
  /** Ayrıntıda başka siparişe geçiş (üst bileşen `selectedOrder`'ı değiştirir; sayfa yeniden kurulmaz — durum korunur). */
  const gec = (sec: Order) => sonuc.rerender(<OrdersPage {...ozellikler(sec)} />);
  return { ...sonuc, toast, gec };
}

// ── Pano sahtesi: `ClipboardItem` (söz değerli) + `write` / `writeText` ─────────────────────────────────────────────────────
class SahteClipboardItem {
  constructor(public readonly ogeler: Record<string, Blob | Promise<Blob>>) {}
}
let panoMetinleri: string[] = [];
let panoRet = false;
const write = vi.fn((ogeler: SahteClipboardItem[]) =>
  Promise.resolve(ogeler[0].ogeler['text/plain']).then(b => b.text()).then(m => {
    if (panoRet) throw new DOMException('Belge odakta değil', 'NotAllowedError');
    panoMetinleri.push(m);
  }));
const writeText = vi.fn((m: string) => { panoMetinleri.push(m); return Promise.resolve(); });

const kodYaniti = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, takipKodu: KOD }) });
/** Çözülmesi testin elinde olan yanıt (bekleme durumunu görmek için). */
let birak: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  vi.stubGlobal('ClipboardItem', SahteClipboardItem);
  Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
  panoMetinleri = []; panoRet = false; birak = null;
  write.mockClear(); writeText.mockClear();
  authFetch.mockReset();
  authFetch.mockImplementation(() => kodYaniti());
  localStorage.clear();
  window.history.replaceState(null, '', '/orders');
  useAppStore.setState({ companyId: 'kiraci-1' });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

const takipDugmesi = () => screen.getByRole('button', { name: /Takip Linki|Bağlantı alınıyor/ });
const ozetDugmesi = () => screen.getByRole('button', { name: /Özet Kopyala|Özet hazırlanıyor/ });
const kodIstekleri = () => authFetch.mock.calls.filter(c => /^\/api\/siparis\/.+\/takip-kodu$/.test(String(c[0])));

describe('«Takip Linki» — bağlantı takip kodunu taşır', { timeout: 30_000 }, () => {
  it('kod sunucudan alınır (POST, kimlik kodlanmış); pano yazımı tıklamanın İÇİNDE başlar; panoya `?track=<kod>`; başarı iletisi', async () => {
    const { toast } = ciz(siparis());
    fireEvent.click(takipDugmesi());
    // Eşzamanlı: hiçbir `await`'ten önce pano yazımı başlamış olmalı (Safari izni tıklamanın içinde).
    expect(write).toHaveBeenCalledTimes(1);
    expect(kodIstekleri().map(c => [c[0], (c[1] as RequestInit).method])).toEqual([[`/api/siparis/${encodeURIComponent(ID)}/takip-kodu`, 'POST']]);
    await act(async () => {});
    expect(panoMetinleri).toEqual([`${window.location.origin}/?track=${KOD}`]);
    expect(panoMetinleri[0]).not.toContain(ID);
    // İleti hangi siparişin bağlantısının kopyalandığını söyler (görünen numara — 2026-10-20).
    expect(toast).toHaveBeenLastCalledWith('MF-CTP77 — Takip linki kopyalandı ✓', 'success');
  });

  it('kod alınırken düğme pasif ve «Bağlantı alınıyor…»; yanıt gelince eski hâline döner', async () => {
    authFetch.mockImplementation(() => new Promise(coz => { birak = () => coz({ ok: true, status: 200, json: () => Promise.resolve({ success: true, takipKodu: KOD }) }); }));
    ciz(siparis());
    fireEvent.click(takipDugmesi());
    await act(async () => {});
    expect(takipDugmesi().textContent).toContain('Bağlantı alınıyor…');
    expect((takipDugmesi() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { birak?.(); });
    expect((takipDugmesi() as HTMLButtonElement).disabled).toBe(false);
    expect(takipDugmesi().textContent).toContain('Takip Linki');
  });

  it('kod alınamazsa (sunucu 404) Türkçe kod iletisi — pano iletisi DEĞİL; panoya hiçbir şey yazılmaz', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ success: false, error: 'Sipariş bulunamadı.' }) }));
    const { toast } = ciz(siparis());
    fireEvent.click(takipDugmesi());
    await act(async () => {});
    expect(panoMetinleri).toEqual([]);
    expect(toast).toHaveBeenLastCalledWith('Takip bağlantısı alınamadı: Sipariş bulunamadı.', 'error');
  });

  it('pano reddederse pano iletisi (kod iletisi değil)', async () => {
    panoRet = true;
    const { toast } = ciz(siparis());
    fireEvent.click(takipDugmesi());
    await act(async () => {});
    expect(toast).toHaveBeenLastCalledWith('Kopyalanamadı — tarayıcı pano iznini engelledi.', 'error');
  });

  it('mağaza siparişinde düğme ÇİZİLMEZ (takip ucu ona 404 döner)', () => {
    ciz(siparis({ source: MAGAZA_KAYNAGI }));
    expect(screen.queryByRole('button', { name: /Takip Linki/ })).toBeNull();
  });
});

describe('«Özet Kopyala» — takip satırı kodla; ön denetimler istekten önce', { timeout: 30_000 }, () => {
  it('özetin takip satırı `?track=<kod>`; doküman kimliği metinde YOK; pano yazımı tıklamanın içinde başlar', async () => {
    const { toast } = ciz(siparis());
    fireEvent.click(ozetDugmesi());
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(kodIstekleri()).toHaveLength(1);
    expect(panoMetinleri).toHaveLength(1);
    expect(panoMetinleri[0]).toContain(`\nTakip Linki: ${window.location.origin}/?track=${KOD}`);
    expect(panoMetinleri[0]).toContain('Sipariş No: MF-CTP77');
    expect(panoMetinleri[0]).not.toContain(ID);
    expect(toast).toHaveBeenLastCalledWith('MF-CTP77 — Sipariş özeti kopyalandı ✓', 'success');
  });

  it('mağaza siparişi: kod İSTENMEZ, özet takip satırsız kopyalanır', async () => {
    const { toast } = ciz(siparis({ source: MAGAZA_KAYNAGI, orderNumber: '#1042' }));
    fireEvent.click(ozetDugmesi());
    await act(async () => {});
    expect(kodIstekleri()).toEqual([]);
    expect(panoMetinleri).toHaveLength(1);
    expect(panoMetinleri[0]).not.toContain('Takip Linki');
    expect(panoMetinleri[0]).not.toContain('?track=');
    expect(toast).toHaveBeenLastCalledWith('#1042 — Sipariş özeti kopyalandı ✓', 'success');
  });

  it('tutar bilinmiyorsa bugünkü ileti; kod İSTENMEZ, pano yazılmaz', async () => {
    const { toast } = ciz(siparis({ totalPrice: undefined }));
    fireEvent.click(ozetDugmesi());
    await act(async () => {});
    expect(kodIstekleri()).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Tutar ya da kur bilinmiyor — özet kopyalanmadı.', 'error');
  });

  it('kod alınamazsa özet KOPYALANMAZ (bağlantısız eksik metin gitmez); kod iletisi', async () => {
    authFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Bu veri için yetkiniz yok.' }) }));
    const { toast } = ciz(siparis());
    fireEvent.click(ozetDugmesi());
    await act(async () => {});
    expect(panoMetinleri).toEqual([]);
    expect(toast).toHaveBeenLastCalledWith('Takip bağlantısı alınamadı: Bu veri için yetkiniz yok.', 'error');
  });
});

describe('bekleme durumu siparişe bağlı — sayfada tek istek (2026-10-20)', { timeout: 30_000 }, () => {
  const ID_B = 'BaskaSiparis00000002';
  const B = (): Order => siparis({ id: ID_B, orderNumber: 'S-2002', customerName: 'Öztürk İnşaat' });
  /** İLK takip kodu isteği bekletilir (çözülmesi testin elinde); sonrakiler ve sayfanın öteki istekleri hemen yanıtlanır. */
  const ilkIstegiBeklet = () => {
    let bekletildi = false;
    authFetch.mockImplementation((url: unknown) => {
      if (bekletildi || !/\/takip-kodu$/.test(String(url))) return kodYaniti();
      bekletildi = true;
      return new Promise(coz => { birak = () => coz({ ok: true, status: 200, json: () => Promise.resolve({ success: true, takipKodu: KOD }) }); });
    });
  };
  const pasif = (d: HTMLElement) => (d as HTMLButtonElement).disabled;

  it('A\'da takip beklerken B\'ye geçilince B\'de bekleme yazısı / `aria-busy` YOK; iki düğme pasif (tek istek); bitince B\'de ikisi açık', async () => {
    ilkIstegiBeklet();
    const { gec } = ciz(siparis(), [B()]);
    fireEvent.click(takipDugmesi());
    await act(async () => {});
    expect(takipDugmesi().textContent).toContain('Bağlantı alınıyor…');
    expect(takipDugmesi().getAttribute('aria-busy')).toBe('true');
    gec(B());
    expect(screen.getByText('S-2002', { exact: false })).toBeTruthy();
    expect(takipDugmesi().textContent).not.toContain('Bağlantı alınıyor…');
    expect(takipDugmesi().textContent).toContain('Takip Linki');
    expect(takipDugmesi().getAttribute('aria-busy')).toBe('false');
    expect(ozetDugmesi().textContent).not.toContain('Özet hazırlanıyor…');
    expect(ozetDugmesi().getAttribute('aria-busy')).toBe('false');
    expect([pasif(takipDugmesi()), pasif(ozetDugmesi())]).toEqual([true, true]);
    // B'de tıklama yeni istek BAŞLATMAZ (düğme pasif; işleyici de ön denetimle döner).
    fireEvent.click(takipDugmesi());
    fireEvent.click(ozetDugmesi());
    expect(kodIstekleri()).toHaveLength(1);
    await act(async () => { birak?.(); });
    expect([pasif(takipDugmesi()), pasif(ozetDugmesi())]).toEqual([false, false]);
    expect(takipDugmesi().textContent).toContain('Takip Linki');
  });

  it('A\'da ÖZET beklerken B\'ye geçilince B\'de «Özet hazırlanıyor…» / `aria-busy` YOK; iki düğme pasif; bitince açık', async () => {
    ilkIstegiBeklet();
    const { gec } = ciz(siparis(), [B()]);
    fireEvent.click(ozetDugmesi());
    await act(async () => {});
    expect(ozetDugmesi().textContent).toContain('Özet hazırlanıyor…');
    expect(ozetDugmesi().getAttribute('aria-busy')).toBe('true');
    gec(B());
    expect(ozetDugmesi().textContent).not.toContain('Özet hazırlanıyor…');
    expect(ozetDugmesi().textContent).toContain('Özet Kopyala');
    expect(ozetDugmesi().getAttribute('aria-busy')).toBe('false');
    expect(takipDugmesi().textContent).toContain('Takip Linki');
    expect([pasif(takipDugmesi()), pasif(ozetDugmesi())]).toEqual([true, true]);
    await act(async () => { birak?.(); });
    expect([pasif(takipDugmesi()), pasif(ozetDugmesi())]).toEqual([false, false]);
  });

  it('takip beklerken AYNI siparişin özet düğmesi pasif ve yazısı değişmez; tıklaması istek atmaz', async () => {
    ilkIstegiBeklet();
    ciz(siparis());
    fireEvent.click(takipDugmesi());
    await act(async () => {});
    expect(pasif(ozetDugmesi())).toBe(true);
    expect(ozetDugmesi().textContent).toContain('Özet Kopyala');
    expect(ozetDugmesi().getAttribute('aria-busy')).toBe('false');
    fireEvent.click(ozetDugmesi());
    expect(kodIstekleri()).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => { birak?.(); });
    expect(pasif(ozetDugmesi())).toBe(false);
  });

  it('özet beklerken takip düğmesi pasif; bekleme yazısı yalnız özet düğmesinde', async () => {
    ilkIstegiBeklet();
    ciz(siparis());
    fireEvent.click(ozetDugmesi());
    await act(async () => {});
    expect(ozetDugmesi().textContent).toContain('Özet hazırlanıyor…');
    expect(ozetDugmesi().getAttribute('aria-busy')).toBe('true');
    expect(pasif(takipDugmesi())).toBe(true);
    expect(takipDugmesi().textContent).toContain('Takip Linki');
    expect(takipDugmesi().getAttribute('aria-busy')).toBe('false');
    await act(async () => { birak?.(); });
    expect(pasif(takipDugmesi())).toBe(false);
  });

  it('geç gelen başarı iletisi TIKLAMA ANINDAKİ siparişin numarasını taşır (B açıkken A\'nınki) — takip ve özet', async () => {
    for (const dugme of [takipDugmesi, ozetDugmesi]) {
      ilkIstegiBeklet();
      const { toast, gec, unmount } = ciz(siparis(), [B()]);
      fireEvent.click(dugme());
      await act(async () => {});
      gec(B());
      await act(async () => { birak?.(); });
      const son = toast.mock.calls[toast.mock.calls.length - 1];
      expect(son[1]).toBe('success');
      expect(String(son[0])).toMatch(/^MF-CTP77 — /);
      expect(String(son[0])).not.toContain('S-2002');
      // Panoya giden metin de A'nın (kod A'nın isteğinden).
      expect(kodIstekleri().map(c => c[0])).toEqual([`/api/siparis/${encodeURIComponent(ID)}/takip-kodu`]);
      unmount();
      authFetch.mockClear();
    }
  });
});

describe('kaynak çiti — üretici sayısı 2, doküman kimliğiyle bağlantı YOK', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'pages', 'OrdersPage.tsx')).map(s => s.kod).join('\n');
  it('`?track=${…id}` metni geçmez; `/?track=` OrdersPage\'de hiç kurulmaz (yardımcıda); `takipBaglantisiAl(` tam iki kez', () => {
    expect(kod).not.toMatch(/\?track=\$\{selectedOrder\.id\}/);
    expect(kod).not.toMatch(/\?track=\$\{o\.id\}/);
    expect(kod).not.toContain('/?track=');
    expect(kod.match(/\btakipBaglantisiAl\(/g) ?? []).toHaveLength(2);
    expect(kod.match(/\bpanoyaSozle\(/g) ?? []).toHaveLength(2);
    // Eski doğrudan pano yazımı bu iki düğmede kalmadı (ödeme hatırlatması gibi bağlantısız iletiler `writeText` ile devam eder).
    expect(kod).not.toMatch(/writeText\(url\)|writeText\(summary\)/);
  });
});
