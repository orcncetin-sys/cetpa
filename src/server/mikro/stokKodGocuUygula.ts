/**
 * stokKodGocuUygula.ts — stok kodu göçünün UYGULAMA, GERİ ALMA ve PASİF LİSTE motoru (şartname `.wf/SARTNAME-mikro-baglanti-d-kod.md`
 * D2–D5 + DH7–DH12 / DH17–DH19; kullanıcı yanıtları 05.11.2026). Kararlar saf çekirdektedir (`stokKodGocuTasima.ts`); bu dosya
 * kilidi alır, kuru koşuyu YENİDEN hesaplar, çift başına GERÇEK işlemle (`BEGIN / COMMIT / ROLLBACK`, DH9) yazar, geri alma kaydını
 * aynı işlemde bırakır ve açık istemcilere yayın yapar.
 *
 * AKIŞ (uygulama):
 *   1. Kilit (`bakimKilidiKoy`, açıklama `stok-kod-gocu <calismaId>`; DH8 — `arkaPlanIsiBaslat` KULLANILMAZ: kendi kilit denetimi
 *      göçü `started:false` ile reddederdi). Kilit varsa 423.
 *   2. Kuru koşu yeniden (aynı tablo); imza tutmazsa 409 («veri değişti, kuru koşuyu yenile»); onaylı liste kuru koşuyla
 *      uyuşmazsa 400 (satır satır neden). Başlık kaydı yazılır, uç 202 + `calismaId` döner.
 *   3. Arka planda (aynı süreç): `yazicilariBekle` (koşan saatlik senkron / import bitsin) → kuru koşu BİR KEZ DAHA (kilit altında;
 *      imza değiştiyse `imza_uyusmadi`, hiçbir şey yazılmaz) → çiftler → pasif kartlar → «aynı sku'da tek kart» değişmezi → denetim satırı.
 *   4. `finally`: kilit kaldırılır (hata fırlatan işte de).
 * Süreç işin ortasında ölürse açılışta `stokKodGocuAcilisTemizligi` kilidi kaldırır, başlık `yarida` olur, tek denetim satırı yazılır;
 * yarım çift yoktur (DH9). Denetim satırı her çalışmada TEKTİR: mutlu yolda, yoksa `finally`de hata durumuyla (ürün adı yok).
 *
 * Ürün ADI hiçbir yanıta çıkmaz: başlık kaydı yalnız kod, sayı ve kimlik taşır. Tam önce-görüntüler (ad dâhil) yalnız SERVER_ONLY
 * `stokKodGocuKayitlari` parçalarında durur (geri alma için).
 */
import { randomInt } from 'node:crypto';
import { bakimKilidiKaldir, bakimKilidiKoy, bakimKilidiVar, yazicilariBekle } from '../bakimKilidi.js';
import { sha256 } from './gonderimOzeti.js';
import { ayniSkuGruplari, bicimliGuidAnahtari, depoKimlikParcasi, kodAnahtari } from './stokKodGocu.js';
import { kiraciBelgeleri, pasifMi, stokKodGocuKuruKos, type KuruBagimliliklari, type KuruIc, type KuruPgHavuzu, type KuruSonucu } from './stokKodGocuKuru.js';
import {
  ES_KOLEKSIYONU, KAYIT_KOLEKSIYONU, YAZILAN_TANIMLAR,
  alanDegisikligi, belgeyiTasi, depoKimlikCakismalari, etiketsizMi, geriAlmaKarari, geriAlmaSatiriReddi, hareketYazilirMi,
  kartAlanlariniKatla, konumKimligiTasi, onayliDogrula, yabanciMi, zamanMs,
  type BelgeDegisikligi, type CiftKarari, type Gecersiz, type KatlamaRaporu, type TasimaBaglami, type UygulaGovdesi,
} from './stokKodGocuTasima.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Bağımlılıklar
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type SorguSonucu = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
export interface IstemciPg { query: (sql: string, params?: unknown[]) => Promise<SorguSonucu>; release: () => void }
/** Ham SQL + tek işlemli istemci (`pg.Pool` buna uyar; DH9 — `pgShim.batch()` işlem DEĞİLDİR). */
export interface UygulaPgHavuzu extends KuruPgHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<SorguSonucu>;
  connect: () => Promise<IstemciPg>;
}
export interface Aktor { uid: string; email: string }
/** DH17: ops jetonlu çalışmanın denetim aktörü. */
export const OPS_AKTORU: Aktor = { uid: 'ops', email: 'ops' };

export interface UygulaBagimliliklari {
  havuz: UygulaPgHavuzu;
  /** Kuru koşunun Mikro okuyucuları (aynı gövde; DH16). */
  kuru: Omit<KuruBagimliliklari, 'havuz'>;
  /** Açık istemcilere değişiklik (server.ts `broadcastDocChange`); SERVER_ONLY koleksiyonlar yayınlanmaz. */
  yayinla: (coll: string, tur: 'set' | 'delete', id: string, veri: Record<string, unknown>) => void;
  /** server.ts `writeAuditLog` — tek satır, ürün adı yok (D4). */
  denetim: (aktor: Aktor, eylem: string, ayrinti: string, kiraci: string) => Promise<void>;
  /** `yazicilariBekle` seçenekleri (test kısa aralık verir). */
  bekleme?: Parameters<typeof yazicilariBekle>[1];
  simdi?: () => Date;
}

/** Bakım kilidi açıklamasının öneki; açılış temizliği yalnız bununla başlayan kilidi kaldırır (DH8). */
export const KILIT_ONEKI = 'stok-kod-gocu ';
const YAYINLANMAZ = new Set([ES_KOLEKSIYONU, KAYIT_KOLEKSIYONU]);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Kayıt biçimleri
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type CiftTuru = CiftKarari['tur'] | 'pasif';
export interface CiftOzeti {
  sira: number;
  eski: string;
  yeni: string | null;
  tur: CiftTuru;
  durum: 'uygulandi' | 'atlandi' | 'hata';
  neden: string | null;
  /** Koleksiyon başına yazılan belge sayısı. */
  belge: Record<string, number>;
  atlanan: number;
  katlanmayan: number;
}
export interface GeriAlmaOzeti {
  durum: 'kosuyor' | 'tamam' | 'hata' | 'yarida';
  aktor: Aktor;
  baslangic: string;
  bitis: string | null;
  geriYazilan: Record<string, number>;
  atlanan: Array<{ coll: string; id: string; neden: string; alanlar?: string[] }>;
  hata: string | null;
}
/** `stokKodGocuKayitlari/<calismaId>` — çalışmanın BAŞLIĞI (ad yok; durum uçları bunu döner). */
export interface CalismaBasligi {
  companyId: string;
  calismaId: string;
  durum: 'kosuyor' | 'tamam' | 'hata' | 'imza_uyusmadi' | 'yarida';
  aktor: Aktor;
  baslangic: string;
  bitis: string | null;
  planImza: string;
  istenen: { onayli: number; pasif: number };
  ciftler: CiftOzeti[];
  ozet: { uygulanan: number; atlanan: number; hatali: number; belge: Record<string, number>; toplamDegisiklik: number };
  /** D4 değişmezi: uygulama SONRASI kiracıda aynı sku'da birden çok kart. Boş değilse durum `hata`. */
  ayniSkuSonrasi: Array<{ sku: string; kart: number }>;
  hata: string | null;
  geriAlma: GeriAlmaOzeti | null;
}
/** `stokKodGocuKayitlari/<calismaId>~<sıra>` — çiftin geri alma parçası (çiftin işlemiyle AYNI işlemde yazılır; DH9). */
export interface CalismaParcasi {
  companyId: string;
  calismaId: string;
  sira: number;
  eski: string;
  yeni: string | null;
  tur: CiftTuru;
  degisiklikler: BelgeDegisikligi[];
  atlanan: Array<{ coll: string; id: string; neden: string }>;
  katlanmayan: KatlamaRaporu[];
}

const parcaKimligi = (calismaId: string, sira: number): string => `${calismaId}~${String(sira).padStart(5, '0')}`;
/** D3: eş belgesinin kimliği `<kiracı8>:<eski kod NFC>` (kod `kodAnahtari` biçiminde — NFC dâhil). */
export const esKimligi = (cid: string, eski: string): string => `${sha256(cid).slice(0, 8)}:${kodAnahtari(eski)}`;

function yeniCalismaId(t: Date): string {
  const p = (n: number, u = 2): string => String(n).padStart(u, '0');
  const damga = `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let ek = '';
  for (let i = 0; i < 6; i++) ek += abc[randomInt(abc.length)];
  return `skg-${damga}-${ek}`;
}

const nesne = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const mesaj = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300);

async function basligiYaz(h: UygulaPgHavuzu, b: CalismaBasligi): Promise<void> {
  await h.query(
    'INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
    [KAYIT_KOLEKSIYONU, b.calismaId, JSON.stringify(b)]);
}

/** Başlık kaydı (kiracı süzgeçli — başka kiracının çalışması `null`). */
export async function calismaBasligiOku(h: KuruPgHavuzu, cid: string, calismaId: string): Promise<CalismaBasligi | null> {
  const { rows } = await h.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [KAYIT_KOLEKSIYONU, calismaId]);
  if (!rows.length) return null;
  const v = nesne(rows[0].data);
  if (v.companyId !== cid || v.calismaId !== calismaId) return null;
  return v as unknown as CalismaBasligi;
}

const kuruKos = (d: UygulaBagimliliklari, g: { companyId: string; aynaKullan: boolean; govde: UygulaGovdesi }): Promise<KuruSonucu> =>
  stokKodGocuKuruKos({ havuz: d.havuz, ...d.kuru }, { companyId: g.companyId, aynaKullan: g.aynaKullan, ciftler: g.govde.ciftler, yokSayilan: g.govde.yokSayilan });

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// İşlem içi yazıcı
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

interface IslemYazicisi {
  oku: (coll: string, id: string) => Promise<{ veri: Record<string, unknown>; sutun: unknown } | null>;
  guncelle: (coll: string, id: string, once: Record<string, unknown>, sonra: Record<string, unknown>, alanlar: Iterable<string>) => Promise<void>;
  sil: (coll: string, id: string, tam: Record<string, unknown>) => Promise<void>;
  ekle: (coll: string, id: string, tam: Record<string, unknown>) => Promise<void>;
  degisiklikler: BelgeDegisikligi[];
  yayin: Array<{ coll: string; tur: 'set' | 'delete'; id: string; veri: Record<string, unknown> }>;
}
function islemYazicisi(c: IstemciPg): IslemYazicisi {
  const degisiklikler: BelgeDegisikligi[] = [];
  const yayin: IslemYazicisi['yayin'] = [];
  return {
    degisiklikler, yayin,
    oku: async (coll, id) => {
      const r = await c.query('SELECT data, updated_at FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', [coll, id]);
      return r.rows.length ? { veri: nesne(r.rows[0].data), sutun: r.rows[0].updated_at } : null;
    },
    guncelle: async (coll, id, once, sonra, alanlar) => {
      const r = await c.query('UPDATE docs SET data = $3::jsonb, updated_at = now() WHERE coll = $1 AND id = $2', [coll, id, JSON.stringify(sonra)]);
      if (r.rowCount === 0) throw new Error(`belge yazılamadı (yok): ${coll}/${id}`);
      degisiklikler.push(alanDegisikligi(coll, id, once, sonra, alanlar));
      yayin.push({ coll, tur: 'set', id, veri: sonra });
    },
    sil: async (coll, id, tam) => {
      const r = await c.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [coll, id]);
      if (r.rowCount === 0) throw new Error(`belge silinemedi (yok): ${coll}/${id}`);
      degisiklikler.push({ coll, id, tur: 'silindi', tam });
      yayin.push({ coll, tur: 'delete', id, veri: tam });
    },
    ekle: async (coll, id, tam) => {
      const r = await c.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING', [coll, id, JSON.stringify(tam)]);
      if (r.rowCount === 0) throw new Error(`belge açılamadı (kimlik dolu): ${coll}/${id}`);
      degisiklikler.push({ coll, id, tur: 'olusturuldu', tam });
      yayin.push({ coll, tur: 'set', id, veri: tam });
    },
  };
}

function yayinla(d: UygulaBagimliliklari, y: IslemYazicisi['yayin']): void {
  for (const o of y) {
    if (YAYINLANMAZ.has(o.coll)) continue;
    try { d.yayinla(o.coll, o.tur, o.id, o.veri); } catch (e) { console.warn('[stok-kod-gocu] yayın yapılamadı:', mesaj(e)); }
  }
}

const sayac = (degisiklikler: readonly BelgeDegisikligi[]): Record<string, number> => {
  const b: Record<string, number> = {};
  for (const x of degisiklikler) b[x.coll] = (x.coll in b ? b[x.coll] : 0) + 1;
  return b;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Çift işlemi (D2 + D3 + DH7 / DH9 / DH18 / DH19)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

interface CiftBaglami { cid: string; calismaId: string; sira: number; tarih: string; depoCakismasi: ReadonlySet<string> }

async function ciftIsle(d: UygulaBagimliliklari, ic: KuruIc, karar: Exclude<CiftKarari, { tur: 'atla' }>, b: CiftBaglami): Promise<CiftOzeti> {
  const ozet: CiftOzeti = { sira: b.sira, eski: karar.eski, yeni: karar.yeni, tur: karar.tur, durum: 'uygulandi', neden: null, belge: {}, atlanan: 0, katlanmayan: 0 };
  const atlanan: CalismaParcasi['atlanan'] = [];
  let katlanmayan: KatlamaRaporu[] = [];
  const c = await d.havuz.connect();
  const w = islemYazicisi(c);
  try {
    await c.query('BEGIN');
    const { eski, yeni } = karar;
    const eskiKartSet = new Set(karar.eskiKartlar);

    // Kalan kart: tam çiftte ŞART (kiracıda, kodu hâlâ yeni kod); yalnız referans çiftinde varsa kimliği ve dizgisi kullanılır.
    const kalan = karar.kalanKart ? await w.oku('inventory', karar.kalanKart) : null;
    if (karar.tur === 'tam') {
      if (!kalan) throw new Error('kalan kart bulunamadı');
      if (yabanciMi(kalan.veri, b.cid)) throw new Error('kalan kart başka kiracıda');
      if (kodAnahtari(kalan.veri.sku) !== yeni) throw new Error('kalan kartın kodu kuru koşudan sonra değişti');
    }
    const kalanGecerli = kalan !== null && !yabanciMi(kalan.veri, b.cid) && kodAnahtari(kalan.veri.sku) === yeni;
    // DH15: yazılan değer kalan kartın sku'su (Mikro'nun döndürdüğü dizgi); kart yoksa onaylı yeni kod.
    const yazilan = kalanGecerli && typeof kalan.veri.sku === 'string' ? kalan.veri.sku : yeni;
    const bag: TasimaBaglami = { eski, yeni: yazilan, eskiKartlar: eskiKartSet, kalanKart: kalanGecerli ? karar.kalanKart : null, companyId: b.cid };

    // ── D3 · bağlı belgeler (DH1 tablosu; aynalar ve mağaza talebi YAZILMAZ).
    for (const t of YAZILAN_TANIMLAR) {
      const sayim = ic.sayimlar.find(s => s.koleksiyon === t.koleksiyon);
      const ids = sayim ? sayim.koduBasina.get(eski) : undefined;
      if (!ids || !ids.size) continue;
      for (const id of [...ids].sort()) {
        const belge = await w.oku(t.koleksiyon, id);
        if (!belge) { atlanan.push({ coll: t.koleksiyon, id, neden: 'belge_yok' }); continue; }
        if (yabanciMi(belge.veri, b.cid)) { atlanan.push({ coll: t.koleksiyon, id, neden: 'yabanci_kiraci' }); continue; }
        // DH18 değişmezi ÖNCE: kimliği koddan türeyen belgenin kodu başka bir kodla `/` → `_` sonrası aynı kimliğe düşüyorsa belgenin
        // hangi koda ait olduğu bilinmez — SİLİNMEZ, sku'su da YENİDEN YAZILMAZ, listelenir. (Paket turu 05.11.2026: denetim yalnız
        // «kimlik eski kodun» dalındaydı; kimlik haritası çakışan öbür koda çözülünce belge sku taşımaya düşüyor ve eski kimlikte yeni
        // sku'lu ikinci depo belgesi doğuyordu — `stokKodGocuUygula.pglite.test` `DH18 · warehouseItems › değişmez`.)
        const idKodu = t.kimlikKoddan ? ic.depoKimlikleri.get(id) : undefined;
        if (idKodu !== undefined && b.depoCakismasi.has(depoKimlikParcasi(idKodu))) { atlanan.push({ coll: t.koleksiyon, id, neden: 'depo_kimlik_cakismasi' }); continue; }
        if (idKodu === eski) {
          // DH18: koddan türeyen depo belgesi SİLİNİR (miktar yeni kimliğe kopyalanmaz — kalan kodun belgesini stok miktarı işi açar).
          if (kodAnahtari(belge.veri.sku) !== eski) { atlanan.push({ coll: t.koleksiyon, id, neden: 'depo_belgesi_sku_eski_kod_degil' }); continue; }
          await w.sil(t.koleksiyon, id, belge.veri);
          continue;
        }
        if (t.koleksiyon === 'inventoryMovements') {
          const neden = hareketYazilirMi(bicimliGuidAnahtari(id), ic.mikroHareketKodu, ic.yetimEvrakEsi, id, yeni);
          if (neden) { atlanan.push({ coll: t.koleksiyon, id, neden }); continue; }
        }
        const tasinan = belgeyiTasi(t, belge.veri, bag);
        if (!tasinan) { atlanan.push({ coll: t.koleksiyon, id, neden: 'eski_kod_kalmadi' }); continue; }
        const alanlar = [...tasinan.alanlar];
        // D3: siparişin `updatedAt`'i DEĞİŞMEZ; iz alanı eklenir.
        if (t.koleksiyon === 'orders') { tasinan.veri.kodGocu = { calismaId: b.calismaId }; alanlar.push('kodGocu'); }
        if (t.koleksiyon === 'locationStocks') {
          const yeniId = konumKimligiTasi(id, eskiKartSet, bag.kalanKart);
          if (yeniId !== null) {
            if (await w.oku(t.koleksiyon, yeniId)) {
              // Tam çiftte eski kart silinir: eski konum belgesi atlanırsa silinmiş karta bağlı kalırdı. Miktar BİRLEŞTİRİLMEZ (DH18
              // çizgisi; ayrı iş kararı) → çift hata ile geri döner (ROLLBACK), belgeler olduğu gibi kalır. Referans çiftinde eski kart
              // silinmez; atlama doğru kalır (inceleme turu 05.11.2026, MKD3 dizin 0). Kuru koşu bu çakışmayı `onayliDogrula`da
              // geçersiz sayar (MKD4 dizin 1); bu satır kuru koşudan SONRA yazılan konum belgesi için arka korumadır.
              if (karar.tur === 'tam') throw new Error(`hedef konum belgesi var: ${yeniId}`);
              atlanan.push({ coll: t.koleksiyon, id, neden: 'hedef_konum_belgesi_var' }); continue;
            }
            const tam = typeof tasinan.veri.id === 'string' ? { ...tasinan.veri, id: yeniId } : tasinan.veri;
            await w.sil(t.koleksiyon, id, belge.veri);
            await w.ekle(t.koleksiyon, yeniId, tam);
            continue;
          }
        }
        await w.guncelle(t.koleksiyon, id, belge.veri, tasinan.veri, alanlar);
      }
    }

    if (karar.tur === 'tam' && kalan) {
      // ── Eski kartlar (FOR UPDATE): en yeni `updatedAt` başta (D2 çakışma kuralı).
      const eskiler: Array<{ id: string; veri: Record<string, unknown>; t: number | null }> = [];
      for (const id of karar.eskiKartlar) {
        const k = await w.oku('inventory', id);
        if (!k) throw new Error(`eski kart kuru koşudan sonra kayboldu: ${id}`);
        if (yabanciMi(k.veri, b.cid)) throw new Error(`eski kart başka kiracıda: ${id}`);
        if (kodAnahtari(k.veri.sku) !== eski) throw new Error(`eski kartın kodu kuru koşudan sonra değişti: ${id}`);
        eskiler.push({ id, veri: k.veri, t: zamanMs(k.veri.updatedAt, k.sutun) });
      }
      eskiler.sort((x, y) => (y.t ?? Number.NEGATIVE_INFINITY) - (x.t ?? Number.NEGATIVE_INFINITY) || (x.id < y.id ? -1 : 1));
      // ── D2 · kalan karta alan katlama (yalnız DH5 tablosu; Mikro alanları kalan karttan değişmez).
      const katla = kartAlanlariniKatla(kalan.veri, eskiler);
      katlanmayan = katla.rapor;
      const alanlar = Object.keys(katla.yama);
      const sonra: Record<string, unknown> = { ...kalan.veri, ...katla.yama };
      if (etiketsizMi(kalan.veri)) { sonra.companyId = b.cid; alanlar.push('companyId'); }
      if (alanlar.length) await w.guncelle('inventory', karar.kalanKart, kalan.veri, sonra, alanlar);
      // ── Eski kart silme (tam JSON geri alma kaydında).
      for (const e of eskiler) await w.sil('inventory', e.id, e.veri);
      // ── Eş (D3 + DH12 `stoGuid`).
      const esId = esKimligi(b.cid, eski);
      const esVeri: Record<string, unknown> = {
        companyId: b.cid, eski, yeni, sinif: karar.satir.sinif, kanit: karar.satir.kanit, kaynaklar: karar.satir.kaynaklar,
        calismaId: b.calismaId, tarih: b.tarih, stoGuid: ic.aynaStoGuid.get(eski) ?? null,
        eskiKartlar: eskiler.map(e => e.id), kalanKart: karar.kalanKart,
      };
      const mevcutEs = await w.oku(ES_KOLEKSIYONU, esId);
      if (mevcutEs) await w.guncelle(ES_KOLEKSIYONU, esId, mevcutEs.veri, { ...mevcutEs.veri, ...esVeri }, Object.keys(esVeri));
      else await w.ekle(ES_KOLEKSIYONU, esId, esVeri);
    }

    if (!w.degisiklikler.length) { await c.query('ROLLBACK'); return { ...ozet, durum: 'atlandi', neden: 'degisiklik_yok', atlanan: atlanan.length }; }
    // ── Geri alma parçası AYNI işlemde (DH9).
    const parca: CalismaParcasi = { companyId: b.cid, calismaId: b.calismaId, sira: b.sira, eski, yeni, tur: karar.tur, degisiklikler: w.degisiklikler, atlanan, katlanmayan };
    await c.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [KAYIT_KOLEKSIYONU, parcaKimligi(b.calismaId, b.sira), JSON.stringify(parca)]);
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* bağlantı düştüyse işlem zaten geri döndü */ }
    return { ...ozet, durum: 'hata', neden: mesaj(e), belge: {}, atlanan: atlanan.length, katlanmayan: katlanmayan.length };
  } finally {
    c.release();
  }
  yayinla(d, w.yayin);
  return { ...ozet, belge: sayac(w.degisiklikler), atlanan: atlanan.length, katlanmayan: katlanmayan.length };
}

/** D5: pasif işaret — kart SİLİNMEZ; `inventory.mikroPasif = { neden: 'mikroda_yok', calismaId, tarih }` (geri alma kaydında). */
async function pasifIsle(d: UygulaBagimliliklari, p: { eski: string; kartlar: string[] }, b: CiftBaglami): Promise<CiftOzeti> {
  const ozet: CiftOzeti = { sira: b.sira, eski: p.eski, yeni: null, tur: 'pasif', durum: 'uygulandi', neden: null, belge: {}, atlanan: 0, katlanmayan: 0 };
  const atlanan: CalismaParcasi['atlanan'] = [];
  const c = await d.havuz.connect();
  const w = islemYazicisi(c);
  try {
    await c.query('BEGIN');
    for (const id of p.kartlar) {
      const k = await w.oku('inventory', id);
      if (!k) { atlanan.push({ coll: 'inventory', id, neden: 'belge_yok' }); continue; }
      if (yabanciMi(k.veri, b.cid)) { atlanan.push({ coll: 'inventory', id, neden: 'yabanci_kiraci' }); continue; }
      if (kodAnahtari(k.veri.sku) !== p.eski) { atlanan.push({ coll: 'inventory', id, neden: 'kart_kodu_degisti' }); continue; }
      if (pasifMi(k.veri)) { atlanan.push({ coll: 'inventory', id, neden: 'zaten_pasif' }); continue; }
      const alanlar = ['mikroPasif'];
      const sonra: Record<string, unknown> = { ...k.veri, mikroPasif: { neden: 'mikroda_yok', calismaId: b.calismaId, tarih: b.tarih } };
      if (etiketsizMi(k.veri)) { sonra.companyId = b.cid; alanlar.push('companyId'); }
      await w.guncelle('inventory', id, k.veri, sonra, alanlar);
    }
    if (!w.degisiklikler.length) { await c.query('ROLLBACK'); return { ...ozet, durum: 'atlandi', neden: 'degisiklik_yok', atlanan: atlanan.length }; }
    const parca: CalismaParcasi = { companyId: b.cid, calismaId: b.calismaId, sira: b.sira, eski: p.eski, yeni: null, tur: 'pasif', degisiklikler: w.degisiklikler, atlanan, katlanmayan: [] };
    await c.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb)', [KAYIT_KOLEKSIYONU, parcaKimligi(b.calismaId, b.sira), JSON.stringify(parca)]);
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* yukarıdaki not */ }
    return { ...ozet, durum: 'hata', neden: mesaj(e), atlanan: atlanan.length };
  } finally {
    c.release();
  }
  yayinla(d, w.yayin);
  return { ...ozet, belge: sayac(w.degisiklikler), atlanan: atlanan.length };
}

/**
 * Ortak hedef (birden çok eski kod → aynı yeni; ölçü 05.11: `APEL-HY-003` ← `MA-HY-003` + `MITREAPEL-HY-003`): çiftler eski kartın
 * en yeni `updatedAt`'i başta olacak sırayla işlenir — ilk katlanan alan kazanır, sonraki farklı değer çakışma olarak rapora girer
 * (D2). Öbür çiftlerin sırası onay listesinin sırasıdır.
 */
async function siraKur(h: UygulaPgHavuzu, kararlar: readonly CiftKarari[]): Promise<CiftKarari[]> {
  // Kararlar onay listesinin sırasıyla gelir; her hedef ilk göründüğü yerde grup olarak işlenir (sıra numarası = dizin).
  const hedefler = new Map<string, string[]>();
  for (const k of kararlar) if (k.tur === 'tam') { const g = hedefler.get(k.yeni); if (g) g.push(k.eski); else hedefler.set(k.yeni, [k.eski]); }
  const zaman = new Map<string, number>();
  for (const k of kararlar) {
    if (k.tur !== 'tam') continue;
    const grup = hedefler.get(k.yeni);
    if (!grup || grup.length < 2) continue;
    let enYeni = Number.NEGATIVE_INFINITY;
    for (const id of k.eskiKartlar) {
      const { rows } = await h.query('SELECT data->\'updatedAt\' AS u, updated_at FROM docs WHERE coll = $1 AND id = $2', ['inventory', id]);
      const t = rows.length ? zamanMs(rows[0].u, rows[0].updated_at) : null;
      if (t !== null && t > enYeni) enYeni = t;
    }
    zaman.set(k.eski, enYeni);
  }
  const sirali: CiftKarari[] = [];
  const islendi = new Set<string>();
  for (const k of kararlar) {
    if (k.tur !== 'tam') { sirali.push(k); continue; }
    if (islendi.has(k.yeni)) continue;
    islendi.add(k.yeni);
    const grup = kararlar.filter((x): x is Extract<CiftKarari, { tur: 'tam' }> => x.tur === 'tam' && x.yeni === k.yeni);
    const z = (x: { eski: string }): number => { const t = zaman.get(x.eski); return t === undefined ? Number.NEGATIVE_INFINITY : t; };
    // Kararlı sıralama: aynı zamanlı (ya da zamanı okunamayan) çiftler onay listesindeki sırasını korur.
    sirali.push(...grup.map((x, i) => ({ x, i })).sort((a, b) => z(b.x) - z(a.x) || a.i - b.i).map(({ x }) => x));
  }
  return sirali;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D4 · uygulama
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export type BaslatSonucu =
  | { tamam: true; calismaId: string; is: Promise<CalismaBasligi>; plan: Record<CiftTuru, number> }
  | { tamam: false; durum: number; error: string; gecersiz?: Gecersiz[] };

/** Yanıttaki geçersiz satır listesinin tavanı (sayı her zaman tamdır). */
const GECERSIZ_LISTE_SINIRI = 100;

export async function stokKodGocuUygulaBaslat(d: UygulaBagimliliklari, g: { companyId: string; aynaKullan: boolean; govde: UygulaGovdesi; aktor: Aktor }): Promise<BaslatSonucu> {
  const simdi = d.simdi ?? (() => new Date());
  const cid = g.companyId;
  if (!cid) return { tamam: false, durum: 400, error: 'Kiracı çözülemedi.' };
  const calismaId = yeniCalismaId(simdi());
  try { await bakimKilidiKoy(d.havuz, `${KILIT_ONEKI}${calismaId}`, simdi().toISOString()); } catch (e) {
    return { tamam: false, durum: 423, error: `Bakım kilidi var; başka bir bakım ya da göç koşuyor: ${mesaj(e)}` };
  }
  let devredildi = false;
  try {
    const ilk = await kuruKos(d, g);
    if (!ilk.tamam) return { tamam: false, durum: ilk.durum, error: ilk.error };
    if (ilk.rapor.planImza !== g.govde.planImza) return { tamam: false, durum: 409, error: 'Veri değişti, kuru koşuyu yenile (plan imzası tutmuyor).' };
    const dog = onayliDogrula(ilk.ic, g.govde.onayli, g.govde.pasif);
    if (dog.gecersiz.length) {
      return { tamam: false, durum: 400, error: `Onaylı listede kuru koşuyla uyuşmayan ${dog.gecersiz.length} satır var; hiçbir şey yazılmadı.`, gecersiz: dog.gecersiz.slice(0, GECERSIZ_LISTE_SINIRI) };
    }
    const baslik: CalismaBasligi = {
      companyId: cid, calismaId, durum: 'kosuyor', aktor: g.aktor, baslangic: simdi().toISOString(), bitis: null, planImza: g.govde.planImza,
      istenen: { onayli: g.govde.onayli.length, pasif: g.govde.pasif.length }, ciftler: [],
      ozet: { uygulanan: 0, atlanan: 0, hatali: 0, belge: {}, toplamDegisiklik: 0 }, ayniSkuSonrasi: [], hata: null, geriAlma: null,
    };
    await basligiYaz(d.havuz, baslik);
    const plan: Record<CiftTuru, number> = { tam: 0, referans: 0, atla: 0, pasif: dog.pasifler.length };
    for (const k of dog.kararlar) plan[k.tur]++;
    const is = arkaPlanUygula(d, g, baslik);
    devredildi = true;
    return { tamam: true, calismaId, is, plan };
  } finally {
    if (!devredildi) await bakimKilidiKaldir(d.havuz);
  }
}

const UYGULA_DENETIM_EYLEMI = 'Stok kodu göçü uygulandı';
const GERI_AL_DENETIM_EYLEMI = 'Stok kodu göçü geri alındı';
const YARIDA_DENETIM_EYLEMI = 'Stok kodu göçü yarıda kaldı';
const belgeMetni = (b: Record<string, number>): string => Object.entries(b).sort().map(([c, n]) => `${c} ${n}`).join(', ') || 'belge yok';
/** D4 denetim ayrıntısı: kimlik + sayılar (ürün ADI yok). */
const uygulaDenetimMetni = (b: CalismaBasligi): string =>
  `${b.calismaId}: ${b.ozet.uygulanan} çift / pasif uygulandı, ${b.ozet.atlanan} atlandı, ${b.ozet.hatali} hata · ${belgeMetni(b.ozet.belge)}`;

async function arkaPlanUygula(d: UygulaBagimliliklari, g: { companyId: string; aynaKullan: boolean; govde: UygulaGovdesi; aktor: Aktor }, baslik: CalismaBasligi): Promise<CalismaBasligi> {
  const simdi = d.simdi ?? (() => new Date());
  const cid = g.companyId;
  // Denetim satırı her çalışmada TEK (D4): mutlu yol yazar; yazamadıysa (çift yazıldıktan sonra fırlayan hata, denetimin kendisi
  // düştü) `finally` hata durumuyla yazar (inceleme turu 05.11.2026, MKD3 dizin 2).
  let denetimYazildi = false;
  try {
    // DH8: kilidi görmeden önce başlamış yazıcı (saatlik senkron, elle import, gece adımı) bitsin.
    await yazicilariBekle(d.havuz, d.bekleme ?? {});
    // Kilit ALTINDA son kuru koşu: imza yine tutmalı (kilitten önce koşan yazıcı veriyi değiştirdiyse hiçbir şey yazılmaz).
    const kuru = await kuruKos(d, g);
    if (!kuru.tamam) { baslik.durum = 'hata'; baslik.hata = `kuru koşu (kilit altında): ${kuru.error}`; return baslik; }
    if (kuru.rapor.planImza !== g.govde.planImza) { baslik.durum = 'imza_uyusmadi'; baslik.hata = 'Kilit beklenirken veri değişti; hiçbir şey yazılmadı. Kuru koşuyu yenileyin.'; return baslik; }
    const dog = onayliDogrula(kuru.ic, g.govde.onayli, g.govde.pasif);
    if (dog.gecersiz.length) { baslik.durum = 'hata'; baslik.hata = `kilit altında ${dog.gecersiz.length} satır geçersizleşti; hiçbir şey yazılmadı`; return baslik; }

    const tarih = simdi().toISOString();
    const kodlar = new Set<string>([...kuru.ic.evren.kodaGoreKartlar.keys(), ...kuru.ic.eskiKartlar.keys()]);
    const depoCakismasi = depoKimlikCakismalari(kodlar);
    let sira = 0;
    const ekle = (o: CiftOzeti): void => {
      baslik.ciftler.push(o);
      if (o.durum === 'uygulandi') baslik.ozet.uygulanan++; else if (o.durum === 'atlandi') baslik.ozet.atlanan++; else baslik.ozet.hatali++;
      for (const [coll, n] of Object.entries(o.belge)) { baslik.ozet.belge[coll] = (coll in baslik.ozet.belge ? baslik.ozet.belge[coll] : 0) + n; baslik.ozet.toplamDegisiklik += n; }
    };
    for (const karar of await siraKur(d.havuz, dog.kararlar)) {
      sira++;
      if (karar.tur === 'atla') { ekle({ sira, eski: karar.eski, yeni: karar.yeni, tur: 'atla', durum: 'atlandi', neden: karar.neden, belge: {}, atlanan: 0, katlanmayan: 0 }); continue; }
      ekle(await ciftIsle(d, kuru.ic, karar, { cid, calismaId: baslik.calismaId, sira, tarih, depoCakismasi }));
      if (sira % 25 === 0) await basligiYaz(d.havuz, baslik);
    }
    for (const p of dog.pasifler) {
      sira++;
      ekle(await pasifIsle(d, p, { cid, calismaId: baslik.calismaId, sira, tarih, depoCakismasi }));
    }
    // D4 değişmezi: uygulama SONRASI kiracıda aynı sku'da birden çok kart = 0.
    const kartlar = (await kiraciBelgeleri(d.havuz, 'inventory', cid)).map(b => ({ id: b.id, sku: b.veri.sku, source: b.veri.source, companyId: b.veri.companyId }));
    baslik.ayniSkuSonrasi = ayniSkuGruplari(kartlar);
    if (baslik.ayniSkuSonrasi.length) {
      baslik.durum = 'hata';
      baslik.hata = `Uygulama sonrası değişmez bozuk: ${baslik.ayniSkuSonrasi.length} sku'da birden çok kart.`;
    } else if (baslik.ozet.hatali) {
      baslik.durum = 'hata';
      baslik.hata = `${baslik.ozet.hatali} çift uygulanamadı (yalnız o çiftler geri döndü).`;
    } else baslik.durum = 'tamam';
    await d.denetim(g.aktor, UYGULA_DENETIM_EYLEMI, uygulaDenetimMetni(baslik), cid);
    denetimYazildi = true;
    return baslik;
  } catch (e) {
    baslik.durum = 'hata';
    baslik.hata = mesaj(e);
    console.error(`[stok-kod-gocu/uygula] ${baslik.calismaId}:`, baslik.hata);
    return baslik;
  } finally {
    baslik.bitis = simdi().toISOString();
    // Hiçbir şey yazmadan biten çalışma (imza uyuşmadı) denetim satırı DOĞURMAZ; hata ya da yazılmış çift varsa tek satır.
    if (!denetimYazildi && (baslik.ciftler.length || baslik.durum === 'hata')) {
      try { await d.denetim(g.aktor, UYGULA_DENETIM_EYLEMI, `${uygulaDenetimMetni(baslik)} · durum ${baslik.durum}: ${baslik.hata ?? '-'}`, cid); }
      catch (e) { console.error(`[stok-kod-gocu/uygula] denetim satırı yazılamadı (${baslik.calismaId}):`, mesaj(e)); }
    }
    try { await basligiYaz(d.havuz, baslik); } catch (e) { console.error(`[stok-kod-gocu/uygula] başlık yazılamadı (${baslik.calismaId}):`, mesaj(e)); }
    finally { await bakimKilidiKaldir(d.havuz); }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D4 · geri alma (DH10 / DH11)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

async function parcalariOku(h: KuruPgHavuzu, cid: string, calismaId: string): Promise<CalismaParcasi[]> {
  const { rows } = await h.query('SELECT id, data FROM docs WHERE coll = $1 AND id LIKE $2', [KAYIT_KOLEKSIYONU, `${calismaId}~%`]);
  return rows
    .map(r => nesne(r.data) as unknown as CalismaParcasi)
    .filter(p => p.companyId === cid && p.calismaId === calismaId && Array.isArray(p.degisiklikler))
    .sort((a, b) => b.sira - a.sira);
}

export type GeriAlBaslatSonucu =
  | { tamam: true; calismaId: string; is: Promise<CalismaBasligi> }
  | { tamam: false; durum: number; error: string; ret?: string[] };

export async function stokKodGocuGeriAlBaslat(d: UygulaBagimliliklari, g: { companyId: string; calismaId: string; aktor: Aktor }): Promise<GeriAlBaslatSonucu> {
  const simdi = d.simdi ?? (() => new Date());
  const cid = g.companyId;
  const baslik = await calismaBasligiOku(d.havuz, cid, g.calismaId);
  if (!baslik) return { tamam: false, durum: 404, error: 'Çalışma bulunamadı.' };
  if (baslik.geriAlma && (baslik.geriAlma.durum === 'tamam' || baslik.geriAlma.durum === 'kosuyor')) {
    return { tamam: false, durum: 409, error: baslik.geriAlma.durum === 'tamam' ? 'Bu çalışma zaten geri alındı.' : 'Geri alma sürüyor.' };
  }
  if (baslik.durum !== 'tamam' && baslik.durum !== 'hata' && baslik.durum !== 'yarida') {
    return { tamam: false, durum: 409, error: `Çalışma geri alınamaz (durum: ${baslik.durum}).` };
  }
  const parcalar = await parcalariOku(d.havuz, cid, g.calismaId);
  // DH10: HİÇBİR şey yazmadan önce kaydın tamamı denetlenir — beyaz liste, kayıttaki görüntülerin kiracısı, bugünkü belgenin kiracısı.
  const ret: string[] = [];
  for (const p of parcalar) {
    for (const x of p.degisiklikler) {
      const r = geriAlmaSatiriReddi(x, cid);
      if (r) { ret.push(r); continue; }
      const { rows } = await d.havuz.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [x.coll, x.id]);
      if (rows.length && yabanciMi(nesne(rows[0].data), cid)) ret.push(`bugünkü belge yabancı kiracıda: ${x.coll}/${x.id}`);
    }
  }
  if (ret.length) return { tamam: false, durum: 422, error: `Geri alma reddedildi: kayıtta geri yazılamayacak ${ret.length} satır var; hiçbir şey yazılmadı.`, ret: ret.slice(0, 50) };
  try { await bakimKilidiKoy(d.havuz, `${KILIT_ONEKI}${g.calismaId} geri-al`, simdi().toISOString()); } catch (e) {
    return { tamam: false, durum: 423, error: `Bakım kilidi var; başka bir bakım ya da göç koşuyor: ${mesaj(e)}` };
  }
  let devredildi = false;
  try {
    baslik.geriAlma = { durum: 'kosuyor', aktor: g.aktor, baslangic: simdi().toISOString(), bitis: null, geriYazilan: {}, atlanan: [], hata: null };
    await basligiYaz(d.havuz, baslik);
    const is = arkaPlanGeriAl(d, g, baslik, parcalar);
    devredildi = true;
    return { tamam: true, calismaId: g.calismaId, is };
  } finally {
    if (!devredildi) await bakimKilidiKaldir(d.havuz);
  }
}

async function arkaPlanGeriAl(d: UygulaBagimliliklari, g: { companyId: string; calismaId: string; aktor: Aktor }, baslik: CalismaBasligi, parcalar: readonly CalismaParcasi[]): Promise<CalismaBasligi> {
  const simdi = d.simdi ?? (() => new Date());
  const cid = g.companyId;
  const ga = baslik.geriAlma;
  if (!ga) throw new Error('geri alma özeti yok');
  let hatali = 0;
  let denetimYazildi = false;
  const geriAlDenetimMetni = (): string => `${g.calismaId}: ${belgeMetni(ga.geriYazilan)} · ${ga.atlanan.length} atlandı · ${hatali} parça hata`;
  try {
    await yazicilariBekle(d.havuz, d.bekleme ?? {});
    for (const p of parcalar) {
      const c = await d.havuz.connect();
      const yayin: IslemYazicisi['yayin'] = [];
      const yazilan: Record<string, number> = {};
      const atlanan: GeriAlmaOzeti['atlanan'] = [];
      // locationStocks TAŞIMASI (`silindi` eski kimlik + `olusturuldu` yeni kimlik) bütün olarak döner: yeni kimlikli belge geri
      // alınamazsa (sonradan değişti, yok, yabancı) eski kimlikli belge de geri YAZILMAZ — yoksa stok iki kimlikte birden sayılır.
      // Uygulama iki satırı araya başka satır girmeden art arda yazar (`ciftIsle`: `w.sil` → `w.ekle`); ters sırada `olusturuldu`
      // önce gelir, eşi hemen önceki dizindedir (inceleme turu 05.11.2026, MKD3 dizin 1).
      const tasimaAtla = new Set<number>();
      const tasimaEsiniAtla = (i: number): void => {
        const x = p.degisiklikler[i];
        const o = i > 0 ? p.degisiklikler[i - 1] : undefined;
        if (x.coll === 'locationStocks' && x.tur === 'olusturuldu' && o && o.coll === 'locationStocks' && o.tur === 'silindi') tasimaAtla.add(i - 1);
      };
      // Öbür yön: yeni kimlikli belge geri silinebilir ama eski kimlikte sonradan yazılmış belge varsa eşi geri YAZILAMAZ — silinirse
      // taşınan stok kaybolur. Böyle taşımada iki belge de yerinde kalır, ikisi de listelenir (inceleme turu 06.11.2026, MKD4 dizin 0).
      const tasimaEsiDolu = async (i: number): Promise<boolean> => {
        const x = p.degisiklikler[i];
        const o = i > 0 ? p.degisiklikler[i - 1] : undefined;
        if (!(x.coll === 'locationStocks' && x.tur === 'olusturuldu' && o && o.coll === 'locationStocks' && o.tur === 'silindi')) return false;
        const r = await c.query('SELECT 1 FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', [o.coll, o.id]);
        return r.rows.length > 0;
      };
      try {
        await c.query('BEGIN');
        for (let i = p.degisiklikler.length - 1; i >= 0; i--) {
          const x = p.degisiklikler[i];
          if (tasimaAtla.has(i)) { atlanan.push({ coll: x.coll, id: x.id, neden: 'tasinan_konum_geri_alinmadi' }); continue; }
          const r = await c.query('SELECT data FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', [x.coll, x.id]);
          const mevcut = r.rows.length ? nesne(r.rows[0].data) : null;
          if (mevcut && yabanciMi(mevcut, cid)) { atlanan.push({ coll: x.coll, id: x.id, neden: 'yabanci_kiraci' }); tasimaEsiniAtla(i); continue; }
          const k = geriAlmaKarari(x, mevcut);
          if (k.islem === 'sil' && await tasimaEsiDolu(i)) { atlanan.push({ coll: x.coll, id: x.id, neden: 'eski_kimlikte_belge_var' }); tasimaEsiniAtla(i); continue; }
          if (k.islem === 'atla') { atlanan.push({ coll: x.coll, id: x.id, neden: k.neden, ...(k.atlananAlanlar?.length ? { alanlar: k.atlananAlanlar } : {}) }); tasimaEsiniAtla(i); continue; }
          if (k.islem === 'guncelle') {
            await c.query('UPDATE docs SET data = $3::jsonb, updated_at = now() WHERE coll = $1 AND id = $2', [x.coll, x.id, JSON.stringify(k.veri)]);
            yayin.push({ coll: x.coll, tur: 'set', id: x.id, veri: k.veri });
            if (k.atlananAlanlar.length) atlanan.push({ coll: x.coll, id: x.id, neden: 'alan_sonradan_degisti', alanlar: k.atlananAlanlar });
          } else if (k.islem === 'ekle') {
            const e = await c.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING', [x.coll, x.id, JSON.stringify(k.veri)]);
            if (e.rowCount === 0) { atlanan.push({ coll: x.coll, id: x.id, neden: 'kimlikte_belge_var' }); continue; }
            yayin.push({ coll: x.coll, tur: 'set', id: x.id, veri: k.veri });
          } else {
            await c.query('DELETE FROM docs WHERE coll = $1 AND id = $2', [x.coll, x.id]);
            yayin.push({ coll: x.coll, tur: 'delete', id: x.id, veri: mevcut ?? {} });
          }
          yazilan[x.coll] = (x.coll in yazilan ? yazilan[x.coll] : 0) + 1;
        }
        await c.query('COMMIT');
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch { /* işlem zaten geri döndü */ }
        hatali++;
        atlanan.length = 0;
        ga.atlanan.push({ coll: KAYIT_KOLEKSIYONU, id: parcaKimligi(p.calismaId, p.sira), neden: `parça geri alınamadı: ${mesaj(e)}` });
        continue;
      } finally {
        c.release();
      }
      yayinla(d, yayin);
      for (const [coll, n] of Object.entries(yazilan)) ga.geriYazilan[coll] = (coll in ga.geriYazilan ? ga.geriYazilan[coll] : 0) + n;
      ga.atlanan.push(...atlanan);
    }
    ga.durum = hatali ? 'hata' : 'tamam';
    if (hatali) ga.hata = `${hatali} parça geri alınamadı (yalnız o parçalar).`;
    await d.denetim(g.aktor, GERI_AL_DENETIM_EYLEMI, geriAlDenetimMetni(), cid);
    denetimYazildi = true;
    return baslik;
  } catch (e) {
    ga.durum = 'hata';
    ga.hata = mesaj(e);
    console.error(`[stok-kod-gocu/geri-al] ${g.calismaId}:`, ga.hata);
    return baslik;
  } finally {
    ga.bitis = simdi().toISOString();
    // Başlamış her geri alma TEK denetim satırı bırakır (geri yazılmış parça olabilir); mutlu yol yazamadıysa burada, durumla.
    if (!denetimYazildi) {
      try { await d.denetim(g.aktor, GERI_AL_DENETIM_EYLEMI, `${geriAlDenetimMetni()} · durum ${ga.durum}: ${ga.hata ?? '-'}`, cid); }
      catch (e) { console.error(`[stok-kod-gocu/geri-al] denetim satırı yazılamadı (${g.calismaId}):`, mesaj(e)); }
    }
    try { await basligiYaz(d.havuz, baslik); } catch (e) { console.error(`[stok-kod-gocu/geri-al] başlık yazılamadı (${g.calismaId}):`, mesaj(e)); }
    finally { await bakimKilidiKaldir(d.havuz); }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D5 · pasif liste + DH8 açılış temizliği
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export interface PasifSatiri { kod: string; kartId: string; neden: string | null; calismaId: string | null; tarih: string | null }

/** D5: kiracının `mikroPasif` işaretli kartları — kod + kart kimliği (ad YOK). */
export async function stokKodGocuPasifListesi(h: KuruPgHavuzu, cid: string): Promise<PasifSatiri[]> {
  const metin = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return (await kiraciBelgeleri(h, 'inventory', cid))
    .filter(b => pasifMi(b.veri))
    .map(b => {
      const p = nesne(b.veri.mikroPasif);
      return { kod: kodAnahtari(b.veri.sku), kartId: b.id, neden: metin(p.neden), calismaId: metin(p.calismaId), tarih: metin(p.tarih) };
    })
    .sort((a, b) => (a.kod < b.kod ? -1 : a.kod > b.kod ? 1 : a.kartId < b.kartId ? -1 : 1));
}

const aktorMu = (v: unknown): v is Aktor => {
  const a = nesne(v);
  return typeof a.uid === 'string' && a.uid !== '' && typeof a.email === 'string';
};
/** Başlıkta aktör okunamazsa denetim satırının aktörü (writeAuditLog `userName` boş e-postada «Sunucu» yazar). */
const SUNUCU_AKTORU: Aktor = { uid: 'sunucu', email: '' };

/**
 * DH8: süreç açılışında `stok-kod-gocu ` ile başlayan bakım kilidi kaldırılır (iş süreç içinde koşar; süreç öldüyse iş de öldü) ve
 * çalışmanın başlığı `yarida` olur. Yarım çift yoktur (DH9). Başka açıklamalı kilide (ör. lead-birlestir) DOKUNULMAZ.
 * `denetim` verilirse `yarida` işaretlenen çalışma için TEK denetim satırı yazılır (aktör ve kiracı başlıktan; ad yok) — iş öldüğü
 * için kendi denetim satırını yazamadı, ama işlenmiş çiftleri kalıcıdır (inceleme turu 05.11.2026, MKD3 dizin 2).
 */
export async function stokKodGocuAcilisTemizligi(
  h: UygulaPgHavuzu, simdiIso = new Date().toISOString(), denetim?: UygulaBagimliliklari['denetim'],
): Promise<{ kaldirildi: boolean; calismaId: string | null }> {
  const kilit = await bakimKilidiVar(h);
  if (!kilit || !kilit.aciklama.startsWith(KILIT_ONEKI)) return { kaldirildi: false, calismaId: null };
  const calismaId = kilit.aciklama.slice(KILIT_ONEKI.length).split(' ')[0];
  const { rows } = await h.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [KAYIT_KOLEKSIYONU, calismaId]);
  if (rows.length) {
    const b = nesne(rows[0].data) as unknown as CalismaBasligi;
    let yarida: { aktor: unknown; ne: string } | null = null;
    if (b.durum === 'kosuyor') { b.durum = 'yarida'; b.bitis = simdiIso; b.hata = 'süreç iş sürerken kapandı; açılışta kilit kaldırıldı'; yarida = { aktor: b.aktor, ne: 'uygulama' }; }
    if (b.geriAlma && b.geriAlma.durum === 'kosuyor') { b.geriAlma.durum = 'yarida'; b.geriAlma.bitis = simdiIso; yarida = { aktor: b.geriAlma.aktor, ne: 'geri alma' }; }
    if (yarida) {
      await basligiYaz(h, b);
      const kiraci = typeof b.companyId === 'string' ? b.companyId : '';
      if (denetim && kiraci) {
        try {
          // Başlığın sayıları en çok 25 çiftte bir yazılır; işlenmiş çift sayısı işlemle birlikte yazılan parçalardan sayılır (DH9).
          const { rows: p } = await h.query('SELECT count(*)::int AS n FROM docs WHERE coll = $1 AND id LIKE $2', [KAYIT_KOLEKSIYONU, `${calismaId}~%`]);
          await denetim(aktorMu(yarida.aktor) ? yarida.aktor : SUNUCU_AKTORU, YARIDA_DENETIM_EYLEMI,
            `${calismaId}: ${yarida.ne} yarıda kaldı (süreç kapandı; açılışta kilit kaldırıldı) · kayıtlı çift / pasif parçası ${Number(p[0].n)}`, kiraci);
        } catch (e) { console.error(`[stok-kod-gocu] yarıda kalan çalışmanın denetim satırı yazılamadı (${calismaId}):`, mesaj(e)); }
      }
    }
  }
  await bakimKilidiKaldir(h);
  console.warn(`[stok-kod-gocu] açılışta yarım kalmış kilit kaldırıldı (${calismaId}); başlık «yarida».`);
  return { kaldirildi: true, calismaId };
}
