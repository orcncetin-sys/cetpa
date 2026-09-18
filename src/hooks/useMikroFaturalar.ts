import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { bilinenSayi } from '../utils/para';

/** Mikro faturası — istemci tarafı normalize edilmiş şekil.
 *  KAYNAK: `mikroFaturalar` koleksiyonu (server: /api/mikro/import/fatura-listesi).
 *  Ham `cha_*` alanları burada TEK yerde eşlenir — AccountingModule, MuhasebePage
 *  ve RaporlarPage aynı eşlemeyi kopyalıyordu (code-review reuse bulgusu). */
export interface MikroFatura {
  id: string;
  cariKod: string;
  tarih: string;                 // 'YYYY-MM-DD'
  /** Fatura toplamı (cha_meblag). **NaN = BİLİNMİYOR** — doğrudan toplama, `para.toplaBilinen` kullan. */
  tutar: number;
  faturaNo: string;
  /** Fatura satırlarından JOIN'li KDV (başlıkta yok). **NaN = BİLİNMİYOR** — `toplaBilinen` ile topla. */
  kdv: number;
  /** KDV matrahı (satır JOIN'i / başlık ara toplamı). **NaN = BİLİNMİYOR** — `toplaBilinen` ile topla. */
  matrah: number;
  oran: number | null;           // vergiPntr indeksinden; çözülemezse null
  oranKarma: boolean;            // true: faturada birden fazla KDV oranı var (ör. %10 + %20) — oran tek başına yanıltıcı
  yon: 'gelen' | 'giden';        // cha_tip 1=gelen(alış), 0=giden(satış)
  uuid?: string;                 // GİB belge kimliği (e-belge XML/PDF)
  ebelgeTuru: number;            // 0=e-Fatura, 1=e-Arşiv, 2=e-İrsaliye; -1=bilinmiyor
  /** cha_subeno — şube bazlı P&L eşleşmesi için. **NaN = BİLİNMİYOR** (0 = merkez, meşru değer). */
  subeNo: number;
}

export const VERGI_PNTR_ORAN: Record<string, number> = { '1': 0, '2': 1, '3': 10, '4': 20 };

/** Bilinen sayıya çevir; değilse NaN — `Number(x ?? 0) || 0` sahte sıfırının yerine (bkz. başlık notu). */
const paraOku = (x: unknown): number => (bilinenSayi(x) ? Number(x) : NaN);

/** Ham mikroFaturalar dokümanını normalize et (iptal edilmişler çıkarılır).
 *
 *  SAHTE SIFIR KALDIRILDI (Faz 3 2/n, 2026-09-18): `tutar`/`kdv`/`matrah` eskiden
 *  `Number(x ?? 0) || 0` idi — meblağı NULL gelen ya da satır JOIN'i tutmayan fatura
 *  "₺0 biliniyor" olarak 8+ tüketiciye yayılıyordu (Ba/Bs ₺5.000 eşiği, KDV Analizi,
 *  Şube P&L, FinancePanel ciro). Artık bilinmeyen NaN'dır: `toplaBilinen` toplama
 *  katmaz ve SAYAR, `paraYaz` '—' basar. Meşru ₺0 faturası 0 kalır. */
export function mapMikroFatura(id: string, x: Record<string, unknown>): MikroFatura {
  const seri = String(x.cha_evrakno_seri ?? '').trim();
  const sira = x.cha_evrakno_sira;

  // BAYAT ₺0 KORUMASI (delta turu, 2026-09-18): sunucudaki `ISNULL(…, 0)` yedeği bugün kalktı ama
  // DAHA ÖNCE import edilmiş dokümanlara `kdvTutari: 0` / `matrah: 0` yazmıştı. Gece cron'u yalnız
  // son 90 günü yeniliyor; eski faturalar elle tam import edilene kadar o sahte sıfırı taşır ve
  // buradan "bilinen 0" olarak Ba/Bs eşiğine, KDV Analizi'ne ve mizana yayılır.
  //
  // Ayırt edici: `oranSayisi` satır alt sorgusunun COUNT'udur — JOIN tuttuysa EN AZ 1, tutmadıysa
  // NULL/eksik. Zincirin ikinci halkası matrahta `cha_aratoplam`, KDV'de `cha_meblag − cha_aratoplam`.
  // İkisi de okunamıyorsa YENİ SQL zaten NULL indirir; aynı sonucu eski dokümanda da üretiriz.
  // Koruma YALNIZ TAM 0'a uygulanır: gerçek bir tutar hiçbir koşulda düşürülmez, satır JOIN'i tutan
  // meşru ₺0 faturası (istisna/ihracat) 0 kalır.
  const satirYok = x.oranSayisi == null;
  const araToplamBilinir = bilinenSayi(x.cha_aratoplam);
  const matrahTuretilebilir = !satirYok || araToplamBilinir;
  const kdvTuretilebilir = !satirYok || (araToplamBilinir && bilinenSayi(x.cha_meblag));
  const tutarOku = (deger: unknown, turetilebilir: boolean): number => {
    const n = paraOku(deger);
    return turetilebilir || n !== 0 ? n : NaN;
  };

  return {
    id,
    cariKod:  String(x.cha_kod ?? '').trim(),
    tarih:    String(x.cha_tarihi ?? '').slice(0, 10),
    tutar:    paraOku(x.cha_meblag),
    faturaNo: [seri, sira].filter(v => v !== '' && v != null).join('-'),
    kdv:      tutarOku(x.kdvTutari, kdvTuretilebilir),
    matrah:   tutarOku(x.matrah, matrahTuretilebilir),
    oran:     VERGI_PNTR_ORAN[String(x.vergiPntr ?? '')] ?? null,
    oranKarma: Number(x.oranSayisi ?? 1) > 1,
    uuid:     String(x.cha_uuid ?? x.cha_ettn ?? x.uuid ?? '') || undefined,
    ebelgeTuru: Number(x.cha_ebelge_turu ?? -1),
    // `?? 0` BURADA MEŞRU: para değil SINIFLANDIRMA varsayılanı (cha_tip 1=gelen/alış, 0=giden/satış).
    // Bilinen sınır: yönü okunamayan fatura SATIŞ sayılır ve ciroyu şişirebilir; `yon`un üçüncü bir
    // durumu olmadığı için düzeltmesi tüm tüketicileri değiştirir — Açık İşler.
    yon:      Number(x.cha_tip ?? 0) === 1 ? 'gelen' : 'giden',
    // Şube no da BİLİNMEYEBİLİR: `?? 0` okunamayan şubeyi "şube 0" (merkez) yapıyordu ve
    // faturanın cirosu YANLIŞ şubenin P&L'ine yazılabiliyordu. NaN eşleşmez → o fatura hiçbir
    // şubeye eklenmez (SubeModule'ün "yanlış şubeye yazmaktansa görünür boşluk" kararı).
    // Mikro'nun MEŞRU 0'ı (merkez) aynen 0 kalır.
    subeNo:   paraOku(x.cha_subeno),
  };
}

/** mikroFaturalar koleksiyonunu dinle. `enabled` false iken abone OLMAZ.
 *  Mikro kayıt silmez (*_iptal=1 işaretler) → iptal edilenler dışlanır. */
export function useMikroFaturalar(enabled: boolean): MikroFatura[] {
  const [faturalar, setFaturalar] = useState<MikroFatura[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const unsub = onSnapshot(
      collection(db, 'mikroFaturalar'),
      (snap: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => {
        setFaturalar(
          snap.docs
            .map(d => {
              const x = d.data();
              // `?? 0` MEŞRU: Mikro iptali AÇIKÇA işaretler (*_iptal=1); alan yoksa iptal DEĞİLdir.
              const iptal = x.cha_iptal === true || Number(x.cha_iptal ?? 0) === 1;
              return { f: mapMikroFatura(d.id, x), iptal };
            })
            .filter(r => !r.iptal)
            .map(r => r.f),
        );
      },
      () => setFaturalar([]),
    );
    return () => unsub();
  }, [enabled]);
  return faturalar;
}

/** cariKod → müşteri adı (leads). Mikro faturasında yalnız cari KODU var. */
export function useCariAdMap(leads: Array<Record<string, unknown>>): Map<string, string> {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) {
      const kod = String((l as { mikroCariKod?: string }).mikroCariKod ?? '').trim();
      if (kod) m.set(kod, String((l as { company?: string }).company || (l as { name?: string }).name || kod));
    }
    return m;
  }, [leads]);
}
