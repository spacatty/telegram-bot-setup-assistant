const API = 'https://api.telegram.org';

export const TOKEN_RE = /\b(\d{5,16}:[A-Za-z0-9_-]{30,})\b/;

export class TelegramError extends Error {
  constructor(description, code, retryAfter) {
    super(description);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function call(token, method, params = {}, signal) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) {
    throw new TelegramError(data.description || 'Telegram error', data.error_code ?? res.status, data.parameters?.retry_after);
  }
  return data.result;
}

export const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'callback_query',
  'message_reaction',
];

const SERVICE_LABELS = {
  new_chat_members: 'joined',
  left_chat_member: 'left',
  new_chat_title: 'changed title',
  new_chat_photo: 'changed photo',
  group_chat_created: 'created group',
  supergroup_chat_created: 'created supergroup',
  channel_chat_created: 'created channel',
  migrate_to_chat_id: 'upgraded to supergroup',
  migrate_from_chat_id: 'migrated from group',
  pinned_message: 'pinned a message',
  forum_topic_created: 'created topic',
  forum_topic_edited: 'edited topic',
  forum_topic_closed: 'closed topic',
  forum_topic_reopened: 'reopened topic',
  photo: '[photo]',
  video: '[video]',
  document: '[file]',
  sticker: '[sticker]',
  voice: '[voice]',
  audio: '[audio]',
  animation: '[gif]',
  video_note: '[video note]',
  poll: '[poll]',
  location: '[location]',
  contact: '[contact]',
};

function summarize(m) {
  if (m.text) return m.text;
  if (m.caption) return m.caption;
  if (m.forum_topic_created) return `created topic “${m.forum_topic_created.name}”`;
  for (const key of Object.keys(SERVICE_LABELS)) if (m[key]) return SERVICE_LABELS[key];
  return '[message]';
}

function sender(m) {
  const u = m.from;
  if (m.sender_chat && m.sender_chat.id !== m.chat.id) return m.sender_chat.title;
  if (!u) return m.chat.title || null;
  return [u.first_name, u.last_name].filter(Boolean).join(' ') + (u.username ? ` (@${u.username})` : '');
}

function topicOf(m) {
  if (!m.is_topic_message || !m.message_thread_id) return null;
  const created = m.forum_topic_created || m.reply_to_message?.forum_topic_created;
  const edited = m.forum_topic_edited;
  return {
    id: m.message_thread_id,
    name: edited?.name || created?.name || null,
    color: created?.icon_color ?? null,
  };
}

/** Turns one update into a list of "sightings": a chat (and optional topic) the bot saw. */
export function extractSightings(u) {
  const out = [];
  const msg = u.message || u.edited_message || u.channel_post || u.edited_channel_post;
  if (msg) {
    out.push({
      chat: msg.chat,
      message: true,
      topic: topicOf(msg),
      text: summarize(msg),
      from: sender(msg),
      migrateTo: msg.migrate_to_chat_id ?? null,
    });
  }
  if (u.callback_query?.message?.chat) {
    const m = u.callback_query.message;
    out.push({ chat: m.chat, message: true, topic: topicOf(m), text: `[button] ${u.callback_query.data ?? ''}`, from: sender({ ...m, from: u.callback_query.from }) });
  }
  if (u.my_chat_member) {
    const c = u.my_chat_member;
    const status = c.new_chat_member.status;
    out.push({
      chat: c.chat,
      text: status === 'left' || status === 'kicked' ? `bot was removed (${status})` : `bot is now ${status}`,
      from: sender({ chat: c.chat, from: c.from }),
      botStatus: status,
    });
  }
  if (u.chat_member) {
    const c = u.chat_member;
    const who = c.new_chat_member.user;
    out.push({ chat: c.chat, text: `${who.first_name} is now ${c.new_chat_member.status}`, from: sender({ chat: c.chat, from: c.from }) });
  }
  if (u.chat_join_request) {
    const r = u.chat_join_request;
    out.push({ chat: r.chat, text: 'join request', from: sender({ chat: r.chat, from: r.from }) });
  }
  if (u.message_reaction) {
    const r = u.message_reaction;
    out.push({ chat: r.chat, text: '[reaction]', from: r.user ? sender({ chat: r.chat, from: r.user }) : r.actor_chat?.title });
  }
  return out;
}
