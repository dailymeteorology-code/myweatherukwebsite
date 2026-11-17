/* Sets the admin account's sign-in, typed by the owner (deploy/oracle, 17 Nov 2026). On the PC the owner never
   needed a password (auto-login, server/auth.js); on the Oracle server nobody is signed in automatically, and the
   site's only account, admin@localhost, has a password that was printed once in a log long ago. The site has no
   way to change it while signed in and no email to reset it, so this does it on the database file itself.

     node deploy/oracle/set-admin-password.mjs [database file]     (default server/data/db.json)

   It asks for the email to sign in with (Enter keeps admin@localhost) and the new password twice. The password is
   never shown or stored: only its scrypt hash, made exactly as server/auth.js hashPassword makes it. The site must
   be stopped while this runs: it keeps the database in memory and would write its own copy over this one. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.argv[2] || 'server/data/db.json');

async function stopped() {
  try { await fetch('http://localhost:8787/', { signal: AbortSignal.timeout(3000) }); return false; } catch { return true; }
}

/* a line typed at the terminal; hidden: nothing is echoed */
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    let text = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(text);
          return;
        }
        if (ch === '\u0003') { stdout.write('\n'); process.exit(1); }       // Ctrl+C
        if (ch === '\u007f' || ch === '\b') { if (text) { text = text.slice(0, -1); if (!hidden) stdout.write('\b \b'); } continue; }
        text += ch;
        if (!hidden) stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

if (!(await stopped())) {
  console.log('The site on this PC is running (http://localhost:8787 answers): stop it first, or it will write over this change.');
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const admins = (db._users || []).filter((u) => u.role === 'admin');
if (!admins.length) { console.log(`No admin account in ${FILE}.`); process.exit(1); }
const user = admins[0];
console.log(`Admin account: ${user.email}`);
const email = (await ask('Email to sign in with (Enter to keep it): ')).trim().toLowerCase();
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.log('That is not an email address; nothing changed.'); process.exit(1); }
if (email && (db._users || []).some((u) => u !== user && String(u.email).toLowerCase() === email)) { console.log('Another account has that email; nothing changed.'); process.exit(1); }
const a = await ask('New password (hidden, at least 10 characters): ', true);
if (a.length < 10) { console.log('Too short; nothing changed.'); process.exit(1); }
const b = await ask('The same again: ', true);
if (a !== b) { console.log('They differ; nothing changed.'); process.exit(1); }

const salt = crypto.randomBytes(16).toString('hex');
user.password_salt = salt;
user.password_hash = crypto.scryptSync(a, salt, 64).toString('hex');
if (email) user.email = email;
const tmp = `${FILE}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(db));
fs.renameSync(tmp, FILE);
console.log(`Saved. Sign in as ${user.email} with that password on the server once this database is copied there.`);
