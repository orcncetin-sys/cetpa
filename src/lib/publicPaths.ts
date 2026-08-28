/**
 * publicPaths.ts — kimlik GEREKTİRMEYEN tanıtım/yasal sayfaların yolları.
 *
 * ## Neden tek kaynak
 *
 * Bu sayfalar (ApiPage, BlogPage, CareerPage, PrivacyPage, TermsPage) 933
 * satır olarak YAZILMIŞ ama HİÇBİR YERE BAĞLANMAMIŞTI: `LandingPage`
 * altbilgisinde `<Link to="/privacy">` vardı, uygulamada ise tek bir `<Route>`
 * bile tanımlı değildi. Sonuç sessizdi — tıklayınca URL değişiyor, sayfa
 * değişmiyordu. Yani "Gizlilik Politikası" ve "Kullanım Koşulları" ticari bir
 * sitede açılmıyordu.
 *
 * Bu, projenin iki kez ısırıldığı arıza sınıfının aynısı (ölü `useDataSync` →
 * QR Transfer aylarca ölü; boş `Toast.tsx` stub → 170+ bildirim sessiz):
 * **yazıldı ama bağlanmadı**, ve ne derleyici ne çalışma zamanı bir şey dedi.
 *
 * Tekrarı YAPISAL olarak engelliyoruz:
 *   1. Yol dizeleri YALNIZ burada. `LandingPage` `to={PUBLIC_PATHS.privacy}`
 *      yazar — elle `"/privacy"` yazılmadığı için yazım hatası imkânsız.
 *   2. App.tsx'teki sayfa haritası `Record<PublicPageKey, ...>` tipinde, yani
 *      buraya bir yol eklenip sayfası bağlanmazsa DERLEME KIRILIR.
 *
 * ## `/developers` neden `/api` değil
 *
 * Altbilgideki bağlantı `/api`ye gidiyordu. Sunucudaki SPA geri-düşüşü
 * (server.ts) eşleşmeyen istekleri `index.html`e yönlendirirken `/api/*`
 * öneklilerini JSON 404 ile ayırıyor: `req.path.startsWith('/api/')`. Sondaki
 * eğik çizgi sayesinde tam `/api` bugün SPA'ya düşüyor — ama o koruma bir gün
 * `startsWith('/api')` diye "sadeleştirilirse" sayfa sessizce 404 olur.
 * Bağlantı hiç çalışmadığı için korunacak bir URL de yoktu; çakışması mümkün
 * olmayan `/developers`e taşındı.
 */

export const PUBLIC_PATHS = {
  developers: '/developers',
  blog: '/blog',
  careers: '/careers',
  privacy: '/privacy',
  terms: '/terms',
} as const;

export type PublicPageKey = keyof typeof PUBLIC_PATHS;

const YOLDAN_ANAHTAR = new Map<string, PublicPageKey>(
  (Object.entries(PUBLIC_PATHS) as Array<[PublicPageKey, string]>).map(([k, v]) => [v, k]),
);

/**
 * pathname bir genel sayfaya mı ait? Değilse `null`.
 * Sondaki eğik çizgi yok sayılır (`/terms/` = `/terms`).
 */
export function publicPageKey(pathname: string): PublicPageKey | null {
  const temiz = pathname.replace(/\/+$/, '') || '/';
  return YOLDAN_ANAHTAR.get(temiz) ?? null;
}
