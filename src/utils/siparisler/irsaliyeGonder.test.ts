import { describe, it, expect } from 'vitest';
import { irsaliyeIstegi, irsaliyeYanitMesaji, irsaliyeNedenMetni, irsaliyeSonucYamasi } from './irsaliyeGonder';

// ── Türkçe fikstür ───────────────────────────────────────────────────────────
const SIMDI = new Date('2026-09-19T08:30:00.000Z');

const kalem = (o: Record<string, unknown> = {}) => ({
  id: 'k1', sku: 'CIM-50', title: 'ÇİMENTO 50KG', name: 'Çimento', quantity: 100, price: 180, ...o,
});

const siparis = (o: Record<string, unknown> = {}) => ({
  id: 'SAS-0001-abcdef',
  customerName: 'Şirin İnşaat Ltd. Şti.',
  status: 'Shipped',
  shippingAddress: 'Esenyurt / İstanbul',
  trackingNumber: 'YK-778812',
  cargoCompany: 'Yurtiçi Kargo',
  lineItems: [kalem()],
  kdvOran: 20,
  depoNo: 2,
  faturali: true,
  ...o,
});

const cari = (o: Record<string, unknown> = {}) => ({ id: 'L-1', mikroCariKod: '120.01.0007', ...o });

describe('irsaliyeIstegi — gövde SAYFA PARİTESİ (App.tsx Shipped akışı)', () => {
  it('bilinen siparişte gövde eskiyle BİREBİR aynı', () => {
    const s = irsaliyeIstegi(siparis(), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(true);
    expect(s.neden).toBeUndefined();
    expect(s.govde).toEqual({
      shipment: {
        mikroCariKod: '120.01.0007',
        customerName: 'Şirin İnşaat Ltd. Şti.',
        destination:  'Esenyurt / İstanbul',
        trackingNo:   'YK-778812',
        cargoFirm:    'Yurtiçi Kargo',
        items: [{ sku: 'CIM-50', name: 'ÇİMENTO 50KG', quantity: 100, price: 180 }],
        date:     '2026-09-19T08:30:00.000Z',
        kdvOran:  20,
        faturali: true,
        depoNo:   2,
      },
      firebaseId: 'SAS-0001-abcdef',
    });
  });

  it('cari kod yedek zinciri: mikroCariKod → cariKod (boş metin ATLANIR)', () => {
    const g = (l: Record<string, unknown> | null) => irsaliyeIstegi(siparis(), l, { simdi: SIMDI }).govde?.shipment.mikroCariKod;
    expect(g(cari())).toBe('120.01.0007');
    expect(g({ id: 'L-1', mikroCariKod: '', cariKod: '120.01.0009' })).toBe('120.01.0009');
  });

  it('MÜŞTERİ ADI ve VKN cari kodu DEĞİLDİR: eşleşmemiş müşteride istek KURULMAZ', () => {
    // Mutasyon-ayırt-edici (2026-09-19 delta): zincir `… ?? taxId ?? customerName` iken
    // Mikro'ya `mikroCariKod: 'Şirin İnşaat Ltd. Şti.'` gidiyordu — sunucu yalnız boş-değil
    // bakıyor (govdeFaturaIrsaliye `metinGerekli`), yani var olmayan cari koduna bağlı resmî
    // e-İrsaliye kesiliyordu. 'cariYok' kapısı ve "müşteriyi Mikro carisiyle eşleştirin"
    // ipucu, customerName dolu olduğu sürece fiilen ÖLÜYDÜ.
    const neden = (l: Record<string, unknown> | null) => irsaliyeIstegi(siparis(), l, { simdi: SIMDI }).neden;
    expect(neden({ id: 'L-1' })).toBe('cariYok');                                   // lead var, kodu yok
    expect(neden(null)).toBe('musteriBagliDegil');                                  // lead hiç eşleşmedi
    expect(neden({ id: 'L-1', cariKod: '', taxId: '1234567890' })).toBe('cariYok');  // VKN cari kodu değil
    expect(irsaliyeIstegi(siparis(), null, { simdi: SIMDI }).govde).toBeUndefined();
  });

  it('serbest metin alanlarının boş varsayılanı ve takip no yedeği korunur', () => {
    const s = irsaliyeIstegi(
      siparis({ shippingAddress: undefined, cargoCompany: undefined, trackingNumber: '' }),
      cari(), { simdi: SIMDI },
    );
    expect(s.govde?.shipment.destination).toBe('');
    expect(s.govde?.shipment.cargoFirm).toBe('');
    // App.tsx: `order.trackingNumber || orderId.slice(0, 8)`
    expect(s.govde?.shipment.trackingNo).toBe('SAS-0001');
  });

  it('kalem adı zinciri: title → name → sku', () => {
    const ad = (k: Record<string, unknown>) =>
      irsaliyeIstegi(siparis({ lineItems: [kalem(k)] }), cari(), { simdi: SIMDI }).govde?.shipment.items[0].name;
    expect(ad({})).toBe('ÇİMENTO 50KG');
    expect(ad({ title: '' })).toBe('Çimento');
    expect(ad({ title: '', name: '' })).toBe('CIM-50');
  });

  it('`simdi` verilmezse tarih şu anın ISO değeri (eski `new Date().toISOString()`)', () => {
    const once = Date.now();
    const d = irsaliyeIstegi(siparis(), cari()).govde?.shipment.date ?? '';
    const sonra = Date.now();
    const t = Date.parse(d);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(once);
    expect(t).toBeLessThanOrEqual(sonra);
  });
});

describe('irsaliyeIstegi — faturasız sevkiyat Mikro defterine YAZILMAZ', () => {
  it('faturali === false → gönderilemez (govde hiç kurulmaz)', () => {
    const s = irsaliyeIstegi(siparis({ faturali: false }), cari(), { simdi: SIMDI });
    expect(s).toEqual({ gonderilebilir: false, neden: 'faturasiz' });
  });

  it('alanı olmayan eski/kanal siparişi eskisi gibi gönderilir (undefined ≠ false)', () => {
    const s = irsaliyeIstegi(siparis({ faturali: undefined }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(true);
    expect(s.govde?.shipment.faturali).toBeUndefined();
  });
});

describe('irsaliyeIstegi — depo VARSAYILMAZ (mutasyon-ayırt-edici)', () => {
  it('depo yoksa gönderilemez; `?? 1` uydurulup HAVALİMANI deposuna yazılmaz', () => {
    const s = irsaliyeIstegi(siparis({ depoNo: undefined }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(false);
    expect(s.neden).toBe('depoYok');
    expect(s.govde).toBeUndefined();
  });

  it('depo 0 / negatif / kesirli / metin → bilinmiyor sayılır (sunucu şeması int>0 ister)', () => {
    for (const d of [0, -1, 2.5, '2', null, NaN]) {
      expect(irsaliyeIstegi(siparis({ depoNo: d }), cari(), { simdi: SIMDI }).neden).toBe('depoYok');
    }
  });

  it('bilinen depo 2 (ESKİ SANAYİ) gövdeye AYNEN geçer', () => {
    expect(irsaliyeIstegi(siparis({ depoNo: 2 }), cari(), { simdi: SIMDI }).govde?.shipment.depoNo).toBe(2);
  });
});

describe('irsaliyeIstegi — KDV oranı VARSAYILMAZ (mutasyon-ayırt-edici)', () => {
  it('oran yoksa gönderilemez; `?? 20` uydurulmaz', () => {
    const s = irsaliyeIstegi(siparis({ kdvOran: undefined }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(false);
    expect(s.neden).toBe('kdvYok');
  });

  it('KDV oranı BİLİNEN 0 geçerlidir — `kdvOran || 20` / truthiness kapısı bunu kaçırır (mutasyon-ayırt-edici)', () => {
    const s = irsaliyeIstegi(siparis({ kdvOran: 0 }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(true);
    expect(s.govde?.shipment.kdvOran).toBe(0);
  });

  it('metin oran / NaN / aralık dışı → bilinmiyor (sunucu şeması number 0..100 ister)', () => {
    for (const o of ['20', NaN, null, 120, -1]) {
      expect(irsaliyeIstegi(siparis({ kdvOran: o }), cari(), { simdi: SIMDI }).neden).toBe('kdvYok');
    }
  });
});

describe('irsaliyeIstegi — kalemsiz / eksik kalemli sevkiyat SAHTE belge üretmez', () => {
  it('kalem yoksa gönderilemez (eskiden sunucu 1 adet / ₺0 satır uyduruyordu)', () => {
    expect(irsaliyeIstegi(siparis({ lineItems: [] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    expect(irsaliyeIstegi(siparis({ lineItems: undefined }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
  });

  it('stok kodu boş kalem → gönderilemez (sahipsiz stok hareketi)', () => {
    expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ sku: '' })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ sku: '   ' })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ sku: 50 })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
  });

  it('miktarı bilinmeyen / 0 / negatif / kesirli kalem → gönderilemez (mutasyon-ayırt-edici: `?? 1` yok)', () => {
    for (const m of [undefined, null, NaN, '100', 0, -3, 2.5]) {
      expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ quantity: m })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    }
  });

  it('fiyatı bilinmeyen kalem → gönderilemez (mutasyon-ayırt-edici: `?? 0` ile ₺0 satır yok)', () => {
    for (const f of [undefined, null, NaN, '180']) {
      expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ price: f })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    }
  });

  it('BİLİNEN ₺0 fiyat geçerlidir (numune/bedelsiz sevkiyat) — truthiness kapısı bunu kaçırır (mutasyon-ayırt-edici)', () => {
    const s = irsaliyeIstegi(siparis({ lineItems: [kalem({ price: 0 })] }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(true);
    expect(s.govde?.shipment.items[0].price).toBe(0);
  });

  it('bir kalem bile eksikse İSTEK KURULMAZ: bilinenler kısmi gönderilmez', () => {
    const s = irsaliyeIstegi(siparis({ lineItems: [kalem(), kalem({ id: 'k2', sku: 'DEMIR-12', price: null })] }), cari(), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(false);
    expect(s.govde).toBeUndefined();
  });

  it('adı hiç çözülemeyen kalem → gönderilemez (sunucu şeması name min(1) ister)', () => {
    expect(irsaliyeIstegi(siparis({ lineItems: [kalem({ title: '', name: '', sku: '  ' })] }), cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
  });
});

describe('irsaliyeIstegi — cari kod', () => {
  it('zincirin tamamı boşsa gönderilemez (sunucu şeması min(1) ister)', () => {
    const s = irsaliyeIstegi(siparis({ customerName: '   ' }), cari({ mikroCariKod: undefined }), { simdi: SIMDI });
    expect(s.gonderilebilir).toBe(false);
    expect(s.neden).toBe('cariYok');
  });

  it('boşluktan ibaret cari kod da gönderilemez (sunucu `metinGerekli` trim eder)', () => {
    expect(irsaliyeIstegi(siparis(), cari({ mikroCariKod: '   ' }), { simdi: SIMDI }).neden).toBe('cariYok');
  });

  it('CARİ KAYDI HİÇ YOK ile KODU YOK AYRI nedenlerdir — mutasyon-ayırt-edici', () => {
    // 2026-09-19 kapanış bulgusu: `leadId: null` ile açılan sipariş (müşteri adı elle yazılmış)
    // için `leads.find(...)` undefined döner ve düğme kalıcı 'cariYok' ile kilitleniyordu. O
    // ipucu ("müşteriyi Mikro carisiyle eşleştirin") böyle bir siparişte UYGULANAMAZ: sipariş
    // hiçbir lead'e bağlı değil, CRM'de eşleştirme yapmak sonucu değiştirmez. Doğru yönlendirme
    // "siparişi düzenleyip müşteriyi seçin"dir.
    expect(irsaliyeIstegi(siparis(), undefined, { simdi: SIMDI }).neden).toBe('musteriBagliDegil');
    expect(irsaliyeIstegi(siparis(), null, { simdi: SIMDI }).neden).toBe('musteriBagliDegil');
    expect(irsaliyeIstegi(siparis(), {}, { simdi: SIMDI }).neden).toBe('cariYok');
  });
});

describe('irsaliyeIstegi — neden önceliği kararlıdır', () => {
  it('faturasız sipariş, başka eksikleri olsa da önce `faturasiz` der', () => {
    const s = irsaliyeIstegi(siparis({ faturali: false, depoNo: undefined, kdvOran: undefined, lineItems: [] }), null, { simdi: SIMDI });
    expect(s.neden).toBe('faturasiz');
  });

  it('sıra: musteriBagliDegil → cariYok → kalemYok → depoYok → kdvYok', () => {
    const s = siparis({ lineItems: [], depoNo: undefined, kdvOran: undefined });
    expect(irsaliyeIstegi(s, null, { simdi: SIMDI }).neden).toBe('musteriBagliDegil');
    expect(irsaliyeIstegi(s, {}, { simdi: SIMDI }).neden).toBe('cariYok');
    expect(irsaliyeIstegi(s, cari(), { simdi: SIMDI }).neden).toBe('kalemYok');
    expect(irsaliyeIstegi({ ...s, lineItems: [kalem()] }, cari(), { simdi: SIMDI }).neden).toBe('depoYok');
    expect(irsaliyeIstegi({ ...s, lineItems: [kalem()], depoNo: 2 }, cari(), { simdi: SIMDI }).neden).toBe('kdvYok');
  });
});

describe('irsaliyeNedenMetni — devre dışı düğmenin ipucu / otomatik akışın uyarısı', () => {
  it('her neden için tr ve en metni var, boş değil ve birbirinden farklı', () => {
    const nedenler = ['faturasiz', 'depoYok', 'kdvYok', 'musteriBagliDegil', 'cariYok', 'kalemYok'] as const;
    for (const dil of ['tr', 'en'] as const) {
      const metinler = nedenler.map(n => irsaliyeNedenMetni(n, dil));
      expect(metinler.every(m => m.trim().length > 0)).toBe(true);
      expect(new Set(metinler).size).toBe(nedenler.length);
    }
  });

  it('depo/KDV eksikliği, sunucunun 400 yönlendirmesiyle aynı işi söyler (kullanıcı ne yapacağını bilsin)', () => {
    expect(irsaliyeNedenMetni('depoYok', 'tr')).toContain('Sevk Deposu');
    expect(irsaliyeNedenMetni('kdvYok', 'tr')).toContain('KDV');
    expect(irsaliyeNedenMetni('depoYok', 'en')).toContain('Warehouse');
  });

  it('musteriBagliDegil, UYGULANABİLİR adımı söyler: siparişi düzenle (CRM eşleştirmesi DEĞİL)', () => {
    expect(irsaliyeNedenMetni('musteriBagliDegil', 'tr')).toContain('düzenley');
    expect(irsaliyeNedenMetni('musteriBagliDegil', 'en')).toContain('edit the order');
    // 'cariYok' ipucu CRM eşleştirmesine yönlendirir; ikisi karışmamalı.
    expect(irsaliyeNedenMetni('cariYok', 'tr')).toContain('eşleştirin');
  });

  it('ekrana basılan metinde toUpperCase kullanılmaz (Türkçe büyük harf kuralı)', () => {
    expect(irsaliyeNedenMetni('kalemYok', 'tr')).toContain('kalem');
  });
});

describe('irsaliyeYanitMesaji — App.tsx toast mantığı', () => {
  it('sunucu mükerrer kapısı (409) HATA DEĞİL bilgi mesajıdır — mutasyon-ayırt-edici', () => {
    // 'error' basmak kullanıcıyı "gitmemiş, tekrar dene"ye iter; kapının önlemek istediği tam bu.
    const tr = irsaliyeYanitMesaji(409, { success: false, zatenGonderildi: true, irsaliyeNo: 'IRS-0042' }, 'tr');
    expect(tr.tur).toBe('info');
    expect(tr.metin).toContain('zaten kesilmiş');
    expect(tr.metin).toContain('IRS-0042');
    expect(irsaliyeYanitMesaji(409, { success: false, zatenGonderildi: true }, 'en').tur).toBe('info');
    // 409 yönlendirme metni (400'e özel "Siparişi düzenle…") EKLENMEZ.
    expect(tr.metin).not.toContain('Siparişi düzenle');
  });

  it('başarı + irsaliye no', () => {
    expect(irsaliyeYanitMesaji(200, { success: true, irsaliyeNo: 'IRS-2026-0042' }, 'tr'))
      .toEqual({ tur: 'success', metin: 'İrsaliye oluşturuldu: IRS-2026-0042' });
    expect(irsaliyeYanitMesaji(200, { success: true, irsaliyeNo: 'IRS-2026-0042' }, 'en'))
      .toEqual({ tur: 'success', metin: 'Waybill created: IRS-2026-0042' });
  });

  it('başarı ama numara dönmediyse iki nokta eklenmez', () => {
    expect(irsaliyeYanitMesaji(200, { success: true }, 'tr')).toEqual({ tur: 'success', metin: 'İrsaliye oluşturuldu' });
    expect(irsaliyeYanitMesaji(200, { success: true, irsaliyeNo: null }, 'tr').metin).toBe('İrsaliye oluşturuldu');
  });

  it('Mikro kurulu değilse SESSİZ (notConfigured) — mutasyon-ayırt-edici', () => {
    expect(irsaliyeYanitMesaji(503, { success: false, notConfigured: true }, 'tr')).toEqual({ tur: null, metin: '' });
  });

  it('Mikro REDDİ (HTTP 200 + success:false) sessiz geçilmez', () => {
    expect(irsaliyeYanitMesaji(200, { success: false, error: 'Cari kod bulunamadı' }, 'tr'))
      .toEqual({ tur: 'error', metin: 'Cari kod bulunamadı' });
  });

  it('error alanı boşsa da uyarı çıkar (eski `d.error ?? …`; boş metin toast\'u yasak)', () => {
    expect(irsaliyeYanitMesaji(200, { success: false }, 'tr').metin).toBe('Mikro irsaliyeyi reddetti');
    expect(irsaliyeYanitMesaji(200, { success: false, error: '   ' }, 'tr').metin).toBe('Mikro irsaliyeyi reddetti');
    expect(irsaliyeYanitMesaji(200, { success: false }, 'en').metin).toBe('Mikro rejected the waybill');
  });

  it('YÖNLENDİRME yalnız 400\'de (eksik alan); Mikro reddi / 500 / 403\'te yanıltıcı olurdu', () => {
    const dortYuz = irsaliyeYanitMesaji(400, { success: false, error: 'depo numarası bilinmiyor' }, 'tr');
    expect(dortYuz.tur).toBe('error');
    expect(dortYuz.metin).toContain('depo numarası bilinmiyor');
    expect(dortYuz.metin).toContain('Sevk Deposu');
    for (const kod of [200, 403, 500]) {
      expect(irsaliyeYanitMesaji(kod, { success: false, error: 'x' }, 'tr').metin).toBe('x');
    }
  });

  it('notConfigured başarı bayrağıyla birlikte gelirse başarı kazanır (eski sıra)', () => {
    expect(irsaliyeYanitMesaji(200, { success: true, notConfigured: true }, 'tr').tur).toBe('success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Başarı sonrası sipariş yaması — MÜKERRER e-İrsaliye kapısı
// Sunucu numarayı yalnız `shipments/{firebaseId}`'ye yazar; `orders.irsaliyeNo`
// istemcinin sorumluluğu. Tek çağrı yüzeyine yazmak (yalnız düğme yolu) 2026-09-19
// hakem turunda YARIM DÜZELTME olarak yakalandı: Shipped otomatiği başarılı olunca
// sipariş işaretlenmiyordu, detaydaki düğme etkin kalıyordu ve aynı sevkiyat ikinci
// kez Mikro'ya yazılabiliyordu.
// ─────────────────────────────────────────────────────────────────────────────
describe('irsaliyeSonucYamasi — başarıdan sonra siparişe ne yazılır', () => {
  it('başarısız yanıtta yama YOK (null) — hiçbir alan yazılmaz', () => {
    expect(irsaliyeSonucYamasi({ success: false, error: 'Mikro reddetti' })).toBeNull();
    expect(irsaliyeSonucYamasi({ notConfigured: true })).toBeNull();
    expect(irsaliyeSonucYamasi({})).toBeNull();
  });

  it('sunucu "zaten kesilmiş" (409) dediğinde İŞARET YAZILIR — mutasyon-ayırt-edici', () => {
    // `success` false olduğu için eski kural `null` dönerdi: sipariş işaretsiz kalır, düğme
    // etkin kalır, kullanıcı her tıklayışta aynı 409'u görür ve durum hiç onarılmaz.
    expect(irsaliyeSonucYamasi({ success: false, zatenGonderildi: true, irsaliyeNo: 'IRS-0042' }))
      .toEqual({ irsaliyeGonderildi: true, irsaliyeNo: 'IRS-0042' });
    expect(irsaliyeSonucYamasi({ success: false, zatenGonderildi: true }))
      .toEqual({ irsaliyeGonderildi: true });
  });

  it('başarı + numara + ETTN → üçü birden yazılır', () => {
    expect(irsaliyeSonucYamasi({ success: true, irsaliyeNo: 'IRS-001', irsaliyeEttn: 'a1b2-c3' })).toEqual({
      irsaliyeGonderildi: true, irsaliyeNo: 'IRS-001', irsaliyeEttn: 'a1b2-c3',
    });
  });

  it('başarı ama numara YOK → numara UYDURULMAZ, gönderildi işareti yine de yazılır (mutasyon-ayırt-edici)', () => {
    // Sunucu `md?.irsaliyeNo || … || null` döndürür: başarı + `irsaliyeNo: null` mümkün.
    // Yama null dönerse sipariş işaretsiz kalır, düğme etkin kalır ve ikinci belge kesilir.
    const y = irsaliyeSonucYamasi({ success: true, irsaliyeNo: null });
    expect(y).toEqual({ irsaliyeGonderildi: true });
    expect(y).not.toHaveProperty('irsaliyeNo');
  });

  it('boş / boşluktan ibaret numara BİLİNMİYOR sayılır, alan yazılmaz', () => {
    expect(irsaliyeSonucYamasi({ success: true, irsaliyeNo: '   ' })).toEqual({ irsaliyeGonderildi: true });
    expect(irsaliyeSonucYamasi({ success: true, irsaliyeNo: '', irsaliyeEttn: '' })).toEqual({ irsaliyeGonderildi: true });
  });

  it('sayısal/bozuk numara metne ÇEVRİLMEZ (ağdan gelen ham JSON; şema metin ister)', () => {
    // Bu kapı bilinçlidir ve KALIYOR: istemci ham JSON'a güvenmez. Sayısal numaranın SESSİZCE
    // DÜŞMESİ sorunu (2026-09-19 kapanış bulgusu) burada değil, SINIRDA çözüldü: rota numarayı
    // `src/server/mikro/belgeNo.ts belgeNoMetni` ile metne normalize ediyor (üç kaydet rotası
    // + 409 mükerrer kapısı aynı kuraldan). Yani 12345 bu modüle artık '12345' olarak gelir.
    expect(irsaliyeSonucYamasi({ success: true, irsaliyeNo: 12345 })).toEqual({ irsaliyeGonderildi: true });
    expect(irsaliyeSonucYamasi({ success: true, irsaliyeNo: 'IRS-002', irsaliyeEttn: { u: 1 } })).toEqual({
      irsaliyeGonderildi: true, irsaliyeNo: 'IRS-002',
    });
  });

  it('yamada undefined alan YOK: updateDoc PATCH-merge bunu sessizce yutar, alan da silinmez', () => {
    for (const y of [
      irsaliyeSonucYamasi({ success: true }),
      irsaliyeSonucYamasi({ success: true, irsaliyeNo: 'IRS-003' }),
    ]) {
      expect(y).not.toBeNull();
      expect(Object.values(y as unknown as Record<string, unknown>).every(v => v !== undefined)).toBe(true);
    }
  });
});
