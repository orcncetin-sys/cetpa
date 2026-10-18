/**
 * gonderimOzeti.test.ts — gönderim defterinin saf özet ve ölçü işlevleri (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md`
 * K0b; v2 T0 saf vektörleri + `varlikOzeti`; § 8.2 commit 0-B).
 */
import { describe, it, expect } from 'vitest';
import { evrakSayisi, govdeOzeti, hataOlcusu, kanonikJson, varlikOzeti, yanitOlcusu } from './gonderimOzeti';

describe('govdeOzeti — kanonik { method, payload } → sha256', () => {
  it('anahtar sırasından BAĞIMSIZ (her düzeyde), değerden BAĞIMLI, dizi sırasından BAĞIMLI', () => {
    const a = govdeOzeti('ZiyaretKaydetV2', { b: 1, a: { y: [1, 2], x: 'Çetin' } });
    expect(a).toBe(govdeOzeti('ZiyaretKaydetV2', { a: { x: 'Çetin', y: [1, 2] }, b: 1 }));
    expect(a).not.toBe(govdeOzeti('ZiyaretKaydetV2', { b: 2, a: { y: [1, 2], x: 'Çetin' } }));
    expect(a).not.toBe(govdeOzeti('ZiyaretKaydetV2', { b: 1, a: { y: [2, 1], x: 'Çetin' } }));
    expect(a).not.toBe(govdeOzeti('PersonelizinKaydetV2', { b: 1, a: { y: [1, 2], x: 'Çetin' } }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('istek gövdesinin öteki alanlarından (istemciIsNo, onayliTekrar, entityType, entityId) BAĞIMSIZ — özet yalnız method + payload', () => {
    const payload = { evraklar: [{ satirlar: [{ miktar: 3 }] }] };
    const istek1 = { method: 'UrunReceteKaydetV2', payload, istemciIsNo: '11111111-1111-4111-8111-111111111111', entityType: 'bom', entityId: 'b1' };
    const istek2 = { method: 'UrunReceteKaydetV2', payload: JSON.parse(JSON.stringify(payload)) as unknown, onayliTekrar: true, entityType: 'x', entityId: 'b2' };
    expect(govdeOzeti(istek1.method, istek1.payload)).toBe(govdeOzeti(istek2.method, istek2.payload));
  });

  it('kanonikJson: undefined anahtar düşer, dizideki undefined null olur (JSON.stringify kuralı)', () => {
    expect(kanonikJson({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(kanonikJson([1, undefined, 'ı'])).toBe('[1,null,"ı"]');
    expect(kanonikJson(null)).toBe('null');
  });
});

describe('varlikOzeti — kiracı + yöntem + varlık türü + varlık kimliği', () => {
  it('aynı dörtlü → aynı; herhangi biri farklı → farklı; çıktı 64 haneli onaltılık ve düz entityId İÇERMEZ', () => {
    const v = varlikOzeti('CETPA', 'PersonelizinKaydetV2', 'leaveRequest', 'izin-ayse-2110');
    expect(v).toBe(varlikOzeti('CETPA', 'PersonelizinKaydetV2', 'leaveRequest', 'izin-ayse-2110'));
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(v).not.toContain('izin-ayse-2110');
    expect(v).not.toBe(varlikOzeti('BASKA', 'PersonelizinKaydetV2', 'leaveRequest', 'izin-ayse-2110'));
    expect(v).not.toBe(varlikOzeti('CETPA', 'PersonelIzinTalepKaydetV2', 'leaveRequest', 'izin-ayse-2110'));
    expect(v).not.toBe(varlikOzeti('CETPA', 'PersonelizinKaydetV2', 'bom', 'izin-ayse-2110'));
    expect(v).not.toBe(varlikOzeti('CETPA', 'PersonelizinKaydetV2', 'leaveRequest', 'izin-ayse-2111'));
  });
  it('entityId boş ya da yok (ya da dize değil) → null', () => {
    expect(varlikOzeti('CETPA', 'ZiyaretKaydetV2', 'leadVisit', '')).toBeNull();
    expect(varlikOzeti('CETPA', 'ZiyaretKaydetV2', 'leadVisit', undefined)).toBeNull();
    expect(varlikOzeti('CETPA', 'ZiyaretKaydetV2', 'leadVisit', 42)).toBeNull();
  });
  it('ayraç belirsizliği yok: alanlar arasındaki «|» başka bir dörtlüyle çakışmaz', () => {
    expect(varlikOzeti('A|B', 'M', 't', 'e')).not.toBe(varlikOzeti('A', 'B|M', 't', 'e'));
  });
});

describe('yanitOlcusu — değer taşımayan yanıt ölçüsü', () => {
  const tek = { result: [{ StatusCode: 200, IsError: false, ErrorMessage: '', Data: { evrakNo: 'T000123' } }] };
  it('boş result: uzunluk 0, hatalı 0', () => {
    expect(yanitOlcusu({ status: 200, data: { result: [] } }, 1)).toMatchObject({ httpDurum: 200, jsonMu: true, resultUzunlugu: 0, hataliOgeSayisi: 0, evrakSayisi: 1 });
  });
  it('tek öğe: anahtar yolları DEĞERSİZ (evrak numarası yanıta girmez)', () => {
    const o = yanitOlcusu({ status: 200, data: tek }, null);
    expect(o).toMatchObject({ resultUzunlugu: 1, hataliOgeSayisi: 0, evrakSayisi: null });
    expect(o.yanitAnahtarlari).toContain('result[0].Data.evrakNo');
    expect(JSON.stringify(o)).not.toContain('T000123');
  });
  it('çok öğe ve IsError karışık: hatalı öğe sayısı', () => {
    const data = { result: [{ IsError: false }, { IsError: true, ErrorMessage: 'Cari ŞİRİN bulunamadı' }, { IsError: true }] };
    const o = yanitOlcusu({ status: 200, data }, 3);
    expect(o).toMatchObject({ resultUzunlugu: 3, hataliOgeSayisi: 2, evrakSayisi: 3 });
    expect(JSON.stringify(o)).not.toContain('ŞİRİN');
  });
  it('result\'suz stub: uzunluk ve hatalı null, JSON evet', () => {
    expect(yanitOlcusu({ status: 200, data: { Method: 'X' } }, 1)).toMatchObject({ jsonMu: true, resultUzunlugu: null, hataliOgeSayisi: null, yanitAnahtarlari: ['Method'] });
  });
  it('dize gövde (HTML hata sayfası): JSON hayır, anahtar yolu yok', () => {
    expect(yanitOlcusu({ status: 502, data: '<html>Bad Gateway</html>' }, 1)).toEqual({
      httpDurum: 502, jsonMu: false, resultUzunlugu: null, hataliOgeSayisi: null, evrakSayisi: 1, yanitAnahtarlari: [],
    });
  });
  it('evrakSayisi: `payload.evraklar` dizi ise uzunluğu, değilse null (0 değil)', () => {
    expect(evrakSayisi({ evraklar: [{}, {}, {}] })).toBe(3);
    expect(evrakSayisi({ evraklar: [] })).toBe(0);
    expect(evrakSayisi({ a: 1 })).toBeNull();
    expect(evrakSayisi(null)).toBeNull();
  });
});

describe('hataOlcusu — ad + neden kodu; ileti METNİ yok', () => {
  it('TimeoutError (DOMException) → ad, kod yok', () => {
    const e = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    expect(hataOlcusu(e)).toEqual({ hataAdi: 'TimeoutError', hataKodu: null });
  });
  it('cause.code\'lu TypeError (undici bağlantı reddi) → ad + kod', () => {
    const e = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:8094'), { code: 'ECONNREFUSED' }) });
    const o = hataOlcusu(e);
    expect(o).toEqual({ hataAdi: 'TypeError', hataKodu: 'ECONNREFUSED' });
    expect(JSON.stringify(o)).not.toContain('10.0.0.1');
  });
  it('nesne olmayan hata (dize, null) → ikisi de null; serbest metin ad → (tanımsız)', () => {
    expect(hataOlcusu('beklenmedik')).toEqual({ hataAdi: null, hataKodu: null });
    expect(hataOlcusu(null)).toEqual({ hataAdi: null, hataKodu: null });
    expect(hataOlcusu({ name: 'Cari ŞİRİN YAPI bulunamadı', cause: { code: 'kod içinde boşluk' } })).toEqual({ hataAdi: '(tanımsız)', hataKodu: '(tanımsız)' });
    expect(hataOlcusu({ name: 'Error', cause: { code: -4078 } })).toEqual({ hataAdi: 'Error', hataKodu: '-4078' });
  });
});
