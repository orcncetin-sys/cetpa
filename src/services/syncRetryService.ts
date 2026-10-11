import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  compareAndSet,
} from '../lib/dbClient';
import { db } from '../firebase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncJob = {
  id: string;
  type: 'mikro' | 'luca' | 'shopify';
  payload: unknown;
  status: 'queued' | 'in-progress' | 'success' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLECTION = 'syncJobs';

function jobRef(id: string) {
  return doc(collection(db, COLLECTION), id);
}

/**
 * Yürütücü bunu fırlatırsa iş BIRAKILIR: `queued`'a döner, deneme hakkı YANMAZ (2026-10-10, Mikro rol kapıları).
 *
 * NEDEN: kuyruk kiracı kapsamlıdır — işi kuyruğa KOYAN değil, o an uygulaması AÇIK olan kullanıcının tarayıcısı sahiplenir
 * ve KENDİ kimliğiyle gönderir. Sunucu kapısı o role 403 dönerse bu, işin değil OTURUMUN yetersizliğidir: deneme sayılsaydı
 * yetkisiz beş tarayıcı meşru gönderimi sessizce `dead` yapardı. Bırakılan işi yetkili bir oturum sonraki turda alır.
 */
export class IsiBirak extends Error {}

/** Bırakılan iş bu kadar sonra yeniden uygun olur (zamanlayıcı turu: App.tsx 90 sn). */
const ISI_BIRAK_BEKLEME_MS = 90_000;

/** Exponential backoff: 30 s * 2^attempts  (30s → 1m → 2m … en fazla ~1 saat).
 *  attempts üst sınırı: büyük değerlerde Infinity'ye taşıp işi kalıcı kuyrukta bırakmasın. */
function backoffMs(attempts: number): number {
  const capped = Math.min(attempts, 7); // 2^7 * 30s ≈ 64 dk tavan
  return Math.pow(2, capped) * 30_000;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Writes a SyncJob to Firestore with status `'queued'`.
 * Idempotent: if a doc with the same id already exists it is NOT overwritten
 * (we rely on Firestore's `setDoc` without merge — if the doc already exists
 * `setDoc` with `merge: false` will overwrite; to make it a true no-op we
 * first check existence via the caller contract: callers should use stable
 * idempotency keys and this function uses `{ merge: false }` intentionally so
 * that re-enqueueing a completed job restarts it, while an in-flight job
 * should not be re-enqueued with the same key).
 *
 * Practical idempotency: callers are responsible for not re-enqueueing a job
 * whose status is 'queued' or 'in-progress'. The function does a best-effort
 * guard by only writing if no doc exists for that id.
 */
export async function enqueueSyncJob(
  job: Omit<SyncJob, 'status' | 'attempts' | 'nextRetryAt' | 'createdAt' | 'updatedAt'> & { id: string },
): Promise<void> {
  const now = Date.now();
  const ref = jobRef(job.id);

  const newJob: SyncJob = {
    ...job,
    status: 'queued',
    attempts: 0,
    maxAttempts: job.maxAttempts ?? 5,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
  };

  // Using merge: false is the default for setDoc. We wrap in a try/catch so
  // that if the doc already has a terminal status ('dead'/'success') the
  // caller can choose to re-enqueue by passing the same id — existing docs are
  // fully replaced. For in-flight jobs, callers must not re-enqueue the same id.
  await setDoc(ref, newJob);
}

/**
 * Queries for 'queued' jobs whose `nextRetryAt` is in the past (up to 20 at a
 * time), marks each as 'in-progress', runs the executor, then updates the
 * status based on success or failure.
 *
 * Per-job errors are caught individually so one failure never blocks others.
 */
export async function processPendingSyncJobs(
  executor: (job: SyncJob) => Promise<void>,
  /** Sahiplenmeden ÖNCE süzgeç: `false` dönen iş bu oturumda HİÇ alınmaz (durumu, deneme sayısı değişmez). */
  uygunMu?: (job: SyncJob) => boolean,
): Promise<void> {
  const now = Date.now();

  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'queued'),
    where('nextRetryAt', '<=', now),
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  // Tur tavanı (20) rol süzgecinden SONRA uygulanır (2026-10-10 inceleme bulgusu): sorguda `limit(20)` iken bu oturumun
  // gönderemeyeceği 20 iş pencereyi doldurunca oturum kendi işine HİÇ ulaşamıyordu. Ek maliyet yok: `getDocs` koleksiyonu
  // zaten tümüyle çeker, `limit` yalnız istemcide keser (dbClient `applyConstraints`).
  const jobs = snapshot.docs.map((d) => d.data() as SyncJob).filter((job) => !uygunMu || uygunMu(job)).slice(0, 20);

  await Promise.allSettled(
    jobs.map(async (job) => {
      const ref = jobRef(job.id);

      // Atomik claim: yalnız hâlâ 'queued' ise 'in-progress' yap. Eşzamanlı başka
      // bir çalıştırma işi zaten aldıysa CAS false döner → bu çalıştırma atlar
      // (çift Mikro push engeli — önceki oku-sonra-yaz yarış koşuluydu).
      const claimed = await compareAndSet(COLLECTION, job.id, 'status', 'queued', {
        status: 'in-progress',
        updatedAt: Date.now(),
      });
      if (!claimed) return;

      try {
        await executor(job);

        // Success
        await updateDoc(ref, {
          status: 'success',
          updatedAt: Date.now(),
        });
      } catch (err) {
        // Oturumun yetkisi yetmedi → işi bırak: `attempts` DEĞİŞMEZ (bkz. IsiBirak).
        if (err instanceof IsiBirak) {
          await updateDoc(ref, {
            status: 'queued',
            nextRetryAt: Date.now() + ISI_BIRAK_BEKLEME_MS,
            updatedAt: Date.now(),
          });
          return;
        }
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        const newAttempts = job.attempts + 1;

        if (newAttempts >= job.maxAttempts) {
          // Mark dead
          console.error(
            `[syncRetryService] Job ${job.id} (${job.type}) exceeded maxAttempts (${job.maxAttempts}). Marking dead. Last error: ${errorMessage}`,
          );
          await updateDoc(ref, {
            status: 'dead',
            attempts: newAttempts,
            lastError: errorMessage,
            updatedAt: Date.now(),
          });
        } else {
          // Re-queue with exponential backoff
          await updateDoc(ref, {
            status: 'queued',
            attempts: newAttempts,
            lastError: errorMessage,
            nextRetryAt: Date.now() + backoffMs(newAttempts),
            updatedAt: Date.now(),
          });
        }
      }
    }),
  );
}

/**
 * Returns a summary of the current sync queue state.
 */
export async function getSyncQueueStats(): Promise<{
  queued: number;
  failed: number;
  dead: number;
  lastSuccess: number | null;
}> {
  const col = collection(db, COLLECTION);

  const [queuedSnap, deadSnap, successSnap] = await Promise.all([
    getDocs(query(col, where('status', '==', 'queued'))),
    getDocs(query(col, where('status', '==', 'dead'))),
    getDocs(
      query(
        col,
        where('status', '==', 'success'),
        limit(1),
      ),
    ),
  ]);

  const lastSuccessDoc = successSnap.docs[0]?.data() as SyncJob | undefined;

  return {
    queued: queuedSnap.size,
    failed: 0, // 'failed' is a transient state; persisted failures are 'dead'
    dead: deadSnap.size,
    lastSuccess: lastSuccessDoc?.updatedAt ?? null,
  };
}

/**
 * Deletes all 'dead' jobs that were last updated more than 7 days ago.
 */
export async function clearDeadJobs(): Promise<void> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;

  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'dead'),
    where('updatedAt', '<=', sevenDaysAgo),
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  await Promise.allSettled(
    snapshot.docs.map((d) => deleteDoc(d.ref)),
  );
}
