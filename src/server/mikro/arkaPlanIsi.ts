/**
 * arkaPlanIsi.ts — Mikro import ARKA PLAN İŞİ, TEK KAYNAK (mikro-import-arkaplan, 2026-09-24).
 *
 * NEDEN: Teşhis (teshis-mikro-import-2026-09-24.json, CONFIRMED) — Stok/Cari İçeri Al ve 12 SQL
 * import ucu işi HTTP isteğinin İÇİNDE bitiriyordu; IIS/ARR ~120 sn'de bağlantıyı kesip 502 dönüyor,
 * kullanıcı "Cari Hareketler (Tümü)"nü çalıştıramadığı için LUCA dekontları (ödemeler) ekrana hiç
 * gelmiyordu. Desen `import/stok-miktar`'da HAZIRDI (süreç-içi bayrak + `(async () => {…})()` +
 * `jobs/stokMiktarImport` ilerleme dokümanı + anında `{ started:true }`) ama TEK yerdeydi. Üç rotaya
 * daha kopyalamak yerine gövde buraya çıkarıldı; stok-miktar DÂHİL 4 çağrı yeri (S1-S4) buna bağlanır.
 *
 * SAF: Express/`req`/`res` YOK — db, syncLog, audit, PG havuzu ENJEKTE (`src/server/mikro/*` deseni;
 * mikroRoutes bu modülü import eder, tersi değil — server.ts'teki döngü gerekçesi).
 *
 * KARARLAR (her biri kodda yorumlu):
 *  • KİLİT SÜREÇ-GENELİ TEK İŞ (K-C): Mikro tek servis, eşzamanlı yükte çöküyor; aynı anda yalnız
 *    BİR import koşar, FARKLI isAdi de `alreadyRunning` alır (job = ÇALIŞAN işin adı). Rezervasyon
 *    SENKRON yapılır ki kilit/doküman `await`leri sırasında gelen ikinci istek araya giremesin.
 *  • Başlangıç dokümanı `set` MERGE'SİZ (stok-miktar 2671 paritesi): önceki koşunun
 *    depoUyusmazlik/uyusmazlikOrnek/durationMs alanları silinir, "önceki koşu hatası" temizlenir.
 *  • `companyId` HER koşuda damgalanır: `jobs` TENANT koleksiyonudur (collections.ts); SSE süzgeci
 *    `companyId = cid OR etiketsiz` — bugün damgasız olduğu için herkese akıyordu.
 *  • Yazıcı kaydı (`yaziciAdi`) İŞ ÖMRÜNCE durur: eski `yaziciyiIstegeBagla` kaydı yanıtın 'finish'
 *    olayında siliyordu; anında yanıtla bu, işi daha ilk saniyede "yazıcı değil" sayar, `lead-birlestir`
 *    scripti canlı import'un üstüne koşardı. `undefined` → kilit/yazıcı YOK (SQL import paritesi).
 *  • IIFE `p` HİÇBİR yolda reject etmez: Node 24'te unhandledRejection süreci ÇÖKERTİR. Her hata
 *    dokümana `error` + `console.error` (2825 mirası sessiz `.catch(() => {})` YOK) + syncLog(false).
 *  • İstisnada syncLog HER ZAMAN yazılır — `kendiYazar` yalnız başarı yolunda geçerlidir (calistir
 *    yazamadan öldü). stok-miktar için bu YENİ (bugün istisnada syncLog yazmıyordu — iyileşme).
 *  • İŞİN SONUCU ≠ DEFTER TUTMA (hakem 2026-09-25): sonuç YALNIZ `calistir`dan gelir. Bitiş dokümanı /
 *    syncLog / audit yazımı ayrı ayrı korunur (`defter`): biri düşerse loglanır, diğerleri yine denenir,
 *    iş "hata"ya DÖNMEZ — eskiden hepsi aynı try'daydı; başarılı koşunun ardından bitiş `set`i düşünce
 *    catch ikinci bir 'bulk'/false syncLog atıyor, aynı koşu için hem başarılı hem başarısız satır
 *    oluşuyordu. Senkron atan enjekte fonksiyon da (`.catch` bağlanamaz) aynı korumaya girer.
 *  • Slot rezervasyondan SONRAKİ her adım try içinde: `doc()` bile senkron atsa slot + yazıcı kaydı
 *    bırakılır (eskiden `jobRef`/`t0` try DIŞINDAYDI → kilit süreç ömrünce dolu kalabilirdi).
 *  • BİTİŞ SİNYALİ EN SON (delta hakem 2026-09-25, bulgu 2): `running:false` yazımı pgShim'de INSERT biter
 *    bitmez SSE'ye yayılır ve istemci (`isiBaslatVeBekle`) onu "kilit boş" sayıp sonraki adımı hemen POST
 *    eder. Eskiden sıra set(running:false) → syncLog + audit + yazıcı DELETE (3-5 PG turu) → birak() idi;
 *    o arada gelen başlatma `alreadyRunning` alıyor, Tümünü Çek 'Cariler' adımını hiç çalıştırmadan hatalı
 *    sayıyordu (hakem yeniden üretti). Artık: defter (syncLog/audit) → yazıcı silme → bitiş set → `birak()`
 *    AYNI mikro görev zincirinde. Yayın ile slot bırakma arasında G/Ç yok; istemcinin POST'u en az bir
 *    ağ turu (makro görev) sonra gelir.
 *  • AÇILIŞ TARAMASI (`yetimIsleriKapat`, delta bulgu 1/11): `calisanlar` süreçle sıfırlanır ama jobs
 *    dokümanı running:true KALIR (deploy = Stop/Restart-Service; çökme). NSSM tek süreç koşturduğu için
 *    açılışta running:true görünen kayıt KESİN yetimdir → error ile kapatılır, syncLog'a başarısız satır
 *    yazılır, bu sürecin arka plan yazıcı kayıtları silinir. Staging AYRI veritabanında (setup-staging.ps1
 *    "staging must NEVER share the live database") — staging açılışı canlı işleri kapatamaz.
 *  • ÖN KONTROL (`arkaPlanOnKontrol`, delta bulgu 3/8): rota pahalı bir yoklama (stok-miktar V17) yapmadan
 *    ÖNCE kısa devreyi (alreadyRunning) ve bakım kilidini (423) sorar — HEAD 2582 "kısa devre ÖNCE,
 *    hiçbir sorgu yok" kuralı. Otorite yine `arkaPlanIsiBaslat`'tır (yoklama sürerken durum değişebilir).
 */
import type { AdminDbLike, AdminDocRef } from '../adminDbTypes.js';
import { aktifYazicilar, bakimKilidiVar, yaziciKaydet, yaziciSil, type SqlCalistirici } from '../bakimKilidi.js';
import { pgServerTimestamp } from '../pgShim.js';
import { mikroIsAdi } from '../../lib/mikroIsAdi.js';

/** jobs/<isAdi> dokümanına merge edilen alanlar (panel okur). Sayı alanları `Number.isFinite`; sıfır
 *  varsayılanı YOK — bilinmeyen sayaç YAZILMAZ, istemci "—" basar. */
export type IsIlerleme = Record<string, unknown>;

export interface IsOzeti {
  /** Bitişte merge edilir (stokMiktarImport paritesi: processed/updated/failed/depoUyusmazlik/uyusmazlikOrnek). */
  jobAlanlari: IsIlerleme;
  /** writeSyncLog entityId (özet metni) — mevcut rota metinleri AYNEN. */
  ozet: string;
  /** writeSyncLog success. */
  basarili: boolean;
  /** writeSyncLog error; dokümana `error` olarak da düşer (basarili değilse — `isHatasi` verilmediyse). */
  hata: string | null;
  /** jobs dokümanının `error` alanı; VERİLMEZSE `basarili ? null : hata`. Ayrı alan, çünkü syncLog
   *  başarısı ile "iş hatayla bitti" her zaman aynı şey değil: stok-miktar'da okunamayan SKU syncLog'u
   *  success:false yapar (HEAD 2819) ama iş TAMAMLANMIŞTIR — sayısı `failed`da, doküman `error`u null
   *  kalır (HEAD 2798-2803 bitiş merge'i `error`a dokunmuyordu; istemci.md §0: `error` yalnız hata
   *  dalında). Dolu `error` kartta 'tamamlandı' yerine 'Son koşu hatası' basar ve Tümünü Çek adımını
   *  HATA saydırır (isiBaslatVeBekle reddeder). */
  isHatasi?: string | null;
}

export type Aktor = { uid: string; email: string };

export interface ArkaPlanBagimlilik {
  db: AdminDbLike;
  /** C.writeSyncLog — imza server.ts (operation, entityType, entityId, success, mikroRef, error, duration, actor), DEĞİŞMEZ. */
  writeSyncLog: (...a: unknown[]) => Promise<unknown>;
  writeAuditLog: (actor: Aktor, etiket: string, ozet: string) => Promise<unknown>;
  /** Yazıcı kaydı için; yoksa (lokal Firestore) kilit mekanizması yok. */
  pgPool: SqlCalistirici | null | undefined;
  /** Test için saat. */
  simdi?: () => number;
}

export interface ArkaPlanIsi {
  /** = mikroIsAdi(route) (`src/lib/mikroIsAdi.ts` TEK sözlük): 'mikroImport-<slug>', stok-miktar 'stokMiktarImport'.
   *  jobs/<isAdi> doküman id'si + kilit anahtarı + yanıt `job` değeri (ÖNEKSİZ). */
  isAdi: string;
  /** reqCompanyId çıktısı (ham uid DEĞİL) — jobs dokümanına DAMGALANIR. */
  companyId: string;
  actor: Aktor;
  senkronKaydi: { operation: string; entityType: string; kendiYazar?: boolean; denetimEtiketi?: string };
  /** undefined → bakım kilidi/yazıcı kaydı YOK. Verilirse kayıt iş BİTENE KADAR durur (dosya başlığı). */
  yaziciAdi?: string;
  calistir: (ilerle: (alanlar: IsIlerleme) => Promise<void>) => Promise<IsOzeti>;
}

export type BaslatSonucu =
  | { started: true; job: string }
  | { started: false; alreadyRunning: true; job: string }
  | { started: false; kilit: { aciklama: string; baslangic: string } };

/** Koşan işler: isAdi → bitiş sözü (asla reject etmez). Süreç-geneli TEK iş kuralı `size > 0` ile. */
const calisanlar = new Map<string, Promise<void>>();

/** 423 gövdesi — rotalarda 8 kez kopyalanan metin; 3 uç artık bunu kullanır (kalan 5 Faz 4). */
export function bakimKilidiMesaji(k: { aciklama: string; baslangic: string }): string {
  return `Bakım kilidi: ${k.aciklama} (${k.baslangic}) — veri bakımı bitince tekrar deneyin.`;
}

/** Arka plan işlerinin yazıcı kaydı adı öneki — rota adı üretir, açılış taraması bununla bulur (tek kaynak).
 *  Not: mikroRoutes'ta 2 senkron uç (`yaziciyiIstegeBagla`, Faz 4) da `mikro-import:<zaman>` kullanır; onların
 *  kaydı da süreç ömrüne bağlıdır (`res.finish`), açılışta yetimdir — tarama onları da siler (doğru). */
export const ARKA_PLAN_YAZICI_ONEKI = 'mikro-import:';
/** `mikro-import:<isAdi>:<zaman36>` — bakım scripti bu ada bakar (bakimKilidi.ts yazicilariBekle). */
export function arkaPlanYaziciAdi(isAdi: string, simdiMs: number): string {
  return `${ARKA_PLAN_YAZICI_ONEKI}${isAdi}:${simdiMs.toString(36)}`;
}

/** Koşan işin adı; yoksa null. SENKRON — hiçbir sorgu yok (stok-miktar 2582 kuralı). */
export function arkaPlanIsiKosan(): string | null {
  const kosan = calisanlar.keys().next();
  return kosan.done ? null : kosan.value;
}

/**
 * Yanıt ÖNCESİ ucuz ön kontrol: rota pahalı bir adımdan (stok-miktar V17 yoklaması — PG + Mikro çağrısı,
 * sonucu 10 dk önbellekli) ÖNCE çağırır. Koşan iş varsa `alreadyRunning` (job = koşan iş, K-C), `bakimKilidi`
 * istenmişse ve kilit varsa `{ kilit }` (yalnız OKUMA — yazıcı kaydı `arkaPlanIsiBaslat` açar); ikisi de yoksa
 * null. Neden: kilit doluyken yoklama koşan işe paralel Mikro'ya gidiyor, yük altında düşerse `false` 10 dk
 * önbelleğe giriyor ve kullanıcı "Başka bir iş çalışıyor" yerine yanıltıcı 501 görüyordu (delta bulgu 3/8).
 */
export async function arkaPlanOnKontrol(
  dep: Pick<ArkaPlanBagimlilik, 'pgPool'>,
  secenek: { bakimKilidi: boolean },
): Promise<BaslatSonucu | null> {
  const kosan = arkaPlanIsiKosan();
  if (kosan !== null) return { started: false, alreadyRunning: true, job: kosan };
  if (secenek.bakimKilidi) {
    const kilit = await bakimKilidiVar(dep.pgPool);
    if (kilit) return { started: false, kilit };
  }
  return null;
}

/** Koşan işin bitişini bekler (yoksa hemen döner). Tüketici: testler + ileride ops ucu. ASLA reject etmez. */
export function arkaPlanIsiBekle(isAdi: string): Promise<void> {
  const p = calisanlar.get(isAdi);
  return p ? p.then(() => undefined, () => undefined) : Promise.resolve();
}

export async function arkaPlanIsiBaslat(dep: ArkaPlanBagimlilik, is: ArkaPlanIsi): Promise<BaslatSonucu> {
  const simdi = dep.simdi ?? (() => Date.now());
  const { isAdi, companyId, actor, senkronKaydi, yaziciAdi } = is;

  // 1) Kısa devre ÖNCE (stok-miktar 2582 kuralı): bu yardımcı içinde hiçbir sorgu maliyeti ödenmez. Rotanın
  //    KENDİ pahalı adımı varsa (stok-miktar V17 yoklaması) onu `arkaPlanOnKontrol` ile ÖNCE sorar.
  //    Süreç-geneli TEK iş: Map'te NE varsa (isAdi fark etmez) → alreadyRunning, job = koşan iş.
  const kosan = arkaPlanIsiKosan();
  if (kosan !== null) return { started: false, alreadyRunning: true, job: kosan };

  // Rezervasyon SENKRON: aşağıdaki await'ler (yazıcı kaydı, kilit, başlangıç dokümanı) sırasında
  // ikinci istek gelirse 1. adımda kısa devreye çarpar. Map'teki söz iş bitince (finally) çözülür;
  // `arkaPlanIsiBekle` onu bekler. Söz asla reject edilmez.
  let bitir!: () => void;   // ! : hemen altındaki Promise yapıcısı senkron atar
  const omur = new Promise<void>(r => { bitir = r; });
  calisanlar.set(isAdi, omur);
  const birak = () => { calisanlar.delete(isAdi); bitir(); };

  // 2) Yazıcı kaydı + bakım kilidi (bakimKilidi.ts `yaziciOlarakCalistir` sırası: kaydol → kilide bak).
  //    Pool yoksa (lokal) atlanır. Kayıt iş ÖMRÜNCE durur — finally'de silinir (dosya başlığı).
  const pool = yaziciAdi ? dep.pgPool : null;
  const yaziciyiSil = async () => {
    if (!pool || !yaziciAdi) return;
    // try/await: yaziciSil senkron atsa da (`.catch` bağlanamaz) yakalanır — slot bırakma yolunda.
    try { await yaziciSil(pool, yaziciAdi); }
    catch (e) { console.error(`[arkaPlanIsi ${isAdi}] yazıcı kaydı silinemedi:`, e); }
  };
  // Rezervasyondan SONRAKİ her adım try içinde (dosya başlığı): `doc()`/saat senkron atsa bile slot bırakılır.
  let jobRef: AdminDocRef;
  let t0: number;
  try {
    jobRef = dep.db.collection('jobs').doc(isAdi);
    t0 = simdi();
    if (pool && yaziciAdi) {
      await yaziciKaydet(pool, yaziciAdi, new Date(t0).toISOString());
      const kilit = await bakimKilidiVar(pool);
      if (kilit) { await yaziciyiSil(); birak(); return { started: false, kilit }; }
    }
    // 3) Başlangıç dokümanı MERGE'SİZ (2671 paritesi) + companyId/isAdi damgası. `await` edilir:
    //    yanıt dönerken doküman VAR, istemci abone olunca boş görmez. operation/entityType: açılış taraması
    //    (`yetimIsleriKapat`) yarıda kalan koşunun syncLog satırını DOĞRU işlem adıyla yazsın (istemci okumaz).
    await jobRef.set({
      running: true, startedAt: pgServerTimestamp(), finishedAt: null, error: null, companyId, isAdi,
      operation: senkronKaydi.operation, entityType: senkronKaydi.entityType,
    });
  } catch (e) {
    // Yanıt öncesi hata çağırana fırlar (Express 500) — ama slot ve yazıcı kaydı bırakılır.
    await yaziciyiSil();
    birak();
    throw e;
  }

  // 4) Arka plan işi — yanıt hemen döner. `p` HİÇBİR yolda reject etmez (dosya başlığı).
  const ilerle = async (alanlar: IsIlerleme): Promise<void> => {
    // 2793 paritesi: merge:true önceki alanları (companyId dâhil) korur (pgShim mergeDocData shallow).
    // İlerleme yazımı işi DÜŞÜRMEZ: hata yutulur ama loglanır.
    try { await jobRef.set({ ...alanlar, running: true }, { merge: true }); }
    catch (e) { console.warn(`[arkaPlanIsi ${isAdi}] ilerleme yazılamadı:`, e instanceof Error ? e.message : String(e)); }
  };
  /** Defter tutma adımı: düşerse loglanır ve hatası döner (başarıda `null`) — işin sonucunu
   *  DEĞİŞTİRMEZ, sonraki adımı ENGELLEMEZ. `yaz()` try içinde çağrılır: senkron atan fonksiyon da
   *  yakalanır (dosya başlığı). */
  const defter = async (etiket: string, yaz: () => Promise<unknown>): Promise<{ hata: unknown } | null> => {
    try { await yaz(); return null; }
    catch (e) { console.error(`[arkaPlanIsi ${isAdi}] ${etiket} yazılamadı:`, e); return { hata: e }; }
  };
  const mesaj = (e: unknown) => e instanceof Error ? e.message : String(e);

  void (async () => {
    /** Bitiş dokümanı yazımı — EN SON (finally), `birak()` HEMEN ardından (dosya başlığı: bitiş sinyali). */
    let bitisYaz: (() => Promise<void>) | null = null;
    try {
      // SONUÇ yalnız burada belirlenir; aşağıdaki defter yazımları onu değiştiremez.
      let sonuc: { ozet: IsOzeti } | { hata: unknown };
      try { sonuc = { ozet: await is.calistir(ilerle) }; }
      catch (err) { sonuc = { hata: err }; }
      const durationMs = simdi() - t0;

      if ('ozet' in sonuc) {
        const ozet = sonuc.ozet;
        // kendiYazar: SQL import gövdesi (mikroSqlImportCalistir) syncLog'u zaten yazıyor — çift satır YASAK.
        if (!senkronKaydi.kendiYazar) {
          await defter('syncLog', () => dep.writeSyncLog(senkronKaydi.operation, senkronKaydi.entityType, ozet.ozet, ozet.basarili, null, ozet.hata, durationMs, actor));
        }
        // 2820 paritesi: writeSyncLog aktörlüyken zaten audit yazıyor (server.ts); stok-miktar ayrıca
        // etiketli bir kayıt daha atıyordu — çift kayıt BUGÜN de var, parite.
        if (senkronKaydi.denetimEtiketi) {
          const etiket = senkronKaydi.denetimEtiketi;
          await defter('denetim kaydı', () => dep.writeAuditLog(actor, etiket, ozet.ozet));
        }
        bitisYaz = async () => {
          const bitisHatasi = await defter('bitiş dokümanı', () => jobRef.set({
            running: false, finishedAt: pgServerTimestamp(), durationMs,
            ...ozet.jobAlanlari,
            // `!== undefined`: isHatasi:null "hata YOK" demektir, `??` onu yok sayardı (IsOzeti.isHatasi).
            error: ozet.isHatasi !== undefined ? ozet.isHatasi : (ozet.basarili ? null : ozet.hata),
          }, { merge: true }));
          if (bitisHatasi) {
            // Doküman running:true'da KALMASIN (istemci isiBaslatVeBekle 30 dk tavanına kadar bekler, kart
            // "çalışıyor" der). Asgari bitiş: sayaçlar YAZILAMADI → uydurulmaz; iş yapıldı ama sonucu
            // görünmüyor, bunu açıkça söyle. syncLog yukarıda işin GERÇEK sonucunu yazdı.
            await defter('asgari bitiş dokümanı', () => jobRef.set({
              running: false, finishedAt: pgServerTimestamp(), durationMs,
              error: `İş bitti ama sonucu kaydedilemedi: ${mesaj(bitisHatasi.hata)}`,
            }, { merge: true }));
          }
        };
      } else {
        const msg = mesaj(sonuc.hata);
        console.error(`[arkaPlanIsi ${isAdi}] iş hatası:`, sonuc.hata);
        // HER ZAMAN (890/1020 paritesi; stok-miktar için yeni): geçmiş ekranı başarısız koşuyu görsün.
        await defter('syncLog', () => dep.writeSyncLog(senkronKaydi.operation, senkronKaydi.entityType, 'bulk', false, null, msg, durationMs, actor));
        bitisYaz = async () => {
          await defter('hata dokümanı', () => jobRef.set({ running: false, error: msg, finishedAt: pgServerTimestamp() }, { merge: true }));
        };
      }
    } catch (e) {
      // Buraya yalnız enjekte saat (simdi) gibi korunmayan bir adım atarsa düşülür — p yine reject ETMEZ.
      // Doküman running:true'da kalmasın: hata olarak kapatılır (eskiden yalnız loglanıyordu).
      console.error(`[arkaPlanIsi ${isAdi}] beklenmeyen hata:`, e);
      const msg = `Beklenmeyen hata: ${mesaj(e)}`;
      bitisYaz = async () => {
        await defter('hata dokümanı', () => jobRef.set({ running: false, error: msg, finishedAt: pgServerTimestamp() }, { merge: true }));
      };
    } finally {
      // Kilit sızıntısı yok: hangi yoldan çıkılırsa çıkılsın slot + yazıcı kaydı bırakılır. Sıra BİLİNÇLİ:
      // yazıcı kaydı → bitiş dokümanı (SSE yayını) → birak(), son ikisi arasında G/Ç YOK (dosya başlığı).
      // `yaziciyiSil` ve `defter` asla atmaz; `birak()` her durumda çağrılır.
      await yaziciyiSil();
      if (bitisYaz) await bitisYaz();
      birak();
    }
  })();

  return { started: true, job: isAdi };
}

/** Açılış taramasının iş dokümanına ve syncLog'a yazdığı hata metni. */
export const YETIM_IS_HATASI = 'Sunucu yeniden başladı — iş yarıda kaldı; yeniden çalıştırın.';

export interface YetimTaramaBagimlilik {
  db: AdminDbLike;
  /** Yazıcı kaydı temizliği için; yoksa (lokal) atlanır. */
  pgPool: SqlCalistirici | null | undefined;
  /** server.ts writeSyncLog. Süre BİLİNMİYOR → null (panel '—' basar; 0 uydurulmaz). Aktörsüz: açılışta
   *  kimse tetiklemedi, işi başlatan kullanıcı dokümanda tutulmuyor. */
  writeSyncLog: (operation: string, entityType: string, entityId: string, success: boolean,
    mikroRef: string | null, error: string | null, duration: number | null) => Promise<unknown>;
  simdi?: () => number;
  /** Bu sürecin başlangıcı (epoch ms). Bu andan SONRA kaydolmuş yazıcı kaydı CANLI bir koşuya (bu süreç
   *  ya da aynı veritabanını kullanan başka süreç) aittir → SİLİNMEZ. Varsayılan: şimdi − process.uptime(). */
  surecBaslangici?: number;
}

/**
 * Sürecin başlangıç anı (epoch ms) = şimdi − çalışma süresi. TEK formül: açılış taramasının varsayılanı ve
 * server.ts'in açıkça geçirdiği değer bunu kullanır (delta hakem 2026-09-25: server.ts'te kopya formül vardı,
 * hiçbir test onu koşmuyordu). Saniye → milisaniye çevrimi burada.
 */
export function surecBaslangiciMs(simdiMs: number = Date.now(), calismaSn: number = process.uptime()): number {
  return simdiMs - calismaSn * 1000;
}

/**
 * Bu yardımcıdan ÖNCEKİ kodun yazdığı, `isAdi` taşımayan iş kayıtları. Fabrikadan önce arka planda koşan
 * TEK iş stok-miktar'dı (`jobs/stokMiktarImport`); o sürümün kaydı deploy anında `running:true` kaldıysa
 * `isAdi` olmadığı için hiç kapanmaz, kart sonsuza dek 'çalışıyor' derdi (inceleme bulgusu 2026-09-25).
 * Liste KAPALI: başka `isAdi`siz kayıt (bu yardımcının yazmadığı) yine dokunulmaz.
 */
const ESKI_BICIM_ISLER: ReadonlySet<string> = new Set([mikroIsAdi('/api/mikro/import/stok-miktar')]);

/**
 * AÇILIŞ TARAMASI (dosya başlığı): süreç başlarken BİR KEZ çağrılır (server.ts startServer, dinlemeye
 * başlamadan önce). `running:true` + `isAdi` taşıyan jobs dokümanları (bu yardımcının yazdıkları; `isAdi`siz
 * kayıt DOKUNULMAZ — tek istisna ESKI_BICIM_ISLER) `{ running:false, error: YETIM_IS_HATASI, finishedAt }` ile MERGE kapatılır — son
 * ilerleme sayaçları korunur, kart 'Son koşu hatası' basar, bekleyen Tümünü Çek adımı SSE yeniden bağlanınca
 * bitişi görüp reddeder (30 dk asılı kalmaz). Başlangıç dokümanında `operation`/`entityType` varsa syncLog'a
 * başarısız satır yazılır (süre BİLİNMİYOR → null; 0 uydurulmaz; işlem adı yoksa satır yazılmaz). Bu
 * sürecin arka plan yazıcı kayıtları (`ARKA_PLAN_YAZICI_ONEKI`; süreç başlangıcından ÖNCE kaydolanlar) silinir — yoksa 2 saat (YAZICI_BAYAT_MS)
 * aktif sayılıp lead-birlestir'in `yazicilariBekle`ini 15 dk sonra düşürüyordu.
 * ASLA reject etmez (açılışı durdurmaz). BU süreçte koşan iş (`calisanlar`) atlanır: tarama dinlemeden
 * önce koştuğu için normalde boştur; zaman aşımıyla dinleme önce başladıysa canlı iş ezilmesin.
 */
export async function yetimIsleriKapat(dep: YetimTaramaBagimlilik): Promise<{ kapatilan: string[]; silinenYazici: string[] }> {
  const simdi = dep.simdi ?? (() => Date.now());
  const surecBaslangici = dep.surecBaslangici ?? surecBaslangiciMs(simdi());
  const kapatilan: string[] = [];
  const silinenYazici: string[] = [];
  try {
    const snap = await dep.db.collection('jobs').where('running', '==', true).get();
    for (const d of snap.docs) {
      const v = d.data();
      if (calisanlar.has(d.id)) continue;
      if (typeof v.isAdi !== 'string' && !ESKI_BICIM_ISLER.has(d.id)) continue;
      try {
        await d.ref.set({ running: false, error: YETIM_IS_HATASI, finishedAt: pgServerTimestamp() }, { merge: true });
        kapatilan.push(d.id);
      } catch (e) {
        console.error(`[arkaPlanIsi] açılış taraması: ${d.id} kapatılamadı:`, e);
        continue;
      }
      if (typeof v.operation === 'string' && typeof v.entityType === 'string') {
        const { operation, entityType } = v;
        try { await dep.writeSyncLog(operation, entityType, 'bulk', false, null, YETIM_IS_HATASI, null); }
        catch (e) { console.error(`[arkaPlanIsi] açılış taraması: ${d.id} syncLog yazılamadı:`, e); }
      }
    }
  } catch (e) {
    console.error('[arkaPlanIsi] açılış taraması: jobs okunamadı:', e);
  }
  if (dep.pgPool) {
    const pool = dep.pgPool;
    try {
      for (const y of await aktifYazicilar(pool, simdi())) {
        if (!y.ad.startsWith(ARKA_PLAN_YAZICI_ONEKI)) continue;
        // Bu süreç başladıktan SONRA kaydolan yazıcı yarıda kalmış değildir: canlı bir koşu (dinleme
        // taramadan önce başladıysa bu süreçte, ya da aynı PG'yi kullanan başka süreçte). Silinirse
        // lead-birlestir onu beklemeden bakım kilidini alır (inceleme bulgusu 2026-09-25).
        const t = Date.parse(y.baslangic);
        if (Number.isFinite(t) && t >= surecBaslangici) continue;
        try { await yaziciSil(pool, y.ad); silinenYazici.push(y.ad); }
        catch (e) { console.error(`[arkaPlanIsi] açılış taraması: yazıcı kaydı ${y.ad} silinemedi:`, e); }
      }
    } catch (e) {
      console.error('[arkaPlanIsi] açılış taraması: yazıcı kayıtları okunamadı:', e);
    }
  }
  if (kapatilan.length || silinenYazici.length) {
    console.warn(`[arkaPlanIsi] açılış taraması: ${kapatilan.length} yarım iş kapatıldı${kapatilan.length ? ` (${kapatilan.join(', ')})` : ''}, ${silinenYazici.length} yazıcı kaydı silindi`);
  }
  return { kapatilan, silinenYazici };
}
