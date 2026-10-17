/**
 * davetKodu.ts — davet kodunun TEK üreteci (yaprak modül; yalnız `node:crypto`).
 *
 * NEDEN VAR (2026-10-11, şartname «dış rol kapanışı» D11; tarama bulgusu 32): davet kodu `Math.random().toString(36)` × 2 ile
 * üretiliyordu. Aynı üreteç belge kimliklerini de üretir ve o kimlikler istemciye döner (kimliksiz form yazımının yanıtındaki
 * `id`) — üreteç durumu çıkarılırsa sonraki davet kodları tahmin edilebilirdi; davetteki rol Yönetici ise bu tam yetkidir.
 * Kod artık işletim sisteminin güvenli rastgele kaynağından 32 bayttır (64 onaltılık hane).
 *
 * NEDEN AYRI DOSYA: daveti İKİ uç yazar — `POST /api/admin/invite` (epostaRoutes.ts) ve süper yöneticinin kiracıya daveti
 * `POST /api/superadmin/tenants/:companyId/invite` (superadminRoutes.ts). İlk düzeltme yalnız birincisine uygulanmıştı; ikincisi
 * eski üreteçle kalmıştı (yarım düzeltme). Üreteç tek yerde durur ki iki uç ayrışamasın. Kod aynı zamanda `invites` belge
 * kimliğidir ve davet bağlantısında sorgu değeri olarak taşınır: onaltılık hane kaçış gerektirmez.
 * Çit: davetKodu.test.ts (`invites` belgesi yazan her modül kodu buradan alır; `Math.random` ile kod üreten satır yok).
 */
import { randomBytes } from 'node:crypto';

/** Davet kodunun biçimi: 64 onaltılık hane (32 bayt). */
export const DAVET_KODU_DESENI = /^[0-9a-f]{64}$/;

export function davetKoduUret(): string {
  return randomBytes(32).toString('hex');
}
