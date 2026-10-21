/**
 * gorulebilirSiparis.ts — `/api/db` DIŞINDAKİ bir uçta istemciden gelen sipariş kimliğini OKUR ve siparişi yalnız çağıran onu
 * GÖREBİLİYORSA döndürür (kiracı + dış rolde satır — lib/tenantErisim `siparisGorebilir`). Yok / yabancı kiracının / görünmez
 * sipariş → `null`; çağıran «Sipariş bulunamadı.» der (varlık sızmaz, yabancı kiracıyla «yok» aynı yanıt).
 *
 * TEK KALIP (2026-10-21): takip kodu alma ucu (`POST /api/siparis/:orderId/takip-kodu`, server.ts), sipariş durum e-postası
 * (`/api/email/order-notification`, routes/epostaRoutes) ve sipariş durum WhatsApp iletisi (`/api/whatsapp/order-notification`,
 * server.ts) bunu çağırır. Önceden ilk ikisinde aynı üç satır (oku → `exists` → `siparisGorebilir`) kopyaydı; WhatsApp ucu
 * siparişi okumaya başlayınca üçüncü kopya olacaktı. Kapının geri kalanı (kimlik, MFA, personel, `orders` okuma kuralı) rota
 * satırındadır. Çit: satirSuzgeci.degismez.test («sahiplik denetimi tek işlevde»).
 */
import type { AdminDbLike } from './adminDbTypes.js';
import type { AppRole } from '../lib/rbac.js';
import { siparisGorebilir } from '../lib/tenantErisim.js';

export async function gorulebilirSiparisOku(
  db: AdminDbLike, rol: AppRole | null | undefined, k: { uid: string; cid: string }, orderId: string,
): Promise<Record<string, unknown> | null> {
  const belge = await db.collection('orders').doc(orderId).get();
  const siparis = belge.exists ? belge.data() : undefined;
  return siparis && siparisGorebilir(rol, k, siparis) ? siparis : null;
}
