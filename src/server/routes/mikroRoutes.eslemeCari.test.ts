/**
 * mikroRoutes.eslemeCari.test.ts — cari eşlemesinin ROTA tarafı (Faz 3 3/n, grup
 * "eslemeCari", 2026-09-19). Saf eşleme kuralları `src/server/mikro/eslemeCari.test.ts`te
 * (35 test) kilitli; BURASI o modülün rotalara GERÇEKTEN bağlandığını kanıtlar —
 * "modül yazıldı ama bağlanmadı" bu projede tekrarlayan bir arıza sınıfıdır
 * (useDataSync dinleyicileri, genel sayfaların hiç <Route>'u olmaması).
 *
 * Kilitlenen dört davranış:
 *  1. Bilinmeyen alan yazılan dokümanda YOK (update mevcut değeri ezmez).
 *  2. `status`/`source` YALNIZ yeni kayıtta — import kullanıcının işaretlediği
 *     lead durumunu 'Active'e geri almaz.
 *  3. Bir alan TÜM satırlarda okunamıyorsa yanıt `note`'u "UYARI:" ile başlar
 *     ve console.warn basılır (sessiz-sıfır sınıfının import karşılığı).
 *  4. pull/bakiye'de aynı durum UYARI DEĞİL, 502'dir: haritada olmayan her cariye
 *     0 yazılacağı için devam etmek TÜM bakiyeleri sıfırlardı.
 *  5. pull/bakiye'de TEK BİR satırın bakiyesi okunamazsa o cariye HİÇ yazılmaz
 *     (bakiye 0 ile ezilmez), ama hiç hareketi olmayan cariye 0 yazılmaya devam eder —
 *     "haritada yok"un iki zıt anlamı ayrılır (2026-09-19 hakem bulgusu).
 *
 * vi.mock blokları burada KALMAK ZORUNDA (vitest hoisting) — tarif tek kaynakta:
 * `mikroRoutes.testDuzenegi.ts`'in `mikroMockTarifi` export'u.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { duzenekKur, type Duzenek } from './mikroRoutes.testDuzenegi';
import { mikroPost } from '../mikroClient.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../pgShim.js', () => ({ pgServerTimestamp: () => 'TS' }));
vi.mock('../mikroMirror.js', () => ({
  CHA_COLS: {}, STH_COLS: {}, FIS_COLS: {}, SIP_COLS: {},
  mirrorMikroCariler: vi.fn(async () => {}), mirrorMikroInsert: vi.fn(async () => {}), mirrorMikroStoklar: vi.fn(async () => {}),
}));
vi.mock('../mikroClient.js', async (orig) => {
  const gercek = await orig<typeof import('../mikroClient.js')>();
  return {
    ...gercek,
    getMikroCreds: vi.fn(async () => ({ firmaKodu: 'F' })),
    mikroPost: vi.fn(),
    mikroVergiOranlari: vi.fn(async () => ({})),
    vergiOraniCoz: vi.fn(() => null),
  };
});

let d: Duzenek;
beforeEach(() => { d = duzenekKur(); });
afterEach(() => { vi.restoreAllMocks(); });

/** CariListesiV2 yanıtı (tek sayfa: uzunluk sayfa boyutundan küçük → döngü biter). */
function cariYaniti(cari: Record<string, unknown>[]) {
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => {
    if (metot === 'CariListesiV2') return { ok: true, data: { result: [{ Data: { CariListesi: cari } }] } };
    return { ok: false, data: null };
  }) as unknown as typeof mikroPost);
}

/** SqlVeriOkuV2 yanıtı — bakiye sorgusu. Zarf: Data.SQLResult1 (canlıda doğrulandı). */
function sqlYaniti(rows: Record<string, unknown>[]) {
  vi.mocked(mikroPost).mockImplementation((async (metot: string) => {
    if (metot === 'SqlVeriOkuV2') return { ok: true, data: { result: [{ Data: { SQLResult1: rows } }] } };
    return { ok: false, data: null };
  }) as unknown as typeof mikroPost);
}

/** Senkron uçlar (cari/listesi, pull/bakiye) `note`u hâlâ yanıtta döner. */
const govdesi = (res: { govde: unknown }) => res.govde as Record<string, unknown>;
/** 2026-09-24 (mikro-import-arkaplan): cari import ARKA PLAN işi — sayılar/note `jobs/mikroImport-cari`'de; iş beklenir. */
const cariImportu = async () => { await d.cagir('POST', '/api/mikro/import/cari'); return (await d.isBitisi('mikroImport-cari')) ?? {}; };

describe('POST /api/mikro/import/cari — bilinmeyen alan YAZILMAZ', () => {
  it("Mikro boş/boşluk dönen alanlar güncellenen lead'de HİÇ YOK (CRM'deki e-posta/telefon ezilmez); sayaç note'a düşer", async () => {
    d.snapAyarla('leads', {
      eskL: {
        name: 'Şirin İnşaat', mikroCariKod: 'C1', companyId: 'A',
        email: 'ofis@sirin.com.tr', phone: '0212 555 00 00', status: 'Qualified',
      },
    });
    // e-posta boş, telefon yalnız boşluk, vergi dairesi/no yok, bayrak ve tip kolonu yok.
    cariYaniti([{ cari_kod: 'C1', cari_unvan1: 'ŞİRİN İNŞAAT', cari_EMail: '', cari_CepTel: '   ' }]);

    const is = await cariImportu();
    const yazim = d.koleksiyon('leads').find(y => y.ref.id === 'eskL');
    expect(yazim?.op).toBe('update');
    const veri = yazim?.data ?? {};
    for (const alan of ['email', 'phone', 'taxId', 'taxOffice', 'eFaturaKayitli', 'type']) {
      expect(alan in veri, `${alan} bilinmiyor → yazılmamalı`).toBe(false);
    }
    // Bilinen alanlar AYNEN yazılır (parite).
    expect(veri).toMatchObject({ name: 'ŞİRİN İNŞAAT', company: 'ŞİRİN İNŞAAT', mikroCariKod: 'C1', mikroSynced: true, mikroSyncedAt: 'TS', companyId: 'A' });
    expect(is).toMatchObject({ running: false, created: 0, updated: 1 });
    expect(String(is.note)).toContain('1 satırın email alanı bilinmiyor');
  });

  // 2026-09-19 delta bulgusu: güncellemede yazmamak DOĞRU, ama YENİ kayıtta alanı hiç
  // yazmamak `Lead` tipinin `email: string` sözleşmesini bozuyordu — CRM arama süzgeci
  // `l.email.toLowerCase()` çağırdığı için ada uymayan her aramada sayfa çöküyordu.
  it("YENİ lead'de bilinmeyen metin alanı '' ile açılır (tip sözleşmesi korunur)", async () => {
    cariYaniti([{ cari_kod: 'C9', cari_unvan1: 'ŞİRİN İNŞAAT', cari_EMail: '', cari_hareket_tipi: 0 }]);

    const is = await cariImportu();
    const yeni = d.koleksiyon('leads').find(y => y.op === 'set')?.data ?? {};
    expect(yeni).toMatchObject({
      company: 'ŞİRİN İNŞAAT', email: '', phone: '', taxId: '', taxOffice: '',
      status: 'Active', source: 'mikro_import',
    });
    // Bilinmeyen sayaç yine görünür: '' bir "veri var" iddiası değildir.
    expect(String(is.note)).toContain('1 satırın email alanı bilinmiyor');
  });

  it("`status` güncellemede YAZILMAZ (kullanıcının işaretlediği durum korunur), yeni kayıtta 'Active' + source 'mikro_import'", async () => {
    d.snapAyarla('leads', { eskL: { mikroCariKod: 'C1', companyId: 'A', status: 'Qualified' } });
    cariYaniti([
      { cari_kod: 'C1', cari_unvan1: 'ŞİRİN İNŞAAT', cari_hareket_tipi: 0 },
      { cari_kod: 'C9', cari_unvan1: 'YENİ BETON', cari_hareket_tipi: 1 },
    ]);

    await cariImportu();
    const guncel = d.koleksiyon('leads').find(y => y.op === 'update')?.data ?? {};
    const yeni = d.koleksiyon('leads').find(y => y.op === 'set')?.data ?? {};
    expect('status' in guncel, 'güncellemede status yazılmamalı').toBe(false);
    expect('source' in guncel, 'güncellemede source yazılmamalı').toBe(false);
    expect(guncel.type).toBe('Customer');
    expect(yeni).toMatchObject({ status: 'Active', source: 'mikro_import', type: 'Supplier', createdAt: 'TS' });
  });
});

describe('POST /api/mikro/cari/listesi — okuma arızası uyarısı', () => {
  it("bir KRİTİK alan TÜM satırlarda (≥5) okunamıyorsa note 'UYARI:' ile BAŞLAR ve console.warn basılır", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Unvan kolonu HİÇ yok (adı değişmiş gibi); diğer alanlar dolu → yalnız company arıza.
    // Mikro'da unvansız cari kartı açılamaz, bu yüzden company KRİTİKTİR.
    cariYaniti([1, 2, 3, 4, 5].map(n => ({
      cari_kod: `C${n}`, cari_EMail: `c${n}@sirin.com.tr`, cari_CepTel: `0555111223${n}`,
      cari_vdaire_no: `123456789${n}`, cari_vdaire_adi: 'Beşiktaş', cari_efatura_fl: 1, cari_hareket_tipi: 0,
    })));

    const res = await d.cagir('POST', '/api/mikro/cari/listesi');
    const not = String(govdesi(res).note);
    expect(not.startsWith('UYARI: company alanı hiçbir satırda okunamadı')).toBe(true);
    expect(warn).toHaveBeenCalledWith('[cari/listesi] okuma arızası:', not);
    // Uyarı senkron kaydına da gider — panel görmese bile iz kalır.
    expect(d.syncLog).toHaveBeenCalledWith('CariListesiV2', 'lead', expect.stringContaining('UYARI: company'), true, null, null, expect.any(Number), expect.anything());
    // Bilinen alanlar yine yazılır: uyarı veri kaybına dönüşmez.
    expect(d.koleksiyon('leads')).toHaveLength(5);
    expect(d.koleksiyon('leads')[0].data).toMatchObject({ eFaturaKayitli: true, type: 'Customer' });
    // YENİ kayıt: bilinmeyen metin alanı '' ile açılır (Lead tipi `company: string`
    // diyor; alan hiç yazılmazsa CRM araması çöküyordu). `name` kimliğe düşer.
    expect(d.koleksiyon('leads')[0].data).toMatchObject({ company: '', name: 'C1' });
  });

  // 2026-09-19 delta bulgusu: tarama TÜM alanları aday sayıyordu. İnşaat toptancısının
  // carilerinin çoğunda e-posta/telefon/VKN boştur — her senkron "kolon adı/şema kontrol
  // edin" diyordu ve gerçek kolon kayması bu gürültünün içinde görünmez kalıyordu.
  it('e-posta/telefon hiçbir caride yoksa yanlış ŞEMA ALARMI üretilmez (yalnız sayaç)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cariYaniti([1, 2, 3, 4, 5, 6].map(n => ({
      cari_kod: `C${n}`, cari_unvan1: `ŞİRİN İNŞAAT ${n}`, cari_efatura_fl: 0, cari_hareket_tipi: 0,
    })));

    const res = await d.cagir('POST', '/api/mikro/cari/listesi');
    const not = String(govdesi(res).note);
    expect(not.startsWith('UYARI:'), not).toBe(false);
    expect(warn).not.toHaveBeenCalledWith('[cari/listesi] okuma arızası:', expect.anything());
    expect(not).toContain('6 satırın email alanı bilinmiyor');
  });
});

describe('POST /api/mikro/pull/bakiye — toplu sıfırlama kapısı', () => {
  it('bakiye HİÇBİR satırda okunamazsa 502 döner ve TEK BİR yazım bile yapılmaz (aksi hâlde tüm bakiyeler sıfırlanırdı)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Kolon adı değişmiş gibi: `bakiye` alanı boş geliyor. `''` özellikle seçildi —
    // eski `Number.isFinite(Number(''))` bunu GEÇERLİ SIFIR sayıyordu.
    sqlYaniti([1, 2, 3, 4, 5].map(n => ({ cha_kod: `C${n}`, bakiye: '' })));

    const res = await d.cagir('POST', '/api/mikro/pull/bakiye');
    expect(res.kod).toBe(502);
    expect(String(govdesi(res).error)).toMatch(/UYARI: bakiye alanı hiçbir satırda okunamadı.*Hiçbir bakiye değiştirilmedi/);
    expect(d.yazilan, 'hiçbir bakiye/lead dokümanı yazılmamalı').toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('bakiyesi OKUNAMAYAN carinin bakiyesi 0 YAZILMAZ — o cariye hiç dokunulmaz, diğerleri yazılır', async () => {
    // 6 cari: beşinin bakiyesi okunuyor, birininki (007) okunamıyor. "Haritada yok"
    // burada "hareketi yok = gerçekten sıfır" DEĞİL, "satırı geldi ama okunamadı"dır;
    // 0 yazmak 48.000 TL borçlu cariyi tahsilat ekranında sıfır gösterirdi.
    const kodlar = ['120.01.001', '120.01.002', '120.01.003', '120.01.004', '120.01.005', '120.01.007'];
    d.snapAyarla('leads', Object.fromEntries(
      kodlar.map((kod, i) => [`lead${i}`, { name: `Şirin İnşaat ${i}`, mikroCariKod: kod, companyId: 'A' }]),
    ));
    sqlYaniti([
      ...kodlar.slice(0, 5).map((cha_kod, i) => ({ cha_kod, bakiye: 15000 + i })),
      { cha_kod: '120.01.007', bakiye: null },
    ]);

    const res = await d.cagir('POST', '/api/mikro/pull/bakiye');
    expect(res.kod).toBe(200);

    const yazilanKodlar = d.koleksiyon('cariBalances').map(y => y.ref.id);
    expect(yazilanKodlar).toEqual(kodlar.slice(0, 5));
    expect(yazilanKodlar, 'bakiyesi okunamayan cariye YAZIM YOK').not.toContain('120.01.007');
    expect(d.koleksiyon('leads').map(y => y.ref.id), 'lead.bakiye de 0 ile ezilmemeli').toEqual(
      ['lead0', 'lead1', 'lead2', 'lead3', 'lead4'],
    );
    // Bilinenler AYNEN yazılır (işaret korunur, parite).
    expect(d.koleksiyon('cariBalances')[0].data).toMatchObject({ cariKod: '120.01.001', bakiye: 15000, companyId: 'A' });
    expect(govdesi(res)).toMatchObject({ success: true, updated: 5, skipped: 1, unreadable: 1, mikroRows: 6 });
    expect(String(govdesi(res).note)).toContain('1 satırın bakiye alanı bilinmiyor');
  });

  it('hiç hareketi OLMAYAN cari (Mikro satırı yok) GERÇEKTEN sıfırdır — 0 yazılır', async () => {
    // Okunamayan satır ile karıştırılmamalı: sorgu başarılı + satır döndü, bu cari
    // hiç hareket görmemiş demektir (hareket yok = borç yok).
    d.snapAyarla('leads', { l1: { mikroCariKod: '120.01.001', companyId: 'A' }, l9: { mikroCariKod: '120.01.099', companyId: 'A' } });
    sqlYaniti([{ cha_kod: '120.01.001', bakiye: -2500 }]);

    const res = await d.cagir('POST', '/api/mikro/pull/bakiye');
    expect(d.koleksiyon('cariBalances').map(y => y.data?.bakiye)).toEqual([-2500, 0]);
    expect(govdesi(res)).toMatchObject({ updated: 2, skipped: 0, unreadable: 0 });
  });

  it('Mikro hiç satır döndürmezse (sorgu başarılı) yine hiçbir şey yazılmaz — mevcut davranış korunur', async () => {
    sqlYaniti([]);
    const res = await d.cagir('POST', '/api/mikro/pull/bakiye');
    expect(res.kod).toBe(200);
    expect(govdesi(res)).toMatchObject({ success: true, updated: 0 });
    expect(d.yazilan).toEqual([]);
  });
});
