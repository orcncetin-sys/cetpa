/**
 * leadArama.ts — CRM lead arama süzgeci, TEK KAYNAK (2026-09-19).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `CRMPage` aynı üç satırlık süzgeci ÜÇ yerde (liste, kanban sayacı, kanban kartları)
 * elle kopyalamıştı ve üçü de korumasızdı:
 *
 *     l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) ||
 *     l.email.toLowerCase().includes(q)
 *
 * İKİ ARIZA:
 *  1. ÇÖKME. Mikro cari import'u artık BİLİNMEYEN alanı hiç yazmıyor (eslemeCari
 *     sözleşmesi: "bayat değer, silinmiş değerden iyidir"), bu yüzden `cari_EMail`i
 *     boş bir cariden açılan lead'de `email` anahtarı BULUNMAYABİLİR. `Lead` tipi
 *     `email: string` dediği için tsc bunu yakalamaz. Kullanıcı arama kutusuna adla
 *     eşleşmeyen bir metin yazdığı anda `||` zinciri üçüncü kola geçer ve
 *     "Cannot read properties of undefined" ile CRM sekmesi TabErrorBoundary'ye düşer.
 *     (Eski rota `email: (x as string) || ''` yazdığı için bu yol daha önce güvenliydi —
 *     yazma sözleşmesi değişti, okuyan taraf güncellenmemişti: "yarım düzeltme" sınıfı.)
 *  2. TÜRKÇE EŞLEŞMEME. `toLowerCase()` locale-duyarsızdır: Mikro'dan gelen BÜYÜK
 *     unvan 'ŞİRİN İNŞAAT' → 'şi̇ri̇n i̇nşaat' (i + birleşik nokta) olur ve kullanıcının
 *     yazdığı 'şirin' ile ASLA eşleşmez; 'IŞIK' → 'ışık' aranırken bulunamaz.
 *     Anahtar tek kaynaktan: `isimAnahtari` (tr-TR) — CLAUDE.md casing kuralı.
 *
 * Alan kümesi BİLEREK eskisiyle aynı (ad + unvan + e-posta): arama semantiğini
 * genişletmek bu düzeltmenin işi değil.
 */
import { isimAnahtari } from './isimAnahtari';

/** Aramaya giren lead alanları — hepsi opsiyonel ve `unknown`: eksik alan normaldir. */
export interface AranabilirLead {
  name?: unknown;
  company?: unknown;
  email?: unknown;
}

/**
 * Lead, arama metniyle eşleşiyor mu? Boş/boşluk sorgu HER lead'i geçirir (filtresiz liste).
 * Eksik/null alan boş metin sayılır — hiçbir alan okuması çökmez.
 */
export function leadAramaEslesir(lead: AranabilirLead, sorgu: unknown): boolean {
  const q = aramaAnahtari(sorgu);
  if (q === '') return true;
  return aramaAnahtari(lead.name).includes(q)
      || aramaAnahtari(lead.company).includes(q)
      || aramaAnahtari(lead.email).includes(q);
}

/**
 * ARAMA katlaması: tr-TR küçültme + ı→i. Yalnız burada — `isimAnahtari` mükerrer-lead EŞLEŞTİRME anahtarıdır,
 * ona dokunulmaz (ı/i'yi orada katlamak 'ILIK' ile 'İLİK'i aynı cari sayardı).
 * Neden: tr-TR küçültme ASCII 'I'yı 'ı' yapar; NOKTASIZ büyük harfle yazılmış kayıtlar (Mikro/Excel: 'DEMIR
 * INSAAT', 'INFO@DEMIR.COM') 'demir' / 'info@' sorgusuyla bulunmuyordu — eski `toLowerCase()` buluyordu
 * (2026-09-19 kapanış incelemesi, regresyon). Katlama iki yöne de uygulanır; ş/ç/ğ/ö/ü translit EDİLMEZ.
 */
function aramaAnahtari(x: unknown): string {
  return isimAnahtari(x).replace(/ı/g, 'i');
}
