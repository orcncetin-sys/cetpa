/**
 * mizan.test.ts — AccountingModule Mizan + Yevmiye hesap sözleşmesi. ÖNCE YAZILDI (Faz 3 2/n, 2026-09-14).
 *
 * Sahte-kesinlik siteleri (AccountingModule.tsx, 2026-09-14 ölçümü):
 *   1673-1681 mikroMizanSatirlari   `if (f.matrah)` / `if (f.kdv)` — bilinmeyen matrah/KDV sessizce satır üretmiyordu, SAYILMIYORDU
 *   1683-1694 mizanMap/mizanRows     `+= e.borc` — DB'den null gelen borç/alacak 0 gibi toplanıyordu
 *   1697      mizan sıralama         `(a[key] || 0) - (b[key] || 0)` — bilinmeyen ₺0 gibi ortaya diziliyordu
 *   1701-1705 mizanTotals/dengeli    bilinmeyen içeren mizana "Dengeli" rozeti veriliyordu
 *   1143-1144 saveJournal            `Number(x) || 0` — boş/geçersiz tutar 0 sayılıp "sıfırdan büyük olmalı" ile karışıyordu
 *   1191      openEditJournal        `kdvOran ?? 0` — bilinmeyen oran forma %0 olarak dolduruluyordu
 *   YevmiyeTab 74/201                CSV `kdvOran ?? 0`, ekran `%{kdvOran ?? 0}` — bilinmeyen oran "%0" basılıyordu
 * Kural (CLAUDE.md): bilinmeyen tutar toplama girmez, SAYILIR; ekran `ekranTutari` ile '—' + "N kayıt tutarsız" notu;
 * türetilen sayı (bakiye) bir girdi bile bilinmiyorsa NaN (`tamTutar`); denge bilinmiyorsa null — rozet verilmez.
 */
import { describe, it, expect } from 'vitest';
import { ekranTutari } from '../para';
import { mikroMizanSatirlari, mizanHesapla, fisTutariOku, fisDogrula, kdvOranYaz, MIKRO_HESAP } from './mizan';

// ── Sayfa paritesi referansı: AccountingModule.tsx 1673-1705 (2026-09-14 anlık görüntüsü), yalnız BİLİNEN girdi için ──
type EskiSatir = { debitHesap: string; alacakHesap: string; borc: number; alacak: number };
function eskiMizan(girdiler: EskiSatir[]) {
  const mizanMap: Record<string, { borc: number; alacak: number }> = {};
  girdiler.forEach(e => {
    if (!mizanMap[e.debitHesap]) mizanMap[e.debitHesap] = { borc: 0, alacak: 0 };
    if (!mizanMap[e.alacakHesap]) mizanMap[e.alacakHesap] = { borc: 0, alacak: 0 };
    mizanMap[e.debitHesap].borc += e.borc;
    mizanMap[e.alacakHesap].alacak += e.alacak;
  });
  const rows = Object.entries(mizanMap).map(([hesap, v]) => ({
    hesap, borc: v.borc, alacak: v.alacak,
    borcBakiye: Math.max(0, v.borc - v.alacak), alacakBakiye: Math.max(0, v.alacak - v.borc),
  }));
  const totals = rows.reduce((acc, r) => ({
    borc: acc.borc + r.borc, alacak: acc.alacak + r.alacak,
    borcBakiye: acc.borcBakiye + r.borcBakiye, alacakBakiye: acc.alacakBakiye + r.alacakBakiye,
  }), { borc: 0, alacak: 0, borcBakiye: 0, alacakBakiye: 0 });
  return { rows, totals, dengeli: Math.abs(totals.borc - totals.alacak) < 0.01 };
}
function eskiMikroSatirlari(faturalar: { yon: 'gelen' | 'giden'; matrah: number; kdv: number }[]): EskiSatir[] {
  const out: EskiSatir[] = [];
  faturalar.forEach(f => {
    if (f.yon === 'giden') {
      if (f.matrah) out.push({ debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: f.matrah, alacak: f.matrah });
      if (f.kdv)    out.push({ debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: f.kdv, alacak: f.kdv });
    } else {
      if (f.matrah) out.push({ debitHesap: '153 - Ticari Mallar', alacakHesap: '320 - Satıcılar', borc: f.matrah, alacak: f.matrah });
      if (f.kdv)    out.push({ debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: f.kdv, alacak: f.kdv });
    }
  });
  return out;
}

const KASA = '100 - Kasa';

describe('mikroMizanSatirlari — Mikro faturasından çift taraflı satır sentezi', () => {
  it('giden (satış) fatura: 120-Alıcılar borç ↔ 600-Satışlar (matrah) + 391-Hesaplanan KDV (kdv) — hesap adları birebir', () => {
    const r = mikroMizanSatirlari([{ yon: 'giden', matrah: 10000, kdv: 2000 }]);
    expect(r.bilinmeyen).toBe(0);
    expect(r.satirlar).toEqual([
      { debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: 10000, alacak: 10000 },
      { debitHesap: '120 - Alıcılar', alacakHesap: '391 - Hesaplanan KDV', borc: 2000, alacak: 2000 },
    ]);
  });
  it('gelen (alış) fatura: 153-Ticari Mallar (matrah) + 191-İndirilecek KDV (kdv) ↔ 320-Satıcılar — stok, gider DEĞİL', () => {
    const r = mikroMizanSatirlari([{ yon: 'gelen', matrah: 5000, kdv: 1000 }]);
    expect(r.satirlar).toEqual([
      { debitHesap: '153 - Ticari Mallar', alacakHesap: '320 - Satıcılar', borc: 5000, alacak: 5000 },
      { debitHesap: '191 - İndirilecek KDV', alacakHesap: '320 - Satıcılar', borc: 1000, alacak: 1000 },
    ]);
    expect(r.satirlar[0].debitHesap).toBe(MIKRO_HESAP.ticariMallar);
  });
  it('KDV 0 (istisna) → yalnız matrah satırı; bilinen sıfır SAYILMAZ (eski truthy süzgeçle parite)', () => {
    const r = mikroMizanSatirlari([{ yon: 'giden', matrah: 3000, kdv: 0 }]);
    expect(r.satirlar).toHaveLength(1);
    expect(r.satirlar[0].alacakHesap).toBe('600 - Yurt İçi Satışlar');
    expect(r.bilinmeyen).toBe(0);
  });
  it('matrah 0 ve KDV 0 → satır yok, bilinmeyen 0', () => {
    expect(mikroMizanSatirlari([{ yon: 'gelen', matrah: 0, kdv: 0 }])).toEqual({ satirlar: [], bilinmeyen: 0 });
  });
  it("matrah bilinmiyor (null/NaN/'abc') → satır ÜRETMEZ ama SAYILIR (eski `if (f.matrah)` sessizce düşürüyordu)", () => {
    const r = mikroMizanSatirlari([
      { yon: 'giden', matrah: null, kdv: 200 },
      { yon: 'gelen', matrah: NaN, kdv: 100 },
      { yon: 'giden', matrah: 'abc', kdv: 50 },
    ]);
    expect(r.satirlar).toEqual([]);
    expect(r.bilinmeyen).toBe(3);
  });
  it('matrah bilinen ama KDV bilinmiyor → fatura BÜTÜNÜYLE dışarıda (yarım fiş 120-Alıcılar\'ı eksik gösterirdi), 1 sayılır', () => {
    const r = mikroMizanSatirlari([{ yon: 'giden', matrah: 8000, kdv: undefined }]);
    expect(r.satirlar).toEqual([]);
    expect(r.bilinmeyen).toBe(1);
  });
  it('sayısal string kabul; negatif matrah (iade) satır üretir (parite)', () => {
    const r = mikroMizanSatirlari([{ yon: 'giden', matrah: '1500.50', kdv: '300.10' }, { yon: 'giden', matrah: -400, kdv: -80 }]);
    expect(r.satirlar.map(s => s.borc)).toEqual([1500.5, 300.1, -400, -80]);
    expect(r.bilinmeyen).toBe(0);
  });
  it('boş liste → satır yok, bilinmeyen 0', () => {
    expect(mikroMizanSatirlari([])).toEqual({ satirlar: [], bilinmeyen: 0 });
  });
  it('SAYFA PARİTESİ: bilinen girdide eski sentezle birebir aynı satırlar', () => {
    const faturalar = [
      { yon: 'giden' as const, matrah: 12000, kdv: 2400 },
      { yon: 'gelen' as const, matrah: 7000, kdv: 0 },
      { yon: 'gelen' as const, matrah: 0, kdv: 150 },
    ];
    expect(mikroMizanSatirlari(faturalar).satirlar).toEqual(eskiMikroSatirlari(faturalar));
  });
});

describe('mizanHesapla — hesap bazında borç/alacak toplamı, bakiye, denge', () => {
  const YEVMIYE = [
    { debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: 1000, alacak: 1000, aciklama: 'Şirin İnşaat satış' },
    { debitHesap: '153 - Ticari Mallar', alacakHesap: '320 - Satıcılar', borc: 500, alacak: 500, aciklama: 'Çelik Yapı alış' },
    { debitHesap: KASA, alacakHesap: '120 - Alıcılar', borc: 300, alacak: 300, aciklama: 'Şirin İnşaat tahsilat ₺300' },
  ];

  it('satırlar ilk görülme sırasında; borç/alacak Tutar; bakiye = max(0, fark)', () => {
    const m = mizanHesapla(YEVMIYE, []);
    expect(m.satirlar.map(r => r.hesap)).toEqual(['120 - Alıcılar', '600 - Yurt İçi Satışlar', '153 - Ticari Mallar', '320 - Satıcılar', KASA]);
    const alicilar = m.satirlar[0];
    expect(alicilar.borc).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 0 });
    expect(alicilar.alacak).toEqual({ toplam: 300, bilinen: 1, bilinmeyen: 0 });
    expect(alicilar.borcBakiye).toBe(700);
    expect(alicilar.alacakBakiye).toBe(0);
    const satislar = m.satirlar[1];
    expect(satislar.borc).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(satislar.alacakBakiye).toBe(1000);
  });
  it('toplam satırı ve denge (kuruş toleransı 0.01)', () => {
    const m = mizanHesapla(YEVMIYE, []);
    expect(m.toplam.borc).toEqual({ toplam: 1800, bilinen: 3, bilinmeyen: 0 });
    expect(m.toplam.alacak).toEqual({ toplam: 1800, bilinen: 3, bilinmeyen: 0 });
    expect(m.toplam.borcBakiye).toEqual({ toplam: 1500, bilinen: 5, bilinmeyen: 0 });
    expect(m.toplam.alacakBakiye).toEqual({ toplam: 1500, bilinen: 5, bilinmeyen: 0 });
    expect(m.dengeli).toBe(true);
    expect(m.bilinmeyen).toBe(0);
  });
  it('gerçek dengesizlik → dengeli false; 0.01 toleransı korunur', () => {
    expect(mizanHesapla([{ debitHesap: KASA, alacakHesap: '600 - Yurt İçi Satışlar', borc: 1000, alacak: 900 }], []).dengeli).toBe(false);
    expect(mizanHesapla([{ debitHesap: KASA, alacakHesap: '600 - Yurt İçi Satışlar', borc: 1000, alacak: 1000.005 }], []).dengeli).toBe(true);
    expect(mizanHesapla([{ debitHesap: KASA, alacakHesap: '600 - Yurt İçi Satışlar', borc: 1000, alacak: 1000.02 }], []).dengeli).toBe(false);
  });
  it('Mikro sentez satırları yevmiyeyle aynı havuzda toplanır', () => {
    const mikro = mikroMizanSatirlari([{ yon: 'giden', matrah: 2000, kdv: 400 }]).satirlar;
    const m = mizanHesapla(YEVMIYE, mikro);
    const alicilar = m.satirlar.find(r => r.hesap === '120 - Alıcılar')!;
    expect(alicilar.borc).toEqual({ toplam: 3400, bilinen: 3, bilinmeyen: 0 });
    expect(m.satirlar.map(r => r.hesap)).toContain('391 - Hesaplanan KDV');
    expect(m.dengeli).toBe(true);
  });
  it('boş girdi → satır yok, toplamlar sıfır Tutar, dengeli true (hareketsiz dönem), bilinmeyen 0', () => {
    const m = mizanHesapla([], []);
    expect(m.satirlar).toEqual([]);
    expect(m.toplam.borc).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(m.dengeli).toBe(true);
    expect(m.bilinmeyen).toBe(0);
  });
  it('sayısal string borç/alacak kabul edilir', () => {
    const m = mizanHesapla([{ debitHesap: KASA, alacakHesap: '600 - Yurt İçi Satışlar', borc: '250.50', alacak: '250.50' }], []);
    expect(m.toplam.borc.toplam).toBe(250.5);
    expect(m.dengeli).toBe(true);
  });

  describe('bilinmeyen 0 SAYILMAZ (mutasyon ayırt edici)', () => {
    it('borcu null kayıt: hesabın borcu bilinmiyor (ekran "—"), bakiye türetilmez, dengeli null, 1 sayılır', () => {
      const m = mizanHesapla([{ debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: null, alacak: 1000 }], []);
      const alicilar = m.satirlar[0];
      expect(alicilar.borc).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
      expect(ekranTutari(alicilar.borc)).toBeNaN();               // `|| 0` geri gelirse 0 olur → kırılır
      expect(alicilar.borcBakiye).toBeNaN();
      expect(alicilar.alacakBakiye).toBeNaN();
      expect(m.toplam.borc).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
      expect(m.toplam.borcBakiye).toEqual({ toplam: 0, bilinen: 1, bilinmeyen: 1 }); // 600'ün borç bakiyesi 0 BİLİNİR, 120'ninki bilinmez
      expect(m.dengeli).toBeNull();                                // `|| 0` ile false olurdu (0 ≠ 1000)
      expect(m.bilinmeyen).toBe(1);
    });
    it('kısmi bilinmeyen: hesabın borcu KISMİ toplam (ekran 1000 + not), bakiye yine NaN (türetme kapısı)', () => {
      const m = mizanHesapla([
        { debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: 1000, alacak: 1000 },
        { debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: 'abc', alacak: 500 },
      ], []);
      const alicilar = m.satirlar[0];
      expect(alicilar.borc).toEqual({ toplam: 1000, bilinen: 1, bilinmeyen: 1 });
      expect(ekranTutari(alicilar.borc)).toBe(1000);
      expect(alicilar.borcBakiye).toBeNaN();
      const satislar = m.satirlar[1];
      expect(satislar.alacak).toEqual({ toplam: 1500, bilinen: 2, bilinmeyen: 0 });
      expect(satislar.alacakBakiye).toBe(1500);                    // alacak tarafı tam bilinir → türetilir
      expect(m.dengeli).toBeNull();
      expect(m.bilinmeyen).toBe(1);
    });
    it('alacak tarafı bilinmiyor → borç toplamı tam, dengeli yine null; iki tarafı da bilinmeyen kayıt BİR kez sayılır', () => {
      const m = mizanHesapla([
        { debitHesap: KASA, alacakHesap: '120 - Alıcılar', borc: 300, alacak: undefined },
        { debitHesap: KASA, alacakHesap: '120 - Alıcılar', borc: NaN, alacak: NaN },
      ], []);
      expect(m.toplam.borc).toEqual({ toplam: 300, bilinen: 1, bilinmeyen: 1 });
      expect(m.toplam.alacak).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 2 });
      expect(m.dengeli).toBeNull();
      expect(m.bilinmeyen).toBe(2);
    });
    it('bilinmeyen kaydın etkilemediği hesaplar normal türetilir', () => {
      const m = mizanHesapla([
        { debitHesap: '120 - Alıcılar', alacakHesap: '600 - Yurt İçi Satışlar', borc: null, alacak: 1000 },
        { debitHesap: '153 - Ticari Mallar', alacakHesap: '320 - Satıcılar', borc: 500, alacak: 500 },
      ], []);
      const mallar = m.satirlar.find(r => r.hesap === '153 - Ticari Mallar')!;
      expect(mallar.borcBakiye).toBe(500);
      expect(m.toplam.borcBakiye).toEqual({ toplam: 500, bilinen: 3, bilinmeyen: 1 }); // 600/153/320 bilinir, 120 bilinmez
    });
  });

  it('SAYFA PARİTESİ: bilinen girdide eski mizanMap/mizanRows/mizanTotals ile aynı sayılar ve sıra', () => {
    const mikro = eskiMikroSatirlari([{ yon: 'giden', matrah: 12000, kdv: 2400 }, { yon: 'gelen', matrah: 7000, kdv: 1400 }]);
    const girdi = [...YEVMIYE.map(({ debitHesap, alacakHesap, borc, alacak }) => ({ debitHesap, alacakHesap, borc, alacak })), ...mikro];
    const eski = eskiMizan(girdi);
    const yeni = mizanHesapla(YEVMIYE, mikro);
    expect(yeni.satirlar.map(r => ({ hesap: r.hesap, borc: r.borc.toplam, alacak: r.alacak.toplam, borcBakiye: r.borcBakiye, alacakBakiye: r.alacakBakiye }))).toEqual(eski.rows);
    expect({ borc: yeni.toplam.borc.toplam, alacak: yeni.toplam.alacak.toplam, borcBakiye: yeni.toplam.borcBakiye.toplam, alacakBakiye: yeni.toplam.alacakBakiye.toplam }).toEqual(eski.totals);
    expect(yeni.dengeli).toBe(eski.dengeli);
  });
});

describe('fisTutariOku — yevmiye formu tutarı', () => {
  it('sayı ve sayısal string → sayı', () => {
    expect(fisTutariOku(1250)).toBe(1250);
    expect(fisTutariOku('1250.50')).toBe(1250.5);
    expect(fisTutariOku(0)).toBe(0);
  });
  it("boş/geçersiz ('', null, undefined, 'abc', Infinity) → NaN — eski `Number(x) || 0` bunları 0 sayıyordu", () => {
    expect(fisTutariOku('')).toBeNaN();
    expect(fisTutariOku(null)).toBeNaN();
    expect(fisTutariOku(undefined)).toBeNaN();
    expect(fisTutariOku('abc')).toBeNaN();
    expect(fisTutariOku(Infinity)).toBeNaN();
  });
});

describe('fisDogrula — çift taraflı kayıt kapısı (bilinmiyor → pozitif → denge sırasıyla)', () => {
  it('bilinmeyen tutar önce reddedilir; "sıfırdan büyük olmalı" mesajıyla karışmaz', () => {
    expect(fisDogrula('abc', 100)).toEqual({ hata: 'bilinmiyor' });
    expect(fisDogrula('', 0)).toEqual({ hata: 'bilinmiyor' });
    expect(fisDogrula(100, null)).toEqual({ hata: 'bilinmiyor' });
  });
  it('sıfır ya da negatif → pozitifDegil (eski davranış)', () => {
    expect(fisDogrula(0, 100)).toEqual({ hata: 'pozitifDegil' });
    expect(fisDogrula(100, -5)).toEqual({ hata: 'pozitifDegil' });
  });
  it('borç ≠ alacak (0.01 üstü) → dengesiz, iki tutar mesaj için döner', () => {
    expect(fisDogrula(100, 90)).toEqual({ hata: 'dengesiz', borc: 100, alacak: 90 });
  });
  it('dengeli (kuruş toleransı) → hata null, sayılar Number', () => {
    expect(fisDogrula('100', '100')).toEqual({ hata: null, borc: 100, alacak: 100 });
    expect(fisDogrula(100, 100.005)).toEqual({ hata: null, borc: 100, alacak: 100.005 });
  });
});

describe('kdvOranYaz — ekran/CSV oran metni', () => {
  it('bilinen oran → %N', () => {
    expect(kdvOranYaz(20)).toBe('%20');
    expect(kdvOranYaz('18')).toBe('%18');
    expect(kdvOranYaz(0)).toBe('%0');
  });
  it("bilinmeyen (undefined/null/NaN/'') → '—' (eski `?? 0` '%0' basıyordu)", () => {
    expect(kdvOranYaz(undefined)).toBe('—');
    expect(kdvOranYaz(null)).toBe('—');
    expect(kdvOranYaz(NaN)).toBe('—');
    expect(kdvOranYaz('')).toBe('—');
  });
});
