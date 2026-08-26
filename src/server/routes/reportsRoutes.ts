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
import type { AdminDbLike } from '../adminDbTypes.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface ReportsRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  getUserCompanyId: (uid: string) => Promise<string>;
  /** Kiraci filtresini SQL'e iten yardimci - tum-koleksiyon taramasi yapmaz. */
  loadCompanyDocs: (coll: string, cid: string, daralt?: any) => Promise<Array<Record<string, unknown>>>;
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
  // Mikro'da hazır bir rapor değil — STOK_HAREKETLERI satır bazlı hareketleri
  // (sth_stok_kod/sth_miktar/sth_tutar/sth_tip) zaten inventoryMovements'a
  // çekiliyor (/api/mikro/import/stok-hareket). Burada SKU+yön bazında
  // ağırlıklı ortalama fiyat (SUM(tutar)/SUM(miktar)) hesaplanır — InventoryView.tsx'in
  // kanıtlı normalize deseniyle aynı formül (birimFiyat = tutar/miktar, KDV hariç,
  // sth_tip 0=giriş/alış 1=çıkış/satış). Native (Cetpa) hareketlerde fiyat alanı
  // hiç yok (InventoryMovement tipi) — yalnız Mikro satırları (sth_stok_kod dolu
  // olanlar) hesaba katılır, bu bir eksiklik değil.
  app.get('/api/reports/stok-fiyat-karsilastirma', C.requireAuth, async (req: Request, res: Response) => {
    try {
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const [movements, inventory] = await Promise.all([
        C.loadCompanyDocs('inventoryMovements', cid),
        C.loadCompanyDocs('inventory', cid),
      ]);
      const adMap = new Map<string, string>();
      const stokMap = new Map<string, number>();
      for (const it of inventory) {
        const rec = it as Record<string, unknown>;
        const sku = String(rec.sku ?? '').trim();
        if (!sku) continue;
        adMap.set(sku, String(rec.name ?? sku));
        // Kalan stok — hareket bazlı alış-satış netine DEĞİL, inventory.stockLevel'a
        // (gerçek/güncel stok) dayanır: hareket penceresi tüm geçmişi kapsamayabilir
        // (açılış bakiyesi, transfer, sayım farkı gibi alış/satış dışı hareketler),
        // stockLevel Mikro gece senkronundan gelen otoriter değer (2026-08-13).
        stokMap.set(sku, Number(rec.stockLevel ?? 0));
      }

      type Grup = { alisTutar: number; alisMiktar: number; alisAdet: number; satisTutar: number; satisMiktar: number; satisAdet: number };
      const gruplar = new Map<string, Grup>();
      for (const m of movements) {
        const sku = String(m.sth_stok_kod ?? '').trim();
        if (!sku) continue; // native (Cetpa) hareketi — fiyat alanı yok, atla
        const iptal = m.sth_iptal === true || Number(m.sth_iptal ?? 0) === 1;
        if (iptal) continue;
        const miktar = Math.abs(Number(m.sth_miktar) || 0);
        const tutar = Math.abs(Number(m.sth_tutar) || 0);
        if (miktar <= 0) continue;
        const g = gruplar.get(sku) ?? { alisTutar: 0, alisMiktar: 0, alisAdet: 0, satisTutar: 0, satisMiktar: 0, satisAdet: 0 };
        if (Number(m.sth_tip) === 0) { g.alisTutar += tutar; g.alisMiktar += miktar; g.alisAdet++; }
        else                         { g.satisTutar += tutar; g.satisMiktar += miktar; g.satisAdet++; }
        gruplar.set(sku, g);
      }

      const rows = [...gruplar.entries()].map(([sku, g]) => {
        const alisOrt  = g.alisMiktar  > 0 ? g.alisTutar  / g.alisMiktar  : null;
        const satisOrt = g.satisMiktar > 0 ? g.satisTutar / g.satisMiktar : null;
        const marj = alisOrt != null && satisOrt != null ? satisOrt - alisOrt : null;
        const marjYuzde = marj != null && alisOrt ? (marj / alisOrt) * 100 : null;
        return {
          sku, ad: adMap.get(sku) ?? sku,
          alisOrtFiyat: alisOrt, alisMiktar: g.alisMiktar, alisTutar: g.alisTutar, alisAdet: g.alisAdet,
          satisOrtFiyat: satisOrt, satisMiktar: g.satisMiktar, satisTutar: g.satisTutar, satisAdet: g.satisAdet,
          marjTL: marj, marjYuzde,
          kalanStok: stokMap.has(sku) ? stokMap.get(sku)! : null,
        };
      }).sort((a, b) => (b.alisTutar + b.satisTutar) - (a.alisTutar + a.satisTutar));

      res.json({ success: true, rows, toplamSku: rows.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // GET /api/reports/stok-fiyat-karsilastirma/:sku/detay — bir SKU'nun tüm alım/satım satırları
  app.get('/api/reports/stok-fiyat-karsilastirma/:sku/detay', C.requireAuth, async (req: Request, res: Response) => {
    try {
      const sku = String(req.params['sku'] || '').trim();
      if (!sku) return res.status(400).json({ success: false, error: 'sku gerekli.' });
      const cid = await C.getUserCompanyId((req as Request & { uid?: string }).uid || '');
      const movements = await C.loadCompanyDocs('inventoryMovements', cid);
      const satirlar = movements
        .filter(m => String(m.sth_stok_kod ?? '').trim() === sku)
        .filter(m => !(m.sth_iptal === true || Number(m.sth_iptal ?? 0) === 1))
        .map(m => {
          const miktar = Math.abs(Number(m.sth_miktar) || 0);
          const tutar = Math.abs(Number(m.sth_tutar) || 0);
          return {
            tarih: m.sth_tarih ?? null,
            yon: Number(m.sth_tip) === 0 ? 'alis' as const : 'satis' as const,
            miktar, tutar,
            birimFiyat: miktar > 0 ? tutar / miktar : 0,
            cariKod: m.sth_cari_kodu ?? m.sth_cari_kod ?? null,
            evrakNo: [m.sth_evrakno_seri, m.sth_evrakno_sira].filter(v => v !== '' && v != null).join('-') || null,
          };
        })
        .sort((a, b) => String(b.tarih ?? '').localeCompare(String(a.tarih ?? '')));
      res.json({ success: true, sku, satirlar, toplam: satirlar.length });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
