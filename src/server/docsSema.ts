/**
 * docsSema.ts — `docs` tablosunun DDL'i (TEK kaynak; 2026-10-09, mağaza dilim 2a V10).
 *
 * server.ts `initDocsTable` buradan okur; gerçek motor testleri (`@electric-sql/pglite`, PostgreSQL WASM) AYNI sabiti kurar —
 * DDL kopyalanmaz, test tablosu canlı tabloyla ayrışamaz (tablo + üç indeks PGlite'ta aynen koştu — kapı 2 `sql.mjs`).
 *
 * Tek genel `docs` tablosu: (coll, id, data jsonb). React istemcisi /api/db/… rotalarıyla `src/lib/dbClient.ts` üzerinden
 * konuşur (Firestore API'sini taklit eder). Gerçek zamanlı yayın süreç içi (tek sunucu) `EventEmitter` ile `/api/db/stream`.
 */

export const DOCS_TABLOSU_DDL = `CREATE TABLE IF NOT EXISTS docs (
    coll text NOT NULL,
    id   text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (coll, id)
  )`;

/**
 * Kiracı filtresi indeksleri. PK (coll,id) yalnız koleksiyon önekini kapsar;
 * tenantWhere'in `data->>'companyId' = $2 OR NOT (data ? 'companyId')`
 * yüklemi indekssiz kalınca koleksiyonun TÜM satırları taranır. İki indeks
 * gerekli çünkü OR'un iki kolu farklı: eşitlik kolu ifade indeksinden,
 * "etiketsiz" kolu kısmi indeksten gelir (BitmapOr). Kısmi indeks backfill
 * sonrası neredeyse boş kalır — maliyeti yok denecek kadar az.
 * Hata boot'u DÜŞÜRMEZ: indeks bir optimizasyon, doğruluk koşulu değil.
 */
export const DOCS_INDEKS_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_docs_coll_company ON docs (coll, (data->>'companyId'))`,
  `CREATE INDEX IF NOT EXISTS idx_docs_coll_untagged ON docs (coll) WHERE NOT (data ? 'companyId')`,
  `CREATE INDEX IF NOT EXISTS idx_docs_coll_user ON docs (coll, (data->>'userId'))`,
  // SİPARİŞ TAKİP KODU (2026-10-19, şartname «takip kodu + LUCA reddi» TA): kod KÜRESEL tekil (kimliksiz takip ucu kiracı
  // ayırmadan kodla okur) ve kodla arama bu dizinden gelir (server/takipKodu `TAKIP_KODU_ARA_SQL` dizinin yüklemini yazar).
  // Kısmi: yalnız kodu olan sipariş satırları — dizin küçük kalır. Kurulamazsa boot düşmez (yukarıdaki not): tekillik o zaman
  // ~131 bitlik rastgeleliğe kalır; çakışma yeniden denemesi (23505) yalnız dizin varken tetiklenir.
  `CREATE UNIQUE INDEX IF NOT EXISTS docs_orders_takip_kodu ON docs ((data->>'takipKodu')) WHERE coll = 'orders' AND data ? 'takipKodu'`,
] as const;
