// @vitest-environment node
/**
 * magazaBildirim.pglite.test.ts — REVİZE bildiriminin yazıcıları GERÇEK PostgreSQL motorunda (şartname v6 § 10.8 «Gerçek
 * motor»; kapı 4, Y3 — «üç revize sabiti PGlite'ta koşar»).
 *
 * `@electric-sql/pglite` (PostgreSQL WASM). Kapı 3 ve 4'ün bu alandaki üç bulgusu yalnız gerçek jsonb işleçleriyle göründü
 * (sahte havuz göremez): dilim 1'in tam değiştirme kalıbı `bildirimRevize`'ye uygulanınca `alanlar` / `kim` / `icerikSurum`
 * düşüyor, sonraki sürüm koşulu NULL'a takılıyor, `gitti` HİÇ yazılamıyor ve posta her denemede yeniden gidiyordu. Burada
 * üç yazıcı aynı belgede sırayla koşturulur:
 *   · `REVIZE_YAZ_SQL` (işçi; bu dosyanın modülü)                       — sonuç yazımı, okunan `icerikSurum` ile koşullu
 *   · `MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL` (açılış süpürmesi; bu modül)   — yalnız durum + zaman
 *   · `BILDIRIM_REVIZE_YENIDEN_SQL` (ERP «Yeniden gönder»; magazaDurum) — `deneme` / `hataSinifi` düşer, üç alan korunur
 * ve revizyonu YARATAN tek ifade (`ICERIK_SQL`, `talepIcerigiDegistir`) ile birlikte uçtan uca: içerik yazımı → işçi →
 * `gitti`. Düzenek `magazaDurum.pglite.test.ts` / `magazaIcerik.pglite.test.ts` ile aynıdır (dosya başına bir örnek, tablo
 * DDL'i `docsSema.ts`'ten). Gönderici SAHTEDİR: SMTP bağlantısı açılmaz, gerçek posta sunucusuna istek YOK.
 *
 * ÖLÇÜLMEYEN: kilitte bekleyen gerçek eşzamanlı UPDATE (PGlite tek bağlantı) ve canlı PostgreSQL 15 (PGlite 18).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { DOCS_INDEKS_DDL, DOCS_TABLOSU_DDL } from '../docsSema';
import { MAGAZA_TALEP_KOLEKSIYONU, alanlariBirlestir } from '../../lib/magazaTalep';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';

// Gönderici sahte: SMTP bağlantısı HİÇ açılmaz. `smtpHataSinifi` gerçek kalır.
vi.mock('../smtpPosta', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('../smtpPosta')>();
  return { ...asil, smtpGonder: vi.fn() };
});

import { smtpGonder } from '../smtpPosta';
import { BILDIRIM_REVIZE_YENIDEN_SQL, bildirimiYenidenKuyrugaAl, kalemTeslimYaz, talepDurumunuDegistir } from './magazaDurum';
import type { MagazaIcerikDeps } from './magazaDurum';
import { elleTalepAc, talepGeriAl, talepIcerigiDegistir, talepSil } from './magazaIcerik';
import type { ElleTalepGovdesi } from './magazaIcerik';
import {
  MAGAZA_BILDIRIM_IS_SECENEKLERI, MAGAZA_BILDIRIM_KUYRUGU, MAGAZA_KACAN_SAHIPLEN_SQL, MAGAZA_KACAN_SINIRI, MAGAZA_KACAN_YETIM_ESIGI_MS, MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL,
  MAGAZA_REVIZE_KUYRUGU, REVIZE_OKU_SQL, REVIZE_YAZ_SQL,
  magazaBildirimIsle, magazaBildirimIsteyici, magazaBildirimKacanlariKuyrukla, magazaRevizeBildirimIsle, magazaRevizeBildirimIsteyici, magazaRevizeKacanlariKuyrukla,
} from './magazaBildirim';
import type { MagazaBildirimDeps } from './magazaBildirim';

const gonder = vi.mocked(smtpGonder);

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
/** İlk eşleşen sorgudan SONRA `araya`yı koşturan havuz (işçinin okuması ile yazması arasına giren başka yazımı taklit eder). */
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

/** İşçi bağlamı (kuyruk YOK) + içerik yazma bağlamı (iki isteyici casus). Aynı havuz, aynı saat. */
function deps(h: MagazaPgHavuzu = havuz, simdi: () => Date = () => SAAT) {
  const yayin = vi.fn<MagazaBildirimDeps['broadcastDocChange']>();
  const isci: MagazaBildirimDeps = { getPgPool: () => h, broadcastDocChange: yayin, appUrl: () => 'https://app.cetpa.com.tr', simdi };
  const iste = vi.fn<MagazaIcerikDeps['bildirimIste']>(async () => undefined);
  const revizeIste = vi.fn<MagazaIcerikDeps['revizeBildirimiIste']>(async () => undefined);
  const icerik: MagazaIcerikDeps = {
    getPgPool: () => havuz, broadcastDocChange: vi.fn(), writeAuditLog: vi.fn(async () => undefined), bildirimIste: iste, revizeBildirimiIste: revizeIste, simdi,
  };
  return { isci, icerik, yayin, iste, revizeIste };
}

let sira = 0;
const kimlik = (): string => `mt-${String(++sira).padStart(32, '0')}`;
const REVIZE = { durum: 'bekliyor', zaman: '2026-10-10T11:00:00.000Z', alanlar: ['not', 'teyit'], kim: { uid: 'u-r', ad: 'Revize Eden' }, icerikSurum: 2 };
const MUSTERI = { ad: 'Şükrü Öztürk', firma: 'Işık Yapı', telefon: '0532 111 22 33', eposta: 'sukru@example.com', il: 'Antalya', adres: 'Aksu', vergi: '2470000000' };
function taban(ek: Satir = {}): Satir {
  return {
    companyId: CID, talepNo: 'T261010-AB12', durum: 'teyit', durumSurum: 3, olusturma: '2026-10-08T09:00:00.000Z',
    durumZamani: '2026-10-08T10:00:00.000Z', istemciTarihi: null, musteri: { ...MUSTERI }, telefonSon10: '5321112233', not: 'kapıda ödeme',
    kalemler: [{ id: 'k0', sku: 'ABC', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 99.5, tedarik: false }],
    talepEdilen: { araToplam: 199, kdv: 39.8, toplam: 238.8 }, fiyatiSorulacakVar: false,
    bildirim: { durum: 'gitti', zaman: '2026-10-08T09:00:01.000Z' }, ...ek,
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
const revize = async (id: string): Promise<unknown> => (await belge(id)).bildirimRevize;
/** `bildirimRevize` DIŞINDAKİ her alan (yazıcı başka hiçbir alana dokunmadı mı). */
const gerisi = (b: Satir): Satir => Object.fromEntries(Object.entries(b).filter(([ad]) => ad !== 'bildirimRevize'));
const yaz = async (id: string, yama: Satir, surum: unknown): Promise<Satir[]> =>
  (await db.query<Satir>(REVIZE_YAZ_SQL, [COLL, id, JSON.stringify(yama), surum])).rows;
const KACAN_PARAMETRELERI = (an: number): unknown[] => [COLL, new Date(an).toISOString(), new Date(an - MAGAZA_KACAN_YETIM_ESIGI_MS).toISOString()];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DOCS_TABLOSU_DDL);
  for (const ddl of DOCS_INDEKS_DDL) await db.exec(ddl);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM docs');
  sorgular = [];
  gonder.mockReset();
  gonder.mockResolvedValue({ ok: true });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('REVIZE_YAZ_SQL — işçinin sonuç yazımı (kapı 4, Y3 (a))', () => {
  it('güncel `icerikSurum` ile `gitti` 1 satır; bayat sürümle 0 satır ve belge AYNEN', async () => {
    const id = await talep({ bildirimRevize: REVIZE });
    const once = await belge(id);
    expect(await yaz(id, { durum: 'gitti', zaman: 'z1' }, 1)).toEqual([]);          // bayat (okunan 1, belgedeki 2)
    expect(await yaz(id, { durum: 'gitti', zaman: 'z1' }, 3)).toEqual([]);          // ileri sürüm de tutmaz (eşitlik)
    expect(await belge(id)).toEqual(once);
    const satirlar = await yaz(id, { durum: 'gitti', zaman: '2026-10-10T12:00:00.000Z' }, 2);
    expect(satirlar).toHaveLength(1);
    expect((satirlar[0].data as Satir).bildirimRevize).toEqual({ ...REVIZE, durum: 'gitti', zaman: '2026-10-10T12:00:00.000Z' });
    // Başka HİÇBİR alan değişmedi (ilk bildirim, müşteri, kalemler, sayaçlar …).
    expect(gerisi(await belge(id))).toEqual(gerisi(once));
  });

  it('işçinin «yeniden dene» yazımından (`bekliyor` + `deneme: 1` + `hataSinifi`) sonra `alanlar` / `kim` / `icerikSurum` alan alan KORUNUR; ardından güncel sürümle `gitti` 1 satır', async () => {
    const id = await talep({ bildirimRevize: REVIZE });
    expect(await yaz(id, { durum: 'bekliyor', deneme: 1, hataSinifi: 'baglanti', zaman: 'z1' }, 2)).toHaveLength(1);
    const ara = await revize(id) as Satir;
    expect(ara).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: 'z1', deneme: 1, hataSinifi: 'baglanti' });
    expect(ara.alanlar).toEqual(REVIZE.alanlar);
    expect(ara.kim).toEqual(REVIZE.kim);
    expect(ara.icerikSurum).toBe(2);                    // düşseydi sonraki koşul `NULL = 2` olur, `gitti` hiç yazılamazdı
    expect(await yaz(id, { durum: 'bekliyor', deneme: 2, hataSinifi: 'tls', zaman: 'z2' }, 2)).toHaveLength(1);
    expect(await yaz(id, { durum: 'gitti', zaman: 'z3' }, 2)).toHaveLength(1);
    // `gitti` yazımında önceki `deneme` / `hataSinifi` kalır (bilgi; `gitti`de okunmaz) — üç alan yine yerinde.
    expect(await revize(id)).toEqual({ ...REVIZE, durum: 'gitti', zaman: 'z3', deneme: 2, hataSinifi: 'tls' });
  });

  it('`gitti` ASLA ezilmez: geç kalan başarısız yazım 0 satır (gitmiş posta «gönderilemedi» görünmez)', async () => {
    const id = await talep({ bildirimRevize: { ...REVIZE, durum: 'gitti' } });
    const once = await belge(id);
    for (const yama of [{ durum: 'gonderilemedi', hataSinifi: 'diger', zaman: 'z' }, { durum: 'bekliyor', deneme: 3, zaman: 'z' }, { durum: 'gitti', zaman: 'z' }]) {
      expect(await yaz(id, yama, 2), yama.durum).toEqual([]);
    }
    expect(await belge(id)).toEqual(once);
  });

  it('`bildirimRevize` yok / JSON null / çöp dizge / dizi / sayı → 0 satır, HATA YOK (`jsonb_typeof` koşulu); yoktan revizyon YARATILMAZ', async () => {
    for (const deger of [undefined, null, 'çöp', ['not'], 7]) {
      const id = await talep(deger === undefined ? {} : { bildirimRevize: deger });
      const once = await belge(id);
      await expect(yaz(id, { durum: 'gitti', zaman: 'z' }, 2), JSON.stringify(deger)).resolves.toEqual([]);
      expect(await belge(id)).toEqual(once);
    }
  });

  it('`durum` alanı OLMAYAN nesne de yazılır (`IS DISTINCT FROM` NULL\'u «gitti değil» sayar); `=` olsaydı NULL koşulu satırı düşürürdü', async () => {
    const id = await talep({ bildirimRevize: { alanlar: ['not'], kim: REVIZE.kim, icerikSurum: 2 } });
    expect(await yaz(id, { durum: 'gitti', zaman: 'z' }, 2)).toHaveLength(1);
    expect(await revize(id)).toEqual({ alanlar: ['not'], kim: REVIZE.kim, icerikSurum: 2, durum: 'gitti', zaman: 'z' });
  });

  it('araya giren yeni revizyon (`ICERIK_SQL` sürümü artırdı, `bekliyor`u yeniden yazdı) → işçinin bayat sürümlü yazımı 0 satır; yeni `bekliyor` EZİLMEZ', async () => {
    const id = await talep({ icerikSurum: 2, bildirimRevize: REVIZE });
    const { icerik } = deps();
    const s = await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 2, not: 'yeni not', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    const yeni = await revize(id) as Satir;
    expect(yeni.icerikSurum).toBe(3);
    expect(yeni.durum).toBe('bekliyor');
    expect(await yaz(id, { durum: 'gitti', zaman: 'z' }, 2)).toEqual([]);            // işçi 2'yi okumuştu
    expect(await revize(id)).toEqual(yeni);
    expect(await yaz(id, { durum: 'gitti', zaman: 'z' }, 3)).toHaveLength(1);        // o revizyonun kendi işi
  });

  it('kiracı / koleksiyon / kimlik: yalnız hedef satır yazılır; komşu satırın BOZUK sürüm sayacı (`\'x\'`, `3.5`) hedef yazımı düşürmez', async () => {
    const hedef = await talep({ bildirimRevize: REVIZE });
    const komsu1 = await talep({ bildirimRevize: { ...REVIZE, icerikSurum: 'x' } });
    const komsu2 = await talep({ bildirimRevize: { ...REVIZE, icerikSurum: 3.5 } });
    await db.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', ['baskaKoleksiyon', hedef, JSON.stringify({ bildirimRevize: { ...REVIZE, icerikSurum: 'y' } })]);
    const komsular = [await belge(komsu1), await belge(komsu2)];
    await expect(yaz(hedef, { durum: 'gitti', zaman: 'z' }, 2)).resolves.toHaveLength(1);
    expect([await belge(komsu1), await belge(komsu2)]).toEqual(komsular);
    const baska = await db.query<{ data: Satir }>('SELECT data FROM docs WHERE coll = $1 AND id = $2', ['baskaKoleksiyon', hedef]);
    expect((baska.rows[0].data.bildirimRevize as Satir).durum).toBe('bekliyor');
  });

  it('hedef satırın KENDİ sürüm sayacı bozuksa (`\'x\'`) sorgu HATA verir — işçi bu yüzden sürümü okuma anında doğrular ve bozuksa hiç göndermez', async () => {
    const id = await talep({ bildirimRevize: { ...REVIZE, icerikSurum: 'x' } });
    await expect(yaz(id, { durum: 'gitti', zaman: 'z' }, 2)).rejects.toThrow();
    // İşçi: sürüm tam sayı değil → posta YOK, yazım YOK (sonucu yazılamayacak gönderim her kuyruğa alınışta yinelenirdi).
    const { isci } = deps();
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).not.toHaveBeenCalled();
    expect(sorgular.filter((s) => s.sql === REVIZE_YAZ_SQL)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL — açılış süpürmesi (kapı 3, K9 → kapı 4, Y3 (c))', () => {
  const AN = Date.parse('2026-10-10T12:00:00.000Z');
  const ESKI = new Date(AN - MAGAZA_KACAN_YETIM_ESIGI_MS - 60_000).toISOString();   // yetim eşiğinden 1 dk eski
  const TAZE = new Date(AN - MAGAZA_KACAN_YETIM_ESIGI_MS + 60_000).toISOString();   // eşikten 1 dk taze
  const supur = async (): Promise<Array<{ id: string; data: Satir }>> =>
    (await db.query<{ id: string; data: Satir }>(MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL, KACAN_PARAMETRELERI(AN))).rows;

  it('`yapilandirilmamis` ve yetim `bekliyor` sahiplenilir: YALNIZ durum + zaman yazılır; `alanlar` / `kim` / `icerikSurum` (ve `hataSinifi`) alan alan KORUNUR', async () => {
    const yapisiz = await talep({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: TAZE } });   // yaş penceresi YOK
    const yetim = await talep({ bildirimRevize: { ...REVIZE, zaman: ESKI, alanlar: ['musteri'], icerikSurum: 7, hataSinifi: 'diger' } });
    const onceki = { [yapisiz]: await belge(yapisiz), [yetim]: await belge(yetim) };
    const satirlar = await supur();
    expect(satirlar.map((s) => s.id).sort()).toEqual([yapisiz, yetim].sort());
    const simdi = new Date(AN).toISOString();
    expect(await revize(yapisiz)).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: simdi });
    expect(await revize(yetim)).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: simdi, alanlar: ['musteri'], icerikSurum: 7, hataSinifi: 'diger' });
    for (const id of [yapisiz, yetim]) {
      expect(gerisi(await belge(id)), id).toEqual(gerisi(onceki[id]));              // `bildirim` dâhil başka hiçbir alan değişmedi
      expect(satirlar.find((s) => s.id === id)?.data).toEqual(await belge(id));     // RETURNING satırın YENİ hâli (yayın bunu basar)
    }
    // Sahiplenilen satıra işçinin yazımı güncel sürümle 1 SATIR (dilim 1 kalıbı uygulansaydı sürüm düşer, 0 satır kalırdı).
    expect(await yaz(yapisiz, { durum: 'gitti', zaman: 'z' }, 2)).toHaveLength(1);
    expect(await yaz(yetim, { durum: 'gitti', zaman: 'z' }, 7)).toHaveLength(1);
  });

  it('sahiplenilMEYENLER: taze `bekliyor`, `deneme` yazılmış `bekliyor` (canlı kuyruk işi), `gitti`, `gonderilemedi`, zamanı biçimsiz `bekliyor`, alan yok / çöp', async () => {
    const kimlikler = [
      await talep({ bildirimRevize: { ...REVIZE, zaman: TAZE } }),
      await talep({ bildirimRevize: { ...REVIZE, zaman: ESKI, deneme: 2 } }),
      await talep({ bildirimRevize: { ...REVIZE, durum: 'gitti', zaman: ESKI } }),
      await talep({ bildirimRevize: { ...REVIZE, durum: 'gonderilemedi', zaman: ESKI, hataSinifi: 'kimlik' } }),
      await talep({ bildirimRevize: { ...REVIZE, zaman: '2020-bozuk' } }),
      await talep({ bildirimRevize: { ...REVIZE, zaman: '' } }),
      await talep({ bildirimRevize: { durum: 'bekliyor', alanlar: ['not'], kim: REVIZE.kim, icerikSurum: 2 } }),   // zaman yok
      await talep({}),
      await talep({ bildirimRevize: 'çöp' }),
      await talep({ bildirimRevize: null }),
    ];
    const once = await Promise.all(kimlikler.map(belge));
    expect(await supur()).toEqual([]);
    expect(await Promise.all(kimlikler.map(belge))).toEqual(once);
  });

  it('İLK bildirim alanına DOKUNMAZ: `bildirim` yapılandırılmamış / yetim olsa da revize süpürmesi onu sahiplenmez (tersi de: ilk süpürme `bildirimRevize`\'ye dokunmaz)', async () => {
    const id = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI }, bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI } });
    const yalnizIlk = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI } });
    expect((await supur()).map((s) => s.id)).toEqual([id]);                          // yalnız revizesi olan satır
    expect((await belge(id)).bildirim).toEqual({ durum: 'yapilandirilmamis', zaman: ESKI });
    expect((await belge(yalnizIlk)).bildirim).toEqual({ durum: 'yapilandirilmamis', zaman: ESKI });
    // İlk bildirimin süpürmesi: iki satırın `bildirim`ini sahiplenir (nesneyi bütünüyle değiştirir), `bildirimRevize` AYNEN kalır.
    const revizeOnce = await revize(id);
    const ilk = await db.query<{ id: string }>(MAGAZA_KACAN_SAHIPLEN_SQL, KACAN_PARAMETRELERI(AN));
    expect(ilk.rows.map((s) => s.id).sort()).toEqual([id, yalnizIlk].sort());
    expect((await belge(id)).bildirim).toEqual({ durum: 'bekliyor', zaman: new Date(AN).toISOString() });
    expect(await revize(id)).toEqual(revizeOnce);
    expect(await belge(yalnizIlk)).not.toHaveProperty('bildirimRevize');             // yoktan revizyon yaratılmadı
  });

  it('ikinci koşu aynı satırı BULAMAZ (sahiplenilen satır taze `bekliyor`dur): aynı talep için çift iş yok', async () => {
    await talep({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI } });
    expect(await supur()).toHaveLength(1);
    expect(await supur()).toEqual([]);
  });

  it(`sel koruması: en çok ${MAGAZA_KACAN_SINIRI} satır, EN YENİ revizyon önce (\`icerikZamani\` — \`olusturma\` değil); kalanlar sonraki açılışa`, async () => {
    const adet = MAGAZA_KACAN_SINIRI + 2;
    const kimlikler: string[] = [];
    for (let i = 0; i < adet; i += 1) {
      // `olusturma` sırası `icerikZamani` sırasının TERSİ: sıra alanı yanlış seçilseydi dışarıda kalan iki satır değişirdi.
      kimlikler.push(await talep({
        olusturma: new Date(AN - i * 60_000).toISOString(),
        icerikZamani: new Date(AN - (adet - i) * 60_000).toISOString(),
        bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI },
      }));
    }
    const alinan = (await supur()).map((s) => s.id);
    expect(alinan).toHaveLength(MAGAZA_KACAN_SINIRI);
    // En ESKİ revize edilen iki talep (i = 0, 1) dışarıda kaldı.
    expect(kimlikler.filter((k) => !alinan.includes(k))).toEqual([kimlikler[0], kimlikler[1]]);
    expect((await supur()).map((s) => s.id).sort()).toEqual([kimlikler[0], kimlikler[1]].sort());
  });

  it('süpürme işlevi uçtan uca: sahiplenir, kiracı etiketiyle yayınlar, REVİZE kuyruğuna `{ talepId }` koyar; iş gelince işçi gönderir ve `gitti` yazar', async () => {
    const id = await talep({ icerikZamani: '2026-10-09T08:00:00.000Z', bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI } });
    const { isci, yayin } = deps();
    const send = vi.fn(async (..._bagimsizlar: unknown[]) => 'is-1');
    const sonuc = await magazaRevizeKacanlariKuyrukla(isci, () => ({ send }), async () => ({ ok: true }), () => ({ tamam: true }), () => AN);
    expect(sonuc).toEqual({ alinan: 1, kuyrukta: 1 });
    expect(send.mock.calls).toEqual([[MAGAZA_REVIZE_KUYRUGU, { talepId: id }, MAGAZA_BILDIRIM_IS_SECENEKLERI]]);
    expect(yayin).toHaveBeenCalledWith(COLL, 'set', id, expect.objectContaining({ companyId: CID }), { cid: CID });
    expect(gonder).not.toHaveBeenCalled();                                           // süpürme süreç içi GÖNDERMEZ
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(gonder.mock.calls[0][0].metin).toContain('Değişen alanlar: Not, Teyit edilen kalemler');
    expect(gonder.mock.calls[0][0].metin).toContain('Revize eden: Revize Eden');
    expect(await revize(id)).toEqual({ ...REVIZE, durum: 'gitti', zaman: SAAT.toISOString() });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kaçan süpürmesi SİLİNMİŞ talebi sahiplenmez — ilk bildirim ve revize, iki dal (inceleme 2b, bulgu 9; V17 «silinmiş talep donuktur»)', () => {
  const AN = Date.parse('2026-10-10T12:00:00.000Z');
  const ESKI = new Date(AN - MAGAZA_KACAN_YETIM_ESIGI_MS - 60_000).toISOString();   // yetim eşiğinden 1 dk eski
  const SILINDI = { zaman: '2026-10-10T11:30:00.000Z', kim: { uid: 'u-s', ad: 'Silen' }, kanal: 'erp' };
  const ilkSupur = async (): Promise<string[]> => (await db.query<{ id: string }>(MAGAZA_KACAN_SAHIPLEN_SQL, KACAN_PARAMETRELERI(AN))).rows.map((s) => s.id);
  const revizeSupur = async (): Promise<string[]> => (await db.query<{ id: string }>(MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL, KACAN_PARAMETRELERI(AN))).rows.map((s) => s.id);
  const tamam = { dogrula: async () => ({ ok: true as const }), yapilandirma: () => ({ tamam: true }) };

  it('İLK bildirim: silinmiş `yapilandirilmamis` ve silinmiş yetim `bekliyor` 0 satır, belge AYNEN; canlı ve geri alınmış (`silindi: null`) satır sahiplenilir', async () => {
    const canli = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI } });
    const silinmis = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI }, silindi: SILINDI });
    const geriAlinmis = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI }, silindi: null });
    const silinmisYetim = await talep({ bildirim: { durum: 'bekliyor', zaman: ESKI }, silindi: SILINDI });
    const canliYetim = await talep({ bildirim: { durum: 'bekliyor', zaman: ESKI } });
    // Nesne OLMAYAN çöp `silindi` silinmiş SAYILMAZ (her yerdeki aynı ölçüt): sahiplenilir.
    const copIsaret = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI }, silindi: 'evet' });
    const once = { [silinmis]: await belge(silinmis), [silinmisYetim]: await belge(silinmisYetim) };
    expect((await ilkSupur()).sort()).toEqual([canli, geriAlinmis, canliYetim, copIsaret].sort());
    expect(await belge(silinmis)).toEqual(once[silinmis]);                           // `yapilandirilmamis` kaldı, `zaman` tazelenmedi
    expect(await belge(silinmisYetim)).toEqual(once[silinmisYetim]);                 // yetim `bekliyor` kaldı
    for (const id of [canli, geriAlinmis, canliYetim, copIsaret]) expect((await belge(id)).bildirim, id).toEqual({ durum: 'bekliyor', zaman: new Date(AN).toISOString() });
    // İkinci koşu: silinmişler yine alınmaz (koşul kalıcı; «bir kez atla» değil).
    expect(await ilkSupur()).toEqual([]);
  });

  it('REVİZE: silinmiş `yapilandirilmamis` ve silinmiş yetim `bekliyor` 0 satır, belge AYNEN (`alanlar` / `kim` / `icerikSurum` dâhil); canlı ve geri alınmış satır sahiplenilir', async () => {
    const canli = await talep({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI } });
    const silinmis = await talep({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI }, silindi: SILINDI });
    const geriAlinmis = await talep({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI }, silindi: null });
    const silinmisYetim = await talep({ bildirimRevize: { ...REVIZE, zaman: ESKI }, silindi: SILINDI });
    const once = { [silinmis]: await belge(silinmis), [silinmisYetim]: await belge(silinmisYetim) };
    expect((await revizeSupur()).sort()).toEqual([canli, geriAlinmis].sort());
    expect(await belge(silinmis)).toEqual(once[silinmis]);
    expect(await belge(silinmisYetim)).toEqual(once[silinmisYetim]);
    expect(await revize(silinmis)).toEqual({ ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI });   // `icerikSurum: 2` yerinde
    expect(await revize(silinmisYetim)).toEqual({ ...REVIZE, zaman: ESKI });
    // İki süpürme birbirinin alanına bakmaz ama silinmiş koşulu İKİSİNDE de geçerlidir: ilk süpürme bu satırlarda iş bulamaz (`bildirim: gitti`).
    expect(await ilkSupur()).toEqual([]);
  });

  it('uçtan uca — gerçek `talepSil` / `talepGeriAl` + süpürme işlevleri: silinmiş talep için kuyruğa iş GİRMEZ, yayın YOK, posta YOK; geri alınınca sonraki açılışta alınır (ilk + revize)', async () => {
    const ilk = await talep({ bildirim: { durum: 'yapilandirilmamis', zaman: ESKI } });
    const rev = await talep({ icerikSurum: 2, icerikZamani: '2026-10-09T08:00:00.000Z', bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: ESKI } });
    const { isci, icerik, yayin } = deps();
    await expect(talepSil(icerik, { id: ilk, companyId: CID, surum: 3, kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepSil(icerik, { id: rev, companyId: CID, surum: 3, kim: KIM, kanal: 'panel' })).resolves.toMatchObject({ sonuc: 'tamam' });
    const once = { ilk: await belge(ilk), rev: await belge(rev) };
    const send = vi.fn(async (..._bagimsizlar: unknown[]) => 'is-1');
    await expect(magazaBildirimKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => AN)).resolves.toEqual({ alinan: 0, kuyrukta: 0 });
    await expect(magazaRevizeKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => AN)).resolves.toEqual({ alinan: 0, kuyrukta: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(yayin).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
    expect({ ilk: await belge(ilk), rev: await belge(rev) }).toEqual(once);          // sahiplenme yazımı da yapılmadı
    // Geri alma: talep yeniden canlı → sonraki açılışın süpürmesi sahiplenir ve DOĞRU kuyruğa koyar.
    await expect(talepGeriAl(icerik, { id: ilk, companyId: CID, surum: 4, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepGeriAl(icerik, { id: rev, companyId: CID, surum: 4, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(magazaBildirimKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => AN)).resolves.toEqual({ alinan: 1, kuyrukta: 1 });
    await expect(magazaRevizeKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => AN)).resolves.toEqual({ alinan: 1, kuyrukta: 1 });
    expect(send.mock.calls).toEqual([
      [MAGAZA_BILDIRIM_KUYRUGU, { talepId: ilk }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
      [MAGAZA_REVIZE_KUYRUGU, { talepId: rev }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
    ]);
    expect((await belge(ilk)).bildirim).toEqual({ durum: 'bekliyor', zaman: new Date(AN).toISOString() });
    expect(await revize(rev)).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: new Date(AN).toISOString() });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('üç revize yazıcısı AYNI belgede sırayla — hiçbiri öbürünün koşulunu bozmaz (kapı 4, Y3)', () => {
  it('işçi `gonderilemedi` yazar → ERP «Yeniden gönder» (`BILDIRIM_REVIZE_YENIDEN_SQL`) `bekliyor`a çeker, `deneme` / `hataSinifi` düşer → işçi güncel sürümle `gitti` yazar', async () => {
    const id = await talep({ icerikSurum: 2, icerikZamani: '2026-10-10T11:00:00.000Z', bildirimRevize: REVIZE });
    gonder.mockResolvedValue({ ok: false, sinif: 'kimlik' });
    const { isci, icerik, revizeIste } = deps();
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 3, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(await revize(id)).toEqual({ ...REVIZE, durum: 'gonderilemedi', zaman: SAAT.toISOString(), deneme: 3, hataSinifi: 'kimlik' });
    // Elle yeniden kuyruğa alma (rota `?tur=revize`): üç alan korunur, `deneme` / `hataSinifi` düşer.
    await expect(bildirimiYenidenKuyrugaAl(icerik, { id, companyId: CID, tur: 'revize', kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(revizeIste).toHaveBeenCalledTimes(1);
    expect(revizeIste).toHaveBeenCalledWith(id);
    expect(await revize(id)).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: SAAT.toISOString() });
    expect(sorgular.some((s) => s.sql === BILDIRIM_REVIZE_YENIDEN_SQL)).toBe(true);
    gonder.mockResolvedValue({ ok: true });
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(await revize(id)).toEqual({ ...REVIZE, durum: 'gitti', zaman: SAAT.toISOString() });
    // `gitti` sonrası: elle uç `zaten-gitti` (çift posta yok), işçi `atlandi`.
    await expect(bildirimiYenidenKuyrugaAl(icerik, { id, companyId: CID, tur: 'revize', kim: KIM })).resolves.toEqual({ sonuc: 'zaten-gitti' });
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(2);
  });

  it('revize yazımı ile kalem teslim / aşama yazımı İKİ SIRADA da birbirini DÜŞÜRMEZ (ayrı alanlar; `jsonb_set` yalnız `bildirimRevize`\'yi yazar)', async () => {
    const { icerik } = deps();
    // Sıra 1: önce işçi yazımı, sonra kalem teslim + aşama.
    const a = await talep({ icerikSurum: 2, bildirimRevize: REVIZE });
    expect(await yaz(a, { durum: 'bekliyor', deneme: 1, hataSinifi: 'diger', zaman: 'z1' }, 2)).toHaveLength(1);
    await expect(kalemTeslimYaz(icerik, { id: a, companyId: CID, surum: 3, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepDurumunuDegistir(icerik, { id: a, companyId: CID, onceki: 'teyit', surum: 4, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await revize(a)).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: 'z1', deneme: 1, hataSinifi: 'diger' });
    // Sıra 2: önce kalem teslim + aşama, sonra işçi yazımı.
    const b = await talep({ icerikSurum: 2, bildirimRevize: REVIZE });
    await expect(kalemTeslimYaz(icerik, { id: b, companyId: CID, surum: 3, teslim: true, kalemler: ['b:0'], kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    await expect(talepDurumunuDegistir(icerik, { id: b, companyId: CID, onceki: 'teyit', surum: 4, yeni: 'hazirlaniyor', kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    const once = await belge(b);
    expect(await yaz(b, { durum: 'gitti', zaman: 'z2' }, 2)).toHaveLength(1);
    expect(gerisi(await belge(b))).toEqual(gerisi(once));                            // `kalemTeslim`, `durum`, `durumSurum`, `durumGecmisi` aynen
    expect((await belge(b)).kalemTeslim).toHaveProperty(['b:0', 'durum'], 'teslim');
    expect((await belge(b)).durum).toBe('hazirlaniyor');
  });

  it('silme ve geri alma `bildirimRevize`\'yi DEĞİŞTİRMEZ; silinmiş talebin kuyruktaki revize işi yine sonucunu yazar (işçi yazımı `silindi` koşulu taşımaz — şartname metni)', async () => {
    const id = await talep({ icerikSurum: 2, bildirimRevize: REVIZE });
    const { isci, icerik } = deps();
    await expect(talepSil(icerik, { id, companyId: CID, surum: 3, kim: KIM, kanal: 'erp' })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect(await revize(id)).toEqual(REVIZE);
    // Silinmeden ÖNCE kuyruğa girmiş iş: gönderir ve `gitti` yazar; `silindi` nesnesi yerinde kalır.
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    const silinmis = await belge(id);
    expect((silinmis.bildirimRevize as Satir).durum).toBe('gitti');
    expect(silinmis.silindi).toMatchObject({ kanal: 'erp' });
    await expect(talepGeriAl(icerik, { id, companyId: CID, surum: 4, kim: KIM })).resolves.toMatchObject({ sonuc: 'tamam' });
    expect((await belge(id)).bildirimRevize).toEqual(silinmis.bildirimRevize);
    expect((await belge(id)).silindi).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('elle açılan talebin İLK bildirimi (§ 10.2 (d); V20): `bekliyor` ile dilim 1 kuyruğuna — işçi ve süpürme onu mağazadan gelenden AYIRT ETMEZ', () => {
  const GOVDE: ElleTalepGovdesi = {
    musteri: { ad: 'Telefonla Arayan', telefon: '0 532 444 55 66', firma: 'Çınar İnşaat', il: 'Antalya' },
    not: 'telefonla geldi',
    kalemler: [{ ad: 'Saten boya', adet: 2, sku: 'ABC', birimFiyat: 95 }],
  };

  it('gerçek `elleTalepAc` → isteyici İLK kuyruğa `{ talepId }` koyar (revize kuyruğuna DEĞİL) → işçi «Yeni mağaza talebi» postasını gönderir, `gitti` yazar; gövdede «elle» bilgisi / açan kişi yok', async () => {
    const { isci } = deps();
    const send = vi.fn(async (..._bagimsizlar: unknown[]) => 'is-1');
    const icerik: MagazaIcerikDeps = {
      getPgPool: () => havuz, broadcastDocChange: vi.fn(), writeAuditLog: vi.fn(async () => undefined), simdi: () => SAAT,
      bildirimIste: magazaBildirimIsteyici(() => ({ send }), isci), revizeBildirimiIste: magazaRevizeBildirimIsteyici(() => ({ send }), isci),
      elleNoUret: () => 'T261010-ZZ99',
    };
    const s = await elleTalepAc(icerik, { companyId: CID, girdi: GOVDE, kim: KIM });
    expect(s.sonuc).toBe('tamam');
    if (s.sonuc !== 'tamam') return;
    expect(send.mock.calls).toEqual([[MAGAZA_BILDIRIM_KUYRUGU, { talepId: s.id }, MAGAZA_BILDIRIM_IS_SECENEKLERI]]);
    const acilan = await belge(s.id);
    expect(acilan.bildirim).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString() });   // dört değerden biri; ayrı bir «gerekmez» durumu YOK
    expect(acilan).not.toHaveProperty('bildirimRevize');                                 // elle açma revizyon DEĞİLDİR
    expect(JSON.stringify(acilan)).not.toContain(KALDIRILAN_DURUM);
    await expect(magazaBildirimIsle(s.id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
    const ileti = gonder.mock.calls[0][0];
    expect(ileti.konu).toBe('Yeni mağaza talebi: T261010-ZZ99');
    expect(ileti.metin).toContain('Saten boya');                                         // dilim 1 gövdesi: kalem listesi VAR
    for (const parca of ['Telefonla', '0 532', '5324445566', 'Çınar', 'telefonla geldi', 'Ayşe', KIM.uid, 'elle', 'Elle', "ERP'de açıldı"]) {
      expect(`${ileti.konu}\n${ileti.html}\n${ileti.metin}`, parca).not.toContain(parca);
    }
    const son = await belge(s.id);
    expect(son.bildirim).toEqual({ durum: 'gitti', zaman: SAAT.toISOString() });
    expect(son.elle).toEqual(acilan.elle);                                               // `elle` nesnesi aynen
    // Revize işçisi bu talepte yapacak iş bulamaz (alan yok): posta üretmez.
    await expect(magazaRevizeBildirimIsle(s.id, isci, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('kuyruğa girememiş elle talep (`bekliyor`, `deneme`siz) yetim eşiğinden sonra İLK bildirimin süpürmesince sahiplenilir — revize süpürmesi ona dokunmaz', async () => {
    const acilis = new Date('2026-10-10T06:00:00.000Z');
    const icerik: MagazaIcerikDeps = {
      getPgPool: () => havuz, broadcastDocChange: vi.fn(), writeAuditLog: vi.fn(async () => undefined), simdi: () => acilis,
      bildirimIste: vi.fn(async () => undefined), revizeBildirimiIste: vi.fn(async () => undefined), elleNoUret: () => 'T261010-YY88',
    };
    const s = await elleTalepAc(icerik, { companyId: CID, girdi: GOVDE, kim: KIM });
    if (s.sonuc !== 'tamam') throw new Error('elle talep açılamadı');
    const { isci } = deps();
    const send = vi.fn(async (..._bagimsizlar: unknown[]) => 'is-2');
    const an = acilis.getTime() + MAGAZA_KACAN_YETIM_ESIGI_MS + 60_000;
    const tamam = { dogrula: async () => ({ ok: true as const }), yapilandirma: () => ({ tamam: true }) };
    await expect(magazaRevizeKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => an)).resolves.toEqual({ alinan: 0, kuyrukta: 0 });
    expect(send).not.toHaveBeenCalled();
    await expect(magazaBildirimKacanlariKuyrukla(isci, () => ({ send }), tamam.dogrula, tamam.yapilandirma, () => an)).resolves.toEqual({ alinan: 1, kuyrukta: 1 });
    expect(send.mock.calls).toEqual([[MAGAZA_BILDIRIM_KUYRUGU, { talepId: s.id }, MAGAZA_BILDIRIM_IS_SECENEKLERI]]);
    expect((await belge(s.id)).bildirim).toEqual({ durum: 'bekliyor', zaman: new Date(an).toISOString() });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('uçtan uca — içerik yazımı → revize kuyruğu → işçi (gerçek `ICERIK_SQL` + gerçek `REVIZE_YAZ_SQL`; yalnız gönderici sahte)', () => {
  it('içerik yazımı `tamam` → `bildirimRevize.bekliyor` + isteyici tam 1 çağrı → işçi DAR okur, gönderir, `gitti` yazar; ilk bildirim ve içerik alan alan AYNI', async () => {
    const id = await talep({});
    const { isci, icerik, revizeIste, yayin } = deps();
    const s = await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 0, not: 'teslimat öğleden sonra', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    expect(revizeIste).toHaveBeenCalledTimes(1);
    expect(revizeIste).toHaveBeenCalledWith(id);
    const yazilan = await belge(id);
    expect(yazilan.bildirimRevize).toEqual({ durum: 'bekliyor', zaman: SAAT.toISOString(), alanlar: ['not'], kim: { uid: KIM.uid, ad: KIM.ad }, icerikSurum: 1 });
    sorgular = [];
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(sorgular.map((q) => q.sql)).toEqual([REVIZE_OKU_SQL, REVIZE_YAZ_SQL]);
    expect(gonder).toHaveBeenCalledTimes(1);
    const ileti = gonder.mock.calls[0][0];
    expect(ileti.konu).toBe('Mağaza talebi revize edildi · T261010-AB12');
    expect(ileti.metin.split('\n')).toEqual([
      'Mağaza talebi revize edildi · T261010-AB12',
      'Revize zamanı: 10.10.2026 15:00 (İstanbul saati)',
      'Revize eden: Ayşe Yılmaz',
      '',
      'Değişen alanlar: Not',
      '',
      "Müşteri bilgileri, kalemler ve tutarlar bu e-postada yer almaz. Talebin güncel hâli ERP'de: Siparişler → Mağaza Talepleri.",
      'https://app.cetpa.com.tr/orders?kaynak=magaza',
    ]);
    // Gövdede müşteri verisi / yeni not / kalem / tutar YOK (gerçek belgeden okunarak).
    for (const parca of ['Şükrü', 'Öztürk', 'Işık', '0532', 'sukru@', 'Antalya', 'Aksu', '2470000000', 'öğleden', 'kapıda', 'İç cephe', 'DYO', 'ABC', '99,5', '199', '238', '39,8', CID, KIM.uid, KIM.eposta]) {
      expect(`${ileti.konu}\n${ileti.html}\n${ileti.metin}`, parca).not.toContain(parca);
    }
    const son = await belge(id);
    expect(son.bildirimRevize).toEqual({ ...(yazilan.bildirimRevize as Satir), durum: 'gitti' });
    expect(gerisi(son)).toEqual(gerisi(yazilan));
    expect(son.bildirim).toEqual({ durum: 'gitti', zaman: '2026-10-08T09:00:01.000Z' });   // ilk bildirim EZİLMEDİ
    expect(yayin).toHaveBeenCalledWith(COLL, 'set', id, son, { cid: CID });
  });

  it('işçi okuduktan SONRA gelen revizyon → `REVIZE_YAZ_SQL` 0 satır, iş biter, işçi YENİ İŞ GÖNDERMEZ; sonraki iş `bekliyor` görüp birleşik alanlarla gönderir (ikinci posta)', async () => {
    const id = await talep({});
    const { icerik, revizeIste } = deps();
    await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 0, not: 'birinci', kim: KIM, kanal: 'erp' });
    expect(revizeIste).toHaveBeenCalledTimes(1);
    // İşçinin dar okumasından hemen sonra ikinci revizyon (müşteri telefonu) araya girer.
    const ikinciYazan = { uid: 'u-2', ad: 'Mehmet Öz', eposta: 'mehmet@example.com' };
    const araya = arayaGiren((sql) => sql === REVIZE_OKU_SQL, async () => {
      const s2 = await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 1, musteri: { ...MUSTERI, telefon: '0533 222 33 44' }, kim: ikinciYazan, kanal: 'erp' });
      expect(s2.sonuc).toBe('tamam');
    });
    const { isci, yayin } = deps(araya);
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');   // posta gitti (ilk revizyonun listesiyle)
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(gonder.mock.calls[0][0].metin).toContain('Değişen alanlar: Not\n');
    // 0 satır: `gitti` YAZILMADI, araya giren revizyonun `bekliyor`u duruyor; alanlar SQL'de birleşti (`null` DEĞİL).
    const ara = await revize(id) as Satir;
    expect(ara.durum).toBe('bekliyor');
    expect(ara.icerikSurum).toBe(2);
    expect(ara.alanlar).toEqual(['not', 'musteri']);
    expect(ara.kim).toEqual({ uid: 'u-2', ad: 'Mehmet Öz' });
    expect(yayin).not.toHaveBeenCalled();
    // İşçi iş GÖNDERMEDİ: isteyicinin ikinci çağrısı içerik yazımının KENDİ isteğidir (tek giriş yolu § 10.2 (a) 6).
    expect(revizeIste).toHaveBeenCalledTimes(2);
    // O istek kuyruktan gelince: `bekliyor` görür, birleşik alanlarla ikinci postayı gönderir, güncel sürümle `gitti` yazar.
    const { isci: sonraki } = deps();
    await expect(magazaRevizeBildirimIsle(id, sonraki, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(2);
    expect(gonder.mock.calls[1][0].metin).toContain('Değişen alanlar: Not, Müşteri bilgileri\n');
    expect(gonder.mock.calls[1][0].metin).toContain('Revize eden: Mehmet Öz');
    expect(await revize(id)).toMatchObject({ durum: 'gitti', icerikSurum: 2, alanlar: ['not', 'musteri'] });
  });

  it('`bekliyor` iken ikinci revizyon işçiden ÖNCE gelirse TEK posta gider: birleşik, tekilleştirilmiş alan adlarıyla; `deneme` sıfırlanmış', async () => {
    const id = await talep({});
    const { isci, icerik } = deps();
    await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 0, not: 'bir', kim: KIM, kanal: 'erp' });
    // İşçinin geçici hatası: `bekliyor` + deneme 1.
    gonder.mockResolvedValueOnce({ ok: false, sinif: 'baglanti' });
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    expect(await revize(id)).toMatchObject({ durum: 'bekliyor', deneme: 1, hataSinifi: 'baglanti', alanlar: ['not'], icerikSurum: 1 });
    // İkinci revizyon (yine not): nesne yeniden YARATILIR — `deneme` / `hataSinifi` düşer, alanlar birleşir (`['not', 'not']`).
    await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 1, not: 'iki', kim: KIM, kanal: 'erp' });
    const birlesik = await revize(id) as Satir;
    expect(birlesik).not.toHaveProperty('deneme');
    expect(birlesik).not.toHaveProperty('hataSinifi');
    expect(birlesik.alanlar).toEqual(['not', 'not']);
    expect(alanlariBirlestir(birlesik.alanlar)).toEqual(['not']);
    // Eski iş yeniden denenir: güncel sürümü (2) okur, TEK satır «Not» basar, `gitti` yazar. İkinci iş gelince atlar.
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 2, sonMu: false })).resolves.toBe('gitti');
    expect(gonder.mock.calls.at(-1)?.[0].metin).toContain('Değişen alanlar: Not\n');
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(2);   // 1 başarısız deneme + 1 gönderim; ikinci iş posta ÜRETMEDİ
  });

  it('isteyici (kuyruk yok → süreç içi yol) gerçek motorda: içerik yazımının isteği postayı gönderir ve `gitti` yazar', async () => {
    const id = await talep({});
    const { isci } = deps();
    const iste = magazaRevizeBildirimIsteyici(() => null, isci);
    const icerik: MagazaIcerikDeps = { getPgPool: () => havuz, broadcastDocChange: vi.fn(), writeAuditLog: vi.fn(async () => undefined), bildirimIste: vi.fn(async () => undefined), revizeBildirimiIste: iste, simdi: () => SAAT };
    const s = await talepIcerigiDegistir(icerik, { id, companyId: CID, icerikSurum: 0, not: 'süreç içi', kim: KIM, kanal: 'erp' });
    expect(s.sonuc).toBe('tamam');
    for (let i = 0; i < 200 && ((await revize(id)) as Satir).durum !== 'gitti'; i += 1) await new Promise<void>((r) => setTimeout(r, 2));
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(await revize(id)).toMatchObject({ durum: 'gitti', alanlar: ['not'], icerikSurum: 1 });
  });

  it('ilk bildirim ile revize AYNI belgede bağımsız: ilk bildirimin işçisi `bildirim`i, revize işçisi `bildirimRevize`yi yazar; biri öbürünün alanını EZMEZ', async () => {
    const id = await talep({ bildirim: { durum: 'bekliyor', zaman: '2026-10-08T09:00:00.000Z' }, icerikSurum: 2, icerikZamani: '2026-10-10T11:00:00.000Z', bildirimRevize: REVIZE });
    const { isci } = deps();
    gonder.mockResolvedValueOnce({ ok: false, sinif: 'alici-reddi' });               // ilk bildirim kalıcı ret
    await expect(magazaBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(await revize(id)).toEqual(REVIZE);                                        // revize alanı aynen
    await expect(magazaRevizeBildirimIsle(id, isci, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    const b = await belge(id);
    expect(b.bildirim).toMatchObject({ durum: 'gonderilemedi', hataSinifi: 'alici-reddi' });   // ilk bildirim alanı aynen
    expect(b.bildirimRevize).toMatchObject({ durum: 'gitti', alanlar: REVIZE.alanlar, kim: REVIZE.kim, icerikSurum: 2 });
    expect(gonder.mock.calls.map((c) => c[0].konu)).toEqual(['Yeni mağaza talebi: T261010-AB12', 'Mağaza talebi revize edildi · T261010-AB12']);
  });

  it('kaldırılan beşinci bildirim durumu hiçbir revize yazımının `RETURNING` çıktısında geçmez; durum dört değerden biridir', async () => {
    const id = await talep({ icerikSurum: 2, bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis', zaman: '2026-10-01T00:00:00.000Z' } });
    const ciktilar: unknown[] = [];
    ciktilar.push(...(await db.query<Satir>(MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL, KACAN_PARAMETRELERI(SAAT.getTime()))).rows);
    for (const yama of [{ durum: 'bekliyor', deneme: 1, hataSinifi: 'diger', zaman: 'z' }, { durum: 'yapilandirilmamis', zaman: 'z' }, { durum: 'gonderilemedi', hataSinifi: 'tls', zaman: 'z' }]) {
      ciktilar.push(...await yaz(id, yama, 2));
    }
    ciktilar.push(...(await db.query<Satir>(BILDIRIM_REVIZE_YENIDEN_SQL, [COLL, id, CID, 'z'])).rows);
    ciktilar.push(...await yaz(id, { durum: 'gitti', zaman: 'z' }, 2));
    expect(ciktilar).toHaveLength(6);
    const metin = JSON.stringify(ciktilar);
    expect(metin).not.toContain(KALDIRILAN_DURUM);
    for (const durum of [...metin.matchAll(/"bildirimRevize":\{[^}]*"durum":"([a-z]+)"/g)].map((e) => e[1])) {
      expect(['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis']).toContain(durum);
    }
  });
});
