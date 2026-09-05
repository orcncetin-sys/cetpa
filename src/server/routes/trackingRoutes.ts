/**
 * trackingRoutes.ts - Kargo takip uclari (7 rota: DHL, UPS, FedEx, Yurtici, MNG, Aras, PTT).
 *
 * DIS BAGIMLILIK COK DAR (olculdu): yalnizca kimlik/limit ara katmanlari.
 * Kargo firmalarinin API cagrilari src/services/trackingService.ts'te ve
 * oradan IMPORT ediliyor - o modul server.ts'e bagli olmadigi icin dongu yok.
 *
 * server.ts'ten AYRILDI (2026-08-25) - D4 adim 10. Onceki rota gruplariyla
 * AYNI desen: bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL -
 * server.ts bu modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface TrackingRouteCtx {
  requireAuth: any;
  requireMfaVerified: any;
}

export function trackingRoutes(app: Express, C: TrackingRouteCtx): void {
  // ── Cargo Tracking Proxy Routes ────────────────────────────────────────
  // DHL Tracking — https://developer.dhl.com/api-reference/shipment-tracking
  app.get('/api/tracking/dhl/:trackingNumber', C.requireAuth, async (req: Request, res: Response) => {
    const apiKey = process.env.DHL_API_KEY;
    const trackingNumber = Array.isArray(req.params.trackingNumber) ? req.params.trackingNumber[0] : req.params.trackingNumber;

    if (!apiKey) {
      return res.json(yapilandirilmamis('DHL', trackingNumber, 'DHL_API_KEY tanımlı değil'));
    }

    try {
      const r = await fetch(
        `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
        { headers: { 'DHL-API-Key': apiKey, 'Accept': 'application/json' } }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.title || 'DHL API Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'DHL fetch failed' });
    }
  });

  // UPS Tracking — https://developer.ups.com/api/reference/tracking
  app.get('/api/tracking/ups/:trackingNumber', C.requireAuth, async (req: Request, res: Response) => {
    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;
    const trackingNumber = Array.isArray(req.params.trackingNumber) ? req.params.trackingNumber[0] : req.params.trackingNumber;

    if (!clientId || !clientSecret) {
      return res.json(yapilandirilmamis('UPS', trackingNumber, 'UPS_CLIENT_ID / UPS_CLIENT_SECRET tanımlı değil'));
    }

    try {
      // OAuth token
      const tokenRes = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: 'grant_type=client_credentials'
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) return res.status(401).json({ error: 'UPS OAuth failed' });

      const r = await fetch(
        `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false`,
        { headers: { 'Authorization': `Bearer ${token.access_token}`, 'transId': Date.now().toString(), 'transactionSrc': 'cetpa' } }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'UPS Tracking Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'UPS fetch failed' });
    }
  });

  // FedEx Tracking — https://developer.fedex.com/api/en-us/catalog/tracking
  app.post('/api/tracking/fedex', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const clientId = process.env.FEDEX_CLIENT_ID;
    const clientSecret = process.env.FEDEX_CLIENT_SECRET;
    const { trackingNumber } = req.body;

    if (!clientId || !clientSecret) {
      return res.json(yapilandirilmamis('FedEx', trackingNumber, 'FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET tanımlı değil'));
    }

    try {
      const tokenRes = await fetch('https://apis.fedex.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) return res.status(401).json({ error: 'FedEx OAuth failed' });

      const r = await fetch('https://apis.fedex.com/track/v1/trackingnumbers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US'
        },
        body: JSON.stringify({
          trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
          includeDetailedScans: true
        })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'FedEx Tracking Error' });
      res.json(data);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'FedEx fetch failed' });
    }
  });

  // ── Turkish Cargo Carrier Tracking ──────────────────────────────────────────
  // Returns a normalised TrackingResult-compatible object.
  // Credentials (optional) stored in env vars or Firestore settings/cargoApiKeys.

  /**
   * UYDURMA KARGO VERİSİ YOK (Faz 1, 2026-09-04).
   *
   * Eskiden bir sahte-olay üreticisi vardı: API anahtarı yoksa, API hata verirse
   * VEYA ağ koparsa her takip numarasına "Ankara Dağıtım Merkezi: Dağıtıma çıktı"
   * gibi SAHTE olaylar, DHL/UPS/FedEx için "Frankfurt→İstanbul, 2 gün sonra
   * teslim" dönüyordu. DHL/UPS/FedEx `mock` gönderiyor, ekran `isMock` bekliyordu →
   * o üçünde DEMO rozeti hiç yanmıyordu; Türk kargolarda `isMock:true` gidiyor ve
   * rozet yanıyordu, ama uydurma olaylar yine gerçek gibi listeleniyordu. İki
   * durumda da müşteri uydurma bilgiyi okuyordu. CLAUDE.md "sahte kesinlik
   * gösterme": bilinmeyen kargo durumu uydurulmaz, "yapılandırılmamış /
   * alınamadı" denir. Test: trackingRoutes.test.ts
   */
  function yapilandirilmamis(carrier: string, trackingNumber: string, sebep: string) {
    return {
      configured: false as const, mock: false, isMock: false,
      carrier, trackingNumber,
      status: 'Takip yapılandırılmamış', statusCode: 'pending' as const,
      origin: '', destination: '', events: [] as never[],
      error: sebep,
    };
  }
  /** API ulaşılamaz/hatalı: bu da uydurulmaz — "alınamadı" denir. */
  function alinamadi(carrier: string, trackingNumber: string, sebep: string) {
    return { ...yapilandirilmamis(carrier, trackingNumber, sebep), status: 'Takip bilgisi alınamadı' };
  }

  // Yurtiçi Kargo
  app.get('/api/tracking/yurtici/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.YURTICI_API_KEY;
    if (!apiKey) return res.json(yapilandirilmamis('Yurtiçi', no, 'YURTICI_API_KEY tanımlı değil'));
    try {
      const r = await fetch('https://ws.yurticikargo.com/GetShipmentInfo/v1', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body:    JSON.stringify({ trackingNumbers: [no] }),
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(alinamadi('Yurtiçi', no, `Yurtiçi API HTTP ${r.status}`));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(alinamadi('Yurtiçi', no, 'Yurtiçi API yanıt vermedi'));
    }
  });

  // MNG Kargo
  app.get('/api/tracking/mng/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.MNG_API_KEY;
    if (!apiKey) return res.json(yapilandirilmamis('MNG', no, 'MNG_API_KEY tanımlı değil'));
    try {
      const r = await fetch(`https://service.mngkargo.com.tr/mngWS.asmx/Sorgu?TakipNo=${encodeURIComponent(no)}`, {
        headers: { 'x-api-key': apiKey },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(alinamadi('MNG', no, `MNG API HTTP ${r.status}`));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(alinamadi('MNG', no, 'MNG API yanıt vermedi'));
    }
  });

  // Aras Kargo
  app.get('/api/tracking/aras/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.ARAS_API_KEY;
    if (!apiKey) return res.json(yapilandirilmamis('Aras', no, 'ARAS_API_KEY tanımlı değil'));
    try {
      const r = await fetch(`https://kargo.aras.com.tr/api/v1/shipment/track/${encodeURIComponent(no)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(alinamadi('Aras', no, `Aras API HTTP ${r.status}`));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(alinamadi('Aras', no, 'Aras API yanıt vermedi'));
    }
  });

  // PTT Kargo
  app.get('/api/tracking/ptt/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    try {
      // PTT has a semi-public JSON endpoint
      const r = await fetch(`https://gonderitakip.ptt.gov.tr/Track/Verify?q=${encodeURIComponent(no)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal:  AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json() as Record<string, unknown>;
        return res.json({ configured: true, mock: false, isMock: false, carrier: 'PTT', trackingNumber: no, ...data });
      }
      return res.json(alinamadi('PTT', no, 'PTT API yanıt vermedi'));
    } catch {
      res.json(alinamadi('PTT', no, 'PTT API yanıt vermedi'));
    }
  });
}
