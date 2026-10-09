/**
 * shopifyRoutes.ts — çevrim içi mağaza (Shopify) BAĞLANTISI ve webhook ucu (2026-10-02).
 *
 * Uçlar:
 *   GET  /api/shopify/baglanti          bağlantı durumu (sır / tuz DÖNMEZ) — iç personel + `orders` okuma yetkisi
 *   POST /api/shopify/baglanti          kaydet — YALNIZ Yönetici (ya da süper-admin) + MFA
 *   POST /api/shopify/baglanti/kaldir   kaldır — aynı kapı (sır + alan adı + durum gider; TUZ KALIR)
 *   POST /api/shopify/webhook           Shopify'dan gelen olay — kimliksiz, HMAC ile doğrulanır
 *
 * Yazma uçları POST: IIS WebDAV PUT/DELETE'i kesebiliyor, `authFetch` fiil tünellemiyor.
 *
 * DURUM DOKÜMANI BU BAĞLANTIYI DOĞRULAR: alan adı ya da sır DEĞERİ değişince bağlantı SÜRÜMÜ yenilenir ve durum silinir —
 * eski mağazanın «son bildirim»i yeni bağlantıyı sağlıklı göstermesin. Kural silmeye BAĞLI DEĞİL: durum yazıldığı sürümü damga
 * olarak taşır, damgası kayıtla tutmayan durum yok sayılır (shopifyBaglanti `baglantiSurumu`). Silme başarısız olsa da, eski
 * sırla doğrulanıp kuyrukta beklemiş iş silmeden sonra işlense de (o iş durum YAZMAZ) yeni bağlantı «doğrulanmış» görünmez.
 * Alan adı değişirken sır da yeniden girilir (eski mağazanın sırrı yenisini doğrulamaz).
 *
 * WEBHOOK (eski uç kanalRoutes'taydı): sır yalnız ortam değişkenindeydi (tek global sır, mağaza ↔ kiracı eşlemesi yok), yanıt
 * kuyruğa yazmadan ÖNCE gönderiliyordu (kuyruk hatasında olay kayboluyordu), kuyruksuz dalda hata yutuluyordu. Şimdi:
 *   1. `X-Shopify-Shop-Domain` → kiracının bağlantı kaydı. Yoksa 503 (ortam sırrı yedeği YOK — arka kapı olurdu).
 *   2. İmza yalnız O kiracının sırrıyla doğrulanır (sabit zamanlı). Tutmuyorsa 401; imza doğrulanmadan gövdeye güvenilmez.
 *      Ret İZ BIRAKIR (yanlış sırda kart «henüz bildirim alınmadı» demesin): kısıtlı uyarı günlüğü + durum dokümanına yalnız
 *      `sonImzaReddi` zamanı. Uç kimliksiz olduğundan gövdeden / başlıktan HİÇBİR değer yazılmaz, yazım kiracı başına
 *      `RET_IZI_ARALIGI_MS`'de bir kezdir, `sonBildirim` / `toplamBildirim`'e dokunulmaz (sahte «Bağlı» olmasın).
 *   3. Olay kuyruğa yazılır; yazılamazsa 500 (Shopify yeniden dener). Kuyruk yoksa doğrudan işlenir; hata 500.
 *   4. 200.
 * Gövde ayrıştırıcı sınırı server.ts'te bu yol için ayrıca yükseltilir (çok kalemli sipariş 100 KB'ı aşar → 413 → Shopify
 * sekiz denemeden sonra webhook'u siler).
 *
 * Eşleme: src/server/kanal/shopifyEsleme.ts (saf) · işleyici: shopifyWebhook.ts · doğrulama / yanıt biçimi: shopifyBaglanti.ts.
 * Bağlantı koleksiyonu SUNUCUYA ÖZELDİR (collections.ts SERVER_ONLY) — sır hiçbir /api/db yolundan ya da akıştan çıkmaz.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import type { AppRole } from '../../lib/rbac.js';
import {
  BAGLANTI_KOLEKSIYONU, alanAdiNormallestir, baglantiKaydi, baglantiYaniti, durumBuSurumunMu, durumDamgasi, durumKimligi,
  imzaGecerli, kayitIstegi, surumOku, surumUret, tuzUret,
  type BaglantiKaydi,
} from '../kanal/shopifyBaglanti.js';
import { shopifyOlayiIsle, type OlaySonucu } from '../kanal/shopifyWebhook.js';

export const SHOPIFY_KUYRUGU = 'shopify-webhook';
/** Reddedilen bildirimin izi (uyarı günlüğü / `sonImzaReddi` yazımı) bu aralıkta en çok bir kez bırakılır — uç kimliksiz. */
export const RET_IZI_ARALIGI_MS = 10 * 60 * 1000;

/**
 * Kuyruğa yazılan iş. Sır ve tuz İŞTE TAŞINMAZ — işleyici bağlantıyı kiracıdan yeniden okur.
 * `baglantiSurumu`: imzanın doğrulandığı ANDAKİ bağlantı sürümü (rastgele kimlik, sır bilgisi taşımaz; sürümsüz kayıtta null).
 */
export interface ShopifyIsi {
  topic: string; body: unknown; cid: string; shopDomain: string; apiSurumu?: string; baglantiSurumu: string | null;
  /** `X-Shopify-Webhook-Id` — olayın kendi kimliği; iş verisinde durduğu için kuyruğun yeniden denemelerinde aynı kalır. */
  olayNo?: string;
}

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste. */
export interface ShopifyRouteCtx {
  getAdminDb: () => AdminDbLike;
  /** pg-boss kuyruğu server.ts'te SONRADAN kurulur — GETTER. Yoksa olay istek içinde işlenir. */
  getBoss: () => { send: (kuyruk: string, veri: ShopifyIsi, secenek: Record<string, unknown>) => Promise<unknown> } | null | undefined;
  requireAuth: any;
  requireMfaVerified: any;
  requireStaff: any;
  requireCollectionAccess: (coll: string, op: 'read' | 'write' | 'delete') => any;
  getUserRole: (uid: string) => Promise<AppRole | null>;
  isSuperAdmin: (req: Request) => boolean;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  pgServerTimestamp: () => unknown;
}

const bagRef = (C: ShopifyRouteCtx, id: string) => C.getAdminDb().collection(BAGLANTI_KOLEKSIYONU).doc(id);

async function kiraciBaglantisi(C: ShopifyRouteCtx, cid: string): Promise<{ ham: Record<string, unknown> | undefined; kayit: BaglantiKaydi | null }> {
  const snap = await bagRef(C, cid).get();
  const ham = snap.exists ? snap.data() : undefined;
  return { ham, kayit: baglantiKaydi(ham) };
}

/** Mağaza alan adından kiracı bağlantısı. Aynı alan adı iki kayıtta görünürse (olmamalı — kayıtta 409) hiçbiri kullanılmaz. */
async function alanAdindanBaglanti(C: ShopifyRouteCtx, shopDomain: string): Promise<BaglantiKaydi | null> {
  const snap = await C.getAdminDb().collection(BAGLANTI_KOLEKSIYONU).where('shopDomain', '==', shopDomain).get();
  const kayitlar = snap.docs.map(d => baglantiKaydi(d.data())).filter((k): k is BaglantiKaydi => k !== null);
  return kayitlar.length === 1 ? kayitlar[0] : null;
}

/**
 * Kuyruk işçisinin (server.ts) ve kuyruksuz dalın çağırdığı işleyici: bağlantıyı kiracıdan YENİDEN okur (tuz burada alınır).
 * Bağlantı o arada kaldırıldıysa ya da başka mağazaya çevrildiyse olay atlanır — eski mağazanın olayı yeni bağlantıya yazılmaz.
 * Mağaza aynı ama SÜRÜM değiştiyse (sır değişti; iş eski sırla doğrulanıp kuyrukta bekledi) sipariş yine yazılır — olay o günün
 * geçerli sırrıyla doğrulanmıştı — ama durum dokümanına DOKUNULMAZ: yeni, hiç doğrulanmamış sır «bildirim alındı» görünmesin.
 */
export async function shopifyIsiIsle(C: Pick<ShopifyRouteCtx, 'getAdminDb' | 'pgServerTimestamp'>, is: ShopifyIsi): Promise<OlaySonucu> {
  const snap = await C.getAdminDb().collection(BAGLANTI_KOLEKSIYONU).doc(is.cid).get();
  const kayit = baglantiKaydi(snap.exists ? snap.data() : undefined);
  if (!kayit || kayit.companyId !== is.cid || kayit.shopDomain !== is.shopDomain) return { sonuc: 'atlandi', neden: 'baglantiYok' };
  const eskiSurum = surumOku(is.baglantiSurumu) !== kayit.baglantiSurumu;
  return shopifyOlayiIsle(
    { db: C.getAdminDb(), zamanDamgasi: C.pgServerTimestamp, simdi: () => new Date() },
    {
      topic: is.topic, body: is.body, cid: is.cid, tuz: kayit.tuz, apiSurumu: is.apiSurumu,
      baglantiSurumu: kayit.baglantiSurumu, ...(eskiSurum ? { durumaDokunma: true } : {}),
      ...(is.olayNo ? { olayNo: is.olayNo } : {}),
    },
  );
}

export function shopifyRoutes(app: Express, C: ShopifyRouteCtx): void {
  /** Yalnız Yönetici (ya da süper-admin). Manager ayar yazabilir ama mağaza bağlantısı = sipariş yazma yetkisi veren sır. */
  const yalnizYonetici = async (req: Request, res: Response): Promise<boolean> => {
    const uid = (req as Request & { uid?: string }).uid || '';
    if (C.isSuperAdmin(req) || await C.getUserRole(uid) === 'Admin') return true;
    res.status(403).json({ success: false, error: 'Mağaza bağlantısını yalnız Yönetici değiştirebilir.' });
    return false;
  };
  const yanit = async (cid: string, kayit: BaglantiKaydi | null) => {
    const durum = kayit ? (await bagRef(C, durumKimligi(cid)).get()).data() : undefined;
    return baglantiYaniti(kayit, durum, process.env.APP_URL);
  };
  // Ret izi kısıtı — bellek içi. İmza reddi: anahtar KİRACI (yalnız bağlantısı olan kiracı buraya düşer → sınırlı sayıda anahtar).
  // Bağlantısız mağaza: tek ortak sayaç — başlık saldırganın elinde, alan adı başına anahtar tutmak belleği şişirirdi.
  const sonImzaReddiIzi = new Map<string, number>();
  let sonBaglantisizIzi: number | undefined;
  const araliktaIlkMi = (onceki: number | undefined, simdi: number): boolean => onceki === undefined || simdi - onceki >= RET_IZI_ARALIGI_MS;
  /** İmzası tutmayan bildirim: kısıtlı uyarı + `sonImzaReddi`. Fırlatmaz — 401 yanıtı bu yazıma bağlı değildir. */
  const imzaReddiniIsaretle = async (kayit: BaglantiKaydi): Promise<void> => {
    const simdi = Date.now();
    if (!araliktaIlkMi(sonImzaReddiIzi.get(kayit.companyId), simdi)) return;
    sonImzaReddiIzi.set(kayit.companyId, simdi);
    console.warn('[/api/shopify/webhook] imza tutmadı — mağaza:', kayit.shopDomain);
    try {
      const ref = bagRef(C, durumKimligi(kayit.companyId));
      // Eldeki durum başka sürümünse (eski bağlantının kalıntısı) birleştirilmez: ret, bu bağlantının İLK izi olarak yazılır.
      const buSurumun = durumBuSurumunMu((await ref.get()).data(), kayit.baglantiSurumu);
      await ref.set({ ...durumDamgasi(kayit.companyId, kayit.baglantiSurumu), sonImzaReddi: new Date(simdi).toISOString() }, { merge: buSurumun });
    } catch (e) {
      console.warn('[/api/shopify/webhook] imza reddi yazılamadı:', e instanceof Error ? e.message : String(e));
    }
  };

  app.get('/api/shopify/baglanti', C.requireAuth, C.requireStaff, C.requireCollectionAccess('orders', 'read'), async (req: Request, res: Response) => {
    try {
      const cid = await C.reqCompanyId(req);
      const { kayit } = await kiraciBaglantisi(C, cid);
      res.json(await yanit(cid, kayit));
    } catch (e) {
      console.error('[/api/shopify/baglanti GET]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Bağlantı durumu okunamadı.' });
    }
  });

  app.post('/api/shopify/baglanti', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await yalnizYonetici(req, res))) return;
    try {
      const cid = await C.reqCompanyId(req);   // kiracı gövdeden DEĞİL, oturumdan
      const { ham, kayit: mevcut } = await kiraciBaglantisi(C, cid);
      const istek = kayitIstegi(req.body, !!mevcut);
      if (!istek.tamam) return res.status(400).json({ success: false, error: istek.hata });
      // Bir mağaza TEK kiracıya bağlanır: webhook kiracıyı alan adından bulur.
      const ayniAlan = await C.getAdminDb().collection(BAGLANTI_KOLEKSIYONU).where('shopDomain', '==', istek.shopDomain).get();
      if (ayniAlan.docs.some(d => String((d.data() as { companyId?: unknown }).companyId ?? '') !== cid)) {
        return res.status(409).json({ success: false, error: 'Bu mağaza alan adı başka bir firmaya bağlı.' });
      }
      // «Boş sır = mevcut sır korunur» yalnız AYNI mağaza için: eski mağazanın sırrı yenisinin bildirimlerini doğrulamaz (hepsi 401).
      if (mevcut && mevcut.shopDomain !== istek.shopDomain && !istek.yeniSir) {
        return res.status(400).json({ success: false, error: 'Mağaza alan adı değişti; yeni mağazanın imza sırrını gir.' });
      }
      const sir = istek.yeniSir ?? mevcut?.webhookSecret;
      if (!sir) return res.status(400).json({ success: false, error: 'İlk kurulumda webhook imza sırrı gerekli.' });
      // Tuz İLK kurulumda üretilir ve DEĞİŞMEZ (değişirse aynı sipariş ikinci kez, başka kimlikle yazılır). Yarım kayıtta da
      // korunur — «Bağlantıyı kaldır» tuzu yarım kayıt olarak bırakır, yeniden kurulum buradan AYNI tuzu alır.
      const tuz = mevcut?.tuz ?? (typeof ham?.tuz === 'string' && ham.tuz ? ham.tuz : tuzUret());
      // Durum (son bildirim / toplam / son ret) ESKİ alan adı + sır çiftine aittir. Çift DEĞER olarak aynı kalmadıysa bağlantı
      // YENİ SÜRÜM alır: eski durumun damgası artık tutmaz, kart yeni bağlantı için «doğrulanmadı» der. Aynı alan adı + boş sır
      // (ya da aynı sırrı yeniden yapıştırmak) sürümü ve durumu KORUR. Sürümsüz eski kayıt ilk kaydedişte sürüm alır.
      const ayniBaglanti = !!mevcut && mevcut.shopDomain === istek.shopDomain && mevcut.webhookSecret === sir;
      const baglantiSurumu = (ayniBaglanti ? mevcut?.baglantiSurumu : null) ?? surumUret();
      const yeni: BaglantiKaydi = { companyId: cid, shopDomain: istek.shopDomain, webhookSecret: sir, tuz, baglantiSurumu };
      await bagRef(C, cid).set({ ...yeni, guncelleyenUid: C.reqActor(req).uid, guncellendi: C.pgServerTimestamp() });
      if (baglantiSurumu !== mevcut?.baglantiSurumu) {
        // Silmeden ÖNCE: silme fırlatsa da kısıt sıfırlanmış olsun (yeniden gönderim bu dala bir daha girmez).
        sonImzaReddiIzi.delete(cid);   // yeni sır da yanlışsa ilk ret hemen iz bıraksın (kısıt eski bağlantınındı)
        // Silme artık yalnız TEMİZLİKTİR (doğruluk damgada): fırlatırsa 500 döner, yeniden gönderimde kalıntı yine yok sayılır.
        await bagRef(C, durumKimligi(cid)).delete();
      }
      // Denetim kaydı DEĞER içermez.
      await C.writeAuditLog(C.reqActor(req), 'Shopify Bağlantısı',
        `${mevcut ? 'güncellendi' : 'kuruldu'}: ${istek.shopDomain}, imza sırrı ${istek.yeniSir ? (mevcut ? 'değişti' : 'girildi') : 'değişmedi'}`);
      res.json(await yanit(cid, yeni));
    } catch (e) {
      console.error('[/api/shopify/baglanti POST]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Bağlantı kaydedilemedi.' });
    }
  });

  app.post('/api/shopify/baglanti/kaldir', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!(await yalnizYonetici(req, res))) return;
    try {
      const cid = await C.reqCompanyId(req);
      const { ham } = await kiraciBaglantisi(C, cid);
      // TUZ KALIR: silinseydi yeniden kurulumda yeni tuz üretilir, mağazada açık duran her siparişin sonraki olayı başka doküman
      // kimliğine düşer ve sipariş İKİNCİ KEZ yazılırdı. Birleştirmesiz `set`: sır ve alan adı GİDER → `baglantiKaydi` null
      // (GET «bağlı değil», webhook 503, kuyruk işçisi atlar, yeniden kurulum sırrı baştan ister).
      const tuz = typeof ham?.tuz === 'string' && ham.tuz ? ham.tuz : null;
      if (tuz) await bagRef(C, cid).set({ companyId: cid, tuz, guncelleyenUid: C.reqActor(req).uid, guncellendi: C.pgServerTimestamp() });
      else await bagRef(C, cid).delete();
      await bagRef(C, durumKimligi(cid)).delete();
      sonImzaReddiIzi.delete(cid);
      // Denetim kaydı yalnız GERÇEKTEN bir bağlantı kaldırıldıysa (yarım kayıtta alan adı yoktur — ikinci basış iz bırakmaz).
      if (typeof ham?.shopDomain === 'string') await C.writeAuditLog(C.reqActor(req), 'Shopify Bağlantısı', `kaldırıldı: ${ham.shopDomain}`);
      res.json({ success: true });
    } catch (e) {
      console.error('[/api/shopify/baglanti/kaldir]', e instanceof Error ? e.message : String(e));
      res.status(500).json({ success: false, error: 'Bağlantı kaldırılamadı.' });
    }
  });

  app.post('/api/shopify/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const baslik = (ad: string): string | undefined => { const v = req.headers[ad]; return typeof v === 'string' ? v : undefined; };
    try {
      const shopDomain = alanAdiNormallestir(baslik('x-shopify-shop-domain'));
      const kayit = shopDomain ? await alanAdindanBaglanti(C, shopDomain) : null;
      // Bağlantısı olmayan mağaza: doğrulanacak sır yok → işlenmez (fail-closed). Gövdeye bakılmaz.
      if (!shopDomain || !kayit) {
        // Atfedilecek kiracı yok → veritabanına YAZILMAZ; yalnız kısıtlı uyarı (alan adı yanlış yazıldıysa günlükte görünsün).
        const simdi = Date.now();
        if (araliktaIlkMi(sonBaglantisizIzi, simdi)) {
          sonBaglantisizIzi = simdi;
          console.warn('[/api/shopify/webhook] eşleşen bağlantı yok — mağaza:', shopDomain ?? '(alan adı başlığı yok / geçersiz)');
        }
        res.status(503).send('Webhook not configured'); return;
      }
      if (!imzaGecerli(req.rawBody, baslik('x-shopify-hmac-sha256'), kayit.webhookSecret)) {
        await imzaReddiniIsaretle(kayit);
        res.status(401).send('Invalid signature'); return;
      }
      const is: ShopifyIsi = {
        topic: baslik('x-shopify-topic') ?? '', body: req.body, cid: kayit.companyId, shopDomain, baglantiSurumu: kayit.baglantiSurumu,
        ...(baslik('x-shopify-api-version') ? { apiSurumu: baslik('x-shopify-api-version') } : {}),
        // Olay kimliği: hata izini yalnız AYNI olayın yeniden denemesi silebilsin (shopifyWebhook.ts başlığı). Uzunluk sınırlı.
        ...(baslik('x-shopify-webhook-id') ? { olayNo: (baslik('x-shopify-webhook-id') ?? '').slice(0, 100) } : {}),
      };
      const kuyruk = C.getBoss();
      // Yanıt, olay güvene alındıktan SONRA: kuyruk yazımı / işleme başarısızsa 500 → Shopify yeniden dener.
      if (kuyruk) await kuyruk.send(SHOPIFY_KUYRUGU, is, { retryLimit: 8, retryDelay: 60, retryBackoff: true });
      else await shopifyIsiIsle(C, is);
      res.status(200).send('ok');
    } catch (e) {
      console.error('[/api/shopify/webhook]', e instanceof Error ? e.message : String(e));
      res.status(500).send('Webhook could not be processed');
    }
  });
}
