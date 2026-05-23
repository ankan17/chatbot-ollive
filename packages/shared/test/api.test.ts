import { describe, it, expect } from 'vitest';
import {
  listConversationsQuerySchema,
  createConversationSchema,
  patchConversationSchema,
  importConversationSchema,
  chatMessageSchema,
  guestMessageSchema,
  metricsQuerySchema,
} from '../src/api/index.js';
import type {
  ConversationDetail,
  OverviewMetrics,
  SseEvent,
} from '../src/api/index.js';

describe('listConversationsQuerySchema', () => {
  it('parses {} with defaults', () => {
    const result = listConversationsQuerySchema.parse({});
    expect(result.status).toBe('active');
    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
  });

  it('coerces limit string to number', () => {
    const result = listConversationsQuerySchema.parse({ limit: '50' });
    expect(result.limit).toBe(50);
  });

  it('rejects limit > 100', () => {
    expect(() => listConversationsQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it('rejects limit = 0', () => {
    expect(() => listConversationsQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects bad status', () => {
    expect(() => listConversationsQuerySchema.parse({ status: 'deleted' })).toThrow();
  });

  it('accepts valid cursor', () => {
    const result = listConversationsQuerySchema.parse({ cursor: 'abc123' });
    expect(result.cursor).toBe('abc123');
  });
});

describe('createConversationSchema', () => {
  it('accepts {}', () => {
    const result = createConversationSchema.parse({});
    expect(result.title).toBeUndefined();
  });

  it('accepts { title: "x" }', () => {
    const result = createConversationSchema.parse({ title: 'x' });
    expect(result.title).toBe('x');
  });

  it('rejects { title: "" }', () => {
    expect(() => createConversationSchema.parse({ title: '' })).toThrow();
  });
});

describe('patchConversationSchema', () => {
  it('accepts { title }', () => {
    const result = patchConversationSchema.parse({ title: 'New title' });
    expect(result.title).toBe('New title');
  });

  it('accepts { status }', () => {
    const result = patchConversationSchema.parse({ status: 'archived' });
    expect(result.status).toBe('archived');
  });

  it('accepts both title and status', () => {
    const result = patchConversationSchema.parse({ title: 'T', status: 'active' });
    expect(result.title).toBe('T');
    expect(result.status).toBe('active');
  });

  it('rejects {} (at-least-one refinement)', () => {
    expect(() => patchConversationSchema.parse({})).toThrow();
  });

  it('rejects bad status enum', () => {
    expect(() => patchConversationSchema.parse({ status: 'deleted' })).toThrow();
  });
});

describe('importConversationSchema', () => {
  it('accepts a valid 1+ message array with user/assistant roles', () => {
    const result = importConversationSchema.parse({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    expect(result.messages).toHaveLength(2);
  });

  it('accepts an optional clientConversationId', () => {
    const result = importConversationSchema.parse({
      clientConversationId: 'local-id-123',
      messages: [{ role: 'user', content: 'Hey' }],
    });
    expect(result.clientConversationId).toBe('local-id-123');
  });

  it('rejects empty messages array', () => {
    expect(() => importConversationSchema.parse({ messages: [] })).toThrow();
  });

  it('rejects system role in messages', () => {
    expect(() =>
      importConversationSchema.parse({
        messages: [{ role: 'system', content: 'You are a helper' }],
      }),
    ).toThrow();
  });

  it('rejects empty content', () => {
    expect(() =>
      importConversationSchema.parse({
        messages: [{ role: 'user', content: '' }],
      }),
    ).toThrow();
  });

  it('rejects clientConversationId over 200 chars', () => {
    expect(() =>
      importConversationSchema.parse({
        clientConversationId: 'a'.repeat(201),
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow();
  });
});

describe('chatMessageSchema', () => {
  it('rejects empty content', () => {
    expect(() => chatMessageSchema.parse({ content: '' })).toThrow();
  });

  it('accepts valid content', () => {
    const result = chatMessageSchema.parse({ content: 'Hello' });
    expect(result.content).toBe('Hello');
  });
});

describe('guestMessageSchema', () => {
  it('accepts history + content', () => {
    const result = guestMessageSchema.parse({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      content: 'What about day 2?',
    });
    expect(result.messages).toHaveLength(2);
    expect(result.content).toBe('What about day 2?');
  });

  it('rejects empty content', () => {
    expect(() =>
      guestMessageSchema.parse({
        messages: [],
        content: '',
      }),
    ).toThrow();
  });
});

describe('metricsQuerySchema', () => {
  it('defaults bucket to 1m', () => {
    const result = metricsQuerySchema.parse({});
    expect(result.bucket).toBe('1m');
  });

  it('coerces from/to to dates', () => {
    const result = metricsQuerySchema.parse({
      from: '2026-05-23T00:00:00.000Z',
      to: '2026-05-23T12:00:00.000Z',
    });
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeInstanceOf(Date);
  });

  it('rejects from > to', () => {
    expect(() =>
      metricsQuerySchema.parse({
        from: '2026-05-23T12:00:00.000Z',
        to: '2026-05-23T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('type-level compile checks', () => {
  it('ConversationDetail literal compiles', () => {
    const detail: ConversationDetail = {
      id: 'c1',
      title: 'Trip planning',
      status: 'active',
      provider: 'google',
      model: 'gemini-2.5-flash',
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:05:00.000Z',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Hello',
          status: 'complete',
          sequence: 1,
          createdAt: '2026-05-23T10:00:01.000Z',
        },
      ],
    };
    expect(detail.id).toBe('c1');
  });

  it('OverviewMetrics literal compiles', () => {
    const overview: OverviewMetrics = {
      range: {
        from: '2026-05-23T00:00:00.000Z',
        to: '2026-05-23T12:00:00.000Z',
      },
      requests: 100,
      errorRate: 0.01,
      latencyMs: { p50: 100, p95: 200, p99: 300 },
      tokens: { prompt: 1000, completion: 500, total: 1500 },
      throughputPerMin: 5,
    };
    expect(overview.requests).toBe(100);
  });

  it('SseEvent literal compiles', () => {
    const event: SseEvent = {
      event: 'start',
      data: { messageId: 'm1', requestId: 'r1' },
    };
    expect(event.event).toBe('start');

    const tokenEvent: SseEvent = {
      event: 'token',
      data: { delta: 'hello ' },
    };
    expect(tokenEvent.event).toBe('token');

    const doneEvent: SseEvent = {
      event: 'done',
      data: {
        messageId: 'm1',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    };
    expect(doneEvent.event).toBe('done');
  });
});
