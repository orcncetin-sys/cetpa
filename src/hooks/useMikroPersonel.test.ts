/**
 * useMikroPersonel.test.ts — Mikro personel çekme kancasının ROL KAPISI ve «hata yutulmaz» sözleşmesi
 * (karar turu 2026-10-11 — K4 / H5, İ3, İ4; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Açılış çağrısı, rol `POST /api/mikro/pull/personel` ucunun kapısından geçemiyorsa HİÇ yapılmaz (12 rolün hepsi).
 *      Geçen küme ELLE yazılı (Yönetici, İK — § 10.1 K4) ve ortak tabloyla ayrıca karşılaştırılır.
 *   2. `refetch` kilitli rolde de istek ATMAZ; sonucu «yetki» diye döndürür.
 *   3. Hata yutulmaz: kanca `console.error` ÇAĞIRMAZ; arıza `hata` alanında ve `refetch` sonucunda durur.
 *      (Eski sürüm 403'ü `console.error` ile yutuyor, çağıran yeşil «0 güncellendi, 0 eklendi» basıyordu.)
 *   4. Başarı ölçütü `success`'tir: uç satır döndürmez (`data` yok) — eski sürüm bu BAŞARILI yanıtı hata sayıyordu.
 *   5. Bilinmeyen sayı sıfır olmaz: yanıtta `written` yoksa `yazilan` `null`'dır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMikroPersonel } from './useMikroPersonel';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';
import { authFetch } from '../services/authFetch';

vi.mock('../services/authFetch', () => ({ authFetch: vi.fn() }));

const istek = vi.mocked(authFetch);
const ROLLER = Object.values(UserRole);
/** § 10.1 K4 «Geçen roller» — ELLE. Kapı genişler ya da daralırsa bu test BİLEREK kırılır. */
const GECEN: UserRole[] = [UserRole.Admin, UserRole.HR];
/** § 10.1 K4 «Kilitlenen (bilerek)» — İK ekranını gören ama artık çekemeyen iki rol. */
const KILITLENEN: UserRole[] = [UserRole.Manager, UserRole.Accounting];

const yanit = (govde: unknown, durum = 200): Response => new Response(JSON.stringify(govde), { status: durum, headers: { 'Content-Type': 'application/json' } });
const BASARILI = { success: true, total: 3, written: 3, note: '3 personel employees koleksiyonuna yazıldı' };
const bekle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

let hataGunlugu: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  istek.mockReset();
  istek.mockImplementation(() => Promise.resolve(yanit(BASARILI)));
  hataGunlugu = vi.spyOn(console, 'error').mockImplementation(() => {});
  useAppStore.setState({ userRole: UserRole.Sales });
});
afterEach(() => {
  hataGunlugu.mockRestore();
  useAppStore.setState({ userRole: UserRole.Sales });
});

describe('useMikroPersonel — rol kapısı (K4): geçemeyen rolde istek HİÇ atılmaz', () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — açılış çağrısı yalnız kapıdan geçen rolde yapılır', async rol => {
    useAppStore.setState({ userRole: rol });
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    const gecer = GECEN.includes(rol);
    expect(ucKapisindanGecer(rol, 'POST /api/mikro/pull/personel'), 'elle yazılan küme ortak tabloyla aynı').toBe(gecer);
    expect(result.current.yetkili).toBe(gecer);
    expect(istek).toHaveBeenCalledTimes(gecer ? 1 : 0);
    if (gecer) expect(istek).toHaveBeenCalledWith('/api/mikro/pull/personel', { method: 'POST' });
    expect(result.current.loading).toBe(false);
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it.each(KILITLENEN)('%s (bilerek kilitlendi) — refetch de istek atmaz, sonucu «yetki» diye döner', async rol => {
    useAppStore.setState({ userRole: rol });
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    let sonuc: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { sonuc = await result.current.refetch(); });
    expect(sonuc).toEqual({ ok: false, neden: 'yetki', hata: 'Bu rol Mikro personel çekimini başlatamaz.' });
    expect(istek).not.toHaveBeenCalled();
    expect(result.current.hata).toBeNull();
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it('rol sonradan gelirse (depo varsayılanı Satış → İK) çağrı O ZAMAN yapılır; kilitli role dönünce yenisi atılmaz', async () => {
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(istek).not.toHaveBeenCalled();
    act(() => { useAppStore.setState({ userRole: UserRole.HR }); });
    await waitFor(() => expect(istek).toHaveBeenCalledTimes(1));
    expect(result.current.yetkili).toBe(true);
    act(() => { useAppStore.setState({ userRole: UserRole.Manager }); });
    await bekle();
    expect(istek).toHaveBeenCalledTimes(1);
    expect(result.current.yetkili).toBe(false);
  });
});

describe('useMikroPersonel — hata yutulmaz, başarı uydurulmaz', () => {
  beforeEach(() => { useAppStore.setState({ userRole: UserRole.Admin }); });

  it('başarılı yanıt satır TAŞIMAZ (uç yalnız koleksiyona yazar) → hata YOK, yazılan sayı sunucunun dediği', async () => {
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBeNull();
    expect(result.current.data).toEqual([]);
    let sonuc: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { sonuc = await result.current.refetch(); });
    expect(sonuc).toEqual({ ok: true, data: [], yazilan: 3, not: '3 personel employees koleksiyonuna yazıldı' });
    expect(hataGunlugu).not.toHaveBeenCalled();   // eski sürüm burada «Personel verisi alınamadı» diye günlüğe yazıyordu
  });

  it('yanıtta `written` yoksa yazılan sayı BİLİNMİYOR (`null`), sıfır değil', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: true })));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    let sonuc: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { sonuc = await result.current.refetch(); });
    expect(sonuc).toEqual({ ok: true, data: [], yazilan: null, not: null });
  });

  it('uç satır döndürürse `data` dolar (sözleşme korunur)', async () => {
    const satir = { mikroPersKod: 'P1', name: 'Şule', surname: 'Işık', email: '', phone: '', department: '', position: '', salary: 1, startDate: '', status: 'Aktif', tcId: '' };
    istek.mockImplementation(() => Promise.resolve(yanit({ success: true, data: [satir], written: 1 })));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.data).toEqual([satir]);
  });

  it('sunucu 403 dönerse (istemcideki rol bayat) hata `hata` alanında DURUR; konsola yazılıp yutulmaz', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ error: 'Bu veri için yetkiniz yok.' }, 403)));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBe('Bu veri için yetkiniz yok.');
    let sonuc: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { sonuc = await result.current.refetch(); });
    expect(sonuc).toEqual({ ok: false, neden: 'hata', hata: 'Bu veri için yetkiniz yok.' });
    expect(result.current.loading).toBe(false);
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it('gövde JSON değilse (IIS 502 sayfası) hata durum koduyla söylenir', async () => {
    istek.mockImplementation(() => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 })));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBe('HTTP 502');
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it('200 + `success: false` de hatadır (Mikro reddi HTTP 200 gelebilir)', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: false, error: 'Personel çekimi başarısız.' })));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBe('Personel çekimi başarısız.');
  });

  it('ağ hatası da yutulmaz', async () => {
    istek.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBe('Failed to fetch');
    expect(result.current.loading).toBe(false);
    expect(hataGunlugu).not.toHaveBeenCalled();
  });

  it('«Mikro yapılandırılmamış» arıza DEĞİLDİR: `hata` boş kalır, sonuç nedeni ayrı söyler', async () => {
    istek.mockImplementation(() => Promise.resolve(yanit({ success: false, notConfigured: true }, 503)));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBeNull();
    let sonuc: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { sonuc = await result.current.refetch(); });
    expect(sonuc).toEqual({ ok: false, neden: 'yapilandirilmamis', hata: 'Mikro yapılandırılmamış.' });
  });

  it('sonraki başarılı çekim önceki hatayı siler', async () => {
    istek.mockImplementationOnce(() => Promise.resolve(yanit({ success: false, error: 'Personel çekimi başarısız.' }, 500)));
    const { result } = renderHook(() => useMikroPersonel());
    await bekle();
    expect(result.current.hata).toBe('Personel çekimi başarısız.');
    await act(async () => { await result.current.refetch(); });
    expect(result.current.hata).toBeNull();
  });
});
