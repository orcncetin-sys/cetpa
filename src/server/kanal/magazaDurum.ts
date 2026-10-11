/**
 * magazaDurum.ts — mağaza talebinin aşama / açıklama, kalem teslim, elle bildirim ve etiket YAZMA işlevleri (dilim 2a, § 2).
 *
 * Panel (`routes/magazaPanelZinciri.ts`) ve ERP (`routes/magazaErpRoutes.ts`) uçları AYNI işlevleri çağırır; yazma kuralı
 * tek yerdedir. Bağımlılıklar bağlamla gelir (`MagazaDurumDeps`); modül pgShim / server.ts içe aktarmaz.
 *
 * ORTAK KURALLAR:
 *  • KİMLİK deseni tutmuyorsa veritabanına gidilmez (`bulunamadi` / `gecersiz`).
 *  • DAR OKUMA: belgenin tamamı çekilmez; `musteri`, `not`, `talepEdilen`, `bildirim*` SELECT metninde YOKTUR.
 *  • KOŞULLU YAZIM (CAS): koşul kiracı + okunan `durum` + okunan `durumSurum` (kalem teslimde + okunan `icerikSurum`).
 *    Satır dönmezse yeniden okunur ve güncel aşama / `surum-eski` / `bulunamadi` döner — sessiz geri alma, başkasının
 *    müşteriye görünen notunu ezme YOK (kapı 2 deneyi S-A).
 *  • YAMA ANAHTAR KÜMESİ KAPALI: okunan belgenin yayılımı (`{ ...okunan }`) yamaya GİREMEZ — kapı karşı örneği
 *    `bildirim: 'gitti'`yi `'bekliyor'`a geri yazıp çift posta üretmişti. `bildirim`, `durumGecmisi`, `kalemTeslim`,
 *    `kalemler`, `teyit`, `etiketBasildi` aşama yamasında yoktur; her yazım yalnız kendi alanına dokunur.
 *  • YAYIN: `broadcastDocChange` ile yayınlanan belge `RETURNING data` satırıdır; kiracı etiketi dönen satırın
 *    `companyId`'sinden (etiketsiz olay BÜTÜN kiracılara giderdi — dilim 1 `sonucYaz` kalıbı).
 *  • DENETİM: `diff` ELLE kurulur (`computeFieldDiff` dizi / nesneyi kırpmadan yazar); ayrıntıya müşteri adı, telefon,
 *    açıklama METNİ, anahtar listesi, tutar GİRMEZ. Denetim başarısızlığı yazımı GERİ ALMAZ.
 *  • Zamanlar uygulamada `toISOString()` ile üretilir; SQL `now()` ile damgalanmaz (`+03:00` ekli değer yazılmaz — § 4
 *    KAPALI süzgeci ve `magazaGuncellemeZamani` metin sırasına dayanır).
 *
 * `bildirim` alanına aşama / kalem yazımı DOKUNMAZ (kapı ölçümü: bildirim yazımı `jsonb_set(data, '{bildirim}', …)` ile
 * aşama yazımı aynı satırda iki sırada da iki alanı korudu). § 2.10 yalnız `bildirim`e `jsonb_set` ile dokunur.
 *
 * DİLİM 2b (§ 10.2 son paragraf, § 10.9): SİLİNMİŞ TALEP DONUKTUR (V17) — buradaki DÖRT yazma işlevi de dar okumada
 * `silindi_turu` okur, yazım koşuluna `MAGAZA_SILINMEMIS_SQL` ekler ve `{ sonuc: 'silindi' }` döner (rota 409). Ölçüt her
 * yerde `jsonb_typeof(data->'silindi')`: nesne = silinmiş, JSON `null` = geri alınmış, yok = hiç silinmemiş (`IS NULL`
 * KULLANILMAZ — ikisini karıştırır). Kalem teslim CAS'ının `icerikSurum` koşulu teyit yazımıyla CANLANIR (`surum-eski`);
 * elle bildirim `tur: 'revize'` kazanır (`BILDIRIM_REVIZE_YENIDEN_SQL` — `bildirimRevize` nesnesi bütünüyle DEĞİŞTİRİLMEZ).
 * İçerik / silme / geri alma / elle talep yazımı AYRI dosyada: `kanal/magazaIcerik.ts` (aynı bağlam, aynı yardımcılar).
 */
import {
  MAGAZA_DURUM_ACIKLAMA_SINIRI, MAGAZA_DURUM_GECMISI_SINIRI, MAGAZA_KALEM_ANAHTARI_DESENI, MAGAZA_TALEP_KIMLIK_DESENI,
  MAGAZA_TALEP_KOLEKSIYONU, magazaAsamasiMi, magazaGecisi,
} from '../../lib/magazaTalep.js';
import type { MagazaDurumGecisi, MagazaKalemTeslimGirisi, MagazaKanal, MagazaTalepAsamasi } from '../../lib/magazaTalep.js';
import { magazaMetniKirp, magazaMetniTemizle } from './magazaTalep.js';
import type { MagazaPgHavuzu } from '../routes/magazaRoutes.js';

/** server.ts'ten / rota bağlamından gelen her şey — açık liste (import DEĞİL; döngü olurdu). */
export interface MagazaDurumDeps {
  /** PostgreSQL havuzu; yoksa işlev FIRLATIR (rota havuzu önce kendisi denetler ve 503 döner — dilim 1 kalıbı). */
  getPgPool: () => MagazaPgHavuzu | null;
  broadcastDocChange: (coll: string, type: 'set' | 'delete', id: string, data?: unknown, kapsam?: { cid: string | null }) => void;
  writeAuditLog: (actor: { uid: string; email: string }, action: string, details: string, diff?: Record<string, { from: unknown; to: unknown }>) => Promise<void>;
  /** Dilim 1 sözleşmesi (`magazaRoutes.ts` `bildirimIste`): asla reddetmez; kuyruk yoksa süreç içi gönderim; veri `{ talepId }`. */
  bildirimIste: (talepId: string) => Promise<void>;
  simdi?: () => Date;
}

/**
 * Dilim 2b'nin GENİŞ bağlamı — ERP uçlarının `D`'si budur (`MagazaDurumDeps`'in üst kümesi: buradaki ve `magazaIcerik.ts`'teki
 * bütün yazma işlevlerine geçer). Site paneli içerik yazmaz ve bildirim istemez; dar `MagazaDurumDeps` ile kalır (`talepSil`
 * dar bağlamı kabul eder). `revizeBildirimiIste` ZORUNLUDUR: içerik yazımı (`talepIcerigiDegistir`) ve revize bildirimini elle
 * yeniden kuyruğa alma (`bildirimiYenidenKuyrugaAl`, `tur: 'revize'`) bu tipi ister — bağlanmadan derlenmez («yazıldı ama
 * bağlanmadı» çiti derleyicidedir).
 */
export interface MagazaIcerikDeps extends MagazaDurumDeps {
  /**
   * Revize bildirimi isteği (ikinci kuyruk `MAGAZA_REVIZE_KUYRUGU`; server.ts `magazaBildirimIsteyici` kalıbıyla kurar).
   * `bildirimIste` ile AYNI sözleşme: asla reddetmez; kuyruk yoksa süreç içi gönderim; iş verisi yalnız `{ talepId }` (gövde
   * bilgisi belgedeki `bildirimRevize`'dedir). Yalnız yazım GERÇEKTEN yapıldıysa ve yanıttan ÖNCE beklenir.
   */
  revizeBildirimiIste: (talepId: string) => Promise<void>;
  /** Elle talep numarası üreteci (test için); varsayılan `elleTalepNoUret` (`magazaIcerik.ts`). */
  elleNoUret?: (simdi: Date) => string;
  /** Teyit kalemi anahtarı üreteci (test için); varsayılan `t:` + `randomBytes(6)` onaltılık. */
  teyitAnahtariUret?: () => string;
}

export interface MagazaYazan {
  uid: string;
  /** Yazma anında `panelKullanicisi(uid).ad` (iki kanalda da); belirteçteki `ad` yalnız panel başlığıdır. */
  ad: string;
  eposta: string;
}

// Aşağıdaki yardımcılar `kanal/magazaIcerik.ts` (2b yazma yolu) ile ORTAKTIR — oraya kopyalanmaz, buradan içe aktarılır.
export type Satir = Record<string, unknown>;
export const nesneMi = (v: unknown): v is Satir => typeof v === 'object' && v !== null && !Array.isArray(v);
export const metin = (v: unknown): string => (typeof v === 'string' ? v : '');

/** PostgreSQL hata nesnesinin `detail` / `where` alanı JSON verisinden parça taşır — günlüğe yalnız kod (SQLSTATE) yazılır. */
export const hataKodu = (hata: unknown): string => {
  const kod = nesneMi(hata) ? hata.code : undefined;
  return typeof kod === 'string' && /^[0-9A-Z_]{1,24}$/.test(kod) ? kod : 'yok';
};

export function havuz(D: MagazaDurumDeps): MagazaPgHavuzu {
  const h = D.getPgPool();
  if (!h) throw new Error('magazaDurum: PostgreSQL havuzu yok — rota 503 dönmeli, yazma yolu çağrılmamalı');
  return h;
}

export const zaman = (D: MagazaDurumDeps): string => (D.simdi?.() ?? new Date()).toISOString();

/** `RETURNING data` satırını akışa yayınlar; kiracı etiketi satırdan. Yayın arızası yazımı geri almaz, hata nesnesi günlüğe yazılmaz. */
export function yayinla(D: MagazaDurumDeps, id: string, satir: Satir): void {
  const cid = satir.companyId;
  if (typeof cid !== 'string' || cid === '') return;
  try {
    D.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', id, satir, { cid });
  } catch (e) {
    console.error('[magaza-durum] yazıldı, akış olayı yayınlanamadı:', hataKodu(e));
  }
}

export async function denetle(D: MagazaDurumDeps, kim: MagazaYazan, eylem: string, ayrinti: string, diff?: Record<string, { from: unknown; to: unknown }>): Promise<void> {
  try {
    // `diff` yalnız geçişte verilir; yalnız-açıklama / kalem / bildirim çağrısında dördüncü bağımsız değişken HİÇ yoktur.
    if (diff) await D.writeAuditLog({ uid: kim.uid, email: kim.eposta }, eylem, ayrinti, diff);
    else await D.writeAuditLog({ uid: kim.uid, email: kim.eposta }, eylem, ayrinti);
  } catch (e) {
    console.error('[magaza-durum] denetim kaydı yazılamadı:', hataKodu(e));
  }
}

/** Saklı aşama kapalı kümede değilse `null` (bilinmeyen aşamaya yazılmaz; ekran «durum okunamadı» basar). */
const asamaCoz = (v: unknown): MagazaTalepAsamasi | null => (magazaAsamasiMi(v) ? v : null);

/**
 * SİLİNMİŞ ölçütü (dilim 2b, V17) — her okuyucu ve yazıcı AYNI iki metni kullanır (`magazaSilinmisMi`'nin SQL eşi):
 * `silindi` NESNE ise silinmiş. JSON `null` (geri alınmış) ve alanın yokluğu silinmiş DEĞİLDİR; `data->'silindi' IS NULL`
 * KULLANILMAZ (JSON `null` ile yokluğu karıştırır — `jsonb_typeof` üç hâli ayırır: yok → NULL, `null` → `'null'`, nesne → `'object'`).
 */
export const MAGAZA_SILINMIS_SQL = `jsonb_typeof(data->'silindi') = 'object'`;
export const MAGAZA_SILINMEMIS_SQL = `jsonb_typeof(data->'silindi') IS DISTINCT FROM 'object'`;

/**
 * AÇIK talep ölçütü — § 4 panel listesi (`acik` CTE) ve bekçinin açık sayımı AYNI metni kullanır: aşaması olmayan /
 * bilinmeyen satır AÇIK sayılır, kaybolmaz (`magazaAcikMi` ile aynı anlam). Dilim 2b: + silinmiş HARİÇ (silinmiş talep açık
 * sayılmaz; § 4 «AÇIK koşulu + silinmemiş koşulu tek sabittir»). İki koşul `AND` ile bağlıdır: `NOT (MAGAZA_ACIK_SQL)`
 * yazan okuyucu (panel listesinin `kapali` CTE'si) silinmişi DE yakalar — orada ayrıca `AND MAGAZA_SILINMEMIS_SQL` gerekir.
 */
export const MAGAZA_ACIK_SQL = `COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal') AND ${MAGAZA_SILINMEMIS_SQL}`;

// ── § 2.1–2.8 Aşama / açıklama ──────────────────────────────────────────────────────────────────────────────────────

export interface DurumDegistirGirdisi {
  id: string;
  companyId: string;
  /** İstemcinin EKRANDA gördüğü aşama ve sürüm (CAS). */
  onceki: MagazaTalepAsamasi;
  surum: number;
  yeni: MagazaTalepAsamasi;
  /** `undefined` → mevcut açıklama KORUNUR (V7); `''` → silinir; yalnız boşluk da `''`. */
  aciklama?: string;
  kim: MagazaYazan;
  kanal: MagazaKanal;
}

export type DurumDegistirSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  | { sonuc: 'gecis-yok'; durum: MagazaTalepAsamasi | null }
  /** (2b) Silinmiş talep DONUKTUR: aşama / açıklama yazılmaz (rota `409 { kod: 'silindi' }`). */
  | { sonuc: 'silindi' };

/** DAR okuma: aşama, sürüm, `iptalOncesi`, talep no ve (2b) `silindi`nin TÜRÜ — başka hiçbir alan. */
export const DURUM_OKU_SQL = `SELECT data->>'durum' AS durum, COALESCE(data->>'durumSurum', '0') AS surum, data->'iptalOncesi' AS iptal_oncesi, data->>'talepNo' AS talep_no, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/**
 * Aynı aşamada yalnız-açıklama yazımı. $4 yama (`durumAciklama`, `durumZamani`, `durumSurum`), $5 okunan durum, $6 okunan sürüm.
 * (2b) Silinmiş satıra yazılmaz: okuma ile yazma arasına giren silme de 0 satır döndürür.
 */
export const DURUM_ACIKLAMA_SQL = `UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND data->>'durum' = $5 AND COALESCE(data->>'durumSurum', '0') = $6 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

/**
 * Aşama geçişi. Geçmiş dizisi uygulamada KURULMAZ, SQL içinde eklenir (kapı deneyi `yaris.mjs`: uygulamada kurulan dizi
 * yarışta girişi sessizce siliyordu): son (sınır − 1) giriş sırası korunarak + yeni giriş; düşen sayısı sayaca eklenir.
 * `durumGecmisi` dizi değilse boş dizi, `durumGecmisiDusen` sayı değilse 0 sayılır (hata fırlatmaz).
 * $4 yama (`durum`, `durumZamani`, `durumSurum` + varsa `iptalOncesi`, `durumAciklama`), $5 geçmiş girişi, $6 okunan durum,
 * $7 okunan sürüm. (2b) Silinmiş satıra yazılmaz.
 */
export const DURUM_GECIS_SQL = `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('durumGecmisi', (SELECT COALESCE(jsonb_agg(g.giris ORDER BY g.sira), '[]'::jsonb) FROM (SELECT giris, sira FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'durumGecmisi') = 'array' THEN data->'durumGecmisi' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(giris, sira) ORDER BY sira DESC LIMIT ${MAGAZA_DURUM_GECMISI_SINIRI - 1}) g) || jsonb_build_array($5::jsonb), 'durumGecmisiDusen', (CASE WHEN jsonb_typeof(data->'durumGecmisiDusen') = 'number' THEN (data->>'durumGecmisiDusen')::numeric ELSE 0 END) + GREATEST(0, (CASE WHEN jsonb_typeof(data->'durumGecmisi') = 'array' THEN jsonb_array_length(data->'durumGecmisi') ELSE 0 END) - ${MAGAZA_DURUM_GECMISI_SINIRI - 1})), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND data->>'durum' = $6 AND COALESCE(data->>'durumSurum', '0') = $7 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

interface DurumSatiri { durum: MagazaTalepAsamasi | null; surum: string; iptalOncesi: unknown; talepNo: string; silindi: boolean }

async function durumOku(h: MagazaPgHavuzu, id: string, companyId: string): Promise<DurumSatiri | null> {
  const { rows } = await h.query(DURUM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  if (!s) return null;
  return { durum: asamaCoz(s.durum), surum: metin(s.surum), iptalOncesi: s.iptal_oncesi, talepNo: metin(s.talep_no), silindi: s.silindi_turu === 'object' };
}

/** Temizlenmiş, tek satırlık, en çok 500 birim; yalnız boşluk → `''`. */
function aciklamaHazirla(ham: string): string {
  return magazaMetniKirp(magazaMetniTemizle(ham, false), MAGAZA_DURUM_ACIKLAMA_SINIRI).metin;
}

export async function talepDurumunuDegistir(D: MagazaDurumDeps, g: DurumDegistirGirdisi): Promise<DurumDegistirSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  const h = havuz(D);
  const okunan = await durumOku(h, g.id, g.companyId);
  if (!okunan) return { sonuc: 'bulunamadi' };
  if (okunan.silindi) return { sonuc: 'silindi' };
  if (okunan.durum === null) return { sonuc: 'gecis-yok', durum: null };
  // Bayat ekran: saklı aşama ya da sürüm ekrandakinden farklıysa tabloya HİÇ bakılmadan güncel aşama döner.
  if (okunan.durum !== g.onceki || okunan.surum !== String(g.surum)) return { sonuc: 'gecis-yok', durum: okunan.durum };
  const gecis = magazaGecisi(g.onceki, g.yeni, okunan.iptalOncesi);
  if (!gecis.izinli) return { sonuc: 'gecis-yok', durum: okunan.durum };
  if (gecis.tur === 'aciklama' && g.aciklama === undefined) return { sonuc: 'gecis-yok', durum: okunan.durum };

  const simdi = zaman(D);
  const yeniSurum = Number(okunan.surum) + 1;
  const aciklamaYamasi = g.aciklama === undefined ? {} : { durumAciklama: aciklamaHazirla(g.aciklama) };
  let satir: unknown;
  if (gecis.tur === 'aciklama') {
    const yama = { ...aciklamaYamasi, durumZamani: simdi, durumSurum: yeniSurum };
    const { rows } = await h.query(DURUM_ACIKLAMA_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), okunan.durum, okunan.surum]);
    satir = rows[0]?.data;
  } else {
    const yama = {
      durum: g.yeni, durumZamani: simdi, durumSurum: yeniSurum,
      ...('iptalOncesi' in gecis ? { iptalOncesi: gecis.iptalOncesi } : {}),
      ...aciklamaYamasi,
    };
    const giris: MagazaDurumGecisi = { onceki: g.onceki, yeni: g.yeni, zaman: simdi, kim: { uid: g.kim.uid, ad: g.kim.ad }, kanal: g.kanal };
    const { rows } = await h.query(DURUM_GECIS_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), JSON.stringify(giris), okunan.durum, okunan.surum]);
    satir = rows[0]?.data;
  }
  if (!nesneMi(satir)) {
    // Araya başka yazım girdi: aşama yeniden okunur (araya giren SİLME ise `silindi`).
    const guncel = await durumOku(h, g.id, g.companyId);
    if (!guncel) return { sonuc: 'bulunamadi' };
    return guncel.silindi ? { sonuc: 'silindi' } : { sonuc: 'gecis-yok', durum: guncel.durum };
  }

  yayinla(D, g.id, satir);
  if (gecis.tur === 'aciklama') {
    const silindi = g.aciklama !== undefined && aciklamaHazirla(g.aciklama) === '';
    await denetle(D, g.kim, 'Mağaza talebi durumu', `${okunan.talepNo} · ${g.kanal} · açıklama ${silindi ? 'silindi' : 'güncellendi'}`);
  } else {
    await denetle(D, g.kim, 'Mağaza talebi durumu', `${okunan.talepNo} · ${g.kanal} · açıklama ${g.aciklama === undefined ? 'yok' : 'var'}`, { durum: { from: g.onceki, to: g.yeni } });
  }
  return { sonuc: 'tamam', belge: satir };
}

// ── § 2.9 Kalem teslim ──────────────────────────────────────────────────────────────────────────────────────────────

export interface KalemTeslimGirdisi {
  id: string;
  companyId: string;
  /** Ekranda görülen `durumSurum` (aşama yazımıyla AYNI sayaç). */
  surum: number;
  teslim: boolean;
  /** Sunucunun verdiği anahtarlar (`b:<dizin>` / 2b `t:<12 onaltılık>`) ya da `'hepsi'`. */
  kalemler: string[] | 'hepsi';
  kim: MagazaYazan;
  kanal: MagazaKanal;
}

export type KalemTeslimSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  | { sonuc: 'gecis-yok'; durum: MagazaTalepAsamasi | null }
  /** Tanınmayan / öbür kaynağın / aralık dışı / yinelenen anahtar, boş liste — HİÇBİR şey yazılmaz (rota 400). */
  | { sonuc: 'gecersiz' }
  /** `icerikSurum` değişti (kaynak beyan → teyit; 2b'de teyit yazımıyla canlanır) — istemci anahtar kümesini yeniler (rota 409). */
  | { sonuc: 'surum-eski' }
  /** (2b) Silinmiş talebe işaret yazılmaz (rota `409 { kod: 'silindi' }`). */
  | { sonuc: 'silindi' };

/**
 * DAR okuma: `teyit.kalemler` personel verisidir (teyit yazılmamış talepte NULL); `musteri`, `not`, `talepEdilen`, `bildirim*`
 * çekilmez. (2b) `silindi`nin türü.
 */
export const KALEM_OKU_SQL = `SELECT data->>'durum' AS durum, COALESCE(data->>'durumSurum', '0') AS surum, COALESCE(data->>'icerikSurum', '0') AS icerik_surum, data->>'talepNo' AS talep_no, (CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN jsonb_array_length(data->'kalemler') ELSE 0 END) AS beyan_sayisi, data->'teyit'->'kalemler' AS teyit_kalemleri, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/**
 * CAS iki sayaçlı (kapı 3, K6): $6 okunan `durumSurum` VE $7 okunan `icerikSurum` — okuma ile yazma arasına giren teyit
 * yazımı işareti pasif `b:` anahtarına düşürmesin (PGlite ölçümü: yalnız `durumSurum` denetlenince hayalet işaret yazıldı).
 * $4 KAPALI: yalnız `{ durumSurum }`; `icerikSurum`'a DOKUNULMAZ (kalem teslim içerik değildir). $5 = anahtar → giriş;
 * nesne olmayan (çöp) `kalemTeslim` `{}` sayılır; önceki giriş üzerine yazılır. (2b) Silinmiş satıra yazılmaz.
 */
export const KALEM_TESLIM_SQL = `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('kalemTeslim', (CASE WHEN jsonb_typeof(data->'kalemTeslim') = 'object' THEN data->'kalemTeslim' ELSE '{}'::jsonb END) || $5::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $6 AND COALESCE(data->>'icerikSurum', '0') = $7 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

interface KalemSatiri { durum: MagazaTalepAsamasi | null; surum: string; icerikSurum: string; talepNo: string; beyanSayisi: number; teyitKalemleri: unknown; silindi: boolean }

async function kalemOku(h: MagazaPgHavuzu, id: string, companyId: string): Promise<KalemSatiri | null> {
  const { rows } = await h.query(KALEM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  if (!s) return null;
  const beyan = typeof s.beyan_sayisi === 'number' ? s.beyan_sayisi : Number(s.beyan_sayisi);
  return {
    durum: asamaCoz(s.durum), surum: metin(s.surum), icerikSurum: metin(s.icerik_surum), talepNo: metin(s.talep_no),
    beyanSayisi: Number.isSafeInteger(beyan) && beyan >= 0 ? beyan : 0, teyitKalemleri: s.teyit_kalemleri, silindi: s.silindi_turu === 'object',
  };
}

/** Kaynak = `teyit.kalemler` boş olmayan dizi ise `'teyit'` (`magazaTeslimKaynagi` ölçütü, SQL sütunundan). */
function kaynakAnahtarlari(s: KalemSatiri): { kaynak: 'beyan' | 'teyit'; anahtarlar: string[] } {
  if (Array.isArray(s.teyitKalemleri) && s.teyitKalemleri.length > 0) {
    return { kaynak: 'teyit', anahtarlar: s.teyitKalemleri.flatMap(k => (nesneMi(k) && typeof k.anahtar === 'string' ? [k.anahtar] : [])) };
  }
  return { kaynak: 'beyan', anahtarlar: Array.from({ length: s.beyanSayisi }, (_, i) => `b:${i}`) };
}

export async function kalemTeslimYaz(D: MagazaDurumDeps, g: KalemTeslimGirdisi): Promise<KalemTeslimSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  if (g.kalemler !== 'hepsi' && g.kalemler.length === 0) return { sonuc: 'gecersiz' };
  const h = havuz(D);
  const okunan = await kalemOku(h, g.id, g.companyId);
  if (!okunan) return { sonuc: 'bulunamadi' };
  if (okunan.silindi) return { sonuc: 'silindi' };
  if (okunan.durum === null) return { sonuc: 'gecis-yok', durum: null };
  if (okunan.durum === 'iptal') return { sonuc: 'gecis-yok', durum: 'iptal' };
  if (okunan.surum !== String(g.surum)) return { sonuc: 'gecis-yok', durum: okunan.durum };

  const { kaynak, anahtarlar } = kaynakAnahtarlari(okunan);
  let istenen: string[];
  if (g.kalemler === 'hepsi') {
    istenen = anahtarlar;
  } else {
    // Her anahtar desene uymalı ve kaynağa AİT olmalı; yineleme METİN eşitliğiyle (desen kurallı — K5). Kısmi yazım YOK.
    const kume = new Set(anahtarlar);
    if (new Set(g.kalemler).size !== g.kalemler.length) return { sonuc: 'gecersiz' };
    for (const a of g.kalemler) if (!MAGAZA_KALEM_ANAHTARI_DESENI.test(a) || !kume.has(a)) return { sonuc: 'gecersiz' };
    istenen = g.kalemler;
  }
  if (istenen.length === 0) return { sonuc: 'gecersiz' };

  const simdi = zaman(D);
  const giris: MagazaKalemTeslimGirisi = { durum: g.teslim ? 'teslim' : 'bekliyor', zaman: simdi, kim: { uid: g.kim.uid, ad: g.kim.ad } };
  const isaretler: Record<string, MagazaKalemTeslimGirisi> = {};
  for (const a of istenen) isaretler[a] = giris;
  const yama = { durumSurum: Number(okunan.surum) + 1 };
  const { rows } = await h.query(KALEM_TESLIM_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(yama), JSON.stringify(isaretler), okunan.surum, okunan.icerikSurum]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    const guncel = await kalemOku(h, g.id, g.companyId);
    if (!guncel) return { sonuc: 'bulunamadi' };
    if (guncel.silindi) return { sonuc: 'silindi' };
    if (guncel.surum !== okunan.surum) return { sonuc: 'gecis-yok', durum: guncel.durum };
    if (guncel.icerikSurum !== okunan.icerikSurum) return { sonuc: 'surum-eski' };
    return { sonuc: 'gecis-yok', durum: guncel.durum };
  }

  yayinla(D, g.id, satir);
  const n = g.teslim ? istenen.length : 0, m = g.teslim ? 0 : istenen.length;
  await denetle(D, g.kim, 'Mağaza talebi kalem teslimi', `${okunan.talepNo} · ${g.kanal} · ${kaynak} · işaretlendi ${n} / kaldırıldı ${m}`);
  return { sonuc: 'tamam', belge: satir };
}

// ── § 2.10 Bildirimi elle yeniden kuyruğa alma (V22) ────────────────────────────────────────────────────────────────

export interface BildirimYenidenGirdisi {
  id: string;
  companyId: string;
  /** `'ilk'` = ilk bildirim (`bildirim`); `'revize'` (2b) = revize bildirimi (`bildirimRevize`, `BILDIRIM_REVIZE_YENIDEN_SQL`, `D.revizeBildirimiIste`). */
  tur: 'ilk' | 'revize';
  kim: MagazaYazan;
}

export type BildirimYenidenSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  /** Çift posta engeli: ilgili bildirimin durumu `gitti` (dar okuma ile yazım arasına giren işçi yazımı dâhil). */
  | { sonuc: 'zaten-gitti' }
  /** (2b) Silinmiş talep DONUKTUR: bildirimi de yeniden kuyruğa alınmaz (rota `409 { kod: 'silindi' }`). */
  | { sonuc: 'silindi' }
  /** (2b, yalnız `tur: 'revize'`) `bildirimRevize` nesne değil — alan yok ya da çöp: revizyon yok (rota `409 { kod: 'revize-yok' }`). */
  | { sonuc: 'revize-yok' };

/**
 * `MAGAZA_KACAN_SAHIPLEN_SQL`'in (`magazaBildirim.ts`) tekil hâli, aynı `jsonb_set` kalıbı: `bildirim` TAM OLARAK
 * `{ durum: 'bekliyor', zaman }` olur — `deneme` / `hataSinifi` SİLİNİR (bilinçli; bekçi bunu `bekleyen` olarak görür).
 * `durumSurum` / `icerikSurum` ARTMAZ (bildirim yazımı sürüm değildir). `gitti` ASLA ezilmez (koşul). Alan yok / çöp → yazılır.
 * (2b) Silinmiş satıra yazılmaz.
 */
export const BILDIRIM_YENIDEN_SQL = `UPDATE docs SET data = jsonb_set(data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $4::text)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND (data->'bildirim'->>'durum') IS DISTINCT FROM 'gitti' AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

/**
 * (2b; kapı 4, Y3 (b)) Revize bildirimini yeniden kuyruğa alma — `BILDIRIM_YENIDEN_SQL`'den BİLEREK ayrı sabit: o kalıp
 * (`jsonb_build_object` ile tam değiştirme) `'{bildirimRevize}'` yoluna uygulansaydı `alanlar` / `kim` / `icerikSurum` düşer,
 * işçinin `REVIZE_YAZ_SQL` CAS'ı NULL'a takılır, `gitti` hiç yazılamaz ve posta her denemede yeniden giderdi. Burada nesne
 * bütünüyle DEĞİŞTİRİLMEZ: `durum` ve `zaman` yazılır, `deneme` / `hataSinifi` silinir, üç alan korunur.
 * DIŞ PARANTEZ ZORUNLU: PostgreSQL'de `-`, `->`'tan önce bağlanır — parantezsiz metin «operator is not unique: unknown - unknown»
 * ile düşer (PGlite 18.3, kapı 4 ölçümü). Alan nesne değilse (yok / çöp) 0 satır: yoktan revizyon YARATILMAZ.
 */
export const BILDIRIM_REVIZE_YENIDEN_SQL = `UPDATE docs SET data = jsonb_set(data, '{bildirimRevize}', ((data->'bildirimRevize') - 'deneme' - 'hataSinifi') || jsonb_build_object('durum', 'bekliyor', 'zaman', $4::text)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND jsonb_typeof(data->'bildirimRevize') = 'object' AND (data->'bildirimRevize'->>'durum') IS DISTINCT FROM 'gitti' AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

/** Satır dönmeyince DAR okuma: iki bildirimin durumu, revize alanının ve `silindi`nin türü (müşteri verisi yok). */
export const BILDIRIM_OKU_SQL = `SELECT data->'bildirim'->>'durum' AS durum, data->'bildirimRevize'->>'durum' AS revize_durum, jsonb_typeof(data->'bildirimRevize') AS revize_turu, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/** Revize bildirimi GENİŞ bağlamı ister (`revizeBildirimiIste`); ilk bildirim dar bağlamla da çağrılır (site paneli bu ucu açmaz). */
export function bildirimiYenidenKuyrugaAl(D: MagazaIcerikDeps, g: BildirimYenidenGirdisi): Promise<BildirimYenidenSonucu>;
export function bildirimiYenidenKuyrugaAl(D: MagazaDurumDeps, g: BildirimYenidenGirdisi & { tur: 'ilk' }): Promise<BildirimYenidenSonucu>;
export async function bildirimiYenidenKuyrugaAl(
  D: MagazaDurumDeps & { revizeBildirimiIste?: MagazaIcerikDeps['revizeBildirimiIste'] }, g: BildirimYenidenGirdisi,
): Promise<BildirimYenidenSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  const revize = g.tur === 'revize';
  // Tür imzası revizeyi geniş bağlama bağlar; yine de eksikse SESSİZCE ilk bildirimin kuyruğuna düşülmez (yazımdan ÖNCE dur).
  if (revize && !D.revizeBildirimiIste) throw new Error('magazaDurum: revize bildirimi isteyicisi bağlanmamış (D.revizeBildirimiIste)');
  const h = havuz(D);
  const { rows } = await h.query(revize ? BILDIRIM_REVIZE_YENIDEN_SQL : BILDIRIM_YENIDEN_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, zaman(D)]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    const okuma = await h.query(BILDIRIM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId]);
    const s = okuma.rows[0];
    if (!s) return { sonuc: 'bulunamadi' };
    if (s.silindi_turu === 'object') return { sonuc: 'silindi' };
    if (revize && s.revize_turu !== 'object') return { sonuc: 'revize-yok' };
    if ((revize ? s.revize_durum : s.durum) === 'gitti') return { sonuc: 'zaten-gitti' };
    // Koşullar bunlardır; satır varken başka bir nedenle 0 satır dönmesi üretilemez (işçi `gitti`yi geri almaz, silme geri alınınca yazım geçer).
    throw new Error('magazaDurum: bildirim yeniden kuyruğa alma yazımı satır döndürmedi');
  }
  // Yanıttan ÖNCE kuyruğa alınır (sözleşmece reddetmez; reddederse yazım geri alınmaz — kaçan süpürmesi sahiplenir).
  // İki bildirim İKİ AYRI kuyruktur: revize `MAGAZA_REVIZE_KUYRUGU`'na, ilk bildirim dilim 1 kuyruğuna (isteyicinin yokluğu yukarıda fırlatıldı).
  try {
    if (revize) await D.revizeBildirimiIste?.(g.id);
    else await D.bildirimIste(g.id);
  } catch (e) {
    console.error('[magaza-durum] bildirim bekliyor yazıldı, kuyruğa alınamadı:', hataKodu(e));
  }
  yayinla(D, g.id, satir);
  await denetle(D, g.kim, 'Mağaza talebi bildirimi elle kuyruğa alındı', `${metin(satir.talepNo)} · erp${revize ? ' · revize' : ''}`);
  return { sonuc: 'tamam', belge: satir };
}

// ── § 2.11 Etiket basıldı (V23) ─────────────────────────────────────────────────────────────────────────────────────

export interface EtiketBasildiGirdisi {
  id: string;
  companyId: string;
  /** Pozitif tam sayı; verilmediyse anahtar yazılmaz. */
  koli?: number;
  kim: { uid: string };
}

export interface EtiketBasildiKaydi { zaman: string; koli?: number; kim: { uid: string; panel: true } }

export type EtiketBasildiSonucu =
  | { sonuc: 'tamam'; belge: Satir; etiketBasildi: EtiketBasildiKaydi }
  | { sonuc: 'bulunamadi' }
  /** (2b) Silinmiş talebe etiket işareti yazılmaz (rota `409 { kod: 'silindi' }`). */
  | { sonuc: 'silindi' };

/**
 * `surum` / CAS YOK: ayrı alan, aşama ve içerikle yarışmaz; `durumSurum` / `icerikSurum` / `durumZamani` ARTMAZ. `jsonb_set`
 * yalnız `{etiketBasildi}` yoluna (nesne bütünüyle değişir — tek alan olduğu için tam değiştirme doğrudur; yeniden basış
 * zaman / koliyi yeniler). Aşama koşulu YOK: `iptal` / `teslim`de de yazılır. (2b) Silinmiş satıra yazılmaz.
 */
export const ETIKET_BASILDI_SQL = `UPDATE docs SET data = jsonb_set(data, '{etiketBasildi}', $4::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND ${MAGAZA_SILINMEMIS_SQL} RETURNING data`;

/**
 * (2b) En dar okuma: `durumSurum`, talep no ve `silindi`nin türü. Etiket yazımı satır döndürmeyince «yok mu, silinmiş mi»
 * ayrımını; silme / geri alma (`magazaIcerik.ts`) ekrandaki sürümün bayatlığını bununla ölçer.
 */
export const SILINDI_OKU_SQL = `SELECT COALESCE(data->>'durumSurum', '0') AS surum, data->>'talepNo' AS talep_no, jsonb_typeof(data->'silindi') AS silindi_turu FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

export async function etiketBasildiYaz(D: MagazaDurumDeps, g: EtiketBasildiGirdisi): Promise<EtiketBasildiSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  if (g.koli !== undefined && !(Number.isSafeInteger(g.koli) && g.koli >= 1)) throw new Error('magazaDurum: koli pozitif tam sayı olmalı (rota şeması süzer)');
  const h = havuz(D);
  const kayit: EtiketBasildiKaydi = { zaman: zaman(D), ...(g.koli !== undefined ? { koli: g.koli } : {}), kim: { uid: g.kim.uid, panel: true } };
  const { rows } = await h.query(ETIKET_BASILDI_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(kayit)]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    // Koşul yalnız kiracı + silinmemiş: satır varsa silinmiştir.
    const okuma = await h.query(SILINDI_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId]);
    return okuma.rows[0] ? { sonuc: 'silindi' } : { sonuc: 'bulunamadi' };
  }
  yayinla(D, g.id, satir);
  return { sonuc: 'tamam', belge: satir, etiketBasildi: kayit };
}
