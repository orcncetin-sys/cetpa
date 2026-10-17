/**
 * useMikroUretimReceteleri.test.ts — Mikro üretim reçetesi çekme kancasının ROL KAPISI
 * (karar turu 2026-10-11 — K5, İ3, İ4; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Üretim ekranı açılışındaki çağrı, rol `POST /api/mikro/pull/uretim-receteleri` ucunun kapısından geçemiyorsa HİÇ
 *      yapılmaz (12 rolün hepsi): oturum beklenmez, jeton istenmez, istek atılmaz. Geçen küme ELLE yazılı (§ 10.1 K5).
 *   2. Kilitli rolde `console.error` ÇAĞRILMAZ — eskiden kapıdan geçemeyen rolün 403'ü oraya yazılıp yutuluyordu.
 *   3. Kilitli rolde kanca «yükleniyor» demez (çekim hiç başlamadı).
 *   4. Geçen rolde istek TEK kez, kimlik jetonuyla ve gövdeyle atılır (gövdesiz POST'u IIS 411 ile reddeder).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMikroUretimReceteleri } from './useMikroUretimReceteleri';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';
import { auth } from '../firebase';

const ROLLER = Object.values(UserRole);
/** § 10.1 K5 «Geçen roller» — ELLE. */
const GECEN: UserRole[] = [UserRole.Admin, UserRole.Manager, UserRole.Logistics, UserRole.Purchasing];

// `../firebase` test kurulumunda sahte (`auth: { currentUser: null }`); kancanın okuduğu üç üye burada doldurulur.
interface SahteOturum { currentUser: { getIdToken: () => Promise<string> } | null; authStateReady?: () => Promise<void> }
const oturum = auth as unknown as SahteOturum;
const oturumHazir = vi.fn(() => Promise.resolve());
const jeton = vi.fn(() => Promise.resolve('jeton-1'));
const agIstegi = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const yanit = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'Content-Type': 'application/json' } });
const bekle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

let hataGunlugu: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  oturumHazir.mockClear();
  jeton.mockClear();
  agIstegi.mockReset();
  agIstegi.mockImplementation(() => Promise.resolve(yanit({ success: true, total: 4, written: 2, note: '2 ürün reçetesi (4 satırdan) bom koleksiyonuna yazıldı' })));
  vi.stubGlobal('fetch', agIstegi);
  oturum.currentUser = { getIdToken: jeton };
  oturum.authStateReady = oturumHazir;
  hataGunlugu = vi.spyOn(console, 'error').mockImplementation(() => {});
  useAppStore.setState({ userRole: UserRole.Sales });
});
afterEach(() => {
  vi.unstubAllGlobals();
  oturum.currentUser = null;
  delete oturum.authStateReady;
  hataGunlugu.mockRestore();
  useAppStore.setState({ userRole: UserRole.Sales });
});

describe('useMikroUretimReceteleri — rol kapısı (K5): geçemeyen rolde istek HİÇ atılmaz', () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — açılış çağrısı yalnız kapıdan geçen rolde yapılır', async rol => {
    useAppStore.setState({ userRole: rol });
    const { result } = renderHook(() => useMikroUretimReceteleri());
    const gecer = GECEN.includes(rol);
    expect(ucKapisindanGecer(rol, 'POST /api/mikro/pull/uretim-receteleri'), 'elle yazılan küme ortak tabloyla aynı').toBe(gecer);
    // Kilitli rolde çekim hiç başlamaz → ilk çizimde bile «yükleniyor» değildir.
    expect(result.current.loading).toBe(gecer);
    await bekle();
    expect(agIstegi).toHaveBeenCalledTimes(gecer ? 1 : 0);
    expect(oturumHazir).toHaveBeenCalledTimes(gecer ? 1 : 0);
    expect(jeton).toHaveBeenCalledTimes(gecer ? 1 : 0);
    expect(result.current.loading).toBe(false);
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it('Kalite (bilerek kilitlendi): ekran açılır, istek atılmaz, konsola yutulan 403 yazılmaz', async () => {
    useAppStore.setState({ userRole: UserRole.Quality });
    agIstegi.mockImplementation(() => Promise.resolve(yanit({ error: 'Bu veri için yetkiniz yok.' }, 403)));   // atılsaydı 403 dönerdi
    const { result } = renderHook(() => useMikroUretimReceteleri());
    await bekle();
    expect(agIstegi).not.toHaveBeenCalled();
    expect(hataGunlugu).not.toHaveBeenCalled();
    expect(result.current).toEqual({ receteler: [], loading: false });
  });

  it('geçen rolde istek kimlik jetonu ve gövdeyle POST edilir', async () => {
    useAppStore.setState({ userRole: UserRole.Logistics });
    renderHook(() => useMikroUretimReceteleri());
    await bekle();
    expect(agIstegi).toHaveBeenCalledTimes(1);
    const [url, init] = agIstegi.mock.calls[0];
    expect(url).toBe('/api/mikro/pull/uretim-receteleri');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jeton-1' });
  });

  it('rol sonradan gelirse (depo varsayılanı Satış → Lojistik) çağrı O ZAMAN yapılır; kilitli role dönünce yenisi atılmaz', async () => {
    const { result } = renderHook(() => useMikroUretimReceteleri());
    await bekle();
    expect(agIstegi).not.toHaveBeenCalled();
    act(() => { useAppStore.setState({ userRole: UserRole.Logistics }); });
    await waitFor(() => expect(agIstegi).toHaveBeenCalledTimes(1));
    await bekle();
    expect(result.current.loading).toBe(false);
    act(() => { useAppStore.setState({ userRole: UserRole.Quality }); });
    await bekle();
    expect(agIstegi).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('geçen rolde oturum yoksa istek atılmaz (eski davranış korunur)', async () => {
    useAppStore.setState({ userRole: UserRole.Admin });
    oturum.currentUser = null;
    const { result } = renderHook(() => useMikroUretimReceteleri());
    await bekle();
    expect(agIstegi).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('uç satır döndürürse `receteler` dolar (sözleşme korunur)', async () => {
    useAppStore.setState({ userRole: UserRole.Purchasing });
    const satir = { rec_kod: 'R1', rec_isim: 'Çelik Köşebent', rec_ana_stok_kod: 'S1', rec_cinsi: 0, rec_create_date: '2026-10-01' };
    agIstegi.mockImplementation(() => Promise.resolve(yanit({ success: true, data: [satir] })));
    const { result } = renderHook(() => useMikroUretimReceteleri());
    await bekle();
    expect(result.current.receteler).toEqual([satir]);
  });
});
