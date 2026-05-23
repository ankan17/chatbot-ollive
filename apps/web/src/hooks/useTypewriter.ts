import { useEffect, useRef, useState } from 'react';

export interface TypewriterConfig {
  /** Floor reveal speed (chars/sec) so the tail still types at a readable pace. */
  minCps: number;
  /** Cap reveal speed (chars/sec) so a large buffered chunk doesn't flash instantly. */
  maxCps: number;
  /** Aim to clear the current backlog in roughly this many seconds (adaptive catch-up). */
  catchUpSec: number;
}

export const TYPEWRITER_CONFIG: TypewriterConfig = {
  minCps: 30,
  maxCps: 350,
  catchUpSec: 0.6,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure cadence step: how many characters should be shown after `dtSec` seconds.
 * Reveals faster when more text is buffered (adaptive), floored and capped.
 */
export function nextShown(
  shown: number,
  targetLen: number,
  dtSec: number,
  cfg: TypewriterConfig,
): number {
  const remaining = targetLen - shown;
  if (remaining <= 0) return targetLen;
  const cps = clamp(remaining / cfg.catchUpSec, cfg.minCps, cfg.maxCps);
  return Math.min(targetLen, shown + cps * dtSec);
}

export interface UseTypewriterOptions {
  /** Whether this message participates in the typewriter at all. */
  animate: boolean;
  /** Whether more text may still arrive (stream active). Keeps the loop alive when caught up. */
  expectMore: boolean;
}

export interface TypewriterResult {
  /** The revealed prefix of `target`. */
  text: string;
  /** True while the reveal is still catching up to `target`. */
  typing: boolean;
}

/**
 * Reveals `target` as a growing prefix at an adaptive cadence, decoupling display
 * from the bursty arrival of streamed tokens. When `animate` is false the full
 * text shows immediately (history messages, or an instant flush on stop/error).
 */
export function useTypewriter(target: string, opts: UseTypewriterOptions): TypewriterResult {
  const { animate, expectMore } = opts;

  const targetRef = useRef(target);
  targetRef.current = target;
  const expectMoreRef = useRef(expectMore);
  expectMoreRef.current = expectMore;

  // Lazy init: history (animate=false) starts fully shown; a live message starts empty.
  const shownRef = useRef(animate ? 0 : target.length);
  const [shown, setShown] = useState(shownRef.current);

  useEffect(() => {
    if (!animate) {
      // Not animating (history, stop, error) → snap to full text.
      shownRef.current = targetRef.current.length;
      setShown(shownRef.current);
      return;
    }

    let raf = 0;
    let last = 0;

    const tick = (ts: number) => {
      const dtSec = last ? (ts - last) / 1000 : 0;
      last = ts;

      const targetLen = targetRef.current.length;
      const next = nextShown(shownRef.current, targetLen, dtSec, TYPEWRITER_CONFIG);
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }

      // Keep ticking while more text may arrive, or until we've caught up.
      if (expectMoreRef.current || next < targetRef.current.length) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [animate]);

  const shownCount = Math.floor(shown);
  return {
    text: target.slice(0, shownCount),
    typing: animate && shownCount < target.length,
  };
}
