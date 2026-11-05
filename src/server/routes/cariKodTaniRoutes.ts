/**
 * cariKodTaniRoutes.ts: `GET /api/ops/cari-kod-tani` (şartname «Mikro bağlantı B» B3-a § 5.4 + BH9 / BH11 / BH19.4; 05.11.2026).
 * Ops jetonu (`X-Ops-Token`, `opsJetonuGecerli`); kiracı = Mikro işlerinin kiracısı (`cronKiracisi`, stok kodu göçü kuru koşusuyla
 * aynı kural). SALT OKUMA: PG'den SELECT, Mikro'dan iki okuma (`SELECT cari_kod FROM CARI_HESAPLAR`, cron ile aynı `CariListesiV2`).
 * Hiçbir yere yazmaz; denetim satırı yok. Çekirdek saf modülde (`mikro/cariKodTani`); yanıtta unvan / VKN yok.
 *
 * NEDEN AYRI MODÜL (şartnamedeki «opsRoutes.ts» yerine; en küçük sapma): Dilim D'nin uygulama turu `mikroRoutes.ts` / `opsRoutes.ts`
 * üstünde paralel sürüyor; `stokKodGocuRoutes` deseni (server.ts'te `opsRoutes`'tan hemen sonra kaydedilir). GET, gövdesiz.
 */
import type { Express, Request, Response } from 'express';
import { opsJetonuGecerli } from '../opsJeton.js';
import { cronKiracisi } from '../kiraciOrtami.js';
import { getMikroCreds, mikroSql } from '../mikroClient.js';
import { mikroListeTumu } from '../mikro/listeSayfalari.js';
import { CARI_LISTESI_GOVDESI } from '../mikro/eslemeCari.js';
import { cariKodTanisi } from '../mikro/cariKodTani.js';
import { MUSTERI_HESAP_KOLEKSIYONU } from '../musteriHesap.js';

export interface CariKodTaniHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface CariKodTaniRouteCtx { getPgPool: () => CariKodTaniHavuzu | null }

/** Canlı kod kümesinin sorgusu (BH9: tablo / kolon kodda kanıtlı: mikroMirror.ts `CARI_HESAPLAR` → `cari_kod`). */
export const CANLI_KOD_SORGUSU = 'SELECT cari_kod FROM CARI_HESAPLAR';
/** Kiracı + etiketsiz eski kayıt (`tenantSnap` paritesi); çekirdek ayrıca süzer. */
const KIRACI_KOSULU = "(data->>'companyId' = $1 OR NOT (data ? 'companyId'))";

export function cariKodTaniRoutes(app: Express, C: CariKodTaniRouteCtx): void {
  let kosuyor = false;
  app.get('/api/ops/cari-kod-tani', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const havuz = C.getPgPool();
    if (!havuz) { res.status(503).json({ success: false, error: 'pg havuzu yok (lokal Firestore fallback)' }); return; }
    if (kosuyor) { res.status(409).json({ success: false, error: 'Bir ölçüm zaten sürüyor; bitince yeniden deneyin.' }); return; }
    kosuyor = true;
    try {
      let companyId = process.env.MIKRO_CRON_COMPANY_ID || '';
      if (!companyId) {
        const { rows } = await havuz.query("SELECT id, data->'role' AS role, data->'companyId' AS cid FROM docs WHERE coll = 'users'");
        companyId = cronKiracisi(process.env, rows.map(r => ({ id: String(r.id), veri: { role: r.role, companyId: r.cid } })));
      }
      if (!companyId) { res.status(503).json({ success: false, error: 'Mikro işlerinin kiracısı çözülemedi (MIKRO_CRON_COMPANY_ID yok, kiracı birden çok).' }); return; }
      const [leads, siparisler, hesaplar, ayna] = await Promise.all([
        havuz.query(`SELECT id, data FROM docs WHERE coll = 'leads' AND ${KIRACI_KOSULU}`, [companyId]),
        havuz.query(`SELECT id, data->>'source' AS source, data->>'mikroCariKod' AS kod, data->>'leadId' AS "leadId", data->>'companyId' AS cid FROM docs WHERE coll = 'orders' AND ${KIRACI_KOSULU}`, [companyId]),
        havuz.query(`SELECT data->>'leadId' AS "leadId", data->>'cariKod' AS "cariKod", data->>'companyId' AS cid FROM docs WHERE coll = $1`, [MUSTERI_HESAP_KOLEKSIYONU]),
        havuz.query('SELECT cari_kod, cari_vdaire_no FROM mikro_cari_hesaplar'),
      ]);
      // Mikro okumaları: kimlik yoksa ikisi de «okunamadı» (BH9 dalı kapalı, kuru koşu atlanır); ölçünün geri kalanı yine döner.
      const kimlik = await getMikroCreds();
      const canli = kimlik ? await mikroSql(CANLI_KOD_SORGUSU) : null;
      const liste = kimlik ? await mikroListeTumu('CariListesiV2', 'CariListesi', { ...CARI_LISTESI_GOVDESI }) : null;
      const tani = cariKodTanisi({
        companyId,
        leads: leads.rows.map(r => ({ id: String(r.id), data: (r.data ?? {}) as Record<string, unknown> })),
        ayna: ayna.rows.map(r => ({ kod: r.cari_kod, vkn: r.cari_vdaire_no })),
        canliKodlar: canli && !canli.hata && canli.rows.length > 0 ? canli.rows.map(r => String(r.cari_kod ?? '')) : null,
        cariler: liste && liste.tamam && liste.satirlar.length > 0 ? liste.satirlar : null,
        musteriHesaplari: hesaplar.rows.map(r => ({ leadId: r.leadId, cariKod: r.cariKod, companyId: r.cid })),
        siparisler: siparisler.rows.map(r => ({ id: String(r.id), source: r.source, mikroCariKod: r.kod, leadId: r.leadId, companyId: r.cid })),
      });
      res.json({
        success: true, kiraci: companyId, ...tani,
        kaynak: {
          canliKume: canli === null ? 'kimlik yok' : canli.hata ? `okunamadı: ${canli.hata}` : canli.rows.length === 0 ? 'boş' : `${canli.rows.length} satır`,
          cariListesi: liste === null ? 'kimlik yok' : !liste.tamam ? `eksik (${liste.satirlar.length} satır)` : `${liste.satirlar.length} satır`,
        },
      });
    } catch (e) {
      console.error('[/api/ops/cari-kod-tani]', e instanceof Error ? e.message : String(e));
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Ölçüm yapılamadı. Ayrıntı sunucu günlüğünde.' });
    } finally {
      kosuyor = false;
    }
  });
}
