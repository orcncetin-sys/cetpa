/**
 * sirTani.ts — "sır nerede düz metin duruyor?" ÖLÇÜMÜ (2026-10-02). Saf; DEĞER DÖNDÜRMEZ, yalnız sayar.
 *
 * NEDEN: denetim kaydının alan farkı (`computeFieldDiff`) 2026-10-02'ye kadar sırları MASKESİZ yazıyordu (`settings` denetlenen
 * koleksiyon; auditLog'u Admin ve Manager okur). Düzeltme yeni kayıtları maskeliyor; GEÇMİŞ kayıtlarda düz metin sır kalıp
 * kalmadığı ve kaç tane olduğu ölçülmeden temizlik kararı verilemez (auditLog append-only — değiştirmek kullanıcı kararı).
 * Bu modül o ölçümü ve (karar verilirse) temizlikte kullanılacak maskeli farkı üretir.
 */
import { farkDegeriMaskele, sirMaskele, MASKE } from '../lib/sirMaske.js';

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ayni = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Alan farkını (`{ alan: { from, to } }`) maskeler. Maskelenecek bir şey yoksa `degisti: false` ve AYNI nesne döner. */
export function farkMaskele(diff: unknown): { diff: unknown; degisti: boolean; sirliAlan: number } {
  if (!nesneMi(diff)) return { diff, degisti: false, sirliAlan: 0 };
  const out: Record<string, unknown> = {};
  let sirliAlan = 0;
  for (const [alan, d] of Object.entries(diff)) {
    if (!nesneMi(d)) { out[alan] = d; continue; }
    const m = { ...d, ...('from' in d ? { from: farkDegeriMaskele(alan, d.from) } : {}), ...('to' in d ? { to: farkDegeriMaskele(alan, d.to) } : {}) };
    if (!ayni(m, d)) sirliAlan++;
    out[alan] = m;
  }
  return sirliAlan ? { diff: out, degisti: true, sirliAlan } : { diff, degisti: false, sirliAlan: 0 };
}

export interface AuditSirSayimi {
  satir: number;
  farkliSatir: number;
  /** Farkında EN AZ bir düz metin sır alanı taşıyan denetim satırı. */
  sirliSatir: number;
  sirliAlan: number;
  /** Sırlı satırların hangi kayda ait olduğu (`details` başındaki koleksiyon adı) — değer yok. */
  koleksiyonlar: Record<string, number>;
  enEski: string | null;
  enYeni: string | null;
}

const zamanMetni = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (nesneMi(v) && typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return null;
};

export function auditSirSayimi(satirlar: readonly Readonly<Record<string, unknown>>[]): AuditSirSayimi {
  const s: AuditSirSayimi = { satir: satirlar.length, farkliSatir: 0, sirliSatir: 0, sirliAlan: 0, koleksiyonlar: {}, enEski: null, enYeni: null };
  for (const r of satirlar) {
    if (!nesneMi(r.diff)) continue;
    s.farkliSatir++;
    const m = farkMaskele(r.diff);
    if (!m.degisti) continue;
    s.sirliSatir++;
    s.sirliAlan += m.sirliAlan;
    const coll = String(r.details ?? '').split('/')[0].slice(0, 40) || '(bilinmiyor)';
    s.koleksiyonlar[coll] = (s.koleksiyonlar[coll] ?? 0) + 1;
    const z = zamanMetni(r.timestamp);
    if (z) { if (!s.enEski || z < s.enEski) s.enEski = z; if (!s.enYeni || z > s.enYeni) s.enYeni = z; }
  }
  return s;
}

export interface AyarOzeti {
  anahtar: string; firmaBazli: boolean; etiketli: boolean;
  /** DOLU (gerçek) sır alanı sayısı. */
  sirAlani: number;
  /** Veritabanında kelimesi kelimesine maske metni duran alan: eski hata gerçek sırrın ÜZERİNE maske yazmış → sır YOK OLMUŞ,
   *  yeniden girilmeli. Dolu sırla aynı sayılırsa operatör 'sır yerinde' sonucuna varırdı. */
  bozukSir: number;
}

const maskeSay = (v: unknown): number =>
  v === MASKE ? 1 : Array.isArray(v) ? v.reduce<number>((n, x) => n + maskeSay(x), 0) : nesneMi(v) ? Object.values(v).reduce<number>((n, x) => n + maskeSay(x), 0) : 0;

/** `settings` dokümanlarının özeti: anahtar (kiracı kimliği GİZLENİR — kimlik ilk `__`'ye kadardır), etiketli mi, kaç DOLU ve kaç
 *  BOZUK sır alanı taşıyor. Değer yok. */
export function ayarOzeti(dokumanlar: readonly { id: string; data: Readonly<Record<string, unknown>> }[]): AyarOzeti[] {
  return dokumanlar.map(d => {
    const firmaBazli = d.id.includes('__');
    return {
      anahtar: firmaBazli ? `<kiracı>__${d.id.slice(d.id.indexOf('__') + 2)}` : d.id,
      firmaBazli, etiketli: typeof d.data?.companyId === 'string' && d.data.companyId !== '',
      // `sirMaskele` ham maskeyi olduğu gibi bırakır → maskelenmiş sayım = dolu sır + ham maske; fark gerçek dolu sır sayısıdır.
      sirAlani: maskeSay(sirMaskele(d.data)) - maskeSay(d.data), bozukSir: maskeSay(d.data),
    };
  }).sort((a, b) => a.anahtar.localeCompare(b.anahtar));
}
