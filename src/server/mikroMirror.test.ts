/**
 * mikroMirror.test.ts — Mikro ayna tabloları: idempotent ekleme + kolon eşlemesi (Faz 1 4/n, 2026-09-05).
 *
 * Ayna tabloları (mikro_stoklar, mikro_cari_hareketler…) Cetpa-native raporların Mikro
 * kaynağıdır; buraya yanlış yazılan değer her raporda tekrar eder. Sahte pool ile kilitlenen:
 *  - `mirrorMikroInsert` aynı ham kaydı iki kez yazmaz (veri_hash + ON CONFLICT DO NOTHING),
 *    tablo adı hash'e girer (aynı satır iki tabloda ayrı kayıt),
 *  - eksik sayısal alan 0 DEĞİL null; sayısal olmayan metin NaN DEĞİL null
 *    (pg NaN'ı numeric kolona sessizce kabul eder — CLAUDE.md `Number.isFinite`),
 *  - sto_kod boş satır yazılmaz; fiyat listesi sıra no'suz satır atlanır; depo kodu → mikro_depolar,
 *  - init edilmeden çağrı NE YAPILACAĞINI söyleyen hata verir; pool yoksa sessiz no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initMikroMirror, mirrorMikroInsert, mirrorMikroStoklar, CHA_COLS, STH_COLS, SIP_COLS } from './mikroMirror';

type Sorgu = { sql: string; params: unknown[] };
let sorgular: Sorgu[] = [];
const sahtePool = () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => { sorgular.push({ sql, params: params ?? [] }); return { rows: [] }; }),
});

describe('init sözleşmesi', () => {
  it('initMikroMirror çağrılmadan kullanılırsa anlamlı hata (TypeError değil)', async () => {
    await expect(mirrorMikroInsert('mikro_x', [{ a: 1 }], { a: r => r.a })).rejects.toThrow(/initMikroMirror\(\)/);
  });
  it('pool yoksa (lokal dev, DATABASE_URL yok) sessiz no-op', async () => {
    initMikroMirror({ getPgPool: () => null });
    await expect(mirrorMikroStoklar([{ sto_kod: 'S1' }])).resolves.toBeUndefined();
  });
});

describe('mirrorMikroInsert — hash-dedupe', () => {
  let pool: ReturnType<typeof sahtePool>;
  beforeEach(() => { sorgular = []; pool = sahtePool(); initMikroMirror({ getPgPool: () => pool }); });

  it('aynı ham kayıt iki kez → aynı veri_hash + ON CONFLICT (veri_hash) DO NOTHING', async () => {
    const satir = { cha_kod: 'C1', cha_meblag: '150.5' };
    await mirrorMikroInsert('mikro_cari_hareketler', [satir, { ...satir }], CHA_COLS);
    expect(sorgular).toHaveLength(2);
    expect(sorgular[0].sql).toMatch(/ON CONFLICT \(veri_hash\) DO NOTHING/);
    expect(sorgular[0].params.at(-1)).toBe(sorgular[1].params.at(-1));
  });
  it('tablo adı hash\'e girer — aynı satır iki tabloda ayrı kayıt', async () => {
    await mirrorMikroInsert('mikro_a', [{ x: 1 }], { x: r => r.x });
    await mirrorMikroInsert('mikro_b', [{ x: 1 }], { x: r => r.x });
    expect(sorgular[0].params.at(-1)).not.toBe(sorgular[1].params.at(-1));
  });
  it('kolon sırası = eşleme anahtar sırası; parametreler kolon değerleri + veri + hash', async () => {
    await mirrorMikroInsert('mikro_siparisler', [{ sip_stok_kod: 'S1', sip_miktar: '4' }], SIP_COLS);
    const { sql, params } = sorgular[0];
    expect(sql).toMatch(/INSERT INTO mikro_siparisler \(sip_tarih, sip_tip, .*sip_depono, veri, veri_hash\)/);
    expect(params).toHaveLength(Object.keys(SIP_COLS).length + 2);
    expect(params[5]).toBe('S1');       // sip_stok_kod 6. anahtar
    expect(params[6]).toBe(4);          // sip_miktar sayıya çevrilir
  });
  it('boş liste → sorgu yok', async () => {
    await mirrorMikroInsert('mikro_x', [], { a: r => r.a });
    expect(sorgular).toHaveLength(0);
  });
});

describe('kolon eşlemeleri — eksik sayı 0 DEĞİL null', () => {
  it('CHA_COLS: cha_Guid/cha_guid ikisi de; eksik/boş meblağ null; kaynak varsayılan mikro, __kaynak ezer', () => {
    expect(CHA_COLS.cha_guid({ cha_Guid: 'G1' })).toBe('G1');
    expect(CHA_COLS.cha_guid({ cha_guid: 'g2' })).toBe('g2');
    expect(CHA_COLS.cha_meblag({})).toBeNull();
    expect(CHA_COLS.cha_meblag({ cha_meblag: '' })).toBeNull();
    expect(CHA_COLS.cha_meblag({ cha_meblag: '0' })).toBe(0);
    expect(CHA_COLS.cha_tip({ cha_tip: 1 })).toBe(1);
    expect(CHA_COLS.kaynak({})).toBe('mikro');
    expect(CHA_COLS.kaynak({ __kaynak: 'luca' })).toBe('luca');
  });
  it('sayısal olmayan metin NaN DEĞİL null (pg NaN\'ı numeric kolona kabul eder)', () => {
    expect(CHA_COLS.cha_meblag({ cha_meblag: 'abc' })).toBeNull();
    expect(STH_COLS.sth_miktar({ sth_miktar: '1.234,56' })).toBeNull();   // Türk biçimi burada ÇÖZÜLMEZ, bilinmiyor
  });
  it('STH_COLS: sth_* yoksa fat_* alanlarına düşer (fatura satırları aynı tabloya)', () => {
    expect(STH_COLS.sth_stok_kod({ fat_stok_kod: 'F1' })).toBe('F1');
    expect(STH_COLS.sth_miktar({ fat_miktar: '2' })).toBe(2);
    expect(STH_COLS.sth_stok_kod({ sth_stok_kod: 'S1', fat_stok_kod: 'F1' })).toBe('S1');
  });
});

describe('mirrorMikroStoklar — sto_kod upsert', () => {
  let pool: ReturnType<typeof sahtePool>;
  beforeEach(() => { sorgular = []; pool = sahtePool(); initMikroMirror({ getPgPool: () => pool }); });

  it('sto_kod boş/boşluk satır YAZILMAZ', async () => {
    await mirrorMikroStoklar([{ sto_kod: '  ' }, { sto_isim: 'kodsuz' }]);
    expect(sorgular).toHaveLength(0);
  });
  it("miktar '' → null (mevcut sto_mevcut_mik COALESCE ile korunur); toplam_miktar'a düşer; 'abc' → null", async () => {
    await mirrorMikroStoklar([{ sto_kod: 'S1', sto_mevcut_mik: '' }, { sto_kod: 'S2', toplam_miktar: '7' }, { sto_kod: 'S3', sto_mevcut_mik: 'abc' }]);
    const stok = sorgular.filter(q => q.sql.includes('INSERT INTO mikro_stoklar'));
    expect(stok).toHaveLength(3);
    expect(stok[0].params[13]).toBeNull();
    expect(stok[0].sql).toMatch(/sto_mevcut_mik = COALESCE\(EXCLUDED\.sto_mevcut_mik, mikro_stoklar\.sto_mevcut_mik\)/);
    expect(stok[1].params[13]).toBe(7);
    expect(stok[2].params[13]).toBeNull();
  });
  it('fiyat listesi: sıra no olan satır yazılır, olmayan atlanır; depo kodu mikro_depolar\'a', async () => {
    await mirrorMikroStoklar([{ sto_kod: 'S1', sto_yer_kod: '2', satis_fiyatlari: [{ sfiyat_listesirano: 1, sfiyat_fiyati: '100' }, { sfiyat_fiyati: '50' }] }]);
    const fiyat = sorgular.filter(q => q.sql.includes('mikro_stok_satis_fiyat_listeleri'));
    expect(fiyat).toHaveLength(1);
    expect(fiyat[0].params.slice(0, 3)).toEqual(['S1', 1, 100]);
    const depo = sorgular.filter(q => q.sql.includes('mikro_depolar'));
    expect(depo).toHaveLength(1);
    expect(depo[0].params).toEqual(['2', 'Depo 2']);
  });
  it('sorgu hatası ana akışı bozmaz (warn + devam)', async () => {
    pool.query.mockRejectedValueOnce(new Error('bağlantı koptu'));
    await expect(mirrorMikroStoklar([{ sto_kod: 'S1' }])).resolves.toBeUndefined();
  });
});
