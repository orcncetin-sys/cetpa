import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  compareAndSet,
} from '../lib/dbClient';
import { db, auth } from '../firebase';
import {
  KUYRUK_KOLEKSIYONU, isKimligi, isiGonderebilir, kapatilabilir, kuyrukOzeti, kuyrukYurutebilir, kuyruktaKapatabilir,
  type KuyrukOzeti, type YurutucuKimligi,
} from '../lib/kuyrukSahipligi';

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
  /** İşi kuyruğa KOYAN kullanıcı (K10). SUNUCU damgalar (collections.SAHIP_SATIR_ALANI); istemcinin gönderdiği değer yok
   *  sayılır, güncellemeyle değişmez. Damgasız = K10 öncesinden kalan eski iş. Kural: lib/kuyrukSahipligi. */
  sahipUid?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLECTION = KUYRUK_KOLEKSIYONU;

function jobRef(id: string) {
  return doc(collection(db, COLLECTION), id);
}

/**
 * Yürütücü bunu fırlatırsa iş BIRAKILIR: `queued`'a döner, deneme hakkı YANMAZ (2026-10-10, Mikro rol kapıları).
 *
 * NEDEN: iş yalnız SAHİBİNİN oturumunda çalışır (K10 — lib/kuyrukSahipligi) ve sahibi onu KENDİ kimliğiyle gönderir. Sunucu
 * kapısı 403 dönerse bu, işin değil OTURUMUN o anki yetersizliğidir (2FA süresi doldu; rol istemcide bayat): deneme sayılsaydı
 * meşru gönderim beş turda sessizce `dead` olurdu. Bırakılan işi BAŞKA oturum almaz: aynı sahibin oturumu 2FA / rol düzelince
 * yeniden dener; düzelmezse iş bekler, bekçi (`retry_queue`) 24 saatte uyarır ve Yönetici kapatabilir (`takilanIsleriKapat`).
 */
export class IsiBirak extends Error {}

/** Bırakılan iş bu kadar sonra yeniden uygun olur (zamanlayıcı turu: App.tsx 90 sn). */
const ISI_BIRAK_BEKLEME_MS = 90_000;

/** Ölü iş bu kadar saklanır; `clearDeadJobs` daha yenisini silmez (kart düğmeyi yalnız silinecek iş varken çizer). */
export const OLU_IS_SAKLAMA_MS = 7 * 24 * 60 * 60 * 1_000;

/** Yönetici'nin kapattığı işin hata metni (kartta / ölü iş kaydında görünür). */
export const KAPATILAN_IS_HATASI = 'Yönetici kapattı: sahibinin oturumu bu işi gönderemedi (Mikro\'ya GİTMEDİ).';

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
  job: Omit<SyncJob, 'status' | 'attempts' | 'nextRetryAt' | 'createdAt' | 'updatedAt' | 'sahipUid'> & { id: string },
): Promise<void> {
  const now = Date.now();
  // Belge kimliği KULLANICIYA özgü (K10-1): `job.id` yalnız TABANDIR (`mikro_<yöntem>_<varlık>`). İş sahibinindir — başka
  // kullanıcının aynı varlık için açtığı işle aynı kimliği paylaşsaydı sunucu yazmayı reddeder (403) ve yeniden deneme SESSİZCE
  // kaybolurdu (`success` kaydı hiç silinmediği için kalıcı olarak). Sahibi istemci YAZMAZ: sunucu damgalar.
  const uid = auth.currentUser?.uid;
  if (!uid) return;   // oturum yok: yazma zaten 401 olurdu
  const id = isKimligi(job.id, uid);
  const ref = jobRef(id);

  const newJob: SyncJob = {
    ...job,
    id,   // gövdedeki kimlik = belge kimliği (yürütücü yine de BELGEDEN okur)
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
 *
 * `kimlik` = BU oturum (K10) — ZORUNLU. Yalnız `isiGonderebilir(job, kimlik)` olan iş sahiplenilir: kendi işi (Yönetici'de
 * damgasız eski iş de) VE rolünün yöntem kapısından geçtiği iş. Süzgece takılan işe HİÇ dokunulmaz (durumu, deneme sayısı
 * değişmez). Kuyruğu yürütemeyen oturumda (dış rol, rolsüz hesap, kimliksiz çağrı) sorgu da atılmaz.
 */
export async function processPendingSyncJobs(
  executor: (job: SyncJob) => Promise<void>,
  kimlik: YurutucuKimligi,
): Promise<void> {
  if (!kuyrukYurutebilir(kimlik)) return;
  const now = Date.now();

  const q = query(
    collection(db, COLLECTION),
    where('status', '==', 'queued'),
    where('nextRetryAt', '<=', now),
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  // Tur tavanı (20) süzgeçten SONRA uygulanır (2026-10-10 inceleme bulgusu): sorguda `limit(20)` iken bu oturumun
  // gönderemeyeceği 20 iş pencereyi doldurunca oturum kendi işine HİÇ ulaşamıyordu (açlık). Sıra: sahip + rol süzgeci →
  // 20'lik tavan. Ek maliyet yok: `getDocs` koleksiyonu zaten tümüyle çeker, `limit` yalnız istemcide keser (dbClient
  // `applyConstraints`).
  // Kimlik BELGEDEN (`d.id`), gövdedeki `id` alanından DEĞİL (K10-7): gövdeyi işin sahibi yazar — başka bir işin kimliğini
  // taşıyan gövde, Yönetici oturumunun sahiplenme / durum yazımını o işe yönlendirirdi.
  const jobs = snapshot.docs
    .map((d) => ({ ...(d.data() as SyncJob), id: d.id }))
    .filter((job) => isiGonderebilir(job, kimlik))
    .slice(0, 20);

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

/** Kuyruk kartının okuduğu durum — BU oturumun gözünden (bekleyen iş dökümü: lib/kuyrukSahipligi.kuyrukOzeti). */
export interface KuyrukDurumu extends KuyrukOzeti {
  /** Ölü iş (bu oturumun gördüğü: kendi işleri; Yönetici'de kiracının tümü). */
  dead: number;
  /** `clearDeadJobs`'ın sileceği ölü iş: `OLU_IS_SAKLAMA_MS`'ten eski olanlar. */
  temizlenebilir: number;
  lastSuccess: number | null;
}

const BOS_KUYRUK: KuyrukDurumu = { gonderilebilir: 0, rolYetmiyor: 0, baskasinin: 0, kapatilabilir: 0, dead: 0, temizlenebilir: 0, lastSuccess: null };

/** Belgeleri iş olarak okur — kimlik BELGEDEN (bkz. `processPendingSyncJobs`). */
async function isleriOku(): Promise<SyncJob[]> {
  const snapshot = await getDocs(collection(db, COLLECTION));
  return snapshot.docs.map((d) => ({ ...(d.data() as SyncJob), id: d.id }));
}

/**
 * Kuyruğun bu oturuma görünen durumu. `kimlik` ZORUNLU (K10): sayılar oturuma göredir — sunucu Yönetici dışındaki role yalnız
 * KENDİ işini listeler; Yönetici bütün kuyruğu görür ama yalnız kendi işini (ve damgasız eski işi) gönderir. Kuyruğu
 * yürütemeyen oturumda istek atılmaz, boş durum döner.
 */
export async function getSyncQueueStats(kimlik: YurutucuKimligi): Promise<KuyrukDurumu> {
  if (!kuyrukYurutebilir(kimlik)) return BOS_KUYRUK;
  const now = Date.now();
  const isler = await isleriOku();
  const oluler = isler.filter((j) => j.status === 'dead');
  // «En son» başarı: eskiden ilk bulunan `success` kaydının zamanı dönüyordu (sıra belirsiz).
  // `success` kayıtları hiç silinmez (sayı büyür): `Math.max(...dizi)` yerine tek geçiş.
  const lastSuccess = isler.reduce<number | null>(
    (enYeni, j) => (j.status === 'success' && Number.isFinite(j.updatedAt) && (enYeni === null || j.updatedAt > enYeni) ? j.updatedAt : enYeni),
    null,
  );
  return {
    ...kuyrukOzeti(isler.filter((j) => j.status === 'queued'), kimlik, now),
    dead: oluler.length,
    temizlenebilir: oluler.filter((j) => j.updatedAt <= now - OLU_IS_SAKLAMA_MS).length,
    lastSuccess,
  };
}

/**
 * YÖNETİCİ ÇIKIŞI (K10-8): bu oturumun gönderemeyeceği TAKILI işleri çalıştırmadan ölü işaretler; kapatılan iş sayısını döner.
 * Hangi iş: lib/kuyrukSahipligi.kapatilabilir (yalnız Yönetici; başkasının ya da rolün geçemediği, 24 saatten eski iş).
 * Mikro'ya HİÇBİR ŞEY gitmez. Koşullu yazma (`queued` → `dead`): o arada sahibinin oturumu işi aldıysa dokunulmaz.
 * Sahip alanı değişmez (sunucu korur) — ölü iş kaydında işi kimin koyduğu okunur.
 */
export async function takilanIsleriKapat(kimlik: YurutucuKimligi): Promise<number> {
  if (!kuyruktaKapatabilir(kimlik)) return 0;   // Yönetici değilse sunucuya hiç gidilmez (okuma da atılmaz)
  const now = Date.now();
  const hedef = (await isleriOku()).filter((j) => j.status === 'queued' && kapatilabilir(j, kimlik, now));
  const sonuclar = await Promise.allSettled(hedef.map((j) =>
    compareAndSet(COLLECTION, j.id, 'status', 'queued', { status: 'dead', lastError: KAPATILAN_IS_HATASI, updatedAt: Date.now() })));
  return sonuclar.filter((r) => r.status === 'fulfilled' && r.value).length;
}

/**
 * Deletes all 'dead' jobs that were last updated more than 7 days ago.
 */
export async function clearDeadJobs(): Promise<void> {
  const sevenDaysAgo = Date.now() - OLU_IS_SAKLAMA_MS;

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
