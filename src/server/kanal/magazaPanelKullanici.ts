/**
 * magazaPanelKullanici.ts — panel kapısının ve ERP mağaza uçlarının KULLANICI okuyucusu (dilim 2a, § 3.5).
 *
 * `panelKullanicisi(uid)` üç okumayı KENDİ yapar ve hatayı YUTMAZ: `users/{uid}`, `companyStatus/{cid}`,
 * `SELECT enabled FROM mfa_secrets WHERE uid = $1`. server.ts'teki `getUserRole` / `getUserCompanyId` / `getCompanyStatus` /
 * `userHasMfa` ÇAĞRILMAZ — dördü de hatayı yutar: `getUserCompanyId` hata anında `uid` yedeğini 60 sn önbellekler, kapı
 * `cid !== yük.cid` görür ve 503 yerine 401 verirdi (kapı ölçümü 57P01: pgShim `PgDocRef.get` fırlatır — fırlatma kapıda
 * `503 { ok: false }` olur, panel oturumu DÜŞMEZ).
 *
 * KENDİ önbelleği vardır (uid → sonuç, 60 sn; yalnız BAŞARILI ve DOLU okuma yazılır); `roleCache` / `companyIdCache` /
 * `companyStatusCache` / `mfaStatusCache` OKUNMAZ. Düşürme ÜÇ yerdedir (server.ts bağlar): (a) `dbEvents` `users` olayında
 * `dusur(ev.id)`; (b) `companyStatus` olayında `temizle()` (cid anahtarlı olay uid anahtarlı önbelleği tek tek düşüremez);
 * (c) `mfaStatusCache.delete(…)` geçen üç satırın yanında `dusur(uid)` (`mfa_secrets` yazımı `docs` olayı üretmez).
 *
 * `ad` = `users.name` → tek satır temizliği + 80 birime kırpma; boşsa e-postanın `@` öncesi; o da boşsa `uid` (kimlik, kişisel
 * veri değil — geçmiş girişi boş adla yazılmasın). `cid = data.companyId || uid` (`getUserCompanyId` formülüyle aynı).
 * Rolü kapalı kümede olmayan (ya da rolsüz) kullanıcı «yok» sayılır (`null` → 403 rol).
 */
import { APP_ROLES } from '../../lib/rbac.js';
import type { AppRole } from '../../lib/rbac.js';
import { MAGAZA_PANEL_AD_SINIRI } from '../../lib/magazaTalep.js';
import type { AdminDbLike } from '../adminDbTypes.js';
import { magazaMetniKirp, magazaMetniTemizle } from './magazaTalep.js';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes.js';

export interface PanelKullanicisi {
  rol: AppRole;
  cid: string;
  /** `companyStatus/{cid}.status`; kayıt yoksa `'active'`. Kapı `'suspended'`i reddeder. */
  firmaDurumu: string;
  mfaAcik: boolean;
  /** Temizlenmiş, ≤ `MAGAZA_PANEL_AD_SINIRI` birim. */
  ad: string;
  eposta: string;
}

export interface PanelKullaniciDeps {
  adminDb: () => AdminDbLike | null;
  pgPool: () => MagazaPgHavuzu | null;
  simdi?: () => Date;
}

export interface PanelKullaniciOkuyucu {
  /** Kullanıcı yoksa / rolü kapalı küme dışındaysa `null`; HERHANGİ bir okuma fırlatırsa FIRLATIR (kapı 503). */
  panelKullanicisi: (uid: string) => Promise<PanelKullanicisi | null>;
  dusur: (uid: string) => void;
  temizle: () => void;
}

export const MAGAZA_PANEL_KULLANICI_ONBELLEK_MS = 60_000;

const rolMu = (v: unknown): v is AppRole => typeof v === 'string' && (APP_ROLES as readonly string[]).includes(v);

/** Görünen ad: temizlik + kırpma; boşsa e-posta öneki; o da boşsa uid. */
export function panelAdiTuret(name: unknown, email: unknown, uid: string): string {
  const temiz = typeof name === 'string' ? magazaMetniTemizle(name, false) : '';
  if (temiz !== '') return magazaMetniKirp(temiz, MAGAZA_PANEL_AD_SINIRI).metin;
  const onek = typeof email === 'string' ? magazaMetniTemizle(email.split('@')[0] ?? '', false) : '';
  if (onek !== '') return magazaMetniKirp(onek, MAGAZA_PANEL_AD_SINIRI).metin;
  return magazaMetniKirp(uid, MAGAZA_PANEL_AD_SINIRI).metin;
}

export function panelKullanicisiKur(D: PanelKullaniciDeps): PanelKullaniciOkuyucu {
  const onbellek = new Map<string, { sonuc: PanelKullanicisi; bitis: number }>();
  const simdiMs = (): number => (D.simdi?.() ?? new Date()).getTime();

  const oku = async (uid: string): Promise<PanelKullanicisi | null> => {
    const db = D.adminDb();
    const havuz = D.pgPool();
    if (!db) throw new Error('magazaPanelKullanici: adminDb yok');
    if (!havuz) throw new Error('magazaPanelKullanici: PostgreSQL havuzu yok');

    const kullanici = await db.collection('users').doc(uid).get();
    if (!kullanici.exists) return null;
    const veri = kullanici.data() ?? {};
    if (!rolMu(veri.role)) return null;
    const cid = typeof veri.companyId === 'string' && veri.companyId !== '' ? veri.companyId : uid;

    const firma = await db.collection('companyStatus').doc(cid).get();
    const firmaVeri = firma.exists ? (firma.data() ?? {}) : {};
    const firmaDurumu = typeof firmaVeri.status === 'string' && firmaVeri.status !== '' ? firmaVeri.status : 'active';

    const { rows } = await havuz.query('SELECT enabled FROM mfa_secrets WHERE uid = $1', [uid]);
    const mfaAcik = rows[0]?.enabled === true;

    return { rol: veri.role, cid, firmaDurumu, mfaAcik, ad: panelAdiTuret(veri.name, veri.email, uid), eposta: typeof veri.email === 'string' ? veri.email : '' };
  };

  return {
    async panelKullanicisi(uid) {
      const c = onbellek.get(uid);
      if (c && c.bitis > simdiMs()) return c.sonuc;
      const sonuc = await oku(uid);
      if (sonuc) onbellek.set(uid, { sonuc, bitis: simdiMs() + MAGAZA_PANEL_KULLANICI_ONBELLEK_MS });
      return sonuc;
    },
    dusur(uid) { onbellek.delete(uid); },
    temizle() { onbellek.clear(); },
  };
}
