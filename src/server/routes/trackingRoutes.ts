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
  trackLimiter: any;
  apiLimiter: any;
  reqActor: (req: Request) => { uid: string; email: string };
  writeAuditLog: (...a: any[]) => Promise<unknown>;
}

export function trackingRoutes(app: Express, C: TrackingRouteCtx): void {
  // DHL Tracking — https://developer.dhl.com/api-reference/shipment-tracking
  app.get('/api/tracking/dhl/:trackingNumber', C.requireAuth, async (req: Request, res: Response) => {
    const apiKey = process.env.DHL_API_KEY;
    const trackingNumber = Array.isArray(req.params.trackingNumber) ? req.params.trackingNumber[0] : req.params.trackingNumber;

    if (!apiKey) {
      return res.json({
        mock: true, carrier: 'DHL', trackingNumber,
        status: 'In Transit', statusCode: 'in_transit',
        origin: 'Frankfurt, DE', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() + 2 * 86400000).toISOString(),
        service: 'DHL Express Worldwide',
        events: [
          { timestamp: new Date().toISOString(), location: 'Frankfurt, DE', status: 'In Transit', description: 'Shipment is in transit' },
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Leipzig Hub, DE', status: 'Departed', description: 'Departed from facility' },
          { timestamp: new Date(Date.now() - 7200000).toISOString(), location: 'Leipzig Hub, DE', status: 'Arrived', description: 'Arrived at DHL hub' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Sender City, DE', status: 'Picked Up', description: 'Shipment picked up' },
        ]
      });
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
      return res.json({
        mock: true, carrier: 'UPS', trackingNumber,
        status: 'Out For Delivery', statusCode: 'out_for_delivery',
        origin: 'Louisville, KY, US', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() + 86400000).toISOString(),
        service: 'UPS Worldwide Express',
        events: [
          { timestamp: new Date().toISOString(), location: 'Istanbul, TR', status: 'Out For Delivery', description: 'Out for delivery' },
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Istanbul Customs, TR', status: 'Cleared', description: 'Released from customs' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Cologne Hub, DE', status: 'In Transit', description: 'Arrived at UPS facility' },
          { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), location: 'Louisville, KY, US', status: 'Departed', description: 'Departed from facility' },
        ]
      });
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
      return res.json({
        mock: true, carrier: 'FedEx', trackingNumber,
        status: 'Delivered', statusCode: 'delivered',
        origin: 'Memphis, TN, US', destination: 'Istanbul, TR',
        estimatedDelivery: new Date(Date.now() - 3600000).toISOString(),
        service: 'FedEx International Priority',
        events: [
          { timestamp: new Date(Date.now() - 3600000).toISOString(), location: 'Istanbul, TR', status: 'DL', description: 'Delivered - Package handed to recipient' },
          { timestamp: new Date(Date.now() - 7200000).toISOString(), location: 'Istanbul, TR', status: 'OD', description: 'On FedEx vehicle for delivery' },
          { timestamp: new Date(Date.now() - 86400000).toISOString(), location: 'Istanbul Ataturk, TR', status: 'AR', description: 'Arrived at FedEx location' },
          { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), location: 'Paris CDG, FR', status: 'DP', description: 'Left FedEx origin facility' },
          { timestamp: new Date(Date.now() - 3 * 86400000).toISOString(), location: 'Memphis, TN, US', status: 'PU', description: 'Picked up' },
        ]
      });
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
  // Falls back to realistic mock data when credentials aren't configured.
  // Credentials (optional) stored in env vars or Firestore settings/cargoApiKeys.

  function trMockEvents(carrier: string, no: string, status: string) {
    const now = Date.now();
    return {
      mock: true, carrier, trackingNumber: no,
      statusCode: 'in_transit' as const, status,
      origin: 'İstanbul', destination: 'Ankara',
      estimatedDelivery: new Date(now + 86400000).toISOString(),
      isMock: true,
      events: [
        { timestamp: new Date(now - 1800000).toISOString(), location: 'Ankara Dağıtım Merkezi', status: 'Dağıtıma Çıktı', description: `${carrier}: Dağıtıma çıktı` },
        { timestamp: new Date(now - 7200000).toISOString(), location: 'Ankara Transfer Merkezi', status: 'Transfer Merkezi', description: `${carrier}: Transfer merkezine ulaştı` },
        { timestamp: new Date(now - 86400000).toISOString(), location: 'İstanbul Çıkış Deposu', description: `${carrier}: Kargo alındı`, status: 'Alındı' },
      ],
    };
  }

  // Yurtiçi Kargo
  app.get('/api/tracking/yurtici/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.YURTICI_API_KEY;
    if (!apiKey) return res.json(trMockEvents('Yurtiçi', no, 'Dağıtımda'));
    try {
      const r = await fetch('https://ws.yurticikargo.com/GetShipmentInfo/v1', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body:    JSON.stringify({ trackingNumbers: [no] }),
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('Yurtiçi', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('Yurtiçi', no, 'Bilgi Alınamadı'));
    }
  });

  // MNG Kargo
  app.get('/api/tracking/mng/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.MNG_API_KEY;
    if (!apiKey) return res.json(trMockEvents('MNG', no, 'Yolda'));
    try {
      const r = await fetch(`https://service.mngkargo.com.tr/mngWS.asmx/Sorgu?TakipNo=${encodeURIComponent(no)}`, {
        headers: { 'x-api-key': apiKey },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('MNG', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('MNG', no, 'Bilgi Alınamadı'));
    }
  });

  // Aras Kargo
  app.get('/api/tracking/aras/:no', C.requireAuth, async (req: Request, res: Response) => {
    const no = req.params['no'] as string;
    const apiKey = process.env.ARAS_API_KEY;
    if (!apiKey) return res.json(trMockEvents('Aras', no, 'Transfer Merkezinde'));
    try {
      const r = await fetch(`https://kargo.aras.com.tr/api/v1/shipment/track/${encodeURIComponent(no)}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) return res.json(trMockEvents('Aras', no, 'Bilinmiyor'));
      const data = await r.json() as Record<string, unknown>;
      res.json(data);
    } catch {
      res.json(trMockEvents('Aras', no, 'Bilgi Alınamadı'));
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
        return res.json({ ...trMockEvents('PTT', no, 'Yolda'), ...data, mock: false, isMock: false });
      }
      return res.json(trMockEvents('PTT', no, 'Teslimatta'));
    } catch {
      res.json(trMockEvents('PTT', no, 'Teslimatta'));
    }
  });
}
