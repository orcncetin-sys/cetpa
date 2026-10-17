// @vitest-environment node
/**
 * kullaniciSayimi.test.ts — `GET /api/ops/sir-tani` → `kullanici` bloğunun sayımı (şartname «dış rol kapanışı» D6 / T5).
 * Saf işlev gerçek gövdesiyle koşar; uca bağlantısı `routes/opsRoutes.sirTani.test.ts` ve gerçek zincirde
 * (`kucukKapanislar.zincir.test.ts`) sınanır.
 */
import { describe, it, expect } from 'vitest';
import { kullaniciSayimi } from './kullaniciSayimi.js';
import { EXTERNAL_ROLES, STAFF_ROLES } from '../lib/rbac.js';

describe('kullaniciSayimi', () => {
  it('boş koleksiyon: sıfırlar ve `null` (uydurma tarih yok)', () => {
    expect(kullaniciSayimi([])).toEqual({ toplam: 0, rolsuz: 0, disRol: { B2B: 0, Dealer: 0 }, disRolSonGiris: null });
  });

  it('dış rol anahtarları `EXTERNAL_ROLES`\'tan türer (küme büyürse blok da büyür)', () => {
    expect(Object.keys(kullaniciSayimi([]).disRol).sort()).toEqual([...EXTERNAL_ROLES].map(String).sort());
  });

  it('iç roller ne rolsüz ne dış rol sayılır; toplam hepsini sayar', () => {
    const s = kullaniciSayimi(STAFF_ROLES.map(rol => ({ rol, sonGiris: '2026-10-01T08:00:00.000Z' })));
    expect(s).toEqual({ toplam: STAFF_ROLES.length, rolsuz: 0, disRol: { B2B: 0, Dealer: 0 }, disRolSonGiris: null });
  });

  it('rolsüz = rol alanı yok / boş / geçersiz değer (sayı, uydurma dizge, yanlış harf)', () => {
    const s = kullaniciSayimi([
      { rol: undefined, sonGiris: undefined }, { rol: null, sonGiris: null }, { rol: '', sonGiris: null }, { rol: 1, sonGiris: null },
      { rol: 'user', sonGiris: null }, { rol: 'admin', sonGiris: null }, { rol: 'Viewer', sonGiris: null }, { rol: ['Admin'], sonGiris: null },
      { rol: 'Admin', sonGiris: null },
    ]);
    expect([s.toplam, s.rolsuz]).toEqual([9, 8]);
  });

  it('dış roller ayrı ayrı sayılır; en yeni giriş YALNIZ dış rol hesaplarından alınır', () => {
    const s = kullaniciSayimi([
      { rol: 'Dealer', sonGiris: { _seconds: 1_760_000_000, _nanoseconds: 0 } },            // 2025-10-09T08:53:20Z
      { rol: 'Dealer', sonGiris: '2026-03-01T10:00:00.000Z' },
      { rol: 'B2B', sonGiris: { seconds: 1_700_000_000 } },
      { rol: 'Admin', sonGiris: '2026-10-11T09:00:00.000Z' },                              // iç rol: daha yeni ama SAYILMAZ
      { rol: undefined, sonGiris: '2026-10-11T09:30:00.000Z' },                            // rolsüz: SAYILMAZ
    ]);
    expect(s).toEqual({ toplam: 5, rolsuz: 1, disRol: { B2B: 1, Dealer: 2 }, disRolSonGiris: '2026-03-01T10:00:00.000Z' });
  });

  it('giriş zamanı biçimleri: sunucu damgası, `seconds`, ISO metni, epoch milisaniye', () => {
    const tek = (sonGiris: unknown) => kullaniciSayimi([{ rol: 'B2B', sonGiris }]).disRolSonGiris;
    expect(tek({ _seconds: 1_760_000_000, _nanoseconds: 5 })).toBe('2025-10-09T08:53:20.000Z');
    expect(tek({ seconds: 1_760_000_000 })).toBe('2025-10-09T08:53:20.000Z');
    expect(tek('2026-10-11T06:20:00+03:00')).toBe('2026-10-11T03:20:00.000Z');
    expect(tek(1_760_000_000_000)).toBe('2025-10-09T08:53:20.000Z');
  });

  it('okunamayan giriş zamanı `null` kalır: 0 / 1970 uydurulmaz, bozuk değer ölçümü düşürmez', () => {
    const tek = (sonGiris: unknown) => kullaniciSayimi([{ rol: 'Dealer', sonGiris }]);
    for (const bozuk of [undefined, null, '', 'Bilinmiyor', 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e20, {}, { _seconds: 'x' }, { _seconds: 0 }, { _seconds: 1e15 }, [], true]) {
      expect(tek(bozuk), JSON.stringify(bozuk)).toEqual({ toplam: 1, rolsuz: 0, disRol: { B2B: 0, Dealer: 1 }, disRolSonGiris: null });
    }
    // Biri okunuyor, biri okunmuyor: okunan kazanır.
    expect(kullaniciSayimi([{ rol: 'Dealer', sonGiris: 'Bilinmiyor' }, { rol: 'B2B', sonGiris: '2026-01-02T03:04:05.000Z' }]).disRolSonGiris).toBe('2026-01-02T03:04:05.000Z');
  });

  it('çıktı YALNIZ dört alan taşır: girdideki fazladan alan (ad, e-posta, kimlik) yanıta geçemez', () => {
    const fazla = [
      { rol: 'Dealer', sonGiris: '2026-03-01T10:00:00.000Z', email: 'bayi@example.test', name: 'Şirin Yapı', id: 'uid-bayi-1', companyId: 'CETPA' },
      { rol: undefined, sonGiris: undefined, email: 'yabanci@example.test', name: 'Yabancı', id: 'uid-yabanci-1' },
    ];
    const s = kullaniciSayimi(fazla);
    expect(Object.keys(s).sort()).toEqual(['disRol', 'disRolSonGiris', 'rolsuz', 'toplam']);
    const metin = JSON.stringify(s);
    for (const yasak of ['@', 'example', 'Şirin', 'Yabancı', 'uid-', 'CETPA']) expect(metin).not.toContain(yasak);
    expect(Object.values(s.disRol).every(n => Number.isInteger(n))).toBe(true);
  });
});
