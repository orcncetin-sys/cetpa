/**
 * rbac.ts — Sunucu tarafı rol bazlı erişim politikası (saf fonksiyonlar).
 *
 * server.ts bu modülü import eder; rol DB'den okunup buraya parametre olarak
 * geçilir. DB/IO içermez → birim testle kilitlenebilir (rbac.test.ts).
 */

export type AppRole = 'Admin' | 'Manager' | 'Sales' | 'Logistics' | 'Accounting'
  | 'HR' | 'Purchasing' | 'B2B' | 'Dealer' | 'Legal' | 'Corporate' | 'Quality';

export type DbOp = 'read' | 'write' | 'delete';

export const ADMIN_ROLES: AppRole[] = ['Admin', 'Manager'];
export const STAFF_ROLES: AppRole[] = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'Legal', 'Corporate', 'Quality'];
export const EXTERNAL_ROLES: AppRole[] = ['B2B', 'Dealer'];

/** Yalnız Admin/Manager'ın okuyup yazabileceği hassas koleksiyonlar. */
export const ADMIN_ONLY_COLLECTIONS = new Set(['users', 'settings', 'invites', 'subscriptions', 'paymentHistory']);
/** Append-only: yalnız ekleme (POST). Güncelleme/silme kimseye yok. */
export const APPEND_ONLY_COLLECTIONS = new Set(['auditLog', 'syncLog', 'clientErrors']);

/**
 * Verilen rolün, koleksiyon+operasyon için yetkili olup olmadığını döner.
 * role null ise (kayıtsız kullanıcı) her zaman false.
 */
export function isAllowed(role: AppRole | null, coll: string, op: DbOp): boolean {
  if (!role) return false;
  if (role === 'Admin') return true; // Admin her şeye yetkili

  // Append-only: güncelleme/silme kimseye yok (Admin hariç, yukarıda döndü)
  if (APPEND_ONLY_COLLECTIONS.has(coll) && op !== 'read') {
    return op === 'write' && STAFF_ROLES.includes(role); // yalnız POST (ekleme)
  }
  // Hassas koleksiyonlar: yalnız Admin/Manager
  if (ADMIN_ONLY_COLLECTIONS.has(coll)) return ADMIN_ROLES.includes(role);

  // Dış roller (B2B/Dealer): yalnız okuma
  if (EXTERNAL_ROLES.includes(role)) return op === 'read';

  // Personel rolleri: iş koleksiyonlarında okuma+yazma; silme yalnız Admin/Manager
  if (STAFF_ROLES.includes(role)) {
    if (op === 'delete') return ADMIN_ROLES.includes(role);
    return true;
  }
  return false;
}

/** Kullanıcının kendi users/{uid} dokümanına erişim istisnası (login senkronu). */
export function isSelfDocAccess(coll: string, docId: string | undefined, uid: string, op: DbOp): boolean {
  return coll === 'users' && !!docId && docId === uid && op !== 'delete';
}

/** Rol yükseltme engeli: users dokümanına 'role' yazımı yalnız Admin'e izinli. */
export function blocksRoleEscalation(coll: string, role: AppRole | null, body: Record<string, unknown>): boolean {
  if (coll !== 'users') return false;
  if (!('role' in body)) return false;
  return role !== 'Admin';
}
