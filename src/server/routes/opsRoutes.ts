/**
 * opsRoutes.ts - Operasyon bekcisi uclari (6 rota): son 14 gunun kontrol sonuclari, elle
 * tetikleme, disk sondasi, modul/calisma-zamani durumu.
 *
 * `runOpsWatchdog` ve `diskNobetcisi` BAGLAMDAN DEGIL IMPORT ile geliyor:
 * ikisi de src/server/opsWatchdog.ts'te ve o modul server.ts'i import
 * ETMEDIGI icin dongu olusmuyor. Baglam yalnizca server.ts'te KALAN
 * seyler icin.
 *
 * server.ts'ten AYRILDI (2026-08-25) - D4 adim 10. Onceki rota gruplariyla
 * AYNI desen: bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL -
 * server.ts bu modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import { runOpsWatchdog, diskNobetcisi } from '../opsWatchdog.js';
import { MIKRO_API_BASE, MIKRO_JUMP_SURUM, MIKRO_LOCAL_MODE, getMikroCreds, mikroSql, stubSayaciOzeti } from '../mikroClient.js';
// Gönderim defteri ölçüm özeti + kip yazıcısı (şartname yeniden-deneme v3 K0b). Modül düzeyi önbellek ve sayaçlar mikroRoutes /
// server.ts ile AYNI yoldan (`.js`) içe aktarılır.
import { gonderimKipiYaz, mikroGonderimOzetiOku } from '../mikro/gonderimDefteri.js';
import { saatTanisi } from '../saatTanisi.js';
import path from 'path';
import fs from 'fs';
import { opsJetonuGecerli } from '../opsJeton.js';
import { auditSirSayimi, ayarOzeti } from '../sirTani.js';
import { kullaniciSayimi } from '../kullaniciSayimi.js';
import { kartFiyatDurumu, stokFiyatOzeti } from '../stokFiyatTani.js';
import { geceOzeti, koleksiyonOlculeri, senkronSatiri } from '../acilisTani.js';
import { broadcastDocChange } from '../pgShim.js';
import { smtpYapilandirmasi } from '../smtpPosta.js';
import { magazaBildirimSayimi, MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN } from '../kanal/magazaBildirimSayim.js';
import { magazaAcikSayimi, type MagazaAcikSayimi } from '../kanal/magazaAcikSayim.js';
// Sayaç okuyucuları server.ts ve bekçiyle AYNI yoldan (`.js`) içe aktarılır: sayaçlar modül düzeyindedir, farklı yoldan
// ikinci bir modül örneği oluşsa bu uç hep sıfır görürdü. İki modül de bu dosyayı / server.ts'i içe aktarmaz (döngü yok).
import { magazaSayaclari, magazaTakipSayaclari } from './magazaRoutes.js';
import { magazaPanelSayaclari } from './magazaPanelZinciri.js';
import express from 'express';

/** /api/ops/acilis-tani: senkron günlüğü LİSTESİNİN satır sınırı (aşılırsa yanıtta `kesildi: true`) ve gün özetinin emniyet sınırı. */
const SENKRON_LISTE_SINIRI = 400;
const SENKRON_OZET_SINIRI = 5000;
/** mikroMirror.ts: yalnız bu üç tablo her koşuda `guncelleme = now()` yazar (ON CONFLICT … DO UPDATE); diğer ayna tabloları
 *  `ON CONFLICT … DO NOTHING` ile yazılır — damgaları son YENİ satırın zamanıdır, son senkronun değil. */
const HER_KOSU_DAMGALI = new Set(['mikro_stoklar', 'mikro_stok_satis_fiyat_listeleri', 'mikro_cari_hesaplar']);

/** `/api/ops/summary` → `magaza` bloğu (dilim 2a): açık talep sayımı + üç süreç içi sayaç kümesi. `null` = okunamadı / havuz yok. */
export interface OpsMagazaOzeti {
  acik: MagazaAcikSayimi | null;
  sayaclar: { uc: Record<string, number> | null; panel: Record<string, number> | null; takip: Record<string, number> | null };
}

/**
 * Sayaç okuyucusunun dönüşünü yanıta hazırlar: YALNIZ kod kimliği biçimindeki anahtarlar ve eksi olmayan tam sayılar
 * geçer (başka hiçbir değer — metin, iç içe nesne — yanıta giremez). Okuyucu fırlatırsa ya da nesne dönmezse `null`.
 */
function sayacKumesi(oku: () => unknown): Record<string, number> | null {
  try {
    const ham = oku();
    if (typeof ham !== 'object' || ham === null || Array.isArray(ham)) return null;
    const temiz: Record<string, number> = {};
    for (const [ad, deger] of Object.entries(ham)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(ad) && typeof deger === 'number' && Number.isInteger(deger) && deger >= 0) temiz[ad] = deger;
    }
    return temiz;
  } catch {
    return null;
  }
}

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface OpsRouteCtx {
  /** /api/ops/yayinla için (bakım scripti doğrudan SQL yazar, SSE olayı üretemez). GETTER; opsiyonel. `connect`: tek işlemli
   *  yazım (Mikro gönderim kipi — `SELECT … FOR UPDATE`); gerçek `pg.Pool` taşır. */
  getPgPool?: () => {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
    connect?: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>; release: () => void }>;
  } | null;
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  requireMfaVerified: any;
  requireSuperAdmin: any;
  /** /api/ops/sir-tani için: oturumsuz sunucu bağlamının (webhook, cron) kiracısı çözülüyor mu. Opsiyonel. */
  serverTenantId?: () => Promise<string>;
}

export function opsRoutes(app: Express, C: OpsRouteCtx): void {
  // TOKEN SAGLIGI — acilista bir kez uyar (2026-09-04).
  // Yasanan arıza: token'a Turkce karakter ('ğ') ve bosluk kacmisti. Sunucu bunu
  // sorunsuz saklar (Buffer UTF-8), AMA istemci onu `X-Ops-Token` BASLIGINA
  // koyamaz: HTTP basliklari ByteString'dir, >255 kod noktasi TypeError firlatir
  // ("Cannot convert argument to a ByteString"). Sonuc: token "tanimli" gorunur
  // ama uc pratikte KULLANILAMAZ — sessiz kirilma. Degeri ASLA loglamayiz,
  // yalniz sorunun VARLIGINI ve konumunu bildiririz.
  {
    const t = process.env.OPS_SUMMARY_TOKEN || '';
    if (t) {
      const asciiDisi = [...t].findIndex(ch => ch.codePointAt(0)! > 127);
      if (asciiDisi >= 0) {
        console.warn(`⚠️  OPS_SUMMARY_TOKEN ASCII olmayan karakter iceriyor (konum ${asciiDisi}) — X-Ops-Token basligiyla GONDERILEMEZ. Token'i ASCII (ornegin: openssl rand -hex 24) bir degerle degistirin.`);
      }
      if (/\s/.test(t)) {
        console.warn('⚠️  OPS_SUMMARY_TOKEN bosluk/satir sonu iceriyor — .env satirinda tirnak veya sondaki aciklama olabilir; eslesme basarisiz olur.');
      }
    }
  }

  /** Operasyon bekçisi: GET son 14 günün sonuçları, POST elle çalıştır.
   *  Süper-admin panelindeki OpsWatchdogCard kullanır; cron her sabah 08:30. */
  app.get('/api/ops/watchdog', C.requireAuth, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.json({ success: true, results: [] });
    try {
      const snap = await C.getAdminDb().collection('opsChecks').get();
      const results = snap.docs
        .map(d => d.data() as Record<string, unknown>)
        .filter(r => r.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 14);
      res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  /** POST /api/ops/disk-test — disk uyarı YOLUNU elle sına.
   *
   *  Neden gerekli: 2026-07-31 kesintisinde izleme sessiz kaldı. Uyarı
   *  mekanizmasının "yazıldı" olması onun ÇALIŞTIĞI anlamına gelmiyor; postanın
   *  gerçekten ulaştığını kanıtlamadan güvenmemek gerek. Eşiklerle oynayıp iki
   *  kez deploy etmek yerine kalıcı bir sınama yolu.
   *
   *  Eşikleri ve 6 saatlik tekrar kısıtını atlar, postayı "TEST" olarak
   *  işaretler. /api/ops/summary ile AYNI token korumasını kullanır.
   */
  app.post('/api/ops/disk-test', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const sonuc = await diskNobetcisi(true);
    res.json({
      success: !sonuc.hata,
      ...sonuc,
      alici: process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL || null,
      not: sonuc.postaDenendi
        ? 'Test postası gönderildi. Gelen kutunu (ve spam) kontrol et.'
        : 'Posta GÖNDERİLEMEDİ — hata alanına bak.',
    });
  });

  /**
   * POST /api/ops/yayinla — verilen dokümanlar için SSE değişiklik olayı yayınlar. Neden: veri bakımı
   * scriptleri (scripts/lead-birlestir.ts) `docs` tablosuna DOĞRUDAN SQL yazar; pgShim'in
   * broadcastDocChange'i süreç içi olduğundan açık istemciler değişikliği görmez ve bayat kopyayla
   * (ör. eski activities dizisi) üzerine yazabilir (2026-09-11 incelemesi). Script işi bitince
   * buraya {coll, ids, silinen} gönderir; istemciler taze veriyi alır. Token: X-Ops-Token.
   */
  app.post('/api/ops/yayinla', express.json({ limit: '256kb' }), async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const govde = (req.body ?? {}) as { coll?: unknown; ids?: unknown; silinen?: unknown };
    const coll = String(govde.coll ?? '');
    const ids = Array.isArray(govde.ids) ? govde.ids.map(String).slice(0, 2000) : [];
    const silinen = Array.isArray(govde.silinen) ? govde.silinen.map(String).slice(0, 2000) : [];
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(coll)) return res.status(400).json({ error: 'coll geçersiz' });
    const pool = C.getPgPool?.();
    if (!pool) return res.status(503).json({ error: 'pg havuzu yok (lokal Firestore fallback)' });
    let yayin = 0;
    if (ids.length) {
      const { rows } = await pool.query('SELECT id, data FROM docs WHERE coll = $1 AND id = ANY($2)', [coll, ids]);
      for (const r of rows) { broadcastDocChange(coll, 'set', String(r.id), r.data); yayin++; }
    }
    for (const id of silinen) { broadcastDocChange(coll, 'delete', id); yayin++; }
    res.json({ success: true, yayin });
  });

  /**
   * GET /api/ops/sir-tani — SALT-OKUNUR ölçüm (2026-10-02, settings sır sızıntısı düzeltmesi). DEĞER DÖNDÜRMEZ, yalnız sayar:
   *   • `ayarlar`: settings dokümanlarının anahtarları (kiracı kimliği gizli), firma-bazlı mı, kaç DOLU sır alanı taşıyor;
   *   • `denetim`: auditLog'da alan farkı DÜZ METİN sır taşıyan satır sayısı (düzeltmeden ÖNCE yazılanlar — temizlik kararı
   *     bu sayıya göre verilecek; auditLog append-only, silmek/değiştirmek kullanıcı kararı);
   *   • `kiraci`: kaç kiracı var ve oturumsuz sunucu bağlamının kiracısı çözülüyor mu (aşama 2: global ayarları sahip
   *     kiracıya daraltmanın ön koşulu);
   *   • `siparisKaynaklari`: siparişlerin `source` dağılımı (çevrim içi mağaza siparişi var mı);
   *   • `kullanici` (2026-10-11, şartname «dış rol kapanışı» D6): `{ toplam, rolsuz, disRol: { B2B, Dealer }, disRolSonGiris }` —
   *     canlıda rolsüz / dış rol hesabı var mı. Yalnız SAYI ve en yeni dış rol giriş zamanı; ad / e-posta / kimlik YOK
   *     (sorgu yalnız `role` ve `lastLogin` alanlarını seçer; sayım `kullaniciSayimi.ts`).
   * Token: X-Ops-Token (scripts/ops-istek.sh).
   */
  app.get('/api/ops/sir-tani', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const pool = C.getPgPool?.();
    if (!pool) return res.status(503).json({ error: 'pg havuzu yok (lokal Firestore fallback)' });
    try {
      const ayar = await pool.query("SELECT id, data FROM docs WHERE coll = 'settings'");
      const denetim = await pool.query("SELECT data FROM docs WHERE coll = 'auditLog' AND data ? 'diff'");
      const toplam = await pool.query("SELECT count(*)::int AS n FROM docs WHERE coll = 'auditLog'");
      const kiraci = await pool.query("SELECT count(DISTINCT COALESCE(NULLIF(data->>'companyId', ''), id))::int AS n FROM docs WHERE coll = 'users'");
      const kaynak = await pool.query("SELECT COALESCE(NULLIF(data->>'source', ''), '(boş)') AS kaynak, count(*)::int AS n FROM docs WHERE coll = 'orders' GROUP BY 1 ORDER BY 2 DESC");
      // YALNIZ iki alan seçilir: kişi verisi (ad, e-posta, kimlik) sorgudan hiç çıkmaz.
      const kullanici = await pool.query("SELECT data->'role' AS rol, data->'lastLogin' AS giris FROM docs WHERE coll = 'users'");
      const sahip = C.serverTenantId ? await C.serverTenantId() : '';
      res.json({
        success: true,
        ayarlar: ayarOzeti(ayar.rows.map(r => ({ id: String(r.id), data: (r.data ?? {}) as Record<string, unknown> }))),
        denetim: { toplamSatir: Number(toplam.rows[0]?.n), ...auditSirSayimi(denetim.rows.map(r => (r.data ?? {}) as Record<string, unknown>)) },
        kiraci: {
          sayi: Number(kiraci.rows[0]?.n),
          sahipCozuluyor: sahip !== '',
          sahipOrtamdan: !!(process.env.SERVER_TENANT_COMPANY_ID || process.env.MIKRO_CRON_COMPANY_ID),
        },
        siparisKaynaklari: Object.fromEntries(kaynak.rows.map(r => [String(r.kaynak), Number(r.n)])),
        kullanici: kullaniciSayimi(kullanici.rows.map(r => ({ rol: r.rol, sonGiris: r.giris }))),
      });
    } catch (e) {
      console.error('[/api/ops/sir-tani]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Ölçüm yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /**
   * GET /api/ops/stok-fiyat-tani[?sku=<kod>] — stok kartlarında SATIŞ FİYATI kapsaması (2026-10-02). SALT OKUNUR; FİYAT DÖNDÜRMEZ,
   * yalnız sayar (ops jetonu fiyat dökmez — bilerek). Neden: "Yeni Sipariş" penceresinde ürünler 0 fiyatla görünüyordu; bunun veri
   * eksikliği mi (kartta fiyat yok) yoksa okuma hatası mı olduğu ölçülmeden karar verilemez.
   *   • `kart`: toplam; perakende kademesi / herhangi bir kademe / tekil `price` alanı POZİTİF olan kart sayısı; hiç fiyatı olmayan;
   *     stokta olup fiyatı olmayan; KDV oranı bilinen.
   *   • `kademeler`: `prices` altında görülen kademe adları → kart sayısı (pencere 'Retail' arıyor — ad tutuyor mu).
   *   • `paraBirimleri`, `kaynaklar`: `priceCurrency` ve `source` dağılımı.
   *   • `fiyatListesiSatiri`: Mikro satış fiyat listesi aynasındaki satır sayısı (import hiç koştu mu).
   *   • `?sku=`: o kartın fiyat alanlarının VAR / YOK durumu (değer yok).
   */
  app.get('/api/ops/stok-fiyat-tani', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const pool = C.getPgPool?.();
    if (!pool) return res.status(503).json({ error: 'pg havuzu yok (lokal Firestore fallback)' });
    try {
      // Sayım JS'te (saf, testli: stokFiyatTani.ts) — canlıda ilk kez koşacak karmaşık bir SQL yerine düz okuma (birkaç bin kart).
      const { rows } = await pool.query("SELECT data FROM docs WHERE coll = 'inventory'");
      const kartlar = rows.map(r => (r.data ?? {}) as Record<string, unknown>);
      const liste = await pool.query("SELECT count(*)::int AS n FROM docs WHERE coll = 'mikroFiyatListeleri'");
      const sku = typeof req.query.sku === 'string' ? req.query.sku.slice(0, 80) : '';
      const secilen = sku ? kartlar.filter(k => k.sku === sku).slice(0, 5).map(kartFiyatDurumu) : null;
      res.json({
        success: true, ...stokFiyatOzeti(kartlar), fiyatListesiSatiri: Number(liste.rows[0]?.n),
        ...(secilen ? { sku: { bulunan: secilen.length, kartlar: secilen } } : {}),
      });
    } catch (e) {
      console.error('[/api/ops/stok-fiyat-tani]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Ölçüm yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /**
   * GET /api/ops/acilis-tani — SALT OKUNUR ölçüm (2026-10-08; "site yüklenirken veri çekmekle uğraşıyor" + "veri geceleri
   * güncellenmiyor"). İŞ VERİSİ DÖNDÜRMEZ — yalnız ad / sayı / bayt / zaman / bayrak (saf çekirdek: acilisTani.ts):
   *   • `koleksiyonlar`: koleksiyon başına satır sayısı, JSON baytı ve SON YAZIM zamanı (docs.updated_at — her yazımda sunucu
   *     damgalar), bayta göre büyükten küçüğe. Açılışta SSE `init` bunların abone olunanlarını TÜMÜYLE yollar.
   *   • `aynalar`: Mikro ayna tablolarının satır sayısı ve `max(guncelleme)`. DİKKAT — damganın anlamı tabloya göre değişir
   *     (`damga`): 'herKosu' tablolar (stok, fiyat listesi, cari kartı) her koşuda yeniden damgalanır (= son senkron);
   *     'yalnizYeniSatir' tablolar `ON CONFLICT … DO NOTHING` ile yazılır (= son YENİ satır) — yeni satır gelmeyen gecede damga
   *     eski kalır. "Koştu mu" sorusunun yanıtı o tablolarda bu alan DEĞİL, `senkron`'dur.
   *   • `zamanlanmis`: gece işlerinin KAYITLI olup olmadığı (ortam değişkeninin DEĞERİ değil, karşılaştırma sonucu).
   *   • `senkron.satirlar`: son 5 günün EN YENİ 400 syncLog satırı (işlem, hedef, başarı, süre, kayıt sayısı, hata SINIFI —
   *     metin yok); `kesildi: true` ise liste eksik. `senkron.gunler`: zamanlanmış koşuların gün gün özeti — listeden DEĞİL,
   *     yalnız sistem satırlarını okuyan AYRI sorgudan (pencere İstanbul gün başına hizalı: sınır günü kısmi sayılmaz; elle
   *     yapılan işlemlerin çokluğu gece satırlarını pencereden düşüremez).
   * Token: X-Ops-Token (scripts/ops-istek.sh).
   */
  app.get('/api/ops/acilis-tani', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const pool = C.getPgPool?.();
    if (!pool) return res.status(503).json({ error: 'pg havuzu yok (lokal Firestore fallback)' });
    try {
      const boyut = await pool.query(
        "SELECT coll, count(*)::int AS satir, COALESCE(sum(octet_length(data::text)), 0)::bigint AS bayt, max(updated_at) AS son FROM docs GROUP BY coll");
      const gunluk = await pool.query(
        `SELECT data, updated_at FROM docs WHERE coll = 'syncLog' AND updated_at > now() - interval '5 days' ORDER BY updated_at DESC LIMIT ${SENKRON_LISTE_SINIRI + 1}`);
      // Gün özeti listenin sınırından BAĞIMSIZ: yalnız zamanlanmış (sistem) satırları, İstanbul gün BAŞINA hizalı 7 günlük pencere.
      const sistem = await pool.query(
        "SELECT data, updated_at FROM docs WHERE coll = 'syncLog' AND data->>'userId' = 'system' "
        + "AND updated_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') - interval '6 days') AT TIME ZONE 'Europe/Istanbul' "
        + `ORDER BY updated_at DESC LIMIT ${SENKRON_OZET_SINIRI + 1}`);
      // Ayna tabloları: adlar katalogdan (tahmin yok); `guncelleme` kolonu olmayan tablo (eşleşme tablosu) yalnız sayılır.
      const tablolar = await pool.query(
        "SELECT t.table_name AS ad, EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'guncelleme') AS damgali "
        + "FROM information_schema.tables t WHERE t.table_schema = current_schema() AND t.table_name LIKE 'mikro\\_%' ORDER BY 1");
      const aynalar: Array<{ ad: string; satir: number | null; sonGuncelleme: string | null; damga: 'herKosu' | 'yalnizYeniSatir' | null }> = [];
      for (const t of tablolar.rows) {
        const ad = String(t.ad);
        if (!/^mikro_[a-z0-9_]+$/.test(ad)) continue;             // katalogdan geldi ama yine de tanımlayıcı olarak doğrula
        const r = await pool.query(`SELECT count(*)::int AS satir${t.damgali === true ? ', max(guncelleme) AS son' : ''} FROM ${ad}`);
        const son = r.rows[0]?.son;
        aynalar.push({
          ad, satir: typeof r.rows[0]?.satir === 'number' ? r.rows[0].satir : null,
          sonGuncelleme: son instanceof Date && Number.isFinite(son.getTime()) ? son.toISOString() : null,
          damga: t.damgali === true ? (HER_KOSU_DAMGALI.has(ad) ? 'herKosu' : 'yalnizYeniSatir') : null,
        });
      }
      const cevir = (r: Record<string, unknown>) => senkronSatiri((r.data ?? {}) as Record<string, unknown>,
        r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at ?? ''));
      const satirlar = gunluk.rows.slice(0, SENKRON_LISTE_SINIRI).map(cevir);
      const sistemSatirlari = sistem.rows.slice(0, SENKRON_OZET_SINIRI).map(cevir);
      res.json({
        success: true,
        uretim: new Date().toISOString(),
        ...koleksiyonOlculeri(boyut.rows),
        aynalar,
        zamanlanmis: {
          mikroCronKayitli: process.env.MIKRO_CRON_SYNC === 'true',
          mikroSurum: MIKRO_JUMP_SURUM,
          // crons.ts: 04:00 stok miktar/maliyet işi yalnız MIKRO_CRON_SYNC === 'true' bloğunda KAYDEDİLİR ve sürüm < 17 iken
          // ilk satırda döner (GenelAmacliMaliyetListesiV2 V16'da yok) — ikisi birlikte sağlanmadıkça ÇALIŞMAZ.
          geceStokMiktarIsiCalisir: process.env.MIKRO_CRON_SYNC === 'true' && MIKRO_JUMP_SURUM >= 17,
        },
        senkron: {
          gunler: geceOzeti(sistemSatirlari), gunlerKesildi: sistem.rows.length > SENKRON_OZET_SINIRI,
          satirlar, kesildi: gunluk.rows.length > SENKRON_LISTE_SINIRI,
        },
      });
    } catch (e) {
      console.error('[/api/ops/acilis-tani]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Ölçüm yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /**
   * GET /api/ops/mikro-gonderim-ozet — Mikro gönderim defterinin ÖLÇÜM özeti (2026-10-18, şartname yeniden-deneme v3 K0b / K12
   * «Ops uçları»; Dilim 0). SALT OKUNUR; GÖVDE, kullanıcı / kiracı kimliği, `entityId`, özet karması DÖNMEZ — yalnız sayı, HTTP durumu,
   * tanımlayıcı ad ve yanıt anahtar yolu:
   *   • `kip`: geçerli kip + son 10 değişiklik (neden metni ops'un yazdığıdır);
   *   • `kayitlar`: defterde tür × durum sayısı; `olcum`: son 30 günün dağılımları (C2, C3, C9, C10, C11, C14);
   *   • `syncJobs`: eski istemci kuyruğunun durum sayıları, son 30 günde ölü, en eski `createdAt` (C1);
   *   • `surec`: ölçüm kaydı açma / sonuç yazma hatası, uçuştaki kayıt; `stubSayaci`: yöntem başına stub / atlanan ikinci gönderim.
   * Token: X-Ops-Token (scripts/ops-istek.sh).
   */
  app.get('/api/ops/mikro-gonderim-ozet', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const pool = C.getPgPool?.();
    if (!pool) return res.status(503).json({ error: 'pg havuzu yok (lokal Firestore fallback)' });
    try {
      const ozet = await mikroGonderimOzetiOku(pool);
      const stub = stubSayaciOzeti();
      const yontemler: Record<string, { sayi: number; atlanan: number; sonAt: string }> = {};
      for (const [ad, k] of Object.entries(stub.yontemler)) {
        // Yöntem adı kod sabitinden ya da beyaz listeden gelir; yine de yalnız tanımlayıcı biçimi yanıta girer.
        if (/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(ad)) yontemler[ad] = { sayi: k.sayi, atlanan: k.atlanan, sonAt: new Date(k.sonAt).toISOString() };
      }
      res.json({
        success: true, uretim: new Date().toISOString(), ...ozet,
        stubSayaci: { baslangic: new Date(stub.baslangic).toISOString(), yontemler },
      });
    } catch (e) {
      console.error('[/api/ops/mikro-gonderim-ozet]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Ölçüm yapılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /**
   * POST /api/ops/mikro-gonderim-kipi `{ kip, neden }` — gönderim defteri kipi (K20; Dilim 0: yalnız `kapali | olcum`; `tam` /
   * `durdur` 400). `neden` zorunlu (1–200 karakter); kip belgesi son 10 değişikliği tutar. Etkisi bu süreçte hemen, öteki süreçlerde
   * ≤ 10 sn (önbellek); hizmet yeniden başlamaz. Kipi `olcum`'a almak kullanıcı kararıdır (S7). Gövde: `scripts/ops-istek.sh --govde`.
   */
  app.post('/api/ops/mikro-gonderim-kipi', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res)) return;
    const govde = (req.body ?? {}) as { kip?: unknown; neden?: unknown };
    try {
      const sonuc = await gonderimKipiYaz(C.getPgPool?.() ?? null, { kip: govde.kip, neden: govde.neden });
      if (!sonuc.tamam) return res.status(sonuc.durum).json({ success: false, error: sonuc.error });
      res.json({ success: true, kip: sonuc.kip, onceki: sonuc.onceki, at: new Date(sonuc.at).toISOString() });
    } catch (e) {
      console.error('[/api/ops/mikro-gonderim-kipi]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Kip yazılamadı. Ayrıntı sunucu günlüğünde.' });
    }
  });

  /** GET /api/ops/summary — SALT-OKUNUR ops özeti, token korumalı (2026-07-28).
   *  Amacı: tarayıcı/oturum olmadan sistemin durumunu okumak (scripts/ops-istek.sh; eskiden günlük bulut rutini).
   *  Sadece operasyonel metrik döner — kişisel/iş verisi YOK. OPS_SUMMARY_TOKEN env'i tanımlı değilse uç KAPALIDIR (503).
   *  Token: YALNIZ `X-Ops-Token` başlığı (opsJeton.ts — 2026-09-28'e kadar ?token= de kabul ediliyordu; sorgu dizesi
   *  erişim günlüklerine düşer). Karşılaştırma sabit zamanlı. */
  app.get('/api/ops/summary', async (req: Request, res: Response) => {
    if (!opsJetonuGecerli(req, res, 'ops summary kapalı — OPS_SUMMARY_TOKEN tanımlı değil')) return;
    try {
      let latest: Record<string, unknown> | null = null;
      let previous: Record<string, unknown> | null = null;
      if (C.getAdminDb()) {
        const snap = await C.getAdminDb().collection('opsChecks').get();
        const rows = snap.docs.map(d => d.data() as Record<string, unknown>)
          .filter(r => r.date)
          .sort((x, y) => String(y.date).localeCompare(String(x.date)));
        latest = rows[0] ?? null;
        previous = rows[1] ?? null;
      }
      const failing = ((latest?.checks as Array<{ key: string; ok: boolean; detail: string }>) || []).filter(c => !c.ok);
      // Sunucunun üç saati (Node süreci / PostgreSQL GUC / Mikro SQL Server) — tzutil doğrulaması (2026-09-28).
      const pool = C.getPgPool?.();
      const saat = await saatTanisi({
        pgSorgu: pool ? (sql: string) => pool.query(sql) : null,
        // Mikro isteği KENDİ zaman aşımıyla kesilir (yalnız beklenen söz bırakılırsa istek global 30 sn yamasına kadar açık kalırdı).
        mikroSorgu: (await getMikroCreds()) ? (sql: string) => mikroSql(sql, { zamanAsimiMs: 8000 }) : null,
      });
      // Mağaza bildirimi (K7, 2026-10-09): kip + eksik anahtar ADLARI + son 7 günün sayımı — kapalı kümelerden, kişisel veri yok.
      // Dilim 2b: sayım revize bildirimini de taşır (`sayim.revize.durum` / `.hataSinifi`; son 7 günde REVİZE edilen talepler —
      // ilk bildirim sayılarına karışmaz; kanal/magazaBildirimSayim.ts).
      // Kendi try'ında: havuz yoksa / sorgu düşerse `sayim: null`, özetin geneli 500'e DÜŞMEZ.
      let magazaBildirim: { kip: string | null; eksik: string[]; pencereGun: number; sayim: unknown; hata?: 'okunamadi' } =
        { kip: null, eksik: [], pencereGun: MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN, sayim: null };
      try {
        const y = smtpYapilandirmasi();
        magazaBildirim = { kip: y.kip, eksik: y.eksik, pencereGun: MAGAZA_BILDIRIM_SAYIM_PENCERESI_GUN, sayim: pool ? await magazaBildirimSayimi(pool, Date.now()) : null };
      } catch {
        magazaBildirim.hata = 'okunamadi';
      }
      // Mağaza (dilim 2a, § 6): açık talep sayımı (bekçinin `magaza_talep` ayrıntısıyla AYNI sorgu — kanal/magazaAcikSayim.ts)
      // + üç süreç içi sayaç kümesi (dilim 1 uçları / panel + ERP uçları / takip sorgusu). Bekçi günde bir koşar; bu blok
      // ANLIK okumadır (yayın sonrası «uçlar kullanılıyor mu», «açık talep birikiyor mu»). Kişisel veri yok: sayım kapalı
      // kümeden sütunlar, sayaçlar yalnız sayı. Her okuma KENDİ yakalayıcısında: biri düşerse o alan `null`, özet 500'e DÜŞMEZ.
      const magaza: OpsMagazaOzeti = {
        acik: pool ? await magazaAcikSayimi(pool).catch(() => null) : null,
        sayaclar: { uc: sayacKumesi(magazaSayaclari), panel: sayacKumesi(magazaPanelSayaclari), takip: sayacKumesi(magazaTakipSayaclari) },
      };
      res.json({
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        env: process.env.NODE_ENV || 'development',
        magazaBildirim,
        magaza,
        watchdog: {
          date: latest?.date ?? null,
          ok: latest?.ok ?? null,
          failingCount: failing.length,
          failing,                       // yalnız BOZUK olanların detayı
          checks: latest?.checks ?? [],  // tam liste (kontrol SAYISINI ELLE YAZMA, ölç: grep -oE "add\('[a-z_]+'" src/server/opsWatchdog.ts | sort -u | wc -l)
          previousDate: previous?.date ?? null,
          previousOk: previous?.ok ?? null,
        },
        mikro: { apiBase: MIKRO_API_BASE, localMode: MIKRO_LOCAL_MODE, surum: MIKRO_JUMP_SURUM },
        saat,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/ops/watchdog/run', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, result: await runOpsWatchdog() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/ops/module-status — modül bazlı sezgisel olgunluk göstergesi.
   *  GERÇEK dosya sinyallerinden hesaplanır (satır sayısı, App.tsx/diğer
   *  bileşenlerde kullanılıyor mu, TODO/stub/placeholder işaretleri) —
   *  "bitti/eksik" gibi kesin bir iddia ÜRETMEZ, yalnız ham sinyalleri döner;
   *  istemci bunu açıkça "sezgisel gösterge" etiketiyle sunar (bkz. CLAUDE.md
   *  "sahte kesinlik gösterme"). 2026-08-16, süper-admin panel isteği.
   */
  const MODULE_REGISTRY: { id: string; label: string; file: string; group: string }[] = [
    { id: 'crm', label: 'CRM (Satış Hunisi)', file: 'src/pages/CRMPage.tsx', group: 'Satış' },
    { id: 'orders', label: 'Sipariş & Lojistik', file: 'src/pages/OrdersPage.tsx', group: 'Satış' },
    { id: 'online-siparisler', label: 'Online Siparişler', file: 'src/pages/OnlineSiparislerPage.tsx', group: 'Satış' },
    { id: 'inventory', label: 'Envanter', file: 'src/pages/InventoryPage.tsx', group: 'Stok' },
    { id: 'muhasebe', label: 'Muhasebe (ana)', file: 'src/pages/MuhasebePage.tsx', group: 'Muhasebe' },
    { id: 'satinalma', label: 'Satın Alma', file: 'src/pages/SatinAlmaPage.tsx', group: 'Satın Alma' },
    { id: 'ik', label: 'İnsan Kaynakları', file: 'src/pages/IKPage.tsx', group: 'IK' },
    { id: 'raporlar', label: 'Raporlar', file: 'src/pages/RaporlarPage.tsx', group: 'Rapor' },
    { id: 'admin', label: 'Admin', file: 'src/pages/AdminPage.tsx', group: 'Yönetim' },
    { id: 'ayarlar', label: 'Ayarlar', file: 'src/pages/SettingsPage.tsx', group: 'Yönetim' },
    { id: 'dashboard', label: 'Dashboard', file: 'src/pages/DashboardPage.tsx', group: 'Genel' },
    { id: 'b2bportal', label: 'B2B Portal', file: 'src/components/B2BPortal.tsx', group: 'Satış' },
    { id: 'hr', label: 'HR Modülü', file: 'src/components/HRModule.tsx', group: 'IK' },
    { id: 'legal', label: 'Hukuk', file: 'src/components/LegalModule.tsx', group: 'Yönetim' },
    { id: 'quality', label: 'Kalite', file: 'src/components/QualityModule.tsx', group: 'Üretim' },
    { id: 'production', label: 'Üretim', file: 'src/components/ProductionModule.tsx', group: 'Üretim' },
    { id: 'mrp', label: 'MRP', file: 'src/components/MRPModule.tsx', group: 'Üretim' },
    { id: 'bom', label: 'Ürün Ağacı (BOM)', file: 'src/components/BOMPanel.tsx', group: 'Üretim' },
    { id: 'bakim', label: 'Bakım', file: 'src/components/BakimModule.tsx', group: 'Üretim' },
    { id: 'servis', label: 'Servis', file: 'src/components/ServisModule.tsx', group: 'Satış' },
    { id: 'lotseri', label: 'Lot/Seri Takip', file: 'src/components/LotSeriModule.tsx', group: 'Stok' },
    { id: 'sube', label: 'Şube Yönetimi', file: 'src/components/SubeModule.tsx', group: 'Yönetim' },
    { id: 'holding', label: 'Holding', file: 'src/components/HoldingModule.tsx', group: 'Yönetim' },
    { id: 'kurumsalyonetim', label: 'Kurumsal Yönetim', file: 'src/components/CorporateGovernanceModule.tsx', group: 'Yönetim' },
    { id: 'maliyetmerkezi', label: 'Maliyet Merkezi', file: 'src/components/MaliyetMerkeziModule.tsx', group: 'Muhasebe' },
    { id: 'gelirtanima', label: 'Gelir Tanıma', file: 'src/components/GelirTanimaModule.tsx', group: 'Muhasebe' },
    { id: 'muhtasar', label: 'Muhtasar', file: 'src/components/MuhtasarModule.tsx', group: 'Muhasebe' },
    { id: 'sabitkiymet', label: 'Sabit Kıymet', file: 'src/components/SabitKiymetModule.tsx', group: 'Muhasebe' },
    { id: 'kasa', label: 'Kasa', file: 'src/components/KasaModule.tsx', group: 'Muhasebe' },
    { id: 'dunning', label: 'Tahsilat Hatırlatma', file: 'src/components/DunningModule.tsx', group: 'Muhasebe' },
    { id: 'ihracat', label: 'İhracat', file: 'src/components/IhracatModule.tsx', group: 'Satış' },
    { id: 'territory', label: 'Bölge Yönetimi', file: 'src/components/TerritoryModule.tsx', group: 'Satış' },
    { id: 'performans', label: 'Performans', file: 'src/components/PerformansModule.tsx', group: 'IK' },
    { id: 'cpq', label: 'CPQ (Teklif Yapılandırma)', file: 'src/components/CPQPanel.tsx', group: 'Satış' },
    { id: 'demandforecast', label: 'Talep Tahmini', file: 'src/components/DemandForecastPanel.tsx', group: 'Stok' },
    { id: 'priceintel', label: 'Fiyat İstihbaratı', file: 'src/components/PriceIntelPanel.tsx', group: 'Satış' },
    { id: 'dealercomm', label: 'Bayi Komisyonu', file: 'src/components/DealerCommissionPanel.tsx', group: 'Satış' },
    { id: 'subscription', label: 'Abonelik Yönetimi', file: 'src/components/SubscriptionPanel.tsx', group: 'Yönetim' },
    { id: 'mobilewms', label: 'Mobil WMS', file: 'src/components/MobileWMSModule.tsx', group: 'Stok' },
    { id: 'erp_hub', label: 'ERP Hub', file: 'src/components/ERPHubPanel.tsx', group: 'Entegrasyon' },
    { id: 'marketplace', label: 'Pazaryeri', file: 'src/components/MarketplacePanel.tsx', group: 'Entegrasyon' },
    { id: 'sku_mapping', label: 'SKU Eşleştirme', file: 'src/components/SkuMappingPanel.tsx', group: 'Entegrasyon' },
    { id: 'mutabakat', label: 'Mutabakat', file: 'src/components/MutabakatPanel.tsx', group: 'Muhasebe' },
    { id: 'overdue', label: 'Vadesi Geçen', file: 'src/components/OverduePanel.tsx', group: 'Muhasebe' },
    { id: 'risk', label: 'Risk Paneli', file: 'src/components/RiskPanel.tsx', group: 'Muhasebe' },
    { id: 'finance', label: 'Finans Paneli', file: 'src/components/FinancePanel.tsx', group: 'Muhasebe' },
    { id: 'analytics', label: 'Analitik', file: 'src/components/AnalyticsPanel.tsx', group: 'Rapor' },
  ];
  const MODULE_STUB_MARKERS = ['todo', 'yakında', 'coming soon', 'henüz bağlı değil', 'placeholder veri', 'mock veri', 'dummy veri', 'not implemented', 'stub veri', 'demo veri'];
  function walkSourceFiles(dir: string, out: string[] = []): string[] {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkSourceFiles(full, out);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }
  // ── Calisma ortami bilgisi (super-admin) ──────────────────────────────────
  // NEDEN VAR: firebase-admin 14 `node >=22` istiyor; CI Node 20'de, uretim
  // sunucusu ise chocolatey 'nodejs-lts' ile kuruldu ve GERCEK surumu hicbir
  // yerden gorunmuyordu. Yukseltme plani tahmine dayanamaz — bu uc olcumu
  // saglar. /api/health'e KONMADI: orasi kimliksiz erisilebiliyor ve tam
  // calisma-zamani surumunu disariya bildirmek gereksiz bilgi sizintisidir.
  app.get('/api/ops/runtime', C.requireAuth, C.requireSuperAdmin, (_req: Request, res: Response) => {
    let firebaseAdminSurum: string | null = null;
    try {
      firebaseAdminSurum = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'node_modules', 'firebase-admin', 'package.json'), 'utf8'),
      ).version as string;
    } catch { /* paket okunamazsa null */ }

    const majör = Number(process.versions.node.split('.')[0]);
    res.json({
      node: process.version,
      nodeMajor: majör,
      platform: `${process.platform} ${process.arch}`,
      firebaseAdmin: firebaseAdminSurum,
      // firebase-admin 14 engines: { node: '>=22' }
      firebaseAdmin14Uyumlu: majör >= 22,
      uptimeSaat: Math.round((process.uptime() / 3600) * 10) / 10,
    });
  });

  app.get('/api/ops/module-status', C.requireAuth, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const root = process.cwd();
      const scanDirs = [path.join(root, 'src', 'pages'), path.join(root, 'src', 'components'), path.join(root, 'src', 'App.tsx')];
      const files = scanDirs.flatMap(d => (fs.existsSync(d) && fs.statSync(d).isDirectory()) ? walkSourceFiles(d) : (fs.existsSync(d) ? [d] : []));
      const contents = new Map<string, string>();
      for (const f of files) { try { contents.set(f, fs.readFileSync(f, 'utf8')); } catch { /* okunamayan dosya atlanır */ } }
      const combined = [...contents.values()].join('\n');
      const modules = MODULE_REGISTRY.map(m => {
        const full = path.join(root, m.file);
        const content = contents.get(full);
        if (content === undefined) return { ...m, exists: false, lines: 0, stubMarkers: [] as string[], wired: false, mtimeMs: null as number | null };
        const lines = content.split('\n').length;
        const lower = content.toLowerCase();
        const stubMarkers = MODULE_STUB_MARKERS.filter(s => lower.includes(s));
        const compName = path.basename(m.file, path.extname(m.file));
        const occurrences = combined.split(compName).length - 1; // kendi dosyasındaki tanım + başka yerdeki kullanım(lar)
        const wired = occurrences >= 2;
        let mtimeMs: number | null = null;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* yok say */ }
        return { ...m, exists: true, lines, stubMarkers, wired, mtimeMs };
      });
      res.json({ success: true, modules, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
