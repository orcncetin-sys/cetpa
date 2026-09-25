/**
 * useArkaPlanIsi.testDuzenegi.ts — `jobs/<isAdi>` okuyan testlerin ORTAK dbClient sahtesi
 * (mikro-import-arkaplan, 2026-09-24). Üç test dosyası (hook, ArkaPlanIsiKarti, MikroSyncPanel)
 * aynı sahteyi kullanır; mikroRoutes.testDuzenegi.ts emsali (test düzeneği kaynak ağacında, vitest
 * `*.test.*` deseniyle toplanmaz).
 *
 * Gerçek dbClient davranışı taklit edilir: koleksiyon hazırsa `subscribe` ilk anlık görüntüyü
 * MİKRO GÖREVDE verir (dbClient `queueMicrotask(listener)`). Burada `Promise.resolve().then`
 * kullanılır ki `vi.useFakeTimers()` (zamanlayıcıları taklit eder, Promise mikro görevlerini ETMEZ)
 * ilk görüntüyü asılı bırakmasın.
 *
 * Kullanım (vi.mock hoist edilir, fabrika bu modülü dinamik import eder):
 *   vi.mock('../lib/dbClient', async () => (await import('./useArkaPlanIsi.testDuzenegi')).dbClientSahtesi);
 *   import { yayinla, hataYayinla, sifirla, abonelikBirakildi } from './useArkaPlanIsi.testDuzenegi';
 *
 * Koleksiyon/sorgu abonelikleri (panelin syncLog / mikroFaturalar dinleyicileri) varsayılan BOŞ görüntü
 * alır; `koleksiyonAyarla(ad, satirlar)` ile abonelikten ÖNCE doldurulabilir (süzgeç/sıralama UYGULANMAZ —
 * sıralama zinciri dbClient.test.ts'in işi, burada yalnız panelin render dalı sınanır).
 */
import { vi } from 'vitest';

export interface SahteDokumanGoruntusu {
  id: string;
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
}
interface Dinleyici { next: (s: SahteDokumanGoruntusu) => void; err?: (e: Error) => void }
interface SahteRef { type: 'doc' | 'collection' | 'query'; id?: string; coll?: string; path?: string }

const dokumanlar = new Map<string, Record<string, unknown>>();
const dinleyiciler = new Map<string, Set<Dinleyici>>();
/** Koleksiyon adı → abonelikte verilecek satırlar (yalnız `koleksiyonAyarla` ile; yoksa boş). */
const koleksiyonlar = new Map<string, { id: string; veri: Record<string, unknown> }[]>();

/** Abonelik bırakıldığında (unsubscribe) doküman id'siyle çağrılır — "abonelik kapatıldı" iddiası. */
export const abonelikBirakildi = vi.fn<(id: string) => void>();

const goruntu = (id: string): SahteDokumanGoruntusu => {
  const v = dokumanlar.get(id);
  return { id, exists: () => v !== undefined, data: () => v };
};

/** `jobs/<id>` dokümanını yazar (null → siler) ve o dokümanın dinleyicilerine anlık görüntü yayınlar. */
export function yayinla(id: string, veri: Record<string, unknown> | null): void {
  if (veri === null) dokumanlar.delete(id); else dokumanlar.set(id, veri);
  for (const d of dinleyiciler.get(id) ?? new Set<Dinleyici>()) d.next(goruntu(id));
}

/** Dinleyicilerin HATA geri çağrısını tetikler (dbClient senkron throw yolu). */
export function hataYayinla(id: string, e: Error): void {
  for (const d of dinleyiciler.get(id) ?? new Set<Dinleyici>()) d.err?.(e);
}

export function dinleyiciSayisi(id: string): number {
  return (dinleyiciler.get(id) ?? new Set<Dinleyici>()).size;
}

/** Koleksiyon/sorgu aboneliğinin ilk (ve tek) görüntüsünü ayarlar — render'dan ÖNCE çağrılır. */
export function koleksiyonAyarla(ad: string, satirlar: { id: string; veri: Record<string, unknown> }[]): void {
  koleksiyonlar.set(ad, satirlar);
}

export function sifirla(): void {
  dokumanlar.clear();
  dinleyiciler.clear();
  koleksiyonlar.clear();
  abonelikBirakildi.mockClear();
}

/** `../lib/dbClient` yerine geçen modül gövdesi. Koleksiyon/sorgu abonelikleri `koleksiyonAyarla` ile
 *  verilen satırları (yoksa BOŞ) alır; doküman abonelikleri `yayinla` ile beslenir. */
export const dbClientSahtesi = {
  doc: (_db: unknown, coll: string, id: string): SahteRef => ({ type: 'doc', coll, id, path: `${coll}/${id}` }),
  collection: (_db: unknown, path: string): SahteRef => ({ type: 'collection', path, id: path }),
  query: (target: SahteRef, ...constraints: unknown[]) => ({ type: 'query', coll: target.path ?? target.coll, constraints }),
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => ({ kind: 'orderBy', field, dir }),
  limit: (n: number) => ({ kind: 'limit', n }),
  onSnapshot: (target: SahteRef, next: (s: unknown) => void, err?: (e: Error) => void): (() => void) => {
    if (target.type !== 'doc' || target.id === undefined) {
      const ad = target.type === 'query' ? target.coll : target.path;
      const docs = (ad === undefined ? [] : koleksiyonlar.get(ad) ?? []).map(r => ({ id: r.id, data: () => r.veri }));
      void Promise.resolve().then(() => next({ docs, size: docs.length, empty: docs.length === 0, forEach: (f: (d: unknown) => void) => docs.forEach(f) }));
      return () => {};
    }
    const id = target.id;
    const kayit: Dinleyici = { next, err };
    let set = dinleyiciler.get(id);
    if (!set) { set = new Set(); dinleyiciler.set(id, set); }
    set.add(kayit);
    // İlk görüntü mikro görevde (gerçek dbClient paritesi); abonelik o arada bırakıldıysa verilmez.
    void Promise.resolve().then(() => { if (set?.has(kayit)) next(goruntu(id)); });
    return () => { set?.delete(kayit); abonelikBirakildi(id); };
  },
};
