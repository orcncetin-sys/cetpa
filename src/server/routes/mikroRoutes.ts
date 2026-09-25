/**
 * mikroRoutes.ts - Mikro (Jump) HTTP uclari: 21 rota + SQL import motoru.
 *
 * server.ts'ten AYRILDI (2026-08-24) - D4'un 6. ve EN BUYUK parcasi
 * (2.792 satir). Onceki bes parca ALTYAPIYDI (opsWatchdog, mikroClient,
 * mikroMirror, crons, pgShim); bu ilk ROTA grubu.
 *
 * NEDEN BAGLAM NESNESI, `import` DEGIL:
 * Bu rotalar server.ts'te tanimli 11 yardimciya bagli (reqActor, writeSyncLog,
 * tenantSnap, ...). Onlari import etseydik DONGUSEL BAGIMLILIK olurdu:
 * server.ts bu modulu import ediyor, bu modul de server.ts'i. ES modulleri
 * donguye izin verir ama kirilgandir - `const` bildiriminde TDZ hatasi,
 * fonksiyon bildiriminde yukleme sirasina bagli sessiz `undefined`. Acik bir
 * baglam nesnesi donguyu tamamen kaldirir ve modulun neye bagli oldugunu tek
 * bakista gorunur yapar.
 *
 * ICERIDE KALAN (olculdu - yalniz bu rotalar kullaniyor): SQL import motoru
 * (mikroSqlImportCalistir, makeMikroSqlImport, makeMikroListImport,
 * SQL_IMPORT_TANIMLARI), MIKRO_PUSH_WHITELIST, firstArrayIn. (stok-miktar'in
 * eski surec-ici kilit bayragi 2026-09-24'te src/server/mikro/arkaPlanIsi.ts
 * surec-geneli kilidine tasindi — 15 import ucu (stok, cari, stok-miktar, 12 SQL
 * fabrika; 4 cagri yeri) o yardimciya baglanir.)
 *
 * SINIR SECIMI: blok, bolum basligindan son rotanin kapanisina kadar alindi.
 * `/api/integrations/health` (mikro DEGIL) bu araligin hemen ardinda kaldi;
 * dahil edilmedi, blok o rotadan ONCE kesildi. Ilk denemede sinirlar rota
 * BASLANGIC satirlarindan alinmisti ve hem ilk rotalarin doc yorumlari hem son
 * rotanin GOVDESI geride kalmisti - bu yuzden blok basi/sonu artik yorum
 * blogundan kapanis `});`ine kadar hesaplaniyor.
 */
import type { AdminDbLike, AdminDocRef, DocDaralt } from '../adminDbTypes.js';
import type { Express, Request, Response } from 'express';
import { FaturaKaydetSchema, IrsaliyeKaydetSchema, GelenFaturaActionSchema, type Sema } from '../schemas.js';
import { zamanla } from '../zamanla.js';
import { timingSafeEqual } from 'crypto';
import { findKey, kolonSec } from '../../lib/mikroKolon.js';
import {
  MIKRO_API_BASE, MIKRO_JUMP_SURUM, MIKRO_LOCAL_MODE, detectMikroGatewayBlock, v17MetoduKullanilabilir,
  getMikroCreds, mikroBugun, mikroData, mikroHata, mikroKolonlar, mikroPost,
  mikroSatirlar, mikroSql, mikroStokMiktari, listeZamanAsimiMs,
  mikroVergiOranlari, sqlTarih, kolonBul, sqlTanimlayici,
} from '../mikroClient.js';
import {
  CHA_COLS, STH_COLS, FIS_COLS, SIP_COLS, mirrorMikroCariler, mirrorMikroInsert,
  mirrorMikroStoklar,
} from '../mikroMirror.js';
import { pgServerTimestamp } from '../pgShim.js';
import { mikroGovdeHatasiMi } from '../mikro/govdeHatasi.js';
import { stokGovdesi, cariGovdesi } from '../mikro/govdeStokCari.js';
import { siparisGovdesi } from '../mikro/govdeSiparis.js';
import { faturaGovdesi, irsaliyeGovdesi } from '../mikro/govdeFaturaIrsaliye.js';
import {
  yevmiyeGovdesi, tahsilatGovdesi, cariHareketGovdesi,
  type YevmiyeGovde, type TahsilatGovde, type CariHareketGovde,
} from '../mikro/govdeMuhasebe.js';
import { isimAnahtari, firmaAnahtari } from '../../lib/isimAnahtari.js';
import { yaziciyiIstegeBagla } from '../bakimKilidi.js';
import { mikroIsAdi } from '../../lib/mikroIsAdi.js';
import { arkaPlanIsiBaslat, arkaPlanOnKontrol, arkaPlanYaziciAdi, bakimKilidiMesaji, type ArkaPlanBagimlilik, type BaslatSonucu } from '../mikro/arkaPlanIsi.js';
import { araligiTopla, ALT_STOK, ALT_CARI, type SayfaSayaclari } from '../mikro/adaptifSayfalama.js';
import { bilinenSayi } from '../../utils/para.js';
// Varlık eşlemeleri TEK KAYNAK (saf + testli): src/server/mikro/eslemeVarlik.ts
// (demirbaş / maliyet merkezi / personel / üretim reçetesi import gövdeleri)
// ALIAS GEREKÇESİ: `okumaArizasi`/`okumaArizasiUyarisi` adları bu dosyada ZATEN
// kullanılıyor — `okumaArizasiUyarisi` eslemeFatura'dan import edilmiş (satır ~69),
// `okumaArizasi` ise bakiyeHaritasi'nın destructure edilen alanı (pull/bakiye rotası).
// Takma ad koymadan biri diğerini sessizce gölgelerdi.
import {
  demirbasEsle, maliyetMerkeziEsle, personelEsle, receteKalemiEsle, receteBilesen,
  mikroKod, ozetBaslat, ozetEkle, bilinmeyenNotu,
  okumaArizasi as varlikArizalari, okumaArizasiUyarisi as varlikArizaUyarisi,
  // Okuma arızası YALNIZ kritik alanlarda aranır (2026-09-19): meşru olarak boş
  // kalabilen alanlar (personelde e-posta/TC/maaş, reçetede birim) her senkronda
  // "kolon adı/şema kontrol edin" yanlış alarmı üretiyordu.
  DEMIRBAS_KRITIK, MALIYET_MERKEZI_KRITIK, PERSONEL_KRITIK, RECETE_KRITIK,
  type ReceteKalemi,
} from '../mikro/eslemeVarlik.js';
// Cari eşlemeleri TEK KAYNAK (saf + testli): src/server/mikro/eslemeCari.ts
import {
  cariEsle, cariEslemeOzeti, bakiyeHaritasi, cariBakiyesi,
  adresSec, adresGuncellemesi, adresOzeti, type CariEsleme,
} from '../mikro/eslemeCari.js';
import {
  stokEsle, fiyatEsle, stokMiktarEsle, depoSatiriCoz,
  sayacOlustur, sayacaEkle, sayacNotu, okumaArizalari, okumaArizasiNotu,
  // Okuma arızası YALNIZ kritik alanlarda aranır (2026-09-19 delta bulgusu):
  // StokListesiV2 anlık miktar TAŞIMAZ ve bu kurulumda fiyat ayrı tablodadır, bu
  // yüzden süzgeçsiz tarama HER stok import'unda "kolon adı/şema kontrol edin"
  // yanlış alarmı üretiyordu. Her çağrı kendi kritik kümesini verir.
  STOK_KRITIK, FIYAT_KRITIK, STOK_MIKTAR_KRITIK, DEPO_KRITIK,
} from '../mikro/eslemeStok.js';
// Fatura eşlemeleri TEK KAYNAK (saf + testli): src/server/mikro/eslemeFatura.ts
import {
  faturaYonu, faturalariEsle, kalemHaritasi, faturadanSiparis, siparisTuretmeNotu,
  kalemleriBirimle, okumaArizasiUyarisi, OKUMA_ARIZASI_ESIK, type SiparisSatiri,
} from '../mikro/eslemeFatura.js';
import { eBelgeNormalize, eBelgeleriNormalize, cariHareketYonOzeti } from '../mikro/eBelge.js';
import { belgeNoMetni } from '../mikro/belgeNo.js';
// KDV özeti / mizan eşlemeleri TEK KAYNAK (saf + testli): src/server/mikro/raporKdvMizan.ts
import { kdvKirilimi, mizanSatirlari, mizanToplami } from '../mikro/raporKdvMizan.js';


/** Bu rota grubunun server.ts'ten ihtiyac duydugu HER SEY - acik liste. */
export interface MikroRouteCtx {
  reqActor: (req: Request) => { uid: string; email: string };
  writeSyncLog: (...a: any[]) => Promise<unknown>;
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  tenantSnap: (coll: string, cid: string, daralt?: DocDaralt) => Promise<{ docs: any[] }>;
  mikroIdCozucu: (coll: string, cid: string) => Promise<(anahtar: string) => string>;
  loadCompanyDocs: (coll: string, cid: string, daralt?: DocDaralt) => Promise<Array<Record<string, unknown>>>;
  mikroLimiter: any;
  requireCollectionAccess: (coll: string, op: 'read' | 'write' | 'delete') => any;
  requireAuth: any;
  requireMfaVerified: any;
  /** server.ts'te SONRADAN atanan `let` - deger degil GETTER. */
  getAdminDb: () => AdminDbLike;
  getPgPool: () => any;
  getUserCompanyId: (uid: string) => Promise<string>;
  mikroIdCozucuIds: (ids: Iterable<string>, cid: string) => (anahtar: string) => string;
  /** zod dogrulama yardimcisi (server.ts'te). SEMALAR baglamda DEGIL,
   *  '../schemas.js'ten IMPORT ediliyor: tipleri elle yazmak yerine semadan
   *  turusun, sema degisince sessizce bayatlamasin. Sema tipi `any` olamaz -
   *  T cikarilamayinca `{}` olur ve alanlar 'does not exist' hatasi verir. */
  validate: <T>(sema: Sema<T>, veri: unknown, res: Response) => T | null;
  /** pg-boss kuyrugu (server.ts'te sonradan atanir) - GETTER. */
  getBoss: () => any;
}

export function mikroRoutes(app: Express, C: MikroRouteCtx): void {
  /**
   * İSTEMCİDEN GELEN doküman id'sinin sahipliği (2026-09-19, Faz 3 3/n kapanışı). Yedi rota `firebaseId`'yi
   * doğrulamadan o dokümana yazıyordu; dördü üstüne çağıranın `companyId`'sini DAMGALIYORDU — başka kiracının
   * fatura/sipariş dokümanının id'sini bilen kullanıcı onu sahiplenebiliyordu (2026-08-12'de 8 uçta kapatılan
   * sınıfın kaçan üyeleri). Desen aynı: etiketsiz (companyId'siz) eski kayıt 'kendi' sayılır.
   *   'kendi'   → yazılabilir        'yabanci' → 404, Mikro'ya da GİDİLMEZ
   *   'yok'     → doküman yok: `set(merge)` ile KENDİ dokümanını yaratan rotalarda serbest (irsaliye → shipments),
   *               var olması GEREKEN dokümanda (gelen fatura) 404.
   * Kontrol `mikroPost`'tan ÖNCE yapılır — dış sisteme (GİB/Mikro) giden işlem, sonradan reddedilecek bir
   * doküman için başlatılmaz.
   */
  const belgeSahipligi = async (coll: string, id: string | undefined, companyId: string): Promise<'kendi' | 'yabanci' | 'yok' | 'idsiz'> => {
    if (!id || !C.getAdminDb()) return 'idsiz';
    const snap = await C.getAdminDb().collection(coll).doc(id).get();
    if (!snap.exists) return 'yok';
    const dc = ((snap.data() as Record<string, unknown> | undefined)?.companyId as string | undefined) || '';
    return dc && dc !== companyId ? 'yabanci' : 'kendi';
  };
  const YABANCI_BELGE = { success: false, error: 'Kayıt bulunamadı.' } as const;   // varlığı sızdırmamak için 'yabanci' ve 'yok' aynı yanıt

  // ── Mikro Jump API Routes ────────────────────────────────────────────────────

  /** GET /api/mikro/status — is Mikro configured and the FULL API context working?
   *  Makes a real StokListesiV2 call (Size=1) so wrong KullaniciKodu/Sifre/Alias
   *  surface here instead of silently failing during imports.
   */
  /** GET /api/mikro/tablolar — Mikro tablo aynası: eşleşme kayıtları + canlı satır sayıları. */
  app.get('/api/mikro/tablolar', C.requireAuth, async (_req: Request, res: Response) => {
    if (!C.getPgPool()) return res.status(503).json({ success: false, error: 'DATABASE_URL tanımlı değil.' });
    try {
      const { rows: eslesme } = await C.getPgPool().query('SELECT * FROM mikro_tablo_eslesme ORDER BY mikro_tablo');
      const tablolar: Record<string, number> = {};
      for (const e of eslesme) {
        const { rows } = await C.getPgPool().query(`SELECT count(*)::int AS n FROM ${e.pg_tablo}`);
        tablolar[e.pg_tablo] = rows[0].n;
      }
      res.json({ success: true, eslesme, satirSayilari: tablolar });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/mikro/status', async (_req: Request, res: Response) => {
    const statusCreds = await getMikroCreds();
    if (!statusCreds) {
      // Hangi alanın eksik olduğunu MODA göre söyle (secret DEĞERİ asla yazma).
      const missing = MIKRO_LOCAL_MODE
        ? ['MIKRO_SIFRE'].filter(k => !process.env[k])
        : ['MIKRO_IDM_EMAIL', 'MIKRO_IDM_PASSWORD', 'MIKRO_API_KEY', 'MIKRO_ALIAS'].filter(k => !process.env[k]);
      return res.json({
        configured: false, connected: false,
        mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud',
        message: `Mikro kimlik bilgileri yapılandırılmamış (${MIKRO_LOCAL_MODE ? 'LOKAL' : 'BULUT'} mod). ` +
          (missing.length
            ? `Sunucu .env'inde eksik: ${missing.join(', ')}. `
            : 'Ayarlar > Mikro ERP bölümünden girin veya sunucu .env değerlerini kontrol edin. ') +
          (MIKRO_LOCAL_MODE ? 'Lokal modda Alias/ApiKey/IDM gerekmez; KullaniciKodu boşsa SRV varsayılır.' : ''),
      });
    }
    try {
      // Bağlantı testi için HealthCheck kullanılır — StokListesiV2 ile 5 kayıt
      // çekmek gereksiz iş ve stok tablosu boşsa yanıltıcı (2026-07-30).
      // HealthCheck yoksa/eski sürümse StokListesiV2'ye düşülür.
      let { ok, data } = await mikroPost('HealthCheck', {});
      const r0h = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0h || r0h.IsError) {
        ({ ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01', SonTarih: mikroBugun(),
          Sort: 'sto_kod', Size: '5', Index: 0,
        }));
      }
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (ok && r0 && !r0.IsError) {
        return res.json({
          configured: true, connected: true,
          mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE,
          // Otomatik senkron GERÇEKTEN kurulu mu? Ayarın .env'e yazılmış olması
          // çalıştığı anlamına gelmiyor — süreç yeniden başlamadıysa eski değeri
          // taşır. Bunu dışarıdan görebilmek 2026-07-31'de gerekti.
          cronSync: {
            enabled: process.env.MIKRO_CRON_SYNC === 'true',
            program: process.env.MIKRO_CRON_SYNC === 'true'
              ? ['saatlik: stok+cari kartları', '03:20 SQL listeleri (90 gün)', '04:00 stok miktar/maliyet']
              : [],
          },
        });
      }
      // Cloudflare/WAF/gateway HTML hata sayfasını anlaşılır mesaja çevir (v17 IP-block)
      const gatewayBlock = detectMikroGatewayBlock(data);
      console.warn('Mikro status probe failed:', gatewayBlock || JSON.stringify(data)?.slice(0, 300));
      res.json({
        configured: true, connected: false,
        mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE,
        gatewayBlocked: !!gatewayBlock,
        error: gatewayBlock || (r0?.ErrorMessage as string) || `Mikro API bağlantı hatası (HTTP ${ok ? 200 : 'err'}: ${JSON.stringify(data)?.slice(0, 120)})`,
      });
    } catch (err) {
      // Ağ seviyesi hata (fetch failed / ECONNREFUSED / timeout): kullanıcıya
      // ham mesaj yerine ne yapacağını söyle. Port kullanılıyorsa TCP hiç
      // açılmıyor demektir (Cloudflare bu portları proxy'lemez / IP whitelist).
      const raw = err instanceof Error ? err.message : String(err);
      const portMatch = MIKRO_API_BASE.match(/:(\d+)/)?.[1];
      const netFail = /fetch failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|socket hang up|network/i.test(raw);
      const hint = netFail
        ? (portMatch
            ? `Mikro API'ye TCP bağlantısı kurulamadı (port ${portMatch}). ` +
              `Bu host Cloudflare arkasında ve Cloudflare ${portMatch} portunu YAYINLAMAZ — ya Mikro'nun verdiği ` +
              `port için DOĞRU HOST adresini (ör. firma-özel origin adresi) kullanın, ya da sunucu IP'nizin ` +
              `o port için whitelist'e eklendiğini Mikro destekten teyit edin. Ham hata: ${raw}`
            : `Mikro API'ye ulaşılamadı. MIKRO_API_URL portsuz görünüyor; Mikro'nun verdiği portu (V17=8094, V16=8084) ekleyin. Ham hata: ${raw}`)
        : raw;
      console.warn('Mikro status probe error:', raw, '| base:', MIKRO_API_BASE);
      res.json({ configured: true, connected: false, mode: MIKRO_LOCAL_MODE ? 'local' : 'cloud', apiBase: MIKRO_API_BASE, networkError: netFail, error: hint });
    }
  });

  /** POST /api/mikro/stok/kaydet — push inventory item → Mikro StokKaydetV2 */
  app.post('/api/mikro/stok/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { item, firebaseId } = req.body as { item: Record<string, unknown>; firebaseId: string };
    if (await belgeSahipligi('inventory', firebaseId, await C.reqCompanyId(req)) === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    const t0 = Date.now();

    try {
      // Gövde TEK KAYNAKTA: src/server/mikro/govdeStokCari.ts (stokGovdesi) — Faz 3 3/n.
      // `sto_perakende_vergi` YÜZDE DEĞİL, VergiListesiV2 sıra no'suna İŞARETÇİdir
      // (mikroClient.ts mikroVergiOranlari başlığı, 2026-07-31 canlı bulgusu): eski sabit 20
      // müşterinin tablosunda OLMAYAN bir sıraydı. Oran→işaretçi ters araması için tablo geçilir.
      // Bilinmeyen SKU/ad/birim/KDV oranı/fiyat → MikroGovdeHatasi → 400 (mikroPost çağrılmaz).
      const stok = stokGovdesi(item, await mikroVergiOranlari());

      const { ok, data, status } = await mikroPost('StokKaydetV2', { stoklar: [stok] }, true); // V17: stoklar Mikro objesi İÇİNDE (inMikro)
      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const mikroStoKod = stok.sto_kod;
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('StokKaydetV2', 'inventory', firebaseId, success, mikroStoKod, errorMsg, duration, C.reqActor(req));
      if (success) void mirrorMikroStoklar([stok]);

      if (C.getAdminDb() && firebaseId && success) {
        await C.getAdminDb().collection('inventory').doc(firebaseId).update({
          mikroStoKod,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
        });
      }

      res.json({ success, mikroStoKod, error: errorMsg, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('StokKaydetV2', 'inventory', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      if (mikroGovdeHatasiMi(err)) {   // gövde kurulamadı → Mikro'ya HİÇ gidilmedi: istemci hatası, sunucu arızası değil
        console.warn('Mikro StokKaydetV2 gövdesi kurulamadı:', errorMsg);
        return res.status(400).json({ success: false, error: errorMsg });
      }
      console.error('Mikro StokKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/stok/listesi — pull Mikro StokListesiV2 → Firebase */
  app.post('/api/mikro/stok/listesi', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { stokKod = '', ilkTarih = '2020-01-01', size = 100, index = 0 } = req.body || {};
    const t0 = Date.now();

    try {
      const { ok, data, status } = await mikroPost('StokListesiV2', {
        StokKod:   stokKod,
        TarihTipi: 2,
        IlkTarih:  ilkTarih,
        SonTarih:  `${new Date().getFullYear() + 1}-12-31`,
        Sort:      'sto_kod',
        Size:      String(size),
        Index:     index,
      });

      if (!ok) return res.status(status).json({ success: false, error: data });

      const stoklar = (mikroData(data).StokListesi ?? []) as Record<string, unknown>[];
      void mirrorMikroStoklar(stoklar);

      // Mirror matched items back to Firebase
      if (C.getAdminDb() && Array.isArray(stoklar)) {
        const stokCompanyId = await C.reqCompanyId(req);
        for (const s of stoklar) {
          const sku = s.sto_kod as string;
          if (!sku) continue;
          // KİRACI İZOLASYONU (2026-09-19): eski `.limit(1)` ilk eşleşeni alıyordu — aynı SKU başka kiracıda da
          // varsa ONUN ürününe stockLevel yazılabiliyordu. Çağıranın (ya da etiketsiz eski) kaydı seçilir.
          const snap = await C.getAdminDb().collection('inventory').where('sku', '==', sku).get();
          const hedef = snap.docs.find(dk => {
            const dc = ((dk.data() as Record<string, unknown>).companyId as string | undefined) || '';
            return !dc || dc === stokCompanyId;
          });
          if (hedef) {
            const qty = mikroStokMiktari(s);
            await hedef.ref.update({
              mikroStoKod:   sku,
              mikroSynced:   true,
              // Miktar alanı yoksa mevcut stockLevel'i EZME (bkz. mikroStokMiktari).
              ...(qty !== null ? { stockLevel: qty } : {}),
              mikroSyncedAt: pgServerTimestamp(),
            });
          }
        }
      }

      await C.writeAuditLog(C.reqActor(req), 'Mikro Stok Listesi Çekme', `${Array.isArray(stoklar) ? stoklar.length : 0} stok kaydı çekildi`);
      res.json({ success: true, count: Array.isArray(stoklar) ? stoklar.length : 0, data: stoklar, duration: Date.now() - t0 });
    } catch (err) {
      console.error('Mikro StokListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/cari/kaydet — push lead/customer/supplier → Mikro CariKaydetV2.
   *  `collection` (varsayilan 'leads') hangi Firebase koleksiyonuna mikroCariKod
   *  yazilacagini belirler - 'suppliers' icin de kullanilabilir (Satinalma
   *  modulundeki tedarikci-Mikro eslestirme). */
  app.post('/api/mikro/cari/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { lead, firebaseId } = req.body as { lead: Record<string, unknown>; firebaseId: string };
    // Koleksiyon adı ÇALIŞMA ANINDA beyaz listeden: eski `as { collection?: 'leads' | 'suppliers' }` yalnız bir TİP
    // iddiasıydı — istemci `collection: 'settings'` gönderip adminDb ile (RBAC dışı) herhangi bir koleksiyondaki
    // dokümana mikroSynced/mikroCariKod yazdırabiliyordu (2026-09-19).
    const targetCollection: 'leads' | 'suppliers' = (req.body as { collection?: unknown })?.collection === 'suppliers' ? 'suppliers' : 'leads';
    if (await belgeSahipligi(targetCollection, firebaseId, await C.reqCompanyId(req)) === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    const t0 = Date.now();

    try {
      // Gövde TEK KAYNAKTA: src/server/mikro/govdeStokCari.ts (cariGovdesi) — Faz 3 3/n.
      // Cari kodu (mikroCariKod yoksa CAR+firebaseId ilk 6) ve unvan orada ZORUNLU:
      // firebaseId de yoksa zaman damgasından kod UYDURULMAZ, 400 döner.
      const cari = cariGovdesi(lead, firebaseId);
      const cariKod = cari.cari_kod;

      // inMikro: V17 evrak kalıbı — payload (cariler) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('CariKaydetV2', { cariler: [cari] }, true);
      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('CariKaydetV2', targetCollection === 'suppliers' ? 'supplier' : 'lead', firebaseId, success, cariKod, errorMsg, duration, C.reqActor(req));
      if (success) void mirrorMikroCariler([cari]);

      if (C.getAdminDb() && firebaseId && success) {
        await C.getAdminDb().collection(targetCollection).doc(firebaseId).update({
          mikroCariKod:  cariKod,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
          // e-Fatura kaydı BİLİNMEDEN gönderilen cari: gövdeye `cari_efatura_fl: 0` gitti ve saatlik cron onu
          // `eFaturaKayitli: false` = "kayıtlı değil, BİLİNİYOR" diye geri yazacak. O bilgi sahtedir ve artık belge
          // tipini (e-Arşiv!) belirliyor — işaretle ki `musteriBelgeTipi` güvenmesin (utils/siparisler/belgeTipi).
          ...(typeof lead.eFaturaKayitli === 'boolean' ? {} : { eFaturaKaydiTeyitsiz: true }),
        });
      }

      res.json({ success, cariKod, error: errorMsg, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('CariKaydetV2', targetCollection === 'suppliers' ? 'supplier' : 'lead', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      if (mikroGovdeHatasiMi(err)) {   // gövde kurulamadı → Mikro'ya HİÇ gidilmedi
        console.warn('Mikro CariKaydetV2 gövdesi kurulamadı:', errorMsg);
        return res.status(400).json({ success: false, error: errorMsg });
      }
      console.error('Mikro CariKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  /** POST /api/mikro/cari/listesi — pull Mikro CariListesiV2 → Firebase.
   *  `nameSearch` (serbest kullanici girdisi, ornegin tedarikci arama kutusu)
   *  ISTEMCIDEN GELEN whereStr'i GECERSIZ KILAR ve sunucu tarafinda tek tirnak
   *  escape edilerek guvenli bir LIKE filtresine cevrilir - Mikro'nun kendi
   *  WhereStr'i serbest SQL parcasi kabul ettigi icin (SqlVeriOkuV2/ListesiV2
   *  ortak deseni) dogrudan client whereStr'i arama girdisiyle beslemek
   *  Mikro'nun sorgusuna enjeksiyon acardi. */
  app.post('/api/mikro/cari/listesi', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    { const kilit = await yaziciyiIstegeBagla(C.getPgPool?.(), `mikro-cari-listesi:${Date.now().toString(36)}`, res); if (kilit) return res.status(423).json({ success: false, error: `Bakım kilidi: ${kilit.aciklama} (${kilit.baslangic}) — veri bakımı bitince tekrar deneyin.` }); }   // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts)
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // 2026-07-31'de YENİDEN YAZILDI. Eski hali iki yönden eksikti:
    //  1) SAYFALAMA YOKTU — tek çağrı, `index` hiç artmıyordu. Bugün Mikro'da
    //     tam 200 cari olduğu için zarar görünmüyordu (sayfa boyutu da 200),
    //     ama 201. cari eklendiği gün gerisi SESSİZCE kaybolacaktı.
    //  2) YENİ MÜŞTERİ OLUŞTURMUYORDU — yalnız mikroCariKod'u eşleşen mevcut
    //     lead'i güncelliyordu; eşleşmeyen atlanıyordu. "Oluşturuldu: 0" bundan.
    // Artık gece cron'uyla AYNI mantık: tam sayfalama + upsert, eşleme
    // önceliği mikroCariKod → VKN → isim (elle oluşturulmuş kayıtların
    // mikroCariKod'u olmadığı için salt-kod eşleşme onları ikinci kez yaratırdı).
    const body = req.body || {};
    const nameSearch = typeof body.nameSearch === 'string' ? body.nameSearch.trim().slice(0, 100) : '';
    // Mikro WhereStr serbest SQL parçası kabul eder; istemci whereStr'i ASLA
    // doğrudan geçirilmez (enjeksiyon). nameSearch escape'li LIKE'a çevrilir.
    const whereStr = nameSearch
      ? `cari_unvan1 LIKE '%${nameSearch.replace(/'/g, "''")}%'`
      : "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'";
    const SAYFA = 200;
    const MAKS_SAYFA = 50;   // 10.000 cari tavanı; çarparsa yanıtta bildirilir
    const t0 = Date.now();

    try {
      const cariler: Record<string, unknown>[] = [];
      let tavanaCarpti = false;
      for (let index = 0; index < MAKS_SAYFA; index++) {
        const { ok, data, status } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
          WhereStr:  whereStr,
          Sort:      'cari_kod',
          Size:      String(SAYFA),
          Index:     index,
        });
        if (!ok) return res.status(status).json({ success: false, error: mikroHata(data) });
        const sayfa = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];
        if (!sayfa.length) break;
        cariler.push(...sayfa);
        if (sayfa.length < SAYFA) break;
        if (index === MAKS_SAYFA - 1) tavanaCarpti = true;
      }
      void mirrorMikroCariler(cariler);

      // ── Upsert: eşleşen güncellenir, eşleşmeyen OLUŞTURULUR ──
      const companyId = await C.reqCompanyId(req);
      // KİRACI SINIRI: VKN (vergi no) eşleşmesi özellikle riskli — iki FARKLI
      // kiracının aynı gerçek firmayla müşteri ilişkisi olması gayet olası.
      // Filtre yoksa Kiracı A'nın senkronu Kiracı B'nin cari kaydını sessizce
      // ele geçirirdi (stok import'unda bugün bulunan sınıfın aynısı).
      const leadSnap = await C.tenantSnap('leads', companyId);
      const leadByKod = new Map<string, AdminDocRef>();
      const leadByVkn = new Map<string, AdminDocRef>();
      const leadByName = new Map<string, AdminDocRef>();
      const vknNorm = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !leadByKod.has(kod)) leadByKod.set(kod, d.ref);
        const vkn = vknNorm((data.taxId as string) || (data.taxNo as string));
        if (vkn && !leadByVkn.has(vkn)) leadByVkn.set(vkn, d.ref);
        // İsim anahtarı TEK KAYNAK (isimAnahtari.ts, Türkçe locale) — gelen taraf da aynı fonksiyon.
        const nameKey = firmaAnahtari(data);
        if (nameKey && !leadByName.has(nameKey)) leadByName.set(nameKey, d.ref);
      }

      let yeni = 0, guncel = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };
      // Gövde/eşleme TEK KAYNAKTA (server/mikro/eslemeCari.ts): bilinmeyen alan
      // YAZILMAZ (update mevcut değeri korur), `status` YALNIZ yeni kayıtta.
      const eslemeler: CariEsleme[] = [];
      for (const c of cariler) {
        const esleme = cariEsle(c, { companyId, zamanDamgasi: pgServerTimestamp() });
        if (!esleme) continue;                       // cari_kod yok → satır atlanır (eski `if (!kod) continue`)
        eslemeler.push(esleme);
        const { cariKod: kod, alanlar } = esleme;
        const vkn = vknNorm(typeof alanlar.taxId === 'string' ? alanlar.taxId : '');
        const nameKey = isimAnahtari(alanlar.name);
        const ref = leadByKod.get(kod)
          || (vkn ? leadByVkn.get(vkn) : undefined)
          || (nameKey ? leadByName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, alanlar); guncel++; }
        else {
          const newRef = C.getAdminDb().collection('leads').doc();
          batch.set(newRef, { ...alanlar, ...esleme.yeniKayitAlanlari, source: 'mikro_import', createdAt: pgServerTimestamp() });
          leadByKod.set(kod, newRef);
          yeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      const eslemeOzeti = cariEslemeOzeti(eslemeler);
      if (eslemeOzeti.okumaArizasi.length) console.warn('[cari/listesi] okuma arızası:', eslemeOzeti.not);

      const duration = Date.now() - t0;
      const ozet = `${cariler.length} cari çekildi — ${yeni} yeni, ${guncel} güncellendi${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}${eslemeOzeti.not ? ` — ${eslemeOzeti.not}` : ''}`;
      await C.writeSyncLog('CariListesiV2', 'lead', ozet, true, null, null, duration, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Cari Listesi Çekme', ozet);
      res.json({ success: true, count: cariler.length, created: yeni, updated: guncel,
                 ...(tavanaCarpti ? { truncated: true, limit: MAKS_SAYFA * SAYFA } : {}),
                 ...(eslemeOzeti.not ? { note: eslemeOzeti.not } : {}), duration });
    } catch (err) {
      console.error('Mikro CariListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/siparis/kaydet — push order → Mikro SiparisKaydetV2 */
  app.post('/api/mikro/siparis/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { order, firebaseId } = req.body as { order: Record<string, unknown>; firebaseId: string };
    if (await belgeSahipligi('orders', firebaseId, await C.reqCompanyId(req)) === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    const t0 = Date.now();

    try {
      const lineItems = (order.lineItems || []) as Record<string, unknown>[];
      if (lineItems.length === 0) {
        return res.status(400).json({ success: false, error: 'Sipariş satırı bulunamadı.' });
      }

      // Gövde TEK KAYNAKTA: src/server/mikro/govdeSiparis.ts (siparisGovdesi) — Faz 3 3/n.
      // Alan adları, sıra ve Mikro sabitleri (sip_tip '0' = SATIŞ / C14 canlı doğrulama
      // notu dahil) orada; testi govdeSiparis.test.ts. Kapatılan sahte varsayılanlar:
      //   sip_b_fiyat  price||0        → fiyatsız satır 0 TL yazılıyordu
      //   sip_miktar   quantity||1     → miktarsız satır 1 adet
      //   sip_tutar    total || (0*1)  → iki uydurmanın çarpımı
      //   sip_vergi_pntr sabit 4       → artık kalemin KDV oranından TERS arama (VergiListesiV2)
      //   sip_depono   sabit 1         → 2026-09-05: depo 1 = HAVALİMANI, stok depo 2'de
      // ve `new Date(Timestamp)` → "NaN.NaN.NaN" tarihi. Bilinmeyen alan artık
      // MikroGovdeHatasi fırlatır → aşağıdaki catch 400 döner, mikroPost HİÇ çağrılmaz.
      //
      // `mikroVergiOranlari()` bir AĞ çağrısıdır ve bilerek try içindedir: okunamazsa BOŞ
      // Map döner ve gövde kurucu "vergi işaretçisi bilinmiyor (Mikro vergi tablosu
      // okunamadı — VergiListesiV2)" ile 400 verir — sessizce 4 (=%20) yazmaz.
      const vergiTablosu = await mikroVergiOranlari();
      const { satirlar, govde } = siparisGovdesi(order, { vergiTablosu });

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      // `govde.evraklar[0].satirlar === satirlar` (modül testiyle kilitli) — aşağıdaki
      // ayna çağrısı aynı diziyi yazar.
      const { ok, data, status } = await mikroPost('SiparisKaydetV2', govde, true);

      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      // Numara METNE normalize edilir (sayısal Mikro yanıtı sessizce düşmesin): src/server/mikro/belgeNo.ts
      const mikroEvrakNo = belgeNoMetni(md?.evrakNo, md?.EvrakNo, md?.id);
      const errorMsg = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('SiparisKaydetV2', 'order', firebaseId, success, mikroEvrakNo, errorMsg, duration, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_siparisler', satirlar as unknown as Record<string, unknown>[], SIP_COLS);

      if (C.getAdminDb() && firebaseId && success) {
        await C.getAdminDb().collection('orders').doc(firebaseId).update({
          mikroEvrakNo,
          mikroSynced:   true,
          mikroSyncedAt: pgServerTimestamp(),
        });
      }

      res.json({ success, mikroEvrakNo, error: errorMsg, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('SiparisKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      if (mikroGovdeHatasiMi(err)) {   // gövde kurulamadı → Mikro'ya HİÇ gidilmedi: veri eksik, sunucu arızası değil
        // 500 "sunucu bozuk, tekrar dene" demek olurdu; burada eksik olan SİPARİŞTİR ve
        // kullanıcı alanı doldurmadan tekrar denemenin anlamı yok. İstemci
        // (mikroService.syncOrderToMikro → App.tsx syncOrderWithCari) `error` metnini toast'ta gösterir.
        console.warn('Mikro SiparisKaydetV2 gövdesi kurulamadı:', errorMsg);
        return res.status(400).json({ success: false, error: errorMsg });
      }
      console.error('Mikro SiparisKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Full Import Routes ─────────────────────────────────────────────────
  // These UPSERT — create new Firebase docs for items that don't exist yet,
  // update existing ones. Paginates automatically until all records are fetched.

  // ── Arka plan import işi (mikro-import-arkaplan, 2026-09-24) ─────────────────
  // Teşhis (CONFIRMED): iş HTTP isteğinin İÇİNDE bitiyordu, IIS/ARR ~120 sn'de kesip 502 dönüyordu.
  // 15 import ucu (stok, cari, stok-miktar, 12 SQL fabrika; 4 çağrı yeri) `src/server/mikro/arkaPlanIsi.ts` TEK
  // yardımcısına bağlanır: yanıt anında `{ success, started:true, job }` (job = ÖNEKSİZ isAdi, sözlük
  // `src/lib/mikroIsAdi.ts`), ilerleme/sonuç `jobs/<job>` dokümanında (istemci `useArkaPlanIsi` dinler).
  // Bağımlılık her istekte kurulur: `C.getAdminDb()`/`getPgPool()` server.ts'te SONRADAN atanan
  // getter'lardır, rota kayıt anında değer yok.
  const arkaPlanDep = (): ArkaPlanBagimlilik => ({
    db: C.getAdminDb(), writeSyncLog: C.writeSyncLog, writeAuditLog: C.writeAuditLog, pgPool: C.getPgPool?.(),
  });
  /** BaslatSonucu → HTTP. 423 metni `bakimKilidiMesaji` (rotalardaki kopyayla birebir; SQL uçları kilide
   *  bağlı olmadığı için o dal orada hiç düşmez); alreadyRunning'de `job` = ÇALIŞAN iş (K-C). */
  const arkaPlanYaniti = (res: Response, sonuc: BaslatSonucu) => {
    if ('kilit' in sonuc) return res.status(423).json({ success: false, error: bakimKilidiMesaji(sonuc.kilit) });
    if (!sonuc.started) return res.json({ success: true, started: false, alreadyRunning: true, job: sonuc.job });
    return res.json({ success: true, started: true, job: sonuc.job });
  };
  /** Sayfalama sayaçlarının özet eki: zaman aşımı ile bozuk kayıt AYRI söylenir (özet yalan söylemesin). */
  const zamanAsimiEki = (sayac: SayfaSayaclari): string =>
    (sayac.zamanAsimiSayfa ? ` / ${sayac.zamanAsimiSayfa} Mikro çağrısı zaman aşımı (daraltıldı)` : '') +
    (sayac.zamanAsimiKayit ? ` / ${sayac.zamanAsimiKayit} kayıt zaman aşımıyla ATLANDI — import EKSİK, yeniden çalıştırın` : '');
  /** KARAR: bozuk kayıt (Mikro tarafında kalıcı) bugün gibi success:true; zaman aşımı kaybı (geçici,
   *  tekrar denenebilir) success:false — özet "tamamlandı" deyip eksik bırakmasın. */
  const zamanAsimiHatasi = (sayac: SayfaSayaclari): string | null =>
    sayac.zamanAsimiKayit ? `${sayac.zamanAsimiKayit} kayıt zaman aşımıyla atlandı` : null;

  /** POST /api/mikro/import/stok — import ALL Mikro stock → Firebase inventory.
   *  ARKA PLAN İŞİ (2026-09-24): yanıt anında `{ started:true, job:'mikroImport-stok' }`; ilerleme/sonuç
   *  `jobs/mikroImport-stok` (created/updated/errors/bozukKayit/zamanAsimiSayfa/zamanAsimiKayit/fiyatliUrun/
   *  note/offset/sonSayfaMs/durationMs/error). Eski `{created,…}` yanıtı istemci şartnamesine devredildi. */
  app.post('/api/mikro/import/stok', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId (= uid of the account owner) — the app's
    // inventory listener filters on it, so imports MUST set it or items are invisible.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    // req YALNIZ burada okunur (yanıt ÖNCESİ); `calistir` gövdesi req/res bilmez.
    const companyId = await C.reqCompanyId(req);
    const actor = C.reqActor(req);
    const isAdi = mikroIsAdi('/api/mikro/import/stok');   // 'mikroImport-stok' — src/lib/mikroIsAdi.ts TEK sözlük
    const sonuc = await arkaPlanIsiBaslat(arkaPlanDep(), {
      isAdi, companyId, actor,
      senkronKaydi: { operation: 'ImportStok', entityType: 'inventory' },
      // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts). Kayıt artık İŞ ömrünce
      // durur (eski `yaziciyiIstegeBagla` yanıt bitince siliyordu — anında yanıtla bu, işi ilk saniyede
      // "yazıcı değil" sayardı).
      yaziciAdi: arkaPlanYaziciAdi(isAdi, Date.now()),
      calistir: async (ilerle) => {
      // Snapshot'lar aşağıda zaten çekiliyor; çözücüler ONLARIN id'lerinden
      // kurulur — aynı koleksiyonu istek başına iki kez tam gövdeyle taramamak
      // için (2026-08-22 verimlilik bulgusu). (Yanıt <1 sn kalsın diye ~2.367 doküman artık
      // `calistir` içinde, yanıttan SONRA okunur.)
      const invSnapOnce  = await C.tenantSnap('inventory', companyId);
      const depoSnapOnce = await C.tenantSnap('warehouses', companyId);
      const invId  = C.mikroIdCozucuIds(invSnapOnce.docs.map(d => d.id), companyId);
      const depoId = C.mikroIdCozucuIds(depoSnapOnce.docs.map(d => d.id), companyId);
      // ÇÖZÜCÜ, YAZILAN KOLEKSİYONUN KENDİSİNDEN kurulmalı: "eski biçimli id var mı"
      // kararı o koleksiyonun id'lerine bakar. Aşağıda warehouseItems ve
      // wmsLocations'a da yazılıyor; onlar için inventory/warehouses çözücüsünü
      // kullanmak kararı YANLIŞ koleksiyona sordurur ve C11'in kapatmaya
      // çalıştığı kiracılar-arası id çakışmasını geri getirir (code-review).
      const whItemId = await C.mikroIdCozucu('warehouseItems', companyId);

      const t0 = Date.now();   // yalnız log için; durationMs helper'da
      let created = 0, updated = 0, errors = 0;
      /** Sayfalama sayaçları (adaptifSayfalama.ts): bozuk kayıt ≠ zaman aşımı. */
      const sayac: SayfaSayaclari = { bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 };
      /** Mikro'dan en az bir satış fiyatı gelen ürün sayısı (özet raporlanır). */
      let fiyatliUrun = 0;
      /** Mikro'nun vermediği alanların satır sayacı — import notuna ve okuma arızası uyarısına girer. */
      const stokSayac = sayacOlustur();
      /** Görünen ad/kategori: stokEsle yazmıyorsa MEVCUT dokümandaki değeri kullan (warehouseItems
       *  + kategori senkronu için lazım); o da yoksa undefined → alan hiç yazılmaz (merge:true
       *  bayat değeri korur; '' ya da 'Genel' UYDURULMAZ). */
      const coz = (yeni: string | undefined, eski: unknown): string | undefined =>
        yeni ?? (typeof eski === 'string' && eski.trim() ? eski : undefined);

      // Prefetch ALL inventory docs → Map<sku, ref>. ETİKETSİZ (companyId boş)
      // eski kayıtlar bilerek dahil — SKU ile eşleşip iyileştirilir (companyId
      // yazılır), çoğaltılmaz. Ama BAŞKA kiracıya ait (companyId DOLU ve farklı)
      // kayıt haritaya HİÇ girmez: aşağıdaki `batch.update(existingRef, item)`
      // item.companyId'yi KOŞULSUZ yazıyor — filtre olmasa eşleşen yabancı doküman
      // bu kiracıya SESSİZCE devredilirdi (2026-08-11'de bulundu; en sık kullanılan
      // "Stokları İçeri Al" düğmesi). Yabancı SKU haritada yoksa YENİ doküman
      // açılır — kiracı başına ayrı kayıt, doğru multi-tenant davranışı.
      const existingSnap = invSnapOnce;   // yukarıda bir kez çekildi
      // Değer artık {ref, veri}: stokEsle MEVCUT dokümanı görmeli — Mikro bir alanı boş
      // döndüğünde elle düzeltilmiş ad/kategori/birim ve kullanıcının girdiği stok eşiği
      // EZİLMESİN diye (bkz. server/mikro/eslemeStok.ts başlığı, "bilinçli farklar").
      const existingBySku = new Map<string, { ref: AdminDocRef; veri?: Record<string, unknown> }>();
      for (const docSnap of existingSnap.docs) {
        const veri = docSnap.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = (veri.sku as string)?.trim();
        if (sku && !existingBySku.has(sku)) existingBySku.set(sku, { ref: docSnap.ref, veri });
      }

      // Vergi tablosunu bir kez çek: sto_perakende_vergi indeksini gerçek
      // yüzdeye çevirmek için gerekli (bkz. vergiOraniCoz).
      const vergiTablosu = await mikroVergiOranlari();

      // Depo adları — "Depo 2" yerine "ESKI SANAYI" gösterebilmek için.
      // Depo Tanımları import'u çalıştıysa warehouses'ta mikro-depo-<no> id'li
      // dokümanlar vardır. Yoksa harita boş kalır ve kod numarası gösterilir.
      const depoAdlari = new Map<string, string>();
      try {
        const depoSnap = depoSnapOnce;    // yukarıda bir kez çekildi
        for (const d of depoSnap.docs) {
          const x = d.data() as Record<string, unknown>;
          const no = x.depoNo;
          if (no != null && x.name) depoAdlari.set(String(no), String(x.name));
        }
      } catch { /* depo adı çözülemezse kod gösterilir */ }

      let batch = C.getAdminDb().batch();
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); batchOps = 0; }
      };

      // Mikro depo kodları (sto_yer_kod) → warehouses + wmsLocations + warehouseItems
      const depotCodes = new Map<string, number>(); // kod → ürün sayısı
      // Mikro'dan gelen gerçek kategoriler — import sonunda dummy chip'leri değiştirir
      const categorySet = new Set<string>();

      // ── Adaptif sayfalama ───────────────────────────────────────────────────
      // Gövde TEK KAYNAKTA: server/mikro/adaptifSayfalama.ts (araligiTopla). Bozuk aralık
      // 100 → 20 → 5 → 1 daraltılır; zaman aşımı (listeZamanAsimiMs()) AYRI sayılır.
      // try/catch YOK: throw'u `araligiTopla` sınıflar (TimeoutError → daralt, diğer → işi düşür;
      // Mikro hiç yanıt vermiyorsa devre kesici `MikroYanitVermiyorHatasi`, sürekli null/IsError dönüyorsa
      // `MikroVeriVermiyorHatasi` → iş error ile biter, kilit açılır).
      // Index = offset / size (Mikro Index sayfa numarasıdır).
      const fetchRange = async (offset: number, size: number): Promise<Record<string, unknown>[] | null> => {
        const { ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01',
          SonTarih: `${new Date().getFullYear() + 1}-12-31`,
          Sort: 'sto_kod', Size: String(size), Index: offset / size,
        }, false, { zamanAsimiMs: listeZamanAsimiMs() });
        if (!ok || typeof data === 'string') return null; // "Api Server Error" vb.
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!r0 || r0.IsError) return null;
        const rows = mikroData(data).StokListesi;
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
      };

      const CHUNK = 100;
      let offset = 0;
      let reachedEnd = false;
      while (!reachedEnd && offset < 50000) {
        // K-A: sonSayfaMs = bu CHUNK'ın TÜM Mikro süresi (daraltma alt çağrıları DÂHİL);
        // MIKRO_LISTE_ZAMAN_ASIMI_MS ayarı için ilk canlı koşuda jobs dokümanından okunur.
        const t = Date.now();
        const { rows: stoklar, end } = await araligiTopla(fetchRange, offset, CHUNK, ALT_STOK, sayac);
        const sonSayfaMs = Date.now() - t;
        void mirrorMikroStoklar(stoklar);
        reachedEnd = end;
        offset += CHUNK;
        if (stoklar.length === 0) { if (end) break; else continue; }

        for (const s of stoklar) {
          const sku = (s.sto_kod as string)?.trim();
          if (!sku) continue;

          try {
            // Gövde tek kaynakta (server/mikro/eslemeStok.ts → stokEsle): bilinmeyen alan
            // YAZILMAZ (update mevcut değeri korur) ve sayaca girer. Taşınan canlı-doğrulama
            // notları (sto_perakende_vergi İNDEKStir, fiyat kaynağı ayrı tablodur, boş `prices`
            // elle girilen fiyatı ezerdi, Retail yoksa `price: 0` uydurulmaz) o dosyanın
            // başlığında ve fonksiyon içi yorumlarında duruyor.
            const mevcutKayit = existingBySku.get(sku);
            const { alanlar, bilinmeyen } = stokEsle(s, mevcutKayit?.veri, { vergiTablosu });
            sayacaEkle(stokSayac, bilinmeyen);
            if (alanlar.prices) fiyatliUrun++;
            const qty = alanlar.stockLevel ?? null;
            const item = { companyId, ...alanlar, mikroSyncedAt: pgServerTimestamp() };

            const urunAdi     = coz(alanlar.name,     mevcutKayit?.veri?.name);
            const kategoriAdi = coz(alanlar.category, mevcutKayit?.veri?.category);

            // Upsert via batch: update if exists, create if not
            if (mevcutKayit) {
              batch.update(mevcutKayit.ref, item);
              updated++;
            } else {
              const newRef = C.getAdminDb().collection('inventory').doc();
              batch.set(newRef, { stockLevel: 0, ...item, createdAt: pgServerTimestamp() });
              // guard against duplicate SKUs across pages — ikinci kez YENİ doküman açılmasın
              existingBySku.set(sku, { ref: newRef, veri: item as Record<string, unknown> });
              created++;
            }
            batchOps++;

            if (kategoriAdi) categorySet.add(kategoriAdi);

            // Depo kaydı: Depo sekmesi warehouseItems koleksiyonundan okur
            // sto_yer_kod BOŞSA '1' UYDURMA (2026-08-01 düzeltmesi). Eski kod
            // `|| '1'` yapıyordu; Mikro'da bu alan doldurulmadığı için TÜM
            // ürünler "Depo 1"de görünüyordu, oysa stok fiilen 2 numarada.
            // Bilinmiyorsa bilinmiyor yazılır — yanlış depo göstermek, depo
            // göstermemekten kötüdür.
            const yerKod = String(s.sto_yer_kod ?? '').trim();
            if (yerKod) depotCodes.set(yerKod, (depotCodes.get(yerKod) ?? 0) + 1);
            const depoAdi = yerKod
              ? (depoAdlari.get(yerKod) || `Depo ${yerKod}`)
              : 'Depo belirtilmemiş';
            const whItemRef = C.getAdminDb().collection('warehouseItems')
              .doc(whItemId(sku.replace(/[/\\]/g, '_')));
            batch.set(whItemRef, {
              companyId,
              // Ad/kategori bilinmiyorsa (Mikro boş döndü, kayıt da yeni değil) alan
              // yazılmaz — merge:true mevcut adı korur; boş metin yazmak ekranda
              // ürünü isimsiz gösterirdi.
              ...(urunAdi ? { productName: urunAdi } : {}),
              sku,
              // Miktar bilinmiyorsa depo kaydının quantity'sini de EZME.
              ...(qty !== null ? { quantity: qty } : {}),
              ...(yerKod ? { warehouseId: `mikro-depo-${yerKod}` } : {}),
              location:    depoAdi,
              ...(kategoriAdi ? { category: kategoriAdi } : {}),
              source:      'mikro_import',
              updatedAt:   pgServerTimestamp(),
            }, { merge: true });
            batchOps++;

            if (batchOps >= 440) await commitBatch();
          } catch (itemErr) {
            console.warn(`Stok import hatası (${sku}):`, itemErr);
            errors++;
          }
        }

        console.log(`Stok import: offset ${offset} — toplam ${created + updated} işlendi${sayac.bozukKayit ? `, ${sayac.bozukKayit} bozuk kayıt atlandı` : ''}`);
        await ilerle({ processed: created + updated, created, updated, errors,
                       bozukKayit: sayac.bozukKayit, zamanAsimiSayfa: sayac.zamanAsimiSayfa, zamanAsimiKayit: sayac.zamanAsimiKayit,
                       offset, sonSayfaMs });
      }

      await commitBatch();

      // Depoları yaz: Depo sekmesi (warehouses) + Mobil WMS (wmsLocations)
      for (const [kod, itemCount] of depotCodes) {
        await C.getAdminDb().collection('warehouses').doc(depoId(`depo-${kod}`)).set({
          companyId,
          name:      `Depo ${kod}`,
          code:      kod,
          source:    'mikro_import',
          itemCount,
          updatedAt: pgServerTimestamp(),
        }, { merge: true });
        // wmsLocations BURADAN YAZILMIYOR (2026-08-28).
        // Bu döngü `sto_yer_kod` üzerinden dönüyor; o alan bu kurulumda tüm
        // ürünlerde boş, yani döngü hiç çalışmıyordu — Mobil WMS aylarca boş
        // kaldı. Üstelik buradaki kayıt `warehouseId` taşımıyordu, dolayısıyla
        // yazılsa bile ekranda Depo sütunu "—" görünürdü.
        // Yetkili kaynak: /api/mikro/import/depo (DEPOLAR tablosu), gerçek
        // depo adı + warehouseId ile yazar ve eski kayıtları temizler.
      }

      // Kategorileri senkronize et: Mikro kategorilerini ekle, kullanılmayan
      // (dummy seed) kategorileri kaldır. Chip listesi categories koleksiyonu +
      // envanterdeki gerçek kategorilerden türediği için bu güvenlidir.
      if (categorySet.size > 0) {
        // YALNIZ BU KİRACININ kategorileri (2026-08-22 denetim bulgusu C9).
        // Eskiden `collection('categories').get()` TÜM kiracıların kategorilerini
        // okuyor ve Mikro setinde olmayan HER kategoriyi siliyordu — B kiracısı
        // import çalıştırınca A kiracısının elle açtığı kategoriler gidiyordu.
        // Yeni kategoriler de companyId'siz yazılıyordu (herkese görünür).
        const mevcutKats = await C.loadCompanyDocs('categories', companyId);
        const catBatch = C.getAdminDb().batch();
        const seen = new Set<string>();
        for (const cat of mevcutKats) {
          const name = (cat.name as string) || '';
          // Yalnız Mikro'dan gelmiş (source:'mikro_import') olup artık Mikro'da
          // olmayanı sil — kullanıcının ELLE açtığı kategoriye dokunma. Eski
          // davranış "Mikro setinde yoksa sil" idi ve elle açılanları da yutuyordu.
          const mikroKaynakli = (cat.source as string) === 'mikro_import';
          if (!categorySet.has(name)) {
            if (mikroKaynakli) catBatch.delete(C.getAdminDb().collection('categories').doc(String(cat.id)));
          } else seen.add(name);
        }
        for (const name of categorySet) {
          if (!seen.has(name)) {
            catBatch.set(C.getAdminDb().collection('categories').doc(), {
              name, source: 'mikro_import', companyId,
              createdAt: pgServerTimestamp(),
            });
          }
        }
        await catBatch.commit();
      }

      const duration = Date.now() - t0;
      // Fiyat kapsamı GÖRÜNÜR olmalı: import "2367 güncellendi" deyip fiyatların
      // hiç gelmediğini gizliyordu (kullanıcı ekranda 0 TL görünce fark etti).
      // fiyatliUrun = 0 ise sorun Cetpa'da değil, Mikro kartlarında fiyat yok demektir.
      const fiyatNot = `${fiyatliUrun}/${created + updated} üründe satış fiyatı bulundu`;
      // Bilinmeyen alan sayacı + OKUMA ARIZASI: bir alan satırların TAMAMINDA boşsa bu veri
      // değil kolon adı/şema sorunudur — uyarı notun BAŞINA girer (sessiz-sıfır sınıfının
      // import karşılığı; ekranda "2367 güncellendi" deyip alanın hiç gelmediğini gizlemesin).
      // KRİTİK küme: STOK_KRITIK (ürün adı + KDV oranı). Miktar ve fiyat BİLEREK dışarıda —
      // liste ucu miktar taşımıyor, fiyat kapsamını `fiyatNot` zaten ayrıca söylüyor.
      const stokArizalari = okumaArizalari(stokSayac, STOK_KRITIK);
      const uyari = okumaArizasiNotu(stokArizalari);
      if (uyari) console.warn('[import/stok]', uyari);
      const sayacMetni = sayacNotu(stokSayac, stokArizalari);
      const note = [uyari, fiyatNot, sayacMetni].filter(Boolean).join(' — ');
      const ozet = `${created} yeni / ${updated} güncel — ${note}${sayac.bozukKayit ? ` / ${sayac.bozukKayit} bozuk atlandı` : ''}${zamanAsimiEki(sayac)}`;
      console.log(`Stok import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, ${note}, hata: ${errors}, bozuk atlanan: ${sayac.bozukKayit}, zaman aşımı: ${sayac.zamanAsimiKayit}, süre: ${duration}ms`);
      // syncLog'u helper yazar (aynı argümanlar: ImportStok / inventory / ozet / success / duration / actor).
      return {
        jobAlanlari: { created, updated, errors, bozukKayit: sayac.bozukKayit, zamanAsimiSayfa: sayac.zamanAsimiSayfa,
                       zamanAsimiKayit: sayac.zamanAsimiKayit, fiyatliUrun, note },
        ozet, basarili: sayac.zamanAsimiKayit === 0, hata: zamanAsimiHatasi(sayac),
      };
      },
    });
    return arkaPlanYaniti(res, sonuc);
  });

  /** POST /api/mikro/import/cari — import ALL Mikro cari → Firebase leads.
   *  ARKA PLAN İŞİ (2026-09-24): yanıt anında `{ started:true, job:'mikroImport-cari' }`; ilerleme/sonuç
   *  `jobs/mikroImport-cari` (created/updated/errors/bozukKayit/zamanAsimiSayfa/zamanAsimiKayit/sayfa/sonSayfaMs/note/error). */
  app.post('/api/mikro/import/cari', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId — the app's leads listener filters on it.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    // req YALNIZ burada okunur (yanıt ÖNCESİ); `calistir` gövdesi req/res bilmez.
    const companyId = await C.reqCompanyId(req);
    const actor = C.reqActor(req);
    const isAdi = mikroIsAdi('/api/mikro/import/cari');   // 'mikroImport-cari' — src/lib/mikroIsAdi.ts TEK sözlük
    const sonuc = await arkaPlanIsiBaslat(arkaPlanDep(), {
      isAdi, companyId, actor,
      senkronKaydi: { operation: 'ImportCari', entityType: 'lead' },
      // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts); kayıt İŞ ömrünce durur.
      yaziciAdi: arkaPlanYaziciAdi(isAdi, Date.now()),
      calistir: async (ilerle) => {
      const t0 = Date.now();   // yalnız log için; durationMs helper'da
      let created = 0, updated = 0, errors = 0;
      const PAGE_SIZE = 500;
      /** Sayfalama sayaçları (adaptifSayfalama.ts): bozuk kayıt ≠ zaman aşımı. */
      const sayac: SayfaSayaclari = { bozukKayit: 0, zamanAsimiSayfa: 0, zamanAsimiKayit: 0 };

      // Prefetch ALL leads → Map<mikroCariKod, ref> + Map<VKN, ref> + Map<isim, ref>.
      // ETİKETSİZ (companyId boş) eski kayıtlar bilerek dahil — cari koduyla
      // eşleşip iyileştirilir. VKN/isim fallback'i şart: manuel oluşturulmuş
      // (CRM/Muhasebe/B2B formları) bir lead'in hiç mikroCariKod'u olmaz.
      // KİRACI SINIRI: BAŞKA kiracıya ait (companyId DOLU ve farklı) kayıt
      // haritaya girmez — VKN eşleşmesi özellikle riskli, iki farklı kiracının
      // aynı gerçek firmayla müşteri ilişkisi olması olası (2026-08-11'de bulundu).
      const normalizeVkn = (v?: string) => (v || '').replace(/\D/g, '');
      const existingSnap = await C.tenantSnap('leads', companyId);
      const existingByKod = new Map<string, AdminDocRef>();
      const existingByVkn = new Map<string, AdminDocRef>();
      const existingByName = new Map<string, AdminDocRef>();
      for (const docSnap of existingSnap.docs) {
        const data = docSnap.data();
        const dc = (data.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !existingByKod.has(kod)) existingByKod.set(kod, docSnap.ref);
        const vkn = normalizeVkn((data.taxId as string) || (data.taxNo as string));
        if (vkn && !existingByVkn.has(vkn)) existingByVkn.set(vkn, docSnap.ref);
        // İsim anahtarı TEK KAYNAK (isimAnahtari.ts, Türkçe locale) — gelen taraf da aynı fonksiyon.
        const nameKey = firmaAnahtari(data);
        if (nameKey && !existingByName.has(nameKey)) existingByName.set(nameKey, docSnap.ref);
      }

      let batch = C.getAdminDb().batch();
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); batchOps = 0; }
      };

      // Tüm sayfaların eşlemeleri — döngü bitince `cariEslemeOzeti` ile sayaç/uyarı
      // üretilir. Sayfalama döngüsünün DIŞINDA durmalı: içeride tanımlanırsa her
      // sayfa sayacı sıfırlar ve "hiçbir satırda okunamadı" kararı yanlış çıkar.
      const eslemeler: CariEsleme[] = [];

      // ── Sayfalama: TEK KAYNAK server/mikro/adaptifSayfalama.ts (stok import'uyla aynı) ──
      // GÖRÜNÜR fark (kabul edilen sapma 3): eski `if (!ok) break;` sayfalamayı SESSİZCE bitiriyordu,
      // kısmi import "tamamlandı" görünüyordu. Artık bozuk aralık 500 → 100 → 20 → 5 → 1 daraltılır,
      // gerçekten bozuk kayıt sayılır, devam edilir (Mikro hiç yanıt vermiyorsa devre kesici işi
      // `MikroYanitVermiyorHatasi`, SÜREKLİ null/IsError dönüyorsa `MikroVeriVermiyorHatasi` ile bitirir —
      // adaptifSayfalama.ts; eskiden 63.100 çağrı + "50000 bozuk atlandı" success:true). Gövde (FieldName/WhereStr/Sort) BİREBİR;
      // Index = offset / size (500'lük ilk seviyede eski `index`e eşit).
      const getir = async (offset: number, size: number): Promise<Record<string, unknown>[] | null> => {
        const { ok, data } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi,cari_muh_kod',
          WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
          Sort: 'cari_kod', Size: String(size), Index: offset / size,
        }, false, { zamanAsimiMs: listeZamanAsimiMs() });
        if (!ok || typeof data === 'string') return null;   // "Api Server Error" vb. → daralt
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!r0 || r0.IsError) return null;
        // Eski kodun `CariListesi ?? []` paritesi: OK yanıtta liste alanı yoksa "sayfa boş" (liste bitti)
        // sayılır, daraltmaya DÜŞÜRÜLMEZ (bilinçli fark: stok `fetchRange` orada null döner — 709 paritesi).
        const rows = mikroData(data).CariListesi ?? [];
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
      };

      let offset = 0;
      let end = false;
      while (!end && offset < 50000) {
        // K-A: sonSayfaMs = bu sayfanın TÜM Mikro süresi (daraltma alt çağrıları DÂHİL).
        const t = Date.now();
        const sayfaSonucu = await araligiTopla(getir, offset, PAGE_SIZE, ALT_CARI, sayac);
        const sonSayfaMs = Date.now() - t;
        const cariler = sayfaSonucu.rows;
        end = sayfaSonucu.end;
        offset += PAGE_SIZE;
        void mirrorMikroCariler(cariler);
        if (cariler.length === 0) { if (end) break; else continue; }

        for (const c of cariler) {
          // Gövde/eşleme TEK KAYNAKTA (server/mikro/eslemeCari.ts).
          const esleme = cariEsle(c, { companyId, zamanDamgasi: pgServerTimestamp() });
          if (!esleme) continue;                     // cari_kod yok → satır atlanır
          const { cariKod, alanlar } = esleme;       // `try` DIŞINDA: catch mesajı cariKod'u kullanıyor

          try {
            eslemeler.push(esleme);
            // Upsert oncelik sirasi: mikroCariKod (zaten Mikro'yla eslesmis) ->
            // VKN (en guvenilir kimlik) -> case-insensitive isim.
            const vkn = normalizeVkn(typeof alanlar.taxId === 'string' ? alanlar.taxId : '');
            const nameKey = isimAnahtari(alanlar.name);
            const existingRef = existingByKod.get(cariKod)
              || (vkn ? existingByVkn.get(vkn) : undefined)
              || (nameKey ? existingByName.get(nameKey) : undefined);

            const targetRef = existingRef ?? C.getAdminDb().collection('leads').doc();
            if (existingRef) {
              batch.update(targetRef, alanlar);      // companyId zaten alanlar'da (self-heal)
              updated++;
            } else {
              // `source`/`status` YALNIZ yeni kayıtta: güncellemede elle açılan lead'in kökeni
              // ve kullanıcının işaretlediği durum EZİLMEZ. `source` için bu 2026-09-05
              // incelemesinde düzeltilmişti (import'a bir kez yakalanan elle lead 'mikro_import'
              // oluyor, birleştirme scripti onu Mikro kopyası sanıp SİLEBİLİRDİ); `status`
              // aynı sınıftaydı ve atlanmıştı — her import kullanıcının işaretlediği durumu
              // 'Active'e geri alıyordu. Artık ikisi de `yeniKayitAlanlari`/burada.
              batch.set(targetRef, { ...alanlar, ...esleme.yeniKayitAlanlari, source: 'mikro_import', createdAt: pgServerTimestamp() });
              created++;
            }
            existingByKod.set(cariKod, targetRef);
            if (vkn) existingByVkn.set(vkn, targetRef);
            if (nameKey) existingByName.set(nameKey, targetRef);
            batchOps++;
            if (batchOps >= 450) await commitBatch();
          } catch (itemErr) {
            console.warn(`Cari import hatası (${cariKod}):`, itemErr);
            errors++;
          }
        }

        console.log(`Cari import: sayfa ${offset / PAGE_SIZE} tamamlandı — toplam ${created + updated} işlendi`);
        await ilerle({ processed: created + updated, created, updated, errors, sayfa: offset / PAGE_SIZE,
                       bozukKayit: sayac.bozukKayit, zamanAsimiSayfa: sayac.zamanAsimiSayfa, zamanAsimiKayit: sayac.zamanAsimiKayit,
                       sonSayfaMs });
      }

      await commitBatch();

      const duration = Date.now() - t0;
      const eslemeOzeti = cariEslemeOzeti(eslemeler);
      if (eslemeOzeti.okumaArizasi.length) console.warn('[import/cari] okuma arızası:', eslemeOzeti.not);
      const ozet = `${created} yeni / ${updated} güncel${eslemeOzeti.not ? ` — ${eslemeOzeti.not}` : ''}` +
        `${sayac.bozukKayit ? ` / ${sayac.bozukKayit} bozuk atlandı` : ''}${zamanAsimiEki(sayac)}`;
      console.log(`Cari import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, bozuk: ${sayac.bozukKayit}, zaman aşımı: ${sayac.zamanAsimiKayit}, süre: ${duration}ms`);
      // syncLog'u helper yazar (ImportCari / lead / ozet / success / duration / actor).
      return {
        jobAlanlari: { created, updated, errors, bozukKayit: sayac.bozukKayit, zamanAsimiSayfa: sayac.zamanAsimiSayfa,
                       zamanAsimiKayit: sayac.zamanAsimiKayit, note: eslemeOzeti.not ?? null },
        ozet, basarili: sayac.zamanAsimiKayit === 0, hata: zamanAsimiHatasi(sayac),
      };
      },
    });
    return arkaPlanYaniti(res, sonuc);
  });

  // ── Mikro Genel Liste Import'ları ────────────────────────────────────────────
  // Mikro list methodlarının yanıt alan adları belgelenmemiş — Data içindeki ilk
  // diziyi alır, satırları ham haliyle hedef koleksiyona yazar. Doc id: _Guid ile
  // biten ilk alan, yoksa otomatik. UI panelleri ham alanları gösterebilir.

  /** Data objesi içindeki ilk diziyi döndür (anahtar adı ne olursa olsun) */
  /** @deprecated mikroSatirlar kullan — o, dizi-sarmalı zarfı da açar.
   *  Burada yalnız geriye uyum için duruyor; çağıranlar mikroSatirlar'a geçti. */
  function firstArrayIn(d: Record<string, unknown>): Record<string, unknown>[] {
    for (const v of Object.values(d)) if (Array.isArray(v)) return v as Record<string, unknown>[];
    return [];
  }
  void firstArrayIn;

  /** Satırda regex ile alan anahtarı bul (örnek satırdan tespit) */

  /** Kolon seç: desenleri SIRAYLA dener, ilk eşleşeni döndürür. En SPESİFİK desen
   *  başa yazılır.
   *
   *  Neden gerekli: `findKey` tek bir gevşek desenle ilk eşleşen kolonu döndürür ve
   *  bu sessizce YANLIŞ kolonu seçebilir. Gerçek örnek (2026-08-11'de yakalandı):
   *      findKey(row, /sfiyat_fiyati|fiyat/i)  ->  'sfiyat_Guid'
   *  çünkü "s·fiyat·_Guid" de "fiyat" içeriyor ve Guid ilk kolon. Sonuç:
   *  Number(guid) = NaN -> her satır elenir -> HİÇ fiyat yazılmaz ama iş "başarılı"
   *  görünür. Tam olarak bu projede tekrarlayan sessiz-sıfır arıza sınıfı.
   *
   *  Ek koruma: değer alanı ararken `*_Guid` kolonları atlanır (kimlik alanı asla
   *  tutar/ad/kod değildir). `guidDahil` ile bilinçli olarak açılabilir.
   */

  /** SqlVeriOkuV2 tabanlı liste import — V17'de karşılığı OLMAYAN liste
   *  metotlarının yerine geçer.
   *
   *  Neden: `SiparisListesiV2`, `FaturaListesiV2`, `StokHareketListesiV2`,
   *  `BankaListesiV2`, `KasaListesiV2`, `OdemePlanListesiV2`, `BarkodListesiV2`
   *  Mikro Jump V17'de YOK (Postman koleksiyonu + OpenAPI spec, ikisi de).
   *  V17'nin liste yüzeyi yalnız Stok/Cari listesi + SqlVeriOkuV2. Bu uçlar
   *  eskiden var olmayan metodu çağırıp sessizce boş dönüyordu.
   *
   *  `SELECT *` kullanılıyor: kolon adlarını önceden bilmeye gerek yok, satırlar
   *  ham haliyle saklanır ve mevcut postProcess/findKey alan tespiti aynen çalışır.
   *  Sayfalama SQL Server'ın OFFSET/FETCH'i ile (ORDER BY zorunlu).
   *
   *  GÜVENLİK: sorgu ham SQL olarak Mikro'ya gider. Tablo/sıralama adı sabit
   *  (kod içinde), tarih ve sayfa boyutu sqlTarih/sqlTamsayi ile KATI doğrulanır.
   *  İstemciden gelen hiçbir string doğrudan sorguya girmez.
   */
  /** SQL import'un ÇEKİRDEĞİ — hem HTTP route'u hem gece cron'u bunu çağırır.
   *  2026-07-31'de route handler'ından ayrıldı: cron'dan da koşabilmesi için.
   *  Ayrıntılı gerekçe makeMikroSqlImport'ta. */
  type SqlImportOpts = {
    route?:       string;
    tablo:        string;              // takma ad içerebilir: "TABLO t"
    siralama:     string;
    collection:   string;
    label:        string;
    tarihKolonu?: string;
    ekKosul?:     string;
    /** SELECT listesi (varsayılan '*'). JOIN'li sorgularda "t.*, x AS y" gibi. */
    secim?:       string;
    /** İstenen kolon adları — çalışma anında INFORMATION_SCHEMA'ya karşı süzülür;
     *  şemada OLMAYAN kolonlar düşürülür, import patlamaz. `secim` yerine kullanılır.
     *  Neden: elle yazılan tek bir yanlış kolon adı ("Invalid column name") TÜM
     *  import'u öldürüyordu — cha_vergi ve cha_ettn ile iki kez yaşandı. */
    secimKolonlari?: string[];
    /** FROM'a eklenecek JOIN ifadesi. Kod içinde SABİT — istemciden gelmez. */
    fromEk?:      string;
    /**
     * İptal bayrağı kolonu (ör. 'cha_iptal', 'sth_iptal'). Verilirse import
     * sonrası "iptal süpürgesi" koşar: aynı tarih penceresinde Mikro'da İPTAL
     * EDİLMİŞ satırların GUID'leri çekilir ve yerel kopyaları silinir.
     *
     * NEDEN GEREKLİ (2026-08-22 denetim bulgusu C17): ekKosul iptalleri dışlar,
     * yani bir kayıt önce geçerliyken inip SONRADAN Mikro'da iptal edilirse
     * import onu bir daha HİÇ görmez — `merge: true` de asla silmez. Yerel kopya
     * HAYALET olarak kalır ve ciro/KDV/stok rakamlarına sonsuza dek katılır.
     * Filtre tek başına bu sınıfı çözmez; süpürge çözer.
     */
    iptalKolonu?: string;
    /** Gece cron penceresi (K-B, 2026-09-24): 'tam' = tüm geçmiş her gece; { gun } = son N gün; yoksa cron
     *  politikası (90 gün). Tarih kolonu OLMAYAN 8 tanımda etkisiz (koşul hiç eklenmez → zaten tam).
     *  cari-hareket + fatura-listesi 'tam' (ÖLÇÜLDÜ: 1.594 satır); SIPARISLER/STOK_HAREKETLERI ÖLÇÜLMEDİ →
     *  90 gün KALIR, `SELECT COUNT(*)` ölçülünce 'tam'a alınır. */
    gecePenceresi?: 'tam' | { gun: number };
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  };

  /** Tarih penceresi koşulu — sayfa sorgusu VE iptal süpürgesi AYNI üreticiyi kullanır (iki yerde yazılmaz).
   *  `son === null` → ÜST SINIR YOK: eski `mikroBugun()` sınırı 30.09.2026 tarihli LUCA satırını düşürüyordu
   *  (teşhis ölçümü: aralık 23.04.2025..30.09.2026); cron da null geçer. */
  const tarihKosulu = (kolon: string, ilk: string, son: string | null): string =>
    son === null ? `${kolon} >= '${ilk}'` : `${kolon} BETWEEN '${ilk}' AND '${son}'`;
  /** Gövdedeki `sonTarih`: geçerli YYYY-MM-DD ise o, yoksa (boş/geçersiz) null = üst sınır YOK. */
  const ustSinir = (v: unknown): string | null => { const t = sqlTarih(v, ''); return t === '' ? null : t; };

  /** Ayrık birleşim (hakem 2026-09-25): sayımlar YALNIZ `ok:true` dalında var. Eski tek şekil hata
   *  dönüşlerinde `total: 0, truncated: false` yazıyordu — sahte kesinlik: sayfa 1'in 500 satırı PG'ye
   *  yazılmışken sayfa 2 düşünce "toplam 0" derdi ve arka plan işi bunu jobs dokümanına taşıyordu
   *  (kart '500/0 işlendi'). Tüketiciler (S4 fabrika, 2 cron) `ok` ile daraltmadan sayıya ERİŞEMEZ. */
  type SqlImportSonucu =
    | { ok: true; total: number; note: string | null; truncated: boolean; duration: number; guidsizSatir: number }
    | { ok: false; error: string; duration: number };

  async function mikroSqlImportCalistir(
    opts: SqlImportOpts,
    companyId: string,
    ilkTarih: string,
    sonTarih: string | null,   // null = üst sınır yok (tarihKosulu)
    actor: { uid: string; email: string },
    /** Sayfa başına ilerleme — HTTP arka plan yolu (S4) verir, cron GEÇMEZ. Yük jobs alan adı bilmez
     *  (cron ile ortak gövde); `sonSayfaMs` ZORUNLU alan (K-A): opsiyonel yapılırsa S4 `...a` ile
     *  sessizce düşer ve listeZamanAsimiMs() hiç ölçülemez. */
    ilerle?: (a: { sayfa: number; satir: number; sonSayfaMs: number }) => Promise<void>,
  ): Promise<SqlImportSonucu> {
    const t0 = Date.now();
    // Kararli kimligi (GUID) olmayan satir sayisi — mukerrer kayit riski.
    let guidsizSatir = 0;
    const SAYFA = 500;
    const MAKS_SAYFA = 40; // 20.000 satır tavanı — sessiz değil: syncLog özetinde 'SAYFA TAVANINA ÇARPTI' (cron dâhil) + HTTP yolunda jobs/<isAdi> truncated/limit
    if (!C.getAdminDb()) return { ok: false, error: 'Firebase Admin başlatılamadı.', duration: 0 };

    const kosullar: string[] = [];
    if (opts.ekKosul) kosullar.push(opts.ekKosul);
    if (opts.tarihKolonu) kosullar.push(tarihKosulu(opts.tarihKolonu, ilkTarih, sonTarih));
    const where = kosullar.length ? ` WHERE ${kosullar.join(' AND ')}` : '';

    // SELECT listesi. secimKolonlari verilmişse GERÇEK şemaya karşı süzülür:
    // Mikro sürümleri arasında kolon adları değişiyor ve elle yazılmış tek bir
    // yanlış ad ("Invalid column name 'cha_ettn'") tüm import'u öldürüyordu.
    // Artık olmayan kolon sessizce düşer — o alan eksik gelir, veri akmaya devam eder.
    let secim = opts.secim ?? '*';
    let dusenKolonlar: string[] = [];
    if (opts.secimKolonlari?.length) {
      const anaTablo = opts.tablo.trim().split(/\s+/)[0];
      const gercek = await mikroKolonlar(anaTablo);
      if (gercek.length) {
        const gercekSet = new Set(gercek.map(c => c.toLowerCase()));
        const kalan = opts.secimKolonlari.filter(c => gercekSet.has(c.toLowerCase()));
        dusenKolonlar   = opts.secimKolonlari.filter(c => !gercekSet.has(c.toLowerCase()));
        secim = kalan.length ? kalan.join(', ') : '*';
      }
      // Şema okunamadıysa '*' ile devam — daraltılmış liste uydurmaktan güvenli.
    }

    // ORDER BY kolonu da şemaya karşı doğrulanır: OFFSET/FETCH için ZORUNLU
    // olduğundan yanlış tek bir ad ("Invalid column name 'dbs_Guid'") ilk sayfayı,
    // dolayısıyla TÜM import'u öldürür — SELECT tarafında az önce kapatılan arıza
    // sınıfının aynısı (demirbas/maliyet-merkezi import'larının dbs_Guid/som_Guid
    // sıralaması hiç doğrulanmamıştı). Yalnız SADE tanımlayıcılar denetlenir;
    // "cha_tarihi DESC, cha_Guid" gibi bileşik ifadeler dokunulmadan geçer.
    let siralama = opts.siralama;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(siralama)) {
      const anaTablo2 = opts.tablo.trim().split(/\s+/)[0];
      const semaCols = await mikroKolonlar(anaTablo2);   // 10 dk önbellekli, ek maliyet yok
      if (semaCols.length && !semaCols.some(c => c.toLowerCase() === siralama.toLowerCase())) {
        const yedek = semaCols.find(c => /_Guid$/i.test(c)) ?? semaCols[0];
        console.warn(`[sqlImport ${anaTablo2}] sıralama kolonu '${siralama}' şemada yok → '${yedek}' kullanılıyor`);
        siralama = yedek;
      }
      // Şema okunamadıysa yazılan adla devam — uydurma kolon seçmekten güvenli.
    }

    const allRows: Record<string, unknown>[] = [];
    let sayfa = 0, total = 0, tavanaCarpti = false;
    try {
      while (sayfa < MAKS_SAYFA) {
        const offset = sayfa * SAYFA;
        // K-A: sonSayfaMs = YALNIZ Mikro sayfa süresi — aşağıdaki PG batch DAHİL DEĞİL
        // (MIKRO_LISTE_ZAMAN_ASIMI_MS ayarı bunu okur). Zaman aşımı `hata` olarak değil throw olarak
        // gelir (DOMException TimeoutError) → catch → syncLog(false), ok:false.
        const sayfaT0 = Date.now();
        const { rows, hata } = await mikroSql(
          `SELECT ${secim} FROM ${opts.tablo}${opts.fromEk ?? ''}${where} ` +
          `ORDER BY ${siralama} OFFSET ${offset} ROWS FETCH NEXT ${SAYFA} ROWS ONLY`,
          { zamanAsimiMs: listeZamanAsimiMs() },
        );
        const sonSayfaMs = Date.now() - sayfaT0;
        if (hata) {
          // Başarısızsa hiçbir şey yazma — yarım/boş veri gerçek veriyi ezmesin.
          await C.writeSyncLog(`SQL:${opts.tablo}`, opts.collection, opts.label, false, null, hata, Date.now() - t0, actor);
          return { ok: false, error: `${opts.label}: ${hata}`, duration: Date.now() - t0 };
        }
        if (!rows.length) break;

        let batch = C.getAdminDb().batch(); let ops = 0;
        for (const row of rows) {
          const guidKey = findKey(row, /_Guid$/i);
          // KARARLI KIMLIK YOKSA MUKERRER KAYIT URETILIR.
          // docId GUID'den turetilir; GUID yoksa RASTGELE id atanir ve bu
          // durumda import her calistirildiginda AYNI Mikro satiri YENI bir
          // dokuman olarak eklenir — 5 kosuda 5 kopya. Hicbir hata vermez,
          // yalnizca kayit sayisi sessizce sisip raporlari bozar. Bu yuzden
          // sayiliyor ve ozette YUKSEK SESLE bildiriliyor (2026-08-18).
          const kararliId = !!(guidKey && row[guidKey]);
          if (!kararliId) guidsizSatir++;
          const docId = kararliId
            ? String(row[guidKey as string])
            : C.getAdminDb().collection(opts.collection).doc().id;
          batch.set(C.getAdminDb().collection(opts.collection).doc(docId), {
            ...row, companyId, source: 'mikro_sql', syncedAt: pgServerTimestamp(),
          }, { merge: true });
          if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();

        allRows.push(...rows);
        total += rows.length;
        // İlerleme (HTTP yolu): alanlar olduğu gibi jobs'a geçer (S4 `...a`), `processed: satir` eşlemesi orada.
        if (ilerle) await ilerle({ sayfa: sayfa + 1, satir: total, sonSayfaMs }).catch(() => {});
        if (rows.length < SAYFA) break;
        sayfa++;
        if (sayfa >= MAKS_SAYFA) tavanaCarpti = true;
      }

      let postNote: string | null = null;
      if (opts.postProcess && allRows.length > 0) postNote = await opts.postProcess(allRows, companyId);

      // ── İptal süpürgesi (C17) ────────────────────────────────────────────
      // Mikro'da SONRADAN iptal edilmiş satırların yerel hayalet kopyalarını
      // sil. ekKosul onları çektiğimiz veriden çıkarır; bu adım daha önce
      // çekilmiş olanları temizler. Süpürge başarısız olursa import'u
      // düşürmüyoruz (veri zaten indi) ama özette YÜKSEK SESLE bildiriyoruz —
      // sessizce atlarsak hayalet sorunu geri gelir ve kimse görmez.
      let supurulen = 0; let supurgeHata: string | null = null;
      if (opts.iptalKolonu && opts.tarihKolonu) {
        try {
          const anaTablo  = opts.tablo.trim().split(/\s+/)[0];
          // TAKMA AD SOYULUR: fatura-listesi tanımı `tablo: 'CARI_HESAP_HAREKETLERI cha'`
          // ve `tarihKolonu: 'cha.cha_tarihi'` kullanıyor. Süpürge sorgusu takma
          // adsız FROM yazdığı için `cha.` öneki "The multi-part identifier
          // could not be bound" hatası verirdi — süpürge her koşuda sessizce
          // (aslında özette gürültülü) başarısız olurdu.
          const tarihKol  = opts.tarihKolonu.includes('.')
            ? opts.tarihKolonu.slice(opts.tarihKolonu.lastIndexOf('.') + 1)
            : opts.tarihKolonu;
          const iptalKol  = opts.iptalKolonu.includes('.')
            ? opts.iptalKolonu.slice(opts.iptalKolonu.lastIndexOf('.') + 1)
            : opts.iptalKolonu;
          const semaCols  = await mikroKolonlar(anaTablo);
          const guidKolon = semaCols.find(c => /_Guid$/i.test(c));
          const semaSet = new Set(semaCols.map(c => c.toLowerCase()));
          if (!guidKolon) {
            supurgeHata = `${anaTablo}: GUID kolonu yok, iptal süpürgesi çalışamaz`;
          } else if (semaCols.length && !semaSet.has(iptalKol.toLowerCase())) {
            // CLAUDE.md: Mikro kolon adı TAHMİN ETME — şemada yoksa yüksek sesle
            // başarısız ol, "hiç iptal yok" gibi sessiz bir sonuç üretme.
            supurgeHata = `${anaTablo}.${iptalKol} şemada yok — iptal süpürgesi atlandı`;
          } else {
            // Aynı pencere (tarihKosulu) — sayfa sorgusuyla İKİ AYRI koşul üreticisi olmasın (hakem 7).
            const { ok: sOk, data: sData } = await mikroPost('SqlVeriOkuV2', {
              SQLSorgu: `SELECT ${guidKolon} FROM ${anaTablo} WHERE ISNULL(${iptalKol}, 0) <> 0 `
                + `AND ${tarihKosulu(tarihKol, ilkTarih, sonTarih)}`,
            }, false, { zamanAsimiMs: listeZamanAsimiMs() });
            const sr0 = ((sData as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
            if (!sOk || !sr0 || sr0.IsError) {
              supurgeHata = String(sr0?.ErrorMessage || 'Mikro iptal sorgusu başarısız');
            } else {
              const iptalRows = (sr0.Data ?? sr0.data ?? []) as Record<string, unknown>[];
              // docId = GUID (yukarıdaki yazma ile AYNI türetim) — sapmaması şart.
              const ids = iptalRows.map(r => String(r[guidKolon] ?? '')).filter(Boolean);

              // SİLİNECEKLERİ TEK SORGUYLA BUL (satır başına `ref.get()` DEĞİL).
              // Bir mali yıl penceresinde binlerce iptal satırı olabiliyor;
              // her biri için ayrı SELECT, HTTP isteği içinde binlerce sıralı
              // gidiş-dönüş demekti ve tamamı ZATEN SİLİNMİŞ olsa bile her
              // import'ta tekrar koşuyordu (var-yok bilgisi ancak get() ile
              // öğreniliyordu). Tek sorgu hem var olanı hem sahipliği süzer;
              // etiketsiz (companyId'siz) eski kayıt yine eşleşir, yabancı
              // kiracınınki hiç dönmez.
              const silinecek: string[] = [];
              if (C.getPgPool()) {
                const PARCA = 1000;   // ANY($2) için makul parti boyu
                for (let i = 0; i < ids.length; i += PARCA) {
                  const { rows: bulunan } = await C.getPgPool().query(
                    `SELECT id FROM docs WHERE coll = $1 AND id = ANY($2::text[])
                       AND (data->>'companyId' = $3 OR NOT (data ? 'companyId'))`,
                    [opts.collection, ids.slice(i, i + PARCA), companyId],
                  );
                  for (const r of bulunan) silinecek.push(String((r as { id: string }).id));
                }
              } else {
                // Firestore yedek yolu (lokal dev): toplu sorgu yok, tek tek bak.
                for (const id of ids) {
                  const mevcut = await C.getAdminDb().collection(opts.collection).doc(id).get();
                  if (!mevcut.exists) continue;
                  const dc = ((mevcut.data() as Record<string, unknown> | undefined)?.companyId as string) || '';
                  if (dc && dc !== companyId) continue;
                  silinecek.push(id);
                }
              }
              let sBatch = C.getAdminDb().batch(); let sOps = 0;
              for (const id of silinecek) {
                sBatch.delete(C.getAdminDb().collection(opts.collection).doc(id)); supurulen++;
                if (++sOps >= 450) { await sBatch.commit(); sBatch = C.getAdminDb().batch(); sOps = 0; }
              }
              if (sOps > 0) await sBatch.commit();
            }
          }
        } catch (sErr) {
          supurgeHata = sErr instanceof Error ? sErr.message : String(sErr);
        }
      }

      const duration = Date.now() - t0;
      const ozet = `${total} kayıt${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}` +
        `${dusenKolonlar.length ? ` — şemada olmayan kolonlar atlandı: ${dusenKolonlar.join(', ')}` : ''}` +
        `${siralama !== opts.siralama ? ` — sıralama kolonu '${opts.siralama}' bulunamadı, '${siralama}' kullanıldı` : ''}` +
        `${postNote ? ` — ${postNote}` : ''}` +
        `${supurulen ? ` — ${supurulen} iptal edilmiş kayıt silindi` : ''}` +
        `${supurgeHata ? ` — ⚠ iptal süpürgesi başarısız: ${supurgeHata}` : ''}` +
        (guidsizSatir
          ? ` — ⚠ ${guidsizSatir} satırda GUID yok: bu satırlar her çalıştırmada MÜKERRER kayıt oluşturur`
            + `${guidsizSatir === total ? ' (TÜM satırlar — tabloda GUID kolonu yok, import tekrarlanmamalı)' : ''}`
          : '');
      // Senkronizasyon Geçmişi bu koleksiyonu okur — import'lar 2026-07-31'e
      // kadar buraya HİÇ yazmıyordu, panel bu yüzden boş görünüyordu.
      await C.writeSyncLog(`SQL:${opts.tablo}`, opts.collection, ozet, true, null, null, duration, actor);
      await C.writeAuditLog(actor, opts.label, `${ozet} (SQL: ${opts.tablo})`);
      return { ok: true, total, note: postNote, truncated: tavanaCarpti, duration, guidsizSatir };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sqlImport ${opts.tablo}]`, msg);
      await C.writeSyncLog(`SQL:${opts.tablo}`, opts.collection, opts.label, false, null, msg, Date.now() - t0, actor);
      return { ok: false, error: `${opts.label} başarısız.`, duration: Date.now() - t0 };
    }
  }

  /** SqlVeriOkuV2 tabanlı liste import — V17'de karşılığı OLMAYAN liste
   *  metotlarının yerine geçer.
   *
   *  Neden: `SiparisListesiV2`, `FaturaListesiV2`, `StokHareketListesiV2`,
   *  `BankaListesiV2`, `KasaListesiV2`, `OdemePlanListesiV2`, `BarkodListesiV2`
   *  Mikro Jump V17'de YOK (Postman koleksiyonu + OpenAPI spec, ikisi de).
   *
   *  `SELECT *` kullanılıyor: kolon adlarını önceden bilmeye gerek yok.
   *  Sayfalama SQL Server'ın OFFSET/FETCH'i ile (ORDER BY zorunlu).
   *
   *  GÜVENLİK: tablo/sıralama adı sabit (kod içinde), tarih sqlTarih ile KATI
   *  doğrulanır. İstemciden gelen hiçbir string doğrudan sorguya girmez.
   */
  const SQL_IMPORT_TANIMLARI: SqlImportOpts[] = [];

  function makeMikroSqlImport(opts: SqlImportOpts) {
    SQL_IMPORT_TANIMLARI.push(opts);   // cron da aynı tanımları kullanır
    if (!opts.route) return;
    // İş adı KAYIT KAPSAMINDA, rota başına 1 kez (kapı yaması 5): `route?: string` daraltması nested
    // async handler'a TAŞINMAZ (handler içinde TS2345 string | undefined — tsc ile ÖLÇÜLDÜ) ve `!` /
    // `?? ''` kural dışı. Yan etki İSTENEN: bilinmeyen önek boot'ta throw = fail-fast (12 tanımın hepsi
    // /api/mikro/import/<slug>). 'mikroImport-<slug>' — src/lib/mikroIsAdi.ts TEK sözlük.
    const isAdi = mikroIsAdi(opts.route);
    // MFA + ROL KAPISI (2026-08-25 denetimi): bu fabrika 12 import ucu kaydeder
    // (siparis, fatura-listesi, cari-hareket, stok-hareket, banka, kasa,
    // odeme-plan, depo, barkod, fiyat, demirbas, maliyet-merkezi) ve UCUNDE de
    // yalnizca `requireAuth` vardi. Iki ayri bosluk:
    //   1) MFA yok — kardes Mikro uclarinin (stok/kaydet, cari/kaydet,
    //      ebelge/earsiv-iptal) hepsinde requireMfaVerified var; burada atlanmis.
    //   2) ROL yok — B2B/Dealer rolu bile toplu import tetikleyebiliyordu.
    //      `opts.collection` hedef koleksiyondur, dolayisiyla yetki o
    //      koleksiyonun YAZMA kuralindan turetilir; ayri bir liste tutulmaz.
    // Hiz siniri (mikroLimiter) BILEREK eklenmedi: import uzun surer ve
    // kullanicinin "tum import'lari sirayla calistir" akisini kirardi.
    app.post(opts.route, C.requireAuth, C.requireMfaVerified,
             C.requireCollectionAccess(opts.collection, 'write'),
             async (req: Request, res: Response) => {
      if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
      // ARKA PLAN İŞİ (2026-09-24): eski kod SQL import çekirdeğini `await` ile isteğin içinde bitiriyor, tek bayt
      // dönmüyordu → IIS/ARR 502 (teşhis, CONFIRMED). req YALNIZ burada okunur (yanıt ÖNCESİ).
      const companyId = await C.reqCompanyId(req);
      const actor = C.reqActor(req);
      const ilk = sqlTarih(req.body?.ilkTarih, '2020-01-01');
      const son = ustSinir(req.body?.sonTarih);   // yoksa null = üst sınır yok (tarihKosulu gerekçesi)
      const sonuc = await arkaPlanIsiBaslat(arkaPlanDep(), {
        isAdi, companyId, actor,
        // kendiYazar: mikroSqlImportCalistir syncLog/audit'i KENDİSİ yazar (cron paritesi) — helper çift satır atmaz.
        senkronKaydi: { operation: `SQL:${opts.tablo}`, entityType: opts.collection, kendiYazar: true },
        // yaziciAdi YOK: bugün bu uçlarda bakım kilidi yok (parite; açık soru 5).
        calistir: async (ilerle) => {
          // `...a`: S5'in verdiği HER alan (sayfa, satir, sonSayfaMs — K-A) OLDUĞU GİBİ jobs'a geçer;
          // sarmalayıcı alan adı SAYMAZ (eski `({ sayfa, satir }) => …` imzası yeni alanı sessizce
          // DÜŞÜRÜRDÜ — kapı:4). processed = satir: istemci çubuğu okur; total koşarken BİLİNMİYOR →
          // YAZILMAZ (belirsiz çubuk, K-J).
          const s = await mikroSqlImportCalistir(opts, companyId, ilk, son, actor, a => ilerle({ ...a, processed: a.satir }));
          if (!s.ok) {
            // Başarısız koşu SAYILMADI: total/truncated/guidsizSatir YAZILMAZ (yazılmayan = bilinmiyor —
            // istemci `total?`; eski yanıt `?? 0`, ara sürüm `total: 0` yazıyordu → kart '500/0 işlendi').
            // Koşu sırasında yazılan processed/satir/sayfa dokümanda KALIR (gerçekten yazılan satırlar).
            // Mikro reddi zaten HTTP 200 sınıfıydı; hata artık 502 yerine jobs/<isAdi>.error'da.
            return { jobAlanlari: { tablo: opts.tablo }, ozet: s.error, basarili: false, hata: s.error };
          }
          return {
            jobAlanlari: {
              total: s.total, note: s.note, tablo: opts.tablo,
              guidsizSatir: s.guidsizSatir,   // başarıda HER ZAMAN sayılır (0 = gerçek sayım)
              truncated: s.truncated, ...(s.truncated ? { limit: 40 * 500 } : {}),
            },
            ozet: `${s.total} kayıt`, basarili: true, hata: null,
          };
        },
      });
      return arkaPlanYaniti(res, sonuc);
    });
  }

  function makeMikroListImport(opts: {
    route:       string;
    method:      string;                          // Mikro API method adı
    collection:  string;                          // hedef Firestore koleksiyonu
    label:       string;                          // audit log etiketi
    extraBody?:  Record<string, unknown>;         // method'a özel ek parametreler
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  }) {
    app.post(opts.route, C.requireAuth, async (req: Request, res: Response) => {
      if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
      if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      // Kullanıcının uid'i DEĞİL, ait olduğu firmanın id'si (bkz. writeAuditLog
      // aynı hatası, 2026-07-30). Çalışanın çektiği kayıtlar firmanın değil
      // çalışanın id'siyle damgalanıyordu.
      const companyId = await C.reqCompanyId(req);
      const t0 = Date.now();
      const PAGE_SIZE = 500;
      let index = 0, hasMore = true, total = 0;
      const allRows: Record<string, unknown>[] = [];

      try {
        while (hasMore) {
          const { ok, data } = await mikroPost(opts.method, {
            Size: String(PAGE_SIZE), Index: index, ...(opts.extraBody ?? {}),
          });
          if (!ok) break;
          const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
          if (r0?.IsError) {
            return res.status(502).json({ success: false, error: (r0.ErrorMessage as string) || `${opts.method} hatası` });
          }
          const rows = mikroSatirlar(data);
          if (rows.length === 0) break;

          let batch = C.getAdminDb().batch();
          let ops = 0;
          for (const row of rows) {
            const guidKey = findKey(row, /_Guid$/i);
            const docId = guidKey && row[guidKey]
              ? String(row[guidKey])
              : C.getAdminDb().collection(opts.collection).doc().id;
            batch.set(C.getAdminDb().collection(opts.collection).doc(docId), {
              ...row,
              companyId,
              source:    'mikro_import',
              syncedAt:  pgServerTimestamp(),
            }, { merge: true });
            if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
          }
          if (ops > 0) await batch.commit();

          allRows.push(...rows);
          total += rows.length;
          hasMore = rows.length === PAGE_SIZE;
          index += 1; // Mikro Index = sayfa numarası
        }

        let postNote: string | null = null;
        if (opts.postProcess && allRows.length > 0) {
          postNote = await opts.postProcess(allRows, companyId);
        }

        const duration = Date.now() - t0;
        await C.writeAuditLog(C.reqActor(req), opts.label, `${total} kayıt çekildi${postNote ? ` — ${postNote}` : ''}`);
        res.json({ success: true, total, note: postNote, duration });
      } catch (err) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // ── V17'de metodu OLMAYAN listeler: SqlVeriOkuV2 üzerinden ────────────────
  // Tablo adları müşterinin veritabanından INFORMATION_SCHEMA ile doğrulandı
  // (2026-07-30) — tahmin değil.

  // 1. Siparişler → mikroSiparisler   (eski: SiparisListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/siparis', tablo: 'SIPARISLER', siralama: 'sip_Guid',
    collection: 'mikroSiparisler', label: 'Mikro Sipariş Listesi',
    tarihKolonu: 'sip_tarih',
  });

  // 2. Faturalar → mikroFaturalar     (eski: FaturaListesiV2, V17'de YOK)
  //
  // Fatura BAŞLIĞI = CARI_HESAP_HAREKETLERI, cha_evrak_tip 63.
  // Ama başlıkta KDV ve MATRAH YOK — onlar SATIRLARDA (STOK_HAREKETLERI).
  // Bu yüzden satırlar fatura bazında toplanıp başlığa JOIN'leniyor.
  //
  // Birleştirme anahtarı canlıda DOĞRULANDI (2026-08-01):
  //   sth_evraktip = 4 (satış faturası satırı), sth_evrakno_sira = cha_evrakno_sira
  //   Fatura 321: başlık 21.600 = satır 18.000 (matrah) + 3.600 (KDV) ✓
  //   Fatura 322: başlık 13.062 = 10.885 + 2.177 ✓
  // Seri bu kurulumda boş; yine de anahtara dahil (başka kurulumda dolu olabilir).
  //
  // vergiPntr İNDEKStir, yüzde değil — vergiOraniCoz ile çevrilir (bkz. o fonksiyon).
  makeMikroSqlImport({
    route: '/api/mikro/import/fatura-listesi',
    tablo: 'CARI_HESAP_HAREKETLERI cha',
    fromEk: ' LEFT JOIN (' +
              'SELECT sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, ' +
              'SUM(sth_vergi) AS kdv, SUM(sth_tutar) AS matrah, MIN(sth_vergi_pntr) AS vergiPntr, ' +
              // Karma KDV tespiti (2026-08-17, kullanıcı bildirdi): bir faturada
              // hem %10 hem %20'li ürün olabilir. Tek `vergiPntr` (MIN) o zaman
              // yanıltıcı — matrah/kdv toplamları doğru ama görünen tek oran
              // faturanın tamamını temsil etmiyor. Karma ise istemci "Karma" gösterir.
              // ISNULL(...,-1): COUNT(DISTINCT) NULL'ları görmezden gelir — bir
              // satırın gerçek orana (ör. %20) diğerinin NULL/çözülemeyen orana
              // sahip olduğu fatura, ISNULL olmadan "tek oran" gibi görünürdü.
              // CAST ONCE, ISNULL SONRA — sirasi KRITIK.
              // SQL Server'da ISNULL(kolon, deger) donus tipini KOLONDAN alir.
              // sth_vergi_pntr tinyint (0-255) oldugu icin `ISNULL(col, -1)`
              // -1'i tinyint'e cevirmeye calisiyor ve TUM SORGU
              // "Arithmetic overflow error for data type tinyint, value = -1"
              // ile oluyordu — yani fatura import'u komple calismiyordu
              // (2026-08-18 canli bildirimi; hatayi 2026-08-17'de karma-KDV
              // duzeltmesinde ben eklemistim).
              // Once INT'e cast edilince nobet degeri sorunsuz sigiyor.
              // NOT: COUNT(DISTINCT) NULL'lari saymaz; bu yuzden NULL'u ayri
              // bir deger olarak isaretlemek SART — aksi halde "bir gercek
              // oran + NULL satirlar" tek oranmis gibi gorunur ve fatura
              // yanlislikla karma-KDV sayilmaz.
              'COUNT(DISTINCT ISNULL(CAST(sth_vergi_pntr AS INT), -1)) AS oranSayisi ' +
              'FROM STOK_HAREKETLERI WHERE sth_evraktip IN (3, 4) ' +
              'GROUP BY sth_evrakno_seri, sth_evrakno_sira, sth_evraktip' +
            ') sat ON sat.sth_evrakno_seri = cha.cha_evrakno_seri ' +
            'AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
            // Yön eşleşmesi ŞART: satış ve alış aynı evrak numarasını
            // kullanabiliyor (seri boş). evraktip'i de anahtara katmazsak
            // bir satış faturasına alış satırının KDV'si bağlanabilir.
            'AND sat.sth_evraktip = CASE WHEN cha.cha_tip = 0 THEN 4 ELSE 3 END',
    // KDV/MATRAH ZINCIRI: satir JOIN'i (sat.*) -> baslik farki (cha_meblag - cha_aratoplam) -> NULL.
    // SON `0` YEDEGI KALDIRILDI (Faz 3 2/n, 2026-09-18): ISNULL(..., 0) ile "satirlari da
    // baslik aratoplami da okunamayan" fatura SQL'DE ₺0 KDV'ye zorlanıyordu; istemci (hook)
    // bunu gercek bir sifir sanip Ba/Bs esigine, KDV Analizi'ne ve Sube P&L'ine yaziyordu.
    // Artik NULL iner ve mapMikroFatura onu NaN (= bilinmiyor) yapar - ekranda '—' + sayac.
    // Zincirin KENDISI durur: satir yoksa baslik farkindan turetme davranisi aynen korunur.
    secim: 'cha.*, ISNULL(sat.kdv, cha.cha_meblag - cha.cha_aratoplam) AS kdvTutari, ISNULL(sat.matrah, cha.cha_aratoplam) AS matrah, sat.vergiPntr, sat.oranSayisi',
    siralama: 'cha.cha_Guid',
    collection: 'mikroFaturalar', label: 'Mikro Fatura Listesi',
    tarihKolonu: 'cha.cha_tarihi',
    // ALIŞ FATURALARI 63'TE DEĞİL (2026-08-01 keşfi):
    //   SATIŞ  = cha_evrak_tip 63
    //   ALIŞ   = cha_evrak_tip 0, cha_cinsi 6
    //
    // Satır eşleşmesi doğrulandı: fatura 378 başlık 155.088 = satır 129.240
    // matrah + 25.848 KDV ✓ · fatura 380: 36.000 = 30.000 + 6.000 ✓
    //
    // ⚠️ AÇIK BULGU — cha_cinsi=6 filtresi HENÜZ CİRO OLARAK DOĞRULANMADI.
    // Kullanıcının Mikro portal raporuyla (01.01.2026–01.08.2026) tie-out:
    //   portal GELEN 220 belge 13.907.047 ₺ · GİDEN 188 belge 9.360.355 ₺
    // Benim cinsi=6 üzerinden verdiğim 269 belge / 132.737.531 ₺ belge başına
    // 493k ortalama demek; portal ortalaması 63k. 8 kat fark filtreyle de
    // açıklanamaz, tarih kapsamıyla da (bkz. aşağı).
    //
    // Hatanın kökü: bu rakamları ürettiğim keşif sorgularının HİÇBİRİNDE tarih
    // filtresi yoktu — tüm tabloyu tarıyorlardı. Giden raporda 2026 evrak sıra
    // aralığı 120→321 (202 belge) iken benim "320 satış" rakamım önceki yılları
    // da kapsıyor. Yıl bazlı doğrulama sorguları sema-kesif'e eklendi
    // (y2026_satisOzet / y2026_alisCinsDagilimi / y2026_cinsi6Ornek).
    // O çıktı portal raporuna oturmadan bu filtreden ciro rakamı SUNULMAYACAK.
    //
    // Not: import'un kendisi zaten tarih aralığıyla çalışıyor (tarihKolonu),
    // yani listelenen faturalar doğru; şüpheli olan yalnız cinsi=6 kapsamı.
    // ISNULL(cha.cha_iptal,0)=0: iptal edilmiş faturalar da geçerli fatura
    // olarak iniyordu (2026-08-22 denetim bulgusu C17) — KDV/Ba-Bs/ciro
    // rakamları iptal edilen her fatura kadar şişiyordu.
    ekKosul: '(cha.cha_evrak_tip = 63 OR (cha.cha_evrak_tip = 0 AND cha.cha_cinsi = 6)) AND ISNULL(cha.cha_iptal, 0) = 0',
    iptalKolonu: 'cha_iptal',
    // K-B eki (orkestratör onaylı 2026-09-24): aynı tablonun (CARI_HESAP_HAREKETLERI, ölçüldü 1.594
    // satır) alt kümesi ≤ 1.594 → her gece TAM; geriye tarihli fatura da 90 günde düşmesin.
    gecePenceresi: 'tam',
    postProcess: async (rows) => {
      // Tanilama sayaci: `Number(r.kdvTutari ?? 0) > 0` hem NULL'u hem mesru ₺0'i "eslesmedi"
      // sayiyordu ve ikisini AYIRT EDEMIYORDU. `bilinenSayi` ile uc kova ayrilir: KDV'si okunan
      // (0 dahil), KDV'si 0 OLAN, KDV'si hic okunamayan (NULL -> istemcide NaN).
      const bilinen  = rows.filter(r => bilinenSayi(r.kdvTutari)).length;
      const sifir    = rows.filter(r => bilinenSayi(r.kdvTutari) && Number(r.kdvTutari) === 0).length;
      const okunmaz  = rows.length - bilinen;
      return `${bilinen}/${rows.length} faturada KDV okundu` +
             (sifir > 0 ? ` (${sifir}'i ₺0)` : '') +
             (okunmaz > 0 ? ` · ${okunmaz} faturada KDV BİLİNMİYOR` : '');
    },
  });

  // 2b. TÜM cari hareketler → mikroCariHareketler
  //
  // fatura-listesi YALNIZ fatura hareketlerini çeker (cha_evrak_tip 63 / cinsi 6).
  // Fatura-OLMAYAN hareketi olan cariler (7 MEHMET: sadece masraf; A BALIK) Cari
  // Ekstre'de BOŞ görünüyordu — cariBalances'ta bakiye var ama gösterilecek fatura
  // yok. Bu import evrak_tip filtresiz TÜM CARI_HESAP_HAREKETLERI'ni (fatura +
  // masraf + dekont + tahsilat + virman) çeker; Cari Ekstre bunu okur.
  //
  // Sıralama cha_tarihi DESC + cha_Guid (benzersiz tiebreak): OFFSET/FETCH sayfalama
  // deterministik kalır VE 20k tavanına çarparsa en ESKİ hareketler düşer (en az
  // ilgili olan). Bakiye = SUM(cha_tip=0 ? +meblag : -meblag) — eksi = Cetpa borçlu.
  // Yürüyen bakiye/etiket (hareketTipi) istemcide cha_evrak_tip'ten türetilir.
  makeMikroSqlImport({
    route: '/api/mikro/import/cari-hareket',
    tablo: 'CARI_HESAP_HAREKETLERI',
    // Kolon adları çalışma anında şemaya karşı süzülür (secimKolonlari) — Mikro
    // kurulumunda olmayan bir ad artık import'u öldürmez, yalnız o alan gelmez.
    // cha_ettn (e-belge GİB kimliği) bu kurulumda YOK; listede kalması zararsız,
    // başka kurulumda varsa otomatik gelir.
    secimKolonlari: ['cha_Guid', 'cha_evrakno_seri', 'cha_evrakno_sira', 'cha_tarihi',
                     'cha_tip', 'cha_cinsi', 'cha_evrak_tip', 'cha_kod', 'cha_aciklama',
                     'cha_meblag', 'cha_aratoplam', 'cha_ebelge_turu', 'cha_belge_no',
                     'cha_kasa_hizkod', 'cha_kasa_hizmet', 'cha_ettn', 'cha_uuid',
                     // Vade: Tahsilat & Vade Takibi ekranı gecikme hesabı için kullanır.
                     // Yoksa istemci fatura tarihine düşer (uydurma vade YAZILMAZ).
                     'cha_vade_tarihi'],
    siralama: 'cha_tarihi DESC, cha_Guid',
    // ISNULL: cha_iptal NULL olan satir (or. API ile yazilan LUCA dekontlari) SESSIZCE
    // elenmesin — kardes sorgular (1530, 1791, 4337) ve denetim C16 ile ayni kural. 2026-09-24.
    ekKosul: 'ISNULL(cha_iptal, 0) = 0',
    iptalKolonu: 'cha_iptal',
    tarihKolonu: 'cha_tarihi',
    // ÖLÇÜLDÜ 2026-09-24: CARI_HESAP_HAREKETLERI toplam 1.594 satır (LUCA 572) = 4 sayfa; 90 gün
    // penceresi `cha_tarihi`'ye baktığı için GERİYE TARİHLİ dekontu (Hesap Açılış Fişi, 2025) HİÇ
    // getirmiyordu — ödemeler müşteri ekranına gelmiyordu (teşhis kök neden c). Her gece TAM.
    gecePenceresi: 'tam',
    collection: 'mikroCariHareketler', label: 'Mikro Cari Hareketleri',
    postProcess: async (rows) => {
      // PG aynası (off-server yedek + raporlama). Fatura import'uyla aynı tablo.
      await mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'cari_hareket_import' })), CHA_COLS);
      // Yönü okunamayan hareket borç SAYILMAZ (eski `?? 0`): tek kaynak server/mikro/eBelge.cariHareketYonOzeti.
      return cariHareketYonOzeti(rows);
    },
  });

  // 3. Stok hareketleri → inventoryMovements  (eski: StokHareketListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/stok-hareket', tablo: 'STOK_HAREKETLERI', siralama: 'sth_Guid',
    // İptal edilmiş stok hareketleri de iniyordu (C17): stok miktarı ve
    // hareket dökümü iptal edilen her irsaliye/fatura kadar sapıyordu.
    // Diğer STOK_HAREKETLERI sorguları zaten ISNULL(sth_iptal,0)=0 kullanıyor.
    ekKosul: 'ISNULL(sth_iptal, 0) = 0',
    iptalKolonu: 'sth_iptal',
    collection: 'inventoryMovements', label: 'Mikro Stok Hareketleri',
    tarihKolonu: 'sth_tarih',
    postProcess: async (rows) => {
      const sample = rows[0];
      const skuKey = findKey(sample, /st[ho]_?stok_?kod|sto_kod|stok_kod/i);
      const qtyKey = findKey(sample, /miktar/i);
      return `alanlar: sku=${skuKey ?? '?'}, miktar=${qtyKey ?? '?'}`;
    },
  });

  /** POST /api/mikro/fatura/kalemler — bir faturanın SATIRLARI (kalemleri).
   *  Body: { seri?: string, sira: number|string, yon: 'gelen'|'giden' }
   *
   *  Mikro Jump'ta fatura açılınca kalemler görülüyor; uygulamada yalnız başlık
   *  vardı (matrah/KDV/toplam). Satırlar STOK_HAREKETLERI'nde; birleştirme
   *  anahtarı fatura import'unda canlıda DOĞRULANMIŞTIR:
   *    sth_evraktip = 4 (satış satırı) / 3 (alış satırı) — yön eşleşmesi ŞART,
   *    çünkü seri boş olduğunda satış ve alış aynı evrak numarasını kullanabiliyor.
   *
   *  Kolon adları çalışma anında şemadan süzülür (mikroKolonlar) — elle yazılan
   *  yanlış bir ad tüm sorguyu öldürmesin (cha_vergi/cha_ettn arıza sınıfı).
   */
  app.post('/api/mikro/fatura/kalemler', C.requireAuth, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const sira = String(req.body?.sira ?? '').trim();
    if (!/^\d{1,12}$/.test(sira)) return res.status(400).json({ success: false, error: 'Geçerli bir evrak sıra no gerekli.' });
    // Seri harf/rakam olabilir; SQL'e girdiği için katı süz (enjeksiyon yüzeyi yok).
    const seri = String(req.body?.seri ?? '').trim();
    if (seri && !/^[A-Za-z0-9]{0,20}$/.test(seri)) return res.status(400).json({ success: false, error: 'Geçersiz evrak seri.' });
    const evrakTip = req.body?.yon === 'gelen' ? 3 : 4;

    // İstenen kolonlar — şemada olmayanlar düşürülür (ad TAHMİN EDİLMEZ).
    const istenen = ['sth_stok_kod', 'sth_miktar', 'sth_birim_pntr', 'sth_tutar',
                     'sth_vergi', 'sth_vergi_pntr', 'sth_iskonto1', 'sth_aciklama',
                     'sth_evrakno_seri', 'sth_evrakno_sira', 'sth_tarih', 'sth_satir_no'];
    const sthCols = await mikroKolonlar('STOK_HAREKETLERI');
    const sthSet  = new Set(sthCols.map(c => c.toLowerCase()));
    // İskonto/masraf kolonları ŞEMADAN (ad tahmini yok): yalnız `sth_iskonto1` isteniyordu — fatura altı iskontosunun
    // düştüğü diğer alanlar modala hiç gelmiyor, kalem tutarı BRÜT basılıyordu (2026-09-18). Net hesap lib/stokFiyat.
    const iskMas = sthCols.filter(c => /^sth_(iskonto|masraf)\d+$/i.test(c));
    const secim = sthCols.length
      ? [...new Set([...istenen.filter(c => sthSet.has(c.toLowerCase())), ...iskMas])]
      : istenen;
    if (!secim.length) return res.status(502).json({ success: false, error: 'STOK_HAREKETLERI şeması okunamadı.' });

    // Satır sırası: sth_satir_no varsa gerçek kalem sırası; yoksa sth_Guid ile
    // en azından DETERMİNİSTİK sırala (sayfa yenilendikçe sıra değişmesin).
    const siralama = sthSet.has('sth_satir_no') ? 'sth.sth_satir_no'
                   : sthSet.has('sth_guid')     ? 'sth.sth_Guid' : 'sth.sth_stok_kod';

    // Ürün adı ayrı tabloda (STOKLAR). Kolon yoksa JOIN'siz devam et — kalemler
    // ürün adı olmadan da gösterilir, sorgunun tamamı ölmesin.
    const stoCols  = await mikroKolonlar('STOKLAR');
    const stoSet   = new Set(stoCols.map(c => c.toLowerCase()));
    const adVar    = stoSet.has('sto_isim') && stoSet.has('sto_kod');
    // Birim ADI (2026-08-31 kullanıcı isteği: "BİRİM'i de ekle"): sth_birim_pntr
    // 1-3 arası bir işaretçidir, adı STOKLAR'daki sto_birimX_ad kolonundadır.
    // Kolonlar şemadan doğrulanır — yoksa birim alanı hiç üretilmez (tahmin yok).
    const birimKolonlari = adVar
      ? ['sto_birim1_ad', 'sto_birim2_ad', 'sto_birim3_ad'].filter(c => stoSet.has(c))
      : [];

    try {
      const { rows, hata } = await mikroSql(
        `SELECT ${secim.map(c => `sth.${c}`).join(', ')}` +
        (adVar ? ', sto.sto_isim AS urunAdi' : '') +
        birimKolonlari.map(c => `, sto.${c}`).join('') + ' ' +
        'FROM STOK_HAREKETLERI sth ' +
        (adVar ? 'LEFT JOIN STOKLAR sto ON sto.sto_kod = sth.sth_stok_kod ' : '') +
        `WHERE sth.sth_evraktip = ${evrakTip} AND sth.sth_evrakno_sira = ${sira} ` +
        `AND ISNULL(sth.sth_evrakno_seri, '') = '${seri}' ` +
        `ORDER BY ${siralama}`,
      );
      if (hata) return res.status(502).json({ success: false, error: hata });
      // Birimi sunucuda çöz — istemci işaretçi aritmetiği bilmesin.
      // Gövde tek kaynakta (server/mikro/eslemeFatura.kalemleriBirimle).
      const birimli = kalemleriBirimle(rows);
      res.json({ success: true, kalemler: birimli, total: birimli.length });
    } catch (err) {
      console.error('[fatura/kalemler]', err);
      res.status(500).json({ success: false, error: 'Fatura kalemleri alınamadı.' });
    }
  });

  /** GET /api/mikro/sema-kesif — Mikro şemasını keşfetmek için SABİT sorgular.
   *
   *  Neden var: bu şemayı keşfetmek için sürekli sunucuda PowerShell koşturmak
   *  gerekiyordu ve her seferinde bir şey ters gidiyordu (fonksiyon tanımsız,
   *  cd işlememiş, .env bulunamamış). Aynı bilgiyi uygulamadan almak hem hızlı
   *  hem tekrarlanabilir.
   *
   *  GÜVENLİK: sorgular KODDA SABİT, istemciden hiçbir SQL parçası alınmaz —
   *  enjeksiyon yüzeyi yok. /api/ops/summary ile aynı token korumasında.
   *  Yalnız şema/örnek veri döner; toplu iş verisi dökmez (TOP 3/5).
   */
  app.get('/api/mikro/sema-kesif', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const sorgular: Array<{ ad: string; sql: string }> = [
      { ad: 'faturaBasliklari',
        sql: 'SELECT TOP 3 cha_evrakno_seri, cha_evrakno_sira, cha_evrak_tip, cha_meblag, cha_tarihi FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 ORDER BY cha_tarihi DESC' },
      { ad: 'satirEvrakTipleri',
        sql: 'SELECT sth_evraktip, COUNT(*) AS adet FROM STOK_HAREKETLERI GROUP BY sth_evraktip ORDER BY COUNT(*) DESC' },
      { ad: 'satirOrnegi',
        sql: 'SELECT TOP 5 sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, sth_vergi, sth_tutar, sth_vergi_pntr, sth_stok_kod FROM STOK_HAREKETLERI ORDER BY sth_tarih DESC' },
      { ad: 'depolar',
        sql: 'SELECT dep_no, dep_adi FROM DEPOLAR ORDER BY dep_no' },
      { ad: 'stokDepoKoduDagilimi',
        sql: "SELECT sto_yer_kod, COUNT(*) AS adet FROM STOKLAR GROUP BY sto_yer_kod ORDER BY COUNT(*) DESC" },
      // code-review #7 DOGRULAMA: STOK_HAREKETLERI'nden per-depo stok (aday tek SQL).
      // Bu ciktinin stok-miktar import'unun depoBreakdown'iyla (GenelAmacliMaliyet
      // polling) ESLESMESI halinde, agir per-SKU-per-depo polling yerine tek grup-SQL'e
      // gecilir. Once sema burada dogrulanmadan import DEGISTIRILMEZ (envanter riski).
      { ad: 'sthDepoKolonOrnegi',
        sql: 'SELECT TOP 5 sth_stok_kod, sth_tip, sth_miktar, sth_giris_depo_no, sth_cikis_depo_no, sth_iptal FROM STOK_HAREKETLERI ORDER BY sth_tarih DESC' },
      // 2026-08-11 MUTABAKAT ARTIĞI: 2367 üründen 2365'i tuttu (semantik DOĞRULANDI),
      // 2'si eksik kaldı — YPR-4160 (327 vs 527) ve VITRA-800-2030 (63 vs 95). İkisi de
      // aynı yönde (dağılım < toplam) → stok var ama bir depoya yazılmamış. Hipotez:
      // depo no NULL/0 ya da sth_tip 0/1 dışında. Bu iki sorgu onu ÖLÇER (tahmin değil).
      // SABİT KIYMET + MALİYET MERKEZİ tablo KEŞFİ (2026-08-11).
      // Bu iki modül için hiç import yok; kullanıcı "ileride kullanacağım" dedi.
      // Tablo adlarını TAHMİN ETMEK yerine INFORMATION_SCHEMA'ya sordurulur —
      // yanlış tablo adı "Invalid object name" ile sorguyu öldürür (cha_vergi /
      // cha_ettn arıza sınıfının tablo sürümü). Çıktı gelince import yazılacak.
      { ad: 'sabitKiymetTabloAdaylari',
        sql: "SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c " +
             "WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi " +
             'FROM INFORMATION_SCHEMA.TABLES t WHERE ' +
             "t.TABLE_NAME LIKE '%DEMIRBAS%' OR t.TABLE_NAME LIKE '%SABIT%' OR " +
             "t.TABLE_NAME LIKE '%AMORTISMAN%' OR t.TABLE_NAME LIKE '%KIYMET%' " +
             'ORDER BY TABLE_NAME' },
      { ad: 'maliyetMerkeziTabloAdaylari',
        sql: "SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c " +
             "WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi " +
             'FROM INFORMATION_SCHEMA.TABLES t WHERE ' +
             "t.TABLE_NAME LIKE '%MASRAF%' OR t.TABLE_NAME LIKE '%MALIYET%' OR " +
             "t.TABLE_NAME LIKE '%MERKEZ%' OR t.TABLE_NAME LIKE '%PROJE%' " +
             'ORDER BY TABLE_NAME' },
      // FİYAT KAYNAĞI (2026-08-11): 2367 ürünün tamamı ekranda "0 TL" görünüyor.
      // Import iki kaynağı deniyor (satis_fiyatlari[] ve sto_satis_fiyat1..4);
      // bu kurulumda hangisi DOLU, ölçelim — tahminle fiyat yazılmaz.
      { ad: 'fiyatListesiOzet',
        sql: 'SELECT COUNT(*) AS satir, COUNT(DISTINCT sfiyat_stokkod) AS urun, ' +
             'MIN(sfiyat_listesirano) AS minListe, MAX(sfiyat_listesirano) AS maxListe ' +
             'FROM STOK_SATIS_FIYAT_LISTELERI' },
      { ad: 'fiyatListesiOrnek',
        sql: 'SELECT TOP 10 sfiyat_stokkod, sfiyat_listesirano, sfiyat_fiyati ' +
             'FROM STOK_SATIS_FIYAT_LISTELERI WHERE sfiyat_fiyati > 0 ORDER BY sfiyat_stokkod' },
      { ad: 'stokKartiFiyatDolulugu',
        sql: 'SELECT COUNT(*) AS toplamUrun, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat1,0) > 0 THEN 1 ELSE 0 END) AS fiyat1Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat2,0) > 0 THEN 1 ELSE 0 END) AS fiyat2Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat3,0) > 0 THEN 1 ELSE 0 END) AS fiyat3Dolu, ' +
             'SUM(CASE WHEN ISNULL(sto_satis_fiyat4,0) > 0 THEN 1 ELSE 0 END) AS fiyat4Dolu ' +
             'FROM STOKLAR' },
      { ad: 'artikDepoNoDagilimi',
        sql: "SELECT sth_tip, ISNULL(CAST(sth_giris_depo_no AS VARCHAR(10)),'NULL') AS giris, " +
             "ISNULL(CAST(sth_cikis_depo_no AS VARCHAR(10)),'NULL') AS cikis, COUNT(*) AS adet, SUM(sth_miktar) AS miktar " +
             "FROM STOK_HAREKETLERI WHERE sth_stok_kod IN ('YPR-4160','VITRA-800-2030') AND ISNULL(sth_iptal,0)=0 " +
             'GROUP BY sth_tip, sth_giris_depo_no, sth_cikis_depo_no ORDER BY sth_tip' },
      { ad: 'artikTipDagilimi',
        sql: 'SELECT sth_stok_kod, sth_tip, COUNT(*) AS adet, SUM(sth_miktar) AS miktar ' +
             "FROM STOK_HAREKETLERI WHERE sth_stok_kod IN ('YPR-4160','VITRA-800-2030') AND ISNULL(sth_iptal,0)=0 " +
             'GROUP BY sth_stok_kod, sth_tip ORDER BY sth_stok_kod, sth_tip' },
      { ad: 'perDepoStokAday',
        sql: 'SELECT TOP 40 sth_stok_kod, depo, SUM(net) AS bakiye FROM (' +
             'SELECT sth_stok_kod, sth_giris_depo_no AS depo, sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 0 AND ISNULL(sth_iptal, 0) = 0 ' +
             'UNION ALL ' +
             'SELECT sth_stok_kod, sth_cikis_depo_no AS depo, -sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 1 AND ISNULL(sth_iptal, 0) = 0' +
             ') t GROUP BY sth_stok_kod, depo HAVING SUM(net) <> 0 ORDER BY sth_stok_kod' },
      // Gelen (alış) fatura doğrulaması: cha_tip 1 başlığı ile sth_evraktip 3
      // satırı aynı evrak numarasında buluşuyor mu, toplamlar tutuyor mu?
      // İSKONTO KEŞFİ (2026-09-18, kullanıcı bildirimi: fatura altı iskontosu ortalama alış fiyatına girmiyordu).
      // src/lib/stokFiyat.ts satır NET tutarını ayna dokümanındaki `sth_iskonto<N>` alanlarından hesaplıyor; bu
      // sorgular kolonların GERÇEKTEN var olduğunu, TUTAR (₺) taşıdığını ve fatura altı iskontosunun satırlara
      // dağıtıldığını (Σ satır iskontosu ≈ başlık iskontosu) canlı veriyle teyit etmek için. Kolon adı uydurulmaz:
      // ilk iki sorgu INFORMATION_SCHEMA'dan okur; örnek sorgular yoksa "Invalid column" ile yüksek sesle düşer.
      { ad: 'sthIskontoKolonlari',
        sql: "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'STOK_HAREKETLERI' " +
             "AND (COLUMN_NAME LIKE 'sth[_]isk%' OR COLUMN_NAME LIKE 'sth[_]masraf%') ORDER BY COLUMN_NAME" },
      { ad: 'chaIskontoKolonlari',
        sql: "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CARI_HESAP_HAREKETLERI' " +
             "AND (COLUMN_NAME LIKE '%isk%' OR COLUMN_NAME LIKE '%aratoplam%') ORDER BY COLUMN_NAME" },
      { ad: 'iskontoluAlisSatirOrnegi',
        sql: 'SELECT TOP 8 sth_evrakno_seri, sth_evrakno_sira, sth_stok_kod, sth_miktar, sth_tutar, sth_vergi, ' +
             'sth_iskonto1, sth_iskonto2, sth_iskonto3, sth_iskonto4, sth_iskonto5, sth_iskonto6 ' +
             'FROM STOK_HAREKETLERI WHERE sth_evraktip = 3 AND ISNULL(sth_iptal, 0) = 0 AND ' +
             '(sth_iskonto1 <> 0 OR sth_iskonto2 <> 0 OR sth_iskonto3 <> 0 OR sth_iskonto4 <> 0 OR sth_iskonto5 <> 0 OR sth_iskonto6 <> 0) ' +
             'ORDER BY sth_tarih DESC' },
      { ad: 'iskontoluAlisBaslikOrnegi',
        sql: 'SELECT TOP 5 cha_evrakno_seri, cha_evrakno_sira, cha_aratoplam, cha_meblag, ' +
             'cha_ft_iskonto1, cha_ft_iskonto2, cha_ft_iskonto3, cha_ft_iskonto4, cha_ft_iskonto5, cha_ft_iskonto6 ' +
             'FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_tip = 1 AND ISNULL(cha_iptal, 0) = 0 AND ' +
             '(cha_ft_iskonto1 <> 0 OR cha_ft_iskonto2 <> 0 OR cha_ft_iskonto3 <> 0 OR cha_ft_iskonto4 <> 0 OR cha_ft_iskonto5 <> 0 OR cha_ft_iskonto6 <> 0) ' +
             'ORDER BY cha_tarihi DESC' },
      { ad: 'alisFaturaBasliklari',
        sql: 'SELECT TOP 3 cha_evrakno_seri, cha_evrakno_sira, cha_tip, cha_meblag, cha_tarihi FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_tip = 1 ORDER BY cha_tarihi DESC' },
      { ad: 'alisSatirOrnegi',
        sql: 'SELECT TOP 5 sth_evrakno_seri, sth_evrakno_sira, sth_evraktip, sth_vergi, sth_tutar, sth_vergi_pntr FROM STOK_HAREKETLERI WHERE sth_evraktip = 3 ORDER BY sth_tarih DESC' },
      // Alış faturası başlığı hangi cha_evrak_tip'te? 63 yalnız satışı tutuyor.
      { ad: 'evrakTipDagilimi',
        sql: 'SELECT cha_evrak_tip, cha_tip, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI GROUP BY cha_evrak_tip, cha_tip ORDER BY COUNT(*) DESC' },
      // 377/378/380 alış satırlarının başlığı hangi kayıtta? Evrak no ile ara.
      { ad: 'alisEvrakNoBasliklari',
        sql: 'SELECT cha_evrak_tip, cha_tip, cha_evrakno_sira, cha_kod, cha_meblag FROM CARI_HESAP_HAREKETLERI WHERE cha_evrakno_sira IN (377, 378, 380) ORDER BY cha_evrakno_sira' },
      // evrak_tip 0 / tip 1 içindeki 567 kaydın KAÇI gerçekten alış faturası?
      // Gerçek fatura STOK_HAREKETLERI'nde satırı olandır; tahsilat/virman gibi
      // hareketlerin stok satırı OLMAZ. Bu ayrım filtrenin doğruluğunu belirler.
      { ad: 'evrakTip0SatirEslesmesi',
        sql: 'SELECT CASE WHEN sat.sth_evrakno_sira IS NULL THEN 0 ELSE 1 END AS satiriVar, ' +
             'COUNT(*) AS adet, SUM(cha.cha_meblag) AS toplam ' +
             'FROM CARI_HESAP_HAREKETLERI cha ' +
             'LEFT JOIN (SELECT DISTINCT sth_evrakno_seri, sth_evrakno_sira FROM STOK_HAREKETLERI WHERE sth_evraktip = 3) sat ' +
             'ON sat.sth_evrakno_seri = cha.cha_evrakno_seri AND sat.sth_evrakno_sira = cha.cha_evrakno_sira ' +
             'WHERE cha.cha_evrak_tip = 0 AND cha.cha_tip = 1 ' +
             'GROUP BY CASE WHEN sat.sth_evrakno_sira IS NULL THEN 0 ELSE 1 END' },
      // evrak_tip 0 içinde başka ayırt edici alan var mı (cha_cinsi kırılımı)
      { ad: 'evrakTip0CinsDagilimi',
        sql: 'SELECT cha_cinsi, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI ' +
             'WHERE cha_evrak_tip = 0 AND cha_tip = 1 GROUP BY cha_cinsi ORDER BY COUNT(*) DESC' },
      { ad: 'faturaYonDagilimi',
        sql: 'SELECT cha_tip, COUNT(*) AS adet FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 GROUP BY cha_tip' },

      // ── 2026-08-01: TARİH FİLTRESİ OLMAYAN SORGULARIN BEDELİ ───────────────
      // Yukarıdaki kırılımlar TÜM tabloyu tarıyor. Ben bunların çıktısını
      // "2026 cirosu" diye sundum; kullanıcı Mikro'nun kendi 01.01.2026–bugün
      // raporuyla karşılaştırınca tutmadı:
      //   Mikro portal raporu (2026) → GELEN 220 belge 13.907.047 ₺
      //                                GİDEN 188 belge  9.360.355 ₺
      //   Benim (tarihsiz) rakamım   → ALIŞ  269 belge 132.737.531 ₺  ✗ 10 kat
      //                                SATIŞ 320 belge  15.630.595 ₺
      // Giden raporda 2026 evrak sıra aralığı 120→321. Yani 2026'da 202 satış
      // belgesi var; "320" bu DB'deki ÖNCEKİ yılları da kapsıyor. Aynı şey alış
      // tarafında da geçerli, üstüne cha_cinsi=6'nın belge başına ortalaması
      // (493k) portal ortalamasının (63k) 8 katı — filtre de şüpheli.
      //
      // Bu yüzden aşağıdaki sorgular YIL BAZLI. Sonuç portal raporuyla
      // karşılaştırılabilir olmadan hiçbir ciro rakamı sunulmayacak.
      { ad: 'y2026_satisOzet',
        sql: "SELECT COUNT(*) AS adet, SUM(cha_meblag) AS toplam, MIN(cha_evrakno_sira) AS ilkSira, " +
             "MAX(cha_evrakno_sira) AS sonSira FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_evrak_tip = 63 AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101'" },
      { ad: 'y2026_alisCinsDagilimi',
        sql: "SELECT cha_cinsi, COUNT(*) AS adet, SUM(cha_meblag) AS toplam FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_evrak_tip = 0 AND cha_tip = 1 AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101' " +
             "GROUP BY cha_cinsi ORDER BY COUNT(*) DESC" },
      // cha_cinsi=6 GERÇEKTEN alış faturası mı? Örnek satırlara bakmadan
      // "evet" demeyeceğim — bir önceki sefer tam burada yanıldım. En büyük 5
      // kayda bakılıyor: ortalamayı 8 kat şişiren şey buradaysa görünür.
      { ad: 'y2026_cinsi6EnBuyuk',
        sql: "SELECT TOP 5 cha_evrakno_seri, cha_evrakno_sira, cha_kod, cha_meblag, cha_tarihi, " +
             "cha_ebelge_turu, cha_aciklama " +
             "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 0 AND cha_tip = 1 AND cha_cinsi = 6 " +
             "AND cha_tarihi >= '20260101' AND cha_tarihi < '20270101' ORDER BY cha_meblag DESC" },
      // Portal raporu YALNIZ e-faturayı kapsar (e-arşiv ve kağıt fatura orada
      // görünmez). Bu yüzden tie-out'un anahtarı cha_ebelge_turu kırılımı:
      // e-fatura satırlarının toplamı 220 belge/13,9M (alış) ve 188/9,36M
      // (satış) ile örtüşmeli; artan kısım e-arşiv+kağıt olarak açıklanmalı.
      { ad: 'y2026_ebelgeTuruDagilimi',
        sql: "SELECT cha_evrak_tip, cha_tip, cha_ebelge_turu, COUNT(*) AS adet, SUM(cha_meblag) AS toplam " +
             "FROM CARI_HESAP_HAREKETLERI " +
             "WHERE cha_tarihi >= '20260101' AND cha_tarihi < '20270101' " +
             "AND (cha_evrak_tip = 63 OR (cha_evrak_tip = 0 AND cha_cinsi = 6)) " +
             "GROUP BY cha_evrak_tip, cha_tip, cha_ebelge_turu ORDER BY COUNT(*) DESC" },
      { ad: 'tabloSatirSayilari',
        sql: "SELECT 'CARI_HESAP_HAREKETLERI' t, COUNT(*) n FROM CARI_HESAP_HAREKETLERI " +
             "UNION ALL SELECT 'STOK_HAREKETLERI', COUNT(*) FROM STOK_HAREKETLERI " +
             "UNION ALL SELECT 'CARI_HESAPLAR', COUNT(*) FROM CARI_HESAPLAR " +
             "UNION ALL SELECT 'STOKLAR', COUNT(*) FROM STOKLAR " +
             "UNION ALL SELECT 'EBELGE_EVRAK_HAREKETLERI', COUNT(*) FROM EBELGE_EVRAK_HAREKETLERI" },
      // GİB / İPTAL KEŞFİ (2026-09-25 kullanıcı isteği: "GİB'den kabul edilmeyen faturaları da çekelim, iptal
      // faturaları iptal olarak görünsün ama başka bir hesaplamaya dahil olmasın"). Bir faturanın GİB ya da alıcı
      // tarafından reddedildiği bilgisi kodun HİÇBİR yerinde okunmuyor; kolon adı TAHMİN EDİLMEZ (cha_vergi /
      // cha_ettn dersi) — önce şema. Yalnız INFORMATION_SCHEMA + kodda zaten kullanılan cha_* kolonları.
      { ad: 'ebelgeTabloAdaylari',
        sql: "SELECT TABLE_NAME, (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = t.TABLE_NAME) AS kolonSayisi " +
             "FROM INFORMATION_SCHEMA.TABLES t WHERE t.TABLE_NAME LIKE '%EBELGE%' OR t.TABLE_NAME LIKE '%EFATURA%' " +
             "OR t.TABLE_NAME LIKE '%EARSIV%' OR t.TABLE_NAME LIKE '%GIB%' OR t.TABLE_NAME LIKE '%ZARF%' ORDER BY TABLE_NAME" },
      { ad: 'ebelgeEvrakKolonlari',
        sql: "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'EBELGE_EVRAK_HAREKETLERI' ORDER BY ORDINAL_POSITION" },
      { ad: 'ebelgeEvrakOrnek',
        sql: 'SELECT TOP 3 * FROM EBELGE_EVRAK_HAREKETLERI' },
      // TÜM kolonlar (süzgeçsiz): ad deseni Türkçe harmanlamada 'I'/'ı' farkıyla kolon kaçırıp sahte "kolon yok"
      // sonucu verebilirdi (inceleme 2026-09-25). Teşhis ucu — ebelgeEvrakKolonlari ile aynı biçim.
      { ad: 'chaKolonlari',
        sql: "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CARI_HESAP_HAREKETLERI' ORDER BY ORDINAL_POSITION" },
      // Fatura-listesi importuyla AYNI evrak koşulu; iptal kırılımı (bugün iptaller importta elenir, süpürgeyle silinir).
      { ad: 'iptalFaturaDagilimi',
        sql: "SELECT ISNULL(cha_iptal, 0) AS iptal, cha_tip, cha_ebelge_turu, COUNT(*) AS adet, SUM(cha_meblag) AS toplam " +
             "FROM CARI_HESAP_HAREKETLERI WHERE (cha_evrak_tip = 63 OR (cha_evrak_tip = 0 AND cha_cinsi = 6)) " +
             "GROUP BY ISNULL(cha_iptal, 0), cha_tip, cha_ebelge_turu ORDER BY 1, 2, 3" },
      { ad: 'iptalFaturaOrnek',
        sql: "SELECT TOP 10 cha_evrakno_seri, cha_evrakno_sira, cha_evrak_tip, cha_tip, cha_tarihi, cha_meblag, cha_ebelge_turu, cha_kod, cha_aciklama " +
             "FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) <> 0 AND (cha_evrak_tip = 63 OR (cha_evrak_tip = 0 AND cha_cinsi = 6)) " +
             "ORDER BY cha_tarihi DESC" },
      // Fatura satırlarının iptal kırılımı (sth_iptal ve sth_evraktip kodda zaten kullanılıyor): iptal edilen faturanın
      // satırları da iptal mi işaretleniyor — kalem kaynağı (inventoryMovements) iptalleri importta eliyor.
      { ad: 'faturaSatirIptalDagilimi',
        sql: "SELECT sth_evraktip, ISNULL(sth_iptal, 0) AS iptal, COUNT(*) AS adet FROM STOK_HAREKETLERI " +
             "WHERE sth_evraktip IN (3, 4) GROUP BY sth_evraktip, ISNULL(sth_iptal, 0) ORDER BY 1, 2" },
    ];

    const sonuc: Record<string, unknown> = {};
    for (const q of sorgular) {
      const { rows, hata } = await mikroSql(q.sql);
      sonuc[q.ad] = hata ? { hata } : rows;
    }
    res.json({ success: true, sonuc });
  });

  /** GET /api/mikro/ebelge-tani — GelenFaturalarV2'nin HAM yanıtını döndürür.
   *
   *  E-Belge Merkezi'nde "Gelen" çekince "İstenilen aralıktaki kayıtlar
   *  getirilirken hata oluştu" dönüyor — bu Mikro'nun KENDİ hatası, kod hatası
   *  değil. Ham yanıtı görmeden kök neden bilinemez; tahminle parametre
   *  değiştirmek (geçen sefer cha_cinsi'de yanıldığım hata sınıfı) yanlış olur.
   *
   *  Bu uç 3 farklı parametre setiyle metodu dener ve ham data'yı döndürür:
   *  hangisi çalışıyor / Mikro tam olarak ne diyor görülür. sema-kesif ile
   *  aynı token koruması; toplu veri dökmez (Size 5). */
  app.get('/api/mikro/ebelge-tani', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const yil = new Date().getFullYear();
    const bugun = mikroBugun();
    // Kullanıcı Mikro programından e-faturalara ERİŞEBİLİYOR → GİB bağlantısı var,
    // sorun büyük olasılıkla parametre. Tek denenmemiş: VKNo (firma VKN'si).
    // ?vkn=... ile geç; E/F denemeleri onu kullanır.
    const vkn = String(req.query.vkn ?? '').replace(/\D/g, '').slice(0, 11);
    const denemeler: Array<{ ad: string; p: Record<string, unknown> }> = [
      { ad: 'A_tam_parametre', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: '', Size: 5, Index: 0 } },
      { ad: 'B_size_index_yok', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: '' } },
      { ad: 'C_gibfaturano_yok', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, VKNo: '', Size: 5, Index: 0 } },
      { ad: 'D_dar_aralik_1gun', p: { IlkTarih: bugun, SonTarih: bugun, GIBFaturaNo: '', VKNo: '', Size: 5, Index: 0 } },
      ...(vkn ? [
        { ad: 'E_vkn_ile', p: { IlkTarih: `${yil}-07-01`, SonTarih: bugun, GIBFaturaNo: '', VKNo: vkn, Size: 5, Index: 0 } },
        { ad: 'F_vkn_dar_aralik', p: { IlkTarih: bugun, SonTarih: bugun, GIBFaturaNo: '', VKNo: vkn, Size: 5, Index: 0 } },
      ] : []),
    ];
    const sonuc: Record<string, unknown> = {};
    for (const d of denemeler) {
      try {
        const { ok, status, data } = await mikroPost('GelenFaturalarV2', d.p);
        sonuc[d.ad] = { ok, status, hata: mikroHata(data), ham: data };
      } catch (e) {
        sonuc[d.ad] = { hata: (e as Error).message };
      }
    }
    res.json({ success: true, sonuc });
  });

  /** POST /api/mikro/tamir/ham-satir-temizle — UI koleksiyonlarına yanlışlıkla
   *  dökülmüş HAM Mikro satırlarını siler.
   *
   *  2026-08-01: banka/kasa import'ları ham Mikro satırlarını doğrudan
   *  `bankAccounts` ve `kasalar`a yazıyordu. O satırlarda `balance`/`bakiye`
   *  yok; ekran `acc.balance.toLocaleString()` dediği için Muhasebe modülü
   *  komple çöküyordu. Import düzeltildi ama CANLIDA yazılmış satırlar duruyor.
   *
   *  Yalnız `source: 'mikro_sql'` damgalı (yani o hatalı import'un yazdığı)
   *  dokümanları siler — elle girilmiş veya düzeltilmiş kayıtlara (source:'mikro')
   *  DOKUNMAZ.
   */
  app.post('/api/mikro/tamir/ham-satir-temizle', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const hedefler = ['bankAccounts', 'kasalar', 'warehouses'];
    const sonuc: Record<string, number> = {};
    try {
      const cid = await C.reqCompanyId(req);
      for (const coll of hedefler) {
        const snap = await C.getAdminDb().collection(coll).get();
        let batch = C.getAdminDb().batch(); let ops = 0, silinen = 0;
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          if (x.source !== 'mikro_sql') continue;              // yalnız hatalı import
          if (x.companyId && x.companyId !== cid) continue;    // başka kiracıya dokunma
          batch.delete(d.ref); silinen++;
          if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
        }
        if (ops > 0) await batch.commit();
        sonuc[coll] = silinen;
      }
      const ozet = Object.entries(sonuc).map(([k, v]) => `${k}: ${v}`).join(', ');
      await C.writeAuditLog(C.reqActor(req), 'Ham Satır Temizliği', ozet);
      res.json({ success: true, silinen: sonuc, not: `Silinen ham satırlar — ${ozet}. İlgili import'ları yeniden çalıştırın.` });
    } catch (err) {
      console.error('[tamir/ham-satir-temizle]', err);
      res.status(500).json({ success: false, error: 'Temizlik başarısız.' });
    }
  });

  // 4. Bankalar → mikroBankalar (ham) + bankAccounts (temiz)
  //
  // ⚠️ 2026-08-01 DÜZELTMESİ: ham ban_* satırları DOĞRUDAN `bankAccounts`a
  // yazılıyordu. O koleksiyon tipli bir UI koleksiyonu ve ekran
  // `acc.balance.toLocaleString()` diyor — ham satırda `balance` alanı YOK,
  // dolayısıyla Muhasebe modülü komple çöküyordu
  // ("Cannot read properties of undefined (reading 'toLocaleString')").
  // Aynı hatayı DEPOLAR'da fark edip ayırmıştım, banka/kasa'yı atlamışım.
  makeMikroSqlImport({
    route: '/api/mikro/import/banka', tablo: 'BANKALAR', siralama: 'ban_Guid',
    collection: 'mikroBankalar', label: 'Mikro Banka Listesi',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb()) return null;
      const bankaId = await C.mikroIdCozucu('bankAccounts', companyId);
      // Alan adları çalışma anında bulunur — tahmin yok, bulunamazsa bildirilir.
      const ornek = rows[0];
      const adKey  = findKey(ornek, /ban_(adi|isim|ad)$/i) ?? findKey(ornek, /ban_.*ad/i);
      const noKey  = findKey(ornek, /ban_no$/i) ?? findKey(ornek, /ban_kod/i);
      const hspKey = findKey(ornek, /hesap_?no|iban/i);
      if (!adKey) return `banka adı alanı bulunamadı — bankAccounts'a yazılmadı`;
      let batch = C.getAdminDb().batch(); let ops = 0, n = 0;
      for (const r of rows) {
        const guidKey = findKey(r, /_Guid$/i);
        const id = guidKey && r[guidKey] ? String(r[guidKey]) : null;
        if (!id) continue;
        batch.set(C.getAdminDb().collection('bankAccounts').doc(bankaId(id)), {
          companyId,
          bankName:      String(r[adKey] ?? '').trim() || `Banka ${noKey ? r[noKey] : ''}`.trim(),
          accountType:   'Vadesiz',
          accountHolder: '',
          currency:      'TRY',
          // Bakiye Mikro'nun banka TANIMINDA yok (hareketlerde). 0 yazmak
          // "bakiye sıfır" demek olur — UI'ın çökmemesi için gerekli asgari,
          // gerçek bakiye banka hareketlerinden gelir.
          balance:       0,
          ...(hspKey && r[hspKey] ? { accountNo: String(r[hspKey]) } : {}),
          source: 'mikro', syncedAt: pgServerTimestamp(),
        }, { merge: true });
        n++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${n} banka bankAccounts'a yazıldı (${adKey})`;
    },
  });

  // 5. Kasalar → mikroKasalar (ham) + kasalar (temiz) — bkz. banka gerekçesi
  makeMikroSqlImport({
    route: '/api/mikro/import/kasa', tablo: 'KASALAR', siralama: 'kas_Guid',
    collection: 'mikroKasalar', label: 'Mikro Kasa Listesi',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb()) return null;
      const kasaId = await C.mikroIdCozucu('kasalar', companyId);
      const ornek = rows[0];
      const adKey = findKey(ornek, /kas_(adi|isim|ad)$/i) ?? findKey(ornek, /kas_.*ad/i);
      const noKey = findKey(ornek, /kas_no$/i) ?? findKey(ornek, /kas_kod/i);
      if (!adKey) return `kasa adı alanı bulunamadı — kasalar'a yazılmadı`;
      let batch = C.getAdminDb().batch(); let ops = 0, n = 0;
      for (const r of rows) {
        const guidKey = findKey(r, /_Guid$/i);
        const id = guidKey && r[guidKey] ? String(r[guidKey]) : null;
        if (!id) continue;
        batch.set(C.getAdminDb().collection('kasalar').doc(kasaId(id)), {
          companyId,
          kasaAdi:  String(r[adKey] ?? '').trim() || `Kasa ${noKey ? r[noKey] : ''}`.trim(),
          currency: 'TRY',
          bakiye:   0,
          source: 'mikro', syncedAt: pgServerTimestamp(),
        }, { merge: true });
        n++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${n} kasa kasalar'a yazıldı (${adKey})`;
    },
  });

  // 6. Ödeme planları → odemePlanlari (eski: OdemePlanListesiV2, V17'de YOK)
  makeMikroSqlImport({
    route: '/api/mikro/import/odeme-plan', tablo: 'ODEME_PLANLARI', siralama: 'odp_Guid',
    collection: 'odemePlanlari', label: 'Mikro Ödeme Planları',
  });

  // 8. Depolar → mikroDepolar (ham) + warehouses (temiz)
  //
  // Mikro'da DEPOLAR tablosu var ama hiç çekilmiyordu; Depo Tanımları ekranı
  // yalnız elle girilmiş "Depo 1"i gösteriyordu. Müşterinin 5 deposu var:
  // 1 HAVALIMANI · 2 ESKI SANAYI · 3 "34 CGC 119" · 4 "07 AGU 291" · 5 "07 ACR 832"
  // (3-5 araç plakası — QR transfer sistemindeki araçlarla aynı numaralar).
  //
  // Ham satır `mikroDepolar`a, temiz doküman `warehouses`a yazılır: genel
  // importer ham satırı olduğu gibi döküyor ve 80 dep_* alanı tipli bir UI
  // koleksiyonunu kirletirdi.
  makeMikroSqlImport({
    route: '/api/mikro/import/depo', tablo: 'DEPOLAR', siralama: 'dep_Guid',
    collection: 'mikroDepolar', label: 'Mikro Depo Tanımları',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb()) return null;
      const depoId = await C.mikroIdCozucu('warehouses', companyId);
      // Mobil WMS de aynı depolardan beslenmeli — bkz. (B) notu.
      const wmsId = await C.mikroIdCozucu('wmsLocations', companyId);
      const aracId = await C.mikroIdCozucu('vehicles', companyId);
      // TR plaka deseni — utils/filo.ts'teki istemci birlesimiyle AYNI kural.
      const PLAKA = /^\d{2}\s?[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc]{1,3}\s?\d{2,4}$/;
      const yazilanWmsKodlari = new Set<string>();
      let batch = C.getAdminDb().batch(); let ops = 0, yazilan = 0;
      for (const r of rows) {
        const depoNo = Number(r.dep_no);
        const ad     = String(r.dep_adi ?? '').trim();
        if (!Number.isFinite(depoNo)) continue;
        // Adres parçalarını yalnız DOLU olanlardan kur — boşları birleştirip
        // ", , TÜRKİYE" gibi anlamsız bir konum üretme.
        const konum = [r.dep_Ilce, r.dep_Il, r.dep_Ulke]
          .map(x => String(x ?? '').trim()).filter(Boolean).join(', ');
        const yetkili = String(r.dep_yetkili_email ?? '').trim();
        // Depo no'yu doc id yap: locationStocks ve QR transfer sistemi depo
        // kodlarını (1-5) kullanıyor, GUID değil — eşleşsinler.
        batch.set(C.getAdminDb().collection('warehouses').doc(depoId(`depo-${depoNo}`)), {
          companyId,
          name: ad || `Depo ${depoNo}`,
          depoNo,
          ...(konum   ? { location: konum } : {}),
          ...(yetkili ? { manager: yetkili } : {}),
          source: 'mikro',
          syncedAt: pgServerTimestamp(),
        }, { merge: true });

        // ── Mobil WMS konumu ────────────────────────────────────────────
        // Mobil Depo Yönetimi ekranı `wmsLocations`tan okur. O koleksiyona
        // yazan TEK kod stok import'undaki `depotCodes` döngüsüydü; o döngü
        // `sto_yer_kod` üzerinde dönüyor ve bu kurulumda o alan ürünlerin
        // TAMAMINDA boş, yani döngü HİÇ dönmüyordu (2026-08-28 teşhisi).
        // Ekrandaki tek `DEPO-1` satırı, kaldırılmış `|| '1'` kodunun
        // merge:true yüzünden geri alınmayan artığıydı ve `warehouseId`
        // taşımadığı için Depo sütunu "—" görünüyordu.
        // Yetkili kaynak burasıdır: gerçek depo adı ve warehouseId ile.
        // ── Plaka-adli depo = ARAC ──────────────────────────────────────
        // Mikro'da arac filosu ayri tablo degil: depolarin 3'u arac plakasi
        // (07 AGU 291, 07 ACR 832, 34 CGC 119 — QR transfer de bunlari
        // kullaniyor). vehicles'ta yalniz elle eklenen kayit vardi; Canli
        // Sevkiyat 1 arac gosteriyordu (2026-08-28 bildirimi). Plaka-adli depo
        // artik vehicles'a da yazilir — idempotent (id plakadan turer), merge
        // ile elle girilen surucu/telefon EZILMEZ.
        if (PLAKA.test(ad.toUpperCase())) {
          batch.set(C.getAdminDb().collection('vehicles').doc(aracId(`plaka-${ad.replace(/\s+/g, '-').toLowerCase()}`)), {
            companyId,
            plate: ad.toUpperCase(),
            status: 'M\u00fcsait',
            source: 'mikro',
            syncedAt: pgServerTimestamp(),
          }, { merge: true });
          ops++;
        }

        const wmsKod = `DEPO-${depoNo}`;
        yazilanWmsKodlari.add(wmsKod);
        batch.set(C.getAdminDb().collection('wmsLocations').doc(wmsId(`depo-${depoNo}`)), {
          companyId,
          code: wmsKod,
          // Depo sütununun dolması için ŞART: warehouses doküman kimliği.
          warehouseId: depoId(`depo-${depoNo}`),
          aisle: String(depoNo), rack: '00', level: '00',
          zone: 'storage',
          active: true,
          source: 'mikro',
          syncedAt: pgServerTimestamp(),
        }, { merge: true });
        ops++;

        yazilan++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      // ── Hayalet konum temizliği ──────────────────────────────────────────
      // Mikro'dan TÜRETİLMİŞ (source: mikro/mikro_import) ama artık gerçek bir
      // depoya karşılık gelmeyen konumları sil — ekrandaki eski `DEPO-1` böyle
      // kalmıştı. Kullanıcının ELLE eklediği konumlara DOKUNULMAZ: onlarda
      // `source` alanı yoktur.
      let silinen = 0;
      try {
        const mevcut = await C.getAdminDb().collection('wmsLocations')
          .where('companyId', '==', companyId).get();
        for (const d of mevcut.docs) {
          const v = d.data() as { code?: string; source?: string };
          if (v.source !== 'mikro' && v.source !== 'mikro_import') continue;
          if (v.code && yazilanWmsKodlari.has(v.code)) continue;
          await d.ref.delete();
          silinen++;
        }
      } catch (e) {
        console.warn('[depo import] wmsLocations temizligi atlandi:', e);
      }

      return `${yazilan} depo tanımı warehouses + wmsLocations'a yazıldı`
        + (silinen ? `, ${silinen} eski Mikro konumu temizlendi` : '');
    },
  });

  // 7. Barkodlar → barkodlar + envanter ürünlerine barcode alanı yaz
  makeMikroSqlImport({
    route: '/api/mikro/import/barkod', tablo: 'BARKOD_TANIMLARI', siralama: 'bar_Guid',
    collection: 'barkodlar', label: 'Mikro Barkod Listesi',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb()) return null;
      const sample = rows[0];
      const skuKey = findKey(sample, /sto_?kod|stok_?kod/i);
      const barKey = findKey(sample, /bar_?kod(?!u_)|barkod/i);
      if (!skuKey || !barKey) return `eşleme alanları bulunamadı (sku=${skuKey}, barkod=${barKey})`;
      // KİRACI SINIRI (fiyat/BOM import'unda bugün bulunan sınıfın aynısı, burada
      // da vardı): companyId filtresi YOKTU — Tenant A'nın barkod senkronu Tenant
      // B'nin aynı SKU'lu ürününün barcode alanını sessizce ezebilirdi.
      const invSnap = await C.tenantSnap('inventory', companyId);
      const bySku = new Map<string, AdminDocRef>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
        if (sku) bySku.set(sku, d.ref);
      }
      let batch = C.getAdminDb().batch(); let ops = 0; let matched = 0;
      for (const row of rows) {
        const ref = bySku.get(String(row[skuKey] ?? '').trim());
        const barcode = String(row[barKey] ?? '').trim();
        if (!ref || !barcode) continue;
        batch.update(ref, { barcode });
        matched++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${matched} ürüne barkod yazıldı`;
    },
  });

  // 8. Satış fiyatları → inventory.prices  (DOĞRU KAYNAK, 2026-08-11)
  //
  // Ürünler ekranda "0 TL" görünüyordu. Hem cron hem manuel stok import'u fiyatı
  // stok KARTINDAN (`sto_satis_fiyat1..4`) okumaya çalışıyordu — ama sema-kesif
  // kanıtladı ki bu kurulumda o kolon HİÇ YOK:
  //     stokKartiFiyatDolulugu -> "Invalid column name 'sto_satis_fiyat1'"
  // Fiyatlar ayrı tabloda ve DOLU:
  //     fiyatListesiOzet -> 2075 satır / 2075 ürün, listesirano 1..1
  // Yani tek fiyat listesi (Retail) var; 2/3/4 kademeleri bu kurulumda tanımsız.
  //
  // Bu import fiyatı asıl kaynağından çeker ve inventory.prices'a işler.
  makeMikroSqlImport({
    route: '/api/mikro/import/fiyat',
    tablo: 'STOK_SATIS_FIYAT_LISTELERI',
    // SIRALAMA TEKİL OLMALI (2026-08-24 denetim bulgusu P6 → doğrulandı).
    //
    // Sayfalama `ORDER BY <siralama> OFFSET n ROWS FETCH NEXT 500` ile yapılıyor.
    // SQL Server'da ORDER BY tekil DEĞİLSE sayfalar arası sıra GARANTİ EDİLMEZ:
    // aynı satır iki sayfada çıkabilir, başka bir satır hiç çıkmayabilir.
    // `sfiyat_stokkod` tekil değil — bu tablonun PK'sı
    // (sfiyat_stokkod, sfiyat_listesirano) ve her SKU'nun 4 fiyat kademesi için
    // 4 satırı var. Bir SKU'nun kademeleri sayfa sınırına denk geldiğinde bazı
    // kademeler MÜKERRER inip bazıları HİÇ İNMİYORDU — yani ürün fiyatı sessizce
    // yanlış/eksik güncelleniyordu. Diğer 11 import zaten _Guid ile sıralıyor;
    // bu tablonun GUID'i (sfiyat_Guid) secimKolonlari'nda var ama sıralamada
    // kullanılmıyordu. Tam PK ile sıralamak tekilliği garanti eder.
    siralama: 'sfiyat_stokkod, sfiyat_listesirano',
    collection: 'mikroFiyatListeleri',
    label: 'Mikro Satış Fiyat Listeleri',
    // Kolon adları çalışma anında şemaya karşı süzülür (olmayan ad import'u öldürmez).
    // Her iki döviz adı adayı da istenir ('sfiyat_doviz' repo'nun geri kalanında
    // kullandığı ad — PG ayna DDL'i, StokKaydetV2 push payload'u; 'sfiyat_doviz_cinsi'
    // yedek — süzgeç olmayanı zaten düşürür).
    secimKolonlari: ['sfiyat_Guid', 'sfiyat_stokkod', 'sfiyat_listesirano', 'sfiyat_fiyati',
                     'sfiyat_doviz', 'sfiyat_doviz_cinsi', 'sfiyat_deposu', 'sfiyat_iskonto1'],
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb()) return null;
      // Desenler SABİTLENMİŞ ve en spesifikten başlar. Gevşek /fiyat/i kullanılamaz:
      // 'sfiyat_Guid' ve 'sfiyat_stokkod' de "fiyat" içerir ve yanlış kolon seçilirse
      // Number(...) NaN olur, tüm satırlar elenir ve HİÇ fiyat yazılmadan iş başarılı
      // görünür (2026-08-11'de bu şekilde yakalandı).
      const cols    = Object.keys(rows[0]);
      const skuKey  = kolonSec(cols, [/^sfiyat_stokkod$/i, /stok_?kodu?$/i]);
      const listKey = kolonSec(cols, [/^sfiyat_listesirano$/i, /listesi_?rano$/i]);
      const fiyKey  = kolonSec(cols, [/^sfiyat_fiyati$/i, /_fiyati$/i, /fiyat$/i]);
      // Döviz cinsi: satır TL DIŞINDA bir birimde yazılıysa (0=TL varsayımı;
      // bkz. StokKaydetV2 push payload'u `sfiyat_doviz: 0`) fiyatı okuyup
      // doğrudan TL sanmak ~kur kadar (onlarca kat) yanlış tutar demektir. Kolon
      // çözülemezse hepsi TL sayılır — bu, tahmin değil, dosyanın kendi kabul
      // ettiği en iyi bilgi; sonuç panelde açıkça "UYARI" ile bildirilir.
      const dovKey  = kolonSec(cols, [/^sfiyat_doviz$/i, /^sfiyat_doviz_cinsi$/i, /doviz/i]);
      if (!skuKey || !fiyKey) {
        return `eşleme alanları bulunamadı (sku=${skuKey}, fiyat=${fiyKey}) — kolonlar: ${cols.join(', ')}`;
      }

      // Mikro liste no -> Cetpa kademesi. Liste no yoksa tek liste varsayılır (Retail).
      const TIER: Record<string, string> = { '1': 'Retail', '2': 'B2B Standard', '3': 'B2B Premium', '4': 'Dealer' };
      const bySku = new Map<string, Record<string, number>>();
      let atlananDoviz = 0;
      /** Liste no DOLU ama TIER'de karşılığı olmayan satır sayısı (ör. liste 5). */
      let atlananListe = 0;
      for (const r of rows) {
        const sku = String(r[skuKey] ?? '').trim();
        const fiyat = Number(r[fiyKey]);
        // 0 ve negatif "fiyat YOK" sayılır — yazılırsa ekranda yine 0 TL görünür
        // ve elle girilmiş fiyatı ezer (bugün kapatılan sessiz-sıfır sınıfı).
        if (!sku || !Number.isFinite(fiyat) || fiyat <= 0) continue;
        const dov = dovKey ? Number(r[dovKey]) : 0;
        if (dovKey && Number.isFinite(dov) && dov !== 0) { atlananDoviz++; continue; }
        // Liste no ÇÖZÜLEMEDİYSE (kolon yok ya da değer boş) tek liste varsayımı
        // KORUNUR — bu kurulumda yalnız liste 1 dolu (2026-08-11 şema keşfi).
        // AMA değer DOLU ve TIER'de karşılığı yoksa (ör. liste 5) eski `?? 'Retail'`
        // o fiyatı SESSİZCE perakendeye yazıyordu: var olmayan bir kademenin fiyatı
        // gerçek perakende fiyatını eziyordu. Böyle satır artık ATLANIR ve sayılır —
        // yanlış kademeye yazmak, yazmamaktan kötüdür (sahte kesinlik).
        const listeHam = listKey ? r[listKey] : null;
        const listeNo = listeHam == null || String(listeHam).trim() === '' ? '1' : String(listeHam).trim();
        const tier = TIER[listeNo];
        if (!tier) { atlananListe++; continue; }
        const cur = bySku.get(sku) ?? {};
        // Aynı kademede birden çok satır varsa (depo/döviz kırılımı) İLKİ kalır.
        if (cur[tier] == null) { cur[tier] = fiyat; bySku.set(sku, cur); }
      }

      // KİRACI SINIRI: PG shim'de .get() koleksiyonun TÜM kiracılarını döner
      // (docs tablosunda kiracı kolonu yok, ayrım yalnız data.companyId'de ve
      // aşağıda .where() YOKTU). companyId'si DOLU ve BAŞKA kiracıya ait ürüne
      // DOKUNULMAZ — yoksa A kiracısının Mikro fiyatı B kiracısının elle girdiği
      // fiyatı sessizce ezer (2026-08-11'de yakalandı). companyId'si BOŞ eski
      // kayıtlar bilerek dahil (SKU ile iyileştirme, mevcut stok import deseniyle
      // tutarlı).
      const invSnap = await C.tenantSnap('inventory', companyId);
      let batch = C.getAdminDb().batch(); let ops = 0; let eslesen = 0; let yabanciAtlanan = 0;
      const fiyatSayac = sayacOlustur();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) { yabanciAtlanan++; continue; }
        const sku = ((veri.sku as string) || '').trim();
        const yeni = sku ? bySku.get(sku) : undefined;
        if (!yeni) continue;
        // MERGE: Mikro'dan gelmeyen kademe mevcut değeriyle kalır (elle girilmiş
        // fiyat senkronla silinmemeli).
        const mevcut = (veri.prices as Record<string, number>) || {};
        const birlesik = { ...mevcut, ...yeni };
        // Gövde tek kaynakta (server/mikro/eslemeStok.ts → fiyatEsle): Retail HİÇ
        // bilinmiyorsa `price` alanı YAZILMAZ — eski `?? 0` yalnız bayi/B2B kademesi
        // tanımlı üründe elle girilen perakende fiyatını her senkronda 0 TL yapıyordu.
        // priceCurrency:'TRY' sabiti ve gerekçesi (döviz satırları elendiği için TL'ye
        // SABİTLEME, yoksa ekran TL tutarı bir kez daha kurla çarpar) o modülde.
        const { alanlar: fiyatAlan, bilinmeyen } = fiyatEsle(birlesik, mevcut);
        sayacaEkle(fiyatSayac, bilinmeyen);
        batch.update(d.ref, { ...fiyatAlan, mikroFiyatSyncedAt: pgServerTimestamp() });
        eslesen++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      const fiyatArizaAlanlari = okumaArizalari(fiyatSayac, FIYAT_KRITIK);
      const fiyatArizasi = okumaArizasiNotu(fiyatArizaAlanlari);
      if (fiyatArizasi) console.warn('[import/fiyat]', fiyatArizasi);
      const fiyatSayacMetni = sayacNotu(fiyatSayac, fiyatArizaAlanlari);
      return (fiyatArizasi ? `${fiyatArizasi} ` : '') +
        `${eslesen} ürünün fiyatı güncellendi (${bySku.size} SKU'da fiyat bulundu)` +
        (fiyatSayacMetni ? ` — ${fiyatSayacMetni}` : '') +
        (atlananDoviz ? ` — ${atlananDoviz} satır TL dışı döviz olduğu için atlandı` : '') +
        (atlananListe ? ` — ${atlananListe} satır tanınmayan fiyat listesi no'su taşıdığı için atlandı (kademe eşlemesi 1-4)` : '') +
        (dovKey ? '' : ' — UYARI: döviz kolonu çözülemedi, tüm tutarlar TL varsayıldı') +
        (yabanciAtlanan ? ` — ${yabanciAtlanan} ürün başka kiracıya ait olduğu için atlandı` : '');
    },
  });

  // 9. Sabit kıymetler (demirbaşlar) → sabitKiymetler
  //
  // Tablo adı TAHMİN EDİLMEDİ: sema-kesif `sabitKiymetTabloAdaylari` çıktısında
  // DEMIRBASLAR (135 kolon) ana tablo olarak göründü (yanındaki *_CHOOSE_* Mikro'nun
  // iç lookup görünümleri, DEMIRBAS_GRUPLARI grup tanımı, DEMIRBAS_MALIYIL_TANIMLARI
  // mali yıl/amortisman detayı). Kolon adları da tahmin edilmez — 135 kolon içinden
  // çalışma anında `kolonBul` ile çözülür, çözülemeyen alan yazılmaz ve raporlanır.
  makeMikroSqlImport({
    route: '/api/mikro/import/demirbas',
    tablo: 'DEMIRBASLAR',
    siralama: 'dem_Guid',
    collection: 'mikroDemirbaslar',
    label: 'Mikro Demirbaş Listesi',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb() || !rows.length) return null;
      // 2026-08-11: gerçek önek 'dbs_' DEĞİL 'dem_' çıktı — bu, sema-kesif'in
      // "kod kolonu bulunamadı" güvenli hata yolunun CANLIDA doğrulanmış kanıtı
      // (dbs_ tahmini yanlıştı ama import veri BOZMADI, açık hata verdi).
      // Kesin bilinen: dem_Guid, dem_kod, dem_isim, dem_aciklama, dem_firmano,
      // dem_subeno (canlı hata mesajından). alış tarihi/bedeli/ömür/grup 135
      // kolonun görünmeyen kısmında — adları HÂLÂ bilinmiyor, tahmin edilmez;
      // bulunamazsa alan boş kalır (mikroHam'da ham veri durur, veri kaybolmaz).
      const cols  = Object.keys(rows[0]);
      const kod   = kolonSec(cols, [/^dem_kod$/i, /^dem_kodu$/i, /^dem_demirbas_kodu$/i, /^dem_.*kodu$/i]);
      const ad    = kolonSec(cols, [/^dem_isim$/i, /^dem_adi$/i, /^dem_.*(isim|adi)$/i]);
      const aciklama = kolonSec(cols, [/^dem_aciklama$/i]);
      const tarih = kolonSec(cols, [/^dem_alis_tarihi$/i, /^dem_.*alis_tarihi$/i, /^dem_.*giris_tarihi$/i]);
      const bedel = kolonSec(cols, [/^dem_alis_bedeli$/i, /^dem_.*(alis_bedeli|alis_tutari|alis_fiyati)$/i]);
      const omur  = kolonSec(cols, [/^dem_faydali_omur$/i, /^dem_.*faydali_omur$/i]);
      const grup  = kolonSec(cols, [/^dem_grup_kodu$/i, /^dem_.*grup_kodu$/i]);
      if (!kod) return `demirbaş kodu kolonu bulunamadı — mevcut: ${cols.slice(0, 30).join(', ')}`;
      // ÇAKIŞMA GUARD'I: 135 kolonun 105'i hâlâ görülmedi (yalnız hata mesajından
      // sızan ilk 30'u bilinen). `kod`'un yedek deseni (/^dem_.*kodu$/i) başka bir
      // alanı yakalayabilir. `kod` DOKÜMAN ID'sidir; çakışırsa aynı gruptaki TÜM
      // demirbaşlar AYNI docId'ye düşüp birbirini SESSİZCE ezer — import DURDURULUR.
      if ([ad, aciklama, tarih, bedel, omur, grup].includes(kod)) {
        return `demirbaş kodu kolonu ('${kod}') başka bir alanla çakışıyor — eşleme güvenilmez, veri yazılmadı. Mevcut kolonlar: ${cols.slice(0, 30).join(', ')}`;
      }

      // Mevcut kayıtları bir kez oku: (a) YENİ dokümana zorunlu alanları varsayılanla
      // yaz (ekran çökmesin), (b) VAR OLAN dokümanda kullanıcının elle girdiği
      // durum/amortYontemi/departman gibi alanları EZME.
      const mevcutSnap = await C.tenantSnap('sabitKiymetler', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const dbsId = C.mikroIdCozucuIds(mevcutSnap.docs.map(d => d.id), companyId);
      const mevcut = new Map(mevcutSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));

      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      // Gövde TEK KAYNAKTA: src/server/mikro/eslemeVarlik.ts (demirbasEsle).
      // Bilinmeyen sayı 0 YAZILMAZ (alisBedeli/faydaliOmur artık `|| 0` değil — amortisman
      // 0 bedelden hesaplanmasın); sayaç note'a girer, tüm satırlarda bilinmeyen bir alan
      // okuma arızası olarak note'un BAŞINA uyarı basar.
      const ozetDem = ozetBaslat();
      for (const r of rows) {
        const k = mikroKod(r, kod);
        if (!k) continue;
        const docId = dbsId(k.replace(/[/\\]/g, '_'));
        const { alanlar } = ozetEkle(ozetDem,
          demirbasEsle(r, { kod, ad, tarih, bedel, omur, grup }, mevcut.get(docId)));
        batch.set(C.getAdminDb().collection('sabitKiymetler').doc(docId), {
          companyId,
          ...alanlar,
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      // İKİ FARKLI EKSİKLİK, İKİSİ DE GÖSTERİLİR:
      //   `eksik`    = kolon ŞEMADA hiç çözülemedi (desen tutmadı),
      //   `demSayac` = kolon var ama N satırda DEĞER yok (satır bazlı bilinmezlik).
      const demAriza = varlikArizalari(ozetDem, DEMIRBAS_KRITIK);
      if (demAriza.length) console.warn(`[import/demirbas] ${varlikArizaUyarisi(demAriza)}`);
      const demOnEk  = demAriza.length ? `${varlikArizaUyarisi(demAriza)} ` : '';
      const demSayac = bilinmeyenNotu(ozetDem, demAriza);
      const eksik = [!ad && 'ad', !tarih && 'alisTarihi', !bedel && 'alisBedeli', !omur && 'faydaliOmur', !grup && 'kategori']
        .filter(Boolean).join(', ');
      if (!eksik) return `${demOnEk}${yazilan} demirbaş sabitKiymetler'e yazıldı` + (demSayac ? ` — ${demSayac}` : '');

      // ÇIKMAZ SOKAK DEĞİL, KANIT ÜRET: eskiden mesaj yalnız "şu alanlar
      // çözülemedi" diyordu ve DEMIRBASLAR'ın 135 kolonundan hangilerinin
      // aday olduğu hiç görünmüyordu — desenleri düzeltmek için elde kanıt
      // yoktu (2026-08-18). Artık çözülemeyen her alan için, adı o alana
      // benzeyen GERÇEK kolonlar listeleniyor. Kolon adı hâlâ TAHMİN
      // EDİLMİYOR; yalnızca aday isimler gösteriliyor ki desen kanıta
      // dayanarak yazılabilsin.
      const adaylar = (desen: RegExp) => cols.filter(c => desen.test(c)).slice(0, 8);
      const ipucu = [
        !tarih && `alisTarihi adayları: ${adaylar(/tarih|date/i).join(', ') || '(yok)'}`,
        !bedel && `alisBedeli adayları: ${adaylar(/bedel|tutar|fiyat|maliyet|deger/i).join(', ') || '(yok)'}`,
        !omur  && `faydaliOmur adayları: ${adaylar(/omur|sure|yil|amort/i).join(', ') || '(yok)'}`,
        !grup  && `kategori adayları: ${adaylar(/grup|kategori|tip|cins|sinif/i).join(', ') || '(yok)'}`,
        !ad    && `ad adayları: ${adaylar(/isim|ad|aciklama|tanim/i).join(', ') || '(yok)'}`,
      ].filter(Boolean).join(' · ');

      return `${demOnEk}${yazilan} demirbaş sabitKiymetler'e yazıldı — kolonu çözülemeyen alanlar: ${eksik}`
        + (demSayac ? ` · ${demSayac}` : '')
        + ` (ham veri mikroHam'da). Toplam ${cols.length} kolon. ${ipucu}`;
    },
  });

  // 10. Maliyet merkezleri → maliyetMerkezleri
  //
  // Mikro'da "maliyet merkezi" karşılığı SORUMLULUK_MERKEZLERI'dir (sema-kesif
  // `maliyetMerkeziTabloAdaylari`: 35 kolon). Aynı listede IS_MERKEZLERI (üretim iş
  // merkezi), MASRAF_HESAPLARI (masraf hesap planı) ve PROJELER de var — onlar farklı
  // kavramlar, bilerek seçilmedi.
  makeMikroSqlImport({
    route: '/api/mikro/import/maliyet-merkezi',
    tablo: 'SORUMLULUK_MERKEZLERI',
    siralama: 'som_Guid',
    collection: 'mikroMaliyetMerkezleri',
    label: 'Mikro Maliyet Merkezleri',
    postProcess: async (rows, companyId) => {
      if (!C.getAdminDb() || !rows.length) return null;
      // Demirbaş importundaki desen: TEK snapshot hem id çözücüyü hem VAR OLAN doküman
      // verisini besler (mikroIdCozucu zaten aynı koleksiyonu okuyordu — ek sorgu YOK).
      // Mevcut doküman verisi `aktif: true`yi yalnız YENİ kayda yazabilmek için gerekli:
      // kullanıcının MaliyetMerkeziModule'den pasife aldığı merkez her senkronda diriliyordu.
      const mmSnap   = await C.tenantSnap('maliyetMerkezleri', companyId);
      const mmId     = C.mikroIdCozucuIds(mmSnap.docs.map(d => d.id), companyId);
      const mmMevcut = new Map(mmSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
      const cols = Object.keys(rows[0]);
      const kod  = kolonSec(cols, [/^som_kodu$/i, /^som_kod$/i, /^som_.*kodu$/i, /kodu$/i]);
      const ad   = kolonSec(cols, [/^som_adi$/i, /^som_isim$/i, /^som_.*(isim|adi)$/i, /(isim|adi)$/i]);
      if (!kod) return `maliyet merkezi kodu kolonu bulunamadı — mevcut: ${cols.slice(0, 30).join(', ')}`;
      // ÇAKIŞMA GUARD'I: SORUMLULUK_MERKEZLERI'nin 35 kolonunun GERÇEK adları hiç
      // görülmedi; `kod`/`ad`'ın en geniş yedekleri (/kodu$/i, /(isim|adi)$/i) aynı
      // kolona ya da birbirine yanlışlıkla bağlanabilir. `kod` DOKÜMAN ID'sidir —
      // çakışırsa farklı maliyet merkezleri AYNI docId'ye düşüp birbirini SESSİZCE
      // ezer (demirbaş import'unda kanıtlanan sınıfın aynısı). Çakışırsa DURDURULUR.
      if (kod === ad) {
        return `maliyet merkezi kodu kolonu ('${kod}') ad alanıyla çakışıyor — eşleme güvenilmez, veri yazılmadı. Mevcut kolonlar: ${cols.slice(0, 30).join(', ')}`;
      }

      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      // Gövde TEK KAYNAKTA: src/server/mikro/eslemeVarlik.ts (maliyetMerkeziEsle)
      const ozetMM = ozetBaslat();
      for (const r of rows) {
        const k = mikroKod(r, kod);
        if (!k) continue;
        const docId = mmId(k.replace(/[/\\]/g, '_'));
        const { alanlar } = ozetEkle(ozetMM, maliyetMerkeziEsle(r, { kod, ad }, mmMevcut.get(docId)));
        batch.set(C.getAdminDb().collection('maliyetMerkezleri').doc(docId), {
          companyId,
          ...alanlar,
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      const mmAriza = varlikArizalari(ozetMM, MALIYET_MERKEZI_KRITIK);
      if (mmAriza.length) console.warn(`[import/maliyet-merkezi] ${varlikArizaUyarisi(mmAriza)}`);
      const mmSayac = bilinmeyenNotu(ozetMM, mmAriza);
      return (mmAriza.length ? `${varlikArizaUyarisi(mmAriza)} ` : '')
        + `${yazilan} maliyet merkezi maliyetMerkezleri'ne yazıldı`
        + (ad ? '' : ' — ad kolonu çözülemedi (ham veri mikroHam\'da)')
        + (mmSayac ? ` · ${mmSayac}` : '');
    },
  });

  // ── Gece SQL senkronu (MIKRO_CRON_SYNC=true ise) ─────────────────────────
  // Kullanıcı her seferinde Ayarlar > ERP Hub'a girip tek tek düğmeye basmak
  // zorunda kalmasın diye (2026-07-31 talebi). Login tetiklemesi YERİNE cron:
  // login'de çalıştırmak her kullanıcı girişinde tüm veriyi yeniden çeker,
  // birkaç kişi aynı anda girince Mikro'ya kat kat yük biner ve kullanıcı
  // bekler. Mikro tek servis ve eşzamanlı yükte çöktüğü biliniyor.
  //
  // Adımlar SIRAYLA koşar (paralel değil, aynı gerekçe). Bir adım patlarsa
  // durmaz; her adım syncLog'a kendi sonucunu yazar.
  if (process.env.MIKRO_CRON_SYNC === 'true') {
    const sqlSenkronHedefTenant = async (): Promise<string> => {
      if (process.env.MIKRO_CRON_COMPANY_ID) return process.env.MIKRO_CRON_COMPANY_ID;
      if (!C.getAdminDb()) return '';
      const snap = await C.getAdminDb().collection('users').get();
      // Set<string> ACIKCA: C.getAdminDb() baglamda `any` oldugu icin snap.docs da
      // any oluyor ve `new Set(any)` TypeScript'te Set<unknown> cikariyor.
      const cids = new Set<string>(snap.docs.map((d: { data: () => Record<string, unknown>; id: string }) =>
        (d.data().companyId as string) || d.id));
      if (cids.size === 1) return [...cids][0];
      console.error(`Mikro SQL senkron: ${cids.size} tenant var ve MIKRO_CRON_COMPANY_ID tanımsız → atlandı.`);
      return '';
    };

    // Gece penceresi TANIM BAŞINA (K-B, 2026-09-24): `gecePenceresi:'tam'` → tüm geçmiş; yoksa son
    // GECE_PENCERESI_GUN gün. 90 = POLİTİKA (tam geçmişi her gece yeniden çekmek gereksiz yük; ilk dolum
    // elle ERP Hub'dan, cron tazeler), ölçüm değil. Tarih kolonu olmayan 8 tanımda etkisiz.
    const GECE_PENCERESI_GUN = 90;
    const geceIlkTarih = (pencere: SqlImportOpts['gecePenceresi']): string =>
      pencere === 'tam'
        ? '2000-01-01'
        : new Date(Date.now() - (pencere ? pencere.gun : GECE_PENCERESI_GUN) * 864e5).toISOString().slice(0, 10);

    // 03:20 İstanbul (zamanla.ts). Yedek görevi 03:30 SUNUCU-yerel saattedir;
    // sunucu dilimi düzeltilene kadar ikisi arasında sıra ilişkisi yoktur.
    // CRON ÇAĞRI DESENİ DEĞİŞMEZ: SQL_IMPORT_TANIMLARI → mikroSqlImportCalistir DOĞRUDAN; arka plan
    // yardımcısına (arkaPlanIsiBaslat) BAĞLANMAZ, kilit ALMAZ, `ilerle` geçmez (parite testi d).
    // BİLİNÇLİ FARK (S5/K-A ortak gövde, 2026-09-25): sayfa sorgusu + iptal süpürgesi listeZamanAsimiMs()
    // kullanır → burada da sayfa zaman aşımı 30 sn → 120 sn (env ile en çok 600 sn). SQL yolunda devre
    // kesici YOK (yalnız stok/cari adaptif sayfalamada): Mikro bağlantıyı kabul edip yanıt vermezse her
    // tanım bir zaman aşımıyla düşer → 12 × 120 sn ≈ 24 dk (HEAD ≈ 6 dk; 600 sn'de ≈ 2 saat). Veri kaybı yok
    // (tanım syncLog'a false yazar, sıradakine geçer); kilit almadığı için bu sürede elle başlatılan arka
    // plan işi de aynı asılı servise gider. Değer parite testi (d)'de kilitli.
    zamanla('20 3 * * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro SQL senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      // Üst sınır YOK (son = null): eski `mikroBugun()` sınırı ileri tarihli kaydı (30.09.2026 LUCA
      // satırı) düşürüyordu; `tarihKosulu` `>=` üretir.
      const son = null;
      console.log(`Mikro SQL senkron başlıyor (pencere tanım başına: 'tam' | ${GECE_PENCERESI_GUN} gün, üst sınır yok, ${SQL_IMPORT_TANIMLARI.length} adım)`);
      let ok = 0, hata = 0;
      for (const opts of SQL_IMPORT_TANIMLARI) {
        const ilk = geceIlkTarih(opts.gecePenceresi);
        try {
          const r = await mikroSqlImportCalistir(opts, companyId, ilk, son, actor);
          if (r.ok) { ok++; console.log(`  ${opts.label}: ${r.total} kayıt`); }
          else { hata++; console.warn(`  ${opts.label}: ${r.error}`); }
        } catch (e) { hata++; console.warn(`  ${opts.label} istisna:`, e instanceof Error ? e.message : String(e)); }
      }
      console.log(`Mikro SQL senkron bitti: ${ok} başarılı, ${hata} hatalı`);
    });

    // ── Ayda bir TAM senkron (ayın 1'i, 02:00) ────────────────────────────
    // Gecelik koşu son 90 günü tazeliyor; onun dışında kalan eski kayıtlar
    // hiç güncellenmiyordu. Mikro kayıt SİLMEZ, `iptal=1` diye işaretler —
    // yani eski bir faturanın iptal edilmesi 90 günü geçtiyse bize hiç
    // yansımıyordu. Tam senkron bunu kapatır.
    //
    // 02:00 İstanbul: gecelik SQL senkronundan (03:20 İstanbul) ÖNCE biter. Yedek
    // görevi sunucu-yerel 03:30'dadır (yukarıdaki not), onunla sıra ilişkisi kurulmaz.
    // Ayda bir olduğu için yükü kabul edilebilir.
    zamanla('0 2 1 * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro TAM senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      const son = null;           // üst sınır yok (gece cron ile aynı gerekçe)
      const ilk = '2000-01-01';   // tüm geçmiş
      console.log(`Mikro TAM senkron başlıyor (${ilk} → sınırsız, ${SQL_IMPORT_TANIMLARI.length} adım)`);
      let ok = 0, hata = 0;
      for (const opts of SQL_IMPORT_TANIMLARI) {
        try {
          const r = await mikroSqlImportCalistir(opts, companyId, ilk, son, actor);
          if (r.ok) { ok++; console.log(`  ${opts.label}: ${r.total} kayıt${r.truncated ? ' (TAVANA ÇARPTI)' : ''}`); }
          else { hata++; console.warn(`  ${opts.label}: ${r.error}`); }
        } catch (e) { hata++; console.warn(`  ${opts.label} istisna:`, e instanceof Error ? e.message : String(e)); }
      }
      console.log(`Mikro TAM senkron bitti: ${ok} başarılı, ${hata} hatalı`);
    });
  }


  /** POST /api/mikro/import/stok-miktar — stok miktarlarını Mikro'dan çek.
   *  StokListesiV2 miktar DÖNDÜRMEZ; tek kaynak GenelAmacliMaliyetListesiV2
   *  (SKU başına tek çağrı, EldekiMiktar + MaliyetBedeli döner).
   *  1700+ SKU = uzun iş → hemen { started: true, job: 'stokMiktarImport' } döner, ilerleme
   *  jobs/stokMiktarImport dokümanına canlı yazılır (panel onSnapshot ile izler).
   *  2026-09-24: arka plan deseni (kilit + IIFE + jobs + anında yanıt) buradan
   *  src/server/mikro/arkaPlanIsi.ts'e ÇIKARILDI — 15 import ucu aynı yardımcıyı kullanır;
   *  doküman id'si/alanları AYNEN (panel paritesi), +companyId/isAdi damgası.
   */
  app.post('/api/mikro/import/stok-miktar', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    // Kısa devre ÖNCE (HEAD 2582 kuralı): iş zaten koşuyorsa ya da bakım kilidi varsa hiçbir yoklama/sorgu
    // maliyeti ödeme. Delta hakem 2026-09-25 (bulgu 3/8): kısa devre helper'a taşınınca V17 yoklamasının
    // ARKASINA kaymıştı — kilit doluyken yoklama koşan işe paralel Mikro'ya gidiyor, yük altında düşerse
    // `false` 10 dk önbelleğe giriyor ve kullanıcı "Başka bir iş çalışıyor" yerine yanıltıcı 501 görüyordu.
    // Otorite yine arkaPlanIsiBaslat (yoklama sürerken durum değişebilir); bu yalnız maliyet kısa devresi.
    const onKontrol = await arkaPlanOnKontrol(arkaPlanDep(), { bakimKilidi: true });
    if (onKontrol) return arkaPlanYaniti(res, onKontrol);
    const cidStok = await C.reqCompanyId(req);
    // Bayrak "hayır" derse metodu GERÇEKTEN yokla (önbellekli — bkz. mikroClient).
    const v17Var = await v17MetoduKullanilabilir('GenelAmacliMaliyetListesiV2', async () => {
      // Yoklama KENDİ kiracısının SKU'suyla yapılır (CLAUDE.md tenant deseni);
      // dönen SKU hata metnine girmez — kiracılar arası ad sızıntısı olmasın.
      const probeSnap = await C.getAdminDb()!.collection('inventory')
        .where('companyId', '==', cidStok).where('source', '==', 'mikro_import').limit(1).get();
      const probeSku = ((probeSnap.docs[0]?.data()?.sku as string) || '').trim();
      if (!probeSku) return false;
      const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
        StokKod: probeSku, IlkTarih: '2000-01-01',
        SonTarih: new Date().toISOString().slice(0, 10), Depolar: '1',
      });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const d = (r0?.Data ?? {}) as Record<string, unknown>;
      return ok && !!r0 && !r0.IsError && d.EldekiMiktar != null;
    });
    if (!v17Var) {
      return res.status(501).json({
        success: false,
        error: 'Stok miktarı/maliyet çekimi GenelAmacliMaliyetListesiV2 gerektirir — bu method yalnız Mikro Jump V17+ kurulumlarında var. ' +
               'Mikro Jump V17 güncellemesi sonrası .env\'e MIKRO_JUMP_SURUM=17 ekleyin. (Canlı yoklama da doğrulayamadı.)',
        requiresVersion: 17, currentVersion: MIKRO_JUMP_SURUM,
      });
    }

    const actor = C.reqActor(req);
    // 'stokMiktarImport' — panel paritesi, sözlük istisnası (src/lib/mikroIsAdi.ts). Kısa devre
    // (alreadyRunning) + bakım kilidi (423) yoklamadan ÖNCE `arkaPlanOnKontrol` ile soruldu; helper aynı
    // kararı yetkili olarak yeniden verir (yazıcı kaydıyla birlikte).
    const isAdi = mikroIsAdi('/api/mikro/import/stok-miktar');
    const sonuc = await arkaPlanIsiBaslat(arkaPlanDep(), {
      isAdi, companyId: cidStok, actor,
      senkronKaydi: { operation: 'GenelAmacliMaliyetListesiV2', entityType: 'inventory', denetimEtiketi: 'Mikro Stok Miktarları' },
      // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts); kayıt İŞ ömrünce durur.
      yaziciAdi: arkaPlanYaziciAdi(isAdi, Date.now()),
      calistir: async (ilerle) => {
        const t0 = Date.now();
        let processed = 0, updated = 0, failed = 0;
        /** Mikro yanıtında okunamayan alanların satır sayacı (miktar/maliyet). */
        const miktarSayac = sayacOlustur();
        // Per-depo dağılımı otoriter toplamla tutmayan SKU sayısı (bkz. mutabakat kontrolü).
        let depoUyusmazlik = 0;
        /** Dağılımı yazılan ürün sayısı — hareketi olmayan ürün hiç kontrol edilmez. */
        let depoDagilimliUrun = 0;
        /** Dağılımına `__devir` kovası eklenen ürün sayısı (açılış stoğu defterde yok). */
        let depoDevirli = 0;
        const uyusmazlikOrnek: { sku: string; toplam: number; beklenen: number }[] = [];
        // Kiracı süzgeci ŞART (inceleme bulgusu 2026-09-25): eskiden yalnız `source` ile
        // okunuyordu → iş, başka kiracının Mikro ürünlerine de bu kiracının Mikro'sundan
        // okunan miktarı yazardı. Yoklama (yukarıda) ile AYNI koşul.
        const invSnap = await C.getAdminDb()!.collection('inventory')
          .where('companyId', '==', cidStok).where('source', '==', 'mikro_import').get();
        const items = invSnap.docs
          .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
          .filter(x => x.sku);
        const total = items.length;
        // companyId + depo listesi bir kez (döngü içinde tekrar tekrar değil).
        // Kiracı yanıt ÖNCESİ çözüldü (cidStok = reqCompanyId); `calistir` gövdesi req/res bilmez.
        const companyId = cidStok;
        const wiId = await C.mikroIdCozucu('warehouseItems', companyId);
        // Depo numaraları warehouses'tan (mikro-depo-<n>). Kart sto_yer_kod GÜVENİLMEZ
        // (hepsi HAVALIMANI); gerçek stok yeri per-depo miktarla bulunur.
        const depoSnap = await C.getAdminDb()!.collection('warehouses').where('companyId', '==', companyId).get();
        const fetchedDepoNos = depoSnap.docs.map(d => d.id).filter(id => id.startsWith('mikro-depo-')).map(id => id.slice('mikro-depo-'.length)).filter(Boolean);
        // AGGREGATE (stockLevel) HİÇBİR ZAMAN eski '1,2,3,4,5' kapsamından dar
        // OLMAMALI — warehouses eksik doluysa toplam stok az sayılırdı (code-review
        // bulgusu). Union: bilinen 1-5 + warehouses'taki ek depolar. Olmayan depo
        // sorgusu 0 döner (zararsız).
        const depoNos = Array.from(new Set([...fetchedDepoNos, '1', '2', '3', '4', '5']));
        
        // code-review #7: per-depo stok miktarını tek bir SQL ile toptan çek (polling engelle)
        // Her SKU için ayrı ayrı GenelAmacliMaliyetListesiV2 çağırmak O(SKU * Depo) maliyetliydi.
        const sqlPerDepo = 'SELECT sth_stok_kod, depo, SUM(net) AS bakiye FROM (' +
             'SELECT sth_stok_kod, sth_giris_depo_no AS depo, sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 0 AND ISNULL(sth_iptal, 0) = 0 ' +
             'UNION ALL ' +
             'SELECT sth_stok_kod, sth_cikis_depo_no AS depo, -sth_miktar AS net FROM STOK_HAREKETLERI WHERE sth_tip = 1 AND ISNULL(sth_iptal, 0) = 0' +
             ') t GROUP BY sth_stok_kod, depo HAVING SUM(net) <> 0';
        const { rows: perDepoRows, hata: sqlHata } = await mikroSql(sqlPerDepo);
        const depoMap = new Map<string, Record<string, number>>();
        if (!sqlHata && perDepoRows) {
            // Gövde tek kaynakta (server/mikro/eslemeStok.ts → depoSatiriCoz): bakiye SAYI
            // DEĞİLSE satır atlanır ve sayılır — eski `Number(row.bakiye ?? 0)` metin/NaN
            // durumunda `NaN === 0` false olduğu için satırı ELEYEMİYOR ve depoBreakdown'a
            // NaN düşürüyordu. Bakiye gerçekten 0 ise atlanır ama bilinmeyen SAYILMAZ.
            const depoSayac = sayacOlustur();
            for (const row of perDepoRows) {
                const { satir, bilinmeyen } = depoSatiriCoz(row);
                sayacaEkle(depoSayac, bilinmeyen);
                if (!satir) continue;
                if (!depoMap.has(satir.sku)) depoMap.set(satir.sku, {});
                depoMap.get(satir.sku)![satir.depoNo] = satir.bakiye;
            }
            const depoArizasi = okumaArizasiNotu(okumaArizalari(depoSayac, DEPO_KRITIK));
            if (depoArizasi) console.warn('[import/stok-miktar] per-depo:', depoArizasi);
        }
        
        // Helper başlangıç dokümanı (running/startedAt/finishedAt:null/error:null/companyId/isAdi) + bu
        // merge = eski 2671 alanları. GÖRÜNÜR fark: running:true birkaç sn ERKEN yazılır (envanter
        // snapshot + per-depo SQL öncesi); panel `total ?? '?'` bunu zaten karşılıyor.
        await ilerle({ processed: 0, updated: 0, failed: 0, total });

        const sonTarih = mikroBugun();
        const CONCURRENCY = 8;
        let batch = C.getAdminDb()!.batch(); let ops = 0;
        const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };

        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const slice = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map(async (it) => {
            // `okunamadi`: Mikro yanıtı HİÇ okunamadı (ağ/IsError/istisna) — bu satır
            // "alan eksik" DEĞİL, "satır yok" demektir ve bilinmeyen-alan sayacına
            // GİRMEZ. Girerse payda şişer (`n === satır` bozulur) ve "hiçbir satırda
            // okunamadı" kapısı tek bir ağ hatasıyla susar: 2365 SKU'luk koşuda 1 SKU
            // düşerse maliyet arızası uyarısı hiç basılmazdı (hakem bulgusu 2026-09-19).
            // Satır yine `failed` sayılır (aşağıda `qty === null`), yani kaybolmaz.
            const bos = { it, qty: null as number | null, cost: null as number | null, depoQtys: null as Record<string, number> | null,
                          uyusmazlik: null as { sku: string; toplam: number; beklenen: number } | null,
                          devirli: false, bilinmeyen: [] as string[], okunamadi: true };
            try {
              // 1) Toplam (tüm depolar) — stockLevel + maliyet. AUTHORITATIVE, değişmez.
              const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
                StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: depoNos.join(','),
              });
              const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
              if (!ok || !r0 || r0.IsError) return bos;
              const d = (r0.Data ?? {}) as Record<string, unknown>;
              // Gövde tek kaynakta (server/mikro/eslemeStok.ts → stokMiktarEsle): miktar alanı
              // hiç yoksa "0 stok" DEĞİL "yanıt okunamadı" demektir (0 yazıp başarılı saymak
              // gerçek stoğu siler); MaliyetBedeli yoksa costPrice YAZILMAZ — eski `?? 0`
              // ürünün gerçek maliyetini 0 TL yapıyordu (kâr/zarar ve teklif marjı bunu okur).
              // Birim maliyet = toplam/miktar ve 2 hane yuvarlama da o modülde.
              const { alanlar: miktarAlan, bilinmeyen } = stokMiktarEsle(d);
              const qty = miktarAlan.stockLevel;
              // Yanıt OKUNDU ama miktar alanı yok: bu satır sayaca GİRER (alan gerçekten
              // eksik), yalnız yazım yapılmaz ve `failed` sayılır.
              if (qty === undefined) return { ...bos, bilinmeyen, okunamadi: false };
              const cost = miktarAlan.costPrice ?? null;

              // 2) Per-depo: stok GERÇEKTE nerede? code-review #7 ile tek bir SQL'de
              // STOK_HAREKETLERI'nden toplu çekildi (ağır polling yerine O(1) maliyet).
              //
              // MUTABAKAT + DEVİR KOVASI (2026-08-11)
              //
              // Semantik canlı veriyle DOĞRULANDI: hareketi olan ürünlerde dağılımın
              // toplamı otoriter toplama oturuyor. Ama kaynak EKSİK: STOK_HAREKETLERI
              // yalnız FATURA satırlarını taşıyor (1090 satır = 602 satış + 486 alış + 2),
              // açılış/devir stoğu bu tabloda YOK. Devri olan üründe hareket defterinden
              // türetilen dağılım sistematik olarak eksik kalıyor
              // (YPR-4160: 551-224=327 ama Mikro 527 → 200 devir).
              //
              // Ürünü tamamen gizlemek yerine farkı DÜRÜSTÇE ayrı kovada gösteriyoruz:
              // `__devir` = otoriter toplam - hareket defteri toplamı. Böylece dağılım
              // toplamı her zaman gerçek stoğa eşit olur ve kullanıcı stoğun nerede
              // OLMADIĞINI değil, neresinin BİLİNMEDİĞİNİ görür.
              //
              // Ters yön (defter gerçek stoktan FAZLA diyorsa) devirle açıklanamaz —
              // orada hâlâ hiç dağılım yazılmaz ve uyuşmazlık olarak raporlanır.
              let depoQtys: Record<string, number> | null = null;
              let uyusmazlik: { sku: string; toplam: number; beklenen: number } | null = null;
              let devirli = false;
              if (qty > 0) {
                const fromMap = depoMap.get(it.sku);
                if (fromMap && Object.keys(fromMap).length > 0) {
                  const toplam = Object.values(fromMap).reduce((a, b) => a + b, 0);
                  // Tolerans: kesirli miktarlarda kayan nokta + Mikro yuvarlaması.
                  const tolerans = Math.max(0.01, Math.abs(qty) * 0.001);
                  const fark = qty - toplam;
                  if (Math.abs(fark) <= tolerans) {
                    depoQtys = fromMap;                       // birebir tutuyor
                  } else if (fark > 0) {
                    depoQtys = { ...fromMap, __devir: fark }; // eksik kısım = devir
                    devirli = true;
                  } else {
                    uyusmazlik = { sku: it.sku, toplam, beklenen: qty };
                  }
                }
              }

              return { it, qty, cost, depoQtys, uyusmazlik, devirli, bilinmeyen, okunamadi: false };
            } catch { return bos; }
          }));

          for (const r of results) {
            processed++;
            // Yanıtı okunabilen satırlar sayaca girer (bkz. `okunamadi` gerekçesi).
            if (!r.okunamadi) sayacaEkle(miktarSayac, r.bilinmeyen);
            if (r.uyusmazlik) {
              depoUyusmazlik++;
              // İlk birkaç örneği sakla — teşhis için (hepsini tutmak gereksiz).
              if (uyusmazlikOrnek.length < 5) uyusmazlikOrnek.push(r.uyusmazlik);
            }
            if (r.devirli) depoDevirli++;
            // Dağılımı OLAN ürün sayısı: "2365 doğrulandı" yanılgısını önler —
            // hareket kaydı olmayan ürün kontrol EDİLMEZ, atlanır (1090 hareket
            // satırı 2367 ürüne yayılıyor, çoğunun hiç hareketi yok).
            if (r.depoQtys) depoDagilimliUrun++;
            if (r.qty === null) { failed++; continue; }
            batch.update(r.it.ref, {
              stockLevel: r.qty,
              // Yuvarlama (2 hane) stokMiktarEsle'de yapılıyor — burada tekrar yuvarlanmaz.
              ...(r.cost !== null ? { costPrice: r.cost } : {}),
              mikroSyncedAt: pgServerTimestamp(),
            });
            ops++;
            // Depo sekmesindeki kayıt: TEK birincil depo YOK — stoğu olan HER depo
            // depoBreakdown'da (ekran her depoyu ayrı gösterir). Eski tek-depo atamasını
            // temizle (warehouseId:null) ki bayat HAVALIMANI kaydı kalmasın; depoBreakdown
            // güvenilirse onu yaz, değilse (guard) yalnız temizle.
            batch.set(C.getAdminDb()!.collection('warehouseItems').doc(wiId(r.it.sku.replace(/[/\\]/g, '_'))), {
              companyId,
              quantity: r.qty,
              warehouseId: null,
              depoBreakdown: r.depoQtys ?? null,
              updatedAt: pgServerTimestamp(),
            }, { merge: true });
            ops++;
            updated++;
            if (ops >= 400) await commitBatch();
          }
          if (processed % 48 === 0 || processed === total) {
            await commitBatch();
            await ilerle({ processed, updated, failed, total });
          }
        }
        await commitBatch();
        const duration = Date.now() - t0;
        const depoNot =
          `, ${depoDagilimliUrun} üründe depo dağılımı yazıldı` +
          (depoDevirli > 0 ? ` (${depoDevirli}'inde devir kovası)` : '') +
          (depoUyusmazlik > 0 ? `, ${depoUyusmazlik} üründe toplam tutmadı (dağılım yazılmadı)` : '');
        // Burada miktar KRİTİKTİR: rotanın tek işi odur (stok kartı import'unun aksine).
        const miktarArizaAlanlari = okumaArizalari(miktarSayac, STOK_MIKTAR_KRITIK);
        const miktarArizasi = okumaArizasiNotu(miktarArizaAlanlari);
        if (miktarArizasi) console.warn('[import/stok-miktar]', miktarArizasi);
        const miktarSayacMetni = sayacNotu(miktarSayac, miktarArizaAlanlari);
        const miktarOzet = (miktarArizasi ? `${miktarArizasi} ` : '') +
          `${updated} ürünün miktarı güncellendi, ${failed} hata${depoNot}` +
          (miktarSayacMetni ? `, ${miktarSayacMetni}` : '') +
          ` (${Math.round(duration / 1000)}sn)`;
        console.log(`Stok miktar import bitti: ${updated} güncellendi, ${failed} hata, depo uyuşmazlık ${depoUyusmazlik}, ${duration}ms`);
        if (uyusmazlikOrnek.length) console.warn('Depo dağılımı uyuşmazlık örnekleri:', uyusmazlikOrnek);
        // Bitiş dokümanı `jobs/stokMiktarImport` (helper merge'ler; şekil 2798-2803 ile BİREBİR — panel okur).
        // syncLog (2819) + audit 'Mikro Stok Miktarları' (2820) helper'da aynı argümanlarla.
        return {
          jobAlanlari: {
            processed, updated, failed,
            // Panel bunu gösterir. depoDagilimliUrun ŞART: hareketi olmayan ürün hiç
            // kontrol edilmediği için "uyuşmazlık 0" tek başına "hepsi doğrulandı"
            // ANLAMINA GELMEZ — kapsamı da göstermeliyiz.
            depoUyusmazlik, depoDagilimliUrun, depoDevirli, uyusmazlikOrnek,
          },
          ozet: miktarOzet, basarili: failed === 0, hata: failed ? `${failed} SKU okunamadı` : null,
          // Okunamayan SKU İŞ HATASI DEĞİL (hakem 2026-09-25, parite): sayısı `failed`da, syncLog yukarıdaki
          // gibi success:false + 'N SKU okunamadı' (2819 AYNEN); jobs `error` null kalır — HEAD bitiş merge'i
          // (2798-2803) error'a dokunmuyordu. Dolu olsa kart '⚠ N hata · tamamlandı' yerine 'Son koşu hatası'
          // basar, Tümünü Çek adımı HATA sayılırdı. (Kısmi SKU arızası iş hatası mı: kullanıcı kararı, açık soru.)
          isHatasi: null,
        };
      },
    });
    return arkaPlanYaniti(res, sonuc);
  });

  /** GET /api/mikro/cari-hareket/turler — bu firmanın GERÇEKTEN kullandığı
   *  cari hareket türleri (cha_evrak_tip dağılımı) + her tür için örnek alan
   *  değerleri.
   *
   *  Neden: Mikro'da onlarca evrak tipi var ama her firma birkaçını kullanır.
   *  Dekont ekranına sabit bir tür listesi gömmek tahmin olurdu; bunun yerine
   *  kullanıcının kendi verisinden okuyoruz. Örnek alanlar da dönüyor ki
   *  DekontKaydetV2 gövdesini onların kullandığı kalıba göre dolduralım.
   */
  app.get('/api/mikro/cari-hareket/turler', C.requireAuth, C.mikroLimiter, async (_req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    try {
      const { rows, hata } = await mikroSql(
        `SELECT cha_evrak_tip, cha_cinsi, cha_tip, ` +
        `COUNT(*) AS adet, MIN(cha_evrakno_seri) AS ornekSeri, ` +
        `MIN(cha_cari_cins) AS ornekCariCins, MIN(cha_d_cins) AS ornekDovizCins ` +
        `FROM CARI_HESAP_HAREKETLERI ` +
        `GROUP BY cha_evrak_tip, cha_cinsi, cha_tip ` +
        `ORDER BY COUNT(*) DESC`,
      );
      if (hata) return res.status(502).json({ success: false, error: hata });
      res.json({ success: true, turler: rows });
    } catch (err) {
      console.error('[cari-hareket/turler]', err);
      res.status(500).json({ success: false, error: 'Hareket türleri okunamadı.' });
    }
  });

  /** GET /api/mikro/cari-hareket/:cariKod — tek carinin TÜM hesap hareketleri.
   *
   *  Neden: CariEkstrePanel.tsx eskiden onSnapshot(collection(db,'mikroCariHareketler'),
   *  where('cha_kod','==',cariKod)) kullanıyordu — dbClient shim'de where() SUNUCUDA
   *  değil İSTEMCİDE filtreleniyor (src/lib/dbClient.ts onSnapshot: stream.getDocs(coll)
   *  TÜM koleksiyonu döker, applyConstraints tarayıcıda filtreler). mikroCariHareketler
   *  şirket-geneli tüm carilerin tüm hareketlerini tuttuğundan, TEK cari ekstresi
   *  açılırken şirketin TÜM Mikro cari hareket geçmişi tarayıcıya indiriliyordu —
   *  "çok yavaş" şikayetinin sebebi (2026-08-13). Filtre burada, sunucuda, sadece
   *  bu tenant'ın verisi üstünde (loadCompanyDocs zaten companyId'ye göre daralt-
   *  ıyor) yapılıyor; tele yalnız eşleşen satırlar gidiyor. Canlılık (yeni hareket
   *  gelince otomatik güncelleme) kayboluyor — kısa süreli açılan bir detay ekranı
   *  için kabul edilebilir bir ödün, aynı /api/reports/stok-fiyat-karsilastirma/:sku/detay
   *  deseniyle tutarlı.
   */
  app.get('/api/mikro/cari-hareket/:cariKod', C.requireAuth, C.requireCollectionAccess('mikroCariHareketler', 'read'), async (req: Request, res: Response) => {
    try {
      const cariKod = String(req.params['cariKod'] || '').trim();
      if (!cariKod) return res.status(400).json({ success: false, error: 'cariKod gerekli.' });
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const docs = await C.loadCompanyDocs('mikroCariHareketler', cid);
      const satirlar = docs.filter(d => String(d.cha_kod ?? '').trim() === cariKod);
      res.json({ success: true, cariKod, satirlar, toplam: satirlar.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/mikro/cari-hareket/kaydet — cari hareket (dekont) → Mikro
   *  Body: { hareket: Record<string, unknown>, aciklama?: string }
   *  Gövde tek kaynakta: server/mikro/govdeMuhasebe.ts → `cariHareketGovdesi`
   *  (V17 DekontKaydetV2 zarfı + zorunlu beşli denetimi; 2026-07-30 canlı-doğrulama
   *  notu oraya TAŞINDI).
   */
  app.post('/api/mikro/cari-hareket/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { hareket, aciklama } = req.body as { hareket: Record<string, unknown>; aciklama?: string };
    if (!hareket || typeof hareket !== 'object') return res.status(400).json({ success: false, error: 'hareket alanı zorunlu.' });
    const t0 = Date.now();
    let govde: CariHareketGovde;
    try {
      govde = cariHareketGovdesi(hareket, aciklama);
    } catch (e) {
      if (!mikroGovdeHatasiMi(e)) {
        console.error('[cari-hareket/kaydet] gövde', e);
        return res.status(500).json({ success: false, error: 'Cari hareket kaydedilemedi.' });
      }
      // Sessiz kalmasın: gövde hatasında mikroPost çağrılmıyor, tek iz syncLog.
      await C.writeSyncLog('DekontKaydetV2', 'payment', String(hareket.cha_kod ?? 'bilinmiyor'), false, null, e.message, Date.now() - t0, C.reqActor(req));
      return res.status(400).json({ success: false, error: e.message });
    }
    try {
      const { ok, data, status } = await mikroPost('DekontKaydetV2', govde.payload, true); // inMikro: V17 evrak kalıbı — alanlar Mikro objesi İÇİNDE
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await C.writeSyncLog('DekontKaydetV2', 'payment', govde.cariKod, success, null, errorMsg, Date.now() - t0, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...govde.satir, __kaynak: 'hareket_push' }], CHA_COLS);
      res.json({ success, error: errorMsg, data });
    } catch (err) {
      console.error('[cari-hareket/kaydet]', err);
      res.status(500).json({ success: false, error: 'Cari hareket kaydedilemedi.' });
    }
  });

  // ── Genel Mikro Evrak Push ────────────────────────────────────────────────
  // V17 Kaydet endpoint'leri için tek kapı. Alan eşlemesi client'taki
  // mikroEvrak.ts eşleyicilerinde yapılır; server yalnızca whitelist'i
  // doğrular, Mikro'ya iletir (payload Mikro objesi İÇİNDE) ve loglar.
  const MIKRO_PUSH_WHITELIST = new Set([
    'VerilenTeklifKaydetV2', 'AlinanTeklifKaydetV2',
    'SayimSonuclariKaydetV2', 'SayimKesinlestirmeV2',
    'DahiliStokHareketKaydetV2',
    'PersonelIzinTalepKaydetV2', 'PersonelizinKaydetV2', 'PersonelKaydetV2',
    'SatinAlmaTalepKaydetV2',
    'DepolarArasiSiparisKaydetV2',
    'BakimTalepKaydetV2', 'BakimHareketleriKaydetV2', 'BakimSarfiyatlariKaydetV2', 'BakimSozlesmeKaydetV2',
    'ServisIsEmriKaydetV2', 'ServisFormuKaydetV2', 'ServisMalzemePlanKaydetV2', 'ServisRotaPlanKaydetV2',
    'UretimTalepKaydetV2', 'UrunReceteKaydetV2', 'UrunRotaKaydetV2', 'UretimIsEmriOlusturV2', 'UretimRotaPlanKaydetV2',
    'EtiketBasimKaydetV2',
    'ZiyaretKaydetV2',
    'DekontKaydetV2',
  ]);

  app.post('/api/mikro/evrak/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { method, payload, entityType, entityId } = req.body as {
      method: string; payload: Record<string, unknown>; entityType?: string; entityId?: string;
    };
    if (!method || !MIKRO_PUSH_WHITELIST.has(method)) {
      return res.status(400).json({ success: false, error: `Geçersiz veya izinsiz method: ${method}` });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, error: 'payload zorunlu.' });
    }
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost(method, payload, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await C.writeSyncLog(method, entityType || 'evrak', entityId || 'unknown', success, null, errorMsg, Date.now() - t0, C.reqActor(req));
      res.json({ success, error: errorMsg, data: r0?.Data ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog(method, entityType || 'evrak', entityId || 'unknown', false, null, msg, Date.now() - t0, C.reqActor(req));
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** POST /api/mikro/yevmiye/kaydet — yevmiye fişlerini Mikro'ya aktar (MuhasebeFisKaydetV2).
   *  Body: { entries: [{id, date(YYYY-MM-DD), aciklama, debitHesap, alacakHesap, borc, alacak}] }
   *  Her kayıt çift taraflı 2 satır olur: borç satırı (+meblag) ve alacak satırı (-meblag).
   *  Yalnızca Mikro'nun kabul ettiği fişlerin id'leri syncedIds olarak döner.
   *  Gövde tek kaynakta: server/mikro/govdeMuhasebe.ts → yevmiyeGovdesi
   */
  app.post('/api/mikro/yevmiye/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { entries } = req.body as { entries: Record<string, unknown>[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'entries dizisi zorunlu.' });
    }
    const t0 = Date.now();
    const syncedIds: string[] = [];
    const errors: { id: string; error: string }[] = [];
    try {
      let sira = 0;
      for (const e of entries) {
        sira++;
        // Gövde tek kaynakta (server/mikro/govdeMuhasebe.ts → yevmiyeGovdesi): tutar,
        // hesap kodu ya da tarih bilinmiyorsa bu fiş Mikro'ya HİÇ gitmez; hata errors[]'a
        // düşer ve toplu aktarım kalan fişlerle sürer (rotanın mevcut per-fiş sözleşmesi).
        // Eski `?? 0` ₺0 fiş, eski `|| '100'` hayalet 100-KASA kaydı yazıyordu.
        let govde: YevmiyeGovde;
        try {
          govde = yevmiyeGovdesi(e, sira);
        } catch (ge) {
          if (!mikroGovdeHatasiMi(ge)) throw ge;
          errors.push({ id: String(e.id), error: ge.message });
          continue;
        }
        const { ok, data, status } = await mikroPost('MuhasebeFisKaydetV2', govde.payload, true);
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (ok && r0 && !r0.IsError) {
          syncedIds.push(String(e.id));
          void mirrorMikroInsert('mikro_muhasebe_fisleri', govde.satirlar, FIS_COLS);
        }
        else errors.push({ id: String(e.id), error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      await C.writeAuditLog(C.reqActor(req), 'Mikro Yevmiye Aktarımı',
        `${syncedIds.length}/${entries.length} fiş aktarıldı${errors.length ? `, ${errors.length} hata: ${errors[0].error.slice(0, 80)}` : ''}`);
      res.json({ success: errors.length === 0, syncedIds, errors, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err), syncedIds, errors });
    }
  });

  /** POST /api/mikro/tahsilat/kaydet — kasa tahsilat/tediye → Mikro (TahsilatTediyeKaydetV2).
   *  Body: { tahsilat: { cariKod, tutar, tarih(YYYY-MM-DD), aciklama?, tip: 'tahsilat'|'tediye' } }
   *  Gövde tek kaynakta: server/mikro/govdeMuhasebe.ts → `tahsilatGovdesi`
   *  ("alan eşlemesi V17 örneğinden — DENEYSEL" notu oraya TAŞINDI).
   */
  app.post('/api/mikro/tahsilat/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { tahsilat } = req.body as { tahsilat: Record<string, unknown> };
    if (!tahsilat || typeof tahsilat !== 'object') {
      return res.status(400).json({ success: false, error: 'tahsilat alanı zorunlu.' });
    }
    const t0 = Date.now();
    let govde: TahsilatGovde;
    try {
      govde = tahsilatGovdesi(tahsilat);
    } catch (e) {
      if (!mikroGovdeHatasiMi(e)) {
        console.error('[tahsilat/kaydet] gövde', e);
        return res.status(500).json({ success: false, error: 'Tahsilat kaydedilemedi.' });
      }
      // İstemci (TahsilatModule) bu çağrıyı `.catch(() => {})` ile yutuyor — tek iz syncLog.
      await C.writeSyncLog('TahsilatTediyeKaydetV2', 'payment', String(tahsilat.cariKod ?? 'bilinmiyor'), false, null, e.message, Date.now() - t0, C.reqActor(req));
      return res.status(400).json({ success: false, error: e.message });
    }
    try {
      const { ok, data, status } = await mikroPost('TahsilatTediyeKaydetV2', govde.payload, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await C.writeSyncLog('TahsilatTediyeKaydetV2', 'payment', govde.cariKod, success, null, errorMsg, Date.now() - t0, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...govde.satir, __kaynak: 'tahsilat_push' }], CHA_COLS);
      res.json({ success, error: errorMsg, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/import/faturalar — kesilen + gelen faturaları SqlVeriOkuV2 ile çek.
   *  Mikro şeması: CARI_HESAP_HAREKETLERI, cha_evrak_tip=63 (fatura).
   *  cha_tip: 0 = borç (satış/kestiğimiz), 1 = alacak (alış/gelen).
   *  NOT: Mikro test ortamında 'MikroApiLoginForSelect' SQL kullanıcısı eksikse
   *  401 döner — Mikro destek tenant DB'de tanımlayınca çalışır.
   */
  app.post('/api/mikro/import/faturalar', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    { const kilit = await yaziciyiIstegeBagla(C.getPgPool?.(), `mikro-import:${Date.now().toString(36)}`, res); if (kilit) return res.status(423).json({ success: false, error: `Bakım kilidi: ${kilit.aciklama} (${kilit.baslangic}) — veri bakımı bitince tekrar deneyin.` }); }   // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts)
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    // Bayrak düşmüş olabilir (2026-09-03) — SqlVeriOkuV2'yi de gerçekten yokla.
    const sqlV17Var = await v17MetoduKullanilabilir('SqlVeriOkuV2', async () => {
      const { rows, hata } = await mikroSql('SELECT TOP 1 1 AS deneme');
      return !hata && Array.isArray(rows);
    });
    if (!sqlV17Var) {
      return res.status(501).json({
        success: false,
        error: 'SqlVeriOkuV2 yalnız Mikro Jump V17+ kurulumlarında mevcut (V16 koleksiyonunda yok). ' +
               'Fatura çekimi için Mikro Jump V17 güncellemesi gerekir; sonrasında .env\'e MIKRO_JUMP_SURUM=17 ekleyin.',
        requiresVersion: 17, currentVersion: MIKRO_JUMP_SURUM,
      });
    }
    const t0 = Date.now();
    try {
      const sql =
        "SELECT TOP 2000 cha_Guid, cha_evrakno_seri, cha_evrakno_sira, cha_tarihi, cha_tip, cha_cinsi, " +
        "cha_kod, cha_aciklama, cha_meblag, cha_aratoplam, cha_ebelge_turu, cha_belge_no, cha_kasa_hizkod, cha_kasa_hizmet " +
        "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND ISNULL(cha_iptal, 0) = 0 ORDER BY cha_tarihi DESC";
      const { ok, data, status } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sql });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        return res.status(502).json({ success: false, error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      const rows = mikroSatirlar(data);
      void mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'sql_import' })), CHA_COLS);
      // Gövde tek kaynakta (server/mikro/eslemeFatura.faturalariEsle): yönü okunamayan
      // fatura SATIŞ SAYILMAZ ve null kolonlar merge:true ile mevcut değerleri EZMEZ.
      const ozet = faturalariEsle(rows);
      const { satis, alis } = ozet;
      let batch = C.getAdminDb().batch(); let ops = 0;
      for (const k of ozet.kayitlar) {
        const guid = k.guid || C.getAdminDb().collection('mikroFaturalar').doc().id;
        batch.set(C.getAdminDb().collection('mikroFaturalar').doc(guid), {
          ...k.doc, companyId,
          source: 'mikro_import',
          syncedAt: pgServerTimestamp(),
        }, { merge: true });
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      if (ozet.okumaArizasi.length) console.warn('[import/faturalar]', okumaArizasiUyarisi(ozet.okumaArizasi));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Fatura Çekme',
        `${satis} satış + ${alis} alış faturası çekildi${ozet.not ? ` — ${ozet.not}` : ''}`);
      res.json({ success: true, total: rows.length, satis, alis, note: ozet.not, duration: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── IKINCI GRUP (2026-08-24, D4 adim 7) ────────────────────────────────
  // server.ts'te ayri bir kumede duran 13 Mikro ucu (KDV ozeti, Ba-Bs,
  // e-belge, gelen fatura...). Ayri dosya ACILMADI: tum Mikro rotalari tek
  // yerde dursun, "bu uc nerede" sorusunun tek cevabi olsun.
  // ── KDV Özet Pull ─────────────────────────────────────────────────────────────
  // POST /api/mikro/pull/kdv  — aylık KDV özeti → taxSummary
  //
  // 2026-07-31'de İKİNCİ KEZ yeniden yazıldı. Önce KdvOzetV2 çağırıyordu (V17'de
  // yok, sıfır yazıyordu), sonra muhasebe hesaplarından (191/391) türetiyordu —
  // ama bu kurulumda MUHASEBE_FISLERI BOŞ (muhasebe Mikro'da tutulmuyor).
  //
  // Doğru kaynak: STOK_HAREKETLERI. Fatura satırları orada ve `sth_vergi` her
  // satırın GERÇEK KDV tutarını taşıyor. Ürün kartındaki orandan hesaplamak
  // YANLIŞ olurdu: gelen faturalarda satır satır farklı oran olabilir
  // (kullanıcı 2026-07-31'de bunu özellikle belirtti).
  //
  // sth_tip: 0 = giriş (alış → indirilecek KDV), 1 = çıkış (satış → hesaplanan).
  // sth_vergisiz_fl = 1 olan satırlar vergiye tabi değil, dışarıda bırakılır.
  //
  // ⚠️ Bu bir TÜRETME'dir. Tevkifat, iade, devreden KDV ve ÖTV/OİV beyannamede
  // ayrıca işlenir — bu özet onları KAPSAMAZ. Beyan öncesi Mikro'nun kendi KDV
  // raporuyla karşılaştırılmalıdır; yanıt ve kayıt bunu açıkça söyler.
  app.post('/api/mikro/pull/kdv', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ success: false, error: 'period YYYY-MM olmalı.' });
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const cols = await mikroKolonlar('STOK_HAREKETLERI');
      if (!cols.length) return res.status(502).json({ success: false, error: 'STOK_HAREKETLERI okunamadı (SqlVeriOkuV2 izni?).' });
      const vergiCol   = kolonBul(cols, /^sth_vergi$/i);
      const pntrCol    = kolonBul(cols, /vergi_pntr/i);
      const tutarCol   = kolonBul(cols, /^sth_tutar$/i);
      const tipCol     = kolonBul(cols, /^sth_tip$/i);
      const tarihCol   = kolonBul(cols, /^sth_tarih$/i);
      const iptalCol   = kolonBul(cols, /_iptal$/i);
      if (!vergiCol || !tipCol || !tarihCol) {
        return res.status(502).json({ success: false,
          error: `KDV kolonları eşleşmedi (vergi=${vergiCol}, tip=${tipCol}, tarih=${tarihCol}). taxSummary'ye dokunulmadı.` });
      }
      for (const c of [vergiCol, pntrCol, tutarCol, tipCol, tarihCol, iptalCol].filter(Boolean)) {
        if (!sqlTanimlayici(c)) return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }

      const kosul = [`${tarihCol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`];
      if (iptalCol) kosul.push(`ISNULL(${iptalCol}, 0) = 0`)   /* ISNULL: sabit kardesler (1530/1574/1593) ile ayni kural; hakem 2026-09-24 */;
      const secim = [`${tipCol} AS tip`, `SUM(${vergiCol}) AS kdv`];
      if (tutarCol) secim.push(`SUM(${tutarCol}) AS matrah`);
      const grup = [tipCol];
      if (pntrCol) { secim.unshift(`${pntrCol} AS oranPntr`); grup.push(pntrCol); }

      const { rows, hata } = await mikroSql(
        `SELECT ${secim.join(', ')} FROM STOK_HAREKETLERI WHERE ${kosul.join(' AND ')} ` +
        `GROUP BY ${grup.join(', ')} ORDER BY ${tipCol}`,
      );
      if (hata) return res.status(502).json({ success: false, error: `KDV sorgusu başarısız: ${hata}. taxSummary'ye dokunulmadı.` });

      if (!rows.length) {
        return res.status(502).json({ success: false,
          error: `${period} döneminde STOK_HAREKETLERI'nde kayıt yok — taxSummary DEĞİŞTİRİLMEDİ.` });
      }

      // Gövde/eşleme TEK KAYNAKTA: src/server/mikro/raporKdvMizan.ts (kdvKirilimi).
      // Satır oranını gerçek yüzdeye çevir (pntr indekstir, yüzde değil).
      // Bilinmeyen KDV/yön ₺0 sayılmaz: satır kırılıma girmez, `note` sayacına düşer.
      const vergiTablosu = await mikroVergiOranlari();
      const kdvSonuc = kdvKirilimi(rows, { vergiTablosu, oranKolonuVar: Boolean(pntrCol) });
      const { kirilim, kdvHesaplanan, kdvIndirilecek } = kdvSonuc;
      const kdvNot = kdvSonuc.ozet.not;
      if (kdvSonuc.ozet.okumaArizasi.length) {
        console.warn('[pull/kdv] okuma arızası:', kdvSonuc.ozet.okumaArizasi.join(', '), '— kolon adı/şema kontrol edin');
      }

      // Satır VAR ama hiçbirinin KDV'si/yönü okunamadıysa bu "₺0 KDV'li dönem" DEĞİL,
      // okuma arızasıdır — taxSummary'yi sıfırlarla ezme (rotanın mevcut iki 'dur'
      // kapısıyla aynı çizgide üçüncü kapı).
      if (!kirilim.length) {
        return res.status(502).json({ success: false,
          error: `${period} döneminde okunabilen KDV satırı yok (${kdvSonuc.atlananSatir} satırın KDV'si/yönü alınamadı) — taxSummary DEĞİŞTİRİLMEDİ.`,
          note: kdvNot || null });
      }

      await C.getAdminDb().collection('taxSummary').doc(period).set({
        companyId: await C.reqCompanyId(req),
        period, yil, ay,
        kdvHesaplanan, kdvIndirilecek,
        kdvOdenmesi: kdvSonuc.kdvOdenmesi,
        devredenKdv: kdvSonuc.devredenKdv,
        oranKirilimi: kirilim,
        kaynak: `SQL:STOK_HAREKETLERI (${vergiCol}${pntrCol ? '/' + pntrCol : ''}) — TÜRETİLMİŞTİR; tevkifat/iade/devreden KAPSAM DIŞI, beyan öncesi Mikro KDV raporuyla karşılaştırın`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      const kdvOzet = `${period} — hesaplanan ${kdvHesaplanan.toFixed(2)}, indirilecek ${kdvIndirilecek.toFixed(2)} (${kirilim.length} oran kırılımı)` +
                      (kdvNot ? ` · ${kdvNot}` : '');
      await C.writeSyncLog('SQL:STOK_HAREKETLERI(KDV)', 'taxSummary', kdvOzet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro KDV Özeti Çekme', kdvOzet);
      // `|| 0` KALDIRILDI: matrahı okunamayan oran kovası ₺0 sayılıp satış matrahını
      // OLDUĞUNDAN AZ gösteriyordu. Hiç bilinen yoksa NaN → yanıtta null → istemci '—'.
      // NOT: matrah TANIMI (SUM(sth_tutar)) burada DEĞİŞMEDİ — iskonto sorusu açık (2026-09-18).
      const kdvMatrahiSatis = kdvSonuc.matrahSatis;
      res.json({ success: true, period, kdvHesaplanan, kdvIndirilecek,
                 kdvOdenmesi: kdvSonuc.kdvOdenmesi,
                 oranKirilimi: kirilim,
                 kdvMatrahi: Number.isFinite(kdvMatrahiSatis) ? kdvMatrahiSatis : null,
                 note: kdvNot || null,
                 hesaplananKdv: kdvHesaplanan,
                 uyari: 'Türetilmiş özet — tevkifat/iade/devreden kapsam dışı. Beyan öncesi Mikro KDV raporuyla karşılaştırın.',
                 duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/kdv]', err);
      res.status(500).json({ success: false, error: 'KDV özeti çekimi başarısız. taxSummary değişmedi.' });
    }
  });

  // ── Personel ───────────────────────────────────────────────────────────
  app.post('/api/mikro/pull/personel', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    try {
      // Kolon adları TAHMİN EDİLMEZ — şemadan çözülür. Bu SELECT eskiden
      // per_kodu/per_adi/... adlarını sabit yazıyordu; Mikro'da bunlardan biri
      // farklıysa "Invalid column name" ile TÜM sorgu ölürdü (cha_vergi ve
      // cha_ettn ile iki kez yaşanan arıza sınıfı). Bulunamayan alan sessizce
      // atlanır, hangileri çözüldüğü yanıtta bildirilir.
      const perCols = await mikroKolonlar('PERSONEL_TANIMLARI');
      if (!perCols.length) {
        return res.status(502).json({ success: false, error: 'PERSONEL_TANIMLARI okunamadı veya SqlVeriOkuV2 izni yok.' });
      }
      const perAlan: Array<[string, RegExp]> = [
        ['mikroPersKod', /^per_(kodu|kod)$/i],
        ['name',         /^per_(adi|ad)$/i],
        ['surname',      /^per_soyadi$/i],
        ['email',        /^per_(eposta|email|mail)$/i],
        ['phone',        /^per_(ceptel|tel|telefon)$/i],
        ['department',   /^per_departman/i],
        ['position',     /^per_(gorevi|gorev|unvan)$/i],
        ['salary',       /^per_(maas|ucret)$/i],
        ['startDate',    /^per_isegiris/i],
        ['status',       /^per_(durumu|durum|aktif)$/i],
        ['tcId',         /^per_tc/i],
      ];
      const perSecim: string[] = [];
      const cozulen: string[] = [];
      const eksik: string[] = [];
      for (const [alias, re] of perAlan) {
        const k = kolonBul(perCols, re);
        if (k) { perSecim.push(`${k} AS ${alias}`); cozulen.push(alias); }
        else eksik.push(alias);
      }
      if (!cozulen.includes('mikroPersKod')) {
        return res.status(502).json({
          success: false,
          error: `PERSONEL_TANIMLARI'nda personel kodu kolonu bulunamadi. Mevcut kolonlar: ${perCols.slice(0, 25).join(', ')}`,
        });
      }
      const perSql = `SELECT ${perSecim.join(', ')} FROM PERSONEL_TANIMLARI`;
      // mikroSql `{ rows, hata }` döner — DİZİ DEĞİL. Eskiden dönen nesne olduğu
      // gibi `data`ya konuyordu (istemci dizi bekler) ve `hata` HİÇ kontrol
      // edilmiyordu: SQL patlasa bile `success: true` dönüyordu. Bugün kapatılan
      // sessiz-sıfır arıza sınıfının aynısı (kardeş uç pull/uretim-receteleri
      // bunu doğru yapıyordu — iki uç ayrışmıştı).
      const { rows, hata } = await mikroSql(perSql);
      if (hata) return res.status(502).json({ success: false, error: hata });

      // Veriyi KOLEKSİYONA YAZ. Eskiden yalnız istemciye döndürülüyordu ve hiçbir
      // istemci bu ucu çağırmıyordu — yani uç ölü koddu, İK ekranı (`employees`)
      // hep boş kalıyordu. doc id `mikro-<per_kodu>`: tekrar çekimde çoğaltmaz.
      if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      const companyId = await C.reqCompanyId(req);
      // NEDEN mevcut id'ler okunuyor: HRModule.tsx arama filtresi
      // `e.position.toLowerCase()` / `e.department.toLowerCase()` çağırıyor (fallback
      // yok) — YENİ bir personel Mikro'da bu alanları boş bırakmışsa alan hiç
      // yazılmasaydı doküman `undefined` ile oluşur ve arama kutusuna yazılınca
      // TypeError ile çökerdi (BOM'daki `components` çökmesiyle aynı sınıf). Yalnız
      // YENİ kayıtta '' varsayılanı yazılır; var olan kayda dokunulmaz (mevcut değer
      // ezilmesin). Kararı `yeniKayit` bayrağıyla `personelEsle` veriyor — bu snapshot
      // o bayrağın tek girdisi.
      const mevcutEmpSnap = await C.tenantSnap('employees', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const empId = C.mikroIdCozucuIds(mevcutEmpSnap.docs.map(d => d.id), companyId);
      const mevcutEmpIds = new Set(mevcutEmpSnap.docs.map(d => d.id));
      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      // Gövde TEK KAYNAKTA: src/server/mikro/eslemeVarlik.ts (personelEsle) — maaş/TC/durum
      // bilinmiyorsa alan YAZILMAZ (0 ve null yok), satır bazlı boşaltma guard'ı orada.
      // AD ÇAKIŞMASI: bu kapsamda `ozet` adlı bir yerel değişken ZATEN var (yanıt metni),
      // sayaç bu yüzden `ozetPer`.
      const ozetPer = ozetBaslat();
      for (const r of rows) {
        const kod = mikroKod(r, 'mikroPersKod');
        if (!kod) continue;
        const docId = empId(kod.replace(/[/\\]/g, '_'));
        const { alanlar } = ozetEkle(ozetPer, personelEsle(r, !mevcutEmpIds.has(docId)));
        batch.set(C.getAdminDb().collection('employees').doc(docId), {
          companyId,
          ...alanlar,
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      const perAriza = varlikArizalari(ozetPer, PERSONEL_KRITIK);
      if (perAriza.length) console.warn(`[pull/personel] ${varlikArizaUyarisi(perAriza)}`);
      const perSayac = bilinmeyenNotu(ozetPer, perAriza);
      const ozet = (perAriza.length ? `${varlikArizaUyarisi(perAriza)} ` : '')
        + `${yazilan} personel employees koleksiyonuna yazıldı`
        + (eksik.length ? ` — şemada bulunamayan alanlar atlandı: ${eksik.join(', ')}` : '')
        + (perSayac ? ` · ${perSayac}` : '');
      await C.writeSyncLog('SQL:PERSONEL_TANIMLARI', 'employees', ozet, true, null, null, 0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Personel', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan,
                 cozulenAlanlar: cozulen, eksikAlanlar: eksik, okumaArizasi: perAriza });
    } catch (err) {
      console.error('[pull/personel]', err);
      res.status(500).json({ success: false, error: 'Personel çekimi başarısız.' });
    }
  });

  // ── Uretim Receteleri (BOM) ────────────────────────────────────────────────
  app.post('/api/mikro/pull/uretim-receteleri', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    
    try {
      const cols = await mikroKolonlar('STOK_URETIM_RECETELERI');
      if (!cols.length) {
        return res.status(502).json({ success: false, error: 'STOK_URETIM_RECETELERI tablosu okunamadı veya SqlVeriOkuV2 izni yok.' });
      }

      // We select all BOM definitions.
      const sql = 'SELECT * FROM STOK_URETIM_RECETELERI ORDER BY rec_create_date DESC OFFSET 0 ROWS FETCH NEXT 5000 ROWS ONLY';
      const { rows, hata } = await mikroSql(sql);
      if (hata) return res.status(502).json({ success: false, error: hata });

      // Veriyi KOLEKSİYONA YAZ. Eskiden yalnız istemciye döndürülüyordu ve hiçbir
      // istemci bu ucu çağırmıyordu → uç ölü koddu, Üretim/BOM ekranı (`bom`)
      // hep boş kalıyordu.
      //
      // rec_* kolon adları TAHMİN EDİLMEZ, şemadan (cols) çözülür. Çözülemeyen
      // alan yazılmaz; ham satır `mikroHam` altında saklanır ki veri kaybolmasın
      // ve eşleme sonradan kolon adı öğrenilince düzeltilebilsin.
      if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
      // Desenler AYRIŞIK olmalı: eski hâlde /^rec_(ana_)?stok_kod$/ ve
      // /^rec_(alt_)?stok_kod$/ İKİSİ de 'rec_stok_kod'u eşliyordu. Tabloda o kolon
      // varsa ana ve alt AYNI kolona bağlanır ve her reçete "X, X içerir" olur —
      // sessizce çöp veri. Artık ayrı desenler + eşitlik guard'ı.
      let anaKod  = kolonSec(cols, [/^rec_ana_stok_kod$/i, /^rec_ust_stok_kod$/i, /ana_stok_kod$/i]);
      let altKod  = kolonSec(cols, [/^rec_alt_stok_kod$/i, /^rec_bilesen_stok_kod$/i, /(alt|bilesen)_stok_kod$/i]);
      const miktarK = kolonSec(cols, [/^rec_miktar$/i, /_miktari?$/i, /miktar$/i]);
      const birimK  = kolonSec(cols, [/^rec_birim$/i, /_birimi?$/i, /birim$/i]);
      // Aynı kolona düştülerse eşleme GÜVENİLMEZ — ikisini de çöz(e)medik say.
      // Yanlış reçete göstermektense hiç gösterme (ham veri mikroHam'da durur).
      if (anaKod && anaKod === altKod) { anaKod = null; altKod = null; }
      const guidK   = kolonBul(cols, /_Guid$/i);

      // ŞEKİL DÜZELTME (2026-08-11, ilk sürüm hiç canlıda çalıştırılmadan yakalandı):
      // `bom` koleksiyonunun tek tüketicisi BOMPanel.tsx TEK doküman/ürün + içinde
      // `components: BOMComponent[]` dizisi bekliyor (satır 39-47). İlk sürüm her
      // (ana, bileşen) satırını AYRI düz doküman yazıyordu — `components` hiç
      // yoktu. BOMPanel `bom.components.length` okuyunca (satır 304) undefined
      // üzerinde patlardı: ekranı doldurmak için yazılan uç, ekranı çökertiyordu.
      //
      // Doğru şekil: Mikro satırları ÖNCE ana ürüne göre grupla, sonra ürün başına
      // TEK doküman yaz. docId artık guid değil `mikro-<productSku>` — guid
      // satır bazlıydı (rastgele üretimi tetikliyordu, her senkron reçeteyi
      // çoğaltırdı); productSku ürün bazlı ve KARARLI, tekrar senkron ÜZERİNE yazar.
      const gruplar = new Map<string, ReceteKalemi[]>();
      // Gövde TEK KAYNAKTA: src/server/mikro/eslemeVarlik.ts (receteKalemiEsle) — miktar
      // bilinmiyorsa `quantity` ANAHTARI hiç yazılmaz ("0 çuval çimento" reçetesi üretilmez).
      const ozetRec = ozetBaslat();
      for (const r of rows) {
        const { ana, kalem } = ozetEkle(ozetRec,
          receteKalemiEsle(r, { ana: anaKod, alt: altKod, miktar: miktarK, birim: birimK }));
        if (!kalem) continue;   // eşleme çözülemediyse reçete satırı anlamsız
        const liste = gruplar.get(ana) ?? [];
        liste.push(kalem);
        gruplar.set(ana, liste);
      }

      // Bileşen adı/inventoryId için envanterden eşle (BOMComponent.name/inventoryId
      // BOMPanel'in UI'da göstermesi için ZORUNLU değil ama boşsa "—" görünür).
      // Kiracı sınırı: fiyat import'unda yakalanan sızıntının aynısı — companyId'si
      // DOLU ve BAŞKA kiracıya ait kayıt eşlemede kullanılmaz.
      const companyId = await C.reqCompanyId(req);
      const bomId = await C.mikroIdCozucu('bom', companyId);
      const invSnap = await C.tenantSnap('inventory', companyId);
      const invBySku = new Map<string, { id: string; name: string }>();
      for (const d of invSnap.docs) {
        const veri = d.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = ((veri.sku as string) || '').trim();
        if (sku && !invBySku.has(sku)) invBySku.set(sku, { id: d.id, name: (veri.name as string) || sku });
      }

      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      for (const [productSku, bilesenler] of gruplar) {
        const urun = invBySku.get(productSku);
        batch.set(C.getAdminDb().collection('bom').doc(bomId(productSku.replace(/[/\\]/g, '_'))), {
          companyId,
          productName: urun?.name || productSku,
          productSku,
          unit: '',
          description: '',
          // `receteBilesen` miktarı bilinmiyorsa `quantity` anahtarını HİÇ yazmaz
          // (undefined/null JSON'a sızmaz) — `merge:true` dizi İÇİNİ korumadığı için
          // tek koruma budur.
          components: bilesenler.map(b => receteBilesen(b, invBySku.get(b.sku))),
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      void guidK; // artık satır bazlı guid kullanılmıyor — ürün bazlı sku id yeterli

      const cozulemeyen = [
        !anaKod  ? 'productSku'   : null,
        !altKod  ? 'componentSku' : null,
        !miktarK ? 'quantity'     : null,
        !birimK  ? 'unit'         : null,
      ].filter(Boolean);
      const recAriza = varlikArizalari(ozetRec, RECETE_KRITIK);
      if (recAriza.length) console.warn(`[pull/uretim-receteleri] ${varlikArizaUyarisi(recAriza)}`);
      const recSayac = bilinmeyenNotu(ozetRec, recAriza);
      const ozet = (recAriza.length ? `${varlikArizaUyarisi(recAriza)} ` : '')
        + `${yazilan} ürün reçetesi (${rows.length} satırdan) bom koleksiyonuna yazıldı`
        + (cozulemeyen.length ? ` — kolonu çözülemeyen alanlar: ${cozulemeyen.join(', ')} (ham veri satır düzeyinde kaybolmuş olabilir)` : '')
        + (recSayac ? ` · ${recSayac}` : '');
      await C.writeSyncLog('SQL:STOK_URETIM_RECETELERI', 'bom', ozet, true, null, null, 0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Üretim Reçeteleri', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan,
                 cozulemeyenAlanlar: cozulemeyen, okumaArizasi: recAriza });
    } catch (err) {
      console.error('[pull/uretim-receteleri]', err);
      res.status(500).json({ success: false, error: 'Reçete çekimi başarısız.' });
    }
  });

  // ── e-Belge Merkezi: listeleme / durum / mükellef / PDF ─────────────────────
  //
  // 2026-07-30'da eklendi. Buraya kadar EBelgeMerkezi ekranı TAMAMEN ELLE
  // giriliyordu (belge no/alıcı/tutar kullanıcı yazıyordu, "gönder" yalnız
  // yerel bir alanı 'Gönderildi' yapıyordu) — Mikro/GİB ile hiç konuşmuyordu.
  //
  // V17'de yön başına farklı yol var:
  //   GELEN e-fatura  → GelenFaturalarV2 (GİB listesi, resmi metot)
  //   GİDEN e-fatura/e-arşiv → liste metodu YOK, SqlVeriOkuV2 ile
  //                            EBELGE_EVRAK_HAREKETLERI tablosundan
  //   e-irsaliye (iki yön) → EIrsaliyeListesiV2
  // Hepsi `eBelgeler` koleksiyonuna yazılır; `yon` ve `tur` alanlarıyla ayrışır.

  /** POST /api/mikro/import/faturadan-siparis — SATIŞ faturalarından Cetpa
   *  siparişi türetir (2026-09-01 kullanıcı isteği: "faturasını kestiğim her
   *  şeyin siparişi olmalı; fatura tarihiyle işlensin").
   *
   *  KAYNAK: `mikroFaturalar` koleksiyonu (fatura-listesi importunun yazdığı
   *  ham cha_* başlıkları; cha_tip 0 = GİDEN/satış — useMikroFaturalar ile
   *  aynı konvansiyon). Kalemler: mikro_stok_hareketleri aynası,
   *  sth_evraktip = 4 + seri/sıra anahtarı (2026-08-01'de canlıda doğrulanan
   *  birleştirme — bkz. fatura-listesi başlığı).
   *
   *  ÇİFT SAYIM TASARIMI: türetilen sipariş `source:'mikro-fatura'` damgası
   *  taşır; "native + Mikro" toplayan ciro kartları (Dashboard, Finans Paneli,
   *  Finansal Oranlar) native tarafında bu damgayı DIŞLAR — aynı fatura iki
   *  kez sayılmaz. Salt-native raporlar ise satışları artık görür; kapanan
   *  boşluk tam olarak 2026-08-01 "Mikro↔Cetpa kopukluğu" bulgusuydu.
   *
   *  İDEMPOTENT: doc id `mikrofat__<cid>__<seri>-<sira>` (kiracı önekli —
   *  eBelgeYaz dersi: evrak no küresel benzersiz DEĞİL); mevcut id atlanır,
   *  tekrar çalıştırmak kopya üretmez. Mevcut NATIVE siparişlere dokunulmaz
   *  (Mikro'ya bağlarken EKLE, YERİNE KOYMA). */
  app.post('/api/mikro/import/faturadan-siparis', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    { const kilit = await yaziciyiIstegeBagla(C.getPgPool?.(), `mikro-import:${Date.now().toString(36)}`, res); if (kilit) return res.status(423).json({ success: false, error: `Bakım kilidi: ${kilit.aciklama} (${kilit.baslangic}) — veri bakımı bitince tekrar deneyin.` }); }   // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts)
    const t0 = Date.now();
    try {
      const cid = await C.reqCompanyId(req);
      const pool = C.getPgPool();
      const ham = await C.loadCompanyDocs('mikroFaturalar', cid);
      // Yönü okunamayan fatura SATIŞ SAYILMAZ: eski `?? 0` bir ALIŞ faturasından
      // sipariş türetip ciroyu şişiriyordu (server/mikro/eslemeFatura.faturaYonu).
      const yonlu = ham.map(f => ({ f, yon: faturaYonu(f as Record<string, unknown>) }));
      const satisFaturalari = yonlu.filter(y => y.yon === 'satis').map(y => y.f);
      const yonsuz = yonlu.filter(y => y.yon === null).length;
      if (!satisFaturalari.length) {
        // ERKEN DÖNÜŞ SAYACI YUTMAZ (2026-09-19 hakem bulgusu): yönü okunamayan N fatura
        // tek iz bırakmadan "Satış faturası bulunamadı — önce Faturaları Çek çalıştırın"
        // mesajına dönüşüyordu; kullanıcı ZATEN yaptığı adıma geri yollanıyor, gerçek
        // neden (cha_tip okunamıyor) hiçbir yerde görünmüyordu. Üstelik MikroSyncPanel
        // .handleExtraPull yalnız `note`u basar — `message` ekranda HİÇ görünmez.
        const erkenNot: string[] = [];
        // Faturaların TAMAMI yönsüz ve yeterince satır varsa bu veri değil okuma arızasıdır.
        if (yonsuz === ham.length && ham.length >= OKUMA_ARIZASI_ESIK) {
          const uyari = okumaArizasiUyarisi(['cha_tip']);
          if (uyari) { console.warn('[faturadan-siparis]', uyari); erkenNot.push(uyari); }
        }
        const sayac = siparisTuretmeNotu({ turetilen: 0, tutarsiz: 0, yonsuz,
          miktarsizKalem: 0, tutarsizKalem: 0, pgYok: !pool });
        if (sayac) erkenNot.push(sayac);
        return res.json({ success: true, created: 0, skipped: 0, total: 0,
          note: erkenNot.join(' · ') || null,
          message: yonsuz > 0
            ? `${yonsuz} faturanın yönü okunamadı — satış faturası ayırt edilemedi.`
            : 'Satış faturası bulunamadı — önce "Faturaları Çek" çalıştırın.' });
      }

      const mevcutSiparisler = await C.loadCompanyDocs('orders', cid);
      const mevcutIdler = new Set(mevcutSiparisler.map(o => String(o.id ?? '')));
      // BACKFILL (2026-09-03 code review): `faturali`/`mikroFaturaNo` alanları bu uca
      // sonradan eklendi; idempotent atlama yüzünden ÖNCEKİ koşuların yazdığı kayıtlara
      // hiç ulaşmıyordu. Sonuç: aynı listede kimi sipariş "MİKRO FATURA", kimi
      // "FATURASIZ" görünüyor ve zaten Mikro'da kesilmiş faturada "Mikro'ya e-Fatura
      // gönder" düğmesi duruyordu. Eksik alanı olan eski kayıtları onar.
      const backfillGerekli = mevcutSiparisler.filter(o => {
        const x = o as Record<string, unknown>;
        return x.source === 'mikro-fatura' && (x.faturali !== true || !x.mikroFaturaNo);
      });

      // Cari adları + kalemler: ikişer toplu sorgu (fatura başına sorgu YOK).
      const cariAd = new Map<string, string>();
      // Kalem tipi tek kaynakta: quantity/total BİLİNMİYORSA null (0 DEĞİL).
      let kalemMap = new Map<string, SiparisSatiri[]>();
      let miktarsizKalem = 0, tutarsizKalem = 0;
      if (pool) {
        const cr = await pool.query(`SELECT cari_kod, COALESCE(cari_unvan1, '') AS unvan FROM mikro_cari_hesaplar`);
        for (const row of cr.rows) cariAd.set(String(row.cari_kod), String(row.unvan));
        const kr = await pool.query(
          `SELECT COALESCE(h.sth_evrakno_seri, '') AS seri, CAST(h.sth_evrakno_sira AS text) AS sira,
                  COALESCE(h.sth_stok_kod, '') AS sku, COALESCE(s.sto_isim, '') AS ad,
                  h.sth_miktar AS miktar, h.sth_tutar AS tutar, h.sth_vergi AS vergi
             FROM mikro_stok_hareketleri h
             LEFT JOIN mikro_stoklar s ON s.sto_kod = h.sth_stok_kod
            WHERE h.sth_evraktip = 4`);
        // SAYISAL COALESCE(...,0) KALDIRILDI: KDV'si okunamayan satırın toplamı SESSİZCE
        // EKSİK iniyordu (tutar + 0). Artık NULL iner ve kalem `total: null` olur + sayılır.
        // Metin kolonlarındaki COALESCE(...,'') KALIR (anahtar/ad, sayı değil).
        // Gövde tek kaynakta (server/mikro/eslemeFatura.kalemHaritasi).
        const kh = kalemHaritasi(kr.rows);
        kalemMap = kh.harita;
        miktarsizKalem = kh.miktarsiz;
        tutarsizKalem = kh.tutarsiz;
      }

      let batch = C.getAdminDb().batch();
      let ops = 0, created = 0, skipped = 0, onarilan = 0, tutarsizSiparis = 0;
      for (const o of backfillGerekli) {
        const x = o as Record<string, unknown>;
        const ev = (x.mikroEvrak ?? {}) as { seri?: unknown; sira?: unknown };
        // Evrak no yalnız mikroEvrak'tan türetilir; yoksa alan yazılmaz (uydurma yok).
        const evrakNo = ev.sira != null ? `${String(ev.seri ?? '')}${String(ev.sira)}` : null;
        batch.update(C.getAdminDb().collection('orders').doc(String(x.id)), {
          faturali: true,
          ...(evrakNo ? { mikroFaturaNo: evrakNo } : {}),
        });
        onarilan++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      for (const f of satisFaturalari) {
        const x = f as Record<string, unknown>;
        const anahtar = `${String(x.cha_evrakno_seri ?? '').trim()}|${String(x.cha_evrakno_sira ?? '').trim()}`;
        // Gövde tek kaynakta (server/mikro/eslemeFatura.faturadanSiparis): doküman id
        // biçimi ve tüm alanlar BİREBİR aynı; tek fark tutar bilinmiyorsa totalPrice
        // alanının HİÇ YAZILMAMASI. Okuyan tarafın durumu (hangi yüzey `siparisTutari`
        // kullanıyor, hangisi hâlâ ham topluyor) eslemeFatura.ts'teki uyarıda.
        const t = faturadanSiparis(x, kalemMap.get(anahtar) ?? [],
          { companyId: cid, cariUnvan: cariAd.get(String(x.cha_kod ?? '').trim()) });
        if (!t) { skipped++; continue; }                  // evrak sıra no yok
        if (mevcutIdler.has(t.id)) { skipped++; continue; }
        if (t.tutarBilinmiyor) tutarsizSiparis++;
        batch.set(C.getAdminDb().collection('orders').doc(t.id), {
          ...t.doc,
          // Fatura tarihi sipariş tarihi olarak işlenir (kullanıcının isteği).
          createdAt: t.olusturmaTarihi ?? pgServerTimestamp(),
        });
        created++;
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      const not = siparisTuretmeNotu({ turetilen: created, tutarsiz: tutarsizSiparis, yonsuz,
        miktarsizKalem, tutarsizKalem, pgYok: !pool });
      if (not?.startsWith('UYARI:')) console.warn('[faturadan-siparis]', not);
      await C.writeAuditLog(C.reqActor(req), 'Faturadan Sipariş',
        `${created} sipariş türetildi, ${skipped} atlandı, ${onarilan} eski kayıt onarıldı (${satisFaturalari.length} satış faturası)${not ? ` — ${not}` : ''}`);
      await C.writeSyncLog('faturadan-siparis', 'orders', String(created), true, null, null, Date.now() - t0, C.reqActor(req));
      res.json({ success: true, created, skipped, onarilan, total: satisFaturalari.length,
        // `kalemsiz` alanı KALDIRILDI: MikroSyncPanel jenerik kartı yalnız `note`u basıyor
        // (handleExtraPull, MikroSyncPanel.tsx 328-333) — bu uyarı ekranda HİÇ GÖRÜNMÜYORDU.
        // Artık aynı cümle `note` içinde, diğer sayaçlarla birlikte.
        note: not,
        duration: Date.now() - t0 });
    } catch (err) {
      console.error('[faturadan-siparis]', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // e-belge satırı → `eBelgeler` şeması: tek kaynak server/mikro/eBelge.ts (eBelgeNormalize/eBelgeleriNormalize).
  // Eski yerel işlev tutarı GEVŞEK regex'le (`/tutar|meblag|toplam/` — kdv_tutar / tutar_Guid de eşleşir) arayıp
  // okunamayan tutara ₺0 yazıyordu; artık ödenecek tutar en-spesifikten-genele seçilir, okunamazsa `tutar`
  // HİÇ yazılmaz ve yanıtın `note`una sayaç / okuma arızası uyarısı düşer.

  /** Normalize edilmiş belgeleri eBelgeler'e yaz. UUID varsa doc id olur
   *  (idempotent — aynı belge tekrar çekilince kopyalanmaz). */
  async function eBelgeYaz(
    kayitlar: Record<string, unknown>[], companyId: string,
  ): Promise<number> {
    if (!C.getAdminDb() || !kayitlar.length) return 0;
    let batch = C.getAdminDb().batch(); let ops = 0, n = 0;
    for (const k of kayitlar) {
      const uuid = String(k.uuid || '').trim();
      const belgeNo = String(k.belgeNo || '').trim();
      // UUID (GİB ETTN) küresel benzersizdir, doğrudan id olabilir. belgeNo
      // DEĞİLDİR ("EF-2026-0001" her firmada olabilir) — docs tablosunun PK'sı
      // (coll,id) olduğu için kiracı öneki olmadan iki firma birbirinin
      // belgesini ezer. Bu, recurringBilling'de bir kez yaşandı.
      const id = uuid || (belgeNo ? `${companyId}__${k.yon}-${belgeNo}` : C.getAdminDb().collection('eBelgeler').doc().id);
      batch.set(C.getAdminDb().collection('eBelgeler').doc(id.replace(/[/\\]/g, '_')), {
        ...k, companyId, syncedAt: pgServerTimestamp(),
      }, { merge: true });
      n++;
      if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
    }
    if (ops > 0) await batch.commit();
    return n;
  }

  /** POST /api/mikro/ebelge/gelen — GİB'den gelen e-faturaları listele → eBelgeler
   *  Body: { ilkTarih?: 'YYYY-MM-DD', sonTarih?: 'YYYY-MM-DD', vkn?: string } */
  app.post('/api/mikro/ebelge/gelen', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    const vkn = String(req.body?.vkn ?? '').replace(/\D/g, '').slice(0, 11);
    try {
      const SAYFA = 100;
      const tumu: Record<string, unknown>[] = [];
      for (let index = 0; index < 50; index++) {
        const { ok, data } = await mikroPost('GelenFaturalarV2', {
          IlkTarih: ilk, SonTarih: son, GIBFaturaNo: '', VKNo: vkn,
          Size: SAYFA, Index: index,
        });
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!ok || !r0 || r0.IsError) {
          // Hiçbir şey yazma — yarım liste "tam liste" gibi görünmesin.
          return res.status(502).json({ success: false, error: `Gelen e-fatura listesi alınamadı: ${mikroHata(data)}` });
        }
        const rows = mikroSatirlar(data);
        if (!rows.length) break;
        tumu.push(...rows);
        if (rows.length < SAYFA) break;
      }
      const gelen = eBelgeleriNormalize(tumu, 'e-fatura', 'gelen');
      if (gelen.okumaArizasi) console.warn('[ebelge/gelen] okuma arızası:', gelen.not);
      const yazilan = await eBelgeYaz(gelen.kayitlar, await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'Gelen e-Fatura Listesi', `${yazilan} belge (${ilk} → ${son})${gelen.not ? ' — ' + gelen.not : ''}`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son, ...(gelen.not ? { note: gelen.not } : {}), duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/gelen]', err);
      res.status(500).json({ success: false, error: 'Gelen e-fatura listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/giden — GİDEN e-fatura + e-arşiv → eBelgeler
   *  V17'de giden belge listesi metodu YOK; EBELGE_EVRAK_HAREKETLERI tablosundan
   *  SQL ile çekilir. Kolonlar çalışma anında keşfedilir, tahmin edilmez.
   *  Body: { ilkTarih?, sonTarih? } */
  app.post('/api/mikro/ebelge/giden', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    try {
      const cols = await mikroKolonlar('EBELGE_EVRAK_HAREKETLERI');
      if (!cols.length) {
        return res.status(502).json({ success: false,
          error: 'EBELGE_EVRAK_HAREKETLERI tablosu okunamadı (SqlVeriOkuV2 izni veya farklı şema).' });
      }
      const tarihCol = kolonBul(cols, /tarih/i);
      const siraCol  = kolonBul(cols, /_Guid$/i) ?? cols[0];
      if (!sqlTanimlayici(siraCol) || (tarihCol && !sqlTanimlayici(tarihCol))) {
        return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }
      const where = tarihCol ? ` WHERE ${tarihCol} BETWEEN '${ilk}' AND '${son}'` : '';
      const { rows, hata } = await mikroSql(
        `SELECT * FROM EBELGE_EVRAK_HAREKETLERI${where} ORDER BY ${siraCol} OFFSET 0 ROWS FETCH NEXT 5000 ROWS ONLY`,
      );
      if (hata) return res.status(502).json({ success: false, error: `Giden e-belge sorgusu başarısız: ${hata}` });

      // e-fatura mı e-arşiv mi: belge türü kolonundan ayır; kolon yoksa
      // hepsini 'e-fatura' saymak YANLIŞ olurdu -> tür bilinmiyorsa işaretle.
      const turCol = kolonBul(cols, /ebelge_?tur|belge_?tip|earsiv/i);
      let gidenTutarsiz = 0;
      const kayitlar = rows.map(r => {
        const ham = turCol ? String(r[turCol] ?? '') : '';
        const tur: 'e-fatura' | 'e-arsiv' = /arsiv|arşiv|1/i.test(ham) ? 'e-arsiv' : 'e-fatura';
        const n = eBelgeNormalize(r, tur, 'giden');
        if (n.bilinmeyen.includes('tutar')) gidenTutarsiz++;
        return { ...n.kayit, turBelirsiz: !turCol };
      });
      // Okuma arızası eşiği eBelge.eBelgeleriNormalize ile aynı: ≥ 5 belgenin TAMAMINDA tutar okunamadıysa kolon adı değişmiştir.
      const gidenArizasi = rows.length >= 5 && gidenTutarsiz === rows.length;
      const gidenNot = gidenArizasi ? 'UYARI: tutar hiçbir belgede okunamadı — Mikro kolon adı/şema kontrol edin'
        : gidenTutarsiz > 0 ? `${gidenTutarsiz} belgenin tutarı okunamadı` : null;
      if (gidenArizasi) console.warn('[ebelge/giden] okuma arızası:', gidenNot);
      const yazilan = await eBelgeYaz(kayitlar, await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'Giden e-Belge Listesi', `${yazilan} belge (${ilk} → ${son})${gidenNot ? ' — ' + gidenNot : ''}`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son,
                 ...(turCol ? {} : { uyari: 'Belge türü kolonu bulunamadı — hepsi e-fatura olarak işaretlendi.' }),
                 ...(gidenNot ? { note: gidenNot } : {}),
                 duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/giden]', err);
      res.status(500).json({ success: false, error: 'Giden e-belge listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/eirsaliye — e-irsaliye listesi → eBelgeler
   *  Body: { ilkTarih?, sonTarih?, yon?: 'gelen'|'giden' }  (EIrsaliyeTipi 0=giden, 1=gelen) */
  app.post('/api/mikro/ebelge/eirsaliye', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    const ilk = sqlTarih(req.body?.ilkTarih, `${new Date().getFullYear()}-01-01`);
    const son = sqlTarih(req.body?.sonTarih, mikroBugun());
    const yon: 'gelen' | 'giden' = req.body?.yon === 'gelen' ? 'gelen' : 'giden';
    try {
      const SAYFA = 100;
      const tumu: Record<string, unknown>[] = [];
      for (let index = 0; index < 50; index++) {
        const { ok, data } = await mikroPost('EIrsaliyeListesiV2', {
          IlkTarih: ilk, SonTarih: son, Size: SAYFA, Index: index,
          EIrsaliyeTipi: yon === 'gelen' ? 1 : 0,
        });
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!ok || !r0 || r0.IsError) {
          return res.status(502).json({ success: false, error: `e-İrsaliye listesi alınamadı: ${mikroHata(data)}` });
        }
        const rows = mikroSatirlar(data);
        if (!rows.length) break;
        tumu.push(...rows);
        if (rows.length < SAYFA) break;
      }
      const irsaliyeler = eBelgeleriNormalize(tumu, 'e-irsaliye', yon);
      if (irsaliyeler.okumaArizasi) console.warn('[ebelge/eirsaliye] okuma arızası:', irsaliyeler.not);
      const yazilan = await eBelgeYaz(irsaliyeler.kayitlar, await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'e-İrsaliye Listesi', `${yazilan} belge (${yon}, ${ilk} → ${son})${irsaliyeler.not ? ' — ' + irsaliyeler.not : ''}`);
      res.json({ success: true, total: yazilan, yon, ...(irsaliyeler.not ? { note: irsaliyeler.not } : {}), duration: Date.now() - t0 });
    } catch (err) {
      console.error('[ebelge/eirsaliye]', err);
      res.status(500).json({ success: false, error: 'e-İrsaliye listesi alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/durum — GİB durum sorgusu (EBelgeDurumSorgulamaV2)
   *  Body: { uuid: string, tur?: 'e-fatura'|'e-arsiv', yon?: 'gelen'|'giden' } */
  app.post('/api/mikro/ebelge/durum', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    try {
      const { ok, data } = await mikroPost('EBelgeDurumSorgulamaV2', {
        EBelge: {
          EFaturaTipi: req.body?.yon === 'gelen' ? 1 : 0,   // 0 gönderilen, 1 gelen
          EBelgeTipi:  req.body?.tur === 'e-arsiv' ? 1 : 0, // 0 e-fatura, 1 e-arşiv
          UUID: uuid,
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      const d = (r0.Data ?? {}) as Record<string, unknown>;
      // Durumu belgeye işle (varsa) — ama alan yoksa UYDURMA.
      if (C.getAdminDb() && (d.Durum ?? d.durum ?? d.DurumKodu) !== undefined) {
        // SAHİPLİK: doc id ham UUID olduğu için başka bir kiracının belgesinin
        // UUID'sini bilen biri onun kaydını değiştirebilirdi. Var olan kaydın
        // companyId'si farklıysa yerel yazmayı ATLA (Mikro yanıtı yine döner).
        const mevcut = await C.getAdminDb().collection('eBelgeler').doc(uuid).get().catch(() => null);
        const sahibi = mevcut?.exists ? (mevcut.data()?.companyId as string | undefined) : undefined;
        const cid = await C.reqCompanyId(req);
        if (!sahibi || sahibi === cid) {
          await C.getAdminDb().collection('eBelgeler').doc(uuid).set({
            companyId: cid,
            gibDurumu: String(d.Durum ?? d.durum ?? ''),
            gibDurumKodu: String(d.DurumKodu ?? d.durumKodu ?? ''),
            gibSorguZamani: pgServerTimestamp(),
          }, { merge: true }).catch(() => { /* yazamazsak sorgu sonucu yine döner */ });
        }
      }
      res.json({ success: true, data: d });
    } catch (err) {
      console.error('[ebelge/durum]', err);
      res.status(500).json({ success: false, error: 'Durum sorgulanamadı.' });
    }
  });

  /** GET /api/mikro/ebelge/mukellef/:vkn — VKN e-fatura mükellefi mi?
   *  Fatura kesilirken e-fatura mı e-arşiv mi seçileceğini belirler. */
  app.get('/api/mikro/ebelge/mukellef/:vkn', C.requireAuth, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const vkn = String(req.params.vkn ?? '').replace(/\D/g, '');
    if (vkn.length !== 10 && vkn.length !== 11) {
      return res.status(400).json({ success: false, error: 'VKN 10, TCKN 11 haneli olmalı.' });
    }
    try {
      const { ok, data } = await mikroPost('EMukellefSorgulamaV2', { EMukellef: { VKN_TCKN: vkn } }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      res.json({ success: true, vkn, data: r0.Data ?? {} });
    } catch (err) {
      console.error('[ebelge/mukellef]', err);
      res.status(500).json({ success: false, error: 'Mükellef sorgulanamadı.' });
    }
  });

  /** Mikro e-belge yanıtından belge gövdesini (base64 PDF / UBL XML) çıkar.
   *  Alan adı Mikro sürümüne göre değiştiği için en uzun string alan aranır. */
  const ebelgeGovdesi = (data: unknown, minUzunluk: number): string | null => {
    if (typeof data === 'string') return data.length > minUzunluk ? data : null;
    if (data && typeof data === 'object') {
      for (const v of Object.values(data)) {
        if (typeof v === 'string' && v.length > minUzunluk) return v;
      }
    }
    return null;
  };

  /** Mikro "başarılı ama BOŞ" dönebiliyor: IsError=false, Data={} — istek kabul
   *  edilmiş ama belge gelmemiştir. Bunu success:true olarak geçirirsek istemci
   *  "Yanıt beklenen biçimde değil" gibi anlamsız bir hata gösteriyor. Gerçek
   *  sebebi burada, tek yerde söylüyoruz (iki uç da aynı metni kullanır). */
  const EBELGE_BOS_HATA =
    'Mikro isteği kabul etti ama belge içeriği dönmedi. En olası neden: Mikro SRV ' +
    'kullanıcısında GİB e-fatura yetkisi yok (aynı kök neden e-belge uçlarındaki ' +
    '400 hatalarını da açıklıyor). Mikro tarafında SRV kullanıcısına e-belge ' +
    'yetkisi verildikten sonra tekrar deneyin.';

  /** POST /api/mikro/ebelge/pdf — belgenin RESMİ PDF'i (base64)
   *  Body: { uuid?: string, faturaGuid?: string }
   *  uuid → GelenFaturaPdfV2 (gelen), faturaGuid → FaturaPdfV2 (giden).
   *  Not: uygulamanın jsPDF çıktısı resmi nüsha DEĞİLDİR; bu uç gerçek olanı verir. */
  app.post('/api/mikro/ebelge/pdf', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    const guid = String(req.body?.faturaGuid ?? '').trim();
    const gecerli = (v: string) => /^[0-9a-fA-F-]{36}$/.test(v);
    if (!gecerli(uuid) && !gecerli(guid)) {
      return res.status(400).json({ success: false, error: 'uuid (gelen) veya faturaGuid (giden) gerekli.' });
    }
    try {
      const { ok, data } = gecerli(uuid)
        ? await mikroPost('GelenFaturaPdfV2', { UUID: uuid }, true)
        : await mikroPost('FaturaPdfV2', { Fatura_Guid: guid }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (!ebelgeGovdesi(r0.Data, 500)) return res.status(502).json({ success: false, error: EBELGE_BOS_HATA });
      res.json({ success: true, data: r0.Data });
    } catch (err) {
      console.error('[ebelge/pdf]', err);
      res.status(500).json({ success: false, error: 'PDF alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/xml — belgenin resmi UBL/XML'i (EBelgeXMLV2)
   *  Body: { uuid, tur?: 'e-fatura'|'e-arsiv'|'e-irsaliye', yon?: 'gelen'|'giden' }
   *
   *  XML, e-belgenin YASAL aslıdır (PDF yalnız görüntüsüdür). Mali müşavire
   *  gönderirken veya arşivlerken istenen budur.
   *  Spec: EFaturaTipi 0=gönderilen 1=gelen · EBelgeTipi 0=EFatura 1=EArsiv 2=EIrsaliye
   */
  app.post('/api/mikro/ebelge/xml', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    const belgeTipi = req.body?.tur === 'e-arsiv' ? 1 : req.body?.tur === 'e-irsaliye' ? 2 : 0;
    try {
      const { ok, data } = await mikroPost('EBelgeXMLV2', {
        EBelge: {
          EFaturaTipi: req.body?.yon === 'gelen' ? 1 : 0,
          EBelgeTipi:  belgeTipi,
          UUID: uuid,
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (!ebelgeGovdesi(r0.Data, 200)) return res.status(502).json({ success: false, error: EBELGE_BOS_HATA });
      res.json({ success: true, data: r0.Data });
    } catch (err) {
      console.error('[ebelge/xml]', err);
      res.status(500).json({ success: false, error: 'XML alınamadı.' });
    }
  });

  /** POST /api/mikro/ebelge/earsiv-iptal — e-arşiv faturası iptali (EArsivIptalV2)
   *  Body: { uuid, iptalAciklamasi, iptalTarihi?, faturaSilinsin? }
   *  Yasal işlem — MFA istenir. */
  app.post('/api/mikro/ebelge/earsiv-iptal', C.requireAuth, C.requireMfaVerified, C.mikroLimiter, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const uuid = String(req.body?.uuid ?? '').trim();
    const aciklama = String(req.body?.iptalAciklamasi ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return res.status(400).json({ success: false, error: 'Geçerli bir UUID gerekli.' });
    if (!aciklama) return res.status(400).json({ success: false, error: 'İptal açıklaması zorunlu.' });
    try {
      const { ok, data } = await mikroPost('EArsivIptalV2', {
        EArsiv: {
          UUID: uuid,
          IptalTarihi: sqlTarih(req.body?.iptalTarihi, mikroBugun()),
          IptalAciklamasi: aciklama,
          FaturaSilinsin: req.body?.faturaSilinsin === true ? 'true' : 'false',
        },
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) return res.status(502).json({ success: false, error: mikroHata(data) });
      if (C.getAdminDb()) {
        // Sahiplik kontrolü — bkz. /ebelge/durum'daki aynı gerekçe.
        const mevcut = await C.getAdminDb().collection('eBelgeler').doc(uuid).get().catch(() => null);
        const sahibi = mevcut?.exists ? (mevcut.data()?.companyId as string | undefined) : undefined;
        const cid = await C.reqCompanyId(req);
        if (!sahibi || sahibi === cid) {
          await C.getAdminDb().collection('eBelgeler').doc(uuid).set({
            companyId: cid, durum: 'İptal', iptalAciklamasi: aciklama, iptalZamani: pgServerTimestamp(),
          }, { merge: true }).catch(() => {});
        }
      }
      await C.writeAuditLog(C.reqActor(req), 'e-Arşiv İptal', `${uuid} iptal edildi: ${aciklama}`);
      res.json({ success: true, data: r0.Data ?? {} });
    } catch (err) {
      console.error('[ebelge/earsiv-iptal]', err);
      res.status(500).json({ success: false, error: 'e-Arşiv iptali başarısız.' });
    }
  });

  // ── Mikro Gelen e-Fatura Kabul / Ret ────────────────────────────────────────
  // POST /api/mikro/gelen-fatura/kabul  — GİB üzerinden gelen e-faturayı kabul et
  // POST /api/mikro/gelen-fatura/ret    — GİB üzerinden gelen e-faturayı reddet
  // Body: { faturaGuid: string, firebaseId?: string }   (ret için: aciklama?: string)
  // Endpoint'ler Mikro destek tarafından 2026-06-11'de onaylandı.

  app.post('/api/mikro/gelen-fatura/kabul', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = C.validate(GelenFaturaActionSchema, req.body, res);
    if (!parsed) return;
    const { faturaGuid, firebaseId } = parsed;
    { const sahip = await belgeSahipligi('mikroFaturalar', firebaseId, await C.reqCompanyId(req));
      if (sahip === 'yabanci' || sahip === 'yok') return res.status(404).json(YABANCI_BELGE); }   // GİB'e gitmeden ÖNCE
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('GelenFaturalarKabulV2', { FaturaGuid: faturaGuid });
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0       = envelope?.[0] as Record<string, unknown> | undefined;
      const isOk     = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = isOk ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('GelenFaturalarKabulV2', 'gelenFatura', faturaGuid, isOk, faturaGuid, errorMsg, Date.now() - t0, C.reqActor(req));

      if (C.getAdminDb() && firebaseId && isOk) {
        await C.getAdminDb().collection('mikroFaturalar').doc(firebaseId).set({
          companyId: await C.reqCompanyId(req),
          gibDurumu: 'kabul',
          gibKabulAt: pgServerTimestamp(),
        }, { merge: true });
      }

      res.json({ success: isOk, data: r0?.Data ?? null, duration: Date.now() - t0, error: errorMsg });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mikro/gelen-fatura/ret', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = C.validate(GelenFaturaActionSchema, req.body, res);
    if (!parsed) return;
    const { faturaGuid, aciklama, firebaseId } = parsed;
    { const sahip = await belgeSahipligi('mikroFaturalar', firebaseId, await C.reqCompanyId(req));
      if (sahip === 'yabanci' || sahip === 'yok') return res.status(404).json(YABANCI_BELGE); }   // GİB'e gitmeden ÖNCE
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('GelenFaturalarRedV2', {
        FaturaGuid: faturaGuid,
        Aciklama:   aciklama || 'Fatura reddedildi.',
      });
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0       = envelope?.[0] as Record<string, unknown> | undefined;
      const isOk     = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = isOk ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('GelenFaturalarRedV2', 'gelenFatura', faturaGuid, isOk, faturaGuid, errorMsg, Date.now() - t0, C.reqActor(req));

      if (C.getAdminDb() && firebaseId && isOk) {
        await C.getAdminDb().collection('mikroFaturalar').doc(firebaseId).set({
          companyId: await C.reqCompanyId(req),
          gibDurumu: 'ret',
          gibRetAciklama: aciklama || null,
          gibRetAt: pgServerTimestamp(),
        }, { merge: true });
      }

      res.json({ success: isOk, data: r0?.Data ?? null, duration: Date.now() - t0, error: errorMsg });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── UCUNCU GRUP (D4 adim 8): e-Fatura / e-Arsiv uclari ────────────────
  // ── Mikro e-Fatura / e-Arşiv ─────────────────────────────────────────────────
  // POST /api/mikro/fatura/kaydet  — push order/invoice to Mikro as e-Fatura or e-Arşiv
  // Body: { order: Record<string, unknown>, firebaseId: string }
  //   order must have: mikroCariKod, lineItems[], totalPrice, faturaTipi ('e-fatura'|'e-arsiv'|'ihracat')
  // On success writes back: mikroFaturaNo, ettn, mikroFaturaDate to orders/{firebaseId}
  app.post('/api/mikro/fatura/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = C.validate(FaturaKaydetSchema, req.body, res);
    if (!parsed) return;
    // P5-3: fatura Mikro'da olustuktan SONRAKI yerel guncelleme hatasi istegi
    // basarisiz yapmaz (yoksa kullanici tekrar dener -> cift e-Fatura).
    let localUpdateFailed = false;
    const { order, firebaseId } = parsed;
    if (await belgeSahipligi('orders', firebaseId, await C.reqCompanyId(req)) === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    const t0 = Date.now();
    try {
      // Gövde TEK KAYNAKTA: src/server/mikro/govdeFaturaIrsaliye.ts (faturaGovdesi).
      // V17 evrak formatı, cha_ebelge_turu'nun 2026-08-25 düzeltmesi ve onu sabitleyen
      // iki bağımsız kaynak (okuma tarafı tie-out'u + Mikro API spec'i) o dosyanın
      // başlığına TAŞINDI — silinmedi. Testi govdeFaturaIrsaliye.test.ts.
      //
      // Varsayılan YOK — bilinmeyen fiyat/miktar/KDV oranı/cari kod/tarih ya da
      // kalemsiz fatura throw eder; aşağıdaki catch 400 döner ve mikroPost HİÇ
      // çağrılmaz. Kapatılan sahte varsayılanlar:
      //   sth_tutar     price ?? 0 × quantity ?? 1  → fiyatsız satır 0 TL, miktarsız 1 adet
      //   sth_vergi     kdvOran ?? 20               → KDV TUTARI %20 varsayımıyla uyduruluyordu
      //   sth_vergi_pntr kdvOran>=20?4:>=10?3:1     → artık Mikro'nun KENDİ vergi tablosundan
      //                                               (VergiListesiV2) TERS arama
      //   sth_stok_kod  sku boşsa ''                → SKU'suz kalem Mikro defterine kodu
      //                                               boş, SAHİPSİZ stok hareketi yazıyordu
      //                                               (şema `sku`yu optional bırakıyor)
      // ve `new Date(bozuk)` → "NaN.NaN.NaN" tarihi.
      //
      // `mikroVergiOranlari()` bir AĞ çağrısıdır ve bilerek try içindedir: okunamazsa
      // BOŞ Map döner ve gövde kurucu "vergi işaretçisi bilinmiyor (… VergiListesiV2
      // okunamadı …)" ile 400 verir — sessizce 4 (=%20) yazmaz.
      //
      // AÇIK MADDE: fatura satırındaki sth_giris/cikis_depo_no hâlâ 1 (parite). Hiçbir
      // çağıran depo göndermiyor ve throw'a çevirmek e-Fatura kesmeyi (yasal belge)
      // tamamen durdururdu; depo kaynağı çözülünce `{ depoNo }` ile tek satırda bağlanır.
      const { evrak, satirlar, toplamTutar, faturaDate } = faturaGovdesi(order, {
        vergiTablosu: await mikroVergiOranlari(),
        jumpSurum:    MIKRO_JUMP_SURUM,
        // Siparişte SEVK DEPOSU seçilmişse fatura satırı da o depoya yazılır (2026-09-19). Seçilmemişse gövde
        // pariteye (1) düşer — throw e-Fatura kesmeyi tamamen durdururdu; kullanıcı kararı Açık İşler'de.
        depoNo:       order.depoNo,
      });

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('FaturaKaydetV2', { evraklar: [evrak] }, true);
      const duration   = Date.now() - t0;
      const envelope   = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0         = envelope?.[0] as Record<string, unknown> | undefined;
      const success    = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md         = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      // Numara/ETTN METNE normalize edilir (`as string` yalnız derleme zamanı dökümüydü; sayısal
      // evrak no istemcinin metin kapısında sessizce düşüyordu) — src/server/mikro/belgeNo.ts
      const mikroFaturaNo = belgeNoMetni(md?.faturaNo, md?.FaturaNo, md?.evrakNo, md?.EvrakNo, md?.id);
      const ettn          = belgeNoMetni(md?.ettn, md?.Ettn, md?.uuid);
      const errorMsg   = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', success, mikroFaturaNo, errorMsg, duration, C.reqActor(req));
      if (success) {
        if (C.getPgPool()) {
          const client = await C.getPgPool().connect();
          try {
            await client.query('BEGIN');
            await mirrorMikroInsert('mikro_stok_hareketleri',
              (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'fatura_push' })), STH_COLS, client);
            await mirrorMikroInsert('mikro_cari_hesap_hareketleri',
              [{ ...evrak, detay: undefined, cha_meblag: toplamTutar, cha_belge_no: mikroFaturaNo, __kaynak: 'fatura_push' }], CHA_COLS, client);
            await client.query('COMMIT');
          } catch (dbErr) {
            await client.query('ROLLBACK');
            console.error('[FaturaKaydetV2] local db transaction failed:', dbErr);
            // Invoice is in Mikro, but local DB mirror failed. We can queue a retry if boss is available.
            if (C.getBoss()) await C.getBoss().send('outbound-webhook', { event: 'fatura_mirror_failed', payload: { mikroFaturaNo } });
          } finally {
            client.release();
          }
        }
        if (C.getAdminDb() && firebaseId) {
          try {
            await C.getAdminDb().collection('orders').doc(firebaseId).set({
              companyId: await C.reqCompanyId(req),
              mikroFaturaNo,
              ettn,
              hasInvoice:      true,
              mikroFaturaDate: faturaDate,
              mikroSynced:     true,
              mikroSyncedAt:   pgServerTimestamp(),
            }, { merge: true });
          } catch (updErr) {
            // P5-3 KRITIK: fatura Mikro'da ARTIK VAR. Burada hatayi yukari birakip
            // 500 donersek kullanici "başarısız" gorup tekrar dener ve AYNI siparis
            // icin IKINCI bir yasal e-Fatura kesilir. Bu yuzden yerel guncelleme
            // hatasi istegi basarisiz YAPMAZ: loglanir, telafi kuyruguna alinir ve
            // yanitta localUpdateFailed ile bildirilir.
            localUpdateFailed = true;
            console.error('[FaturaKaydetV2] yerel siparis guncellemesi basarisiz (FATURA MIKRO\'DA OLUSTU):', updErr);
            if (C.getBoss()) {
              await C.getBoss().send('outbound-webhook',
                { event: 'fatura_order_update_failed', payload: { firebaseId, mikroFaturaNo, ettn } },
              ).catch(() => {});
            }
          }
        }
      }
      // `belgeTipiIletildi`: belge tipi (e-Fatura/e-Arşiv) Mikro gövdesine YALNIZ V17 zarfında (`cha_ebelge_turu`) girer.
      // Ortamda MIKRO_JUMP_SURUM 16 ise seçim Mikro'ya HİÇ gitmez — istemci kullanıcıyı uyarır (sessiz kalmasın).
      res.json({ success, mikroFaturaNo, ettn, localUpdateFailed, belgeTipiIletildi: MIKRO_JUMP_SURUM >= 17, error: errorMsg, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      if (mikroGovdeHatasiMi(err)) {   // gövde kurulamadı → Mikro'ya HİÇ gidilmedi
        // Eksik/bilinmeyen alan İSTEMCİ hatasıdır: 500 "sunucu bozuk, tekrar dene"
        // demek olurdu, oysa tekrar denemek işe yaramaz — kullanıcı eksik alanı
        // doldurmalı. İstemci (App.tsx handleMikroFatura) `error` metnini toast'lar.
        console.warn('Mikro FaturaKaydetV2 gövdesi kurulamadı:', errorMsg);
        return res.status(400).json({ success: false, error: errorMsg });
      }
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro e-İrsaliye ─────────────────────────────────────────────────────────
  // POST /api/mikro/irsaliye/kaydet  — push shipment as e-İrsaliye to Mikro
  // Body: { shipment: Record<string, unknown>, firebaseId: string }
  //   shipment must have: mikroCariKod, customerName, destination, trackingNo, items[]
  // On success writes back: irsaliyeNo, irsaliyeEttn to shipments/{firebaseId}
  // ROL KAPISI (2026-09-19 uçtan uca inceleme): rota yalnız requireAuth + MFA istiyordu — `orders`ı salt-okunur gören
  // (Muhasebe/Satın Alma) ya da DIŞ rol (B2B/Dealer; `orders` yazma yetkileri var!) RESMÎ belge kesebiliyordu.
  // e-İrsaliye bir SEVKİYAT işlemidir → `shipments` yazma yetkisi (Admin/Manager/Logistics — src/lib/rbac.ts).
  // Satış rolü de kessin istenirse rbac'ta `shipments.write`'a eklenir; burada ayrı liste tutulmaz.
  app.post('/api/mikro/irsaliye/kaydet', C.requireAuth, C.requireMfaVerified, C.requireCollectionAccess('shipments', 'write'), async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = C.validate(IrsaliyeKaydetSchema, req.body, res);
    if (!parsed) return;
    const { shipment, firebaseId } = parsed;
    if (await belgeSahipligi('shipments', firebaseId, await C.reqCompanyId(req)) === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    // `firebaseId` SİPARİŞ id'sidir (istemci `orders/{id}` gönderir): o siparişin sahipliği de doğrulanır, çünkü başarıda
    // işaret `orders/{id}`'ye SUNUCU tarafından yazılır (aşağıda). 'yok' serbest — id bir sipariş olmayabilir.
    const siparisSahipligi = await belgeSahipligi('orders', firebaseId, await C.reqCompanyId(req));
    if (siparisSahipligi === 'yabanci') return res.status(404).json(YABANCI_BELGE);
    // FATURASIZ sevkiyat Mikro'ya YAZILMAZ (savunma katmanı; asıl kapı istemcide — App.tsx Shipped akışı).
    // Eskiden bu rota her istekte gövde hatasıyla 400 dönüyordu (sku/kdvOran/depoNo gönderilmiyordu) ve açık
    // görünmüyordu; gövde geçerli hâle gelince faturasız sipariş e-İrsaliye olarak resmî deftere düşmeye başlardı.
    if (shipment.faturali === false) return res.status(400).json({ success: false, error: "Faturasız sevkiyat Mikro'ya yazılmaz." });
    // ── MÜKERRER RESMÎ BELGE KAPISI (2026-09-19) ─────────────────────────────
    // Bu rota başarıda `shipments/{firebaseId}`ye `mikroSynced`/`irsaliyeNo` yazıyordu ama
    // GÖNDERİM ÖNCESİ kimse okumuyordu: tek koruma istemcideki uçuş kilidiydi (bellekte,
    // sekmeye özel). Sekme yenileme, proxy 502'si, ikinci sekme ya da ikinci kullanıcı o
    // kilidi aşıyor ve aynı sevkiyat için Mikro'da İKİNCİ resmî e-İrsaliye oluşuyordu
    // (gövdedeki `date` her istekte farklı olduğu için Mikro da ayırt edemiyor).
    // İstemci 409'u `zatenGonderildi` ile tanır, siparişteki işareti yazıp durumu ONARIR.
    // SINIR: bu kapı TAMAMLANMIŞ gönderimi görür, UÇUŞTAKİNİ değil — iki eşzamanlı istek
    // için `mikroPost` öncesi atomik "gönderiliyor" kaydı gerekir (PG transaction; açık iş).
    if (C.getAdminDb() && firebaseId) {
      const snap = await C.getAdminDb().collection('shipments').doc(firebaseId).get();
      const onceki = snap.exists ? (snap.data() as Record<string, unknown> | undefined) : undefined;
      // Aynı normalizasyon: eski kayıtlarda numara SAYI olarak damgalanmış olabilir; `typeof
      // === 'string'` kapısı onu görmeyip mükerrer belge riskini geri açardı.
      const oncekiNo = belgeNoMetni(onceki?.irsaliyeNo) ?? '';
      // İKİNCİ KAYNAK: siparişin kendi işareti. `shipments/{id}` Lojistik → Sevkiyatlar tablosunda görünen ve oradan
      // SİLİNEBİLEN bir satırdır; yalnız ona bakan kapı, satır silinince kalkıyordu (2026-09-19 uçtan uca inceleme).
      const sipSnap = siparisSahipligi === 'kendi' ? await C.getAdminDb().collection('orders').doc(firebaseId).get() : null;
      const sip = sipSnap?.exists ? (sipSnap.data() as Record<string, unknown> | undefined) : undefined;
      const sipNo = belgeNoMetni(sip?.irsaliyeNo) ?? '';
      const kesilmisNo = oncekiNo !== '' ? oncekiNo : sipNo;
      if ((onceki && (onceki.mikroSynced === true || oncekiNo !== '')) || (sip && (sip.irsaliyeGonderildi === true || sipNo !== ''))) {
        return res.status(409).json({
          success: false,
          zatenGonderildi: true,
          ...(kesilmisNo !== '' ? { irsaliyeNo: kesilmisNo } : {}),
          error: 'Bu sevkiyat için e-İrsaliye zaten kesilmiş.',
        });
      }
    }
    const t0 = Date.now();
    try {
      // Gövde TEK KAYNAKTA: src/server/mikro/govdeFaturaIrsaliye.ts (irsaliyeGovdesi).
      // V17 satır formatı (sth_evraktip=1, kargo bilgisi e_irsaliye_detaylari'nda) ve
      // 2026-06-12 Postman doğrulaması o dosyanın başlığına TAŞINDI. Testi
      // govdeFaturaIrsaliye.test.ts.
      //
      // Varsayılan YOK: depo (eski SABİT 1 = HAVALİMANI, 2026-09-05), fiyat, miktar ve
      // KDV oranı bilinmiyorsa throw → catch 400, mikroPost HİÇ çağrılmaz. Kalemsiz
      // sevkiyat artık tek satırlık, stok kodsuz, 1 adet, 0 TL'lik SAHTE belge üretmez.
      // Kalemin kendi STOK KODU da boş geçemez (2026-09-19): kalemsiz sevkiyatı kapatan
      // gerekçe tek tek kalemler için de geçerli — kodsuz sth_* satırı sahipsiz harekettir.
      // sth_vergi_pntr sabit 4 değil, Mikro'nun kendi VergiListesiV2 tablosundan.
      const { evrak, satirlar } = irsaliyeGovdesi(shipment, {
        vergiTablosu: await mikroVergiOranlari(),
        depoNo:       shipment.depoNo,
      });

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('IrsaliyeKaydetV2', { evraklar: [evrak] }, true);
      const duration      = Date.now() - t0;
      const envelope      = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0            = envelope?.[0] as Record<string, unknown> | undefined;
      const success       = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md            = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      // Numara/ETTN METNE normalize edilir — src/server/mikro/belgeNo.ts. Sayısal `EvrakNo`
      // döndüğünde eskiden numara istemciye sayı olarak gidiyor, `orders.irsaliyeNo` hiç
      // yazılmıyor ve rozet kalıcı "gönderildi — numara gelmedi" diyordu (2026-09-19 kapanış).
      const irsaliyeNo    = belgeNoMetni(md?.irsaliyeNo, md?.IrsaliyeNo, md?.evrakNo, md?.EvrakNo, md?.id);
      const irsaliyeEttn  = belgeNoMetni(md?.ettn, md?.Ettn, md?.uuid);
      const errorMsg      = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', success, irsaliyeNo, errorMsg, duration, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_stok_hareketleri',
        (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'irsaliye_push' })), STH_COLS);
      // YEREL YAZIMLAR KENDİ try/catch'inde (fatura rotasındaki `localUpdateFailed` deseni): Mikro BAŞARILI olduktan
      // sonra bir DB yazımı düşerse rota 500 dönüyor, kullanıcı "hata" görüp YENİDEN gönderiyor ve Mikro'da İKİNCİ resmî
      // e-İrsaliye oluşuyordu (işaret yazılamadığı için 409 kapısı da kördü). Artık yanıt success:true kalır, istemci
      // işareti kendisi de dener; o da düşerse App.tsx "YENİDEN GÖNDERMEYİN" der (2026-09-19 son parti incelemesi).
      let localUpdateFailed = false;
      if (C.getAdminDb() && firebaseId && success) {
        try {
          await C.getAdminDb().collection('shipments').doc(firebaseId).set({
            companyId: await C.reqCompanyId(req),
            // Sevkiyatlar tablosunda BOŞ iskelet satır olmasın: gövdede gelen tanımlayıcı alanlar da yazılır
            // (yalnız DOLU olanlar — merge mevcut değeri korur).
            ...(shipment.customerName ? { customerName: shipment.customerName } : {}),
            ...(shipment.destination ? { destination: shipment.destination } : {}),
            ...(shipment.trackingNo ? { trackingNo: shipment.trackingNo } : {}),
            orderId: firebaseId,
            irsaliyeNo,
            irsaliyeEttn,
            mikroSynced:     true,
            mikroSyncedAt:   pgServerTimestamp(),
          }, { merge: true });
          // SİPARİŞ işaretini SUNUCU yazar: istemcinin `updateDoc(orders/{id})` yazımı RBAC'a takılırsa (ya da sekme
          // kapanırsa) işaret hiç düşmüyor, düğme yeniden etkin görünüyordu. Yalnız çağıranın KENDİ siparişine ve
          // `update` ile (set-merge DEĞİL): sahiplik kontrolü `mikroPost`'tan ÖNCE yapıldı; arada silinmiş siparişi
          // upsert 3 alanlı, companyId'siz zombi olarak diriltirdi (pgShim.update var olmayan dokümana yazmaz).
          if (siparisSahipligi === 'kendi') {
            await C.getAdminDb().collection('orders').doc(firebaseId).update({
              irsaliyeGonderildi: true,
              ...(irsaliyeNo ? { irsaliyeNo } : {}),
              irsaliyeGonderimAt: pgServerTimestamp(),
            });
          }
        } catch (yazimHatasi) {
          localUpdateFailed = true;
          console.error(`[irsaliye/kaydet] e-İRSALİYE MİKRO'DA OLUŞTU (no: ${irsaliyeNo ?? '—'}) ama yerel işaret yazılamadı — sipariş ${firebaseId}:`, yazimHatasi);
        }
      }
      // `error`: Mikro'nun REDDİ (IsError) HTTP 200 + success:false döner; alan yokken istemci toast'ı `d.error`
      // şartına takılıp reddi SESSİZ geçiyordu (2026-09-19 son parti incelemesi). Diğer kaydet rotalarıyla aynı sözleşme.
      res.json({ success, irsaliyeNo, irsaliyeEttn, localUpdateFailed, error: errorMsg, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      if (mikroGovdeHatasiMi(err)) {   // gövde kurulamadı → Mikro'ya HİÇ gidilmedi
        // İstemci hatası (400). Bu rota App.tsx'te fire-and-forget çağrılıyor; hatanın
        // kullanıcıya ulaşması için oradaki `.then` de 400'ü toast'lar (aynı düzeltmede).
        console.warn('Mikro IrsaliyeKaydetV2 gövdesi kurulamadı:', errorMsg);
        return res.status(400).json({ success: false, error: errorMsg });
      }
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Pull: Cari Bakiye ──────────────────────────────────────────────────
  // POST /api/mikro/pull/bakiye — cari bakiyelerini Mikro'dan çek → cariBalances
  //
  // 2026-07-30'da BAŞTAN YAZILDI. Eski hali `CariHareketListesiV2`yi cari başına
  // bir kez çağırıyordu; o metot Mikro Jump V17'de HİÇ YOK (resmi Postman
  // koleksiyonunda 161 endpoint arasında bulunmuyor — liste yüzeyi yalnız
  // Stok/Cari listesi + SqlVeriOkuV2). Yani her çağrı boşa gidiyor, ardından
  // `Number(md?.bakiye ?? 0)` devreye girip TÜM carilerin bakiyesini 0 yazıyordu.
  // Aynı sessiz-sıfır deseni stok tarafında da vardı (bkz. mikroStokMiktari).
  //
  // Yeni yol: SqlVeriOkuV2 (SELECT-only SQL kapısı) ile TEK sorguda tüm cari
  // bakiyeleri. cha_tip 0 = borç (satış), 1 = alacak — bakiye = borç - alacak.
  // N çağrı yerine 1 çağrı; ayrıca 100'lük limit gereksiz kalıyor.
  
// KALDIRILDI (2026-08-11): /api/mikro/test-personel geçici hata ayıklama ucu.
// `requireAuth` YOKTU ve PERSONEL_TANIMLARI'nı ham dökmeye çalışıyordu — yani TC
// kimlik no, maaş, telefon, e-posta. Bugün 500 veriyordu çünkü import ettiği
// `./src/services/mikroSql` modülü hiç yok; o modül bir gün oluşturulsaydı uç
// anında KİMLİKSİZ bir PII sızıntısına dönüşecekti. Kalıcı karşılığı zaten var:
// POST /api/mikro/pull/personel (requireAuth + requireMfaVerified).

app.post('/api/mikro/pull/bakiye', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    { const kilit = await yaziciyiIstegeBagla(C.getPgPool?.(), `mikro-pull-bakiye:${Date.now().toString(36)}`, res); if (kilit) return res.status(423).json({ success: false, error: `Bakım kilidi: ${kilit.aciklama} (${kilit.baslangic}) — veri bakımı bitince tekrar deneyin.` }); }   // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts)
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const { ok, data } = await mikroPost('SqlVeriOkuV2', {
        SQLSorgu:
          'SELECT cha_kod, ' +
          'SUM(CASE WHEN cha_tip = 0 THEN cha_meblag ELSE -cha_meblag END) AS bakiye ' +
          // ISNULL(cha_iptal,0)=0 ZORUNLU (2026-08-22 denetim bulgusu C16):
          // iptal edilmiş cari hareketler de toplama giriyordu — cari bakiyesi
          // iptal edilen her fatura/tahsilat kadar yanlış çıkıyordu. Bu tablonun
          // diğer okumaları (import/cari-hareket ekKosul, evrak_tip 63 listesi)
          // zaten iptali dışlıyor; bu sorgu tek istisnaydı.
          'FROM CARI_HESAP_HAREKETLERI WHERE ISNULL(cha_iptal, 0) = 0 GROUP BY cha_kod',
      });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        // HİÇBİR ŞEY YAZMA. Sorgu başarısızsa bakiyeleri sıfırlamak, bilgi
        // vermemekten çok daha kötü — tahsilat kararları bu rakama bakıyor.
        const msg = (r0?.ErrorMessage as string) || 'Mikro SqlVeriOkuV2 yanıt vermedi.';
        console.warn('[pull/bakiye] SqlVeriOkuV2 başarısız:', msg);
        return res.status(502).json({
          success: false,
          error: `Bakiye sorgusu çalıştırılamadı: ${msg}. Hiçbir bakiye değiştirilmedi.`,
        });
      }

      const rows = mikroSatirlar(data);
      if (!rows.length) {
        return res.json({ success: true, total: 0, updated: 0, skipped: 0, duration: Date.now() - t0,
                          note: 'Mikro hiç cari hareketi döndürmedi — bakiye yazılmadı.' });
      }

      // Eşleme TEK KAYNAKTA (server/mikro/eslemeCari.ts): işaret KORUNUR (eksi = CETPA
      // borçlu, `Math.abs` yok), bilinmeyen bakiye 0 değil — haritaya hiç girmez ve sayılır.
      // `''` artık okunamayan sayılıyor: eski `Number.isFinite(Number(''))` BOŞ hücreyi
      // geçerli sıfır bakiye kabul ediyordu (Number('') === 0).
      const { harita: bakiyeByKod, okunamayan: unreadable, okunamayanKodlar, okumaArizasi, not: eslemeNotu } = bakiyeHaritasi(rows);
      // TOPLU SIFIRLAMA KAPISI: bakiye HİÇBİR satırda okunamadıysa bu veri değil OKUMA
      // ARIZASIDIR (kolon adı/şema değişmiş). Aşağıdaki döngü haritada olmayan her cariye
      // 0 yazar, yani TÜM bakiyeleri sıfırlardı — uyarıp devam etmek yetmez. Rotanın kendi
      // ilkesi zaten bu: "Sorgu başarısızsa bakiyeleri sıfırlamak, bilgi vermemekten çok
      // daha kötü — tahsilat kararları bu rakama bakıyor."
      if (okumaArizasi.length) {
        console.warn('[pull/bakiye] okuma arızası:', eslemeNotu);
        return res.status(502).json({ success: false, error: `${eslemeNotu}. Hiçbir bakiye değiştirilmedi.` });
      }

      const companyId = await C.reqCompanyId(req);
      const leadsSnap = await C.getAdminDb().collection('leads').where('mikroCariKod', '!=', '').get();
      let updated = 0, skipped = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };

      let bakiyeYabanci = 0;
      for (const leadDoc of leadsSnap.docs) {
        const leadVeri = leadDoc.data() as Record<string, unknown>;
        // KİRACI İZOLASYONU (2026-09-19): sorgu TÜM kiracıların lead'lerini döndürür; yabancı kiracının kaydına
        // bakiye YAZILMAZ (aynı cari kodu iki firmada olabilir). Etiketsiz eski kayıt hâlâ güncellenir.
        const dc = (leadVeri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) { bakiyeYabanci++; continue; }
        const cariKod = String(leadVeri.mikroCariKod ?? '').trim();
        if (!cariKod) { skipped++; continue; }
        // Satırı GELDİ ama bakiyesi okunamadı → bu cariye HİÇ DOKUNMA. Aşağıdaki
        // `cariBakiyesi` haritada olmayana 0 döner; o 0 yalnız "Mikro'da hiç hareketi
        // yok" hâlinde doğrudur. İki hâl ayrılmazsa 48.000 TL borçlu bir cari tahsilat
        // ekranında sıfır görünür (hakem bulgusu 2026-09-19). Yanıttaki `unreadable`
        // ve `note` bunu zaten sayıyor; burada susup mevcut bakiyeyi KORUYORUZ
        // ("bayat değer, silinmiş değerden iyidir").
        if (okunamayanKodlar.has(cariKod)) { skipped++; continue; }
        // Mikro'da hiç hareketi olmayan cari: SQL'de satırı yok. Bu GERÇEKTEN
        // sıfır bakiyedir (hareket yok = borç yok), tespit edilememiş değil —
        // sorgu başarılı döndüğü için bunu yazmak doğru. (`cariBakiyesi` tam olarak bu
        // kararı uygular — aynı gerekçe fonksiyonun doc yorumunda da duruyor.)
        const bakiye = cariBakiyesi(bakiyeByKod, cariKod);
        batch.set(C.getAdminDb().collection('cariBalances').doc(cariKod), {
          companyId, cariKod, bakiye, updatedAt: pgServerTimestamp(),
        }, { merge: true });
        ops++;
        batch.set(leadDoc.ref, { bakiye }, { merge: true });
        ops++;
        updated++;
        if (ops >= 400) await flush();
      }
      await flush();

      const ozet = `${updated} cari bakiyesi güncellendi (Mikro'dan ${rows.length} satır, ${unreadable} okunamayan)`;
      await C.writeSyncLog('SQL:CARI_HESAP_HAREKETLERI', 'cariBalances', ozet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Bakiye Çekme', ozet);
      // `eslemeNotu` burada yalnız KISMİ eksiği anlatır ("3 satırın bakiye alanı
      // bilinmiyor") — tam okuma arızası yukarıda 502 ile dönmüştür.
      res.json({ success: true, total: leadsSnap.size, updated, skipped, unreadable, yabanciAtlanan: bakiyeYabanci,
                 mikroRows: rows.length, duration: Date.now() - t0,
                 ...(eslemeNotu ? { note: eslemeNotu } : {}) });
    } catch (err) {
      console.error('[pull/bakiye]', err);
      res.status(500).json({ success: false, error: 'Bakiye çekimi başarısız. Hiçbir bakiye değiştirilmedi.' });
    }
  });

  // ── Mikro Pull: Cari Adresleri ───────────────────────────────────────────
  // POST /api/mikro/pull/cari-adres
  //
  // Önceden yalnız PUSH vardı (leads.address/city/district → Mikro, bkz.
  // CariKaydetV2 push payload). PULL yoktu — Mikro'da (elle veya push ile)
  // girilmiş adresler Cetpa'ya hiç geri gelmiyordu (2026-08-17 kullanıcı
  // isteği: "müşterilerin adreslerini mikroya kaydediyoruz, otomatik al ve
  // bölgelerine koy" — Satış Bölgesi'nin otomatik atama yapabilmesi için şart).
  //
  // Kolonlar TAHMİN EDİLMİYOR — mikroKolonlar ile şemadan süzülüyor (adr_cadde/
  // adr_ilce/adr_il/adr_ulke/adr_adres_no zaten mikro_cari_hesap_adresleri
  // aynasında doğrulanmış — bkz. CREATE TABLE, ~satır 1092). Bir cari'nin
  // birden çok adresi olabilir (sevk/fatura/vb, adr_adres_no ile ayrılır);
  // en düşük adres no'yu (genelde varsayılan/ilk girilen) alıyoruz.
  //
  // SADECE BOŞ ALANLARI DOLDURUR — elle düzeltilmiş bir city/address varsa
  // ÜZERİNE YAZMAZ (EKLE, YERİNE KOYMA ilkesi; bu alan için "ekleme" = eksik
  // olanı doldurmak).
  app.post('/api/mikro/pull/cari-adres', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    { const kilit = await yaziciyiIstegeBagla(C.getPgPool?.(), `mikro-pull-cari-adres:${Date.now().toString(36)}`, res); if (kilit) return res.status(423).json({ success: false, error: `Bakım kilidi: ${kilit.aciklama} (${kilit.baslangic}) — veri bakımı bitince tekrar deneyin.` }); }   // lead yazıcısı: bakım scripti bunun bitmesini bekler (bakimKilidi.ts)
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const cols = await mikroKolonlar('CARI_HESAP_ADRESLERI');
      if (!cols.length) {
        return res.status(502).json({ success: false, error: 'CARI_HESAP_ADRESLERI şeması okunamadı.' });
      }
      const istenen = ['adr_cari_kod', 'adr_adres_no', 'adr_cadde', 'adr_ilce', 'adr_il', 'adr_ulke'];
      const colSet = new Set(cols.map(c => c.toLowerCase()));
      const secim = istenen.filter(c => colSet.has(c.toLowerCase()));
      if (!secim.includes('adr_cari_kod') || secim.length < 2) {
        return res.status(502).json({ success: false, error: 'CARI_HESAP_ADRESLERI beklenen kolonları taşımıyor — hiçbir adres değiştirilmedi.' });
      }

      // ORDER BY şart: adr_adres_no şemada yoksa (aşağıdaki gruplama her satırı
      // eşit "0" görür) ya da iki satır aynı adres no'yu taşıyorsa (Mikro bunu
      // garanti etmiyor), sıralamasız sonuç SQL Server'ın keyfi dönüş sırasına
      // kalır — her çalıştırmada FARKLI adres seçilebilir (code-review bulgusu).
      const siraliMi = secim.includes('adr_adres_no');
      const { rows, hata } = await mikroSql(
        `SELECT ${secim.join(', ')} FROM CARI_HESAP_ADRESLERI` +
        (siraliMi ? ' ORDER BY adr_cari_kod, adr_adres_no' : ''),
      );
      if (hata) {
        return res.status(502).json({ success: false, error: `Adres sorgusu çalıştırılamadı: ${hata}. Hiçbir adres değiştirilmedi.` });
      }

      // cari_kod başına en küçük BİLİNEN adr_adres_no'lu satır; adres no'su okunamayan
      // satır EN SONA gider (eski `Number(row.adr_adres_no ?? 0)` onu 0 sayıp yarışı
      // DAİMA kazandırıyordu — şube adresi merkezin yerine geçiyordu). Eşitlikte ilk
      // satır kalır; yukarıdaki ORDER BY o sırayı kararlı yapar. Seçim TEK KAYNAKTA:
      // server/mikro/eslemeCari.ts
      const byKod = adresSec(rows);
      // Adres import'u hiçbir şeyi silmediği için burada durdurmaz, yalnız uyarır.
      const adresOzet = adresOzeti(rows);
      if (adresOzet.okumaArizasi.length) console.warn('[pull/cari-adres] okuma arızası:', adresOzet.not);

      const companyId = await C.reqCompanyId(req);
      const leadsSnap = await C.getAdminDb().collection('leads').where('mikroCariKod', '!=', '').get();
      let updated = 0, skipped = 0, yabanciAtlanan = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };

      for (const leadDoc of leadsSnap.docs) {
        const veri = leadDoc.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) { yabanciAtlanan++; continue; }
        const cariKod = String(veri.mikroCariKod ?? '').trim();
        const adres = cariKod ? byKod.get(cariKod) : undefined;
        if (!adres) { skipped++; continue; }

        // SADECE BOŞ ALANLARI DOLDURUR (EKLE, YERİNE KOYMA) + kaynak izi
        // (`addressSource: 'mikro-heuristic'` — "en düşük adres no = varsayılan" TAHMİNDİR,
        // Mikro'da doğrulanmış bir kural değil; Satış Bölgesi otomatik ataması bu alanı
        // okuyacak, task #31). "Boş" sayılan: undefined/null/'' ve YALNIZ BOŞLUKTAN
        // oluşan değer — salt falsy kontrolü ' ' gibi anlamsız-ama-truthy değeri "zaten
        // dolu" sanıp doldurmayı atlıyordu (code-review bulgusu). Kural + gerekçeler TEK
        // KAYNAKTA: server/mikro/eslemeCari.ts (Mikro'dan gelen değer orada ayrıca
        // kırpılır ve yalnız boşluktan oluşan Mikro değeri yazılmaz).
        const guncelleme = adresGuncellemesi(veri, adres);
        if (!guncelleme) { skipped++; continue; }

        batch.set(leadDoc.ref, guncelleme, { merge: true });
        ops++; updated++;
        if (ops >= 400) await flush();
      }
      await flush();

      const ozet = `${updated} cari adresi dolduruldu (Mikro'dan ${rows.length} adres satırı, ${yabanciAtlanan} yabancı kiracı atlandı)`;
      await C.writeSyncLog('SQL:CARI_HESAP_ADRESLERI', 'leads', ozet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Cari Adres Çekme', ozet);
      // Okuma arızası uyarısı notun BAŞINA gelir (kural).
      res.json({ success: true, total: leadsSnap.size, updated, skipped, yabanciAtlanan,
                 mikroRows: rows.length, duration: Date.now() - t0,
                 note: [adresOzet.not, `${updated} dolduruldu, ${skipped} atlandı`].filter(Boolean).join(' — ') });
    } catch (err) {
      console.error('[pull/cari-adres]', err);
      res.status(500).json({ success: false, error: 'Adres çekimi başarısız. Hiçbir adres değiştirilmedi.' });
    }
  });

  // ── Mikro Pull: Mizan (Trial Balance) ───────────────────────────────────────
  // POST /api/mikro/pull/mizan  — aylık mizan → accountingPeriods
  // Body: { period?: 'YYYY-MM' }
  //
  // 2026-07-30'da YENİDEN YAZILDI: eski hali `MizanV2` çağırıyordu, o metot
  // V17'de YOK. Artık SqlVeriOkuV2 ile MUHASEBE_FIS_DETAYLARI üzerinden hesap
  // bazında borç/alacak toplamı alınıyor.
  //
  // Kolon adları TAHMİN EDİLMİYOR: INFORMATION_SCHEMA'dan okunup regex ile
  // eşleştiriliyor (mikroKolonlar/kolonBul). Eşleşme bulunamazsa hangi kolonun
  // bulunamadığını söyleyip 502 döner — sessizce boş/yanlış mizan yazmaz.
  app.post('/api/mikro/pull/mizan', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    const t0 = Date.now();
    try {
      const now    = new Date();
      const period = (req.body?.period as string) || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ success: false, error: 'period YYYY-MM olmalı.' });
      const [yil, ay] = period.split('-').map(Number);
      const ilkTarih  = `${yil}-${String(ay).padStart(2,'0')}-01`;
      const lastDay   = new Date(yil, ay, 0).getDate();
      const sonTarih  = `${yil}-${String(ay).padStart(2,'0')}-${lastDay}`;

      const cols     = await mikroKolonlar('MUHASEBE_FISLERI');
      if (!cols.length) return res.status(502).json({ success: false, error: 'MUHASEBE_FISLERI tablosu okunamadı (SqlVeriOkuV2 izni?).' });
      // Mikro'da ayrı borç/alacak kolonu YOK: fis_meblag0 İŞARETLİ tutulur
      // (borç +, alacak −). MUHASEBE_FISLERI_OZET'teki mfo_Grp0_B_Meblag /
      // mfo_Grp0_A_Meblag ayrımı bu kuralı bağımsız olarak doğruluyor.
      // Grup 0 = genel muhasebe seti (1-6 mali/UFRS/enflasyon alternatifleri).
      const hesapCol  = kolonBul(cols, /hesap_kod/i);
      const meblagCol = kolonBul(cols, /meblag0$/i);
      const tarihCol  = kolonBul(cols, /tarih$/i);
      const iptalCol  = kolonBul(cols, /_iptal$/i);
      if (!hesapCol || !meblagCol) {
        return res.status(502).json({ success: false,
          error: `Mizan kolonları eşleşmedi (hesap=${hesapCol}, meblağ=${meblagCol}). Hiçbir şey yazılmadı.` });
      }
      for (const c of [hesapCol, meblagCol, tarihCol, iptalCol].filter(Boolean)) {
        if (!sqlTanimlayici(c)) return res.status(500).json({ success: false, error: 'Geçersiz kolon adı.' });
      }

      const kosul: string[] = [];
      if (tarihCol) kosul.push(`${tarihCol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`);
      if (iptalCol) kosul.push(`ISNULL(${iptalCol}, 0) = 0`)   /* ISNULL: sabit kardesler (1530/1574/1593) ile ayni kural; hakem 2026-09-24 */;   // iptal edilmiş fişler mizana girmez
      const where = kosul.length ? ` WHERE ${kosul.join(' AND ')}` : '';
      const { rows, hata } = await mikroSql(
        `SELECT ${hesapCol} AS hesapKodu, ` +
        `SUM(CASE WHEN ${meblagCol} > 0 THEN ${meblagCol} ELSE 0 END) AS borc, ` +
        `SUM(CASE WHEN ${meblagCol} < 0 THEN -${meblagCol} ELSE 0 END) AS alacak ` +
        `FROM MUHASEBE_FISLERI${where} GROUP BY ${hesapCol} ORDER BY ${hesapCol}`,
      );
      if (hata) return res.status(502).json({ success: false, error: `Mizan sorgusu başarısız: ${hata}. Hiçbir şey yazılmadı.` });

      // Gövde/eşleme TEK KAYNAKTA: src/server/mikro/raporKdvMizan.ts (mizanSatirlari).
      // Okunamayan borç/alacak 0 DEĞİL null; bakiye de null (eski kod çöp değerde NaN yazıyordu).
      const mizan = mizanSatirlari(rows);
      const satirlar = mizan.satirlar;
      if (mizan.ozet.okumaArizasi.length) {
        console.warn('[pull/mizan] okuma arızası:', mizan.ozet.okumaArizasi.join(', '), '— kolon adı/şema kontrol edin');
      }

      // Hiç satır yoksa BOŞ MİZAN YAZMA. Bu "dönemde hareket yok" da olabilir,
      // "muhasebe modülü hiç kullanılmıyor / yanlış tablo" da — ikisi arasında
      // ayrım yapamadığımız için var olan mizanı boşla ezmek kabul edilemez.
      if (!satirlar.length) {
        return res.status(502).json({ success: false,
          error: `${period} döneminde MUHASEBE_FISLERI'nde hiç kayıt bulunamadı. ` +
                 `Muhasebe fişleri Mikro'ya işlenmiyor olabilir — mizan DEĞİŞTİRİLMEDİ.` });
      }

      // ÇİFT TARAFLI KAYIT DENETİMİ — mizan tanımı gereği borç toplamı alacak
      // toplamına EŞİT olmalıdır. Tutmuyorsa işaret varsayımım (meblag>0=borç)
      // ya da grup seçimi yanlış demektir; yanlış mizan yazmaktansa dur.
      const toplam = mizanToplami(satirlar);
      if (toplam.hata) {
        // İki "dur" hâli: (a) tutarı okunamayan satır var → 0 sayılan satırlarla denge
        // HİÇBİR ŞEY İSPAT ETMEZ (eski kod böyle "dengeli" deyip eksik mizan yazıyordu);
        // (b) bilinen toplamlar tutmuyor → işaret/grup varsayımı yanlış.
        if (toplam.bilinmeyenSatir) console.warn('[pull/mizan]', toplam.hata);
        return res.status(502).json({ success: false, error: toplam.hata, note: mizan.ozet.not || null });
      }
      const toplamBorc = toplam.borc, toplamAlacak = toplam.alacak;

      await C.getAdminDb().collection('accountingPeriods').doc(period).set({
        companyId: await C.reqCompanyId(req),
        period, yil, ay, rows: satirlar,
        toplam: { borc: toplamBorc, alacak: toplamAlacak },
        kaynak: `SQL:MUHASEBE_FISLERI (${hesapCol}/${meblagCol}, işaretli meblağ, denge doğrulandı)`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      // Sayaç senkron geçmişine de düşsün (kdvOzet ile aynı gerekçe): hesap kodu
      // okunamadığı için DÜŞEN satırlar yalnız o anki yanıtta değil, `syncLogs`te de görünsün.
      const mizanOzet = `${period} dönemi — ${satirlar.length} hesap satırı` +
                        (mizan.ozet.not ? ` · ${mizan.ozet.not}` : '');
      await C.writeSyncLog('SQL:MUHASEBE_FISLERI', 'accountingPeriods', mizanOzet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Mizan Çekme', mizanOzet);
      res.json({ success: true, period, rowCount: satirlar.length, note: mizan.ozet.not || null, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/mizan]', err);
      res.status(500).json({ success: false, error: 'Mizan çekimi başarısız. Hiçbir şey yazılmadı.' });
    }
  });
}
