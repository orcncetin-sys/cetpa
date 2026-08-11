/**
 * ebelgeIndir.ts — Mikro e-belge (PDF/XML) indirmenin TEK uygulaması.
 *
 * Neden var: aynı mantık MikroFaturaDetay.tsx ve EBelgeMerkezi.tsx içinde
 * birebir kopyalanmıştı (base64 çözme, alan arama, blob indirme, hata metni).
 * İki kopya ayrı ayrı bakım gerektiriyordu ve biri düzeltilince diğeri geride
 * kalıyordu. Tek kaynak: burası.
 *
 * XML e-belgenin YASAL aslıdır, PDF yalnız görüntüsüdür — mali müşavire
 * gönderim ve arşiv için gereken XML'dir.
 */
import { authFetch } from './authFetch';

export type EBelgeTuru = 'xml' | 'pdf';

export interface EBelgeIstek {
  tur: EBelgeTuru;
  /** GİB belge kimliği. XML için ZORUNLU; PDF'de yoksa faturaGuid kullanılır. */
  uuid?: string;
  /** Mikro fatura GUID'i — yalnız GİDEN faturanın PDF'i için (FaturaPdfV2). */
  faturaGuid?: string;
  /** XML'de belge tipini seçer (e-fatura/e-arsiv/e-irsaliye). */
  belgeTuru?: string;
  yon?: 'gelen' | 'giden';
  /** Uzantısız dosya adı. */
  dosyaAdi: string;
}

/** Yanıttaki base64/metin alanını bul — alan adı Mikro sürümüne göre değişir. */
function uzunAlan(d: unknown, minUzunluk: number): string | undefined {
  if (typeof d === 'string') return d.length > minUzunluk ? d : undefined;
  if (d && typeof d === 'object') {
    for (const v of Object.values(d)) {
      if (typeof v === 'string' && v.length > minUzunluk) return v;
    }
  }
  return undefined;
}

/** Tarayıcıda dosya indirmeyi tetikle. */
function dosyaIndir(blob: Blob, ad: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = ad;
  a.click();
  URL.revokeObjectURL(href);
}

/**
 * Belgeyi Mikro'dan çekip indirir.
 * @returns başarılıysa `null`, aksi halde KULLANICIYA GÖSTERİLECEK hata metni.
 *
 * Sunucu "başarılı ama boş" durumunu artık kendisi yakalayıp açıklayıcı hata
 * döndürüyor (SRV GİB yetkisi) — buradaki biçim kontrolü son çare olarak kalır.
 */
export async function eBelgeIndir(istek: EBelgeIstek, tr: boolean): Promise<string | null> {
  const { tur } = istek;
  if (tur === 'xml' && !istek.uuid) {
    return tr ? 'Bu belgede UUID yok — XML çekilemez.' : 'No UUID — XML unavailable.';
  }
  try {
    const url = tur === 'xml' ? '/api/mikro/ebelge/xml' : '/api/mikro/ebelge/pdf';
    const govde = tur === 'xml'
      ? { uuid: istek.uuid, tur: istek.belgeTuru ?? 'e-fatura', yon: istek.yon }
      : (istek.uuid ? { uuid: istek.uuid } : { faturaGuid: istek.faturaGuid });

    // authFetch ŞART: /api/mikro/ebelge/* requireAuth arkasında. Düz fetch +
    // credentials:'same-origin' yetmiyor — oturum çerezle değil Firebase ID
    // token'ıyla taşınıyor, o yüzden "Missing Authorization header" dönüyordu.
    const r = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(govde),
    });
    const d = await r.json() as { success?: boolean; error?: string; data?: unknown };
    if (!r.ok || !d.success) {
      return d.error || (tr ? 'Belge alınamadı.' : 'Failed to fetch.');
    }

    const alan = uzunAlan(d.data, tur === 'xml' ? 200 : 500);
    if (!alan) return tr ? 'Yanıt beklenen biçimde değil.' : 'Unexpected response shape.';

    if (tur === 'xml') {
      // Base64 de olabilir düz XML de — '<' ile başlıyorsa düzdür.
      const metin = alan.trimStart().startsWith('<') ? alan : (() => {
        try { return decodeURIComponent(escape(atob(alan.replace(/^data:.*?;base64,/, '')))); }
        catch { return alan; }
      })();
      dosyaIndir(new Blob([metin], { type: 'application/xml;charset=utf-8' }), `${istek.dosyaAdi}.xml`);
    } else {
      const bin = atob(alan.replace(/^data:.*?;base64,/, ''));
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      dosyaIndir(new Blob([buf], { type: 'application/pdf' }), `${istek.dosyaAdi}.pdf`);
    }
    return null;
  } catch {
    return tr ? 'İndirme başarısız — sunucuya ulaşılamadı.' : 'Download failed.';
  }
}
