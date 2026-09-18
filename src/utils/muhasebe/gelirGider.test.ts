/**
 * gelirGider.test.ts — AccountingModule "Gelir/Gider" sekmesi (GelirGiderTab) hesabının sözleşmesi
 * (Faz 3 2/n, 2026-09-14). ÖNCE YAZILDI.
 *
 * Sayfadaki sahte kesinlik (AccountingModule.tsx 2098-2161): `fisTutari = alacak || borc || 0`,
 * `(breakdown[k] || 0) + …`, `reduce((s, f) => s + f.matrah, 0)`, `reduce((s, e) => s + e.borc, 0)`,
 * tarihsiz fişin SESSİZCE dönem dışı kalması. Kural (CLAUDE.md): bilinmeyen tutar 0 DEĞİL bilinmiyordur —
 * toplama girmez, SAYILIR, ekranda '—' ya da "N kayıt tutarsız". Dışlamalar AYNEN korunur: tarihsiz fiş
 * hiçbir döneme girmez; Mikro ALIŞ gider değil (stok); gelir = alacak 6xx, gider = borç 6xx/7xx/8xx.
 */
import { describe, it, expect } from 'vitest';
import {
  fisTutari, gelirFisiMi, giderFisiMi, gelirGiderOzeti, grafikTavani, cubukYuzdesi, MIKRO_SATIS_HESABI,
  type GgFis, type GgMikroFatura,
} from './gelirGider';
import { ekranTutari, tamTutar } from '../para';

const SATIS = '600 - Yurt İçi Satışlar';
const GYG = '770 - Genel Yönetim Giderleri';
const PAZARLAMA = '760 - Pazarlama Satış ve Dağıtım Giderleri';
const KASA = '100 - Kasa';
const BANKA = '102 - Bankalar';
const ALICILAR = '120 - Alıcılar';
const STOK = '153 - Ticari Mallar';
const SATICILAR = '320 - Satıcılar';

// Ağustos 2026 — Şirin İnşaat'a çimento satışı, Çelik Yapı'dan demir alışı, kira, tek taraflı banka aktarımı
const sirinSatis: GgFis    = { date: '2026-08-03', debitHesap: ALICILAR, alacakHesap: SATIS, borc: 12000, alacak: 12000 };     // gelir ₺12.000
const kira: GgFis          = { date: '2026-08-10', debitHesap: GYG, alacakHesap: KASA, borc: 3500, alacak: 3500 };             // gider ₺3.500
const bankaAktarimi: GgFis = { date: '2026-08-12', debitHesap: BANKA, alacakHesap: SATIS, borc: 4000, alacak: 0 };             // C2: tek taraflı import → `||` ile ₺4.000
const tutarsizSatis: GgFis = { date: '2026-08-15', debitHesap: ALICILAR, alacakHesap: SATIS, borc: null, alacak: null };       // gelir bilinmiyor (DB null)
const tutarsizGider: GgFis = { date: '2026-08-18', debitHesap: PAZARLAMA, alacakHesap: KASA, borc: undefined, alacak: 900 };  // gider yalnız BORÇTAN okunur → bilinmiyor
const tarihsizSatis: GgFis = { date: '', debitHesap: ALICILAR, alacakHesap: SATIS, borc: 999, alacak: 999 };                  // dönem dışı, SAYILIR
const tarihsizStok: GgFis  = { debitHesap: STOK, alacakHesap: SATICILAR, borc: 500, alacak: 500 };                            // ne gelir ne gider → tarihsiz sayımına girmez
const celikAlis: GgFis     = { date: '2026-08-20', debitHesap: STOK, alacakHesap: SATICILAR, borc: 8000, alacak: 8000 };      // Çelik Yapı'dan alış: stok, gider DEĞİL
const temmuzSatis: GgFis   = { date: '2026-07-28', debitHesap: ALICILAR, alacakHesap: SATIS, borc: 5000, alacak: 5000 };
const temmuzKira: GgFis    = { date: '2026-07-05', debitHesap: GYG, alacakHesap: KASA, borc: 1000, alacak: 1000 };

const fisler: GgFis[] = [sirinSatis, kira, bankaAktarimi, tutarsizSatis, tutarsizGider, tarihsizSatis, tarihsizStok, celikAlis, temmuzSatis, temmuzKira];

const mikroSatis: GgMikroFatura    = { yon: 'giden', tarih: '2026-08-05', matrah: 20000 };  // Mikro satış faturası → gelir (matrah)
const mikroAlis: GgMikroFatura     = { yon: 'gelen', tarih: '2026-08-06', matrah: 7000 };   // Mikro alış → stok, gider DEĞİL
const mikroTemmuz: GgMikroFatura   = { yon: 'giden', tarih: '2026-07-30', matrah: 6000 };
const mikroTutarsiz: GgMikroFatura = { yon: 'giden', tarih: '2026-08-21', matrah: null };   // matrahı bilinmeyen → SAYILIR
const mikroTarihsiz: GgMikroFatura = { yon: 'giden', tarih: '', matrah: 1500 };             // tarihsiz → dönem dışı, SAYILIR
const mikroAlisTarihsiz: GgMikroFatura = { yon: 'gelen', tarih: null, matrah: 100 };        // alış zaten dışarıda → tarihsiz sayımına girmez
const mikro: GgMikroFatura[] = [mikroSatis, mikroAlis, mikroTemmuz, mikroTutarsiz, mikroTarihsiz, mikroAlisTarihsiz];

const AGUSTOS = { yil: 2026, ay: 8 };
const SIFIR = { toplam: 0, bilinen: 0, bilinmeyen: 0 };

describe('fisTutari — `alacak || borc` (2026-08-22 C2 kuralı korunur); ikisi de bilinmiyorsa NaN', () => {
  it('dengeli fişte alacak (borç = alacak, sonuç değişmez)', () => {
    expect(fisTutari(sirinSatis)).toBe(12000);
  });
  it('C2: tek taraflı eski banka import fişi (alacak 0, borç X) → X (`??` olsaydı 0 basardı)', () => {
    expect(fisTutari(bankaAktarimi)).toBe(4000);
    expect(fisTutari({ alacak: 4000, borc: 0 })).toBe(4000);
  });
  it('bir taraf bilinmiyorsa bilinen SIFIR-DIŞI taraf', () => {
    expect(fisTutari({ alacak: null, borc: 300 })).toBe(300);
    expect(fisTutari({ alacak: 500, borc: undefined })).toBe(500);
  });
  it('iki taraf da bilinen sıfırsa GERÇEK 0', () => {
    expect(fisTutari({ alacak: 0, borc: 0 })).toBe(0);
  });
  it('iki taraf da bilinmiyorsa NaN — eskiden `|| 0` ile 0 sayılıp toplam eksik çıkıyordu', () => {
    for (const [a, b] of [[null, null], [undefined, undefined], ['abc', 'x'], [NaN, NaN], ['', ''], [Infinity, null]] as const) {
      expect(fisTutari({ alacak: a, borc: b })).toBeNaN();
    }
  });
  it('alacak bilinen 0, borç bilinmiyor → NaN (bilinçli fark: eski `|| 0` bunu 0 sayıyordu; tutar borçta olabilirdi)', () => {
    expect(fisTutari({ alacak: 0, borc: null })).toBeNaN();
    expect(fisTutari({ alacak: undefined, borc: 0 })).toBeNaN();
  });
  it("sayısal string kabul — eski `||` '1500' string'ini reduce'a sokup toplamı metne çeviriyordu", () => {
    expect(fisTutari({ alacak: '1500', borc: null })).toBe(1500);
    expect(fisTutari({ alacak: '0', borc: '250' })).toBe(250);
  });
});

describe('hesap kuralı AYNEN — gelir: alacak 6xx; gider: borç 6xx / 7xx / 8xx', () => {
  it('gelir fişi = alacak hesabı 6 ile başlar', () => {
    expect(gelirFisiMi(sirinSatis)).toBe(true);
    expect(gelirFisiMi(bankaAktarimi)).toBe(true);
    expect(gelirFisiMi(celikAlis)).toBe(false);
    expect(gelirFisiMi(kira)).toBe(false);
  });
  it('gider fişi = borç hesabı 6/7/8 ile başlar; 1/2/3/5 değil', () => {
    for (const h of ['621 - Satılan Ticari Mallar Maliyeti', '770 - Genel Yönetim Giderleri', '800 - Dönem Kârı']) {
      expect(giderFisiMi({ debitHesap: h })).toBe(true);
    }
    for (const h of ['100 - Kasa', '120 - Alıcılar', '320 - Satıcılar', '153 - Ticari Mallar', '500 - Sermaye']) {
      expect(giderFisiMi({ debitHesap: h })).toBe(false);
    }
  });
  it('hesap kodu yoksa ne gelir ne gider (eski kod `.startsWith` ile çökerdi)', () => {
    expect(gelirFisiMi({})).toBe(false);
    expect(giderFisiMi({})).toBe(false);
    expect(gelirFisiMi({ alacakHesap: undefined })).toBe(false);
  });
});

describe('gelirGiderOzeti — ay modu (Ağustos 2026)', () => {
  const o = gelirGiderOzeti(fisler, mikro, AGUSTOS);

  it('gelir = native 6xx fişleri (fisTutari) + Mikro giden matrahı; bilinmeyenler toplama GİRMEZ, SAYILIR', () => {
    expect(o.gelir).toEqual({ toplam: 12000 + 4000 + 20000, bilinen: 3, bilinmeyen: 2 }); // tutarsizSatis + mikroTutarsiz
  });
  it('gider = yalnız borç (6/7/8xx); borcu bilinmeyen fiş SAYILIR (eski `s + e.borc` tüm toplamı NaN yapıyordu)', () => {
    expect(o.gider).toEqual({ toplam: 3500, bilinen: 1, bilinmeyen: 1 }); // tutarsizGider
  });
  it('Mikro ALIŞ (gelen) gidere GİRMEZ — alış stok (153), gider ancak COGS anında; Cetpa stok fişi de girmez', () => {
    expect(Object.keys(o.giderKirilimi)).not.toContain(STOK);
    expect(o.gider.toplam).toBe(3500);
  });
  it('net = tamTutar(gelir) − tamTutar(gider): bir kayıt bile bilinmiyorsa NaN (kısmi rakamlardan kâr uydurulmaz)', () => {
    expect(o.net).toBeNaN();
  });
  it('tarihsiz kayıt SESSİZCE düşmez, SAYILIR: gelir/gider fişi + Mikro giden; ilgisiz hesap ve Mikro alış sayılmaz', () => {
    expect(o.tarihsiz).toBe(2); // tarihsizSatis + mikroTarihsiz (tarihsizStok ve mikroAlisTarihsiz değil)
  });
  it("gelir kırılımı: Mikro satışı '600 - Yurt İçi Satışlar (Mikro)' anahtarıyla ÖNCE, sonra hesap bazında Tutar", () => {
    expect(Object.keys(o.gelirKirilimi)).toEqual([MIKRO_SATIS_HESABI, SATIS]);
    expect(o.gelirKirilimi[MIKRO_SATIS_HESABI]).toEqual({ toplam: 20000, bilinen: 1, bilinmeyen: 1 });
    expect(o.gelirKirilimi[SATIS]).toEqual({ toplam: 16000, bilinen: 2, bilinmeyen: 1 });
  });
  it('gider kırılımı hesap bazında; bilinmeyen borçlu hesap 0 değil, sayaçla görünür', () => {
    expect(o.giderKirilimi).toEqual({
      [GYG]: { toplam: 3500, bilinen: 1, bilinmeyen: 0 },
      [PAZARLAMA]: { toplam: 0, bilinen: 0, bilinmeyen: 1 },
    });
    expect(ekranTutari(o.giderKirilimi[PAZARLAMA])).toBeNaN(); // satırda '—'
  });
  it('ekran sözleşmesi: kısmi bilinmeyen → KISMİ toplam (sayfa "2 kayıt tutarsız" notu koyar)', () => {
    expect(ekranTutari(o.gelir)).toBe(36000);
    expect(ekranTutari(o.gider)).toBe(3500);
  });
});

describe('sayfa paritesi — tutarı bilinen girdide eski formülle AYNI sayı', () => {
  const temizFisler = [sirinSatis, kira, bankaAktarimi, celikAlis, temmuzSatis, temmuzKira];
  const temizMikro = [mikroSatis, mikroAlis, mikroTemmuz];
  // AccountingModule 2107-2137'nin birebir eski formülü (bilinen girdide oracle)
  const agustosta = (t: string) => t.slice(0, 7) === '2026-08';
  const eskiGelirFisleri = temizFisler.filter(e => agustosta(String(e.date)) && String(e.alacakHesap).startsWith('6'));
  const eskiGiderFisleri = temizFisler.filter(e => agustosta(String(e.date)) && /^[678]/.test(String(e.debitHesap)));
  const eskiToplamGelir = eskiGelirFisleri.reduce((s, e) => s + (Number(e.alacak) || Number(e.borc) || 0), 0)
    + temizMikro.filter(f => f.yon === 'giden' && agustosta(String(f.tarih))).reduce((s, f) => s + Number(f.matrah), 0);
  const eskiToplamGider = eskiGiderFisleri.reduce((s, e) => s + Number(e.borc), 0);

  const o = gelirGiderOzeti(temizFisler, temizMikro, AGUSTOS);
  it('toplam gelir / gider / net eski kodla aynı', () => {
    expect(eskiToplamGelir).toBe(36000); // fikstür sağlaması
    expect(tamTutar(o.gelir)).toBe(eskiToplamGelir);
    expect(tamTutar(o.gider)).toBe(eskiToplamGider);
    expect(o.net).toBe(eskiToplamGelir - eskiToplamGider);
    expect(o.net).toBe(32500);
  });
  it('tam bilinen dönemde ekran ve türetme değeri aynı; sayaçlar sıfır', () => {
    expect(ekranTutari(o.gelir)).toBe(tamTutar(o.gelir));
    expect(o.gelir.bilinmeyen).toBe(0);
    expect(o.gider.bilinmeyen).toBe(0);
    expect(o.tarihsiz).toBe(0);
  });
  it('kırılım tutarları eski `Record<string, number>` ile aynı', () => {
    expect(tamTutar(o.gelirKirilimi[MIKRO_SATIS_HESABI])).toBe(20000);
    expect(tamTutar(o.gelirKirilimi[SATIS])).toBe(16000);
    expect(tamTutar(o.giderKirilimi[GYG])).toBe(3500);
  });
});

describe('boş dönem GERÇEK 0 (hareketsiz ay); hiç bilinen yokken "—"', () => {
  it('kayıt yoksa gelir/gider/net 0, kırılım boş, 12 ay sıfır', () => {
    const o = gelirGiderOzeti([], [], AGUSTOS);
    expect(o.gelir).toEqual(SIFIR);
    expect(o.gider).toEqual(SIFIR);
    expect(o.net).toBe(0);
    expect(ekranTutari(o.gelir)).toBe(0);
    expect(o.gelirKirilimi).toEqual({});
    expect(o.giderKirilimi).toEqual({});
    expect(o.tarihsiz).toBe(0);
    expect(o.aylik).toHaveLength(12);
    for (const a of o.aylik) { expect(a.gelir).toEqual(SIFIR); expect(a.gider).toEqual(SIFIR); }
  });
  it('dönemde yalnız tutarsız kayıt varsa gelir {0,0,1}: ekranda "—", net NaN (eski kod ₺0 gelir basıyordu)', () => {
    const o = gelirGiderOzeti([tutarsizSatis], [], AGUSTOS);
    expect(o.gelir).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(ekranTutari(o.gelir)).toBeNaN();
    expect(tamTutar(o.gelir)).toBeNaN();
    expect(o.net).toBeNaN();
    expect(o.gelirKirilimi).toEqual({ [SATIS]: { toplam: 0, bilinen: 0, bilinmeyen: 1 } });
  });
});

describe('tarih aralığı modu (gelirUseRange) — sınırlar dahil; grafik aralıktan bağımsız', () => {
  it('1 Tem – 31 Ağu: iki ayın toplamı; bilinmeyenler yine sayılır', () => {
    const o = gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: '2026-07-01', to: '2026-08-31' } });
    expect(o.gelir).toEqual({ toplam: 36000 + 5000 + 6000, bilinen: 5, bilinmeyen: 2 });
    expect(o.gider).toEqual({ toplam: 3500 + 1000, bilinen: 2, bilinmeyen: 1 });
  });
  it('tek günlük aralık: yalnız o günün fişi (from = to dahil)', () => {
    const o = gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: '2026-08-03', to: '2026-08-03' } });
    expect(o.gelir).toEqual({ toplam: 12000, bilinen: 1, bilinmeyen: 0 });
  });
  it('from ya da to boşsa AY MODU (eski `gelirUseRange && from && to` koşulu)', () => {
    const ay = gelirGiderOzeti(fisler, mikro, AGUSTOS);
    expect(gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: '2026-07-01', to: '' } }).gelir).toEqual(ay.gelir);
    expect(gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: '', to: '2026-08-31' } }).gelir).toEqual(ay.gelir);
    expect(gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: null }).gelir).toEqual(ay.gelir);
  });
  it('saatli tarih son günde DAHİL (bilinçli fark: eski string karşılaştırması "…T12:00" <= "2026-08-31"ı düşürüyordu)', () => {
    const saatli: GgFis = { date: '2026-08-31T12:00:00', debitHesap: ALICILAR, alacakHesap: SATIS, borc: 700, alacak: 700 };
    const o = gelirGiderOzeti([saatli], [], { ...AGUSTOS, aralik: { from: '2026-08-01', to: '2026-08-31' } });
    expect(o.gelir.toplam).toBe(700);
  });
  it('çözülemeyen sınır hiçbir kaydı eşleştirmez (bugüne düşmez)', () => {
    const o = gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: 'dün', to: 'bugün' } });
    expect(o.gelir).toEqual(SIFIR);
  });
  it('aylık grafik aralıktan bağımsız: seçili yılın 12 ayı', () => {
    const ay = gelirGiderOzeti(fisler, mikro, AGUSTOS);
    const aralik = gelirGiderOzeti(fisler, mikro, { ...AGUSTOS, aralik: { from: '2026-08-03', to: '2026-08-03' } });
    expect(aralik.aylik).toEqual(ay.aylik);
  });
});

describe('aylik — seçili yılın 12 ayı, her ay { ay, gelir: Tutar, gider: Tutar }', () => {
  const o = gelirGiderOzeti(fisler, mikro, AGUSTOS);
  it('12 kayıt, ay 1..12', () => {
    expect(o.aylik.map(a => a.ay)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('Temmuz: native 5.000 + Mikro 6.000; gider 1.000', () => {
    expect(o.aylik[6]).toEqual({ ay: 7, gelir: { toplam: 11000, bilinen: 2, bilinmeyen: 0 }, gider: { toplam: 1000, bilinen: 1, bilinmeyen: 0 } });
  });
  it('Ağustos: KPI ile aynı sayılar ve sayaçlar', () => {
    expect(o.aylik[7]).toEqual({ ay: 8, gelir: o.gelir, gider: o.gider });
  });
  it('hareketsiz aylar gerçek 0', () => {
    for (const i of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]) expect(o.aylik[i]).toEqual({ ay: i + 1, gelir: SIFIR, gider: SIFIR });
  });
  it('yıl değişince o yılın verisi (2025 boş)', () => {
    const y = gelirGiderOzeti(fisler, mikro, { yil: 2025, ay: 8 });
    expect(y.gelir).toEqual(SIFIR);
    for (const a of y.aylik) expect(a.gelir).toEqual(SIFIR);
  });
  it('tarih her biçimde çözülür: GG.AA.YYYY, Date, {_seconds}', () => {
    const agu = new Date(2026, 7, 9);
    const f: GgFis[] = [
      { date: '09.08.2026', debitHesap: ALICILAR, alacakHesap: SATIS, borc: 1, alacak: 1 },
      { date: agu, debitHesap: ALICILAR, alacakHesap: SATIS, borc: 2, alacak: 2 },
      { date: { _seconds: agu.getTime() / 1000 }, debitHesap: ALICILAR, alacakHesap: SATIS, borc: 4, alacak: 4 },
    ];
    expect(gelirGiderOzeti(f, [], AGUSTOS).gelir).toEqual({ toplam: 7, bilinen: 3, bilinmeyen: 0 });
  });
});

describe("Mikro kırılım anahtarı '600 - Yurt İçi Satışlar (Mikro)'", () => {
  it('Mikro giden faturası yoksa anahtar YOK (eski `mikroGelirTutar > 0` kuralı)', () => {
    expect(Object.keys(gelirGiderOzeti([sirinSatis], [mikroAlis], AGUSTOS).gelirKirilimi)).toEqual([SATIS]);
  });
  it('Mikro matrahı bilinen 0 ise anahtar yok (eski kuralla aynı)', () => {
    expect(gelirGiderOzeti([], [{ yon: 'giden', tarih: '2026-08-05', matrah: 0 }], AGUSTOS).gelirKirilimi).toEqual({});
  });
  it('yalnız matrahı bilinmeyen Mikro faturası varsa anahtar VAR, {0,0,1} — satır "—" + not (eskiden satır hiç görünmüyordu)', () => {
    const o = gelirGiderOzeti([], [mikroTutarsiz], AGUSTOS);
    expect(o.gelirKirilimi).toEqual({ [MIKRO_SATIS_HESABI]: { toplam: 0, bilinen: 0, bilinmeyen: 1 } });
    expect(ekranTutari(o.gelir)).toBeNaN();
  });
});

describe('grafikTavani — çubuk ölçeği: bilinen ayların en büyüğü, taban 1; bilinmeyen ay ölçeği bozmaz', () => {
  it('tüm aylar bilinen → max(gelir, gider)', () => {
    const o = gelirGiderOzeti([sirinSatis, kira, temmuzSatis, temmuzKira], [mikroSatis, mikroTemmuz], AGUSTOS);
    expect(grafikTavani(o.aylik)).toBe(32000); // Ağustos gelir 12.000 + 20.000
  });
  it('boş yıl → 1 (eski `Math.max(…, 1)` tabanı: sıfıra bölme yok)', () => {
    expect(grafikTavani(gelirGiderOzeti([], [], AGUSTOS).aylik)).toBe(1);
  });
  it('hiç bilineni olmayan ay (ekranda "—") NaN üretmez, diğer aylar ölçeklenir', () => {
    const o = gelirGiderOzeti([temmuzSatis, tutarsizSatis], [], AGUSTOS); // Ağustos gelir {0,0,1} → ekranTutari NaN
    expect(ekranTutari(o.aylik[7].gelir)).toBeNaN();
    expect(grafikTavani(o.aylik)).toBe(5000);
  });
});

describe('cubukYuzdesi — çubuk yüksekliği; tutarı BİLİNMEYEN ay hareketsiz aydan ayrılır', () => {
  const tavan = (o: ReturnType<typeof gelirGiderOzeti>) => grafikTavani(o.aylik);

  it('bilinen ay → (deger / tavan) × 100 (eski satır içi formülle BİREBİR)', () => {
    expect(cubukYuzdesi(5000, 20000)).toBe(25);
    expect(cubukYuzdesi(20000, 20000)).toBe(100);
  });

  it('HAREKETSİZ ay gerçek 0 → 0 (çubuk yok, ama "bilinmiyor" da değil)', () => {
    const o = gelirGiderOzeti([temmuzSatis], [], AGUSTOS);   // Ağustos boş
    expect(o.aylik[7].gelir).toEqual(SIFIR);
    expect(cubukYuzdesi(ekranTutari(o.aylik[7].gelir), tavan(o))).toBe(0);
  });

  it('tutarı hiç bilinmeyen ay → null (eski kod `height: "NaN%"` + minHeight 0 ile BOŞ çiziyordu)', () => {
    const o = gelirGiderOzeti([temmuzSatis, tutarsizSatis], [], AGUSTOS);
    const agustos = ekranTutari(o.aylik[7].gelir);
    expect(agustos).toBeNaN();
    // MUTASYON AYIRT EDİCİ: `|| 0` ya da eski formül geri gelirse burası 0 döner ve test kırılır.
    expect(cubukYuzdesi(agustos, tavan(o))).toBeNull();
    expect(cubukYuzdesi(agustos, tavan(o))).not.toBe(0);
  });

  it('kısmi bilinen ay çizilir (ekran sözleşmesi: kısmi toplam + sayfa notu)', () => {
    const o = gelirGiderOzeti([temmuzSatis, sirinSatis, tutarsizSatis], [], AGUSTOS);
    expect(o.aylik[7].gelir).toEqual({ toplam: 12000, bilinen: 1, bilinmeyen: 1 });
    expect(cubukYuzdesi(ekranTutari(o.aylik[7].gelir), tavan(o))).toBe(100); // tavan 12.000
  });

  it('tavan bilinmiyor / ≤ 0 → null (sıfıra bölme yok; grafikTavani zaten ≥ 1 verir)', () => {
    expect(cubukYuzdesi(100, 0)).toBeNull();
    expect(cubukYuzdesi(100, NaN)).toBeNull();
  });
});
