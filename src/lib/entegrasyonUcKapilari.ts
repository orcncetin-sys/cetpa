/**
 * entegrasyonUcKapilari.ts — dış sistem / yapay zekâ uçlarının ROL KAPISI ortak tablosu (2026-10-17, şartname «iç rol
 * daraltma» § 2 + § 7 K3; `.wf/SARTNAME-ic-rol-daraltma.md`).
 *
 * NEDEN: yayin-15'ten beri iç rolü olmayan hesap (rolsüz, B2B, Bayi) bu uçlara `requireAuth`'ta takılıyor; kalan açık İÇ
 * ROLLER ARASINDAYDI. Uçlar yalnız `requireAuth` (+ MFA) ya da `requireStaff` istiyordu: Lojistik, Kalite, İK, Hukuk, Kurumsal
 * dâhil her iç rol LUCA'ya e-Fatura gönderebiliyor, yevmiye yazabiliyor, stok kartlarını LUCA'dan ezebiliyor, Paraşüt'te fatura
 * açabiliyor, Shopify'da sipariş açabiliyordu. Artık her uç EŞDEĞER koleksiyonun kuralını ister.
 *
 * İLKELER (mikro rol kapısıyla aynı): İ1 — Cetpa'ya ya da dış sisteme YAZAN uç eşdeğer koleksiyonun yazma kuralını ister.
 * İ2 — yalnız OKUYAN uç okuma kuralını. İ3 — rol geçemiyorsa düğme ÇİZİLMEZ, çağrı HİÇ yapılmaz (sessiz 403 / ölü düğme yok).
 * İ4 — kapı bu tablodan: istemci sunucunun kapısını ADIYLA sorar; bileşende rol adı da koleksiyon adı da yazılmaz.
 * İ5 — resmî belge (fatura, yevmiye) muhasebenindir.
 *
 * TEK KAYNAK ZİNCİRİ (çit: `src/server/entegrasyonUcKapilari.zincir.test.ts`):
 *   rota satırındaki kapı metni  ═  testin BEKLENEN tablosu  ═  bu tablo  (+ gerçek `server.ts` zincirinde davranış).
 * Rota satırı sunucuda düz metin KALIR (`requireCollectionAccess('invoices', 'write')`); kayma testte kırılır. Anahtar biçimi
 * `mikroUcKapilari.ts` ile AYNI: `'YÖNTEM /api/yol'`. Karar işlevi ortak çekirdekte (`ucKapisiCekirdegi.ts`) — «tabloda yok =
 * geçemez» kuralı iki tabloda da aynı işlevden gelir.
 *
 * MFA: bugün zincirinde `requireMfaVerified` olan her uçta yeni zincirde de kalır; rol kapısı yalnız `requireStaff`'ın yerine
 * geçer (§ 7). Tabloda olmayan ve kapısı DEĞİŞMEYEN uçlar: `GET /api/luca/status` (yalnız «yapılandırılmış mı»; yanıtta sır yok)
 * ve `POST /api/ai/generate`, `/chat`, `/demand-forecast` (personel; model sunucuda çözülür, gövdedeki `model` yok sayılır).
 *
 * SINIR: sunucu süper yöneticiyi (sahip hesabı) rolüne bakmadan geçirir; istemci ROLE bakar (mikro tablosuyla aynı kabul).
 */
import type { AppRole } from './rbac';
import { tablodakiUcKapisindanGecer, type UcKapisi } from './ucKapisiCekirdegi';

export const ENTEGRASYON_UC_KAPILARI = {
  // L1 — e-belge gönderim kredisi; e-Belge Merkezi'nin okuma kümesi (karar turu H2). MFA'sız (GET kalıbı).
  'GET /api/luca/kontor': ['eBelgeler', 'read'],
  // L2 — resmî belge (İ5). Kilitlenen: Satış, Lojistik, Satın Alma, İK, Hukuk, Kurumsal, Kalite (arayüzde kilit yok: e-Belge
  //      sekmesi zaten Yönetici, Müdür, Muhasebe). 2026-10-19 (LA): uç KAPALI — kapı aynen önde, ardından her isteğe 400
  //      `LUCA_FATURA_KAPALI`; istemcide çağıranı YOK (düğme kalktı).
  'POST /api/luca/fatura-gonder': ['invoices', 'write'],
  // L3 — yevmiye (İ5). İstemcide çağıranı YOK.
  'POST /api/luca/sync/yevmiye': ['journalEntries', 'write'],
  // L4 — `inventory`'ye yazar (İ1) + kiracı sınırı (yabancı kiracının kartı ezilmez, sayaçla atlanır).
  'POST /api/luca/sync/stok': ['inventory', 'write'],
  // L5 / K4 — siparişi LUCA'ya fatura olarak gönderir (İ5). Başarıda `orders`'a yalnız sunucuda türetilen alanlar merge edilir;
  //      `orders:write` İSTENMEZ (İ5 İ1'e baskın, bilerek). 2026-10-19 (LA): uç KAPALI — kapı aynen önde, ardından her isteğe 400;
  //      sipariş okunmaz, alan yazılmaz; istemcide çağıranı YOK (LUCA panelinin fatura kartı kalktı).
  'POST /api/luca/sync/fatura': ['invoices', 'write'],
  // P1 / K3 — Paraşüt'te satış faturası açar (İ5, L5'in kardeşi). İstemcide çağıranı YOK (ölçüldü 2026-10-17).
  'POST /api/parasut/fatura': ['invoices', 'write'],
  // Y2 — bir carinin satış satırlarını okur; eşdeğer veri satış faturası satırları. Kilitlenen (K5): Satın Alma.
  'POST /api/ai/satis-ajani': ['invoices', 'read'],
  // Y3 — kritik stok + son alış tedarikçileri.
  'POST /api/ai/satinalma-ajani': ['purchaseOrders', 'read'],
  // S1 — mağazada sipariş açar (İ1). Kilitlenen (K5): Muhasebe, Satın Alma («Dönüştür» düğmesi bu rollerde ÇİZİLMEZ).
  'POST /api/shopify/draft-order': ['orders', 'write'],
  // S2 / K1 — HİÇBİR koleksiyona yazmaz: mağazadan ürün ve sipariş OKUR, yalnız sayıları döner → okuma kapısı.
  'POST /api/shopify/sync': ['orders', 'read'],
  // S3 — `skuMappings`'e yazar (İ1).
  'POST /api/sku-mapping/auto-match': ['skuMappings', 'write'],
  // A1 / K3 — `purchaseOrders`'a taslak yazar (İ1). Kilitlenen: Lojistik (Stok sekmesi tam), Muhasebe ve Satış (salt okunur).
  'POST /api/inventory/auto-reorder': ['purchaseOrders', 'write'],
} as const satisfies Record<string, UcKapisi>;

/** Ortak tabloda kapısı olan entegrasyon ucu — `'YÖNTEM /api/yol'`. */
export type EntegrasyonKapiliUc = keyof typeof ENTEGRASYON_UC_KAPILARI;

/** Bu rol, ucun sunucudaki kapısından geçer mi? İstemci düğmeyi çizmeden / çağrıyı yapmadan ÖNCE sorar.
 *  Rolsüz hesap ve tabloda olmayan anahtar GEÇEMEZ — kapalı başarısızlık (çekirdek kural). */
export function entegrasyonUcKapisindanGecer(rol: AppRole | null | undefined, uc: EntegrasyonKapiliUc): boolean {
  return tablodakiUcKapisindanGecer(ENTEGRASYON_UC_KAPILARI, rol, uc);
}
