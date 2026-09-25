/**
 * reportsRoutes.ts - Sunucu tarafi RAPOR uclari (3 rota): ozet KPI'lar ve stok/fiyat
 * karsilastirmasi.

 * Bu uclar `loadCompanyDocs` ile kiraci filtresini SQL'e iter — eskiden
 * TUM koleksiyonu bellege cekip JS'te eliyorlardi (2026-07 P8/P9 bulgusu).
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen:
 * bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL - server.ts bu
 * modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response, RequestHandler } from 'express';
import type { AdminDbLike, DocDaralt } from '../adminDbTypes.js';
import { stokFiyatOzeti, stokFiyatDetay, faturaToplamlari, birimSapmalari, netCozumleri } from '../../lib/stokFiyat.js';
import { bilinenSayi } from '../../utils/para.js';
import { cariBakiyeToplamlari } from '../../utils/muhasebe/finansalOranlar.js';
import { zamanMs } from '../../utils/zaman.js';
import { siparisIptalMi } from '../../utils/siparis.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface ReportsRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  getUserCompanyId: (uid: string) => Promise<string>;
  /** Kiraci filtresini SQL'e iten yardimci - tum-koleksiyon taramasi yapmaz. */
  loadCompanyDocs: (coll: string, cid: string, daralt?: DocDaralt) => Promise<Array<Record<string, unknown>>>;
  /** RBAC koleksiyon kapısı (server.ts) — rapor ucu kaynak koleksiyonun okuma rolleriyle sınırlanır. */
  requireCollectionAccess: (coll: string, op: 'read') => RequestHandler;
}

export function reportsRoutes(app: Express, C: ReportsRouteCtx): void {
  // ── Reports Summary API ────────────────────────────────────────────────────
  // GET /api/reports/summary — aggregated KPIs for the last 30 days vs prior 30 days
  app.get('/api/reports/summary', C.requireAuth, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    try {
      const now       = new Date();
      const d30       = new Date(now); d30.setDate(d30.getDate() - 30);
      const d60       = new Date(now); d60.setDate(d60.getDate() - 60);

      // Kiracı izolasyonu + P8/P9: filtre PG'de, tüm koleksiyon belleğe çekilmez.
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const [orders, leads, inventory] = await Promise.all([
        C.loadCompanyDocs('orders', cid),
        C.loadCompanyDocs('leads', cid),
        C.loadCompanyDocs('inventory', cid),
      ]);

      function dateOf(o: Record<string, unknown>): Date {
        const raw = o.createdAt as { toDate?: () => Date } | string | null;
        if (!raw) return new Date(0);
        if (typeof raw === 'string') return new Date(raw);
        return raw.toDate?.() ?? new Date(0);
      }

      // İPTAL HARİÇ (K2; inceleme 2026-09-25): Mikro'da faturası iptal edilen MF siparişi artık 'Cancelled' — özet onu
      // sipariş sayısına ve ciroya katıyordu. İptal edilen sipariş satış değildir.
      const iptalsiz = orders.filter(o => !siparisIptalMi(o));
      const thisOrders = iptalsiz.filter(o => dateOf(o) >= d30 && dateOf(o) <= now);
      const prevOrders = iptalsiz.filter(o => dateOf(o) >= d60 && dateOf(o) < d30);

      const revenue = (arr: typeof orders) => arr.reduce((s, o) => s + ((o.totalPrice as number) || 0), 0);
      const thisRevenue = revenue(thisOrders);
      const prevRevenue = revenue(prevOrders);

      const lowStock = inventory.filter(i => ((i.stockLevel as number) || 0) <= ((i.lowStockThreshold as number) || 5));

      res.json({
        period: { start: d30.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) },
        orders:     { count: thisOrders.length, prevCount: prevOrders.length, delta: thisOrders.length - prevOrders.length },
        revenue:    { total: thisRevenue, prev: prevRevenue, delta: thisRevenue - prevRevenue },
        leads:      { total: leads.length, new30: leads.filter(l => dateOf(l) >= d30).length },
        inventory:  { total: inventory.length, lowStock: lowStock.length },
        delivered:  thisOrders.filter(o => o.status === 'Delivered').length,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Stok Fiyat Karşılaştırma (alım vs satım ortalama fiyat) ────────────────
  // Mikro'da hazır bir rapor değil — STOK_HAREKETLERI satır bazlı hareketleri zaten inventoryMovements'a
  // çekiliyor (/api/mikro/import/stok-hareket, SELECT * → tüm sth_ kolonları). Burada SKU+yön bazında
  // NET ağırlıklı ortalama fiyat hesaplanır: Σ(sth_tutar − Σ sth_iskonto<N>) / Σ miktar, KDV hariç,
  // sth_tip 0=giriş/alış, diğerleri çıkış/satış. HESAP TEK KAYNAKTA: src/lib/stokFiyat.ts (testli).
  // 2026-09-18 kullanıcı bildirimi: brüt sth_tutar kullanılıyordu — satır ve fatura altı iskontoları hiç
  // düşülmüyor, iskontolu alımda ortalama alış fiyatı olduğundan yüksek çıkıyordu; ayrıca `|| 0` tutarı
  // bilinmeyen satırı ₺0 tutar + gerçek miktarla ortalamaya sokuyordu. Native (Cetpa) hareketlerde fiyat
  // alanı hiç yok (InventoryMovement tipi) — yalnız Mikro satırları (sth_stok_kod dolu) hesaba katılır.
  app.get('/api/reports/stok-fiyat-karsilastirma', C.requireAuth, async (req: Request, res: Response) => {
    try {
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      // mikroFaturalar: fatura BAŞLIKLARI (cha_meblag) — satırdan ayırt edilemeyen iskonto durumlarında hakem (lib/stokFiyat).
      const [movements, inventory, basliklar] = await Promise.all([
        C.loadCompanyDocs('inventoryMovements', cid),
        C.loadCompanyDocs('inventory', cid),
        C.loadCompanyDocs('mikroFaturalar', cid),
      ]);
      const adMap = new Map<string, string>();
      const stokMap = new Map<string, number | null>();
      for (const it of inventory) {
        const rec = it as Record<string, unknown>;
        const sku = String(rec.sku ?? '').trim();
        if (!sku) continue;
        adMap.set(sku, String(rec.name ?? sku));
        // Kalan stok — hareket bazlı alış-satış netine DEĞİL, inventory.stockLevel'a
        // (gerçek/güncel stok) dayanır: hareket penceresi tüm geçmişi kapsamayabilir
        // (açılış bakiyesi, transfer, sayım farkı gibi alış/satış dışı hareketler),
        // stockLevel Mikro gece senkronundan gelen otoriter değer (2026-08-13).
        // stockLevel yoksa 0 DEĞİL bilinmiyor (null → ekran '—'; eski `?? 0` "stok bitti" kırmızısı basıyordu).
        stokMap.set(sku, bilinenSayi(rec.stockLevel) ? Number(rec.stockLevel) : null);
      }

      const secenek = { faturaToplamlari: faturaToplamlari(basliklar) };
      const cozum = netCozumleri(movements, secenek);          // tek tarama — özet ve sapma aynı çözümü paylaşır
      const ozet = stokFiyatOzeti(movements, secenek, cozum);
      // Birim sapması (koli/adet karışıklığı — lib/stokFiyat.birimSapmalari, 2026-09-25 kullanıcı isteği: "bu tip fark
      // olanları listelemem gerekli"): liste + ürün başına sayı. Ortalama bu satırları İÇERİR (sessizce ayıklanmaz);
      // ekran rozetle uyarır, düzeltme Mikro'da.
      const sapma = birimSapmalari(movements, secenek, cozum);
      const sapmalar = sapma.satirlar.map(s => ({ ...s, ad: adMap.get(s.sku) ?? s.sku }));
      // Sayaç: DEĞERLENDİRİLEN üründe listede yoksa şüpheli satırı gerçekten yoktur → 0; değerlendirilemeyen
      // üründe (< 3 fiyatı bilinen satır) BİLİNMİYOR → null (ekran '0 şüpheli' demez — inceleme 2026-09-25).
      const sapmaSayisi = new Map<string, number>();
      for (const s of sapmalar) { const n = sapmaSayisi.get(s.sku); sapmaSayisi.set(s.sku, n === undefined ? 1 : n + 1); }
      const rows = ozet.satirlar.map(r => {
        const n = sapmaSayisi.get(r.sku);
        const sayi = !sapma.degerlendirilen.has(r.sku) ? null : n === undefined ? 0 : n;
        return { ...r, ad: adMap.get(r.sku) ?? r.sku, kalanStok: stokMap.get(r.sku) ?? null, sapmaSayisi: sayi };
      });
      // iskontoKolonlari: aynada GERÇEKTEN bulunan sth_iskonto<N> kolonları — boşsa ekran "iskonto kolonu yok" der.
      res.json({ success: true, rows, toplamSku: rows.length, iskontoKolonlari: ozet.iskontoKolonlari, netKaynaklari: ozet.netKaynaklari, sapmalar });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // GET /api/reports/mikro-cari-alacak — Mikro cari bakiyelerinden ALACAK toplamı (2026-09-25 kullanıcı bildirimi:
  // Siparişler "Alacak Toplam" kartı, tüm siparişler Mikro kaynaklıyken '—' basıyordu). Kaynak ve küme Muhasebe ile
  // BİREBİR (MuhasebePage `cariBalances` + finansalOranlar.cariBakiyeToplamlari): /api/mikro/pull/bakiye'nin yazdığı,
  // lead'e bağlı carilerin bakiyesi — iki ekran aynı rakamı basar. Ham hareket aynası KULLANILMAZ: orada cari türü
  // kolonu yok, kasa/banka kodları da toplanırdı (inceleme 2026-09-25). Rol kapısı `cariBalances` okuma rolleri
  // (Admin/Manager/Accounting/Sales) — B2B/bayi gibi dış roller Cetpa'nın alacak toplamını OKUYAMAZ. Yalnız alacak
  // döner (borç ve cari dökümü değil). Veri yoksa `veriYok`; hiçbir bakiye okunamadıysa `alacak: null` — ₺0 DEĞİL.
  app.get('/api/reports/mikro-cari-alacak', C.requireAuth, C.requireCollectionAccess('cariBalances', 'read'), async (req: Request, res: Response) => {
    try {
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const docs = await C.loadCompanyDocs('cariBalances', cid);
      if (docs.length === 0) return res.json({ success: true, veriYok: true, alacak: null, cariSayisi: 0, bilinmeyenCari: 0, guncellemeMs: null });
      const t = cariBakiyeToplamlari(docs.map(d => d.bakiye));
      let guncellemeMs: number | null = null;
      for (const d of docs) { const ms = zamanMs(d.updatedAt); if (ms !== null && (guncellemeMs === null || ms > guncellemeMs)) guncellemeMs = ms; }
      res.json({ success: true, veriYok: false, alacak: t.bilinen > 0 ? t.ar : null, cariSayisi: t.bilinen, bilinmeyenCari: t.bilinmeyen, guncellemeMs });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // GET /api/reports/stok-fiyat-karsilastirma/:sku/detay — bir SKU'nun tüm alım/satım satırları
  // (brüt, iskonto, NET tutar ve net birim fiyat — src/lib/stokFiyat.ts stokFiyatDetay)
  app.get('/api/reports/stok-fiyat-karsilastirma/:sku/detay', C.requireAuth, async (req: Request, res: Response) => {
    try {
      const sku = String(req.params['sku'] || '').trim();
      if (!sku) return res.status(400).json({ success: false, error: 'sku gerekli.' });
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const [movements, basliklar] = await Promise.all([
        C.loadCompanyDocs('inventoryMovements', cid),
        C.loadCompanyDocs('mikroFaturalar', cid),
      ]);
      const satirlar = stokFiyatDetay(movements, sku, { faturaToplamlari: faturaToplamlari(basliklar) });
      res.json({ success: true, sku, satirlar, toplam: satirlar.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
