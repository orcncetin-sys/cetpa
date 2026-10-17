/**
 * MagazaTalepDuzenle.test.tsx — mağaza talebinin İÇERİK formu, GERÇEK çizimle (dilim 2b, şartname v6 § 10.4 / § 10.8 «İstemci»).
 * Formun saf kuralları `lib/magazaTalepFormu.test.ts`'te; formun detaydan / liste başından gerçekten açıldığı
 * `MagazaTalepleri.test.tsx`'te. Burada formun KENDİ davranışı kilitlenir.
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   - form İSTEK ATMAZ: gövdeyi üretir, `onKaydet` niteliğine verir; alan hatasında nitelik ÇAĞRILMAZ;
 *   - müşterinin BEYANI kopyalanır — `talep` niteliği değişmez; gövdede `kalemler` / `talepEdilen` / `kdvKaynagi` anahtarı yok;
 *   - teyidi OLMAYAN talepte form beyan kopyasıyla açılır (§ 10.4) ve bunun TEYİT yazacağını kaydetmeden önce söyler; bütün
 *     kalemler kaldırılırsa gövdede `teyit` yoktur;
 *   - `12,5` / `abc` adet alan hatasıdır (null'a çevrilip gönderilmez); boş fiyat `null` («fiyat sorulacak»);
 *   - KURUŞ (kullanıcı kararı 2026-10-17, B2): üçüncü ondalık açık alan hatasıdır («Birim fiyat en çok iki ondalık olabilir
 *     (kuruş).» — sunucu şemasıyla AYNI sabit), `onKaydet` çağrılmaz, kutu yuvarlanmaz; «95,50» ve boş → `null` bozulmaz;
 *     iki kipte de (düzenle, elle talep) ve beyandan kopyalanan satırda da;
 *   - form HER ZAMAN tam gövde gönderir (değişmeyen bölüm de); «değişiklik yok» yanıtında form açık kalır;
 *   - EKRAN SIRASI (V19): fiyat alanları ve «Ara toplam (KDV hariç)» KDV seçicilerinden ÖNCE; «KDV» ve «Genel toplam» SONRA;
 *   - canlı önizleme: fiyat değişince ara toplam, oran değişince KDV ve genel toplam; boş fiyatta üçü de «fiyat sorulacak»;
 *   - KDV varsayılanı `urunKdvOrani` niteliğinden (tam kalem stok koduyla çağrılır); `varsayilan` kaynakta «varsayılan» imi;
 *     personel seçince — ya da doğru olan «varsayılan» oranı «oranı onayla» ile ONAYLAYINCA — im kalkar ve gövdeye `kdvOrani`
 *     girer, dokunmadıysa gövdede `kdvOrani` YOK;
 *   - mevcut teyit kaleminin oranı KAYITLI oran ve kaynaktır: ürün kaydı arada değişse de ekranda görülen oran ve toplam
 *     kaydedilecek olandır (sunucu aynı kuralla korur). Ürün kaydı ÖNİZLEME için sorulmaz; kayıtlı `varsayilan` satırda yalnız
 *     BİLGİ için okunur («ürün kaydı şimdi %N», tek tıkla seçilebilir) — dokunulmadıkça önizleme de gövde de değişmez;
 *   - «oranı onayla» ve «ürün kaydının oranını seç» tıklanınca DOM'dan kalkar: odak aynı satırın oran seçicisine geçer;
 *   - kalem anahtarı: beyandan kopya `b:<dizin>`, mevcut teyit `t:…`, yeni kalem anahtarsız; kaldırılan satırın anahtarı yok;
 *   - PARA ÖRNEĞİ: 2 × 95,00 + 1 × 40,00, %20 → 230,00 / 46,00 / 276,00.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MagazaTalepDuzenle, { type MagazaFormSonucu } from './MagazaTalepDuzenle';
import type { MagazaElleTalepGirdisi, MagazaIcerikGirdisi } from '../../lib/magazaTalepFormu';
import type { MagazaTalepKalemi, MagazaTeyit, MagazaTeyitKalemi } from '../../lib/magazaTalep';
import type { MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';
import { ErpIcerikGovdesi, ErpElleTalepGovdesi } from '../../server/schemas';
import { yorumsuz } from '../../test/degismezTarayici';

const kalem = (ek: Partial<MagazaTalepKalemi> = {}): MagazaTalepKalemi =>
  ({ id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false, ...ek });
const teyitKalemi = (ek: Partial<MagazaTeyitKalemi> = {}): MagazaTeyitKalemi =>
  ({ anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false, ...ek });
/** Para örneğinin teyidi: 2 × 95,00 + 1 × 40,00, %20. */
const teyit = (kalemler: MagazaTeyitKalemi[] = [teyitKalemi(), teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40 })]): MagazaTeyit =>
  ({ kalemler, araToplam: 230, kdv: 46, toplam: 276, zaman: '2026-10-08T11:40:00.000Z', kim: { uid: 'u-mehmet', ad: 'Mehmet Öztürk' } });

const talep = (ek: Partial<MagazaTalepSatiri> = {}): MagazaTalepSatiri => ({
  id: 'mt-0001',
  companyId: 'kiraci-1',
  talepNo: 'T261008-5Y9P',
  durum: 'yeni',
  olusturma: '2026-10-08T11:00:00.000Z',
  istemciTarihi: null,
  musteri: { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İzmir', adres: 'Işıklar Cad. No: 5', vergi: '1234567890' },
  telefonSon10: '5321112233',
  not: 'Öğleden sonra arayın',
  kalemler: [kalem(), kalem({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: 120 })],
  talepEdilen: { araToplam: 529.98, kdv: 106, toplam: 635.98 },
  fiyatiSorulacakVar: false,
  bildirim: { durum: 'gitti', zaman: '2026-10-08T11:01:00.000Z' },
  durumAciklama: '',
  durumSurum: 0,
  iptalOncesi: null,
  durumGecmisi: [],
  kalemTeslim: {},
  etiketBasildi: null,
  teyit: null,
  icerikSurum: 0,
  silindi: null,
  elle: null,
  bildirimRevize: null,
  ...ek,
});

const icerikKaydet = vi.fn<(g: MagazaIcerikGirdisi) => Promise<MagazaFormSonucu>>();
const elleKaydet = vi.fn<(g: MagazaElleTalepGirdisi) => Promise<MagazaFormSonucu>>();
const vazgec = vi.fn<() => void>();
const urunKdv = vi.fn<(sku: string) => number | undefined>();

beforeEach(() => {
  icerikKaydet.mockReset().mockResolvedValue({ tamam: true });
  elleKaydet.mockReset().mockResolvedValue({ tamam: true });
  vazgec.mockReset();
  urunKdv.mockReset().mockReturnValue(undefined);
});

const duzenle = (t: MagazaTalepSatiri, dil: 'tr' | 'en' = 'tr') =>
  render(<MagazaTalepDuzenle kip="duzenle" talep={t} dil={dil} urunKdvOrani={urunKdv} onKaydet={icerikKaydet} onVazgec={vazgec} />);
const yeni = (dil: 'tr' | 'en' = 'tr') => render(<MagazaTalepDuzenle kip="yeni" dil={dil} onKaydet={elleKaydet} onVazgec={vazgec} />);

const tikla = async (oge: HTMLElement): Promise<void> => { await act(async () => { fireEvent.click(oge); }); };
const yaz = (oge: HTMLElement, deger: string): void => { fireEvent.change(oge, { target: { value: deger } }); };
const dugme = (ad: string | RegExp): HTMLButtonElement => screen.getByRole('button', { name: ad }) as HTMLButtonElement;
const kutu = (ad: string): HTMLInputElement => screen.getByLabelText(ad) as HTMLInputElement;
const kdvSecici = (ad: string): HTMLSelectElement => screen.getByLabelText(`KDV oranı: ${ad}`) as HTMLSelectElement;
const cikti = (ad: string): string | null => screen.getByRole('status', { name: ad }).textContent;
const kaydet = (): Promise<void> => tikla(dugme('İçeriği kaydet'));
const sonGovde = (): MagazaIcerikGirdisi => {
  const cagri = icerikKaydet.mock.calls[icerikKaydet.mock.calls.length - 1];
  if (cagri === undefined) throw new Error('onKaydet çağrılmadı');
  return cagri[0];
};
/** `a` belgede `b`'den ÖNCE mi. */
const once = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
function dondur<T>(v: T): T {
  if (v !== null && typeof v === 'object') { for (const ic of Object.values(v)) dondur(ic); Object.freeze(v); }
  return v;
}

// ── Düzenleme: müşteri bilgileri ve not ─────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle — düzenleme: müşteri bilgileri ve not', () => {
  it('form saklanan içerikle açılır: YEDİ müşteri alanı + not; takip telefonunun DEĞİŞMEYECEĞİ yazılır', () => {
    duzenle(talep());
    expect(screen.getByRole('group', { name: 'İçeriği düzenle — T261008-5Y9P' })).toBeTruthy();
    expect(kutu('Müşteri adı (zorunlu)').value).toBe('Şükrü Çağlayan');
    expect(kutu('Firma').value).toBe('Çağlayan İnşaat');
    expect(kutu('Telefon (zorunlu, en az 10 rakam)').value).toBe('0532 111 22 33');
    expect(kutu('E-posta').value).toBe('sukru@ornek.com.tr');
    expect(kutu('İl').value).toBe('İzmir');
    expect(kutu('Adres').value).toBe('Işıklar Cad. No: 5');
    expect(kutu('Vergi No').value).toBe('1234567890');
    expect(kutu('Müşteri notu').value).toBe('Öğleden sonra arayın');
    expect(screen.getByText('Takip telefonu değişmez: müşteri ilk numarayla sorgular (son 10 hane 5321112233).')).toBeTruthy();
    // Müşterinin ilk talebinin değişmeyeceği ve revize bildirimi gideceği formun başında yazılıdır.
    expect(screen.getByText(/Müşterinin ilk talebi \(sitede görülen kalemler ve tutarlar\) DEĞİŞMEZ/)).toBeTruthy();
    expect(screen.getByText(/personele revize bildirimi e-postası gider/)).toBeTruthy();
  });

  it('hiçbir şey değiştirilmeden «Kaydet»: TAM gövde yine gider — müşteri, not VE teyit (değişen bölümü form seçmez; «ne değişti» sunucuda)', async () => {
    const t = talep({ icerikSurum: 6, teyit: teyit() });
    duzenle(t);
    await kaydet();
    expect(icerikKaydet).toHaveBeenCalledTimes(1);
    expect(sonGovde()).toEqual({
      icerikSurum: 6, musteri: t.musteri, not: 'Öğleden sonra arayın',
      teyit: { kalemler: [
        { anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, tedarik: false },
        { anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, tedarik: false },
      ] },
    });
    expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
  });

  it('`degisiklik-yok` yanıtında «Değişiklik yok» uyarısı; form AÇIK ve içerik yerinde; `tamam` yanıtında ileti yok', async () => {
    icerikKaydet.mockResolvedValue({ tamam: false, kod: 'degisiklik-yok' });
    duzenle(talep());
    yaz(kutu('Müşteri notu'), 'aynı içerik');
    await kaydet();
    expect(screen.getByRole('alert').textContent).toBe('Değişiklik yok — kayıtlı içerikle aynı; hiçbir şey yazılmadı.');
    expect(kutu('Müşteri notu').value).toBe('aynı içerik');
    expect(dugme('İçeriği kaydet').disabled).toBe(false);

    icerikKaydet.mockResolvedValue({ tamam: true });
    await kaydet();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('müşteri adı boş / telefonda 9 rakam → alan hatası, `onKaydet` ÇAĞRILMAZ; düzeltilince gider', async () => {
    duzenle(talep());
    yaz(kutu('Müşteri adı (zorunlu)'), '   ');
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '532 111 22 3');
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Müşteri adı boş olamaz.')).toBeTruthy();
    expect(screen.getByText('Telefonda en az 10 rakam olmalı (takip sayfası talebi bu numarayla bulur).')).toBeTruthy();
    expect(screen.getByText('Kaydedilmedi — işaretli alanları düzeltin.')).toBeTruthy();
    expect(kutu('Müşteri adı (zorunlu)').getAttribute('aria-invalid')).toBe('true');

    yaz(kutu('Müşteri adı (zorunlu)'), 'Şükrü Çağlayan');
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0 532 111 22 34');
    await kaydet();
    expect(icerikKaydet).toHaveBeenCalledTimes(1);
    expect(sonGovde().musteri?.telefon).toBe('0 532 111 22 34');
    expect(screen.queryByText('Kaydedilmedi — işaretli alanları düzeltin.')).toBeNull();
  });

  it('istek sürerken alanlar ve düğmeler pasif; ikinci tıklama ikinci çağrı ÜRETMEZ; nitelik fırlatırsa «bağlantı hatası»', async () => {
    let coz: (s: MagazaFormSonucu) => void = () => {};
    icerikKaydet.mockReturnValue(new Promise<MagazaFormSonucu>(r => { coz = r; }));
    duzenle(talep());
    await kaydet();
    expect(dugme('İçeriği kaydet').disabled).toBe(true);
    expect(dugme('Vazgeç').disabled).toBe(true);
    expect(kutu('Müşteri adı (zorunlu)').disabled).toBe(true);
    await kaydet();
    expect(icerikKaydet).toHaveBeenCalledTimes(1);
    await act(async () => { coz({ tamam: false, kod: 'ag' }); });
    expect(dugme('İçeriği kaydet').disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Bağlantı hatası, yeniden deneyin.');

    icerikKaydet.mockRejectedValue(new Error('ağ koptu'));
    await kaydet();
    expect(screen.getByRole('alert').textContent).toBe('Bağlantı hatası, yeniden deneyin.');
    expect(dugme('İçeriği kaydet').disabled).toBe(false);
  });

  it('AYNI çizimde art arda iki tıklama (düğme henüz pasif çizilmeden) da TEK çağrı üretir', async () => {
    duzenle(talep());
    const b = dugme('İçeriği kaydet');
    // İki olay tek `act` içinde: ikinci tıklama geldiğinde düğmenin `disabled` niteliği henüz DOM'a yansımamıştır.
    await act(async () => { fireEvent.click(b); fireEvent.click(b); });
    expect(icerikKaydet).toHaveBeenCalledTimes(1);
  });

  it('«Vazgeç» niteliği çağırır, istek üretmez', async () => {
    duzenle(talep());
    await tikla(dugme('Vazgeç'));
    expect(vazgec).toHaveBeenCalledTimes(1);
    expect(icerikKaydet).not.toHaveBeenCalled();
  });
});

// ── Düzenleme: teyit kalemleri ──────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle — teyit edilen kalemler', () => {
  const TEYITSIZ_NOTU = 'Bu talep henüz teyit edilmedi — form müşteri beyanının kopyasıyla açılır. Kaydedince aşağıdaki adet ve fiyatlar «Teyit edilen» olarak yazılır. Yalnız müşteri bilgisini ya da notu düzeltecekseniz önce bütün kalemleri kaldırın: bu bölüm boş kaydedilirse teyit yazılmaz.';

  it('teyidi OLMAYAN talepte form müşteri beyanının KOPYASIYLA açılır (§ 10.4): satırlar, KDV bölümü ve önizleme hazır; «kopyala» düğmesine gerek yok', () => {
    duzenle(talep());
    // Başlık satırı + iki beyan kalemi. Beyan fiyatı (sitede görülen) başlangıç fiyatıdır; adet beyandaki adettir.
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(kutu('Stok kodu: 1. kalem').value).toBe('DYO-0001');
    expect(kutu('Adet: İç cephe boyası').value).toBe('2');
    expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').value).toBe('204,99');
    expect(kutu('Adet: Fırça').value).toBe('1');
    expect(kutu('Birim fiyat (KDV hariç): Fırça').value).toBe('120');
    // Dolu taslağın üstüne beyanı yeniden yazmak personelin girdiğini silerdi: düğme yalnız bölüm BOŞKEN çizilir.
    expect(screen.queryByRole('button', { name: 'Müşteri beyanından kopyala' })).toBeNull();
    expect(screen.queryByText(/^Henüz teyit edilmedi — kalemleri müşteri beyanından kopyalayın/)).toBeNull();
    // KDV bölümü ve canlı önizleme açılışta çizilir: 2 × 204,99 + 1 × 120,00 = 529,98; %20 → 81,996 ≈ 82,00 + 24,00.
    expect([kdvSecici('İç cephe boyası').value, kdvSecici('Fırça').value]).toEqual(['20', '20']);
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺529,98', '₺106,00', '₺635,98']);
  });

  it('teyidi OLMAYAN talepte kaydetmenin TEYİT yazacağı kaydetmeden ÖNCE yazılıdır; teyidi olan talepte bu not YOK', () => {
    const { unmount } = duzenle(talep());
    expect(screen.getByRole('note').textContent).toBe(TEYITSIZ_NOTU);
    unmount();
    duzenle(talep({ teyit: teyit() }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('teyidi OLMAYAN talepte dokunmadan «Kaydet»: TAM gövde — `teyit` beyan kopyasıyla (`b:<dizin>`) gider; `talep` niteliği (beyan) DEĞİŞMEZ', async () => {
    const t = dondur(talep({ icerikSurum: 6 }));
    const beyanKopyasi = JSON.parse(JSON.stringify(t.kalemler)) as unknown;
    duzenle(t);
    await kaydet();
    expect(icerikKaydet).toHaveBeenCalledTimes(1);
    expect(sonGovde()).toEqual({
      icerikSurum: 6, musteri: t.musteri, not: 'Öğleden sonra arayın',
      teyit: { kalemler: [
        { anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false },
        { anahtar: 'b:1', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 120, tedarik: false },
      ] },
    });
    // Dondurulmuş nitelik yazılmadı (yazılsaydı fırlatırdı) ve içeriği aynı.
    expect(t.kalemler).toEqual(beyanKopyasi);
    expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
  });

  it('beyanın KOPYASI düzenlenir: değişen adet / fiyat gövdeye `b:<dizin>` anahtarıyla gider — `talep` niteliği (beyan) DEĞİŞMEZ', async () => {
    const t = dondur(talep());
    const beyanKopyasi = JSON.parse(JSON.stringify(t.kalemler)) as unknown;
    duzenle(t);
    yaz(kutu('Adet: İç cephe boyası'), '5');
    yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '95');
    await kaydet();
    expect(sonGovde().teyit?.kalemler).toEqual([
      { anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 5, birimFiyat: 95, tedarik: false },
      { anahtar: 'b:1', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 120, tedarik: false },
    ]);
    expect(t.kalemler).toEqual(beyanKopyasi);
    expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
  });

  it('fiyatı sorulacak beyan kalemi kopyada BOŞ kutuyla açılır (0 değil): önizleme «fiyat sorulacak», gövdede `birimFiyat: null`', async () => {
    duzenle(talep({ kalemler: [kalem({ talepFiyat: null })], fiyatiSorulacakVar: true }));
    expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').value).toBe('');
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['fiyat sorulacak', 'fiyat sorulacak', 'fiyat sorulacak']);
    await kaydet();
    expect(sonGovde().teyit?.kalemler.map(k => k.birimFiyat)).toEqual([null]);
  });

  it('çıkış yolu — yalnız müşteri bilgisi düzeltilecekse: bütün kalemler kaldırılır, bölüm boş kaydedilir ve gövdede `teyit` YOK; «Müşteri beyanından kopyala» kopyayı geri getirir', async () => {
    duzenle(talep());
    await tikla(dugme('Kalemi kaldır: İç cephe boyası'));
    await tikla(dugme('Kalemi kaldır: Fırça'));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('Henüz teyit edilmedi — kalemleri müşteri beyanından kopyalayın ya da kalem ekleyin. Bu bölüm boş kaydedilirse teyit yazılmaz.')).toBeTruthy();
    // KDV bölümü ve önizleme kalem yokken çizilmez.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0 532 111 22 34');
    await kaydet();
    expect(Object.keys(sonGovde()).sort()).toEqual(['icerikSurum', 'musteri', 'not']);
    expect(sonGovde().musteri?.telefon).toBe('0 532 111 22 34');

    // Vazgeçip teyit etmek isteyen için kopya tek tıkla geri gelir (yine `b:<dizin>` anahtarlarıyla).
    await tikla(dugme('Müşteri beyanından kopyala'));
    expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').value).toBe('204,99');
    expect(screen.queryByRole('button', { name: 'Müşteri beyanından kopyala' })).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(TEYITSIZ_NOTU);
    await kaydet();
    expect(sonGovde().teyit?.kalemler.map(k => k.anahtar)).toEqual(['b:0', 'b:1']);
  });

  it('beyanı BOŞ (bozuk) talepte kopyalanacak satır yoktur: bölüm boş açılır, «kopyala» düğmesi çizilmez; «Kalem ekle» ile başlanır', async () => {
    duzenle(talep({ kalemler: [] }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Müşteri beyanından kopyala' })).toBeNull();
    expect(dugme('Kalem ekle')).toBeTruthy();
    await kaydet();
    expect(Object.keys(sonGovde()).sort()).toEqual(['icerikSurum', 'musteri', 'not']);
  });

  it('gövdede `kalemler` (beyan) / `talepEdilen` / toplam / `kdvKaynagi` anahtarı YOK — önizleme tutarı gövdeye girmez', async () => {
    duzenle(talep({ teyit: teyit() }));
    await kaydet();
    const g = sonGovde();
    expect(Object.keys(g).sort()).toEqual(['icerikSurum', 'musteri', 'not', 'teyit']);
    expect(Object.keys(g.teyit ?? {})).toEqual(['kalemler']);
    expect(JSON.stringify(g)).not.toMatch(/"talepEdilen"|"kdvKaynagi"|"araToplam"|"toplam"|"talepFiyat"|230|276/);
  });

  it('`12,5` ve `abc` adet → alan hatası, istek YOK (null\'a çevrilip gönderilmez); boş adet ayrı metin', async () => {
    duzenle(talep({ teyit: teyit() }));
    yaz(kutu('Adet: İç cephe boyası'), '12,5');
    yaz(kutu('Adet: Fırça'), 'abc');
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getAllByText('Adet sıfırdan büyük tam sayı olmalı (yalnız rakam).')).toHaveLength(2);
    expect(kutu('Adet: İç cephe boyası').getAttribute('aria-invalid')).toBe('true');
    // Yazılan metin kutuda durur (sessizce silinmez / düzeltilmez).
    expect(kutu('Adet: İç cephe boyası').value).toBe('12,5');

    yaz(kutu('Adet: İç cephe boyası'), '');
    yaz(kutu('Adet: Fırça'), '2');
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Adet boş olamaz.')).toBeTruthy();

    yaz(kutu('Adet: İç cephe boyası'), '12');
    await kaydet();
    expect(sonGovde().teyit?.kalemler.map(k => k.adet)).toEqual([12, 2]);
  });

  it('boş fiyat → `birimFiyat: null` («fiyat sorulacak»; 0 DEĞİL); okunamayan / belirsiz fiyat («1.250») alan hatası', async () => {
    duzenle(talep({ teyit: teyit() }));
    yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '');
    yaz(kutu('Birim fiyat (KDV hariç): Fırça'), '1.250');
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Fiyat okunamadı. Binlik ayraç yazmayın; kuruş için virgül kullanın (ör. 1250,50).')).toBeTruthy();
    yaz(kutu('Birim fiyat (KDV hariç): Fırça'), '1250,50');
    await kaydet();
    expect(sonGovde().teyit?.kalemler.map(k => k.birimFiyat)).toEqual([null, 1250.5]);
    expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
  });

  describe('kuruş — birim fiyat en çok iki ondalık (kullanıcı kararı 2026-10-17, B2)', () => {
    const KURUS_HATASI = 'Birim fiyat en çok iki ondalık olabilir (kuruş).';

    it('üçüncü ondalık → AÇIK alan hatası, `onKaydet` ÇAĞRILMAZ, kutu yuvarlanmaz, önizleme tutar basmaz; düzeltilince iki ondalıklı değer gider', async () => {
      duzenle(talep({ teyit: teyit() }));
      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '83,3333');
      expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['—', '—', '—']);
      await kaydet();
      expect(icerikKaydet).not.toHaveBeenCalled();
      expect(screen.getByText(KURUS_HATASI)).toBeTruthy();
      expect(screen.queryByText(/Fiyat okunamadı/)).toBeNull();
      expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').getAttribute('aria-invalid')).toBe('true');
      expect(kutu('Birim fiyat (KDV hariç): Fırça').getAttribute('aria-invalid')).toBe('false');
      expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').value).toBe('83,3333');
      expect(screen.getByText('Kaydedilmedi — işaretli alanları düzeltin.')).toBeTruthy();
      // Art arda tıklama da istek üretmez.
      await kaydet();
      expect(icerikKaydet).not.toHaveBeenCalled();

      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '83,33');
      expect(cikti('Ara toplam (KDV hariç)')).toBe('₺206,66');
      await kaydet();
      expect(icerikKaydet).toHaveBeenCalledTimes(1);
      expect(sonGovde().teyit?.kalemler.map(k => k.birimFiyat)).toEqual([83.33, 40]);
      expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
    });

    it('«95,50» (virgül, sondaki sıfır) 95,5 olarak, boş fiyat `null` olarak gider — kuruş denetimi ikisini de bozmaz', async () => {
      duzenle(talep({ teyit: teyit() }));
      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '95,50');
      yaz(kutu('Birim fiyat (KDV hariç): Fırça'), '');
      await kaydet();
      expect(screen.queryByText(KURUS_HATASI)).toBeNull();
      expect(sonGovde().teyit?.kalemler.map(k => k.birimFiyat)).toEqual([95.5, null]);
      expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
    });

    it('İ1-b — 1 trilyon TL ve üstü («10000000000000») `gecersiz`: okunamayan fiyat metni (kuruş metni DEĞİL), `onKaydet` ÇAĞRILMAZ', async () => {
      duzenle(talep({ teyit: teyit() }));
      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '10000000000000');
      await kaydet();
      expect(icerikKaydet).not.toHaveBeenCalled();
      expect(screen.getByText('Fiyat okunamadı. Binlik ayraç yazmayın; kuruş için virgül kullanın (ör. 1250,50).')).toBeTruthy();
      expect(screen.queryByText(KURUS_HATASI)).toBeNull();
      expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').getAttribute('aria-invalid')).toBe('true');
    });

    it('okunamayan («1.250») ve kuruştan ince («0,001») fiyat AYRI metin alır — ikisi aynı anda, kendi satırında', async () => {
      duzenle(talep({ teyit: teyit() }));
      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '1.250');
      yaz(kutu('Birim fiyat (KDV hariç): Fırça'), '0,001');
      await kaydet();
      expect(icerikKaydet).not.toHaveBeenCalled();
      expect(screen.getAllByText('Fiyat okunamadı. Binlik ayraç yazmayın; kuruş için virgül kullanın (ör. 1250,50).')).toHaveLength(1);
      expect(screen.getAllByText(KURUS_HATASI)).toHaveLength(1);
    });

    it('teyidi OLMAYAN talep: beyandaki 83,3333 (kimliksiz uç AYNEN kabul eder) kopyada YUVARLANMADAN görünür; dokunmadan kayıt REDDEDİLİR', async () => {
      duzenle(talep({ kalemler: [kalem({ talepFiyat: 83.3333, adet: 12 })] }));
      expect(kutu('Birim fiyat (KDV hariç): İç cephe boyası').value).toBe('83,3333');
      expect(cikti('Ara toplam (KDV hariç)')).toBe('—');
      await kaydet();
      expect(icerikKaydet).not.toHaveBeenCalled();
      expect(screen.getByText(KURUS_HATASI)).toBeTruthy();
      yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '83,33');
      await kaydet();
      expect(sonGovde().teyit?.kalemler).toEqual([
        { anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 12, birimFiyat: 83.33, tedarik: false },
      ]);
    });

    it('elle talep (yeni kip): üçüncü ondalık → alan hatası, `onKaydet` ÇAĞRILMAZ; «0,10» → 0,1 gider ve elle talep şemasından geçer', async () => {
      yeni();
      yaz(kutu('Müşteri adı (zorunlu)'), 'Hüseyin Ağaoğlu');
      yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0532 111 22 33');
      yaz(kutu('Ürün adı: 1. kalem'), 'Saten alçı');
      yaz(kutu('Adet: Saten alçı'), '12');
      yaz(kutu('Birim fiyat (KDV hariç): Saten alçı'), '83,3333');
      await tikla(dugme('Talebi aç'));
      expect(elleKaydet).not.toHaveBeenCalled();
      expect(screen.getByText(KURUS_HATASI)).toBeTruthy();
      expect(kutu('Birim fiyat (KDV hariç): Saten alçı').getAttribute('aria-invalid')).toBe('true');
      yaz(kutu('Birim fiyat (KDV hariç): Saten alçı'), '0,10');
      await tikla(dugme('Talebi aç'));
      expect(elleKaydet).toHaveBeenCalledTimes(1);
      const govde = elleKaydet.mock.calls[0][0];
      expect(govde.kalemler).toEqual([{ ad: 'Saten alçı', adet: 12, sku: '', marka: '', birimFiyat: 0.1, tedarik: false }]);
      expect(ErpElleTalepGovdesi.safeParse(govde).success).toBe(true);
    });

    it('İngilizce arayüzde metin çevrilir (Türkçe harf kalmaz)', async () => {
      duzenle(talep({ teyit: teyit([teyitKalemi({ ad: 'Brush' })]) }), 'en');
      yaz(screen.getByLabelText('Unit price (excl. VAT): Brush'), '1,005');
      await tikla(dugme('Save content'));
      expect(icerikKaydet).not.toHaveBeenCalled();
      expect(screen.getByText('The unit price may have at most two decimal places.')).toBeTruthy();
      expect(screen.queryByText(KURUS_HATASI)).toBeNull();
    });
  });

  it('adet / fiyat alanları METİNDİR (`type=number` yok; `inputMode` ile)', () => {
    const { container } = duzenle(talep({ teyit: teyit() }));
    expect(container.querySelector('input[type=number]')).toBeNull();
    expect(kutu('Adet: Fırça').getAttribute('type')).toBe('text');
    expect(kutu('Adet: Fırça').getAttribute('inputmode')).toBe('numeric');
    expect(kutu('Birim fiyat (KDV hariç): Fırça').getAttribute('inputmode')).toBe('decimal');
    expect(container.querySelector('form')).toBeNull();
  });

  it('mevcut teyit kalemi kendi `t:` anahtarıyla, yeni eklenen ANAHTARSIZ gider; kaldırılan satırın anahtarı gövdede YOK', async () => {
    duzenle(talep({ teyit: teyit() }));
    await tikla(dugme('Kalemi kaldır: Fırça'));
    await tikla(dugme('Kalem ekle'));
    yaz(kutu('Ürün adı: 2. kalem'), 'Rulo');
    yaz(kutu('Stok kodu: 2. kalem'), 'RUL-5');
    yaz(kutu('Adet: Rulo'), '4');
    await kaydet();
    const kalemler = sonGovde().teyit?.kalemler ?? [];
    expect(kalemler).toEqual([
      { anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, tedarik: false },
      { sku: 'RUL-5', ad: 'Rulo', marka: '', adet: 4, birimFiyat: null, tedarik: false },
    ]);
    expect(Object.prototype.hasOwnProperty.call(kalemler[1], 'anahtar')).toBe(false);
    expect(JSON.stringify(sonGovde())).not.toContain('t:bbbbbbbbbbbb');
    expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
  });

  it('teyidi OLAN talepte bütün kalemler kaldırılırsa kayıt reddedilir («talebi iptal edin»), istek YOK', async () => {
    duzenle(talep({ teyit: teyit() }));
    await tikla(dugme('Kalemi kaldır: İç cephe boyası'));
    await tikla(dugme('Kalemi kaldır: Fırça'));
    expect(screen.getByText('Kalem kalmadı.')).toBeTruthy();
    // Boş kalan bölümden çıkış yolu: beyandan yeniden kopyalama sunulur.
    expect(dugme('Müşteri beyanından kopyala')).toBeTruthy();
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Teyit edilmiş talepte en az bir kalem kalmalı; bütün kalemler kalkacaksa talebi iptal edin.')).toBeTruthy();
  });

  it('ürün adı boş kalem → alan hatası; satır ürün adı yokken sıra numarasıyla anılır', async () => {
    duzenle(talep());
    // Form iki beyan kalemiyle açıldı: eklenen satır üçüncüdür.
    await tikla(dugme('Kalem ekle'));
    expect(kutu('Adet: 3. kalem')).toBeTruthy();
    yaz(kutu('Adet: 3. kalem'), '1');
    await kaydet();
    expect(icerikKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Ürün adı boş olamaz.')).toBeTruthy();
  });
});

// ── KDV oranı, ekran sırası, canlı önizleme ─────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle — KDV oranı, ekran sırası ve canlı önizleme (V19)', () => {
  it('EKRAN SIRASI: fiyat alanları ve «Ara toplam (KDV hariç)» KDV seçicilerinden ÖNCE; «KDV» ve «Genel toplam» seçicilerden SONRA', () => {
    duzenle(talep({ teyit: teyit() }));
    const fiyatlar = [kutu('Birim fiyat (KDV hariç): İç cephe boyası'), kutu('Birim fiyat (KDV hariç): Fırça')];
    const seciciler = [kdvSecici('İç cephe boyası'), kdvSecici('Fırça')];
    const ara = screen.getByRole('status', { name: 'Ara toplam (KDV hariç)' });
    const kdv = screen.getByRole('status', { name: 'KDV' });
    const genel = screen.getByRole('status', { name: 'Genel toplam' });
    for (const f of fiyatlar) for (const s of seciciler) expect(once(f, s)).toBe(true);
    for (const s of seciciler) {
      expect(once(ara, s)).toBe(true);
      expect(once(s, kdv)).toBe(true);
      expect(once(s, genel)).toBe(true);
    }
    expect(once(kdv, genel)).toBe(true);
    // İki bölüm adlandırılmıştır: (1) kalemler + KDV hariç fiyat, (2) kalem başına KDV oranı.
    expect(screen.getByRole('group', { name: '1. Teyit edilen kalemler — KDV hariç birim fiyat' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '2. Kalem başına KDV oranı' })).toBeTruthy();
    expect(seciciler[0].options).toHaveLength(4);
    expect([...seciciler[0].options].map(o => o.textContent)).toEqual(['%0', '%1', '%10', '%20']);
  });

  it('PARA ÖRNEĞİ canlı önizlemede: 2 × 95,00 + 1 × 40,00, %20 → 230,00 / 46,00 / 276,00', () => {
    duzenle(talep({ teyit: teyit() }));
    expect(cikti('Ara toplam (KDV hariç)')).toBe('₺230,00');
    expect(cikti('KDV')).toBe('₺46,00');
    expect(cikti('Genel toplam')).toBe('₺276,00');
  });

  it('fiyat değişince ARA TOPLAM, oran değişince KDV ve GENEL TOPLAM güncellenir (KDV kalem oranıyla)', () => {
    duzenle(talep({ teyit: teyit() }));
    // Oran: ikinci kalem %10 → KDV 38 + 4 = 42; genel toplam 272; ara toplam değişmez.
    fireEvent.change(kdvSecici('Fırça'), { target: { value: '10' } });
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺230,00', '₺42,00', '₺272,00']);
    // Fiyat: birinci kalem 100 → ara toplam 240; KDV 40 + 4 = 44; genel toplam 284.
    yaz(kutu('Birim fiyat (KDV hariç): İç cephe boyası'), '100');
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺240,00', '₺44,00', '₺284,00']);
    // Adet: ikinci kalem 3 → ara toplam 320; KDV 40 + 12 = 52.
    yaz(kutu('Adet: Fırça'), '3');
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺320,00', '₺52,00', '₺372,00']);
  });

  it('herhangi bir fiyat BOŞSA üç toplam da «fiyat sorulacak» (kısmi toplam / ₺0,00 basılmaz); okunamayan girdide \'—\'', () => {
    duzenle(talep({ teyit: teyit() }));
    yaz(kutu('Birim fiyat (KDV hariç): Fırça'), '');
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['fiyat sorulacak', 'fiyat sorulacak', 'fiyat sorulacak']);
    yaz(kutu('Adet: Fırça'), 'abc');
    expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['—', '—', '—']);
  });

  it('varsayılan oran `urunKdvOrani` niteliğinden: 10 → seçici 10, im YOK; `undefined` → 20 + «varsayılan» imi; 18 (küme dışı) → 20 + im', () => {
    urunKdv.mockImplementation(sku => (sku === 'ABC' ? 10 : sku === 'ESKI-18' ? 18 : undefined));
    // Teyidi olmayan talep beyan kopyasıyla açılır: oranlar açılışta ürün kaydından.
    duzenle(talep({ kalemler: [kalem({ sku: 'ABC', ad: 'Ürün A' }), kalem({ sku: 'YOK', ad: 'Ürün B' }), kalem({ sku: 'ESKI-18', ad: 'Ürün C' })] }));
    expect([kdvSecici('Ürün A').value, kdvSecici('Ürün B').value, kdvSecici('Ürün C').value]).toEqual(['10', '20', '20']);
    const imli = (ad: string): boolean => within(kdvSecici(ad).parentElement as HTMLElement).queryByText('varsayılan') !== null;
    expect([imli('Ürün A'), imli('Ürün B'), imli('Ürün C')]).toEqual([false, true, true]);
    // Nitelik TAM olarak kalemin stok koduyla çağrılır.
    expect(new Set(urunKdv.mock.calls.map(c => c[0]))).toEqual(new Set(['ABC', 'YOK', 'ESKI-18']));
  });

  it('bileşen paket soneğini KIRPMAZ: `urunKdvOrani` `DEKOR-1325-D002` ile çağrılır (kural OrdersPage\'in verdiği işlevdedir)', () => {
    duzenle(talep({ kalemler: [kalem({ sku: 'DEKOR-1325-D002', ad: 'Paket' })] }));
    expect(urunKdv.mock.calls.length).toBeGreaterThan(0);
    expect(urunKdv.mock.calls.every(c => c[0] === 'DEKOR-1325-D002')).toBe(true);
  });

  it('personel oran SEÇİNCE «varsayılan» imi kalkar ve gövdeye `kdvOrani` girer; SEÇMEDİĞİ satırda gövdede `kdvOrani` YOK (yeni kalem: sunucu ürün kaydından çözer)', async () => {
    duzenle(talep());
    expect(screen.getAllByText('varsayılan')).toHaveLength(2);
    fireEvent.change(kdvSecici('Fırça'), { target: { value: '10' } });
    expect(screen.getAllByText('varsayılan')).toHaveLength(1);
    expect(kdvSecici('Fırça').value).toBe('10');
    await kaydet();
    const kalemler = sonGovde().teyit?.kalemler ?? [];
    expect(Object.prototype.hasOwnProperty.call(kalemler[0], 'kdvOrani')).toBe(false);
    expect(kalemler[1].kdvOrani).toBe(10);
    expect(JSON.stringify(sonGovde())).not.toContain('kdvKaynagi');
  });

  it('seçilen oran varsayılanla AYNI olsa da seçimdir: %20 + «varsayılan» satırında %20 seçilince im kalkar ve `kdvOrani: 20` gider', async () => {
    duzenle(talep({ teyit: teyit([teyitKalemi({ kdvKaynagi: 'varsayilan' })]) }));
    expect(screen.getAllByText('varsayılan')).toHaveLength(1);
    fireEvent.change(kdvSecici('İç cephe boyası'), { target: { value: '0' } });
    fireEvent.change(kdvSecici('İç cephe boyası'), { target: { value: '20' } });
    expect(screen.queryByText('varsayılan')).toBeNull();
    await kaydet();
    expect(sonGovde().teyit?.kalemler[0].kdvOrani).toBe(20);
  });

  // İnceleme 2b, bulgu 5: %20 DOĞRU oransa personel onu onaylayabilmeli. Tarayıcıda zaten seçili seçeneği yeniden seçmek
  // `change` olayı ÜRETMEZ — önceki tek yol «başka oran seç, sonra geri seç» idi (yukarıdaki test); yapılmazsa im ve
  // `varsayilan` kaynağı kalıyordu. (Olaysız «yeniden seçme» jsdom'da sınanamaz: sınanan şey onay yolunun kendisidir.)
  describe('«oranı onayla» — «varsayılan» oranın açık onayı', () => {
    const onayDugmesi = (ad: string, oran = 20): HTMLButtonElement | null =>
      screen.queryByRole('button', { name: `Oranı onayla (%${oran}): ${ad}` }) as HTMLButtonElement | null;

    it('mevcut teyit kaleminde: düğmeye basınca im ve düğme KALKAR, seçici %20\'de kalır, toplam değişmez; gövdeye `kdvOrani: 20` girer (sunucu `personel` yazar)', async () => {
      duzenle(talep({ teyit: teyit([teyitKalemi({ kdvKaynagi: 'varsayilan' })]) }));
      expect(screen.getAllByText('varsayılan')).toHaveLength(1);
      const once = [cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')];
      const d = onayDugmesi('İç cephe boyası');
      expect(d?.textContent).toBe('oranı onayla');
      if (d === null) throw new Error('onay düğmesi çizilmedi');
      d.focus();
      expect(document.activeElement).toBe(d);
      await tikla(d);
      // (İkinci tur, bulgu 3) düğme DOM'dan kalktı: odak `body`'ye DÜŞMEZ, aynı satırın oran seçicisindedir.
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'KDV oranı: İç cephe boyası' }));
      expect(screen.queryByText('varsayılan')).toBeNull();
      expect(onayDugmesi('İç cephe boyası')).toBeNull();
      expect(kdvSecici('İç cephe boyası').value).toBe('20');
      expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(once);
      // Onay istek ATMAZ; kayıtla birlikte gider.
      expect(icerikKaydet).not.toHaveBeenCalled();
      await kaydet();
      expect(sonGovde().teyit?.kalemler).toEqual([
        { anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, tedarik: false },
      ]);
      expect(JSON.stringify(sonGovde())).not.toContain('kdvKaynagi');
      expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
    });

    it('beyandan kopyalanan kalemde de çalışır; düğme YALNIZ «varsayılan» satırda çizilir (`urun` / `personel` satırında yok) ve yalnız basılan satırı onaylar', async () => {
      urunKdv.mockImplementation(sku => (sku === 'DYO-0001' ? 10 : undefined));
      duzenle(talep({ kalemler: [kalem(), kalem({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', adet: 1, talepFiyat: 120 }), kalem({ id: 'u3', sku: 'RUL-5', ad: 'Rulo', adet: 1, talepFiyat: 10 })] }));
      // Ürün kaydından okunan %10: im de onay düğmesi de yok.
      expect(onayDugmesi('İç cephe boyası', 10)).toBeNull();
      expect(onayDugmesi('İç cephe boyası')).toBeNull();
      expect(screen.getAllByRole('button', { name: /^Oranı onayla/ })).toHaveLength(2);
      const firca = onayDugmesi('Fırça');
      if (firca === null) throw new Error('onay düğmesi çizilmedi');
      await tikla(firca);
      expect(screen.getAllByText('varsayılan')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /^Oranı onayla/ })).toHaveLength(1);
      expect(onayDugmesi('Rulo')).not.toBeNull();
      await kaydet();
      const kalemler = sonGovde().teyit?.kalemler ?? [];
      expect(kalemler.map(k => Object.prototype.hasOwnProperty.call(k, 'kdvOrani'))).toEqual([false, true, false]);
      expect(kalemler[1].kdvOrani).toBe(20);
    });

    it('personel başka oran SEÇTİĞİ satırda düğme çizilmez (seçim zaten `personel`); istek sürerken düğme pasif', async () => {
      let coz: (s: MagazaFormSonucu) => void = () => {};
      duzenle(talep({ teyit: teyit([teyitKalemi({ kdvKaynagi: 'varsayilan' }), teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', ad: 'Fırça', kdvKaynagi: 'varsayilan' })]) }));
      fireEvent.change(kdvSecici('İç cephe boyası'), { target: { value: '10' } });
      expect(onayDugmesi('İç cephe boyası')).toBeNull();
      expect(onayDugmesi('İç cephe boyası', 10)).toBeNull();
      icerikKaydet.mockReturnValue(new Promise<MagazaFormSonucu>(r => { coz = r; }));
      await kaydet();
      expect(onayDugmesi('Fırça')?.disabled).toBe(true);
      await act(async () => { coz({ tamam: false, kod: 'ag' }); });
      expect(onayDugmesi('Fırça')?.disabled).toBe(false);
    });
  });

  // İnceleme 2b, bulgu 1 + 3: mevcut teyit kaleminin oranı KAYITLI orandır. Ürün kartı arada değişmiş olsa da form, tablodaki
  // kayıtlı tutarı gösterir ve (sunucu aynı kuralla koruduğu için) onu kaydeder — yalnız not düzenlemesi tutarı değiştirmez.
  describe('ürün kaydı arada değişti — ekranda görülen oran ve toplam = kaydedilecek olan', () => {
    /** Kayıtlı teyit: 2 × 95,00 (%20, `varsayilan` — kart yoktu) + 1 × 40,00 (%20, `urun`); tabloda 230,00 / 46,00 / 276,00. */
    const kayitli = (): MagazaTeyit => teyit([
      teyitKalemi({ kdvOrani: 20, kdvKaynagi: 'varsayilan' }),
      teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, kdvOrani: 20, kdvKaynagi: 'urun' }),
    ]);
    /** Ürün kaydının BUGÜNKÜ hâli: `DYO-0001` kartı sonradan eşlendi (%1), `FRC-12` %10'a çekildi. */
    const bugunkuKart = (sku: string): number | undefined => (sku === 'DYO-0001' ? 1 : sku === 'FRC-12' ? 10 : sku === 'RUL-5' ? 10 : undefined);

    it('form kayıtlı oranlarla açılır (%20 / %20) ve önizleme TABLODAKİ kayıtlı tutardır: 230,00 / 46,00 / 276,00 — ürün kaydı önizleme için sorulmaz; yalnız kayıtlı `varsayilan` satırın stok koduyla (bilgi için) okunur', () => {
      urunKdv.mockImplementation(bugunkuKart);
      const t = talep({ teyit: kayitli() });
      duzenle(t);
      expect([kdvSecici('İç cephe boyası').value, kdvSecici('Fırça').value]).toEqual(['20', '20']);
      expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺230,00', '₺46,00', '₺276,00']);
      // Önizleme = kayıtlı teyit toplamı (detay tablosunun bastığı değer).
      expect([t.teyit?.araToplam, t.teyit?.kdv, t.teyit?.toplam]).toEqual([230, 46, 276]);
      // (İkinci tur, bulgu 2 — bilerek değişen çit) eski beklenti «hiç çağrılmadı» idi. Ürün kaydı artık YALNIZ kayıtlı
      // `varsayilan` satırın stok koduyla okunur (bilgi için); `urun` kaynaklı `FRC-12` satırı için sorulmaz.
      expect(new Set(urunKdv.mock.calls.map(c => c[0]))).toEqual(new Set(['DYO-0001']));
      // «varsayılan» imi kayıtlı kaynaktan (kart sonradan eşlense de kalem kendiliğinden ürün oranını almaz — personel seçer / onaylar).
      expect(within(kdvSecici('İç cephe boyası').parentElement as HTMLElement).getByText('varsayılan')).toBeTruthy();
      expect(within(kdvSecici('Fırça').parentElement as HTMLElement).queryByText('varsayılan')).toBeNull();
    });

    it('yalnız NOT değişti → gövdede hiçbir kalemde `kdvOrani` YOK (sunucu kayıtlı oranı korur); ekrandaki toplam kayıttan önce de sonra da 276,00', async () => {
      urunKdv.mockImplementation(bugunkuKart);
      icerikKaydet.mockResolvedValue({ tamam: false, kod: 'ag' });                  // form açık kalsın: kayıttan SONRAKİ ekran da ölçülsün
      duzenle(talep({ teyit: kayitli() }));
      yaz(kutu('Müşteri notu'), 'yalnız not değişti');
      await kaydet();
      const kalemler = sonGovde().teyit?.kalemler ?? [];
      expect(kalemler.map(k => k.anahtar)).toEqual(['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb']);
      expect(kalemler.map(k => Object.prototype.hasOwnProperty.call(k, 'kdvOrani'))).toEqual([false, false]);
      expect(cikti('Genel toplam')).toBe('₺276,00');
    });

    it('stok kodu DEĞİŞEN satır bugünkü ürün kaydından yeniden çözülür (önizleme değişir); kod eski hâline dönünce kayıtlı oran geri gelir', () => {
      urunKdv.mockImplementation(bugunkuKart);
      duzenle(talep({ teyit: kayitli() }));
      yaz(kutu('Stok kodu: 2. kalem'), 'RUL-5');
      // 190,00 × %20 + 40,00 × %10 = 38,00 + 4,00.
      expect(kdvSecici('Fırça').value).toBe('10');
      expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺230,00', '₺42,00', '₺272,00']);
      // (İkinci tur — bilerek değişen çit; eskisi `Set{'RUL-5'}`) `DYO-0001`: kayıtlı `varsayilan` satırın bilgi okuması;
      // `RUL-5`: kodu değişen satırın yeniden çözümü. Kodu DEĞİŞMEYEN hâliyle `FRC-12` hiç sorulmaz.
      expect(new Set(urunKdv.mock.calls.map(c => c[0]))).toEqual(new Set(['DYO-0001', 'RUL-5']));
      yaz(kutu('Stok kodu: 2. kalem'), 'FRC-12');
      expect(kdvSecici('Fırça').value).toBe('20');
      expect(cikti('Genel toplam')).toBe('₺276,00');
    });

    // İnceleme 2b, ikinci tur (bulgu 2): «varsayılan» imli MEVCUT teyit kaleminde kart teyitten SONRA eşlenmiş olabilir. Form
    // «okunamadı» deyip %20'yi tek tıkla `personel` olarak onaylatıyordu; artık ürün kaydının BUGÜNKÜ oranını BİLGİ olarak
    // gösterir. Önizleme, gövde ve sunucu DEĞİŞMEZ — teyit edilen rakam, ona dokunulmadıkça sabittir.
    describe('kayıtlı «varsayılan» kalemde ürün kaydının BUGÜNKÜ oranı — yalnız bilgi', () => {
      const satir = (ad: string): HTMLElement => kdvSecici(ad).parentElement as HTMLElement;
      const ac = (kart: (sku: string) => number | undefined): void => {
        urunKdv.mockImplementation(kart);
        duzenle(talep({ teyit: kayitli(), icerikSurum: 1 }));
      };
      const kdvVarMi = (): boolean[] => (sonGovde().teyit?.kalemler ?? []).map(k => Object.prototype.hasOwnProperty.call(k, 'kdvOrani'));

      it('kart ARTIK %10: seçici ve önizleme KAYITLI (20; 46,00 / 276,00) kalır; satır «ürün kaydı şimdi %10» der; im başlığı «eşleşen stok kodu yok» DEMEZ; kart yalnız o satır için sorulur', () => {
        ac(sku => (sku === 'DYO-0001' ? 10 : sku === 'FRC-12' ? 1 : undefined));
        expect([kdvSecici('İç cephe boyası').value, kdvSecici('Fırça').value]).toEqual(['20', '20']);
        expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺230,00', '₺46,00', '₺276,00']);
        const im = within(satir('İç cephe boyası')).getByText('varsayılan');
        expect(im.getAttribute('title')).toBe('Teyit yazılırken ürün kaydından oran okunamamış, %20 varsayılmıştı. Ürün kaydı şimdi %10 diyor — doğru oranı seçin ya da onaylayın.');
        expect(im.getAttribute('title')).not.toContain('eşleşen stok kodu yok');
        expect(within(satir('İç cephe boyası')).getByText('ürün kaydı şimdi %10')).toBeTruthy();
        // `urun` kaynaklı satır: kart sorulmaz, bilgi yok.
        expect(within(satir('Fırça')).queryByText(/ürün kaydı şimdi/)).toBeNull();
        expect(new Set(urunKdv.mock.calls.map(c => c[0]))).toEqual(new Set(['DYO-0001']));
        // Onay düğmesi onayladığı oranı ADIYLA söyler («şimdi %10» yazısının yanında çıplak «oranı onayla» %10 sanılırdı).
        expect(dugme('Oranı onayla (%20): İç cephe boyası').textContent).toBe('oranı onayla (%20)');
        expect(dugme('Ürün kaydının oranını seç (%10): İç cephe boyası').textContent).toBe('ürün kaydının oranını seç (%10)');
      });

      it('«ürün kaydının oranını seç (%10)» → seçici 10, im ve düğmeler kalkar, odak aynı satırın seçicisinde; gövdeye YALNIZ o kalemde `kdvOrani: 10` girer; önizleme 27,00 / 257,00', async () => {
        ac(sku => (sku === 'DYO-0001' ? 10 : undefined));
        const sec = dugme('Ürün kaydının oranını seç (%10): İç cephe boyası');
        sec.focus();
        expect(document.activeElement).toBe(sec);
        await tikla(sec);
        // Düğme DOM'dan kalktı: odak `body`'ye DÜŞMEZ (onay düğmesiyle AYNI kural).
        expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'KDV oranı: İç cephe boyası' }));
        expect(kdvSecici('İç cephe boyası').value).toBe('10');
        expect(screen.queryByText('varsayılan')).toBeNull();
        expect(screen.queryByText(/ürün kaydı şimdi/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Oranı onayla|^Ürün kaydının oranını seç/ })).toBeNull();
        // 190,00 × %10 + 40,00 × %20 = 19,00 + 8,00.
        expect([cikti('Ara toplam (KDV hariç)'), cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺230,00', '₺27,00', '₺257,00']);
        // Seçim istek ATMAZ; kayıtla birlikte gider.
        expect(icerikKaydet).not.toHaveBeenCalled();
        await kaydet();
        const kalemler = sonGovde().teyit?.kalemler ?? [];
        expect(kalemler.map(k => k.anahtar)).toEqual(['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb']);
        expect(kdvVarMi()).toEqual([true, false]);
        expect(kalemler[0].kdvOrani).toBe(10);
        expect(JSON.stringify(sonGovde())).not.toContain('kdvKaynagi');
        expect(ErpIcerikGovdesi.safeParse(sonGovde()).success).toBe(true);
      });

      // İkinci tur hakemi: yukarıdaki iki odak beklentisi de İLK satırı tıklıyor — «aynı satırın seçicisi» ile «listenin ilk
      // seçicisi» ayrışmıyordu. Burada tıklanan satır ilk DEĞİL: odak TIKLANAN satırın seçicisine gitmeli.
      it('odak TIKLANAN satırın seçicisine gider (listenin ilk seçicisine DEĞİL): 2. satırda «seç», 3. satırda «oranı onayla»', async () => {
        urunKdv.mockImplementation(sku => (sku === 'DYO-0001' ? 10 : sku === 'FRC-12' ? 1 : undefined));
        duzenle(talep({ teyit: teyit([
          teyitKalemi({ kdvKaynagi: 'varsayilan' }),
          teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, kdvKaynagi: 'varsayilan' }),
          teyitKalemi({ anahtar: 't:cccccccccccc', id: 'u3', sku: 'RUL-5', ad: 'Rulo', marka: 'Dekor', adet: 1, birimFiyat: 30, kdvKaynagi: 'varsayilan' }),
        ]), icerikSurum: 1 }));
        await tikla(dugme('Ürün kaydının oranını seç (%1): Fırça'));
        expect(document.activeElement).toBe(kdvSecici('Fırça'));
        expect([kdvSecici('İç cephe boyası').value, kdvSecici('Fırça').value, kdvSecici('Rulo').value]).toEqual(['20', '1', '20']);
        await tikla(dugme('Oranı onayla (%20): Rulo'));
        expect(document.activeElement).toBe(kdvSecici('Rulo'));
      });

      it('%20 yine onaylanabilir (kart %10 dese de karar personelin): im kalkar, gövdede `kdvOrani: 20`', async () => {
        ac(sku => (sku === 'DYO-0001' ? 10 : undefined));
        await tikla(dugme('Oranı onayla (%20): İç cephe boyası'));
        expect(screen.queryByText('varsayılan')).toBeNull();
        expect(screen.queryByText(/ürün kaydı şimdi/)).toBeNull();
        expect(kdvSecici('İç cephe boyası').value).toBe('20');
        expect(cikti('Genel toplam')).toBe('₺276,00');
        await kaydet();
        expect(kdvVarMi()).toEqual([true, false]);
        expect(sonGovde().teyit?.kalemler[0].kdvOrani).toBe(20);
      });

      it('dokunulmadan kayıt (yalnız bilgi okundu): gövdede hiçbir kalemde `kdvOrani` YOK; ekrandaki toplam kayıttan sonra da 276,00', async () => {
        icerikKaydet.mockResolvedValue({ tamam: false, kod: 'ag' });                // form açık kalsın: kayıttan SONRAKİ ekran da ölçülsün
        ac(sku => (sku === 'DYO-0001' ? 10 : undefined));
        await kaydet();
        expect((sonGovde().teyit?.kalemler ?? []).map(k => k.anahtar)).toEqual(['t:aaaaaaaaaaaa', 't:bbbbbbbbbbbb']);
        expect(kdvVarMi()).toEqual([false, false]);
        expect([cikti('KDV'), cikti('Genel toplam')]).toEqual(['₺46,00', '₺276,00']);
        expect(within(satir('İç cephe boyası')).getByText('ürün kaydı şimdi %10')).toBeTruthy();
      });

      it('kart HÂLÂ okunamıyor: eski başlık; bilgi ve «seç» düğmesi YOK; onay düğmesi «oranı onayla»', () => {
        ac(() => undefined);
        const im = within(satir('İç cephe boyası')).getByText('varsayılan');
        expect(im.getAttribute('title')).toMatch(/^Ürün kaydından oran okunamadı \(eşleşen stok kodu yok, /);
        expect(screen.queryByText(/ürün kaydı şimdi/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Ürün kaydının oranını seç/ })).toBeNull();
        expect(dugme('Oranı onayla (%20): İç cephe boyası').textContent).toBe('oranı onayla');
      });

      it('kart şimdi %20 (kayıtlıyla AYNI): bilgi basılır, «seç» düğmesi YOK, onay düğmesi «oranı onayla (%20)»', () => {
        ac(sku => (sku === 'DYO-0001' ? 20 : undefined));
        expect(within(satir('İç cephe boyası')).getByText('ürün kaydı şimdi %20')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Ürün kaydının oranını seç/ })).toBeNull();
        expect(dugme('Oranı onayla (%20): İç cephe boyası').textContent).toBe('oranı onayla (%20)');
      });
    });
  });

  it('mevcut teyit kalemi KAYITLI oran ve kaynakla açılır: `personel` %10 → 10, im yok; `varsayilan` → im; ürün kaydı `personel` / `urun` satırı için SORULMAZ, yalnız `varsayilan` satırın stok koduyla (bilgi için) okunur', () => {
    urunKdv.mockReturnValue(1);
    // Stok kodları AYRI: «hangi satır için soruldu» ölçülebilsin.
    duzenle(talep({ teyit: teyit([
      teyitKalemi({ sku: 'KOD-P', ad: 'Kalem P', kdvOrani: 10, kdvKaynagi: 'personel' }),
      teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', sku: 'KOD-U', ad: 'Kalem U', kdvOrani: 0, kdvKaynagi: 'urun' }),
      teyitKalemi({ anahtar: 't:cccccccccccc', sku: 'KOD-V', ad: 'Kalem V', kdvOrani: 20, kdvKaynagi: 'varsayilan' }),
    ]) }));
    expect([kdvSecici('Kalem P').value, kdvSecici('Kalem U').value, kdvSecici('Kalem V').value]).toEqual(['10', '0', '20']);
    expect(screen.getAllByText('varsayılan')).toHaveLength(1);
    expect(within(kdvSecici('Kalem V').parentElement as HTMLElement).getByText('varsayılan')).toBeTruthy();
    // Kayıtlı oranlar stok kodu değişmediği sürece ürün kaydından yeniden ÇÖZÜLMEZ (seçiciler yukarıda: 10 / 0 / 20 — kart %1
    // dediği hâlde). (İkinci tur — bilerek değişen çit; eskisi «hiç çağrılmadı») ürün kaydı yalnız kayıtlı `varsayilan`
    // satırın stok koduyla okunur — bilgi için.
    expect(new Set(urunKdv.mock.calls.map(c => c[0]))).toEqual(new Set(['KOD-V']));
    expect(within(kdvSecici('Kalem V').parentElement as HTMLElement).getByText('ürün kaydı şimdi %1')).toBeTruthy();
    expect(screen.getAllByText(/^ürün kaydı şimdi/)).toHaveLength(1);
  });

  it('«varsayılan» iminin ipucu nedenini söyler; önizlemenin kayıtlı tutar OLMADIĞI yazılıdır', () => {
    duzenle(talep({ teyit: teyit([teyitKalemi({ kdvKaynagi: 'varsayilan' })]) }));
    expect(screen.getByText('varsayılan').getAttribute('title')).toMatch(/^Ürün kaydından oran okunamadı .*%20 varsayıldı — doğru oranı seçin ya da onaylayın\.$/);
    expect(screen.getByText(/Aşağıdaki tutarlar önizlemedir; kayıtlı tutarı sunucu hesaplar\./)).toBeTruthy();
    // Dokunulmayan satırda ne olacağı da yazılıdır: kayıtlı oran korunur; yeni kalemde sunucu ürün kaydından belirler.
    expect(screen.getByText(/^Dokunmadığınız satırda: teyit edilmiş kalemin kayıtlı oranı korunur \(stok kodu değişmedikçe\); yeni kalemin oranını sunucu ürün kaydından belirler\./)).toBeTruthy();
  });
});

// ── Elle talep ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle — yeni (elle) talep', () => {
  it('her şey boş, TEK boş kalem satırı; KDV bölümü ve toplam önizlemesi YOK (kalemler beyandır); bildirim gönderileceği yazılı', () => {
    yeni();
    expect(screen.getByRole('group', { name: 'Yeni talep (elle)' })).toBeTruthy();
    expect(kutu('Müşteri adı (zorunlu)').value).toBe('');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Müşteri beyanından kopyala' })).toBeNull();
    expect(screen.getByText(/bildirim e-postası gönderilir \(mağaza bildirim adresine — müşteriye e-posta gitmez\)/)).toBeTruthy();
    expect(screen.queryByText(/Takip telefonu değişmez/)).toBeNull();
  });

  it('boş form → üç alan hatası (ad, telefon, kalem), `onKaydet` çağrılmaz', async () => {
    yeni();
    await tikla(dugme('Talebi aç'));
    expect(elleKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('Müşteri adı boş olamaz.')).toBeTruthy();
    expect(screen.getByText('Telefonda en az 10 rakam olmalı (takip sayfası talebi bu numarayla bulur).')).toBeTruthy();
    expect(screen.getByText('Ürün adı boş olamaz.')).toBeTruthy();
    expect(screen.getByText('Adet boş olamaz.')).toBeTruthy();
  });

  it('9 rakamlı telefon → alan hatası ve istek YOK; kalemsiz form → «en az bir kalem gerekli»', async () => {
    yeni();
    yaz(kutu('Müşteri adı (zorunlu)'), 'Hüseyin Ağaoğlu');
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '532 111 22 3');
    yaz(kutu('Ürün adı: 1. kalem'), 'Dış cephe boyası');
    yaz(kutu('Adet: Dış cephe boyası'), '3');
    await tikla(dugme('Talebi aç'));
    expect(elleKaydet).not.toHaveBeenCalled();
    expect(kutu('Telefon (zorunlu, en az 10 rakam)').getAttribute('aria-invalid')).toBe('true');

    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0532 111 22 33');
    await tikla(dugme('Kalemi kaldır: Dış cephe boyası'));
    await tikla(dugme('Talebi aç'));
    expect(elleKaydet).not.toHaveBeenCalled();
    expect(screen.getByText('En az bir kalem gerekli.')).toBeTruthy();
  });

  it('geçerli form → `onKaydet` TAM 1 çağrı; gövde sunucunun elle talep şemasından geçer (numara / toplam / anahtar / KDV yok)', async () => {
    yeni();
    yaz(kutu('Müşteri adı (zorunlu)'), 'Hüseyin Ağaoğlu');
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0532 111 22 33');
    yaz(kutu('İl'), 'Antalya');
    yaz(kutu('Müşteri notu'), 'Telefonla arandı');
    yaz(kutu('Ürün adı: 1. kalem'), 'Dış cephe boyası');
    yaz(kutu('Stok kodu: 1. kalem'), 'DYO-0042');
    yaz(kutu('Marka: 1. kalem'), 'DYO');
    yaz(kutu('Adet: Dış cephe boyası'), '3');
    yaz(kutu('Birim fiyat (KDV hariç): Dış cephe boyası'), '310,5');
    await tikla(dugme('Kalem ekle'));
    yaz(kutu('Ürün adı: 2. kalem'), 'Fırça');
    yaz(kutu('Adet: Fırça'), '1');
    await tikla(dugme('Talebi aç'));
    expect(elleKaydet).toHaveBeenCalledTimes(1);
    const govde = elleKaydet.mock.calls[0][0];
    expect(govde).toEqual({
      musteri: { ad: 'Hüseyin Ağaoğlu', firma: '', telefon: '0532 111 22 33', eposta: '', il: 'Antalya', adres: '', vergi: '' },
      not: 'Telefonla arandı',
      kalemler: [
        { ad: 'Dış cephe boyası', adet: 3, sku: 'DYO-0042', marka: 'DYO', birimFiyat: 310.5, tedarik: false },
        { ad: 'Fırça', adet: 1, sku: '', marka: '', birimFiyat: null, tedarik: false },
      ],
    });
    expect(JSON.stringify(govde)).not.toMatch(/"no"|"tarih"|"toplam"|"anahtar"|"kdvOrani"|"kdvKaynagi"/);
    expect(ErpElleTalepGovdesi.safeParse(govde).success).toBe(true);
  });

  it('sunucu `gecersiz` derse ileti formda; içerik yerinde kalır', async () => {
    elleKaydet.mockResolvedValue({ tamam: false, kod: 'gecersiz' });
    yeni();
    yaz(kutu('Müşteri adı (zorunlu)'), 'Hüseyin Ağaoğlu');
    yaz(kutu('Telefon (zorunlu, en az 10 rakam)'), '0532 111 22 33');
    yaz(kutu('Ürün adı: 1. kalem'), 'Boya');
    yaz(kutu('Adet: Boya'), '1');
    await tikla(dugme('Talebi aç'));
    expect(screen.getByRole('alert').textContent).toMatch(/^Sunucu içeriği kabul etmedi/);
    expect(kutu('Müşteri adı (zorunlu)').value).toBe('Hüseyin Ağaoğlu');
  });
});

// ── İngilizce ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle — İngilizce arayüz', () => {
  it('başlık, etiketler, önizleme ve «default» imi çevrilir', () => {
    // Kalem adı VERİDİR (çevrilmez); arayüz metninde Türkçe kalmadığı ölçülebilsin diye ASCII seçildi.
    duzenle(talep({ teyit: teyit([teyitKalemi({ ad: 'Brush', kdvKaynagi: 'varsayilan', birimFiyat: null })]) }), 'en');
    expect(screen.getByRole('group', { name: 'Edit content — T261008-5Y9P' })).toBeTruthy();
    expect(screen.getByLabelText('Customer name (required)')).toBeTruthy();
    expect(screen.getByLabelText('Phone (required, at least 10 digits)')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Subtotal (excl. VAT)' }).textContent).toBe('price to be quoted');
    expect(screen.getByRole('status', { name: 'Grand total' }).textContent).toBe('price to be quoted');
    expect(screen.getByText('default')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm rate (20%): Brush' }).textContent).toBe('confirm rate');
    expect(screen.getByRole('button', { name: 'Save content' })).toBeTruthy();
    expect(screen.getByLabelText('VAT rate: Brush')).toBeTruthy();
    // Çok satırlı kutuların içeriği (adres, not) müşteri VERİSİDİR; onun dışında Türkçe metin kalmamalı.
    expect(screen.queryAllByText(/[çğıöşüÇĞİÖŞÜ]/).filter(e => e.tagName !== 'TEXTAREA')).toEqual([]);
  });

  it('kayıtlı «default» satırda ürün kaydının bugünkü oranı: başlık, bilgi, «use product record rate» ve oranlı onay düğmesi çevrilir', async () => {
    urunKdv.mockImplementation(sku => (sku === 'DYO-0001' ? 10 : undefined));
    duzenle(talep({ teyit: teyit([teyitKalemi({ ad: 'Brush', kdvKaynagi: 'varsayilan' })]) }), 'en');
    expect(screen.getByText('default').getAttribute('title')).toBe('When this was confirmed no rate could be read from the product record, so 20% was assumed. The product record now says 10% — select the correct rate or confirm it.');
    expect(screen.getByText('product record now 10%')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm rate (20%): Brush' }).textContent).toBe('confirm rate (20%)');
    const sec = screen.getByRole('button', { name: 'Use product record rate (10%): Brush' });
    expect(sec.textContent).toBe('use product record rate (10%)');
    expect(screen.queryAllByText(/[çğıöşüÇĞİÖŞÜ]/).filter(e => e.tagName !== 'TEXTAREA')).toEqual([]);
    await tikla(sec);
    expect((screen.getByLabelText('VAT rate: Brush') as HTMLSelectElement).value).toBe('10');
    expect(screen.queryByText('default')).toBeNull();
    expect(screen.queryByText(/product record now/)).toBeNull();
  });

  it('teyidi olmayan talebin notu ve boş bölüm metni çevrilir', async () => {
    duzenle(talep({ kalemler: [kalem({ ad: 'Paint', marka: 'DYO' })] }), 'en');
    expect(screen.getByRole('note').textContent).toBe('This request has not been confirmed yet — the form opens with a copy of the customer’s request. On save, the quantities and prices below are stored as “Confirmed”. If you are only correcting customer details or the note, remove all items first: saving with this section empty writes no confirmation.');
    expect(screen.getByText(/^For rows you do not touch: a confirmed item keeps its saved rate \(unless its SKU changes\); for a new item the server determines the rate from the product record\./)).toBeTruthy();
    await tikla(screen.getByRole('button', { name: 'Remove item: Paint' }));
    expect(screen.getByText(/^Not confirmed yet — copy the items from the customer’s request or add an item\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy from the customer’s request' })).toBeTruthy();
    expect(screen.queryAllByText(/[çğıöşüÇĞİÖŞÜ]/).filter(e => e.tagName !== 'TEXTAREA')).toEqual([]);
  });
});

// ── Kaynak çiti ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepDuzenle.tsx — kaynak çiti', () => {
  const kod = yorumsuz('MagazaTalepDuzenle.tsx', readFileSync(join(__dirname, 'MagazaTalepDuzenle.tsx'), 'utf-8')).join('\n');

  it('kaynak okunuyor', () => { expect(kod.length).toBeGreaterThan(5000); });

  it('form istek ATMAZ ve depolamaya yazmaz: servis / ağ / abonelik içe aktarımı yok', () => {
    expect(kod).not.toMatch(/services\/|authFetch|fetch\(|dbClient|onSnapshot|localStorage|sessionStorage/);
    expect([...kod.matchAll(/from '([^']+)'/g)].map(m => m[1])).toEqual([
      'react', '../../utils/currency', '../../i18n/ortak', '../../lib/magazaTalep', '../../lib/magazaTalepFormu', '../../hooks/useMagazaTalepleri',
    ]);
    // Kancadan yalnız TİP gelir (abonelik burada açılmaz).
    expect(kod).toContain("import type { MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';");
  });

  it('`<form>` öğesi ve `type="number"` YOK; ham HTML basılmaz; ekran metni `toUpperCase()` ile büyütülmez; satır içi stil yok', () => {
    expect(kod).not.toMatch(/<form\b|type="number"/);
    expect(kod).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(kod).not.toMatch(/toUpperCase\(|toLocaleUpperCase\(/);
    expect(kod).not.toMatch(/\bstyle=/);
  });

  it('kurallar saf modülde: gövde üretimi, önizleme ve oran zinciri burada yeniden yazılmadı; sayısal alanda `?? 0` / `|| 0` yok', () => {
    for (const ad of ['magazaIcerikGovdesi(', 'magazaElleTalepGovdesi(', 'magazaTaslakOnizlemesi(', 'magazaTaslakKdv(', 'taslakBeyandan(', 'duzenlemeTaslagi(', 'yeniTalepTaslagi(']) {
      expect(kod, ad).toContain(ad);
    }
    expect(kod).not.toMatch(/magazaTeyitToplamlari|magazaKdvVarsayilani|magazaUrunKdvOrani|Math\.round\(/);
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/parseFloat|parseInt|Number\(e\.target\.value\)\s*\|\|/);
    // «oranı onayla» seçimle AYNI alanı yazar (ikinci bir «onaylandı» durumu yok): gövde ve kaynak kuralı tek yerde kalır.
    expect(kod).toContain('kalemYaz(k.yerel, { secilenKdv: kdv.kdvOrani })');
    expect(kod).not.toMatch(/kdvKaynagi:\s*'personel'/);
    // KDV seçicisinin seçenekleri kümenin kendisinden (kopya oran listesi yok).
    expect(kod).toContain('MAGAZA_KDV_ORANLARI.map(');
    expect(kod).not.toMatch(/\[0, 1, 10, 20\]/);
  });
});
