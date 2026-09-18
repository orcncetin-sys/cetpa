/**
 * butceGerceklesme.test.ts — AccountingModule "Bütçe" sekmesi (ButceTab: kalem başına gerçekleşen çubuğu +
 * "Genel Bütçe Durumu" halkası) hesabının sözleşmesi (Faz 3 2/n, 2026-09-14). ÖNCE YAZILDI — modül yokken
 * kırmızı görüldü.
 *
 * Sayfadaki sahte kesinlik (src/components/accounting/ButceTab.tsx 40-95):
 *   • 46 / 89  `reduce((sum, e) => sum + (e.borc || 0), 0)`  → borcu bilinmeyen (DB null) fiş 0 sayılıp
 *     gerçekleşen eksik çıkıyor; sayısal string ('1500') reduce'a metin olarak giriyordu ('01500').
 *   • 48       `b.amount > 0 ? … : 0`                          → bütçesi 0/null/okunamayan kalem "%0" (hiç
 *     bütçenin %0'ı) ve çubuk boş = "harcama yok" izlenimi.
 *   • 86       `budgets.reduce((sum, b) => sum + b.amount, 0)` → amount null → 0 (JS `+ null`), undefined →
 *     NaN → halka "%NaN".
 *   • 92       `totalBudget > 0 ? … : 0`                       → toplam bütçe bilinmiyorken "%0 kullanıldı".
 * Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR, ekranda '—' ya da
 * "N kayıt tutarsız". Oran TÜRETMEDİR: bütçe bilinmiyor/≤0 ya da gerçekleşen bir kayıt bile bilinmiyorsa
 * null ('—'), "%0" basılmaz. Boş dönem GERÇEK %0 (harcama yok).
 * Dışlamalar AYNEN korunur: kategori tam eşleşme + tarih önek eşleşmesi (`date.startsWith(period)`).
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import { paraYaz } from '../currency';
import {
  donemFisleri, butceYuzdesi, kalemGerceklesme, butceGerceklesme,
  type BgButce, type BgFis,
} from './butceGerceklesme';

/**
 * Fikstür tipi: modülün OKUDUĞU üç alan (`BgFis`) + yalnız bu testin okuduğu `aciklama` etiketi.
 * `BgFis` kasten minimaldir (hesapta okunmayan alan tip sözleşmesine girmez); `donemFisleri` jenerik
 * olduğu için çağıranın ZENGİN tipini geri verir — aşağıdaki `.map(f => f.aciklama)` bunu doğrular.
 */
type TestFis = BgFis & { aciklama: string };

// Eylül 2026 — Şirin İnşaat'ın Cetpa'ya kestiği personel/genel gider fişleri, Çelik Yapı'ya çimento satışı
const personelBordro: TestFis   = { kategori: 'Ödeme', date: '2026-09-05', borc: 30000, aciklama: 'Eylül bordro' };
const personelSgk: TestFis      = { kategori: 'Ödeme', date: '2026-09-20', borc: 15000, aciklama: 'SGK primi' };
const personelAgustos: TestFis  = { kategori: 'Ödeme', date: '2026-08-28', borc: 9000, aciklama: 'Ağustos bordro' };   // dönem dışı
const kiraTutarsiz: TestFis     = { kategori: 'Gider', date: '2026-09-01', borc: null, aciklama: 'Şirin İnşaat kira — tutar girilmemiş' }; // bilinmeyen
const elektrik: TestFis         = { kategori: 'Gider', date: '2026-09-12', borc: 5000, aciklama: 'Elektrik' };
const reklamAgustos: TestFis    = { kategori: 'Diğer', date: '2026-08-15', borc: 12000, aciklama: 'Reklam' };            // bütçe aşımı
const celikSatis: TestFis       = { kategori: 'Satış', date: '2026-09-10', borc: 100000, aciklama: 'Çelik Yapı çimento' }; // kategori uymaz
const tarihsizOdeme: TestFis    = { kategori: 'Ödeme', date: '', borc: 777, aciklama: 'tarihsiz' };                     // hiçbir döneme girmez
const tarihNullOdeme: TestFis   = { kategori: 'Ödeme', date: null, borc: 888, aciklama: 'DB null tarih' };              // eski kod burada ÇÖKÜYORDU

const fisler: TestFis[] = [personelBordro, personelSgk, personelAgustos, kiraTutarsiz, elektrik, reklamAgustos, celikSatis, tarihsizOdeme, tarihNullOdeme];

/**
 * Eski sayfa formülü tarihi string olmayan fişte `null.startsWith(...)` ile ÇÖKER (TypeError: tüm sekme
 * beyaz ekran) — modülün düzelttiği arızanın ta kendisi, bu yüzden aşağıda ayrı bir vakası var. Parite
 * KARŞILAŞTIRMALARI o fiş hariç listeyle yapılır; yeni modül aynı testlerde tam `fisler` ile çağrılır
 * (çökmez, fişi dönem dışı sayar) — yani karşılaştırılan iki taraf da aynı fişleri görür.
 */
const eskiyeUyanFisler: BgFis[] = fisler.filter(f => f !== tarihNullOdeme);

const personelButcesi: BgButce = { id: 'b-personel', category: 'Ödeme', amount: 50000, period: '2026-09' };
const giderButcesi: BgButce    = { id: 'b-gider',    category: 'Gider', amount: 20000, period: '2026-09' };
const reklamButcesi: BgButce   = { id: 'b-reklam',   category: 'Diğer', amount: 10000, period: '2026-08' };

/** Sayfanın ESKİ formülü (ButceTab 44-48, 86-92) — parite referansı; `|| 0` kasten korunuyor. */
function eskiSayfa(budgets: BgButce[], entries: BgFis[]) {
  const actual = (b: BgButce) => entries
    .filter(e => e.kategori === b.category && (e.date as string).startsWith(b.period as string))
    .reduce((sum, e) => sum + ((e.borc as number) || 0), 0);
  const percent = (b: BgButce) => (b.amount as number) > 0 ? Math.min(100, Math.round((actual(b) / (b.amount as number)) * 100)) : 0;
  const totalBudget = budgets.reduce((sum, b) => sum + (b.amount as number), 0);
  const totalActual = budgets.reduce((sum, b) => sum + actual(b), 0);
  const totalPercent = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;
  return { actual, percent, totalBudget, totalActual, totalPercent };
}

describe('donemFisleri — kategori tam eşleşme + tarih ÖNEK eşleşmesi (sayfa paritesi)', () => {
  it('kategori eşit ve date "YYYY-MM" ile başlıyorsa dahil; başka ay / başka kategori hariç', () => {
    expect(donemFisleri(fisler, 'Ödeme', '2026-09').map(f => f.aciklama)).toEqual(['Eylül bordro', 'SGK primi']);
    expect(donemFisleri(fisler, 'Gider', '2026-09').map(f => f.aciklama)).toEqual(['Şirin İnşaat kira — tutar girilmemiş', 'Elektrik']);
  });
  it('önek semantiği korunur: dönem "2026" ise yılın tüm fişleri (form ay verir; eski kayıt yıl olabilir)', () => {
    expect(donemFisleri(fisler, 'Ödeme', '2026').map(f => f.aciklama)).toEqual(['Eylül bordro', 'SGK primi', 'Ağustos bordro']);
  });
  it('saatli ISO tarih de öneğe uyar ("2026-09-05T10:30:00")', () => {
    expect(donemFisleri([{ kategori: 'Gider', date: '2026-09-05T10:30:00', borc: 1 }], 'Gider', '2026-09')).toHaveLength(1);
  });
  it('tarihi string olmayan fiş (DB null / Date nesnesi) dönem dışı — eski kod `.startsWith` ile ÇÖKÜYORDU', () => {
    const karisik: BgFis[] = [tarihNullOdeme, { kategori: 'Ödeme', date: new Date(2026, 8, 3), borc: 5 }, personelBordro];
    expect(() => donemFisleri(karisik, 'Ödeme', '2026-09')).not.toThrow();
    expect(donemFisleri(karisik, 'Ödeme', '2026-09')).toEqual([personelBordro]);
  });
  it('dönemi string olmayan bütçe hiçbir fişle eşleşmez (eski: startsWith(undefined) → false, aynı)', () => {
    expect(donemFisleri(fisler, 'Ödeme', undefined)).toEqual([]);
  });
  it('BİLİNÇLİ FARK: dönemi BOŞ ("") kalem hiçbir fişle eşleşmez — eski kod `"".startsWith("")` ile kategorinin TÜM fişlerini (her yıl, her ay) o kaleme sayıyordu', () => {
    expect(donemFisleri(fisler, 'Ödeme', '')).toEqual([]);
    // eski davranışın kanıtı: önek boş olunca her tarih uyar
    expect(fisler.filter(f => f.kategori === 'Ödeme' && typeof f.date === 'string' && f.date.startsWith(''))).toHaveLength(4);
  });
});

describe('butceYuzdesi — oran TÜRETMEDİR, "%0" basılmaz', () => {
  it('bütçe > 0 ve gerçekleşen tam biliniyorsa yuvarlanmış yüzde', () => {
    expect(butceYuzdesi(50000, { toplam: 45000, bilinen: 2, bilinmeyen: 0 })).toBe(90);
    expect(butceYuzdesi(30000, { toplam: 10000, bilinen: 1, bilinmeyen: 0 })).toBe(33); // 33,33 → 33 (sayfa Math.round)
  });
  it('bütçe 0 / negatif / bilinmiyor (NaN) → null (eski kod "%0")', () => {
    const g = { toplam: 5000, bilinen: 1, bilinmeyen: 0 };
    expect(butceYuzdesi(0, g)).toBeNull();
    expect(butceYuzdesi(-100, g)).toBeNull();
    expect(butceYuzdesi(NaN, g)).toBeNull();
  });
  it('gerçekleşen BİR kayıt bile bilinmiyorsa null — kısmi toplamdan oran türetilmez', () => {
    expect(butceYuzdesi(20000, { toplam: 5000, bilinen: 1, bilinmeyen: 1 })).toBeNull();
  });
  it('hareketsiz dönem GERÇEK %0 (fiş yok, bütçe var)', () => {
    expect(butceYuzdesi(20000, { toplam: 0, bilinen: 0, bilinmeyen: 0 })).toBe(0);
  });
  it('aşım kırpılmaz: %120 gerçek oran (sayfa çubuk genişliği için 100\'e kırpıyordu — kırpma bağlamada)', () => {
    expect(butceYuzdesi(10000, { toplam: 12000, bilinen: 1, bilinmeyen: 0 })).toBe(120);
  });
});

describe('kalemGerceklesme — kalem satırı', () => {
  it('Şirin İnşaat personel bütçesi: ₺45.000 / ₺50.000 → %90, dönem dışı ve tarihsiz fişler girmez', () => {
    const k = kalemGerceklesme(personelButcesi, fisler);
    expect(k).toEqual({ id: 'b-personel', kategori: 'Ödeme', donem: '2026-09', butce: 50000, gerceklesen: { toplam: 45000, bilinen: 2, bilinmeyen: 0 }, yuzde: 90 });
    expect(paraYaz(ekranTutari(k.gerceklesen))).toBe('₺45.000,00');
  });
  it('MUTASYON AYIRICI: borcu null fiş 0 SAYILMAZ — gerçekleşen kısmi ₺5.000 + 1 bilinmeyen, yüzde null (eski: ₺5.000 %25)', () => {
    const k = kalemGerceklesme(giderButcesi, fisler);
    expect(k.gerceklesen).toEqual({ toplam: 5000, bilinen: 1, bilinmeyen: 1 });
    expect(k.yuzde).toBeNull();
    expect(eskiSayfa([giderButcesi], fisler).percent(giderButcesi)).toBe(25); // eski kodun yanlış kesinliği
    expect(paraYaz(ekranTutari(k.gerceklesen))).toBe('₺5.000,00'); // kısmi toplam + sayfa "1 kayıt tutarsız" notu
  });
  it('dönemin HİÇBİR fişinin borcu bilinmiyorsa ekran "—" (₺0 değil)', () => {
    const k = kalemGerceklesme(giderButcesi, [kiraTutarsiz]);
    expect(k.gerceklesen).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(paraYaz(ekranTutari(k.gerceklesen))).toBe('—');
    expect(k.yuzde).toBeNull();
  });
  it('bütçe tutarı okunamıyorsa (DB null / "abc") butce NaN → ekran "—", yüzde null (eski: ₺0 %0)', () => {
    for (const amount of [null, undefined, 'abc', NaN]) {
      const k = kalemGerceklesme({ ...personelButcesi, amount }, fisler);
      expect(Number.isNaN(k.butce)).toBe(true);
      expect(paraYaz(k.butce)).toBe('—');
      expect(k.yuzde).toBeNull();
      expect(k.gerceklesen.toplam).toBe(45000); // gerçekleşen yine bilinir
    }
  });
  it('bütçe ₺0 girilmişse butce 0 (gerçek sıfır, "—" değil) ama yüzde null', () => {
    const k = kalemGerceklesme({ ...personelButcesi, amount: 0 }, fisler);
    expect(k.butce).toBe(0);
    expect(k.yuzde).toBeNull();
  });
  it('sayısal string borç/bütçe sayı olarak okunur (eski reduce "0" + "1500" = "01500" metin üretiyordu)', () => {
    const k = kalemGerceklesme({ ...giderButcesi, amount: '20000' }, [{ kategori: 'Gider', date: '2026-09-02', borc: '1500' }, elektrik]);
    expect(k.butce).toBe(20000);
    expect(k.gerceklesen).toEqual({ toplam: 6500, bilinen: 2, bilinmeyen: 0 });
    expect(k.yuzde).toBe(33);
  });
  it('bütçe aşımı: ₺12.000 / ₺10.000 → %120 (sayfa çubuk için 100\'e kırpıyordu; ekran değişmez, kırpma bağlamada)', () => {
    const k = kalemGerceklesme(reklamButcesi, fisler);
    expect(k.yuzde).toBe(120);
    expect(eskiSayfa([reklamButcesi], fisler).percent(reklamButcesi)).toBe(100);
  });
  it('hareketsiz dönem: fiş yok → gerçekleşen gerçek ₺0, %0', () => {
    const k = kalemGerceklesme(personelButcesi, []);
    expect(k.gerceklesen).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(k.yuzde).toBe(0);
    expect(paraYaz(ekranTutari(k.gerceklesen))).toBe('₺0,00');
  });
});

describe('butceGerceklesme — sekmenin tamamı (kalemler + Genel Bütçe Durumu halkası)', () => {
  it('SAYFA PARİTESİ: tüm tutarlar biliniyorsa kalem yüzdeleri ve toplam yüzde eski formülle aynı', () => {
    const budgets = [personelButcesi, reklamButcesi];
    const bilinenFisler = fisler.filter(f => f !== kiraTutarsiz && f !== tarihNullOdeme);
    const o = butceGerceklesme(budgets, bilinenFisler);
    const eski = eskiSayfa(budgets, bilinenFisler);
    expect(o.kalemler[0].yuzde).toBe(eski.percent(personelButcesi)); // 90 = 90
    expect(o.kalemler[1].yuzde).toBe(120);                             // eski 100: yalnız çubuk kırpması farkı (bağlamada Math.min)
    expect(o.toplamButce).toEqual({ toplam: eski.totalBudget, bilinen: 2, bilinmeyen: 0 });   // 60.000
    expect(o.toplamGerceklesen).toEqual({ toplam: eski.totalActual, bilinen: 3, bilinmeyen: 0 }); // 57.000
    expect(o.toplamYuzde).toBe(eski.totalPercent); // 95
    expect(o.toplamYuzde).toBe(95);
  });
  it('MUTASYON AYIRICI: bir kalemin gerçekleşeninde bilinmeyen varsa toplam yüzde null, toplam gerçekleşen kısmi + sayaç', () => {
    const o = butceGerceklesme([personelButcesi, giderButcesi, reklamButcesi], fisler);
    expect(o.toplamButce).toEqual({ toplam: 80000, bilinen: 3, bilinmeyen: 0 });
    expect(o.toplamGerceklesen).toEqual({ toplam: 62000, bilinen: 4, bilinmeyen: 1 });
    expect(o.toplamYuzde).toBeNull();
    expect(eskiSayfa([personelButcesi, giderButcesi, reklamButcesi], eskiyeUyanFisler).totalPercent).toBe(78); // eski: 62.000/80.000 "%78"
    expect(paraYaz(ekranTutari(o.toplamGerceklesen))).toBe('₺62.000,00'); // kısmi + "1 kayıt tutarsız" notu
  });
  it('MUTASYON AYIRICI: bütçesi okunamayan kalem toplam bütçeye 0 girmez — sayılır, toplam yüzde null (eski: null → +0, "%…")', () => {
    const bilinenFisler = fisler.filter(f => f !== kiraTutarsiz);
    const o = butceGerceklesme([personelButcesi, { ...giderButcesi, amount: null }], bilinenFisler);
    expect(o.toplamButce).toEqual({ toplam: 50000, bilinen: 1, bilinmeyen: 1 });
    expect(o.toplamGerceklesen).toEqual({ toplam: 50000, bilinen: 3, bilinmeyen: 0 });
    expect(o.toplamYuzde).toBeNull();
    expect(eskiSayfa([personelButcesi, { ...giderButcesi, amount: null }], bilinenFisler.filter(f => f !== tarihNullOdeme)).totalPercent).toBe(100); // eski: ₺50.000/₺50.000 "%100" — genel gider bütçesi yok sayılmış
  });
  it('toplam bütçe ₺0 (tüm kalemler 0) → toplam yüzde null ("%0" basılmaz)', () => {
    const o = butceGerceklesme([{ ...personelButcesi, amount: 0 }], fisler);
    expect(o.toplamButce).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 0 });
    expect(o.toplamYuzde).toBeNull();
  });
  it('bütçe yok → boş kalemler, sıfır toplamlar, yüzde null (sayfa bu durumda "Henüz bütçe hedefi belirlenmedi" basar)', () => {
    const o = butceGerceklesme([], fisler);
    expect(o.kalemler).toEqual([]);
    expect(o.toplamButce).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(o.toplamGerceklesen).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(o.toplamYuzde).toBeNull();
  });
  it('kalem sırası ve kimlikleri bütçe listesiyle aynı (React key = id)', () => {
    const o = butceGerceklesme([reklamButcesi, personelButcesi], fisler);
    expect(o.kalemler.map(k => k.id)).toEqual(['b-reklam', 'b-personel']);
  });
  it('SAYFA PARİTESİ (bilinçli korunan): aynı kategori+dönem iki kalemde varsa fişler her ikisine de sayılır (toplam çift)', () => {
    const o = butceGerceklesme([personelButcesi, { ...personelButcesi, id: 'b-personel-2' }], fisler);
    expect(o.toplamGerceklesen.toplam).toBe(90000);
    expect(eskiSayfa([personelButcesi, { ...personelButcesi, id: 'b-personel-2' }], eskiyeUyanFisler).totalActual).toBe(90000);
  });
});
