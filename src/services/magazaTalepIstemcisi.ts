/**
 * magazaTalepIstemcisi.ts — ERP'den mağaza talebine YAZAN istekler (dilim 2a: aşama, kalem teslim, bildirim — şartname v6
 * § 5.1, 2026-10-09; dilim 2b: içerik, silme / geri alma, elle talep, revize bildirimi — § 10.4, 2026-10-10).
 *
 * Bileşen (`components/siparis/MagazaTalepleri.tsx`) istek ATMAZ; OrdersPage bu işlevleri `onDurumDegistir` /
 * `onKalemTeslim` / `onBildirimGonder` / `onIcerikKaydet` / `onSil` / `onElleTalep` nitelikleriyle bileşene verir. `/api/db`
 * bu koleksiyona yazamaz (`lib/rbac.ts` SUNUCU_YAZAR_COLLECTIONS); ERP'nin tek yazma yolu
 * `src/server/routes/magazaErpRoutes.ts` uçlarıdır.
 *
 * Değişmezler:
 *  • `authFetch` (Firebase belirteci); `X-Cetpa-Method` tüneli YOK — hepsi düz POST. Gövde her zaman JSON ve
 *    `Content-Type: application/json` (IIS gövdesiz POST'u Node'a iletmiyor — `authFetch.ts` kalıbı; `bildirim-gonder`
 *    gövdesi `{}`).
 *  • ASLA fırlatmaz: ağ hatası, 5xx, 503 (`panelKullanicisi` fırlattı), okunamayan gövde → `kod: 'ag'` («bağlantı hatası,
 *    yeniden deneyin»). Sunucunun `error` metni ekrana TAŞINMAZ: her sonuç kapalı bir `kod`tur, metni bileşen kendi iki
 *    dilli sözlüğünden basar.
 *  • 409 gövdesindeki `durum` SAKLANAN sözlükle gelir (`yeni`); kapalı kümeden geçer, bilinmeyen değer taşınmaz.
 *  • `eksik` yalnız ortam değişkeni ADLARI (ör. `['APP_URL']`): `ORTAM_ADI_DESENI`'ne uymayan öğe (metin değil, küçük harf,
 *    `=` / boşluk / adres taşıyan) DÜŞER ve en çok `EKSIK_AD_SINIRI` ad taşınır — sunucu bir gün yanlışlıkla değer koysa
 *    da ekrana ad dışında bir şey basılmaz. Değer / sır yanıtta yoktur, bu dosya da okumaz.
 *  • 401 (belirteç yok / süresi geçti) `yetki` sayılır: ekran «yetkiniz yok» der; sayfa yenilenince belirteç tazelenir.
 *    400 sınıfı (şema) kalem tesliminde (`gecersiz` — bayat anahtar kümesi), içerik yazımında ve elle talepte (`gecersiz` —
 *    sunucunun temizlikten sonra boş bulduğu ad, 10 rakamı olmayan telefon, tanınmayan kalem anahtarı) ayrı koddur; aşama,
 *    silme ve bildirimde ekranın gönderdiği gövde şemaya uyar, 400 beklenmez → `ag` (yeniden deneyin).
 *  • (2b) Gövde TİPLERİ sunucu şemalarıyla (`src/server/schemas.ts` `ErpIcerikGovdesi`, `ErpSilGovdesi`,
 *    `ErpElleTalepGovdesi`) AYNI biçimdedir — çit: `lib/magazaTalepFormu.test.ts` formun ürettiği gövdeyi gerçek şemadan
 *    geçirir. Müşterinin BEYANI (`kalemler` / `talepEdilen`), toplamlar ve `kdvKaynagi` içerik gövdesinde YOKTUR (beyan
 *    değişmez; toplamı ve oran kaynağını sunucu türetir).
 */
import { authFetch } from './authFetch';
import { MAGAZA_TALEP_KIMLIK_DESENI, MAGAZA_TALEP_NO_DESENI, magazaAsamasiMi, type MagazaTalepAsamasi } from '../lib/magazaTalep';
import type { MagazaIcerikGirdisi, MagazaIcerikKalemGirdisi, MagazaElleTalepGirdisi } from '../lib/magazaTalepFormu';

export interface MagazaDurumGirdisi {
  onceki: MagazaTalepAsamasi;
  /** Satırın ekranda görülen `durumSurum`'u (CAS). */
  surum: number;
  durum: MagazaTalepAsamasi;
  /** Gönderilmezse eski açıklama KORUNUR (V7); aynı aşamada ZORUNLU; `''` siler. */
  aciklama?: string;
}
export type MagazaDurumSonucu =
  | { ok: true }
  | { ok: false; kod: 'gecis-yok' | 'yetki' | 'bulunamadi' | 'silindi' | 'ag'; durum?: MagazaTalepAsamasi };

export interface MagazaKalemTeslimGirdisi {
  surum: number;
  teslim: boolean;
  /** Kalem anahtarları (`b:<dizin>`) ya da `'hepsi'` («tümünü işaretle / kaldır» TEK istek). */
  kalemler: string[] | 'hepsi';
}
export type MagazaKalemTeslimSonucu =
  | { ok: true }
  | { ok: false; kod: 'gecis-yok' | 'gecersiz' | 'surum-eski' | 'yetki' | 'bulunamadi' | 'silindi' | 'ag'; durum?: MagazaTalepAsamasi };

/** (2b) `revize-yok` = talepte revize bildirimi yok (düğme o hâlde çizilmez — yalnız elle istek); `silindi` = talep donuk. */
export type MagazaBildirimGonderSonucu =
  | { ok: true }
  | { ok: false; kod: 'yapilandirilmamis' | 'kapali' | 'zaten-gitti' | 'revize-yok' | 'silindi' | 'yetki' | 'bulunamadi' | 'ag'; eksik?: string[] };

// ── Dilim 2b ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Gövde tipleri formun saf kurallarıyla birlikte `lib/magazaTalepFormu.ts`'te tanımlıdır (form gövdeyi orada üretir); buradan
// yeniden dışa açılır ki çağıran tek dosyadan içe aktarsın.
export type { MagazaIcerikGirdisi, MagazaIcerikKalemGirdisi, MagazaElleTalepGirdisi };

export type MagazaIcerikSonucu =
  /** `degisti: false` = sunucu hiçbir alanı farklı bulmadı (yazım, bildirim, denetim yok). */
  | { ok: true; degisti: boolean }
  | { ok: false; kod: 'surum-eski' | 'silindi' | 'yetki' | 'bulunamadi' | 'gecersiz' | 'ag'; icerikSurum?: number };

/** `POST …/:id/sil` gövdesi (`schemas.ts` `ErpSilGovdesi`). `surum` = ekranda görülen `durumSurum`; `geriAl: true` → geri alma. */
export interface MagazaSilGirdisi {
  surum: number;
  geriAl?: boolean;
}
export type MagazaSilSonucu =
  | { ok: true }
  /** `silindi` = zaten silinmiş; `silinmemis` = geri alınacak bir şey yok. */
  | { ok: false; kod: 'surum-eski' | 'silindi' | 'silinmemis' | 'yetki' | 'bulunamadi' | 'ag'; surum?: number };

export type MagazaElleTalepSonucu =
  /** `id` / `talepNo` yanıtta beklenen biçimde değilse `null` (talep yine AÇILMIŞTIR — 201). */
  | { ok: true; id: string | null; talepNo: string | null }
  | { ok: false; kod: 'gecersiz' | 'yetki' | 'ag' };

export const MAGAZA_TALEP_UCU = '/api/magaza-talepleri';

/** Ortam değişkeni ADI: büyük harfle başlar; büyük harf / rakam / alt çizgi; en çok 64 karakter. */
const ORTAM_ADI_DESENI = /^[A-Z][A-Z0-9_]{0,63}$/;
const EKSIK_AD_SINIRI = 10;

const yol = (id: string, son: 'durum' | 'kalem-teslim' | 'bildirim-gonder' | 'icerik' | 'sil'): string => `${MAGAZA_TALEP_UCU}/${encodeURIComponent(id)}/${son}`;

interface Yanit { status: number; govde: Record<string, unknown> }

/** Tek POST; ağ hatasında `null`. JSON olmayan gövde (IIS / ARR hata sayfası) boş nesne sayılır — durum kodu yine okunur. */
async function gonder(adres: string, govde: unknown): Promise<Yanit | null> {
  try {
    const r = await authFetch(adres, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(govde),
    });
    const ham: unknown = await r.json().catch(() => ({}));
    return { status: r.status, govde: ham !== null && typeof ham === 'object' && !Array.isArray(ham) ? (ham as Record<string, unknown>) : {} };
  } catch {
    return null;
  }
}

const basarili = (y: Yanit): boolean => y.status >= 200 && y.status < 300;
const kod = (y: Yanit): string | null => (typeof y.govde.kod === 'string' ? y.govde.kod : null);
/** 409 gövdesindeki güncel aşama — kapalı kümeden; bilinmeyen değer taşınmaz. */
const asama = (y: Yanit): { durum: MagazaTalepAsamasi } | Record<string, never> => (magazaAsamasiMi(y.govde.durum) ? { durum: y.govde.durum } : {});
/** 409 gövdesindeki güncel sürüm sayacı — negatif olmayan tam sayıysa; değilse `null` (taşınmaz). */
const sayac = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** `POST /api/magaza-talepleri/:id/durum` — aşama / açıklama yazımı (§ 4; SAKLANAN sözlük). */
export async function magazaTalepDurumuYaz(id: string, g: MagazaDurumGirdisi): Promise<MagazaDurumSonucu> {
  const y = await gonder(yol(id, 'durum'), g);
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) return { ok: true };
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 404) return { ok: false, kod: 'bulunamadi' };
  if (y.status === 409) {
    const k = kod(y);
    if (k === 'gecis-yok') return { ok: false, kod: 'gecis-yok', ...asama(y) };
    if (k === 'silindi') return { ok: false, kod: 'silindi' };
  }
  return { ok: false, kod: 'ag' };
}

/** `POST /api/magaza-talepleri/:id/kalem-teslim` — kalem teslim işareti (§ 4; `KalemTeslimGovdesi` şeması). */
export async function magazaKalemTeslimYaz(id: string, g: MagazaKalemTeslimGirdisi): Promise<MagazaKalemTeslimSonucu> {
  const y = await gonder(yol(id, 'kalem-teslim'), g);
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) return { ok: true };
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 404) return { ok: false, kod: 'bulunamadi' };
  // Şema ya da kaynağa ait olmayan anahtar (2b'de kaynak beyandan teyite geçince anahtar kümesi bayatlar): ekran 409 gibi ele alır.
  if (y.status === 400) return { ok: false, kod: 'gecersiz' };
  if (y.status === 409) {
    const k = kod(y);
    if (k === 'gecis-yok') return { ok: false, kod: 'gecis-yok', ...asama(y) };
    if (k === 'surum-eski') return { ok: false, kod: 'surum-eski' };
    if (k === 'silindi') return { ok: false, kod: 'silindi' };
  }
  return { ok: false, kod: 'ag' };
}

/**
 * `POST /api/magaza-talepleri/:id/bildirim-gonder` — bildirimi elle kuyruğa alma (V22); gövde `{}`. `tur: 'revize'` (2b) aynı
 * uca `?tur=revize` ile gider ve REVİZE bildirimini (`bildirimRevize`) kuyruğa alır; `tur` verilmezse ilk bildirim (sorgu
 * dizesi YOK — sunucu `tur=ilk` dâhil `revize` dışındaki her değeri 400 ile reddeder; kapı 4, Y8).
 */
export async function magazaBildirimGonder(id: string, tur?: 'revize'): Promise<MagazaBildirimGonderSonucu> {
  const y = await gonder(tur === 'revize' ? `${yol(id, 'bildirim-gonder')}?tur=revize` : yol(id, 'bildirim-gonder'), {});
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) return { ok: true };
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 404) return { ok: false, kod: 'bulunamadi' };
  if (y.status === 409) {
    const k = kod(y);
    if (k === 'yapilandirilmamis') {
      const eksik = Array.isArray(y.govde.eksik)
        ? y.govde.eksik.filter((e): e is string => typeof e === 'string' && ORTAM_ADI_DESENI.test(e)).slice(0, EKSIK_AD_SINIRI)
        : [];
      return { ok: false, kod: 'yapilandirilmamis', eksik };
    }
    if (k === 'kapali') return { ok: false, kod: 'kapali' };
    if (k === 'zaten-gitti') return { ok: false, kod: 'zaten-gitti' };
    if (k === 'revize-yok') return { ok: false, kod: 'revize-yok' };
    if (k === 'silindi') return { ok: false, kod: 'silindi' };
  }
  return { ok: false, kod: 'ag' };
}

/**
 * `POST /api/magaza-talepleri/:id/icerik` — içerik düzenleme (V15: yalnız ERP). Form her zaman TAM gövde gönderir; «ne değişti»
 * sunucuda ölçülür ve `degisti` yanıttan gelir (`false` = hiçbir alan farklı değil). 2xx gövdesi okunamıyorsa `degisti: true`
 * sayılır: yazımın yapılmış olabileceği yerde «değişiklik yok» demek yanlış güvence olurdu (sonuç akıştan görünür).
 * 503 (ürün KDV okuması başarısız — sunucu varsayılan oranla sessizce YAZMAZ) → `ag` («yeniden deneyin»).
 */
export async function magazaTalepIcerigiYaz(id: string, g: MagazaIcerikGirdisi): Promise<MagazaIcerikSonucu> {
  const y = await gonder(yol(id, 'icerik'), g);
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) return { ok: true, degisti: y.govde.degisti !== false };
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 404) return { ok: false, kod: 'bulunamadi' };
  if (y.status === 400) return { ok: false, kod: 'gecersiz' };
  if (y.status === 409) {
    const k = kod(y);
    if (k === 'surum-eski') {
      const guncel = sayac(y.govde.icerikSurum);
      return { ok: false, kod: 'surum-eski', ...(guncel !== null ? { icerikSurum: guncel } : {}) };
    }
    if (k === 'silindi') return { ok: false, kod: 'silindi' };
  }
  return { ok: false, kod: 'ag' };
}

/**
 * `POST /api/magaza-talepleri/:id/sil` — YUMUŞAK silme (kayıt durur, `silindi` işareti alır) ve `geriAl: true` ile geri alma.
 * İkisi de yalnız Yönetici (hüküm sunucuda: `magazaTalepSilmeYetkisi`); başka rol 403 → `yetki`.
 */
export async function magazaTalepSil(id: string, g: MagazaSilGirdisi): Promise<MagazaSilSonucu> {
  const y = await gonder(yol(id, 'sil'), g);
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) return { ok: true };
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 404) return { ok: false, kod: 'bulunamadi' };
  if (y.status === 409) {
    const k = kod(y);
    if (k === 'surum-eski') {
      const guncel = sayac(y.govde.surum);
      return { ok: false, kod: 'surum-eski', ...(guncel !== null ? { surum: guncel } : {}) };
    }
    if (k === 'silindi') return { ok: false, kod: 'silindi' };
    if (k === 'silinmemis') return { ok: false, kod: 'silinmemis' };
  }
  return { ok: false, kod: 'ag' };
}

/**
 * `POST /api/magaza-talepleri` — ERP'de ELLE talep (telefonla gelen iş). Numarayı SUNUCU üretir; talep `yeni` başlar ve
 * mağazadan gelen talep gibi bildirim e-postası kuyruğa girer. 503 (numara çakışması / kiracı / okuma hatası) → `ag`.
 */
export async function magazaElleTalepAc(g: MagazaElleTalepGirdisi): Promise<MagazaElleTalepSonucu> {
  const y = await gonder(MAGAZA_TALEP_UCU, g);
  if (y === null) return { ok: false, kod: 'ag' };
  if (basarili(y)) {
    const id = typeof y.govde.id === 'string' && MAGAZA_TALEP_KIMLIK_DESENI.test(y.govde.id) ? y.govde.id : null;
    const talepNo = typeof y.govde.talepNo === 'string' && MAGAZA_TALEP_NO_DESENI.test(y.govde.talepNo) ? y.govde.talepNo : null;
    return { ok: true, id, talepNo };
  }
  if (y.status === 403 || y.status === 401) return { ok: false, kod: 'yetki' };
  if (y.status === 400) return { ok: false, kod: 'gecersiz' };
  return { ok: false, kod: 'ag' };
}
