/**
 * eslemeCari.test.ts — Mikro'dan OKUYAN cari eşlemeleri (Faz 3 3/n, grup "eslemeCari").
 * ÖNCE YAZILDI (kırmızı görüldü), sonra eslemeCari.ts.
 *
 * Kilitlenen sözleşme iki yönlü:
 *  (1) PARİTE — bilinen girdide çıkan doküman bugünkü rotayla BİREBİR aynı
 *      (alan adları + değerler). Bu testler bozulursa canlı veri şekli değişmiş demektir.
 *  (2) BİLİNMEYEN 0/'' YAZILMAZ — Mikro okuması bozulduğunda (kolon adı değişti, şema
 *      keşfi boş döndü) eski kod sessizce `''`/`false`/`'Customer'`/`0` yazıp CRM'deki
 *      gerçek değeri siliyordu. Artık alan HİÇ yazılmaz (merge/update mevcut değeri
 *      korur) ve sayılır; alan TÜM satırlarda okunamıyorsa bu veri değil OKUMA ARIZASIDIR.
 */
import { describe, it, expect } from 'vitest';
import {
  cariEsle, cariEslemeOzeti,
  bakiyeEsle, bakiyeHaritasi, cariBakiyesi,
  adresSec, adresGuncellemesi, adresOzeti,
  ARIZA_ESIGI,
} from './eslemeCari';

// ── Fikstürler (Türkçe, gerçek Mikro alan adları) ────────────────────────────
const SIRIN = {
  cari_kod: '120.01.0042',
  cari_unvan1: 'ŞİRİN İNŞAAT MALZEMELERİ LTD. ŞTİ.',
  cari_unvan2: '',
  cari_vdaire_no: '1234567890',
  cari_vdaire_adi: 'Kadıköy',
  cari_EMail: 'muhasebe@sirininsaat.com.tr',
  cari_CepTel: '05551112233',
  cari_efatura_fl: 1,
  cari_hareket_tipi: 0,
  cari_baglanti_tipi: 0,
};
const SECENEK = { companyId: 'A', zamanDamgasi: 'TS' };

describe('cariEsle — parite', () => {
  it('bilinen satır: bugünkü rotayla BİREBİR aynı doküman', () => {
    const e = cariEsle(SIRIN, SECENEK);
    expect(e).not.toBeNull();
    expect(e!.cariKod).toBe('120.01.0042');
    expect(e!.alanlar).toEqual({
      name: 'ŞİRİN İNŞAAT MALZEMELERİ LTD. ŞTİ.',
      company: 'ŞİRİN İNŞAAT MALZEMELERİ LTD. ŞTİ.',
      email: 'muhasebe@sirininsaat.com.tr',
      phone: '05551112233',
      taxId: '1234567890',
      taxOffice: 'Kadıköy',
      eFaturaKayitli: true,
      type: 'Customer',
      mikroCariKod: '120.01.0042',
      mikroSynced: true,
      mikroSyncedAt: 'TS',
      companyId: 'A',
    });
    expect(e!.bilinmeyen).toEqual([]);
  });

  it('hareket tipi 1 → Supplier (sayısal string de aynı)', () => {
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: 1 }, SECENEK)!.alanlar.type).toBe('Supplier');
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: '1' }, SECENEK)!.alanlar.type).toBe('Supplier');
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: 0 }, SECENEK)!.alanlar.type).toBe('Customer');
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: 2 }, SECENEK)!.alanlar.type).toBe('Customer');
  });

  it('e-fatura bayrağı 0 → false (bilinen sıfır yazılır)', () => {
    const e = cariEsle({ ...SIRIN, cari_efatura_fl: 0 }, SECENEK)!;
    expect(e.alanlar.eFaturaKayitli).toBe(false);
    expect(e.bilinmeyen).toEqual([]);
  });

  it('yeni kayıt alanları status taşır — güncellemede TAŞIMAZ', () => {
    const e = cariEsle(SIRIN, SECENEK)!;
    // Tüm alanlar biliniyor → doldurulacak metin alanı yok.
    expect(e.yeniKayitAlanlari).toEqual({ status: 'Active' });
    expect(e.alanlar).not.toHaveProperty('status');
    expect(e.alanlar).not.toHaveProperty('source');
  });

  // 2026-09-19 delta bulgusu: eski rotalar `email: (x as string) || ''` yazıyordu; yeni
  // eşleme alanı HİÇ yazmayınca `Lead` tipinin `email: string` sözleşmesi YENİ kayıtta
  // bozuluyor ve okuyan ekranlar (`l.email.toLowerCase()`) çöküyordu. `personelEsle`
  // aynı sınıfı `if (yeniKayit) alanlar[alan] = '';` ile zaten kapatmıştı (HRModule notu).
  // GÜNCELLEMEDE hâlâ yazılmaz: orada '' elle girilmiş gerçek veriyi SİLERDİ.
  describe('yeniKayitAlanlari — bilinmeyen METİN alanı YENİ kayıtta boş metinle açılır', () => {
    const BOS = { ...SIRIN, cari_unvan1: '', cari_EMail: '', cari_CepTel: '', cari_vdaire_no: '', cari_vdaire_adi: '' };

    it("bilinmeyen metin alanları `yeniKayitAlanlari`'na '' olarak girer", () => {
      const e = cariEsle(BOS, SECENEK)!;
      expect(e.yeniKayitAlanlari).toEqual({
        // `name`: unvan okunamadığında kimlik yedeği YALNIZ yeni kayıtta (güncellemede mevcut ad ezilmez).
        status: 'Active', name: '120.01.0042', company: '', email: '', phone: '', taxId: '', taxOffice: '',
      });
    });

    it("GÜNCELLEME gövdesi (`alanlar`) yine DOKUNMAZ — mevcut e-posta korunur", () => {
      const e = cariEsle(BOS, SECENEK)!;
      for (const alan of ['company', 'email', 'phone', 'taxId', 'taxOffice']) {
        expect(e.alanlar, `${alan} güncellemede yazılmamalı`).not.toHaveProperty(alan);
      }
      expect(e.bilinmeyen).toEqual(['company', 'email', 'phone', 'taxId', 'taxOffice']);
    });

    it('BİLİNEN alan yeniKayitAlanlari ile EZİLMEZ (yalnız bilinmeyenler doldurulur)', () => {
      const e = cariEsle({ ...BOS, cari_EMail: 'muhasebe@sirin.com.tr' }, SECENEK)!;
      expect(e.alanlar.email).toBe('muhasebe@sirin.com.tr');
      expect(e.yeniKayitAlanlari).not.toHaveProperty('email');
    });

    it('BAYRAK/TİP alanı boş metinle DOLDURULMAZ (type/eFaturaKayitli uydurulmaz)', () => {
      const e = cariEsle({ ...SIRIN, cari_hareket_tipi: undefined, cari_efatura_fl: undefined }, SECENEK)!;
      expect(e.yeniKayitAlanlari).toEqual({ status: 'Active' });
    });
  });

  it('cari kodu boşluklu gelirse trimlenir; kod yoksa satır atlanır (null)', () => {
    expect(cariEsle({ ...SIRIN, cari_kod: '  120.01.0042  ' }, SECENEK)!.cariKod).toBe('120.01.0042');
    expect(cariEsle({ ...SIRIN, cari_kod: '   ' }, SECENEK)).toBeNull();
    expect(cariEsle({ ...SIRIN, cari_kod: undefined }, SECENEK)).toBeNull();
  });

  it('SQL Server CHAR dolgusu kırpılır (unvan/e-posta sağı boşlukla gelir)', () => {
    const e = cariEsle({ ...SIRIN, cari_unvan1: 'ŞİRİN İNŞAAT   ', cari_CepTel: ' 05551112233 ' }, SECENEK)!;
    expect(e.alanlar.name).toBe('ŞİRİN İNŞAAT');
    expect(e.alanlar.phone).toBe('05551112233');
  });
});

describe('cariEsle — bilinmeyen alan YAZILMAZ', () => {
  it('hareket tipi bilinmiyorsa `type` yazılmaz (Customer VARSAYILMAZ)', () => {
    const e = cariEsle({ ...SIRIN, cari_hareket_tipi: undefined }, SECENEK)!;
    expect(e.alanlar).not.toHaveProperty('type');
    expect(e.bilinmeyen).toContain('type');
    // Kritik: eski kod `Number(x ?? 0) === 1 ? 'Supplier' : 'Customer'` ile
    // TEDARİKÇİYİ müşteri diye işaretliyordu; `type` yazılmayınca mevcut değer korunur.
    expect(e.alanlar.type).toBeUndefined();
  });

  it('e-fatura bayrağı bilinmiyorsa `eFaturaKayitli` yazılmaz (false VARSAYILMAZ)', () => {
    for (const bayrak of [undefined, null, '', '   ', 'E']) {
      const e = cariEsle({ ...SIRIN, cari_efatura_fl: bayrak }, SECENEK)!;
      expect(e.alanlar).not.toHaveProperty('eFaturaKayitli');
      expect(e.bilinmeyen).toContain('eFaturaKayitli');
    }
  });

  // SQL Server `bit` kolonu JSON'a boolean olarak dönebilir (aynı kod tabanı Mikro'ya
  // `_fl` alanlarını boolean gönderiyor — govdeSiparis `sip_vergisiz_fl: false`).
  // Eski satır içi kod `Number(true) === 1` ile bunu okuyordu; `bilinenSayi` yalnız
  // number/string kabul ettiği için boolean "bilinmiyor" sayılsaydı HİÇBİR carinin
  // e-fatura bayrağı güncellenmezdi (parite kırığı, hakem bulgusu 2026-09-19).
  it('bit kolonu JSON boolean gelirse BİLİNİR: true/false → eFaturaKayitli true/false', () => {
    expect(cariEsle({ ...SIRIN, cari_efatura_fl: true }, SECENEK)!.alanlar.eFaturaKayitli).toBe(true);
    expect(cariEsle({ ...SIRIN, cari_efatura_fl: false }, SECENEK)!.alanlar.eFaturaKayitli).toBe(false);
    for (const bayrak of [true, false]) {
      expect(cariEsle({ ...SIRIN, cari_efatura_fl: bayrak }, SECENEK)!.bilinmeyen).not.toContain('eFaturaKayitli');
    }
  });

  it('hareket tipi boolean gelirse parite: true → Supplier, false → Customer', () => {
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: true }, SECENEK)!.alanlar.type).toBe('Supplier');
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: false }, SECENEK)!.alanlar.type).toBe('Customer');
    expect(cariEsle({ ...SIRIN, cari_hareket_tipi: true }, SECENEK)!.bilinmeyen).not.toContain('type');
  });

  it('boş metin alanları YAZILMAZ — CRM’de elle girilmiş e-posta/telefon silinmez', () => {
    const e = cariEsle({ ...SIRIN, cari_EMail: '', cari_CepTel: '   ', cari_vdaire_no: null, cari_vdaire_adi: undefined }, SECENEK)!;
    expect(e.alanlar).not.toHaveProperty('email');
    expect(e.alanlar).not.toHaveProperty('phone');
    expect(e.alanlar).not.toHaveProperty('taxId');
    expect(e.alanlar).not.toHaveProperty('taxOffice');
    expect(e.bilinmeyen).toEqual(expect.arrayContaining(['email', 'phone', 'taxId', 'taxOffice']));
    // Yazılanlar hâlâ doğru — satır tümden atılmıyor.
    expect(e.alanlar.mikroCariKod).toBe('120.01.0042');
    expect(e.alanlar.name).toBe('ŞİRİN İNŞAAT MALZEMELERİ LTD. ŞTİ.');
  });

  // 2026-09-19 kapanış incelemesi: `alanlar` GÜNCELLEMEDE de yazılır. Unvan bir koşuda okunamazsa (FieldName /
  // sürüm kayması) eski `alanlar.name = cariKod` tek koşuda TÜM lead adlarını cari koduna çevirirdi (saatlik cron +
  // iki rota). Kimlik yedeği yalnız YENİ kayıt içindir (adsız lead CRM'de görünmez); mevcut ad EZİLMEZ.
  it('unvan yoksa: `name` güncelleme alanlarında YOK, cari kodu yalnız YENİ kayıt yedeği; company YAZILMAZ (mutasyon-ayırt-edici)', () => {
    const e = cariEsle({ ...SIRIN, cari_unvan1: '' }, SECENEK)!;
    expect(e.alanlar).not.toHaveProperty('name');
    expect(e.yeniKayitAlanlari.name).toBe('120.01.0042');
    expect(e.alanlar).not.toHaveProperty('company');
    expect(e.bilinmeyen).toContain('company');
  });
});

describe('cariEslemeOzeti — sayaç + okuma arızası', () => {
  const satirlar = (n: number, ek: Record<string, unknown> = {}) =>
    Array.from({ length: n }, (_, i) => cariEsle({ ...SIRIN, cari_kod: `C${i}`, ...ek }, SECENEK)!);

  it('kısmi eksik: sayaç notu, okuma arızası YOK', () => {
    const karisik = [...satirlar(4), ...satirlar(2, { cari_CepTel: '' })];
    const o = cariEslemeOzeti(karisik);
    expect(o.satir).toBe(6);
    expect(o.sayac.phone).toBe(2);
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not).toBe('2 satırın phone alanı bilinmiyor');
  });

  it('KRİTİK alan HİÇBİR satırda okunamadıysa → okuma arızası + notun BAŞINDA uyarı', () => {
    const o = cariEslemeOzeti(satirlar(ARIZA_ESIGI, { cari_unvan1: '' }));
    expect(o.okumaArizasi).toEqual(['company']);
    expect(o.not.startsWith('UYARI: company alanı hiçbir satırda okunamadı')).toBe(true);
    expect(o.not).toContain('kolon adı/şema kontrol edin');
  });

  it('eşik altı satırda okuma arızası İDDİA EDİLMEZ (3 carili firma normal olabilir)', () => {
    const o = cariEslemeOzeti(satirlar(ARIZA_ESIGI - 1, { cari_unvan1: '' }));
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not).toContain('alanı bilinmiyor');
  });

  // 2026-09-19 delta bulgusu: tarama TÜM alanları aday sayıyordu; e-postası olmayan
  // cari Türk KOBİ'sinde kuraldır, istisna değil. Kalıcı yanlış "şema kontrol edin"
  // uyarısı, gerçek kolon kaymasını aynı cümlenin içinde görünmez kılıyordu.
  it('e-posta/telefon/VKN hiçbir caride yoksa bu ŞEMA ARIZASI DEĞİLDİR (yalnız sayaç)', () => {
    const o = cariEslemeOzeti(satirlar(8, { cari_EMail: '', cari_CepTel: '', cari_vdaire_no: '', cari_vdaire_adi: '' }));
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not.startsWith('UYARI:')).toBe(false);
    expect(o.not).toContain('8 satırın email alanı bilinmiyor');
  });

  it('tip/e-fatura bayrağı hiçbir satırda okunamıyorsa ARIZADIR (bit kolonu daima 0/1 döner)', () => {
    const o = cariEslemeOzeti(satirlar(6, { cari_hareket_tipi: undefined, cari_efatura_fl: undefined }));
    expect(o.okumaArizasi).toEqual(['eFaturaKayitli', 'type']);
  });

  it('hiç eksik yoksa not boş', () => {
    const o = cariEslemeOzeti(satirlar(6));
    expect(o.not).toBe('');
    expect(o.okumaArizasi).toEqual([]);
  });
});

describe('bakiyeEsle — işaret KORUNUR, bilinmeyen 0 değildir', () => {
  it('eksi bakiye AYNEN kalır (eksi = CETPA borçlu)', () => {
    expect(bakiyeEsle({ cha_kod: '120.01.0042', bakiye: -15250.75 })).toEqual({ cariKod: '120.01.0042', bakiye: -15250.75 });
    expect(bakiyeEsle({ cha_kod: '320.01.0007', bakiye: 48900 })).toEqual({ cariKod: '320.01.0007', bakiye: 48900 });
  });

  it('sayısal string kabul, kod trimlenir', () => {
    expect(bakiyeEsle({ cha_kod: ' 120.01.0042 ', bakiye: '-15250.75' })).toEqual({ cariKod: '120.01.0042', bakiye: -15250.75 });
  });

  it('bilinmeyen bakiye null — 0 DEĞİL', () => {
    for (const ham of [undefined, null, '', '   ', 'yok', NaN, Infinity]) {
      expect(bakiyeEsle({ cha_kod: 'C1', bakiye: ham })!.bakiye).toBeNull();
    }
  });

  it('kodsuz satır atlanır', () => {
    expect(bakiyeEsle({ cha_kod: '  ', bakiye: 100 })).toBeNull();
    expect(bakiyeEsle({ bakiye: 100 })).toBeNull();
  });
});

describe('bakiyeHaritasi', () => {
  it('bilinenleri haritalar, bilinmeyeni SAYAR ve haritaya koymaz', () => {
    const h = bakiyeHaritasi([
      { cha_kod: 'C1', bakiye: -100 },
      { cha_kod: 'C2', bakiye: '' },
      { cha_kod: 'C3', bakiye: 250.5 },
      { cha_kod: '', bakiye: 9 },
    ]);
    expect(h.harita.get('C1')).toBe(-100);
    expect(h.harita.has('C2')).toBe(false);
    expect(h.harita.get('C3')).toBe(250.5);
    expect(h.okunamayan).toBe(1);
    expect(h.okumaArizasi).toEqual([]);
  });

  it('TÜM satırların bakiyesi okunamadıysa okuma arızası (toplu sıfırlama kapısı)', () => {
    const satirlar = Array.from({ length: ARIZA_ESIGI }, (_, i) => ({ cha_kod: `C${i}`, bakiye: null }));
    const h = bakiyeHaritasi(satirlar);
    expect(h.harita.size).toBe(0);
    expect(h.okumaArizasi).toEqual(['bakiye']);
    expect(h.not.startsWith('UYARI: bakiye alanı hiçbir satırda okunamadı')).toBe(true);
  });

  it('aynı cari iki kez gelirse bilinmeyen satır bilineni EZMEZ', () => {
    const h = bakiyeHaritasi([{ cha_kod: 'C1', bakiye: -100 }, { cha_kod: 'C1', bakiye: null }]);
    expect(h.harita.get('C1')).toBe(-100);
  });

  // "Haritada yok" İKİ ayrı şey demektir ve ikisi ZITTIR: (a) Mikro'da hiç hareketi
  // yok → GERÇEKTEN sıfır bakiye; (b) satırı geldi ama bakiye okunamadı → BİLİNMİYOR.
  // Rota ikisini ayırt edemezse (b)'ye de 0 yazar; 48.000 TL borçlu cari tahsilat
  // ekranında 0 görünür (hakem bulgusu 2026-09-19).
  it('bakiyesi okunamayan cari kodu `okunamayanKodlar`a düşer — rota ona 0 YAZMAMALI', () => {
    const h = bakiyeHaritasi([
      { cha_kod: '120.01.001', bakiye: 15000 },
      { cha_kod: '120.01.007', bakiye: null },
    ]);
    expect([...h.okunamayanKodlar]).toEqual(['120.01.007']);
    expect(h.okunamayanKodlar.has('120.01.001')).toBe(false);
  });

  it('aynı cari hem bilinmeyen hem bilinen satırla geldiyse BİLİNEN kazanır (kod arızalı listesine girmez)', () => {
    const h = bakiyeHaritasi([{ cha_kod: 'C1', bakiye: null }, { cha_kod: 'C1', bakiye: -100 }]);
    expect(h.harita.get('C1')).toBe(-100);
    expect(h.okunamayanKodlar.has('C1')).toBe(false);
  });
});

describe('cariBakiyesi — hareketi olmayan cari GERÇEKTEN sıfırdır', () => {
  it('haritada yoksa 0 (sorgu başarılı + satır döndü hâli)', () => {
    const h = new Map([['C1', -100]]);
    expect(cariBakiyesi(h, 'C1')).toBe(-100);
    expect(cariBakiyesi(h, 'C9')).toBe(0);
  });
});

describe('adresSec — adres no bilinmeyen satır EN SONA', () => {
  const adr = (kod: string, no: unknown, il: string) =>
    ({ adr_cari_kod: kod, adr_adres_no: no, adr_cadde: `${il} Cad. No:1`, adr_ilce: 'Merkez', adr_il: il, adr_ulke: 'Türkiye' });

  it('parite: bilinen adres no’larından EN KÜÇÜĞÜ seçilir', () => {
    const s = adresSec([adr('C1', 2, 'Ankara'), adr('C1', 1, 'İstanbul'), adr('C1', 3, 'İzmir')]);
    expect(s.get('C1')!.adr_il).toBe('İstanbul');
  });

  it('adres no bilinmeyen satır, bilinen varken SEÇİLMEZ (eski `?? 0` onu daima kazandırıyordu)', () => {
    const s = adresSec([adr('C1', null, 'Havalimanı Şubesi'), adr('C1', 4, 'İstanbul')]);
    expect(s.get('C1')!.adr_il).toBe('İstanbul');
    const tersSira = adresSec([adr('C1', 4, 'İstanbul'), adr('C1', undefined, 'Havalimanı Şubesi')]);
    expect(tersSira.get('C1')!.adr_il).toBe('İstanbul');
  });

  it('gerçek 0 adres no bilinen değerdir — 1’i yener', () => {
    const s = adresSec([adr('C1', 1, 'Ankara'), adr('C1', 0, 'İstanbul')]);
    expect(s.get('C1')!.adr_il).toBe('İstanbul');
  });

  it('hepsi bilinmiyorsa ilk satır kalır (kararlı — SQL sırası ORDER BY ile sabit)', () => {
    const s = adresSec([adr('C1', null, 'İstanbul'), adr('C1', null, 'Ankara')]);
    expect(s.get('C1')!.adr_il).toBe('İstanbul');
  });

  it('kodsuz satır atlanır, cariler ayrışır', () => {
    const s = adresSec([adr('', 1, 'İstanbul'), adr('C1', 1, 'Bursa'), adr('C2', 1, 'Konya')]);
    expect(s.size).toBe(2);
    expect(s.get('C1')!.adr_il).toBe('Bursa');
    expect(s.get('C2')!.adr_il).toBe('Konya');
  });
});

describe('adresGuncellemesi — yalnız BOŞ alanları doldurur', () => {
  const ADRES = { adr_cari_kod: 'C1', adr_adres_no: 1, adr_cadde: 'Bağdat Cad. No:12', adr_ilce: 'Kadıköy', adr_il: 'İstanbul', adr_ulke: 'Türkiye' };

  it('parite: boş lead’e dört alan + kaynak izi', () => {
    expect(adresGuncellemesi({ name: 'Şirin İnşaat' }, ADRES)).toEqual({
      address: 'Bağdat Cad. No:12', district: 'Kadıköy', city: 'İstanbul', country: 'Türkiye',
      addressSource: 'mikro-heuristic',
    });
  });

  it('elle girilmiş şehir EZİLMEZ; yalnız eksik olan yazılır', () => {
    expect(adresGuncellemesi({ city: 'Ankara', address: 'Elle girilmiş adres' }, ADRES))
      .toEqual({ district: 'Kadıköy', country: 'Türkiye', addressSource: 'mikro-heuristic' });
  });

  it('yalnız BOŞLUKTAN oluşan mevcut değer dolu sayılmaz', () => {
    expect(adresGuncellemesi({ city: '   ' }, ADRES)!.city).toBe('İstanbul');
  });

  it('Mikro tarafı boş/boşluksa o alan yazılmaz (’ ’ şehir yazılmaz)', () => {
    const g = adresGuncellemesi({}, { ...ADRES, adr_il: '   ', adr_ulke: '' })!;
    expect(g).not.toHaveProperty('city');
    expect(g).not.toHaveProperty('country');
    expect(g.address).toBe('Bağdat Cad. No:12');
  });

  it('yazacak bir şey yoksa null (rota `skipped++` der, boşuna batch yazımı olmaz)', () => {
    expect(adresGuncellemesi({ address: 'A', city: 'B', district: 'C', country: 'D' }, ADRES)).toBeNull();
    expect(adresGuncellemesi({}, { adr_cari_kod: 'C1', adr_adres_no: 1 })).toBeNull();
  });

  it('Mikro değeri kırpılır — ’ İstanbul ’ bölge eşleşmesini bozmasın', () => {
    expect(adresGuncellemesi({}, { ...ADRES, adr_il: '  İstanbul  ' })!.city).toBe('İstanbul');
  });
});

describe('adresOzeti — hiçbir satırda okunamayan adres alanı', () => {
  it('adres kolonları tüm satırlarda boşsa KRİTİK olanlar (cadde + il) arıza sayılır', () => {
    const satirlar = Array.from({ length: ARIZA_ESIGI }, (_, i) => ({ adr_cari_kod: `C${i}`, adr_adres_no: i, adr_cadde: '', adr_ilce: '', adr_il: '', adr_ulke: '' }));
    const o = adresOzeti(satirlar);
    expect(o.okumaArizasi).toEqual(['address', 'city']);
    expect(o.not.startsWith('UYARI:')).toBe(true);
  });

  it('yalnız ilçe/ülke boşsa arıza İDDİA EDİLMEZ (yurt içi caride olağan)', () => {
    const satirlar = Array.from({ length: 6 }, (_, i) => ({ adr_cari_kod: `C${i}`, adr_adres_no: i, adr_cadde: 'Bağdat Cad.', adr_ilce: '', adr_il: 'İstanbul', adr_ulke: '' }));
    const o = adresOzeti(satirlar);
    expect(o.okumaArizasi).toEqual([]);
    expect(o.not.startsWith('UYARI:')).toBe(false);
  });

  it('dolu satırlar varsa arıza iddia edilmez', () => {
    const o = adresOzeti([
      { adr_cari_kod: 'C1', adr_adres_no: 1, adr_cadde: 'Bağdat Cad.', adr_ilce: 'Kadıköy', adr_il: 'İstanbul', adr_ulke: 'Türkiye' },
      { adr_cari_kod: 'C2', adr_adres_no: 1, adr_cadde: '', adr_ilce: '', adr_il: '', adr_ulke: '' },
    ]);
    expect(o.okumaArizasi).toEqual([]);
  });
});
