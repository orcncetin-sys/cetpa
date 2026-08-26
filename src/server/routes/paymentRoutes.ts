/**
 * paymentRoutes.ts - ODEME uclari (4 rota): Stripe abonelik + iyzico siparis odemesi.

 *   Stripe (2) - checkout oturumu + webhook (imza dogrulamali)
 *   iyzico (2) - odeme baglantisi + callback
 *
 * ⚠ WEBHOOK IMZASI: `/api/stripe/webhook` `req.rawBody` ile imza dogrular
 * (`stripeClient.webhooks.constructEvent`). rawBody `express.json({ verify })`
 * tarafindan yakalanir ve bu cagri ondan SONRA kayitlidir. Cagri yukari
 * alinirsa imza dogrulamasi sessizce basarisiz olur.
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen:
 * bagimliliklar ACIK baglam nesnesiyle gecer, `import` DEGIL - server.ts bu
 * modulu import ettigi icin ters yonde import DONGU olurdu.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import type Stripe from 'stripe';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface PaymentRouteCtx {
  getAdminDb: () => AdminDbLike;
  /** pg-boss kuyrugu ve Stripe istemcisi server.ts'te SONRADAN kurulur - GETTER. */
  getBoss: () => any;
  getStripeClient: () => any;
  requireAuth: any;
  requireMfaVerified: any;
  paymentLimiter: any;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  pgServerTimestamp: () => any;
  processStripeWebhook: (event: any) => Promise<void>;
  getIyzicoCreds: () => Promise<any>;
  iyzicoAuth: (creds: any, randomStr: string, pkiStr: string) => string;
  toPkiString: (obj: Record<string, unknown>) => string;
  randStr: (len?: number) => string;
  /** Plan fiyatlari server.ts'te (super-admin panelinde de kullaniliyor). */
  STRIPE_PLAN_PRICES: Record<string, { monthly: number; yearly: number; name: string }>;
}

export function paymentRoutes(app: Express, C: PaymentRouteCtx): void {
  // ── iyzico (2 rota) ──────────────────────────────────────────────────
  // GET /api/iyzico/status
  app.get('/api/iyzico/status', async (_req: Request, res: Response) => {
    const creds = await C.getIyzicoCreds();
    if (!creds) return res.json({ configured: false, connected: false });
    try {
      // Lightweight check: retrieve installment info for 1 TRY
      const body   = { locale: 'tr', conversationId: 'status-check', binNumber: '554960' };
      const rndStr = C.randStr();
      const auth   = C.iyzicoAuth(creds, rndStr, C.toPkiString(body));
      const r = await fetch(`${creds.baseUrl}/payment/iyzipos/installment/detail`, {
        method: 'POST',
        headers: { Authorization: auth, 'x-iyzi-rnd': rndStr, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json() as { status?: string };
      res.json({ configured: true, connected: d.status === 'success' || r.ok, sandbox: creds.baseUrl.includes('sandbox') });
    } catch (e) {
      res.json({ configured: true, connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // POST /api/iyzico/payment-link
  // Body: { orderId, amount, currency?, customerName, customerEmail, customerPhone?,
  //         shippingAddress?, taxId?, lineItems?, callbackUrl? }
  // On success: stores paymentPageUrl + iyzicoToken on orders/{orderId}
  app.post('/api/iyzico/payment-link', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const creds = await C.getIyzicoCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true });

    const {
      orderId, amount, currency = 'TRY',
      customerName, customerEmail, customerPhone = '+905000000000',
      shippingAddress = 'Türkiye', taxId = '11111111111',
      lineItems = [], callbackUrl = `${req.protocol}://${req.get('host')}/payment/result`,
    } = req.body as {
      orderId: string; amount: number; currency?: string;
      customerName: string; customerEmail: string; customerPhone?: string;
      shippingAddress?: string; taxId?: string;
      lineItems?: { name: string; price: number; qty?: number }[];
      callbackUrl?: string;
    };

    if (!orderId || !amount || !customerName || !customerEmail) {
      return res.status(400).json({ success: false, error: 'orderId, amount, customerName, customerEmail gerekli.' });
    }

    const amountStr = amount.toFixed(2);
    const nameParts = customerName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName  = nameParts.slice(1).join(' ') || 'Müşteri';

    // Build basket items
    const basket = lineItems.length > 0
      ? lineItems.map((l, i) => ({
          id: `item-${i}`,
          name: l.name,
          category1: 'B2B',
          itemType: 'PHYSICAL',
          price: (l.price * (l.qty ?? 1)).toFixed(2),
        }))
      : [{ id: orderId, name: 'Sipariş', category1: 'B2B', itemType: 'PHYSICAL', price: amountStr }];

    const body = {
      locale: 'tr',
      conversationId: orderId,
      price: amountStr,
      paidPrice: amountStr,
      currency,
      basketId: orderId,
      paymentGroup: 'PRODUCT',
      callbackUrl,
      buyer: {
        id: orderId,
        name: firstName,
        surname: lastName,
        email: customerEmail,
        identityNumber: taxId,
        registrationAddress: shippingAddress,
        city: 'İstanbul',
        country: 'Turkey',
        ip: req.ip || '127.0.0.1',
        gsmNumber: customerPhone,
      },
      shippingAddress: {
        contactName: customerName,
        city: 'İstanbul',
        country: 'Turkey',
        address: shippingAddress,
        zipCode: '34000',
      },
      billingAddress: {
        contactName: customerName,
        city: 'İstanbul',
        country: 'Turkey',
        address: shippingAddress,
        zipCode: '34000',
      },
      basketItems: basket,
    };

    const rndStr = C.randStr();
    const pkiStr = C.toPkiString(body);
    const auth   = C.iyzicoAuth(creds, rndStr, pkiStr);

    try {
      const r = await fetch(`${creds.baseUrl}/payment/initialize/checkout`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'x-iyzi-rnd': rndStr,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json() as { status?: string; paymentPageUrl?: string; token?: string; errorMessage?: string };

      const success = d.status === 'success' && !!d.paymentPageUrl;
      if (success && C.getAdminDb()) {
        await C.getAdminDb().collection('orders').doc(orderId).set({
          companyId: await C.reqCompanyId(req),
          iyzicoPaymentUrl:   d.paymentPageUrl,
          iyzicoToken:        d.token,
          iyzicoCreatedAt:    C.pgServerTimestamp(),
          iyzicoSandbox:      creds.baseUrl.includes('sandbox'),
        }, { merge: true });
      }
      if (success) await C.writeAuditLog(C.reqActor(req), 'İyzico Ödeme Linki', `Sipariş ${orderId} için ödeme linki oluşturuldu (${amount} ${currency})`);
      res.json({ success, paymentPageUrl: d.paymentPageUrl, token: d.token, error: d.errorMessage });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // ── stripe (2 rota) ──────────────────────────────────────────────────
  /**
   * POST /api/stripe/create-checkout
   * Body: { planId, cycle }
   * Returns: { url: string } — Stripe Checkout hosted URL
   * Protected by Firebase Auth (requireAuth).
   */
  app.post('/api/stripe/create-checkout', C.paymentLimiter, C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    if (!C.getStripeClient()) return res.status(503).json({ error: 'Stripe not configured.' });
    const uid = (req as Request & { uid: string }).uid;
    const { planId, cycle } = req.body as { planId: string; cycle: 'monthly' | 'yearly' };

    const prices = C.STRIPE_PLAN_PRICES[planId];
    if (!prices) return res.status(400).json({ error: `Unknown plan: ${planId}` });
    if (!['monthly', 'yearly'].includes(cycle)) return res.status(400).json({ error: 'cycle must be monthly or yearly' });

    const unitAmount = cycle === 'monthly' ? prices.monthly : prices.yearly;
    const interval  = cycle === 'monthly' ? 'month' : 'year';
    const origin    = (req.headers.origin as string) || 'http://localhost:5173';

    try {
      // Fetch or create Stripe customer for this Firebase UID
      let customerId: string | undefined;
      if (C.getAdminDb()) {
        const subSnap = await C.getAdminDb().collection('subscriptions').doc(uid).get();
        if (subSnap.exists) customerId = (subSnap.data() as { stripeCustomerId?: string }).stripeCustomerId;
      }

      const session = await C.getStripeClient().checkout.sessions.create({
        mode: 'subscription',
        ...(customerId ? { customer: customerId } : {}),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'try',
            unit_amount: unitAmount,
            product_data: { name: prices.name },
            recurring: { interval },
          },
        }],
        metadata: { firebaseUid: uid, plan: planId, cycle },
        success_url: `${origin}/?checkout=success&plan=${planId}&cycle=${cycle}`,
        cancel_url:  `${origin}/?checkout=cancel`,
        subscription_data: { metadata: { firebaseUid: uid, plan: planId, cycle } },
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.error('[Stripe create-checkout]', e);
      return res.status(500).json({ error: 'Failed to create checkout session.' });
    }
  });

  /**
   * POST /api/stripe/webhook
   * Stripe sends events here. Signature verified with STRIPE_WEBHOOK_SECRET.
   * Handles:
   *   checkout.session.completed       → activate subscription in Firestore
   *   customer.subscription.updated    → sync status changes
   *   customer.subscription.deleted    → mark cancelled
   */
  app.post('/api/stripe/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
    if (!C.getStripeClient()) return res.status(503).json({ error: 'Stripe not configured.' });
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) return res.status(503).json({ error: 'Webhook secret not set.' });
    if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header.' });

    let event: Stripe.Event;
    try {
      event = C.getStripeClient().webhooks.constructEvent(req.rawBody ?? Buffer.from(''), sig, webhookSecret);
    } catch (e) {
      console.error('[Stripe webhook] signature verification failed:', e);
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    res.sendStatus(200);
    if (C.getBoss()) {
      // P5-1: event.id başına tekilleştir — aynı olayın eşzamanlı iki teslimatı
      // handler'ı paralel çalıştırıp çift ödeme satırı yazamaz (işaret artık
      // handler'dan SONRA yazıldığı için bu serileştirme gerekli).
      await C.getBoss().send('stripe-webhook', { event }, { singletonKey: String(event.id).slice(0, 200) });
    } else {
      await C.processStripeWebhook(event).catch(() => {});
    }
  });
}
