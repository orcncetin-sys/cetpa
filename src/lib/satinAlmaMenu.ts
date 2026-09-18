/**
 * satinAlmaMenu.ts — Satın Alma alt sekmelerinin TEK listesi (2026-09-18). Test: satinAlmaMenu.test.ts.
 *
 * Kenar menü (App.tsx) ve mobil sekme barı (SatinAlmaPage.tsx) bu listeden türer. Eskiden ikisi ayrı ayrı elle
 * yazılıydı: mobil bar 8 sekmenin yalnız 5'ini içeriyordu ve aynı sekmeye farklı ad veriyordu
 * ("Tedarikçi Performansı" ↔ "Tedarikçi Skorkartı"). Yeni bir alt sekme eklerken YALNIZ burayı güncelle
 * (+ SatinAlmaPage'deki simge eşlemesi ve sekmenin içeriği).
 */
import { oc } from '../i18n/ortak';

export type SatinAlmaSekmesi =
  | 'pos' | 'suppliers' | 'scorecard' | 'odeme-takvimi'
  | 'tedarikci-portal' | 'satin-butce' | 'tedarik-risk' | 'fiyat-karsilastirma';

export interface SatinAlmaMenuOgesi { key: SatinAlmaSekmesi; etiket: (tr: boolean) => string }

export const SATIN_ALMA_MENU: readonly SatinAlmaMenuOgesi[] = [
  { key: 'pos',                 etiket: tr => oc(tr).satin_alma_siparisleri },
  { key: 'suppliers',           etiket: tr => oc(tr).tedarikciler },
  { key: 'scorecard',           etiket: tr => (tr ? 'Tedarikçi Performansı' : 'Supplier Score') },
  { key: 'odeme-takvimi',       etiket: tr => oc(tr).odeme_takvimi },
  { key: 'tedarikci-portal',    etiket: tr => oc(tr).tedarikci_portali },       // Phase 551
  { key: 'satin-butce',         etiket: tr => oc(tr).satin_alma_butcesi },      // Phase 612
  { key: 'tedarik-risk',        etiket: tr => oc(tr).tedarik_zinciri_riski },   // Phase 627
  // Muhasebe'den taşındı (2026-08-31 kullanıcı isteği).
  { key: 'fiyat-karsilastirma', etiket: tr => oc(tr).fiyat_karsilastirma },
];
