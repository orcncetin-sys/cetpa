/**
 * faturasizSeri.test.ts — faturasız (seri Q) TANIMA kuralı, MF ↔ Mikro anahtarı, faturasız rozeti ve dekont yolunun fatura evrak
 * tipi yüklemi. Şartname `.wf/SARTNAME-q-serisi-v3.md` T1, T1 EK, T7, T8 (saf kısım) + «Kapı sonrası hükümler» QH1, QH5-9, QH9.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FATURASIZ_SERI, seriAnahtari, faturasizSeriMi, faturasizMikroFaturaMi } from './faturasizSeri';
import { mikroFaturaAnahtari, MF_KAYNAGI } from './mfKaynagi';
import { faturaEvrakiMi, dekontGovdesiFaturaHatasi, dekontTurleri, evrakKodu, evrakAnahtariYazimHatasi, DEKONT_FATURA_RED_METNI } from './faturaEvrakKosulu';
import { seriAnahtari as seriOzetSeriAnahtari, faturaKosuluIfadesi } from '../server/mikro/seriOzet';
import { faturasizEtiketi } from '../utils/durumEtiketi';
import { kodSatirlari } from '../test/kaynakTarama';

const SRC = join(__dirname, '..');

describe('T1 — faturasizSeriMi / faturasizMikroFaturaMi (M1 kırpma, M2 yön)', () => {
  it("'Q', ' q ', 'Q ' → true; '', 'F', 'LUCA', 'CTP', null → false", () => {
    expect(FATURASIZ_SERI).toBe('Q');
    for (const v of ['Q', ' q ', 'Q ', 'q']) expect(faturasizSeriMi(v), JSON.stringify(v)).toBe(true);
    for (const v of ['', 'F', 'LUCA', 'CTP', null, undefined, 'QQ', 'Q1']) expect(faturasizSeriMi(v), JSON.stringify(v)).toBe(false);
  });
  it('yalnız GİDEN: gelen Q → false', () => {
    expect(faturasizMikroFaturaMi({ yon: 'giden', seri: 'Q' })).toBe(true);
    expect(faturasizMikroFaturaMi({ yon: 'gelen', seri: 'Q' })).toBe(false);
    expect(faturasizMikroFaturaMi({ yon: 'giden', seri: '' })).toBe(false);
    expect(faturasizMikroFaturaMi({ seri: 'Q' })).toBe(false);
  });
  it('seriAnahtari TEK kaynak: seriOzet aynı işlevi yeniden dışa aktarır (kopya yok)', () => {
    expect(seriOzetSeriAnahtari).toBe(seriAnahtari);
    expect(seriAnahtari(' q ')).toBe('Q');
  });
});

describe('T1 EK — mikroFaturaAnahtari (QH1-2)', () => {
  it('biçim `mapMikroFatura.faturaNo` ile birebir: kırp, boşu at, "-" ile birleştir; sayı sıra', () => {
    expect(mikroFaturaAnahtari('Q', '1')).toBe('Q-1');
    expect(mikroFaturaAnahtari(' Q ', ' 1 ')).toBe('Q-1');
    expect(mikroFaturaAnahtari('', '123')).toBe('123');
    expect(mikroFaturaAnahtari('', '')).toBe('');
    expect(mikroFaturaAnahtari('Q', 1)).toBe('Q-1');
    expect(mikroFaturaAnahtari('', 0)).toBe('0');
    expect(mikroFaturaAnahtari(null, undefined)).toBe('');
  });
});

describe('T7 — faturasız rozeti (QH5-9): sözlükte yazılı büyük harf; MF seriden', () => {
  it('Q serili MF «FATURASIZ · MİKRO Q» / EN; boş serili MF null (MİKRO FATURA rozeti kalır); yazılmamış faturasız «FATURASIZ»', () => {
    const mfQ = { source: MF_KAYNAGI, faturali: true, mikroEvrak: { seri: 'Q' } };
    expect(faturasizEtiketi(mfQ, 'tr')).toBe('FATURASIZ · MİKRO Q');
    expect(faturasizEtiketi(mfQ, 'en')).toBe('NO INVOICE · MIKRO Q');
    expect(faturasizEtiketi({ ...mfQ, faturali: false }, 'tr')).toBe('FATURASIZ · MİKRO Q');
    expect(faturasizEtiketi({ source: MF_KAYNAGI, faturali: true, mikroEvrak: { seri: '' } }, 'tr')).toBeNull();
    expect(faturasizEtiketi({ faturali: false }, 'tr')).toBe('FATURASIZ');
    expect(faturasizEtiketi({ faturali: false }, 'en')).toBe('NO INVOICE');
    expect(faturasizEtiketi({ faturali: true }, 'tr')).toBeNull();
  });
  it('kaynak taraması: yardımcıda `toUpperCase(` yok (Türkçe metin büyütülmez)', () => {
    const satirlar = kodSatirlari(join(SRC, 'utils/durumEtiketi.ts')).map(s => s.kod);
    const i = satirlar.findIndex(k => k.includes('export function faturasizEtiketi'));
    expect(i).toBeGreaterThan(-1);
    const govde = satirlar.slice(i, i + 6).join('\n');
    expect(govde).not.toContain('toUpperCase(');
    expect(govde).not.toContain('toLocaleUpperCase(');
  });
});

describe('T8 (saf) — dekont yolu fatura evrak tipini yazamaz (QH9; M7, M39)', () => {
  it("tipe dayanıklı: '63', ' 63', 63.0, 63 → fatura; (0, 6) / ('0', '6') → fatura; 29, (0, 7), null → değil", () => {
    for (const t of ['63', ' 63', 63.0, 63, '63 ']) expect(faturaEvrakiMi(t, undefined), JSON.stringify(t)).toBe(true);
    expect(faturaEvrakiMi(0, 6)).toBe(true);
    expect(faturaEvrakiMi('0', '6')).toBe(true);
    for (const [t, c] of [[29, 0], [0, 7], [null, null], [undefined, 6], [34, 6]] as const) expect(faturaEvrakiMi(t, c), `${t}/${c}`).toBe(false);
    expect(evrakKodu(' 63')).toBe(63);
    expect(Number.isNaN(evrakKodu(null))).toBe(true);
  });
  it('SQL ile AYNI küme: `seriOzet.faturaKosuluIfadesi` metni 63 VE (0 + cinsi 6) kollarını taşır', () => {
    expect(faturaKosuluIfadesi('cha_evrak_tip', 'cha_cinsi')).toBe('(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6))');
  });
  it('gövde denetimi: HER evrakın HER satırı; ikinci evrakın satırı 63 → red; dizi olmayan → red; temiz dekont → null', () => {
    const satir = (ek: Record<string, unknown>) => ({ cha_kod: '120.01', cha_meblag: 10, cha_tip: 0, cha_tarihi: '01.11.2026', ...ek });
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: 29 })] }] })).toBeNull();
    const iki = { evraklar: [{ satirlar: [satir({ cha_evrak_tip: 29 })] }, { satirlar: [satir({ cha_evrak_tip: 29 }), satir({ cha_evrak_tip: '63' })] }] };
    expect(dekontGovdesiFaturaHatasi(iki)).toBe(`${DEKONT_FATURA_RED_METNI} (evrak 2, satır 2)`);
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: '0', cha_cinsi: '6' })] }] })).toContain('evrak 1, satır 1');
    expect(dekontGovdesiFaturaHatasi({ evraklar: 'x' })).toBe('payload.evraklar dizi olmalı.');
    expect(dekontGovdesiFaturaHatasi({})).toBe('payload.evraklar dizi olmalı.');
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: {} }] })).toBe('payload.evraklar[0].satirlar dizi olmalı.');
    expect(dekontGovdesiFaturaHatasi(null)).toBe('payload.evraklar dizi olmalı.');
  });
  it('evrak tipi yok / ≤ 0 → red (`cariHareketGovdesi` kuralı: hangi deftere yazılacağı tahmin edilmez); 29 metin de geçer', () => {
    const satir = (ek: Record<string, unknown>) => ({ cha_kod: '120.01', cha_meblag: 10, cha_tip: 0, cha_tarihi: '01.11.2026', ...ek });
    for (const tip of [undefined, null, '', '  ', 0, '0', -1, 'abc', NaN, true]) {
      expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: tip })] }] }), JSON.stringify(tip))
        .toBe('cha_evrak_tip verilmeli (ör. dekont 29) — tahmin edilmez (evrak 1, satır 1)');
    }
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({})] }] })).toContain('cha_evrak_tip verilmeli');
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [null] }] })).toContain('cha_evrak_tip verilmeli');
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: '29' })] }] })).toBeNull();
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: ' 29 ' })] }] })).toBeNull();
    // (0, 6) fatura metniyle reddedilir (fatura denetimi ≤ 0'dan ÖNCE).
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: 0, cha_cinsi: 6 })] }] })).toBe(`${DEKONT_FATURA_RED_METNI} (evrak 1, satır 1)`);
  });
  it('evrak tipi / cinsi anahtarı birebir küçük harf değilse red (`CHA_EVRAK_TIP`, karışık, Türkçe İ / ı); normal satır geçer', () => {
    const satir = (ek: Record<string, unknown>) => ({ cha_kod: '120.01', cha_meblag: 10, cha_tip: 0, cha_tarihi: '01.11.2026', ...ek });
    const govde = (s: Record<string, unknown>) => ({ evraklar: [{ satirlar: [s] }] });
    expect(dekontGovdesiFaturaHatasi(govde({ cha_kod: '120.01', cha_meblag: 10, CHA_EVRAK_TIP: 63 }))).toBe('«CHA_EVRAK_TIP» anahtarı yalnız «cha_evrak_tip» yazımıyla kabul edilir. (evrak 1, satır 1)');
    for (const s of [
      satir({ cha_evrak_tip: 29, CHA_EVRAK_TIP: 63 }),
      satir({ cha_evrak_tip: 29, Cha_Evrak_Tip: 63 }),
      satir({ CHA_EVRAK_TİP: 63 }),
      satir({ cha_evrak_tıp: 63 }),
      satir({ cha_evrak_tip: 29, CHA_CİNSİ: 6 }),
      satir({ cha_evrak_tip: 0, Cha_Cinsi: 6 }),
      satir({ cha_evrak_tip: 29, ['cha_evrak_ti\u0307p']: 63 }),
      satir({ cha_evrak_tip: 29, ['cha_evrak_tip'.replace('k', '\u212A')]: 63 }),
      satir({ cha_evrak_tip: 29, ['cha_cin\u017Fi']: 6 }),
    ]) {
      expect(dekontGovdesiFaturaHatasi(govde(s)), JSON.stringify(Object.keys(s))).toMatch(/anahtarı yalnız «cha_(evrak_tip|cinsi)» yazımıyla kabul edilir\. \(evrak 1, satır 1\)$/);
    }
    expect(dekontGovdesiFaturaHatasi(govde(satir({ cha_evrak_tip: 29, cha_cinsi: 5 })))).toBeNull();
    expect(dekontGovdesiFaturaHatasi(govde(satir({ cha_evrak_tip: 29, cha_evrakno_seri: 'D', CHA_ACIKLAMA: 'x' })))).toBeNull();  // öteki alanlar kapı dışı
    expect(evrakAnahtariYazimHatasi({ cha_evrak_tip: 29, cha_cinsi: 5 })).toBeNull();
    expect(evrakAnahtariYazimHatasi({})).toBeNull();
    // İkinci evrakın ikinci satırı da denetlenir.
    expect(dekontGovdesiFaturaHatasi({ evraklar: [{ satirlar: [satir({ cha_evrak_tip: 29 })] }, { satirlar: [satir({ cha_evrak_tip: 29 }), satir({ cha_evrak_tip: 29, CHA_EVRAK_TIP: 63 })] }] }))
      .toMatch(/\(evrak 2, satır 2\)$/);
  });
  it('bağlı (yazıldı ama bağlanmadı çiti): `evrakAnahtariYazimHatasi` İKİ çağıranda, ikisinde de `faturaEvrakiMi`\'den ÖNCE', () => {
    const kosul = kodSatirlari(join(SRC, 'lib/faturaEvrakKosulu.ts')).map(s => s.kod).join('\n');
    const govdeKodu = kosul.slice(kosul.indexOf('export function dekontGovdesiFaturaHatasi'), kosul.indexOf('export function dekontTurleri'));
    expect(govdeKodu.indexOf('evrakAnahtariYazimHatasi(satir)')).toBeGreaterThan(-1);
    expect(govdeKodu.indexOf('evrakAnahtariYazimHatasi(satir)')).toBeLessThan(govdeKodu.indexOf('faturaEvrakiMi('));
    const muh = kodSatirlari(join(SRC, 'server/mikro/govdeMuhasebe.ts')).map(s => s.kod).join('\n');
    const cari = muh.slice(muh.indexOf('export function cariHareketGovdesi'));
    expect(cari.indexOf('evrakAnahtariYazimHatasi(hareket)')).toBeGreaterThan(-1);
    expect(cari.indexOf('evrakAnahtariYazimHatasi(hareket)')).toBeLessThan(cari.indexOf('faturaEvrakiMi('));
    expect(cari.indexOf('evrakAnahtariYazimHatasi(hareket)')).toBeLessThan(cari.indexOf('...hareket'));
  });
  it('dekont penceresi: fatura tipleri listeden çıkar; ilk sırada 63 olsa da varsayılan (ilk eleman) fatura tipi DEĞİL', () => {
    const turler = [
      { cha_evrak_tip: 63, cha_cinsi: 6, cha_tip: 0, adet: 412 },
      { cha_evrak_tip: 0, cha_cinsi: 6, cha_tip: 1, adet: 300 },
      { cha_evrak_tip: 29, cha_cinsi: 0, cha_tip: 0, adet: 40 },
      { cha_evrak_tip: 0, cha_cinsi: 7, cha_tip: 1, adet: 3 },
      { cha_evrak_tip: 34, cha_cinsi: 19, cha_tip: 0, adet: 2 },
    ];
    const liste = dekontTurleri(turler);
    // Evrak tipi 0 (cinsi 6 dışı) da çıkar: iki sunucu yolu ≤ 0'ı reddeder — seçenek ölü kalırdı (bilerek değişen çit, Q6).
    expect(liste.map(t => `${t.cha_evrak_tip}/${t.cha_cinsi}`)).toEqual(['29/0', '34/19']);
    expect(faturaEvrakiMi(liste[0].cha_evrak_tip, liste[0].cha_cinsi)).toBe(false);
  });
  it('bağlı: DekontModal tür listesini `dekontTurleri`\'nden alır (yazıldı ama bağlanmadı çiti)', () => {
    const kod = kodSatirlari(join(SRC, 'components/DekontModal.tsx')).map(s => s.kod).join('\n');
    expect(kod).toMatch(/const list = dekontTurleri\(/);
  });
});

describe('T2 EK — Mikro okuyucusu anahtarı tek kaynaktan kurar (yazıldı ama bağlanmadı çiti)', () => {
  it('useMikroFaturalar ve RaporlarPage `mikroFaturaAnahtari` çağırır; Raporlar `MF_KAYNAGI`\'na bağlı', () => {
    const hook = readFileSync(join(SRC, 'hooks/useMikroFaturalar.ts'), 'utf-8');
    expect(hook).toMatch(/faturaNo: mikroFaturaAnahtari\(seri, sira\)/);
    const rapor = kodSatirlari(join(SRC, 'pages/RaporlarPage.tsx')).map(s => s.kod).join('\n');
    expect(rapor).toMatch(/mikroFaturaAnahtari\(o\.mikroEvrak\.seri, o\.mikroEvrak\.sira\)/);
    expect(rapor).toMatch(/source: MF_KAYNAGI/);
  });
});
