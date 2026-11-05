/**
 * bankaKasaBakiye.ts: banka (`bankAccounts`) ve kasa (`kasalar`) bakiyesinin Mikro tarafı (şartname `.wf/SARTNAME-mikro-baglanti-b.md`
 * B1, «Kapı sonrası hükümler» BH2 · BH3–BH7 · BH17 · BH20; 05.11.2026). Kullanıcı kararı: bakiye «Mikro'dan, her gece»; Mikro'ya
 * banka / kasa açılış fişini kullanıcı girecek.
 *
 * BU DOSYADA (B1-a, ilk yayın) İKİ ŞEY VAR, BAKİYE HESABI YOK:
 *   1. Ö-B1 ölçü sorguları (`OB1_SORGULARI`): `GET /api/mikro/sema-kesif`'in sabit listesine eklenir (salt okuma, yalnız toplam ve
 *      kod). Kuralın sabitleri (karşı hesap türü, işaret beyaz listesi, doğrulanan hesap kodları, döviz kapısı) bu ölçü canlıda
 *      alındıktan ve kullanıcı açılış fişini girdikten SONRA (B1-b) bu dosyaya eklenir. O zamana kadar hiçbir hesaba sayı yazılmaz.
 *   2. Gece adımının ilk bölümü: canlıdaki SAHTE ₺0'ın bilinmeyene (`null`) çekilmesi (§ 3.5 geçişi). Ölçüden bağımsızdır; ekranlar
 *      `null`'ı «—» basar (Dilim A). Canlı beklenen: 3 banka + 8 kasa belgesi.
 *
 * GEÇİŞ KURALLARI (doğrudan SQL; pgShim `set(merge)` / `update` türetilen alanları satırdaki değerle korur, BH20):
 *   • kiracıya bağlı (BH7): `data->>'companyId' = $1`; etiketsiz Mikro belgesi beklenmez, varsa sayısı özette;
 *   • yalnız `source = 'mikro'` ve değeri TAM `0` olan, `bakiyeZamani` taşımayan belge (idempotent: ikinci koşuda 0 satır;
 *     gece hesabının yazdığı değer bir daha null'a çekilmez);
 *   • elle girilmiş 0 olmayan değer KORUNUR (BH2): sayısı, id'si, hesap kodu ve değeri özette «elle girilmiş değer korundu: N»;
 *   • her değişen satır RETURNING'den yayınlanır (BH7 SENTEZ-2 eki): açık oturum yenilemeden «—» görür;
 *   • geri alma: değişen id'ler özette; önceki değerlerin hepsi 0'dı, geri alma aynı id'lere 0 yazmaktır.
 * İki koleksiyonun UPDATE'i ayrı deyimdir (işlem yok): biri düşerse öteki yazılmış kalır, adım başarısız satır yazar ve sonraki
 * gece kalan kısmı yapar (idempotent). Mikro'ya hiçbir istek YOK.
 *
 * Saf olmayan tek bağımlılık `havuz` (PG) ve `yayinla`; Express / adminDb / Mikro istemcisi içe aktarılmaz.
 */
import { BAKIYE_TURETILEN_ALANLAR } from '../../lib/collections.js';

// ── 1. Ö-B1 ölçü sorguları (sema-kesif) ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Kolon adı TAHMİN EDİLMEZ: aşağıdaki `cha_*` adlarının her biri depoda zaten geçer (kanıt dosyaları çitte:
 * `bankaKasaBakiye.test.ts` T-B1-8) ya da canlı INFORMATION_SCHEMA çıktısında ölçüldü (`SEMA_OLCUMU_KANITI`). `BANKALAR` /
 * `KASALAR` kod ve döviz kolonları bu turda yalnız INFORMATION_SCHEMA'dan okunur; ikinci tur (`cha_kasa_hizkod IN (SELECT <kod>
 * FROM BANKALAR)`) kolon adı ölçüldükten sonra yazılır (§ 3.2).
 */
export const SEMA_OLCUMU_KANITI: Readonly<Record<string, string>> = {
  // `GET /api/mikro/sema-kesif` → `chaKolonlari` (INFORMATION_SCHEMA.COLUMNS, CARI_HESAP_HAREKETLERI; 186 kolon), 05.11.2026 17:48 TR.
  // Anlamı (karşı hesabın döviz cinsi mi) ölçülmedi: kural yazılmadan önce `chaKarsiHesapDagilimi` dağılımıyla doğrulanır (BH5).
  cha_karsidcinsi: 'INFORMATION_SCHEMA chaKolonlari (sema-kesif, 05.11.2026)',
};

/** Ö-B1 sorguları: hepsi SELECT, tek deyim, ASCII; yalnız toplam, sayı, tarih ve banka / kasa / hizmet kodu döner (müşteri verisi yok). */
export const OB1_SORGULARI: ReadonlyArray<{ ad: string; sql: string }> = [
  // Kod ve döviz kolonunun ADI (BH5 hesap kapısı; import `findKey` ile çalışma anında arıyor, ad hiç ölçülmedi).
  { ad: 'bankaKasaKolonlari',
    sql: 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ' +
         "WHERE TABLE_NAME IN ('BANKALAR', 'KASALAR') ORDER BY TABLE_NAME, ORDINAL_POSITION" },
  // Ayrı banka / kasa hareket tablosu adayı (sabitKiymetTabloAdaylari deseni).
  { ad: 'bankaKasaTabloAdaylari',
    sql: 'SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi ' +
         "FROM INFORMATION_SCHEMA.TABLES t WHERE t.TABLE_NAME LIKE '%BANKA%' OR t.TABLE_NAME LIKE '%KASA%' ORDER BY TABLE_NAME" },
  // Banka ve kasa satırları hangi alanda duruyor; açılış / devir adayı (BH4: MIN tarih), döviz (BH5), evrak üçlüsü (BH3).
  { ad: 'chaKarsiHesapDagilimi',
    sql: 'SELECT cha_cari_cins, cha_kasa_hizmet, cha_d_cins, cha_karsidcinsi, cha_evrak_tip, cha_cinsi, cha_normal_Iade, cha_tip, ' +
         'COUNT(*) AS adet, SUM(cha_meblag) AS toplam, MIN(cha_tarihi) AS ilkTarih, MAX(cha_tarihi) AS sonTarih ' +
         'FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 ' +
         'GROUP BY cha_cari_cins, cha_kasa_hizmet, cha_d_cins, cha_karsidcinsi, cha_evrak_tip, cha_cinsi, cha_normal_Iade, cha_tip ' +
         'ORDER BY cha_cari_cins, cha_kasa_hizmet, cha_evrak_tip, cha_cinsi, cha_tip' },
  // Karşı hesap kodları (banka / kasa / hizmet kodu; müşteri verisi değil) × evrak üçlüsü × yön × döviz; hesap başına ilk tarih (BH4).
  { ad: 'chaKasaHizkodDagilimi',
    sql: 'SELECT cha_kasa_hizmet, cha_kasa_hizkod, cha_evrak_tip, cha_cinsi, cha_normal_Iade, cha_tip, cha_d_cins, cha_karsidcinsi, ' +
         'COUNT(*) AS adet, SUM(cha_meblag) AS toplam, MIN(cha_tarihi) AS ilkTarih, MAX(cha_tarihi) AS sonTarih ' +
         "FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND ISNULL(cha_kasa_hizkod, '') <> '' " +
         'GROUP BY cha_kasa_hizmet, cha_kasa_hizkod, cha_evrak_tip, cha_cinsi, cha_normal_Iade, cha_tip, cha_d_cins, cha_karsidcinsi ' +
         'ORDER BY cha_kasa_hizmet, cha_kasa_hizkod, cha_evrak_tip, cha_cinsi, cha_tip' },
  // Banka ya da kasanın KENDİSİNİN `cha_kod` olduğu satırlar (cari dışı cins; § 3.3 ikinci madde).
  { ad: 'chaCariDisiKodlar',
    sql: 'SELECT cha_cari_cins, cha_kod, cha_evrak_tip, cha_cinsi, cha_tip, cha_d_cins, ' +
         'COUNT(*) AS adet, SUM(cha_meblag) AS toplam, MIN(cha_tarihi) AS ilkTarih ' +
         'FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND ISNULL(cha_cari_cins, 0) <> 0 ' +
         'GROUP BY cha_cari_cins, cha_kod, cha_evrak_tip, cha_cinsi, cha_tip, cha_d_cins ORDER BY cha_cari_cins, cha_kod' },
  // Karşı hesap türü dolu ama kodu boş satırlar (BH6): satır hangi hesaba ait bilinmez → o türde yazım durur. Banka türünün değeri
  // bilinmediği için koşul `<> 0`.
  { ad: 'chaKodsuzKarsiHesap',
    sql: 'SELECT cha_kasa_hizmet, cha_evrak_tip, cha_cinsi, COUNT(*) AS adet, SUM(cha_meblag) AS toplam ' +
         "FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 AND ISNULL(cha_kasa_hizmet, 0) <> 0 AND ISNULL(cha_kasa_hizkod, '') = '' " +
         'GROUP BY cha_kasa_hizmet, cha_evrak_tip, cha_cinsi ORDER BY cha_kasa_hizmet, cha_evrak_tip, cha_cinsi' },
];

// ── 2. Gece adımı: sahte ₺0 → null geçişi ───────────────────────────────────────────────────────────────────────────────────

/** Gece adımının bakım kilidi / yazıcı kaydı adı (BH17) ve syncLog işlem adı. */
export const BANKA_KASA_YAZICI = 'mikro-cron:banka-kasa-bakiye';
export const BANKA_KASA_ISLEM = 'banka-kasa-bakiye';

/** İki hesap türü: koleksiyon, bakiye alanı, özetteki etiket. Adlar SQL'e gömülür (sabit; `[A-Za-z]`). */
export const BANKA_KASA_HESAPLARI = [
  { coll: 'bankAccounts', alan: 'balance', etiket: 'banka' },
  { coll: 'kasalar', alan: 'bakiye', etiket: 'kasa' },
] as const;
type Hesap = (typeof BANKA_KASA_HESAPLARI)[number];

/** Geçiş koşulunun dayandığı işaret: gece hesabının yazdığı belge bunu taşır (istemci yazamaz, BH20). */
const ZAMAN_ALANI: (typeof BAKIYE_TURETILEN_ALANLAR)[number] = 'bakiyeZamani';
const KAYNAK_ALANI: (typeof BAKIYE_TURETILEN_ALANLAR)[number] = 'bakiyeKaynagi';

export interface GecisHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}

/** Sahte ₺0 → null (§ 3.5 + BH7): yalnız bu kiracının Mikro belgesi, değeri tam 0, gece hesabından geçmemiş. */
export const gecisSql = (h: Hesap): string =>
  `UPDATE docs SET data = jsonb_set(data, '{${h.alan}}', 'null'::jsonb), updated_at = now() ` +
  `WHERE coll = '${h.coll}' AND data->>'source' = 'mikro' AND data->>'companyId' = $1 ` +
  `AND data->'${h.alan}' = '0'::jsonb AND NOT (data ? '${ZAMAN_ALANI}') RETURNING id, data`;

/** Elle girilmiş (0 / null olmayan, gece kaynağı taşımayan) değer: dokunulmaz, sayılır (BH2). Salt okuma. */
export const korunanSql = (h: Hesap): string =>
  `SELECT id, data->>'mikroKod' AS kod, data->'${h.alan}' AS deger FROM docs ` +
  `WHERE coll = '${h.coll}' AND data->>'source' = 'mikro' AND data->>'companyId' = $1 ` +
  `AND data->'${h.alan}' IS NOT NULL AND data->'${h.alan}' <> 'null'::jsonb AND data->'${h.alan}' <> '0'::jsonb ` +
  `AND COALESCE(data->>'${KAYNAK_ALANI}', '') <> 'mikro-gece' ORDER BY id`;

/** Kiracı etiketi olmayan Mikro belgesi (beklenmez; geçiş ona dokunmaz, sayısı özette). Salt okuma. */
export const etiketsizSql = (h: Hesap): string =>
  `SELECT count(*)::int AS n FROM docs WHERE coll = '${h.coll}' AND data->>'source' = 'mikro' AND COALESCE(data->>'companyId', '') = ''`;

export interface HesapGecisi {
  etiket: Hesap['etiket'];
  /** null'a çekilen belge kimlikleri (geri alma bunlara 0 yazar). */
  degisen: string[];
  /** Elle girilmiş, korunan değerler (id, Mikro hesap kodu, değer metni). Beklenen boş. */
  korunan: Array<{ id: string; kod: string | null; deger: string }>;
  etiketsiz: number;
}
export type BankaKasaGecisSonucu = { tur: 'havuzYok' } | { tur: 'tamam'; hesaplar: HesapGecisi[] };

/**
 * Geçişi koşar. `havuz` yoksa (lokal Firestore yedeği) hiçbir şey yapmaz. SQL hatası FIRLATIR (çağıran başarısız satır yazar);
 * hata anına kadar yayınlanan satırlar yazılmıştır (deyim başına).
 */
export async function bankaKasaGecisiCalistir(
  havuz: GecisHavuzu | null, companyId: string, yayinla: (coll: string, id: string, data: unknown) => void,
): Promise<BankaKasaGecisSonucu> {
  if (!havuz) return { tur: 'havuzYok' };
  if (!companyId) throw new Error('kiracı yok: geçiş yapılmadı');
  const hesaplar: HesapGecisi[] = [];
  for (const h of BANKA_KASA_HESAPLARI) {
    const korunan = (await havuz.query(korunanSql(h), [companyId])).rows.map(r => ({
      id: String(r.id), kod: typeof r.kod === 'string' && r.kod !== '' ? r.kod : null, deger: JSON.stringify(r.deger),
    }));
    const { rows } = await havuz.query(gecisSql(h), [companyId]);
    const degisen: string[] = [];
    for (const r of rows) {
      const id = String(r.id);
      degisen.push(id);
      yayinla(h.coll, id, r.data);
    }
    const etiketsizSatir = (await havuz.query(etiketsizSql(h))).rows[0];
    const etiketsiz = Number(etiketsizSatir?.n);
    hesaplar.push({ etiket: h.etiket, degisen, korunan, etiketsiz: Number.isFinite(etiketsiz) ? etiketsiz : NaN });
  }
  return { tur: 'tamam', hesaplar };
}

/**
 * syncLog özeti (TEK satır): «0 → null geçişi: 3 banka (a, b, c) · 8 kasa (…) · elle girilmiş değer korundu: 0 · etiketsiz Mikro
 * belgesi: 0 · bakiye hesabı yok (Ö-B1 ölçüsü ve Mikro açılış fişi bekleniyor)». Kimlikler TAM yazılır (geri alma listesi).
 */
export function bankaKasaGecisNotu(hesaplar: readonly HesapGecisi[]): string {
  const degisen = hesaplar.map(h => `${h.degisen.length} ${h.etiket}${h.degisen.length ? ` (${h.degisen.join(', ')})` : ''}`).join(' · ');
  const korunan = hesaplar.flatMap(h => h.korunan.map(k => `${h.etiket} ${k.id}${k.kod ? ` [${k.kod}]` : ''}: ${k.deger}`));
  const etiketsiz = hesaplar.map(h => `${h.etiket} ${Number.isFinite(h.etiketsiz) ? h.etiketsiz : 'okunamadı'}`).join(', ');
  return [
    `0 → null geçişi: ${degisen}`,
    `elle girilmiş değer korundu: ${korunan.length}${korunan.length ? ` (${korunan.join('; ')})` : ''}`,
    `etiketsiz Mikro belgesi: ${etiketsiz}`,
    'bakiye hesabı yok (Ö-B1 ölçüsü ve Mikro açılış fişi bekleniyor)',
  ].join(' · ');
}
