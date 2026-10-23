import { verifyTestAccount } from './verify-account.mjs';
import { open, unlink, mkdtemp, rmdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const repoRequire = createRequire(new URL('../../../server/package.json', import.meta.url));
const { MongoClient } = repoRequire('mongodb');
const dotenv = repoRequire('dotenv');
dotenv.config({ path: fileURLToPath(new URL('../../../server/.env', import.meta.url)), quiet: true });
const run = Date.now();
const accounts = [0, 1].map(n => ({ email: `peer-ui-${run}-${n}@example.invalid`, name: `Pair Test ${n}`, password: randomBytes(18).toString('base64url') }));
const engine = process.argv[2] ?? 'chrome';
const browser = await (engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium).launch({
  ...(engine === 'chrome' ? { channel: 'chrome' } : engine === 'edge' ? { channel: 'msedge' } : {}), headless: true, ...(engine === 'firefox' ? { firefoxUserPrefs: { 'media.peerconnection.ice.loopback': true, 'media.peerconnection.ice.obfuscate_host_addresses': false } } : {}),
});
console.log('Browser', engine, browser.version());
const profiles = await mkdtemp(join(tmpdir(), 'peer-share-profiles-'));
const contexts = [];
const mailboxIds = [];
const errors = [];
const monitor = setInterval(async () => {
  for (const context of contexts) for (const page of context.pages()) {
    try { console.log(engine, (await page.locator('.transfer-progress').allTextContents()).join(' ') || (await page.locator('body').innerText()).split(String.fromCharCode(10)).filter(x => /Sending|Receiving|failed|Invalid|ended|complete|File transfer/i.test(x)).join(' ')); } catch {}
  }
}, 20000);
async function signup(account) {
  const context = ['chrome', 'edge'].includes(engine) ? await chromium.launchPersistentContext(join(profiles, String(contexts.length)), { channel: engine === 'edge' ? 'msedge' : 'chrome', headless: true }) : await browser.newContext(); contexts.push(context);
  await context.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    window.__peers = [];
    window.RTCPeerConnection = class extends Original {
      constructor(...args) { super(...args); window.__peers.push(this); }
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173/sign-up');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Name', { exact: true }).fill(account.name);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL(/verify-email/);
  mailboxIds.push(await verifyTestAccount(account.email, page));
  await page.goto('http://localhost:5173/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('http://localhost:5173/app');
  await page.goto('http://localhost:5173/app');
  await page.getByText('Ready to connect', { exact: true }).waitFor();
  return { context, page };
}
async function waitEnabled(locator) {
  await locator.waitFor();
  for (let i = 0; i < 100; i++) { if (await locator.isEnabled()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Control remained disabled');
}
const temporary = await mkdtemp(join(tmpdir(), 'peer-share-large-'));
const sourcePath = join(temporary, engine + '-exact-1-gib.bin');
const oversizedPath = join(temporary, engine + '-over-1-gib.bin');
try {
  const size = 1024 ** 3;
  const hashSource = createHash('sha256'), block = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < 1024; i++) hashSource.update(block);
  const expected = hashSource.digest('hex');
  const source = await open(sourcePath, 'w'); await source.truncate(size); await source.close();
  const oversized = await open(oversizedPath, 'w');
  await oversized.truncate(size + 1); await oversized.close();
  const { page: a } = await signup(accounts[0]);
  const { page: b } = await signup(accounts[1]);
  console.log('Storage', await b.evaluate(async () => ({ opfs: !!navigator.storage.getDirectory, writable: typeof FileSystemFileHandle.prototype.createWritable, quota: await navigator.storage.estimate() })));
  const recipientId = await b.locator('code').innerText();
  await a.getByLabel('Recipient account ID').fill(recipientId);
  await a.getByRole('button', { name: 'Invite', exact: true }).click();
  await b.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await a.getByText('Direct connection established', { exact: true }).waitFor();
  await b.getByText('Direct connection established', { exact: true }).waitFor();

  await a.getByLabel('File to send').setInputFiles(oversizedPath);
  await a.getByRole('button', { name: 'Send file', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'Choose a file of at most 1 GiB.' }).waitFor();
  assert.equal(await b.getByRole('button', { name: 'Accept file', exact: true }).count(), 0);
  await a.getByLabel('File to send').setInputFiles(sourcePath);
  await a.getByRole('button', { name: 'Send file', exact: true }).click();
  console.log('Offered', new Date().toISOString());
  await b.getByRole('button', { name: 'Accept file', exact: true }).click();
  await Promise.race([
    a.getByText(new RegExp('Sending ' + engine + '-exact-1-gib.bin: complete')).waitFor({ timeout: 300000 }),
    b.getByRole('alert').waitFor({ timeout: 300000 }).then(async () => { throw new Error(await b.getByRole('alert').innerText()); }),
  ]);
  const link = b.getByRole('link', { name: 'Download ' + engine + '-exact-1-gib.bin (verified)', exact: true });
  await link.waitFor();
  const downloadPromise = b.waitForEvent('download');
  await link.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const hash = createHash('sha256'); let count = 0;
  for await (const chunk of stream) { count += chunk.length; hash.update(chunk); }
  assert.equal(count, 1024 ** 3);
  assert.equal(hash.digest('hex'), expected);
  assert.equal(await b.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  console.log(engine, 'PASS: exact 1 GiB real WebRTC transfer and downloaded SHA-256, 1 GiB + 1 byte blocked before offer, full-size chat history accepted, no page errors.');
} finally {
  clearInterval(monitor); await Promise.all(contexts.map(context => context.close())); await browser.close(); await rm(profiles, { recursive: true, force: true });
  await Promise.all([sourcePath, oversizedPath].map(path => unlink(path).catch(() => {})));
  await rmdir(temporary);
  if (mailboxIds.length) await fetch("http://127.0.0.1:8025/api/v1/messages", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ IDs: mailboxIds }) }).catch(() => {});
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const users = await db.collection('user').find({ email: { $in: accounts.map(a => a.email) } }).toArray();
    const ids = users.flatMap(user => [user._id, user._id.toString()]);
    if (ids.length) {
      await db.collection('session').deleteMany({ userId: { $in: ids } });
      await db.collection('account').deleteMany({ userId: { $in: ids } });
      await db.collection('user').deleteMany({ _id: { $in: users.map(user => user._id) }, email: { $in: accounts.map(a => a.email) } });
    }
    console.log(`Removed ${users.length} temporary test accounts and their auth records.`);
  } finally { await client.close(); }
}
