/**
 * mizan.ts — AccountingModule Mizan + Yevmiye HESAPLARI, tek kaynak (Faz 3 2/n, 2026-09-14).
 * Test: mizan.test.ts (ÖNCE yazıldı).
 *
 *   • Muhasebe › Mizan  (MizanTab: KPI kartları, hesap tablosu, toplam satırı, "Dengeli" rozeti)
 *   • Muhasebe › Yevmiye (YevmiyeTab: fiş kaydet/düzenle, KDV oranı sütunu, CSV)
 *
 * NEDEN VAR — sahte kesinlik siteleri (CLAUDE.md: sayısal alanda `|| 0` / `?? 0` YASAK), AccountingModule.tsx 2026-09-14:
 *   1673-1681 mikroMizanSatirlari  `if (f.matrah)` / `if (f.kdv)`   bilinmeyen matrah/KDV sessizce satır üretmiyor, SAYILMIYORDU
 *   1683-1694 mizanMap/mizanRows    `+= e.borc`                     DB'den null gelen borç/alacak 0 gibi toplanıyordu
 *   1697      mizan sıralama        `(a[key] || 0) - (b[key] || 0)` bilinmeyen ₺0 gibi ortaya diziliyordu (→ para.ts `sayiSirala`)
 *   1701-1705 mizanTotals/dengeli   bilinmeyen içeren mizana "Dengeli" rozeti veriliyordu
 *   1143-1144 saveJournal           `Number(x) || 0`                boş/geçersiz tutar 0 sayılıp "sıfırdan büyük olmalı"yla karışıyordu
 *   1191      openEditJournal       `kdvOran ?? 0`                  bilinmeyen oran forma %0 olarak dolduruluyordu
 *   YevmiyeTab 74 / 201             CSV `kdvOran ?? 0`, ekran `%{kdvOran ?? 0}` → "%0"
 *
 * Kural: bilinmeyen tutar toplama GİRMEZ, SAYILIR (`Tutar.bilinmeyen`); ekran `ekranTutari` ile '—' basar ve
 * "N kayıt tutarsız" notu düşer. Bakiye (borç − alacak) TÜRETMEdir: hesabın bir tarafında bir kayıt bile
 * bilinmiyorsa NaN (`tamTutar`). Denge: bir taraf bilinmeyen içeriyorsa null — ne "Dengeli" ne "Dengesiz" rozeti.
 *
 * SAYFA PARİTESİ (bilinen girdide sayı DEĞİŞMEZ): hesap planı adları ve borç/alacak yönü birebir; satır sırası
 * ilk görülme sırası (eski `Object.entries(mizanMap)`); bilinen 0 matrah/KDV satır üretmez ama sayılmaz (eski
 * truthy süzgeç); 0.01 kuruş toleransı; boş mizan "dengeli" (hareketsiz dönem gerçek 0).
 * BİLİNÇLİ FARK: matrahı bilinen ama KDV'si bilinmeyen Mikro faturası artık BÜTÜNÜYLE dışarıda ve sayılır —
 * yarım fiş (yalnız 120/600) 120-Alıcılar'ı KDV kadar sessizce eksik gösterirdi.
 *
 * Girdi tipleri MİNİMAL ve yapısal (`JournalEntry` / `MikroFatura`ya bağlı DEĞİL): `borc/alacak/matrah/kdv: unknown` —
 * DB'den null, formdan string gelebilir; tip "number" demek dolu demek değildir.
 */
import { bilinenSayi, toplaBilinen, tutarBirlestir, tamTutar, type Tutar } from '../para';

/** para.ts `Tutar` — ekran köprüsü `ekranTutari` de para.ts'te (tek sözleşme). */
export type { Tutar };

// ── Mikro fatura → çift taraflı satır sentezi (AccountingModule 1655-1681'den taşındı) ────────────────────

/**
 * Mizan'a giren Mikro faturası — yapısal. `yon` hook'ta (useMikroFaturalar) cha_tip'ten kesin çözülür;
 * matrah/kdv ise Faz 3 2/n'e (2026-09-18) kadar sunucuda ISNULL(…, 0) ile sıfıra zorlanıyordu. O yedek
 * kalktı: okunamayan matrah/kdv buraya NaN gelir ve fatura SAYILIR (toplama girmez).
 */
export interface MizanFaturasi { yon: 'gelen' | 'giden'; matrah?: unknown; kdv?: unknown }

/** Mizan'ın tek satır girdisi — yevmiye kaydı (DB'den, tutarlar null olabilir) ya da Mikro sentezi. */
export interface MizanGirdisi { debitHesap: string; alacakHesap: string; borc: unknown; alacak: unknown }

/** Mikro sentezinin ürettiği satır: tutarları HER ZAMAN bilinen (bilinmeyen fatura satır üretmez). */
export interface MizanSentezSatiri { debitHesap: string; alacakHesap: string; borc: number; alacak: number }

/** Standart Türk hesap planı — sentezde kullanılan hesap adları (sayfa paritesi: birebir). */
export const MIKRO_HESAP = {
  alicilar: '120 - Alıcılar',
  satislar: '600 - Yurt İçi Satışlar',
  hesaplananKdv: '391 - Hesaplanan KDV',
  ticariMallar: '153 - Ticari Mallar',
  indirilecekKdv: '191 - İndirilecek KDV',
  saticilar: '320 - Satıcılar',
} as const;

/**
 * journalEntries (Cetpa) bu Mikro-ağırlıklı caride boş kalıyordu (2026-08-13
 * code review bulgusu: Mizan hâlâ yalnız journalEntries okuyordu, KDV/Satışlar'a
 * yapılan Mikro-additive düzeltme buraya hiç uygulanmamıştı). mikroFaturalar'dan
 * GERÇEK çift-taraflı (double-entry) satırlar sentezlenir — tahmini bir toplam
 * değil, standart Türk hesap planına göre borç/alacak ayrımı:
 *  giden (satış):  120-Alıcılar borç = tutar  ↔  600-Satışlar alacak = matrah + 391-Hesaplanan KDV alacak = kdv
 *  gelen (alış):   153-Ticari Mallar borç = matrah + 191-İndirilecek KDV borç = kdv  ↔  320-Satıcılar alacak = tutar
 * Alış, GİDER değil VARLIK (stok) hesabına (153) düşer — satır maliyeti bilinmediği
 * için COGS'a (620) atanamaz; bu ayrım Finansal Oranlar'daki "COGS bilinmiyor"
 * ilkesiyle tutarlı, yanlış bir gider rakamı üretmez.
 *
 * Matrahı YA DA KDV'si bilinmeyen fatura satır üretmez ve `bilinmeyen` sayılır (sayfa "N Mikro faturası
 * mizana alınamadı" notu düşer). Bilinen 0 → satır yok, sayılmaz (istisna/KDV'siz fatura gerçek sıfırdır).
 */
export function mikroMizanSatirlari(faturalar: readonly MizanFaturasi[]): { satirlar: MizanSentezSatiri[]; bilinmeyen: number } {
  const satirlar: MizanSentezSatiri[] = [];
  let bilinmeyen = 0;
  for (const f of faturalar) {
    if (!bilinenSayi(f.matrah) || !bilinenSayi(f.kdv)) { bilinmeyen++; continue; }
    const matrah = Number(f.matrah), kdv = Number(f.kdv);
    if (f.yon === 'giden') {
      if (matrah !== 0) satirlar.push({ debitHesap: MIKRO_HESAP.alicilar, alacakHesap: MIKRO_HESAP.satislar, borc: matrah, alacak: matrah });
      if (kdv !== 0)    satirlar.push({ debitHesap: MIKRO_HESAP.alicilar, alacakHesap: MIKRO_HESAP.hesaplananKdv, borc: kdv, alacak: kdv });
    } else {
      if (matrah !== 0) satirlar.push({ debitHesap: MIKRO_HESAP.ticariMallar, alacakHesap: MIKRO_HESAP.saticilar, borc: matrah, alacak: matrah });
      if (kdv !== 0)    satirlar.push({ debitHesap: MIKRO_HESAP.indirilecekKdv, alacakHesap: MIKRO_HESAP.saticilar, borc: kdv, alacak: kdv });
    }
  }
  return { satirlar, bilinmeyen };
}

// ── Mizan (AccountingModule 1683-1705'ten taşındı) ───────────────────────────────────────────────────────

export interface MizanSatiri {
  hesap: string;
  /** Hesabın borç tarafına düşen kayıtların toplamı — ekran `ekranTutari` ile basar. */
  borc: Tutar;
  alacak: Tutar;
  /** max(0, borç − alacak) — TÜRETME: hesabın bir tarafında bilinmeyen varsa NaN ('—'). */
  borcBakiye: number;
  alacakBakiye: number;
}

export interface MizanSonucu {
  /** İlk görülme sırasında (eski `Object.entries(mizanMap)` paritesi); sıralama sayfada (`sayiSirala`). */
  satirlar: MizanSatiri[];
  /** Toplam satırı / KPI kartları. Bakiye toplamlarında `bilinmeyen` = bakiyesi türetilemeyen HESAP sayısı. */
  toplam: { borc: Tutar; alacak: Tutar; borcBakiye: Tutar; alacakBakiye: Tutar };
  /** |Σborç − Σalacak| < 0.01; bir taraf bilinmeyen içeriyorsa null — rozet verilmez. Boş mizan true. */
  dengeli: boolean | null;
  /** Borç YA DA alacak tutarı bilinmeyen KAYIT sayısı (kayıt bir kez sayılır) — "N kayıt tutarsız" notu. */
  bilinmeyen: number;
}

/** Bakiye türetmesi: iki taraf da tam biliniyorsa max(0, fark), yoksa NaN. */
function bakiye(bu: Tutar, karsi: Tutar): number {
  const b = tamTutar(bu), k = tamTutar(karsi);
  return Number.isFinite(b) && Number.isFinite(k) ? Math.max(0, b - k) : NaN;
}

/**
 * Hesap bazında borç/alacak toplamı, bakiye ve denge. Girdi: yevmiye kayıtları + Mikro sentez satırları
 * (`mikroMizanSatirlari(...).satirlar`) aynı havuzda toplanır. Her kayıt HER İKİ hesabı da listeye ekler
 * (yalnız alacak tarafında geçen hesap 0 borçla görünür — parite).
 */
export function mizanHesapla(journalEntries: readonly MizanGirdisi[], mikroSatirlari: readonly MizanGirdisi[] = []): MizanSonucu {
  const havuz = new Map<string, { borc: unknown[]; alacak: unknown[] }>();
  const hesapAl = (hesap: string) => {
    let h = havuz.get(hesap);
    if (!h) { h = { borc: [], alacak: [] }; havuz.set(hesap, h); }
    return h;
  };
  let bilinmeyen = 0;
  for (const e of [...journalEntries, ...mikroSatirlari]) {
    const borcH = hesapAl(e.debitHesap);
    const alacakH = hesapAl(e.alacakHesap);
    borcH.borc.push(e.borc);
    alacakH.alacak.push(e.alacak);
    if (!bilinenSayi(e.borc) || !bilinenSayi(e.alacak)) bilinmeyen++;
  }
  const satirlar: MizanSatiri[] = [];
  for (const [hesap, h] of havuz) {
    const borc = toplaBilinen(h.borc, x => x);
    const alacak = toplaBilinen(h.alacak, x => x);
    satirlar.push({ hesap, borc, alacak, borcBakiye: bakiye(borc, alacak), alacakBakiye: bakiye(alacak, borc) });
  }
  const toplam = {
    borc: tutarBirlestir(...satirlar.map(r => r.borc)),
    alacak: tutarBirlestir(...satirlar.map(r => r.alacak)),
    borcBakiye: toplaBilinen(satirlar, r => r.borcBakiye),
    alacakBakiye: toplaBilinen(satirlar, r => r.alacakBakiye),
  };
  const dengeli = toplam.borc.bilinmeyen > 0 || toplam.alacak.bilinmeyen > 0
    ? null
    : Math.abs(toplam.borc.toplam - toplam.alacak.toplam) < 0.01;
  return { satirlar, toplam, dengeli, bilinmeyen };
}

// ── Yevmiye formu (AccountingModule 1139-1146 saveJournal'dan taşındı) ───────────────────────────────────

/** Form tutarı: sayı ya da sayısal string → Number; boş/geçersiz → NaN (eski `Number(x) || 0` 0 sayıyordu). */
export function fisTutariOku(metin: unknown): number {
  return bilinenSayi(metin) ? Number(metin) : NaN;
}

export type FisDogrulama =
  | { hata: 'bilinmiyor' }
  | { hata: 'pozitifDegil' }
  | { hata: 'dengesiz'; borc: number; alacak: number }
  | { hata: null; borc: number; alacak: number };

/**
 * Çift taraflı kayıt dengesi: borç == alacak (kuruş toleransı) ve pozitif.
 * Sıra: bilinmeyen → pozitif değil → dengesiz. Bilinmeyen tutar "sıfırdan büyük olmalı" mesajına
 * saklanmaz — kullanıcı boş alanla sıfırı ayırt edebilsin.
 */
export function fisDogrula(borcMetin: unknown, alacakMetin: unknown): FisDogrulama {
  const borc = fisTutariOku(borcMetin), alacak = fisTutariOku(alacakMetin);
  if (!Number.isFinite(borc) || !Number.isFinite(alacak)) return { hata: 'bilinmiyor' };
  if (borc <= 0 || alacak <= 0) return { hata: 'pozitifDegil' };
  if (Math.abs(borc - alacak) > 0.01) return { hata: 'dengesiz', borc, alacak };
  return { hata: null, borc, alacak };
}

/** KDV oranı metni (ekran rozeti / CSV): bilinen → '%20'; bilinmeyen → '—' (eski `?? 0` '%0' basıyordu). */
export function kdvOranYaz(oran: unknown): string {
  return bilinenSayi(oran) ? `%${Number(oran)}` : '—';
}
