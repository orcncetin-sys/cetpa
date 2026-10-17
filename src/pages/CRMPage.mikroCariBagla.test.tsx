/**
 * CRMPage.mikroCariBagla.test.tsx — CRM aday ayrıntısındaki «Mikro'da ara + Bağla» kutusu (şartname
 * `.wf/SARTNAME-mikro-cari-arama.md` C9, § 7 H1 / H2 / H8 / H9).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Kutu YALNIZ rol arama ucunun kapısından geçer VE `leads` yazarsa çizilir: Yönetici, Müdür, Satış. Muhasebe ve Satın Alma
 *      uca geçer ama adayı yazamaz — kutu yok, istek yok (İ3). Tablo ELLE yazılır. Açıklama cümlesi her rolde durur.
 *   2. Kutu yalnız cari ekstre bloğunun «bağlı değil» dalında: `mikroCariKod`, `code`, `taxNo` üçü de boş (H2).
 *   3. MÜKERRER BAĞ (H1): «Bağla» BELLEKTEKİ listeye değil, hedefli sorguya (`companyId` + `mikroCariKod`) bakar. Satış'ın bellek
 *      listesi kendine atananlarla süzülüdür; sunucu ise kiracının bütün kayıtlarını döndürür (ölçüm: server/mikroCariArama.zincir
 *      .test.ts H1). Başka satışçıya atanmış ya da müşteriye dönmüş (`isMusteri`) kayıt aynı koda bağlıysa `updateDoc` ÇAĞRILMAZ,
 *      uyarı görünür ve o kaydın ADI yazılmaz. Sorgu hata verirse bağlamaz, nedeni yazar.
 *   4. İnceleme 1: uçuştaki arama yanıtı, aday ya da metin değiştikten sonra gelirse kutuya YAZILMAZ (B'nin ekranında A için aranmış
 *      cariye «Bağla» düğmesi çıkmaz); kutu «aranıyor»da takılı kalmaz.
 *
 * `lib/dbClient` GERÇEKTİR (yalnız canlı akış `onSnapshot` susturulur, `updateDoc` sayılarak aynen çağrılır): hedefli sorgu
 * `GET /api/db/leads` + istemci süzgecinden, bağ yazımı `PATCH` tünelinden geçer — sahte olan yalnız `fetch` (sunucu).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { UserRole, type Lead } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { updateDoc } from '../lib/dbClient';
import { useAppStore } from '../store/appStore';
import CRMPage from './CRMPage';

vi.mock('../firebase', () => ({
  db: {}, storage: {},
  auth: { currentUser: { uid: 'satisci-1', getIdToken: async () => 'belirtec' }, onAuthStateChanged: () => () => {} },
}));
vi.mock('../lib/dbClient', async (asil) => {
  const a = await asil<typeof import('../lib/dbClient')>();
  return { ...a, onSnapshot: vi.fn(() => () => {}), updateDoc: vi.fn(a.updateDoc) };
});
// Ayrıntı ekranının bu sınamayla ilgisiz ağır parçaları boş çizilir.
vi.mock('../components/CariEkstrePanel', () => ({ default: () => null }));
vi.mock('../components/MutabakatPanel', () => ({ default: () => null }));
vi.mock('../components/DealerCommissionPanel', () => ({ default: () => null }));
vi.mock('../components/AccountingModule', () => ({ default: () => null }));
vi.mock('../components/B2BPortal', () => ({ default: () => null }));
vi.mock('../components/SatisAjaniPanel', () => ({ default: () => null }));
vi.mock('../components/AIInlineNudge', () => ({ default: () => null }));

const KIRACI = 'CETPA';
const ROLLER = Object.values(UserRole);
/** Kutuyu GÖREN roller — ELLE (H9): arama kapısı (`leads` okuma) ∩ `leads` yazma. Muhasebe ve Satın Alma burada YOK. */
const KUTUYU_GOREN: UserRole[] = [UserRole.Admin, UserRole.Manager, UserRole.Sales];
const ACIKLAMA = "Bu aday Mikro'ya bağlı değil — cari ekstre/bakiye görünmüyor.";
const YER_TUTUCU = "Mikro'da firma adı, cari kod ya da VKN ile ara...";

const ADAY: Lead = { id: 'aday-1', name: 'Şirin Yapı', company: 'Şirin Yapı Ltd.', status: 'New', companyId: KIRACI, assignedTo: 'satisci-1' } as unknown as Lead;

const jsonYanit = (govde: unknown, kod = 200): Response => new Response(JSON.stringify(govde), { status: kod, headers: { 'Content-Type': 'application/json' } });
/** Sunucunun `GET /api/db/leads` yanıtı (kiracının BÜTÜN adayları — Satış dâhil, `assignedTo` süzgeci YOK). */
let sunucuAdaylari: () => Response = () => jsonYanit({ docs: [] });
/** Söz (Promise) dönerse yanıt sınama çözene kadar UÇUŞTA kalır. */
let aramaYaniti: () => Response | Promise<Response> = () => jsonYanit({ success: true, data: [], sinirli: false });
interface Istek { yontem: string; yol: string; govde?: unknown }
let istekler: Istek[] = [];
const agIstegi = vi.fn((girdi: RequestInfo | URL, init?: RequestInit) => {
  const yol = typeof girdi === 'string' ? girdi : girdi instanceof URL ? girdi.pathname : girdi.url;
  const basliklar = (init?.headers ?? {}) as Record<string, string>;
  const yontem = (basliklar['X-Cetpa-Method'] ?? init?.method ?? 'GET').toUpperCase();
  istekler.push({ yontem, yol, govde: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (yol === '/api/mikro/cari/ara') return Promise.resolve(aramaYaniti());
  if (yol === '/api/db/leads' && yontem === 'GET') return Promise.resolve(sunucuAdaylari());
  if (yol.startsWith('/api/db/leads/') && yontem === 'PATCH') return Promise.resolve(jsonYanit({ data: { ...ADAY, mikroCariKod: '120.01.077' } }));
  return Promise.resolve(jsonYanit({}));
});
const mikroIstekleri = () => istekler.filter(i => i.yol.startsWith('/api/mikro/'));
const bagYazimi = vi.mocked(updateDoc);
const toast = vi.fn();
const setSelectedLead = vi.fn();
const bekle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };

function sayfa(rol: UserRole, aday: Lead, bellekListesi: Lead[]): React.ReactElement {
  const bos = () => {};
  return (
    <React.Suspense fallback={null}>
      <CRMPage
        crmTab="leads" setCrmTab={bos} monthlyTarget={0} monthlyTargets={{}} saveMonthlyTarget={bos}
        selectedLead={aday} setSelectedLead={setSelectedLead} hasFullAccess={() => true}
        currentLanguage="tr" currentT={{}} orders={[]} leads={bellekListesi} inventory={[]} exchangeRates={null} employees={[]}
        userRole={rol} user={{ uid: 'satisci-1', email: 'satisci@example.test' }} kpiCurrency="TRY" setKpiCurrency={bos}
        appQuotations={[]} activeTab="crm" darkMode={false} warehouses={[]} supportTickets={[]} commissionRules={[]} p549Iadeler={[]}
        trackView={bos} setIsEditingLead={bos} setEmailCompose={bos} handleToggleOrderPaid={bos} openConfirm={bos} toast={toast}
        setActiveTab={bos} setIsAddingLead={bos} setSelectedOrder={bos} setIsAddingOrder={bos} logAuditAction={async () => {}}
      />
    </React.Suspense>
  );
}
/** Sayfayı açar; dönen işlev seçili adayı DEĞİŞTİRİR (seçim prop'tur — App'in `setSelectedLead`'i gibi yeniden çizer). */
async function ac(rol: UserRole, aday: Lead = ADAY, bellekListesi: Lead[] = [ADAY]): Promise<(yeni: Lead) => Promise<void>> {
  useAppStore.setState({ userRole: rol, companyId: KIRACI });
  const { rerender } = render(sayfa(rol, aday, bellekListesi));
  await bekle();
  return async yeni => { rerender(sayfa(rol, yeni, bellekListesi)); await bekle(); };
}
const aramaAlani = (): HTMLInputElement => screen.getByPlaceholderText(YER_TUTUCU) as HTMLInputElement;
const araDugmesi = (): HTMLButtonElement => screen.getByRole('button', { name: 'Ara' }) as HTMLButtonElement;
async function ara(metin: string): Promise<void> {
  fireEvent.change(aramaAlani(), { target: { value: metin } });
  fireEvent.click(araDugmesi());
  await bekle();
}
const CARI = { cari_kod: '120.01.077', cari_unvan1: 'ŞİRİN YAPI MALZEMELERİ LTD. ŞTİ.', cari_vdaire_no: '8150012345' };
async function arayipBagla(): Promise<void> {
  aramaYaniti = () => jsonYanit({ success: true, sinirli: false, data: [CARI] });
  await ara('şirin');
  fireEvent.click(screen.getByRole('button', { name: `${CARI.cari_unvan1} carisine bağla` }));
  await bekle();
}

beforeEach(() => {
  istekler = [];
  agIstegi.mockClear();
  bagYazimi.mockClear();
  toast.mockClear();
  setSelectedLead.mockClear();
  sunucuAdaylari = () => jsonYanit({ docs: [] });
  aramaYaniti = () => jsonYanit({ success: true, data: [], sinirli: false });
  vi.stubGlobal('fetch', agIstegi);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAppStore.setState({ userRole: UserRole.Sales, companyId: null });
});

describe("CRMPage — «Mikro'da ara + Bağla» kutusu rol tablosuna göre (H9)", () => {
  it('rol listesi rbac ile aynı küme', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — kutu yalnız Yönetici / Müdür / Satış\'ta; açıklama cümlesi her rolde; ekran açılışında Mikro isteği yok', async rol => {
    await ac(rol);
    expect(screen.getByText(ACIKLAMA)).toBeInTheDocument();
    if (KUTUYU_GOREN.includes(rol)) expect(aramaAlani()).toBeInTheDocument();
    else {
      expect(screen.queryByPlaceholderText(YER_TUTUCU)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ara' })).toBeNull();
    }
    expect(mikroIstekleri()).toEqual([]);
  });

  it('H2: `taxNo`\'lu ya da `code`\'lu ama `mikroCariKod`\'suz aday bu turun dışında — kutu ve açıklama çizilmez (ekstre dalı)', async () => {
    await ac(UserRole.Sales, { ...ADAY, taxNo: '8150012345' } as unknown as Lead);
    expect(screen.queryByPlaceholderText(YER_TUTUCU)).toBeNull();
    expect(screen.queryByText(ACIKLAMA)).toBeNull();
    cleanup();
    await ac(UserRole.Sales, { ...ADAY, code: 'C-9' } as unknown as Lead);
    expect(screen.queryByPlaceholderText(YER_TUTUCU)).toBeNull();
  });
});

describe('CRMPage — arama (Satış)', () => {
  it('iki karakterden kısa metinde «Ara» pasif, «En az iki karakter yazın.»; Enter da istek atmaz', async () => {
    await ac(UserRole.Sales);
    fireEvent.change(aramaAlani(), { target: { value: ' ş ' } });
    expect(araDugmesi()).toBeDisabled();
    expect(screen.getByText('En az iki karakter yazın.')).toBeInTheDocument();
    fireEvent.keyDown(aramaAlani(), { key: 'Enter' });
    await bekle();
    expect(mikroIstekleri()).toEqual([]);
  });

  it('«Ara» `{ metin }` gövdesiyle gider; sonuçlar kod ve VKN ile çizilir; `sinirli`de «ilk 20» satırı', async () => {
    aramaYaniti = () => jsonYanit({ success: true, sinirli: true, data: [CARI, { cari_kod: '120.01.078', cari_unvan1: 'ŞİRİNLER İNŞAAT' }] });
    await ac(UserRole.Sales);
    await ara('  şirin ');
    expect(mikroIstekleri()).toEqual([{ yontem: 'POST', yol: '/api/mikro/cari/ara', govde: { metin: 'şirin' } }]);
    expect(screen.getByText(CARI.cari_unvan1)).toBeInTheDocument();
    expect(screen.getByText('120.01.077 · VKN 8150012345')).toBeInTheDocument();
    expect(screen.getByText('ŞİRİNLER İNŞAAT')).toBeInTheDocument();
    expect(screen.getByText('İlk 20 sonuç gösteriliyor, aramayı daraltın.')).toBeInTheDocument();
  });

  it('boş sonuç: «Eşleşme bulunamadı.»', async () => {
    await ac(UserRole.Sales);
    await ara('şirin');
    expect(screen.getByText('Eşleşme bulunamadı.')).toBeInTheDocument();
  });

  it.each([
    ['Mikro reddi', () => jsonYanit({ success: false, error: 'Mikro API yanıt vermedi.' }, 502), "Mikro'ya ulaşılamadı: Mikro API yanıt vermedi."],
    ['iletisiz hata', () => jsonYanit({}, 500), "Mikro'ya ulaşılamadı: HTTP 500"],
    ['yapılandırılmamış', () => jsonYanit({ success: false, notConfigured: true }, 503), 'Mikro bağlantısı yapılandırılmamış.'],
  ])('hata görünür: %s; ekranda `undefined` yok', async (_ad, yanit, metin) => {
    aramaYaniti = yanit;
    await ac(UserRole.Sales);
    await ara('şirin');
    expect(screen.getByRole('alert').textContent).toBe(metin);
    expect(document.body.textContent).not.toContain('undefined');
  });
});

describe('CRMPage — «Bağla»: mükerrer bağ denetimi hedefli sorguyla (H1)', () => {
  it('Satış: başka satışçıya atanmış ve BELLEK LİSTESİNDE OLMAYAN aday aynı koda bağlı → `updateDoc` YOK, uyarı var, kaydın adı yazılmaz', async () => {
    sunucuAdaylari = () => jsonYanit({ docs: [
      { id: 'aday-1', data: { ...ADAY } },
      { id: 'baskasinin', data: { name: 'Gizli Rakip Satışçının Adayı', companyId: KIRACI, assignedTo: 'satisci-2', mikroCariKod: CARI.cari_kod } },
    ] });
    await ac(UserRole.Sales, ADAY, [ADAY]);           // bellek listesi: yalnız kendi adayı (App leadsQuery süzgeci)
    await arayipBagla();
    expect(bagYazimi).not.toHaveBeenCalled();
    expect(istekler.filter(i => i.yontem === 'PATCH')).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('Bu cari başka bir kayda bağlı.');
    expect(document.body.textContent).not.toContain('Gizli Rakip');
    expect(setSelectedLead).not.toHaveBeenCalled();
    // Denetim sunucudan okudu (bellekten değil).
    expect(istekler.some(i => i.yontem === 'GET' && i.yol === '/api/db/leads')).toBe(true);
  });

  it('müşteriye dönmüş (`isMusteri`) kayıt aynı koda bağlı → bağlanmaz (aday listesi müşterileri içermez; sorgu içerir)', async () => {
    sunucuAdaylari = () => jsonYanit({ docs: [{ id: 'musteri-1', data: { name: 'Eski Aday', companyId: KIRACI, mikroCariKod: CARI.cari_kod, isMusteri: true } }] });
    await ac(UserRole.Sales);
    await arayipBagla();
    expect(bagYazimi).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Bu cari başka bir kayda bağlı.');
  });

  it('bağ yoksa (yalnız açık adayın kendisi ve YABANCI kiracının kaydı) → `updateDoc` tam bir kez, yalnız `mikroCariKod` + `updatedAt`', async () => {
    sunucuAdaylari = () => jsonYanit({ docs: [
      { id: 'aday-1', data: { ...ADAY, mikroCariKod: CARI.cari_kod } },                                       // açık adayın kendisi hariç tutulur
      { id: 'yabanci', data: { name: 'Başka Firma', companyId: 'BASKA-FIRMA', mikroCariKod: CARI.cari_kod } },  // kiracı süzgeci
      { id: 'ilgisiz', data: { name: 'İlgisiz', companyId: KIRACI, mikroCariKod: '120.01.999' } },
    ] });
    await ac(UserRole.Sales);
    await arayipBagla();
    expect(bagYazimi).toHaveBeenCalledTimes(1);
    const [ref, veri] = bagYazimi.mock.calls[0];
    expect(ref).toMatchObject({ coll: 'leads', id: 'aday-1' });
    expect(Object.keys(veri).sort()).toEqual(['mikroCariKod', 'updatedAt']);
    expect(veri.mikroCariKod).toBe(CARI.cari_kod);
    expect(setSelectedLead).toHaveBeenCalledWith(expect.objectContaining({ id: 'aday-1', mikroCariKod: CARI.cari_kod }));
    expect(toast).toHaveBeenCalledWith(`Mikro cari "${CARI.cari_unvan1}" bağlandı.`, 'success');
  });

  it('denetim sorgusu hata verirse bağlamaz, nedeni yazar', async () => {
    sunucuAdaylari = () => jsonYanit({ error: 'Bu veri için yetkiniz yok.' }, 403);
    await ac(UserRole.Sales);
    await arayipBagla();
    expect(bagYazimi).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/^Bağlanamadı: mevcut bağlar denetlenemedi \(.*403.*\)\.$/);
  });
});

describe('CRMPage — uçuştaki arama yanıtı bayat kutuya yazılmaz (inceleme 1)', () => {
  const ADAY_B: Lead = { ...ADAY, id: 'aday-2', name: 'Kaya Hırdavat', company: 'Kaya Hırdavat' } as unknown as Lead;
  const BAGLA = `${CARI.cari_unvan1} carisine bağla`;
  let coz: (r: Response) => void = () => {};
  beforeEach(() => { aramaYaniti = () => new Promise<Response>(r => { coz = r; }); });

  it('A\'nın araması beklerken B\'ye geçilir, yanıt sonra gelir → B\'de sonuç ve «Bağla» YOK, PATCH yok; B\'nin «Ara»sı takılı değil', async () => {
    const adayaGec = await ac(UserRole.Sales, ADAY, [ADAY, ADAY_B]);
    fireEvent.change(aramaAlani(), { target: { value: 'şirin' } });
    fireEvent.click(araDugmesi());
    await bekle();
    expect(screen.getByRole('button', { name: 'Aranıyor...' })).toBeDisabled();
    await adayaGec(ADAY_B);
    // Aday değişince «aranıyor» hemen biter (B'nin kutusu A'nın aramasını beklemez): düğme «Ara», metin boş olduğu için pasif.
    expect(araDugmesi()).toBeDisabled();
    expect(aramaAlani().value).toBe('');
    await act(async () => { coz(jsonYanit({ success: true, sinirli: true, data: [CARI] })); });
    await bekle();
    expect(screen.queryByRole('button', { name: BAGLA })).toBeNull();
    expect(screen.queryByText(CARI.cari_unvan1)).toBeNull();
    expect(screen.queryByText('Eşleşme bulunamadı.')).toBeNull();
    expect(screen.queryByText(/İlk 20 sonuç/)).toBeNull();
    expect(istekler.filter(i => i.yontem === 'PATCH')).toEqual([]);
    expect(bagYazimi).not.toHaveBeenCalled();
    expect(mikroIstekleri()).toHaveLength(1);
    fireEvent.change(aramaAlani(), { target: { value: 'kaya' } });
    expect(araDugmesi()).toBeEnabled();
  });

  it('aynı adayda metin değişince uçuştaki ESKİ metnin yanıtı (hata dâhil) yazılmaz', async () => {
    await ac(UserRole.Sales);
    fireEvent.change(aramaAlani(), { target: { value: 'şirin' } });
    fireEvent.click(araDugmesi());
    await bekle();
    fireEvent.change(aramaAlani(), { target: { value: 'şirinler' } });
    await act(async () => { coz(jsonYanit({ success: false, error: 'Mikro API yanıt vermedi.' }, 502)); });
    await bekle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(araDugmesi()).toBeEnabled();
  });

  it('arama sürerken Enter İKİNCİ istek atmaz (girdinin Enter yolu da «aranıyor» korumasından geçer)', async () => {
    await ac(UserRole.Sales);
    fireEvent.change(aramaAlani(), { target: { value: 'şirin' } });
    fireEvent.click(araDugmesi());
    await bekle();
    fireEvent.keyDown(aramaAlani(), { key: 'Enter' });
    await bekle();
    expect(mikroIstekleri()).toHaveLength(1);
  });

  it('eski metnin geç yanıtı, YENİ arama uçuştayken «aranıyor» durumunu bitirmez; yeni yanıt yazılır', async () => {
    const cozuculer: Array<(r: Response) => void> = [];
    aramaYaniti = () => new Promise<Response>(r => { cozuculer.push(r); });
    await ac(UserRole.Sales);
    fireEvent.change(aramaAlani(), { target: { value: 'şirin' } });
    fireEvent.click(araDugmesi());
    await bekle();
    fireEvent.change(aramaAlani(), { target: { value: 'şirinler' } });
    fireEvent.click(araDugmesi());
    await bekle();
    expect(mikroIstekleri()).toHaveLength(2);
    await act(async () => { cozuculer[0](jsonYanit({ success: true, sinirli: false, data: [CARI] })); });
    await bekle();
    expect(screen.getByRole('button', { name: 'Aranıyor...' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: BAGLA })).toBeNull();
    await act(async () => { cozuculer[1](jsonYanit({ success: true, sinirli: false, data: [{ cari_kod: '120.01.078', cari_unvan1: 'ŞİRİNLER İNŞAAT' }] })); });
    await bekle();
    expect(screen.getByRole('button', { name: 'ŞİRİNLER İNŞAAT carisine bağla' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: BAGLA })).toBeNull();
  });

  it('kontrol: aday değişmeden gelen yanıt yazılır (sayaç güncel aramayı engellemez)', async () => {
    await ac(UserRole.Sales);
    fireEvent.change(aramaAlani(), { target: { value: 'şirin' } });
    fireEvent.click(araDugmesi());
    await bekle();
    await act(async () => { coz(jsonYanit({ success: true, sinirli: false, data: [CARI] })); });
    await bekle();
    expect(screen.getByRole('button', { name: BAGLA })).toBeEnabled();
  });
});
