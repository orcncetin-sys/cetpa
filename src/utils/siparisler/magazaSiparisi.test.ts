/**
 * magazaSiparisi.test.ts — çevrim içi mağaza siparişinin tanımı + Online Siparişler ekranının saf hesapları
 * (şartname online-siparis 2026-10-02 §4, v2). Kilitlenen kurallar:
 *   • ayırt edici TEK alan `source === 'shopify_webhook'` (`shopifyOrderId` elle girilen siparişte de var);
 *   • SAHTE SIFIR YOK — TRY dışı / tutarsız sipariş toplama 0 olarak girmez, SAYILIR;
 *   • süzgeç çipleri Cetpa durumunun bölüntüsü, "ödeme bekliyor" çapraz;
 *   • rozetler süzgeçle çelişmez (Cetpa'da ödendi işaretli havale, Cetpa'da ilerletilmiş durum).
 */
import { describe, it, expect } from 'vitest';
import {
  MAGAZA_KAYNAGI, MAGAZA_SUZGECLERI, magazaSiparisiMi, magazaSiparisleri, tryDisiMi, tryTutari, magazaTutari, magazaTutarMetni,
  odemeBekliyorMu, hazirlanacakMi, suzgeceUyar, suzgecSayilari, aramayaUyar, magazaListesi, magazaOzeti,
  odemeRozeti, kargoRozeti, kalemSayisi, baglantiYanitiniCoz, guncelImzaReddiMs, type MagazaSiparisAlanlari,
} from './magazaSiparisi';
import { ekranTutari } from '../para';
import type { Order } from '../../types';

const s = (ek: Partial<MagazaSiparisAlanlari> = {}): MagazaSiparisAlanlari => ({
  id: 'shopify__abc', source: MAGAZA_KAYNAGI, status: 'Pending', customerName: 'Ayşe Yılmaz',
  shopifyOrderId: '#1001', createdAt: '2026-10-02T09:15:00+03:00', orderDate: '2026-10-02',
  paraBirimi: 'TRY', totalPrice: 1250.5, shopifyRaw: { financialStatus: 'pending', fulfillmentStatus: null }, ...ek,
});

describe('magazaSiparisiMi — tek ölçüt `source`', () => {
  it("source 'shopify_webhook' → true", () => {
    expect(MAGAZA_KAYNAGI).toBe('shopify_webhook');
    expect(magazaSiparisiMi({ source: 'shopify_webhook' })).toBe(true);
  });
  it('`shopifyOrderId` TEK BAŞINA yetmez: elle girilen sipariş de o alanı yazar (SHP-…)', () => {
    expect(magazaSiparisiMi({ shopifyOrderId: 'SHP-1A2B3C4D' } as { source?: unknown })).toBe(false);
    expect(magazaSiparisiMi({ source: undefined })).toBe(false);
  });
  it("başka kaynaklar (mikro-fatura, Trendyol, testlerdeki 'shopify') mağaza siparişi DEĞİL", () => {
    for (const source of ['mikro-fatura', 'mikro-siparis', 'Trendyol', 'Hepsiburada', 'shopify', 'SHOPIFY_WEBHOOK', ''])
      expect(magazaSiparisiMi({ source }), source).toBe(false);
  });
  it('null / undefined güvenli', () => {
    expect(magazaSiparisiMi(null)).toBe(false);
    expect(magazaSiparisiMi(undefined)).toBe(false);
  });
  it('magazaSiparisleri yalnız mağaza siparişlerini, sırayı bozmadan döner', () => {
    const liste = [{ id: 'a', source: 'mikro-fatura' }, { id: 'b', source: MAGAZA_KAYNAGI }, { id: 'c' }, { id: 'd', source: MAGAZA_KAYNAGI }];
    expect(magazaSiparisleri(liste).map(o => o.id)).toEqual(['b', 'd']);
  });
  it('kanonik `Order` yapısal olarak uyar (tip dökümü gerekmez)', () => {
    const o: Order = { id: 'x', customerName: 'A', totalPrice: 10, status: 'Pending', customerType: 'Retail', source: MAGAZA_KAYNAGI,
      shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: null, cancelReason: null, cancelledAt: null, odemeYontemi: 'iyzico', vergi: 1.5, vergiDahil: true } };
    expect(magazaSiparisiMi(o)).toBe(true);
    expect(odemeBekliyorMu(o)).toBe(false);
    expect(magazaTutari(o)).toEqual({ tutar: 10, birim: 'TRY' });
  });
});

describe('tutar — sahte sıfır yok', () => {
  it('TRY sipariş: totalPrice TL tutardır', () => {
    expect(tryTutari(s())).toBe(1250.5);
    expect(magazaTutari(s())).toEqual({ tutar: 1250.5, birim: 'TRY' });
  });
  it('birim yazılmamış + totalPrice var (eski biçim) → TRY sayılır', () => {
    expect(tryDisiMi(s({ paraBirimi: undefined }))).toBe(false);
    expect(tryTutari(s({ paraBirimi: undefined, totalPrice: 80 }))).toBe(80);
  });
  it("birim kıyası büyük/küçük harf duyarsız ('try' de TRY'dir)", () => {
    expect(tryDisiMi(s({ paraBirimi: 'try' }))).toBe(false);
    expect(tryDisiMi(s({ paraBirimi: ' TRY ' }))).toBe(false);
    expect(tryDisiMi(s({ paraBirimi: 'USD' }))).toBe(true);
  });
  it('TRY dışı: TL tutarı NaN (0 DEĞİL); ekranda dovizTutar + birim', () => {
    const usd = s({ paraBirimi: 'USD', totalPrice: undefined, dovizTutar: 99.9 });
    expect(Number.isNaN(tryTutari(usd))).toBe(true);
    expect(magazaTutari(usd)).toEqual({ tutar: 99.9, birim: 'USD' });
  });
  it('TRY dışı siparişte yanlışlıkla totalPrice OLSA BİLE TL sayılmaz (USD tutarı ₺ ile toplanmaz)', () => {
    const usd = s({ paraBirimi: 'USD', totalPrice: 99.9, dovizTutar: 99.9 });
    expect(Number.isNaN(tryTutari(usd))).toBe(true);
  });
  it('tutar hiç yok / null / boş metin → NaN (0 DEĞİL)', () => {
    for (const totalPrice of [undefined, null, '', 'abc', NaN]) {
      const t = magazaTutari(s({ totalPrice }));
      expect(Number.isNaN(t.tutar), String(totalPrice)).toBe(true);
    }
    expect(Number.isNaN(magazaTutari(s({ paraBirimi: 'EUR', totalPrice: undefined, dovizTutar: null })).tutar)).toBe(true);
  });
  it('gerçek 0 tutar 0 KALIR (hediye / %100 indirim) — bilinmeyenle karışmaz', () => {
    expect(tryTutari(s({ totalPrice: 0 }))).toBe(0);
    expect(magazaTutarMetni(s({ totalPrice: 0 })).metin).toBe('₺0,00');
  });
  it("ekran metni: simgeli birimde kod AYRICA yazılır, simgesizde iki kez basılmaz, bilinmeyende '—'", () => {
    expect(magazaTutarMetni(s({ totalPrice: 1250.5 }))).toEqual({ metin: '₺1.250,50', birimEki: 'TRY' });
    const usd = magazaTutarMetni(s({ paraBirimi: 'USD', totalPrice: undefined, dovizTutar: 99.9 }));
    expect(usd.metin).toContain('$');
    expect(usd.birimEki).toBe('USD');
    const xau = magazaTutarMetni(s({ paraBirimi: 'XAU', totalPrice: undefined, dovizTutar: 2 }));
    expect(xau.metin).toContain('XAU');
    expect(xau.birimEki).toBeNull();
    expect(magazaTutarMetni(s({ totalPrice: undefined }))).toEqual({ metin: '—', birimEki: null });
    expect(magazaTutarMetni(s({ paraBirimi: 'USD', totalPrice: 50, dovizTutar: undefined }))).toEqual({ metin: '—', birimEki: null });
  });
});

describe('odemeBekliyorMu', () => {
  it('pending / authorized / partially_paid → bekliyor', () => {
    for (const financialStatus of ['pending', 'authorized', 'partially_paid'])
      expect(odemeBekliyorMu(s({ shopifyRaw: { financialStatus } })), financialStatus).toBe(true);
  });
  it('paid / partially_refunded / refunded / voided → beklemiyor (iade edilen paranın gelecek ödemesi yok)', () => {
    for (const financialStatus of ['paid', 'partially_refunded', 'refunded', 'voided'])
      expect(odemeBekliyorMu(s({ shopifyRaw: { financialStatus } })), financialStatus).toBe(false);
  });
  it("Cetpa'da ödendi işaretli (paid:true) havale siparişi: mağaza 'pending' dese de BEKLEMİYOR", () => {
    expect(odemeBekliyorMu(s({ paid: true, shopifyRaw: { financialStatus: 'pending' } }))).toBe(false);
  });
  it('iptal edilen sipariş ödeme beklemez', () => {
    expect(odemeBekliyorMu(s({ status: 'Cancelled' }))).toBe(false);
  });
  it('mağaza durumu yok: yalnız AÇIKÇA paid:false bekliyor; paid de yoksa BİLİNMİYOR → bekliyor denmez', () => {
    expect(odemeBekliyorMu(s({ shopifyRaw: undefined, paid: false }))).toBe(true);
    expect(odemeBekliyorMu(s({ shopifyRaw: undefined, paid: undefined }))).toBe(false);
    expect(odemeBekliyorMu(s({ shopifyRaw: { financialStatus: null }, paid: undefined }))).toBe(false);
    expect(odemeBekliyorMu(s({ shopifyRaw: null, paid: undefined }))).toBe(false);
  });
  it('bilinmeyen mağaza durumu (yeni Shopify değeri) → bekliyor UYDURULMAZ', () => {
    expect(odemeBekliyorMu(s({ shopifyRaw: { financialStatus: 'chargeback' }, paid: false }))).toBe(false);
  });
});

describe('süzgeç çipleri', () => {
  const liste = [
    s({ id: '1', status: 'Pending', shopifyRaw: { financialStatus: 'pending', fulfillmentStatus: null } }),
    s({ id: '2', status: 'Processing', paid: true, shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: null } }),
    s({ id: '3', status: 'Shipped', paid: true, shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: 'fulfilled' } }),
    s({ id: '4', status: 'Delivered', paid: true, shopifyRaw: { financialStatus: 'paid', fulfillmentStatus: 'fulfilled' } }),
    s({ id: '5', status: 'Cancelled', shopifyRaw: { financialStatus: 'voided', fulfillmentStatus: null } }),
    s({ id: '6', status: 'Shipped', shopifyRaw: { financialStatus: 'pending', fulfillmentStatus: 'fulfilled' } }),   // kapıda ödeme, kargoda
  ];
  const idler = (k: Parameters<typeof suzgeceUyar>[1]) => liste.filter(o => suzgeceUyar(o, k)).map(o => o.id);

  it('altı çip, sırası sabit', () => {
    expect([...MAGAZA_SUZGECLERI]).toEqual(['tumu', 'odeme-bekliyor', 'hazirlanacak', 'kargoda', 'teslim-edildi', 'iptal']);
  });
  it('her çip doğru kümeyi verir', () => {
    expect(idler('tumu')).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(idler('odeme-bekliyor')).toEqual(['1', '6']);
    expect(idler('hazirlanacak')).toEqual(['1', '2']);
    expect(idler('kargoda')).toEqual(['3', '6']);
    expect(idler('teslim-edildi')).toEqual(['4']);
    expect(idler('iptal')).toEqual(['5']);
  });
  it('dört ilerleme çipi Cetpa durumunun BÖLÜNTÜSÜ: her sipariş tam birinde', () => {
    for (const o of liste) {
      const n = (['hazirlanacak', 'kargoda', 'teslim-edildi', 'iptal'] as const).filter(k => suzgeceUyar(o, k)).length;
      expect(n, o.id).toBe(1);
    }
  });
  it('hazırlanacak = henüz kargoya verilmemiş; ödeme bekleyen (kapıda ödeme) DÂHİL', () => {
    expect(hazirlanacakMi(liste[0])).toBe(true);
    expect(hazirlanacakMi(liste[2])).toBe(false);
    expect(hazirlanacakMi(liste[4])).toBe(false);
  });
  it('suzgecSayilari çiplerin yanındaki sayıları verir', () => {
    expect(suzgecSayilari(liste)).toEqual({ 'tumu': 6, 'odeme-bekliyor': 2, 'hazirlanacak': 2, 'kargoda': 2, 'teslim-edildi': 1, 'iptal': 1 });
    expect(suzgecSayilari([])).toEqual({ 'tumu': 0, 'odeme-bekliyor': 0, 'hazirlanacak': 0, 'kargoda': 0, 'teslim-edildi': 0, 'iptal': 0 });
  });
});

describe('arama — sipariş no, müşteri, e-posta, telefon (Türkçe-duyarlı)', () => {
  const o = s({ shopifyOrderId: '#1042', customerName: 'IŞIK İnşaat Şişli', customerEmail: 'Satinalma@isik.com.tr', customerPhone: '+90 532 123 45 67' });
  it('boş / boşluklu sorgu her kaydı geçirir', () => {
    expect(aramayaUyar(o, '')).toBe(true);
    expect(aramayaUyar(o, '   ')).toBe(true);
  });
  it('sipariş no (kareli ve karesiz)', () => {
    expect(aramayaUyar(o, '#1042')).toBe(true);
    expect(aramayaUyar(o, '1042')).toBe(true);
    expect(aramayaUyar(o, '9999')).toBe(false);
  });
  it("Türkçe büyük/küçük harf: 'ışık' → 'IŞIK', 'işik' / 'isik' / 'sisli' de bulur; 'İNŞAAT' küçük yazımla", () => {
    expect(aramayaUyar(o, 'ışık')).toBe(true);
    expect(aramayaUyar(o, 'isik')).toBe(true);
    expect(aramayaUyar(o, 'sisli')).toBe(true);
    expect(aramayaUyar(o, 'inşaat')).toBe(true);
    expect(aramayaUyar(o, 'İNŞAAT')).toBe(true);
  });
  it('e-posta büyük/küçük harf duyarsız', () => {
    expect(aramayaUyar(o, 'satinalma@isik')).toBe(true);
  });
  it('telefon: boşluklu, başında 0 ya da +90 ile, yalnız rakamla', () => {
    expect(aramayaUyar(o, '532 123')).toBe(true);
    expect(aramayaUyar(o, '0532 123 45')).toBe(true);
    expect(aramayaUyar(o, '+90 (532) 123')).toBe(true);
    expect(aramayaUyar(o, '5321234567')).toBe(true);
    expect(aramayaUyar(o, '555 000')).toBe(false);
  });
  it('rakam-dizisi kıyası en az 3 rakam ister: boşlukları aşan iki rakamlık sorgu eşleşmez (gürültü)', () => {
    // "+90 532 123 45 67" metninde "21" geçmez; rakam dizisinde ("…5321234…") geçer ama 2 rakam yetmez.
    expect(aramayaUyar(s({ shopifyOrderId: '#7', customerPhone: '+90 532 123 45 67' }), '21')).toBe(false);
    expect(aramayaUyar(s({ shopifyOrderId: '#7', customerPhone: '+90 532 123 45 67' }), '212')).toBe(true);
  });
  it('alanlar yokken patlamaz', () => {
    expect(aramayaUyar({ id: 'x' }, 'ayşe')).toBe(false);
  });
});

describe('magazaListesi — süzgeç + arama + en yeni üstte', () => {
  const liste = [
    s({ id: 'eski', shopifyOrderId: '#1', createdAt: '2026-09-01T10:00:00+03:00' }),
    s({ id: 'yeni', shopifyOrderId: '#3', createdAt: '2026-10-02T08:00:00+03:00' }),
    s({ id: 'orta', shopifyOrderId: '#2', createdAt: '2026-09-15T10:00:00+03:00', status: 'Shipped' }),
    s({ id: 'tarihsiz', shopifyOrderId: '#4', createdAt: undefined, orderDate: undefined }),
  ];
  it('en yeni üstte; tarihi çözülemeyen EN SONDA (bugüne çekilmez)', () => {
    expect(magazaListesi(liste, 'tumu', '').map(o => o.id)).toEqual(['yeni', 'orta', 'eski', 'tarihsiz']);
  });
  it('süzgeç ve arama birlikte uygulanır', () => {
    expect(magazaListesi(liste, 'kargoda', '').map(o => o.id)).toEqual(['orta']);
    expect(magazaListesi(liste, 'hazirlanacak', '#3').map(o => o.id)).toEqual(['yeni']);
    expect(magazaListesi(liste, 'kargoda', '#3')).toEqual([]);
  });
  it('girdi dizisini DEĞİŞTİRMEZ', () => {
    const once = liste.map(o => o.id);
    magazaListesi(liste, 'tumu', '');
    expect(liste.map(o => o.id)).toEqual(once);
  });
});

describe('magazaOzeti — özet kutuları', () => {
  const simdi = new Date(2026, 9, 2, 14, 0, 0);   // 2 Ekim 2026, yerel
  const bugun = new Date(2026, 9, 2, 9, 0, 0);
  const dun = new Date(2026, 9, 1, 23, 30, 0);

  it('boş liste: hepsi gerçek 0, toplam 0 (bilinmeyen yok)', () => {
    const z = magazaOzeti([], simdi);
    expect(z).toMatchObject({ siparis: 0, bugun: 0, odemeBekleyen: 0, hazirlanacak: 0, hazirlanacakOdemeBekleyen: 0, kargoda: 0, tryDisi: 0, tutarsiz: 0 });
    expect(z.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 0 });
    expect(ekranTutari(z.tutar)).toBe(0);
  });
  it('bugün: yerel gün; iptal edilen ve tarihi çözülemeyen SAYILMAZ', () => {
    const z = magazaOzeti([
      s({ id: 'a', createdAt: bugun }),
      s({ id: 'b', createdAt: dun }),
      s({ id: 'c', createdAt: bugun, status: 'Cancelled' }),
      s({ id: 'd', createdAt: undefined, orderDate: undefined }),
    ], simdi);
    expect(z.siparis).toBe(4);
    expect(z.bugun).toBe(1);
  });
  it('ödeme bekleyen / hazırlanacak / kargoda sayıları; hazırlanacak içindeki ödeme bekleyen ayrıca', () => {
    const z = magazaOzeti([
      s({ id: '1', status: 'Pending', shopifyRaw: { financialStatus: 'pending' } }),
      s({ id: '2', status: 'Processing', paid: true, shopifyRaw: { financialStatus: 'paid' } }),
      s({ id: '3', status: 'Shipped', shopifyRaw: { financialStatus: 'pending' } }),
      s({ id: '4', status: 'Delivered', paid: true, shopifyRaw: { financialStatus: 'paid' } }),
      s({ id: '5', status: 'Cancelled', shopifyRaw: { financialStatus: 'pending' } }),
    ], simdi);
    expect(z).toMatchObject({ odemeBekleyen: 2, hazirlanacak: 2, hazirlanacakOdemeBekleyen: 1, kargoda: 1 });
  });
  it('TOPLAM: iptal hariç, yalnız TL; TRY dışı ve tutarsız sipariş toplama GİRMEZ ama SAYILIR (sahte sıfır yok)', () => {
    const z = magazaOzeti([
      s({ id: 'try1', totalPrice: 1000 }),
      s({ id: 'try2', totalPrice: 250.5 }),
      s({ id: 'usd', paraBirimi: 'USD', totalPrice: undefined, dovizTutar: 40 }),
      s({ id: 'yok', totalPrice: undefined }),
      s({ id: 'iptal', totalPrice: 9999, status: 'Cancelled' }),
    ], simdi);
    expect(z.tutar).toEqual({ toplam: 1250.5, bilinen: 2, bilinmeyen: 2 });
    expect(z.tryDisi).toBe(1);
    expect(z.tutarsiz).toBe(1);
    expect(z.tryDisi + z.tutarsiz).toBe(z.tutar.bilinmeyen);
  });
  it("hiçbir siparişin TL tutarı bilinmiyorsa ekran tutarı NaN ('—' basılır) — ₺0 DEĞİL", () => {
    const z = magazaOzeti([s({ paraBirimi: 'EUR', totalPrice: undefined, dovizTutar: 10 })], simdi);
    expect(z.tutar).toEqual({ toplam: 0, bilinen: 0, bilinmeyen: 1 });
    expect(Number.isNaN(ekranTutari(z.tutar))).toBe(true);
  });
  it('iptal edilen TRY dışı sipariş "toplama girmeyen" notuna da girmez (zaten satış değil)', () => {
    const z = magazaOzeti([s({ paraBirimi: 'USD', totalPrice: undefined, dovizTutar: 5, status: 'Cancelled' })], simdi);
    expect(z.tutar.bilinmeyen).toBe(0);
    expect(z.tryDisi).toBe(0);
  });
});

describe('odemeRozeti', () => {
  it('mağaza durumu → etiket + ton', () => {
    expect(odemeRozeti(s({ shopifyRaw: { financialStatus: 'paid' }, paid: true }), 'tr')).toEqual({ metin: 'Ödendi', ton: 'yesil', magazadaki: null });
    expect(odemeRozeti(s({ shopifyRaw: { financialStatus: 'pending' }, paid: false }), 'tr')).toEqual({ metin: 'Ödeme bekliyor', ton: 'sari', magazadaki: null });
    expect(odemeRozeti(s({ shopifyRaw: { financialStatus: 'refunded' }, paid: false }), 'tr')).toEqual({ metin: 'İade edildi', ton: 'gri', magazadaki: null });
    expect(odemeRozeti(s({ shopifyRaw: { financialStatus: 'partially_paid' } }), 'en').metin).toBe('Partially paid');
  });
  it("Cetpa'da ödendi işaretli + mağaza hâlâ bekliyor → rozet 'Ödendi', mağazadaki durum ipucunda (süzgeçle çelişmez)", () => {
    const o = s({ paid: true, shopifyRaw: { financialStatus: 'pending' } });
    expect(odemeRozeti(o, 'tr')).toEqual({ metin: 'Ödendi', ton: 'yesil', magazadaki: 'Ödeme bekliyor' });
    expect(odemeBekliyorMu(o)).toBe(false);
  });
  it('paid:true ama mağaza iade etti → mağazanın etiketi korunur (tek yönlü `paid` iadeyi gizlemesin)', () => {
    expect(odemeRozeti(s({ paid: true, shopifyRaw: { financialStatus: 'refunded' } }), 'tr').metin).toBe('İade edildi');
    expect(odemeRozeti(s({ paid: true, shopifyRaw: { financialStatus: 'partially_refunded' } }), 'tr').metin).toBe('Kısmen iade edildi');
  });
  it("mağaza durumu yok: paid:true → 'Ödendi'; paid:false → 'Ödeme bekliyor'; ikisi de yok → '—'", () => {
    expect(odemeRozeti(s({ shopifyRaw: undefined, paid: true }), 'tr')).toEqual({ metin: 'Ödendi', ton: 'yesil', magazadaki: null });
    expect(odemeRozeti(s({ shopifyRaw: undefined, paid: false }), 'tr').metin).toBe('Ödeme bekliyor');
    expect(odemeRozeti(s({ shopifyRaw: undefined, paid: undefined }), 'tr')).toEqual({ metin: '—', ton: 'gri', magazadaki: null });
  });
  it('bilinmeyen mağaza değeri HAM basılır, gri', () => {
    expect(odemeRozeti(s({ shopifyRaw: { financialStatus: 'chargeback' } }), 'tr')).toEqual({ metin: 'chargeback', ton: 'gri', magazadaki: null });
  });
});

describe('kargoRozeti', () => {
  it("hazırlanmamış sipariş: mağaza null → 'Hazırlanmadı' (sarı)", () => {
    expect(kargoRozeti(s({ status: 'Pending', shopifyRaw: { fulfillmentStatus: null } }), 'tr')).toEqual({ metin: 'Hazırlanmadı', ton: 'sari', magazadaki: null });
  });
  it("kısmi gönderim (durum Hazırlanıyor) → 'Kısmen gönderildi'", () => {
    expect(kargoRozeti(s({ status: 'Processing', shopifyRaw: { fulfillmentStatus: 'partial' } }), 'tr')).toEqual({ metin: 'Kısmen gönderildi', ton: 'mavi', magazadaki: null });
  });
  it("Cetpa durumu ilerlemişse O gösterilir: 'Kargoda' çipinin altında 'Hazırlanmadı' rozeti OLMAZ", () => {
    expect(kargoRozeti(s({ status: 'Shipped', shopifyRaw: { fulfillmentStatus: null } }), 'tr')).toEqual({ metin: 'Kargoda', ton: 'mavi', magazadaki: 'Hazırlanmadı' });
    expect(kargoRozeti(s({ status: 'Delivered', shopifyRaw: { fulfillmentStatus: 'fulfilled' } }), 'tr')).toEqual({ metin: 'Teslim Edildi', ton: 'yesil', magazadaki: 'Gönderildi' });
  });
  it('iptal → kırmızı', () => {
    expect(kargoRozeti(s({ status: 'Cancelled', shopifyRaw: { fulfillmentStatus: null } }), 'tr')).toMatchObject({ metin: 'İptal Edildi', ton: 'kirmizi' });
  });
  it('shopifyRaw HİÇ yok (ya da alan yazılmamış): mağaza durumu bilinmiyor → Cetpa durumu, "Hazırlanmadı" UYDURULMAZ', () => {
    expect(kargoRozeti(s({ status: 'Pending', shopifyRaw: undefined }), 'tr')).toEqual({ metin: 'Bekliyor', ton: 'gri', magazadaki: null });
    expect(kargoRozeti(s({ status: 'Processing', shopifyRaw: { financialStatus: 'paid' } }), 'tr')).toEqual({ metin: 'Hazırlanıyor', ton: 'gri', magazadaki: null });
    expect(kargoRozeti(s({ status: 'Processing', shopifyRaw: null }), 'tr').metin).toBe('Hazırlanıyor');
  });
  it('bilinmeyen mağaza değeri HAM, gri', () => {
    expect(kargoRozeti(s({ status: 'Pending', shopifyRaw: { fulfillmentStatus: 'on_hold' } }), 'tr')).toEqual({ metin: 'on_hold', ton: 'gri', magazadaki: null });
  });
  it('EN: mağaza etiketi çevrilir', () => {
    expect(kargoRozeti(s({ status: 'Pending', shopifyRaw: { fulfillmentStatus: null } }), 'en').metin).toBe('Unfulfilled');
  });
});

describe('kalemSayisi', () => {
  it('dizi uzunluğu; dizi yoksa null ("0 kalem" uydurulmaz); boş dizi gerçek 0', () => {
    expect(kalemSayisi(s({ lineItems: [{}, {}, {}] }))).toBe(3);
    expect(kalemSayisi(s({ lineItems: [] }))).toBe(0);
    expect(kalemSayisi(s({ lineItems: undefined }))).toBeNull();
    expect(kalemSayisi(s({ lineItems: null }))).toBeNull();
  });
});

describe('baglantiYanitiniCoz — GET /api/shopify/baglanti', () => {
  const tam = {
    success: true, configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true,
    webhookAdresi: 'https://app.cetpa.com.tr/api/shopify/webhook', webhookYolu: '/api/shopify/webhook',
    durum: { sonBildirim: '2026-10-02T09:15:00.000Z', sonTopic: 'orders/create', sonSiparisNo: '#1001', sonSonuc: 'yazildi', sonHata: null, sonHataZamani: null, sonApiSurumu: '2025-07', toplamBildirim: 12, sonImzaReddi: '2026-10-07T09:00:00.000Z' },
  };
  it('tam yanıt alan alan çözülür (`sonImzaReddi` dâhil)', () => {
    expect(baglantiYanitiniCoz(tam)).toEqual({
      configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true,
      webhookAdresi: 'https://app.cetpa.com.tr/api/shopify/webhook',
      durum: { sonBildirim: '2026-10-02T09:15:00.000Z', sonTopic: 'orders/create', sonSiparisNo: '#1001', sonSonuc: 'yazildi', sonHata: null, sonHataZamani: null, sonApiSurumu: '2025-07', toplamBildirim: 12, sonImzaReddi: '2026-10-07T09:00:00.000Z' },
    });
  });
  it('`sonImzaReddi`: yalnız ret yazılmış durumda da taşınır; alan yoksa / metin değilse / boşsa null', () => {
    // Yanlış sırda sunucunun yazdığı durum: hiç doğrulanmış bildirim yok, yalnız ret zamanı.
    expect(baglantiYanitiniCoz({ ...tam, durum: { sonImzaReddi: '2026-10-07T09:00:00.000Z' } })?.durum)
      .toMatchObject({ sonImzaReddi: '2026-10-07T09:00:00.000Z', sonBildirim: null, toplamBildirim: null });
    const { sonImzaReddi: _ret, ...retsiz } = tam.durum;
    expect(baglantiYanitiniCoz({ ...tam, durum: retsiz })?.durum?.sonImzaReddi).toBeNull();
    for (const deger of [null, 1759827600000, '', '   ', {}]) expect(baglantiYanitiniCoz({ ...tam, durum: { ...tam.durum, sonImzaReddi: deger } })?.durum?.sonImzaReddi).toBeNull();
  });
  it('bağlantı kurulmamış: configured false, durum null', () => {
    expect(baglantiYanitiniCoz({ success: true, configured: false, shopDomain: null, webhookSirriKayitli: false, webhookAdresi: null, webhookYolu: '/api/shopify/webhook', durum: null }))
      .toEqual({ configured: false, shopDomain: null, webhookSirriKayitli: false, webhookAdresi: null, durum: null });
  });
  it('beklenmeyen gövde → null (şerit gizlenir; yarım yanıttan "bağlı değil" ÇIKARILMAZ)', () => {
    for (const g of [null, undefined, 'ok', 42, [], {}, { success: false, error: 'Yetkisiz' }, { success: true }, { success: true, configured: 'evet' }, { configured: true }])
      expect(baglantiYanitiniCoz(g), JSON.stringify(g)).toBeNull();
  });
  it('toplamBildirim sayı değilse null (0 UYDURULMAZ)', () => {
    expect(baglantiYanitiniCoz({ ...tam, durum: { ...tam.durum, toplamBildirim: undefined } })?.durum?.toplamBildirim).toBeNull();
    expect(baglantiYanitiniCoz({ ...tam, durum: { ...tam.durum, toplamBildirim: '12' } })?.durum?.toplamBildirim).toBeNull();
    expect(baglantiYanitiniCoz({ ...tam, durum: { ...tam.durum, toplamBildirim: 0 } })?.durum?.toplamBildirim).toBe(0);
  });
  it('durum alanları SABİT liste — yanıttaki fazladan alan (iç alan, sır) duruma girmez', () => {
    const c = baglantiYanitiniCoz({ ...tam, durum: { ...tam.durum, sonHataOlay: 'shopify__abc', baglantiSurumu: 'surum-a', webhookSecret: 'gizli' } });
    expect(Object.keys(c?.durum ?? {}).sort()).toEqual([
      'sonApiSurumu', 'sonBildirim', 'sonHata', 'sonHataZamani', 'sonImzaReddi', 'sonSiparisNo', 'sonSonuc', 'sonTopic', 'toplamBildirim',
    ]);
  });
  it('sır alanı yanıtta olsa bile ÇÖZÜLEN nesneye TAŞINMAZ (istemci durumunda sır tutulmaz)', () => {
    const c = baglantiYanitiniCoz({ ...tam, webhookSecret: 'gizli', tuz: 'x' });
    expect(JSON.stringify(c)).not.toContain('gizli');
    expect(c && Object.keys(c).sort()).toEqual(['configured', 'durum', 'shopDomain', 'webhookAdresi', 'webhookSirriKayitli']);
  });
});

describe('guncelImzaReddiMs — kart ile şeridin ORTAK kuralı', () => {
  const RET = Date.parse('2026-10-07T09:00:00.000Z');
  it('ret yok → null (son bildirim olsa da olmasa da)', () => {
    expect(guncelImzaReddiMs(null, null)).toBeNull();
    expect(guncelImzaReddiMs(null, RET)).toBeNull();
  });
  it('ret, son KABUL edilen bildirimden ESKİ ya da aynı anda → null (bağlantı sonradan düzelmiş; eski ret uyarı olarak kalmaz)', () => {
    expect(guncelImzaReddiMs(RET, RET + 1)).toBeNull();
    expect(guncelImzaReddiMs(RET, RET)).toBeNull();
  });
  it('ret, son bildirimden YENİ ya da hiç bildirim yok → ret zamanı', () => {
    expect(guncelImzaReddiMs(RET, RET - 1)).toBe(RET);
    expect(guncelImzaReddiMs(RET, null)).toBe(RET);
    // Epoch 0 gerçek bir zamandır — «yok» sayılmaz (doğruluk değeri sınaması yapılmaz).
    expect(guncelImzaReddiMs(RET, 0)).toBe(RET);
    expect(guncelImzaReddiMs(0, null)).toBe(0);
  });
});
