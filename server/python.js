/**
 * The Python the server's helpers run on (numpy and ecCodes): PYTHON_BIN, else the ukv-platform
 * virtualenv beside this project, else `python`. A virtualenv whose base install has moved still
 * works through its base executable with the venv's packages on PYTHONPATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let cached = null;

export function resolvePython() {
  if (cached) return cached;
  if (process.env.PYTHON_BIN) return (cached = { cmd: process.env.PYTHON_BIN, env: {} });
  const venv = path.resolve(HERE, '..', '..', 'ukv-platform', '.venv');
  const exe = path.join(venv, 'Scripts', 'python.exe');
  const cfgFile = path.join(venv, 'pyvenv.cfg');
  if (!fs.existsSync(exe) || !fs.existsSync(cfgFile)) return (cached = { cmd: 'python', env: {} });
  const cfg = {};
  for (const line of fs.readFileSync(cfgFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
    if (m) cfg[m[1]] = m[2];
  }
  if (!cfg.home || fs.existsSync(path.join(cfg.home, 'python.exe'))) return (cached = { cmd: exe, env: {} });
  if (cfg.executable && fs.existsSync(cfg.executable)) return (cached = { cmd: cfg.executable, env: { PYTHONPATH: path.join(venv, 'Lib', 'site-packages') } });
  return (cached = { cmd: exe, env: {} });
}
