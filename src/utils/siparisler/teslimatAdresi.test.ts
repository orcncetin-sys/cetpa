/**
 * teslimatAdresi.test.ts — tam adres metni, yapısal şehir, ülke adı, takip ucu kararı ve form yardımcıları.
 * Kullanıcı isteği 2026-10-09: «şehir ve ülke seçtir droplist (otomatik liste yap)».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { yorumsuz } from '../../test/degismezTarayici';
import { MAGAZA_KAYNAGI } from '../../lib/magazaKaynagi';
import type { Order } from '../../types';
import {
  teslimatAdresiMetni,
  siparisSehri,
  takipAdresi,
  ulkeAdi,
  ulkeKoduMu,
  etkinUlke,
  ulkeSecimiYamasi,
  adresKayitAlanlari,
} from './teslimatAdresi';

describe('teslimatAdresiMetni — tam adres: [kalan, il, ülke adı]', () => {
  it("yurt içinde ülke YAZILMAZ (ülke 'TR' ya da alan yok)", () => {
    expect(teslimatAdresiMetni({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatSehri: 'Antalya', teslimatUlke: 'TR' }))
      .toBe('Kepez, Yenigün Mah. 1063 Sok. No:4, Antalya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatSehri: 'Antalya' }))
      .toBe('Kepez, Yenigün Mah. 1063 Sok. No:4, Antalya');
  });

  it("yabancı ülkede TÜRKÇE ülke adı eklenir ('DE' → «Almanya»)", () => {
    expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' }))
      .toBe('Hauptstr. 5, Berlin, Almanya');
  });

  it('boş parçalar atlanır — başta / sonda ayırıcı kalmaz', () => {
    expect(teslimatAdresiMetni({ teslimatSehri: 'Antalya', teslimatUlke: 'TR' })).toBe('Antalya');
    expect(teslimatAdresiMetni({ shippingAddress: '', teslimatSehri: 'Berlin', teslimatUlke: 'DE' })).toBe('Berlin, Almanya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5', teslimatUlke: 'DE' })).toBe('Hauptstr. 5, Almanya');
    expect(teslimatAdresiMetni({ teslimatUlke: 'TR' })).toBe('');
    expect(teslimatAdresiMetni({})).toBe('');
  });

  it('eski kayıt (yalnız `shippingAddress`) baş / son boşluk dışında BİREBİR', () => {
    expect(teslimatAdresiMetni({ shippingAddress: 'Organize Sanayi Bölgesi 7. Cadde No:12, Kayseri' }))
      .toBe('Organize Sanayi Bölgesi 7. Cadde No:12, Kayseri');
    expect(teslimatAdresiMetni({ shippingAddress: '  Antalya / Kepez \n' })).toBe('Antalya / Kepez');
    expect(teslimatAdresiMetni({ shippingAddress: 'Yenigün Mah.\n1063 Sok. No:4' })).toBe('Yenigün Mah.\n1063 Sok. No:4');
  });

  it('il ve kalan kırpılarak birleşir', () => {
    expect(teslimatAdresiMetni({ shippingAddress: ' Muratpaşa ', teslimatSehri: ' Antalya ' })).toBe('Muratpaşa, Antalya');
  });

  describe('yineleme — il / ülke metinde zaten varsa EKLENMEZ (veri değişmez, yalnız metin kurulur)', () => {
    it('son parça il: metin birebir', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'OSB 7. Cadde No:12, Kayseri', teslimatSehri: 'Kayseri' }))
        .toBe('OSB 7. Cadde No:12, Kayseri');
    });

    it("il SON parça değil, ülke adından önce duruyor: 'Kadıköy, İstanbul, Türkiye' birebir", () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Kadıköy, İstanbul, Türkiye', teslimatSehri: 'İstanbul', teslimatUlke: 'TR' }))
        .toBe('Kadıköy, İstanbul, Türkiye');
    });

    it("«ilçe / il» yazımı eğik çizgiyle de parçalanır: 'Kepez / Antalya' birebir", () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Kepez / Antalya', teslimatSehri: 'Antalya' })).toBe('Kepez / Antalya');
    });

    it('satır sonuyla ayrılmış il de parçadır', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Yenigün Mah. 1063 Sok.\nAntalya', teslimatSehri: 'Antalya' }))
        .toBe('Yenigün Mah. 1063 Sok.\nAntalya');
    });

    it("ülkenin İNGİLİZCE adı da yinelemedir: '…, Germany' + 'DE' → «Almanya» EKLENMEZ", () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5, 10115, Germany', teslimatUlke: 'DE' }))
        .toBe('Hauptstr. 5, 10115, Germany');
    });

    it('ülkenin Türkçe adı metindeyse ülke eklenmez; metinde OLMAYAN il yine eklenir (ülke adından sonra — metin yeniden sıralanmaz)', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5, Almanya', teslimatSehri: 'Berlin', teslimatUlke: 'DE' }))
        .toBe('Hauptstr. 5, Almanya, Berlin');
    });

    it('karşılaştırma harf büyüklüğünü ve Türkçe harfi bağışlar (ANTALYA, istanbul)', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Kepez / ANTALYA', teslimatSehri: 'Antalya' })).toBe('Kepez / ANTALYA');
      expect(teslimatAdresiMetni({ shippingAddress: 'Kadikoy, istanbul', teslimatSehri: 'İstanbul' })).toBe('Kadikoy, istanbul');
    });

    it('il metnin PARÇASI değilse eklenir — parçanın içinde geçmesi yineleme sayılmaz', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatSehri: 'Antalya' }))
        .toBe('Kepez, Yenigün Mah. 1063 Sok. No:4, Antalya');
      expect(teslimatAdresiMetni({ shippingAddress: 'Antalya Bulvarı No:8', teslimatSehri: 'Antalya' }))
        .toBe('Antalya Bulvarı No:8, Antalya');
    });

    // İnceleme 2026-10-10: yineleme ölçütü «parça ile EŞİT» değil «parça adla BİTER» (`adlaBiter`). Parça eşitliği
    // boşluk / tire / sondaki nokta ile yazılmış ili kaçırıyor, belgeye (PDF, 505, e-İrsaliye açıklaması, LUCA) il iki
    // kez basılıyordu: '… Kepez Antalya, Antalya'. Paraşüt / Dynamics kaynaklı caride bu kendiliğinden olur (serbest
    // `address` + ayrı `city`).
    describe('«adla BİTER» — il boşluk / tire / sondaki nokta ile yazılmışsa da yinelemedir', () => {
      const il = (shippingAddress: string, teslimatSehri: string, teslimatUlke?: string) => teslimatAdresiMetni({ shippingAddress, teslimatSehri, teslimatUlke });

      it.each([
        ['boşluk', 'Yenigün Mah. 1063 Sok. No:4 Kepez Antalya'],
        ['boşluklu tire', 'Yenigün Mah. 1063 Sok. No:4 Kepez - Antalya'],
        ['bitişik tire + büyük harf', 'Yenigün Mah. 1063 Sok. No:4 Kepez-ANTALYA'],
        ['posta kodu + ilçe + il aynı parçada', 'Yenigün Mah. 1063 Sok. No:4, 07090 Kepez Antalya'],
        ['sondaki nokta', 'Kepez, Antalya.'],
        ['sondaki noktalar', 'Kepez Antalya...'],
      ])('%s: metin BİREBİR, il ikinci kez eklenmez', (_ad, adres) => {
        expect(il(adres, 'Antalya')).toBe(adres);
      });

      it('Türkçe harf ve büyüklük bağışlanır (ASCII yazılmış / büyük yazılmış il)', () => {
        expect(il('Kadikoy istanbul', 'İstanbul')).toBe('Kadikoy istanbul');
        expect(il('ŞİŞLİ İSTANBUL', 'İstanbul')).toBe('ŞİŞLİ İSTANBUL');
        expect(il('Merkez Iğdır', 'Iğdır')).toBe('Merkez Iğdır');
      });

      it("yurt dışı: '10115 Berlin' + Berlin → şehir eklenmez, ülke eklenir; çok sözcüklü şehir de yakalanır", () => {
        expect(il('Hauptstr. 5, 10115 Berlin', 'Berlin', 'DE')).toBe('Hauptstr. 5, 10115 Berlin, Almanya');
        expect(il('5th Ave, 10001 New York', 'New York', 'US')).toBe('5th Ave, 10001 New York, Amerika Birleşik Devletleri');
      });

      it('ülke adı için de aynı ölçüt: adla biten parça (boşluk / tire / sondaki nokta) → ülke eklenmez', () => {
        expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5, 10115 Berlin - Almanya.', teslimatUlke: 'DE' })).toBe('Hauptstr. 5, 10115 Berlin - Almanya.');
        expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5, Berlin Germany', teslimatUlke: 'DE' })).toBe('Hauptstr. 5, Berlin Germany');
      });

      it('KORUNAN: il parçanın BAŞINDA / ortasında → yineleme DEĞİL, il eklenir', () => {
        expect(il('Antalya Cad. No:5', 'Antalya')).toBe('Antalya Cad. No:5, Antalya');
        expect(il('Antalya Bulvarı No:8', 'Antalya')).toBe('Antalya Bulvarı No:8, Antalya');
      });

      it("KORUNAN: il bir sözcüğün KUYRUĞU ('Kervan' + Van) → yineleme DEĞİL — mutasyon-ayırt-edici (çıplak `endsWith`)", () => {
        expect(il('Kolordu Cad. No 3 Kervan', 'Van')).toBe('Kolordu Cad. No 3 Kervan, Van');
        expect(il('Atatürk Cad. Divan', 'Van')).toBe('Atatürk Cad. Divan, Van');
      });

      it("BEDEL (kabul edildi): il adıyla BİTEN yer adı yineleme sayılır — 'Mall of Antalya, Altınova' + Antalya → il eklenmez", () => {
        // İl adı metinde görünür kalır ve `teslimatSehri` alanı değişmez; etkilenen yalnız kurulan metindir.
        expect(il('Mall of Antalya, Altınova', 'Antalya')).toBe('Mall of Antalya, Altınova');
        expect(siparisSehri({ shippingAddress: 'Mall of Antalya, Altınova', teslimatSehri: 'Antalya' })).toBe('Antalya');
        // Aynı bedel ülke adında: 'France' ile biten cadde adı.
        expect(il('12 Avenue de France', 'Paris', 'FR')).toBe('12 Avenue de France, Paris');
      });

      it('BİLİNEN SINIRLAR (ölçüldü, kapsam dışı): yerel dilde ülke adı, boşluksuz uzun tire, il + ülke aynı parçada', () => {
        // 'Deutschland' ne Türkçe ne İngilizce addır → ülke eklenir (il yinelemesi yine kalkar).
        expect(il('Hauptstr. 5, 10115 Berlin, Deutschland', 'Berlin', 'DE')).toBe('Hauptstr. 5, 10115 Berlin, Deutschland, Almanya');
        // Uzun tire (–) boşluksuz yazılmışsa ayırıcı sayılmaz.
        expect(il('Kepez–Antalya', 'Antalya')).toBe('Kepez–Antalya, Antalya');
        // Parça ülke adıyla bitiyor, şehir ortada kalıyor → şehir eklenir (ülke eklenmez).
        expect(il('Hauptstr. 5, 10115 Berlin Germany', 'Berlin', 'DE')).toBe('Hauptstr. 5, 10115 Berlin Germany, Berlin');
      });
    });
  });

  describe('mağaza siparişi — `shippingAddress` zaten TAM adres', () => {
    it('metin AYNEN döner: «ilçe / il» ve ülke EKLENMEZ', () => {
      expect(teslimatAdresiMetni({
        source: MAGAZA_KAYNAGI, shippingAddress: 'Kızılay Mah. Atatürk Blv. No:10, Çankaya, Ankara, 06420',
        teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'DE',
      })).toBe('Kızılay Mah. Atatürk Blv. No:10, Çankaya, Ankara, 06420');
    });

    it('adresi olmayan mağaza siparişinde boş metin (ilden adres uydurulmaz)', () => {
      expect(teslimatAdresiMetni({ source: MAGAZA_KAYNAGI, teslimatSehri: 'Çankaya / Ankara', teslimatUlke: 'TR' })).toBe('');
    });
  });

  describe('gevşek girdi — fırlatmaz', () => {
    it('`teslimatSehri` / `teslimatUlke` `null` → boş sayılır', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 'Kepez', teslimatSehri: null, teslimatUlke: null })).toBe('Kepez');
    });

    it('yalnız boşluktan oluşan parça boş sayılır', () => {
      expect(teslimatAdresiMetni({ shippingAddress: '   ', teslimatSehri: '  ', teslimatUlke: 'TR' })).toBe('');
    });

    it('metin olmayan alan (sayı, nesne, dizi) boş sayılır; `null` / tanımsız sipariş boş metin', () => {
      expect(teslimatAdresiMetni({ shippingAddress: 42, teslimatSehri: { ad: 'Antalya' }, teslimatUlke: ['DE'] })).toBe('');
      expect(teslimatAdresiMetni({ shippingAddress: 'Kepez', teslimatSehri: 7 })).toBe('Kepez');
      expect(teslimatAdresiMetni(null)).toBe('');
      expect(teslimatAdresiMetni(undefined)).toBe('');
    });

    it('geçersiz ülke kodu yurt içi sayılır; çözülemeyen kodda ülke yazılmaz — ham kod metne BASILMAZ', () => {
      for (const kod of ['de', 'DEU', '', 'AA', 'ZZ']) {
        const metin = teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: kod });
        expect(metin, kod).toBe('Hauptstr. 5, Berlin');
      }
    });
  });

  it('tip: `Order` da `Record<string, unknown>` da girdi olur (PDF dışa aktarımının girdisi)', () => {
    const siparis = { id: 'ord-1', customerName: 'Şirin Yapı', totalPrice: 100, status: 'Pending', customerType: 'B2B', shippingAddress: 'Kepez', teslimatSehri: 'Antalya' } as Order;
    const ham: Record<string, unknown> = { shippingAddress: 'Kepez', teslimatSehri: 'Antalya' };
    const karisik: Order | Record<string, unknown> = ham;
    expect(teslimatAdresiMetni(siparis)).toBe('Kepez, Antalya');
    expect(teslimatAdresiMetni(ham)).toBe('Kepez, Antalya');
    expect(teslimatAdresiMetni(karisik)).toBe('Kepez, Antalya');
  });
});

describe('ulkeAdi — ISO2 → görünen ad; çözülemezse `null` (ham kod dönmez)', () => {
  it("'TR' → «Türkiye»; 'DE' → «Almanya» / 'Germany'", () => {
    expect(ulkeAdi('TR', 'tr')).toBe('Türkiye');
    expect(ulkeAdi('DE', 'tr')).toBe('Almanya');
    expect(ulkeAdi('DE', 'en')).toBe('Germany');
  });

  it("biçimi tutmayan kod → `null`: küçük harf, üç harf, boş, metin olmayan", () => {
    for (const kod of ['de', 'DEU', '', ' DE', 'D', null, undefined, 49, {}]) expect(ulkeAdi(kod, 'tr'), String(kod)).toBeNull();
  });

  it("biçimi tutan ama ad çözülmeyen kod → `null`: 'AA' (sonuç kodun kendisi), 'ZZ' («Bilinmeyen Bölge»)", () => {
    for (const dil of ['tr', 'en'] as const) {
      expect(ulkeAdi('AA', dil), dil).toBeNull();
      expect(ulkeAdi('ZZ', dil), dil).toBeNull();
    }
  });

  it('`/geo/cities/_index.json` içindeki HER ülke kodu iki dilde de ada çözülür', () => {
    const kodlar: string[] = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'geo', 'cities', '_index.json'), 'utf-8'));
    expect(kodlar.length).toBeGreaterThan(200);
    expect(kodlar.filter(k => ulkeAdi(k, 'tr') === null || ulkeAdi(k, 'en') === null)).toEqual([]);
  });
});

describe('ulkeKoduMu — biçim: iki BÜYÜK harf (kırpma / büyütme yok)', () => {
  it("'TR', 'DE' kod; adı çözülmeyen 'AA' da BİÇİMCE kod", () => {
    for (const v of ['TR', 'DE', 'AA']) expect(ulkeKoduMu(v), v).toBe(true);
  });

  it("küçük harf, üç harf, boşluklu, boş, `null`, tanımsız, metin olmayan → kod DEĞİL", () => {
    for (const v of ['tr', 'Tr', 'TUR', ' TR', 'TR ', 'T', '', null, undefined, 90, ['TR']]) expect(ulkeKoduMu(v), String(v)).toBe(false);
  });
});

describe('etkinUlke — kayıtta yoksa / geçersizse TR', () => {
  it("yok / `null` / '' / küçük harf / üç harf / metin olmayan → 'TR'", () => {
    for (const v of [undefined, null, '', 'de', 'DEU', ' DE ', 49, {}]) expect(etkinUlke(v), String(v)).toBe('TR');
  });

  it("geçerli kod aynen: 'DE' → 'DE', 'TR' → 'TR'", () => {
    expect(etkinUlke('DE')).toBe('DE');
    expect(etkinUlke('TR')).toBe('TR');
  });
});

describe('siparisSehri — yapısal şehir (raporlar önce bunu okur)', () => {
  it('il dolu → il (kırpılmış)', () => {
    expect(siparisSehri({ teslimatSehri: 'Antalya' })).toBe('Antalya');
    expect(siparisSehri({ teslimatSehri: ' Berlin ', teslimatUlke: 'DE' })).toBe('Berlin');
  });

  it('mağaza siparişi → `null` (alan «ilçe / il»dir, il değil)', () => {
    expect(siparisSehri({ source: MAGAZA_KAYNAGI, teslimatSehri: 'Çankaya / Ankara' })).toBeNull();
  });

  it('`null` / boşluk / alan yok / metin olmayan → `null`; adres metninden şehir TÜRETİLMEZ', () => {
    for (const il of [null, '', '   ', undefined, 7]) expect(siparisSehri({ teslimatSehri: il, shippingAddress: 'Kepez / Antalya' }), String(il)).toBeNull();
    expect(siparisSehri(null)).toBeNull();
    expect(siparisSehri(undefined)).toBeNull();
  });
});

describe('takipAdresi — kimliksiz takip ucunun adres kararı', () => {
  it('yapısal alanlı kayıtta `metin` içinde kalanın HİÇBİR parçası geçmez', () => {
    const kalan = 'Muratpaşa, Yenigün Mah. 1063 Sok. No:4 D:7';
    const sonuc = takipAdresi({ shippingAddress: kalan, teslimatSehri: 'Antalya', teslimatUlke: 'TR' });
    expect(sonuc).toEqual({ yapisal: true, metin: 'Antalya' });
    // «Son iki parça» maskesi burada 'Muratpaşa, Yenigün Mah. 1063 Sok. No:4 D:7' verirdi (kapı no dışarı çıkardı).
    for (const parca of kalan.split(',').map(p => p.trim())) expect(JSON.stringify(sonuc), parca).not.toContain(parca);
  });

  it("yabancı ülkede 'şehir, Türkçe ülke adı': 'Berlin, Almanya'", () => {
    expect(takipAdresi({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' })).toEqual({ yapisal: true, metin: 'Berlin, Almanya' });
  });

  it("yalnız il (ülke alanı yok) → yapısal, metin il", () => {
    expect(takipAdresi({ shippingAddress: 'Kepez', teslimatSehri: 'Antalya' })).toEqual({ yapisal: true, metin: 'Antalya' });
  });

  it("yalnız `teslimatUlke: 'TR'` (il seçilmemiş yeni sipariş) → `{ yapisal: true, metin: null }` — kalan dışarı verilmez", () => {
    expect(takipAdresi({ shippingAddress: 'Kepez, Yenigün Mah. 1063 Sok. No:4', teslimatUlke: 'TR' })).toEqual({ yapisal: true, metin: null });
  });

  it('yalnız yabancı ülke → metin ülke adı', () => {
    expect(takipAdresi({ shippingAddress: 'Hauptstr. 5', teslimatUlke: 'DE' })).toEqual({ yapisal: true, metin: 'Almanya' });
  });

  it('ikisi de yoksa / `null` / boşluksa `{ yapisal: false }` — çağıran eski maskeyi aynen çalıştırır', () => {
    expect(takipAdresi({ shippingAddress: 'Organize Sanayi Bölgesi 7. Cadde No:12, Kayseri' })).toEqual({ yapisal: false });
    expect(takipAdresi({ shippingAddress: 'Kepez', teslimatSehri: null, teslimatUlke: null })).toEqual({ yapisal: false });
    expect(takipAdresi({ shippingAddress: 'Kepez', teslimatSehri: '  ', teslimatUlke: '' })).toEqual({ yapisal: false });
    expect(takipAdresi({})).toEqual({ yapisal: false });
    expect(takipAdresi(null)).toEqual({ yapisal: false });
  });

  it('çözülemeyen ülke kodu metne BASILMAZ', () => {
    expect(takipAdresi({ teslimatSehri: 'Berlin', teslimatUlke: 'AA' })).toEqual({ yapisal: true, metin: 'Berlin' });
    expect(takipAdresi({ teslimatUlke: 'ZZ' })).toEqual({ yapisal: true, metin: null });
  });
});

describe('ulkeSecimiYamasi — ülke değişince il boşalır', () => {
  it('aynı ülke → `{}` (il korunur)', () => {
    expect(ulkeSecimiYamasi('DE', 'DE')).toEqual({});
    expect(ulkeSecimiYamasi('TR', 'TR')).toEqual({});
  });

  it("kayıtta ülke yok / `null` / geçersiz → 'TR' seçimi değişiklik DEĞİL: `{}`", () => {
    for (const mevcut of [undefined, null, '', 'tr']) expect(ulkeSecimiYamasi(mevcut, 'TR'), String(mevcut)).toEqual({});
  });

  it("TR → DE: `{ teslimatUlke: 'DE', teslimatSehri: '' }`; DE → TR de ili boşaltır", () => {
    expect(ulkeSecimiYamasi('TR', 'DE')).toEqual({ teslimatUlke: 'DE', teslimatSehri: '' });
    expect(ulkeSecimiYamasi(undefined, 'DE')).toEqual({ teslimatUlke: 'DE', teslimatSehri: '' });
    expect(ulkeSecimiYamasi('DE', 'TR')).toEqual({ teslimatUlke: 'TR', teslimatSehri: '' });
  });
});

describe('adresKayitAlanlari — yeni sipariş gövdesinin iki alanı', () => {
  it("ülke HER ZAMAN yazılır ('TR' dâhil; formda yoksa / geçersizse 'TR')", () => {
    expect(adresKayitAlanlari({ teslimatUlke: 'TR' })).toEqual({ teslimatUlke: 'TR' });
    expect(adresKayitAlanlari({})).toEqual({ teslimatUlke: 'TR' });
    expect(adresKayitAlanlari({ teslimatUlke: 'de' })).toEqual({ teslimatUlke: 'TR' });
    expect(adresKayitAlanlari({ teslimatUlke: 'DE', teslimatSehri: 'Berlin' })).toEqual({ teslimatUlke: 'DE', teslimatSehri: 'Berlin' });
  });

  it('boş / boşluk / `null` / tanımsız il → `teslimatSehri` anahtarı gövdede YOK (`undefined` değeriyle de yok)', () => {
    for (const il of ['', '   ', null, undefined]) {
      const alanlar = adresKayitAlanlari({ teslimatUlke: 'TR', teslimatSehri: il });
      expect(alanlar, String(il)).toEqual({ teslimatUlke: 'TR' });
      expect('teslimatSehri' in alanlar, String(il)).toBe(false);
    }
  });

  it('dolu il kırpılır', () => {
    expect(adresKayitAlanlari({ teslimatUlke: 'TR', teslimatSehri: ' Antalya ' })).toEqual({ teslimatUlke: 'TR', teslimatSehri: 'Antalya' });
  });
});

describe('ÇİT: modül saf, ülke adının tek kaynağı', () => {
  const kod = (yol: string) => yorumsuz(yol, readFileSync(yol, 'utf-8')).join('\n');

  it('`teslimatAdresi.ts` React içe AKTARMAZ; yalnız `../arama` ve `../../lib/magazaKaynagi`', () => {
    const kaynak = kod(join(__dirname, 'teslimatAdresi.ts'));
    const iceAktarilan = [...kaynak.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
    expect(iceAktarilan).toEqual(['../../lib/magazaKaynagi', '../arama']);
    expect(kaynak).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('`useWorldGeo.countryDisplayName` `ulkeAdi`\'ye devreder; kancada ikinci `Intl.DisplayNames` YOK', () => {
    const kaynak = kod(join(__dirname, '..', '..', 'hooks', 'useWorldGeo.ts'));
    expect(kaynak).toMatch(/ulkeAdi\(iso2, lang\) \?\? iso2/);
    expect(kaynak).not.toMatch(/Intl\.DisplayNames/);
  });
});

describe('teslimatAdresiMetni — nokta ile biten şehir adı yinelenmez (delta incelemesi 2026-10-10)', () => {
  it('ad da parça da sondaki noktadan AYNI kırpılır: yineleme yakalanır, ülke yine eklenir', () => {
    expect(teslimatAdresiMetni({ shippingAddress: 'Zeil 5, Frankfurt a.M.', teslimatSehri: 'Frankfurt a.M.', teslimatUlke: 'DE' })).toBe('Zeil 5, Frankfurt a.M., Almanya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Zeil 5, Frankfurt a.M', teslimatSehri: 'Frankfurt a.M.', teslimatUlke: 'DE' })).toBe('Zeil 5, Frankfurt a.M, Almanya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Zeil 5 Frankfurt a.M.', teslimatSehri: 'Frankfurt a.M.', teslimatUlke: 'DE' })).toBe('Zeil 5 Frankfurt a.M., Almanya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Av. Reforma 10, México D.F.', teslimatSehri: 'México D.F.', teslimatUlke: 'MX' })).toBe('Av. Reforma 10, México D.F., Meksika');
  });
  it('korunan davranışlar: başta duran ad ve sözcük kuyruğu yineleme sayılmaz; yalnız noktadan oluşan «ad» hiçbir parçayla eşleşmez', () => {
    expect(teslimatAdresiMetni({ shippingAddress: 'Antalya Cad. No:5', teslimatSehri: 'Antalya', teslimatUlke: 'TR' })).toBe('Antalya Cad. No:5, Antalya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Kolordu Cad. No 3 Kervan', teslimatSehri: 'Van', teslimatUlke: 'TR' })).toBe('Kolordu Cad. No 3 Kervan, Van');
    expect(teslimatAdresiMetni({ shippingAddress: 'Hauptstr. 5', teslimatSehri: 'Berlin', teslimatUlke: 'DE' })).toBe('Hauptstr. 5, Berlin, Almanya');
    expect(teslimatAdresiMetni({ shippingAddress: 'Kepez -', teslimatSehri: '.', teslimatUlke: 'TR' })).toBe('Kepez -, .');
  });
});
