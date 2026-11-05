// @vitest-environment node
/**
 * musteriHesap.test.ts — müşteri hesabının cari BAĞI: saf doğrulama ve çekirdek (2026-10-21, şartname
 * `.wf/SARTNAME-musteri-siparislerim.md` K2, H5, H9). Uçlar (Yönetici kapısı, iptal, `/api/db` kapalılığı) gerçek zincirde:
 * magazaBayi.zincir.test.ts.
 */
import { describe, it, expect } from 'vitest';
import type { AdminDbLike, AdminDocRef } from './adminDbTypes';
import {
  MUSTERI_FIRMA_SINIRI, bagCariKodu, bagFirmasi, bagKaydiDogrula, musteriBagiKur, musteriHesabiCoz, musteriHesapDurumuYaz,
  musteriHesapOkuyucuKur, musteriLeadiDogrula,
} from './musteriHesap';

/** En dar sahte `adminDb` (yalnız `collection().doc().get/set`); okuma / yazma sayılır. */
function sahteDb(): { db: AdminDbLike; belgeler: Map<string, Record<string, unknown>>; okumalar: string[]; hata: { oku: boolean } } {
  const belgeler = new Map<string, Record<string, unknown>>();
  const okumalar: string[] = [];
  const hata = { oku: false };
  const ref = (coll: string, id: string): AdminDocRef => ({
    id,
    async get() {
      okumalar.push(`${coll}/${id}`);
      if (hata.oku) throw Object.assign(new Error('okuma'), { code: '57P01' });
      const v = belgeler.get(`${coll}/${id}`);
      return { exists: v !== undefined, id, data: () => (v === undefined ? undefined : { ...v }) };
    },
    async set(veri) { belgeler.set(`${coll}/${id}`, { ...veri }); },
    async update(veri) { belgeler.set(`${coll}/${id}`, { ...(belgeler.get(`${coll}/${id}`) ?? {}), ...veri }); },
    async delete() { belgeler.delete(`${coll}/${id}`); },
  });
  const db: AdminDbLike = {
    collection: (coll) => ({
      doc: (id) => ref(coll, id ?? 'yeni'),
      add: async () => { throw new Error('kullanılmaz'); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      async get() { return { docs: [], empty: true, size: 0 }; },
    }),
    batch: () => { throw new Error('kullanılmaz'); },
  };
  return { db, belgeler, okumalar, hata };
}

describe('bagCariKodu — kırp, boşsa null, BÜYÜTME', () => {
  it('lead kodu yok, \'\' ya da \'  \' → null; \' 120.01.0042 \' → \'120.01.0042\'', () => {
    for (const ham of [undefined, null, '', '  ', '\t\n']) expect(bagCariKodu(ham), JSON.stringify(ham)).toBeNull();
    expect(bagCariKodu(' 120.01.0042 ')).toBe('120.01.0042');
  });
  it('harf yazımı DEĞİŞMEZ (MF siparişindeki kod da yalnız kırpılmış): \'abı\' → \'abı\', \'ABI\' → \'ABI\'', () => {
    expect(bagCariKodu(' abı ')).toBe('abı');
    expect(bagCariKodu('ABI')).toBe('ABI');
  });
  it('sonlu sayı metne çevrilir; nesne / mantıksal / sonsuz → null (uydurma kod yazılmaz)', () => {
    expect(bagCariKodu(120)).toBe('120');
    for (const ham of [{}, [], true, Number.NaN, Number.POSITIVE_INFINITY]) expect(bagCariKodu(ham), String(ham)).toBeNull();
  });
});

describe('bagFirmasi — company → name → \'\'; tek satır, üst sınır', () => {
  it('sıra ve temizlik', () => {
    expect(bagFirmasi({ company: 'Örnek Yapı Ltd.', name: 'Ahmet' })).toBe('Örnek Yapı Ltd.');
    expect(bagFirmasi({ company: '  ', name: 'Ahmet Usta' })).toBe('Ahmet Usta');
    expect(bagFirmasi({})).toBe('');
    expect(bagFirmasi({ company: 'Satır\nkırık\tad' })).toBe('Satır kırık ad');
    expect(bagFirmasi({ company: 'Ş'.repeat(500) })).toHaveLength(MUSTERI_FIRMA_SINIRI);
  });
});

describe('bagKaydiDogrula — leadId 400, lead yok / kiracısız / başka kiracı 404', () => {
  const lead = { companyId: 'CETPA', company: 'Örnek Yapı', mikroCariKod: ' 120.01.0042 ' };
  it('geçerli girdi: üç türetilmiş alan', () => {
    expect(bagKaydiDogrula({ leadId: 'L1', lead, kiraci: 'CETPA' })).toEqual({ ok: true, leadId: 'L1', cariKod: '120.01.0042', firma: 'Örnek Yapı' });
  });
  it('leadId boş olmayan metin değilse 400', () => {
    for (const leadId of [undefined, null, '', '   ', 7, {}]) expect(bagKaydiDogrula({ leadId, lead, kiraci: 'CETPA' }), JSON.stringify(leadId)).toEqual({ ok: false, kod: 400 });
  });
  it('lead yok, `companyId`\'siz ya da başka kiracının → 404 («yok» ile aynı)', () => {
    expect(bagKaydiDogrula({ leadId: 'L1', lead: null, kiraci: 'CETPA' })).toEqual({ ok: false, kod: 404 });
    expect(bagKaydiDogrula({ leadId: 'L1', lead: { company: 'x' }, kiraci: 'CETPA' })).toEqual({ ok: false, kod: 404 });
    expect(bagKaydiDogrula({ leadId: 'L1', lead: { ...lead, companyId: 'BASKA' }, kiraci: 'CETPA' })).toEqual({ ok: false, kod: 404 });
    expect(bagKaydiDogrula({ leadId: 'L1', lead, kiraci: '' })).toEqual({ ok: false, kod: 404 });
  });
  it('kodsuz lead → bağ KURULUR, `cariKod: null` (kullanıcı sorusu 2 varsayılanı)', () => {
    expect(bagKaydiDogrula({ leadId: 'L1', lead: { companyId: 'CETPA', name: 'Usta' }, kiraci: 'CETPA' })).toEqual({ ok: true, leadId: 'L1', cariKod: null, firma: 'Usta' });
  });
});

describe('musteriHesabiCoz — saklı kayıt; bozuk → null (kapalı başarısız)', () => {
  const tam = { companyId: 'CETPA', leadId: 'L1', cariKod: 'K1', firma: 'F', durum: 'acik', olusturan: 'u', olusturma: 't', guncelleme: 't' };
  it('geçerli kayıt AYNEN; boş / boşluklu `cariKod` → null', () => {
    expect(musteriHesabiCoz(tam)).toEqual(tam);
    expect(musteriHesabiCoz({ ...tam, cariKod: '' })?.cariKod).toBeNull();
    expect(musteriHesabiCoz({ ...tam, cariKod: '  ' })?.cariKod).toBeNull();
    expect(musteriHesabiCoz({ ...tam, cariKod: null })?.cariKod).toBeNull();
  });
  it('bozuk: durum tanınmıyor, leadId / companyId boş, cariKod sayı, nesne değil → null', () => {
    for (const bozuk of [{ ...tam, durum: 'açık' }, { ...tam, durum: undefined }, { ...tam, leadId: '' }, { ...tam, companyId: 3 }, { ...tam, cariKod: 5 }, null, [], 'x']) {
      expect(musteriHesabiCoz(bozuk), JSON.stringify(bozuk)).toBeNull();
    }
  });
});

describe('musteriBagiKur — TEK yazma çekirdeği', () => {
  const D = (s: ReturnType<typeof sahteDb>, ms = Date.parse('2026-10-21T09:00:00.000Z')) => ({ adminDb: () => s.db, simdi: () => new Date(ms) });
  it('yeni bağ: `durum: acik`, cari kodu kırpılmış, firma lead\'den; `bagDegisti` false (önceki yok)', async () => {
    const s = sahteDb();
    s.belgeler.set('leads/L1', { companyId: 'CETPA', company: 'Örnek', mikroCariKod: ' K-1 ' });
    const r = await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'yonetici' });
    expect(r).toMatchObject({ sonuc: 'tamam', onceki: null, bagDegisti: false });
    expect(s.belgeler.get('musteriHesaplari/b1')).toEqual({
      companyId: 'CETPA', leadId: 'L1', cariKod: 'K-1', firma: 'Örnek', durum: 'acik', olusturan: 'yonetici',
      olusturma: '2026-10-21T09:00:00.000Z', guncelleme: '2026-10-21T09:00:00.000Z',
    });
  });
  it('tazeleme (aynı leadId, lead\'e kod yazıldı): kod güncellenir, `olusturan` / `olusturma` / `durum` korunur, `bagDegisti` true', async () => {
    const s = sahteDb();
    s.belgeler.set('leads/L1', { companyId: 'CETPA', company: 'Örnek', mikroCariKod: '' });
    await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'ilk' });
    s.belgeler.set('musteriHesaplari/b1', { ...s.belgeler.get('musteriHesaplari/b1'), durum: 'kapali' });
    s.belgeler.set('leads/L1', { companyId: 'CETPA', company: 'Örnek', mikroCariKod: 'K-2' });
    const r = await musteriBagiKur(D(s, Date.parse('2026-10-22T09:00:00.000Z')), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'ikinci' });
    expect(r).toMatchObject({ sonuc: 'tamam', bagDegisti: true });
    expect(s.belgeler.get('musteriHesaplari/b1')).toMatchObject({
      cariKod: 'K-2', durum: 'kapali', olusturan: 'ilk', olusturma: '2026-10-21T09:00:00.000Z', guncelleme: '2026-10-22T09:00:00.000Z',
    });
  });
  it('aynı lead ve aynı kod: `bagDegisti` false; bozuk saklı kayıt `durum`u okunamıyorsa KAPALI yazılır', async () => {
    const s = sahteDb();
    s.belgeler.set('leads/L1', { companyId: 'CETPA', mikroCariKod: 'K' });
    await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'y' });
    expect((await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'y' }))).toMatchObject({ bagDegisti: false });
    s.belgeler.set('musteriHesaplari/b2', { companyId: 'CETPA', durum: 'bilinmiyor' });
    await musteriBagiKur(D(s), { uid: 'b2', kiraci: 'CETPA', leadId: 'L1', olusturan: 'y' });
    expect(s.belgeler.get('musteriHesaplari/b2')?.durum).toBe('kapali');
  });
  it('lead değişti → `bagDegisti` true; başka kiracının lead\'i → `lead-yok` ve YAZIM YOK; boş leadId → `gecersiz`', async () => {
    const s = sahteDb();
    s.belgeler.set('leads/L1', { companyId: 'CETPA' });
    s.belgeler.set('leads/L2', { companyId: 'CETPA' });
    s.belgeler.set('leads/LX', { companyId: 'BASKA' });
    await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'y' });
    expect(await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L2', olusturan: 'y' })).toMatchObject({ bagDegisti: true });
    const once = JSON.stringify(s.belgeler.get('musteriHesaplari/b1'));
    expect(await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'LX', olusturan: 'y' })).toEqual({ sonuc: 'lead-yok' });
    expect(await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: '  ', olusturan: 'y' })).toEqual({ sonuc: 'gecersiz' });
    expect(JSON.stringify(s.belgeler.get('musteriHesaplari/b1'))).toBe(once);
    expect(await musteriLeadiDogrula(D(s), { kiraci: 'CETPA', leadId: 'YOK' })).toEqual({ ok: false, kod: 404 });
  });
  it('`cariKod: \'\'` HİÇ yazılmaz', async () => {
    const s = sahteDb();
    s.belgeler.set('leads/L1', { companyId: 'CETPA', mikroCariKod: '   ' });
    await musteriBagiKur(D(s), { uid: 'b1', kiraci: 'CETPA', leadId: 'L1', olusturan: 'y' });
    expect(s.belgeler.get('musteriHesaplari/b1')?.cariKod).toBeNull();
  });
});

describe('musteriHesapDurumuYaz ve okuyucu', () => {
  it('durum yazımı yalnız `durum` + `guncelleme`yi değiştirir; bağ yoksa null ve yazım yok', async () => {
    const s = sahteDb();
    const D = { adminDb: () => s.db, simdi: () => new Date('2026-10-21T10:00:00.000Z') };
    expect(await musteriHesapDurumuYaz(D, { uid: 'yok', durum: 'kapali' })).toBeNull();
    expect(s.belgeler.has('musteriHesaplari/yok')).toBe(false);
    s.belgeler.set('musteriHesaplari/b1', { companyId: 'C', leadId: 'L', cariKod: null, firma: 'F', durum: 'acik', olusturan: 'u', olusturma: 't0', guncelleme: 't0' });
    const r = await musteriHesapDurumuYaz(D, { uid: 'b1', durum: 'kapali' });
    expect(r?.onceki.durum).toBe('acik');
    expect(s.belgeler.get('musteriHesaplari/b1')).toEqual({ companyId: 'C', leadId: 'L', cariKod: null, firma: 'F', durum: 'kapali', olusturan: 'u', olusturma: 't0', guncelleme: '2026-10-21T10:00:00.000Z' });
  });
  it('okuyucu: 60 sn önbellek (bulunan ve bulunmayan), `dusur` / `temizle` sonrası yeniden okur; okuma hatası FIRLATIR; adminDb yoksa fırlatır', async () => {
    const s = sahteDb();
    let ms = 0;
    const o = musteriHesapOkuyucuKur({ adminDb: () => s.db, simdi: () => new Date(ms) });
    expect(await o.musteriHesabi('b1')).toBeNull();
    s.belgeler.set('musteriHesaplari/b1', { companyId: 'C', leadId: 'L', cariKod: null, firma: 'F', durum: 'acik', olusturan: '', olusturma: '', guncelleme: '' });
    expect(await o.musteriHesabi('b1')).toBeNull();                 // önbellek
    o.dusur('b1');
    expect((await o.musteriHesabi('b1'))?.durum).toBe('acik');
    s.belgeler.set('musteriHesaplari/b1', { ...s.belgeler.get('musteriHesaplari/b1'), durum: 'kapali' });
    ms += 60_001;
    expect((await o.musteriHesabi('b1'))?.durum).toBe('kapali');    // süre doldu
    o.temizle();
    s.hata.oku = true;
    await expect(o.musteriHesabi('b1')).rejects.toMatchObject({ code: '57P01' });
    await expect(musteriHesapOkuyucuKur({ adminDb: () => null }).musteriHesabi('x')).rejects.toThrow('adminDb yok');
  });
  it('okuma / düşürme yarışı: okuma beklerken kayıt değişir ve `dusur` gelirse eski değer önbelleğe YAZILMAZ; sonraki çağrı veritabanını İKİNCİ kez okur', async () => {
    const s = sahteDb();
    s.belgeler.set('musteriHesaplari/b1', { companyId: 'C', leadId: 'L', cariKod: null, firma: 'F', durum: 'acik', olusturan: '', olusturma: '', guncelleme: '' });
    // `get()` ilk okumada eski anlık görüntüyü alır ve bırakılana kadar bekler (okuma uçuştayken yazım + olay gelir).
    let birak: () => void = () => { throw new Error('bekleyen okuma yok'); };
    let ilkOkuma = true;
    const db: AdminDbLike = {
      ...s.db,
      collection: (coll) => {
        const asil = s.db.collection(coll);
        return {
          ...asil,
          doc: (id) => {
            const ref = asil.doc(id);
            return {
              ...ref,
              async get() {
                const snap = await ref.get();
                if (ilkOkuma) { ilkOkuma = false; await new Promise<void>((r) => { birak = r; }); }
                return snap;
              },
            };
          },
        };
      },
    };
    const o = musteriHesapOkuyucuKur({ adminDb: () => db, simdi: () => new Date(0) });
    const ucusta = o.musteriHesabi('b1');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.okumalar).toEqual(['musteriHesaplari/b1']);
    s.belgeler.set('musteriHesaplari/b1', { ...s.belgeler.get('musteriHesaplari/b1'), durum: 'kapali' });
    o.dusur('b1');
    birak();
    expect((await ucusta)?.durum).toBe('acik');                     // o okumanın sonucu (eski anlık görüntü)
    expect((await o.musteriHesabi('b1'))?.durum).toBe('kapali');    // eski değer önbellekte YOK → yeni değer
    expect(s.okumalar).toEqual(['musteriHesaplari/b1', 'musteriHesaplari/b1']);
    // `temizle` de aynı korumayı verir.
    o.temizle();
    ilkOkuma = true;
    const ucusta2 = o.musteriHesabi('b1');
    await new Promise((r) => setTimeout(r, 0));
    s.belgeler.set('musteriHesaplari/b1', { ...s.belgeler.get('musteriHesaplari/b1'), durum: 'acik' });
    o.temizle();
    birak();
    expect((await ucusta2)?.durum).toBe('kapali');
    expect((await o.musteriHesabi('b1'))?.durum).toBe('acik');
    expect(s.okumalar).toHaveLength(4);
  });
});
