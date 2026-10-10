/**
 * magazaTalepIstemcisi.ts — ERP'den mağaza talebine YAZAN üç istek (dilim 2a, şartname v6 § 5.1; 2026-10-09).
 *
 * Bileşen (`components/siparis/MagazaTalepleri.tsx`) istek ATMAZ; OrdersPage bu üç işlevi `onDurumDegistir` /
 * `onKalemTeslim` / `onBildirimGonder` nitelikleriyle bileşene verir. `/api/db` bu koleksiyona yazamaz
 * (`lib/rbac.ts` SUNUCU_YAZAR_COLLECTIONS); ERP'nin tek yazma yolu `src/server/routes/magazaErpRoutes.ts` uçlarıdır.
 *
 * Değişmezler:
 *  • `authFetch` (Firebase belirteci); `X-Cetpa-Method` tüneli YOK — üçü de düz POST. Gövde her zaman JSON ve
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
 *    400 sınıfı (şema) yalnız kalem tesliminde ayrı koddur (`gecersiz` — bayat anahtar kümesi); aşama ve bildirimde
 *    ekranın gönderdiği gövde şemaya uyar, 400 beklenmez → `ag` (yeniden deneyin).
 */
import { authFetch } from './authFetch';
import { magazaAsamasiMi, type MagazaTalepAsamasi } from '../lib/magazaTalep';

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

export type MagazaBildirimGonderSonucu =
  | { ok: true }
  | { ok: false; kod: 'yapilandirilmamis' | 'kapali' | 'zaten-gitti' | 'yetki' | 'bulunamadi' | 'ag'; eksik?: string[] };

export const MAGAZA_TALEP_UCU = '/api/magaza-talepleri';

/** Ortam değişkeni ADI: büyük harfle başlar; büyük harf / rakam / alt çizgi; en çok 64 karakter. */
const ORTAM_ADI_DESENI = /^[A-Z][A-Z0-9_]{0,63}$/;
const EKSIK_AD_SINIRI = 10;

const yol = (id: string, son: 'durum' | 'kalem-teslim' | 'bildirim-gonder'): string => `${MAGAZA_TALEP_UCU}/${encodeURIComponent(id)}/${son}`;

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

/** `POST /api/magaza-talepleri/:id/bildirim-gonder` — bildirimi elle kuyruğa alma (V22); gövde `{}`. 2b `tur: 'revize'` ekler. */
export async function magazaBildirimGonder(id: string): Promise<MagazaBildirimGonderSonucu> {
  const y = await gonder(yol(id, 'bildirim-gonder'), {});
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
  }
  return { ok: false, kod: 'ag' };
}
