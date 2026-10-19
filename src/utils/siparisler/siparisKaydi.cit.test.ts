/**
 * siparisKaydi.cit.test.ts — "Yeni Sipariş" kaydının ve "Ödeme Alındı"nın App.tsx'teki BAĞLANTISI (kaynak çiti, 2026-10-02).
 *
 * Saf yardımcılar (siparisKalemFiyati, odemeYontemi) ve pencere (AddOrderModal.test) kendi testleriyle kanıtlı; burada
 * sabitlenen, onları App.tsx'e bağlayan satırlardır — App 6.000+ satır ve çizilerek test edilemiyor. İnceleme (2026-10-02)
 * tam bu katmanda ölü kod buldu: catch'teki `handleFirestoreError` kendisi fırlattığı için okunur hata iletisi ve
 * `return false` HİÇ koşmuyordu, testler ise yalnız pencereyi sınadığı için yeşildi.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC_KOK, kodSatirlari } from '../../test/kaynakTarama';

const APP = join(SRC_KOK, 'App.tsx');
const satirlar = kodSatirlari(APP);
const kod = satirlar.map(s => s.kod).join('\n');
const say = (desen: RegExp): number => (kod.match(desen) ?? []).length;
/** `bas` ile başlayan işlevin gövdesi — KENDİ kapanışına (`\n  };`) kadar. Eskiden "sonraki `const handle…`"a kadar
 *  kesiliyordu: ödeme işleyicisinin "gövdesi" 2.800 satırlık render'ı da içeriyor, oradaki ilgisiz `return false;` çiti
 *  yeşil tutuyordu (inceleme 2026-10-02). */
function govde(bas: string): string {
  const i = kod.indexOf(bas);
  expect(i, `${bas} bulunamadı`).toBeGreaterThan(-1);
  const son = kod.indexOf('\n  };', i + bas.length);
  expect(son, `${bas} kapanışı bulunamadı`).toBeGreaterThan(-1);
  return kod.slice(i, son + 5);
}

describe('App.tsx — sipariş kaydı (handleAddOrder)', () => {
  const g = govde('const handleAddOrder = async (');
  it('gövde bulunuyor ve işlevin kendi kapanışında bitiyor', () => {
    expect(g.length).toBeGreaterThan(1500);
    expect(g).not.toContain('const applyOrderStockMovement');     // komşu işlevin gövdesi dâhil DEĞİL
  });
  it('tutarlar PENCEREDEN, tek hesaptan gelir: burada `toplam / (1 + oran)` ile yeniden ayrıştırma YOK', () => {
    expect(g).toMatch(/tutarlar: SiparisTutarlari\s*\) => \{/);
    expect(g).toMatch(/const \{ matrah: kdvHaricTutar, kdv: kdvTutari, toplam: finalTotal \} = tutarlar;/);
    expect(g).not.toMatch(/\/ \(1 \+ kdvOran \/ 100\)/);
    expect(g).not.toMatch(/computedTotal/);
    // İkinci kapı: tutar sonlu ve pozitif; faturasız siparişte KDV olamaz.
    expect(g).toMatch(/if \(!\[kdvHaricTutar, kdvTutari, finalTotal\]\.every\(Number\.isFinite\) \|\| finalTotal <= 0 \|\| kdvTutari < 0\) \{\s+throw new Error\(/);
    expect(g).toMatch(/if \(!newOrder\.faturali && kdvTutari !== 0\) \{\s+throw new Error\(/);
    // Yazılan doküman, yevmiye fişleri ve Mikro'ya giden sipariş AYNI üç değeri kullanır.
    const yazimBasi = g.indexOf('await setDoc(orderDocRef, {');
    const yazilan = g.slice(yazimBasi, g.indexOf('});', yazimBasi));
    expect(yazilan).toMatch(/totalPrice: finalTotal,\s+lineItems: orderLineItems,/);
    expect(yazilan).toMatch(/kdvOran,\s+kdvHaricTutar,\s+kdvTutari,/);       // matrah ve KDV dokümana YAZILIR (KDV panosu, PDF okur)
    const mikroBasi = g.indexOf('const orderForMikro = {');
    expect(mikroBasi).toBeGreaterThan(yazimBasi);
    const mikroya = g.slice(mikroBasi, g.indexOf('}', mikroBasi));
    expect(mikroya).toMatch(/totalPrice:\s+finalTotal,\s+lineItems:\s+orderLineItems,/);
    expect(g).toMatch(/totalPrice: finalTotal,/);
    expect(g).toMatch(/borc: kdvHaricTutar,\s+alacak: kdvHaricTutar,/);
    expect(g).toMatch(/borc: kdvTutari,\s+alacak: kdvTutari,/);
  });
  it('müşteri tipi SEÇİLİ MÜŞTERİDEN yazılır — `...newOrder`\'dan sonra (kopyadan gelen eski tipi ezer), müşterisizde uydurulmaz', () => {
    const yayma = g.indexOf('...newOrder,');
    const tip = g.indexOf("...(selectedLead?.customerType ? { customerType: selectedLead.customerType } : {}),");
    expect(yayma).toBeGreaterThan(-1);
    expect(tip).toBeGreaterThan(yayma);
  });
  it('her kayıtta Shopify taslak siparişi GÖNDERİLMEZ', () => {
    expect(say(/createShopifyDraftOrder/g)).toBe(0);
  });
  it('müşterisiz ve kalemsiz sipariş yazılmadan önce fırlatır (ikinci kapı)', () => {
    const yazim = g.indexOf('await setDoc(orderDocRef');
    expect(yazim).toBeGreaterThan(-1);
    const once = g.slice(0, yazim);
    expect(once).toMatch(/if \(!customerName\) throw new Error\(/);
    expect(once).toMatch(/if \(orderLineItems\.length === 0\) throw new Error\(/);
  });
  it('yazım hatasında FIRLATMAYAN günlükleyici + okunur neden: `handleFirestoreError` (fırlatır) bu gövdede kullanılmaz', () => {
    expect(g).not.toMatch(/\bhandleFirestoreError\(/);
    expect(g).toMatch(/importedLogFirestoreError\(error, OperationType\.CREATE, 'orders'/);
    expect((g.match(/throw new Error\(sunucuHataMetni\(error\) \?\?/g) ?? [])).toHaveLength(1);
    // Ham istemci hata metni ("dbClient PUT … → 502 <html>") pencereye basılmaz.
    expect(g).not.toMatch(/error instanceof Error \? error\.message/);
  });
  it('yeniden denemede AYNI doküman kimliği: kimlik yazım başarılı olunca / pencere kapanınca sıfırlanır', () => {
    expect(g).toMatch(/bekleyenSiparisKimligiRef\.current\s*\?\s*doc\(collection\(db, 'orders'\), bekleyenSiparisKimligiRef\.current\)/);
    expect(g).toMatch(/bekleyenSiparisKimligiRef\.current = orderDocRef\.id;/);
    const yazim = g.indexOf('await setDoc(orderDocRef');
    const yakala = g.indexOf('} catch (error) {', yazim);
    expect(g.slice(yazim, yakala)).toMatch(/bekleyenSiparisKimligiRef\.current = null;/);     // try içinde, yazımdan SONRA
    expect(say(/bekleyenSiparisKimligiRef\.current = null;/g)).toBe(2);                        // + pencerenin onClose'u
  });
  it('yazımdan sonraki adımlar (bildirim, yevmiye, Mikro) siparişi "kaydedilmedi" gösteremez: ikinci bir fırlatma yok', () => {
    const yazim = g.indexOf('await setDoc(orderDocRef');
    const yakalaSonu = g.indexOf('throw new Error(sunucuHataMetni(error)', yazim);
    expect(yakalaSonu).toBeGreaterThan(yazim);
    expect(g.slice(yakalaSonu + 10)).not.toMatch(/\bthrow\b/);
  });
});

describe('App.tsx — sipariş penceresinin bağlantısı', () => {
  const i = kod.indexOf('<AddOrderModal');
  const etiket = kod.slice(i, kod.indexOf('/>', i));
  it('pencere kaydı, kurları ve kopya tohumunu App\'ten alır', () => {
    expect(i).toBeGreaterThan(-1);
    expect(etiket).toContain('onSubmit={handleAddOrder}');
    expect(etiket).toContain('kurlar={exchangeRates}');
    expect(etiket).toContain('tohum={siparisTohumu}');
    expect(etiket).toContain('setSiparisTohumu(null)');
  });
  it('App\'te pencerenin okumadığı ikinci bir sipariş taslağı durumu YOK (üç ekran boşa yazıyordu)', () => {
    expect(say(/\bsetNewOrder\b/g)).toBe(0);
    expect(say(/\bsetOrderLineItems\b/g)).toBe(0);
  });
  it('"Siparişi kopyala" tohumu açık durumla kurar (kalemsiz sipariş de taşınır)', () => {
    const sayfa = kodSatirlari(join(SRC_KOK, 'pages', 'OrdersPage.tsx')).map(s => s.kod).join('\n');
    expect(sayfa).toMatch(/setSiparisTohumu\(\{\s+order: \{/);
    expect(sayfa).not.toMatch(/\bsetNewOrder\b|\bsetOrderLineItems\b/);
    expect(sayfa).not.toMatch(/totalPrice: o\.totalPrice/);      // kaynak siparişin toplamı tohuma girmez (kalemlerden hesaplanır)
  });
});

describe('App.tsx — ödeme alındı (handleConfirmPayment)', () => {
  const g = govde('const handleConfirmPayment = async (yontem: OdemeYontemi): Promise<boolean> => {');
  it('seçilen yöntem yazılır (sabit `bank_transfer` yok)', () => {
    expect(g).toMatch(/odemeAlindiYamasi\(yontem, serverTimestamp\(\)\)/);
    expect(g).not.toMatch(/bank_transfer/);
  });
  it('hata dalı ERİŞİLİR: fırlatmayan günlükleyici → bildirim → `return false` (pencere açık kalır)', () => {
    expect(g).not.toMatch(/\bhandleFirestoreError\(/);
    const yakala = g.slice(g.indexOf('} catch (error) {'));
    expect(yakala).toMatch(/importedLogFirestoreError\(error, OperationType\.UPDATE,[\s\S]*toast\([\s\S]*return false;\s+\}\s+\};$/);
    expect(g.split('\n').length).toBeLessThan(25);                // yalnız işlevin kendisi (render dâhil değil)
  });
  it('pencere bu işleyiciye bağlı', () => {
    expect(kod).toMatch(/<PaymentMethodModal[\s\S]{0,200}onConfirm=\{handleConfirmPayment\}/);
  });
});

describe('App.tsx — ödenmedi yap (handleToggleOrderPaid)', () => {
  const g = govde('const handleToggleOrderPaid = (order: Order) => {');
  it('yazım hatasında fırlatan `handleFirestoreError` kullanılmaz; günlük + kullanıcıya bildirim', () => {
    expect(g).not.toMatch(/\bhandleFirestoreError\(/);
    expect(g).toMatch(/\.catch\(err => \{\s+importedLogFirestoreError\(err, OperationType\.UPDATE,[^\n]*\s+toast\([^\n]*'error'\);\s+\}\);/);
  });
});

describe('dış sistem gövdeleri — kalem fiyatı KDV HARİÇ net birimdir (2026-10-07)', () => {
  it('iyzico sepeti tek yardımcıdan (kırılım tutarı tutmuyorsa tek kalem); rotada elle kırılım kurulmaz', () => {
    const rota = kodSatirlari(join(SRC_KOK, 'server', 'routes', 'paymentRoutes.ts')).map(s => s.kod).join('\n');
    expect(rota).toMatch(/const basket = iyzicoSepeti\(orderId, amount, lineItems\);/);
    expect(rota).not.toMatch(/l\.price \* \(l\.qty/);
    // Gövdenin price / paidPrice metni sepetle AYNI yardımcıdan (yarım kuruşlu tutarda Σ sepet = price).
    expect(rota).toMatch(/const amountStr = iyzicoTutarMetni\(amount\);/);
    expect(rota).toMatch(/price: amountStr,\s+paidPrice: amountStr,/);
    expect(rota).not.toMatch(/amount\.toFixed\(/);
  });
  it('Luca fatura gövdesi KALKTI (2026-10-19, şartname «takip kodu + LUCA reddi» LA): server.ts\'te KDV bayraklı fatura gövdesi yok', () => {
    // Eskiden `kdvDahil: false` (kalem fiyatı KDV hariç) tek satırla sabitti; uç artık her isteğe 400 döner, gövde kurulmaz.
    // Yeniden açılırsa kalem fiyatının KDV hariç net birim olduğu kuralı (utils/siparisler/siparisKalemFiyati) yine geçerlidir.
    const sunucu = kodSatirlari(join(SRC_KOK, '..', 'server.ts')).map(s => s.kod).join('\n');
    expect((sunucu.match(/kdvDahil: (true|false),/g) ?? [])).toEqual([]);
    expect(sunucu).toMatch(/res\.status\(400\)\.json\(LUCA_FATURA_KAPALI\);/);
  });
  it('fatura isteği kalemin SATIR KDV\'sini taşır (yazılan KDV dâhil toplam belgede de korunsun); sunucu şeması alanı düşürmez', () => {
    const g = govde('const handleMikroFatura = async (order: Order) => {');
    // Satır KDV'si tek kuraldan (faturaDurumu.kalemSatirKdv — birim testli): yalnız kalem oranı = sipariş oranı iken gönderilir.
    expect(g).toMatch(/const kdv = kalemSatirKdv\(l, order\.kdvOran\);\s+return \{ name: l\.title \|\| l\.name \|\| l\.sku, sku: l\.sku, quantity: l\.quantity, price: l\.price, \.\.\.\(kdv !== undefined \? \{ kdv \} : \{\}\) \};/);
    expect(g).not.toMatch(/kdv: l\.kdv/);
    // BAYAT KALEM (kalem oranı ≠ sipariş oranı) → istek HİÇ gitmez: eski kapı yalnız satır KDV'sini düşürüp gönderiyordu, KDV
    // dâhil çapada bayat net fiyat yanlış toplamlı belge keserdi (inceleme 2026-10-08). Yüklem saf işlevde (bayatKalemVar —
    // davranışı faturaDurumu.test.ts'te); burada ÇAĞRI YERİ kilitlenir: `if` işlev gövdesinin kendi girintisinde (başka koşulun
    // içinde değil), koşul yalnız çağrıdan ibaret (sona bağlaç eklenemez), hemen ardından bildirim ve `return`.
    expect(g).toMatch(/\n {6}if \(bayatKalemVar\(order\)\) \{\n {8}toast\([^;]{0,700}'error'\);\n {8}return;\n {6}\}/);
    const kapi = g.indexOf('if (bayatKalemVar(order)) {');
    expect(kapi).toBeGreaterThan(-1);
    expect(kapi).toBeLessThan(g.indexOf('await confirmAction('));
    expect(kapi).toBeLessThan(g.indexOf("authFetch('/api/mikro/fatura/kaydet'"));
    const govdeKodu = kodSatirlari(join(SRC_KOK, 'server', 'mikro', 'govdeFaturaIrsaliye.ts')).map(s => s.kod).join('\n');
    expect(govdeKodu).toMatch(/sth_vergi:\s+satirKdvTutari\(kalem\.kdv, tutar, kdvOran, miktar, i \+ 1\),/);
  });
});
