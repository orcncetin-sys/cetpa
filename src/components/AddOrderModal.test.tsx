/**
 * AddOrderModal.test.tsx — "Yeni Sipariş Oluştur" penceresi, GERÇEKTEN çizilerek (2026-10-02 kullanıcı bildirimi:
 * «sipariş ekranında UI hatası, yabancı dil hatası, kur hatası ve fiyat bağlantı hatası var»).
 * Ekran görüntüsündeki durum: her ürün "$0.00", "Stock: 60", "LOW STOCK", taşan anahtar.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AddOrderModal from './AddOrderModal';
import type { InventoryItem, Lead, Order, OrderLineItem } from '../types';
import type { SiparisTutarlari } from '../utils/siparisler/siparisKalemFiyati';
import { siparisGovdesi } from '../server/mikro/govdeSiparis';
import { faturaGovdesi } from '../server/mikro/govdeFaturaIrsaliye';
import { kurusaYuvarla } from '../utils/para';
import { translations } from '../translations';

vi.mock('./BarcodeScanner', () => ({ default: () => null }));

const kart = (ek: Record<string, unknown>): InventoryItem =>
  ({ id: String(ek.sku), name: 'ÜRÜN', sku: 'X', stockLevel: 60, lowStockThreshold: 5, prices: {}, ...ek } as unknown as InventoryItem);
const ENVANTER: InventoryItem[] = [
  kart({ sku: 'AKCALI-AKÇ.00325', name: 'AKÇALI SPREY KAHVE 400 ML', prices: { Retail: 120, Dealer: 95 }, price: 120, vatRate: 20 }),
  kart({ sku: 'AKCALI-AKÇ.00359', name: 'AKÇALI SPREY METALİK SİYAH 400 ML', stockLevel: 0 }),               // fiyat YOK, stok yok
  kart({ sku: 'DOVIZ-1', name: 'İTHAL BOYA', prices: { Retail: 12.5 }, priceCurrency: 'USD', stockLevel: 3 }), // dövizli, düşük stok
];
const BAYI = { id: 'l1', name: 'Şirin Yapı', company: 'Şirin Yapı Ltd.', email: 'a@b.c', address: 'Antalya / Kepez', priceTier: 'Dealer', customerType: 'B2B', eFaturaKayitli: true } as unknown as Lead;

function ciz(ek: Partial<React.ComponentProps<typeof AddOrderModal>> = {}) {
  const onSubmit = vi.fn<(o: Partial<Order>, k: OrderLineItem[], t: SiparisTutarlari) => Promise<void>>(async () => undefined);
  const onClose = vi.fn();
  const oge = (ek2: Partial<React.ComponentProps<typeof AddOrderModal>>) => (
    <AddOrderModal
      isOpen onClose={onClose} selectedLead={null} setSelectedLead={vi.fn()} leads={[BAYI]} inventory={ENVANTER} warehouses={[]}
      branchNames={[]} currentLanguage="tr" currentT={translations.tr as unknown as Record<string, string>} kurlar={{ USD: 40 }}
      onSubmit={onSubmit} onAddLeadClick={vi.fn()} onGoToInventory={vi.fn()} {...ek} {...ek2}
    />
  );
  const utils = render(oge({}));
  /** Aynı pencereyi yeni prop'larla yeniden çizer (müşteri seçildi, kur değişti…) — durum korunur. */
  const yeniden = (ek2: Partial<React.ComponentProps<typeof AddOrderModal>>) => utils.rerender(oge(ek2));
  return { ...utils, onSubmit, onClose, yeniden };
}
const fiyatKutulari = () => (screen.getAllByLabelText('Birim fiyat') as HTMLInputElement[]).map(k => k.value);
const adresKutusu = () => screen.getByPlaceholderText(translations.tr.city_district) as HTMLInputElement;
const PERAKENDE = { id: 'l2', name: 'Kaya İnşaat', company: 'Kaya İnşaat', email: 'k@k.k', customerType: 'B2C' } as unknown as Lead;   // adresi YOK
const urunListesiniAc = () => fireEvent.click(screen.getByText(translations.tr.add_product));
const urunEkle = (ad: string) => { urunListesiniAc(); fireEvent.click(screen.getByText(ad)); };
const kaydet = () => fireEvent.submit(document.querySelector('form') as HTMLFormElement);
const musteriYaz = (ad: string) => fireEvent.change(screen.getByPlaceholderText('Müşteri ara veya yaz...'), { target: { value: ad } });
const faturasizYap = () => fireEvent.click(screen.getByRole('switch'));

beforeEach(() => { vi.clearAllMocks(); });

describe('dil ve para birimi', () => {
  it('Türkçe arayüzde İngilizce kalıntı ve "$" yok; tutarlar ₺ ile', () => {
    const { container } = ciz();
    urunListesiniAc();
    const metin = container.textContent ?? '';
    expect(metin).not.toMatch(/\$/);
    expect(metin).not.toMatch(/Stock:|Low Stock|LOW STOCK|Shopify/);
    expect(metin).toContain('Stok: 60');
    expect(metin).toContain('₺120,00');
    fireEvent.click(screen.getByText('AKÇALI SPREY KAHVE 400 ML'));   // liste zaten açık ("Ürün Ekle" aç / kapa düğmesidir)
    const yeni = container.textContent ?? '';
    expect(yeni).not.toMatch(/\$|\bProduct\b|\bPrice\b|\bQty\b/);
    for (const baslik of ['ÜRÜN', 'BİRİM FİYAT (₺)', 'MİKTAR', 'TUTAR']) expect(yeni).toContain(baslik);
  });
  it('stok rozetleri Türkçe: stokta yok / düşük stok', () => {
    ciz(); urunListesiniAc();
    expect(screen.getByText('Stokta yok')).toBeTruthy();
    expect(screen.getByText('Düşük stok')).toBeTruthy();
  });
  it('ürün araması Türkçe harfe duyarlı: "siyah" → "SİYAH"', () => {
    ciz(); urunListesiniAc();
    fireEvent.change(screen.getByPlaceholderText(translations.tr.search_products), { target: { value: 'metalik siyah' } });
    expect(screen.getByText('AKÇALI SPREY METALİK SİYAH 400 ML')).toBeTruthy();
    expect(screen.queryByText('AKÇALI SPREY KAHVE 400 ML')).toBeNull();
  });
});

describe('fiyat bağlantısı', () => {
  it('fiyatı bilinmeyen kart "Fiyat yok" der (0,00 değil); dövizli kart kurla TL\'ye çevrilir', () => {
    ciz(); urunListesiniAc();
    expect(screen.getByText('Fiyat yok')).toBeTruthy();
    expect(screen.getByText('₺500,00')).toBeTruthy();          // 12,5 USD × 40
  });
  it('kur yokken dövizli kartın fiyatı TL gibi basılmaz', () => {
    ciz({ kurlar: {} }); urunListesiniAc();
    expect(screen.getByText('Kur yok — fiyat çevrilemedi')).toBeTruthy();
    expect(screen.queryByText('₺12,50')).toBeNull();
  });
  it('müşterinin fiyat kademesi kullanılır (bayi → 95, perakende → 120)', () => {
    ciz({ selectedLead: BAYI }); urunListesiniAc();
    expect(screen.getByText('₺95,00')).toBeTruthy();
    expect(screen.getByText('Fiyat kademesi: Bayi')).toBeTruthy();      // kademe ADI veridir, etiketi Türkçe
  });
  it('fiyatsız kalem BOŞ fiyat kutusuyla eklenir ve fiyat girilmeden sipariş KAYDEDİLMEZ', async () => {
    const { onSubmit } = ciz();
    faturasizYap(); musteriYaz('Deneme Müşteri');
    urunEkle('AKÇALI SPREY METALİK SİYAH 400 ML');
    const kutu = screen.getByLabelText('Birim fiyat') as HTMLInputElement;
    expect(kutu.value).toBe('');
    kaydet();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Fiyatı girilmemiş kalem var/);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(kutu, { target: { value: '0' } });        // 0 da fiyat değildir
    kaydet();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(kutu, { target: { value: '87,5' } });
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(siparis).toMatchObject({ customerName: 'Deneme Müşteri', faturali: false });
    expect(siparis).not.toHaveProperty('fiyatGirisi');         // faturasızda KDV yok — giriş birimi yazılmaz
    expect(kalemler).toHaveLength(1);
    expect(kalemler[0]).toMatchObject({ price: 87.5, quantity: 1, sku: 'AKCALI-AKÇ.00359' });
    expect(kalemler[0]).not.toHaveProperty('fiyatElle');       // pencereye özel bayraklar kayda girmez
    expect(kalemler[0]).not.toHaveProperty('fiyatBirimi');
    expect(tutarlar).toEqual({ matrah: 87.5, kdv: 0, toplam: 87.5 });
  });
});

describe('kayıt kapıları ve mantık', () => {
  it('kalemsiz ya da müşterisiz sipariş kaydedilmez', async () => {
    const { onSubmit } = ciz();
    faturasizYap();
    kaydet();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Müşteri seçin/);
    musteriYaz('Deneme'); kaydet();
    expect(await screen.findByRole('alert')).toHaveTextContent(/en az bir ürün/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('"Faturasız" seçimi ürün eklenince sessizce "faturalı"ya DÖNMEZ', async () => {
    const { onSubmit } = ciz();
    faturasizYap(); musteriYaz('Deneme');
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].faturali).toBe(false);
  });
  it('tek "faturalı" anahtarı var ve topu raya çapalı (left) — taşmaz', () => {
    ciz();
    const anahtarlar = screen.getAllByRole('switch');
    expect(anahtarlar).toHaveLength(1);
    const top = anahtarlar[0].querySelector('span') as HTMLElement;
    expect(top.className).toContain('left-0.5');
    expect(top.className).toContain('translate-x-5');
    faturasizYap();
    expect((screen.getByRole('switch').querySelector('span') as HTMLElement).className).toContain('translate-x-0');
    expect(screen.queryByText('Fatura ve KDV')).toBeNull();     // faturasızda fatura / KDV bloğu yok
  });
  it('arama kutusunda Enter formu göndermez', () => {
    const { onSubmit } = ciz(); urunListesiniAc();
    const kutu = screen.getByPlaceholderText(translations.tr.search_products);
    const olay = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    kutu.dispatchEvent(olay);
    expect(olay.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('kayıt başarısızsa pencere AÇIK kalır ve nedeni gösterir (hata yutulmaz)', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('Bu kayıt başka bir firmaya ait.'); });
    const { onClose } = ciz({ onSubmit });
    faturasizYap(); musteriYaz('Deneme'); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    kaydet();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sipariş kaydedilemedi: Bu kayıt başka bir firmaya ait.');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('müşteri kutusu tam genişlik; seçili müşteri "Değiştir" ile bırakılabilir', () => {
    const setSelectedLead = vi.fn();
    const { rerender } = ciz();
    expect((screen.getByPlaceholderText('Müşteri ara veya yaz...') as HTMLElement).className).toContain('w-full');
    rerender(
      <AddOrderModal isOpen onClose={vi.fn()} selectedLead={BAYI} setSelectedLead={setSelectedLead} leads={[BAYI]} inventory={ENVANTER} warehouses={[]}
        branchNames={[]} currentLanguage="tr" currentT={translations.tr as unknown as Record<string, string>} kurlar={{ USD: 40 }}
        onSubmit={vi.fn(async () => undefined)} onAddLeadClick={vi.fn()} onGoToInventory={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Değiştir'));
    expect(setSelectedLead).toHaveBeenCalledWith(null);
  });
  it('"Siparişi kopyala" tohumu: pencere kalemlerle dolu açılır; fiyatsız (Mikro türevi) kalemin birimi tutar / miktardan', () => {
    ciz({ tohum: { order: { customerName: 'Şirin Yapı', faturali: false }, kalemler: [
      { id: 'k1', sku: 'S1', name: 'A', title: 'A', quantity: 4, total: 480 } as unknown as OrderLineItem,
      { id: 'k2', sku: 'S2', name: 'B', title: 'B', quantity: 1, price: 50 } as OrderLineItem,
    ] } });
    const kutular = screen.getAllByLabelText('Birim fiyat') as HTMLInputElement[];
    expect(kutular.map(k => k.value)).toEqual(['120', '50']);
    expect(screen.queryByText(/Okunamadı/)).toBeNull();
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('₺530,00')).toBeTruthy();
  });
});

describe('yeniden fiyatlama (müşteri / kur sonradan değişir)', () => {
  it('önce ürün sonra bayi seçilirse kalem bayi fiyatına çekilir (perakendede kalmaz)', () => {
    const { yeniden } = ciz();
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    expect(fiyatKutulari()).toEqual(['120']);
    yeniden({ selectedLead: BAYI });
    expect(fiyatKutulari()).toEqual(['95']);
  });
  it('ELLE yazılan fiyat müşteri değişince ezilmez', () => {
    const { yeniden } = ciz();
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '111' } });
    fireEvent.blur(screen.getByLabelText('Birim fiyat'));
    yeniden({ selectedLead: BAYI });
    expect(fiyatKutulari()).toEqual(['111']);
  });
  it('kur değişince dövizli kalemin TL fiyatı güncellenir; kur kaybolursa fiyat BOŞALIR (eski kurla kalmaz)', () => {
    const { yeniden } = ciz();
    urunEkle('İTHAL BOYA');
    expect(fiyatKutulari()).toEqual(['500']);
    yeniden({ kurlar: { USD: 42 } });
    expect(fiyatKutulari()).toEqual(['525']);
    yeniden({ kurlar: {} });
    expect(fiyatKutulari()).toEqual(['']);
  });
});

describe('fiyat kutusu yazımı', () => {
  it('"1.250,50" Türkçe yazımdır → 1250,5; belirsiz "1.250" fiyat sayılmaz ve nedeni söylenir', async () => {
    const { onSubmit } = ciz();
    faturasizYap(); musteriYaz('Deneme'); urunEkle('AKÇALI SPREY METALİK SİYAH 400 ML');
    const kutu = screen.getByLabelText('Birim fiyat') as HTMLInputElement;
    fireEvent.change(kutu, { target: { value: '1.250' } });
    expect(screen.getByText(/Okunamadı/)).toBeTruthy();
    // Kutudan çıkınca (sekme / Kaydet'e tıklama) yazılan metin ve ipucu KALIR — yoksa kullanıcı yazdığının neden yok olduğunu görmez.
    fireEvent.blur(kutu);
    expect(kutu.value).toBe('1.250');
    expect(screen.getByText(/Okunamadı/)).toBeTruthy();
    kaydet();
    expect(onSubmit).not.toHaveBeenCalled();                    // 1,25 diye kaydedilmez
    fireEvent.change(kutu, { target: { value: '1.250,50' } });
    expect(screen.queryByText(/Okunamadı/)).toBeNull();
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1][0].price).toBe(1250.5);
    expect(onSubmit.mock.calls[0][2]).toEqual({ matrah: 1250.5, kdv: 0, toplam: 1250.5 });
  });
  it('giriş birimini değiştirmek OKUNAMAYAN metni ve ipucunu silmez; zaten seçili birime tıklamak hiçbir şeyi silmez', () => {
    ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY METALİK SİYAH 400 ML');
    const kutu = screen.getByLabelText('Birim fiyat') as HTMLInputElement;
    fireEvent.change(kutu, { target: { value: '1.250' } });
    fireEvent.blur(kutu);
    fireEvent.click(screen.getByRole('radio', { name: 'KDV hariç' }));   // zaten seçili
    expect(kutu.value).toBe('1.250');
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    expect(kutu.value).toBe('1.250');
    expect(screen.getByText(/Okunamadı/)).toBeTruthy();
    // Yazım sürerken ("87,") zaten seçili birime tıklamak ham metni silmez.
    fireEvent.change(kutu, { target: { value: '87,' } });
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));   // seçili olan
    expect(kutu.value).toBe('87,');
    // Okunabilen ham metin birim değişince çevrilmiş değere döner (eski birimde yazılmıştı).
    fireEvent.change(kutu, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('radio', { name: 'KDV hariç' }));
    expect(kutu.value).toBe('100');
  });
  it('kayıtlı fiyat kutuda virgülle gösterilir (87,5)', () => {
    ciz(); urunEkle('AKÇALI SPREY METALİK SİYAH 400 ML');
    const kutu = screen.getByLabelText('Birim fiyat') as HTMLInputElement;
    fireEvent.change(kutu, { target: { value: '87.5' } });
    fireEvent.blur(kutu);
    expect(kutu.value).toBe('87,5');
  });
});

describe('"Siparişi kopyala" tohumu — türetilmiş alanlar ve varsayılanlar', () => {
  /** Mikro faturasından türeyen sürüm-2 kalemin GERÇEK şekli (eslemeFatura.mfKalemleri): `id` ve `title` YOK, `price` KDV hariç net. */
  const mf = (ek: Record<string, unknown> = {}) => ({
    sku: 'S1', name: 'ÜRÜN A', quantity: 4, price: 100, birim: null, brutTutar: 400, iskonto: 0, netTutar: 400, kdv: 80, masraf: 0,
    netKaynagi: 'satir', kdvUyumsuz: false, ciftIskontoBelirsiz: false, total: 480, kalemSurumu: 2, ...ek,
  } as unknown as OrderLineItem);
  const FATURALI = { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-arsiv' as const, kdvOran: 20 };

  it('kopyada miktar değişince kayda giden kalemde KAYNAK siparişin tutar alanları YOK; tutarlar yeni miktardan', async () => {
    const { onSubmit } = ciz({ tohum: { order: FATURALI, kalemler: [mf()] } });
    expect(fiyatKutulari()).toEqual(['100']);                      // net birim, KDV hariç girişte olduğu gibi
    expect(screen.getByText('ÜRÜN A')).toBeTruthy();               // kaynakta `title` yok → ad `name`'den
    fireEvent.change(document.querySelector('tbody input[type="number"]') as HTMLInputElement, { target: { value: '10' } });
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [, kalemler, tutarlar] = onSubmit.mock.calls[0];
    // Satır tutarları YENİ miktardan yeniden yazılır (kaynağın 400 / 80'i değil); kaynağa özgü öteki alanlar taşınmaz.
    expect(kalemler[0]).toMatchObject({ price: 100, quantity: 10, sku: 'S1', title: 'ÜRÜN A', fiyatBirimi: 'kdvHaric', netTutar: 1000, kdv: 200, vatRate: 20 });
    for (const alan of ['total', 'brutTutar', 'iskonto', 'masraf', 'netKaynagi', 'kalemSurumu', 'kdvUyumsuz', 'ciftIskontoBelirsiz', 'dahilFiyat']) expect(kalemler[0]).not.toHaveProperty(alan);
    expect(tutarlar).toEqual({ matrah: 1000, kdv: 200, toplam: 1200 });
  });
  it('çok kalemli Mikro siparişinin kopyası: bir satırın fiyat kutusuna yazmak ÖTEKİ satırları değiştirmez (kaynakta `id` yok)', () => {
    ciz({ tohum: { order: FATURALI, kalemler: [mf(), mf({ sku: 'S2', name: 'ÜRÜN B', price: 50 }), mf({ sku: 'S3', name: 'ÜRÜN C', price: 20 })] } });
    expect(fiyatKutulari()).toEqual(['100', '50', '20']);
    fireEvent.change(screen.getAllByLabelText('Birim fiyat')[0], { target: { value: '150' } });
    expect(fiyatKutulari()).toEqual(['150', '50', '20']);
    expect(screen.queryByText(/Okunamadı/)).toBeNull();
  });
  it('envanter kimlikli kopya kalemin fiyatı müşteri kademesiyle / kurla EZİLMEZ (kopyalanan pazarlık fiyatı korunur)', () => {
    const { yeniden } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: false }, kalemler: [
      { id: 'k1', sku: 'AKCALI-AKÇ.00325', name: 'AKÇALI SPREY KAHVE 400 ML', title: 'AKÇALI SPREY KAHVE 400 ML', quantity: 2, price: 111, inventoryId: 'AKCALI-AKÇ.00325' } as OrderLineItem,
    ] } });
    expect(fiyatKutulari()).toEqual(['111']);
    yeniden({ selectedLead: BAYI, kurlar: { USD: 41 } });
    expect(fiyatKutulari()).toEqual(['111']);
  });
  it('kalemsiz siparişin kopyası da müşteri, adres ve notu taşır', () => {
    ciz({ tohum: { order: { customerName: 'Şirin Yapı', shippingAddress: 'Şantiye / Aksu', notes: 'Sabah teslim' }, kalemler: [] } });
    expect((screen.getByPlaceholderText('Müşteri ara veya yaz...') as HTMLInputElement).value).toBe('Şirin Yapı');
    expect(adresKutusu().value).toBe('Şantiye / Aksu');
    expect(screen.getByDisplayValue('Sabah teslim')).toBeTruthy();
  });
  it('tohumdaki TANIMSIZ KDV oranı varsayılanı ezmez: seçici, özet ve alt bant AYNI oranı gösterir', async () => {
    const { onSubmit, container } = ciz({ tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-arsiv', kdvOran: undefined }, kalemler: [{ id: 'k2', sku: 'S2', name: 'B', title: 'B', quantity: 1, price: 120 } as OrderLineItem] } });
    expect((container.querySelector('select.apple-input') as HTMLSelectElement).value).toBe('20');
    expect(container.textContent).toContain('KDV %20');
    expect(container.textContent).toContain('Faturalı • KDV %20');
    expect(container.textContent).not.toContain('KDV %0');
    expect(container.textContent).toContain('₺144,00');          // 120 KDV hariç + %20
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].kdvOran).toBe(20);
  });
  it('tohumdaki NULL alanlar da varsayılanı ezmez (boşaltılan alan kayıtta `null` yazılır): kopya faturalı ve %20 açılır', async () => {
    const { onSubmit } = ciz({ tohum: { order: { customerName: 'Şirin Yapı', faturali: null, kdvOran: null, notes: null, faturaTipi: 'e-arsiv' } as unknown as Partial<Order>,
      kalemler: [{ id: 'k2', sku: 'S2', name: 'B', title: 'B', quantity: 1, price: 120 } as OrderLineItem] } });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ faturali: true, kdvOran: 20 });
    expect(onSubmit.mock.calls[0][2]).toEqual({ matrah: 120, kdv: 24, toplam: 144 });
  });
  it('faturasız siparişin kopyası (tohumda oran YOK) "faturalı"ya çevrilince %20 ile kaydedilir — %0 ile değil', async () => {
    const { onSubmit, container } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: false }, kalemler: [{ id: 'k2', sku: 'S2', name: 'B', title: 'B', quantity: 1, price: 120 } as OrderLineItem] } });
    fireEvent.click(screen.getByRole('switch'));                 // faturasız → faturalı
    expect(container.textContent).toContain('Faturalı • KDV %20');
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].kdvOran).toBe(20);
  });
  it('kopya, kaynağın GİRİŞ BİRİMİYLE açılır: KDV dâhil girilmiş siparişin net 250\'si kutuda 300 görünür', () => {
    ciz({ tohum: { order: { ...FATURALI, fiyatGirisi: 'kdvDahil' }, kalemler: [{ id: 'k2', sku: 'S2', name: 'B', title: 'B', quantity: 12, price: 250 } as OrderLineItem] } });
    expect(screen.getByRole('radio', { name: 'KDV dâhil' }).getAttribute('aria-checked')).toBe('true');
    expect(fiyatKutulari()).toEqual(['300']);
  });
});

describe('KDV: birim fiyat girişi seçilebilir (kullanıcı 2026-10-03 — «3000 dâhil birim fiyat girişi var, hesap hatası»)', () => {
  const ozet = () => document.querySelector('form')?.textContent ?? '';
  /** İlk kalem satırının TUTAR hücresi (4. sütun). */
  const satirTutari = () => (document.querySelector('tbody tr')?.children[3] as HTMLElement | undefined)?.textContent?.trim();
  /** Faturalı sipariş: bayi seçili (e-Fatura kayıtlı → belge tipi dolu), 250 × 12. */
  function ikiYuzElliOnIki(mod: 'KDV hariç' | 'KDV dâhil') {
    const r = ciz({ selectedLead: BAYI });
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    if (mod === 'KDV dâhil') fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '250' } });
    fireEvent.change(document.querySelector('tbody input[type="number"]') as HTMLInputElement, { target: { value: '12' } });
    return r;
  }
  it('VARSAYILAN KDV HARİÇ: 250 × 12 → matrah 3.000 + KDV 600 = 3.600; kalem fiyatı 250 olarak kaydedilir', async () => {
    const { onSubmit } = ikiYuzElliOnIki('KDV hariç');
    expect(screen.getByRole('radio', { name: 'KDV hariç' }).getAttribute('aria-checked')).toBe('true');
    expect(ozet()).toContain('Matrah (KDV hariç)₺3.000,00');
    expect(ozet()).toContain('KDV %20₺600,00');
    expect(ozet()).toContain('Toplam (KDV dâhil)₺3.600,00');
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('Ara toplam (KDV hariç)')).toBeTruthy();
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('₺3.000,00')).toBeTruthy();
    expect(satirTutari()).toBe('₺3.000,00');
    // Alt toplam TUTAR sütununun altında: etiket üç sütunu kaplar (eskiden değer MİKTAR'ın altına düşüyordu).
    const altSatir = Array.from((document.querySelector('tfoot tr') as HTMLElement).children) as HTMLTableCellElement[];
    expect(altSatir.map(h => h.colSpan)).toEqual([3, 1, 1]);
    expect(document.querySelectorAll('thead th')).toHaveLength(5);
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(tutarlar).toEqual({ matrah: 3000, kdv: 600, toplam: 3600 });
    expect(kalemler[0]).toMatchObject({ price: 250, quantity: 12, fiyatBirimi: 'kdvHaric', netTutar: 3000, kdv: 600, vatRate: 20 });
    expect(kalemler[0]).not.toHaveProperty('dahilFiyat');
    expect(siparis).toMatchObject({ faturali: true, kdvOran: 20, fiyatGirisi: 'kdvHaric' });
  });
  it('KDV DÂHİL seçilince: 250 × 12 → toplam 3.000 = matrah 2.500 + KDV 500; kalem fiyatı KDV HARİÇ net (208,333333) kaydedilir', async () => {
    const { onSubmit } = ikiYuzElliOnIki('KDV dâhil');
    expect(ozet()).toContain('Matrah (KDV hariç)₺2.500,00');
    expect(ozet()).toContain('KDV %20₺500,00');
    expect(ozet()).toContain('Toplam (KDV dâhil)₺3.000,00');
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('Toplam (KDV dâhil)')).toBeTruthy();
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('₺3.000,00')).toBeTruthy();   // etiketin altında matrah (2.500) DEĞİL
    expect(satirTutari()).toBe('₺3.000,00');                     // satır tutarı da fiyat sütunuyla aynı birimde
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(tutarlar).toEqual({ matrah: 2500, kdv: 500, toplam: 3000 });
    expect(kalemler[0]).toMatchObject({ price: 208.333333, fiyatBirimi: 'kdvDahil', dahilFiyat: 250, netTutar: 2500, kdv: 500, vatRate: 20 });   // net × 12 = 2.500,00
    expect(siparis.fiyatGirisi).toBe('kdvDahil');
  });
  it('giriş birimini DEĞİŞTİRMEK siparişin tutarını değiştirmez: yalnız kutudaki gösterim çevrilir (250 hariç ↔ 300 dâhil)', () => {
    ikiYuzElliOnIki('KDV hariç');
    fireEvent.blur(screen.getByLabelText('Birim fiyat'));
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    expect(fiyatKutulari()).toEqual(['300']);
    expect(satirTutari()).toBe('₺3.600,00');
    expect(ozet()).toContain('Toplam (KDV dâhil)₺3.600,00');
    fireEvent.click(screen.getByRole('radio', { name: 'KDV hariç' }));
    expect(fiyatKutulari()).toEqual(['250']);
    expect(ozet()).toContain('Toplam (KDV dâhil)₺3.600,00');
  });
  it('KDV oranı değişince: KDV dâhil girilen fiyatta TOPLAM sabit, KDV hariç girilende MATRAH sabit', () => {
    ikiYuzElliOnIki('KDV dâhil');
    fireEvent.click(screen.getByRole('button', { name: '%10' }));
    expect(ozet()).toContain('Toplam (KDV dâhil)₺3.000,00');
    expect(ozet()).toContain('Matrah (KDV hariç)₺2.727,27');
  });
  it('stok kartı fiyatı KDV HARİÇTİR: listede "+ KDV" notuyla; KDV dâhil girişte çevrilmiş hâliyle', () => {
    ciz({ selectedLead: BAYI }); urunListesiniAc();
    expect(screen.getByText('₺95,00')).toBeTruthy();
    expect(screen.getAllByText('+ KDV').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('AKÇALI SPREY KAHVE 400 ML'));
    expect(fiyatKutulari()).toEqual(['95']);
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    expect(fiyatKutulari()).toEqual(['114']);                    // 95 × 1,20
    urunListesiniAc();
    // Listedeki kart fiyatı da çevrilmiş (ürün düğmesinin içindeki fiyat satırı).
    expect(Array.from(document.querySelectorAll('button p.text-brand')).map(e => e.textContent)).toContain('₺114,00');
    expect(screen.getAllByText('KDV dâhil').length).toBeGreaterThan(2);   // seçici + sütun başlığı + liste notu
  });
  it('faturasız siparişte KDV yok: giriş birimi seçicisi görünmez, toplam = Σ fiyat × miktar', async () => {
    const { onSubmit } = ciz();
    expect(screen.getByRole('radiogroup')).toBeTruthy();         // varsayılan faturalı
    faturasizYap(); musteriYaz('Deneme');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    expect(screen.queryByText('+ KDV')).toBeNull();
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2]).toEqual({ matrah: 120, kdv: 0, toplam: 120 });
  });
});

describe('teslimat adresi', () => {
  it('müşteri seçilince adres müşteri kaydından dolar; adresi OLMAYAN müşteriye geçilince önceki müşterinin adresi kalmaz', () => {
    const { yeniden } = ciz({ selectedLead: BAYI });
    expect(adresKutusu().value).toBe('Antalya / Kepez');
    yeniden({ selectedLead: PERAKENDE });
    expect(adresKutusu().value).toBe('');
  });
  it('kullanıcının YAZDIĞI adres müşteri değişince ezilmez', () => {
    const { yeniden } = ciz({ selectedLead: BAYI });
    fireEvent.change(adresKutusu(), { target: { value: 'Şantiye / Döşemealtı' } });
    yeniden({ selectedLead: PERAKENDE });
    expect(adresKutusu().value).toBe('Şantiye / Döşemealtı');
    yeniden({ selectedLead: BAYI });
    expect(adresKutusu().value).toBe('Şantiye / Döşemealtı');
  });
  it('kopyalanan siparişin adresi açılışta müşteri adresiyle EZİLMEZ; müşteri sonradan değişirse değişir', () => {
    const { yeniden } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', shippingAddress: 'Şantiye / Aksu' }, kalemler: [] } });
    expect(adresKutusu().value).toBe('Şantiye / Aksu');
    yeniden({ selectedLead: PERAKENDE, tohum: null });
    expect(adresKutusu().value).toBe('');
  });
  it('"Değiştir": bırakılan müşterinin kayıtlı adresi kutudan silinir', () => {
    ciz({ selectedLead: BAYI });
    expect(adresKutusu().value).toBe('Antalya / Kepez');
    fireEvent.click(screen.getByText('Değiştir'));
    expect(adresKutusu().value).toBe('');
  });
});

describe('KDV: kayıt ↔ Mikro tutarlılığı, faturalı ↔ faturasız geçişi, sıfırlama (inceleme 2026-10-03)', () => {
  const VERGI = new Map([[1, 0], [2, 1], [3, 10], [4, 20]]);     // Mikro VergiListesiV2: sıra → yüzde
  const ozet = () => document.querySelector('form')?.textContent ?? '';
  const miktarKutusu = () => document.querySelector('tbody input[type="number"]') as HTMLInputElement;
  /** Pencerenin kaydettiği sipariş + kalemler → Mikro sipariş gövdesi (gerçek üretici). */
  const mikroGovdesi = (siparis: Partial<Order>, kalemler: OrderLineItem[]) =>
    siparisGovdesi({ ...siparis, mikroCariKod: '120.01.001', lineItems: kalemler }, { vergiTablosu: VERGI, depoNo: 2, simdi: new Date(2026, 9, 3) }).satirlar;

  it('ORAN SEÇİCİDEN DEĞİŞİNCE kayda giden kalemin KDV oranı SİPARİŞ oranıdır; Mikro gövdesi aynı oranı ve aynı matrahı yazar', async () => {
    for (const mod of ['KDV hariç', 'KDV dâhil'] as const) {
      const { onSubmit, unmount } = ciz({ selectedLead: BAYI });
      urunEkle('AKÇALI SPREY KAHVE 400 ML');                      // ürün kartı %20
      if (mod === 'KDV dâhil') fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
      fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '250' } });
      fireEvent.change(miktarKutusu(), { target: { value: '12' } });
      fireEvent.click(screen.getByRole('button', { name: '%10' }));
      expect(screen.getByRole('note').textContent).toContain('Sipariş tek KDV oranıyla (%10) hesaplanır');   // kart %20 ≠ sipariş %10: görünür
      kaydet();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
      expect(siparis.kdvOran, mod).toBe(10);
      expect(kalemler[0].vatRate, mod).toBe(10);                  // kartın %20'si DEĞİL — yoksa Mikro %20 ile hesaplardı
      const satirlar = mikroGovdesi(siparis, kalemler);
      expect(satirlar.map(x => x.sip_vergi_pntr), mod).toEqual([3]);                                    // %10'un işaretçisi
      expect(kurusaYuvarla(satirlar.reduce((t, x) => t + x.sip_tutar, 0)), mod).toBe(tutarlar.matrah);  // Σ sip_tutar = Cetpa matrahı
      expect(tutarlar, mod).toEqual(mod === 'KDV hariç' ? { matrah: 3000, kdv: 300, toplam: 3300 } : { matrah: 2727.27, kdv: 272.73, toplam: 3000 });
      unmount();
    }
  });
  it('çok kalemli KDV DÂHİL sipariş: Mikro satır toplamı Cetpa matrahıyla kuruşu kuruşuna aynı (3 × 100,00 → 249,99 + 50,01)', async () => {
    const { onSubmit } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura', kdvOran: 20, fiyatGirisi: 'kdvDahil' },
      kalemler: ['S1', 'S2', 'S3'].map(sku => ({ id: sku, sku, name: sku, title: sku, quantity: 1, price: 83.333333, vatRate: 20 } as OrderLineItem)) } });
    expect(fiyatKutulari()).toEqual(['100', '100', '100']);
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(tutarlar).toEqual({ matrah: 249.99, kdv: 50.01, toplam: 300 });
    expect(kurusaYuvarla(mikroGovdesi(siparis, kalemler).reduce((t, x) => t + x.sip_tutar, 0))).toBe(249.99);
  });
  it('KAYIT = BELGE: kaydedilen tutarlar, aynı siparişten kurulan FATURA gövdesinin (Σ sth_tutar + Σ sth_vergi) kuruşu kuruşuna aynısı — yazılan KDV dâhil toplam dâhil', async () => {
    // [giriş birimi, yazılan fiyat, miktar, beklenen KDV DÂHİL toplam (yalnız dâhil girişte: yazılan × miktar)]
    for (const [mod, fiyat, miktar, yazilan] of [['KDV hariç', '250', '12', null], ['KDV dâhil', '250', '12', 3000], ['KDV dâhil', '50,01', '1', 50.01], ['KDV dâhil', '99,99', '3', 299.97], ['KDV hariç', '19,99', '2,5', null]] as const) {
      const { onSubmit, unmount } = ciz({ selectedLead: BAYI });
      urunEkle('AKÇALI SPREY KAHVE 400 ML');
      if (mod === 'KDV dâhil') fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
      fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: fiyat } });
      fireEvent.change(miktarKutusu(), { target: { value: miktar.replace(',', '.') } });
      kaydet();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
      // İstemcinin fatura isteği kalemden `kdv`'yi taşır (App.tsx handleMikroFatura); gövde onu belgeye yazar.
      const fatura = faturaGovdesi({ ...siparis, mikroCariKod: '120.01.001', lineItems: kalemler.map(x => ({ sku: x.sku, name: x.name, quantity: x.quantity, price: x.price, kdv: x.kdv })) },
        { vergiTablosu: VERGI, jumpSurum: 17, depoNo: 2, simdi: new Date(2026, 9, 7) });
      const matrah = kurusaYuvarla(fatura.satirlar.reduce((t, x) => t + x.sth_tutar, 0));
      const kdv = kurusaYuvarla(fatura.satirlar.reduce((t, x) => t + x.sth_vergi, 0));
      expect(tutarlar, `${mod} ${fiyat} × ${miktar}`).toEqual({ matrah, kdv, toplam: kurusaYuvarla(matrah + kdv) });
      if (yazilan !== null) expect(tutarlar.toplam, `${mod} ${fiyat} × ${miktar}: yazılan toplam`).toBe(yazilan);
      unmount();
    }
  });
  it('KDV dâhil YAZILAN TOPLAM KORUNUR (kullanıcı 2026-10-07: «hesap nasıl farklı çıktı»): 50,01 × 1 = 50,01 — satır, alt toplam, özet ve düğme', async () => {
    const { onSubmit } = ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '50,01' } });
    expect((document.querySelector('tbody tr')?.children[3] as HTMLElement).textContent?.trim()).toBe('₺50,01');
    expect(within(document.querySelector('tfoot') as HTMLElement).getByText('₺50,01')).toBeTruthy();
    expect(ozet()).toContain('Matrah (KDV hariç)₺41,68');
    expect(ozet()).toContain('KDV %20₺8,33');                      // iç yüzde: toplam − matrah (matrah × oran 8,34 verirdi)
    expect(ozet()).toContain('Toplam (KDV dâhil)₺50,01');
    expect(ozet()).not.toContain('50,02');
    expect((document.querySelector('button[type="submit"]') as HTMLElement).textContent).toContain('₺50,01');
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2]).toEqual({ matrah: 41.68, kdv: 8.33, toplam: 50.01 });
    expect(onSubmit.mock.calls[0][1][0]).toMatchObject({ price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat: 50.01, netTutar: 41.68, kdv: 8.33 });
  });
  it('KDV dâhil girilmiş siparişin KOPYASI yazılan birimle açılır: dokunulmadan kaydedilirse kaynakla AYNI tutar; oran değişince TOPLAM sabit', async () => {
    const tohum = { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura' as const, kdvOran: 20, fiyatGirisi: 'kdvDahil' as const },
      kalemler: [{ id: 'k1', sku: 'S1', name: 'A', title: 'A', quantity: 1, price: 41.675, vatRate: 20, fiyatBirimi: 'kdvDahil', dahilFiyat: 50.01, netTutar: 41.68, kdv: 8.33 } as OrderLineItem] };
    const { onSubmit } = ciz({ selectedLead: BAYI, tohum });
    expect(fiyatKutulari()).toEqual(['50,01']);
    expect(ozet()).toContain('Toplam (KDV dâhil)₺50,01');
    fireEvent.click(screen.getByRole('button', { name: '%10' }));
    expect(ozet()).toContain('Toplam (KDV dâhil)₺50,01');           // yazılan toplam sabit
    expect(ozet()).toContain('Matrah (KDV hariç)₺45,46');
    fireEvent.click(screen.getByRole('button', { name: '%20' }));
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][2]).toEqual({ matrah: 41.68, kdv: 8.33, toplam: 50.01 });
    expect(onSubmit.mock.calls[0][1][0]).toMatchObject({ price: 41.675, fiyatBirimi: 'kdvDahil', dahilFiyat: 50.01, netTutar: 41.68, kdv: 8.33 });
  });
  it('uyarıdaki SAYI farklı oranlı KALEM adedidir (oran çeşidi değil); "üründen otomatik" rozeti oran elle değişince ve kopyada çıkmaz', () => {
    const { unmount } = ciz({ selectedLead: BAYI });
    urunEkle('AKÇALI SPREY KAHVE 400 ML');
    expect(screen.getByText(/üründen otomatik/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '%10' }));
    expect(screen.getByRole('note').textContent).toContain('Ürün kartındaki oranı farklı 1 kalem var (%20) — farklı oranlı ürünleri ayrı siparişe girin.');
    expect(screen.queryByText(/üründen otomatik/)).toBeNull();     // uyarıyla çelişen rozet yok
    unmount();
    // İki kalem de %20, sipariş %10: sayı 2 (oran çeşidi 1).
    ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura', kdvOran: 10, fiyatGirisi: 'kdvHaric' },
      kalemler: ['S1', 'S2'].map(sku => ({ id: sku, sku, name: sku, title: sku, quantity: 1, price: 100, vatRate: 20 } as OrderLineItem)) } });
    // Kopyada oran ürün KARTINA atfedilmez (kalem oranı kaynak siparişin oranıdır) ve kullanıcı siparişi bölmeye yönlendirilmez.
    expect(screen.getByRole('note').textContent).toContain('Kalemde kayıtlı oranı farklı 2 kalem var (%20) — kayıtta hepsi seçili orana çekilir; oranı doğrulayın.');
    expect(screen.getByRole('note').textContent).not.toContain('Ürün kartı');
    expect(screen.queryByText(/üründen otomatik/)).toBeNull();
  });
  it('kopyada oranlar uyumluyken de "üründen otomatik" denmez (kalem oranı ürün kartından değil kaynak siparişten)', () => {
    ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura', kdvOran: 20, fiyatGirisi: 'kdvHaric' },
      kalemler: [{ id: 'k1', sku: 'S1', name: 'A', title: 'A', quantity: 1, price: 100, vatRate: 20 } as OrderLineItem] } });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/üründen otomatik/)).toBeNull();
  });
  it('kart oranı sipariş oranıyla AYNIYSA uyarı yok; faturasızda da yok', () => {
    ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '%10' }));
    expect(screen.getByRole('note')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));                 // faturasız: KDV bloğu ve uyarı yok
    expect(screen.queryByRole('note')).toBeNull();
  });
  it('KDV dâhil modda yazılan fiyat, sipariş FATURASIZA çevrilince olduğu gibi kaydedilir (KDV yok: fiyat × miktar = toplam)', async () => {
    const { onSubmit } = ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '300' } });
    fireEvent.blur(screen.getByLabelText('Birim fiyat'));
    fireEvent.click(screen.getByRole('switch'));
    expect(fiyatKutulari()).toEqual(['300']);
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [siparis, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(kalemler[0]).toMatchObject({ price: 300, vatRate: 20 });   // faturasızda kalemin kart oranına dokunulmaz
    expect(tutarlar).toEqual({ matrah: 300, kdv: 0, toplam: 300 });
    expect(siparis).not.toHaveProperty('fiyatGirisi');
  });
  it('faturasızken yazılan fiyat SEÇİLİ giriş birimini taşır: faturalıya dönünce seçicide görünen birimle okunur', () => {
    ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.click(screen.getByRole('radio', { name: 'KDV dâhil' }));
    fireEvent.click(screen.getByRole('switch'));                 // faturasız (seçici gizli)
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '100' } });
    fireEvent.blur(screen.getByLabelText('Birim fiyat'));
    fireEvent.click(screen.getByRole('switch'));                 // yeniden faturalı — seçici "KDV dâhil"
    expect(screen.getByRole('radio', { name: 'KDV dâhil' }).getAttribute('aria-checked')).toBe('true');
    expect(fiyatKutulari()).toEqual(['100']);
    expect(ozet()).toContain('Toplam (KDV dâhil)₺100,00');
    expect(ozet()).toContain('Matrah (KDV hariç)₺83,33');
  });
  it('varsayılan birimde (KDV hariç) faturasızken yazılan 100, faturalıya dönünce 100 + KDV olur', () => {
    ciz({ selectedLead: BAYI }); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Birim fiyat'), { target: { value: '100' } });
    fireEvent.blur(screen.getByLabelText('Birim fiyat'));
    fireEvent.click(screen.getByRole('switch'));
    expect(ozet()).toContain('Toplam (KDV dâhil)₺120,00');
  });
  it('yalnız KDV dâhil `total` taşıyan eski kalemin FATURASIZ kopyası: kayıt fiyatı × miktar = toplam', async () => {
    const { onSubmit } = ciz({ tohum: { order: { customerName: 'Şirin Yapı', faturali: false }, kalemler: [{ sku: 'S1', name: 'A', quantity: 3, total: 100 } as unknown as OrderLineItem] } });
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [, kalemler, tutarlar] = onSubmit.mock.calls[0];
    expect(tutarlar).toEqual({ matrah: 100, kdv: 0, toplam: 100 });
    expect(kurusaYuvarla(kalemler[0].price * kalemler[0].quantity)).toBe(100);
  });
  it('giriş birimi pencere KAPANINCA sıfırlanır: KDV dâhil kopyadan sonra açılan YENİ sipariş KDV hariç başlar', () => {
    const { yeniden } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura', kdvOran: 20, fiyatGirisi: 'kdvDahil' }, kalemler: [] } });
    expect(screen.getByRole('radio', { name: 'KDV dâhil' }).getAttribute('aria-checked')).toBe('true');
    yeniden({ isOpen: false, selectedLead: null, tohum: null });
    yeniden({ isOpen: true, selectedLead: BAYI, tohum: null });
    expect(screen.getByRole('radio', { name: 'KDV hariç' }).getAttribute('aria-checked')).toBe('true');
  });
  it('KDV dâhil girilmiş siparişin kopyası faturasıza çevrilip kaydedilirse siparişe `fiyatGirisi` YAZILMAZ (bayat işaret taşınmaz)', async () => {
    const { onSubmit } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', faturali: true, faturaTipi: 'e-fatura', kdvOran: 20, fiyatGirisi: 'kdvDahil' },
      kalemler: [{ id: 'k1', sku: 'S1', name: 'A', title: 'A', quantity: 1, price: 100 } as OrderLineItem] } });
    fireEvent.click(screen.getByRole('switch'));
    kaydet();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('fiyatGirisi');
    expect(onSubmit.mock.calls[0][0].faturali).toBe(false);
  });
});

describe('teslimat adresi — kopya ve giriş noktaları (düzeltme turu bulguları)', () => {
  it('ADRESSİZ kopya (Mikro faturasından türeyen sipariş adres taşımaz): müşterinin kayıtlı adresi dolar', () => {
    ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı' }, kalemler: [] } });
    expect(adresKutusu().value).toBe('Antalya / Kepez');
  });
  it('MÜŞTERİSİZ açılan kopya: sonradan seçilen müşterinin adresi gelir (kopyanın adresi ilk seçime sarkmaz)', () => {
    const { yeniden } = ciz({ tohum: { order: { customerName: 'Elle Yazılan', shippingAddress: 'Şantiye / Aksu' }, kalemler: [] } });
    expect(adresKutusu().value).toBe('Şantiye / Aksu');
    yeniden({ selectedLead: BAYI, tohum: { order: { customerName: 'Elle Yazılan', shippingAddress: 'Şantiye / Aksu' }, kalemler: [] } });   // tohum prop'u canlıdaki gibi durur
    expect(adresKutusu().value).toBe('Antalya / Kepez');
  });
  it('pencere kapanıp yeniden açılınca adres bayrakları taşınmaz: yeni siparişte seçilen müşterinin adresi dolar', () => {
    const { yeniden } = ciz({ selectedLead: BAYI, tohum: { order: { customerName: 'Şirin Yapı', shippingAddress: 'Şantiye / Aksu' }, kalemler: [] } });
    expect(adresKutusu().value).toBe('Şantiye / Aksu');
    yeniden({ isOpen: false, selectedLead: null, tohum: null });
    yeniden({ isOpen: true, selectedLead: BAYI, tohum: null });
    expect(adresKutusu().value).toBe('Antalya / Kepez');
  });
  it('listeden müşteri SEÇMEK kullanıcının yazdığı adresi ezmez (combobox onSelect)', () => {
    function Sarmal() {
      const [lead, setLead] = React.useState<Lead | null>(null);
      return (
        <AddOrderModal isOpen onClose={vi.fn()} selectedLead={lead} setSelectedLead={setLead} leads={[BAYI]} inventory={ENVANTER} warehouses={[]}
          branchNames={[]} currentLanguage="tr" currentT={translations.tr as unknown as Record<string, string>} kurlar={{ USD: 40 }}
          onSubmit={vi.fn(async () => undefined)} onAddLeadClick={vi.fn()} onGoToInventory={vi.fn()} />
      );
    }
    render(<Sarmal />);
    fireEvent.change(adresKutusu(), { target: { value: 'Şantiye / Döşemealtı' } });
    fireEvent.focus(screen.getByPlaceholderText('Müşteri ara veya yaz...'));
    fireEvent.mouseDown(screen.getByText('Şirin Yapı'));
    expect(screen.getByText('Değiştir')).toBeTruthy();           // müşteri gerçekten seçildi
    expect(adresKutusu().value).toBe('Şantiye / Döşemealtı');
  });
  it('"Değiştir": kullanıcının YAZDIĞI adres silinmez', () => {
    ciz({ selectedLead: BAYI });
    fireEvent.change(adresKutusu(), { target: { value: 'Şantiye / Döşemealtı' } });
    fireEvent.click(screen.getByText('Değiştir'));
    expect(adresKutusu().value).toBe('Şantiye / Döşemealtı');
  });
  it('"Yeni müşteri adayı ekle" sipariş penceresini KAPATMAZ (girilen kalemler silinmez)', () => {
    const onAddLeadClick = vi.fn();
    const { onClose } = ciz({ onAddLeadClick });
    faturasizYap(); urunEkle('AKÇALI SPREY KAHVE 400 ML');
    fireEvent.focus(screen.getByPlaceholderText('Müşteri ara veya yaz...'));
    fireEvent.mouseDown(screen.getByText('Yeni müşteri adayı ekle'));
    expect(onAddLeadClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(fiyatKutulari()).toEqual(['120']);
  });
});
