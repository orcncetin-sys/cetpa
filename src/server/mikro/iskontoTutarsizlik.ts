/**
 * iskontoTutarsizlik.ts — "Mikro'da iskonto brüte bir kez daha eklenmiş" faturaların TÜM GEÇMİŞ raporu (2026-09-28).
 *
 * NEDEN VAR — kullanıcı: "başka böyle bir kayıt var mı bana bilgi ver". Evrak 420 (SİZGEN, e-fatura 202.419) Mikro'da
 * 317.236,50 duruyordu: satır tutarı e-fatura brütü + Σiskonto yazılmış, cari borç ve stok maliyeti iskonto kadar şişik.
 * Cetpa'nın stok hareketi aynası yalnız son ~90 günü tutar (gecePenceresi), dolayısıyla Fiyat Karşılaştırma'daki
 * "Mikro'da düzeltilecek" listesi eski faturaları GÖREMEZ. Bu rapor Mikro'nun kendi tablolarından (SqlVeriOkuV2) okunan
 * satır + başlıklarla AYNI kuralı (lib/stokFiyat.mikroTutarsizliklari — çift iskonto imzası + başlık onayı) uygular;
 * kopya kural YAZILMAZ.
 *
 * Girdi: iskontolu satırı olan faturaların TÜM satırları (başlık hakemi evrakın bütün satırlarını ister — yalnız iskontolu
 * satırlar verilirse iskontosuz kalemi olan faturada hedef yanlış hesaplanır) ve bu faturaların başlıkları.
 * Çıktı fatura bazında: Mikro toplamı, e-faturayla tutarlı (KDV ile sağlanan) toplam, fazla, satırlar. Cetpa Mikro'ya
 * YAZMAZ; düzeltme kullanıcının Mikro'da yapacağı iştir.
 */
import { faturaToplamlari, mikroTutarsizliklari, faturaAnahtari, type MikroTutarsizligi, type StokHareketi } from '../../lib/stokFiyat.js';

export interface TutarsizFatura {
  yon: 'gelen' | 'giden';
  seri: string;
  sira: string;
  /** Başlık tarihi (YYYY-AA-GG); başlık yoksa satırın tarihi; o da yoksa null. */
  tarih: string | null;
  /** Mikro cari kodu (başlıktan). */
  cariKod: string | null;
  /** Mikro'daki fatura toplamı (cha_meblag). */
  mikroToplam: number;
  /** KDV ile tutarlı toplam = mikroToplam − fazla (e-faturanın toplamı olmalı). YALNIZ `kesin` iken; faturada hüküm
   *  verilemeyen başka satır varsa null — o satırın fazlası da düşülmemiş olabilir, rakam "e-fatura toplamı" diye SUNULMAZ
   *  (tur 1, 2026-09-28: iki çift iskontolu satırdan biri aralık korumasına takılınca 3.120 yerine 3.220 veriliyordu). */
  dogruToplam: number | null;
  /** Faturadaki bütün satırlar hükme bağlanabildi (şüpheli satır yok). false iken `fazla` bir ALT SINIRDIR. */
  kesin: boolean;
  /** Faturada hüküm verilemeyen satır sayısı (çift iskonto okuması da mümkün / KDV'si pntr oranına uymuyor / KDV'siz iskontolu /
   *  çözülemeyen). Kullanıcı bu satırları e-faturayla karşılaştırmalı. */
  belirsizSatir: number;
  /** Mikro'nun fazladan eklediği (Σ bulgu satırı fazlası) — cari borç ve stok maliyeti EN AZ bu kadar fazla. */
  fazla: number;
  satirlar: MikroTutarsizligi[];
}
/** Bulgusu OLMAYAN ama hüküm verilemeyen satırı olan fatura (tur 2, 2026-09-28): kullanıcı e-faturayla karşılaştırmalı —
 *  "başka böyle kayıt var mı" sorusunun "bilinmiyor" kısmı. Bulgulu faturanın belirsiz satırı `TutarsizFatura.belirsizSatir`'dadır. */
export interface BelirsizFatura { yon: 'gelen' | 'giden'; seri: string; sira: string; belirsizSatir: number }
export interface IskontoTutarsizlikRaporu {
  faturalar: TutarsizFatura[];
  belirsizFaturalar: BelirsizFatura[];
  ozet: {
    /** Okunan satır ve fatura (iskontolu satırı olan faturalar). */
    incelenenSatir: number; incelenenFatura: number;
    tutarsizFatura: number; tutarsizSatir: number;
    /** Tutarsız faturalardan doğru toplamı KESİN OLMAYAN (şüpheli satır da içeren) sayısı. */
    kesinOlmayanFatura: number;
    /** Σ fazla (gelen ve giden ayrı: alışta borç, satışta alacak şişer). */
    fazlaGelen: number; fazlaGiden: number;
    /** Hüküm verilemeyen satırı OLAN ürün sayısı (imzalı ama başlığı onaylamayan / KDV'si bilinmeyen iskontolu / çift okuması
     *  ayırt edilemeyen / neti pntr oranıyla tutmayan satır) — ürünün başka faturasında bulgu olsa da (tur 2). */
    degerlendirilemeyenUrun: number;
    /** `belirsizFaturalar` sayısı (bulgusuz ama belirsiz satırlı fatura). */
    belirsizFatura: number;
  };
}

const tarihMetni = (t: unknown): string | null =>
  typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10)
    : t instanceof Date && Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
const anahtar = (yon: string, seri: unknown, sira: unknown) => `${yon}|${String(seri ?? '').trim()}|${String(sira ?? '').trim()}`;

export function iskontoTutarsizlikRaporu(
  satirlar: readonly StokHareketi[],
  basliklar: readonly Readonly<Record<string, unknown>>[],
): IskontoTutarsizlikRaporu {
  const toplamlar = faturaToplamlari(basliklar);
  const { satirlar: bulgular, belirsizUrunler, belirsizFaturalar } = mikroTutarsizliklari(satirlar, { faturaToplamlari: toplamlar });

  // Başlık bilgisi (tarih, cari) — faturaToplamlari'nın hakem olarak kabul ettiği başlıklar (iptal/belirsiz elenmiş).
  const baslikBilgisi = new Map<string, { tarih: string | null; cariKod: string | null }>();
  for (const b of basliklar) {
    const k = anahtar(Number(b.cha_tip) === 1 ? 'gelen' : 'giden', b.cha_evrakno_seri, b.cha_evrakno_sira);
    if (!toplamlar.has(k)) continue;
    const cari = String(b.cha_kod ?? '').trim();
    baslikBilgisi.set(k, { tarih: tarihMetni(b.cha_tarihi), cariKod: cari || null });
  }

  const faturalar = new Map<string, TutarsizFatura>();
  for (const s of bulgular) {
    if (!s.fatura) continue;                              // bulgu yalnız başlık onayıyla oluşur → fatura anahtarı hep var
    const k = anahtar(s.fatura.yon, s.fatura.seri, s.fatura.sira);
    const mikroToplam = toplamlar.get(k);
    if (mikroToplam === undefined) continue;
    let f = faturalar.get(k);
    if (!f) {
      const bilgi = baslikBilgisi.get(k);
      const belirsizSatir = belirsizFaturalar.get(k) ?? 0;
      f = { yon: s.fatura.yon, seri: s.fatura.seri, sira: s.fatura.sira, tarih: bilgi?.tarih ?? s.tarih, cariKod: bilgi?.cariKod ?? null,
        mikroToplam, dogruToplam: null, kesin: belirsizSatir === 0, belirsizSatir, fazla: 0, satirlar: [] };
      faturalar.set(k, f);
    }
    f.satirlar.push(s);
    f.fazla += s.fazla;
    f.dogruToplam = f.kesin ? f.mikroToplam - f.fazla : null;
  }

  // Bulgusuz ama belirsiz satırlı faturalar — eskiden yalnız bulgulu faturada okunuyordu, geri kalanı hiçbir alanda yoktu.
  // Anahtar biçimi lib/stokFiyat ile aynı: `yon|seri|sira` (seri ortada; '|' içerse de ilk/son parça yön/sıra).
  const belirsizListe: BelirsizFatura[] = [];
  for (const [k, n] of belirsizFaturalar) {
    if (faturalar.has(k)) continue;
    const p = k.split('|');
    const yon = p[0] === 'gelen' ? 'gelen' : p[0] === 'giden' ? 'giden' : null;
    if (!yon || p.length < 3) continue;
    belirsizListe.push({ yon, seri: p.slice(1, -1).join('|'), sira: p[p.length - 1], belirsizSatir: n });
  }
  belirsizListe.sort((a, b) => b.belirsizSatir - a.belirsizSatir || a.sira.localeCompare(b.sira, 'tr', { numeric: true }));

  const evraklar = new Set<string>();
  let incelenenSatir = 0;
  for (const h of satirlar) {
    incelenenSatir++;
    const fa = faturaAnahtari(h);
    if (fa) evraklar.add(anahtar(fa.yon, fa.seri, fa.sira));
  }
  const liste = [...faturalar.values()].sort((a, b) => b.fazla - a.fazla);
  const topla = (yon: 'gelen' | 'giden') => liste.filter(f => f.yon === yon).reduce((t, f) => t + f.fazla, 0);
  return {
    faturalar: liste,
    belirsizFaturalar: belirsizListe,
    ozet: {
      incelenenSatir, incelenenFatura: evraklar.size,
      tutarsizFatura: liste.length, tutarsizSatir: bulgular.length, kesinOlmayanFatura: liste.filter(f => !f.kesin).length,
      fazlaGelen: topla('gelen'), fazlaGiden: topla('giden'),
      degerlendirilemeyenUrun: belirsizUrunler.size, belirsizFatura: belirsizListe.length,
    },
  };
}

/** SQL için kolon listesi: şemada GERÇEKTEN var olan kolonlar (mikroKolonlar). Kolon adı TAHMİN EDİLMEZ — eksik temel
 *  kolon varsa rapor koşmaz, eksikler adıyla döner. */
export const TEMEL_SATIR_KOLONLARI = [
  'sth_evraktip', 'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_tarih', 'sth_stok_kod', 'sth_tip',
  'sth_miktar', 'sth_tutar', 'sth_vergi', 'sth_vergi_pntr', 'sth_iptal',
] as const;

export interface SatirKolonPlani { secim: string[]; iskonto: string[]; eksik: string[] }
export function satirKolonPlani(semaKolonlari: readonly string[]): SatirKolonPlani {
  const kucuk = new Map(semaKolonlari.map(k => [k.toLowerCase(), k]));
  const eksik = TEMEL_SATIR_KOLONLARI.filter(k => !kucuk.has(k));
  const iskonto = semaKolonlari.filter(k => /^sth_iskonto\d+$/i.test(k));
  const masraf = semaKolonlari.filter(k => /^sth_masraf\d+$/i.test(k));
  const secim = [...TEMEL_SATIR_KOLONLARI.filter(k => kucuk.has(k)).map(k => kucuk.get(k) as string), ...iskonto, ...masraf];
  return { secim, iskonto, eksik };
}
