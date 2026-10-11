// @vitest-environment node
/**
 * magazaBildirim.revize.test.ts — REVİZE bildirimi (dilim 2b; şartname v6 § 10.2 (e), § 10.7, § 10.8).
 *
 * İçerik revizyonu (`talepIcerigiDegistir` tamam) ilk bildirimden AYRI bir e-posta üretir: ayrı alan (`bildirimRevize`),
 * ayrı kuyruk (`MAGAZA_REVIZE_KUYRUGU`), aynı işçi iskeleti. Bu dosya SAHTE havuz + SAHTE göndericiyle dört katmanı sınar:
 *  1) içerik (`magazaRevizeIcerigi`): konu «Mağaza talebi revize edildi · <talepNo>», gövdede YALNIZ değişen alan ADLARI +
 *     revize eden + revize zamanı + ERP bağlantısı — müşteri verisi, kalem, adet, fiyat, tutar, KDV YOK (dilim 1'in beş
 *     değişmezi; sahte belgedeki HER değer gövdede aranır);
 *  2) tek talep (`magazaRevizeBildirimIsle`): DAR okuma, yalnız `bekliyor` gönderilir, dört sonuç, yazım okunan
 *     `icerikSurum` ile koşullu, nesne bütünüyle DEĞİŞTİRİLMEZ, 0 satırda yeni iş YOK;
 *  3) kuyruk: işçi, isteyici (`revizeBildirimiIste`'nin gerçekleştirimi) ve açılıştaki kaçan süpürmesi;
 *  4) kaynak çitleri: kuyruk sabiti, `REVIZE_YAZ_SQL` ve `MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL` metni (parantezli
 *     `(…->'bildirimRevize') || …`; tam değiştirme YOK), işçi bağlamında kuyruk üyesi YOK.
 * SQL'lerin ANLAMI gerçek motorda: `magazaBildirim.pglite.test.ts`. Sahiplenme anahtarı (`talepId|revize`):
 * `magazaBildirim.sahiplenme.test.ts`. Gerçek ağa / posta sunucusuna çıkış YOK.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkWithMetadataHandler } from 'pg-boss';
import { yorumsuz } from '../../test/degismezTarayici';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_REVIZE_ALANLARI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import type { MagazaTalebi } from '../../lib/magazaTalep';

// Gönderici sahte: bu dosyada SMTP bağlantısı HİÇ açılmaz. `smtpHataSinifi` gerçek kalır.
vi.mock('../smtpPosta', async (asliniGetir) => {
  const asil = await asliniGetir<typeof import('../smtpPosta')>();
  return { ...asil, smtpGonder: vi.fn() };
});

import { smtpGonder } from '../smtpPosta';
import { BILDIRIM_REVIZE_YENIDEN_SQL } from './magazaDurum';
import {
  KALICI_HATA_SINIFLARI, MAGAZA_BILDIRIM_IS_SECENEKLERI, MAGAZA_BILDIRIM_KUYRUGU, MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI,
  MAGAZA_KACAN_SAHIPLEN_SQL, MAGAZA_KACAN_SINIRI, MAGAZA_KACAN_YETIM_ESIGI_MS, MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL, MAGAZA_REVIZE_KUYRUGU,
  REVIZE_OKU_SQL, REVIZE_YAZ_SQL,
  magazaBildirimIsteyici, magazaRevizeBildirimIscisi, magazaRevizeBildirimIsle, magazaRevizeBildirimIsteyici, magazaRevizeBildirimIsteyiciKur,
  magazaRevizeIcerigi, magazaRevizeKacanlariKuyrukla,
} from './magazaBildirim';
import type { MagazaBildirimDeps, MagazaRevizeIcerikGirdisi } from './magazaBildirim';

const gonder = vi.mocked(smtpGonder);

// ── Derleme düzeyi kanıt (tsc) ───────────────────────────────────────────────────────────────────────────────────────
type Esit<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
// İçerik işlevinin girdisi DAR: müşteri bloğu, kalemler, teyit ya da tutar alanı tipte YOK (işlev onlara erişemez — derlenmez).
const _icerikGirdisiDar: Esit<keyof MagazaRevizeIcerikGirdisi, 'talepNo' | 'icerikZamani' | 'bildirimRevize'> = true;
// İşçi bağlamında KUYRUK üyesi yok (§ 10.8 çiti; kapı 3, K9): işçi hiçbir koşulda iş GÖNDEREMEZ.
const _iscideKuyrukYok: Esit<keyof MagazaBildirimDeps, 'getPgPool' | 'broadcastDocChange' | 'appUrl' | 'simdi'> = true;
// Revize işçisi de meta verili pg-boss işleyicisidir (ilk kuyruğun işçisiyle aynı imza).
const _isciTipi: WorkWithMetadataHandler<object, void> = magazaRevizeBildirimIscisi({ getPgPool: () => null, broadcastDocChange: () => {} });
// Tam belge içerik işlevine `as`sız geçer (dar tip, geniş değeri kabul eder — işlev yine yalnız üç alanı görür).
const _tamBelgeGecer = (t: MagazaTalebi): MagazaRevizeIcerikGirdisi => t;
void [_icerikGirdisiDar, _iscideKuyrukYok, _isciTipi, _tamBelgeGecer];

// ── Düzenek ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const KIMLIK = 'mt-0123456789abcdef0123456789abcdef';
const KIMLIK_B = 'mt-fedcba9876543210fedcba9876543210';
const KIRACI = 'kiraci-GIZLI-cid';
const SIMDI = '2026-10-10T09:15:00.000Z';
const ERP_ADRESI = 'https://app.cetpa.com.tr/orders?kaynak=magaza';
type Satir = Record<string, unknown>;

const REVIZE = { durum: 'bekliyor', zaman: '2026-10-10T08:41:07.000Z', alanlar: ['musteri', 'not', 'teyit'], kim: { uid: 'u-gizli-uid', ad: 'Ayşe Yılmaz' }, icerikSurum: 3 };

/**
 * Baştan sona DOLU sahte belge: ayırt edici müşteri verisi, beyan kalemleri, teyit kalemleri ve tutarlar. İçerik testi bu
 * belgedeki HER değeri gövdede arar; hiçbiri geçmemelidir. Sayılar tarih / talep no ile çakışmayacak biçimde seçildi.
 */
function tamBelge(ek: Satir = {}): Satir {
  return {
    companyId: KIRACI, talepNo: 'T261010-AB12', durum: 'teyit', durumSurum: 2,
    olusturma: '2026-10-08T10:40:00.000Z', istemciTarihi: '2026-10-08T10:39:58.000Z',
    icerikZamani: '2026-10-10T08:41:07.000Z', icerikSurum: 3,
    musteri: {
      ad: 'Zeynep Gizliad Şahin', firma: 'Gizlifirma Yapı Ltd.', telefon: '0532 111 22 33', eposta: 'gizli.musteri@musteri-alani.test',
      il: 'Balıkesir', adres: 'Gizlisokak No: 7 Kadıköy', vergi: '9876543210',
    },
    telefonSon10: '5321112233',
    not: 'Gizlinot: öğleden sonra arayın',
    kalemler: [
      { id: 'urun-gizli-id-1', sku: 'DYO-4821', ad: 'Dış Cephe Boyası 15 L', marka: 'Markagizli', adet: 739, talepFiyat: 204.93, tedarik: false },
    ],
    talepEdilen: { araToplam: 5297.31, kdv: 1059.46, toplam: 6356.77 },
    teyit: {
      kalemler: [{ anahtar: 't:0123456789ab', id: 'teyit-gizli-id', sku: 'IZF-7719', ad: 'Rulo Fırça Çıtası', marka: 'Teyitmarka', adet: 847, birimFiyat: 913.27, kdvOrani: 10, kdvKaynagi: 'personel', tedarik: true }],
      araToplam: 773539.69, kdv: 77353.97, toplam: 850893.66,
      zaman: '2026-10-10T08:41:07.000Z', kim: { uid: 'u-teyit-uid', ad: 'Teyiteden Gizlikişi' },
    },
    bildirim: { durum: 'gitti', zaman: '2026-10-08T10:40:05.000Z' },
    bildirimRevize: structuredClone(REVIZE),
    ...ek,
  };
}
/** E-postaya GİRMEMESİ gereken her şey (sahte belgenin ayırt edici parçaları; sayılar hem ham hem Türkçe biçimiyle). */
const YASAK = [
  'Zeynep', 'Gizliad', 'Şahin', 'Gizlifirma', '0532', '111 22 33', '5321112233', 'gizli.musteri', 'musteri-alani', 'Balıkesir',
  'Gizlisokak', 'Kadıköy', '9876543210', 'Gizlinot', 'öğleden',
  'urun-gizli-id', 'DYO-4821', 'Dış Cephe', 'Markagizli', '739', '204,93', '204.93', '5297', '5.297', '1059', '1.059', '6356', '6.356',
  't:0123456789ab', 'teyit-gizli-id', 'IZF-7719', 'Rulo Fırça', 'Teyitmarka', '847', '913', '773539', '773.539', '77353', '77.353', '850893', '850.893',
  'Teyiteden', 'Gizlikişi', 'u-teyit-uid', 'u-gizli-uid', KIRACI, 'personel',
];

interface Sorgu { sql: string; params: unknown[] }
type SahteSonuc = { rows: Satir[] };
const nesne = (v: unknown): v is Satir => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `docs` satırının sahtesi — YALNIZ revize işçisinin iki sorgusunu tanır (`REVIZE_OKU_SQL`, `REVIZE_YAZ_SQL`); başka her
 * metin FIRLATIR (işçi ilk bildirimin sorgularını kullanırsa test görünür biçimde düşer). Yazım koşulları sorgunun
 * WHERE'i gibi uygulanır: alan nesne + durum `gitti` değil + sürüm `$4`'e eşit; yama `||` gibi SIĞ birleştirilir.
 */
function sahteHavuz(belge: Satir | null, o: { oku?: () => Promise<SahteSonuc>; yaz?: () => Promise<SahteSonuc>; yazmadanOnce?: (b: Satir) => void } = {}) {
  const b = belge === null ? null : structuredClone(belge);
  const sorgular: Sorgu[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<SahteSonuc> => {
    sorgular.push({ sql, params });
    if (sql === REVIZE_OKU_SQL) {
      if (o.oku) return o.oku();
      return { rows: b === null ? [] : [{ talep_no: b.talepNo, icerik_zamani: b.icerikZamani, revize: structuredClone(b.bildirimRevize) }] };
    }
    if (sql === REVIZE_YAZ_SQL) {
      if (o.yaz) return o.yaz();
      if (b === null) return { rows: [] };
      o.yazmadanOnce?.(b);
      const r = b.bildirimRevize;
      if (!nesne(r) || r.durum === 'gitti' || r.icerikSurum !== params[3]) return { rows: [] };
      b.bildirimRevize = { ...r, ...(JSON.parse(String(params[2])) as Satir) };
      return { rows: [{ data: structuredClone(b) }] };
    }
    throw Object.assign(new Error('beklenmeyen SQL'), { code: 'XX000' });
  });
  return { havuz: { query }, sorgular, belge: (): Satir | null => b, revize: (): unknown => b?.bildirimRevize };
}

function duzenek(belge: Satir | null = tamBelge(), o: Parameters<typeof sahteHavuz>[1] = {}, ek: Partial<MagazaBildirimDeps> = {}) {
  const h = sahteHavuz(belge, o);
  const yayin = vi.fn<MagazaBildirimDeps['broadcastDocChange']>();
  const D: MagazaBildirimDeps = { getPgPool: () => h.havuz, broadcastDocChange: yayin, appUrl: () => 'https://app.cetpa.com.tr', simdi: () => new Date(SIMDI), ...ek };
  const okunan = (): Sorgu[] => h.sorgular.filter((s) => s.sql === REVIZE_OKU_SQL);
  const yazilan = (): Sorgu[] => h.sorgular.filter((s) => s.sql === REVIZE_YAZ_SQL);
  /** Yazılan yamalar (`$3`), sırayla. */
  const yamalar = (): Satir[] => yazilan().map((s) => JSON.parse(String(s.params[2])) as Satir);
  return { ...h, yayin, D, okunan, yazilan, yamalar };
}

const KONSOL = ['log', 'info', 'warn', 'error', 'debug'] as const;
let konsolCasuslari: Array<{ mock: { calls: unknown[][] }; mockRestore: () => void }> = [];
const konsolMetni = (): string => konsolCasuslari.flatMap((c) => c.mock.calls)
  .map((cagri) => cagri.map((a) => (a instanceof Error ? `${a.message} ${JSON.stringify({ ...a })}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');
const bekle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  gonder.mockReset();
  gonder.mockResolvedValue({ ok: true });
  konsolCasuslari = KONSOL.map((ad) => vi.spyOn(console, ad).mockImplementation(() => {}));
});
afterEach(() => { for (const c of konsolCasuslari) c.mockRestore(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaRevizeIcerigi — ne var', () => {
  it('düz metin: konu, İstanbul saatiyle revize zamanı, revize eden, değişen alan ADLARI, yönlendirme, ERP bağlantısı — satır satır', () => {
    const { konu, metin } = magazaRevizeIcerigi(tamBelge(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(konu).toBe('Mağaza talebi revize edildi · T261010-AB12');
    expect(metin.split('\n')).toEqual([
      'Mağaza talebi revize edildi · T261010-AB12',
      'Revize zamanı: 10.10.2026 11:41 (İstanbul saati)',   // 08:41 UTC = 11:41 İstanbul
      'Revize eden: Ayşe Yılmaz',
      '',
      'Değişen alanlar: Müşteri bilgileri, Not, Teyit edilen kalemler',
      '',
      "Müşteri bilgileri, kalemler ve tutarlar bu e-postada yer almaz. Talebin güncel hâli ERP'de: Siparişler → Mağaza Talepleri.",
      ERP_ADRESI,
    ]);
  });

  it('HTML: Türkçe dil niteliği, başlıkta konu, alan adları liste öğesi, modülün yazdığı TEK bağlantı ERP adresi', () => {
    const { html } = magazaRevizeIcerigi(tamBelge(), { appUrl: 'https://app.cetpa.com.tr' });
    expect(html.startsWith('<div lang="tr" ')).toBe(true);
    expect(html).toContain('<h2 style="margin:0 0 4px">Mağaza talebi revize edildi · T261010-AB12</h2>');
    expect(html).toContain('Revize zamanı: 10.10.2026 11:41 (İstanbul saati) · Revize eden: Ayşe Yılmaz');
    expect(html).toContain('<li>Müşteri bilgileri</li><li>Not</li><li>Teyit edilen kalemler</li>');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`<a href="${ERP_ADRESI.replace('&', '&amp;')}">`);
  });

  it.each([
    [['not'], 'Not'],
    [['teyit'], 'Teyit edilen kalemler'],
    [['musteri'], 'Müşteri bilgileri'],
    [['teyit', 'musteri'], 'Teyit edilen kalemler, Müşteri bilgileri'],                 // ilk görülme sırası (yazım sırası)
    [['not', 'not', 'teyit', 'not'], 'Not, Teyit edilen kalemler'],                      // SQL birleştirmesi yinelenen ad bırakabilir: okuyucu tekilleştirir
    [['not', 'kalemler', 'talepEdilen', 7, null, 'teyit'], 'Not, Teyit edilen kalemler'], // kapalı kümede olmayan ad DÜŞER
  ] as const)('alan adları `alanlariBirlestir` ile: %j → «%s»', (alanlar, beklenen) => {
    const { metin, html } = magazaRevizeIcerigi(tamBelge({ bildirimRevize: { ...REVIZE, alanlar } }), {});
    expect(metin).toContain(`Değişen alanlar: ${beklenen}`);
    expect((html.match(/<li>/g) ?? []).length).toBe(beklenen.split(', ').length);
  });

  it('üç alan adının etiketi kapalı kümeyle BİREBİR (yeni bir alan adı etiketsiz kalamaz)', () => {
    expect([...MAGAZA_REVIZE_ALANLARI].sort()).toEqual(['musteri', 'not', 'teyit']);
    const { metin } = magazaRevizeIcerigi(tamBelge({ bildirimRevize: { ...REVIZE, alanlar: [...MAGAZA_REVIZE_ALANLARI] } }), {});
    expect(metin).toContain('Değişen alanlar: Müşteri bilgileri, Not, Teyit edilen kalemler');
    expect(metin).not.toContain('undefined');
  });

  it.each([
    ['dizge', 'not'], ['nesne', { not: true }], ['boş dizi', []], ['yalnız bilinmeyen adlar', ['x', 'kalemler']], ['yok', undefined], ['null', null],
  ] as const)('alan adı okunamıyorsa (%s) «—» basılır: «hiçbir şey değişmedi» DENMEZ, alan adı UYDURULMAZ', (_ad, alanlar) => {
    const { metin, html } = magazaRevizeIcerigi(tamBelge({ bildirimRevize: { ...REVIZE, alanlar } }), {});
    expect(metin).toContain('Değişen alanlar: —');
    expect(html).not.toContain('<li>');
    expect(html).toContain('<p style="margin:0">—</p>');
  });

  it('revize zamanı `icerikZamani`dır — `bildirimRevize.zaman` DEĞİL (onu işçi her yeniden denemede, «Yeniden gönder» her tıklamada tazeler)', () => {
    const { metin } = magazaRevizeIcerigi(tamBelge({ icerikZamani: '2026-10-09T21:30:00.000Z', bildirimRevize: { ...REVIZE, zaman: '2026-10-10T09:14:00.000Z' } }), {});
    expect(metin).toContain('Revize zamanı: 10.10.2026 00:30 (İstanbul saati)');   // 21:30 UTC = ertesi gün 00:30 İstanbul
    expect(metin).not.toContain('12:14');
  });

  it.each([['yok', undefined], ['sayı', 1760085667000], ['zaman olmayan metin', 'dün'], ['null', null]] as const)(
    'revize zamanı okunamıyorsa (%s) «—» (uydurma saat yok; «İstanbul saati» eki de basılmaz)', (_ad, icerikZamani) => {
      const { metin } = magazaRevizeIcerigi(tamBelge({ icerikZamani }), {});
      expect(metin).toContain('Revize zamanı: —\n');
      expect(metin).not.toContain('İstanbul');
    });

  it('`bildirimRevize` hiç yoksa / nesne değilse işlev FIRLATMAZ: alanlar ve revize eden «—»', () => {
    for (const bildirimRevize of [undefined, null, 'çöp', ['not'], 7]) {
      const girdi: unknown = tamBelge({ bildirimRevize });
      const { metin } = magazaRevizeIcerigi(girdi as MagazaRevizeIcerikGirdisi, {});
      expect(metin, JSON.stringify(bildirimRevize)).toContain('Değişen alanlar: —');
      expect(metin).toContain('Revize eden: —');
    }
  });
});

describe('magazaRevizeIcerigi — konu satırı: TEK biçim, ayraç «·» (kapı 3, K4); yalnız DOĞRULANMIŞ talep no', () => {
  it('doğrulanmış talep no → «Mağaza talebi revize edildi · <talepNo>»; iki nokta üst üste ayraçlı biçim YOK', () => {
    const { konu, html, metin } = magazaRevizeIcerigi(tamBelge(), {});
    expect(konu).toBe('Mağaza talebi revize edildi · T261010-AB12');
    for (const parca of [konu, html, metin]) expect(parca).not.toContain('revize edildi:');
  });

  it.each([
    ['yok', undefined], ['boş', ''], ['desene uymuyor', 'T261010-ab12'], ['satır sonlu', 'T261010-AB12\r\nBcc: kotu@example.com'],
    ['betik', '<script>alert(1)</script>'], ['sayı', 261010], ['fazladan metin', 'T261010-AB12 Zeynep'],
  ] as const)('talep no doğrulanamazsa (%s) ayraçsız kısa konu; değer HİÇBİR yere basılmaz', (_ad, talepNo) => {
    const { konu, html, metin } = magazaRevizeIcerigi(tamBelge({ talepNo }), {});
    expect(konu).toBe('Mağaza talebi revize edildi');
    for (const parca of [html, metin]) {
      expect(parca).not.toContain('·  ');
      expect(parca).not.toMatch(/Bcc|script|Zeynep|261010/);
    }
  });
});

describe('magazaRevizeIcerigi — müşteri verisi, kalem, adet, fiyat, tutar, KDV YOK (dilim 1 gövde kuralı; § 10.8 çiti)', () => {
  const tum = (b: Satir): string => { const i = magazaRevizeIcerigi(b, { appUrl: 'https://app.cetpa.com.tr' }); return `${i.konu}\n${i.html}\n${i.metin}`; };

  it('sahte belgenin ayırt edici parçalarından HİÇBİRİ konuda / HTML\'de / düz metinde geçmez', () => {
    const metin = tum(tamBelge());
    for (const parca of YASAK) expect(metin, parca).not.toContain(parca);
  });

  it('belgedeki HER yaprak değer aranır (müşteri bloğu, not, beyan kalemleri, talep edilen toplamlar, teyit): hiçbiri geçmez', () => {
    const b = tamBelge();
    const metin = tum(b);
    const yapraklar: Array<string | number> = [];
    const gez = (v: unknown): void => {
      if (typeof v === 'string' || typeof v === 'number') yapraklar.push(v);
      else if (Array.isArray(v)) v.forEach(gez);
      else if (nesne(v)) Object.values(v).forEach(gez);
    };
    for (const alan of ['musteri', 'telefonSon10', 'not', 'kalemler', 'talepEdilen', 'teyit', 'istemciTarihi', 'companyId'] as const) gez(b[alan]);
    // Kısa değerler tarih / talep no ile rastlantıyla çakışır (ör. KDV oranı 10 ↔ «10.10.2026»): onlar aşağıdaki desen çitinde.
    const aranan = yapraklar.filter((v) => (typeof v === 'number' ? v >= 100 : v.length >= 4));
    expect(aranan.length).toBeGreaterThan(25);
    for (const v of aranan) {
      const bicimler = typeof v === 'number' ? [String(v), v.toLocaleString('tr-TR'), v.toLocaleString('tr-TR', { minimumFractionDigits: 2 }), String(Math.trunc(v))] : [v];
      for (const bicim of bicimler) expect(metin, `${typeof v}: ${bicim}`).not.toContain(bicim);
    }
  });

  it('gövdede para / adet / oran biçimi HİÇ yok: «₺», «TL», «%», «adet», «KDV», «toplam», «fiyat» sözcükleri ve tablo', () => {
    const metin = tum(tamBelge());
    expect(metin).not.toMatch(/₺|\bTL\b|%|\badet\b|\bKDV\b|[Tt]oplam|[Ff]iyat|<table|<td|<th/);
    // Sabit yönlendirme cümlesi «kalemler ve tutarlar … yer almaz» der: sözcük VAR, değer YOK.
    expect(metin).toContain('Müşteri bilgileri, kalemler ve tutarlar bu e-postada yer almaz.');
  });

  it('içerik belgenin GERİ KALANINA bağlı değil: müşteri / kalem / teyit / tutar bambaşka olsa da ileti BAYT BAYT aynı', () => {
    const a = magazaRevizeIcerigi(tamBelge(), { appUrl: 'https://app.cetpa.com.tr' });
    const b = magazaRevizeIcerigi(tamBelge({
      musteri: { ad: 'Başka Kişi', firma: '', telefon: '0555 000 00 00', eposta: '', il: 'Antalya', adres: '', vergi: '' }, not: 'başka not', telefonSon10: '5550000000',
      kalemler: [], talepEdilen: { araToplam: null, kdv: null, toplam: null }, teyit: undefined, durum: 'iptal', companyId: 'başka-kiracı',
    }), { appUrl: 'https://app.cetpa.com.tr' });
    expect(b).toEqual(a);
    // Yalnız üç alanla (işçinin dar okumasının verdiği kadarıyla) da aynı ileti çıkar.
    expect(magazaRevizeIcerigi({ talepNo: 'T261010-AB12', icerikZamani: '2026-10-10T08:41:07.000Z', bildirimRevize: REVIZE }, { appUrl: 'https://app.cetpa.com.tr' })).toEqual(a);
  });

  it('`bildirimRevize`den yalnız `alanlar` ve `kim.ad` okunur: `kim.uid`, `icerikSurum`, `deneme`, `hataSinifi`, `zaman` gövdeye girmez', () => {
    const metin = tum(tamBelge({ bildirimRevize: { ...REVIZE, icerikSurum: 48211, deneme: 77123, hataSinifi: 'gonderen-reddi', zaman: '2031-03-04T05:06:07.000Z' } }));
    for (const parca of ['u-gizli-uid', '48211', '77123', 'gonderen-reddi', '2031', '05:06', '08:06']) expect(metin, parca).not.toContain(parca);
  });
});

describe('magazaRevizeIcerigi — revize edenin adı kullanıcının KENDİ yazabildiği alandır: kaçışla, bağlantıya çevrilmeden', () => {
  const adla = (ad: unknown) => magazaRevizeIcerigi(tamBelge({ bildirimRevize: { ...REVIZE, kim: { uid: 'u1', ad } } }), { appUrl: 'https://app.cetpa.com.tr' });

  it('`<a href>` içeren ad HAM geçmez: HTML\'de kaçışlı, adres tetikleyicisi kırık; modülün yazdığı tek bağlantı yine ERP adresi', () => {
    const { html, metin } = adla('<a href="https://kotu.example/x">Tıkla</a> & <b>Ayşe</b>');
    expect(html).not.toContain('<a href="https://kotu');
    expect(html).not.toContain('<b>Ayşe</b>');
    expect(html).toContain('&lt;a href=&quot;https[:]//kotu.example/x&quot;&gt;Tıkla&lt;/a&gt; &amp; &lt;b&gt;Ayşe&lt;/b&gt;');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.match(/href="/g)).toHaveLength(1);
    // Düz metin bölümünde de adres tetikleyicisi kırık (posta istemcisi kendiliğinden bağlamasın).
    expect(metin).toContain('Revize eden: <a href="https[:]//kotu.example/x">Tıkla</a> & <b>Ayşe</b>');
    expect(metin).not.toContain('https://kotu');
  });

  it.each([
    ['şemalı adres', 'bkz https://kotu.example', 'bkz https[:]//kotu.example'],
    ['www', 'www.kotu.example Ayşe', 'www[.]kotu.example Ayşe'],
    ['e-posta', 'ayse@kotu.example', 'ayse[at]kotu.example'],
  ] as const)('adres tetikleyicisi kırılır (%s)', (_ad, ham, beklenen) => {
    const { metin, html } = adla(ham);
    expect(metin).toContain(`Revize eden: ${beklenen}`);
    expect(html).not.toContain(ham);
  });

  it('satır sonu / denetim karakteri tek satıra iner: ad, gövdeye sahte satır («Değişen alanlar: …») EKLEYEMEZ', () => {
    const { metin } = adla('Ayşe\r\nDeğişen alanlar: Hepsi Bcc: x');
    expect(metin).toContain('Revize eden: Ayşe Değişen alanlar: Hepsi Bcc: x');
    expect(metin.split('\n').filter((s) => s.startsWith('Değişen alanlar:'))).toEqual(['Değişen alanlar: Müşteri bilgileri, Not, Teyit edilen kalemler']);
  });

  it.each([['yok', undefined], ['boş', ''], ['yalnız boşluk', '   '], ['sayı', 42], ['nesne', { ad: 'x' }], ['null', null]] as const)(
    'ad okunamıyorsa (%s) «—» (uid ya da e-posta ile DOLDURULMAZ)', (_ad, ad) => {
      const { metin } = adla(ad);
      expect(metin).toContain('Revize eden: —\n');
      expect(metin).not.toContain('u1');
    });

  it('`kim` nesne değilse de «—»', () => {
    for (const kim of [undefined, null, 'Ayşe', ['Ayşe']]) {
      expect(magazaRevizeIcerigi(tamBelge({ bildirimRevize: { ...REVIZE, kim } }), {}).metin).toContain('Revize eden: —\n');
    }
  });
});

describe('magazaRevizeIcerigi — ERP bağlantısı (ilk bildirimle AYNI kural, aynı yardımcı)', () => {
  it.each([
    ['yok', undefined], ['boş', ''], ['http', 'http://app.cetpa.com.tr'], ['çözülemez', 'app cetpa'], ['kimlik bilgili', 'https://kullanici:parola@app.cetpa.com.tr'],
  ] as const)('APP_URL %s → bağlantı KONMAZ (HTML\'de `<a>` yok, düz metinde adres yok)', (_ad, appUrl) => {
    const { html, metin } = magazaRevizeIcerigi(tamBelge(), { appUrl });
    expect(html).not.toContain('<a ');
    expect(metin).not.toMatch(/https?:/);
    expect(`${html}${metin}`).not.toMatch(/parola|kullanici/);
  });

  it('bağlantı talep no / kişisel veri taşımaz: sabit yol `/orders?kaynak=magaza`', () => {
    const { metin } = magazaRevizeIcerigi(tamBelge(), { appUrl: 'https://app.cetpa.com.tr/herhangi/yol?x=1' });
    expect(metin.split('\n').at(-1)).toBe(ERP_ADRESI);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('magazaRevizeBildirimIsle — başarılı gönderim', () => {
  it('DAR oku → gönder → `REVIZE_YAZ_SQL` ile `gitti` (okunan sürümle) → kiracı etiketiyle yayınla', async () => {
    const d = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(d.sorgular.map((s) => s.sql)).toEqual([REVIZE_OKU_SQL, REVIZE_YAZ_SQL]);
    expect(d.okunan()[0].params).toEqual([MAGAZA_TALEP_KOLEKSIYONU, KIMLIK]);
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(gonder.mock.calls[0][0].konu).toBe('Mağaza talebi revize edildi · T261010-AB12');
    expect(d.yazilan()[0].params).toEqual([MAGAZA_TALEP_KOLEKSIYONU, KIMLIK, JSON.stringify({ durum: 'gitti', zaman: SIMDI }), 3]);
    // `||` sığ birleştirdi: durum + zaman değişti, `alanlar` / `kim` / `icerikSurum` AYNEN.
    expect(d.revize()).toEqual({ ...REVIZE, durum: 'gitti', zaman: SIMDI });
    expect(d.yayin).toHaveBeenCalledTimes(1);
    expect(d.yayin).toHaveBeenCalledWith(MAGAZA_TALEP_KOLEKSIYONU, 'set', KIMLIK, expect.objectContaining({ companyId: KIRACI }), { cid: KIRACI });
    expect(konsolMetni()).toBe('');
  });

  it('gönderilen iletide müşteri verisi YOK (işçi yolu): sahte belgenin yasak parçalarından hiçbiri göndericiye gitmez', async () => {
    const d = duzenek();
    await magazaRevizeBildirimIsle(KIMLIK, d.D);
    const ileti = gonder.mock.calls[0][0];
    const metin = `${ileti.konu}\n${ileti.html}\n${ileti.metin}`;
    for (const parca of YASAK) expect(metin, parca).not.toContain(parca);
    expect(Object.keys(ileti).sort()).toEqual(['html', 'konu', 'metin']);   // alıcı / gönderen sunucu yapılandırmasındandır, işçi vermez
  });

  it('okuma DAR: SELECT yalnız talep no, revizyon zamanı ve `bildirimRevize` — `data` bütünüyle, müşteri, kalem, teyit, tutar ÇEKİLMEZ', () => {
    expect(REVIZE_OKU_SQL).toBe("SELECT data->>'talepNo' AS talep_no, data->>'icerikZamani' AS icerik_zamani, data->'bildirimRevize' AS revize FROM docs WHERE coll = $1 AND id = $2");
    expect(REVIZE_OKU_SQL).not.toMatch(/SELECT data\b(?!->)/);
    for (const alan of ['musteri', 'kalemler', 'teyit', 'talepEdilen', 'not', 'telefonSon10']) expect(REVIZE_OKU_SQL, alan).not.toContain(alan);
  });

  it('ilk bildirim alanına DOKUNULMAZ: `bildirim` yazımı yok (ilk bildirimin `gitti`si revizeyi engellemez, revize onu ezmez)', async () => {
    const d = duzenek(tamBelge({ bildirim: { durum: 'gonderilemedi', zaman: 'z', hataSinifi: 'tls' } }));
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('gitti');
    expect(d.belge()?.bildirim).toEqual({ durum: 'gonderilemedi', zaman: 'z', hataSinifi: 'tls' });
    expect(d.sorgular.filter((s) => s.sql.includes("'{bildirim}'"))).toEqual([]);
  });

  it('yama (`$3`) YALNIZ işçinin dört gövdesindeki anahtarları taşır: `alanlar` / `kim` / `icerikSurum` yamaya GİRMEZ (girse eskisini ezerdi)', async () => {
    const senaryolar: Array<() => void> = [
      () => gonder.mockResolvedValue({ ok: true }),
      () => gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true }),
      () => gonder.mockResolvedValue({ ok: false, sinif: 'kimlik' }),
      () => gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' }),
    ];
    for (const kur of senaryolar) {
      kur();
      const d = duzenek();
      await magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false });
      const [yama] = d.yamalar();
      for (const anahtar of Object.keys(yama)) expect(['durum', 'zaman', 'deneme', 'hataSinifi']).toContain(anahtar);
      expect(d.revize()).toMatchObject({ alanlar: REVIZE.alanlar, kim: REVIZE.kim, icerikSurum: 3 });
    }
  });
});

describe('magazaRevizeBildirimIsle — dilim 1 işçisinin DÖRT sonucu aynen (kapı 3, K1)', () => {
  it('SMTP yapılandırılmamış → `yapilandirilmamis` (yeniden deneme YOK; bekçi kırmızı gösterir)', async () => {
    gonder.mockResolvedValue({ ok: false, yapilandirilmamis: true });
    const d = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('yapilandirilmamis');
    expect(d.yamalar()).toEqual([{ durum: 'yapilandirilmamis', zaman: SIMDI }]);
    expect(d.revize()).toEqual({ ...REVIZE, durum: 'yapilandirilmamis', zaman: SIMDI });
  });

  it.each([...KALICI_HATA_SINIFLARI])('kalıcı hata sınıfı (%s) → ilk başarısızlıkta `gonderilemedi` + sınıf; kuyruk yolunda da yeniden DENENMEZ', async (sinif) => {
    gonder.mockResolvedValue({ ok: false, sinif });
    const d = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gonderilemedi');
    expect(d.yamalar()).toEqual([{ durum: 'gonderilemedi', deneme: 1, hataSinifi: sinif, zaman: SIMDI }]);
    expect(konsolMetni()).toBe(`[magaza-bildirim] revize: bildirim gönderilemedi (sınıf: ${sinif})`);
  });

  it('geçici hata + son deneme DEĞİL → `bekliyor` + `deneme` + `hataSinifi`, dönen `yeniden-dene`; üç revize alanı KORUNUR (düşseydi sonraki koşul NULL\'a takılırdı)', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 2, sonMu: false })).resolves.toBe('yeniden-dene');
    expect(d.yamalar()).toEqual([{ durum: 'bekliyor', deneme: 2, hataSinifi: 'baglanti', zaman: SIMDI }]);
    expect(d.revize()).toEqual({ ...REVIZE, durum: 'bekliyor', zaman: SIMDI, deneme: 2, hataSinifi: 'baglanti' });
    // Sonraki deneme AYNI sürümle okur, gönderir ve `gitti` yazar (posta her denemede yeniden gitmez: `gitti` yazılabiliyor).
    gonder.mockResolvedValue({ ok: true });
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 3, sonMu: false })).resolves.toBe('gitti');
    expect(d.yazilan().at(-1)?.params[3]).toBe(3);
    expect(d.revize()).toMatchObject({ durum: 'gitti', alanlar: REVIZE.alanlar, kim: REVIZE.kim, icerikSurum: 3 });
    // `gitti` sonrası gelen iş göndermez.
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 4, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).toHaveBeenCalledTimes(2);
  });

  it('geçici hata + SON deneme → `gonderilemedi` (belge sonsuza dek `bekliyor` kalmaz); süreç içi yolda (deneme bilgisi yok) da `gonderilemedi`, `deneme` alanı YAZILMAZ', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'tls' });
    const son = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, son.D, { sayi: 9, sonMu: true })).resolves.toBe('gonderilemedi');
    expect(son.yamalar()).toEqual([{ durum: 'gonderilemedi', deneme: 9, hataSinifi: 'tls', zaman: SIMDI }]);
    const icYol = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, icYol.D)).resolves.toBe('gonderilemedi');
    expect(icYol.yamalar()).toEqual([{ durum: 'gonderilemedi', hataSinifi: 'tls', zaman: SIMDI }]);
  });

  it('kapalı kümede OLMAYAN sınıf (gönderici bozulur da hata metni dönerse) `diger`e iner: metin belgeye / günlüğe yazılmaz', async () => {
    const bozuk: unknown = { ok: false, sinif: `550 5.1.1 <${'zeynep@musteri-alani.test'}> reddedildi` };
    gonder.mockResolvedValue(bozuk as Awaited<ReturnType<typeof smtpGonder>>);
    const d = duzenek();
    await magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: true });
    expect(d.yamalar()[0].hataSinifi).toBe('diger');
    expect(MAGAZA_BILDIRIM_HATA_SINIFLARI).toContain('diger');
    expect(`${JSON.stringify(d.revize())}${konsolMetni()}`).not.toMatch(/zeynep|550/);
  });

  it('gönderici FIRLATIRSA da sınıf yazılır, ileti yazılmaz; işlev fırlatmaz', async () => {
    gonder.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND gizli-sunucu Zeynep'), { code: 'ENOTFOUND' }));
    const d = duzenek();
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('gonderilemedi');
    expect(`${JSON.stringify(d.revize())}${konsolMetni()}`).not.toMatch(/Zeynep|gizli-sunucu|getaddrinfo/);
  });
});

describe('magazaRevizeBildirimIsle — atlanan durumlar (gönderim YOK, yazım YOK): yalnız `bekliyor` gönderilir', () => {
  it.each([
    ['belge yok', null],
    ['`bildirimRevize` alanı yok (revizyon yok)', tamBelge({ bildirimRevize: undefined })],
    ['`bildirimRevize` JSON null', tamBelge({ bildirimRevize: null })],
    ['`bildirimRevize` çöp dizge', tamBelge({ bildirimRevize: 'çöp' })],
    ['`bildirimRevize` dizi', tamBelge({ bildirimRevize: ['not'] })],
    ['durum `gitti` (ikinci revizyon birleştirilmiş, önceki iş gönderdi)', tamBelge({ bildirimRevize: { ...REVIZE, durum: 'gitti' } })],
    ['durum `gonderilemedi` (kalıcı sonuç yazılmış; yol «Yeniden gönder»)', tamBelge({ bildirimRevize: { ...REVIZE, durum: 'gonderilemedi', hataSinifi: 'kimlik' } })],
    ['durum `yapilandirilmamis` (yol «Yeniden gönder» / açılış süpürmesi)', tamBelge({ bildirimRevize: { ...REVIZE, durum: 'yapilandirilmamis' } })],
    ['durum bilinmeyen dizge', tamBelge({ bildirimRevize: { ...REVIZE, durum: 'hazir' } })],
    ['durum yok', tamBelge({ bildirimRevize: { alanlar: ['not'], kim: REVIZE.kim, icerikSurum: 3 } })],
  ] as const)('%s → `atlandi`', async (_ad, belge) => {
    const d = duzenek(belge);
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
    expect(gonder).not.toHaveBeenCalled();
    expect(d.yazilan()).toEqual([]);
    expect(d.yayin).not.toHaveBeenCalled();
  });

  it.each([['bozuk biçim', 'mt-123'], ['boş', ''], ['SQL parçası', "mt-0123456789abcdef0123456789abcdef' OR 1=1"]] as const)(
    'kimlik deseni tutmuyorsa (%s) veritabanına HİÇ gidilmez', async (_ad, kimlik) => {
      const d = duzenek();
      await expect(magazaRevizeBildirimIsle(kimlik, d.D)).resolves.toBe('atlandi');
      expect(d.sorgular).toEqual([]);
    });

  it.each([['dizge', '3'], ['kesirli', 3.5], ['eksi', -1], ['yok', undefined], ['null', null], ['güvenli aralık dışı', 2 ** 60]] as const)(
    '`icerikSurum` okunamıyorsa (%s) posta GÖNDERİLMEZ: sonucu yazılamayacak gönderim her kuyruğa alınışta yinelenirdi', async (_ad, icerikSurum) => {
      const d = duzenek(tamBelge({ bildirimRevize: { ...REVIZE, icerikSurum } }));
      await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('atlandi');
      expect(gonder).not.toHaveBeenCalled();
      expect(d.yazilan()).toEqual([]);
      expect(konsolMetni()).toBe('[magaza-bildirim] revize: sürüm sayacı okunamadı — bildirim gönderilmedi');
    });

  it('`icerikSurum` 0 GEÇERLİDİR (sıfır «yok» değildir)', async () => {
    const d = duzenek(tamBelge({ bildirimRevize: { ...REVIZE, icerikSurum: 0 } }));
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('gitti');
    expect(d.yazilan()[0].params[3]).toBe(0);
  });
});

describe('magazaRevizeBildirimIsle — araya giren revizyon (kapı 3, K9): 0 satır → iş SESSİZCE biter, YENİ İŞ YOK', () => {
  it('işçi okuduktan SONRA yeni revizyon geldi (sürüm 3 → 4): `gitti` YAZILMAZ, yeni `bekliyor` EZİLMEZ, yayın yok; sonraki iş birleşik alanlarla gönderir', async () => {
    const yeni = { durum: 'bekliyor', zaman: '2026-10-10T09:14:59.000Z', alanlar: ['musteri', 'not', 'teyit', 'not'], kim: { uid: 'u2', ad: 'Mehmet Öz' }, icerikSurum: 4 };
    let girdi = false;
    const d = duzenek(tamBelge({ bildirimRevize: { ...REVIZE, alanlar: ['not'] } }), { yazmadanOnce: (b) => { if (!girdi) { girdi = true; b.bildirimRevize = structuredClone(yeni); b.icerikZamani = '2026-10-10T09:14:59.000Z'; } } });
    // Posta GİTTİ (ilk revizyonun kısmi listesiyle) → dönen değer gönderimi anlatır.
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder.mock.calls[0][0].metin).toContain('Değişen alanlar: Not\n');
    expect(d.yazilan()[0].params[3]).toBe(3);          // bayat sürümle denendi …
    expect(d.revize()).toEqual(yeni);                  // … ve 0 satır: araya giren revizyonun `bekliyor`u aynen duruyor
    expect(d.yayin).not.toHaveBeenCalled();
    expect(konsolMetni()).toBe('');                    // sessiz
    // O revizyonun KENDİ işi (içerik yazımı kuyruğa koymuştu) `bekliyor` görür ve birleşik, tekilleştirilmiş alanlarla gönderir.
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(gonder).toHaveBeenCalledTimes(2);
    expect(gonder.mock.calls[1][0].metin).toContain('Değişen alanlar: Müşteri bilgileri, Not, Teyit edilen kalemler\n');
    expect(gonder.mock.calls[1][0].metin).toContain('Revize eden: Mehmet Öz');
    expect(d.revize()).toEqual({ ...yeni, durum: 'gitti', zaman: SIMDI });
  });

  it('işçi kuyruğa iş GÖNDEREMEZ: bağlamında kuyruk yok — bağlama fazladan `send` konsa da ÇAĞRILMAZ (0 satırda da, hata yolunda da)', async () => {
    const send = vi.fn(async () => 'is');
    const fazlali = { getPgPool: () => null, broadcastDocChange: vi.fn(), send, kuyruk: { send }, revizeBildirimiIste: send };
    const d = duzenek(tamBelge(), { yaz: async () => ({ rows: [] }) }, {});
    await magazaRevizeBildirimIsle(KIMLIK, { ...fazlali, ...d.D }, { sayi: 1, sonMu: false });
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    await magazaRevizeBildirimIsle(KIMLIK, { ...fazlali, ...d.D }, { sayi: 2, sonMu: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('posta gitti ama sonuç yazımı FIRLATTI → `gitti` (yeniden deneme çift posta olurdu); günlükte yalnız hata KODU', async () => {
    const d = duzenek(tamBelge(), { yaz: async () => { throw Object.assign(new Error('deadlock Zeynep 0532'), { code: '40P01', detail: 'Zeynep' }); } });
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('gitti');
    expect(konsolMetni()).toBe('[magaza-bildirim] revize: bildirim sonucu yazılamadı (kod: 40P01)');
  });
});

describe('magazaRevizeBildirimIsle — ASLA fırlatmaz; günlüğe kimlik / kişisel veri / hata metni yazılmaz', () => {
  it('havuz yok → posta DENENMEZ: kuyruk yolunda `yeniden-dene`, süreç içi yolda / son denemede `gonderilemedi`', async () => {
    const D: MagazaBildirimDeps = { getPgPool: () => null, broadcastDocChange: vi.fn() };
    await expect(magazaRevizeBildirimIsle(KIMLIK, D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    await expect(magazaRevizeBildirimIsle(KIMLIK, D, { sayi: 9, sonMu: true })).resolves.toBe('gonderilemedi');
    await expect(magazaRevizeBildirimIsle(KIMLIK, D)).resolves.toBe('gonderilemedi');
    expect(gonder).not.toHaveBeenCalled();
    expect(konsolMetni().split('\n')).toEqual(Array(3).fill('[magaza-bildirim] revize: veritabanı havuzu yok — bildirim gönderilemedi'));
  });

  it('okuma hatası → yalnız hata KODU günlükte (pg iletisi / detail JSON parçası taşır); posta denenmez', async () => {
    const d = duzenek(tamBelge(), { oku: async () => { throw Object.assign(new Error('invalid json: Zeynep 0532 111 22 33'), { code: '22P02', detail: 'Failing row: Zeynep' }); } });
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D, { sayi: 1, sonMu: false })).resolves.toBe('yeniden-dene');
    expect(gonder).not.toHaveBeenCalled();
    expect(konsolMetni()).toBe('[magaza-bildirim] revize: talep okunamadı (kod: 22P02)');
  });

  it('`getPgPool` / yayın / saat fırlatsa da söz reddetmez', async () => {
    await expect(magazaRevizeBildirimIsle(KIMLIK, { getPgPool: () => { throw new Error('x'); }, broadcastDocChange: vi.fn() })).resolves.toBe('gonderilemedi');
    const d = duzenek();
    d.yayin.mockImplementation(() => { throw new Error('yayın düştü'); });
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('gitti');
    const saatsiz = duzenek(tamBelge(), {}, { simdi: () => { throw new Error('saat yok'); } });
    await expect(magazaRevizeBildirimIsle(KIMLIK, saatsiz.D)).resolves.toBe('gitti');   // posta gitti; sonucu yazılamadı
  });

  it('kiracı etiketi OLMAYAN satır YAYINLANMAZ (etiketsiz olay bütün kiracılara giderdi)', async () => {
    const d = duzenek(tamBelge({ companyId: undefined }));
    await expect(magazaRevizeBildirimIsle(KIMLIK, d.D)).resolves.toBe('gitti');
    expect(d.yayin).not.toHaveBeenCalled();
  });

  it('hiçbir günlük satırı talep kimliği, talep no, alan adı ya da revize edenin adını taşımaz', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'kimlik' });
    await magazaRevizeBildirimIsle(KIMLIK, duzenek().D);
    await magazaRevizeBildirimIsle(KIMLIK, duzenek(tamBelge({ bildirimRevize: { ...REVIZE, icerikSurum: 'x' } })).D);
    await magazaRevizeBildirimIsle(KIMLIK, duzenek(tamBelge(), { yaz: async () => { throw new Error('y'); } }).D);
    const metin = konsolMetni();
    expect(metin.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(metin).not.toMatch(/mt-|T261010|Ayşe|musteri|teyit|Zeynep/);
    for (const satir of metin.split('\n')) expect(satir.startsWith('[magaza-bildirim] revize: ')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('kuyruk — sabitler, işçi, isteyici (§ 10.2 (e))', () => {
  it('revize kuyruğu AYRI sabittir; iş ve işçi seçenekleri ilk kuyrukla AYNI (kopya yok)', () => {
    expect(MAGAZA_REVIZE_KUYRUGU).toBe('magaza-talep-revize-bildirimi');
    expect(MAGAZA_BILDIRIM_KUYRUGU).toBe('magaza-talep-bildirimi');
    expect(MAGAZA_REVIZE_KUYRUGU).not.toBe(MAGAZA_BILDIRIM_KUYRUGU);
    // pg-boss kuyruk adı kuralı: harf, rakam, alt çizgi, tire, nokta (boşluk / Türkçe harf yok).
    expect(MAGAZA_REVIZE_KUYRUGU).toMatch(/^[a-z0-9._-]+$/);
  });

  it('işçi: iş verisinden YALNIZ `talepId` okunur ve REVİZE yolundan işlenir (dar okuma); bozuk iş sessizce atlanır', async () => {
    const d = duzenek();
    const isci = magazaRevizeBildirimIscisi(d.D);
    await expect(isci([
      { data: { talepId: KIMLIK, tur: 'ilk', alanlar: ['kalemler'], ad: 'Zeynep' }, retryCount: 0, retryLimit: 8 },
      { data: { talepId: 'bozuk' }, retryCount: 0, retryLimit: 8 },
      { data: null }, { data: 'mt-x' },
    ])).resolves.toBeUndefined();
    expect(d.sorgular.map((s) => s.sql)).toEqual([REVIZE_OKU_SQL, REVIZE_YAZ_SQL]);   // ilk bildirimin sorguları HİÇ koşmadı
    expect(gonder).toHaveBeenCalledTimes(1);
    expect(gonder.mock.calls[0][0].konu).toBe('Mağaza talebi revize edildi · T261010-AB12');
    expect(d.revize()).toMatchObject({ durum: 'gitti' });
  });

  it('işçi: geçici hata → sabit iletili TEK hata fırlatır (pg-boss yeniden dener); belge `bekliyor` + `deneme` (retryCount + 1); son denemede fırlatmaz', async () => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    const isci = magazaRevizeBildirimIscisi(d.D);
    await expect(isci([{ data: { talepId: KIMLIK }, retryCount: 2, retryLimit: 8 }])).rejects.toThrow(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI);
    expect(d.revize()).toMatchObject({ durum: 'bekliyor', deneme: 3, hataSinifi: 'baglanti', icerikSurum: 3 });
    await expect(isci([{ data: { talepId: KIMLIK }, retryCount: 8, retryLimit: 8 }])).resolves.toBeUndefined();
    expect(d.revize()).toMatchObject({ durum: 'gonderilemedi', deneme: 9, alanlar: REVIZE.alanlar, kim: REVIZE.kim });
    // Fırlatılan hatanın iletisi sabittir: kimlik, sınıf, alan adı taşımaz (pg-boss iletiyi iş satırına yazar).
    expect(MAGAZA_BILDIRIM_YENIDEN_DENE_ILETISI).not.toMatch(/mt-|baglanti|revize|not|teyit/);
  });

  it('isteyici: kuyruk hazırsa REVİZE kuyruğuna `send` — iş verisi YALNIZ `{ talepId }`, seçenekler ortak sabit; süreç içi gönderim YOK', async () => {
    const send = vi.fn(async () => 'is-1');
    const d = duzenek();
    await expect(magazaRevizeBildirimIsteyici(() => ({ send }), d.D)(KIMLIK)).resolves.toBeUndefined();
    expect(send.mock.calls).toEqual([[MAGAZA_REVIZE_KUYRUGU, { talepId: KIMLIK }, MAGAZA_BILDIRIM_IS_SECENEKLERI]]);
    await bekle();
    expect(d.sorgular).toEqual([]);
    expect(gonder).not.toHaveBeenCalled();
  });

  it('iki isteyici İKİ AYRI kuyruğa gönderir (çapraz gönderim yok: ilk bildirimin isteyicisi revize kuyruğuna yazmaz)', async () => {
    const send = vi.fn(async (..._bagimsizlar: unknown[]) => 'is');
    const d = duzenek();
    await magazaBildirimIsteyici(() => ({ send }), d.D)(KIMLIK);
    await magazaRevizeBildirimIsteyici(() => ({ send }), d.D)(KIMLIK_B);
    expect(send.mock.calls.map((c) => [c[0], c[1]])).toEqual([[MAGAZA_BILDIRIM_KUYRUGU, { talepId: KIMLIK }], [MAGAZA_REVIZE_KUYRUGU, { talepId: KIMLIK_B }]]);
  });

  it.each([
    ['kuyruk yok (`null`)', (): null => null],
    ['`send` fırlatıyor', () => ({ send: vi.fn(async () => { throw new Error('kuyruk kapalı Zeynep'); }) })],
    ['`send` null çözüyor (iş oluşmadı)', () => ({ send: vi.fn(async () => null) })],
    ['kuyruk okuyucusu fırlatıyor', (): null => { throw new Error('boss yok'); }],
  ] as const)('isteyici: %s → süreç içi REVİZE gönderimi BAŞLAR, beklenmez; asla reddetmez; deneme bilgisi YOK', async (_ad, kuyruk) => {
    gonder.mockResolvedValue({ ok: false, sinif: 'baglanti' });
    const d = duzenek();
    await expect(magazaRevizeBildirimIsteyici(kuyruk, d.D)(KIMLIK)).resolves.toBeUndefined();
    await bekle(15);
    expect(d.sorgular.map((s) => s.sql)).toEqual([REVIZE_OKU_SQL, REVIZE_YAZ_SQL]);
    // Süreç içi yolda yeniden deneyen yok: geçici hata `bekliyor` + deneme DEĞİL, `gonderilemedi` yazılır.
    expect(d.revize()).toMatchObject({ durum: 'gonderilemedi', hataSinifi: 'baglanti' });
    expect(d.revize()).not.toHaveProperty('deneme');
    expect(konsolMetni()).not.toMatch(/Zeynep|boss yok|kuyruk kapalı/);
  });

  it('isteyici: kimlik deseni tutmuyorsa hiçbir şey yapmaz; süreç içi işlev reddetse / eşzamanlı fırlatsa da söz reddetmez', async () => {
    const send = vi.fn(async () => 'is');
    const isle = vi.fn(async (): Promise<unknown> => { throw new Error('reddetti'); });
    await expect(magazaRevizeBildirimIsteyiciKur(() => ({ send }), duzenek().D, isle)('bozuk')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(isle).not.toHaveBeenCalled();
    await expect(magazaRevizeBildirimIsteyiciKur(() => null, duzenek().D, isle)(KIMLIK)).resolves.toBeUndefined();
    const esZamanli = vi.fn((): Promise<unknown> => { throw new Error('eşzamanlı'); });
    await expect(magazaRevizeBildirimIsteyiciKur(() => null, duzenek().D, esZamanli)(KIMLIK)).resolves.toBeUndefined();
    await bekle();
    expect(isle).toHaveBeenCalledTimes(1);
    expect(isle).toHaveBeenCalledWith(KIMLIK, expect.anything());   // deneme bilgisi (üçüncü bağımsız değişken) verilmez
  });
});

describe('magazaRevizeKacanlariKuyrukla — açılışta kaçan REVİZE bildirimleri (§ 10.2 (e), § 10.7)', () => {
  const AN = Date.UTC(2026, 9, 10, 9, 0, 0);
  type KacanSatiri = { id: string; data: Satir };
  function kacanDuzenegi(satirlar: KacanSatiri[] | Error = [], o: { send?: (...a: unknown[]) => Promise<unknown> } = {}) {
    const sorgular: Sorgu[] = [];
    const havuz = { query: vi.fn(async (sql: string, params: unknown[] = []): Promise<SahteSonuc> => { sorgular.push({ sql, params }); if (satirlar instanceof Error) throw satirlar; return { rows: satirlar }; }) };
    const yayin = vi.fn<MagazaBildirimDeps['broadcastDocChange']>();
    const D: MagazaBildirimDeps = { getPgPool: () => havuz, broadcastDocChange: yayin };
    const send = vi.fn(o.send ?? (async () => 'is'));
    const dogrula = vi.fn(async (): Promise<Awaited<ReturnType<typeof smtpGonder>>> => ({ ok: true }));
    const yapilandirma = vi.fn(() => ({ tamam: true }));
    const kos = (kuyruk: () => { send: typeof send } | null = () => ({ send })) => magazaRevizeKacanlariKuyrukla(D, kuyruk, dogrula, yapilandirma, () => AN);
    return { sorgular, havuz, yayin, send, dogrula, yapilandirma, kos };
  }

  it('kuyruk hazır değilse HİÇ koşmaz (süreç içi yola DÜŞMEZ); yapılandırma tamam değilse / teslim sondası geçmezse koşmaz', async () => {
    const d = kacanDuzenegi([{ id: KIMLIK, data: { companyId: 'c1' } }]);
    await expect(d.kos(() => null)).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'kuyruk-hazir-degil' });
    d.yapilandirma.mockReturnValue({ tamam: false });
    await expect(d.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'yapilandirma' });
    d.yapilandirma.mockReturnValue({ tamam: true });
    d.dogrula.mockResolvedValue({ ok: false, sinif: 'alici-reddi' });
    await expect(d.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'teslim-sondasi' });
    expect(d.havuz.query).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(gonder).not.toHaveBeenCalled();
    expect(konsolMetni().split('\n')).toEqual([
      '[magaza-bildirim] revize: kaçanlar: kuyruğa alınmadı — kuyruk hazır değil',
      '[magaza-bildirim] revize: kaçanlar: kuyruğa alınmadı — SMTP yapılandırması tamam değil',
      '[magaza-bildirim] revize: kaçanlar: kuyruğa alınmadı — teslim sondası geçmedi (sınıf: alici-reddi)',
    ]);
  });

  it('REVİZE sabitiyle sahiplenir (koleksiyon, şimdi, şimdi − 3 sa), kiracılı satırı yayınlar, her satırı REVİZE kuyruğuna alır; günlükte yalnız sayı', async () => {
    const d = kacanDuzenegi([
      { id: KIMLIK, data: { companyId: 'c1', talepNo: 'T261010-AB12', musteri: { ad: 'Zeynep' }, bildirimRevize: { ...REVIZE, zaman: new Date(AN).toISOString() } } },
      { id: KIMLIK_B, data: { bildirimRevize: { ...REVIZE } } },   // kiracı etiketi yok → YAYINLANMAZ ama kuyruğa alınır
      { id: 'bozuk', data: { companyId: 'c1' } },                  // bozuk kimlik: atlanır
    ]);
    await expect(d.kos()).resolves.toEqual({ alinan: 3, kuyrukta: 2 });
    expect(d.sorgular).toEqual([{ sql: MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL, params: [MAGAZA_TALEP_KOLEKSIYONU, new Date(AN).toISOString(), new Date(AN - MAGAZA_KACAN_YETIM_ESIGI_MS).toISOString()] }]);
    expect(d.yayin).toHaveBeenCalledTimes(1);
    expect(d.yayin).toHaveBeenCalledWith(MAGAZA_TALEP_KOLEKSIYONU, 'set', KIMLIK, expect.objectContaining({ companyId: 'c1' }), { cid: 'c1' });
    expect(d.send.mock.calls).toEqual([
      [MAGAZA_REVIZE_KUYRUGU, { talepId: KIMLIK }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
      [MAGAZA_REVIZE_KUYRUGU, { talepId: KIMLIK_B }, MAGAZA_BILDIRIM_IS_SECENEKLERI],
    ]);
    expect(konsolMetni()).toBe('[magaza-bildirim] revize: kaçanlar: 3 talep sahiplenildi, 2 kuyruğa alındı, kuyruğa alınamadı: 1');
    expect(konsolMetni()).not.toMatch(/Zeynep|T261010|mt-|Ayşe/);
    expect(gonder).not.toHaveBeenCalled();   // süreç içi gönderim YOK
  });

  it('`send` fırlatır ya da null döner → sayılmaz, süreç içi yola düşülmez; havuz yok / sorgu fırlatır → neden döner, hata METNİ günlüğe girmez; satır yoksa gürültü yok', async () => {
    let n = 0;
    const d = kacanDuzenegi([{ id: KIMLIK, data: { companyId: 'c1' } }, { id: KIMLIK_B, data: { companyId: 'c1' } }], { send: async () => { n += 1; if (n === 1) throw new Error('kuyruk kapalı'); return null; } });
    await expect(d.kos()).resolves.toEqual({ alinan: 2, kuyrukta: 0 });
    expect(gonder).not.toHaveBeenCalled();
    const havuzsuz = kacanDuzenegi();
    await expect(magazaRevizeKacanlariKuyrukla({ getPgPool: () => null, broadcastDocChange: vi.fn() }, () => ({ send: havuzsuz.send }), havuzsuz.dogrula, havuzsuz.yapilandirma, () => AN))
      .resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'havuz-yok' });
    const hatali = kacanDuzenegi(Object.assign(new Error(`relation docs: ${KIMLIK} Zeynep`), { code: '42P01' }));
    await expect(hatali.kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0, neden: 'sorgu' });
    expect(konsolMetni().split('\n').at(-1)).toBe('[magaza-bildirim] revize: kaçanlar: sorgu başarısız (kod: 42P01)');
    for (const c of konsolCasuslari) c.mock.calls.length = 0;
    await expect(kacanDuzenegi([]).kos()).resolves.toEqual({ alinan: 0, kuyrukta: 0 });
    expect(konsolMetni()).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('ÇİT: revize SQL sabitleri — nesne BÜTÜNÜYLE değiştirilmez (kapı 4, Y3; § 10.8)', () => {
  it('`REVIZE_YAZ_SQL` metni: `\'{bildirimRevize}\'` yolu + `(data->\'bildirimRevize\') || $3::jsonb` (PARANTEZLİ) + nesne koşulu + `gitti` ezilmez + okunan `icerikSurum` koşulu', () => {
    expect(REVIZE_YAZ_SQL).toBe("UPDATE docs SET data = jsonb_set(data, '{bildirimRevize}', (data->'bildirimRevize') || $3::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND jsonb_typeof(data->'bildirimRevize') = 'object' AND data->'bildirimRevize'->>'durum' IS DISTINCT FROM 'gitti' AND (data->'bildirimRevize'->>'icerikSurum')::int = $4 RETURNING data");
    expect(REVIZE_YAZ_SQL).toContain("(data->'bildirimRevize') || $3::jsonb");
    // Dilim 1 `YAZ_SQL` kalıbının tam değiştirmesi bu yola UYGULANMAZ (işçinin ilk «yeniden dene» yazımı üç alanı düşürürdü).
    expect(REVIZE_YAZ_SQL).not.toContain("'{bildirimRevize}', $3::jsonb");
    expect(REVIZE_YAZ_SQL).not.toMatch(/data->'bildirimRevize' \|\|/);   // parantezsiz birleştirme yok
    expect(REVIZE_YAZ_SQL).toContain("IS DISTINCT FROM 'gitti'");
    expect([...new Set(REVIZE_YAZ_SQL.match(/\$\d+/g))].sort()).toEqual(['$1', '$2', '$3', '$4']);
    // İlk bildirim alanına dokunmaz; `silindi` / kiracı koşulu taşımaz (şartname metni; işçi kiracıyı satırdan okur, yayında kullanır).
    expect(REVIZE_YAZ_SQL).not.toContain("'{bildirim}'");
  });

  it('`MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL`: yama `(d.data->\'bildirimRevize\') || jsonb_build_object(\'durum\', \'bekliyor\', \'zaman\', …)` — YALNIZ durum + zaman; `alanlar` / `kim` / `icerikSurum` korunur', () => {
    const sql = MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL;
    expect(sql).toContain("jsonb_set(d.data, '{bildirimRevize}', (d.data->'bildirimRevize') || jsonb_build_object('durum', 'bekliyor', 'zaman', $2::text))");
    expect(sql).not.toContain("'{bildirimRevize}', jsonb_build_object(");   // nesneyi bütünüyle değiştiren biçim YOK
    expect(sql).not.toContain("'{bildirimRevize,durum}'");                  // kapı 3'ün çift `jsonb_set` biçimi kapı 4'te `||` oldu
    expect(sql).not.toContain("'{bildirim}'");                              // ilk bildirim alanına DOKUNMAZ
    // Aday süzgeci dilim 1 kalıbı: yapılandırılmamış ya da `deneme`siz + yetim eşiğinden eski bekliyor; yaş alanın KENDİ `zaman`ından.
    expect(sql).toContain("data->'bildirimRevize'->>'durum' = 'yapilandirilmamis'");
    expect(sql).toContain("data->'bildirimRevize'->>'durum' = 'bekliyor'");
    expect(sql).toContain("AND NOT (data->'bildirimRevize' ? 'deneme')");
    expect(sql).toContain("(data->'bildirimRevize'->>'zaman') COLLATE \"C\" < $3");
    expect(sql).toContain("ORDER BY (data->>'icerikZamani') COLLATE \"C\" DESC");
    expect(sql).toContain(`LIMIT ${MAGAZA_KACAN_SINIRI}`);
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('RETURNING d.id, d.data');
    expect(sql).not.toContain("'gitti'");
    expect(sql).not.toContain("'gonderilemedi'");
    expect([...new Set(sql.match(/\$\d+/g))].sort()).toEqual(['$1', '$2', '$3']);
  });

  it('iki süpürme sorgusu TEK kalıptan: revize metni, ilk bildirim metninin alan yolu + sıra alanı + yama değişmiş hâli (aday süzgeci BİREBİR aynı)', () => {
    const beklenen = MAGAZA_KACAN_SAHIPLEN_SQL
      .replaceAll("data->'bildirim'", "data->'bildirimRevize'")
      .replace("(data->>'olusturma')", "(data->>'icerikZamani')")
      .replace("jsonb_set(d.data, '{bildirim}', jsonb_build_object(", "jsonb_set(d.data, '{bildirimRevize}', (d.data->'bildirimRevize') || jsonb_build_object(");
    expect(MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL).toBe(beklenen);
    // (İnceleme 2b, bulgu 9) silinmiş talep iki süpürmede de aday OLMAZ: koşul tek üreticiden geldiği için iki sabitte BİREBİR
    // aynı yerde — `WHERE coll = $1` ile durum ayrımı arasında (durum ayrımının `OR` dalına düşmedi).
    const SILINMEMIS = "jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'";
    for (const [yol, sql] of [['bildirim', MAGAZA_KACAN_SAHIPLEN_SQL], ['bildirimRevize', MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL]] as const) {
      expect(sql.replace(/\s+/g, ' '), yol).toContain(`WHERE coll = $1 AND ${SILINMEMIS} AND ( data->'${yol}'->>'durum' = 'yapilandirilmamis' OR (`);
      expect(sql.split(SILINMEMIS), yol).toHaveLength(2);
    }
    // İlk bildirimin süpürmesi DEĞİŞMEDİ: nesneyi bütünüyle değiştirmeye devam eder (`deneme` / `hataSinifi` silinir — bilinçli).
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).toContain("jsonb_set(d.data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $2::text))");
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).not.toContain('bildirimRevize');
    expect(MAGAZA_KACAN_SAHIPLEN_SQL).not.toContain('icerikZamani');
  });

  it('ÜÇ revize yazıcısının üçünde de `(…data->\'bildirimRevize\')` PARANTEZLİ; hiçbiri `\'{bildirimRevize}\'` yoluna nesneyi bütünüyle YAZMAZ', () => {
    const ucu = { REVIZE_YAZ_SQL, BILDIRIM_REVIZE_YENIDEN_SQL, MAGAZA_REVIZE_KACAN_SAHIPLEN_SQL };
    for (const [ad, sql] of Object.entries(ucu)) {
      expect(sql, ad).toMatch(/jsonb_set\((?:d\.)?data, '\{bildirimRevize\}', \(+(?:d\.)?data->'bildirimRevize'\)/);
      expect(sql, ad).not.toContain("'{bildirimRevize}', jsonb_build_object(");
      expect(sql, ad).not.toMatch(/'\{bildirimRevize\}', \$\d/);
      expect(sql, ad).not.toMatch(/[^(.]data->'bildirimRevize' (?:\|\||-) /);   // parantezsiz `||` / `-` (işleç önceliği tuzağı)
    }
    // Revizyonu YARATAN tek ifade içerik yazımıdır (`ICERIK_SQL`); bu üçü yoktan nesne yaratmaz: ikisi tür koşulu taşır,
    // süpürmenin aday süzgeci durum dizgesi ister (alan yoksa / çöpse `->>'durum'` NULL'dur, satır aday olmaz).
    expect(REVIZE_YAZ_SQL).toContain("jsonb_typeof(data->'bildirimRevize') = 'object'");
    expect(BILDIRIM_REVIZE_YENIDEN_SQL).toContain("jsonb_typeof(data->'bildirimRevize') = 'object'");
  });
});

describe('ÇİT: kaynak taraması — işçi iş GÖNDERMEZ; revize yolu ilk bildirimin sorgularını kullanmaz', () => {
  const HAM = readFileSync(join(__dirname, 'magazaBildirim.ts'), 'utf-8');
  const SATIRLAR = yorumsuz('magazaBildirim.ts', HAM);
  const KOD = SATIRLAR.join('\n');
  const arasi = (bas: string, son: string): string => {
    const i = KOD.indexOf(bas);
    const j = KOD.indexOf(son, i + bas.length);
    expect(i, bas).toBeGreaterThanOrEqual(0);
    expect(j, son).toBeGreaterThan(i);
    return KOD.slice(i, j);
  };

  it('`MagazaBildirimDeps` arayüzünde kuyruk / `send` üyesi yok (işçi bağlamı iş gönderemez)', () => {
    const arayuz = arasi('export interface MagazaBildirimDeps {', '\n}');
    expect(arayuz).not.toMatch(/kuyruk|send|boss|[Ii]ste\b/);
    expect([...arayuz.matchAll(/^\s{2}(\w+)\??:/gm)].map((e) => e[1]).sort()).toEqual(['appUrl', 'broadcastDocChange', 'getPgPool', 'simdi']);
  });

  it('işçi gövdesi (tür ayarları + ortak iskelet + iki tek talep işlevi) kuyruğa ekleme ÇAĞIRMAZ: `kuyrugaEkle` yalnız isteyicide ve süpürmede', () => {
    const isci = arasi('const ILK_BILDIRIM: BildirimTurAyari = {', 'const sayacMi =');
    expect(isci).toContain('const REVIZE_BILDIRIMI: BildirimTurAyari = {');
    expect(isci).toContain('async function bildirimKos(');
    expect(isci).not.toMatch(/kuyrugaEkle|\.send\(|[Ii]steyici|kuyruk\(/);
    expect(KOD.match(/kuyrugaEkle\(/g)).toHaveLength(3);   // tanım + isteyici + süpürme
  });

  it('revize tür ayarı YALNIZ revize sabitleriyle okur / yazar; ilk bildirimin ayarı YALNIZ kendi sabitleriyle (çapraz kullanım yok)', () => {
    const ilk = arasi('const ILK_BILDIRIM: BildirimTurAyari = {', 'const REVIZE_BILDIRIMI: BildirimTurAyari = {');
    const revize = arasi('const REVIZE_BILDIRIMI: BildirimTurAyari = {', 'async function bildirimKos(');
    expect(revize.match(/\b[A-Z_]+_SQL\b/g)).toEqual(['REVIZE_OKU_SQL', 'REVIZE_YAZ_SQL']);
    expect(ilk.match(/\b[A-Z_]+_SQL\b/g)).toEqual(['OKU_SQL', 'YAZ_SQL']);
    expect(revize).toContain('guvenliRevizeIcerik(');
    expect(revize).not.toMatch(/guvenliIcerik\(|magazaBildirimIcerigi/);
    // Yalnız `bekliyor` gönderilir (başka her durumda `'atla'`).
    expect(revize).toContain("if (!nesneMi(revize) || revize.durum !== 'bekliyor') return 'atla';");
  });

  it('revize içerik işlevi belgenin müşteri / kalem / tutar alanlarını OKUMAZ (alan ADINA bağlı çit)', () => {
    const icerik = arasi('export function magazaRevizeIcerigi(', '\n}\n');
    expect(icerik).not.toMatch(/\bmusteri\b|\bkalemler\b|\bteyit\b|\btalepEdilen\b|\btelefonSon10\b|\bparaYaz\b|\.adet\b|\.sku\b|\.marka\b|birimFiyat|araToplam|\.kdv\b|\.toplam\b|\.il\b|\.uid\b/);
    expect([...new Set(icerik.match(/\btalep\.\w+/g))].sort()).toEqual(['talep.bildirimRevize', 'talep.icerikZamani', 'talep.talepNo']);
    expect([...new Set(icerik.match(/\brevize\.\w+/g))].sort()).toEqual(['revize.alanlar', 'revize.kim']);
  });

  it('`revize` türünün günlük satırları sabit önekli; satıra `${…}` ile yalnız hata KODU / SINIFI girer (ortak iskelet — ilk bildirimle aynı satırlar)', () => {
    expect(KOD).toContain("const REVIZE_ON_EK = '[magaza-bildirim] revize: ';");
    const konsol = SATIRLAR.filter((s) => /console\./.test(s));
    for (const satir of konsol) {
      const kalan = satir.replace(/\$\{hataKodu\(hata\)\}/g, '').replace(/\$\{hataSinifi\}/g, '');
      expect(kalan, satir.trim()).not.toMatch(/\$\{|talepId|talepNo|alanlar|\bkim\b|okunan|revize\./);
    }
  });
});
