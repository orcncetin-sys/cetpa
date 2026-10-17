/**
 * EBelgeDurumKarti.test.tsx — Pano'daki «E-Belge» kartı sekmeye erişemeyen rolde ÇİZİLMEZ (rol kararları inceleme
 * düzeltmesi, 2026-10-17; H2 / İ3).
 *
 * Bulgu: H2'den sonra Satış ve Lojistik e-Belge sekmesini kaybetti, ama panodaki kart koşulsuz çiziliyordu; tıklama
 * App.tsx'in sessiz geri çevirmesine düşüyordu (ölü giriş). Kart artık `canAccess('ebelge')` sorar.
 *
 * Erişim kümesi ELLE yazılmaz: App.tsx TAB_PERMISSIONS'taki `ebelge` satırından okunur ve App.tsx'teki `canAccess`
 * gövdesiyle (tam ∪ salt okunur) aynı kuralla kurulur — gövde de aşağıda kilitlidir. Bileşen GERÇEKTEN çizilir.
 * Çit: kart panoda tek yerde, `canAccess` panoya App.tsx'ten geçer, nitelik iki katmanda da ZORUNLU.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EBelgeDurumKarti from './EBelgeDurumKarti';
import { UserRole } from '../../types';
import { APP_ROLES, type AppRole } from '../../lib/rbac';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

const APP = kodSatirlari(join(SRC_KOK, 'App.tsx')).map(s => s.kod.trim());
const PANO = kodSatirlari(join(SRC_KOK, 'pages', 'DashboardPage.tsx')).map(s => s.kod.trim());
const KART = kodSatirlari(join(SRC_KOK, 'components', 'pano', 'EBelgeDurumKarti.tsx')).map(s => s.kod.trim());
const adet = (satirlar: string[], parca: string): number => satirlar.filter(k => k.includes(parca)).length;

/** App.tsx TAB_PERMISSIONS'tan bir sekmenin tam + salt okunur rolleri. Satır bulunamazsa fırlatır. */
function sekmeRolleri(sekme: string): { full: string[]; readonly: string[] } {
  const bas = APP.indexOf('const TAB_PERMISSIONS: Record<string, { full: UserRole[]; readonly: UserRole[] }> = {');
  if (bas < 0) throw new Error('App.tsx: TAB_PERMISSIONS bulunamadı');
  const bit = APP.indexOf('};', bas);
  const satir = APP.slice(bas + 1, bit).find(k => k.startsWith(`${sekme}:`));
  const m = satir && /\{\s*full:\s*\[([^\]]*)\],\s*readonly:\s*\[([^\]]*)\]\s*\}/.exec(satir);
  if (!m) throw new Error(`App.tsx TAB_PERMISSIONS: '${sekme}' satırı okunamadı`);
  const roller = (liste: string): string[] => [...liste.matchAll(/UserRole\.(\w+)/g)].map(x => {
    const deger = UserRole[x[1] as keyof typeof UserRole];
    if (deger === undefined) throw new Error(`UserRole.${x[1]} tanımsız`);
    return deger;
  });
  return { full: roller(m[1]), readonly: roller(m[2]) };
}
/** App.tsx `canAccess` kuralı (gövdesi aşağıda kilitli): tablo satırı yoksa izin, varsa tam ∪ salt okunur. */
const canAccessRol = (rol: AppRole) => (tab: string): boolean => {
  const izin = sekmeRolleri(tab);
  return izin.full.includes(rol) || izin.readonly.includes(rol);
};
const kart = () => screen.queryByRole('button', { name: /E-Belge/ });

describe('Pano «E-Belge» kartı — sekmeye erişen rolde çizilir, kilitli rolde çizilmez', () => {
  it('her rolde: kart ⇔ App.tsx `ebelge` sekme erişimi; H2 kümesi Yönetici / Müdür / Muhasebe, Satış ve Lojistik kilitli', () => {
    const izin = sekmeRolleri('ebelge');
    const gecen = APP_ROLES.filter(r => izin.full.includes(r) || izin.readonly.includes(r));
    expect([...gecen].sort()).toEqual(['Accounting', 'Admin', 'Manager']);
    for (const rol of APP_ROLES) {
      render(<EBelgeDurumKarti canAccess={canAccessRol(rol)} setActiveTab={() => {}} gibConnected={false} currentLanguage="tr" />);
      expect(kart() !== null, `${rol} — kart çizilir mi`).toBe(gecen.includes(rol));
      cleanup();
    }
  });

  it('geçen rolde kart e-Belge sekmesini açar; kilitli rolde DOM boş (tıklanacak bir şey yok)', () => {
    const ac = vi.fn();
    render(<EBelgeDurumKarti canAccess={canAccessRol('Accounting')} setActiveTab={ac} gibConnected currentLanguage="tr" />);
    const dugme = kart();
    expect(dugme).not.toBeNull();
    expect(dugme?.textContent).toContain('GIB Bağlı');
    if (dugme) fireEvent.click(dugme);
    expect(ac).toHaveBeenCalledWith('ebelge');
    cleanup();

    for (const rol of ['Sales', 'Logistics'] as const) {
      const { container } = render(<EBelgeDurumKarti canAccess={canAccessRol(rol)} setActiveTab={ac} gibConnected currentLanguage="tr" />);
      expect(container.innerHTML, rol).toBe('');
      cleanup();
    }
    expect(ac).toHaveBeenCalledTimes(1);
  });

  it('kart koşulu sekme tablosundan sorar: `canAccess` yalnız `ebelge` ile çağrılır', () => {
    const sor = vi.fn((_tab: string) => true);
    render(<EBelgeDurumKarti canAccess={sor} setActiveTab={() => {}} gibConnected={false} currentLanguage="en" />);
    expect(sor.mock.calls.map(c => c[0])).toEqual(['ebelge']);
    expect(screen.queryByRole('button', { name: /E-Doc/ })).not.toBeNull();
  });

  it('çit: kart panoda TEK yerde, `canAccess` App.tsx → pano → kart zincirinde ZORUNLU; App.tsx `canAccess` gövdesi bu testin kuralı', () => {
    // Kart: zorunlu nitelik + ilk satırda koşul (rol adı yok).
    expect(adet(KART, 'canAccess: (tab: string) => boolean;')).toBe(1);
    expect(adet(KART, 'canAccess?:')).toBe(0);
    expect(KART.filter(k => k.startsWith('if (!canAccess('))).toEqual(["if (!canAccess('ebelge')) return null;"]);
    expect(KART.filter(k => /UserRole|userRole|'Sales'|'Logistics'/.test(k))).toEqual([]);
    // Pano: zorunlu nitelik, kart tek yerde ve `canAccess` geçiriliyor; eski satır içi kart KALMADI.
    expect(adet(PANO, 'canAccess: (tab: string) => boolean;')).toBe(1);
    expect(adet(PANO, 'canAccess?:')).toBe(0);
    expect(PANO.filter(k => k.includes('<EBelgeDurumKarti'))).toEqual([
      '<EBelgeDurumKarti canAccess={canAccess} setActiveTab={setActiveTab} gibConnected={gibConnected} currentLanguage={currentLanguage} />',
    ]);
    expect(adet(PANO, "setActiveTab('ebelge')")).toBe(0);
    // App.tsx: panonun TEK çağrı yeri `canAccess`'i geçirir; `canAccess` gövdesi tam ∪ salt okunur.
    expect(adet(APP, '<DashboardPage')).toBe(1);
    const cagri = APP.indexOf('<DashboardPage');
    const kapanis = APP.indexOf('/>', cagri);
    expect(APP.slice(cagri, kapanis + 1).filter(k => k.startsWith('canAccess='))).toEqual(['canAccess={canAccess}']);
    const govde = APP.indexOf('const canAccess = (tab: string) => {');
    expect(govde).toBeGreaterThan(0);
    expect(APP.slice(govde + 1, govde + 4)).toEqual([
      'const perms = TAB_PERMISSIONS[tab];',
      'if (!perms) return true;',
      'return perms.full.includes(userRole) || perms.readonly.includes(userRole);',
    ]);
  });
});
