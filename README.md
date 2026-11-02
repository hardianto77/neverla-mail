# Neverla Mail

> **Next-Generation High-Performance Disposable Temp Mail Engine & Keyless REST API / MCP Protocol**  
> Live Service: [https://mail.neverla.web.id](https://mail.neverla.web.id)

---

## 🌟 Overview

**Neverla Mail** is a modern, privacy-focused temporary disposable email service inspired by the GrabMail architecture. It operates with a **zero-registration, zero-friction, keyless architecture** over public domains, paired with a built-in high-performance Node.js SMTP server, an SQLite-backed storage engine, dynamic mobile-responsive web interfaces, and dual-layer AI integration (REST API & MCP Protocol).

### Key Highlights
- **18+ Active Inbound Domains**: Full native support for fresh `.com` domains (`fldubai.com`, `mynes.com`, `hunnur.com`, `binich.com`, `vitahicks.com`, `zeropolly.com`, `rodhazlitt.com`, `dripzgaming.com`, `tshirtsavvy.com`, `yopmail.com`), classic providers (`gmail.com`, `googlemail.com`, `grabmail.io`, `linqmail.com`, `mixozia.com`), and dedicated infrastructure (`neverla.web.id`, `devrungkad.biz.id`, `zennext.biz.id`).
- **Keyless Public REST API**: Instant programmatic integration without signup, registration tokens, or API keys for public domains.
- **AI Model Context Protocol (MCP)**: Native `/mcp` JSON-RPC 2.0 endpoint providing tools for automated inbox generation, code extraction, and message polling.
- **Transparent Multi-Provider Inbound Routing**: Real-time sync and transparent proxying for multi-provider upstream domains.
- **Deep Navy Architectural Identity**: Consistent, responsive UI styled in dark navy (`#0C2340` / `#071529`) with zero-jitter full-screen mobile message inspection sheets.
- **Anti-Spam & Auto-Pruning**: Messages auto-expire after 5 days with atomic retention cleanup jobs.

---

## 🚀 Live API Reference

### Base URL
```http
https://mail.neverla.web.id/v1
```
*(Also accessible at `/api/v1` and `/gm-api/v1` for backwards compatibility).*

### 1. List Available Inbound Domains
Retrieves the active pool of public and premium domains.

- **Endpoint**: `GET /v1/domains`
- **Authentication**: None (Public)

#### Example Request:
```bash
curl -X GET https://mail.neverla.web.id/v1/domains
```

#### Example Response (200 OK):
```json
{
  "public": [
    "neverla.web.id",
    "fldubai.com",
    "mynes.com",
    "hunnur.com",
    "binich.com",
    "vitahicks.com",
    "zeropolly.com",
    "rodhazlitt.com",
    "dripzgaming.com",
    "tshirtsavvy.com",
    "yopmail.com",
    "gmail.com",
    "googlemail.com",
    "grabmail.io",
    "linqmail.com",
    "mixozia.com",
    "devrungkad.biz.id",
    "zennext.biz.id"
  ],
  "retention_days": 5,
  "max_attachment": "5 MB"
}
```

---

### 2. Poll Mailbox Messages
Fetches all received emails for a target mailbox address.

- **Endpoint**: `GET /v1/mailbox?address={email}`
- **Authentication**: None (Public)

#### Example Request:
```bash
curl -X GET "https://mail.neverla.web.id/v1/mailbox?address=myinbox@fldubai.com"
```

#### Example Response (200 OK):
```json
{
  "address": "myinbox@fldubai.com",
  "alias": "6360e0b3f075@uvorion.com",
  "count": 1,
  "next": null,
  "messages": [
    {
      "id": "01JRF7K89M2N3P4Q5R6S7T8U9V",
      "from": "noreply@service.com",
      "from_name": "Auth Service",
      "subject": "Your Security Verification Code: 839201",
      "date": "2026-11-02T16:45:00.000Z",
      "seen": false,
      "attachments": 0,
      "expires_at": "2026-11-07T16:45:00.000Z"
    }
  ]
}
```

---

### 3. Retrieve Full Message Details
Fetches full message metadata, plain text, parsed HTML body, and attachment descriptors.

- **Endpoint**: `GET /v1/message/{id}?mailbox={email}`
- **Authentication**: None (Public)

#### Example Request:
```bash
curl -X GET "https://mail.neverla.web.id/v1/message/01JRF7K89M2N3P4Q5R6S7T8U9V?mailbox=myinbox@fldubai.com"
```

#### Example Response (200 OK):
```json
{
  "id": "01JRF7K89M2N3P4Q5R6S7T8U9V",
  "from": "noreply@service.com",
  "from_name": "Auth Service",
  "to": "myinbox@fldubai.com",
  "subject": "Your Security Verification Code: 839201",
  "date": "2026-11-02T16:45:00.000Z",
  "seen": true,
  "text": "Your verification code is 839201. Do not share it.",
  "html": "<div style='font-family:sans-serif;'><h3>Verification Code</h3><p>Your code is <b>839201</b></p></div>",
  "attachments": []
}
```

---

### 4. Render Sanitized Message Body (Browser Iframe)
A dedicated rendering endpoint designed to safely embed complex HTML emails inside responsive client iframes without CSS bleed or layout jitter.

- **Endpoint**: `GET /v1/message/{id}/body`

---

### 5. Delete Message
Permanently removes a message from the storage engine before its 5-day expiration window.

- **Endpoint**: `DELETE /v1/message/{id}?mailbox={email}`

---

## 🤖 Model Context Protocol (MCP) Integration

Neverla Mail exposes a standards-compliant **JSON-RPC 2.0 MCP server** at `/mcp`. This allows autonomous AI agents (Hermes, Claude Desktop, Cursor) to programmatically provision throwaway inboxes and extract incoming OTP codes during browser automation and API workflows.

### Available MCP Tools:
1. `list_domains`: Lists all usable temporary domains (including `.com` domains).
2. `create_inbox`: Generates a randomized mailbox address with an immutable alias.
3. `get_mailbox`: Polls emails waiting at an address.
4. `read_message`: Reads message body, HTML, and attachment manifests.
5. `extract_code`: High-precision regex engine that extracts numeric/alphanumeric OTP codes and activation links directly.
6. `delete_message`: Deletes temporary emails.

#### MCP JSON-RPC Example:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "extract_code",
    "arguments": {
      "address": "test_agent@fldubai.com"
    }
  }
}
```

---

## 🛠️ Architecture & Deployment

```
[ Inbound SMTP (Port 2525) ] ──┐
                               ├──> [ Node.js Ingestion Engine ] ──> [ SQLite Storage (data/mail.db) ]
[ Cloudflare Tunnel HTTPS ]   ──┘             │
                                              ▼
[ Web Frontend (Public / Dongker UI) ] <── [ REST API & MCP Server (Port 3417) ]
```

### Self-Hosting Instructions

#### 1. Clone & Install Dependencies
```bash
git clone https://github.com/hardianto77/neverla-mail.git
cd neverla-mail
npm install
```

#### 2. Environment Configuration
Create a `.env` file or export environment variables:
```bash
PORT=3417              # HTTP REST API & Web Dashboard
PORT_SMTP=2525         # Inbound SMTP Server
HOST=0.0.0.0
```

#### 3. Run Service
```bash
# Production mode
node server.js
```

#### 4. Systemd Service Setup
```ini
[Unit]
Description=Neverla Mail Disposable Email Service
After=network.target

[Service]
Type=simple
User=user
WorkingDirectory=/data/home/neverla-mail
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3417
Environment=PORT_SMTP=2525

[Install]
WantedBy=multi-user.target
```

---

## 📄 License
MIT License. Built and maintained for high-throughput testing, multi-domain isolation, and autonomous AI workflows.
