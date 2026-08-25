/**
 * opsRoutes.ts - Operasyon bekcisi uclari (6 rota): son 14 gunun kontrol sonuclari, elle
 * tetikleme, disk sondasi, modul/calisma-zamani durumu.
 *
 * `runOpsWatchdog` ve `diskNobetcisi` BAGLAMDAN DEGIL IMPORT ile geliyor:
 * ikisi de src/server/opsWatchdog.ts'te ve o modul server.ts'i import
 * ETMEDIGI icin dongu olusmuyor. Baglam yalnizca server.ts'te KALAN
 * seyler icin.
 *
 * server.ts'ten AYRILDI (2026-08-25) - D4 adim 10. Onceki rota gruplariyla
 * AYNI desen: bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL -
 * server.ts bu modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import { runOpsWatchdog, diskNobetcisi } from '../opsWatchdog.js';
import { MIKRO_API_BASE, MIKRO_JUMP_SURUM, MIKRO_LOCAL_MODE } from '../mikroClient.js';
import path from 'path';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface OpsRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  requireMfaVerified: any;
  requireSuperAdmin: any;
}

export function opsRoutes(app: Express, C: OpsRouteCtx): void {
  /** Operasyon bekçisi: GET son 14 günün sonuçları, POST elle çalıştır.
   *  Süper-admin panelindeki OpsWatchdogCard kullanır; cron her sabah 08:30. */
  app.get('/api/ops/watchdog', C.requireAuth, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.json({ success: true, results: [] });
    try {
      const snap = await C.getAdminDb().collection('opsChecks').get();
      const results = snap.docs
        .map(d => d.data() as Record<string, unknown>)
        .filter(r => r.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 14);
      res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  /** GET /api/ops/summary — SALT-OKUNUR ops özeti, token korumalı (2026-07-28).
   *  Amacı: günlük bulut rutini (Claude routine) tarayıcı/oturum olmadan sistemin
   *  durumunu okuyabilsin. Sadece operasyonel metrik döner — kişisel/iş verisi YOK.
   *  OPS_SUMMARY_TOKEN env'i tanımlı değilse uç KAPALIDIR (503).
   *  Token: `X-Ops-Token` başlığı veya ?token= ile; karşılaştırma sabit-zamanlı. */
  /** POST /api/ops/disk-test — disk uyarı YOLUNU elle sına.
   *
   *  Neden gerekli: 2026-07-31 kesintisinde izleme sessiz kaldı. Uyarı
   *  mekanizmasının "yazıldı" olması onun ÇALIŞTIĞI anlamına gelmiyor; postanın
   *  gerçekten ulaştığını kanıtlamadan güvenmemek gerek. Eşiklerle oynayıp iki
   *  kez deploy etmek yerine kalıcı bir sınama yolu.
   *
   *  Eşikleri ve 6 saatlik tekrar kısıtını atlar, postayı "TEST" olarak
   *  işaretler. /api/ops/summary ile AYNI token korumasını kullanır.
   */
  app.post('/api/ops/disk-test', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    const sonuc = await diskNobetcisi(true);
    res.json({
      success: !sonuc.hata,
      ...sonuc,
      alici: process.env.OPS_ALERT_EMAIL || process.env.REPORT_RECIPIENT_EMAIL || null,
      not: sonuc.postaDenendi
        ? 'Test postası gönderildi. Gelen kutunu (ve spam) kontrol et.'
        : 'Posta GÖNDERİLEMEDİ — hata alanına bak.',
    });
  });

  app.get('/api/ops/summary', async (req: Request, res: Response) => {
    const expected = process.env.OPS_SUMMARY_TOKEN || '';
    if (!expected) return res.status(503).json({ error: 'ops summary kapalı — OPS_SUMMARY_TOKEN tanımlı değil' });
    const got = (req.headers['x-ops-token'] as string) || String(req.query.token ?? '');
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    try {
      let latest: Record<string, unknown> | null = null;
      let previous: Record<string, unknown> | null = null;
      if (C.getAdminDb()) {
        const snap = await C.getAdminDb().collection('opsChecks').get();
        const rows = snap.docs.map(d => d.data() as Record<string, unknown>)
          .filter(r => r.date)
          .sort((x, y) => String(y.date).localeCompare(String(x.date)));
        latest = rows[0] ?? null;
        previous = rows[1] ?? null;
      }
      const failing = ((latest?.checks as Array<{ key: string; ok: boolean; detail: string }>) || []).filter(c => !c.ok);
      res.json({
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        env: process.env.NODE_ENV || 'development',
        watchdog: {
          date: latest?.date ?? null,
          ok: latest?.ok ?? null,
          failingCount: failing.length,
          failing,                       // yalnız BOZUK olanların detayı
          checks: latest?.checks ?? [],  // tam liste (11 kontrol)
          previousDate: previous?.date ?? null,
          previousOk: previous?.ok ?? null,
        },
        mikro: { apiBase: MIKRO_API_BASE, localMode: MIKRO_LOCAL_MODE, surum: MIKRO_JUMP_SURUM },
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/ops/watchdog/run', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, result: await runOpsWatchdog() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/ops/module-status — modül bazlı sezgisel olgunluk göstergesi.
   *  GERÇEK dosya sinyallerinden hesaplanır (satır sayısı, App.tsx/diğer
   *  bileşenlerde kullanılıyor mu, TODO/stub/placeholder işaretleri) —
   *  "bitti/eksik" gibi kesin bir iddia ÜRETMEZ, yalnız ham sinyalleri döner;
   *  istemci bunu açıkça "sezgisel gösterge" etiketiyle sunar (bkz. CLAUDE.md
   *  "sahte kesinlik gösterme"). 2026-08-16, süper-admin panel isteği.
   */
  const MODULE_REGISTRY: { id: string; label: string; file: string; group: string }[] = [
    { id: 'crm', label: 'CRM (Satış Hunisi)', file: 'src/pages/CRMPage.tsx', group: 'Satış' },
    { id: 'orders', label: 'Sipariş & Lojistik', file: 'src/pages/OrdersPage.tsx', group: 'Satış' },
    { id: 'inventory', label: 'Envanter', file: 'src/pages/InventoryPage.tsx', group: 'Stok' },
    { id: 'muhasebe', label: 'Muhasebe (ana)', file: 'src/pages/MuhasebePage.tsx', group: 'Muhasebe' },
    { id: 'satinalma', label: 'Satın Alma', file: 'src/pages/SatinAlmaPage.tsx', group: 'Satın Alma' },
    { id: 'ik', label: 'İnsan Kaynakları', file: 'src/pages/IKPage.tsx', group: 'IK' },
    { id: 'raporlar', label: 'Raporlar', file: 'src/pages/RaporlarPage.tsx', group: 'Rapor' },
    { id: 'admin', label: 'Admin', file: 'src/pages/AdminPage.tsx', group: 'Yönetim' },
    { id: 'ayarlar', label: 'Ayarlar', file: 'src/pages/SettingsPage.tsx', group: 'Yönetim' },
    { id: 'dashboard', label: 'Dashboard', file: 'src/pages/DashboardPage.tsx', group: 'Genel' },
    { id: 'b2bportal', label: 'B2B Portal', file: 'src/components/B2BPortal.tsx', group: 'Satış' },
    { id: 'hr', label: 'HR Modülü', file: 'src/components/HRModule.tsx', group: 'IK' },
    { id: 'legal', label: 'Hukuk', file: 'src/components/LegalModule.tsx', group: 'Yönetim' },
    { id: 'quality', label: 'Kalite', file: 'src/components/QualityModule.tsx', group: 'Üretim' },
    { id: 'production', label: 'Üretim', file: 'src/components/ProductionModule.tsx', group: 'Üretim' },
    { id: 'mrp', label: 'MRP', file: 'src/components/MRPModule.tsx', group: 'Üretim' },
    { id: 'bom', label: 'Ürün Ağacı (BOM)', file: 'src/components/BOMPanel.tsx', group: 'Üretim' },
    { id: 'bakim', label: 'Bakım', file: 'src/components/BakimModule.tsx', group: 'Üretim' },
    { id: 'servis', label: 'Servis', file: 'src/components/ServisModule.tsx', group: 'Satış' },
    { id: 'lotseri', label: 'Lot/Seri Takip', file: 'src/components/LotSeriModule.tsx', group: 'Stok' },
    { id: 'sube', label: 'Şube Yönetimi', file: 'src/components/SubeModule.tsx', group: 'Yönetim' },
    { id: 'holding', label: 'Holding', file: 'src/components/HoldingModule.tsx', group: 'Yönetim' },
    { id: 'kurumsalyonetim', label: 'Kurumsal Yönetim', file: 'src/components/CorporateGovernanceModule.tsx', group: 'Yönetim' },
    { id: 'maliyetmerkezi', label: 'Maliyet Merkezi', file: 'src/components/MaliyetMerkeziModule.tsx', group: 'Muhasebe' },
    { id: 'gelirtanima', label: 'Gelir Tanıma', file: 'src/components/GelirTanimaModule.tsx', group: 'Muhasebe' },
    { id: 'muhtasar', label: 'Muhtasar', file: 'src/components/MuhtasarModule.tsx', group: 'Muhasebe' },
    { id: 'sabitkiymet', label: 'Sabit Kıymet', file: 'src/components/SabitKiymetModule.tsx', group: 'Muhasebe' },
    { id: 'kasa', label: 'Kasa', file: 'src/components/KasaModule.tsx', group: 'Muhasebe' },
    { id: 'dunning', label: 'Tahsilat Hatırlatma', file: 'src/components/DunningModule.tsx', group: 'Muhasebe' },
    { id: 'ihracat', label: 'İhracat', file: 'src/components/IhracatModule.tsx', group: 'Satış' },
    { id: 'territory', label: 'Bölge Yönetimi', file: 'src/components/TerritoryModule.tsx', group: 'Satış' },
    { id: 'performans', label: 'Performans', file: 'src/components/PerformansModule.tsx', group: 'IK' },
    { id: 'cpq', label: 'CPQ (Teklif Yapılandırma)', file: 'src/components/CPQPanel.tsx', group: 'Satış' },
    { id: 'demandforecast', label: 'Talep Tahmini', file: 'src/components/DemandForecastPanel.tsx', group: 'Stok' },
    { id: 'priceintel', label: 'Fiyat İstihbaratı', file: 'src/components/PriceIntelPanel.tsx', group: 'Satış' },
    { id: 'dealercomm', label: 'Bayi Komisyonu', file: 'src/components/DealerCommissionPanel.tsx', group: 'Satış' },
    { id: 'subscription', label: 'Abonelik Yönetimi', file: 'src/components/SubscriptionPanel.tsx', group: 'Yönetim' },
    { id: 'mobilewms', label: 'Mobil WMS', file: 'src/components/MobileWMSModule.tsx', group: 'Stok' },
    { id: 'erp_hub', label: 'ERP Hub', file: 'src/components/ERPHubPanel.tsx', group: 'Entegrasyon' },
    { id: 'marketplace', label: 'Pazaryeri', file: 'src/components/MarketplacePanel.tsx', group: 'Entegrasyon' },
    { id: 'sku_mapping', label: 'SKU Eşleştirme', file: 'src/components/SkuMappingPanel.tsx', group: 'Entegrasyon' },
    { id: 'mutabakat', label: 'Mutabakat', file: 'src/components/MutabakatPanel.tsx', group: 'Muhasebe' },
    { id: 'overdue', label: 'Vadesi Geçen', file: 'src/components/OverduePanel.tsx', group: 'Muhasebe' },
    { id: 'risk', label: 'Risk Paneli', file: 'src/components/RiskPanel.tsx', group: 'Muhasebe' },
    { id: 'finance', label: 'Finans Paneli', file: 'src/components/FinancePanel.tsx', group: 'Muhasebe' },
    { id: 'analytics', label: 'Analitik', file: 'src/components/AnalyticsPanel.tsx', group: 'Rapor' },
  ];
  const MODULE_STUB_MARKERS = ['todo', 'yakında', 'coming soon', 'henüz bağlı değil', 'placeholder veri', 'mock veri', 'dummy veri', 'not implemented', 'stub veri', 'demo veri'];
  function walkSourceFiles(dir: string, out: string[] = []): string[] {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkSourceFiles(full, out);
      else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }
  // ── Calisma ortami bilgisi (super-admin) ──────────────────────────────────
  // NEDEN VAR: firebase-admin 14 `node >=22` istiyor; CI Node 20'de, uretim
  // sunucusu ise chocolatey 'nodejs-lts' ile kuruldu ve GERCEK surumu hicbir
  // yerden gorunmuyordu. Yukseltme plani tahmine dayanamaz — bu uc olcumu
  // saglar. /api/health'e KONMADI: orasi kimliksiz erisilebiliyor ve tam
  // calisma-zamani surumunu disariya bildirmek gereksiz bilgi sizintisidir.
  app.get('/api/ops/runtime', C.requireAuth, C.requireSuperAdmin, (_req: Request, res: Response) => {
    let firebaseAdminSurum: string | null = null;
    try {
      firebaseAdminSurum = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'node_modules', 'firebase-admin', 'package.json'), 'utf8'),
      ).version as string;
    } catch { /* paket okunamazsa null */ }

    const majör = Number(process.versions.node.split('.')[0]);
    res.json({
      node: process.version,
      nodeMajor: majör,
      platform: `${process.platform} ${process.arch}`,
      firebaseAdmin: firebaseAdminSurum,
      // firebase-admin 14 engines: { node: '>=22' }
      firebaseAdmin14Uyumlu: majör >= 22,
      uptimeSaat: Math.round((process.uptime() / 3600) * 10) / 10,
    });
  });

  app.get('/api/ops/module-status', C.requireAuth, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const root = process.cwd();
      const scanDirs = [path.join(root, 'src', 'pages'), path.join(root, 'src', 'components'), path.join(root, 'src', 'App.tsx')];
      const files = scanDirs.flatMap(d => (fs.existsSync(d) && fs.statSync(d).isDirectory()) ? walkSourceFiles(d) : (fs.existsSync(d) ? [d] : []));
      const contents = new Map<string, string>();
      for (const f of files) { try { contents.set(f, fs.readFileSync(f, 'utf8')); } catch { /* okunamayan dosya atlanır */ } }
      const combined = [...contents.values()].join('\n');
      const modules = MODULE_REGISTRY.map(m => {
        const full = path.join(root, m.file);
        const content = contents.get(full);
        if (content === undefined) return { ...m, exists: false, lines: 0, stubMarkers: [] as string[], wired: false, mtimeMs: null as number | null };
        const lines = content.split('\n').length;
        const lower = content.toLowerCase();
        const stubMarkers = MODULE_STUB_MARKERS.filter(s => lower.includes(s));
        const compName = path.basename(m.file, path.extname(m.file));
        const occurrences = combined.split(compName).length - 1; // kendi dosyasındaki tanım + başka yerdeki kullanım(lar)
        const wired = occurrences >= 2;
        let mtimeMs: number | null = null;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* yok say */ }
        return { ...m, exists: true, lines, stubMarkers, wired, mtimeMs };
      });
      res.json({ success: true, modules, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
