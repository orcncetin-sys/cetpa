// @vitest-environment node
/**
 * magazaBildirim — mağaza talebi e-posta bildirimi (kullanıcı kararı K2).
 *
 * DÖRT kanıt katmanı:
 *  1) içerik: kişisel veri YOK (ad / firma / telefon / e-posta / adres / vergi no /
 *     not), HTML kaçışı, müşteri metnindeki adres tetikleyicilerinin kırılması +
 *     «doğrulanmamış metin» uyarısı, 50 satır sınırı, İstanbul saati, «eksik» notu,
 *     konu ve bağlantı kuralları.
 *  2) tek talep (`magazaBildirimIsle`): sahte `docs` satırı + sahte gönderici —
 *     `gitti` dokümanında ikinci gönderim yok, aynı süreçte eşzamanlı ikinci çağrıda
 *     ikinci gönderim yok (süreç içi sahiplenme), sonuç TEK SQL ile, kiracı etiketsiz
 *     yayın yok, hata METNİ hiçbir yere yazılmıyor, asla fırlatmıyor.
 *  3) kuyruk: iş verisi yalnız `{ talepId }`, yeniden deneme sayacı, toplu çağrı,
 *     süreç içi yolun reddi genel `unhandledRejection` işleyicisine düşmüyor.
 *  4) kaynak çiti: modül kişisel alanları OKUMUYOR, günlüğe hata nesnesi YAZMIYOR.
 *
 * pg-boss ÖRNEĞİ OLUŞTURULMAZ: işçi düz veriyle çağrılır; pg-boss tipleriyle uyum
 * derleme düzeyinde (tsc) kanıtlanır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobWithMetadata, SendOptions, WorkWithMetadataHandler } from 'pg-boss';
import { sertIhlalleri, yorumsuz } from '../../test/degismezTarayici';
import type { MagazaBildirim, MagazaTalebi } from '../../lib/magazaTalep';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KIMLIK_DESENI } from '../../lib/magazaTalep';

// Gönderici sahte: bu dosyada SMTP bağlantısı HİÇ açılmaz. `smtpHataSinifi` gerçek kalır.
vi.mock('../smtpPosta', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('../smtpPosta')>();
  return { ...asil, smtpGonder: vi.fn() };
});

// Taşıyıcı üretici gözlenir: «uçtan uca» testler GERÇEK smtpGonder'i sahte taşıyıcıyla koşar,
// diğer testler üreticinin HİÇ çağrılmadığını (bağlantı denenmediğini) buradan görür.
vi.mock('nodemailer', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('nodemailer')>();
  return { ...asil, createTransport: vi.fn(asil.createTransport) };
});

import { createTransport } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { smtpGonder } from '../smtpPosta';
import type { SmtpSonucu } from '../smtpPosta';
import {
  MAGAZA_BILDIRIM_IS_SECENEKLERI, MAGAZA_BILDIRIM_ISCI_SECENEKLERI, MAGAZA_BILDIRIM_KALEM_SINIRI, MAGAZA_BILDIRIM_KUYRUGU,
  KALICI_HATA_SINIFLARI, MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI,
  magazaBildirimKacanlariKuyrukla, MAGAZA_KACAN_SAHIPLEN_SQL, MAGAZA_KACAN_SINIRI, MAGAZA_KACAN_YETIM_ESIGI_MS,
  magazaBildirimIcerigi, magazaBildirimIsle, magazaBildirimIscisi, magazaBildirimIscisiKur, magazaBildirimIsteyici, magazaBildirimIsteyiciKur,
} from './magazaBildirim';
import type { MagazaBildirimDeps, MagazaBildirimSonucu } from './magazaBildirim';

const gonder = vi.mocked(smtpGonder);
const uretici = vi.mocked(createTransport);

// ── Derleme düzeyi kanıt (tsc): pg-boss 12.26 tipleri ────────────────────────
// İşçi imzası meta verili işleyiciye uyuyor; iş sayaçlarının adı ve tipi ölçülen gibi
// (`retryCount` / `retryLimit`, sayı); iş seçenekleri geçerli `send` seçenekleri.
type Esit<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const _retryCountSayi: Esit<JobWithMetadata<object>['retryCount'], number> = true;
const _retryLimitSayi: Esit<JobWithMetadata<object>['retryLimit'], number> = true;
const _isciTipi: WorkWithMetadataHandler<object, void> = magazaBildirimIscisi({ getPgPool: () => null, broadcastDocChange: () => {} });
const _secenekTipi: SendOptions = MAGAZA_BILDIRIM_IS_SECENEKLERI;
void [_retryCountSayi, _retryLimitSayi, _isciTipi, _secenekTipi];

// ── Düzenek ──────────────────────────────────────────────────────────────────
const KIMLIK = 'mt-0123456789abcdef0123456789abcdef';
const KIMLIK_B = 'mt-fedcba9876543210fedcba9876543210';
const KIRACI = 'kiraci-GIZLI-cid';
const SIMDI = '2026-10-08T10:41:07.000Z';
const ERP_ADRESI = 'https://app.cetpa.com.tr/orders?kaynak=magaza';
/** Gövdedeki uyarı cümlesi — test KENDİ kopyasını taşır (modülden içe aktarılmaz: cümle değişirse test kırılsın). */
const METIN_UYARISI = 'İl ve kalem metinleri mağaza ziyaretçisinden gelir, doğrulanmamıştır; içindeki adreslere tıklamayın.';

/** E-postaya GİRMEMESİ gereken her şey (fixture'daki kişisel alanların ayırt edici parçaları). */
const KISISEL = [
  'Zeynep', 'Gizliad', 'Şahin', 'Gizlifirma', '0532', '111 22 33', '5321112233', 'gizli.musteri', 'musteri-alani',
  'Gizlisokak', 'Kadıköy', '1234567890', 'Gizlinot', 'öğleden', 'urun-gizli-id', KIRACI,
];

function talep(ek: Partial<MagazaTalebi> = {}): MagazaTalebi {
  return {
    companyId: KIRACI,
    talepNo: 'T261008-5Y9P',
    durum: 'yeni',
    olusturma: '2026-10-08T10:40:00.000Z',
    istemciTarihi: '2026-10-08T10:39:58.000Z',
    musteri: {
      ad: 'Zeynep Gizliad Şahin', firma: 'Gizlifirma Yapı Ltd.', telefon: '0532 111 22 33', eposta: 'gizli.musteri@musteri-alani.test',
      il: 'Balıkesir', adres: 'Gizlisokak No: 7 Kadıköy', vergi: '1234567890',
    },
    telefonSon10: '5321112233',
    not: 'Gizlinot: öğleden sonra arayın',
    kalemler: [
      { id: 'urun-gizli-id-1', sku: 'DYO-1234', ad: 'Dış Cephe Boyası 15 L', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false },
      { id: 'urun-gizli-id-2', sku: 'IZF-77', ad: 'Rulo Fırça Çıtası', marka: 'İzmir Fırça', adet: 12, talepFiyat: null, tedarik: true },
    ],
    talepEdilen: { araToplam: 529.97, kdv: 105.99, toplam: 635.96 },
    fiyatiSorulacakVar: true,
    bildirim: { durum: 'bekliyor', zaman: '2026-10-08T10:40:00.000Z' },
    ...ek,
  };
}

const kalem = (i: number, talepFiyat: number | null = 10): MagazaTalebi['kalemler'][number] =>
  ({ id: `k${i}`, sku: `SKU-${i}`, ad: `Ürün ${i}`, marka: 'Marka', adet: 1, talepFiyat, tedarik: false });

interface Sorgu { sql: string; params: unknown[] }
type SahteSonuc = { rows: Array<Record<string, unknown>> };

/**
 * `docs` tablosunun sahtesi (kimlik → doküman). SELECT dokümanı döndürür; UPDATE
 * yalnız `bildirim` alanını değiştirip yeni dokümanı döndürür (jsonb_set gibi).
 */
function sahteHavuz(belgeler: Record<string, unknown>, o: { oku?: () => Promise<SahteSonuc>; yaz?: () => Promise<SahteSonuc> } = {}) {
  const tablo = new Map<string, unknown>(Object.entries(structuredClone(belgeler)));
  const sorgular: Sorgu[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<SahteSonuc> => {
    sorgular.push({ sql, params });
    const id = String(params[1]);
    if (sql.startsWith('SELECT')) {
      if (o.oku) return o.oku();
      return { rows: tablo.has(id) ? [{ data: structuredClone(tablo.get(id)) }] : [] };
    }
    if (sql.startsWith('UPDATE')) {
      if (o.yaz) return o.yaz();
      const eski = tablo.get(id);
      if (typeof eski !== 'object' || eski === null) return { rows: [] };
      const yeni = { ...eski, bildirim: JSON.parse(String(params[2])) as unknown };
      tablo.set(id, yeni);
      return { rows: [{ data: structuredClone(yeni) }] };
    }
    throw new Error('beklenmeyen SQL');
  });
  const bildirim = (id: string): unknown => (tablo.get(id) as { bildirim?: unknown } | undefined)?.bildirim;
  return { havuz: { query }, sorgular, tablo, bildirim };
}

function duzenek(belgeler: Record<string, unknown> = { [KIMLIK]: talep() }, o: Parameters<typeof sahteHavuz>[1] = {}, ek: Partial<MagazaBildirimDeps> = {}) {
  const h = sahteHavuz(belgeler, o);
  const yayin = vi.fn<MagazaBildirimDeps['broadcastDocChange']>();
  const D: MagazaBildirimDeps = {
    getPgPool: () => h.havuz,
    broadcastDocChange: yayin,
    appUrl: () => 'https://app.cetpa.com.tr',
    simdi: () => new Date(SIMDI),
    ...ek,
  };
  const yazilan = (): Sorgu[] => h.sorgular.filter((s) => s.sql.startsWith('UPDATE'));
  return { ...h, yayin, D, yazilan };
}

const OKU_SQL = 'SELECT data FROM docs WHERE coll = $1 AND id = $2';
const YAZ_SQL = "UPDATE docs SET data = jsonb_set(data, '{bildirim}', $3::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND (data->'bildirim'->>'durum') IS DISTINCT FROM 'gitti' RETURNING data";

const KONSOL = ['log', 'info', 'warn', 'error', 'debug'] as const;
let konsolCasuslari: Array<{ mock: { calls: unknown[][] }; mockRestore: () => void }> = [];
/** Testin o ana kadar konsola yazdığı HER ŞEY (hata nesneleri iletisi + alanlarıyla açılır). */
const konsolMetni = (): string => konsolCasuslari.flatMap((c) => c.mock.calls)
  .map((cagri) => cagri.map((a) => (a instanceof Error ? `${a.message} ${JSON.stringify({ ...a })}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');

/** Verilen iş sürerken (ve ardından mikro görev kuyruğu boşalana dek) düşen sahipsiz ret sayısı. */
async function sahipsizRetSay(is: () => Promise<void>): Promise<number> {
  let n = 0;
  const say = (): void => { n++; };
  process.on('unhandledRejection', say);
  try {
    await is();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', say);
  }
  return n;
}

const bekle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
const gizliHata = (ileti: string, ek: Record<string, unknown> = {}): Error => Object.assign(new Error(ileti), ek);

beforeEach(() => {
  gonder.mockReset();
  gonder.mockResolvedValue({ ok: true });
  uretici.mockReset();
  konsolCasuslari = KONSOL.map((ad) => vi.spyOn(console, ad).mockImplementation(() => {}));
});
// Sahiplenme kümesi MODÜL düzeyindedir: asılı kalan bir gönderim kimliği «gönderimde» bırakır ve SONRAKİ testleri de kırardı.
// O yüzden asılan her gönderim (hangi bölümde asılırsa asılsın), test yarıda kırılsa bile, burada bitirilir; konsol casusları
// geri alınmadan ÖNCE, çünkü biten gönderimin sonuç yazımı günlüğe düşebilir.
const asilanlar: Array<(s: SmtpSonucu) => void> = [];
afterEach(async () => {
  const birakilan = asilanlar.splice(0);
  for (const bitir of birakilan) bitir({ ok: true });
  if (birakilan.length > 0) await bekle();
  for (const c of konsolCasuslari) c.mockRestore();
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — ne var', () => {
  it('düz metin: talep no, İstanbul saatiyle kayıt zamanı, il, «doğrulanmamış metin» uyarısı, kalemler, toplam + «eksik» notu, ERP bağlantısı', () => {
    const { konu, metin } = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(konu).toBe('Yeni mağaza talebi: T261008-5Y9P');
    expect(metin.split('\n')).toEqual([
      'Yeni mağaza talebi: T261008-5Y9P',
      'Kayıt zamanı: 08.10.2026 13:40 (İstanbul saati)',
      'İl: Balıkesir',
      '',
      METIN_UYARISI,
      'Kalemler (2):',
      '1. [DYO-1234] Dış Cephe Boyası 15 L · DYO · 2 adet',
      '2. [IZF-77] Rulo Fırça Çıtası · İzmir Fırça · 12 adet · fiyat sorulacak',
      '',
      'Talep edilen toplam (müşterinin sitede gördüğü): ₺635,96 (eksik — 1 kalemin fiyatı sorulacak)',
      '',
      "Müşteri bilgileri bu e-postada yer almaz. Talebin tamamı ERP'de: Siparişler → Mağaza Talepleri.",
      ERP_ADRESI,
    ]);
  });

  it('HTML: aynı bilgiler; başlık + 2 kalem satırı; «fiyat sorulacak» yalnız fiyatsız kalemde; Türkçe dil etiketi', () => {
    const { html } = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    for (const parca of ['T261008-5Y9P', '08.10.2026 13:40 (İstanbul saati)', 'İl: Balıkesir', METIN_UYARISI, 'DYO-1234', 'Dış Cephe Boyası 15 L', 'IZF-77', 'Rulo Fırça Çıtası', 'İzmir Fırça',
      '₺635,96', 'müşterinin sitede gördüğü', 'eksik — 1 kalemin fiyatı sorulacak', `href="${ERP_ADRESI}"`]) {
      expect(html, parca).toContain(parca);
    }
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html.match(/fiyat sorulacak/g)).toHaveLength(1);
    expect(html).toMatch(/Rulo Fırça Çıtası <span[^>]*>fiyat sorulacak<\/span>/);
    expect(html).toMatch(/^<div lang="tr" /);
  });

  it('kayıt zamanı SÜREÇ saat diliminden bağımsız İstanbul saatiyle (gece yarısını aşan örnek; süreç Pasifik diliminde)', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const { html, metin } = magazaBildirimIcerigi(talep({ olusturma: '2026-10-08T21:30:00.000Z' }), {});
    expect(metin).toContain('Kayıt zamanı: 09.10.2026 00:30 (İstanbul saati)');
    expect(html).toContain('09.10.2026 00:30 (İstanbul saati)');
    expect(metin).not.toContain('14:30');
  });

  it.each([['çözülemeyen metin', 'dün öğlen'], ['boş', ''], ['sayı', 1760000000000], ['yok', undefined]])('kayıt zamanı %s ise — (bugüne / uydurma saate düşülmez)', (_ad, deger) => {
    const { metin, html } = magazaBildirimIcerigi({ ...talep(), olusturma: deger as unknown as string }, {});
    expect(metin).toContain('Kayıt zamanı: —\n');
    expect(metin).not.toContain('İstanbul saati');
    expect(html).toContain('Kayıt zamanı: — · İl:');
  });

  it('Türkçe harfler AYNEN; birleşik nokta (U+0307) yok; büyük harfe çevirme yok', () => {
    const t = talep({ musteri: { ...talep().musteri, il: 'ığdır / IŞIK / İğneada' }, kalemler: [{ ...kalem(1), ad: 'çöğür şiş ıspanak İÇ', marka: 'Üçgül' }] });
    const { konu, html, metin } = magazaBildirimIcerigi(t, {});
    for (const govde of [html, metin]) {
      expect(govde).toContain('ığdır / IŞIK / İğneada');
      expect(govde).toContain('çöğür şiş ıspanak İÇ');
      expect(govde).toContain('Üçgül');
    }
    expect(konu + html + metin).not.toContain(String.fromCharCode(0x307));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — kişisel veri YOK', () => {
  it.each(KISISEL)('«%s» konuda, HTML\'de ve düz metinde GEÇMEZ', (parca) => {
    const { konu, html, metin } = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(konu).not.toContain(parca);
    expect(html).not.toContain(parca);
    expect(metin).not.toContain(parca);
  });

  it('fixture kör değil: kişisel parçaların HEPSİ dokümanda var (içerik onları gerçekten eliyor)', () => {
    const ham = JSON.stringify(talep());
    for (const parca of KISISEL) expect(ham, parca).toContain(parca);
  });

  it('ara toplam ve KDV beyanı da basılmaz (yalnız toplam)', () => {
    const { html, metin } = magazaBildirimIcerigi(talep(), {});
    for (const tutar of ['529,97', '105,99', '204,99']) {
      expect(html).not.toContain(tutar);
      expect(metin).not.toContain(tutar);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — serbest metin kaçışla, bağlantıya çevrilmeden', () => {
  const KOTU = talep({
    musteri: { ...talep().musteri, il: '<script>alert("il")</script>' },
    kalemler: [{ id: 'k', sku: '"><b>sku</b>', ad: '<img src=x onerror=alert(1)>', marka: "Marka & Oğulları 'tek'", adet: 3, talepFiyat: null, tedarik: false }],
  });

  it('HTML: il, stok kodu, kalem adı, marka kaçışlı; ham etiket YOK', () => {
    const { html } = magazaBildirimIcerigi(KOTU, { appUrl: 'https://app.cetpa.com.tr' });
    expect(html).toContain('&lt;script&gt;alert(&quot;il&quot;)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;b&gt;sku&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Marka &amp; Oğulları &#39;tek&#39;');
    expect(html).not.toMatch(/<script|<img|<b>sku/);
  });

  it('HTML\'deki etiketler yalnız modülün kendi yazdıkları', () => {
    const { html } = magazaBildirimIcerigi(KOTU, { appUrl: 'https://app.cetpa.com.tr' });
    const etiketler = new Set([...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1]));
    expect([...etiketler].sort()).toEqual(['a', 'b', 'div', 'h2', 'p', 'span', 'table', 'td', 'th', 'tr']);
  });

  it('müşterinin yazdığı adrese modül `<a>` YAZMAZ: tek bağlantı ERP adresi; adres metni iki bölümde de KIRIK basılır', () => {
    const t = talep({ musteri: { ...talep().musteri, il: 'https://kotu.example/tikla' }, kalemler: [{ ...kalem(1), ad: 'www.kotu.example', sku: 'mailto:x@kotu.example', marka: 'javascript:alert(1)' }] });
    const { html, metin } = magazaBildirimIcerigi(t, { appUrl: 'https://app.cetpa.com.tr' });
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.match(/href="[^"]*"/g)).toEqual([`href="${ERP_ADRESI}"`]);
    for (const govde of [html, metin]) {
      // Metin olarak duruyor ama istemcinin kendiliğinden bağlayacağı biçimde DEĞİL.
      expect(govde).toContain('https[:]//kotu.example/tikla');
      expect(govde).toContain('www[.]kotu.example');
      expect(govde).toContain('mailto:x[at]kotu.example');
      expect(govde).not.toContain('https://kotu.example');
      expect(govde).not.toContain('x@kotu.example');
    }
  });

  it('tek satırlık alanda satır sonu / denetim karakteri boşluğa iner (düz metinde sahte satır üretmez)', () => {
    const satirSonu = '\r\n';
    const ayirici = String.fromCharCode(0x2028);
    const t = talep({
      musteri: { ...talep().musteri, il: `Bursa${satirSonu}Talep edilen toplam: ₺1,00` },
      kalemler: [{ ...kalem(1), ad: `Boya${ayirici}99. [SAHTE] kalem`, sku: `A${String.fromCharCode(0)}B`, marka: `M${String.fromCharCode(0x85)}N` }],
    });
    const { metin, html } = magazaBildirimIcerigi(t, {});
    expect(metin).toContain('İl: Bursa Talep edilen toplam: ₺1,00\n');
    expect(metin).toContain('1. [A B] Boya 99. [SAHTE] kalem · M N · 1 adet');
    expect(metin.split('\n').filter((s) => s.startsWith('Talep edilen toplam'))).toHaveLength(1);
    for (const kod of [0, 0x0d, 0x85, 0x2028]) expect(html + metin.replace(/\n/g, '')).not.toContain(String.fromCharCode(kod));
  });

  it('boş serbest metin — olarak yazılır', () => {
    const t = talep({ musteri: { ...talep().musteri, il: '   ' }, kalemler: [{ ...kalem(1), sku: '', marka: '' }] });
    const { metin } = magazaBildirimIcerigi(t, {});
    expect(metin).toContain('İl: —\n');
    expect(metin).toContain('1. [—] Ürün 1 · — · 1 adet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — müşteri metnindeki adres tetikleyicileri kırılır (posta istemcisi kendiliğinden bağlamasın)', () => {
  /** Aynı metni DÖRT müşteri alanına (il, stok kodu, kalem adı, marka) koyar; ERP bağlantısı da gövdede. */
  const dortAlanda = (deger: string): { html: string; metin: string } => magazaBildirimIcerigi(
    talep({ musteri: { ...talep().musteri, il: deger }, kalemler: [{ ...kalem(1), sku: deger, ad: deger, marka: deger }], fiyatiSorulacakVar: false }),
    { appUrl: 'https://app.cetpa.com.tr' },
  );
  const kacKez = (govde: string, parca: string): number => govde.split(parca).length - 1;
  /** Gövdenin ERP adresi DIŞINDA kalanı: müşteri metni + modülün sabit yazıları. */
  const erpDisi = (govde: string): string => govde.split(ERP_ADRESI).join('');
  // Üç tetikleyici: şema ayracı, e-posta işareti, sözcük başındaki «www.» (önünde harf / rakam yok).
  const TETIKLEYICI = /:\/\/|@|(?<![\p{L}\p{N}])www\./iu;

  it.each([
    ['şemalı adres', 'https://kotu.example/tikla', 'https[:]//kotu.example/tikla'],
    ['cümle içinde şemalı adres', 'Fiyat listesi http://kotu.example adresinde', 'Fiyat listesi http[:]//kotu.example adresinde'],
    ['başka şema', 'ftp://kotu.example/dosya', 'ftp[:]//kotu.example/dosya'],
    ['www ile başlayan adres', 'www.kotu.example', 'www[.]kotu.example'],
    ['cümle içinde www', 'bkz. www.kotu.example/x', 'bkz. www[.]kotu.example/x'],
    ['büyük harfli WWW (yazıldığı harfle kalır)', 'WWW.KOTU.example', 'WWW[.]KOTU.example'],
    ['ayraç içinde www', '(www.kotu.example)', '(www[.]kotu.example)'],
    ['art arda www', 'www.www.kotu.example', 'www[.]www[.]kotu.example'],
    ['e-posta adresi', 'destek@kotu.example', 'destek[at]kotu.example'],
    ['mailto şeması', 'mailto:x@kotu.example', 'mailto:x[at]kotu.example'],
    ['üçü birden', 'https://www.kotu.example/a@b', 'https[:]//www[.]kotu.example/a[at]b'],
    ['aynı alanda iki e-posta', 'a@b.example x@kotu.example', 'a[at]b.example x[at]kotu.example'],
    ['aynı alanda iki şemalı adres', 'http://a.example https://kotu.example', 'http[:]//a.example https[:]//kotu.example'],
  ])('%s KIRILIR: dört alanda, HTML ve düz metinde', (_ad, girdi, beklenen) => {
    const { html, metin } = dortAlanda(girdi);
    for (const govde of [html, metin]) {
      expect(kacKez(govde, beklenen)).toBe(4);
      expect(govde).not.toContain(girdi);
      expect(erpDisi(govde)).not.toMatch(TETIKLEYICI);
    }
  });

  it.each([
    ['harf öncesi nokta taşıyan ürün adı', 'Dr.Fixit 302 Su Yalıtımı'],
    ['noktalı stok kodu (Türkçe harfli)', 'AKCALI-AKÇ.00325'],
    ['noktalı stok kodu (harf öncesi nokta)', 'DYO.ABC'],
    ['ondalık ölçü', 'DYO Dinamik 2.5 L'],
    ['sözcük ORTASINDA «www.» (önünde harf)', 'ABCWWW.12'],
    ['sözcük ORTASINDA «www.» (önünde rakam)', 'K1www.7'],
    ['sözcük ORTASINDA «www.» (önünde Türkçe harf)', 'AKÇwww.5'],
    ['iki nokta ve eğik çizgi ama şema ayracı değil', 'Oran 1:4 / 20 kg'],
    ['iki nokta + TEK eğik çizgi (şema ayracı iki eğik çizgi ister)', 'Kod A:/B-12'],
    ['BİLİNEN SINIR — şemasız çıplak alan adı kırılmaz (uyarı cümlesi karşılar)', 'kotu.example/x'],
  ])('%s AYNEN kalır: dört alanda, HTML ve düz metinde', (_ad, girdi) => {
    const { html, metin } = dortAlanda(girdi);
    expect(metin).toContain(`İl: ${girdi}\n`);
    expect(metin).toContain(`1. [${girdi}] ${girdi} · ${girdi} · 1 adet\n`);
    expect(kacKez(html, girdi)).toBe(4);
    expect(html + metin).not.toMatch(/\[\.\]|\[at\]|\[:\]/);
  });

  it('karşı kontrol: tetikleyici deseni kırılmamış adresi GÖRÜR, kırılmışı ve meşru metni görmez', () => {
    for (const ham of ['https://a.example', 'a@b.example', 'www.a.example', 'bkz. WWW.a.example']) expect(TETIKLEYICI.test(ham), ham).toBe(true);
    for (const temiz of ['https[:]//a.example', 'a[at]b.example', 'www[.]a.example', 'ABCWWW.12', 'Dr.Fixit', 'AKCALI-AKÇ.00325']) expect(TETIKLEYICI.test(temiz), temiz).toBe(false);
  });

  it('ERP bağlantısı SAĞLAM kalır (kendi adresimiz kırılmaz), müşteri metni adres taşısa da', () => {
    const { html, metin } = dortAlanda('https://www.kotu.example/a@b');
    expect(html).toContain(`<a href="${ERP_ADRESI}">${ERP_ADRESI}</a>`);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(metin.split('\n').at(-1)).toBe(ERP_ADRESI);
    expect(kacKez(html, '://')).toBe(2);    // yalnız ERP bağlantısının `href`'i ve görünen metni
    expect(kacKez(metin, '://')).toBe(1);   // yalnız ERP satırı
  });

  it('uyarı cümlesi HTML ve düz metinde AYNEN, birer kez, kalemlerin ÜSTÜNDE', () => {
    const { html, metin } = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(kacKez(html, METIN_UYARISI)).toBe(1);
    expect(html.indexOf(METIN_UYARISI)).toBeLessThan(html.indexOf('<table'));
    const satirlar = metin.split('\n');
    expect(satirlar.filter((s) => s === METIN_UYARISI)).toHaveLength(1);
    expect(satirlar.indexOf(METIN_UYARISI)).toBeLessThan(satirlar.findIndex((s) => s.startsWith('1. [')));
  });

  it('uyarı bağlantı yokken ve kalem yokken de yazılır', () => {
    const { html, metin } = magazaBildirimIcerigi(talep({ kalemler: [], fiyatiSorulacakVar: false }), {});
    expect(html).toContain(METIN_UYARISI);
    expect(metin.split('\n')).toContain(METIN_UYARISI);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — kalemler: en çok 50 satır', () => {
  const kalemli = (n: number): MagazaTalebi => talep({ kalemler: Array.from({ length: n }, (_, i) => kalem(i + 1)), fiyatiSorulacakVar: false });
  const kalemSatirlari = (metin: string): string[] => metin.split('\n').filter((s) => /^\d+\. \[/.test(s));

  it('sınır 50', () => { expect(MAGAZA_BILDIRIM_KALEM_SINIRI).toBe(50); });

  it('50 kalem → 50 satır, «daha» notu YOK', () => {
    const { html, metin } = magazaBildirimIcerigi(kalemli(50), {});
    expect(kalemSatirlari(metin)).toHaveLength(50);
    expect(html.match(/<tr>/g)).toHaveLength(51);
    expect(html + metin).not.toContain('kalem daha');
    expect(metin).toContain('Kalemler (50):');
  });

  it.each([[51, 1], [120, 70]])('%i kalem → 50 satır + «… ve %i kalem daha»', (n, kalan) => {
    const { html, metin } = magazaBildirimIcerigi(kalemli(n), {});
    expect(kalemSatirlari(metin)).toHaveLength(50);
    expect(html.match(/<tr>/g)).toHaveLength(51);
    expect(metin).toContain(`\n… ve ${kalan} kalem daha\n`);
    expect(html).toContain(`… ve ${kalan} kalem daha`);
    expect(metin).toContain(`Kalemler (${n}):`);
    expect(metin).toContain('50. [SKU-50]');
    expect(metin).not.toContain('SKU-51');
  });

  it('adet Türkçe binlik ayraçla; sayı değilse — (0 ya da 1 uydurulmaz)', () => {
    const t = talep({ kalemler: [{ ...kalem(1), adet: 1250000 }, { ...kalem(2), adet: Number.NaN }], fiyatiSorulacakVar: false });
    const { metin } = magazaBildirimIcerigi(t, {});
    expect(metin).toContain('· 1.250.000 adet');
    expect(metin).toContain('2. [SKU-2] Ürün 2 · Marka · — adet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — talep edilen toplam', () => {
  const toplamSatiri = (t: MagazaTalebi): string => magazaBildirimIcerigi(t, {}).metin.split('\n').find((s) => s.startsWith('Talep edilen toplam')) ?? '';

  it('fiyatı sorulacak kalem yoksa toplam tek başına, «eksik» notu YOK', () => {
    const t = talep({ kalemler: [kalem(1), kalem(2)], fiyatiSorulacakVar: false });
    expect(toplamSatiri(t)).toBe('Talep edilen toplam (müşterinin sitede gördüğü): ₺635,96');
    expect(magazaBildirimIcerigi(t, {}).html).not.toContain('eksik');
  });

  it('toplam null ise — (₺0,00 DEĞİL)', () => {
    const t = talep({ kalemler: [kalem(1)], fiyatiSorulacakVar: false, talepEdilen: { araToplam: null, kdv: null, toplam: null } });
    expect(toplamSatiri(t)).toBe('Talep edilen toplam (müşterinin sitede gördüğü): —');
    const { html, metin } = magazaBildirimIcerigi(t, {});
    expect(html + metin).not.toContain('₺0');
  });

  it('toplam 0 ise ₺0,00 (bilinen sıfır, bilinmeyen değil)', () => {
    const t = talep({ kalemler: [kalem(1, 0)], fiyatiSorulacakVar: false, talepEdilen: { araToplam: 0, kdv: 0, toplam: 0 } });
    expect(toplamSatiri(t)).toBe('Talep edilen toplam (müşterinin sitede gördüğü): ₺0,00');
  });

  it('fiyatı 0 olan kalem «fiyat sorulacak» DEĞİL; null olan öyle', () => {
    const t = talep({ kalemler: [kalem(1, 0), kalem(2, null)] });
    const { metin } = magazaBildirimIcerigi(t, {});
    expect(metin).toContain('1. [SKU-1] Ürün 1 · Marka · 1 adet\n');
    expect(metin).toContain('2. [SKU-2] Ürün 2 · Marka · 1 adet · fiyat sorulacak\n');
    expect(toplamSatiri(t)).toContain('(eksik — 1 kalemin fiyatı sorulacak)');
  });

  it('«eksik» sayısı gösterilen 50 satırdan değil BÜTÜN kalemlerden', () => {
    const kalemler = Array.from({ length: 60 }, (_, i) => kalem(i + 1, i >= 55 || i === 3 ? null : 10));
    expect(toplamSatiri(talep({ kalemler }))).toBe('Talep edilen toplam (müşterinin sitede gördüğü): ₺635,96 (eksik — 6 kalemin fiyatı sorulacak)');
  });

  it('bayrak yanlış ama fiyatsız kalem var → not YİNE yazılır (toplam tek başına basılmaz)', () => {
    expect(toplamSatiri(talep({ fiyatiSorulacakVar: false }))).toContain('(eksik — 1 kalemin fiyatı sorulacak)');
  });

  it('bayrak doğru ama fiyatsız kalem bulunamadı → sayısız «eksik» notu', () => {
    expect(toplamSatiri(talep({ kalemler: [kalem(1)], fiyatiSorulacakVar: true }))).toBe('Talep edilen toplam (müşterinin sitede gördüğü): ₺635,96 (eksik — fiyatı sorulacak kalem var)');
  });

  it('toplam bilinmiyor VE eksik → ikisi birlikte', () => {
    const t = talep({ talepEdilen: { araToplam: null, kdv: null, toplam: null } });
    expect(toplamSatiri(t)).toBe('Talep edilen toplam (müşterinin sitede gördüğü): — (eksik — 1 kalemin fiyatı sorulacak)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — konu satırı: yalnız DOĞRULANMIŞ talep no', () => {
  it.each([
    ['başlık enjeksiyonu', `T261008-5Y9P\r\nBcc: saldirgan@kotu.example`],
    ['küçük harf', 't261008-5y9p'],
    ['fazla hane', 'T2610081-5Y9P'],
    ['serbest metin', 'ACİL <b>talep</b>'],
    ['boş', ''],
    ['sayı', 261008],
    ['yok', undefined],
  ])('%s → konuya ve gövdeye KONMAZ', (_ad, deger) => {
    const { konu, html, metin } = magazaBildirimIcerigi({ ...talep(), talepNo: deger as unknown as string }, {});
    expect(konu).toBe('Yeni mağaza talebi');
    expect(metin.split('\n')[0]).toBe('Yeni mağaza talebi');
    for (const iz of ['Bcc', 'saldirgan', 't261008', 'T2610081', 'ACİL', '261008']) expect(konu + html + metin).not.toContain(iz);
  });

  it('konuda talep no dışında müşteri metni yok', () => {
    expect(magazaBildirimIcerigi(talep(), {}).konu).toMatch(/^Yeni mağaza talebi: T\d{6}-[A-Z0-9]{4}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIcerigi — ERP bağlantısı', () => {
  it.each([
    ['kök', 'https://app.cetpa.com.tr'],
    ['sonda eğik çizgi', 'https://app.cetpa.com.tr/'],
    ['alt yol + sorgu (atılır)', 'https://app.cetpa.com.tr/eski/yol?x=1#y'],
    ['çevresinde boşluk', '  https://app.cetpa.com.tr  '],
  ])('https taban (%s) → /orders?kaynak=magaza', (_ad, appUrl) => {
    const { html, metin } = magazaBildirimIcerigi(talep(), { appUrl });
    expect(metin.split('\n').at(-1)).toBe(ERP_ADRESI);
    expect(html).toContain(`<a href="${ERP_ADRESI}">${ERP_ADRESI}</a>`);
  });

  it.each([
    ['yok', undefined],
    ['boş', ''],
    ['yalnız boşluk', '   '],
    ['http (https değil)', 'http://app.cetpa.com.tr'],
    ['yerel http', 'http://localhost:3000'],
    ['çözülemeyen', 'app.cetpa.com.tr'],
    ['javascript şeması', 'javascript:alert(1)'],
    ['ftp', 'ftp://app.cetpa.com.tr'],
    ['kimlik bilgili taban', 'https://kullanici:parola@app.cetpa.com.tr'],
  ])('taban %s → bağlantı KONMAZ (yedek adrese düşülmez)', (_ad, appUrl) => {
    const { html, metin } = magazaBildirimIcerigi(talep(), { appUrl });
    expect(html).not.toMatch(/<a |href=/);
    expect(html + metin).not.toMatch(/orders|kaynak=magaza|https?:\/\/|parola/);
    // Bağlantı yokken de nereye bakılacağı yazıyor.
    expect(metin).toContain('Siparişler → Mağaza Talepleri');
  });

  it('bağlantıya talep no / kişisel veri konmaz', () => {
    const { html } = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    const href = html.match(/href="([^"]*)"/)?.[1] ?? '';
    expect(href).toBe(ERP_ADRESI);
    expect(href).not.toMatch(/T261008|mt-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsle — başarılı gönderim', () => {
  it('oku → gönder → TEK SQL ile `gitti` yaz → kiracı etiketiyle yayınla', async () => {
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');

    expect(d.sorgular).toEqual([
      { sql: OKU_SQL, params: ['magazaTalepleri', KIMLIK] },
      { sql: YAZ_SQL, params: ['magazaTalepleri', KIMLIK, JSON.stringify({ durum: 'gitti', zaman: SIMDI })] },
    ]);
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(gonder.mock.calls[0][0]).toEqual(magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' }));

    const beklenenSatir = { ...talep(), bildirim: { durum: 'gitti', zaman: SIMDI } };
    expect(d.yayin).toHaveBeenCalledTimes(1);
    expect(d.yayin).toHaveBeenCalledWith('magazaTalepleri', 'set', KIMLIK, beklenenSatir, { cid: KIRACI });
  });

  it('yazılan `bildirim` yalnız { durum, zaman }: önceki denemenin sayısı / hata sınıfı SİLİNİR', async () => {
    const d = duzenek({ [KIMLIK]: talep({ bildirim: { durum: 'bekliyor', deneme: 3, hataSinifi: 'baglanti', zaman: '2026-10-08T10:40:30.000Z' } }) });
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 4, sonMu: false })).toBe('gitti');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('gönderilen ileti kişisel veri taşımaz (uçtan uca: dokümandan göndericiye)', async () => {
    const d = duzenek();
    await magazaBildirimIsle(KIMLIK, d.D);
    const ileti = JSON.stringify(gonder.mock.calls[0][0]);
    for (const parca of KISISEL) expect(ileti, parca).not.toContain(parca);
  });

  it('`appUrl` verilmemişse / https değilse ileti bağlantısız', async () => {
    for (const appUrl of [undefined, () => undefined, () => 'http://app.cetpa.com.tr']) {
      gonder.mockClear();
      const d = duzenek(undefined, {}, { appUrl });
      await magazaBildirimIsle(KIMLIK, d.D);
      expect(gonder.mock.calls[0][0].html).not.toMatch(/<a |href=/);
    }
  });

  it('`simdi` verilmemişse zaman gerçek saat (ISO-8601, UTC)', async () => {
    const d = duzenek(undefined, {}, { simdi: undefined });
    const once = Date.now();
    await magazaBildirimIsle(KIMLIK, d.D);
    const b = d.bildirim(KIMLIK) as MagazaBildirim;
    expect(b.zaman).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(b.zaman)).toBeGreaterThanOrEqual(once);
    expect(Date.parse(b.zaman)).toBeLessThanOrEqual(Date.now());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsle — atlanan durumlar (gönderim YOK)', () => {
  it.each([
    ['boş', ''],
    ['önek yok', '0123456789abcdef0123456789abcdef'],
    ['kısa', 'mt-0123'],
    ['büyük harf', 'mt-0123456789ABCDEF0123456789ABCDEF'],
    ['kiracı önekli', `kiraci__${KIMLIK}`],
    ['SQL parçası', `${KIMLIK}' OR '1'='1`],
    ['sonda satır sonu', `${KIMLIK}\n`],
    ['sayı', 42],
    ['nesne', { talepId: KIMLIK }],
    ['tanımsız', undefined],
  ])('kimlik biçimi bozuk (%s) → atlandi; SQL çağrısı 0', async (_ad, kimlik) => {
    const d = duzenek();
    expect(await magazaBildirimIsle(kimlik as unknown as string, d.D, { sayi: 1, sonMu: false })).toBe('atlandi');
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yayin).not.toHaveBeenCalled();
  });

  it('doküman yok → atlandi; yalnız okuma sorgusu', async () => {
    const d = duzenek({});
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).toBe('atlandi');
    expect(d.sorgular).toEqual([{ sql: OKU_SQL, params: ['magazaTalepleri', KIMLIK] }]);
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yayin).not.toHaveBeenCalled();
  });

  it('`gitti` dokümanında İKİNCİ gönderim yok; doküman ve akış aynen', async () => {
    const d = duzenek({ [KIMLIK]: talep({ bildirim: { durum: 'gitti', zaman: '2026-10-08T10:40:05.000Z' } }) });
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false })).toBe('atlandi');
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('atlandi');
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yazilan()).toEqual([]);
    expect(d.yayin).not.toHaveBeenCalled();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: '2026-10-08T10:40:05.000Z' });
  });

  it('art arda iki çağrı: ilki gönderir, ikincisi dokümanda `gitti` görüp atlar (çift posta yok)', async () => {
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it.each(['bekliyor', 'gonderilemedi', 'yapilandirilmamis'] as const)('`%s` dokümanı atlanMAZ (yalnız `gitti` atlanır)', async (durum) => {
    const d = duzenek({ [KIMLIK]: talep({ bildirim: { durum, zaman: '2026-10-08T10:40:05.000Z' } }) });
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dokümandaki `gitti` denetimi OKUMA ANINDADIR: aynı talep aynı süreçte iki kez koşarsa ikisi de `bekliyor` okur.
// Süreç içi sahiplenme kümesi ikinci gönderimi geri çevirir (tek süreçte).
describe('magazaBildirimIsle — süreç içi sahiplenme: aynı talep aynı süreçte eşzamanlı İKİ kez gönderilmez', () => {
  const ARA = { sayi: 1, sonMu: false };
  const SON = { sayi: 9, sonMu: true };

  /** Gönderici çağrılınca ASILI kalır; `bekleyenler[i](sonuc)` i. gönderimi bitirir. Asılanlar dosya düzeyindeki `afterEach`te bırakılır. */
  function asiliGonderici(): { bekleyenler: Array<(s: SmtpSonucu) => void> } {
    const bekleyenler: Array<(s: SmtpSonucu) => void> = [];
    gonder.mockImplementation(() => new Promise<SmtpSonucu>((coz) => { bekleyenler.push(coz); asilanlar.push(coz); }));
    return { bekleyenler };
  }

  it('gönderim sürerken gelen ikinci çağrı: gönderici TAM BİR kez; ikinci çağrı dokümanı okumadan / yazmadan yeniden-dene; bitince küme boşalır', async () => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek();
    const ilk = magazaBildirimIsle(KIMLIK, d.D);                 // süreç içi yol
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(1);                     // ilk koşu gönderimde asılı
    await expect(magazaBildirimIsle(KIMLIK, d.D, ARA)).resolves.toBe('yeniden-dene');   // kuyruk yolu, ara deneme
    expect(gonder).toHaveBeenCalledTimes(1);
    // Tek okuma, o da ilk koşunun: sahiplenme OKUMADAN ÖNCE alınır. Sonra alınsaydı, ilk koşu biterken bayat `bekliyor`
    // okumuş çağrı kümeyi boş bulup yine gönderirdi.
    expect(d.sorgular).toEqual([{ sql: OKU_SQL, params: ['magazaTalepleri', KIMLIK] }]);
    expect(konsolMetni()).toBe('');

    bekleyenler[0]({ ok: true });
    await expect(ilk).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
    expect(d.yayin).toHaveBeenCalledTimes(1);

    // Küme BOŞALDI: çakışma sürseydi ara deneme yine 'yeniden-dene' dönerdi. Artık dokümanı okuyup `gitti` görüyor.
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false })).resolves.toBe('atlandi');
    expect(d.sorgular.filter((s) => s.sql === OKU_SQL)).toHaveLength(2);
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('AYNI ANDA başlatılan iki çağrı (aynı tur): gönderici TAM BİR kez; biri gitti, diğeri yeniden-dene', async () => {
    const d = duzenek();
    await expect(Promise.all([magazaBildirimIsle(KIMLIK, d.D), magazaBildirimIsle(KIMLIK, d.D, ARA)])).resolves.toEqual(['gitti', 'yeniden-dene']);
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
    expect(d.yazilan()).toHaveLength(1);
  });

  it.each([
    ['süreç içi yol', undefined],
    ['SON deneme', SON],
  ])('çakışan çağrı yeniden DENENEMİYORSA (%s) → atlandi, dokümana yazmaz; sonucu süren koşu yazar', async (_ad, deneme) => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek();
    const ilk = magazaBildirimIsle(KIMLIK, d.D, ARA);
    await bekle();
    await expect(magazaBildirimIsle(KIMLIK, d.D, deneme)).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.yazilan()).toEqual([]);
    expect(konsolMetni()).toBe('');

    // BİLİNEN SINIR: süren koşu başarısız olur ve kendisi son deneme değilse doküman `bekliyor` kalır.
    bekleyenler[0]({ ok: false, sinif: 'baglanti' });
    await expect(ilk).resolves.toBe('yeniden-dene');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', deneme: 1, hataSinifi: 'baglanti', zaman: SIMDI });
  });

  it('geri çevrilen çağrı süren koşunun sahipliğini SİLMEZ: sonraki eşzamanlı çağrılar da geri çevrilir', async () => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek();
    const ilk = magazaBildirimIsle(KIMLIK, d.D);
    await bekle();
    await expect(magazaBildirimIsle(KIMLIK, d.D, ARA)).resolves.toBe('yeniden-dene');
    await expect(magazaBildirimIsle(KIMLIK, d.D, ARA)).resolves.toBe('yeniden-dene');
    await expect(magazaBildirimIsle(KIMLIK, d.D)).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(1);
    bekleyenler[0]({ ok: true });
    await expect(ilk).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('küme KİMLİK başına BIRAKILIR: A bitince B hâlâ sahipli; B için ikinci posta yok', async () => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek({ [KIMLIK]: talep(), [KIMLIK_B]: talep({ talepNo: 'T261008-B0B0' }) });
    const a = magazaBildirimIsle(KIMLIK, d.D, ARA);
    const b = magazaBildirimIsle(KIMLIK_B, d.D, ARA);
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(2);
    bekleyenler[0]({ ok: true });
    await expect(a).resolves.toBe('gitti');
    // İkinci B çağrısı doğrudan beklenmez: küme yanlış kimliği bırakırsa çağrı asılı göndericiye düşer ve test
    // zaman aşımına değil, hemen aşağıdaki sayım beklentisine takılır.
    const bIkinci = magazaBildirimIsle(KIMLIK_B, d.D, { sayi: 2, sonMu: false });
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(2);
    await expect(bIkinci).resolves.toBe('yeniden-dene');
    bekleyenler[1]({ ok: true });
    await expect(b).resolves.toBe('gitti');
    expect(d.bildirim(KIMLIK_B)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('sahiplenme SONUÇ YAZILANA kadar sürer: posta gitti, `gitti` yazımı asılıyken gelen ara deneme göndermez', async () => {
    const d = duzenek();
    const havuz = d.D.getPgPool() as { query: (sql: string, params: unknown[]) => Promise<unknown> };
    let birak: () => void = () => {};
    let asildi = false;
    const D2 = { ...d.D, getPgPool: () => ({ query: async (sql: string, params: unknown[]) => {
      if (sql !== OKU_SQL && !asildi) { asildi = true; await new Promise<void>((r) => { birak = r; }); }
      return havuz.query(sql, params);
    } }) } as unknown as MagazaBildirimDeps;
    const ilk = magazaBildirimIsle(KIMLIK, D2, ARA);
    // Ara beklenti kırılsa bile asılı yazım bırakılır; yoksa kimlik modül düzeyindeki kümede kalır.
    try {
      await bekle();
      expect(gonder).toHaveBeenCalledTimes(1);
      expect(asildi).toBe(true);
      await expect(magazaBildirimIsle(KIMLIK, D2, { sayi: 2, sonMu: false })).resolves.toBe('yeniden-dene');
      expect(gonder).toHaveBeenCalledTimes(1);
    } finally {
      birak();
      await ilk;
    }
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('küme KİMLİK başına: bir talebin gönderimi sürerken BAŞKA talep gönderilir', async () => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek({ [KIMLIK]: talep(), [KIMLIK_B]: talep({ talepNo: 'T261008-B0B0' }) });
    const a = magazaBildirimIsle(KIMLIK, d.D, ARA);
    const b = magazaBildirimIsle(KIMLIK_B, d.D, ARA);
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(2);
    for (const bitir of bekleyenler) bitir({ ok: true });
    await expect(Promise.all([a, b])).resolves.toEqual(['gitti', 'gitti']);
  });

  it.each([
    ['gönderici REDDEDERSE', (): void => { gonder.mockRejectedValueOnce(new Error('taşıyıcı reddetti')); }, 'gonderilemedi'],
    ['gönderici EŞZAMANLI FIRLATIRSA', (): void => { gonder.mockImplementationOnce(() => { throw new Error('eşzamanlı'); }); }, 'gonderilemedi'],
    ['gönderim başarısız DÖNERSE', (): void => { gonder.mockResolvedValueOnce({ ok: false, sinif: 'baglanti' }); }, 'gonderilemedi'],
    ['yapılandırma EKSİKSE', (): void => { gonder.mockResolvedValueOnce({ ok: false, yapilandirilmamis: true }); }, 'yapilandirilmamis'],
  ])('%s de küme boşalır: aynı talebin SONRAKİ çağrısı geri çevrilmez, gönderir', async (_ad, ilkGonderimiKur, ilkSonuc) => {
    ilkGonderimiKur();
    const d = duzenek();
    await expect(magazaBildirimIsle(KIMLIK, d.D)).resolves.toBe(ilkSonuc);
    // Küme dolu kalsaydı bu ara deneme 'yeniden-dene' dönerdi ve gönderici ikinci kez çağrılmazdı.
    await expect(magazaBildirimIsle(KIMLIK, d.D, ARA)).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(2);
  });

  it.each<[string, () => MagazaBildirimDeps]>([
    ['havuz yok', () => duzenek(undefined, {}, { getPgPool: () => null }).D],
    ['`getPgPool` fırlatıyor', () => duzenek(undefined, {}, { getPgPool: () => { throw new Error('havuz'); } }).D],
    ['okuma SQL\'i fırlatıyor', () => duzenek(undefined, { oku: async () => { throw new Error('oku'); } }).D],
    ['doküman yok', () => duzenek({}).D],
    ['doküman bozuk', () => duzenek({ [KIMLIK]: 'bozuk' }).D],
  ])('gönderime VARMADAN biten koşu (%s) da kümeyi boşaltır', async (_ad, bozukDuzenek) => {
    await magazaBildirimIsle(KIMLIK, bozukDuzenek(), ARA);
    expect(gonder).not.toHaveBeenCalled();
    await expect(magazaBildirimIsle(KIMLIK, duzenek().D, ARA)).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('kuyruk + süreç içi yol birlikte (isteyici süreç içi gönderimi başlatmış, işçi aynı talebi almış): TEK posta; işçi «yeniden dene» fırlatır, sonraki denemede `gitti` görüp atlar', async () => {
    const { bekleyenler } = asiliGonderici();
    const d = duzenek();
    await magazaBildirimIsteyici(() => null, d.D)(KIMLIK);       // süreç içi yol başladı, beklenmedi
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(1);
    const isci = magazaBildirimIscisi(d.D);
    await expect(isci([{ data: { talepId: KIMLIK }, retryCount: 0, retryLimit: 8 }])).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(gonder).toHaveBeenCalledTimes(1);

    bekleyenler[0]({ ok: true });
    await bekle();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
    await expect(isci([{ data: { talepId: KIMLIK }, retryCount: 1, retryLimit: 8 }])).resolves.toBeUndefined();
    expect(gonder).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsle — başarısız gönderim', () => {
  it('ara deneme → doküman `bekliyor` + deneme + hataSinifi; sonuç yeniden-dene', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 3, sonMu: false })).toBe('yeniden-dene');
    expect(d.yazilan()).toEqual([{ sql: YAZ_SQL, params: ['magazaTalepleri', KIMLIK, JSON.stringify({ durum: 'bekliyor', deneme: 3, hataSinifi: 'baglanti', zaman: SIMDI })] }]);
    expect(d.yayin).toHaveBeenCalledWith('magazaTalepleri', 'set', KIMLIK, expect.objectContaining({ bildirim: { durum: 'bekliyor', deneme: 3, hataSinifi: 'baglanti', zaman: SIMDI } }), { cid: KIRACI });
  });

  it('SON deneme → `gonderilemedi` + deneme + hataSinifi; sonuç gonderilemedi', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'kimlik' });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 9, sonMu: true })).toBe('gonderilemedi');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', deneme: 9, hataSinifi: 'kimlik', zaman: SIMDI });
    expect(d.yayin).toHaveBeenCalledTimes(1);
  });

  it('süreç içi yol (deneme verilmemiş) → `gonderilemedi`, deneme alanı YOK', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'tls' });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gonderilemedi');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'tls', zaman: SIMDI });
  });

  it.each([0, -1, 1.5, Number.NaN])('deneme sayısı geçersizse (%s) alan YAZILMAZ (0 / uydurma sayı değil)', async (sayi) => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi, sonMu: false })).toBe('yeniden-dene');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', hataSinifi: 'baglanti', zaman: SIMDI });
  });

  it.each([...MAGAZA_BILDIRIM_HATA_SINIFLARI])('hata sınıfı «%s» dokümana aynen geçer', async (sinif) => {
    gonder.mockResolvedValue({ ok: false, sinif });
    const d = duzenek();
    await magazaBildirimIsle(KIMLIK, d.D);
    expect(d.bildirim(KIMLIK)).toMatchObject({ durum: 'gonderilemedi', hataSinifi: sinif });
  });

  it('gönderici kapalı küme DIŞI bir sınıf (serbest metin) dönerse dokümana `diger` yazılır', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: '550 5.1.1 kutu yok: gizli-yanit' } as unknown as SmtpSonucu);
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gonderilemedi');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'diger', zaman: SIMDI });
    expect(JSON.stringify(d.sorgular) + konsolMetni()).not.toContain('gizli-yanit');
  });

  it('yapılandırma eksik → `yapilandirilmamis`; yeniden deneme YOK (ara denemede bile)', async () => {
    gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).toBe('yapilandirilmamis');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'yapilandirilmamis', zaman: SIMDI });
    expect(d.yayin).toHaveBeenCalledTimes(1);
  });

  it('hata METNİ hiçbir yere yazılmaz: gönderici (sözleşmesine aykırı) reddetse de yalnız sınıf', async () => {
    gonder.mockRejectedValue(gizliHata('Invalid login: 535 gizli-sunucu-yaniti Zeynep parola-9f3', { code: 'EAUTH', response: '535 gizli-sunucu-yaniti' }));
    const d = duzenek();
    // `kimlik` KALICI sınıf: ara denemede bile yeniden denenmez (aşağıdaki «kalıcı sınıflar» testleri).
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', deneme: 2, hataSinifi: 'kimlik', zaman: SIMDI });
    const yazilanHerSey = JSON.stringify(d.sorgular) + JSON.stringify(d.yayin.mock.calls) + konsolMetni();
    for (const iz of ['gizli-sunucu-yaniti', 'Invalid login', 'parola-9f3', '535']) expect(yazilanHerSey).not.toContain(iz);
  });

  it('günlük: son başarısızlıkta sabit metin + sınıf; talep kimliği ve kişisel veri YOK; ara denemede satır yok', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false });
    expect(konsolMetni()).toBe('');
    await magazaBildirimIsle(KIMLIK, d.D, { sayi: 9, sonMu: true });
    expect(konsolMetni()).toBe('[magaza-bildirim] bildirim gönderilemedi (sınıf: baglanti)');
  });

  it.each(['kimlik', 'alici-reddi'] as const)('KALICI sınıf (%s): ara denemede bile `gonderilemedi`; yeniden deneme İSTENMEZ (9 AUTH denemesi hesap kilidi tetikleyebilir)', async sinif => {
    gonder.mockResolvedValue({ ok: false, sinif });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).toBe('gonderilemedi');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', deneme: 1, hataSinifi: sinif, zaman: SIMDI });
    expect(konsolMetni()).toBe(`[magaza-bildirim] bildirim gönderilemedi (sınıf: ${sinif})`);
    expect(gonder).toHaveBeenCalledTimes(1);
  });
  it.each(['baglanti', 'tls', 'diger'] as const)('GEÇİCİ sınıf (%s): ara denemede `bekliyor` + yeniden-dene', async sinif => {
    gonder.mockResolvedValue({ ok: false, sinif });
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).toBe('yeniden-dene');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', deneme: 1, hataSinifi: sinif, zaman: SIMDI });
  });
  it('kalıcı sınıf kümesi tam olarak kimlik + alıcı reddi', () => {
    expect([...KALICI_HATA_SINIFLARI].sort()).toEqual(['alici-reddi', 'gonderen-reddi', 'kimlik']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsle — yayın: satır döndüyse ve kiracı etiketi varsa', () => {
  it('UPDATE satır döndürmediyse (talep arada silinmiş) yayın YOK; sonuç değişmez', async () => {
    const d = duzenek(undefined, { yaz: async () => ({ rows: [] }) });
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');
    expect(d.yayin).not.toHaveBeenCalled();
    // Olağan durum: «yazılamadı» uyarısı da YOK (satırsız sonuç hata değildir).
    expect(konsolMetni()).toBe('');
  });

  it.each([
    ['companyId yok', (() => { const { companyId: _c, ...kalan } = talep(); return kalan; })()],
    ['companyId boş', { ...talep(), companyId: '' }],
    ['companyId dizge değil', { ...talep(), companyId: 42 }],
    ['satır nesne değil', 'bozuk'],
    ['satır null', null],
  ])('dönen satırda %s → yayın YOK (etiketsiz olay akışta BÜTÜN kiracılara giderdi)', async (_ad, satir) => {
    const d = duzenek(undefined, { yaz: async () => ({ rows: [{ data: satir }] }) });
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');
    expect(d.yayin).not.toHaveBeenCalled();
  });

  it('yayın fırlatsa da sonuç değişmez', async () => {
    const yayinPatlar = { broadcastDocChange: (): void => { throw new Error('akış kapalı'); } };
    const d = duzenek(undefined, {}, yayinPatlar);
    await expect(magazaBildirimIsle(KIMLIK, d.D)).resolves.toBe('gitti');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });

    // Yayın hatası «yapılandırılmamış»ı yeniden denemeye çevirmez …
    gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true });
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, {}, yayinPatlar).D, { sayi: 1, sonMu: false })).resolves.toBe('yapilandirilmamis');
    // … son başarısızlığın günlük satırını da yutmaz.
    gonder.mockResolvedValue({ ok: false, sinif: 'tls' });
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, {}, yayinPatlar).D)).resolves.toBe('gonderilemedi');
    expect(konsolMetni()).toBe('[magaza-bildirim] bildirim gönderilemedi (sınıf: tls)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsle — ASLA fırlatmaz (dönen değer gönderimi anlatır)', () => {
  // Sıra [ad, beklenen, deneme]: test adındaki iki %s ilk iki öğeyi basar.
  const DENEMELER: Array<[string, string, { sayi: number; sonMu: boolean } | undefined]> = [
    ['süreç içi yol', 'gonderilemedi', undefined],
    ['ara deneme', 'yeniden-dene', { sayi: 1, sonMu: false }],
    ['son deneme', 'gonderilemedi', { sayi: 9, sonMu: true }],
  ];

  it.each(DENEMELER)('havuz yok (%s) → %s; gönderim ve yayın yok', async (_ad, beklenen, deneme) => {
    const d = duzenek(undefined, {}, { getPgPool: () => null });
    await expect(magazaBildirimIsle(KIMLIK, d.D, deneme)).resolves.toBe(beklenen);
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yayin).not.toHaveBeenCalled();
    expect(konsolMetni()).toBe('[magaza-bildirim] veritabanı havuzu yok — bildirim gönderilemedi');
  });

  it.each(DENEMELER)('`getPgPool` fırlatırsa (%s) → %s', async (_ad, beklenen, deneme) => {
    const d = duzenek(undefined, {}, { getPgPool: () => { throw new Error('havuz kurulamadı: postgres://kullanici:gizli-parola@sunucu'); } });
    await expect(magazaBildirimIsle(KIMLIK, d.D, deneme)).resolves.toBe(beklenen);
    expect(gonder).not.toHaveBeenCalled();
    expect(konsolMetni()).not.toContain('gizli-parola');
  });

  it.each(DENEMELER)('okuma SQL\'i fırlatırsa (%s) → %s; posta GİTMEZ', async (_ad, beklenen, deneme) => {
    const d = duzenek(undefined, { oku: async () => { throw gizliHata('terminating connection: Zeynep Gizliad', { code: '57P01', detail: 'Key (id)=(gizli-detay)', where: 'gizli-where' }); } });
    await expect(magazaBildirimIsle(KIMLIK, d.D, deneme)).resolves.toBe(beklenen);
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yazilan()).toEqual([]);
    expect(konsolMetni()).toBe('[magaza-bildirim] talep okunamadı (kod: 57P01)');
  });

  it('posta GİTTİ ama sonuç yazılamadı → gitti (yeniden deneme çift posta olurdu); yayın yok', async () => {
    const d = duzenek(undefined, { yaz: async () => { throw gizliHata('deadlock: Gizliad', { code: '40P01', detail: 'gizli-detay' }); } });
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.yayin).not.toHaveBeenCalled();
    expect(konsolMetni()).toBe('[magaza-bildirim] bildirim sonucu yazılamadı (kod: 40P01)');
  });

  it('posta gitmedi VE sonuç yazılamadı → dönen değer yazım hatasından etkilenmez', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const yaz = async (): Promise<never> => { throw new Error('yazılamadı'); };
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, { yaz }).D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, { yaz }).D, { sayi: 9, sonMu: true })).resolves.toBe('gonderilemedi');
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, { yaz }).D)).resolves.toBe('gonderilemedi');
    gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true });
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, { yaz }).D, { sayi: 1, sonMu: false })).resolves.toBe('yapilandirilmamis');
  });

  it.each([
    ['kodsuz hata', new Error('gizli-ileti'), 'yok'],
    ['kod serbest metin', gizliHata('x', { code: 'gizli kod: Zeynep' }), 'yok'],
    ['kod sayı', gizliHata('x', { code: 42 }), 'yok'],
    ['ağ kodu', gizliHata('connect ECONNREFUSED 10.0.0.7:5432', { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
    ['hata nesne değil', 'gizli-dizge', 'yok'],
  ])('günlüğe yalnız KOD yazılır (%s)', async (_ad, hata, beklenenKod) => {
    const d = duzenek(undefined, { oku: async () => { throw hata; } });
    await magazaBildirimIsle(KIMLIK, d.D);
    expect(konsolMetni()).toBe(`[magaza-bildirim] talep okunamadı (kod: ${beklenenKod})`);
  });

  it.each([
    ['kalemler dizi değil', { ...talep(), kalemler: 'bozuk' }],
    ['kalem nesne değil', { ...talep(), kalemler: [null] }],
    ['musteri yok', (() => { const { musteri: _m, ...kalan } = talep(); return kalan; })()],
    ['talepEdilen yok', (() => { const { talepEdilen: _t, ...kalan } = talep(); return kalan; })()],
    ['musteri dizge', { ...talep(), musteri: 'bozuk' }],
    ['talepEdilen sayı', { ...talep(), talepEdilen: 5 }],
    ['kalemler nesne', { ...talep(), kalemler: { length: 0 } }],
    ['doküman dizge', 'bozuk'],
    ['doküman null', null],
  ])('bozuk doküman (%s) → gönderim DENENMEZ; `gonderilemedi` + diger; ara denemede bile yeniden deneme yok', async (_ad, belge) => {
    const d = duzenek({ [KIMLIK]: belge }, {
      // Sahte tablo nesne olmayan dokümanı güncelleyemez; gerçek `jsonb_set` gibi satır döndürsün.
      yaz: async () => ({ rows: [{ data: { companyId: KIRACI } }] }),
    });
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yazilan().map((s) => s.params[2])).toEqual([JSON.stringify({ durum: 'gonderilemedi', hataSinifi: 'diger', zaman: SIMDI })]);
  });

  it('içerik üretimi fırlatırsa (`appUrl` patlıyor) → gönderim yok; `gonderilemedi` + diger YAZILIR; ara denemede bile yeniden deneme yok', async () => {
    const d = duzenek(undefined, {}, { appUrl: () => { throw new Error('ortam okunamadı: gizli-ortam'); } });
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(gonder).not.toHaveBeenCalled();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'diger', zaman: SIMDI });
    expect(konsolMetni()).toBe('[magaza-bildirim] bildirim içeriği üretilemedi (doküman biçimi)');
  });

  it('`simdi` posta gittikten SONRA fırlatırsa → gitti (yeniden deneme yok)', async () => {
    const d = duzenek(undefined, {}, { simdi: () => { throw new Error('saat yok'); } });
    await expect(magazaBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('`simdi` posta gitMEDEN fırlatırsa → ara denemede yeniden-dene, değilse gonderilemedi', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const simdi = (): Date => { throw new Error('saat yok'); };
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, {}, { simdi }).D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    await expect(magazaBildirimIsle(KIMLIK, duzenek(undefined, {}, { simdi }).D)).resolves.toBe('gonderilemedi');
  });

  it('gönderici EŞZAMANLI fırlatırsa da söz reddetmez', async () => {
    gonder.mockImplementation(() => { throw new Error('gizli-eszamanli'); });
    await expect(magazaBildirimIsle(KIMLIK, duzenek().D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    await expect(magazaBildirimIsle(KIMLIK, duzenek().D)).resolves.toBe('gonderilemedi');
    expect(konsolMetni()).not.toContain('gizli-eszamanli');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('uçtan uca — GERÇEK smtpGonder (yalnız taşıyıcı sahte): iki modül birbirine bağlı', () => {
  const SMTP_ANAHTARLARI = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'MAGAZA_BILDIRIM_ALICI'] as const;
  const TAM_ORTAM = { SMTP_HOST: 'posta.ornek.test', SMTP_USER: 'bildirim@ornek.test', SMTP_PASS: 'cok-gizli-parola-9f3', MAGAZA_BILDIRIM_ALICI: 'iletisim@ornek.test' } as const;

  /** Listelenmeyen SMTP anahtarı TANIMSIZ olur (geliştirici makinesindeki değer sızmasın). */
  async function gercekGonderici(ortam: Partial<Record<typeof SMTP_ANAHTARLARI[number], string>>): Promise<void> {
    for (const ad of SMTP_ANAHTARLARI) vi.stubEnv(ad, ortam[ad]);
    const asil = await vi.importActual<typeof import('../smtpPosta')>('../smtpPosta');
    gonder.mockImplementation(asil.smtpGonder);
  }

  function sahteTasiyici(sendMail: (ileti: SendMailOptions) => Promise<unknown>) {
    const t = { sendMail: vi.fn(sendMail), verify: vi.fn(async () => true as const), close: vi.fn() };
    uretici.mockImplementationOnce(() => t as unknown as ReturnType<typeof createTransport>);
    return t;
  }

  it('bildirim KAPALIYKEN (MAGAZA_BILDIRIM=kapali; boş ortam artık YEREL kiptir): `yapilandirilmamis`; taşıyıcı ÜRETİLMEZ (bağlantı denenmez); işçi yeniden denemez', async () => {
    await gercekGonderici({});
    vi.stubEnv('MAGAZA_BILDIRIM', 'kapali');
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([{ data: { talepId: KIMLIK }, retryCount: 0, retryLimit: 8 }])).resolves.toBeUndefined();
    expect(uretici).not.toHaveBeenCalled();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'yapilandirilmamis', zaman: SIMDI });
    expect(d.yayin).toHaveBeenCalledTimes(1);
  });

  it('süreç içi yolda da aynı (kuyruk yok): `yapilandirilmamis`, bağlantı denenmez', async () => {
    await gercekGonderici({ ...TAM_ORTAM, MAGAZA_BILDIRIM_ALICI: 'iletisim' });
    const d = duzenek();
    await magazaBildirimIsteyici(() => null, d.D)(KIMLIK);
    await bekle();
    expect(uretici).not.toHaveBeenCalled();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'yapilandirilmamis', zaman: SIMDI });
  });

  it('yapılandırma tamken: taşıyıcıya giden ileti yapılandırılmış TEK alıcıya, doğrulanmış konuyla, kişisel veri taşımadan', async () => {
    await gercekGonderici(TAM_ORTAM);
    const t = sahteTasiyici(async () => ({ accepted: ['iletisim@ornek.test'] }));
    const d = duzenek();
    expect(await magazaBildirimIsle(KIMLIK, d.D)).toBe('gitti');
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    const ileti = t.sendMail.mock.calls[0][0];
    const beklenen = magazaBildirimIcerigi(talep(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(beklenen.konu).toBe('Yeni mağaza talebi: T261008-5Y9P');
    expect(ileti).toEqual({ from: 'bildirim@ornek.test', to: { name: '', address: 'iletisim@ornek.test' }, subject: beklenen.konu, text: beklenen.metin, html: beklenen.html });
    for (const parca of KISISEL) expect(JSON.stringify(ileti), parca).not.toContain(parca);
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('taşıyıcı kimlik reddiyle dönerse: doküman `gonderilemedi` + kimlik; işçi hata FIRLATMAZ (kalıcı sınıf yeniden denenmez); sunucu yanıtı hiçbir yerde yok', async () => {
    await gercekGonderici(TAM_ORTAM);
    sahteTasiyici(async () => { throw gizliHata('Invalid login: 535 5.7.8 gizli-sunucu-yaniti', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 535, response: '535 5.7.8 gizli-sunucu-yaniti' }); });
    const d = duzenek();
    const hata: unknown = await magazaBildirimIscisi(d.D)([{ data: { talepId: KIMLIK }, retryCount: 0, retryLimit: 8 }]).then(() => null, (h: unknown) => h);
    expect(hata).toBeNull();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', deneme: 1, hataSinifi: 'kimlik', zaman: SIMDI });
    const yazilanHerSey = JSON.stringify(d.sorgular) + JSON.stringify(d.yayin.mock.calls) + konsolMetni() + (hata instanceof Error ? `${hata.message}${hata.stack}` : '');
    for (const iz of ['gizli-sunucu-yaniti', 'Invalid login', 'cok-gizli-parola-9f3', '5.7.8']) expect(yazilanHerSey, iz).not.toContain(iz);
  });

  // Hata biçimleri ölçüm (gerçek nodemailer 10.0.16, yerel sahte sunucu, 2026-10-08): 4xx de 5xx ile AYNI kodu taşır,
  // ayıran yalnız `responseCode`. Birleşim burada kilitlenir: sınıflama (`smtpPosta`) + «kalıcı sınıf yeniden denenmez» (bu modül).
  it.each([
    ['RCPT TO 451', "Can't send mail - all recipients were rejected: 451 4.3.0 gizli-sunucu-yaniti", { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 451 }],
    ['MAIL FROM 452', 'Mail command failed: 452 4.3.1 gizli-sunucu-yaniti', { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 452 }],
    ['DATA 451', 'Data command failed: 451 4.3.0 gizli-sunucu-yaniti', { code: 'EENVELOPE', command: 'DATA', responseCode: 451 }],
    ['AUTH 454', 'Invalid login: 454 4.7.0 gizli-sunucu-yaniti', { code: 'EAUTH', command: 'AUTH LOGIN', responseCode: 454 }],
  ])('taşıyıcı GEÇİCİ retle (%s) dönerse: doküman `bekliyor` + diger, işçi «yeniden dene» FIRLATIR; sunucu düzelince sonraki deneme gönderir', async (_ad, ileti, ek) => {
    await gercekGonderici(TAM_ORTAM);
    sahteTasiyici(async () => { throw gizliHata(ileti, { ...ek, response: ileti.slice(ileti.indexOf(': ') + 2) }); });
    const d = duzenek();
    const isci = magazaBildirimIscisi(d.D);
    const hata: unknown = await isci([{ data: { talepId: KIMLIK }, retryCount: 0, retryLimit: 8 }]).then(() => null, (h: unknown) => h);
    expect(hata).toBeInstanceOf(Error);
    expect(hata instanceof Error ? hata.message : '').toBe(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', deneme: 1, hataSinifi: 'diger', zaman: SIMDI });
    const yazilanHerSey = JSON.stringify(d.sorgular) + JSON.stringify(d.yayin.mock.calls) + konsolMetni() + (hata instanceof Error ? hata.message : '');
    for (const iz of ['gizli-sunucu-yaniti', 'rejected', 'Invalid login', 'command failed']) expect(yazilanHerSey, iz).not.toContain(iz);

    const t = sahteTasiyici(async () => ({ accepted: ['iletisim@ornek.test'] }));
    await expect(isci([{ data: { talepId: KIMLIK }, retryCount: 1, retryLimit: 8 }])).resolves.toBeUndefined();
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('kuyruk sözleşmesi — sabitler', () => {
  it('kuyruk adı ve İŞ başına yeniden deneme seçenekleri şartnamedeki gibi', () => {
    expect(MAGAZA_BILDIRIM_KUYRUGU).toBe('magaza-talep-bildirimi');
    expect(MAGAZA_BILDIRIM_IS_SECENEKLERI).toEqual({ retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 120 });
    expect(MAGAZA_BILDIRIM_ISCI_SECENEKLERI).toEqual({ includeMetadata: true });
  });

  it('«yeniden dene» iletisi sabit: değişken parça, kimlik, sınıf adı taşımaz', () => {
    expect(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI).toBe('mağaza talebi bildirimi gönderilemedi; yeniden denenecek');
    for (const sinif of MAGAZA_BILDIRIM_HATA_SINIFLARI) expect(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI).not.toContain(sinif);
    expect(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI).not.toMatch(/mt-|\$\{|\d/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIscisi', () => {
  const is = (talepId: unknown, retryCount: number | undefined = 0, retryLimit: number | undefined = 8) => ({ data: { talepId }, retryCount, retryLimit });

  it('başarı: dokümanı okur, gönderir, `gitti` yazar; değer DÖNDÜRMEZ', async () => {
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([is(KIMLIK)])).resolves.toBeUndefined();
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it.each([
    [0, 8, 1, false],
    [1, 8, 2, false],
    [7, 8, 8, false],
    [8, 8, 9, true],
    [9, 8, 10, true],
    [0, 0, 1, true],
  ])('sayaç retryCount=%i / retryLimit=%i → deneme %i; son mu: %s', async (retryCount, retryLimit, deneme, sonMu) => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    const soz = magazaBildirimIscisi(d.D)([is(KIMLIK, retryCount, retryLimit)]);
    if (sonMu) {
      // Son deneme: pg-boss'un yeniden deneyeceği bir şey kalmadı — hata fırlatılmaz, doküman kapanır.
      await expect(soz).resolves.toBeUndefined();
      expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', deneme, hataSinifi: 'baglanti', zaman: SIMDI });
    } else {
      await expect(soz).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
      expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', deneme, hataSinifi: 'baglanti', zaman: SIMDI });
    }
  });

  it('fırlatılan hata: iletisi SABİT; talep kimliği, sınıf, sunucu yanıtı, kişisel veri taşımaz', async () => {
    // GEÇİCİ sınıf (bağlantı): yeniden deneme yalnız onlarda istenir; kalıcı sınıfta (kimlik / alıcı reddi) işçi hiç fırlatmaz.
    gonder.mockRejectedValue(gizliHata('connect ECONNREFUSED gizli-yanit Zeynep', { code: 'ECONNECTION', response: '421 gizli-yanit' }));
    const d = duzenek();
    const hata: unknown = await magazaBildirimIscisi(d.D)([is(KIMLIK)]).then(() => null, (h: unknown) => h);
    expect(hata).toBeInstanceOf(Error);
    if (!(hata instanceof Error)) return;
    expect(hata.message).toBe(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(Object.keys(hata)).toEqual([]);
    expect(hata.cause).toBeUndefined();
    // pg-boss iş satırına ileti + yığın izi yazar.
    for (const iz of [KIMLIK, 'gizli-yanit', 'Zeynep', 'baglanti', 'ECONNECTION', 'ECONNREFUSED', ...KISISEL]) expect(`${hata.message}\n${hata.stack}`, iz).not.toContain(iz);
  });

  it.each([
    ['veri null', { data: null }],
    ['veri yok', {}],
    ['veri dizge', { data: KIMLIK }],
    ['veri dizi', { data: [KIMLIK] }],
    ['talepId yok', { data: {} }],
    ['talepId sayı', { data: { talepId: 42 } }],
    ['talepId biçimsiz', { data: { talepId: 'mt-xyz' } }],
    ['talepId başka koleksiyon kimliği', { data: { talepId: 'siparis-123' } }],
    ['iş null', null],
    ['iş dizge', 'bozuk'],
  ])('biçimi bozuk iş (%s) sessizce atlanır: SQL yok, gönderim yok, hata YOK (yeniden denenmez)', async (_ad, bozuk) => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([bozuk as unknown as { data: unknown }])).resolves.toBeUndefined();
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
  });

  it('biçimi bozuk iş tek talep işlevine HİÇ ulaşmaz; geçerli iş kimlik + deneme bilgisiyle ulaşır', async () => {
    const cagrilar: Array<[string, { sayi: number; sonMu: boolean } | undefined]> = [];
    const isle = async (talepId: string, _D: MagazaBildirimDeps, deneme?: { sayi: number; sonMu: boolean }): Promise<MagazaBildirimSonucu> => { cagrilar.push([talepId, deneme]); return 'gitti'; };
    const d = duzenek();
    await expect(magazaBildirimIscisiKur(d.D, isle)([
      { data: { talepId: 'mt-xyz' }, retryCount: 0, retryLimit: 8 },
      { data: { talepId: `${KIMLIK}' OR 1=1` }, retryCount: 0, retryLimit: 8 },
      { data: { talepId: 42 }, retryCount: 0, retryLimit: 8 },
      { data: { talepId: KIMLIK }, retryCount: 2, retryLimit: 8 },
    ])).resolves.toBeUndefined();
    expect(cagrilar).toEqual([[KIMLIK, { sayi: 3, sonMu: false }]]);
  });

  it('tek talep işlevi (sözleşmesine aykırı) fırlatsa da hatası iş satırına SIZMAZ: yeniden deneme yok, sıradaki iş işlenir', async () => {
    const gorulen: string[] = [];
    const isle = async (talepId: string): Promise<MagazaBildirimSonucu> => {
      gorulen.push(talepId);
      if (talepId === KIMLIK) throw new Error('beklenmeyen: Zeynep Gizliad 0532 111 22 33');
      return 'gitti';
    };
    await expect(magazaBildirimIscisiKur(duzenek().D, isle)([is(KIMLIK), is(KIMLIK_B)])).resolves.toBeUndefined();
    expect(gorulen).toEqual([KIMLIK, KIMLIK_B]);
    // Eşzamanlı fırlatan işlev de aynı.
    const eszamanli = (): Promise<MagazaBildirimSonucu> => { throw new Error('eşzamanlı: Gizliad'); };
    await expect(magazaBildirimIscisiKur(duzenek().D, eszamanli)([is(KIMLIK)])).resolves.toBeUndefined();
  });

  it('dikiş «yeniden dene»yi de taşır: işlev yeniden-dene dönerse sabit iletili hata', async () => {
    const isle = async (): Promise<MagazaBildirimSonucu> => 'yeniden-dene';
    await expect(magazaBildirimIscisiKur(duzenek().D, isle)([is(KIMLIK)])).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
  });

  it('iş sayaçları yoksa uyarı süreç başına BİR kez (her işte yinelenip günlüğü doldurmaz)', async () => {
    vi.resetModules();   // uyarı bayrağı modül düzeyinde: taze modül örneğiyle ölçülür
    const taze = await import('./magazaBildirim');
    const isle = async (): Promise<MagazaBildirimSonucu> => 'gitti';
    const isci = taze.magazaBildirimIscisiKur(duzenek().D, isle);
    await isci([{ data: { talepId: KIMLIK }, retryCount: 0, retryLimit: 8 }]);
    expect(konsolMetni()).toBe('');
    await isci([{ data: { talepId: KIMLIK } }, { data: { talepId: KIMLIK_B } }]);
    await isci([{ data: { talepId: KIMLIK } }]);
    expect(konsolMetni()).toBe('[magaza-bildirim] iş sayaçları yok (işçi includeMetadata: true ile kaydedilmeli) — yeniden deneme yapılamıyor');
  });

  it('iş listesi dizi değilse / boşsa hiçbir şey yapmaz', async () => {
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([])).resolves.toBeUndefined();
    await expect(magazaBildirimIscisi(d.D)(undefined as unknown as [])).resolves.toBeUndefined();
    expect(d.havuz.query).not.toHaveBeenCalled();
  });

  it('iş verisinden YALNIZ `talepId` okunur (başka alana dokunan okuma tuzağa düşer)', async () => {
    const tuzak = new Proxy({ talepId: KIMLIK } as Record<string, unknown>, {
      get: (hedef, ad) => { if (ad !== 'talepId') throw new Error(`iş verisinden «${String(ad)}» okundu`); return hedef[ad]; },
    });
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([{ data: tuzak, retryCount: 0, retryLimit: 8 }])).resolves.toBeUndefined();
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it('TOPLU çağrı: birinin başarısızlığı diğerlerini YUTMAZ — hepsi işlenir, hata EN SONDA bir kez', async () => {
    gonder.mockResolvedValueOnce({ ok: false, sinif: 'baglanti' }).mockResolvedValueOnce({ ok: true });
    const d = duzenek({ [KIMLIK]: talep(), [KIMLIK_B]: talep({ talepNo: 'T261008-B0B0' }) });
    const isci = magazaBildirimIscisi(d.D);

    await expect(isci([is(KIMLIK), { data: { talepId: 'bozuk' } }, is(KIMLIK_B)])).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(gonder).toHaveBeenCalledTimes(2);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'bekliyor', deneme: 1, hataSinifi: 'baglanti', zaman: SIMDI });
    expect(d.bildirim(KIMLIK_B)).toEqual({ durum: 'gitti', zaman: SIMDI });

    // pg-boss toplu işin TAMAMINI yeniden verir: postası gitmiş talep `gitti` görüp atlanır (çift posta yok).
    gonder.mockResolvedValue({ ok: true });
    await expect(isci([is(KIMLIK, 1), is(KIMLIK_B, 1)])).resolves.toBeUndefined();
    expect(gonder).toHaveBeenCalledTimes(3);
    expect(gonder.mock.calls[2][0].konu).toBe('Yeni mağaza talebi: T261008-5Y9P');
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('TOPLU çağrı: son denemesi biten iş ile ara denemedeki iş birlikte — biri kapanır, diğeri için hata fırlar', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'tls' });
    const d = duzenek({ [KIMLIK]: talep(), [KIMLIK_B]: talep() });
    await expect(magazaBildirimIscisi(d.D)([is(KIMLIK, 8), is(KIMLIK_B, 2)])).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(d.bildirim(KIMLIK)).toMatchObject({ durum: 'gonderilemedi', deneme: 9 });
    expect(d.bildirim(KIMLIK_B)).toMatchObject({ durum: 'bekliyor', deneme: 3 });
  });

  it('yapılandırma eksikken hata fırlatmaz (yeniden deneme çözmez)', async () => {
    gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true });
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([is(KIMLIK)])).resolves.toBeUndefined();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'yapilandirilmamis', zaman: SIMDI });
  });

  it.each([
    ['ikisi de yok', undefined, undefined],
    ['retryLimit yok', 0, undefined],
    ['retryCount yok', undefined, 8],
    ['retryCount negatif', -1, 8],
    ['retryCount kesirli', 0.5, 8],
  ])('iş sayaçları yoksa / bozuksa (%s) iş TEK ATIMLIK: `gonderilemedi`, deneme alanı yok, hata fırlatmaz', async (_ad, retryCount, retryLimit) => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await expect(magazaBildirimIscisi(d.D)([{ data: { talepId: KIMLIK }, retryCount, retryLimit }])).resolves.toBeUndefined();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'baglanti', zaman: SIMDI });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimIsteyici', () => {
  type Kuyruk = { send: (ad: string, veri: object, secenek?: object) => Promise<unknown> };
  const sahteKuyruk = (send: Kuyruk['send'] = async () => 'is-kimligi') => ({ send: vi.fn(send) });

  it('kuyruk hazırsa: send(kuyruk adı, YALNIZ { talepId }, iş seçenekleri); süreç içi gönderim YOK', async () => {
    const d = duzenek();
    const k = sahteKuyruk();
    await expect(magazaBildirimIsteyici(() => k, d.D)(KIMLIK)).resolves.toBeUndefined();
    expect(k.send).toHaveBeenCalledTimes(1);
    expect(k.send).toHaveBeenCalledWith('magaza-talep-bildirimi', { talepId: KIMLIK }, { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 120 });
    expect(Object.keys(k.send.mock.calls[0][1])).toEqual(['talepId']);
    await bekle();
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
  });

  it('`send` BEKLENİR: kuyruk eklemesi bitmeden dönülmez', async () => {
    let coz: (v: unknown) => void = () => {};
    const k = sahteKuyruk(() => new Promise((r) => { coz = r; }));
    let dondu = false;
    const soz = magazaBildirimIsteyici(() => k, duzenek().D)(KIMLIK).then(() => { dondu = true; });
    await bekle();
    expect(dondu).toBe(false);
    coz('is-kimligi');
    await soz;
    expect(dondu).toBe(true);
  });

  it('kuyruk yoksa: süreç içi gönderim BAŞLATILIR ve BEKLENMEDEN dönülür', async () => {
    let coz: (v: SmtpSonucu) => void = () => {};
    gonder.mockImplementation(() => new Promise((r) => { coz = r; asilanlar.push(r); }));
    const d = duzenek();
    const sonuc = await Promise.race([
      magazaBildirimIsteyici(() => null, d.D)(KIMLIK).then(() => 'döndü'),
      bekle(300).then(() => 'bekliyor'),
    ]);
    expect(sonuc).toBe('döndü');
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(1);           // başlatıldı
    expect(d.bildirim(KIMLIK)).toMatchObject({ durum: 'bekliyor' });   // henüz bitmedi
    coz({ ok: true });
    await bekle();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
  });

  it('süreç içi yol tek atımlık: başarısızlıkta `gonderilemedi` (deneme alanı yok)', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await magazaBildirimIsteyici(() => null, d.D)(KIMLIK);
    await bekle();
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'baglanti', zaman: SIMDI });
  });

  const KUYRUK_UYARISI = '[magaza-bildirim] bildirim kuyruğa eklenemedi — süreç içi gönderime geçildi';

  it.each([
    ['send reddederse', () => sahteKuyruk(async () => { throw new Error('kuyruk yok: gizli-kuyruk-hatasi'); }), KUYRUK_UYARISI],
    ['send eşzamanlı fırlatırsa', () => sahteKuyruk(() => { throw new Error('gizli-kuyruk-hatasi'); }), KUYRUK_UYARISI],
    ['send null çözerse (pg-boss: iş oluşturulmadı)', () => sahteKuyruk(async () => null), ''],
    ['send tanımsız çözerse', () => sahteKuyruk(async () => undefined), ''],
  ])('%s → süreç içi gönderim; dönen söz REDDETMEZ; günlükte yalnız sabit metin', async (_ad, kur, beklenenGunluk) => {
    const d = duzenek();
    const k = kur();
    await expect(magazaBildirimIsteyici(() => k, d.D)(KIMLIK)).resolves.toBeUndefined();
    await bekle();
    expect(k.send).toHaveBeenCalledTimes(1);
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gitti', zaman: SIMDI });
    expect(konsolMetni()).toBe(beklenenGunluk);
  });

  it('`kuyruk()` fırlatırsa → süreç içi gönderim; söz reddetmez', async () => {
    const d = duzenek();
    await expect(magazaBildirimIsteyici(() => { throw new Error('kuyruk okunamadı'); }, d.D)(KIMLIK)).resolves.toBeUndefined();
    await bekle();
    expect(gonder).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'mt-xyz', `${KIMLIK}x`, 42, null, undefined])('kimlik biçimi bozuksa («%s») ne kuyruğa girer ne gönderilir', async (kimlik) => {
    const d = duzenek();
    const k = sahteKuyruk();
    await expect(magazaBildirimIsteyici(() => k, d.D)(kimlik as unknown as string)).resolves.toBeUndefined();
    await expect(magazaBildirimIsteyici(() => null, d.D)(kimlik as unknown as string)).resolves.toBeUndefined();
    await bekle();
    expect(k.send).not.toHaveBeenCalled();
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
  });

  it('geçerli kimlik deseni sözleşmedekiyle aynı (düzenek kör değil)', () => {
    expect(MAGAZA_TALEP_KIMLIK_DESENI.test(KIMLIK)).toBe(true);
    expect(MAGAZA_TALEP_KIMLIK_DESENI.test(KIMLIK_B)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('süreç içi yolun reddi genel unhandledRejection işleyicisine DÜŞMEZ', () => {
  it('sahte gönderici reddedince olay tetiklenmez (kuyruk yok)', async () => {
    gonder.mockRejectedValue(new Error('taşıyıcı reddetti: gizli'));
    const d = duzenek();
    const sahipsiz = await sahipsizRetSay(() => magazaBildirimIsteyici(() => null, d.D)(KIMLIK));
    expect(sahipsiz).toBe(0);
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(d.bildirim(KIMLIK)).toEqual({ durum: 'gonderilemedi', hataSinifi: 'diger', zaman: SIMDI });
  });

  it('kuyruk `send` reddedip ardından sahte gönderici de reddedince olay tetiklenmez', async () => {
    gonder.mockRejectedValue(new Error('taşıyıcı reddetti'));
    const sahipsiz = await sahipsizRetSay(() => magazaBildirimIsteyici(() => ({ send: async () => { throw new Error('kuyruk'); } }), duzenek().D)(KIMLIK));
    expect(sahipsiz).toBe(0);
  });

  it('okuma, yazma ve yayın aynı anda fırlatsa da olay tetiklenmez', async () => {
    const d = duzenek(undefined, { yaz: async () => { throw new Error('yaz'); } }, { broadcastDocChange: () => { throw new Error('yayın'); } });
    expect(await sahipsizRetSay(() => magazaBildirimIsteyici(() => null, d.D)(KIMLIK))).toBe(0);
    const d2 = duzenek(undefined, { oku: async () => { throw new Error('oku'); } });
    expect(await sahipsizRetSay(() => magazaBildirimIsteyici(() => null, d2.D)(KIMLIK))).toBe(0);
  });

  it('süreç içi işlev (sözleşmesine aykırı) REDDETSE de olay tetiklenmez; söz reddetmez', async () => {
    // DÜZ işlev (vi.fn DEĞİL): vi.fn dönen söze sonuç kaydı için işleyici bağlar — ret zaten «sahipli» olur, test kör kalırdı.
    let cagri = 0;
    const isle = async (): Promise<unknown> => { cagri++; throw new Error('işle reddetti'); };
    const iste = magazaBildirimIsteyiciKur(() => null, duzenek().D, isle);
    let sonuc: unknown = 'bekliyor';
    const sahipsiz = await sahipsizRetSay(async () => { sonuc = await iste(KIMLIK).then(() => 'çözüldü', () => 'reddetti'); });
    expect(sonuc).toBe('çözüldü');
    expect(cagri).toBe(1);
    expect(sahipsiz).toBe(0);
  });

  it('KARŞI KONTROL: sayaç gerçekten sayıyor — yutulmayan bir ret 1 olarak görülür', async () => {
    let sayilan = -1;
    // vitest'in kendi işleyicisi BİLEREK üretilen bu reddi test hatası saymasın: ölçüm süresince kaldırılır, sonra geri takılır.
    const vitestDinleyicileri = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    try {
      sayilan = await sahipsizRetSay(async () => { void Promise.reject(new Error('bilerek sahipsiz')); });
    } finally {
      for (const dinleyici of vitestDinleyicileri) process.on('unhandledRejection', dinleyici);
    }
    expect(sayilan).toBe(1);
    expect(process.listeners('unhandledRejection')).toEqual(vitestDinleyicileri);
  });

  it('süreç içi işlev EŞZAMANLI fırlatsa da söz reddetmez', async () => {
    const isle = vi.fn((): Promise<unknown> => { throw new Error('eşzamanlı'); });
    await expect(magazaBildirimIsteyiciKur(() => null, duzenek().D, isle)(KIMLIK)).resolves.toBeUndefined();
    expect(isle).toHaveBeenCalledWith(KIMLIK, expect.anything());
  });

  it('üretim işlevi süreç içi yolda `magazaBildirimIsle`yi DENEME BİLGİSİ OLMADAN çağırır', async () => {
    // Deneme bilgisi sızsaydı başarısızlık `bekliyor` kalır, kimse yeniden denemezdi.
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await magazaBildirimIsteyici(() => null, d.D)(KIMLIK);
    await bekle();
    expect(d.bildirim(KIMLIK)).toMatchObject({ durum: 'gonderilemedi' });
    expect(d.bildirim(KIMLIK)).not.toHaveProperty('deneme');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ÇİT: kaynak taraması (yorumlar süzülür)', () => {
  const HAM = readFileSync(join(__dirname, 'magazaBildirim.ts'), 'utf-8');
  const SATIRLAR = yorumsuz(HAM);
  const KOD = SATIRLAR.join('\n');
  const suclular = (desen: RegExp): string[] => SATIRLAR.map((satir, i) => (desen.test(satir) ? `magazaBildirim.ts:${i + 1}: ${satir.trim()}` : '')).filter(Boolean);

  it('tarama gerçekten oldu: kod boş değil, yorumlar gerçekten süzüldü', () => {
    expect(KOD).toMatch(/export function magazaBildirimIcerigi/);
    expect(KOD.length).toBeLessThan(HAM.length);
    expect(KOD).not.toMatch(/BEŞ DEĞİŞMEZ/);
  });

  // Kişisel alanlar modülde HİÇ okunmaz (içerik testi fixture'a bağlıdır; çit alan ADINA bağlı).
  const KISISEL_ALAN = /\bmusteri\s*\??\.\s*(?:ad|firma|telefon|eposta|adres|vergi)\b|\btelefonSon10\b|\.\s*not\b|\bistemciTarihi\b|\.\s*(?:firma|telefon|eposta|adres|vergi)\b/;

  it('kişisel alan (musteri.ad / firma / telefon / eposta / adres / vergi, not, telefonSon10) kodda OKUNMAZ', () => {
    expect(suclular(KISISEL_ALAN), suclular(KISISEL_ALAN).join('\n')).toEqual([]);
  });

  it('kişisel alan deseni okuma biçimlerini yakalar, izinli alanları geçirir (negatif kontrol)', () => {
    for (const ihlal of ['talep.musteri.ad', 'talep.musteri?.telefon', 't.musteri.eposta', 'const { x } = talep.not;', 'talep.telefonSon10', 'm.adres', 'm.vergi', 'talep.musteri.firma']) {
      expect(KISISEL_ALAN.test(ihlal), ihlal).toBe(true);
    }
    for (const izinli of ['talep.musteri.il', 'k.ad', 'k.adet', 'yaDaTire(k.marka)', 'talep.talepNo', 'nesneMi(v.musteri)', 'talep.kalemler.length']) {
      expect(KISISEL_ALAN.test(izinli), izinli).toBe(false);
    }
  });

  it('günlüğe hata NESNESİ / iletisi yazılmaz: console satırlarında yalnız sabit metin + kod / sınıf', () => {
    const konsolSatirlari = SATIRLAR.filter((s) => /console\./.test(s));
    expect(konsolSatirlari.length).toBeGreaterThan(0);
    for (const satir of konsolSatirlari) {
      const kalan = satir.replace(/\$\{hataKodu\(hata\)\}/g, '').replace(/\$\{hataSinifi\}/g, '');
      expect(kalan, satir.trim()).not.toMatch(/\bhata\b|\be\b|\.message|\.stack|\$\{|talepId|belge|icerik/);
      expect(satir, satir.trim()).toMatch(/console\.warn\(/);
    }
  });

  it('fırlatılan TEK hata sabit iletili «yeniden dene» hatası', () => {
    expect(KOD.match(/\bthrow\b[^\n]*/g)).toEqual(['throw new Error(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);']);
  });

  it('kuyruğa giden veri kaynakta da yalnız { talepId }', () => {
    expect(KOD.match(/\.send\([^\n]*/g)).toHaveLength(1);
    expect(KOD).toMatch(/\.send\(MAGAZA_BILDIRIM_KUYRUGU, \{ talepId \}, MAGAZA_BILDIRIM_IS_SECENEKLERI\)/);
  });

  it('Resend yoluna dokunulmaz; server.ts içe aktarılmaz; gönderim yalnız smtpPosta üzerinden', () => {
    expect(KOD).not.toMatch(/resend/i);
    expect(KOD).not.toMatch(/from\s+['"][^'"]*\bserver(?:\.js|\.ts)?['"]/);
    expect(KOD).not.toMatch(/nodemailer|createTransport|fetch\(/);
    expect(KOD).toMatch(/import \{ smtpGonder, smtpHataSinifi \} from '\.\.\/smtpPosta\.js';/);
  });

  it('kaçış `escapeHtml` (eposta.ts) ile; opsWatchdog `esc` KULLANILMAZ', () => {
    expect(KOD).toMatch(/import \{ escapeHtml \} from '\.\.\/eposta\.js';/);
    expect(KOD).not.toMatch(/opsWatchdog|\besc\(/);
  });

  it('sessiz sıfır / uydurma varsayılan yok; ekrana basılan metinde büyük harfe çevirme yok', () => {
    expect(sertIhlalleri('magazaBildirim.ts', HAM)).toEqual([]);
    expect(suclular(/toUpperCase|toLocaleUpperCase|toLowerCase|toLocaleLowerCase/)).toEqual([]);
    expect(suclular(/\bisFinite\(/).filter((s) => !/Number\.isFinite\(/.test(s))).toEqual([]);
    expect(suclular(/\bas any\b|@ts-ignore|@ts-expect-error/)).toEqual([]);
  });

  it('denetim karakteri deseni kaynakta kaçışla yazılı (ham karakter yok)', () => {
    const hamDenetim = [...HAM].filter((c) => { const k = c.charCodeAt(0); return (k < 0x20 && c !== '\n') || (k >= 0x7f && k <= 0x9f) || k === 0x2028 || k === 0x2029 || k === 0x307; });
    expect(hamDenetim).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('magazaBildirimKacanlariKuyrukla — açılışta kaçan bildirimler (K6, 2026-10-09)', () => {
  const AN = Date.UTC(2026, 9, 9, 9, 0, 0);
  const KIMLIK_C = 'mt-0123456789abcdef0123456789abcdef';
  type Satir = { id: string; data: Record<string, unknown> };
  function kacanDuzenegi(satirlar: Satir[] | Error = [], o: { send?: (...a: unknown[]) => Promise<unknown> } = {}) {
    const sorgular: Array<{ sql: string; params: unknown[] }> = [];
    const havuz = { query: vi.fn(async (sql: string, params: unknown[]) => { sorgular.push({ sql, params }); if (satirlar instanceof Error) throw satirlar; return { rows: satirlar }; }) };
    const yayin = vi.fn();
    const D = { getPgPool: () => havuz, broadcastDocChange: yayin } as unknown as MagazaBildirimDeps;
    const send = vi.fn(o.send ?? (async () => 'is'));
    const dogrula = vi.fn(async () => ({ ok: true }) as const);
    const yapilandirma = vi.fn(() => ({ tamam: true }));
    const gunluk = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kos = (kuyruk: (() => { send: typeof send } | null) = () => ({ send })) =>
      magazaBildirimKacanlariKuyrukla(D, kuyruk, dogrula, yapilandirma, () => AN);
    return { sorgular, havuz, yayin, send, dogrula, yapilandirma, gunluk, kos };
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it('kuyruk hazır değilse HİÇ koşmaz: sorgu yok, sonda yok, süreç içi yola düşmez; tek satır günlük', async () => {
    const d = kacanDuzenegi([{ id: KIMLIK, data: { companyId: 'c1' } }]);
    await expect(d.kos(() => null)).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'kuyruk-hazir-degil' });
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(d.dogrula).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
    expect(d.gunluk).toHaveBeenCalledTimes(1);
  });

  it('yapılandırma tamam değilse koşmaz; teslim sondası geçmezse koşmaz (sınıf günlükte, talep yok)', async () => {
    const d = kacanDuzenegi([{ id: KIMLIK, data: { companyId: 'c1' } }]);
    d.yapilandirma.mockReturnValue({ tamam: false });
    await expect(d.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'yapilandirma' });
    expect(d.dogrula).not.toHaveBeenCalled();
    d.yapilandirma.mockReturnValue({ tamam: true });
    d.dogrula.mockResolvedValue({ ok: false, sinif: 'gonderen-reddi' } as never);
    await expect(d.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'teslim-sondasi' });
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(String(d.gunluk.mock.calls.at(-1)?.[0])).toContain('gonderen-reddi');
    expect(String(d.gunluk.mock.calls.at(-1)?.[0])).not.toContain(KIMLIK);
  });

  it('tek SQL ile sahiplenir (koleksiyon, şimdi, şimdi − 3 sa), kiracılı satırı yayınlar, her satırı iş seçenekleriyle kuyruğa alır; günlükte yalnız sayı', async () => {
    const d = kacanDuzenegi([
      { id: KIMLIK, data: { companyId: 'c1', talepNo: 'T261008-CZZF', musteri: { ad: 'Zeynep' }, bildirim: { durum: 'bekliyor', zaman: new Date(AN).toISOString() } } },
      { id: KIMLIK_B, data: { bildirim: { durum: 'bekliyor' } } },   // kiracı etiketi yok → YAYINLANMAZ ama kuyruğa alınır
    ]);
    await expect(d.kos()).resolves.toEqual({ alinan: 2, kuyrukta: 2 });
    expect(d.sorgular).toEqual([{ sql: MAGAZA_KACAN_SAHIPLEN_SQL, params: ['magazaTalepleri', new Date(AN).toISOString(), new Date(AN - MAGAZA_KACAN_YETIM_ESIGI_MS).toISOString()] }]);
    expect(d.yayin).toHaveBeenCalledTimes(1);
    expect(d.yayin).toHaveBeenCalledWith('magazaTalepleri', 'set', KIMLIK, expect.objectContaining({ companyId: 'c1' }), { cid: 'c1' });
    expect(d.send.mock.calls).toEqual([
      ['magaza-talep-bildirimi', { talepId: KIMLIK }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
      ['magaza-talep-bildirimi', { talepId: KIMLIK_B }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
    ]);
    const satirlar = d.gunluk.mock.calls.map(c => String(c[0]));
    expect(satirlar).toEqual(['[magaza-bildirim] kaçanlar: 2 talep sahiplenildi, 2 kuyruğa alındı']);
    expect(satirlar.join('\n')).not.toMatch(/Zeynep|T261008|mt-/);
    expect(gonder).not.toHaveBeenCalled();   // süreç içi gönderim YOK
  });

  it('send fırlatır ya da null döner → sayılmaz, süreç içi yola düşülmez, «kuyruğa alınamadı: N»; bozuk kimlikli satır atlanır', async () => {
    let n = 0;
    const d = kacanDuzenegi(
      [{ id: KIMLIK, data: { companyId: 'c1' } }, { id: KIMLIK_B, data: { companyId: 'c1' } }, { id: KIMLIK_C, data: { companyId: 'c1' } }, { id: 'bozuk', data: { companyId: 'c1' } }],
      { send: async () => { n += 1; if (n === 1) throw new Error('kuyruk kapalı'); return n === 2 ? null : 'is'; } },
    );
    await expect(d.kos()).resolves.toEqual({ alinan: 4, kuyrukta: 1 });
    expect(d.send).toHaveBeenCalledTimes(3);
    expect(String(d.gunluk.mock.calls.at(-1)?.[0])).toBe('[magaza-bildirim] kaçanlar: 4 talep sahiplenildi, 1 kuyruğa alındı, kuyruğa alınamadı: 3');
    expect(gonder).not.toHaveBeenCalled();
  });

  it('havuz yoksa / sorgu fırlatırsa / satır yoksa: fırlatmaz, neden döner, hata METNİ günlüğe girmez', async () => {
    const d1 = kacanDuzenegi([]);
    (d1 as unknown as { D: MagazaBildirimDeps }).D;
    await expect(magazaBildirimKacanlariKuyrukla({ getPgPool: () => null, broadcastDocChange: vi.fn() } as unknown as MagazaBildirimDeps, () => ({ send: d1.send }), d1.dogrula, d1.yapilandirma, () => AN))
      .resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'havuz-yok' });
    const d2 = kacanDuzenegi(Object.assign(new Error(`relation docs: ${KIMLIK} Zeynep`), { code: '42P01' }));
    await expect(d2.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'sorgu' });
    expect(String(d2.gunluk.mock.calls.at(-1)?.[0])).toBe('[magaza-bildirim] kaçanlar: sorgu başarısız (kod: 42P01)');
    const d3 = kacanDuzenegi([]);
    d3.gunluk.mockClear();   // aynı console casusu (vi.spyOn aynı yönteme ikinci kez sarmaz)
    await expect(d3.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0 });
    expect(d3.send).not.toHaveBeenCalled();
    expect(d3.gunluk).not.toHaveBeenCalled();   // alınan yoksa gürültü yok
  });

  it('SQL çiti: yalnız yapılandırılmamış ve 3 saatten eski bekliyor; en yeni önce; LIMIT 50; SKIP LOCKED; bildirim alanı jsonb_set ile bekliyor; gitti HİÇ seçilmez', () => {
    expect(MAGAZA_KACAN_SINIRI).toBe(50);
    expect(MAGAZA_KACAN_YETIM_ESIGI_MS).toBe(3 * 60 * 60 * 1000);
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("data->'bildirim'->>'durum' = 'yapilandirilmamis'");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("data->'bildirim'->>'durum' = 'bekliyor'");
    // `deneme` yazılmış bekliyor canlı kuyruk işidir (PG'de durur, süreç ölse de sürer): yetim sayılmaz, ikinci iş açılmaz.
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("AND NOT (data->'bildirim' ? 'deneme')");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("(data->'bildirim'->>'zaman') COLLATE \"C\" < $3");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("ORDER BY (data->>'olusturma') COLLATE \"C\" DESC");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain('LIMIT 50');
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain('FOR UPDATE SKIP LOCKED');
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("jsonb_set(d.data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $2::text))");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain('RETURNING d.id, d.data');
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).not.toContain("'gitti'");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).not.toContain("'gonderilemedi'");
  });
});
