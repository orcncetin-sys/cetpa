import { describe, it, expect } from 'vitest';
import { APP_ROLES, hasExplicitRule, isAllowed, isSelfDocAccess, blocksRoleEscalation } from './rbac';

describe('isAllowed — RBAC politikası', () => {
  it('Admin her koleksiyonda her işlemi yapabilir', () => {
    for (const coll of ['orders', 'users', 'settings', 'auditLog', 'leads']) {
      for (const op of ['read', 'write', 'delete'] as const) {
        expect(isAllowed('Admin', coll, op)).toBe(true);
      }
    }
  });

  it('rolsüz (null) kullanıcı hiçbir şeye erişemez', () => {
    expect(isAllowed(null, 'orders', 'read')).toBe(false);
    expect(isAllowed(null, 'orders', 'write')).toBe(false);
  });

  it('personel iş koleksiyonlarını okuyup yazabilir ama silemez', () => {
    expect(isAllowed('Sales', 'orders', 'read')).toBe(true);
    expect(isAllowed('Sales', 'orders', 'write')).toBe(true);
    expect(isAllowed('Sales', 'orders', 'delete')).toBe(false); // silme yalnız Admin/Manager
  });

  it('Manager iş koleksiyonlarında silme yapabilir', () => {
    expect(isAllowed('Manager', 'orders', 'delete')).toBe(true);
  });

  it('hassas koleksiyonlar (users/settings) yalnız Admin/Manager', () => {
    expect(isAllowed('Sales', 'users', 'read')).toBe(false);
    expect(isAllowed('Sales', 'settings', 'write')).toBe(false);
    expect(isAllowed('Manager', 'users', 'read')).toBe(true);
    expect(isAllowed('Manager', 'settings', 'write')).toBe(true);
  });

  it('subscriptions/paymentHistory yalnız Admin/Manager', () => {
    expect(isAllowed('Accounting', 'subscriptions', 'read')).toBe(false);
    expect(isAllowed('Accounting', 'paymentHistory', 'read')).toBe(false);
    expect(isAllowed('Manager', 'subscriptions', 'read')).toBe(true);
  });

  // 2026-10-11 (dış rol kapanışı, D1) — YENİDEN SABİTLENDİ. Eski beklenti: «B2B / Bayi sipariş yazar, stok kartını ve fiyat listesini
  // okur». O kural stok kartını alış maliyeti ve tedarikçisiyle, kiracının BÜTÜN müşterilerinin tekliflerini dış role açıyordu.
  // Tam çit (dış rol × HER koleksiyon × her işlem) rbac.disRol.degismez.test.ts'te; burada eski örneklerin YENİ değeri duruyor.
  it('B2B / Bayi ERP verisinde HİÇBİR şey okuyamaz, yazamaz, silemez (eskiden okunan / yazılan koleksiyonlar dâhil)', () => {
    for (const rol of ['B2B', 'Dealer'] as const) {
      for (const coll of ['inventory', 'orders', 'quotations', 'priceLists', 'priceOverrides', 'recurringOrders', 'commissionRules', 'cpqQuotes', 'documentTemplates']) {
        for (const op of ['read', 'write', 'delete'] as const) {
          expect(isAllowed(rol, coll, op), `${rol} ${coll} ${op}`).toBe(false);
        }
      }
    }
  });

  it('dış rol: kuralsız koleksiyon yedeği, kullanıcı kapsamlı koleksiyon ve herkese açık form da kapalı; iç rol ve kimliksiz ziyaretçi eskisi gibi', () => {
    // Yedek dal eskiden dış role OKUMA veriyordu (tabloya yazılmamış her koleksiyon bayiye açıktı).
    expect(isAllowed('Dealer', 'olmayan_koleksiyon', 'read')).toBe(false);
    expect(isAllowed('Sales', 'olmayan_koleksiyon', 'read')).toBe(true);
    expect(isAllowed('Sales', 'olmayan_koleksiyon', 'write')).toBe(false);
    // Kullanıcı kapsamlı: akış bu işlevle karar verir — dış role açık kalsaydı etiketsiz bildirimler akıştan okunurdu.
    expect(isAllowed('B2B', 'notifications', 'read')).toBe(false);
    expect(isAllowed('B2B', 'userPrefs', 'write')).toBe(false);
    expect(isAllowed('Quality', 'notifications', 'read')).toBe(true);
    expect(isAllowed('HR', 'userPrefs', 'write')).toBe(true);
    // Herkese açık form: kimliksiz ziyaretçi (rol null) yazar; dış ROL taşıyan hesap tablodan izin alamaz.
    expect(isAllowed(null, 'demoRequests', 'write')).toBe(true);
    expect(isAllowed('Sales', 'demoRequests', 'write')).toBe(true);
    expect(isAllowed('Dealer', 'demoRequests', 'write')).toBe(false);
  });

  it('rol alanındaki GEÇERSİZ değer (sayı, uydurma dizge) hiçbir koleksiyonu açmaz — kullanıcı kapsamlı olanı da', () => {
    // `/increment` ile `role: 1` yazılabiliyordu ve «null olmayan her rol» kullanıcı kapsamlı dalı açıyordu (tarama 2026-10-11, bulgu 27).
    for (const cop of [1, 'Accountant', 'admin', true] as unknown[]) {
      const rol = cop as Parameters<typeof isAllowed>[0];
      for (const coll of ['notifications', 'userPrefs', 'aiConsents', 'userOnboarding', 'inventory', 'olmayan_koleksiyon', 'users']) {
        expect(isAllowed(rol, coll, 'read'), `${String(cop)} ${coll}`).toBe(false);
      }
    }
  });

  it('append-only koleksiyonlar: yazma var, okuma yalnız Admin, güncelleme/silme yok', () => {
    // personel ekleyebilir
    expect(isAllowed('Sales', 'auditLog', 'write')).toBe(true);
    expect(isAllowed('Sales', 'syncLog', 'write')).toBe(true);
    // ama güncelleme/silme kimseye yok (Admin hariç)
    expect(isAllowed('Sales', 'auditLog', 'delete')).toBe(false);
    expect(isAllowed('Manager', 'auditLog', 'delete')).toBe(false);
    expect(isAllowed('Manager', 'clientErrors', 'delete')).toBe(false);
    // okuma yalnız Admin/Manager
    expect(isAllowed('Admin', 'auditLog', 'read')).toBe(true);
    expect(isAllowed('Sales', 'auditLog', 'read')).toBe(false);
  });

  it('B2B append-only koleksiyona ne okuyabilir ne yazabilir', () => {
    expect(isAllowed('B2B', 'auditLog', 'write')).toBe(false);
    expect(isAllowed('B2B', 'auditLog', 'read')).toBe(false);
  });
});

// Karar turu 2026-10-11 (şartname mikro-rol-kapisi § 10.4, H2 / İ5 — «alış belgesi muhasebenindir»). Kullanıcı kararı:
// tedarikçi fatura numarasını Satış, Satın Alma ve Lojistik GÖRMEZ. `eBelgeler` gelen e-faturaları da taşır (belge no,
// gönderen unvan, VKN, tutar, ham Mikro satırı) — Satış bu koleksiyonu okuyabiliyordu; PDF / XML kapısı tek başına kapatmaz.
describe('eBelgeler — okuma yalnız Yönetici, Müdür, Muhasebe (H2 / İ5)', () => {
  const okuyan = (koleksiyon: string) => APP_ROLES.filter(r => isAllowed(r, koleksiyon, 'read')).sort();

  it('okuma kümesi tam olarak Admin, Manager, Accounting — `mikroFaturalar` okuma kümesiyle AYNI', () => {
    expect(okuyan('eBelgeler')).toEqual(['Accounting', 'Admin', 'Manager']);
    expect(okuyan('eBelgeler')).toEqual(okuyan('mikroFaturalar'));
  });

  it.each(['Sales', 'Purchasing', 'Logistics'] as const)('%s gelen e-fatura listesini OKUYAMAZ, yazamaz, silemez', (rol) => {
    expect(isAllowed(rol, 'eBelgeler', 'read')).toBe(false);
    expect(isAllowed(rol, 'eBelgeler', 'write')).toBe(false);
    expect(isAllowed(rol, 'eBelgeler', 'delete')).toBe(false);
  });

  it.each(['Admin', 'Manager', 'Accounting'] as const)('%s okur ve yazar (kimse kazara kilitlenmedi)', (rol) => {
    expect(isAllowed(rol, 'eBelgeler', 'read')).toBe(true);
    expect(isAllowed(rol, 'eBelgeler', 'write')).toBe(true);
  });

  it('diğer iç roller, dış roller ve rolsüz hesap okuyamaz; yazabilen her rol okur', () => {
    for (const rol of ['HR', 'Legal', 'Corporate', 'Quality', 'B2B', 'Dealer'] as const) expect(isAllowed(rol, 'eBelgeler', 'read'), rol).toBe(false);
    expect(isAllowed(null, 'eBelgeler', 'read')).toBe(false);
    expect(APP_ROLES.filter(r => isAllowed(r, 'eBelgeler', 'write') && !isAllowed(r, 'eBelgeler', 'read'))).toEqual([]);
  });

  it('kural AÇIK tanımlı (kuralsız koleksiyon varsayılana düşer — okuma iç ve dış rollerin tamamına açılırdı)', () => {
    expect(hasExplicitRule('eBelgeler')).toBe(true);
  });
});

describe('isSelfDocAccess — kendi kullanıcı dokümanı istisnası', () => {
  it('kullanıcı kendi users/{uid} dokümanını okuyup yazabilir', () => {
    expect(isSelfDocAccess('users', 'abc123', 'abc123', 'read')).toBe(true);
    expect(isSelfDocAccess('users', 'abc123', 'abc123', 'write')).toBe(true);
  });

  it('kendi dokümanını bile silemez', () => {
    expect(isSelfDocAccess('users', 'abc123', 'abc123', 'delete')).toBe(false);
  });

  it('başkasının dokümanına self-istisna uygulanmaz', () => {
    expect(isSelfDocAccess('users', 'other', 'abc123', 'read')).toBe(false);
  });

  it('users dışındaki koleksiyonlara uygulanmaz', () => {
    expect(isSelfDocAccess('orders', 'abc123', 'abc123', 'write')).toBe(false);
  });
});

describe('blocksRoleEscalation — yetki yükseltme engeli', () => {
  it('Admin olmayan kullanıcı users.role yazamaz', () => {
    expect(blocksRoleEscalation('users', 'Sales', { role: 'Admin' })).toBe(true);
    expect(blocksRoleEscalation('users', 'Manager', { role: 'Admin' })).toBe(true);
  });

  it('Admin rol atayabilir', () => {
    expect(blocksRoleEscalation('users', 'Admin', { role: 'Manager' })).toBe(false);
  });

  it('role alanı yoksa engel yok (profil senkronu serbest)', () => {
    expect(blocksRoleEscalation('users', 'Sales', { name: 'X', lastLogin: 1 })).toBe(false);
  });

  it('users dışı koleksiyonlarda role alanı engellenmez', () => {
    expect(blocksRoleEscalation('orders', 'Sales', { role: 'whatever' })).toBe(false);
  });
});
