/**
 * Local implementations of the Base44 "Core" integrations.
 *
 * Base44 ran these server-side on the builder's behalf with its own provider
 * accounts. Self-hosted there is no such account, so each one runs against a
 * provider you configure in .env and returns a clear, actionable error when
 * nothing is configured. Both are optional: the site works without them, it
 * just loses the AI forecast fallback and outbound email.
 *
 *   InvokeLLM  -> Anthropic Claude   (ANTHROPIC_API_KEY)
 *   SendEmail  -> SMTP via nodemailer (SMTP_HOST / SMTP_USER / SMTP_PASS ...)
 *
 * Both dependencies are imported lazily so the server starts fine when neither
 * is installed.
 */

const LLM_MODEL = process.env.LLM_MODEL || 'claude-opus-5';

class NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.status = 503;
  }
}

/* ── InvokeLLM ─────────────────────────────────────────────────────────────
 * The app calls this as
 *   InvokeLLM({ prompt, response_json_schema, add_context_from_internet?, model? })
 * and expects the parsed JSON object back — not a wrapper, not a string. The
 * `model` the app passes is a Base44 alias (e.g. 'gemini_3_1_pro'); it is
 * ignored here in favour of LLM_MODEL, since the alias means nothing to a
 * different provider.
 */

let anthropicClient;

async function getAnthropic() {
  if (anthropicClient !== undefined) return anthropicClient;
  if (!process.env.ANTHROPIC_API_KEY) {
    anthropicClient = null;
    return null;
  }
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
  } catch (err) {
    throw new NotConfiguredError(
      `ANTHROPIC_API_KEY is set but the SDK is missing — run: npm install @anthropic-ai/sdk (${err.message})`
    );
  }
  return anthropicClient;
}

/** Pull the first JSON object out of a text reply, tolerating code fences. */
function parseJsonFromText(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost braces, in case the model wrapped the object
    // in a sentence.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* give up below */
      }
    }
  }
  return null;
}

export async function invokeLLM(params = {}) {
  const { prompt, response_json_schema: schema, add_context_from_internet: useWeb } = params;

  if (!prompt) throw Object.assign(new Error('InvokeLLM requires a prompt'), { status: 400 });

  const client = await getAnthropic();
  if (!client) {
    throw new NotConfiguredError(
      'InvokeLLM is not configured on this server. Set ANTHROPIC_API_KEY in .env ' +
        'to enable the AI forecast fallback, or leave it unset — the site works without it.'
    );
  }

  // Two shapes, because they can't be combined: forcing a tool call is the
  // reliable way to get schema-shaped JSON, but a forced tool call leaves no
  // room for the model to search the web first.
  if (schema && !useWeb) {
    const message = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          name: 'emit_result',
          description: 'Return the requested result in the required shape.',
          input_schema: schema,
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_result' },
    });
    const call = message.content.find((block) => block.type === 'tool_use');
    if (!call) throw new Error('Model returned no structured result');
    return call.input;
  }

  const message = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: schema
          ? `${prompt}\n\nReply with a single JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`
          : prompt,
      },
    ],
    ...(useWeb
      ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] }
      : {}),
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!schema) return { text };

  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error('Model reply was not valid JSON');
  return parsed;
}

/* ── SendEmail ─────────────────────────────────────────────────────────────
 * Called as SendEmail({ to, subject, body }) — Base44 also accepted `html`.
 */

let transport;

async function getTransport() {
  if (transport !== undefined) return transport;
  if (!process.env.SMTP_HOST) {
    transport = null;
    return null;
  }
  try {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } catch (err) {
    throw new NotConfiguredError(
      `SMTP_HOST is set but nodemailer is missing — run: npm install nodemailer (${err.message})`
    );
  }
  return transport;
}

export async function sendEmail(params = {}) {
  const { to, subject, body, html, from } = params;
  if (!to) throw Object.assign(new Error('SendEmail requires a recipient'), { status: 400 });

  const mailer = await getTransport();
  if (!mailer) {
    // Not an error the user can act on mid-request, and losing a notification
    // should never fail the operation that triggered it. Log and report.
    console.warn(`[SendEmail] no SMTP configured — dropped mail to ${to}: ${subject || ''}`);
    return { ok: false, delivered: false, reason: 'SMTP is not configured on this server' };
  }

  const info = await mailer.sendMail({
    from: from || process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: subject || '',
    text: body || undefined,
    html: html || undefined,
  });
  return { ok: true, delivered: true, messageId: info.messageId };
}

export default { invokeLLM, sendEmail };
