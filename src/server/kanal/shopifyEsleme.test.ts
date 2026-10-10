import { describe, it, expect } from 'vitest';
import {
  siparisOlayiEsle, kargoOlayiEsle, kargoOlayiKimligi, olayKimligi, shopifyKimligi, shopifySiparisKimligi, MAGAZA_KAYNAGI,
  type ShopifyBaglam,
} from './shopifyEsleme';

const B: ShopifyBaglam = { cid: 'kiraciA', tuz: 'tuz-1' };
const SIMDI = '2026-10-02T12:00:00.000Z';
const siparis = (ek: Record<string, unknown> = {}) => ({
  id: 5678901234567, name: '#1001', order_number: 1001,
  created_at: '2026-10-01T23:30:00+03:00', updated_at: '2026-10-01T23:31:00+03:00',
  currency: 'TRY', total_price: '1199.90', total_tax: '199.98', total_discounts: '100.00', taxes_included: true,
  total_shipping_price_set: { shop_money: { amount: '49.90', currency_code: 'TRY' } },
  financial_status: 'pending', fulfillment_status: null,
  email: 'musteri@example.com', phone: null, note: 'Kapıya bırakın',
  customer: { first_name: 'Şirin', last_name: 'Yılmaz', email: 'musteri@example.com', phone: '+905550000000' },
  billing_address: { name: 'Şirin Yılmaz', address1: 'Atatürk Cd. 1', city: 'Çankaya', province: 'Ankara', zip: '06000', country: 'Türkiye' },
  shipping_address: { name: 'Şirin Yılmaz', address1: 'Atatürk Cd. 1', address2: 'Kat 2', city: 'Çankaya', province: 'Ankara', zip: '06000', country: 'Türkiye', country_code: 'TR', phone: '+905551112233' },
  payment_gateway_names: ['Havale / EFT'],
  line_items: [
    { id: 111, sku: 'DYO-1', name: 'Boya 2,5 L - Beyaz', title: 'Boya 2,5 L', quantity: 2, price: '600.00', variant_id: 9,
      discount_allocations: [{ amount: '100.00' }], tax_lines: [{ price: '183.33' }] },
  ],
  ...ek,
});
const yaz = (s: ReturnType<typeof siparisOlayiEsle>) => { if (s.tur !== 'yaz') throw new Error(`yazılmadı: ${JSON.stringify(s)}`); return s; };
/** Çağıranın `set(…, { merge: true })` yazımı: yamadaki üst düzey anahtarlar kaydın üstüne yazılır (pgShim `mergeDocData` ile aynı anlam). */
const birlestir = (kayit: Record<string, unknown>, yama: Record<string, unknown>): Record<string, unknown> => ({ ...kayit, ...yama });
/** Her sipariş olayında tazelenen, sahibi Shopify olan metin alanları → o alanı (yalnız onu) Shopify'da BOŞALTAN gövde parçası. */
const BOSALTAN: Record<string, Record<string, unknown>> = {
  musteriNotu: { note: null },
  customerEmail: { email: null, contact_email: '', customer: { first_name: 'Şirin', last_name: 'Yılmaz', email: null, phone: '+905550000000' } },
  customerPhone: {
    phone: null, customer: { first_name: 'Şirin', last_name: 'Yılmaz', email: 'musteri@example.com', phone: null },
    shipping_address: { name: 'Şirin Yılmaz', address1: 'Atatürk Cd. 1', city: 'Çankaya', province: 'Ankara', phone: '' },
  },
  teslimatSehri: { shipping_address: { name: 'Şirin Yılmaz', address1: 'Atatürk Cd. 1', city: '', province: null, phone: '+905551112233' } },
  shippingAddress: { shipping_address: null, billing_address: null },
  // Yalnız `country_code` yok: adres metni ve «ilçe / il» fikstürdekiyle aynı kalır.
  teslimatUlke: { shipping_address: { name: 'Şirin Yılmaz', address1: 'Atatürk Cd. 1', address2: 'Kat 2', city: 'Çankaya', province: 'Ankara', zip: '06000', country: 'Türkiye', phone: '+905551112233' } },
};
const TAZELENEN_ALANLAR = Object.keys(BOSALTAN);
const HEPSI_BOS = { note: '', email: null, contact_email: null, phone: null, customer: null, shipping_address: null, billing_address: null };

describe('kimlik', () => {
  it('doküman kimliği kiracıya ve tuza bağlı, tahmin edilemez, yeniden teslimde AYNI', () => {
    const a = shopifySiparisKimligi(B, '5678901234567');
    expect(a).toMatch(/^shopify__[0-9a-f]{32}$/);
    expect(a).not.toContain('5678901234567');
    expect(shopifySiparisKimligi(B, '5678901234567')).toBe(a);
    expect(shopifySiparisKimligi({ ...B, cid: 'kiraciB' }, '5678901234567')).not.toBe(a);
    expect(shopifySiparisKimligi({ ...B, tuz: 'tuz-2' }, '5678901234567')).not.toBe(a);
  });
  it('güvenli tamsayı olmayan / boş kimlik reddedilir (2^53 üstü JSON.parse\'ta yuvarlanır)', () => {
    expect(shopifyKimligi(5678901234567)).toBe('5678901234567');
    expect(shopifyKimligi('5678901234567')).toBe('5678901234567');
    for (const k of [2 ** 53, 0, -1, 1.5, '', 'abc', '12 3', null, undefined, {}]) expect(shopifyKimligi(k)).toBeNull();
  });
  it('olay yönlendirmesi: sipariş / kargo / bilinmeyen topic / test bildirimi', () => {
    expect(olayKimligi('orders/paid', siparis(), B)).toEqual({ tur: 'siparis', docId: shopifySiparisKimligi(B, '5678901234567') });
    expect(olayKimligi('fulfillments/create', { order_id: 5678901234567 }, B)).toEqual({ tur: 'kargo', docId: shopifySiparisKimligi(B, '5678901234567') });
    expect(olayKimligi('refunds/create', siparis(), B)).toEqual({ tur: 'atla', neden: 'topic' });
    expect(olayKimligi('orders/create', siparis({ test: true }), B)).toEqual({ tur: 'atla', neden: 'test' });
    expect(olayKimligi('orders/create', { id: 'x' }, B)).toEqual({ tur: 'atla', neden: 'kimliksiz' });
    expect(kargoOlayiKimligi({}, B)).toBeNull();
  });
});

describe('siparisOlayiEsle — oluşturma', () => {
  it('alanlar: kimlik, müşteri, adres (tek satır metin), tutar, kalem, kaynak, kiracı, mağazanın yerel günü', () => {
    const s = yaz(siparisOlayiEsle(siparis(), undefined, B, SIMDI));
    expect(s.olustur).toBe(true);
    expect(s.siparisNo).toBe('#1001');
    expect(s.docId).toBe(shopifySiparisKimligi(B, '5678901234567'));
    expect(s.yama).toMatchObject({
      shopifyId: '5678901234567', shopifyOrderId: '#1001', shopifyGuncelleme: '2026-10-01T23:31:00+03:00',
      customerName: 'Şirin Yılmaz', customerEmail: 'musteri@example.com', customerPhone: '+905551112233',
      shippingAddress: 'Şirin Yılmaz, Atatürk Cd. 1, Kat 2, Çankaya / Ankara, 06000, Türkiye', teslimatSehri: 'Çankaya / Ankara',
      teslimatUlke: 'TR',
      musteriNotu: 'Kapıya bırakın', paraBirimi: 'TRY', totalPrice: 1199.9, kargoUcreti: 49.9, iskontoToplami: 100,
      status: 'Pending', paid: false,
      companyId: 'kiraciA', source: MAGAZA_KAYNAGI, customerType: 'Retail',
      createdAt: '2026-10-01T23:30:00+03:00', orderDate: '2026-10-01',
      shopifyRaw: { financialStatus: 'pending', fulfillmentStatus: null, cancelledAt: null, odemeYontemi: 'Havale / EFT', vergi: 199.98, vergiDahil: true },
    });
  });
  it('fatura durumu ve KDV alanları YAZILMAZ (faturali:false = "faturasız satış" → fatura / e-İrsaliye yolları kapanırdı)', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis(), undefined, B, SIMDI));
    for (const alan of ['faturali', 'kdvOran', 'kdvTutari', 'kdvHaricTutar', 'paidAt', 'trackingNumber', 'cargoCompany', 'dovizTutar']) expect(yama).not.toHaveProperty(alan);
  });
  it('kalem: vergi DÂHİL mağazada total = satır − iskonto, net = total − KDV; `price` yazılmaz', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis(), undefined, B, SIMDI));
    expect(yama.lineItems).toEqual([{
      id: '111', sku: 'DYO-1', name: 'Boya 2,5 L - Beyaz', title: 'Boya 2,5 L', quantity: 2,
      total: 1100, kdv: 183.33, netTutar: 916.67, variantId: '9',
    }]);
  });
  it('kalem: vergi HARİÇ mağazada net = satır, total = net + KDV', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis({ taxes_included: false }), undefined, B, SIMDI));
    expect((yama.lineItems as unknown[])[0]).toMatchObject({ netTutar: 1100, kdv: 183.33, total: 1283.33 });
  });
  it('SAHTE SIFIR YOK: okunamayan tutar yazılmaz; okunamayan fiyat/miktar/vergi kalemde null', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis({
      total_price: undefined, total_discounts: 'abc', total_shipping_price_set: undefined, taxes_included: undefined,
      line_items: [{ id: 1, name: 'A', quantity: 'iki', price: '10.00', tax_lines: [{ price: '1.00' }] }, { id: 2, title: 'B', quantity: 1, price: '10.00' }],
    }), undefined, B, SIMDI));
    for (const alan of ['totalPrice', 'dovizTutar', 'iskontoToplami', 'kargoUcreti']) expect(yama).not.toHaveProperty(alan);
    expect(yama.lineItems).toEqual([
      { id: '1', sku: '', name: 'A', title: null, quantity: null, total: null, kdv: 1, netTutar: null, variantId: null },
      // Vergi satırı HİÇ gelmedi → KDV bilinmiyor; verginin dâhil olup olmadığı bilinmiyor → satırın brüt mü net mi olduğu da bilinmiyor.
      { id: '2', sku: '', name: 'B', title: 'B', quantity: 1, total: null, kdv: null, netTutar: null, variantId: null },
    ]);
  });
  it('vergi dâhil ama vergi satırı okunamıyor: total bilinir, net bilinmez', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis({ line_items: [{ id: 1, name: 'A', quantity: 1, price: '120.00' }] }), undefined, B, SIMDI));
    expect((yama.lineItems as unknown[])[0]).toMatchObject({ total: 120, kdv: null, netTutar: null });
  });
  it('müşteri adı yedekleri: fatura adı → teslimat adı → ad soyad → e-posta → sabit metin ("undefined undefined" yok)', () => {
    const ad = (ek: Record<string, unknown>) => yaz(siparisOlayiEsle(siparis(ek), undefined, B, SIMDI)).yama.customerName;
    expect(ad({ billing_address: null })).toBe('Şirin Yılmaz');
    expect(ad({ billing_address: null, shipping_address: null })).toBe('Şirin Yılmaz');
    expect(ad({ billing_address: null, shipping_address: null, customer: { first_name: 'Şirin' } })).toBe('Şirin');
    expect(ad({ billing_address: null, shipping_address: null, customer: null })).toBe('musteri@example.com');
    expect(ad({ billing_address: null, shipping_address: null, customer: null, email: null })).toBe('Adı bilinmiyor (online)');
  });
  it('TRY dışı sipariş: totalPrice YAZILMAZ, dovizTutar + paraBirimi yazılır (kur uydurulmaz)', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis({ currency: 'EUR', total_price: '50.00' }), undefined, B, SIMDI));
    expect(yama).toMatchObject({ dovizTutar: 50, paraBirimi: 'EUR' });
    expect(yama).not.toHaveProperty('totalPrice');
  });
  it('test bildirimi ve kimliksiz gövde siparişe dönüşmez', () => {
    expect(siparisOlayiEsle(siparis({ test: true }), undefined, B, SIMDI)).toEqual({ tur: 'atla', neden: 'test' });
    expect(siparisOlayiEsle(siparis({ id: 2 ** 60 }), undefined, B, SIMDI)).toEqual({ tur: 'atla', neden: 'kimliksiz' });
    expect(siparisOlayiEsle(null, undefined, B, SIMDI)).toEqual({ tur: 'atla', neden: 'kimliksiz' });
  });
  it('created_at okunamazsa oluşturma zamanı çağıranın saatinden', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis({ created_at: 'bozuk' }), undefined, B, SIMDI));
    expect(yama).toMatchObject({ createdAt: SIMDI, orderDate: '2026-10-02' });
  });
  it('oluşturmada BOŞ gelen tazelenen alan YAZILMAZ (null da yazılmaz — silinecek eski değer yok)', () => {
    const { yama } = yaz(siparisOlayiEsle(siparis(HEPSI_BOS), undefined, B, SIMDI));
    for (const alan of TAZELENEN_ALANLAR) expect(yama).not.toHaveProperty(alan);
  });
  it('teslimatUlke: YALNIZ shipping_address.country_code ve yalnız ^[A-Z]{2}$ ise; değilse anahtar YOK (varsayılan \'TR\' yazılmaz)', () => {
    const teslimat = siparis().shipping_address;
    const y = (kod: unknown) => yaz(siparisOlayiEsle(siparis({ shipping_address: { ...teslimat, country_code: kod } }), undefined, B, SIMDI)).yama;
    expect(y('DE')).toHaveProperty('teslimatUlke', 'DE');
    expect(y(' DE ')).toHaveProperty('teslimatUlke', 'DE');   // kırpılır (öbür metin alanları gibi)
    // Harf büyütme / ülke adından kod tahmini YOK: biçimce kod olmayan değer için anahtar hiç yazılmaz.
    for (const kod of [undefined, null, '', '  ', 'tr', 'Tr', 'TUR', 'T', 'Türkiye', 'T1', 90, true, {}]) {
      expect(y(kod), String(JSON.stringify(kod))).not.toHaveProperty('teslimatUlke');
    }
    // Teslimat adresi HİÇ yok → fatura adresindeki koda DÜŞÜLMEZ (adres metni fatura adresinden kurulsa da ülke bilinmiyor).
    const faturadan = yaz(siparisOlayiEsle(siparis({ shipping_address: null, billing_address: { ...siparis().billing_address, country_code: 'DE' } }), undefined, B, SIMDI)).yama;
    expect(faturadan).toHaveProperty('shippingAddress', 'Şirin Yılmaz, Atatürk Cd. 1, Çankaya / Ankara, 06000, Türkiye');
    expect(faturadan).not.toHaveProperty('teslimatUlke');
    // Teslimat adresinde kod yok, fatura adresinde var → yine yazılmaz.
    expect(yaz(siparisOlayiEsle(siparis({ ...BOSALTAN.teslimatUlke, billing_address: { ...siparis().billing_address, country_code: 'DE' } }), undefined, B, SIMDI)).yama)
      .not.toHaveProperty('teslimatUlke');
  });
  it('teslimatUlke eklenirken mağaza siparişinin shippingAddress (TAM adres) ve teslimatSehri («ilçe / il») anlamı DEĞİŞMEZ', () => {
    // Yabancı ülke: adres metni ülke ADINI zaten taşır; il / ülke alanları metne karışmaz, şehir «ilçe / il» biçiminde kalır.
    const { yama } = yaz(siparisOlayiEsle(siparis({
      shipping_address: { name: 'Max Mustermann', address1: 'Hauptstr. 5', city: 'Berlin', province: 'Berlin', zip: '10115', country: 'Germany', country_code: 'DE' },
    }), undefined, B, SIMDI));
    expect(yama).toMatchObject({
      shippingAddress: 'Max Mustermann, Hauptstr. 5, Berlin / Berlin, 10115, Germany', teslimatSehri: 'Berlin / Berlin', teslimatUlke: 'DE',
    });
  });
  it('paidAt: kayıt ilk kez ve ZATEN ÖDENMİŞ oluşuyorsa processed_at; yoksa updated_at; o da yoksa çağıranın saati', () => {
    const y = (ek: Record<string, unknown>) => yaz(siparisOlayiEsle(siparis({ financial_status: 'paid', ...ek }), undefined, B, SIMDI)).yama;
    // Kartla ödeme: sipariş işlendiği anda ödenmiştir; `updated_at` (23:31) sonraki bir dokunuş olabilir.
    expect(y({ processed_at: '2026-10-01T23:30:05+03:00' })).toMatchObject({ paid: true, paidAt: '2026-10-01T23:30:05+03:00' });
    expect(y({})).toMatchObject({ paid: true, paidAt: '2026-10-01T23:31:00+03:00' });
    expect(y({ updated_at: undefined })).toMatchObject({ paid: true, paidAt: SIMDI });
  });
});

describe('siparisOlayiEsle — güncelleme', () => {
  const mevcut = (ek: Record<string, unknown> = {}) => ({ status: 'Pending', shopifyGuncelleme: '2026-10-01T23:31:00+03:00', companyId: 'kiraciA', ...ek });
  const sonra = { updated_at: '2026-10-02T09:00:00+03:00' };
  it('güncellemede oluşturma alanları (companyId, source, createdAt, orderDate, customerType) YAZILMAZ', () => {
    const s = yaz(siparisOlayiEsle(siparis(sonra), mevcut(), B, SIMDI));
    expect(s.olustur).toBe(false);
    for (const alan of ['companyId', 'source', 'createdAt', 'orderDate', 'customerType']) expect(s.yama).not.toHaveProperty(alan);
  });
  it('bayat olay atlanır; zaman çözülemezse olay işlenir', () => {
    expect(siparisOlayiEsle(siparis({ updated_at: '2026-10-01T20:00:00+03:00' }), mevcut(), B, SIMDI)).toEqual({ tur: 'atla', neden: 'bayat' });
    // Aynı an farklı saat dilimi yazımı: metin karşılaştırması yanıltırdı, milisaniye karşılaştırması yanıltmaz.
    expect(siparisOlayiEsle(siparis({ updated_at: '2026-10-01T20:31:00Z' }), mevcut(), B, SIMDI).tur).toBe('yaz');
    expect(siparisOlayiEsle(siparis({ updated_at: 'bozuk' }), mevcut(), B, SIMDI).tur).toBe('yaz');
  });
  it('durum: ödeme → Processing, tam gönderim → Shipped, kısmi → Processing, iptal → Cancelled', () => {
    const durum = (ek: Record<string, unknown>, m = mevcut()) => yaz(siparisOlayiEsle(siparis({ ...sonra, ...ek }), m, B, SIMDI)).yama.status;
    for (const o of ['paid', 'partially_paid', 'authorized', 'partially_refunded']) expect(durum({ financial_status: o })).toBe('Processing');
    for (const o of ['pending', 'voided', 'refunded']) {
      // Kayıt zaten Pending: durum DEĞİŞMEDİ → status yamada yok. Eşlemenin kendisi durumu olmayan kayıtta görünür.
      expect(yaz(siparisOlayiEsle(siparis({ ...sonra, financial_status: o }), mevcut(), B, SIMDI)).yama).not.toHaveProperty('status');
      expect(durum({ financial_status: o }, mevcut({ status: undefined }))).toBe('Pending');
    }
    expect(durum({ fulfillment_status: 'fulfilled' })).toBe('Shipped');
    expect(durum({ fulfillment_status: 'partial' })).toBe('Processing');
    expect(durum({ cancelled_at: '2026-10-02T08:00:00+03:00', fulfillment_status: 'fulfilled' })).toBe('Cancelled');
  });
  it('durum GERİ GİTMEZ; kullanıcının verdiği ileri durum korunur; iptal KALICI', () => {
    // Korunan durum yamaya HİÇ GİRMEZ (yeniden yazılmaz) → birleşik kayıtta kayıttaki değer kalır.
    const korunur = (m: Record<string, unknown>, ek: Record<string, unknown> = {}) => {
      const kayit = mevcut(m);
      const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, ...ek }), kayit, B, SIMDI));
      expect(yama).not.toHaveProperty('status');
      return birlestir(kayit, yama).status;
    };
    expect(korunur({ status: 'Shipped' })).toBe('Shipped');                                   // orders/updated ödeme bekliyor diyor
    expect(korunur({ status: 'Delivered' }, { fulfillment_status: 'fulfilled' })).toBe('Delivered');
    expect(korunur({ status: 'Cancelled' }, { financial_status: 'paid' })).toBe('Cancelled'); // kim iptal etmiş olursa olsun
    expect(korunur({ status: 'Cancelled' }, { fulfillment_status: 'fulfilled' })).toBe('Cancelled');
    // İptal ileri durumu da ezer: durum DEĞİŞTİ → yamaya girer.
    expect(yaz(siparisOlayiEsle(siparis({ ...sonra, cancelled_at: '2026-10-02T08:00:00+03:00' }), mevcut({ status: 'Delivered' }), B, SIMDI)).yama.status).toBe('Cancelled');
  });
  it('status yalnız OLUŞTURMADA ya da birleşik durum kayıttakinden FARKLIYSA yamaya girer', () => {
    const y = (m: Record<string, unknown> | undefined, ek: Record<string, unknown> = {}) =>
      yaz(siparisOlayiEsle(siparis({ ...sonra, ...ek }), m === undefined ? undefined : mevcut(m), B, SIMDI)).yama;
    expect(y(undefined)).toMatchObject({ status: 'Pending' });                                      // oluşturma
    expect(y({ status: 'Pending' })).not.toHaveProperty('status');                                  // aynı durum
    expect(y({ status: 'Processing' }, { financial_status: 'paid' })).not.toHaveProperty('status'); // aynı durum
    expect(y({ status: 'Shipped' }, { fulfillment_status: 'fulfilled' })).not.toHaveProperty('status');
    expect(y({ status: 'Pending' }, { financial_status: 'paid' })).toMatchObject({ status: 'Processing' }); // ilerledi
    expect(y({ status: 'Processing' }, { fulfillment_status: 'fulfilled' })).toMatchObject({ status: 'Shipped' });
    // Kayıtta durum yok / tanınmayan değer: Shopify'ın durumu yazılır (eski davranış).
    expect(y({ status: undefined })).toMatchObject({ status: 'Pending' });
    expect(y({ status: 'Bilinmeyen' })).toMatchObject({ status: 'Pending' });
  });
  it('paid TEK YÖNLÜ: true olan kayda false yazılmaz; ödeme gelince paidAt bir kez yazılır', () => {
    const y = (m: Record<string, unknown>, ek: Record<string, unknown>) => yaz(siparisOlayiEsle(siparis({ ...sonra, ...ek }), mevcut(m), B, SIMDI)).yama;
    const elle = y({ paid: true }, { financial_status: 'pending' });
    expect(elle).not.toHaveProperty('paid'); expect(elle).not.toHaveProperty('paidAt');
    // Mevcut kayıt ödenmişe GEÇİYOR: ödeme anı o güncellemedir (`processed_at` siparişin işlendiği an — bkz. paidAt testi).
    expect(y({}, { financial_status: 'paid', processed_at: '2026-10-01T23:30:05+03:00' })).toMatchObject({ paid: true, paidAt: sonra.updated_at });
    const zaten = y({ paid: true }, { financial_status: 'paid' });
    expect(zaten.paid).toBe(true); expect(zaten).not.toHaveProperty('paidAt');
    expect(y({}, { financial_status: undefined })).not.toHaveProperty('paid');
  });
  it('paid:false yalnız kayıtta paid bir boolean DEĞİLKEN yazılır; kayıt zaten false iken yeniden yazılmaz', () => {
    const y = (m: Record<string, unknown>, ek: Record<string, unknown> = {}) => yaz(siparisOlayiEsle(siparis({ ...sonra, ...ek }), mevcut(m), B, SIMDI)).yama;
    for (const o of ['pending', 'voided', 'refunded', 'authorized']) {
      const zatenFalse = y({ paid: false }, { financial_status: o });
      expect(zatenFalse).not.toHaveProperty('paid'); expect(zatenFalse).not.toHaveProperty('paidAt');
    }
    // Alan kayıtta yok / null / boolean değil (eski ya da elle bozulmuş kayıt): ödeme durumu bilinsin diye false yazılır.
    for (const yok of [undefined, null, 'hayır']) expect(y({ paid: yok })).toMatchObject({ paid: false });
    // Ödenmemiş kayıt ödenince true + paidAt (tek yön kuralı aynen).
    expect(y({ paid: false }, { financial_status: 'paid' })).toMatchObject({ paid: true, paidAt: sonra.updated_at });
  });
  it('bayat okuma yarışı: olay eski kaydı okudu, kullanıcı o arada Delivered / paid:true yazdı → birleşik kayıtta kullanıcının değerleri kalır', () => {
    // İşleyici `get` ile kaydı okudu; yama bu BAYAT okumaya göre hesaplandı (Shopify hâlâ "gönderildi, ödeme bekliyor" diyor).
    const bayat = mevcut({ status: 'Shipped', paid: false });
    const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, fulfillment_status: 'fulfilled', financial_status: 'pending' }), bayat, B, SIMDI));
    // `get` ile `set(merge)` arasında kullanıcı Cetpa'da "Teslim edildi" ve "Ödendi" işaretledi.
    const guncel = { ...bayat, status: 'Delivered', paid: true, paidAt: 'KULLANICI-ZAMANI', paymentMethod: 'Havale' };
    expect(birlestir(guncel, yama)).toMatchObject({
      status: 'Delivered', paid: true, paidAt: 'KULLANICI-ZAMANI', paymentMethod: 'Havale',
      shopifyGuncelleme: sonra.updated_at, // olay yine de işlendi
    });
    for (const alan of ['status', 'paid', 'paidAt']) expect(yama).not.toHaveProperty(alan);
  });
  it('paidAt ödeme ANI: mevcut kayıt ödenmemişten ödenmişe geçerken updated_at; yoksa processed_at; o da yoksa çağıranın saati', () => {
    const y = (m: Record<string, unknown>, ek: Record<string, unknown>) => yaz(siparisOlayiEsle(siparis({ ...sonra, financial_status: 'paid', ...ek }), mevcut(m), B, SIMDI)).yama;
    // Havale / EFT: sipariş 1 Ekim'de işlendi (`processed_at`), ödeme 2 Ekim 09:00 güncellemesiyle geldi.
    const islenme = '2026-10-01T23:30:05+03:00';
    for (const m of [{ paid: false }, {}, { paid: null }]) expect(y(m, { processed_at: islenme }).paidAt).toBe(sonra.updated_at);
    expect(y({ paid: false }, { processed_at: islenme, updated_at: undefined }).paidAt).toBe(islenme);
    expect(y({ paid: false }, { updated_at: undefined }).paidAt).toBe(SIMDI);
    // Zaten ödenmiş kayıtta (elle "Ödendi" dâhil) paidAt'e DOKUNULMAZ.
    expect(y({ paid: true, paidAt: 'KULLANICI-ZAMANI' }, { processed_at: islenme })).not.toHaveProperty('paidAt');
  });
  it('Shopify\'da BOŞALTILAN tazelenen alan kayıtta doluysa açıkça null yazılır (yamaya koymamak silmeyi sessiz no-op yapardı)', () => {
    const dolu = { musteriNotu: 'Kapıya bırakın', customerEmail: 'musteri@example.com', customerPhone: '+905551112233', teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'TR', shippingAddress: 'Şirin Yılmaz, Atatürk Cd. 1' };
    // Alanlar TEK TEK: yalnız boşaltılan null olur.
    for (const alan of TAZELENEN_ALANLAR) {
      const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, ...BOSALTAN[alan] }), mevcut(dolu), B, SIMDI));
      expect(yama, alan).toHaveProperty(alan, null);
      expect(birlestir(mevcut(dolu), yama)[alan], alan).toBeNull();
    }
    expect(yaz(siparisOlayiEsle(siparis({ ...sonra, note: null }), mevcut(dolu), B, SIMDI)).yama).toMatchObject({
      musteriNotu: null, customerEmail: 'musteri@example.com', customerPhone: '+905551112233', teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'TR',
    });
    // Yalnız ülke kodu düşen gövdede adres metni ve «ilçe / il» AYNEN tazelenir; null olan yalnız ülkedir.
    expect(yaz(siparisOlayiEsle(siparis({ ...sonra, ...BOSALTAN.teslimatUlke }), mevcut(dolu), B, SIMDI)).yama).toMatchObject({
      teslimatUlke: null, teslimatSehri: 'Çankaya / Ankara', shippingAddress: 'Şirin Yılmaz, Atatürk Cd. 1, Kat 2, Çankaya / Ankara, 06000, Türkiye',
    });
    // Hepsi birden.
    const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, ...HEPSI_BOS }), mevcut(dolu), B, SIMDI));
    for (const alan of TAZELENEN_ALANLAR) expect(yama, alan).toHaveProperty(alan, null);
  });
  it('tazelenen alan: kayıt zaten BOŞKEN (undefined / null / \'\') gelen boş değer için anahtar yazılmaz; dolu gelen değer yazılır', () => {
    for (const bos of [undefined, null, '']) {
      const kayit = mevcut(Object.fromEntries(TAZELENEN_ALANLAR.map(alan => [alan, bos])));
      const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, ...HEPSI_BOS }), kayit, B, SIMDI));
      for (const alan of TAZELENEN_ALANLAR) expect(yama, `${alan} / ${String(bos)}`).not.toHaveProperty(alan);
    }
    // Değişen değer (dolu → başka dolu) her olayda tazelenir.
    expect(yaz(siparisOlayiEsle(siparis(sonra), mevcut({ musteriNotu: 'Eski not', customerEmail: 'eski@example.com', teslimatUlke: 'DE' }), B, SIMDI)).yama)
      .toMatchObject({ musteriNotu: 'Kapıya bırakın', customerEmail: 'musteri@example.com', teslimatUlke: 'TR' });
    // Bu dağıtımdan ÖNCE oluşmuş kayıt (ülke alanı yok): sonraki olayda kod geliyorsa yazılır, gelmiyorsa anahtar yok (null da değil).
    expect(yaz(siparisOlayiEsle(siparis(sonra), mevcut(), B, SIMDI)).yama).toHaveProperty('teslimatUlke', 'TR');
    expect(yaz(siparisOlayiEsle(siparis({ ...sonra, ...BOSALTAN.teslimatUlke }), mevcut(), B, SIMDI)).yama).not.toHaveProperty('teslimatUlke');
    // Kayıtta geçerli kod varken BİÇİMSİZ kod gelirse (küçük harf) tahminle düzeltilmez: ülke bilinmiyor → null.
    const teslimat = siparis().shipping_address;
    expect(yaz(siparisOlayiEsle(siparis({ ...sonra, shipping_address: { ...teslimat, country_code: 'de' } }), mevcut({ teslimatUlke: 'DE' }), B, SIMDI)).yama)
      .toHaveProperty('teslimatUlke', null);
  });
  it('kargo: takip numarası siparişteki SON başarılı gönderimden; yoksa alan yazılmaz (boşla ezilmez)', () => {
    const y = (g: unknown) => yaz(siparisOlayiEsle(siparis({ ...sonra, fulfillments: g }), mevcut({ trackingNumber: 'ESKI' }), B, SIMDI)).yama;
    expect(y([{ status: 'success', tracking_number: 'A1', tracking_company: 'Yurtiçi' }, { status: 'cancelled', tracking_number: 'B2' }]))
      .toMatchObject({ trackingNumber: 'A1', cargoCompany: 'Yurtiçi' });
    expect(y([])).not.toHaveProperty('trackingNumber');
    expect(y(undefined)).not.toHaveProperty('cargoCompany');
    // Tazelenen alanların tersine: kayıtta DOLU kargo alanı, Shopify boş gönderince null'lanmaz.
    const kayit = mevcut({ trackingNumber: 'ESKI', cargoCompany: 'Aras' });
    const { yama } = yaz(siparisOlayiEsle(siparis({ ...sonra, ...HEPSI_BOS, fulfillments: [] }), kayit, B, SIMDI));
    expect(yama).not.toHaveProperty('trackingNumber'); expect(yama).not.toHaveProperty('cargoCompany');
    expect(birlestir(kayit, yama)).toMatchObject({ trackingNumber: 'ESKI', cargoCompany: 'Aras' });
  });
});

describe('kargoOlayiEsle', () => {
  const m = { status: 'Processing', shopifyOrderId: '#1001' };
  it('yalnız takip numarası / kargo firması yazar — DURUM DEĞİŞTİRMEZ', () => {
    const s = kargoOlayiEsle({ order_id: 5678901234567, status: 'success', tracking_number: 'TR123', tracking_company: 'Aras' }, m, B);
    expect(s).toEqual({ tur: 'yaz', docId: shopifySiparisKimligi(B, '5678901234567'), olustur: false, siparisNo: '#1001', yama: { trackingNumber: 'TR123', cargoCompany: 'Aras' } });
  });
  it('sipariş kaydı yoksa, gönderim başarılı değilse, yazacak değer yoksa, kimlik yoksa atlar', () => {
    const g = { order_id: 5678901234567, status: 'success', tracking_number: 'TR123' };
    expect(kargoOlayiEsle(g, undefined, B)).toEqual({ tur: 'atla', neden: 'kayitYok' });
    expect(kargoOlayiEsle({ ...g, status: 'failure' }, m, B)).toEqual({ tur: 'atla', neden: 'gonderimBasarisiz' });
    expect(kargoOlayiEsle({ order_id: 5678901234567, status: 'success' }, m, B)).toEqual({ tur: 'atla', neden: 'degisiklikYok' });
    expect(kargoOlayiEsle({ status: 'success', tracking_number: 'X' }, m, B)).toEqual({ tur: 'atla', neden: 'kimliksiz' });
  });
});
