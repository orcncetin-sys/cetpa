/**
 * rapor6d.degismez.test.ts — Faz 3 6d (GENEL III) KAPANIŞ ÖLÇÜSÜ (2026-10-18).
 *
 * Neden var: PLAN-v2 §5 "SERT (alt fazın kendi dosyalarında = 0)" ve "DEĞİŞMEZ testleri (kaynak tarayan, izin
 * listeli): … `\.total === 'number'` → 6d" der. 6a / 6b / 6c kendi dosyaları için bu ölçüyü yazdı; GenelBloklar5 (GB5)
 * ve GenelBloklar6 (GB6) için kimse yazmazsa 6d kapanışı ölçüsüz kalır. 6d'ye ÖZGÜ dört neden (hepsi ölçüldü):
 *   1. K1 — hayalet sipariş tutarı: iki dosyada 18 satır `typeof oR.total === 'number' ? … : (o.lineItems ?? []).reduce(…)`
 *      kalıbı; `Order`'da başlık düzeyinde `total` alanı YOK, her sipariş kalem toplamına düşüyordu (kalemde hayalet
 *      `unitPrice` ve `?? 0`). PLAN-v2'nin kendi deseni bu kalıbın boşluksuz yazımını görmüyor (O31). O26: kalemden yedek YOK.
 *   2. K14 / K-TAHMİN — beş çift panel + on çift kutu + bir çift liste (O25 + N1–N4) + altı K14 adayı (kullanıcı 2026-10-18
 *      «ok» = aday tablosunun altı satırı da «kaldır»: GB5 P2 / P7, GB6 P2 / P7 / P11 / P13). Yarım düzeltme sınıfının tam yeri:
 *      biri testli yardımcıya bağlanır, öteki eski formülle yaşar. Metin taraması çağrı doğruluğunu kanıtlayamaz (6a dersi)
 *      ama ikinci panelin / ikinci formülün YOKLUĞUNU kanıtlayabilir.
 *   3. K2 + O21 — süzgeçsiz ciro: GB5'in 12, GB6'nın 11 paneli iptali ciroya katıyordu; hiçbiri TRY dışı mağaza siparişini
 *      ayırmıyordu. Süzgeç bileşenin ÜST DÜZEYİNE taşındı; render testi yok → kaynakta çitlenir.
 *   4. K13 / O22 — hayalet alanlı panel: GB6 P12 «Low Stock» kutusu hayalet `.stock` + yazıcısız `reorderPoint` okuyordu
 *      (kutu canlıda HER ZAMAN «0 / yeşil»). Orkestratör N2: kutu KALKAR, Genel Özet KPI'ı kalır.
 *
 * Bölümler:
 *   §1  GB5 + GB6'da SERT 1–3 kod satırı = 0 (izin listesi mekanizması var, hedef BOŞ)
 *   §1b izin listesi disiplini (alt sınır 6e — 6d kendi satırını kendine devredemez)
 *   §1c O15 + YK2: `Math.max(` kod satırı = 0 (paylaşılan S2'nin göremediği kıskaçlar dâhil)
 *   §2  K1 + O26 + PLAN-v2 §5 SERT 4: hayalet `.total` yok (iki dosya + `reports/**` devir tablosu), hayalet alan okunmaz,
 *       tek tutar seçicisi
 *   §3  K14 / K-TAHMİN / O25 + N1–N4 + K14 aday kararı: çift / aday paneller, kutular, liste kalktı, karşılıkları yaşıyor,
 *       «K14 ADAYI» notu kalmadı
 *   §3b K2 / K4 / O21 / O28 / O22 / O30: süzgeçler üst düzeyde, bağlar çağıranda
 *   §3c O27: «verisi olan son N dönem» yok
 *   §3d GENEL-2: 'K' kısaltması tek tanımdan ve rakam kapılı
 *   §4  kâhin: dosyalar gerçekten okunuyor, render çağrıları yerinde, yerel desenler boş değil ve çift yönlü
 *   §5  O1 + O2: 6d'nin `utils/rapor` DIŞI ek export'u tüketiliyor
 *
 * Ölçülen taban (bağlama ÖNCESİ, yayin-19 `daff960`, paylaşılan `yorumsuz` + `sertIhlalleri` ile): GB5 S1 23 · S2 6 · S3 1
 * → 30 ayrık satır (30 kayıt); GB6 S1 17 · S2 10 · S3 1 → 27 ayrık satır (28 kayıt); toplam 57 satır, 14'ü K14 ile kalkan
 * panel / listede (silmeyle düşer), 43 satır / 44 kayıt bağlamayla. `Math.max(` 19 satır; O31 `.total` iki dosyada 18,
 * `reports/**` 39; hayalet `unitPrice` 21, tür dönüşümü 39; elle kalem geçişi 21; silinen panel / kutu / liste izi 57 site;
 * panel kapısı / `<h3` GB5 13 · GB6 15; `.sort().slice(` 7; `'K'` literali GB5 7 · GB6 6. Kapanış beklentisi: SERT 57 → 0,
 * `Math.max(` 19 → 0, `.total` 18 → 0 (`reports/**` 39 → 21), kapı / `<h3` GB5 11 · GB6 12, IZIN_LISTESI ve MESRU_KISKACLAR
 * boş. Şartname: `6n-kesif/6d/baglama-degismez.md` (v2 + hizalama). Bağlama öncesi ağaçta (`daff960`) 49 `it`'in 34'ü
 * kırmızı, 15'i yeşildi (şartnamenin taslak koşusuyla aynı); kaynak satırı verilen 79 fikstür o ağaçta 0 sapma.
 *
 * Kullanıcı K14 aday kararı (2026-10-18, «ok» — ORKESTRATOR-KARARLARI.md «Kullanıcıya sorulan K14 adayları» tablosunun altı
 * satırının HEPSİ «kaldır»): GB5 P2 / P7 ve GB6 P2 (son kutusu «7d»; panel bütünüyle) / P7 / P11 / P13 SİLİNDİ. Bilerek değişen
 * çitler AYNI commit'te yeni değerle sabitlendi, gevşetilmedi: §3.1'e altı panel satırı; §3.2'ye beş kalan (GB1 P202 / P156 /
 * P215, GB4 P96, GB2 P234 — GB4 P66 ve GB1 P217 zaten listedeydi); 3.4'e aday kaldırma kararı kolu (GB5 ≥ 2, GB6 ≥ 4); 3.5
 * GB5 [11, 11] → [9, 9] · GB6 [12, 12] → [8, 8]; 3.6 «K14 ADAYI» notu ≥ 2 / ≥ 4 → TAM 0. Tabanın SERT ayrımı yeniden ölçüldü
 * (`daff960`, aynı `sertIhlalleri`, panel satır aralıkları): silinen altı panelde 10 satır / 10 kayıt (GB5 P2 1, P7 2; GB6 P2 1,
 * P7 3, P11 1, P13 2) → 57 satırın 24'ü silmeyle, 33 satır / 34 kayıt bağlamayla düşer; §1 hedefi (0) değişmez.
 *
 * Paket mutasyonları (2026-10-18, bağlama sonrası kopya ağaçta koşuldu — şartnamenin 20 mutasyonu, 23 adım): 22 adım
 * beklenen `it`'i kırmızıya çevirdi. Tek istisna M13 (GB6'da bir K14 karar yorumu satırının silinmesi): GB6 HAM metninde
 * 14 K14 satırı var, biri silinince 13 ≥ 8 → 3.4 yeşil kalıyordu. Paket turunda (aynı gün) 3.4'e güçlü kol eklendi:
 * kaldırma kararının yorum AÇILIŞI (`K14 (kullanıcı`, iki bağlama şartnamesinin karar yorumu biçimi ve kapanış grep'i)
 * GB5 ≥ 3, GB6 ≥ 8 — sayı kaldırma kararlarının sayısıdır, biri silinince KIRMIZI. Şartnamenin reddettiği güçlendirme (her
 * yorumun ikizin dosya adını taşıması — açık nokta 4) YAZILMADI: yorum metni dikte edilmez, yalnız açılış aranır.
 *
 * Test bir ÖLÇÜDÜR, onarım aracı DEĞİL: kırmızıysa bağlamanın kaçırdığı site demektir — izin listesine girdi
 * ekleyerek ya da deseni gevşeterek yeşile çevirme; kaçıran grubun dosyasını düzelt. Kırmızının mesajı
 * `dosya:satır kod` basar (sayıya indirgenmez).
 *
 * Paylaşılan tarayıcı (`src/test/degismezTarayici.ts`) ve dosya okuyucu (`src/test/kaynakTarama.ts`) İÇE AKTARILIR,
 * kopyalanmaz. 6d'nin kendine özgü desenleri BU DOSYADA durur — ortak modüle eklenmez (desen kilidi
 * `degismezTarayici.test.ts` §0b; O31). Dosya içeriği YALNIZ katı `yorumsuz(ad, içerik)` girişine verilir; hoşgörülü
 * `yorumsuzParca` yalnız satır içi fikstür alır (`degismezTarayici.test.ts` §10 çiti).
 *
 * Bilerek YAZILMAYANLAR:
 *   - Çağrı doğruluğu ve sayaç DEĞERLERİ (`musteriOzeti(` adedi, dövizli / tutarsız / tarihsiz sayaçları, `panelDurumu`'nun
 *     hangi panelde hangi durumu verdiği, `enBuyukBilinen` dönüş alanları): metin taraması çağrı doğruluğunu kanıtlayamaz,
 *     sayı iddiası meşru yeniden düzenlemede yanlış kırmızı üretir — birim testlerinin ve hakemin işi.
 *   - K20 sabit değerleri (`KILOMETRE_TASLARI`, BHS ağırlıkları / eşikleri, pencere uzunlukları), O16 etiketleri, K21 payda,
 *     K-YÜZDE / biçim (`yuzdeYaz`, sabit `₺${…}` simgeli tutar) — tanım / biçim kararları; modül testleri ve hakem.
 *   - GENEL-2 'K' kısaltmasının ÇIKTISI (USD, kur 41, 5.000 TL → «$122», «$0K» DEĞİL): çalışma anına bağlı; GB5 V9 /
 *     GB6 örnek beklenen + hakem. Kaynak düzeyi §3d'de.
 *   - ADAY panellerin içeriği (yalnız not VARLIĞI, 3.6), K24 GB6 P15 metni (yalnız 3.5 sayısında yaşar), `.stock` ve
 *     `m.date`'in `reports/**` geneli (6h), `itemCostTRY` / `costPrice` / `* 0.6` (iki dosyada 0), `GÖZDEN GEÇİRME`
 *     desenleri (`: 0`, `= 1` varsayılan parametre, `minHeight`), 6b'nin §0c kopya çiti.
 * KAPSAM: iki dosya (GB5, GB6) + `GenelRapor.tsx`'in GB5 / GB6 çağrı yeri. Dizin taraması YALNIZ §2.2 (PLAN-v2 §5
 * `components/reports/**` değişmezi) ve §3.3 (`src/utils`'ta tek ad). §3.2 kapalı dosyalarda (GB1–GB4, GenelOzet,
 * `RaporlarPage`) yalnız VARLIK okur; §3b.6 GB4'te yalnız `doluMetin` tanımını okur (O30 devir kaydı).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { SERT_DESENLERI, SINIFLAR, sertIhlalleri, ihlalYaz, yorumsuz, yorumsuzParca, type Ihlal } from '../../test/degismezTarayici';
import { SRC_KOK, oku, suclular, kaynakDosyalari } from '../../test/kaynakTarama';

const GB5 = 'components/reports/genel/GenelBloklar5.tsx';
const GB6 = 'components/reports/genel/GenelBloklar6.tsx';
const GENEL_RAPOR = 'components/reports/GenelRapor.tsx';
const RAPOR_DIZINI = 'components/reports';
const IKI_DOSYA = [GB5, GB6] as const;
const yol = (goreli: string) => join(SRC_KOK, goreli);
// Yorum DAHİL ham metin — yalnız §3.4 / §3.6'nın karar izi iddiası ve §1 / §4b'nin `sertIhlalleri` girdisi.
const ham = (goreli: string) => oku(yol(goreli));
// KATI giriş: ad + AYNI yoldan içerik (yer değiştiremez; `.tsx` adı TSX ayrıştırmasını seçer).
const kodMetni = (goreli: string) => yorumsuz(goreli, ham(goreli)).join('\n');
// Yorumlu fikstürler için — YALNIZ literal alır (degismezTarayici.test.ts §10 çiti; parametre adı `icerik` / `kaynak` OLMAZ).
// Bu yardımcıya `kodMetni(…)` / `ham(…)` ASLA verilmez (§10 çağıranları izler).
const parcaKodu = (fikstur: string) => yorumsuzParca('fikstur.tsx', fikstur).join('\n');
const siteler = (dosyalar: readonly string[], desen: RegExp) =>
  suclular(dosyalar.map(yol), desen).map(s => `${s.site} ${s.kod.trim().slice(0, 140)}`);
// Yerel desenlerin HEPSİ bayraksızdır (`suclular` `desen.test` çağırır); sayımda `g`'li KOPYA kullanılır.
const eslesmeSayisi = (metin: string, desen: RegExp) => [...metin.matchAll(new RegExp(desen.source, 'g'))].length;
const kararSatirlari = (metin: string, desen: RegExp) => metin.split('\n').filter(s => desen.test(s)).length;
// rapor6c `iceAktariyor` ile BİREBİR (rapor6a `raporIceAktarimlari` deseni; `type` atılır, `e as g` → e). Yorumdaki import
// SAYILMAZ çünkü çağıran `kodMetni` verir.
const iceAktariyor = (metin: string, modul: string, ad: string): boolean =>
  [...metin.matchAll(/import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .some(e => e[2].endsWith(modul) && e[1].split(',').some(p => p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] === ad));
// `ad(` çağrılarının argüman metinleri — parantez DENGESİYLE (çok satırlı çağrı dâhil). Girdi `kodMetni` (yorumsuz).
// Sınır: dize içindeki eşleşmemiş parantez dengeyi bozar (bu dosyalardaki çağrılarda yok — 4c vakaları).
const cagriArgumanlari = (metin: string, ad: string): string[] => {
  const sonuc: string[] = [];
  for (const e of metin.matchAll(new RegExp(`\\b${ad}\\(`, 'g'))) {
    const bas = e.index + e[0].length;
    let derinlik = 1;
    let i = bas;
    for (; i < metin.length && derinlik > 0; i++) {
      if (metin[i] === '(') derinlik++;
      else if (metin[i] === ')') derinlik--;
    }
    sonuc.push(metin.slice(bas, i - 1));
  }
  return sonuc;
};
// Tanımı (ilk `;`'e dek) `alan`ı taşıyan `const` adları — adlı seçenek sabiti (`const musteriSecenek = { …, leadCariKodu }`).
const alanTasiyanSabitler = (metin: string, alan: RegExp): string[] =>
  [...metin.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=([^;]*)/g)].filter(e => alan.test(e[2])).map(e => e[1]);
// "Her `ad(` çağrısı `alan`ı taşır": satır içi ya da `alan` taşıyan adlı sabitle. Taşımayan çağrılar döner (sayı iddiası DEĞİL).
const secenegiTasimayanCagrilar = (metin: string, ad: string, alan: RegExp): string[] => {
  const sabitler = alanTasiyanSabitler(metin, alan);
  return cagriArgumanlari(metin, ad)
    .filter(arg => !alan.test(arg) && !sabitler.some(s => new RegExp(`\\b${s}\\b`).test(arg)))
    .map(arg => `${ad}(${arg.replace(/\s+/g, ' ').trim().slice(0, 120)})`);
};

// ---------------------------------------------------------------------------
// §1 · DEĞİŞMEZ: GB5 + GB6'da SERT 1–3 kod satırı = 0
// ---------------------------------------------------------------------------

/**
 * İzin listesi — MEKANİZMA var, 6d kapanış hedefi BOŞ.
 * Girdi eklemenin TEK meşru yolu: bir 6d şartnamesi (`6d/baglama-*.md` / `6d/utils-*.md`) o satırı ALT FAZ ADIYLA
 * (6e–6m) AÇIKÇA devretmişse. Ölçüm (2026-10-18, `grep -n "6[e-m]" 6d/*.md`): devir yalnız `.total`'ın reports/** kalanı
 * (6g / 6k / 6l — §2.2 tablosu), O30 `doluMetin` kopyası ve GB3 P12 teslim oranı paydası için geçiyor (6m) — hiçbiri
 * GB5 / GB6'nın SERT satırı değil. K24 tuzağı: GB6 P15 «500 Analytics Phases» ertelendi ama SERT satırı TAŞIMIYOR →
 * izin girdisi GEREKMEZ.
 */
interface Izin { dosya: string; parca: string; altFaz: string; gerekce: string }
const IZIN_LISTESI: Izin[] = [];
const izinli = (i: Ihlal) => IZIN_LISTESI.some(z => z.dosya === i.dosya && i.kod.includes(z.parca));

const ihlaller: Ihlal[] = IKI_DOSYA.flatMap(d => sertIhlalleri(d, ham(d)));

describe('§1 · DEĞİŞMEZ: GB5 + GB6\'da SERT 1–3 = 0', () => {
  // Kapsam SERT 1–3'ün TAMAMI. O15: K14 ile kalkan 14 satır paneliyle / listesiyle düşer (GB5 P11 ilk 5 listesi N3 dâhil);
  // kullanıcının 2026-10-18 K14 aday kararıyla silinen altı panel 10 satır daha düşürür (toplam 24). Kalan 33 satır (34 kayıt)
  // iki bağlama şartnamesinin «Sahte kesinlik envanteri»nde (çapraz çizelge) → test bağlamanın kapsadığından FAZLASINI iddia
  // etmiyor. Yorum satırları HARİÇ (`sertIhlalleri` `yorumsuz()` üstünden tarar).
  // Sınıf başına ayrı `it`; mesaj `dosya:satır kod` basar — hakem hangi sitenin kaçırıldığını görmeli.
  for (const sinif of SINIFLAR) {
    it(`${sinif} ihlali yok`, () => {
      expect(ihlaller.filter(i => i.sinif === sinif && !izinli(i)).map(ihlalYaz)).toEqual([]);
    });
  }
});

describe('§1b · izin listesi disiplini (liste boşken de kural yaşar)', () => {
  it('her girdi 6e–6m arası bir alt faza bir 6d şartnamesiyle devredilmiş, gerekçeli ve YETERİNCE DAR', () => {
    for (const z of IZIN_LISTESI) {
      // 6c'de `/^6[d-m]$/` idi; 6d kendi satırını kendine devredemez → alt sınır 6e.
      expect(z.altFaz, `${z.dosya} · ${z.parca}`).toMatch(/^6[e-m]$/);
      expect(z.gerekce.length, `${z.dosya} · ${z.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      // Devri yapan bir 6d şartnamesi olmalı.
      expect(z.gerekce, `${z.dosya} · ${z.parca} · şartname alıntısı`).toMatch(/6d\/(?:baglama|utils)-[\w-]+\.md/);
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
// §1c · O15 + YK2: `Math.max(` kod satırı iki dosyada = 0
// ---------------------------------------------------------------------------

// Neden ayrı: paylaşılan S2 desenleri yalnız ilk argümanı 2–4 ya da son argümanı 1 / 2–4 olan `Math.max(`'ı arar; GB5
// `Math.max(0, 100 - cancelRate * 5)` (P10), `Math.max(1, Math.ceil(sorted.length * 0.2))` (P11) ve
// `Math.max(1,Math.floor(sorted.length/40))` (P13) S2'ye takılmaz. Bağlamadaki karşılığı (GB5 v2 reçetesi): P10
// `ISS_TAVAN − Math.min(ISS_TAVAN, …)`, P11 kapı ≥ 3 ürün, P13 `kumulatifSeyir` (`enCokNokta`). `Math.min(` İDDİA EDİLMEZ
// (meşru üst kırpma).
const MATH_MAX = /Math\.max\(/;
// YK2 (bu şartnamenin yerel kararı; eski «ÖNERİLEN O33»): bağlama şartnamesi bir kıskacı gerekçeyle KORUYORSA buraya girer.
// Hedef BOŞ (GB5 v2 üç satırı da taşıyor); disiplin §1b ile aynı, altFaz yok.
interface MesruKiskac { dosya: string; parca: string; gerekce: string }
const MESRU_KISKACLAR: MesruKiskac[] = [];

describe('§1c · O15 + YK2: `Math.max(` kod satırı iki dosyada = 0', () => {
  it('piksel / ölçek tabanı ve kıskaç kalıntısı yok (yorum anması sayılmaz); MESRU_KISKACLAR disiplini', () => {
    expect(siteler(IKI_DOSYA, MATH_MAX)
      .filter(s => !MESRU_KISKACLAR.some(k => s.startsWith(`src/${k.dosya}:`) && s.includes(k.parca)))).toEqual([]);
    // Liste boşken de kural yaşar: gerekçe ≥ 30 ve GB5 / GB6 şartnamesi alıntısı · parça ≥ 16 · her girdi TEK satır · ≤ 3.
    for (const k of MESRU_KISKACLAR) {
      expect(k.gerekce.length, `${k.dosya} · ${k.parca} · gerekçe`).toBeGreaterThanOrEqual(30);
      expect(k.gerekce, `${k.dosya} · ${k.parca} · şartname alıntısı`).toMatch(/6d\/baglama-genel-bloklar[56]\.md/);
      expect(k.parca.length, `${k.dosya} · ${k.parca} · parça çok genel`).toBeGreaterThanOrEqual(16);
      expect(siteler([k.dosya], MATH_MAX).filter(s => s.includes(k.parca)), `${k.dosya} · ${k.parca}`).toHaveLength(1);
    }
    expect(MESRU_KISKACLAR.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// §2 · K1 + O26 + PLAN-v2 §5 SERT 4
// ---------------------------------------------------------------------------

// K1 — kullanıcı cümlesi YOK (KARARLAR.md); PLAN-v2 §8 sıra 6 + orkestratör O26: tek tanım siparisTutari, kalem toplamından yedek yok; total / unitPrice okunmaz.
// K13 kullanıcı: "veri eklenebiliyorsa ver, mikro yüzünden verilemiyorsa N/A yaz, CETPA App verisi varsa N/A+ "xx,xx" göster."
// + O22 — hayalet alan OKUNMAZ (2.3).
// O31 (orkestratör): PLAN-v2 §5'in `typeof .*\.total === 'number'` deseni boşluksuz yazımı görmez; yerel, boşluk toleranslı desen
// (orkestratör metniyle BİREBİR). Paylaşılan `SERT_DESENLERI`'ne DOKUNULMAZ.
const TOTAL_TIPI_DENETIMI = /typeof\s*[\w.]*\.total\s*===\s*['"]number/;
// Yalnız 4c'nin O31 kanıt fikstürü — taramada KULLANILMAZ.
const PLAN_V2_SERT4_TOTAL = /typeof .*\.total === 'number'/;
// Devir tablosu (PLAN-v2 §5 "izin listeli" değişmezi): yol DESENİYLE gruplu — 6h0 bölmesi dosya adlarını değiştirse de
// grup sabit. Sayı TAM eşit: azalan alt faz satırını AYNI commit'te düşürür, artış kırmızı. Tablo 6m'de boşalır.
const TOTAL_DEVIR_TABLOSU: readonly (readonly [altFaz: string, yolDeseni: RegExp, beklenen: number])[] = [
  ['6g', /^src\/components\/reports\/crm\/CrmBloklar(?:9|10)\.tsx$/, 9],
  ['6k', /^src\/components\/reports\/(?:LojistikRapor|lojistik\/[^/]+)\.tsx$/, 10],
  ['6l', /^src\/components\/reports\/(?:IKRapor|ik\/[^/]+)\.tsx$/, 2],
];
const totalSiteleri = () => suclular(kaynakDosyalari(yol(RAPOR_DIZINI)), TOTAL_TIPI_DENETIMI);
const dosyaOf = (site: string) => site.replace(/:\d+$/, '');
// K1 "total / unitPrice okunmaz" + K13 / O22 hayalet alanları. `.total` hem başlıktaki hayalet alanı hem KALEMİN gerçek
// `total`ını yakalar: kalem tutarı TEK seçiciden (`kalemTutari`, K-KALEM) okunur, bileşende doğrudan okunmaz.
const HAYALET_ALANLAR: readonly (readonly [ad: string, desen: RegExp])[] = [
  ['sipariş / kalem `total`', /\.total\b|\[\s*['"]total['"]\s*\]/],
  ['`unitPrice`', /\bunitPrice\b/],
  ['`productName` / `productId`', /\bproductName\b|\bproductId\b/],
  ['`.stock`', /\.stock\b/],
  ['`reorderPoint`', /\breorderPoint\b/],
  ['`as unknown as Record`', /\bas\s+unknown\s+as\s+Record\b/],
];
// O26: sipariş tutarı yalnız tek seçiciden (`SEC = siparisTutari`); bileşende doğrudan alan okuması ve elle kalem toplamı YOK.
const DOGRUDAN_TUTAR_ALANI = /\.totalPrice\b|\.totalAmount\b/;
const ELLE_KALEM_GECISI = /lineItems\s*\?\?\s*\[\]\s*\)\s*\.\s*(?:reduce|forEach|map)\(/;

describe('§2 · K1 + O26 + PLAN-v2 §5 SERT 4: hayalet tutar yok, tek seçici', () => {
  it('2.1 · K1: hayalet `typeof … .total` yok (iki dosya); SERT 4 paylaşılan tarayıcıya girmedi', () => {
    // Bağlamadaki karşılığı: iki envanterin K1 / O26 satırları (`SEC = siparisTutari`). İkinci yarı O31 ile hizalı
    // (`degismezTarayici.ts` «SERT 4 bu tarayıcıya GİRMEZ» yorumu): biri `total`'ı paylaşılan listeye eklerse §0b ile
    // BİRLİKTE burası da haber verir.
    expect(siteler(IKI_DOSYA, TOTAL_TIPI_DENETIMI)).toEqual([]);
    expect(Object.values(SERT_DESENLERI).flat().filter(d => /total/.test(d.source)).map(d => d.source)).toEqual([]);
  });

  it('2.2a · PLAN-v2 §5 · reports/**: devir tablosunda OLMAYAN `.total` sitesi yok', () => {
    // Bağlamadaki karşılığı: GB5 / GB6 bağlamaları (9 + 9 → 0). Bu testin dizin taramasına izin verilen TEK reports/** yeri.
    const grupsuz = totalSiteleri()
      .filter(s => !TOTAL_DEVIR_TABLOSU.some(([, desen]) => desen.test(dosyaOf(s.site))))
      .map(s => `${s.site} ${s.kod.trim().slice(0, 140)}`);
    expect(grupsuz).toEqual([]);
  });

  it('2.2b · reports/**: devir tablosu gerçek sayımla TAM eşit; her satır 6e–6m alt fazında', () => {
    // 6g / 6k / 6l kendi değişmez testlerini yazarken satırını AYNI commit'te düşürür; artış KIRMIZI.
    const siteler22 = totalSiteleri();
    const olculen = TOTAL_DEVIR_TABLOSU.map(([altFaz, desen]) => [altFaz, siteler22.filter(s => desen.test(dosyaOf(s.site))).length]);
    expect(olculen).toEqual(TOTAL_DEVIR_TABLOSU.map(([altFaz, , beklenen]) => [altFaz, beklenen]));
    expect(TOTAL_DEVIR_TABLOSU.map(([altFaz]) => altFaz).filter(a => !/^6[e-m]$/.test(a))).toEqual([]);
  });

  it('2.3 · K1 + K13 / O22: hayalet alan okuması yok (iki dosya)', () => {
    // Bağlamadaki karşılığı: iki envanter (`SEC`, `kalemTutari`, `urunSatislari`); `.stock` / `reorderPoint` GB6 P12
    // «Low Stock» kutusuyla gider (N2).
    expect(HAYALET_ALANLAR.flatMap(([ad, d]) => siteler(IKI_DOSYA, d).map(s => `${ad} · ${s}`))).toEqual([]);
  });

  it('2.4 · K1 / O26: TEK tutar seçicisi (başlık-yalnız) içe aktarılıyor; kalem yedeği yazılmadı; doğrudan alan / elle kalem yok', () => {
    // Çağrı doğruluğunu iddia ETMEZ (birim testi + hakem). Bağlamadaki karşılığı: iki envanterin «tek seçici» satırı
    // (`const SEC = siparisTutari;`). `raporVeriKatmani.ts` okuması tek dosyalık VARLIK okumasıdır (gerileme çiti).
    const seciciEksik = IKI_DOSYA.filter(d => !(iceAktariyor(kodMetni(d), 'utils/siparis', 'siparisTutari')
      || iceAktariyor(kodMetni(d), 'utils/pano/raporVeriKatmani', 'raporSiparisi')));
    expect(seciciEksik, 'siparisTutari / raporSiparisi içe aktarmayan dosya').toEqual([]);
    expect(/^export\s+function\s+(?:kalemYedekliTutar|tutarKaynagi)\b/m.test(kodMetni('utils/pano/raporVeriKatmani.ts')),
      'raporVeriKatmani · kalem yedeği yazılmadı (O26)').toBe(false);
    expect(siteler(IKI_DOSYA, DOGRUDAN_TUTAR_ALANI), 'doğrudan totalPrice / totalAmount').toEqual([]);
    expect(siteler(IKI_DOSYA, ELLE_KALEM_GECISI), 'elle kalem geçişi').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3 · K14 / K-TAHMİN / O25 + N1–N4: çift paneller / kutular / liste kalktı, karşılıkları yaşıyor
// ---------------------------------------------------------------------------

// K14 kullanıcı: "kaldır" — GB5 P1 / P5, GB6 P3 / P4 / P14 panelleri; GB6 P1 «Best Day» / «Total Orders», P2 «30d» / «90d», P8 karşılama halkası, P12 «Orders (30d)» / «SKUs» / «Low Stock» / «Employees» / «Quotes» kutuları ve GB5 P11 ilk 5 listesi çiftti (aynı ölçü × kırılım × pencere); her çiftten testli yardımcıya bağlı olan kalır (KARARLAR.md K14; orkestratör O25, N1–N4)
// K14 kullanıcı 2026-10-18: «ok» — aday tablosunun (yalnız pencere farkı, O25) altı satırı da «kaldır»: GB5 P2 / P7, GB6 P2 (son kutusu «7d»; panel bütünüyle) / P7 / P11 / P13 SİLİNDİ; tablonun «önerilen kalan» sütunu kalır (ORKESTRATOR-KARARLARI.md «Kullanıcıya sorulan K14 adayları»)
// KARARLAR.md K14: "Aynı işi yapan çift paneller → "kaldır". Her çiftten TEK panel kalır (kalan: testli yardımcıya bağlı olan / daha doğru tanım)."
// K-TAHMİN — kullanıcı cümlesi YOK; PLAN-v2 §8 sıra 10 («K14'ün parçası + K22»): tek tahmin modeli `satisTahmini`; GB5 P1 ve
// GB6 P14 çift → KALKAR, `rapor/tahmin.buyumeTahmini` YAZILMAZ ve GB5 / GB6'da `satisTahmini(` çağrısı da OLMAZ (3.3).
// Başlık İKİ DİLDE + panelin kendine özgü tanıtıcıları + İKİZİNİN yardımcısı (panel kaldırılmayıp ikizinin yardımcısına
// "bağlanırsa" da KIRMIZI — K14 "kaldır", "düzeltip bırak" değil). Kutu satırları kod ADINA dayanır (ÖN KOŞUL 11).
// Kalan karar yorumu SERBEST (yorumsuz siler — 4c). O25: altı ADAY panel (GB5 P2 / P7, GB6 P2 / P7 / P11 / P13) kullanıcının
// 2026-10-18 kararıyla dizin 14–19 olarak girdi (ÖN KOŞUL 10: «kaldır» gelen panel §3.1'e, ikizi §3.2'ye; GB6 P2 için desen panelin
// bütünüdür). Dizin sırası SABİT (4c vakaları
// dizinle bağlanır): yeni satırlar sona eklenir.
const SILINEN_PANELLER: readonly (readonly [dosya: string, ne: string, desen: RegExp])[] = [
  [GB5, 'P1 30-Day Revenue Forecast (ikiz: RaporlarPage P620 + GB1 P190)',
    /30-Day Revenue Forecast|30 Günlük Ciro Tahmini|\bmomGrowth\b|\bbuyumeKatsayisi\b|MoM trend|\bsatisTahmini\(|\btahminTutari\(/],
  [GB5, 'P5 This Month vs Last Month (ikiz: GB2 P245 «Bu Ay Ciro» kartı)',
    /This Month vs Last Month|Bu Ay ve Geçen Ay|\bthisMRev\b|\blastMRev\b|\bgaugeVal\b|\bmtdKarsilastir\(/],
  [GB6, 'P3 Year-over-Year Revenue (ikiz: GB2 P251)',
    /Year-over-Year Revenue|Yıllık Ciro Karşılaştırması|\bprevByMonth\b|\bcurrByMonth\b|\byilAylikCiro\(/],
  [GB6, 'P4 Seasonality Index (ikiz: GB3 P13)',
    /Seasonality Index|Mevsimsellik Endeksi|100 = average month|\bmonthAvg\b|\boverallAvg\b|\bmevsimsellikEndeksi\(/],
  [GB6, 'P14 3-Month Revenue Forecast (ikiz: GB1 P190 + RaporlarPage P620)',
    /3-Month Revenue Forecast|3 Aylık Ciro Tahmini|\bavgGrowth\b|\bgrowthRates\b|avg monthly growth|\bsatisTahmini\(|\btahminTutari\(/],
  [GB6, 'P1 «Best Day» kutusu (ikiz: GB4 P66 «Top 10 Revenue Days — All Time» 1. satırı)',
    /\blabel\s*:\s*['"]Best Day['"]|\bbestDay\b|\bdayRevenue\b/],
  [GB6, 'P2 «90d» kutusu (ikiz: GB5 P9 «Son 90 Gün ve Önceki 90 Gün»)',
    /\bARTIS_PENCERELERI\b[^;]*=\s*\[[^\]]*\b90\b|\bperiods\s*=\s*\[\s*7\s*,\s*30\s*,\s*90\s*\]/],
  // N1 / N2 / N4 (orkestratör N-kararları, 2026-10-18): ölçüm notlarındaki kutular ÇİFT → KALKAR.
  [GB6, 'P1 «Total Orders» kutusu (ikiz: GenelOzet KPI «Sipariş» + GB3 P12 «Toplam Sipariş»; N2)',
    /\blabel\s*:\s*['"]Total Orders['"]|\bsub\s*:\s*['"]all time['"]/],
  [GB6, 'P2 «30d» kutusu (ikiz: GB3 P2 «Satış Momentum Skoru» «Ciro» kutusu; N1)',
    /\bARTIS_PENCERELERI\b[^;]*=\s*\[[^\]]*\b30\b|\bperiods\s*=\s*\[\s*7\s*,\s*30\b/],
  [GB6, 'P8 karşılama halkası (ikiz: GB3 P12 «Teslimat Oranı»; N4)',
    /\bfulfillRate\b|\bkarsilama8\b|\bfulfilled\b|\bteslimatOrani\(/],
  [GB6, 'P12 «Orders (30d)» kutusu (ikiz: GB3 P2 «Satış Momentum Skoru» «Sipariş adedi» kutusu; N2)',
    /\blabel\s*:\s*['"]Orders \(30d\)['"]|\borders30\b|\bSIPARIS_PENCERE_GUN\b/],
  [GB6, 'P12 «Low Stock» kutusu (ikiz: GenelOzet KPI «Düşük Stok»; N2)',
    /\blabel\s*:\s*['"]Low Stock['"]|\blowStockCount\b|\blowStockItems\b|\bstokDurum\b/],
  [GB6, 'P12 «SKUs» / «Employees» / «Quotes» kutuları (ikiz: GB3 P12 «İzlenen SKU» / «Aktif Çalışan» / «Teklifler»; N2)',
    /\blabel\s*:\s*['"](?:SKUs|Employees|Quotes)['"][^}]*\bcolor\s*:|\bString\(\s*(?:inventory|employees|quotations)\.length\s*\)/],
  // N3 (orkestratör): GB5 P11 panel KALIR (Pareto rozeti Genel'de tek); ilk 5 ürün listesi ÇİFT → KALKAR.
  [GB5, 'P11 «Ürün Cirosu Pareto» ilk 5 ürün listesi (ikiz: GB1 P217 «Ürün Karma Analizi (Top 6)»; N3 — panel ve rozet KALIR)',
    /\bsorted\.slice\(\s*0\s*,\s*5\s*\)|\btop5\[0\]\?\.\[1\]|\btop5\.map\(\(\[name\b|\brev\s*\/\s*totalRev\b|\bPARETO_LISTE_N\b|\bilk11\b|\bolcek11\b|\bp11\.satirlar\.slice\(/],
  // Kullanıcı K14 aday kararı (2026-10-18, «ok» — aday tablosunun altı satırı da «kaldır»). Desen: başlık (iki dil) + `daff960`
  // tanıtıcıları + 6d bağlamasının tanıtıcıları + kalan ikizin yardımcısı (panel ikizin yardımcısıyla geri gelirse de KIRMIZI).
  [GB5, 'P2 «Bu Yılın En Yüksek Ciro Günleri» (ikiz: GB1 P202 + GB4 P66; aday tablosu satır 1)',
    /Top Revenue Days This Year|Bu Yılın En Yüksek Ciro Günleri|Highest single-day revenue|\bthisYear\b|\bdayRev\b|\bEN_IYI_GUN_N\b|\bgunler2\b/],
  [GB5, 'P7 «YTD Revenue by Quarter» (ikiz: GB1 P156; aday tablosu satır 2)',
    /YTD Revenue by Quarter|\bytdTotal\b|\bqColors\b|\bytd7\b|\bCEYREK_RENKLERI\b|\bceyreklikCiro\(/],
  [GB6, 'P2 «Ciro Artış Oranları» paneli bütünüyle — son kutusu «7d» (ikiz: GB2 P234 haftalık değişim rozeti; aday tablosu satır 6)',
    /Revenue Growth Rates|Ciro Artış Oranları|\bARTIS_PENCERELERI\b|\bperiods\s*=\s*\[\s*7\b|\bpencere2\b|\bkartlar2\b|\bdonemKarsilastir\(/],
  [GB6, 'P7 «7-Day Rolling Revenue Avg» (ikiz: GB4 P96; aday tablosu satır 3)',
    /7-Day Rolling Revenue Avg|\brollGrad\b|\brollingDays\b|\bKAYAN_PENCERE_GUN\b|\bkayan7\b|\bhareketliOrtalama\(/],
  [GB6, 'P11 «Bu Ayın En İyi Ürünleri» (ikiz: GB1 P217; aday tablosu satır 5)',
    /Top Products This Month|Bu Ayın En İyi Ürünleri|\bmonthStart\b|\bproductRev\b|\bURUN_N\b|\bbuAyMi11\b|\burunSatislari\(/],
  [GB6, 'P13 «Aylık Sipariş Hacmi» (ikiz: GB1 P215; aday tablosu satır 4)',
    /Monthly Order Volume|Aylık Sipariş Hacmi|\bvolGrad\b|\bHACIM_AY\b|\badetler13\b|\baylikCiro\(/],
];
// Kâhin: her çiftten KALAN panel / kutu yaşıyor (kapalı dosyalarda yalnız VARLIK; GB5 P9 6d içi çiftin kalanı).
const KARSILIKLAR: readonly (readonly [dosya: string, ne: string, desen: RegExp])[] = [
  ['components/reports/genel/GenelBloklar2.tsx', 'GB2 P251 YoY', /Year-over-Year Revenue Comparison/],
  ['components/reports/genel/GenelBloklar2.tsx', 'GB2 P245 «Bu Ay Ciro» kartı', /'Bu Ay Ciro'/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P13 mevsimsellik', /\.ciro_mevsimsellik_endeksi\b/],
  ['components/reports/genel/GenelBloklar4.tsx', 'GB4 P66 tüm zamanın en yüksek ciro günleri', /Top 10 Revenue Days — All Time/],
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P190 başlık', /\.gelir_tahmini_3_ay\b/],
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P190 tek model', /\bsatisTahmini\(/],
  ['pages/RaporlarPage.tsx', 'RaporlarPage P620 tek model', /\bsatisTahmini\(/],
  [GB5, 'GB5 P9 son 90 gün ↔ önceki 90 gün', /Son 90 Gün ve Önceki 90 Gün/],
  // N1 / N2 / N4 kalanları (kapalı 6a / 6b dosyaları — yalnız VARLIK).
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P2 «Satış Momentum Skoru» «Ciro» kutusu', /\blabel:\s*oc\(currentLanguage\)\.ciro\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P2 «Satış Momentum Skoru» «Sipariş adedi» kutusu', /\blabel:\s*oc\(currentLanguage\)\.siparis_adedi\b/],
  ['components/reports/genel/GenelOzet.tsx', 'GenelOzet KPI «Sipariş»', /\blabel:\s*currentT\.kpi_orders\b/],
  ['components/reports/genel/GenelOzet.tsx', 'GenelOzet KPI «Düşük Stok»', /\blabel:\s*currentT\.kpi_low_stock\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P12 «Toplam Sipariş»', /\blabel:\s*oc\(currentLanguage\)\.toplam_siparis\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P12 «Teslimat Oranı»', /\blabel:\s*rc\(currentLanguage\)\.teslimat_orani\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P12 «İzlenen SKU»', /\blabel:\s*rc\(currentLanguage\)\.izlenen_sku\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P12 «Aktif Çalışan»', /\blabel:\s*oc\(currentLanguage\)\.aktif_calisan\b/],
  ['components/reports/genel/GenelBloklar3.tsx', 'GB3 P12 «Teklifler»', /\blabel:\s*rc\(currentLanguage\)\.teklifler\b/],
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P217 «Ürün Karma Analizi (Top 6)» (N3 — GB5 P11 listesinin kalanı; GB6 P11 kalanı)', /\.urun_karma_analizi_top_6\b/],
  // Kullanıcı K14 aday kararı (2026-10-18) kalanları (aday tablosunun «önerilen kalan» sütunu; GB4 P66 ve GB1 P217 yukarıda).
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P202 «En Yüksek Ciro Günleri — Son 90 Gün» (GB5 P2 kalanı)', /\.en_yuksek_ciro_gunleri_son_90_gun\b/],
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P156 «Çeyrek Bazlı Karşılaştırma» (GB5 P7 kalanı)', /\.ceyrek_bazli_karsilastirma\b/],
  ['components/reports/genel/GenelBloklar4.tsx', 'GB4 P96 «Rolling 7-Day Avg Revenue — Last 28 Days» (GB6 P7 kalanı)', /Rolling 7-Day Avg Revenue — Last 28 Days/],
  ['components/reports/genel/GenelBloklar1.tsx', 'GB1 P215 «Sipariş Adedi vs Ciro (12 Ay)» (GB6 P13 kalanı)', /\.siparis_adedi_vs_ciro_12_ay\b/],
  ['components/reports/genel/GenelBloklar2.tsx', 'GB2 P234 haftalık ciro değişim rozeti (GB6 P2 «7d» kalanı)', /\bdonemKarsilastir\(\s*son234\b/],
];
const BUYUME_KALINTISI = /\bmomGrowth\b|\bavgGrowth\b|\bbuyumeKatsayisi\b|Math\.pow\(\s*1\s*\+/;
const TAHMIN_CAGRISI = /\bsatisTahmini\(|\btahminTutari\(/;
const BUYUME_TAHMINI_ADI = /\bbuyumeTahmini\b/;
const PANEL_KAPISI = /reportsTab === 'genel'/;
const BASLIK = /<h3\b/;
const KARAR_K14 = /\bK14\b/;
// O25: yalnız pencere farkı olan panelin İLK yorum satırı (orkestratör biçimi `// K14 ADAYI (O25) — …`).
const KARAR_K14_ADAYI = /\bK14 ADAYI\b/;
// 3.4'ün güçlü kolu (paket turu, mutasyon 13): K14 KALDIRMA kararının yorum AÇILIŞI. Biçim iki bağlama şartnamesinin karar
// yorumu biçimidir (`K14 (kullanıcı, <tarih>): "…"` — GB4 K14 yorumları emsali); kapanış grep'leri de bunu sayar
// (`grep -c 'K14 (kullanıcı'`). Başlık notu («K14 — kullanıcı …») ve ADAY notu («K14 ADAYI (O25)») bu açılışı TAŞIMAZ.
// `kullanıcı`dan sonra `\b` YAZILMAZ: `ı` bayraksız desende sözcük karakteri değildir, sınır oluşmaz.
const KARAR_K14_KALDIRMA = /\bK14 \(kullanıcı/;
// Kullanıcı K14 aday kararı (2026-10-18): silinen aday panelin yerindeki karar yorumunun AÇILIŞI (görev biçimi
// `K14 — kullanıcı 2026-10-18: «ok» (kaldır) — <karşılığı> kalır`). Başlık notları bu açılışı TAŞIMAZ («K14 adayları … «ok»»).
const KARAR_K14_ADAY_KALDIRMA = /\bK14 — kullanıcı 2026-10-18: «ok» \(kaldır\)/;

describe('§3 · K14 / K-TAHMİN / O25 + N1–N4 + K14 aday kararı: çiftler ve adaylar kalktı, karşılıkları yaşıyor', () => {
  // YOKLUĞU iddia et, ÇAĞRIYI değil (6a dersi). Panel / kutu / liste başına AYRI `it`: hakem hangi çiftin kaldığını görür.
  // Bağlamadaki karşılığı: iki şartnamenin K14 reçetesi (O25 + N1–N4) — panel SİLİNİR / kutu KALKAR / liste SİLİNİR.
  SILINEN_PANELLER.forEach(([d, ne, desen], i) => {
    it(`3.1${'abcdefghijklmnopqrst'.charAt(i)} · K14 + O25 · ${ne} kalktı`, () => {
      expect(siteler([d], desen)).toEqual([]);
    });
  });

  it('3.2 · K14: her çiftten KALAN panel / kutu yaşıyor (kâhin — çiftin ikisi birden silinmedi)', () => {
    // Kapalı dosyalarda yalnız VARLIK okunur; i18n anahtarı değişirse 6m bu tabloyu AYNI commit'te günceller.
    const kayip = KARSILIKLAR.filter(([d, , desen]) => !desen.test(kodMetni(d))).map(([d, ne]) => `${d} · ${ne}`);
    expect(kayip).toEqual([]);
  });

  it('3.3 · K-TAHMİN: büyüme tahmini kalıntısı yok, ikinci tahmin yardımcısı yazılmadı', () => {
    // `src/utils` taraması TEK ad içindir; yorumdaki anma sayılmaz (`suclular` yorumsuz okur) — bağlamanın
    // «`buyumeTahmini` YAZILMADI» karar yorumu SERBEST. Bağlamadaki karşılığı: GB5 P1 ve GB6 P14 SİLİNİR.
    expect(siteler(IKI_DOSYA, BUYUME_KALINTISI), 'büyüme kalıntısı').toEqual([]);
    expect(siteler(IKI_DOSYA, TAHMIN_CAGRISI), 'GB5 / GB6 tahmin çağrısı').toEqual([]);
    expect(existsSync(yol('utils/rapor/tahmin.ts')), 'utils/rapor/tahmin.ts').toBe(false);
    expect(suclular(kaynakDosyalari(yol('utils')), BUYUME_TAHMINI_ADI).map(s => `${s.site} ${s.kod.trim().slice(0, 140)}`),
      'buyumeTahmini adı').toEqual([]);
  });

  it('3.4 · karar izi: K14 yorumu GB5 ≥ 5 (P1, P5, P11 listesi + P2, P7), GB6 ≥ 12 satırda (HAM metin — BİLEREK)', () => {
    // «Kararı uygularken kullanıcının cümlesi koda yorum olarak yazılır» kuralının tek kaynak-tarayan çiti: yorum burada
    // iddianın KENDİSİ olduğu için süzgeç KULLANILMAZ. Alt sınır zayıf (başlık yorumundaki anma da sayılır — 6c ile aynı).
    // 2026-10-18 aday kararı: GB5 3 → 5, GB6 8 → 12 (silinen her aday panelin yerinde bir karar yorumu).
    expect(kararSatirlari(ham(GB5), KARAR_K14), 'GB5 · K14 taşıyan satır').toBeGreaterThanOrEqual(5);
    expect(kararSatirlari(ham(GB6), KARAR_K14), 'GB6 · K14 taşıyan satır').toBeGreaterThanOrEqual(12);
    // Güçlü kol (paket turu, mutasyon 13): yukarıdaki iki satır bir karar yorumunun silinmesini YAKALAMIYORDU (GB6'da K14
    // anan 14 satır vardı, biri silinince 13 ≥ 8). Sayı kaldırma KARARLARININ sayısıdır; yorum metni dikte edilmez, yalnız
    // şartnamelerin yazdığı açılış aranır. GB5: P1, P5, P11 listesi = 3. GB6: P3, P4, P14, P1 «Best Day», P1 «Total Orders»,
    // P2 30 + 90 gün (tek yorum, sabitin yanında), P8 halka, P12 beş kutu (tek yorum) = 8. Biri silinince KIRMIZI.
    expect(kararSatirlari(ham(GB5), KARAR_K14_KALDIRMA), 'GB5 · K14 kaldırma yorumu').toBeGreaterThanOrEqual(3);
    expect(kararSatirlari(ham(GB6), KARAR_K14_KALDIRMA), 'GB6 · K14 kaldırma yorumu').toBeGreaterThanOrEqual(8);
    // Kullanıcı K14 aday kararı (2026-10-18 «ok»): silinen her aday panelin yerinde karar yorumu — GB5 P2, P7 = 2; GB6 P2 (son
    // kutusu «7d»; panel bütünüyle), P7, P11, P13 = 4. GB6 P2'nin 30 / 90 gün yorumu yukarıdaki koldadır (sabitle birlikte panele
    // taşındı). Biri silinince KIRMIZI.
    expect(kararSatirlari(ham(GB5), KARAR_K14_ADAY_KALDIRMA), 'GB5 · K14 aday kaldırma yorumu').toBeGreaterThanOrEqual(2);
    expect(kararSatirlari(ham(GB6), KARAR_K14_ADAY_KALDIRMA), 'GB6 · K14 aday kaldırma yorumu').toBeGreaterThanOrEqual(4);
  });

  it('3.5 · K14: TAM on bir panel kalktı — kapı / `<h3` GB5 [9, 9], GB6 [8, 8]', () => {
    // Bağlama paneli silip başlığını boş bir kapıda bırakırsa ya da kapıyı bırakıp gövdeyi `null` döndürürse ikisinden biri
    // ayrışır. GB6 P15 (K24) ve kutusu kalkan P1 / P8 / P12 bu sayının İÇİNDEDİR; GB5 P11 de (N3). Kalkanlar: O25 çiftleri GB5 P1 /
    // P5, GB6 P3 / P4 / P14; kullanıcının 2026-10-18 aday kararı GB5 P2 / P7, GB6 P2 / P7 / P11 / P13 (bilerek değişen çit:
    // GB5 [11, 11] → [9, 9], GB6 [12, 12] → [8, 8]).
    expect([eslesmeSayisi(kodMetni(GB5), PANEL_KAPISI), eslesmeSayisi(kodMetni(GB5), BASLIK)], GB5).toEqual([9, 9]);
    expect([eslesmeSayisi(kodMetni(GB6), PANEL_KAPISI), eslesmeSayisi(kodMetni(GB6), BASLIK)], GB6).toEqual([8, 8]);
  });

  it('3.6 · K14 aday kararı (kullanıcı 2026-10-18 «ok»): «K14 ADAYI» notu kalmadı — GB5 = 0, GB6 = 0 (HAM metin)', () => {
    // Desen `K14 ADAYI` tam ifadesidir; K14 kaldırma yorumu sayılmaz (4c). Eski iddia «GB5 ≥ 2 (P2, P7), GB6 ≥ 4 (P2 «7d», P7,
    // P11, P13)» idi; altı aday da «kaldır» aldı → not satırı panelle gitti, yerinde karar yorumu (3.4) durur. Bir aday panel
    // silinmeyip notuyla kalırsa ya da not başka bir panele taşınırsa KIRMIZI.
    expect(kararSatirlari(ham(GB5), KARAR_K14_ADAYI), 'GB5 · K14 ADAYI').toBe(0);
    expect(kararSatirlari(ham(GB6), KARAR_K14_ADAYI), 'GB6 · K14 ADAYI').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3b · K2 / K4 / O21 / O28 / O22 / O30: süzgeçler üst düzeyde, bağlar çağıranda
// ---------------------------------------------------------------------------

// K2 kullanıcı: "hayır" — «İptaller ciroya girsin mi → "hayır". Rapor ekranlarında ciro = iptaller HARİÇ, tek kural» (KARARLAR.md).
// K4 kullanıcı: "kimlikle" — «Müşteriyi adla mı kimlikle mi gruplayacağız → "kimlikle".» (KARARLAR.md).
// O21 (orkestratör): dövizli sipariş TL ciroya girmez, ayrı sayılır. O28: sayım panelleri TÜM (iptalsiz) siparişi sayar.
// GB4 (6c) "Bileşen üst düzeyi" emsali: iptal süzgeci ham siparişe, TRY dışı ayrımı iptalsiz kümeye. `useMemo` isteğe bağlı.
// Ad / kuruluş bağlama şartnamesinden (ÖN KOŞUL 11). Süzgecin DOĞRULUĞU değil, VARLIĞI çitlenir (6c 3b.6 dersi:
// içe aktarım tek başına yetmez — süzgeç silinip içe aktarım dövizli kümede yaşayınca paket YEŞİL kalıyordu).
const UST_DUZEY_KUMELER: readonly (readonly [ad: string, desen: RegExp])[] = [
  ['iptalsiz', /\bconst\s+iptalsiz\s*=\s*(?:useMemo\(\s*\(\)\s*=>\s*)?orders\.filter\(\s*(\w+)\s*=>\s*!siparisIptalMi\(\1\)\s*\)/],
  ['satislar', /\bconst\s+satislar\s*=\s*(?:useMemo\(\s*\(\)\s*=>\s*)?iptalsiz\.filter\(\s*(\w+)\s*=>\s*!tryDisiMi\(\1\)\s*\)/],
  ['dovizliler', /\bconst\s+dovizliler\s*=\s*(?:useMemo\(\s*\(\)\s*=>\s*)?iptalsiz\.filter\(\s*(?:tryDisiMi\s*\)|(\w+)\s*=>\s*tryDisiMi\(\1\)\s*\))/],
];
const SUZGEC_ICE_AKTARIMLARI: readonly (readonly [modul: string, ad: string])[] = [
  ['utils/siparis', 'siparisIptalMi'],
  ['utils/siparisler/magazaSiparisi', 'tryDisiMi'],
];
const IPTAL_LITERALI = /['"]Cancelled['"]/;
const AD_YEDEGI = /\bcustomerName\b[^;]*\|\|/;
const UYDURMA_KOVA = /['"](?:Unknown|Other)['"]/;
const K4_HARITASI = /\bleadCariKodu\b/;
const PROPS_TIPI = /\btype\s+Props\s*=\s*Pick<\s*ReportsCtx\s*,([^>]*)>/;
const GB6_ETIKETI = /<GenelBloklar6\b[\s\S]*?\/>/;
// GB6 P1 (K4 — Top Customer / Largest Order müşterisi). Orkestratör N2: «GB6'ya `lowStockItems` / `stokDurum` prop'u
// GEREKMİYORSA eklenmez» — tek okuyucuları «Low Stock» kutusuydu, kutu kalktı → liste tek ad (yokluk §3.1 «Low Stock» satırında).
const GB6_YENI_PROPLAR = ['leadCariKodu'] as const;
// O28: CİRO okuyan yardımcıya ham `orders` verilmez; sayım yardımcısına (`durumDagilimi`, `teslimatOrani`, tutarsız
// `zamanKovalari`, `tarihliKovala`) `orders` ve `iptalsiz` serbest — tutar okumayan sayım panelleri TÜM (iptalsiz) siparişi sayar.
const HAM_SIPARIS_CIRO = /\b(?:aylikCiro|ceyreklikCiro|mtdKarsilastir|kumulatifSeyir|donemCirosu|toplaBilinen|raporCirosu|kovayaYerlestir|urunSatislari|musteriOzeti|segmentCirosu|enBuyukBilinen|kumulatifPaylar|yuzdelikler)\(\s*orders\b/;
const HAM_SIPARIS_ZAMAN_CIROSU = /\bzamanKovalari\(\s*orders\b[^;]*\btutarSec\b/;
// O22 / O30: kalem → kart eşlemesi TEK kural `stokKartiCozucu`; kategori okuması YALNIZ `kartBul(x)?.category` biçiminde
// (GB4 P495 ile aynı kural — `kartKategorisi` yazılmadı). Kopya `doluMetin` GB4'teki `doluMetin` tanımıyla BİREBİR: 6m devir kaydı.
const YEREL_KART_ESLEMESI = /\bproductCategory\b|\binventory\s*\.\s*(?:forEach|find)\(/;
const KATEGORI_OKUMASI = /\.category\b|\[\s*['"]category['"]\s*\]/;
const KATEGORI_KARTTAN = /\bkartBul\(\s*\w+\s*\)\?\.category\b/;
const DOLU_METIN_KOPYASI = /\bconst doluMetin = \(x: unknown\): string \| null => \(typeof x === 'string' && x\.trim\(\) !== '' \? x : null\);/;
const GB4 = 'components/reports/genel/GenelBloklar4.tsx';

describe('§3b · K2 / K4 / O21 / O28 / O22 / O30: süzgeçler üst düzeyde, bağlar çağıranda', () => {
  it('3b.1 · K2 + O21: üst düzey `iptalsiz` / `satislar` / `dovizliler` TAM birer kez ve süzgeç içe aktarımları (iki dosya)', () => {
    // İki `const iptalsiz` (biri panel içinde gölge) ya da hiç tanım → KIRMIZI. Bağlamadaki karşılığı: iki şartnamenin
    // «Bileşen üst düzeyi» reçetesi.
    const eksik = IKI_DOSYA.flatMap(d => {
      const kod = kodMetni(d);
      return [
        ...UST_DUZEY_KUMELER.filter(([, desen]) => eslesmeSayisi(kod, desen) !== 1)
          .map(([ad, desen]) => `${d} · const ${ad} (${eslesmeSayisi(kod, desen)} tanım, beklenen 1)`),
        ...SUZGEC_ICE_AKTARIMLARI.filter(([m, a]) => !iceAktariyor(kod, m, a)).map(([m, a]) => `${d} · import ${m}.${a}`),
      ];
    });
    expect(eksik).toEqual([]);
  });

  it('3b.2 · K2: iptal tanımı elle yazılmaz (`\'Cancelled\'` literali = 0, iki dosya)', () => {
    // Bağlamadaki karşılığı: tek tanım `siparisIptalMi` (GB5 P10 iptal oranı, GB6 P8 durum satırları).
    expect(siteler(IKI_DOSYA, IPTAL_LITERALI)).toEqual([]);
  });

  it('3b.3 · K4: GB6 müşteri kimlikle — her `musteriOzeti(` K4 haritasını taşır; ad yedeği / uydurma kova yok', () => {
    // Sayı iddiası DEĞİL: `musteriOzeti(` adedi serbest; HER çağrının haritayı (satır içi ya da `leadCariKodu` taşıyan adlı
    // sabitle) aldığı iddia edilir. Bağlamadaki karşılığı: GB6 P1 «Top Customer» `musteriOzeti` + `ciroSirali`; «Largest
    // Order» müşterisi `musteriOzeti([enBuyuk1.oge], musteriSecenek)`; ürün / kategori anahtarsız kovası `null` → '—'.
    const kod = kodMetni(GB6);
    expect(cagriArgumanlari(kod, 'musteriOzeti').length, 'GB6 · musteriOzeti( çağrısı var').toBeGreaterThan(0);
    expect(secenegiTasimayanCagrilar(kod, 'musteriOzeti', K4_HARITASI), 'GB6 · haritasız musteriOzeti(').toEqual([]);
    expect(siteler([GB6], AD_YEDEGI), 'GB6 · ad yedeği').toEqual([]);
    expect(siteler(IKI_DOSYA, UYDURMA_KOVA), 'uydurma kova').toEqual([]);
  });

  it('3b.4 · K4 (O5): ctx bağı çağrı yerinde — GB6 Props ve `GenelRapor.tsx` GB6 etiketi `leadCariKodu` taşır (BLOK bazlı, O32)', () => {
    // `GenelRapor.tsx`'te `leadCariKodu={ctx.leadCariKodu}` SAYISI iddia edilmez (O32). Etiket iddiası «prop tanımlı ama
    // geçirilmiyor» (tsc'nin göremediği isteğe bağlı alan) sınıfını kapatır. N2: stok prop'u GEREKMEZ (yokluğu 3.1 «Low Stock»).
    // Bağlamadaki karşılığı: GB6 şartnamesi Props + `GenelRapor.tsx` GB6 grubu.
    const props = PROPS_TIPI.exec(kodMetni(GB6))?.[1] ?? '';
    const etiket = GB6_ETIKETI.exec(kodMetni(GENEL_RAPOR))?.[0] ?? '';
    const eksik = [
      ...GB6_YENI_PROPLAR.filter(ad => !props.includes(`'${ad}'`)).map(ad => `${GB6} · Props '${ad}'`),
      ...GB6_YENI_PROPLAR.filter(ad => !etiket.includes(`${ad}={ctx.${ad}}`)).map(ad => `${GENEL_RAPOR} · <GenelBloklar6 ${ad}={ctx.${ad}}>`),
    ];
    expect(eksik).toEqual([]);
  });

  it('3b.5 · K2 + O21 + O28: ham `orders` CİRO yardımcısına verilmez (iki dosya — gerileme çiti)', () => {
    // Bağlamadaki karşılığı: iki şartnamenin kapsam kuralı «TL tutarı okuyan HER küme `satislar` / `dovizliler`'den»;
    // sayım `iptalsiz` / `orders` (O28). Sınır: `orders`'tan türeyen ara değişkenin verilmesi desene takılmaz — hakem okur.
    expect([...siteler(IKI_DOSYA, HAM_SIPARIS_CIRO), ...siteler(IKI_DOSYA, HAM_SIPARIS_ZAMAN_CIROSU)]).toEqual([]);
  });

  it('3b.6 · O22 + O30: GB6 P9 kategorisi stok kartından, tek eşlemeyle; `doluMetin` kopyası GB4 ile BİREBİR (devir kaydı)', () => {
    // O30: `kartKategorisi` yazılmadı; GB6 P9 GB4 P495'in kuralını satır içi kopyalar (bilinçli kopya, 6m devri). Kopya
    // kırmızıya çevrilmez, iki kopyanın AYRIŞMASI KIRMIZI. Bağlamadaki karşılığı: GB6 P9 reçetesi `doluMetin(kartBul(li)?.category)`.
    const kod = kodMetni(GB6);
    expect(iceAktariyor(kod, 'utils/pano/raporMarj', 'stokKartiCozucu'), 'GB6 · stokKartiCozucu içe aktarımı').toBe(true);
    expect(siteler([GB6], YEREL_KART_ESLEMESI), 'GB6 · yerel kart eşlemesi').toEqual([]);
    expect([eslesmeSayisi(kod, KATEGORI_KARTTAN) > 0, eslesmeSayisi(kod, KATEGORI_OKUMASI) - eslesmeSayisi(kod, KATEGORI_KARTTAN)],
      'GB6 · [karttan okuma var, karttan olmayan .category okuması]').toEqual([true, 0]);
    expect([GB4, GB6].filter(d => !DOLU_METIN_KOPYASI.test(kodMetni(d))), 'doluMetin tanımı GB4 ile BİREBİR değil').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3c · O27: «verisi olan son N dönem» yok
// ---------------------------------------------------------------------------

// O27 (orkestratör): «verisi olan son N dönem» (`Object.keys().sort().slice(-N)`) yerine son N TAKVİM dönemi; boş dönem
// gerçek 0. K28 — kullanıcı cümlesi YOK; PLAN-v2 §8 sıra 24: «7g ortalama takvim gününe geçer (kural)». Karşılaştırıcısız
// `.sort()` yalnız metin anahtarı sıralar; karşılaştırıcılı «en iyi 5» sıralaması TAKILMAZ (4c). Bağlamadaki karşılığı:
// `aylikCiro(…, N, bugun, …)`, `zamanKovalari(…)`.
const SIRALI_ANAHTAR_DILIMI = /\.sort\(\)\s*(?:\.reverse\(\)\s*)?\.slice\(/;

describe('§3c · O27: «verisi olan son N dönem» yok', () => {
  it('karşılaştırıcısız `.sort()` + `.slice(` dönem dilimi yok (iki dosya)', () => {
    expect(siteler(IKI_DOSYA, SIRALI_ANAHTAR_DILIMI)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3d · GENEL-2: 'K' kısaltması tek tanımdan ve rakam kapılı
// ---------------------------------------------------------------------------

// GENEL-2 (orkestratör; kapı gb5-7): kısaltma TEK tanımdan ve rakam kapılı. Çıktı değeri (USD, kur 41, 5.000 TL → «$122»,
// «$0K» DEĞİL) kaynakta kanıtlanamaz — GB5 V9 / GB6 örnek beklenen + hakem. Bağlamadaki karşılığı: iki şartnamenin `kisaEtiket`'i.
const KISA_K_LITERALI = /['"]K['"]/;
const KISA_ETIKET_GOVDESI = /\bconst\s+kisaEtiket\b[^{]*\{([\s\S]*?)\n\s*\};/;
const RAKAM_KAPISI = /\/\[1-9\]\/\.test\(/;

describe('§3d · GENEL-2: \'K\' kısaltması tek tanımdan ve rakam kapılı', () => {
  it("3d · GENEL-2: 'K' kısaltması tek tanımdan (kisaEtiket) ve rakam kapılı (iki dosya)", () => {
    // Tek literal + gövde + kapı üçlüsü «bir panelde `kisaEtiket` yerine `fmtAna(e, 'K', 0)` yazıldı» yarım düzeltmesini
    // kırmızıya çevirir. Desen çift tırnağı da sayar.
    const sorunlar = IKI_DOSYA.flatMap(d => {
      const k = kodMetni(d);
      const govde = KISA_ETIKET_GOVDESI.exec(k)?.[1] ?? '';
      const toplam = eslesmeSayisi(k, KISA_K_LITERALI);
      return [
        ...(toplam === 1 ? [] : [`${d} · 'K' literali ${toplam} kez (beklenen 1)`]),
        ...(eslesmeSayisi(govde, KISA_K_LITERALI) === 1 ? [] : [`${d} · tek 'K' literali kisaEtiket gövdesinde değil`]),
        ...(RAKAM_KAPISI.test(govde) ? [] : [`${d} · kisaEtiket gövdesinde rakam kapısı yok`]),
      ];
    });
    expect(sorunlar).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §4 · KÂHİN — tarayıcı gerçekten dosyaları okuyor, desenler boş değil (bağlama ÖNCESİ de yeşildi)
// ---------------------------------------------------------------------------

describe('§4a · erişilebilirlik + bayatlama sayacı', () => {
  it('dosya listesi sabit: bir dosya sessizce çıkarılırsa bütün döngüler onu görmez olur', () => {
    expect(IKI_DOSYA).toEqual([GB5, GB6]);
  });

  it('iki dosya da var, yorum süzgeci dosyayı yutmadı ve doğru bileşen okunuyor', () => {
    // Eşik 100'de KALIR (ölçüm bağlama öncesi 545 / 507 dolu satır; GB6'dan üç panel ≈ 100 satır düşse de ~400 kalır).
    for (const d of IKI_DOSYA) {
      expect(existsSync(yol(d)), d).toBe(true);
      const satirlar = yorumsuz(d, ham(d));
      expect(satirlar.filter(s => s.trim() !== '').length, `${d} · yorumsuz sonrası dolu satır`).toBeGreaterThan(100);
      // Taşınmış / boşaltılmış bir kabuk değil, bileşenin kendisi.
      expect(satirlar.some(s => /^export default function GenelBloklar[56]\(/.test(s)), `${d} · bileşen tanımı`).toBe(true);
    }
  });

  it('iki blok `GenelRapor.tsx`\'te render ediliyor (ölü yüzey ölçülmüyor)', () => {
    // Zincir: RaporlarPage → ReportsDashboard (lazy GenelRapor, `reportsTab === 'genel'`) → GenelRapor → GB5 / GB6 (koşulsuz).
    const genel = kodMetni(GENEL_RAPOR);
    expect(genel).toMatch(/<GenelBloklar5\b/);
    expect(genel).toMatch(/<GenelBloklar6\b/);
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

// 4c · desen kâhini — yerel desenler ortak modülde değil bu dosyada; fikstürleri de burada. Kaynak satırı verilen
// vakaların (`GB4 / GB5 / GB6 :N` önekli) metni `daff960`'da o satırın yorumsuz kodunun BİREBİR alt dizgisidir; diğerleri
// reçete, sınır ya da mutasyon satırıdır. Giriş kuralı: tek satırlık KOD fikstürleri desene DOĞRUDAN verilir; YORUM taşıyan
// fikstürler süzgeçten `parcaKodu` ile geçer ve HAM hâlleri ayrıca sınanır (süzgeç kaldırılırsa sonuç değişir).
interface DesenVakasi { ne: string; desen: RegExp; metin: string; eslesir: boolean }
const DESEN_VAKALARI: readonly DesenVakasi[] = [
  // ── K1 · `.total` (O31) ──
  { ne: 'GB5 :106 boşluklu', desen: TOTAL_TIPI_DENETIMI, eslesir: true, metin: "const total = typeof oRec386.total === 'number' ? oRec386.total as number" },
  { ne: 'GB6 :72 boşluksuz', desen: TOTAL_TIPI_DENETIMI, eslesir: true, metin: "const total = typeof oR.total==='number' ? oR.total as number" },
  { ne: 'GB6 :365 satır içi', desen: TOTAL_TIPI_DENETIMI, eslesir: true, metin: "return s+(typeof oR.total==='number'?oR.total as number:(o.lineItems??[]).reduce((s2,li)=>{" },
  { ne: 'O31: çift tırnak ve bitişik `===`', desen: TOTAL_TIPI_DENETIMI, eslesir: true, metin: 'const t = typeof x.total=== "number" ? 1 : 2;' },
  { ne: 'GB5 :106 · O31: PLAN-v2 deseni boşlukluyu görür', desen: PLAN_V2_SERT4_TOTAL, eslesir: true, metin: "const total = typeof oRec386.total === 'number' ? oRec386.total as number" },
  { ne: 'GB6 :72 · O31: PLAN-v2 deseni boşluksuzu KAÇIRIR (yerel desenin varlık nedeni)', desen: PLAN_V2_SERT4_TOTAL, eslesir: false, metin: "const total = typeof oR.total==='number' ? oR.total as number" },
  { ne: 'mutasyon: tür dönüşümlü typeof yerel desenden KAÇAR', desen: TOTAL_TIPI_DENETIMI, eslesir: false, metin: "const t = typeof (o as Record<string, unknown>).total === 'number' ? 1 : 2;" },
  { ne: 'mutasyon: … ama hayalet `total` deseni YAKALAR (2.3)', desen: HAYALET_ALANLAR[0][1], eslesir: true, metin: "const t = typeof (o as Record<string, unknown>).total === 'number' ? 1 : 2;" },
  { ne: 'mutasyon: köşeli parantezli `total`', desen: HAYALET_ALANLAR[0][1], eslesir: true, metin: "const t = o['total'];" },
  { ne: 'mutasyon: kalem `total` doğrudan (kalemTutari yerine)', desen: HAYALET_ALANLAR[0][1], eslesir: true, metin: 'const r = li.total ?? NaN;' },
  { ne: 'GB5 :561 JSX metni "total" alan değil', desen: HAYALET_ALANLAR[0][1], eslesir: false, metin: `<span className="text-xs font-bold text-brand">{fmtAna(maxV,'K',0)} total</span>` },
  { ne: 'GB6 :225 yerel `total` değişkeni', desen: HAYALET_ALANLAR[0][1], eslesir: false, metin: 'const total = totalFirst+totalSecond;' },
  { ne: 'GB5 :27 `totalPrice` hayalet `total` değil', desen: HAYALET_ALANLAR[0][1], eslesir: false, metin: 'const dailyAvg = last90.reduce((s, o) => s + (o.totalPrice || 0), 0) / 90;' },
  { ne: 'GB5 :27 doğrudan `totalPrice`', desen: DOGRUDAN_TUTAR_ALANI, eslesir: true, metin: 'const dailyAvg = last90.reduce((s, o) => s + (o.totalPrice || 0), 0) / 90;' },
  { ne: 'reçete: seçici doğrudan alan değil', desen: DOGRUDAN_TUTAR_ALANI, eslesir: false, metin: 'const t9 = toplaBilinen(pencere9, siparisTutari);' },
  { ne: 'reçete: seçici hayalet değil', desen: HAYALET_ALANLAR[0][1], eslesir: false, metin: 'const t9 = toplaBilinen(pencere9, siparisTutari);' },
  // ── K1 + K13 / O22 · hayalet alanlar ──
  { ne: 'GB5 :107 elle kalem toplamı', desen: ELLE_KALEM_GECISI, eslesir: true, metin: ': (o.lineItems ?? []).reduce((s, li) => {' },
  { ne: 'GB6 :324 elle kalem kovası', desen: ELLE_KALEM_GECISI, eslesir: true, metin: '(o.lineItems??[]).forEach(li=>{' },
  { ne: 'reçete: kalem kümesi `flatMap`', desen: ELLE_KALEM_GECISI, eslesir: false, metin: 'const kalemler9 = pencere9.flatMap(o => o.lineItems ?? []);' },
  { ne: 'GB5 :107 `unitPrice`', desen: HAYALET_ALANLAR[1][1], eslesir: true, metin: '((lr.unitPrice as number | undefined) ?? (lr.price as number | undefined) ?? 0)' },
  { ne: 'reçete: `kalemTutari`', desen: HAYALET_ALANLAR[1][1], eslesir: false, metin: 'const u11 = urunSatislari(satislar, { baslikYedegi: true, tutarSec: kalemTutari });' },
  { ne: 'GB6 :324 `productId`', desen: HAYALET_ALANLAR[2][1], eslesir: true, metin: "const pid=(lr.productId as string|undefined)??'';" },
  { ne: 'GB5 :470 `productName`', desen: HAYALET_ALANLAR[2][1], eslesir: true, metin: "const name = (lr.productName as string|undefined) ?? (lr.name as string|undefined) ?? 'Unknown';" },
  { ne: 'reçete: `urunSatislari`', desen: HAYALET_ALANLAR[2][1], eslesir: false, metin: 'const u11 = urunSatislari(satislar, { baslikYedegi: true, tutarSec: kalemTutari });' },
  { ne: 'GB6 :425 `.stock` (P12 «Low Stock» kutusu — N2 ile kalkar)', desen: HAYALET_ALANLAR[3][1], eslesir: true, metin: 'const stk=(i.stock as number|undefined)??0;' },
  { ne: '`stockLevel` `.stock` değil', desen: HAYALET_ALANLAR[3][1], eslesir: false, metin: 'const seviye = kart.stockLevel;' },
  { ne: 'sınır: ctx `lowStockItems` okuması `.stock` değil (kutu N2 ile kalktı)', desen: HAYALET_ALANLAR[3][1], eslesir: false, metin: "{label:'Low Stock',val:String(lowStockItems),icon:'⚠️',color:lowStockItems>0?'#ef4444':'#22c55e'}," },
  { ne: 'GB6 :425 `reorderPoint` (P12 «Low Stock» kutusu — N2 ile kalkar)', desen: HAYALET_ALANLAR[4][1], eslesir: true, metin: 'const threshold=(i.reorderPoint as number|undefined)??(i.lowStockThreshold as number|undefined)??5;' },
  { ne: 'sınır: `stokDurum` sayaçları `reorderPoint` değil (kutu N2 ile kalktı)', desen: HAYALET_ALANLAR[4][1], eslesir: false, metin: 'const not12 = { miktarsiz: stokDurum.seviyesiBilinmeyen, esiksiz: stokDurum.esigiBilinmeyen };' },
  { ne: 'GB6 :26 tür dönüşümü', desen: HAYALET_ALANLAR[5][1], eslesir: true, metin: "const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';" },
  { ne: 'tip bildirimi tür dönüşümü değil', desen: HAYALET_ALANLAR[5][1], eslesir: false, metin: 'const sayaclar: Record<string, number> = {};' },
  // ── O15 / D1 · Math.max( ──
  { ne: 'GB5 :427 BHS kıskacı (S2 görmez)', desen: MATH_MAX, eslesir: true, metin: 'const cancelScore = Math.max(0, 100 - cancelRate * 5);' },
  { ne: 'GB5 :479 Pareto alt sınırı (S2 görmez)', desen: MATH_MAX, eslesir: true, metin: 'const top20n = Math.max(1, Math.ceil(sorted.length * 0.2));' },
  { ne: 'GB5 :221 (P5 — silinir) üst kırpma `Math.min` iddia edilmez', desen: MATH_MAX, eslesir: false, metin: 'const gaugeVal = lastMRev > 0 ? Math.min(thisMRev / lastMRev, 2) : 1;' },
  // ── K14 / K-TAHMİN / O25 ──
  { ne: 'GB5 :45 P1 başlığı', desen: SILINEN_PANELLER[0][2], eslesir: true, metin: '<h3 className="font-bold text-gray-800 mb-1">30-Day Revenue Forecast</h3>' },
  { ne: 'GB5 :31 P1 büyüme katsayısı', desen: SILINEN_PANELLER[0][2], eslesir: true, metin: 'const buyumeKatsayisi = 0.5;' },
  { ne: "mutasyon: P1 kaldırılmadı, satisTahmini'ne bağlandı", desen: SILINEN_PANELLER[0][2], eslesir: true, metin: 'const t1 = satisTahmini(satislar, new Date(), { ufuk: 1, tutarSec: siparisTutari });' },
  { ne: 'GB5 :168 P4 KALIR (ay-ay değişim)', desen: SILINEN_PANELLER[0][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aylık Ciro Artışı' : 'Month-over-Month Revenue Growth'}</h3>` },
  { ne: 'GB5 :232 P5 başlığı (iki dil)', desen: SILINEN_PANELLER[1][2], eslesir: true, metin: `<h3 className="font-semibold text-sm mb-1">{currentLanguage === 'tr' ? 'Bu Ay ve Geçen Ay' : 'This Month vs Last Month'}</h3>` },
  { ne: "mutasyon: P5 kaldırılmadı, mtdKarsilastir'e bağlandı", desen: SILINEN_PANELLER[1][2], eslesir: true, metin: 'const m5 = mtdKarsilastir(satislar, new Date(), { iptalHaric: true });' },
  { ne: 'GB5 :391 P9 KALIR (90 gün)', desen: SILINEN_PANELLER[1][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Son 90 Gün ve Önceki 90 Gün' : 'Last 90d vs Prior 90d'}</h3>` },
  { ne: 'GB6 :120 P3 başlığı (iki dil)', desen: SILINEN_PANELLER[2][2], eslesir: true, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Yıllık Ciro Karşılaştırması' : 'Year-over-Year Revenue'}</h3>` },
  { ne: "mutasyon: P3 kaldırılmadı, yilAylikCiro'ya bağlandı", desen: SILINEN_PANELLER[2][2], eslesir: true, metin: 'const bu3 = yilAylikCiro(satislar, buYil, { iptalHaric: true }, dil);' },
  { ne: 'GB6 :82 P2 başlığı P3 desenine takılmaz (P2 kendi satırında — dizin 16)', desen: SILINEN_PANELLER[2][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ciro Artış Oranları' : 'Revenue Growth Rates'}</h3>` },
  { ne: 'GB6 :159 P4 başlığı (iki dil)', desen: SILINEN_PANELLER[3][2], eslesir: true, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Mevsimsellik Endeksi' : 'Seasonality Index'}</h3>` },
  { ne: "mutasyon: P4 kaldırılmadı, mevsimsellikEndeksi'ne bağlandı", desen: SILINEN_PANELLER[3][2], eslesir: true, metin: 'const m4 = mevsimsellikEndeksi(z4.kovalar);' },
  { ne: 'GB6 :176 P5 KALIR', desen: SILINEN_PANELLER[3][2], eslesir: false, metin: "const brackets = [{label:'<₺1k',min:0,max:1000},{label:'₺1-5k',min:1000,max:5000}," },
  { ne: 'GB6 :493 P14 başlığı', desen: SILINEN_PANELLER[4][2], eslesir: true, metin: '<h3 className="font-semibold text-sm mb-3">3-Month Revenue Forecast</h3>' },
  { ne: 'GB6 :485 P14 ortalama büyüme', desen: SILINEN_PANELLER[4][2], eslesir: true, metin: 'const avgGrowth=growthRates.reduce((a,b)=>a+b,0)/growthRates.length;' },
  { ne: 'GB6 :82 "Growth Rates" `growthRates` değil (P2 kendi satırında — dizin 16)', desen: SILINEN_PANELLER[4][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ciro Artış Oranları' : 'Revenue Growth Rates'}</h3>` },
  { ne: 'GB6 :38 «Best Day» kutusu', desen: SILINEN_PANELLER[5][2], eslesir: true, metin: "{label:'Best Day', val:`₺${bestDay?((bestDay[1]/1000).toFixed(1))+'k':'—'}`, sub: bestDay?.[0]??'—', icon:'📅'}," },
  { ne: 'GB6 :40 «Total Orders» kutusu «Best Day» desenine takılmaz (kendi `it`\'i — N2)', desen: SILINEN_PANELLER[5][2], eslesir: false, metin: "{label:'Total Orders', val:String(orders.length), sub:'all time', icon:'📦'}," },
  { ne: 'GB6 :306 P8 «Total Orders» kırılım satırı (JSX metni, kutu değil) KALIR', desen: SILINEN_PANELLER[5][2], eslesir: false, metin: '<div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{total}</span></div>' },
  { ne: 'reçete: «Largest Order» kutusu KALIR', desen: SILINEN_PANELLER[5][2], eslesir: false, metin: "{ label: 'Largest Order', val: enBuyuk1.deger === null ? '—' : kisaEtiket(enBuyuk1.deger, 1), sub: buyukMusteri1 === undefined ? '—' : (buyukMusteri1.ad ?? buyukMusteri1.kimlik), icon: '💎' }," },
  { ne: 'GB6 :63 bugünkü üç pencere', desen: SILINEN_PANELLER[6][2], eslesir: true, metin: 'const periods = [7,30,90];' },
  { ne: 'mutasyon: adlandırılmış sabitte 90 kaldı', desen: SILINEN_PANELLER[6][2], eslesir: true, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7, 30, 90];' },
  { ne: 'sınır: 90 deseni 30 günlük pencereye takılmaz', desen: SILINEN_PANELLER[6][2], eslesir: false, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7, 30];' },
  { ne: 'GB6 :358 P10 dört pencere KALIR', desen: SILINEN_PANELLER[6][2], eslesir: false, metin: "const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];" },
  { ne: 'reçete: P10 hız pencereleri serbest', desen: SILINEN_PANELLER[6][2], eslesir: false, metin: 'const HIZ_PENCERELERI: readonly number[] = [7, 30, 90, 365];' },
  { ne: 'sınır (N1 ara hâli; panel 2026-10-18 bütünüyle kalktı): yalnız 7 günlük kutu', desen: SILINEN_PANELLER[6][2], eslesir: false, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7];' },
  // ── N3 · GB5 P11 ilk 5 listesi ──
  { ne: 'GB5 :482 P11 ilk 5 dilimi', desen: SILINEN_PANELLER[13][2], eslesir: true, metin: 'const top5 = sorted.slice(0, 5);' },
  { ne: 'GB5 :498 P11 liste satırı payı', desen: SILINEN_PANELLER[13][2], eslesir: true, metin: '{totalRev > 0 ? Math.round((rev/totalRev)*100) : 0}%' },
  { ne: 'mutasyon: liste v2 reçetesiyle geri geldi', desen: SILINEN_PANELLER[13][2], eslesir: true, metin: 'const ilk11 = p11.satirlar.slice(0, PARETO_LISTE_N);' },
  { ne: 'GB5 :480 P11 rozeti (ilk %20) KALIR', desen: SILINEN_PANELLER[13][2], eslesir: false, metin: 'const top20Rev = sorted.slice(0, top20n).reduce((s,[,v])=>s+v,0);' },
  { ne: 'reçete: rozet satırı KALIR', desen: SILINEN_PANELLER[13][2], eslesir: false, metin: 'const rozet11 = p11.satirlar[Math.ceil(n11 * PARETO_ORANI) - 1].kumulatif;' },
  { ne: 'GB5 :516 P12 en iyi 5 ay KALIR (P11 listesi değil)', desen: SILINEN_PANELLER[13][2], eslesir: false, metin: 'const top5 = Object.entries(byMonth).sort((a,b)=>b[1]-a[1]).slice(0,5);' },
  { ne: 'GB5 :518 P12 ölçeği (soru işaretsiz) P11 değil', desen: SILINEN_PANELLER[13][2], eslesir: false, metin: 'const maxRev = top5[0][1];' },
  // ── N1 / N2 / N4 kutuları ──
  { ne: 'GB6 :40 «Total Orders» kutusu (N2)', desen: SILINEN_PANELLER[7][2], eslesir: true, metin: "{label:'Total Orders', val:String(orders.length), sub:'all time', icon:'📦'}," },
  { ne: 'mutasyon: «Total Orders» kutusu O28 biçimiyle geri geldi', desen: SILINEN_PANELLER[7][2], eslesir: true, metin: "{ label: 'Total Orders', val: String(iptalsiz.length), sub: 'all time', icon: '📦' }," },
  { ne: 'GB6 :306 P8 «Total Orders» satırı (JSX metni, kutu değil) KALIR', desen: SILINEN_PANELLER[7][2], eslesir: false, metin: '<div className="flex justify-between"><span className="text-gray-500">Total Orders</span><span className="font-bold">{total}</span></div>' },
  { ne: 'reçete: «Top Customer» kutusu KALIR', desen: SILINEN_PANELLER[7][2], eslesir: false, metin: "{ label: 'Top Customer', val: enIyiMusteri1 === null ? '—' : kisaEtiket(ekranTutari(enIyiMusteri1.ciro), 1), sub: enIyiMusteri1 === null ? '—' : (enIyiMusteri1.ad ?? enIyiMusteri1.kimlik), icon: '👑' }," },
  { ne: 'GB6 :63 bugünkü üç pencere (30 dâhil)', desen: SILINEN_PANELLER[8][2], eslesir: true, metin: 'const periods = [7,30,90];' },
  { ne: 'mutasyon: adlandırılmış sabitte 30 kaldı', desen: SILINEN_PANELLER[8][2], eslesir: true, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7, 30];' },
  { ne: 'sınır (N1 ara hâli; panel 2026-10-18 bütünüyle kalktı): yalnız 7 günlük kutu — 30 deseni', desen: SILINEN_PANELLER[8][2], eslesir: false, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7];' },
  { ne: 'reçete: P10 hız pencereleri (30 dâhil) serbest', desen: SILINEN_PANELLER[8][2], eslesir: false, metin: 'const HIZ_PENCERELERI: readonly number[] = [7, 30, 90, 365];' },
  { ne: 'sınır: başka sabitte 30 (eski P7 penceresi) 30 kutusu deseni değil', desen: SILINEN_PANELLER[8][2], eslesir: false, metin: 'const KAYAN_PENCERE_GUN = 30, KAYAN_ORTALAMA_GUN = 7, KAYAN_ASGARI_GUN = 7;' },
  { ne: 'GB6 :358 P10 dört pencere KALIR — 30 deseni', desen: SILINEN_PANELLER[8][2], eslesir: false, metin: "const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];" },
  { ne: 'GB6 :288 karşılama oranı', desen: SILINEN_PANELLER[9][2], eslesir: true, metin: 'const fulfillRate = (total-cancelled)>0 ? Math.round((delivered/(total-cancelled))*100) : 0;' },
  { ne: 'GB6 :302 halkanın alt yazısı', desen: SILINEN_PANELLER[9][2], eslesir: true, metin: '<span className="text-[8px] text-gray-400">fulfilled</span>' },
  { ne: "mutasyon: halka kaldırılmadı, teslimatOrani'ne bağlandı (v2 reçetesi)", desen: SILINEN_PANELLER[9][2], eslesir: true, metin: 'const karsilama8 = teslimatOrani(iptalsiz);' },
  { ne: 'GB6 :292 P8 başlığı KALIR (panel durum satırlarıyla yaşar)', desen: SILINEN_PANELLER[9][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Sipariş Karşılama Oranı' : 'Order Fulfillment Rate'}</h3>` },
  { ne: 'reçete: iptal oranı satırı KALIR', desen: SILINEN_PANELLER[9][2], eslesir: false, metin: 'const iptalOrani8 = yuzdeOrani(iptal8, durumlar.toplam);' },
  { ne: 'sınır: içe aktarım satırı çağrı değil', desen: SILINEN_PANELLER[9][2], eslesir: false, metin: "import { teslimatOrani, yuzdeOrani } from '../../../utils/pano/finansKpi';" },
  { ne: 'GB6 :428 «Orders (30d)» kutusu', desen: SILINEN_PANELLER[10][2], eslesir: true, metin: "{label:'Orders (30d)',val:String(orders30),icon:'📦',color:'#3b82f6'}," },
  { ne: 'GB6 :424 30 günlük sayım', desen: SILINEN_PANELLER[10][2], eslesir: true, metin: 'const orders30=orders.filter(o=>{ const d=zamanDate(o.createdAt); return d&&d>=d30; }).length;' },
  { ne: 'mutasyon: «Orders (30d)» v2 reçetesiyle geri geldi', desen: SILINEN_PANELLER[10][2], eslesir: true, metin: 'const esik12 = new Date(simdi12.getTime() - SIPARIS_PENCERE_GUN * GUN_MS);' },
  { ne: 'GB6 :429 «Active Orders» kutusu KALIR', desen: SILINEN_PANELLER[10][2], eslesir: false, metin: "{label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'}," },
  { ne: 'GB6 :518 P15 sayaçları (K24 — dokunulmaz) «Orders (30d)» değil', desen: SILINEN_PANELLER[10][2], eslesir: false, metin: "{[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(" },
  { ne: 'GB6 :431 «Low Stock» kutusu', desen: SILINEN_PANELLER[11][2], eslesir: true, metin: "{label:'Low Stock',val:String(lowStockCount),icon:'⚠️',color:lowStockCount>0?'#ef4444':'#22c55e'}," },
  { ne: 'mutasyon: «Low Stock» ctx bağıyla geri geldi (v2 reçetesi)', desen: SILINEN_PANELLER[11][2], eslesir: true, metin: "const stokRengi12 = lowStockItems > 0 ? '#ef4444' : stokBilinmiyor12 ? '#9ca3af' : '#22c55e';" },
  { ne: 'mutasyon: stok notu geri geldi (v2 reçetesi)', desen: SILINEN_PANELLER[11][2], eslesir: true, metin: 'const not12 = { miktarsiz: stokDurum.seviyesiBilinmeyen, esiksiz: stokDurum.esigiBilinmeyen };' },
  { ne: 'GB6 :429 «Active Orders» kutusu KALIR — stok deseni', desen: SILINEN_PANELLER[11][2], eslesir: false, metin: "{label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'}," },
  { ne: 'sınır: tek tanım `stokDurumu(` adı `stokDurum` değil', desen: SILINEN_PANELLER[11][2], eslesir: false, metin: 'const sd = stokDurumu(inventory);' },
  { ne: 'GB6 :430 «SKUs» kutusu', desen: SILINEN_PANELLER[12][2], eslesir: true, metin: "{label:'SKUs',val:String(inventory.length),icon:'🗃️',color:'#22c55e'}," },
  { ne: 'GB6 :432 «Employees» kutusu', desen: SILINEN_PANELLER[12][2], eslesir: true, metin: "{label:'Employees',val:String(employees.length),icon:'👥',color:'#8b5cf6'}," },
  { ne: 'GB6 :433 «Quotes» kutusu', desen: SILINEN_PANELLER[12][2], eslesir: true, metin: "{label:'Quotes',val:String(quotations.length),icon:'📋',color:'#0ea5e9'}," },
  { ne: 'mutasyon: renksiz SKU kutusu (sayaç ifadesi aynı)', desen: SILINEN_PANELLER[12][2], eslesir: true, metin: "{ label: 'SKUs', val: String(inventory.length), icon: '🗃️' }," },
  { ne: 'GB6 :518 P15 sayaçları (K24 — dokunulmaz; renksiz, adlı sayaç) takılmaz', desen: SILINEN_PANELLER[12][2], eslesir: false, metin: "{[{label:'Orders',val:totalOrders,icon:'📦'},{label:'SKUs',val:totalInventory,icon:'🗃️'},{label:'Employees',val:totalEmployees,icon:'👥'},{label:'Quotations',val:totalQuotations,icon:'📋'}].map(m=>(" },
  { ne: 'GB6 :505 P15 SKU sayacı takılmaz', desen: SILINEN_PANELLER[12][2], eslesir: false, metin: 'const totalInventory=inventory.length;' },
  { ne: 'GB6 :429 «Active Orders» kutusu KALIR — sayaç deseni', desen: SILINEN_PANELLER[12][2], eslesir: false, metin: "{label:'Active Orders',val:String(activeOrders),icon:'⚙️',color:'#f59e0b'}," },
  // ── Kullanıcı K14 aday kararı (2026-10-18) — dizin 14–19. `GB5 / GB6 :N` önekli metin `daff960`'ın o satırının alt dizgisi;
  //    «6d» önekli metin 6d bağlamasının (`95dced3`) satırı — panel o biçimle geri gelirse de KIRMIZI. ──
  { ne: 'GB5 :79 P2 başlığı (iki dil)', desen: SILINEN_PANELLER[14][2], eslesir: true, metin: `<h3 className="font-bold text-gray-800 mb-1">{currentLanguage === 'tr' ? 'Bu Yılın En Yüksek Ciro Günleri' : 'Top Revenue Days This Year'}</h3>` },
  { ne: 'GB5 :65 P2 gün kovası', desen: SILINEN_PANELLER[14][2], eslesir: true, metin: 'const dayRev: Record<string, number> = {};' },
  { ne: '6d: P2 bağlanmış hâliyle geri geldi', desen: SILINEN_PANELLER[14][2], eslesir: true, metin: 'const gunler2 = [...g2.kovalar].map(([gun, liste]) => ({ gun, tutar: toplaBilinen(liste, SEC) }))' },
  { ne: 'reçete: P12 en iyi aylar KALIR (aynı kalıp, başka ad)', desen: SILINEN_PANELLER[14][2], eslesir: false, metin: 'const aylar12 = [...a12.kovalar].map(([ay, liste]) => ({ ay, tutar: toplaBilinen(liste, SEC) }))' },
  { ne: 'reçete: P8 haftalık eğilim başlığı KALIR', desen: SILINEN_PANELLER[14][2], eslesir: false, metin: `<h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Haftalık Sipariş Eğilimi' : 'Weekly Orders Trend'}</h3>` },
  { ne: 'GB5 :317 P7 başlığı', desen: SILINEN_PANELLER[15][2], eslesir: true, metin: '<h3 className="font-semibold text-sm">YTD Revenue by Quarter ({year})</h3>' },
  { ne: 'GB5 :310 P7 yıl içi toplam', desen: SILINEN_PANELLER[15][2], eslesir: true, metin: 'const ytdTotal = Object.values(quarters).reduce((a,b) => a+b, 0);' },
  { ne: 'mutasyon: P7 kaldırılmadı, ikizin yardımcısına bağlandı (6d biçimi)', desen: SILINEN_PANELLER[15][2], eslesir: true, metin: 'const c7 = ceyreklikCiro(satislar, CEYREK_N, yilSonu7, { iptalHaric: true });' },
  { ne: 'reçete: P4 aylık ciro KALIR', desen: SILINEN_PANELLER[15][2], eslesir: false, metin: 'const a4 = aylikCiro(satislar, MOM_AY, simdi4, { iptalHaric: true }, dil);' },
  { ne: 'sınır: içe aktarım satırı çağrı değil', desen: SILINEN_PANELLER[15][2], eslesir: false, metin: "import { aylikCiro, ceyreklikCiro, kumulatifSeyir, ciroTarihi } from '../../../utils/pano/ciroDonem';" },
  { ne: 'GB6 :82 P2 başlığı (iki dil)', desen: SILINEN_PANELLER[16][2], eslesir: true, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Ciro Artış Oranları' : 'Revenue Growth Rates'}</h3>` },
  { ne: 'GB6 :63 P2 üç pencere', desen: SILINEN_PANELLER[16][2], eslesir: true, metin: 'const periods = [7,30,90];' },
  { ne: '6d: «7d» kutusu N1 biçimiyle geri geldi', desen: SILINEN_PANELLER[16][2], eslesir: true, metin: 'const ARTIS_PENCERELERI: readonly number[] = [7];' },
  { ne: 'mutasyon: haftalık değişim ikizin yardımcısıyla geri geldi', desen: SILINEN_PANELLER[16][2], eslesir: true, metin: 'const k2 = donemKarsilastir(z.kovalar[1].ciro, z.kovalar[0].ciro);' },
  { ne: 'GB6 :358 P10 dört pencere KALIR — P2 deseni', desen: SILINEN_PANELLER[16][2], eslesir: false, metin: "const periods = [{label:'7d',days:7},{label:'30d',days:30},{label:'90d',days:90},{label:'365d',days:365}];" },
  { ne: 'reçete: P10 hız pencereleri KALIR — P2 deseni', desen: SILINEN_PANELLER[16][2], eslesir: false, metin: 'const HIZ_PENCERELERI: readonly number[] = [7, 30, 90, 365];' },
  { ne: 'GB6 :268 P7 başlığı', desen: SILINEN_PANELLER[17][2], eslesir: true, metin: '<h3 className="font-semibold text-sm">7-Day Rolling Revenue Avg</h3>' },
  { ne: 'GB6 :260 P7 gün dilimi', desen: SILINEN_PANELLER[17][2], eslesir: true, metin: 'const rollingDays = days.slice(W-1);' },
  { ne: 'mutasyon: P7 kaldırılmadı, ikizin yardımcısına bağlandı (6d biçimi)', desen: SILINEN_PANELLER[17][2], eslesir: true, metin: 'const kayan7 = hareketliOrtalama(g7.kovalar.map(k => k.ciro), KAYAN_ORTALAMA_GUN).slice(KAYAN_ORTALAMA_GUN - 1);' },
  { ne: 'GB4 :306 ikizin başlığı P7 desenine takılmaz', desen: SILINEN_PANELLER[17][2], eslesir: false, metin: '<h3 className="font-bold text-gray-800 mb-1">Rolling 7-Day Avg Revenue — Last 28 Days</h3>' },
  { ne: 'reçete: P10 hız KALIR', desen: SILINEN_PANELLER[17][2], eslesir: false, metin: 'return { etiket: `${gun}d`, z, h: satisHizi(z.kovalar[0].ciro, gun) };' },
  { ne: 'GB6 :404 P11 başlığı (iki dil)', desen: SILINEN_PANELLER[18][2], eslesir: true, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Bu Ayın En İyi Ürünleri' : 'Top Products This Month'}</h3>` },
  { ne: 'GB6 :392 P11 ay başı', desen: SILINEN_PANELLER[18][2], eslesir: true, metin: 'const monthStart=new Date(now.getFullYear(),now.getMonth(),1);' },
  { ne: 'mutasyon: P11 kaldırılmadı, ikizin yardımcısına bağlandı (6d biçimi)', desen: SILINEN_PANELLER[18][2], eslesir: true, metin: 'const urunler11 = urunSatislari(buAy11, { baslikYedegi: true, tutarSec: kalemTutari });' },
  { ne: 'reçete: P9 kategori cirosu KALIR', desen: SILINEN_PANELLER[18][2], eslesir: false, metin: 'const birlesik9 = segmentCirosu(kalemler9, kategori9, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });' },
  { ne: 'reçete: P9 başlığı KALIR', desen: SILINEN_PANELLER[18][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'En İyi Kategori Ciro Eğilimi' : 'Top Category Revenue Trend'}</h3>` },
  { ne: 'GB6 :464 P13 başlığı (iki dil)', desen: SILINEN_PANELLER[19][2], eslesir: true, metin: `<h3 className="font-semibold text-sm">{currentLanguage === 'tr' ? 'Aylık Sipariş Hacmi' : 'Monthly Order Volume'}</h3>` },
  { ne: 'GB6 :468 P13 dolgu', desen: SILINEN_PANELLER[19][2], eslesir: true, metin: '<defs><linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">' },
  { ne: '6d: P13 bağlanmış hâliyle geri geldi', desen: SILINEN_PANELLER[19][2], eslesir: true, metin: 'const z13 = zamanKovalari(iptalsiz, HACIM_AY, indeks13, { tarihSec: o => o.createdAt });' },
  { ne: 'mutasyon: P13 ikizin yardımcısıyla geri geldi', desen: SILINEN_PANELLER[19][2], eslesir: true, metin: 'const a13 = aylikCiro(satislar, 12, simdi13, { iptalHaric: true }, dil);' },
  { ne: 'reçete: P9 TAKVİM ayı sabiti KALIR', desen: SILINEN_PANELLER[19][2], eslesir: false, metin: 'const KATEGORI_AY = 5, KATEGORI_N = 3, KATEGORI_ASGARI = 2, KATEGORI_AY_ASGARI = 2;' },
  { ne: 'GB5 P4 «Aylık Ciro Artışı» başlığı P13 değil', desen: SILINEN_PANELLER[19][2], eslesir: false, metin: `<h3 className="font-semibold text-sm mb-3">{currentLanguage === 'tr' ? 'Aylık Ciro Artışı' : 'Month-over-Month Revenue Growth'}</h3>` },
  { ne: 'GB5 :31 büyüme kalıntısı', desen: BUYUME_KALINTISI, eslesir: true, metin: 'const buyumeKatsayisi = 0.5;' },
  { ne: 'GB6 :488 bileşik büyüme', desen: BUYUME_KALINTISI, eslesir: true, metin: 'rev:lastRev*Math.pow(1+avgGrowth,i) }; });' },
  { ne: '`Math.pow(x, 2)` kalıntı değil', desen: BUYUME_KALINTISI, eslesir: false, metin: 'const kare = Math.pow(sapma, 2);' },
  { ne: "GB1 :396 tek model çağrısı (GB5/GB6'da olmamalı)", desen: TAHMIN_CAGRISI, eslesir: true, metin: 'const t190 = satisTahmini(orders, new Date(), { ufuk: TAHMIN_UFUK_AY, tutarSec: siparisTutari });' },
  { ne: 'içe aktarım satırı çağrı değil', desen: TAHMIN_CAGRISI, eslesir: false, metin: "import { satisTahmini, tahminTutari } from '../../../utils/muhasebe/faturaTakipTahmin';" },
  { ne: 'mutasyon: ikinci tahmin yardımcısı yazıldı', desen: BUYUME_TAHMINI_ADI, eslesir: true, metin: 'export function buyumeTahmini(taban: number | null) {' },
  { ne: 'başka ad (`buyumeTahminiNotu`) değil', desen: BUYUME_TAHMINI_ADI, eslesir: false, metin: 'const buyumeTahminiNotu = "";' },
  { ne: 'K14 karar satırı', desen: KARAR_K14, eslesir: true, metin: '// K14 kullanıcı: "kaldır" — bu panel kalktı' },
  { ne: 'K140 K14 değil', desen: KARAR_K14, eslesir: false, metin: '// K140 diye bir karar yok' },
  { ne: 'eski ADAY notu biçimi (2026-10-18 kararıyla kalktı — 3.6 TAM 0 sayar)', desen: KARAR_K14_ADAYI, eslesir: true, metin: '{/* K14 ADAYI — kullanıcıya soruldu; karar «kaldır» çıkarsa SİLİNİR (O25). */}' },
  { ne: 'K14 kaldırma yorumu ADAY notu değil', desen: KARAR_K14_ADAYI, eslesir: false, metin: '{/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." */}' },
  { ne: 'reçete: K14 kaldırma yorumu açılışı (satır yorumu — GB6 P1 «Best Day» kutusu)', desen: KARAR_K14_KALDIRMA, eslesir: true, metin: '// K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Her çiftten TEK panel kalır.' },
  { ne: 'reçete: K14 kaldırma yorumu açılışı (JSX yorumu — GB5 P1)', desen: KARAR_K14_KALDIRMA, eslesir: true, metin: '{/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." */}' },
  { ne: 'başlık notundaki K14 anması kaldırma yorumu sayılmaz', desen: KARAR_K14_KALDIRMA, eslesir: false, metin: ' * K14 — kullanıcı 2026-09-19: "kaldır" — üç çift panel + on kutu kalktı (orkestratör O25, N1 / N2 / N4)' },
  { ne: 'K14 ADAYI notu kaldırma yorumu sayılmaz', desen: KARAR_K14_KALDIRMA, eslesir: false, metin: '{/* K14 ADAYI — kullanıcıya soruldu; karar «kaldır» çıkarsa SİLİNİR (O25). */}' },
  { ne: 'reçete: K14 aday kaldırma yorumu açılışı (JSX — GB5 P7)', desen: KARAR_K14_ADAY_KALDIRMA, eslesir: true, metin: '{/* K14 — kullanıcı 2026-10-18: «ok» (kaldır) — GenelBloklar1.tsx P156 «Çeyrek Bazlı Karşılaştırma» kalır; bu dosyadaki «YTD Revenue by Quarter» paneli KALDIRILDI.' },
  { ne: 'eski ADAY notu aday kaldırma yorumu sayılmaz', desen: KARAR_K14_ADAY_KALDIRMA, eslesir: false, metin: '// K14 ADAYI (O25) — GenelBloklar1.tsx P156 «Çeyrek Bazlı Karşılaştırma»: aynı ölçü ve kırılım, yalnız pencere farklı. Kullanıcıya soruldu; karar «kaldır» çıkarsa bu panel SİLİNİR, GB1 P156 kalır.' },
  { ne: 'başlık notu («K14 adayları … «ok»») aday kaldırma yorumu sayılmaz', desen: KARAR_K14_ADAY_KALDIRMA, eslesir: false, metin: ' *       K14 adayları (yalnız pencere uzunluğu farkı — O25) kullanıcıya soruldu; kullanıcı 2026-10-18 «ok» = tablonun altı satırı' },
  { ne: '«kalsın» biçimi aday kaldırma yorumu değil', desen: KARAR_K14_ADAY_KALDIRMA, eslesir: false, metin: '// K14 — kullanıcı 2026-10-18: kalsın (GB1 P156 ile pencere farkı)' },
  { ne: 'K14 (kullanıcı, …) kaldırma yorumu aday kararı sayılmaz', desen: KARAR_K14_ADAY_KALDIRMA, eslesir: false, metin: '{/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." */}' },
  { ne: 'reçete: kapı', desen: PANEL_KAPISI, eslesir: true, metin: "{reportsTab === 'genel' && orders.length >= 5 && (() => {" },
  { ne: 'kapı değil', desen: PANEL_KAPISI, eslesir: false, metin: "{reportsTab === 'crm' && (() => {" },
  { ne: 'başlık', desen: BASLIK, eslesir: true, metin: '<h3 className="font-semibold text-sm">x</h3>' },
  { ne: '`<h4` başlık değil', desen: BASLIK, eslesir: false, metin: '<h4 className="text-xs">x</h4>' },
  // ── K2 / O21 ──
  { ne: 'reçete: iptalsiz (useMemo)', desen: UST_DUZEY_KUMELER[0][1], eslesir: true, metin: 'const iptalsiz = useMemo(() => orders.filter(o => !siparisIptalMi(o)), [orders]);' },
  { ne: 'reçete: iptalsiz (düz)', desen: UST_DUZEY_KUMELER[0][1], eslesir: true, metin: 'const iptalsiz = orders.filter(o => !siparisIptalMi(o));' },
  { ne: 'mutasyon: iptalsiz süzgeci boşaltıldı', desen: UST_DUZEY_KUMELER[0][1], eslesir: false, metin: 'const iptalsiz = useMemo(() => orders.filter(o => o !== null), [orders]);' },
  { ne: 'reçete: satislar', desen: UST_DUZEY_KUMELER[1][1], eslesir: true, metin: 'const satislar = useMemo(() => iptalsiz.filter(o => !tryDisiMi(o)), [iptalsiz]);' },
  { ne: 'mutasyon: satislar süzgeçsiz', desen: UST_DUZEY_KUMELER[1][1], eslesir: false, metin: 'const satislar = iptalsiz;' },
  { ne: 'reçete: dovizliler (değer)', desen: UST_DUZEY_KUMELER[2][1], eslesir: true, metin: 'const dovizliler = iptalsiz.filter(tryDisiMi);' },
  { ne: 'reçete: dovizliler (ok işlevi)', desen: UST_DUZEY_KUMELER[2][1], eslesir: true, metin: 'const dovizliler = useMemo(() => iptalsiz.filter(o => tryDisiMi(o)), [iptalsiz]);' },
  { ne: 'mutasyon: dovizliler iptalleri sayar', desen: UST_DUZEY_KUMELER[2][1], eslesir: false, metin: 'const dovizliler = orders.filter(tryDisiMi);' },
  { ne: 'mutasyon: dovizliler ters süzgeç', desen: UST_DUZEY_KUMELER[2][1], eslesir: false, metin: 'const dovizliler = iptalsiz.filter(o => !tryDisiMi(o));' },
  { ne: 'GB5 :24 elle iptal süzgeci', desen: IPTAL_LITERALI, eslesir: true, metin: "const gecerli371 = orders.filter(o => o.status !== 'Cancelled');" },
  { ne: 'GB6 :286 elle iptal sayımı', desen: IPTAL_LITERALI, eslesir: true, metin: "const cancelled = orders.filter(o=>o.status==='Cancelled').length;" },
  { ne: 'reçete: siparisIptalMi', desen: IPTAL_LITERALI, eslesir: false, metin: 'const iptal10 = pencere10.filter(siparisIptalMi).length;' },
  // ── K4 ──
  { ne: 'GB6 :26 ad / kimlik yedeği', desen: AD_YEDEGI, eslesir: true, metin: "const cid = (o as unknown as Record<string,unknown>).customerName as string|undefined || (o as unknown as Record<string,unknown>).customerId as string|undefined || 'Unknown';" },
  { ne: 'sınır (reçete DEĞİL): ham ad okuması `?? null` zinciri değil, AD_YEDEGI takılmaz — GB6 P1 reçetesi müşteriyi musteriOzeti([enBuyuk1.oge], musteriSecenek) ile alır', desen: AD_YEDEGI, eslesir: false, metin: 'const ad1 = buyuk1?.oge.customerName ?? null;' },
  { ne: 'GB6 :26 uydurma kova', desen: UYDURMA_KOVA, eslesir: true, metin: "|| 'Unknown';" },
  { ne: 'GB6 :319 uydurma kategori', desen: UYDURMA_KOVA, eslesir: true, metin: "productCategory[item.name]=(item.category??'Other');" },
  { ne: 'reçete: anahtarsız kova null', desen: UYDURMA_KOVA, eslesir: false, metin: 'const kategori9 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);' },
  { ne: 'reçete: K4 haritası', desen: K4_HARITASI, eslesir: true, metin: 'const musteriSecenek = { tutarSec: SEC, tarihSec: (o: Order) => zamanMs(o.createdAt), leadCariKodu };' },
  { ne: 'haritasız seçenek', desen: K4_HARITASI, eslesir: false, metin: 'const musteriSecenek = { tutarSec: SEC, tarihSec: (o: Order) => zamanMs(o.createdAt) };' },
  { ne: 'GB6 :15 Props bugünkü hâli', desen: PROPS_TIPI, eslesir: true, metin: "type Props = Pick<ReportsCtx, 'reportsTab' | 'orders' | 'inventory' | 'employees' | 'quotations' | 'currentLanguage' | 'fmtAna'>;" },
  { ne: 'başka Pick Props değil', desen: PROPS_TIPI, eslesir: false, metin: "type Satir = Pick<Order, 'id' | 'status'>;" },
  { ne: 'GB6 etiketi (çok satırlı)', desen: GB6_ETIKETI, eslesir: true, metin: '<GenelBloklar6\n  reportsTab={ctx.reportsTab}\n  fmtAna={ctx.fmtAna}\n/>' },
  { ne: 'GB5 etiketi GB6 değil', desen: GB6_ETIKETI, eslesir: false, metin: '<GenelBloklar5\n  reportsTab={ctx.reportsTab}\n/>' },
  // ── O28 ──
  { ne: "mutasyon: ham orders aylikCiro'ya", desen: HAM_SIPARIS_CIRO, eslesir: true, metin: 'const a4 = aylikCiro(orders, 7, bugun, { iptalHaric: true });' },
  { ne: "mutasyon: ham orders.filter kovayaYerlestir'e", desen: HAM_SIPARIS_CIRO, eslesir: true, metin: 'const k5 = kovayaYerlestir(orders.filter(o => !siparisIptalMi(o)), siparisTutari, BANTLAR);' },
  { ne: "reçete: satislar aylikCiro'ya", desen: HAM_SIPARIS_CIRO, eslesir: false, metin: 'const a4 = aylikCiro(satislar, 7, bugun, { iptalHaric: true });' },
  { ne: 'O28: sayım paneli durumDagilimi(orders) serbest', desen: HAM_SIPARIS_CIRO, eslesir: false, metin: 'const d8 = durumDagilimi(orders, PANO_DURUMLARI);' },
  { ne: 'O28: sayım paneli zamanKovalari(orders) tutarsız serbest', desen: HAM_SIPARIS_ZAMAN_CIROSU, eslesir: false, metin: 'const h8 = zamanKovalari(orders, 8, haftaIndeksi, { tarihSec: o => o.createdAt });' },
  { ne: 'mutasyon: zamanKovalari(orders) tutarlı', desen: HAM_SIPARIS_ZAMAN_CIROSU, eslesir: true, metin: 'const h2 = zamanKovalari(orders, 366, gunIndeksi, { tarihSec: o => o.createdAt, tutarSec: siparisTutari });' },
  // ── O22 / O30 ──
  { ne: 'GB6 :318 yerel kategori haritası', desen: YEREL_KART_ESLEMESI, eslesir: true, metin: 'const productCategory: Record<string,string> = {};' },
  { ne: 'GB6 :319 kopya kart eşlemesi', desen: YEREL_KART_ESLEMESI, eslesir: true, metin: "inventory.forEach(item=>{ productCategory[item.name]=(item.category??'Other');" },
  { ne: 'mutasyon: inventory.find', desen: YEREL_KART_ESLEMESI, eslesir: true, metin: 'const kart = inventory.find(i => i.sku === li.sku);' },
  { ne: 'reçete: stokKartiCozucu', desen: YEREL_KART_ESLEMESI, eslesir: false, metin: 'const kartBul = useMemo(() => stokKartiCozucu(inventory), [inventory]);' },
  { ne: 'GB6 :430 SKU sayısı', desen: YEREL_KART_ESLEMESI, eslesir: false, metin: "{label:'SKUs',val:String(inventory.length),icon:'🗃️',color:'#22c55e'}," },
  { ne: 'GB6 :319 kategori okuması', desen: KATEGORI_OKUMASI, eslesir: true, metin: "productCategory[item.name]=(item.category??'Other');" },
  { ne: 'reçete (O30): GB4 :644 biçimi de bir okumadır (sayılır)', desen: KATEGORI_OKUMASI, eslesir: true, metin: 'const kategori9 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);' },
  { ne: 'reçete: segmentCirosu çağrısı kategori okumaz', desen: KATEGORI_OKUMASI, eslesir: false, metin: 'const birlesik9 = segmentCirosu(kalemler9, kategori9, undefined, { tutarSec: kalemTutari, anahtarsizSay: true });' },
  { ne: 'reçete (O30): kategori kartın kendisinden', desen: KATEGORI_KARTTAN, eslesir: true, metin: 'const kategori9 = (li: OrderLineItem): string | null => doluMetin(kartBul(li)?.category);' },
  { ne: 'mutasyon: kalemin kendi kategori alanı (kart değil)', desen: KATEGORI_KARTTAN, eslesir: false, metin: "productCategory[item.name]=(item.category??'Other');" },
  { ne: 'GB4 :124 tanımı (kopyanın kaynağı — O30)', desen: DOLU_METIN_KOPYASI, eslesir: true, metin: "const doluMetin = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null);" },
  { ne: 'mutasyon: kırpılmış değer döndüren kopya (GB4 ile ayrışır)', desen: DOLU_METIN_KOPYASI, eslesir: false, metin: "const doluMetin = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x.trim() : null);" },
  // ── O27 ──
  { ne: 'GB5 :157 verisi olan son 7 ay', desen: SIRALI_ANAHTAR_DILIMI, eslesir: true, metin: 'const months = Object.keys(byMonth).sort().slice(-7);' },
  { ne: 'GB6 :327 verisi olan son 5 ay', desen: SIRALI_ANAHTAR_DILIMI, eslesir: true, metin: 'const allMonths = [...new Set(Object.values(catMonthRev).flatMap(m=>Object.keys(m)))].sort().slice(-5);' },
  { ne: 'mutasyon: reverse + baştan dilim', desen: SIRALI_ANAHTAR_DILIMI, eslesir: true, metin: 'const months = Object.keys(byMonth).sort().reverse().slice(0, 7);' },
  { ne: 'GB5 :516 karşılaştırıcılı sıralama (en iyi 5) serbest', desen: SIRALI_ANAHTAR_DILIMI, eslesir: false, metin: 'const top5 = Object.entries(byMonth).sort((a,b)=>b[1]-a[1]).slice(0,5);' },
  // ── GENEL-2 · 'K' kısaltması ──
  { ne: 'GB6 :90 bugünkü kısaltma', desen: KISA_K_LITERALI, eslesir: true, metin: "{fmtAna(r.currRev,'K',0)}" },
  { ne: 'reçete: kisaEtiket içindeki tek kısaltma', desen: KISA_K_LITERALI, eslesir: true, metin: "const k = fmtAna(e, 'K', ondalik);" },
  { ne: 'reçete: tam biçim kısaltma değil', desen: KISA_K_LITERALI, eslesir: false, metin: "return /[1-9]/.test(k) ? k : fmtAna(e, 'full', 0);" },
  { ne: "sınır: 'KDV' metni kısaltma değil", desen: KISA_K_LITERALI, eslesir: false, metin: "const etiket = 'KDV hariç';" },
  { ne: 'reçete: kisaEtiket tanımı (GB5 / GB6 aynı)', desen: KISA_ETIKET_GOVDESI, eslesir: true, metin: "const kisaEtiket = (e: number, ondalik = 0): string => {\n  const k = fmtAna(e, 'K', ondalik);\n  return /[1-9]/.test(k) ? k : fmtAna(e, 'full', 0);\n};" },
  { ne: 'mutasyon: gövdesiz tek satır kısaltma (kapı yok)', desen: KISA_ETIKET_GOVDESI, eslesir: false, metin: "const kisaEtiket = (e: number) => fmtAna(e, 'K', 0);" },
  { ne: 'reçete: rakam kapısı', desen: RAKAM_KAPISI, eslesir: true, metin: "return /[1-9]/.test(k) ? k : fmtAna(e, 'full', 0);" },
  { ne: "mutasyon: kapı «0K» metnine bakıyor (birim simgesi değişince kaçar)", desen: RAKAM_KAPISI, eslesir: false, metin: "return k.endsWith('0K') ? fmtAna(e, 'full', 0) : k;" },
];

// GB5 P1 ve GB6 P4 karar yorumları `<>…</>` içinde birleştirilmiş tek literal (yorumlu fikstür → `parcaKodu`).
const K14_BLOK = [
  '<>',
  '  {/* K14 (kullanıcı, 2026-09-19): "Aynı işi yapan çift paneller → kaldır." Bu dosyadaki "30-Day Revenue Forecast"',
  '      paneli KALDIRILDI (O25); kalan: RaporlarPage P620 satisTahmini( — 1/3/6 ay. */}',
  '  {/* K14: "kaldır" — "Seasonality Index" / "Mevsimsellik Endeksi" paneli KALDIRILDI; kalan GenelBloklar3 mevsimsellikEndeksi( */}',
  '</>',
].join('\n');
// `iceAktariyor` için on satırlık içe aktarım örneği: tek satır, çok satırlı, `type` üyeli, `// import …` yorumu ×2.
const ICE_AKTARIM_ORNEGI = [
  "import { siparisIptalMi, siparisTutari } from '../../../utils/siparis';",
  "import { tryDisiMi } from '../../../utils/siparisler/magazaSiparisi';",
  'import {',
  '  aylikCiro,',
  '  kumulatifSeyir,',
  '  type DonemSatiri,',
  "} from '../../../utils/pano/ciroDonem';",
  "// import { kalemYedekliTutar } from '../../../utils/pano/raporVeriKatmani';",
  "import { stokKartiCozucu, stokMaliyetCozucu } from '../../../utils/pano/raporMarj';",
  "// import { satisTahmini } from '../../../utils/muhasebe/faturaTakipTahmin';",
].join('\n');

// 4c it 1 ve it 2'nin girdisi: 59 yerel desen (`SILINEN_PANELLER` 20 desen taşır; 2026-10-18 aday kararı +6, aday kaldırma açılışı +1). `KARSILIKLAR` desenleri kaynak dosyada
// 3.2 ile sınanır (buraya girmez).
const YEREL: readonly RegExp[] = [
  MATH_MAX, TOTAL_TIPI_DENETIMI, PLAN_V2_SERT4_TOTAL, ...HAYALET_ALANLAR.map(([, d]) => d), DOGRUDAN_TUTAR_ALANI, ELLE_KALEM_GECISI,
  ...SILINEN_PANELLER.map(([, , d]) => d), BUYUME_KALINTISI, TAHMIN_CAGRISI, BUYUME_TAHMINI_ADI, PANEL_KAPISI, BASLIK, KARAR_K14,
  KARAR_K14_ADAYI, KARAR_K14_KALDIRMA, KARAR_K14_ADAY_KALDIRMA, ...UST_DUZEY_KUMELER.map(([, d]) => d), IPTAL_LITERALI, AD_YEDEGI, UYDURMA_KOVA, K4_HARITASI, PROPS_TIPI,
  GB6_ETIKETI, HAM_SIPARIS_CIRO, HAM_SIPARIS_ZAMAN_CIROSU, YEREL_KART_ESLEMESI, KATEGORI_OKUMASI, KATEGORI_KARTTAN,
  DOLU_METIN_KOPYASI, SIRALI_ANAHTAR_DILIMI, KISA_K_LITERALI, KISA_ETIKET_GOVDESI, RAKAM_KAPISI,
];

describe('§4c · desen kâhini (yerel desenler boş değil, çift yönlü — mutasyon ayırt edici)', () => {
  it('yerel desenler BAYRAKSIZ (`suclular` `desen.test` çağırır; `i` bayrağı dize taramasına kayar, `g` `lastIndex` taşır)', () => {
    expect(YEREL).toHaveLength(59);
    expect(YEREL.filter(d => d.flags !== '').map(d => `/${d.source}/${d.flags}`)).toEqual([]);
  });

  it('her yerel desenin en az bir eşleşen VE bir eşleşmeyen vakası var; vakaların hiçbiri sapmıyor', () => {
    for (const d of YEREL) {
      expect(DESEN_VAKALARI.some(v => v.desen === d && v.eslesir), `eşleşen vaka yok · /${d.source}/`).toBe(true);
      expect(DESEN_VAKALARI.some(v => v.desen === d && !v.eslesir), `eşleşmeyen vaka yok · /${d.source}/`).toBe(true);
    }
    const sapan = DESEN_VAKALARI.filter(v => v.desen.test(v.metin) !== v.eslesir)
      .map(v => `${v.eslesir ? 'eşleşmeli' : 'eşleşmemeli'} · ${v.ne} · /${v.desen.source}/ · ${v.metin.slice(0, 100)}`);
    expect(sapan).toEqual([]);
  });

  it('K14 JSX karar yorumu: süzgeç sonrası GB5 P1 / GB6 P4 izi yok; HAM hâli eşleşir; satır sayısı korunur', () => {
    const suzulmus = parcaKodu(K14_BLOK);
    expect(SILINEN_PANELLER[0][2].test(suzulmus), 'süzgeç sonrası · GB5 P1').toBe(false);
    expect(SILINEN_PANELLER[3][2].test(suzulmus), 'süzgeç sonrası · GB6 P4').toBe(false);
    expect(SILINEN_PANELLER[0][2].test(K14_BLOK), 'HAM · GB5 P1 (mutasyon kanıtı)').toBe(true);
    expect(SILINEN_PANELLER[3][2].test(K14_BLOK), 'HAM · GB6 P4 (mutasyon kanıtı)').toBe(true);
    expect(kararSatirlari(K14_BLOK, KARAR_K14), 'HAM · K14 taşıyan satır').toBe(2);
    expect(suzulmus.split('\n')).toHaveLength(K14_BLOK.split('\n').length);
  });

  it('`secenegiTasimayanCagrilar`: satır içi / adlı sabit / `useMemo` / çok satırlı / iç içe parantez / dizi argümanı', () => {
    const VAKALAR: ReadonlyArray<readonly [ne: string, metin: string, beklenen: number]> = [
      ['1 · satır içi harita', 'const mo1 = musteriOzeti(satislar, { tutarSec: siparisTutari, tarihSec: o => zamanMs(o.createdAt), leadCariKodu });', 0],
      ['2 · satır içi haritasız', 'const mo1 = musteriOzeti(satislar, { tutarSec: siparisTutari, tarihSec: o => zamanMs(o.createdAt) });', 1],
      ['3 · adlı sabit', 'const musteriSecenek = { tutarSec: siparisTutari, leadCariKodu };\nconst mo1 = musteriOzeti(satislar, musteriSecenek);', 0],
      ['4 · çok satırlı; sonraki deyimin haritası SAYILMAZ', 'const mo1 = musteriOzeti(\n  satislar,\n  { tutarSec: siparisTutari },\n);\nconst x = { leadCariKodu };', 1],
      ['5 · iç içe parantez', 'const mo1 = musteriOzeti(satislar.filter(o => ok(o)), { tutarSec: siparisTutari, leadCariKodu });', 0],
      ['6 · haritasız sabit (6c paket mutasyonu)', 'const musteriSecenek = { tutarSec: siparisTutari, tarihSec: zamanSec }; void leadCariKodu;\nconst mo1 = musteriOzeti(satislar, musteriSecenek);', 1],
      ['7 · `useMemo` içinde sabit', 'const musteriSecenek = useMemo(() => ({ tutarSec: siparisTutari, leadCariKodu }), [leadCariKodu]);\nconst mo1 = musteriOzeti(satislar, musteriSecenek);', 0],
      ['8 · dizi argümanlı çağrı (GB6 P1 reçetesi)', 'const musteriSecenek = { tutarSec: SEC, leadCariKodu };\nconst b1 = enBuyuk1.oge === null ? undefined : musteriOzeti([enBuyuk1.oge], musteriSecenek).musteriler[0];', 0],
      ['9 · iki çağrıdan biri haritasız', 'const musteriSecenek = { leadCariKodu };\nconst a = musteriOzeti(satislar, musteriSecenek);\nconst b = musteriOzeti(satislar, { tutarSec: siparisTutari });', 1],
    ];
    const sapan = VAKALAR.filter(([, metin, beklenen]) => secenegiTasimayanCagrilar(metin, 'musteriOzeti', K4_HARITASI).length !== beklenen)
      .map(([ne, metin, beklenen]) => `${ne} → ${beklenen} bekleniyordu: ${JSON.stringify(secenegiTasimayanCagrilar(metin, 'musteriOzeti', K4_HARITASI))}`);
    expect(sapan).toEqual([]);
    // 10 · içe aktarım satırı çağrı değil.
    expect(cagriArgumanlari("import { musteriOzeti, ciroSirali } from '../../../utils/rapor/musteri';", 'musteriOzeti'), '10 · içe aktarım').toEqual([]);
  });

  it('`iceAktariyor`: tek satır / çok satırlı / `type` üyeli bulunur; yorumdaki import ve yanlış modül bulunmaz', () => {
    const kod = parcaKodu(ICE_AKTARIM_ORNEGI);
    const VAKALAR: ReadonlyArray<readonly [modul: string, ad: string, beklenen: boolean]> = [
      ['utils/siparis', 'siparisTutari', true],
      ['utils/siparis', 'siparisIptalMi', true],
      ['utils/siparisler/magazaSiparisi', 'tryDisiMi', true],
      ['utils/pano/ciroDonem', 'kumulatifSeyir', true],
      ['utils/pano/ciroDonem', 'DonemSatiri', true],
      ['utils/pano/raporMarj', 'stokMaliyetCozucu', true],
      ['utils/pano/raporMarj', 'stokKartiCozucu', true],
      // `utils/siparis` ≠ `utils/siparisler/…` — `endsWith` ayrımı.
      ['utils/siparis', 'tryDisiMi', false],
      ['utils/pano/raporVeriKatmani', 'kalemYedekliTutar', false],
      ['utils/muhasebe/faturaTakipTahmin', 'satisTahmini', false],
    ];
    const sapan = VAKALAR.filter(([m, a, b]) => iceAktariyor(kod, m, a) !== b).map(([m, a, b]) => `${m}/${a} → ${b} bekleniyordu`);
    expect(sapan).toEqual([]);
    // HAM metinde yorumdaki iki içe aktarım bulunur — süzgeç kaldırılırsa iki `false` vakası KIRMIZI (mutasyon kanıtı).
    expect(iceAktariyor(ICE_AKTARIM_ORNEGI, 'utils/pano/raporVeriKatmani', 'kalemYedekliTutar'), 'HAM · yorumdaki kalemYedekliTutar').toBe(true);
    expect(iceAktariyor(ICE_AKTARIM_ORNEGI, 'utils/muhasebe/faturaTakipTahmin', 'satisTahmini'), 'HAM · yorumdaki satisTahmini').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §5 · O1 + O2 + PLAN-v2 §5 İMPORT taraması: 6d'nin `utils/rapor` DIŞI ek export'u tüketiliyor
// ---------------------------------------------------------------------------

// Dayanak: PLAN-v2 §5 «her alt fazın kapanışında, o alt fazın ürettiği HER export için ≥ 1 üretim tüketicisi».
// `utils/rapor/*` export'larını (`panelDurumu`, `tarihliKovala` — O29, `enBuyukBilinen`) `rapor6a.degismez` §2 dizin
// taramasıyla zaten zorlar — burada TEKRARLANMAZ. `utils/pano/*` eki HİÇBİR kapıdan geçmez → TEK satır (O26 / O30 sonrası).
// Ad kaynakta ölçüldü (2026-10-18): `ciroDonem.kumulatifSeyir` export; yazılmaması gereken adlar (kalemYedekliTutar,
// tutarKaynagi, merdivenBasamagi, kartKategorisi, buyumeTahmini …) kaynakta YOK — ad farkı yok.
const EK_EXPORTLAR: readonly (readonly [modul: string, ad: string, tuketici: string])[] = [
  ['utils/pano/ciroDonem', 'kumulatifSeyir', GB5],
];

describe('§5 · O1 + O2: 6d ek export\'u tüketiliyor', () => {
  it('5.1 · `utils/pano` ek export\'u beklenen tüketici dosyada içe aktarılıyor', () => {
    // "Çağrıyı" değil "içe aktarımı" iddia eder: yardımcı yazılıp bağlanmazsa (bağlama satır içi hesabı bırakırsa) kırmızı.
    const tuketicisiz = EK_EXPORTLAR.filter(([m, a, t]) => !iceAktariyor(kodMetni(t), m, a))
      .map(([m, a, t]) => `${m} → ${a} (beklenen tüketici: ${t})`);
    expect(tuketicisiz).toEqual([]);
  });
});
