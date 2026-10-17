/**
 * MusterilerTab.test.tsx — satırdaki «Mikro» (dekont) düğmesi yalnız dekont yöntem kapısından GEÇEN rolde çizilir
 * (karar turu 2026-10-11 — şartname § 10.1 K3-a / K2, İ3 «ölü düğme yok», İ4 «tek kaynak»).
 *
 * `DekontKaydetV2` cari borç / alacak yazar; kapısı `cari-hareket/kaydet` ile aynıdır (Yönetici, Müdür, Muhasebe).
 * Sekme CRM → Müşteriler'den de açılır: Satış ve Satın Alma düğmeyi görüyor, pencereyi açıyor, «Kaydet» 403 dönüyordu
 * (pencerenin açılıştaki `cari-hareket/turler` okuması da — K2). Düğme gizlenince pencere açılamaz: iki çağrı da yapılmaz.
 * Bileşenin rol niteliği yok; rol depodan, koşul sunucu kapısının okuduğu AYNI tablodan (`evrakKapisindanGecer`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MusterilerTab from './MusterilerTab';
import { ac } from '../../i18n/accounting';
import { useAppStore } from '../../store/appStore';
import { UserRole, type Customer } from '../../types';
import { APP_ROLES } from '../../lib/rbac';
import { evrakKapisindanGecer } from '../../lib/mikroEvrakKapilari';
import { ucKapisindanGecer } from '../../lib/mikroUcKapilari';
import { SRC_KOK, gorece, kaynakDosyalari, kodSatirlari, oku } from '../../test/kaynakTarama';

// Ekstre paneli bu testin konusu değil (yalnız ekstre açıkken çizilir); ağır bağımlılıklarını yüklemesin.
vi.mock('../CariEkstrePanel', () => ({ default: () => null }));

const DUGME = "Mikro'ya dekont/masraf gir";
const ROLLER = Object.values(UserRole);
const KODLU: Customer = { id: 'c1', name: 'KODLU YAPI', mikroCariKod: '120.01.001', balance: 1500 };
const KODSUZ: Customer = { id: 'c2', name: 'KODSUZ MÜŞTERİ', mikroCariKod: '', balance: 0 };
const rolKoy = (rol: unknown) => { act(() => { useAppStore.setState({ userRole: rol as UserRole }); }); };
const sirali = (a: readonly string[]): string[] => [...a].sort();

function ciz(musteriler: Customer[] = [KODLU, KODSUZ]) {
  const setDekontHedef = vi.fn();
  const bos = () => {};
  const sonuc = render(<MusterilerTab
    t={ac('tr')} currentLanguage="tr" customers={musteriler} displayedMusteriler={musteriler}
    customerSearch="" setCustomerSearch={bos} musteriSortKey="name" musteriSortDir="asc" toggleMusteriSort={bos}
    cariRol={() => null} setDekontHedef={setDekontHedef}
    showCustomerModal={false} setShowCustomerModal={bos} editingCustomer={null} setEditingCustomer={bos}
    customerForm={{ name: '', company: '', email: '', phone: '', address: '', taxNo: '', taxOffice: '', notes: '', creditLimit: null, balance: null, riskGroup: 'Düşük' }}
    setCustomerForm={bos} saveCustomer={bos} deleteCustomer={bos} ekstreMusteri={null} setEkstreMusteri={bos}
  />);
  return { ...sonuc, setDekontHedef };
}
/** Dekont düğmesini GERÇEKTEN çizen roller (her rol için ayrı çizim). */
const cizenRoller = (): UserRole[] => ROLLER.filter(rol => {
  rolKoy(rol);
  const { unmount } = ciz();
  const var_ = screen.queryAllByTitle(DUGME).length > 0;
  unmount();
  return var_;
});

afterEach(() => {
  cleanup();
  act(() => { useAppStore.setState(useAppStore.getInitialState(), true); });
});

describe('MusterilerTab — dekont «Mikro» düğmesi yalnız yöntem kapısından geçen rolde', () => {
  it('denenen rol listesi sunucunun rol listesiyle AYNI', () => {
    expect(sirali(ROLLER)).toEqual(sirali(APP_ROLES));
  });

  it('K3-a (ELLE): düğmeyi çizen roller TAM OLARAK Yönetici, Müdür, Muhasebe', () => {
    expect(sirali(cizenRoller())).toEqual(sirali([UserRole.Admin, UserRole.Manager, UserRole.Accounting]));
  });

  it('tek kaynak: HER rolde düğme çizilir ⇔ rol `DekontKaydetV2` kapısından geçer', () => {
    const cizen = new Set(cizenRoller());
    expect(ROLLER.filter(rol => cizen.has(rol) !== evrakKapisindanGecer(rol, 'DekontKaydetV2'))).toEqual([]);
  });

  it.each([UserRole.Sales, UserRole.Purchasing])('K3-a kilitli rol %s (CRM → Müşteriler\'i görür): düğme ÇİZİLMEZ; satırın öteki düğmeleri durur', rol => {
    rolKoy(rol);
    ciz();
    expect(screen.getByText('KODLU YAPI')).toBeInTheDocument();          // sekme ve satır çizildi (boş çizim yanlış yeşil vermesin)
    expect(screen.queryByTitle(DUGME)).toBeNull();
    expect(screen.queryByText('Mikro')).toBeNull();                       // düğmenin etiketi de yok
    expect(screen.getAllByTitle('Düzenle')).toHaveLength(2);              // ekstre / düzenle / sil yerinde
  });

  it.each([UserRole.Admin, UserRole.Manager, UserRole.Accounting])('geçen rol %s: düğme yalnız cari KODU olan satırda; tıklama dekont hedefini o cariyle açar', rol => {
    rolKoy(rol);
    const { setDekontHedef } = ciz();
    const dugmeler = screen.getAllByTitle(DUGME);
    expect(dugmeler).toHaveLength(1);                                     // kodu boş caride düğme HİÇ çıkmaz (dış sisteme tahmin kod gitmez)
    fireEvent.click(dugmeler[0]);
    expect(setDekontHedef).toHaveBeenCalledTimes(1);
    expect(setDekontHedef).toHaveBeenCalledWith({ cariKod: '120.01.001', ad: 'KODLU YAPI', bakiye: 1500, id: 'c1' });
  });

  it('kilitli rolde dekont hedefi HİÇ kurulmaz (pencere açılamaz → açılış okuması ve kayıt isteği yapılmaz)', () => {
    rolKoy(UserRole.Sales);
    const { setDekontHedef, container } = ciz();
    // Sekmedeki BÜTÜN düğmeler (CSV dışa aktarımı hariç: dosya indirme jsdom'da gezinmeye çalışır).
    const dugmeler = [...container.querySelectorAll('button')].filter(d => !d.textContent?.includes('CSV'));
    expect(dugmeler.length).toBeGreaterThanOrEqual(6);                    // iki satır × (ad, ekstre, düzenle, sil) + «ekle»
    for (const dugme of dugmeler) fireEvent.click(dugme);
    expect(setDekontHedef).not.toHaveBeenCalled();
  });

  it.each([['null', null], ['undefined', undefined], ['tanınmayan rol', 'Depocu']])('rolsüz / bozuk rol değeri (%s): düğme çizilmez', (_ad, rol) => {
    rolKoy(rol);
    ciz();
    expect(screen.getByText('KODLU YAPI')).toBeInTheDocument();
    expect(screen.queryByTitle(DUGME)).toBeNull();
  });

  it('yüklenmemiş rol: depo ilk durumundayken (profil gelmedi) düğme çizilmez', () => {
    ciz();                                                                // depoya hiç dokunulmadı
    expect(screen.getByText('KODLU YAPI')).toBeInTheDocument();
    expect(screen.queryByTitle(DUGME)).toBeNull();
  });

  it('rol değişince düğme yeniden değerlendirilir', () => {
    rolKoy(UserRole.Purchasing);
    ciz();
    expect(screen.queryByTitle(DUGME)).toBeNull();
    rolKoy(UserRole.Accounting);
    expect(screen.getAllByTitle(DUGME)).toHaveLength(1);
  });
});

describe('K2 — dekont penceresinin açılış okuması (`cari-hareket/turler`)', () => {
  it('düğmeyi gören HER rol pencerenin açılış okumasından da geçer (yazabilen türleri de okur — pencere «Türler alınamadı»ya düşmez)', () => {
    const goren = APP_ROLES.filter(rol => evrakKapisindanGecer(rol, 'DekontKaydetV2'));
    expect(goren.length).toBeGreaterThan(0);
    expect(goren.filter(rol => !ucKapisindanGecer(rol, 'GET /api/mikro/cari-hareket/turler'))).toEqual([]);
  });
});

// ── Kaynak çitleri ──────────────────────────────────────────────────────────
describe('ÇİT: dekont penceresine giden TEK yol bu düğme', () => {
  const yol = (...p: string[]) => join(SRC_KOK, ...p);
  const kod = (dosya: string) => kodSatirlari(dosya).map(s => s.kod).join('\n');
  const adet = (metin: string, parca: string) => metin.split(parca).length - 1;
  const uretim = kaynakDosyalari(SRC_KOK);
  const kodundaGeciren = (parca: string): string[] => uretim
    .filter(d => oku(d).includes(parca))
    .filter(d => kodSatirlari(d).some(s => s.kod.includes(parca)))
    .map(gorece);

  it('sekmede koşul ortak tablodan ve TEK yerde: rol depodan, yöntem `DekontKaydetV2`', () => {
    const k = kod(yol('components', 'accounting', 'MusterilerTab.tsx'));
    expect(adet(k, "const dekontGirebilir = evrakKapisindanGecer(useAppStore(s => s.userRole), 'DekontKaydetV2');")).toBe(1);
    expect(adet(k, 'if (!cariKod || !dekontGirebilir) return null;')).toBe(1);
    expect(adet(k, 'setDekontHedef({')).toBe(1);
    // Düğmenin tıklama işleyicisi koşuldan SONRA (koşulsuz ikinci bir açma yolu yok).
    expect(k.indexOf('setDekontHedef({')).toBeGreaterThan(k.indexOf('if (!cariKod || !dekontGirebilir) return null;'));
    // Bileşende rol adı YAZILMAZ (yorumlar hariç).
    expect(APP_ROLES.filter(r => new RegExp(`['"\`]${r}['"\`]`).test(k))).toEqual([]);
  });

  it('düğmenin sorduğu yöntem = pencerenin GÖNDERDİĞİ yöntem (ayrışırlarsa düğme başka kapıya bakar)', () => {
    const k = kod(yol('components', 'DekontModal.tsx'));
    expect(adet(k, 'pushMikroEvrak(')).toBe(1);
    expect(adet(k, "pushMikroEvrak('DekontKaydetV2'")).toBe(1);
  });

  it('pencere TEK yerde çizilir, hedefi YALNIZ bu sekme kurar; açılış okumasının (K2) tek çağıranı pencere', () => {
    expect(kodundaGeciren('<DekontModal')).toEqual(['src/components/AccountingModule.tsx']);
    expect(kodundaGeciren('setDekontHedef({')).toEqual(['src/components/accounting/MusterilerTab.tsx']);
    // Açan bileşen hedefi yalnız kapatmak için sıfırlar ve sekmeye olduğu gibi geçirir.
    const acan = kod(yol('components', 'AccountingModule.tsx'));
    expect(adet(acan, 'setDekontHedef(')).toBe(adet(acan, 'setDekontHedef(null)'));
    expect(adet(acan, 'setDekontHedef={setDekontHedef}')).toBe(1);
    expect(kodundaGeciren('/api/mikro/cari-hareket/turler').filter(d => !d.startsWith('src/server/') && d !== 'src/lib/mikroUcKapilari.ts'))
      .toEqual(['src/components/DekontModal.tsx']);
  });
});
