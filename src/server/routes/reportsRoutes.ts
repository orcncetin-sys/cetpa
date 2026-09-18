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
import type { Express, Request, Response } from 'express';
import type { AdminDbLike, DocDaralt } from '../adminDbTypes.js';
import { stokFiyatOzeti, stokFiyatDetay, faturaToplamlari } from '../../lib/stokFiyat.js';
import { bilinenSayi } from '../../utils/para.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface ReportsRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  getUserCompanyId: (uid: string) => Promise<string>;
  /** Kiraci filtresini SQL'e iten yardimci - tum-koleksiyon taramasi yapmaz. */
  loadCompanyDocs: (coll: string, cid: string, daralt?: DocDaralt) => Promise<Array<Record<string, unknown>>>;
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

      const thisOrders = orders.filter(o => dateOf(o) >= d30 && dateOf(o) <= now);
      const prevOrders = orders.filter(o => dateOf(o) >= d60 && dateOf(o) < d30);

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

      const ozet = stokFiyatOzeti(movements, { faturaToplamlari: faturaToplamlari(basliklar) });
      const rows = ozet.satirlar.map(r => ({ ...r, ad: adMap.get(r.sku) ?? r.sku, kalanStok: stokMap.get(r.sku) ?? null }));
      // iskontoKolonlari: aynada GERÇEKTEN bulunan sth_iskonto<N> kolonları — boşsa ekran "iskonto kolonu yok" der.
      res.json({ success: true, rows, toplamSku: rows.length, iskontoKolonlari: ozet.iskontoKolonlari, netKaynaklari: ozet.netKaynaklari });
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
