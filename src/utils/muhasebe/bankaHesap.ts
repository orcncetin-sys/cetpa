/**
 * bankaHesap.ts — Muhasebe → Banka & Kasa sekmesi (AccountingModule → BankaTab) HESAPLARI, tek kaynak
 * (Faz 3 2/n, grup "bankaHesap", 2026-09-14). Test: bankaHesap.test.ts (ÖNCE yazıldı).
 *
 *   • KPI kartları "TRY / USD / EUR Bakiye"            (AccountingModule ~1611-1613 → BankaTab ~72-83)
 *   • "Şimdi Çek": Mikro banka hareketi → BankTransaction (AccountingModule pullBankTransactions ~1104-1116)
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK):
 *   1611  tryBalance = bankAccounts.filter(a => a.currency === 'TRY').reduce((s, a) => s + a.balance, 0)
 *   1612  usdBalance = ... 'USD' ...      1613  eurBalance = ... 'EUR' ...
 *         → `BankAccount.balance: number` tipi dolu demek DEĞİL: listener `{...d.data()} as BankAccount`
 *           (~807) hiçbir alanı doğrulamıyor; DB'den null gelen tek hesap toplamı NaN yapıp KPI'ya "₺NaN"
 *           düşürüyor, sayısal string gelirse "0"+"2500" dizesi yapıştırıyordu; kart neden vermiyordu
 *   1108  amount:  Math.abs(Number(r.Tutar ?? r.amount ?? 0))
 *   1109  type:    Number(r.Tutar ?? r.amount ?? 0) >= 0 ? 'credit' : 'debit'
 *   1110  balance: Number(r.BakiyeSonrasi ?? r.balance ?? 0)
 *         → tutarı bilinmeyen Mikro satırı "₺0 alacak" olarak bankTransactions'a YAZILIYOR (sonsuza dek
 *           bir hareket gibi listeleniyor, dedup anahtarı reference_date olduğu için de bir daha
 *           düzelmiyor); bakiyesi bilinmeyen satır "bakiye ₺0" ile yazılıyor; toast "N yeni hareket"
 *           diyordu. NaN'lı ham değer (`Number('1.500,00')`) `NaN >= 0` ile 'debit' + amount NaN yazıyordu.
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`Tutar.bilinmeyen`); ekran `ekranTutari` ile kısmi
 * toplamı basar ve "N hesap tutarsız" notu düşer, hiç bilinen yoksa '—'. Mikro satırında TUTAR bilinmiyorsa
 * satır YAZILMAZ (null) ve sayılır — toast "N satır atlandı" der; BAKİYE bilinmiyorsa satır bakiyesiz
 * yazılır (`balance` anahtarı hiç konmaz; BankTransaction.balance bu yüzden opsiyonel oldu, ekran '—').
 *
 * Sayfa paritesi: hepsi bilinenken sayılar eski reduce ile AYNI; `currency === 'TRY'` süzgeci aynen
 * (büyük/küçük harf, tanınmayan kod hiçbir kovaya girmez); pozitif → 'credit', `>= 0` sınırı aynen;
 * `Tarih` yoksa `bugun` (çağıran `bugunAnahtari()` verir — eski `format(new Date(),'yyyy-MM-dd')`);
 * `DovizKodu` yoksa 'TRY' aynen. Bilinçli farklar: (1) tanınmayan döviz kodu ('GBP') artık `as` ile
 * 'TRY'|'USD'|'EUR' tipine YALAN söylenerek yazılmıyor → null, sayılır; (2) sayısal string bakiye
 * (`'2500'`) `bilinenSayi` sözleşmesiyle sayı sayılır. Dedup (reference_date) çağıranda kaldı, dokunulmadı.
 *
 * Girdi tipleri MİNİMAL ve yapısal (BankAccount/BankTransaction'a bağlı DEĞİL); dönüş `MikroBankaHareketi`
 * `Omit<BankTransaction,'id'>`e atanabilir (test derleme zamanında kanıtlar) — çağıran `createdAt` ekleyip
 * doğrudan addDoc eder.
 */
import { bilinenSayi, toplaBilinen, type Tutar } from '../para';

// ── KPI: birim bazlı bakiye toplamları ─────────────────────────────────────────────────────────

/** Sekmenin tanıdığı para birimleri — BankAccount.currency ile aynı üçlü. */
export type BankaBirimi = 'TRY' | 'USD' | 'EUR';
export const BANKA_BIRIMLERI: readonly BankaBirimi[] = ['TRY', 'USD', 'EUR'];

/** Sayfanın `bankAccounts` kaydından bu hesabın okuduğu alanlar — BankAccount tipine bağımlı değil. */
export interface BakiyeliHesap { currency?: unknown; balance?: unknown }

/**
 * Her birim için bilinen bakiye toplamı + bilinen/bilinmeyen sayaçları. Ekran: `ekranTutari(b.TRY)` →
 * paraYaz; `b.TRY.bilinmeyen > 0` ise kart altına "N hesap tutarsız" notu. Boş liste gerçek 0.
 */
export function dovizBakiyeleri(hesaplar: readonly BakiyeliHesap[]): Record<BankaBirimi, Tutar> {
  const birimde = (b: BankaBirimi): Tutar => toplaBilinen(hesaplar.filter(h => h.currency === b), h => h.balance);
  return { TRY: birimde('TRY'), USD: birimde('USD'), EUR: birimde('EUR') };
}

// ── "Şimdi Çek": Mikro banka hareketi satırı → BankTransaction ─────────────────────────────────

/** Mikro satırından üretilen kayıt — `Omit<BankTransaction,'id'>`e atanabilir; `balance` bilinmiyorsa anahtar YOK. */
export interface MikroBankaHareketi {
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  balance?: number;
  currency: BankaBirimi;
  reference: string;
  source: 'mikro';
}

export interface HareketSecenek {
  /** 'YYYY-MM-DD' — satırda `Tarih`/`date` yoksa kullanılır (sayfa paritesi; `bugunAnahtari()`). */
  bugun: string;
}

/** Satır neden yazılamadı: tutarı bilinmiyor (ya da satır nesne değil) / döviz kodu tanınmadı. */
export type HareketAtlamaNedeni = 'tutar' | 'birim';

const metin = (x: unknown): string => String(x ?? '');

/** 'TRY'|'USD'|'EUR' ise kendisi; yoksa (null/undefined) 'TRY' (sayfa paritesi); başka bir şeyse null. */
function birimOku(x: unknown): BankaBirimi | null {
  if (x === null || x === undefined) return 'TRY';
  return (BANKA_BIRIMLERI as readonly unknown[]).includes(x) ? (x as BankaBirimi) : null;
}

/**
 * Tek Mikro satırını okur; yazılamıyorsa NEDENİYLE döner (toast "N satır atlandı: tutar/birim" diyebilsin).
 * Alan yedekleri sayfadakiyle aynı sırada: HesapId→accountId, BankaAdi→bankName→HesapAdi,
 * Tarih→date→bugun, Aciklama→description→BelgeNo, Tutar→amount, BakiyeSonrasi→balance,
 * DovizKodu→currency→'TRY', BelgeNo→reference.
 */
export function hareketNedenleOku(row: unknown, s: HareketSecenek): { kayit: MikroBankaHareketi } | { neden: HareketAtlamaNedeni } {
  if (typeof row !== 'object' || row === null) return { neden: 'tutar' };
  const r = row as Readonly<Record<string, unknown>>;

  const hamTutar = r.Tutar ?? r.amount;
  if (!bilinenSayi(hamTutar)) return { neden: 'tutar' }; // eski: `?? 0` → ₺0 alacak yazılıyordu
  const tutar = Number(hamTutar);

  const birim = birimOku(r.DovizKodu ?? r.currency);
  if (birim === null) return { neden: 'birim' }; // eski: `as 'TRY'|'USD'|'EUR'` tip yalanıyla yazılıyordu

  const hamBakiye = r.BakiyeSonrasi ?? r.balance;
  const bakiye = bilinenSayi(hamBakiye) ? { balance: Number(hamBakiye) } : {}; // eski: `?? 0` → bakiye ₺0

  return {
    kayit: {
      accountId: metin(r.HesapId ?? r.accountId),
      accountName: metin(r.BankaAdi ?? r.bankName ?? r.HesapAdi),
      date: metin(r.Tarih ?? r.date ?? s.bugun),
      description: metin(r.Aciklama ?? r.description ?? r.BelgeNo),
      amount: Math.abs(tutar),
      type: tutar >= 0 ? 'credit' : 'debit',
      ...bakiye,
      currency: birim,
      reference: metin(r.BelgeNo ?? r.reference),
      source: 'mikro',
    },
  };
}

/** Tek satır → kayıt; yazılamıyorsa null (tutar bilinmiyor / döviz kodu tanınmadı / satır nesne değil). */
export function mikroBankaHareketiOku(row: unknown, s: HareketSecenek): MikroBankaHareketi | null {
  const r = hareketNedenleOku(row, s);
  return 'kayit' in r ? r.kayit : null;
}

export interface AyiklamaSonucu {
  /** Yazılabilen kayıtlar, satır sırasıyla (dedup çağıranda: reference_date). */
  kayitlar: MikroBankaHareketi[];
  /** Yazılmayan satır sayısı = tutarsiz + birimsiz. */
  atlanan: number;
  /** Tutarı bilinmeyen (ya da nesne olmayan) satır. */
  tutarsiz: number;
  /** Döviz kodu tanınmayan satır. */
  birimsiz: number;
  /** YAZILAN ama bakiyesi bilinmeyen satır (bilgi; ekran o hücrede '—'). */
  bakiyesiz: number;
}

/** Mikro yanıt listesini ayıklar: yazılabilenler + atlama sayaçları (toast metni için). */
export function hareketleriAyikla(rows: readonly unknown[], s: HareketSecenek): AyiklamaSonucu {
  const sonuc: AyiklamaSonucu = { kayitlar: [], atlanan: 0, tutarsiz: 0, birimsiz: 0, bakiyesiz: 0 };
  for (const row of rows) {
    const r = hareketNedenleOku(row, s);
    if ('neden' in r) {
      sonuc.atlanan++;
      if (r.neden === 'tutar') sonuc.tutarsiz++; else sonuc.birimsiz++;
      continue;
    }
    if (!('balance' in r.kayit)) sonuc.bakiyesiz++;
    sonuc.kayitlar.push(r.kayit);
  }
  return sonuc;
}
