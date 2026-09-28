/**
 * opsJeton.ts — OPS_SUMMARY_TOKEN korumalı tanı/operasyon uçlarının ORTAK kapısı (2026-09-28).
 *
 * NEDEN VAR: kapı beş ayrı uçta elle kopyalanmıştı (mikroRoutes: sema-kesif, ebelge-tani + yeni tanı uçlarının yerel
 * yardımcısı; opsRoutes: summary, disk-test, yayinla) ve kopyalar AYRIŞMIŞTI — dördü jetonu `?token=` sorgu dizesinden de
 * kabul ediyordu. Sorgu dizesindeki jeton IIS/nginx erişim günlüklerine, tarayıcı geçmişine ve Referer başlığına düşer.
 * Tek kural: jeton YALNIZ `X-Ops-Token` başlığında; karşılaştırma sabit zamanlı (timingSafeEqual).
 *
 * Bağımlılık ölçümü (2026-09-28): `?token=` kullanan çağıran YOK — scripts/ops-istek.sh başlık gönderir; günlük 09:00 bulut
 * rutini (trig_01S9…) artık mevcut değil (RemoteTrigger 404); kalan bulut rutinleri bu uçları çağırmıyor.
 */
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

/** Jeton geçerliyse true. Değilse yanıtı KENDİSİ yazar ve false döner: env tanımsız 503 (uç kapalı), yanlış/eksik 401. */
export function opsJetonuGecerli(req: Request, res: Response, kapaliMesaji = 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil'): boolean {
  const beklenen = process.env.OPS_SUMMARY_TOKEN || '';
  if (!beklenen) { res.status(503).json({ error: kapaliMesaji }); return false; }
  const baslik = req.headers['x-ops-token'];
  const gelen = typeof baslik === 'string' ? baslik : '';          // tekrarlanan başlık (dizi) kabul edilmez
  const a = Buffer.from(gelen), b = Buffer.from(beklenen);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: 'unauthorized' }); return false; }
  return true;
}
