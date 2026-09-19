/**
 * raporVeriKatmani.test.ts — Pano/Rapor VERİ KATMANI sözleşmesi (Faz 3 5/n, grup
 * "raporVeriKatmani", 2026-09-19). ÖNCE YAZILDI (kırmızı görüldü, sonra modül).
 *
 * Sahte kesinlik siteleri (sayfa DIŞI okuma katmanı — DashboardPage'e DOKUNULMADI):
 *   src/components/reports/useReportsData.ts
 *     156  totalRevenueTRY = orders.filter(...).reduce((s,o) => s + (Number(o.totalPrice) || 0), 0)
 *     163  avgOrderValueTRY = totalOrders > 0 ? totalRevenueTRY / totalOrders : 0
 *     189  salesByDate:  acc[dateKey].total += (Number(o.totalPrice) || 0)
 *     217  topCustomers: acc[k].total += Number(o.totalPrice) || 0
 *     306  brutMarj toplamCiro = list.reduce((s,o) => s + (o.totalPrice || 0), 0)
 *     309  brutMarj ciro      = kapsamli.reduce((s,o) => s + (o.totalPrice || 0), 0)
 *       → RaporlarPage Mikro satış faturalarını pseudo-sipariş olarak EKLİYOR ve
 *         useMikroFaturalar `tutar`ı artık bilinmiyorsa NaN veriyor (Faz 3 2/n).
 *         `|| 0` o NaN'ı "₺0 biliniyor"a çeviriyor: ciro/AOV/trend/top-müşteri
 *         sessizce EKSİK çıkıyor, kaç faturanın dışarıda kaldığı hiç yazmıyor.
 *   src/hooks/useSekmeVerileri.ts
 *     134  balance: Number(d.data().balance) || 0                                  (bankAccounts)
 *     141  cost: Number(d.data().cost) || Number(d.data().edinimBedeli) || 0       (sabitKiymetler)
 *     142  depreciation: Number(d.data().birikimliAmortisman) || 0
 *       → Bilanço (Phase 547) tüketicisi ZATEN NaN-farkında (dovizTopla/duranVarlik/
 *         ekranTutari); sahte sıfır OKUMA anında üretilip o korumaları etkisiz
 *         kılıyor — yarım düzeltme sınıfının aynısı.
 *   src/components/BankStatementImportModal.tsx
 *     137  balance: mapping.balance ? parseTRNumber(...) : 0
 *       → CSV'de bakiye sütunu YOKSA her harekete "bakiye ₺0" YAZILIYOR.
 *
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen sayı 0 DEĞİL bilinmiyordur —
 * toplama girmez, SAYILIR, ekranda '—' ya da "N kayıt tutarsız" notu olur; grafikte
 * `null`'dur (çizgi sıfıra çakılmaz); yeni kayda hiç YAZILMAZ.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari, tamTutar, sayiSirala, type Tutar } from '../para';
import { paraYaz } from '../currency';
import { dovizTopla, duranVarlik } from '../muhasebe/nakitBilanco';
import { parseTRNumber } from '../trParse';
import {
  raporSiparisi, raporCirosu, ortalamaSiparis, BOS_TUTAR, kovayaEkle, grafikDegeri,
  bankaHesabiOku, sabitKiymetOku, ekstreBakiyesi, ekstreBakiyeYamasi,
} from './raporVeriKatmani';

// ── Fikstürler (Türkçe, inşaat malzemesi toptancısı) ────────────────────────────────────────

/** Cetpa-native sipariş: tutar biliniyor. */
const sirin = { customerName: 'Şirin İnşaat', status: 'Delivered', totalPrice: 80_000.02 };
/** Mikro satış faturasından türetilen pseudo-sipariş: cha_meblag NULL → tutar NaN. */
const mikroTutarsiz = { customerName: 'Yıldız Yapı', status: 'Delivered', totalPrice: NaN, totalAmount: NaN, source: 'mikro-fatura' };
const mikroTutarsiz2 = { customerName: 'Kaya Nakliyat', status: 'Delivered', totalPrice: NaN, totalAmount: NaN, source: 'mikro-fatura' };
const ozBeton = { customerName: 'Öz Beton', status: 'Shipped', totalPrice: 19_999.98 };
const iptal = { customerName: 'Demir Hafriyat', status: 'Cancelled', totalPrice: 15_000 };

// ── raporSiparisi: sipariş tutarı seçicisi ──────────────────────────────────────────────────

describe('raporSiparisi', () => {
  it('SAYFA PARİTESİ — bilinen tutar eskiyle birebir aynı (Number(o.totalPrice) || 0)', () => {
    expect(raporSiparisi(sirin)).toBe(80_000.02);
    expect(raporSiparisi({ totalPrice: '12500' })).toBe(12_500); // sayısal string: eski Number() de 12500 veriyordu
  });

  it('meşru ₺0 sipariş 0 KALIR (bilinmeyene düşmez)', () => {
    expect(raporSiparisi({ totalPrice: 0 })).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ — tutarı bilinmeyen Mikro faturası 0 SAYILMAZ', () => {
    expect(raporSiparisi(mikroTutarsiz)).toBeNaN();
    expect(raporSiparisi({})).toBeNaN();
    expect(raporSiparisi({ totalPrice: null })).toBeNaN();
    expect(raporSiparisi({ totalPrice: 'bilinmiyor' })).toBeNaN();
  });

  it('BİLİNÇLİ FARK — totalPrice yoksa totalAmount (siparis.ts `siparisTutari` tek kaynağı)', () => {
    // Eski site yalnız totalPrice'a bakıyordu: bu kayıt ciroya ₺0 giriyordu.
    expect(raporSiparisi({ totalAmount: 5_000 })).toBe(5_000);
    // `??` önceliği: meşru 0 totalAmount'a DÜŞMEZ (`||` düşürüyordu).
    expect(raporSiparisi({ totalPrice: 0, totalAmount: 5_000 })).toBe(0);
  });
});

// ── raporCirosu / ortalamaSiparis: KPI kartları ─────────────────────────────────────────────

describe('raporCirosu', () => {
  it('SAYFA PARİTESİ — hepsi bilinenken toplam eskiyle birebir; iptal hariç', () => {
    const liste = [sirin, ozBeton, iptal];
    const eski = liste.filter(o => o.status !== 'Cancelled').reduce((s, o) => s + (Number(o.totalPrice) || 0), 0);
    const t = raporCirosu(liste);
    expect(ekranTutari(t)).toBe(eski);
    expect(ekranTutari(t)).toBe(100_000);
    expect(t.bilinmeyen).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ — tutarsız kayıt toplama girmez, SAYILIR (kısmi toplam + not)', () => {
    const t = raporCirosu([sirin, mikroTutarsiz]);
    expect(t.toplam).toBe(80_000.02);   // eski `|| 0` de 80.000,02 verirdi AMA
    expect(t.bilinmeyen).toBe(1);       // ← "1 kayıt tutarsız" notu ancak bu sayaçla yazılabilir
    expect(t.bilinen).toBe(1);
  });

  it('MUTASYON-AYIRT EDİCİ — hiç bilinen yoksa ekran ₺0 DEĞİL "—"', () => {
    const t = raporCirosu([mikroTutarsiz, mikroTutarsiz2]);
    expect(ekranTutari(t)).toBeNaN();
    expect(paraYaz(ekranTutari(t))).toBe('—');
    expect(t.bilinmeyen).toBe(2);
  });

  it('boş liste gerçek ₺0 (henüz sipariş yok)', () => {
    expect(ekranTutari(raporCirosu([]))).toBe(0);
  });
});

describe('ortalamaSiparis (TÜRETME — tamTutar sözleşmesi)', () => {
  it('SAYFA PARİTESİ — hepsi bilinenken ortalama eskiyle birebir', () => {
    const ciro = raporCirosu([{ status: 'Delivered', totalPrice: 100 }, { status: 'Delivered', totalPrice: 200 }, { status: 'Delivered', totalPrice: 300 }]);
    expect(ortalamaSiparis(ciro, 3)).toBe(200);
  });

  it('MUTASYON-AYIRT EDİCİ — tek kayıt bile bilinmiyorsa ortalama HESAPLANMAZ', () => {
    const ciro = raporCirosu([{ status: 'Delivered', totalPrice: 100 }, { status: 'Delivered', totalPrice: 200 }, mikroTutarsiz]);
    // Eski davranış: (100 + 200 + 0) / 3 = 100 → gerçek ortalamanın yarısı, "biliniyor" gibi basılıyordu.
    expect(ortalamaSiparis(ciro, 3)).toBeNaN();
    expect(paraYaz(ortalamaSiparis(ciro, 3))).toBe('—');
  });

  it('sipariş yokken ortalama "—" (0\'a bölme; BİLİNÇLİ FARK: eski ₺0,00 basıyordu)', () => {
    expect(ortalamaSiparis(BOS_TUTAR, 0)).toBeNaN();
  });
});

// ── kovayaEkle / grafikDegeri: günlük trend + top müşteri kovaları ───────────────────────────

describe('kovayaEkle + grafikDegeri (recharts)', () => {
  it('SAYFA PARİTESİ — bilinen kovada toplam eskiyle birebir (acc[key].total += ...)', () => {
    let kova = BOS_TUTAR;
    for (const o of [{ totalPrice: 1_250 }, { totalPrice: 3_750 }]) kova = kovayaEkle(kova, raporSiparisi(o));
    expect(grafikDegeri(kova)).toBe(5_000);
    expect(kova.bilinen).toBe(2);
  });

  it('MUTASYON-AYIRT EDİCİ — tümü tutarsız gün grafikte `null` (0 DEĞİL: çizgi sıfıra çakılmaz)', () => {
    let kova = BOS_TUTAR;
    kova = kovayaEkle(kova, raporSiparisi(mikroTutarsiz));
    expect(kova.bilinmeyen).toBe(1);
    expect(grafikDegeri(kova)).toBeNull();
    expect(grafikDegeri(kova)).not.toBe(0);
  });

  it('kısmi bilinen kova kısmi toplam gösterir (sayaç notu çağıranda)', () => {
    let kova = BOS_TUTAR;
    kova = kovayaEkle(kova, raporSiparisi(sirin));
    kova = kovayaEkle(kova, raporSiparisi(mikroTutarsiz));
    expect(grafikDegeri(kova)).toBe(80_000.02);
    expect(kova.bilinmeyen).toBe(1);
  });

  it('BOS_TUTAR paylaşılmaz — kovayaEkle yeni nesne döndürür (kovalar birbirini kirletmez)', () => {
    const a = kovayaEkle(BOS_TUTAR, 10);
    const b = kovayaEkle(BOS_TUTAR, 20);
    expect(a.toplam).toBe(10);
    expect(b.toplam).toBe(20);
    expect(BOS_TUTAR.toplam).toBe(0);
  });

  it('top-müşteri sıralaması: tutarsız müşteri SONDA (azalanda da) — `b.total - a.total` değil', () => {
    const musteriler = [
      { name: 'Yıldız Yapı', total: NaN },
      { name: 'Şirin İnşaat', total: 80_000.02 },
      { name: 'Öz Beton', total: 19_999.98 },
    ];
    const sirali = [...musteriler].sort((a, b) => sayiSirala(a.total, b.total, true));
    expect(sirali.map(m => m.name)).toEqual(['Şirin İnşaat', 'Öz Beton', 'Yıldız Yapı']);
  });
});

// ── bankaHesabiOku: bankAccounts okuması (Bilanço → Kasa/Bankalar) ──────────────────────────

describe('bankaHesabiOku', () => {
  it('SAYFA PARİTESİ — bilinen doküman eskiyle birebir', () => {
    const h = bankaHesabiOku({ id: 'b1', bankName: 'İş Bankası', accountType: 'Vadesiz', balance: 12_500.75, currency: 'TRY' });
    expect(h).toEqual({ id: 'b1', bankName: 'İş Bankası', accountType: 'Vadesiz', balance: 12_500.75, currency: 'TRY' });
  });

  it('PARİTE — ad/tür/birim yedekleri korundu (bank → bankName, Vadesiz, TRY, "—")', () => {
    expect(bankaHesabiOku({ id: 'b2', bank: 'Ziraat Bankası', balance: 0 }))
      .toEqual({ id: 'b2', bankName: 'Ziraat Bankası', accountType: 'Vadesiz', balance: 0, currency: 'TRY' });
    expect(bankaHesabiOku({ id: 'b3', balance: 1 }).bankName).toBe('—');
  });

  it('PARİTE — sayısal string bakiye sayıya çevrilir (eski Number() gibi)', () => {
    expect(bankaHesabiOku({ id: 'b4', balance: '2500' }).balance).toBe(2_500);
  });

  it('meşru ₺0 bakiye 0 KALIR', () => {
    expect(bankaHesabiOku({ id: 'b5', balance: 0 }).balance).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ — bakiyesi okunamayan hesap ₺0 SAYILMAZ, bilançoda SAYILIR', () => {
    for (const ham of [undefined, null, '', 'bilinmiyor', {}]) {
      expect(bankaHesabiOku({ id: 'bx', balance: ham }).balance).toBeNaN();
    }
    const hesaplar = [
      bankaHesabiOku({ id: 'b1', bankName: 'İş Bankası', accountType: 'Vadesiz', balance: 12_500.75, currency: 'TRY' }),
      bankaHesabiOku({ id: 'b2', bankName: 'Garanti', accountType: 'Vadesiz', currency: 'TRY' }), // balance alanı YOK
    ];
    const t = dovizTopla(hesaplar, b => b.balance, b => b.currency, { USD: 34 });
    expect(t.toplam).toBe(12_500.75);
    expect(t.bilinmeyen).toBe(1);   // eski `|| 0` ile 0 olurdu: "2 hesap, hepsi biliniyor" yalanı
  });

  it('döviz hesabı birimiyle taşınır (kur yoksa toplamda değil kurYok\'ta)', () => {
    const usd = bankaHesabiOku({ id: 'b9', bankName: 'Akbank', balance: 1_000, currency: 'USD' });
    expect(usd.currency).toBe('USD');
    expect(dovizTopla([usd], b => b.balance, b => b.currency, null).kurYok).toBe(1);
  });
});

// ── sabitKiymetOku: sabitKiymetler okuması (Bilanço → Duran Varlıklar) ──────────────────────

describe('sabitKiymetOku', () => {
  it('GERÇEK ALAN ADLARI — SabitKiymetModule/Mikro demirbaş dokümanı okunur (ad/alisBedeli/birikmisSalinma)', () => {
    // BİLİNÇLİ FARK: eski okuma `name`/`cost`/`edinimBedeli`/`birikimliAmortisman` arıyordu;
    // bu adlar kod tabanında HİÇBİR yerde YAZILMIYOR → her demirbaş "₺0 maliyet, ad '—'" okunuyordu.
    expect(sabitKiymetOku({ id: 'dm1', ad: 'Forklift 2.5 Ton', alisBedeli: 250_000, birikmisSalinma: 50_000 }))
      .toEqual({ id: 'dm1', name: 'Forklift 2.5 Ton', cost: 250_000, depreciation: 50_000 });
    expect(duranVarlik([sabitKiymetOku({ id: 'dm1', ad: 'Forklift 2.5 Ton', alisBedeli: 250_000, birikmisSalinma: 50_000 })]).toplam)
      .toBe(200_000);
  });

  it('PARİTE — eski alan adları da okunur (name/cost/birikimliAmortisman)', () => {
    expect(sabitKiymetOku({ id: 'dm2', name: 'Vinç', cost: 1_000_000, birikimliAmortisman: 200_000 }))
      .toEqual({ id: 'dm2', name: 'Vinç', cost: 1_000_000, depreciation: 200_000 });
  });

  it('MUTASYON-AYIRT EDİCİ — meşru ₺0 maliyet yedeğe DÜŞMEZ (`||` zinciri düşürüyordu)', () => {
    expect(sabitKiymetOku({ id: 'dm3', cost: 0, edinimBedeli: 900_000 }).cost).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ — maliyeti bilinmeyen demirbaş ₺0 SAYILMAZ, bilançoda SAYILIR', () => {
    const k = sabitKiymetOku({ id: 'dm4', ad: 'Beton Mikseri' });
    expect(k.cost).toBeNaN();
    expect(k.depreciation).toBeNaN();
    const t = duranVarlik([
      sabitKiymetOku({ id: 'dm1', ad: 'Forklift 2.5 Ton', alisBedeli: 250_000, birikmisSalinma: 50_000 }),
      k,
    ]);
    expect(t.toplam).toBe(200_000);
    expect(t.bilinmeyen).toBe(1);   // eski `|| 0` ile net ₺0 "biliniyor" sayılıp toplama giriyordu
    expect(ekranTutari(t)).toBe(200_000);
  });

  it('MUTASYON-AYIRT EDİCİ — amortismanı bilinmeyen demirbaş net değere TAM maliyetle girmez', () => {
    const t = duranVarlik([sabitKiymetOku({ id: 'dm5', ad: 'Kompresör', alisBedeli: 40_000 })]);
    expect(t.bilinmeyen).toBe(1);
    expect(ekranTutari(t)).toBeNaN();
    expect(paraYaz(ekranTutari(t))).toBe('—');
  });

  // ── birikmisSalinma === 0 ⇒ "HESAPLANSIN" (2026-09-19 düzeltmesi) ────────────────────────
  // Bu blok eskiden 0'ı BİLİNEN sıfır amortisman sayıyordu; forma girilen her demirbaş
  // (form varsayılanı `birikmisSalinma: 0`) Bilanço'ya BRÜT bedeliyle giriyordu.
  const BUGUN_DM = new Date(2026, 8, 19);

  it('MUTASYON-AYIRT EDİCİ — birikmisSalinma 0 "hesaplansın" demektir, BİLİNEN 0 değil', () => {
    const forklift = { id: 'dm6', ad: 'Forklift', alisBedeli: 1_200_000, alisTarihi: '2022-09-19', faydaliOmur: 5, amortYontemi: 'Doğrusal', birikmisSalinma: 0 };
    const k = sabitKiymetOku(forklift, BUGUN_DM);
    expect(k.depreciation).toBeCloseTo(960_000, -3);       // eski okuma 0 diyordu
    // Bilanço neti artık SabitKiymet listesindeki net defter değeriyle AYNI.
    expect(tamTutar(duranVarlik([k]))).toBeCloseTo(240_000, -3);
    expect(tamTutar(duranVarlik([k]))).not.toBeCloseTo(1_200_000, -3);
  });

  it('manuel override (> 0) girilmişse hesap YAPILMAZ, o değer kullanılır', () => {
    const k = sabitKiymetOku({ id: 'dm7', ad: 'Vinç', alisBedeli: 1_000_000, alisTarihi: '2020-01-01', faydaliOmur: 10, amortYontemi: 'Doğrusal', birikmisSalinma: 150_000 }, BUGUN_DM);
    expect(k.depreciation).toBe(150_000);
  });

  it('alış tarihi/ömrü olmayan (Mikro kolonu çözülemeyen) demirbaş amortismanı BİLİNMEZ', () => {
    const k = sabitKiymetOku({ id: 'dm8', ad: 'Palet Arabası', alisBedeli: 8_000, birikmisSalinma: 0 }, BUGUN_DM);
    expect(k.depreciation).toBeNaN();
    expect(duranVarlik([k]).bilinmeyen).toBe(1);
    expect(paraYaz(ekranTutari(duranVarlik([k])))).toBe('—');
  });

  it('adı bilinmeyen demirbaş "—" (parite)', () => {
    expect(sabitKiymetOku({ id: 'dm7' }).name).toBe('—');
  });
});

// ── ekstreBakiyesi / ekstreBakiyeYamasi: banka CSV içe aktarma ───────────────────────────────

describe('ekstreBakiyesi', () => {
  it('SAYFA PARİTESİ — Türk biçimli bakiye eskiyle birebir (parseTRNumber)', () => {
    expect(ekstreBakiyesi('12.500,00')).toBe(parseTRNumber('12.500,00'));
    expect(ekstreBakiyesi('12.500,00')).toBe(12_500);
    expect(ekstreBakiyesi('-1.234,56')).toBe(-1_234.56);
  });

  it('meşru 0,00 bakiye BİLİNEN 0\'dır', () => {
    expect(ekstreBakiyesi('0,00')).toBe(0);
  });

  it('MUTASYON-AYIRT EDİCİ — boş / sayısız hücre ₺0 DEĞİL bilinmiyor', () => {
    // parseTRNumber bu girdilerin hepsine 0 döner; ayrımı burada yapıyoruz.
    for (const ham of ['', '   ', '—', '-', 'N/A', undefined, null]) {
      expect(ekstreBakiyesi(ham)).toBeNull();
    }
  });
});

describe('ekstreBakiyeYamasi (YENİ KAYIT — bilinmeyen alan YAZILMAZ)', () => {
  it('bakiye biliniyorsa yazılır', () => {
    expect(ekstreBakiyeYamasi('12.500,00')).toEqual({ balance: 12_500 });
    expect(ekstreBakiyeYamasi('0,00')).toEqual({ balance: 0 });
  });

  it('MUTASYON-AYIRT EDİCİ — bakiye sütunu eşlenmemişse alan HİÇ yazılmaz (eski: balance 0)', () => {
    expect(ekstreBakiyeYamasi(undefined)).toEqual({});
    expect('balance' in ekstreBakiyeYamasi(undefined)).toBe(false);
    expect(ekstreBakiyeYamasi('')).toEqual({});
  });

  it('içe aktarılan hareket gövdesinde sahte ₺0 bakiye yok', () => {
    const govde = { accountId: 'b1', date: '2026-09-19', amount: -4_500, ...ekstreBakiyeYamasi(undefined) };
    expect(govde).not.toHaveProperty('balance');
  });
});

// ── Tip köprüsü: modül Tutar sözleşmesini bozmaz ────────────────────────────────────────────

describe('Tutar sözleşmesi', () => {
  it('raporCirosu bir Tutar döndürür (ekranTutari/tamTutar ile kullanılabilir)', () => {
    const t: Tutar = raporCirosu([sirin, mikroTutarsiz]);
    expect(Object.keys(t).sort()).toEqual(['bilinen', 'bilinmeyen', 'toplam']);
    expect(ekranTutari(t)).toBe(80_000.02); // EKRAN: kısmi toplam + not
    expect(tamTutar(t)).toBeNaN();          // TÜRETME: hesaplanmaz
  });
});
