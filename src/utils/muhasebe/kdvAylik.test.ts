/**
 * kdvAylik.test.ts — MuhasebePage "KDV Özeti (Son 6 Ay)" (Phase 146) + "Tahsilat Hatırlatma
 * Otomasyonu" (Phase 607) hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 1/n, 2026-09-13).
 *
 * Sahte-kesinlik siteleri (MuhasebePage.tsx ~389-395, ~467):
 *   kdvCollected = reduce(kdvTutari || 0)                  → KDV'si bilinmeyen kayıt 0 sayılıyordu
 *   netRevenue   = reduce(kdvHaricTutar || totalPrice || 0) → net yoksa BRÜT net sayılıyordu (KDV kadar şişme)
 *   totalUnpaid  = reduce(totalPrice || 0)                  → tutarı bilinmeyen açık sipariş 0 sayılıyordu
 * Kural (CLAUDE.md): bilinmeyen tutar toplama girmez, SAYILIR (`bilinmeyen`); ekranda '—' + not.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import { kdvKaydiMi, kdvAylikOzet, tahsilatHatirlatma, yaslandirmaSeviyesi } from './kdvAylik';

const SIMDI = new Date(2026, 8, 13, 10, 0, 0); // 13 Eyl 2026 10:00 (yerel)
const gun = (y: number, ay: number, g: number, saat = 12) => new Date(y, ay - 1, g, saat);

describe('kdvKaydiMi — KDV panosuna hangi sipariş girer', () => {
  it('kdvTutari bilinen ve ≠ 0 → girer (sayfadaki truthy süzgeç)', () => {
    expect(kdvKaydiMi({ kdvTutari: 200 })).toBe(true);
    expect(kdvKaydiMi({ kdvTutari: '150.5' })).toBe(true);
  });
  it('kdvTutari 0 = faturasız/KDV yok → girmez; alan yok (undefined/null/"") → girmez', () => {
    expect(kdvKaydiMi({ kdvTutari: 0 })).toBe(false);
    expect(kdvKaydiMi({ kdvTutari: undefined })).toBe(false);
    expect(kdvKaydiMi({ kdvTutari: null })).toBe(false);
    expect(kdvKaydiMi({ kdvTutari: '' })).toBe(false);
    expect(kdvKaydiMi({})).toBe(false);
  });
  it("alan DOLU ama sayı değil (NaN/'abc') → girer ve BİLİNMEYEN sayılır; sessizce düşmez", () => {
    expect(kdvKaydiMi({ kdvTutari: NaN })).toBe(true);
    expect(kdvKaydiMi({ kdvTutari: 'abc' })).toBe(true);
  });
});

describe('kdvAylikOzet — son N ayın KDV / KDV-hariç ciro toplamları', () => {
  const KAYITLAR = [
    { customerName: 'Şirin Yapı İnş.', createdAt: gun(2026, 8, 5), kdvTutari: 200, kdvHaricTutar: 1000, faturali: true },
    { customerName: 'Işık Çelik', createdAt: '2026-08-20', kdvTutari: 100, kdvHaricTutar: 1000, faturali: true },
    { customerName: 'Çağlar Nakliyat', createdAt: '15.07.2026', kdvTutari: 50, kdvHaricTutar: 500, faturali: true },
    { customerName: 'Faturasız Perakende', createdAt: gun(2026, 8, 9), kdvTutari: 0, kdvHaricTutar: 300, faturali: false },
    { customerName: 'Ölçüsüz Kayıt', createdAt: gun(2026, 8, 10), kdvTutari: NaN, kdvHaricTutar: undefined, totalPrice: 999, faturali: true },
    { customerName: 'Eski Kayıt (pencere dışı)', createdAt: gun(2026, 1, 10), kdvTutari: 999, kdvHaricTutar: 9999, faturali: true },
    { customerName: 'Tarihsiz', createdAt: 'abc', kdvTutari: 77, kdvHaricTutar: 777, faturali: true },
  ];

  it('boş liste: 6 ay, hepsi sıfır/bilinen 0, efektif oran null (%0 uydurulmaz)', () => {
    const r = kdvAylikOzet([], SIMDI);
    expect(r.aylar).toHaveLength(6);
    expect(r.aylar.map(a => a.ay)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    for (const a of r.aylar) {
      expect(a.kdv).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
      expect(a.net).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
      expect(a.faturali).toBe(0);
    }
    expect(r.toplamKdv).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(r.efektifOran).toBeNull();
  });

  it('aylar eskiden yeniye, ayın 1\'i Date olarak (etiketi sayfa tarihYaz ile basar)', () => {
    const r = kdvAylikOzet(KAYITLAR, SIMDI);
    expect(r.aylar[0]?.tarih.getTime()).toBe(new Date(2026, 3, 1).getTime());
    expect(r.aylar[5]?.tarih.getTime()).toBe(new Date(2026, 8, 1).getTime());
  });

  it('Ağustos: bilinen KDV/net toplanır, bilinmeyen SAYILIR; faturasız (kdvTutari 0) dışarıda', () => {
    const agu = kdvAylikOzet(KAYITLAR, SIMDI).aylar[4];
    expect(agu?.ay).toBe('2026-08');
    expect(agu?.kdv).toEqual({ toplam: 300, bilinen: 2, bilinmeyen: 1 });
    expect(agu?.net).toEqual({ toplam: 2000, bilinen: 2, bilinmeyen: 1 });
    expect(agu?.faturali).toBe(3); // Şirin + Işık + Ölçüsüz (faturali:true); Faturasız Perakende panoda değil
  });

  it('net yoksa BRÜT (totalPrice) net SAYILMAZ — bilinmeyen kalır (eski `|| totalPrice` KDV kadar şişiriyordu)', () => {
    const agu = kdvAylikOzet(KAYITLAR, SIMDI).aylar[4];
    expect(agu?.net.toplam).toBe(2000); // 2999 DEĞİL
    expect(agu?.net.bilinmeyen).toBe(1);
  });

  it('Türk tarih biçimi (15.07.2026) Temmuz\'a düşer; pencere dışı (Ocak) ve çözülemeyen tarih hiçbir aya girmez', () => {
    const r = kdvAylikOzet(KAYITLAR, SIMDI);
    expect(r.aylar[3]?.ay).toBe('2026-07');
    expect(r.aylar[3]?.kdv).toEqual({ toplam: 50, bilinen: 1, bilinmeyen: 0 });
    expect(r.toplamKdv).toEqual({ toplam: 350, bilinen: 3, bilinmeyen: 1 });
    expect(r.toplamNet).toEqual({ toplam: 2500, bilinen: 3, bilinmeyen: 1 });
  });

  it('PG/Firestore zarfı ({_seconds}) createdAt çözülür (new Date(zarf) tuzağı yok)', () => {
    const zarf = { _seconds: Math.floor(gun(2026, 9, 1).getTime() / 1000), _nanoseconds: 0 };
    const r = kdvAylikOzet([{ createdAt: zarf, kdvTutari: 20, kdvHaricTutar: 100 }], SIMDI);
    expect(r.aylar[5]?.kdv.toplam).toBe(20);
  });

  it('efektif oran = ΣKDV / Σnet × 100, yalnız İKİSİ DE bilinen kayıtlardan', () => {
    expect(kdvAylikOzet(KAYITLAR, SIMDI).efektifOran).toBeCloseTo(14, 6); // 350/2500
    const r = kdvAylikOzet([
      { createdAt: gun(2026, 9, 2), kdvTutari: 200, kdvHaricTutar: undefined }, // net yok → orana girmez
      { createdAt: gun(2026, 9, 3), kdvTutari: 100, kdvHaricTutar: 1000 },
    ], SIMDI);
    expect(r.efektifOran).toBeCloseTo(10, 6); // 30 DEĞİL
    expect(r.toplamKdv.toplam).toBe(300);     // toplamda ikisi de var
  });

  it('net toplamı 0 ise oran null (sıfıra bölme / %Infinity yok)', () => {
    expect(kdvAylikOzet([{ createdAt: gun(2026, 9, 2), kdvTutari: 5, kdvHaricTutar: 0 }], SIMDI).efektifOran).toBeNull();
  });

  it('ay adedi parametrik (3 ay)', () => {
    expect(kdvAylikOzet(KAYITLAR, SIMDI, 3).aylar.map(a => a.ay)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('İPTAL sipariş sayfadaki gibi DIŞLANMAZ (davranış korunur; dışlama ayrı iş kararı — bkz. bağlama notu)', () => {
    const iptal = [{ createdAt: gun(2026, 9, 2), kdvTutari: 40, kdvHaricTutar: 200, status: 'Cancelled' }]; // KdvKaydi status OKUMAZ
    const r = kdvAylikOzet(iptal, SIMDI);
    expect(r.toplamKdv.toplam).toBe(40);
  });
});

describe('ekranTutari — bilinen hiç yokken toplam 0 DEĞİL NaN (paraYaz → "—")', () => {
  it('hiç bilinen yok ama bilinmeyen var → NaN', () => {
    expect(Number.isNaN(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 2 }))).toBe(true);
  });
  it('gerçek 0 (bilinen 1) → 0; kısmi bilinmeyen → bilinen toplam (not ekranda)', () => {
    expect(ekranTutari({ toplam: 0, bilinen: 1, bilinmeyen: 0 })).toBe(0);
    expect(ekranTutari({ toplam: 500, bilinen: 2, bilinmeyen: 1 })).toBe(500);
    expect(ekranTutari({ toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBe(0);
  });
});

describe('yaslandirmaSeviyesi — eşik kovası (0 normal, 1..n eşik sırası)', () => {
  const ESIK = [7, 15, 30];
  it('eşik altı 0; 7→1; 15→2; 30 ve üstü→3', () => {
    expect(yaslandirmaSeviyesi(3, ESIK)).toBe(0);
    expect(yaslandirmaSeviyesi(7, ESIK)).toBe(1);
    expect(yaslandirmaSeviyesi(14, ESIK)).toBe(1);
    expect(yaslandirmaSeviyesi(15, ESIK)).toBe(2);
    expect(yaslandirmaSeviyesi(30, ESIK)).toBe(3);
    expect(yaslandirmaSeviyesi(100, ESIK)).toBe(3);
  });
  it('NaN eşik (boş input) atlanır; eşik yoksa 0', () => {
    expect(yaslandirmaSeviyesi(100, [7, 15, NaN])).toBe(2);
    expect(yaslandirmaSeviyesi(100, [])).toBe(0);
  });
});

describe('tahsilatHatirlatma — açık siparişlerin yaşlandırması ve bakiyesi', () => {
  const ESIK = [7, 15, 30];
  const ACIK = [
    { id: 'a1', customerName: 'Şirin Yapı İnş.', totalPrice: 5000, paid: false, status: 'Delivered', createdAt: '2026-08-01' },
    { id: 'a2', customerName: 'Işık Çelik', totalPrice: 1500, paid: false, status: 'Pending', createdAt: '2026-09-01' },
    { id: 'a3', customerName: 'Ödenmiş', totalPrice: 700, paid: true, status: 'Delivered', createdAt: '2026-08-01' },
    { id: 'a4', customerName: 'İptal', totalPrice: 800, paid: false, status: 'Cancelled', createdAt: '2026-08-01' },
    { id: 'a5', customerName: 'Mikro Faturası', totalPrice: 9000, status: 'Delivered', source: 'mikro-fatura', createdAt: '2026-07-01' },
    { id: 'a6', customerName: 'Mikro Siparişi', totalPrice: 9000, status: 'Pending', source: 'mikro-siparis', createdAt: '2026-07-01' },
    { id: 'a7', customerName: 'Tarihsiz', totalPrice: 400, paid: false, status: 'Pending' },
    { id: 'a8', customerName: 'Bozuk Tarih', totalPrice: 400, paid: false, status: 'Pending', createdAt: 'abc' },
    { id: 'a9', customerName: 'Tutarsız', totalPrice: null, paid: false, status: 'Pending', createdAt: '2026-09-10' },
  ];

  it('boş liste', () => {
    expect(tahsilatHatirlatma([], ESIK, SIMDI)).toEqual({ satirlar: [], kritik: 0, bakiye: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, tarihsiz: 0 });
  });

  it('ödenmiş, iptal ve Mikro kaynaklı (paid yokluğu = bilinmiyor) DIŞARIDA; tarihi çözülemeyen SAYILIR, listeye girmez', () => {
    const r = tahsilatHatirlatma(ACIK, ESIK, SIMDI);
    expect(r.satirlar.map(s => s.id)).toEqual(['a1', 'a2', 'a9']); // gün azalan sırada
    expect(r.tarihsiz).toBe(2);
  });

  it('gün farkı yerel güne göre (gunFarki): 01.08 → 43, 01.09 → 12, 10.09 → 3', () => {
    const r = tahsilatHatirlatma(ACIK, ESIK, SIMDI);
    expect(r.satirlar.map(s => s.gunGecti)).toEqual([43, 12, 3]);
    expect(r.satirlar[0]?.customerName).toBe('Şirin Yapı İnş.'); // orijinal alanlar korunur
  });

  it('dün 23:30 → bugün 00:30 = 1 gün (eski floor(ms) hesabı 0 diyordu — zaman.ts TR 3 saat tuzağı)', () => {
    const r = tahsilatHatirlatma([{ totalPrice: 10, paid: false, status: 'Pending', createdAt: new Date(2026, 8, 12, 23, 30) }], ESIK, new Date(2026, 8, 13, 0, 30));
    expect(r.satirlar[0]?.gunGecti).toBe(1);
  });

  it('kritik = üst eşiği (30) aşanlar; bakiye bilinen toplam + bilinmeyen sayacı (null tutar 0 DEĞİL)', () => {
    const r = tahsilatHatirlatma(ACIK, ESIK, SIMDI);
    expect(r.kritik).toBe(1);
    expect(r.bakiye).toEqual({ toplam: 6500, bilinen: 2, bilinmeyen: 1 });
  });

  it('eşik listesi boş/NaN ise kritik 0 (sayfadaki `days >= NaN` false davranışıyla aynı)', () => {
    expect(tahsilatHatirlatma(ACIK, [], SIMDI).kritik).toBe(0);
    expect(tahsilatHatirlatma(ACIK, [7, 15, NaN], SIMDI).kritik).toBe(0);
  });
});
