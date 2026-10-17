/**
 * EBelgeMerkezi.rol.test.tsx — e-Belge Merkezi'nin Mikro uçlarına giden düğmeleri ROL KAPISINA bağlı mı
 * (karar turu 2026-10-11 — K6, K7 / H1, H2, İ3, İ4).
 *
 * Bulgu (istemci 7): üç «çek» düğmesi KOŞULSUZ çiziliydi; salt okunur Satış ve Lojistik görüyor, tıklayınca 403 alıyordu.
 * Bileşenin tek yetki girdisi `isAuthenticated` (= sekme tablosu `hasFullAccess('ebelge')`) idi — sunucunun kapısından
 * BAĞIMSIZ bir kopya. Artık her düğme kendi ucunun kapısını ORTAK tablodan (`lib/mikroUcKapilari`) sorar; geçemeyen
 * rolde düğme ÇİZİLMEZ ve istek HİÇ atılmaz.
 *
 * H2'den sonra sekmeyi yalnız geçen roller açar; bu test bileşeni BİLEREK `isAuthenticated={true}` ile çizer: sekme
 * tablosu «evet» dese bile kilitli rol düğmeyi görmemelidir (bileşen kendi koşulunu taşır).
 *
 * Bileşen GERÇEKTEN çizilir; rol gerçek depodan, kapı gerçek ortak tablodan, indirme gerçek servisten geçer. Yalnız ağ
 * (`authFetch`), veri katmanı (`dbClient`) ve Mikro durum ucu sahte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EBelgeMerkezi from './EBelgeMerkezi';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { ucKapisindanGecer, type MikroKapiliUc } from '../lib/mikroUcKapilari';
import { entegrasyonUcKapisindanGecer } from '../lib/entegrasyonUcKapilari';
import { koleksiyonAyarla, sifirla } from '../hooks/useArkaPlanIsi.testDuzenegi';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../test/kaynakTarama';

const authFetch = vi.fn();
vi.mock('../services/authFetch', () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), setDoc: vi.fn(), serverTimestamp: () => 'TS',
}));
// Onay penceresi (GlobalConfirm) bu düzenekte bağlı değil: «e-Fatura Gönder» onayı «evet» sayılır (yalnız onay — kapı DEĞİL).
vi.mock('../lib/confirm', async (orig) => ({ ...(await orig<typeof import('../lib/confirm')>()), confirmAction: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../services/mikroService', () => ({
  getMikroStatus: vi.fn(() => Promise.resolve({ configured: true, connected: true, mode: 'local' })),
}));

/** § 10.1 K6 / § 10.4 H1 sütunları ELLE (ortak tablo değişirse bu liste BİLEREK güncellenir). */
const GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Accounting];
const KILITLI = [UserRole.Sales, UserRole.Logistics, UserRole.Purchasing];
const TUM_ROLLER = Object.values(UserRole);

/** Üç «çek» düğmesi: ipucu metni (yön süzgecindeki «Gelen» / «Giden» düğmeleriyle karışmasın) → ortak tablo anahtarı. */
const CEKIM: { ipucu: string; uc: MikroKapiliUc; yol: string; ek: Record<string, unknown> }[] = [
  { ipucu: "GİB'den gelen e-faturaları çek", uc: 'POST /api/mikro/ebelge/gelen', yol: '/api/mikro/ebelge/gelen', ek: {} },
  { ipucu: "Mikro'dan giden e-fatura ve e-arşiv belgelerini çek", uc: 'POST /api/mikro/ebelge/giden', yol: '/api/mikro/ebelge/giden', ek: {} },
  { ipucu: 'e-İrsaliye listesini çek', uc: 'POST /api/mikro/ebelge/eirsaliye', yol: '/api/mikro/ebelge/eirsaliye', ek: { yon: 'giden' } },
];
const PDF_IPUCU = "Resmi PDF'i indir (Mikro/GİB)";
const XML_IPUCU = 'XML indir — e-belgenin yasal aslı (PDF yalnız görüntüsüdür)';

const UUID_GELEN = '11111111-2222-3333-4444-555555555555';
const UUID_GIDEN = '66666666-7777-8888-9999-000000000000';
/** Dört satır: Mikro kaynaklı gelen + giden (UUID'li), Mikro kaynaklı UUID'siz (yalnız PDF), elle girilmiş (indirme yok). */
const BELGELER = [
  { id: UUID_GELEN, veri: { belgeNo: 'SZN2026000001284', alici: 'SİZGEN YAPI', vergiNo: '1234567890', tutar: 202419, belgeDate: '2026-08-31', tur: 'e-fatura', durum: 'Gönderildi', notes: '', kaynak: 'mikro', yon: 'gelen', uuid: UUID_GELEN } },
  { id: UUID_GIDEN, veri: { belgeNo: 'CTP2026000000359', alici: 'ACCADO KİLİT SİSTEMLERİ', vergiNo: '0040488682', tutar: 4270.01, belgeDate: '2026-09-03', tur: 'e-fatura', durum: 'Gönderildi', notes: '', kaynak: 'mikro', yon: 'giden', uuid: UUID_GIDEN } },
  { id: 'kiraci__giden-CTP2026000000360', veri: { belgeNo: 'CTP2026000000360', alici: 'ÇİMSA İNŞAAT', vergiNo: '', tutar: 1200, belgeDate: '2026-09-04', tur: 'e-fatura', durum: 'Bekliyor', notes: '', kaynak: 'mikro', yon: 'giden' } },
  { id: 'elle-1', veri: { belgeNo: 'EF-2026-0001', alici: 'ELLE GİRİLEN ALICI', vergiNo: '', tutar: 500, belgeDate: '2026-09-05', tur: 'e-fatura', durum: 'Bekliyor', notes: '' } },
];

const json = (govde: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(govde) });
/** LUCA'ya gönderim bekleyen yerel fatura (e-Fatura, «Kesildi») — «e-Fatura Gönder» düğmesinin satırı. */
const BEKLEYEN_FATURA = { id: 'fat-1', veri: { faturaNo: 'CTP-2026-000777', date: '2026-10-15', customerName: 'ŞİRİN YAPI A.Ş.', taxId: '1234567890', totalPrice: 3600, status: 'Kesildi', faturaTipi: 'e-fatura' } };
const PDF_B64 = btoa('%PDF-1.4 '.repeat(80));
const XML_DUZ = `<?xml version="1.0" encoding="UTF-8"?><Invoice>${'<Satir>ÇİMENTO</Satir>'.repeat(20)}</Invoice>`;
function yonlendir() {
  authFetch.mockImplementation((url: string) => {
    if (url === '/api/luca/kontor') return json({ success: false, notConfigured: true });
    if (url === '/api/luca/fatura-gonder') return json({ success: true, message: 'Fatura Luca e-Fatura sistemine iletildi.', ettn: 'ETTN-1' });
    if (CEKIM.some(c => c.yol === url)) return json({ success: true, total: 3 });
    if (url === '/api/mikro/ebelge/pdf') return json({ success: true, data: PDF_B64 });
    if (url === '/api/mikro/ebelge/xml') return json({ success: true, data: XML_DUZ });
    return json({ success: false, error: `beklenmeyen istek ${url}` });
  });
}
/** Mikro e-belge uçlarına atılan istekler: yol + yöntem + çözülmüş gövde (Luca kontör çağrısı hariç). */
const mikroIstekleri = () => authFetch.mock.calls
  .filter(c => String(c[0]).startsWith('/api/mikro/'))
  .map(c => {
    const init = c[1] as { method?: string; body?: string } | undefined;
    return { yol: String(c[0]), yontem: init?.method, govde: JSON.parse(String(init?.body)) as Record<string, unknown> };
  });

const asilAdres = { olustur: URL.createObjectURL, birak: URL.revokeObjectURL };
let indirilen: string[] = [];

beforeEach(() => {
  sifirla();
  koleksiyonAyarla('eBelgeler', BELGELER);
  authFetch.mockReset();
  yonlendir();
  indirilen = [];
  URL.createObjectURL = vi.fn(() => 'blob:sahte');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { indirilen.push(this.download); });
});
afterEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = asilAdres.olustur;
  URL.revokeObjectURL = asilAdres.birak;
});

/** Bileşeni verilen rolde çizer; liste (4 satır) ve — rol kontör ucunun kapısından geçiyorsa — Luca kartı yerleşene kadar
 *  bekler. Kapıdan geçemeyen rolde kart HİÇ çizilmez (2026-10-17, iç rol daraltma L1). */
async function ciz(rol: UserRole) {
  useAppStore.setState({ userRole: rol });
  const r = render(<EBelgeMerkezi currentLanguage="tr" isAuthenticated={true} />);
  await screen.findByText('SZN2026000001284');
  if (entegrasyonUcKapisindanGecer(rol, 'GET /api/luca/kontor')) await screen.findByText('e-Fatura entegrasyonu aktif değil');
  await screen.findByText('Mikro Bağlı');
  return r;
}
const satirOf = (belgeNo: string): HTMLElement => {
  const tr = screen.getByText(belgeNo).closest('tr');
  if (!tr) throw new Error(`"${belgeNo}" bir <tr> içinde değil`);
  return tr;
};

describe('e-Belge Merkezi — K6: üç «çek» düğmesi ortak tablodan (ölü düğme yok)', () => {
  it.each(GECEN)('geçen rol %s: Gelen, Giden, e-İrsaliye düğmeleri ÇİZİLİR', async (rol) => {
    await ciz(rol);
    for (const c of CEKIM) expect(screen.queryByTitle(c.ipucu), c.ipucu).not.toBeNull();
  });

  it.each(KILITLI)('kilitli rol %s: sekme tablosu «tam yetkili» dese de üç düğme ÇİZİLMEZ, Mikro\'ya istek atılmaz', async (rol) => {
    await ciz(rol);
    for (const c of CEKIM) expect(screen.queryByTitle(c.ipucu), c.ipucu).toBeNull();
    expect(mikroIstekleri()).toEqual([]);
    // Kapsam: yalnız Mikro uçlarına giden düğmeler gizlenir — liste ve «Yeni Belge» (Mikro ucu değil) yerinde.
    expect(screen.getByText('CTP2026000000359')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yeni Belge/ })).toBeTruthy();
  });

  it('12 rolün HEPSİ × üç düğme: çizilir ⇔ ortak tablo o ucu geçirir (bileşende kopya rol listesi yok)', async () => {
    expect([...TUM_ROLLER].sort()).toEqual([...APP_ROLES].sort());   // enum ↔ rbac rol listesi: eksik / fazla rol yok
    for (const rol of TUM_ROLLER) {
      const { unmount } = await ciz(rol);
      for (const c of CEKIM) expect(screen.queryByTitle(c.ipucu) !== null, `${c.uc} × ${rol}`).toBe(ucKapisindanGecer(rol, c.uc));
      unmount();
    }
    for (const c of CEKIM) expect(TUM_ROLLER.filter(r => ucKapisindanGecer(r, c.uc)).sort(), c.uc).toEqual([...GECEN].sort());
  });

  it('geçen rolde her düğme KENDİ ucuna gider (yol = kapı anahtarının yolu), tarih aralığı + düğmenin eki gövdede', async () => {
    await ciz(UserRole.Accounting);
    for (const c of CEKIM) {
      fireEvent.click(screen.getByTitle(c.ipucu));
      await waitFor(() => expect(mikroIstekleri().some(i => i.yol === c.yol)).toBe(true));
      await waitFor(() => expect((screen.getByTitle(c.ipucu) as HTMLButtonElement).disabled).toBe(false));   // çekim bitti
    }
    const istekler = mikroIstekleri();
    expect(istekler.map(i => `${i.yontem} ${i.yol}`)).toEqual(CEKIM.map(c => c.uc));
    for (const [i, c] of CEKIM.entries()) {
      expect(istekler[i].govde).toEqual({ ilkTarih: expect.stringMatching(/^\d{4}-01-01$/), sonTarih: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ...c.ek });
    }
  });

  it('sunucu reddi SESSİZ kalmaz: 403 gövdesi kırmızı bildirimde', async () => {
    await ciz(UserRole.Manager);
    authFetch.mockImplementation(() => json({ error: 'Bu veri için yetkiniz yok.' }, false));
    fireEvent.click(screen.getByTitle(CEKIM[0].ipucu));
    expect(await screen.findByText('Bu veri için yetkiniz yok.')).toBeTruthy();
  });
});

describe('e-Belge Merkezi — K7 / H1: satırdaki PDF / XML indirme düğmeleri ortak tablodan', () => {
  it.each(GECEN)('geçen rol %s: Mikro kaynaklı satırlarda PDF (3) ve UUID\'li satırlarda XML (2); elle girilen satırda indirme yok', async (rol) => {
    await ciz(rol);
    expect(screen.getAllByTitle(PDF_IPUCU)).toHaveLength(3);
    expect(screen.getAllByTitle(XML_IPUCU)).toHaveLength(2);
    expect(within(satirOf('EF-2026-0001')).queryByTitle(PDF_IPUCU)).toBeNull();
    expect(within(satirOf('CTP2026000000360')).queryByTitle(PDF_IPUCU)).not.toBeNull();   // UUID yok, belge no var → yalnız PDF
    expect(within(satirOf('CTP2026000000360')).queryByTitle(XML_IPUCU)).toBeNull();
  });

  it.each(KILITLI)('kilitli rol %s: liste görünse de HİÇBİR satırda PDF / XML düğmesi yok (gelen de giden de — H1)', async (rol) => {
    await ciz(rol);
    expect(screen.getByText('SZN2026000001284')).toBeTruthy();       // satırlar çizili: gizleyen sekme tablosu değil, düğmenin koşulu
    expect(screen.getByText('CTP2026000000359')).toBeTruthy();
    expect(screen.queryAllByTitle(PDF_IPUCU)).toEqual([]);
    expect(screen.queryAllByTitle(XML_IPUCU)).toEqual([]);
    expect(mikroIstekleri()).toEqual([]);
    expect(indirilen).toEqual([]);
  });

  it('12 rolün HEPSİ: PDF / XML düğmesi çizilir ⇔ ortak tablo indirme ucunu geçirir', async () => {
    for (const rol of TUM_ROLLER) {
      const { unmount } = await ciz(rol);
      expect(screen.queryAllByTitle(PDF_IPUCU).length > 0, `PDF × ${rol}`).toBe(ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/pdf'));
      expect(screen.queryAllByTitle(XML_IPUCU).length > 0, `XML × ${rol}`).toBe(ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/xml'));
      unmount();
    }
    expect(TUM_ROLLER.filter(r => ucKapisindanGecer(r, 'POST /api/mikro/ebelge/pdf')).sort()).toEqual([...GECEN].sort());
  });

  it('geçen rolde tıklama ortak servisten geçer: PDF gövdesi yön TAŞIMAZ (gelen belgede de), XML gövdesi tür + yön taşır; dosya iner', async () => {
    await ciz(UserRole.Accounting);
    fireEvent.click(within(satirOf('SZN2026000001284')).getByTitle(PDF_IPUCU));
    await waitFor(() => expect(indirilen).toEqual(['SZN2026000001284.pdf']));
    fireEvent.click(within(satirOf('CTP2026000000360')).getByTitle(PDF_IPUCU));
    await waitFor(() => expect(indirilen).toHaveLength(2));
    fireEvent.click(within(satirOf('SZN2026000001284')).getByTitle(XML_IPUCU));
    await waitFor(() => expect(indirilen).toHaveLength(3));
    expect(mikroIstekleri()).toEqual([
      { yol: '/api/mikro/ebelge/pdf', yontem: 'POST', govde: { uuid: UUID_GELEN } },
      { yol: '/api/mikro/ebelge/pdf', yontem: 'POST', govde: { faturaGuid: 'kiraci__giden-CTP2026000000360' } },
      { yol: '/api/mikro/ebelge/xml', yontem: 'POST', govde: { uuid: UUID_GELEN, tur: 'e-fatura', yon: 'gelen' } },
    ]);
    expect(indirilen).toEqual(['SZN2026000001284.pdf', 'CTP2026000000360.pdf', 'SZN2026000001284.xml']);
  });
});

// ── Kaynak çiti: «yazıldı ama bağlanmadı» / yarım düzeltme ────────────────────────────────────────────────────────────
describe('e-Belge Merkezi — LUCA uçları (2026-10-17, iç rol daraltma L1 / L2): kontör kartı ve «e-Fatura Gönder» ortak tablodan', () => {
  /** § 2 L1 (`eBelgeler` okuma) ve L2 (`invoices` yazma) — ELLE. İkisi de bugün e-Belge sekmesinin kümesiyle aynı. */
  const LUCA_GECEN = [UserRole.Admin, UserRole.Manager, UserRole.Accounting];
  const lucaIstekleri = () => authFetch.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/api/luca/'));

  it.each([UserRole.Sales, UserRole.Logistics, UserRole.Purchasing, UserRole.HR, UserRole.Quality])(
    'kilitli rol %s: bekleyen fatura listede, ama «e-Fatura Gönder» düğmesi ve kontör kartı ÇİZİLMEZ; LUCA\'ya HİÇ istek atılmaz',
    async (rol) => {
      koleksiyonAyarla('invoices', [BEKLEYEN_FATURA]);
      await ciz(rol);
      expect(await screen.findByText('CTP-2026-000777')).toBeTruthy();                // liste yerinde (boş çizim yanlış yeşil vermesin)
      expect(screen.queryByRole('button', { name: /e-Fatura Gönder/ })).toBeNull();
      expect(screen.queryByText('Luca Kontör Bakiyesi')).toBeNull();
      expect(lucaIstekleri()).toEqual([]);
    },
  );

  it.each(LUCA_GECEN)('geçen rol %s: kontör sorulur, düğme çizilir ve tıklama `/api/luca/fatura-gonder`\'a gider', async (rol) => {
    koleksiyonAyarla('invoices', [BEKLEYEN_FATURA]);
    await ciz(rol);
    expect(screen.getByText('Luca Kontör Bakiyesi')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /e-Fatura Gönder/ }));
    await waitFor(() => expect(lucaIstekleri()).toEqual(['/api/luca/kontor', '/api/luca/fatura-gonder']));
  });

  it('12 rolün HEPSİ: düğme ⇔ `POST /api/luca/fatura-gonder` kapısı, kart ⇔ `GET /api/luca/kontor` kapısı (bileşende kopya rol listesi yok)', async () => {
    for (const rol of TUM_ROLLER) {
      koleksiyonAyarla('invoices', [BEKLEYEN_FATURA]);
      authFetch.mockClear();
      const { unmount } = await ciz(rol);
      await screen.findByText('CTP-2026-000777');
      expect(screen.queryByRole('button', { name: /e-Fatura Gönder/ }) !== null, `düğme × ${rol}`).toBe(entegrasyonUcKapisindanGecer(rol, 'POST /api/luca/fatura-gonder'));
      expect(screen.queryByText('Luca Kontör Bakiyesi') !== null, `kart × ${rol}`).toBe(entegrasyonUcKapisindanGecer(rol, 'GET /api/luca/kontor'));
      expect(lucaIstekleri().includes('/api/luca/kontor'), `istek × ${rol}`).toBe(entegrasyonUcKapisindanGecer(rol, 'GET /api/luca/kontor'));
      unmount();
    }
    expect(TUM_ROLLER.filter(r => entegrasyonUcKapisindanGecer(r, 'POST /api/luca/fatura-gonder')).sort()).toEqual([...LUCA_GECEN].sort());
    expect(TUM_ROLLER.filter(r => entegrasyonUcKapisindanGecer(r, 'GET /api/luca/kontor')).sort()).toEqual([...LUCA_GECEN].sort());
  });
});

// Beş e-belge ucunun istemcideki çağıranları SAYILIDIR. Yeni bir dosya bu yollardan birini kod satırında geçirirse
// (yeni düğme, yeni otomatik çekim) bu liste kırılır: o çağıran da kapıyı ortak tablodan sormak zorundadır.
describe('kaynak çiti — e-belge uçlarının istemci çağıranları ve rol kaynağı', () => {
  const UC_YOLU = /\/api\/mikro\/ebelge\/(gelen|giden|eirsaliye|pdf|xml)\b/;
  const DOSYA = {
    merkez: join(SRC_KOK, 'components', 'EBelgeMerkezi.tsx'),
    detay: join(SRC_KOK, 'components', 'MikroFaturaDetay.tsx'),
    servis: join(SRC_KOK, 'services', 'ebelgeIndir.ts'),
  };
  const kod = (yol: string): string[] => kodSatirlari(yol).map(s => s.kod.trim()).filter(Boolean);
  const adet = (satirlar: string[], parca: string): number => satirlar.filter(s => s.includes(parca)).length;

  it('beş ucun yolunu kod satırında geçiren istemci dosyaları: ortak tablo + servis + iki bileşen (başka çağıran yok)', () => {
    // Ham metin ön süzgeci: yorum ayıklama (pahalı) yalnız yolu geçiren birkaç dosyada koşar.
    const gecen = kaynakDosyalari(SRC_KOK)
      .filter(y => !gorece(y).startsWith('src/server/') && oku(y).includes('/api/mikro/ebelge/') && kodSatirlari(y).some(s => UC_YOLU.test(s.kod)))
      .map(gorece)
      .sort();
    expect(gecen).toEqual([
      'src/components/EBelgeMerkezi.tsx', 'src/components/MikroFaturaDetay.tsx', 'src/lib/mikroUcKapilari.ts', 'src/services/ebelgeIndir.ts',
    ]);
    // Üçü de yolu YALNIZ ortak tablo anahtarı biçiminde ('YÖNTEM /yol') yazar — çıplak yol dizesi (kapısız çağrı) yok.
    for (const yol of Object.values(DOSYA)) {
      const yollu = kod(yol).filter(s => UC_YOLU.test(s));
      expect(yollu.length, gorece(yol)).toBeGreaterThan(0);
      expect(yollu.filter(s => !/'POST \/api\/mikro\/ebelge\/(gelen|giden|eirsaliye|pdf|xml)'/.test(s)), gorece(yol)).toEqual([]);
      expect(adet(kod(yol), "from '../lib/mikroUcKapilari'"), `${gorece(yol)}: ortak tablo içe aktarımı`).toBe(1);
    }
  });

  it('indirme servisini çağıran iki bileşen de düğmesini indirme ucunun kapısına bağlar', () => {
    const cagiran = kaynakDosyalari(SRC_KOK)
      .filter(y => y !== DOSYA.servis && oku(y).includes('eBelgeIndir') && kodSatirlari(y).some(s => /\beBelgeIndir\(/.test(s.kod)))
      .map(gorece)
      .sort();
    expect(cagiran).toEqual(['src/components/EBelgeMerkezi.tsx', 'src/components/MikroFaturaDetay.tsx']);
    for (const yol of [DOSYA.merkez, DOSYA.detay]) {
      const k = kod(yol);
      expect(adet(k, "const pdfIndirebilir = ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/pdf');"), gorece(yol)).toBe(1);
      expect(adet(k, "const xmlIndirebilir = ucKapisindanGecer(rol, 'POST /api/mikro/ebelge/xml');"), gorece(yol)).toBe(1);
      expect(adet(k, 'const rol = useAppStore(s => s.userRole);'), `${gorece(yol)}: rol küresel depodan`).toBe(1);
    }
    // Servis kapıyı isteği atmadan ÖNCE kendisi sorar (çağıran düğmeyi gizlemeyi unutsa da istek atılmaz).
    const servis = kod(DOSYA.servis);
    const kapi = servis.findIndex(s => s.includes('ucKapisindanGecer(useAppStore.getState().userRole, uc)'));
    const cagri = servis.findIndex(s => s.includes('await authFetch('));
    expect(kapi).toBeGreaterThan(-1);
    expect(cagri).toBeGreaterThan(kapi);
    expect(adet(servis, 'authFetch(')).toBe(1);
  });

  it('üç dosyada rol ADI ve sekme tablosu sorusu YOK — koşul yalnız ortak tablodan (İ4)', () => {
    const ROL_ADI = /['"`](Admin|Manager|Sales|Logistics|Accounting|HR|Purchasing|Legal|Corporate|Quality|B2B|Dealer)['"`]|\bUserRole\.|\bhasFullAccess\b|\b(STAFF|ADMIN|EXTERNAL)_ROLES\b/;
    for (const yol of Object.values(DOSYA)) expect(kod(yol).filter(s => ROL_ADI.test(s)), gorece(yol)).toEqual([]);
    // H1 / H6: yöne bağlı indirme kapısı yazılmadı.
    for (const yol of Object.values(DOSYA)) expect(kod(yol).filter(s => /EBELGE_INDIRME_KAPISI|eBelgeIndirebilir/.test(s)), gorece(yol)).toEqual([]);
    // Merkez'de üç çekme düğmesi: her biri koşul + tıklama olarak AYNI sabiti kullanır (koşulsuz düğme kalmadı).
    const merkez = kod(DOSYA.merkez);
    for (const ad of ['gelen', 'giden', 'eirsaliye']) {
      expect(adet(merkez, `{cekebilir(CEKIM_UCU.${ad}) && (`), ad).toBe(1);
      expect(merkez.filter(s => s.includes('onClick={() => cek(') && s.includes(`CEKIM_UCU.${ad},`)), ad).toHaveLength(1);
    }
    expect(adet(merkez, 'onClick={() => cek(')).toBe(3);
    expect(adet(merkez, '{pdfIndirebilir && mikroKaynakli && (belge.uuid || belge.belgeNo) && (')).toBe(1);
    expect(adet(merkez, '{xmlIndirebilir && mikroKaynakli && belge.uuid && (')).toBe(1);
  });
});
