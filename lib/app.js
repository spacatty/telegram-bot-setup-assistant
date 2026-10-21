import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { call, extractSightings, ALLOWED_UPDATES, TOKEN_RE } from './telegram.js';

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

export class App extends EventEmitter {
  constructor({ dataDir } = {}) {
    super();
    this.dataDir = dataDir || path.join(os.homedir(), '.tgsa');
    this.file = path.join(this.dataDir, 'state.json');
    this.bots = {};      // persisted
    this.runtime = {};   // per bot: { controller, status, error, errorKind, webhookUrl }
    this.saveTimer = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      this.bots = data.bots || {};
    } catch {}
    for (const bot of Object.values(this.bots)) {
      this.runtime[bot.id] = { status: 'stopped' };
      if (bot.enabled) this.start(bot.id);
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const tmp = this.file + '.tmp';
      await writeFile(tmp, JSON.stringify({ bots: this.bots }, null, 2));
      await rename(tmp, this.file);
    }, 300);
  }

  changed() {
    this.save();
    this.emit('change');
  }

  /** State for the browser: everything except raw tokens. */
  publicState() {
    const bots = Object.values(this.bots)
      .sort((a, b) => a.addedAt - b.addedAt)
      .map(({ token, offset, ...bot }) => ({
        ...bot,
        tokenHint: `${token.split(':')[0]}:${token.split(':')[1].slice(0, 4)}…${token.slice(-4)}`,
        ...pick(this.runtime[bot.id] || {}, ['status', 'error', 'errorKind', 'webhookUrl']),
      }));
    return { bots, dataFile: this.file };
  }

  async addBot(rawToken) {
    const token = String(rawToken || '').match(TOKEN_RE)?.[1];
    if (!token) throw httpError(400, 'That does not look like a bot token (123456:ABC…).');
    const me = await call(token, 'getMe').catch((e) => {
      throw httpError(400, e.code === 401 || e.code === 404 ? 'Telegram rejected this token.' : e.message);
    });
    const existing = this.bots[me.id];
    this.bots[me.id] = {
      chats: {},
      offset: 0,
      addedAt: Date.now(),
      ...existing,
      id: me.id,
      token,
      username: me.username,
      name: me.first_name,
      canJoinGroups: me.can_join_groups,
      canReadAll: me.can_read_all_group_messages,
      enabled: true,
    };
    this.runtime[me.id] ||= { status: 'stopped' };
    this.start(me.id);
    this.changed();
    return { id: me.id, existed: Boolean(existing) };
  }

  getBot(id) {
    const bot = this.bots[id];
    if (!bot) throw httpError(404, 'Bot not found');
    return bot;
  }

  setEnabled(id, enabled) {
    const bot = this.getBot(id);
    bot.enabled = Boolean(enabled);
    if (bot.enabled) this.start(id);
    else this.stop(id);
    this.changed();
  }

  removeBot(id) {
    this.getBot(id);
    this.stop(id);
    delete this.bots[id];
    delete this.runtime[id];
    this.changed();
  }

  removeChat(id, chatId) {
    delete this.getBot(id).chats[chatId];
    this.changed();
  }

  clearChats(id) {
    this.getBot(id).chats = {};
    this.changed();
  }

  async deleteWebhook(id) {
    const bot = this.getBot(id);
    await call(bot.token, 'deleteWebhook', { drop_pending_updates: false });
    if (bot.enabled) this.start(id);
  }

  async sendTest(id, chatId, threadId) {
    const bot = this.getBot(id);
    const lines = [`✅ <b>${escapeHtml(bot.name)}</b> can post here.`, `chat_id: <code>${chatId}</code>`];
    if (threadId) lines.push(`message_thread_id: <code>${threadId}</code>`);
    await call(bot.token, 'sendMessage', {
      chat_id: chatId,
      ...(threadId ? { message_thread_id: Number(threadId) } : {}),
      text: lines.join('\n'),
      parse_mode: 'HTML',
    }).catch((e) => { throw httpError(400, e.message); });
  }

  setRuntime(id, patch) {
    if (!this.runtime[id]) return;
    Object.assign(this.runtime[id], patch);
    this.emit('change');
  }

  start(id) {
    const rt = (this.runtime[id] ||= { status: 'stopped' });
    rt.controller?.abort();
    const controller = new AbortController();
    rt.controller = controller;
    this.poll(id, controller.signal);
  }

  stop(id) {
    const rt = this.runtime[id];
    if (!rt) return;
    rt.controller?.abort();
    rt.controller = null;
    this.setRuntime(id, { status: 'stopped', error: null, errorKind: null });
  }

  async stopAll() {
    for (const id of Object.keys(this.runtime)) this.runtime[id].controller?.abort();
    clearTimeout(this.saveTimer);
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ bots: this.bots }, null, 2));
  }

  async poll(id, signal) {
    this.setRuntime(id, { status: 'starting', error: null, errorKind: null, webhookUrl: null });

    while (!signal.aborted) {
      const bot = this.bots[id];
      if (!bot) return;
      try {
        // getUpdates refuses to work while a webhook is set; surface that instead of looping on 409s.
        const hook = await call(bot.token, 'getWebhookInfo', {}, signal);
        if (hook.url) {
          this.setRuntime(id, { status: 'error', errorKind: 'webhook', webhookUrl: hook.url, error: 'This bot has a webhook set, so updates cannot be polled.' });
          return;
        }
        break;
      } catch (e) {
        if (signal.aborted) return;
        if (e.code === 401 || e.code === 404) {
          this.setRuntime(id, { status: 'error', errorKind: 'token', error: 'Telegram rejected the token (revoked?). Paste the new one.' });
          return;
        }
        this.setRuntime(id, { status: 'error', errorKind: 'network', error: e.message });
        await sleep(3000, signal);
      }
    }

    while (!signal.aborted) {
      const bot = this.bots[id];
      if (!bot) return;
      try {
        this.setRuntime(id, { status: 'polling', error: null, errorKind: null });
        const updates = await call(bot.token, 'getUpdates', {
          offset: bot.offset,
          timeout: 25,
          allowed_updates: ALLOWED_UPDATES,
        }, signal);
        if (signal.aborted) return;
        if (updates.length) {
          for (const u of updates) {
            this.ingest(bot, u);
            bot.offset = u.update_id + 1;
          }
          this.changed();
        }
      } catch (e) {
        if (signal.aborted) return;
        if (e.code === 409) {
          this.setRuntime(id, { status: 'error', errorKind: 'conflict', error: 'Another program is polling this bot (or a webhook was set). Retrying…' });
          await sleep(5000, signal);
        } else if (e.code === 401 || e.code === 404) {
          this.setRuntime(id, { status: 'error', errorKind: 'token', error: 'Telegram rejected the token (revoked?). Paste the new one.' });
          return;
        } else {
          this.setRuntime(id, { status: 'error', errorKind: 'network', error: e.message });
          await sleep((e.retryAfter || 3) * 1000, signal);
        }
      }
    }
  }

  ingest(bot, update) {
    const now = Date.now();
    for (const s of extractSightings(update)) {
      const c = s.chat;
      const chat = (bot.chats[c.id] ||= { id: c.id, firstSeen: now, topics: {}, events: 0 });
      chat.type = c.type;
      chat.title = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || chat.title;
      chat.username = c.username || chat.username || null;
      if (c.type === 'supergroup') chat.isForum = Boolean(c.is_forum);
      chat.lastSeen = now;
      chat.events += 1;
      chat.last = { text: truncate(s.text, 140), from: s.from, at: now, topicId: s.topic?.id ?? null };
      if (s.botStatus) chat.botStatus = s.botStatus;
      if (s.migrateTo) chat.migratedTo = s.migrateTo;

      if (s.topic) {
        const t = (chat.topics[s.topic.id] ||= { id: s.topic.id, name: null, color: null, firstSeen: now });
        if (s.topic.name) t.name = s.topic.name;
        if (s.topic.color != null) t.color = s.topic.color;
        t.lastSeen = now;
      } else if (chat.isForum && s.message) {
        const g = (chat.topics.general ||= { id: null, general: true, name: 'General', firstSeen: now });
        g.lastSeen = now;
      }
    }
  }
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
