// @vitest-environment node
/**
 * magazaIcerik.pglite.test.ts — dilim 2b yazma yolunun GERÇEK PostgreSQL motorunda sınanması (şartname v6 § 10.8 «Gerçek motor», V10).
 *
 * `@electric-sql/pglite` (PostgreSQL WASM). Kapı 3 ve 4'ün bulguları (ikinci revizyonda `alanlar: null`, teyit yazımıyla yarışan
 * kalem teslim işaretinin pasif anahtara düşmesi, `companyId: ''` etiketli ürün kartının dışlanması) yalnız gerçek jsonb
 * işleçleriyle göründü; sahte havuz bunları sınayamaz. Düzenek `magazaDurum.pglite.test.ts` ile aynıdır (dosya başına bir
 * örnek, testler arasında `DELETE FROM docs`; tablo DDL'i `docsSema.ts`'ten). `magazaDurum.ts` işlevlerinin 2b dokunuşu
 * (silinmiş talebin donukluğu, revize bildirimini yeniden kuyruğa alma) o dosyadadır; burada 2b'nin KENDİ işlevleri var.
 *
 * Kilitlenen değişmezler:
 *  • V16: içerik yazımı `kalemler` / `talepEdilen` / `telefonSon10` / `durum*` / `bildirim`'i DEĞİŞTİRMEZ (alan alan eşit).
 *  • V19 (para): toplamlar sunucuda kuruşla; KDV oranı ürün kaydından, okunamayan oran 20 + `varsayilan`; ürün okuması
 *    fırlatırsa HİÇBİR ŞEY yazılmaz. (İnceleme 2b, bulgu 1) Mevcut teyit kaleminin kayıtlı oranı ve kaynağı stok kodu
 *    değişmedikçe KORUNUR: envanter arada değişse de yalnız not düzenlemesi teyit tutarını ve `teyit.kim`'i değiştirmez.
 *  • İki sayaç bağımsız; teyit yazımı araya girince bekleyen kalem teslim yazımı `surum-eski` (hayalet işaret yok).
 *  • Kalem anahtarı kaymaz; beyandan kopyalanan kalemin teslim işareti yeni `t:` anahtarına taşınır, beyan girişi durur.
 *  • Revize bildirimi: yalnız GERÇEKTEN değişen alanlar; önceki revize bildirimi GİTMEMİŞKEN (`bekliyor` / `gonderilemedi` /
 *    `yapilandirilmamis`) gelen revizyon `alanlar`'ı birleştirir (null değil, ezmez — inceleme 2b, bulgu 10); `gitti` yeniler.
 *  • Yumuşak silme / geri alma: `silindi` nesne ↔ JSON `null`; iki eşzamanlı silmeden biri `zaten-silindi`.
 *  • Elle talep dilim 1 eşleyicisi ve `INSERT` sabitiyle; bildirim tam 1 kez ve yalnız satır GERÇEKTEN eklendiyse.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import {
  MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI, MAGAZA_UTC_ZAMAN_DESENI,
  alanlariBirlestir, magazaKalemAnahtarlari, magazaKalemTeslimMi, magazaSilinmisMi, magazaTeslimIsaretsiz, magazaTeslimKaynagi,
} from '../../lib/magazaTalep';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';
import { kalemTeslimYaz, talepDurumunuDegistir } from './magazaDurum';
import type { MagazaIcerikDeps } from './magazaDurum';
import {
  ELLE_TALEP_DENEME_SINIRI, ICERIK_SQL, URUN_KDV_SQL, elleTalepAc, talepGeriAl, talepIcerigiDegistir, talepSil,
} from './magazaIcerik';
import type { ElleTalepGovdesi, IcerikDegistirGirdisi, IcerikTeyitKalemGirdisi } from './magazaIcerik';
import { magazaTalepKimligi } from './magazaTalep';
import { EKLEME_SQL } from './magazaTalepSql';

type Satir = Record<string, unknown>;
const COLL = MAGAZA_TALEP_KOLEKSIYONU;
const CID = 'kiraci-1';
const SAAT = new Date('2026-10-10T12:00:00.000Z');
const KIM = { uid: 'u-personel', ad: 'Ayşe Yılmaz', eposta: 'ayse@example.com' };
/** v3'ün kaldırılan bildirim durumu — dizge kaynakta bütün hâlde YAZILMAZ (kalıntı çiti `src/` üretim kodunu tarar). */
const KALDIRILAN_DURUM = ['gerek', 'miyor'].join('');

let db: PGlite;
let sorgular: Array<{ sql: string; params: unknown[] }> = [];
const havuz: MagazaPgHavuzu = {
  async query(sql, params = []) {
    sorgular.push({ sql, params });
    const r = await db.query<Satir>(sql, params as unknown[]);
    return { rows: r.rows };
  },
};
/** İlk eşleşen sorgudan SONRA `araya`yı koşturan havuz (okuma ile yazma arasına giren başka yazımı taklit eder). */
function arayaGiren(secici: (sql: string) => boolean, araya: () => Promise<void>): MagazaPgHavuzu {
  let yapildi = false;
  return {
    async query(sql, params) {
      const sonuc = await havuz.query(sql, params);
      if (!yapildi && secici(sql)) { yapildi = true; await araya(); }
      return sonuc;
    },
  };
}

function deps(ek: Partial<MagazaIcerikDeps> = {}) {
  const yayin = vi.fn<MagazaIcerikDeps['broadcastDocChange']>();
  const denetim = vi.fn<MagazaIcerikDeps['writeAuditLog']>(async () => undefined);
  const iste = vi.fn<MagazaIcerikDeps['bildirimIste']>(async () => undefined);
  const revizeIste = vi.fn<MagazaIcerikDeps['revizeBildirimiIste']>(async () => undefined);
  const D: MagazaIcerikDeps = {
    getPgPool: () => havuz, broadcastDocChange: yayin, writeAuditLog: denetim, bildirimIste: iste, revizeBildirimiIste: revizeIste, simdi: () => SAAT, ...ek,
  };
  return { D, yayin, denetim, iste, revizeIste };
}
const sahte = (ek: Partial<MagazaIcerikDeps> = {}) => deps(ek).D;

let sira = 0;
const kimlik = (): string => `mt-${String(++sira).padStart(32, '0')}`;
const MUSTERI = { ad: 'Şükrü Öztürk', firma: 'Işık Yapı', telefon: '0532 111 22 33', eposta: 'sukru@example.com', il: 'Antalya', adres: 'Aksu', vergi: '2470000000' };
const BEYAN = [
  { id: 'k0', sku: 'ABC', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 99.5, tedarik: false },
  { id: 'k1', sku: 'DEKOR-1325-D002', ad: 'Fırça', marka: 'Dekor', adet: 1, talepFiyat: null, tedarik: true },
  { id: 'k2', sku: '', ad: 'Rulo', marka: '', adet: 3, talepFiyat: 15, tedarik: false },
];
function taban(ek: Satir = {}): Satir {
  return {
    companyId: CID, talepNo: 'T261010-AB12', durum: 'teyit', durumSurum: 3, olusturma: '2026-10-10T09:00:00.000Z',
    durumZamani: '2026-10-10T10:00:00.000Z', durumAciklama: 'Arayacağız', istemciTarihi: null, musteri: { ...MUSTERI }, telefonSon10: '5321112233',
    not: 'kapıda ödeme', kalemler: structuredClone(BEYAN), talepEdilen: { araToplam: 244, kdv: 48.8, toplam: 292.8 }, fiyatiSorulacakVar: true,
    bildirim: { durum: 'gitti', zaman: '2026-10-10T09:00:01.000Z' }, ...ek,
  };
}
async function talep(ek: Satir = {}, id = kimlik()): Promise<string> {
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [COLL, id, JSON.stringify(taban(ek))]);
  return id;
}
async function belge(id: string): Promise<Satir> {
  const r = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [COLL, id]);
  return r.rows[0].data;
}
let urunSira = 0;
/** ERP ürün kaydı (`inventory`). `companyId` verilmezse ETİKETSİZ (alan hiç yok); `vatRate` verilmezse alan yok. */
async function urun(sku: string, ek: Satir = {}): Promise<void> {
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['inventory', `urun-${++urunSira}`, JSON.stringify({ sku, name: `Ürün ${sku}`, stockLevel: 5, ...ek })]);
}
const G = (id: string, ek: Partial<IcerikDegistirGirdisi> = {}): IcerikDegistirGirdisi => ({ id, companyId: CID, icerikSurum: 0, kim: KIM, kanal: 'erp', ...ek });
const K = (ek: Partial<IcerikTeyitKalemGirdisi> = {}): IcerikTeyitKalemGirdisi => ({ ad: 'İç cephe boyası', adet: 2, birimFiyat: 95, sku: 'ABC', ...ek });
const teyitKalemleri = (b: Satir): Array<Record<string, unknown>> => ((b.teyit as { kalemler: Array<Record<string, unknown>> }).kalemler);
const guncellemeler = (): Array<{ sql: string; params: unknown[] }> => sorgular.filter(s => s.sql.startsWith('UPDATE'));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DELETE FROM docs'); sorgular = []; });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('talepIcerigiDegistir — müşteri bilgileri ve not (§ 10.2 (a); V16, V21)', () => {
  it('not yazımı: `icerikSurum` +1, `icerikZamani`, revize bildirimi `bekliyor`; BEYAN ve diğer alanlar alan alan AYNI; yayın RETURNING satırı; denetim yalnız alan ADI', async () => {
    const id = await talep({ kalemTeslim: { 'b:0': { durum: 'teslim', zaman: '2026-10-10T11:00:00.000Z', kim: { uid: 'u', ad: 'U' } } } });
    const once = await belge(id);
    const { D, yayin, denetim, iste, revizeIste } = deps();
    const s = await talepIcerigiDegistir(D, G(id, { not: '  yeni not\r\nikinci satır  ' }));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.not).toBe('yeni not\nikinci satır');
    expect(b.icerikSurum).toBe(1);
    expect(b.icerikZamani).toBe(SAAT.toISOString());
    expect(MAGAZA_UTC_ZAMAN_DESENI.test(String(b.icerikZamani))).toBe(true);
    expect(b.bildirimRevize).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 1 });
    // Müşterinin ilk talebi ve içerik dışı her alan DOKUNULMAZ.
    for (const alan of ['kalemler', 'talepEdilen', 'fiyatiSorulacakVar', 'telefonSon10', 'talepNo', 'companyId', 'olusturma', 'istemciTarihi', 'musteri',
      'durum', 'durumSurum', 'durumZamani', 'durumAciklama', 'bildirim', 'kalemTeslim']) expect(b[alan], alan).toEqual(once[alan]);
    expect(Object.keys(b).sort()).toEqual([...Object.keys(once), 'bildirimRevize', 'icerikSurum', 'icerikZamani'].sort());
    if (s.sonuc === 'tamam') { expect(s.belge).toEqual(b); expect(s.alanlar).toEqual(['not']); }
    expect(yayin).toHaveBeenCalledTimes(1);
    expect(yayin.mock.calls[0]).toEqual([COLL, 'set', id, b, { cid: CID }]);
    expect(denetim).toHaveBeenCalledTimes(1);
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi içeriği', 'T261010-AB12 · erp · not']);
    // Revize bildirimi KENDİ kuyruğuna, tam 1 kez, yalnız talep kimliğiyle; ilk bildirimin isteyicisi çağrılmaz.
    expect(revizeIste).toHaveBeenCalledTimes(1);
    expect(revizeIste).toHaveBeenCalledWith(id);
    expect(iste).not.toHaveBeenCalled();
    // Dar okuma + tek UPDATE; `not` için ürün okuması YOK.
    expect(sorgular.map(q => q.sql.split(' ')[0])).toEqual(['SELECT', 'UPDATE']);
  });
  it('müşteri yazımı: yedi alan temizlenip yazılır; `telefonSon10`, `talepNo` ve kimlik DEĞİŞMEZ (takip ilk telefonla çalışır — V21)', async () => {
    const id = await talep();
    const yeni = { ad: '  Şükrü ÖZTÜRK ', firma: '', telefon: '0 (555) 999 88 77', eposta: 'yeni@example.com', il: 'İzmir', adres: 'Satır 1\nSatır 2', vergi: '' };
    const { D, denetim } = deps();
    expect((await talepIcerigiDegistir(D, G(id, { musteri: yeni }))).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.musteri).toEqual({ ad: 'Şükrü ÖZTÜRK', firma: '', telefon: '0 (555) 999 88 77', eposta: 'yeni@example.com', il: 'İzmir', adres: 'Satır 1\nSatır 2', vergi: '' });
    expect(b.telefonSon10).toBe('5321112233');
    expect(b.talepNo).toBe('T261010-AB12');
    expect((b.bildirimRevize as Satir).alanlar).toEqual(['musteri']);
    expect(denetim.mock.calls[0]?.[2]).toBe('T261010-AB12 · erp · musteri');
    expect('kirpildi' in b).toBe(false);
  });
  it('kırpılan metin → `kirpildi: true` yamaya girer (asla `false` yazılmaz); kırpma olmayan yazım mevcut `kirpildi`yi SİLMEZ', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'n'.repeat(1200) }))).sonuc).toBe('tamam');
    let b = await belge(id);
    expect(String(b.not)).toHaveLength(1000);
    expect(b.kirpildi).toBe(true);
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, not: 'kısa' }))).sonuc).toBe('tamam');
    b = await belge(id);
    expect(b.kirpildi).toBe(true);
    expect(JSON.parse(String(guncellemeler()[1].params[3]))).toEqual({ not: 'kısa', icerikSurum: 2, icerikZamani: SAAT.toISOString() });
  });
  it('geçersiz içerik → `gecersiz`, HİÇBİR şey yazılmaz: ad boş, telefonda 9 rakam, KISMİ müşteri nesnesi (şemasız çağrı), hiç alan yok', async () => {
    const id = await talep();
    const once = await belge(id);
    const { D, revizeIste, denetim, yayin } = deps();
    expect(await talepIcerigiDegistir(D, G(id, { musteri: { ...MUSTERI, ad: ' \t ' } }))).toEqual({ sonuc: 'gecersiz' });
    expect(await talepIcerigiDegistir(D, G(id, { musteri: { ...MUSTERI, telefon: '532 111 22 3' } }))).toEqual({ sonuc: 'gecersiz' });
    // Kısmi `musteri` şemada 400'dür (sunucuya gelmez); işlev şemasız çağrılırsa da reddeder — `||` eski alanları SİLERDİ.
    const kismi = { ad: 'Yalnız Ad', telefon: '0532 111 22 33' } as IcerikDegistirGirdisi['musteri'];
    expect(await talepIcerigiDegistir(D, G(id, { musteri: kismi }))).toEqual({ sonuc: 'gecersiz' });
    sorgular = [];
    expect(await talepIcerigiDegistir(D, G(id))).toEqual({ sonuc: 'gecersiz' });
    expect(sorgular).toEqual([]);   // en az bir alan yoksa veritabanına gidilmez
    expect(await belge(id)).toEqual(once);
    expect(revizeIste).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled();
    expect(guncellemeler()).toEqual([]);
  });
  it('bayat `icerikSurum` → `surum-eski` + güncel sürüm; belge değişmez; okuma ile yazma ARASINA giren içerik yazımı da `surum-eski`', async () => {
    const id = await talep({ icerikSurum: 4 });
    const once = await belge(id);
    const { D, revizeIste, denetim, yayin } = deps();
    expect(await talepIcerigiDegistir(D, G(id, { icerikSurum: 3, not: 'x' }))).toEqual({ sonuc: 'surum-eski', icerikSurum: 4 });
    expect(await talepIcerigiDegistir(D, G(id, { icerikSurum: 5, not: 'x' }))).toEqual({ sonuc: 'surum-eski', icerikSurum: 4 });
    expect(await belge(id)).toEqual(once);
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 4, not: 'araya giren' }))).sonuc).toBe('tamam');
    });
    expect(await talepIcerigiDegistir(deps({ getPgPool: () => h }).D, G(id, { icerikSurum: 4, not: 'kaybeden' }))).toEqual({ sonuc: 'surum-eski', icerikSurum: 5 });
    expect((await belge(id)).not).toBe('araya giren');
    expect(revizeIste).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled();
  });
  it('iki sayaç BAĞIMSIZ: aşama yazımı `icerikSurum`\'u, içerik yazımı `durumSurum`\'u artırmaz; biri öbürünün yazımını düşürmez', async () => {
    const id = await talep();
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teyit', surum: 3, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    let b = await belge(id);
    expect(b.durumSurum).toBe(4);
    expect('icerikSurum' in b).toBe(false);
    expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'içerik' }))).sonuc).toBe('tamam');
    b = await belge(id);
    expect(b.durumSurum).toBe(4);
    expect(b.icerikSurum).toBe(1);
    expect(b.durum).toBe('hazirlaniyor');
    // Ekranında eski `icerikSurum` DEĞİL eski `durumSurum` olan aşama yazımı içerik yazımından ETKİLENMEZ (ve tersi).
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'hazirlaniyor', surum: 4, yeni: 'sevk', kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, not: 'ikinci' }))).sonuc).toBe('tamam');
    b = await belge(id);
    expect([b.durumSurum, b.icerikSurum, b.durum, b.not]).toEqual([5, 2, 'sevk', 'ikinci']);
  });
  it('silinmiş belgeye içerik yazımı → `silindi`, belge değişmez (bayat sürümle de); okuma ile yazma arasına giren silme de `silindi`', async () => {
    const SILINDI = { zaman: '2026-10-10T11:30:00.000Z', kim: { uid: 'u-y', ad: 'Yönetici' }, kanal: 'erp' };
    const id = await talep({ silindi: SILINDI });
    const once = await belge(id);
    const { D, revizeIste } = deps();
    expect(await talepIcerigiDegistir(D, G(id, { not: 'x' }))).toEqual({ sonuc: 'silindi' });
    expect(await talepIcerigiDegistir(D, G(id, { icerikSurum: 9, musteri: MUSTERI, teyit: { kalemler: [K()] } }))).toEqual({ sonuc: 'silindi' });
    expect(await belge(id)).toEqual(once);
    const id2 = await talep();
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query('UPDATE docs SET data = data || $3::jsonb WHERE coll = $1 AND id = $2', [COLL, id2, JSON.stringify({ silindi: SILINDI })]);
    });
    expect(await talepIcerigiDegistir(deps({ getPgPool: () => h }).D, G(id2, { not: 'x' }))).toEqual({ sonuc: 'silindi' });
    expect((await belge(id2)).not).toBe('kapıda ödeme');
    expect(revizeIste).not.toHaveBeenCalled();
    // Geri alınmış (`silindi: null`) talebe yazılır.
    const id3 = await talep({ silindi: null });
    expect((await talepIcerigiDegistir(sahte(), G(id3, { not: 'x' }))).sonuc).toBe('tamam');
  });
  it('başka kiracı → bulunamadi; bozuk kimlik → sorgu 0; havuz yoksa FIRLATIR; yayın / denetim / kuyruk arızası yazımı GERİ ALMAZ', async () => {
    const id = await talep();
    expect(await talepIcerigiDegistir(sahte(), G(id, { companyId: 'kiraci-2', not: 'x' }))).toEqual({ sonuc: 'bulunamadi' });
    expect(await talepIcerigiDegistir(sahte(), G('mt-ffffffffffffffffffffffffffffffff', { not: 'x' }))).toEqual({ sonuc: 'bulunamadi' });
    sorgular = [];
    expect(await talepIcerigiDegistir(sahte(), G('mt-bozuk', { not: 'x' }))).toEqual({ sonuc: 'bulunamadi' });
    expect(sorgular).toEqual([]);
    await expect(talepIcerigiDegistir(sahte({ getPgPool: () => null }), G(id, { not: 'x' }))).rejects.toThrow(/havuzu yok/);
    expect((await belge(id)).not).toBe('kapıda ödeme');
    const s = await talepIcerigiDegistir(sahte({
      broadcastDocChange: () => { throw new Error('akış yok'); },
      writeAuditLog: async () => { throw new Error('denetim yok'); },
      revizeBildirimiIste: async () => { throw new Error('kuyruk yok'); },
    }), G(id, { not: 'yazıldı' }));
    expect(s.sonuc).toBe('tamam');
    expect((await belge(id)).not).toBe('yazıldı');
    expect(((await belge(id)).bildirimRevize as Satir).durum).toBe('bekliyor');   // kaçan süpürmesi sahiplenir
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('talepIcerigiDegistir — «ne değişti» sunucuda ölçülür; değişiklik yoksa yazım YOK (kapı 3, K13)', () => {
  it('aynı gövdenin ikinci yazımı → `degisiklik-yok`: `icerikSurum` / `icerikZamani` / `bildirimRevize` AYNEN; bildirim 0, denetim 0, yayın 0, UPDATE 0', async () => {
    const id = await talep();
    const ilk = await talepIcerigiDegistir(sahte(), G(id, { musteri: { ...MUSTERI, il: 'Burdur' }, not: 'yeni', teyit: { kalemler: [K({ kdvOrani: 10 }), K({ ad: 'Fırça', adet: 1, birimFiyat: null, sku: '', kdvOrani: 20 })] } }));
    expect(ilk.sonuc).toBe('tamam');
    const once = await belge(id);
    const anahtarlar = teyitKalemleri(once).map(k => String(k.anahtar));
    // Form akıştan gelen `t:` anahtarlarıyla TAM gövdeyi yeniden gönderir.
    const ayniGovde = G(id, {
      icerikSurum: 1, musteri: { ...MUSTERI, il: 'Burdur' }, not: 'yeni',
      teyit: { kalemler: [K({ anahtar: anahtarlar[0], kdvOrani: 10 }), K({ anahtar: anahtarlar[1], ad: 'Fırça', adet: 1, birimFiyat: null, sku: '', kdvOrani: 20 })] },
    });
    sorgular = [];
    const { D, yayin, denetim, iste, revizeIste } = deps({ simdi: () => new Date(SAAT.getTime() + 60_000) });
    expect(await talepIcerigiDegistir(D, ayniGovde)).toEqual({ sonuc: 'degisiklik-yok' });
    expect(await belge(id)).toEqual(once);
    expect(guncellemeler()).toEqual([]);
    expect(revizeIste).not.toHaveBeenCalled(); expect(iste).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled();
  });
  it('yalnız `not` değişince `alanlar: [\'not\']` (gövdede `musteri` ve `teyit` de gönderilmiş olsa bile); `teyit.zaman` / `teyit.kim` notu düzenleyene GEÇMEZ', async () => {
    const id = await talep();
    const ILK_KIM = { uid: 'u-teyit', ad: 'Teyit Eden', eposta: 't@example.com' };
    expect((await talepIcerigiDegistir(sahte({ simdi: () => new Date('2026-10-10T08:00:00.000Z') }), G(id, { kim: ILK_KIM, teyit: { kalemler: [K({ kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const once = await belge(id);
    const anahtar = String(teyitKalemleri(once)[0].anahtar);
    sorgular = [];
    const { D, denetim } = deps();
    const s = await talepIcerigiDegistir(D, G(id, { icerikSurum: 1, musteri: { ...MUSTERI }, not: 'yalnız not değişti', teyit: { kalemler: [K({ anahtar, kdvOrani: 20 })] } }));
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc === 'tamam') expect(s.alanlar).toEqual(['not']);
    const b = await belge(id);
    expect(b.teyit).toEqual(once.teyit);   // zaman 08:00 ve kim «Teyit Eden» KORUNDU
    expect(b.musteri).toEqual(once.musteri);
    expect(denetim.mock.calls[0]?.[2]).toBe('T261010-AB12 · erp · not');
    // Yama yalnız değişen alanı taşır.
    expect(Object.keys(JSON.parse(String(guncellemeler()[0].params[3])) as object).sort()).toEqual(['icerikSurum', 'icerikZamani', 'not']);
    expect(guncellemeler()[0].params[7]).toBe('["not"]');
  });
  it('dar okuma verilen alanlara göre DİNAMİK: verilmeyen alanın eski değeri SELECT\'e girmez; ürün okuması yalnız teyitte', async () => {
    const id = await talep();
    await talepIcerigiDegistir(sahte(), G(id, { not: 'a' }));
    expect(sorgular[0].sql).toContain("data->>'not' AS eski_not");
    expect(sorgular[0].sql).not.toMatch(/eski_musteri|teyit_kalemleri|beyan_sayisi/);
    sorgular = [];
    await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, musteri: { ...MUSTERI, il: 'Isparta' } }));
    expect(sorgular[0].sql).toContain("data->'musteri' AS eski_musteri");
    expect(sorgular[0].sql).not.toMatch(/eski_not|teyit_kalemleri|beyan_sayisi/);
    sorgular = [];
    await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, teyit: { kalemler: [K()] } }));
    expect(sorgular[0].sql).toMatch(/teyit_kalemleri.*beyan_sayisi/);
    expect(sorgular[0].sql).not.toMatch(/eski_musteri|eski_not/);
    expect(sorgular.map(q => q.sql)).toEqual([sorgular[0].sql, URUN_KDV_SQL, ICERIK_SQL]);
    // Hiçbir dar okuma belgenin tamamını ya da içerik dışı alanları çekmez.
    for (const q of sorgular.filter(x => x.sql.startsWith('SELECT') && x.sql !== URUN_KDV_SQL)) expect(q.sql).not.toMatch(/SELECT data FROM|SELECT \*|talepEdilen|bildirim|kalemTeslim|durumGecmisi/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('talepIcerigiDegistir — teyit edilen kalemler, toplamlar ve KDV oranı (V19; § 10.2 (a) 3)', () => {
  it('KULLANICI ÖRNEĞİ: 2 × 95,00 + 1 × 40,00, %20 → kayıtlı ara toplam 230,00 · KDV 46,00 · toplam 276,00; BEYAN (`kalemler`, `talepEdilen`) alan alan AYNI', async () => {
    const id = await talep();
    const once = await belge(id);
    const s = await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ kdvOrani: 20 }), K({ ad: 'Fırça', sku: 'DEF', adet: 1, birimFiyat: 40, kdvOrani: 20, marka: 'Dekor', id: 'k9', tedarik: true })] } }));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    const teyit = b.teyit as Satir;
    expect({ araToplam: teyit.araToplam, kdv: teyit.kdv, toplam: teyit.toplam }).toEqual({ araToplam: 230, kdv: 46, toplam: 276 });
    expect(teyit.zaman).toBe(SAAT.toISOString());
    expect(teyit.kim).toEqual({ uid: KIM.uid, ad: KIM.ad });
    const [k0, k1] = teyitKalemleri(b);
    expect(k0).toEqual({ anahtar: k0.anahtar, id: '', sku: 'ABC', ad: 'İç cephe boyası', marka: '', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'personel', tedarik: false });
    expect(k1).toEqual({ anahtar: k1.anahtar, id: 'k9', sku: 'DEF', ad: 'Fırça', marka: 'Dekor', adet: 1, birimFiyat: 40, kdvOrani: 20, kdvKaynagi: 'personel', tedarik: true });
    for (const k of [k0, k1]) expect(String(k.anahtar)).toMatch(/^t:[0-9a-f]{12}$/);
    expect(k0.anahtar).not.toBe(k1.anahtar);
    // V16: müşterinin ilk talebi hiçbir yazma yolunda değişmez — ekran iki tabloyu yan yana basar.
    expect(b.kalemler).toEqual(once.kalemler);
    expect(b.talepEdilen).toEqual(once.talepEdilen);
    expect(b.fiyatiSorulacakVar).toBe(once.fiyatiSorulacakVar);
    expect((b.bildirimRevize as Satir).alanlar).toEqual(['teyit']);
    // İstemciden toplam ALINMAZ: yamadaki toplamlar sunucunun türettiğidir (gövdede toplam alanı yok; tip de kabul etmez).
    expect(Object.keys(JSON.parse(String(guncellemeler()[0].params[3])) as object).sort()).toEqual(['icerikSurum', 'icerikZamani', 'teyit']);
  });
  it('kalem başına farklı oran: 2 × 95,00 (%20) + 1 × 40,00 (%10) → 230,00 / 42,00 / 272,00; herhangi bir fiyat `null` → üç toplam da `null` (sıfır DEĞİL)', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ kdvOrani: 20 }), K({ adet: 1, birimFiyat: 40, kdvOrani: 10 })] } }))).sonuc).toBe('tamam');
    let teyit = (await belge(id)).teyit as Satir;
    expect([teyit.araToplam, teyit.kdv, teyit.toplam]).toEqual([230, 42, 272]);
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ kdvOrani: 20 }), K({ adet: 1, birimFiyat: null, kdvOrani: 10 })] } }))).sonuc).toBe('tamam');
    teyit = (await belge(id)).teyit as Satir;
    expect([teyit.araToplam, teyit.kdv, teyit.toplam]).toEqual([null, null, null]);
    expect(teyitKalemleri(await belge(id))[1].birimFiyat).toBeNull();
    // Anahtarlar JSON'da DURUR (`null` değerle): okuyan «alan yok» ile «fiyat sorulacak»ı karıştırmaz.
    for (const alan of ['araToplam', 'kdv', 'toplam']) expect(alan in teyit, alan).toBe(true);
  });
  it('`kdvOrani` verilmeyen kalem ürün kaydından çözülür: eşleşen SKU (10) → `urun`; eşleşmeyen / küme dışı (18) / `vatRate` yok / dizge oran / SKU\'suz → 20 + `varsayilan`', async () => {
    await urun('ABC', { companyId: CID, vatRate: 10 });
    await urun('ESKI', { companyId: CID, vatRate: 18 });
    await urun('ORANSIZ', { companyId: CID });
    await urun('DIZGE', { companyId: CID, vatRate: '10' });
    const id = await talep();
    const kalemler = [K({ sku: 'ABC' }), K({ sku: 'YOK' }), K({ sku: 'ESKI' }), K({ sku: 'ORANSIZ' }), K({ sku: 'DIZGE' }), K({ sku: '' }), K({ sku: undefined })];
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([
      ['ABC', 10, 'urun'], ['YOK', 20, 'varsayilan'], ['ESKI', 20, 'varsayilan'], ['ORANSIZ', 20, 'varsayilan'], ['DIZGE', 20, 'varsayilan'], ['', 20, 'varsayilan'], ['', 20, 'varsayilan'],
    ]);
    // TEK dar sorgu; SKU'suz kalem sorguya GİRMEZ; yalnız kiracı + SKU dizisi parametre.
    const urunSorgulari = sorgular.filter(q => q.sql === URUN_KDV_SQL);
    expect(urunSorgulari).toHaveLength(1);
    expect(urunSorgulari[0].params).toEqual([CID, ['ABC', 'YOK', 'ESKI', 'ORANSIZ', 'DIZGE']]);
    // Toplam kalem oranlarıyla: 7 × (2 × 95,00) = 1.330,00; KDV 19,00 (%10) + 6 × 38,00 (%20) = 247,00.
    const teyit = (await belge(id)).teyit as Satir;
    expect([teyit.araToplam, teyit.kdv, teyit.toplam]).toEqual([1330, 247, 1577]);
  });
  it('aynı SKU için iki ürün satırı FARKLI oranla → `varsayilan` (ilk satır seçilmez); aynı oranla → o oran', async () => {
    await urun('CELISKI', { companyId: CID, vatRate: 10 });
    await urun('CELISKI', { companyId: CID, vatRate: 20 });
    await urun('UYUMLU', { companyId: CID, vatRate: 1 });
    await urun('UYUMLU', { vatRate: 1 });
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ sku: 'CELISKI' }), K({ sku: 'UYUMLU' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.kdvOrani, k.kdvKaynagi])).toEqual([[20, 'varsayilan'], [1, 'urun']]);
  });
  it('kiracı kalıbı (kapı 4, Y11): başka kiracının ürün kaydı EŞLEŞMEZ; etiketsiz, `companyId: \'\'` ve `companyId: null` kart KENDİ sayılır', async () => {
    await urun('YABANCI', { companyId: 'kiraci-2', vatRate: 10 });
    await urun('ETIKETSIZ', { vatRate: 10 });
    await urun('BOS-ETIKET', { companyId: '', vatRate: 1 });
    await urun('NULL-ETIKET', { companyId: null, vatRate: 0 });
    // Başka koleksiyondaki aynı SKU okunmaz.
    await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['products', 'p1', JSON.stringify({ sku: 'BASKA-KOLEKSIYON', companyId: CID, vatRate: 10 })]);
    const id = await talep();
    const kalemler = ['YABANCI', 'ETIKETSIZ', 'BOS-ETIKET', 'NULL-ETIKET', 'BASKA-KOLEKSIYON'].map(sku => K({ sku }));
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([
      ['YABANCI', 20, 'varsayilan'], ['ETIKETSIZ', 10, 'urun'], ['BOS-ETIKET', 1, 'urun'], ['NULL-ETIKET', 0, 'urun'], ['BASKA-KOLEKSIYON', 20, 'varsayilan'],
    ]);
    // Yabancı kiracının kendi yazımı kendi kartını görür (koşul kiracıya bağlı, sabit değil).
    const yabanci = await talep({ companyId: 'kiraci-2' });
    expect((await talepIcerigiDegistir(sahte(), G(yabanci, { companyId: 'kiraci-2', teyit: { kalemler: [K({ sku: 'YABANCI' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(yabanci)).map(k => [k.kdvOrani, k.kdvKaynagi])).toEqual([[10, 'urun']]);
  });
  it('paket SKU\'su: `DEKOR-1325-D002` kalemi envanterde yalnız `DEKOR-1325` (10) varken → 10 + `urun` (sorgu dizisinde iki değer); birebir kart varsa O kazanır', async () => {
    await urun('DEKOR-1325', { companyId: CID, vatRate: 10 });
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ sku: 'DEKOR-1325-D002' }), K({ sku: 'X-D12' }), K({ sku: 'X-D1234' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([['DEKOR-1325-D002', 10, 'urun'], ['X-D12', 20, 'varsayilan'], ['X-D1234', 20, 'varsayilan']]);
    // Yalnız TAM üç rakamlı son ek taban üretir: `X-D12` / `X-D1234` için taban sorgulanmaz.
    expect(sorgular.find(q => q.sql === URUN_KDV_SQL)?.params).toEqual([CID, ['DEKOR-1325-D002', 'DEKOR-1325', 'X-D12', 'X-D1234']]);
    await urun('DEKOR-1325-D002', { companyId: CID, vatRate: 20 });
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ sku: 'DEKOR-1325-D002' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.kdvOrani, k.kdvKaynagi])).toEqual([[20, 'urun']]);
  });
  it('`kdvOrani: 10` verilen kalem → `personel` (o kalem için ürün okuması koşmaz — hepsi verilmişse sorgu HİÇ yok); `kdvOrani: 18` → `gecersiz`, hiçbir şey yazılmaz', async () => {
    await urun('ABC', { companyId: CID, vatRate: 20 });
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ kdvOrani: 10 }), K({ kdvOrani: 0, sku: 'YOK' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.kdvOrani, k.kdvKaynagi])).toEqual([[10, 'personel'], [0, 'personel']]);
    expect(sorgular.filter(q => q.sql === URUN_KDV_SQL)).toEqual([]);
    // Karışık: yalnız oranı verilmeyen kalemin SKU'su sorgulanır.
    sorgular = [];
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ kdvOrani: 10, sku: 'PERSONEL' }), K({ sku: 'ABC' })] } }))).sonuc).toBe('tamam');
    expect(sorgular.find(q => q.sql === URUN_KDV_SQL)?.params).toEqual([CID, ['ABC']]);
    const once = await belge(id);
    sorgular = [];
    for (const kdvOrani of [18, 8, 20.5, -1, Number.NaN]) {
      expect(await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, teyit: { kalemler: [K(), K({ kdvOrani })] } })), String(kdvOrani)).toEqual({ sonuc: 'gecersiz' });
    }
    expect(await belge(id)).toEqual(once);
    expect(guncellemeler()).toEqual([]);
    expect(sorgular.filter(q => q.sql === URUN_KDV_SQL)).toEqual([]);   // geçersiz gövdede ürün okuması bile yapılmaz
  });
  it('ürün KDV okuması FIRLATIRSA işlev FIRLATIR ve belge DEĞİŞMEZ (varsayılan 20 ile sessizce yazılmaz — rota 503)', async () => {
    const id = await talep();
    const once = await belge(id);
    const bozuk: MagazaPgHavuzu = { async query(sql, params) { if (sql === URUN_KDV_SQL) throw Object.assign(new Error('bağlantı koptu'), { code: '08006' }); return havuz.query(sql, params); } };
    const { D, revizeIste, denetim, yayin } = deps({ getPgPool: () => bozuk });
    await expect(talepIcerigiDegistir(D, G(id, { not: 'bu da yazılmamalı', teyit: { kalemler: [K()] } }))).rejects.toThrow('bağlantı koptu');
    expect(await belge(id)).toEqual(once);
    expect(revizeIste).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled();
  });
  it('personelin daha önce SEÇTİĞİ oran, oran gönderilmeyen sonraki yazımda KORUNUR (ürün varsayılanına sessizce dönmez); `urun` / `varsayilan` kaynaklı kalem de stok kodu değişmedikçe KORUNUR', async () => {
    await urun('ABC', { companyId: CID, vatRate: 20 });
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ kdvOrani: 10 }), K({ sku: 'SONRADAN' })] } }))).sonuc).toBe('tamam');
    const [p, v] = teyitKalemleri(await belge(id));
    expect([[p.kdvOrani, p.kdvKaynagi], [v.kdvOrani, v.kdvKaynagi]]).toEqual([[10, 'personel'], [20, 'varsayilan']]);
    // Ürün kaydı sonradan eşlendi (Mikro stok kodu eşlemesi): `varsayilan` kalem kendiliğinden ürün oranına DÖNMEZ (inceleme 2b,
    // bulgu 1 — bilerek değişen çit: eskiden bir sonraki yazımda 1 + `urun` oluyordu). Kalem «varsayılan» imiyle kalır; oranı personel seçer.
    await urun('SONRADAN', { companyId: CID, vatRate: 1 });
    sorgular = [];
    const s = await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, not: 'yalnız not', teyit: { kalemler: [K({ anahtar: String(p.anahtar) }), K({ anahtar: String(v.anahtar), sku: 'SONRADAN' })] } }));
    expect(s.sonuc).toBe('tamam');
    const [p2, v2] = teyitKalemleri(await belge(id));
    expect([p2.kdvOrani, p2.kdvKaynagi]).toEqual([10, 'personel']);   // ürün kaydı 20 dese de personelin seçimi durur
    expect([v2.kdvOrani, v2.kdvKaynagi]).toEqual([20, 'varsayilan']);
    // İki kalem de korundu: ürün okuması HİÇ koşmaz.
    expect(sorgular.find(q => q.sql === URUN_KDV_SQL)).toBeUndefined();
    // Personel açıkça başka oran seçerse o yazılır; seçilmeyen `varsayilan` kalem yine kayıtlı oranıyla durur.
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, teyit: { kalemler: [K({ anahtar: String(p.anahtar), kdvOrani: 20 }), K({ anahtar: String(v.anahtar), sku: 'SONRADAN' })] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.kdvOrani, k.kdvKaynagi])).toEqual([[20, 'personel'], [20, 'varsayilan']]);
  });
  it('(inceleme 2b, bulgu 1) envanter ARADA değişti + yalnız not düzenlendi → `alanlar: [\'not\']`; teyit (kalemler, üç toplam, `zaman`, `kim`) AYNEN; ürün okuması HİÇ koşmaz', async () => {
    await urun('ABC', { companyId: CID, vatRate: 20 });
    await urun('DEF', { companyId: CID, vatRate: 10 });
    const id = await talep();
    const ILK_KIM = { uid: 'u-teyit', ad: 'Teyit Eden', eposta: 't@example.com' };
    // İlk teyit: oran GÖNDERİLMEDİ → ikisi de ürün kaydından (`urun`); üçüncü kalemin kartı yok → 20 + `varsayilan`.
    const ilk = await talepIcerigiDegistir(sahte({ simdi: () => new Date('2026-10-10T08:00:00.000Z') }), G(id, {
      kim: ILK_KIM, teyit: { kalemler: [K(), K({ ad: 'Fırça', sku: 'DEF', adet: 1, birimFiyat: 40 }), K({ ad: 'Rulo', sku: 'KARTSIZ', adet: 1, birimFiyat: 10 })] },
    }));
    expect(ilk.sonuc).toBe('tamam');
    const once = await belge(id);
    expect(teyitKalemleri(once).map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([['ABC', 20, 'urun'], ['DEF', 10, 'urun'], ['KARTSIZ', 20, 'varsayilan']]);
    // 190,00 + 40,00 + 10,00 = 240,00 · KDV 38,00 + 4,00 + 2,00 = 44,00 · 284,00
    expect([(once.teyit as Satir).araToplam, (once.teyit as Satir).kdv, (once.teyit as Satir).toplam]).toEqual([240, 44, 284]);
    // Envanter değişti: ABC'nin oranı 20 → 10, DEF'in kartı silindi, kartsız kaleme kart açıldı (%1).
    await db.query(`UPDATE docs SET data = data || '{"vatRate": 10}'::jsonb WHERE coll = 'inventory' AND data->>'sku' = 'ABC'`);
    await db.query(`DELETE FROM docs WHERE coll = 'inventory' AND data->>'sku' = 'DEF'`);
    await urun('KARTSIZ', { companyId: CID, vatRate: 1 });
    const anahtarlar = teyitKalemleri(once).map(k => String(k.anahtar));
    sorgular = [];
    const { D, denetim, revizeIste } = deps();
    // Form tam gövdeyi yeniden gönderir: aynı kalemler, aynı `t:` anahtarları, oran YOK (bu oturumda seçilmedi).
    const s = await talepIcerigiDegistir(D, G(id, {
      icerikSurum: 1, musteri: { ...MUSTERI }, not: 'yalnız not değişti',
      teyit: { kalemler: [K({ anahtar: anahtarlar[0] }), K({ anahtar: anahtarlar[1], ad: 'Fırça', sku: 'DEF', adet: 1, birimFiyat: 40 }), K({ anahtar: anahtarlar[2], ad: 'Rulo', sku: 'KARTSIZ', adet: 1, birimFiyat: 10 })] },
    }));
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc === 'tamam') expect(s.alanlar).toEqual(['not']);
    const b = await belge(id);
    expect(b.teyit).toEqual(once.teyit);                                   // kalemler, 240 / 44 / 284, zaman 08:00 — alan alan AYNI
    expect((b.teyit as Satir).kim).toEqual({ uid: ILK_KIM.uid, ad: ILK_KIM.ad });   // teyit notu düzenleyene GEÇMEDİ
    expect((b.teyit as Satir).zaman).toBe('2026-10-10T08:00:00.000Z');
    expect(b.not).toBe('yalnız not değişti');
    // Bu yazımın revize alanı yalnız `not` ($8); saklanan liste ilk teyidin hâlâ `bekliyor` duran bildirimiyle birleşiktir.
    expect(guncellemeler()[0].params[7]).toBe('["not"]');
    expect((b.bildirimRevize as Satir).alanlar).toEqual(['teyit', 'not']);
    expect(sorgular.filter(q => q.sql === URUN_KDV_SQL)).toEqual([]);
    expect(Object.keys(JSON.parse(String(guncellemeler()[0].params[3])) as object).sort()).toEqual(['icerikSurum', 'icerikZamani', 'not']);
    expect(denetim.mock.calls[0]?.[2]).toBe('T261010-AB12 · erp · not');
    expect(revizeIste).toHaveBeenCalledTimes(1);
    // Aynı gövdenin (not dâhil) bir kez daha gönderilmesi: hiçbir alan değişmedi → yazım YOK (envanter farkı «değişiklik» üretmez).
    sorgular = [];
    expect(await talepIcerigiDegistir(sahte(), G(id, {
      icerikSurum: 2, not: 'yalnız not değişti',
      teyit: { kalemler: [K({ anahtar: anahtarlar[0] }), K({ anahtar: anahtarlar[1], ad: 'Fırça', sku: 'DEF', adet: 1, birimFiyat: 40 }), K({ anahtar: anahtarlar[2], ad: 'Rulo', sku: 'KARTSIZ', adet: 1, birimFiyat: 10 })] },
    }))).toEqual({ sonuc: 'degisiklik-yok' });
    expect(guncellemeler()).toEqual([]);
  });
  it('(inceleme 2b, bulgu 1) mevcut kalemin STOK KODU değişti → o kalem YENİDEN çözülür (yeni kalem ve beyandan kopya da); dokunulmayan `varsayilan` / `personel` kalem korunur; açık seçim kazanır', async () => {
    await urun('YENI', { companyId: CID, vatRate: 1 });
    await urun('YENI2', { companyId: CID, vatRate: 0 });
    await urun('DEKOR-1325', { companyId: CID, vatRate: 10 });
    const id = await talep();
    // İlk teyit: ABC'nin kartı yok → 20 + `varsayilan`; PQR personel seçimi (%10); ESKI'nin kartı yok → 20 + `varsayilan`.
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K(), K({ sku: 'PQR', kdvOrani: 10 }), K({ sku: 'ESKI' })] } }))).sonuc).toBe('tamam');
    const [abc, pqr, eski] = teyitKalemleri(await belge(id));
    expect([abc, pqr, eski].map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([['ABC', 20, 'varsayilan'], ['PQR', 10, 'personel'], ['ESKI', 20, 'varsayilan']]);
    // ABC'ye sonradan kart açıldı (%10): dokunulmayan kalemin oranını DEĞİŞTİRMEZ.
    await urun('ABC', { companyId: CID, vatRate: 10 });
    sorgular = [];
    const s = await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [
      K({ anahtar: String(abc.anahtar) }),                          // dokunulmadı → 20 / varsayilan
      K({ anahtar: String(pqr.anahtar), sku: 'PQR' }),              // dokunulmadı → 10 / personel
      K({ anahtar: String(eski.anahtar), sku: 'YENI' }),            // STOK KODU değişti → yeniden çözülür (%1, `urun`)
      K({ sku: 'YENI2' }),                                          // yeni kalem → çözülür (%0, `urun`)
      K({ anahtar: 'b:1', sku: 'DEKOR-1325-D002', ad: 'Fırça' }),   // beyandan kopya → çözülür (taban kart %10, `urun`)
    ] } }));
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc === 'tamam') expect(s.alanlar).toEqual(['teyit']);
    const sonra = teyitKalemleri(await belge(id));
    expect(sonra.map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([
      ['ABC', 20, 'varsayilan'], ['PQR', 10, 'personel'], ['YENI', 1, 'urun'], ['YENI2', 0, 'urun'], ['DEKOR-1325-D002', 10, 'urun'],
    ]);
    expect(sonra.slice(0, 3).map(k => k.anahtar)).toEqual([abc.anahtar, pqr.anahtar, eski.anahtar]);   // anahtar KAYMADI (stok kodu değişse de aynı kalem)
    // TEK ürün sorgusu ve YALNIZ yeniden çözülen kalemlerin kodları: korunan ABC / PQR sorguya GİRMEZ.
    const urunSorgulari = sorgular.filter(q => q.sql === URUN_KDV_SQL);
    expect(urunSorgulari).toHaveLength(1);
    expect(urunSorgulari[0].params).toEqual([CID, ['YENI', 'YENI2', 'DEKOR-1325-D002', 'DEKOR-1325']]);
    // Stok kodu ESKİ değerine dönen kalem de «değişen» kalemdir (kayıtlı kod YENI): yeniden çözülür — ESKI'nin kartı yok → 20 + `varsayilan`.
    sorgular = [];
    const anahtarlar = sonra.map(k => String(k.anahtar));
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, teyit: { kalemler: [
      K({ anahtar: anahtarlar[0], kdvOrani: 10 }),                  // AÇIK seçim: kayıtlı `varsayilan` 20'yi ezer → 10 / personel
      K({ anahtar: anahtarlar[1], sku: 'PQR' }),
      K({ anahtar: anahtarlar[2], sku: 'ESKI' }),
      K({ anahtar: anahtarlar[3], sku: 'YENI2' }),                  // `urun` kaynaklı, kod aynı → korunur (sorguya girmez)
      K({ anahtar: anahtarlar[4], sku: 'DEKOR-1325-D002', ad: 'Fırça' }),
    ] } }))).sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => [k.sku, k.kdvOrani, k.kdvKaynagi])).toEqual([
      ['ABC', 10, 'personel'], ['PQR', 10, 'personel'], ['ESKI', 20, 'varsayilan'], ['YENI2', 0, 'urun'], ['DEKOR-1325-D002', 10, 'urun'],
    ]);
    expect(sorgular.filter(q => q.sql === URUN_KDV_SQL).map(q => q.params)).toEqual([[CID, ['ESKI']]]);
  });
  it('geçersiz kalem → `gecersiz`, hiçbir şey yazılmaz: boş dizi, ad boş, adet 0 / kesirli / eksi, fiyat eksi / NaN / sonsuz', async () => {
    const id = await talep();
    const once = await belge(id);
    const kotu: IcerikTeyitKalemGirdisi[][] = [
      [], [K({ ad: '  ' })], [K({ adet: 0 })], [K({ adet: 1.5 })], [K({ adet: -2 })], [K({ adet: Number.NaN })],
      [K({ birimFiyat: -1 })], [K({ birimFiyat: Number.NaN })], [K({ birimFiyat: Number.POSITIVE_INFINITY })], [K(), K({ ad: '' })],
    ];
    for (const kalemler of kotu) expect(await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler } })), JSON.stringify(kalemler)).toEqual({ sonuc: 'gecersiz' });
    expect(await belge(id)).toEqual(once);
    expect(guncellemeler()).toEqual([]);
  });
  it('kalem metinleri dilim 1 kuralıyla temizlenir / kırpılır (aynı eşleyici): 250 birimlik ad 200\'e iner ve `kirpildi: true`', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ ad: `  ${'a'.repeat(250)}\r\n`, marka: 'Mar\tka', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(String(teyitKalemleri(b)[0].ad)).toHaveLength(200);
    expect(teyitKalemleri(b)[0].marka).toBe('Mar ka');
    expect(b.kirpildi).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('teyit kalemi anahtarı ve teslim işaretinin taşınması (madde 2; § 10.2 (a) 3–4)', () => {
  const ISARET = { durum: 'teslim', zaman: '2026-10-10T11:00:00.000Z', kim: { uid: 'u-depo', ad: 'Depo' } };

  it('ŞARTNAME SENARYOSU: 3 beyan kalemi, `b:1` teslim → teyit [b:1, b:0, yeni] → üç ayrı `t:`; b:1\'in işareti yeni anahtara kim / zamanla KOPYALANIR; beyan girişi DURUR', async () => {
    const id = await talep();
    expect((await kalemTeslimYaz(sahte({ simdi: () => new Date(ISARET.zaman) }), { id, companyId: CID, surum: 3, teslim: true, kalemler: ['b:1'], kim: { uid: 'u-depo', ad: 'Depo', eposta: 'd@example.com' }, kanal: 'panel' })).sonuc).toBe('tamam');
    const onceIsaret = (await belge(id)).kalemTeslim as Satir;
    expect(onceIsaret).toEqual({ 'b:1': ISARET });
    const s = await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ anahtar: 'b:1', ad: 'Fırça', kdvOrani: 20 }), K({ anahtar: 'b:0', kdvOrani: 20 }), K({ ad: 'yeni', kdvOrani: 20 })] } }));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    const anahtarlar = teyitKalemleri(b).map(k => String(k.anahtar));
    expect(new Set(anahtarlar).size).toBe(3);
    for (const a of anahtarlar) { expect(a).toMatch(/^t:[0-9a-f]{12}$/); expect(MAGAZA_KALEM_ANAHTARI_DESENI.test(a)).toBe(true); }
    const kt = b.kalemTeslim as Record<string, unknown>;
    expect(kt[anahtarlar[0]]).toEqual(ISARET);          // b:1'in yeni anahtarı: işaret AYNEN (kim / zaman beyan girişiyle aynı)
    expect(anahtarlar[1] in kt).toBe(false);            // b:0 işaretsizdi → giriş yok (bekliyor)
    expect(anahtarlar[2] in kt).toBe(false);            // anahtarsız yeni kalem → giriş yok
    expect(kt['b:1']).toEqual(ISARET);                  // beyan girişi SİLİNMEDİ (tarihçe)
    expect(Object.keys(kt).sort()).toEqual(['b:1', anahtarlar[0]].sort());
    expect(magazaTeslimKaynagi(b)).toBe('teyit');
    expect(magazaKalemAnahtarlari(b)).toEqual(anahtarlar);
    expect(magazaTeslimIsaretsiz(b)).toBe(2);
    expect(b.durumSurum).toBe(4);   // içerik yazımı aşama sayacını ARTIRMADI (4 = kalem teslim yazımından)
    expect(b.kalemler).toEqual(structuredClone(BEYAN));

    // Kaynak artık teyit: `t:` anahtarıyla yazım tamam; `b:` anahtarı öbür kaynağındır → gecersiz, belge değişmez.
    expect((await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 4, teslim: true, kalemler: [anahtarlar[1]], kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    const ara = await belge(id);
    expect(magazaKalemTeslimMi(ara.kalemTeslim, anahtarlar[1])).toBe(true);
    expect(await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 5, teslim: true, kalemler: ['b:1'], kim: KIM, kanal: 'erp' })).toEqual({ sonuc: 'gecersiz' });
    expect(await belge(id)).toEqual(ara);
    // `'hepsi'` → üç `t:` girişi (beyan anahtarlarına YENİ giriş yazılmaz).
    expect((await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 5, teslim: true, kalemler: 'hepsi', kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    const son = await belge(id);
    expect(magazaTeslimIsaretsiz(son)).toBe(0);
    expect(Object.keys(son.kalemTeslim as object).sort()).toEqual(['b:1', ...anahtarlar].sort());
  });
  it('ikinci teyit yazımı mevcut `t:` anahtarını KORUR (işaret yaşar); kalem silinir / sıralanır / eklenir, anahtar KAYMAZ; silinen kalemin işaret girişi tarihçede kalır', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ ad: 'A', kdvOrani: 20 }), K({ ad: 'B', kdvOrani: 20 }), K({ ad: 'C', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const [a, b, c] = teyitKalemleri(await belge(id)).map(k => String(k.anahtar));
    expect((await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 3, teslim: true, kalemler: [a, c], kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    // B silindi, C öne geçti, D eklendi; A'nın adedi değişti.
    const s = await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ anahtar: c, ad: 'C', kdvOrani: 20 }), K({ anahtar: a, ad: 'A', adet: 5, kdvOrani: 20 }), K({ ad: 'D', kdvOrani: 20 })] } }));
    expect(s.sonuc).toBe('tamam');
    const son = await belge(id);
    const yeni = teyitKalemleri(son).map(k => String(k.anahtar));
    expect(yeni.slice(0, 2)).toEqual([c, a]);
    expect(yeni[2]).toMatch(/^t:[0-9a-f]{12}$/);
    expect([a, b, c]).not.toContain(yeni[2]);
    expect(magazaKalemTeslimMi(son.kalemTeslim, a)).toBe(true);
    expect(magazaKalemTeslimMi(son.kalemTeslim, c)).toBe(true);
    expect(magazaKalemTeslimMi(son.kalemTeslim, yeni[2])).toBe(false);
    expect(magazaTeslimIsaretsiz(son)).toBe(1);
    // Taşıma yok ($6 = {}): `kalemTeslim` nesnesine içerik yazımı HİÇ dokunmadı.
    expect(guncellemeler().at(-1)?.params[5]).toBe('{}');
    expect(Object.keys(son.kalemTeslim as object).sort()).toEqual([a, c].sort());
  });
  it('tanınmayan `t:`, aralık dışı `b:`, desene uymayan ve aynı istekte YİNELENEN anahtar → `gecersiz`; hiçbir şey yazılmaz', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const once = await belge(id);
    const mevcut = String(teyitKalemleri(once)[0].anahtar);
    sorgular = [];
    const kotu: IcerikTeyitKalemGirdisi[][] = [
      [K({ anahtar: 't:ffffffffffff' })], [K({ anahtar: 'b:3' })], [K({ anahtar: 'b:9999' })], [K({ anahtar: 'b:01' })], [K({ anahtar: 'c:0' })], [K({ anahtar: '' })],
      [K({ anahtar: 'b:1' }), K({ anahtar: 'b:1' })], [K({ anahtar: mevcut }), K({ anahtar: mevcut })], [K({ anahtar: mevcut }), K({ anahtar: 't:ffffffffffff' })],
    ];
    for (const kalemler of kotu) expect(await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler } })), JSON.stringify(kalemler.map(k => k.anahtar))).toEqual({ sonuc: 'gecersiz' });
    expect(await belge(id)).toEqual(once);
    expect(guncellemeler()).toEqual([]);
  });
  it('aynı `b:<i>` iki AYRI teyit yazımında iki kez kopyalanabilir: her seferinde yeni `t:`, işaret o anki beyan girişinden', async () => {
    const id = await talep({ kalemTeslim: { 'b:2': ISARET } });
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ anahtar: 'b:2', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const ilk = String(teyitKalemleri(await belge(id))[0].anahtar);
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ anahtar: 'b:2', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const son = await belge(id);
    const ikinci = String(teyitKalemleri(son)[0].anahtar);
    expect(ikinci).not.toBe(ilk);
    const kt = son.kalemTeslim as Record<string, unknown>;
    expect(kt[ikinci]).toEqual(ISARET);
    expect(kt[ilk]).toEqual(ISARET);     // silinen teyit kaleminin girişi tarihçede
    expect(kt['b:2']).toEqual(ISARET);
    expect(magazaTeslimIsaretsiz(son)).toBe(0);
  });
  it('taşıma satırın GÜNCEL `kalemTeslim`inden yapılır (okunan kopyadan değil): `bekliyor` girişi de aynen kopyalanır; girişsiz beyan kalemi ve çöp `kalemTeslim` hata vermez', async () => {
    const BEKLIYOR = { durum: 'bekliyor', zaman: '2026-10-10T11:10:00.000Z', kim: { uid: 'u-k', ad: 'Kaldıran' } };
    const id = await talep({ kalemTeslim: { 'b:0': BEKLIYOR } });
    expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ anahtar: 'b:0', kdvOrani: 20 }), K({ anahtar: 'b:1', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const b = await belge(id);
    const [a0, a1] = teyitKalemleri(b).map(k => String(k.anahtar));
    const kt = b.kalemTeslim as Record<string, unknown>;
    expect(kt[a0]).toEqual(BEKLIYOR);
    expect(a1 in kt).toBe(false);
    expect(JSON.parse(String(guncellemeler()[0].params[5]))).toEqual({ [a0]: 'b:0', [a1]: 'b:1' });
    for (const cop of ['çöp', 7, ['b:0'], null]) {
      const id2 = await talep({ kalemTeslim: cop });
      expect((await talepIcerigiDegistir(sahte(), G(id2, { teyit: { kalemler: [K({ anahtar: 'b:0', kdvOrani: 20 })] } }))).sonuc, String(cop)).toBe('tamam');
      expect((await belge(id2)).kalemTeslim).toEqual({});   // çöp alan boş nesneye iner; kopyalanacak giriş yok
    }
    // Hiç `kalemTeslim` yokken beyandan kopyalama: alan boş nesne olarak doğar (giriş yok = hepsi bekliyor).
    const id3 = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id3, { teyit: { kalemler: [K({ anahtar: 'b:0', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    expect((await belge(id3)).kalemTeslim).toEqual({});
    expect(magazaTeslimIsaretsiz(await belge(id3))).toBe(1);
  });
  it('yarış (kapı 3, K6): teyit yazımı araya girince bekleyen kalem teslim yazımı → `surum-eski`; `kalemTeslim` ve `durumSurum` değişmez (hayalet `b:` / `t:` girişi yok)', async () => {
    const id = await talep();
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      expect((await talepIcerigiDegistir(sahte(), G(id, { teyit: { kalemler: [K({ anahtar: 'b:0', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    });
    expect(await kalemTeslimYaz(sahte({ getPgPool: () => h }), { id, companyId: CID, surum: 3, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'panel' })).toEqual({ sonuc: 'surum-eski' });
    const b = await belge(id);
    expect(b.kalemTeslim).toEqual({});
    expect(b.durumSurum).toBe(3);
    expect(b.icerikSurum).toBe(1);
    expect(magazaTeslimIsaretsiz(b)).toBe(1);
  });
  it('yarış (ters yön): kalem teslim yazımı araya girince içerik yazımı DÜŞMEZ ve taşıma araya giren işareti de görür (satırın güncel değeri)', async () => {
    const id = await talep();
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      expect((await kalemTeslimYaz(sahte({ simdi: () => new Date(ISARET.zaman) }), { id, companyId: CID, surum: 3, teslim: true, kalemler: ['b:1'], kim: { uid: 'u-depo', ad: 'Depo', eposta: '' }, kanal: 'panel' })).sonuc).toBe('tamam');
    });
    expect((await talepIcerigiDegistir(sahte({ getPgPool: () => h }), G(id, { teyit: { kalemler: [K({ anahtar: 'b:1', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const b = await belge(id);
    const a = String(teyitKalemleri(b)[0].anahtar);
    expect((b.kalemTeslim as Record<string, unknown>)[a]).toEqual(ISARET);
    expect(b.durumSurum).toBe(4);
    expect(magazaTeslimIsaretsiz(b)).toBe(0);
  });
  it('anahtar üreteci çakışırsa yeniden dener (mevcut teyit anahtarlarıyla ve birbirleriyle çakışmaz); desene uymayan üreteç çıktısı FIRLATIR', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte({ teyitAnahtariUret: () => 't:aaaaaaaaaaaa' }), G(id, { teyit: { kalemler: [K({ kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const dizi = ['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb', 't:bbbbbbbbbbbb', 't:cccccccccccc'];
    let i = 0;
    const s = await talepIcerigiDegistir(sahte({ teyitAnahtariUret: () => dizi[i++] }), G(id, { icerikSurum: 1, teyit: { kalemler: [K({ anahtar: 't:aaaaaaaaaaaa', kdvOrani: 20 }), K({ ad: 'X', kdvOrani: 20 }), K({ ad: 'Y', kdvOrani: 20 })] } }));
    expect(s.sonuc).toBe('tamam');
    expect(teyitKalemleri(await belge(id)).map(k => k.anahtar)).toEqual(['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb', 't:cccccccccccc']);
    const once = await belge(id);
    await expect(talepIcerigiDegistir(sahte({ teyitAnahtariUret: () => 'b:0' }), G(id, { icerikSurum: 2, teyit: { kalemler: [K({ ad: 'Z', kdvOrani: 20 })] } }))).rejects.toThrow(/üreteci/);
    await expect(talepIcerigiDegistir(sahte({ teyitAnahtariUret: () => 't:aaaaaaaaaaaa' }), G(id, { icerikSurum: 2, teyit: { kalemler: [K({ ad: 'Z', kdvOrani: 20 })] } }))).rejects.toThrow(/üretilemedi/);
    expect(await belge(id)).toEqual(once);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('revize bildirimi alanı — `bildirimRevize` (madde 8; § 10.1, § 10.2 (a) 4 / 6)', () => {
  it('`bekliyor` iken ikinci revizyon: `alanlar` TAM OLARAK [not, teyit] (`null` DEĞİL — parantezli `$8`); `zaman` / `kim` / `icerikSurum` sonuncusunun; `deneme` düşer; ilk `bildirim` EZİLMEZ', async () => {
    const id = await talep({ bildirim: { durum: 'gonderilemedi', zaman: '2026-10-10T09:05:00.000Z', deneme: 8, hataSinifi: 'baglanti' } });
    const ILK = { uid: 'u-1', ad: 'Birinci', eposta: 'b@example.com' };
    expect((await talepIcerigiDegistir(sahte({ simdi: () => new Date('2026-10-10T11:00:00.000Z') }), G(id, { kim: ILK, not: 'ilk' }))).sonuc).toBe('tamam');
    // İşçi bir kez denedi: `bekliyor` + deneme + hata sınıfı (alt alan birleştirme — işçinin kendi SQL'i değil, aynı etki).
    await db.query(`UPDATE docs SET data = jsonb_set(data, '{bildirimRevize}', (data->'bildirimRevize') || '{"deneme": 1, "hataSinifi": "tls"}'::jsonb) WHERE coll = $1 AND id = $2`, [COLL, id]);
    const { D, revizeIste } = deps();
    expect((await talepIcerigiDegistir(D, G(id, { icerikSurum: 1, teyit: { kalemler: [K({ kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.bildirimRevize).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not', 'teyit'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 2 });
    expect(b.bildirim).toEqual({ durum: 'gonderilemedi', zaman: '2026-10-10T09:05:00.000Z', deneme: 8, hataSinifi: 'baglanti' });
    expect(revizeIste).toHaveBeenCalledTimes(1);
  });
  it('[not] + [not] → saklanan [not, not] (SQL tekilleştirmez), `alanlariBirlestir` → [not]; üç revizyon sırayla birikir', async () => {
    const id = await talep();
    expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'bir' }))).sonuc).toBe('tamam');
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, not: 'iki' }))).sonuc).toBe('tamam');
    let r = (await belge(id)).bildirimRevize as Satir;
    expect(r.alanlar).toEqual(['not', 'not']);
    expect(alanlariBirlestir(r.alanlar)).toEqual(['not']);
    expect(r.icerikSurum).toBe(2);
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, not: 'üç', musteri: { ...MUSTERI, il: 'Muğla' } }))).sonuc).toBe('tamam');
    r = (await belge(id)).bildirimRevize as Satir;
    expect(r.alanlar).toEqual(['not', 'not', 'musteri', 'not']);
    expect(alanlariBirlestir(r.alanlar)).toEqual(['not', 'musteri']);
    expect(r.icerikSurum).toBe(3);
  });
  const ESKI_REVIZE = { zaman: '2026-10-10T10:00:00.000Z', alanlar: ['musteri', 'teyit'], kim: { uid: 'u-e', ad: 'Eski' }, icerikSurum: 5, deneme: 3, hataSinifi: 'diger' };
  it('saklı revize `gitti` iken yeni revizyon nesneyi BÜTÜNÜYLE yeniler: `alanlar` yalnız bu revizyonun (gitmiş alan yeniden duyurulmaz), eski `deneme` / `hataSinifi` düşer', async () => {
    const id = await talep({ icerikSurum: 5, bildirimRevize: { ...ESKI_REVIZE, durum: 'gitti' } });
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 5, not: 'yeni' }))).sonuc).toBe('tamam');
    expect((await belge(id)).bildirimRevize).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 6 });
  });
  it('(inceleme 2b, bulgu 10) saklı revize GİTMEMİŞ (`gonderilemedi` / `yapilandirilmamis`) iken yeni revizyon `alanlar`ı EZMEZ, BİRLEŞTİRİR: [musteri, teyit] + [not]; `durum` yine `bekliyor`, eski `deneme` / `hataSinifi` düşer, `zaman` / `kim` / `icerikSurum` sonuncusunun', async () => {
    for (const durum of ['gonderilemedi', 'yapilandirilmamis']) {
      const id = await talep({ icerikSurum: 5, bildirimRevize: { ...ESKI_REVIZE, durum } });
      const { D, revizeIste } = deps();
      expect((await talepIcerigiDegistir(D, G(id, { icerikSurum: 5, not: 'yeni' }))).sonuc, durum).toBe('tamam');
      const r = (await belge(id)).bildirimRevize as Satir;
      // Tam eşitlik: `deneme` / `hataSinifi` anahtarları YOK (nesne `$7`'den kurulur; yalnız `alanlar` eskiyle birleşir).
      expect(r, durum).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['musteri', 'teyit', 'not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 6 });
      expect(alanlariBirlestir(r.alanlar), durum).toEqual(['musteri', 'teyit', 'not']);
      expect(revizeIste, durum).toHaveBeenCalledTimes(1);
      // Yanıttaki `alanlar` yalnız BU yazımda değişenlerdir (denetim ayrıntısı da) — birleşik liste yalnız bildirim alanında.
      const [q] = guncellemeler().slice(-1);
      expect(q.params[7], durum).toBe('["not"]');
    }
  });
  it('(bulgu 10) yinelenen alan: gitmemiş [not] + yeni [musteri, not] → saklanan [not, musteri, not], okuyan [not, musteri]; tanınmayan durum (`\'x\'`, boş, sayı, alan yok) BİRLEŞTİRMEZ — çöp `alanlar` taşınmaz', async () => {
    const id = await talep({ icerikSurum: 2, bildirimRevize: { ...ESKI_REVIZE, durum: 'gonderilemedi', alanlar: ['not'], icerikSurum: 2 } });
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 2, not: 'yeni', musteri: { ...MUSTERI, il: 'Muğla' } }))).sonuc).toBe('tamam');
    const r = (await belge(id)).bildirimRevize as Satir;
    expect(r.alanlar).toEqual(['not', 'musteri', 'not']);
    expect(alanlariBirlestir(r.alanlar)).toEqual(['not', 'musteri']);
    // Küme ADLI üç durumdur (`IS DISTINCT FROM 'gitti'` değil): tanınmayan / eksik durumda eski `alanlar` (çöp de olabilir) atılır.
    for (const durum of ['x', '', undefined, 7, null]) {
      const cop = await talep({ bildirimRevize: { ...(durum === undefined ? {} : { durum }), zaman: 'z', alanlar: [{}, 'musteri'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 0 } });
      expect((await talepIcerigiDegistir(sahte(), G(cop, { not: 'yeni' }))).sonuc, JSON.stringify(durum)).toBe('tamam');
      expect((await belge(cop)).bildirimRevize, JSON.stringify(durum)).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 1 });
    }
  });
  it('çöp `alanlar` (dizge / sayı / nesne / yok) ve çöp `bildirimRevize` (dizge / dizi / null) ikinci revizyonda hata FIRLATMAZ; okuyan bilinmeyeni düşürür', async () => {
    for (const alanlar of ['çöp', 7, { a: 1 }, undefined]) {
      const id = await talep({ bildirimRevize: { durum: 'bekliyor', zaman: 'z', ...(alanlar === undefined ? {} : { alanlar }), kim: { uid: 'u', ad: 'A' }, icerikSurum: 0 } });
      expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'yeni' }))).sonuc, JSON.stringify(alanlar)).toBe('tamam');
      const r = (await belge(id)).bildirimRevize as Satir;
      expect(r.durum).toBe('bekliyor');
      expect(Array.isArray(r.alanlar), JSON.stringify(alanlar)).toBe(true);
      expect(alanlariBirlestir(r.alanlar), JSON.stringify(alanlar)).toEqual(['not']);
    }
    for (const revize of ['çöp', ['not'], null]) {
      const id = await talep({ bildirimRevize: revize });
      expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'yeni' }))).sonuc, JSON.stringify(revize)).toBe('tamam');
      expect((await belge(id)).bildirimRevize).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 1 });
    }
  });
  it('araya giren işçi `gitti` yazımı EZİLMEZ sanılmasın: `bildirimRevize` satırın güncel değerinden türetilir — okuma `bekliyor` gördü, yazım anında `gitti` → nesne yenilenir (birleştirme YOK)', async () => {
    const id = await talep({ bildirimRevize: { durum: 'bekliyor', zaman: 'z', alanlar: ['musteri'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 0 } });
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query(`UPDATE docs SET data = jsonb_set(data, '{bildirimRevize}', (data->'bildirimRevize') || '{"durum": "gitti"}'::jsonb) WHERE coll = $1 AND id = $2`, [COLL, id]);
    });
    expect((await talepIcerigiDegistir(sahte({ getPgPool: () => h }), G(id, { not: 'yeni' }))).sonuc).toBe('tamam');
    // İlk posta `musteri` için gitti; bu revizyonun bildirimi yalnız `not` taşır (gitmiş alan yeniden duyurulmaz).
    expect(((await belge(id)).bildirimRevize as Satir).alanlar).toEqual(['not']);
  });
  it('`surum-eski` / `silindi` / `gecersiz` / `bulunamadi` / `degisiklik-yok` → revize isteği YOK ve `bildirimRevize` DEĞİŞMEZ', async () => {
    const REVIZE = { durum: 'gitti', zaman: '2026-10-10T10:00:00.000Z', alanlar: ['not'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 2 };
    const id = await talep({ icerikSurum: 2, bildirimRevize: REVIZE });
    const silinmis = await talep({ icerikSurum: 2, bildirimRevize: REVIZE, silindi: { zaman: 'z', kim: { uid: 'u', ad: 'A' }, kanal: 'panel' } });
    const { D, revizeIste, iste, denetim, yayin } = deps();
    expect((await talepIcerigiDegistir(D, G(id, { icerikSurum: 1, not: 'x' }))).sonuc).toBe('surum-eski');
    expect((await talepIcerigiDegistir(D, G(silinmis, { icerikSurum: 2, not: 'x' }))).sonuc).toBe('silindi');
    expect((await talepIcerigiDegistir(D, G(id, { icerikSurum: 2, teyit: { kalemler: [] } }))).sonuc).toBe('gecersiz');
    expect((await talepIcerigiDegistir(D, G('mt-ffffffffffffffffffffffffffffffff', { not: 'x' }))).sonuc).toBe('bulunamadi');
    expect((await talepIcerigiDegistir(D, G(id, { icerikSurum: 2, not: 'kapıda ödeme', musteri: { ...MUSTERI } }))).sonuc).toBe('degisiklik-yok');
    expect(revizeIste).not.toHaveBeenCalled(); expect(iste).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled();
    expect((await belge(id)).bildirimRevize).toEqual(REVIZE);
    expect((await belge(silinmis)).bildirimRevize).toEqual(REVIZE);
  });
  it('denetim ayrıntısı yalnız talep no + kanal + değişen alan ADLARI: müşteri verisi, not metni, kalem adı, fiyat, tutar, KDV oranı, anahtar GİRMEZ; `diff` yok', async () => {
    const id = await talep({ kalemTeslim: { 'b:0': { durum: 'teslim', zaman: 'z', kim: { uid: 'u', ad: 'U' } } } });
    const { D, denetim, yayin } = deps();
    const s = await talepIcerigiDegistir(D, G(id, {
      musteri: { ...MUSTERI, ad: 'ÇOK GİZLİ MÜŞTERİ', telefon: '0555 444 33 22', adres: 'GİZLİ ADRES' }, not: 'GİZLİ NOT METNİ',
      teyit: { kalemler: [K({ anahtar: 'b:0', ad: 'GİZLİ KALEM', birimFiyat: 1234.56, kdvOrani: 10 })] },
    }));
    expect(s.sonuc).toBe('tamam');
    expect(denetim).toHaveBeenCalledTimes(1);
    expect(denetim.mock.calls[0]).toEqual([{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi içeriği', 'T261010-AB12 · erp · musteri, not, teyit']);
    const metin = JSON.stringify(denetim.mock.calls[0]);
    expect(metin).not.toMatch(/GİZLİ|0555|1234|2469|t:[0-9a-f]{12}|b:0|kdvOrani|kdvKaynagi|Şükrü|kapıda|Antalya|Aksu/);
    // Yayınlanan belge `RETURNING` satırıdır — okunan eski değerler (eski müşteri / eski not) yayında GEÇMEZ.
    const yayinlanan = JSON.stringify(yayin.mock.calls[0]?.[3]);
    expect(yayinlanan).not.toMatch(/Şükrü Öztürk|kapıda ödeme/);
    expect(yayin.mock.calls[0]?.[3]).toEqual(await belge(id));
  });
  it('yama anahtar kümesi KAPALI (havuz gözlemi): $4 ⊆ { musteri, not, teyit, kirpildi, icerikSurum, icerikZamani }; $5 okunan sürüm metni; $6 taşıma; $7 revize nesnesi; $8 alanlar', async () => {
    const id = await talep({ icerikSurum: 7 });
    expect((await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 7, musteri: { ...MUSTERI, il: 'x'.repeat(100) }, not: 'n', teyit: { kalemler: [K({ anahtar: 'b:2', kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    const [q] = guncellemeler();
    expect(q.sql).toBe(ICERIK_SQL);
    expect(q.params).toHaveLength(8);
    expect(q.params.slice(0, 3)).toEqual([COLL, id, CID]);
    const yama = JSON.parse(String(q.params[3])) as Satir;
    expect(Object.keys(yama).sort()).toEqual(['icerikSurum', 'icerikZamani', 'kirpildi', 'musteri', 'not', 'teyit']);
    expect([yama.icerikSurum, yama.icerikZamani, yama.kirpildi]).toEqual([8, SAAT.toISOString(), true]);
    expect(Object.keys(yama.teyit as object).sort()).toEqual(['araToplam', 'kalemler', 'kdv', 'kim', 'toplam', 'zaman']);
    expect(q.params[4]).toBe('7');
    const yeniAnahtar = String(((yama.teyit as { kalemler: Array<{ anahtar: string }> }).kalemler)[0].anahtar);
    expect(JSON.parse(String(q.params[5]))).toEqual({ [yeniAnahtar]: 'b:2' });
    expect(JSON.parse(String(q.params[6]))).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['musteri', 'not', 'teyit'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 8 });
    expect(JSON.parse(String(q.params[7]))).toEqual(['musteri', 'not', 'teyit']);
    // Hiçbir parametrede BEYAN, takip anahtarı, aşama, bildirim, silme, elle, etiket alanı üst düzey anahtar olarak geçmez.
    for (const p of [yama, JSON.parse(String(q.params[6])) as Satir]) {
      for (const yasak of ['kalemler', 'talepEdilen', 'telefonSon10', 'talepNo', 'olusturma', 'companyId', 'durumSurum', 'durumZamani', 'bildirim', 'bildirimRevize', 'kalemTeslim', 'silindi', 'elle', 'etiketBasildi']) {
        expect(yasak in p, yasak).toBe(false);
      }
    }
    // Aşama (`durum`) yamada YOK; revize nesnesindeki `durum` bildirimin durumudur (`bekliyor`), aşama değil.
    expect('durum' in yama).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('talepSil / talepGeriAl — yumuşak silme (V17; § 10.2 (b), (c))', () => {
  const S = (id: string, ek: Partial<Parameters<typeof talepSil>[1]> = {}) => ({ id, companyId: CID, surum: 3, kim: KIM, kanal: 'erp' as const, ...ek });

  it('silme: kayıt DURUR, `silindi: { zaman, kim, kanal }`, `durumSurum` +1; `durumZamani` / içerik / bildirimler / kalem işaretleri alan alan AYNI; akışa `set`; denetim; bildirim YOK', async () => {
    const id = await talep({
      icerikSurum: 2, kalemTeslim: { 'b:0': { durum: 'teslim', zaman: 'z', kim: { uid: 'u', ad: 'U' } } },
      bildirimRevize: { durum: 'bekliyor', zaman: 'z', alanlar: ['not'], kim: { uid: 'u', ad: 'A' }, icerikSurum: 2 }, etiketBasildi: { zaman: 'z', kim: { uid: 'u', panel: true } },
    });
    const once = await belge(id);
    const { D, yayin, denetim, iste, revizeIste } = deps();
    const s = await talepSil(D, S(id, { kanal: 'panel' }));
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect(b.silindi).toEqual({ zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad }, kanal: 'panel' });
    expect(magazaSilinmisMi(b)).toBe(true);
    expect(b.durumSurum).toBe(4);
    for (const alan of Object.keys(once).filter(a => a !== 'durumSurum')) expect(b[alan], alan).toEqual(once[alan]);
    expect(Object.keys(b).sort()).toEqual([...Object.keys(once), 'silindi'].sort());
    if (s.sonuc === 'tamam') expect(s.belge).toEqual(b);
    expect(yayin.mock.calls).toEqual([[COLL, 'set', id, b, { cid: CID }]]);
    expect(denetim.mock.calls).toEqual([[{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi silindi', 'T261010-AB12 · panel']]);
    expect(iste).not.toHaveBeenCalled(); expect(revizeIste).not.toHaveBeenCalled();
    // Yama KAPALI: yalnız iki anahtar.
    expect(JSON.parse(String(guncellemeler()[0].params[3]))).toEqual({ silindi: b.silindi, durumSurum: 4 });
    expect(guncellemeler()[0].params[4]).toBe('3');
  });
  it('bayat `durumSurum` → `surum-eski` + güncel sürüm, belge değişmez (teslim\'e geçmiş talep bayat ekrandan silinmez); araya giren aşama yazımı da `surum-eski`', async () => {
    const id = await talep();
    const once = await belge(id);
    expect(await talepSil(sahte(), S(id, { surum: 2 }))).toEqual({ sonuc: 'surum-eski', surum: 3 });
    expect(await belge(id)).toEqual(once);
    const h = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teyit', surum: 3, yeni: 'hazirlaniyor', kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    });
    expect(await talepSil(sahte({ getPgPool: () => h }), S(id))).toEqual({ sonuc: 'surum-eski', surum: 4 });
    expect(magazaSilinmisMi(await belge(id))).toBe(false);
  });
  it('iki eşzamanlı silme → biri `tamam`, biri `zaten-silindi`; zaten silinmiş talep → `zaten-silindi` (ilk silenin kaydı EZİLMEZ)', async () => {
    const id = await talep();
    const [a, b] = await Promise.all([talepSil(sahte(), S(id)), talepSil(sahte({ simdi: () => new Date(SAAT.getTime() + 1000) }), S(id, { kim: { uid: 'u-2', ad: 'İkinci', eposta: '' } }))]);
    expect([a.sonuc, b.sonuc].sort()).toEqual(['tamam', 'zaten-silindi']);
    const ilk = (await belge(id)).silindi;
    expect((await belge(id)).durumSurum).toBe(4);
    const { D, yayin, denetim } = deps({ simdi: () => new Date(SAAT.getTime() + 5000) });
    expect(await talepSil(D, S(id, { surum: 4 }))).toEqual({ sonuc: 'zaten-silindi' });
    expect((await belge(id)).silindi).toEqual(ilk);
    expect(yayin).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled();
  });
  it('koşul sürümden BAĞIMSIZ da tutar: okuma ile yazma arasında `silindi` sürüm artmadan değişirse — silme ilk kaydı EZMEZ (`zaten-silindi`), geri alma canlı talebe yazmaz (`silinmemis`)', async () => {
    const BASKASI = { zaman: '2026-10-10T11:59:00.000Z', kim: { uid: 'u-ilk', ad: 'İlk Silen' }, kanal: 'panel' };
    const id = await talep();
    const silAraya = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query('UPDATE docs SET data = data || $3::jsonb WHERE coll = $1 AND id = $2', [COLL, id, JSON.stringify({ silindi: BASKASI })]);
    });
    expect(await talepSil(sahte({ getPgPool: () => silAraya }), S(id))).toEqual({ sonuc: 'zaten-silindi' });
    let b = await belge(id);
    expect(b.silindi).toEqual(BASKASI);   // ilk silenin kim / zaman / kanal kaydı durur
    expect(b.durumSurum).toBe(3);
    const geriAraya = arayaGiren(sql => sql.startsWith('SELECT'), async () => {
      await db.query(`UPDATE docs SET data = data || '{"silindi": null}'::jsonb WHERE coll = $1 AND id = $2`, [COLL, id]);
    });
    expect(await talepGeriAl(sahte({ getPgPool: () => geriAraya }), { id, companyId: CID, surum: 3, kim: KIM })).toEqual({ sonuc: 'silinmemis' });
    b = await belge(id);
    expect(b.silindi).toBeNull();
    expect(b.durumSurum).toBe(3);   // geri alma yazımı YAPILMADI (sürüm artmadı)
  });
  it('silme `durumSurum`\'u artırdığı için bayat aşama ve kalem teslim ekranı silinmişi GÖRÜR (`silindi`); içerik sayacı değişmez', async () => {
    const id = await talep({ icerikSurum: 1 });
    expect((await talepSil(sahte(), S(id))).sonuc).toBe('tamam');
    expect(await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teyit', surum: 3, yeni: 'hazirlaniyor', kim: KIM, kanal: 'panel' })).toEqual({ sonuc: 'silindi' });
    expect(await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 3, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'panel' })).toEqual({ sonuc: 'silindi' });
    expect(await talepIcerigiDegistir(sahte(), G(id, { icerikSurum: 1, not: 'x' }))).toEqual({ sonuc: 'silindi' });
    expect((await belge(id)).icerikSurum).toBe(1);
  });
  it('geri alma: `silindi: null` (anahtar VAR, değer JSON null), `durumSurum` +1; sonra aşama / içerik / kalem yazımı yeniden `tamam`; denetim; bildirim YOK', async () => {
    const id = await talep();
    expect((await talepSil(sahte(), S(id))).sonuc).toBe('tamam');
    const silinmis = await belge(id);
    const { D, yayin, denetim, iste, revizeIste } = deps();
    const s = await talepGeriAl(D, { id, companyId: CID, surum: 4, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    const b = await belge(id);
    expect('silindi' in b).toBe(true);
    expect(b.silindi).toBeNull();
    expect(magazaSilinmisMi(b)).toBe(false);
    expect(b.durumSurum).toBe(5);
    for (const alan of Object.keys(silinmis).filter(a => a !== 'durumSurum' && a !== 'silindi')) expect(b[alan], alan).toEqual(silinmis[alan]);
    const tur = await db.query<Satir>(`SELECT jsonb_typeof(data->'silindi') AS tur FROM docs WHERE coll = $1 AND id = $2`, [COLL, id]);
    expect(tur.rows[0].tur).toBe('null');
    expect(yayin.mock.calls).toEqual([[COLL, 'set', id, b, { cid: CID }]]);
    expect(denetim.mock.calls).toEqual([[{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi geri alındı', 'T261010-AB12 · erp']]);
    expect(iste).not.toHaveBeenCalled(); expect(revizeIste).not.toHaveBeenCalled();
    expect(JSON.parse(String(guncellemeler().at(-1)?.params[3]))).toEqual({ silindi: null, durumSurum: 5 });
    // Yeniden canlı.
    expect((await talepDurumunuDegistir(sahte(), { id, companyId: CID, onceki: 'teyit', surum: 5, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepIcerigiDegistir(sahte(), G(id, { not: 'geri geldi' }))).sonuc).toBe('tamam');
    expect((await kalemTeslimYaz(sahte(), { id, companyId: CID, surum: 6, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'panel' })).sonuc).toBe('tamam');
    // Yeniden silinebilir (üzerine yazılır), yeniden geri alınabilir.
    expect((await talepSil(sahte(), S(id, { surum: 7 }))).sonuc).toBe('tamam');
    expect(magazaSilinmisMi(await belge(id))).toBe(true);
    expect((await talepGeriAl(sahte(), { id, companyId: CID, surum: 8, kim: KIM })).sonuc).toBe('tamam');
    expect((await belge(id)).silindi).toBeNull();
  });
  it('geri alınacak bir şey yok → `silinmemis` (hiç silinmemiş ve zaten geri alınmış); bayat sürüm → `surum-eski`; iki eşzamanlı geri almadan biri `silinmemis`', async () => {
    const id = await talep();
    const once = await belge(id);
    expect(await talepGeriAl(sahte(), { id, companyId: CID, surum: 3, kim: KIM })).toEqual({ sonuc: 'silinmemis' });
    expect(await belge(id)).toEqual(once);
    expect((await talepSil(sahte(), S(id))).sonuc).toBe('tamam');
    expect(await talepGeriAl(sahte(), { id, companyId: CID, surum: 3, kim: KIM })).toEqual({ sonuc: 'surum-eski', surum: 4 });
    expect(magazaSilinmisMi(await belge(id))).toBe(true);
    const [a, b] = await Promise.all([talepGeriAl(sahte(), { id, companyId: CID, surum: 4, kim: KIM }), talepGeriAl(sahte(), { id, companyId: CID, surum: 4, kim: KIM })]);
    expect([a.sonuc, b.sonuc].sort()).toEqual(['silinmemis', 'tamam']);
    expect((await belge(id)).durumSurum).toBe(5);
    expect(await talepGeriAl(sahte(), { id, companyId: CID, surum: 5, kim: KIM })).toEqual({ sonuc: 'silinmemis' });
  });
  it('başka kiracı → bulunamadi (silme ve geri alma); bozuk kimlik → sorgu 0; yayın / denetim arızası yazımı geri almaz', async () => {
    const id = await talep();
    expect(await talepSil(sahte(), S(id, { companyId: 'kiraci-2' }))).toEqual({ sonuc: 'bulunamadi' });
    expect(await talepGeriAl(sahte(), { id, companyId: 'kiraci-2', surum: 3, kim: KIM })).toEqual({ sonuc: 'bulunamadi' });
    expect(magazaSilinmisMi(await belge(id))).toBe(false);
    sorgular = [];
    expect(await talepSil(sahte(), S('mt-bozuk'))).toEqual({ sonuc: 'bulunamadi' });
    expect(await talepGeriAl(sahte(), { id: 'mt-bozuk', companyId: CID, surum: 3, kim: KIM })).toEqual({ sonuc: 'bulunamadi' });
    expect(sorgular).toEqual([]);
    const s = await talepSil(sahte({ broadcastDocChange: () => { throw new Error('akış'); }, writeAuditLog: async () => { throw new Error('denetim'); } }), S(id));
    expect(s.sonuc).toBe('tamam');
    expect(magazaSilinmisMi(await belge(id))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('elleTalepAc — ERP\'de elle talep (V15, V20; § 10.2 (d))', () => {
  const GOVDE: ElleTalepGovdesi = {
    musteri: { ad: 'Telefonla Arayan', telefon: '0 532 444 55 66', firma: 'Çınar İnşaat' },
    not: 'telefonla geldi',
    kalemler: [{ ad: 'Saten boya', adet: 2, sku: 'ABC', birimFiyat: 95 }, { ad: 'Fiyatı sorulacak ürün', adet: 1 }],
  };
  const noUreteci = (...nolar: string[]) => { let i = 0; return vi.fn((_simdi: Date) => nolar[Math.min(i++, nolar.length - 1)]); };

  it('belge dilim 1 eşleyicisinden: `durum: yeni`, `bildirim: { bekliyor, zaman }`, `elle: { zaman, kim }`, `istemciTarihi: null`; kimlik dilim 1 formülüyle (takip ucu aynı `no` + telefonla bulur)', async () => {
    const { D, yayin, denetim, iste, revizeIste } = deps({ elleNoUret: noUreteci('T261010-ZZ99') });
    const s = await elleTalepAc(D, { companyId: CID, girdi: GOVDE, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc !== 'tamam') return;
    expect(s.talepNo).toBe('T261010-ZZ99');
    expect(s.id).toBe(magazaTalepKimligi(CID, 'T261010-ZZ99', '5324445566'));
    expect(MAGAZA_TALEP_KIMLIK_DESENI.test(s.id)).toBe(true);
    const b = await belge(s.id);
    expect(b).toEqual({
      companyId: CID, talepNo: 'T261010-ZZ99', durum: 'yeni', olusturma: SAAT.toISOString(), istemciTarihi: null,
      musteri: { ad: 'Telefonla Arayan', firma: 'Çınar İnşaat', telefon: '0 532 444 55 66', eposta: '', il: '', adres: '', vergi: '' },
      telefonSon10: '5324445566', not: 'telefonla geldi',
      kalemler: [
        { id: '', sku: 'ABC', ad: 'Saten boya', marka: '', adet: 2, talepFiyat: 95, tedarik: false },
        { id: '', sku: '', ad: 'Fiyatı sorulacak ürün', marka: '', adet: 1, talepFiyat: null, tedarik: false },
      ],
      talepEdilen: { araToplam: null, kdv: null, toplam: null }, fiyatiSorulacakVar: true,
      bildirim: { durum: 'bekliyor', zaman: SAAT.toISOString() },
      elle: { zaman: SAAT.toISOString(), kim: { uid: KIM.uid, ad: KIM.ad } },
    });
    expect(s.belge).toEqual(b);
    // İlk bildirim: dilim 1 kuyruğu, tam 1 kez, yalnız talep kimliği; revize kuyruğu ÇAĞRILMAZ.
    expect(iste).toHaveBeenCalledTimes(1);
    expect(iste).toHaveBeenCalledWith(s.id);
    expect(revizeIste).not.toHaveBeenCalled();
    expect(yayin.mock.calls).toEqual([[COLL, 'set', s.id, b, { cid: CID }]]);
    expect(denetim.mock.calls).toEqual([[{ uid: KIM.uid, email: KIM.eposta }, 'Mağaza talebi elle açıldı', 'T261010-ZZ99 · erp']]);
    // Ekleme dilim 1 sabitiyle (ikinci `INSERT` metni yok); bildirim isteği satır eklendikten SONRA.
    expect(sorgular.map(q => q.sql)).toEqual([EKLEME_SQL]);
    expect(sorgular[0].params.slice(0, 2)).toEqual([COLL, s.id]);
    // v3'ün kaldırılan durumu hiçbir yazımda üretilmez.
    expect(JSON.stringify(b)).not.toContain(KALDIRILAN_DURUM);
  });
  it('`ON CONFLICT` 0 satır → YENİ numarayla dener; çakışan denemede bildirim / yayın / denetim YOK; mevcut kayda DOKUNULMAZ', async () => {
    const mevcutId = magazaTalepKimligi(CID, 'T261010-AAAA', '5324445566');
    await talep({ talepNo: 'T261010-AAAA', not: 'mağazadan gelen ASIL talep' }, mevcutId);
    const once = await belge(mevcutId);
    const uret = noUreteci('T261010-AAAA', 'T261010-BBBB');
    const { D, iste, yayin, denetim } = deps({ elleNoUret: uret });
    const s = await elleTalepAc(D, { companyId: CID, girdi: GOVDE, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc !== 'tamam') return;
    expect(s.talepNo).toBe('T261010-BBBB');
    expect(uret).toHaveBeenCalledTimes(2);
    expect(await belge(mevcutId)).toEqual(once);
    expect(iste).toHaveBeenCalledTimes(1);
    expect(iste).toHaveBeenCalledWith(s.id);
    expect(yayin).toHaveBeenCalledTimes(1);
    expect(denetim).toHaveBeenCalledTimes(1);
  });
  it(`${ELLE_TALEP_DENEME_SINIRI} çakışmada \`cakisti\`: bildirim / yayın / denetim YOK, tabloda yeni satır yok`, async () => {
    expect(ELLE_TALEP_DENEME_SINIRI).toBe(3);
    await talep({ talepNo: 'T261010-AAAA' }, magazaTalepKimligi(CID, 'T261010-AAAA', '5324445566'));
    const uret = noUreteci('T261010-AAAA');
    const { D, iste, yayin, denetim } = deps({ elleNoUret: uret });
    expect(await elleTalepAc(D, { companyId: CID, girdi: GOVDE, kim: KIM })).toEqual({ sonuc: 'cakisti' });
    expect(uret).toHaveBeenCalledTimes(3);
    expect(iste).not.toHaveBeenCalled(); expect(yayin).not.toHaveBeenCalled(); expect(denetim).not.toHaveBeenCalled();
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM docs WHERE coll = $1', [COLL])).rows[0].n).toBe(1);
  });
  it('telefonda 9 rakam / ad boş / kalem adı boş → `gecersiz`: ekleme sorgusu HİÇ koşmaz, bildirim yok', async () => {
    const { D, iste } = deps();
    const kotu: ElleTalepGovdesi[] = [
      { ...GOVDE, musteri: { ...GOVDE.musteri, telefon: '532 444 55 6' } }, { ...GOVDE, musteri: { ...GOVDE.musteri, telefon: '' } },
      { ...GOVDE, musteri: { ...GOVDE.musteri, ad: '   ' } }, { ...GOVDE, kalemler: [{ ad: ' ', adet: 1 }] }, { ...GOVDE, kalemler: [] },
    ];
    for (const girdi of kotu) expect(await elleTalepAc(D, { companyId: CID, girdi, kim: KIM }), JSON.stringify(girdi.musteri)).toEqual({ sonuc: 'gecersiz' });
    expect(sorgular).toEqual([]);
    expect(iste).not.toHaveBeenCalled();
  });
  it('varsayılan üreteç: numara `MAGAZA_TALEP_NO_DESENI`\'ne uyar ve İSTANBUL gününü basar (UTC 22:30 = ertesi gün); istekteki `no` / `tarih` yok sayılır', async () => {
    const gece = new Date('2026-10-10T22:30:00.000Z');   // İstanbul 11 Ekim 01:30
    const kacak = { ...GOVDE, no: 'T000000-KACK', tarih: '2020-01-01T00:00:00.000Z' } as ElleTalepGovdesi;
    const s = await elleTalepAc(sahte({ simdi: () => gece }), { companyId: CID, girdi: kacak, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc !== 'tamam') return;
    expect(MAGAZA_TALEP_NO_DESENI.test(s.talepNo)).toBe(true);
    expect(s.talepNo.slice(0, 8)).toBe('T261011-');
    const b = await belge(s.id);
    expect(b.talepNo).toBe(s.talepNo);
    expect(b.istemciTarihi).toBeNull();
    expect(b.olusturma).toBe(gece.toISOString());
  });
  it('desene uymayan üreteç çıktısı FIRLATIR (girdi hatası değil — `gecersiz` dönmez); kuyruk / yayın / denetim arızası kaydı geri almaz', async () => {
    await expect(elleTalepAc(sahte({ elleNoUret: () => 'bozuk' }), { companyId: CID, girdi: GOVDE, kim: KIM })).rejects.toThrow(/üreteci/);
    expect(sorgular).toEqual([]);
    const s = await elleTalepAc(sahte({
      elleNoUret: () => 'T261010-CCCC', bildirimIste: async () => { throw new Error('kuyruk'); },
      broadcastDocChange: () => { throw new Error('akış'); }, writeAuditLog: async () => { throw new Error('denetim'); },
    }), { companyId: CID, girdi: GOVDE, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc === 'tamam') expect(((await belge(s.id)).bildirim as Satir).durum).toBe('bekliyor');   // kaçan süpürmesi sahiplenir
  });
  it('elle açılan talep sıradan taleptir: içerik düzenlenir (revize bildirimi), aşaması ilerler, silinir — `elle` alanı hiçbir yazımda değişmez', async () => {
    const s = await elleTalepAc(sahte({ elleNoUret: () => 'T261010-DDDD' }), { companyId: CID, girdi: GOVDE, kim: KIM });
    if (s.sonuc !== 'tamam') throw new Error('elle talep açılamadı');
    const elle = (await belge(s.id)).elle;
    const { D, revizeIste } = deps();
    expect((await talepIcerigiDegistir(D, G(s.id, { teyit: { kalemler: [K({ anahtar: 'b:0', kdvOrani: 20 }), K({ anahtar: 'b:1', ad: 'Fiyatı sorulacak ürün', adet: 1, birimFiyat: 40, kdvOrani: 20 })] } }))).sonuc).toBe('tamam');
    expect(revizeIste).toHaveBeenCalledTimes(1);
    expect((await talepDurumunuDegistir(D, { id: s.id, companyId: CID, onceki: 'yeni', surum: 0, yeni: 'teyit', kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    expect((await talepSil(D, { id: s.id, companyId: CID, surum: 1, kim: KIM, kanal: 'erp' })).sonuc).toBe('tamam');
    const b = await belge(s.id);
    expect(b.elle).toEqual(elle);
    const teyit = b.teyit as Satir;
    expect([teyit.araToplam, teyit.kdv, teyit.toplam]).toEqual([230, 46, 276]);
    expect((b.bildirim as Satir).durum).toBe('bekliyor');   // ilk bildirim alanı revizyonla EZİLMEDİ
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kaldırılan bildirim durumu hiçbir 2b yazımının çıktısında yok (madde 8)', () => {
  it('içerik / silme / geri alma / elle talep / elle yeniden kuyruğa alma: `RETURNING` satırlarının ve saklanan belgelerin JSON metni taranır', async () => {
    const id = await talep({ bildirim: { durum: 'gonderilemedi', zaman: 'z' } });
    const ciktilar: unknown[] = [];
    const topla = async <T extends { sonuc: string }>(s: Promise<T>): Promise<T> => { const r = await s; ciktilar.push(r); return r; };
    await topla(talepIcerigiDegistir(sahte(), G(id, { not: 'a', musteri: { ...MUSTERI, il: 'Aydın' }, teyit: { kalemler: [K()] } })));
    await topla(talepSil(sahte(), { id, companyId: CID, surum: 3, kim: KIM, kanal: 'erp' }));
    await topla(talepGeriAl(sahte(), { id, companyId: CID, surum: 4, kim: KIM }));
    await topla(elleTalepAc(sahte(), { companyId: CID, girdi: { musteri: { ad: 'A', telefon: '05321112233' }, kalemler: [{ ad: 'x', adet: 1 }] }, kim: KIM }));
    const hepsi = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1', [COLL]);
    expect(hepsi.rows).toHaveLength(2);
    expect(JSON.stringify([ciktilar, hepsi.rows])).not.toContain(KALDIRILAN_DURUM);
    for (const r of hepsi.rows) {
      for (const alan of ['bildirim', 'bildirimRevize']) {
        const durum = (r.data[alan] as Satir | undefined)?.durum;
        if (durum !== undefined) expect(['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis']).toContain(durum);
      }
    }
  });
});
