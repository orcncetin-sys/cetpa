import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  alanAdiNormallestir, sirGecerli, imzaGecerli, baglantiKaydi, baglantiYaniti, kayitIstegi, tuzUret, durumKimligi,
  surumUret, surumOku, durumBuSurumunMu, durumDamgasi,
} from './shopifyBaglanti';

const SIR = 'whsec_0123456789abcdef';

describe('alanAdiNormallestir', () => {
  it('kırpar, küçültür, şemayı ve yolu atar', () => {
    expect(alanAdiNormallestir('  HTTPS://Cetpa-Yapi.myshopify.com/admin?x=1 ')).toBe('cetpa-yapi.myshopify.com');
    expect(alanAdiNormallestir('cetpa.myshopify.com')).toBe('cetpa.myshopify.com');
  });
  it('myshopify.com dışı, alt alan adı oyunu ve bozuk girdi reddedilir', () => {
    for (const k of ['cetpa.com.tr', 'cetpa.myshopify.com.saldirgan.example', 'a.b.myshopify.com', '-x.myshopify.com', 'myshopify.com', '', null, 42, 'cetpa.myshopify.com:8443', 'kullanici@cetpa.myshopify.com']) {
      expect(alanAdiNormallestir(k), String(k)).toBeNull();
    }
  });
});

describe('sirGecerli', () => {
  it('16–256 karakter, boşluksuz yazdırılabilir ASCII; kırpılır', () => {
    expect(sirGecerli(`  ${SIR}\n`)).toBe(SIR);
    for (const k of ['kisa', 'a'.repeat(257), 'içinde türkçe karakter var', 'bosluk var 0123456789', '', null, 12345678901234567]) expect(sirGecerli(k)).toBeNull();
  });
});

describe('imzaGecerli', () => {
  const govde = Buffer.from('{"id":1}', 'utf8');
  const imza = createHmac('sha256', SIR).update(govde).digest('base64');
  it('doğru imza geçer; yanlış sır, değişmiş gövde, eksik parça geçmez', () => {
    expect(imzaGecerli(govde, imza, SIR)).toBe(true);
    expect(imzaGecerli(govde, imza, 'baska-bir-sir-0123456789')).toBe(false);
    expect(imzaGecerli(Buffer.from('{"id":2}'), imza, SIR)).toBe(false);
    expect(imzaGecerli(undefined, imza, SIR)).toBe(false);
    expect(imzaGecerli(govde, undefined, SIR)).toBe(false);
    expect(imzaGecerli(govde, '', SIR)).toBe(false);
    expect(imzaGecerli(govde, imza, '')).toBe(false);
    expect(imzaGecerli(govde, ['dizi'], SIR)).toBe(false);
  });
});

describe('baglantiKaydi / baglantiYaniti', () => {
  const tam = { companyId: 'kiraciA', shopDomain: 'cetpa.myshopify.com', webhookSecret: SIR, tuz: 'tuz-degeri' };
  it('eksik alanlı doküman bağlantı SAYILMAZ (yarım kayıtla imza doğrulanmaz)', () => {
    // Sürümsüz (bu alandan önce yazılmış) kayıt GEÇERLİDİR: sürüm null okunur — bağlantı kopmaz.
    expect(baglantiKaydi(tam)).toEqual({ ...tam, baglantiSurumu: null });
    expect(baglantiKaydi({ ...tam, baglantiSurumu: 'surum-1' })).toEqual({ ...tam, baglantiSurumu: 'surum-1' });
    for (const bozuk of ['', 42, null]) expect(baglantiKaydi({ ...tam, baglantiSurumu: bozuk })?.baglantiSurumu).toBeNull();
    for (const eksik of ['companyId', 'shopDomain', 'webhookSecret', 'tuz'] as const) expect(baglantiKaydi({ ...tam, [eksik]: '' })).toBeNull();
    expect(baglantiKaydi({ ...tam, shopDomain: 'cetpa.com.tr' })).toBeNull();
    expect(baglantiKaydi(undefined)).toBeNull();
  });
  it('«Bağlantıyı kaldır»ın bıraktığı yarım kayıt (yalnız kiracı + tuz) bağlantı SAYILMAZ; yanıt «kurulmamış» der, tuz sızmaz', () => {
    const yarim = { companyId: 'kiraciA', tuz: 'tuz-degeri', guncelleyenUid: 'u1', guncellendi: 'ZAMAN' };
    expect(baglantiKaydi(yarim)).toBeNull();
    const y = baglantiYaniti(baglantiKaydi(yarim), undefined, undefined);
    expect(y).toMatchObject({ configured: false, shopDomain: null, webhookSirriKayitli: false, durum: null });
    expect(JSON.stringify(y)).not.toContain('tuz-degeri');
  });
  it('yanıt SIR ve TUZ taşımaz — anahtar listesi sabit', () => {
    const y = baglantiYaniti(baglantiKaydi(tam), { sonBildirim: '2026-10-02T10:00:00.000Z', sonTopic: 'orders/create', toplamBildirim: 3, webhookSecret: SIR }, 'https://app.cetpa.com.tr/');
    expect(Object.keys(y).sort()).toEqual(['configured', 'durum', 'shopDomain', 'success', 'webhookAdresi', 'webhookSirriKayitli', 'webhookYolu']);
    expect(JSON.stringify(y)).not.toContain(SIR);
    expect(JSON.stringify(y)).not.toContain('tuz-degeri');
    expect(y).toMatchObject({
      configured: true, shopDomain: 'cetpa.myshopify.com', webhookSirriKayitli: true, webhookAdresi: 'https://app.cetpa.com.tr/api/shopify/webhook',
      durum: { sonBildirim: '2026-10-02T10:00:00.000Z', sonTopic: 'orders/create', sonSiparisNo: null, sonHata: null, toplamBildirim: 3 },
    });
  });
  it('durum alanları da SABİT liste: `sonImzaReddi` var (ISO metin ya da null); iç alanlar (`sonHataOlay`, `companyId`) yanıta çıkmaz', () => {
    const ham = {
      companyId: 'kiraciA', sonBildirim: '2026-10-02T10:00:00.000Z', sonImzaReddi: '2026-10-07T09:00:00.000Z',
      sonHata: 'pg yok', sonHataZamani: '2026-10-02T09:00:00.000Z', sonHataOlay: 'shopify__abc', toplamBildirim: 3, webhookSecret: SIR,
    };
    const y = baglantiYaniti(baglantiKaydi(tam), ham, undefined);
    expect(Object.keys(y.durum ?? {}).sort()).toEqual([
      'sonApiSurumu', 'sonBildirim', 'sonHata', 'sonHataZamani', 'sonImzaReddi', 'sonSiparisNo', 'sonSonuc', 'sonTopic', 'toplamBildirim',
    ]);
    expect(y.durum).toMatchObject({ sonImzaReddi: '2026-10-07T09:00:00.000Z', sonHata: 'pg yok' });
    expect(JSON.stringify(y)).not.toMatch(/sonHataOlay|shopify__abc/);
    // Yalnız ret yazılmış durum (hiç doğrulanmış bildirim yok): bildirim alanları null, ret zamanı dolu.
    expect(baglantiYaniti(baglantiKaydi(tam), { companyId: 'kiraciA', sonImzaReddi: '2026-10-07T09:00:00.000Z' }, undefined).durum)
      .toMatchObject({ sonBildirim: null, toplamBildirim: null, sonImzaReddi: '2026-10-07T09:00:00.000Z' });
    // Hiç ret yok / metin olmayan değer / temizlenmiş hata (`null`) → null.
    for (const d of [{ sonTopic: 'x' }, { sonImzaReddi: 1759827600000 }, { sonImzaReddi: '' }]) expect(baglantiYaniti(baglantiKaydi(tam), d, undefined).durum?.sonImzaReddi).toBeNull();
    expect(baglantiYaniti(baglantiKaydi(tam), { sonHata: null, sonHataZamani: null }, undefined).durum).toMatchObject({ sonHata: null, sonHataZamani: null });
  });
  describe('durum yalnız kayıttaki SÜRÜMÜN damgasını taşıyorsa yanıta girer', () => {
    const surumlu = { ...tam, baglantiSurumu: 'surum-yeni' };
    const dolu = { companyId: 'kiraciA', sonBildirim: '2026-10-02T10:00:00.000Z', toplamBildirim: 7, sonImzaReddi: '2026-10-01T09:00:00.000Z' };
    const durumu = (kayit: Record<string, unknown>, durum: Record<string, unknown> | undefined) => baglantiYaniti(baglantiKaydi(kayit), durum, undefined).durum;

    it('damga tutuyor → durum çözülür; sürüm DEĞERİ yanıta çıkmaz', () => {
      const y = baglantiYaniti(baglantiKaydi(surumlu), { ...dolu, baglantiSurumu: 'surum-yeni' }, undefined);
      expect(y.durum).toMatchObject({ sonBildirim: '2026-10-02T10:00:00.000Z', toplamBildirim: 7, sonImzaReddi: '2026-10-01T09:00:00.000Z' });
      expect(JSON.stringify(y)).not.toMatch(/baglantiSurumu|surum-yeni/);
    });
    it('eski sürümün durumu (silinememiş / kuyruktaki eski işin yazdığı) YOK sayılır: yeni bağlantı «doğrulanmış» görünmez', () => {
      expect(durumu(surumlu, { ...dolu, baglantiSurumu: 'surum-eski' })).toBeNull();
      // Damgasız durum da sürümlü kayıt için kalıntıdır; sürümsüz kayıt için sürümlü durum da.
      expect(durumu(surumlu, dolu)).toBeNull();
      expect(durumu(tam, { ...dolu, baglantiSurumu: 'surum-eski' })).toBeNull();
      expect(durumu(surumlu, undefined)).toBeNull();
    });
    it('sürümsüz kayıt + damgasız durum eşleşir (eski kayıt, eski davranış)', () => {
      expect(durumu(tam, dolu)).toMatchObject({ toplamBildirim: 7 });
    });
  });
  it('bağlantı yoksa: kurulmamış, durum null; uygulama adresi bilinmiyorsa tam adres null (istemci kurar)', () => {
    expect(baglantiYaniti(null, { sonTopic: 'x' }, undefined)).toEqual({
      success: true, configured: false, shopDomain: null, webhookSirriKayitli: false, webhookAdresi: null, webhookYolu: '/api/shopify/webhook', durum: null,
    });
  });
});

describe('kayitIstegi', () => {
  it('ilk kurulumda sır zorunlu; sonrasında boş sır = mevcut korunur', () => {
    expect(kayitIstegi({ shopDomain: 'cetpa.myshopify.com' }, false)).toMatchObject({ tamam: false });
    expect(kayitIstegi({ shopDomain: 'cetpa.myshopify.com', webhookSecret: '  ' }, true)).toEqual({ tamam: true, shopDomain: 'cetpa.myshopify.com', yeniSir: null });
    expect(kayitIstegi({ shopDomain: 'https://cetpa.myshopify.com/', webhookSecret: SIR }, false)).toEqual({ tamam: true, shopDomain: 'cetpa.myshopify.com', yeniSir: SIR });
  });
  it('geçersiz alan adı / sır reddedilir; hata metni sırrı yankılamaz', () => {
    expect(kayitIstegi({ shopDomain: 'cetpa.com.tr', webhookSecret: SIR }, false)).toMatchObject({ tamam: false });
    const r = kayitIstegi({ shopDomain: 'cetpa.myshopify.com', webhookSecret: 'kisa gizli' }, true);
    expect(r.tamam).toBe(false);
    expect(JSON.stringify(r)).not.toContain('kisa gizli');
    expect(kayitIstegi(null, true)).toMatchObject({ tamam: false });
  });
});

describe('yardımcılar', () => {
  it('tuz 64 hanelik onaltılık ve her çağrıda farklı; durum kimliği kiracıya bağlı', () => {
    expect(tuzUret()).toMatch(/^[0-9a-f]{64}$/);
    expect(tuzUret()).not.toBe(tuzUret());
    expect(durumKimligi('kiraciA')).toBe('kiraciA__durum');
  });
  it('bağlantı sürümü rastgele (32 hanelik onaltılık, her çağrıda farklı); ham değer okuması boş / metin olmayanı sürümsüz sayar', () => {
    expect(surumUret()).toMatch(/^[0-9a-f]{32}$/);
    expect(surumUret()).not.toBe(surumUret());
    expect(surumOku('surum-1')).toBe('surum-1');
    for (const v of ['', undefined, null, 7, {}]) expect(surumOku(v)).toBeNull();
  });
  it('durumBuSurumunMu: damga birebir tutmalı; doküman yoksa false. durumDamgasi: kiracı + sürüm (sürümsüzde alan YAZILMAZ)', () => {
    expect(durumBuSurumunMu({ baglantiSurumu: 'a' }, 'a')).toBe(true);
    expect(durumBuSurumunMu({ baglantiSurumu: 'a' }, 'b')).toBe(false);
    expect(durumBuSurumunMu({ baglantiSurumu: 'a' }, null)).toBe(false);
    expect(durumBuSurumunMu({ toplamBildirim: 1 }, 'a')).toBe(false);
    expect(durumBuSurumunMu({ toplamBildirim: 1 }, null)).toBe(true);
    expect(durumBuSurumunMu(undefined, null)).toBe(false);
    expect(durumBuSurumunMu(undefined, 'a')).toBe(false);
    expect(durumDamgasi('kiraciA', 'a')).toEqual({ companyId: 'kiraciA', baglantiSurumu: 'a' });
    expect(durumDamgasi('kiraciA', null)).toEqual({ companyId: 'kiraciA' });
  });
});
