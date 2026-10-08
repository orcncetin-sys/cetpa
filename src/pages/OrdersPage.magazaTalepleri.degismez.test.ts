/**
 * DEĞİŞMEZ — Siparişler ekranına «Mağaza Talepleri» üçüncü kaynak sekmesinin BAĞLANTISI (dilim 1, 2026-10-08).
 * «Yazıldı ama bağlanmadı» çitinin (a) parçası; (b) parçası (gerçek çizim) `components/siparis/MagazaTalepleri.test.tsx`.
 *
 * NEDEN VAR: bu projede «yazıldı ama bağlanmadı» üç kez yaşandı (hiç açılmayan `EditOrderModal`, hiç bağlanmayan genel
 * sayfalar, yalnız ölü dosyada duran dinleyiciler). Bileşen ve kanca testleri yeşilken sekme Siparişler ekranında HİÇ
 * görünmeyebilir; bu dosya bağlantının kendisini kilitler.
 *
 * İKİ YÖNTEM:
 *   1. Kaynak dilimi — yorumlar SÜZÜLEREK (çit kendi yorumuna takılmasın) ve uzunluk korumasıyla (işaretçi taşınırsa çit
 *      boş metne bakıp sessizce yeşil kalmasın).
 *   2. JSX ağacı — TypeScript ayrıştırıcısıyla. «'magaza'da sipariş gövdesi çizilmez» kuralı metin aramasıyla kanıtlanamaz
 *      (kapının NEREDE kapandığı önemlidir): sipariş listesi bloğunun çocukları TEK TEK sayılır; kapı dışına eklenen her
 *      yeni öğe bu dosyayı kırar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { yorumsuz } from '../test/degismezTarayici';
import { SRC_KOK, kaynakDosyalari, gorece } from '../test/kaynakTarama';

const YOL = join(__dirname, 'OrdersPage.tsx');
const ham = readFileSync(YOL, 'utf-8');
const kod = yorumsuz(ham).join('\n');
const adet = (metin: string, parca: string): number => metin.split(parca).length - 1;

describe('OrdersPage — mağaza talepleri: yetki kapısı, abonelik, sekme durumu (kaynak dilimi)', () => {
  const bas = kod.indexOf('const magazaYetkili =');
  const son = kod.indexOf('const mikroSiparisler = useMikroSiparisler(');
  const dilim = kod.slice(bas, son);

  it('dilim bulunuyor (işaretçiler taşınırsa çit sessizce boş metne bakmasın)', () => {
    expect(kod.length).toBeGreaterThan(100_000);
    expect(bas).toBeGreaterThan(-1);
    expect(son).toBeGreaterThan(bas);
    expect(dilim.length).toBeGreaterThan(600);
    expect(dilim.length).toBeLessThan(3000);   // araya ilgisiz kod girdiyse dilim yanlış yere bakıyordur
  });

  it('yetki kapısı rbac\'tan: `isAllowed(rol, koleksiyon, \'read\')` — elle yazılmış rol listesi YOK', () => {
    expect(adet(kod, "const magazaYetkili = isAllowed(APP_ROLES.find(r => r === userRole) ?? null, MAGAZA_TALEP_KOLEKSIYONU, 'read');")).toBe(1);
    expect(adet(kod, 'magazaYetkili =')).toBe(1);                                    // ikinci bir tanım / atama yok
    expect(dilim).not.toMatch(/'Admin'|'Manager'|'Sales'|UserRole\.|ADMIN_ROLES|STAFF_ROLES|hasFullAccess|\.includes\(userRole\)/);
    expect(kod).toContain("import { isAllowed, APP_ROLES } from '../lib/rbac';");
    expect(kod).toContain("import { MAGAZA_TALEP_KOLEKSIYONU } from '../lib/magazaTalep';");
    // Rol tip DARALTMASI gerçek denetimle (bilinmeyen metin → null); tip zorlaması ile değil.
    expect(dilim).not.toMatch(/as AppRole|as unknown|as any/);
  });

  it('abonelik kancası OrdersPage GÖVDESİNDE, yetki kapısıyla ve TEK kez çağrılır', () => {
    expect(adet(kod, 'const magaza = useMagazaTalepleri(magazaYetkili);')).toBe(1);
    expect(adet(kod, 'useMagazaTalepleri(')).toBe(1);
    // Kanca koşullu bir dalın / iç işlevin içinde değil: bileşen gövdesinin girintisinde (2 boşluk).
    expect(kod).toMatch(/\n {2}const magaza = useMagazaTalepleri\(magazaYetkili\);\n/);
    expect(kod).toContain("import { useMagazaTalepleri, useMagazaYeniSayaci, magazaSonGorulenAnahtari, magazaIlkKaynakSekmesi } from '../hooks/useMagazaTalepleri';");
  });

  it('`orderSourceTab` üç değerlidir; adresle açılış (`?kaynak=magaza`) İLK çizimde ve yetkiyle', () => {
    expect(adet(kod, "const [seciliKaynak, setOrderSourceTab] = useState<'cetpa' | 'mikro' | 'magaza'>(() => magazaIlkKaynakSekmesi(window.location.search, magazaYetkili));")).toBe(1);
    expect(kod).not.toMatch(/useState<'cetpa' \| 'mikro'>/);
    // `?kaynak=magaza` kuralının kendisi kancanın dosyasında, saf işlevde (davranış testi: hooks/useMagazaTalepleri.test.ts).
    const kanca = yorumsuz(readFileSync(join(SRC_KOK, 'hooks', 'useMagazaTalepleri.ts'), 'utf-8')).join('\n');
    expect(kanca).toContain("return yetkili && new URLSearchParams(arama).get('kaynak') === 'magaza' ? 'magaza' : 'cetpa';");
  });

  it('yetki düşerse «magaza» seçili KALMAZ: çizim ham durumu değil kapıdan geçmiş `orderSourceTab`\'ı okur', () => {
    expect(adet(kod, "const orderSourceTab: 'cetpa' | 'mikro' | 'magaza' = seciliKaynak === 'magaza' && !magazaYetkili ? 'cetpa' : seciliKaynak;")).toBe(1);
    expect(adet(kod, 'seciliKaynak')).toBe(3);   // tanım + yukarıdaki satırdaki iki okuma; başka okuyan YOK
  });

  it('`activeOrders` üç kaynağı AÇIKÇA ayırır — «magaza» Mikro listesine DÜŞMEZ', () => {
    expect(adet(kod, "const activeOrders: Order[] = orderSourceTab === 'cetpa' ? orders : orderSourceTab === 'mikro' ? mappedMikroSiparisler : MAGAZA_SEKMESINDE_SIPARIS_YOK;")).toBe(1);
    expect(adet(kod, 'const activeOrders')).toBe(1);
    expect(kod).not.toMatch(/orderSourceTab === 'cetpa' \? orders : mappedMikroSiparisler/);
    expect(adet(kod, 'const MAGAZA_SEKMESINDE_SIPARIS_YOK: Order[] = [];')).toBe(1);
    expect(adet(kod, 'MAGAZA_SEKMESINDE_SIPARIS_YOK')).toBe(2);   // tanım + activeOrders; başka yerde doldurulmaz
  });

  it('«yeni» sayacı: anahtar kiracı + kullanıcı; liste EKRANDAYKEN «görüldü» sayılır', () => {
    expect(adet(kod, 'const magazaKiraciId = useAppStore(s => s.companyId);')).toBe(1);
    expect(dilim).toMatch(/const magazaYeniSayisi = useMagazaYeniSayaci\(\s+magaza\.talepler,\s+magazaSonGorulenAnahtari\(magazaKiraciId, user\?\.uid\),\s+activeTab === 'orders' && !selectedOrder && orderSourceTab === 'magaza',\s+\);/);
    expect(adet(kod, 'useMagazaYeniSayaci(')).toBe(1);
    // Sayfa `localStorage`'a kendisi dokunmaz (try/catch'li okuma / yazma kancanın dosyasında).
    expect(dilim).not.toMatch(/localStorage|Date\.now\(/);
  });
});

// ── JSX ağacı ───────────────────────────────────────────────────────────────────────────────────────────────────────
const sf = ts.createSourceFile(YOL, ham, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const metin = (n: ts.Node): string => n.getText(sf);
const tek = (s: string): string => s.replace(/\s+/g, ' ').trim();

type JsxOge = ts.JsxElement | ts.JsxSelfClosingElement;
const acilis = (n: JsxOge): ts.JsxOpeningElement | ts.JsxSelfClosingElement => (ts.isJsxElement(n) ? n.openingElement : n);
const etiket = (n: JsxOge): string => metin(acilis(n).tagName);
/** Öğenin nitelikleri: ad → kaynak metni (`"…"` ya da `{…}`); değersiz nitelik `true`. */
function nitelikler(n: JsxOge): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of acilis(n).attributes.properties) {
    if (ts.isJsxAttribute(a)) out[metin(a.name)] = a.initializer ? tek(metin(a.initializer)) : 'true';
  }
  return out;
}
/** Anlamlı çocuklar: yalnız boşluk olan metin ve yorum taşıyan boş `{}` ifadesi ATILIR. */
function cocuklar(n: ts.JsxElement | ts.JsxFragment): ts.JsxChild[] {
  return n.children.filter(c => {
    if (ts.isJsxText(c)) return c.text.trim() !== '';
    if (ts.isJsxExpression(c)) return c.expression !== undefined;
    return true;
  });
}
const parantezsiz = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? parantezsiz(e.expression) : e);
/** `{sol && sag}` kapısı → { sol metni, sağ ifade }; biçim tutmuyorsa null. */
function kapi(c: ts.JsxChild | undefined): { sol: string; sag: ts.Expression } | null {
  if (!c || !ts.isJsxExpression(c) || !c.expression) return null;
  const e = c.expression;
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return null;
  return { sol: tek(metin(e.left)), sag: parantezsiz(e.right) };
}
const jsxOge = (e: ts.Node | undefined): JsxOge | null => (e && (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) ? e : null);

function ogeBul(kok: ts.Node, kosul: (n: JsxOge) => boolean): JsxOge[] {
  const out: JsxOge[] = [];
  const gez = (n: ts.Node): void => {
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && kosul(n)) out.push(n);
    ts.forEachChild(n, gez);
  };
  gez(kok);
  return out;
}

describe('OrdersPage — sipariş listesi bloğu: «magaza»da sipariş gövdesi ÇİZİLMEZ (JSX ağacı)', () => {
  const bloklar = ogeBul(sf, n => etiket(n) === 'motion.div' && nitelikler(n).key === '"orders-list"');
  const blok = bloklar[0];
  const c = blok && ts.isJsxElement(blok) ? cocuklar(blok) : [];

  it('blok TEK ve beş çocuklu: [AI ipucu kapısı, başlık, sekme çubuğu, MağazaTalepleri kapısı, sipariş gövdesi kapısı]', () => {
    expect(bloklar).toHaveLength(1);
    expect(metin(blok).length).toBeGreaterThan(50_000);   // uzunluk koruması: yanlış / boş bloğa bakılmıyor
    // Kapı DIŞINA eklenen her yeni öğe (yeni panel, yeni şerit) bu sayıyı bozar — «magaza»da çizilirdi.
    expect(c).toHaveLength(5);
  });

  it('1. çocuk — AI ipucu `orderSourceTab !== \'magaza\'` kapısında', () => {
    const k = kapi(c[0]);
    expect(k?.sol).toBe("orderSourceTab !== 'magaza'");
    const oge = jsxOge(k?.sag);
    expect(oge && etiket(oge)).toBe('AIInlineNudge');
  });

  it('2. çocuk — başlık: arama / CSV / para birimi düğmeleri kapıda; kapı dışında yalnız «yeni sipariş» düğmesi', () => {
    const baslik = jsxOge(c[1]);
    expect(baslik && etiket(baslik)).toBe('ModuleHeader');
    const dugmeler = baslik ? acilis(baslik).attributes.properties.find(a => ts.isJsxAttribute(a) && metin(a.name) === 'actionButton') : undefined;
    const ifade = dugmeler && ts.isJsxAttribute(dugmeler) && dugmeler.initializer && ts.isJsxExpression(dugmeler.initializer) ? dugmeler.initializer.expression : undefined;
    const kutu = jsxOge(ifade);
    expect(kutu && etiket(kutu)).toBe('div');
    const ic = kutu && ts.isJsxElement(kutu) ? cocuklar(kutu) : [];
    expect(ic).toHaveLength(2);

    const k = kapi(ic[0]);
    expect(k?.sol).toBe("orderSourceTab !== 'magaza'");
    expect(k && ts.isJsxFragment(k.sag)).toBe(true);
    const kapidaki = k ? metin(k.sag) : '';
    expect(kapidaki).toContain('<KpiCurrencyToggle ');           // para birimi
    expect(kapidaki).toContain('value={orderSearch}');            // arama
    expect(kapidaki).toContain('exportOrdersCSV(filtered, currentLanguage);');   // CSV

    const yeniSiparis = jsxOge(ic[1]);
    expect(yeniSiparis && etiket(yeniSiparis)).toBe('button');
    const disaridaki = yeniSiparis ? metin(yeniSiparis) : '';
    expect(disaridaki).toContain('{currentT.new_order}');
    expect(disaridaki).not.toMatch(/activeOrders|orderSearch|KpiCurrencyToggle|exportOrdersCSV/);
    // Başlığın geri kalanı (başlık / alt başlık / simge) sipariş verisi okumaz.
    const n = baslik ? nitelikler(baslik) : {};
    expect(Object.keys(n).sort()).toEqual(['actionButton', 'icon', 'subtitle', 'title']);
  });

  it('3. çocuk — sekme çubuğu: üç düğme AYNI sınıf dizgisini kullanır, `type="button"` ve `aria-pressed` taşır', () => {
    const cubuk = jsxOge(c[2]);
    expect(cubuk && etiket(cubuk)).toBe('div');
    const ic = cubuk && ts.isJsxElement(cubuk) ? cocuklar(cubuk) : [];
    expect(ic).toHaveLength(3);

    const beklenen = (kaynak: string) => ({
      type: '"button"',
      'aria-pressed': `{orderSourceTab === '${kaynak}'}`,
      onClick: `{() => setOrderSourceTab('${kaynak}')}`,
      className: `{kaynakSekmesiSinifi(orderSourceTab === '${kaynak}')}`,
    });
    const cetpa = jsxOge(ic[0]), mikro = jsxOge(ic[1]);
    expect(cetpa && etiket(cetpa)).toBe('button');
    expect(mikro && etiket(mikro)).toBe('button');
    expect(cetpa && nitelikler(cetpa)).toEqual(beklenen('cetpa'));
    expect(mikro && nitelikler(mikro)).toEqual(beklenen('mikro'));

    // Üçüncü düğme YALNIZ yetkili role çizilir.
    const k = kapi(ic[2]);
    expect(k?.sol).toBe('magazaYetkili');
    const magaza = jsxOge(k?.sag);
    expect(magaza && etiket(magaza)).toBe('button');
    expect(magaza && nitelikler(magaza)).toEqual(beklenen('magaza'));
    const govde = magaza ? metin(magaza) : '';
    expect(govde).toContain('{op(currentLanguage).magaza_talepleri}');
    expect(govde).toContain('<MagazaYeniRozeti sayi={magazaYeniSayisi} currentLanguage={currentLanguage} />');

    // Ortak sınıf dizgisi TEK yerde tanımlı; düğmelerde kopyası yok.
    expect(adet(kod, 'const kaynakSekmesiSinifi = (secili: boolean): string =>')).toBe(1);
    expect(adet(kod, 'kaynakSekmesiSinifi(')).toBe(3);
    expect(adet(kod, '"px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"')).toBe(1);
  });

  it('4. çocuk — «magaza»da YALNIZ `<MagazaTalepleri … />`: veri kancadan, bileşen kendi aboneliğini açmaz', () => {
    const k = kapi(c[3]);
    expect(k?.sol).toBe("orderSourceTab === 'magaza'");
    const oge = jsxOge(k?.sag);
    expect(oge && etiket(oge)).toBe('MagazaTalepleri');
    expect(oge && nitelikler(oge)).toEqual({
      talepler: '{magaza.talepler}',
      yukleniyor: '{magaza.yukleniyor}',
      hata: '{magaza.hata}',
      currentLanguage: '{currentLanguage}',
    });
    expect(ogeBul(sf, n => etiket(n) === 'MagazaTalepleri')).toHaveLength(1);   // sayfada başka yerde çizilmez
    expect(kod).toContain("import MagazaTalepleri, { MagazaYeniRozeti } from '../components/siparis/MagazaTalepleri';");
  });

  it('5. çocuk — sipariş gövdesinin TAMAMI `orderSourceTab !== \'magaza\'` kapısında (KPI, tablo, mobil liste, yan paneller)', () => {
    const k = kapi(c[4]);
    expect(k?.sol).toBe("orderSourceTab !== 'magaza'");
    expect(k && ts.isJsxFragment(k.sag)).toBe(true);
    const govde = k ? metin(k.sag) : '';
    expect(govde.length).toBeGreaterThan(40_000);   // uzunluk koruması: kapı boş bir parçayı sarmıyor
    for (const isaret of [
      'activeOrders.length >= 3 && (() => {',                                                                    // KPI şeridi
      'selectedOrderIds.size > 0 && (',                                                                           // toplu işlem çubuğu
      '<div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">',   // masaüstü tablo
      '<div className="md:hidden space-y-4">',                                                                    // mobil liste
      'setOrderStatusFilter(',                                                                                     // durum süzgeci
      'setOrderDateRange(',                                                                                        // dönem süzgeci
    ]) {
      expect(govde, isaret).toContain(isaret);
    }
    // Yan paneller (iade, tekrarlayan sipariş, talep…): sayfadaki HER «sipariş listesi» paneli kapının içinde.
    const PANEL = "{activeTab === 'orders' && !selectedOrder && (() => {";
    expect(adet(metin(sf), PANEL)).toBeGreaterThanOrEqual(4);
    expect(adet(govde, PANEL)).toBe(adet(metin(sf), PANEL));
  });

  it('sipariş verisi (`activeOrders`) blokta YALNIZ kapıların içinde okunur', () => {
    const butun = adet(metin(blok), 'activeOrders');
    const kapilarda = [kapi(c[0]), kapi(c[4])].reduce((t, k) => t + (k ? adet(metin(k.sag), 'activeOrders') : 0), 0);
    const baslik = jsxOge(c[1]);
    const baslikta = baslik ? adet(metin(baslik), 'activeOrders') : 0;
    expect(butun).toBeGreaterThan(10);
    expect(kapilarda + baslikta).toBe(butun);   // başlıktakilerin kapıda olduğu 2. çocuğun testinde kilitli
  });
});

describe('mağaza talepleri — abonelik TEK yerde (App.tsx\'e dinleyici eklenmez, tembel listeye girmez)', () => {
  const uretim = kaynakDosyalari(SRC_KOK);
  const iceren = (desen: RegExp): string[] =>
    uretim.filter(yol => desen.test(yorumsuz(readFileSync(yol, 'utf-8')).join('\n'))).map(gorece).sort();

  it('kancayı çağıran TEK üretim dosyası OrdersPage', () => {
    expect(uretim.length).toBeGreaterThan(200);   // tarama gerçekten kaynak ağacını geziyor
    expect(iceren(/useMagazaTalepleri\(/)).toEqual(['src/hooks/useMagazaTalepleri.ts', 'src/pages/OrdersPage.tsx']);
  });

  it('koleksiyona istemciden abone olan TEK dosya kancanın kendisi', () => {
    expect(iceren(/collection\(db, (MAGAZA_TALEP_KOLEKSIYONU|'magazaTalepleri')\)/)).toEqual(['src/hooks/useMagazaTalepleri.ts']);
  });

  it('App.tsx ve tembel koleksiyon listesi koleksiyonu ANMAZ', () => {
    for (const yol of [join(SRC_KOK, 'App.tsx'), join(SRC_KOK, 'lib', 'lazyCollections.ts')]) {
      const k = yorumsuz(readFileSync(yol, 'utf-8')).join('\n');
      expect(k.length).toBeGreaterThan(500);
      expect(k, gorece(yol)).not.toMatch(/magazaTalepleri|MAGAZA_TALEP_KOLEKSIYONU|useMagazaTalepleri/);
    }
  });

  it('etiket iki dilde sözlükte: «Mağaza Talepleri» / «Store Requests»', () => {
    const sozluk = yorumsuz(readFileSync(join(SRC_KOK, 'i18n', 'orders.ts'), 'utf-8')).join('\n');
    expect(adet(sozluk, "magaza_talepleri: 'Mağaza Talepleri',")).toBe(1);
    expect(adet(sozluk, "magaza_talepleri: 'Store Requests',")).toBe(1);
    expect(sozluk.indexOf("magaza_talepleri: 'Mağaza Talepleri',")).toBeLessThan(sozluk.indexOf("magaza_talepleri: 'Store Requests',"));
  });
});
