/**
 * yeniSurum.ts — «yeni sürüm var, yenile» denetimi: karar, zamanlama, şerit durumu (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md`
 * S1, S3, S4). Ekran: src/components/YeniSurumSeridi.tsx (App kökünde, her sayfada — giriş ekranı ve dış rol sayfası dâhil).
 *
 * NEDEN: her yayından sonra açık sekmeler eski istemci paketinde kalır — yeni ekran görünmez, eski istemci değişmiş sunucu
 * sözleşmesine istek atıp hata alabilir; kullanıcı yenilemesi gerektiğini bilmez.
 *
 * NASIL:
 *  • Sekmenin çalıştırdığı paketin kimliği `index.html`'deki `<meta name="cetpa-surum">`dır (derleme eklentisi gömer:
 *    src/derleme/surumEklentisi.ts). Meta yoksa / biçim dışıysa (geliştirme sunucusu) denetim HİÇ başlamaz: istek yok,
 *    zamanlayıcı yok, bildirim yok (S1: kimlik uydurulmaz).
 *  • Açılıştan sonra 5 dakikada bir ve sekme yeniden görünür olduğunda `GET /api/surum` sorulur; sunucunun kimliği gömülüden
 *    FARKLIYSA şerit çıkar. Olağan açılışta sorulmaz: sunucu `index.html`'i `Cache-Control: public, max-age=0` + ETag ile
 *    verir (server.ts statik bölümü — `express.static` `maxAge: 0` ve SPA yedeği `sendFile`; «önbelleksiz» DEĞİL, her
 *    kullanımda yeniden doğrulanır) ve hizmet çalışanı gezinmeyi ağdan ister (public/sw.js); yani açılan sekme o an yayındaki
 *    paketi çalıştırır. İSTİSNA — geri / ileri gezinme (`PerformanceNavigationTiming.type === 'back_forward'`): tarayıcı geçmiş
 *    gezinmesinde önbellekteki `index.html`'i yeniden doğrulamadan kullanabilir, sekme eski paketle açılır → açılışta BİR KEZ
 *    sorulur. (İleri-geri önbelleğinden donmuş hâliyle dönen sayfada bu betik yeniden koşmaz; gerçek tarayıcıdaki davranış
 *    ÖLÇÜLMEDİ — orada görünürlük denetimine kalır.)
 *    İki yük sınırı (gösterilen şeyi değiştirmez): sekme gizliyken 5 dakikalık tur atlanır (görünür olunca zaten sorulur);
 *    görünürlük denetimi son denetimden en az 1 dakika sonra koşar (sekmeler arası hızlı geçiş her seferinde istek atmasın —
 *    bir ofisin bütün sekmeleri aynı IP'den aynı kovaya sorar).
 *  • Kapatılan şerit aynı sürüm için bir daha çıkmaz; DAHA YENİ bir sürüm yayına girince yine çıkar.
 *  • Ağ hatası / 5xx / 429 / bozuk yanıt: sessizce yok sayılır — bildirim çıkmaz, konsola tek uyarı (art arda hatalarda
 *    yine tek; bir başarılı denetimden sonra sayaç sıfırlanır).
 *  • Kendiliğinden yenileme YOK (S4): kullanıcı form doldururken veri kaybı. Yalnız «Yenile» düğmesi `location.reload()` yapar.
 *  • S4 istisnası: tembel yüklenen bir sayfanın parçası sunucuda artık yoksa (`/assets/…` 404) şerit «Bu sayfa için yenileme
 *    gerekiyor» der. Vite her başarısız dinamik içe aktarmada `vite:preloadError` olayı yayar; iletide parça adresi varsa
 *    (Chrome, Firefox) adres önbelleksiz HEAD ile sorulur ve yalnız 404'te şerit çıkar (ağ kopukluğu 404 değildir). 404
 *    doğrulanınca sunucunun sürümü de sorulur ve şerit O SÜRÜME bağlanır (sekmeninkinden farklıysa o, değilse / ölçülemezse
 *    `null`): kullanıcı şeridi kapatınca aynı yayın için 5 dakika sonra «yeni sürüm» şeridi olarak geri gelmez. Sürüm
 *    ölçülemediyse (`null` şerit) kapatma «bekleyen» kalır; sonraki ilk başarılı ölçümde sunucunun sürümü sekmeninkinden
 *    farklıysa o sürüm kapatılmış sayılır (Y6, `bekleyeniBagla`). Bedeli (kabul): 404 kapatıldıktan sonra ilk başarılı
 *    ölçümden önce bir yayın daha çıkarsa onun şeridi de bastırılır. Adres iletide yoksa (Safari: «Importing a module script
 *    failed.») sunucunun sürümü pakettekinden farklıysa eksik parça budur.
 */
import { SURUM_META_ADI, SURUM_UCU, surumGecerli } from './surumKimligi';

/** Düzenli denetim aralığı (S3). */
export const SURUM_DENETIM_ARALIGI_MS = 5 * 60 * 1000;
/** Görünürlük denetiminin son denetimden sonra beklediği en kısa süre. */
export const GORUNURLUK_EN_AZ_ARA_MS = 60 * 1000;

export type SeritTuru = 'yeni-surum' | 'sayfa-yenileme';
export interface SeritDurumu {
  tur: SeritTuru;
  /** Şeridi çıkaran sunucu sürümü (kapatma hafızası buna yazılır); bilinmiyorsa `null`. */
  surum: string | null;
}

// ── Saf kararlar ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * S3 kararı: şerit yalnız iki kimlik de BİLİNİYOR, sunucununki gömülüden FARKLI ve kullanıcının kapattığı sürüm DEĞİLSE çıkar.
 * Kimliklerden biri bilinmiyorsa (`null`) bildirim yoktur — bilinmeyen sürüm «yeni sürüm» sayılmaz.
 */
export function yeniSurumSeridiGerekli(gomulu: string | null, sunucu: string | null, kapatilan: string | null): boolean {
  if (gomulu === null || sunucu === null) return false;
  return sunucu !== gomulu && sunucu !== kapatilan;
}

/** Sayfaya gömülü sürüm kimliği; meta yoksa ya da biçim dışıysa `null`. */
export function gomuluSurumuOku(belge: ParentNode): string | null {
  const icerik = belge.querySelector(`meta[name="${SURUM_META_ADI}"]`)?.getAttribute('content');
  return surumGecerli(icerik) ? icerik : null;
}

/** `GET /api/surum` gövdesinden kimlik; beklenen biçim dışındaki her şey `null`. */
export function sunucuYanitiniAyikla(govde: unknown): string | null {
  if (!govde || typeof govde !== 'object') return null;
  const surum = (govde as { surum?: unknown }).surum;
  return surumGecerli(surum) ? surum : null;
}

/**
 * Başarısız içe aktarma hatasından AYNI kökendeki `/assets/…` parçasının tam adresi; iletide yoksa `null`.
 * Örnek iletiler — Chrome: «Failed to fetch dynamically imported module: https://…/assets/X-ab12.js»; Firefox: «error loading
 * dynamically imported module: https://…/assets/X-ab12.js»; Vite (stil): «Unable to preload CSS for /assets/X-ab12.css».
 */
export function parcaAdresiniBul(hata: unknown, koken: string): string | null {
  const ileti = hata instanceof Error ? hata.message : typeof hata === 'string' ? hata : '';
  const eslesme = ileti.match(/(?:https?:\/\/[^\s'"()]+?)?\/assets\/[^\s'"()?#]+/);
  if (!eslesme) return null;
  let adres: URL;
  try { adres = new URL(eslesme[0], koken); } catch { return null; }
  if (adres.origin !== koken || !adres.pathname.startsWith('/assets/')) return null;
  return adres.href;
}

// ── Şerit durumu (sekme başına tek depo) ────────────────────────────────────────────────────────────────────────────────────

export interface SeritDeposu {
  /** Gösterilen şerit; yoksa `null`. (`useSyncExternalStore` için kararlı başvuru.) */
  durum: () => SeritDurumu | null;
  /** Kullanıcının kapattığı son sürüm (kapatma hafızası). */
  kapatilan: () => string | null;
  abone: (dinleyici: () => void) => () => void;
  goster: (durum: SeritDurumu) => void;
  /**
   * Kullanıcı kapattı: şerit kalkar; şeridi çıkaran sürüm hafızaya yazılır. Sürümsüz «sayfa yenileme» şeridinde (404 doğrulandı,
   * sunucunun sürümü ölçülemedi) yazılacak sürüm yoktur → kapatma «bekleyen» işaretlenir (`bekleyeniBagla`).
   */
  kapat: () => void;
  /**
   * Bekleyen kapatma varsa onu bu sürüme bağlar (kapatma hafızasına yazar) ve tüketir; yoksa hiçbir şey yapmaz. Denetim, ilk
   * başarılı ölçümde sunucunun sürümü sekmeninkinden FARKLIYSA çağırır (Y6).
   */
  bekleyeniBagla: (surum: string) => void;
  /** Şeridi kaldırır, hafızaya dokunmaz (sunucu sekmenin sürümüne geri döndüyse). */
  gizle: () => void;
}

export function seritDeposuOlustur(): SeritDeposu {
  let mevcut: SeritDurumu | null = null;
  let kapatilanSurum: string | null = null;
  /** Sürümsüz «sayfa yenileme» şeridi kapatıldı, bağlanacağı sürüm henüz ölçülmedi (Y6). */
  let bekleyen = false;
  const dinleyiciler = new Set<() => void>();
  const yay = () => { for (const d of [...dinleyiciler]) d(); };
  return {
    durum: () => mevcut,
    kapatilan: () => kapatilanSurum,
    abone: (d) => { dinleyiciler.add(d); return () => { dinleyiciler.delete(d); }; },
    goster: (d) => {
      if (mevcut && mevcut.tur === d.tur && mevcut.surum === d.surum) return;
      mevcut = { tur: d.tur, surum: d.surum };
      yay();
    },
    kapat: () => {
      if (!mevcut) return;
      if (mevcut.surum !== null) {
        kapatilanSurum = mevcut.surum;
        bekleyen = false;              // kapatma artık bilinen bir sürüme bağlı; önceki bekleyen sonraki yayını bastırmasın
      } else if (mevcut.tur === 'sayfa-yenileme') {
        bekleyen = true;
      }
      mevcut = null;
      yay();
    },
    bekleyeniBagla: (surum) => {
      if (!bekleyen) return;
      bekleyen = false;
      kapatilanSurum = surum;
    },
    gizle: () => { if (mevcut) { mevcut = null; yay(); } },
  };
}

/** Uygulamanın deposu: sekme başına bir tane (bileşen yeniden bağlansa da kapatma hafızası kalır). */
export const seritDeposu = seritDeposuOlustur();

// ── Denetim döngüsü ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Denetimin kullandığı olay hedefi yüzeyi (gerçekte `document` / `window`; sınamada küçük bir sahte). */
interface OlayHedefi {
  addEventListener(tur: string, dinleyici: (olay: Event) => void): void;
  removeEventListener(tur: string, dinleyici: (olay: Event) => void): void;
}

export interface DenetimSecenekleri {
  /** Sekmenin paketine gömülü kimlik (`gomuluSurumuOku`); `null` → denetim başlamaz. */
  gomulu: string | null;
  depo: SeritDeposu;
  getir?: (girdi: string, init?: RequestInit) => Promise<Response>;
  belge?: OlayHedefi & { readonly visibilityState: DocumentVisibilityState };
  pencere?: OlayHedefi & { readonly location: { readonly origin: string } };
  uyar?: (ileti: string) => void;
  simdi?: () => number;
  /**
   * Sekmenin açılış biçimi (`PerformanceNavigationTiming.type`: 'navigate' | 'reload' | 'back_forward' | 'prerender');
   * `null` = bilinmiyor. Sınama verir; verilmezse tarayıcıdan okunur (`gezinmeTuruOku`).
   */
  gezinmeTuru?: string | null;
}

/** Sekmenin açılış biçimi; tarayıcı gezinme kaydı vermiyorsa (eski tarayıcı, jsdom) `null`. */
export function gezinmeTuruOku(): string | null {
  try {
    const kayit = globalThis.performance?.getEntriesByType?.('navigation')[0];
    if (!kayit || !('type' in kayit)) return null;
    return typeof kayit.type === 'string' ? kayit.type : null;
  } catch {
    return null;
  }
}

/** Denetimi başlatır; dönen işlev zamanlayıcıyı ve dinleyicileri kaldırır. */
export function surumDenetimiBaslat(s: DenetimSecenekleri): () => void {
  const gomulu = s.gomulu;
  if (gomulu === null) return () => {};
  const depo = s.depo;
  const getir = s.getir ?? ((girdi: string, init?: RequestInit) => globalThis.fetch(girdi, init));
  const belge = s.belge ?? document;
  const pencere = s.pencere ?? window;
  const uyar = s.uyar ?? ((ileti: string) => { console.warn(ileti); });
  const simdi = s.simdi ?? (() => Date.now());
  const gezinmeTuru = s.gezinmeTuru === undefined ? gezinmeTuruOku() : s.gezinmeTuru;

  let durdu = false;
  let suruyor = false;
  let sonDenetim = simdi();          // olağan açılış = taze paket; ilk soru 5 dakika sonra (geri / ileri gezinme hariç, aşağıda)
  let uyarildi = false;
  const uyariVer = (ileti: string) => { if (!uyarildi) { uyarildi = true; uyar(ileti); } };

  /** Sunucunun kimliği; `undefined` = ölçülemedi (ağ / 5xx / 429 / bozuk yanıt), `null` = sunucuda kimlik yok. */
  async function sunucuSurumu(): Promise<string | null | undefined> {
    try {
      const yanit = await getir(SURUM_UCU, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!yanit.ok) { uyariVer(`[yeni sürüm] ${SURUM_UCU} yanıtı ${yanit.status}; bildirim gösterilmedi`); return undefined; }
      const govde: unknown = await yanit.json();
      uyarildi = false;
      return sunucuYanitiniAyikla(govde);
    } catch {
      uyariVer(`[yeni sürüm] ${SURUM_UCU} sorulamadı (ağ / yanıt); bildirim gösterilmedi`);
      return undefined;
    }
  }

  async function denetle(): Promise<void> {
    if (durdu || suruyor) return;
    suruyor = true;
    sonDenetim = simdi();
    try {
      const sunucu = await sunucuSurumu();
      if (durdu || sunucu === undefined) return;
      // Y6: sürümsüz 404 şeridi kapatılmışsa ilk başarılı ölçümdeki FARKLI sürüm kapatılmış sayılır (parçayı kaldıran yayın
      // odur). Sunucu hâlâ sekmenin sürümünü (ya da kimliksiz `null`) bildiriyorsa bekleyen tüketilmez.
      if (sunucu !== null && sunucu !== gomulu) depo.bekleyeniBagla(sunucu);
      const mevcut = depo.durum();
      if (yeniSurumSeridiGerekli(gomulu, sunucu, depo.kapatilan())) {
        if (mevcut?.tur !== 'sayfa-yenileme') depo.goster({ tur: 'yeni-surum', surum: sunucu });
      } else if (mevcut?.tur === 'yeni-surum' && sunucu === gomulu) {
        depo.gizle();                // yayın geri alındı: sekme yine güncel
      }
    } finally {
      suruyor = false;
    }
  }

  async function parcaHatasi(hata: unknown): Promise<void> {
    if (durdu) return;
    const adres = parcaAdresiniBul(hata, pencere.location.origin);
    if (adres !== null) {
      let kod: number;
      try {
        kod = (await getir(adres, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })).status;
      } catch {
        uyariVer('[yeni sürüm] yüklenemeyen sayfa parçası denetlenemedi (ağ); bildirim gösterilmedi');
        return;
      }
      if (durdu || kod !== 404) return;
      // Şerit, parçayı kaldıran yayının sürümüne bağlanır: kapatılınca kapatma hafızası o sürümü tutar, düzenli denetim aynı
      // yayın için şeridi «yeni sürüm» olarak geri getirmez. Sürüm ölçülemezse (ağ / 5xx) ya da sekmeninkiyle aynıysa `null`
      // — 404 doğrulandı, şerit yine çıkar.
      const sunucu = await sunucuSurumu();
      if (durdu) return;
      depo.goster({ tur: 'sayfa-yenileme', surum: typeof sunucu === 'string' && sunucu !== gomulu ? sunucu : null });
      return;
    }
    const sunucu = await sunucuSurumu();
    if (!durdu && typeof sunucu === 'string' && sunucu !== gomulu) depo.goster({ tur: 'sayfa-yenileme', surum: sunucu });
  }

  const aralik = setInterval(() => {
    if (belge.visibilityState === 'hidden') return;
    void denetle();
  }, SURUM_DENETIM_ARALIGI_MS);
  const gorunurluk = () => {
    if (belge.visibilityState !== 'visible') return;
    if (simdi() - sonDenetim < GORUNURLUK_EN_AZ_ARA_MS) return;
    void denetle();
  };
  const onYuklemeHatasi = (olay: Event) => { void parcaHatasi((olay as Event & { payload?: unknown }).payload); };
  belge.addEventListener('visibilitychange', gorunurluk);
  pencere.addEventListener('vite:preloadError', onYuklemeHatasi);
  // Geri / ileri gezinmede `index.html` yeniden doğrulanmadan önbellekten gelebilir (başlık yorumu): açılışta BİR KEZ sor.
  if (gezinmeTuru === 'back_forward') void denetle();

  return () => {
    durdu = true;
    clearInterval(aralik);
    belge.removeEventListener('visibilitychange', gorunurluk);
    pencere.removeEventListener('vite:preloadError', onYuklemeHatasi);
  };
}
