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

export interface MagazaYazan {
  uid: string;
  /** Yazma anında `panelKullanicisi(uid).ad` (iki kanalda da); belirteçteki `ad` yalnız panel başlığıdır. */
  ad: string;
  eposta: string;
}

type Satir = Record<string, unknown>;
const nesneMi = (v: unknown): v is Satir => typeof v === 'object' && v !== null && !Array.isArray(v);
const metin = (v: unknown): string => (typeof v === 'string' ? v : '');

/** PostgreSQL hata nesnesinin `detail` / `where` alanı JSON verisinden parça taşır — günlüğe yalnız kod (SQLSTATE) yazılır. */
const hataKodu = (hata: unknown): string => {
  const kod = nesneMi(hata) ? hata.code : undefined;
  return typeof kod === 'string' && /^[0-9A-Z_]{1,24}$/.test(kod) ? kod : 'yok';
};

function havuz(D: MagazaDurumDeps): MagazaPgHavuzu {
  const h = D.getPgPool();
  if (!h) throw new Error('magazaDurum: PostgreSQL havuzu yok — rota 503 dönmeli, yazma yolu çağrılmamalı');
  return h;
}

const zaman = (D: MagazaDurumDeps): string => (D.simdi?.() ?? new Date()).toISOString();

/** `RETURNING data` satırını akışa yayınlar; kiracı etiketi satırdan. Yayın arızası yazımı geri almaz, hata nesnesi günlüğe yazılmaz. */
function yayinla(D: MagazaDurumDeps, id: string, satir: Satir): void {
  const cid = satir.companyId;
  if (typeof cid !== 'string' || cid === '') return;
  try {
    D.broadcastDocChange(MAGAZA_TALEP_KOLEKSIYONU, 'set', id, satir, { cid });
  } catch (e) {
    console.error('[magaza-durum] yazıldı, akış olayı yayınlanamadı:', hataKodu(e));
  }
}

async function denetle(D: MagazaDurumDeps, kim: MagazaYazan, eylem: string, ayrinti: string, diff?: Record<string, { from: unknown; to: unknown }>): Promise<void> {
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
 * AÇIK talep ölçütü — § 4 panel listesi (`acik` CTE) ve bekçinin açık sayımı AYNI metni kullanır: aşaması olmayan /
 * bilinmeyen satır AÇIK sayılır, kaybolmaz (`magazaAcikMi` ile aynı anlam). 2b silinmiş süzgecini buraya ekler.
 */
export const MAGAZA_ACIK_SQL = `COALESCE(data->>'durum', '') NOT IN ('teslim', 'iptal')`;

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
  | { sonuc: 'gecis-yok'; durum: MagazaTalepAsamasi | null };

/** DAR okuma: aşama, sürüm, `iptalOncesi`, talep no — başka hiçbir alan. */
export const DURUM_OKU_SQL = `SELECT data->>'durum' AS durum, COALESCE(data->>'durumSurum', '0') AS surum, data->'iptalOncesi' AS iptal_oncesi, data->>'talepNo' AS talep_no FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/** Aynı aşamada yalnız-açıklama yazımı. $4 yama (`durumAciklama`, `durumZamani`, `durumSurum`), $5 okunan durum, $6 okunan sürüm. */
export const DURUM_ACIKLAMA_SQL = `UPDATE docs SET data = data || $4::jsonb, updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND data->>'durum' = $5 AND COALESCE(data->>'durumSurum', '0') = $6 RETURNING data`;

/**
 * Aşama geçişi. Geçmiş dizisi uygulamada KURULMAZ, SQL içinde eklenir (kapı deneyi `yaris.mjs`: uygulamada kurulan dizi
 * yarışta girişi sessizce siliyordu): son (sınır − 1) giriş sırası korunarak + yeni giriş; düşen sayısı sayaca eklenir.
 * `durumGecmisi` dizi değilse boş dizi, `durumGecmisiDusen` sayı değilse 0 sayılır (hata fırlatmaz).
 * $4 yama (`durum`, `durumZamani`, `durumSurum` + varsa `iptalOncesi`, `durumAciklama`), $5 geçmiş girişi, $6 okunan durum,
 * $7 okunan sürüm.
 */
export const DURUM_GECIS_SQL = `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('durumGecmisi', (SELECT COALESCE(jsonb_agg(g.giris ORDER BY g.sira), '[]'::jsonb) FROM (SELECT giris, sira FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'durumGecmisi') = 'array' THEN data->'durumGecmisi' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(giris, sira) ORDER BY sira DESC LIMIT ${MAGAZA_DURUM_GECMISI_SINIRI - 1}) g) || jsonb_build_array($5::jsonb), 'durumGecmisiDusen', (CASE WHEN jsonb_typeof(data->'durumGecmisiDusen') = 'number' THEN (data->>'durumGecmisiDusen')::numeric ELSE 0 END) + GREATEST(0, (CASE WHEN jsonb_typeof(data->'durumGecmisi') = 'array' THEN jsonb_array_length(data->'durumGecmisi') ELSE 0 END) - ${MAGAZA_DURUM_GECMISI_SINIRI - 1})), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND data->>'durum' = $6 AND COALESCE(data->>'durumSurum', '0') = $7 RETURNING data`;

interface DurumSatiri { durum: MagazaTalepAsamasi | null; surum: string; iptalOncesi: unknown; talepNo: string }

async function durumOku(h: MagazaPgHavuzu, id: string, companyId: string): Promise<DurumSatiri | null> {
  const { rows } = await h.query(DURUM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  if (!s) return null;
  return { durum: asamaCoz(s.durum), surum: metin(s.surum), iptalOncesi: s.iptal_oncesi, talepNo: metin(s.talep_no) };
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
    // Araya başka yazım girdi: aşama yeniden okunur.
    const guncel = await durumOku(h, g.id, g.companyId);
    return guncel ? { sonuc: 'gecis-yok', durum: guncel.durum } : { sonuc: 'bulunamadi' };
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
  /** `icerikSurum` değişti (kaynak beyan → teyit; 2a'da ölü dal) — istemci anahtar kümesini yeniler (rota 409). */
  | { sonuc: 'surum-eski' };

/** DAR okuma: `teyit.kalemler` personel verisidir (2a'da hep NULL); `musteri`, `not`, `talepEdilen`, `bildirim*` çekilmez. */
export const KALEM_OKU_SQL = `SELECT data->>'durum' AS durum, COALESCE(data->>'durumSurum', '0') AS surum, COALESCE(data->>'icerikSurum', '0') AS icerik_surum, data->>'talepNo' AS talep_no, (CASE WHEN jsonb_typeof(data->'kalemler') = 'array' THEN jsonb_array_length(data->'kalemler') ELSE 0 END) AS beyan_sayisi, data->'teyit'->'kalemler' AS teyit_kalemleri FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

/**
 * CAS iki sayaçlı (kapı 3, K6): $6 okunan `durumSurum` VE $7 okunan `icerikSurum` — okuma ile yazma arasına giren teyit
 * yazımı işareti pasif `b:` anahtarına düşürmesin (PGlite ölçümü: yalnız `durumSurum` denetlenince hayalet işaret yazıldı).
 * $4 KAPALI: yalnız `{ durumSurum }`; `icerikSurum`'a DOKUNULMAZ (kalem teslim içerik değildir). $5 = anahtar → giriş;
 * nesne olmayan (çöp) `kalemTeslim` `{}` sayılır; önceki giriş üzerine yazılır.
 */
export const KALEM_TESLIM_SQL = `UPDATE docs SET data = (data || $4::jsonb) || jsonb_build_object('kalemTeslim', (CASE WHEN jsonb_typeof(data->'kalemTeslim') = 'object' THEN data->'kalemTeslim' ELSE '{}'::jsonb END) || $5::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND COALESCE(data->>'durumSurum', '0') = $6 AND COALESCE(data->>'icerikSurum', '0') = $7 RETURNING data`;

interface KalemSatiri { durum: MagazaTalepAsamasi | null; surum: string; icerikSurum: string; talepNo: string; beyanSayisi: number; teyitKalemleri: unknown }

async function kalemOku(h: MagazaPgHavuzu, id: string, companyId: string): Promise<KalemSatiri | null> {
  const { rows } = await h.query(KALEM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, id, companyId]);
  const s = rows[0];
  if (!s) return null;
  const beyan = typeof s.beyan_sayisi === 'number' ? s.beyan_sayisi : Number(s.beyan_sayisi);
  return {
    durum: asamaCoz(s.durum), surum: metin(s.surum), icerikSurum: metin(s.icerik_surum), talepNo: metin(s.talep_no),
    beyanSayisi: Number.isSafeInteger(beyan) && beyan >= 0 ? beyan : 0, teyitKalemleri: s.teyit_kalemleri,
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
  /** 2a'da yalnız `'ilk'`; 2b `'revize'`yi (`BILDIRIM_REVIZE_YENIDEN_SQL`, `D.revizeBildirimiIste`) ekler. */
  tur: 'ilk';
  kim: MagazaYazan;
}

export type BildirimYenidenSonucu =
  | { sonuc: 'tamam'; belge: Satir }
  | { sonuc: 'bulunamadi' }
  /** Çift posta engeli: `bildirim.durum === 'gitti'` (dar okuma ile yazım arasına giren işçi yazımı dâhil). */
  | { sonuc: 'zaten-gitti' };

/**
 * `MAGAZA_KACAN_SAHIPLEN_SQL`'in (`magazaBildirim.ts`) tekil hâli, aynı `jsonb_set` kalıbı: `bildirim` TAM OLARAK
 * `{ durum: 'bekliyor', zaman }` olur — `deneme` / `hataSinifi` SİLİNİR (bilinçli; bekçi bunu `bekleyen` olarak görür).
 * `durumSurum` / `icerikSurum` ARTMAZ (bildirim yazımı sürüm değildir). `gitti` ASLA ezilmez (koşul). Alan yok / çöp → yazılır.
 */
export const BILDIRIM_YENIDEN_SQL = `UPDATE docs SET data = jsonb_set(data, '{bildirim}', jsonb_build_object('durum', 'bekliyor', 'zaman', $4::text)), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 AND (data->'bildirim'->>'durum') IS DISTINCT FROM 'gitti' RETURNING data`;

/** Satır dönmeyince DAR okuma: yalnız bildirim durumu (müşteri verisi yok). */
export const BILDIRIM_OKU_SQL = `SELECT data->'bildirim'->>'durum' AS durum FROM docs WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3`;

export async function bildirimiYenidenKuyrugaAl(D: MagazaDurumDeps, g: BildirimYenidenGirdisi): Promise<BildirimYenidenSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  const h = havuz(D);
  const { rows } = await h.query(BILDIRIM_YENIDEN_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, zaman(D)]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) {
    const okuma = await h.query(BILDIRIM_OKU_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId]);
    if (!okuma.rows[0]) return { sonuc: 'bulunamadi' };
    if (okuma.rows[0].durum === 'gitti') return { sonuc: 'zaten-gitti' };
    // Koşul yalnız `gitti`dir; satır varken başka bir nedenle 0 satır dönmesi bu tabanda üretilemez (işçi `gitti`yi geri almaz).
    throw new Error('magazaDurum: bildirim yeniden kuyruğa alma yazımı satır döndürmedi');
  }
  // Yanıttan ÖNCE kuyruğa alınır (sözleşmece reddetmez; reddederse yazım geri alınmaz — kaçan süpürmesi sahiplenir).
  try {
    await D.bildirimIste(g.id);
  } catch (e) {
    console.error('[magaza-durum] bildirim bekliyor yazıldı, kuyruğa alınamadı:', hataKodu(e));
  }
  yayinla(D, g.id, satir);
  await denetle(D, g.kim, 'Mağaza talebi bildirimi elle kuyruğa alındı', `${metin(satir.talepNo)} · erp`);
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
  | { sonuc: 'bulunamadi' };

/**
 * `surum` / CAS YOK: ayrı alan, aşama ve içerikle yarışmaz; `durumSurum` / `icerikSurum` / `durumZamani` ARTMAZ. `jsonb_set`
 * yalnız `{etiketBasildi}` yoluna (nesne bütünüyle değişir — tek alan olduğu için tam değiştirme doğrudur; yeniden basış
 * zaman / koliyi yeniler). Aşama koşulu YOK: `iptal` / `teslim`de de yazılır.
 */
export const ETIKET_BASILDI_SQL = `UPDATE docs SET data = jsonb_set(data, '{etiketBasildi}', $4::jsonb), updated_at = now() WHERE coll = $1 AND id = $2 AND data->>'companyId' = $3 RETURNING data`;

export async function etiketBasildiYaz(D: MagazaDurumDeps, g: EtiketBasildiGirdisi): Promise<EtiketBasildiSonucu> {
  if (!MAGAZA_TALEP_KIMLIK_DESENI.test(g.id)) return { sonuc: 'bulunamadi' };
  if (g.koli !== undefined && !(Number.isSafeInteger(g.koli) && g.koli >= 1)) throw new Error('magazaDurum: koli pozitif tam sayı olmalı (rota şeması süzer)');
  const h = havuz(D);
  const kayit: EtiketBasildiKaydi = { zaman: zaman(D), ...(g.koli !== undefined ? { koli: g.koli } : {}), kim: { uid: g.kim.uid, panel: true } };
  const { rows } = await h.query(ETIKET_BASILDI_SQL, [MAGAZA_TALEP_KOLEKSIYONU, g.id, g.companyId, JSON.stringify(kayit)]);
  const satir: unknown = rows[0]?.data;
  if (!nesneMi(satir)) return { sonuc: 'bulunamadi' };
  yayinla(D, g.id, satir);
  return { sonuc: 'tamam', belge: satir, etiketBasildi: kayit };
}
