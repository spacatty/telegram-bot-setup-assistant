# tgsa

**Telegram bot setup assistant.** Paste a bot token, add the bot to your chats, and copy every `chat_id` and topic `message_thread_id` from a local web page. No need to read raw `getUpdates` JSON, forward messages to some other bot, or guess whether a number needs `-100` in front.

```bash
npx tgsa
```

No install, no config, no dependencies. Requires Node.js 18+.

---

## Why

Telegram only tells your bot a chat's id once the bot is in that chat and something happens there. The usual routine is:

1. Add the bot to the group.
2. Open `https://api.telegram.org/bot<token>/getUpdates` in a browser.
3. Find the right `chat` object in a wall of JSON. It may already be gone because your app consumed it, or because a webhook is set.
4. Do it again for every forum topic, and wonder why the General topic has no id.

`tgsa` replaces all of that with one page that updates while you click around in Telegram.

## Quick start

1. **Run it.**

   ```bash
   npx tgsa
   ```

   The page opens at `http://localhost:7313`.

2. **Give it a token.** Copy the token from [@BotFather](https://t.me/BotFather), then press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere on the page. If the token is already in your clipboard, switching to the tab is enough. The token is checked with `getMe` and the bot starts listening right away.

3. **Add the bot to a chat.** Use the **Add to group**, **Add to channel** or **Open DM** buttons, which open Telegram with the right dialog.

4. **Make the bot notice the chat.**

   | Where | What to do |
   | --- | --- |
   | Group / supergroup | Send `/start@yourbot`, or just add the bot (the join itself is reported) |
   | Forum topic | Send `/start@yourbot` **inside each topic** you need |
   | Channel | Add the bot as admin, or post anything once it is |
   | Private chat | Press Start in the DM |

5. **Copy.** Click an id to copy it. The `{}` button copies a JSON snippet ready for your config:

   ```json
   {"chat_id": -1002233445566, "message_thread_id": 12}
   ```

   The ✈ button sends a test message to that chat or topic, so you know the id works before you ship it.

6. **Switch it off** with the bot's toggle when you're done (see [Things to know](#things-to-know)).

## What you see

- **One card per chat**, colour-coded by type: private, group, supergroup, **forum** (a supergroup with topics) or channel.
- **The bot's role** in each chat (member, admin, kicked or left), taken from `my_chat_member` updates.
- **Forum topics** with their real names and icon colours, each with a copyable `message_thread_id`. The General topic is shown too, marked *no thread id*, because you post to it by leaving `message_thread_id` out.
- **Group → supergroup upgrades.** The old card shows the new `-100…` id.
- **The last message** seen in each chat, and which topic it came from.
- **Several bots** at once, each with its own on/off toggle. Bots and discovered chats are remembered between runs.
- **Filters and search** by chat type, name, @username, id or topic name.

## Things to know

**Updates are consumed.** While a bot is toggled on, `tgsa` long-polls `getUpdates` and acknowledges what it gets, just like any polling bot. If your real bot is running at the same time, the two take turns stealing updates (Telegram returns `409 Conflict`, which `tgsa` shows). Stop your bot while you set up, or point `tgsa` at it only briefly.

**Webhooks block polling.** If the bot has a webhook, Telegram refuses `getUpdates`. `tgsa` detects this, shows the webhook URL, and offers to remove it. Your app will need to set the webhook again afterwards; most frameworks do that on startup.

**Privacy mode.** By default (BotFather → `/setprivacy`), bots in groups only see commands, mentions and replies to themselves. That's why the steps use `/start@yourbot`. Being added, removed or promoted is always visible.

**Topic names.** Telegram includes a topic's name only in the topic's creation message and in messages posted inside it. A topic the bot has seen only without that context shows as `Topic #N` until someone posts in it.

## Security

- The server binds to `127.0.0.1` only and rejects requests whose `Host` isn't localhost, which guards against DNS rebinding.
- The API accepts JSON bodies only, so other websites can't post to it from your browser.
- The browser never receives full tokens; it only sees a masked hint.
- Tokens and discovered chats are stored **in plain text** in `~/.tgsa/state.json`. Delete a bot in the UI (or delete that file) to forget it. Use `--data` to keep the file somewhere else.
- `tgsa` talks only to `api.telegram.org`. It reads the clipboard only when the page has focus, and only acts on text that looks like a bot token.

## Options

```
npx tgsa [--port 7313] [--no-open] [--data <dir>]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `7313` | Port to listen on; the next free port is used if it's busy |
| `--no-open` | | Don't open the browser automatically |
| `--data` | `~/.tgsa` | Directory where bots and chats are saved |

## How it works

A small Node HTTP server (`lib/`) runs one long-poll loop per enabled bot. It asks Telegram for `message`, `channel_post`, `my_chat_member`, `chat_member`, `callback_query`, `message_reaction` and `chat_join_request` updates, and turns each one into a "this bot saw this chat (and topic)" record. The page (`public/`) is plain HTML/CSS/JS with no build step, and gets live state over Server-Sent Events.

## Development

```bash
git clone https://github.com/spacatty/tgsa.git
cd tgsa
npm link        # makes `tgsa` run from your checkout
tgsa --port 7400 --data ./.dev-data
```

## License

[MIT](LICENSE)
