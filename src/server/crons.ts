/**
 * crons.ts - Zamanlanmis isler: Mikro periyodik senkron + haftalik e-posta raporu.
 *
 * server.ts'ten AYRILDI (2026-08-24) - D4 teknik borcunun 4. parcasi.
 * Onceki parcalar: opsWatchdog.ts, mikroClient.ts, mikroMirror.ts.
 *
 * NE ICERIR (3 cron):
 *   0 * * * *   saatlik Mikro senkronu (stok + cari)
 *   0 4 * * *   gece stok miktar senkronu
 *   0 8 * * 1   haftalik ozet e-postasi (pazartesi)
 *
 * NEDEN AYRI DOSYA: bunlar istek yolunda DEGIL, kendi takvimlerinde kosan
 * bagimsiz isler. server.ts icinde dururken rota tanimlariyla ic ice geciyor
 * ve "bu kod ne zaman kosuyor" sorusunun cevabi kayboluyordu.
 *
 * BAGIMLILIKLAR: Mikro ile konusma ve ayna yazma artik mikroClient/mikroMirror
 * modullerinden IMPORT ediliyor - bu dosya yalnizca ZAMANLAMA ve is akisi
 * tasiyor. Geriye kalan dort sey (adminDb, tenantSnap, serverTenantId,
 * pgServerTimestamp) server.ts'te kaldigi icin DI ile geciyor.
 */
import { resendGonderici } from './eposta.js';
import type { AdminDbLike, AdminDocRef, DocDaralt } from './adminDbTypes.js';
import { zamanla, IS_SAAT_DILIMI } from './zamanla.js';
import { getMikroCreds, mikroPost, mikroData, mikroBugun, mikroStokMiktari,
         mikroSatisFiyatlari, mikroVergiOranlari, vergiOraniCoz,
         MIKRO_JUMP_SURUM } from './mikroClient.js';
import { mirrorMikroStoklar, mirrorMikroCariler } from './mikroMirror.js';
// Cari eşlemesi TEK KAYNAK (saf + testli). 2026-09-19 delta bulgusu: bu dosya
// eşlemenin KENDİ kopyasını taşıyordu (`email: (c.cari_EMail as string) || ''`,
// `Number(c.cari_hareket_tipi ?? 0)`) ve rotalarda kapatılan "bilinmeyen alan
// YAZILMAZ" sözleşmesini HER SAAT BAŞI geri alıyordu: elle girilmiş e-posta/
// telefon/VKN `''` ile siliniyordu. İki yazıcının aynı `leads` dokümanına zıt
// sözleşmeyle yazması "yarım düzeltme" sınıfının en pahalı hâli.
import { cariEsle, cariEslemeOzeti, type CariEsleme } from './mikro/eslemeCari.js';
import { sayacOlustur, sayacaEkle, okumaArizalari, STOK_KRITIK } from './mikro/eslemeStok.js';
import { isimAnahtari, firmaAnahtari } from '../lib/isimAnahtari.js';
// Sipariş tutarı TEK KAYNAK: bilinmeyen tutar 0 SAYILMAZ, ayrıca sayılır.
import { toplaBilinen, donemKarsilastir } from '../utils/para.js';
import { siparisTutari } from '../utils/siparis.js';
import { bakimKilidiVar, yaziciOlarakCalistir, type SqlCalistirici } from './bakimKilidi.js';


export interface CronDeps {
  /** server.ts'te SONRADAN atanan `let` - deger degil GETTER. */
  /** `any` DEGIL: yapisal tip, tip denetimini korur (bkz. adminDbTypes.ts). */
  getAdminDb: () => AdminDbLike | null;
  /** Bakım kilidi için (bakimKilidi.ts). server.ts'te SONRADAN atanan `let` — GETTER. Opsiyonel: lokal Firestore fallback'ta yok. */
  getPgPool?: () => SqlCalistirici | null;
  /** Kiraci-filtreli snapshot (server.ts'te kaldi). */
  tenantSnap: (coll: string, cid: string, daralt?: DocDaralt) => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown>; ref: AdminDocRef }> }>;
  /** Oturumsuz baglamda hedef kiraci. */
  serverTenantId: () => Promise<string>;
  pgServerTimestamp: () => any;
}

let D: CronDeps;

/** Init edilmeden cagrilirsa NE YAPILMASI gerektigini soyleyen hata verir. */
function deps(): CronDeps {
  if (!D) throw new Error('crons: initCrons() cagrilmadan kullanilamaz.');
  return D;
}

/**
 * Zamanlanmis isleri kaydeder.
 *
 * INIT YERI (bkz. CLAUDE.md "Modul init'i nereye konur"): bu modulun
 * tuketicileri YALNIZ cron'lardir ve onlar ancak takvimleri geldiginde
 * atesleniyor - yani modul yuklenirken hicbir sey kosmuyor. Yine de cagri
 * server.ts'te cron'larin ESKIDEN kayitli oldugu yerde, MODUL DUZEYINDE
 * duruyor: boylece kayit sirasi ve zamanlama davranisi birebir korunuyor.
 */
export function initCrons(d: CronDeps): void {
  D = d;
  kur();
}

function kur(): void {
// ── Mikro periodic sync (cron) ───────────────────────────────────────────────
// Saatte bir: TÜM cari + stok kartlarını sayfalı çeker, UPSERT eder (yeni
// kayıt ekler, mevcutları günceller, tedarikçi tipini işler) ve mikro_*
// aynasına yazar. Gece 04:00: V17+ kurulumlarda stok miktar/maliyet senkronu.
if (process.env.MIKRO_CRON_SYNC === 'true') {
  /**
   * Mikro cron'un yazacağı hedef tenant. Mikro creds deployment-global olduğundan
   * tek hedef firma vardır. Öncelik: MIKRO_CRON_COMPANY_ID env. Yoksa kurulumda
   * tek tenant varsa onu kullan. Çok-tenant'ta belirsizse '' döner → cron senkronu
   * atlar (yanlış tenant'a yazmamak için). "ilk inventory dokümanı" heuristiği
   * (kırılgan/rastgele) kaldırıldı.
   */
  const cronCompanyId = async (): Promise<string> => {
    if (process.env.MIKRO_CRON_COMPANY_ID) return process.env.MIKRO_CRON_COMPANY_ID;
    // Yerel const: guard ile kullanim arasinda getter'i TEKRAR cagirmak
    // daralmayi kaybettiriyor (her cagri yeniden null donebilir).
    const db = deps().getAdminDb();
    if (!db) return '';
    const snap = await db.collection('users').get();
    // Set<string> ACIKCA: `getAdminDb()` DI'da `any` oldugu icin `snap.docs`
    // da any oluyor ve `new Set(any)` TypeScript'te Set<unknown> cikariyor.
    // server.ts'te adminDb'nin gercek tipi vardi, bu cikarim sorunu yoktu.
    const cids = new Set<string>(snap.docs.map((d: { data: () => Record<string, unknown>; id: string }) =>
      (d.data().companyId as string) || d.id));
    if (cids.size === 1) return [...cids][0];
    console.error(`Mikro cron: ${cids.size} tenant bulundu ve MIKRO_CRON_COMPANY_ID tanımlı değil → senkron atlandı.`);
    return '';
  };

  const cronPullAll = async (
    method: string, listKey: string, body: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    for (let index = 0; index < 100; index++) {
      const { ok, data } = await mikroPost(method, { ...body, Size: '500', Index: index });
      if (!ok || typeof data === 'string') break;
      const rows = (mikroData(data)[listKey] ?? []) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      out.push(...rows);
      if (rows.length < 500) break;
    }
    return out;
  };

  zamanla('0 * * * *', async () => {
    // Yazıcı kaydı (2026-09-11): bakım scripti kilidi koyduktan sonra bu koşunun BİTMESİNİ bekler —
    // yalnız başlangıçta kilide bakmak yetmiyordu (T0 ref'leriyle silinen kopya diriliyordu).
    const yaziciSonucu = await yaziciOlarakCalistir(deps().getPgPool?.() ?? null, 'mikro-cron', async () => {
    // Bakım kilidi (2026-09-05): lead-birlestir gibi veri bakımları koşarken cari/stok upsert'i silinen
    // kaydı pgShim UPSERT'iyle DİRİLTİR (inceleme). Kilit varken bu koşu atlanır, bir sonraki saatte tekrar denenir.
    const kilit = await bakimKilidiVar(deps().getPgPool?.() ?? null);
    if (kilit) { console.warn(`[cron] bakım kilidi var (${kilit.aciklama}, ${kilit.baslangic}) — Mikro senkronu bu saat atlandı`); return; }
    const cronCreds = await getMikroCreds();
    const db = deps().getAdminDb();
    if (!cronCreds || !db) return;
    console.log('Mikro cron: stok + cari tam senkron başlatıldı');
    try {
      const companyId = await cronCompanyId();
      if (!companyId) { console.warn('Mikro cron: hedef tenant belirsiz, senkron atlandı.'); return; }

      // ── Stok kartları: tam sayfalama + upsert ──────────────────────────────
      const stoklar = await cronPullAll('StokListesiV2', 'StokListesi', {
        StokKod: '', TarihTipi: 2,
        IlkTarih: '2000-01-01', SonTarih: `${new Date().getFullYear() + 1}-12-31`,
        Sort: 'sto_kod',
      });
      void mirrorMikroStoklar(stoklar);
      const vergiTablosu = await mikroVergiOranlari(); // döngü öncesi bir kez
      const invSnap = await deps().tenantSnap('inventory', companyId);
      const invBySku = new Map<string, { ref: AdminDocRef; stockLevel: number; name: string; prices: Record<string, number> }>();
      for (const d of invSnap.docs) {
        const data = d.data();
        const sku = (data.sku as string)?.trim();
        if (sku && !invBySku.has(sku)) {
          invBySku.set(sku, {
            ref: d.ref, stockLevel: Number(data.stockLevel) || 0, name: (data.name as string) || sku,
            // Mevcut fiyatlar: Mikro fiyatı gelmeyen kademeler KORUNSUN diye
            // (elle girilmiş fiyat senkronla silinmemeli — bkz. aşağıdaki merge).
            prices: (data.prices as Record<string, number>) || {},
          });
        }
      }
      let stokYeni = 0, stokGuncel = 0;
      // Okuma arızası sayacı — elle import (`/api/mikro/import/stok`) ile AYNI kural ve aynı kritik alan kümesi:
      // ürün adı / KDV oranı satırların TAMAMINDA okunamıyorsa veri değil şema sorunudur. Cari tarafında bu uyarı
      // vardı, stok tarafında yoktu (2026-09-19 kapanış incelemesi — yarım düzeltme).
      const stokSayac = sayacOlustur();
      let batch = db.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };
      const seenSku = new Set<string>();
      for (const s of stoklar) {
        const sku = (s.sto_kod as string)?.trim();
        if (!sku || seenSku.has(sku)) continue;
        seenSku.add(sku);
        const mikroQty = mikroStokMiktari(s);
        const kdvOran = vergiOraniCoz(s.sto_perakende_vergi, vergiTablosu);

        // Satış fiyatları — cron import'u bunu HİÇ yazmıyordu (yalnız manuel import
        // yazıyordu), o yüzden cron'la oluşan ürünler ekranda "0 TL" kalıyordu.
        const mikroPrices = mikroSatisFiyatlari(s);
        const fiyatVar = Object.keys(mikroPrices).length > 0;

        // Mikro ad/birim BOŞSA mevcut kaydı EZME (2026-09-19 delta bulgusu): eski
        // `|| sku` / `|| 'ADET'` her saat başı elle düzeltilmiş adı SKU koduna,
        // birimi 'ADET'e döndürüyordu — elle import'ta (`stokEsle`) kapatılan sınıf
        // bu otomatik yüzeyde açık kalmıştı. Yedekler YALNIZ yeni kayıtta (aşağıda
        // `batch.set`), çünkü doküman adsız açılamaz.
        // `?.trim()` DEĞİL: kolon sayı dönerse `.trim` yok ve istisna TÜM saatlik
        // senkronu düşürürdü (eski `|| sku` tipe bakmıyordu, bu yüzden dayanıklıydı).
        const mikroMetin = (x: unknown): string =>
          typeof x === 'string' ? x.trim()
          : typeof x === 'number' && Number.isFinite(x) ? String(x)
          : '';
        const mikroAd    = mikroMetin(s.sto_isim);
        const mikroBirim = mikroMetin(s.sto_birim1_ad);
        sayacaEkle(stokSayac, [...(mikroAd ? [] : ['ürün adı']), ...(kdvOran !== null ? [] : ['KDV oranı'])]); // etiketler STOK_KRITIK ile birebir
        const fields = {
          ...(mikroAd    ? { name: mikroAd }    : {}),
          ...(mikroBirim ? { unit: mikroBirim } : {}),
          // sto_perakende_vergi İNDEKStir, yüzde değil (bkz. vergiOraniCoz).
          // Çözülemezse vatRate'e DOKUNMA — uydurma %20 yazmaktansa eskisi kalsın.
          ...(kdvOran !== null ? { vatRate: kdvOran } : {}),
          // Miktar alanı YOKSA stockLevel'a DOKUNMA. Eskiden `?? 0` vardı: alan
          // gelmediğinde her senkron tüm ürünlerin stoğunu sıfırlıyor ve üstelik
          // her ürün için sahte bir sayım farkı üretiyordu. Miktarın güvenilir
          // kaynağı GenelAmacliMaliyetListesiV2 (/api/mikro/import/stok-miktar).
          ...(mikroQty !== null ? { stockLevel: mikroQty } : {}),
          mikroStoKod: sku, mikroSynced: true,
          mikroSyncedAt: deps().pgServerTimestamp(),
          // companyId GÜNCELLEMEDE de yazilir: eski etiketsiz kayitlar her senkronda
          // kendiliginden etiketlenir (self-heal) — ayri backfill'e gerek kalmaz.
          companyId,
        };
        const existing = invBySku.get(sku);
        if (existing) {
          // Sayim farki tespiti: senkrondan hemen once bizim mevcut stockLevel'imiz
          // ile Mikro'nun gonderdigi miktar farkliysa kaydet - ozellikle numune/fire/
          // konsinye gibi yalniz bizim tarafta bilinen dususleri Mikro'nun (bunlardan
          // habersiz) eski sayisiyla sessizce ezmesine karsi gorunurluk saglar.
          if (mikroQty !== null && existing.stockLevel !== mikroQty) {
            batch.set(db.collection('stockDiscrepancies').doc(), {
              productId: existing.ref.id, sku, productName: existing.name,
              ourQty: existing.stockLevel, mikroQty, diff: mikroQty - existing.stockLevel,
              resolved: false, companyId, detectedAt: deps().pgServerTimestamp(),
            });
            ops++; // ayri bir batch islemi - ops sayacina ayrica ekle
          }
          // Fiyat MERGE: Mikro'dan gelmeyen kademe mevcut değeriyle kalır
          // (elle girilmiş fiyat senkronla silinmez).
          batch.update(existing.ref, fiyatVar
            ? { ...fields, prices: { ...existing.prices, ...mikroPrices } }
            : fields);
          stokGuncel++;
        }
        else {
          batch.set(db.collection('inventory').doc(), {
            // YENİ kayıt yedekleri ÖNCE: `...fields` bilineni her zaman EZER.
            // (Doküman adsız/birimsiz açılamaz — `stokEsle` de aynı pariteyi korur.)
            name: sku, unit: 'ADET',
            ...fields, sku, category: 'Genel',
            lowStockThreshold: 5,
            prices: mikroPrices,
            // Eski tek-fiyat alanı, Retail ile hizalı tutulur (bazı ekranlar okuyor).
            // Mikro'da fiyat kaydı yoksa alanı HİÇ YAZMA: `?? 0` ürünü envantere
            // "0 TL" fiyatla sokuyordu ve satış ekranlarında bedava görünüyordu
            // (2026-09-04 denetimi). Fiyat sonradan gelince senkron doldurur.
            ...(mikroPrices.Retail != null ? { price: mikroPrices.Retail } : {}),
            source: 'mikro_cron', createdAt: deps().pgServerTimestamp(),
          });
          stokYeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();
      // Vergi tablosu BOŞSA (VergiListesiV2 kesintisi) KDV oranı hiçbir satırda çözülemez — bu stok ŞEMASI sorunu
      // değildir; nedeni doğru adlandır, "kolon adı kontrol edin" diye yanlış yere yollama.
      const vergiBos = vergiTablosu.size === 0;
      if (vergiBos && stokSayac.satir >= 5) console.warn('[cron] Mikro vergi tablosu (VergiListesiV2) okunamadı — bu turda KDV oranı yazılmadı; stok şeması değil vergi listesi çağrısını kontrol edin');
      const stokArizasi = okumaArizalari(stokSayac, STOK_KRITIK).filter(a => !(vergiBos && a === 'KDV oranı'));
      if (stokArizasi.length) console.warn(`[cron] stok okuma arızası: ${stokArizasi.join(', ')} hiçbir satırda okunamadı — Mikro kolon adı/şema kontrol edin`);

      // ── Cariler: tam sayfalama + upsert (tedarikçi tipi dahil) ─────────────
      const cariler = await cronPullAll('CariListesiV2', 'CariListesi', {
        FieldName: 'cari_kod,cari_unvan1,cari_unvan2,cari_vdaire_no,cari_vdaire_adi,cari_EMail,cari_CepTel,cari_efatura_fl,cari_hareket_tipi,cari_baglanti_tipi',
        WhereStr: "cari_baglanti_tipi=0 and cari_lastup_date > '2000/01/01'",
        Sort: 'cari_kod',
      });
      void mirrorMikroCariler(cariler);
      const leadSnap = await deps().tenantSnap('leads', companyId);
      const leadByKod = new Map<string, AdminDocRef>();
      const leadByVkn = new Map<string, AdminDocRef>();
      const leadByName = new Map<string, AdminDocRef>();
      const normalizeVknCron = (v?: string) => (v || '').replace(/\D/g, '');
      for (const d of leadSnap.docs) {
        const data = d.data();
        const kod = (data.mikroCariKod as string)?.trim();
        if (kod && !leadByKod.has(kod)) leadByKod.set(kod, d.ref);
        const vkn = normalizeVknCron((data.taxId as string) || (data.taxNo as string));
        if (vkn && !leadByVkn.has(vkn)) leadByVkn.set(vkn, d.ref);
        const nameKey = firmaAnahtari(data);
        if (nameKey && !leadByName.has(nameKey)) leadByName.set(nameKey, d.ref);
      }
      let cariYeni = 0, cariGuncel = 0;
      // Eşlemeler özete girer: bir alan TÜM satırlarda okunamıyorsa bu veri değil
      // kolon adı/şema sorunudur — elle import'ta olduğu gibi burada da yüksek sesle söylenir.
      const cariEslemeleri: CariEsleme[] = [];
      for (const c of cariler) {
        // TEK KAYNAK: bilinmeyen alan `alanlar`da HİÇ YOK → `batch.update` ona
        // DOKUNMAZ (elle girilmiş e-posta/telefon/VKN korunur). Yeni kayıtta
        // bilinmeyen metin alanları `yeniKayitAlanlari`nda '' ile açılır.
        const esleme = cariEsle(c, { companyId, zamanDamgasi: deps().pgServerTimestamp() });
        if (!esleme) continue;                 // cari kodu yok → eşleştirilemez
        cariEslemeleri.push(esleme);
        const kod = esleme.cariKod;
        // Oncelik: mikroCariKod -> VKN -> case-insensitive isim (bkz.
        // /api/mikro/import/cari'deki ayni fix - manuel olusturulmus leads'in
        // mikroCariKod'u olmadigi icin salt-kod eslesme onlari ikinci kez
        // olusturuyordu). VKN bilinmiyorsa alan YOK — o kola hiç girilmez.
        // `alanlar.taxId` ya kırpılmış bir string'tir ya da HİÇ YOKTUR (bilinmiyor) —
        // tip dökümü yerine gerçek kontrol (CLAUDE.md: yaklaşık tip yazma).
        const taxIdHam = esleme.alanlar.taxId;
        const vkn = normalizeVknCron(typeof taxIdHam === 'string' ? taxIdHam : undefined);
        const nameKey = isimAnahtari(esleme.alanlar.name);
        const ref = leadByKod.get(kod)
          || (vkn ? leadByVkn.get(vkn) : undefined)
          || (nameKey ? leadByName.get(nameKey) : undefined);
        if (ref) { batch.update(ref, esleme.alanlar); cariGuncel++; }
        else {
          const newRef = db.collection('leads').doc();
          batch.set(newRef, {
            ...esleme.alanlar, ...esleme.yeniKayitAlanlari, source: 'mikro_cron',
            createdAt: deps().pgServerTimestamp(),
          });
          leadByKod.set(kod, newRef);
          cariYeni++;
        }
        if (++ops >= 400) await flush();
      }
      await flush();

      const cariOzet = cariEslemeOzeti(cariEslemeleri);
      if (cariOzet.okumaArizasi.length) {
        console.warn(`[cron] cari okuma arızası: ${cariOzet.okumaArizasi.join(', ')} hiçbir satırda okunamadı — kolon adı/şema kontrol edin.`);
      }
      console.log(`Mikro cron tamamlandı — stok: ${stokYeni} yeni/${stokGuncel} güncel, cari: ${cariYeni} yeni/${cariGuncel} güncel${cariOzet.not ? ` (${cariOzet.not})` : ''}`);
    } catch (err) {
      console.error('Mikro cron sync hatası:', err);
    }
    });
    if ('kilit' in yaziciSonucu) console.warn(`[cron] bakım kilidi (${yaziciSonucu.kilit.aciklama}, ${yaziciSonucu.kilit.baslangic}) — Mikro senkronu bu saat atlandı`);
  });

  // ── Gece 04:00: stok miktar + maliyet senkronu (yalnız V17+) ──────────────
  zamanla('0 4 * * *', async () => {
    if (MIKRO_JUMP_SURUM < 17) return; // GenelAmacliMaliyetListesiV2 V16'da yok
    const cronCreds = await getMikroCreds();
    const db = deps().getAdminDb();
    if (!cronCreds || !db) return;
    console.log('Mikro cron: gece stok miktar senkronu başlatıldı (V17)');
    try {
      // Kiracı ÇÖZÜLÜYOR: bu cron eskiden tüm kiracıların envanterini okuyup
      // hepsinin stok/maliyetini cron kiracısının Mikro'suyla eziyordu.
      const companyId = await cronCompanyId();
      if (!companyId) { console.warn('Mikro gece cron: hedef tenant belirsiz, atlandı.'); return; }
      const invSnap = await deps().tenantSnap('inventory', companyId);
      const items = invSnap.docs
        .map(d => ({ ref: d.ref, sku: ((d.data().sku as string) || '').trim() }))
        .filter(x => x.sku);
      const sonTarih = mikroBugun();
      let updated = 0;
      let batch = db.batch(); let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };
      for (let i = 0; i < items.length; i += 8) {
        const results = await Promise.all(items.slice(i, i + 8).map(async (it) => {
          try {
            const { ok, data } = await mikroPost('GenelAmacliMaliyetListesiV2', {
              StokKod: it.sku, IlkTarih: '2000-01-01', SonTarih: sonTarih, Depolar: '1,2,3,4,5',
            });
            const r0 = ((data as Record<string, unknown>)?.result as Record<string, unknown>[])?.[0];
            if (!ok || !r0 || r0.IsError) return null;
            const d = (r0.Data ?? {}) as Record<string, unknown>;
            // Alan hiç yoksa "0 stok" DEĞİL, "yanıt okunamadı" demektir — 0 yazıp
            // başarılı saymak gerçek stoğu siler. Başarısıza düşür.
            if (d.EldekiMiktar == null) return null;
            const qty = Number(d.EldekiMiktar);
            if (!Number.isFinite(qty)) return null;
            const totalCost = Number(d.MaliyetBedeli ?? 0);
            return { it, qty, cost: qty > 0 ? totalCost / qty : null };
          } catch { return null; }
        }));
        for (const r of results) {
          if (!r) continue;
          batch.update(r.it.ref, {
            stockLevel: r.qty,
            ...(r.cost !== null ? { costPrice: Math.round(r.cost * 100) / 100 } : {}),
            mikroSyncedAt: deps().pgServerTimestamp(),
          });
          updated++;
          if (++ops >= 400) await flush();
        }
      }
      await flush();
      console.log(`Mikro gece senkronu tamamlandı — ${updated} ürün miktarı güncellendi`);
    } catch (err) {
      console.error('Mikro gece senkron hatası:', err);
    }
  });
  console.log('Mikro cron sync aktif (saatlik kart senkronu + 04:00 miktar senkronu) ✓');
}

// ── Weekly email report cron ────────────────────────────────────────────────
// Every Monday at 08:00 — send summary report to REPORT_RECIPIENT_EMAIL
if (process.env.WEEKLY_REPORT_ENABLED === 'true') {
  zamanla('0 8 * * 1', async () => {
    if (!deps().getAdminDb()) return;
    const recipient = process.env.REPORT_RECIPIENT_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
    if (!recipient || !resendKey) {
      console.warn('Weekly report: REPORT_RECIPIENT_EMAIL or RESEND_API_KEY not set, skipping.');
      return;
    }

    try {
      const now  = new Date();
      const d7   = new Date(now); d7.setDate(d7.getDate() - 7);
      const d14  = new Date(now); d14.setDate(d14.getDate() - 14);

      // Kiracı-filtreli (C10 sınıfı, 2026-08-22): haftalık özet e-postası
      // REPORT_RECIPIENT_EMAIL'e gidiyor — yani TEK kiracının sahibine. İçine
      // başka kiracıların sipariş/müşteri/stok rakamlarını katmak hem yanlış
      // rapor hem veri sızıntısı. Tenant, cron'larla aynı kuraldan çözülür.
      const companyId = await deps().serverTenantId();
      if (!companyId) { console.warn('Weekly report: hedef tenant belirsiz, atlandı.'); return; }
      const [ordersSnap, leadsSnap, inventorySnap] = await Promise.all([
        deps().tenantSnap('orders', companyId),
        deps().tenantSnap('leads', companyId),
        deps().tenantSnap('inventory', companyId),
      ]);

      const orders    = ordersSnap.docs.map(d => d.data() as Record<string, unknown>);
      const inventory = inventorySnap.docs.map(d => d.data() as Record<string, unknown>);
      const leads     = leadsSnap.docs.map(d => d.data() as Record<string, unknown>);

      function dateOf(o: Record<string, unknown>): Date {
        const raw = o.createdAt as { toDate?: () => Date } | string | null;
        if (!raw) return new Date(0);
        if (typeof raw === 'string') return new Date(raw);
        return raw.toDate?.() ?? new Date(0);
      }

      const thisWeek = orders.filter(o => dateOf(o) >= d7);
      const prevWeek = orders.filter(o => dateOf(o) >= d14 && dateOf(o) < d7);
      // TUTARI BİLİNMEYEN SİPARİŞ SESSİZCE ₺0 SAYILMAZ (2026-09-19): Mikro faturasından
      // türetilen siparişte `cha_meblag` okunamazsa `totalPrice` alanı HİÇ YAZILMIYOR
      // (eslemeFatura sözleşmesi). Eski `|| 0` o siparişi bedava satış sayıyor, haftalık
      // ciro düşük çıkıyor ve yönetici "ciro %18 düştü" oklarını gerçek sanıyordu.
      // Bilinenler toplanır, BİLİNMEYEN SAYISI rapora açıkça yazılır (CLAUDE.md: sahte
      // kesinlik yok — '—' ya da açık not).
      const thisTutar = toplaBilinen(thisWeek, siparisTutari);
      const prevTutar = toplaBilinen(prevWeek, siparisTutari);
      // EKRAN ≠ TÜRETME (para.donemKarsilastir): ciro kısmi toplam olabilir ('—' hiç bilinen yoksa), ama ok ve
      // yüzde iki haftadan birinde TEK sipariş bile bilinmiyorsa HİÇ basılmaz — ilk düzeltme toplamı `toplaBilinen`e
      // çevirmiş, sapmayı yine kısmi toplamdan türetmişti ("▼ %30" / "₺0 ▼ %100"; 2026-09-19 kapanış incelemesi).
      const karsilastirma = donemKarsilastir(thisTutar, prevTutar);
      const ciroMetni = Number.isFinite(karsilastirma.ekran) ? `₺${karsilastirma.ekran.toLocaleString('tr-TR')}` : '—';
      const tutarsizSiparis = thisTutar.bilinmeyen + prevTutar.bilinmeyen;
      const lowStock = inventory.filter(i => ((i.stockLevel as number) || 0) <= ((i.lowStockThreshold as number) || 5));
      const newLeads = leads.filter(l => dateOf(l) >= d7).length;

      const arrow    = karsilastirma.yon === 'artis' ? '▲' : '▼';
      const color    = karsilastirma.yon === 'artis' ? '#10b981' : '#ef4444';

      // Etiket İş takviminde (tetik de öyle); süreç dilimine bırakılırsa Pasifik
      // sunucuda Pazartesi 08:00 İstanbul = Pazar 22:00 yazar (inceleme 2026-09-24).
      const gunStr = (t: Date) => t.toLocaleDateString('tr-TR', { timeZone: IS_SAAT_DILIMI });
      const weekStr = `${gunStr(d7)} – ${gunStr(now)}`;

      const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.5px;">CETPA Haftalık Rapor</h1>
      <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:13px;">${weekStr}</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Sipariş Sayısı</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">${thisWeek.length}</span>
            <span style="color:#86868b;font-size:12px;margin-left:8px;">(geçen hafta: ${prevWeek.length})</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Ciro</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">${ciroMetni}</span>
            ${karsilastirma.yuzde !== null ? `<span style="color:${color};font-size:12px;font-weight:700;margin-left:8px;">${arrow} %${Math.abs(karsilastirma.yuzde)}</span>` : ''}
            ${tutarsizSiparis > 0 ? `<br><span style="color:#86868b;font-size:11px;">Bu hafta ${thisTutar.bilinmeyen}, geçen hafta ${prevTutar.bilinmeyen} siparişin tutarı bilinmiyor — toplama dâhil değil, karşılaştırma yapılmadı</span>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Yeni Müşteri Adayı</span><br>
            <span style="font-size:28px;font-weight:800;color:#1d1d1f;">${newLeads}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0;">
            <span style="font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:.5px;">Düşük Stok Uyarısı</span><br>
            <span style="font-size:28px;font-weight:800;color:${lowStock.length > 0 ? '#ef4444' : '#10b981'};">${lowStock.length} ürün</span>
            ${lowStock.length > 0 ? `<p style="font-size:11px;color:#86868b;margin:4px 0 0;">${lowStock.slice(0, 5).map(i => i.name as string).join(', ')}${lowStock.length > 5 ? ' …' : ''}</p>` : ''}
          </td>
        </tr>
      </table>
    </div>
    <div style="background:#f5f5f7;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#86868b;margin:0;">Bu rapor otomatik olarak gönderilmiştir. CETPA B2B SaaS</p>
    </div>
  </div>
</body></html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    resendGonderici(),
          to:      [recipient],
          subject: `CETPA Haftalık Rapor — ${weekStr}`,
          html,
        }),
      });
      console.log(`Weekly report sent to ${recipient}`);
    } catch (err) {
      console.error('Weekly report cron hatası:', err);
    }
  });
  console.log('Weekly email report cron aktif (Pazartesi 08:00) ✓');
}

}
