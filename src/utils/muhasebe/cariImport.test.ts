/**
 * cariImport.test.ts — AccountingModule "cariImport" grubunun hesap sözleşmesi. ÖNCE YAZILDI
 * (Faz 3 2/n, AccountingModule kapatma, 2026-09-14).
 *
 * Sahte kesinlik siteleri (AccountingModule.tsx + sekmeler):
 *  - 542  `Number(x.bakiye ?? 0) !== 0`                bakiyesi bilinmeyen cari "bakiyesiz" (doğru) ama 'abc'
 *                                                      gibi bozuk değer NaN !== 0 ile "bakiyeli" sayılıyordu
 *  - 854/876 `Number(x.bakiye ?? x.balance ?? 0)`      bakiyesi bilinmeyen Mikro carisi ₺0 bakiyeyle listeye giriyor,
 *                                                      "sıfır" rengiyle (gri) basılıp sıralamada ortaya diziliyordu
 *  - 875  `Number(x.creditLimit ?? 0)`                 limiti bilinmeyen müşteri "limit ₺0" görünüyordu
 *  - 1858/1933 `(a.balance || 0) - (b.balance || 0)`  bilinmeyen bakiye sıralamada ₺0 gibi ortaya
 *  - 1915 `balance: c.balance || 0`                    alış faturalı cari tedarikçiye taşınırken bilinmeyen bakiye ₺0 oluyordu
 *  - MusterilerTab 132 / TedarikcilerTab 135 `(c.balance || 0) > 0 ? kırmızı : < 0 ? yeşil : gri`
 *                                                      bilinmeyen bakiye "sıfır" rengiyle basılıyordu
 *  - MusterilerTab 159 `bakiye: c.balance || 0`        dekont önizlemesi "Mevcut bakiye ₺0" diyordu
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen bakiye 0 DEĞİL bilinmiyordur — durum
 * 'bilinmiyor', ekran '—', sıralamada SONA gider. İşaret: EKSİ = CETPA borçlu (hafıza notu, 2026-07-30).
 */
import { describe, it, expect } from 'vitest';
import {
  mikroCariOku, mikroCarileriAyir, bakiyeSayisi, bakiyeDurumu, bakiyeliCariKodlari,
  cariKarsilastirici, cariEslesir, musteridenTedarikci, cariKodu,
} from './cariImport';

type Veri = Record<string, unknown>;
const sirin = (ek: Veri = {}): Veri => ({
  name: 'Şirin İnşaat', company: 'Şirin İnşaat A.Ş.', email: 'muhasebe@sirin.com.tr', phone: '0212 555 11 22',
  address: 'Kağıthane/İstanbul', taxId: '1234567890', taxOffice: 'Kağıthane', notes: 'İnşaat malzemesi',
  bakiye: 15250.5, creditLimit: 50000, riskGroup: 'Orta', mikroCariKod: '120.01.001', createdAt: 'ts', ...ek,
});

describe('mikroCariOku — leads dokümanı → müşteri/tedarikçi (satır 838-900)', () => {
  it('type === "Supplier" tedarikçi, diğer her şey (yok/Customer/Lead) müşteri — sayfa ile birebir', () => {
    expect(mikroCariOku('a', sirin({ type: 'Supplier' })).rol).toBe('tedarikci');
    expect(mikroCariOku('b', sirin()).rol).toBe('musteri');
    expect(mikroCariOku('c', sirin({ type: 'Customer' })).rol).toBe('musteri');
    expect(mikroCariOku('d', sirin({ type: 'Lead' })).rol).toBe('musteri');
  });

  it('alan eşlemesi birebir: bilinen bakiye/limit sayı, riskGroup, cari kod, createdAt', () => {
    const s = mikroCariOku('L1', sirin());
    expect(s.rol).toBe('musteri');
    if (s.rol !== 'musteri') return;
    expect(s.kayit).toEqual({
      id: 'L1', name: 'Şirin İnşaat', company: 'Şirin İnşaat A.Ş.', email: 'muhasebe@sirin.com.tr',
      phone: '0212 555 11 22', address: 'Kağıthane/İstanbul', taxNo: '1234567890', taxOffice: 'Kağıthane',
      notes: 'İnşaat malzemesi', creditLimit: 50000, balance: 15250.5, riskGroup: 'Orta',
      mikroCariKod: '120.01.001', createdAt: 'ts',
    });
  });

  it('ad: name → company → "—"; vergi no: taxId → taxNo → ""; boş metinler ""', () => {
    const k1 = mikroCariOku('x', { company: 'Çelik Yapı Ltd.' }).kayit;
    expect(k1.name).toBe('Çelik Yapı Ltd.');
    expect(mikroCariOku('y', {}).kayit.name).toBe('—');
    expect(mikroCariOku('z', { name: '', company: '' }).kayit.name).toBe('—');
    expect(mikroCariOku('t', { taxNo: '987' }).kayit.taxNo).toBe('987');
    expect(mikroCariOku('t2', { taxId: '111', taxNo: '987' }).kayit.taxNo).toBe('111');
    const bos = mikroCariOku('b', {}).kayit;
    expect([bos.company, bos.email, bos.phone, bos.address, bos.taxNo, bos.taxOffice, bos.notes, bos.mikroCariKod])
      .toEqual(['', '', '', '', '', '', '', '']);
  });

  it('riskGroup yoksa/bozuksa "Düşük" (sayfa varsayılanı); geçerli değer aynen', () => {
    expect(mikroCariOku('a', {}).kayit.riskGroup).toBe('Düşük');
    expect(mikroCariOku('b', { riskGroup: 'çok yüksek' }).kayit.riskGroup).toBe('Düşük');
    expect(mikroCariOku('c', { riskGroup: 'Yüksek' }).kayit.riskGroup).toBe('Yüksek');
  });

  it('bakiye: bakiye → balance → BİLİNMİYOR (undefined, 0 DEĞİL) — mutasyon ayırt edici', () => {
    expect(mikroCariOku('a', { bakiye: -1200 }).kayit.balance).toBe(-1200);
    expect(mikroCariOku('b', { bakiye: '1250.75' }).kayit.balance).toBe(1250.75);
    expect(mikroCariOku('c', { balance: 300 }).kayit.balance).toBe(300);
    expect(mikroCariOku('d', { bakiye: null, balance: 300 }).kayit.balance).toBe(300);
    expect(mikroCariOku('e', {}).kayit.balance).toBeUndefined();
    expect(mikroCariOku('f', { bakiye: 'abc' }).kayit.balance).toBeUndefined();
    expect(mikroCariOku('g', { type: 'Supplier' }).kayit.balance).toBeUndefined();
  });

  it('bakiye 0 GERÇEK sıfırdır (bilinmeyen değil), balance alanına düşülmez', () => {
    expect(mikroCariOku('a', { bakiye: 0, balance: 500 }).kayit.balance).toBe(0);
  });

  it('bakiye "" bilinmiyor → balance alanına düşer (sayfa Number("") = 0 diyordu — bilinçli fark)', () => {
    expect(mikroCariOku('a', { bakiye: '', balance: 200 }).kayit.balance).toBe(200);
    expect(mikroCariOku('b', { bakiye: '' }).kayit.balance).toBeUndefined();
  });

  it('creditLimit yalnız müşteride; yoksa BİLİNMİYOR (undefined, 0 DEĞİL) — mutasyon ayırt edici', () => {
    const m = mikroCariOku('a', sirin({ creditLimit: undefined }));
    if (m.rol !== 'musteri') throw new Error('müşteri bekleniyordu');
    expect(m.kayit.creditLimit).toBeUndefined();
    const s0 = mikroCariOku('b', { creditLimit: '0' });
    if (s0.rol !== 'musteri') throw new Error('müşteri bekleniyordu');
    expect(s0.kayit.creditLimit).toBe(0);
    const t = mikroCariOku('c', sirin({ type: 'Supplier' }));
    expect('creditLimit' in t.kayit).toBe(false);
  });
});

describe('mikroCarileriAyir — tek geçişte iki liste', () => {
  it('müşteri ve tedarikçi listeleri sırayı korur', () => {
    const r = mikroCarileriAyir([
      { id: '1', veri: sirin() },
      { id: '2', veri: { name: 'Çelik Yapı', type: 'Supplier', bakiye: -4000 } },
      { id: '3', veri: { name: 'Ateş Beton' } },
    ]);
    expect(r.musteriler.map(m => m.id)).toEqual(['1', '3']);
    expect(r.tedarikciler.map(t => t.id)).toEqual(['2']);
    expect(r.tedarikciler[0].balance).toBe(-4000);
  });
  it('boş → boş', () => {
    expect(mikroCarileriAyir([])).toEqual({ musteriler: [], tedarikciler: [] });
  });
});

describe('bakiyeSayisi — dekont önizlemesi için sayı; bilinmiyorsa NaN (paraYaz "—")', () => {
  it('bilinen → sayı, sayısal string → sayı, bilinmeyen → NaN (0 DEĞİL) — mutasyon ayırt edici', () => {
    expect(bakiyeSayisi(-750)).toBe(-750);
    expect(bakiyeSayisi('12.5')).toBe(12.5);
    expect(bakiyeSayisi(0)).toBe(0);
    expect(Number.isNaN(bakiyeSayisi(undefined))).toBe(true);
    expect(Number.isNaN(bakiyeSayisi(null))).toBe(true);
    expect(Number.isNaN(bakiyeSayisi(''))).toBe(true);
    expect(Number.isNaN(bakiyeSayisi('abc'))).toBe(true);
  });
});

describe('bakiyeDurumu — eksi = CETPA borçlu (cari alacaklı)', () => {
  it('artı → borclu (cari bize borçlu, kırmızı); eksi → alacakli (CETPA borçlu, yeşil); 0 → sifir', () => {
    expect(bakiyeDurumu(15250.5)).toBe('borclu');
    expect(bakiyeDurumu(-800)).toBe('alacakli');
    expect(bakiyeDurumu('-12.5')).toBe('alacakli');
    expect(bakiyeDurumu(0)).toBe('sifir');
    expect(bakiyeDurumu('0')).toBe('sifir');
  });
  it('bilinmeyen → bilinmiyor (sıfır DEĞİL) — mutasyon ayırt edici', () => {
    expect(bakiyeDurumu(undefined)).toBe('bilinmiyor');
    expect(bakiyeDurumu(null)).toBe('bilinmiyor');
    expect(bakiyeDurumu(NaN)).toBe('bilinmiyor');
    expect(bakiyeDurumu('abc')).toBe('bilinmiyor');
    expect(bakiyeDurumu('')).toBe('bilinmiyor');
  });
});

describe('bakiyeliCariKodlari — cariBalances → bakiyesi olan kodlar (satır 537-544)', () => {
  it('kod: cariKod → doc id; trim; boş kod atlanır; bakiye ≠ 0 olan girer', () => {
    const set = bakiyeliCariKodlari([
      { id: 'd1', veri: { cariKod: ' 120.01.001 ', bakiye: 250 } },
      { id: '120.01.002', veri: { bakiye: '-5' } },
      { id: 'd3', veri: { cariKod: '', bakiye: 99 } },
      { id: '   ', veri: { bakiye: 99 } },
    ]);
    expect([...set]).toEqual(['120.01.001', '120.01.002']);
  });
  it('bakiye 0 girmez (gerçek sıfır); bilinmeyen/bozuk bakiye de girmez — "bakiyesi var" denemez', () => {
    const set = bakiyeliCariKodlari([
      { id: 'a', veri: { bakiye: 0 } },
      { id: 'b', veri: {} },
      { id: 'c', veri: { bakiye: null } },
      { id: 'd', veri: { bakiye: 'abc' } },   // sayfa: Number('abc') !== 0 → giriyordu (bilinçli fark)
      { id: 'e', veri: { bakiye: '' } },
    ]);
    expect(set.size).toBe(0);
  });
  it('boş → boş küme', () => {
    expect(bakiyeliCariKodlari([]).size).toBe(0);
  });
});

interface Cari { id: string; name: string; company?: string; balance?: number; riskGroup?: 'Düşük' | 'Orta' | 'Yüksek' }
const liste: Cari[] = [
  { id: 's', name: 'Şirin İnşaat', company: 'Şirin A.Ş.', balance: 15250.5, riskGroup: 'Orta' },
  { id: 'c', name: 'Çelik Yapı', balance: -800, riskGroup: 'Yüksek' },
  { id: 'a', name: 'Ateş Beton', balance: 0, riskGroup: 'Düşük' },
  { id: 'b', name: 'Bilinmez Ltd.' },                      // bakiye + risk bilinmiyor
];
const sira = (anahtar: keyof Cari, yon: 'asc' | 'desc') =>
  [...liste].sort(cariKarsilastirici<Cari>(anahtar, yon)).map(c => c.id);

describe('cariKarsilastirici — sıralama (satır 1852-1866, 1926-1938)', () => {
  it('bakiye artan/azalan: bilinenler sayfadaki sırayla; bilinmeyen HER İKİ yönde SONDA — mutasyon ayırt edici', () => {
    expect(sira('balance', 'asc')).toEqual(['c', 'a', 's', 'b']);
    expect(sira('balance', 'desc')).toEqual(['s', 'a', 'c', 'b']);
  });
  it('sayfa paritesi: bilinen bakiyelerde `(a.balance||0)-(b.balance||0)` ile aynı sıra', () => {
    const bilinenler = liste.filter(c => c.balance !== undefined);
    const eski = [...bilinenler].sort((a, b) => ((a.balance ?? NaN) - (b.balance ?? NaN))).map(c => c.id);
    const yeni = [...bilinenler].sort(cariKarsilastirici<Cari>('balance', 'asc')).map(c => c.id);
    expect(yeni).toEqual(eski);
    const eskiDesc = [...bilinenler].sort((a, b) => -((a.balance ?? NaN) - (b.balance ?? NaN))).map(c => c.id);
    expect([...bilinenler].sort(cariKarsilastirici<Cari>('balance', 'desc')).map(c => c.id)).toEqual(eskiDesc);
  });
  it('risk grubu: Düşük < Orta < Yüksek; bilinmeyen risk her iki yönde sonda (sayfa `?? -1` ile başa alıyordu — bilinçli fark)', () => {
    expect(sira('riskGroup', 'asc')).toEqual(['a', 's', 'c', 'b']);
    expect(sira('riskGroup', 'desc')).toEqual(['c', 's', 'a', 'b']);
  });
  it('metin anahtarı Türkçe harf sırasıyla (localeCompare "tr"); eksik alan "" sayılır', () => {
    expect(sira('name', 'asc')).toEqual(['a', 'b', 'c', 's']);      // Ateş, Bilinmez, Çelik, Şirin
    expect(sira('name', 'desc')).toEqual(['s', 'c', 'b', 'a']);
    expect(sira('company', 'asc')).toEqual(['c', 'a', 'b', 's']);   // '' üçlüsü kararlı, Şirin A.Ş. sonda
  });
});

describe('cariEslesir — ad/firma araması (satır 1853, 1926)', () => {
  const k = { name: 'Şirin İnşaat', company: 'ŞİRİN YAPI MALZEMELERİ A.Ş.' };
  it('boş arama herkesi geçirir', () => {
    expect(cariEslesir(k, '')).toBe(true);
    expect(cariEslesir(k, '   ')).toBe(true);
  });
  it('ad ya da firma, Türkçe küçük harfle (İ → i, I → ı) eşleşir', () => {
    expect(cariEslesir(k, 'şirin')).toBe(true);
    expect(cariEslesir(k, 'malzemeleri')).toBe(true);       // "MALZEMELERİ" → 'malzemeleri' (tr-TR)
    expect(cariEslesir(k, 'İNŞAAT')).toBe(true);
    expect(cariEslesir(k, 'çelik')).toBe(false);
    expect(cariEslesir({ name: 'Çelik Yapı' }, 'yapı')).toBe(true);
    expect(cariEslesir({ name: 'Çelik Yapı' }, 'a.ş')).toBe(false);
  });
});

describe('musteridenTedarikci — alış faturalı cari aynı kayıt (satır 1904-1919)', () => {
  it('alanlar birebir taşınır; bilinen bakiye sayı, risk aynen', () => {
    const t = musteridenTedarikci({
      id: 'L1', name: 'Çelik Yapı', company: 'Çelik Yapı Ltd.', email: 'x@celik.com', phone: '0312',
      taxNo: '555', address: 'Ankara', balance: -4000, riskGroup: 'Yüksek', mikroCariKod: '320.01.005',
    });
    expect(t).toEqual({
      id: 'L1', name: 'Çelik Yapı', company: 'Çelik Yapı Ltd.', email: 'x@celik.com', phone: '0312',
      taxNo: '555', address: 'Ankara', balance: -4000, riskGroup: 'Yüksek', mikroCariKod: '320.01.005',
    });
  });
  it('eksik metinler ""; risk yoksa "Düşük"; bakiye bilinmiyorsa BİLİNMİYOR (0 DEĞİL) — mutasyon ayırt edici', () => {
    const t = musteridenTedarikci({ id: 'L2', name: 'Ateş Beton' });
    expect(t.balance).toBeUndefined();
    expect(t.riskGroup).toBe('Düşük');
    expect([t.company, t.email, t.phone, t.taxNo, t.address, t.mikroCariKod]).toEqual(['', '', '', '', '', '']);
    expect(musteridenTedarikci({ id: 'L3', name: 'x', balance: NaN }).balance).toBeUndefined();
  });
});

describe('cariKodu — mikroCariKod → code → taxNo → "" (satır 1878-1879, 1902-1903)', () => {
  it('ilk dolu metin; hepsi boşsa ""', () => {
    expect(cariKodu({ mikroCariKod: '120.01.001', code: 'C1', taxNo: '9' })).toBe('120.01.001');
    expect(cariKodu({ mikroCariKod: '', code: 'C1', taxNo: '9' })).toBe('C1');
    expect(cariKodu({ taxNo: '9' })).toBe('9');
    expect(cariKodu({})).toBe('');
    expect(cariKodu({ mikroCariKod: null, code: undefined, taxNo: '' })).toBe('');
  });
});
