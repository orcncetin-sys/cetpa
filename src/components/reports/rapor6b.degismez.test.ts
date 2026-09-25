/**
 * rapor6b.degismez.test.ts — Faz 3 6b (GENEL I) KAPANIŞ ÖLÇÜSÜ (2026-09-24).
 *
 * Neden var: PLAN-v2 §5 "SERT (alt fazın kendi dosyalarında = 0)" der; 6a bu ölçüyü YALNIZ kendi üç
 * dosyası için yazdı. 6b'nin üç dosyası (GenelBloklar1 · GenelBloklar3 · UrunlerRapor) için aynı ölçüyü
 * kimse yazmazsa 6b kapanışı ölçüsüz kalır (6a'daki "sahipsiz iş" boşluğunun aynısı). Bu dosya:
 *   §0c geçici kopya çiti: `rapor6a.degismez.test.ts`'in SATIR İÇİ tarayıcısı paylaşılan modülle AYNI mı
 *   §1  üç 6b dosyasında SERT 1–3 kod satırı = 0 (izin listesi mekanizması var, hedef BOŞ)
 *   §1b izin listesi disiplini (6a ile birebir; alt sınır 6c — 6b kendi satırını kendine devredemez)
 *   §2  K9: `* 0.6` uydurma maliyet üç dosyada = 0 (izin listesi YOK — kullanıcı kararı devredilemez)
 *
 * Tarayıcı `src/test/degismezTarayici.ts`'ten İÇE AKTARILIR: 6a'daki satır içi gövdeden çıkarıldı, kopya
 * yazılmadı (kök neden 2026-09-04). `rapor6a.degismez.test.ts` DÜZENLENMEDİ — 6a'nın dosyası; satır içi
 * kopyası orada geçici olarak yaşar, §0c ayrışmayı çitler, kalıcı çözüm orkestratörün (en geç 6m).
 *
 * Ölçülen taban (HEAD 5b4d2d5, bağlama ÖNCESİ, yorum süzgeçli): GB1 S1 10 · S2 13 · S3 2 (`:244` `|| 1`,
 * `:452` `* 0.6`) — GB3 S1 13 · S2 7 · S3 1 (`:387` `|| 1`; `:213` TEK satırda S1+S2) — UrunlerRapor S1 1
 * (`:64`) · S3 1 (`:63`) → 47 ayrık ihlal satırı, `* 0.6` 1. Bağlama SONRASI (2026-09-24, bu dosya
 * yazılırken): 0 / 0 / 0 ve `* 0.6` 0; ham grep yalnız 7 YORUM anması buluyor (UrunlerRapor 16/17/25,
 * GB1 153/294/362/508) — süzgeç hepsini eler, `degismezTarayici.test.ts` §0 vaka 8 bunu gerçek satırla sınar.
 *
 * Test bir ÖLÇÜDÜR, onarım aracı DEĞİL: kırmızıysa kaçırılmış site demektir — izin listesine girdi ekleyerek
 * ya da deseni gevşeterek yeşile çevirme (§0b deseni PLAN-v2 §5'e kilitler), kaçıran grubun dosyasını düzelt.
 *
 * Bilerek YAZILMAYANLAR: SERT 4 (`typeof …total === 'number'` · `.stock` · `itemCostTRY(`/`itemPriceTRY(`)
 * — PLAN-v2 §5 onları 6d/6h'ye verdi; başka alt fazın ölçüsünü çalmak o alt faz kapanmadan gürültü üretir.
 * K2/K4 kaynak taraması — 6a dersi: metin taraması çağrı doğruluğunu kanıtlayamaz (GB3'te yedi müşteri
 * gruplama sitesi var; "musteri'yi import ediyor" yedisinin de bağlandığını göstermez); guard bağlama
 * ajanının birim testidir. `utils/rapor/*` export→tüketici iddiası — 6a §2 dizini TARAR, 6b'nin yeni
 * modülleri (crmMusteri, lojistik, skor, yogunlasma) oraya düştüğü an kendiliğinden kapsama girer; kopya
 * iki testin ayrışması olurdu. `utils/rapor` DIŞI additive export'lar (6a'daki `EK_EXPORTLAR` eşdeğeri) —
 * ORKESTRATÖR kararı, kapanışta `git grep "export function" -- src/utils src/lib` ile ÖLÇEREK doldurulur.
 * `GÖZDEN GEÇİRME` desenleri (`: 0`, `= 1` varsayılan parametre, `minHeight`) — hedefi 0 değil, iddia değil.
 * KAPSAM: yalnız aşağıdaki ÜÇ dosya. Dizin/glob taraması, `reports/**` geneli bu testte YASAK.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SERT_DESENLERI, SINIFLAR, sertIhlalleri, ihlalYaz, yorumsuz, type Ihlal } from '../../test/degismezTarayici';

const SRC = join(__dirname, '..', '..');                 // src/components/reports → src

const UC_DOSYA = [
  'components/reports/genel/GenelBloklar1.tsx',
  'components/reports/genel/GenelBloklar3.tsx',
  'components/reports/UrunlerRapor.tsx',
] as const;

const oku = (goreli: string) => readFileSync(join(SRC, goreli), 'utf-8');

// ---------------------------------------------------------------------------
// §0c · geçici kopya çiti (ÖN KOŞUL 2'nin bedeli)
// ---------------------------------------------------------------------------

// 6a'nın dosyası DÜZENLENMEDİ; tarayıcı orada satır içi kopya olarak yaşamaya devam ediyor. İki kopya
// sessizce ayrışmasın diye 6a'nın METNİ okunur (yalnız okunur) ve `SERT` bloğundaki desen metinleri +
// `yorumsuz` gövdesi paylaşılan modülünküyle karşılaştırılır. §0b modülü PLAN-v2 §5 listesine kilitlediği
// için zincir kapalıdır: 6a metni ≡ modül ≡ PLAN-v2 §5. Orkestratör 6a'yı modüle bağladığında bu bölüm
// gereksizleşir ve SİLİNİR (6m maddesi).
describe('§0c · rapor6a.degismez.test.ts satır içi tarayıcı = paylaşılan modül (geçici kopya çiti)', () => {
  const altiA = readFileSync(join(__dirname, 'rapor6a.degismez.test.ts'), 'utf-8');
  const modul = readFileSync(join(SRC, 'test', 'degismezTarayici.ts'), 'utf-8');

  // `/…/` sabitleri: kaçışlı çift ya da `\` ve `/` dışı karakter; kapanıştan sonra `,` veya `]` gelir.
  const desenMetinleri = (satir: string) => [...satir.matchAll(/\/((?:\\.|[^\\\/])+)\/(?=\s*[,\]])/g)].map(e => e[1]);

  it('6a satır içi `const SERT = {` bloğu hâlâ orada (bağlandıysa bu bölüm SİLİNİR)', () => {
    expect(altiA.includes('const SERT = {')).toBe(true);
    expect(altiA.includes('} as const;')).toBe(true);
  });

  for (const s of SINIFLAR) {
    it(`6a ${s} desen metinleri modülle birebir`, () => {
      const blok = altiA.slice(altiA.indexOf('const SERT = {'), altiA.indexOf('} as const;'));
      const satirlar = blok.split('\n').filter(l => new RegExp(`^\\s*${s}:`).test(l));
      expect(satirlar, `6a SERT bloğunda ${s} satırı`).toHaveLength(1);
      expect(desenMetinleri(satirlar.join('\n'))).toEqual(SERT_DESENLERI[s].map(d => d.source));
    });
  }

  it('6a `yorumsuz` gövdesi modüldekiyle birebir (boşluk düzeni hariç)', () => {
    const govde = (metin: string, kaynak: string) => {
      const bas = metin.indexOf('function yorumsuz(');
      expect(bas, `${kaynak} · yorumsuz tanımı`).toBeGreaterThanOrEqual(0);
      const son = metin.indexOf('\n}', bas);
      return metin.slice(bas, son + 2).replace(/\s+/g, ' ');
    };
    expect(govde(altiA, 'rapor6a')).toBe(govde(modul, 'degismezTarayici'));
  });
});

// ---------------------------------------------------------------------------
// §1 · DEĞİŞMEZ: 6b'nin üç dosyasında SERT 1–3 kod satırı = 0
// ---------------------------------------------------------------------------

/**
 * İzin listesi — MEKANİZMA var, 6b kapanış hedefi BOŞ.
 * Girdi eklemenin TEK meşru yolu: bir 6b bağlama şartnamesi (`6b/baglama-*.md` / `6b/utils-*.md`) o satırı
 * ALT FAZ ADIYLA (6c–6m) devretmişse. Ölçüm (baglama-degismez.md §1b): 47 ihlal satırının HİÇBİRİ 6c+'ya
 * devredilmedi — K8 tuzağı (GB1 `:523` `(i.stockLevel ?? 0)`: çift kurlu tablo 6h'nin ama `?? 0` 6b'de
 * `degerToplami`+`tamTutar` ile düşer) ve maliyet yedeği tuzağı (GB3 `:248/:324/:379/:472`
 * `(li.costPrice || 0)`: `* 0.6`'nın kardeşi, `pano/raporMarj` ya da `siparisler/siparisKarlilik`'e
 * bağlanır) izin girdisi GEREKTİRMEZ.
 */
interface Izin { dosya: string; parca: string; altFaz: string; gerekce: string }
const IZIN_LISTESI: Izin[] = [];
const izinli = (i: Ihlal) => IZIN_LISTESI.some(z => z.dosya === i.dosya && i.kod.includes(z.parca));

const ihlaller: Ihlal[] = UC_DOSYA.flatMap(d => sertIhlalleri(d, oku(d)));

describe('§1 · DEĞİŞMEZ: 6b üçlüsünde SERT 1–3 = 0', () => {
  it('bayatlama koruması: üç dosya da var ve yorum süzgeci dosyayı yutmadı', () => {
    // Eşik 100'de KALIR (ölçüm: 700 / 606 / 177 dolu satır — UrunlerRapor'un payı dar, yükseltilmez).
    for (const d of UC_DOSYA) {
      expect(existsSync(join(SRC, d)), d).toBe(true);
      const dolu = yorumsuz(oku(d)).filter(s => s.trim() !== '').length;
      expect(dolu, `${d} · yorumsuz sonrası dolu satır`).toBeGreaterThan(100);
    }
  });

  // Sınıf başına ayrı `it`; mesaj `dosya:satır kod` basar — "N ihlal var" gibi sayıya indirgeme YOK,
  // hakem hangi sitenin kaçırıldığını görmeli.
  for (const sinif of SINIFLAR) {
    it(`${sinif} ihlali yok`, () => {
      expect(ihlaller.filter(i => i.sinif === sinif && !izinli(i)).map(ihlalYaz)).toEqual([]);
    });
  }
});

describe('§1b · izin listesi disiplini (liste boşken de kural yaşar)', () => {
  it('her girdi 6c–6m arası bir alt faza devredilmiş, gerekçeli ve YETERİNCE DAR', () => {
    for (const z of IZIN_LISTESI) {
      // 6a'da `/^6[b-m]$/` idi; 6b kendi satırını kendine devredemez → alt sınır 6c.
      expect(z.altFaz, `${z.dosya} · ${z.parca}`).toMatch(/^6[c-m]$/);
      expect(z.gerekce.length, `${z.dosya} · ${z.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      expect(z.gerekce, `${z.dosya} · ${z.parca} · şartname alıntısı`).toMatch(/(?:baglama|utils)-[\w-]+\.md/);
      expect(z.parca.length, `${z.dosya} · ${z.parca} · parça çok genel`).toBeGreaterThanOrEqual(16);
    }
  });

  it('bayat izin YOK: her girdi hâlâ TEK bir ihlalle eşleşir', () => {
    for (const z of IZIN_LISTESI) {
      const eslesen = ihlaller.filter(i => i.dosya === z.dosya && i.kod.includes(z.parca));
      expect(eslesen.map(ihlalYaz), `${z.dosya} · ${z.parca}`).toHaveLength(1);
    }
  });

  it('liste "küçük" kalır (6m\'de boşalır)', () => {
    expect(IZIN_LISTESI.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// §2 · K9: `* 0.6` uydurma maliyet üç dosyada = 0
// ---------------------------------------------------------------------------

// K9 — KULLANICI CÜMLESİ YOK (KARARLAR.md'de "K9" geçmez): PLAN-v2 §8 sıra 12 «K9 | × 0,6 uydurma maliyet kalkıyor |
// Teyit (5/n emsali)» — 5/n'deki kararla aynı, teyit. (Delta 2026-09-24, hakem bulgu 7: bu satırda daha önce K8'in
// cümlesi — "alış günü maliyetinin dolar kurundan çek…" — K9'a mal edilmişti; o cümle KARARLAR.md K8 'stok değeri
// tabanı' kararıdır ve 6h'nin çift kurlu tablosunu tanımlar, `× 0,6`yla ilgisi yoktur. Kaynak hata şartname
// 6b/baglama-degismez.md §2'deydi; ikisi birlikte düzeltildi.) Kural: maliyeti bilinmeyen kaleme `satış × 0,6`
// UYDURULMAZ; bilinmiyorsa BİLİNMİYOR. Tek site GB1 `:452` `tier.cogs += (inv ? itemCostTRY(inv, exchangeRates) :
// li.price * 0.6) * li.quantity;` (P203 kademe COGS) idi; GB3 ve UrunlerRapor'da 0 → onlar için gerileme çiti.
//
// SERT 3 deseni `\*\s*0\.6\b`'yi ZATEN içerir; bu bölüm BİLEREK ayrı: (a) K9 adıyla anılan tek iddia olur,
// (b) ileride biri SERT 3'ü "sadeleştirirse" K9 sessizce ölmez — çift çit, kasıtlı. İZİN LİSTESİ YOK:
// K9 kullanıcı kararıdır, devredilemez.
//
// KAPSAM ÜÇ DOSYADIR. Ölçüm 2026-09-24: EnvanterRapor `:454/:1266/:2933/:3040/:3403`, GenelBloklar2 `:341`,
// GenelBloklar4 `:314`, crm/MusteriKarAnalizi `:34`, FinancePanel `:171` hâlâ `* 0.6` taşıyor — 6c/6d/6e/6h'nin
// işi, bu test onları GÖRMEZ. `SubeModule:181` `* 0.65` ve `LandingPage:362` `* 0.68` desenin `\b`
// sınırına takılmaz (`degismezTarayici.test.ts` §0 vaka 5 sınar).
const K9_DESENI = /\*\s*0\.6\b/;

describe('§2 · K9: `* 0.6` uydurma maliyet üç dosyada = 0', () => {
  it('`* 0.6` kod satırı yok (yorum anması sayılmaz; izin listesi YOK)', () => {
    const siteler = UC_DOSYA.flatMap(d => yorumsuz(oku(d))
      .map((kod, i): Ihlal => ({ dosya: d, satir: i + 1, sinif: 'S3', kod }))
      .filter(s => K9_DESENI.test(s.kod)));
    expect(siteler.map(ihlalYaz)).toEqual([]);
  });

  it('K9 deseni SERT 3 listesinde de var (çift çit — biri düşerse öteki haber verir)', () => {
    expect(SERT_DESENLERI.S3.map(d => d.source)).toContain(K9_DESENI.source);
  });
});

// ── §3 · 6b push-öncesi inceleme (2026-09-25) — bileşen içi kurallar, render testi olmadığı için kaynakta çitlenir ──
describe('§3 · inceleme 2026-09-25: kapı/küme kuralları geri kaymasın', () => {
  const gb1 = yorumsuz(oku('components/reports/genel/GenelBloklar1.tsx')).join('\n');
  const gb3 = yorumsuz(oku('components/reports/genel/GenelBloklar3.tsx')).join('\n');
  it('GB1 aylık kovalar ay dönümünde yeniden kurulur (ay anahtarı memo bağımlılığında)', () => {
    expect(gb1).toMatch(/const aylar6 = useMemo\([^;]*\[orders, dil, buAy\]\)/);
    expect(gb1).toMatch(/const aylar12 = useMemo\([^;]*\[orders, dil, buAy\]\)/);
  });
  it('GB1 P217 ürün gruplaması UrunlerRapor ile aynı (başlık yedeği)', () => {
    expect(gb1).toMatch(/urunSatislari\(iptalsiz217, \{ baslikYedegi: true, tutarSec: kalemTutari \}\)/);
  });
  it('GB3 P3 kapısı dilimlenen kümeden (iptaller sayılmaz)', () => {
    expect(gb3).toMatch(/iptalsiz\.length >= KUARTIL_ASGARI_SIPARIS/);
    expect(gb3).not.toMatch(/orders\.length >= 20/);
  });
  it('GB3 P2 AOV: ekran değeri boş pencerede uydurulmaz (skor girdisi ayrı)', () => {
    expect(gb3).toMatch(/curr: aovEkran\(curr260\), prev: aovEkran\(prev260\), skorCurr: aovSkor\(curr260\)/);
    expect(gb3).not.toMatch(/curr: aovSkor\(/);
  });
  it('GB3 P9 ortalamaya giren ay marjın kendi kümesiyle (ciroTutar) seçilir', () => {
    expect(gb3).toMatch(/const ortalamayaGiren = aylik\.filter\(a => ayOlculur\(a\.m\.ciroTutar\)\)/);
    expect(gb3).toMatch(/toplaBilinen\(ortalamayaGiren, a => a\.m\.marj\)/);
  });
});
