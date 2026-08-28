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
 * SQL_IMPORT_TANIMLARI), MIKRO_PUSH_WHITELIST, stokMiktarJobRunning,
 * firstArrayIn.
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
import cron from 'node-cron';
import { timingSafeEqual } from 'crypto';
import { findKey, kolonSec } from '../../lib/mikroKolon.js';
import {
  MIKRO_API_BASE, MIKRO_JUMP_SURUM, MIKRO_LOCAL_MODE, detectMikroGatewayBlock,
  getMikroCreds, mikroBugun, mikroData, mikroHata, mikroKolonlar, mikroPost,
  mikroSatirlar, mikroSatisFiyatlari, mikroSql, mikroStokMiktari,
  mikroVergiOranlari, sqlTarih, vergiOraniCoz, kolonBul, sqlTanimlayici,
} from '../mikroClient.js';
import {
  CHA_COLS, STH_COLS, FIS_COLS, SIP_COLS, mirrorMikroCariler, mirrorMikroInsert,
  mirrorMikroStoklar,
} from '../mikroMirror.js';
import { pgServerTimestamp } from '../pgShim.js';


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
    const t0 = Date.now();

    try {
      const prices = (item.prices as Record<string, number>) || {};
      const stok = {
        sto_kod:              (item.sku  as string) || `STK${Date.now()}`,
        sto_isim:             (item.name as string) || '',
        sto_kisa_ismi:        ((item.name as string) || '').substring(0, 24),
        sto_cins:             0,
        sto_doviz_cinsi:      0,
        sto_birim1_ad:        'ADET',
        sto_perakende_vergi:  20,
        sto_toptan_vergi:     20,
        satis_fiyatlari: [
          { sfiyat_listesirano: 1, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['Retail']       || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 2, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['B2B Standard'] || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 3, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['B2B Premium']  || 0, sfiyat_doviz: 0 },
          { sfiyat_listesirano: 4, sfiyat_deposirano: 1, sfiyat_odemeplan: 0, sfiyat_birim_pntr: 1, sfiyat_fiyati: prices['Dealer']       || 0, sfiyat_doviz: 0 },
        ].filter(p => p.sfiyat_fiyati > 0),
      };

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

      res.json({ success, mikroStoKod, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('StokKaydetV2', 'inventory', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
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
        for (const s of stoklar) {
          const sku = s.sto_kod as string;
          if (!sku) continue;
          const snap = await C.getAdminDb().collection('inventory').where('sku', '==', sku).limit(1).get();
          if (!snap.empty) {
            const qty = mikroStokMiktari(s);
            await snap.docs[0].ref.update({
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

    const { lead, firebaseId, collection: targetCollection = 'leads' } = req.body as { lead: Record<string, unknown>; firebaseId: string; collection?: 'leads' | 'suppliers' };
    const t0 = Date.now();

    try {
      const cariKod = (lead.mikroCariKod as string) || `CAR${(firebaseId || Date.now().toString()).substring(0, 6).toUpperCase()}`;
      const contactName = (lead.contactName as string) || '';
      const nameParts   = contactName.split(' ');

      const cari = {
        cari_kod:                    cariKod,
        cari_unvan1:                 (lead.company  as string) || (lead.name as string) || '',
        cari_unvan2:                 '',
        cari_vdaire_no:              (lead.taxId     as string) || (lead.taxNo as string) || (lead.vkn as string) || '',
        cari_vdaire_adi:             (lead.taxOffice as string) || '',
        cari_EMail:                  (lead.email     as string) || '',
        cari_CepTel:                 (lead.phone     as string) || '',
        cari_efatura_fl:             (lead.eFaturaKayitli as boolean) ? 1 : 0,
        cari_def_efatura_cinsi:      0,
        cari_doviz_cinsi1:           0,
        cari_doviz_cinsi2:           255,
        cari_doviz_cinsi3:           255,
        cari_KurHesapSekli:          1,
        cari_sevk_adres_no:          0,
        cari_fatura_adres_no:        0,
        adres: [{
          adr_cadde:          (lead.address  as string) || '',
          adr_ilce:           (lead.district as string) || '',
          adr_il:             (lead.city     as string) || '',
          adr_ulke:           'TÜRKİYE',
          adr_tel_ulke_kodu:  '090',
          adr_tel_bolge_kodu: '',
          adr_tel_no1:        (lead.phone    as string) || '',
          adr_posta_kodu:     0,
          yetkili: contactName ? [{
            mye_isim:         nameParts[0]  || '',
            mye_soyisim:      nameParts.slice(1).join(' ') || '',
            mye_email_adres:  (lead.email as string) || '',
            mye_cep_telno:    (lead.phone as string) || '',
            mye_dahili_telno: '',
          }] : [],
        }],
      };

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
        });
      }

      res.json({ success, cariKod, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('CariKaydetV2', targetCollection === 'suppliers' ? 'supplier' : 'lead', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
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
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !leadByName.has(nameKey)) leadByName.set(nameKey, d.ref);
      }

      let yeni = 0, guncel = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };
      for (const c of cariler) {
        const kod = (c.cari_kod as string)?.trim();
        if (!kod) continue;
        const fields = {
          name: (c.cari_unvan1 as string) || kod,
          company: (c.cari_unvan1 as string) || '',
          email: (c.cari_EMail as string) || '',
          phone: (c.cari_CepTel as string) || '',
          taxId: (c.cari_vdaire_no as string) || '',
          taxOffice: (c.cari_vdaire_adi as string) || '',
          eFaturaKayitli: Number(c.cari_efatura_fl) === 1,
          type: Number(c.cari_hareket_tipi ?? 0) === 1 ? 'Supplier' : 'Customer',
          mikroCariKod: kod,
          mikroSynced: true, mikroSyncedAt: pgServerTimestamp(),
          companyId,
        };
        const vkn = vknNorm(fields.taxId);
        const nameKey = fields.name.trim().toLowerCase();
        const ref = leadByKod.get(kod)
          || (vkn ? leadByVkn.get(vkn) : undefined)
          || (nameKey ? leadByName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, fields); guncel++; }
        else {
          const newRef = C.getAdminDb().collection('leads').doc();
          batch.set(newRef, { ...fields, status: 'Active', source: 'mikro_import', createdAt: pgServerTimestamp() });
          leadByKod.set(kod, newRef);
          yeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();

      const duration = Date.now() - t0;
      const ozet = `${cariler.length} cari çekildi — ${yeni} yeni, ${guncel} güncellendi${tavanaCarpti ? ' — SAYFA TAVANINA ÇARPTI, veri eksik' : ''}`;
      await C.writeSyncLog('CariListesiV2', 'lead', ozet, true, null, null, duration, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Cari Listesi Çekme', ozet);
      res.json({ success: true, count: cariler.length, created: yeni, updated: guncel,
                 ...(tavanaCarpti ? { truncated: true, limit: MAKS_SAYFA * SAYFA } : {}), duration });
    } catch (err) {
      console.error('Mikro CariListesiV2 hatası:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /api/mikro/siparis/kaydet — push order → Mikro SiparisKaydetV2 */
  app.post('/api/mikro/siparis/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });

    const { order, firebaseId } = req.body as { order: Record<string, unknown>; firebaseId: string };
    const t0 = Date.now();

    try {
      const lineItems = (order.lineItems || []) as Record<string, unknown>[];
      if (lineItems.length === 0) {
        return res.status(400).json({ success: false, error: 'Sipariş satırı bulunamadı.' });
      }

      // Format date as dd.MM.yyyy for Mikro
      const rawDate   = order.createdAt ? new Date(order.createdAt as string) : new Date();
      const orderDate = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;

      const satirlar = lineItems.map((item: Record<string, unknown>) => ({
        sip_tarih:        orderDate,
        // sip_tip='0' → SATIŞ (2026-08-22 denetim bulgusu C14). Eskiden '1' idi
        // ('1' = ALIŞ/verilen sipariş). Bu uç bir MÜŞTERİ satış siparişini
        // Mikro'ya yazıyor; okuma tarafı satışı tip 0 sayıyor
        // (OrdersPage.tsx:209, DashboardPage.tsx:145), tip 1'i satın alma
        // (PurchasingModule.tsx:76). '1' yazınca resmi satış Mikro'da alış
        // siparişi oluyor VE Cetpa satış ekranında hiç görünmüyordu.
        sip_tip:          '0',
        sip_cins:         '0',
        sip_evrakno_seri: 'T',
        sip_musteri_kod:  (order.mikroCariKod as string) || '',
        sip_stok_kod:     (item.sku as string) || (item.productId as string) || '',
        sip_b_fiyat:      Number((item.unitPrice as number) || (item.price as number) || 0),
        sip_miktar:       Number((item.quantity as number)  || 1),
        sip_tutar:        Number((item.total    as number)  || ((item.unitPrice as number || 0) * (item.quantity as number || 1))),
        sip_vergi_pntr:   4,     // 20% KDV (adjust per product if needed)
        sip_depono:       1,
        sip_vergisiz_fl:  false,
      }));

      // inMikro: V17 evrak kalıbı — payload (evraklar) Mikro objesi İÇİNDE gider.
      const { ok, data, status } = await mikroPost('SiparisKaydetV2', {
        evraklar: [{ satirlar }],
      }, true);

      const duration = Date.now() - t0;
      const envelope = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0 = envelope?.[0] as Record<string, unknown> | undefined;
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroEvrakNo = (md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
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

      res.json({ success, mikroEvrakNo, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('SiparisKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      console.error('Mikro SiparisKaydetV2 hatası:', err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro Full Import Routes ─────────────────────────────────────────────────
  // These UPSERT — create new Firebase docs for items that don't exist yet,
  // update existing ones. Paginates automatically until all records are fetched.

  /** POST /api/mikro/import/stok — import ALL Mikro stock → Firebase inventory */
  app.post('/api/mikro/import/stok', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId (= uid of the account owner) — the app's
    // inventory listener filters on it, so imports MUST set it or items are invisible.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    // Snapshot'lar aşağıda zaten çekiliyor; çözücüler ONLARIN id'lerinden
    // kurulur — aynı koleksiyonu istek başına iki kez tam gövdeyle taramamak
    // için (2026-08-22 verimlilik bulgusu).
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

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    let skippedRecords = 0;
    /** Mikro'dan en az bir satış fiyatı gelen ürün sayısı (özet raporlanır). */
    let fiyatliUrun = 0;

    try {
      // Prefetch ALL inventory docs → Map<sku, ref>. ETİKETSİZ (companyId boş)
      // eski kayıtlar bilerek dahil — SKU ile eşleşip iyileştirilir (companyId
      // yazılır), çoğaltılmaz. Ama BAŞKA kiracıya ait (companyId DOLU ve farklı)
      // kayıt haritaya HİÇ girmez: aşağıdaki `batch.update(existingRef, item)`
      // item.companyId'yi KOŞULSUZ yazıyor — filtre olmasa eşleşen yabancı doküman
      // bu kiracıya SESSİZCE devredilirdi (2026-08-11'de bulundu; en sık kullanılan
      // "Stokları İçeri Al" düğmesi). Yabancı SKU haritada yoksa YENİ doküman
      // açılır — kiracı başına ayrı kayıt, doğru multi-tenant davranışı.
      const existingSnap = invSnapOnce;   // yukarıda bir kez çekildi
      const existingBySku = new Map<string, AdminDocRef>();
      for (const docSnap of existingSnap.docs) {
        const veri = docSnap.data() as Record<string, unknown>;
        const dc = (veri.companyId as string | undefined) || '';
        if (dc && dc !== companyId) continue;
        const sku = (veri.sku as string)?.trim();
        if (sku && !existingBySku.has(sku)) existingBySku.set(sku, docSnap.ref);
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
      // Mikro bazı sayfa aralıklarında düz metin "Api Server Error" döner
      // (kayıt bazlı serileştirme hatası, sunucu tarafında). Bozuk aralık
      // 100 → 20 → 5 → 1 şeklinde daraltılır; yalnızca gerçekten bozuk tekil
      // kayıtlar atlanır. Index = offset / size (Mikro Index sayfa numarasıdır).
      const fetchRange = async (offset: number, size: number): Promise<Record<string, unknown>[] | null> => {
        const { ok, data } = await mikroPost('StokListesiV2', {
          StokKod: '', TarihTipi: 2,
          IlkTarih: '2000-01-01',
          SonTarih: `${new Date().getFullYear() + 1}-12-31`,
          Sort: 'sto_kod', Size: String(size), Index: offset / size,
        });
        if (!ok || typeof data === 'string') return null; // "Api Server Error" vb.
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (!r0 || r0.IsError) return null;
        const rows = mikroData(data).StokListesi;
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
      };

      const SUB: Record<number, number> = { 100: 20, 20: 5, 5: 1 };
      const collectRange = async (offset: number, size: number): Promise<{ rows: Record<string, unknown>[]; end: boolean }> => {
        const direct = await fetchRange(offset, size);
        if (direct !== null) return { rows: direct, end: direct.length < size };
        if (size === 1) {
          skippedRecords++;
          console.warn(`Stok import: kayıt #${offset} atlandı (Mikro Api Server Error)`);
          return { rows: [], end: false };
        }
        const sub = SUB[size];
        const out: Record<string, unknown>[] = [];
        let end = false;
        for (let o = offset; o < offset + size; o += sub) {
          const r = await collectRange(o, sub);
          out.push(...r.rows);
          end = r.end; // son alt-aralığın end durumu belirleyicidir
        }
        return { rows: out, end };
      };

      const CHUNK = 100;
      let offset = 0;
      let reachedEnd = false;
      while (!reachedEnd && offset < 50000) {
        const { rows: stoklar, end } = await collectRange(offset, CHUNK);
        void mirrorMikroStoklar(stoklar);
        reachedEnd = end;
        offset += CHUNK;
        if (stoklar.length === 0) { if (end) break; else continue; }

        for (const s of stoklar) {
          const sku = (s.sto_kod as string)?.trim();
          if (!sku) continue;

          try {
            // Map Mikro fields → Cetpa InventoryItem shape.
            // Fiyat mantığı ortak yardımcıda (cron import'u ile ayrışmasın).
            const prices = mikroSatisFiyatlari(s);
            if (Object.keys(prices).length) fiyatliUrun++;

            // Miktar alanı yoksa null — mevcut kaydın stockLevel'i EZİLMEZ
            // (bkz. mikroStokMiktari). Yeni kayıtta 0 ile açılır, miktar
            // /api/mikro/import/stok-miktar koşusunda dolar.
            const qty = mikroStokMiktari(s);
            const kdvOran = vergiOraniCoz(s.sto_perakende_vergi, vergiTablosu);
            const item = {
              companyId,
              sku,
              name:             (s.sto_isim as string)     || sku,
              category:         (s.sto_grup_isim as string) || (s.sto_grup_kodu as string) || 'Genel',
              unit:             (s.sto_birim1_ad as string) || 'ADET',
              // sto_perakende_vergi İNDEKStir, yüzde değil (bkz. vergiOraniCoz).
              ...(kdvOran !== null ? { vatRate: kdvOran } : {}),
              ...(qty !== null ? { stockLevel: qty } : {}),
              lowStockThreshold: 5,
              // Fiyat gelmediyse `prices`e DOKUNMA. Eskiden koşulsuz `prices` (boş
              // olabilen nesne) yazılıyordu: Mikro fiyat döndürmediği her senkronda
              // elle girilmiş fiyatlar `{}` ile eziliyordu — stockLevel/vatRate'te
              // düzeltilen sessiz-sıfır arıza sınıfının aynısı.
              ...(Object.keys(prices).length ? { prices, price: prices['Retail'] ?? 0 } : {}),
              mikroStoKod:      sku,
              mikroSynced:      true,
              source:           'mikro_import',
              mikroSyncedAt:    pgServerTimestamp(),
            };

            // Upsert via batch: update if exists, create if not
            const existingRef = existingBySku.get(sku);
            if (existingRef) {
              batch.update(existingRef, item);
              updated++;
            } else {
              const newRef = C.getAdminDb().collection('inventory').doc();
              batch.set(newRef, { stockLevel: 0, ...item, createdAt: pgServerTimestamp() });
              existingBySku.set(sku, newRef); // guard against duplicate SKUs across pages
              created++;
            }
            batchOps++;

            categorySet.add(item.category);

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
              productName: item.name,
              sku,
              // Miktar bilinmiyorsa depo kaydının quantity'sini de EZME.
              ...(qty !== null ? { quantity: qty } : {}),
              ...(yerKod ? { warehouseId: `mikro-depo-${yerKod}` } : {}),
              location:    depoAdi,
              category:    item.category,
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

        console.log(`Stok import: offset ${offset} — toplam ${created + updated} işlendi${skippedRecords ? `, ${skippedRecords} bozuk kayıt atlandı` : ''}`);
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
      await C.writeSyncLog('ImportStok', 'inventory', `${created} yeni / ${updated} güncel — ${fiyatNot}${skippedRecords ? ` / ${skippedRecords} bozuk atlandı` : ''}`, true, null, null, duration, C.reqActor(req));
      console.log(`Stok import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, ${fiyatNot}, hata: ${errors}, bozuk atlanan: ${skippedRecords}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, skippedRecords, fiyatliUrun, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('ImportStok', 'inventory', 'bulk', false, null, errorMsg, duration, C.reqActor(req));
      console.error('Stok import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
  });

  /** POST /api/mikro/import/cari — import ALL Mikro cari → Firebase leads */
  app.post('/api/mikro/import/cari', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });

    // Data is scoped by companyId — the app's leads listener filters on it.
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);

    const t0 = Date.now();
    let created = 0, updated = 0, errors = 0;
    const PAGE_SIZE = 500;
    let index = 0;
    let hasMore = true;

    try {
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
        const nameKey = ((data.name as string) || (data.company as string) || '').trim().toLowerCase();
        if (nameKey && !existingByName.has(nameKey)) existingByName.set(nameKey, docSnap.ref);
      }

      let batch = C.getAdminDb().batch();
      let batchOps = 0;
      const commitBatch = async () => {
        if (batchOps > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); batchOps = 0; }
      };

      while (hasMore) {
        const { ok, data } = await mikroPost('CariListesiV2', {
          FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi,cari_muh_kod',
          WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
          Sort: 'cari_kod', Size: String(PAGE_SIZE), Index: index,
        });

        if (!ok) break;

        const cariler = (mikroData(data).CariListesi ?? []) as Record<string, unknown>[];
        void mirrorMikroCariler(cariler);
        if (!Array.isArray(cariler) || cariler.length === 0) break;

        for (const c of cariler) {
          const cariKod = (c.cari_kod as string)?.trim();
          if (!cariKod) continue;

          try {
            const unvan = (c.cari_unvan1 as string) || cariKod;
            // Determine if customer (0) or supplier (1) from hareket_tipi
            const hareketTipi = Number(c.cari_hareket_tipi ?? 0);
            const leadType = hareketTipi === 1 ? 'Supplier' : 'Customer';

            const lead = {
              companyId,
              mikroCariKod:   cariKod,
              company:        unvan,
              name:           unvan,
              email:          (c.cari_EMail   as string) || '',
              phone:          (c.cari_CepTel  as string) || '',
              taxId:          (c.cari_vdaire_no  as string) || '',
              taxOffice:      (c.cari_vdaire_adi as string) || '',
              eFaturaKayitli: Number(c.cari_efatura_fl) === 1,
              type:           leadType,
              status:         'Active',
              mikroSynced:    true,
              source:         'mikro_import',
              mikroSyncedAt:  pgServerTimestamp(),
            };

            // Upsert oncelik sirasi: mikroCariKod (zaten Mikro'yla eslesmis) ->
            // VKN (en guvenilir kimlik) -> case-insensitive isim.
            const vkn = normalizeVkn(lead.taxId);
            const nameKey = unvan.trim().toLowerCase();
            const existingRef = existingByKod.get(cariKod)
              || (vkn ? existingByVkn.get(vkn) : undefined)
              || (nameKey ? existingByName.get(nameKey) : undefined);

            const targetRef = existingRef ?? C.getAdminDb().collection('leads').doc();
            if (existingRef) {
              batch.update(targetRef, { ...lead, companyId }); // güncellemede de etiketle (self-heal)
              updated++;
            } else {
              batch.set(targetRef, { ...lead, companyId, createdAt: pgServerTimestamp() });
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

        hasMore = cariler.length === PAGE_SIZE;
        index += 1; // Mikro Index = sayfa numarası
        console.log(`Cari import: sayfa ${index} tamamlandı — toplam ${created + updated} işlendi`);
      }

      await commitBatch();

      const duration = Date.now() - t0;
      await C.writeSyncLog('ImportCari', 'lead', `${created} yeni / ${updated} güncel`, true, null, null, duration, C.reqActor(req));
      console.log(`Cari import tamamlandı — oluşturuldu: ${created}, güncellendi: ${updated}, hata: ${errors}, süre: ${duration}ms`);
      res.json({ success: true, created, updated, errors, duration });

    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('ImportCari', 'lead', 'bulk', false, null, errorMsg, duration, C.reqActor(req));
      console.error('Cari import genel hatası:', err);
      res.status(500).json({ success: false, error: errorMsg, created, updated, errors });
    }
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
    postProcess?: (rows: Record<string, unknown>[], companyId: string) => Promise<string | null>;
  };

  async function mikroSqlImportCalistir(
    opts: SqlImportOpts,
    companyId: string,
    ilkTarih: string,
    sonTarih: string,
    actor: { uid: string; email: string },
  ): Promise<{ ok: boolean; total: number; note: string | null; truncated: boolean; error?: string; duration: number; guidsizSatir?: number }> {
    const t0 = Date.now();
    // Kararli kimligi (GUID) olmayan satir sayisi — mukerrer kayit riski.
    let guidsizSatir = 0;
    const SAYFA = 500;
    const MAKS_SAYFA = 40; // 20.000 satır tavanı — sessiz değil, yanıtta bildirilir
    if (!C.getAdminDb()) return { ok: false, total: 0, note: null, truncated: false, error: 'Firebase Admin başlatılamadı.', duration: 0 };

    const kosullar: string[] = [];
    if (opts.ekKosul) kosullar.push(opts.ekKosul);
    if (opts.tarihKolonu) kosullar.push(`${opts.tarihKolonu} BETWEEN '${ilkTarih}' AND '${sonTarih}'`);
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
        const { rows, hata } = await mikroSql(
          `SELECT ${secim} FROM ${opts.tablo}${opts.fromEk ?? ''}${where} ` +
          `ORDER BY ${siralama} OFFSET ${offset} ROWS FETCH NEXT ${SAYFA} ROWS ONLY`,
        );
        if (hata) {
          // Başarısızsa hiçbir şey yazma — yarım/boş veri gerçek veriyi ezmesin.
          await C.writeSyncLog(`SQL:${opts.tablo}`, opts.collection, opts.label, false, null, hata, Date.now() - t0, actor);
          return { ok: false, total: 0, note: null, truncated: false, error: `${opts.label}: ${hata}`, duration: Date.now() - t0 };
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
            const { ok: sOk, data: sData } = await mikroPost('SqlVeriOkuV2', {
              SQLSorgu: `SELECT ${guidKolon} FROM ${anaTablo} WHERE ISNULL(${iptalKol}, 0) <> 0 `
                + `AND ${tarihKol} BETWEEN '${ilkTarih}' AND '${sonTarih}'`,
            });
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
      return { ok: false, total: 0, note: null, truncated: false, error: `${opts.label} başarısız.`, duration: Date.now() - t0 };
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
      const sonuc = await mikroSqlImportCalistir(
        opts,
        await C.reqCompanyId(req),
        sqlTarih(req.body?.ilkTarih, '2020-01-01'),
        sqlTarih(req.body?.sonTarih, mikroBugun()),
        C.reqActor(req),
      );
      if (!sonuc.ok) return res.status(502).json({ success: false, error: sonuc.error });
      res.json({ success: true, total: sonuc.total, note: sonuc.note, tablo: opts.tablo, guidsizSatir: sonuc.guidsizSatir ?? 0,
                 ...(sonuc.truncated ? { truncated: true, limit: 40 * 500 } : {}), duration: sonuc.duration });
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
    secim: 'cha.*, ISNULL(sat.kdv, ISNULL(cha.cha_meblag - cha.cha_aratoplam, 0)) AS kdvTutari, ISNULL(sat.matrah, ISNULL(cha.cha_aratoplam, 0)) AS matrah, sat.vergiPntr, sat.oranSayisi',
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
    postProcess: async (rows) => {
      const kdvli = rows.filter(r => Number(r.kdvTutari ?? 0) > 0).length;
      return `${kdvli}/${rows.length} faturada KDV eşleşti`;
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
    ekKosul: 'cha_iptal = 0',
    iptalKolonu: 'cha_iptal',
    tarihKolonu: 'cha_tarihi',
    collection: 'mikroCariHareketler', label: 'Mikro Cari Hareketleri',
    postProcess: async (rows) => {
      // PG aynası (off-server yedek + raporlama). Fatura import'uyla aynı tablo.
      await mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'cari_hareket_import' })), CHA_COLS);
      const borc = rows.filter(r => Number(r.cha_tip ?? 0) === 0).length;
      return `${borc} borç / ${rows.length - borc} alacak hareketi`;
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
    const secim = sthCols.length ? istenen.filter(c => sthSet.has(c.toLowerCase())) : istenen;
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

    try {
      const { rows, hata } = await mikroSql(
        `SELECT ${secim.map(c => `sth.${c}`).join(', ')}` +
        (adVar ? ', sto.sto_isim AS urunAdi' : '') + ' ' +
        'FROM STOK_HAREKETLERI sth ' +
        (adVar ? 'LEFT JOIN STOKLAR sto ON sto.sto_kod = sth.sth_stok_kod ' : '') +
        `WHERE sth.sth_evraktip = ${evrakTip} AND sth.sth_evrakno_sira = ${sira} ` +
        `AND ISNULL(sth.sth_evrakno_seri, '') = '${seri}' ` +
        `ORDER BY ${siralama}`,
      );
      if (hata) return res.status(502).json({ success: false, error: hata });
      res.json({ success: true, kalemler: rows, total: rows.length });
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
      for (const r of rows) {
        const sku = String(r[skuKey] ?? '').trim();
        const fiyat = Number(r[fiyKey]);
        // 0 ve negatif "fiyat YOK" sayılır — yazılırsa ekranda yine 0 TL görünür
        // ve elle girilmiş fiyatı ezer (bugün kapatılan sessiz-sıfır sınıfı).
        if (!sku || !Number.isFinite(fiyat) || fiyat <= 0) continue;
        const dov = dovKey ? Number(r[dovKey]) : 0;
        if (dovKey && Number.isFinite(dov) && dov !== 0) { atlananDoviz++; continue; }
        const tier = TIER[String(listKey ? r[listKey] ?? '1' : '1')] ?? 'Retail';
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
        batch.update(d.ref, {
          prices: birlesik,
          price: birlesik['Retail'] ?? mevcut['Retail'] ?? 0,
          // Bu import yalnız TL fiyat yazar (döviz satırları atlanır) — kademe
          // ne olursa olsun para birimi işaretini TL'ye SABİTLE. Aksi halde
          // kullanıcının ProductForm'dan seçtiği eski priceCurrency (ör. USD)
          // kalır ve ekran bu TL tutarı tekrar kurla çarpar (~kur katı yanlış).
          priceCurrency: 'TRY',
          mikroFiyatSyncedAt: pgServerTimestamp(),
        });
        eslesen++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${eslesen} ürünün fiyatı güncellendi (${bySku.size} SKU'da fiyat bulundu)` +
        (atlananDoviz ? ` — ${atlananDoviz} satır TL dışı döviz olduğu için atlandı` : '') +
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

      // SabitKiymetModule.tsx sözlük araması yapıyor — fallback YOK:
      //   KATEGORI_CFG[kategori].icon (satır 262), DURUM_CFG[durum].bg (satır 272)
      // `kategori`/`durum` bu iki sabit kümenin DIŞINDA bir değerse (Mikro grup
      // kodu ham metin, örn. "MK-01") ya da hiç yazılmazsa ekran ilk satırda
      // TypeError ile çöker — tam da BOM'da `components` eksikliğinin yarattığı
      // sınıf. Mikro grup kodu bu kümelerden biriyle BİREBİR eşleşmiyor (farklı
      // sözlük), o yüzden UYDURULMAZ: geçerli değilse 'Diğer'/'Aktif'e düşer, ham
      // Mikro değeri ayrı alanda (mikroGrupKodu) saklanır — veri kaybolmaz.
      const KATEGORI_GECERLI = new Set(['Taşıt', 'Makine', 'Bilgisayar', 'Mobilya', 'Bina', 'Diğer']);

      // Mevcut kayıtları bir kez oku: (a) YENİ dokümana zorunlu alanları varsayılanla
      // yaz (ekran çökmesin), (b) VAR OLAN dokümanda kullanıcının elle girdiği
      // durum/amortYontemi/departman gibi alanları EZME.
      const mevcutSnap = await C.tenantSnap('sabitKiymetler', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const dbsId = C.mikroIdCozucuIds(mevcutSnap.docs.map(d => d.id), companyId);
      const mevcut = new Map(mevcutSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));

      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      for (const r of rows) {
        const k = String(r[kod] ?? '').trim();
        if (!k) continue;
        const docId = dbsId(k.replace(/[/\\]/g, '_'));
        const eski = mevcut.get(docId);
        const grupHam = grup ? String(r[grup] ?? '').trim() : '';
        batch.set(C.getAdminDb().collection('sabitKiymetler').doc(docId), {
          companyId,
          demirbasNo: k,
          ad:          ad    ? String(r[ad] ?? '').trim() || k : k,
          kategori:    (eski?.kategori as string) || (KATEGORI_GECERLI.has(grupHam) ? grupHam : 'Diğer'),
          mikroGrupKodu: grupHam,             // ham Mikro grup kodu — kategori eşleşmese de kaybolmasın
          alisTarihi:  tarih ? String(r[tarih] ?? '').slice(0, 10) : '',
          alisBedeli:  bedel ? Number(r[bedel]) || 0 : 0,
          faydaliOmur: omur  ? Number(r[omur]) || 0 : 0,
          // UI SÖZLÜK ANAHTARLARI — eksikse ekran çöker (KategoriBadge/DurumBadge
          // fallback'siz). Yeni kayıtta varsayılan; mevcut kayıtta kullanıcı
          // değeri korunur.
          durum:           (eski?.durum as string) ?? 'Aktif',
          amortYontemi:    (eski?.amortYontemi as string) ?? 'Doğrusal',
          paraBirimi:      (eski?.paraBirimi as string) ?? 'TRY',
          birikmisSalinma: Number(eski?.birikmisSalinma) || 0,
          departman:       (eski?.departman as string) ?? '',
          mikroHam: r,                        // eşleme eksikse veri yine de durur
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      const eksik = [!ad && 'ad', !tarih && 'alisTarihi', !bedel && 'alisBedeli', !omur && 'faydaliOmur', !grup && 'kategori']
        .filter(Boolean).join(', ');
      if (!eksik) return `${yazilan} demirbaş sabitKiymetler'e yazıldı`;

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

      return `${yazilan} demirbaş sabitKiymetler'e yazıldı — kolonu çözülemeyen alanlar: ${eksik}`
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
      const mmId = await C.mikroIdCozucu('maliyetMerkezleri', companyId);
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
      for (const r of rows) {
        const k = String(r[kod] ?? '').trim();
        if (!k) continue;
        batch.set(C.getAdminDb().collection('maliyetMerkezleri').doc(mmId(k.replace(/[/\\]/g, '_'))), {
          companyId,
          kod: k,
          ad: ad ? String(r[ad] ?? '').trim() || k : k,
          aktif: true,
          mikroHam: r,
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      return `${yazilan} maliyet merkezi maliyetMerkezleri'ne yazıldı` + (ad ? '' : ' — ad kolonu çözülemedi (ham veri mikroHam\'da)');
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

    // 03:20 — gece yedeğinden (03:30) ÖNCE bitsin diye erken.
    cron.schedule('20 3 * * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro SQL senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      // Son 90 gün: tam geçmişi her gece yeniden çekmek gereksiz yük.
      // İlk dolum elle (ERP Hub) yapılır; cron güncellemeyi taze tutar.
      const son = mikroBugun();
      const ilk = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      console.log(`Mikro SQL senkron başlıyor (${ilk} → ${son}, ${SQL_IMPORT_TANIMLARI.length} adım)`);
      let ok = 0, hata = 0;
      for (const opts of SQL_IMPORT_TANIMLARI) {
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
    // 02:00: gecelik SQL senkronundan (03:20) ve yedekten (03:30) ÖNCE biter.
    // Ayda bir olduğu için yükü kabul edilebilir.
    cron.schedule('0 2 1 * *', async () => {
      const companyId = await sqlSenkronHedefTenant();
      if (!companyId) return;
      if (!(await getMikroCreds())) { console.warn('Mikro TAM senkron: kimlik yok, atlandı.'); return; }
      const actor = { uid: 'system', email: '' };
      const son = mikroBugun();
      const ilk = '2000-01-01';   // tüm geçmiş
      console.log(`Mikro TAM senkron başlıyor (${ilk} → ${son}, ${SQL_IMPORT_TANIMLARI.length} adım)`);
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
   *  1700+ SKU = uzun iş → hemen { started: true } döner, ilerleme
   *  jobs/stokMiktarImport dokümanına canlı yazılır (panel onSnapshot ile izler).
   */
  let stokMiktarJobRunning = false;
  app.post('/api/mikro/import/stok-miktar', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    if (MIKRO_JUMP_SURUM < 17) {
      return res.status(501).json({
        success: false,
        error: 'Stok miktarı/maliyet çekimi GenelAmacliMaliyetListesiV2 gerektirir — bu method yalnız Mikro Jump V17+ kurulumlarında var. ' +
               'Mikro Jump V17 güncellemesi sonrası .env\'e MIKRO_JUMP_SURUM=17 ekleyin.',
        requiresVersion: 17, currentVersion: MIKRO_JUMP_SURUM,
      });
    }
    if (stokMiktarJobRunning) return res.json({ success: true, started: false, alreadyRunning: true });

    const actor = C.reqActor(req);
    const jobRef = C.getAdminDb().collection('jobs').doc('stokMiktarImport');
    stokMiktarJobRunning = true;

    // Arka plan işi — yanıt hemen döner
    (async () => {
      const t0 = Date.now();
      let processed = 0, updated = 0, failed = 0;
      // Per-depo dağılımı otoriter toplamla tutmayan SKU sayısı (bkz. mutabakat kontrolü).
      let depoUyusmazlik = 0;
      /** Dağılımı yazılan ürün sayısı — hareketi olmayan ürün hiç kontrol edilmez. */
      let depoDagilimliUrun = 0;
      /** Dağılımına `__devir` kovası eklenen ürün sayısı (açılış stoğu defterde yok). */
      let depoDevirli = 0;
      const uyusmazlikOrnek: { sku: string; toplam: number; beklenen: number }[] = [];
      try {
        const invSnap = await C.getAdminDb()!.collection('inventory').where('source', '==', 'mikro_import').get();
        const items = invSnap.docs
          .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
          .filter(x => x.sku);
        const total = items.length;
        // companyId + depo listesi bir kez (döngü içinde tekrar tekrar değil).
        const companyId = await C.reqCompanyId(req);
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
            for (const row of perDepoRows) {
                const sku = String(row.sth_stok_kod ?? '').trim();
                const depoNo = String(row.depo ?? '');
                const bakiye = Number(row.bakiye ?? 0);
                if (!sku || !depoNo || bakiye === 0) continue;
                if (!depoMap.has(sku)) depoMap.set(sku, {});
                depoMap.get(sku)![depoNo] = bakiye;
            }
        }
        
        await jobRef.set({ running: true, processed: 0, updated: 0, failed: 0, total, startedAt: pgServerTimestamp(), finishedAt: null, error: null });

        const sonTarih = mikroBugun();
        const CONCURRENCY = 8;
        let batch = C.getAdminDb()!.batch(); let ops = 0;
        const commitBatch = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };

        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const slice = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map(async (it) => {
            const bos = { it, qty: null as number | null, cost: null as number | null, depoQtys: null as Record<string, number> | null,
                          uyusmazlik: null as { sku: string; toplam: number; beklenen: number } | null,
                          devirli: false };
            try {
              // 1) Toplam (tüm depolar) — stockLevel + maliyet. AUTHORITATIVE, değişmez.
              const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
                StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: depoNos.join(','),
              });
              const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
              if (!ok || !r0 || r0.IsError) return bos;
              const d = (r0.Data ?? {}) as Record<string, unknown>;
              // Alan hiç yoksa "0 stok" DEĞİL, "yanıt okunamadı" demektir — 0 yazıp
              // başarılı saymak gerçek stoğu siler. Başarısıza düşür.
              if (d.EldekiMiktar == null) return bos;
              const qty = Number(d.EldekiMiktar);
              if (!Number.isFinite(qty)) return bos;
              const totalCost = Number(d.MaliyetBedeli ?? 0);
              const cost = qty > 0 ? totalCost / qty : null;

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

              return { it, qty, cost, depoQtys, uyusmazlik, devirli };
            } catch { return bos; }
          }));

          for (const r of results) {
            processed++;
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
              ...(r.cost !== null ? { costPrice: Math.round(r.cost * 100) / 100 } : {}),
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
            await jobRef.set({ running: true, processed, updated, failed, total }, { merge: true });
          }
        }
        await commitBatch();
        const duration = Date.now() - t0;
        await jobRef.set({
          running: false, processed, updated, failed,
          // Panel bunu gösterir. depoDagilimliUrun ŞART: hareketi olmayan ürün hiç
          // kontrol edilmediği için "uyuşmazlık 0" tek başına "hepsi doğrulandı"
          // ANLAMINA GELMEZ — kapsamı da göstermeliyiz.
          depoUyusmazlik, depoDagilimliUrun, depoDevirli, uyusmazlikOrnek,
          finishedAt: pgServerTimestamp(), durationMs: duration,
        }, { merge: true });
        const depoNot =
          `, ${depoDagilimliUrun} üründe depo dağılımı yazıldı` +
          (depoDevirli > 0 ? ` (${depoDevirli}'inde devir kovası)` : '') +
          (depoUyusmazlik > 0 ? `, ${depoUyusmazlik} üründe toplam tutmadı (dağılım yazılmadı)` : '');
        const miktarOzet = `${updated} ürünün miktarı güncellendi, ${failed} hata${depoNot} (${Math.round(duration / 1000)}sn)`;
        await C.writeSyncLog('GenelAmacliMaliyetListesiV2', 'inventory', miktarOzet, failed === 0, null, failed ? `${failed} SKU okunamadı` : null, duration, actor);
        await C.writeAuditLog(actor, 'Mikro Stok Miktarları', miktarOzet);
        console.log(`Stok miktar import bitti: ${updated} güncellendi, ${failed} hata, depo uyuşmazlık ${depoUyusmazlik}, ${duration}ms`);
        if (uyusmazlikOrnek.length) console.warn('Depo dağılımı uyuşmazlık örnekleri:', uyusmazlikOrnek);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await jobRef.set({ running: false, error: msg, finishedAt: pgServerTimestamp() }, { merge: true }).catch(() => {});
        console.error('Stok miktar import hatası:', err);
      } finally {
        stokMiktarJobRunning = false;
      }
    })();

    res.json({ success: true, started: true });
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
   *
   *  2026-07-30: `CariHareketKaydetV2` çağırıyordu, o metot V17'de YOK.
   *  V17 karşılığı `DekontKaydetV2` — AYNI `cha_*` alanlarını alır, yalnız zarf
   *  farklı: alanlar Mikro objesi İÇİNDE `evraklar[].satirlar[]` altına girer
   *  (mikroPost'un inMikro=true kalıbı). Çağıranın gönderdiği `hareket` nesnesi
   *  olduğu gibi tek satır olarak sarmalanır — alan eşlemesi değişmedi.
   */
  app.post('/api/mikro/cari-hareket/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { hareket, aciklama } = req.body as { hareket: Record<string, unknown>; aciklama?: string };
    if (!hareket) return res.status(400).json({ success: false, error: 'hareket alanı zorunlu.' });
    const t0 = Date.now();
    try {
      const { ok, data, status } = await mikroPost('DekontKaydetV2', {
        evraklar: [{
          satirlar: [hareket],
          ...(aciklama ? { evrak_aciklamalari: [{ aciklama }] } : {}),
        }],
      }, true); // inMikro: V17 evrak kalıbı — alanlar Mikro objesi İÇİNDE
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await C.writeSyncLog('DekontKaydetV2', 'payment', String(hareket.cha_kod ?? 'unknown'), success, null, errorMsg, Date.now() - t0, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...hareket, __kaynak: 'hareket_push' }], CHA_COLS);
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
   */
  app.post('/api/mikro/yevmiye/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { entries } = req.body as { entries: Record<string, unknown>[] };
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'entries dizisi zorunlu.' });
    }
    const t0 = Date.now();
    const toTrDate = (iso: string) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
    const hesapKodu = (s: unknown) => String(s ?? '').trim().split(/\s|-/)[0] || '100';
    const syncedIds: string[] = [];
    const errors: { id: string; error: string }[] = [];
    try {
      for (const e of entries) {
        const meblag = Number(e.borc ?? e.alacak ?? 0) || 0;
        const satirBase = {
          fis_firmano: 0, fis_subeno: 0,
          fis_tarih: toTrDate(String(e.date ?? '')),
          fis_tur: 0,
          fis_sorumluluk_kodu: '', fis_ticari_tip: 0, fis_kurfarkifl: 0,
          fis_ticari_evraktip: 0, fis_tic_belgeno: String(e.fiş ?? e.fisNo ?? ''),
          fis_tic_belgetarihi: toTrDate(String(e.date ?? '')),
          fis_katagori: 0, fis_fmahsup_tipi: 0, user_tablo: [],
        };
        const { ok, data, status } = await mikroPost('MuhasebeFisKaydetV2', {
          evraklar: [{
            evrak_aciklamalari: [{ aciklama: String(e.aciklama ?? '') }],
            satirlar: [
              { ...satirBase, fis_hesap_kod: hesapKodu(e.debitHesap),  fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0:  meblag },
              { ...satirBase, fis_hesap_kod: hesapKodu(e.alacakHesap), fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0: -meblag },
            ],
          }],
        }, true);
        const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
        if (ok && r0 && !r0.IsError) {
          syncedIds.push(String(e.id));
          void mirrorMikroInsert('mikro_muhasebe_fisleri', [
            { ...satirBase, fis_hesap_kod: hesapKodu(e.debitHesap),  fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0:  meblag },
            { ...satirBase, fis_hesap_kod: hesapKodu(e.alacakHesap), fis_aciklama1: String(e.aciklama ?? ''), fis_meblag0: -meblag },
          ], FIS_COLS);
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
   *  Alan eşlemesi V17 örneğinden — DENEYSEL: ilk gerçek kayıtla doğrulanmalı.
   */
  app.post('/api/mikro/tahsilat/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const { tahsilat } = req.body as { tahsilat: Record<string, unknown> };
    if (!tahsilat?.cariKod || !tahsilat?.tutar) {
      return res.status(400).json({ success: false, error: 'cariKod ve tutar zorunlu.' });
    }
    const t0 = Date.now();
    const toTrDate = (iso: string) => { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; };
    const tip = tahsilat.tip === 'tediye' ? 'tediye' : 'tahsilat';
    try {
      const tahsilatSatiri = {
        cha_tarihi: toTrDate(String(tahsilat.tarih ?? new Date().toISOString().slice(0, 10))),
        cha_tip: tip === 'tahsilat' ? 1 : 0,
        cha_cinsi: 19,
        cha_normal_Iade: 0,
        cha_evrak_tip: 34,
        cha_evrakno_seri: tip === 'tahsilat' ? 'KSTAH' : 'KSTED',
        cha_cari_cins: 0,
        cha_kod: String(tahsilat.cariKod),
        cha_d_cins: 0, cha_d_kur: 1, cha_d_kurtar: null,
        cha_srmrkkodu: '', cha_projekodu: '',
        cha_kasa_hizmet: 4,
        cha_meblag: Number(tahsilat.tutar),
        cha_aciklama: String(tahsilat.aciklama ?? ''),
      };
      const { ok, data, status } = await mikroPost('TahsilatTediyeKaydetV2', {
        evraklar: [{
          evrak_aciklamalari: [{ aciklama: String(tahsilat.aciklama ?? '') }],
          satirlar: [tahsilatSatiri],
        }],
      }, true);
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      const success = ok && !!r0 && !r0.IsError;
      const errorMsg = success ? null : ((r0?.ErrorMessage as string) || `HTTP ${status}`);
      await C.writeSyncLog('TahsilatTediyeKaydetV2', 'payment', String(tahsilat.cariKod), success, null, errorMsg, Date.now() - t0, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_cari_hesap_hareketleri', [{ ...tahsilatSatiri, __kaynak: 'tahsilat_push' }], CHA_COLS);
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
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin başlatılamadı.' });
    // Kiracı = reqCompanyId, ham uid DEĞİL (gerekçe: reqCompanyId tanımı).
    const companyId = await C.reqCompanyId(req);
    if (MIKRO_JUMP_SURUM < 17) {
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
        "FROM CARI_HESAP_HAREKETLERI WHERE cha_evrak_tip = 63 AND cha_iptal = 0 ORDER BY cha_tarihi DESC";
      const { ok, data, status } = await mikroPost('SqlVeriOkuV2', { SQLSorgu: sql });
      const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
      if (!ok || !r0 || r0.IsError) {
        return res.status(502).json({ success: false, error: (r0?.ErrorMessage as string) || `HTTP ${status}` });
      }
      const rows = mikroSatirlar(data);
      void mirrorMikroInsert('mikro_cari_hesap_hareketleri',
        rows.map(r => ({ ...r, __kaynak: 'sql_import' })), CHA_COLS);
      let satis = 0, alis = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      for (const row of rows) {
        const guid = String(row.cha_Guid ?? '') || C.getAdminDb().collection('mikroFaturalar').doc().id;
        const yon = Number(row.cha_tip ?? 0) === 0 ? 'satis' : 'alis';
        yon === 'satis' ? satis++ : alis++;
        batch.set(C.getAdminDb().collection('mikroFaturalar').doc(guid), {
          ...row, yon, companyId,
          source: 'mikro_import',
          syncedAt: pgServerTimestamp(),
        }, { merge: true });
        if (++ops >= 450) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      await C.writeAuditLog(C.reqActor(req), 'Mikro Fatura Çekme', `${satis} satış + ${alis} alış faturası çekildi`);
      res.json({ success: true, total: rows.length, satis, alis, duration: Date.now() - t0 });
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
      if (iptalCol) kosul.push(`${iptalCol} = 0`);
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

      // Satır oranını gerçek yüzdeye çevir (pntr indekstir, yüzde değil).
      const vergiTablosu = await mikroVergiOranlari();
      let kdvHesaplanan = 0, kdvIndirilecek = 0;
      const kirilim: Array<{ yon: string; oran: number | null; kdv: number; matrah: number | null }> = [];
      for (const r of rows) {
        const kdv    = Number(r.kdv ?? 0);
        const matrah = r.matrah === undefined ? null : Number(r.matrah);
        const cikis  = Number(r.tip) === 1;          // 1 = çıkış = satış
        const oran   = pntrCol ? vergiOraniCoz(r.oranPntr, vergiTablosu) : null;
        if (!Number.isFinite(kdv)) continue;
        if (cikis) kdvHesaplanan += kdv; else kdvIndirilecek += kdv;
        kirilim.push({ yon: cikis ? 'satis' : 'alis', oran, kdv, matrah });
      }

      await C.getAdminDb().collection('taxSummary').doc(period).set({
        companyId: await C.reqCompanyId(req),
        period, yil, ay,
        kdvHesaplanan, kdvIndirilecek,
        kdvOdenmesi: Math.max(kdvHesaplanan - kdvIndirilecek, 0),
        devredenKdv: Math.max(kdvIndirilecek - kdvHesaplanan, 0),
        oranKirilimi: kirilim,
        kaynak: `SQL:STOK_HAREKETLERI (${vergiCol}${pntrCol ? '/' + pntrCol : ''}) — TÜRETİLMİŞTİR; tevkifat/iade/devreden KAPSAM DIŞI, beyan öncesi Mikro KDV raporuyla karşılaştırın`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      const kdvOzet = `${period} — hesaplanan ${kdvHesaplanan.toFixed(2)}, indirilecek ${kdvIndirilecek.toFixed(2)} (${kirilim.length} oran kırılımı)`;
      await C.writeSyncLog('SQL:STOK_HAREKETLERI(KDV)', 'taxSummary', kdvOzet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro KDV Özeti Çekme', kdvOzet);
      const kdvMatrahiSatis = kirilim.filter(k => k.yon === 'satis').reduce((acc, k) => acc + (k.matrah || 0), 0);
      res.json({ success: true, period, kdvHesaplanan, kdvIndirilecek,
                 kdvOdenmesi: Math.max(kdvHesaplanan - kdvIndirilecek, 0),
                 oranKirilimi: kirilim,
                 kdvMatrahi: kdvMatrahiSatis,
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
      // HRModule.tsx arama filtresi `e.position.toLowerCase()` / `e.department.toLowerCase()`
      // çağırıyor (fallback yok) — YENİ bir personel Mikro'da bu alanları boş
      // bırakmışsa alan hiç yazılmaz (yukarıdaki guard), doküman `undefined` ile
      // oluşur ve arama kutusuna yazılınca TypeError ile çöker (BOM'daki
      // `components` çökmesiyle aynı sınıf). Yalnız YENİ kayıtta '' varsayılanı
      // yaz; var olan kayda dokunma (mevcut değeri ezmeyelim).
      const mevcutEmpSnap = await C.tenantSnap('employees', companyId);
      // Aynı koleksiyonu ikinci kez ÇEKME — yukarıdaki snapshot'ın id'leri yeter.
      const empId = C.mikroIdCozucuIds(mevcutEmpSnap.docs.map(d => d.id), companyId);
      const mevcutEmpIds = new Set(mevcutEmpSnap.docs.map(d => d.id));
      let batch = C.getAdminDb().batch(); let ops = 0; let yazilan = 0;
      for (const r of rows) {
        const kod = String(r.mikroPersKod ?? '').trim();
        if (!kod) continue;
        const ad   = String(r.name ?? '').trim();
        const soy  = String(r.surname ?? '').trim();
        // Mikro durum kodu bilinmiyorsa 'Aktif' UYDURMA yerine gelen değeri
        // koru; yalnız kesin bilinen eşleşme çevrilir.
        const durum = String(r.status ?? '').trim();
        // SATIR BAZLI BOŞALTMA guard'ı: eskiden email/phone/department/... KOŞULSUZ
        // yazılıyordu. Kolon şemada bulunsa bile o PERSONELİN Mikro kaydında alan
        // boşsa (çok normal — herkes e-posta/departman girmemiş olabilir),
        // `String(undefined ?? '').trim()` boş string üretip HR'ın Cetpa'da elle
        // girdiği değeri her senkronda sessizce siliyordu. Artık Mikro'da değer
        // VARSA yazılır, yoksa alana hiç dokunulmaz (merge:true mevcut değeri korur).
        const email = String(r.email ?? '').trim();
        const phone = String(r.phone ?? '').trim();
        const dept  = String(r.department ?? '').trim();
        const pos   = String(r.position ?? '').trim();
        const sal   = Number(r.salary);
        const start = String(r.startDate ?? '').trim();
        const docId = empId(kod.replace(/[/\\]/g, '_'));
        const yeniKayit = !mevcutEmpIds.has(docId);
        batch.set(C.getAdminDb().collection('employees').doc(docId), {
          companyId,
          mikroPersKod: kod,
          name: [ad, soy].filter(Boolean).join(' ') || kod,
          tcId: String(r.tcId ?? '').trim() || null,
          ...(email ? { email } : (yeniKayit ? { email: '' } : {})),
          ...(phone ? { phone } : (yeniKayit ? { phone: '' } : {})),
          ...(dept  ? { department: dept } : (yeniKayit ? { department: '' } : {})),
          ...(pos   ? { position: pos } : (yeniKayit ? { position: '' } : {})),
          ...(Number.isFinite(sal) && sal > 0 ? { salary: sal } : (yeniKayit ? { salary: 0 } : {})),
          ...(start ? { startDate: start.slice(0, 10) } : (yeniKayit ? { startDate: '' } : {})),
          status:     durum === '0' || durum.toLowerCase() === 'aktif' ? 'Aktif' : durum || 'Aktif',
          source: 'mikro_import',
          mikroSyncedAt: pgServerTimestamp(),
        }, { merge: true });
        yazilan++;
        if (++ops >= 400) { await batch.commit(); batch = C.getAdminDb().batch(); ops = 0; }
      }
      if (ops > 0) await batch.commit();

      const ozet = `${yazilan} personel employees koleksiyonuna yazıldı` +
        (eksik.length ? ` — şemada bulunamayan alanlar atlandı: ${eksik.join(', ')}` : '');
      await C.writeSyncLog('SQL:PERSONEL_TANIMLARI', 'employees', ozet, true, null, null, 0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Personel', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan, cozulenAlanlar: cozulen, eksikAlanlar: eksik });
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
      const gruplar = new Map<string, Array<{ sku: string; quantity: number; unit: string }>>();
      for (const r of rows) {
        const ana = anaKod ? String(r[anaKod] ?? '').trim() : '';
        const alt = altKod ? String(r[altKod] ?? '').trim() : '';
        if (!ana || !alt) continue;   // eşleme çözülemediyse reçete satırı anlamsız
        const liste = gruplar.get(ana) ?? [];
        liste.push({
          sku: alt,
          quantity: miktarK ? Number(r[miktarK]) || 0 : 0,
          unit: birimK ? String(r[birimK] ?? '').trim() : '',
        });
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
          components: bilesenler.map(b => ({
            inventoryId: invBySku.get(b.sku)?.id || '',
            name: invBySku.get(b.sku)?.name || b.sku,
            sku: b.sku,
            quantity: b.quantity,
            unit: b.unit,
          })),
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
      const ozet = `${yazilan} ürün reçetesi (${rows.length} satırdan) bom koleksiyonuna yazıldı` +
        (cozulemeyen.length ? ` — kolonu çözülemeyen alanlar: ${cozulemeyen.join(', ')} (ham veri satır düzeyinde kaybolmuş olabilir)` : '');
      await C.writeSyncLog('SQL:STOK_URETIM_RECETELERI', 'bom', ozet, true, null, null, 0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Üretim Reçeteleri', ozet);
      res.json({ success: true, total: rows.length, note: ozet, written: yazilan, cozulemeyenAlanlar: cozulemeyen });
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

  /** Mikro'dan gelen e-belge satırını `eBelgeler` şemasına indirger.
   *  Alan adları sürüme göre değiştiği için regex ile aranır; bulunamayan alan
   *  BOŞ bırakılır, uydurulmaz. */
  function eBelgeNormalize(
    row: Record<string, unknown>,
    tur: 'e-fatura' | 'e-arsiv' | 'e-irsaliye',
    yon: 'gelen' | 'giden',
  ): Record<string, unknown> {
    const al = (re: RegExp): unknown => {
      const k = Object.keys(row).find(x => re.test(x));
      return k ? row[k] : undefined;
    };
    const tutar = Number(al(/tutar|meblag|toplam/i) ?? 0);
    return {
      belgeNo:   String(al(/fatura_?no|belge_?no|gib_?no|evrak_?no|ettn/i) ?? ''),
      uuid:      String(al(/uuid|ettn/i) ?? ''),
      alici:     String(al(/unvan|alici|gonderen|cari_?isim/i) ?? ''),
      vergiNo:   String(al(/vkn|tckn|vergi/i) ?? ''),
      tutar:     Number.isFinite(tutar) ? tutar : 0,
      belgeDate: String(al(/tarih|date/i) ?? '').slice(0, 10),
      tur, yon,
      durum:     String(al(/durum|statu|status/i) ?? 'Bekliyor'),
      kaynak:    'mikro',
      raw:       row,
    };
  }

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
      const yazilan = await eBelgeYaz(tumu.map(r => eBelgeNormalize(r, 'e-fatura', 'gelen')), await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'Gelen e-Fatura Listesi', `${yazilan} belge (${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son, duration: Date.now() - t0 });
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
      const kayitlar = rows.map(r => {
        const ham = turCol ? String(r[turCol] ?? '') : '';
        const tur: 'e-fatura' | 'e-arsiv' = /arsiv|arşiv|1/i.test(ham) ? 'e-arsiv' : 'e-fatura';
        return { ...eBelgeNormalize(r, tur, 'giden'), turBelirsiz: !turCol };
      });
      const yazilan = await eBelgeYaz(kayitlar, await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'Giden e-Belge Listesi', `${yazilan} belge (${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, ilkTarih: ilk, sonTarih: son,
                 ...(turCol ? {} : { uyari: 'Belge türü kolonu bulunamadı — hepsi e-fatura olarak işaretlendi.' }),
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
      const yazilan = await eBelgeYaz(tumu.map(r => eBelgeNormalize(r, 'e-irsaliye', yon)), await C.reqCompanyId(req));
      await C.writeAuditLog(C.reqActor(req), 'e-İrsaliye Listesi', `${yazilan} belge (${yon}, ${ilk} → ${son})`);
      res.json({ success: true, total: yazilan, yon, duration: Date.now() - t0 });
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
    const t0 = Date.now();
    try {
      const lineItems = order.lineItems;

      const rawDate    = order.createdAt ? new Date(order.createdAt as string) : new Date();
      const faturaDate = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      // faturaTipi: 1=e-Fatura, 2=e-Arşiv, 3=İhracat
      const faturaType = order.faturaTipi === 'e-arsiv' ? 2 : order.faturaTipi === 'ihracat' ? 3 : 1;
      const kdvOran    = Number(order.kdvOran ?? 20);

      // V17 gerçek formatı (MikroAPI.postman_collection_V17.json ile doğrulandı,
      // 2026-06-12): evrak başlığı cha_* (CARI_HESAP_HAREKETLERI), satırlar
      // detay[] içinde sth_* (STOK_HAREKETLERI, sth_evraktip=4). Payload Mikro
      // zarfının İÇİNDE gönderilir (inMikro=true).
      const satirlar = lineItems.map((item: Record<string, unknown>) => {
        const tutar = Number(item.price ?? 0) * Number(item.quantity ?? 1);
        return {
          sth_tarih:           faturaDate,
          sth_tip:             1,
          sth_cins:            0,
          sth_normal_iade:     0,
          sth_evraktip:        4,   // fatura
          sth_evrakno_seri:    'F',
          sth_stok_kod:        (item.sku as string) || '',
          sth_cari_cinsi:      0,
          sth_cari_kodu:       (order.mikroCariKod as string) || '',
          sth_miktar:          Number(item.quantity ?? 1),
          sth_birim_pntr:      1,
          sth_tutar:           tutar,
          sth_vergi:           Math.round(tutar * kdvOran) / 100,
          sth_vergi_pntr:      kdvOran >= 20 ? 4 : kdvOran >= 10 ? 3 : 1,
          sth_vergisiz_fl:     false,
          sth_aciklama:        (item.name as string) || '',
          sth_cari_srm_merkezi: '', sth_stok_srm_merkezi: '',
          sth_subeno:          0,
          sth_giris_depo_no:   1,
          sth_cikis_depo_no:   1,
        };
      });
      const toplamTutar = satirlar.reduce((t, s) => t + s.sth_tutar, 0);
      const evrak = {
        cha_tip:          0,   // satış
        cha_cinsi:        7,   // V17 örnek değeri (toptan satış faturası)
        cha_normal_Iade:  0,
        cha_evrak_tip:    63,  // fatura
        cha_cari_cins:    0,
        // cha_ebelge_turu V17'de eklendi (V16 gövdesinde YOK) — yalnız V17+
        // kurulumlarda gönderilir.
        //
        // ⚠️ ESKİDEN YANLIŞTI (2026-08-25'te düzeltildi). Eski eşleme
        //    `faturaType === 2 ? 8 : faturaType === 3 ? 0 : 1` idi, yani
        //    e-fatura için 1, e-arşiv için 8 yazıyordu. Bu, uygulamanın KENDİ
        //    okuma tarafıyla çelişiyordu: Cetpa'dan kesilen bir e-Fatura,
        //    Cetpa'nın kendi Faturalar ekranında "e-Arşiv" görünürdü; 8'in ise
        //    okuma tarafında karşılığı yok, -1/bilinmiyor'a düşerdi.
        //
        //    Doğru eşleme İKİ BAĞIMSIZ kaynakla sabitlendi (tahmin değil):
        //      1. Okuma tarafı — canlı tie-out ile ölçüldü (HANDOFF.md:119:
        //         satış 200×tür0 / 5×tür1, alış 91×tür0 / 58×tür1) →
        //         src/hooks/useMikroFaturalar.ts:21 «0=e-Fatura, 1=e-Arşiv,
        //         2=e-İrsaliye».
        //      2. Mikro API spec'i — bu dosyada :3528 «EBelgeTipi 0=EFatura
        //         1=EArsiv 2=EIrsaliye» ve :3425 aynı eşlemeyi kullanıyor.
        //
        //    İhracat 0'da BIRAKILDI: ihracat faturası e-Fatura ailesindendir ve
        //    okuma tarafında ayrı bir kodu yok (bkz. hafıza: "İhracat
        //    cha_ebelge_turu'da yok"). Uydurma bir kod yazmaktansa e-Fatura
        //    olarak işaretlemek hem doğru hem okuma tarafıyla tutarlı.
        //
        // ⚠️ ŞU AN ETKİSİZ: MIKRO_JUMP_SURUM varsayılanı 16, yani bu alan hiç
        //    gönderilmiyor. V17'ye geçildiğinde AKTİFLEŞİR — ilk gerçek kayıtta
        //    Mikro'da belge tipinin doğru göründüğü GÖZLE doğrulanmalı.
        ...(MIKRO_JUMP_SURUM >= 17
          ? { cha_ebelge_turu: faturaType === 2 ? 1 : 0 }  // 2=e-arşiv → 1, e-fatura & ihracat → 0
          : {}),
        cha_d_cins:       0,
        cha_d_kur:        1,
        cha_tarihi:       faturaDate,
        cha_evrakno_seri: 'F',
        cha_kod:          (order.mikroCariKod as string) || '',
        cha_projekodu:    '',
        cha_srmrkkodu:    '',
        cha_vade:         0,
        cha_subeno:       0,
        cha_aciklama:     '',
        kdv_istisna_kodu: '',
        detay:            satirlar,
      };

      const { ok, data, status } = await mikroPost('FaturaKaydetV2', { evraklar: [evrak] }, true);
      const duration   = Date.now() - t0;
      const envelope   = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0         = envelope?.[0] as Record<string, unknown> | undefined;
      const success    = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md         = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const mikroFaturaNo = (md?.faturaNo || md?.FaturaNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const ettn          = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
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
      res.json({ success, mikroFaturaNo, ettn, localUpdateFailed, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('FaturaKaydetV2', 'order', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── Mikro e-İrsaliye ─────────────────────────────────────────────────────────
  // POST /api/mikro/irsaliye/kaydet  — push shipment as e-İrsaliye to Mikro
  // Body: { shipment: Record<string, unknown>, firebaseId: string }
  //   shipment must have: mikroCariKod, customerName, destination, trackingNo, items[]
  // On success writes back: irsaliyeNo, irsaliyeEttn to shipments/{firebaseId}
  app.post('/api/mikro/irsaliye/kaydet', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await getMikroCreds())) return res.status(503).json({ success: false, notConfigured: true });
    const parsed = C.validate(IrsaliyeKaydetSchema, req.body, res);
    if (!parsed) return;
    const { shipment, firebaseId } = parsed;
    const t0 = Date.now();
    try {
      const rawDate   = shipment.date ? new Date(shipment.date) : new Date();
      const irsDate   = `${String(rawDate.getDate()).padStart(2,'0')}.${String(rawDate.getMonth()+1).padStart(2,'0')}.${rawDate.getFullYear()}`;
      const items = (shipment.items || []) as Record<string, unknown>[];

      // V17 gerçek formatı (MikroAPI.postman_collection_V17.json ile doğrulandı,
      // 2026-06-12): irsaliye satırları sth_* alanlarıdır (STOK_HAREKETLERI,
      // sth_evraktip=1); kargo/araç bilgisi e_irsaliye_detaylari'nda taşınır.
      // Payload Mikro zarfının İÇİNDE gönderilir (inMikro=true).
      const irsSatir = (item: Record<string, unknown> | null) => ({
        sth_tarih:            irsDate,
        sth_tip:              1,
        sth_cins:             0,
        sth_normal_iade:      0,
        sth_evraktip:         1,   // irsaliye
        sth_evrakno_seri:     'I',
        sth_stok_kod:         item ? ((item.sku as string) || '') : '',
        sth_cari_cinsi:       0,
        sth_cari_kodu:        (shipment.mikroCariKod as string) || '',
        sth_miktar:           item ? Number(item.quantity ?? 1) : 1,
        sth_birim_pntr:       1,
        sth_tutar:            item ? Number(item.price ?? 0) * Number(item.quantity ?? 1) : 0,
        sth_vergi_pntr:       4,
        sth_vergi:            0,
        sth_vergisiz_fl:      false,
        sth_iskonto1:         0,
        sth_iskonto2:         0,
        sth_aciklama:         item ? ((item.name as string) || '') : ((shipment.customerName as string) || ''),
        sth_giris_depo_no:    1,
        sth_cikis_depo_no:    1,
        sth_subeno:           0,
        sth_malkbl_sevk_tarihi: irsDate,
      });
      const satirlar = items.length > 0
        ? items.map((item: Record<string, unknown>) => irsSatir(item))
        : [irsSatir(null)];

      const { ok, data, status } = await mikroPost('IrsaliyeKaydetV2', {
        evraklar: [{
          evrak_aciklamalari: [{ aciklama: (shipment.destination as string) || '' }],
          e_irsaliye_detaylari: {
            eir_tasiyici_firma_kodu: (shipment.cargoFirm as string) || '',
            eir_tasiyici_arac_plaka: (shipment.trackingNo as string) || '',
            eir_eirs_olrk_gonderilsin: 0,
          },
          satirlar,
        }],
      }, true);
      const duration      = Date.now() - t0;
      const envelope      = (data as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
      const r0            = envelope?.[0] as Record<string, unknown> | undefined;
      const success       = ok && !!r0 && !r0.IsError; // r0 YOKSA basari DEGIL: result anahtarsiz 200 (stub/"Api Server Error") eskiden basari sayiliyordu (C13)
      const md            = (r0?.Data ?? r0?.data ?? {}) as Record<string, unknown>;
      const irsaliyeNo    = (md?.irsaliyeNo || md?.IrsaliyeNo || md?.evrakNo || md?.EvrakNo || md?.id || null) as string | null;
      const irsaliyeEttn  = (md?.ettn || md?.Ettn || md?.uuid || null) as string | null;
      const errorMsg      = success ? null : ((r0?.ErrorMessage || `HTTP ${status}`) as string);

      await C.writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', success, irsaliyeNo, errorMsg, duration, C.reqActor(req));
      if (success) void mirrorMikroInsert('mikro_stok_hareketleri',
        (satirlar as unknown as Record<string, unknown>[]).map(s => ({ ...s, __kaynak: 'irsaliye_push' })), STH_COLS);
      if (C.getAdminDb() && firebaseId && success) {
        await C.getAdminDb().collection('shipments').doc(firebaseId).set({
          companyId: await C.reqCompanyId(req),
          irsaliyeNo,
          irsaliyeEttn,
          mikroSynced:     true,
          mikroSyncedAt:   pgServerTimestamp(),
        }, { merge: true });
      }
      res.json({ success, irsaliyeNo, irsaliyeEttn, data, duration });
    } catch (err) {
      const duration = Date.now() - t0;
      const errorMsg = err instanceof Error ? err.message : String(err);
      await C.writeSyncLog('IrsaliyeKaydetV2', 'shipment', firebaseId || 'unknown', false, null, errorMsg, duration, C.reqActor(req));
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

      const bakiyeByKod = new Map<string, number>();
      let unreadable = 0;
      for (const row of rows) {
        const kod = String(row.cha_kod ?? '').trim();
        const raw = row.bakiye;
        if (!kod) continue;
        // Alan okunamıyorsa 0 yazma — atla ve say.
        if (raw == null || !Number.isFinite(Number(raw))) { unreadable++; continue; }
        bakiyeByKod.set(kod, Number(raw));
      }

      const companyId = await C.reqCompanyId(req);
      const leadsSnap = await C.getAdminDb().collection('leads').where('mikroCariKod', '!=', '').get();
      let updated = 0, skipped = 0;
      let batch = C.getAdminDb().batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = C.getAdminDb()!.batch(); ops = 0; } };

      for (const leadDoc of leadsSnap.docs) {
        const cariKod = String((leadDoc.data() as Record<string, unknown>).mikroCariKod ?? '').trim();
        if (!cariKod) { skipped++; continue; }
        // Mikro'da hiç hareketi olmayan cari: SQL'de satırı yok. Bu GERÇEKTEN
        // sıfır bakiyedir (hareket yok = borç yok), tespit edilememiş değil —
        // sorgu başarılı döndüğü için bunu yazmak doğru.
        const bakiye = bakiyeByKod.has(cariKod) ? bakiyeByKod.get(cariKod)! : 0;
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
      res.json({ success: true, total: leadsSnap.size, updated, skipped, unreadable,
                 mikroRows: rows.length, duration: Date.now() - t0 });
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

      // cari_kod başına en düşük adr_adres_no'lu satırı tut (ORDER BY ile artık
      // deterministik — eşit no'larda SQL'in döndürdüğü ilk satır tutarlı kalır).
      const byKod = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const kod = String(row.adr_cari_kod ?? '').trim();
        if (!kod) continue;
        const mevcut = byKod.get(kod);
        const no = Number(row.adr_adres_no ?? 0);
        if (!mevcut || no < Number(mevcut.adr_adres_no ?? 0)) byKod.set(kod, row);
      }

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

        // Boş sayılan: undefined/null/'' ve YALNIZ BOŞLUKTAN oluşan değer —
        // salt falsy kontrolü ' ' gibi anlamsız-ama-truthy değeri "zaten dolu"
        // sanıp Mikro'dan doldurmayı atlıyordu (code-review bulgusu).
        const bos = (v: unknown) => !v || (typeof v === 'string' && !v.trim());
        const guncelleme: Record<string, unknown> = {};
        if (bos(veri.address) && adres.adr_cadde) guncelleme.address = String(adres.adr_cadde);
        if (bos(veri.city) && adres.adr_il) guncelleme.city = String(adres.adr_il);
        if (bos((veri as { district?: unknown }).district) && adres.adr_ilce) guncelleme.district = String(adres.adr_ilce);
        if (bos((veri as { country?: unknown }).country) && adres.adr_ulke) guncelleme.country = String(adres.adr_ulke);
        if (!Object.keys(guncelleme).length) { skipped++; continue; }
        // Kaynak izi: "en düşük adres no = varsayılan" TAHMİNE dayalı (Mikro'da
        // doğrulanmış bir kural değil) — sahte kesinlik göstermemek için hangi
        // alanların bu sezgisel seçimden geldiği işaretleniyor (bkz. task #31,
        // Satış Bölgesi otomatik ataması bu alanı okuyacak).
        guncelleme.addressSource = 'mikro-heuristic';

        batch.set(leadDoc.ref, guncelleme, { merge: true });
        ops++; updated++;
        if (ops >= 400) await flush();
      }
      await flush();

      const ozet = `${updated} cari adresi dolduruldu (Mikro'dan ${rows.length} adres satırı, ${yabanciAtlanan} yabancı kiracı atlandı)`;
      await C.writeSyncLog('SQL:CARI_HESAP_ADRESLERI', 'leads', ozet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Cari Adres Çekme', ozet);
      res.json({ success: true, total: leadsSnap.size, updated, skipped, yabanciAtlanan,
                 mikroRows: rows.length, duration: Date.now() - t0, note: `${updated} dolduruldu, ${skipped} atlandı` });
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
      if (iptalCol) kosul.push(`${iptalCol} = 0`);   // iptal edilmiş fişler mizana girmez
      const where = kosul.length ? ` WHERE ${kosul.join(' AND ')}` : '';
      const { rows, hata } = await mikroSql(
        `SELECT ${hesapCol} AS hesapKodu, ` +
        `SUM(CASE WHEN ${meblagCol} > 0 THEN ${meblagCol} ELSE 0 END) AS borc, ` +
        `SUM(CASE WHEN ${meblagCol} < 0 THEN -${meblagCol} ELSE 0 END) AS alacak ` +
        `FROM MUHASEBE_FISLERI${where} GROUP BY ${hesapCol} ORDER BY ${hesapCol}`,
      );
      if (hata) return res.status(502).json({ success: false, error: `Mizan sorgusu başarısız: ${hata}. Hiçbir şey yazılmadı.` });

      const satirlar = rows.map(r => ({
        hesapKodu: String(r.hesapKodu ?? ''),
        borc:   Number(r.borc ?? 0),
        alacak: Number(r.alacak ?? 0),
        bakiye: Number(r.borc ?? 0) - Number(r.alacak ?? 0),
      })).filter(r => r.hesapKodu);

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
      const toplamBorc   = satirlar.reduce((t, r) => t + r.borc, 0);
      const toplamAlacak = satirlar.reduce((t, r) => t + r.alacak, 0);
      const fark = Math.abs(toplamBorc - toplamAlacak);
      if (satirlar.length && fark > Math.max(1, (toplamBorc + toplamAlacak) * 0.0001)) {
        return res.status(502).json({ success: false,
          error: `Mizan dengesiz: borç ${toplamBorc.toFixed(2)} ≠ alacak ${toplamAlacak.toFixed(2)} (fark ${fark.toFixed(2)}). ` +
                 `Borç/alacak işaret kuralı bu kurulumda farklı olabilir — hiçbir şey yazılmadı.` });
      }

      await C.getAdminDb().collection('accountingPeriods').doc(period).set({
        companyId: await C.reqCompanyId(req),
        period, yil, ay, rows: satirlar,
        toplam: { borc: toplamBorc, alacak: toplamAlacak },
        kaynak: `SQL:MUHASEBE_FISLERI (${hesapCol}/${meblagCol}, işaretli meblağ, denge doğrulandı)`,
        syncedAt: pgServerTimestamp(),
      }, { merge: true });

      const mizanOzet = `${period} dönemi — ${satirlar.length} hesap satırı`;
      await C.writeSyncLog('SQL:MUHASEBE_FISLERI', 'accountingPeriods', mizanOzet, true, null, null, Date.now() - t0, C.reqActor(req));
      await C.writeAuditLog(C.reqActor(req), 'Mikro Mizan Çekme', mizanOzet);
      res.json({ success: true, period, rowCount: satirlar.length, duration: Date.now() - t0 });
    } catch (err) {
      console.error('[pull/mizan]', err);
      res.status(500).json({ success: false, error: 'Mizan çekimi başarısız. Hiçbir şey yazılmadı.' });
    }
  });
}
