/**
 * takipBaglantisi.ts — Siparişler ekranının müşteri takip bağlantısı: kodu sunucudan al, bağlantıyı panoya yaz (şartname
 * `.wf/SARTNAME-takip-kodu-ve-luca-reddi.md` T4 / TE; 2026-10-19).
 *
 * Bağlantı eskiden `?track=<doküman kimliği>` idi; MF siparişinin kimliği (`mikrofat__<cid>__<seri>-<sıra>`) kiracıyı verir ve
 * öteki siparişler sırayla okunurdu. Bağlantı artık siparişin TAKİP KODUNU taşır — kodu yalnız sunucu üretir
 * (`POST /api/siparis/:orderId/takip-kodu`; ilk çağrıda yazılır, sonra hep aynısı döner).
 *
 * PANO — tıklama işleyicisinde, hiçbir `await`'ten ÖNCE: tarayıcılar (Safari başta) panoya yazımı yalnız kullanıcı hareketinin
 * içinde kabul eder; kod isteği bitip de yazılırsa izin düşer. `panoyaSozle` metnin SÖZÜNÜ hemen verir: `ClipboardItem` varsa
 * yazım hemen başlar ve metin söz çözülünce dolar; yoksa `writeText` söz çözülünce çağrılır. Hata ayrımı: kod alınamadıysa
 * `TakipKoduHatasi` (sunucunun Türkçe iletisiyle), pano reddettiyse `PanoHatasi`.
 */
import { authFetch } from '../services/authFetch';
import { takipKoduMu } from './takipKodu';

/** Kod alınamadı (ağ, yetki, sipariş yok, mağaza siparişi …). `sunucuIletisi` = sunucunun `error` metni (varsa). */
export class TakipKoduHatasi extends Error {
  readonly sunucuIletisi: string | null;
  constructor(sunucuIletisi: string | null) {
    super(sunucuIletisi ? `Takip bağlantısı alınamadı: ${sunucuIletisi}` : 'Takip bağlantısı alınamadı.');
    this.name = 'TakipKoduHatasi';
    this.sunucuIletisi = sunucuIletisi;
  }
}

/** Metin hazırdı ama pano yazımı reddedildi (izin, odak, desteklenmeyen tarayıcı). */
export class PanoHatasi extends Error {
  constructor(neden: string) {
    super(neden);
    this.name = 'PanoHatasi';
  }
}

const nesneMi = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Siparişin müşteri takip bağlantısı (`<köken>/?track=<kod>`). Başarısızlıkta `TakipKoduHatasi`. */
export async function takipBaglantisiAl(orderId: string): Promise<string> {
  let yanit: Response;
  try {
    yanit = await authFetch(`/api/siparis/${encodeURIComponent(orderId)}/takip-kodu`, { method: 'POST' });
  } catch {
    throw new TakipKoduHatasi('sunucuya ulaşılamadı');
  }
  let govde: unknown = null;
  try { govde = await yanit.json(); } catch { /* gövdesiz yanıt — aşağıda hata */ }
  const g: Record<string, unknown> = nesneMi(govde) ? govde : {};
  if (yanit.ok && g.success === true && takipKoduMu(g.takipKodu)) {
    return `${window.location.origin}/?track=${encodeURIComponent(g.takipKodu)}`;
  }
  throw new TakipKoduHatasi(typeof g.error === 'string' && g.error.trim() !== '' ? g.error : null);
}

/** Kod hatasının ekran metni (iki dil). Sunucu iletisi Türkçedir; İngilizce arayüzde de aynen eklenir. */
export function takipKoduHataMetni(hata: TakipKoduHatasi, dil: string): string {
  const ek = hata.sunucuIletisi ? `: ${hata.sunucuIletisi}` : '.';
  return dil === 'tr' ? `Takip bağlantısı alınamadı${ek}` : `Tracking link could not be created${ek}`;
}

/**
 * Metnin SÖZÜNÜ panoya yazar — tıklama işleyicisinde, ilk `await`'ten ÖNCE çağrılmalı (yukarıdaki not). Söz düşerse onun hatası
 * (ör. `TakipKoduHatasi`) aynen fırlar; metin hazırken pano reddederse `PanoHatasi`.
 */
export function panoyaSozle(metinSozu: Promise<string>): Promise<void> {
  const pano = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  let yazim: Promise<void>;
  if (pano && typeof ClipboardItem !== 'undefined' && typeof pano.write === 'function') {
    yazim = pano.write([new ClipboardItem({ 'text/plain': metinSozu.then(m => new Blob([m], { type: 'text/plain' })) })]);
  } else if (pano && typeof pano.writeText === 'function') {
    yazim = metinSozu.then(m => pano.writeText(m));
  } else {
    yazim = Promise.reject(new PanoHatasi('Pano bu tarayıcıda kullanılamıyor.'));
  }
  return yazim.then(() => undefined, async (hata: unknown) => {
    await metinSozu;   // metin üretilemediyse asıl neden odur — buradan aynen fırlar
    throw new PanoHatasi(hata instanceof Error ? hata.message : String(hata));
  });
}
