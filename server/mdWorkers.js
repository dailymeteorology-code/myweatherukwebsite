/* Model Data's Python workers (17 Nov 2026, the user: "the data loading needs to take sub 10 seconds max").

   Every layer used to start a Python of its own, and on this PC (an AMD FX-6350, shared with the browser and the
   rest of the site) each one spent about 50 s importing its tools before it made a frame: a layer nobody had
   opened yet showed nothing for most of a minute, and the warming paid the same 50 s for every layer it made.
   These workers (tools/modeldata/mdata/worker.py) import everything once and are then given job after job, one
   at a time each. A worker serves one display grid ('uk' or 'eu': mdata/common.py fixes it at import), so each
   grid has its own pool: `keep` of them always ready, up to `max` while there is work, the extra ones let go
   after `idleMs` with nothing to do. A worker leaves by itself after so many jobs or once it holds too much
   memory (worker.py MAX_JOBS, MAX_MB), and another is started when one is needed.

   A job running in a worker can be asked to stop between two of its steps (cancel): its frames so far are kept,
   and it carries on from them when it is given again. One that does not stop (a layer made from other layers
   has no steps to stop between) has its worker ended instead. */
import { spawn } from 'child_process';
import os from 'os';

const MARK = '@@mdata ';

export function createWorkers({ python, cwd, env = {}, keep = { uk: 1, eu: 1 }, max = { uk: 3, eu: 3 }, idleMs = 10 * 60e3, onChange = () => {} }) {
  const pool = [];
  let seq = 0;
  let timer = null;
  const live = (w) => !w.gone && !w.leaving;

  function start(grid) {
    const py = python();
    const w = { grid, child: null, ready: false, task: null, leaving: false, gone: false, jobs: 0, idleSince: Date.now(), err: '' };
    const child = spawn(py.cmd, ['-m', 'mdata.worker'], {
      cwd, windowsHide: true,
      env: { ...process.env, ...py.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', MDATA_GRID: grid, ...env },
    });
    w.child = child;
    /* while it imports, below the site; each job then sets the worker's priority for itself (worker.py set_lane) */
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not fatal */ }
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith(MARK)) continue;
        let m;
        try { m = JSON.parse(line.slice(MARK.length)); } catch { continue; }
        if (m.ready) {
          w.ready = true;
          w.idleSince = Date.now();
          console.log(`[modeldata] ${grid} worker ${child.pid} ready (${m.sec} s to start)`);
          onChange();
        } else if (w.task && m.id === w.task.id) finish(w, m);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { w.err = (w.err + d).slice(-4000); });
    const gone = (why) => {
      if (w.gone) return;
      w.gone = true;
      pool.splice(pool.indexOf(w), 1);
      if (w.task) finish(w, { id: w.task.id, code: 1, cancelled: !!w.task.cancelling, err: `the worker stopped (${why}): ${w.err.split('\n').filter(Boolean).slice(-1)[0] || ''}` });
      else if (!w.ready) console.warn(`[modeldata] ${grid} worker did not start (${why}): ${w.err.split('\n').filter(Boolean).slice(-1)[0] || ''}`);
      onChange();
    };
    child.on('exit', (code) => gone(`exit ${code}`));
    child.on('error', (e) => gone(e.message));
    child.stdin.on('error', () => { /* it has gone: 'exit' says so */ });
    pool.push(w);
    return w;
  }

  function finish(w, m) {
    const t = w.task;
    w.task = null;
    w.jobs++;
    w.idleSince = Date.now();
    clearTimeout(t.timer);
    if (m.leaving) w.leaving = true;
    const err = m.err || (m.code ? w.err : '');
    try { t.onExit(m.code ?? 0, err, { cancelled: !!m.cancelled || !!t.cancelling && !!m.code, sec: m.sec, mb: m.mb }); } catch (e) { console.warn(`[modeldata] after a job: ${e.message}`); }
    onChange();
  }

  /* housekeeping: the ones kept ready are there, the extra idle ones are let go */
  function tidy() {
    for (const grid of Object.keys(max)) {
      const mine = pool.filter((w) => w.grid === grid && live(w));
      if (mine.length < (keep[grid] || 0) && !mine.some((w) => !w.ready)) start(grid);
      const idle = mine.filter((w) => w.ready && !w.task).sort((a, b) => a.idleSince - b.idleSince);
      let spare = mine.length - (keep[grid] || 0);
      for (const w of idle) {
        if (spare <= 0) break;
        if (Date.now() - w.idleSince < idleMs) continue;
        w.leaving = true;
        try { w.child.stdin.end(); } catch { /* gone */ }
        spare--;
      }
    }
  }

  return {
    /** start keeping the ready ones, and tidy now and then */
    begin() { tidy(); timer ||= setInterval(tidy, 30e3); timer.unref?.(); },
    /** a ready worker on this grid with nothing to do, or null */
    idle(grid) { return pool.find((w) => w.grid === grid && w.ready && !w.task && live(w)) || null; },
    /** how many there are on this grid (starting ones too), and whether one is starting */
    size(grid) { return pool.filter((w) => w.grid === grid && live(w)).length; },
    starting(grid) { return pool.some((w) => w.grid === grid && !w.ready && live(w)); },
    /** another worker for this grid, unless one is already starting or there are `cap` (or max) of them */
    grow(grid, cap = max[grid]) {
      if (this.starting(grid) || this.size(grid) >= Math.min(cap, max[grid])) return false;
      start(grid);
      return true;
    },
    /** the workers on this grid busy with a job, with what they are doing */
    busy(grid) { return pool.filter((w) => w.grid === grid && w.task && !w.gone); },
    /** give a ready, idle worker a job: onExit(code, err, { cancelled, sec, mb }) */
    run(w, { module = 'mdata.job', argv = [], lane = 'user', env: jobEnv = {} }, onExit) {
      const id = ++seq;
      w.task = { id, onExit, lane, started: Date.now(), cancelling: false, timer: null };
      w.err = '';
      try { w.child.stdin.write(`${JSON.stringify({ cmd: 'run', id, module, argv, lane, env: jobEnv })}\n`); } catch (e) { finish(w, { id, code: 1, err: e.message }); }
      return id;
    },
    /** ask a worker's job to stop between steps; ended with its worker if it has not within `ms`. It is raised to
        normal priority first: below it, on a busy processor, it can take a long while to get round to stopping */
    cancel(w, ms = 30000) {
      const t = w?.task;
      if (!t || t.cancelling) return;
      t.cancelling = true;
      try { os.setPriority(w.child.pid, os.constants.priority.PRIORITY_NORMAL); } catch { /* not fatal */ }
      try { w.child.stdin.write(`${JSON.stringify({ cmd: 'cancel', id: t.id })}\n`); } catch { /* gone: 'exit' finishes it */ }
      t.timer = setTimeout(() => {
        if (w.task !== t) return;
        console.warn(`[modeldata] ${w.grid} worker ${w.child.pid}: its job did not stop when asked; ended`);
        w.leaving = true;
        try { w.child.kill(); } catch { /* gone */ }
      }, ms);
      t.timer.unref?.();
    },
    stats() {
      return pool.map((w) => ({ grid: w.grid, pid: w.child.pid, ready: w.ready, leaving: w.leaving, jobs: w.jobs, task: w.task ? { lane: w.task.lane, for: Math.round((Date.now() - w.task.started) / 1000), cancelling: w.task.cancelling } : null }));
    },
  };
}
