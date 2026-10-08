// @vitest-environment node
/**
 * magazaTalep.test.ts — mağaza sipariş talebinin SAF eşleyicisi + doğrulama şeması (dilim 1, 2026-10-08).
 *
 * Kilitlenen değişmezler (şartname § 1.a, § 7 «saf eşleyici testleri»):
 *  • kimlik formülü `mt-` + sha256(kiracı | talep no | telefon son 10) ilk 32 onaltılık hane,
 *  • telefonun son 10 rakamı KIRPMADAN ÖNCEKİ değerden,
 *  • aşım ret değil KIRPMA + `kirpildi`; kesim vekil çiftini bölmez,
 *  • denetim karakteri temizliği (U+0000, C0 / C1), satır ayırıcılar (U+2028 / U+2029 dâhil),
 *  • Türkçe harfler AYNEN (büyük / küçük harf çevirme, `normalize`, ASCII'ye indirgeme yok),
 *  • `birimFiyat` yok / null → `talepFiyat: null` (0 OLMAZ); toplamlar yoksa `null`,
 *  • `fiyatiSorulacakVar` istemciden alınmaz, kalemlerden türetilir.
 * Özel karakterler kaynakta HAM yazılmaz; `k(…)` ile kod noktasından üretilir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';
import { MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep';
import { MagazaSiparisTalebiSchema } from '../schemas';
import {
  MAGAZA_METIN_SINIRLARI, magazaMetniTemizle, magazaTalepKimligi, talepEsle, telefonSon10,
  type MagazaTalepGirdisi, type TalepEsleSonucu,
} from './magazaTalep';

const k = (...kodlar: number[]): string => String.fromCharCode(...kodlar);
const NUL = k(0x00), ZIL = k(0x07), VT = k(0x0B), FF = k(0x0C), ESC = k(0x1B), DEL = k(0x7F);
const C1_ILK = k(0x80), NEL = k(0x85), C1_SON = k(0x9F), LS = k(0x2028), PS = k(0x2029);
/** U+1F600 — UTF-16'da vekil çifti (2 kod birimi). */
const YUZ = k(0xD83D, 0xDE00);
const UST_VEKIL = k(0xD83D), ALT_VEKIL = k(0xDE00), YER_TUTUCU = k(0xFFFD);
const BIRLESIK_NOKTA = k(0x0307);

const SIMDI = new Date('2026-10-08T09:15:30.123Z');
const BAGLAM = { companyId: 'kiraci-1', simdi: SIMDI };

/** Mağazanın gönderdiği biçimde geçerli gövde; `ustune` ile alan ezilir. */
function govde(ustune: Partial<MagazaTalepGirdisi> = {}): MagazaTalepGirdisi {
  return {
    no: 'T261008-5Y9P',
    tarih: '2026-10-08T12:15:00.000+03:00',
    musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '+90 (532) 123 45 67', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. No: 4\nKadıköy', vergi: '1234567890' },
    not: 'Öğleden sonra arayın.',
    kalemler: [
      { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false },
      { id: 'u-2', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, birimFiyat: null, tedarik: true },
    ],
    araToplam: 409.98, kdv: 82, toplam: 491.98,
    ...ustune,
  };
}
function esle(girdi: MagazaTalepGirdisi, baglam = BAGLAM) {
  const s = talepEsle(girdi, baglam);
  if (!s.ok) throw new Error('eşleme başarılı olmalıydı');
  return s;
}
const reddedildi = (s: TalepEsleSonucu): boolean => s.ok === false;

describe('kimlik formülü — mt- + sha256(kiracı | talep no | telefon son 10) ilk 32 onaltılık hane', () => {
  it('bilinen vektör (shasum ile bağımsız hesaplandı)', () => {
    expect(magazaTalepKimligi('kiraci-1', 'T261008-5Y9P', '5321234567')).toBe('mt-d106d1b886eb708917857b8bb8338041');
    expect(magazaTalepKimligi('kiraci-2', 'T261008-5Y9P', '5321234567')).toBe('mt-91327a66f3933387448db7bca209bf91');
  });
  it('biçim ortak sözleşmedeki desene uyar; ayraç TİRE (`__` kiracı öneki ayracıdır)', () => {
    const { id } = esle(govde());
    expect(id).toBe('mt-d106d1b886eb708917857b8bb8338041');
    expect(id).toMatch(MAGAZA_TALEP_KIMLIK_DESENI);
    expect(id).not.toContain('__');
  });
  it('kiracı, talep no ve telefon ayrı ayrı kimliği değiştirir', () => {
    const taban = esle(govde()).id;
    expect(esle(govde(), { companyId: 'kiraci-2', simdi: SIMDI }).id).not.toBe(taban);
    expect(esle(govde({ no: 'T261008-5Y9Q' })).id).not.toBe(taban);
    expect(esle(govde({ musteri: { ...govde().musteri, telefon: '0532 123 45 68' } })).id).not.toBe(taban);
  });
  it('aynı talep no + aynı numaranın başka yazımı AYNI kimlik (yeniden gönderim çakışır)', () => {
    const taban = esle(govde()).id;
    expect(esle(govde({ musteri: { ...govde().musteri, telefon: '0 532 123 45 67' } })).id).toBe(taban);
    expect(esle(govde({ musteri: { ...govde().musteri, telefon: '5321234567' } })).id).toBe(taban);
  });
  it('kimlik saate ve diğer alanlara bağlı DEĞİL', () => {
    const taban = esle(govde()).id;
    expect(esle(govde({ not: 'başka not', araToplam: 1 }), { companyId: 'kiraci-1', simdi: new Date('2027-01-01T00:00:00Z') }).id).toBe(taban);
  });
});

describe('telefonSon10', () => {
  it('son 10 RAKAM; ayraç, ülke kodu, baştaki sıfır atılır', () => {
    expect(telefonSon10('+90 (532) 123 45 67')).toBe('5321234567');
    expect(telefonSon10('0532-123-45-67')).toBe('5321234567');
    expect(telefonSon10('5321234567')).toBe('5321234567');
  });
  it("10'dan az rakam → null (tam 10 kabul, 9 ret)", () => {
    expect(telefonSon10('532123456')).toBeNull();
    expect(telefonSon10('')).toBeNull();
    expect(telefonSon10('telefon yok')).toBeNull();
    expect(telefonSon10('1234567890')).toBe('1234567890');
  });
  it('yalnız ASCII rakam sayılır (Arap-Hint rakamı anahtar üretmez)', () => {
    const arapHint = Array.from({ length: 10 }, (_, i) => k(0x0660 + i)).join('');
    expect(telefonSon10(arapHint)).toBeNull();
  });
  it('dokümanda `telefonSon10` KIRPMADAN ÖNCEKİ değerin rakamlarından; saklanan telefon 40 birimde kırpılır', () => {
    const uzun = `${'x'.repeat(45)} 0532 123 45 67`;
    const { belge } = esle(govde({ musteri: { ...govde().musteri, telefon: uzun } }));
    expect(belge.telefonSon10).toBe('5321234567');
    expect(belge.musteri.telefon).toBe('x'.repeat(40));
    expect(belge.kirpildi).toBe(true);
  });
});

describe('kırpma — aşım ret değil KIRPMA; `kirpildi` işareti', () => {
  const S = MAGAZA_METIN_SINIRLARI;
  it('sınırlar şartnamedeki tabloyla birebir', () => {
    expect(S).toEqual({ ad: 200, firma: 200, telefon: 40, eposta: 254, il: 80, adres: 500, vergi: 20, not: 1000, kalemAd: 200, kalemSku: 60, kalemId: 128, kalemMarka: 60 });
  });
  it('her alan kendi sınırında kesilir ve `kirpildi: true` yazılır', () => {
    const u = (n: number) => 'ş'.repeat(n + 7);
    const { belge } = esle(govde({
      musteri: { ad: u(S.ad), firma: u(S.firma), telefon: `05321234567${'9'.repeat(40)}`, eposta: u(S.eposta), il: u(S.il), adres: u(S.adres), vergi: u(S.vergi) },
      not: u(S.not),
      kalemler: [{ id: u(S.kalemId), sku: u(S.kalemSku), ad: u(S.kalemAd), marka: u(S.kalemMarka), adet: 1 }],
    }));
    expect({
      ad: belge.musteri.ad.length, firma: belge.musteri.firma.length, telefon: belge.musteri.telefon.length, eposta: belge.musteri.eposta.length,
      il: belge.musteri.il.length, adres: belge.musteri.adres.length, vergi: belge.musteri.vergi.length, not: belge.not.length,
      kalemAd: belge.kalemler[0].ad.length, kalemSku: belge.kalemler[0].sku.length, kalemId: belge.kalemler[0].id.length, kalemMarka: belge.kalemler[0].marka.length,
    }).toEqual(S);
    expect(belge.kirpildi).toBe(true);
    expect(belge.musteri.ad).toBe('ş'.repeat(200));
  });
  it.each([
    ['ad', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, ad: m } }), S.ad],
    ['firma', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, firma: m } }), S.firma],
    ['eposta', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, eposta: m } }), S.eposta],
    ['il', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, il: m } }), S.il],
    ['adres', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, adres: m } }), S.adres],
    ['vergi', (m: string): Partial<MagazaTalepGirdisi> => ({ musteri: { ...govde().musteri, vergi: m } }), S.vergi],
    ['not', (m: string): Partial<MagazaTalepGirdisi> => ({ not: m }), S.not],
    ['kalem.ad', (m: string): Partial<MagazaTalepGirdisi> => ({ kalemler: [{ ad: m, adet: 1 }] }), S.kalemAd],
    ['kalem.sku', (m: string): Partial<MagazaTalepGirdisi> => ({ kalemler: [{ ad: 'a', sku: m, adet: 1 }] }), S.kalemSku],
    ['kalem.id', (m: string): Partial<MagazaTalepGirdisi> => ({ kalemler: [{ ad: 'a', id: m, adet: 1 }] }), S.kalemId],
    ['kalem.marka', (m: string): Partial<MagazaTalepGirdisi> => ({ kalemler: [{ ad: 'a', marka: m, adet: 1 }] }), S.kalemMarka],
  ])('%s: TAM sınırda kırpılmaz (alan yok), bir fazlasında kırpılır', (_ad, kur, sinir) => {
    expect('kirpildi' in esle(govde(kur('a'.repeat(sinir)))).belge).toBe(false);
    expect(esle(govde(kur('a'.repeat(sinir + 1)))).belge.kirpildi).toBe(true);
  });
  it('hiçbir alan aşmıyorsa `kirpildi` alanı HİÇ yazılmaz (false değil)', () => {
    const { belge } = esle(govde());
    expect('kirpildi' in belge).toBe(false);
  });
  it('kesim vekil çiftini BÖLMEZ: sınıra denk gelen çiftin tamamı dışarıda kalır', () => {
    const { belge } = esle(govde({ musteri: { ...govde().musteri, ad: `${'a'.repeat(199)}${YUZ}b` } }));
    expect(belge.musteri.ad).toBe('a'.repeat(199));
    expect(belge.musteri.ad.isWellFormed()).toBe(true);
    expect(belge.kirpildi).toBe(true);
  });
  it('çift sınıra TAM sığıyorsa korunur', () => {
    const { belge } = esle(govde({ musteri: { ...govde().musteri, ad: `${'a'.repeat(198)}${YUZ}bbb` } }));
    expect(belge.musteri.ad).toBe(`${'a'.repeat(198)}${YUZ}`);
    expect(belge.musteri.ad).toHaveLength(200);
  });
  it('kırpma boşluk atıldıktan SONRA ölçülür (sondaki boşluk aşım sayılmaz)', () => {
    const { belge } = esle(govde({ musteri: { ...govde().musteri, il: `  ${'a'.repeat(80)}   ` } }));
    expect(belge.musteri.il).toBe('a'.repeat(80));
    expect('kirpildi' in belge).toBe(false);
  });
});

describe('denetim karakteri temizliği', () => {
  it('U+0000 ve diğer C0 / C1 denetim karakterleri atılır (DEL dâhil)', () => {
    const kirli = `Ah${NUL}met${ZIL}${ESC}${DEL}${C1_ILK}${C1_SON} Yıl${NUL}maz`;
    expect(magazaMetniTemizle(kirli, false)).toBe('Ahmet Yılmaz');
    expect(magazaMetniTemizle(kirli, true)).toBe('Ahmet Yılmaz');
  });
  it('C0 / C1 aralığının TAMAMI: tek satırlıda hiçbiri kalmaz', () => {
    const hepsi = [...Array.from({ length: 0x20 }, (_, i) => i), ...Array.from({ length: 0x21 }, (_, i) => 0x7F + i)];
    const temiz = magazaMetniTemizle(`a${hepsi.map(n => k(n)).join('x')}b`, false);
    expect([...temiz].filter(c => { const n = c.charCodeAt(0); return n < 0x20 || (n >= 0x7F && n <= 0x9F); })).toEqual([]);
  });
  it('C0 / C1 aralığının TAMAMI: çok satırlıda yalnız satır sonu (U+000A) ve sekme (U+0009) kalır', () => {
    const hepsi = [...Array.from({ length: 0x20 }, (_, i) => i), ...Array.from({ length: 0x21 }, (_, i) => 0x7F + i)];
    const temiz = magazaMetniTemizle(`a${hepsi.map(n => k(n)).join('x')}b`, true);
    const kalan = new Set([...temiz].map(c => c.charCodeAt(0)).filter(n => n < 0x20 || (n >= 0x7F && n <= 0x9F)));
    expect([...kalan].sort((a, b) => a - b)).toEqual([0x09, 0x0A]);
  });
  it('tek satırlık alan: satır sonu / sekme BOŞLUĞA çevrilir; CRLF TEK boşluk', () => {
    expect(magazaMetniTemizle('Kadıköy\r\nİstanbul', false)).toBe('Kadıköy İstanbul');
    expect(magazaMetniTemizle('a\nb\rc\td', false)).toBe('a b c d');
    expect(magazaMetniTemizle(`a${VT}b${FF}c${NEL}d`, false)).toBe('a b c d');
  });
  it('U+2028 / U+2029 tek satırlık alanda satır ayırıcı sayılır → boşluk', () => {
    expect(magazaMetniTemizle(`İzmir${LS}Bornova${PS}Merkez`, false)).toBe('İzmir Bornova Merkez');
  });
  it('çok satırlı alan: yalnız `\\n` ve sekme kalır; CRLF / CR / U+2028 / U+2029 / NEL → tek `\\n`', () => {
    expect(magazaMetniTemizle('1. satır\r\n2. satır\r3. satır\n\tgirintili', true)).toBe('1. satır\n2. satır\n3. satır\n\tgirintili');
    expect(magazaMetniTemizle(`a${LS}b${PS}c${NEL}d${VT}e${FF}f`, true)).toBe('a\nb\nc\nd\ne\nf');
    expect(magazaMetniTemizle(`a${NUL}\r\n${ESC}b`, true)).toBe('a\nb');
  });
  it('eşi olmayan vekil U+FFFD olur (toWellFormed); geçerli çift korunur', () => {
    expect(magazaMetniTemizle(`a${UST_VEKIL}b`, false)).toBe(`a${YER_TUTUCU}b`);
    expect(magazaMetniTemizle(`a${ALT_VEKIL}b`, true)).toBe(`a${YER_TUTUCU}b`);
    expect(magazaMetniTemizle(`a${YUZ}b`, false)).toBe(`a${YUZ}b`);
  });
  it('baştaki / sondaki boşluk atılır; içteki boşluk korunur', () => {
    expect(magazaMetniTemizle('  Ali   Veli \t', false)).toBe('Ali   Veli');
    expect(magazaMetniTemizle('\n\n satır \n', true)).toBe('satır');
  });
  it('doküman: adres ve not ÇOK satırlı, diğer bütün metinler TEK satırlı', () => {
    const kirli = `x${NUL}\r\ny${LS}z\tw`;
    const { belge } = esle(govde({
      musteri: { ad: kirli, firma: kirli, telefon: `0532${NUL} 123\n45 67`, eposta: kirli, il: kirli, adres: kirli, vergi: kirli },
      not: kirli,
      kalemler: [{ id: kirli, sku: kirli, ad: kirli, marka: kirli, adet: 1 }],
    }));
    const tek = 'x y z w', cok = 'x\ny\nz\tw';
    expect(belge.musteri).toEqual({ ad: tek, firma: tek, telefon: '0532 123 45 67', eposta: tek, il: tek, adres: cok, vergi: tek });
    expect(belge.not).toBe(cok);
    expect(belge.kalemler[0]).toMatchObject({ id: tek, sku: tek, ad: tek, marka: tek });
  });
  it('jsonb güvenliği: yazılacak JSON metninde U+0000 kaçışı ve eşsiz vekil kaçışı YOK', () => {
    const { belge } = esle(govde({
      musteri: { ...govde().musteri, ad: `A${NUL}li${UST_VEKIL}`, adres: `Sokak${NUL}${ALT_VEKIL}` },
      not: `${NUL}not${UST_VEKIL}`,
      kalemler: [{ ad: `boya${NUL}${UST_VEKIL}`, sku: `S${NUL}1`, adet: 1 }],
    }));
    const json = JSON.stringify(belge);
    expect(json).not.toMatch(/\\u0000/);
    expect(json).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(json.isWellFormed()).toBe(true);
  });
});

describe('Türkçe harfler AYNEN', () => {
  it('büyük / küçük harf, noktalı / noktasız i, şapkalı harfler değişmez', () => {
    const metin = 'ÇĞIİÖŞÜ çğıiöşü — IĞDIR, İSTANBUL, Şişli, kâğıt, Ümraniye';
    expect(magazaMetniTemizle(metin, false)).toBe(metin);
    expect(magazaMetniTemizle(metin, true)).toBe(metin);
  });
  it('`normalize` yok: ayrışık yazım (I + U+0307) birleştirilmez, bileşik yazım ayrıştırılmaz', () => {
    const ayrisik = `I${BIRLESIK_NOKTA}stanbul`;
    expect(magazaMetniTemizle(ayrisik, false)).toBe(ayrisik);
    expect(magazaMetniTemizle(ayrisik, false)).toHaveLength(ayrisik.length);
    expect(magazaMetniTemizle('İstanbul', false)).toHaveLength(8);
  });
  it('doküman alanlarında da aynen', () => {
    const { belge } = esle(govde());
    expect(belge.musteri.ad).toBe('Şükrü Ağaoğlu');
    expect(belge.musteri.firma).toBe('Iğdır Yapı');
    expect(belge.musteri.il).toBe('İstanbul');
    expect(belge.musteri.adres).toBe('Çiçek Sk. No: 4\nKadıköy');
    expect(belge.not).toBe('Öğleden sonra arayın.');
    expect(belge.kalemler[0].ad).toBe('İç cephe boyası 15 L');
  });
});

describe('fiyat ve toplamlar — bilinmeyen = null, 0 DEĞİL', () => {
  it('`birimFiyat` yok → `talepFiyat: null`; null → null', () => {
    const { belge } = esle(govde({ kalemler: [{ ad: 'fiyatsız', adet: 1 }, { ad: 'null fiyatlı', adet: 1, birimFiyat: null }] }));
    expect(belge.kalemler.map(x => x.talepFiyat)).toEqual([null, null]);
    expect(belge.kalemler.map(x => x.talepFiyat)).not.toContain(0);
  });
  it('gerçek fiyat aynen; gerçek SIFIR sıfır kalır (null olmaz)', () => {
    const { belge } = esle(govde({ kalemler: [{ ad: 'a', adet: 1, birimFiyat: 204.99 }, { ad: 'numune', adet: 1, birimFiyat: 0 }] }));
    expect(belge.kalemler.map(x => x.talepFiyat)).toEqual([204.99, 0]);
    expect(belge.fiyatiSorulacakVar).toBe(false);
  });
  it('toplamlar gönderilmediyse `null`; gönderildiyse aynen (0 dâhil)', () => {
    expect(esle(govde({ araToplam: undefined, kdv: undefined, toplam: undefined })).belge.talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });
    expect(esle(govde({ araToplam: 529.97, kdv: 105.99, toplam: 635.96 })).belge.talepEdilen).toEqual({ araToplam: 529.97, kdv: 105.99, toplam: 635.96 });
    expect(esle(govde({ araToplam: 0, kdv: undefined, toplam: 0 })).belge.talepEdilen).toEqual({ araToplam: 0, kdv: null, toplam: 0 });
  });
  it('`fiyatiSorulacakVar` kalemlerden türetilir: herhangi bir `talepFiyat === null`', () => {
    expect(esle(govde()).belge.fiyatiSorulacakVar).toBe(true);
    expect(esle(govde({ kalemler: [{ ad: 'a', adet: 1, birimFiyat: 10 }, { ad: 'b', adet: 2, birimFiyat: 0 }] })).belge.fiyatiSorulacakVar).toBe(false);
    expect(esle(govde({ kalemler: [{ ad: 'a', adet: 1, birimFiyat: 10 }, { ad: 'b', adet: 2 }] })).belge.fiyatiSorulacakVar).toBe(true);
  });
  it('istemcinin gönderdiği `fiyatiSorulacakVar` ALINMAZ (şema siler, eşleyici türetir)', () => {
    const ham = { ...govde({ kalemler: [{ ad: 'a', adet: 1, birimFiyat: 10 }] }), fiyatiSorulacakVar: true };
    const p = MagazaSiparisTalebiSchema.safeParse(ham);
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect('fiyatiSorulacakVar' in p.data).toBe(false);
    expect(esle(p.data).belge.fiyatiSorulacakVar).toBe(false);
  });
  it('`tedarik` yoksa false; yalnız `true` doğru sayılır', () => {
    const { belge } = esle(govde({ kalemler: [{ ad: 'a', adet: 1 }, { ad: 'b', adet: 1, tedarik: true }, { ad: 'c', adet: 1, tedarik: false }] }));
    expect(belge.kalemler.map(x => x.tedarik)).toEqual([false, true, false]);
  });
  it('adet aynen; üst sınır YOK (kullanıcı kararı K4)', () => {
    const { belge } = esle(govde({ kalemler: [{ ad: 'a', adet: 1 }, { ad: 'b', adet: 250_000 }, { ad: 'c', adet: Number.MAX_SAFE_INTEGER }] }));
    expect(belge.kalemler.map(x => x.adet)).toEqual([1, 250_000, Number.MAX_SAFE_INTEGER]);
  });
});

describe('doküman biçimi', () => {
  it('alanlar ve sıra ortak sözleşmedeki gibi; durum `yeni`, bildirim `bekliyor`', () => {
    const { belge } = esle(govde());
    expect(Object.keys(belge)).toEqual(['companyId', 'talepNo', 'durum', 'olusturma', 'istemciTarihi', 'musteri', 'telefonSon10', 'not', 'kalemler', 'talepEdilen', 'fiyatiSorulacakVar', 'bildirim']);
    expect(belge).toEqual({
      companyId: 'kiraci-1',
      talepNo: 'T261008-5Y9P',
      durum: 'yeni',
      olusturma: '2026-10-08T09:15:30.123Z',
      istemciTarihi: '2026-10-08T09:15:00.000Z',
      musteri: { ad: 'Şükrü Ağaoğlu', firma: 'Iğdır Yapı', telefon: '+90 (532) 123 45 67', eposta: 'sukru@ornek.com.tr', il: 'İstanbul', adres: 'Çiçek Sk. No: 4\nKadıköy', vergi: '1234567890' },
      telefonSon10: '5321234567',
      not: 'Öğleden sonra arayın.',
      kalemler: [
        { id: 'u-1', sku: 'DYO-0001', ad: 'İç cephe boyası 15 L', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
        { id: 'u-2', sku: 'KRB-77', ad: 'Fayans yapıştırıcısı', marka: 'Karbosan', adet: 5, talepFiyat: null, tedarik: true },
      ],
      talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 },
      fiyatiSorulacakVar: true,
      bildirim: { durum: 'bekliyor', zaman: '2026-10-08T09:15:30.123Z' },
    });
  });
  it('kırpılan dokümanda `kirpildi` bildirimden ÖNCE gelir; kalemde `birimFiyat` alanı YOK (yalnız `talepFiyat`)', () => {
    const { belge } = esle(govde({ not: 'n'.repeat(1001) }));
    expect(Object.keys(belge)).toEqual(['companyId', 'talepNo', 'durum', 'olusturma', 'istemciTarihi', 'musteri', 'telefonSon10', 'not', 'kalemler', 'talepEdilen', 'fiyatiSorulacakVar', 'kirpildi', 'bildirim']);
    expect(Object.keys(belge.kalemler[0])).toEqual(['id', 'sku', 'ad', 'marka', 'adet', 'talepFiyat', 'tedarik']);
  });
  it('zaman alanları bağlamdaki saatten: UTC, ISO-8601 METİN (nöbetçi nesne değil); `olusturma` = `bildirim.zaman`', () => {
    const { belge } = esle(govde(), { companyId: 'kiraci-1', simdi: new Date('2026-12-31T21:00:00.000Z') });
    expect(belge.olusturma).toBe('2026-12-31T21:00:00.000Z');
    expect(typeof belge.olusturma).toBe('string');
    expect(belge.bildirim).toEqual({ durum: 'bekliyor', zaman: '2026-12-31T21:00:00.000Z' });
  });
  it('isteğe bağlı metinler yoksa BOŞ DİZGE (undefined / null değil)', () => {
    const { belge } = esle({ no: 'T261008-AAAA', musteri: { ad: 'Ali', telefon: '05321234567' }, kalemler: [{ ad: 'boya', adet: 1 }] });
    expect(belge.musteri).toEqual({ ad: 'Ali', firma: '', telefon: '05321234567', eposta: '', il: '', adres: '', vergi: '' });
    expect(belge.not).toBe('');
    expect(belge.kalemler[0]).toEqual({ id: '', sku: '', ad: 'boya', marka: '', adet: 1, talepFiyat: null, tedarik: false });
    expect(belge.istemciTarihi).toBeNull();
    expect(belge.talepEdilen).toEqual({ araToplam: null, kdv: null, toplam: null });
  });
  it('JSON gidiş-dönüşünde aynı kalır (jsonb\'ye yazılan = akışa giden)', () => {
    const { belge } = esle(govde());
    expect(JSON.parse(JSON.stringify(belge))).toEqual(belge);
  });
});

describe('istemci tarihi — çözülemezse null', () => {
  const tarihle = (tarih: string | undefined) => esle(govde({ tarih })).belge.istemciTarihi;
  it('saat dilimli ISO-8601 → UTC ISO metni', () => {
    expect(tarihle('2026-10-08T09:15:00.000Z')).toBe('2026-10-08T09:15:00.000Z');
    expect(tarihle('2026-10-08T12:15:00+03:00')).toBe('2026-10-08T09:15:00.000Z');
    expect(tarihle('  2026-10-08T09:15Z ')).toBe('2026-10-08T09:15:00.000Z');
  });
  it.each([
    ['yok', undefined], ['boş', ''], ['serbest metin', 'dün akşam'], ['gevşek sayı', '1'], ['yalnız yıl', '2026'],
    ['saat dilimsiz', '2026-10-08T09:15:00'], ['yalnız tarih', '2026-10-08'], ['olmayan ay', '2026-13-08T09:15:00Z'],
    ['sayısal damga', '1791450900000'], ['RFC 2822', 'Thu, 08 Oct 2026 09:15:00 GMT'],
  ])('%s → null', (_ad, deger) => {
    expect(tarihle(deger)).toBeNull();
  });
});

describe('ret — `ok: false` (rota sabit 400 döner)', () => {
  const m = govde().musteri;
  it('ad temizlikten sonra boş', () => {
    for (const ad of ['', '   ', '\t\n', `${NUL}${ESC}`, ` ${LS} ${PS} `]) {
      expect(reddedildi(talepEsle(govde({ musteri: { ...m, ad } }), BAGLAM)), JSON.stringify(ad)).toBe(true);
    }
  });
  it('telefonda 10 rakam yok', () => {
    for (const telefon of ['', '532 123 45 6', 'aranmasın', '+90']) {
      expect(reddedildi(talepEsle(govde({ musteri: { ...m, telefon } }), BAGLAM)), telefon).toBe(true);
    }
  });
  it('kalem adı temizlikten sonra boş (tek kalem bile)', () => {
    expect(reddedildi(talepEsle(govde({ kalemler: [{ ad: 'boya', adet: 1 }, { ad: ` ${NUL} `, adet: 1 }] }), BAGLAM))).toBe(true);
  });
  it('kalem yok', () => {
    expect(reddedildi(talepEsle(govde({ kalemler: [] }), BAGLAM))).toBe(true);
  });
  it('talep no desene uymuyor (kimlik formülünün ayracı talep no\'ya güvenir)', () => {
    for (const no of ['', 'T261008-5y9p', 'T261008-5Y9P|x', 'X261008-5Y9P', 'T261008-5Y9PA', ' T261008-5Y9P']) {
      expect(reddedildi(talepEsle(govde({ no }), BAGLAM)), no).toBe(true);
    }
  });
  it('adet güvenli pozitif tam sayı değil (eşleyici şemasız çağrılsa bile)', () => {
    for (const adet of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(reddedildi(talepEsle(govde({ kalemler: [{ ad: 'a', adet }] }), BAGLAM)), String(adet)).toBe(true);
    }
  });
  it('fiyat / toplam sonlu ve eksi olmayan sayı değil → ret (NaN sessizce «fiyat sorulacak»a dönmez)', () => {
    for (const birimFiyat of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reddedildi(talepEsle(govde({ kalemler: [{ ad: 'a', adet: 1, birimFiyat }] }), BAGLAM)), String(birimFiyat)).toBe(true);
    }
    expect(reddedildi(talepEsle(govde({ toplam: Number.NaN }), BAGLAM))).toBe(true);
    expect(reddedildi(talepEsle(govde({ kdv: -1 }), BAGLAM))).toBe(true);
    expect(reddedildi(talepEsle(govde({ araToplam: Number.POSITIVE_INFINITY }), BAGLAM))).toBe(true);
  });
  it('kiracı kimliği boşsa FIRLATIR (çağıran hatası; kiracısız doküman üretilmez)', () => {
    expect(() => talepEsle(govde(), { companyId: '', simdi: SIMDI })).toThrow(/kiracı/);
    expect(() => talepEsle(govde(), { companyId: '   ', simdi: SIMDI })).toThrow(/kiracı/);
  });
});

describe('MagazaSiparisTalebiSchema', () => {
  const gecer = (v: unknown): boolean => MagazaSiparisTalebiSchema.safeParse(v).success;
  const ornek = () => JSON.parse(JSON.stringify(govde())) as Record<string, unknown> & { musteri: Record<string, unknown>; kalemler: Array<Record<string, unknown>> };

  // Derleme zamanı kanıtı: şema çıktısı eşleyici girdisine ATANABİLİR. Ayrışırsa `npx tsc --noEmit` bu satırda kırılır
  // (vitest tip denetlemez; kanıtı derleyici taşır, aşağıdaki test çalışma anındaki karşılığıdır).
  const atanabilir = (v: z.infer<typeof MagazaSiparisTalebiSchema>): MagazaTalepGirdisi => v;

  it('mağazanın gönderdiği gövde geçer ve eşleyiciye doğrudan verilebilir', () => {
    const p = MagazaSiparisTalebiSchema.safeParse({ ...ornek(), fiyatiSorulacakVar: true });
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect(talepEsle(atanabilir(p.data), BAGLAM).ok).toBe(true);
  });
  it('`no` zorunlu ve desenli; desen ortak sözleşmeyle AYNI (kaynakta birebir)', () => {
    expect(gecer({ ...ornek(), no: undefined })).toBe(false);
    for (const no of ['T261008-5y9p', 'T26100-5Y9P', 'T261008-5Y9P\n', 'T261008_5Y9P', 12]) expect(gecer({ ...ornek(), no }), String(no)).toBe(false);
    const semaKaynagi = readFileSync(join(SRC_KOK, 'server', 'schemas.ts'), 'utf8');
    expect(semaKaynagi).toContain(`no:      z.string().regex(${String(MAGAZA_TALEP_NO_DESENI)}),`);
  });
  it('metinlerde `.max()` YOK: 60 KB\'lık metin şemadan GEÇER (kırpma eşleyicide)', () => {
    const dev = 'ğ'.repeat(30_000);
    const o = ornek();
    expect(gecer({ ...o, not: dev, musteri: { ...o.musteri, ad: dev, adres: dev }, kalemler: [{ ad: dev, sku: dev, adet: 1 }] })).toBe(true);
  });
  it('mağaza şemasının kaynağında `.max(` ve `.default(` geçmez', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'server', 'schemas.ts')).map(s => s.kod);
    const bas = satirlar.findIndex(s => s.includes('export const MagazaSiparisTalebiSchema'));
    expect(bas).toBeGreaterThan(-1);
    const son = satirlar.findIndex((s, i) => i > bas && s === '});');
    const blok = satirlar.slice(bas, son + 1).join('\n');
    expect(blok).toContain('kalemler');
    expect(blok).not.toMatch(/\.max\(|\.default\(|\.catch\(|\.coerce|\.transform\(/);
  });
  it('isteğe bağlı metinler yoksa da geçer; `ad` / `telefon` / kalem `ad` zorunlu', () => {
    expect(gecer({ no: 'T261008-5Y9P', musteri: { ad: 'Ali', telefon: '05321234567' }, kalemler: [{ ad: 'boya', adet: 1 }] })).toBe(true);
    expect(gecer({ no: 'T261008-5Y9P', musteri: { telefon: '05321234567' }, kalemler: [{ ad: 'boya', adet: 1 }] })).toBe(false);
    expect(gecer({ no: 'T261008-5Y9P', musteri: { ad: 'Ali' }, kalemler: [{ ad: 'boya', adet: 1 }] })).toBe(false);
    expect(gecer({ no: 'T261008-5Y9P', musteri: { ad: 'Ali', telefon: '05321234567' }, kalemler: [{ adet: 1 }] })).toBe(false);
    expect(gecer({ no: 'T261008-5Y9P', kalemler: [{ ad: 'boya', adet: 1 }] })).toBe(false);
  });
  it('metin alanına metin dışı değer → ret (sayı / null / nesne dizgeye ÇEVRİLMEZ)', () => {
    const o = ornek();
    expect(gecer({ ...o, musteri: { ...o.musteri, telefon: 5321234567 } })).toBe(false);
    expect(gecer({ ...o, musteri: { ...o.musteri, firma: null } })).toBe(false);
    expect(gecer({ ...o, not: { a: 1 } })).toBe(false);
  });
  it('`kalemler` en az 1', () => {
    expect(gecer({ ...ornek(), kalemler: [] })).toBe(false);
    expect(gecer({ ...ornek(), kalemler: undefined })).toBe(false);
  });
  it('`adet` pozitif TAM sayı; üst sınır YOK; güvenli tam sayı dışı ret', () => {
    const adetle = (adet: unknown) => gecer({ ...ornek(), kalemler: [{ ad: 'a', adet }] });
    expect(adetle(1)).toBe(true);
    expect(adetle(1_000_000_000)).toBe(true);
    expect(adetle(Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const adet of [0, -3, 2.5, '2', null, undefined, 2 ** 53, JSON.parse('1e999') as number]) expect(adetle(adet), String(adet)).toBe(false);
  });
  it('`birimFiyat` yok / null geçer ve ÇIKTIDA da yok / null kalır (varsayılan yazılmaz)', () => {
    const p = MagazaSiparisTalebiSchema.safeParse({ ...ornek(), kalemler: [{ ad: 'a', adet: 1 }, { ad: 'b', adet: 1, birimFiyat: null }, { ad: 'c', adet: 1, birimFiyat: 0 }] });
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect('birimFiyat' in p.data.kalemler[0]).toBe(false);
    expect(p.data.kalemler[1].birimFiyat).toBeNull();
    expect(p.data.kalemler[2].birimFiyat).toBe(0);
  });
  it('`birimFiyat` eksi / metin / sonsuz → ret', () => {
    for (const birimFiyat of [-1, '204.99', JSON.parse('1e999') as number]) expect(gecer({ ...ornek(), kalemler: [{ ad: 'a', adet: 1, birimFiyat }] }), String(birimFiyat)).toBe(false);
  });
  it('toplamlar isteğe bağlı ve eksi olamaz; yoksa çıktıda da YOK (0 yazılmaz)', () => {
    const o = ornek();
    delete o.araToplam; delete o.kdv; delete o.toplam;
    const p = MagazaSiparisTalebiSchema.safeParse(o);
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect('araToplam' in p.data || 'kdv' in p.data || 'toplam' in p.data).toBe(false);
    expect(gecer({ ...ornek(), toplam: -0.01 })).toBe(false);
    expect(gecer({ ...ornek(), kdv: '105.99' })).toBe(false);
    expect(gecer({ ...ornek(), araToplam: null })).toBe(false);
  });
  it('`tedarik` boole olmalı; yoksa geçer', () => {
    expect(gecer({ ...ornek(), kalemler: [{ ad: 'a', adet: 1, tedarik: 'evet' }] })).toBe(false);
    expect(gecer({ ...ornek(), kalemler: [{ ad: 'a', adet: 1 }] })).toBe(true);
  });
  it('bilinmeyen alanlar SİLİNİR (companyId / durum / bildirim istemciden alınamaz)', () => {
    const p = MagazaSiparisTalebiSchema.safeParse({ ...ornek(), companyId: 'baska-kiraci', durum: 'teyit', bildirim: { durum: 'gitti' }, kirpildi: false, telefonSon10: '0000000000' });
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect(Object.keys(p.data).sort()).toEqual(['araToplam', 'kalemler', 'kdv', 'musteri', 'no', 'not', 'tarih', 'toplam']);
    const { belge } = esle(p.data);
    expect(belge.companyId).toBe('kiraci-1');
    expect(belge.durum).toBe('yeni');
    expect(belge.bildirim.durum).toBe('bekliyor');
    expect(belge.telefonSon10).toBe('5321234567');
  });
  it('nesne olmayan gövde → ret', () => {
    for (const v of [undefined, null, 'metin', 42, [], [ornek()]]) expect(gecer(v), JSON.stringify(v)).toBe(false);
  });
});

describe('kaynak çiti — eşleyici SAF ve harfe dokunmaz', () => {
  const yol = join(SRC_KOK, 'server', 'kanal', 'magazaTalep.ts');
  const kod = kodSatirlari(yol).map(s => s.kod).join('\n');
  it('Türkçe harfe dokunan dönüşüm YOK', () => {
    expect(kod).not.toMatch(/toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase|\.normalize\(|localeCompare/);
  });
  it('saat, ağ, veritabanı, ortam OKUNMAZ (saat ve kiracı bağlamla gelir)', () => {
    expect(kod).not.toMatch(/Date\.now\(|new Date\(\)|process\.env|fetch\(|console\./);
    expect(kod.match(/^import .*$/gm)).toEqual([
      "import { createHash } from 'node:crypto';",
      "import { MAGAZA_TALEP_NO_DESENI } from '../../lib/magazaTalep.js';",
      "import type { MagazaTalebi, MagazaTalepKalemi } from '../../lib/magazaTalep.js';",
    ]);
  });
  it('sayısal alanda sessiz varsayılan yok (`?? 0` / `|| 0`)', () => {
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
  });
  it('denetim karakteri desenleri KAÇIŞLA yazılı: kaynakta ham denetim karakteri / satır ayırıcı yok', () => {
    const ham = readFileSync(yol, 'utf8');
    const suclu = [...ham].map(c => c.charCodeAt(0)).filter(n => (n < 0x20 && n !== 0x0A) || (n >= 0x7F && n <= 0x9F) || n === 0x2028 || n === 0x2029 || n === 0x0307);
    expect(suclu).toEqual([]);
    expect(ham).toContain(String.raw`/\r\n|[\n\r\u000B\u000C\u0085` + String.raw`\u` + '2028' + String.raw`\u` + '2029]/g');
    expect(ham).toContain(String.raw`/[\u0000-\u001F\u007F-\u009F]/g`);
    expect(ham).toContain(String.raw`/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g`);
  });
});
