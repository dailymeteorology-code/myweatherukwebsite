/* Undo and redo for a graphic: snapshots of what it is made of (areas, labels, arrows, the
   timeline, hazards…), recorded a moment after each change settles, so a drag or a burst of clicks
   is one step rather than dozens. Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on a Mac).
   Typing in a box keeps the box's own undo. */
import { useCallback, useEffect, useRef, useState } from 'react';

const LIMIT = 120;
const typing = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/** `snapshot`: the current state (a new object whenever any part changes). `apply(s)`: puts a
    snapshot back. */
export default function useHistory(snapshot, apply, { delay = 450 } = {}) {
  const past = useRef([]);
  const future = useRef([]);
  const committed = useRef(snapshot);
  const latest = useRef(snapshot);
  const applying = useRef(false);
  const timer = useRef(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const [, bump] = useState(0);
  latest.current = snapshot;

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (latest.current === committed.current) return;
    past.current.push(committed.current);
    if (past.current.length > LIMIT) past.current.shift();
    committed.current = latest.current;
    future.current = [];
    bump((n) => n + 1);
  }, []);

  useEffect(() => {
    /* an undo or redo landing: it is the new baseline, and the buttons re-read what they can do */
    if (applying.current) { applying.current = false; committed.current = snapshot; bump((n) => n + 1); return undefined; }
    if (snapshot === committed.current) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, delay);
    return undefined;
  }, [snapshot, delay, commit]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const undo = useCallback(() => {
    commit();
    if (!past.current.length) return;
    future.current.push(committed.current);
    committed.current = past.current.pop();
    applying.current = true;
    applyRef.current(committed.current);
    bump((n) => n + 1);
  }, [commit]);
  const redo = useCallback(() => {
    commit();
    if (!future.current.length) return;
    past.current.push(committed.current);
    committed.current = future.current.pop();
    applying.current = true;
    applyRef.current(committed.current);
    bump((n) => n + 1);
  }, [commit]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const pending = latest.current !== committed.current;
  return { undo, redo, canUndo: past.current.length > 0 || pending, canRedo: future.current.length > 0 && !pending };
}
