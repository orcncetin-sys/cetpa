/**
 * opsJeton — OPS_SUMMARY_TOKEN korumalı uçların ortak kapısı (2026-09-28). Jeton YALNIZ `X-Ops-Token` başlığında; sorgu
 * dizesindeki jeton erişim günlüklerine düşer, kabul edilmez. Değişmez: kapı başka yerde elle KOPYALANMAZ.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import { opsJetonuGecerli } from './opsJeton';

const JETON = 'gizli-jeton-abc';
const yedek = process.env.OPS_SUMMARY_TOKEN;
beforeEach(() => { process.env.OPS_SUMMARY_TOKEN = JETON; });
afterEach(() => { if (yedek === undefined) delete process.env.OPS_SUMMARY_TOKEN; else process.env.OPS_SUMMARY_TOKEN = yedek; });

function dene(headers: Record<string, unknown>, query: Record<string, unknown> = {}, mesaj?: string) {
  const res = { kod: 200, govde: null as unknown, status(n: number) { res.kod = n; return res; }, json(b: unknown) { res.govde = b; return res; } };
  const gecti = opsJetonuGecerli({ headers, query } as unknown as Request, res as unknown as Response, mesaj);
  return { gecti, kod: res.kod, govde: res.govde };
}

describe('opsJetonuGecerli', () => {
  it('doğru başlık → geçer, yanıt yazılmaz', () => {
    expect(dene({ 'x-ops-token': JETON })).toEqual({ gecti: true, kod: 200, govde: null });
  });

  it('sorgu dizesindeki jeton KABUL EDİLMEZ (erişim günlüğüne düşerdi) → 401', () => {
    expect(dene({}, { token: JETON })).toMatchObject({ gecti: false, kod: 401, govde: { error: 'unauthorized' } });
  });

  it('yanlış / eksik / farklı uzunlukta / tekrarlanan (dizi) başlık → 401', () => {
    expect(dene({ 'x-ops-token': 'yanlis' }).kod).toBe(401);
    expect(dene({}).kod).toBe(401);
    expect(dene({ 'x-ops-token': `${JETON}x` }).kod).toBe(401);
    expect(dene({ 'x-ops-token': [JETON, JETON] }).kod).toBe(401);
  });

  it('env tanımsız → 503 (uç kapalı); özel kapalı mesajı korunur', () => {
    delete process.env.OPS_SUMMARY_TOKEN;
    expect(dene({ 'x-ops-token': JETON })).toMatchObject({ gecti: false, kod: 503, govde: { error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' } });
    expect(dene({ 'x-ops-token': JETON }, {}, 'ops summary kapalı — X').govde).toEqual({ error: 'ops summary kapalı — X' });
  });
});

// DEĞİŞMEZ: kapı beş uçta elle kopyalanmış ve kopyalar ayrışmıştı (dördü ?token= kabul ediyordu). Artık tek kaynak.
// Yorumlar süzülerek aranır — belge metnindeki "X-Ops-Token" / "?token=" sahte eşleşme vermesin.
const yorumsuz = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
function tsDosyalari(kok: string): string[] {
  return readdirSync(kok).flatMap(ad => {
    const yol = join(kok, ad);
    if (statSync(yol).isDirectory()) return tsDosyalari(yol);
    return /\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad) ? [yol] : [];
  });
}

describe('değişmez: ops jeton kapısı tek kaynak', () => {
  const kaynaklar = tsDosyalari(join(__dirname)).map(yol => ({ yol, kod: yorumsuz(readFileSync(yol, 'utf8')) }));

  it('x-ops-token başlığını YALNIZ opsJeton.ts okur', () => {
    const okuyan = kaynaklar.filter(k => /['"`]x-ops-token['"`]/i.test(k.kod)).map(k => k.yol.split('/src/server/')[1]);
    expect(okuyan).toEqual(['opsJeton.ts']);
  });

  it('src/server içinde hiçbir kod jetonu sorgu dizesinden okumaz', () => {
    const okuyan = kaynaklar.filter(k => /query(\?\.|\.|\[['"])token/.test(k.kod)).map(k => k.yol.split('/src/server/')[1]);
    expect(okuyan).toEqual([]);
  });

  it('OPS_SUMMARY_TOKEN\'ı yalnız opsJeton.ts (kapı) ve opsRoutes.ts (açılış biçim uyarısı) okur — düz !== ile yazılmış kopya kapı da yakalanır', () => {
    const okuyan = kaynaklar.filter(k => /OPS_SUMMARY_TOKEN/.test(k.kod)).map(k => k.yol.split('/src/server/')[1]).sort();
    expect(okuyan).toEqual(['opsJeton.ts', 'routes/opsRoutes.ts']);
    const ops = kaynaklar.find(k => k.yol.endsWith('/routes/opsRoutes.ts'));
    expect((ops?.kod.match(/process\.env\.OPS_SUMMARY_TOKEN/g) ?? []).length).toBe(1);        // yalnız açılış uyarısı
  });

  it('OPS_SUMMARY_TOKEN ile karşılaştırma yapan kopya kapı yok (yalnız opsJeton + açılış uyarısı)', () => {
    const karsilastiran = kaynaklar.filter(k => /OPS_SUMMARY_TOKEN[\s\S]{0,400}timingSafeEqual/.test(k.kod)).map(k => k.yol.split('/src/server/')[1]);
    expect(karsilastiran).toEqual(['opsJeton.ts']);
  });
});
