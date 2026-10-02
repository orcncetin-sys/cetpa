/**
 * Harita karoları — OSM, Referer göndermeyen tarayıcı isteğini engeller (yanıt başlığı `x-blocked: No referer sent`, canlıda
 * ölçüldü 2026-10-02: harita "403 Access blocked" karolarıyla doluydu). Sitemiz `Referrer-Policy: no-referrer` gönderdiği
 * için karo katmanı kendi politikasını TAŞIMAK zorunda; bu test o satırın sessizce silinmesini yakalar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sevkiyatiSuruyor } from '../utils/logistics';

const kod = readFileSync(resolve(__dirname, 'LogisticsMap.tsx'), 'utf8');

describe('LogisticsMap — OSM karo politikası', () => {
  it('karo katmanı referrerPolicy taşır ve değer Referer GÖNDEREN bir politikadır', () => {
    expect(kod).toMatch(/<TileLayer[\s\S]{0,400}referrerPolicy=\{OSM_REFERRER_POLITIKASI\}/);
    const deger = /OSM_REFERRER_POLITIKASI: ReferrerPolicy = '([a-z-]+)'/.exec(kod)?.[1];
    expect(['strict-origin-when-cross-origin', 'origin', 'origin-when-cross-origin', 'strict-origin']).toContain(deger);
  });
  it('karo adresi OSM\'nin tek ana makinesi ({s} alt alan adı yok) ve atıf duruyor', () => {
    expect(kod).toContain("OSM_KARO_ADRESI = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(kod).not.toContain('{s}.tile.openstreetmap.org/{z}');
    expect(kod).toContain('openstreetmap.org/copyright');
  });
});

describe('sevkiyatiSuruyor — "Aktif Sevkiyatlar" ve rota kurucunun ortak tanımı', () => {
  it('teslim edilen ve iptal edilen SÜRMÜYOR; bekleyen / hazırlanan / yolda sürüyor', () => {
    expect(['Pending', 'Processing', 'Shipped'].map(status => sevkiyatiSuruyor({ status }))).toEqual([true, true, true]);
    expect(['Delivered', 'Cancelled'].map(status => sevkiyatiSuruyor({ status }))).toEqual([false, false]);
  });
});
