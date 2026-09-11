/**
 * leadBirlestir.ts — mükerrer lead'leri gruplar ve birleştirme yaması üretir (2026-09-05). SAF.
 *
 * Arka plan: cari import'u Türkçe unvanı ('ŞİRİN YAPI') elle açılmış lead'le ('Şirin Yapı')
 * eşleştiremediği için (bkz. isimAnahtari.ts) her koşuda yeni lead açtı; kopyalar `leads`te
 * duruyor. I/O `scripts/lead-birlestir.ts`te; sözleşme leadBirlestir.test.ts'te.
 *
 * Güvenlik ilkeleri: farklı kiracı ASLA birleşmez; grupta farklı Mikro cari kodu ya da farklı
 * VKN varsa (şubeler, ad benzerliği) birleştirme YAPILMAZ — çelişki raporlanır; kalanın dolu
 * alanı ezilmez; silinen kayıt kalanın `birlestirilen` izinde tutulur (script ayrıca JSON yedek alır).
 */
import { isimAnahtari, firmaAnahtari } from './isimAnahtari';
import { zamanMs } from '../utils/zaman';

export interface LeadKaydi { id: string; data: Record<string, unknown> }
export type BaglantiTuru = 'mikroCariKod' | 'vkn' | 'isim';
export interface MukerrerGrubu {
  uyeler: LeadKaydi[];
  /** Grubu bağlayan anahtar türleri (en az iki üyenin paylaştığı). */
  baglantilar: BaglantiTuru[];
  /** Dolu ise BİRLEŞTİRME YAPILMAZ — sebep metni. */
  celiski: string | null;
  kalan: LeadKaydi;
  silinecek: LeadKaydi[];
  yama: Record<string, unknown>;
}

export const MIKRO_KAYNAKLAR: ReadonlySet<string> = new Set(['mikro_import', 'mikro_cron', 'mikro_sql']);
const bos = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const kaynak = (l: LeadKaydi): string => String(l.data.source ?? '');
const mikroKaynakli = (l: LeadKaydi): boolean => MIKRO_KAYNAKLAR.has(kaynak(l));

/** VKN/TCKN anahtarı: yalnız rakamlar, en az 10 hane; YER TUTUCU ('11111111111', '0000000000' — nihai tüketici
 *  varsayılanı) anahtar ÜRETMEZ: aksi halde tüm perakende müşterileri tek grupta birleşirdi (inceleme). */
export function vknAnahtari(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length < 10) return '';
  if (/^(\d)\1+$/.test(d)) return '';
  return d;
}

// İsim anahtarı FİRMA üzerinden (`firmaAnahtari`, isimAnahtari.ts): elle lead'de `name` yetkili kişi adıdır — inceleme, KRİTİK.

function anahtarlar(l: LeadKaydi): Array<[BaglantiTuru, string]> {
  const cid = String(l.data.companyId ?? '');
  const out: Array<[BaglantiTuru, string]> = [];
  const kod = String(l.data.mikroCariKod ?? '').trim();
  if (kod) out.push(['mikroCariKod', `${cid}|kod|${kod}`]);
  const vkn = vknAnahtari(l.data.taxId ?? l.data.taxNo);
  if (vkn) out.push(['vkn', `${cid}|vkn|${vkn}`]);
  const ad = firmaAnahtari(l.data);
  if (ad) out.push(['isim', `${cid}|ad|${ad}`]);
  return out;
}

/** CRM izi: kullanıcının bu kayda dokunduğunun kanıtı (aktivite, temsilci, takip tarihi, not, puan, ses notu).
 *  `source` alanına GÜVENİLMEZ: cari import'u 2026-09-05'e kadar güncellemede source'u 'mikro_import' ile eziyordu —
 *  elle açılmış, geçmişi olan bir lead "Mikro kopyası" görünür ve silinebilirdi. İz taşıyan kayıt ASLA kopya sayılmaz. */
export function crmIziVar(l: LeadKaydi): boolean {
  const d = l.data;
  return (Array.isArray(d.activities) && d.activities.length > 0)
    || (Array.isArray(d.voiceNotes) && d.voiceNotes.length > 0)
    || !bos(d.assignedTo) || !bos(d.nextFollowUpDate) || !bos(d.notes)
    || (typeof d.score === 'number' && d.score > 0);
}

/** Kalan kayıt: CRM izi taşıyan önce; sonra elle açılan (Mikro kaynaklı olmayan); sonra en eski createdAt; tarihi bilinmeyen sona; son çare id. */
export function kalanSec(uyeler: LeadKaydi[]): LeadKaydi {
  return [...uyeler].sort((a, b) => {
    const ia = crmIziVar(a) ? 0 : 1, ib = crmIziVar(b) ? 0 : 1;
    if (ia !== ib) return ia - ib;
    const ma = mikroKaynakli(a) ? 1 : 0, mb = mikroKaynakli(b) ? 1 : 0;
    if (ma !== mb) return ma - mb;
    const ta = zamanMs(a.data.createdAt), tb = zamanMs(b.data.createdAt);
    if (ta !== tb) { if (ta === null) return 1; if (tb === null) return -1; return ta - tb; }
    return a.id.localeCompare(b.id);
  })[0];
}

/** Kalanın BOŞ olduğu, kopyadan doldurulacak alanlar (ad/unvan/status/assignedTo/score BİLEREK yok — kalanınki kalır). */
const DOLDUR = ['mikroCariKod', 'taxId', 'taxOffice', 'email', 'phone', 'address', 'authorizedContact', 'sector',
  'customerType', 'type', 'eFaturaKayitli', 'mikroSynced', 'mikroSyncedAt', 'priceTier', 'paymentTerms', 'creditLimit'] as const;

const idIleBirlestir = (a: unknown, b: unknown): unknown[] => {
  const out: unknown[] = []; const gorulen = new Set<string>();
  for (const x of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const k = String((x as { id?: unknown })?.id ?? JSON.stringify(x));
    if (gorulen.has(k)) continue; gorulen.add(k); out.push(x);
  }
  return out;
};

export function birlestirmeYamasi(kalan: LeadKaydi, kopyalar: LeadKaydi[], simdiMs: number): Record<string, unknown> {
  const yama: Record<string, unknown> = {};
  // Mikro alanları için Mikro kaynaklı kopya önce gelsin (mikroCariKod/VKN oradan daha güvenilir).
  const sirali = [...kopyalar].sort((a, b) => (mikroKaynakli(b) ? 1 : 0) - (mikroKaynakli(a) ? 1 : 0));
  for (const alan of DOLDUR) {
    if (!bos(kalan.data[alan])) continue;
    const kaynakKopya = sirali.find(k => !bos(k.data[alan]));
    if (kaynakKopya) yama[alan] = kaynakKopya.data[alan];
  }
  let activities = kalan.data.activities, voiceNotes = kalan.data.voiceNotes, degisti = false, sesDegisti = false;
  for (const k of sirali) {
    if (Array.isArray(k.data.activities) && k.data.activities.length) { const y = idIleBirlestir(activities, k.data.activities); if (y.length !== (Array.isArray(activities) ? activities.length : 0)) { activities = y; degisti = true; } }
    if (Array.isArray(k.data.voiceNotes) && k.data.voiceNotes.length) { const y = idIleBirlestir(voiceNotes, k.data.voiceNotes); if (y.length !== (Array.isArray(voiceNotes) ? voiceNotes.length : 0)) { voiceNotes = y; sesDegisti = true; } }
  }
  if (degisti) yama.activities = activities;
  if (sesDegisti) yama.voiceNotes = voiceNotes;
  let notlar = String(kalan.data.notes ?? '').trim(); let notDegisti = false;
  for (const k of sirali) {
    const n = String(k.data.notes ?? '').trim();
    if (n && !notlar.includes(n)) { notlar = notlar ? `${notlar}\n---\n${n}` : n; notDegisti = true; }
  }
  if (notDegisti) yama.notes = notlar;
  yama.birlestirilen = [
    ...(Array.isArray(kalan.data.birlestirilen) ? kalan.data.birlestirilen : []),
    ...kopyalar.map(k => ({ id: k.id, source: kaynak(k), name: String(k.data.name ?? k.data.company ?? ''), tarih: new Date(simdiMs).toISOString() })),
  ];
  yama.updatedAt = { _seconds: Math.floor(simdiMs / 1000), _nanoseconds: 0 };   // pgReviveTimestamps şekli
  return yama;
}

export interface GruplamaSecenek {
  /** true: elle açılan (Mikro kaynaklı olmayan) kopyalar da silinir. Varsayılan false — import arızasının ürettiği
   *  kopyalar Mikro kaynaklıdır; elle↔elle birleştirme CRM geçmişi (status/assignedTo/takip) kaybettirebilir. */
  elleDe?: boolean;
}

/** Aynı kiracı içinde anahtar paylaşan lead'leri geçişli olarak gruplar (union-find); tekil kayıt grup üretmez. */
export function mukerrerGruplari(leads: LeadKaydi[], simdiMs: number, secenek: GruplamaSecenek = {}): MukerrerGrubu[] {
  const ebeveyn = leads.map((_, i) => i);
  const bul = (i: number): number => (ebeveyn[i] === i ? i : (ebeveyn[i] = bul(ebeveyn[i])));
  const birles = (a: number, b: number) => { const ra = bul(a), rb = bul(b); if (ra !== rb) ebeveyn[rb] = ra; };
  const anahtarSahibi = new Map<string, number>();
  const leadAnahtarlari = leads.map(anahtarlar);
  leadAnahtarlari.forEach((ks, i) => { for (const [, k] of ks) { const j = anahtarSahibi.get(k); if (j === undefined) anahtarSahibi.set(k, i); else birles(i, j); } });
  const gruplar = new Map<number, number[]>();
  leads.forEach((_, i) => { const r = bul(i); if (!gruplar.has(r)) gruplar.set(r, []); gruplar.get(r)?.push(i); });
  const out: MukerrerGrubu[] = [];
  for (const idx of gruplar.values()) {
    if (idx.length < 2) continue;
    const uyeler = idx.map(i => leads[i]);
    const sayac = new Map<string, { tur: BaglantiTuru; n: number }>();
    idx.forEach(i => { for (const [tur, k] of leadAnahtarlari[i]) { const s = sayac.get(k) ?? { tur, n: 0 }; s.n++; sayac.set(k, s); } });
    const baglantilar = [...new Set([...sayac.values()].filter(s => s.n >= 2).map(s => s.tur))];
    const kodlar = new Set(uyeler.map(u => String(u.data.mikroCariKod ?? '').trim()).filter(Boolean));
    const vknler = new Set(uyeler.map(u => vknAnahtari(u.data.taxId ?? u.data.taxNo)).filter(Boolean));
    // Firma adı DOLU olan üyeler arasında farklı firma → çelişki (VKN/kod eşleşse bile birleştirme kararı insana kalır).
    const firmalar = new Set(uyeler.map(u => (bos(u.data.company) ? '' : isimAnahtari(u.data.company))).filter(Boolean));
    const kalan = kalanSec(uyeler);
    const kopyalar = uyeler.filter(u => u.id !== kalan.id);
    const celiski = kodlar.size > 1 ? `farklı Mikro cari kodu: ${[...kodlar].join(', ')}`
      : vknler.size > 1 ? `farklı VKN: ${[...vknler].join(', ')}`
      : firmalar.size > 1 ? `farklı firma adı: ${[...firmalar].join(' | ')}`
      : (!secenek.elleDe && kopyalar.some(k => !mikroKaynakli(k))) ? 'elle açılan kopya (ELLE_DE=1 ile birleşir)'
      : (!secenek.elleDe && kopyalar.some(crmIziVar)) ? 'kopyada CRM izi var — aktivite/not/temsilci (ELLE_DE=1 ile birleşir, iz yamaya taşınır)'
      : null;
    const silinecek = celiski ? [] : kopyalar;
    out.push({ uyeler, baglantilar, celiski, kalan, silinecek, yama: celiski ? {} : birlestirmeYamasi(kalan, silinecek, simdiMs) });
  }
  return out;
}
