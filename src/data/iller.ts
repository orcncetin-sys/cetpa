/**
 * iller.ts — Türkiye'nin 81 ili. STATİK, TEK KAYNAK (2026-10-10, sipariş penceresinde ülke / il listesi).
 *
 * NEDEN STATİK: `public/geo/cities/TR.json` il listesi OLAMAZ — nüfusa göre yerleşim listesidir (1.052 kayıt; 81 ilin
 * 5'i yok, 976 kayıt il değil). İl listesi ağ isteğine de bağlanmaz: sipariş penceresi çevrim dışıyken de il seçtirir.
 *
 * SIRA: kayıtlar PLAKA sırasıyla tutulur (1..81) — plaka sırası alfabetik DEĞİLDİR (33 Mersin, 46 Kahramanmaraş,
 * 63 Şanlıurfa, 68'den sonrası sonradan il olanlar). Ekranda gösterilen sıra AYRI dışa aktarımdır: `IL_ADLARI`.
 *
 * YAZIM: resmî ve şapkasız («Hakkari»). `scripts/gen-geo-cities.cjs` içindeki `TR_ILLER` ile KÜME eşittir
 * (test: iller.test.ts — o betik üretim betiğidir, buradan içe aktarılamaz; eşitlik kaynak metninden denetlenir).
 *
 * Saf modül: React / DB / ağ yok.
 */
import { katla, eslesir } from '../utils/arama';

export interface Il {
  /** Trafik plaka kodu (1..81) — ilin değişmez sıra numarası. */
  readonly plaka: number;
  /** Resmî yazım, tam Türkçe karakterle. Kayda (`Order.teslimatSehri`) yazılan değer budur. */
  readonly ad: string;
}

export const ILLER: readonly Il[] = [
  { plaka: 1, ad: 'Adana' },
  { plaka: 2, ad: 'Adıyaman' },
  { plaka: 3, ad: 'Afyonkarahisar' },
  { plaka: 4, ad: 'Ağrı' },
  { plaka: 5, ad: 'Amasya' },
  { plaka: 6, ad: 'Ankara' },
  { plaka: 7, ad: 'Antalya' },
  { plaka: 8, ad: 'Artvin' },
  { plaka: 9, ad: 'Aydın' },
  { plaka: 10, ad: 'Balıkesir' },
  { plaka: 11, ad: 'Bilecik' },
  { plaka: 12, ad: 'Bingöl' },
  { plaka: 13, ad: 'Bitlis' },
  { plaka: 14, ad: 'Bolu' },
  { plaka: 15, ad: 'Burdur' },
  { plaka: 16, ad: 'Bursa' },
  { plaka: 17, ad: 'Çanakkale' },
  { plaka: 18, ad: 'Çankırı' },
  { plaka: 19, ad: 'Çorum' },
  { plaka: 20, ad: 'Denizli' },
  { plaka: 21, ad: 'Diyarbakır' },
  { plaka: 22, ad: 'Edirne' },
  { plaka: 23, ad: 'Elazığ' },
  { plaka: 24, ad: 'Erzincan' },
  { plaka: 25, ad: 'Erzurum' },
  { plaka: 26, ad: 'Eskişehir' },
  { plaka: 27, ad: 'Gaziantep' },
  { plaka: 28, ad: 'Giresun' },
  { plaka: 29, ad: 'Gümüşhane' },
  { plaka: 30, ad: 'Hakkari' },
  { plaka: 31, ad: 'Hatay' },
  { plaka: 32, ad: 'Isparta' },
  { plaka: 33, ad: 'Mersin' },
  { plaka: 34, ad: 'İstanbul' },
  { plaka: 35, ad: 'İzmir' },
  { plaka: 36, ad: 'Kars' },
  { plaka: 37, ad: 'Kastamonu' },
  { plaka: 38, ad: 'Kayseri' },
  { plaka: 39, ad: 'Kırklareli' },
  { plaka: 40, ad: 'Kırşehir' },
  { plaka: 41, ad: 'Kocaeli' },
  { plaka: 42, ad: 'Konya' },
  { plaka: 43, ad: 'Kütahya' },
  { plaka: 44, ad: 'Malatya' },
  { plaka: 45, ad: 'Manisa' },
  { plaka: 46, ad: 'Kahramanmaraş' },
  { plaka: 47, ad: 'Mardin' },
  { plaka: 48, ad: 'Muğla' },
  { plaka: 49, ad: 'Muş' },
  { plaka: 50, ad: 'Nevşehir' },
  { plaka: 51, ad: 'Niğde' },
  { plaka: 52, ad: 'Ordu' },
  { plaka: 53, ad: 'Rize' },
  { plaka: 54, ad: 'Sakarya' },
  { plaka: 55, ad: 'Samsun' },
  { plaka: 56, ad: 'Siirt' },
  { plaka: 57, ad: 'Sinop' },
  { plaka: 58, ad: 'Sivas' },
  { plaka: 59, ad: 'Tekirdağ' },
  { plaka: 60, ad: 'Tokat' },
  { plaka: 61, ad: 'Trabzon' },
  { plaka: 62, ad: 'Tunceli' },
  { plaka: 63, ad: 'Şanlıurfa' },
  { plaka: 64, ad: 'Uşak' },
  { plaka: 65, ad: 'Van' },
  { plaka: 66, ad: 'Yozgat' },
  { plaka: 67, ad: 'Zonguldak' },
  { plaka: 68, ad: 'Aksaray' },
  { plaka: 69, ad: 'Bayburt' },
  { plaka: 70, ad: 'Karaman' },
  { plaka: 71, ad: 'Kırıkkale' },
  { plaka: 72, ad: 'Batman' },
  { plaka: 73, ad: 'Şırnak' },
  { plaka: 74, ad: 'Bartın' },
  { plaka: 75, ad: 'Ardahan' },
  { plaka: 76, ad: 'Iğdır' },
  { plaka: 77, ad: 'Yalova' },
  { plaka: 78, ad: 'Karabük' },
  { plaka: 79, ad: 'Kilis' },
  { plaka: 80, ad: 'Osmaniye' },
  { plaka: 81, ad: 'Düzce' },
];

/**
 * Ekranda gösterilen sıra: il adları Türkçe alfabeye göre (`localeCompare(…, 'tr')` — I, İ'den; S, Ş'den önce gelir:
 * «Hatay, Iğdır, Isparta, İstanbul, İzmir, Kahramanmaraş» · «Sivas, Şanlıurfa, Şırnak, Tekirdağ»).
 */
export const IL_ADLARI: readonly string[] = ILLER.map(il => il.ad).sort((a, b) => a.localeCompare(b, 'tr'));

/** `katla(ad)` → listedeki (doğru yazımlı) ad. `katla()` 81 ad üzerinde tekildir (test). */
const KATLANMIS_AD = new Map<string, string>(ILLER.map(il => [katla(il.ad), il.ad]));

/**
 * Serbest yazılmış il metnini listedeki ADA çevirir — yalnız BİREBİR eşleşmede: `katla(ham).trim()`, 81 addan birinin
 * `katla()` karşılığına eşitse listedeki (doğru yazımlı) ad; değilse `null`.
 *
 * `katla()` harf büyüklüğünü, Türkçe harfleri ve şapkayı bağışlar ('ANTALYA', 'ISTANBUL', 'İSTANBUL', 'Igdir',
 * 'Hakkâri' eşleşir); KISALTMA ve eski adı bağışlamaz ('K.MARAŞ', 'AFYON', 'İÇEL', 'URFA' → `null`), il dışında
 * metin taşıyan girdiyi de ('Antalya / Kepez' → `null`). Emin olunamayan yazımda il YAZILMAZ — kullanıcı seçer
 * (kaynak çoğu kez Mikro `adr_il`; «varsayılan adres» sezgisiyle gelir, yanlış il yazmak boş bırakmaktan kötüdür).
 */
export function ilBul(ham: unknown): string | null {
  const anahtar = katla(ham).trim();
  if (!anahtar) return null;
  return KATLANMIS_AD.get(anahtar) ?? null;
}

/**
 * Arama kutusuna yazılan metne göre il adları. Eşleşme `eslesir()` iledir (Türkçe-duyarlı, iki yönde bağışlayıcı:
 * 'sanli' → Şanlıurfa, 'igdir' → Iğdır, 'canak' → Çanakkale); boş sorgu 81 ilin tamamını `IL_ADLARI` sırasında verir.
 *
 * SONUÇ SIRASI: önce adı sorguyla BAŞLAYANLAR, sonra içerenler; iki grup da `IL_ADLARI` sırasında. Alt dize eşleşmesi
 * 'is' sorgusunda 7 il döndürür (Afyonkarahisar, Bitlis, Eskişehir, Isparta, İstanbul, Kilis, Manisa) — aranan il
 * (Isparta, İstanbul) üstte dursun.
 */
export function illeriSuz(sorgu: string): string[] {
  const q = katla(sorgu).trim();
  if (!q) return [...IL_ADLARI];
  const eslesen = IL_ADLARI.filter(ad => eslesir(sorgu, ad));
  return [
    ...eslesen.filter(ad => katla(ad).startsWith(q)),
    ...eslesen.filter(ad => !katla(ad).startsWith(q)),
  ];
}
