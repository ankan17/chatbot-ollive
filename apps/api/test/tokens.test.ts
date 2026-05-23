import { describe, it, expect } from 'vitest';
import { estimateTokens, buildContext } from '../src/chat/tokens.js';
import type { ChatMessage } from '../src/chat/tokens.js';

function msg(role: 'user' | 'assistant' | 'system', content: string): ChatMessage {
  return { role, content };
}

describe('estimateTokens', () => {
  it('empty string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('400-char string → 100', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });

  it('monotonic: longer text → not fewer tokens', () => {
    const short = estimateTokens('hello');
    const long = estimateTokens('hello world, how are you today?');
    expect(long).toBeGreaterThanOrEqual(short);
  });

  it('whitespace-only content estimates to a small positive count', () => {
    expect(estimateTokens('    ')).toBeGreaterThan(0);
  });

  it('single char → 1', () => {
    expect(estimateTokens('a')).toBe(1);
  });
});

describe('buildContext', () => {
  it('empty history → empty result, no throw', () => {
    const result = buildContext([], 4000, 1024);
    expect(result.messages).toEqual([]);
    expect(result.contextTokens).toBe(0);
    expect(result.contextMessageCount).toBe(0);
    expect(result.droppedCount).toBe(0);
  });

  it('all messages fit → returned in original chronological order, droppedCount=0', () => {
    // 3 messages of 4 chars each = 3 tokens each = 9 total; budget=4000-1024=2976
    const history = [
      msg('user', 'abcd'),        // 1 token
      msg('assistant', 'efgh'),   // 1 token
      msg('user', 'ijkl'),        // 1 token
    ];
    const result = buildContext(history, 4000, 1024);
    expect(result.messages).toEqual(history);
    expect(result.droppedCount).toBe(0);
    expect(result.contextMessageCount).toBe(3);
    // contextTokens = sum of all
    expect(result.contextTokens).toBe(estimateTokens('abcd') + estimateTokens('efgh') + estimateTokens('ijkl'));
  });

  it('budget forces trimming → only most-recent messages that fit; latest user turn always present', () => {
    // Each message ~25 tokens (100 chars); budget=100, reserve=0 => available=100
    // First 2 should be dropped, last 4 fit
    const makeMsg = (n: number) => msg(n % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(100));
    const history = Array.from({ length: 6 }, (_, i) => makeMsg(i));

    const result = buildContext(history, 100, 0);
    // Latest user turn (last element) must be present
    expect(result.messages[result.messages.length - 1]).toEqual(history[history.length - 1]);
    // Oldest messages dropped
    expect(result.droppedCount).toBeGreaterThan(0);
    // Chronological order preserved
    for (let i = 1; i < result.messages.length; i++) {
      const indexInHistory = history.indexOf(result.messages[i]);
      const prevIndexInHistory = history.indexOf(result.messages[i - 1]);
      expect(indexInHistory).toBeGreaterThan(prevIndexInHistory);
    }
  });

  it('latest user turn alone exceeds budget-reserve → result is exactly that one message', () => {
    const bigMsg = msg('user', 'x'.repeat(400)); // 100 tokens
    const history = [
      msg('user', 'short'),
      msg('assistant', 'short'),
      bigMsg,
    ];
    // budget=50, reserve=40 → available=10, but bigMsg=100 tokens > 10
    const result = buildContext(history, 50, 40);
    expect(result.messages).toEqual([bigMsg]);
    expect(result.contextMessageCount).toBe(1);
    expect(result.droppedCount).toBe(2);
  });

  it('reserveForResponse reduces effective budget → raises reserve drops more old messages', () => {
    // 4 messages of exactly 25 tokens each (100 chars)
    const history = [
      msg('user', 'a'.repeat(100)),
      msg('assistant', 'b'.repeat(100)),
      msg('user', 'c'.repeat(100)),
      msg('assistant', 'd'.repeat(100)),
    ];
    const resultNoReserve = buildContext(history, 200, 0);
    const resultWithReserve = buildContext(history, 200, 50);
    // With reserve=50, fewer old messages fit
    expect(resultWithReserve.messages.length).toBeLessThanOrEqual(resultNoReserve.messages.length);
  });

  it('droppedCount correctly reflects trimmed count', () => {
    const history = [
      msg('user', 'a'.repeat(100)),  // 25 tokens
      msg('assistant', 'b'.repeat(100)),  // 25 tokens
      msg('user', 'c'.repeat(4)),    // 1 token
    ];
    // budget=30, reserve=0 → available=30; last msg=1 token fits, second-to-last=25 tokens → 26 ≤ 30 fits, first=25 → 51 > 30 doesn't fit
    const result = buildContext(history, 30, 0);
    expect(result.droppedCount).toBe(1);
    expect(result.messages).toEqual([history[1], history[2]]);
  });
});
