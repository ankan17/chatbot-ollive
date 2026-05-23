import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { nextShown, useTypewriter, TYPEWRITER_CONFIG } from '../hooks/useTypewriter.js';

const CFG = TYPEWRITER_CONFIG;

describe('nextShown', () => {
  it('returns the target length when already caught up', () => {
    expect(nextShown(10, 10, 1, CFG)).toBe(10);
  });

  it('never exceeds the target length in a single step', () => {
    // huge dt would overshoot; must clamp to target
    expect(nextShown(9.5, 10, 1, CFG)).toBe(10);
  });

  it('advances at the floor speed when the backlog is tiny', () => {
    // remaining 10 → 10/0.4 = 25 cps is below minCps, so minCps (60) applies
    const dt = 0.01;
    const advanced = nextShown(0, 10, dt, { minCps: 60, maxCps: 900, catchUpSec: 0.4 });
    expect(advanced).toBeCloseTo(60 * dt, 5);
  });

  it('caps advance speed at maxCps for a large backlog', () => {
    const dt = 0.01;
    const advanced = nextShown(0, 1_000_000, dt, { minCps: 60, maxCps: 900, catchUpSec: 0.4 });
    expect(advanced).toBeCloseTo(900 * dt, 5);
  });

  it('speeds up adaptively between the floor and cap as backlog grows', () => {
    const dt = 0.01;
    const cfg = { minCps: 60, maxCps: 900, catchUpSec: 0.4 };
    // remaining 200 → 200/0.4 = 500 cps, between floor and cap
    const advanced = nextShown(0, 200, dt, cfg);
    expect(advanced).toBeCloseTo(500 * dt, 5);
  });
});

describe('useTypewriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the full text immediately when not animating', () => {
    const { result } = renderHook(() =>
      useTypewriter('Hello world', { animate: false, expectMore: false }),
    );
    expect(result.current.text).toBe('Hello world');
    expect(result.current.typing).toBe(false);
  });

  it('reveals text progressively while animating, then catches up', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ t }) => useTypewriter(t, { animate: true, expectMore: true }),
      { initialProps: { t: '' } },
    );

    // The whole response arrives at once (a big provider chunk).
    rerender({ t: 'A'.repeat(100) });

    act(() => {
      vi.advanceTimersByTime(50);
    });
    const partial = result.current.text.length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(100);
    expect(result.current.typing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.text).toBe('A'.repeat(100));
    expect(result.current.typing).toBe(false);
  });

  it('flushes to the full text instantly when animate flips to false (stop)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ animate }) => useTypewriter('A'.repeat(100), { animate, expectMore: animate }),
      { initialProps: { animate: true } },
    );

    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current.text.length).toBeLessThan(100);

    // User pressed Stop → no longer animating.
    rerender({ animate: false });
    expect(result.current.text).toBe('A'.repeat(100));
    expect(result.current.typing).toBe(false);
  });
});
