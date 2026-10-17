/**
 * magazaTalepFormu.test.ts — ERP «Mağaza Talepleri» içerik formunun SAF kuralları (dilim 2b, şartname v6 § 10.4 / § 10.8).
 *
 * KİLİTLENEN DEĞİŞMEZLER:
 *   - sayı girdisi METİNDİR: okunamayan adet / fiyat `gecersiz`'dir — `null`'a ya da 0'a ÇEVRİLMEZ; boş fiyat = «fiyat sorulacak»;
 *     «1.250» (nokta + tam üç hane) belirsizdir ve HATADIR (sessizce bin kat küçük fiyat yazılmasın);
 *   - KURUŞ (kullanıcı kararı 2026-10-17, B2): ikiden çok ondalıklı fiyat `kurustan-ince` ALAN HATASIDIR (kuruşa yuvarlanmaz,
 *     gövde üretilmez, önizleme tutar basmaz); hüküm sunucu şemasıyla AYNI işlevden — saf vektörler `magazaTalep.kurus.test.ts`;
 *   - müşterinin BEYANI kopyalanır, değişmez; gövdede `kalemler` / `talepEdilen` / toplam / `kdvKaynagi` anahtarı YOKTUR;
 *   - teyit bölümü ilk açılışta `teyit ?? kalemler`'den kopyalanır (§ 10.4): teyidi OLMAYAN talep beyan kopyasıyla açılır ve
 *     dokunulmadan kaydedilse de tam gövde (`teyit` dâhil) gider; bütün satırlar kaldırılırsa gövdede `teyit` yoktur;
 *   - KDV önizlemesi sunucunun YAZACAĞI oranla aynı kuraldır: mevcut teyit kaleminde kayıtlı oran ve kaynak, stok kodu
 *     değişmedikçe KORUNUR — ürün kaydı arada değişse de ekranda görülen oran ve toplam kaydedilecek olandır (aynı senaryonun
 *     gerçek yazma işleviyle karşılaştırması: `magazaTalepFormu.sunucu.pglite.test.ts`);
 *   - kalem anahtarı: beyandan kopya `b:<dizin>`, mevcut teyit `t:…`, yeni kalem ANAHTARSIZ; `kdvOrani` yalnız personel seçtiyse;
 *   - canlı önizleme sunucunun kayıtlı tutarı ürettiği AYNI işlevle (`magazaTeyitToplamlari`) — kopya kuruş formülü yok;
 *   - PARA ÖRNEĞİ (kullanıcı kararı): 2 × 95,00 + 1 × 40,00, %20 → ara toplam 230,00 · KDV 46,00 · toplam 276,00;
 *   - formun ürettiği gövde SUNUCUNUN GERÇEK şemasından geçer (`ErpIcerikGovdesi`, `ErpElleTalepGovdesi`) — istemci tipi ile
 *     sunucu şeması ayrışırsa bu dosya kırılır; telefon ön denetimi sunucunun `telefonSon10`'uyla aday aday aynı hükmü verir.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAGAZA_NOT_HAM_SINIRI, bosKalemTaslagi, duzenlemeTaslagi, magazaAdetCoz, magazaElleTalepGovdesi, magazaFiyatCoz, magazaIcerikGovdesi,
  magazaKayitliVarsayilaninKartOrani, magazaSayiMetni, magazaTaslakKdv, magazaTaslakOnizlemesi, magazaTelefonGecerli, taslakBeyandan,
  taslakTeyitten, yeniTalepTaslagi,
  type MagazaFormTaslagi, type MagazaKalemTaslagi,
} from './magazaTalepFormu';
import { MAGAZA_KDV_ORANLARI, magazaTeyitToplamlari, type MagazaTalepKalemi, type MagazaTalepMusteri, type MagazaTeyitKalemi } from './magazaTalep';
import { ErpIcerikGovdesi, ErpElleTalepGovdesi } from '../server/schemas';
import { telefonSon10 } from '../server/kanal/magazaTalep';
import { yorumsuz } from '../test/degismezTarayici';

const MUSTERI: MagazaTalepMusteri = { ad: 'Şükrü Çağlayan', firma: 'Çağlayan İnşaat', telefon: '0532 111 22 33', eposta: 'sukru@ornek.com.tr', il: 'İzmir', adres: 'Işıklar Cad. No: 5', vergi: '1234567890' };
const beyan = (ek: Partial<MagazaTalepKalemi> = {}): MagazaTalepKalemi =>
  ({ id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, talepFiyat: 204.99, tedarik: false, ...ek });
const teyitKalemi = (ek: Partial<MagazaTeyitKalemi> = {}): MagazaTeyitKalemi =>
  ({ anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'urun', tedarik: false, ...ek });
const satir = (ek: Partial<MagazaKalemTaslagi> = {}): MagazaKalemTaslagi => ({ ...bosKalemTaslagi(1), ad: 'Fırça', adet: '1', ...ek });
const taslak = (ek: Partial<MagazaFormTaslagi> = {}): MagazaFormTaslagi => ({ musteri: { ...MUSTERI }, not: 'Öğleden sonra arayın', kalemler: [], ...ek });
const kdvYok = (): undefined => undefined;

/** Derin dondurma: işlev girdisine YAZARSA test fırlatır (kopya üzerinde çalışıldığının kanıtı). */
function dondur<T>(v: T): T {
  if (v !== null && typeof v === 'object') { for (const ic of Object.values(v)) dondur(ic); Object.freeze(v); }
  return v;
}

describe('magazaAdetCoz — adet yalnız rakam, sıfırdan büyük güvenli tam sayı', () => {
  it('boş → `bos`; rakam → sayı (baş / son boşluk atılır)', () => {
    expect(magazaAdetCoz('')).toEqual({ tur: 'bos' });
    expect(magazaAdetCoz('   ')).toEqual({ tur: 'bos' });
    expect(magazaAdetCoz('3')).toEqual({ tur: 'sayi', deger: 3 });
    expect(magazaAdetCoz(' 12 ')).toEqual({ tur: 'sayi', deger: 12 });
    expect(magazaAdetCoz('007')).toEqual({ tur: 'sayi', deger: 7 });
  });

  it('`12,5` / `12.5` / `1.000` / `abc` / `0` / `-3` / üs / tam genişlikli rakam / güvenli sınır dışı → `gecersiz` (null ya da 0 DEĞİL)', () => {
    for (const kotu of ['12,5', '12.5', '1.000', 'abc', '0', '00', '-3', '+3', '1e3', '３', '3 adet', '9007199254740993']) {
      expect(magazaAdetCoz(kotu), kotu).toEqual({ tur: 'gecersiz' });
    }
  });
});

describe('magazaFiyatCoz — KDV hariç birim fiyat', () => {
  it('boş → `bos` («fiyat sorulacak»); tam sayı ve tek ondalık ayraç (virgül ya da nokta) → sayı; 0 meşru fiyattır', () => {
    expect(magazaFiyatCoz('')).toEqual({ tur: 'bos' });
    expect(magazaFiyatCoz('  ')).toEqual({ tur: 'bos' });
    expect(magazaFiyatCoz('95')).toEqual({ tur: 'sayi', deger: 95 });
    expect(magazaFiyatCoz('95,5')).toEqual({ tur: 'sayi', deger: 95.5 });
    expect(magazaFiyatCoz('95,50')).toEqual({ tur: 'sayi', deger: 95.5 });      // virgüllü ondalık, sondaki sıfırla
    expect(magazaFiyatCoz('95.5')).toEqual({ tur: 'sayi', deger: 95.5 });
    expect(magazaFiyatCoz('1250,50')).toEqual({ tur: 'sayi', deger: 1250.5 });
    // (Kuruş kararı 2026-10-17, B2 — bilerek değişen beklenen değer) üç ondalık artık `kurustan-ince` (önce `sayi` 0,015 idi).
    expect(magazaFiyatCoz('0,015')).toEqual({ tur: 'kurustan-ince' });
    expect(magazaFiyatCoz('1,250')).toEqual({ tur: 'sayi', deger: 1.25 });       // virgül AÇIKTIR: ondalık; değer iki ondalıklı
    expect(magazaFiyatCoz('0')).toEqual({ tur: 'sayi', deger: 0 });
    expect(magazaFiyatCoz(' 40 ')).toEqual({ tur: 'sayi', deger: 40 });
  });

  it('«1.250» BELİRSİZDİR (Türkçe yazımda 1250, `Number` ile 1,25) → `gecersiz`: sessizce bin kat küçük fiyat yazılmaz', () => {
    expect(Number('1.250')).toBe(1.25);                                           // tuzağın kendisi
    for (const belirsiz of ['1.250', '12.500', '0.125']) expect(magazaFiyatCoz(belirsiz), belirsiz).toEqual({ tur: 'gecersiz' });
    // Nokta + iki ya da dört hane belirsiz değildir (binlik ayraç üç hanelidir).
    expect(magazaFiyatCoz('1.25')).toEqual({ tur: 'sayi', deger: 1.25 });
    // Nokta + dört hane belirsiz değildir ama KURUŞTAN İNCEDİR (kuruş kararı — bilerek değişen beklenen değer).
    expect(magazaFiyatCoz('1.2505')).toEqual({ tur: 'kurustan-ince' });
  });

  it('binlik ayraç, eksi, üs, boşluk, para simgesi, yarım yazım → `gecersiz`', () => {
    for (const kotu of ['1.250,50', '1,250.50', '1 250', '-5', '+5', '1e3', '₺95', '95 TL', 'abc', ',5', '5,', '.5', '5.', '1,2,3', 'NaN', 'Infinity']) {
      expect(magazaFiyatCoz(kotu), kotu).toEqual({ tur: 'gecersiz' });
    }
  });
});

describe('magazaSayiMetni — sayı → giriş metni (ondalık ayraç virgül)', () => {
  it('bilinmeyen (`null` / sonlu değil) → boş kutu; nokta virgüle çevrilir', () => {
    expect(magazaSayiMetni(null)).toBe('');
    expect(magazaSayiMetni(NaN)).toBe('');
    expect(magazaSayiMetni(Infinity)).toBe('');
    expect(magazaSayiMetni(95)).toBe('95');
    expect(magazaSayiMetni(204.99)).toBe('204,99');
    expect(magazaSayiMetni(0)).toBe('0');
  });

  it('gidiş-dönüş: forma yazılan kayıtlı fiyat AYNI sayı olarak geri okunur; kuruştan ince kayıtlı değer YUVARLANMADAN basılır ve alan hatasıdır', () => {
    for (const n of [0, 0.5, 40, 95, 204.99, 1250.5, 12.5, 100000, 0.30000000000000004]) {
      expect(magazaFiyatCoz(magazaSayiMetni(n)), String(n)).toEqual({ tur: 'sayi', deger: n });
    }
    // Beyandaki 83,3333 (kimliksiz uç AYNEN kabul eder — B3) forma «83,3333» diye gelir; kuruşa yuvarlanıp yazılmaz.
    for (const n of [0.015, 1.125, 83.3333]) {
      expect(magazaSayiMetni(n), String(n)).toBe(String(n).replace('.', ','));
      expect(magazaFiyatCoz(magazaSayiMetni(n)), String(n)).toEqual({ tur: 'kurustan-ince' });
    }
    for (const n of [1, 2, 12, 1000]) expect(magazaAdetCoz(magazaSayiMetni(n)), String(n)).toEqual({ tur: 'sayi', deger: n });
  });
});

describe('magazaTelefonGecerli — formun erken uyarısı sunucunun hükmüyle AYNI', () => {
  it('aday aday: `telefonSon10(x) !== null` ile birebir (takip ucu talebi bu 10 rakamla bulur)', () => {
    const adaylar = ['0532 111 22 33', '+90 (532) 111-22-33', '5321112233', '532 111 22 3', '123456789', '1234567890', '', 'abc', '٠٥٣٢١١١٢٢٣٣',
      '０５３２１１１２２３３', '0532 111 22 33 dahili 12', '(0242) 111 22', 'tel: 0 532 111 2233'];
    for (const a of adaylar) expect(magazaTelefonGecerli(a), a).toBe(telefonSon10(a) !== null);
    expect(magazaTelefonGecerli('532 111 22 3')).toBe(false);                     // 9 rakam
    expect(magazaTelefonGecerli('0532 111 22 33')).toBe(true);
  });
});

describe('taslak — beyan KOPYALANIR, teyit kendi anahtarıyla açılır', () => {
  it('`taslakBeyandan`: satır `b:<dizin>` anahtarını taşır; beyan fiyatı başlangıç fiyatı; girdi DEĞİŞMEZ', () => {
    const kalemler = dondur([beyan(), beyan({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: 120, tedarik: true })]);
    const t = taslakBeyandan(kalemler, 5);
    expect(t).toEqual([
      { yerel: 5, anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: '2', fiyat: '204,99', tedarik: false, secilenKdv: null, kayitliKdv: null },
      { yerel: 6, anahtar: 'b:1', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: '1', fiyat: '120', tedarik: true, secilenKdv: null, kayitliKdv: null },
    ]);
    // Taslağı değiştirmek beyana dokunmaz (ayrı nesneler).
    t[0].adet = '99';
    expect(kalemler[0].adet).toBe(2);
  });

  it('`taslakBeyandan`: fiyatı sorulacak kalemde kutu BOŞ (0 değil); okunamayan adet boş (1 uydurulmaz)', () => {
    const [k] = taslakBeyandan([beyan({ talepFiyat: null, adet: NaN })], 1);
    expect(k.fiyat).toBe('');
    expect(k.adet).toBe('');
  });

  it('`taslakTeyitten`: kendi `t:` anahtarı, kayıtlı oran + kaynak + o oranın dayandığı stok kodu', () => {
    const [k] = taslakTeyitten(dondur([teyitKalemi({ kdvOrani: 10, kdvKaynagi: 'personel', birimFiyat: null })]), 1);
    expect(k).toEqual({ yerel: 1, anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: '2', fiyat: '', tedarik: false,
      secilenKdv: null, kayitliKdv: { kdvOrani: 10, kdvKaynagi: 'personel', sku: 'DYO-0001' } });
  });

  it('`duzenlemeTaslagi` (§ 10.4 «`teyit ?? kalemler`\'den kopyalanır»): teyit YOKSA müşteri beyanının KOPYASIYLA açılır (`b:<dizin>`); girdi DEĞİŞMEZ', () => {
    const kalemler = [beyan(), beyan({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: null, tedarik: true })];
    const girdi = dondur({ musteri: MUSTERI, not: 'not', kalemler, teyit: null });
    const yok = duzenlemeTaslagi(girdi);
    expect(yok).toEqual({
      musteri: MUSTERI, not: 'not',
      kalemler: [
        { yerel: 1, anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: '2', fiyat: '204,99', tedarik: false, secilenKdv: null, kayitliKdv: null },
        // Fiyatı sorulacak beyan kalemi: kutu BOŞ (0 değil) — kaydedilirse `birimFiyat: null`.
        { yerel: 2, anahtar: 'b:1', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: '1', fiyat: '', tedarik: true, secilenKdv: null, kayitliKdv: null },
      ],
    });
    expect(yok.kalemler).toEqual(taslakBeyandan(kalemler, 1));                     // TEK kopyalama işlevi (ikinci kural yok)
    expect(yok.musteri).not.toBe(MUSTERI);                                         // kopya
    // Beyanı olmayan (bozuk / boş) talepte kopyalanacak satır yoktur: bölüm boş açılır.
    expect(duzenlemeTaslagi({ musteri: MUSTERI, not: '', kalemler: [], teyit: null }).kalemler).toEqual([]);
  });

  it('`duzenlemeTaslagi`: teyit VARSA kendi kalemleriyle açılır (`t:` anahtarı, kayıtlı oran) — beyan KOPYALANMAZ', () => {
    const var_ = duzenlemeTaslagi(dondur({
      musteri: MUSTERI, not: '', kalemler: [beyan(), beyan({ id: 'u2' }), beyan({ id: 'u3' })],
      teyit: { kalemler: [teyitKalemi(), teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', kdvOrani: 10, kdvKaynagi: 'personel' })] },
    }));
    expect(var_.kalemler.map(k => [k.yerel, k.anahtar])).toEqual([[1, 't:aaaaaaaaaaaa'], [2, 't:bbbbbbbbbbbb']]);
    expect(var_.kalemler.map(k => k.kayitliKdv)).toEqual([
      { kdvOrani: 20, kdvKaynagi: 'urun', sku: 'DYO-0001' }, { kdvOrani: 10, kdvKaynagi: 'personel', sku: 'DYO-0001' },
    ]);
  });

  it('`yeniTalepTaslagi`: her şey boş, TEK boş kalem satırı (adet ve fiyat boş — varsayılan adet yok)', () => {
    expect(yeniTalepTaslagi()).toEqual({
      musteri: { ad: '', firma: '', telefon: '', eposta: '', il: '', adres: '', vergi: '' }, not: '',
      kalemler: [{ yerel: 1, anahtar: null, id: '', sku: '', ad: '', marka: '', adet: '', fiyat: '', tedarik: false, secilenKdv: null, kayitliKdv: null }],
    });
  });
});

describe('magazaTaslakKdv — satırın oranı ve kaynağı (sunucunun yazacağı değerin aynı kuralla tahmini)', () => {
  it('yeni / kopyalanan kalem: `urunKdvOrani(sku)` kümedeyse o oran (`urun`); `undefined` / küme dışı (18, 8) → 20 + `varsayilan`', () => {
    const k = { sku: 'ABC', secilenKdv: null, kayitliKdv: null };
    expect(magazaTaslakKdv(k, () => 10)).toEqual({ kdvOrani: 10, kdvKaynagi: 'urun' });
    expect(magazaTaslakKdv(k, () => 0)).toEqual({ kdvOrani: 0, kdvKaynagi: 'urun' });
    expect(magazaTaslakKdv(k, kdvYok)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(magazaTaslakKdv(k, () => 18)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(magazaTaslakKdv(k, () => 8)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
  });

  it('`urunKdvOrani` satırın stok koduyla (baş / son boşluksuz) ve paket soneki KIRPILMADAN çağrılır — kural o işlevin içindedir', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 10);
    magazaTaslakKdv({ sku: '  DEKOR-1325-D002 ', secilenKdv: null, kayitliKdv: null }, oran);
    expect(oran.mock.calls).toEqual([['DEKOR-1325-D002']]);
  });

  it('personel bu oturumda seçtiyse o oran ve `personel` — ürün kaydına hiç bakılmaz', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 10);
    expect(magazaTaslakKdv({ sku: 'ABC', secilenKdv: 1, kayitliKdv: { kdvOrani: 20, kdvKaynagi: 'urun', sku: 'ABC' } }, oran)).toEqual({ kdvOrani: 1, kdvKaynagi: 'personel' });
    expect(oran).not.toHaveBeenCalled();
  });

  it('mevcut teyit kalemi (sunucunun «kayıtlı oran» kuralıyla BİREBİR): `personel` oranı stok kodu değişse de KORUNUR; `urun` / `varsayilan` yalnız stok kodu aynıysa — ürün kaydı SORULMAZ', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 1);
    expect(magazaTaslakKdv({ sku: 'YENI', secilenKdv: null, kayitliKdv: { kdvOrani: 10, kdvKaynagi: 'personel', sku: 'ESKI' } }, oran)).toEqual({ kdvOrani: 10, kdvKaynagi: 'personel' });
    expect(magazaTaslakKdv({ sku: 'AYNI', secilenKdv: null, kayitliKdv: { kdvOrani: 10, kdvKaynagi: 'urun', sku: 'AYNI' } }, oran)).toEqual({ kdvOrani: 10, kdvKaynagi: 'urun' });
    expect(magazaTaslakKdv({ sku: 'AYNI', secilenKdv: null, kayitliKdv: { kdvOrani: 20, kdvKaynagi: 'varsayilan', sku: 'AYNI' } }, oran)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(oran).not.toHaveBeenCalled();
    // Stok kodu değişti: kayıtlı oran başka ürüne aittir — yeni kodun ürün kaydı okunur.
    expect(magazaTaslakKdv({ sku: 'YENI', secilenKdv: null, kayitliKdv: { kdvOrani: 10, kdvKaynagi: 'urun', sku: 'ESKI' } }, oran)).toEqual({ kdvOrani: 1, kdvKaynagi: 'urun' });
    expect(oran.mock.calls).toEqual([['YENI']]);
  });

  it('stok kodu karşılaştırması baş / son boşluksuz: kutuya boşluk eklemek «kod değişti» DEĞİLDİR; kod eski hâline dönerse kayıtlı oran yeniden geçerlidir', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 1);
    const kayitli = { kdvOrani: 20, kdvKaynagi: 'varsayilan', sku: 'DYO-0001' } as const;
    expect(magazaTaslakKdv({ sku: '  DYO-0001 ', secilenKdv: null, kayitliKdv: kayitli }, oran)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(oran).not.toHaveBeenCalled();
    // Yazım sırasında ara değer (kod yarım): ürün zinciri; kod tamamlanınca kayıtlı oran geri gelir (satır `t:` anahtarını korur).
    expect(magazaTaslakKdv({ sku: 'DYO-000', secilenKdv: null, kayitliKdv: kayitli }, oran)).toEqual({ kdvOrani: 1, kdvKaynagi: 'urun' });
    expect(magazaTaslakKdv({ sku: 'DYO-0001', secilenKdv: null, kayitliKdv: kayitli }, oran)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    // Büyük / küçük harf FARKI değişikliktir (sunucu da birebir dizge karşılaştırır).
    expect(magazaTaslakKdv({ sku: 'dyo-0001', secilenKdv: null, kayitliKdv: kayitli }, oran)).toEqual({ kdvOrani: 1, kdvKaynagi: 'urun' });
  });

  it('«varsayılan» oranı ONAYLAMAK seçimdir: `secilenKdv` görünen orana eşitlenince kaynak `personel` olur (oran aynı kalır)', () => {
    const k = { sku: 'YOK', secilenKdv: null, kayitliKdv: null };
    const once = magazaTaslakKdv(k, kdvYok);
    expect(once).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(magazaTaslakKdv({ ...k, secilenKdv: once.kdvOrani }, kdvYok)).toEqual({ kdvOrani: 20, kdvKaynagi: 'personel' });
    // Mevcut teyit kaleminin kayıtlı «varsayılan»ı da aynı yolla onaylanır.
    const kayitli = { sku: 'A', secilenKdv: null, kayitliKdv: { kdvOrani: 20, kdvKaynagi: 'varsayilan', sku: 'A' } } as const;
    expect(magazaTaslakKdv({ ...kayitli, secilenKdv: magazaTaslakKdv(kayitli, kdvYok).kdvOrani }, kdvYok)).toEqual({ kdvOrani: 20, kdvKaynagi: 'personel' });
  });
});

// İnceleme 2b, ikinci tur (bulgu 2): kayıtlı «varsayılan» satırda ürün kaydının BUGÜNKÜ oranı yalnız BİLGİDİR.
describe('magazaKayitliVarsayilaninKartOrani — kayıtlı «varsayılan» satırda ürün kaydının bugünkü oranı (yalnız bilgi)', () => {
  const kayitli = (kdvKaynagi: 'urun' | 'varsayilan' | 'personel', sku = 'DYO-0001') => ({ kdvOrani: 20, kdvKaynagi, sku } as const);

  it('kayıtlı `varsayilan` + stok kodu aynı + personel seçmedi: kart okunuyorsa O oran (kayıtlıyla aynı olsa da); okunamıyorsa `null`', () => {
    const k = { sku: 'DYO-0001', secilenKdv: null, kayitliKdv: kayitli('varsayilan') };
    expect(magazaKayitliVarsayilaninKartOrani(k, () => 10)).toBe(10);
    expect(magazaKayitliVarsayilaninKartOrani(k, () => 0)).toBe(0);
    expect(magazaKayitliVarsayilaninKartOrani(k, () => 20)).toBe(20);
    // Eşleşme yok / küme dışı oran (18, 8): «şimdi %20» diye UYDURULMAZ — bilgi yok.
    for (const oran of [undefined, 18, 8, Number.NaN]) expect(magazaKayitliVarsayilaninKartOrani(k, () => oran), String(oran)).toBeNull();
  });

  it('`urunKdvOrani` satırın stok koduyla (baş / son boşluksuz, paket soneki KIRPILMADAN) çağrılır', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 10);
    expect(magazaKayitliVarsayilaninKartOrani({ sku: '  DEKOR-1325-D002 ', secilenKdv: null, kayitliKdv: kayitli('varsayilan', 'DEKOR-1325-D002') }, oran)).toBe(10);
    expect(oran.mock.calls).toEqual([['DEKOR-1325-D002']]);
  });

  it('öbür her durumda `null` ve ürün kaydı SORULMAZ: personel seçti / onayladı, yeni ya da kopya satır, kayıtlı kaynak `urun` / `personel`, stok kodu değişti', () => {
    const oran = vi.fn<(sku: string) => number | undefined>(() => 10);
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'DYO-0001', secilenKdv: 20, kayitliKdv: kayitli('varsayilan') }, oran)).toBeNull();
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'DYO-0001', secilenKdv: null, kayitliKdv: null }, oran)).toBeNull();
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'DYO-0001', secilenKdv: null, kayitliKdv: kayitli('urun') }, oran)).toBeNull();
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'DYO-0001', secilenKdv: null, kayitliKdv: kayitli('personel') }, oran)).toBeNull();
    // Stok kodu değişti: satır artık kayıtlı oranla DURMUYOR — `magazaTaslakKdv` zaten yeni kodun ürün kaydını okur.
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'RUL-5', secilenKdv: null, kayitliKdv: kayitli('varsayilan') }, oran)).toBeNull();
    expect(magazaKayitliVarsayilaninKartOrani({ sku: 'dyo-0001', secilenKdv: null, kayitliKdv: kayitli('varsayilan') }, oran)).toBeNull();
    expect(oran).not.toHaveBeenCalled();
  });

  it('BİLGİDİR — önizlemeye GİRMEZ: kart %10 dese de `magazaTaslakKdv` kayıtlı %20 + `varsayilan` verir ve toplam 276,00 kalır', () => {
    const satirlar = taslakTeyitten([
      teyitKalemi({ kdvOrani: 20, kdvKaynagi: 'varsayilan' }),
      teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', adet: 1, birimFiyat: 40 }),
    ], 1);
    const kart = (sku: string): number | undefined => (sku === 'DYO-0001' ? 10 : undefined);
    expect(magazaKayitliVarsayilaninKartOrani(satirlar[0], kart)).toBe(10);
    expect(magazaKayitliVarsayilaninKartOrani(satirlar[1], kart)).toBeNull();
    expect(magazaTaslakKdv(satirlar[0], kart)).toEqual({ kdvOrani: 20, kdvKaynagi: 'varsayilan' });
    expect(magazaTaslakOnizlemesi(satirlar, kart)).toEqual({ araToplam: 230, kdv: 46, toplam: 276, durum: 'tutar' });
  });
});

describe('magazaTaslakOnizlemesi — canlı önizleme (kayıtlı tutar sunucunundur)', () => {
  const iki = (ek: Partial<MagazaKalemTaslagi> = {}): MagazaKalemTaslagi[] => [
    satir({ yerel: 1, sku: 'DYO-0001', ad: 'İç cephe boyası', adet: '2', fiyat: '95' }),
    satir({ yerel: 2, sku: 'FRC-12', ad: 'Fırça', adet: '1', fiyat: '40', ...ek }),
  ];

  it('PARA ÖRNEĞİ: 2 × 95,00 + 1 × 40,00, %20 → ara toplam 230,00 · KDV 46,00 · toplam 276,00', () => {
    expect(magazaTaslakOnizlemesi(iki(), kdvYok)).toEqual({ araToplam: 230, kdv: 46, toplam: 276, durum: 'tutar' });
  });

  it('KDV KALEM oranıyla: ikinci kalem %10 seçilince 230,00 / 42,00 / 272,00; ürün kaydından gelen oran da aynı sonucu verir', () => {
    expect(magazaTaslakOnizlemesi(iki({ secilenKdv: 10 }), kdvYok)).toEqual({ araToplam: 230, kdv: 42, toplam: 272, durum: 'tutar' });
    expect(magazaTaslakOnizlemesi(iki(), sku => (sku === 'FRC-12' ? 10 : 20))).toEqual({ araToplam: 230, kdv: 42, toplam: 272, durum: 'tutar' });
  });

  it('herhangi bir fiyat BOŞSA üç toplam da `null` ve durum «fiyat sorulacak» (kısmi toplam basılmaz, sıfır değil)', () => {
    expect(magazaTaslakOnizlemesi(iki({ fiyat: '' }), kdvYok)).toEqual({ araToplam: null, kdv: null, toplam: null, durum: 'fiyat-sorulacak' });
  });

  it('okunamayan adet / fiyat → `okunamadi` (tutar uydurulmaz); satır yok → `kalem-yok`', () => {
    const bos = { araToplam: null, kdv: null, toplam: null };
    expect(magazaTaslakOnizlemesi(iki({ adet: '12,5' }), kdvYok)).toEqual({ ...bos, durum: 'okunamadi' });
    expect(magazaTaslakOnizlemesi(iki({ adet: '' }), kdvYok)).toEqual({ ...bos, durum: 'okunamadi' });
    expect(magazaTaslakOnizlemesi(iki({ fiyat: '1.250' }), kdvYok)).toEqual({ ...bos, durum: 'okunamadi' });
    expect(magazaTaslakOnizlemesi([], kdvYok)).toEqual({ ...bos, durum: 'kalem-yok' });
  });

  // İnceleme 2b, bulgu 1 + 3: teyit edilen rakam, ona dokunulmadıkça sabittir. Tabloda 276,00 yazan teyit, form açılınca da
  // 276,00 görünür ve (yalnız not değişse de) 276,00 kaydedilir — ürün kartının oranı arada %1 / %10 olmuş olsa bile.
  describe('ÜRÜN KAYDI ARADA DEĞİŞTİ — ekranda görülen oran ve toplam = kaydedilecek olan', () => {
    /** Kayıtlı teyit (para örneği): 2 × 95,00 + 1 × 40,00; ikisi de %20 — biri kart eşleşmediği için `varsayilan`, biri `urun`. */
    const kayitliTeyit = (): MagazaTeyitKalemi[] => [
      teyitKalemi({ anahtar: 't:aaaaaaaaaaaa', sku: 'DYO-0001', adet: 2, birimFiyat: 95, kdvOrani: 20, kdvKaynagi: 'varsayilan' }),
      teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, kdvOrani: 20, kdvKaynagi: 'urun' }),
    ];
    /** Ürün kaydının BUGÜNKÜ hâli: `DYO-0001` kartı sonradan eşlendi (%1), `FRC-12`'nin oranı %10'a çekildi. */
    const bugunkuKart = (sku: string): number | undefined => (sku === 'DYO-0001' ? 1 : sku === 'FRC-12' ? 10 : sku === 'RUL-5' ? 10 : undefined);
    const acilis = (): MagazaFormTaslagi => duzenlemeTaslagi({ musteri: MUSTERI, not: 'eski not', kalemler: [beyan()], teyit: { kalemler: kayitliTeyit() } });

    it('dokunulmayan teyit: oranlar KAYITLI (%20 `varsayilan`, %20 `urun`), önizleme 230,00 / 46,00 / 276,00 — bugünkü kartla (%1 / %10) hesaplanan 235,90 DEĞİL', () => {
      const t = acilis();
      expect(t.kalemler.map(k => magazaTaslakKdv(k, bugunkuKart))).toEqual([{ kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 20, kdvKaynagi: 'urun' }]);
      expect(magazaTaslakOnizlemesi(t.kalemler, bugunkuKart)).toEqual({ araToplam: 230, kdv: 46, toplam: 276, durum: 'tutar' });
      // Eski (yanlış) kuralın vereceği sonuç — çitin ayırt ettiği değer: 190 × %1 + 40 × %10 = 1,90 + 4,00.
      expect(magazaTeyitToplamlari([{ adet: 2, birimFiyat: 95, kdvOrani: 1 }, { adet: 1, birimFiyat: 40, kdvOrani: 10 }])).toEqual({ araToplam: 230, kdv: 5.9, toplam: 235.9 });
    });

    it('yalnız NOT değişti: gövdede hiçbir kalemde `kdvOrani` YOK (sunucu kayıtlı oranı korur) — önizleme yine 276,00', () => {
      const t = { ...acilis(), not: 'yeni not' };
      const s = magazaIcerikGovdesi(t, 3, true);
      if (!s.ok) throw new Error('beklenmedik');
      expect(s.govde.teyit?.kalemler).toEqual([
        { anahtar: 't:aaaaaaaaaaaa', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 95, tedarik: false },
        { anahtar: 't:bbbbbbbbbbbb', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: 40, tedarik: false },
      ]);
      expect(magazaTaslakOnizlemesi(t.kalemler, bugunkuKart).toplam).toBe(276);
      expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
    });

    it('adet / fiyat değişse de oran KAYITLI kalır (stok kodu aynı): 3 × 95,00 + 1 × 40,00, %20 → 325,00 / 65,00 / 390,00', () => {
      const t = acilis();
      t.kalemler[0].adet = '3';
      expect(magazaTaslakOnizlemesi(t.kalemler, bugunkuKart)).toEqual({ araToplam: 325, kdv: 65, toplam: 390, durum: 'tutar' });
    });

    it('stok kodu DEĞİŞEN satır yeniden çözülür (bugünkü kart), dokunulmayan satır kayıtlı kalır; yeni kalem ürün kaydından', () => {
      const t = acilis();
      t.kalemler[1].sku = 'RUL-5';                                                  // kayıtlı %20 başka ürüne aitti → bugünkü kart %10
      expect(t.kalemler.map(k => magazaTaslakKdv(k, bugunkuKart))).toEqual([{ kdvOrani: 20, kdvKaynagi: 'varsayilan' }, { kdvOrani: 10, kdvKaynagi: 'urun' }]);
      // 190 × %20 + 40 × %10 = 38,00 + 4,00.
      expect(magazaTaslakOnizlemesi(t.kalemler, bugunkuKart)).toEqual({ araToplam: 230, kdv: 42, toplam: 272, durum: 'tutar' });
      // Yeni eklenen kalem (anahtarsız) aynı stok kodunu taşısa da KAYITLI oranı yoktur: bugünkü karttan (%1).
      const yeni = satir({ yerel: 9, sku: 'DYO-0001', adet: '1', fiyat: '100' });
      expect(magazaTaslakKdv(yeni, bugunkuKart)).toEqual({ kdvOrani: 1, kdvKaynagi: 'urun' });
    });

    it('personel açıkça seçerse / onaylarsa o satırın oranı gövdeye girer; öbür satır kayıtlı kalır', () => {
      const t = acilis();
      t.kalemler[0].secilenKdv = 20;                                                // «varsayılan» %20 ONAYLANDI
      t.kalemler[1].secilenKdv = 10;                                                // bugünkü oran bilerek seçildi
      const s = magazaIcerikGovdesi(t, 3, true);
      if (!s.ok) throw new Error('beklenmedik');
      expect(s.govde.teyit?.kalemler.map(k => k.kdvOrani)).toEqual([20, 10]);
      expect(t.kalemler.map(k => magazaTaslakKdv(k, bugunkuKart))).toEqual([{ kdvOrani: 20, kdvKaynagi: 'personel' }, { kdvOrani: 10, kdvKaynagi: 'personel' }]);
      expect(magazaTaslakOnizlemesi(t.kalemler, bugunkuKart)).toEqual({ araToplam: 230, kdv: 42, toplam: 272, durum: 'tutar' });
    });
  });

  it('kuruş formülü sunucunun işlevindedir: önizleme `magazaTeyitToplamlari` ile AYNI sonucu verir (yuvarlama dâhil)', () => {
    // 0,15 × 3 (%20 → 0,09) + 7 × 33,33 (%1 → 2,3331 → 2,33): tam sayı kuruşla kararlı (kayan nokta toplamı değil).
    const k = [satir({ yerel: 1, adet: '3', fiyat: '0,15' }), satir({ yerel: 2, adet: '7', fiyat: '33,33', secilenKdv: 1 })];
    const beklenen = magazaTeyitToplamlari([{ adet: 3, birimFiyat: 0.15, kdvOrani: 20 }, { adet: 7, birimFiyat: 33.33, kdvOrani: 1 }]);
    expect(beklenen).toEqual({ araToplam: 233.76, kdv: 2.42, toplam: 236.18 });
    expect(magazaTaslakOnizlemesi(k, kdvYok)).toEqual({ ...beklenen, durum: 'tutar' });
  });

  it('(kuruş kararı, B2) kuruştan ince fiyat önizlemede tutar BASMAZ (`okunamadi` — kuruşa yuvarlanmış sahte toplam yok); gövde de üretilmez', () => {
    for (const fiyat of ['0,015', '83,3333', '1,005', '0,001']) {
      const k = [satir({ yerel: 1, adet: '12', fiyat }), satir({ yerel: 2, adet: '1', fiyat: '40' })];
      expect(magazaTaslakOnizlemesi(k, kdvYok), fiyat).toEqual({ araToplam: null, kdv: null, toplam: null, durum: 'okunamadi' });
      expect(magazaIcerikGovdesi(taslak({ kalemler: k }), 0, false), fiyat).toEqual({ ok: false, hatalar: { kalemler: { 1: { fiyat: 'kurustan-ince' } } } });
      expect(magazaElleTalepGovdesi(taslak({ kalemler: k })), fiyat).toEqual({ ok: false, hatalar: { kalemler: { 1: { fiyat: 'kurustan-ince' } } } });
    }
  });

  it('(kuruş kararı, B2) kuruştan ince fiyat, yanında fiyatı BOŞ satır olsa da `okunamadi` — «fiyat sorulacak» hatayı ÖRTMEZ (sıra fark etmez)', () => {
    const bos = { araToplam: null, kdv: null, toplam: null };
    const ince = satir({ yerel: 1, adet: '12', fiyat: '83,3333' });
    const fiyatsiz = satir({ yerel: 2, adet: '1', fiyat: '' });
    expect(magazaTaslakOnizlemesi([ince, fiyatsiz], kdvYok)).toEqual({ ...bos, durum: 'okunamadi' });
    expect(magazaTaslakOnizlemesi([fiyatsiz, ince], kdvYok)).toEqual({ ...bos, durum: 'okunamadi' });
    // Karşılaştırma: kuruşlu fiyat + boş satır gerçekten «fiyat sorulacak»tır.
    expect(magazaTaslakOnizlemesi([satir({ yerel: 1, adet: '12', fiyat: '83,33' }), fiyatsiz], kdvYok)).toEqual({ ...bos, durum: 'fiyat-sorulacak' });
  });
});

describe('magazaIcerikGovdesi — düzenleme gövdesi (TAM gövde; «ne değişti» sunucuda ölçülür)', () => {
  it('`musteri` (YEDİ alan) ve `not` HER ZAMAN gövdede; teyit bölümü boşsa `teyit` anahtarı YOK', () => {
    const s = magazaIcerikGovdesi(taslak(), 4, false);
    expect(s).toEqual({ ok: true, govde: { icerikSurum: 4, musteri: MUSTERI, not: 'Öğleden sonra arayın' } });
    if (!s.ok) throw new Error('beklenmedik');
    expect(Object.keys(s.govde.musteri ?? {}).sort()).toEqual(['ad', 'adres', 'eposta', 'firma', 'il', 'telefon', 'vergi']);
    expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
  });

  it('kalem anahtarı: beyandan kopya `b:<dizin>`, mevcut teyit `t:…`, yeni kalem ANAHTARSIZ; kaldırılan satırın anahtarı gövdede yok', () => {
    const kopya = taslakBeyandan([beyan(), beyan({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', adet: 1, talepFiyat: 120 })], 1);
    const mevcut = taslakTeyitten([teyitKalemi({ anahtar: 't:cccccccccccc' }), teyitKalemi({ anahtar: 't:dddddddddddd', ad: 'Kaldırılacak' })], 10);
    const yeni = satir({ yerel: 20, ad: 'Rulo', adet: '4', fiyat: '55,5' });
    // İkinci teyit satırı (`t:dddd…`) kullanıcı tarafından kaldırıldı.
    const s = magazaIcerikGovdesi(taslak({ kalemler: [...kopya, mevcut[0], yeni] }), 0, true);
    if (!s.ok) throw new Error('beklenmedik');
    expect(s.govde.teyit?.kalemler.map(k => k.anahtar)).toEqual(['b:0', 'b:1', 't:cccccccccccc', undefined]);
    expect(Object.prototype.hasOwnProperty.call(s.govde.teyit?.kalemler[3] ?? {}, 'anahtar')).toBe(false);
    expect(JSON.stringify(s.govde)).not.toContain('t:dddddddddddd');
    expect(s.govde.teyit?.kalemler[3]).toEqual({ sku: '', ad: 'Rulo', marka: '', adet: 4, birimFiyat: 55.5, tedarik: false });
    expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
  });

  it('gövdede `kalemler` (beyan) / `talepEdilen` / toplam / `kdvKaynagi` anahtarı YOK; `kdvOrani` YALNIZ personel seçtiyse', () => {
    const k = taslakTeyitten([teyitKalemi({ kdvOrani: 10, kdvKaynagi: 'urun' }), teyitKalemi({ anahtar: 't:bbbbbbbbbbbb', kdvOrani: 20, kdvKaynagi: 'varsayilan' })], 1);
    k[1].secilenKdv = 1;
    const s = magazaIcerikGovdesi(taslak({ kalemler: k }), 2, true);
    if (!s.ok) throw new Error('beklenmedik');
    expect(Object.keys(s.govde).sort()).toEqual(['icerikSurum', 'musteri', 'not', 'teyit']);
    expect(Object.keys(s.govde.teyit ?? {})).toEqual(['kalemler']);
    const metin = JSON.stringify(s.govde);
    expect(metin).not.toMatch(/"talepEdilen"|"kdvKaynagi"|"araToplam"|"toplam"|"talepFiyat"|"yerel"|"secilenKdv"|"kayitliKdv"/);
    // Seçilmeyen satırda `kdvOrani` YOK (kayıtlı oran gövdeye KOPYALANMAZ — sunucu çözer / korur); seçilende var.
    expect(Object.prototype.hasOwnProperty.call(s.govde.teyit?.kalemler[0] ?? {}, 'kdvOrani')).toBe(false);
    expect(s.govde.teyit?.kalemler[1].kdvOrani).toBe(1);
    expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
  });

  it('boş fiyat → `birimFiyat: null` («fiyat sorulacak»; 0 DEĞİL); meşru 0 fiyat 0 olarak gider', () => {
    const s = magazaIcerikGovdesi(taslak({ kalemler: [satir({ yerel: 1, fiyat: '' }), satir({ yerel: 2, fiyat: '0' })] }), 0, false);
    if (!s.ok) throw new Error('beklenmedik');
    expect(s.govde.teyit?.kalemler.map(k => k.birimFiyat)).toEqual([null, 0]);
    expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
  });

  it('`12,5` / `abc` / boş adet ve okunamayan fiyat ALAN HATASIDIR — gövde ÜRETİLMEZ (null\'a çevrilip gönderilmez)', () => {
    const s = magazaIcerikGovdesi(taslak({ kalemler: [
      satir({ yerel: 1, adet: '12,5' }), satir({ yerel: 2, adet: 'abc' }), satir({ yerel: 3, adet: '' }), satir({ yerel: 4, fiyat: '1.250' }), satir({ yerel: 5, ad: '  ' }), satir({ yerel: 6 }),
    ] }), 0, false);
    expect(s).toEqual({ ok: false, hatalar: { kalemler: { 1: { adet: 'gecersiz' }, 2: { adet: 'gecersiz' }, 3: { adet: 'bos' }, 4: { fiyat: 'gecersiz' }, 5: { ad: true } } } });
  });

  it('müşteri adı boş / telefonda 10 rakam yok / not ham sınırı aşıyor → alan hatası, gövde yok', () => {
    const s = magazaIcerikGovdesi(taslak({ musteri: { ...MUSTERI, ad: '   ', telefon: '532 111 22 3' }, not: 'x'.repeat(MAGAZA_NOT_HAM_SINIRI + 1) }), 0, false);
    expect(s).toEqual({ ok: false, hatalar: { ad: true, telefon: true, not: true, kalemler: {} } });
    // Sınırın kendisi geçerlidir ve şemadan geçer.
    const tam = magazaIcerikGovdesi(taslak({ not: 'x'.repeat(MAGAZA_NOT_HAM_SINIRI) }), 0, false);
    expect(tam.ok && ErpIcerikGovdesi.safeParse(tam.govde).success).toBe(true);
  });

  it('teyidi OLAN talepte bütün kalemler kaldırılamaz (`kalemYok` — talep iptal edilir); teyidi olmayan talepte boş bölüm serbest', () => {
    expect(magazaIcerikGovdesi(taslak(), 0, true)).toEqual({ ok: false, hatalar: { kalemYok: true, kalemler: {} } });
    expect(magazaIcerikGovdesi(taslak(), 0, false).ok).toBe(true);
  });

  it('teyidi OLMAYAN talep (§ 10.4): form beyan kopyasıyla açılır ve DOKUNULMADAN da tam gövde gider — `teyit` `b:<dizin>` satırlarıyla; bütün satırlar kaldırılırsa `teyit` YOK', () => {
    const kalemler = dondur([beyan(), beyan({ id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, talepFiyat: null, tedarik: true })]);
    const t = duzenlemeTaslagi({ musteri: MUSTERI, not: 'Öğleden sonra arayın', kalemler, teyit: null });
    const s = magazaIcerikGovdesi(t, 0, false);
    expect(s).toEqual({ ok: true, govde: {
      icerikSurum: 0, musteri: MUSTERI, not: 'Öğleden sonra arayın',
      teyit: { kalemler: [
        { anahtar: 'b:0', id: 'u1', sku: 'DYO-0001', ad: 'İç cephe boyası', marka: 'DYO', adet: 2, birimFiyat: 204.99, tedarik: false },
        { anahtar: 'b:1', id: 'u2', sku: 'FRC-12', ad: 'Fırça', marka: 'İzmir Fırça', adet: 1, birimFiyat: null, tedarik: true },
      ] },
    } });
    if (!s.ok) throw new Error('beklenmedik');
    expect(ErpIcerikGovdesi.safeParse(s.govde).success).toBe(true);
    // Çıkış yolu: yalnız müşteri bilgisini düzeltecek kişi bütün kalemleri kaldırır → gövdede `teyit` anahtarı yok.
    const bos = magazaIcerikGovdesi({ ...t, kalemler: [] }, 0, false);
    if (!bos.ok) throw new Error('beklenmedik');
    expect(Object.keys(bos.govde).sort()).toEqual(['icerikSurum', 'musteri', 'not']);
  });

  it('şema gerçekten sıkıdır (çitin dayanağı): gövdeye `kdvKaynagi`, beyan ya da toplam eklenirse REDDEDİLİR', () => {
    const s = magazaIcerikGovdesi(taslak({ kalemler: [satir()] }), 0, false);
    if (!s.ok) throw new Error('beklenmedik');
    const kalem = s.govde.teyit?.kalemler[0];
    expect(ErpIcerikGovdesi.safeParse({ ...s.govde, teyit: { kalemler: [{ ...kalem, kdvKaynagi: 'personel' }] } }).success).toBe(false);
    expect(ErpIcerikGovdesi.safeParse({ ...s.govde, kalemler: [] }).success).toBe(false);
    expect(ErpIcerikGovdesi.safeParse({ ...s.govde, teyit: { kalemler: [kalem], toplam: 1 } }).success).toBe(false);
    expect(ErpIcerikGovdesi.safeParse({ ...s.govde, teyit: { kalemler: [{ ...kalem, kdvOrani: 18 }] } }).success).toBe(false);
    for (const oran of MAGAZA_KDV_ORANLARI) expect(ErpIcerikGovdesi.safeParse({ ...s.govde, teyit: { kalemler: [{ ...kalem, kdvOrani: oran }] } }).success, String(oran)).toBe(true);
  });

  it('taslak DEĞİŞMEZ (gövde üretimi saf): dondurulmuş taslakla çalışır', () => {
    const t = dondur(taslak({ kalemler: [satir({ fiyat: '95,5' })] }));
    expect(magazaIcerikGovdesi(t, 1, false).ok).toBe(true);
  });
});

describe('magazaElleTalepGovdesi — ERP\'de elle talep (kalemler talebin BEYANI olur)', () => {
  const dolu = (): MagazaFormTaslagi => taslak({ kalemler: [satir({ sku: 'FRC-12', marka: 'İzmir Fırça', adet: '3', fiyat: '120' }), satir({ yerel: 2, ad: 'Rulo', fiyat: '' })] });

  it('gövde: müşteri + not + kalemler; numara / tarih / toplam / anahtar / KDV oranı YOK; sunucunun gerçek şemasından geçer', () => {
    const s = magazaElleTalepGovdesi(dolu());
    expect(s).toEqual({ ok: true, govde: {
      musteri: MUSTERI, not: 'Öğleden sonra arayın',
      kalemler: [
        { ad: 'Fırça', adet: 3, sku: 'FRC-12', marka: 'İzmir Fırça', birimFiyat: 120, tedarik: false },
        { ad: 'Rulo', adet: 1, sku: '', marka: '', birimFiyat: null, tedarik: false },
      ],
    } });
    if (!s.ok) throw new Error('beklenmedik');
    expect(JSON.stringify(s.govde)).not.toMatch(/"no"|"tarih"|"toplam"|"araToplam"|"anahtar"|"kdvOrani"|"kdvKaynagi"/);
    expect(ErpElleTalepGovdesi.safeParse(s.govde).success).toBe(true);
  });

  it('telefon 10 rakam ZORUNLU (takip ucu aynı numarayla çalışır); müşteri adı ve EN AZ bir kalem zorunlu', () => {
    expect(magazaElleTalepGovdesi({ ...dolu(), musteri: { ...MUSTERI, telefon: '532 111 22 3' } })).toEqual({ ok: false, hatalar: { telefon: true, kalemler: {} } });
    expect(magazaElleTalepGovdesi({ ...dolu(), musteri: { ...MUSTERI, ad: '' } })).toEqual({ ok: false, hatalar: { ad: true, kalemler: {} } });
    expect(magazaElleTalepGovdesi(taslak())).toEqual({ ok: false, hatalar: { kalemYok: true, kalemler: {} } });
    // Formun ilk hâli (her şey boş, tek boş satır): üç ayrı alan hatası — istek üretilmez.
    expect(magazaElleTalepGovdesi(yeniTalepTaslagi())).toEqual({ ok: false, hatalar: { ad: true, telefon: true, kalemler: { 1: { ad: true, adet: 'bos' } } } });
  });
});

describe('magazaTalepFormu.ts — kaynak çiti (yaprak, saf modül)', () => {
  const kod = yorumsuz('src/lib/magazaTalepFormu.ts', readFileSync(join(__dirname, 'magazaTalepFormu.ts'), 'utf-8')).join('\n');

  it('kaynak okunuyor', () => { expect(kod.length).toBeGreaterThan(3000); });

  it('yalnız ortak sözleşmeyi içe aktarır: React / ağ / depolama / servis yok', () => {
    expect([...kod.matchAll(/from '([^']+)'/g)].map(m => m[1])).toEqual(['./magazaTalep']);
    expect(kod).not.toMatch(/fetch\(|authFetch|localStorage|document\.|window\./);
  });

  it('kuruş formülü KOPYALANMADI (toplam `magazaTeyitToplamlari`\'ndan); sayısal alanda `?? 0` / `|| 0` ve global `isFinite` yok', () => {
    expect(kod).toContain('magazaTeyitToplamlari(');
    expect(kod).not.toMatch(/Math\.round\(|\* 100|\/ 100/);
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*0\b/);
    expect(kod).not.toMatch(/(^|[^.\w])isFinite\(/);
    expect(kod).not.toMatch(/parseFloat|parseInt/);
  });
});
