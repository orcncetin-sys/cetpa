/**
 * magazaPanelIptal.ts — panel belirteci İPTAL çifti (dilim 2a, § 3.6, V8).
 *
 * Koleksiyon `magazaPanelIptal/{uid}` = `{ gecersizOnce: ISO, companyId? }` (`SERVER_ONLY_COLLECTIONS`; /api/db ve akışa
 * kapalı). Okuma / yazma TEK yerdedir; 60 sn önbellek bu çiftin İÇİNDEDİR. Üç çağıran — panel kapısı, `POST /panel/cikis`
 * ve ERP `POST /api/db/session/logout` — AYNI örneği bağlamla alır (server.ts BİR kez kurar).
 *
 * İPTAL DEĞERİ YALNIZ İLERİ GİDER: süreç içi değer ile veritabanından okunan değerin BÜYÜĞÜ geçerlidir; yazım başarısız
 * olsa da süreç içi değer «şimdi» kalır ve süreç yaşadıkça geri alınmaz (`iptalEt` yine fırlatır: panel `cikis` 503 döner,
 * belirteç yine silinir; ERP çıkışı hatayı günlükler, tamamlanır).
 *
 * Kapı kuralı: `yük.bas > gecersizOnce(uid)` ise belirteç yaşar. Okuma HATASI ret değildir — `gecersizOnce` fırlatır, kapı
 * `503 { ok: false }` döner (panel 401'de oturumu siler; veritabanının anlık hatası herkesi panelden düşürmesin).
 */
import type { AdminDbLike } from '../adminDbTypes.js';

export const MAGAZA_PANEL_IPTAL_KOLEKSIYONU = 'magazaPanelIptal';
export const MAGAZA_PANEL_IPTAL_ONBELLEK_MS = 60_000;

export interface PanelIptalDeps {
  adminDb: () => AdminDbLike | null;
  simdi?: () => Date;
}

export interface PanelIptalCifti {
  /** Bu andan ÖNCE başlayan (`bas ≤ değer`) belirteçler geçersiz; hiç iptal yoksa 0. Okuma hatası FIRLATIR. */
  gecersizOnce: (uid: string) => Promise<number>;
  /** Süreç içi değeri hemen «şimdi»ye çeker, sonra tek upsert; yazım başarısızsa FIRLATIR (süreç içi değer kalır). */
  iptalEt: (uid: string, companyId?: string) => Promise<void>;
}

const zamanMs = (v: unknown): number => {
  if (typeof v !== 'string') return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
};

export function iptalKur(D: PanelIptalDeps): PanelIptalCifti {
  const surecIci = new Map<string, number>();
  const dbOnbellek = new Map<string, { ms: number; bitis: number }>();
  const simdi = (): Date => D.simdi?.() ?? new Date();
  const db = (): AdminDbLike => {
    const d = D.adminDb();
    if (!d) throw new Error('magazaPanelIptal: adminDb yok');
    return d;
  };

  return {
    async gecersizOnce(uid) {
      const suan = simdi().getTime();
      let dbMs: number;
      const c = dbOnbellek.get(uid);
      if (c && c.bitis > suan) {
        dbMs = c.ms;
      } else {
        const snap = await db().collection(MAGAZA_PANEL_IPTAL_KOLEKSIYONU).doc(uid).get();
        dbMs = snap.exists ? zamanMs(snap.data()?.gecersizOnce) : 0;
        dbOnbellek.set(uid, { ms: dbMs, bitis: suan + MAGAZA_PANEL_IPTAL_ONBELLEK_MS });
      }
      const surec = surecIci.get(uid);
      return surec === undefined ? dbMs : Math.max(surec, dbMs);
    },
    async iptalEt(uid, companyId) {
      const suan = simdi().getTime();
      const onceki = surecIci.get(uid);
      surecIci.set(uid, onceki === undefined ? suan : Math.max(onceki, suan));
      await db().collection(MAGAZA_PANEL_IPTAL_KOLEKSIYONU).doc(uid).set({
        gecersizOnce: new Date(suan).toISOString(),
        ...(companyId !== undefined ? { companyId } : {}),
      });
      // Yazım başarılı: önbellek de ileri alınır (başka örnek yok; aynı süreçte okuma zaten süreç içi değeri görür).
      const c = dbOnbellek.get(uid);
      dbOnbellek.set(uid, { ms: c === undefined ? suan : Math.max(c.ms, suan), bitis: suan + MAGAZA_PANEL_IPTAL_ONBELLEK_MS });
    },
  };
}
