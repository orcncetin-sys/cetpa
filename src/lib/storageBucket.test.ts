import { describe, it, expect } from 'vitest';
import { bucketAdaylari, bucketCoz } from './storageBucket';

const PID = 'ornek-proje';
const sahte = (varOlanlar: string[], patlayanlar: string[] = []) => (ad: string) => ({
  async exists(): Promise<[boolean]> {
    if (patlayanlar.includes(ad)) throw new Error('erişilemedi');
    return [varOlanlar.includes(ad)];
  },
});

describe('bucketAdaylari', () => {
  it('env değeri en başa gelir', () => {
    expect(bucketAdaylari(PID, 'ozel-bucket')[0]).toBe('ozel-bucket');
  });
  it('env yoksa iki standart biçim denenir', () => {
    expect(bucketAdaylari(PID)).toEqual([`${PID}.firebasestorage.app`, `${PID}.appspot.com`]);
  });
  it('tekrar eden aday elenir', () => {
    const a = bucketAdaylari(PID, `${PID}.appspot.com`);
    expect(a.length).toBe(new Set(a).size);
  });
});

describe('bucketCoz', () => {
  it('yeni biçim varsa onu seçer', async () => {
    const r = await bucketCoz(bucketAdaylari(PID), sahte([`${PID}.firebasestorage.app`]));
    expect(r.ad).toBe(`${PID}.firebasestorage.app`);
  });

  it('YALNIZ eski biçim varsa ona düşer — asıl arıza senaryosu', async () => {
    const r = await bucketCoz(bucketAdaylari(PID), sahte([`${PID}.appspot.com`]));
    expect(r.ad).toBe(`${PID}.appspot.com`);
  });

  it('hiçbiri yoksa null döner (sessizce bir ad UYDURMAZ)', async () => {
    const r = await bucketCoz(bucketAdaylari(PID), sahte([]));
    expect(r.ad).toBeNull();
    expect(r.denenen.length).toBe(2);
  });

  it('bir aday hata fırlatsa bile diğerine geçer', async () => {
    const r = await bucketCoz(
      bucketAdaylari(PID),
      sahte([`${PID}.appspot.com`], [`${PID}.firebasestorage.app`]),
    );
    expect(r.ad).toBe(`${PID}.appspot.com`);
  });
});
