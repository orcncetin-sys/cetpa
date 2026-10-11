// @vitest-environment node
/**
 * magazaTalepFormu.sunucu.pglite.test.ts — FORMUN GÖSTERDİĞİ = SUNUCUNUN YAZDIĞI (inceleme 2b, bulgu 1 + 3 + 5 + 6;
 * şartname v6 § 10.2 (a) 3 istisnası, § 10.4).
 *
 * Bulgu: form önizlemesi mevcut teyit kaleminin KAYITLI oranını gösteriyor, sunucu ise `urun` / `varsayilan` kaynaklı kalemi
 * her yazımda ürün kaydından yeniden çözüyordu — ürün kartı arada değişmişse ekranda 276,00 görülüp başka tutar kaydediliyor,
 * yalnız notu düzelten kişi teyit toplamını sessizce değiştiriyordu. İki taraf ayrı dosyalarda yaşadığı için saf testler bunu
 * göremedi: her biri KENDİ kuralını sabitliyordu.
 *
 * Bu dosya iki tarafı TEK zincirde koşturur — kopya kural, sahte havuz, elle kurulmuş gövde YOK:
 *   saklanan belge → istemcinin GERÇEK daraltıcısı (`magazaTalebiDaralt`) → formun taslağı (`duzenlemeTaslagi`) →
 *   ekranda görülen oran ve toplam (`magazaTaslakKdv`, `magazaTaslakOnizlemesi`; ürün oranı OrdersPage'in verdiği işlevle:
 *   `sku => magazaUrunKdvOrani(inventory, sku)`) → formun gövdesi (`magazaIcerikGovdesi`) → rotanın GERÇEK şeması
 *   (`ErpIcerikGovdesi`) → GERÇEK yazma işlevi (`talepIcerigiDegistir`) → GERÇEK PostgreSQL (PGlite) → saklanan teyit.
 * Kilitlenen değişmez: kayıttan ÖNCE ekranda görülen oran, kaynak ve üç toplam = kayıttan SONRA belgede duran.
 * Kurallardan biri tek başına değişirse (form ya da sunucu) bu dosya kırılır.
 *
 * PARA ÖRNEĞİ: 2 × 95,00 + 1 × 40,00, %20 → 230,00 · 46,00 · 276,00.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../server/docsSema';
import { ErpIcerikGovdesi } from '../server/schemas';
import { talepIcerigiDegistir } from '../server/kanal/magazaIcerik';
import type { IcerikDegistirSonucu } from '../server/kanal/magazaIcerik';
import type { MagazaIcerikDeps } from '../server/kanal/magazaDurum';
import type { MagazaPgHavuzu } from '../server/routes/magazaRoutes';
import { magazaTalebiDaralt } from '../hooks/useMagazaTalepleri';
import type { MagazaTalepSatiri } from '../hooks/useMagazaTalepleri';
import { MAGAZA_TALEP_KOLEKSIYONU, magazaUrunKdvOrani } from './magazaTalep';
import type { MagazaKdvKaynagi, MagazaKdvOrani, MagazaTeyit } from './magazaTalep';
import { duzenlemeTaslagi, magazaIcerikGovdesi, magazaTaslakKdv, magazaTaslakOnizlemesi } from './magazaTalepFormu';
import type { MagazaFormTaslagi } from './magazaTalepFormu';

// Daraltıcı kancayla aynı dosyadadır; kancanın akış istemcisi burada açılmaz (yalnız saf `magazaTalebiDaralt` çağrılır).
vi.mock('./dbClient', () => ({ collection: vi.fn(), query: vi.fn(), onSnapshot: vi.fn(() => () => {}) }));

type Satir = Record<string, unknown>;
const CID = 'kiraci-1';
const ID = `mt-${'0'.repeat(31)}1`;
const ILK_KAYIT = new Date('2026-10-10T12:00:00.000Z');
const SONRAKI_KAYIT = new Date('2026-10-11T09:30:00.000Z');
const AYSE = { uid: 'u-ayse', ad: 'Ayşe Yılmaz', eposta: 'ayse@example.com' };
const MEHMET = { uid: 'u-mehmet', ad: 'Mehmet Öztürk', eposta: 'mehmet@example.com' };

let db: PGlite;
const havuz: MagazaPgHavuzu = {
  async query(sql, params = []) {
    const r = await db.query<Satir>(sql, params);
    return { rows: r.rows };
  },
};
const deps = (simdi: Date): MagazaIcerikDeps => ({
  getPgPool: () => havuz,
  broadcastDocChange: () => undefined,
  writeAuditLog: async () => undefined,
  bildirimIste: async () => undefined,
  revizeBildirimiIste: async () => undefined,
  simdi: () => simdi,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('DELETE FROM docs'); });

// ── Düzenek ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const BEYAN = [
  { id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
  { id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: 120, tedarik: false },
];
async function talepYaz(ek: Satir = {}): Promise<void> {
  const belge = {
    companyId: CID, talepNo: 'T261010-AB12', durum: 'yeni', durumSurum: 0, olusturma: '2026-10-10T09:00:00.000Z', istemciTarihi: null,
    musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: '', il: 'İzmir', adres: 'Işıklar Cad. No: 5', vergi: '' },
    telefonSon10: '5321112233', not: 'Öğleden sonra arayın', kalemler: structuredClone(BEYAN),
    talepEdilen: { araToplam: 529.98, kdv: 106, toplam: 635.98 }, fiyatiSorulacakVar: false,
    bildirim: { durum: 'gitti', zaman: '2026-10-10T09:00:01.000Z' }, ...ek,
  };
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [MAGAZA_TALEP_KOLEKSIYONU, ID, JSON.stringify(belge)]);
}
async function belge(): Promise<Satir> {
  const r = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', [MAGAZA_TALEP_KOLEKSIYONU, ID]);
  return r.rows[0].data;
}
/** İstemcinin gördüğü satır: saklanan belge GERÇEK daraltıcıdan geçer (akışın yaptığı). */
const satir = async (): Promise<MagazaTalepSatiri> => magazaTalebiDaralt(ID, await belge());

let kartSira = 0;
/** ERP ürün kartı (`inventory`); `vatRate: undefined` → alan hiç yok. Aynı stok koduna ikinci kart ÇELİŞEN kayıt üretir. */
async function kartEkle(sku: string, vatRate?: unknown): Promise<void> {
  const veri = { sku, name: `Ürün ${sku}`, stockLevel: 5, companyId: CID, ...(vatRate !== undefined ? { vatRate } : {}) };
  await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['inventory', `kart-${++kartSira}`, JSON.stringify(veri)]);
}
async function kartOraniYaz(sku: string, vatRate: unknown): Promise<void> {
  await db.query(`UPDATE docs SET data = data || $1::jsonb WHERE coll = 'inventory' AND data->>'sku' = $2`, [JSON.stringify({ vatRate }), sku]);
}
async function kartSil(sku: string): Promise<void> {
  await db.query(`DELETE FROM docs WHERE coll = 'inventory' AND data->>'sku' = $1`, [sku]);
}
/**
 * İstemcinin ürün oranı işlevi — OrdersPage'in verdiğiyle AYNI ifade: `sku => magazaUrunKdvOrani(inventory, sku)`. `inventory`
 * istemcinin ürün listesi kopyasıdır; burada kartların O ANKİ hâlinden kurulur (kart değiştiyse istemci de değişmiş görür —
 * bulgunun senaryosu: önizleme bugünkü kartı okusaydı kayıtlı tutardan ayrışırdı).
 */
async function istemciKarti(): Promise<(sku: string) => number | undefined> {
  const r = await db.query<{ data: Satir }>(`SELECT data FROM docs WHERE coll = 'inventory'`);
  const inventory = r.rows.map(x => ({ sku: typeof x.data.sku === 'string' ? x.data.sku : '', vatRate: x.data.vatRate }));
  return sku => magazaUrunKdvOrani(inventory, sku);
}

interface Ekran { oranlar: Array<{ kdvOrani: MagazaKdvOrani; kdvKaynagi: MagazaKdvKaynagi }>; araToplam: number | null; kdv: number | null; toplam: number | null }
/** Kaydetmeden ÖNCE ekranda görülen: satır satır oran + kaynak (seçici ve «varsayılan» imi) ve üç toplam (canlı önizleme). */
function ekrandaGorulen(t: MagazaFormTaslagi, kart: (sku: string) => number | undefined): Ekran {
  const o = magazaTaslakOnizlemesi(t.kalemler, kart);
  return { oranlar: t.kalemler.map(k => magazaTaslakKdv(k, kart)), araToplam: o.araToplam, kdv: o.kdv, toplam: o.toplam };
}
/** Kayıttan SONRA belgede duran teyit — aynı biçimde. */
function kaydedilen(t: MagazaTeyit): Ekran {
  return { oranlar: t.kalemler.map(k => ({ kdvOrani: k.kdvOrani, kdvKaynagi: k.kdvKaynagi })), araToplam: t.araToplam, kdv: t.kdv, toplam: t.toplam };
}
/** Formun «İçeriği kaydet»i: formun gövdesi → rotanın GERÇEK şeması → GERÇEK yazma işlevi (rota işleyicisinin yaptığı çağrı). */
async function kaydet(acilis: MagazaTalepSatiri, t: MagazaFormTaslagi, kim: typeof AYSE, simdi: Date): Promise<IcerikDegistirSonucu> {
  const g = magazaIcerikGovdesi(t, acilis.icerikSurum, acilis.teyit !== null);
  if (!g.ok) throw new Error(`form gövde üretmedi: ${JSON.stringify(g.hatalar)}`);
  const govde = ErpIcerikGovdesi.parse(g.govde);
  return talepIcerigiDegistir(deps(simdi), { id: ID, companyId: CID, icerikSurum: govde.icerikSurum, musteri: govde.musteri, not: govde.not, teyit: govde.teyit, kim, kanal: 'erp' });
}
async function teyitOku(): Promise<MagazaTeyit> {
  const t = (await satir()).teyit;
  if (t === null) throw new Error('belgede teyit yok (ya da istemci daraltıcısı bozuk buldu)');
  return t;
}
/** Para örneğinin teyidini FORMDAN yazar (2 × 95,00 + 1 × 40,00) ve yazılan teyidi döndürür. */
async function paraOrnegiTeyidiYaz(): Promise<MagazaTeyit> {
  const acilis = await satir();
  const t = duzenlemeTaslagi(acilis);
  t.kalemler[0].fiyat = '95';
  t.kalemler[1].fiyat = '40';
  expect((await kaydet(acilis, t, AYSE, ILK_KAYIT)).sonuc).toBe('tamam');
  return teyitOku();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('ürün kaydı arada değişti — ekranda görülen oran ve toplam = kaydedilecek olan (bulgu 1 + 3)', () => {
  it('yalnız NOT değişti: form 276,00 gösterir, sunucu 276,00 saklar — teyit, `teyit.kim` ve `teyit.zaman` AYNEN; değişen alan yalnız `not`', async () => {
    // Teyit yazılırken: `DYO-0001`in kartı YOK (→ %20 `varsayilan`), `FRC-12` kartı %20 (→ `urun`).
    await kartEkle('FRC-12', 20);
    await talepYaz();
    const ilk = await paraOrnegiTeyidiYaz();
    expect(kaydedilen(ilk)).toEqual({
      oranlar: [{ kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 20, kdvKaynagi: 'urun' }], araToplam: 230, kdv: 46, toplam: 276,
    });

    // Ürün kaydı ARADA değişti: `DYO-0001` kartı sonradan eşlendi (%1), `FRC-12` %10'a çekildi.
    await kartEkle('DYO-0001', 1);
    await kartOraniYaz('FRC-12', 10);

    // Başka bir personel formu açar ve YALNIZ notu düzeltir.
    const acilis = await satir();
    const kart = await istemciKarti();
    expect([kart('DYO-0001'), kart('FRC-12')]).toEqual([1, 10]);                  // istemci de bugünkü kartı görüyor
    const t = { ...duzenlemeTaslagi(acilis), not: 'Öğleden sonra arayın — kapıda ödeme' };
    const ekran = ekrandaGorulen(t, kart);
    // Ekran = tablodaki kayıtlı tutar (detayın «Teyit edilen» sütununun bastığı değer).
    expect(ekran).toEqual(kaydedilen(ilk));
    expect(ekran.toplam).toBe(276);

    const s = await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT);
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc === 'tamam') expect(s.alanlar).toEqual(['not']);
    const sonra = await teyitOku();
    expect(kaydedilen(sonra)).toEqual(ekran);                                      // EKRANDA GÖRÜLEN = KAYDEDİLEN
    expect(sonra).toEqual(ilk);                                                    // teyit hiç yazılmadı: kalemler, toplamlar, zaman, kim
    expect(sonra.kim).toEqual({ uid: AYSE.uid, ad: AYSE.ad });
    expect(sonra.zaman).toBe(ILK_KAYIT.toISOString());
    expect((await belge()).not).toBe('Öğleden sonra arayın — kapıda ödeme');
  });

  it('kart nasıl değişirse değişsin dokunulmayan teyit sabittir: kart eklendi / %0 oldu / küme dışı (%18) oldu / silindi / ÇELİŞEN ikinci kart geldi', async () => {
    const degisimler: Array<[string, () => Promise<void>]> = [
      ['kart sonradan eklendi (%1)', () => kartEkle('DYO-0001', 1)],
      ['oran %0 oldu', () => kartOraniYaz('FRC-12', 0)],
      ['oran küme dışı (%18) oldu', () => kartOraniYaz('FRC-12', 18)],
      ['kart silindi', () => kartSil('FRC-12')],
      ['çelişen ikinci kart (%10)', () => kartEkle('FRC-12', 10)],
    ];
    for (const [ad, degistir] of degisimler) {
      await db.exec('DELETE FROM docs');
      await kartEkle('FRC-12', 20);
      await talepYaz();
      const ilk = await paraOrnegiTeyidiYaz();
      await degistir();

      const acilis = await satir();
      const kart = await istemciKarti();
      const t = { ...duzenlemeTaslagi(acilis), not: `not: ${ad}` };
      const ekran = ekrandaGorulen(t, kart);
      expect(ekran, ad).toEqual(kaydedilen(ilk));
      const s = await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT);
      expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc, ad).toEqual(['not']);
      const sonra = await teyitOku();
      expect(kaydedilen(sonra), ad).toEqual(ekran);
      expect(sonra, ad).toEqual(ilk);
    }
  });

  it('adet / fiyat değişir, stok kodu aynı: oranlar KAYITLI kalır — ekranda 325,00 / 65,00 / 390,00, belgede aynısı', async () => {
    await kartEkle('FRC-12', 20);
    await talepYaz();
    const ilk = await paraOrnegiTeyidiYaz();
    await kartEkle('DYO-0001', 1);
    await kartOraniYaz('FRC-12', 10);

    const acilis = await satir();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    t.kalemler[0].adet = '3';
    const ekran = ekrandaGorulen(t, kart);
    expect(ekran).toEqual({ oranlar: kaydedilen(ilk).oranlar, araToplam: 325, kdv: 65, toplam: 390 });
    const s = await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT);
    expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc).toEqual(['teyit']);
    const sonra = await teyitOku();
    expect(kaydedilen(sonra)).toEqual(ekran);
    // Teyit GERÇEKTEN değişti: zaman ve kim bu kez son yazana geçer.
    expect(sonra.kim).toEqual({ uid: MEHMET.uid, ad: MEHMET.ad });
    expect(sonra.zaman).toBe(SONRAKI_KAYIT.toISOString());
  });

  it('stok kodu DEĞİŞEN mevcut kalem ve YENİ kalem bugünkü karttan çözülür; dokunulmayan kalem kayıtlı kalır — iki tarafta da aynı sonuç', async () => {
    await kartEkle('FRC-12', 20);
    await talepYaz();
    await paraOrnegiTeyidiYaz();
    await kartEkle('DYO-0001', 1);
    await kartOraniYaz('FRC-12', 10);
    await kartEkle('RUL-5', 10);

    const acilis = await satir();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    t.kalemler[1].sku = 'RUL-5';                                                   // kayıtlı %20 başka ürüne aitti
    // Yeni kalem `DYO-0001` kodunu taşısa da KAYITLI oranı yoktur (anahtarsız): bugünkü karttan %1.
    t.kalemler.push({ yerel: 99, anahtar: null, id: '', sku: 'DYO-0001', ad: 'Astar', marka: 'DYO', adet: '1', fiyat: '100', tedarik: false, secilenKdv: null, kayitliKdv: null });
    const ekran = ekrandaGorulen(t, kart);
    // 190,00 × %20 + 40,00 × %10 + 100,00 × %1 = 38,00 + 4,00 + 1,00.
    expect(ekran).toEqual({
      oranlar: [{ kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 10, kdvKaynagi: 'urun' }, { kdvOrani: 1, kdvKaynagi: 'urun' }],
      araToplam: 330, kdv: 43, toplam: 373,
    });
    expect((await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT)).sonuc).toBe('tamam');
    expect(kaydedilen(await teyitOku())).toEqual(ekran);
  });

  it('stok kodu kutusuna baş / son BOŞLUK eklemek iki tarafta da «kod değişti» DEĞİLDİR: kayıtlı oran korunur, teyit yazılmaz', async () => {
    await kartEkle('FRC-12', 20);
    await talepYaz();
    const ilk = await paraOrnegiTeyidiYaz();
    await kartOraniYaz('FRC-12', 10);

    const acilis = await satir();
    const kart = await istemciKarti();
    const t = { ...duzenlemeTaslagi(acilis), not: 'boşluklu kod' };
    t.kalemler[1].sku = '  FRC-12 ';
    const ekran = ekrandaGorulen(t, kart);
    expect(ekran).toEqual(kaydedilen(ilk));
    const s = await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT);
    expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc).toEqual(['not']);
    expect(await teyitOku()).toEqual(ilk);
  });

  it('kayıtlı `personel` oranı stok kodu değişse de korunur; iki tarafta da', async () => {
    await talepYaz();
    const ilkAcilis = await satir();
    const ilkTaslak = duzenlemeTaslagi(ilkAcilis);
    ilkTaslak.kalemler[0].fiyat = '95';
    ilkTaslak.kalemler[0].secilenKdv = 10;                                         // personel seçti
    ilkTaslak.kalemler[1].fiyat = '40';
    expect((await kaydet(ilkAcilis, ilkTaslak, AYSE, ILK_KAYIT)).sonuc).toBe('tamam');
    expect(kaydedilen(await teyitOku()).oranlar).toEqual([{ kdvOrani: 10, kdvKaynagi: 'personel' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }]);
    await kartEkle('YENI-KOD', 1);

    const acilis = await satir();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    t.kalemler[0].sku = 'YENI-KOD';
    const ekran = ekrandaGorulen(t, kart);
    // 190,00 × %10 + 40,00 × %20 = 19,00 + 8,00 — kartın %1'i DEĞİL.
    expect(ekran).toEqual({ oranlar: [{ kdvOrani: 10, kdvKaynagi: 'personel' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }], araToplam: 230, kdv: 27, toplam: 257 });
    expect((await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT)).sonuc).toBe('tamam');
    expect(kaydedilen(await teyitOku())).toEqual(ekran);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('«varsayılan» oranı onaylamak (bulgu 5) — ekranda `personel`, belgede `personel`', () => {
  it('onaylanan satır %20 `personel` olarak yazılır, tutar DEĞİŞMEZ; onaylanmayan satır `varsayilan` kalır; sonraki kart eşlemesi onaylanmış oranı değiştirmez', async () => {
    await talepYaz();                                                              // iki kalemin de kartı yok → ikisi de `varsayilan`
    const ilk = await paraOrnegiTeyidiYaz();
    expect(kaydedilen(ilk).oranlar).toEqual([{ kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }]);

    const acilis = await satir();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    // «oranı onayla» düğmesinin yazdığı alan: görünen oran seçilmiş sayılır (`MagazaTalepDuzenle.tsx`).
    t.kalemler[0].secilenKdv = magazaTaslakKdv(t.kalemler[0], kart).kdvOrani;
    const ekran = ekrandaGorulen(t, kart);
    expect(ekran).toEqual({ oranlar: [{ kdvOrani: 20, kdvKaynagi: 'personel' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }], araToplam: 230, kdv: 46, toplam: 276 });
    const s = await kaydet(acilis, t, MEHMET, SONRAKI_KAYIT);
    expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc).toEqual(['teyit']);          // kaynak değişti: teyit yazıldı
    expect(kaydedilen(await teyitOku())).toEqual(ekran);

    // Kart sonradan %1 ile eşlense de onaylanmış oran durur (iki tarafta da).
    await kartEkle('DYO-0001', 1);
    const sonAcilis = await satir();
    const sonKart = await istemciKarti();
    const sonTaslak = { ...duzenlemeTaslagi(sonAcilis), not: 'kart eşlendi' };
    const sonEkran = ekrandaGorulen(sonTaslak, sonKart);
    expect(sonEkran).toEqual(ekran);
    expect((await kaydet(sonAcilis, sonTaslak, AYSE, SONRAKI_KAYIT)).sonuc).toBe('tamam');
    expect(kaydedilen(await teyitOku())).toEqual(sonEkran);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('teyidi olmayan talep beyan kopyasıyla açılır (bulgu 6; § 10.4) — ekranda görülen = ilk teyit', () => {
  it('dokunmadan kaydet: teyit beyandaki adet ve fiyatla yazılır; oranlar ürün kaydından (paket soneki, küme dışı oran, kartsız kalem); BEYAN alan alan AYNI', async () => {
    await kartEkle('DEKOR-1325', 10);                                              // paket kodu `-D002` taban karta düşer
    await kartEkle('ESKI-18', 18);                                                 // küme dışı → %20 `varsayilan`
    const beyan = [
      { id: 'u1', sku: 'DEKOR-1325-D002', ad: 'Fırça (2\'li paket)', marka: 'Dekor', adet: 3, talepFiyat: 49.9, tedarik: false },
      { id: 'u2', sku: 'ESKI-18', ad: 'Eski oranlı ürün', marka: '', adet: 2, talepFiyat: 50, tedarik: false },
      { id: 'u3', sku: '', ad: 'Stok kodsuz kalem', marka: '', adet: 1, talepFiyat: 15, tedarik: true },
    ];
    await talepYaz({ kalemler: beyan, talepEdilen: { araToplam: 264.7, kdv: 52.94, toplam: 317.64 } });
    const once = await belge();

    const acilis = await satir();
    expect(acilis.teyit).toBeNull();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    expect(t.kalemler.map(k => k.anahtar)).toEqual(['b:0', 'b:1', 'b:2']);
    const ekran = ekrandaGorulen(t, kart);
    // 149,70 × %10 + 100,00 × %20 + 15,00 × %20 = 14,97 + 20,00 + 3,00.
    expect(ekran).toEqual({
      oranlar: [{ kdvOrani: 10, kdvKaynagi: 'urun' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 20, kdvKaynagi: 'varsayilan' }],
      araToplam: 264.7, kdv: 37.97, toplam: 302.67,
    });
    const s = await kaydet(acilis, t, AYSE, ILK_KAYIT);
    expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc).toEqual(['teyit']);
    const teyit = await teyitOku();
    expect(kaydedilen(teyit)).toEqual(ekran);
    expect(teyit.kalemler.map(k => [k.sku, k.adet, k.birimFiyat])).toEqual([['DEKOR-1325-D002', 3, 49.9], ['ESKI-18', 2, 50], ['', 1, 15]]);
    // Müşterinin ilk talebi hiçbir yolda değişmez (V16).
    const sonra = await belge();
    expect(sonra.kalemler).toEqual(once.kalemler);
    expect(sonra.talepEdilen).toEqual(once.talepEdilen);
  });

  it('fiyatı sorulacak beyan kalemi: ekranda üç toplam da BOŞ («fiyat sorulacak»), belgede üçü de `null` (0 ya da kısmi toplam değil)', async () => {
    await talepYaz({ kalemler: [BEYAN[0], { ...BEYAN[1], talepFiyat: null }], fiyatiSorulacakVar: true });
    const acilis = await satir();
    const kart = await istemciKarti();
    const t = duzenlemeTaslagi(acilis);
    expect(magazaTaslakOnizlemesi(t.kalemler, kart).durum).toBe('fiyat-sorulacak');
    const ekran = ekrandaGorulen(t, kart);
    expect([ekran.araToplam, ekran.kdv, ekran.toplam]).toEqual([null, null, null]);
    expect((await kaydet(acilis, t, AYSE, ILK_KAYIT)).sonuc).toBe('tamam');
    const teyit = await teyitOku();
    expect(kaydedilen(teyit)).toEqual(ekran);
    expect(teyit.kalemler.map(k => k.birimFiyat)).toEqual([204.99, null]);
  });

  it('çıkış yolu: bütün kalemler kaldırılıp yalnız telefon düzeltilirse belgeye teyit YAZILMAZ; değişen alan yalnız `musteri`', async () => {
    await talepYaz();
    const acilis = await satir();
    const t = duzenlemeTaslagi(acilis);
    const yalnizMusteri: MagazaFormTaslagi = { ...t, musteri: { ...t.musteri, telefon: '0 532 111 22 34' }, kalemler: [] };
    const s = await kaydet(acilis, yalnizMusteri, AYSE, ILK_KAYIT);
    expect(s.sonuc === 'tamam' ? s.alanlar : s.sonuc).toEqual(['musteri']);
    const b = await belge();
    expect(Object.prototype.hasOwnProperty.call(b, 'teyit')).toBe(false);
    expect((await satir()).teyit).toBeNull();
    expect((await satir()).musteri.telefon).toBe('0 532 111 22 34');
  });
});
