/**
 * ebelgeDurumTani.ts — GİB durum sorgusunun (EBelgeDurumSorgulamaV2) HAM yanıtını ölçmek için (2026-09-28).
 *
 * NEDEN VAR — kullanıcı (2026-09-25): "GİB'den kabul edilmeyen faturaları da çekelim, iptal faturaları iptal olarak
 * görünsün ama başka bir hesaplamaya dahil olmasın". Ölçüm (sema-kesif, 2026-09-28): Mikro'nun muhasebe tablolarında GİB
 * red durumu için KOLON YOK — CARI_HESAP_HAREKETLERI yalnız cha_ebelge_turu / cha_efatura_belge_tipi / cha_ebelge_Islemturu /
 * cha_uuid taşıyor, EBELGE_EVRAK_HAREKETLERI ödeme/sevk ek bilgisi. Durum Mikro API'deki EBelgeDurumSorgulamaV2'den gelir;
 * ama `/api/mikro/ebelge/durum` yanıt alanlarını (Durum / DurumKodu) TAHMİNLE okuyor, hiç ölçülmedi (OpenAPI'de yanıt şeması
 * yok — mikro-api-quirks). Kolon/alan adı tahmin edilmez: önce ham yanıt görülür, sonra kural yazılır.
 *
 * Bu modül yalnız yanıtı KÜÇÜLTÜR (ham veri kesilerek döner); hüküm vermez, hiçbir yere yazmaz. Zarf varsayımı YOK
 * (inceleme 2026-09-28): yanıt metin/HTML ya da `result`suz stub da olabilir — o zaman gövdenin kendisi döner.
 */

/** Tek bir EBelgeDurumSorgulamaV2 denemesinin özeti — alan adları ve ham içerik (kısaltılmış) aynen. */
export interface DurumDenemesi {
  eBelgeTipi: 0 | 1;
  httpOk: boolean;
  httpDurum: number;
  /** 'zarf' = {result:[r0]}; 'result-yok' = nesne ama result[0] yok (stub vb.); 'metin' = JSON olmayan gövde; 'bos' = null. */
  zarfTuru: 'zarf' | 'result-yok' | 'metin' | 'bos';
  isError: boolean | null;
  hata: string | null;
  /** Gövdenin üst düzey anahtarları (stub'daki `Method` gibi) — zarf dışı yanıtı tanımak için. */
  ustAnahtarlar: string[];
  /** result[0]'ın anahtarları — durum alanı Data'nın KARDEŞİ olarak da gelebilir. */
  r0Anahtarlari: string[];
  /** Data'nın anahtar adları (yalnız birinci katman). */
  dataAnahtarlari: string[];
  /** Data'nın JSON metni, en çok `sinir` karakter. */
  dataHam: string | null;
  /** Data yoksa ya da zarf beklenen biçimde değilse GÖVDENİN kendisi (metin ya da JSON), en çok `sinir` karakter. */
  govdeHam: string | null;
  /** Çağrının süresi (ms) — çağıran doldurur; zaman aşımı riskini ölçmek için. */
  sureMs?: number;
}

export const kes = (s: string, sinir: number) => (s.length > sinir ? `${s.slice(0, sinir)}…(+${s.length - sinir})` : s);
const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function durumDenemesiOzeti(eBelgeTipi: 0 | 1, sonuc: { ok: boolean; status: number; data: unknown }, sinir = 2000): DurumDenemesi {
  const govde = sonuc.data;
  const r0 = nesneMi(govde) && Array.isArray(govde.result) && nesneMi(govde.result[0]) ? govde.result[0] : undefined;
  const zarfTuru: DurumDenemesi['zarfTuru'] = r0 ? 'zarf' : typeof govde === 'string' ? 'metin' : govde === null || govde === undefined ? 'bos' : 'result-yok';
  const data = r0?.Data;
  const hataHam = r0 ? r0.ErrorMessage : zarfTuru === 'zarf' ? null : 'yanıt zarfında result[0] yok';
  const govdeGerekli = !r0 || data === undefined;
  return {
    eBelgeTipi, httpOk: sonuc.ok, httpDurum: sonuc.status, zarfTuru,
    isError: typeof r0?.IsError === 'boolean' ? r0.IsError : null,
    hata: hataHam === null || hataHam === undefined || hataHam === '' ? null : kes(String(hataHam), 500),
    ustAnahtarlar: nesneMi(govde) ? Object.keys(govde) : [],
    r0Anahtarlari: r0 ? Object.keys(r0) : [],
    dataAnahtarlari: nesneMi(data) ? Object.keys(data) : Array.isArray(data) ? ['<dizi>'] : [],
    dataHam: data === undefined ? null : kes(JSON.stringify(data), sinir),
    govdeHam: !govdeGerekli || govde === undefined ? null : kes(typeof govde === 'string' ? govde : JSON.stringify(govde), sinir),
  };
}

/** ETTN biçimi (36 karakter, onaltılık + tire; sıfır GUID değil) — yalnız bu biçimdeki değer Mikro'ya gönderilir. */
export const ettnGecerli = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-fA-F-]{36}$/.test(v.trim()) && !/^[0-]+$/.test(v.trim());

/** Ham tablo satırlarını yanıt için küçültür: uzun metin hücreleri `sinir` karakterde kesilir (ikili/uzun alan yanıtı şişirmesin). */
export function hucreleriKes(satirlar: readonly Record<string, unknown>[], sinir = 300): Record<string, unknown>[] {
  return satirlar.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? kes(v, sinir) : v])));
}
