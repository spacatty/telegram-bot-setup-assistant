import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

export async function startServer(app, { port = 7313 } = {}) {
  const clients = new Set();
  let pending = null;
  app.on('change', () => {
    // Coalesce bursts of changes into one push.
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const payload = `data: ${JSON.stringify(app.publicState())}\n\n`;
      for (const res of clients) res.write(payload);
    }, 50);
  });

  const routes = [
    ['GET', /^\/api\/state$/, () => app.publicState()],
    ['POST', /^\/api\/bots$/, (_, body) => app.addBot(body.token)],
    ['PATCH', /^\/api\/bots\/(\d+)$/, ([id], body) => app.setEnabled(id, body.enabled)],
    ['DELETE', /^\/api\/bots\/(\d+)$/, ([id]) => app.removeBot(id)],
    ['POST', /^\/api\/bots\/(\d+)\/delete-webhook$/, ([id]) => app.deleteWebhook(id)],
    ['POST', /^\/api\/bots\/(\d+)\/clear$/, ([id]) => app.clearChats(id)],
    ['POST', /^\/api\/bots\/(\d+)\/test$/, ([id], body) => app.sendTest(id, body.chatId, body.threadId)],
    ['DELETE', /^\/api\/bots\/(\d+)\/chats\/(-?\d+)$/, ([id, chatId]) => app.removeChat(id, chatId)],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(app.publicState())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ping); });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) return json(res, 404, { error: 'Not found' });
      // JSON-only bodies force a CORS preflight, so other sites can't post here.
      if (req.method !== 'GET' && !String(req.headers['content-type']).startsWith('application/json')) {
        return json(res, 415, { error: 'Expected application/json' });
      }
      try {
        const body = req.method === 'GET' ? {} : await readJson(req);
        const params = url.pathname.match(route[1]).slice(1);
        const result = await route[2](params, body);
        return json(res, 200, result ?? { ok: true });
      } catch (e) {
        return json(res, e.status || 500, { error: e.message });
      }
    }

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC)) return res.writeHead(403).end();
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  const actualPort = await listen(server, port);
  return { server, url: `http://localhost:${actualPort}` };
}

function listen(server, port, attempts = 20) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && attempts > 1) resolve(listen(server, port + 1, attempts - 1));
      else reject(e);
    });
    server.listen(port, '127.0.0.1', () => resolve(port));
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e5) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}
