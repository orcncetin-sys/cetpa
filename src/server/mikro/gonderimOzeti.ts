/**
 * gonderimOzeti.ts — Mikro gönderim defterinin SAF özet ve ölçü işlevleri (şartname `.wf/SARTNAME-yeniden-deneme-sunucuda-v3.md`
 * K0b; v2 K4; § 8.2 commit 0-B). `sha256` ve kanonik JSON YALNIZ burada: ölçüm kaydı (Dilim 0), gönderim defteri (Dilim 1) ve
 * eski kuyruk taşıması (Dilim 3) AYNI işlevleri çağırır — özetler kaynaktan kaynağa ayrışamaz.
 *
 * Hiçbir işlev gövdeyi, hata METNİNİ ya da düz `entityId`'yi dışarı vermez: kayda yalnız karma, sayı ve tanımlayıcı biçimindeki
 * ad girer (Mikro hata metni cari adı / kodu taşıyabilir; gövde kişisel veridir — S6).
 */
import { createHash } from 'node:crypto';
import { adAlani } from '../acilisTani.js';
import { yanitAnahtarYollari } from './belgeNo.js';

/**
 * Anahtarları (her düzeyde) sıralanmış JSON. Dizi sırası KORUNUR (anlamlıdır). `undefined` değerli anahtar düşer, dizideki
 * `undefined` `null` olur — `JSON.stringify` ile aynı kural; böylece istekten gelen JSON ile aynı değer aynı metni verir.
 */
export function kanonikJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : kanonikJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const anahtarlar = Object.keys(o).filter(k => o[k] !== undefined).sort();
  return `{${anahtarlar.map(k => `${JSON.stringify(k)}:${kanonikJson(o[k])}`).join(',')}}`;
}

const sha256 = (metin: string): string => createHash('sha256').update(metin, 'utf8').digest('hex');

/**
 * Gönderimin İÇERİK özeti: `sha256(kanonik { method, payload })`. İstek gövdesinin öteki alanları (`istemciIsNo`, `onayliTekrar`,
 * `entityType`, `entityId`) özete GİRMEZ — aynı içerik, kim / hangi numarayla gönderirse göndersin aynı özeti verir.
 */
export function govdeOzeti(method: string, payload: unknown): string {
  return sha256(kanonikJson({ method, payload }));
}

/**
 * Gönderimin VARLIK özeti (tekrar ölçümü — şartname ÇK-1 (5), C10): aynı kiracı + yöntem + varlık türü + varlık kimliği → aynı
 * özet. `entityId` boş olmayan bir dize değilse `null` (varlık bilinmiyor). Kodlama JSON dizisidir (ayraç belirsizliği yok);
 * düz `entityId` kayda girmez, yalnız bu karma.
 */
export function varlikOzeti(companyId: string, method: string, entityType: unknown, entityId: unknown): string | null {
  if (typeof entityId !== 'string' || entityId === '') return null;
  return sha256(JSON.stringify([companyId, method, typeof entityType === 'string' ? entityType : '', entityId]));
}

/** Tanımlayıcı biçimindeki ad (istemcinin `entityType`'ı, hata adı); serbest metin `(tanımsız)`'a, boş değer `''`'ye döner. */
export const guvenliAd = (v: unknown, enUzun = 60): string => adAlani(v, enUzun);

/** Mikro yanıtının değer taşımayan ölçüsü (v2 K4 `olcum.sonuc`; C2, C4, C11). */
export interface YanitOlcusu {
  httpDurum: number;
  /** Gövde JSON olarak ayrıştı mı (`mikroPost` ayrıştıramadığı gövdeyi DİZE olarak döndürür — IIS / ARR HTML sayfası). */
  jsonMu: boolean;
  /** `result` dizisinin uzunluğu; dizi yoksa (stub, HTML, `result`suz nesne) `null`. */
  resultUzunlugu: number | null;
  /** `IsError === true` taşıyan `result` öğesi sayısı; dizi yoksa `null`. */
  hataliOgeSayisi: number | null;
  /** İstekteki evrak sayısı (`payload.evraklar` dizi ise uzunluğu); bilinmiyorsa `null`. */
  evrakSayisi: number | null;
  /** Yanıtın yalnız ANAHTAR yolları — değer YOK (`belgeNo.yanitAnahtarYollari`). */
  yanitAnahtarlari: string[];
}

/** `payload.evraklar` dizi ise uzunluğu, değilse `null` (bilinmiyor — 0 DEĞİL). */
export function evrakSayisi(payload: unknown): number | null {
  const evraklar = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).evraklar : undefined;
  return Array.isArray(evraklar) ? evraklar.length : null;
}

export function yanitOlcusu(yanit: { status: number; data: unknown }, evrak: number | null): YanitOlcusu {
  const { data } = yanit;
  const jsonMu = typeof data !== 'string';
  const sonuc = data && typeof data === 'object' ? (data as Record<string, unknown>).result : undefined;
  const dizi = Array.isArray(sonuc) ? sonuc : null;
  return {
    httpDurum: yanit.status,
    jsonMu,
    resultUzunlugu: dizi ? dizi.length : null,
    hataliOgeSayisi: dizi ? dizi.filter(o => !!o && typeof o === 'object' && (o as Record<string, unknown>).IsError === true).length : null,
    evrakSayisi: evrak,
    yanitAnahtarlari: jsonMu && data !== null && typeof data === 'object' ? yanitAnahtarYollari(data) : [],
  };
}

/** Fırlatılan hatanın değer taşımayan ölçüsü: `err.name` ve `err.cause?.code` (C3; Ö1 karşılaştırması). İleti METNİ yok. */
export interface HataOlcusu { hataAdi: string | null; hataKodu: string | null }

const kodAlani = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  const s = guvenliAd(v, 60);
  return s === '' ? null : s;
};

export function hataOlcusu(hata: unknown): HataOlcusu {
  if (!hata || typeof hata !== 'object') return { hataAdi: null, hataKodu: null };
  const ad = guvenliAd((hata as { name?: unknown }).name, 60);
  const neden = (hata as { cause?: unknown }).cause;
  const kod = neden && typeof neden === 'object' ? (neden as { code?: unknown }).code : undefined;
  return { hataAdi: ad === '' ? null : ad, hataKodu: kod === undefined || kod === null ? null : kodAlani(kod) };
}
