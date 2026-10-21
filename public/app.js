const TOKEN_RE = /\b(\d{5,16}:[A-Za-z0-9_-]{30,})\b/;
const $ = (s, el = document) => el.querySelector(s);

const ui = {
  state: { bots: [] },
  selected: load('tgsa.selected'),
  filter: 'all',
  query: '',
  seen: new Map(), // chatKey -> lastSeen, to flash cards that just got activity
};

/* ---------------- icons ---------------- */
const I = {
  private: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><circle cx="17" cy="7" r="2.5"/><path d="M17 13c3 0 5 1.5 5 4.5"/></svg>',
  forum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h11v8H8l-4 3z"/><path d="M15 9h5v8l-3-2.5h-6V13"/></svg>',
  channel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 10v4h3l6 4V6L6 10z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11.5L21 4l-7.5 18-2.5-7.5z"/></svg>',
  json: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 2-1 3-3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
};

/* ---------------- helpers ---------------- */
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function hue(n) { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function avatar(bot, size = '') {
  const h = hue(bot.id);
  return `<div class="avatar ${size}" style="background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 40) % 360} 70% 45%))">${esc((bot.name || '?')[0].toUpperCase())}<span class="dot ${bot.enabled ? bot.status || '' : ''}"></span></div>`;
}

function ago(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

function kind(chat) {
  if (chat.type === 'supergroup' && chat.isForum) return 'forum';
  return chat.type;
}
const KIND_LABEL = { private: 'Private', group: 'Group', supergroup: 'Supergroup', forum: 'Forum', channel: 'Channel' };
const KIND_ICON = { private: I.private, group: I.group, supergroup: I.group, forum: I.forum, channel: I.channel };

const TOPIC_COLORS = { 7322096: '#6FB9F0', 16766590: '#FFD67E', 13338331: '#CB86DB', 9367192: '#8EEE98', 16749490: '#FF93B2', 16478047: '#FB6F5F' };
function topicColor(t) {
  if (t.general) return 'var(--faint)';
  if (t.color != null) return TOPIC_COLORS[t.color] || `#${Number(t.color).toString(16).padStart(6, '0')}`;
  return `hsl(${hue(t.id)} 55% 55%)`;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 1800);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function copy(text, el) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (el) {
    el.classList.add('done');
    const lbl = el.querySelector('.lbl');
    const prev = lbl?.textContent;
    if (lbl) lbl.textContent = 'copied';
    setTimeout(() => { el.classList.remove('done'); if (lbl) lbl.textContent = prev; }, 1200);
  } else {
    toast('Copied');
  }
}

/* ---------------- token intake ---------------- */
const ignored = new Set(JSON.parse(load('tgsa.ignored') || '[]'));
let adding = null;

async function addToken(raw, { silent = false } = {}) {
  const token = String(raw || '').match(TOKEN_RE)?.[1];
  if (!token) { if (!silent) toast('No bot token found in that text', true); return; }
  if (adding === token) return;
  if (silent && (ignored.has(token) || knownToken(token))) return;
  adding = token;
  $('#add-form button').disabled = true;
  try {
    const r = await api('POST', '/api/bots', { token });
    ui.selected = String(r.id); store('tgsa.selected', ui.selected);
    ignored.delete(token); store('tgsa.ignored', JSON.stringify([...ignored]));
    $('#token-input').value = '';
    toast(r.existed ? 'Bot updated & enabled' : 'Bot added — listening for updates');
    render();
  } catch (e) {
    if (silent) { ignored.add(token); store('tgsa.ignored', JSON.stringify([...ignored])); }
    toast(e.message, true);
  } finally {
    adding = null;
    $('#add-form button').disabled = false;
  }
}

function knownToken(token) {
  const [id, secret] = token.split(':');
  return ui.state.bots.some((b) => b.tokenHint === `${id}:${secret.slice(0, 4)}…${token.slice(-4)}`);
}

$('#add-form').addEventListener('submit', (e) => { e.preventDefault(); addToken($('#token-input').value); });

// Paste anywhere on the page (except into the search box with ordinary text).
document.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (!TOKEN_RE.test(text)) return;
  e.preventDefault();
  addToken(text);
});

// Pick up a token already sitting in the clipboard when the tab gets focus.
async function sniffClipboard() {
  if (!document.hasFocus() || !navigator.clipboard?.readText) return;
  try {
    const text = await navigator.clipboard.readText();
    if (TOKEN_RE.test(text)) addToken(text, { silent: true });
  } catch {}
}
window.addEventListener('focus', sniffClipboard);

/* ---------------- live state ---------------- */
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { $('#conn').className = 'conn on'; $('#conn').title = 'Connected to local tgsa server'; };
  es.onmessage = (e) => { ui.state = JSON.parse(e.data); render(); };
  es.onerror = () => { $('#conn').className = 'conn off'; $('#conn').title = 'Lost connection — is tgsa still running?'; };
}

/* ---------------- render ---------------- */
function currentBot() {
  const bots = ui.state.bots;
  return bots.find((b) => String(b.id) === String(ui.selected)) || bots[0] || null;
}

function render() {
  renderBots();
  renderMain();
}

function renderBots() {
  const bots = ui.state.bots;
  const sel = currentBot();
  $('#bots').innerHTML = bots.length
    ? bots.map((b) => `
      <div class="bot ${sel && b.id === sel.id ? 'sel' : ''}" data-select="${b.id}" role="button" tabindex="0">
        ${avatar(b)}
        <div class="bot-meta">
          <div class="bot-name">${esc(b.name)}</div>
          <div class="bot-sub">@${esc(b.username)} · ${Object.keys(b.chats || {}).length} chats</div>
        </div>
        <label class="switch" title="${b.enabled ? 'Stop polling' : 'Start polling getUpdates'}">
          <input type="checkbox" data-toggle="${b.id}" ${b.enabled ? 'checked' : ''}><span></span>
        </label>
      </div>`).join('')
    : '<div class="aside-empty">No bots yet.</div>';
}

function renderMain() {
  const bot = currentBot();
  const main = $('#main');
  if (!bot) {
    main.innerHTML = `
      <div class="empty hero">
        <h2>Paste a bot token to begin</h2>
        <p class="big">Copy the token from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and press <span class="kbd">Ctrl</span> + <span class="kbd">V</span> anywhere on this page. If it's already in your clipboard, it will be picked up when you switch to this tab.</p>
        <div class="steps">
          <div class="step"><div class="num">1</div><b>Paste the token</b>The bot is checked with <code>getMe</code> and starts listening.</div>
          <div class="step"><div class="num">2</div><b>Add it to a chat</b>Group, supergroup, forum or channel — one click from here.</div>
          <div class="step"><div class="num">3</div><b>Copy the ids</b><code>chat_id</code> and topic <code>message_thread_id</code>, ready to paste.</div>
        </div>
      </div>`;
    return;
  }

  const chats = Object.values(bot.chats || {}).sort((a, b) => b.lastSeen - a.lastSeen);
  const counts = { all: chats.length, private: 0, group: 0, forum: 0, channel: 0 };
  for (const c of chats) {
    const k = kind(c);
    counts[k === 'supergroup' ? 'group' : k] += 1;
  }
  const searching = document.activeElement?.id === 'search';

  const u = encodeURIComponent(bot.username);
  main.innerHTML = `
    <div class="bot-head">
      ${avatar(bot)}
      <div>
        <h1>${esc(bot.name)}</h1>
        <div class="sub">
          <a href="https://t.me/${u}" target="_blank" rel="noreferrer">@${esc(bot.username)}</a>
          <span>id ${bot.id}</span>
          <span style="font-family:var(--mono);font-size:12px">${esc(bot.tokenHint)}</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="https://t.me/${u}?startgroup=tgsa" target="_blank" rel="noreferrer">${I.group} Add to group</a>
        <a class="btn" href="https://t.me/${u}?startchannel=tgsa&admin=post_messages" target="_blank" rel="noreferrer">${I.channel} Add to channel</a>
        <a class="btn" href="https://t.me/${u}?start=tgsa" target="_blank" rel="noreferrer">${I.chat} Open DM</a>
        <button class="btn ghost danger" data-remove-bot="${bot.id}" title="Forget this bot">${I.trash}</button>
      </div>
    </div>
    ${banners(bot)}
    ${chats.length ? `
      <div class="toolbar">
        <div class="chips">
          ${[['all', 'All'], ['group', 'Groups'], ['forum', 'Forums'], ['channel', 'Channels'], ['private', 'Private']]
            .filter(([k]) => k === 'all' || counts[k])
            .map(([k, l]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-filter="${k}">${l}<span class="n">${counts[k]}</span></button>`).join('')}
        </div>
        <input class="search" id="search" placeholder="Filter by name, id, topic…" value="${esc(ui.query)}">
        <button class="btn ghost" data-clear="${bot.id}" title="Forget all discovered chats">Clear</button>
      </div>
      <div class="grid" id="grid">${gridHtml(bot)}</div>
    ` : emptyChats(bot)}
  `;

  const search = $('#search');
  if (search && searching) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
}

function gridHtml(bot) {
  const q = ui.query.trim().toLowerCase();
  const visible = Object.values(bot.chats || {}).sort((a, b) => b.lastSeen - a.lastSeen).filter((c) => {
    const k = kind(c) === 'supergroup' ? 'group' : kind(c);
    if (ui.filter !== 'all' && k !== ui.filter) return false;
    if (!q) return true;
    const hay = [c.title, c.username, c.id, ...Object.values(c.topics || {}).map((t) => `${t.name} ${t.id}`)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return visible.map((c) => chatCard(bot, c)).join('') || '<div class="empty">Nothing matches.</div>';
}

function banners(bot) {
  const out = [];
  if (!bot.enabled) {
    out.push(`<div class="banner info"><div class="grow">Polling is off. Turn it on to discover chats.</div><button class="btn-primary" data-enable="${bot.id}">Start listening</button></div>`);
  } else if (bot.errorKind === 'webhook') {
    out.push(`<div class="banner bad"><div class="grow"><b>Webhook is set</b> — <code>${esc(bot.webhookUrl)}</code><br>Telegram won't hand out updates via getUpdates while a webhook exists. Removing it stops delivery to that URL until your app sets it again.</div><button class="btn" data-del-webhook="${bot.id}">Remove webhook</button></div>`);
  } else if (bot.status === 'error') {
    out.push(`<div class="banner bad"><div class="grow">${esc(bot.error)}</div></div>`);
  } else {
    out.push(`<div class="banner info"><div class="grow">Listening via getUpdates. Updates are consumed while tgsa runs — stop any other copy of this bot first, and switch tgsa off when you're done.</div></div>`);
  }
  if (bot.canReadAll === false) {
    out.push(`<div class="banner warn"><div class="grow"><b>Privacy mode is on.</b> In groups the bot only sees commands and @mentions. Send <code>/start@${esc(bot.username)}</code> in the group — or in each topic you need the id of. Joining/admin changes are always visible.</div></div>`);
  }
  return out.join('');
}

function emptyChats(bot) {
  return `
    <div class="empty">
      <h2>No chats seen yet</h2>
      <p class="big">Add <b>@${esc(bot.username)}</b> somewhere, then make it notice you. Chats appear here the moment Telegram reports them.</p>
      <div class="steps">
        <div class="step"><div class="num">1</div><b>Add the bot</b>Use the buttons above, or add it from the chat's member list.</div>
        <div class="step"><div class="num">2</div><b>Say something</b>Send <code>/start@${esc(bot.username)}</code> or mention the bot. In channels, post anything (bot must be admin).</div>
        <div class="step"><div class="num">3</div><b>Topics</b>Send the command inside each topic — its <code>message_thread_id</code> is listed under the forum.</div>
      </div>
      ${bot.enabled && bot.status === 'polling' ? '<div class="listening"><span class="dot polling"></span>Listening for updates…</div>' : ''}
    </div>`;
}

function idCopy(label, value, extra = '') {
  return `<button class="copy" data-copy="${esc(value)}" title="Click to copy" ${extra}><span class="val">${esc(value)}</span><span class="lbl">${label}</span></button>`;
}

function chatCard(bot, c) {
  const k = kind(c);
  const key = `${bot.id}:${c.id}`;
  const prev = ui.seen.get(key);
  const flash = prev !== undefined && prev !== c.lastSeen;
  ui.seen.set(key, c.lastSeen);

  const status = c.botStatus === 'administrator' ? '<span class="badge admin">admin</span>'
    : c.botStatus === 'left' || c.botStatus === 'kicked' ? `<span class="badge gone">${c.botStatus}</span>`
    : c.botStatus === 'member' ? '<span class="badge plain">member</span>' : '';

  const topics = Object.values(c.topics || {}).sort((a, b) => (a.general ? -1 : b.general ? 1 : a.id - b.id));
  const lastTopic = c.last?.topicId ? c.topics?.[c.last.topicId] : null;

  return `
    <article class="card ${k} ${flash ? 'flash' : ''}">
      <div class="card-head">
        <div class="chat-icon">${KIND_ICON[k]}</div>
        <div class="card-title">
          <h3 title="${esc(c.title)}">${esc(c.title || 'Untitled')}</h3>
          <div class="meta">
            <span class="badge">${KIND_LABEL[k]}</span>
            ${c.username ? `<span class="badge plain">@${esc(c.username)}</span>` : ''}
            ${status}
          </div>
        </div>
        <div class="card-menu">
          <button class="icon-btn" title="Send a test message" data-test="${c.id}">${I.send}</button>
          <button class="icon-btn" title="Copy as JSON" data-json='${esc(JSON.stringify({ chat_id: c.id }))}'>${I.json}</button>
          <button class="icon-btn" title="Remove from list" data-remove-chat="${c.id}">${I.trash}</button>
        </div>
      </div>
      <div class="idrow">${idCopy('chat_id', c.id)}</div>
      ${c.migratedTo ? `<div class="migrated">Upgraded to a supergroup — new id: <button class="copy" style="display:inline-flex" data-copy="${c.migratedTo}"><span class="val">${c.migratedTo}</span></button></div>` : ''}
      ${topics.length ? `
        <div class="topics">
          <div class="topics-head">Topics · message_thread_id</div>
          ${topics.map((t) => `
            <div class="topic">
              <span class="tdot" style="background:${topicColor(t)}">${t.general ? '#' : esc((t.name || '?')[0].toUpperCase())}</span>
              <span class="tname">${t.name ? esc(t.name) : `<i>Topic #${t.id}</i>`}</span>
              ${t.general ? '<span class="badge plain" title="Send without message_thread_id">no thread id</span>' : idCopy('thread', t.id)}
              <span style="display:flex">
                <button class="icon-btn" title="Send a test message to this topic" data-test="${c.id}" data-thread="${t.id ?? ''}">${I.send}</button>
                <button class="icon-btn" title="Copy as JSON" data-json='${esc(JSON.stringify(t.general ? { chat_id: c.id } : { chat_id: c.id, message_thread_id: t.id }))}'>${I.json}</button>
              </span>
            </div>`).join('')}
        </div>` : ''}
      ${c.last ? `
        <div class="last">
          <span class="txt">${lastTopic ? `<span style="color:${topicColor(lastTopic)}">${esc(lastTopic.name || '#' + lastTopic.id)}</span> · ` : ''}${c.last.from ? `<b>${esc(c.last.from)}:</b> ` : ''}${esc(c.last.text)}</span>
          <time data-time="${c.last.at}">${ago(c.last.at)}</time>
        </div>` : ''}
    </article>`;
}

/* ---------------- interactions ---------------- */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-copy],[data-json],[data-select],[data-filter],[data-test],[data-remove-chat],[data-remove-bot],[data-clear],[data-del-webhook],[data-enable]');
  if (!t || e.target.closest('.switch')) return;
  const bot = currentBot();
  const d = t.dataset;
  try {
    if (d.copy !== undefined) return copy(d.copy, t);
    if (d.json !== undefined) return copy(d.json);
    if (d.select) { ui.selected = d.select; store('tgsa.selected', d.select); ui.filter = 'all'; ui.query = ''; return render(); }
    if (d.filter) { ui.filter = d.filter; return renderMain(); }
    if (d.enable) return await api('PATCH', `/api/bots/${d.enable}`, { enabled: true });
    if (d.test) {
      await api('POST', `/api/bots/${bot.id}/test`, { chatId: d.test, threadId: d.thread || null });
      return toast('Test message sent ✓');
    }
    if (d.removeChat) return await api('DELETE', `/api/bots/${bot.id}/chats/${d.removeChat}`);
    if (d.clear && confirm('Forget all discovered chats for this bot?')) return await api('POST', `/api/bots/${d.clear}/clear`);
    if (d.removeBot && confirm(`Forget @${bot.username}? Its token is removed from this machine.`)) {
      return await api('DELETE', `/api/bots/${d.removeBot}`);
    }
    if (d.delWebhook && confirm('Remove the webhook so tgsa can poll? Your app will stop receiving updates until it sets the webhook again.')) {
      await api('POST', `/api/bots/${d.delWebhook}/delete-webhook`);
      return toast('Webhook removed');
    }
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.select) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('change', async (e) => {
  const id = e.target.dataset?.toggle;
  if (!id) return;
  try { await api('PATCH', `/api/bots/${id}`, { enabled: e.target.checked }); }
  catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  ui.query = e.target.value;
  const bot = currentBot();
  if (bot) $('#grid').innerHTML = gridHtml(bot);
});

setInterval(() => {
  for (const el of document.querySelectorAll('time[data-time]')) el.textContent = ago(Number(el.dataset.time));
}, 10000);

connect();
sniffClipboard();
