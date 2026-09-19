import { describe, it, expect } from 'vitest';
import { jumpSurumOku, JUMP_SURUM_VARSAYILAN } from './jumpSurum';

describe('jumpSurumOku — MIKRO_JUMP_SURUM ortam değeri', () => {
  it('düz sayı: "17" → 17, "16" → 16', () => {
    expect(jumpSurumOku('17')).toEqual({ surum: 17, gecersiz: false });
    expect(jumpSurumOku('16')).toEqual({ surum: 16, gecersiz: false });
  });

  it('Mikro "Hakkında" biçimi: "17.07d(jump)" → 17 (eski Number() NaN verip V17\'yi sessizce kapatıyordu)', () => {
    expect(Number('17.07d(jump)') >= 17).toBe(false); // arızanın kendisi
    expect(jumpSurumOku('17.07d(jump)')).toEqual({ surum: 17, gecersiz: false });
    expect(jumpSurumOku(' 17.07d (Jump) ')).toEqual({ surum: 17, gecersiz: false });
    expect(jumpSurumOku('17,07')).toEqual({ surum: 17, gecersiz: false });
    expect(jumpSurumOku('v17')).toEqual({ surum: 17, gecersiz: false });
  });

  it('ana sürüm TAM sayıdır: 16.99 → 16 (17 sayılmaz)', () => {
    expect(jumpSurumOku('16.99').surum).toBe(16);
  });

  it('değer yok/boş → varsayılan, geçersiz DEĞİL', () => {
    for (const ham of [undefined, null, '', '   ']) {
      expect(jumpSurumOku(ham)).toEqual({ surum: JUMP_SURUM_VARSAYILAN, gecersiz: false });
    }
  });

  it('değer var ama sürüm okunamıyor → varsayılan + gecersiz:true (çağıran uyarır)', () => {
    for (const ham of ['jump', 'onyedi', '-17', '0', 'd17']) {
      expect(jumpSurumOku(ham)).toEqual({ surum: JUMP_SURUM_VARSAYILAN, gecersiz: true });
    }
  });
});
