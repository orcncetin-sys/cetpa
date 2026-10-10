// @vitest-environment node
/**
 * schemas.magaza.test.ts — mağaza dilim 2a gövde şemaları (§ 3.2, § 3.3, § 4). Hepsi `.strict()`; `KalemTeslimGovdesi` TEK sabit
 * (iki rota dosyası içe aktarır — ikinci `z.object(` kopyası yazılmaz; kaynak çiti rota testlerinde).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kodSatirlari, SRC_KOK } from '../test/kaynakTarama';
import {
  BildirimGonderGovdesi, ErpDurumGovdesi, EtiketBasildiGovdesi, KalemTeslimGovdesi, PanelDurumGovdesi, PanelOturumGovdesi, YetkiKoduGovdesi,
} from './schemas';

const gecer = (sema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean => sema.safeParse(v).success;
const K43 = 'A'.repeat(43), K22 = 'B'.repeat(22);

describe('PanelDurumGovdesi / ErpDurumGovdesi', () => {
  it('panel sözlüğü: `alindi` geçer, saklanan `yeni` ve `bilinmiyor` 400; ERP tersi', () => {
    expect(gecer(PanelDurumGovdesi, { onceki: 'alindi', surum: 0, durum: 'teyit' })).toBe(true);
    expect(gecer(PanelDurumGovdesi, { onceki: 'yeni', surum: 0, durum: 'teyit' })).toBe(false);
    expect(gecer(PanelDurumGovdesi, { onceki: 'bilinmiyor', surum: 0, durum: 'teyit' })).toBe(false);
    expect(gecer(PanelDurumGovdesi, { onceki: 'alindi', surum: 0, durum: 'bilinmiyor' })).toBe(false);
    expect(gecer(ErpDurumGovdesi, { onceki: 'yeni', surum: 0, durum: 'teyit' })).toBe(true);
    expect(gecer(ErpDurumGovdesi, { onceki: 'alindi', surum: 0, durum: 'teyit' })).toBe(false);
  });
  it('`surum` ZORUNLU tam sayı ≥ 0; aynı aşamada `aciklama` zorunlu; ham açıklama en çok 2.000; tanınmayan alan 400', () => {
    expect(gecer(PanelDurumGovdesi, { onceki: 'alindi', durum: 'teyit' })).toBe(false);
    for (const surum of [-1, 1.5, '1', null]) expect(gecer(PanelDurumGovdesi, { onceki: 'alindi', surum, durum: 'teyit' }), String(surum)).toBe(false);
    expect(gecer(PanelDurumGovdesi, { onceki: 'sevk', surum: 3, durum: 'sevk' })).toBe(false);
    expect(gecer(PanelDurumGovdesi, { onceki: 'sevk', surum: 3, durum: 'sevk', aciklama: '' })).toBe(true);
    expect(gecer(PanelDurumGovdesi, { onceki: 'sevk', surum: 3, durum: 'teslim', aciklama: 'x'.repeat(2000) })).toBe(true);
    expect(gecer(PanelDurumGovdesi, { onceki: 'sevk', surum: 3, durum: 'teslim', aciklama: 'x'.repeat(2001) })).toBe(false);
    expect(gecer(PanelDurumGovdesi, { onceki: 'sevk', surum: 3, durum: 'teslim', fazla: 1 })).toBe(false);
  });
});

describe('KalemTeslimGovdesi (tek sabit)', () => {
  const g = (ek: Record<string, unknown>) => ({ surum: 3, teslim: true, kalemler: ['b:0'], ...ek });
  it('`hepsi` ve 1–500 anahtarlı liste geçer; boş liste, 501, desene uymayan (`c:0`, `b:`, `B:0`, `b:01`), yinelenen, `teslim: "evet"`, `surum`süz, tanınmayan alan → 400', () => {
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: 'hepsi' }))).toBe(true);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: ['b:0', 'b:1', 't:0123456789ab'] }))).toBe(true);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: Array.from({ length: 500 }, (_, i) => `b:${i}`) }))).toBe(true);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: Array.from({ length: 501 }, (_, i) => `b:${i}`) }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: [] }))).toBe(false);
    for (const a of ['c:0', 'b:', 'B:0', 'b:01', 'b:001', 't:0123456789A', '']) expect(gecer(KalemTeslimGovdesi, g({ kalemler: [a] })), a).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: ['b:1', 'b:01'] }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: ['b:0', 'b:0'] }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ kalemler: 'tumu' }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ teslim: 'evet' }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, { teslim: true, kalemler: ['b:0'] })).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ surum: -1 }))).toBe(false);
    expect(gecer(KalemTeslimGovdesi, g({ onceki: 'sevk' }))).toBe(false);
  });
});

describe('EtiketBasildiGovdesi / BildirimGonderGovdesi', () => {
  it('etiket: `{}` ve `{ koli: 3 }` geçer; `koli` 0 / -1 / 1.5 / "3", `surum`, tanınmayan alan → 400', () => {
    expect(gecer(EtiketBasildiGovdesi, {})).toBe(true);
    expect(gecer(EtiketBasildiGovdesi, { koli: 3 })).toBe(true);
    for (const koli of [0, -1, 1.5, '3', null]) expect(gecer(EtiketBasildiGovdesi, { koli }), String(koli)).toBe(false);
    expect(gecer(EtiketBasildiGovdesi, { surum: 1 })).toBe(false);
    expect(gecer(EtiketBasildiGovdesi, { koli: 2, kim: 'u' })).toBe(false);
  });
  it('bildirim-gonder: yalnız `{}`', () => {
    expect(gecer(BildirimGonderGovdesi, {})).toBe(true);
    expect(gecer(BildirimGonderGovdesi, { tur: 'ilk' })).toBe(false);
    expect(gecer(BildirimGonderGovdesi, [])).toBe(false);
    expect(gecer(BildirimGonderGovdesi, null)).toBe(false);
  });
});

describe('YetkiKoduGovdesi / PanelOturumGovdesi (§ 3.2, 3.3)', () => {
  it('meydan 43 + tur 22 base64url; kod + doğrulayıcı 43; bozuk uzunluk / karakter / tanınmayan alan (`eposta`, `sifre`) → 400', () => {
    expect(gecer(YetkiKoduGovdesi, { meydan: K43, tur: K22 })).toBe(true);
    expect(gecer(YetkiKoduGovdesi, { meydan: K43.slice(1), tur: K22 })).toBe(false);
    expect(gecer(YetkiKoduGovdesi, { meydan: K43, tur: K22 + 'C' })).toBe(false);
    expect(gecer(YetkiKoduGovdesi, { meydan: K43.replace('A', '+'), tur: K22 })).toBe(false);
    expect(gecer(YetkiKoduGovdesi, { meydan: K43, tur: K22, donus: 'https://x' })).toBe(false);
    expect(gecer(PanelOturumGovdesi, { kod: K43, dogrulayici: K43 })).toBe(true);
    expect(gecer(PanelOturumGovdesi, { kod: K43, dogrulayici: K43, eposta: 'a@b', sifre: 'x' })).toBe(false);
    expect(gecer(PanelOturumGovdesi, { eposta: 'a@b', sifre: 'x' })).toBe(false);
    expect(gecer(PanelOturumGovdesi, { kod: K43 })).toBe(false);
  });
  it('kaynak çiti: şema dosyası yalnız zod ve yaprak sözleşmeyi içe aktarır; yeni şemalarda `.default(` / `.coerce` / `.transform(` yok', () => {
    const satirlar = kodSatirlari(join(SRC_KOK, 'server', 'schemas.ts')).map(s => s.kod);
    const iceAktarimlar = satirlar.filter(s => /^import /.test(s) || /^\} from /.test(s));
    expect(iceAktarimlar.join('\n')).toMatch(/from 'zod'/);
    expect(iceAktarimlar.join('\n')).toMatch(/from '\.\.\/lib\/magazaTalep\.js'/);
    expect(iceAktarimlar.join('\n')).not.toMatch(/server\.ts|pgShim|kanal\//);
    const bas = satirlar.findIndex(s => s.includes('const durumGovdesi'));
    expect(bas).toBeGreaterThan(-1);
    expect(satirlar.slice(bas).join('\n')).not.toMatch(/\.default\(|\.coerce|\.transform\(|\.catch\(/);
    expect(satirlar.slice(bas).filter(s => /z\.object\(/.test(s))).toHaveLength(6);
  });
});
