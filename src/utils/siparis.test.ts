/**
 * siparis.test.ts — sipariş alanlarının KAYNAK-BAĞIMSIZ okunması (Faz 1 3/n, 2026-09-05).
 *
 * `orders` üç üreticiden besleniyor (Shopify aynası / Cetpa-native / Mikro faturasından
 * türetme) ve her biri farklı alan yazıyor. 2026-09-03'te 355 türetilmiş sipariş
 * "Order undefined" + "Bilinmeyen Tarih" görünüyor, `!o.paid` ₺17,6M SAHTE alacak
 * üretiyordu. Bu dosya üç sözleşmeyi kilitler: numara üreticiden bağımsız çözülür;
 * tarih bilinmiyorsa BUGÜNE DÜŞMEZ; Mikro türevinde `paid` yokluğu "ödenmedi" değildir.
 */
import { describe, it, expect } from 'vitest';
import { gorunenSiparisNo, siparisTarih, siparisTarihMs, odemeTakipli } from './siparis';

describe('gorunenSiparisNo — üreticiden bağımsız numara', () => {
  it('Cetpa-native / Mikro türevi: orderNumber (Türkçe karakterli seri dahil) aynen', () => {
    expect(gorunenSiparisNo({ orderNumber: 'MF-İST00012', id: 'x' })).toBe('MF-İST00012');
    expect(gorunenSiparisNo({ orderNumber: 'SIP-1001', shopifyOrderId: 5555 })).toBe('SIP-1001');   // orderNumber öncelikli
  });
  it('Shopify aynası: shopifyOrderId (sayı da olsa) string olarak', () => {
    expect(gorunenSiparisNo({ shopifyOrderId: 5555 })).toBe('5555');
    expect(gorunenSiparisNo({ shopifyOrderId: '#1001' })).toBe('#1001');
    expect(gorunenSiparisNo({ shopifyOrderId: 0 })).toBe('0');           // 0 geçerli bir id, "yok" değil
  });
  it("numara yoksa id'nin son altısı '#' ile; o da yoksa '—' — 'Order undefined' asla", () => {
    expect(gorunenSiparisNo({ id: 'abc12345xy9z8w' })).toBe('#xy9z8w');
    expect(gorunenSiparisNo({ orderNumber: '', id: 'abc12345xy9z8w' })).toBe('#xy9z8w');
    expect(gorunenSiparisNo({})).toBe('—');
    expect(gorunenSiparisNo({ orderNumber: '' })).toBe('—');
  });
});

describe('siparisTarih — bilinmiyorsa null, BUGÜNE DÜŞMEZ', () => {
  it('öncelik: syncedAt → createdAt → orderDate', () => {
    const iso = (s: string) => new Date(s);
    expect(siparisTarih({ syncedAt: '2026-09-01T10:00:00Z', createdAt: '2026-08-01', orderDate: '2026-07-01' })).toEqual(iso('2026-09-01T10:00:00Z'));
    expect(siparisTarih({ createdAt: '2026-08-01T00:00:00Z', orderDate: '2026-07-01' })).toEqual(iso('2026-08-01T00:00:00Z'));
    expect(siparisTarih({ orderDate: '2026-07-01T00:00:00Z' })).toEqual(iso('2026-07-01T00:00:00Z'));
  });
  it('Firestore Timestamp biçimleri ({toDate}, {seconds}) çözülür', () => {
    const d = new Date('2026-05-05T12:00:00Z');
    expect(siparisTarih({ createdAt: { toDate: () => d } })).toEqual(d);
    expect(siparisTarih({ createdAt: { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 } })?.getTime()).toBe(d.getTime());
  });
  it('hiçbiri yok / bozuk → null (asla new Date())', () => {
    expect(siparisTarih({})).toBeNull();
    expect(siparisTarih({ createdAt: 'bugün', syncedAt: null, orderDate: undefined })).toBeNull();
    expect(siparisTarih({ createdAt: {} })).toBeNull();
  });
  it('bozuk üstteki alan alttakini ENGELLEMEZ (?? zinciri null\'da devam eder)', () => {
    expect(siparisTarih({ syncedAt: 'bozuk', createdAt: '2026-08-01T00:00:00Z' })).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});

describe('siparisTarihMs — sıralama için', () => {
  it('bilinen tarih → epoch ms', () => {
    expect(siparisTarihMs({ createdAt: '2026-08-01T00:00:00Z' })).toBe(Date.parse('2026-08-01T00:00:00Z'));
  });
  it('TUZAK: bilinmeyen tarih -Infinity döner, null DEĞİL — `=== null` filtresi burada çalışmaz; sıralamada EN SONA düşer', () => {
    const ms = siparisTarihMs({});
    expect(ms).toBe(-Infinity);
    expect(ms === null).toBe(false);
    const sirali = [{ createdAt: '2026-01-01' }, {}, { createdAt: '2026-06-01' }].sort((a, b) => siparisTarihMs(b) - siparisTarihMs(a));
    expect(sirali[2]).toEqual({});
  });
});

describe('odemeTakipli — tahsilat semantiği', () => {
  it("Mikro faturasından türetilen siparişte `paid` yokluğu 'ödenmedi' DEĞİL 'bilinmiyor' → takipli değil", () => {
    expect(odemeTakipli({ source: 'mikro-fatura' })).toBe(false);
  });
  it("Mikro kaynaklı HER kayıt takipsiz — 'mikro-siparis' (Siparişler → Mikro sekmesi) ve düz 'mikro' (inceleme: eşitlik kontrolü bunları kaçırıyordu)", () => {
    expect(odemeTakipli({ source: 'mikro-siparis' })).toBe(false);
    expect(odemeTakipli({ source: 'mikro' })).toBe(false);
    expect(odemeTakipli({ source: 'mikrofon' })).toBe(false);   // önek kuralı — bilinçli
  });
  it('native / Shopify / kaynağı yazılmamış eski kayıt → takipli (paid alanına bakılır)', () => {
    expect(odemeTakipli({})).toBe(true);
    expect(odemeTakipli({ source: 'shopify' })).toBe(true);
    expect(odemeTakipli({ source: 'native' })).toBe(true);
  });
});
