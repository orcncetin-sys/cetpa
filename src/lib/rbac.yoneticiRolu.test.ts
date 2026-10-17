/**
 * rbac.yoneticiRolu.test.ts — «Yönetici rolüne yalnız Yönetici dokunur» (şartname «dış rol kapanışı» D11) ve iki adımlı doğrulama
 * sıfırlama kapısı (D10): saf karar işlevleri.
 *
 * NEDEN VAR: `requireAdmin` Yönetici + Müdür demektir; kullanıcı yönetimi uçları (`/api/admin/users`, `/api/admin/invite`) istenen /
 * hedef rolün `Admin` olup olmadığına bakmıyordu — Müdür kendine Yönetici rollü ikinci bir hesap açabiliyor, Yönetici'nin hesabını
 * silebiliyordu. Karar burada, uçlara BAĞLANTISI gerçek zincirde sınanır (server/kucukKapanislar.zincir.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { ADMIN_ROLES, APP_ROLES, EXTERNAL_ROLES, STAFF_ROLES, yalnizYoneticiMi, yoneticiRoluneDokunabilir, type AppRole } from './rbac';

const YONETICI_OLMAYAN: readonly AppRole[] = APP_ROLES.filter(r => r !== 'Admin');

describe('yalnizYoneticiMi — YALNIZ Yönetici ya da süper yönetici', () => {
  it('Yönetici geçer; başka HİÇBİR rol geçmez (Müdür dâhil)', () => {
    expect(yalnizYoneticiMi('Admin', false)).toBe(true);
    expect(YONETICI_OLMAYAN.filter(r => yalnizYoneticiMi(r, false))).toEqual([]);
    expect(YONETICI_OLMAYAN).toContain('Manager');                       // Müdür bu kümede: `requireAdmin`'den AYRIŞAN nokta
    expect(ADMIN_ROLES).toContain('Manager');
    expect(YONETICI_OLMAYAN).toHaveLength(STAFF_ROLES.length + EXTERNAL_ROLES.length - 1);
  });

  it('rolsüz hesap geçmez', () => {
    expect(yalnizYoneticiMi(null, false)).toBe(false);
  });

  it('süper yönetici rolü ne olursa olsun geçer (rolsüz de)', () => {
    expect(yalnizYoneticiMi(null, true)).toBe(true);
    for (const r of APP_ROLES) expect(yalnizYoneticiMi(r, true), r).toBe(true);
  });
});

describe('yoneticiRoluneDokunabilir — ilgili rol `Admin` ise yalnız Yönetici / süper yönetici', () => {
  it('ilgili rol `Admin`: Yönetici ve süper yönetici dokunur; Müdür ve diğer roller dokunamaz', () => {
    expect(yoneticiRoluneDokunabilir('Admin', false, 'Admin')).toBe(true);
    expect(yoneticiRoluneDokunabilir('Manager', true, 'Admin')).toBe(true);
    expect(yoneticiRoluneDokunabilir(null, true, 'Admin')).toBe(true);
    expect(YONETICI_OLMAYAN.filter(r => yoneticiRoluneDokunabilir(r, false, 'Admin'))).toEqual([]);
    expect(yoneticiRoluneDokunabilir(null, false, 'Admin')).toBe(false);
  });

  it('ilgili rol `Admin` DEĞİLSE karar bu işlevin değil: her çağıran için `true` (Müdür\'ün diğer rollerdeki yönetimi değişmez)', () => {
    for (const ilgili of YONETICI_OLMAYAN) {
      for (const cagiran of [...APP_ROLES, null]) expect(yoneticiRoluneDokunabilir(cagiran, false, ilgili), `${cagiran} → ${ilgili}`).toBe(true);
    }
  });

  it('ilgili rol ham değerdir: yalnız TAM `Admin` dizgisi Yönetici sayılır (rol okuyan her yer de tam eşleşmeyle karar verir)', () => {
    for (const ham of [undefined, null, '', 1, 'admin', 'ADMIN', ' Admin', 'Admin ', ['Admin'], { role: 'Admin' }]) {
      expect(yoneticiRoluneDokunabilir('Manager', false, ham), JSON.stringify(ham)).toBe(true);
    }
    expect(yoneticiRoluneDokunabilir('Manager', false, 'Admin')).toBe(false);
  });
});
