/**
 * leadBirlestir.test.ts — mükerrer lead gruplama + birleştirme yaması (2026-09-05). ÖNCE YAZILDI.
 *
 * Neden var: cari import'u Türkçe unvanı elle açılmış lead'le eşleştiremediği için (4/n bulgusu)
 * her koşuda YENİ lead açtı; kopyalar `leads`te duruyor. `scripts/lead-birlestir.ts` bu modülü
 * PG'ye karşı koşar (kuru koşu varsayılan). Kurallar:
 *  - Aynı kiracı içinde mikroCariKod / VKN (≥10 hane) / Türkçe isim anahtarı paylaşan lead'ler
 *    TEK grup (geçişli). Farklı kiracı asla birleşmez.
 *  - ÇELİŞKİ (grupta farklı Mikro cari kodu ya da farklı VKN) → birleştirme YAPILMAZ, raporlanır.
 *  - Kalan: elle açılan (Mikro kaynaklı OLMAYAN) kayıt; eşitse en eski createdAt.
 *  - Yama: kalanın BOŞ alanları kopyalardan dolar (dolu alan EZİLMEZ); activities/voiceNotes id'ye
 *    göre birleşir; notes ekle; `birlestirilen` denetim izi.
 */
import { describe, it, expect } from 'vitest';
import { mukerrerGruplari, kalanSec, birlestirmeYamasi, vknAnahtari, MIKRO_KAYNAKLAR } from './leadBirlestir';

const SIMDI = Date.parse('2026-09-05T12:00:00Z');
const lead = (id: string, data: Record<string, unknown>) => ({ id, data: { companyId: 'A', ...data } });

describe('gruplama', () => {
  it("Türkçe isim: 'ŞİRİN YAPI' (mikro_import) ↔ 'Şirin Yapı' (elle) tek grup; kalan ELLE açılan; kopya Mikro kaydı", () => {
    const g = mukerrerGruplari([
      lead('mik', { name: 'ŞİRİN YAPI A.Ş.', company: 'ŞİRİN YAPI A.Ş.', mikroCariKod: '120.01.001', taxId: '1234567890', source: 'mikro_import', createdAt: '2026-09-01T00:00:00Z' }),   // import name=company=unvan yazar
      lead('el', { name: 'Şirin Yapı', company: 'Şirin Yapı A.Ş.', email: 'info@sirin.com', createdAt: '2026-05-01T00:00:00Z', activities: [{ id: 'a1', type: 'Call', description: 'Arandı', date: '2026-05-02' }] }),
    ], SIMDI);
    expect(g).toHaveLength(1);
    expect(g[0].baglantilar).toEqual(['isim']);
    expect(g[0].celiski).toBeNull();
    expect(g[0].kalan.id).toBe('el');
    expect(g[0].silinecek.map(s => s.id)).toEqual(['mik']);
    expect(g[0].yama).toMatchObject({ mikroCariKod: '120.01.001', taxId: '1234567890' });
    expect(g[0].yama.email, 'kalanın dolu e-postası yamaya GİRMEZ (ezilmez)').toBeUndefined();
  });
  it('VKN eşleşmesi biçimden bağımsız (boşluklu/tireli); kısa VKN (<10 hane) anahtar ÜRETMEZ', () => {
    expect(vknAnahtari('123 456 78 90')).toBe('1234567890');
    expect(vknAnahtari('12345')).toBe('');
    const g = mukerrerGruplari([
      lead('a', { name: 'Akdeniz İnşaat', taxId: '123 456 78 90' }),
      lead('b', { name: 'AKDENİZ YAPI MALZ.', taxId: '1234567890', source: 'mikro_cron' }),
      lead('c', { name: 'Başka Firma', taxId: '12345' }),
      lead('d', { name: 'Diğer Firma', taxId: '12345' }),
    ], SIMDI);
    expect(g).toHaveLength(1);
    expect(g[0].baglantilar).toEqual(['vkn']);
    expect(g[0].uyeler.map(u => u.id).sort()).toEqual(['a', 'b']);
  });
  it('aynı mikroCariKod iki Mikro kaydı (import + cron): kalan EN ESKİ createdAt ({_seconds} ve ISO karışık)', () => {
    const g = mukerrerGruplari([
      lead('yeni', { name: 'X', mikroCariKod: 'C1', source: 'mikro_cron', createdAt: { _seconds: 1756684800, _nanoseconds: 0 } }),   // 2025-09-01
      lead('eski', { name: 'X', mikroCariKod: 'C1', source: 'mikro_import', createdAt: '2025-01-01T00:00:00Z' }),
    ], SIMDI);
    expect(g[0].baglantilar.sort()).toEqual(['isim', 'mikroCariKod']);
    expect(g[0].kalan.id).toBe('eski');
  });
  it("KRİTİK: elle lead'de `name` YETKİLİ KİŞİ, `company` firma — aynı adlı yetkili iki farklı firma BİRLEŞMEZ (isim anahtarı FİRMA üzerinden)", () => {
    const g = mukerrerGruplari([
      lead('b', { name: 'Ahmet Yılmaz', company: 'Beta İnşaat' }),
      lead('d', { name: 'Ahmet Yılmaz', company: 'Delta Yapı' }),
      lead('m', { name: 'AHMET YILMAZ', company: 'AHMET YILMAZ', mikroCariKod: 'C5', source: 'mikro_import' }),   // Mikro şahıs carisi
    ], SIMDI);
    expect(g).toEqual([]);   // hiçbiri aynı firma değil
  });
  it("company boşsa name firma adıdır (eski kayıt): 'Şirin Yapı' ↔ Mikro 'ŞİRİN YAPI' eşleşir; company DOLU ve FARKLIysa ÇELİŞKİ", () => {
    const g1 = mukerrerGruplari([lead('e', { name: 'Şirin Yapı' }), lead('m', { name: 'ŞİRİN YAPI', company: 'ŞİRİN YAPI', source: 'mikro_import' })], SIMDI);
    expect(g1).toHaveLength(1); expect(g1[0].celiski).toBeNull();
    const g2 = mukerrerGruplari([lead('e', { name: 'Şirin Yapı', company: 'Şirin Yapı Malzemeleri Ltd.', taxId: '1234567890' }), lead('m', { name: 'ŞİRİN YAPI', company: 'ŞİRİN YAPI', taxId: '1234567890', source: 'mikro_import' })], SIMDI);
    expect(g2).toHaveLength(1); expect(g2[0].celiski).toMatch(/firma adı/);
  });
  it("yer tutucu VKN ('11111111111', '0000000000') anahtar ÜRETMEZ — nihai tüketici kayıtları birbirine bağlanmaz", () => {
    expect(vknAnahtari('11111111111')).toBe('');
    expect(vknAnahtari('0000000000')).toBe('');
    expect(vknAnahtari('1234567890')).toBe('1234567890');
    const g = mukerrerGruplari([lead('a', { name: 'Ali Veli', taxId: '11111111111' }), lead('b', { name: 'Ayşe Kaya', taxId: '11111111111' })], SIMDI);
    expect(g).toEqual([]);
  });
  it("VARSAYILAN: yalnız Mikro kaynaklı kopya silinir; elle↔elle grup 'elle kopya' çelişkisiyle raporlanır, ELLE_DE seçeneğiyle birleşir", () => {
    const uyeler = [lead('e1', { company: 'Şirin Yapı', createdAt: '2026-01-01' }), lead('e2', { company: 'ŞİRİN YAPI', createdAt: '2026-06-01' })];
    const g = mukerrerGruplari(uyeler, SIMDI);
    expect(g[0].celiski).toMatch(/elle/); expect(g[0].silinecek).toEqual([]);
    const g2 = mukerrerGruplari(uyeler, SIMDI, { elleDe: true });
    expect(g2[0].celiski).toBeNull(); expect(g2[0].silinecek.map(s => s.id)).toEqual(['e2']);
  });
  it('geçişli: A~B (isim), B~C (VKN) → tek grup, 3 üye', () => {
    const g = mukerrerGruplari([
      lead('A', { name: 'Şirin Yapı' }),
      lead('B', { name: 'ŞİRİN YAPI', taxId: '9876543210', source: 'mikro_import' }),
      lead('C', { name: 'Sirin Insaat Ltd', taxId: '9876543210' }),
    ], SIMDI);
    expect(g).toHaveLength(1);
    expect(g[0].uyeler).toHaveLength(3);
  });
  it('ÇELİŞKİ: aynı isim, FARKLI Mikro cari kodu (şubeler) → birleştirme YOK, sebep yazılı', () => {
    const g = mukerrerGruplari([
      lead('s1', { name: 'ÇİMSA ANKARA', mikroCariKod: 'C1', source: 'mikro_import' }),
      lead('s2', { name: 'Çimsa Ankara', mikroCariKod: 'C2', source: 'mikro_import' }),
    ], SIMDI);
    expect(g).toHaveLength(1);
    expect(g[0].celiski).toMatch(/Mikro cari kodu/);
    expect(g[0].silinecek).toEqual([]);
  });
  it('ÇELİŞKİ: aynı isim, farklı VKN → birleştirme YOK', () => {
    const g = mukerrerGruplari([lead('v1', { name: 'Ada Yapı', taxId: '1234567890' }), lead('v2', { name: 'ADA YAPI', taxId: '9876543210', source: 'mikro_import' })], SIMDI);
    expect(g[0].celiski).toMatch(/VKN/);
  });
  it('farklı kiracı aynı isim → AYRI (grup yok); tekil lead → grup yok; boş isim anahtar üretmez', () => {
    expect(mukerrerGruplari([lead('a', { name: 'Ortak Ad' }), { id: 'b', data: { companyId: 'B', name: 'ORTAK AD' } }], SIMDI)).toEqual([]);
    expect(mukerrerGruplari([lead('a', { name: 'Tek' })], SIMDI)).toEqual([]);
    expect(mukerrerGruplari([lead('a', { name: '' }), lead('b', { name: '  ' })], SIMDI)).toEqual([]);
  });
  it('etiketsiz (companyId yok) kayıt, kiracı boş anahtarıyla yalnız etiketsizlerle gruplanır', () => {
    const g = mukerrerGruplari([{ id: 'e1', data: { name: 'Eski Kayıt' } }, { id: 'e2', data: { name: 'ESKİ KAYIT', source: 'mikro_import' } }, lead('a', { name: 'Eski Kayıt' })], SIMDI);
    expect(g).toHaveLength(1);
    expect(g[0].uyeler.map(u => u.id).sort()).toEqual(['e1', 'e2']);
  });
});

describe('CRM izi taşıyan kayıt ASLA kopya sayılmaz (source ezilmiş elle lead senaryosu)', () => {
  it("geçmişte import'a yakalanıp source='mikro_import' olmuş elle lead (aktivite + temsilci + takip) + yeni boş elle kopya → KALAN izli kayıt; kopya elle olduğu için varsayılanda dokunulmaz, ELLE_DE ile silinir", () => {
    const izli = lead('izli', { company: 'Şirin Yapı', source: 'mikro_import', createdAt: '2026-03-01', assignedTo: 'temsilci-a', nextFollowUpDate: '2026-09-10', activities: [{ id: 'a1', type: 'Call', description: 'x', date: '2026-04-01' }] });
    const bosKopya = lead('bos', { company: 'ŞİRİN YAPI', createdAt: '2026-08-01', status: 'New' });
    expect(kalanSec([bosKopya, izli]).id).toBe('izli');
    const g = mukerrerGruplari([izli, bosKopya], SIMDI);
    expect(g[0].kalan.id).toBe('izli'); expect(g[0].celiski).toMatch(/elle/);
    const g2 = mukerrerGruplari([izli, bosKopya], SIMDI, { elleDe: true });
    expect(g2[0].kalan.id).toBe('izli'); expect(g2[0].silinecek.map(s => s.id)).toEqual(['bos']);
  });
  it("Mikro kaynaklı kayıtta CRM izi varsa (kullanıcı ona aktivite girmiş) İZLİ KAYIT KALAN; izsiz elle lead kopya → varsayılanda 'elle' çelişkisi, ELLE_DE ile silinir", () => {
    const el = lead('el', { company: 'Ada Yapı', createdAt: '2026-01-01' });
    const mikroIzli = lead('m', { company: 'ADA YAPI', source: 'mikro_import', mikroCariKod: 'C9', createdAt: '2026-06-01', activities: [{ id: 'a7', type: 'Note', description: 'buraya girilmiş', date: '2026-07-01' }] });
    const g = mukerrerGruplari([el, mikroIzli], SIMDI);
    expect(g[0].kalan.id).toBe('m'); expect(g[0].celiski).toMatch(/elle/); expect(g[0].silinecek).toEqual([]);
    const g2 = mukerrerGruplari([el, mikroIzli], SIMDI, { elleDe: true });
    expect(g2[0].kalan.id).toBe('m'); expect(g2[0].silinecek.map(s => s.id)).toEqual(['el']);
    expect(g2[0].yama.activities, 'kalanın kendi aktivitesi zaten var — yamaya girmez').toBeUndefined();
  });
  it("iki tarafta da iz: elle+temsilci ↔ Mikro+aktivite → kalan elle (izli ve Mikro değil); Mikro kopya izli → varsayılanda 'CRM izi' çelişkisi; ELLE_DE ile aktivite yamaya taşınır", () => {
    const a = lead('a', { company: 'Ada Yapı', createdAt: '2026-01-01', assignedTo: 't1' });
    const m = lead('m', { company: 'ADA YAPI', source: 'mikro_import', mikroCariKod: 'C9', createdAt: '2026-06-01', activities: [{ id: 'a7', type: 'Note', description: 'x', date: '2026-07-01' }] });
    const g = mukerrerGruplari([a, m], SIMDI);
    expect(g[0].kalan.id).toBe('a'); expect(g[0].celiski).toMatch(/CRM izi/); expect(g[0].silinecek).toEqual([]);
    const g2 = mukerrerGruplari([a, m], SIMDI, { elleDe: true });
    expect(g2[0].silinecek.map(s => s.id)).toEqual(['m']);
    expect((g2[0].yama.activities as Array<{ id: string }>).map(x => x.id)).toEqual(['a7']);
  });
  it('iki tarafta da CRM izi varsa kalan: daha çok iz taşıyan değil, EN ESKİ (öngörülebilir); ikisi de izli → varsayılanda dokunulmaz', () => {
    const a = lead('a', { company: 'X', createdAt: '2026-02-01', assignedTo: 't1' });
    const b = lead('b', { company: 'X', createdAt: '2026-01-01', notes: 'eski not' });
    expect(kalanSec([a, b]).id).toBe('b');
    expect(mukerrerGruplari([a, b], SIMDI)[0].celiski).toMatch(/elle|CRM izi/);
  });
});

describe('kalanSec', () => {
  it('elle açılan Mikro kaynaklıya tercih edilir; ikisi de elleyse en eski; createdAt bilinmeyen sona', () => {
    const mik = lead('m', { source: 'mikro_import', createdAt: '2024-01-01' });
    const el1 = lead('e1', { createdAt: '2026-01-01T00:00:00Z' });
    const el2 = lead('e2', { createdAt: '2025-01-01T00:00:00Z' });
    const bilinmez = lead('b', {});
    expect(kalanSec([mik, el1, el2, bilinmez]).id).toBe('e2');
    expect(kalanSec([mik, bilinmez]).id).toBe('b');
    for (const k of ['mikro_import', 'mikro_cron', 'mikro_sql']) expect(MIKRO_KAYNAKLAR.has(k)).toBe(true);
  });
});

describe('birlestirmeYamasi', () => {
  it('kalanın DOLU alanı ezilmez, BOŞ alanı kopyadan dolar; activities/voiceNotes id ile birleşir; notes eklenir; denetim izi', () => {
    const kalan = lead('el', { email: 'info@sirin.com', phone: '', notes: 'Toplantı yapıldı.', activities: [{ id: 'a1', type: 'Call', description: 'Arandı', date: '2026-05-02' }] });
    const kopya = lead('mik', { name: 'ŞİRİN YAPI', email: 'mikro@sirin.com', phone: '05551112233', taxId: '1234567890', taxOffice: 'Kadıköy', mikroCariKod: 'C1', eFaturaKayitli: true, mikroSynced: true, source: 'mikro_import', notes: 'Mikro notu', activities: [{ id: 'a1', type: 'Call', description: 'Arandı', date: '2026-05-02' }, { id: 'a2', type: 'Note', description: 'Yeni', date: '2026-06-01' }] });
    const y = birlestirmeYamasi(kalan, [kopya], SIMDI);
    expect(y.email).toBeUndefined();                       // dolu → dokunulmaz
    expect(y).toMatchObject({ phone: '05551112233', taxId: '1234567890', taxOffice: 'Kadıköy', mikroCariKod: 'C1', eFaturaKayitli: true, mikroSynced: true });
    expect(y.name).toBeUndefined();                        // ad/unvan kalanınki kalır
    expect((y.activities as unknown[]).map(a => (a as { id: string }).id)).toEqual(['a1', 'a2']);
    expect(y.notes).toBe('Toplantı yapıldı.\n---\nMikro notu');
    expect(y.birlestirilen).toEqual([{ id: 'mik', source: 'mikro_import', name: 'ŞİRİN YAPI', tarih: '2026-09-05T12:00:00.000Z' }]);
    expect(y.updatedAt).toEqual({ _seconds: Math.floor(SIMDI / 1000), _nanoseconds: 0 });
  });
  it('kopyada da boşsa alan yamaya girmez; aynı notes tekrar eklenmez', () => {
    const y = birlestirmeYamasi(lead('k', { notes: 'x' }), [lead('d', { phone: '', notes: 'x' })], SIMDI);
    expect('phone' in y).toBe(false);
    expect('notes' in y).toBe(false);
  });
});
