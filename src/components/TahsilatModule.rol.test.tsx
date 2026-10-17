/**
 * TahsilatModule.rol.test.tsx — ödeme kaydındaki SESSİZ Mikro tahsilat gönderiminin rol kapısı
 * (karar turu 2026-10-11 — K9, İ3; şartname `.wf/SARTNAME-mikro-rol-kapisi.md` § 10.1 K9, § 10.4 H7).
 *
 * Ödeme kaydedilince ekran, kayıt bir Mikro carisine bağlıysa `POST /api/mikro/tahsilat/kaydet` ucuna sessizce istek
 * atar (yanıtı okumaz). Ucun kapısı kasa hareketi yazma kuralıdır; geçemeyen rolde istek 403 alır ve kimse görmez.
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   1. Rol ucun kapısından geçemiyorsa istek HİÇ atılmaz (12 rolün hepsi); geçen küme ELLE yazılı (§ 10.1 K9).
 *   2. Cetpa tarafındaki ödeme kaydı rolden BAĞIMSIZ yazılır (kapı yalnız Mikro gönderimini keser, ödemeyi değil).
 *   3. Mikro carisine bağlı olmayan kayıtta geçen rolde de istek atılmaz (eski davranış korunur).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TahsilatModule from './TahsilatModule';
import { useAppStore } from '../store/appStore';
import { UserRole } from '../types';
import { APP_ROLES } from '../lib/rbac';
import { ucKapisindanGecer } from '../lib/mikroUcKapilari';
import { authFetch } from '../services/authFetch';
import { addDoc, updateDoc } from '../lib/dbClient';
import { sifirla, koleksiyonAyarla } from '../hooks/useArkaPlanIsi.testDuzenegi';

vi.mock('../lib/dbClient', async () => ({
  ...(await import('../hooks/useArkaPlanIsi.testDuzenegi')).dbClientSahtesi,
  addDoc: vi.fn(() => Promise.resolve({ id: 'odeme-1' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'şimdi'),
}));
vi.mock('../services/authFetch', () => ({ authFetch: vi.fn() }));

const istek = vi.mocked(authFetch);
const yaz = vi.mocked(addDoc);
const guncelle = vi.mocked(updateDoc);
const ROLLER = Object.values(UserRole);
/** § 10.1 K9 «Geçen roller» — ELLE (kapı bu turda DEĞİŞMEDİ; Satış'a tahsilat gönderimi açılmaz). */
const GECEN: UserRole[] = [UserRole.Admin, UserRole.Manager, UserRole.Accounting];
const UC = '/api/mikro/tahsilat/kaydet';

const KAYIT = {
  musteriAdi: 'Şahin Yapı', belgeTipi: 'Fatura', belgeNo: 'F-2026-001', toplamTutar: 1000, tahsilEdilen: 0,
  vadeTarihi: '2026-12-31', faturaTarihi: '2026-10-01', durum: 'Bekliyor', notlar: '', faizOrani: 0, currency: 'TRY',
};
const bekle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

/** Ekranı çizer, kaydın «Tahsilat Ekle» düğmesine basar, tutarı yazar ve «Ödeme Kaydet»e basar. */
async function odemeKaydet(rol: UserRole, kayit: Record<string, unknown>) {
  koleksiyonAyarla('tahsilatKayitlari', [{ id: 'k1', veri: kayit }]);
  useAppStore.setState({ userRole: rol });
  const { container } = render(<TahsilatModule currentLanguage="tr" isAuthenticated />);
  await bekle();
  fireEvent.click(screen.getByTitle('Tahsilat Ekle'));
  await bekle();
  const tutar = container.querySelector('input[type="number"][step="0.01"]');
  if (!tutar) throw new Error('tutar girişi bulunamadı');
  fireEvent.change(tutar, { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: /Ödeme Kaydet/ }));
  await bekle();
}
const mikroIstekleri = () => istek.mock.calls.filter(c => String(c[0]) === UC);

beforeEach(() => {
  sifirla();
  istek.mockReset();
  istek.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));
  yaz.mockClear();
  guncelle.mockClear();
});
afterEach(() => { useAppStore.setState({ userRole: UserRole.Sales }); });

describe('TahsilatModule — sessiz Mikro tahsilat gönderimi rol kapısına bağlı (K9)', () => {
  it('rol listesi rbac ile aynı küme (test rollerin TAMAMINI dolaşıyor)', () => {
    expect([...ROLLER].sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(ROLLER)('%s — Mikro carisine bağlı kayıtta istek yalnız kapıdan geçen rolde atılır; ödeme her rolde Cetpa\'ya yazılır', async rol => {
    await odemeKaydet(rol, { ...KAYIT, mikroCariKod: '120.01.001' });
    const gecer = GECEN.includes(rol);
    expect(ucKapisindanGecer(rol, 'POST /api/mikro/tahsilat/kaydet'), 'elle yazılan küme ortak tabloyla aynı').toBe(gecer);
    expect(mikroIstekleri()).toHaveLength(gecer ? 1 : 0);
    // Cetpa defteri rolden bağımsız: ödeme satırı + kaydın tahsil edilen tutarı.
    expect(yaz).toHaveBeenCalledTimes(1);
    expect(yaz.mock.calls[0][1]).toMatchObject({ kaydiId: 'k1', tutar: 250 });
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][1]).toEqual({ tahsilEdilen: 250, durum: 'Kısmi Tahsilat' });
    expect(screen.getByText('Ödeme kaydedildi.')).toBeInTheDocument();
  });

  it('geçen rolde gövde: cari kodu, tutar, tarih ve tahsilat tipi', async () => {
    await odemeKaydet(UserRole.Accounting, { ...KAYIT, mikroCariKod: '120.01.001' });
    const [cagri] = mikroIstekleri();
    expect(cagri[1]?.method).toBe('POST');
    expect(JSON.parse(String(cagri[1]?.body))).toMatchObject({ tahsilat: { cariKod: '120.01.001', tutar: 250, tip: 'tahsilat' } });
  });

  it('Satış (K9: tahsilat gönderimi açılmaz): istek atılsaydı 403 dönerdi — atılmaz', async () => {
    istek.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: 'Bu veri için yetkiniz yok.' }), { status: 403 })));
    await odemeKaydet(UserRole.Sales, { ...KAYIT, cariKod: '120.01.002' });   // ikinci alan adı da aynı kapıdan geçer
    expect(mikroIstekleri()).toEqual([]);
    expect(istek).not.toHaveBeenCalled();
  });

  it('Mikro carisine bağlı OLMAYAN kayıtta geçen rolde de istek atılmaz', async () => {
    await odemeKaydet(UserRole.Admin, KAYIT);
    expect(mikroIstekleri()).toEqual([]);
    expect(yaz).toHaveBeenCalledTimes(1);
  });
});
