/**
 * MagazaTalepleri.test.tsx — Siparişler → «Mağaza Talepleri» sekmesinin GERÇEK çizimi (dilim 1, 2026-10-08).
 * «Yazıldı ama bağlanmadı» çitinin (b) parçası; (a) parçası `pages/OrdersPage.magazaTalepleri.degismez.test.ts`.
 *
 * KİLİTLENEN DEĞİŞMEZLER (şartname § 5):
 *   - liste sütunları + detay; salt okunur (işlem düğmesi YOK);
 *   - tutarlar müşterinin BEYANIDIR: `null` → '—', fiyatsız kalem → «fiyat sorulacak» (₺0,00 DEĞİL), fiyatı sorulacak kalem
 *     varken toplamın yanında «eksik — N kalemin fiyatı sorulacak»; ekran kalemlerden toplam TÜRETMEZ;
 *   - bildirim: `gonderilemedi` / `yapilandirilmamis` / 10 dakikadan eski `bekliyor` → «bildirim gönderilmedi»; taze
 *     `bekliyor` → «gönderiliyor»; `gitti` işaretsiz;
 *   - en yeni 200 talep çizilir, fazlası «daha eski N talep» diye SAYILIR;
 *   - müşterinin yazdığı metin HTML olarak yorumlanmaz; bağlantı yalnız doğrulanmış `tel:` / `mailto:`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MagazaTalepleri, {
  MagazaYeniRozeti, MAGAZA_TALEP_EKRAN_SINIRI,
  magazaTalepGorunumu, bildirimGorunumu, sonrakiBeklemeEsigi, toplamEksikMi, fiyatiSorulacakKalemSayisi,
  telBaglantisi, epostaBaglantisi,
} from './MagazaTalepleri';
import { useMagazaYeniSayaci, type MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';
import { MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, type MagazaTalepKalemi } from '../../lib/magazaTalep';
import { yorumsuz } from '../../test/degismezTarayici';

// «Şimdi» sabit: bildirim bekleme süresi saatle ölçülür. Öğlen (UTC) seçildi — UTC−12…UTC+11 arasındaki her saat
// diliminde takvim günü 08.10.2026'dır, tarih beklentisi test makinesinin saat dilimine takılmaz.
const SIMDI = Date.parse('2026-10-08T12:00:00.000Z');
const once = (dakika: number): string => new Date(SIMDI - dakika * 60_000).toISOString();

const kalem = (ek: Partial<MagazaTalepKalemi> = {}): MagazaTalepKalemi =>
  ({ id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false, ...ek });

let sira = 0;
const talep = (ek: Partial<MagazaTalepSatiri> = {}): MagazaTalepSatiri => ({
  id: `mt-${String(++sira).padStart(4, '0')}`,
  companyId: 'kiraci-1',
  talepNo: 'T261008-5Y9P',
  durum: 'yeni',
  olusturma: once(60),
  istemciTarihi: once(61),
  musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İzmir', adres: 'Işıklar Cad. No: 5\nKat 2', vergi: '1234567890' },
  telefonSon10: '5321112233',
  not: 'Öğleden sonra arayın',
  kalemler: [kalem(), kalem({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: 120 })],
  talepEdilen: { araToplam: 529.98, kdv: 106, toplam: 635.98 },
  fiyatiSorulacakVar: false,
  bildirim: { durum: 'gitti', zaman: once(59) },
  ...ek,
});

const ciz = (talepler: MagazaTalepSatiri[], dil: 'tr' | 'en' = 'tr') =>
  render(<MagazaTalepleri talepler={talepler} yukleniyor={false} hata={null} currentLanguage={dil} />);
/** Liste satırları = detayı açan düğmeler (bileşende başka düğme yok). */
const satirlar = () => screen.getAllByRole('button');
/** Satıra tıklar, açılan detay bölgesini döndürür (kabuk `<section>` de adlı bir bölgedir — ada göre ayrılır). */
const detayAc = (i = 0) => { fireEvent.click(satirlar()[i]); return screen.getByRole('region', { name: /talep detayı$|^Request .* detail$/ }); };

beforeEach(() => { sira = 0; localStorage.clear(); vi.useFakeTimers({ now: SIMDI }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ── Liste ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — liste', () => {
  it('kabuk `apple-card`; satır içi renk YOK; başlıkta toplam talep sayısı ve «sipariş değildir» notu', () => {
    const { container } = ciz([talep(), talep()]);
    const kabuk = screen.getByRole('region', { name: 'Mağaza Talepleri' });
    expect(kabuk.className).toContain('apple-card');
    expect(container.querySelector('[style]')).toBeNull();
    expect(screen.getByRole('heading', { name: /Mağaza Talepleri\s*2/ })).toBeTruthy();
    expect(screen.getByText(/sipariş değildir; ciroya ve sipariş listesine girmez/)).toBeTruthy();
    expect(screen.getByText(/Tutarlar müşterinin sitede gördüğü rakamlardır, onaylanmış fiyat değildir/)).toBeTruthy();
  });

  it('sütunlar: talep no, tarih (tr-TR), müşteri adı / firma, il, kalem sayısı, talep edilen toplam, bildirim', () => {
    ciz([talep({ talepNo: 'T261008-AB12', olusturma: '2026-10-08T11:00:00.000Z' })]);
    const satir = satirlar()[0];
    for (const baslik of ['Talep no', 'Tarih', 'Müşteri / firma', 'İl', 'Kalemler', 'Talep edilen toplam']) {
      expect(within(satir).getByText(baslik)).toBeTruthy();
    }
    expect(satir.textContent).toContain('T261008-AB12');
    expect(satir.textContent).toMatch(/08\.10\.2026 \d{2}:\d{2}/);
    expect(satir.textContent).toContain('Şükrü Çağlayan');
    expect(satir.textContent).toContain('Çağlayan İnşaat');
    expect(satir.textContent).toContain('İzmir');
    expect(satir.textContent).toContain('2 kalem');
    expect(satir.textContent).toContain('₺635,98');
    // «gitti» işaretsizdir: ne rozet ne «Bildirim» etiketi.
    expect(satir.textContent).not.toMatch(/Bildirim|bildirim|gönderiliyor/);
  });

  it('sıra: en yeni ÖNCE; tarihi çözülemeyen talep ATILMAZ — sonda ve tarihi \'—\'', () => {
    ciz([
      talep({ talepNo: 'T261008-ESKI', olusturma: once(300) }),
      talep({ talepNo: 'T261008-BOZK', olusturma: 'dün öğlen' }),
      talep({ talepNo: 'T261008-YENI', olusturma: once(5) }),
    ]);
    expect(satirlar().map(s => /T261008-[A-Z]{4}/.exec(s.textContent ?? '')?.[0])).toEqual(['T261008-YENI', 'T261008-ESKI', 'T261008-BOZK']);
    expect(within(satirlar()[2]).getByText('Tarih').nextElementSibling?.textContent).toBe('—');
  });

  it('boş alanlar \'—\' basılır; firma yoksa satırda ikinci satır çizilmez', () => {
    ciz([talep({ talepNo: '', musteri: { ad: '', firma: '  ', telefon: '', eposta: '', il: '', adres: '', vergi: '' } })]);
    const satir = satirlar()[0];
    expect(within(satir).getByText('Talep no').nextElementSibling?.textContent).toBe('—');
    expect(within(satir).getByText('İl').nextElementSibling?.textContent).toBe('—');
    expect(within(satir).getByText('Müşteri / firma').parentElement?.children).toHaveLength(2);   // etiket + ad
  });

  it('yükleniyor / hata / boş durumları AYRI yazılır — hata «talep yok» gibi görünmez', () => {
    const { rerender } = render(<MagazaTalepleri talepler={[]} yukleniyor hata={null} currentLanguage="tr" />);
    expect(screen.getByText('Yükleniyor...')).toBeTruthy();
    expect(screen.queryByText(/Henüz mağaza talebi yok/)).toBeNull();

    rerender(<MagazaTalepleri talepler={[]} yukleniyor={false} hata="bağlantı koptu" currentLanguage="tr" />);
    expect(screen.getByRole('alert').textContent).toBe('Mağaza talepleri okunamadı: bağlantı koptu');
    expect(screen.queryByText(/Henüz mağaza talebi yok/)).toBeNull();

    rerender(<MagazaTalepleri talepler={[]} yukleniyor={false} hata={null} currentLanguage="tr" />);
    expect(screen.getByText('Henüz mağaza talebi yok.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('İngilizce arayüz: başlık ve metinler çevrilir', () => {
    ciz([talep({ kalemler: [kalem({ talepFiyat: null })], fiyatiSorulacakVar: true, bildirim: { durum: 'gonderilemedi', zaman: once(30) } })], 'en');
    expect(screen.getByRole('region', { name: 'Store Requests' })).toBeTruthy();
    expect(satirlar()[0].textContent).toContain('incomplete — price to be quoted for 1 item');
    expect(satirlar()[0].textContent).toContain('notification not sent');
    expect(detayAc().textContent).toContain('price to be quoted');
  });
});

// ── Detay ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — detay', () => {
  it('satır DÜĞMEDİR; tıklayınca detay açılır, yeniden tıklayınca kapanır (aria-expanded)', () => {
    ciz([talep()]);
    const satir = satirlar()[0];
    expect(satir.tagName).toBe('BUTTON');
    expect(satir.getAttribute('type')).toBe('button');
    expect(satir.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Öğleden sonra arayın')).toBeNull();

    fireEvent.click(satir);
    expect(satir.getAttribute('aria-expanded')).toBe('true');
    const detay = screen.getByRole('region', { name: 'T261008-5Y9P talep detayı' });
    expect(detay.id).toBe(satir.getAttribute('aria-controls'));
    expect(detay.textContent).toContain('Öğleden sonra arayın');

    fireEvent.click(satir);
    expect(satir.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Öğleden sonra arayın')).toBeNull();
  });

  it('müşteri alanları, kalemler, not ve tutarlar — «müşterinin sitede gördüğü» etiketiyle', () => {
    ciz([talep()]);
    const detay = detayAc();
    const alan = (etiket: string) => within(detay).getByText(etiket).nextElementSibling?.textContent;
    expect(alan('Müşteri')).toBe('Şükrü Çağlayan');
    expect(alan('Firma')).toBe('Çağlayan İnşaat');
    expect(alan('Telefon')).toBe('0532 111 22 33');
    expect(alan('E-posta')).toBe('sukru@ornek.com.tr');
    expect(alan('İl')).toBe('İzmir');
    expect(alan('Vergi No')).toBe('1234567890');
    expect(alan('Adres')).toBe('Işıklar Cad. No: 5\nKat 2');
    expect(alan('Müşteri notu')).toBe('Öğleden sonra arayın');
    expect(alan('Kayıt zamanı')).toMatch(/^08\.10\.2026 \d{2}:\d{2}$/);
    expect(alan('Müşteri cihazının saati')).toMatch(/^08\.10\.2026 \d{2}:\d{2}$/);

    const satir = within(detay).getAllByRole('row');
    expect(satir).toHaveLength(3);   // başlık + 2 kalem
    expect(within(satir[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Stok kodu', 'Ürün', 'Marka', 'Adet', 'Birim fiyat (sitede görülen)']);
    expect(within(satir[1]).getAllByRole('cell').map(h => h.textContent)).toEqual(['DYO-0001', 'İç cephe boyası', 'DYO', '2', '₺204,99']);
    expect(within(satir[2]).getAllByRole('cell').map(h => h.textContent)).toEqual(['FRC-12', 'Fırça', 'İzmir Fırça', '1', '₺120,00']);

    expect(within(detay).getByText('Talep edilen tutarlar — müşterinin sitede gördüğü')).toBeTruthy();
    expect(alan('Ara toplam')).toBe('₺529,98');
    expect(alan('KDV')).toBe('₺106,00');
    expect(alan('Toplam')).toBe('₺635,98');
    expect(detay.textContent).toContain('Bildirim e-postası gönderildi');
  });

  it('çözülemeyen müşteri saati \'—\'; okunamayan adet \'—\'; «tedarik edilecek» işareti', () => {
    ciz([talep({ istemciTarihi: null, kalemler: [kalem({ adet: NaN, tedarik: true })] })]);
    const detay = detayAc();
    expect(within(detay).getByText('Müşteri cihazının saati').nextElementSibling?.textContent).toBe('—');
    const hucreler = within(within(detay).getAllByRole('row')[1]).getAllByRole('cell');
    expect(hucreler[3].textContent).toBe('—');
    expect(hucreler[1].textContent).toBe('İç cephe boyasıtedarik edilecek');
  });

  it('`kirpildi` doğruysa «bazı alanlar uzunluk sınırında kırpıldı» notu; değilse not YOK', () => {
    const { unmount } = ciz([talep({ kirpildi: true })]);
    expect(within(detayAc()).getByRole('note').textContent).toMatch(/^Bazı alanlar uzunluk sınırında kırpıldı/);
    unmount();
    ciz([talep()]);
    expect(within(detayAc()).queryByRole('note')).toBeNull();
  });

  it('SALT OKUNUR: detay açıkken de bileşendeki tek düğmeler satır düğmeleridir; giriş alanı yok', () => {
    const { container } = ciz([talep(), talep()]);
    detayAc(0);
    expect(satirlar()).toHaveLength(2);
    for (const s of satirlar()) expect(s.hasAttribute('aria-expanded')).toBe(true);
    expect(container.querySelector('input, select, textarea, form')).toBeNull();
  });
});

// ── Tutarlar ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — tutarlar müşterinin beyanıdır', () => {
  it('kalemde `talepFiyat === null` → «fiyat sorulacak» (₺0,00 ya da \'—\' DEĞİL); meşru 0 fiyat ₺0,00', () => {
    ciz([talep({ kalemler: [kalem({ talepFiyat: null }), kalem({ id: 'u2', talepFiyat: 0 })], fiyatiSorulacakVar: true })]);
    const satir = within(detayAc()).getAllByRole('row');
    expect(within(satir[1]).getAllByRole('cell')[4].textContent).toBe('fiyat sorulacak');
    expect(within(satir[2]).getAllByRole('cell')[4].textContent).toBe('₺0,00');
  });

  it('kısmi toplam: fiyatı sorulacak kalem varken toplam TEK BAŞINA basılmaz — listede ve detayda «eksik — N kalemin fiyatı sorulacak»', () => {
    ciz([talep({
      kalemler: [kalem(), kalem({ id: 'u2', talepFiyat: null }), kalem({ id: 'u3', talepFiyat: null })],
      talepEdilen: { araToplam: 409.98, kdv: 82, toplam: 491.98 },
      fiyatiSorulacakVar: true,
    })]);
    const hucre = within(satirlar()[0]).getByText('Talep edilen toplam').parentElement;
    expect(hucre?.textContent).toBe('Talep edilen toplam₺491,98eksik — 2 kalemin fiyatı sorulacak');
    expect(within(detayAc()).getByText('Toplam').nextElementSibling?.textContent).toBe('₺491,98eksik — 2 kalemin fiyatı sorulacak');
  });

  it('sunucu işareti YANLIŞ ama fiyatsız kalem VAR (eski / bozuk doküman) → not yine yazılır', () => {
    ciz([talep({ kalemler: [kalem({ talepFiyat: null })], fiyatiSorulacakVar: false })]);
    expect(satirlar()[0].textContent).toContain('eksik — 1 kalemin fiyatı sorulacak');
  });

  it('sunucu işareti DOĞRU ama fiyatsız kalem okunamıyor → sayı UYDURULMAZ («eksik — fiyatı sorulacak kalem var»)', () => {
    ciz([talep({ fiyatiSorulacakVar: true })]);
    expect(satirlar()[0].textContent).toContain('eksik — fiyatı sorulacak kalem var');
    expect(satirlar()[0].textContent).not.toMatch(/eksik — \d/);
  });

  it('fiyatların tamamı biliniyorsa «eksik» notu YOK', () => {
    ciz([talep()]);
    expect(satirlar()[0].textContent).not.toContain('eksik');
    expect(detayAc().textContent).not.toContain('eksik');
  });

  it('talep edilen tutar yoksa (null) \'—\' — ₺0,00 DEĞİL', () => {
    ciz([talep({ talepEdilen: { araToplam: null, kdv: null, toplam: null } })]);
    expect(within(satirlar()[0]).getByText('Talep edilen toplam').nextElementSibling?.textContent).toBe('—');
    const detay = detayAc();
    for (const etiket of ['Ara toplam', 'KDV', 'Toplam']) expect(within(detay).getByText(etiket).nextElementSibling?.textContent).toBe('—');
    expect(detay.textContent).not.toContain('₺0,00');
  });

  it('ekran kalemlerden toplam TÜRETMEZ: beyan yokken adet × fiyat toplamı da satır tutarı da BASILMAZ', () => {
    ciz([talep({
      kalemler: [kalem({ adet: 2, talepFiyat: 100 }), kalem({ id: 'u2', adet: 3, talepFiyat: 50 })],
      talepEdilen: { araToplam: null, kdv: null, toplam: null },
    })]);
    const metin = `${satirlar()[0].textContent}${detayAc().textContent}`;
    expect(metin).toContain('₺100,00');
    expect(metin).toContain('₺50,00');
    for (const turetilmis of ['₺350,00', '₺200,00', '₺150,00', '₺420,00', '₺70,00']) expect(metin, turetilmis).not.toContain(turetilmis);
  });

  it('saf kurallar: fiyatsız kalem sayısı ve «toplam eksik mi»', () => {
    expect(fiyatiSorulacakKalemSayisi({ kalemler: [kalem(), kalem({ talepFiyat: null }), kalem({ talepFiyat: 0 })] })).toBe(1);
    expect(toplamEksikMi({ kalemler: [kalem()], fiyatiSorulacakVar: false })).toBe(false);
    expect(toplamEksikMi({ kalemler: [kalem()], fiyatiSorulacakVar: true })).toBe(true);
    expect(toplamEksikMi({ kalemler: [kalem({ talepFiyat: null })], fiyatiSorulacakVar: false })).toBe(true);
    expect(toplamEksikMi({ kalemler: [kalem({ talepFiyat: 0 })], fiyatiSorulacakVar: false })).toBe(false);   // 0 bilinen fiyattır
  });
});

// ── Bildirim durumu ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — bildirim durumu', () => {
  const rozet = (satir: HTMLElement) => within(satir).queryByText('Bildirim')?.nextElementSibling ?? null;

  it('`gonderilemedi` ve `yapilandirilmamis` → «bildirim gönderilmedi» uyarı rozeti (kırmızı)', () => {
    ciz([
      talep({ olusturma: once(1), bildirim: { durum: 'gonderilemedi', zaman: once(1), deneme: 8, hataSinifi: 'kimlik' } }),
      talep({ olusturma: once(2), bildirim: { durum: 'yapilandirilmamis', zaman: once(2) } }),
    ]);
    for (const s of satirlar()) {
      const r = rozet(s);
      expect(r?.textContent).toBe('bildirim gönderilmedi');
      expect(r?.className).toContain('bg-red-50 text-red-700');
    }
  });

  it('10 dakikadan ESKİ `bekliyor` → «bildirim gönderilmedi» (sarı); TAZE `bekliyor` → «gönderiliyor» (uyarı değil)', () => {
    ciz([
      talep({ olusturma: once(2), bildirim: { durum: 'bekliyor', zaman: once(2) } }),
      talep({ olusturma: once(11), bildirim: { durum: 'bekliyor', zaman: once(11) } }),
    ]);
    const taze = rozet(satirlar()[0]), eski = rozet(satirlar()[1]);
    expect(taze?.textContent).toBe('gönderiliyor');
    expect(taze?.className).not.toMatch(/bg-(red|yellow)-50/);
    expect(eski?.textContent).toBe('bildirim gönderilmedi');
    expect(eski?.className).toContain('bg-yellow-50 text-yellow-700');
  });

  it('`gitti` İŞARETSİZ: rozet de «Bildirim» etiketi de çizilmez', () => {
    ciz([talep({ bildirim: { durum: 'gitti', zaman: once(1) } })]);
    expect(within(satirlar()[0]).queryByText('Bildirim')).toBeNull();
    expect(satirlar()[0].textContent).not.toMatch(/gönderilmedi|gönderiliyor/);
  });

  it('okunamayan bildirim durumu «gitti» sayılmaz: «bildirim durumu okunamadı»', () => {
    ciz([talep({ bildirim: null })]);
    expect(rozet(satirlar()[0])?.textContent).toBe('bildirim durumu okunamadı');
  });

  it('detay: neden açık yazılır; deneme sayısı ve hata SINIFI (metni değil) gösterilir', () => {
    ciz([talep({ olusturma: once(90), bildirim: { durum: 'gonderilemedi', zaman: once(20), deneme: 8, hataSinifi: 'alici-reddi' } })]);
    const detay = detayAc();
    expect(detay.textContent).toContain('Bildirim e-postası gönderilemedi — denemeler tükendi. Bu talep için e-posta gitmedi.');
    expect(detay.textContent).toContain('Başarısız deneme: 8.');
    expect(detay.textContent).toContain('Hata sınıfı: alıcı reddi.');
  });

  it('veri DEĞİŞMEDEN de (işçi durmuş) taze «gönderiliyor» eşik geçince «bildirim gönderilmedi»ye döner', () => {
    ciz([talep({ olusturma: once(9), bildirim: { durum: 'bekliyor', zaman: once(9) } })]);
    expect(rozet(satirlar()[0])?.textContent).toBe('gönderiliyor');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(rozet(satirlar()[0])?.textContent).toBe('gönderiliyor');          // 9,5 dk — henüz değil
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(rozet(satirlar()[0])?.textContent).toBe('bildirim gönderilmedi');  // 10,5 dk
  });

  describe('saf kural — bildirimGorunumu', () => {
    const b = (durum: 'bekliyor' | 'gitti' | 'gonderilemedi' | 'yapilandirilmamis', zaman: string) => ({ durum, zaman });
    it('sınır: tam 10 dakika hâlâ taze; 1 ms sonrası uyarı', () => {
      const t = { olusturma: once(0), bildirim: b('bekliyor', once(0)) };
      expect(bildirimGorunumu(t, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS)).toEqual({ tur: 'gonderiliyor' });
      expect(bildirimGorunumu(t, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
    });
    it('bekleme KAYIT saatinden ölçülür: 40 dakikalık talep son denemesi 1 dakika önce olsa da «gönderiliyor» DEĞİL', () => {
      expect(bildirimGorunumu({ olusturma: once(40), bildirim: b('bekliyor', once(1)) }, SIMDI)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
    });
    it('süresi ölçülemeyen «bekliyor» TAZE sayılmaz; kayıt saati okunamıyorsa bildirim saatine bakılır', () => {
      expect(bildirimGorunumu({ olusturma: 'bozuk', bildirim: b('bekliyor', '') }, SIMDI)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
      expect(bildirimGorunumu({ olusturma: 'bozuk', bildirim: b('bekliyor', once(3)) }, SIMDI)).toEqual({ tur: 'gonderiliyor' });
      expect(bildirimGorunumu({ olusturma: once(3), bildirim: b('bekliyor', '') }, SIMDI)).toEqual({ tur: 'gonderiliyor' });
    });
    it('kesin durumlar saate bakmaz', () => {
      expect(bildirimGorunumu({ olusturma: once(900), bildirim: b('gitti', once(899)) }, SIMDI)).toEqual({ tur: 'isaretsiz' });
      expect(bildirimGorunumu({ olusturma: once(0), bildirim: b('gonderilemedi', once(0)) }, SIMDI)).toEqual({ tur: 'uyari', neden: 'gonderilemedi' });
      expect(bildirimGorunumu({ olusturma: once(0), bildirim: b('yapilandirilmamis', once(0)) }, SIMDI)).toEqual({ tur: 'uyari', neden: 'yapilandirilmamis' });
      expect(bildirimGorunumu({ olusturma: once(0), bildirim: null }, SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    });
    it('sonraki eşik: yalnız «gönderiliyor» görünenlerin EN YAKIN eşiği; yoksa null', () => {
      const taze3 = { olusturma: once(3), bildirim: b('bekliyor', once(3)) };
      const taze7 = { olusturma: once(7), bildirim: b('bekliyor', once(7)) };
      const eski = { olusturma: once(30), bildirim: b('bekliyor', once(30)) };
      const gitti = { olusturma: once(1), bildirim: b('gitti', once(1)) };
      expect(sonrakiBeklemeEsigi([taze3, eski, taze7, gitti], SIMDI)).toBe(SIMDI - 7 * 60_000 + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS);
      expect(sonrakiBeklemeEsigi([eski, gitti], SIMDI)).toBeNull();
      expect(sonrakiBeklemeEsigi([], SIMDI)).toBeNull();
    });
  });
});

// ── 200 sınırı ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — ekran sınırı', () => {
  const cok = (n: number) => Array.from({ length: n }, (_, i) => talep({ talepNo: `T261008-${String(i).padStart(4, '0')}`, olusturma: once(i + 1) }));

  it('sınır 200', () => { expect(MAGAZA_TALEP_EKRAN_SINIRI).toBe(200); });

  it('205 talepten EN YENİ 200\'ü çizilir; kalan «daha eski 5 talep» diye SAYILIR (sessiz kırpma yok)', () => {
    ciz([...cok(205)].reverse());   // akış sırası rastgeledir: en eski önce verildi
    expect(satirlar()).toHaveLength(200);
    expect(satirlar()[0].textContent).toContain('T261008-0000');     // en yeni
    expect(satirlar()[199].textContent).toContain('T261008-0199');
    expect(screen.queryByText(/T261008-0200/)).toBeNull();
    expect(screen.getByText('En yeni 200 talep gösteriliyor — daha eski 5 talep bu listede çizilmedi.')).toBeTruthy();
    // Başlıktaki sayı çizilen değil TOPLAM talep sayısıdır.
    expect(screen.getByRole('heading', { name: /Mağaza Talepleri\s*205/ })).toBeTruthy();
  });

  it('tam 200 talepte «daha eski» notu YOK', () => {
    ciz(cok(200));
    expect(satirlar()).toHaveLength(200);
    expect(screen.queryByText(/daha eski/)).toBeNull();
  });

  it('tarihi okunamayan talep «en yeni 200»e SAYILMAZ ve «daha eski» diye sayılmaz', () => {
    const g = magazaTalepGorunumu([...cok(201), talep({ talepNo: 'T261008-BOZK', olusturma: '' })]);
    expect(g.gorunen).toHaveLength(201);                                 // 200 tarihli + 1 tarihsiz
    expect(g.gorunen[200].talepNo).toBe('T261008-BOZK');
    expect(g.dahaEski).toBe(1);
    expect(g.gizliTarihsiz).toBe(0);
  });

  it('saf kural: eşit saatte sıra kimlikle SABİT; küçük sınırda sayım', () => {
    const a = talep({ id: 'mt-b', olusturma: once(5) }), b = talep({ id: 'mt-a', olusturma: once(5) }), c = talep({ id: 'mt-c', olusturma: once(1) });
    expect(magazaTalepGorunumu([a, b, c]).gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-a', 'mt-b']);
    expect(magazaTalepGorunumu([b, c, a]).gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-a', 'mt-b']);
    const g = magazaTalepGorunumu([a, b, c, talep({ id: 'mt-x', olusturma: '' }), talep({ id: 'mt-y', olusturma: 'bozuk' })], 1);
    expect(g.gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-x']);
    expect(g.dahaEski).toBe(2);
    expect(g.gizliTarihsiz).toBe(1);
  });
});

// ── Müşteri metni güvenilmezdir ─────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — müşterinin yazdığı metin', () => {
  it('HTML olarak YORUMLANMAZ: etiket metin olarak basılır, öğe oluşmaz', () => {
    const zehir = '<img src=x onerror=alert(1)><script>alert(2)</script><a href="https://kotu.example">tıkla</a>';
    const { container } = ciz([talep({
      talepNo: zehir,
      musteri: { ad: zehir, firma: zehir, telefon: zehir, eposta: zehir, il: zehir, adres: zehir, vergi: zehir },
      not: zehir,
      kalemler: [kalem({ sku: zehir, ad: zehir, marka: zehir })],
    })]);
    detayAc();
    expect(container.querySelector('img, script, a, iframe')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('telefon / e-posta yalnız DOĞRULANMIŞ değerle bağlantı olur; sayfadaki her bağlantı `tel:` ya da `mailto:`', () => {
    const { container } = ciz([talep({ musteri: { ad: 'A', firma: '', telefon: '+90 (532) 111-22.33', eposta: 'satin.alma+boya@ornek-insaat.com.tr', il: '', adres: '', vergi: '' } })]);
    detayAc();
    const baglantilar = [...container.querySelectorAll('a')];
    expect(baglantilar.map(a => a.getAttribute('href'))).toEqual(['tel:+905321112233', 'mailto:satin.alma+boya@ornek-insaat.com.tr']);
    expect(baglantilar.map(a => a.textContent)).toEqual(['+90 (532) 111-22.33', 'satin.alma+boya@ornek-insaat.com.tr']);
    for (const a of baglantilar) expect(a.hasAttribute('target')).toBe(false);
  });

  it('doğrulanamayan telefon / e-posta bağlantı OLMAZ — düz metin basılır', () => {
    const { container } = ciz([talep({ musteri: { ad: 'A', firma: '', telefon: 'javascript:alert(1)', eposta: 'a@b.com?bcc=sizinti@kotu.example', il: '', adres: '', vergi: '' } })]);
    const detay = detayAc();
    expect(container.querySelector('a')).toBeNull();
    expect(within(detay).getByText('Telefon').nextElementSibling?.textContent).toBe('javascript:alert(1)');
    expect(within(detay).getByText('E-posta').nextElementSibling?.textContent).toBe('a@b.com?bcc=sizinti@kotu.example');
  });

  it('saf kurallar: tel / mailto süzgeçleri', () => {
    expect(telBaglantisi('0532 111 22 33')).toBe('tel:05321112233');
    expect(telBaglantisi('+90 (532) 111-22.33')).toBe('tel:+905321112233');
    for (const kotu of ['', '532', 'javascript:alert(1)', '0532 111 22 33;ext=1', '05321112233,,,1234#', '0532 111 22 3x', '+', '12345678901234567', 'tel:05321112233']) {
      expect(telBaglantisi(kotu), kotu).toBeNull();
    }
    expect(epostaBaglantisi('sukru@ornek.com.tr')).toBe('mailto:sukru@ornek.com.tr');
    for (const kotu of ['', 'sukru', 'sukru@', '@ornek.com', 'sukru@ornek', 'a@b.com?subject=x', 'a@b.com&bcc=c@d.com', 'a b@c.com', 'a@b.com\nbcc:c@d.com',
      'a@b.com,c@d.com', 'a%40b@c.com', 'şükrü@ornek.com', 'mailto:a@b.com', `${'a'.repeat(250)}@b.com`]) {
      expect(epostaBaglantisi(kotu), kotu).toBeNull();
    }
  });
});

// ── «Yeni» rozeti ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaYeniRozeti — sekme düğmesindeki «yeni» sayacı', () => {
  it('sayı ve `aria-label` («3 yeni talep»); düğmenin erişilebilir adına katılır', () => {
    render(<button type="button">Mağaza Talepleri <MagazaYeniRozeti sayi={3} currentLanguage="tr" /></button>);
    const rozet = screen.getByLabelText('3 yeni talep');
    expect(rozet.textContent).toBe('3');
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 3 yeni talep' })).toBeTruthy();
  });

  it('sayı 0 ise HİÇBİR ŞEY çizilmez; İngilizce tekil / çoğul', () => {
    const { container, rerender } = render(<MagazaYeniRozeti sayi={0} currentLanguage="tr" />);
    expect(container.firstChild).toBeNull();
    rerender(<MagazaYeniRozeti sayi={1} currentLanguage="en" />);
    expect(screen.getByLabelText('1 new request')).toBeTruthy();
    rerender(<MagazaYeniRozeti sayi={2} currentLanguage="en" />);
    expect(screen.getByLabelText('2 new requests')).toBeTruthy();
  });

  // OrdersPage'deki bağlantının küçük kopyası: sayı kancadan (useMagazaYeniSayaci), rozet düğmenin içinde.
  function SekmeDugmesi({ talepler, acik }: { talepler: MagazaTalepSatiri[]; acik: boolean }) {
    const sayi = useMagazaYeniSayaci(talepler, 'cetpa:magazaTalepSonGorulen:kiraci-1:uid-7', acik);
    return <button type="button">Mağaza Talepleri <MagazaYeniRozeti sayi={sayi} currentLanguage="tr" /></button>;
  }

  it('uçtan uca: görülmemiş talepler sayılır → sekme açılınca rozet kalkar → çıkınca yalnız SONRA gelen sayılır', () => {
    const iki = [talep({ olusturma: once(30) }), talep({ olusturma: once(20) })];
    const { rerender } = render(<SekmeDugmesi talepler={iki} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 2 yeni talep' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={iki} acik />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={iki} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={[...iki, talep({ olusturma: once(1) })]} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 1 yeni talep' })).toBeTruthy();
  });
});

// ── Kaynak çiti (yorumlar süzülür) ──────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri.tsx — kaynak çiti', () => {
  const kod = yorumsuz('MagazaTalepleri.tsx', readFileSync(join(__dirname, 'MagazaTalepleri.tsx'), 'utf-8')).join('\n');

  it('kaynak okunuyor (çit boş metne bakmasın)', () => { expect(kod.length).toBeGreaterThan(5000); });

  it('ham HTML basılmaz; ekrana basılan metin `toUpperCase()` ile büyütülmez; satır içi stil yok', () => {
    expect(kod).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(kod).not.toMatch(/toUpperCase\(|toLocaleUpperCase\(/);
    expect(kod).not.toMatch(/\bstyle=/);
  });

  it('bileşen kendi aboneliğini AÇMAZ ve koleksiyona YAZMAZ (veri OrdersPage\'deki kancadan gelir)', () => {
    expect(kod).not.toMatch(/dbClient|onSnapshot|setDoc|updateDoc|addDoc|deleteDoc|authFetch|fetch\(/);
  });

  it('bağlantı yalnız `tel:` / `mailto:` üreten iki süzgeçten gelir', () => {
    expect((kod.match(/<a /g) ?? [])).toHaveLength(2);
    expect(kod).toMatch(/<a href=\{tel\} /);
    expect(kod).toMatch(/<a href=\{eposta\} /);
    expect(kod).not.toMatch(/https?:\/\//);
  });

  it('sayısal alanda `?? 0` / `|| 0` yok; global `isFinite` yok', () => {
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/(^|[^.\w])isFinite\(/);
  });
});
