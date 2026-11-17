"""Model Data's Python, kept running (17 Nov 2026, the user: "the data loading needs to take sub 10 seconds max").

Every layer used to start a Python of its own. On this PC (an AMD FX-6350, shared with the browser and the
rest of the site) that Python spent about 50 s before it made a frame: 15 s importing, 22 s more on the map
tools the first field needs, and 18 s while numba loaded its compiled sampler. A worker pays that once, when
it starts, and is then given job after job by the server (server/mdWorkers.js), one at a time, so a layer
nobody has opened yet shows its first frame in a few seconds.

    python -m mdata.worker            MDATA_GRID says which display grid it serves (common.py fixes it at import)

The server writes one JSON object a line on stdin:
    {"cmd": "run", "id": 7, "module": "mdata.job", "argv": ["gfs", "2026-11-17T12:00Z", "t2", "6"],
     "lane": "user" | "background", "env": {"MDATA_THREADS": "16"}}
    {"cmd": "cancel", "id": 7}        job 7 stops before its next step (mdata/job.py CANCEL); its frames are kept
and reads the lines on stdout that begin with MARK:
    {"ready": true, "pid": 1234, "grid": "eu", "sec": 41.2}
    {"id": 7, "code": 0, "sec": 12.3}, {"id": 7, "code": 0, "cancelled": true} or {"id": 7, "code": 1, "err": "..."}
Whatever the jobs print goes to stderr. A worker leaves after MAX_JOBS jobs, or once it holds more than
MAX_MB of memory, so it cannot creep; the server starts another when it needs one.
"""
from __future__ import annotations

import contextlib
import json
import os
import queue
import runpy
import sys
import threading
import time
import traceback

MARK = '@@mdata '
MAX_JOBS = 60
MAX_MB = 1100                                         # 17 Nov 2026: at 1.8 GB four of them pushed the PC (16 GB) into paging
_OUT = sys.stdout                                     # the server's channel: everything else goes to stderr
_SAY = threading.Lock()


def say(obj):
    with _SAY:
        _OUT.write(MARK + json.dumps(obj, separators=(',', ':')) + '\n')
        _OUT.flush()


def set_lane(lane):
    """Background work (the warming, the Location page's catching up) below normal priority, someone's own layer
    at normal priority. Not Windows' background mode, which a background job's own process used to have
    (common.py): it puts the processor, the disk and the memory all at very low priority, and on this PC, whose
    processor is busy most of the time, such a job hardly ran (17 Nov 2026: 17 s to write its first status file,
    too slow even to stop when asked; and the warming had made almost nothing all day)."""
    if os.name != 'nt':
        return
    try:
        import ctypes
        k = ctypes.windll.kernel32
        k.GetCurrentProcess.restype = ctypes.c_void_p
        k.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        h = k.GetCurrentProcess()
        k.SetPriorityClass(h, 0x00004000 if lane == 'background' else 0x00000020)   # BELOW_NORMAL / NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def memory_mb():
    """This process's private memory, in MB (Windows; None elsewhere)."""
    if os.name != 'nt':
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD), ('PeakWorkingSetSize', ctypes.c_size_t),
                        ('WorkingSetSize', ctypes.c_size_t), ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaPagedPoolUsage', ctypes.c_size_t), ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaNonPagedPoolUsage', ctypes.c_size_t), ('PagefileUsage', ctypes.c_size_t),
                        ('PeakPagefileUsage', ctypes.c_size_t), ('PrivateUsage', ctypes.c_size_t)]
        c = PMC()
        c.cb = ctypes.sizeof(PMC)
        k = ctypes.windll.kernel32
        k.GetCurrentProcess.restype = ctypes.c_void_p
        f = ctypes.windll.psapi.GetProcessMemoryInfo
        f.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wintypes.DWORD]
        if f(k.GetCurrentProcess(), ctypes.byref(c), c.cb):
            return c.PrivateUsage / 1e6
    except Exception:
        pass
    return None


def warm():
    """What the first field of a layer would otherwise pay for: the display grid's coordinates, numba's
    compiled sampler, and the libraries the models open files with."""
    from . import common, job                          # noqa: F401  (imports every model)
    try:
        common.lonlat()
    except Exception:
        pass
    if common.njit:
        try:
            import numpy as np
            common._cubic_kernel(np.zeros((4, 4)), np.zeros(1), np.zeros(1), False)
        except Exception:
            pass
    for name in ('pyproj', 'scipy.ndimage', 'eccodes', 'h5py', 'netCDF4'):
        try:
            __import__(name)
        except Exception:
            pass


def run(m, now):
    from . import job
    jid = m.get('id')
    env = {str(k): str(v) for k, v in (m.get('env') or {}).items()}
    lane = 'background' if m.get('lane') == 'background' else 'user'
    env['MDATA_LANE'] = lane                           # mdata/ens.py reads it as it goes
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    set_lane(lane)
    job.LANE = lane
    job.CANCEL.clear()
    now['id'] = jid
    t0 = time.time()
    out = {'id': jid, 'code': 0}
    try:
        with contextlib.redirect_stdout(sys.stderr):
            module, argv = m.get('module', 'mdata.job'), [str(a) for a in m.get('argv') or []]
            if module == 'mdata.job':
                job.main(*argv[:4])
            elif module == 'mdata.ens':
                from . import ens
                ens.main(*argv[:4])
            else:                                      # any other `python -m` command, its imports already paid for
                saved = sys.argv
                sys.argv = [module, *argv]
                try:
                    runpy.run_module(module, run_name='__main__', alter_sys=False)
                finally:
                    sys.argv = saved
    except job.Cancelled:
        out['cancelled'] = True
    except SystemExit as e:
        out['code'] = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:                              # noqa: BLE001  (a job's failure never takes the worker down)
        out['code'] = 1
        out['err'] = traceback.format_exc()[-1500:]
    finally:
        now['id'] = None
        job.CANCEL.clear()
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    out['sec'] = round(time.time() - t0, 1)
    return out


def main():
    t0 = time.time()
    warm()
    from . import common, job
    tasks = queue.Queue()
    now = {'id': None}

    def read():
        for line in sys.stdin:
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get('cmd') == 'run':
                tasks.put(m)
            elif m.get('cmd') == 'cancel' and m.get('id') is not None and m.get('id') == now['id']:
                job.CANCEL.set()
            elif m.get('cmd') == 'quit':
                break
        tasks.put(None)                                # the server has gone, or said goodbye: finish

    threading.Thread(target=read, daemon=True).start()
    say({'ready': True, 'pid': os.getpid(), 'grid': common.GRID, 'sec': round(time.time() - t0, 1)})
    done = 0
    while True:
        m = tasks.get()
        if m is None:
            break
        out = run(m, now)
        done += 1
        mb = memory_mb()
        if mb is not None:
            out['mb'] = round(mb)
        out['leaving'] = done >= MAX_JOBS or (mb is not None and mb > MAX_MB)
        say(out)
        if out['leaving']:
            break


if __name__ == '__main__':
    main()
