/**
 * ciroDonem.test.ts — Pano'nun DÖNEMSEL CİRO sözleşmesi (Faz 3 5/n, grup "ciroDonem", 2026-09-19).
 * ÖNCE YAZILDI (kırmızı görüldü, sonra ciroDonem.ts).
 *
 * NEDEN VAR — DashboardPage'de aynı "dönem × ciro" hesabı BEŞ yerde elle kopyalanmış, üç farklı
 * tarih çözümü ve dört farklı süzgeçle:
 *   • Phase 35 sparkline      (436-447)   — `toplaBilinen` ile ZATEN doğru; hesap sayfada inline
 *   • Insight strip 7 gün     (500-520)   — ZATEN doğru ama KAYAN 7×24s penceresi (sparkline TAKVİM günü)
 *   • Phase 56 MTD            (770-776)   — `(o.totalPrice || 0)` ×2, sapma ve projeksiyon KISMİ toplamdan
 *   • Phase 103 6 aylık çubuk (1379)      — `(o.totalPrice || 0)`, `Math.max(..., 1)` NaN'la çöker
 *   • 6 aylık trend           (1900-1903) — `bucket.revenue += o.totalPrice` (undefined → tüm ay NaN),
 *                                           `ayAnahtari(o.createdAt)` (syncedAt'li sipariş SESSİZCE düşer)
 *
 * KURAL (CLAUDE.md "sahte kesinlik gösterme"): tutarı okunamayan sipariş ₺0 DEĞİLDİR —
 * toplama girmez, SAYILIR; ekran kısmi toplam + "N kayıt tutarsız" notu ya da '—' basar;
 * sapma/projeksiyon gibi TÜRETİLEN sayı tek girdi bile eksikse hiç hesaplanmaz (para.ts tamTutar).
 * Grafik noktası bilinmeyende `null` (0 değil — çizgi sıfıra çakılmasın).
 */
import { describe, it, expect } from 'vitest';
import {
  ciroTarihi,
  gunlukCiro,
  sonNGunToplami,
  aylikCiro,
  mtdKarsilastir,
  donemToplami,
  olcekTavani,
  type CiroSiparisi,
  type CiroFaturasi,
} from './ciroDonem';
import { ekranTutari } from '../para';

// ── Fikstür: Şirin İnşaat / Çelik Yapı siparişleri, ÇİMENTO 50KG satırları, ₺ ────────────────
const s = (o: Partial<CiroSiparisi>): CiroSiparisi => ({ ...o });
const f = (o: Partial<CiroFaturasi>): CiroFaturasi => ({ yon: 'giden', ...o });

/** Referans "bugün": 19 Eylül 2026, Cumartesi 10:30. Eylül 30 gün → ay ilerlemesi %63. */
const BUGUN = new Date(2026, 8, 19, 10, 30);

describe('ciroTarihi — tarih çözümü (sayfa çoğunluğu: createdAt ÖNCE)', () => {
  it('createdAt varsa onu kullanır, syncedAt yedektir', () => {
    expect(ciroTarihi(s({ createdAt: new Date(2026, 8, 5), syncedAt: new Date(2026, 8, 9) })))
      .toEqual(new Date(2026, 8, 5));
    expect(ciroTarihi(s({ syncedAt: new Date(2026, 8, 9) }))).toEqual(new Date(2026, 8, 9));
  });

  it('ikisi de çözülemezse null — ASLA "bugün"e düşmez', () => {
    expect(ciroTarihi(s({}))).toBeNull();
    expect(ciroTarihi(s({ createdAt: 'çözülemez' }))).toBeNull();
  });

  it('PARİTE: `orderDate`e DÜŞMEZ — Mikro faturasından türetilen sipariş ay kovasına girmez', () => {
    // Sayfadaki 9 aylık/MTD sitesi `createdAt ?? syncedAt` okuyor; `orderDate` yalnız
    // siparis.ts `siparisTarih` zincirinde var. Buraya eklemek sayıyı DEĞİŞTİRİRDİ.
    expect(ciroTarihi(s({ orderDate: '2026-09-05' }))).toBeNull();
  });
});

// ── GÜNLÜK (Phase 35 sparkline) ──────────────────────────────────────────────────────────────
const gunlukSiparisler: CiroSiparisi[] = [
  s({ syncedAt: new Date(2026, 8, 19, 9, 0), totalPrice: 1000 }),                 // Şirin İnşaat, bugün
  s({ syncedAt: new Date(2026, 8, 18, 9, 0), totalPrice: 500 }),                  // Çelik Yapı
  s({ syncedAt: new Date(2026, 8, 18, 15, 0) }),                                  // tutarı OKUNAMADI
  s({ syncedAt: new Date(2026, 8, 17, 9, 0), totalPrice: 9999, source: 'mikro-fatura' }), // çift sayım koruması
  s({ syncedAt: new Date(2026, 8, 1, 9, 0), totalPrice: 7777 }),                  // pencere dışı
];
const gunlukFaturalar: CiroFaturasi[] = [
  f({ tarih: new Date(2026, 8, 17), tutar: 2000 }),                               // giden (satış)
  f({ tarih: new Date(2026, 8, 17), tutar: 5000, yon: 'gelen' }),                 // alış — ciroya girmez
  f({ tarih: new Date(2026, 8, 16), tutar: NaN }),                                // meblağı okunamadı
];

describe('gunlukCiro — Phase 35 sparkline', () => {
  const satirlar = gunlukCiro(gunlukSiparisler, gunlukFaturalar, 7, BUGUN, { iptalHaric: false });

  it('SAYFA PARİTESİ: 7 takvim günü, en eskiden bugüne; gün numarası ve anahtar doğru', () => {
    expect(satirlar).toHaveLength(7);
    expect(satirlar.map(g => g.gun)).toEqual([13, 14, 15, 16, 17, 18, 19]);
    expect(satirlar[6].anahtar).toBe('2026-09-19');
  });

  it('SAYFA PARİTESİ: bilinen girdide sayı eskiyle BİREBİR aynı (native + Mikro EKLENEREK)', () => {
    expect(satirlar[6].ekran).toBe(1000);                       // 19 Eylül: native
    expect(satirlar[4].ekran).toBe(2000);                       // 17 Eylül: yalnız Mikro giden faturası
    expect(satirlar[5].tutar.toplam).toBe(500);                 // 18 Eylül: bilinen kısmi toplam
  });

  it('Mikro kaynaklı sipariş native tarafta SAYILMAZ (çift sayım koruması korunuyor)', () => {
    expect(satirlar[4].ekran).toBe(2000);                       // 9999 EKLENMEDİ
    expect(satirlar[4].tutar.bilinen).toBe(1);
  });

  it('gelen (alış) faturası ciroya girmez', () => {
    expect(satirlar[4].tutar.toplam).toBe(2000);                // 5000 yok
  });

  // MUTASYON-AYIRT EDİCİ: `|| 0` geri gelirse 18 Eylül 500 yerine yine 500 görünür ama
  // `bilinmeyen` 0'a düşer ve "1 kayıt tutarsız" notu kaybolur.
  it('MUTASYON-AYIRT EDİCİ: tutarı okunamayan sipariş 0 SAYILMAZ, SAYILIR', () => {
    expect(satirlar[5].tutar.bilinmeyen).toBe(1);
    expect(satirlar[5].tutar.bilinen).toBe(1);
    expect(satirlar[5].ekran).toBe(500);                        // kısmi toplam görünür
  });

  // MUTASYON-AYIRT EDİCİ: `|| 0` ile 16 Eylül "₺0 ciro" olur ve çubuk YEŞİL sıfır çizilir.
  it('MUTASYON-AYIRT EDİCİ: günün TEK kaydı bilinmiyorsa ekran NaN, grafik null (0 DEĞİL)', () => {
    expect(Number.isNaN(satirlar[3].ekran)).toBe(true);         // 16 Eylül
    expect(satirlar[3].grafik).toBeNull();
    expect(satirlar[3].tutar.bilinmeyen).toBe(1);
  });

  it('kaydı olmayan gün GERÇEK 0 (bilinmiyor değil) — grafikte 0 çizilir', () => {
    expect(satirlar[0].ekran).toBe(0);                          // 13 Eylül
    expect(satirlar[0].grafik).toBe(0);
    expect(satirlar[0].adet).toBe(0);
  });

  it('`totalPrice: 0` MEŞRU sıfırdır — bilinmeyen sayılmaz', () => {
    const [g] = gunlukCiro([s({ syncedAt: BUGUN, totalPrice: 0 })], [], 1, BUGUN, { iptalHaric: false });
    expect(g.ekran).toBe(0);
    expect(g.tutar.bilinen).toBe(1);
    expect(g.tutar.bilinmeyen).toBe(0);
  });

  it('`totalAmount` yedeği siparisTutari üzerinden okunur', () => {
    const [g] = gunlukCiro([s({ syncedAt: BUGUN, totalAmount: 250 })], [], 1, BUGUN, { iptalHaric: false });
    expect(g.ekran).toBe(250);
  });

  it('iptalHaric:true ise iptal sipariş dönemden düşer', () => {
    const liste = [s({ syncedAt: BUGUN, totalPrice: 400, status: 'Cancelled' }), s({ syncedAt: BUGUN, totalPrice: 100 })];
    expect(gunlukCiro(liste, [], 1, BUGUN, { iptalHaric: true })[0].ekran).toBe(100);
    expect(gunlukCiro(liste, [], 1, BUGUN, { iptalHaric: false })[0].ekran).toBe(500);
  });
});

describe('sonNGunToplami — insight strip (KAYAN 7×24 saat penceresi)', () => {
  it('SAYFA PARİTESİ: kayan pencere; sparkline TAKVİM gününden farklıdır (bilinçli)', () => {
    const t = sonNGunToplami(gunlukSiparisler, gunlukFaturalar, 7, BUGUN);
    // 12 Eyl 10:30'dan sonrası: 19(1000) + 18(500) + 17 mikro(2000); mikro türevi ve 1 Eyl hariç
    expect(t.toplam).toBe(3500);
    expect(t.bilinen).toBe(3);
  });

  // MUTASYON-AYIRT EDİCİ: `|| 0` ile bilinmeyen sayaç sıfırlanır, kart notu kaybolur.
  it('MUTASYON-AYIRT EDİCİ: tutarı okunamayan kayıtlar SAYILIR (kart altı notu bundan doğar)', () => {
    const t = sonNGunToplami(gunlukSiparisler, gunlukFaturalar, 7, BUGUN);
    expect(t.bilinmeyen).toBe(2);                                // 18 Eyl sipariş + 16 Eyl fatura
    expect(ekranTutari(t)).toBe(3500);                           // kısmi toplam
  });

  it('hiç bilinen yoksa ekran NaN → "—"', () => {
    const t = sonNGunToplami([s({ syncedAt: BUGUN })], [], 7, BUGUN);
    expect(Number.isNaN(ekranTutari(t))).toBe(true);
  });
});

// ── AYLIK (Phase 103 çubuk + 6 aylık trend) ─────────────────────────────────────────────────
const aylikSiparisler: CiroSiparisi[] = [
  s({ createdAt: new Date(2026, 8, 5), totalPrice: 12000 }),                       // Eylül — Şirin İnşaat
  s({ createdAt: new Date(2026, 8, 18), totalPrice: 8000 }),                       // Eylül — Çelik Yapı
  s({ createdAt: new Date(2026, 8, 12), totalPrice: 4000, status: 'Cancelled' }),  // Eylül — iptal
  s({ createdAt: new Date(2026, 7, 10), totalPrice: 10000 }),                      // Ağustos
  s({ createdAt: new Date(2026, 7, 20), totalPrice: 6000 }),                       // Ağustos
  s({ createdAt: new Date(2026, 6, 3) }),                                          // Temmuz — tutarı okunamadı
  s({ syncedAt: new Date(2026, 5, 4), totalPrice: 700 }),                          // Haziran — YALNIZ syncedAt
  s({ totalPrice: 300 }),                                                          // tarihsiz — hiçbir kovaya girmez
];

describe('aylikCiro — Phase 103 çubuk grafiği', () => {
  const aylar = aylikCiro(aylikSiparisler, 6, BUGUN, { iptalHaric: true });

  it('SAYFA PARİTESİ: 6 kova, Nisan→Eylül, anahtarlar "YYYY-MM"', () => {
    expect(aylar.map(a => a.anahtar)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(aylar[5].etiket).toBe(new Date(2026, 8, 1).toLocaleString('tr-TR', { month: 'short' }));
  });

  it('SAYFA PARİTESİ: bilinen girdide sayı eskiyle BİREBİR aynı', () => {
    expect(aylar[5].ekran).toBe(20000);            // Eylül, iptal hariç
    expect(aylar[4].ekran).toBe(16000);            // Ağustos
  });

  it('iptalHaric:false (Phase 56/trend süzgeci) iptal siparişi SAYAR', () => {
    expect(aylikCiro(aylikSiparisler, 6, BUGUN, { iptalHaric: false })[5].ekran).toBe(24000);
  });

  // MUTASYON-AYIRT EDİCİ: `|| 0` ile Temmuz "₺0 ciro" olur ve çubuk sıfır yükseklikte ama
  // YEŞİL/GRİ ayrımı olmadan çizilir; `Math.max(..., 1)` de sessizce çalışır.
  it('MUTASYON-AYIRT EDİCİ: ayın TEK kaydı bilinmiyorsa ekran NaN, grafik null', () => {
    expect(Number.isNaN(aylar[3].ekran)).toBe(true);   // Temmuz
    expect(aylar[3].grafik).toBeNull();
    expect(aylar[3].tutar.bilinmeyen).toBe(1);
  });

  it('BİLİNÇLİ FARK: yalnız `syncedAt`li sipariş artık Haziran kovasına GİRER (trend sitesi düşürüyordu)', () => {
    expect(aylar[2].ekran).toBe(700);
    expect(aylar[2].adet).toBe(1);
  });

  it('tarihi çözülemeyen sipariş hiçbir kovaya girmez (eski `?? new Date()` tuzağı yok)', () => {
    const toplamAdet = aylar.reduce((n, a) => n + a.adet, 0);
    expect(toplamAdet).toBe(6);                       // 8 kayıt − 1 iptal − 1 tarihsiz
  });

  it('kaydı olmayan ay GERÇEK 0', () => {
    expect(aylar[0].ekran).toBe(0);                   // Nisan
    expect(aylar[0].grafik).toBe(0);
  });

  it('`adet` tutarı bilinmeyen kaydı da sayar (trend grafiğinin sipariş serisi paritesi)', () => {
    expect(aylar[3].adet).toBe(1);                    // Temmuz: tutarsız ama sipariş var
  });
});

describe('donemToplami / olcekTavani', () => {
  const aylar = aylikCiro(aylikSiparisler, 6, BUGUN, { iptalHaric: true });

  it('donemToplami kısmi toplamı ve iki sayacı birleştirir (trend "6 ay toplam ciro")', () => {
    const t = donemToplami(aylar);
    expect(t.toplam).toBe(36700);                     // 20000 + 16000 + 700
    expect(t.bilinmeyen).toBe(1);                     // Temmuz
  });

  // MUTASYON-AYIRT EDİCİ: `Math.max(...rev, 1)` NaN görünce NaN döner → tüm çubuk yükseklikleri NaN.
  it('MUTASYON-AYIRT EDİCİ: olcekTavani bilinmeyeni ölçeğe SOKMAZ, NaN üretmez', () => {
    const tavan = olcekTavani(aylar);
    expect(Number.isFinite(tavan)).toBe(true);
    expect(tavan).toBe(20000);
  });

  it('hepsi bilinmiyorsa ölçek tavanı 1 (sıfıra bölme koruması; para iddiası değil)', () => {
    const hic = aylikCiro([s({ createdAt: BUGUN })], 1, BUGUN, { iptalHaric: false });
    expect(olcekTavani(hic)).toBe(1);
  });
});

// ── MTD (Phase 56) ───────────────────────────────────────────────────────────────────────────
const mtdSiparisler: CiroSiparisi[] = [
  s({ createdAt: new Date(2026, 8, 5), totalPrice: 12000 }),
  s({ createdAt: new Date(2026, 8, 18), totalPrice: 8000 }),
  s({ createdAt: new Date(2026, 7, 10), totalPrice: 10000 }),
  s({ createdAt: new Date(2026, 7, 20), totalPrice: 6000 }),
];

describe('mtdKarsilastir — Phase 56 "Bu Ay Ciro (MTD)"', () => {
  const r = mtdKarsilastir(mtdSiparisler, BUGUN, { iptalHaric: false });

  it('SAYFA PARİTESİ: MTD ve geçen ay toplamları eskiyle BİREBİR aynı', () => {
    expect(r.ekran).toBe(20000);
    expect(r.gecenAyEkran).toBe(16000);
  });

  it('SAYFA PARİTESİ: sapma yüzdesi ve yönü', () => {
    expect(r.yuzde).toBe(25);
    expect(r.yon).toBe('artis');
  });

  it('SAYFA PARİTESİ: ay ilerlemesi ve projeksiyon eski formülle aynı', () => {
    expect(r.ayIlerlemesi).toBe(63);                  // round(19/30*100)
    expect(r.projeksiyon).toBe(31746);                // round(20000 * 100/63)
  });

  // MUTASYON-AYIRT EDİCİ: eski kod kısmi toplamdan "▲ %..." üretiyordu.
  it('MUTASYON-AYIRT EDİCİ: bu ayda tek kayıt bilinmiyorsa sapma HESAPLANMAZ (rozet çizilmez)', () => {
    const k = mtdKarsilastir([...mtdSiparisler, s({ createdAt: new Date(2026, 8, 9) })], BUGUN, { iptalHaric: false });
    expect(k.yuzde).toBeNull();
    expect(k.yon).toBeNull();
    expect(k.ekran).toBe(20000);                      // ekran KISMİ toplam gösterir
    expect(k.buAy.bilinmeyen).toBe(1);                // "1 kayıt tutarsız" notu
  });

  it('MUTASYON-AYIRT EDİCİ: GEÇEN ayda bilinmeyen varsa da sapma hesaplanmaz', () => {
    const k = mtdKarsilastir([...mtdSiparisler, s({ createdAt: new Date(2026, 7, 9) })], BUGUN, { iptalHaric: false });
    expect(k.yuzde).toBeNull();
    expect(k.gecenAy.bilinmeyen).toBe(1);
    // Sayfa sözleşmesi: 'Geçen ay' satırı KISMİ toplam basar (türetme değil, EKRAN) ve
    // yanına bu sayaçla "N kaydın tutarı okunamadı" notunu koyar. Sayaç sıfırlanırsa
    // ekranda eksik rakam NOTSUZ görünür (Faz 3 5/n hakem bulgusu).
    expect(k.gecenAyEkran).toBe(16000);
    expect(k.buAy.bilinmeyen).toBe(0);               // iki dönem AYRIK — not mükerrer değil
  });

  it('geçen ayın TÜM kayıtları tutarsızsa ekran NaN ("—"), 0 değil', () => {
    const k = mtdKarsilastir([
      s({ createdAt: new Date(2026, 8, 5), totalPrice: 12000 }),
      s({ createdAt: new Date(2026, 7, 10) }),
      s({ createdAt: new Date(2026, 7, 20) }),
    ], BUGUN, { iptalHaric: false });
    expect(Number.isNaN(k.gecenAyEkran)).toBe(true);
    expect(k.gecenAy.bilinen).toBe(0);
    expect(k.gecenAy.bilinmeyen).toBe(2);            // satır çizilir, '—' + "2 kayıt okunamadı"
  });

  // MUTASYON-AYIRT EDİCİ: eski `mtdRev * (100/dayProgress)` kısmi toplamı aya yayıyordu.
  it('MUTASYON-AYIRT EDİCİ: MTD tam bilinmiyorsa projeksiyon üretilmez (NaN → "—")', () => {
    const k = mtdKarsilastir([...mtdSiparisler, s({ createdAt: new Date(2026, 8, 9) })], BUGUN, { iptalHaric: false });
    expect(Number.isNaN(k.projeksiyon)).toBe(true);
  });

  it('geçen ay cirosu 0/negatifse yüzde yok (0a bölme; "%0 artış" sahte kesinliktir)', () => {
    const k = mtdKarsilastir([s({ createdAt: new Date(2026, 8, 5), totalPrice: 5000 })], BUGUN, { iptalHaric: false });
    expect(k.yuzde).toBeNull();
    expect(k.gecenAyEkran).toBe(0);
  });

  it('hiç kayıt yoksa MTD gerçek 0, projeksiyon 0 (hareketsiz ay)', () => {
    const k = mtdKarsilastir([], BUGUN, { iptalHaric: false });
    expect(k.ekran).toBe(0);
    expect(k.projeksiyon).toBe(0);
  });

  it('geçen ayın SON günü dâhil, bir sonraki ay hariç (ay sınırı paritesi)', () => {
    const k = mtdKarsilastir([
      s({ createdAt: new Date(2026, 7, 31, 23, 30), totalPrice: 900 }),   // 31 Ağustos
      s({ createdAt: new Date(2026, 6, 31), totalPrice: 111 }),           // Temmuz — hiçbirine girmez
    ], BUGUN, { iptalHaric: false });
    expect(k.gecenAyEkran).toBe(900);
    expect(k.ekran).toBe(0);
  });

  it('iptalHaric:true iptal siparişi MTD dışına alır (Phase 99 süzgeci ile aynı kapı)', () => {
    const k = mtdKarsilastir(
      [...mtdSiparisler, s({ createdAt: new Date(2026, 8, 9), totalPrice: 1000, status: 'Cancelled' })],
      BUGUN, { iptalHaric: true },
    );
    expect(k.ekran).toBe(20000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6b EKİ (2026-09-24): `ceyreklikCiro` — çeyreklik ciro penceresi (GenelBloklar1.tsx:171-224, P156 QoQ)
//   :181  `quarters.push({ …, revenue: 0, orders: 0 })`         → `revenue` Tutar kovası olmalı
//   :189  `entry.revenue += o.totalPrice || 0; entry.orders++;`  → tutarsız sipariş ₺0 giriyor, adet artıyor
//   :185  `if (!d) continue;`                                    → tarihsiz kayıt sessizce düşüyor
//   :189  `find` eşleşmezse (pencere dışı)                       → sessizce düşüyor
//   :194  `prevQ.revenue > 0 ? Math.round(…) : null`             → KISMİ toplamdan QoQ; tamTutar kapısı yok
// Kural: tutarı okunamayan sipariş ₺0 değildir; toplama girmez, SAYILIR. Tarihsiz / pencere dışı izsiz kaybolmaz.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { ceyreklikCiro } from './ciroDonem';
import { tamTutar } from '../para';

// BUGUN = 19 Eylül 2026 → pencere (4 çeyrek): 2025-Q4, 2026-Q1, 2026-Q2, 2026-Q3
const ceyrekSiparisler: CiroSiparisi[] = [
  s({ createdAt: new Date(2025, 10, 10), totalPrice: 5000 }),                      // 2025-Q4 — Şirin İnşaat
  s({ createdAt: new Date(2026, 1, 3), totalPrice: 7000 }),                        // 2026-Q1 — Çelik Yapı
  s({ createdAt: new Date(2026, 2, 31, 23, 59), totalPrice: 1000 }),               // 2026-Q1 — çeyrek SINIRI (son dakika)
  s({ createdAt: new Date(2026, 3, 1, 0, 0), totalPrice: 2000 }),                  // 2026-Q2 — çeyrek SINIRI (ilk an)
  s({ createdAt: new Date(2026, 7, 18), totalPrice: 8000 }),                       // 2026-Q3
  s({ createdAt: new Date(2026, 8, 5), totalPrice: 12000 }),                       // 2026-Q3 — ÇİMENTO 50KG
];

describe('ceyreklikCiro — 6b eki, GB1 P156 paritesi', () => {
  const c = ceyreklikCiro(ceyrekSiparisler, 4, BUGUN, { iptalHaric: true });

  it('PARİTE: 4 çeyrek en eskiden yeniye; anahtar "YYYY-Qn", etiket "Qn YYYY" (getQLabel ile BİREBİR)', () => {
    expect(c.satirlar.map(q => q.anahtar)).toEqual(['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3']);
    expect(c.satirlar.map(q => q.etiket)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026']);
    expect(c.satirlar[3]).toMatchObject({ etiket: 'Q3 2026', anahtar: '2026-Q3', ceyrek: 3, yil: 2026 });
    expect(c.satirlar[0]).toMatchObject({ ceyrek: 4, yil: 2025, tarih: new Date(2025, 9, 1) });
    expect(c.satirlar[3].tarih).toEqual(new Date(2026, 6, 1));
  });

  it('PARİTE: bilinen girdide çeyrek cirosu eski `revenue` toplamıyla BİREBİR', () => {
    expect(c.satirlar.map(q => q.ekran)).toEqual([5000, 8000, 2000, 20000]);
    expect(c.satirlar.map(q => q.adet)).toEqual([1, 2, 1, 2]);
    expect(c.satirlar.map(q => q.grafik)).toEqual([5000, 8000, 2000, 20000]);
    expect(c.tarihsiz).toBe(0);
    expect(c.pencereDisi).toBe(0);
  });

  it('çeyrek sınırı: 31.03 23:59 → Q1, 01.04 00:00 → Q2', () => {
    expect(c.satirlar[1].adet).toBe(2);   // 7000 + 1000 (son dakika)
    expect(c.satirlar[2].adet).toBe(1);   // 2000 (ilk an)
  });

  it('MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen sipariş ₺0 SAYILMAZ, SAYILIR; QoQ türetmesi kapanır', () => {
    const r = ceyreklikCiro([
      s({ createdAt: new Date(2026, 8, 5), totalPrice: 13000 }),
      s({ createdAt: new Date(2026, 8, 6) }),                                      // tutarı OKUNAMADI
    ], 4, BUGUN);
    const q3 = r.satirlar[3];
    expect(q3.tutar).toEqual({ toplam: 13000, bilinen: 1, bilinmeyen: 1 });
    expect(q3.ekran).toBe(13000);
    expect(q3.adet).toBe(2);                                                        // `entry.orders++` paritesi
    expect(Number.isNaN(tamTutar(q3.tutar))).toBe(true);                            // rozet ÇİZİLMEZ
  });

  it('MUTASYON-AYIRT EDİCİ: çeyreğin TÜM siparişleri tutarsızsa ekran NaN, grafik null (0 DEĞİL)', () => {
    const r = ceyreklikCiro([
      s({ createdAt: new Date(2026, 4, 5) }),
      s({ createdAt: new Date(2026, 5, 6), totalPrice: 'abc' }),
    ], 4, BUGUN);
    const q2 = r.satirlar[2];
    expect(Number.isNaN(q2.ekran)).toBe(true);
    expect(q2.grafik).toBeNull();
    expect(q2.adet).toBe(2);
    expect(q2.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
  });

  it('kaydı olmayan çeyrek GERÇEK 0 (boş liste), grafik 0 çizilir', () => {
    const r = ceyreklikCiro([s({ createdAt: new Date(2026, 8, 5), totalPrice: 1 })], 4, BUGUN);
    expect(r.satirlar[0]).toMatchObject({ ekran: 0, grafik: 0, adet: 0, tutar: { toplam: 0, bilinen: 0, bilinmeyen: 0 } });
  });

  it('MUTASYON-AYIRT EDİCİ: tarihi çözülemeyen sipariş `tarihsiz` sayılır, hiçbir çeyreğe (bugüne de) girmez', () => {
    const r = ceyreklikCiro([s({ totalPrice: 300 }), s({ createdAt: 'çözülemez', totalPrice: 400 })], 4, BUGUN);
    expect(r.tarihsiz).toBe(2);
    expect(r.satirlar.map(q => q.adet)).toEqual([0, 0, 0, 0]);
    expect(r.satirlar[3].ekran).toBe(0);                                            // "bugün"e düşmedi
  });

  it('BİLİNÇLİ FARK 1: yalnız `syncedAt`i olan sipariş çeyreğe GİRER (GB1 yalnız createdAt okuyor, aylikCiro sayıyor)', () => {
    const r = ceyreklikCiro([s({ syncedAt: new Date(2026, 8, 9), totalPrice: 700 })], 4, BUGUN);
    expect(r.satirlar[3].ekran).toBe(700);
    expect(r.satirlar[3].adet).toBe(1);
    expect(r.tarihsiz).toBe(0);
  });

  it('pencere dışı (5 çeyrek önce) sipariş `pencereDisi` sayılır — bugün `find` ile sessizce düşüyor', () => {
    const r = ceyreklikCiro([s({ createdAt: new Date(2025, 6, 1), totalPrice: 900 })], 4, BUGUN); // 2025-Q3
    expect(r.pencereDisi).toBe(1);
    expect(r.satirlar.map(q => q.adet)).toEqual([0, 0, 0, 0]);
  });

  it('yıl sınırı: bugün 15.01.2026 → 2025-Q2 … 2026-Q1; Aralık 2025 → 2025-Q4, Ocak 2026 → 2026-Q1', () => {
    const r = ceyreklikCiro([
      s({ createdAt: new Date(2025, 11, 20), totalPrice: 100 }),
      s({ createdAt: new Date(2026, 0, 10), totalPrice: 200 }),
    ], 4, new Date(2026, 0, 15));
    expect(r.satirlar.map(q => q.anahtar)).toEqual(['2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1']);
    expect(r.satirlar.map(q => q.etiket)).toEqual(['Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026']);
    expect(r.satirlar[2].ekran).toBe(100);
    expect(r.satirlar[3].ekran).toBe(200);
  });

  it('iptalHaric:true iptali hem tutardan hem adetten düşürür; false ikisini de sayar', () => {
    const liste = [
      s({ createdAt: new Date(2026, 8, 5), totalPrice: 12000 }),
      s({ createdAt: new Date(2026, 8, 12), totalPrice: 4000, status: 'Cancelled' }),
    ];
    const haric = ceyreklikCiro(liste, 4, BUGUN, { iptalHaric: true });
    expect(haric.satirlar[3].ekran).toBe(12000);
    expect(haric.satirlar[3].adet).toBe(1);
    const dahil = ceyreklikCiro(liste, 4, BUGUN, { iptalHaric: false });
    expect(dahil.satirlar[3].ekran).toBe(16000);
    expect(dahil.satirlar[3].adet).toBe(2);
    // Varsayılan seçenek aylikCiro ile AYNI: { iptalHaric: false }
    expect(ceyreklikCiro(liste, 4, BUGUN).satirlar[3].ekran).toBe(16000);
  });

  it('BİLİNÇLİ FARK 3: `totalAmount` yedeği siparisTutari üzerinden sayılır (mutasyon: `o.totalPrice` doğrudan okunursa bilinmeyen)', () => {
    const r = ceyreklikCiro([s({ createdAt: new Date(2026, 8, 5), totalAmount: 2500 })], 4, BUGUN);
    expect(r.satirlar[3].tutar).toEqual({ toplam: 2500, bilinen: 1, bilinmeyen: 0 });
  });

  it('ceyrekSayisi pozitif tam sayı değilse throw (sessiz boş sonuç YOK)', () => {
    for (const n of [0, -1, 2.5, NaN]) {
      expect(() => ceyreklikCiro(ceyrekSiparisler, n, BUGUN), String(n)).toThrow();
    }
  });

  it('DEĞİŞMEZ: Σ adet + tarihsiz + pencereDisi === iptalsiz liste uzunluğu', () => {
    const karisik = [
      ...ceyrekSiparisler,
      s({ totalPrice: 300 }),                                                        // tarihsiz
      s({ createdAt: new Date(2025, 6, 1), totalPrice: 900 }),                       // pencere dışı
      s({ createdAt: new Date(2026, 8, 6) }),                                        // tutarsız (çeyreğe girer)
      s({ createdAt: new Date(2026, 8, 12), totalPrice: 4000, status: 'Cancelled' }), // iptal → hiçbir sayaçta
    ];
    const r = ceyreklikCiro(karisik, 4, BUGUN, { iptalHaric: true });
    const adet = r.satirlar.reduce((t, q) => t + q.adet, 0);
    expect(adet + r.tarihsiz + r.pencereDisi).toBe(karisik.length - 1);
    expect(adet + r.tarihsiz + r.pencereDisi).toBe(karisik.filter(o => o.status !== 'Cancelled').length);
  });

  it('girdi mutasyona uğramaz: Object.freeze\'li dizi ve öğelerle hata atmaz', () => {
    const donuk = Object.freeze(ceyrekSiparisler.map(o => Object.freeze({ ...o })));
    expect(() => ceyreklikCiro(donuk, 4, BUGUN, { iptalHaric: true })).not.toThrow();
    expect(ceyreklikCiro(donuk, 4, BUGUN, { iptalHaric: true }).satirlar[3].ekran).toBe(20000);
  });
});
