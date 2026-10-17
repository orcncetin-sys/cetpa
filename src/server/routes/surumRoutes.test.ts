// @vitest-environment node
/**
 * surumRoutes.test.ts — T2: `GET /api/surum` GERÇEK express ile (şartname `.wf/SARTNAME-yeni-surum-bildirimi.md` S2).
 * Kimliksiz 200 `{ surum }`, `Cache-Control: no-store`, gövdede başka alan yok; `surum.json` yoksa / bozuksa `{ surum: null }`.
 * Ucun server.ts'te genel sınırlayıcıdan ÖNCE, kendi kovasıyla bağlı olduğu gerçek zincirde: src/server/surum.zincir.test.ts.
 *
 * T4 (mutasyon): `no-store` silinirse «önbelleksiz» sınaması kırmızıya döner.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surumDosyasiniOku, surumRoutes } from './surumRoutes';
import { SURUM_DOSYASI, SURUM_UCU } from '../../lib/surumKimligi';

const KIMLIK = '0123456789abcdef';
let dizin = '';
let dosya = '';
let srv: http.Server | undefined;
let kapi = 0;

beforeAll(async () => {
  dizin = mkdtempSync(join(tmpdir(), 'surum-ucu-'));
  dosya = join(dizin, SURUM_DOSYASI);
  ({ srv, kapi } = await kur(1000));
});
/** Ucu kendi kovasıyla gerçek express'e bağlar (server.ts düzeni: sınırlayıcı → işleyici). */
async function kur(tavan: number): Promise<{ srv: http.Server; kapi: number }> {
  const app = express();
  surumRoutes(app, { surumLimiter: rateLimit({ windowMs: 60_000, max: tavan, standardHeaders: true, legacyHeaders: false }), surumDosyasi: dosya });
  const s = app.listen(0);
  await new Promise<void>(r => s.once('listening', () => r()));
  return { srv: s, kapi: (s.address() as AddressInfo).port };
}
afterAll(async () => {
  const s = srv;
  if (s) await new Promise<void>(r => s.close(() => r()));
  rmSync(dizin, { recursive: true, force: true });
});
afterEach(() => { rmSync(dosya, { force: true }); });

interface Yanit { kod: number; basliklar: http.IncomingHttpHeaders; govde: string }
function iste(basliklar: Record<string, string> = {}, hedefKapi = kapi): Promise<Yanit> {
  return new Promise((coz, reddet) => {
    const q = http.request({ host: '127.0.0.1', port: hedefKapi, path: SURUM_UCU, method: 'GET', agent: false, headers: basliklar }, r => {
      const kod = r.statusCode;
      if (kod === undefined) { reddet(new Error('durum kodu yok')); return; }
      const parcalar: Buffer[] = [];
      r.on('data', (p: Buffer) => parcalar.push(p));
      r.on('end', () => coz({ kod, basliklar: r.headers, govde: Buffer.concat(parcalar).toString('utf8') }));
    });
    q.on('error', reddet);
    q.end();
  });
}

describe('T2 — GET /api/surum', () => {
  it('kimliksiz 200 `{ surum }`; `Cache-Control: no-store`; gövdede başka alan YOK (dosyadaki fazla alanlar sızmaz)', async () => {
    writeFileSync(dosya, JSON.stringify({ surum: KIMLIK, commit: 'gizli', ortam: { SIR: 'x' } }));
    const r = await iste();
    expect(r.kod).toBe(200);
    expect(r.basliklar['cache-control']).toBe('no-store');          // T4: `no-store` silinirse kırmızı
    expect(r.basliklar['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(r.govde)).toEqual({ surum: KIMLIK });
    expect(Object.keys(JSON.parse(r.govde))).toEqual(['surum']);
  });

  it('surum.json YOK → `{ surum: null }` (istemci bildirim göstermez), yine no-store', async () => {
    const r = await iste();
    expect(r.kod).toBe(200);
    expect(r.basliklar['cache-control']).toBe('no-store');
    expect(JSON.parse(r.govde)).toEqual({ surum: null });
  });

  it('dosya HER istekte okunur: yeni derleme sunucu yeniden başlamadan da görünür', async () => {
    writeFileSync(dosya, JSON.stringify({ surum: KIMLIK }));
    expect(JSON.parse((await iste()).govde)).toEqual({ surum: KIMLIK });
    writeFileSync(dosya, JSON.stringify({ surum: 'fedcba9876543210' }));
    expect(JSON.parse((await iste()).govde)).toEqual({ surum: 'fedcba9876543210' });
  });

  it('kendi sınırlayıcısı zincirde: tavan aşılınca 429 (sınırlayıcı zincirde değilse 200 dönerdi)', async () => {
    const ayri = await kur(2);
    try {
      expect((await iste({}, ayri.kapi)).kod).toBe(200);
      expect((await iste({}, ayri.kapi)).kod).toBe(200);
      expect((await iste({}, ayri.kapi)).kod).toBe(429);
    } finally {
      await new Promise<void>(r => ayri.srv.close(() => r()));
    }
  });
});

describe('dosya okuma: bozuk / biçim dışı → null (hata fırlatmaz)', () => {
  it.each([
    ['bozuk JSON', '{"surum":'],
    ['dizi', '["0123456789abcdef"]'],
    ['biçim dışı kimlik', '{"surum":"../../etc/passwd"}'],
    ['büyük harf', '{"surum":"0123456789ABCDEF"}'],
    ['sayı', '{"surum":1234567890123456}'],
    ['boş', ''],
  ])('%s → null', async (_ad, icerik) => {
    writeFileSync(dosya, icerik);
    await expect(surumDosyasiniOku(dosya)).resolves.toBeNull();
  });
  it('geçerli → kimlik', async () => {
    writeFileSync(dosya, `${JSON.stringify({ surum: KIMLIK })}\n`);
    await expect(surumDosyasiniOku(dosya)).resolves.toBe(KIMLIK);
  });
});
