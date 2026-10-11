/**
 * magazaRoutes.ts — mağaza (www.cetpa.com.tr) uçlarının TEK zinciri.
 *
 * KİMLİKSİZ yüzey: istek başka bir kökenden (statik mağaza sitesi) gelir; oturum, rol, kiracı bilgisi yoktur.
 * Bu yüzden uçlar rota modüllerinin olağan düzeninde (`xRoutes(app, C)`) DEĞİL, kendi `express.Router()`
 * zincirindedir ve her isteği KENDİSİ sonlandırır — genel sınırlayıcıya, genel ayrıştırıcıya, öteki rota
 * modüllerine, genel hata yakalayıcıya DÜŞMEZ.
 *
 * SIRA SABİT (çit: magazaRoutes.test.ts «kayıt sırası»; aşağıdaki `r.use` / `r.post` satırları):
 *   0. `/panel` alt zinciri (dilim 2a; `magazaPanelZinciri.ts`, bağlamla gelir) — köken kapısından ve genel sınırlayıcıdan ÖNCE
 *      bağlanır ve her isteği KENDİSİ sonlandırır (kendi köken kapısı `GET, POST` + `Authorization`; kendi kovaları). Eşleşmeyi
 *      Express yapar: `req.path` / `originalUrl` karşılaştırması YOK (`/PANEL/siparisler` de alt zincire gider).
 *   1. köken kapısı (CORS) — `OPTIONS` burada 204 ile BİTER, hiçbir kovaya sayılmaz; izinsiz köken 403
 *   2. genel sınırlayıcı (`C.apiLimiter`; mağaza muaf DEĞİL)
 *   3. mağaza sınırlayıcıları — talep ve durum AYRI kova, her biri BİR kez (server.ts kurar, bağlamla gelir)
 *   4. 415 denetimi — ayrıştırıcıdan ÖNCE; kendiliğinden gelmez (ölçüldü: `text/plain` gövde ayrıştırılmadan
 *      rotaya `req.body === undefined` ile ulaşıyor)
 *   5. gövde: 64 KB (`MAGAZA_GOVDE_SINIRI_BAYT`). Genel ayrıştırıcıdan ÖNCE çalışmak ZORUNDADIR; sonra bağlanan
 *      ayrıştırıcı sınırı uygulamaz (ölçüldü — `opsRoutes.ts` `/api/ops/yayinla` deseni KOPYALANMAZ)
 *   6. iki rota  7. zincir içi 404  8. zincir içi hata yakalayıcı (4 parametreli)
 *
 * BOYUT — İKİ SINIR, ikisi de teknik korumadır (iş sınırı DEĞİL; kalem sayısına / adede sınır YOK — kullanıcı kararı K4):
 *   • GÖVDE en çok 64 KB (adım 5).
 *   • YAZILAN BELGE en çok gövde sınırının 2 katı (`MAGAZA_BELGE_SINIRI_BAYT`); aşan talep 413 alır — yazma, akış
 *     olayı, bildirim YOK. Neden ayrı bir sınır (ölçüldü): eşleyici her kaleme yedi alanı koşulsuz yazar; yalnız
 *     `ad` + `adet` taşıyan kalemlerle 64 KB gövde ~4 katı belgeye dönüşüyordu ve belgenin tamamı akış olayına da
 *     iliştirilir. Mağazanın gönderdiği biçimde (yedi alan da gövdede) çarpan en çok ×1,01'dir: tavan gerçek talebe çarpmaz.
 *
 * YANIT GÖVDELERİ SABİTTİR: `{ ok: true }` / `{ ok: false }` (takip ucunda ek `kod: 'bulunamadi'` / `kod: 'silindi'`; bulunan
 * talepte dar yanıt — aşağıda «TAKİP»). zod ayrıntısı, hata iletisi, gövde parçası DÖNMEZ — rota ortak `validate()` yardımcısını bu yüzden KULLANMAZ.
 * İSTİSNA — bu modülün ÜRETMEDİĞİ iki 429: adım 2'deki genel sınırlayıcının ve zincirden ÖNCE koşan IP başına sel
 * korumasının 429'u kendi sabit gövdesini (`{ error: … }`) taşır ve `r429` sayacına İŞLENMEZ; `r429` yalnız mağaza
 * sınırlayıcılarının (adım 3, `magaza429`) retlerini sayar. Sel koruması zincirin dışındadır: `OPTIONS` ve 403'leri
 * de sayar, 429'u köken başlığı taşımaz (şartname § 1, bilerek — mağaza bunu ağ hatası gibi ele alır). Adım 1'deki
 * «hiçbir kovaya sayılmaz» zincirin KENDİ kovaları (genel + mağaza) içindir.
 *
 * TAKİP (`POST /siparis-durumu`, dilim 2a § 4; V6 / V11): `{ no, telefon }` → kimlik `magazaTalepKimligi(kiracı, no, son 10 hane)`
 * ile TEK satır, DAR okuma (`MAGAZA_TAKIP_SQL`): kalemler SQL'de üç alana (`ad`, `marka`, `adet`) indirilir — SKU, fiyat, `id`,
 * `tedarik`, müşteri bloğu, not, tutarlar belleğe bile ÇEKİLMEZ. Yanıt: aşama (panel sözlüğü), müşteriye görünen açıklama,
 * tarih, son güncelleme, kalem listesi + kalem başına «teslim» işareti. «Bulunamadı» ile «biçim bozuk» BAYT BAYT aynı yanıtı
 * alır (`404 { ok: false, kod: 'bulunamadi' }`) — uç, talep numarası biçimini doğrulayan kâhin olmasın; zincirin rota-yok
 * 404'ü `{ ok: false }` kalır (sonda ikisini ayırt eder). Sayaçları AYRI işlevdedir: `magazaTakipSayaclari()`.
 * SİLİNMİŞ talep (dilim 2b, § 10.6; kullanıcı kararı: «talebiniz silinmiş desin; hiç olmadıysa bulunamadı»): dar okuma `silindi`nin
 * TÜRÜNÜ de getirir; nesneyse `404 { ok: false, kod: 'silindi' }` — gövde YALNIZ bu iki alan (aşama, açıklama, tarih, kalem
 * listesi DÖNMEZ). Geri alınan (`silindi: null`) ve hiç silinmemiş talep bulunur. Bu yanıt, talep no + telefonu bilen kişiye
 * talebin var olup silindiğini açıklar (ikisi müşterinin kendi bilgisidir; tarama sınırlayıcısı aynı kalır).
 *
 * GÜNLÜK: kişisel veri (ad, telefon, adres, vergi no, not), gövde parçası ve hata NESNESİ yazılmaz. body-parser
 * hata iletisi gövdenin ilk karakterlerini, `err.body` gövdenin TAMAMINI taşır; pg hata nesnesinin `detail` /
 * `where` alanı JSON verisinden parça taşır (ölçüldü). Yazılan tek şey sabit metin + hata kodu (`hataKodu`).
 * 4xx retleri günlüğe HİÇ yazılmaz (kimliksiz uç — her ret bir satır olsaydı günlük dışarıdan doldurulabilirdi);
 * süreç içi sayaçlara işlenir, bekçi okur.
 */
import express, { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MAGAZA_TALEP_KOLEKSIYONU, MAGAZA_TALEP_NO_DESENI, magazaAsamasiMi, magazaGuncellemeZamani, magazaKalemTeslimMi, panelDurumuna } from '../../lib/magazaTalep.js';
import { MAGAZA_BILDIRIM_KALEM_SINIRI } from '../kanal/magazaBildirim.js';
import { MAGAZA_METIN_SINIRLARI, magazaMetniKirp, magazaMetniTemizle, magazaTalepKimligi, talepEsle, telefonSon10 } from '../kanal/magazaTalep.js';
import { EKLEME_SQL } from '../kanal/magazaTalepSql.js';
import { MagazaSiparisDurumuSchema, MagazaSiparisTalebiSchema } from '../schemas.js';

/** Ham SQL çalıştıran en dar havuz yüzeyi (pg `Pool` buna uyar). */
export interface MagazaPgHavuzu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** server.ts'ten ihtiyaç duyulan HER ŞEY — açık liste (import DEĞİL; döngü olurdu). */
export interface MagazaRouteCtx {
  /**
   * Genel /api sınırlayıcısı; zincirde CORS'tan SONRA koşar (mağaza muaf DEĞİL). 429'unu KENDİSİ üretir: gövdesi bu
   * modülün sabit gövdesi değildir ve `r429` sayacına işlenmez (dosya başı «İSTİSNA»).
   */
  apiLimiter: RequestHandler;
  /**
   * Talep ve durum uçlarının sınırlayıcıları (AYRI kova; yalnız IP anahtarlı). Modül sınırlayıcı KURMAZ — server.ts'te kurulur:
   * hız sınırı çiti (`hizSiniri.degismez.test.ts`) «rota modüllerinde `rateLimit(` yok» der ve anahtar üretici tablosunu yalnız
   * server.ts'te görür. 429 yanıtını bu modülün `magaza429` işlevi üretir (server.ts onu `handler` seçeneğine verir).
   */
  talepSinirlayici: RequestHandler;
  durumSinirlayici: RequestHandler;
  /**
   * Site paneli alt zinciri (`magazaPanelZinciri(…)`, dilim 2a): server.ts kurar, burada yalnız `/panel` önekine bağlanır.
   * Köken kapısından ve genel sınırlayıcıdan ÖNCE koşar, her isteği KENDİSİ sonlandırır (bu zincire geri dönmez).
   */
  panelZinciri: RequestHandler;
  /** PostgreSQL havuzu; yoksa (yerel Firestore yedeği) uç 503 döner, `adminDb`'ye DÜŞÜLMEZ. */
  getPgPool: () => MagazaPgHavuzu | null;
  /** Kiracı çözümleyici (server.ts `serverTenantId`); boş dizge = çözülemedi → 503, yazma yok. */
  serverTenantId: () => Promise<string>;
  /** pgShim `broadcastDocChange`; yalnız satır GERÇEKTEN eklendiyse çağrılır. */
  broadcastDocChange: (coll: string, type: 'set' | 'delete', id: string, data?: unknown, kapsam?: { cid: string | null }) => void;
  /**
   * Bildirim isteği; yalnız satır GERÇEKTEN eklendiyse ve YANITTAN ÖNCE beklenir.
   * Asla reddetmez (kuyruğa yerel ekleme; kuyruk yoksa süreç içi gönderimi başlatıp döner).
   */
  bildirimIste: (talepId: string) => Promise<void>;
  /** İzinli kökenler (varsayılan: `MAGAZA_IZINLI_KOKENLER` ortam değişkeni → `https://www.cetpa.com.tr`). Test için. */
  izinliKokenler?: () => readonly string[];
  /** Saat (test için). */
  simdi?: () => Date;
}

// ── Süreç içi sayaçlar ────────────────────────────────────────────────────────────────────────────────────────────
// Modül düzeyinde (zincir başına değil): bekçi `magazaSayaclari()`'nı bağlamsız çağırır. Yeniden başlatmada sıfırlanır.
const sayaclar = { eklenen: 0, cakisan: 0, r400: 0, r403: 0, r404: 0, r413: 0, r415: 0, r429: 0, r500: 0, r503: 0 };
type SayacAnahtari = keyof typeof sayaclar;

/**
 * Süreç içi sayaçlar (bekçi okur). Anahtarlar sabit: eklenen, cakisan, r400, r403, r404, r413, r415, r429, r500, r503.
 * `r413` iki sınırı da sayar (gövde + yazılan belge); `r429` YALNIZ mağaza sınırlayıcılarının retlerini (dosya başı «İSTİSNA»).
 */
export function magazaSayaclari(): Readonly<Record<string, number>> {
  return { ...sayaclar };
}

/**
 * Takip sorgusu (`POST /siparis-durumu`) sayaçları — AYRI küme (dilim 2a, § 6; kapı 3 K15): `magazaSayaclari()`'nın sabit
 * anahtarlarına EKLENMEZ ve dilim 1'in `r404`'üyle ortak DEĞİLDİR (bekçi üçüncü parçada basar). `bulunamadi` biçimi bozuk
 * sorguyu da sayar (ikisi aynı yanıttır); 503 / 500 / 429 buraya sayılmaz. `silindi` (2b) = silinmiş talebe gelen sorgu.
 */
const takipSayaclari = { bulundu: 0, bulunamadi: 0, silindi: 0 };

export function magazaTakipSayaclari(): Readonly<Record<string, number>> {
  return { ...takipSayaclari };
}

/** Sayaçları sıfırlar — YALNIZ test için (üretimde çağıranı yok; sayaç süreçle birlikte sıfırlanır). Takip sayaçlarını da. */
export function magazaSayaclariniSifirla(): void {
  for (const anahtar of Object.keys(sayaclar) as SayacAnahtari[]) sayaclar[anahtar] = 0;
  takipSayaclari.bulundu = 0;
  takipSayaclari.bulunamadi = 0;
  takipSayaclari.silindi = 0;
}

/** Zincirin kendi ürettiği ret kodları; her birinin sayacı var. */
type RetKodu = 400 | 403 | 404 | 413 | 415 | 429 | 500 | 503;
const RET_SAYACI: Readonly<Record<RetKodu, SayacAnahtari>> = {
  400: 'r400', 403: 'r403', 404: 'r404', 413: 'r413', 415: 'r415', 429: 'r429', 500: 'r500', 503: 'r503',
};

/** Sabit ret: sayaç + `{ ok: false }`. Gövdeye ayrıntı KONMAZ. */
function reddet(res: Response, kod: RetKodu): void {
  sayaclar[RET_SAYACI[kod]] += 1;
  res.status(kod).json({ ok: false });
}

/** Mağaza sınırlayıcılarının `handler` seçeneği: r429 sayacını artırır, sabit `429 { ok: false }` döndürür. */
export function magaza429(_req: Request, res: Response): void {
  reddet(res, 429);
}

// ── Köken (CORS) ──────────────────────────────────────────────────────────────────────────────────────────────────
export const MAGAZA_VARSAYILAN_KOKEN = 'https://www.cetpa.com.tr';

/**
 * `MAGAZA_IZINLI_KOKENLER` değerini listeye çevirir: virgülle ayrılır, kırpılır, sondaki `/` atılır; boş girdi ve
 * `*` yok sayılır. Geriye bir şey kalmazsa varsayılan köken. Karşılaştırma BİREBİRDİR (büyük / küçük harf çevrilmez).
 * `null` da yok sayılır: korumalı çerçeve / `file:` sayfaları `Origin: null` gönderir — listeye yazılsa herkese açılırdı.
 */
export function magazaIzinliKokenleriCoz(ham: string | undefined): string[] {
  const liste = (ham ?? '')
    .split(',')
    .map(parca => parca.trim().replace(/\/+$/, ''))
    .filter(parca => parca !== '' && parca !== '*' && parca !== 'null');
  return liste.length > 0 ? liste : [MAGAZA_VARSAYILAN_KOKEN];
}

// ── Günlük ────────────────────────────────────────────────────────────────────────────────────────────────────────
const alan = (deger: unknown, ad: string): unknown =>
  (typeof deger === 'object' && deger !== null ? (deger as Record<string, unknown>)[ad] : undefined);

/** En çok 40 birim, yalnız harf / rakam / `._-`: boşluk, tırnak ya da satır sonu taşıyan metin (ileti, gövde parçası) geçemez. */
const KOD_DESENI = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Günlüğe yazılabilecek TEK şey: hata kodu — pg SQLSTATE / Node `code`, body-parser `type`, o da yoksa hata sınıfının adı.
 * İleti, `detail`, `where`, `body`, yığın ASLA okunmaz. Dışa açık: panel alt zinciri ve ERP mağaza uçları aynı işlevi kullanır.
 */
export function hataKodu(hata: unknown): string {
  for (const ad of ['code', 'type', 'name']) {
    const deger = alan(hata, ad);
    if (typeof deger === 'string' && KOD_DESENI.test(deger)) return deger;
  }
  return 'bilinmiyor';
}

// ── Zincir ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Kiracı önbelleği: dolu sonuç 60 sn; boş sonuç en çok 10 sn (yapılandırma düzelince uç kendiliğinden açılır). */
const KIRACI_DOLU_MS = 60_000;
const KIRACI_BOS_MS = 10_000;

/** İstek gövdesinin üst sınırı (bayt; sıkıştırılmışsa AÇILMIŞ boyut). Zincirin kendi ayrıştırıcısı uygular: aşan gövde 413. */
export const MAGAZA_GOVDE_SINIRI_BAYT = 64 * 1024;
/**
 * YAZILAN belgenin üst sınırı (JSON metninin UTF-8 baytı). Gövde sınırından TÜRETİLİR — ayrı bir sayı DEĞİL: gövde
 * sınırı değişirse bu da onunla değişir. Neden ×2 (dosya başı «BOYUT»): mağaza yanıtı okumadığı için gerçek bir
 * talebe dönen 413 sessiz kayıp olurdu; mağaza biçiminde çarpan en çok ×1,01 olduğundan ×2 tavan gerçek talebe çarpmaz.
 */
export const MAGAZA_BELGE_SINIRI_BAYT = 2 * MAGAZA_GOVDE_SINIRI_BAYT;

/**
 * Takip ucunun DAR okuması — TEK `SELECT`, tek satır (kimlik + kiracı). Kalemler SQL'de `ad` / `marka` / `adet` alanlarına
 * İNDİRİLİR: SKU, fiyat, `id`, `tedarik`, `musteri`, `not`, `talepEdilen`, `bildirim*`, `durumGecmisi` belleğe bile çekilmez.
 *  • `jsonb_array_elements` yalnız DİZİ tipinde koşar (`CASE` çiti; dizi değilse boş). Nesne olmayan öğe `WHERE` ile atılır
 *    (belleğe gelmez); `beyan_sayisi` / `teyit_sayisi` dizinin TAM uzunluğudur (atılan öğe sayıma dâhil).
 *  • Beyan kalemi `sira` taşır (dizideki 0 tabanlı yeri): kalem anahtarı `b:<sira>`'dır ve nesne olmayan öğe atılınca
 *    sonraki kalemlerin anahtarı KAYMASIN (işaret yanlış kaleme düşerdi). Sıra `ORDER BY` ile açıkça korunur.
 *  • `teyit*` sütunları 2b içindir (2a'da `teyit_sayisi` 0, `teyit_kalemleri` NULL); teyit kalemi kendi `anahtar`ını taşır.
 *  • `kalem_teslim` yalnız `durum` ve `zaman` için okunur; `kim` yanıta girmez.
 *  • `silindi_turu` (2b): `silindi` alanının TÜRÜ — `'object'` = silinmiş, `'null'` = geri alınmış, NULL = hiç silinmemiş
 *    (`IS NULL` karşılaştırması ikisini karıştırırdı). Silen / zaman belleğe ÇEKİLMEZ (personel bilgisi).
 */
export const MAGAZA_TAKIP_SQL = `SELECT data->>'durum' AS durum, data->>'durumAciklama' AS aciklama, data->>'durumZamani' AS zaman, data->>'olusturma' AS olusturma, (SELECT COALESCE(jsonb_agg(jsonb_build_object('sira', e.sira - 1, 'ad', e.k->'ad', 'marka', e.k->'marka', 'adet', e.k->'adet') ORDER BY e.sira), '[]'::jsonb) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN data->'kalemler' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(k, sira) WHERE jsonb_typeof(e.k) = 'object') AS kalemler, (CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN jsonb_array_length(data->'kalemler') ELSE 0 END) AS beyan_sayisi, (SELECT jsonb_agg(jsonb_build_object('anahtar', e.k->'anahtar', 'ad', e.k->'ad', 'marka', e.k->'marka', 'adet', e.k->'adet') ORDER BY e.sira) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'teyit'->'kalemler') = 'array' THEN data->'teyit'->'kalemler' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(k, sira) WHERE jsonb_typeof(e.k) = 'object') AS teyit_kalemleri, (CASE WHEN jsonb_typeof(data->'teyit'->'kalemler') = 'array' THEN jsonb_array_length(data->'teyit'->'kalemler') ELSE 0 END) AS teyit_sayisi, data->'kalemTeslim' AS kalem_teslim, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/** Takip yanıtının kalemi: müşterinin kendi beyanı (2b'de teyit edilen içerik) + teslim işareti. SKU / fiyat / anahtar YOK. */
export interface MagazaTakipKalemi {
  ad: string;
  marka?: string;
  /** Sonlu sayı değilse `null` (BİLİNMİYOR; sayfa adet basmaz — 0 değil). */
  adet: number | null;
  teslim: boolean;
}

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const metinMi = (v: unknown): v is string => typeof v === 'string';
/** Sayım sütunu (pg `int4` sayı, kimi sürücüde metin döner); okunamayan değer 0 kalemdir (sayım, tutar değil). */
const sayim = (v: unknown): number => {
  const n = metinMi(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
};
/** Saklanan metin `talepEsle` ile zaten temizdir; ikinci geçiş çittir (akış güvenilmez biçimdedir). Tek satır + üst sınır. */
const takipMetni = (v: unknown, sinir: number): string => (metinMi(v) ? magazaMetniKirp(magazaMetniTemizle(v, false), sinir).metin : '');

/** `MAGAZA_TAKIP_SQL` satırından müşteriye dönen yanıt. Tür daraltma: akış güvenilmez biçimdedir (kapı 3 K14, kapı 4 Y5). */
function takipYaniti(s: Record<string, unknown>): Record<string, unknown> {
  // Kaynak: `magazaTeslimKaynagi` ölçütü (teyit kalemleri boş olmayan dizi) — burada dizinin TAM uzunluğundan.
  const teyitSayisi = sayim(s.teyit_sayisi);
  const kaynak: 'beyan' | 'teyit' = teyitSayisi > 0 ? 'teyit' : 'beyan';
  const ham = kaynak === 'teyit' ? s.teyit_kalemleri : s.kalemler;
  const kalemler: MagazaTakipKalemi[] = [];
  for (const k of Array.isArray(ham) ? ham : []) {
    if (kalemler.length >= MAGAZA_BILDIRIM_KALEM_SINIRI) break;
    if (!nesneMi(k)) continue;
    // Beyan kalemi `b:<dizideki yer>`; teyit kalemi sunucunun verdiği `anahtar`. Anahtarı okunamayan kalem «bekliyor»dur.
    const anahtar = kaynak === 'teyit' ? k.anahtar : (typeof k.sira === 'number' && Number.isSafeInteger(k.sira) ? `b:${k.sira}` : undefined);
    const marka = takipMetni(k.marka, MAGAZA_METIN_SINIRLARI.kalemMarka);
    kalemler.push({
      ad: takipMetni(k.ad, MAGAZA_METIN_SINIRLARI.kalemAd),
      ...(marka !== '' ? { marka } : {}),
      adet: typeof k.adet === 'number' && Number.isFinite(k.adet) ? k.adet : null,
      teslim: metinMi(anahtar) && magazaKalemTeslimMi(s.kalem_teslim, anahtar),
    });
  }
  const olusturma = metinMi(s.olusturma) ? s.olusturma : '';
  const aciklama = metinMi(s.aciklama) ? s.aciklama : '';
  return {
    ok: true,
    // Panel sözlüğü (hiçbir kayıtta `yeni` değildir); saklı değer bilinmiyorsa alan YOK (mağaza «Durum güncelleniyor» basar).
    ...(magazaAsamasiMi(s.durum) ? { durum: panelDurumuna(s.durum) } : {}),
    ...(aciklama !== '' ? { aciklama } : {}),
    tarih: olusturma,
    guncelleme: magazaGuncellemeZamani({ olusturma, durumZamani: s.zaman, kalemTeslim: s.kalem_teslim }),
    kaynak,
    kalemler,
    kalemSayisi: kaynak === 'teyit' ? teyitSayisi : sayim(s.beyan_sayisi),
  };
}

/**
 * Kiracı çözücü: sunucu belirler, istemciden ALINMAZ. Kayıt açık olduğu için çözümleyici `users` taramasına düşebilir —
 * her istekte koşmasın diye sonuç önbelleklenir (dolu 60 sn, boş 10 sn). Eşzamanlı istekler TEK çözümlemeyi paylaşır.
 * Önbellek dönen işleve aittir: mağaza zinciri ve panel alt zinciri (`magazaPanelZinciri.ts`) birer örnek kurar — ardışık
 * N istekte çözümleyici zincir başına en çok 1 kez çağrılır. ASLA reddetmez (çözülemeyen kiracı `''`dır → çağıran 503 döner).
 */
export function magazaKiraciCozucuKur(serverTenantId: () => Promise<string>, simdi: () => Date): () => Promise<string> {
  let kiraciOnbellegi: { cid: string; bitis: number } | null = null;
  let suruyorKiraciCozumu: Promise<string> | null = null;
  return (): Promise<string> => {
    if (kiraciOnbellegi && simdi().getTime() < kiraciOnbellegi.bitis) return Promise.resolve(kiraciOnbellegi.cid);
    if (suruyorKiraciCozumu) return suruyorKiraciCozumu;
    suruyorKiraciCozumu = (async () => {
      let cid = '';
      // Çözümleyici fırlatırsa «çözülemedi» sayılır (503, yazma yok); hata nesnesi günlüğe yazılmaz.
      try { cid = await serverTenantId(); } catch { cid = ''; }
      // Yalnız boşluktan oluşan değer de boştur; dolu değer AYNEN kullanılır (öteki yazıcıların damgasıyla aynı kalsın).
      if (typeof cid !== 'string' || cid.trim() === '') cid = '';
      kiraciOnbellegi = { cid, bitis: simdi().getTime() + (cid === '' ? KIRACI_BOS_MS : KIRACI_DOLU_MS) };
      return cid;
    })().finally(() => { suruyorKiraciCozumu = null; });
    return suruyorKiraciCozumu;
  };
}

export function magazaZinciri(C: MagazaRouteCtx): Router {
  const simdi = (): Date => C.simdi?.() ?? new Date();
  const izinliKokenler = (): readonly string[] => C.izinliKokenler?.() ?? magazaIzinliKokenleriCoz(process.env.MAGAZA_IZINLI_KOKENLER);
  const kiraciCoz = magazaKiraciCozucuKur(() => C.serverTenantId(), simdi);

  // 1. Köken kapısı. Elle (yeni paket yok). `Access-Control-Allow-Credentials` YOK: uç çerez / oturum okumaz.
  const kokenKapisi: RequestHandler = (req, res, next) => {
    res.vary('Origin'); // ezmez, ekler
    const koken = req.headers.origin;
    const izinli = typeof koken === 'string' && izinliKokenler().includes(koken);
    if (izinli) {
      res.setHeader('Access-Control-Allow-Origin', koken);
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    // Ön uçuş burada BİTER: sınırlayıcılara ulaşmaz (kovaya sayılmaz), sayaçlara işlenmez.
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (!izinli) { reddet(res, 403); return; }
    next();
  };

  // 4. 415: POST gövdesi JSON değilse (ya da gövde / tür başlığı yoksa) ayrıştırıcıya hiç verilmez.
  const jsonDegilse415: RequestHandler = (req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) { reddet(res, 415); return; }
    next();
  };

  // 6a. Sipariş talebi.
  const siparisTalebi = async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.body === undefined) { reddet(res, 400); return; }
      const cozum = MagazaSiparisTalebiSchema.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }

      // Yazılacak yer yoksa 503 ve YAZMA YOK — `adminDb`'ye (Firestore yedeği) düşülmez.
      const havuz = C.getPgPool();
      if (!havuz) { reddet(res, 503); return; }
      const cid = await kiraciCoz();
      if (cid === '') { reddet(res, 503); return; }

      // Temizlik + kırpma + doküman kurma; `ok: false` = temizlikten sonra zorunlu alan boş / telefonda 10 rakam yok.
      const esleme = talepEsle(cozum.data, { companyId: cid, simdi: simdi() });
      if (!esleme.ok) { reddet(res, 400); return; }

      // Teknik koruma (iş sınırı DEĞİL): kalem varsayılanları gövdeyi büyütür; yazılacak belge sınırı aşarsa 413 ve
      // YAZMA YOK (akış olayı ve bildirim de yok). Ölçülen, veritabanına giden metnin KENDİSİDİR (bir kez üretilir).
      const yazilacak = JSON.stringify(esleme.belge);
      if (Buffer.byteLength(yazilacak, 'utf8') > MAGAZA_BELGE_SINIRI_BAYT) { reddet(res, 413); return; }

      const { rows } = await havuz.query(EKLEME_SQL, [MAGAZA_TALEP_KOLEKSIYONU, esleme.id, yazilacak]);
      if (rows.length === 1) {
        sayaclar.eklenen += 1;
        // Satır yazıldı: bundan sonra hiçbir şey yanıtı DEĞİŞTİREMEZ (yayın ya da bildirim arızası talebi geri almaz).
        try {
          C.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', esleme.id, esleme.belge, { cid });
        } catch (e) {
          console.error('[magaza] talep yazıldı, akış olayı yayınlanamadı:', hataKodu(e));
        }
        // Sözleşmece reddetmez; reddederse de yakalanır (yanıt 201 kalır, yakalanmamış ret olmaz).
        try {
          await C.bildirimIste(esleme.id);
        } catch (e) {
          console.error('[magaza] talep yazıldı, bildirim istenemedi:', hataKodu(e));
        }
      } else {
        // Aynı talep yeniden geldi: mevcut kayda dokunulmadı; akış olayı ve bildirim YOK.
        sayaclar.cakisan += 1;
      }
      // İki durumda da AYNI yanıt — uç, bir talep numarasının var olup olmadığını söyleyen kâhin olmasın.
      res.status(201).json({ ok: true });
    } catch (e) {
      // PostgreSQL dâhil: hata NESNESİ değil, sabit metin + kod.
      console.error('[magaza] sipariş talebi işlenemedi:', hataKodu(e));
      if (!res.headersSent) reddet(res, 500);
    }
  };

  // 6b. Takip sorgusu (dosya başı «TAKİP»). Bulunamadı ve biçim bozuk AYNI yanıt; `takipSayaclari`'na işlenir (`r404` DEĞİL).
  // Silinmiş talebin 404'ü AYRI gövdedir (`kod: 'silindi'`) ve bu işlevden GEÇMEZ.
  const takipBulunamadi = (res: Response): void => {
    takipSayaclari.bulunamadi += 1;
    res.status(404).json({ ok: false, kod: 'bulunamadi' });
  };
  const siparisDurumu = async (req: Request, res: Response): Promise<void> => {
    // Yanıt (200 / 404 / 503 / 500) ara belleğe alınmaz: aşama ve teslim işaretleri her sorguda güncel okunur.
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.body === undefined) { reddet(res, 400); return; }
      const cozum = MagazaSiparisDurumuSchema.safeParse(req.body);
      if (!cozum.success) { reddet(res, 400); return; }

      // Havuz yok / kiracı çözülemedi → 503 ve OKUMA YOK. 404 DEĞİL: mağaza 404'ü «talep bize ulaşmamış olabilir» diye gösterir.
      // Biçim denetiminden ÖNCE: bulunamadı ile biçim bozuk her koşulda aynı yanıtı alsın.
      const havuz = C.getPgPool();
      if (!havuz) { reddet(res, 503); return; }
      const cid = await kiraciCoz();
      if (cid === '') { reddet(res, 503); return; }

      // `no` sunucuda DÖNÜŞTÜRÜLMEZ (büyütmeyi mağaza yapar); desene uymayan değer ve 10 rakamı olmayan telefon «biçim bozuk»tur.
      const son10 = telefonSon10(cozum.data.telefon);
      if (son10 === null || !MAGAZA_TALEP_NO_DESENI.test(cozum.data.no)) { takipBulunamadi(res); return; }
      const { rows } = await havuz.query(MAGAZA_TAKIP_SQL, [MAGAZA_TALEP_KOLEKSIYONU, magazaTalepKimligi(cid, cozum.data.no, son10), cid]);
      const satir = rows[0];
      if (!satir) { takipBulunamadi(res); return; }
      // (2b) Silinmiş talep: «bulunamadı» DEĞİL, ayrı kod — ve talebin içeriğinden HİÇBİR şey dönmez. Geri alınmış (`'null'`)
      // ve hiç silinmemiş (NULL) talep aşağıda bulunur.
      if (satir.silindi_turu === 'object') {
        takipSayaclari.silindi += 1;
        res.status(404).json({ ok: false, kod: 'silindi' });
        return;
      }
      const yanit = takipYaniti(satir);
      takipSayaclari.bulundu += 1;
      res.status(200).json(yanit);
    } catch (e) {
      // Okuma hatası 500'dür (404 değil); hata NESNESİ değil, sabit metin + kod.
      console.error('[magaza] takip sorgusu işlenemedi:', hataKodu(e));
      if (!res.headersSent) reddet(res, 500);
    }
  };

  // 7. `/api/magaza` altındaki her başka yol ve yöntem (bayi uçları ayrı dilim).
  const bulunamadi = (_req: Request, res: Response): void => { reddet(res, 404); };

  // 8. Zincir içi hata yakalayıcı. DÖRT parametre şart: Express hata yakalayıcıyı parametre sayısından tanır.
  // `next(err)` ÇAĞRILMAZ — genel yakalayıcı `err.message`'ı günlüğe basar ve 500 döndürür.
  const hataYakalayici = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) { req.socket.destroy(); return; }
    // body-parser: `entity.parse.failed` → 400, `entity.too.large` → 413, `charset.unsupported` / `encoding.unsupported` → 415.
    const durum = alan(err, 'status');
    if (typeof durum === 'number' && Number.isInteger(durum) && durum >= 400 && durum <= 499) {
      // Sayaç anahtarları sabit: kendi sayacı olmayan 4xx «400» sayacına işlenir; yanıt kodu AYNEN döner.
      sayaclar[durum in RET_SAYACI ? RET_SAYACI[durum as RetKodu] : 'r400'] += 1;
      res.status(durum).json({ ok: false });
      return;
    }
    console.error('[magaza] zincir hatası:', hataKodu(err));
    reddet(res, 500);
  };

  const r = Router();
  r.use('/panel', C.panelZinciri);
  r.use(kokenKapisi);
  r.use(C.apiLimiter);
  r.use('/siparis-talebi', C.talepSinirlayici);
  r.use('/siparis-durumu', C.durumSinirlayici);
  r.use(jsonDegilse415);
  r.use(express.json({ limit: MAGAZA_GOVDE_SINIRI_BAYT }));
  r.post('/siparis-talebi', siparisTalebi);
  r.post('/siparis-durumu', siparisDurumu);
  r.use(bulunamadi);
  r.use(hataYakalayici);
  return r;
}
