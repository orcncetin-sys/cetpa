/**
 * gonderimDefteri.ts — Mikro GÖNDERİM DEFTERİ (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md`). Bu sürüm YALNIZ Dilim 0'ın
 * ÖLÇÜM parçasıdır (K0b; v2 K3 / K4 `olcum` / K11 açılış işareti / K12 adım 4 / K20 `kapali | olcum`; § 8.2 commit 0-B):
 *   • kip (`opsLocks/mikroGonderim:kip`; satır yoksa `kapali`; 10 sn süreç içi önbellek; değiştirmek yalnız ops ucuyla),
 *   • kip `olcum` iken `POST /api/mikro/evrak/kaydet`'in her numarasız isteğine GÖVDESİZ bir ölçüm kaydı (`kayitTuru: 'olcum'`),
 *   • açılış işareti (önceki süreçte yarıda kalan ölçüm → `kesildi`), ops özeti.
 * Davranış DEĞİŞMEZ: ölçüm Mikro çağrısını BEKLETMEZ, sonucu yanıtı DEĞİŞTİRMEZ, hatası yutulur (sayaç + boğulmuş günlük).
 *
 * Kayıtlar `docs` tablosunda SERVER_ONLY koleksiyon `mikroGonderimleri`'ndedir (collections.ts): `/api/db`'ye, SSE akışına ve kiracı
 * yedeğine kapalı. Yazımlar doğrudan `pgPool.query` — `broadcastDocChange` ÇAĞRILMAZ. `'mikroGonderimleri'` üstünde INSERT / UPDATE
 * metni YALNIZ bu dosyadadır. Bağımlılık parametreyle gelir (havuz); server.ts'i içe aktarmaz (döngü yok).
 *
 * `olcum` kaydında `sahipUid`, düz `entityId`, gövde ve hata METNİ YOK (v2 K4): yalnız özetler, sayılar, tanımlayıcı adlar.
 */
import { randomUUID } from 'node:crypto';
import { evrakSayisi, govdeOzeti, guvenliAd, hataOlcusu, varlikOzeti, yanitOlcusu } from './gonderimOzeti.js';

/** Defter koleksiyonu — `src/lib/collections.ts` SERVER_ONLY listesindeki adla AYNI (çit: gonderimDefteri.olcum.test.ts). */
export const DEFTER_KOLEKSIYONU = 'mikroGonderimleri';
/** Kip belgesi: `opsLocks` (SERVER_ONLY). `opsLocks`'u bütünüyle tarayan kod yok (Ö15 — bakımKilidi `bakim` / `yazici:%` okur). */
export const KIP_BELGESI = { coll: 'opsLocks', id: 'mikroGonderim:kip' } as const;
export const KIP_ONBELLEK_MS = 10_000;
export const KIP_GECMIS_SINIRI = 10;
export const KIP_NEDENI_EN_UZUN = 200;
/** Bu dilimde kabul edilen kipler. `tam` / `durdur` Dilim 1'le gelir (K20) — ops ucu onları ayrı iletiyle reddeder. */
export type GonderimKipi = 'kapali' | 'olcum';
const SONRAKI_DILIM_KIPLERI: ReadonlySet<string> = new Set(['tam', 'durdur']);

export interface DefterSorgusu {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
}
export interface DefterHavuzu extends DefterSorgusu {
  connect?: () => Promise<DefterSorgusu & { release: () => void }>;
}

// ── Süreç içi durum ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Mikro çağrısı süren (sonucu henüz yazılmamış) ölçüm kayıtları: açılış işareti bunlara dokunmaz (v2 K11 uçuş süzgeci). */
const ucustakiler = new Set<string>();
const SAYAC_BASLANGICI_MS = Date.now();
/** Kayıt açma / sonuç yazma hatası sayacı (süreç içi; ops özeti gösterir — Dilim 0'ın sağlık ölçüsü, v2 K17). */
const kayitHatalari: { acma: number; sonuc: number; sonAt: number | null } = { acma: 0, sonuc: 0, sonAt: null };
/** Bu süreçteki son açılış işareti (zaman + kesilen sayısı); hiç koşmadıysa / havuz yoksa `null`. */
let sonAcilisIsareti: { at: number; kesilen: number } | null = null;

const BOGMA_MS = 5 * 60_000;
const sonUyari = new Map<string, { at: number; bastirilan: number }>();
/** Aynı konudaki uyarı 5 dk'da bir basılır (her istekte günlük taşmasın); bastırılan sayısı bir sonraki satırda söylenir. */
function bogulmusUyari(konu: string, hata: unknown): void {
  const simdi = Date.now();
  const onceki = sonUyari.get(konu);
  if (onceki && simdi - onceki.at < BOGMA_MS) { onceki.bastirilan++; return; }
  const ek = onceki?.bastirilan ? ` (önceki 5 dk'da ${onceki.bastirilan} benzeri bastırıldı)` : '';
  sonUyari.set(konu, { at: simdi, bastirilan: 0 });
  console.warn(`[mikroGonderim] ${konu}: ${hata instanceof Error ? hata.message : String(hata)}${ek}`);
}

// ── Kip ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let kipOnbellegi: { kip: GonderimKipi; bitis: number } | null = null;

/** Belgedeki `kip` alanı: yalnız tanınan değer; yoksa / tanınmıyorsa `kapali` (test düzeneğinin kilit satırı da `kapali` sayılır). */
function kipCoz(veri: unknown): GonderimKipi {
  const kip = veri && typeof veri === 'object' ? (veri as Record<string, unknown>).kip : undefined;
  return kip === 'olcum' ? 'olcum' : 'kapali';
}

/**
 * Geçerli kip. Havuz yok (lokal Firestore yedeği), okuma hatası, satır yok ya da `kip` alanı tanınmıyor → `kapali` (davranış
 * bugünkü yol; v2 K20 «okuma hatası: numarasız → kapali»). Başarılı okuma 10 sn önbellekte; hata önbelleğe YAZILMAZ.
 */
export async function gonderimKipiOku(havuz: DefterSorgusu | null | undefined, simdi: number = Date.now()): Promise<GonderimKipi> {
  if (!havuz) return 'kapali';
  if (kipOnbellegi && kipOnbellegi.bitis > simdi) return kipOnbellegi.kip;
  try {
    const { rows } = await havuz.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [KIP_BELGESI.coll, KIP_BELGESI.id]);
    const kip = kipCoz(rows[0]?.data);
    kipOnbellegi = { kip, bitis: simdi + KIP_ONBELLEK_MS };
    return kip;
  } catch (e) {
    bogulmusUyari('kip okunamadı (kapali sayıldı)', e);
    return 'kapali';
  }
}

export type KipYazimSonucu =
  | { tamam: true; kip: GonderimKipi; onceki: GonderimKipi; at: number }
  | { tamam: false; durum: 400 | 503; error: string };

/**
 * Kipi değiştirir (YALNIZ ops ucu — `POST /api/ops/mikro-gonderim-kipi`). `neden` zorunlu (1–200 karakter; YK-8). Belge
 * BİRLEŞTİRİLEREK yazılır: tanınmayan alanlar (ör. Dilim 1'in `ilkNumaraliAt`'ı — H10) korunur; `gecmis` son 10 değişikliği tutar.
 * Tek PG işlemi: satır yoksa boş açılır, `SELECT … FOR UPDATE` ile kilitlenir, birleştirilip yazılır.
 */
export async function gonderimKipiYaz(havuz: DefterHavuzu | null | undefined, girdi: { kip?: unknown; neden?: unknown },
  simdi: number = Date.now()): Promise<KipYazimSonucu> {
  const kip = girdi.kip;
  if (typeof kip === 'string' && SONRAKI_DILIM_KIPLERI.has(kip)) {
    return { tamam: false, durum: 400, error: `«${kip}» kipi bu sürümde yok; yalnız «kapali» ya da «olcum» seçilebilir.` };
  }
  if (kip !== 'kapali' && kip !== 'olcum') return { tamam: false, durum: 400, error: 'kip «kapali» ya da «olcum» olmalı.' };
  const neden = typeof girdi.neden === 'string' ? girdi.neden.trim() : '';
  const uzunluk = [...neden].length;
  if (uzunluk < 1 || uzunluk > KIP_NEDENI_EN_UZUN) {
    return { tamam: false, durum: 400, error: `neden zorunlu (1–${KIP_NEDENI_EN_UZUN} karakter).` };
  }
  if (!havuz || !havuz.connect) return { tamam: false, durum: 503, error: 'pg havuzu yok (lokal Firestore fallback)' };
  const istemci = await havuz.connect();
  let onceki: GonderimKipi;
  try {
    await istemci.query('BEGIN');
    await istemci.query("INSERT INTO docs (coll, id, data) VALUES ($1, $2, '{}'::jsonb) ON CONFLICT (coll, id) DO NOTHING",
      [KIP_BELGESI.coll, KIP_BELGESI.id]);
    const { rows } = await istemci.query('SELECT data FROM docs WHERE coll = $1 AND id = $2 FOR UPDATE', [KIP_BELGESI.coll, KIP_BELGESI.id]);
    const ham: unknown = rows[0]?.data;
    const mevcut: Record<string, unknown> = ham && typeof ham === 'object' && !Array.isArray(ham) ? ham as Record<string, unknown> : {};
    onceki = kipCoz(mevcut);
    const gecmis = Array.isArray(mevcut.gecmis) ? mevcut.gecmis : [];
    const yeni = {
      ...mevcut,
      kip, neden, at: simdi, kaynak: 'ops',
      gecmis: [...gecmis, { kip, onceki, neden, at: simdi }].slice(-KIP_GECMIS_SINIRI),
    };
    await istemci.query('UPDATE docs SET data = $3::jsonb, updated_at = now() WHERE coll = $1 AND id = $2',
      [KIP_BELGESI.coll, KIP_BELGESI.id, JSON.stringify(yeni)]);
    await istemci.query('COMMIT');
  } catch (e) {
    await istemci.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    istemci.release();
  }
  // Bu süreçteki önbellek hemen yeni değere geçer (ops değişikliği beklemeden etkir); öteki süreçler ≤ 10 sn.
  kipOnbellegi = { kip, bitis: simdi + KIP_ONBELLEK_MS };
  return { tamam: true, kip, onceki, at: simdi };
}

// ── Ölçüm kaydı ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OlcumGirdisi {
  /** İsteğin kiracısı — bugünkü okuma (`reqCompanyId`; ölçüm karar vermez). Söz olarak gelir: Mikro çağrısı onu BEKLEMEZ. */
  companyId: Promise<string> | string;
  uc: string;
  method: string;
  entityType: unknown;
  entityId: unknown;
  payload: unknown;
}

export type OlcumSonucu =
  | { tur: 'yanit'; yanit: { ok: boolean; status: number; data: unknown }; gonderilmedi: boolean; stub: boolean; sureMs: number }
  | { tur: 'hata'; hata: unknown; gonderilmedi: boolean; sureMs: number };

export interface OlcumKaydi {
  readonly id: string;
  /** Sonucu yazar (kayıt açıldıktan SONRA; bir kez — ikinci çağrı yok sayılır). Söz ASLA reddetmez; çağıran beklemez. */
  bitir: (sonuc: OlcumSonucu) => Promise<void>;
}

/**
 * Ölçüm kaydını AÇAR ve hemen döner: INSERT arkada koşar, Mikro çağrısı onu BEKLEMEZ (M0.7). Havuz yoksa `null` (kayıt yok).
 * Açma hatası yutulur: sayaç artar, günlük boğulur; `bitir` o durumda hiçbir şey yazmaz.
 */
export function olcumBaslat(havuz: DefterSorgusu | null | undefined, girdi: OlcumGirdisi, saat: () => number = Date.now): OlcumKaydi | null {
  if (!havuz) return null;
  const id = `o_${randomUUID()}`;
  ucustakiler.add(id);
  const acildi: Promise<boolean> = (async () => {
    const companyId = await girdi.companyId;
    const t = saat();
    const veri = {
      kayitTuru: 'olcum',
      companyId,
      uc: girdi.uc,
      method: girdi.method,
      entityType: guvenliAd(girdi.entityType, 60),
      govdeOzeti: govdeOzeti(girdi.method, girdi.payload),
      varlikOzeti: varlikOzeti(companyId, girdi.method, girdi.entityType, girdi.entityId),
      evrakSayisi: evrakSayisi(girdi.payload),
      durum: 'suruyor',
      olusturmaAt: t,
      guncellemeAt: t,
    };
    await havuz.query('INSERT INTO docs (coll, id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (coll, id) DO NOTHING',
      [DEFTER_KOLEKSIYONU, id, JSON.stringify(veri)]);
    return true;
  })().catch((e: unknown) => {
    kayitHatalari.acma++; kayitHatalari.sonAt = Date.now();
    bogulmusUyari('ölçüm kaydı açılamadı', e);
    return false;
  });
  let bitti = false;
  return {
    id,
    bitir: async (sonuc: OlcumSonucu): Promise<void> => {
      if (bitti) return;
      bitti = true;
      try {
        if (!(await acildi)) return;
        const t = saat();
        const olcu = sonuc.tur === 'yanit'
          ? { ...yanitOlcusu(sonuc.yanit, evrakSayisi(girdi.payload)), hataAdi: null, hataKodu: null }
          : { httpDurum: null, jsonMu: null, resultUzunlugu: null, hataliOgeSayisi: null, evrakSayisi: evrakSayisi(girdi.payload),
              yanitAnahtarlari: [] as string[], ...hataOlcusu(sonuc.hata) };
        const { yanitAnahtarlari, ...sonucAlanlari } = olcu;
        const ek = {
          durum: 'bitti',
          guncellemeAt: t,
          sonuc: { ...sonucAlanlari, sureMs: sonuc.sureMs },
          yanitAnahtarlari,
          gonderilmedi: sonuc.gonderilmedi,
          stub: sonuc.tur === 'yanit' ? sonuc.stub : false,
        };
        await havuz.query(
          "UPDATE docs SET data = data || $3::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'durum' = 'suruyor'",
          [DEFTER_KOLEKSIYONU, id, JSON.stringify(ek)]);
      } catch (e) {
        kayitHatalari.sonuc++; kayitHatalari.sonAt = Date.now();
        bogulmusUyari('ölçüm sonucu yazılamadı', e);
      } finally {
        ucustakiler.delete(id);
      }
    },
  };
}

/**
 * AÇILIŞ İŞARETİ (v2 K11, Dilim 0 kolu): önceki süreçte Mikro çağrısı sürerken kesilen ölçüm kaydı (`suruyor`) `kesildi` olur,
 * `kesenSurec` = bu sürecin başlangıcı (yayın başına kesilen gönderim — C9). İki süzgeç: son güncelleme süreç başlangıcından ÖNCE
 * VE kayıt bu süreçte uçuşta değil — bu süreçte açılan kayda dokunulmaz, bu yüzden dinlemeyi bekletmez. Bildirim yok. Fırlatmaz.
 */
export async function olcumAcilisIsareti(havuz: DefterSorgusu | null | undefined, surecBaslangici: number,
  simdi: number = Date.now()): Promise<{ kesilen: number }> {
  if (!havuz) return { kesilen: 0 };
  try {
    const r = await havuz.query(
      "UPDATE docs SET data = data || jsonb_build_object('durum', 'kesildi', 'guncellemeAt', $2::bigint, 'kesenSurec', $3::bigint), updated_at = now() "
      + "WHERE coll = $1 AND data->>'kayitTuru' = 'olcum' AND data->>'durum' = 'suruyor' "
      + "AND jsonb_typeof(data->'guncellemeAt') = 'number' AND (data->>'guncellemeAt')::numeric < $3 "
      + 'AND NOT (id = ANY($4::text[])) RETURNING id',
      [DEFTER_KOLEKSIYONU, simdi, Math.floor(surecBaslangici), [...ucustakiler]]);
    sonAcilisIsareti = { at: simdi, kesilen: r.rows.length };
    return { kesilen: r.rows.length };
  } catch (e) {
    console.error('[mikroGonderim] açılış işareti yapılamadı:', e instanceof Error ? e.message : String(e));
    return { kesilen: 0 };
  }
}

// ── Ops özeti (saf toplayıcılar + okuyucu) ──────────────────────────────────────────────────────────────────────────────────
export const OLCUM_PENCERESI_GUN = 30;
const GUN_MS = 24 * 60 * 60_000;
const AYNI_GOVDE_PENCERESI_MS = 15 * 60_000;
const AYNI_VARLIK_PENCERESI_MS = 7 * GUN_MS;

const sayi = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const metin = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const artir = (sayac: Record<string, number>, anahtar: string): void => {
  sayac[anahtar] = Object.hasOwn(sayac, anahtar) ? sayac[anahtar] + 1 : 1;
};

/** Ölçülen gönderim BAŞARILI mı (K7 başarı kuralı): HTTP 2xx, JSON, `result` dolu, hiçbir öğe `IsError` değil, sayı = evrak sayısı. */
function basariMi(sonuc: Record<string, unknown>): boolean {
  const http = sayi(sonuc.httpDurum);
  const uzunluk = sayi(sonuc.resultUzunlugu);
  const evrak = sayi(sonuc.evrakSayisi);
  return http !== null && http >= 200 && http < 300 && sonuc.jsonMu === true && uzunluk !== null && uzunluk > 0
    && sonuc.hataliOgeSayisi === 0 && (evrak === null || evrak === uzunluk);
}

export interface OlcumOzeti {
  pencereGun: number;
  toplam: number;
  son24Saat: number;
  durumBasina: Record<string, number>;
  stub: number;
  gonderilmedi: number;
  httpDurumu: Record<string, number>;
  jsonMu: { evet: number; hayir: number };
  /** `<hata adı>/<neden kodu>` → sayı (C3). */
  hata: Record<string, number>;
  /** `<result uzunluğu>/<evrak sayısı>` → sayı (C11); `-` = bilinmiyor. */
  resultEvrak: Record<string, number>;
  /** Yöntem → yanıt anahtar yolu → sayı (C2). */
  yanitAnahtarlari: Record<string, Record<string, number>>;
  /** Yayın (süreç) başına kesilen ölçüm (C9), en yeni önce. */
  kesildiSurecBasina: Array<{ surecBaslangici: string; sayi: number }>;
  /** C10: 15 dk içinde aynı içerik; 7 gün içinde aynı varlık (ikinci gönderim başarılı mı). */
  tekrar: { ayniGovde15dk: number; ayniVarlik7gun: { toplam: number; ikincisiBasarili: number; ikincisiBasarisiz: number; ikincisiBilinmiyor: number } };
}

/**
 * Pencere içindeki `olcum` kayıtlarının SAYI özeti. Çıktıda kiracı, kullanıcı, varlık kimliği, özet karması ve gövde YOK — yalnız
 * sayılar, HTTP durumu, tanımlayıcı adlar ve yanıt anahtar yolları.
 */
export function olcumOzeti(satirlar: ReadonlyArray<Record<string, unknown>>, simdi: number): OlcumOzeti {
  const ozet: OlcumOzeti = {
    pencereGun: OLCUM_PENCERESI_GUN, toplam: 0, son24Saat: 0, durumBasina: {}, stub: 0, gonderilmedi: 0,
    httpDurumu: {}, jsonMu: { evet: 0, hayir: 0 }, hata: {}, resultEvrak: {}, yanitAnahtarlari: {}, kesildiSurecBasina: [],
    tekrar: { ayniGovde15dk: 0, ayniVarlik7gun: { toplam: 0, ikincisiBasarili: 0, ikincisiBasarisiz: 0, ikincisiBilinmiyor: 0 } },
  };
  const kesilen: Record<string, number> = {};
  // Zamanı sayı olmayan satır sayılmaz (bilinmeyen zaman 0 sayılıp sıraya sokulmaz).
  const sirali = satirlar.flatMap(s => { const at = sayi(s.olusturmaAt); return at === null ? [] : [{ s, at }]; })
    .sort((a, b) => a.at - b.at);
  const sonGovde = new Map<string, number>();
  const sonVarlik = new Map<string, number>();
  for (const { s, at } of sirali) {
    ozet.toplam++;
    if (at > simdi - GUN_MS) ozet.son24Saat++;
    const durum = metin(s.durum) ?? '-';
    artir(ozet.durumBasina, ['suruyor', 'bitti', 'kesildi'].includes(durum) ? durum : 'diger');
    if (s.stub === true) ozet.stub++;
    if (s.gonderilmedi === true) ozet.gonderilmedi++;
    const sonuc = s.sonuc && typeof s.sonuc === 'object' ? s.sonuc as Record<string, unknown> : null;
    if (sonuc) {
      const http = sayi(sonuc.httpDurum);
      if (http !== null) artir(ozet.httpDurumu, String(http));
      if (sonuc.jsonMu === true) ozet.jsonMu.evet++; else if (sonuc.jsonMu === false) ozet.jsonMu.hayir++;
      const hataAdi = metin(sonuc.hataAdi);
      if (hataAdi !== null) artir(ozet.hata, `${hataAdi}/${metin(sonuc.hataKodu) ?? '-'}`);
      if (http !== null) artir(ozet.resultEvrak, `${sayi(sonuc.resultUzunlugu) ?? '-'}/${sayi(sonuc.evrakSayisi) ?? '-'}`);
    }
    const method = guvenliAd(s.method, 80) || '-';
    if (Array.isArray(s.yanitAnahtarlari)) {
      const yollar = (ozet.yanitAnahtarlari[method] ??= {});
      for (const y of s.yanitAnahtarlari) if (typeof y === 'string') artir(yollar, y);
    }
    if (durum === 'kesildi') {
      const surec = sayi(s.kesenSurec);
      if (surec !== null) artir(kesilen, String(surec));
    }
    // C10 — 15 dk içinde aynı içerik (aynı kiracı + yöntem + gövde özeti).
    const govde = metin(s.govdeOzeti);
    if (govde !== null) {
      const anahtar = `${metin(s.companyId) ?? ''}|${method}|${govde}`;
      const onceki = sonGovde.get(anahtar);
      if (onceki !== undefined && at - onceki <= AYNI_GOVDE_PENCERESI_MS) ozet.tekrar.ayniGovde15dk++;
      sonGovde.set(anahtar, at);
    }
    // C10 — 7 gün içinde aynı varlık (özet kiracı + yöntem + tür + kimliği zaten taşır); ikinci gönderimin sonucuyla.
    const varlik = metin(s.varlikOzeti);
    if (varlik !== null) {
      const onceki = sonVarlik.get(varlik);
      if (onceki !== undefined && at - onceki <= AYNI_VARLIK_PENCERESI_MS) {
        const v = ozet.tekrar.ayniVarlik7gun;
        v.toplam++;
        if (durum !== 'bitti' || !sonuc) v.ikincisiBilinmiyor++;
        else if (basariMi(sonuc)) v.ikincisiBasarili++;
        else v.ikincisiBasarisiz++;
      }
      sonVarlik.set(varlik, at);
    }
  }
  ozet.kesildiSurecBasina = Object.entries(kesilen).map(([surec, n]) => ({ surec: Number(surec), n }))
    .sort((a, b) => b.surec - a.surec).slice(0, 20)
    .map(k => ({ surecBaslangici: new Date(k.surec).toISOString(), sayi: k.n }));
  return ozet;
}

const ESKI_KUYRUK_DURUMLARI: ReadonlySet<string> = new Set(['queued', 'in-progress', 'success', 'failed', 'dead']);
export interface SyncJobsOzeti { toplam: number; durumBasina: Record<string, number>; son30GunOlu: number; enEskiCreatedAt: string | null }

/** Eski istemci kuyruğu (`syncJobs`) — durum sayıları, son 30 günde `dead` olan, en eski `createdAt` (C1). İş içeriği YOK. */
export function syncJobsOzeti(satirlar: ReadonlyArray<{ durum: unknown; olusturma: unknown; guncelleme: unknown }>, simdi: number): SyncJobsOzeti {
  const ozet: SyncJobsOzeti = { toplam: 0, durumBasina: {}, son30GunOlu: 0, enEskiCreatedAt: null };
  let enEski: number | null = null;
  for (const s of satirlar) {
    ozet.toplam++;
    const durum = typeof s.durum === 'string' && ESKI_KUYRUK_DURUMLARI.has(s.durum) ? s.durum : 'diger';
    artir(ozet.durumBasina, durum);
    const guncelleme = sayi(s.guncelleme);
    if (durum === 'dead' && guncelleme !== null && guncelleme > simdi - 30 * GUN_MS) ozet.son30GunOlu++;
    const olusturma = sayi(s.olusturma);
    if (olusturma !== null && (enEski === null || olusturma < enEski)) enEski = olusturma;
  }
  ozet.enEskiCreatedAt = enEski === null ? null : new Date(enEski).toISOString();
  return ozet;
}

export interface MikroGonderimOzeti {
  kip: { kip: GonderimKipi; at: string | null; gecmis: Array<{ kip: string; onceki: string; neden: string; at: string | null }> };
  /** Defterdeki satırlar: kayıt türü → durum → sayı (bütün zamanlar). */
  kayitlar: Record<string, Record<string, number>>;
  olcum: OlcumOzeti;
  syncJobs: SyncJobsOzeti;
  /** Süreç içi: ölçüm kaydı açma / sonuç yazma hatası ve uçuştaki kayıt sayısı. */
  surec: {
    baslangic: string; kayitAcmaHatasi: number; sonucYazmaHatasi: number; sonHataAt: string | null; ucustaki: number;
    sonAcilisIsareti: { at: string; kesilen: number } | null;
  };
}

const isoYaDaNull = (v: unknown): string | null => { const n = sayi(v); return n === null ? null : new Date(n).toISOString(); };

/** Ops özeti için defteri, kip belgesini ve eski kuyruğu okur (fırlatabilir — çağıran 500'e çevirir). */
export async function mikroGonderimOzetiOku(havuz: DefterSorgusu, simdi: number = Date.now()): Promise<MikroGonderimOzeti> {
  const kipSatiri = await havuz.query('SELECT data FROM docs WHERE coll = $1 AND id = $2', [KIP_BELGESI.coll, KIP_BELGESI.id]);
  const kipVeri = (kipSatiri.rows[0]?.data ?? {}) as Record<string, unknown>;
  const gecmis = Array.isArray(kipVeri.gecmis) ? kipVeri.gecmis : [];
  const sayim = await havuz.query(
    "SELECT data->>'kayitTuru' AS tur, data->>'durum' AS durum, count(*)::int AS n FROM docs WHERE coll = $1 GROUP BY 1, 2",
    [DEFTER_KOLEKSIYONU]);
  const kayitlar: Record<string, Record<string, number>> = {};
  for (const r of sayim.rows) {
    const tur = guvenliAd(r.tur, 40) || '-';
    const durum = guvenliAd(r.durum, 40) || '-';
    (kayitlar[tur] ??= {})[durum] = Number(r.n);
  }
  const olcumler = await havuz.query(
    "SELECT data FROM docs WHERE coll = $1 AND data->>'kayitTuru' = 'olcum' AND jsonb_typeof(data->'olusturmaAt') = 'number' "
    + "AND (data->>'olusturmaAt')::numeric > $2 LIMIT 20000",
    [DEFTER_KOLEKSIYONU, simdi - OLCUM_PENCERESI_GUN * GUN_MS]);
  const isler = await havuz.query(
    "SELECT data->'status' AS durum, data->'createdAt' AS olusturma, data->'updatedAt' AS guncelleme FROM docs WHERE coll = 'syncJobs'");
  return {
    kip: {
      kip: kipCoz(kipVeri),
      at: isoYaDaNull(kipVeri.at),
      gecmis: gecmis.filter((g): g is Record<string, unknown> => !!g && typeof g === 'object').map(g => ({
        kip: String(g.kip ?? ''), onceki: String(g.onceki ?? ''), neden: String(g.neden ?? ''), at: isoYaDaNull(g.at),
      })),
    },
    kayitlar,
    olcum: olcumOzeti(olcumler.rows.map(r => (r.data ?? {}) as Record<string, unknown>), simdi),
    syncJobs: syncJobsOzeti(isler.rows.map(r => ({ durum: r.durum, olusturma: r.olusturma, guncelleme: r.guncelleme })), simdi),
    surec: {
      baslangic: new Date(SAYAC_BASLANGICI_MS).toISOString(),
      kayitAcmaHatasi: kayitHatalari.acma,
      sonucYazmaHatasi: kayitHatalari.sonuc,
      sonHataAt: isoYaDaNull(kayitHatalari.sonAt),
      ucustaki: ucustakiler.size,
      sonAcilisIsareti: sonAcilisIsareti ? { at: new Date(sonAcilisIsareti.at).toISOString(), kesilen: sonAcilisIsareti.kesilen } : null,
    },
  };
}
