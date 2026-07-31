/**
 * mikroEvrak.ts — Cetpa varlıkları → Mikro V17 evrak payload eşleyicileri.
 *
 * Tüm push'lar tek sunucu kapısından geçer: POST /api/mikro/evrak/kaydet
 * (whitelist + audit + syncLog sunucuda). Alan adları apidocs V17
 * koleksiyonundaki örnek gövdelerden alınmıştır; "deneysel" işaretli
 * eşlemeler ilk gerçek kayıtla doğrulanmalıdır.
 */

import { authFetch } from './authFetch';
import { enqueueSyncJob, processPendingSyncJobs, type SyncJob } from './syncRetryService';

export interface MikroPushResult {
  success: boolean;
  error?: string | null;
  notConfigured?: boolean;
  data?: unknown;
}

/** Retry kuyruğunda saklanan Mikro işinin payload yapısı. */
interface MikroJobPayload {
  method: string;
  payload: Record<string, unknown>;
  meta?: { entityType?: string; entityId?: string };
}

const trDate = (iso?: string): string => {
  const s = (iso || new Date().toISOString()).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
};

/** Sunucu kapısına ham push — retry kuyruğuna dokunmaz (executor bunu kullanır). */
async function rawMikroPush(
  method: string,
  payload: Record<string, unknown>,
  meta?: { entityType?: string; entityId?: string }
): Promise<MikroPushResult> {
  const r = await authFetch('/api/mikro/evrak/kaydet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, payload, ...meta }),
  });
  return r.json() as Promise<MikroPushResult>;
}

export async function pushMikroEvrak(
  method: string,
  payload: Record<string, unknown>,
  meta?: { entityType?: string; entityId?: string }
): Promise<MikroPushResult> {
  try {
    return await rawMikroPush(method, payload, meta);
  } catch (err) {
    // Ağ/timeout hatası = geçici → retry kuyruğuna ekle (exponential backoff).
    // Mantıksal hatalar (success:false) kuyruğa girmez; onlar tekrar denense de geçmez.
    const id = `mikro_${method}_${meta?.entityId ?? Date.now()}`;
    const jobPayload: MikroJobPayload = { method, payload, meta };
    void enqueueSyncJob({ id, type: 'mikro', payload: jobPayload, maxAttempts: 5 }).catch(() => {});
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Kuyruktaki bekleyen Mikro işlerini yeniden çalıştırır (app açılışı + periyodik). */
export async function processMikroRetries(): Promise<void> {
  await processPendingSyncJobs(async (job: SyncJob) => {
    if (job.type !== 'mikro') return; // bu işleyici yalnız Mikro işlerini çalıştırır
    const { method, payload, meta } = job.payload as MikroJobPayload;
    const result = await rawMikroPush(method, payload, meta);
    if (!result.success) {
      // notConfigured kalıcı bir durumdur — tekrar denemenin anlamı yok, ölü işaretle
      throw new Error(result.notConfigured ? 'Mikro yapılandırılmamış' : (result.error || 'Mikro push başarısız'));
    }
  });
}

// ── 1. Verilen Teklif (QuotationForm/Detail) ─────────────────────────────────
export function teklifPayload(q: {
  date?: string; cariKod: string; lineItems: { sku?: string; quantity?: number; price?: number; title?: string }[];
  notes?: string; belgeNo?: string;
}) {
  return {
    evraklar: [{
      evrak_aciklamalari: q.notes ? [{ aciklama: q.notes.slice(0, 120) }] : [],
      satirlar: q.lineItems.map(l => ({
        tkl_evrak_tarihi: trDate(q.date),
        tkl_evrakno_seri: 'CTP',
        tkl_belge_no: q.belgeNo ?? '',
        tkl_cari_kod: q.cariKod,
        tkl_harekettipi: 0,
        tkl_stok_kod: l.sku ?? '',
        tkl_Aciklama: (l.title ?? '').slice(0, 50),
        tkl_Alisfiyati: l.price ?? 0, // V17 örneğindeki fiyat alanı (deneysel)
        tkl_baslangic_tarihi: trDate(q.date),
        tkl_miktar: l.quantity ?? 1,
        tkl_birim_pntr: 1,
        tkl_vergi_pntr: 4,
        tkl_cari_tipi: '0',
        tkl_karorani: 0,
        tkl_ProjeKodu: '',
      })),
    }],
  };
}

// ── 2. Sayım Sonuçları (Mobil WMS) ───────────────────────────────────────────
export function sayimPayload(rows: { sku: string; counted: number; depoNo?: number; barkod?: string; date?: string }[]) {
  return {
    evraklar: [{
      satirlar: rows.map(r => ({
        sym_tarihi: trDate(r.date),
        sym_depono: r.depoNo ?? 1,
        sym_Stokkodu: r.sku,
        sym_miktar1: r.counted,
        sym_birim_pntr: 1,
        sym_barkod: r.barkod ?? '',
      })),
    }],
  };
}

// ── 3. Dahili Stok Hareket (inventoryMovements) ──────────────────────────────
export function stokHareketPayload(m: {
  sku: string; quantity: number; type: 'in' | 'out'; date?: string; note?: string; depoNo?: number;
}) {
  return {
    evraklar: [{
      satirlar: [{
        sth_tarih: trDate(m.date),
        sth_tip: m.type === 'in' ? 0 : 1, // 0=giriş 1=çıkış (deneysel)
        sth_cins: 9,
        sth_normal_iade: 0,
        sth_evraktip: 12,
        sth_evrakno_seri: 'CTP',
        sth_stok_kod: m.sku,
        sth_cari_cinsi: 0,
        sth_cari_kodu: '',
        sth_miktar: Math.abs(m.quantity),
        sth_birim_pntr: 1,
        sth_tutar: 0,
        sth_vergi_pntr: 1,
        sth_vergisiz_fl: 1,
        sth_giris_depo_no: m.type === 'in' ? (m.depoNo ?? 1) : 0,
        sth_cikis_depo_no: m.type === 'out' ? (m.depoNo ?? 1) : 0,
      }],
    }],
  };
}

// ── 4. Personel İzin Talebi (İK) ─────────────────────────────────────────────
export function izinTalepPayload(l: {
  persKod: string; startDate: string; days: number; type?: number; reason?: string;
}) {
  return {
    evraklar: [{
      satirlar: [{
        pit_talep_tarihi: trDate(),
        pit_baslangictarih: trDate(l.startDate),
        pit_pers_kod: l.persKod,
        pit_mali_yil: new Date().getFullYear(),
        pit_izin_tipi: l.type ?? 0,
        pit_gun_sayisi: l.days,
        pit_yol_izni: 0,
        pit_amac: (l.reason ?? '').slice(0, 40),
        pit_aciklama1: (l.reason ?? '').slice(0, 120),
        pit_aciklama2: '',
        pit_saat: 0,
      }],
    }],
  };
}

// ── 5. Satın Alma Talebi (PurchasingModule) ──────────────────────────────────
export function satinAlmaTalepPayload(t: {
  sku: string; quantity: number; supplierCode?: string; deliveryDate?: string; requestedBy?: string; belgeNo?: string;
}) {
  return {
    evraklar: [{
      satirlar: [{
        stl_tarihi: trDate(),
        stl_belge_no: t.belgeNo ?? '',
        stl_teslim_tarihi: trDate(t.deliveryDate),
        stl_belge_tarihi: trDate(),
        stl_evrak_seri: 'CTP',
        stl_Stok_kodu: t.sku,
        stl_Satici_Kodu: t.supplierCode ?? '',
        stl_projekodu: '',
        stl_Sor_Merk: '',
        stl_miktari: t.quantity,
        stl_teslim_miktari: 0,
        stl_cagrilabilir_fl: 1,
        stl_talep_eden: (t.requestedBy ?? '').slice(0, 20),
      }],
    }],
  };
}

// ── 6. Depolar Arası Sipariş (Lojistik transfer) ─────────────────────────────
export function depoTransferPayload(t: {
  sku: string; quantity: number; fromDepo: number; toDepo: number; date?: string; note?: string;
}) {
  return {
    evraklar: [{
      satirlar: [{
        ssip_tarih: trDate(t.date),
        ssip_teslim_tarih: trDate(t.date),
        ssip_belge_tarih: trDate(t.date),
        ssip_belgeno: '',
        ssip_evrakno_seri: 'CTP',
        ssip_stok_kod: t.sku,
        ssip_b_fiyat: 0,
        ssip_miktar: t.quantity,
        ssip_tutar: 0,
        ssip_girdepo: t.toDepo,
        ssip_cikdepo: t.fromDepo,
        ssip_aciklama: (t.note ?? '').slice(0, 120),
        ssip_birim_pntr: 1,
      }],
    }],
  };
}

// ── 7. Bakım grubu (BakimModule) ─────────────────────────────────────────────
export function bakimTalepPayload(b: {
  tuketiciKod?: string; stokKod?: string; quantity?: number; note?: string; date?: string; depoNo?: number;
}) {
  return {
    evraklar: [{
      satirlar: [{
        bkmkb_tarihi: trDate(b.date),
        bkmkb_belgeno: '',
        bkmkb_belge_tarihi: trDate(b.date),
        bkmkb_teslim_alinma_tarihi: trDate(b.date),
        bkmkb_teslim_edilme_tarihi: trDate(b.date),
        bkmkb_evrakno_seri: 'CTP',
        bkmkb_tuketici_kodu: b.tuketiciKod ?? '',
        bkmkb_teslim_edilme_sekli: 0,
        bkmkb_depono: b.depoNo ?? 1,
        bkmkb_aciklama: (b.note ?? '').slice(0, 120),
        bkmkb_hareket_tipi: 0,
        bkmkb_stok_hizmet_kodu: b.stokKod ?? '',
        bkmkb_miktari: b.quantity ?? 1,
        bkmkb_servis_turu: 0,
        bkmkb_servis_yeri: 0,
        bkmkb_talep_gelis_sekli: 0,
      }],
    }],
  };
}

export function bakimSarfiyatPayload(s: { isEmri: string; sku: string; quantity: number; note?: string; date?: string }) {
  return {
    evraklar: [{
      satirlar: [{
        bsrf_evraktarihi: trDate(s.date),
        bsrf_belgeno: '',
        bsrf_evrakseri: 'CTP',
        bsrf_isemri: s.isEmri,
        bsrf_StokKodu: s.sku,
        bsrf_Miktar: s.quantity,
        bsrf_aciklama: (s.note ?? '').slice(0, 120),
        bsrf_proje: '', bsrf_srmmrkkodu: '',
      }],
    }],
  };
}

// ── 8. Servis grubu (ServisModule) ───────────────────────────────────────────
export function servisIsEmriPayload(s: {
  kod: string; ad: string; cariKod?: string; cihazSeriNo?: string; stokKod?: string; yetkili?: string; aciklama?: string; date?: string;
}) {
  return {
    isemirleri: [{
      sis_kodu: s.kod.slice(0, 25),
      sis_adi: s.ad.slice(0, 40),
      sis_tarih: trDate(s.date),
      sis_tuketici_kodu: s.cariKod ?? '',
      sis_cihaz_serino: s.cihazSeriNo ?? '',
      sis_stok_kodu: s.stokKod ?? '',
      sis_yetkili: (s.yetkili ?? '').slice(0, 25),
      sis_servis_yeri: 0,
      sis_servis_turu: 0,
      sis_istek_gelis_sekli: 0,
      ACIKLAMA: (s.aciklama ?? '').slice(0, 250),
    }],
  };
}

export function servisMalzemePayload(m: { isEmriKod: string; sku: string; quantity: number; depoNo?: number; note?: string; date?: string }) {
  return {
    evraklar: [{
      satirlar: [{
        smpl_har_tarihi: trDate(m.date),
        smpl_isemri_kodu: m.isEmriKod,
        smpl_malzeme_kodu: m.sku,
        smpl_miktar: m.quantity,
        smpl_tutar: 0,
        smpl_aciklama: (m.note ?? '').slice(0, 120),
        smpl_depono: m.depoNo ?? 1,
        smpl_garanti_dahili_fl: 0,
        smpl_onaylandi_fl: 1,
      }],
    }],
  };
}

// ── 9. Üretim grubu (ProductionModule + MRP) ─────────────────────────────────
export function uretimTalepPayload(u: { sku: string; quantity: number; deliveryDate?: string; depoNo?: number; belgeNo?: string }) {
  return {
    evraklar: [{
      satirlar: [{
        utl_tarihi: trDate(),
        utl_teslim_tarihi: trDate(u.deliveryDate),
        utl_evrak_seri: 'CTP',
        utl_belge_no: u.belgeNo ?? '',
        utl_belge_tarihi: trDate(),
        utl_Sor_Merk: '',
        utl_Stok_kodu: u.sku,
        utl_miktari: u.quantity,
        utl_depo_no: u.depoNo ?? 1,
        utl_projekodu: '',
      }],
    }],
  };
}

export function uretimIsEmriPayload(u: { sku: string; quantity: number }) {
  return { Satirlar: [{ UrunKodu: u.sku, UretilecekMiktar: u.quantity }] };
}

export function recetePayload(r: {
  anaKod: string; anaMiktar: number; bilesenler: { sku: string; miktar: number }[];
}) {
  // Her bileşen ayrı reçete satırı evrakı olarak gönderilir (deneysel)
  return {
    evraklar: r.bilesenler.map(b => ({
      satirlar: [{
        rec_anatipi: 0,
        rec_anakod: r.anaKod,
        rec_cinsi: 0,
        rec_anabirim: 1,
        rec_anamiktar: r.anaMiktar,
        rec_tuketim_tur: 0,
        rec_tuketim_kod: b.sku,
        rec_tuketim_recete_cinsi: 0,
        rec_tuketim_miktar: b.miktar,
        rec_tuketim_birim: 1,
      }],
    })),
  };
}

// ── 10. Etiket Basım (LabelSheetModal) ───────────────────────────────────────
export function etiketPayload(items: { sku: string; adet: number }[], depoNo = 1) {
  return {
    evraklar: [{
      satirlar: items.map(i => ({
        Etkb_evrakno_seri: 'CTP',
        Etkb_evrak_tarihi: trDate(),
        Etkb_aciklama: 'Cetpa etiket basımı',
        Etkb_belge_no: '',
        Etkb_belge_tarih: trDate(),
        Etkb_EtiketTip: 0,
        Etkb_BasimTipi: 0,
        Etkb_BasimAdet: i.adet,
        Etkb_DepoNo: depoNo,
        Etkb_StokKodu: i.sku,
        Etkb_BasilacakMiktar: i.adet,
      })),
    }],
  };
}

// ── 11. Ziyaret (CRM saha ziyareti) ──────────────────────────────────────────
export function ziyaretPayload(z: {
  cariKod: string; basZamani: string; bitZamani?: string; personelKod?: string; kod?: string;
}) {
  return {
    ziyaretler: [{
      zyrt_bas_zamani: z.basZamani,
      zyrt_bit_zamani: z.bitZamani ?? z.basZamani,
      zyrt_CariKodu: z.cariKod,
      zyrt_PersonelKodu: z.personelKod ?? '',
      zyrt_kodu: (z.kod ?? `CTP-${z.cariKod}`).slice(0, 24),
      zyrt_Sor_MrkKodu: '',
    }],
  };
}

// ── 12. Dekont (Muhasebe) ────────────────────────────────────────────────────
/** DekontKaydetV2 gövdesi.
 *
 *  `evrakTip`/`seri` ARTIK PARAMETRE: eskiden `cha_evrak_tip: 29` ve seri 'CTP'
 *  gömülüydü ve yorumunda "deneysel" yazıyordu — yani tahmindi. Artık çağıran,
 *  firmanın GERÇEKTEN kullandığı türlerden seçiyor
 *  (GET /api/mikro/cari-hareket/turler, CARI_HESAP_HAREKETLERI'nden okunur).
 *  Verilmezse eski değerler korunur ki mevcut çağıranlar kırılmasın.
 */
export function dekontPayload(d: {
  cariKod: string; tutar: number; tip: 'borc' | 'alacak'; date?: string; aciklama?: string;
  evrakTip?: number; seri?: string;
}) {
  return {
    evraklar: [{
      evrak_aciklamalari: d.aciklama ? [{ aciklama: d.aciklama.slice(0, 120) }] : [],
      satirlar: [{
        cha_tarihi: trDate(d.date),
        cha_tip: d.tip === 'borc' ? 0 : 1,
        cha_normal_Iade: 0,
        cha_evrak_tip: d.evrakTip ?? 29,
        cha_evrakno_seri: d.seri ?? 'CTP',
        cha_cari_cins: 0,
        cha_kod: d.cariKod,
        cha_d_kurtar: null, cha_d_cins: 0, cha_d_kur: 1,
        cha_srmrkkodu: '', cha_projekodu: '',
        cha_kasa_hizmet: 0, cha_kasa_hizkod: '',
        cha_meblag: d.tutar,
      }],
    }],
  };
}
