/**
 * trafikRoutes.ts - CEREZSIZ site trafigi sayaci (2 rota).
 *
 * Kullanici karari (2026-08-28): trafik istatistigi icin GA4 YANINDA kendi
 * sayacimiz da olsun. Bu modul "kendi sayacimiz" tarafi:
 *
 *   - CEREZ YOK, KIMLIK YOK, IP SAKLANMAZ -> KVKK'da cerez onay bandi
 *     GEREKTIRMEZ (kisisel veri islenmiyor; gunluk toplam sayilardan ibaret).
 *   - Dis bagimlilik yok, kart/hesap yok - veriler kendi PostgreSQL'imizde.
 *
 * ## Veri modeli
 *
 * `trafikGunluk` koleksiyonu (SERVER_ONLY - istemci /api/db'den OKUYAMAZ,
 * super-admin ucu uzerinden okunur), dokuman kimligi `YYYY-MM-DD`:
 *   { gun, sayfalar: { '/': 12, '/crm': 5, ... }, kaynaklar: { 'google.com': 3 },
 *     toplam: 17 }
 *
 * ## Kardinalite ve PII savunmasi
 *
 * Sayfa yolu ISTEMCIDEN GELDIGI GIBI YAZILMAZ. Bilinen yollar listesiyle
 * (TOP_LEVEL_TABS + PUBLIC_PATHS + '/') eslesmeyenler 'diger' kovasina
 * dusurulur. Boylece:
 *   1. Kotu niyetli istemci milyonlarca benzersiz "yol" ile dokumani
 *      sisiremez (kardinalite patlamasi),
 *   2. Yola gomulmus olasi kisisel veri (?track=... gibi) HIC diske degmez
 *      (sorgu dizesi zaten istemcide atiliyor, burada da ayrica kirpiliyor).
 * Ayni savunma referrer icin: yalniz HOST adi alinir, o da 100 karakterle
 * kirpilir.
 *
 * ## Neden kimliksiz (requireAuth YOK)
 *
 * Sayac, oturum acmamis ziyaretcileri de saymali (landing trafigi tam da bu).
 * Kotuye kullanim yuzeyi dar: yalniz sayi arttirir, hicbir sey okumaz/silmez.
 * Hiz limiti (dakikada 30/IP) + kova sinirlamasi kalan riski kapatir.
 * IP yalniz hiz limitinin BELLEK ICI anahtaridir, diske yazilmaz.
 *
 * server.ts'ten cagrilir. Onceki rota gruplariyla AYNI desen: bagimliliklar
 * ACIK baglam nesnesiyle gecer, `import` DEGIL - server.ts bu modulu import
 * ettigi icin ters yonde import DONGU olurdu.
 *
 * ARA KATMAN ZINCIRI: cagri server.ts'te digerleriyle AYNI noktada
 * (express.json + apiLimiter'dan SONRA) olmali - yukari alinirsa POST govdesi
 * okunamaz (2026-08-24 mikroRoutes arizasi sinifi).
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import { TOP_LEVEL_TABS } from '../../lib/topLevelTabs.js';
import { PUBLIC_PATHS } from '../../lib/publicPaths.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface TrafikRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: unknown;
  requireSuperAdmin: unknown;
  /** dakikada 30/IP - yalniz bu ucun kendi limiti (apiLimiter'a EK). */
  hitLimiter: unknown;
  pgServerTimestamp: () => unknown;
}

/** Izinli sayfa kovalari - bilinmeyen her sey 'diger'e duser. */
const IZINLI_YOLLAR: ReadonlySet<string> = new Set([
  '/',
  ...[...TOP_LEVEL_TABS].map(t => `/${t}`),
  ...Object.values(PUBLIC_PATHS),
]);

function yolKovasi(ham: unknown): string {
  if (typeof ham !== 'string' || !ham) return 'diger';
  // Sorgu/parca at, sondaki egik cizgiyi normalize et.
  const yol = ham.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return IZINLI_YOLLAR.has(yol) ? yol : 'diger';
}

function kaynakKovasi(ham: unknown): string | null {
  if (typeof ham !== 'string' || !ham) return null;
  try {
    const host = new URL(ham).hostname.replace(/^www\./, '').slice(0, 100);
    // Kendi alanimizdan gelen gecisler "kaynak" degildir.
    if (!host || host.endsWith('cetpa.com.tr') || host === 'localhost') return null;
    return host;
  } catch {
    return null;
  }
}

/** Gun anahtari - Turkiye saatiyle (sunucunun dilimi ne olursa olsun). */
function bugunTR(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' })
    .format(new Date()); // sv-SE bicimi = YYYY-MM-DD
}

export function trafikRoutes(app: Express, C: TrafikRouteCtx): void {
  // ── 1) Sayim ucu - KIMLIKSIZ (bkz. dosya basligi) ─────────────────────
  app.post('/api/hit', C.hitLimiter as never, async (req: Request, res: Response) => {
    // Ne olursa olsun 204: sayac istemciyi ASLA yavaslatmaz/kirmaz.
    // sendBeacon yaniti okumaz; hata durumunda bile sessiz kalinir.
    res.status(204).end();
    try {
      const gun = bugunTR();
      const yol = yolKovasi((req.body as Record<string, unknown> | undefined)?.p);
      const kaynak = kaynakKovasi((req.body as Record<string, unknown> | undefined)?.r);
      const ref = C.getAdminDb().collection('trafikGunluk').doc(gun);
      const snap = await ref.get();
      const eski = (snap?.exists ? snap.data() : null) as
        | { sayfalar?: Record<string, number>; kaynaklar?: Record<string, number>; toplam?: number }
        | null;
      const sayfalar = { ...(eski?.sayfalar ?? {}) };
      sayfalar[yol] = (sayfalar[yol] ?? 0) + 1;
      const kaynaklar = { ...(eski?.kaynaklar ?? {}) };
      if (kaynak) {
        // Kaynak kovasi da sinirli: gunde en fazla 50 farkli host tutulur,
        // fazlasi 'diger'e - dokuman sisiremesin.
        const anahtar = (kaynak in kaynaklar || Object.keys(kaynaklar).length < 50) ? kaynak : 'diger';
        kaynaklar[anahtar] = (kaynaklar[anahtar] ?? 0) + 1;
      }
      await ref.set({
        gun,
        sayfalar,
        kaynaklar,
        toplam: (eski?.toplam ?? 0) + 1,
        updatedAt: C.pgServerTimestamp(),
      }, { merge: true });
    } catch {
      // Sayac hatasi uygulamayi ilgilendirmez; watchdog PG'yi zaten izliyor.
    }
  });

  // ── 2) Okuma ucu - YALNIZ super-admin ─────────────────────────────────
  // trafikGunluk SERVER_ONLY oldugu icin /api/db ve SSE'den gorunmez;
  // panel bu uctan okur.
  app.get('/api/trafik/ozet', C.requireAuth as never, C.requireSuperAdmin as never,
    async (req: Request, res: Response) => {
      try {
        const gunSayisi = Math.min(90, Math.max(1, Number(req.query.gun) || 30));
        const snap = await C.getAdminDb().collection('trafikGunluk')
          .orderBy('gun', 'desc').limit(gunSayisi).get();
        const gunler = snap.docs
          .map(d => d.data() as { gun: string; toplam?: number; sayfalar?: Record<string, number>; kaynaklar?: Record<string, number> })
          .sort((a, b) => a.gun.localeCompare(b.gun));
        res.json({ success: true, gunler });
      } catch (e) {
        res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
}
