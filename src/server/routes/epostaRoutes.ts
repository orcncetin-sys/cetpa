/**
 * epostaRoutes.ts - E-POSTA ve DAVET uclari (6 rota).
 *
 *   /api/email/status · send · order-notification · bulk-campaign
 *   /api/admin/invite    - davet olusturur VE davet postasini gonderir
 *   /api/invites/redeem  - daveti kabul eder
 *
 * NEDEN AYNI DOSYA: davet uclari ilk bakista "yabanci" gorunuyor (farkli yol
 * oneki) ama isleri e-postanin ta kendisi — `admin/invite` bir davet postasi
 * gonderir, `invites/redeem` o postadaki jetonu kabul eder.
 *
 * `sendEmail` ve `getResendKey` server.ts'te KALDI (baglamdan geliyorlar):
 * superadminRoutes de `sendEmail`i kullaniyor, buraya tasinsa server.ts'in
 * bu modulu import etmesi gerekirdi ve bu DONGU olurdu.
 *
 * server.ts'ten AYRILDI (2026-08-26). Onceki rota gruplariyla AYNI desen.
 */
import type { Express, Request, Response } from 'express';
import type { AdminDbLike } from '../adminDbTypes.js';
import type { Sema } from '../schemas.js';
import { EmailSendSchema } from '../schemas.js';
// Yaprak moduller — dongu yok.
import { resendGonderici, escapeHtml, isValidEmail } from '../eposta.js';
import { APP_ROLES } from '../../lib/rbac.js';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface EpostaRouteCtx {
  getAdminDb: () => AdminDbLike;
  requireAuth: any;
  requireMfaVerified: any;
  requireAdmin: any;
  requireStaff: any;
  authLimiter: any;
  reqActor: (req: Request) => { uid: string; email: string };
  reqCompanyId: (req: Request) => Promise<string>;
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  pgServerTimestamp: () => any;
  validate: <T>(sema: Sema<T>, veri: unknown, res: Response) => T | null;
  getResendKey: () => Promise<{ apiKey: string; from: string } | null>;
  sendEmail: (to: string, subject: string, html: string, fromOverride?: string, replyTo?: string)
    => Promise<{ id?: string; error?: string }>;
}

export function epostaRoutes(app: Express, C: EpostaRouteCtx): void {
  // GET /api/email/status
  app.get('/api/email/status', async (_req: Request, res: Response) => {
    const creds = await C.getResendKey();
    res.json({ configured: !!creds });
  });

  // POST /api/email/send — generic send (used by UI, requires auth)
  // Body: { to, subject, html }
  app.post('/api/email/send', C.requireAuth, C.requireMfaVerified, C.requireStaff, async (req: Request, res: Response) => {
    const body = C.validate(EmailSendSchema, req.body, res);
    if (!body) return;
    const result = await C.sendEmail(body.to, body.subject, body.html, body.from, body.replyTo);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  });

  // POST /api/email/order-notification
  // Body: { orderId, status, customerEmail } — sends branded status email
  app.post('/api/email/order-notification', C.requireAuth, C.requireMfaVerified, async (req: Request, res: Response) => {
    const { orderId, status, customerEmail, customerName, orderNo, lang = 'tr' } =
      req.body as { orderId: string; status: string; customerEmail: string; customerName: string; orderNo?: string; lang?: string };
    if (!customerEmail) return res.status(400).json({ success: false, error: 'customerEmail gerekli.' });

    const trackUrl = `${req.protocol}://${req.get('host')}/?track=${encodeURIComponent(orderId)}`;
    const tr = lang === 'tr';
    const eName = escapeHtml(customerName); // HTML injection engeli
    const eOrderNo = escapeHtml(orderNo ?? orderId.slice(0, 8).toUpperCase());

    const statusLabel: Record<string, { tr: string; en: string; color: string }> = {
      Pending:    { tr: 'Sipariş Alındı',   en: 'Order Received',  color: '#f59e0b' },
      Processing: { tr: 'Hazırlanıyor',     en: 'Processing',      color: '#8b5cf6' },
      Shipped:    { tr: 'Kargoya Verildi',  en: 'Shipped',         color: '#3b82f6' },
      Delivered:  { tr: 'Teslim Edildi',    en: 'Delivered',       color: '#10b981' },
      Cancelled:  { tr: 'İptal Edildi',     en: 'Cancelled',       color: '#ef4444' },
    };
    const lbl = statusLabel[status] ?? { tr: status, en: status, color: '#6b7280' };
    const subjectText = tr
      ? `Siparişiniz güncellendi: ${lbl.tr} — #${orderNo ?? orderId.slice(0, 8)}`
      : `Order update: ${lbl.en} — #${orderNo ?? orderId.slice(0, 8)}`;

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <!-- Header -->
  <div style="background:#1a3a5c;padding:24px 32px;">
    <p style="margin:0;color:#fff;font-size:22px;font-weight:800;">CETPA</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:12px;">${tr ? 'Sipariş Bilgilendirme' : 'Order Notification'}</p>
  </div>
  <!-- Body -->
  <div style="padding:32px;">
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">${tr ? `Sayın ${eName},` : `Dear ${eName},`}</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${tr ? 'Siparişinizin durumu güncellendi.' : 'Your order status has been updated.'}</p>
    <!-- Status badge -->
    <div style="text-align:center;margin:0 0 24px;">
      <span style="display:inline-block;background:${lbl.color}1a;color:${lbl.color};font-size:15px;font-weight:700;padding:10px 28px;border-radius:999px;border:2px solid ${lbl.color}44;">
        ${tr ? lbl.tr : lbl.en}
      </span>
    </div>
    <!-- Order no -->
    <div style="background:#f9fafb;border-radius:12px;padding:16px;margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#9ca3af;font-weight:700;letter-spacing:.08em;">${tr ? 'SİPARİŞ NO' : 'ORDER NO'}</p>
      <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#1a3a5c;font-family:monospace;">#${eOrderNo}</p>
    </div>
    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${trackUrl}" style="display:inline-block;background:#1a3a5c;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:999px;text-decoration:none;">
        ${tr ? '📦 Siparişimi Takip Et' : '📦 Track My Order'}
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">${tr ? 'Sorularınız için bize ulaşabilirsiniz.' : 'Feel free to contact us with any questions.'}</p>
  </div>
  <div style="background:#f9fafb;padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#d1d5db;">© ${new Date().getFullYear()} Cetpa Yazılım A.Ş.</p>
  </div>
</div></body></html>`;

    const result = await C.sendEmail(customerEmail, subjectText, html);
    if (result.error === 'notConfigured') return res.status(503).json({ success: false, notConfigured: true });
    if (result.error) return res.status(500).json({ success: false, error: result.error });

    // Log to Firestore
    if (C.getAdminDb()) {
      await C.getAdminDb().collection('emailLog').add({
        companyId: await C.reqCompanyId(req),
        orderId, to: customerEmail, subject: subjectText, status, sentAt: C.pgServerTimestamp(),
      });
    }
    res.json({ success: true, id: result.id });
  });

  // ── Davet Kullanimi (redeem) ──────────────────────────────────────────────
  // POST /api/invites/redeem  Body: { token }
  //
  // Bu uc EKSIKTI: /api/admin/invite ve super-admin daveti `invites/{token}`
  // dokumanini YAZIYOR ama hicbir yer OKUMUYORDU. Sonuc: davetteki rol ve
  // companyId hicbir zaman uygulanmiyor, davetle gelen herkes App.tsx'teki
  // varsayilan dala dusup 'Sales' + kendi uid'i ile aciliyordu (rolsuz hesap
  // kapisi eklendikten sonra ise dogrudan "rol atanmamis" ekranina).
  //
  // requireAdmin YOK — daveti kullanan kisi hentiz rolsuz normal bir
  // kullanicidir; yetki kontrolu davetin KENDISIDIR (token + e-posta esmesi).
  app.post('/api/invites/redeem', C.authLimiter, C.requireAuth, async (req: Request, res: Response) => {
    const { token } = (req.body ?? {}) as { token?: string };
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Davet kodu gerekli.' });
    }
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Veritabanı kullanılamıyor.' });

    const { uid, email } = C.reqActor(req);
    try {
      const snap = await C.getAdminDb().collection('invites').doc(token).get();
      if (!snap.exists) return res.status(404).json({ success: false, error: 'Davet bulunamadı.' });
      const inv = snap.data() as { email?: string; role?: string; companyId?: string; expiresAt?: string; used?: boolean };

      if (inv.used) return res.status(409).json({ success: false, error: 'Bu davet daha önce kullanılmış.' });
      if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) {
        return res.status(410).json({ success: false, error: 'Davetin süresi dolmuş.' });
      }
      // E-POSTA ESLESMESI ZORUNLU: davet baglantisi ele gecirilse bile baskasi
      // kullanamaz. Kucuk/buyuk harf duyarsiz karsilastirma.
      const davetEposta = (inv.email || '').trim().toLowerCase();
      const girenEposta = (email || '').trim().toLowerCase();
      if (!davetEposta || !girenEposta || davetEposta !== girenEposta) {
        return res.status(403).json({ success: false, error: 'Bu davet başka bir e-posta adresi için oluşturulmuş.' });
      }
      // Rol, davet yazilirken dogrulanmisti; yine de burada TEKRAR dogrula —
      // eski/bozuk bir davet dokumani uydurma rol tasiyor olabilir (Accountant,
      // Warehouse, Viewer gibi; bkz. APP_ROLES yorumu).
      if (!inv.role || !(APP_ROLES as readonly string[]).includes(inv.role)) {
        return res.status(422).json({ success: false, error: 'Davetteki rol artık geçerli değil. Yöneticinizden yeni davet isteyin.' });
      }

      const guncelleme: Record<string, unknown> = { role: inv.role };
      // companyId davet dokumanindan gelir — istemciden ASLA alinmaz, aksi
      // halde kullanici istedigi kiraciya katilabilirdi.
      if (inv.companyId) guncelleme.companyId = inv.companyId;

      await C.getAdminDb().collection('users').doc(uid).set(guncelleme, { merge: true });
      await C.getAdminDb().collection('invites').doc(token).set(
        { used: true, usedAt: C.pgServerTimestamp(), usedBy: uid },
        { merge: true },
      );

      void C.writeAuditLog({ uid, email }, 'Davet kullanıldı', `${email} → ${inv.role}${inv.companyId ? ` (firma: ${inv.companyId})` : ''}`);
      return res.json({ success: true, role: inv.role, companyId: inv.companyId ?? null });
    } catch (e) {
      console.error('Davet kullanım hatası:', (e as Error).message);
      return res.status(500).json({ success: false, error: 'Davet işlenemedi.' });
    }
  });

  // ── Admin: User Invite ────────────────────────────────────────────────────
  // POST /api/admin/invite — sends invite email via Resend, stores invite doc in Firestore
  // Body: { email, role }
  app.post('/api/admin/invite', C.authLimiter, C.requireAuth, C.requireMfaVerified, C.requireAdmin, async (req: Request, res: Response) => {
    const { email, role = 'Sales' } = req.body as { email: string; role?: string };
    if (!email || !isValidEmail(email)) return res.status(400).json({ success: false, error: 'Geçerli e-posta gerekli.' });
    if (!(APP_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ success: false, error: `Geçersiz rol. Geçerli roller: ${APP_ROLES.join(', ')}` });
    }

    // Generate a random token
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Store invite in Firestore (if admin available)
    if (C.getAdminDb()) {
      try {
        await C.getAdminDb().collection('invites').doc(token).set({
          companyId: await C.reqCompanyId(req),
          email, role, token, expiresAt,
          createdAt: C.pgServerTimestamp(),
          used: false,
        });
      } catch (e) {
        console.warn('Could not write invite to Firestore:', (e as Error).message);
      }
    }

    // Determine app URL for invite link
    const appUrl = process.env.APP_URL || `https://gen-lang-client-0628151245.web.app`;
    const inviteUrl = `${appUrl}/?invite=${token}`;

    // Send via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey && !C.getAdminDb()) return res.status(503).json({ success: false, notConfigured: true });
    if (!resendKey) {
      // No email config — still return success with the invite URL so admin can share manually
      return res.json({ success: true, inviteUrl, emailSent: false, note: 'Resend not configured — share the invite URL manually.' });
    }

    const fromAddress = resendGonderici();
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.5px;">CETPA'ya Davet Edildiniz</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 16px;">Merhaba,</p>
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 24px;">
        CETPA B2B platformuna <strong>${escapeHtml(role)}</strong> rolüyle davet edildiniz.
        Aşağıdaki butona tıklayarak kaydınızı tamamlayabilirsiniz.
      </p>
      <a href="${inviteUrl}" style="display:inline-block;background:#ff4000;color:#fff;padding:14px 28px;border-radius:12px;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:-.2px;">
        Hesap Oluştur
      </a>
      <p style="font-size:11px;color:#86868b;margin:20px 0 0;">Bu bağlantı 7 gün geçerlidir. Eğer bu daveti beklemiyor idiyseniz görmezden gelebilirsiniz.</p>
    </div>
    <div style="background:#f5f5f7;padding:16px 32px;text-align:center;">
      <p style="font-size:11px;color:#86868b;margin:0;">CETPA B2B SaaS Platform</p>
    </div>
  </div>
</body></html>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [email], subject: `CETPA'ya Davet Edildiniz — ${role} Rolü`, html }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) return res.status(500).json({ success: false, error: (d.message as string) || 'Resend API hatası' });
      return res.json({ success: true, inviteUrl, emailSent: true, id: d.id });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * POST /api/email/bulk-campaign
   * Body: { subject, body, recipients: {name, email}[], campaignId? }
   * Sends an email to each recipient, personalising {{name}} placeholder.
   * Rate-limited to 3 req/s to stay inside Resend free tier.
   * Returns: { sent, failed, notConfigured? }
   */
  app.post('/api/email/bulk-campaign', C.requireAuth, C.requireMfaVerified, C.requireStaff, async (req: Request, res: Response) => {
    const { subject, body, recipients, campaignId } =
      req.body as { subject: string; body: string; recipients: { name: string; email: string }[]; campaignId?: string };

    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'subject, body, and recipients[] required.' });
    }

    const creds = await C.getResendKey();
    if (!creds) return res.json({ sent: 0, failed: 0, notConfigured: true });

    let sent = 0;
    let failed = 0;
    const BATCH_DELAY_MS = 350; // ~3 req/s

    for (const recipient of recipients) {
      if (!recipient.email) { failed++; continue; }
      const personalised = body.replace(/\{\{name\}\}/gi, recipient.name || recipient.email.split('@')[0]);
      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <p>${personalised.replace(/\n/g, '<br>')}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#999">Bu e-posta Cetpa ERP tarafından gönderilmiştir. Abonelikten çıkmak için lütfen bizimle iletişime geçin.</p>
      </body></html>`;
      const result = await C.sendEmail(recipient.email, subject, html);
      if (result.error) { failed++; } else { sent++; }
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    // Update campaign record if ID provided
    if (campaignId && C.getAdminDb()) {
      await C.getAdminDb().collection('campaigns').doc(campaignId).update({
        sent,
        failed,
        completedAt: C.pgServerTimestamp(),
        status: 'sent',
      }).catch(() => {});
    }

    console.log(`[bulk-campaign] sent=${sent} failed=${failed} total=${recipients.length}`);
    return res.json({ sent, failed });
  });
}
