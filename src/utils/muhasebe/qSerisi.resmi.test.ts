/**
 * qSerisi.resmi.test.ts — Resmî ekranlar faturasız (seri Q) Mikro satırını DIŞLAR + «faturasız (Q) dâhil değil» notu (K3), yönetim
 * ekranı KDV Mutabakat onu «Faturasız» başlığında AYRI sayar (K4). Şartname `.wf/SARTNAME-q-serisi-v3.md` Q9, Q10-1; testler
 * T-RESMÎ (tek fikstür, AYNI girdi bütün resmî işlevlere), T3 (not satırı), T4 (e-Fatura Takip), T5 (KDV Mutabakat).
 * Mutasyonlar: M3 (her işlevden dışlamayı ayrı ayrı çıkar), M4 (dönem süzgecisiz say → Temmuz), M5 (not satırında adet 0 denetimi).
 */
import { describe, it, expect } from 'vitest';
import { kdvDonemi } from './kdvBeyan';
import { mikroMizanSatirlari, mizanHesapla, MIKRO_HESAP } from './mizan';
import { kdvAnalizi, babsFormu } from './babsKdvAnaliz';
import { kdvBorcu } from './nakitBilanco';
import { gelirGiderOzeti } from './gelirGider';
import { mikroFaturaSatirlari, faturaKpi, faturaTakipSiparisleri, faturaTakipMikroOzeti } from './faturalar';
import { kdvMutabakat } from './butceVaryans';
import { faturasizDisiNotu, faturasizDisiSay, faturasizDisiBos, type FaturasizDisi } from './faturasizDisi';
import { kurusaYuvarla } from '../para';

// ── Tek fikstür (şartname T-RESMÎ) ───────────────────────────────────────────────────────────────
const F0 = { id: 'f0', cariKod: '120.01', yon: 'giden' as const, tarih: '2026-06-15', tutar: 100000, matrah: 83333.33, kdv: 16666.67,
  oran: 20, oranKarma: false, faturaNo: '411', ebelgeTuru: 0, seri: '', faturasiz: false };
const Q1 = { id: 'q1', cariKod: '0120037047', yon: 'giden' as const, tarih: '2026-06-06', tutar: 5500.2, matrah: 4583.5, kdv: 916.7,
  oran: 20, oranKarma: false, faturaNo: 'Q-1', ebelgeTuru: 1, seri: 'Q', faturasiz: true };
const FATURALAR = [F0, Q1];
const kurus = (n: number) => kurusaYuvarla(n);
const disiRakam = (d: FaturasizDisi) => ({ adet: d.adet, tutar: kurus(d.tutar.toplam), kdv: kurus(d.kdv.toplam) });
const HAZIRAN_DISI = { adet: 1, tutar: 5500.2, kdv: 916.7 };
const BOS_DISI = { adet: 0, tutar: 0, kdv: 0 };

describe('T-RESMÎ — K3: aynı girdi, her resmî işlev Q-1\'i dışlar ve dışladığını KENDİ dönem / yön süzgeciyle sayar', () => {
  it('KDV dönemi: hesaplanan 16.666,67 (Q-1\'in 916,70\'i yok); Haziran dışı {1; 5.500,20; 916,70}, Temmuz {0}', () => {
    const haz = kdvDonemi([], FATURALAR, 2026, 6);
    expect(kurus(haz.hesaplanan.toplam)).toBe(16666.67);
    expect(disiRakam(haz.faturasizDisi)).toEqual(HAZIRAN_DISI);
    expect(Object.values(haz.oranKirilimi).reduce((t, k) => t + k.adet, 0)).toBe(1);
    expect(disiRakam(kdvDonemi([], FATURALAR, 2026, 7).faturasizDisi)).toEqual(BOS_DISI);
  });

  it('mizan: 600 alacak 83.333,33, 391 alacak 16.666,67 (Q-1 sentezlenmez); dışlanan sayaç {1}', () => {
    const m = mikroMizanSatirlari(FATURALAR);
    const hesap = (ad: string) => mizanHesapla([], m.satirlar).satirlar.find(s => s.hesap === ad);
    expect(kurus(hesap(MIKRO_HESAP.satislar)?.alacak.toplam ?? NaN)).toBe(83333.33);
    expect(kurus(hesap(MIKRO_HESAP.hesaplananKdv)?.alacak.toplam ?? NaN)).toBe(16666.67);
    expect(m.bilinmeyen).toBe(0);
    expect(disiRakam(m.faturasizDisi)).toEqual(HAZIRAN_DISI);
  });

  it('KDV analizi: tahsil edilen 16.666,67; yıl dışı {1}, 2025 {0}; oran dağılımında Q-1 yok', () => {
    const k = kdvAnalizi(FATURALAR, 2026);
    expect(kurus(k.toplamTahsil.toplam)).toBe(16666.67);
    expect(kurus(k.aylar[5].tahsil.toplam)).toBe(16666.67);
    expect(k.faturaSayisi).toBe(1);
    expect(kurus(k.oranDagilimi['20'].toplam)).toBe(16666.67);
    expect(disiRakam(k.faturasizDisi)).toEqual(HAZIRAN_DISI);
    expect(disiRakam(kdvAnalizi(FATURALAR, 2025).faturasizDisi)).toEqual(BOS_DISI);
  });

  it('KDV borcu (Mikro tarafı): net 16.666,67; Haziran dışı {1}, Temmuz {0}; sipariş tarafı değişmez', () => {
    const haz = kdvBorcu([], FATURALAR, '2026-06');
    expect(kurus(haz.mikroNet)).toBe(16666.67);
    expect(haz.bilinen).toBe(1);
    expect(disiRakam(haz.faturasizDisi)).toEqual(HAZIRAN_DISI);
    expect(disiRakam(kdvBorcu([], FATURALAR, '2026-07').faturasizDisi)).toEqual(BOS_DISI);
    const siparisli = kdvBorcu([{ faturali: true, kdvTutari: 100 }], FATURALAR, '2026-06');
    expect(kurus(siparisli.toplam)).toBe(kurus(100 + 16666.67));
  });

  it('Gelir / Gider 600 (Mikro): 83.333,33; Haziran dışı {1}, Temmuz {0}', () => {
    const haz = gelirGiderOzeti([], FATURALAR, { yil: 2026, ay: 6 });
    expect(kurus(haz.gelir.toplam)).toBe(83333.33);
    expect(disiRakam(haz.faturasizDisi)).toEqual(HAZIRAN_DISI);
    expect(disiRakam(gelirGiderOzeti([], FATURALAR, { yil: 2026, ay: 7 }).faturasizDisi)).toEqual(BOS_DISI);
    expect(kurus(haz.aylik[5].gelir.toplam)).toBe(83333.33);
  });

  it('Ba-Bs: Bs\'de yalnız F0\'ın carisi (Q-1\'in 5.500,20\'si eşiği geçse de listede YOK); Haziran dışı {1}, Temmuz {0}; Ba\'da dışı 0', () => {
    const bs = babsFormu(FATURALAR, 'giden', '2026-06', () => undefined);
    expect(bs.satirlar.map(s => s.ad)).toEqual(['120.01']);
    expect(bs.faturaSayisi).toBe(1);
    expect(disiRakam(bs.faturasizDisi)).toEqual(HAZIRAN_DISI);
    expect(disiRakam(babsFormu(FATURALAR, 'giden', '2026-07', () => undefined).faturasizDisi)).toEqual(BOS_DISI);
    expect(disiRakam(babsFormu(FATURALAR, 'gelen', '2026-06', () => undefined).faturasizDisi)).toEqual(BOS_DISI);
  });

  it('Faturalar e-belge süzgeci: e-Arşiv\'de 0 kayıt (bugün Q-1 e-Arşiv sayılıyordu), e-Fatura\'da yalnız F0, «Tümü»nde 2', () => {
    const satirlar = (ebelgeTuru: 'all' | 'e-fatura' | 'e-arsiv') =>
      mikroFaturaSatirlari(FATURALAR, { yon: 'hepsi', yil: 'hepsi', ebelgeTuru, cetpaEvrakNolari: new Set(), cariAdMap: new Map() });
    expect(satirlar('e-arsiv')).toHaveLength(0);
    expect(satirlar('e-fatura').map(f => f.id)).toEqual(['f0']);
    expect(satirlar('all').map(f => f.id)).toEqual(['f0', 'q1']);
    // Alanı olmayan eski satır bugünkü gibi e-Arşiv'de görünür.
    const { faturasiz: _a, ...eskiQ } = Q1;
    void _a;
    expect(mikroFaturaSatirlari([eskiQ], { yon: 'hepsi', yil: 'hepsi', ebelgeTuru: 'e-arsiv', cetpaEvrakNolari: new Set(), cariAdMap: new Map() })).toHaveLength(1);
  });

  it('Faturalar KPI: «Tümü»nde sayılır (satış 105.500,20) + «içinde 1 faturasız (Q) · 5.500,20» sayacı', () => {
    const k = faturaKpi([], FATURALAR, { kaynak: 'hepsi' });
    expect(kurus(k.satis.toplam)).toBe(105500.2);
    expect(k.mikroGidenAdet).toBe(2);
    expect(disiRakam(k.faturasiz)).toEqual(HAZIRAN_DISI);
    expect(disiRakam(faturaKpi([], [F0], { kaynak: 'hepsi' }).faturasiz)).toEqual(BOS_DISI);
  });
});

describe('T3 — not satırı (M5)', () => {
  it('«₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV\'si ₺916,70)»; KDV 0 → parantez yok; adet 0 → null', () => {
    expect(faturasizDisiNotu(faturasizDisiSay([Q1]), 'tr')).toBe('₺5.500,20 faturasız (Q) dâhil değil · 1 kayıt (KDV\'si ₺916,70)');
    expect(faturasizDisiNotu(faturasizDisiSay([{ tutar: 4583.5, kdv: 0 }]), 'tr')).toBe('₺4.583,50 faturasız (Q) dâhil değil · 1 kayıt');
    expect(faturasizDisiNotu(faturasizDisiBos(), 'tr')).toBeNull();
    expect(faturasizDisiNotu(null, 'tr')).toBeNull();
    expect(faturasizDisiNotu(faturasizDisiSay([Q1]), 'en')).toBe('₺5.500,20 uninvoiced (Q) not included · 1 record (VAT ₺916,70)');
  });
  it('tutarı okunamayan kayıt 0 sayılmaz: «—» + «N kayıt tutarsız»', () => {
    // Tutarı da KDV'si de okunamayan TEK kayıt: «1 kayıt tutarsız» (kayıt adedi; alan başına sayılmaz).
    expect(faturasizDisiNotu(faturasizDisiSay([{ tutar: NaN, kdv: NaN }]), 'tr')).toBe('— faturasız (Q) dâhil değil · 1 kayıt (KDV\'si —) · 1 kayıt tutarsız');
    expect(faturasizDisiSay([{ tutar: NaN, kdv: NaN }]).tutarsiz).toBe(1);
  });
  it('ayrık kümeler (biri tutarsız, öteki KDV\'siz): «2 kayıt tutarsız» — `Math.max` 1 derdi; temiz kayıt sayılmaz', () => {
    const d = faturasizDisiSay([{ tutar: NaN, kdv: 100 }, { tutar: 600, kdv: NaN }, Q1]);
    expect(d.tutarsiz).toBe(2);
    expect(faturasizDisiNotu(d, 'tr')).toMatch(/ · 2 kayıt tutarsız$/);
    expect(faturasizDisiNotu(faturasizDisiSay([{ tutar: NaN, kdv: 100 }, { tutar: 600, kdv: NaN }]), 'en')).toMatch(/ · 2 records unknown$/);
    expect(faturasizDisiSay([Q1]).tutarsiz).toBe(0);
    expect(faturasizDisiNotu(faturasizDisiSay([Q1]), 'tr')).not.toMatch(/tutarsız/);
    expect(faturasizDisiBos().tutarsiz).toBe(0);
    // `toplaBilinen` bilinmezlik tanımı: null / undefined / metin-olmayan bilinmeyen; sayı metni bilinen.
    expect(faturasizDisiSay([{ tutar: null, kdv: '100' }, { kdv: 0 }]).tutarsiz).toBe(2);
    expect(faturasizDisiSay([{ tutar: '600', kdv: '0' }]).tutarsiz).toBe(0);
  });
});

describe('T4 — e-Fatura Takip: faturasız sipariş tabloda yok; Mikro özeti Q-1\'i saymaz', () => {
  it('`allBillable` faturasız siparişi ALMAZ; «Eksik» sayacına girmez; alanı olmayan sipariş (mağaza) kalır; iptal zaten dışarıda', () => {
    const orders = [
      { id: 'a', status: 'Pending', faturali: true },
      { id: 'b', status: 'Pending', faturali: false },
      { id: 'c', status: 'Delivered' },
      { id: 'd', status: 'Cancelled', faturali: false },
    ];
    const t = faturaTakipSiparisleri(orders);
    expect(t.liste.map(o => o.id)).toEqual(['a', 'c']);
    expect(t.faturasizAdet).toBe(1);
  });
  it('Mikro özeti: Toplam / Giden sayaçları Q-1\'i saymaz; dışlanan not sayacında', () => {
    const gelen = { ...F0, id: 'g1', yon: 'gelen' as const, tarih: '2026-11-02', faturasiz: false };
    const o = faturaTakipMikroOzeti([...FATURALAR, gelen], '2026-11');
    expect([o.toplam, o.giden.length, o.gelen.length, o.gelenBuAy]).toEqual([2, 1, 1, 1]);
    expect(disiRakam(o.faturasizDisi)).toEqual(HAZIRAN_DISI);
  });
});

describe('T5 — KDV Mutabakat (Q10-1): Q-1 fatura kaleminden çıkar, «Faturasız» başlığında ayrı', () => {
  it('fatura adedi 1; faturasız adedi 1; faturasızTutar 5.500,20; matraha 4.583,50; KDV notu 916,70; ciro DEĞİŞMEZ', () => {
    const m = kdvMutabakat(FATURALAR, [], '2026-06');
    expect(m.faturaAdedi).toBe(1);
    expect(m.faturasizAdedi).toBe(1);
    expect(kurus(m.faturasizTutar.toplam)).toBe(5500.2);
    expect(kurus(m.matrah.toplam)).toBe(kurus(83333.33 + 4583.5));
    expect(kurus(m.kdv.toplam)).toBe(16666.67);
    expect(kurus(m.faturasizKdv.toplam)).toBe(916.7);
    expect(kurus(m.ciro.toplam)).toBe(105500.2);
    expect(m.bantlar.reduce((t, b) => t + b.adet, 0)).toBe(1);
    // Alanı olmayan girdi: bugünkü sonuç (Q-1 fatura kaleminde, ciro aynı).
    const { faturasiz: _b, ...eskiQ } = Q1;
    void _b;
    const eski = kdvMutabakat([F0, eskiQ], [], '2026-06');
    expect([eski.faturaAdedi, eski.faturasizAdedi, kurus(eski.ciro.toplam), kurus(eski.kdv.toplam)]).toEqual([2, 0, 105500.2, kurus(16666.67 + 916.7)]);
  });
  it('faturasız Cetpa siparişi + Q satırı birlikte: adet 2, tutar ikisinin toplamı', () => {
    const m = kdvMutabakat(FATURALAR, [{ totalPrice: 2000, status: 'Delivered', faturali: false, createdAt: '2026-06-20T10:00:00' }], '2026-06');
    expect(m.faturasizAdedi).toBe(2);
    expect(kurus(m.faturasizTutar.toplam)).toBe(7500.2);
    expect(kurus(m.ciro.toplam)).toBe(107500.2);
  });
  it('dilim satırlarının matrah toplamı = Toplam Matrah kartı (F0 + Q1 + sipariş; fark 0,00 — meblağ basılınca 916,70 aşıyordu)', () => {
    const m = kdvMutabakat(FATURALAR, [{ totalPrice: 2000, status: 'Delivered', faturali: false, createdAt: '2026-06-20T10:00:00' }], '2026-06');
    expect(kurus(m.faturasizMatrah.toplam)).toBe(kurus(2000 + 4583.5));
    expect(m.faturasizMatrah).toMatchObject({ bilinen: 2, bilinmeyen: 0 });
    const satirlar = m.bantlar.reduce((t, b) => t + b.matrah.toplam, 0) + m.faturasizMatrah.toplam;
    expect(kurus(satirlar)).toBe(kurus(m.matrah.toplam));
    expect(kurus(m.matrah.toplam - satirlar)).toBe(0);
    // Meblağ ve ciro AYNI (T5): satır matrah basar, kart ciroyu meblağdan toplar.
    expect(kurus(m.faturasizTutar.toplam)).toBe(7500.2);
    expect(kurus(m.ciro.toplam)).toBe(107500.2);
    // Q'nun matrahı okunamazsa: kart ve satır aynı bilinmeyeni taşır (satır notu kartla uyuşur).
    const { matrah: _m, ...matrahsizQ } = Q1;
    void _m;
    const b = kdvMutabakat([F0, matrahsizQ], [], '2026-06');
    expect(b.faturasizMatrah).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(b.matrah.bilinmeyen).toBe(1);
    expect(b.faturasizTutar.bilinmeyen).toBe(0);
  });
});
