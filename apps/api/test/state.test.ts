import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../src/auth/state.js';

const TEST_SECRET = 'test-state-secret-at-least-32-characters';

describe('signState / verifyState', () => {
  it('sign then verify with same secret → true', () => {
    const { state } = signState(TEST_SECRET);
    expect(verifyState(state, TEST_SECRET)).toBe(true);
  });

  it('verify with different secret → false', () => {
    const { state } = signState(TEST_SECRET);
    expect(verifyState(state, 'different-secret-that-is-long-enough')).toBe(false);
  });

  it('tampered state (mutate payload, keep signature) → false', () => {
    const { state } = signState(TEST_SECRET);
    const parts = state.split('.');
    // Mutate the payload part
    const tamperedPayload = Buffer.from(
      JSON.stringify({ nonce: 'tampered', exp: Date.now() / 1000 + 600 }),
    ).toString('base64url');
    const tampered = [tamperedPayload, parts[1]].join('.');
    expect(verifyState(tampered, TEST_SECRET)).toBe(false);
  });

  it('expired state (ttlSeconds: -1) → false', () => {
    const { state } = signState(TEST_SECRET, -1);
    expect(verifyState(state, TEST_SECRET)).toBe(false);
  });

  it('two signState calls → distinct state values (nonce differs)', () => {
    const { state: state1 } = signState(TEST_SECRET);
    const { state: state2 } = signState(TEST_SECRET);
    expect(state1).not.toBe(state2);
  });
});
