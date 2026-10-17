/**
 * HRModule.rol.test.tsx — İK ekranındaki «Mikro'dan Senkronize Et» düğmesinin ROL KAPISI
 * (karar turu 2026-10-11 — K4 / H5, İ3 «ölü düğme yok»; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10.4 H5).
 *
 * Kapı bulgusu (istemci 4, engelleyici): düğme koşulsuz çiziliyordu. Personel ucu `employees` yazma kapısı alınca Müdür ve
 * Muhasebe basınca 403 dönüyor, kanca hatayı yutuyor ve ekran yeşil «0 güncellendi, 0 eklendi» basıyordu (sahte başarı).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Düğme yalnız ucun kapısından geçen rolde çizilir; geçemeyen rolde ekran açılışı da istek ATMAZ (12 rolün hepsi).
 *   2. Ekranın geri kalanı her rolde yerinde («Ekle» düğmesi, arama kutusu).
 *   3. Çekim başarısızsa KIRMIZI bildirim + ekranda kalıcı not; yeşil «güncellendi / eklendi» BASILMAZ.
 *   4. Çekim başarılıysa sunucunun yazdığı sayı söylenir; «0 güncellendi, 0 eklendi» uydurulmaz.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HRModule from './HRModule';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';
import { authFetch } from '../services/authFetch';
import { sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: vi.fn(() => Promise.resolve({ id: 'yeni' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  serverTimestamp: vi.fn(() => 'şimdi'),
}));
vi.mock('../services/authFetch', () => ({ authFetch: vi.fn() }));
// İzin sekmesindeki düğme bu testin konusu değil (kendi testi: MikroPushButton.test.tsx).
vi.mock('./MikroPushButton', () => ({ default: () => null }));

const istek = vi.mocked(authFetch);
const ROLLER = Object.values(UserRole);
/** § 10.1 K4 «Geçen roller» — ELLE. */
const GECEN: UserRole[] = [UserRole.Admin, UserRole.HR];
const DUGME = "Mikro'dan Senkronize Et";

const yanit = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'Content-Type': 'application/json' } });
const bekle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

async function ciz(rol: UserRole) {
  useAppStore.setState({ userRole: rol });
  const r = render(<HRModule currentLanguage="tr" isAuthenticated userRole={rol} employees={[]} />);
  await bekle();
  return r;
}

beforeEach(() => {
  sifirla();
  istek.mockReset();
  istek.mockImplementation(() => Promise.resolve(yanit({ success: true, total: 12, written: 12, note: '12 personel employees koleksiyonuna yazıldı' })));
});
afterEach(() => { useAppStore.setState({ userRole: UserRole.Sales }); });

describe("HRModule — «Mikro'dan Senkronize Et» düğmesi rol kapısına bağlı (K4 / H5)", () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — düğme yalnız kapıdan geçen rolde çizilir; geçemeyen rolde açılışta da istek atılmaz', async rol => {
    await ciz(rol);
    const gecer = GECEN.includes(rol);
    expect(ucKapisindanGecer(rol, 'POST /api/mikro/pull/personel'), 'elle yazılan küme ortak tabloyla aynı').toBe(gecer);
    expect(screen.queryByRole('button', { name: DUGME }) !== null).toBe(gecer);
    expect(istek).toHaveBeenCalledTimes(gecer ? 1 : 0);
    // Ekranın geri kalanı bozulmadı.
    expect(screen.getByRole('button', { name: /Ekle/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Çalışanlar...')).toBeInTheDocument();
  });

  it.each([UserRole.Manager, UserRole.Accounting])('%s (bilerek kilitlendi): düğme YOK, personel ucuna hiç istek gitmez, sahte başarı bildirimi çıkmaz', async rol => {
    istek.mockImplementation(() => Promise.resolve(yanit({ error: 'Bu veri için yetkiniz yok.' }, 403)));   // atılsaydı 403 dönerdi
    await ciz(rol);
    expect(screen.queryByText(DUGME)).toBeNull();
    expect(istek).not.toHaveBeenCalled();
    expect(screen.queryByText(/güncellendi|eklendi/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe("HRModule — «Mikro'dan Senkronize Et»: hata yutulmaz, başarı uydurulmaz", () => {
  it('başarılı çekim: sunucunun yazdığı sayı söylenir; «0 güncellendi, 0 eklendi» basılmaz', async () => {
    await ciz(UserRole.HR);
    fireEvent.click(screen.getByRole('button', { name: DUGME }));
    await bekle();
    expect(istek).toHaveBeenCalledTimes(2);   // açılış + düğme
    expect(screen.getByText("Mikro'dan 12 personel çekildi.")).toBeInTheDocument();
    expect(screen.queryByText(/0 güncellendi/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('yanıt sayı taşımıyorsa sayı UYDURULMAZ', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: true })));
    await ciz(UserRole.Admin);
    fireEvent.click(screen.getByRole('button', { name: DUGME }));
    await bekle();
    expect(screen.getByText('Mikro personel çekimi tamamlandı.')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ personel çekildi/)).toBeNull();
  });

  it('sunucu reddederse (403 — istemcideki rol bayat) KIRMIZI bildirim çıkar; yeşil «güncellendi / eklendi» YOK', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ error: 'Bu veri için yetkiniz yok.' }, 403)));
    await ciz(UserRole.HR);
    // Açılış çağrısının hatası ekranda kalıcı notta görünür (eskiden yalnız konsola yazılıyordu).
    expect(screen.getByRole('status').textContent).toContain('Mikro personel çekimi başarısız (Bu veri için yetkiniz yok).');
    fireEvent.click(screen.getByRole('button', { name: DUGME }));
    await bekle();
    const bildirim = screen.getByText('Mikro personel çekimi başarısız: Bu veri için yetkiniz yok.');
    expect(bildirim.className).toContain('bg-red-500');
    expect(screen.queryByText(/güncellendi|eklendi|çekildi\.|tamamlandı/)).toBeNull();
  });

  it('sunucu arızası (500) da aynı yoldan görünür', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: false, error: 'Personel çekimi başarısız.' }, 500)));
    await ciz(UserRole.Admin);
    fireEvent.click(screen.getByRole('button', { name: DUGME }));
    await bekle();
    expect(screen.getByText('Mikro personel çekimi başarısız: Personel çekimi başarısız.').className).toContain('bg-red-500');
    expect(screen.queryByText(/güncellendi|eklendi/)).toBeNull();
  });

  it('«Mikro yapılandırılmamış» düğmede söylenir; kalıcı arıza notu ÇIKMAZ (kurulum durumu, arıza değil)', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: false, notConfigured: true }, 503)));
    await ciz(UserRole.Admin);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DUGME }));
    await bekle();
    expect(screen.getByText('Mikro yapılandırılmamış.').className).toContain('bg-red-500');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
