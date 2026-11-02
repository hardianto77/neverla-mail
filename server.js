import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Transparent Upstream Proxy for Multi-Provider Domains ────────────────
const GRABMAIL_OFFICIAL_DOMAINS = ['grabmail.io', 'linqmail.com', 'mixozia.com'];
const YOPMAIL_DOMAINS = [
  'yopmail.com', 'mynes.com', 'hunnur.com', 'binich.com', 'vitahicks.com',
  'zeropolly.com', 'rodhazlitt.com', 'dripzgaming.com', 'tshirtsavvy.com'
];
const MAILTM_DOMAINS = ['fldubai.com'];

async function fetchFromGrabMail(pathUrl) {
  try {
    const res = await fetch('https://grabmail.io' + pathUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('GrabMail proxy error:', err);
    return null;
  }
}


// Port configurations
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const SMTP_PORT = parseInt(process.env.PORT_SMTP || '2525', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const dbPath = path.join(dataDir, 'mail.db');
const db = new DatabaseSync(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    alias TEXT,
    from_email TEXT NOT NULL,
    from_name TEXT,
    to_email TEXT NOT NULL,
    subject TEXT,
    date TEXT NOT NULL,
    seen INTEGER DEFAULT 0,
    text TEXT,
    text_derived INTEGER DEFAULT 0,
    html TEXT,
    attachments_json TEXT DEFAULT '[]',
    expires_at TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_address ON messages(address);
  CREATE INDEX IF NOT EXISTS idx_messages_alias ON messages(alias);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_msg ON attachments(message_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Prepared statements
const stmtInsertMsg = db.prepare(`
  INSERT INTO messages (id, address, alias, from_email, from_name, to_email, subject, date, seen, text, text_derived, html, attachments_json, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertAtt = db.prepare(`
  INSERT INTO attachments (id, message_id, filename, mime, size, data)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetAtt = db.prepare(`SELECT * FROM attachments WHERE id = ?`);

const stmtGetMsg = db.prepare(`SELECT * FROM messages WHERE id = ?`);

const stmtDeleteMsg = db.prepare(`DELETE FROM messages WHERE id = ?`);
const stmtDeleteAtts = db.prepare(`DELETE FROM attachments WHERE message_id = ?`);

const stmtMarkSeen = db.prepare(`UPDATE messages SET seen = 1 WHERE id = ?`);

// Public & premium domain definitions (Cloned directly from Gmail, GrabMail & Neverla)
const PUBLIC_DOMAINS = ["neverla.web.id", "fldubai.com", "mynes.com", "hunnur.com", "binich.com", "vitahicks.com", "zeropolly.com", "rodhazlitt.com", "dripzgaming.com", "tshirtsavvy.com", "yopmail.com", "gmail.com", "googlemail.com", "grabmail.io", "linqmail.com", "mixozia.com", "devrungkad.biz.id", "zennext.biz.id"];
const ALIAS_DOMAIN = 'uvorion.com';

// Generate Neverla Mail-style random message ID (26 uppercase Crockford-like characters)
function generateMessageId() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.randomBytes(26);
  let id = '';
  for (let i = 0; i < 26; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

// Generate stable alias for an address
function getAliasForAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const normalized = address.trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized + ':neverla-salt').digest('hex');
  const local = hash.slice(0, 12);
  return `${local}@${ALIAS_DOMAIN}`;
}

// Normalize email address
function normalizeEmail(addr) {
  if (!addr || typeof addr !== 'string') return '';
  return addr.trim().toLowerCase();
}

// Strip HTML tags for derived plain text
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 <$1>')
    .replace(/<img\s+(?:[^>]*?\s+)?alt="([^"]*)"[^>]*>/gi, '[$1]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Helper to save incoming email into DB
function saveEmail({ to, from, fromName, subject, text, html, attachments = [] }) {
  const normalizedTo = normalizeEmail(to);
  const now = new Date();
  const dateIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = Math.floor(now.getTime() / 1000);

  // Check if delivery is to an alias
  let targetAddress = normalizedTo;
  let alias = getAliasForAddress(normalizedTo);

  // If received address is an alias, lookup or check
  if (normalizedTo.endsWith(`@${ALIAS_DOMAIN}`)) {
    // Check if any existing message in DB had this alias
    const check = db.prepare(`SELECT address FROM messages WHERE alias = ? LIMIT 1`).get(normalizedTo);
    if (check && check.address) {
      targetAddress = check.address;
    }
  }

  const msgId = generateMessageId();
  let textDerived = 0;
  let finalText = text || '';
  if (!finalText && html) {
    finalText = htmlToPlainText(html);
    textDerived = 1;
  }

  // Process attachments
  const attMetaList = [];
  for (const att of attachments) {
    const attId = 'att_' + crypto.randomBytes(12).toString('hex');
    const filename = att.filename || 'attachment.dat';
    const mime = att.contentType || att.mime || 'application/octet-stream';
    const buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content || '', 'utf-8');
    const size = buffer.length;
    const base64Data = buffer.toString('base64');

    stmtInsertAtt.run(attId, msgId, filename, mime, size, base64Data);

    attMetaList.push({
      id: attId,
      filename,
      mime,
      size,
      url: `/api/v1/attachment/${attId}?address=${encodeURIComponent(targetAddress)}`
    });
  }

  stmtInsertMsg.run(
    msgId,
    targetAddress,
    alias,
    from || 'unknown@example.com',
    fromName || null,
    normalizedTo,
    subject || '(No Subject)',
    dateIso,
    0, // seen = false
    finalText,
    textDerived,
    html || null,
    JSON.stringify(attMetaList),
    expiresIso,
    createdAt
  );

  return { id: msgId, address: targetAddress, alias };
}

// ── Express App Setup ────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// UI renewal header middleware (Neverla Mail protocol)
app.use((req, res, next) => {
  res.setHeader('X-Neverla-UI-Renew', '1');
  res.setHeader('X-RateLimit-Limit', '120');
  res.setHeader('X-RateLimit-Remaining', '119');
  next();
});

// Function to dynamically load templates from disk (Neverla live template pipeline)
const getIndexHtml = () => fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
const getInboxPickHtml = () => fs.readFileSync(path.join(__dirname, 'public', 'inbox.html'), 'utf-8');
const getInboxActiveTemplate = () => fs.readFileSync(path.join(__dirname, 'public', 'inbox_active.html'), 'utf-8');

// ── Web Page Routes ──────────────────────────────────────────────────────────

// Homepage
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(getIndexHtml());
});

// Mailbox Inbox page
app.get('/inbox', (req, res) => {
  const user = req.query.u || req.query.user;
  const domain = req.query.d || req.query.domain;
  const rawAddress = req.query.address || req.query.mailbox;

  let email = '';
  if (user && domain) {
    email = `${user}@${domain}`;
  } else if (rawAddress) {
    email = rawAddress;
  }

  // If no address specified, render the picker view
  if (!email || !email.includes('@')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(getInboxPickHtml());
  }

  const normalized = normalizeEmail(email);
  const [localPart, domainPart] = normalized.split('@');
  const alias = getAliasForAddress(normalized);

  // Render active mailbox template
  let rendered = getInboxActiveTemplate()
    .replace(/data-address="[^"]*"/g, `data-address="${normalized}"`)
    .replace(/data-domain="[^"]*"/g, `data-domain="${domainPart}"`)
    .replace(/data-address-text>([^<]*)<\/span>/g, `data-address-text>${normalized}</span>`)
    .replace(/<p class="ibx-mini-addr">[^<]*<\/p>/g, `<p class="ibx-mini-addr">${normalized}</p>`)
    .replace(/<title>[^<]*<\/title>/g, `<title>${normalized} — inbox — Neverla Mail</title>`)
    .replace(/data-alias-text>[^<]*<\/code>/g, `data-alias-text>${alias}</code>`)
    .replace(/data-copy-text="[^"]*"/g, `data-copy-text="${alias}"`)
    .replace(/<strong>[^<]*<\/strong> is a public domain/g, `<strong>${domainPart}</strong> is a public domain`)
    .replace(/Send anything to <code>[^<]*<\/code>/g, `Send anything to <code>${normalized}</code>`)
    .replace(/id="gm-user" data-user\s+value="[^"]*"/g, `id="gm-user" data-user value="${localPart}"`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(rendered);
});

// Direct address URL route: /inbox/test@mail.neverla.web.id
app.get('/inbox/:address', (req, res) => {
  const address = req.params.address;
  if (!address || !address.includes('@')) {
    return res.redirect('/inbox');
  }
  const [u, d] = address.split('@');
  res.redirect(`/inbox?u=${encodeURIComponent(u)}&d=${encodeURIComponent(d)}`);
});

// Docs, Domains, Pricing, Guides, Comparisons, OpenAPI, llms.txt
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));
app.get('/docs/api', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs-api.html')));
app.get('/docs/quickstart', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs-quickstart.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/domains', (req, res) => res.sendFile(path.join(__dirname, 'public', 'domains.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));
app.get('/openapi.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'openapi.json')));
app.get('/llms.txt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'llms.txt')));

// Guides
app.get('/guides/own-domain-catch-all-inbox', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guides-own-domain.html')));
app.get('/guides/temp-mail-for-ai-agents', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guides-ai-agents.html')));
app.get('/guides/nodejs-temp-mail-api', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guides-nodejs.html')));
app.get('/guides/python-disposable-email-api', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guides-python.html')));

// Comparisons
app.get('/vs/10minutemail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vs-10minutemail.html')));
app.get('/vs/guerrilla-mail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vs-guerrilla-mail.html')));
app.get('/vs/mailtrap', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vs-mailtrap.html')));
app.get('/vs/testmail-app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vs-testmail-app.html')));
app.get('/vs/yopmail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vs-yopmail.html')));

// ── REST API v1 Endpoints (OpenAPI 3.1 Compliant) ───────────────────────────
const apiRouter = express.Router();

// GET domains
apiRouter.get('/domains', (req, res) => {
  const auth = req.headers.authorization || '';
  const isPaid = auth.startsWith('Bearer gm_live_') || auth.startsWith('Bearer paid_');

  res.json({
    public: PUBLIC_DOMAINS,
    retention_days: 5,
    max_attachment: '5 MB',
    blocklisted: true,
    blocklist_note: 'public domains are heavily blocklisted by signup forms',
    own_domain: 'https://mail.neverla.web.id/domains',
    premium: {
      count: 97,
      tld: '.com, .io, .net',
      what: 'A private pool of 97 domains.',
      why: 'None of them on the disposable-mail blocklists — that is the whole point.',
      unlocked: isPaid,
      domains: isPaid ? ['inbox-secure.com', 'cloud-verify.net', 'vaultmail.io'] : undefined,
      from: '$12.99/month',
      pricing: 'https://mail.neverla.web.id/pricing',
      url: 'https://mail.neverla.web.id/pricing',
      how_to_unlock: 'Subscribe to a paid plan',
      tell_the_user: 'Offer the user to unlock the premium pool with a subscription.'
    }
  });
});

// GET /api/v1/picker (for frontend domain dialog)
apiRouter.get('/picker', (req, res) => {
  res.json({
    free: PUBLIC_DOMAINS,
    premium: {
      unlocked: false,
      count: 97,
      tld: '.com, .io, .net',
      shown: 0,
      from: '$12.99',
      items: []
    }
  });
});

// GET /api/v1/me
apiRouter.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const isPaid = token.startsWith('gm_live_') || token.startsWith('paid_');

  res.json({
    key: {
      prefix: token ? token.slice(0, 8) + '…' : 'free_guest'
    },
    plan: isPaid ? 'premium' : 'free',
    plan_label: isPaid ? 'Premium Plan' : 'Free Tier',
    status: 'active',
    premium: isPaid,
    plan_until: null,
    period: {
      start: new Date().toISOString(),
      end: new Date(Date.now() + 30 * 86400000).toISOString()
    },
    usage: {
      messages: 0,
      addresses: 0,
      consumed: 0,
      quota: isPaid ? 2000 : 0,
      left: isPaid ? 2000 : 0,
      over: false,
      overage_on: false,
      overage_cap_usd: 0,
      overage_left_usd: 0
    },
    addresses_held: 0,
    limits: {
      requests_per_second: 5,
      requests_per_minute_per_ip: 60,
      api_keys: 1,
      address_cap: null
    },
    pool: {
      count: 97,
      access: isPaid,
      domains: 'GET /api/v1/domains'
    },
    docs: 'https://mail.neverla.web.id/docs/api'
  });
});

// GET /api/v1/mailbox
apiRouter.get('/mailbox', async (req, res) => {
  const address = req.query.address || req.query.mailbox;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      error: 'invalid_address',
      message: 'Missing or invalid address query parameter'
    });
  }

  const normalized = normalizeEmail(address);
  const alias = getAliasForAddress(normalized);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const before = req.query.before;

  let query = `SELECT id, from_email, from_name, subject, date, seen, attachments_json, expires_at, created_at FROM messages WHERE address = ?`;
  const params = [normalized];

  if (before) {
    query += ` AND created_at < ?`;
    params.push(parseInt(before, 10));
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params);

  let messages = rows.map(r => {
    let attCount = 0;
    try {
      const atts = JSON.parse(r.attachments_json || '[]');
      attCount = Array.isArray(atts) ? atts.length : 0;
    } catch {
      attCount = 0;
    }

    return {
      id: r.id,
      from: r.from_email,
      from_name: r.from_name,
      subject: r.subject,
      date: r.date,
      seen: Boolean(r.seen),
      attachments: attCount,
      expires_at: r.expires_at
    };
  });

  // If address belongs to official GrabMail domains, transparently fetch live emails from GrabMail server!
  const domainPart = normalized.split('@')[1] || '';
  if (GRABMAIL_OFFICIAL_DOMAINS.includes(domainPart)) {
    try {
      const upstream = await fetchFromGrabMail('/api/v1/mailbox?address=' + encodeURIComponent(normalized));
      if (upstream && Array.isArray(upstream.messages) && upstream.messages.length > 0) {
        // Merge upstream messages, avoiding duplicates by id
        const localIds = new Set(messages.map(m => m.id));
        for (const um of upstream.messages) {
          if (!localIds.has(um.id)) {
            messages.push(um);
          }
        }
      }
    } catch (e) {
      console.error('Failed to sync upstream GrabMail messages:', e);
    }
  }

  const nextCursor = rows.length === limit ? String(rows[rows.length - 1].created_at) : null;

  res.json({
    address: normalized,
    alias: alias,
    count: messages.length,
    next: nextCursor,
    messages
  });
});

// GET /api/v1/message/:id

// GET /api/v1/message/:id/body - Render clean email HTML body inside iframe
apiRouter.get('/message/:id/body', (req, res) => {
  const id = req.params.id;
  const row = stmtGetMsg.get(id);
  if (!row) {
    return res.status(404).send('Message not found');
  }

  let htmlContent = row.html || '';
  if (!htmlContent && row.text) {
    // Escape plain text and wrap nicely
    const escaped = row.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    htmlContent = `<pre style="font-family: inherit; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: #1e293b; margin: 0; padding: 16px;">${escaped}</pre>`;
  }

  // Clean, stable email HTML document with single-shot safe height reporting
  const wrappedHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *:before, *:after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #1e293b;
    overflow-x: hidden;
  }
  body {
    padding: 16px;
    overflow-y: hidden;
  }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; width: 100% !important; }
  pre, code { white-space: pre-wrap; word-break: break-word; font-family: monospace; }
  a { color: #0c2340; }
</style>
<script>
  (function() {
    var reported = 0;
    function sendHeight() {
      try {
        var h = document.body ? document.body.offsetHeight : 0;
        if (h > 50 && Math.abs(h - reported) > 10) {
          reported = h;
          window.parent.postMessage({ gm: 'height', h: Math.ceil(h + 20) }, '*');
        }
      } catch(e) {}
    }
    window.addEventListener('load', function() {
      setTimeout(sendHeight, 100);
    });
    setTimeout(sendHeight, 300);
  })();
</script>
</head>
<body>
${htmlContent}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(wrappedHtml);
});

apiRouter.get('/message/:id', async (req, res) => {
  const id = req.params.id;
  const address = req.query.address || req.query.mailbox;

  let row = stmtGetMsg.get(id);
  if (!row) {
    // If not found locally, try fetching directly from upstream GrabMail!
    try {
      const upstreamMsg = await fetchFromGrabMail('/api/v1/message/' + encodeURIComponent(id) + (address ? '?address=' + encodeURIComponent(address) : ''));
      if (upstreamMsg && upstreamMsg.id) {
        return res.json(upstreamMsg);
      }
    } catch (err) {
      console.error('Failed to fetch message from upstream GrabMail:', err);
    }

    return res.status(404).json({
      error: 'not_found',
      message: 'No such message in that mailbox, or it has expired.'
    });
  }

  // Mark as seen
  stmtMarkSeen.run(id);

  let attList = [];
  try {
    attList = JSON.parse(row.attachments_json || '[]');
  } catch {
    attList = [];
  }

  res.json({
    id: row.id,
    from: row.from_email,
    from_name: row.from_name,
    to: row.to_email,
    subject: row.subject,
    date: row.date,
    seen: true,
    text: row.text,
    text_derived: Boolean(row.text_derived),
    html: row.html,
    attachments: attList,
    expires_at: row.expires_at
  });
});

// DELETE /api/v1/message/:id
apiRouter.delete('/message/:id', (req, res) => {
  const id = req.params.id;
  stmtDeleteMsg.run(id);
  stmtDeleteAtts.run(id);
  res.json({ ok: true, deleted: true });
});

// GET /api/v1/attachment/:id
apiRouter.get('/attachment/:id', (req, res) => {
  const id = req.params.id;
  const row = stmtGetAtt.get(id);
  if (!row) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No such attachment in that mailbox.'
    });
  }

  const buffer = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// ── Inbound & Simulation Endpoints ──────────────────────────────────────────

// POST /api/v1/simulate-email or /api/v1/send-test
apiRouter.post(['/simulate-email', '/send-test'], (req, res) => {
  const { to, from, from_name, subject, text, html, attachments } = req.body;
  if (!to) {
    return res.status(400).json({ error: 'invalid_address', message: 'Field "to" is required' });
  }

  const result = saveEmail({
    to,
    from: from || 'noreply@verify.service.com',
    fromName: from_name || 'Verification Service',
    subject: subject || 'Your single-use confirmation code: ' + Math.floor(100000 + Math.random() * 900000),
    text: text || `Hello,\n\nYour confirmation code is: ${Math.floor(100000 + Math.random() * 900000)}\n\nThis code expires in 10 minutes.\n\nThanks,\nVerification Team`,
    html: html || `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
      <h2>Confirm your email</h2>
      <p>Your one-time code is:</p>
      <div style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#2563eb;margin:16px 0;">${Math.floor(100000 + Math.random() * 900000)}</div>
      <p style="color:#64748b;font-size:14px;">If you did not request this, please ignore this email.</p>
    </div>`,
    attachments: attachments || []
  });

  res.json({ ok: true, message: 'Email saved and delivered to mailbox', ...result });
});

// POST /api/v1/inbound (Generic webhook for Cloudflare Email Routing / Sendgrid / Mailgun)
apiRouter.post('/inbound', (req, res) => {
  const body = req.body;
  const to = body.to || body.recipient;
  const from = body.from || body.sender;
  const subject = body.subject || '(No Subject)';
  const text = body.text || body['body-plain'];
  const html = body.html || body['body-html'];

  if (!to) {
    return res.status(400).json({ error: 'missing_recipient' });
  }

  const result = saveEmail({ to, from, subject, text, html });
  res.json({ ok: true, id: result.id });
});

// POST /api/v1/auth (Graceful mock for auth modal actions)
apiRouter.post('/auth', (req, res) => {
  const { action } = req.body;
  if (action === 'signout') {
    return res.json({ ok: true });
  }
  if (action === 'signin' || action === 'signup') {
    return res.json({
      ok: true,
      user: { email: req.body.email || 'user@example.com' },
      redirect: req.body.next || '/inbox'
    });
  }
  res.json({ ok: true });
});

// POST /api/v1/account (Graceful handler for star, history, etc.)
apiRouter.post('/account', (req, res) => {
  res.json({ ok: true, items: [] });
});

app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request' } });
  }

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'grabmail-mcp', version: '1.0.0' }
      }
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'create_inbox',
            description: 'Generate a random or specified disposable email address',
            inputSchema: {
              type: 'object',
              properties: {
                user: { type: 'string', description: 'Desired username/prefix' },
                domain: { type: 'string', description: 'Domain name' }
              }
            }
          },
          {
            name: 'list_domains',
            description: 'List public domains available for disposable email',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'list_messages',
            description: 'List messages in a disposable mailbox',
            inputSchema: {
              type: 'object',
              properties: {
                address: { type: 'string', description: 'Full email address' },
                limit: { type: 'integer', description: 'Max messages to return' }
              },
              required: ['address']
            }
          },
          {
            name: 'read_message',
            description: 'Read the full content of an email message',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Message ID' },
                address: { type: 'string', description: 'Mailbox address' }
              },
              required: ['id']
            }
          },
          {
            name: 'delete_message',
            description: 'Delete a message from a mailbox',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Message ID' }
              },
              required: ['id']
            }
          },
          {
            name: 'wait_for_message',
            description: 'Poll until a new message arrives at the specified mailbox address',
            inputSchema: {
              type: 'object',
              properties: {
                address: { type: 'string', description: 'Mailbox email address' },
                timeout_seconds: { type: 'integer', description: 'Max wait time in seconds (default 30)' }
              },
              required: ['address']
            }
          }
        ]
      }
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'list_domains') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ domains: PUBLIC_DOMAINS }) }]
        }
      });
    }

    if (toolName === 'create_inbox') {
      const user = args.user || Math.random().toString(36).substring(2, 10);
      const domain = args.domain || PUBLIC_DOMAINS[0];
      const address = `${user}@${domain}`.toLowerCase();
      const alias = getAliasForAddress(address);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ address, alias, domain, user }) }]
        }
      });
    }

    if (toolName === 'list_messages') {
      const address = normalizeEmail(args.address || '');
      const rows = db.prepare('SELECT id, from_email, from_name, subject, date, seen FROM messages WHERE address = ? ORDER BY created_at DESC LIMIT ?').all(address, args.limit || 50);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ address, messages: rows }) }]
        }
      });
    }

    if (toolName === 'read_message') {
      const msgId = args.id;
      const row = stmtGetMsg.get(msgId);
      if (!row) {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: 'Message not found or expired' }] }
        });
      }
      stmtMarkSeen.run(msgId);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: row.id,
              from: row.from_email,
              from_name: row.from_name,
              to: row.to_email,
              subject: row.subject,
              date: row.date,
              text: row.text,
              html: row.html
            })
          }]
        }
      });
    }

    if (toolName === 'delete_message') {
      stmtDeleteMsg.run(args.id);
      stmtDeleteAtts.run(args.id);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted: args.id }) }] }
      });
    }

    if (toolName === 'wait_for_message') {
      const address = normalizeEmail(args.address || '');
      const timeoutSec = Math.min(60, Math.max(2, args.timeout_seconds || 15));
      const startCheck = Math.floor(Date.now() / 1000);

      let elapsed = 0;
      const interval = setInterval(() => {
        const found = db.prepare('SELECT id, from_email, from_name, subject, date, text FROM messages WHERE address = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1').get(address, startCheck);
        elapsed += 2;
        if (found) {
          clearInterval(interval);
          return res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify({ status: 'received', message: found }) }] }
          });
        }
        if (elapsed >= timeoutSec) {
          clearInterval(interval);
          return res.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify({ status: 'timeout', message: null }) }] }
          });
        }
      }, 2000);
      return;
    }

    return res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Tool ${toolName} not found` } });
  }

  res.status(404).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

// Mount API router across multiple prefixes
app.use('/api/v1', apiRouter);
app.use('/v1', apiRouter);
app.use('/gm-api/v1', apiRouter);

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// 404 handler for API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found' });
});

// Fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start HTTP Server
const server = app.listen(HTTP_PORT, HOST, () => {
  console.log(`[Neverla Mail HTTP] Server running on http://${HOST}:${HTTP_PORT}`);
});

// ── Embedded SMTP Server (Receives Real Mail on SMTP_PORT) ──────────────────
try {
  const smtp = new SMTPServer({
    secure: false,
    disabledCommands: ['AUTH'],
    size: 5 * 1024 * 1024, // 5 MB limit (exact Neverla Mail specification)
    onData(stream, session, callback) {
      simpleParser(stream, (err, parsed) => {
        if (err) {
          console.error('[SMTP] Parser error:', err);
          return callback(err);
        }

        const recipients = session.envelope.rcptTo.map(r => r.address);
        for (const rcpt of recipients) {
          try {
            saveEmail({
              to: rcpt,
              from: session.envelope.mailFrom.address || parsed.from?.text || 'unknown@domain.com',
              fromName: parsed.from?.value?.[0]?.name || null,
              subject: parsed.subject,
              text: parsed.text,
              html: parsed.html,
              attachments: parsed.attachments?.map(a => ({
                filename: a.filename,
                contentType: a.contentType,
                content: a.content
              })) || []
            });
            console.log(`[SMTP] Inbound email received for ${rcpt}: "${parsed.subject}"`);
          } catch (e) {
            console.error('[SMTP] Error saving email:', e);
          }
        }
        callback();
      });
    }
  });

  smtp.listen(SMTP_PORT, HOST, () => {
    console.log(`[Neverla Mail SMTP] Inbound mail server listening on port ${SMTP_PORT}`);
  });

  smtp.on('error', err => {
    console.warn(`[Neverla Mail SMTP] Notice: ${err.message} (Run with proper privileges if port < 1024)`);
  });
} catch (err) {
  console.warn('[Neverla Mail SMTP] Notice: Embedded SMTP server skipped:', err.message);
}
