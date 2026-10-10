import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Permanently deletes the authenticated user's account and all associated data.
// Required for iOS App Store compliance (account deletion must be available in-app).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = user.email;
    const removed = { subscriptions: 0, notificationPrefs: 0, accessCodes: 0 };

    // ── Clean up related records owned by this user (service role) ──
    try {
      const subs = await base44.asServiceRole.entities.UserSubscription.filter({ user_email: email });
      for (const s of subs) {
        await base44.asServiceRole.entities.UserSubscription.delete(s.id);
        removed.subscriptions++;
      }
    } catch (e) {
      console.warn('deleteAccount: subscription cleanup failed:', e?.message);
    }

    try {
      const prefs = await base44.asServiceRole.entities.EmailNotificationPref.filter({ user_email: email });
      for (const p of prefs) {
        await base44.asServiceRole.entities.EmailNotificationPref.delete(p.id);
        removed.notificationPrefs++;
      }
    } catch (e) {
      console.warn('deleteAccount: notification pref cleanup failed:', e?.message);
    }

    try {
      const codes = await base44.asServiceRole.entities.SiteAccessCode.filter({ email });
      for (const c of codes) {
        await base44.asServiceRole.entities.SiteAccessCode.delete(c.id);
        removed.accessCodes++;
      }
    } catch (e) {
      console.warn('deleteAccount: access code cleanup failed:', e?.message);
    }

    // ── Finally delete the user account itself ──
    await base44.asServiceRole.entities.User.delete(user.id);

    console.log('deleteAccount: removed user', user.id, JSON.stringify(removed));
    return Response.json({ success: true, removed });
  } catch (error) {
    console.error('deleteAccount error:', error?.message, error?.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});