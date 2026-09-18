/**
 * cariImport.ts — Mikro/leads cari dokümanı → müşteri/tedarikçi kaydı, bakiye durumu, cari sıralama/arama.
 * TEK KAYNAK. Test: cariImport.test.ts (ÖNCE yazıldı). Faz 3 2/n (AccountingModule kapatma), 2026-09-14.
 *
 * NEDEN VAR: AccountingModule.tsx cari eşlemesini ve sıralamasını dinleyici/JSX içinde yazıyordu.
 * Sahte kesinlik siteleri:
 *  - 542  `Number(x.bakiye ?? 0) !== 0`               "bakiyesi olan cari" kümesi: bilinmeyen doğru dışlanıyordu ama
 *                                                     'abc' gibi bozuk değer NaN !== 0 ile "bakiyeli" sayılıyordu
 *                                                     → `bakiyeliCariKodlari` (yalnız BİLİNEN ve ≠ 0).
 *  - 854/876 `Number(x.bakiye ?? x.balance ?? 0)`     bakiyesi bilinmeyen cari ₺0 bakiyeyle listeye giriyor, gri "sıfır"
 *                                                     rengiyle basılıp sıralamada ortaya diziliyordu → `balance: undefined`.
 *  - 875  `Number(x.creditLimit ?? 0)`                limiti bilinmeyen müşteri "limit ₺0" → `krediLimiti` (cariEkstreOnay).
 *  - 1858/1933 `(a.balance || 0) - (b.balance || 0)` bilinmeyen bakiye sıralamada ₺0 gibi ortaya → `sayiSirala` (sona).
 *  - 1915 `balance: c.balance || 0`                   alış faturalı cari tedarikçiye taşınırken bilinmeyen bakiye ₺0
 *                                                     → `musteridenTedarikci` aynen taşır (undefined kalır).
 *  - MusterilerTab 132 / TedarikcilerTab 135 `(c.balance || 0) > 0 ? kırmızı : < 0 ? yeşil : gri`
 *                                                     bilinmeyen bakiye "sıfır" rengiyle → `bakiyeDurumu` 'bilinmiyor'.
 *  - MusterilerTab 159 `bakiye: c.balance || 0`       DekontModal `mevcutBakiye` YALNIZ ekranda ("Mevcut bakiye" +
 *                                                     "Kayıt sonrası bakiye" önizlemesi); Mikro payload'ına
 *                                                     (dekontPayload: cariKod/tutar/tip/date/aciklama/evrakTip/seri)
 *                                                     GİRMİYOR → dekont bilinmeyen bakiyeyle de açılır, önizleme '—'
 *                                                     basar → `bakiyeSayisi` (NaN = bilinmiyor; paraYaz '—').
 * Kural (CLAUDE.md "sahte kesinlik gösterme"): bilinmeyen bakiye 0 DEĞİL bilinmiyordur — durum 'bilinmiyor',
 * ekran '—', sıralamada SONA gider.
 *
 * İŞARET SÖZLEŞMESİ (hafıza notu 2026-07-30, doğrulandı): bakiye EKSİ = CETPA borçlu (cari alacaklı);
 * ARTI = cari CETPA'ya borçlu. Sekmeler artıyı kırmızı, eksiyi yeşil basar; DekontModal eksiye "(Cetpa borçlu)" der.
 *
 * SAYFA PARİTESİ: ad/firma/vergi no/risk grubu geri dönüş zinciri BİREBİR (name→company→'—', taxId→taxNo→'',
 * riskGroup→'Düşük'); rol ayrımı birebir (`type === 'Supplier'` tedarikçi, diğer her şey müşteri); bilinen
 * bakiyelerde sıralama birebir. Bilinçli farklar:
 *  - `bakiye: ''` sayfada Number('') = 0 sayılıyordu; burada bilinmiyor → `balance` alanına düşer, o da yoksa undefined.
 *  - Bozuk `riskGroup` sayfada `as` ile aynen geçiyordu; burada üç geçerli değer dışı → 'Düşük' (sayfa varsayılanı).
 *  - Risk grubu bilinmeyen kayıt sayfada `?? -1` ile artan sırada BAŞA geliyordu; burada bakiye gibi SONA (iki yönde).
 *  - `mikroCariKod` sayfada yalnız müşteriye yazılıyordu; tedarikçi de aynı leads dokümanından okunduğu ve
 *    TedarikcilerTab ekstre panelinin `mikroCariKod || taxNo` ile cari kod çözdüğü için burada ikisine de yazılır.
 *    Aynı nedenle `musteridenTedarikci` de kodu düşürmez.
 *  - Arama `toLocaleLowerCase('tr-TR')` (sayfa `toLowerCase()`: 'İSTANBUL' ↔ 'istanbul' eşleşmiyordu).
 *
 * Girdi tipleri MİNİMAL ve yapısal (Customer/Supplier'a bağlı değil); çıktılar o tiplere yapısal olarak atanır.
 */
import { bilinenSayi, sayiSirala } from '../para';
import { krediLimiti } from './cariEkstreOnay';

export type RiskGrubu = 'Düşük' | 'Orta' | 'Yüksek';
const RISK_GRUPLARI: readonly RiskGrubu[] = ['Düşük', 'Orta', 'Yüksek'];
/** Risk grubu sıra değeri (sayfadaki RISK_SIRA); bilinmeyen → undefined (sayfa `?? -1` diyordu). */
const RISK_SIRA: Record<RiskGrubu, number> = { 'Düşük': 0, 'Orta': 1, 'Yüksek': 2 };

/** Alış faturalı cari → tedarikçi ve leads → cari eşlemesinin ortak alanları. Supplier/Customer'a yapısal uyar. */
export interface CariKaydi {
  id: string; name: string; company: string; email: string; phone: string; address: string; taxNo: string;
  /** Bilinmiyorsa undefined (0 DEĞİL) — paraYaz '—', bakiyeDurumu 'bilinmiyor', sıralamada sona. */
  balance?: number;
  riskGroup: RiskGrubu;
  /** Mikro cari kodu — fatura satırlarında adı çözmek, ekstre paneli ve dekont için. Yoksa ''. */
  mikroCariKod: string;
}
export interface MikroTedarikci extends CariKaydi { taxOffice: string; notes: string; createdAt?: unknown }
export interface MikroMusteri extends MikroTedarikci {
  /** Bilinmiyorsa undefined (0 DEĞİL) — cariEkstreOnay.krediLimiti ile aynı sözleşme. */
  creditLimit?: number;
}
export type MikroCari =
  | { rol: 'musteri'; kayit: MikroMusteri }
  | { rol: 'tedarikci'; kayit: MikroTedarikci };

/** Dokümandaki metin alanı: string aynen, sayı metne, diğerleri '' (sayfa `(x.f as string) || ''`). */
const metin = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
/** Bilinen sayı → Number, değilse undefined — sıfır varsayılanı YOK. */
const sayiYaDaYok = (v: unknown): number | undefined => (bilinenSayi(v) ? Number(v) : undefined);
const riskGrubu = (v: unknown): RiskGrubu =>
  (RISK_GRUPLARI as readonly unknown[]).includes(v) ? (v as RiskGrubu) : 'Düşük';

/**
 * Mikro cari / leads dokümanı → müşteri ya da tedarikçi kaydı.
 * Müşteriler CRM ile ORTAK kaynaktan okunur: leads koleksiyonu. `type === 'Supplier'` olanlar Tedarikçiler
 * sekmesine aittir (Mikro'dan gelen tedarikçiler), geri kalan her şey (type yok/Customer/Lead) müşteridir.
 * Bakiye: `bakiye` → `balance` → bilinmiyor. Kredi limiti yalnız müşteride.
 * `mikroCariKod` — Mikro faturalarında müşteri ADINI çözmek için şart. Eşlemede yoktu, bu yüzden fatura
 * satırlarında ad yerine "1470747917" gibi cari kodu görünüyordu (2026-08-01).
 */
export function mikroCariOku(id: string, x: Record<string, unknown>): MikroCari {
  const ortak: MikroTedarikci = {
    id,
    name:      metin(x.name) || metin(x.company) || '—',
    company:   metin(x.company),
    email:     metin(x.email),
    phone:     metin(x.phone),
    address:   metin(x.address),
    taxNo:     metin(x.taxId) || metin(x.taxNo),
    taxOffice: metin(x.taxOffice),
    notes:     metin(x.notes),
    balance:   sayiYaDaYok(x.bakiye) ?? sayiYaDaYok(x.balance),
    riskGroup: riskGrubu(x.riskGroup),
    mikroCariKod: metin(x.mikroCariKod),
    createdAt: x.createdAt,
  };
  if (x.type === 'Supplier') return { rol: 'tedarikci', kayit: ortak };
  const limit = krediLimiti(x);
  return { rol: 'musteri', kayit: { ...ortak, creditLimit: limit === null ? undefined : limit } };
}

/** Bir snapshot'ı tek geçişte iki listeye ayırır (setCustomers + setMikroSuppliers). Sıra korunur. */
export function mikroCarileriAyir(
  kayitlar: readonly { id: string; veri: Record<string, unknown> }[],
): { musteriler: MikroMusteri[]; tedarikciler: MikroTedarikci[] } {
  const musteriler: MikroMusteri[] = [], tedarikciler: MikroTedarikci[] = [];
  for (const { id, veri } of kayitlar) {
    const c = mikroCariOku(id, veri);
    if (c.rol === 'musteri') musteriler.push(c.kayit); else tedarikciler.push(c.kayit);
  }
  return { musteriler, tedarikciler };
}

/** Bakiye sayı olarak; bilinmiyorsa NaN (paraYaz '—'). DekontModal `mevcutBakiye` gibi `number` bekleyen yerler için. */
export function bakiyeSayisi(balance: unknown): number {
  return bilinenSayi(balance) ? Number(balance) : NaN;
}

export type BakiyeDurumu = 'borclu' | 'alacakli' | 'sifir' | 'bilinmiyor';
/**
 * Bakiye hükmü. 'borclu' = cari CETPA'ya borçlu (artı, kırmızı); 'alacakli' = CETPA borçlu (eksi, yeşil);
 * 'sifir' = GERÇEK 0 (gri); 'bilinmiyor' = sayı yok (0 DEĞİL; renk yok, paraYaz zaten '—' basar).
 */
export function bakiyeDurumu(balance: unknown): BakiyeDurumu {
  if (!bilinenSayi(balance)) return 'bilinmiyor';
  const n = Number(balance);
  return n > 0 ? 'borclu' : n < 0 ? 'alacakli' : 'sifir';
}

/**
 * cariBalances snapshot'ından "bakiyesi olan cari kodları" kümesi (cariRol'de satış/alış faturası olmayan ama
 * bakiyesi olan cari → "Diğer" etiketi; 7 Mehmet gibi masraf carileri). Kod: `cariKod` → doküman id, trim.
 * Yalnız BİLİNEN ve sıfırdan farklı bakiye girer — bilinmeyen/bozuk bakiye "bakiyesi var" DEĞİLDİR.
 */
export function bakiyeliCariKodlari(
  kayitlar: readonly { id: string; veri: Record<string, unknown> }[],
): Set<string> {
  const set = new Set<string>();
  for (const { id, veri } of kayitlar) {
    const kod = metin(veri.cariKod ?? id).trim();
    if (kod && bilinenSayi(veri.bakiye) && Number(veri.bakiye) !== 0) set.add(kod);
  }
  return set;
}

/** Cari kodu: mikroCariKod → code → taxNo → '' (rol tespiti ve alış-faturalı cari eşlemesi bu zinciri kullanır). */
export function cariKodu(c: { mikroCariKod?: unknown; code?: unknown; taxNo?: unknown }): string {
  return metin(c.mikroCariKod) || metin(c.code) || metin(c.taxNo);
}

export type SiralamaYonu = 'asc' | 'desc';
const alan = (o: object, k: string): unknown => (o as Record<string, unknown>)[k];

/**
 * Müşteri/Tedarikçi tablosu sıralayıcısı. 'balance' ve 'riskGroup' sayısal (bilinmeyen HER İKİ yönde sonda —
 * `sayiSirala`, yön `-cmp` ile ÇEVRİLMEZ); diğer anahtarlar metin, Türkçe harf sırası (`localeCompare 'tr'`),
 * eksik alan '' sayılır ve yön çevrilir.
 */
export function cariKarsilastirici<T extends object>(anahtar: keyof T & string, yon: SiralamaYonu): (a: T, b: T) => number {
  const azalan = yon === 'desc';
  if (anahtar === 'balance') return (a, b) => sayiSirala(alan(a, 'balance'), alan(b, 'balance'), azalan);
  if (anahtar === 'riskGroup') {
    const sira = (o: T): number | undefined => {
      const r = alan(o, 'riskGroup');
      return (RISK_GRUPLARI as readonly unknown[]).includes(r) ? RISK_SIRA[r as RiskGrubu] : undefined;
    };
    return (a, b) => sayiSirala(sira(a), sira(b), azalan);
  }
  return (a, b) => {
    const cmp = metin(alan(a, anahtar)).localeCompare(metin(alan(b, anahtar)), 'tr');
    return azalan ? -cmp : cmp;
  };
}

/** Ad/firma araması — Türkçe küçük harf (`toLocaleLowerCase('tr-TR')`: İ→i, I→ı). Boş arama herkesi geçirir. */
export function cariEslesir(c: { name?: unknown; company?: unknown }, arama: string): boolean {
  const q = arama.trim().toLocaleLowerCase('tr-TR');
  if (!q) return true;
  return metin(c.name).toLocaleLowerCase('tr-TR').includes(q)
    || metin(c.company).toLocaleLowerCase('tr-TR').includes(q);
}

/**
 * Alış faturalı cari → tedarikçi kaydı. TEK CARİ HAVUZU (kullanıcı kararı 2026-08-01): Mikro'da tek
 * CARI_HESAPLAR var; her cari rolünü faturasından alır. Alış faturası (mikroFaturalar yon='gelen') olan cariler
 * tedarikçidir. Tedarikçi burada ayrı bir kayıt değil, alış faturası olan AYNI cari (Customer) — bakiye/risk
 * zaten o kayıtta hesaplı, KAYBETMEDEN taşı (bilinmeyen bakiye bilinmeyen kalır, ₺0 olmaz).
 */
export function musteridenTedarikci(c: {
  id: string; name: string; company?: unknown; email?: unknown; phone?: unknown; taxNo?: unknown;
  address?: unknown; balance?: unknown; riskGroup?: unknown; mikroCariKod?: unknown;
}): CariKaydi {
  return {
    id: c.id,
    name: c.name,
    company: metin(c.company),
    email: metin(c.email),
    phone: metin(c.phone),
    taxNo: metin(c.taxNo),
    address: metin(c.address),
    balance: sayiYaDaYok(c.balance),
    riskGroup: riskGrubu(c.riskGroup),
    mikroCariKod: metin(c.mikroCariKod),
  };
}
