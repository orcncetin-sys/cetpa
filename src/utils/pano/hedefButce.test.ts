/**
 * hedefButce.test.ts — Pano (DashboardPage) hedef/bütçe üçlüsünün SÖZLEŞMESİ (Faz 3 5/n, 2026-09-19).
 * ÖNCE YAZILDI — modül yokken kırmızı görüldü.
 *
 * Kapsanan siteler (src/pages/DashboardPage.tsx):
 *   • Phase 99  Bu Ay Satış Hedefi              ~830-893
 *   • Phase 174 Satış / Bütçe (3 Ay)            ~894-936
 *   • Phase 159 Satış Hızı (günlük ortalama)    ~1105-1160
 *
 * Sayfadaki sahte kesinlik (CLAUDE.md: sayısal `|| 0` / `?? 0` YASAK):
 *   • 834 / 906 / 1113-1114  `reduce((s, o) => s + (o.totalPrice || 0), 0)`
 *       → tutarı bilinmeyen sipariş ciroya ₺0 giriyor; hedef gerçekleşmesi sessizce EKSİK çıkıyor.
 *   • 835  `monthlyTarget > 0 ? Math.min(Math.round(mtd / hedef * 100), 200) : 0`
 *       → hedef GİRİLMEMİŞKEN "%0" + kırmızı boş çubuk basılıyor ("hiç hedefin %0'ı"); ekran
 *         "hedefin çok gerisindeyiz" diyor, gerçek "hedef yok".
 *   • 907  `monthlyTarget > 0 ? Math.round(actual / monthlyTarget * 100) : 0`  → aynı arıza, 3 ay için.
 *   • 1126 `weeks[weekIdx] += o.totalPrice || 0`
 *       → tutarı bilinmeyen siparişin haftası "₺0 ciro" çubuğu çiziyor (veri yok ≠ satış yok).
 *   • 853 / 863  `const v = Number(targetDraft)`
 *       → `Number('') === 0`, `Number('abc') === NaN`: boş alanla Enter hedefi siler (kasıtlı olabilir),
 *         'abc' ya da '-5' ise DOĞRULANMADAN kaydedilir (NaN hedef / negatif hedef).
 *
 * Kural: bilinmeyen tutar 0 DEĞİL bilinmiyordur — toplama girmez, SAYILIR; EKRAN `ekranTutari`
 * (kısmi toplam + "N kayıt tutarsız" notu, hiç bilinen yoksa NaN → '—'); ORAN/KALAN/HIZ ise
 * TÜRETMEDİR (`tamTutar` kapısı): tek girdi bile bilinmiyorsa hesaplanmaz (null → '—', çubuk çizilmez).
 * Hedef yoksa gerçekleşme oranı HESAPLANMAZ — %0 da %100 de değildir.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari, toplaBilinen, type Tutar } from '../para';
import {
  siparisAni, donemCirosu, ayCirosu,
  hedefGerceklesme, butceKarsilastir,
  satisHizi, hizDegisimi,
  haftalikCiro, enBuyukHafta,
  hedefGirdisi, hedefOnDoldur, hedefYamasi, hedefleriOku,
  type PanoSiparis,
} from './hedefButce';

/** Fikstür tipi: modülün OKUDUĞU alanlar + yalnız testin okuduğu etiket. */
type TestSiparis = PanoSiparis & { etiket: string };

// ── Eylül 2026 — Cetpa'nın (inşaat malzemesi toptancısı) müşterilerine kestiği siparişler ──────
const sirinCimento: TestSiparis   = { etiket: 'Şirin İnşaat — ÇİMENTO 50KG', totalPrice: 120000, status: 'Delivered', createdAt: new Date(2026, 8, 3) };
const celikDemir: TestSiparis     = { etiket: 'Çelik Yapı — NERVÜRLÜ DEMİR', totalPrice: 80000,  status: 'Shipped',   createdAt: new Date(2026, 8, 14) };
const egeBeton: TestSiparis       = { etiket: 'Ege Beton — HAZIR BETON',     totalPrice: 45000,  status: 'Pending',   createdAt: new Date(2026, 8, 22) };
/** Mikro'dan aktarılmış, tutarı okunamayan kayıt — eski `|| 0` bunu ₺0 ciro sayıyordu. */
const tutarsizSiparis: TestSiparis = { etiket: 'Kaya Yapı — tutar okunamadı', totalPrice: null,  status: 'Processing', createdAt: new Date(2026, 8, 10) };
/** İptal: hiçbir ciroya girmez (sayfa paritesi). */
const iptalSiparis: TestSiparis   = { etiket: 'Deniz İnşaat — iptal',        totalPrice: 500000, status: 'Cancelled', createdAt: new Date(2026, 8, 5) };
/** Ağustos — Eylül penceresinin dışında. */
const agustosSiparis: TestSiparis = { etiket: 'Şirin İnşaat — Ağustos',      totalPrice: 200000, status: 'Delivered', createdAt: new Date(2026, 7, 20) };
/** Tarihi hiç çözülemeyen kayıt: hiçbir döneme giremez ama SAYILIR (sessizce düşürülmez). */
const tarihsizSiparis: TestSiparis = { etiket: 'Bilinmeyen tarih',           totalPrice: 60000,  status: 'Pending',   createdAt: null, syncedAt: null };
/** createdAt yok, syncedAt var — Phase 99 sayar, Phase 174 saymaz (sayfadaki gerçek fark). */
const yedekTarihli: TestSiparis   = { etiket: 'Toros Hafriyat — yalnız syncedAt', totalPrice: 30000, status: 'Pending', createdAt: null, syncedAt: new Date(2026, 8, 18) };

const EYLUL_BASI = new Date(2026, 8, 1);
const EKIM_BASI  = new Date(2026, 9, 1);

/** Sayfadaki ESKİ formül — parite karşılaştırmasının referansı (kopyalanmadı, alıntılandı). */
const eskiReduce = (liste: readonly TestSiparis[]): number =>
  liste.reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);

describe('siparisAni — tarih çözümü (sayfa paritesi)', () => {
  it('createdAt öncelikli, yoksa syncedAt (Phase 99/159 kuralı)', () => {
    expect(siparisAni(yedekTarihli)).toEqual(new Date(2026, 8, 18));
    expect(siparisAni(sirinCimento)).toEqual(new Date(2026, 8, 3));
  });

  it('yedek KAPALIYKEN yalnız createdAt okunur (Phase 174 kuralı)', () => {
    expect(siparisAni(yedekTarihli, false)).toBeNull();
    expect(siparisAni(sirinCimento, false)).toEqual(new Date(2026, 8, 3));
  });

  it('çözülemeyen tarih null — ASLA "bugün"e düşmez', () => {
    expect(siparisAni(tarihsizSiparis)).toBeNull();
    expect(siparisAni({ createdAt: 'çarşamba' })).toBeNull();
  });
});

describe('donemCirosu — dönem toplamı', () => {
  const tamListe = [sirinCimento, celikDemir, egeBeton, iptalSiparis, agustosSiparis];

  it('SAYFA PARİTESİ: tutarların hepsi bilinirken sayı eskiyle BİREBİR aynı', () => {
    const eski = eskiReduce(tamListe.filter(o => o.status !== 'Cancelled' && o.createdAt != null && (o.createdAt as Date) >= EYLUL_BASI));
    const yeni = donemCirosu(tamListe, EYLUL_BASI);
    expect(eski).toBe(245000);
    expect(ekranTutari(yeni.ciro)).toBe(eski);
    expect(yeni.ciro.bilinmeyen).toBe(0);
  });

  it('iptal sipariş hiçbir ciroya girmez (parite)', () => {
    expect(donemCirosu([iptalSiparis], EYLUL_BASI).ciro).toEqual<Tutar>({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
  });

  it('MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen sipariş ₺0 SAYILMAZ, sayılır', () => {
    const t = donemCirosu([...tamListe, tutarsizSiparis], EYLUL_BASI);
    expect(t.ciro.toplam).toBe(245000);      // bilinenlerin toplamı — sahte ₺0 eklenmedi
    expect(t.ciro.bilinen).toBe(3);
    expect(t.ciro.bilinmeyen).toBe(1);       // "1 kayıt tutarsız" notu buradan
  });

  it('MUTASYON-AYIRT EDİCİ: hiç bilinen tutar yoksa ekran NaN ("—"), ₺0 değil', () => {
    const t = donemCirosu([tutarsizSiparis], EYLUL_BASI);
    expect(Number.isNaN(ekranTutari(t.ciro))).toBe(true);
  });

  it('bitiş tarihi YARI AÇIK: [başlangıç, bitiş) — Phase 159 prev30 paritesi', () => {
    const t = donemCirosu([sirinCimento, celikDemir, egeBeton, agustosSiparis], new Date(2026, 8, 3), new Date(2026, 8, 22));
    expect(ekranTutari(t.ciro)).toBe(200000); // 3 Eylül dahil, 22 Eylül HARİÇ
  });

  it('tarihi çözülemeyen kayıt dönem dışı ama SAYILIR (sessizce düşürülmez)', () => {
    const t = donemCirosu([sirinCimento, tarihsizSiparis], EYLUL_BASI);
    expect(ekranTutari(t.ciro)).toBe(120000);
    expect(t.tarihsiz).toBe(1);
  });

  it('totalPrice yoksa totalAmount okunur (siparisTutari tek kaynağı)', () => {
    const t = donemCirosu([{ totalAmount: 15000, status: 'Pending', createdAt: new Date(2026, 8, 9) }], EYLUL_BASI);
    expect(ekranTutari(t.ciro)).toBe(15000);
  });
});

describe('ayCirosu — ay anahtarına göre (Phase 174)', () => {
  it('SAYFA PARİTESİ: ayın bilinen siparişleri toplanır, diğer aylar girmez', () => {
    const t = ayCirosu([sirinCimento, celikDemir, egeBeton, agustosSiparis, iptalSiparis], '2026-09');
    expect(ekranTutari(t.ciro)).toBe(245000);
    expect(ayCirosu([sirinCimento, agustosSiparis], '2026-08').ciro.toplam).toBe(200000);
  });

  it('createdAt YEDEĞİ varsayılan olarak KAPALI (Phase 174 yalnız createdAt okur)', () => {
    expect(ayCirosu([yedekTarihli], '2026-09').tarihsiz).toBe(1);
    expect(ayCirosu([yedekTarihli], '2026-09', true).ciro.toplam).toBe(30000);
  });

  it('MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen ay kaydı ₺0 sayılmaz', () => {
    const t = ayCirosu([tutarsizSiparis], '2026-09');
    expect(t.ciro.bilinmeyen).toBe(1);
    expect(Number.isNaN(ekranTutari(t.ciro))).toBe(true);
  });

  it('tarih-only string YEREL ay olarak okunur (UTC kayması yok)', () => {
    const t = ayCirosu([{ totalPrice: 10000, status: 'Pending', createdAt: '2026-09-01' }], '2026-09');
    expect(t.ciro.toplam).toBe(10000);
  });
});

describe('hedefGerceklesme — Phase 99', () => {
  const eylul = donemCirosu([sirinCimento, celikDemir, egeBeton], EYLUL_BASI).ciro;

  it('SAYFA PARİTESİ: hedef ve ciro bilinirken yüzde eskiyle BİREBİR aynı', () => {
    const d = hedefGerceklesme(eylul, 400000);
    expect(d.oranYuzde).toBe(Math.round((245000 / 400000) * 100)); // 61
    expect(d.oranYuzde).toBe(61);
    expect(d.kalan).toBe(155000);
    expect(d.hedef).toBe(400000);
    expect(d.ekran).toBe(245000);
  });

  it('MUTASYON-AYIRT EDİCİ: hedef GİRİLMEMİŞSE oran hesaplanmaz — %0 DEĞİL null', () => {
    for (const hedef of [0, null, undefined, '', -50000, NaN, 'abc']) {
      const d = hedefGerceklesme(eylul, hedef);
      expect(d.oranYuzde).toBeNull();   // eski kod burada 0 basıyordu (kırmızı boş çubuk)
      expect(d.kalan).toBeNull();
      expect(d.hedef).toBeNull();
    }
  });

  it('MUTASYON-AYIRT EDİCİ: ciroda tek bilinmeyen kayıt varsa oran/kalan hesaplanmaz', () => {
    const kismi = donemCirosu([sirinCimento, celikDemir, egeBeton, tutarsizSiparis], EYLUL_BASI).ciro;
    const d = hedefGerceklesme(kismi, 400000);
    expect(d.oranYuzde).toBeNull();     // kısmi toplamdan yüzde üretilmez
    expect(d.kalan).toBeNull();
    expect(d.ekran).toBe(245000);       // EKRAN kısmi toplamı gösterebilir…
    expect(d.bilinmeyen).toBe(1);       // …yanında "1 kayıt tutarsız" notuyla
  });

  it('hiç bilinen ciro yokken ekran NaN, oran null', () => {
    const d = hedefGerceklesme(donemCirosu([tutarsizSiparis], EYLUL_BASI).ciro, 400000);
    expect(Number.isNaN(d.ekran)).toBe(true);
    expect(d.oranYuzde).toBeNull();
  });

  it('satışsız ay GERÇEK %0 (veri yok değil, satış yok)', () => {
    const d = hedefGerceklesme({ toplam: 0, bilinen: 0, bilinmeyen: 0 }, 400000);
    expect(d.oranYuzde).toBe(0);
    expect(d.kalan).toBe(400000);
  });

  it('BİLİNÇLİ FARK: aşım KIRPILMAZ (sayfa 200\'de kırpıyordu)', () => {
    const d = hedefGerceklesme({ toplam: 900000, bilinen: 3, bilinmeyen: 0 }, 400000);
    expect(d.oranYuzde).toBe(225);
    expect(d.kalan).toBe(-500000);      // negatif kalan = hedef aşıldı
  });

  it('sayısal string hedef kabul edilir', () => {
    expect(hedefGerceklesme(eylul, '400000').oranYuzde).toBe(61);
  });
});

describe('butceKarsilastir — Phase 174 (son 3 ay)', () => {
  const aylar = [
    { etiket: 'Tem', ciro: ayCirosu([], '2026-07').ciro, hedef: 400000 },
    { etiket: 'Ağu', ciro: ayCirosu([agustosSiparis], '2026-08').ciro, hedef: 400000 },
    { etiket: 'Eyl', ciro: ayCirosu([sirinCimento, celikDemir, egeBeton], '2026-09').ciro, hedef: 400000 },
  ];

  it('SAYFA PARİTESİ: her ayın yüzdesi eskiyle BİREBİR aynı', () => {
    const sonuc = butceKarsilastir(aylar);
    expect(sonuc.map(a => a.oranYuzde)).toEqual([0, 50, 61]);
    expect(sonuc.map(a => a.etiket)).toEqual(['Tem', 'Ağu', 'Eyl']);
  });

  it('MUTASYON-AYIRT EDİCİ: hedefsiz ay "%0" DEĞİL null (çubuk çizilmez)', () => {
    const sonuc = butceKarsilastir(aylar.map(a => ({ ...a, hedef: 0 })));
    expect(sonuc.every(a => a.oranYuzde === null)).toBe(true);
  });

  it('MUTASYON-AYIRT EDİCİ: tutarsız kaydı olan ay için oran hesaplanmaz', () => {
    const sonuc = butceKarsilastir([
      { etiket: 'Eyl', ciro: ayCirosu([sirinCimento, tutarsizSiparis], '2026-09').ciro, hedef: 400000 },
    ]);
    expect(sonuc[0].oranYuzde).toBeNull();
    expect(sonuc[0].ekran).toBe(120000);
    expect(sonuc[0].bilinmeyen).toBe(1);
  });

  it('aylar ayrı ayrı hedeflenebilir (kalıcı hedef geçmişi bağlandığında)', () => {
    const sonuc = butceKarsilastir([
      { etiket: 'Ağu', ciro: { toplam: 200000, bilinen: 1, bilinmeyen: 0 }, hedef: 200000 },
      { etiket: 'Eyl', ciro: { toplam: 245000, bilinen: 3, bilinmeyen: 0 }, hedef: 500000 },
    ]);
    expect(sonuc.map(a => a.oranYuzde)).toEqual([100, 49]);
  });
});

describe('satisHizi — Phase 159', () => {
  const ciro30: Tutar = { toplam: 245000, bilinen: 3, bilinmeyen: 0 };

  it('SAYFA PARİTESİ: günlük ortalama eskiyle BİREBİR aynı (245000 / 30)', () => {
    expect(satisHizi(ciro30, 30).gunluk).toBe(245000 / 30);
  });

  it('MUTASYON-AYIRT EDİCİ: gün sayısı 0 / negatif / okunamaz → hız yok (null)', () => {
    for (const gun of [0, -5, null, undefined, NaN, 'abc', '']) {
      expect(satisHizi(ciro30, gun).gunluk).toBeNull();
    }
  });

  it('MUTASYON-AYIRT EDİCİ: ciroda tek bilinmeyen kayıt varsa hız hesaplanmaz', () => {
    const kismi: Tutar = { toplam: 245000, bilinen: 3, bilinmeyen: 1 };
    const h = satisHizi(kismi, 30);
    expect(h.gunluk).toBeNull();
    expect(h.ekran).toBe(245000);    // ekran kısmi toplamı basabilir
    expect(h.bilinmeyen).toBe(1);
  });

  it('satışsız dönem GERÇEK ₺0/gün', () => {
    expect(satisHizi({ toplam: 0, bilinen: 0, bilinmeyen: 0 }, 30).gunluk).toBe(0);
  });
});

describe('hizDegisimi — "vs önceki 30g" rozeti', () => {
  it('SAYFA PARİTESİ: iki hız da bilinirken yüzde eskiyle BİREBİR aynı', () => {
    const bu = 245000 / 30, onceki = 6000;
    expect(hizDegisimi(bu, onceki)).toBe(Math.round(((bu - onceki) / onceki) * 100));
    expect(hizDegisimi(bu, onceki)).toBe(36);
  });

  it('MUTASYON-AYIRT EDİCİ: önceki dönem 0 ya da bilinmiyorsa rozet ÇİZİLMEZ (null)', () => {
    expect(hizDegisimi(8000, 0)).toBeNull();
    expect(hizDegisimi(8000, null)).toBeNull();
    expect(hizDegisimi(null, 6000)).toBeNull();
    expect(hizDegisimi(8000, -100)).toBeNull();
  });

  it('düşüşte negatif yüzde', () => {
    expect(hizDegisimi(3000, 6000)).toBe(-50);
  });
});

describe('haftalikCiro — Phase 159 kıvılcım grafiği', () => {
  const SIMDI = new Date(2026, 8, 19, 12, 0);
  const buHafta: TestSiparis   = { etiket: 'bu hafta',    totalPrice: 50000, status: 'Pending', createdAt: new Date(2026, 8, 18) };
  const gecenHafta: TestSiparis = { etiket: 'geçen hafta', totalPrice: 30000, status: 'Pending', createdAt: new Date(2026, 8, 10) };
  const tutarsizHafta: TestSiparis = { etiket: 'tutarsız hafta', totalPrice: null, status: 'Pending', createdAt: new Date(2026, 8, 4) };
  const cokEski: TestSiparis   = { etiket: '8 haftadan eski', totalPrice: 999999, status: 'Pending', createdAt: new Date(2026, 5, 1) };

  it('SAYFA PARİTESİ: kayıtlar eski `7 - floor(daysAgo/7)` kovalarına düşer', () => {
    const h = haftalikCiro([buHafta, gecenHafta, cokEski], SIMDI);
    expect(h).toHaveLength(8);
    expect(h[7].deger).toBe(50000);
    expect(h[6].deger).toBe(30000);
    expect(h.filter(x => x.deger === 999999)).toHaveLength(0); // 8 hafta dışı düşer (parite)
  });

  it('MUTASYON-AYIRT EDİCİ: yalnız tutarsız kayıt taşıyan hafta ₺0 DEĞİL null (çizgi sıfıra çakılmaz)', () => {
    const h = haftalikCiro([buHafta, tutarsizHafta], SIMDI);
    expect(h[5].deger).toBeNull();
    expect(h[5].ciro.bilinmeyen).toBe(1);
  });

  it('sipariş düşmeyen hafta GERÇEK ₺0 (satış yok)', () => {
    const h = haftalikCiro([buHafta], SIMDI);
    expect(h[4].deger).toBe(0);
    expect(h[4].ciro.bilinmeyen).toBe(0);
  });

  it('iptal siparişler hiçbir haftaya girmez (parite)', () => {
    const h = haftalikCiro([{ totalPrice: 700000, status: 'Cancelled', createdAt: new Date(2026, 8, 18) }], SIMDI);
    expect(h[7].deger).toBe(0);
  });

  it('enBuyukHafta: bilinen en büyük değer; hiç bilinen yoksa null (çubuk çizilmez)', () => {
    expect(enBuyukHafta(haftalikCiro([buHafta, gecenHafta], SIMDI))).toBe(50000);
    expect(enBuyukHafta(haftalikCiro([tutarsizHafta], SIMDI))).toBeNull();
    expect(enBuyukHafta(haftalikCiro([], SIMDI))).toBeNull();   // hepsi ₺0 → ölçek yok
  });
});

describe('hedefGirdisi — hedef düzenleme formu (FORM KURALI)', () => {
  it('MUTASYON-AYIRT EDİCİ: boş alan `Number("") === 0` tuzağına düşmez', () => {
    expect(hedefGirdisi('')).toEqual({ durum: 'temizle' });
    expect(hedefGirdisi('   ')).toEqual({ durum: 'temizle' });
    expect(hedefGirdisi(null)).toEqual({ durum: 'temizle' });
  });

  it('MUTASYON-AYIRT EDİCİ: okunamayan / negatif hedef KAYDEDİLMEZ', () => {
    expect(hedefGirdisi('abc')).toEqual({ durum: 'gecersiz' });
    // Ayırıcılı / üstel yazım: anlamı belirsiz ('2.500' TR'de 2500, Number()'da 2,5) → tahmin YOK.
    // Eski `type="number"` kutusu bunları '' yapıp hedefi SESSİZCE siliyordu (son inceleme).
    for (const ham of ['2.500.000', '2.500', '2,5', '2500000,00', '1e6', '1e400', '+5', '2 500 000']) {
      expect(hedefGirdisi(ham), ham).toEqual({ durum: 'gecersiz' });
    }
    expect(hedefGirdisi('-50000')).toEqual({ durum: 'gecersiz' });
    expect(hedefGirdisi(NaN)).toEqual({ durum: 'gecersiz' });
    expect(hedefGirdisi(Infinity)).toEqual({ durum: 'gecersiz' });
  });

  it('açık 0 = hedefi kaldır (mevcut kayıt davranışı: 0 anahtarı siler)', () => {
    expect(hedefGirdisi('0')).toEqual({ durum: 'temizle' });
    expect(hedefGirdisi(0)).toEqual({ durum: 'temizle' });
  });

  it('geçerli pozitif hedef sayıya çevrilir', () => {
    expect(hedefGirdisi('400000')).toEqual({ durum: 'gecerli', deger: 400000 });
    expect(hedefGirdisi(' 400000 ')).toEqual({ durum: 'gecerli', deger: 400000 });
    expect(hedefGirdisi(250000.5)).toEqual({ durum: 'gecerli', deger: 250000.5 });
  });
});

/**
 * ── Hedef KAYDI / SİLİNMESİ (2026-09-19 delta bulgusu) ────────────────────────────────────
 *
 * `hedefGirdisi` 'temizle' diyebiliyordu ama kayıt yolu silmeyi GERÇEKLEŞTİREMİYORDU:
 *
 *     App.tsx:1611-1614   const updated = { ...monthlyTargets, [monthKey]: value };
 *                         if (value === 0) { delete updated[monthKey]; }
 *                         setDoc(doc(db,'settings','targets'), updated, { merge: true })
 *
 * Anahtar yamadan SİLİNİP merge ile gönderiliyor. Merge tarafı (server.ts:1949 → pgShim
 * `mergeDocData`: `out[key] = value`, yamada olmayan anahtar eski değeriyle KALIR) ve istemci
 * önbelleği (`dbClient.ts:505` `{...eski, ...data}`) hiçbir şey silmiyor. Kullanıcı hedefi
 * temizliyor, dinleyici eski hedefi geri yazıyor; "Hedef belirle…" durumuna dönülemiyordu.
 * FORM KURALI: boş + önceki BİLİNİYOR → alan açıkça `null` yazılır.
 */
describe('hedefYamasi — silme yamaya AÇIKÇA yazılır (PATCH-merge no-op değil)', () => {
  const mevcut = { '2026-08': 900_000, '2026-09': 1_500_000 };

  it('geçerli hedef yazılır', () => {
    expect(hedefYamasi(mevcut, '2026-09', 400_000)).toEqual({
      yerel: { '2026-08': 900_000, '2026-09': 400_000 },
      yama: { '2026-09': 400_000 },
    });
  });

  it('MUTASYON-AYIRT EDİCİ: temizlemede anahtar yamadan SİLİNMEZ, null YAZILIR', () => {
    const { yerel, yama } = hedefYamasi(mevcut, '2026-09', null);
    expect(yama).toEqual({ '2026-09': null });
    expect('2026-09' in yama).toBe(true);           // eski kod anahtarı hiç göndermiyordu → merge no-op
    expect(yerel).toEqual({ '2026-08': 900_000 });  // yerel önbellekte de kalmaz
  });

  it('yama yalnız DEĞİŞEN ayı taşır — eşzamanlı düzenlemede diğer aylar ezilmez', () => {
    expect(Object.keys(hedefYamasi(mevcut, '2026-10', 700_000).yama)).toEqual(['2026-10']);
  });

  it('hiç hedefi olmayan ayı temizlemek de null yazar (yeni kayıt değil, silme niyeti)', () => {
    expect(hedefYamasi({}, '2026-09', null).yama).toEqual({ '2026-09': null });
  });
});

describe('hedefleriOku — DB’den gelen null/çöp değer hedef SAYILMAZ', () => {
  it('null yazılmış ay hedefsizdir (silinmiş demektir)', () => {
    expect(hedefleriOku({ '2026-08': 900_000, '2026-09': null })).toEqual({ '2026-08': 900_000 });
  });

  it('MUTASYON-AYIRT EDİCİ: 0 / negatif / metin hedef DEĞİLDİR', () => {
    expect(hedefleriOku({ a: 0, b: -5, c: 'abc', d: NaN, e: 250_000 })).toEqual({ e: 250_000 });
  });

  it('sayıya çevrilebilen metin hedef okunur (DB’de dize durabilir)', () => {
    expect(hedefleriOku({ '2026-09': '400000' })).toEqual({ '2026-09': 400_000 });
  });

  it('doküman hiç yoksa / nesne değilse boş', () => {
    expect(hedefleriOku(undefined)).toEqual({});
    expect(hedefleriOku(null)).toEqual({});
    expect(hedefleriOku('bozuk')).toEqual({});
  });

  it('silinen hedef GERİ GELMEZ — silme yaması birleştirilip okunduğunda ay hedefsiz', () => {
    const { yama } = hedefYamasi({ '2026-09': 1_500_000 }, '2026-09', null);
    const birlesmis = { '2026-09': 1_500_000, ...yama };     // pgShim.mergeDocData davranışı
    expect(hedefleriOku(birlesmis)['2026-09']).toBeUndefined();
    // Phase 99 kartı: hedef yok → oran HESAPLANMAZ ('—', %0 değil)
    expect(hedefGerceklesme(toplaBilinen([{ totalPrice: 120_000 }], o => o.totalPrice), hedefleriOku(birlesmis)['2026-09']).oranYuzde).toBeNull();
  });
});

describe('hedefOnDoldur — üç hedef kutusunun TEK ön-doldurma tanımı', () => {
  it('hedef yoksa kutu BOŞ açılır (uydurma "0" ile değil)', () => {
    for (const h of [0, null, undefined, NaN, -5, '', 'abc']) expect(hedefOnDoldur(h), String(h)).toBe('');
  });

  it('pozitif hedef TAM sayı metni olur', () => {
    expect(hedefOnDoldur(2_500_000)).toBe('2500000');
    expect(hedefOnDoldur(250000.5)).toBe('250001');
  });

  it('DEĞİŞMEZ: ön-doldurulan metin kapıdan GEÇER — kullanıcı yazmadığı değer için uyarı görmez', () => {
    for (const x of [1, 0.6, 250000.5, 2_500_000, 1e9 + 0.25]) {
      expect(hedefGirdisi(hedefOnDoldur(x)).durum, String(x)).not.toBe('gecersiz');
    }
    // 0.4 → yuvarlanınca 0 → kutu boş açılır ('temizle' adayı), '0' basılmaz.
    expect(hedefOnDoldur(0.4)).toBe('');
  });
});
