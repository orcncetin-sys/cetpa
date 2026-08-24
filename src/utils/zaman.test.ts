import { describe, it, expect } from 'vitest';
import { Timestamp } from '../lib/dbClient';
import { zamanMs, zamanDate, gunBasi, gunFarki, ayAnahtari, gunAnahtari } from './zaman';

describe('zamanMs — YAŞANMIŞ hataları kilitler', () => {
  it('Timestamp örneğini çözer — `new Date(ts)` Invalid Date VERİRDİ', () => {
    const ts = Timestamp.fromMillis(1756000000000);
    expect(zamanMs(ts)).toBe(1756000000000);
    // Hatanın kanıtı: sınıfın toString/valueOf'u yok.
    expect(Number.isNaN(new Date(ts as unknown as number).getTime())).toBe(true);
  });
  it('revive EDİLMEMİŞ {_seconds,_nanoseconds} zarfını da çözer', () => {
    expect(zamanMs({ _seconds: 1756000000, _nanoseconds: 0 })).toBe(1756000000000);
  });
  it('istemci SDK adlarını ({seconds,nanoseconds}) çözer', () => {
    expect(zamanMs({ seconds: 1756000000, nanoseconds: 0 })).toBe(1756000000000);
  });
  it('ISO string, epoch number ve Date çözülür', () => {
    expect(zamanMs('2026-08-24T00:00:00.000Z')).toBe(Date.parse('2026-08-24T00:00:00.000Z'));
    expect(zamanMs(1756000000000)).toBe(1756000000000);
    expect(zamanMs(new Date(1756000000000))).toBe(1756000000000);
  });
  it('Türk biçimi DD.MM.YYYY doğru okunur (ay/gün TERS DEĞİL)', () => {
    const d = zamanDate('03.09.2026')!;      // 3 Eylül
    expect(d.getDate()).toBe(3);
    expect(d.getMonth() + 1).toBe(9);
  });

  // EN KRİTİK DAVRANIŞ: "bilmiyorum" != "bugün"
  it('çözülemeyen değer NULL döner — ASLA "şimdi"ye düşmez', () => {
    for (const v of [null, undefined, '', '   ', 'abc', {}, { a: 1 }, NaN]) {
      expect(zamanMs(v as never)).toBeNull();
    }
  });
  it('sentinel nesnesi ({__op:"serverTimestamp"}) da NULL döner', () => {
    // dbClient iyimser yazmada bunu önbelleğe koyuyor; `?? new Date()` olan
    // yerlerde kayıt sessizce İÇİNDE BULUNULAN AYA yazılıyordu.
    expect(zamanMs({ __op: 'serverTimestamp' } as never)).toBeNull();
  });
});

describe('gunBasi — UTC/yerel gece yarısı karışmasını bitirir', () => {
  it('tarih-only string YEREL gün olarak kurulur (UTC gece yarısı DEĞİL)', () => {
    const g = gunBasi('2026-08-24')!;
    expect(g.getFullYear()).toBe(2026);
    expect(g.getMonth() + 1).toBe(8);
    expect(g.getDate()).toBe(24);
    expect(g.getHours()).toBe(0);
  });
  it('saatli değer de yerel gün başına indirgenir', () => {
    const g = gunBasi(new Date(2026, 7, 24, 15, 30))!;
    expect(g.getHours()).toBe(0);
    expect(g.getDate()).toBe(24);
  });
  it('çözülemeyen değer NULL', () => expect(gunBasi('abc')).toBeNull());
});

describe('gunFarki — gecikme günü artık bir gün eksik değil', () => {
  it('BUGÜN vadesi gelen fatura 0 gün gecikmiş (eskiden -1 çıkıyordu)', () => {
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const vadeStr = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, '0')}-${String(bugun.getDate()).padStart(2, '0')}`;
    expect(gunFarki(bugun, vadeStr)).toBe(0);
  });
  it('bir gün geçmiş fatura 1 gün gecikmiş (eskiden 0 çıkıp "Bekliyor" görünüyordu)', () => {
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const dun = new Date(bugun); dun.setDate(dun.getDate() - 1);
    const vadeStr = `${dun.getFullYear()}-${String(dun.getMonth() + 1).padStart(2, '0')}-${String(dun.getDate()).padStart(2, '0')}`;
    expect(gunFarki(bugun, vadeStr)).toBe(1);
  });
  it('herhangi bir taraf çözülemezse NULL', () => {
    expect(gunFarki('abc', new Date())).toBeNull();
    expect(gunFarki(new Date(), null)).toBeNull();
  });
});

describe('ayAnahtari / gunAnahtari', () => {
  it('ay anahtarı 1-tabanlı ve sıfır dolgulu', () => {
    expect(ayAnahtari(new Date(2026, 0, 15))).toBe('2026-01');
    expect(ayAnahtari(new Date(2026, 11, 1))).toBe('2026-12');
  });
  it('Timestamp örneğinden de ay çıkar', () => {
    expect(ayAnahtari(Timestamp.fromDate(new Date(2026, 4, 9)))).toBe('2026-05');
  });
  it('gün anahtarı tarih-only string ile aynı günü verir', () => {
    expect(gunAnahtari('2026-08-24')).toBe('2026-08-24');
  });
  it('çözülemeyen değer NULL — "unknown" kovasına düşmesi ÇAĞIRANIN kararı', () => {
    expect(ayAnahtari('abc')).toBeNull();
    expect(gunAnahtari(undefined)).toBeNull();
  });
});
