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
 * yasandi (olu useDataSync dinleyicileri, initMikroMirror sira hatasi).
 *
 * COZUM: `any` yerine, modullerin GERCEKTEN kullandigi yuzey. Olculdu:
 *   collection(ad).doc(id?).get() / .set(veri, opts?)
 *   collection(ad).get()
 *   batch().set() / .update() / .delete() / .commit()
 * Tam PgFirestore sinifini import etmek server.ts'e geri bagimlilik yaratirdi;
 * yapisal tip hem denetim saglar hem modulleri bagimsiz birakir (testte sahte
 * bir nesne yeterli).
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

export interface AdminCollectionRef {
  /** id verilmezse yeni bir kimlik uretilir. */
  doc(id?: string): AdminDocRef;
  get(): Promise<AdminQuerySnapshot>;
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
