/**
 * mfKaynagi.ts — Mikro satış faturasından SUNUCUNUN türettiği siparişin (MF) işaretleri. TEK KAYNAK (2026-10-19, şartname
 * «sipariş kaynak kapısı» H1). Sunucu eşleyicisi (server/mikro/eslemeFatura.faturadanSiparis) bunları YAZAR; gece / panel
 * «faturadan sipariş türetme» (routes/mikroRoutes) Cetpa siparişini bunlarla AYIRIR; e-Fatura talebi (server/mikro/faturaGonderimi)
 * MF siparişine ikinci resmî belgeyi bununla REDDEDER; `/api/db` istemcinin bu değeri yazmasını (collections.SUNUCU_KAYNAK_DEGERLERI)
 * ve iç rolün bu önekle yeni kayıt açmasını (tenantErisim.ayrilmisKimlikMi) bunlarla KAPATIR. İki ayrı metin olsaydı biri değişince
 * korumalar sessizce ayrışırdı. `MF_KAYNAGI` SQL'e gömülür (biçim `[A-Za-z0-9_-]`; gömen yer denetler).
 * İstemci okuyucuları (`src/utils/*`, `src/pages/*`) bugün metni kendileri yazıyor — bağlanmaları ayrı iş (6m devri).
 */
export const MF_KAYNAGI = 'mikro-fatura';

/** MF siparişinin doküman kimliği öneki: `mikrofat__<cid>__<seri>-<sira>` (idempotentlik anahtarı — BİÇİM DEĞİŞMEZ). */
export const MF_KIMLIK_ONEKI = 'mikrofat__';

/** MF siparişi ↔ Mikro satış faturası ANAHTARI — TEK KAYNAK (şartname q-serisi v3 «Kapı sonrası hükümler» QH1-2, 2026-11-05).
 *  Biçim `useMikroFaturalar.mapMikroFatura`'nın `faturaNo`'suyla BİREBİR: her parça `String(v ?? '').trim()`, boş parça atılır,
 *  kalanlar `'-'` ile birleşir → Q-1 için `'Q-1'`, boş seride `'123'`. Girdi `unknown`: Mikro sırası sayı gelir (`0` geçerli
 *  bir parçadır, atılmaz). Okuyanlar: `mapMikroFatura` (Mikro satırının `faturaNo`'su), Raporlar tekilleştirmesi, Satışlar /
 *  Finans ikiz elemesi (`utils/pano/mikroBirlesim.mfIkiziListede`) — MF'nin `mikroEvrak.seri` / `.sira`'sından aynı anahtar.
 *  MF'nin `mikroFaturaNo`'su (`${seri}${sira}` → 'Q1') ANAHTAR DEĞİLDİR: Q'da Mikro satırının 'Q-1'iyle eşleşmez. */
export const mikroFaturaAnahtari = (seri: unknown, sira: unknown): string =>
  [seri, sira].map(v => String(v ?? '').trim()).filter(v => v !== '').join('-');
