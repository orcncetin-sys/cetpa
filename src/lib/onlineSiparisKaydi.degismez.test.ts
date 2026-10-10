/**
 * onlineSiparisKaydi.degismez.test.ts — "Online Siparişler" üst sekmesinin KAYIT YERLERİ (şartname online-siparis
 * 2026-10-02 §4 + v2 "Ekran"; kayıt listesi anla-ekran-kaydi.md §1 a–h).
 *
 * NEDEN KAYNAK TARAYAN TEST: yeni bir üst sekme App.tsx'te sekiz ayrı yere yazılır ve derleyici hiçbirinin eksikliğini
 * görmez. En pahalısı İZİN TABLOSU: `canAccess` kayıtsız sekmede "bilinmeyen sekme: izin ver" dalına düşer
 * (`if (!perms) return true`) — satır unutulursa ekran B2B ve Dealer dâhil HERKESE açılır, müşteri e-postası /
 * telefonu / adresiyle birlikte. Bu depo "yazıldı ama bağlanmadı" arızasını defalarca yaşadı; her kayıt yeri burada
 * çitlenir. `TAB_PERMISSIONS` App.tsx'in modül-özel sabiti olduğundan içe aktarılamaz → kaynak okunur (emsal:
 * topLevelTabs.test.ts, useSekmeVerileri.test.ts). Yorum satırları süzülür (`yorumsuz`): bir kaydı YORUMDA anmak
 * testi geçirmez.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { yorumsuz } from '../test/degismezTarayici';
import { TOP_LEVEL_TABS } from './topLevelTabs';
import { PLANS } from '../types/subscription';
import { PUBLIC_PATHS } from './publicPaths';
import { MAGAZA_KAYNAGI } from './magazaKaynagi';
import { sayiGirdisi, siparisDuzenlemeYamasi } from '../utils/siparisler/formKayit';

const SEKME = 'online-siparisler';
const oku = (p: string) => yorumsuz(p, readFileSync(join(process.cwd(), p), 'utf8')).join('\n');
const app = oku('src/App.tsx');

/** `TAB_PERMISSIONS` nesne gövdesi (ilk `};`e kadar). */
function izinTablosu(): string {
  const i = app.indexOf('const TAB_PERMISSIONS');
  expect(i, 'App.tsx içinde TAB_PERMISSIONS bulunamadı — test deseni bayatladı').toBeGreaterThan(-1);
  return app.slice(i, app.indexOf('\n};', i));
}

/** Bir sekmenin izin satırındaki roller: `{ full: ['Admin', …], readonly: […] }` (sıralı — sıra farkı kural farkı değildir). */
function roller(sekme: string): { full: string[]; readonly: string[] } | null {
  const anahtar = sekme.replace(/[-]/g, '\\-');
  const m = izinTablosu().match(new RegExp(`^\\s*(?:'${anahtar}'|${anahtar}):\\s*\\{\\s*full:\\s*\\[([^\\]]*)\\],\\s*readonly:\\s*\\[([^\\]]*)\\]\\s*\\}`, 'm'));
  if (!m) return null;
  const ayikla = (x: string) => [...x.matchAll(/UserRole\.(\w+)/g)].map(r => r[1]).sort();
  return { full: ayikla(m[1]), readonly: ayikla(m[2]) };
}

describe(`'${SEKME}' sekmesi — kayıt yerleri`, () => {
  it('tarama deseni canlı: bilinen `orders` satırı okunuyor (regex bayatlarsa test sessizce boşa bakmasın)', () => {
    expect(roller('orders')).toEqual({ full: ['Admin', 'Manager', 'Sales'], readonly: ['Accounting', 'Purchasing'] });
    expect(roller('boyle-bir-sekme-yok')).toBeNull();
  });

  it("(b) TAB_PERMISSIONS içinde VAR ve `orders` ile AYNI roller — kayıt yoksa canAccess ekranı HERKESE açar", () => {
    const online = roller(SEKME);
    expect(online, `TAB_PERMISSIONS içinde '${SEKME}' satırı yok`).not.toBeNull();
    expect(online).toEqual(roller('orders'));
    // Dış roller (bayi / B2B portal kullanıcısı) bu ekranı GÖRMEZ: çevrim içi müşterinin iletişim bilgisi burada listelenir.
    expect([...(online?.full ?? []), ...(online?.readonly ?? [])]).not.toContain('B2B');
    expect([...(online?.full ?? []), ...(online?.readonly ?? [])]).not.toContain('Dealer');
  });

  it('(b) kayıtsız sekmenin herkese açıldığı varsayımı hâlâ doğru (kural değişirse bu test güncellenmeli)', () => {
    expect(app).toMatch(/if \(!perms\) return true;/);
  });

  it('(a) TOP_LEVEL_TABS içinde; kimlik tireli ASCII ve herkese açık yollarla çakışmıyor', () => {
    expect(TOP_LEVEL_TABS.has(SEKME)).toBe(true);
    expect(SEKME).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(Object.values(PUBLIC_PATHS).map(yol => String(yol).replace(/^\//, ''))).not.toContain(SEKME);
  });

  it('(c) kenar çubuğu: "CRM & Satış" grubunun childIds listesinde ve Siparişler öğesinin HEMEN altında', () => {
    const crm = app.match(/id: 'crm',[^\n]*\n\s*childIds: \[([^\]]*)\]/);
    expect(crm, 'CRM grubunun childIds satırı bulunamadı').not.toBeNull();
    expect(crm?.[1]).toContain(`'${SEKME}'`);
    const satirlar = app.split('\n');
    const siparisler = satirlar.findIndex(s => /subId: 'orders',\s+action: \(\) => setActiveTab\('orders'\)/.test(s));
    expect(siparisler, 'kenar çubuğunda Siparişler öğesi bulunamadı').toBeGreaterThan(-1);
    expect(satirlar[siparisler + 1]).toMatch(new RegExp(`subId: '${SEKME}',\\s+action: \\(\\) => setActiveTab\\('${SEKME}'\\)`));
  });

  it("(d) mobil menü: navChildOf ebeveyni 'crm'", () => {
    const m = app.match(/const navChildOf: Record<string,string> = \{([^}]*)\}/);
    expect(m, 'navChildOf bulunamadı').not.toBeNull();
    expect(m?.[1]).toMatch(new RegExp(`'${SEKME}':\\s*'crm'`));
  });

  it('(e) tabLabelOf: başlık ve hata sınırı etiketi sözlükten (ham kimlik basılmaz)', () => {
    const i = app.indexOf('const tabLabelOf');
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, app.indexOf('[id] || id', i))).toMatch(new RegExp(`'${SEKME}':\\s*osc\\(currentLanguage\\)\\.online_siparisler`));
  });

  it('(f) render dalı var, izin kapılı; sipariş detayı seç + Siparişler sekmesine geç yoluyla açılıyor', () => {
    const i = app.indexOf(`activeTab === '${SEKME}' && canAccess('${SEKME}')`);
    expect(i, 'render dalı bulunamadı').toBeGreaterThan(-1);
    const dal = app.slice(i, app.indexOf('</React.Suspense>', i));
    expect(dal).toContain('<OnlineSiparislerPage');
    expect(dal).toMatch(/orders=\{orders\}/);
    expect(dal).toMatch(/setSelectedOrder\(order\);\s*setActiveTab\('orders'\);/);
  });

  it('(f) "Bağlantıyı kur" yalnız bağlantıyı DÜZENLEYEBİLEN role: Yönetici ya da süper-admin (kart + sunucu kapısıyla aynı kural)', () => {
    const i = app.indexOf(`activeTab === '${SEKME}' && canAccess('${SEKME}')`);
    const dal = app.slice(i, app.indexOf('</React.Suspense>', i));
    expect(dal).toMatch(/ayarlaraGit=\{\(userRole === 'Admin' \|\| isOwnerAdmin\) \? \(\) => setActiveTab\('settings'\) : undefined\}/);
    // Eski kapı "Ayarlar'a erişebiliyor mu" diye soruyordu: Manager'a düğme çiziliyor, kart ona salt okunur açılıyordu.
    expect(dal).not.toMatch(/ayarlaraGit=\{canAccess\(/);
    expect(dal.split('ayarlaraGit=').length - 1).toBe(1);
    // Aynı kural kartta: düğmeyi gören herkes Ayarlar'da formu da görür.
    expect(oku('src/components/ShopifyBaglantiKarti.tsx')).toMatch(/const duzenleyebilir = userRole === 'Admin' \|\| superYonetici;/);
    // Düğme Pano'ya ATMAZ: Ayarlar sekmesinin çizim kapısı Yönetici'yi de süper-admini de kabul ediyor.
    expect(app).toMatch(/activeTab === 'settings' && \(userRole === 'Admin' \|\| userRole === 'Manager' \|\| isOwnerAdmin\) && \(/);
    expect(app).toMatch(/const isOwnerAdmin = /);
  });

  it('imza reddi kıyası TEK yardımcıda: kart da şerit de `guncelImzaReddiMs` çağırır, ret zamanını hiçbiri kendisi kıyaslamaz', () => {
    // İki yüzey aynı GET yanıtını okur; kıyas ayrı yazılırsa aynı durumda biri «imza doğrulanamadı», öbürü «henüz bildirim gelmedi» der.
    for (const dosya of ['src/components/ShopifyBaglantiKarti.tsx', 'src/pages/OnlineSiparislerPage.tsx']) {
      const kaynak = oku(dosya);
      expect(kaynak.split('guncelImzaReddiMs(').length - 1, dosya).toBe(1);
      expect(kaynak, dosya).not.toMatch(/sonImzaReddi\w*\s*(?:[!=]==?|[<>]=?)/);
    }
  });

  it('(g) sayfa lazy içe aktarılıyor ve dosya yerinde', () => {
    expect(app).toMatch(/const OnlineSiparislerPage\s*=\s*React\.lazy\(\(\) => import\('\.\/pages\/OnlineSiparislerPage'\)\);/);
    expect(() => readFileSync(join(process.cwd(), 'src/pages/OnlineSiparislerPage.tsx'), 'utf8')).not.toThrow();
  });

  it('(h) abonelik: `orders` hangi plandaysa bu sekme de o planda (mobilde fiyat sayfasına düşmesin)', () => {
    expect(PLANS.length).toBeGreaterThan(0);
    for (const plan of PLANS) {
      expect(plan.modulesAllowed.includes(SEKME), `plan ${plan.id}`).toBe(plan.modulesAllowed.includes('orders'));
    }
    expect(PLANS.some(p => p.modulesAllowed.includes(SEKME))).toBe(true);
  });

  it('süper-admin modül durumu (opsRoutes MODULE_REGISTRY) sayfayı tanıyor', () => {
    expect(oku('src/server/routes/opsRoutes.ts')).toMatch(/\{ id: 'online-siparisler', label: 'Online Siparişler', file: 'src\/pages\/OnlineSiparislerPage\.tsx', group: 'Satış' \}/);
  });
});

describe('teslim / kargo onayındaki OTOMATİK müşteri iletisi (şartname v2 E3)', () => {
  it('çevrim içi mağaza siparişinde ÇALIŞMAZ: e-posta + WhatsApp çağrıları `!magazaSiparisiMi(...)` kapısının İÇİNDE', () => {
    const kapi = app.indexOf("(status === 'Shipped' || status === 'Delivered') && !magazaSiparisiMi(iletiSiparisi)");
    expect(kapi, 'otomatik ileti kapısı bulunamadı').toBeGreaterThan(-1);
    const eposta = app.indexOf("authFetch('/api/email/order-notification'");
    const whatsapp = app.indexOf("authFetch('/api/whatsapp/order-notification'");
    expect(eposta).toBeGreaterThan(kapi);
    expect(whatsapp).toBeGreaterThan(kapi);
    // Kapıyla çağrılar arasında işlev kapanmıyor (çağrılar başka bir `if`e taşınmadı): aradaki metinde `catch (error)` yok.
    expect(app.slice(kapi, whatsapp)).not.toContain('catch (error)');
    // Bu iki uç App.tsx'te TEK yerde çağrılıyor — kapısız ikinci bir çağrı eklenirse test kırılır.
    expect(app.split("'/api/email/order-notification'").length - 1).toBe(1);
    expect(app.split("'/api/whatsapp/order-notification'").length - 1).toBe(1);
    expect(app).toMatch(/const iletiSiparisi = orders\.find\(o => o\.id === orderId\);/);
  });

  it('bu uçları istemcide başka HİÇBİR dosya çağırmıyor (kapısız ikinci yol yok)', () => {
    for (const dosya of ['src/pages/OrdersPage.tsx', 'src/pages/CRMPage.tsx'])
      expect(oku(dosya), dosya).not.toMatch(/order-notification/);
  });
});

describe('Siparişler ekranındaki çevrim içi mağaza yüzeyleri — GERÇEKTEN açılan bileşene bağlı', () => {
  // Sipariş detayı `selectedOrder` ile OrdersPage'te çizilir (App.tsx'teki eski EditOrderModal vakası: hiç açılmayan
  // bileşene yazılan düzeltme canlıda görünmedi). Rozet ve bilgi bloğu o dosyada, o değişkenlere bağlı olmalı.
  const siparisler = oku('src/pages/OrdersPage.tsx');
  it('detayın çizildiği dal hâlâ `selectedOrder &&` (blok ölü bir dala bağlanmasın)', () => {
    expect(siparisler).toMatch(/\{selectedOrder && \(/);
    expect(app).toMatch(/<OrdersPage[\s\S]{0,600}selectedOrder=\{selectedOrder\}/);
  });
  it('bilgi bloğu detayda, seçili siparişle çiziliyor', () => {
    expect(siparisler.split('<OnlineSiparisBilgisi siparis={selectedOrder} dil={currentLanguage} />').length - 1).toBe(1);
    expect(siparisler.indexOf('<OnlineSiparisBilgisi')).toBeGreaterThan(siparisler.indexOf('{selectedOrder && ('));
  });
  it('"Online" rozeti hem masaüstü satırında hem mobil kartta', () => {
    expect(siparisler.split('<OnlineRozeti siparis={order} dil={currentLanguage} />').length - 1).toBe(2);
  });
});

describe('Siparişler detayı — çevrim içi mağaza siparişine takip bağlantısı ÜRETİLMEZ (sunucu /api/track o siparişe 404 döner)', () => {
  const siparisler = oku('src/pages/OrdersPage.tsx');

  it('sunucu kuralı yerinde: kimliksiz takip ucu mağaza siparişini gizliyor (kural kalkarsa bu çitler de gözden geçirilmeli)', () => {
    expect(oku('server.ts')).toMatch(/if \(o\.source === MAGAZA_KAYNAGI\) return res\.status\(404\)/);
  });

  it('`/?track=` üreten yer sayısı İKİ ve ikisi de `magazaSiparisiMi` kapısında (kapısız üçüncü bir üretici eklenirse kırılır)', () => {
    expect(siparisler.split('/?track=').length - 1).toBe(2);
    // «Takip linki» düğmesi: tümü kapının içinde — mağaza siparişinde ÇİZİLMEZ.
    expect(siparisler).toMatch(/\{!magazaSiparisiMi\(selectedOrder\) && \(\s*<button\s+onClick=\{\(\) => \{\s*const url = `\$\{window\.location\.origin\}\/\?track=\$\{selectedOrder\.id\}`;/);
    // «Özet kopyala»: adres mağaza siparişinde hiç kurulmaz.
    expect(siparisler).toMatch(/const takipUrl = magazaSiparisiMi\(o\) \? null : `\$\{window\.location\.origin\}\/\?track=\$\{o\.id\}`;/);
  });

  it('özet metninde takip satırı KOŞULLU (iki dilde); koşulsuz satır kalmadı', () => {
    expect(siparisler).toContain("${takipUrl ? `\\nTakip Linki: ${takipUrl}` : ''}`");
    expect(siparisler).toContain("${takipUrl ? `\\nLink: ${takipUrl}` : ''}`;");
    expect(siparisler).not.toContain('trackUrl');
    // Düşen satırın ardında boş satır kalmaz: kargo satırı da satır sonunu BAŞINDA taşır.
    expect(siparisler).toContain("${o.trackingNumber ? `\\nKargo Takip: ${o.trackingNumber}` : ''}");
    expect(siparisler).toContain("${o.trackingNumber ? `\\nTracking: ${o.trackingNumber}` : ''}");
  });

  it('«Özet kopyala» düğmesi mağaza siparişinde de ÇİZİLİR: takip düğmesinin kapısı ondan ÖNCE kapanıyor', () => {
    const kapi = siparisler.indexOf('{!magazaSiparisiMi(selectedOrder) && (');
    const ozet = siparisler.indexOf('const takipUrl = magazaSiparisiMi(o)');
    expect(kapi).toBeGreaterThan(-1);
    expect(ozet).toBeGreaterThan(kapi);
    const arasi = siparisler.slice(kapi, ozet);
    expect(arasi).toMatch(/\{op\(currentLanguage\)\.takip_linki\}\s*<\/button>\s*\)\}/);
    expect(arasi.split('<button').length - 1).toBe(2);   // takip düğmesi + (kapı kapandıktan sonra) özet düğmesi
    expect(siparisler.slice(ozet)).toMatch(/\{op\(currentLanguage\)\.ozet_kopyala\}/);
  });
});

describe('Sipariş düzenleme formu — MAĞAZA KİLİDİ: ad / adres / tutar mağazanındır (sonraki mağaza olayı geri ezerdi)', () => {
  const siparisler = oku('src/pages/OrdersPage.tsx');
  const modal = siparisler.slice(siparisler.indexOf('{isEditingOrder && ('));
  const kilitliDal = modal.slice(modal.indexOf('if (magazaKilidi) {'), modal.indexOf('if (belgeKesildi) {'));

  it('tarama deseni canlı: modal ve kilitli dal bulundu; bayrak TEK kaynaktan (`magazaSiparisiMi`)', () => {
    expect(siparisler.indexOf('{isEditingOrder && (')).toBeGreaterThan(-1);
    expect(kilitliDal.length).toBeGreaterThan(100);
    expect(siparisler).toMatch(/const magazaKilidi = magazaSiparisiMi\(selectedOrder\);/);
  });

  it('ad, adres ve tutar girdileri kilitliyken SALT OKUNUR + formun başında kısa not', () => {
    expect(kilitliDal).toMatch(/<input type="text" readOnly className=\{cn\('apple-input w-full text-sm', KILITLI_GIRDI\)\} value=\{\(editingOrderData\.customerName as string\) \?\? ''\} \/>/);
    expect(modal).toMatch(/<input id="siparis-duzenle-adres" type="text" readOnly=\{magazaKilidi\}[^\n]*value=\{\(editingOrderData\.shippingAddress as string\) \?\? ''\}/);
    expect(modal).toMatch(/<input type="number" readOnly=\{magazaKilidi\}[^\n]*value=\{editingTutarHam\}/);
    expect(modal).toMatch(/\{magazaKilidi && \(\s*<p role="note"[^\n]*\{osc\(currentLanguage\)\.magaza_alanlari_kilitli\}<\/p>\s*\)\}/);
  });

  // Teslimat üçlüsü (2026-10-10): ülke ve il de mağazanındır — seçici DEĞİL salt okunur kutu çizilir (`saltOkunur`).
  it('teslimat ÜLKESİ ve İLİ de kilitliyken salt okunur: iki seçici `saltOkunur={magazaKilidi}` alır', () => {
    const ulke = modal.match(/<UlkeSecici\b[^\n]*\/>/)?.[0] ?? '';
    const il = modal.match(/<IlSecici\b[^\n]*\/>/)?.[0] ?? '';
    expect(ulke).toMatch(/<UlkeSecici id="siparis-duzenle-ulke" deger=\{editingOrderData\.teslimatUlke\} saltOkunur=\{magazaKilidi\} /);
    expect(il).toMatch(/<IlSecici id="siparis-duzenle-il" deger=\{duzenlenenIl\} ulke=\{etkinUlke\(editingOrderData\.teslimatUlke\)\} saltOkunur=\{magazaKilidi\} /);
    // Pencerede bu bileşenlerden BİRER tane var (kilitsiz bir ikinci kopya kilidi delerdi).
    expect(modal.split('<UlkeSecici').length - 1).toBe(1);
    expect(modal.split('<IlSecici').length - 1).toBe(1);
    // Ülke seçicisine kayıttaki HAM değer verilir: `etkinUlke` uygulansaydı ülkesi bilinmeyen mağaza kaydı «Türkiye» görünürdü.
    expect(ulke).not.toMatch(/deger=\{etkinUlke\(/);
  });

  it('kilitli formda cari BAĞLAMA açık ama seçici yalnız `leadId` yazar — müşteri adına DOKUNMAZ', () => {
    expect(kilitliDal).toMatch(/<CustomerCombobox\b/);
    expect(kilitliDal).toMatch(/value=\{magazaCariArama\}/);
    expect(kilitliDal).toMatch(/onChange=\{setMagazaCariArama\}/);
    expect(kilitliDal).toMatch(/onSelect=\{lead => \{ setEditingOrderData\(d => \(\{ \.\.\.d, leadId: lead\.id \}\)\); setMagazaCariArama\(lead\.name\); \}\}/);
    expect(kilitliDal).not.toMatch(/customerName:/);
    // Resmî belge kesilmişse cari bağı kilitli formda da değiştirilemez (seçici yerine not).
    expect(kilitliDal).toMatch(/\{belgeKesildi \? belgeNotu : \(/);
    // Form her açılışta arama metnini sıfırlar (önceki siparişin araması kalmasın).
    expect(siparisler).toMatch(/setMagazaCariArama\(''\); setIsEditingOrder\(true\);/);
  });

  it('kayıt yaması: ad + adres VERİLMEZ, tutar boş GEÇİLMEZ ve yamadan DÜŞÜRÜLÜR; yazılan nesne süzülmüş `yama`', () => {
    expect(modal).toMatch(/customerName: magazaKilidi \? undefined : editingOrderData\.customerName,/);
    expect(modal).toMatch(/shippingAddress: magazaKilidi \? undefined : editingOrderData\.shippingAddress,/);
    // Ülke ve il de yamaya VERİLMEZ (2026-10-10) — salt okunur gösterim tek başına yetmez.
    expect(modal).toMatch(/teslimatUlke: magazaKilidi \? undefined : etkinUlke\(editingOrderData\.teslimatUlke\),/);
    expect(modal).toMatch(/teslimatSehri: magazaKilidi \? undefined : duzenlenenIl,/);
    expect(modal).toMatch(/tutarHam: magazaKilidi \? sayiGirdisi\(selectedOrder\.totalPrice\) : editingTutarHam,/);
    expect(modal).toMatch(/const \{ totalPrice: _magazaTutari, \.\.\.tutarsizYama \} = hamYama;\s*const yama: typeof hamYama = magazaKilidi \? tutarsizYama : hamYama;/);
    expect(modal).toMatch(/await updateDoc\(doc\(db, 'orders', duzenlenenId\), \{ \.\.\.yama, updatedAt: serverTimestamp\(\) \}\);/);
    expect(modal).not.toMatch(/\.\.\.hamYama/);
  });

  it('Cetpa\'ya ait alanlar AÇIK kalır: depo, belge tipi, KDV oranı kilide bağlı değil', () => {
    const depo = modal.match(/<SevkDeposuSecici[\s\S]*?\/>/)?.[0] ?? '';
    const belge = modal.match(/<select className="apple-input w-full text-sm" value=\{editingOrderData\.faturaTipi \?\? ''\}[\s\S]*?<\/select>/)?.[0] ?? '';
    const kdv = modal.match(/<input type="number" min="0" max="100"[\s\S]*?\/>/)?.[0] ?? '';
    for (const [ad, parca] of [['depo', depo], ['belge tipi', belge], ['KDV', kdv]] as const) {
      expect(parca.length, ad).toBeGreaterThan(0);
      expect(parca, ad).not.toMatch(/magazaKilidi|readOnly/);
    }
    expect(depo).not.toMatch(/disabled/);
    expect(belge).not.toMatch(/disabled/);
    // KDV oranı yalnız RESMÎ BELGE kesilmişse kapanır (belge kilidi — mağaza siparişine özgü değil); başka kilit yok.
    expect(kdv.match(/disabled[^\s]*/g) ?? []).toEqual(['disabled:opacity-60', 'disabled:cursor-not-allowed"', 'disabled={duzenlenenBelgeKesildi}']);
    expect(kdv).toContain('value={editingKdvHam}');
    expect(modal).toMatch(/kdvHam: editingKdvHam,\s*depoNo: editingOrderData\.depoNo,/);
    expect(modal).toMatch(/leadId: editingOrderData\.leadId === selectedOrder\.leadId \? undefined : editingOrderData\.leadId,/);
  });

  // Yukarıdaki çit sayfanın HANGİ girdileri verdiğini sabitler; bu vaka o girdilerin GERÇEK yama işlevinde ne ürettiğini.
  describe('kilitli kayıt reçetesi — gerçek `siparisDuzenlemeYamasi` ile', () => {
    const MAGAZA = { source: MAGAZA_KAYNAGI, totalPrice: 1499.9 };
    const kilitliYama = (onceki: { totalPrice?: number; teslimatSehri?: string | null; teslimatUlke?: string }, form: { kdvHam: string; depoNo?: number; leadId?: string }) => {
      const { totalPrice: _magazaTutari, ...yama } = siparisDuzenlemeYamasi(
        { customerName: undefined, shippingAddress: undefined, teslimatUlke: undefined, teslimatSehri: undefined, tutarHam: sayiGirdisi(onceki.totalPrice), ...form }, onceki);
      return yama;
    };

    it('yalnız Cetpa alanları yazılır: ad / adres / tutar ve KDV türevleri yamada YOK', () => {
      expect(kilitliYama(MAGAZA, { kdvHam: '20', depoNo: 3, leadId: 'lead-9' })).toEqual({ kdvOran: 20, depoNo: 3, leadId: 'lead-9' });
      expect(kilitliYama(MAGAZA, { kdvHam: '' })).toEqual({});
    });

    it('teslimat ülkesi / ili mağazanındır: kayıtta «ilçe / il» dolu, ülke yok / dolu — yamada İKİ anahtar da YOK', () => {
      expect(kilitliYama({ ...MAGAZA, teslimatSehri: 'Çankaya / Ankara' }, { kdvHam: '20', depoNo: 3 })).toEqual({ kdvOran: 20, depoNo: 3 });
      expect(kilitliYama({ ...MAGAZA, teslimatSehri: null, teslimatUlke: 'DE' }, { kdvHam: '' })).toEqual({});
      // NEDEN `undefined` verilir: kilitsiz reçete (etkin ülke + kutudaki il) aynı kayıtta «il boşaltıldı» sayılıp `null` yazardı.
      expect(siparisDuzenlemeYamasi({ teslimatUlke: 'TR', teslimatSehri: '', tutarHam: sayiGirdisi(MAGAZA.totalPrice), kdvHam: '' },
        { ...MAGAZA, teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'DE' })).toMatchObject({ teslimatUlke: 'TR', teslimatSehri: null });
    });

    it('NEDEN boş geçilmez: boş tutar + bilinen önceki değer `totalPrice: null` üretir (tutarı SİLERDİ)', () => {
      expect(siparisDuzenlemeYamasi({ tutarHam: '', kdvHam: '' }, MAGAZA)).toEqual({ totalPrice: null });
      // Kayıttaki değer verilince silme üretilmez; alan yine de düşürülür (aynı değeri geri yazmak mağaza olayını ezerdi).
      expect(siparisDuzenlemeYamasi({ tutarHam: sayiGirdisi(MAGAZA.totalPrice), kdvHam: '' }, MAGAZA)).toEqual({ totalPrice: 1499.9 });
    });

    it('TRY dışı mağaza siparişi (`totalPrice` hiç yok): sahte tutar / null YAZILMAZ', () => {
      expect(kilitliYama({}, { kdvHam: '10', depoNo: 1 })).toEqual({ kdvOran: 10, depoNo: 1 });
      expect(siparisDuzenlemeYamasi({ tutarHam: sayiGirdisi(undefined), kdvHam: '' }, {})).toEqual({});
    });
  });
});
