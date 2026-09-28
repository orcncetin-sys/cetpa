/** ebelgeDurumTani — GİB durum yanıtı HAM ölçülür, hüküm verilmez, zarf varsayılmaz (2026-09-28). */
import { describe, it, expect } from 'vitest';
import { durumDenemesiOzeti, ettnGecerli, hucreleriKes } from './ebelgeDurumTani';

const zarf = (r0: Record<string, unknown>) => ({ result: [r0] });

describe('durumDenemesiOzeti', () => {
  it('zarf: Data anahtarları, r0 anahtarları ve ham metin aynen; Data varken gövde tekrar edilmez', () => {
    const d = durumDenemesiOzeti(0, { ok: true, status: 200, data: zarf({ IsError: false, Data: { DurumAciklama: 'Kabul', Kod: 1300 } }) });
    expect(d).toEqual({ eBelgeTipi: 0, httpOk: true, httpDurum: 200, zarfTuru: 'zarf', isError: false, hata: null,
      ustAnahtarlar: ['result'], r0Anahtarlari: ['IsError', 'Data'], dataAnahtarlari: ['DurumAciklama', 'Kod'],
      dataHam: '{"DurumAciklama":"Kabul","Kod":1300}', govdeHam: null });
  });

  it('Mikro reddi HTTP 200 + IsError true: hata metni tutulur; Data yoksa GÖVDE döner (durum alanı r0\'da Data\'nın kardeşi olabilir)', () => {
    const d = durumDenemesiOzeti(0, { ok: true, status: 200, data: zarf({ IsError: true, ErrorMessage: 'Belge bulunamadı', Durum: 'RED' }) });
    expect(d).toMatchObject({ zarfTuru: 'zarf', isError: true, hata: 'Belge bulunamadı', dataAnahtarlari: [], dataHam: null,
      r0Anahtarlari: ['IsError', 'ErrorMessage', 'Durum'] });
    expect(d.govdeHam).toContain('"Durum":"RED"');
  });

  it('zarf dışı yanıt kaybolmaz: HTML/metin gövde, result\'suz stub (Method), boş gövde', () => {
    const html = durumDenemesiOzeti(1, { ok: false, status: 403, data: '<html>403 Forbidden</html>' });
    expect(html).toMatchObject({ eBelgeTipi: 1, zarfTuru: 'metin', isError: null, hata: 'yanıt zarfında result[0] yok', govdeHam: '<html>403 Forbidden</html>' });
    const stub = durumDenemesiOzeti(0, { ok: true, status: 200, data: { Method: 'EBelgeDurumSorgulamaV2' } });
    expect(stub).toMatchObject({ zarfTuru: 'result-yok', isError: null, ustAnahtarlar: ['Method'], govdeHam: '{"Method":"EBelgeDurumSorgulamaV2"}' });
    const bos = durumDenemesiOzeti(0, { ok: false, status: 502, data: null });
    expect(bos).toMatchObject({ zarfTuru: 'bos', govdeHam: 'null', ustAnahtarlar: [] });
  });

  it('IsError boolean değilse null; dizi Data işaretlenir', () => {
    const tuhaf = durumDenemesiOzeti(0, { ok: true, status: 200, data: zarf({ IsError: 'false', Data: [] }) });
    expect(tuhaf).toMatchObject({ isError: null, dataAnahtarlari: ['<dizi>'], dataHam: '[]', govdeHam: null });
  });

  it('uzun Data ve gövde kısaltılır, kalan uzunluk yazılır (yanıt şişmez)', () => {
    const d = durumDenemesiOzeti(0, { ok: true, status: 200, data: zarf({ IsError: false, Data: { x: 'a'.repeat(5000) } }) }, 100);
    expect(d.dataHam?.length).toBeLessThan(120);
    expect(d.dataHam).toMatch(/…\(\+\d+\)$/);
    const m = durumDenemesiOzeti(0, { ok: false, status: 500, data: 'b'.repeat(5000) }, 100);
    expect(m.govdeHam).toMatch(/^b{100}…\(\+4900\)$/);
  });
});

describe('ettnGecerli', () => {
  it('yalnız 36 karakterlik onaltılık+tire ETTN; sıfır GUID ve fatura no gönderilmez', () => {
    expect(ettnGecerli('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(true);
    expect(ettnGecerli(' 3f2504e0-4f89-11d3-9a0c-0305e82c3301 ')).toBe(true);
    expect(ettnGecerli('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(ettnGecerli('SZN2026000001284')).toBe(false);
    expect(ettnGecerli("x'; DROP TABLE--")).toBe(false);
    expect(ettnGecerli(null)).toBe(false);
  });
});

describe('hucreleriKes', () => {
  it('uzun metin hücresi kesilir; sayı/boolean/null aynen', () => {
    const [r] = hucreleriKes([{ a: 'x'.repeat(400), b: 5, c: true, d: null, e: 'kısa' }], 300);
    expect(r).toEqual({ a: `${'x'.repeat(300)}…(+100)`, b: 5, c: true, d: null, e: 'kısa' });
  });
});
