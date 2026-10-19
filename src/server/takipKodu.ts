/**
 * takipKodu.ts (sunucu) — siparişin tahmin edilemez takip kodunu ÜRETİR, ALIR ve kodla siparişi BULUR (şartname
 * `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` T1 / T2 / TA / TB / TC / TF; 2026-10-19). Biçim: lib/takipKodu.
 *
 * TEK ORTAK İŞLEV `takipKoduAlVeyaUret`: kod alma ucu (`POST /api/siparis/:orderId/takip-kodu`, server.ts) ve sipariş durum
 * e-postası (`/api/email/order-notification`, routes/epostaRoutes) ikisi de bunu çağırır — kopya üretici yok. Kapı (rol, kiracı,
 * `siparisGorebilir`, mağaza siparişi) ÇAĞIRANDADIR; buradaki SQL kiracı koşulunu ayrıca taşır (yabancı kiracının satırına kod
 * YAZILMAZ ve okunmaz).
 *
 * NEDEN DOĞRUDAN SQL: pgShim `set(merge)` / `update` OKU-DEĞİŞTİR-YAZ'dır; iki eşzamanlı istek «kod yok» satırını okuyup iki
 * AYRI kod yazardı (önceki bağlantı ölür). Yazım TEK koşullu `UPDATE … WHERE NOT (data ? 'takipKodu') RETURNING data`: iki
 * istekten biri satırı alır, öteki 0 satır görür, yeniden okur ve AYNI kodu döner. Kod küresel tekildir (docsSema tekil kısmi
 * dizini): çakışma (23505) olursa YENİ kodla BİR kez yeniden denenir. Denetim satırı YAZILMAZ (gizli değer denetim kaydına
 * düşmesin). Yazımdan sonra yayın RETURNING verisiyle (`broadcastDocChange('orders', 'set', …)` — mevcut sipariş yazım kalıbı,
 * server/mikro/faturaGonderimi).
 *
 * Kodla arama da doğrudan SQL'dir: pgShim `where()` koleksiyonun TAMAMINI belleğe çeker (kimliksiz uçta yük).
 */
import { randomInt } from 'node:crypto';
import { TAKIP_KODU_ALANI, TAKIP_KODU_ALFABESI, TAKIP_KODU_UZUNLUK, takipKoduMu } from '../lib/takipKodu.js';
import { MAGAZA_KAYNAGI } from '../lib/magazaKaynagi.js';
import { broadcastDocChange, pgReviveTimestamps } from './pgShim.js';

/** Bu modülün kullandığı havuz yüzeyi (`pg.Pool` alt kümesi; sınamada PGlite). */
export interface TakipHavuzu {
  query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

if (!/^[A-Za-z0-9_]+$/.test(TAKIP_KODU_ALANI)) throw new Error('TAKIP_KODU_ALANI SQL\'e gömülemez');
const A = TAKIP_KODU_ALANI;
/** Çağıranın kiracısı YA DA etiketsiz (alan yok / JSON `null` / boş dize — `siparisGorebilir` ve `companyId || ''` kalıbı). */
const KIRACI = `(data->>'companyId' = $2 OR coalesce(data->>'companyId', '') = '')`;

/**
 * Koşullu yazım: kod YOKSA yazılır. $1 sipariş kimliği, $2 kiracı, $3 yeni kod, $4 mağaza kaynağı (mağaza siparişine kod
 * yazılmaz — çağıran zaten 400 döner; burada ikinci çit).
 */
export const TAKIP_KODU_YAZ_SQL = `UPDATE docs SET data = data || jsonb_build_object('${A}', $3::text), updated_at = now()
 WHERE coll = 'orders' AND id = $1 AND ${KIRACI}
   AND NOT (data ? '${A}') AND coalesce(data->>'source', '') <> $4::text
 RETURNING data`;

/** 0 satırdan sonra AYNI kiracı tanımıyla yeniden okuma (var olan kod). $1 sipariş kimliği, $2 kiracı. */
export const TAKIP_KODU_OKU_SQL = `SELECT data->>'${A}' AS kod FROM docs WHERE coll = 'orders' AND id = $1 AND ${KIRACI}`;

/**
 * Kodla sipariş (TC (1)). `data ? …` koşulu tekil kısmi dizinin yüklemiyle aynıdır — planlayıcı dizini ancak bu koşul
 * sorguda YAZILIYSA kullanabilir (`data->>… = $1`'den çıkaramaz). $1 kod.
 */
export const TAKIP_KODU_ARA_SQL = `SELECT id, data FROM docs WHERE coll = 'orders' AND data ? '${A}' AND data->>'${A}' = $1 LIMIT 1`;

/** Yeni kod: `crypto.randomInt` ile alfabeden sapmasız seçim (TA). */
export function takipKoduUret(): string {
  let s = '';
  for (let i = 0; i < TAKIP_KODU_UZUNLUK; i++) s += TAKIP_KODU_ALFABESI[randomInt(TAKIP_KODU_ALFABESI.length)];
  return s;
}

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const benzersizlikIhlali = (e: unknown): boolean => nesneMi(e) && e.code === '23505';

/**
 * Siparişin takip kodu: varsa o, yoksa yeni kod yazılıp o döner. `null` = sipariş yok, yabancı kiracının ya da mağaza siparişi
 * (çağıran «bulunamadı» der). İki eşzamanlı çağrı AYNI kodu alır. Kayıtlı değer biçimsizse FIRLATIR (sessizce ezilmez).
 * `uret` yalnız sınamalar için (çakışma yeniden denemesi).
 */
export async function takipKoduAlVeyaUret(
  havuz: TakipHavuzu, cid: string, orderId: string, uret: () => string = takipKoduUret,
): Promise<string | null> {
  for (let deneme = 1; ; deneme++) {
    const kod = uret();
    let satirlar: Array<Record<string, unknown>>;
    try {
      satirlar = (await havuz.query(TAKIP_KODU_YAZ_SQL, [orderId, cid, kod, MAGAZA_KAYNAGI])).rows;
    } catch (e) {
      // Küresel tekil dizin: üretilen kod başka bir siparişte var (olasılık ~2^-131). YENİ kodla bir kez daha.
      if (benzersizlikIhlali(e) && deneme === 1) continue;
      throw e;
    }
    const data = satirlar[0]?.data;
    if (nesneMi(data)) {
      broadcastDocChange('orders', 'set', orderId, data);
      return kod;
    }
    // 0 satır: kod zaten var (önceki ya da eşzamanlı çağrı) — ya da sipariş yok / yabancı kiracı / mağaza siparişi.
    const okunan = (await havuz.query(TAKIP_KODU_OKU_SQL, [orderId, cid])).rows[0];
    if (!okunan || okunan.kod === null || okunan.kod === undefined) return null;
    if (!takipKoduMu(okunan.kod)) throw new Error(`orders/${orderId}: kayıtlı takip kodu biçimsiz`);
    return okunan.kod;
  }
}

/** Kodla sipariş (yalnız biçime uyan parametre için çağrılır — çağıran `takipKoduMu` ile süzer). Zaman damgaları pgShim
 *  okumasıyla aynı biçime döner (`toDate`). Yoksa `null`. */
export async function takipKoduylaSiparis(havuz: TakipHavuzu, kod: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const satir = (await havuz.query(TAKIP_KODU_ARA_SQL, [kod])).rows[0];
  if (!satir || typeof satir.id !== 'string' || !nesneMi(satir.data)) return null;
  return { id: satir.id, data: pgReviveTimestamps(satir.data) as Record<string, unknown> };
}
