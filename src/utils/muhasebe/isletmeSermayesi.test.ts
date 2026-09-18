/**
 * isletmeSermayesi.test.ts — Muhasebe → "İşletme Sermayesi" sekmesinin (IsletmeSermayesiTab.tsx 16-40) ve
 * "Verilerden Doldur" ön-doldurmasının (AccountingModule.tsx 970-983 prefillWC) HESAP sözleşmesi
 * (Faz 3 2/n, 2026-09-14). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik: cariOran `kv > 0 ? donen / kv : 0` (borçsuz şirket "0.00 Riskli"), WCInput
 * `Number(x) || 0` (boşaltılan alan 0 olur) + `wc[field] || ''` (girilmiş 0 ile bilinmeyen aynı görünür),
 * prefill `Number(o.totalPrice) || 0` ve `(Number(q) || 0) * (Number(cost) || 0)` (tutarı bilinmeyen sipariş /
 * maliyeti girilmemiş kalem 0 sayılıp settings/workingCapital'a KALICI yazılıyordu).
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—'; oranın
 * paydası bilinmiyor ya da ≤ 0 ise null ('—'), "0.00" basılmaz.
 */
import { describe, it, expect } from 'vitest';
import {
  isletmeSermayesi, prefillDegerleri, wcGirdiOku, wcGirdiYaz,
  type WCKalemleri, type PrefillSiparis, type PrefillKalemi,
} from './isletmeSermayesi';
import { ekranTutari } from '../para';

const BILINMEYENLER: unknown[] = [undefined, null, '', NaN, 'abc', Infinity];
const ALANLAR = ['kasaBanka', 'ticariAlacaklar', 'stoklar', 'ticariBorclar', 'vergiSgk', 'krediler'] as const;

// ── Kalemler (₺) ────────────────────────────────────────────────────────────────────────────
/** Şirin İnşaat — dönen 1.000.000, KV 500.000, net 500.000, oran 2,00 → ideal */
const sirin: WCKalemleri = { kasaBanka: 250_000, ticariAlacaklar: 400_000, stoklar: 350_000, ticariBorclar: 300_000, vergiSgk: 50_000, krediler: 150_000 };
/** Çelik Yapı — dönen 480.000, KV 400.000, net 80.000, oran 1,20 → yeterli */
const celik: WCKalemleri = { kasaBanka: 80_000, ticariAlacaklar: 250_000, stoklar: 150_000, ticariBorclar: 220_000, vergiSgk: 30_000, krediler: 150_000 };
/** Yılmaz Hafriyat — dönen 300.000, KV 500.000, net -200.000, oran 0,60 → riskli */
const yilmaz: WCKalemleri = { kasaBanka: 50_000, ticariAlacaklar: 100_000, stoklar: 150_000, ticariBorclar: 350_000, vergiSgk: 50_000, krediler: 100_000 };

/**
 * ESKİ HESAP (IsletmeSermayesiTab.tsx 19-26, kelimesi kelimesine) — sayfa paritesi kanıtı.
 * Yalnız tamamen bilinen sayısal veride anlamlı.
 */
type WCSayilar = { [K in keyof WCKalemleri]: number };
function eskiHesap(wc: WCSayilar) {
  const donenVarliklar = wc.kasaBanka + wc.ticariAlacaklar + wc.stoklar;
  const kvYukumluluk = wc.ticariBorclar + wc.vergiSgk + wc.krediler;
  const netSermaye = donenVarliklar - kvYukumluluk;
  const cariOran = kvYukumluluk > 0 ? donenVarliklar / kvYukumluluk : 0;
  const durum = cariOran >= 1.5 ? 'ideal' : cariOran >= 1 ? 'yeterli' : 'riskli';
  return { donenVarliklar, kvYukumluluk, netSermaye, cariOran, durum };
}

describe('isletmeSermayesi — sayfa paritesi (tamamen bilinen veri)', () => {
  it.each([['Şirin İnşaat', sirin, 'ideal'], ['Çelik Yapı', celik, 'yeterli'], ['Yılmaz Hafriyat', yilmaz, 'riskli']] as const)(
    '%s: eski kodla birebir aynı dönen/KV/net/oran ve durum %s', (_ad, wc, beklenen) => {
      const eski = eskiHesap(wc as WCSayilar);
      const r = isletmeSermayesi(wc);
      expect(r.donen).toBe(eski.donenVarliklar);
      expect(r.kv).toBe(eski.kvYukumluluk);
      expect(r.net).toBe(eski.netSermaye);
      expect(r.cariOran).toBe(eski.cariOran);
      expect(r.durum).toBe(beklenen);
      expect(eski.durum).toBe(beklenen);
    });

  it('Şirin İnşaat rakamları: 1.000.000 / 500.000 / 500.000 / 2,00', () => {
    expect(isletmeSermayesi(sirin)).toEqual({ donen: 1_000_000, kv: 500_000, net: 500_000, cariOran: 2, durum: 'ideal' });
  });

  it('sayısal string kabul (DB/ayar dosyasından metin gelirse) — sayı ile aynı sonuç', () => {
    const metin: WCKalemleri = { kasaBanka: '250000', ticariAlacaklar: '400000', stoklar: '350000', ticariBorclar: '300000', vergiSgk: '50000', krediler: '150000' };
    expect(isletmeSermayesi(metin)).toEqual(isletmeSermayesi(sirin));
  });

  it('eşik sınırları: tam 1,5 → ideal; tam 1,0 → yeterli; 0,999 → riskli', () => {
    const kv = { ticariBorclar: 100_000, vergiSgk: 0, krediler: 0 };
    expect(isletmeSermayesi({ kasaBanka: 150_000, ticariAlacaklar: 0, stoklar: 0, ...kv }).durum).toBe('ideal');
    expect(isletmeSermayesi({ kasaBanka: 100_000, ticariAlacaklar: 0, stoklar: 0, ...kv }).durum).toBe('yeterli');
    expect(isletmeSermayesi({ kasaBanka: 99_900, ticariAlacaklar: 0, stoklar: 0, ...kv }).durum).toBe('riskli');
  });

  it('negatif net sermaye korunur (Yılmaz: -200.000), oran 0,60', () => {
    const r = isletmeSermayesi(yilmaz);
    expect(r.net).toBe(-200_000);
    expect(r.cariOran).toBeCloseTo(0.6, 10);
  });
});

describe('isletmeSermayesi — bilinmeyen 0 sayılmaz', () => {
  it.each(ALANLAR)('%s bilinmiyorsa (6 biçim) → durum "bilinmiyor", cariOran null, o taraf NaN', alan => {
    for (const b of BILINMEYENLER) {
      const r = isletmeSermayesi({ ...sirin, [alan]: b });
      expect(r.durum).toBe('bilinmiyor');
      expect(r.cariOran).toBeNull();
      expect(Number.isNaN(r.net)).toBe(true);
      const donenTarafi = alan === 'kasaBanka' || alan === 'ticariAlacaklar' || alan === 'stoklar';
      // mutasyon-ayırt-edici: `?? 0` geri gelirse taraf sonlu olur, öbür taraf ise bilinen kalır
      expect(Number.isNaN(donenTarafi ? r.donen : r.kv)).toBe(true);
      expect(Number.isFinite(donenTarafi ? r.kv : r.donen)).toBe(true);
    }
  });

  it('kasa bilinmiyorken KV yine de hesaplanır (500.000) — bilinen taraf gizlenmez', () => {
    const r = isletmeSermayesi({ ...sirin, kasaBanka: null });
    expect(r.kv).toBe(500_000);
    expect(Number.isNaN(r.donen)).toBe(true);
  });

  it('bilinen 0 bilinmeyen DEĞİLDİR: kasa 0 → dönen 750.000, durum ideal (1,5)', () => {
    const r = isletmeSermayesi({ ...sirin, kasaBanka: 0 });
    expect(r.donen).toBe(750_000);
    expect(r.cariOran).toBe(1.5);
    expect(r.durum).toBe('ideal');
  });
});

describe('isletmeSermayesi — oran paydası (KV) ≤ 0 → null, "0.00 Riskli" yok', () => {
  it('borçsuz şirket (KV 0, dönen > 0): cariOran null, durum "borcsuz" (eski: 0 → Riskli)', () => {
    const r = isletmeSermayesi({ kasaBanka: 250_000, ticariAlacaklar: 400_000, stoklar: 350_000, ticariBorclar: 0, vergiSgk: 0, krediler: 0 });
    expect(r).toEqual({ donen: 1_000_000, kv: 0, net: 1_000_000, cariOran: null, durum: 'borcsuz' });
    expect(eskiHesap({ kasaBanka: 250_000, ticariAlacaklar: 400_000, stoklar: 350_000, ticariBorclar: 0, vergiSgk: 0, krediler: 0 }).cariOran).toBe(0); // eski sahte "0.00"
  });

  it('başlangıç durumu (hepsi 0, henüz girilmemiş): net 0 GERÇEK 0, oran null, durum "borcsuz" — bilinmeyen değil', () => {
    const r = isletmeSermayesi({ kasaBanka: 0, ticariAlacaklar: 0, stoklar: 0, ticariBorclar: 0, vergiSgk: 0, krediler: 0 });
    expect(r).toEqual({ donen: 0, kv: 0, net: 0, cariOran: null, durum: 'borcsuz' });
  });

  it('negatif KV (hatalı giriş): oran null, durum "borcsuz"; net yine hesaplanır', () => {
    const r = isletmeSermayesi({ ...sirin, ticariBorclar: -600_000 });
    expect(r.kv).toBe(-400_000);
    expect(r.net).toBe(1_400_000);
    expect(r.cariOran).toBeNull();
    expect(r.durum).toBe('borcsuz');
  });
});

// ── Ön-doldurma: alacak = ödenmemiş + iptal değil + ödemesi Cetpa'da izlenen; stok = depo değeri ──
const sirinSiparis: PrefillSiparis = { id: 'S1', totalPrice: 120_000, paid: false, status: 'Delivered' };          // Şirin İnşaat, native
const celikSiparis: PrefillSiparis = { id: 'S2', totalPrice: '80000', paid: false, status: 'Shipped', source: 'shopify' }; // Çelik Yapı, sayısal string
const odenmis: PrefillSiparis = { id: 'S3', totalPrice: 55_000, paid: true, status: 'Delivered' };                  // ödenmiş → alacak değil
const iptal: PrefillSiparis = { id: 'S4', totalPrice: 40_000, paid: false, status: 'Cancelled' };                   // iptal → dışarı
const mikroFatura: PrefillSiparis = { id: 'MF-1', totalPrice: 999_999, status: 'Delivered', source: 'mikro-fatura' }; // paid alanı YOK — tahsilat Mikro'da
const mikroSiparis: PrefillSiparis = { id: 'MS-1', totalPrice: 777_777, paid: false, status: 'Pending', source: 'mikro-siparis' };
const sifirTutar: PrefillSiparis = { id: 'S5', totalPrice: 0, paid: false, status: 'Delivered' };                   // GERÇEK 0 — bilinen
const tutarsiz: PrefillSiparis = { id: 'S6', totalPrice: null, paid: false, status: 'Delivered' };                  // bilinmeyen
const siparisler = [sirinSiparis, celikSiparis, odenmis, iptal, mikroFatura, mikroSiparis, sifirTutar, tutarsiz];

const cimento: PrefillKalemi = { quantity: 200, costPrice: 150 };        // Çimento 42.5 — 30.000
const demir: PrefillKalemi = { quantity: '50', costPrice: '1200' };      // Demir 12mm — 60.000 (sayısal string)
const tugla: PrefillKalemi = { quantity: 1000, costPrice: null };        // Tuğla — maliyet girilmemiş
const kum: PrefillKalemi = { quantity: 0, costPrice: 900 };              // Kum m³ — 0 adet, bilinen 0 değer
const kalemler = [cimento, demir, tugla, kum];

/** ESKİ HESAP (AccountingModule.tsx 976-979, kelimesi kelimesine) — parite kanıtı. */
function eskiPrefill(orders: readonly PrefillSiparis[], items: readonly PrefillKalemi[]) {
  const ar = orders
    .filter(o => !o.paid && o.status !== 'Cancelled' && !(o.source ?? '').startsWith('mikro'))
    .reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
  const stok = items.reduce((s, w) => s + (Number(w.quantity) || 0) * (Number(w.costPrice) || 0), 0);
  return { ar, stok };
}

describe('prefillDegerleri — alacak (dışlamalar aynen korunur)', () => {
  it('Şirin 120.000 + Çelik 80.000 = 200.000 + sıfır tutarlı sipariş; ödenmiş/iptal/Mikro dışarı; 1 tutarsız SAYILIR', () => {
    const { alacak } = prefillDegerleri(siparisler, []);
    expect(alacak).toEqual({ toplam: 200_000, bilinen: 3, bilinmeyen: 1 });
  });

  it('sayfa paritesi: tamamen bilinen siparişlerde eski reduce ile aynı toplam', () => {
    const bilinenler = [sirinSiparis, celikSiparis, odenmis, iptal, mikroFatura, mikroSiparis, sifirTutar];
    const { alacak } = prefillDegerleri(bilinenler, []);
    expect(alacak.toplam).toBe(eskiPrefill(bilinenler, []).ar);
    expect(alacak.bilinmeyen).toBe(0);
  });

  it('Mikro kaynaklı sipariş (paid alanı yok) ASLA alacak sayılmaz — 2026-09-04 ₺17,6M sahte alacak dersi', () => {
    const { alacak } = prefillDegerleri([mikroFatura, mikroSiparis], []);
    expect(alacak).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(alacak)).toBe(0); // hiç izlenen sipariş yok → gerçek 0, '—' değil
  });

  it('tek ödenmemiş siparişin tutarı bilinmiyorsa ekran "—" (eski kod 0 yazıyordu) — mutasyon-ayırt-edici', () => {
    const { alacak } = prefillDegerleri([tutarsiz, odenmis, iptal], []);
    expect(alacak).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(alacak))).toBe(true);
    expect(eskiPrefill([tutarsiz, odenmis, iptal], []).ar).toBe(0); // eski sahte 0
  });

  it('bilinmeyen 6 biçimin hiçbiri toplama girmez, hepsi sayılır', () => {
    const liste = BILINMEYENLER.map((b, i) => ({ id: `B${i}`, totalPrice: b, paid: false, status: 'Delivered' }));
    const { alacak } = prefillDegerleri([...liste, sirinSiparis], []);
    expect(alacak).toEqual({ toplam: 120_000, bilinen: 1, bilinmeyen: BILINMEYENLER.length });
  });

  it('boş sipariş listesi → gerçek 0 (hareketsiz), bilinmeyen 0', () => {
    expect(prefillDegerleri([], []).alacak).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });
});

describe('prefillDegerleri — stok (depoDeger.depoToplamlari üzerinden)', () => {
  it('Çimento 30.000 + Demir 60.000 + Kum 0 = 90.000; Tuğla maliyetsiz → 1 bilinmeyen', () => {
    const { stok } = prefillDegerleri([], kalemler);
    expect(stok).toEqual({ toplam: 90_000, bilinen: 3, bilinmeyen: 1 });
    expect(ekranTutari(stok)).toBe(90_000); // kısmi toplam + sayfa notu "1 kayıt tutarsız"
  });

  it('sayfa paritesi: maliyeti bilinen kalemlerde eski reduce ile aynı değer', () => {
    const bilinenler = [cimento, demir, kum];
    const { stok } = prefillDegerleri([], bilinenler);
    expect(stok.toplam).toBe(eskiPrefill([], bilinenler).stok);
    expect(stok.bilinmeyen).toBe(0);
  });

  it('tüm kalemler maliyetsiz → ekran "—" (eski: 0 yazıp cari oranı şişiriyordu)', () => {
    const { stok } = prefillDegerleri([], [tugla, { quantity: 5, costPrice: 'abc' }]);
    expect(stok).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
    expect(Number.isNaN(ekranTutari(stok))).toBe(true);
    expect(eskiPrefill([], [tugla]).stok).toBe(0); // eski sahte 0
  });

  it('adedi bilinmeyen kalem de bilinmeyendir (`null * 900 === 0` tuzağı yok)', () => {
    const { stok } = prefillDegerleri([], [{ quantity: null, costPrice: 900 }, cimento]);
    expect(stok).toEqual({ toplam: 30_000, bilinen: 1, bilinmeyen: 1 });
  });

  it('boş depo → gerçek 0', () => {
    expect(prefillDegerleri([], []).stok).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });

  it('alacak ve stok birbirinden bağımsız hesaplanır (aynı çağrıda)', () => {
    const r = prefillDegerleri(siparisler, kalemler);
    expect(r.alacak.toplam).toBe(200_000);
    expect(r.stok.toplam).toBe(90_000);
    expect(r.alacak.bilinmeyen + r.stok.bilinmeyen).toBe(2); // toast: "2 kayıt tutarsız, dahil edilmedi"
  });
});

describe('wcGirdiOku / wcGirdiYaz — form alanı (eski `Number(x) || 0` / `wc[field] || \'\'`)', () => {
  it('boş ya da geçersiz metin → NaN (bilinmeyen), 0 DEĞİL', () => {
    for (const s of ['', '   ', 'abc']) expect(Number.isNaN(wcGirdiOku(s))).toBe(true);
  });

  it('sayısal metin → sayı; "0" gerçek 0; ondalık ve negatif korunur', () => {
    expect(wcGirdiOku('1500')).toBe(1500);
    expect(wcGirdiOku('0')).toBe(0);
    expect(wcGirdiOku('1250.75')).toBe(1250.75);
    expect(wcGirdiOku('-300')).toBe(-300);
  });

  it('yaz: bilinen sayı metne (0 dahil — eski `|| \'\'` sıfırı gizliyordu); bilinmeyen → boş', () => {
    expect(wcGirdiYaz(1500)).toBe('1500');
    expect(wcGirdiYaz(0)).toBe('0');
    expect(wcGirdiYaz('250000')).toBe('250000');
    for (const b of BILINMEYENLER) expect(wcGirdiYaz(b)).toBe('');
  });

  it('gidiş-dönüş: oku(yaz(x)) === x bilinen için; bilinmeyen boş kalır', () => {
    expect(wcGirdiOku(wcGirdiYaz(87_500))).toBe(87_500);
    expect(Number.isNaN(wcGirdiOku(wcGirdiYaz(null)))).toBe(true);
  });
});
