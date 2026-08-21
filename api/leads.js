import { createHash } from 'node:crypto';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const reply = (res, status, body) => {
  Object.entries(JSON_HEADERS).forEach(([name, value]) => res.setHeader(name, value));
  return res.status(status).json(body);
};

const clean = (value, max) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max);
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  return clean(Array.isArray(forwarded) ? forwarded[0] : (forwarded || '').split(',')[0], 100)
    || clean(req.headers['x-real-ip'], 100)
    || 'unknown';
};

const isSyntheticSubmission = (source) => /^codex-e2e(?:-|$)/i.test(source || '');

const supabaseRequest = async (path, options = {}) => {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET;
  if (!baseUrl || !serviceKey) throw new Error('Server configuration is incomplete');

  return fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
};

const sendLeadPushNotification = async ({ name, phone, message }) => {
  const baseUrl = process.env.PUSH_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.PUSH_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET;
  if (!baseUrl || !serviceKey) throw new Error('Push configuration is incomplete');

  const messagePreview = message
    ? ` — ${message.replace(/\s+/g, ' ').slice(0, 100)}`
    : '';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/functions/v1/push-notifications`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'event',
      eventKey: 'landing_page_lead',
      payload: {
        title: 'ליד חדש מהאתר',
        body: `${name} · ${phone}${messagePreview}`,
        // Unlisted admin origin; kept out of the repo so the URL is not published.
        url: `${(process.env.ADMIN_BASE_URL || '').replace(/\/$/, '')}/admin/landing-page-leads`,
        tag: `landing-page-lead-${Date.now()}`,
        requireInteraction: true,
        renotify: true,
      },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Push notification failed (${response.status})`);
  }
};

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const sendLeadEmail = async ({ name, phone, message, source, page_url, locale }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const notificationEmail = process.env.LEAD_NOTIFICATION_EMAIL;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || notificationEmail;
  if (!apiKey || !senderEmail || !notificationEmail) {
    throw new Error('Brevo configuration is incomplete');
  }

  const normalizedPhone = phone.replace(/[^\d+]/g, '');
  const displaySource = source || 'landing-page';
  const displayLocale = locale || '—';
  const submittedAt = new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date());
  const escapedMessage = message
    ? escapeHtml(message).replace(/\n/g, '<br>')
    : 'לא צורפה הודעה';

  const html = `
    <div dir="rtl" style="margin:0;background:#f5f4ef;padding:24px 12px;font-family:Arial,'Helvetica Neue',sans-serif;color:#171714">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e0d6;border-radius:8px;overflow:hidden">
        <div style="padding:22px 22px 10px;border-bottom:1px solid #eee8dd">
          <div style="margin:0 0 10px;color:#687064;font-size:13px;font-weight:700;letter-spacing:.2px">ליד חדש מהאתר</div>
          <h1 style="margin:0;color:#171714;font-size:26px;line-height:1.25;font-weight:800">${escapeHtml(name)}</h1>
          <a href="tel:${escapeHtml(normalizedPhone)}" style="display:inline-block;margin-top:12px;color:#171714;font-size:22px;line-height:1.2;font-weight:800;text-decoration:none;direction:ltr">${escapeHtml(phone)}</a>
        </div>

        <div style="padding:20px 22px">
          <div style="margin:0 0 8px;color:#687064;font-size:13px;font-weight:700">מה צריך</div>
          <div style="margin:0 0 22px;padding:16px;background:#faf8f3;border:1px solid #eee8dd;border-radius:8px;color:#171714;font-size:17px;line-height:1.65">${escapedMessage}</div>

          <div style="margin:0 0 22px">
            <a href="tel:${escapeHtml(normalizedPhone)}" style="display:inline-block;margin:0 0 10px;padding:13px 18px;background:#171714;border-radius:7px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none">התקשר עכשיו</a>
            ${page_url ? `<a href="${escapeHtml(page_url)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 16px;background:#ffffff;border:1px solid #d8d1c4;border-radius:7px;color:#171714;font-size:16px;font-weight:700;text-decoration:none">פתח מקור ליד</a>` : ''}
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;color:#5d6259;font-size:14px;line-height:1.5">
            <tr>
              <td style="padding:6px 0;font-weight:700;color:#171714">מקור</td>
              <td style="padding:6px 0;text-align:left;direction:ltr">${escapeHtml(displaySource)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-weight:700;color:#171714">שפה</td>
              <td style="padding:6px 0;text-align:left;direction:ltr">${escapeHtml(displayLocale)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-weight:700;color:#171714">נשלח</td>
              <td style="padding:6px 0;text-align:left;direction:ltr">${escapeHtml(submittedAt)}</td>
            </tr>
          </table>
        </div>
      </div>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Itay Karkason',
        email: senderEmail,
      },
      replyTo: {
        name: process.env.BREVO_REPLY_TO_NAME || 'Itay Karkason',
        email: process.env.BREVO_REPLY_TO_EMAIL || notificationEmail,
      },
      to: [{ email: notificationEmail }],
      subject: `ליד חדש מהאתר — ${name}`,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Brevo email failed (${response.status})`);
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 12_000) return reply(res, 413, { ok: false, error: 'Request too large' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (clean(body.company, 200)) return reply(res, 200, { ok: true });

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const digits = phone.replace(/\D/g, '');
  if (!name || digits.length < 7) {
    return reply(res, 400, { ok: false, error: 'Name and phone are required' });
  }

  const ipHash = createHash('sha256')
    .update(`${getClientIp(req)}:${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET || ''}`)
    .digest('hex');

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const countResponse = await supabaseRequest(
      `landing_leads?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(tenMinutesAgo)}`,
      { headers: { Prefer: 'count=exact', Range: '0-0' } },
    );
    const contentRange = countResponse.headers.get('content-range') || '';
    const recentCount = Number(contentRange.split('/')[1] || 0);
    if (countResponse.ok && recentCount >= 5) {
      return reply(res, 429, { ok: false, error: 'Too many requests' });
    }

    const record = {
      name,
      phone,
      message: clean(body.message, 2000) || null,
      source: clean(body.source, 500) || 'landing-page',
      page_url: clean(body.page_url, 1000) || null,
      referrer: clean(body.referrer, 1000) || null,
      utm_source: clean(body.utm_source, 200) || null,
      utm_medium: clean(body.utm_medium, 200) || null,
      utm_campaign: clean(body.utm_campaign, 200) || null,
      locale: clean(body.locale, 16) || null,
      ip_hash: ipHash,
    };

    const insertResponse = await supabaseRequest('landing_leads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(record),
    });
    if (!insertResponse.ok) throw new Error(`Database insert failed (${insertResponse.status})`);

    const notifications = isSyntheticSubmission(record.source)
      ? []
      : [sendLeadPushNotification(record), sendLeadEmail(record)];
    const [pushResult, emailResult] = await Promise.allSettled(notifications);

    if (pushResult?.status === 'rejected') {
      console.error(
        'Lead saved but push notification failed',
        pushResult.reason instanceof Error ? pushResult.reason.message : 'Unknown error',
      );
    }

    if (emailResult?.status === 'rejected') {
      console.error(
        'Lead saved but email notification failed',
        emailResult.reason instanceof Error ? emailResult.reason.message : 'Unknown error',
      );
    }

    return reply(res, 201, { ok: true });
  } catch (error) {
    console.error('Lead submission failed', error instanceof Error ? error.message : 'Unknown error');
    return reply(res, 500, { ok: false, error: 'Unable to save lead' });
  }
}
