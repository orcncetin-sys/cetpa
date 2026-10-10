/**
 * MagazaTalepleri.test.tsx — Siparişler → «Mağaza Talepleri» sekmesinin GERÇEK çizimi (dilim 1, 2026-10-08; dilim 2a, 2026-10-10).
 * «Yazıldı ama bağlanmadı» çitinin (b) parçası; (a) parçası `pages/OrdersPage.magazaTalepleri.degismez.test.ts`.
 *
 * KİLİTLENEN DEĞİŞMEZLER — dilim 1 (şartname § 5):
 *   - liste sütunları + detay;
 *   - tutarlar müşterinin BEYANIDIR: `null` → '—', fiyatsız kalem → «fiyat sorulacak» (₺0,00 DEĞİL), fiyatı sorulacak kalem
 *     varken toplamın yanında «eksik — N kalemin fiyatı sorulacak»; ekran kalemlerden toplam TÜRETMEZ;
 *   - bildirim: `gonderilemedi` / `yapilandirilmamis` / 10 dakikadan eski `bekliyor` → «bildirim gönderilmedi»; taze
 *     `bekliyor` → «gönderiliyor»; `gitti` işaretsiz;
 *   - en yeni 200 talep çizilir, fazlası «daha eski N talep» diye SAYILIR;
 *   - müşterinin yazdığı metin HTML olarak yorumlanmaz; bağlantı yalnız doğrulanmış `tel:` / `mailto:`.
 *
 * DİLİM 2a (şartname v6 § 5.2 / § 7 «İstemci»):
 *   - aşama rozeti satırda; «ilerlet» satırın KARDEŞİ hücrede; geri al / iptal / not detayda; düğmeler geçiş tablosundan;
 *   - her yazım satırın `durumSurum`'unu gönderir; 409'da «başka biri değiştirdi» + yanıttaki güncel aşama; iyimser güncelleme YOK;
 *   - aşaması okunamayan (`null`) satır listede kalır, «açık» süzgecinde çizilir, işlem düğmesi çizilmez;
 *   - süzgeç (açık / kapalı / hepsi) ve arama, sıralama ve 200 sınırından ÖNCE; arama doluyken durum süzgeci yok sayılır;
 *   - kalem kalem «teslim edildi» kutusu, «tümünü işaretle / kaldır» TEK istek, `sevk` → `teslim` öncesi «N kalem teslim işaretsiz»;
 *   - «Yeniden gönder» yalnız `magazaYenidenGonderilebilir` doğruyken; bekleme başlangıcı `max(olusturma, bildirim.zaman)`;
 *   - arama kutusu + barkod Enter; «Etiket basıldı» satırı salt okunur; sekme rozeti iki sayıyı AYRI etiketle basar;
 *   - bileşen istek ATMAZ: yazma yalnız üç nitelikten (`onDurumDegistir`, `onKalemTeslim`, `onBildirimGonder`).
 *
 * BİLEREK DEĞİŞEN dilim 1 sabitleri (şartname § 7; hiçbiri gevşetilmedi — her biri yeni değeriyle aşağıda): «bileşende başka
 * düğme yok» (satır düğmeleri artık `aria-expanded` taşıyanlardır), sütunlar (+ aşama rozeti), boş listede düğme yok (→ satır
 * düğmesi yok; süzgeç düğmeleri var), «SALT OKUNUR … giriş alanı yok» (→ detay kapalıyken tek `input[type=search]`, `form`
 * hiç yok), bekleme `min` → `max` (40 dakikalık talep / 1 dakika önceki deneme artık «gönderiliyor»; ikisi de çözülmüyorsa
 * `okunamadi`), kalem tablosu (+ «Teslim» sütunu), sekme rozeti («N yeni talep» → «N görülmemiş talep» + ayrı «N yeni talep»).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MagazaTalepleri, {
  MagazaYeniRozeti, MAGAZA_TALEP_EKRAN_SINIRI, MAGAZA_AKIS_BEKLEME_MS,
  magazaTalepGorunumu, magazaDurumSuzgeci, magazaTalepListesi, magazaTalepAramasi,
  sonrakiBeklemeEsigi, toplamEksikMi, fiyatiSorulacakKalemSayisi,
  telBaglantisi, epostaBaglantisi,
} from './MagazaTalepleri';
import { useMagazaYeniSayaci, yeniAsamaSayisi, type MagazaTalepSatiri } from '../../hooks/useMagazaTalepleri';
import {
  MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS, MAGAZA_TALEP_ASAMALARI, bildirimGorunumu, magazaYenidenGonderilebilir,
  type MagazaTalepKalemi, type MagazaTalepAsamasi, type MagazaKalemTeslimGirisi,
} from '../../lib/magazaTalep';
import { magazaTalepAramasi as aramaKurali } from '../../lib/magazaTalepAramasi';
import { magazaTalepDurumEtiketi, magazaTalepDurumRengi } from '../../utils/durumEtiketi';
import { tarihSaatYaz } from '../../utils/zaman';
import type {
  MagazaDurumGirdisi, MagazaDurumSonucu, MagazaKalemTeslimGirdisi, MagazaKalemTeslimSonucu, MagazaBildirimGonderSonucu,
} from '../../services/magazaTalepIstemcisi';
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
  durumAciklama: '',
  durumSurum: 0,
  iptalOncesi: null,
  durumGecmisi: [],
  kalemTeslim: {},
  etiketBasildi: null,
  ...ek,
});

/** Kalem işareti girişi (sunucunun yazdığı biçim). */
const isaret = (durum: 'teslim' | 'bekliyor', zaman: string, ad = 'Ayşe Yılmaz'): MagazaKalemTeslimGirisi => ({ durum, zaman, kim: { uid: 'u-ayse', ad } });

// Üç yazma niteliğinin sahteleri: bileşen istek ATMAZ, yalnız bunları çağırır.
const durumYaz = vi.fn<(id: string, g: MagazaDurumGirdisi) => Promise<MagazaDurumSonucu>>();
const teslimYaz = vi.fn<(id: string, g: MagazaKalemTeslimGirdisi) => Promise<MagazaKalemTeslimSonucu>>();
const bildirimGonder = vi.fn<(id: string) => Promise<MagazaBildirimGonderSonucu>>();

const Ekran = ({ talepler, dil = 'tr', yukleniyor = false, hata = null }: { talepler: MagazaTalepSatiri[]; dil?: 'tr' | 'en'; yukleniyor?: boolean; hata?: string | null }) => (
  <MagazaTalepleri
    talepler={talepler}
    yukleniyor={yukleniyor}
    hata={hata}
    currentLanguage={dil}
    onDurumDegistir={durumYaz}
    onKalemTeslim={teslimYaz}
    onBildirimGonder={bildirimGonder}
  />
);
const ciz = (talepler: MagazaTalepSatiri[], dil: 'tr' | 'en' = 'tr') => render(<Ekran talepler={talepler} dil={dil} />);
/** Liste satırları = detayı açan düğmeler: `aria-expanded` taşıyanlar (bileşende artık başka düğmeler de var). */
const satirlar = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('button[aria-expanded]')];
/** Satıra tıklar, açılan detay bölgesini döndürür (kabuk `<section>` de adlı bir bölgedir — ada göre ayrılır). */
const detayAc = (i = 0) => { fireEvent.click(satirlar()[i]); return screen.getByRole('region', { name: /talep detayı$|^Request .* detail$/ }); };
const aramaKutusu = (): HTMLInputElement => screen.getByRole('searchbox') as HTMLInputElement;
const dugme = (ad: string | RegExp): HTMLButtonElement => screen.getByRole('button', { name: ad }) as HTMLButtonElement;
const dugmeVarMi = (ad: string | RegExp): boolean => screen.queryByRole('button', { name: ad }) !== null;
/** Tıklar ve nitelikten dönen sözü (mikro görev) işletir. */
const tikla = async (oge: HTMLElement): Promise<void> => { await act(async () => { fireEvent.click(oge); }); };
const talepNolari = (): Array<string | undefined> => satirlar().map(s => /T\d{6}-[A-Z0-9]{4}/.exec(s.textContent ?? '')?.[0]);

beforeEach(() => {
  sira = 0;
  localStorage.clear();
  vi.useFakeTimers({ now: SIMDI });
  durumYaz.mockReset().mockResolvedValue({ ok: true });
  teslimYaz.mockReset().mockResolvedValue({ ok: true });
  bildirimGonder.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it('sütunlar: talep no + AŞAMA ROZETİ, tarih (tr-TR), müşteri adı / firma, il, kalem sayısı, talep edilen toplam, bildirim', () => {
    ciz([talep({ talepNo: 'T261008-AB12', olusturma: '2026-10-08T11:00:00.000Z', durum: 'hazirlaniyor' })]);
    const satir = satirlar()[0];
    for (const baslik of ['Talep no', 'Tarih', 'Müşteri / firma', 'İl', 'Kalemler', 'Talep edilen toplam']) {
      expect(within(satir).getByText(baslik)).toBeTruthy();
    }
    expect(satir.textContent).toContain('T261008-AB12');
    // Aşama rozeti satır düğmesinin İÇİNDE, talep numarasının hücresinde.
    expect(within(satir).getByText('Talep no').parentElement?.textContent).toBe('Talep noT261008-AB12Hazırlanıyor');
    expect(satir.textContent).toMatch(/08\.10\.2026 \d{2}:\d{2}/);
    expect(satir.textContent).toContain('Şükrü Çağlayan');
    expect(satir.textContent).toContain('Çağlayan İnşaat');
    expect(satir.textContent).toContain('İzmir');
    expect(satir.textContent).toContain('2 kalem');
    expect(satir.textContent).toContain('₺635,98');
    // «gitti» işaretsizdir: ne rozet ne «Bildirim» etiketi.
    expect(satir.textContent).not.toMatch(/Bildirim|bildirim|gönderiliyor/);
  });

  it('aşama rozeti: altı aşamanın etiketi ve rengi `durumEtiketi.ts` tablosundan; okunamayan aşama «durum okunamadı» (uydurma aşama YOK)', () => {
    ciz([...MAGAZA_TALEP_ASAMALARI.map((durum, i) => talep({ durum, olusturma: once(i + 1) })), talep({ durum: null, olusturma: once(50) })]);
    fireEvent.click(dugme(/^Hepsi/));
    const rozetler = satirlar().map(s => within(s).getByText('Talep no').parentElement?.lastElementChild?.firstElementChild);
    expect(rozetler.map(r => r?.textContent)).toEqual(['Yeni', 'Teyit edildi', 'Hazırlanıyor', 'Sevk edildi', 'Teslim edildi', 'İptal edildi', 'durum okunamadı']);
    MAGAZA_TALEP_ASAMALARI.forEach((asama, i) => {
      expect(rozetler[i]?.textContent).toBe(magazaTalepDurumEtiketi(asama, 'tr'));
      expect(rozetler[i]?.className).toContain(magazaTalepDurumRengi(asama));
    });
    expect(rozetler[6]?.className).toContain('bg-yellow-50 text-yellow-700');
  });

  it('sıra: en yeni ÖNCE; tarihi çözülemeyen talep ATILMAZ — sonda ve tarihi \'—\'', () => {
    ciz([
      talep({ talepNo: 'T261008-ESKI', olusturma: once(300) }),
      talep({ talepNo: 'T261008-BOZK', olusturma: 'dün öğlen' }),
      talep({ talepNo: 'T261008-YENI', olusturma: once(5) }),
    ]);
    expect(talepNolari()).toEqual(['T261008-YENI', 'T261008-ESKI', 'T261008-BOZK']);
    expect(within(satirlar()[2]).getByText('Tarih').nextElementSibling?.textContent).toBe('—');
  });

  it('boş alanlar \'—\' basılır; firma yoksa satırda ikinci satır çizilmez', () => {
    ciz([talep({ talepNo: '', musteri: { ad: '', firma: '  ', telefon: '', eposta: '', il: '', adres: '', vergi: '' } })]);
    const satir = satirlar()[0];
    expect(within(satir).getByText('Talep no').nextElementSibling?.textContent).toBe('—');
    expect(within(satir).getByText('İl').nextElementSibling?.textContent).toBe('—');
    expect(within(satir).getByText('Müşteri / firma').parentElement?.children).toHaveLength(2);   // etiket + ad
  });

  it('yükleniyor / hata / boş durumları AYRI yazılır — hata «talep yok» gibi görünmez; arama ve süzgeç yalnız liste okunduysa çizilir', () => {
    const { rerender } = render(<Ekran talepler={[]} yukleniyor />);
    expect(screen.getByText('Yükleniyor...')).toBeTruthy();
    expect(screen.queryByText(/Henüz mağaza talebi yok/)).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<Ekran talepler={[]} hata="bağlantı koptu" />);
    expect(screen.getByRole('alert').textContent).toBe('Mağaza talepleri okunamadı: bağlantı koptu');
    expect(screen.queryByText(/Henüz mağaza talebi yok/)).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<Ekran talepler={[]} />);
    expect(screen.getByText('Henüz mağaza talebi yok.')).toBeTruthy();
    // Boş listede SATIR düğmesi yok; bileşendeki tek düğmeler üç süzgeç düğmesidir.
    expect(satirlar()).toHaveLength(0);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Açık 0', 'Kapalı 0', 'Hepsi 0']);
  });

  it('İngilizce arayüz: başlık ve metinler çevrilir', () => {
    ciz([talep({ kalemler: [kalem({ talepFiyat: null })], fiyatiSorulacakVar: true, bildirim: { durum: 'gonderilemedi', zaman: once(30) } })], 'en');
    expect(screen.getByRole('region', { name: 'Store Requests' })).toBeTruthy();
    expect(satirlar()[0].textContent).toContain('incomplete — price to be quoted for 1 item');
    expect(satirlar()[0].textContent).toContain('notification not sent');
    expect(satirlar()[0].textContent).toContain('New');
    expect(dugmeVarMi('Advance: Confirmed')).toBe(true);
    expect(dugmeVarMi('Resend')).toBe(true);
    expect(aramaKutusu().getAttribute('aria-label')).toBe('Search requests (no, last 4 digits of phone, customer)');
    const detay = detayAc();
    expect(detay.textContent).toContain('price to be quoted');
    expect(detay.textContent).toContain('Line items — as declared by the customer');
    expect(within(detay).getAllByRole('checkbox', { name: /^Delivered: / })).toHaveLength(1);
  });
});

// ── Süzgeç ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — durum süzgeci (açık / kapalı / hepsi)', () => {
  const karisik = () => [
    talep({ talepNo: 'T261008-YENI', durum: 'yeni', olusturma: once(1) }),
    talep({ talepNo: 'T261008-SEVK', durum: 'sevk', olusturma: once(2) }),
    talep({ talepNo: 'T261008-TSLM', durum: 'teslim', olusturma: once(3) }),
    talep({ talepNo: 'T261008-IPTL', durum: 'iptal', olusturma: once(4) }),
    talep({ talepNo: 'T261008-BLNM', durum: null, olusturma: once(5) }),
  ];

  it('varsayılan «açık»: `teslim` / `iptal` çizilmez; aşaması okunamayan satır AÇIKTIR ve çizilir', () => {
    ciz(karisik());
    expect(dugme(/^Açık/).getAttribute('aria-pressed')).toBe('true');
    expect(talepNolari()).toEqual(['T261008-YENI', 'T261008-SEVK', 'T261008-BLNM']);
  });

  it('«kapalı»: yalnız `teslim` / `iptal`; aşaması okunamayan satır «kapalı»da ÇİZİLMEZ', () => {
    ciz(karisik());
    fireEvent.click(dugme(/^Kapalı/));
    expect(dugme(/^Kapalı/).getAttribute('aria-pressed')).toBe('true');
    expect(dugme(/^Açık/).getAttribute('aria-pressed')).toBe('false');
    expect(talepNolari()).toEqual(['T261008-TSLM', 'T261008-IPTL']);
  });

  it('«hepsi»: beşi de; düğmelerdeki sayılar bütün taleplerden (açık 3 / kapalı 2 / hepsi 5)', () => {
    ciz(karisik());
    fireEvent.click(dugme(/^Hepsi/));
    expect(talepNolari()).toHaveLength(5);
    expect([dugme(/^Açık/), dugme(/^Kapalı/), dugme(/^Hepsi/)].map(b => b.textContent)).toEqual(['Açık 3', 'Kapalı 2', 'Hepsi 5']);
    // Başlıktaki sayı süzgeçten bağımsız TOPLAM talep sayısıdır.
    expect(screen.getByRole('heading', { name: /Mağaza Talepleri\s*5/ })).toBeTruthy();
  });

  it('süzgeçte hiç talep kalmazsa «Bu süzgeçte talep yok» — «henüz talep yok» DEĞİL', () => {
    ciz([talep({ durum: 'teslim' })]);
    expect(screen.getByText('Bu süzgeçte talep yok.')).toBeTruthy();
    expect(screen.queryByText(/Henüz mağaza talebi yok/)).toBeNull();
    expect(satirlar()).toHaveLength(0);
  });

  it('süzgeç 200 sınırından ÖNCE: 205 yeni KAPALI talebin ardındaki 3 eski AÇIK talep «açık»ta çizilir', () => {
    const kapali = Array.from({ length: 205 }, (_, i) => talep({ talepNo: `T261008-K${String(i).padStart(3, '0')}`, durum: 'teslim', olusturma: once(i + 1) }));
    const acik = Array.from({ length: 3 }, (_, i) => talep({ talepNo: `T261008-A${String(i).padStart(3, '0')}`, durum: 'hazirlaniyor', olusturma: once(1000 + i) }));
    ciz([...kapali, ...acik]);
    expect(talepNolari()).toEqual(['T261008-A000', 'T261008-A001', 'T261008-A002']);
    expect(screen.queryByText(/daha eski/)).toBeNull();
    expect(screen.queryByText(/Çizilmeyen/)).toBeNull();

    // «hepsi»de sınır 200'dür: üç açık talep çizilmez ve SAYILIR (sessizce kaybolmaz).
    fireEvent.click(dugme(/^Hepsi/));
    expect(satirlar()).toHaveLength(200);
    expect(screen.getByText('En yeni 200 talep gösteriliyor — daha eski 8 talep bu listede çizilmedi.')).toBeTruthy();
    expect(screen.getByText('Çizilmeyen 3 açık talep var — aramayla bulunabilir.')).toBeTruthy();
  });

  it('saf kural: `magazaDurumSuzgeci` yalnız `magazaAcikMi` ile süzer; `magazaTalepListesi` sırası süzgeç → arama → sınır', () => {
    const t = karisik();
    expect(magazaDurumSuzgeci(t, 'acik').map(x => x.durum)).toEqual(['yeni', 'sevk', null]);
    expect(magazaDurumSuzgeci(t, 'kapali').map(x => x.durum)).toEqual(['teslim', 'iptal']);
    expect(magazaDurumSuzgeci(t, 'hepsi')).toHaveLength(5);
    // Arama doluyken durum süzgeci YOK sayılır: kapalı talep «açık» süzgecinde de bulunur.
    expect(magazaTalepListesi(t, 'acik', 'TSLM').suzulen.map(x => x.talepNo)).toEqual(['T261008-TSLM']);
    expect(magazaTalepListesi(t, 'acik', '   ').suzulen).toHaveLength(3);
    // Sınır süzgeçten SONRA: tek satırlık sınırda en yeni AÇIK talep kalır, çizilmeyen iki açık sayılır.
    const l = magazaTalepListesi(t, 'acik', '', 1);
    expect(l.gorunen.map(x => x.talepNo)).toEqual(['T261008-YENI']);
    expect(l.dahaEski).toBe(2);
    expect(l.cizilmeyenAcik).toBe(2);
    expect(magazaTalepListesi(t, 'kapali', '', 1).cizilmeyenAcik).toBe(0);
    // Bileşenin dışa açtığı arama işlevi `lib/magazaTalepAramasi.ts`'teki TEK kuraldır (kopya yok).
    expect(magazaTalepAramasi).toBe(aramaKurali);
  });
});

// ── Aşama işlemleri ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — aşama: ilerlet / geri al / iptal / not', () => {
  it('«ilerlet» satır düğmesinin KARDEŞİ hücrededir (iç içe etkileşimli öğe yok); gövdede satırın `surum`\'u gider, açıklama gitmez', async () => {
    const t = talep({ durum: 'yeni', durumSurum: 4 });
    ciz([t]);
    const ilerlet = dugme('İlerlet: Teyit edildi');
    expect(satirlar()[0].contains(ilerlet)).toBe(false);
    expect(document.querySelector('button button')).toBeNull();
    await tikla(ilerlet);
    expect(durumYaz).toHaveBeenCalledTimes(1);
    expect(durumYaz).toHaveBeenCalledWith(t.id, { onceki: 'yeni', surum: 4, durum: 'teyit' });
    // Detay açılmadı: ilerlet satırı açıp kapatmaz.
    expect(satirlar()[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('işlem hücresi HER satırda vardır: düğmesiz satırda geniş ekranda yer tutar (satır sütunları başlıktaki «İşlem» sütunuyla hizalı kalır)', () => {
    ciz([
      talep({ durum: 'yeni', olusturma: once(1) }),                                                            // ilerlet var
      talep({ durum: 'teslim', olusturma: once(2) }),                                                          // düğme yok
      talep({ durum: 'iptal', olusturma: once(3), bildirim: { durum: 'gonderilemedi', zaman: once(3) } }),     // yalnız «Yeniden gönder»
    ]);
    fireEvent.click(dugme(/^Hepsi/));
    const hucreler = satirlar().map(s => s.nextElementSibling as HTMLElement);
    expect(hucreler.map(h => h.tagName)).toEqual(['DIV', 'DIV', 'DIV']);
    expect(hucreler.map(h => [...h.querySelectorAll('button')].map(b => b.textContent))).toEqual([['İlerlet: Teyit edildi'], [], ['Yeniden gönder']]);
    // Üç hücre de AYNI sabit genişlikte; boş olan dar ekranda gizli, geniş ekranda yer tutucu.
    for (const h of hucreler) expect(h.className).toContain('lg:w-44 lg:shrink-0');
    expect(hucreler[1].className).toContain('hidden lg:block');
    expect(hucreler[0].className).not.toContain('hidden');
  });

  it('her aşamanın düğmeleri GEÇİŞ TABLOSUNDAN: ilerlet satırda; geri al / iptal detayda; `teslim` iptal edilemez (V12)', () => {
    const beklenen: Array<[MagazaTalepAsamasi, string | null, string[]]> = [
      ['yeni', 'İlerlet: Teyit edildi', ['Talebi iptal et']],
      ['teyit', 'İlerlet: Hazırlanıyor', ['Geri al: Yeni', 'Talebi iptal et']],
      ['hazirlaniyor', 'İlerlet: Sevk edildi', ['Geri al: Teyit edildi', 'Talebi iptal et']],
      ['sevk', 'İlerlet: Teslim edildi', ['Geri al: Hazırlanıyor', 'Talebi iptal et']],
      ['teslim', null, ['Geri al: Sevk edildi']],
    ];
    for (const [durum, ileri, detayda] of beklenen) {
      const { unmount } = ciz([talep({ durum })]);
      fireEvent.click(dugme(/^Hepsi/));
      expect(screen.queryAllByRole('button', { name: /^İlerlet: / }).map(b => b.textContent), durum).toEqual(ileri === null ? [] : [ileri]);
      const detay = detayAc();
      // Detaydaki düğmeler sırayla: not, aşama geçişleri, kalem listesinin toplu düğmesi.
      expect(within(detay).getAllByRole('button').map(b => b.textContent), durum).toEqual(['Notu kaydet', ...detayda, 'Tümünü işaretle']);
      unmount();
    }
  });

  it('geri al ve iptal: gövdede `onceki`, satırın `surum`\'u ve hedef aşama', async () => {
    const t = talep({ durum: 'hazirlaniyor', durumSurum: 7 });
    ciz([t]);
    const detay = detayAc();
    await tikla(within(detay).getByRole('button', { name: 'Geri al: Teyit edildi' }));
    expect(durumYaz).toHaveBeenLastCalledWith(t.id, { onceki: 'hazirlaniyor', surum: 7, durum: 'teyit' });
    // Yazım başarılı: akış yeni sürümü getirene kadar düğmeler kilitli — ikinci tıklama istek üretmez.
    await tikla(within(detay).getByRole('button', { name: 'Talebi iptal et' }));
    expect(durumYaz).toHaveBeenCalledTimes(1);
  });

  it('iptalden dönüş yalnız `iptalOncesi` aşamasına; `iptalOncesi` yoksa dönüş düğmesi ÇİZİLMEZ (aşama uydurulmaz)', async () => {
    const t = talep({ durum: 'iptal', iptalOncesi: 'sevk', durumSurum: 3 });
    const { unmount } = ciz([t]);
    fireEvent.click(dugme(/^Hepsi/));
    const detay = detayAc();
    expect(within(detay).getAllByRole('button').map(b => b.textContent)).toEqual(['Notu kaydet', 'İptali geri al: Sevk edildi']);
    await tikla(within(detay).getByRole('button', { name: 'İptali geri al: Sevk edildi' }));
    expect(durumYaz).toHaveBeenCalledWith(t.id, { onceki: 'iptal', surum: 3, durum: 'sevk' });
    unmount();

    ciz([talep({ durum: 'iptal', iptalOncesi: null })]);
    fireEvent.click(dugme(/^Hepsi/));
    expect(within(detayAc()).getAllByRole('button').map(b => b.textContent)).toEqual(['Notu kaydet']);
    expect(dugmeVarMi(/^İlerlet/)).toBe(false);
  });

  it('aşaması okunamayan (`null`) satır: rozet «durum okunamadı», işlem düğmesi ve not kutusu YOK, kalem kutuları pasif', () => {
    ciz([talep({ durum: null, bildirim: { durum: 'gitti', zaman: once(1) } })]);
    expect(dugmeVarMi(/^İlerlet/)).toBe(false);
    const detay = detayAc();
    expect(within(detay).getByText('Durum').nextElementSibling?.textContent).toBe('durum okunamadı');
    expect(within(detay).queryAllByRole('button')).toEqual([]);
    expect(within(detay).queryByRole('textbox')).toBeNull();
    const kutular = within(detay).getAllByRole('checkbox') as HTMLInputElement[];
    expect(kutular).toHaveLength(2);
    for (const k of kutular) expect(k.disabled).toBe(true);
  });

  it('müşteriye görünen not: mevcut not detayda; «Notu kaydet» AYNI aşamayla ve satırın `surum`\'uyla yazar; değişmemiş not kaydedilemez', async () => {
    const t = talep({ durum: 'sevk', durumSurum: 9, durumAciklama: 'Aras Kargo ile yola çıktı' });
    ciz([t]);
    const detay = detayAc();
    expect(within(detay).getByText('Müşteriye görünen not').nextElementSibling?.textContent).toBe('Aras Kargo ile yola çıktı');
    const kutu = within(detay).getByRole('textbox') as HTMLInputElement;
    expect(kutu.value).toBe('Aras Kargo ile yola çıktı');
    expect(kutu.maxLength).toBe(500);
    const kaydet = within(detay).getByRole('button', { name: 'Notu kaydet' }) as HTMLButtonElement;
    expect(kaydet.disabled).toBe(true);

    fireEvent.change(kutu, { target: { value: 'Yarın öğleden sonra teslim' } });
    expect(kaydet.disabled).toBe(false);
    await tikla(kaydet);
    expect(durumYaz).toHaveBeenCalledTimes(1);
    expect(durumYaz).toHaveBeenCalledWith(t.id, { onceki: 'sevk', surum: 9, durum: 'sevk', aciklama: 'Yarın öğleden sonra teslim' });
    // İyimser güncelleme YOK: saklanan not akış gelene kadar eski metindir; yazılan taslak kutuda durur (yanıp sönmez).
    expect(within(detay).getByText('Müşteriye görünen not').nextElementSibling?.textContent).toBe('Aras Kargo ile yola çıktı');
    expect(kutu.value).toBe('Yarın öğleden sonra teslim');
  });

  it('not: akış yeni sürümü getirince kutu SAKLANAN metne döner; boş kaydetmek `aciklama: \'\'` gönderir (siler)', async () => {
    const t = talep({ durum: 'teyit', durumSurum: 2, durumAciklama: 'Eski not' });
    const { rerender } = ciz([t]);
    const detay = detayAc();
    const kutu = within(detay).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(kutu, { target: { value: '  yeni   not ' } });
    await tikla(within(detay).getByRole('button', { name: 'Notu kaydet' }));
    // Sunucu metni temizleyip yazdı; akış sürüm 3'ü getirdi.
    rerender(<Ekran talepler={[{ ...t, durumSurum: 3, durumAciklama: 'yeni not' }]} />);
    expect(kutu.value).toBe('yeni not');
    expect((within(detay).getByRole('button', { name: 'Notu kaydet' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(kutu, { target: { value: '' } });
    await tikla(within(detay).getByRole('button', { name: 'Notu kaydet' }));
    expect(durumYaz).toHaveBeenLastCalledWith(t.id, { onceki: 'teyit', surum: 3, durum: 'teyit', aciklama: '' });
  });

  it('409 `gecis-yok`: «başka biri değiştirdi» uyarısı; rozet yanıttaki GÜNCEL aşamayı hemen basar; akış gelince belgeye döner', async () => {
    durumYaz.mockResolvedValue({ ok: false, kod: 'gecis-yok', durum: 'sevk' });
    const t = talep({ durum: 'yeni', durumSurum: 1 });
    const { rerender } = ciz([t]);
    await tikla(dugme('İlerlet: Teyit edildi'));
    expect(screen.getByRole('alert').textContent).toBe('Başka biri değiştirdi — liste güncelleniyor; güncel durumu görüp yeniden deneyin.');
    const rozet = () => within(satirlar()[0]).getByText('Talep no').parentElement?.lastElementChild?.textContent;
    expect(rozet()).toBe('Sevk edildi');
    // Bayat sürümle ikinci istek yine 409 alırdı: akış gelene kadar düğme kilitli.
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(true);

    rerender(<Ekran talepler={[{ ...t, durum: 'hazirlaniyor', durumSurum: 5 }]} />);
    expect(rozet()).toBe('Hazırlanıyor');                       // akışın getirdiği belge, yanıttaki değer değil
    expect(dugme('İlerlet: Sevk edildi').disabled).toBe(false);
  });

  it('409 sonrası akış 5 sn içinde GELMEZSE düğme kilidi açılır ama rozet sunucunun bildirdiği aşamada KALIR (bayat aşamaya dönmez); akış yeni sürümü getirince belgeye döner (inceleme 2026-10-10)', async () => {
    durumYaz.mockResolvedValue({ ok: false, kod: 'gecis-yok', durum: 'hazirlaniyor' });
    const t = talep({ durum: 'yeni', durumSurum: 1 });
    const { rerender } = ciz([t]);
    await tikla(dugme('İlerlet: Teyit edildi'));
    const rozet = () => within(satirlar()[0]).getByText('Talep no').parentElement?.lastElementChild?.textContent;
    expect(rozet()).toBe('Hazırlanıyor');
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(true);

    // Akış gelmedi, kilit doldu: düğme açılır; rozet SÜREYE değil SÜRÜME bağlıdır (süreye bağlıyken «Yeni»ye dönüyordu).
    act(() => { vi.advanceTimersByTime(MAGAZA_AKIS_BEKLEME_MS); });
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(false);
    expect(rozet()).toBe('Hazırlanıyor');
    expect(screen.getByRole('alert').textContent).toMatch(/^Başka biri değiştirdi/);
    // Detaydaki rozet de AYNI değerden beslenir.
    const detay = detayAc();
    expect(within(detay).getByText('Durum').nextElementSibling?.textContent).toBe('Hazırlanıyor');
    // Akış AYNI sürümü yeniden getirirse (ör. bildirim alanı değişti) rozet yerinde kalır…
    rerender(<Ekran talepler={[{ ...t, not: 'başka alan değişti' }]} />);
    expect(rozet()).toBe('Hazırlanıyor');
    // …yeni sürümü getirince akışın belgesine döner (yanıttaki değer değil).
    rerender(<Ekran talepler={[{ ...t, durum: 'sevk', durumSurum: 4 }]} />);
    expect(rozet()).toBe('Sevk edildi');
    expect(within(detay).getByText('Durum').nextElementSibling?.textContent).toBe('Sevk edildi');
  });

  it('409 gövdesinde aşama yoksa rozet DEĞİŞMEZ (bilinmeyen aşama uydurulmaz); uyarı yine basılır', async () => {
    durumYaz.mockResolvedValue({ ok: false, kod: 'gecis-yok' });
    ciz([talep({ durum: 'teyit' })]);
    await tikla(dugme('İlerlet: Hazırlanıyor'));
    expect(screen.getByRole('alert').textContent).toMatch(/^Başka biri değiştirdi/);
    expect(within(satirlar()[0]).getByText('Talep no').parentElement?.lastElementChild?.textContent).toBe('Teyit edildi');
  });

  it('akış HİÇ gelmezse kilit `MAGAZA_AKIS_BEKLEME_MS` sonra açılır (düğmeler sonsuza dek pasif kalmaz)', async () => {
    expect(MAGAZA_AKIS_BEKLEME_MS).toBe(5_000);
    ciz([talep({ durum: 'yeni' })]);
    await tikla(dugme('İlerlet: Teyit edildi'));
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(MAGAZA_AKIS_BEKLEME_MS - 1); });
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(false);
  });

  it('istek dönene kadar düğme pasif; ikinci tıklama istek ÜRETMEZ; başarıda ileti yok (sonuç akıştan gelir)', async () => {
    let coz: (s: MagazaDurumSonucu) => void = () => {};
    durumYaz.mockReturnValue(new Promise<MagazaDurumSonucu>(r => { coz = r; }));
    const t = talep({ durum: 'yeni' });
    const { rerender } = ciz([t]);
    await tikla(dugme('İlerlet: Teyit edildi'));
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(true);
    await tikla(dugme('İlerlet: Teyit edildi'));
    expect(durumYaz).toHaveBeenCalledTimes(1);
    // İyimser güncelleme YOK: rozet hâlâ «Yeni».
    expect(within(satirlar()[0]).getByText('Talep no').parentElement?.lastElementChild?.textContent).toBe('Yeni');

    await act(async () => { coz({ ok: true }); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<Ekran talepler={[{ ...t, durum: 'teyit', durumSurum: 1 }]} />);
    expect(dugme('İlerlet: Hazırlanıyor').disabled).toBe(false);
  });

  it('`yetki` / `ag` / `bulunamadi` / `silindi` AYRI metin basar; nitelik fırlatırsa «bağlantı hatası»', async () => {
    const metinler: Array<[MagazaDurumSonucu, string]> = [
      [{ ok: false, kod: 'yetki' }, 'Bu işlem için yetkiniz yok.'],
      [{ ok: false, kod: 'ag' }, 'Bağlantı hatası, yeniden deneyin.'],
      [{ ok: false, kod: 'bulunamadi' }, 'Talep bulunamadı.'],
      [{ ok: false, kod: 'silindi' }, 'Talep silinmiş; işlem yapılamaz.'],
    ];
    for (const [sonuc, metin] of metinler) {
      durumYaz.mockResolvedValue(sonuc);
      const { unmount } = ciz([talep({ durum: 'yeni' })]);
      await tikla(dugme('İlerlet: Teyit edildi'));
      expect(screen.getByRole('alert').textContent).toBe(metin);
      // Bu sonuçlar sürümü bayatlatmaz: düğme yeniden denenebilir.
      expect(dugme('İlerlet: Teyit edildi').disabled).toBe(false);
      unmount();
    }
    durumYaz.mockRejectedValue(new Error('ağ koptu'));
    ciz([talep({ durum: 'yeni' })]);
    await tikla(dugme('İlerlet: Teyit edildi'));
    expect(screen.getByRole('alert').textContent).toBe('Bağlantı hatası, yeniden deneyin.');
  });

  it('`sevk` → `teslim`: işaretsiz kalem varken ÖNCE «N kalem teslim işaretsiz» uyarısı — engel değil, onayla geçiş yine gönderilir', async () => {
    const t = talep({ durum: 'sevk', durumSurum: 6, kalemTeslim: { 'b:0': isaret('teslim', once(5)) } });
    ciz([t]);
    await tikla(dugme('İlerlet: Teslim edildi'));
    expect(durumYaz).not.toHaveBeenCalled();
    const uyari = screen.getByRole('alert');
    expect(uyari.textContent).toContain('1 kalem teslim işaretsiz.');
    expect(uyari.textContent).toContain('İşaretsiz kalemler kendiliğinden işaretlenmez.');

    await tikla(within(uyari).getByRole('button', { name: 'Yine de ilerlet' }));
    expect(durumYaz).toHaveBeenCalledTimes(1);
    expect(durumYaz).toHaveBeenCalledWith(t.id, { onceki: 'sevk', surum: 6, durum: 'teslim' });
    // İşaretsiz kalem OTOMATİK işaretlenmedi: kalem teslim isteği atılmadı.
    expect(teslimYaz).not.toHaveBeenCalled();
    expect(screen.queryByText(/kalem teslim işaretsiz/)).toBeNull();
  });

  it('«Vazgeç» istek atmaz ve uyarıyı kapatır; bütün kalemler işaretliyken (0) uyarı YOK, geçiş doğrudan gider', async () => {
    const yarim = talep({ durum: 'sevk' });
    const { unmount } = ciz([yarim]);
    await tikla(dugme('İlerlet: Teslim edildi'));
    expect(screen.getByRole('alert').textContent).toContain('2 kalem teslim işaretsiz.');
    await tikla(within(screen.getByRole('alert')).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(durumYaz).not.toHaveBeenCalled();
    unmount();

    const tam = talep({ durum: 'sevk', kalemTeslim: { 'b:0': isaret('teslim', once(5)), 'b:1': isaret('teslim', once(4)) } });
    ciz([tam]);
    await tikla(dugme('İlerlet: Teslim edildi'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(durumYaz).toHaveBeenCalledWith(tam.id, { onceki: 'sevk', surum: 0, durum: 'teslim' });
  });

  it('bütün kalemler işaretlenince ekran aşamayı kendiliğinden İLERLETMEZ', () => {
    const t = talep({ durum: 'sevk', kalemTeslim: { 'b:0': isaret('teslim', once(5)) } });
    const { rerender } = ciz([t]);
    rerender(<Ekran talepler={[{ ...t, durumSurum: 1, kalemTeslim: { 'b:0': isaret('teslim', once(5)), 'b:1': isaret('teslim', once(1)) } }]} />);
    expect(durumYaz).not.toHaveBeenCalled();
    expect(within(satirlar()[0]).getByText('Talep no').parentElement?.lastElementChild?.textContent).toBe('Sevk edildi');
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
    // Dilim 2a: altıncı sütun «Teslim» (kalem teslim kutusu + rozeti); ilk beş sütun dilim 1 ile AYNI.
    expect(within(satir[0]).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Stok kodu', 'Ürün', 'Marka', 'Adet', 'Birim fiyat (sitede görülen)', 'Teslim']);
    expect(within(satir[1]).getAllByRole('cell').map(h => h.textContent)).toEqual(['DYO-0001', 'İç cephe boyası', 'DYO', '2', '₺204,99', 'bekliyor']);
    expect(within(satir[2]).getAllByRole('cell').map(h => h.textContent)).toEqual(['FRC-12', 'Fırça', 'İzmir Fırça', '1', '₺120,00', 'bekliyor']);

    expect(within(detay).getByText('Talep edilen tutarlar — müşterinin sitede gördüğü')).toBeTruthy();
    expect(alan('Ara toplam')).toBe('₺529,98');
    expect(alan('KDV')).toBe('₺106,00');
    expect(alan('Toplam')).toBe('₺635,98');
    expect(detay.textContent).toContain('Bildirim e-postası gönderildi');
  });

  it('aşama bölümü: «Takip telefonu (son 10 hane)», mevcut not, son değiştiren (geçmişin SON girişi) ve «Son güncelleme»', () => {
    const t = talep({
      durum: 'hazirlaniyor',
      telefonSon10: '5321112233',
      durumAciklama: 'Perşembe hazır olur',
      durumZamani: once(30),
      durumGecmisi: [
        { onceki: 'yeni', yeni: 'teyit', zaman: once(45), kim: { uid: 'u-1', ad: 'Mehmet Öztürk' }, kanal: 'erp' },
        { onceki: 'teyit', yeni: 'hazirlaniyor', zaman: once(30), kim: { uid: 'u-2', ad: 'Ayşe Yılmaz' }, kanal: 'panel' },
      ],
    });
    ciz([t]);
    const detay = detayAc();
    const alan = (etiket: string) => within(detay).getByText(etiket).nextElementSibling?.textContent;
    expect(alan('Durum')).toBe('Hazırlanıyor');
    expect(alan('Takip telefonu (son 10 hane)')).toBe('5321112233');
    expect(alan('Müşteriye görünen not')).toBe('Perşembe hazır olur');
    expect(alan('Son değiştiren')).toBe(`Ayşe Yılmaz · ${tarihSaatYaz(once(30))} · site paneli`);
    expect(alan('Son güncelleme')).toBe(tarihSaatYaz(once(30)));
  });

  it('dilim 1 kaydı (geçmiş, not, aşama zamanı yok): son değiştiren ve not \'—\'; «Son güncelleme» kayıt saatidir', () => {
    const t = talep({ olusturma: once(60) });
    ciz([t]);
    const detay = detayAc();
    const alan = (etiket: string) => within(detay).getByText(etiket).nextElementSibling?.textContent;
    expect(alan('Son değiştiren')).toBe('—');
    expect(alan('Müşteriye görünen not')).toBe('—');
    expect(alan('Son güncelleme')).toBe(tarihSaatYaz(once(60)));
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

  it('giriş alanları SAYILIDIR: detay kapalıyken tek `input[type=search]`; açıkken + not kutusu + kalem başına bir onay kutusu; `form` / `select` / `textarea` hiç yok', () => {
    const { container } = ciz([talep(), talep()]);
    const turler = () => [...container.querySelectorAll('input')].map(i => i.getAttribute('type'));
    expect(turler()).toEqual(['search']);
    detayAc(0);
    expect(satirlar()).toHaveLength(2);
    for (const s of satirlar()) expect(s.hasAttribute('aria-expanded')).toBe(true);
    expect(turler()).toEqual(['search', 'text', 'checkbox', 'checkbox']);
    expect(container.querySelector('select, textarea, form')).toBeNull();
    // İçerik (müşteri, kalem, tutar) bu dilimde DEĞİŞMEZ: tek metin kutusu müşteriye görünen nottur.
    expect((container.querySelector('input[type=text]') as HTMLInputElement).labels?.[0]?.textContent).toMatch(/^Notu değiştir/);
  });

  it('«Etiket basıldı SS:DD (n koli)»: `koli` yokken parantez yok; `null` iken satır YOK; ERP\'de etiket BASMA düğmesi yok', () => {
    // Saat yerel saat diliminde basılır: beklenti saat dilimine takılmasın diye an YEREL saatle kurulur.
    const zaman = new Date(2026, 9, 8, 14, 5, 0).toISOString();
    const { unmount } = ciz([talep({ etiketBasildi: { zaman, koli: 3, kim: { uid: 'u-9', panel: true } } })]);
    const detay = detayAc();
    const satir = within(detay).getByText('Etiket basıldı 14:05 (3 koli)');
    expect(satir.getAttribute('title')).toBe(tarihSaatYaz(zaman));       // tam tarih-saat ipucunda (dünkü etiket karışmasın)
    expect(detay.textContent).not.toContain('u-9');                       // `kim` basılmaz (panel işlemidir)
    expect(dugmeVarMi(/etiket/i)).toBe(false);
    unmount();

    const b = ciz([talep({ etiketBasildi: { zaman, kim: { panel: true } } })]);
    expect(within(detayAc()).getByText('Etiket basıldı 14:05')).toBeTruthy();
    b.unmount();

    const c = ciz([talep({ etiketBasildi: { zaman, koli: 1, kim: {} } })], 'en');
    expect(within(detayAc()).getByText('Label printed 14:05 (1 parcel)')).toBeTruthy();
    c.unmount();

    ciz([talep({ etiketBasildi: null })]);
    expect(detayAc().textContent).not.toMatch(/Etiket basıldı/);
    expect(dugmeVarMi(/etiket/i)).toBe(false);
  });
});

// ── Kalem teslim ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — kalem teslim işareti', () => {
  const ucKalem = () => [kalem(), kalem({ id: 'u2', sku: 'FRC-12', ad: 'Fırça' }), kalem({ id: 'u3', sku: 'RUL-5', ad: '' })];
  const kutular = (detay: HTMLElement) => within(detay).getAllByRole('checkbox') as HTMLInputElement[];

  it('her kalemde «teslim edildi» kutusu; işaret `kalemTeslim`\'den: girişi olmayan ve `bekliyor` girişli kalem işaretsiz', () => {
    ciz([talep({ durum: 'sevk', kalemler: ucKalem(), kalemTeslim: { 'b:0': isaret('teslim', once(5)), 'b:2': isaret('bekliyor', once(3), 'Kaldıran Kişi') } })]);
    const detay = detayAc();
    // Kaynak etiketi iki yerde: görünen başlık ve tablonun (ekran okuyucu) başlığı.
    expect(within(detay).getAllByText('Kalemler — müşteri beyanı')).toHaveLength(2);
    expect(within(detay).getByRole('table', { name: 'Kalemler — müşteri beyanı' })).toBeTruthy();
    expect(kutular(detay).map(k => k.checked)).toEqual([true, false, false]);
    expect(kutular(detay).map(k => k.getAttribute('aria-label'))).toEqual(['Teslim edildi: İç cephe boyası', 'Teslim edildi: Fırça', 'Teslim edildi: 3. kalem']);
    expect(within(detay).getByText('1 / 3 kalem teslim')).toBeTruthy();
    // İşaretli kalemin yanında işareti verenin adı ve zamanı; işaret KALDIRANIN adı basılmaz.
    const hucre = (i: number) => within(within(detay).getAllByRole('row')[i + 1]).getAllByRole('cell')[5].textContent;
    expect(hucre(0)).toBe(`teslim edildiAyşe Yılmaz · ${tarihSaatYaz(once(5))}`);
    expect(hucre(1)).toBe('bekliyor');
    expect(hucre(2)).toBe('bekliyor');
    expect(detay.textContent).not.toContain('Kaldıran Kişi');
  });

  it('kutuya tıklama → TAM 1 istek: `{ surum: <satırın sürümü>, teslim, kalemler: [\'b:<dizin>\'] }`; kaldırma `teslim: false`', async () => {
    const t = talep({ durum: 'sevk', durumSurum: 11, kalemler: ucKalem(), kalemTeslim: { 'b:0': isaret('teslim', once(5)) } });
    const { rerender } = ciz([t]);
    const detay = detayAc();
    await tikla(kutular(detay)[1]);
    expect(teslimYaz).toHaveBeenCalledTimes(1);
    expect(teslimYaz).toHaveBeenCalledWith(t.id, { surum: 11, teslim: true, kalemler: ['b:1'] });
    // İyimser işaret YOK: kutu akış gelene kadar işaretsiz ve kilitli (ikinci tıklama kuyruğa alınmaz).
    expect(kutular(detay).map(k => k.checked)).toEqual([true, false, false]);
    expect(kutular(detay).every(k => k.disabled)).toBe(true);
    await tikla(kutular(detay)[2]);
    expect(teslimYaz).toHaveBeenCalledTimes(1);

    // Akış sürüm 12'yi getirdi: işaret belgeden çizilir, kutular açılır; sonraki yazım YENİ sürümü gönderir.
    rerender(<Ekran talepler={[{ ...t, durumSurum: 12, kalemTeslim: { ...t.kalemTeslim, 'b:1': isaret('teslim', once(0)) } }]} />);
    expect(kutular(detay).map(k => k.checked)).toEqual([true, true, false]);
    expect(kutular(detay).some(k => k.disabled)).toBe(false);
    await tikla(kutular(detay)[0]);
    expect(teslimYaz).toHaveBeenLastCalledWith(t.id, { surum: 12, teslim: false, kalemler: ['b:0'] });
    expect(durumYaz).not.toHaveBeenCalled();
  });

  it('«Tümünü işaretle» → TAM 1 istek, `kalemler: \'hepsi\'` (kalem başına istek YOK)', async () => {
    const t = talep({ durum: 'hazirlaniyor', durumSurum: 2, kalemler: ucKalem(), kalemTeslim: { 'b:0': isaret('teslim', once(5)) } });
    ciz([t]);
    const detay = detayAc();
    // Kısmi işaretli listede «Tümünü kaldır» YOK.
    expect(within(detay).queryByRole('button', { name: 'Tümünü kaldır' })).toBeNull();
    await tikla(within(detay).getByRole('button', { name: 'Tümünü işaretle' }));
    expect(teslimYaz).toHaveBeenCalledTimes(1);
    expect(teslimYaz).toHaveBeenCalledWith(t.id, { surum: 2, teslim: true, kalemler: 'hepsi' });
  });

  it('«Tümünü kaldır» YALNIZ bütün kalemler işaretliyken çizilir → TAM 1 istek, `\'hepsi\'`, `teslim: false`', async () => {
    const t = talep({ durum: 'teslim', durumSurum: 8, kalemTeslim: { 'b:0': isaret('teslim', once(5)), 'b:1': isaret('teslim', once(4)) } });
    ciz([t]);
    fireEvent.click(dugme(/^Hepsi/));
    const detay = detayAc();
    expect(within(detay).getByText('2 / 2 kalem teslim')).toBeTruthy();
    expect(within(detay).queryByRole('button', { name: 'Tümünü işaretle' })).toBeNull();
    await tikla(within(detay).getByRole('button', { name: 'Tümünü kaldır' }));
    expect(teslimYaz).toHaveBeenCalledTimes(1);
    expect(teslimYaz).toHaveBeenCalledWith(t.id, { surum: 8, teslim: false, kalemler: 'hepsi' });
  });

  it('409 `gecis-yok` / `gecersiz` / `surum-eski`: AYNI «başka biri değiştirdi» uyarısı; kutu eski değerinde kalır', async () => {
    const sonuclar: MagazaKalemTeslimSonucu[] = [
      { ok: false, kod: 'gecis-yok', durum: 'iptal' },
      { ok: false, kod: 'gecersiz' },
      { ok: false, kod: 'surum-eski' },
    ];
    for (const sonuc of sonuclar) {
      teslimYaz.mockResolvedValue(sonuc);
      const { unmount } = ciz([talep({ durum: 'sevk' })]);
      const detay = detayAc();
      await tikla(kutular(detay)[0]);
      expect(screen.getByRole('alert').textContent, sonuc.ok ? '' : sonuc.kod).toBe('Başka biri değiştirdi — liste güncelleniyor; güncel durumu görüp yeniden deneyin.');
      expect(kutular(detay).map(k => k.checked)).toEqual([false, false]);
      // 409 gövdesindeki güncel aşama rozete hemen yansır (yalnız `gecis-yok` aşama taşır).
      expect(within(detay).getByText('Durum').nextElementSibling?.textContent).toBe(!sonuc.ok && sonuc.kod === 'gecis-yok' ? 'İptal edildi' : 'Sevk edildi');
      unmount();
    }
  });

  it('`yetki` → «yetkiniz yok», `ag` → «bağlantı hatası»: kutu önceki hâlinde ve yeniden denenebilir', async () => {
    for (const [sonuc, metin] of [[{ ok: false, kod: 'yetki' }, 'Bu işlem için yetkiniz yok.'], [{ ok: false, kod: 'ag' }, 'Bağlantı hatası, yeniden deneyin.']] as Array<[MagazaKalemTeslimSonucu, string]>) {
      teslimYaz.mockResolvedValue(sonuc);
      const { unmount } = ciz([talep({ durum: 'sevk' })]);
      const detay = detayAc();
      await tikla(kutular(detay)[1]);
      expect(screen.getByRole('alert').textContent).toBe(metin);
      expect(kutular(detay).map(k => k.checked)).toEqual([false, false]);
      expect(kutular(detay).some(k => k.disabled)).toBe(false);
      unmount();
    }
  });

  it('`iptal` aşamasında kutular PASİF ve toplu düğme yok; `yeni` ve `teslim` dâhil diğer beş aşamada etkin', async () => {
    for (const durum of MAGAZA_TALEP_ASAMALARI) {
      teslimYaz.mockClear();
      const { unmount } = ciz([talep({ durum, iptalOncesi: durum === 'iptal' ? 'sevk' : null })]);
      fireEvent.click(dugme(/^Hepsi/));
      const detay = detayAc();
      expect(kutular(detay).map(k => k.disabled), durum).toEqual(durum === 'iptal' ? [true, true] : [false, false]);
      expect(within(detay).queryByRole('button', { name: 'Tümünü işaretle' }) !== null, durum).toBe(durum !== 'iptal');
      // Pasif kutuya ulaşan olay da istek ÜRETMEZ (kural işleyicide de durur; yalnız `disabled` niteliğine güvenilmez).
      await tikla(kutular(detay)[0]);
      expect(teslimYaz.mock.calls.length, durum).toBe(durum === 'iptal' ? 0 : 1);
      unmount();
    }
  });

  it('«Son güncelleme» kalem zamanını gösterir (aşama zamanından yeniyse); işaret aşama geçmişine girmez', () => {
    const t = talep({
      durum: 'sevk', durumZamani: once(30),
      durumGecmisi: [{ onceki: 'hazirlaniyor', yeni: 'sevk', zaman: once(30), kim: { uid: 'u-1', ad: 'Mehmet Öztürk' }, kanal: 'erp' }],
      kalemTeslim: { 'b:1': isaret('teslim', once(5)) },
    });
    ciz([t]);
    const detay = detayAc();
    expect(tarihSaatYaz(once(5))).not.toBe(tarihSaatYaz(once(30)));
    expect(within(detay).getByText('Son güncelleme').nextElementSibling?.textContent).toBe(tarihSaatYaz(once(5)));
    // «Son değiştiren» aşama geçmişinden gelir; kalem işaretini verenin adı orada görünmez.
    expect(within(detay).getByText('Son değiştiren').nextElementSibling?.textContent).toBe(`Mehmet Öztürk · ${tarihSaatYaz(once(30))} · ERP`);
  });

  it('kalemi olmayan talepte sayaç ve toplu düğme çizilmez', () => {
    ciz([talep({ kalemler: [] })]);
    const detay = detayAc();
    expect(within(detay).queryByRole('checkbox')).toBeNull();
    expect(within(detay).queryByText(/kalem teslim$/)).toBeNull();
    expect(within(detay).queryByRole('button', { name: /^Tümünü/ })).toBeNull();
    expect(within(detay).getByText('Kalem okunamadı.')).toBeTruthy();
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

  it('`yapilandirilmamis` açıklaması «Sunucu posta ayarı eksik; Yeniden gönder ile denenebilir» — hangi ayarın eksik olduğunu TAHMİN ETMEZ', () => {
    const { unmount } = ciz([talep({ bildirim: { durum: 'yapilandirilmamis', zaman: once(20) } })]);
    const detay = detayAc();
    expect(detay.textContent).toContain('Sunucu posta ayarı eksik; Yeniden gönder ile denenebilir. Bu talep için e-posta gitmedi.');
    expect(detay.textContent).not.toMatch(/SMTP|APP_URL/);
    unmount();
    ciz([talep({ bildirim: { durum: 'yapilandirilmamis', zaman: once(20) } })], 'en');
    expect(detayAc().textContent).toContain('A server mail setting is missing; it can be retried with Resend.');
  });

  it('veri DEĞİŞMEDEN de (işçi durmuş) taze «gönderiliyor» eşik geçince «bildirim gönderilmedi»ye döner', () => {
    ciz([talep({ olusturma: once(9), bildirim: { durum: 'bekliyor', zaman: once(9) } })]);
    expect(rozet(satirlar()[0])?.textContent).toBe('gönderiliyor');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(rozet(satirlar()[0])?.textContent).toBe('gönderiliyor');          // 9,5 dk — henüz değil
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(rozet(satirlar()[0])?.textContent).toBe('bildirim gönderilmedi');  // 10,5 dk
  });

  describe('saf kural — bildirimGorunumu(b, taban, simdiMs)', () => {
    const b = (durum: 'bekliyor' | 'gitti' | 'gonderilemedi' | 'yapilandirilmamis', zaman: string) => ({ durum, zaman });
    it('sınır: tam 10 dakika hâlâ taze; 1 ms sonrası uyarı', () => {
      const t = { olusturma: once(0), bildirim: b('bekliyor', once(0)) };
      expect(bildirimGorunumu(t.bildirim, t.olusturma, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS)).toEqual({ tur: 'gonderiliyor' });
      expect(bildirimGorunumu(t.bildirim, t.olusturma, SIMDI + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1)).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
    });
    it('bekleme `max(olusturma, bildirim.zaman)`\'dan ölçülür: 40 dakikalık talebin son denemesi 1 dakika önceyse «gönderiliyor»', () => {
      expect(bildirimGorunumu(b('bekliyor', once(1)), once(40), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    });
    it('elle gönderim sonrası: 1 günlük talep + `zaman` şimdi → «gönderiliyor», düğme YOK; `zaman` 11 dk önce → «bekleme aşıldı», düğme VAR', () => {
      const taze = bildirimGorunumu(b('bekliyor', once(0)), once(24 * 60), SIMDI);
      expect(taze).toEqual({ tur: 'gonderiliyor' });
      expect(magazaYenidenGonderilebilir(taze)).toBe(false);
      const eski = bildirimGorunumu(b('bekliyor', once(11)), once(24 * 60), SIMDI);
      expect(eski).toEqual({ tur: 'uyari', neden: 'bekleme-asildi' });
      expect(magazaYenidenGonderilebilir(eski)).toBe(true);
    });
    it('ikisi de çözülmüyorsa `okunamadi` (taze SAYILMAZ, düğme de yok); biri okunamıyorsa diğerine bakılır', () => {
      const okunamadi = bildirimGorunumu(b('bekliyor', ''), 'bozuk', SIMDI);
      expect(okunamadi).toEqual({ tur: 'uyari', neden: 'okunamadi' });
      expect(magazaYenidenGonderilebilir(okunamadi)).toBe(false);
      expect(bildirimGorunumu(b('bekliyor', once(3)), 'bozuk', SIMDI)).toEqual({ tur: 'gonderiliyor' });
      expect(bildirimGorunumu(b('bekliyor', ''), once(3), SIMDI)).toEqual({ tur: 'gonderiliyor' });
    });
    it('kesin durumlar saate bakmaz', () => {
      expect(bildirimGorunumu(b('gitti', once(899)), once(900), SIMDI)).toEqual({ tur: 'isaretsiz' });
      expect(bildirimGorunumu(b('gonderilemedi', once(0)), once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'gonderilemedi' });
      expect(bildirimGorunumu(b('yapilandirilmamis', once(0)), once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'yapilandirilmamis' });
      expect(bildirimGorunumu(null, once(0), SIMDI)).toEqual({ tur: 'uyari', neden: 'okunamadi' });
    });
    it('«Yeniden gönder» kuralı rozetin SONUCUNDAN: `gonderilemedi` / `yapilandirilmamis` / süresi geçmiş `bekliyor` → var; `gitti` / taze `bekliyor` / okunamayan → yok; `deneme` kuralı değiştirmez', () => {
      const dugmeVar = (bildirim: Parameters<typeof bildirimGorunumu>[0], olusturma: string) => magazaYenidenGonderilebilir(bildirimGorunumu(bildirim, olusturma, SIMDI));
      expect(dugmeVar(b('gonderilemedi', once(1)), once(1))).toBe(true);
      expect(dugmeVar(b('yapilandirilmamis', once(1)), once(1))).toBe(true);
      expect(dugmeVar({ durum: 'bekliyor', zaman: new Date(SIMDI - MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS - 1).toISOString() }, once(600))).toBe(true);
      expect(dugmeVar(b('bekliyor', once(9)), once(600))).toBe(false);
      expect(dugmeVar({ durum: 'bekliyor', zaman: once(9), deneme: 4 }, once(600))).toBe(false);
      expect(dugmeVar({ durum: 'bekliyor', zaman: once(11), deneme: 4 }, once(600))).toBe(true);
      expect(dugmeVar(b('gitti', once(1)), once(1))).toBe(false);
      expect(dugmeVar(null, once(1))).toBe(false);
    });
    it('sonraki eşik: yalnız «gönderiliyor» görünenlerin EN YAKIN eşiği (`max` başlangıcından); yoksa null', () => {
      const taze3 = { olusturma: once(3), bildirim: b('bekliyor', once(3)) };
      const taze7 = { olusturma: once(7), bildirim: b('bekliyor', once(7)) };
      const eski = { olusturma: once(30), bildirim: b('bekliyor', once(30)) };
      const gitti = { olusturma: once(1), bildirim: b('gitti', once(1)) };
      expect(sonrakiBeklemeEsigi([taze3, eski, taze7, gitti], SIMDI)).toBe(SIMDI - 7 * 60_000 + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS);
      expect(sonrakiBeklemeEsigi([eski, gitti], SIMDI)).toBeNull();
      expect(sonrakiBeklemeEsigi([], SIMDI)).toBeNull();
      // Eski talebin taze denemesi: eşik denemenin saatinden ölçülür (kayıt saatinden değil).
      expect(sonrakiBeklemeEsigi([{ olusturma: once(600), bildirim: b('bekliyor', once(4)) }], SIMDI)).toBe(SIMDI - 4 * 60_000 + MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS);
    });
  });
});

// ── «Yeniden gönder» ────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — «Yeniden gönder» (V22)', () => {
  const YENIDEN = /yeniden gönder/i;

  it('düğme `gonderilemedi` / `yapilandirilmamis` / süresi geçmiş `bekliyor` rozetinde ÇİZİLİR', () => {
    for (const bildirim of [
      { durum: 'gonderilemedi' as const, zaman: once(20), deneme: 8 },
      { durum: 'yapilandirilmamis' as const, zaman: once(20) },
      { durum: 'bekliyor' as const, zaman: once(11) },
    ]) {
      const { unmount } = ciz([talep({ olusturma: once(30), bildirim })]);
      expect(dugmeVarMi(YENIDEN), bildirim.durum).toBe(true);
      // Düğme satır düğmesinin kardeşidir (rozet satırın içinde; düğme iç içe olamaz).
      expect(satirlar()[0].contains(dugme(YENIDEN))).toBe(false);
      unmount();
    }
  });

  it('`gitti`, taze `bekliyor` («gönderiliyor») ve okunamayan durumda ÇİZİLMEZ (çift posta çiti)', () => {
    for (const bildirim of [{ durum: 'gitti' as const, zaman: once(20) }, { durum: 'bekliyor' as const, zaman: once(2) }, null]) {
      const { unmount } = ciz([talep({ olusturma: once(30), bildirim })]);
      expect(dugmeVarMi(YENIDEN), String(bildirim?.durum)).toBe(false);
      detayAc();
      expect(dugmeVarMi(YENIDEN), String(bildirim?.durum)).toBe(false);
      unmount();
    }
  });

  it('tıklama → `onBildirimGonder(id)` TAM 1 çağrı; istek dönene kadar düğme pasif, ikinci tıklama çağrı üretmez', async () => {
    let coz: (s: MagazaBildirimGonderSonucu) => void = () => {};
    bildirimGonder.mockReturnValue(new Promise<MagazaBildirimGonderSonucu>(r => { coz = r; }));
    const t = talep({ bildirim: { durum: 'gonderilemedi', zaman: once(20) } });
    ciz([t]);
    await tikla(dugme(YENIDEN));
    expect(bildirimGonder).toHaveBeenCalledTimes(1);
    expect(bildirimGonder).toHaveBeenCalledWith(t.id);
    expect(dugme(YENIDEN).disabled).toBe(true);
    await tikla(dugme(YENIDEN));
    expect(bildirimGonder).toHaveBeenCalledTimes(1);
    expect(durumYaz).not.toHaveBeenCalled();
    expect(teslimYaz).not.toHaveBeenCalled();

    await act(async () => { coz({ ok: true }); });
    expect(dugme(YENIDEN).disabled).toBe(false);
  });

  it('başarıda «Bildirim kuyruğa alındı» bilgisi; rozet DEĞİŞMEZ (iyimser rozet yok — akış bekler)', async () => {
    ciz([talep({ bildirim: { durum: 'gonderilemedi', zaman: once(20) } })]);
    await tikla(dugme(YENIDEN));
    expect(screen.getByRole('status').textContent).toBe('Bildirim kuyruğa alındı.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(satirlar()[0]).getByText('Bildirim').nextElementSibling?.textContent).toBe('bildirim gönderilmedi');
    expect(dugmeVarMi(YENIDEN)).toBe(true);
  });

  it('akıştan `bekliyor` + `zaman: şimdi` gelen 1 GÜN önceki talepte rozet «gönderiliyor», düğme YOK; 10 dk + 1 ms sonra rozet uyarı ve düğme VAR', async () => {
    const t = talep({ olusturma: once(24 * 60), bildirim: { durum: 'gonderilemedi', zaman: once(23 * 60) } });
    const { rerender } = ciz([t]);
    await tikla(dugme(YENIDEN));
    const rozet = () => within(satirlar()[0]).queryByText('Bildirim')?.nextElementSibling?.textContent;
    // Sunucu `bekliyor` + şimdi yazdı; akış belgeyi getirdi.
    rerender(<Ekran talepler={[{ ...t, bildirim: { durum: 'bekliyor', zaman: new Date(SIMDI).toISOString() } }]} />);
    expect(rozet()).toBe('gönderiliyor');
    expect(dugmeVarMi(YENIDEN)).toBe(false);

    // Eşikte tek zamanlayıcı yeniden çizer (10 dk + 1 sn pay).
    act(() => { vi.advanceTimersByTime(MAGAZA_BILDIRIM_BEKLEME_SINIRI_MS + 1000); });
    expect(rozet()).toBe('bildirim gönderilmedi');
    expect(dugmeVarMi(YENIDEN)).toBe(true);
  });

  it('sonuç metinleri — `yapilandirilmamis` yanıttaki ADLARI basar (değer yok; `eksik` boşsa iki nokta da yok); `kapali`da düğme kalır', async () => {
    const metinler: Array<[MagazaBildirimGonderSonucu, string, string]> = [
      [{ ok: false, kod: 'yapilandirilmamis', eksik: ['APP_URL'] }, 'Sunucu posta ayarı eksik: APP_URL', 'Server mail setting missing: APP_URL'],
      [{ ok: false, kod: 'yapilandirilmamis', eksik: ['SMTP_HOST', 'SMTP_PASS'] }, 'Sunucu posta ayarı eksik: SMTP_HOST, SMTP_PASS', 'Server mail setting missing: SMTP_HOST, SMTP_PASS'],
      [{ ok: false, kod: 'yapilandirilmamis', eksik: [] }, 'Sunucu posta ayarı eksik', 'Server mail setting missing'],
      [{ ok: false, kod: 'yapilandirilmamis' }, 'Sunucu posta ayarı eksik', 'Server mail setting missing'],
      [{ ok: false, kod: 'kapali' }, 'Bildirim bu sunucuda kapalı (MAGAZA_BILDIRIM=kapali)', 'Notifications are turned off on this server (MAGAZA_BILDIRIM=kapali)'],
      [{ ok: false, kod: 'zaten-gitti' }, 'Bildirim zaten gönderilmiş', 'The notification has already been sent'],
      [{ ok: false, kod: 'yetki' }, 'Bu işlem için yetkiniz yok.', 'You are not authorised for this action.'],
      [{ ok: false, kod: 'bulunamadi' }, 'Talep bulunamadı.', 'Request not found.'],
      [{ ok: false, kod: 'ag' }, 'Bağlantı hatası, yeniden deneyin.', 'Connection error, please try again.'],
    ];
    for (const [sonuc, turkce, ingilizce] of metinler) {
      for (const [dil, metin, ad] of [['tr', turkce, YENIDEN], ['en', ingilizce, 'Resend']] as const) {
        bildirimGonder.mockResolvedValue(sonuc);
        const { unmount } = ciz([talep({ bildirim: { durum: 'yapilandirilmamis', zaman: once(20) } })], dil);
        await tikla(dugme(ad));
        expect(screen.getByRole('alert').textContent, `${sonuc.ok ? '' : sonuc.kod} ${dil}`).toBe(metin);
        // Düğme kalır: ayar değişince (ya da bağlantı gelince) yeniden denenebilir; rozet akıştan değişene kadar aynıdır.
        expect(dugme(ad).disabled).toBe(false);
        unmount();
      }
    }
    // İngilizce arayüzde Türkçe ileti görünmez.
    bildirimGonder.mockResolvedValue({ ok: true });
    ciz([talep({ bildirim: { durum: 'gonderilemedi', zaman: once(20) } })], 'en');
    await tikla(dugme('Resend'));
    expect(screen.getByRole('status').textContent).toBe('Notification queued.');
  });

  it('bildirim yazımı sürümü ilerletmez: «Yeniden gönder» aşama düğmelerini KİLİTLEMEZ', async () => {
    ciz([talep({ durum: 'yeni', bildirim: { durum: 'gonderilemedi', zaman: once(20) } })]);
    await tikla(dugme(YENIDEN));
    expect(dugme('İlerlet: Teyit edildi').disabled).toBe(false);
  });
});

// ── Arama ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — arama kutusu ve barkod Enter (V23)', () => {
  const liste = () => [
    talep({ talepNo: 'T261008-CZZF', telefonSon10: '5321111234', musteri: { ...talep().musteri, ad: 'ŞİRİN YAPI', firma: '' }, olusturma: once(1) }),
    talep({ talepNo: 'T261009-ABCD', telefonSon10: '5329991234', musteri: { ...talep().musteri, ad: 'Işık Boya', firma: 'Işık Ticaret' }, olusturma: once(2) }),
    talep({ talepNo: 'T261009-KPLI', telefonSon10: '5550005678', musteri: { ...talep().musteri, ad: 'Mehmet Yılmaz', firma: '' }, olusturma: once(3), durum: 'teslim' }),
  ];
  const yaz = (metin: string) => fireEvent.change(aramaKutusu(), { target: { value: metin } });
  const enter = () => fireEvent.keyDown(aramaKutusu(), { key: 'Enter' });

  it('kutu `type="search"`; erişilebilir adı «Talep ara (no, telefon son 4 hane, müşteri)»; `form` yok', () => {
    const { container } = ciz(liste());
    expect(aramaKutusu().getAttribute('type')).toBe('search');
    expect(screen.getByRole('searchbox', { name: 'Talep ara (no, telefon son 4 hane, müşteri)' })).toBe(aramaKutusu());
    expect(container.querySelector('form')).toBeNull();
  });

  it('`CZZF` → yalnız `T261008-CZZF`; `1234` → telefonu …1234 ile biten İKİ satır; `şirin` → «ŞİRİN YAPI» (Türkçe küçültme)', () => {
    ciz(liste());
    expect(talepNolari()).toEqual(['T261008-CZZF', 'T261009-ABCD']);   // varsayılan «açık»
    yaz('CZZF');
    expect(talepNolari()).toEqual(['T261008-CZZF']);
    yaz('1234');
    expect(talepNolari()).toEqual(['T261008-CZZF', 'T261009-ABCD']);
    yaz('şirin');
    expect(talepNolari()).toEqual(['T261008-CZZF']);
    yaz('yok böyle biri');
    expect(talepNolari()).toEqual([]);
    expect(screen.getByText('Aramayla eşleşen talep yok.')).toBeTruthy();
  });

  it('KAPALI talep, durum süzgeci «açık»ken de arama metniyle çizilir; kutu boşalınca liste eski süzgece döner', () => {
    ciz(liste());
    yaz('KPLI');
    expect(talepNolari()).toEqual(['T261009-KPLI']);
    // Arama doluyken durum süzgeci yok sayılır: düğmeler pasif, geçerli olan «hepsi».
    expect(dugme(/^Hepsi/).getAttribute('aria-pressed')).toBe('true');
    expect(dugme(/^Açık/).disabled).toBe(true);
    yaz('');
    expect(talepNolari()).toEqual(['T261008-CZZF', 'T261009-ABCD']);
    expect(dugme(/^Açık/).getAttribute('aria-pressed')).toBe('true');
    expect(dugme(/^Açık/).disabled).toBe(false);
  });

  it('Enter: TAM 1 eşleşmede o talebin detayı açılır (`aria-expanded="true"`); barkod metni tam talep numarasıdır', () => {
    ciz(liste());
    yaz('T261009-KPLI');
    enter();
    expect(satirlar().map(s => s.getAttribute('aria-expanded'))).toEqual(['true']);
    expect(screen.getByRole('region', { name: 'T261009-KPLI talep detayı' })).toBeTruthy();
    // Liste süzülü kalır; ikinci Enter detayı KAPATMAZ.
    enter();
    expect(satirlar().map(s => s.getAttribute('aria-expanded'))).toEqual(['true']);
    expect(aramaKutusu().value).toBe('T261009-KPLI');
  });

  it('Enter: 0 ya da 2 eşleşmede hiçbir detay AÇILMAZ; boş kutuda da açılmaz', () => {
    ciz(liste());
    yaz('1234');
    enter();
    expect(satirlar().map(s => s.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    yaz('ZZZZ');
    enter();
    expect(satirlar()).toHaveLength(0);
    yaz('');
    enter();
    expect(satirlar().map(s => s.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  });

  it('Enter ve yazma istek ATMAZ: üç nitelikten hiçbiri çağrılmaz, `fetch` çağrılmaz, depolamaya yazılmaz', () => {
    const ag = vi.fn();
    vi.stubGlobal('fetch', ag);
    const depo = vi.spyOn(Storage.prototype, 'setItem');
    ciz(liste());
    yaz('CZZF');
    enter();
    expect(durumYaz).not.toHaveBeenCalled();
    expect(teslimYaz).not.toHaveBeenCalled();
    expect(bildirimGonder).not.toHaveBeenCalled();
    expect(ag).not.toHaveBeenCalled();
    expect(depo).not.toHaveBeenCalled();
  });

  it('«çizilmeyen açık talep» sayısı SÜZÜLMÜŞ kümeden: 205 eşleşmeden 200\'ü çizilir, 5 açık talep sayılır', () => {
    const cok = Array.from({ length: 205 }, (_, i) => talep({ talepNo: `T261008-${String(i).padStart(4, '0')}`, olusturma: once(i + 1), musteri: { ...talep().musteri, ad: 'ŞİRİN YAPI' } }));
    ciz([...cok, talep({ talepNo: 'T261008-DGER', olusturma: once(999), musteri: { ...talep().musteri, ad: 'Başka Müşteri', firma: '' } })]);
    yaz('şirin');
    expect(satirlar()).toHaveLength(200);
    expect(screen.getByText('Çizilmeyen 5 açık talep var — aramayla bulunabilir.')).toBeTruthy();
    yaz('DGER');
    expect(talepNolari()).toEqual(['T261008-DGER']);
    expect(screen.queryByText(/Çizilmeyen/)).toBeNull();
  });
});

// ── 200 sınırı ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri — ekran sınırı', () => {
  const cok = (n: number) => Array.from({ length: n }, (_, i) => talep({ talepNo: `T261008-${String(i).padStart(4, '0')}`, olusturma: once(i + 1) }));

  it('sınır 200', () => { expect(MAGAZA_TALEP_EKRAN_SINIRI).toBe(200); });

  it('205 talepten EN YENİ 200\'ü çizilir; kalan «daha eski 5 talep» diye SAYILIR (sessiz kırpma yok); çizilmeyen 5 AÇIK talep ayrıca yazılır', () => {
    ciz([...cok(205)].reverse());   // akış sırası rastgeledir: en eski önce verildi
    expect(satirlar()).toHaveLength(200);
    expect(satirlar()[0].textContent).toContain('T261008-0000');     // en yeni
    expect(satirlar()[199].textContent).toContain('T261008-0199');
    expect(screen.queryByText(/T261008-0200/)).toBeNull();
    expect(screen.getByText('En yeni 200 talep gösteriliyor — daha eski 5 talep bu listede çizilmedi.')).toBeTruthy();
    expect(screen.getByText('Çizilmeyen 5 açık talep var — aramayla bulunabilir.')).toBeTruthy();
    // Başlıktaki sayı çizilen değil TOPLAM talep sayısıdır.
    expect(screen.getByRole('heading', { name: /Mağaza Talepleri\s*205/ })).toBeTruthy();
  });

  it('tam 200 talepte «daha eski» notu YOK', () => {
    ciz(cok(200));
    expect(satirlar()).toHaveLength(200);
    expect(screen.queryByText(/daha eski/)).toBeNull();
    expect(screen.queryByText(/Çizilmeyen/)).toBeNull();
  });

  it('tarihi okunamayan talep «en yeni 200»e SAYILMAZ ve «daha eski» diye sayılmaz', () => {
    const g = magazaTalepGorunumu([...cok(201), talep({ talepNo: 'T261008-BOZK', olusturma: '' })]);
    expect(g.gorunen).toHaveLength(201);                                 // 200 tarihli + 1 tarihsiz
    expect(g.gorunen[200].talepNo).toBe('T261008-BOZK');
    expect(g.dahaEski).toBe(1);
    expect(g.gizliTarihsiz).toBe(0);
    expect(g.cizilmeyenAcik).toBe(1);
  });

  it('saf kural: eşit saatte sıra kimlikle SABİT; küçük sınırda sayım; çizilmeyen açıklar `magazaAcikMi` ile (okunamayan aşama açıktır)', () => {
    const a = talep({ id: 'mt-b', olusturma: once(5) }), b = talep({ id: 'mt-a', olusturma: once(5) }), c = talep({ id: 'mt-c', olusturma: once(1) });
    expect(magazaTalepGorunumu([a, b, c]).gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-a', 'mt-b']);
    expect(magazaTalepGorunumu([b, c, a]).gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-a', 'mt-b']);
    const g = magazaTalepGorunumu([a, b, c, talep({ id: 'mt-x', olusturma: '' }), talep({ id: 'mt-y', olusturma: 'bozuk' })], 1);
    expect(g.gorunen.map(t => t.id)).toEqual(['mt-c', 'mt-x']);
    expect(g.dahaEski).toBe(2);
    expect(g.gizliTarihsiz).toBe(1);
    expect(g.cizilmeyenAcik).toBe(3);
    const kapaliVar = magazaTalepGorunumu([c, talep({ id: 'mt-k', olusturma: once(9), durum: 'iptal' }), talep({ id: 'mt-n', olusturma: once(8), durum: null }), talep({ id: 'mt-t', olusturma: once(7), durum: 'teslim' })], 1);
    expect(kapaliVar.dahaEski).toBe(3);
    expect(kapaliVar.cizilmeyenAcik).toBe(1);   // yalnız aşaması okunamayan satır
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
      durumAciklama: zehir,
      kalemler: [kalem({ sku: zehir, ad: zehir, marka: zehir })],
      kalemTeslim: { 'b:0': isaret('teslim', once(1), zehir) },
      durumGecmisi: [{ onceki: 'yeni', yeni: 'teyit', zaman: once(2), kim: { uid: 'u', ad: zehir }, kanal: 'panel' }],
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

// ── Sekme rozeti ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('MagazaYeniRozeti — sekme düğmesindeki İKİ sayı: «görülmemiş» ve «yeni»', () => {
  it('iki sayı AYRI etiketle; `aria-label`\'lar düğmenin erişilebilir adına katılır', () => {
    render(<button type="button">Mağaza Talepleri <MagazaYeniRozeti sayi={3} yeni={5} currentLanguage="tr" /></button>);
    expect(screen.getByLabelText('3 görülmemiş talep').textContent).toBe('3 görülmemiş');
    expect(screen.getByLabelText('5 yeni talep').textContent).toBe('5 yeni');
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 3 görülmemiş talep 5 yeni talep' })).toBeTruthy();
  });

  it('sıfır olan sayı çizilmez; ikisi de 0 ise HİÇBİR ŞEY çizilmez; İngilizce tekil / çoğul', () => {
    const { container, rerender } = render(<MagazaYeniRozeti sayi={0} yeni={0} currentLanguage="tr" />);
    expect(container.firstChild).toBeNull();
    rerender(<MagazaYeniRozeti sayi={0} yeni={4} currentLanguage="tr" />);
    expect(container.textContent).toBe('4 yeni');
    rerender(<MagazaYeniRozeti sayi={2} yeni={0} currentLanguage="tr" />);
    expect(container.textContent).toBe('2 görülmemiş');
    rerender(<MagazaYeniRozeti sayi={1} yeni={1} currentLanguage="en" />);
    expect(screen.getByLabelText('1 unseen request').textContent).toBe('1 unseen');
    expect(screen.getByLabelText('1 new request').textContent).toBe('1 new');
    rerender(<MagazaYeniRozeti sayi={2} yeni={3} currentLanguage="en" />);
    expect(screen.getByLabelText('2 unseen requests')).toBeTruthy();
    expect(screen.getByLabelText('3 new requests')).toBeTruthy();
  });

  // OrdersPage'deki bağlantının küçük kopyası: «görülmemiş» kancadan (useMagazaYeniSayaci), «yeni» aşama sayısından.
  function SekmeDugmesi({ talepler, acik }: { talepler: MagazaTalepSatiri[]; acik: boolean }) {
    const sayi = useMagazaYeniSayaci(talepler, 'cetpa:magazaTalepSonGorulen:kiraci-1:uid-7', acik);
    return <button type="button">Mağaza Talepleri <MagazaYeniRozeti sayi={sayi} yeni={yeniAsamaSayisi(talepler)} currentLanguage="tr" /></button>;
  }

  it('uçtan uca: «görülmemiş» sekme açılınca kalkar; «yeni» AŞAMA sayısıdır — görülse de talep ilerletilene kadar kalır', () => {
    const iki = [talep({ olusturma: once(30) }), talep({ olusturma: once(20), durum: 'teyit' })];
    const { rerender } = render(<SekmeDugmesi talepler={iki} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 2 görülmemiş talep 1 yeni talep' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={iki} acik />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 1 yeni talep' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={iki} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 1 yeni talep' })).toBeTruthy();

    rerender(<SekmeDugmesi talepler={[...iki, talep({ olusturma: once(1) })]} acik={false} />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri 1 görülmemiş talep 2 yeni talep' })).toBeTruthy();

    // Birinde değişen diğerinde de değişir: `yeni` aşamasındaki iki talep ilerletilince «yeni» sayısı düşer.
    rerender(<SekmeDugmesi talepler={[{ ...iki[0], durum: 'teyit' }, iki[1], talep({ olusturma: once(1), durum: 'hazirlaniyor' })]} acik />);
    expect(screen.getByRole('button', { name: 'Mağaza Talepleri' })).toBeTruthy();
  });
});

// ── Kaynak çiti (yorumlar süzülür) ──────────────────────────────────────────────────────────────────────────────────
describe('MagazaTalepleri.tsx — kaynak çiti', () => {
  const ham = readFileSync(join(__dirname, 'MagazaTalepleri.tsx'), 'utf-8');
  const kod = yorumsuz('MagazaTalepleri.tsx', ham).join('\n');

  it('kaynak okunuyor (çit boş metne bakmasın)', () => { expect(kod.length).toBeGreaterThan(5000); });

  it('ham HTML basılmaz; ekrana basılan metin `toUpperCase()` ile büyütülmez; satır içi stil yok', () => {
    expect(kod).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(kod).not.toMatch(/toUpperCase\(|toLocaleUpperCase\(/);
    expect(kod).not.toMatch(/\bstyle=/);
  });

  it('bileşen kendi aboneliğini AÇMAZ ve koleksiyona YAZMAZ (veri OrdersPage\'deki kancadan gelir)', () => {
    expect(kod).not.toMatch(/dbClient|onSnapshot|setDoc|updateDoc|addDoc|deleteDoc|authFetch|fetch\(/);
  });

  it('istek işlevleri İÇE AKTARILMAZ: `services/magazaTalepIstemcisi`\'nden yalnız TİP gelir; yazma üç nitelikten', () => {
    // `services/` anan TEK satır, çok satırlı `import type { … }` bloğunun kapanışıdır (değer içe aktarımı yok).
    expect(kod.split('\n').filter(s => s.includes('services/'))).toEqual(["} from '../../services/magazaTalepIstemcisi';"]);
    expect(kod).toMatch(/import type \{\n[^}]*\n\} from '\.\.\/\.\.\/services\/magazaTalepIstemcisi';/);
    expect(kod).not.toMatch(/magazaTalepDurumuYaz|magazaKalemTeslimYaz|magazaBildirimGonder\b/);
    expect(kod).not.toMatch(/localStorage|sessionStorage/);
  });

  it('nitelikler TAM yedi: dilim 1\'in dördü + `onDurumDegistir` + `onKalemTeslim` + `onBildirimGonder`', () => {
    const govde = /interface Props \{\n([\s\S]*?)\n\}/.exec(kod)?.[1] ?? '';
    const adlar = [...govde.matchAll(/^ {2}(\w+)\??:/gm)].map(m => m[1]);
    expect(adlar).toEqual(['talepler', 'yukleniyor', 'hata', 'currentLanguage', 'onDurumDegistir', 'onKalemTeslim', 'onBildirimGonder']);
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

  it('kurallar TEK kaynaktan: geçiş tablosu, kalem işareti ve bildirim rozeti `lib/magazaTalep.ts`\'ten — bileşende kopya karşılaştırma yok', () => {
    for (const ad of ['magazaIzinliGecisler(', 'magazaGecisi(', 'magazaAcikMi(', 'magazaKalemAnahtarlari(', 'magazaKalemTeslimMi(', 'magazaTeslimIsaretsiz(',
      'magazaGuncellemeZamani(', 'magazaTeslimKaynagi(', 'bildirimGorunumu(', 'bildirimBeklemeBaslangiciMs(', 'magazaYenidenGonderilebilir(']) {
      expect(kod, ad).toContain(ad);
    }
    // Kalem işareti: `giris.durum === 'teslim'` gibi kopya karşılaştırma yok (işaret `magazaKalemTeslimMi`'den).
    expect(kod).not.toMatch(/durum === '(teslim|bekliyor)'/);
    // Geçiş tablosu elle yazılmadı: ara aşamaların adı bu dosyada hiç geçmez.
    expect(kod).not.toMatch(/'hazirlaniyor'|'sevk'/);
    // Bildirim rozeti: bekleme başlangıcı ve durum karşılaştırması bu dosyada yeniden yazılmadı.
    expect(kod).not.toMatch(/function beklemeBaslangiciMs|Math\.min\(/);
    expect(kod).not.toMatch(/bildirim\.durum ===|b\.durum ===/);
    expect(kod).not.toMatch(/export function bildirimGorunumu/);
  });

  it('dilim 1\'in «SMTP ayarı eksik» metni kaynakta YOK; yeni metin VAR; arama kutusu `type="search"` ve `form` öğesi yok', () => {
    expect(ham).not.toMatch(/SMTP/);
    expect(kod).toContain('Sunucu posta ayarı eksik; Yeniden gönder ile denenebilir');
    expect((kod.match(/type="search"/g) ?? [])).toHaveLength(1);
    expect(kod).not.toMatch(/<form\b/);
    // Barkod Enter'ı `onKeyDown` iledir (form gönderimi yok).
    expect((kod.match(/onKeyDown=/g) ?? [])).toHaveLength(1);
  });
});
