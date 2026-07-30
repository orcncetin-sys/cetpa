/**
 * lazyCollections.ts — Hangi koleksiyonun AÇILIŞTA değil, ilgili sekme ilk kez
 * açıldığında dinlenmeye başlayacağını tanımlar.
 *
 * Sorun: uygulama açılışında ~85 koleksiyona abone olunuyordu ve SSE `init`
 * her birinin TÜM satırlarını tarayıcıya basıyordu. Modüle hiç girilmese bile
 * o modülün verisi indiriliyordu.
 *
 * Tasarım — "yapışkan": kapı bir kez açıldıktan sonra KAPANMAZ. Kullanıcı
 * modüle girip çıktığında abonelik sürer, böylece o modülün verisi canlı kalır
 * ve sekmeler arası gidip gelmek yeniden indirme tetiklemez. Kazanç, hiç
 * girilmeyen modüllerin hiç indirilmemesinde.
 *
 * Muhafazakâr liste: yalnız hangi sekmede render edildiği KODDA DOĞRULANMIŞ
 * koleksiyonlar burada. Haritada olmayan her koleksiyon eskisi gibi açılışta
 * dinlenir — yanlış eşleme yüzünden bir modülün boş görünmesi riski yok.
 *
 * Yeni bir koleksiyonu buraya eklemeden önce tüketicisini bul ve hangi
 * activeTab bloğunun içinde render edildiğini doğrula.
 */

/** koleksiyon → o koleksiyonu render eden activeTab değerleri */
export const LAZY_COLLECTION_TABS: Record<string, readonly string[]> = {
  // App.tsx:5109 `activeTab === 'proje'` bloğunda render ediliyor
  projectCosts:     ['proje'],
  projectTimelines: ['proje'],
  // App.tsx:5409 `activeTab === 'production'`
  capacityLines:    ['production'],
  productionOrders: ['production'],
  // App.tsx:4602 `activeTab === 'muhasebe'` (MuhasebePage'e prop olarak geçiyor)
  revenueContracts: ['muhasebe'],
  letterOfCredit:   ['muhasebe'],
  recurringBilling: ['muhasebe'],
  intercompanyTxns: ['muhasebe'],
  // App.tsx:6120 `activeTab === 'inventory'` (InventoryPage'e prop)
  warranties:       ['inventory'],
};

/**
 * Bir kez açılan kapıyı açık tutan modül-seviyesi küme. Modül seviyesinde
 * çünkü hem App.tsx hem useDataSync aynı koleksiyonlara abone oluyor ve
 * ikisinin aynı kararı vermesi gerekiyor. Oturum kapanışında sıfırlanır.
 */
const acilmis = new Set<string>();

/** Bu koleksiyon şu an dinlenmeli mi? Haritada yoksa HER ZAMAN evet. */
export function koleksiyonAktif(coll: string, activeTab: string): boolean {
  const tabs = LAZY_COLLECTION_TABS[coll];
  if (!tabs) return true;           // haritada yok → eski davranış
  if (acilmis.has(coll)) return true; // yapışkan: bir kez açıldı, açık kalır
  if (tabs.includes(activeTab)) { acilmis.add(coll); return true; }
  return false;
}

/** Oturum kapanışı / kullanıcı değişimi — kapıları başa al. */
export function resetLazyCollections(): void { acilmis.clear(); }
