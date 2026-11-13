"""The cells TCM FROST works on (UK and Ireland land, 2 km), their heights, and each model's own
ground: the 2 km heights smoothed to the model's resolution, which is what its snow line sees."""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from .config import GRID, STATIC


class Cells:
    def __init__(self):
        c = np.load(STATIC / 'cells.npz')
        self.idx = c['idx'].astype(np.int64)
        self.lat = c['lat'].astype(np.float64)
        self.lon = c['lon'].astype(np.float64)
        self.z = c['z'].astype(np.float32)
        self.zmax = c['zmax'].astype(np.float32)
        self.zstd = c['zstd'].astype(np.float32)
        self.n = self.idx.size
        self._ground = {}

    def ground(self, res_km):
        """A model's ground at the cells: the 2 km heights smoothed to its resolution."""
        if res_km <= 2.5:
            return self.z
        if res_km not in self._ground:
            dem = np.load(STATIC / 'dem2km.npy').astype(np.float32)
            sigma = 0.5 * res_km / (GRID['dx'] / 1000.0)       # a model resolves about twice its spacing
            self._ground[res_km] = ndimage.gaussian_filter(dem, sigma, mode='nearest').ravel()[self.idx].astype(np.float32)
        return self._ground[res_km]

    def full(self, values, fill=np.nan):
        """Values at the cells as the whole grid (row 0 = north)."""
        out = np.full(GRID['nx'] * GRID['ny'], fill, np.float32)
        out[self.idx] = values
        return out.reshape(GRID['ny'], GRID['nx'])
