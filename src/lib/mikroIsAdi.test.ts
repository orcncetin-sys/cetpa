/**
 * mikroIsAdi.test.ts — Mikro import iş adı sözlüğü (mikro-import-arkaplan, 2026-09-24). ÖNCE YAZILDI.
 *
 * Sunucu (`jobs/<isAdi>` doküman id'si + süreç-geneli kilit anahtarı + yanıt `job`) ve istemci
 * (`onSnapshot(doc(db,'jobs',isAdi))`) AYNI fonksiyondan türetir. İki liste tutulsaydı bir tarafın
 * eklediği rota diğerinde sessizce yetim kalırdı ("yazıldı ama bağlanmadı" sınıfı).
 */
import { describe, it, expect } from 'vitest';
import { mikroIsAdi } from './mikroIsAdi';

/** 12 fabrika ucu + stok + cari — mikroRoutes.ts'teki rotalar (2026-09-24 ölçümü). */
const IMPORT_ROTALARI = [
  '/api/mikro/import/stok', '/api/mikro/import/cari',
  '/api/mikro/import/siparis', '/api/mikro/import/fatura-listesi', '/api/mikro/import/cari-hareket',
  '/api/mikro/import/stok-hareket', '/api/mikro/import/banka', '/api/mikro/import/kasa',
  '/api/mikro/import/odeme-plan', '/api/mikro/import/depo', '/api/mikro/import/barkod',
  '/api/mikro/import/fiyat', '/api/mikro/import/demirbas', '/api/mikro/import/maliyet-merkezi',
];

describe('mikroIsAdi — rota → jobs/ doküman id\'si', () => {
  it("14 import rotası 14 FARKLI id verir, hepsi 'mikroImport-<slug>'", () => {
    const idler = IMPORT_ROTALARI.map(mikroIsAdi);
    expect(new Set(idler).size).toBe(14);
    for (const id of idler) expect(id).toMatch(/^mikroImport-[a-z-]+$/);
    expect(mikroIsAdi('/api/mikro/import/cari-hareket')).toBe('mikroImport-cari-hareket');
    expect(mikroIsAdi('/api/mikro/import/stok')).toBe('mikroImport-stok');
  });

  it("TEK istisna: stok-miktar → 'stokMiktarImport' (canlıdaki doküman + panel paritesi)", () => {
    expect(mikroIsAdi('/api/mikro/import/stok-miktar')).toBe('stokMiktarImport');
  });

  it('bilinmeyen önek / boş slug / alt yol → throw (sessiz yanlış doküman YOK)', () => {
    expect(() => mikroIsAdi('/api/mikro/pull/personel')).toThrow(/mikroIsAdi/);
    expect(() => mikroIsAdi('/api/mikro/import/')).toThrow();
    expect(() => mikroIsAdi('/api/mikro/import/a/b')).toThrow();
    expect(() => mikroIsAdi('')).toThrow();
  });
});
