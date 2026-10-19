"""TCM V5 Stages 5-7, vectorised over the whole grid.

V5 runs its twelve specialist engines and its Stage 6-7 probability chain one grid cell
at a time in pure Python (about 5 ms a cell, so a 2 km frame is 25 CPU-minutes). This
package computes the SAME quantities for every cell at once with array arithmetic:

  * the transfer functions are V5's own objects, imported, never re-typed, so every
    anchor, shape and margin is V5's by construction;
  * the composition rules, the engine logic (parcel choice, forcing ceiling, mechanism
    split, significant hail, nesting) and the rounding are reproduced line for line;
  * `verify.py` runs V5's own scalar chain on sampled cells and compares.

Missing values are NaN throughout, playing the part of V5's `None`.
"""
