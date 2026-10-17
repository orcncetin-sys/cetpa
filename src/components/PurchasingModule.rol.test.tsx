/**
 * PurchasingModule.rol.test.tsx — Satın Alma'daki «Mikro'da ara» kutusu HİÇBİR rolde çizilmez
 * (karar turu 2026-10-11 — K1 / H3; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10.4 H3).
 *
 * Kutu `POST /api/mikro/cari/listesi` ucunu çağırıyordu: uç arama sonucu DÖNDÜRMEZ, her aramada en çok 200 cariyi müşteri
 * havuzuna yazar ve artık `leads` yazma kapısı ister. Kapıdan geçen rolde de ölüydü → salt okuyan arama ucu gelene kadar
 * kaldırıldı.
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Tedarikçi açılır listesinde «Mikro'da … ara» düğmesi 12 rolün HİÇBİRİNDE yok; Mikro cari arama ucu çağrılmaz.
 *   2. Ekranın geri kalanı bozulmadı: kayıtlı tedarikçi seçilir, «Yeni tedarikçi oluştur» çalışır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PurchasingModule from './PurchasingModule';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { addDoc } from '../lib/dbClient';
import * as mikroServisi from '../services/mikroService';
import { sifirla, koleksiyonAyarla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: vi.fn(() => Promise.resolve({ id: 'yeni-tedarikci' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'şimdi'),
  incrementField: vi.fn((n: number) => n),
}));
// Servisin TAMAMI sahte: Mikro cari arama sarmalayıcısı çağrılırsa burada görülür (çağıranı kalmamalı).
vi.mock('../services/mikroService', () => ({
  pullCariFromMikro: vi.fn(() => Promise.resolve({ success: true })),
  syncSupplierToMikro: vi.fn(() => Promise.resolve({ success: true })),
}));
vi.mock('./MikroPushButton', () => ({ default: () => null }));

const cariAra = vi.mocked(mikroServisi.pullCariFromMikro);
const tedarikciGonder = vi.mocked(mikroServisi.syncSupplierToMikro);
const yaz = vi.mocked(addDoc);
const agIstegi = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
const ROLLER = Object.values(UserRole);
const bekle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

/** Sipariş penceresini açar (düşük stok ön dolgusu pencereyi kendiliğinden açar) ve tedarikçi alanına yazar. */
async function tedarikciYaz(rol: UserRole, metin: string): Promise<HTMLInputElement> {
  koleksiyonAyarla('suppliers', [{ id: 's1', veri: { name: 'Özkan Hırdavat', mikroCariKod: '320.01.007' } }]);
  useAppStore.setState({ userRole: rol });
  render(<PurchasingModule currentLanguage="tr" isAuthenticated userRole={rol} inventory={[]} orders={[]} prefillProduct={{ name: 'Çimento', sku: 'CMT-1' }} />);
  await bekle();
  const alan = screen.getByPlaceholderText('Tedarikçi adı girin veya arayın...') as HTMLInputElement;
  fireEvent.focus(alan);
  fireEvent.change(alan, { target: { value: metin } });
  await bekle();
  return alan;
}

beforeEach(() => {
  sifirla();
  cariAra.mockClear();
  tedarikciGonder.mockClear();
  yaz.mockClear();
  agIstegi.mockClear();
  vi.stubGlobal('fetch', agIstegi);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({ userRole: UserRole.Sales });
});

describe("PurchasingModule — «Mikro'da ara» kutusu hiçbir rolde çizilmez (K1 / H3)", () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — tedarikçi listesi açılır, «Mikro\'da … ara» YOK, arama ucu çağrılmaz', async rol => {
    await tedarikciYaz(rol, 'Özkan');
    // Açılır liste AÇIK (kutu gizlendiği için değil, liste kapalı olduğu için geçen bir test olmasın).
    expect(screen.getByText('Kayıtlı tedarikçiler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni tedarikçi oluştur: "Özkan"' })).toBeInTheDocument();
    expect(screen.queryByText(/Mikro'da/)).toBeNull();
    expect(screen.queryByText(/Mikro sonuçları/)).toBeNull();
    expect(cariAra).not.toHaveBeenCalled();
    expect(agIstegi.mock.calls.filter(c => String(c.at(0)).includes('/api/mikro/cari/listesi'))).toEqual([]);
  });
});

describe('PurchasingModule — tedarikçi seçimi Mikro araması olmadan çalışır', () => {
  it('kayıtlı tedarikçi listeden seçilir', async () => {
    const alan = await tedarikciYaz(UserRole.Purchasing, 'Özkan');
    fireEvent.click(screen.getByRole('button', { name: /Özkan Hırdavat/ }));
    await bekle();
    expect(alan.value).toBe('Özkan Hırdavat');
    expect(screen.queryByText('Kayıtlı tedarikçiler')).toBeNull();   // liste kapandı
    expect(yaz).not.toHaveBeenCalled();
  });

  it('«Yeni tedarikçi oluştur» tedarikçiyi yazar ve Mikro cari kaydını dener (bu yol değişmedi)', async () => {
    await tedarikciYaz(UserRole.Purchasing, 'Yıldız Boya');
    fireEvent.click(screen.getByRole('button', { name: 'Yeni tedarikçi oluştur: "Yıldız Boya"' }));
    await bekle();
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toMatchObject({ name: 'Yıldız Boya' });
    expect(tedarikciGonder).toHaveBeenCalledWith({ name: 'Yıldız Boya' }, 'yeni-tedarikci');
    expect(cariAra).not.toHaveBeenCalled();
  });
});
