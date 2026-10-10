/**
 * sendOutlookEmailAlert
 *
 * Invoked from the WeatherPatterns admin save flow whenever a new outlook is
 * published. It looks up every EmailNotificationPref row whose owner has
 * opted in, filters by their `min_risk_level` threshold against the
 * outlook's `overall_risk` level, and emails the matching users via the
 * authorised Gmail connector.
 *
 * Payload:
 *   {
 *     overall_risk: "Slight" | "Moderate" | "High" | ...,
 *     label, description, peak_window, thunderstorm_overview, isoDate,
 *     region: "uk" | "eu"
 *   }
 *
 * Only admins may invoke this — non-admin calls return 403.
 *
 * Note on Gmail scopes: this function requires the `gmail.send` scope on
 * the connected account. If only `email` was granted at consent time the
 * Gmail API will return 403 INSUFFICIENT_SCOPE; in that case the function
 * still records who *would* have been emailed but reports the scope error
 * back to the caller so the admin can re-authorise.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const RISK_ORDER = ['any', 'Very Low', 'Low', 'Marginal', 'Slight', 'Moderate', 'High', 'Severe'];

function riskMeets(outlookRisk, userMin) {
  if (!userMin || userMin === 'any') return true;
  const oi = RISK_ORDER.indexOf(outlookRisk);
  const mi = RISK_ORDER.indexOf(userMin);
  if (oi < 0 || mi < 0) return false;
  return oi >= mi;
}

// Encode a UTF-8 string to base64url (Gmail's send endpoint requires this).
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMime({ to, fromName, subject, html }) {
  const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  return [
    `From: ${fromName} <me>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function buildHtml(outlook) {
  const date = outlook.isoDate
    ? new Date(outlook.isoDate + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Today';
  const region = outlook.region === 'eu' ? 'Europe' : 'UK & Ireland';
  const overall = outlook.overall_risk || 'New';
  const lines = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:0 auto;background:#0a0f1e;color:#f1f5f9;padding:24px;border-radius:12px">`,
    `<h1 style="margin:0 0 8px;font-size:20px;color:#38bdf8">⚡ ${overall} Risk Outlook — ${region}</h1>`,
    `<p style="margin:0 0 16px;color:#94a3b8;font-size:13px">${date}</p>`,
    outlook.label ? `<p style="margin:0 0 12px;font-size:14px;font-weight:600">${outlook.label}</p>` : '',
    outlook.description ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#cbd5e1">${outlook.description}</p>` : '',
    outlook.peak_window ? `<p style="margin:0 0 8px;font-size:13px"><strong style="color:#38bdf8">Peak window:</strong> ${outlook.peak_window}</p>` : '',
    outlook.thunderstorm_overview ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#fde68a"><strong>⚡ Thunderstorm overview:</strong> ${outlook.thunderstorm_overview}</p>` : '',
    `<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:20px 0" />`,
    `<p style="margin:0;font-size:11px;color:#64748b">You're receiving this because you opted in to MyWeatherUK outlook email alerts. You can change your preferences any time in Settings.</p>`,
    `</div>`,
  ];
  return lines.filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const outlook = await req.json();
    if (!outlook || typeof outlook !== 'object') {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // 1. Find every user who has opted in.
    const allPrefs = await base44.asServiceRole.entities.EmailNotificationPref.filter({ outlook_alerts_enabled: true });
    if (!allPrefs?.length) {
      return Response.json({ ok: true, recipients: 0, message: 'No subscribers' });
    }

    // 2. Apply each user's min-risk threshold.
    const overall = outlook.overall_risk || 'Marginal';
    const matched = allPrefs.filter(p => riskMeets(overall, p.min_risk_level));
    if (!matched.length) {
      return Response.json({ ok: true, recipients: 0, message: `No subscribers want ${overall}-level alerts` });
    }

    // 3. Get the builder's Gmail access token.
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    if (!accessToken) {
      return Response.json({ error: 'Gmail not connected' }, { status: 503 });
    }

    const subject = `⚡ ${overall} Risk Outlook — ${outlook.region === 'eu' ? 'Europe' : 'UK & Ireland'}`;
    const html = buildHtml(outlook);

    // 4. Send one email per recipient (Gmail send endpoint).
    let sent = 0;
    const failures = [];
    for (const pref of matched) {
      const mime = buildMime({ to: pref.user_email, fromName: 'MyWeatherUK', subject, html });
      const raw = b64url(mime);
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
      if (res.ok) {
        sent++;
      } else {
        const err = await res.text().catch(() => '');
        failures.push({ to: pref.user_email, status: res.status, error: err.slice(0, 200) });
        console.error(`[sendOutlookEmailAlert] Gmail send failed for ${pref.user_email}: ${res.status} ${err.slice(0, 300)}`);
        // Stop hammering Gmail if scope is missing — every call will fail the same way.
        if (res.status === 403 && /insufficient|scope/i.test(err)) break;
      }
    }

    return Response.json({
      ok: failures.length === 0,
      recipients: matched.length,
      sent,
      failures: failures.length ? failures : undefined,
    });
  } catch (error) {
    console.error('[sendOutlookEmailAlert] error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});