/**
 * mikroIsAdi.ts — Mikro import ROTASI → arka plan İŞ ADI, TEK SÖZLÜK (mikro-import-arkaplan, 2026-09-24).
 *
 * İş adı üç yerde aynı olmak ZORUNDA: sunucu `jobs/<isAdi>` dokümanını yazar ve yanıtta `job: isAdi`
 * döner (`src/server/mikro/arkaPlanIsi.ts`), istemci `onSnapshot(doc(db,'jobs',isAdi))` ile dinler
 * (`src/hooks/useArkaPlanIsi.ts`). İki tarafta ayrı liste tutulsaydı bir tarafa eklenen rota diğerinde
 * sessizce yetim kalırdı — bu projede "yazıldı ama bağlanmadı" dört kez tekrarladı. Bu yüzden adı
 * ROTADAN türetiyoruz, elle listeden değil; sunucu da istemci de BU fonksiyonu çağırır.
 *
 * ÖNEKSİZ döner ('jobs/' YOK): istemci `yanit.job === mikroIsAdi(route)` karşılaştırır, öneki
 * `doc(db,'jobs',isAdi)` ekler. Bilinmeyen rota THROW eder — sunucuda fabrika kayıt anında (boot'ta
 * fail-fast), istemcide kart kurulmadan.
 */
const ONEK = '/api/mikro/import/';

/** `'/api/mikro/import/<slug>'` → `'mikroImport-<slug>'`. TEK istisna `stok-miktar` → `'stokMiktarImport'`:
 *  o doküman canlıda VAR ve panel onu okuyor; yeniden adlandırmak son koşunun kaydını yetim bırakırdı. */
export function mikroIsAdi(route: string): string {
  if (!route.startsWith(ONEK)) throw new Error(`mikroIsAdi: '${route}' bir Mikro import rotası değil (beklenen önek ${ONEK}<slug>)`);
  const slug = route.slice(ONEK.length);
  if (!slug || slug.includes('/')) throw new Error(`mikroIsAdi: '${route}' rotasında tek parçalı slug bekleniyor`);
  if (slug === 'stok-miktar') return 'stokMiktarImport';
  return `mikroImport-${slug}`;
}
