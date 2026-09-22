/**
 * ikBordro.ts — İK bordro okuma katmanı: ödenen bordro toplamı, bordro trendi, departman anahtarı
 * (Faz 3 6a, grup "ik-bordro", 2026-09-19). Test: ikBordro.test.ts (ÖNCE yazıldı). Saf — React/DB yok.
 *
 * ## Neden var
 *
 * İK raporunu besleyen okuma yüzeyi bilinmeyen sayıyı ₺0'a çeviriyor ve dönemi olmayan
 * bordroya sahte bir çubuk açıyordu:
 *
 *   src/components/reports/useReportsData.ts
 *     102  acc[e.department] = (acc[e.department] || 0) + 1
 *     121  const pays = sortByCreatedAt(snap.docs.map(d => d.data()))     (createdAt DESC)
 *     122  total = pays.filter(p => p.status === 'Ödendi')
 *                      .reduce((sum, p) => sum + (p.netSalary || 0), 0)
 *     125  const key = `${p.month}/${p.year}`
 *     126  acc[key] = (acc[key] || 0) + (p.netSalary || 0)
 *
 * Somut arıza: `netSalary` alanı okunamayan (eksik/boş/metin) bordro `|| 0` ile "₺0 biliniyor"
 * oluyor; "Ödenen Maaş" KPI'ı ve bordro trendi sessizce EKSİK çıkıyor, kaç kaydın dışarıda
 * kaldığı hiçbir yerde yazmıyor (CLAUDE.md "sahte kesinlik gösterme": bilinmeyen sayı 0 DEĞİL
 * bilinmiyordur — toplama girmez, SAYILIR, ekranda '—' ya da açık not olur).
 * `${p.month}/${p.year}` ise ay/yıl yoksa `'undefined/undefined'` adlı bir çubuk üretiyordu.
 *
 * ## Parite
 *
 * Bilinen girdide sayılar eskiyle BİREBİR: `odenenBordro` yine yalnız `status === 'Ödendi'`
 * kayıtları toplar; `bordroTrendi` yine durum SÜZGECİ UYGULAMAZ (Taslak/Bekliyor da çubuğa
 * girer — bugünkü davranış); meşru ₺0 yine 0'dır; sayısal string yine sayıya çevrilir
 * (`bilinenSayi`, DB'de metin saklanmış olabilir).
 *
 * ## Bilinçli farklar
 *
 *  1. `netSalary` bilinmiyorsa toplama girmez, `tutar.bilinmeyen` sayar (eski `|| 0` toplamı
 *     sessizce düşürüyordu). Hiç bilinen yokken `ekranTutari` NaN verir → ekranda '—'.
 *  2. `currency` DOLU ve TRY değilse kayıt TL toplamına KATILMAZ, `dovizli` sayılır — emsal
 *     `lojistikKpi.ihracatToplami`: farklı birimler tek toplamda birleştirilmez. Bugün hiçbir
 *     yazıcı `currency` set etmiyor (HRModule.tsx:393), boş/eksik = TRY → canlı sayı değişmez.
 *  3. Dönemi çözülemeyen bordro hiçbir çubuğa girmez, `donemsiz` sayılır ('undefined/undefined'
 *     çubuğu biter). Çubuklar `donem`e göre KRONOLOJİK artan — eski sıra `sortByCreatedAt`
 *     (fsSort.ts:26, varsayılan DESC) ekleme sırasıydı, kronolojik DEĞİLDİ.
 *  4. Sayaçlar ÇİFT SAYMAZ: dövizli kayıt kümeden ÇIKARILIR, bu yüzden aynı kayıt `dovizli` ile
 *     `bilinmeyen`/`donemsiz` sayaçlarının ikisinde birden görünmez (`dovizli + donemsiz` =
 *     trende girmeyen kayıt adedi).
 *  5. Boş departman adı `null` döner (dilim ÜRETİLMEZ); trim'li olduğu için 'Satış ' ile 'Satış'
 *     tek dilimdir. Boş adın ekranda nasıl etiketleneceği (bugün 'undefined' dilimi) bağlama
 *     katmanının kararı — yardımcı etiket ÜRETMEZ.
 *
 * ## Dokunulmayanlar
 * `IKPage.tsx:621-635` ve `MuhtasarModule.tsx:98/288` netSalary'yi brütten HESAPLAR (bordro
 * ÜRETİMİ — farklı iş); bu modül DB'ye YAZILMIŞ `netSalary`'yi OKUR. Kopya değildir.
 */
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';
import { BOS_TUTAR, kovayaEkle } from '../pano/raporVeriKatmani';

/** `payrolls` dokümanının okunan alanları — yapısal (kanonik `Payroll`, types.ts:377, uyar). */
export interface BordroKaydi {
  status?: unknown;
  netSalary?: unknown;
  month?: unknown;
  year?: unknown;
  currency?: unknown;
}

/**
 * Kayıt TL toplamına girer mi? `currency` boş/eksik = TRY (bugünkü tüm kayıtlar; HRModule
 * yazıcısı alanı hiç set etmiyor). Metin olmayan dolu değer TANINMAYAN birimdir → TL sayılmaz.
 * Karşılaştırma büyük/küçük harf duyarsız; bu metin EKRANA BASILMAZ (yalnız birim eşleştirme).
 */
function tlKaydi(currency: unknown): boolean {
  if (currency === undefined || currency === null) return true;
  if (typeof currency !== 'string') return false;
  const kod = currency.trim();
  return kod === '' || kod.toUpperCase() === 'TRY';
}

/**
 * status === 'Ödendi' bordroların net toplamı (useReportsData.ts:122 karşılığı).
 * `tutar` KISMİ toplam + sayaçlar: ekranda `ekranTutari(tutar)` ile basılır ve
 * `tutar.bilinmeyen > 0` ise yanına "N bordronun tutarı bilinmiyor" notu konur.
 * `dovizli` TL toplamı dışında kalan (yabancı para) bordro adedi.
 */
export function odenenBordro(bordrolar: readonly BordroKaydi[]): { tutar: Tutar; dovizli: number } {
  const odendi = bordrolar.filter(b => b.status === 'Ödendi');
  const tlOlanlar = odendi.filter(b => tlKaydi(b.currency));
  return { tutar: toplaBilinen(tlOlanlar, b => b.netSalary), dovizli: odendi.length - tlOlanlar.length };
}

/**
 * MODÜL İÇİ (JIT: 6a'da dış tüketicisi yok — `export` EDİLMEZ; ilk dış tüketicinin alt fazında
 * testleriyle birlikte dışa açılır). `'YYYY-MM'` — metin sırası = kronolojik sıra.
 * Ay 1–12 TAM sayı ve yıl 1900–2999 TAM sayı değilse `null` (eski `${p.month}/${p.year}`
 * '0/2026', '13/2026', 'undefined/undefined' gibi çubuklar üretiyordu).
 * `zaman.ts:152 ayAnahtari` bir TARİH değerinden türetir; burada ay/yıl AYRI iki alan — kopya değil.
 */
function bordroDonemAnahtari(p: Pick<BordroKaydi, 'month' | 'year'>): string | null {
  if (!bilinenSayi(p.month) || !bilinenSayi(p.year)) return null;
  const ay = Number(p.month), yil = Number(p.year);
  if (!Number.isInteger(ay) || ay < 1 || ay > 12) return null;
  if (!Number.isInteger(yil) || yil < 1900 || yil > 2999) return null;
  return `${yil}-${String(ay).padStart(2, '0')}`;
}

/** Bordro trendinin tek çubuğu. Ekran etiketi (`${ay}/${yil}`) BAĞLAMA katmanında üretilir. */
export interface BordroTrendSatiri {
  donem: string;
  ay: number;
  yil: number;
  tutar: Tutar;
}

/**
 * Dönem (ay) bazlı bordro trendi — TÜM durumlar (bugünkü davranış: trend 'Ödendi' süzgeci
 * UYGULAMIYOR; parite). Satırlar kronolojik ARTAN.
 * `donemsiz`: ay/yıl'ı çözülemediği için hiçbir çubuğa girmeyen kayıt adedi.
 * `dovizli`: yabancı para olduğu için TL çubuklarına girmeyen kayıt adedi (dönem denetiminden
 * ÖNCE ayrılır → iki sayaç kesişmez, çift sayım yok).
 */
export function bordroTrendi(bordrolar: readonly BordroKaydi[]): {
  satirlar: BordroTrendSatiri[];
  donemsiz: number;
  dovizli: number;
} {
  const kovalar = new Map<string, { ay: number; yil: number; tutar: Tutar }>();
  let donemsiz = 0, dovizli = 0;

  for (const b of bordrolar) {
    if (!tlKaydi(b.currency)) { dovizli++; continue; }
    const donem = bordroDonemAnahtari(b);
    if (donem === null) { donemsiz++; continue; }
    const mevcut = kovalar.get(donem) ?? { ay: Number(b.month), yil: Number(b.year), tutar: BOS_TUTAR };
    kovalar.set(donem, { ...mevcut, tutar: kovayaEkle(mevcut.tutar, b.netSalary) });
  }

  const satirlar = [...kovalar.entries()]
    .map(([donem, k]) => ({ donem, ay: k.ay, yil: k.yil, tutar: k.tutar }))
    // 'YYYY-MM' sabit genişlikte ve yalnız rakam/tire içerir → düz metin sırası = kronolojik sıra
    // (yerelden bağımsız olsun diye `localeCompare` DEĞİL; bu bir anahtar, ekran metni değil).
    .sort((a, b) => (a.donem < b.donem ? -1 : a.donem > b.donem ? 1 : 0));
  return { satirlar, donemsiz, dovizli };
}

/**
 * Departman dilimi anahtarı: dolu (trim'li) departman adı; boş / metin değil → `null`
 * (useReportsData.ts:102 `acc[e.department]` boş adı 'undefined' dilimine çeviriyordu).
 * Trim sayesinde 'Satış ' ile 'Satış' TEK dilimdir.
 */
export function departmanAnahtari(e: { department?: unknown }): string | null {
  if (typeof e.department !== 'string') return null;
  const ad = e.department.trim();
  return ad === '' ? null : ad;
}
