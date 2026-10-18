/**
 * faturaBekletme.test.ts — bağ ve bekletme kararlarının SAF testleri (şartname «fatura gövde + gece MF» § 8 H1 / H4, § 9.A A2–A7,
 * § 9.B B3; 2026-10-19). Rota bağlaması: routes/mikroRoutes.eslemeFatura.test.ts («H1»); gerçek zincir: server/faturaCiftKesim
 * .zincir.test.ts («B6») ve server/geceFaturadanSiparis.zincir.test.ts (gece).
 */
import { describe, it, expect } from 'vitest';
import { bekletmeKarari, cariAnahtari, cetpaBaglariniKur, talepSiniri } from './faturaBekletme';
import { FATURA_GONDERIM_ALANI } from '../../lib/faturaGonderimi';

const ad = (o: Record<string, unknown>) => String(o.orderNumber ?? o.id);
const SIMDI = new Date('2026-10-19T09:00:00.000Z');
const isaret = (durum: string, ek: Record<string, unknown> = {}) =>
  ({ [FATURA_GONDERIM_ALANI]: { durum, istekNo: 'i', zaman: '2026-10-18T09:00:00.000Z', kim: 'k@example.test', ...ek } });
const sip = (id: string, ek: Record<string, unknown> = {}) => ({ id, orderNumber: `SIP-${id}`, companyId: 'A', ...ek });
const kur = (s: Array<Record<string, unknown>>, bekletme = true) => cetpaBaglariniKur(s, ad, { bekletme, simdi: SIMDI });

describe('talepSiniri (A2) — faturaTarihi → zaman\'ın İstanbul günü → sınırsız', () => {
  it('işarette `faturaTarihi` varsa sınır odur (GG.AA.YYYY → YYYY-AA-GG metin), `zaman` okunmaz', () => {
    expect(talepSiniri({ faturaTarihi: '15.10.2026', zaman: '2026-10-19T09:00:00.000Z' })).toBe('2026-10-15');
  });
  it('yoksa `zaman`\'ın İSTANBUL günü — UTC 22:30 İstanbul\'da ertesi gün (gün kaydırması yok)', () => {
    expect(talepSiniri({ zaman: '2026-10-17T22:30:00.000Z' })).toBe('2026-10-18');
    expect(talepSiniri({ zaman: '2026-10-17T20:59:59.000Z' })).toBe('2026-10-17');
  });
  it('okunamayan `zaman` (\'\', \'dün\') fırlatmaz → `null` (sınırsız)', () => {
    expect(talepSiniri({ zaman: '' })).toBeNull();
    expect(talepSiniri({ zaman: 'dün' })).toBeNull();
  });
});

describe('cariAnahtari — iki tarafta aynı: kırp + Türkçe büyük harf', () => {
  it('küçük / büyük harf ve boşluk farkı tutar; `i` → `İ` (Türkçe kural)', () => {
    expect(cariAnahtari(' 120.01.0042 ')).toBe('120.01.0042');
    expect(cariAnahtari('cetpa-i')).toBe(cariAnahtari('CETPA-İ'));
    expect(cariAnahtari(undefined)).toBe('');
    expect(cariAnahtari({})).toBe('');
  });
});

describe('cetpaBaglariniKur — kümeler (A3: işaret `faturaIsareti` ile; `hasInvoice` OKUNMAZ)', () => {
  it('bekletme (a): `gonderiliyor` (taze ya da bayat) ve `belirsiz`; (b): `gonderildi` + ETTN yok / sıfır / biçimsiz', () => {
    const b = kur([
      sip('a1', isaret('gonderiliyor', { cariKod: '120.01' })),
      sip('a2', isaret('belirsiz', { cariKod: '120.02' })),
      sip('b1', { ...isaret('gonderildi', { cariKod: '120.03' }) }),
      sip('b2', { ...isaret('gonderildi', { cariKod: '120.04' }), ettn: '00000000-0000-0000-0000-000000000000' }),
      sip('b3', { ...isaret('gonderildi', { cariKod: '120.05' }), ettn: 'abcdef123-456-7890-abcd-ef1234567890' }),
      sip('g1', { ...isaret('gonderildi', { cariKod: '120.06' }), ettn: '{ABCDEF12-3456-7890-ABCD-EF1234567890}' }),
      sip('r1', isaret('reddedildi', { cariKod: '120.07' })),
    ]);
    expect([...b.cariler.keys()]).toEqual(['120.01', '120.02', '120.03', '120.04', '120.05']);
    expect(b.carisiBilinmeyen).toBeNull();
    expect([...b.ettnler.entries()]).toEqual([['abcdef12-3456-7890-abcd-ef1234567890', { cariKod: '120.06', siparis: 'SIP-g1' }]]);
  });
  it('H1 (b) `hasInvoice`\'a BAKMAZ: `hasInvoice` alanı olmayan `gonderildi` + sıfır ETTN de bekletir', () => {
    const b = kur([sip('b', { ...isaret('gonderildi', { cariKod: '120.01' }), ettn: '00000000-0000-0000-0000-000000000000' })]);
    expect(b.cariler.get('120.01')).toEqual({ sinir: '2026-10-18', siparisler: ['SIP-b'] });
  });
  it('işaretsiz eski `hasInvoice: true` + sıfır / boş ETTN bekletmeye GİRMEZ, yalnız «ETTN\'siz» (H4)', () => {
    const b = kur([sip('e1', { hasInvoice: true, ettn: '00000000-0000-0000-0000-000000000000' }), sip('e2', { hasInvoice: true })]);
    expect(b.cariler.size).toBe(0);
    expect(b.carisiBilinmeyen).toBeNull();
    expect(b.ettnler.size).toBe(0);
    expect(b.ettnsizFaturali).toEqual(['SIP-e1', 'SIP-e2']);
  });
  it('`source: mikro-fatura` hiçbir kümeye girmez', () => {
    const b = kur([sip('m', { source: 'mikro-fatura', ...isaret('belirsiz'), ettn: 'abcdef12-3456-7890-abcd-ef1234567890', hasInvoice: true })]);
    expect([b.cariler.size, b.carisiBilinmeyen, b.ettnler.size, b.ettnsizFaturali]).toEqual([0, null, 0, []]);
  });
  it('carisi bilinmeyen (işarette `cariKod` yok — eski kayıt) ayrı tutulur; aynı carinin EN ERKEN sınırı, `null` baskın', () => {
    const b = kur([
      sip('x', isaret('belirsiz')),
      sip('c1', isaret('belirsiz', { cariKod: '120.01', faturaTarihi: '16.10.2026' })),
      sip('c2', isaret('belirsiz', { cariKod: ' 120.01 ', faturaTarihi: '14.10.2026' })),
      sip('d1', isaret('belirsiz', { cariKod: '120.02', faturaTarihi: '14.10.2026' })),
      sip('d2', isaret('belirsiz', { cariKod: '120.02', zaman: 'dün' })),
    ]);
    expect(b.carisiBilinmeyen).toEqual({ sinir: '2026-10-18', siparisler: ['SIP-x'] });
    expect(b.cariler.get('120.01')).toEqual({ sinir: '2026-10-14', siparisler: ['SIP-c1', 'SIP-c2'] });
    expect(b.cariler.get('120.02')).toEqual({ sinir: null, siparisler: ['SIP-d1', 'SIP-d2'] });
  });
  it('kalem modunda (`bekletme: false`) bekletme kümeleri KURULMAZ (A5); G3a kümesi kurulur', () => {
    const b = kur([sip('a', isaret('belirsiz', { cariKod: '120.01' })), sip('g', { ettn: 'abcdef12-3456-7890-abcd-ef1234567890' })], false);
    expect([b.cariler.size, b.carisiBilinmeyen, b.ettnler.size]).toEqual([0, null, 1]);
  });
  it('A7 adayları: yalnız `gonderildi` + GEÇERLİ ETTN + sınır son 60 gün içinde', () => {
    const E = (n: number) => `abcdef12-3456-7890-abcd-${String(n).padStart(12, '0')}`;
    const b = kur([
      sip('y1', { ...isaret('gonderildi', { faturaTarihi: '20.08.2026' }), ettn: E(1) }),      // 60 gün içinde (sınır 2026-08-20)
      sip('y2', { ...isaret('gonderildi', { faturaTarihi: '19.08.2026' }), ettn: E(2) }),      // pencere dışı
      sip('y3', { ...isaret('gonderildi', { zaman: '' }), ettn: E(3) }),                        // sınır yok → sayılmaz
      sip('y4', { ettn: E(4) }),                                                                 // işaretsiz → sayılmaz
      sip('y5', { ...isaret('belirsiz'), ettn: E(5) }),                                          // gonderildi değil
    ]);
    expect(b.yakinGonderilen).toEqual([{ ettn: E(1), siparis: 'SIP-y1' }]);
  });
});

describe('bekletmeKarari — tarih sınırı METİNLE (`faturaGunu >= sinir`), güvenli yön', () => {
  const b = kur([sip('c', isaret('belirsiz', { cariKod: '120.01', faturaTarihi: '16.10.2026' }))]);
  it('aynı cari, sınır günü ve sonrası → bekletilir (neden `cari`, bekleten sipariş adıyla); önceki gün → türer', () => {
    expect(bekletmeKarari(b, '120.01', '2026-10-16')).toEqual({ neden: 'cari', siparisler: ['SIP-c'] });
    expect(bekletmeKarari(b, ' 120.01', '2026-10-17')).toMatchObject({ neden: 'cari' });
    expect(bekletmeKarari(b, '120.01', '2026-10-15')).toBeNull();
  });
  it('başka cari → türer', () => {
    expect(bekletmeKarari(b, '120.02', '2026-10-17')).toBeNull();
  });
  it('fatura günü okunamıyor (boş / biçim dışı) ve cari tutuyor → bekletilir; cari tutmuyorsa türer', () => {
    expect(bekletmeKarari(b, '120.01', null)).toMatchObject({ neden: 'cari' });
    expect(bekletmeKarari(b, '120.01', '17.10.2026')).toMatchObject({ neden: 'cari' });
    expect(bekletmeKarari(b, '120.02', null)).toBeNull();
  });
  it('fatura carisi BOŞ → kümedeki herhangi bir giriş tutunca bekletilir', () => {
    expect(bekletmeKarari(b, '', '2026-10-17')).toMatchObject({ neden: 'cari' });
    expect(bekletmeKarari(b, '', '2026-10-15')).toBeNull();
  });
  it('carisi bilinmeyen giriş → tarih koşulunu sağlayan TÜM faturalar (neden `carisiBilinmeyen`); sınırsızsa her tarih', () => {
    const x = kur([sip('x', isaret('belirsiz', { faturaTarihi: '16.10.2026' }))]);
    expect(bekletmeKarari(x, '120.99', '2026-10-16')).toEqual({ neden: 'carisiBilinmeyen', siparisler: ['SIP-x'] });
    expect(bekletmeKarari(x, '120.99', '2026-10-15')).toBeNull();
    const s = kur([sip('s', isaret('belirsiz', { zaman: 'dün' }))]);
    expect(bekletmeKarari(s, '120.99', '2020-01-01')).toMatchObject({ neden: 'carisiBilinmeyen' });
  });
  it('küme boşken hiçbir şey bekletilmez', () => {
    expect(bekletmeKarari(kur([]), '120.01', '2026-10-17')).toBeNull();
  });
});
