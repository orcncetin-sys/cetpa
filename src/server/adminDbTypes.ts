/**
 * adminDbTypes.ts - Ayrilan sunucu modullerinin `adminDb`'den KULLANDIGI yuzey.
 *
 * NEDEN VAR (2026-08-24, D4 refactor'unun 4. adiminda yakalandi):
 * server.ts bolunurken her modul bagimliligi `getAdminDb: () => any` diye
 * aliyordu. `any` TIP DENETIMINI TAMAMEN KAPATIR: server.ts'te `PgFirestore`
 * tipine karsi denetlenen 20+ cagri, tasindiktan sonra denetimsiz kaldi.
 *
 * KANITLANDI (tahmin degil): modullerden birine `getAdminDb().collcetion(...)`
 * yazim hatasi enjekte edildi ve `tsc --noEmit` SIFIR hata verdi. Boyle bir
 * hata calisma aninda "is not a function" olarak patlar - ustelik cogu cagri
 * 04:00/08:30 cron'larinin icinde ve oradaki `catch` onu console.warn'a
 * cevirip sessizlestirir. Bu oturumda ayni sessiz-hata sinifi iki kez daha
 * yasandi (olu useDataSync dinleyicileri -> dosya 2026-08-25'te silindi,
 * initMikroMirror sira hatasi).
 *
 * COZUM: `any` yerine, modullerin GERCEKTEN kullandigi yuzey. Olculdu:
 *   collection(ad).doc(id?).get() / .set(veri, opts?)
 *   collection(ad).get()
 *   batch().set() / .update() / .delete() / .commit()
 * Tam PgFirestore sinifini import etmek server.ts'e geri bagimlilik yaratirdi;
 * yapisal tip hem denetim saglar hem modulleri bagimsiz birakir (testte sahte
 * bir nesne yeterli).
 *
 * 2026-08-26'da GENISLETILDI: kanalRoutes/paymentRoutes cikarilirken tsc
 * `where` ve `add`in eksik oldugunu soyledi — yani tip, shim'in gercek
 * yuzeyinden DARDI ve o cagrilar `any` iken denetimsiz gecmisti. Zincirlenebilir
 * sorgu (`AdminQuery`) eklendi.
 *
 * YENI BIR METOT GEREKIRSE buraya ekle - `any`'ye geri donme.
 */

/** Bir dokumanin okuma sonucu. */
export interface AdminDocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  data(): Record<string, unknown> | undefined;
}

/** Koleksiyon okuma sonucu. */
export interface AdminQuerySnapshot {
  readonly docs: Array<{
    readonly id: string;
    data(): Record<string, unknown>;
    readonly ref: AdminDocRef;
  }>;
}

export interface AdminDocRef {
  readonly id: string;
  get(): Promise<AdminDocSnapshot>;
  set(veri: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>;
}

/**
 * Koleksiyon sorgusunun sonucu. `AdminQuerySnapshot`ten farki `empty`/`size`
 * tasimasi.
 *
 * NEDEN AYRI TIP: `tenantSnap` (server.ts) YALNIZ `{ docs }` donuyor — ona
 * `empty` sart kosmak cagrilari kirardi. Koleksiyonun kendi `.get()`i ise
 * shim'de (pgShim.ts:281) `empty` ve `size` de donduruyor. Iki farkli GERCEK
 * yuzey var; tek tipe zorlamak birini yalan soylemek olurdu.
 */
export interface AdminCollectionSnapshot extends AdminQuerySnapshot {
  readonly empty: boolean;
  readonly size: number;
}

/** Zincirlenebilir sorgu — `where`/`orderBy`/`limit` sonra `get()`. */
export interface AdminQuery {
  where(alan: string, op: string, deger: unknown): AdminQuery;
  orderBy(alan: string, yon?: 'asc' | 'desc'): AdminQuery;
  limit(n: number): AdminQuery;
  get(): Promise<AdminCollectionSnapshot>;
}

export interface AdminCollectionRef extends AdminQuery {
  /** id verilmezse yeni bir kimlik uretilir. */
  doc(id?: string): AdminDocRef;
  /** Yeni dokuman ekler (id uretilir). */
  add(veri: Record<string, unknown>): Promise<AdminDocRef>;
}

export interface AdminBatch {
  set(ref: AdminDocRef, veri: Record<string, unknown>, opts?: { merge?: boolean }): void;
  update(ref: AdminDocRef, veri: Record<string, unknown>): void;
  delete(ref: AdminDocRef): void;
  commit(): Promise<unknown>;
}

/** Modullerin bagimlilik olarak aldigi `adminDb` yuzeyi. */
export interface AdminDbLike {
  collection(ad: string): AdminCollectionRef;
  batch(): AdminBatch;
}
