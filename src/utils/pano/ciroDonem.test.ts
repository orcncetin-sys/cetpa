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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6c EKİ (2026-10-17): `yilAylikCiro` (O7) + `hareketliOrtalama` (O6, O8)
//   GenelBloklar2 P251 YoY:
//     her ay için İKİ `orders.filter(…)` — kopya dönem hesabı (`aylikCiro` aynı satırı zaten üretiyor)
//     `const d = zamanDate(o.createdAt); return d !== null && d.getFullYear() === currYear && d.getMonth() === i;`
//                                                         → tarihi çözülemeyen kayıt SESSİZCE düşüyor
//     `.reduce((s, o) => s + (o.totalPrice || 0), 0)`     → tutarı bilinmeyen ₺0
//   GenelBloklar4 P96 «Rolling 7-Day Avg»:
//     `dayRev[key] = (dayRev[key] || 0) + o.totalPrice;` → `o.totalPrice` undefined ise gün NaN olur…
//     `days.slice(i - 6, i + 1).reduce((s, d) => s + (dayRev[d] || 0), 0)` → …ve `NaN || 0` o günün BİLİNEN
//                                                           cirosunu da SIFIRLAR; ortalama sessizce düşer
// Kural: tutarı okunamayan sipariş ₺0 değildir; hareketli ortalamada penceresinde bilinmeyen olan NOKTA `null` (O6).
// O21: TRY dışı mağaza siparişi (`dovizTutar` + `paraBirimi`, `totalPrice` YOK) yardımcıya ULAŞMAZ — ayrım ÇAĞIRANDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { yilAylikCiro, hareketliOrtalama, type YilAylikCiro } from './ciroDonem';
import { zamanDate, gunAnahtari, gunFarki, tarihYaz } from '../zaman';
import { siparisTutari } from '../siparis';
import { zamanKovalari } from '../rapor/zamanDagilimi';
import { tryDisiMi } from '../siparisler/magazaSiparisi';
import type { Tutar } from '../para';

/** Mağaza alanlarını da taşıyan fikstür siparişi (yalnız O21 vakaları için). */
type MagazaliSiparis = CiroSiparisi & { paraBirimi?: string; dovizTutar?: number; customerName?: string };

/** O21 ortak fikstürü — TRY dışı mağaza siparişi; sunucu `totalPrice` YAZMAZ (shopifyEsleme TRY dışı yazımı). */
const dovizli = (createdAt: Date): MagazaliSiparis => ({
  source: 'shopify_webhook', paraBirimi: 'EUR', dovizTutar: 50, customerName: 'Kaya Hırdavat', status: 'Delivered', createdAt,
});

/** Çağıran reçetesi (O21): K2 süzgeci + `tryDisiMi` (TEK tanım — kural kopyalanmaz). */
const tlListesi = (x: readonly MagazaliSiparis[]): { tl: MagazaliSiparis[]; dovizliSayisi: number } => {
  const iptalsiz = x.filter(o => o.status !== 'Cancelled');
  return { tl: iptalsiz.filter(o => !tryDisiMi(o)), dovizliSayisi: iptalsiz.filter(tryDisiMi).length };
};

const yilSiparisleri: CiroSiparisi[] = [
  s({ createdAt: new Date(2026, 0, 15), totalPrice: 12000 }),                      // Ocak 2026 — Şirin İnşaat ÇİMENTO 50KG
  s({ createdAt: new Date(2026, 2, 3), totalPrice: 8000 }),                        // Mart 2026 — Çelik Yapı
  s({ createdAt: new Date(2026, 2, 31, 23, 59), totalPrice: 5000 }),               // Mart — ay SINIRI (son dakika)
  s({ createdAt: new Date(2026, 3, 1, 0, 0), totalPrice: 2000 }),                  // Nisan — ay SINIRI (ilk an)
  s({ createdAt: new Date(2026, 8, 5), totalPrice: 7000, status: 'Cancelled' }),   // Eylül — iptal
  s({ createdAt: new Date(2026, 11, 31, 23, 0), totalPrice: 3000 }),               // Aralık sonu
  s({ createdAt: new Date(2025, 5, 10), totalPrice: 9000 }),                       // 2025 Haziran
  s({ createdAt: new Date(2025, 11, 20), totalPrice: 4000 }),                      // 2025 Aralık
];

describe('yilAylikCiro — 6c eki (O7)', () => {
  const adetToplami = (r: YilAylikCiro): number => r.aylar.reduce((t, a) => t + a.adet, 0);

  it('1 · SARMALAYICI PARİTESİ: `aylar` ≡ aylikCiro(x, 12, new Date(yil, 11, 1), sec, dil) — iptalHaric true VE false', () => {
    for (const iptalHaric of [true, false]) {
      for (const yil of [2026, 2025]) {
        expect(yilAylikCiro(yilSiparisleri, yil, { iptalHaric }, 'tr').aylar)
          .toEqual(aylikCiro(yilSiparisleri, 12, new Date(yil, 11, 1), { iptalHaric }, 'tr'));
      }
    }
    expect(yilAylikCiro(yilSiparisleri, 2026, { iptalHaric: true }, 'en').aylar)
      .toEqual(aylikCiro(yilSiparisleri, 12, new Date(2026, 11, 1), { iptalHaric: true }, 'en'));
  });

  it('2 · PARİTE (GB2 P251 formülüyle): bilinen + createdAt\'li girdide ay tutarları ve etiketleri BİREBİR', () => {
    const currYear = 2026;
    // GB2 P251'in ESKİ formülü test içinde yeniden yazıldı.
    const eski = Array.from({ length: 12 }, (_, i) => {
      const label = tarihYaz(new Date(currYear, i, 1), { month: 'short' }, 'tr');
      const curr = yilSiparisleri.filter(o => {
        if (o.status === 'Cancelled') return false;
        const d = zamanDate(o.createdAt); return d !== null && d.getFullYear() === currYear && d.getMonth() === i;
      }).reduce((t, o) => t + (Number(o.totalPrice) || 0), 0);
      return { label, curr };
    });
    const r = yilAylikCiro(yilSiparisleri, currYear, { iptalHaric: true }, 'tr');
    expect(r.aylar).toHaveLength(12);
    expect(r.aylar[0].anahtar).toBe('2026-01');
    expect(r.aylar[11].anahtar).toBe('2026-12');
    expect(r.aylar.map(a => a.ekran)).toEqual(eski.map(m => m.curr));
    expect(r.aylar.map(a => a.etiket)).toEqual(eski.map(m => m.label));
    expect(r.aylar[2].ekran).toBe(13000);                 // 8.000 + 5.000 (son dakika Mart'ta)
    expect(r.aylar[3].ekran).toBe(2000);                  // ilk an Nisan'da
    expect(r.tarihsiz).toBe(0);
    expect(r.yilDisi).toBe(2);                            // iki 2025 siparişi
  });

  it('3 · MUTASYON-AYIRT EDİCİ: tutarı bilinmeyen ₺0 SAYILMAZ; YoY türetmesi kapanır', () => {
    const r = yilAylikCiro([
      s({ createdAt: new Date(2026, 2, 5), totalPrice: 13000 }),
      s({ createdAt: new Date(2026, 2, 6) }),                                       // tutarı OKUNAMADI
    ], 2026, { iptalHaric: true }, 'tr');
    expect(r.aylar[2].tutar).toEqual({ toplam: 13000, bilinen: 1, bilinmeyen: 1 });
    expect(r.aylar[2].adet).toBe(2);
    expect(Number.isNaN(tamTutar(donemToplami(r.aylar)))).toBe(true);
    // Hiç bileni olmayan ay: ekran NaN ('—'), grafik null (0 DEĞİL).
    const yalnizTutarsiz = yilAylikCiro([s({ createdAt: new Date(2026, 4, 2) })], 2026);
    expect(Number.isNaN(yalnizTutarsiz.aylar[4].ekran)).toBe(true);
    expect(yalnizTutarsiz.aylar[4].grafik).toBeNull();
  });

  it('4 · tarihsiz / yıl dışı SAYILIR; DEĞİŞMEZ Σ adet + tarihsiz + yilDisi === liste', () => {
    const liste = [
      s({ createdAt: new Date(2026, 6, 1), totalPrice: 1000 }),
      s({ createdAt: 'çöp', totalPrice: 2000 }),                                    // tarihsiz (syncedAt yok)
      s({ createdAt: new Date(2024, 1, 1), totalPrice: 3000 }),                     // yıl dışı
    ];
    const r = yilAylikCiro(liste, 2026, { iptalHaric: true });
    expect(r.tarihsiz).toBe(1);
    expect(r.yilDisi).toBe(1);
    expect(adetToplami(r) + 2).toBe(liste.length);
    expect(adetToplami(r) + r.tarihsiz + r.yilDisi).toBe(liste.length);
  });

  it('5 · iptal süzgeci sayaçlara da uygulanır: iptal edilmiş tarihsiz sipariş `tarihsiz`e GİRMEZ', () => {
    const liste = [
      s({ createdAt: new Date(2026, 6, 1), totalPrice: 1000 }),
      s({ createdAt: 'çöp', totalPrice: 2000, status: 'Cancelled' }),
      s({ createdAt: new Date(2023, 6, 1), totalPrice: 2000, status: 'Cancelled' }),
    ];
    expect(yilAylikCiro(liste, 2026, { iptalHaric: true })).toMatchObject({ tarihsiz: 0, yilDisi: 0 });
    expect(yilAylikCiro(liste, 2026, { iptalHaric: false })).toMatchObject({ tarihsiz: 1, yilDisi: 1 });
    const r = yilAylikCiro(liste, 2026, { iptalHaric: true });
    expect(adetToplami(r) + r.tarihsiz + r.yilDisi).toBe(liste.filter(o => o.status !== 'Cancelled').length);
  });

  it('6 · syncedAt yedeği (bilinçli fark): createdAt yok, syncedAt Mart 2026 → Mart\'a girer', () => {
    const r = yilAylikCiro([s({ syncedAt: new Date(2026, 2, 14), totalPrice: 4500 })], 2026);
    expect(r.aylar[2].ekran).toBe(4500);
    expect(r.tarihsiz).toBe(0);
  });

  it('7 · geçersiz yıl → throw (iki haneli yıl tuzağı: new Date(26, 11, 1) 1926\'dır)', () => {
    for (const yil of [2026.5, 26, NaN, 999, 10000, Infinity]) {
      expect(() => yilAylikCiro(yilSiparisleri, yil)).toThrow(/dört haneli/);
    }
  });

  it('8 · boş liste: 12 sıfır ay; donuk girdi mutasyona uğramaz', () => {
    const bos = yilAylikCiro([], 2026);
    expect(bos.aylar).toHaveLength(12);
    expect(bos.aylar.every(a => a.tutar.toplam === 0 && a.tutar.bilinen === 0 && a.tutar.bilinmeyen === 0)).toBe(true);
    expect(bos).toMatchObject({ tarihsiz: 0, yilDisi: 0 });
    const donuk = Object.freeze(yilSiparisleri.map(o => Object.freeze({ ...o })));
    expect(() => yilAylikCiro(donuk, 2026, { iptalHaric: true })).not.toThrow();
  });

  it('9 · O21: TRY dışı mağaza siparişi TL ay toplamına GİRMEZ (ayrım çağıranda)', () => {
    const x: MagazaliSiparis[] = [
      s({ createdAt: new Date(2026, 2, 5), totalPrice: 13000 }),
      dovizli(new Date(2026, 2, 10)),
    ];
    // (a) süzgeçsiz — yardımcı `dovizTutar`ı OKUMAZ: «tutarı bilinmeyen», 50 EUR TL'ye EKLENMEDİ.
    const a = yilAylikCiro(x, 2026, { iptalHaric: true }, 'tr');
    expect(a.aylar[2].tutar).toEqual({ toplam: 13000, bilinen: 1, bilinmeyen: 1 });
    expect(a.aylar[2].adet).toBe(2);
    expect(Number.isNaN(tamTutar(donemToplami(a.aylar)))).toBe(true);
    // (b) çağıran reçetesiyle — sayısal, `bilinmeyen` 0, `dovizli` 1.
    const { tl, dovizliSayisi } = tlListesi(x);
    const b = yilAylikCiro(x.filter(o => !tryDisiMi(o)), 2026, { iptalHaric: true }, 'tr');
    expect(b.aylar[2].tutar).toEqual({ toplam: 13000, bilinen: 1, bilinmeyen: 0 });
    expect(tamTutar(donemToplami(b.aylar))).toBe(13000);
    expect(dovizliSayisi).toBe(1);
    expect(adetToplami(b) + b.tarihsiz + b.yilDisi).toBe(tl.length);
  });
});

// ── hareketliOrtalama ────────────────────────────────────────────────────────────────────────
const bilinen = (toplam: number, adet = 1): Tutar => ({ toplam, bilinen: adet, bilinmeyen: 0 });
const BOS: Tutar = { toplam: 0, bilinen: 0, bilinmeyen: 0 };

describe('hareketliOrtalama — 6c eki (O6)', () => {
  // 28 günlük ÇİMENTO 50KG ciro serisi (tam TL); bazı günler siparişsiz (meşru ₺0).
  const seri: Tutar[] = Array.from({ length: 28 }, (_, i) => (i % 5 === 3 ? BOS : bilinen(1000 * ((i % 7) + 1))));

  it('1 · PARİTE (GB4 P96 algoritmasıyla, O8 reçetesi): bilinen girdide 22 nokta eski `sum / 7` ile BİREBİR', () => {
    // 28 günlük siparişler (BUGUN = 19.09.2026): gün başına 0–2 sipariş, tutarlar bilinen.
    const siparisler: CiroSiparisi[] = [];
    for (let i = 0; i < 28; i++) {
      const gun = new Date(BUGUN.getFullYear(), BUGUN.getMonth(), BUGUN.getDate() - (27 - i), 9 + (i % 8));
      if (i % 6 !== 2) siparisler.push(s({ createdAt: gun, totalPrice: 2500 + i * 125 }));
      if (i % 4 === 1) siparisler.push(s({ createdAt: new Date(gun.getTime() + 3600000), totalPrice: 1800 }));
    }
    // GB4 P96'nın ESKİ algoritması test içinde yeniden yazıldı (`now` yerine BUGUN).
    const days = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(BUGUN);
      d.setDate(d.getDate() - (27 - i));
      return gunAnahtari(d) ?? '';
    });
    const dayRev: Record<string, number> = {};
    siparisler.forEach(o => {
      const key = gunAnahtari(o.createdAt);
      if (!key) return;
      dayRev[key] = (dayRev[key] || 0) + Number(o.totalPrice);
    });
    const rolling7: number[] = [];
    for (let i = 6; i < days.length; i++) {
      const sum = days.slice(i - 6, i + 1).reduce((t, d) => t + (dayRev[d] || 0), 0);
      rolling7.push(sum / 7);
    }
    // O8 reçetesi: zamanKovalari (28 takvim günü) → hareketliOrtalama(…, 7).slice(6)
    const g = zamanKovalari(siparisler, 28, d => { const f = gunFarki(BUGUN, d); return f === null ? -1 : 27 - f; },
      { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
    const ho = hareketliOrtalama(g.kovalar.map(k => k.ciro), 7).slice(6);
    expect(ho).toHaveLength(22);
    expect(ho).toEqual(rolling7);
    expect(g.tarihsiz + g.kapsamDisi).toBe(0);
  });

  it('2 · ilk `pencere − 1` nokta null; uzunluk = girdi uzunluğu', () => {
    const ho = hareketliOrtalama(seri, 7);
    expect(ho).toHaveLength(28);
    expect(ho.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(ho.slice(6).every(v => typeof v === 'number')).toBe(true);
    expect(ho[6]).toBe((seri.slice(0, 7).reduce((t, x) => t + x.toplam, 0)) / 7);
  });

  it('3 · MUTASYON-AYIRT EDİCİ: bilinmeyen ₺0 SAYILMAZ, günü SIFIRLAMAZ — penceresindeki NOKTA null', () => {
    const kusurlu = seri.map((t, i) => (i === 9 ? { toplam: 5000, bilinen: 1, bilinmeyen: 1 } : t));
    const ho = hareketliOrtalama(kusurlu, 7);
    for (let i = 9; i <= 15; i++) expect(ho[i]).toBeNull();
    expect(typeof ho[8]).toBe('number');
    expect(typeof ho[16]).toBe('number');
    expect(ho[8]).toBe(hareketliOrtalama(seri, 7)[8]);
  });

  it('4 · siparişsiz gün meşru ₺0 (takvim günü) — nokta 0, null DEĞİL', () => {
    const ho = hareketliOrtalama(Array.from({ length: 10 }, () => BOS), 7);
    expect(ho.slice(6)).toEqual([0, 0, 0, 0]);
  });

  it('5 · geçersiz pencere → throw', () => {
    for (const p of [0, -3, 2.5, NaN, Infinity]) expect(() => hareketliOrtalama(seri, p)).toThrow(/pencere/);
  });

  it('6 · boş girdi → []; pencereden kısa girdi → hepsi null; donuk girdi mutasyona uğramaz', () => {
    expect(hareketliOrtalama([], 7)).toEqual([]);
    expect(hareketliOrtalama(seri.slice(0, 4), 7)).toEqual([null, null, null, null]);
    const donuk = Object.freeze(seri.map(t => Object.freeze({ ...t })));
    expect(() => hareketliOrtalama(donuk, 7)).not.toThrow();
    expect(hareketliOrtalama(donuk, 1)).toEqual(seri.map(t => t.toplam));
  });

  it('7 · O21 (bileşik — zamanKovalari + hareketliOrtalama): dövizli sipariş yedi noktayı `null` yapmamalı', () => {
    const x: MagazaliSiparis[] = Array.from({ length: 28 }, (_, i) =>
      s({ createdAt: new Date(BUGUN.getFullYear(), BUGUN.getMonth(), BUGUN.getDate() - (27 - i), 11), totalPrice: 3000 + i }));
    x.push(dovizli(new Date(BUGUN.getFullYear(), BUGUN.getMonth(), BUGUN.getDate() - (27 - 9), 15)));   // 10. gün
    const kovala28 = (liste: readonly MagazaliSiparis[]) => zamanKovalari(liste, 28,
      d => { const f = gunFarki(BUGUN, d); return f === null ? -1 : 27 - f; },
      { tarihSec: o => o.createdAt, tutarSec: siparisTutari });
    // (a) süzgeçsiz — `dovizTutar` TL'ye eklenmedi, ₺0 sayılmadı: gün «bilinmeyen» → 9..15 null.
    const ga = kovala28(x);
    expect(ga.kovalar[9].ciro.bilinmeyen).toBe(1);
    expect(ga.kovalar[9].ciro.toplam).toBe(3009);
    const hoa = hareketliOrtalama(ga.kovalar.map(k => k.ciro), 7);
    for (let i = 9; i <= 15; i++) expect(hoa[i]).toBeNull();
    // (b) çağıran reçetesiyle — 22 noktanın hepsi sayı.
    const { tl, dovizliSayisi } = tlListesi(x);
    const hob = hareketliOrtalama(kovala28(tl).kovalar.map(k => k.ciro), 7).slice(6);
    expect(hob).toHaveLength(22);
    expect(hob.every(v => typeof v === 'number')).toBe(true);
    expect(dovizliSayisi).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6d EKİ (2026-10-18): `kumulatifSeyir` — gün gün kümülatif ciro (GenelBloklar5 P13 «Kümülatif Ciro Seyri»)
//   `[...orders].sort((a,b) => { const ta = zamanMs(a.createdAt) ?? 0; const tb = zamanMs(b.createdAt) ?? 0; return ta-tb; })`
//     → tarihsiz sipariş EPOCH 0'a (1970) sıralanıp eğrinin BAŞINA giriyor, sayılmıyor; iptaller dâhil (K2)
//   `cumulative += total; return cumulative;` → hayalet `total` / kalem toplamı; bilinmeyen tutar ₺0
//   `.filter((_,i)=>i%Math.max(1,Math.floor(sorted.length/40))===0)` → örnekleme SON noktayı düşürür: «total» rozeti
//     GERÇEK toplamı göstermez (n = 100 → son indeks 98); n = 41 → 41 nokta (tavan tutmaz)
// K2 · İptaller ciroya girsin mi → "hayır". — `sec.iptalHaric` ÇAĞIRANDA açıkça verilir.
// K1 + O26: sipariş tutarı siparisTutari — kalem toplamından yedek YOK; total / unitPrice okunmaz.
// O21: TRY dışı mağaza siparişi yardımcıya ULAŞMAZ — ayrım ÇAĞIRANDA.
// ═══════════════════════════════════════════════════════════════════════════════════════════
import { kumulatifSeyir, type KumulatifSeyir } from './ciroDonem';
import { zamanMs } from '../zaman';
import type { Order } from '../../types';
import type { MagazaSiparisAlanlari } from '../siparisler/magazaSiparisi';

/** O21 ortak fikstürü (6d — TİPLİ): TRY dışı mağaza siparişi; `totalPrice` YOK (shopifyEsleme TRY dışı yazımı). */
const DOVIZLI: MagazaSiparisAlanlari = {
  source: 'shopify_webhook', paraBirimi: 'EUR', dovizTutar: 50, customerName: 'Kaya Hırdavat', status: 'Delivered', createdAt: new Date(2026, 2, 5, 10),
};

/** `i`. gün (0 = 1 Mart 2026), yerel SAATLİ. */
const mGun = (i: number, saat = 10): Date => new Date(2026, 2, 1 + i, saat);
/** Günün yerel başlangıcı — `KumulatifNokta.tarih` beklenen değeri. */
const gunBasi0 = (i: number): Date => new Date(2026, 2, 1 + i);

/** GB5 P13'ün ESKİ hesabı test içinde yeniden yazıldı (tutarı BİLİNEN siparişlerle; yalnız parite ölçüsü). */
const eskiP13 = (liste: readonly CiroSiparisi[]): number[] => {
  const sorted = [...liste].sort((a, b) => { const ta = zamanMs(a.createdAt) ?? 0; const tb = zamanMs(b.createdAt) ?? 0; return ta - tb; });
  let cumulative = 0;
  return sorted
    .map(o => { cumulative += Number(o.totalPrice); return cumulative; })
    .filter((_, i) => i % Math.max(1, Math.floor(sorted.length / 40)) === 0);
};
/** Günde bir sipariş, `n` gün; tutar 1.000 + 10·i (Şirin İnşaat ÇİMENTO 50KG). */
const gunlukSeri = (n: number): CiroSiparisi[] =>
  Array.from({ length: n }, (_, i) => s({ createdAt: new Date(2026, 0, 1 + i, 10), totalPrice: 1_000 + 10 * i, status: 'Delivered' }));
const sonNokta = (r: KumulatifSeyir) => r.noktalar[r.noktalar.length - 1];

describe('kumulatifSeyir — 6d eki (GenelBloklar5 P13)', () => {
  it('1 · PARİTE: günde tek bilinen sipariş, iptal / tarihsiz yok, n ≤ 40 → noktalar ve son değer eski formülle BİREBİR', () => {
    const on = Array.from({ length: 10 }, (_, i) => s({ createdAt: mGun(9 - i), totalPrice: 2_500 + 500 * i, status: 'Delivered' }));
    const r = kumulatifSeyir(on, { iptalHaric: true }, { enCokNokta: 40 });
    expect(r.noktalar.map(n => n.ekran)).toEqual(eskiP13(on));
    expect(r.noktalar).toHaveLength(10);
    expect(sonNokta(r).kumulatif).toEqual(r.toplam);
    expect(r.toplam).toEqual({ toplam: 47_500, bilinen: 10, bilinmeyen: 0 });
    expect(r.noktalar[0]).toEqual({ anahtar: '2026-03-01', tarih: gunBasi0(0), kumulatif: { toplam: 7_000, bilinen: 1, bilinmeyen: 0 }, ekran: 7_000 });
    expect(r.tarihsiz).toBe(0);
    expect(r.ilkKismi).toBeNull();
  });

  it('2 · aynı gün TEK nokta (bilinçli fark — bugün sipariş başına nokta)', () => {
    const x = [
      s({ createdAt: mGun(0, 9), totalPrice: 12_000 }),     // Şirin İnşaat
      s({ createdAt: mGun(1, 11), totalPrice: 4_000 }),     // Öz Beton
      s({ createdAt: mGun(0, 17), totalPrice: 3_400 }),     // Kaya Hırdavat — aynı gün
    ];
    const r = kumulatifSeyir(x, { iptalHaric: true });
    expect(r.noktalar.map(n => n.anahtar)).toEqual(['2026-03-01', '2026-03-02']);
    expect(r.noktalar[0].kumulatif).toEqual({ toplam: 15_400, bilinen: 2, bilinmeyen: 0 });
    expect(r.noktalar[1].ekran).toBe(19_400);
    expect(r.toplam.bilinen + r.toplam.bilinmeyen).toBe(3);
  });

  it('3 · MUTASYON AYIRT EDİCİ: tarihsiz SAYILIR — eğriye ve toplama girmez, 1970 başına dizilmez', () => {
    // Mutasyon: `?? new Date(0)` / `?? 0` → '1970-01-01' noktası ve 99.000 toplamda.
    const x = [
      s({ createdAt: mGun(4), totalPrice: 6_000 }),
      s({ createdAt: 'çöp', totalPrice: 99_000 }),
      s({ createdAt: mGun(2), totalPrice: 1_500 }),
    ];
    const r = kumulatifSeyir(x, { iptalHaric: true });
    expect(r.tarihsiz).toBe(1);
    expect(r.noktalar[0].anahtar).toBe('2026-03-03');
    expect(r.noktalar.some(n => n.anahtar.startsWith('1970-'))).toBe(false);
    expect(r.toplam).toEqual({ toplam: 7_500, bilinen: 2, bilinmeyen: 0 });
  });

  it('4 · `syncedAt` yedeği (modülün `ciroTarihi` kuralı; GB5 bugün düşürüyor)', () => {
    const r = kumulatifSeyir([s({ syncedAt: new Date(2026, 2, 5, 14), totalPrice: 8_200 })], { iptalHaric: true });
    expect(r.tarihsiz).toBe(0);
    expect(r.noktalar.map(n => n.anahtar)).toEqual(['2026-03-05']);
    expect(r.noktalar[0].tarih).toEqual(new Date(2026, 2, 5));
  });

  it('5 · MUTASYON AYIRT EDİCİ: bilinmeyen tutar ₺0 SAYILMAZ — `ilkKismi` ve yürüyen `bilinmeyen`', () => {
    // Mutasyon: `|| 0` → bilinmeyen 0, ilkKismi null.
    const x = [
      s({ createdAt: mGun(0), totalPrice: 5_000 }),
      s({ createdAt: mGun(1), totalPrice: undefined }),     // Yıldız Yapı — tutarı okunamadı
      s({ createdAt: mGun(2), totalPrice: 2_000 }),
    ];
    const r = kumulatifSeyir(x, { iptalHaric: true });
    expect(r.ilkKismi).toBe(1);
    expect(r.noktalar[0].kumulatif.bilinmeyen).toBe(0);
    expect(r.noktalar.slice(1).every(n => n.kumulatif.bilinmeyen === 1)).toBe(true);
    expect(r.toplam).toEqual({ toplam: 7_000, bilinen: 2, bilinmeyen: 1 });
    expect(r.noktalar.map(n => n.ekran)).toEqual([5_000, 5_000, 7_000]);
    const yalniz = kumulatifSeyir([s({ createdAt: mGun(0), totalPrice: 'abc' })], { iptalHaric: true });
    expect(yalniz.noktalar[0].ekran).toBeNaN();
    expect(yalniz.ilkKismi).toBe(0);
  });

  it('6 · örnekleme İLK ve SON noktayı tutar: 100 gün → 40 nokta, uç = toplam (eski filtre son indeksi 98)', () => {
    const yuz = gunlukSeri(100);
    const r = kumulatifSeyir(yuz, { iptalHaric: true }, { enCokNokta: 40 });
    expect(r.noktalar).toHaveLength(40);
    expect(r.noktalar[0].anahtar).toBe('2026-01-01');
    expect(r.noktalar[39].anahtar).toBe('2026-04-10');
    expect(sonNokta(r).kumulatif).toEqual(r.toplam);
    const anahtarlar = r.noktalar.map(n => n.anahtar);
    expect(anahtarlar.every((a, i) => i === 0 || a > anahtarlar[i - 1])).toBe(true);
    // Eski filtre: adım 2 → 50 nokta, son nokta 99. değil 98. sipariş → rozet GERÇEK toplamı göstermiyordu.
    const eski = eskiP13(yuz);
    expect(eski).toHaveLength(50);
    expect(eski[eski.length - 1]).not.toBe(r.toplam.toplam);
    expect(kumulatifSeyir(gunlukSeri(41), { iptalHaric: true }, { enCokNokta: 40 }).noktalar).toHaveLength(40);
    expect(eskiP13(gunlukSeri(41))).toHaveLength(41);
  });

  it('7 · `enCokNokta` sınırları: geçersiz → throw; m ≥ n → tüm günler; m = 1 → yalnız son gün', () => {
    const bes = gunlukSeri(5);
    for (const m of [0, 2.5, NaN, -1]) expect(() => kumulatifSeyir(bes, { iptalHaric: true }, { enCokNokta: m })).toThrow(/enCokNokta/);
    expect(kumulatifSeyir(bes, { iptalHaric: true }, { enCokNokta: 5 }).noktalar).toHaveLength(5);
    expect(kumulatifSeyir(bes, { iptalHaric: true }, { enCokNokta: 9 }).noktalar).toHaveLength(5);
    expect(kumulatifSeyir(bes, { iptalHaric: true }, {}).noktalar).toHaveLength(5);
    const tek = kumulatifSeyir(bes, { iptalHaric: true }, { enCokNokta: 1 });
    expect(tek.noktalar.map(n => n.anahtar)).toEqual(['2026-01-05']);
    expect(tek.noktalar[0].kumulatif).toEqual(tek.toplam);
  });

  it('8 · K2 + O26 + O21 + boş + mutasyon yok', () => {
    const iptalli = [s({ createdAt: mGun(0), totalPrice: 4_000, status: 'Delivered' }), s({ createdAt: mGun(1), totalPrice: 9_000, status: 'Cancelled' })];
    const haric = kumulatifSeyir(iptalli, { iptalHaric: true });
    expect(haric.noktalar).toHaveLength(1);
    expect(haric.tarihsiz).toBe(0);
    expect(haric.toplam.toplam).toBe(4_000);
    expect(kumulatifSeyir(iptalli, { iptalHaric: false }).toplam.toplam).toBe(13_000);
    // O26: başlıksız Mikro faturası siparişi — kalem toplamı OKUNMAZ (Mutasyon: kalem yedeği → 12.000).
    const mf: Order = {
      id: 'mf-1', customerName: 'Öz Beton', totalPrice: NaN, status: 'Delivered', customerType: 'B2B', source: 'mikro-fatura',
      createdAt: mGun(3), lineItems: [{ id: 'k1', sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 40, price: 250, total: 12_000, netTutar: 10_000, kdv: 2_000 }],
    };
    const r8 = kumulatifSeyir([mf], { iptalHaric: true });
    expect(r8.toplam.bilinmeyen).toBe(1);
    expect(r8.noktalar[0].ekran).toBeNaN();
    // O21: süzgeçsiz dövizli sipariş «tutarı okunamadı» sayılır (50 EUR EKLENMEDİ); çağıran reçetesiyle hiç ulaşmaz.
    const x: MagazaSiparisAlanlari[] = [{ customerName: 'Şirin İnşaat', totalPrice: 6_000, createdAt: mGun(1) }, DOVIZLI];
    const suzgecsiz = kumulatifSeyir(x, { iptalHaric: true });
    expect(suzgecsiz.toplam).toEqual({ toplam: 6_000, bilinen: 1, bilinmeyen: 1 });
    expect(kumulatifSeyir(x.filter(o => !tryDisiMi(o)), { iptalHaric: true }).toplam.bilinmeyen).toBe(0);
    expect(kumulatifSeyir([mf, DOVIZLI], { iptalHaric: true }).toplam.bilinmeyen).toBe(2);
    expect(kumulatifSeyir([], { iptalHaric: true })).toEqual({ noktalar: [], toplam: { toplam: 0, bilinen: 0, bilinmeyen: 0 }, tarihsiz: 0, ilkKismi: null });
    expect(kumulatifSeyir([], { iptalHaric: true }, { enCokNokta: 1 }).noktalar).toEqual([]);
    const donuk = Object.freeze(gunlukSeri(3).map(o => Object.freeze(o)));
    expect(kumulatifSeyir(donuk, { iptalHaric: true }).toplam.toplam).toBe(3_030);
    expect(donuk[0].totalPrice).toBe(1_000);
  });

  it('9 · `ilkKismi` ÖRNEKLENMİŞ dizinin İNDEKSİ → tarih `noktalar[ilkKismi].tarih`; DEĞİŞMEZ sayım', () => {
    // Mutasyon: `ilkKismi`yi örneklenmemiş seride hesaplamak → 2 / 3.
    const seri = (tutarsizGun: number) =>
      Array.from({ length: 5 }, (_, i) => s({ createdAt: mGun(i), totalPrice: i === tutarsizGun ? null : 1_000 * (i + 1) }));
    const u = kumulatifSeyir(seri(2), { iptalHaric: true }, { enCokNokta: 3 });
    expect(u.noktalar.map(n => n.anahtar)).toEqual(['2026-03-01', '2026-03-03', '2026-03-05']);
    expect(u.ilkKismi).toBe(1);
    expect(u.ilkKismi === null ? null : u.noktalar[u.ilkKismi].tarih).toEqual(gunBasi0(2));
    const d = kumulatifSeyir(seri(3), { iptalHaric: true }, { enCokNokta: 3 });
    expect(d.ilkKismi).toBe(2);
    expect(d.ilkKismi === null ? null : d.noktalar[d.ilkKismi].tarih).toEqual(gunBasi0(4));
    for (const r of [u, d]) expect(r.toplam.bilinen + r.toplam.bilinmeyen + r.tarihsiz).toBe(5);
  });
});
