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
          balance: Number(x.bakiye ?? x.balance ?? 0),
          riskGroup: (x.riskGroup as Supplier['riskGroup']) || 'Düşük',
          createdAt: l.createdAt,
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
          balance: Number(x.bakiye ?? x.balance ?? 0),
          riskGroup: (x.riskGroup as Supplier['riskGroup']) || 'Düşük',
        } as Supplier;
      });

    const birlesik = [
      ...mikroSuppliers,
      ...mikroTedarikcileri.filter(m => !mikroSuppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo))),
    ];
    return birlesik.filter(m => !nativeSuppliers.some(s => s.name === m.name || (!!s.taxNo && s.taxNo === m.taxNo)));
  }, [leads, mikroFaturalar, nativeSuppliers]);
}
