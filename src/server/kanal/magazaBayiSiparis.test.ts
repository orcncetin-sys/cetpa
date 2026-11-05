// @vitest-environment node
/**
 * magazaBayiSiparis.test.ts — müşteri / bayi ekranı «Siparişlerim» yanıtının TEK süzgeci, durum sözlüğü, tarih, opak kimlik,
 * sıra ve `ben.ozet` (2026-10-21, şartname `.wf/SARTNAME-musteri-siparislerim.md` H12, H13, H14). SAF — veritabanı yok; SQL'in
 * gerçek motordaki davranışı magazaBayiSiparis.pglite.test.ts'te, uçtan uca zincir magazaBayi.zincir.test.ts'te.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../../test/kaynakTarama';
import { siparisTarihMs } from '../../utils/siparis';
import {
  BAYI_BEN_OZETI, BAYI_DURUM_SOZLUGU, BAYI_MF_SAYISI_SQL, BAYI_SIPARIS_ADAY_SQL, BAYI_SIPARIS_GOVDE_SQL, BAYI_SIPARIS_SINIRI, BAYI_SIPARIS_YUKLEMI,
  bayiDurumu, bayiSiparisi, bayiSiparisKalemi, bayiSiparisKimligi, bayiSiparisListesi, bayiSiparisParametreleri, bayiSiparisSirasi,
} from './magazaBayiSiparis';

const ANAHTAR = createHmac('sha256', 'test').update('kimlik').digest();
const PANEL_ANAHTARI = createHmac('sha256', 'test').update('panel').digest();

/** Keşif listesindeki gizli alanların HEPSİNİ taşıyan Cetpa siparişi (K6 / H13). */
const DOLU_CETPA: Record<string, unknown> = {
  orderNumber: 'SAS-2026-0042', status: 'Processing', leadId: 'L1', companyId: 'CETPA', createdAt: { _seconds: 1760000000, _nanoseconds: 0 },
  notes: 'iç not', sistemNotu: 'sistem', assignedTo: 'satis-1', assignedDriver: 'surucu-1', deliveryPhoto: 'x.jpg', failedReason: 'r',
  mikroFaturaGonderimi: { durum: 'gonderildi' }, lucaFaturaNo: 'L-1', lucaGonderim: { ok: true }, customerEmail: 'musteri@ornek.com',
  customerPhone: '05321234567', totalPrice: 1200, totalAmount: 1440, kdvOran: 20, kdvTutari: 240, kdvHaricTutar: 1200,
  trackingNumber: 'KRG-1', mikroFaturaNo: 'CTP42', takipKodu: 'Qw12Er34Ty56Ui78Op90As', shippingAddress: 'adres', location: { lat: 1, lng: 2 },
  lineItems: [{ id: 'k1', sku: 'DYO-001', name: 'DYO Boya 15 L', quantity: 3, price: 400, total: 1440, netTutar: 1200, kdv: 240, iskonto: 0, brutTutar: 1200 }],
};

describe('bayiSiparisi — TEK süzgeç, izin listesi', () => {
  it('yanıtta YALNIZ beş anahtar; gizli alanların, fiyat anahtarlarının, `status`, `takip`, `kargoNo`, `faturaNo`, `iskonto`\'nun HİÇBİRİ yok', () => {
    const y = bayiSiparisi('opak-1', DOLU_CETPA);
    expect(Object.keys(y).sort()).toEqual(['durum', 'id', 'kalemler', 'no', 'tarih']);
    const metin = JSON.stringify(y);
    for (const yasak of [
      'notes', 'iç not', 'sistemNotu', 'assignedTo', 'satis-1', 'surucu', 'mikroFaturaGonderimi', 'luca', 'musteri@ornek.com', '0532',
      'price', 'birimFiyat', 'araToplam', 'kdv', 'toplam', 'total', 'netTutar', 'iskonto', '1200', '1440', 'status', 'takip', 'track', 'kargoNo',
      'faturaNo', 'KRG-1', 'CTP42', 'Qw12Er34', 'adres', 'companyId', 'CETPA', 'leadId', 'L1',
    ]) expect(metin, yasak).not.toContain(yasak);
    expect(y).toEqual({ id: 'opak-1', no: 'SAS-2026-0042', tarih: new Date(1760000000 * 1000).toISOString(), durum: 'hazirlaniyor', kalemler: [{ sku: 'DYO-001', ad: 'DYO Boya 15 L', adet: 3 }] });
  });
  it('MF siparişi: `no` = `MF-…`; iç kimlik / `mikrofat` / `#` yok; `quantity: null` → `adet: null`; durum her zaman `teslim`', () => {
    const mf = {
      orderNumber: 'MF-CTP42', status: 'Delivered', mikroCariKod: '120.01.0042', source: 'mikro-fatura', mikroFaturaNo: 'CTP42',
      createdAt: '2026-09-01T12:00:00.000Z', lineItems: [{ sku: 'NP1-200', name: 'Silikon', quantity: null, price: null }],
    };
    const y = bayiSiparisi('opak-2', mf);
    expect(y).toEqual({ id: 'opak-2', no: 'MF-CTP42', tarih: '2026-09-01T12:00:00.000Z', durum: 'teslim', kalemler: [{ sku: 'NP1-200', ad: 'Silikon', adet: null }] });
    expect(JSON.stringify(y)).not.toMatch(/mikrofat|#|__|120\.01/);
  });
  it('`orderNumber` ve `shopifyOrderId` yoksa `no: \'—\'`; doküman kimliğinden numara TÜRETİLMEZ', () => {
    const y = bayiSiparisi('opak-3', { status: 'Pending', lineItems: [] });
    expect(y.no).toBe('—');
    expect(JSON.stringify(y)).not.toMatch(/#/);
    expect(bayiSiparisi('o', { shopifyOrderId: 1001 }).no).toBe('1001');
  });
  it('üç tarih alanı çözülmezse `tarih: null` (01.01.1970 değil); `GG.AA.YYYY` ve `_seconds` zarfı çözülür', () => {
    expect(bayiSiparisi('o', { createdAt: 'bozuk', orderDate: '' }).tarih).toBeNull();
    expect(bayiSiparisi('o', {}).tarih).toBeNull();
    expect(bayiSiparisi('o', { orderDate: '15.09.2026' }).tarih).toBe(new Date(2026, 8, 15).toISOString());
    expect(bayiSiparisi('o', { syncedAt: { _seconds: 10, _nanoseconds: 5_000_000 } }).tarih).toBe(new Date(10_005).toISOString());
  });
  it('kalemler: anahtarlar TAM `{ sku, ad, adet }`; `sku` yoksa \'\'; `ad` = name → title → sku → \'—\'; `adet` sayı değilse null (1 DEĞİL)', () => {
    expect(bayiSiparisKalemi({ sku: 'A', name: 'Ad', quantity: 2, price: 9 })).toEqual({ sku: 'A', ad: 'Ad', adet: 2 });
    expect(bayiSiparisKalemi({ title: 'Başlık', quantity: '3' })).toEqual({ sku: '', ad: 'Başlık', adet: null });
    expect(bayiSiparisKalemi({ sku: 'X-1', name: '  ' })).toEqual({ sku: 'X-1', ad: 'X-1', adet: null });
    expect(bayiSiparisKalemi({})).toEqual({ sku: '', ad: '—', adet: null });
    expect(bayiSiparisKalemi(null)).toEqual({ sku: '', ad: '—', adet: null });
    expect(bayiSiparisKalemi({ sku: 7, quantity: Number.NaN })).toEqual({ sku: '', ad: '—', adet: null });
    for (const k of [{ sku: 'A', name: 'B', quantity: 1, price: 5, total: 6, kdv: 1 }]) expect(Object.keys(bayiSiparisKalemi(k)).sort()).toEqual(['ad', 'adet', 'sku']);
    expect(bayiSiparisi('o', { lineItems: 'bozuk' }).kalemler).toEqual([]);
  });
});

describe('bayiDurumu — sözlük, ham değer çıkmaz', () => {
  it('beş eşleme; `teyit` üretilmez', () => {
    expect(BAYI_DURUM_SOZLUGU).toEqual({ Pending: 'alindi', Processing: 'hazirlaniyor', Shipped: 'sevk', Delivered: 'teslim', Cancelled: 'iptal' });
    expect(Object.isFrozen(BAYI_DURUM_SOZLUGU)).toBe(true);
    for (const [ham, beklenen] of Object.entries(BAYI_DURUM_SOZLUGU)) expect(bayiDurumu(ham)).toBe(beklenen);
    expect(Object.values(BAYI_DURUM_SOZLUGU)).not.toContain('teyit');
  });
  it('sözlük dışı (\'pending\', undefined, 42, \'constructor\', \'toString\', \'__proto__\', \'In Transit\') → null', () => {
    for (const ham of ['pending', undefined, null, 42, 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'In Transit', '', {}]) {
      expect(bayiDurumu(ham), String(ham)).toBeNull();
    }
  });
});

describe('bayiSiparisKimligi — opak kimlik', () => {
  const g = { cid: 'CETPA', uid: 'b1', bas: 1_760_000_000_000, docId: 'mikrofat__CETPA__CTP-42' };
  it('aynı oturumda aynı; farklı `bas` / uid / kiracı / sipariş → farklı; 22 karakter base64url', () => {
    const k = bayiSiparisKimligi(ANAHTAR, g);
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(bayiSiparisKimligi(ANAHTAR, g)).toBe(k);
    for (const degisen of [{ bas: g.bas + 1 }, { uid: 'b2' }, { cid: 'BASKA' }, { docId: 'mikrofat__CETPA__CTP-43' }]) {
      expect(bayiSiparisKimligi(ANAHTAR, { ...g, ...degisen }), JSON.stringify(degisen)).not.toBe(k);
    }
  });
  it('kiracıdan / doküman kimliğinden geri TÜRETİLEMEZ: kimlik bunların hiçbir parçasını taşımaz; anahtarsız HMAC ile eşleşmez; panel anahtarıyla üretilen eşleşmez', () => {
    const k = bayiSiparisKimligi(ANAHTAR, g);
    for (const parca of ['CETPA', 'mikrofat', 'CTP', '42', 'b1']) expect(k, parca).not.toContain(parca);
    expect(k).not.toBe(Buffer.from(g.docId).toString('base64url').slice(0, 22));
    expect(bayiSiparisKimligi(PANEL_ANAHTARI, g)).not.toBe(k);
    expect(createHmac('sha256', '').update(`sip\n${g.cid}\n${g.uid}\n${g.bas}\n${g.docId}`).digest().subarray(0, 16).toString('base64url')).not.toBe(k);
  });
});

describe('bayiSiparisSirasi ve bayiSiparisListesi', () => {
  it('karışık tarih biçimleri: sıra `siparisTarihMs` ile AYNI (yeni önce); eşitlikte kimlik azalan; tarihsiz ve bozuk en sonda', () => {
    const adaylar = [
      { id: 'a', s: null, c: '2026-09-01T12:00:00.000Z', d: null },
      { id: 'b', s: null, c: { _seconds: Date.parse('2026-10-01T00:00:00.000Z') / 1000, _nanoseconds: 0 }, d: null },
      { id: 'c', s: null, c: null, d: '15.09.2026' },
      { id: 'd', s: null, c: 'bozuk-tarih', d: null },
      { id: 'e', s: null, c: null, d: null },
      { id: 'f', s: null, c: '2026-09-01T12:00:00.000Z', d: null },
      { id: 'g', s: '2026-10-20T08:00:00.000Z', c: '2020-01-01T00:00:00.000Z', d: null },
    ];
    const sira = bayiSiparisSirasi(adaylar);
    const beklenen = [...adaylar].map(r => ({ id: r.id, ms: siparisTarihMs({ syncedAt: r.s, createdAt: r.c, orderDate: r.d }) }))
      .sort((x, y) => (x.ms === y.ms ? (x.id < y.id ? 1 : -1) : x.ms === -Infinity ? 1 : y.ms === -Infinity ? -1 : y.ms - x.ms))
      .map(r => r.id);
    expect(sira).toEqual(beklenen);
    expect(sira.slice(0, 2)).toEqual(['g', 'b']);
    expect(sira.indexOf('f')).toBe(sira.indexOf('a') - 1);       // eşit tarih: kimlik azalan
    expect(sira.slice(-2).sort()).toEqual(['d', 'e']);            // bozuk ve tarihsiz en sonda (500 yok)
  });
  it('en çok 200: 201 adayda 200 kayıt, ilk en yeni, en eski yok; yinelenen / kimliksiz satır atlanır', () => {
    const adaylar = Array.from({ length: 201 }, (_, i) => ({ id: `s-${String(i).padStart(3, '0')}`, s: null, c: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(), d: null }));
    const sira = bayiSiparisSirasi([...adaylar, adaylar[5], { id: 7, c: 'x' }]);
    expect(BAYI_SIPARIS_SINIRI).toBe(200);
    expect(sira).toHaveLength(200);
    expect(sira[0]).toBe('s-200');
    expect(sira).not.toContain('s-000');
    expect(new Set(sira).size).toBe(200);
  });
  it('liste Aşama 1 sırasında; Aşama 2\'de dönmeyen (silinen / yüklemden çıkan) kimlik DÜŞER; `id` opak', () => {
    const liste = bayiSiparisListesi(['x', 'y', 'z'], [
      { id: 'z', data: { orderNumber: 'Z', status: 'Pending' } },
      { id: 'x', data: { orderNumber: 'X', status: 'Cancelled' } },
      { id: 'q', data: { orderNumber: 'Q' } },
    ], docId => `opak-${docId.length}`);
    expect(liste.map(s => s.no)).toEqual(['X', 'Z']);
    expect(liste.map(s => s.durum)).toEqual(['iptal', 'alindi']);
    expect(liste.map(s => s.id)).toEqual(['opak-1', 'opak-1']);
  });
});

describe('ben.ozet ve parametreler', () => {
  it('`ozet` = üç `null`, başka anahtar yok, hiçbir düzeyde `iskonto` yok; dondurulmuş', () => {
    expect(BAYI_BEN_OZETI).toEqual({ bakiye: null, vadesiGecen: null, acikSiparis: null });
    expect(Object.keys(BAYI_BEN_OZETI)).toHaveLength(3);
    expect(JSON.stringify(BAYI_BEN_OZETI)).not.toMatch(/iskonto|ozel|vade"/);
    expect(Object.isFrozen(BAYI_BEN_OZETI)).toBe(true);
  });
  it('`$3`: yalnız dolu metin AYNEN (büyütülmez, kırpılmaz); \'\' / \'  \' / null → null (ikinci kat)', () => {
    expect(bayiSiparisParametreleri('C', { leadId: 'L', cariKod: 'abı' }, 'shopify_webhook')).toEqual(['C', 'L', 'abı', 'shopify_webhook']);
    expect(bayiSiparisParametreleri('C', { leadId: 'L', cariKod: ' K ' }, 'm')[2]).toBe(' K ');
    for (const cariKod of ['', '  ', null]) expect(bayiSiparisParametreleri('C', { leadId: 'L', cariKod }, 'm')[2], JSON.stringify(cariKod)).toBeNull();
  });
});

describe('kaynak çitleri — magazaBayiSiparis.ts', () => {
  const kod = kodSatirlari(join(SRC_KOK, 'server', 'kanal', 'magazaBayiSiparis.ts')).map(s => s.kod).join('\n');
  it('SQL: iki aşama AYNI yüklemi taşır; `upper(` / `lower(` / `btrim(` / `::timestamptz` / ORDER BY / LIMIT YOK; yalnız okuma', () => {
    expect(BAYI_SIPARIS_ADAY_SQL.endsWith(BAYI_SIPARIS_YUKLEMI)).toBe(true);
    expect(BAYI_SIPARIS_GOVDE_SQL.endsWith(`id = ANY($5::text[]) AND ${BAYI_SIPARIS_YUKLEMI}`)).toBe(true);
    for (const sql of [BAYI_SIPARIS_ADAY_SQL, BAYI_SIPARIS_GOVDE_SQL, BAYI_MF_SAYISI_SQL]) {
      expect(sql).not.toMatch(/upper\(|lower\(|btrim\(|::timestamptz|ORDER BY|LIMIT|UPDATE|INSERT|DELETE|;/i);
      expect(sql).toContain("coll = 'orders'");
      expect(sql).toContain("NOT IN ($");
    }
    expect(BAYI_SIPARIS_YUKLEMI).toContain("(data ? 'leadId' AND data->>'leadId' = $2)");
    expect(BAYI_SIPARIS_YUKLEMI).toContain("($3::text IS NOT NULL AND data ? 'mikroCariKod' AND data->>'mikroCariKod' = $3)");
    expect(BAYI_SIPARIS_YUKLEMI).toContain("'Trendyol', 'Hepsiburada'");
  });
  it('süzgeç dosyası `gorunenSiparisNo` içe AKTARMAZ; pgShim / Express içe aktarmaz; sayısal varsayılan ve tip kaçağı yok', () => {
    expect(kod).not.toMatch(/gorunenSiparisNo/);
    expect(kod).not.toMatch(/pgShim|from 'express'|server\.js/);
    expect(kod).not.toMatch(/(\?\?|\|\|)\s*[01]\b/);
    expect(kod).not.toMatch(/\bas any\b|@ts-ignore|@ts-expect-error|toUpperCase|toLowerCase/);
    // Yanıta `takip` / `track` alanı yazılmaz (H14: takip ucu bu dilimde YOK).
    expect(kod).not.toMatch(/\btakip:|\btrack\w*:/);
  });
});
