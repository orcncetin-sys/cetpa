/**
 * ebelgeTuru.ts — Mikro fatura başlığından e-belge TÜRÜ (2026-10-02).
 *
 * ÖLÇÜM (canlı `GET /api/mikro/ebelge-durum-tani`, 708 fatura başlığı, GİB durum sorgusuyla çapraz doğrulandı):
 *   • Tür `cha_ebelge_Islemturu`'ndadır: 1 → e-Fatura (EBelgeTipi 0 sorgusu "Fatura zarflandı / GİB 1300" döner, tip 1
 *     "İlgili e-belge bulunamadı"), 2 → e-Arşiv (EBelgeTipi 1 sorgusu "e-Arşiv faturası imzalandı" döner, tip 0 bulunamadı).
 *     Giden 393: 356 e-Fatura, 37 e-Arşiv.
 *   • `cha_ebelge_turu` tür DEĞİLDİR: 1 olan 6 giden faturanın hepsi e-Fatura çıktı (ör. 381, 264), 37 e-Arşiv'in hepsinde 0.
 *     Eski okuma «0 = e-Fatura, 1 = e-Arşiv» bir adet kırılımından ÇIKARSANMIŞTI (HANDOFF tie-out), ölçülmemişti; Faturalar
 *     ekranının "e-arsiv" süzgeci bu yüzden e-Arşiv OLMAYAN 6 satış + onlarca alış faturası gösteriyordu (kullanıcı 2026-10-02).
 *     Kolonun gerçek anlamı ölçülmedi (senaryo olabilir) — adlandırılmaz.
 *   • GELEN faturada `cha_ebelge_Islemturu` hep 0 (315/315): Mikro gelen faturanın türünü bu kolonda tutmuyor → BİLİNMİYOR.
 *
 * Dönüş: 0 = e-Fatura, 1 = e-Arşiv, -1 = bilinmiyor. Kolon adı Türkçe harmanlamalı kurulumda büyük 'I' ile gelir
 * (`cha_ebelge_Islemturu`); anahtar harf duyarsız aranır.
 */
export const EBELGE_TURU = { eFatura: 0, eArsiv: 1, bilinmiyor: -1 } as const;

export function ebelgeTuruCoz(x: Readonly<Record<string, unknown>>): number {
  // Yönü okunamayan başlık "giden" SAYILMAZ — tür de bilinmiyor kalır.
  if (x.cha_tip == null || x.cha_tip === '' || Number(x.cha_tip) !== 0) return EBELGE_TURU.bilinmiyor;
  const anahtar = Object.keys(x).find(k => k.toLowerCase() === 'cha_ebelge_islemturu');
  const ham = anahtar ? x[anahtar] : undefined;
  if (ham == null || ham === '') return EBELGE_TURU.bilinmiyor;
  const islem = Number(ham);
  return islem === 1 ? EBELGE_TURU.eFatura : islem === 2 ? EBELGE_TURU.eArsiv : EBELGE_TURU.bilinmiyor;
}
