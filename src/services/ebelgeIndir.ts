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
 *
 * ROL KAPISI (karar turu 2026-10-11 — K7 / H1, İ3, İ5): indirme isteği atılmadan ÖNCE rol, sunucunun kapısını ortak
 * tablodan sorar (`lib/mikroUcKapilari`). Rol geçemiyorsa istek HİÇ atılmaz (sessiz 403 yok) — çağıran unutsa da.
 * Kapı İKİ YÖNDE de aynıdır: sunucu belgenin yönünü bilemez, «giden belge Satış'a açık» dalı YOKTUR; bu yüzden kapı
 * sorusu yön almaz. (`EBelgeIstek.yon` kapı için değil, Mikro'nun XML isteğindeki belge tipi için taşınır.)
 */
import { authFetch } from './authFetch';
import { useAppStore } from '../store/appStore';
import { ucKapisindanGecer, type MikroKapiliUc } from '../lib/mikroUcKapilari';

export type EBelgeTuru = 'xml' | 'pdf';

export interface EBelgeIstek {
  tur: EBelgeTuru;
  /** GİB belge kimliği. XML için ZORUNLU; PDF'de yoksa faturaGuid kullanılır. */
  uuid?: string;
  /** Mikro fatura GUID'i — yalnız GİDEN faturanın PDF'i için (FaturaPdfV2). */
  faturaGuid?: string;
  /** XML'de belge tipini seçer (e-fatura/e-arsiv/e-irsaliye). */
  belgeTuru?: string;
  /** YALNIZ XML gövdesinde Mikro'ya gider (gelen / gönderilen belge seçimi). Rol kapısı yöne BAKMAZ; PDF gövdesine yazılmaz. */
  yon?: 'gelen' | 'giden';
  /** Uzantısız dosya adı. */
  dosyaAdi: string;
}

/** Türün sunucu ucu = ortak tablodaki kapı anahtarı (`'YÖNTEM /yol'`). Kapı sorusu ve istek yolu AYNI sabitten çıkar —
 *  biri değişip öbürü kalamaz. */
const INDIRME_UCU = {
  pdf: 'POST /api/mikro/ebelge/pdf',
  xml: 'POST /api/mikro/ebelge/xml',
} as const satisfies Record<EBelgeTuru, MikroKapiliUc>;

/** Ortak tablo anahtarının yol parçası (`'POST /api/…'` → `'/api/…'`). */
const ucYolu = (uc: MikroKapiliUc): string => uc.slice(uc.indexOf(' ') + 1);

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
 *
 * Rol, ucun kapısından geçemiyorsa istek ATILMAZ ve yetki metni döner (rol küresel depodan okunur).
 */
export async function eBelgeIndir(istek: EBelgeIstek, tr: boolean): Promise<string | null> {
  const { tur } = istek;
  const uc = INDIRME_UCU[tur];
  if (!ucKapisindanGecer(useAppStore.getState().userRole, uc)) {
    return tr ? 'Bu belgeyi indirme yetkiniz yok.' : 'You are not allowed to download this document.';
  }
  if (tur === 'xml' && !istek.uuid) {
    return tr ? 'Bu belgede UUID yok — XML çekilemez.' : 'No UUID — XML unavailable.';
  }
  try {
    const url = ucYolu(uc);
    // PDF gövdesi yön TAŞIMAZ (H1: kapı yöne bağlı değil; sunucu yöntemi anahtara göre seçer).
    const govde = tur === 'xml'
      ? { uuid: istek.uuid, tur: istek.belgeTuru ?? 'e-fatura', yon: istek.yon }
      : (istek.uuid ? { uuid: istek.uuid } : { faturaGuid: istek.faturaGuid });

    // authFetch ŞART: /api/mikro/ebelge/… uçları requireAuth arkasında. Düz fetch +
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
