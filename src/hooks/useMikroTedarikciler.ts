import { useMemo } from 'react';
import type { Lead, Supplier } from '../types';
import type { MikroFatura } from './useMikroFaturalar';

/** Mikro'dan bilinen ama `suppliers` koleksiyonuna hiç elle girilmemiş
 *  tedarikçileri türetir — İKİ kaynaktan: `leads` içinde type==='Supplier'
 *  işaretli kayıtlar, ve alış faturası (mikroFaturalar yon='gelen') olan
 *  ama Supplier tipinde etiketlenmemiş cariler (aynı "tek cari havuzu"
 *  mantığı — bkz. AccountingModule.tsx Tedarikçiler sekmesi, 2026-08-01
 *  kullanıcı kararı: Mikro'da tek CARI_HESAPLAR var, rol faturadan türer).
 *
 *  AccountingModule.tsx'te aynı mantık zaten vardı (mikroSuppliers +
 *  mikroTedarikcileri) ama tek dosyaya gömülüydü — Satın Alma → Tedarikçi
 *  Rehberi aynı boşluğu taşıyordu (2026-08-17 kullanıcı bildirimi: "mikro
 *  bağlı değil, tedarikçiler aslında belli"). Tek yerden türetilsin diye
 *  buraya çıkarıldı; yeni tüketiciler (bu hook'u çağıran ekranlar) mantığı
 *  kopyalamak zorunda kalmasın.
 *
 *  `nativeSuppliers` verilirse ad/vergi no eşleşenler süzülür (dedup) —
 *  elle girilmiş kayıt varsa Mikro kopyası eklenmez. */
export function useMikroTedarikciler(
  leads: Lead[],
  mikroFaturalar: MikroFatura[],
  nativeSuppliers: Supplier[] = [],
): Supplier[] {
  return useMemo(() => {
    const alisCariKodSet = new Set(
      mikroFaturalar.filter(f => f.yon === 'gelen').map(f => f.cariKod).filter(Boolean),
    );

    // Cari kod → son fatura tarihi (her iki yön) — kartlardaki "Son işlem"
    // (2026-08-31 kullanıcı isteği). Tarihler ISO (YYYY-MM-DD), string karşılaştırma doğru.
    const sonIslemMap = new Map<string, string>();
    for (const f of mikroFaturalar) {
      if (!f.cariKod || !f.tarih) continue;
      const eski = sonIslemMap.get(f.cariKod);
      if (!eski || f.tarih > eski) sonIslemMap.set(f.cariKod, f.tarih);
    }
    // Sahte kesinlik gösterme: bakiye alanı YOKSA 0 değil, BİLİNMİYOR (undefined).
    const bakiyeOku = (x: Record<string, unknown>): number | undefined => {
      const ham = x.bakiye ?? x.balance;
      return ham === undefined || ham === null ? undefined : Number(ham);
    };

    const mikroSuppliers: Supplier[] = leads
      .filter(l => (l as unknown as { type?: string }).type === 'Supplier')
      .map(l => {
        const x = l as unknown as Record<string, unknown>;
        return {
          id: l.id,
          name: l.name || l.company || '—',
          company: l.company || '',
          email: l.email || '',
          phone: l.phone || '',
          address: l.address || '',
          taxNo: l.taxId || (x.taxNo as string) || '',
          taxOffice: l.taxOffice || '',
          notes: l.notes || '',
          balance: bakiyeOku(x),
          riskGroup: (x.riskGroup as Supplier['riskGroup']) || 'Düşük',
          createdAt: l.createdAt,
          // Ekstre + son işlem bu koda bağlı — 2. dalla aynı çözümleme (2026-08-31).
          mikroCariKod: ((l as unknown as { mikroCariKod?: string }).mikroCariKod || l.cariKod || l.taxId || '') || undefined,
          sonIslem: sonIslemMap.get((l as unknown as { mikroCariKod?: string }).mikroCariKod || l.cariKod || l.taxId || ''),
        } as Supplier;
      });

    const mikroTedarikcileri: Supplier[] = leads
      .filter(l => (l as unknown as { type?: string }).type !== 'Supplier')
      .filter(l => {
        const kod = (l as unknown as { mikroCariKod?: string }).mikroCariKod || l.cariKod || l.taxId;
        return !!kod && alisCariKodSet.has(kod);
      })
      .map(l => {
        const x = l as unknown as Record<string, unknown>;
        return {
          id: l.id,
          name: l.name || l.company || '—',
          company: l.company || '',
          email: l.email || '',
          phone: l.phone || '',
          address: l.address || '',
          taxNo: l.taxId || '',
          balance: bakiyeOku(x),
          riskGroup: (x.riskGroup as Supplier['riskGroup']) || 'Düşük',
          // Karttan cari ekstre açılabilsin diye (2026-08-28 kullanıcı isteği).
          mikroCariKod: ((l as unknown as { mikroCariKod?: string }).mikroCariKod || l.cariKod || l.taxId || '') || undefined,
          sonIslem: sonIslemMap.get((l as unknown as { mikroCariKod?: string }).mikroCariKod || l.cariKod || l.taxId || ''),
        } as Supplier;
      });

    const birlesik = [
      ...mikroSuppliers,
      ...mikroTedarikcileri.filter(m => !mikroSuppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo))),
    ];
    return birlesik.filter(m => !nativeSuppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo)));
  }, [leads, mikroFaturalar, nativeSuppliers]);
}
