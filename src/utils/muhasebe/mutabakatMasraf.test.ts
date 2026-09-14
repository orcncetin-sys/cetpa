/**
 * mutabakatMasraf.test.ts — MuhasebePage Phase 550 (e-Mutabakat) + Phase 548 (Masraf Yönetimi)
 * hesaplarının sözleşmesi (Faz 3 1/n, 2026-09-13). ÖNCE yazıldı.
 *
 * Sayfadaki sahte kesinlik: `o.totalPrice || o.totalAmount || 0` (tutarı bilinmeyen sipariş
 * ₺0 alacak sayılıyordu) ve `m.amount || 0` (tutarı bilinmeyen masraf, kuru olsa bile 0 TL
 * olarak "çevrildi" sayılıyordu). Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR.
 */
import { describe, it, expect } from 'vitest';
import {
  mutabakatSatirlari, mutabakatDurumu, mutabakatOzeti,
  masrafToplami, masrafOzeti,
} from './mutabakatMasraf';
import type { MutabakatSatiri } from './mutabakatMasraf';
// `siparisTutari` sözleşmesi siparis.test.ts'te, `tlyeCevir` currency.test.ts'te (tek kaynağa taşındı, 2026-09-13).

// ── Phase 550: e-Mutabakat ──────────────────────────────────────────────────────────
describe('mutabakatSatirlari — müşteri bazında alacak/tahsilat', () => {
  const siparisler = [
    { customerName: 'Şahin İnşaat', totalPrice: 10_000, paid: true },
    { customerName: 'Şahin İnşaat', totalPrice: 5_000, paid: false },
    { customerName: 'Şahin İnşaat', totalPrice: 2_000, status: 'Cancelled' },          // iptal → dışı
    { customerName: 'Işık Yapı', totalAmount: 8_000 },                                    // paid yok → native'de ödenmedi
    { customerName: 'Işık Yapı', totalPrice: 3_000, faturali: true, paid: true },         // faturalı → Mikro carisinde, dışı
    { customerName: 'Çelik Ltd', totalPrice: 40_000, source: 'mikro-fatura' },            // Mikro türevi → cari bakiyede, dışı
    { customerName: 'Çelik Ltd', totalPrice: 500, source: 'mikro-siparis' },              // 'mikro' öneki yeter
  ];
  it('iptal, faturalı ve Mikro kaynaklı siparişler satırlara girmez, ama SAYILIR', () => {
    const { satirlar, disi } = mutabakatSatirlari(siparisler);
    expect(satirlar.map(s => s.name)).toEqual(['Işık Yapı', 'Şahin İnşaat']);   // bakiye azalan: 8000 > 5000
    expect(disi).toEqual({ iptal: 1, faturali: 1, mikro: 2 });
  });
  it('ar / paid / balance bilinen tutarlardan; oran ar>0 iken balance/ar', () => {
    const { satirlar } = mutabakatSatirlari(siparisler);
    const sahin = satirlar.find(s => s.name === 'Şahin İnşaat');
    expect(sahin).toMatchObject({ ar: 15_000, paid: 10_000, balance: 5_000, bilinen: 2, bilinmeyen: 0 });
    expect(sahin?.oran).toBeCloseTo(1 / 3);
    const isik = satirlar.find(s => s.name === 'Işık Yapı');
    expect(isik).toMatchObject({ ar: 8_000, paid: 0, balance: 8_000, bilinmeyen: 0, oran: 1 });
  });
  it('tutarı bilinmeyen sipariş 0 SAYILMAZ: toplama girmez, bilinmeyen++ (paid olsa bile)', () => {
    const { satirlar } = mutabakatSatirlari([
      { customerName: 'Güneş Ticaret', totalPrice: 1_000, paid: false },
      { customerName: 'Güneş Ticaret', totalPrice: undefined, paid: true },
      { customerName: 'Güneş Ticaret', totalPrice: '', totalAmount: null },
      { customerName: 'Güneş Ticaret', totalPrice: NaN },
    ]);
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0]).toMatchObject({ ar: 1_000, paid: 0, balance: 1_000, bilinen: 1, bilinmeyen: 3 });
  });
  it('tutarı hiç bilinmeyen müşteri: ar 0, oran null (0/0 = "kapalı" sahte kesinliği YOK)', () => {
    const { satirlar } = mutabakatSatirlari([{ customerName: 'Özdemir', totalPrice: undefined }]);
    expect(satirlar[0]).toMatchObject({ ar: 0, paid: 0, balance: 0, bilinmeyen: 1, oran: null });
  });
  it('müşteri adı boşsa "—" anahtarı; boş liste → boş satır + sıfır sayaçlar', () => {
    expect(mutabakatSatirlari([{ totalPrice: 100 }]).satirlar[0].name).toBe('—');
    expect(mutabakatSatirlari([])).toEqual({ satirlar: [], disi: { iptal: 0, faturali: 0, mikro: 0 } });
  });
});

describe('mutabakatDurumu — rozet', () => {
  const satir = (p: Partial<MutabakatSatiri>): MutabakatSatiri =>
    ({ name: 'x', ar: 0, paid: 0, balance: 0, bilinen: 1, bilinmeyen: 0, oran: null, ...p });
  it('bilinmeyen tutar varsa "belirsiz" — kısmi toplamdan rozet üretilmez', () => {
    expect(mutabakatDurumu(satir({ ar: 1_000, balance: 0, oran: 0, bilinmeyen: 1 }))).toBe('belirsiz');
    expect(mutabakatDurumu(satir({ bilinen: 0, bilinmeyen: 2 }))).toBe('belirsiz');
  });
  it('balance ≤ 0 → kapalı; oran > 0,5 → yüksek; aksi kısmi', () => {
    expect(mutabakatDurumu(satir({ ar: 1_000, paid: 1_000, balance: 0, oran: 0 }))).toBe('kapali');
    expect(mutabakatDurumu(satir({ ar: 1_000, paid: 1_200, balance: -200, oran: -0.2 }))).toBe('kapali');
    expect(mutabakatDurumu(satir({ ar: 1_000, paid: 200, balance: 800, oran: 0.8 }))).toBe('yuksek');
    expect(mutabakatDurumu(satir({ ar: 1_000, paid: 600, balance: 400, oran: 0.4 }))).toBe('kismi');
  });
});

describe('mutabakatOzeti — KPI kartları', () => {
  it('Toplam Alacak = Σar + Mikro cari AR; Tahsil = Σpaid; Bakiye = Σbalance + cari AR; bilinmeyen toplanır', () => {
    const { satirlar } = mutabakatSatirlari([
      { customerName: 'Şahin İnşaat', totalPrice: 10_000, paid: true },
      { customerName: 'Şahin İnşaat', totalPrice: 5_000 },
      { customerName: 'Işık Yapı', totalPrice: 8_000 },
      { customerName: 'Işık Yapı', totalPrice: undefined },
    ]);
    expect(mutabakatOzeti(satirlar, 100_000)).toEqual({ toplamAlacak: 123_000, tahsilEdilen: 10_000, bakiye: 113_000, bilinmeyen: 1 });
  });
  it('cari AR bilinmiyorsa (NaN/undefined) alacak ve bakiye NaN — ₺0 cari bakiye uydurulmaz; tahsil bağımsız', () => {
    const { satirlar } = mutabakatSatirlari([{ customerName: 'Şahin', totalPrice: 1_000, paid: true }]);
    const o = mutabakatOzeti(satirlar, NaN);
    expect(o.toplamAlacak).toBeNaN();
    expect(o.bakiye).toBeNaN();
    expect(o.tahsilEdilen).toBe(1_000);
    expect(mutabakatOzeti(satirlar, undefined).toplamAlacak).toBeNaN();
  });
  it('boş liste → sıfırlar (+ cari AR)', () => {
    expect(mutabakatOzeti([], 0)).toEqual({ toplamAlacak: 0, tahsilEdilen: 0, bakiye: 0, bilinmeyen: 0 });
  });
});

// ── Phase 548: Masraf Yönetimi ──────────────────────────────────────────────────────
describe('masrafToplami — TL toplam; bilinmeyen tutar ve kursuz döviz ayrı sayılır', () => {
  const kurlar = { USD: 40 };
  it('karışık birimleri TL’ye çevirip toplar', () => {
    const r = masrafToplami([
      { amount: 1_000, currency: 'TRY' },
      { amount: 10, currency: 'USD' },
      { amount: 250 },                                   // birim yok → TRY
    ], kurlar);
    expect(r).toEqual({ toplam: 1_650, bilinen: 3, bilinmeyen: 0, kurAtlanan: 0, kurEksikBirimler: [] });
  });
  it('tutarı bilinmeyen masraf 0 SAYILMAZ — kuru olsa bile "çevrildi" değil, bilinmeyen', () => {
    const r = masrafToplami([
      { amount: 500, currency: 'TRY' },
      { amount: undefined, currency: 'USD' },            // eski `m.amount||0` → 0×40 = 0 "çevrildi"
      { amount: null, currency: 'TRY' },
      { amount: '', currency: 'TRY' },
      { amount: NaN },
      { amount: 'yüz' },
    ], kurlar);
    expect(r).toEqual({ toplam: 500, bilinen: 1, bilinmeyen: 5, kurAtlanan: 0, kurEksikBirimler: [] });
  });
  it('kuru olmayan döviz toplama KATILMAZ; birimler tekilleşip sıralanır', () => {
    const r = masrafToplami([
      { amount: 100, currency: 'EUR' },
      { amount: 50, currency: 'EUR' },
      { amount: 20, currency: 'GBP' },
      { amount: 30, currency: 'USD' },
    ], kurlar);
    expect(r).toEqual({ toplam: 1_200, bilinen: 1, bilinmeyen: 0, kurAtlanan: 3, kurEksikBirimler: ['EUR', 'GBP'] });
  });
  it('kur hiç yoksa (null) yalnız TRY toplanır', () => {
    const r = masrafToplami([{ amount: 100, currency: 'USD' }, { amount: 70, currency: 'TRY' }], null);
    expect(r).toEqual({ toplam: 70, bilinen: 1, bilinmeyen: 0, kurAtlanan: 1, kurEksikBirimler: ['USD'] });
  });
  it('boş liste → sıfırlar', () => {
    expect(masrafToplami([], kurlar)).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0, kurAtlanan: 0, kurEksikBirimler: [] });
  });
});

describe('masrafOzeti — Bekliyor / Onaylandı / Reddedildi kartları', () => {
  const kurlar = { USD: 40 };
  const masraflar = [
    { status: 'Bekliyor', amount: 1_000, currency: 'TRY', employeeName: 'Şükrü Işık' },
    { status: 'Bekliyor', amount: 10, currency: 'USD' },
    { status: 'Bekliyor', amount: 5, currency: 'EUR' },              // kur yok
    { status: 'Onaylandı', amount: 300, currency: 'TRY' },
    { status: 'Onaylandı', amount: undefined, currency: 'TRY' },     // tutar bilinmiyor
    { status: 'Onaylandı', amount: 7, currency: 'EUR' },             // kur yok
    { status: 'Reddedildi', amount: 999, currency: 'TRY' },
    { status: 'Reddedildi', amount: 1, currency: 'GBP' },            // reddedilen toplama girmez
  ];
  it('durum bazlı adet + TL toplam; kurAtlanan ve kurEksik iki kovanın birleşimi; bilinmeyen toplanır', () => {
    const o = masrafOzeti(masraflar, kurlar);
    expect(o.bekleyen).toEqual({ adet: 3, toplam: 1_400, bilinen: 2, bilinmeyen: 0, kurAtlanan: 1, kurEksikBirimler: ['EUR'] });
    expect(o.onaylanan).toEqual({ adet: 3, toplam: 300, bilinen: 1, bilinmeyen: 1, kurAtlanan: 1, kurEksikBirimler: ['EUR'] });
    expect(o.reddedilenAdet).toBe(2);
    expect(o.toplamAdet).toBe(8);
    expect(o.kurAtlanan).toBe(2);
    expect(o.kurEksikBirimler).toEqual(['EUR']);       // tekil — sayfadaki Set([...bek, ...ona]) davranışı
    expect(o.bilinmeyen).toBe(1);
  });
  it('boş liste → sıfırlar', () => {
    const o = masrafOzeti([], null);
    expect(o.bekleyen).toEqual({ adet: 0, toplam: 0, bilinen: 0, bilinmeyen: 0, kurAtlanan: 0, kurEksikBirimler: [] });
    expect(o.reddedilenAdet).toBe(0);
    expect(o.toplamAdet).toBe(0);
    expect(o.kurEksikBirimler).toEqual([]);
  });
});
