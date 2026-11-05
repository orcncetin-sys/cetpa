// @vitest-environment node
/**
 * bankaKasaBakiye.test.ts: banka / kasa B1-a (şartname `.wf/SARTNAME-mikro-baglanti-b.md` § 3.5 + BH2 / BH7 / BH20, T-B1-3,
 * T-B1-4 (BH2 dalı), T-B1-8). Geçiş GERÇEK SQL ile koşar (PGlite; `docs` tablosu canlıyla AYNI DDL'den). Mikro'ya istek YOK.
 *
 * Mutasyonlar (yapılıp geri alındı, raporda): geçiş SQL'inden `NOT (data ? 'bakiyeZamani')` silinir → T-B1-3 «bakiyeZamani'lı
 * belgeye dokunulmaz» kırmızı; kiracı koşulu silinir → «yabancı kiracı» kırmızı; yayın çağrısı silinir → «tek yayın» kırmızı;
 * T-B1-8'e uydurma kolon (`cha_kasa_bakiye`) eklenir → çit kırmızı.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pgliteDocs, type PgliteDocs } from '../routes/mikroRoutes.testDuzenegi';
import {
  OB1_SORGULARI, SEMA_OLCUMU_KANITI, BANKA_KASA_HESAPLARI, bankaKasaGecisiCalistir, bankaKasaGecisNotu, gecisSql,
} from './bankaKasaBakiye';
import { SRC_KOK, kaynakDosyalari } from '../../test/kaynakTarama';

let h: PgliteDocs;
beforeAll(async () => { h = await pgliteDocs(); }, 60_000);
beforeEach(async () => { await h.temizle(); });

type Yayin = [coll: string, id: string, data: unknown];
const kos = async (cid = 'A') => {
  const yayinlar: Yayin[] = [];
  const s = await bankaKasaGecisiCalistir({ query: h.sorgu }, cid, (coll, id, data) => yayinlar.push([coll, id, data]));
  return { s, yayinlar };
};
const mikroBanka = (ek: Record<string, unknown> = {}) => ({ companyId: 'A', source: 'mikro', bankName: 'ZİRAAT', balance: 0, ...ek });
const mikroKasa = (ek: Record<string, unknown> = {}) => ({ companyId: 'A', source: 'mikro', kasaAdi: 'MERKEZ', bakiye: 0, ...ek });

describe('T-B1-3 · sahte ₺0 → null geçişi (kiracılı, idempotent, yayınlı)', () => {
  it('ilk koşuda 3 banka + 8 kasa null olur, ikinci koşuda 0 satır; her değişen satır için TEK yayın, değişmeyen için yok', async () => {
    for (let i = 1; i <= 3; i++) await h.belgeKoy('bankAccounts', `b${i}`, mikroBanka({ mikroKod: `B${i}` }));
    for (let i = 1; i <= 8; i++) await h.belgeKoy('kasalar', `k${i}`, mikroKasa());
    const ilk = await kos();
    expect(ilk.s.tur).toBe('tamam');
    if (ilk.s.tur !== 'tamam') return;
    expect(ilk.s.hesaplar.map(x => [x.etiket, x.degisen.length, x.korunan.length, x.etiketsiz])).toEqual([['banka', 3, 0, 0], ['kasa', 8, 0, 0]]);
    for (let i = 1; i <= 3; i++) expect((await h.belgeOku('bankAccounts', `b${i}`))?.balance).toBeNull();
    for (let i = 1; i <= 8; i++) expect((await h.belgeOku('kasalar', `k${i}`))?.bakiye).toBeNull();
    // Yayın yazılan GERÇEK satırdan (RETURNING): değer null, öteki alanlar yerinde.
    expect(ilk.yayinlar).toHaveLength(11);
    expect(ilk.yayinlar.filter(y => y[0] === 'bankAccounts').map(y => y[1]).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(ilk.yayinlar[0][2]).toMatchObject({ balance: null, bankName: 'ZİRAAT', mikroKod: 'B1' });

    const ikinci = await kos();
    expect(ikinci.s.tur === 'tamam' && ikinci.s.hesaplar.map(x => x.degisen.length)).toEqual([0, 0]);
    expect(ikinci.yayinlar).toEqual([]);
  });

  it('elle açılan hesap (`source ≠ mikro`), 0 olmayan değer, `bakiyeZamani` taşıyan belge ve yabancı kiracının aynı belgesi KALIR', async () => {
    await h.belgeKoy('bankAccounts', 'elle', { companyId: 'A', bankName: 'Elle', balance: 0 });                    // source yok
    await h.belgeKoy('bankAccounts', 'manuel', { companyId: 'A', source: 'manual', balance: 0 });
    await h.belgeKoy('bankAccounts', 'dolu', mikroBanka({ balance: 125000 }));
    await h.belgeKoy('bankAccounts', 'gece', mikroBanka({ bakiyeZamani: '2026-11-06T00:20:00Z', bakiyeKaynagi: 'mikro-gece' }));
    await h.belgeKoy('bankAccounts', 'yabanci', mikroBanka({ companyId: 'B' }));
    await h.belgeKoy('kasalar', 'k-yabanci', mikroKasa({ companyId: 'B' }));
    await h.belgeKoy('kasalar', 'k-ok', mikroKasa());
    const { s, yayinlar } = await kos();
    expect(s.tur === 'tamam' && s.hesaplar.map(x => x.degisen)).toEqual([[], ['k-ok']]);
    expect((await h.belgeOku('bankAccounts', 'elle'))?.balance).toBe(0);
    expect((await h.belgeOku('bankAccounts', 'manuel'))?.balance).toBe(0);
    expect((await h.belgeOku('bankAccounts', 'dolu'))?.balance).toBe(125000);
    expect((await h.belgeOku('bankAccounts', 'gece'))?.balance).toBe(0);
    expect((await h.belgeOku('bankAccounts', 'yabanci'))?.balance).toBe(0);
    expect((await h.belgeOku('kasalar', 'k-yabanci'))?.bakiye).toBe(0);
    expect(yayinlar.map(y => y[1])).toEqual(['k-ok']);
  });

  it('etiketsiz (companyId\'siz) Mikro belgesine dokunulmaz, sayısı özette', async () => {
    await h.belgeKoy('kasalar', 'k-etiketsiz', { source: 'mikro', bakiye: 0 });
    const { s } = await kos();
    expect(s.tur === 'tamam' && s.hesaplar.map(x => [x.etiket, x.degisen.length, x.etiketsiz])).toEqual([['banka', 0, 0], ['kasa', 0, 1]]);
    expect((await h.belgeOku('kasalar', 'k-etiketsiz'))?.bakiye).toBe(0);
  });

  it('havuz yoksa (lokal Firestore yedeği) hiçbir şey yapılmaz; kiracı boşsa fırlatır', async () => {
    expect(await bankaKasaGecisiCalistir(null, 'A', () => {})).toEqual({ tur: 'havuzYok' });
    await expect(bankaKasaGecisiCalistir({ query: h.sorgu }, '', () => {})).rejects.toThrow(/kiracı/);
  });
});

describe('T-B1-4 (BH2 dalı) · elle girilmiş değer korunur, özette sayılır', () => {
  it('elle 125000 girilmiş, `bakiyeKaynagi` yok → koşudan sonra 125000; özet «elle girilmiş değer korundu: 1» (id, kod, değer)', async () => {
    await h.belgeKoy('bankAccounts', 'g-elle', mikroBanka({ balance: 125000, mikroKod: '102.01' }));
    await h.belgeKoy('bankAccounts', 'g-sifir', mikroBanka());
    const { s } = await kos();
    expect((await h.belgeOku('bankAccounts', 'g-elle'))?.balance).toBe(125000);
    if (s.tur !== 'tamam') throw new Error('tamam bekleniyordu');
    const not = bankaKasaGecisNotu(s.hesaplar);
    expect(not).toBe('0 → null geçişi: 1 banka (g-sifir) · 0 kasa · elle girilmiş değer korundu: 1 (banka g-elle [102.01]: 125000) · '
      + 'etiketsiz Mikro belgesi: banka 0, kasa 0 · bakiye hesabı yok (Ö-B1 ölçüsü ve Mikro açılış fişi bekleniyor)');
  });

  it('gece kaynağı taşıyan (`bakiyeKaynagi: mikro-gece`) sıfır olmayan değer «elle» SAYILMAZ', async () => {
    await h.belgeKoy('kasalar', 'k-gece', mikroKasa({ bakiye: 900, bakiyeKaynagi: 'mikro-gece', bakiyeZamani: '2026-11-06T00:20:00Z' }));
    const { s } = await kos();
    expect(s.tur === 'tamam' && s.hesaplar.flatMap(x => x.korunan)).toEqual([]);
  });

  it('SQL hatası FIRLATIR (çağıran TEK başarısız satır yazar); hata ilk deyimde → hiçbir değer değişmez, yayın yok', async () => {
    await h.belgeKoy('bankAccounts', 'b1', mikroBanka());
    const yayinlar: Yayin[] = [];
    const bozuk = { query: async (sql: string, p?: unknown[]) => { if (sql.startsWith('UPDATE')) throw new Error('bağlantı koptu'); return h.sorgu(sql, p); } };
    await expect(bankaKasaGecisiCalistir(bozuk, 'A', (c, i, d) => yayinlar.push([c, i, d]))).rejects.toThrow('bağlantı koptu');
    expect((await h.belgeOku('bankAccounts', 'b1'))?.balance).toBe(0);
    expect(yayinlar).toEqual([]);
  });
});

describe('geçiş SQL\'i · biçim çiti', () => {
  it('iki hesap türü: alan adı ve koleksiyon sabit; koşulda kiracı, kaynak, tam 0 ve `bakiyeZamani` yokluğu', () => {
    expect(BANKA_KASA_HESAPLARI.map(x => [x.coll, x.alan])).toEqual([['bankAccounts', 'balance'], ['kasalar', 'bakiye']]);
    for (const x of BANKA_KASA_HESAPLARI) {
      const s = gecisSql(x);
      expect(s).toContain(`coll = '${x.coll}'`);
      expect(s).toContain("data->>'companyId' = $1");
      expect(s).toContain("data->>'source' = 'mikro'");
      expect(s).toContain(`data->'${x.alan}' = '0'::jsonb`);
      expect(s).toContain("NOT (data ? 'bakiyeZamani')");
      expect(s).toContain('RETURNING id, data');
    }
  });
});

describe('T-B1-8 · Ö-B1 sorguları: salt okuma ve kolon adı çiti (tahmin yok)', () => {
  const tumSql = OB1_SORGULARI.map(q => q.sql).join('\n');
  it('her sorgu SELECT, tek deyim, ASCII; yazım sözcüğü yok; adlar tekil', () => {
    expect(OB1_SORGULARI.map(q => q.ad)).toEqual(['bankaKasaKolonlari', 'bankaKasaTabloAdaylari', 'chaKarsiHesapDagilimi',
      'chaKasaHizkodDagilimi', 'chaCariDisiKodlar', 'chaKodsuzKarsiHesap']);
    for (const q of OB1_SORGULARI) {
      expect(q.sql, q.ad).toMatch(/^SELECT /);
      expect(q.sql, q.ad).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|DROP|ALTER|TRUNCATE|CREATE|GRANT|INTO)\b/i);
      expect(q.sql, q.ad).not.toContain(';');
      expect(q.sql, q.ad).not.toContain('--');
      expect(q.sql, q.ad).not.toMatch(/[^\x20-\x7E]/);
    }
  });
  it('her `cha_*` kolon adı depoda (bu dosya hariç üretim kaynağında) TAM SÖZCÜK olarak geçer ya da canlı şema ölçüsünde kanıtlı', () => {
    const adlar = [...new Set(tumSql.match(/\bcha_[A-Za-z_]+\b/g) ?? [])].sort();
    expect(adlar.length).toBeGreaterThan(10);
    const kaynaklar = kaynakDosyalari(SRC_KOK).filter(y => !y.endsWith(join('mikro', 'bankaKasaBakiye.ts'))).map(y => readFileSync(y, 'utf-8'));
    const depodaYok = adlar.filter(ad => !kaynaklar.some(m => new RegExp(`(?<![A-Za-z0-9_])${ad}(?![A-Za-z0-9_])`).test(m)));
    // Depoda geçmeyen her ad ölçü kanıtında; kanıttaki her ad gerçekten kullanılıyor ve depoda geçmiyor (kanıt listesi şişmesin).
    expect(depodaYok).toEqual(Object.keys(SEMA_OLCUMU_KANITI).sort());
  });
  it('tablolar yalnız CARI_HESAP_HAREKETLERI ve INFORMATION_SCHEMA (BANKALAR / KASALAR adları yalnız metin sabiti)', () => {
    const tablolar = [...new Set([...tumSql.matchAll(/\bFROM ([A-Z_.]+)/g)].map(m => m[1]))].sort();
    expect(tablolar).toEqual(['CARI_HESAP_HAREKETLERI', 'INFORMATION_SCHEMA.COLUMNS', 'INFORMATION_SCHEMA.TABLES']);
  });
});
