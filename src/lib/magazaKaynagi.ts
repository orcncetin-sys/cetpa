/**
 * magazaKaynagi.ts — çevrim içi mağaza (Shopify) siparişinin `orders.source` değeri. TEK KAYNAK (2026-10-02).
 * Sunucu eşleyicisi (server/kanal/shopifyEsleme) bunu YAZAR; istemci (utils/siparisler/magazaSiparisi) bununla SÜZER;
 * kimliksiz takip ucu (server.ts /api/track) bununla siparişi gizler. İki ayrı sabit olsaydı biri değişince ekran sessizce boşalırdı.
 */
export const MAGAZA_KAYNAGI = 'shopify_webhook';
