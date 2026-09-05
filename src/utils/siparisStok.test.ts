/**
 * siparisStok.test.ts — sipariş → stok hareketi PLANI ve durum geçişi (Faz 1 4/n, 2026-09-05). ÖNCE YAZILDI.
 *
 * OrdersPage `applyOrderStock` / `handleUpdateOrderStatus`'un saf çekirdeği. Eski gövde:
 *   const qty = Number(li.quantity) || 0;  if (!inv || qty <= 0) continue;
 * → miktarı BİLİNMEYEN satır (undefined/''/'abc') ve envanterde BULUNAMAYAN ürün SESSİZCE
 *   atlanıyor, sipariş yine `stockApplied: true` damgalanıyordu: stok hiç düşmemişken
 *   "stok uygulandı" sayılıyordu (sahte kesinliğin stok yüzü; CLAUDE.md `|| 0` yasağı).
 * Sözleşme: atlanan her satır SEBEBİYLE görünür; hareket yalnız bilinen ve pozitif miktarla
 * kurulur; durum geçişi idempotent (Shipped'de düşen Delivered'da bir daha düşmez).
 */
import { describe, it, expect } from 'vitest';
import { siparisStokPlani, stokGecisi, ATLANMA_SEBEBI } from './siparisStok';

const envanter = [
  { id: 'i1', sku: 'CMT-42', name: 'Çimento 42.5' },
  { id: 'i2', sku: 'KUM-01', name: 'Yıkanmış Kum' },
  { id: 'i3', sku: '', name: 'SKU\'suz ürün' },
];
const satir = (ek: Record<string, unknown>) => ({ id: 'l', sku: '', name: '?', quantity: 1, price: 1, ...ek });

describe('siparisStokPlani — satırlar → hareketler + atlananlar', () => {
  it('inventoryId ile eşleşen satır hareket olur (miktar sayı)', () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Çimento', quantity: 4, inventoryId: 'i1' })] }, envanter);
    expect(p.hareketler).toEqual([{ invId: 'i1', urunAdi: 'Çimento 42.5', miktar: 4 }]);
    expect(p.atlanan).toEqual([]);
  });
  it("inventoryId yoksa SKU ile eşleşir; DB'den string miktar ('3') kabul", () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Kum', sku: 'KUM-01', quantity: '3' })] }, envanter);
    expect(p.hareketler).toEqual([{ invId: 'i2', urunAdi: 'Yıkanmış Kum', miktar: 3 }]);
  });
  it("SKU'da boşluk İKİ tarafta da yutulur: envanter 'KUM-01 ' (ham import) ↔ satır ' KUM-01'", () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Kum', sku: ' KUM-01', quantity: 2 })] }, [{ id: 'k', sku: 'KUM-01 ', name: 'Kum' }]);
    expect(p.hareketler).toEqual([{ invId: 'k', urunAdi: 'Kum', miktar: 2 }]);
  });
  it('envanter adı boşsa satır adı, o da yoksa id kullanılır (bildirimde "undefined" çıkmasın)', () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Satır adı', quantity: 1, inventoryId: 'x9' })] }, [{ id: 'x9', sku: 'X', name: '' }]);
    expect(p.hareketler[0].urunAdi).toBe('Satır adı');
  });
  it("MİKTARI BİLİNMEYEN satır (undefined / '' / 'abc' / NaN) hareket OLMAZ, 'miktar_bilinmiyor' ile SAYILIR — eskiden sessizce atlanırdı", () => {
    for (const q of [undefined, '', 'abc', NaN, null]) {
      const p = siparisStokPlani({ lineItems: [satir({ name: 'Kum', sku: 'KUM-01', quantity: q })] }, envanter);
      expect(p.hareketler, `quantity=${String(q)}`).toEqual([]);
      expect(p.atlanan).toEqual([{ satir: 'Kum', sebep: 'miktar_bilinmiyor' }]);
    }
  });
  it("sıfır / negatif miktar 'miktar_gecersiz' (bilinmiyor DEĞİL — ayrı arıza sınıfı)", () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Kum', sku: 'KUM-01', quantity: 0 }), satir({ name: 'Çimento', inventoryId: 'i1', quantity: -2 })] }, envanter);
    expect(p.hareketler).toEqual([]);
    expect(p.atlanan.map(a => a.sebep)).toEqual(['miktar_gecersiz', 'miktar_gecersiz']);
  });
  it("envanterde bulunamayan ürün 'urun_bulunamadi' — sipariş 'stok uygulandı' sayılırken stok hiç düşmemiş olurdu", () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Tuğla', sku: 'TGL-9', quantity: 10 })] }, envanter);
    expect(p.hareketler).toEqual([]);
    expect(p.atlanan).toEqual([{ satir: 'Tuğla', sebep: 'urun_bulunamadi' }]);
  });
  it("SKU'suz satır SKU'suz ürünle EŞLEŞMEZ (eski `i.sku === li.sku` boş===boş tuzağı)", () => {
    const p = siparisStokPlani({ lineItems: [satir({ name: 'Adsız', sku: '', quantity: 1 })] }, envanter);
    expect(p.hareketler).toEqual([]);
    expect(p.atlanan[0].sebep).toBe('urun_bulunamadi');
  });
  it('karışık sipariş: bilinenler hareket, bilinmeyenler sayılı — sıra korunur', () => {
    const p = siparisStokPlani({ lineItems: [
      satir({ name: 'Çimento', inventoryId: 'i1', quantity: 2 }),
      satir({ name: 'Kum', sku: 'KUM-01', quantity: undefined }),
      satir({ name: 'Tuğla', sku: 'TGL-9', quantity: 5 }),
    ] }, envanter);
    expect(p.hareketler).toHaveLength(1);
    expect(p.atlanan).toEqual([{ satir: 'Kum', sebep: 'miktar_bilinmiyor' }, { satir: 'Tuğla', sebep: 'urun_bulunamadi' }]);
  });
  it('lineItems yok/boş → boş plan (çökme yok)', () => {
    expect(siparisStokPlani({}, envanter)).toEqual({ hareketler: [], atlanan: [] });
    expect(siparisStokPlani({ lineItems: [] }, envanter)).toEqual({ hareketler: [], atlanan: [] });
  });
  it('her sebebin TR ve EN etiketi var (bildirim metni sebep kodunu basmasın)', () => {
    for (const sebep of ['miktar_bilinmiyor', 'miktar_gecersiz', 'urun_bulunamadi'] as const) {
      expect(ATLANMA_SEBEBI[sebep].tr.length).toBeGreaterThan(3);
      expect(ATLANMA_SEBEBI[sebep].en.length).toBeGreaterThan(3);
    }
  });
});

describe('stokGecisi — hangi durum geçişi stok hareketi üretir (idempotent)', () => {
  it("Shipped / Delivered, stok henüz uygulanmamışsa → 'out'", () => {
    expect(stokGecisi('Shipped', false)).toBe('out');
    expect(stokGecisi('Delivered', false)).toBe('out');
  });
  it("Shipped'de düşmüşse Delivered'da BİR DAHA düşmez (null)", () => {
    expect(stokGecisi('Delivered', true)).toBeNull();
    expect(stokGecisi('Shipped', true)).toBeNull();
  });
  it("Cancelled: yalnız stok düşülmüşse geri yükle ('in'); düşülmemişse hiçbir şey", () => {
    expect(stokGecisi('Cancelled', true)).toBe('in');
    expect(stokGecisi('Cancelled', false)).toBeNull();
  });
  it('Pending / Processing hiçbir zaman stok oynatmaz', () => {
    expect(stokGecisi('Pending', false)).toBeNull();
    expect(stokGecisi('Processing', true)).toBeNull();
  });
});
