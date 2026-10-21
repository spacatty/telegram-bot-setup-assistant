#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { App } from '../lib/app.js';
import { startServer } from '../lib/server.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag('-h') || flag('--help')) {
  console.log(`tgsa - Telegram bot setup assistant

Usage: npx @spacatty/tgsa [--port 7313] [--no-open] [--data <dir>]

  --port     Port to listen on (next free port is used if busy)
  --no-open  Don't open the browser automatically
  --data     Directory for saved bots (default: ~/.tgsa)`);
  process.exit(0);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error('tgsa needs Node.js 18 or newer.');
  process.exit(1);
}

const app = new App({ dataDir: value('--data') });
await app.load();

const { url } = await startServer(app, { port: Number(value('--port', 7313)) });
console.log(`\n  tgsa is running at \x1b[36m${url}\x1b[0m`);
console.log('  Press Ctrl+C to stop.\n');

if (!flag('--no-open')) openBrowser(url);

const shutdown = async () => {
  await app.stopAll();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function openBrowser(target) {
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', target]]
    : process.platform === 'darwin' ? ['open', [target]]
    : ['xdg-open', [target]];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {}
}
