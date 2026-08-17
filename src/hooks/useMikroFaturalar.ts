import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from '../lib/dbClient';
import { db } from '../firebase';

/** Mikro faturası — istemci tarafı normalize edilmiş şekil.
 *  KAYNAK: `mikroFaturalar` koleksiyonu (server: /api/mikro/import/fatura-listesi).
 *  Ham `cha_*` alanları burada TEK yerde eşlenir — AccountingModule, MuhasebePage
 *  ve RaporlarPage aynı eşlemeyi kopyalıyordu (code-review reuse bulgusu). */
export interface MikroFatura {
  id: string;
  cariKod: string;
  tarih: string;                 // 'YYYY-MM-DD'
  tutar: number;
  faturaNo: string;
  kdv: number;                   // fatura satırlarından JOIN'li (başlıkta yok)
  matrah: number;
  oran: number | null;           // vergiPntr indeksinden; çözülemezse null
  oranKarma: boolean;            // true: faturada birden fazla KDV oranı var (ör. %10 + %20) — oran tek başına yanıltıcı
  yon: 'gelen' | 'giden';        // cha_tip 1=gelen(alış), 0=giden(satış)
  uuid?: string;                 // GİB belge kimliği (e-belge XML/PDF)
  ebelgeTuru: number;            // 0=e-Fatura, 1=e-Arşiv, 2=e-İrsaliye; -1=bilinmiyor
  subeNo: number;                // cha_subeno — şube bazlı P&L eşleşmesi için
}

export const VERGI_PNTR_ORAN: Record<string, number> = { '1': 0, '2': 1, '3': 10, '4': 20 };

/** Ham mikroFaturalar dokümanını normalize et (iptal edilmişler çıkarılır). */
export function mapMikroFatura(id: string, x: Record<string, unknown>): MikroFatura {
  const seri = String(x.cha_evrakno_seri ?? '').trim();
  const sira = x.cha_evrakno_sira;
  return {
    id,
    cariKod:  String(x.cha_kod ?? '').trim(),
    tarih:    String(x.cha_tarihi ?? '').slice(0, 10),
    tutar:    Number(x.cha_meblag ?? 0) || 0,
    faturaNo: [seri, sira].filter(v => v !== '' && v != null).join('-'),
    kdv:      Number(x.kdvTutari ?? 0) || 0,
    matrah:   Number(x.matrah ?? 0) || 0,
    oran:     VERGI_PNTR_ORAN[String(x.vergiPntr ?? '')] ?? null,
    oranKarma: Number(x.oranSayisi ?? 1) > 1,
    uuid:     String(x.cha_uuid ?? x.cha_ettn ?? x.uuid ?? '') || undefined,
    ebelgeTuru: Number(x.cha_ebelge_turu ?? -1),
    yon:      Number(x.cha_tip ?? 0) === 1 ? 'gelen' : 'giden',
    subeNo:   Number(x.cha_subeno ?? 0) || 0,
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
