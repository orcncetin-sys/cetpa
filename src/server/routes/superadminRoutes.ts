/**
 * superadminRoutes.ts - SaaS operatoru uclari: kiraci yonetim paneli (10 rota).
 *
 * server.ts'ten AYRILDI (2026-08-25) - D4 adim 9. mikroRoutes ile AYNI desen:
 * bagimliliklar acik baglam nesnesiyle gecer (import DEGIL - dongu olurdu).
 *
 * BU MODUL YUKSEK YETKILI: kiraci askiya alma, kullanici rolu degistirme,
 * kiracidan kullanici cikarma, yedek tetikleme, odeme baglantisi uretme.
 * Her rota `requireSuperAdmin` ile korunuyor ve bu koruma BAGLAMDAN geliyor -
 * modul kendi yetki karari VERMEZ, server.ts'in politikasini uygular.
 *
 * ICERIDE KALAN (olculdu, disarida kullanilmiyor): planAmount, SA_PLANS.
 *
 * ILK STAGING'DE DENENEN DEGISIKLIK: bu cikarma once `staging/db-routes`
 * dalina gidip cetpa-staging'de (port 5174) dogrulandi, sonra main'e alindi.
 */
import type { Express, Request, Response } from 'express';

/** server.ts'ten ihtiyac duyulan HER SEY - acik liste. */
export interface SuperadminRouteCtx {
  getAdminDb: () => any;
  pgServerTimestamp: () => any;
  reqActor: (req: Request) => { uid: string; email: string };
  writeAuditLog: (...a: any[]) => Promise<unknown>;
  requireAuth: any;
  requireSuperAdmin: any;
  requireMfaVerified: any;
  isSuperAdmin: (req: Request) => boolean;
  sendEmail: (...a: any[]) => Promise<any>;
  iyzicoAuth: (...a: any[]) => any;
  /** Plan fiyatlari: plan -> { monthly, yearly }. Tipi TAHMIN ETME -
   *  ilk yazimda Record<string, number> yazilmisti, tsc yakaladi. */
  PLAN_PRICES_TRY: Record<string, { monthly: number; yearly: number }>;
  /** Iyzico kimlik/yardimcilari ve kucuk uretecler - hepsi startServer
   *  kapsaminda tanimli oldugu icin import EDILEMEZ, baglamdan geciyor. */
  getIyzicoCreds: () => any;
  randStr: (n?: number) => string;
  toPkiString: (o: any) => string;
  /** Kiraci durumu (active/suspended) onbellegi + okuyucu. Modul duzeyinde
   *  olsalar da BAGLAMDAN geciyorlar: server.ts'ten import etmek dongu
   *  yaratirdi (server.ts bu modulu import ediyor). */
  getCompanyStatus: (cid: string) => Promise<string>;
  companyStatusCache: Map<string, { status: string; exp: number }>;
  APP_ROLES: readonly string[];
  escapeHtml: (s: string) => string;
  isValidEmail: (s: string) => boolean;
}

export function superadminRoutes(app: Express, C: SuperadminRouteCtx): void {
  const planAmount = (plan: string, cycle: string): number =>
    C.PLAN_PRICES_TRY[plan]?.[cycle === 'yearly' ? 'yearly' : 'monthly'] ?? 0;

  /** İstek sahibinin süper-admin olup olmadığını döner (panel görünürlüğü için). */
  app.get('/api/superadmin/me', C.requireAuth, (req: Request, res: Response) => {
    res.json({ isSuperAdmin: C.isSuperAdmin(req), email: C.reqActor(req).email });
  });

  /** Tüm kiracı firmaları istatistikleriyle listeler. */
  // Kiracinin KENDI yedek hedefini kaydet (super-admin onboarding adimi).
  // rclone remote'un KENDISI sir degil (jeton sunucudaki rclone.conf'ta durur),
  // ama yine de super-admin disina acilmaz: hangi musterinin nereye
  // yedekledigi operasyonel bir bilgidir.
  app.post('/api/superadmin/tenants/:companyId/backup', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId || '').trim();
    if (!cid) return res.status(400).json({ success: false, error: 'companyId gerekli.' });
    const { rcloneRemote, enabled, retentionDays } = (req.body ?? {}) as
      { rcloneRemote?: string; enabled?: boolean; retentionDays?: number };

    const remote = String(rcloneRemote ?? '').trim();
    // "ad:yol" bicimi — iki nokta ZORUNLU. Bicimi burada dogrulamak, yedek
    // gorevinin gece yarisi sessizce patlamasindan iyidir.
    if (remote && !(remote.indexOf(':') > 0)) {
      return res.status(400).json({ success: false, error: "rclone hedefi 'ad:yol' biciminde olmali (or. gdrive:cetpa-yedek)." });
    }
    const gun = Number(retentionDays);
    try {
      await C.getAdminDb().collection('backupConfigs').doc(cid).set({
        companyId: cid,
        rcloneRemote: remote,
        enabled: enabled !== false,
        ...(Number.isFinite(gun) && gun > 0 ? { retentionDays: Math.floor(gun) } : {}),
        updatedAt: C.pgServerTimestamp(),
      }, { merge: true });
      void C.writeAuditLog(C.reqActor(req), 'Kiraci yedek ayari', `${cid} -> ${remote || '(temizlendi)'}`);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/superadmin/tenants', C.requireAuth, C.requireSuperAdmin, async (_req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    try {
      const usersSnap = await C.getAdminDb().collection('users').get();
      // companyId -> { userCount, owner, users[] }
      const groups = new Map<string, { userCount: number; ownerEmail: string; ownerName: string; createdAt: unknown }>();
      usersSnap.docs.forEach(d => {
        const u = d.data() as Record<string, unknown>;
        const cid = (u.companyId as string) || d.id;
        const g = groups.get(cid) || { userCount: 0, ownerEmail: '', ownerName: '', createdAt: undefined };
        g.userCount++;
        // Sahip: uid === companyId olan ya da admin rolündeki ilk kullanıcı
        if (d.id === cid || (!g.ownerEmail && (u.role === 'admin' || u.role === 'Admin'))) {
          g.ownerEmail = (u.email as string) || g.ownerEmail;
          g.ownerName = (u.displayName as string) || (u.name as string) || g.ownerName;
        }
        if (!g.ownerEmail) g.ownerEmail = (u.email as string) || g.ownerEmail;
        if (!g.createdAt) g.createdAt = u.createdAt;
        groups.set(cid, g);
      });

      const tenants = await Promise.all(Array.from(groups.entries()).map(async ([cid, g]) => {
        let companyName = '';
        let plan = 'free'; let subStatus = 'none'; let cycle = 'monthly';
        let nextPaymentDate: unknown = null; let lastPaymentDate: unknown = null; let amount = 0;
        try {
          const profSnap = await C.getAdminDb()!.collection('settings').doc(`${cid}__companyProfile`).get();
          if (profSnap.exists) { const p = profSnap.data() as Record<string, unknown>; companyName = (p.companyName as string) || (p.name as string) || (p.unvan as string) || ''; }
        } catch { /* ignore */ }
        try {
          const subSnap = await C.getAdminDb()!.collection('subscriptions').doc(cid).get();
          if (subSnap.exists) {
            const s = subSnap.data() as Record<string, unknown>;
            plan = (s.plan as string) || plan;
            subStatus = (s.status as string) || subStatus;
            cycle = (s.cycle as string) || cycle;
            nextPaymentDate = s.currentPeriodEnd ?? s.nextPaymentDate ?? s.endDate ?? null;
            lastPaymentDate = s.lastPaymentDate ?? s.lastPaymentAt ?? s.lastPayment ?? null;
            amount = (s.amount as number) ?? planAmount(plan, cycle);
          }
        } catch { /* ignore */ }
        if (!amount) amount = planAmount(plan, cycle);
        const status = await C.getCompanyStatus(cid);
        // YEDEK DURUMU (2026-08-21): her kiraci KENDI hesabina yedeklenir.
        // Kurulum yapilmamis kiraci onboarding'i TAMAMLANMAMIS sayilir —
        // panelde gorunur olmasi sart, aksi halde "yedeklendigini sanan ama
        // yedeklenmeyen musteri" ortaya cikar.
        let backup: { yapilandirildi: boolean; enabled: boolean; lastRunAt: unknown; lastStatus: string | null; remote: string | null } =
          { yapilandirildi: false, enabled: true, lastRunAt: null, lastStatus: null, remote: null };
        try {
          const bSnap = await C.getAdminDb()!.collection('backupConfigs').doc(cid).get();
          if (bSnap.exists) {
            const b = bSnap.data() as Record<string, unknown>;
            const remote = (b.rcloneRemote as string) || '';
            backup = {
              yapilandirildi: !!remote && remote.includes(':'),
              enabled: b.enabled !== false,
              lastRunAt: b.lastRunAt ?? null,
              lastStatus: (b.lastStatus as string) ?? null,
              remote: remote || null,
            };
          }
        } catch { /* ayar okunamadi — yapilandirilmamis say */ }
        return {
          backup,
          companyId: cid,
          companyName: companyName || g.ownerName || g.ownerEmail || cid,
          ownerEmail: g.ownerEmail,
          userCount: g.userCount,
          plan, subStatus, status, cycle, amount,
          nextPaymentDate: nextPaymentDate ?? null,
          lastPaymentDate: lastPaymentDate ?? null,
          createdAt: g.createdAt ?? null,
        };
      }));
      tenants.sort((a, b) => b.userCount - a.userCount);
      return res.json({ tenants, count: tenants.length, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Bir kiracı firmanın durumunu değiştirir (active/suspended) + plan/not. */
  app.post('/api/superadmin/tenants/:companyId/status', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    const { status, note } = (req.body ?? {}) as { status?: string; note?: string };
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'status "active" veya "suspended" olmalı.' });
    }
    try {
      const csPayload: Record<string, unknown> = { status, updatedAt: C.pgServerTimestamp(), updatedBy: C.reqActor(req).email };
      if (note !== undefined) csPayload.note = note; // not yalnız gönderildiğinde yazılır (mevcut notu silme)
      await C.getAdminDb().collection('companyStatus').doc(cid).set(csPayload, { merge: true });
      C.companyStatusCache.set(cid, { status, exp: Date.now() + 60_000 });
      void C.writeAuditLog(C.reqActor(req), `Kiracı firma ${status === 'suspended' ? 'askıya alındı' : 'aktifleştirildi'}`, `companyStatus/${cid}`);
      return res.json({ ok: true, companyId: cid, status });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Bir kiracı firmayı düzenler — plan, durum ve not birlikte güncellenir. */
  const SA_PLANS = new Set(['starter', 'professional', 'business', 'enterprise', 'free']);
  app.post('/api/superadmin/tenants/:companyId/update', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    const { plan, status, note, cycle, nextPaymentDate, profile } = (req.body ?? {}) as
      { plan?: string; status?: string; note?: string; cycle?: string; nextPaymentDate?: string | number | null; profile?: Record<string, unknown> };
    if (plan !== undefined && !SA_PLANS.has(plan)) return res.status(400).json({ error: 'Geçersiz plan.' });
    if (status !== undefined && status !== 'active' && status !== 'suspended') return res.status(400).json({ error: 'Geçersiz durum.' });
    if (cycle !== undefined && cycle !== 'monthly' && cycle !== 'yearly') return res.status(400).json({ error: 'Geçersiz dönem.' });
    try {
      const changes: string[] = [];
      // Firma profili (vergi no/dairesi, iletişim, IBAN, adres) — süper-admin
      // önceden yalnız faturalandırma alanlarını düzenleyebiliyordu (2026-08-17
      // kullanıcı bildirimi: "Firma Bilgileri" salt-okunurdu).
      if (profile && typeof profile === 'object') {
        const PROFILE_FIELDS = ['companyName', 'taxNo', 'taxOffice', 'address', 'email', 'phone', 'iban', 'website'] as const;
        const patch: Record<string, unknown> = {};
        for (const f of PROFILE_FIELDS) {
          if (typeof profile[f] === 'string') patch[f] = (profile[f] as string).slice(0, 500);
        }
        if (Object.keys(patch).length) {
          await C.getAdminDb().collection('settings').doc(`${cid}__companyProfile`).set(
            { ...patch, updatedAt: C.pgServerTimestamp(), updatedBy: C.reqActor(req).email }, { merge: true });
          changes.push('profil');
        }
      }
      // Abonelik alanları (plan / dönem / sonraki ödeme tarihi) tek yazımda
      const subPatch: Record<string, unknown> = {};
      if (plan !== undefined) {
        subPatch.plan = plan; changes.push(`plan=${plan}`);
        // Süper-admin manuel ücretli plan atadığında aboneliği aktif say (MRR'ye dahil).
        subPatch.status = (plan === 'free' || plan === 'enterprise') ? 'none' : 'active';
      }
      if (cycle !== undefined) { subPatch.cycle = cycle; changes.push(`dönem=${cycle}`); }
      if (nextPaymentDate !== undefined) { subPatch.currentPeriodEnd = nextPaymentDate; changes.push('sonraki ödeme'); }
      if (Object.keys(subPatch).length) {
        await C.getAdminDb().collection('subscriptions').doc(cid).set({ ...subPatch, updatedAt: C.pgServerTimestamp(), updatedBy: C.reqActor(req).email }, { merge: true });
      }
      if (status !== undefined || note !== undefined) {
        const payload: Record<string, unknown> = { updatedAt: C.pgServerTimestamp(), updatedBy: C.reqActor(req).email };
        if (status !== undefined) payload.status = status;
        if (note !== undefined) payload.note = note;
        await C.getAdminDb().collection('companyStatus').doc(cid).set(payload, { merge: true });
        if (status !== undefined) { C.companyStatusCache.set(cid, { status, exp: Date.now() + 60_000 }); changes.push(`durum=${status}`); }
      }
      void C.writeAuditLog(C.reqActor(req), 'Kiracı firma düzenlendi', `tenant/${cid} (${changes.join(', ') || 'not'})`);
      return res.json({ ok: true, companyId: cid, plan, status });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Tek bir kiracı firmanın tam detayı — profil, kullanıcılar, faturalandırma, ödeme geçmişi. */
  app.get('/api/superadmin/tenants/:companyId', C.requireAuth, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId);
    try {
      // Profil
      let profile: Record<string, unknown> = {};
      try {
        const ps = await C.getAdminDb().collection('settings').doc(`${cid}__companyProfile`).get();
        if (ps.exists) profile = ps.data() as Record<string, unknown>;
        else { const legacy = await C.getAdminDb().collection('settings').doc('companyProfile').get(); if (legacy.exists) profile = legacy.data() as Record<string, unknown>; }
      } catch { /* ignore */ }

      // Kullanıcılar (companyId == cid veya uid == cid)
      const usersSnap = await C.getAdminDb().collection('users').get();
      const users = usersSnap.docs
        .filter(d => ((d.data().companyId as string) || d.id) === cid)
        .map(d => { const u = d.data() as Record<string, unknown>; return {
          uid: d.id, email: (u.email as string) || '', name: (u.displayName as string) || (u.name as string) || '',
          role: (u.role as string) || 'user', lastLogin: u.lastLogin ?? null, createdAt: u.createdAt ?? null,
        }; });
      const owner = users.find(u => u.uid === cid) || users.find(u => /admin/i.test(u.role)) || users[0] || null;

      // Abonelik / faturalandırma
      let billing: Record<string, unknown> = { plan: 'free', status: 'none', cycle: 'monthly' };
      try {
        const ss = await C.getAdminDb().collection('subscriptions').doc(cid).get();
        if (ss.exists) billing = { ...billing, ...(ss.data() as Record<string, unknown>) };
      } catch { /* ignore */ }
      const plan = String(billing.plan || 'free');
      const cycle = String(billing.cycle || 'monthly');
      billing.amount = (billing.amount as number) ?? planAmount(plan, cycle);
      billing.nextPaymentDate = billing.currentPeriodEnd ?? billing.nextPaymentDate ?? billing.endDate ?? null;
      billing.lastPaymentDate = billing.lastPaymentDate ?? billing.lastPaymentAt ?? billing.lastPayment ?? null;

      // Durum + not
      const csSnap = await C.getAdminDb().collection('companyStatus').doc(cid).get();
      const cs = csSnap.exists ? (csSnap.data() as Record<string, unknown>) : {};
      const status = await C.getCompanyStatus(cid);

      // Ödeme geçmişi (tenantInvoices)
      let invoices: Record<string, unknown>[] = [];
      try {
        const invSnap = await C.getAdminDb().collection('tenantInvoices').where('companyId', '==', cid).get();
        invoices = invSnap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .sort((a, b) => Number((b as { createdMs?: number }).createdMs || 0) - Number((a as { createdMs?: number }).createdMs || 0));
      } catch { /* ignore */ }

      return res.json({
        companyId: cid,
        profile: {
          companyName: profile.companyName || profile.name || '', taxNo: profile.taxNo || '', taxOffice: profile.taxOffice || '',
          address: profile.address || '', email: profile.email || (owner?.email ?? ''), phone: profile.phone || '',
          iban: profile.iban || '', website: profile.website || '',
        },
        owner, users, billing, status, note: cs.note || '',
        invoices,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /** Kiracının bir kullanıcısının rolünü değiştirir. Süper-admin cross-tenant yazdığından
   *  (kendi companyId'si hedef kiracıyla eşleşmez) generic /api/db/:coll/:id yolu
   *  ownsDoc() ile bunu 403'ler — bu yüzden ayrı, dar kapsamlı, requireSuperAdmin ile
   *  korunan bir uç. Hedef kullanıcının GERÇEKTEN bu kiracıya ait olduğu doğrulanır
   *  (URL'den companyId tahmin edip başka kiracının kullanıcısını değiştirme riski).
   */
  app.post('/api/superadmin/tenants/:companyId/users/:uid/role', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId), uid = String(req.params.uid);
    const ROLES = ['Admin', 'Manager', 'Sales', 'Logistics', 'Accounting', 'HR', 'Purchasing', 'B2B', 'Dealer', 'Legal', 'Corporate', 'Quality'];
    const { role } = (req.body ?? {}) as { role?: string };
    if (!role || !ROLES.includes(role)) return res.status(400).json({ error: 'Geçersiz rol.' });
    try {
      const uSnap = await C.getAdminDb().collection('users').doc(uid).get();
      if (!uSnap.exists) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      const u = uSnap.data() as Record<string, unknown>;
      if (((u.companyId as string) || uid) !== cid) return res.status(403).json({ error: 'Kullanıcı bu firmaya ait değil.' });
      await C.getAdminDb().collection('users').doc(uid).set({ role, updatedAt: C.pgServerTimestamp() }, { merge: true });
      void C.writeAuditLog(C.reqActor(req), 'Kiracı kullanıcı rolü değiştirildi', `tenant/${cid} user/${uid} → ${role}`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  /** Kiracının bir kullanıcısını kaldırır (hard delete — mevcut tenant-admin
   *  self-service akışıyla aynı davranış, bkz. AdminPage.tsx deleteDoc). */
  app.post('/api/superadmin/tenants/:companyId/users/:uid/remove', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const cid = String(req.params.companyId), uid = String(req.params.uid);
    try {
      const uSnap = await C.getAdminDb().collection('users').doc(uid).get();
      if (!uSnap.exists) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
      const u = uSnap.data() as Record<string, unknown>;
      if (((u.companyId as string) || uid) !== cid) return res.status(403).json({ error: 'Kullanıcı bu firmaya ait değil.' });
      if (uid === cid) return res.status(400).json({ error: 'Firma sahibi (owner) buradan silinemez.' });
      await C.getAdminDb().collection('users').doc(uid).delete();
      void C.writeAuditLog(C.reqActor(req), 'Kiracı kullanıcısı kaldırıldı', `tenant/${cid} user/${uid} (${u.email as string || ''})`);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  /** Kiracıya süper-admin adına yeni kullanıcı davet eder (davet e-postası + link),
   *  /api/admin/invite'ın cross-tenant karşılığı (o uç yalnız kendi firmasına davet
   *  eder — requireAdmin ile). */
  app.post('/api/superadmin/tenants/:companyId/invite', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    const cid = String(req.params.companyId);
    const { email, role = 'Sales' } = (req.body ?? {}) as { email?: string; role?: string };
    if (!email || !C.isValidEmail(email)) return res.status(400).json({ success: false, error: 'Geçerli e-posta gerekli.' });
    if (!(C.APP_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ success: false, error: `Geçersiz rol. Geçerli roller: ${C.APP_ROLES.join(', ')}` });
    }
    if (!C.getAdminDb()) return res.status(503).json({ success: false, error: 'Firebase Admin unavailable.' });
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await C.getAdminDb().collection('invites').doc(token).set({ companyId: cid, email, role, token, expiresAt, createdAt: C.pgServerTimestamp(), used: false, invitedBySuperAdmin: C.reqActor(req).email });
    } catch (e) { return res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) }); }
    const appUrl = process.env.APP_URL || `https://gen-lang-client-0628151245.web.app`;
    const inviteUrl = `${appUrl}/?invite=${token}`;
    void C.writeAuditLog(C.reqActor(req), 'Kiracıya kullanıcı davet edildi', `tenant/${cid} ${email} (${role})`);
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.json({ success: true, inviteUrl, emailSent: false, note: 'Resend yapılandırılmadı — daveti manuel paylaşın.' });
    try {
      const fromAddress = process.env.RESEND_FROM || 'davet@cetpa.com.tr';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;background:#f5f5f7;margin:0;padding:24px;">
  <div style="max-width:480px;margin:auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#ff4000;padding:28px 32px;"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">CETPA'ya Davet Edildiniz</h1></div>
    <div style="padding:28px 32px;">
      <p style="font-size:14px;color:#1d1d1f;margin:0 0 24px;">CETPA platformuna <strong>${C.escapeHtml(role)}</strong> rolüyle davet edildiniz.</p>
      <a href="${inviteUrl}" style="display:inline-block;background:#ff4000;color:#fff;padding:14px 28px;border-radius:12px;font-weight:700;font-size:14px;text-decoration:none;">Hesap Oluştur</a>
      <p style="font-size:11px;color:#86868b;margin:20px 0 0;">Bu bağlantı 7 gün geçerlidir.</p>
    </div></div></body></html>`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [email], subject: `CETPA'ya Davet Edildiniz — ${role} Rolü`, html }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) return res.json({ success: true, inviteUrl, emailSent: false, note: (d.message as string) || 'Resend API hatası' });
      res.json({ success: true, inviteUrl, emailSent: true, id: d.id });
    } catch (e) {
      res.json({ success: true, inviteUrl, emailSent: false, note: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Kiracıya abonelik ödeme linki oluşturur (iyzico) ve isteğe bağlı e-posta gönderir. */
  app.post('/api/superadmin/tenants/:companyId/payment-link', C.requireAuth, C.requireMfaVerified, C.requireSuperAdmin, async (req: Request, res: Response) => {
    if (!C.getAdminDb()) return res.status(503).json({ error: 'Firebase Admin unavailable.' });
    const creds = await C.getIyzicoCreds();
    if (!creds) return res.status(503).json({ success: false, notConfigured: true, error: 'İyzico yapılandırılmamış (IYZICO_API_KEY).' });
    const cid = String(req.params.companyId);
    const body = (req.body ?? {}) as {
      amount?: number; currency?: string; plan?: string; cycle?: string;
      email?: string; sendEmail?: boolean; description?: string;
    };
    const currency = body.currency || 'TRY';
    try {
      // Plan / dönem / tutar çözümle
      const ss = await C.getAdminDb().collection('subscriptions').doc(cid).get();
      const sub = ss.exists ? (ss.data() as Record<string, unknown>) : {};
      const plan = body.plan || String(sub.plan || 'starter');
      const cycle = body.cycle || String(sub.cycle || 'monthly');
      const amount = Number(body.amount ?? planAmount(plan, cycle));
      if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Geçerli bir tutar gerekli (plan ücretsiz/özel olabilir).' });

      // Profil / e-posta / müşteri adı
      let profile: Record<string, unknown> = {};
      const ps = await C.getAdminDb().collection('settings').doc(`${cid}__companyProfile`).get();
      if (ps.exists) profile = ps.data() as Record<string, unknown>;
      let ownerEmail = body.email || (profile.email as string) || '';
      let customerName = (profile.companyName as string) || '';
      if (!ownerEmail || !customerName) {
        const us = await C.getAdminDb().collection('users').get();
        const mine = us.docs.filter(d => ((d.data().companyId as string) || d.id) === cid).map(d => d.data() as Record<string, unknown>);
        const own = mine.find(u => /admin/i.test(String(u.role))) || mine[0];
        ownerEmail = ownerEmail || (own?.email as string) || '';
        customerName = customerName || (own?.displayName as string) || (own?.name as string) || ownerEmail || cid;
      }
      if (!ownerEmail) return res.status(400).json({ success: false, error: 'Müşteri e-postası bulunamadı; e-posta parametresi gönderin.' });
      if (!C.isValidEmail(ownerEmail)) return res.status(400).json({ success: false, error: 'Geçersiz e-posta adresi.' });

      const invoiceId = `inv_${cid}_${C.randStr().slice(0, 10)}`;
      const amountStr = amount.toFixed(2);
      const nameParts = customerName.trim().split(' ');
      const callbackUrl = `${req.protocol}://${req.get('host')}/payment/result`;
      const planLabel = `Cetpa ${plan.charAt(0).toUpperCase() + plan.slice(1)} (${cycle === 'yearly' ? 'Yıllık' : 'Aylık'})`;

      const iyzBody = {
        locale: 'tr', conversationId: invoiceId, price: amountStr, paidPrice: amountStr, currency,
        basketId: invoiceId, paymentGroup: 'SUBSCRIPTION', callbackUrl,
        buyer: {
          id: cid, name: nameParts[0] || 'Müşteri', surname: nameParts.slice(1).join(' ') || 'Firma',
          email: ownerEmail, identityNumber: (profile.taxNo as string) || '11111111111',
          registrationAddress: (profile.address as string) || 'Türkiye', city: 'İstanbul', country: 'Turkey',
          ip: req.ip || '127.0.0.1', gsmNumber: (profile.phone as string) || '+905000000000',
        },
        shippingAddress: { contactName: customerName, city: 'İstanbul', country: 'Turkey', address: (profile.address as string) || 'Türkiye', zipCode: '34000' },
        billingAddress: { contactName: customerName, city: 'İstanbul', country: 'Turkey', address: (profile.address as string) || 'Türkiye', zipCode: '34000' },
        basketItems: [{ id: invoiceId, name: body.description || planLabel, category1: 'SaaS', itemType: 'VIRTUAL', price: amountStr }],
      };

      const rndStr = C.randStr();
      const pkiStr = C.toPkiString(iyzBody);
      const auth = C.iyzicoAuth(creds, rndStr, pkiStr);
      const r = await fetch(`${creds.baseUrl}/payment/initialize/checkout`, {
        method: 'POST',
        headers: { Authorization: auth, 'x-iyzi-rnd': rndStr, 'Content-Type': 'application/json' },
        body: JSON.stringify(iyzBody), signal: AbortSignal.timeout(15000),
      });
      const d = await r.json() as { status?: string; paymentPageUrl?: string; token?: string; errorMessage?: string };
      const success = d.status === 'success' && !!d.paymentPageUrl;
      if (!success) return res.status(502).json({ success: false, error: d.errorMessage || 'İyzico link oluşturulamadı.' });

      // Faturayı kaydet
      await C.getAdminDb().collection('tenantInvoices').doc(invoiceId).set({
        companyId: cid, plan, cycle, amount, currency,
        paymentPageUrl: d.paymentPageUrl, iyzicoToken: d.token,
        status: 'pending', email: ownerEmail, description: body.description || planLabel,
        sandbox: creds.baseUrl.includes('sandbox'),
        createdAt: C.pgServerTimestamp(), createdMs: Date.now(), createdBy: C.reqActor(req).email,
      });

      // İsteğe bağlı e-posta gönder
      let emailed = false; let emailError: string | undefined;
      if (body.sendEmail) {
        // Kiracı kaynaklı alanlar (customerName) HTML injection'a karşı escape edilir.
        const safeName = C.escapeHtml(customerName);
        const safePlan = C.escapeHtml(planLabel);
        const safeUrl = encodeURI(d.paymentPageUrl || '');
        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#ff4000;margin:0 0 4px">Cetpa Ödeme Bağlantısı</h2>
            <p style="color:#555;font-size:14px">Sayın ${safeName},</p>
            <p style="color:#555;font-size:14px">${safePlan} aboneliğiniz için ödeme bağlantınız hazır:</p>
            <p style="font-size:22px;font-weight:bold;color:#1d1d1f;margin:16px 0">${C.escapeHtml(amountStr)} ${C.escapeHtml(currency)}</p>
            <a href="${safeUrl}" style="display:inline-block;background:#ff4000;color:#fff;text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:bold">Ödemeyi Tamamla</a>
            <p style="color:#999;font-size:12px;margin-top:20px">Bağlantı çalışmıyorsa: <br>${C.escapeHtml(safeUrl)}</p>
          </div>`;
        const er = await C.sendEmail(ownerEmail, `Cetpa Ödeme Bağlantısı — ${amountStr} ${currency}`, html);
        emailed = !er.error;
        if (er.error) emailError = er.error === 'notConfigured' ? 'E-posta servisi yapılandırılmamış (RESEND_API_KEY).' : er.error;
      }

      void C.writeAuditLog(C.reqActor(req), 'Kiracı ödeme linki oluşturuldu', `tenant/${cid} — ${amountStr} ${currency} (${plan}/${cycle})${emailed ? ' + e-posta' : ''}`);
      return res.json({ success: true, paymentPageUrl: d.paymentPageUrl, invoiceId, amount, currency, email: ownerEmail, emailed, emailError });
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  });
}
