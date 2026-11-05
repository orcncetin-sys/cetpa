// @vitest-environment jsdom
/**
 * AdminPage.musteriHesabi.test.tsx — Yönetici ekranının «Kullanıcılar» sekmesindeki müşteri / bayi hesabı parçaları (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` H18; bileşenler `components/MusteriHesabiYonetimi.tsx`).
 *
 * GERÇEK `AdminPage` çizilir (bileşenlerin sayfaya BAĞLI olduğu davranışla ölçülür — «yazıldı ama bağlanmadı» olmasın); onay pencereleri
 * App'teki gibi GERÇEK `ConfirmModal`'dan geçer (aşağıdaki `Sarmal`). Sahte olan yalnız sunucu (`authFetch`) ve sayfanın bu işle ilgisiz
 * ağır parçaları.
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Rol dizileri: satır içi seçici ve davet seçicisi dış rol (B2B / Bayi) TAŞIMAZ; «Kullanıcı Ekle» dizisi aynen kalır (B2B / Bayi
 *      VAR). Üç dizide de `Legal` / `Corporate` / `Quality` YOK (diziler `STAFF_ROLES`'tan türetilmez — denetim).
 *   2. «Kullanıcı Ekle»de dış rol seçilince cari seçimi ZORUNLU: listeden seçilmeden «Oluştur» pasif; serbest yazım seçimi düşürür;
 *      gövdeye `leadId` girer. İç rolde cari kutusu ve `leadId` yok. `bagYok: true` yanıtı «Cari bağla» yolunu söyler.
 *   3. Dış rol satırında seçici YERİNE müşteri hücresi: firma, erişim durumu; düğme etiketi `durum`'dan. «Erişimi kapat» ve «Cari kodunu
 *      tazele» onay penceresinden geçer — VAZGEÇ'te istek GİTMEZ; metinler dürüst («tüm cihazlardan çıkış» YOK). `mfSayisi: 0` uyarısı.
 *   4. Müşteri hesabı listesi YALNIZ Yönetici / süper yönetici için istenir (sunucu kapısıyla aynı kural); başka sekmede istenmez.
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ConfirmModal from '../components/ConfirmModal';
import type { Lead } from '../types';

const authFetch = vi.hoisted(() => vi.fn());
vi.mock('../services/authFetch', () => ({ authFetch }));
vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: { currentUser: { uid: 'yonetici-1', getIdToken: async () => 'belirtec' }, onAuthStateChanged: () => () => {} },
}));
vi.mock('../lib/dbClient', async (asil) => {
  const a = await asil<typeof import('../lib/dbClient')>();
  return { ...a, onSnapshot: vi.fn(() => () => {}), updateDoc: vi.fn(async () => undefined) };
});
vi.mock('../components/DocumentDesigner', () => ({ default: () => null }));
vi.mock('../components/SuperAdminPanel', () => ({ default: () => null }));

import AdminPage from './AdminPage';

type AdminProps = React.ComponentProps<typeof AdminPage>;
type Onay = Parameters<AdminProps['openConfirm']>[0];

const FIRMA = 'Şirin Yapı Malzemeleri Ltd. Şti.';
const LEADS: Lead[] = [
  { id: 'lead-1', name: 'Ayşe Şirin', company: FIRMA, mikroCariKod: ' 120.01.077 ' },
  { id: 'lead-2', name: 'Özgür Çelik', company: 'Çelik İnşaat A.Ş.' },
] as unknown as Lead[];
const KULLANICILAR: Record<string, unknown>[] = [
  { id: 'yonetici-1', email: 'yonetici@cetpa.test', role: 'Admin' },
  { id: 'personel-1', email: 'satis@cetpa.test', role: 'Sales' },
  { id: 'bayi-1', email: 'bayi@ornek.test', role: 'Dealer' },
  { id: 'b2b-1', email: 'b2b@ornek.test', role: 'B2B' },
  { id: 'bagsiz-1', email: 'bagsiz@ornek.test', role: 'Dealer' },
];
const LISTE = {
  hesaplar: [
    { uid: 'bayi-1', leadId: 'lead-1', firma: FIRMA, durum: 'acik', guncelleme: '2026-10-21T10:00:00.000Z', cariKodDurumu: 'uyusuyor' },
    { uid: 'b2b-1', leadId: 'lead-2', firma: 'Çelik İnşaat A.Ş.', durum: 'kapali', guncelleme: '2026-10-21T10:00:00.000Z', cariKodDurumu: 'yok' },
  ],
};
const LISTE_UCU = '/api/admin/musteri-hesaplari';
const IC_ROLLER = ['Admin', 'Manager', 'Accounting', 'Sales', 'Logistics', 'HR', 'Purchasing'];

const yanit = (kod: number, govde: unknown): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
interface Istek { yontem: string; yol: string; govde: unknown }
let istekler: Istek[] = [];
let yeniKullaniciYaniti: () => Response = () => yanit(200, { success: true, uid: 'yeni-1', parolaLinki: 'https://app.cetpa.test/parola#x' });
let bagYaniti: () => Response = () => yanit(200, { ok: true, cariKodDurumu: 'uyusuyor', mfSayisi: 0 });

beforeEach(() => {
  istekler = [];
  yeniKullaniciYaniti = () => yanit(200, { success: true, uid: 'yeni-1', parolaLinki: 'https://app.cetpa.test/parola#x' });
  bagYaniti = () => yanit(200, { ok: true, cariKodDurumu: 'uyusuyor', mfSayisi: 0 });
  authFetch.mockReset();
  authFetch.mockImplementation(async (yol: string, init?: RequestInit) => {
    const basliklar = (init?.headers ?? {}) as Record<string, string>;
    const yontem = basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET';
    istekler.push({ yontem, yol, govde: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (yol === LISTE_UCU && yontem === 'GET') return yanit(200, LISTE);
    if (yol === '/api/admin/users' && yontem === 'POST') return yeniKullaniciYaniti();
    if (yol.startsWith(`${LISTE_UCU}/`) && yol.endsWith('/durum') && yontem === 'POST') {
      return yanit(200, { ok: true, durum: (init?.body ? JSON.parse(String(init.body)) as { durum: string } : { durum: '' }).durum });
    }
    if (yol.startsWith(`${LISTE_UCU}/`) && yontem === 'PUT') return bagYaniti();
    return yanit(404, {});
  });
});
afterEach(() => { cleanup(); });

const bekle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const bos = () => {};

/** App'in onay penceresi kalıbı: `openConfirm` seçenekleri GERÇEK `ConfirmModal`'da açılır. */
function Sarmal({ ek }: { ek: Partial<AdminProps> }) {
  const [onay, setOnay] = useState<Onay | null>(null);
  const p: AdminProps = {
    adminTab: 'users', setAdminTab: bos, isSuperAdmin: false, kpiCurrency: 'TRY', setKpiCurrency: bos,
    canAccess: () => true, hasFullAccess: () => true, currentLanguage: 'tr', currentT: {},
    orders: [], leads: LEADS, inventory: [], exchangeRates: null, employees: [], inventoryMovements: [],
    userRole: 'Admin', user: { uid: 'yonetici-1', email: 'yonetici@cetpa.test' }, isOwnerAdmin: false,
    auditLogs: [], companySettings: {}, setCompanySettings: bos, notifPrefs: {}, toggleNotifPref: bos,
    accessMatrix: [], setAccessMatrix: bos, firestoreUsers: KULLANICILAR, mikroSettings: {}, lucaSettings: {},
    setUserRole: bos, openConfirm: setOnay, toast: bos, logAuditAction: async () => {}, setActiveTab: bos,
    ...ek,
  };
  return (
    <>
      <AdminPage {...p} />
      <ConfirmModal isOpen={onay !== null} title={onay?.title ?? ''} message={onay?.message ?? ''} confirmLabel={onay?.confirmLabel}
        variant={onay?.variant} onConfirm={() => { onay?.onConfirm(); }} onClose={() => setOnay(null)} />
    </>
  );
}
const ciz = async (ek: Partial<AdminProps> = {}) => { const r = render(<Sarmal ek={ek} />); await bekle(); return r; };

/** Kullanıcı tablosunun satırı (e-posta hücresinden). */
const satir = (eposta: string): HTMLElement => {
  const hucre = screen.getAllByText(eposta).find(e => e.tagName === 'TD');
  const tr = hucre?.closest('tr');
  if (!tr) throw new Error(`satır yok: ${eposta}`);
  return tr;
};
const secenekler = (sec: HTMLSelectElement): string[] => [...sec.options].map(o => o.value);
/** Bir kartın (başlığından) kapsayıcısı. */
const kart = (baslik: string): HTMLElement => {
  const h = screen.getByRole('heading', { name: baslik });
  const k = h.closest('.rounded-2xl');
  if (!(k instanceof HTMLElement)) throw new Error(`kart yok: ${baslik}`);
  return k;
};
const ekleKarti = () => kart('Kullanıcı Ekle (manuel)');
const olusturDugmesi = (): HTMLButtonElement => within(ekleKarti()).getByRole<HTMLButtonElement>('button', { name: 'Oluştur' });
const CARI_YER_TUTUCU = 'Cari ara (firma ya da kişi adı)';
/** `CustomerCombobox`: yazar, açılan listeden adı verilen cariyi seçer (bileşenin kendi `onMouseDown`'ı). */
const cariSec = async (kap: HTMLElement, ara: string, ad: string) => {
  const girdi = within(kap).getByPlaceholderText(CARI_YER_TUTUCU);
  fireEvent.focus(girdi);
  fireEvent.change(girdi, { target: { value: ara } });
  fireEvent.mouseDown(within(kap).getByText(ad));
  await bekle();
};

describe('H18 — rol dizileri', () => {
  it('satır içi seçici dış rol TAŞIMAZ (iç rol satırında yalnız yedi iç rol); dış rol satırında seçici YOK, müşteri hücresi var', async () => {
    await ciz();
    const sec = within(satir('satis@cetpa.test')).getByRole<HTMLSelectElement>('combobox');
    expect(secenekler(sec)).toEqual(IC_ROLLER);
    for (const eposta of ['bayi@ornek.test', 'b2b@ornek.test', 'bagsiz@ornek.test']) {
      expect(within(satir(eposta)).queryByRole('combobox'), eposta).toBeNull();
    }
    expect(within(satir('bayi@ornek.test')).getByText('Bayi')).toBeTruthy();
    expect(within(satir('b2b@ornek.test')).getByText('B2B')).toBeTruthy();
  });

  it('davet seçicisi dış rol TAŞIMAZ; «Kullanıcı Ekle» dizisi AYNEN (B2B / Bayi var); üç dizide Legal / Corporate / Quality YOK', async () => {
    await ciz();
    const davet = within(kart('Kullanıcı Davet Et')).getByRole<HTMLSelectElement>('combobox');
    expect([...secenekler(davet)].sort()).toEqual([...IC_ROLLER].sort());
    const ekle = within(ekleKarti()).getByRole<HTMLSelectElement>('combobox');
    expect(secenekler(ekle)).toEqual([...IC_ROLLER, 'B2B', 'Dealer']);
    const satirIci = within(satir('satis@cetpa.test')).getByRole<HTMLSelectElement>('combobox');
    for (const sec of [davet, ekle, satirIci]) {
      for (const rol of ['Legal', 'Corporate', 'Quality']) expect(secenekler(sec)).not.toContain(rol);
    }
  });
});

describe('H18 — «Kullanıcı Ekle»de dış rol: cari seçimi ZORUNLU', () => {
  const doldur = (rol: string) => {
    const k = ekleKarti();
    fireEvent.change(within(k).getByPlaceholderText('ornek@sirket.com'), { target: { value: 'yeni@ornek.test' } });
    fireEvent.change(within(k).getByPlaceholderText('Ad Soyad'), { target: { value: 'Yeni Müşteri' } });
    fireEvent.change(within(k).getByRole('combobox'), { target: { value: rol } });
  };

  it('iç rolde cari kutusu YOK, gövdede `leadId` YOK', async () => {
    await ciz();
    doldur('Sales');
    expect(within(ekleKarti()).queryByPlaceholderText(CARI_YER_TUTUCU)).toBeNull();
    expect(olusturDugmesi().disabled).toBe(false);
    fireEvent.click(olusturDugmesi());
    await bekle();
    const giden = istekler.filter(i => i.yol === '/api/admin/users');
    expect(giden).toEqual([{ yontem: 'POST', yol: '/api/admin/users', govde: { email: 'yeni@ornek.test', displayName: 'Yeni Müşteri', role: 'Sales' } }]);
  });

  it.each(['Dealer', 'B2B'])('%s: cari seçilmeden «Oluştur» PASİF (tıklama istek atmaz); serbest yazım seçim sayılmaz; listeden seçince açılır ve gövdeye `leadId` girer', async (rol) => {
    await ciz();
    doldur(rol);
    const k = ekleKarti();
    expect(within(k).getByPlaceholderText(CARI_YER_TUTUCU)).toBeTruthy();
    expect(olusturDugmesi().disabled).toBe(true);
    fireEvent.click(olusturDugmesi());
    await bekle();
    // Serbest yazım (listede olmayan ad) seçim DEĞİLDİR.
    fireEvent.change(within(k).getByPlaceholderText(CARI_YER_TUTUCU), { target: { value: 'Uydurma Ltd.' } });
    expect(olusturDugmesi().disabled).toBe(true);
    expect(istekler.filter(i => i.yol === '/api/admin/users')).toEqual([]);
    await cariSec(k, 'Şirin', 'Ayşe Şirin');
    expect(olusturDugmesi().disabled).toBe(false);
    // Seçimden sonra yazı değişirse seçim düşer.
    fireEvent.change(within(k).getByPlaceholderText(CARI_YER_TUTUCU), { target: { value: `${FIRMA} x` } });
    expect(olusturDugmesi().disabled).toBe(true);
    await cariSec(k, 'Çelik', 'Özgür Çelik');
    fireEvent.click(olusturDugmesi());
    await bekle();
    expect(istekler.filter(i => i.yol === '/api/admin/users').map(i => i.govde)).toEqual([
      { email: 'yeni@ornek.test', displayName: 'Yeni Müşteri', role: rol, leadId: 'lead-2' },
    ]);
    // Başarıdan sonra liste yeniden çekilir (yeni bağ satırda görünsün); form sıfırlanır, cari kutusu kapanır.
    expect(istekler.filter(i => i.yol === LISTE_UCU)).toHaveLength(2);
    expect(within(ekleKarti()).queryByPlaceholderText(CARI_YER_TUTUCU)).toBeNull();
  });

  it('rol iç role dönünce seçim düşer: yeniden dış rol seçilince cari YENİDEN seçilmeli', async () => {
    await ciz();
    doldur('Dealer');
    await cariSec(ekleKarti(), 'Şirin', 'Ayşe Şirin');
    expect(olusturDugmesi().disabled).toBe(false);
    fireEvent.change(within(ekleKarti()).getByRole('combobox'), { target: { value: 'Sales' } });
    fireEvent.change(within(ekleKarti()).getByRole('combobox'), { target: { value: 'Dealer' } });
    expect(olusturDugmesi().disabled).toBe(true);
  });

  it('yanıtta `bagYok: true` → «Cari bağla» yolu söylenir; parola bağlantısı yine gösterilir', async () => {
    yeniKullaniciYaniti = () => yanit(200, { success: true, uid: 'yeni-1', parolaLinki: 'https://app.cetpa.test/parola#x', bagYok: true });
    await ciz();
    doldur('Dealer');
    await cariSec(ekleKarti(), 'Şirin', 'Ayşe Şirin');
    fireEvent.click(olusturDugmesi());
    await bekle();
    expect(ekleKarti().textContent).toContain('cari bağı yazılamadı: kullanıcı satırındaki «Cari bağla» ile bağlayın');
    expect(ekleKarti().textContent).toContain('https://app.cetpa.test/parola#x');
  });
});

describe('H18 — dış rol satırı (müşteri hücresi)', () => {
  it('Yönetici: liste TEK kez istenir; firma, erişim durumu ve `durum`dan etiket («Erişimi kapat» / «Erişimi aç»); bağsız satırda «Cari bağla»', async () => {
    await ciz();
    expect(istekler.filter(i => i.yol === LISTE_UCU)).toEqual([{ yontem: 'GET', yol: LISTE_UCU, govde: undefined }]);
    const acik = within(satir('bayi@ornek.test'));
    expect(acik.getByText(FIRMA)).toBeTruthy();
    expect(acik.getByText('Erişim açık')).toBeTruthy();
    expect(acik.getByRole('button', { name: 'Erişimi kapat' })).toBeTruthy();
    expect(acik.queryByRole('button', { name: 'Erişimi aç' })).toBeNull();
    expect(acik.getByText('Cari kodu: 120.01.077')).toBeTruthy();   // lead'in güncel kodu KIRPILARAK
    const kapali = within(satir('b2b@ornek.test'));
    expect(kapali.getByText('Erişim kapalı')).toBeTruthy();
    expect(kapali.getByRole('button', { name: 'Erişimi aç' })).toBeTruthy();
    expect(kapali.queryByRole('button', { name: 'Erişimi kapat' })).toBeNull();
    expect(kapali.getByText('Mikro cari kodu yok — yalnız ERP siparişleri görünür.')).toBeTruthy();
    const bagsiz = within(satir('bagsiz@ornek.test'));
    expect(bagsiz.getByText('Cari bağı yok — bayi ekranına giremez.')).toBeTruthy();
    expect(bagsiz.getByRole('button', { name: 'Cari bağla' })).toBeTruthy();
  });

  it('«Erişimi kapat»: dürüst onay metni; VAZGEÇ → istek GİTMEZ; onay → `POST …/durum {kapali}` ve liste yeniden çekilir', async () => {
    await ciz();
    fireEvent.click(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Erişimi kapat' }));
    const pencere = screen.getByRole('heading', { name: 'Erişimi kapat' }).parentElement as HTMLElement;
    expect(pencere.textContent).toContain('Bu kişinin mağaza oturumları hemen kapanır');
    expect(pencere.textContent?.toLocaleLowerCase('tr-TR')).not.toMatch(/tüm cihaz|bütün cihaz|her yerden çıkış|erp oturum/);
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    await bekle();
    expect(screen.queryByRole('heading', { name: 'Erişimi kapat' })).toBeNull();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([]);
    fireEvent.click(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Erişimi kapat' }));
    const onayDugmesi = within(screen.getByRole('heading', { name: 'Erişimi kapat' }).parentElement as HTMLElement).getAllByRole('button', { name: 'Erişimi kapat' }).at(-1);
    fireEvent.click(onayDugmesi as HTMLElement);
    await bekle();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([{ yontem: 'POST', yol: `${LISTE_UCU}/bayi-1/durum`, govde: { durum: 'kapali' } }]);
    expect(istekler.filter(i => i.yol === LISTE_UCU)).toHaveLength(2);
    expect(within(satir('bayi@ornek.test')).getByText('Erişim kapatıldı.')).toBeTruthy();
  });

  it('«Erişimi aç» de onaydan geçer: VAZGEÇ → istek yok; onay → `POST …/durum {acik}`', async () => {
    await ciz();
    fireEvent.click(within(satir('b2b@ornek.test')).getByRole('button', { name: 'Erişimi aç' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    await bekle();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([]);
    fireEvent.click(within(satir('b2b@ornek.test')).getByRole('button', { name: 'Erişimi aç' }));
    const pencere = screen.getByRole('heading', { name: 'Erişimi aç' }).parentElement as HTMLElement;
    fireEvent.click(within(pencere).getAllByRole('button', { name: 'Erişimi aç' }).at(-1) as HTMLElement);
    await bekle();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([{ yontem: 'POST', yol: `${LISTE_UCU}/b2b-1/durum`, govde: { durum: 'acik' } }]);
  });

  it('«Cari kodunu tazele»: onay lead\'in GÜNCEL kodunu ve oturum kapanışını söyler; VAZGEÇ → `PUT` GİTMEZ; onay → `PUT` (tünel) `{ leadId }`; `mfSayisi: 0` uyarısı', async () => {
    await ciz();
    fireEvent.click(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Cari kodunu tazele' }));
    const pencere = screen.getByRole('heading', { name: 'Cari kodunu tazele' }).parentElement as HTMLElement;
    expect(pencere.textContent).toContain("Lead'in güncel Mikro cari kodu: 120.01.077.");
    expect(pencere.textContent).toContain('Kod değişirse kişinin açık mağaza oturumu kapanır, yeniden şifreyle girmesi gerekir.');
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    await bekle();
    expect(istekler.filter(i => i.yontem === 'PUT')).toEqual([]);
    fireEvent.click(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Cari kodunu tazele' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tazele' }));
    await bekle();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([{ yontem: 'PUT', yol: `${LISTE_UCU}/bayi-1`, govde: { leadId: 'lead-1' } }]);
    expect(authFetch.mock.calls.find(c => c[0] === `${LISTE_UCU}/bayi-1`)?.[1]?.method).toBe('POST');   // IIS tüneli (X-Cetpa-Method)
    expect(within(satir('bayi@ornek.test')).getByText('Cari bağı yazıldı. Bu cari koduyla Mikro faturası siparişi yok.')).toBeTruthy();
    expect(istekler.filter(i => i.yol === LISTE_UCU)).toHaveLength(2);
  });

  it('`mfSayisi` 0 değilse «fatura siparişi yok» uyarısı ÇIKMAZ', async () => {
    bagYaniti = () => yanit(200, { ok: true, cariKodDurumu: 'uyusuyor', mfSayisi: 7 });
    await ciz();
    fireEvent.click(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Cari kodunu tazele' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tazele' }));
    await bekle();
    expect(within(satir('bayi@ornek.test')).getByText('Cari bağı yazıldı.')).toBeTruthy();
  });

  it('bağsız satırda «Cari bağla»: listeden seçilmeden «Bağla» PASİF; seçince `PUT { leadId }`', async () => {
    await ciz();
    const s = satir('bagsiz@ornek.test');
    fireEvent.click(within(s).getByRole('button', { name: 'Cari bağla' }));
    const bagla = within(s).getByRole<HTMLButtonElement>('button', { name: 'Bağla' });
    expect(bagla.disabled).toBe(true);
    fireEvent.change(within(s).getByPlaceholderText(CARI_YER_TUTUCU), { target: { value: 'Serbest yazım' } });
    expect(within(s).getByRole<HTMLButtonElement>('button', { name: 'Bağla' }).disabled).toBe(true);
    await cariSec(s, 'Şirin', 'Ayşe Şirin');
    fireEvent.click(within(s).getByRole('button', { name: 'Bağla' }));
    await bekle();
    expect(istekler.filter(i => i.yol !== LISTE_UCU)).toEqual([{ yontem: 'PUT', yol: `${LISTE_UCU}/bagsiz-1`, govde: { leadId: 'lead-1' } }]);
  });
});

describe('H18 — ekran yalnız Yönetici\'ye', () => {
  it.each(['Manager', 'Sales', 'Accounting'])('%s (süper yönetici değil): müşteri listesi İSTENMEZ; dış rol satırında yalnız rozet (düğme yok)', async (rol) => {
    await ciz({ userRole: rol });
    expect(istekler.filter(i => i.yol.startsWith(LISTE_UCU))).toEqual([]);
    const s = within(satir('bayi@ornek.test'));
    expect(s.getByText('Bayi')).toBeTruthy();
    for (const ad of ['Erişimi kapat', 'Erişimi aç', 'Cari kodunu tazele', 'Cari bağla']) expect(s.queryByRole('button', { name: ad })).toBeNull();
    expect(s.queryByRole('combobox')).toBeNull();   // seçiciye de dönmez
  });

  it('süper yönetici (rolü Müdür olsa da) listeyi görür — sunucu kapısıyla aynı kural', async () => {
    await ciz({ userRole: 'Manager', isSuperAdmin: true });
    expect(istekler.filter(i => i.yol === LISTE_UCU)).toHaveLength(1);
    expect(within(satir('bayi@ornek.test')).getByRole('button', { name: 'Erişimi kapat' })).toBeTruthy();
  });

  it('«Kullanıcılar» dışındaki sekmede liste istenmez', async () => {
    await ciz({ adminTab: 'access' });
    expect(istekler.filter(i => i.yol.startsWith(LISTE_UCU))).toEqual([]);
  });

  it('liste okunamazsa dış rol satırı «okunamadı» der, düğme çizmez', async () => {
    authFetch.mockImplementation(async (yol: string) => {
      istekler.push({ yontem: 'GET', yol, govde: undefined });
      return yol === LISTE_UCU ? yanit(503, { ok: false }) : yanit(404, {});
    });
    await ciz();
    const s = within(satir('bayi@ornek.test'));
    expect(s.getByText('Müşteri bilgisi okunamadı.')).toBeTruthy();
    expect(s.queryByRole('button', { name: 'Erişimi kapat' })).toBeNull();
  });
});
