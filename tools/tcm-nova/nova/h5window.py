"""Read only the UK window of a global NetCDF-4/HDF5 file, over HTTP.

The Met Office Global 3-D files are ~160-230 MB each (870 MB for one time step's
profile). They are HDF5 with the field stored in 128x128 deflate chunks per level, so the
UK needs about 4 chunks a level: ~1 MB a variable. This opens the file's metadata with
h5py through HTTP range reads, asks HDF5 where each needed chunk lives, fetches just those
byte ranges (coalesced, in parallel) and inflates them here.
"""
from __future__ import annotations

import http.client
import io
import time
import urllib.parse
import zlib

import numpy as np

from .io_aws import fetch_ranges, get


class _HTTPFile(io.RawIOBase):
    """The file over HTTP range reads on ONE kept-alive connection. Its HDF5 metadata is
    scattered through the file (~135 small reads, whatever the buffer size), and a fresh
    TCP + TLS connection per read cost ~4 round trips each: ~60 s a file from a GitHub
    runner in the US to eu-west-2 (20 Oct 2026), the slowest model fetch of every frame."""
    def __init__(self, url):
        from .config import UA
        u = urllib.parse.urlsplit(url)
        self.url, self.pos, self.ua = url, 0, dict(UA)
        self.host, self.path = u.netloc, u.path + (f'?{u.query}' if u.query else '')
        self.conn = None
        self.size = int(self._request('HEAD').getheader('Content-Length'))

    def _request(self, method, rng=None):
        last = None
        for i in range(5):
            try:
                if self.conn is None:
                    self.conn = http.client.HTTPSConnection(self.host, timeout=60)
                h = dict(self.ua)
                if rng:
                    h['Range'] = f'bytes={rng[0]}-{rng[1]}'
                self.conn.request(method, self.path, headers=h)
                r = self.conn.getresponse()
                if method == 'HEAD':
                    r.read()
                if r.status in (200, 206):
                    return r
                r.read()
                last = RuntimeError(f'{self.url}: HTTP {r.status}')
                if r.status in (403, 404):
                    raise last
            except (http.client.HTTPException, OSError) as e:
                last = e
                if self.conn is not None:
                    self.conn.close()
                self.conn = None
            time.sleep(1.5 * (i + 1))
        raise RuntimeError(f'{self.url}: {last}')

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None
        super().close()

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        try:
            data = self._request('GET', (self.pos, end)).read()
        except Exception:                       # the old path: a new connection per read
            data = get(self.url, (self.pos, end), tries=5, timeout=60)
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def read_window(url, lat_lim=(47.0, 63.0), lon_lim=(-14.0, 5.5), p_min_pa=19_900.0):
    """(values (nlev, ny, nx) float32 with NaN fill, lat axis, lon axis, levels Pa or None)."""
    import h5py
    with h5py.File(io.BufferedReader(_HTTPFile(url), 1 << 14), 'r') as h:
        name = next(k for k, v in h.items() if isinstance(v, h5py.Dataset) and v.ndim >= 2
                    and not k.endswith('_bnds') and k not in ('flag', 'latitude_longitude'))
        d = h[name]
        lat = h['latitude'][:].astype(float)
        lon = h['longitude'][:].astype(float)
        rows = np.flatnonzero((lat >= lat_lim[0]) & (lat <= lat_lim[1]))
        cols = np.flatnonzero((lon >= lon_lim[0]) & (lon <= lon_lim[1]))
        r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
        lev = None
        kidx = [None]
        if d.ndim == 3:
            if 'pressure' in h:
                lev = h['pressure'][:].astype(float)
                kidx = [int(k) for k in np.flatnonzero(lev >= p_min_pa)]
            else:
                kidx = list(range(d.shape[0]))
        cy, cx = d.chunks[-2:]
        filters = [d.id.get_create_plist().get_filter(i)[0] for i in range(d.id.get_create_plist().get_nfilters())]
        if any(f not in (1,) for f in filters):          # only deflate is handled here
            raise RuntimeError(f'unsupported HDF5 filters {filters}')
        fill = d.attrs.get('_FillValue', None)
        scale = float(d.attrs.get('scale_factor', 1.0))
        offset = float(d.attrs.get('add_offset', 0.0))
        want = []
        for ki, k in enumerate(kidx):
            for ry in range(r0 // cy, (r1 - 1) // cy + 1):
                for rx in range(c0 // cx, (c1 - 1) // cx + 1):
                    coord = ((k,) if k is not None else ()) + (ry * cy, rx * cx)
                    info = d.id.get_chunk_info_by_coord(coord)
                    want.append((info.byte_offset, info.byte_offset + info.size - 1, (ki, ry, rx, info.filter_mask)))
        dtype = d.dtype
        ndim = d.ndim
    got = fetch_ranges(url, want, gap=256_000, workers=8)
    nk = len(kidx)
    out = np.full((nk, r1 - r0, c1 - c0), np.nan, np.float32)
    for (ki, ry, rx, mask), raw in got.items():
        data = zlib.decompress(raw) if not (mask & 1) else raw
        a = np.frombuffer(data, dtype=dtype).reshape(cy, cx).astype(np.float32)
        y0, x0 = ry * cy, rx * cx
        ys, ye = max(y0, r0), min(y0 + cy, r1)
        xs, xe = max(x0, c0), min(x0 + cx, c1)
        out[ki, ys - r0:ye - r0, xs - c0:xe - c0] = a[ys - y0:ye - y0, xs - x0:xe - x0]
    if fill is not None:
        out[out == np.float32(fill)] = np.nan
    if scale != 1.0 or offset != 0.0:
        out = out * scale + offset
    levels = None if lev is None else lev[kidx]
    return (out if ndim == 3 else out[0]), lat[r0:r1], lon[c0:c1], levels


_POOL = {}


def read_windows(urls: dict):
    """read_window for several files at once, one process each: finding the chunks costs
    ~130 small latency-bound reads per file, and h5py serialises them across threads. The
    processes are kept for the whole job (a fresh spawn re-imports the run's whole module
    tree, per file, for every time step)."""
    import concurrent.futures as cf
    import multiprocessing as mp
    import threading
    with _POOL.setdefault('lock', threading.Lock()):
        ex = _POOL.get('ex')
        if ex is None or _POOL.get('n', 0) < len(urls):
            if ex is not None:
                ex.shutdown(wait=False)
            ex = cf.ProcessPoolExecutor(len(urls), mp_context=mp.get_context('spawn'))
            _POOL.update(ex=ex, n=len(urls))
    try:
        futs = {k: ex.submit(read_window, u) for k, u in urls.items()}
        return {k: f.result() for k, f in futs.items()}
    except cf.process.BrokenProcessPool:
        _POOL.pop('ex', None)
        raise
