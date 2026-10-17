/**
 * rapor6c.degismez.test.ts — Faz 3 6c (GENEL II) KAPANIŞ ÖLÇÜSÜ (2026-10-17).
 *
 * Neden var: PLAN-v2 §5 "SERT (alt fazın kendi dosyalarında = 0)" der; 6a kendi üç, 6b kendi üç dosyası için bu
 * ölçüyü yazdı. 6c'nin iki dosyası (GenelBloklar2 · GenelBloklar4) için kimse yazmazsa 6c kapanışı ölçüsüz kalır
 * (6a'daki "sahipsiz iş" boşluğu). 6c'ye özgü ikinci neden ÇİFT PANELLER: GB2 ile GB4 aynı metriğin iki çelişen
 * tanımını taşıyordu — HHI (GB2 P220 0–10.000 ölçekli, iptal hariç; GB4 P370 0–1 ölçekli, iptal dâhil), ödeme
 * yöntemi (GB2 P249 ↔ GB4 P270, hayalet `payment` / `payment_method` yedekleri) ve aylık brüt marj eğilimi
 * (GB3 P9 ↔ GB4 P306). Yarım düzeltme sınıfının tam yeri: biri testli yardımcıya bağlanır, öteki eski tanımla
 * yaşamaya devam eder. Metin taraması ÇAĞRI DOĞRULUĞUNU kanıtlayamaz (6a dersi), ama ikinci bir hesap yerinin /
 * panelin YOKLUĞUNU kanıtlayabilir — §3 yalnız bunu iddia eder.
 *
 * Bölümler:
 *   §1  GB2 + GB4'te SERT 1–3 kod satırı = 0 (izin listesi mekanizması var, hedef BOŞ)
 *   §1b izin listesi disiplini (6b ile birebir; alt sınır 6d — 6c kendi satırını kendine devredemez)
 *   §1c O15: `Math.max(` kod satırı = 0 (paylaşılan S2 deseninin göremediği piksel / ölçek tabanları)
 *   §2  K9 + O14: `* 0.6` uydurma maliyet = 0 ve iki dosyada TEK maliyet çözücü (`itemCostTRY` kalmaz)
 *   §3  K16 / K14 / O3 / O4 / O22 / O23: çift paneller — tek tanım kalır; hayalet alan okunmaz
 *   §3b K2 / K4 / O5 / O21: elle iptal süzgeci ve adla gruplama kalıntısı yok; TRY dışı süzgeci çağıranda; üst düzey
 *       süzgeçler kodda VAR, ham `orders` yardımcıya verilmez, her `musteriOzeti(` K4 haritalı seçeneği alır, her
 *       `yilAylikCiro(` `{ iptalHaric: true }` taşır (3b.9)
 *   §3c O6: GB4 P337 `yuzdelikler(` tek çağrı ve `sadecePozitif: true`
 *   §3d O20 + dil: GB2 P239 `kpis239`'un her öğesi `eksikAdi` taşır (tip alanı zorunlu)
 *   §4  kâhin: dosyalar gerçekten okunuyor, panel kapıları ve render çağrıları yerinde, yerel desenler boş değil
 *   §5  O1 + O2 + O10 + O23: 6c'nin `utils/rapor` DIŞI ek export'ları tüketiliyor; `anahtarsizSay` yalnız GB4'te
 *
 * Ölçülen taban (bağlama ÖNCESİ, yayin-18 `a55d5ba`, paylaşılan `yorumsuz` + `sertIhlalleri` ile): GB2 S1 17 ·
 * S2 4 · S3 3 → 23 ayrık ihlal satırı (24 kayıt); GB4 S1 16 · S2 8 · S3 4 → 25 ayrık satır (28 kayıt); `* 0.6`
 * 2 (GB2 P239 finansal sağlık, GB4 P306 brüt marj eğilimi); `Math.max(` 15 satır; `itemCostTRY` 6 satır; GB4
 * panel kapısı 14. Kapanış beklentisi: 48 → 0 ayrık satır, `* 0.6` 2 → 0, `Math.max(` 15 → 0, `itemCostTRY`
 * 6 → 0, GB4 kapı 14 → 11, IZIN_LISTESI boş. Şartname: `6n-kesif/6c/baglama-degismez.md` (v3).
 *
 * Paket mutasyonları (2026-10-17, kopya ağaçta koşuldu): yalnız içe aktarımı / çağrı varlığını çitleyen dört iddia,
 * bağ koparılınca yeşil kalıyordu — üst düzey K2 / O21 süzgeci silinmesi (içe aktarım dövizli kümede yaşıyor), P238 /
 * P495 segmentleyicisinin koparılması (sayaç satırları aynı yardımcıyı çağırıyor), tür dönüşümlü hayalet kategori
 * okuması, `musteriSecenek`'ten K4 haritasının düşmesi. Çitleri: 3.10 / 3.11 ikinci yarıları, 3b.6, 3b.7, 3b.8 ve 4c'deki
 * mutasyon fikstürleri. Hepsi VARLIK / YOKLUK iddiasıdır; çağrının doğruluğu yine birim testlerinde.
 *
 * Test bir ÖLÇÜDÜR, onarım aracı DEĞİL: kırmızıysa bağlamanın kaçırdığı site demektir — izin listesine girdi
 * ekleyerek ya da deseni gevşeterek yeşile çevirme; kaçıran grubun dosyasını düzelt. Kırmızının mesajı
 * `dosya:satır kod` basar (sayıya indirgenmez).
 *
 * Paylaşılan tarayıcı (`src/test/degismezTarayici.ts`) ve dosya okuyucu (`src/test/kaynakTarama.ts`) İÇE
 * AKTARILIR, kopyalanmaz (kök neden 2026-09-04). 6c'nin kendine özgü desenleri BU DOSYADA durur — ortak modüle
 * eklenmez (desen kilidi `degismezTarayici.test.ts` §0b). Dosya içeriği YALNIZ katı `yorumsuz(ad, içerik)`
 * girişine verilir; hoşgörülü `yorumsuzParca` yalnız satır içi fikstür alır (`degismezTarayici.test.ts` §10 çiti).
 *
 * Bilerek YAZILMAYANLAR:
 *   - K2 / K4 ÇAĞRI sayıları (`musteriOzeti(`, `cetpaAlacak(`, `brutMarj(`): metin taraması çağrı doğruluğunu
 *     kanıtlayamaz ve meşru bir yeniden düzenlemede yanlış kırmızı üretir; bağlama kapanış grep'i + hakemin işi.
 *     Tek istisna `yogunlasma(` = 1 — K16 "tek hesap" kararının kendisi (§3.1).
 *   - K15 / K23 / K28 / K-YÜZDE / O12 / O13 / O16 / O17 / O18 / O20 (§3d'nin `eksikAdi` sayısı dışında) / O24 kaynak
 *     taraması; O21'in dövizli SAYACI;
 *     O22'nin mağaza / girilmemiş / eşleşmeyen / kategorisiz sayaçları — tanım, biçim ve etiket kararlarıdır;
 *     doğrulukları modül birim testlerinde ve hakemin elle okumasındadır.
 *   - SERT 4'ün `reports/**` geneli (`typeof …total === 'number'`, `.stock`, `itemCostTRY(`) — PLAN-v2 §5 onları
 *     6d / 6h'ye verdi; `itemCostTRY` burada YALNIZ iki dosyada iddia edilir (§2).
 *   - `utils/rapor/*` export→tüketici — `rapor6a.degismez` §2 dizini tarar; 6c ekleri oraya düştüğü an kapsama
 *     girer (yogunlasma, HHI_ESIKLERI, calisanDurumu, maasKutlesi, haftaGunIzgarasi, aktifGunSerisi, yuzdelikler).
 *   - `GÖZDEN GEÇİRME` desenleri (`: 0`, `= 1` varsayılan parametre, `minHeight`), `reduce(` / `toFixed(` sayıları,
 *     O19 kapsam dışı işler ve 6b'nin §0c kopya çiti (kopya çitin kopyası olurdu).
 * KAPSAM: yalnız iki dosya (GB2, GB4) + `GenelRapor.tsx`'in çağrı yeri. Dizin / glob taraması bu testte YASAK.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { SERT_DESENLERI, SINIFLAR, sertIhlalleri, ihlalYaz, yorumsuz, yorumsuzParca, type Ihlal } from '../../test/degismezTarayici';
import { SRC_KOK, oku, suclular } from '../../test/kaynakTarama';

const GB2 = 'components/reports/genel/GenelBloklar2.tsx';
const GB4 = 'components/reports/genel/GenelBloklar4.tsx';
const GENEL_RAPOR = 'components/reports/GenelRapor.tsx';
const IKI_DOSYA = [GB2, GB4] as const;
const yol = (goreli: string) => join(SRC_KOK, goreli);
// Yorum DAHİL ham metin — yalnız §3.5'in karar izi iddiası ve §1 / §4b'nin `sertIhlalleri` girdisi.
const ham = (goreli: string) => oku(yol(goreli));
// KATI giriş: ad + AYNI yoldan içerik (yer değiştiremez; `.tsx` adı TSX ayrıştırmasını seçer).
const kodMetni = (goreli: string) => yorumsuz(goreli, ham(goreli)).join('\n');
// 4c'nin yorumlu fikstürleri için — YALNIZ literal alır (degismezTarayici.test.ts §10 çiti; parametre adı `icerik` / `kaynak` OLMAZ).
const parcaKodu = (fikstur: string) => yorumsuzParca('fikstur.tsx', fikstur).join('\n');
// "bu desen hiçbir KOD satırında yok" iddialarının ortak biçimi: `src/…:satır kod` (sayıya indirgenmez).
const siteler = (dosyalar: readonly string[], desen: RegExp) =>
  suclular(dosyalar.map(yol), desen).map(s => `${s.site} ${s.kod.trim().slice(0, 140)}`);
// Yerel desenlerin HEPSİ bayraksızdır (`suclular` `desen.test` çağırır — `g` bayrağı `lastIndex` taşır);
// sayım gereken yerde genel bayraklı KOPYA kullanılır.
const eslesmeSayisi = (metin: string, desen: RegExp) => [...metin.matchAll(new RegExp(desen.source, 'g'))].length;
const kararSatirlari = (metin: string, desen: RegExp) => metin.split('\n').filter(s => desen.test(s)).length;

// Çözümleme kuralı rapor6a.degismez.test.ts `raporIceAktarimlari` ile AYNI desen (`type` atılır, `e as g` → e);
// yorumdaki import SAYILMAZ çünkü çağıran `kodMetni` (katı `yorumsuz`) verir. §3.11, §3b.5 ve §5 bunu kullanır.
const iceAktariyor = (metin: string, modul: string, ad: string): boolean =>
  [...metin.matchAll(/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .some(e => e[2].endsWith(modul) && e[1].split(',').some(p => p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] === ad));
// §5.2 (O10): `segmentCirosu`'nun 4. parametresi `anahtarsizSay` — 4c tablosu da kullandığı için burada tanımlı.
const ANAHTARSIZ_SAYACI = /\banahtarsizSay\b/;

// ---------------------------------------------------------------------------
// §1 · DEĞİŞMEZ: GB2 + GB4'te SERT 1–3 kod satırı = 0
// ---------------------------------------------------------------------------

/**
 * İzin listesi — MEKANİZMA var, 6c kapanış hedefi BOŞ.
 * Girdi eklemenin TEK meşru yolu: bir 6c şartnamesi (`6c/baglama-*.md` / `6c/utils-*.md`) o satırı ALT FAZ ADIYLA
 * (6d–6m) AÇIKÇA devretmişse. Ölçüm (2026-10-17, `grep -n "6[d-m]" 6c/*.md`): devir yalnız O19 kapsam dışı işler,
 * K8 çift kurlu tablosu (6h) ve `aylikBordro` (6l) için geçiyor — hiçbiri SERT satırı değil. Tuzaklar izin girdisi
 * GEREKTİRMEZ: K8 (stok değeri `?? 0` 6c'de `degerToplami` + `kartMaliyetiTL` ile düşer), maliyet okuması
 * (kalemin `costPrice`'ı tek çözücünün içinde — O14 / O24), K23 (maaş kütlesi `maasKutlesi` — 6c kararı),
 * düşük stok eşiği (`dusukStokKalemleri` 5'i uydurmaz — K10).
 */
interface Izin { dosya: string; parca: string; altFaz: string; gerekce: string }
const IZIN_LISTESI: Izin[] = [];
const izinli = (i: Ihlal) => IZIN_LISTESI.some(z => z.dosya === i.dosya && i.kod.includes(z.parca));

const ihlaller: Ihlal[] = IKI_DOSYA.flatMap(d => sertIhlalleri(d, ham(d)));

describe('§1 · DEĞİŞMEZ: GB2 + GB4\'te SERT 1–3 = 0', () => {
  // Kapsam SERT 1–3'ün TAMAMI. O15: iki bağlama şartnamesi (GB2 "KAPSAM LİSTESİ", GB4 "Sahte kesinlik envanteri")
  // tarayıcının 48 satırının 48'ini de kapsıyor → test bağlamanın kapsadığından FAZLASINI iddia etmiyor.
  // Sınıf başına ayrı `it`; mesaj `dosya:satır kod` basar — hakem hangi sitenin kaçırıldığını görmeli.
  for (const sinif of SINIFLAR) {
    it(`${sinif} ihlali yok`, () => {
      expect(ihlaller.filter(i => i.sinif === sinif && !izinli(i)).map(ihlalYaz)).toEqual([]);
    });
  }
});

describe('§1b · izin listesi disiplini (liste boşken de kural yaşar)', () => {
  it('her girdi 6d–6m arası bir alt faza bir 6c şartnamesiyle devredilmiş, gerekçeli ve YETERİNCE DAR', () => {
    for (const z of IZIN_LISTESI) {
      // 6b'de `/^6[c-m]$/` idi; 6c kendi satırını kendine devredemez → alt sınır 6d.
      expect(z.altFaz, `${z.dosya} · ${z.parca}`).toMatch(/^6[d-m]$/);
      expect(z.gerekce.length, `${z.dosya} · ${z.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      // 6b'nin öneksiz deseni burada daraltılır: devri yapan bir 6c şartnamesi olmalı.
      expect(z.gerekce, `${z.dosya} · ${z.parca} · şartname alıntısı`).toMatch(/6c\/(?:baglama|utils)-[\w-]+\.md/);
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
// §1c · O15: `Math.max(` kod satırı iki dosyada = 0
// ---------------------------------------------------------------------------

// Neden ayrı: paylaşılan S2 deseni yalnız ilk argümanı 2–4 ya da son argümanı 1 / 2–4 olan `Math.max(`'ı arar;
// GB2 P251 YoY çubuğundaki `Math.max(m.curr > 0 ? 2 : 0, currH)` piksel tabanını ve GB4 P528 seri sayacındaki
// `Math.max(maxStreak, cur)`'u görmez. Bağlamadaki karşılığı: GB2 kapanışı `Math\.max\(` → 0, GB4 kapanışı
// `grep -c 'Math\.max('` → 0 — iddia bağlamanın kapsadığıyla BİREBİR. `Math.min(` İDDİA EDİLMEZ (GB2 P225
// `Math.min(projeksiyonaOran, 100)` üst kırpmadır, taban değil). İzin listesi YOK.
const MATH_MAX = /Math\.max\(/;

describe('§1c · O15: `Math.max(` kod satırı iki dosyada = 0', () => {
  it('piksel / ölçek tabanı kalıntısı yok (yorum anması sayılmaz)', () => {
    expect(siteler(IKI_DOSYA, MATH_MAX)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 · K9 + O14: `* 0.6` uydurma maliyet = 0 ve TEK maliyet çözücü
// ---------------------------------------------------------------------------

// K9 — KULLANICI CÜMLESİ YOK (KARARLAR.md'de "K9" geçmez): PLAN-v2 §8 sıra 12 «K9 | × 0,6 uydurma maliyet kalkıyor |
// Teyit (5/n emsali)», alt fazlar 6h, 6i, 6c. Kural: maliyeti bilinmeyen kaleme `satış × 0,6` UYDURULMAZ; bilinmiyorsa
// BİLİNMİYOR. Bugünkü iki site: GB2 P239 finansal sağlık (`li.price * 0.6`) ve GB4 P306 brüt marj eğilimi
// (`lineCost || … * 0.6`). Bağlamadaki karşılığı: GB2 P239 `brutMarj(...)` (bilinmeyen maliyet sayaçta), GB4 P306
// panelle birlikte SİLİNİR (O23). SERT 3 deseni `\*\s*0\.6\b`'yi ZATEN içerir; bu bölüm BİLEREK ayrı (çift çit:
// biri SERT 3'ü "sadeleştirirse" K9 sessizce ölmez). İZİN LİSTESİ YOK: K9 devredilemez.
//
// KAPSAM İKİ DOSYADIR: EnvanterRapor, crm/MusteriKarAnalizi, FinancePanel vb. 6d / 6e / 6h'nin işi; `* 0.6`'nın
// `reports/**` geneli değişmezi PLAN-v2 §5 gereği 6h'nindir.
const K9_DESENI = /\*\s*0\.6\b/;
// O14 / O24 "tek çözücü": iki dosyada eski `itemCostTRY` okuyucusu kalırsa aynı dosyada İKİ maliyet tanımı yaşıyor
// demektir. Bağlamadaki karşılığı: GB2 `brutMarj` + `kartMaliyetiTL`, GB4 `stokMaliyetCozucu` + `kartMaliyetiTL`
// (kalemin `costPrice`'ı çözücünün içinde ve ÖNCE — sıra burada iddia EDİLMEZ, davranış `raporMarj.test.ts`'te);
// iki kapanış grep'i de `itemCostTRY` → 0 istiyor. SERT 4'ün `reports/**` geneli 6h'nindir.
const ESKI_MALIYET_OKUYUCU = /\bitemCostTRY\b/;

describe('§2 · K9 + O14: `* 0.6` uydurma maliyet = 0 ve tek maliyet çözücü', () => {
  it('`* 0.6` kod satırı yok (yorum anması sayılmaz; izin listesi YOK)', () => {
    expect(siteler(IKI_DOSYA, K9_DESENI)).toEqual([]);
  });

  it('K9 deseni SERT 3 listesinde de var (çift çit — biri düşerse öteki haber verir)', () => {
    expect(SERT_DESENLERI.S3.map(d => d.source)).toContain(K9_DESENI.source);
  });

  it('O14: iki dosyada eski `itemCostTRY` maliyet okuyucusu kalmadı (tek çözücü)', () => {
    expect(siteler(IKI_DOSYA, ESKI_MALIYET_OKUYUCU)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 · K16 / K14 / O3 / O4 / O22 / O23: çift paneller — tek tanım kalır; hayalet alan okunmaz
// ---------------------------------------------------------------------------

// K16 kullanıcı 2026-09-19: "Ok." — 0–10.000; 1.500 / 2.500; tek panel + "Cironun %X'i ilk 3 müşteriden" (KARARLAR.md)
// K14 kullanıcı: "kaldır" — HHI ve ödeme yöntemi çiftlerinde GB2'deki, brüt marj eğiliminde GB3'teki panel kalır (KARARLAR.md K14; orkestratör O3 + O4 + O23)
// K21 kullanıcı: "Tüm ciro" — "ilk N" payının paydası TÜM bilinen ciro; hesap `yogunlasma` içinde, burada yalnız metnin varlığı.
// K13 kullanıcı: "veri eklenebiliyorsa ver, mikro yüzünden verilemiyorsa N/A yaz, CETPA App verisi varsa N/A+ "xx,xx"
// göster." + O22 — GB4'ün şehir ve kategori panelleri YAZICILI alana bağlı; test yalnız BAĞI ve hayalet okumanın
// YOKLUĞUNU çitler, panelin dolduğunu kanıtlamaz (canlı veri).
//
// Kaynakta doğrulanabilir imzalar (3.5 dışında hepsi yorumsuz KOD üstünde — kararın yorum olarak yazılması iddiayı
// BOZMAZ). Desenler BAYRAKSIZ; `YEREL_HHI_ESIGI`'ne `i` bayrağı YASAK: eklenirse GB2 P220 dipnotundaki dize içi
// `HHI > 2500` da yakalanır — dize taraması 3.6'nın işidir.
const HHI_CAGRISI = /\byogunlasma\(/;
const HHI_IMPORTU = /import\s*\{[^}]*\byogunlasma\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/utils\/rapor\/yogunlasma['"]/;
const EL_YAPIMI_HHI = [/Math\.pow\(/, /\+\s*(\w+)\s*\*\s*\1\s*,\s*0\s*\)/] as const;                 // GB2 P220 · GB4 P370 elle HHI
const YEREL_HHI_ESIGI = /\bhhi\w*\s*[<>]=?\s*(?:2500|1500|0?\.25|0?\.1)\b/;                            // GB2 P220 · GB4 P370 yerel eşik
const HHI_ESIK_LITERALI = /\b[12]500\b/;                                                                // GB2 P220 eşik + dipnot
const GB4_HHI_IZI = /\bhhi|HHI|\byogunlasma\(|Revenue Concentration|Ciro Yoğunlaşması/;                  // GB4 P370 panel izi
const ILK_N_METNI = /ilk (?:3|\$\{[^}]+\}) müşteri/;                                                    // O4: "Cironun ilk N müşteriden gelen payı"
const GB4_ODEME_IZI = /paymentMethod|payment_method|\bpmMap\b|Payment Method|Ödeme Yöntemi|odemeYontemiSegmenti/;   // GB4 P270 panel izi
const HAYALET_ODEME_ALANI = /\.payment\b|payment_method/;                                               // GB2 P249 · GB4 P270 yedekleri
const PANEL_KAPISI = /reportsTab === 'genel'/;
// v3 (O22 / O23):
const HAYALET_SEHIR_ALANI = /\.city\b|\bshippingCity\b/;                                                 // GB4 P238 eski okuma
const SEHIR_OKUYUCU = /\bsiparisSehri\(/;                                                              // GB4 P238 yazıcılı kaynak
// Paket mutasyonu (2026-10-17): kalemi tür dönüşümüyle okuyan hayalet erişim (`(li as Record<…>).category`, `li['category']`)
// eski `li.category` deseninden KAÇIYORDU → iki biçim de eklendi. `kartBul(li)?.category` (`)?.`) TAKILMAZ (4c).
const HAYALET_KALEM_ALANI = /\bli\.category\b|\bunitPrice\b|\)\.category\b|\[\s*['"]category['"]\s*\]/;   // GB4 P495 eski okuma
const GB4_MARJ_EGILIM_IZI = /Gross Margin Trend|Brüt Kâr Marjı Eğilimi|\bmonthGM\b|\baylikMarjEgilimi\b/; // GB4 P306 panel izi
// Paket mutasyonu (2026-10-17): P238'de sayaç satırı (`sehirsiz238`) da `siparisSehri(` çağırdığı için 3.10'un varlık
// iddiası, segmentleyici bağı koparılsa da (`() => null` ya da değer olarak geçme) yeşil kalıyordu → SEGMENTLEYİCİNİN
// kendisi çitlenir. GB4 şartnamesi P238: "Segmentleyici AÇIK ok işleviyle yazılır (`o => siparisSehri(o)`)".
const SEHIR_SEGMENTLEYICI = /\bsegmentCirosu\(\s*\w+\s*,\s*(\w+)\s*=>\s*siparisSehri\(\1\)\s*,/;
// Aynı boşluk P495'te: `kartBul` sayaç satırlarında da çağrılıyor, `stokKartiCozucu` içe aktarımı da duruyor → segmentleyici
// `() => null`'a dönse 3.11 yeşil kalırdı. Bağ iki halkadır: P495 çağrısı `kategori495`'i geçer, `kategori495` kartın
// kategorisini okur (O22 "kategori stok KARTINDAN"; ad GB4 şartnamesi P495 reçetesinden — değişirse AYNI commit'te).
const KATEGORI_SEGMENT_CAGRISI = /\bsegmentCirosu\(\s*\w+\s*,\s*kategori495\s*,/;
const KATEGORI_KARTTAN = /\bkategori495\s*=\s*\([^)]*\)[^=;\n]*=>[^;\n]*\bkartBul\(\s*\w+\s*\)\?\.category\b/;

describe('§3 · K16 / K14 / O3 / O4 / O22 / O23: çift paneller — tek tanım kalır', () => {
  // Çağrıyı değil YOKLUĞU iddia et (6a dersi): 3.1 "GB2 `yogunlasma`'yı doğru çağırıyor" DEMEZ — doğruluk
  // `utils/rapor/yogunlasma.test.ts`'te. 3.1–3.3 + 3.6 birlikte: iki dosyada ikinci bir HHI hesabı / ölçek / eşik YOK.
  it('3.1 · K16: HHI hesabı tek yerde — GB2\'de TEK `yogunlasma(` çağrısı, GB4\'te yok; GB2 modülü içe aktarıyor', () => {
    // Bağlamadaki karşılığı: GB2 P220 `yogunlasma(mo220.musteriler, …)`; GB4 şartnamesi "`yogunlasma` içe AKTARILMAZ".
    expect(eslesmeSayisi(kodMetni(GB2), HHI_CAGRISI), 'GB2 · yogunlasma( çağrısı').toBe(1);
    expect(eslesmeSayisi(kodMetni(GB4), HHI_CAGRISI), 'GB4 · yogunlasma( çağrısı').toBe(0);
    expect(HHI_IMPORTU.test(kodMetni(GB2)), 'GB2 · utils/rapor/yogunlasma içe aktarımı').toBe(true);
  });

  it('3.2 · K14 + O4: GB4\'te HHI paneli yok', () => {
    // Bağlamadaki karşılığı: GB4 P370 SİLİNİR. Yerinde kalan `{/* K14 … HHI … */}` karar yorumu SERBEST (süzgeç siler).
    expect(siteler([GB4], GB4_HHI_IZI)).toEqual([]);
  });

  it('3.3 · K16: elle HHI hesabı ve yerel eşik yok (iki dosya)', () => {
    // Yalnız KÜÇÜK HARF tanıtıcıyla sabit sayı karşılaştırması yakalanır; adlandırılmış sabit (`HHI_ESIKLERI[1]`)
    // ve `y220.hhi === null` TAKILMAZ (4c). Bağlamadaki karşılığı: GB2 P220 `yogunlasma` + `HHI_ESIKLERI`.
    expect(siteler(IKI_DOSYA, EL_YAPIMI_HHI[0]), 'Math.pow(').toEqual([]);
    expect(siteler(IKI_DOSYA, EL_YAPIMI_HHI[1]), 's + v * v, 0)').toEqual([]);
    expect(siteler(IKI_DOSYA, YEREL_HHI_ESIGI), 'yerel eşik').toEqual([]);
  });

  it('3.4 · K16 + O4: "ilk N müşteri" metni kalan panelde (GB2)', () => {
    // O4 "Metin eksiz: Cironun ilk 3 müşteriden gelen payı: %X"; GB2 sayıyı `y220.ilkN`'den basar → desen sabit `3`'ü
    // de şablon ifadesini de kabul eder. EN metni aranmaz.
    expect(ILK_N_METNI.test(kodMetni(GB2))).toBe(true);
  });

  it('3.5 · karar izi: GB2\'de K16, GB4\'te üç silinen panelin yerinde K14 yorumu (HAM metin — BİLEREK)', () => {
    // TEK ham metin iddiası: "kararı uygularken kullanıcının cümlesi koda yorum olarak yazılır, grep'lenebilir olsun"
    // kuralının tek kaynak-tarayan çiti. Yorum burada iddianın KENDİSİ olduğu için süzgeç KULLANILMAZ.
    // Bağlamadaki karşılığı: GB4 kapanışı `grep -c 'K14'` ≥ 3 (O3 + O4 + O23).
    expect(/\bK16\b/.test(ham(GB2)), 'GB2 · K16 karar yorumu').toBe(true);
    expect(kararSatirlari(ham(GB4), /\bK14\b/), 'GB4 · K14 taşıyan satır').toBeGreaterThanOrEqual(3);
  });

  it('3.6 · O4: HHI eşik DEĞERİ GB2\'de literal olarak yok (dipnot `HHI_ESIKLERI`\'nden üretilir)', () => {
    // `HHI_ESIKLERI`'nin GB2'de içe aktarıldığı ayrıca iddia edilmez: `utils/rapor` değer export'u — rapor6a §2 zorlar.
    expect(siteler([GB2], HHI_ESIK_LITERALI)).toEqual([]);
  });

  it('3.7 · K14 + O3: GB4\'te ödeme yöntemi paneli yok', () => {
    // Desen `odemeYontemiSegmenti`'ni de içerir: O3 gereği GB4 bu segmentleyiciyi çağırmaz (kalan panel GB2 P249).
    // GB4'te kalan "Fatura Ödeme Durumu / Invoice Payment Status" paneli (P189) desene TAKILMAZ (4c).
    expect(siteler([GB4], GB4_ODEME_IZI)).toEqual([]);
  });

  it('3.8 · O3: hayalet ödeme alanı (`payment` / `payment_method`) okunmaz (iki dosya)', () => {
    // `\b` sınırı `.paymentMethod`'u YAKALAMAZ: yazıcısı olan meşru alan (`utils/siparisler/odemeYontemi.ts`
    // `odemeAlindiYamasi`, App `handleConfirmPayment`). Bağlamadaki karşılığı: GB2 P249 `odemeYontemiSegmenti`.
    expect(siteler(IKI_DOSYA, HAYALET_ODEME_ALANI)).toEqual([]);
  });

  it('3.9 · K14: GB4\'te TAM üç panel kalktı (14 → 11 panel kapısı)', () => {
    // "Düzeltilip bırakılan" çift panel 3.2 / 3.7 / 3.12'ye, yanlışlıkla silinen dördüncü panel buraya takılır.
    // Bağlamadaki karşılığı: GB4 kapanışı ham `grep -c reportsTab` → 12 (= 11 kapı + başlık yorumu).
    expect(eslesmeSayisi(kodMetni(GB4), PANEL_KAPISI)).toBe(11);
  });

  it('3.10 · O22: GB4 P238 şehri yazıcılı alandan (`siparisSehri(`), hayalet `city` / `shippingCity` okunmaz', () => {
    // Hem YOKLUK hem BAĞ: hayalet okuma silinip yerine hiçbir şey yazılmazsa (panel boş kalır) yokluk tek başına
    // yeşil kalırdı — "yazıldı ama bağlanmadı" çiti. `siparisSehri` çağıranlarının ADIYLA listesi
    // `teslimatAdresi.cit.test.ts`'tedir; burada yalnız GB4'te çağrının VARLIĞI.
    expect(siteler([GB4], HAYALET_SEHIR_ALANI)).toEqual([]);
    expect(SEHIR_OKUYUCU.test(kodMetni(GB4)), 'GB4 · siparisSehri( çağrısı').toBe(true);
    // Bağın kendisi: P238 `segmentCirosu`'nun segmentleyicisi `siparisSehri` (sayaç satırındaki çağrı yetmez — mutasyon).
    expect(SEHIR_SEGMENTLEYICI.test(kodMetni(GB4)), 'GB4 · P238 segmentleyici o => siparisSehri(o)').toBe(true);
  });

  it('3.11 · O22: GB4 P495 kategorisi stok kartından (`stokKartiCozucu`), hayalet kalem alanı okunmaz', () => {
    // Kategori ÇÖZÜMÜNÜN doğruluğu `raporMarj.test.ts`'tedir; burada yalnız bağ (içe aktarım) ve hayalet okumanın yokluğu.
    expect(siteler([GB4], HAYALET_KALEM_ALANI)).toEqual([]);
    expect(iceAktariyor(kodMetni(GB4), 'utils/pano/raporMarj', 'stokKartiCozucu'), 'GB4 · stokKartiCozucu içe aktarımı').toBe(true);
    // Bağın kendisi (iki halka): P495 çağrısı `kategori495`'i geçer ve `kategori495` kartın kategorisini okur.
    expect(KATEGORI_SEGMENT_CAGRISI.test(kodMetni(GB4)), 'GB4 · P495 segmentCirosu(…, kategori495, …)').toBe(true);
    expect(KATEGORI_KARTTAN.test(kodMetni(GB4)), 'GB4 · kategori495 → kartBul(li)?.category').toBe(true);
  });

  it('3.12 · K14 + O23: GB4\'te brüt marj eğilimi paneli yok (kalan GB3 P9)', () => {
    // Bağlamadaki karşılığı: GB4 P306 SİLİNİR; kapanış `Gross Margin Trend|Brüt Kâr Marjı Eğilimi` → 0. Karar yorumu SERBEST.
    expect(siteler([GB4], GB4_MARJ_EGILIM_IZI)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3b · K2 / K4 / O5 / O21: elle süzgeç ve adla gruplama kalıntısı yok; TRY dışı süzgeci çağıranda
// ---------------------------------------------------------------------------

// K2 kullanıcı: "hayır" (iptaller ciroya girmez) · K4 kullanıcı: "kimlikle" (müşteri kimlikle gruplanır).
// Neden kaynakta (6b §3 emsali): iki bağlama da render testi yazmıyor; K2 süzgeci ve K4 gruplaması bileşenin ÜST
// DÜZEYİNDE (`iptalsiz` / `satislar`, `musteriSecenek`). 6a dersi: "süzgeci silen mutasyon tüm paketi yeşil
// bırakıyordu". Buradaki iddialar ÇAĞRI doğruluğunu kanıtlamaz; yalnız eski yolun (elle süzgeç, adla gruplama,
// panel başına ham `orders` geçişi, geçirilmeyen harita, bağlanmayan TRY dışı süzgeci) KALMADIĞINI kanıtlar.
const MUSTERI_ADI = /\bcustomerName\b/;
const IPTAL_LITERALI = /['"]Cancelled['"]/;
const HAM_SIPARIS_GECISI = /\borders\s*\.\s*(?:filter|forEach|map|reduce|flatMap)\(/;
const LEAD_CARI_KODU_PROP = /leadCariKodu=\{ctx\.leadCariKodu\}/;
// v3 (O21): süzgecin ADI ve MODÜLÜ ORKESTRATOR-KARARLARI O21'den (`utils/siparisler/magazaSiparisi.ts` `tryDisiMi`).
// GB2 adı `tlSiparisler` (modül aynı) → desen değişmez.
const TRY_DISI_SUZGECI = ['utils/siparisler/magazaSiparisi', 'tryDisiMi'] as const;
// Paket mutasyonu (2026-10-17): 3b.5 yalnız İÇE AKTARIMI çitliyordu. Süzgeç silinip (`tlSiparisler = orders`,
// `satislar = iptalsiz`, GB2 `iptalsiz = tlSiparisler`) içe aktarım dövizli kümede yaşamaya devam edince bütün paket
// YEŞİL kalıyordu (6a dersi: "süzgeci silen mutasyon tüm paketi yeşil bırakıyordu"). GB2 şartnamesi "Test / değişmez çit"
// (g): "üst düzeyde `orders.filter(o => !tryDisiMi(o))` süzgeci VAR — süzgeç silinirse … (çit `rapor6c.degismez`'e girdi)".
// Küme adları iki bağlama şartnamesinin "Bileşen üst düzeyi" reçetesinden (GB2 `tlSiparisler` → `iptalsiz`; GB4
// `iptalsiz` → `satislar`); ad değişirse bu tablo AYNI commit'te güncellenir. Süzgeç DOĞRULUĞU değil, VARLIĞI çitlenir.
const UST_DUZEY_SUZGECLERI: readonly (readonly [dosya: string, ne: string, desen: RegExp])[] = [
  [GB2, 'O21 · TL kümesi ham siparişten (`orders.filter(o => !tryDisiMi(o))`)', /\borders\.filter\(\s*(\w+)\s*=>\s*!tryDisiMi\(\1\)\s*\)/],
  [GB2, 'K2 · iptal süzgeci TL kümesine (`tlSiparisler.filter(o => !siparisIptalMi(o))`)', /\btlSiparisler\.filter\(\s*(\w+)\s*=>\s*!siparisIptalMi\(\1\)\s*\)/],
  [GB4, 'K2 · iptal süzgeci ham siparişe (`orders.filter(o => !siparisIptalMi(o))`)', /\borders\.filter\(\s*(\w+)\s*=>\s*!siparisIptalMi\(\1\)\s*\)/],
  [GB4, 'O21 · TL kümesi iptalsiz kümeden (`iptalsiz.filter(o => !tryDisiMi(o))`)', /\biptalsiz\.filter\(\s*(\w+)\s*=>\s*!tryDisiMi\(\1\)\s*\)/],
];
// GB2 hakem maddesi H10: "`orders`'ı tutar yardımcısına veren çağrı KALMADI mı". Ham `orders` ilk bağımsız değişken olarak
// verilirse K2 + O21 süzgeçleri O panelde atlanır (paket mutasyonu: P225 `donemCirosu(orders, …)` yeşil kalıyordu).
// Liste iki dosyada tutar / sipariş kümesi alan yardımcıların adlarıdır (yalnız YOKLUK iddiası — yeni ad eklemek serbest).
const HAM_SIPARIS_YARDIMCIYA = /\b(?:donemCirosu|cetpaAlacak|yilAylikCiro|segmentCirosu|musteriOzeti|zamanKovalari|toplaBilinen|raporCirosu|brutMarj|brutMarjHesabi|yuzdelikler|haftaGunIzgarasi|aktifGunSerisi|ortalamaSiparisTutari|donemProjeksiyonu)\(\s*orders\b/;
// K4 + O5 (GB2 hakem maddesi H3): `GenelRapor.tsx` haritayı geçirse de GB2 onu `musteriOzeti` seçeneğine koymazsa K4'ün
// Mikro bağı yine sessizce ölür (paket mutasyonu: `musteriSecenek`'ten `leadCariKodu` silinince paket YEŞİLDİ).
const MUSTERI_SECENEGI_HARITALI = /\bmusteriSecenek\s*=\s*\{[^}]*\bleadCariKodu\b[^}]*\}/;
const MUSTERI_OZETI_CAGRISI = /\bmusteriOzeti\(/;
const MUSTERI_OZETI_SECENEKLI = /\bmusteriOzeti\(\s*\w+\s*,\s*musteriSecenek\s*\)/;
// 3b.9 (6c inceleme 1): GB2 P251 YoY'un K2 süzgeci çağrı seçeneğindedir (`{ iptalHaric: true }`), üst düzey `iptalsiz`'da DEĞİL.
const YIL_AYLIK_CAGRISI = /\byilAylikCiro\(/;
const YIL_AYLIK_IPTAL_HARIC = /\byilAylikCiro\([^;]*?\{\s*iptalHaric:\s*true\s*\}/;
const IPTAL_HARIC_KAPALI = /iptalHaric:\s*false/;

describe('§3b · K2 / K4 / O5 / O21: kalıntı yok, bağlar çağıranda', () => {
  it('3b.1 · K4: adla gruplama yok (`customerName` kod satırı = 0, iki dosya)', () => {
    // Bağlamadaki karşılığı: GB2 kapanışı `customerName` → 0 (siteler `musteriOzeti`'ne); GB4'ün tek sitesi silinen P370'te.
    expect(siteler(IKI_DOSYA, MUSTERI_ADI)).toEqual([]);
  });

  it('3b.2 · K2: iptal tanımı elle yazılmaz (`\'Cancelled\'` literali = 0, iki dosya)', () => {
    // Bağlamadaki karşılığı: GB2 kapanışı `'Cancelled'` → 0 (tek tanım `siparisIptalMi`); GB4'te gerileme çiti.
    expect(siteler(IKI_DOSYA, IPTAL_LITERALI)).toEqual([]);
  });

  it('3b.3 · K2: GB4\'te ham `orders` geçişi TEK (üst düzey `iptalsiz`)', () => {
    // `satislar` / `dovizliler` `iptalsiz`'den türer. Sınır: `orders`'ın bir yardımcıya ARGÜMAN olarak verilmesi desene
    // takılmaz — GB4 hakemi okur. GB2 için sayı iddiası YOK (ham `orders`'ı üst düzeyde meşru biçimde birden çok kez
    // dolaşır). Bağlamadaki karşılığı: GB4 kapanışı `grep -cE 'orders\.(filter|forEach|map|reduce|flatMap)\('` → 1.
    expect(eslesmeSayisi(kodMetni(GB4), HAM_SIPARIS_GECISI)).toBe(1);
  });

  it('3b.4 · O5: `GenelRapor.tsx` K4 haritasını üç bloğa da geçirir (GB2, GB3, GB4)', () => {
    // Dayanak: `utils/rapor/musteri.ts` "VERİLMEZSE Cetpa kaydı ile Mikro carisi BİRLEŞTİRİLMEZ" — alan isteğe bağlı
    // olduğu için GB2 haritayı almadan da derlenir; K4'ün Mikro bağı sessizce ölür. Orkestratör O5'i GB4 için geri
    // alırsa sayı 2 olur — bu satır o kararla AYNI commit'te güncellenir.
    // Bağlamadaki karşılığı: GB2 kapanışı `grep -c "leadCariKodu={ctx.leadCariKodu}"` → 3.
    expect(eslesmeSayisi(kodMetni(GENEL_RAPOR), LEAD_CARI_KODU_PROP)).toBe(3);
  });

  it('3b.5 · O21: TRY dışı süzgeci (`magazaSiparisi.tryDisiMi`) iki dosyada da çağıranda içe aktarılıyor', () => {
    // Yardımcı imzaları değişmediği için süzgeç bağlamada yazılmazsa hiçbir birim testi kırmızıya dönmez — "yazıldı
    // ama bağlanmadı" sınıfı. İddia içe AKTARIMDIR; süzgecin doğru kümeye uygulandığı ve dövizli SAYACIN doğruluğu
    // değil (hakem). Bağlamadaki karşılığı: GB4 kapanışı `grep -c 'tryDisiMi'` ≥ 3; GB2 O21 reçetesi (`tlSiparisler`).
    expect(IKI_DOSYA.filter(d => !iceAktariyor(kodMetni(d), ...TRY_DISI_SUZGECI))).toEqual([]);
  });

  it('3b.6 · K2 + O21: üst düzey iptal ve TRY dışı süzgeçleri kodda VAR (içe aktarım tek başına yetmez)', () => {
    // K2 kullanıcı: "İptaller ciroya girsin mi → hayır." · O21 (orkestratör): dövizli sipariş TL ciroya girmez, ayrı sayılır.
    const eksik = UST_DUZEY_SUZGECLERI.filter(([d, , desen]) => !desen.test(kodMetni(d))).map(([d, ne]) => `${d} · ${ne}`);
    expect(eksik).toEqual([]);
  });

  it('3b.7 · K2 + O21: ham `orders` hiçbir tutar / küme yardımcısına verilmez (iki dosya)', () => {
    // Bağlamadaki karşılığı: GB2 O21 kapsam kuralı "TL tutarı okuyan HER küme `tlSiparisler` / `iptalsiz`'dan kurulur";
    // GB4 kümeleri `satislar` / `dovizliler` / `iptalsiz`. Tutar okumayan GB2 360° `openOrds` sayacı yardımcı çağırmaz.
    expect(siteler(IKI_DOSYA, HAM_SIPARIS_YARDIMCIYA)).toEqual([]);
  });

  it('3b.8 · K4 + O5: GB2 `musteriSecenek` K4 haritasını taşır ve her `musteriOzeti(` çağrısı onu geçer', () => {
    // K4 kullanıcı: "kimlikle". Sayı iddiası DEĞİL (çağrı adedi serbest): her çağrının AYNI seçeneği aldığı iddia edilir.
    const kod = kodMetni(GB2);
    expect(MUSTERI_SECENEGI_HARITALI.test(kod), 'GB2 · musteriSecenek { …, leadCariKodu }').toBe(true);
    expect(eslesmeSayisi(kod, MUSTERI_OZETI_CAGRISI), 'GB2 · musteriOzeti( çağrısı var').toBeGreaterThan(0);
    expect(eslesmeSayisi(kod, MUSTERI_OZETI_SECENEKLI), 'GB2 · musteriSecenek alan çağrı').toBe(eslesmeSayisi(kod, MUSTERI_OZETI_CAGRISI));
  });

  it('3b.9 · K2: GB2\'de her `yilAylikCiro(` çağrısı `{ iptalHaric: true }` taşır; `iptalHaric: false` yok', () => {
    // K2 kullanıcı: "İptaller ciroya girsin mi → hayır." GB2'de üst düzey `iptalsiz` P251'i kapsamaz (girdi `tlSiparisler` /
    // `dovizliler`); süzgeç her çağrıda ayrı durur → sayı iddiası DEĞİL, her çağrının seçeneği taşıdığı iddia edilir (3b.8 kalıbı).
    // 6c inceleme 1 (2026-10-17): üç çağrının biri ya da hepsi `false` yapılınca bütün paket YEŞİL kalıyordu.
    const kod = kodMetni(GB2);
    const cagri = eslesmeSayisi(kod, YIL_AYLIK_CAGRISI);
    expect(cagri, 'GB2 · yilAylikCiro( çağrısı var').toBeGreaterThan(0);
    expect(eslesmeSayisi(kod, YIL_AYLIK_IPTAL_HARIC), 'GB2 · iptalHaric: true alan çağrı').toBe(cagri);
    expect(siteler([GB2], IPTAL_HARIC_KAPALI)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3c · O6 parite: GB4 P337 yüzdelik dilimleri yalnız pozitif tutardan
// ---------------------------------------------------------------------------

// O6 (orkestratör): yöntem parite (GB4:340 `floor(p/100·(n-1))`); eski kod `.filter(v => v > 0)` ile ₺0 ve iade
// siparişlerini dilimlerden çıkarıyordu → bağlamadaki karşılığı `yuzdelikler(…, { sadecePozitif: true })`. 6c inceleme 1:
// bayrak silinince hiçbir test kırmızıya dönmüyordu (₺0 / negatif tutarlı sipariş P10'u aşağı çeker). `kodMetni` yorumları
// süzdüğü için P337 yorumundaki anma iddiayı yeşile çeviremez; `length === 1` çağrı başka biçime taşınırsa iddianın
// sessizce boşa düşmesini engeller.
const YUZDELIK_CAGRISI = /\byuzdelikler\(/;
const SADECE_POZITIF = /sadecePozitif:\s*true\b/;

describe('§3c · O6 parite: GB4 P337 yüzdelik dilimleri', () => {
  it('her `yuzdelikler(` çağrısı `sadecePozitif: true` taşır (eski `.filter(v => v > 0)` paritesi)', () => {
    const cagrilar = kodMetni(GB4).split('\n').filter(s => YUZDELIK_CAGRISI.test(s));
    expect(cagrilar).toHaveLength(1);
    expect(cagrilar.filter(s => !SADECE_POZITIF.test(s))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3d · O20 + dil: GB2 P239 genel notunun "eksik bileşen" adları her bileşende çağıranın dilinde
// ---------------------------------------------------------------------------

// O20: AR bileşeni koşulsuz `null` olduğu için «Genel not verilmedi — eksik bileşen: …» satırı HER ZAMAN basılır; kısmi
// veride öbür bileşenler de listeye girer. 6c inceleme 1: yalnız AR öğesinde `eksikAdi` vardı, öbür üçü İngilizce kutu
// etiketiyle (`label`) Türkçe cümleye giriyordu. Kural: dört öğenin dördü de `eksikAdi` taşır ve tip alanı ZORUNLU kılar
// (yeni bir bileşen adsız eklenirse tsc yakalar). Ekrandaki metin `genel/GenelBloklar2.test.tsx`'te çizilerek sınanır.
const KPIS239_DIZISI = /\bconst kpis239\s*:\s*([^=]*?)=\s*\[([\s\S]*?)\n\s*\];/;
const KPI_OGESI = /\{\s*label:/;
const EKSIK_ADI_ALANI = /\beksikAdi:/;
const EKSIK_ADI_ZORUNLU = /\beksikAdi:\s*string\b/;

describe('§3d · O20 + dil: P239 her bileşenin `eksikAdi`\'si var', () => {
  it('`kpis239` dizisinde `eksikAdi:` sayısı öğe sayısına (4) eşit; tipte alan zorunlu', () => {
    const e = KPIS239_DIZISI.exec(kodMetni(GB2));
    expect(e, 'GB2 · const kpis239: … = [ … ];').not.toBeNull();
    const [, tip, govde] = e ?? ['', '', ''];
    expect(eslesmeSayisi(govde, KPI_OGESI), 'öğe sayısı').toBe(4);
    expect(eslesmeSayisi(govde, EKSIK_ADI_ALANI), 'eksikAdi: sayısı').toBe(eslesmeSayisi(govde, KPI_OGESI));
    expect(EKSIK_ADI_ZORUNLU.test(tip), `tip: ${tip.trim()}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 · KÂHİN — tarayıcı gerçekten dosyaları okuyor, desenler boş değil (bağlama ÖNCESİ de yeşildi)
// ---------------------------------------------------------------------------

describe('§4a · erişilebilirlik + bayatlama sayacı', () => {
  it('dosya listesi sabit: bir dosya sessizce çıkarılırsa bütün döngüler onu görmez olur', () => {
    expect(IKI_DOSYA).toEqual([GB2, GB4]);
  });

  it('iki dosya da var, yorum süzgeci dosyayı yutmadı ve doğru bileşen okunuyor', () => {
    // Eşik 100'de KALIR (ölçüm bağlama öncesi 537 / 547 dolu satır; GB4'ten üç panel ≈ 109 satır düşse de ~440 kalır).
    for (const d of IKI_DOSYA) {
      expect(existsSync(yol(d)), d).toBe(true);
      const satirlar = yorumsuz(d, ham(d));
      expect(satirlar.filter(s => s.trim() !== '').length, `${d} · yorumsuz sonrası dolu satır`).toBeGreaterThan(100);
      // Taşınmış / boşaltılmış bir kabuk değil, bileşenin kendisi.
      expect(satirlar.some(s => /^export default function GenelBloklar[24]\(/.test(s)), `${d} · bileşen tanımı`).toBe(true);
    }
  });

  it('iki blok `GenelRapor.tsx`\'te render ediliyor (ölü yüzey ölçülmüyor)', () => {
    // Zincir: RaporlarPage → ReportsDashboard (lazy GenelRapor, `reportsTab === 'genel'`) → GenelRapor → GB2 / GB4.
    // Bağlama sırasında biri render'dan kaldırılırsa test yeşil kalır ama ölçü ölü yüzeyi ölçerdi.
    const genel = kodMetni(GENEL_RAPOR);
    expect(genel).toMatch(/<GenelBloklar2\b/);
    expect(genel).toMatch(/<GenelBloklar4\b/);
  });

  it('GB2\'de 10 panel kapısı (GB2 şartnamesi "kapılara DOKUNMA" — panel kaybolmadı)', () => {
    expect(eslesmeSayisi(kodMetni(GB2), PANEL_KAPISI)).toBe(10);
  });
});

describe('§4b · canlı kâhin: gerçek içeriğe bilinen kötü bir satır eklenince tarayıcı TAM BİR fazla bulur', () => {
  it('her dosyada +1 ihlal, satır numarası dosya sonunu gösterir', () => {
    // Boş dize okunursa ya da yol yanlışsa 4a düşer; tarayıcı `yorumsuz`'u yutarsa bu düşer.
    // Eklenen satır katı ayrıştırmada geçerlidir (`yorumsuz` fırlatmaz); ad `d` gerçek `.tsx` yolu.
    for (const d of IKI_DOSYA) {
      const taban = sertIhlalleri(d, ham(d));
      const ekli = sertIhlalleri(d, ham(d) + '\nconst x = y ?? 0;');
      expect(ekli.length - taban.length, d).toBe(1);
      expect(ekli.at(-1)?.satir, d).toBe(yorumsuz(d, ham(d)).length + 1);
    }
  });
});

// 4c · desen kâhini — yerel desenler ortak modülde değil bu dosyada; fikstürleri de burada. Pozitifler bağlama öncesi
// koddan (yayin-18) BİREBİR alıntı, negatifler bağlama şartnamelerinin reçete satırları. Giriş kuralı: tek satırlık
// KOD fikstürleri desene DOĞRUDAN verilir (çoğu kendi başına geçerli TS değildir — katı `yorumsuz` fırlatır); YORUM
// taşıyan fikstürler süzgeçten `parcaKodu` ile geçer ve HAM hâlleri ayrıca sınanır (süzgeç kaldırılırsa sonuç değişir).
interface DesenVakasi { ne: string; desen: RegExp; metin: string; eslesir: boolean }
const DESEN_VAKALARI: readonly DesenVakasi[] = [
  // ── K16 / O4 · HHI ──
  { ne: 'GB2 P220 elle HHI (Math.pow)', desen: EL_YAPIMI_HHI[0], eslesir: true,
    metin: 'const hhi = Object.values(custRev220).reduce((s, v) => s + Math.pow((v / total220) * 100, 2), 0);' },
  { ne: 'GB4 P370 elle HHI (v * v)', desen: EL_YAPIMI_HHI[1], eslesir: true,
    metin: 'const hhi = shares.reduce((s, v) => s + v * v, 0);' },
  { ne: 'GB2 P220 yerel eşik', desen: YEREL_HHI_ESIGI, eslesir: true,
    metin: "const hhiLevel = hhiRounded > 2500 ? 'high' : hhiRounded > 1500 ? 'medium' : 'low';" },
  { ne: 'GB4 P370 yerel eşik', desen: YEREL_HHI_ESIGI, eslesir: true,
    metin: "const concentration = hhi > 0.25 ? 'High' : hhi > 0.1 ? 'Moderate' : 'Low';" },
  { ne: 'GB4 P370 "HHI Score"', desen: GB4_HHI_IZI, eslesir: true,
    metin: '<p className="text-[10px] text-gray-400">HHI Score</p>' },
  { ne: 'GB2 P220 dipnotu (literal eşik)', desen: HHI_ESIK_LITERALI, eslesir: true,
    metin: '? `HHI > 2500 yüksek, 1500-2500 orta, < 1500 düşük konsantrasyon.`' },
  { ne: 'GB2 P220 dipnotu — büyük harf + dize, yerel eşik DEĞİL (mutasyon b: `i` bayrağı YASAK)', desen: YEREL_HHI_ESIGI, eslesir: false,
    metin: '? `HHI > 2500 yüksek, 1500-2500 orta, < 1500 düşük konsantrasyon.`' },
  { ne: 'reçete: yogunlasma çağrısı · Math.pow değil', desen: EL_YAPIMI_HHI[0], eslesir: false,
    metin: 'const y220 = yogunlasma(mo220.musteriler, m => m.ciro, { atfedilemeyen: mo220.kimliksizCiro });' },
  { ne: 'reçete: yogunlasma çağrısı · v * v değil', desen: EL_YAPIMI_HHI[1], eslesir: false,
    metin: 'const y220 = yogunlasma(mo220.musteriler, m => m.ciro, { atfedilemeyen: mo220.kimliksizCiro });' },
  { ne: 'reçete: yogunlasma çağrısı · yerel eşik değil', desen: YEREL_HHI_ESIGI, eslesir: false,
    metin: 'const y220 = yogunlasma(mo220.musteriler, m => m.ciro, { atfedilemeyen: mo220.kimliksizCiro });' },
  { ne: 'reçete: hhi === null · yerel eşik değil', desen: YEREL_HHI_ESIGI, eslesir: false,
    metin: 'const hhi220 = y220.hhi === null ? null : Math.round(y220.hhi);' },
  { ne: 'reçete: hhi === null · Math.pow değil', desen: EL_YAPIMI_HHI[0], eslesir: false,
    metin: 'const hhi220 = y220.hhi === null ? null : Math.round(y220.hhi);' },
  { ne: 'reçete: HHI_ESIKLERI yapı bozumu · yerel eşik değil', desen: YEREL_HHI_ESIGI, eslesir: false,
    metin: 'const [ortaEsik, yuksekEsik] = HHI_ESIKLERI;' },
  { ne: 'reçete: HHI_ESIKLERI yapı bozumu · literal değil', desen: HHI_ESIK_LITERALI, eslesir: false,
    metin: 'const [ortaEsik, yuksekEsik] = HHI_ESIKLERI;' },
  { ne: 'reçete: adlandırılmış sabitle karşılaştırma meşru', desen: YEREL_HHI_ESIGI, eslesir: false,
    metin: 'const yuksek = y.hhi !== null && y.hhi > HHI_ESIKLERI[1];' },
  { ne: 'reçete: dipnot sabitten üretilir', desen: HHI_ESIK_LITERALI, eslesir: false,
    metin: '? `HHI > ${tamSayiYaz(yuksekEsik)} yüksek, ${tamSayiYaz(ortaEsik)}–${tamSayiYaz(yuksekEsik)} orta`' },
  { ne: 'binlik ayraçlı metin · yerel eşik değil', desen: YEREL_HHI_ESIGI, eslesir: false, metin: "label: 'HHI 1.500 / 2.500'" },
  { ne: 'binlik ayraçlı metin · literal değil', desen: HHI_ESIK_LITERALI, eslesir: false, metin: "label: 'HHI 1.500 / 2.500'" },
  { ne: 'Math.max · Math.pow değil', desen: EL_YAPIMI_HHI[0], eslesir: false, metin: 'const m = Math.max(a, b);' },
  { ne: 'v * w (mutasyon a: `\\1` geri başvurusu gevşetilirse KIRMIZI)', desen: EL_YAPIMI_HHI[1], eslesir: false, metin: 'return s + v * w, 0);' },
  { ne: 'reçete: "ilk N" şablonu', desen: ILK_N_METNI, eslesir: true,
    metin: '`Cironun ilk ${y220.ilkN} müşteriden gelen payı: ${yuzdeYaz(y220.ilk3Pay, 1, dil)}`' },
  { ne: 'O4 sabit "ilk 3" metni', desen: ILK_N_METNI, eslesir: true, metin: "'Cironun ilk 3 müşteriden gelen payı'" },
  { ne: 'EN metni aranmaz', desen: ILK_N_METNI, eslesir: false, metin: '`Share of revenue from top ${y220.ilkN} customers`' },
  // ── K14 / O3 · ödeme yöntemi ──
  { ne: 'GB4 P270 ödeme yöntemi · panel izi', desen: GB4_ODEME_IZI, eslesir: true,
    metin: "const pm = (o as unknown as Record<string,unknown>).paymentMethod as string || (o as unknown as Record<string,unknown>).payment_method as string || 'Other';" },
  { ne: 'GB4 P270 ödeme yöntemi · hayalet alan', desen: HAYALET_ODEME_ALANI, eslesir: true,
    metin: "const pm = (o as unknown as Record<string,unknown>).paymentMethod as string || (o as unknown as Record<string,unknown>).payment_method as string || 'Other';" },
  { ne: 'GB2 P249 hayalet `payment` yedeği', desen: HAYALET_ODEME_ALANI, eslesir: true,
    metin: 'const method = (m.paymentMethod as string) || (m.payment as string) || (oc(currentLanguage).belirtilmemis);' },
  { ne: 'reçete: segmentCirosu + odemeYontemiSegmenti', desen: HAYALET_ODEME_ALANI, eslesir: false,
    metin: 'const s249 = segmentCirosu(iptalsiz, odemeYontemiSegmenti);' },
  { ne: 'yazıcılı `paymentMethod` (mutasyon c: `\\b` kaldırılırsa KIRMIZI)', desen: HAYALET_ODEME_ALANI, eslesir: false,
    metin: 'const y = o.paymentMethod;' },
  { ne: 'GB4 P189 fatura ödeme durumu kalır · paid', desen: GB4_ODEME_IZI, eslesir: false,
    metin: 'const faturali = satislar.filter(o => Boolean(o.paid || o.paidAt));' },
  { ne: 'GB4 P189 başlığı', desen: GB4_ODEME_IZI, eslesir: false,
    metin: `<h3 className="font-bold text-gray-800 mb-4">{currentLanguage === 'tr' ? 'Fatura Ödeme Durumu' : 'Invoice Payment Status'}</h3>` },
  // ── O15 · Math.max( ──
  { ne: 'GB2 P251 piksel tabanı', desen: MATH_MAX, eslesir: true,
    metin: '<div className="flex-1 bg-brand rounded-t-sm" style={{ height: `${Math.max(m.curr > 0 ? 2 : 0, currH)}px` }} />' },
  { ne: 'GB4 P528 seri sayacı', desen: MATH_MAX, eslesir: true, metin: 'if (diff === 1) { cur++; maxStreak = Math.max(maxStreak, cur); }' },
  { ne: 'GB2 P225 üst kırpma (Math.min) iddia edilmez', desen: MATH_MAX, eslesir: false, metin: 'width: `${Math.min(projeksiyonaOran, 100)}%`' },
  // ── O14 · eski maliyet okuyucusu ──
  { ne: 'GB2 eski içe aktarım', desen: ESKI_MALIYET_OKUYUCU, eslesir: true,
    metin: "import { itemCostTRY, type ReportsCtx, brutMarj } from '../useReportsData';" },
  { ne: 'reçete: stok değeri kartMaliyetiTL', desen: ESKI_MALIYET_OKUYUCU, eslesir: false,
    metin: 'const stokDegeri = degerToplami(inventory, i => kartMaliyetiTL(i, exchangeRates));' },
  // ── K4 / K2 / O5 / O21 ──
  { ne: 'GB2 P220 adla gruplama', desen: MUSTERI_ADI, eslesir: true, metin: "const name = o.customerName || '—';" },
  { ne: 'reçete: musteriOzeti', desen: MUSTERI_ADI, eslesir: false, metin: 'const mo220 = musteriOzeti(iptalsiz, musteriSecenek);' },
  { ne: 'GB2 P220 elle iptal süzgeci', desen: IPTAL_LITERALI, eslesir: true, metin: "if (o.status === 'Cancelled') continue;" },
  { ne: 'reçete: iptalsiz kümeden süzme', desen: IPTAL_LITERALI, eslesir: false, metin: 'const pencereSiparisleri = iptalsiz.filter(o => { … });' },
  { ne: 'reçete: üst düzey iptalsiz (TEK ham geçiş)', desen: HAM_SIPARIS_GECISI, eslesir: true,
    metin: 'const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);' },
  { ne: 'reçete: satislar iptalsiz\'den türer', desen: HAM_SIPARIS_GECISI, eslesir: false,
    metin: 'const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);' },
  { ne: 'panel kapısındaki orders.length geçiş değil', desen: HAM_SIPARIS_GECISI, eslesir: false,
    metin: "{reportsTab === 'genel' && orders.length >= 5 && (() => {" },
  { ne: 'reçete: GB4 P238 dört parametreli segmentCirosu', desen: ANAHTARSIZ_SAYACI, eslesir: true,
    metin: 'const s238 = segmentCirosu(satislar, o => siparisSehri(o), undefined, { tutarSec: siparisTutari, anahtarsizSay: true });' },
  { ne: 'reçete: GB2 P249 üç parametreli segmentCirosu', desen: ANAHTARSIZ_SAYACI, eslesir: false,
    metin: 'const s249 = segmentCirosu(iptalsiz, odemeYontemiSegmenti);' },
  // ── v3 · O22 şehir / kategori ──
  { ne: 'GB4 P238 hayalet şehir okuması', desen: HAYALET_SEHIR_ALANI, eslesir: true,
    metin: "const city = (o as unknown as Record<string,unknown>).city as string || (o as unknown as Record<string,unknown>).shippingCity as string || '';" },
  { ne: 'GB4 P238 yerel `c.city` alanı', desen: HAYALET_SEHIR_ALANI, eslesir: true,
    metin: '<span className="text-xs font-semibold text-gray-700 w-24 truncate">{c.city}</span>' },
  { ne: 'reçete: siparisSehri çağrısı · hayalet değil', desen: HAYALET_SEHIR_ALANI, eslesir: false,
    metin: 'const s238 = segmentCirosu(satislar, o => siparisSehri(o), …' },
  { ne: 'reçete: siparisSehri çağrısı · okuyucu', desen: SEHIR_OKUYUCU, eslesir: true,
    metin: 'const s238 = segmentCirosu(satislar, o => siparisSehri(o), …' },
  { ne: 'reçete: EN not dizgesindeki "city" · hayalet değil', desen: HAYALET_SEHIR_ALANI, eslesir: false,
    metin: 'tr ? `${n} siparişin şehri girilmemiş — şehir sıralamasına girmedi` : `${n} order(s) have no city entered — excluded from the city ranking`' },
  { ne: 'reçete: not dizgesi · okuyucu değil', desen: SEHIR_OKUYUCU, eslesir: false,
    metin: 'tr ? `${n} siparişin şehri girilmemiş — şehir sıralamasına girmedi` : `${n} order(s) have no city entered — excluded from the city ranking`' },
  { ne: 'GB4 P495 hayalet kalem kategorisi', desen: HAYALET_KALEM_ALANI, eslesir: true, metin: "const cat = li.category || 'Other';" },
  { ne: 'GB4 P495 hayalet unitPrice', desen: HAYALET_KALEM_ALANI, eslesir: true,
    metin: 'catRev[cat] = (catRev[cat] || 0) + (li.price || li.unitPrice || 0) * (li.quantity || 1);' },
  { ne: 'reçete: kategori stok kartından · hayalet değil', desen: HAYALET_KALEM_ALANI, eslesir: false,
    metin: 'const kategori495 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);' },
  { ne: 'reçete: stokKartiCozucu · eski maliyet okuyucusu değil', desen: ESKI_MALIYET_OKUYUCU, eslesir: false,
    metin: 'const kartBul = useMemo(() => stokKartiCozucu(inventory), [inventory]);' },
  // ── paket mutasyonları (2026-10-17) · tür dönüşümlü hayalet erişim + segmentleyici bağları ──
  { ne: 'mutasyon: kalemi tür dönüşümüyle okuyan hayalet kategori', desen: HAYALET_KALEM_ALANI, eslesir: true,
    metin: 'doluMetin((li as Record<string, unknown>).category ?? kartBul(li)?.category)' },
  { ne: 'mutasyon: köşeli parantezli hayalet kategori', desen: HAYALET_KALEM_ALANI, eslesir: true,
    metin: "const k = li['category'];" },
  { ne: 'reçete: kartın kategorisi sayaçta · hayalet değil', desen: HAYALET_KALEM_ALANI, eslesir: false,
    metin: 'const kategorisiz495 = kalemler495.filter(li => { const k = kartBul(li); return k !== null && doluMetin(k.category) === null; }).length;' },
  { ne: 'reçete: P238 segmentleyici', desen: SEHIR_SEGMENTLEYICI, eslesir: true,
    metin: 'const s238 = segmentCirosu(satislar, o => siparisSehri(o), undefined, { tutarSec: siparisTutari, anahtarsizSay: true });' },
  { ne: 'mutasyon: siparisSehri değer olarak geçildi', desen: SEHIR_SEGMENTLEYICI, eslesir: false,
    metin: 'const s238 = segmentCirosu(satislar, siparisSehri, undefined, { tutarSec: siparisTutari, anahtarsizSay: true });' },
  { ne: 'mutasyon: P238 segmentleyici koparıldı (sayaçtaki çağrı kalır)', desen: SEHIR_SEGMENTLEYICI, eslesir: false,
    metin: 'const s238 = segmentCirosu(satislar, () => null, undefined, { tutarSec: siparisTutari, anahtarsizSay: true }); const n = satislar.filter(o => siparisSehri(o) === null).length;' },
  { ne: 'reçete: P495 çağrısı kategori495 geçer', desen: KATEGORI_SEGMENT_CAGRISI, eslesir: true,
    metin: 'const s495 = segmentCirosu(kalemler495, kategori495, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });' },
  { ne: 'mutasyon: P495 segmentleyici koparıldı', desen: KATEGORI_SEGMENT_CAGRISI, eslesir: false,
    metin: 'const s495 = segmentCirosu(kalemler495, () => null, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });' },
  { ne: 'reçete: kategori495 kartın kategorisini okur', desen: KATEGORI_KARTTAN, eslesir: true,
    metin: 'const kategori495 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);' },
  { ne: 'mutasyon: kategori495 sabit null', desen: KATEGORI_KARTTAN, eslesir: false,
    metin: 'const kategori495 = (li: OrderLineItem): string | null => null; const k = kartBul(li)?.category;' },
  // ── paket mutasyonları (2026-10-17) · üst düzey süzgeçler + ham `orders` + K4 seçeneği ──
  { ne: 'reçete: GB2 O21 TL kümesi', desen: UST_DUZEY_SUZGECLERI[0][2], eslesir: true,
    metin: 'const tlSiparisler = orders.filter(o => !tryDisiMi(o));' },
  { ne: 'mutasyon: GB2 O21 süzgeci silindi', desen: UST_DUZEY_SUZGECLERI[0][2], eslesir: false, metin: 'const tlSiparisler = orders;' },
  { ne: 'GB2 dövizli küme (olumsuzlamasız) · TL süzgeci değil', desen: UST_DUZEY_SUZGECLERI[0][2], eslesir: false,
    metin: 'const dovizliler = orders.filter(tryDisiMi);' },
  { ne: 'reçete: GB2 K2 iptalsiz TL kümesinden', desen: UST_DUZEY_SUZGECLERI[1][2], eslesir: true,
    metin: 'const iptalsiz = tlSiparisler.filter(o => !siparisIptalMi(o));' },
  { ne: 'GB2 dövizli iptalsiz · TL kümesinin süzgeci değil', desen: UST_DUZEY_SUZGECLERI[1][2], eslesir: false,
    metin: 'const dovizliIptalsiz = dovizliler.filter(o => !siparisIptalMi(o));' },
  { ne: 'reçete: GB4 K2 üst düzey iptalsiz', desen: UST_DUZEY_SUZGECLERI[2][2], eslesir: true,
    metin: 'const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);' },
  { ne: 'mutasyon: GB4 iptal süzgeci içi boşaltıldı', desen: UST_DUZEY_SUZGECLERI[2][2], eslesir: false,
    metin: 'const iptalsiz = useMemo(() => orders.filter(o => o !== null), [orders]);' },
  { ne: 'reçete: GB4 O21 satislar', desen: UST_DUZEY_SUZGECLERI[3][2], eslesir: true,
    metin: 'const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);' },
  { ne: 'GB4 P22 ay içi TL bölünmesi · üst düzey süzgeç değil', desen: UST_DUZEY_SUZGECLERI[3][2], eslesir: false,
    metin: 'const buAy = buAyHepsi.filter(o => !tryDisiMi(o));' },
  { ne: 'mutasyon: ham orders tutar yardımcısında', desen: HAM_SIPARIS_YARDIMCIYA, eslesir: true,
    metin: 'const p225 = donemCirosu(orders, monthStart225, null, false);' },
  { ne: 'reçete: TL kümesi tutar yardımcısında', desen: HAM_SIPARIS_YARDIMCIYA, eslesir: false,
    metin: 'const p225 = donemCirosu(tlSiparisler, monthStart225, null, false);' },
  { ne: 'reçete: ordersList (P235 parametresi) · ham orders değil', desen: HAM_SIPARIS_YARDIMCIYA, eslesir: false,
    metin: 'const m = brutMarj(ordersList, inventory, exchangeRates);' },
  { ne: 'reçete: musteriSecenek haritalı', desen: MUSTERI_SECENEGI_HARITALI, eslesir: true,
    metin: 'const musteriSecenek = { tutarSec: raporSiparisi, tarihSec: (o: Order) => zamanMs(o.createdAt), leadCariKodu };' },
  { ne: 'mutasyon: musteriSecenek haritasız', desen: MUSTERI_SECENEGI_HARITALI, eslesir: false,
    metin: 'const musteriSecenek = { tutarSec: raporSiparisi, tarihSec: (o: Order) => zamanMs(o.createdAt) }; void leadCariKodu;' },
  { ne: 'reçete: musteriOzeti musteriSecenek ile', desen: MUSTERI_OZETI_SECENEKLI, eslesir: true,
    metin: 'const mo220 = musteriOzeti(iptalsiz, musteriSecenek);' },
  { ne: 'mutasyon: musteriOzeti satır içi haritasız seçenekle', desen: MUSTERI_OZETI_SECENEKLI, eslesir: false,
    metin: 'const mo220 = musteriOzeti(iptalsiz, { tutarSec: raporSiparisi, tarihSec: o => zamanMs(o.createdAt) });' },
  // ── v3 · O23 brüt marj eğilimi ──
  { ne: 'GB4 P306 başlığı', desen: GB4_MARJ_EGILIM_IZI, eslesir: true,
    metin: `<h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Brüt Kâr Marjı Eğilimi' : 'Gross Margin Trend'}</h3>` },
  { ne: 'reçete: GB4 P22 marj şeridi kalır (küçük harfli "margin")', desen: GB4_MARJ_EGILIM_IZI, eslesir: false,
    metin: 'Gross margin: {yuzdeYaz(hamMarj(marj22), 1, dil)} · EBITDA margin: …' },
  { ne: 'reçete: GB4 P22 brutMarjHesabi', desen: GB4_MARJ_EGILIM_IZI, eslesir: false,
    metin: 'const marj22 = brutMarjHesabi(buAy, kalemMaliyeti);' },
  // ── 6c inceleme 1 · 3b.9 / §3c / §3d ──
  { ne: 'reçete: P251 bu yıl iptal hariç', desen: YIL_AYLIK_IPTAL_HARIC, eslesir: true,
    metin: 'const bu251 = yilAylikCiro(tlSiparisler, currYear, { iptalHaric: true }, dil);' },
  { ne: 'reçete: P251 dövizli sayaç iç içe çağrı', desen: YIL_AYLIK_IPTAL_HARIC, eslesir: true,
    metin: 'const yilDovizli251 = (yil: number) => donemToplami(yilAylikCiro(dovizliler, yil, { iptalHaric: true }, dil).aylar);' },
  { ne: 'mutasyon: P251 iptal süzgeci kapatıldı', desen: YIL_AYLIK_IPTAL_HARIC, eslesir: false,
    metin: 'const once251 = yilAylikCiro(tlSiparisler, prevYear, { iptalHaric: false }, dil);' },
  { ne: 'mutasyon: P251 seçenek düşürüldü (sonraki satırın `true`su sayılmaz)', desen: YIL_AYLIK_IPTAL_HARIC, eslesir: false,
    metin: 'const once251 = yilAylikCiro(tlSiparisler, prevYear, undefined, dil); const x = { iptalHaric: true };' },
  { ne: 'mutasyon: P251 `false` literali', desen: IPTAL_HARIC_KAPALI, eslesir: true,
    metin: 'const once251 = yilAylikCiro(tlSiparisler, prevYear, { iptalHaric: false }, dil);' },
  { ne: 'reçete: P337 yüzdelikler pozitif', desen: SADECE_POZITIF, eslesir: true,
    metin: 'const y337 = yuzdelikler(satislar, siparisTutari, YUZDELIKLER, { sadecePozitif: true });' },
  { ne: 'mutasyon: P337 bayrak düşürüldü', desen: SADECE_POZITIF, eslesir: false,
    metin: 'const y337 = yuzdelikler(satislar, siparisTutari, YUZDELIKLER, { sadecePozitif: false });' },
  { ne: 'P337 içe aktarım satırı çağrı değil', desen: YUZDELIK_CAGRISI, eslesir: false,
    metin: "import { kovayaYerlestir, yuzdelikler, type KovaSiniri } from '../../../utils/rapor/dagilim';" },
  { ne: 'reçete: P239 tip — eksikAdi zorunlu', desen: EKSIK_ADI_ZORUNLU, eslesir: true,
    metin: '{ label: string; eksikAdi: string; value: string; score: Harf | null; desc: string }[]' },
  { ne: 'mutasyon: P239 tip — eksikAdi isteğe bağlı', desen: EKSIK_ADI_ZORUNLU, eslesir: false,
    metin: '{ label: string; eksikAdi?: string; value: string; score: Harf | null; desc: string }[]' },
  { ne: 'P239 öğe başı', desen: KPI_OGESI, eslesir: true,
    metin: "{ label: 'Inventory', eksikAdi: currentLanguage === 'tr' ? 'Stok değeri' : 'Inventory', value: '…' }," },
  { ne: 'P239 isteğe bağlı tip alanı (`eksikAdi?:`) değer alanı sayılmaz', desen: EKSIK_ADI_ALANI, eslesir: false,
    metin: '{ label: string; eksikAdi?: string; value: string }[]' },
  { ne: 'reçete: P239 dizisi (tip + gövde ayrılır)', desen: KPIS239_DIZISI, eslesir: true,
    metin: "const kpis239: { label: string; eksikAdi: string }[] = [\n  { label: 'Gross Margin', eksikAdi: 'Brüt marj' },\n];" },
  { ne: 'başka ad · P239 dizisi değil', desen: KPIS239_DIZISI, eslesir: false,
    metin: "const kpis245 = [\n  { label: 'AOV' },\n];" },
];

// Satır yorumu: süzgeç sonrası panel izi yok; HAM hâli eşleşir (süzgeç kaldırılırsa KIRMIZI — mutasyon kanıtı).
const K14_SATIR_YORUMU = '// K14 kullanıcı: "kaldır" — HHI paneli GB2\'de tek';
// GB4 şartnamesindeki ÜÇ karar yorumu (P270 + P370 + P306) `<>…</>` içinde birleştirilmiş tek literal.
const K14_UC_BLOK = [
  '<>',
  '  {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır.',
  '      Bu dosyadaki ikinci "Ödeme Yöntemi Dağılımı" paneli KALDIRILDI (orkestratör O3: liste K14\'ün bilinen',
  '      çiftleriydi; kural geneldir). Kalan tek panel GenelBloklar2.tsx\'tedir: iptaller hariç, yalnız yazıcısı',
  '      olan `paymentMethod` alanı, "Belirtilmemiş" satırı. */}',
  '  {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." + K16: "Ok." — HHI 0–10.000;',
  '      1.500 / 2.500; TEK panel + "Cironun %X\'i ilk 3 müşteriden". Bu dosyadaki 0–1 ölçekli, 0,25/0,10',
  '      eşikli ikinci yoğunlaşma paneli KALDIRILDI (orkestratör O4); kalan tek panel GenelBloklar2.tsx',
  '      (Gelir Konsantrasyon Endeksi). */}',
  '  {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır (kalan:',
  '      testli yardımcıya bağlı olan). Bu dosyadaki aylık brüt marj eğilimi paneli KALDIRILDI (orkestratör O23;',
  '      K14 genel kuralı O3). Bu çiftten kalan panel GenelBloklar3.tsx P9 "Gross Margin % — 12-Month Trend" (6b\'de testli',
  '      brutMarjHesabi\'na bağlı, son 12 takvim ayı). GenelBloklar1 «Aylık Brüt Marj Trendi» (6 aylık ciro / maliyet /',
  '      kâr tutarı çubukları + ortalama marj etiketi) farklı içeriktir; bu kararın DIŞINDADIR, çift sayılmaz (orkestratör). */}',
  '</>',
].join('\n');
// `iceAktariyor` için dokuz satırlık içe aktarım örneği: tek satır, çok satırlı, `// import …` yorumu ×2, `type` üyeli,
// v3 `magazaSiparisi` / `raporMarj` satırları.
const ICE_AKTARIM_ORNEGI = [
  "import { odemeYontemiSegmenti, segmentCirosu } from '../../../utils/pano/musteriAnaliz';",
  'import {',
  '  yilAylikCiro,',
  '  type ZamanKovasi,',
  "} from '../../../utils/pano/ciroDonem';",
  "// import { hamMarj } from '../../../utils/pano/raporMarj';",
  "import { tryDisiMi } from '../../../utils/siparisler/magazaSiparisi';",
  "import { stokKartiCozucu, type BrutMarjSonucu } from '../../../utils/pano/raporMarj';",
  "// import { siparisSehri } from '../../../utils/siparisler/teslimatAdresi';",
].join('\n');

describe('§4c · desen kâhini (yerel desenler boş değil — mutasyon ayırt edici)', () => {
  it('yerel desenler BAYRAKSIZ (`suclular` `desen.test` çağırır; `i` bayrağı dize taramasına kayar)', () => {
    const YEREL: readonly RegExp[] = [
      MATH_MAX, K9_DESENI, ESKI_MALIYET_OKUYUCU, HHI_CAGRISI, HHI_IMPORTU, ...EL_YAPIMI_HHI, YEREL_HHI_ESIGI,
      HHI_ESIK_LITERALI, GB4_HHI_IZI, ILK_N_METNI, GB4_ODEME_IZI, HAYALET_ODEME_ALANI, PANEL_KAPISI,
      HAYALET_SEHIR_ALANI, SEHIR_OKUYUCU, HAYALET_KALEM_ALANI, GB4_MARJ_EGILIM_IZI, MUSTERI_ADI, IPTAL_LITERALI,
      HAM_SIPARIS_GECISI, LEAD_CARI_KODU_PROP, ANAHTARSIZ_SAYACI,
      SEHIR_SEGMENTLEYICI, KATEGORI_SEGMENT_CAGRISI, KATEGORI_KARTTAN, ...UST_DUZEY_SUZGECLERI.map(([, , d]) => d),
      HAM_SIPARIS_YARDIMCIYA, MUSTERI_SECENEGI_HARITALI, MUSTERI_OZETI_CAGRISI, MUSTERI_OZETI_SECENEKLI,
      YIL_AYLIK_CAGRISI, YIL_AYLIK_IPTAL_HARIC, IPTAL_HARIC_KAPALI, YUZDELIK_CAGRISI, SADECE_POZITIF,
      KPIS239_DIZISI, KPI_OGESI, EKSIK_ADI_ALANI, EKSIK_ADI_ZORUNLU,
    ];
    expect(YEREL.filter(d => d.flags !== '').map(d => `/${d.source}/${d.flags}`)).toEqual([]);
  });

  it('tek satırlık kod fikstürleri: pozitifler eşleşir, negatifler eşleşmez', () => {
    const sapan = DESEN_VAKALARI.filter(v => v.desen.test(v.metin) !== v.eslesir)
      .map(v => `${v.eslesir ? 'eşleşmeli' : 'eşleşmemeli'} · ${v.ne} · /${v.desen.source}/ · ${v.metin.slice(0, 100)}`);
    expect(sapan).toEqual([]);
    // Boşa yeşil koruması: tablo boşalırsa yukarıdaki iddia anlamsızlaşır.
    expect(DESEN_VAKALARI.filter(v => v.eslesir).length, 'pozitif vaka').toBeGreaterThan(20);
    expect(DESEN_VAKALARI.filter(v => !v.eslesir).length, 'negatif vaka').toBeGreaterThan(20);
  });

  it('satır yorumu: süzgeç sonrası GB4_HHI_IZI yok; HAM hâli eşleşir (süzgeç kaldırılırsa KIRMIZI)', () => {
    expect(GB4_HHI_IZI.test(parcaKodu(K14_SATIR_YORUMU)), 'süzgeç sonrası').toBe(false);
    expect(GB4_HHI_IZI.test(K14_SATIR_YORUMU), 'HAM').toBe(true);
  });

  it('üç bloklu K14 karar yorumu: süzgeç sonrası üç panel izi de yok; HAM metinde K14 = 5 satır, ödeme izi eşleşir', () => {
    const suzulmus = parcaKodu(K14_UC_BLOK);
    expect(GB4_HHI_IZI.test(suzulmus), 'HHI izi').toBe(false);
    expect(GB4_ODEME_IZI.test(suzulmus), 'ödeme izi').toBe(false);
    expect(GB4_MARJ_EGILIM_IZI.test(suzulmus), 'brüt marj eğilimi izi').toBe(false);
    expect(kararSatirlari(K14_UC_BLOK, /\bK14\b/), 'HAM · K14 taşıyan satır').toBe(5);
    expect(GB4_ODEME_IZI.test(K14_UC_BLOK), 'HAM · ödeme izi (mutasyon kanıtı)').toBe(true);
    // Süzgeç satır numarasını korur: yorum satırları boşalır, sayı değişmez.
    expect(suzulmus.split('\n')).toHaveLength(K14_UC_BLOK.split('\n').length);
  });

  it('`iceAktariyor`: tek satır / çok satırlı / `type` üyeli bulunur; yorumdaki import, olmayan ad ve yanlış modül bulunmaz', () => {
    const kod = parcaKodu(ICE_AKTARIM_ORNEGI);
    const VAKALAR: ReadonlyArray<readonly [modul: string, ad: string, beklenen: boolean]> = [
      ['utils/pano/musteriAnaliz', 'odemeYontemiSegmenti', true],
      ['utils/pano/ciroDonem', 'yilAylikCiro', true],
      ['utils/pano/ciroDonem', 'ZamanKovasi', true],
      ['utils/pano/raporMarj', 'hamMarj', false],
      ['utils/pano/musteriAnaliz', 'olmayanAd', false],
      ['utils/pano/ciroDonem', 'odemeYontemiSegmenti', false],
      ['utils/siparisler/magazaSiparisi', 'tryDisiMi', true],
      ['utils/pano/raporMarj', 'stokKartiCozucu', true],
      ['utils/siparisler/teslimatAdresi', 'siparisSehri', false],
    ];
    const sapan = VAKALAR.filter(([m, a, b]) => iceAktariyor(kod, m, a) !== b).map(([m, a, b]) => `${m}/${a} → ${b} bekleniyordu`);
    expect(sapan).toEqual([]);
    // HAM metinde yorumdaki iki içe aktarım bulunur — süzgeç kaldırılırsa iki `false` vakası KIRMIZI (mutasyon kanıtı).
    expect(iceAktariyor(ICE_AKTARIM_ORNEGI, 'utils/pano/raporMarj', 'hamMarj'), 'HAM · yorumdaki hamMarj').toBe(true);
    expect(iceAktariyor(ICE_AKTARIM_ORNEGI, 'utils/siparisler/teslimatAdresi', 'siparisSehri'), 'HAM · yorumdaki siparisSehri').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 · O1 + O2 + O10 + O23: 6c'nin `utils/rapor` DIŞI ek export'ları tüketiliyor
// ---------------------------------------------------------------------------

// Dayanak: PLAN-v2 §5 "İMPORT taraması" — her alt fazın kapanışında, o alt fazın ürettiği HER export için ≥ 1 üretim
// tüketicisi. `utils/rapor/*` export'larını `rapor6a.degismez` §2 dizin taramasıyla zaten zorlar (burada tekrarlanmaz);
// `utils/pano/*` ekleri HİÇBİR kapıdan geçmez → 6a'daki `EK_EXPORTLAR`'ın 6c eşdeğeri. Kapsam İKİ dosyadır.
// O2: adlar utils-genisletmeler.md kalem 1a / 2a / 2b / 3 / 6'dan; tüketici dosya bağlama şartnamelerinin içe aktarım
// listesinden. Kaynakta ölçüldü (2026-10-17): sekiz adın sekizi de `src/utils`'ta export; ad farkı YOK.
// O23 (v3): `aylikMarjEgilimi` YAZILMAZ (tek tüketicisi GB4 P306 kalktı) → listede YOK; kalem 6'dan yalnız `hamMarj` (GB4 P22).
const EK_EXPORTLAR: readonly (readonly [modul: string, ad: string, tuketici: string])[] = [
  ['utils/pano/musteriAnaliz', 'odemeYontemiSegmenti', GB2],           // 1a · O3
  ['utils/pano/musteriAnaliz', 'ODEME_YONTEMI_BELIRTILMEMIS', GB2],    // 1a · O3
  ['utils/pano/ciroDonem', 'yilAylikCiro', GB2],                       // 2a · O7
  ['utils/pano/ciroDonem', 'hareketliOrtalama', GB4],                  // 2b · O6 / O8
  ['utils/pano/hedefButce', 'donemProjeksiyonu', GB2],                 // 3 · O9
  ['utils/pano/raporMarj', 'hamMarj', GB4],                            // 6 · O13 (geçerli kalan kısım: P22)
];
// O10: `segmentCirosu`'nun 4 parametreli aşırı yükü yeni bir AD üretmez → içe aktarım taramasıyla görülemez; ayırt
// edici olan `anahtarsizSay` seçeneğidir (GB4 P495 kategori + ikincil P238 şehir; GB2 P249 4. parametreyi GEÇMEZ).
// Desen (`ANAHTARSIZ_SAYACI`) dosya başında, `iceAktariyor`'un yanında tanımlı: 4c tablosu onu §5'ten önce kullanır.

describe('§5 · O1 + O2 + O10 + O23: 6c ek export\'ları tüketiliyor', () => {
  it('5.1 · `utils/pano` ek export\'larının her biri beklenen tüketici dosyada içe aktarılıyor', () => {
    // "Çağrıyı" değil "içe aktarımı" iddia eder (6a `EK_EXPORTLAR` ile aynı güç): yardımcı yazılıp bağlanmazsa
    // (bağlama satır içi hesabı bırakırsa) kırmızı kalır — "yazıldı ama bağlanmadı" sınıfı.
    const tuketicisiz = EK_EXPORTLAR.filter(([m, a, t]) => !iceAktariyor(kodMetni(t), m, a))
      .map(([m, a, t]) => `${m} → ${a} (beklenen tüketici: ${t})`);
    expect(tuketicisiz).toEqual([]);
  });

  it('5.2 · O10: `segmentCirosu` 4. parametresi (`anahtarsizSay`) YALNIZ GB4\'te', () => {
    expect(ANAHTARSIZ_SAYACI.test(kodMetni(GB4)), 'GB4 · anahtarsizSay').toBe(true);
    expect(ANAHTARSIZ_SAYACI.test(kodMetni(GB2)), 'GB2 · anahtarsizSay (gerileme çiti)').toBe(false);
  });
});
