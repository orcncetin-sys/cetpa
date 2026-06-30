import { describe, it, expect } from 'vitest';
import { isAllowed, isSelfDocAccess, blocksRoleEscalation } from './rbac';

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

  it('B2B/Dealer sipariş yazabilir, diğerlerinde yalnız okuyabilir', () => {
    expect(isAllowed('B2B', 'inventory', 'read')).toBe(true);
    expect(isAllowed('B2B', 'inventory', 'write')).toBe(false);
    expect(isAllowed('Dealer', 'orders', 'write')).toBe(true);
    expect(isAllowed('Dealer', 'orders', 'delete')).toBe(false);
  });

  it('B2B/Dealer fiyat listesi/override YAZAMAZ (kendine indirim açığı kapalı)', () => {
    // Fiyatları okuyabilir ama değiştiremez — aksi halde kendine indirim tanımlar
    expect(isAllowed('B2B', 'priceLists', 'read')).toBe(true);
    expect(isAllowed('B2B', 'priceLists', 'write')).toBe(false);
    expect(isAllowed('Dealer', 'priceLists', 'write')).toBe(false);
    expect(isAllowed('B2B', 'priceOverrides', 'write')).toBe(false);
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
