// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { MAGAZA_BILDIRIM_HATA_SINIFLARI, MAGAZA_TALEP_KOLEKSIYONU } from '../../lib/magazaTalep';
import { magazaBildirimSayimi, MAGAZA_BILDIRIM_SAYIM_SQL, MAGAZA_BILDIRIM_DURUMLARI, MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN } from './magazaBildirimSayim';

const SIMDI = Date.UTC(2026, 9, 9, 12, 0, 0);
const GIZLI = 'Zeynep Kaya 0532 111 22 33';

function tamSatir(): Record<string, unknown> {
  const satir: Record<string, unknown> = { toplam: 7, durum_bekliyor: 1, durum_gitti: 4, durum_gonderilemedi: 1, durum_yapilandirilmamis: 1 };
  for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) satir[`sinif_${s.replace(/-/g, '_')}`] = s === 'gonderen-reddi' ? 1 : 0;
  return satir;
}
const havuz = (rows: unknown[]) => {
  const sorgular: Array<[string, unknown[]]> = [];
  return { sorgular, query: async (sql: string, params: unknown[]) => { sorgular.push([sql, params]); return { rows }; } };
};

describe('magazaBildirimSayimi — kapalı kümelerden sayım, kişisel veri sızmaz', () => {
  it('SQL: koleksiyon + pencere parametresi (7 gün); her durum ve her hata sınıfı için FILTER sütunu; GROUP BY yok', async () => {
    const h = havuz([tamSatir()]);
    const sonuc = await magazaBildirimSayimi(h, SIMDI);
    expect(h.sorgular).toHaveLength(1);
    const [sql, params] = h.sorgular[0];
    expect(sql).toBe(MAGAZA_BILDIRIM_SAYIM_SQL);
    expect(sql).toContain(`FROM docs WHERE coll = $1 AND (data->>'olusturma') COLLATE "C" >= $2`);   // pencere yüklemi (totolojik `toBe` tek başına çit değil)
    expect(params).toEqual([MAGAZA_TALEP_KOLEKSIYONU, new Date(SIMDI - 7 * 24 * 60 * 60 * 1000).toISOString()]);
    expect(MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN).toBe(7);
    expect(sql).not.toMatch(/GROUP BY/i);
    for (const d of MAGAZA_BILDIRIM_DURUMLARI) expect(sql).toContain(`durum' = '${d}'))::int AS durum_${d}`);
    for (const s of MAGAZA_BILDIRIM_HATA_SINIFLARI) expect(sql).toContain(`hataSinifi' = '${s}'))::int AS sinif_${s.replace(/-/g, '_')}`);
    expect(sonuc).toEqual({
      toplam: 7,
      durum: { bekliyor: 1, gitti: 4, gonderilemedi: 1, yapilandirilmamis: 1 },
      hataSinifi: { kimlik: 0, tls: 0, baglanti: 0, 'gonderen-reddi': 1, 'alici-reddi': 0, diger: 0 },
    });
  });

  it('durum kümesi sözleşmedeki dört değer; sınıf kümesi sözleşmenin altı değeri (altı sütun)', () => {
    expect([...MAGAZA_BILDIRIM_DURUMLARI].sort()).toEqual(['bekliyor', 'gitti', 'gonderilemedi', 'yapilandirilmamis']);
    expect(MAGAZA_BILDIRIM_HATA_SINIFLARI).toHaveLength(6);
  });

  it('bilinmeyen sütun ve metin yanıta GEÇMEZ; sayılar dize gelse de tam sayıya çevrilir', async () => {
    const satir = { ...tamSatir(), hata_metni: GIZLI, toplam: '7' };
    const sonuc = await magazaBildirimSayimi(havuz([satir]), SIMDI);
    expect(JSON.stringify(sonuc)).not.toContain('Zeynep');
    expect(JSON.stringify(sonuc)).not.toContain('hata_metni');
    expect(sonuc?.toplam).toBe(7);
  });

  it.each([
    ['satır yok', []],
    ['bir sütun eksik', [(() => { const s = tamSatir(); delete s.durum_gitti; return s; })()]],
    ['sütun sayı değil', [{ ...tamSatir(), durum_gitti: 'çok' }]],
    ['eksi sayı', [{ ...tamSatir(), toplam: -1 }]],
    ['ondalık', [{ ...tamSatir(), toplam: 1.5 }]],
  ])('%s → null (uydurma sıfır yok)', async (_ad, rows) => {
    expect(await magazaBildirimSayimi(havuz(rows), SIMDI)).toBeNull();
  });

  it('sorgu fırlatırsa null, fırlatmaz', async () => {
    expect(await magazaBildirimSayimi({ query: async () => { throw new Error(`relation docs: ${GIZLI}`); } }, SIMDI)).toBeNull();
  });
});
