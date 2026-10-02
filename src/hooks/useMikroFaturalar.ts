import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';
import { bilinenSayi } from '../utils/para';
import { ebelgeTuruCoz } from '../utils/muhasebe/ebelgeTuru';
import { gibReddedildi } from '../lib/gibDurum';

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
  /** KDV matrahı = Mikro'nun NET okuması: başlıktan `cha_aratoplam − Σcha_ft_iskonto` (tek kaynak `lib/faturaMatrahi`),
   *  başlık okunamazsa satır neti Σ(sth_tutar − Σiskonto + Σmasraf) — hangisi olduğu `matrahKaynagi`nda. Alan yoksa ESKİ
   *  doküman (brüt Σsth_tutar / aratoplam; gece 'tam' yenilemesiyle düzelir). **NaN = BİLİNMİYOR** — `toplaBilinen` ile topla. */
  matrah: number;
  /** Import'un matrahı nereden yazdığı; `undefined` = alan yok (matrah aşama 2 öncesi doküman). */
  matrahKaynagi?: MatrahKaynagi;
  /** Mikro'da AYNI yön + evrak numarasında birden çok fatura başlığı var (canlıda giden 246): satır grubu paylaşılır, kalemler
   *  hepsinin toplamıdır — matrah/KDV başlıktan; `undefined` = alan yok (eski doküman). */
  ortakAnahtar?: boolean;
  oran: number | null;           // vergiPntr indeksinden; çözülemezse null
  oranKarma: boolean;            // true: faturada birden fazla KDV oranı var (ör. %10 + %20) — oran tek başına yanıltıcı
  yon: 'gelen' | 'giden';        // cha_tip 1=gelen(alış), 0=giden(satış)
  uuid?: string;                 // GİB belge kimliği (e-belge XML/PDF)
  /** 0 = e-Fatura, 1 = e-Arşiv, -1 = bilinmiyor (gelen faturada hep -1) — `cha_ebelge_Islemturu`'ndan; bkz. utils/muhasebe/ebelgeTuru. */
  ebelgeTuru: number;
  /** cha_subeno — şube bazlı P&L eşleşmesi için. **NaN = BİLİNMİYOR** (0 = merkez, meşru değer). */
  subeNo: number;
}

/** fatura-listesi importunun yazdığı matrah kaynağı ('baslik' | 'satir'; null = ikisi de okunamadı). */
export type MatrahKaynagi = 'baslik' | 'satir' | null;

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
  // DAHA ÖNCE import edilmiş dokümanlara `kdvTutari: 0` / `matrah: 0` yazmıştı. fatura-listesi gece
  // penceresi 2026-09-24'ten beri 'tam' (tüm geçmiş her gece yenilenir); o yenilemeye kadar doküman
  // sahte sıfırı taşır ve buradan "bilinen 0" olarak Ba/Bs eşiğine, KDV Analizi'ne ve mizana yayılır.
  //
  // Ayırt edici: `oranSayisi` satır alt sorgusunun COUNT'udur — JOIN tuttuysa EN AZ 1, tutmadıysa
  // NULL/eksik. Satır yoksa matrah başlıktan (`cha_aratoplam` − Σ`cha_ft_iskonto`), KDV `cha_meblag − matrah`.
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
    // Tanınmayan değer kaynak SAYILMAZ (undefined → detay notu eski dala düşer, açıklama uydurmaz).
    matrahKaynagi: x.matrahKaynagi === 'baslik' || x.matrahKaynagi === 'satir' || x.matrahKaynagi === null ? x.matrahKaynagi : undefined,
    ortakAnahtar: bilinenSayi(x.ortakAnahtar) ? Number(x.ortakAnahtar) === 1 : undefined,
    oran:     VERGI_PNTR_ORAN[String(x.vergiPntr ?? '')] ?? null,
    oranKarma: Number(x.oranSayisi ?? 1) > 1,
    uuid:     String(x.cha_uuid ?? x.cha_ettn ?? x.uuid ?? '') || undefined,
    ebelgeTuru: ebelgeTuruCoz(x),
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
 *  HESAPLARA GİRMEYENLER burada, TEK yerde düşer (tüm ekranlar bu kancadan beslenir):
 *    • iptal bayraklı kayıt (savunma — import iptalleri zaten indirmez, süpürgeyle siler);
 *    • ALICININ REDDETTİĞİ satış e-Faturası (`gibRed`, GİB 2002 — lib/gibDurum). Mikro'da iptal bayrağı taşımaz ve import onu
 *      geçerli fatura diye indirir; durum yalnız GİB taramasından bilinir (fatura 389, 2026-10-02). Kullanıcı kararı
 *      (2026-09-25): reddedilen fatura ciro / KDV / mizan / Ba-Bs'ye girmez, yalnız İptal & İade listesinde görünür.
 *  (Eski not "Mikro kayıt silmez" YANLIŞTI: silinen fatura 325 ölçüldü; onu import'un ters süpürgesi kaldırır.) */
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
              return { f: mapMikroFatura(d.id, x), iptal: iptal || gibReddedildi(x) };
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
