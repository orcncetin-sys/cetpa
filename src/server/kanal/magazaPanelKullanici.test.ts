// @vitest-environment node
/**
 * magazaPanelKullanici.test.ts — panel kullanıcı okuyucusunun OKUMA / DÜŞÜRME YARIŞI (2026-10-21, «müşteri siparişlerim» Tur 2 A
 * parçası incelemesi; bulgu bu işten önceydi). Okuyucunun öbür kuralları `magazaPanel.test.ts`'te.
 *
 * Yarış: `panelKullanicisi(uid)` üç okumayı sırayla yapar (`users` → `companyStatus` → `mfa_secrets`). Okuma ikinci ya da üçüncü
 * adımda beklerken firma askıya alınır (`companyStatus` olayı → `temizle()`) ya da kişi iki adımlı doğrulamayı açar (MFA satırları →
 * `dusur(uid)`) ise bekleyen okuma ESKİ sonucu 60 sn önbellekte yaşatmamalı. Sürüm sayacı ortak yardımcıdadır (`../surumluOnbellek`).
 *
 * Mutasyon: yardımcıdaki sürüm koşulu kaldırılırsa iki test de kırmızı (ikinci çağrı eski değeri önbellekten verir).
 */
import { describe, expect, it } from 'vitest';
import type { AdminDbLike, AdminDocRef } from '../adminDbTypes';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes';
import { panelKullanicisiKur } from './magazaPanelKullanici';

const SAAT = new Date('2026-10-21T12:00:00.000Z');

/** Bekletilebilen sahte adminDb: `bekletilen` yoldaki İLK `get` anlık görüntüyü alır ve `birak()`a kadar bekler. */
function sahteDb(ilk: Record<string, Record<string, unknown>>) {
  const belgeler = new Map<string, Record<string, unknown>>(Object.entries(ilk));
  const okumalar: string[] = [];
  let bekletilen: string | null = null;
  let birak: () => void = () => { throw new Error('bekleyen okuma yok'); };
  const doc = (coll: string, id: string): AdminDocRef => ({
    id,
    async get() {
      const yol = `${coll}/${id}`;
      okumalar.push(yol);
      const d = belgeler.get(yol);
      const snap = { exists: d !== undefined, id, data: () => (d === undefined ? undefined : { ...d }) };
      if (bekletilen === yol) { bekletilen = null; await new Promise<void>((r) => { birak = r; }); }
      return snap;
    },
    async set() { throw new Error('kullanılmaz'); },
    async update() { throw new Error('kullanılmaz'); },
    async delete() { throw new Error('kullanılmaz'); },
  });
  const db: AdminDbLike = {
    collection: (ad) => ({
      doc: (id) => doc(ad, id ?? 'yeni'),
      add: async () => { throw new Error('kullanılmaz'); },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      async get() { return { docs: [], empty: true, size: 0 }; },
    }),
    batch: () => { throw new Error('kullanılmaz'); },
  };
  return { db, belgeler, okumalar, bekle: (yol: string) => { bekletilen = yol; }, birak: () => birak() };
}

/** Bekletilebilen sahte havuz: `bekletilsin` doğruyken İLK sorgu `mfa_secrets` satırlarını alır ve `birak()`a kadar bekler. */
function sahteHavuz(mfa: Record<string, boolean>) {
  const sorgular: string[] = [];
  let bekletilsin = false;
  let birak: () => void = () => { throw new Error('bekleyen sorgu yok'); };
  const havuz: MagazaPgHavuzu = {
    async query(sql, params = []) {
      sorgular.push(sql);
      const uid = String(params[0]);
      const rows = uid in mfa ? [{ enabled: mfa[uid] }] : [];
      if (bekletilsin) { bekletilsin = false; await new Promise<void>((r) => { birak = r; }); }
      return { rows };
    },
  };
  return { havuz, mfa, sorgular, bekle: () => { bekletilsin = true; }, birak: () => birak() };
}

const tik = () => new Promise((r) => setTimeout(r, 0));

describe('panelKullanicisiKur — okuma / düşürme yarışı (sürüm sayacı, ortak yardımcı)', () => {
  it('`companyStatus` okuması beklerken firma askıya alınır ve `temizle()` gelir: eski «active» önbelleğe YAZILMAZ; sonraki çağrı «suspended» görür', async () => {
    const s = sahteDb({ 'users/u-bayi': { role: 'Dealer', companyId: 'cid-1', email: 'bayi@ornek.test' }, 'companyStatus/cid-1': { status: 'active' } });
    const pg = sahteHavuz({});
    const o = panelKullanicisiKur({ adminDb: () => s.db, pgPool: () => pg.havuz, simdi: () => SAAT });
    s.bekle('companyStatus/cid-1');
    const ucusta = o.panelKullanicisi('u-bayi');
    await tik();
    expect(s.okumalar).toEqual(['users/u-bayi', 'companyStatus/cid-1']);   // okuma GERÇEKTEN ikinci adımda bekliyor
    s.belgeler.set('companyStatus/cid-1', { status: 'suspended' });
    o.temizle();                                                         // server.ts: `companyStatus` olayı
    s.birak();
    expect((await ucusta)?.firmaDurumu).toBe('active');                  // o okumanın sonucu (eski anlık görüntü)
    expect((await o.panelKullanicisi('u-bayi'))?.firmaDurumu).toBe('suspended');
    expect(s.okumalar.filter((y) => y === 'companyStatus/cid-1')).toHaveLength(2);
  });

  it('`mfa_secrets` sorgusu beklerken kişi doğrulamayı açar ve `dusur(uid)` gelir: eski «MFA kapalı» önbelleğe YAZILMAZ; sonraki çağrı «açık» görür', async () => {
    const s = sahteDb({ 'users/u-bayi': { role: 'B2B', companyId: 'cid-1', email: 'bayi@ornek.test' } });
    const pg = sahteHavuz({ 'u-bayi': false });
    const o = panelKullanicisiKur({ adminDb: () => s.db, pgPool: () => pg.havuz, simdi: () => SAAT });
    pg.bekle();
    const ucusta = o.panelKullanicisi('u-bayi');
    await tik();
    expect(pg.sorgular).toEqual(['SELECT enabled FROM mfa_secrets WHERE uid = $1']);   // üçüncü adımda bekliyor
    pg.mfa['u-bayi'] = true;
    o.dusur('u-bayi');                                                   // server.ts: `mfaStatusCache.delete` satırlarının yanı
    pg.birak();
    expect((await ucusta)?.mfaAcik).toBe(false);
    expect((await o.panelKullanicisi('u-bayi'))?.mfaAcik).toBe(true);
    expect(pg.sorgular).toHaveLength(2);
  });

  it('KARŞI ÖRNEK: düşürme gelmezse aynı akışta sonuç önbelleğe yazılır (ikinci çağrı okuma yapmaz)', async () => {
    const s = sahteDb({ 'users/u-bayi': { role: 'Dealer', companyId: 'cid-1' }, 'companyStatus/cid-1': { status: 'active' } });
    const pg = sahteHavuz({});
    const o = panelKullanicisiKur({ adminDb: () => s.db, pgPool: () => pg.havuz, simdi: () => SAAT });
    s.bekle('companyStatus/cid-1');
    const ucusta = o.panelKullanicisi('u-bayi');
    await tik();
    s.birak();
    await ucusta;
    await o.panelKullanicisi('u-bayi');
    expect(s.okumalar).toEqual(['users/u-bayi', 'companyStatus/cid-1']);
  });
});
