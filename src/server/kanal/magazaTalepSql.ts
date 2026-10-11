/**
 * magazaTalepSql.ts — mağaza talebinin EKLEME sorgusu (dilim 1 metni; dilim 2b'de `routes/magazaRoutes.ts`'ten taşındı, § 10.2).
 *
 * İki yazıcı AYNI sabiti kullanır — ikinci bir `INSERT` metni yazılmaz:
 *   • kimliksiz mağaza ucu `POST /api/magaza/siparis-talebi` (`routes/magazaRoutes.ts`),
 *   • ERP'de elle açılan talep `elleTalepAc` (`kanal/magazaIcerik.ts`).
 * Yaprak modül: hiçbir şey içe aktarmaz (rota zinciri ve yazma yolu döngüsüz okur).
 */

/** Çakışmada mevcut kayda DOKUNULMAZ; `RETURNING` yalnız GERÇEKTEN eklenen satırı döndürür. */
export const EKLEME_SQL = 'INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING RETURNING id';
