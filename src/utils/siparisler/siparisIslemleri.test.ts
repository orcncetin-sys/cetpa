/** siparisIslemleri — 2026-09-25 kullanıcı bildirimleri (MF-383): teslim edilmişe sevkiyat, Mikro kaydını düzenleme/silme. */
import { describe, it, expect } from 'vitest';
import { yerelDegistirilebilir, sevkiyatEngeli, sevkiyatEngeliMetni, silmeYolu, mikroSilOnayMetni, mikroSilindiMetni, silinemezMetni, siparisNotMetni, silmeEngelMetni, silmeHataMetni } from './siparisIslemleri';

const native = { id: 'o1', status: 'Pending' };
const mf383 = { id: 'mikrofat__c1__-383', source: 'mikro-fatura', status: 'Delivered' };

describe('yerelDegistirilebilir', () => {
  it('Cetpa siparişi düzenlenir/silinir; Mikro kaynaklı (fatura ya da sipariş) HAYIR', () => {
    expect(yerelDegistirilebilir(native)).toBe(true);
    expect(yerelDegistirilebilir({ ...native, source: 'shopify' })).toBe(true);
    expect(yerelDegistirilebilir(mf383)).toBe(false);
    expect(yerelDegistirilebilir({ id: 'm', source: 'mikro-siparis' })).toBe(false);
  });
});

describe('silmeYolu — K-MF-SİL: "sildiğim tekrar gelsin ama yanına not düşsün silinmişti diye"', () => {
  it('native (ve Shopify) yerelde silinir', () => {
    expect(silmeYolu(native)).toBe('yerel');
    expect(silmeYolu({ ...native, source: 'shopify' })).toBe('yerel');
  });
  it('faturadan türeyen MF sunucu ucundan silinir (düzenleme kilidi AYRI: MF yine düzenlenmez)', () => {
    expect(silmeYolu(mf383)).toBe('mikroSunucu');
    expect(yerelDegistirilebilir(mf383)).toBe(false);
  });
  it("Mikro Siparişleri sözde satırı ('mikro-siparis', orders'ta doküman değil) silinmez", () => {
    expect(silmeYolu({ id: 'm', source: 'mikro-siparis' })).toBe('yok');
  });
  it('metinler iki dilde; onay metni geri geleceğini söyler', () => {
    expect(mikroSilOnayMetni('tr')).toMatch(/GERİ GELİR/);
    expect(mikroSilOnayMetni('en')).toMatch(/RETURNS/);
    expect(mikroSilindiMetni('tr')).toMatch(/silinmişti/);
    expect(silinemezMetni('en')).toMatch(/cannot be deleted/);
  });
});

describe('silmeEngelMetni — kaynak + ROL tek kural (sunucu: sipariş silme yalnız Admin/Manager)', () => {
  it('Admin/Manager: native ve MF silinir; Mikro sipariş satırı yine silinmez', () => {
    expect(silmeEngelMetni(native, 'Admin', 'tr')).toBeNull();
    expect(silmeEngelMetni(mf383, 'Manager', 'tr')).toBeNull();
    expect(silmeEngelMetni({ id: 'm', source: 'mikro-siparis' }, 'Admin', 'tr')).toBe(silinemezMetni('tr'));
  });
  it('Satış/Lojistik/rolsüz: native de MF de silinemez — gerekçe yetki', () => {
    for (const rol of ['Sales', 'Logistics', null, undefined]) {
      expect(silmeEngelMetni(native, rol, 'tr'), String(rol)).toMatch(/yetkiniz yok/);
      expect(silmeEngelMetni(mf383, rol, 'en'), String(rol)).toMatch(/not allowed/);
    }
  });
  it('silmeHataMetni: 403 nedeni ayrılır (MFA ≠ yetki); öteki hata genel metin (ham hata gösterilmez)', () => {
    const mfa = new Error('dbClient DELETE /orders/x → 403 {"error":"İki faktörlü doğrulama gerekli.","mfaRequired":true}');
    // TAM eşitlik: ham hata / yalnız sunucu metni / talimatsız metin döndüren mutant ayrılır (delta 3 inceleme).
    expect(silmeHataMetni(mfa, 'tr')).toBe('İki faktörlü doğrulama gerekli — sayfayı yenileyip kodu girin.');
    expect(silmeHataMetni(mfa, 'en')).toBe('Two-factor verification required — reload the page and enter your code.');
    expect(silmeHataMetni(new Error('dbClient DELETE /orders/x → 403 {"error":"Bu kayıt başka bir firmaya ait."}'), 'tr')).toBe('Bu işlem için yetkiniz yok.');
    expect(silmeHataMetni(new Error('dbClient DELETE /orders/x → 403 Forbidden'), 'tr')).not.toMatch(/Yönetici/);
    expect(silmeHataMetni(new Error('dbClient DELETE /orders/x → 500 pg düştü'), 'tr')).toBe('Sipariş silinemedi — tekrar deneyin.');
    expect(silmeHataMetni('x', 'en')).toMatch(/Could not delete/);
  });
});

describe('siparisNotMetni — liste not göstergesi (Siparişler + CRM tek kural)', () => {
  it('sistem notu önce, iç not sonra; boş/boşluk/metin olmayan atlanır; ikisi de yoksa boş', () => {
    expect(siparisNotMetni({ sistemNotu: 'silinmişti — geri geldi', notes: 'iç not' })).toBe('silinmişti — geri geldi\niç not');
    expect(siparisNotMetni({ sistemNotu: 'silinmişti' })).toBe('silinmişti');
    expect(siparisNotMetni({ notes: '  ', sistemNotu: null })).toBe('');
    expect(siparisNotMetni({})).toBe('');
  });
});

describe('sevkiyatEngeli — "teslim edilen bir şeye tekrar sevkiyat oluşturulamaz"', () => {
  it('teslim edilmiş (MF-383 dahil) ve iptal edilmiş siparişe sevkiyat açılmaz', () => {
    expect(sevkiyatEngeli(mf383, [])).toBe('teslimEdildi');
    expect(sevkiyatEngeli({ ...native, status: 'Cancelled' }, [])).toBe('iptal');
  });
  it('açık sevkiyatı olan siparişe ikinci sevkiyat açılmaz; iptal edilmiş sevkiyat engellemez', () => {
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Pending' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'In Transit' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Delivered' }])).toBe('sevkiyatTeslim');   // "açık" DEĞİL
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Delivered' }, { orderId: 'o1', status: 'Pending' }])).toBe('sevkiyatAcik');
    expect(sevkiyatEngeli(native, [{ orderId: 'o1', status: 'Cancelled' }])).toBeNull();
    expect(sevkiyatEngeli(native, [{ orderId: 'baska', status: 'Pending' }])).toBeNull();
  });
  it('bekleyen / hazırlanan / kargodaki siparişe açılır', () => {
    for (const status of ['Pending', 'Processing', 'Shipped']) expect(sevkiyatEngeli({ ...native, status }, [])).toBeNull();
  });
  // K-MİKRO-SİPARİŞ (2026-09-25): Mikro Siparişleri sekmesindeki satır `orders` dokümanı değil, durumu yer tutucu
  // 'Pending' — durum kuralları onu "açılır" sayıyordu, sevkiyat öksüz kalıyordu. Faturadan türeyen MF siparişi AÇIK kalır.
  it("Mikro Siparişleri satırı (source 'mikro-siparis', durum yer tutucu 'Pending') sevkiyat AÇMAZ; faturadan türeyen MF açar", () => {
    expect(sevkiyatEngeli({ id: 'm1', source: 'mikro-siparis', status: 'Pending' }, [])).toBe('mikroSiparisi');
    expect(sevkiyatEngeli({ id: 'm1', source: 'mikro-siparis', status: 'Delivered' }, [])).toBe('mikroSiparisi');
    expect(sevkiyatEngeli({ ...mf383, status: 'Pending' }, [])).toBeNull();
    expect(sevkiyatEngeliMetni('mikroSiparisi', 'tr')).toMatch(/faturadan türeyen Cetpa siparişinden/);
    expect(sevkiyatEngeliMetni('mikroSiparisi', 'en')).toMatch(/derived from the invoice/);
  });
  it('neden metni iki dilde', () => {
    expect(sevkiyatEngeliMetni('teslimEdildi', 'tr')).toMatch(/teslim edilmiş/);
    expect(sevkiyatEngeliMetni('sevkiyatAcik', 'en')).toMatch(/already has/);
    expect(sevkiyatEngeliMetni('sevkiyatTeslim', 'tr')).toMatch(/teslim edilmiş/);
  });
});
