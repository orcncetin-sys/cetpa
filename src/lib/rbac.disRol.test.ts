/**
 * rbac.disRol.test.ts — «dış rol (B2B / Bayi) hesabına yalnız Yönetici dokunur» (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K3 / H6): saf karar işlevi `disRolHesabinaDokunabilir` ve ret gövdesi.
 *
 * Uçlara BAĞLANTISI (Müdür dış rol hesabı açamaz / silemez / belgesini yazamaz) gerçek zincirde sınanır
 * (server/magazaBayi.zincir.test.ts «Yönetim»). `yoneticiRoluneDokunabilir` DEĞİŞMEDİ (rbac.yoneticiRolu.test.ts aynen geçer).
 */
import { describe, it, expect } from 'vitest';
import {
  APP_ROLES, DIS_ROL_DAVETLE_ACILMAZ_YANITI, DIS_ROL_YONETICI_GEREKLI_YANITI, EXTERNAL_ROLES, STAFF_ROLES, YONETICI_GEREKLI_YANITI,
  disRolDegeriMi, disRolHesabinaDokunabilir, type AppRole,
} from './rbac';

const YONETICI_OLMAYAN: readonly AppRole[] = APP_ROLES.filter(r => r !== 'Admin');

describe('disRolHesabinaDokunabilir — ilgili rol dış rolse YALNIZ Yönetici / süper yönetici', () => {
  it('Müdür, öteki iç roller, dış roller ve rolsüz × {B2B, Dealer} → false', () => {
    expect(YONETICI_OLMAYAN).toContain('Manager');
    for (const ilgili of EXTERNAL_ROLES) {
      for (const cagiran of [...YONETICI_OLMAYAN, null]) {
        expect(disRolHesabinaDokunabilir(cagiran, false, ilgili), `${cagiran} → ${ilgili}`).toBe(false);
      }
    }
  });

  it('Yönetici ve süper yönetici (rolü ne olursa olsun, rolsüz dâhil) → true', () => {
    for (const ilgili of EXTERNAL_ROLES) {
      expect(disRolHesabinaDokunabilir('Admin', false, ilgili)).toBe(true);
      for (const cagiran of [...APP_ROLES, null]) expect(disRolHesabinaDokunabilir(cagiran, true, ilgili), `süper ${cagiran}`).toBe(true);
    }
  });

  it('ilgili rol iç rol ya da bozuk değer (\'dealer\', \' B2B\', undefined, [\'Dealer\'] …) → karar bu işlevin değil: true', () => {
    for (const ilgili of [...STAFF_ROLES, 'dealer', ' B2B', 'B2B ', 'DEALER', undefined, null, '', 1, ['Dealer'], { role: 'Dealer' }] as unknown[]) {
      for (const cagiran of [...APP_ROLES, null]) {
        expect(disRolHesabinaDokunabilir(cagiran, false, ilgili), `${cagiran} → ${JSON.stringify(ilgili)}`).toBe(true);
      }
    }
  });

  it('disRolDegeriMi: yalnız TAM `B2B` / `Dealer` dizgesi', () => {
    for (const r of EXTERNAL_ROLES) expect(disRolDegeriMi(r)).toBe(true);
    for (const r of [...STAFF_ROLES, 'b2b', 'Dealer ', null, undefined, 0, ['B2B']] as unknown[]) expect(disRolDegeriMi(r), JSON.stringify(r)).toBe(false);
  });

  it('ret gövdeleri: dış rol yönetimi `YONETICI_GEREKLI` koduyla (istemci aynı kodla tanır), metni AYRI; davet reddi kendi kodu', () => {
    expect(DIS_ROL_YONETICI_GEREKLI_YANITI).toEqual({ success: false, error: 'Müşteri (B2B / Bayi) hesaplarını yalnız Yönetici yönetebilir.', code: 'YONETICI_GEREKLI' });
    expect(DIS_ROL_YONETICI_GEREKLI_YANITI.code).toBe(YONETICI_GEREKLI_YANITI.code);
    expect(DIS_ROL_YONETICI_GEREKLI_YANITI.error).not.toBe(YONETICI_GEREKLI_YANITI.error);
    expect(DIS_ROL_DAVETLE_ACILMAZ_YANITI).toEqual({
      success: false, code: 'DIS_ROL_DAVETLE_ACILMAZ',
      error: 'Müşteri / bayi hesabı davetle açılmaz; «Kullanıcı Ekle (manuel)» ile açın ve cari seçin.',
    });
  });
});
