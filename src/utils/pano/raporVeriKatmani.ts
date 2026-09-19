/**
 * raporVeriKatmani.ts — Pano/Rapor VERİ KATMANI: okuma anında sahte sıfır üretmeyen
 * eşleyiciler ve toplayıcılar (Faz 3 5/n, grup "raporVeriKatmani", 2026-09-19).
 * Test: raporVeriKatmani.test.ts (ÖNCE yazıldı). Saf — React/DB yok.
 *
 * ## Neden var
 *
 * Panoyu besleyen üç okuma yüzeyi bilinmeyen sayıyı ₺0'a çeviriyordu. Sahte sıfır
 * OKUMA anında doğduğu için, aşağıdaki NaN-farkında tüketiciler (Faz 3 1/n–2/n'de
 * düzeltilen `toplaBilinen`/`dovizTopla`/`duranVarlik`/`ekranTutari`) etkisiz kalıyordu:
 *
 *   src/components/reports/useReportsData.ts
 *     156  totalRevenueTRY   = ….reduce((s,o) => s + (Number(o.totalPrice) || 0), 0)
 *     163  avgOrderValueTRY  = totalOrders > 0 ? totalRevenueTRY / totalOrders : 0
 *     189  salesByDate       acc[dateKey].total += (Number(o.totalPrice) || 0)
 *     217  topCustomers      acc[k].total       += Number(o.totalPrice) || 0
 *     306  brutMarj.toplamCiro = list.reduce((s,o) => s + (o.totalPrice || 0), 0)
 *     309  brutMarj.ciro       = kapsamli.reduce((s,o) => s + (o.totalPrice || 0), 0)
 *   src/hooks/useSekmeVerileri.ts
 *     134  balance:      Number(d.data().balance) || 0
 *     141  cost:         Number(d.data().cost) || Number(d.data().edinimBedeli) || 0
 *     142  depreciation: Number(d.data().birikimliAmortisman) || 0
 *   src/components/BankStatementImportModal.tsx
 *     137  balance:      mapping.balance ? parseTRNumber(…) : 0
 *
 * Somut arıza: RaporlarPage Mikro satış faturalarını pseudo-sipariş olarak EKLER
 * (additive birleşim — CLAUDE.md "EKLE, YERİNE KOYMA"; burada o kural DEĞİŞMEDİ) ve
 * `useMikroFaturalar` meblağı okunamayan faturaya artık NaN verir (Faz 3 2/n).
 * `|| 0` o NaN'ı "₺0 biliniyor"a çevirip ciroyu, ortalama sipariş tutarını, günlük
 * trendi ve top-müşteri sıralamasını sessizce EKSİK gösteriyordu; kaç kaydın
 * dışarıda kaldığı hiçbir yerde yazmıyordu.
 *
 * ## Parite
 *
 * Bilinen girdide sayılar eskiyle BİREBİR aynı: sayısal string yine sayıya çevrilir,
 * meşru ₺0 yine 0'dır, `accountType`/`currency`/ad yedekleri aynen korunur.
 *
 * ## Bilinçli farklar
 *
 *  1. `raporSiparisi` tutarı `siparis.ts`'teki TEK KAYNAK `siparisTutari` ile okur
 *     (`totalPrice ?? totalAmount`): yalnız `totalPrice`a bakan eski site, tutarı
 *     `totalAmount`ta duran kaydı ciroya ₺0 sokuyordu. `??` önceliği meşru 0'ı
 *     yedeğe DÜŞÜRMEZ (`||` düşürüyordu).
 *  2. `ortalamaSiparis` TÜRETME'dir (`tamTutar`): tek kayıt bile bilinmiyorsa
 *     hesaplanmaz. Eski site kısmi toplamı tüm siparişlere bölüp gerçeğin altında
 *     bir ortalamayı "biliniyor" gibi basıyordu. Hiç sipariş yokken de '—' (eski ₺0,00).
 *  3. `grafikDegeri` bilinmeyen kovaya `null` verir (0 değil) — recharts çizgisi
 *     sıfıra çakılıp "o gün satış yok" demesin.
 *  4. `sabitKiymetOku` dokümanın GERÇEKTE yazılan alanlarını okur: `ad` / `alisBedeli` /
 *     `birikmisSalinma` (SabitKiymetModule formu ve Mikro demirbaş importu bunları
 *     yazar). Eski okumadaki `name` / `cost` / `edinimBedeli` / `birikimliAmortisman`
 *     adları kod tabanında HİÇBİR YERDE yazılmıyor — her demirbaş "ad '—', maliyet ₺0"
 *     okunuyordu. Eski adlar yedek olarak korundu (elle/dış içe aktarım ihtimali).
 *
 * ## Kapsam dışı (bilerek)
 *
 *  • Tüketici ekranları (rapor bileşenleri, MuhasebePage) DEĞİŞTİRİLMEDİ; bu modül
 *    yalnız okuma katmanını besler. Tüketicilerdeki `s + (o.totalPrice || 0)` siteleri
 *    ayrı bir işin listesidir.
 *  • (2026-09-19 düzeltildi) Amortisman ARTIK hesaplanıyor — bkz. `sabitKiymetOku`.
 *    Bu blok eskiden "amortismanın kendisi hesaplanmaz: `birikmisSalinma` 0 burada BİLİNEN 0
 *    sayılır" diyordu; o okuma forma girilen HER demirbaşı (form varsayılanı `birikmisSalinma: 0`)
 *    Bilanço'ya BRÜT alış bedeliyle sokuyordu. Hesap artık `utils/muhasebe/amortisman.ts`te,
 *    SabitKiymetModule ile ORTAK ve testli.
 */
import { bilinenSayi, toplaBilinen, ekranTutari, tamTutar, type Tutar } from '../para';
import { birikmisAmortisman } from '../muhasebe/amortisman';
import { siparisTutari, type SiparisTutarAlanlari } from '../siparis';
import { girilenAlanYamasi } from '../muhasebe/irsaliyeCalisan';
import { parseTRNumber } from '../trParse';

// ── Ortak küçük okuyucular ──────────────────────────────────────────────────────────────────

/** Ham dokümandan alan çeker (doküman `unknown` gelir — listener hiçbir alanı doğrulamaz). */
function alan(veri: unknown, ad: string): unknown {
  return typeof veri === 'object' && veri !== null ? (veri as Record<string, unknown>)[ad] : undefined;
}

/**
 * Metin alanı: boş dize yedeğe düşer (eski `||` zinciriyle aynı). Sonlu sayı da metne
 * çevrilir — eski `||` zinciri sayıyı olduğu gibi geçiriyordu, tip sözü `string`ti.
 */
function metin(x: unknown): string | null {
  if (typeof x === 'string') return x === '' ? null : x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return null;
}

/** Sıradaki İLK BİLİNEN sayı (`??` önceliği: meşru 0 yedeğe düşmez); hiçbiri bilinmiyorsa NaN. */
function ilkBilinenSayi(...adaylar: readonly unknown[]): number {
  for (const a of adaylar) if (bilinenSayi(a)) return Number(a);
  return NaN;
}

// ── Sipariş tutarı: ciro / ortalama / kova toplamları ───────────────────────────────────────

/** Rapor katmanının sipariş girdisi — yapısal (kanonik `Order` ve sentetik Mikro kaydı uyar). */
export interface RaporSiparisi extends SiparisTutarAlanlari {
  status?: unknown;
}

/**
 * Siparişin rapor tutarı; bilinmiyorsa NaN (ASLA 0). `toplaBilinen`in seçicisi olarak
 * doğrudan kullanılır: `toplaBilinen(siparisler, raporSiparisi)`.
 */
export function raporSiparisi(o: RaporSiparisi): number {
  return siparisTutari(o);
}

/** Ciro toplamı (iptal edilenler hariç) — `Tutar`: kısmi toplam + bilinen/bilinmeyen sayaçları. */
export function raporCirosu(siparisler: readonly RaporSiparisi[]): Tutar {
  return toplaBilinen(siparisler.filter(o => o.status !== 'Cancelled'), raporSiparisi);
}

/**
 * Ortalama sipariş tutarı — TÜRETME (`tamTutar`): tek kayıt bile bilinmiyorsa NaN ('—').
 * `adet` çağıranın kullandığı bölen (mevcut sayfa `orders.length` geçiyor — parite için
 * bölen DEĞİŞTİRİLMEDİ; iptal edilenleri de sayması ayrı bir iş).
 */
export function ortalamaSiparis(ciro: Tutar, adet: number): number {
  return adet > 0 ? tamTutar(ciro) / adet : NaN;
}

/** Boş kova — paylaşılan değişmez başlangıç (`kovayaEkle` her zaman YENİ nesne döndürür). */
export const BOS_TUTAR: Tutar = Object.freeze({ toplam: 0, bilinen: 0, bilinmeyen: 0 });

/**
 * Kovaya (gün / müşteri / ay) tek bir değer ekler: bilinenler toplanır, bilinmeyenler SAYILIR.
 * `acc[key].total += (Number(o.totalPrice) || 0)` kalıbının NaN-farkında karşılığı.
 */
export function kovayaEkle(kova: Tutar, deger: unknown): Tutar {
  return bilinenSayi(deger)
    ? { toplam: kova.toplam + Number(deger), bilinen: kova.bilinen + 1, bilinmeyen: kova.bilinmeyen }
    : { toplam: kova.toplam, bilinen: kova.bilinen, bilinmeyen: kova.bilinmeyen + 1 };
}

/**
 * Grafik (recharts) değeri: hiç bilinen yoksa `null` — 0 DEĞİL. `null` nokta atlanır,
 * 0 ise çizgiyi sıfıra çakıp "o gün hiç satış yok" diye YANLIŞ bilgi verir.
 */
export function grafikDegeri(kova: Tutar): number | null {
  const v = ekranTutari(kova);
  return Number.isFinite(v) ? v : null;
}

// ── bankAccounts okuması (Bilanço → Kasa / Bankalar) ────────────────────────────────────────

/** Sayfanın beklediği şekil DEĞİŞMEDİ; tek fark: `balance` bilinmiyorsa NaN. */
export interface PanoBankaHesabi {
  id: string;
  bankName: string;
  accountType: string;
  balance: number;
  currency: string;
}

/**
 * `bankAccounts` dokümanı → pano hesabı. `veri` doküman alanları + `id` içermelidir
 * (`bankaHesabiOku({ id: d.id, ...d.data() })`).
 *
 * `accountType`/`currency` yedekleri PARİTE olarak korundu: bunlar para değil
 * SINIFLANDIRMA varsayılanıdır (tür → Kasa/Banka ayrımı, birim → TRY). Bilinen sınır:
 * türü okunamayan hesap "Vadesiz" sayılıp Bankalar satırına girer.
 */
export function bankaHesabiOku(veri: unknown): PanoBankaHesabi {
  return {
    id: String(alan(veri, 'id') ?? ''),
    bankName: metin(alan(veri, 'bankName')) ?? metin(alan(veri, 'bank')) ?? '—',
    accountType: metin(alan(veri, 'accountType')) ?? 'Vadesiz',
    balance: ilkBilinenSayi(alan(veri, 'balance')),
    currency: metin(alan(veri, 'currency')) ?? 'TRY',
  };
}

// ── sabitKiymetler okuması (Bilanço → Duran Varlıklar) ──────────────────────────────────────

/** Sayfanın beklediği şekil DEĞİŞMEDİ; `cost`/`depreciation` bilinmiyorsa NaN. */
export interface PanoSabitKiymet {
  id: string;
  name: string;
  cost: number;
  depreciation: number;
}

/**
 * `sabitKiymetler` dokümanı → pano demirbaşı (`sabitKiymetOku({ id: d.id, ...d.data() })`).
 *
 * Alan sırası GERÇEKTE YAZILAN adlarla başlar (SabitKiymetModule formu + Mikro
 * `demirbasEsle`): `ad` / `alisBedeli` / `birikmisSalinma`. Eski okumadaki adlar
 * (`name` / `cost` / `edinimBedeli` / `birikimliAmortisman`) yedek olarak korundu.
 * Zincir `??` önceliğindedir: meşru ₺0 maliyet yedeğe DÜŞMEZ.
 *
 * ## AMORTİSMAN (2026-09-19 düzeltmesi)
 *
 * `birikmisSalinma` alanı bir MANUEL OVERRIDE'dır ve **0 "hesaplansın" demektir**
 * (SabitKiymetModule:37; form varsayılanı satır 320 = 0). Eski okuma o 0'ı BİLİNEN sıfır
 * amortisman sayıyordu: forma girilen her demirbaş Bilanço'nun duran varlık satırına
 * amortismansız, BRÜT alış bedeliyle giriyordu (Forklift ₺1.200.000 alım, 4 yıl geçmiş →
 * SabitKiymet listesi ₺240.000 net derken Bilanço ₺1.200.000 diyordu; aktif ve özkaynak
 * ~₺960.000 şişik). Amortisman artık `utils/muhasebe/amortisman.ts`teki ORTAK, testli
 * hesapla üretiliyor — SabitKiymetModule de aynı fonksiyonu kullanır (KOPYA YOK).
 * Alış tarihi / faydalı ömür yoksa (ör. kolonu çözülemeyen Mikro demirbaş importu)
 * amortisman NaN'dır: `duranVarlik` satırı '—' basar ve kayıt "bilinmeyen" sayılır.
 *
 * `bugun` yalnız testler için: varsayılan gerçek zamandır.
 */
export function sabitKiymetOku(veri: unknown, bugun?: Date): PanoSabitKiymet {
  const cost = ilkBilinenSayi(alan(veri, 'alisBedeli'), alan(veri, 'cost'), alan(veri, 'edinimBedeli'));
  return {
    id: String(alan(veri, 'id') ?? ''),
    name: metin(alan(veri, 'ad')) ?? metin(alan(veri, 'name')) ?? '—',
    cost,
    depreciation: birikmisAmortisman({
      alisBedeli: cost,
      alisTarihi: alan(veri, 'alisTarihi'),
      faydaliOmur: alan(veri, 'faydaliOmur'),
      amortYontemi: alan(veri, 'amortYontemi'),
      birikmisSalinma: ilkBilinenSayi(
        alan(veri, 'birikmisSalinma'), alan(veri, 'depreciation'), alan(veri, 'birikimliAmortisman'),
      ),
    }, bugun),
  };
}

// ── Banka ekstresi CSV içe aktarma (bankTransactions) ───────────────────────────────────────

/**
 * Ekstre hücresinden bakiye: bilinmiyorsa `null`.
 *
 * `parseTRNumber` çözemediği her girdiye 0 döner (imzası `number`) — boş hücre,
 * '—', 'N/A' hepsi ₺0 olur. Ayrım burada yapılır: hücrede HİÇ RAKAM yoksa değer
 * bilinmiyordur. Ayrıştırmanın kendisi yine `parseTRNumber`'dadır (kopya YOK).
 */
export function ekstreBakiyesi(ham: unknown): number | null {
  if (typeof ham === 'number') return Number.isFinite(ham) ? ham : null;
  if (typeof ham !== 'string' || !/\d/.test(ham)) return null;
  const n = parseTRNumber(ham);
  return Number.isFinite(n) ? n : null;
}

/**
 * İçe aktarılan hareketin bakiye YAMASI. YENİ KAYIT kuralı (CLAUDE.md form sözleşmesi,
 * `girilenAlanYamasi`): bilinen → yaz; bilinmiyor → alanı HİÇ YAZMA. Eski site
 * bakiye sütunu eşlenmemişken her harekete `balance: 0` yazıyordu — banka bakiye
 * raporunda "bakiye sıfır" diye okunan uydurma bir değer.
 */
export function ekstreBakiyeYamasi(ham: unknown): Partial<Record<'balance', number | null>> {
  return girilenAlanYamasi('balance', ekstreBakiyesi(ham), undefined);
}
