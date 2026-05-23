import { eq, and } from 'drizzle-orm';
import type { Db } from '@ollive/db';
import { conversations, messages } from '@ollive/db';
import type { LLMProvider } from '@ollive/llm-sdk';

/** Maximum characters of each turn passed to the title prompt (keeps the prompt small). */
const MAX_INPUT_CHARS = 500;

/**
 * Clean a raw model-generated title:
 * - Trim whitespace
 * - Strip surrounding single/double quotes
 * - Strip a trailing period
 * - Collapse internal whitespace
 * - Take the first `maxWords` words
 * - Return 'New conversation' if the result is empty
 *
 * Pure function.
 */
export function cleanTitle(raw: string, maxWords = 6): string {
  let s = raw.trim();
  // Strip surrounding quotes (single or double)
  s = s.replace(/^["']|["']$/g, '');
  // Strip trailing period
  s = s.replace(/\.$/, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Take first maxWords words
  const words = s.split(' ').filter(Boolean);
  s = words.slice(0, maxWords).join(' ');
  return s || 'New conversation';
}

/**
 * Call the provider with a one-shot request to generate a ≤6-word title for the conversation.
 * Tags the call with `metadata.kind='title_generation'` so it appears in dashboards.
 */
export async function generateTitle(
  provider: LLMProvider,
  model: string,
  firstUserText: string,
  firstAssistantText: string,
): Promise<string> {
  const userInput = firstUserText.slice(0, MAX_INPUT_CHARS);
  const assistantOutput = firstAssistantText.slice(0, MAX_INPUT_CHARS);

  const chatRequest = {
    model,
    messages: [
      {
        role: 'system' as const,
        content: 'Generate a concise title of at most 6 words; no quotes, no punctuation',
      },
      {
        role: 'user' as const,
        content: `User: ${userInput}\nAssistant: ${assistantOutput}`,
      },
    ],
  };

  let raw = '';
  for await (const chunk of provider.streamChat(chatRequest, {
    context: { metadata: { kind: 'title_generation' } },
  })) {
    if (chunk.delta) {
      raw += chunk.delta;
    }
  }

  return cleanTitle(raw);
}

/**
 * Fire-and-forget auto-naming side-effect.
 *
 * If the conversation's `title_source` is `'default'`, asynchronously calls the provider
 * to generate a ≤6-word title and updates the row (guarded `WHERE title_source='default'`
 * for race-safety against concurrent user renames).
 *
 * Failures swallow and log — the default title is left intact (FR17).
 * Returns void immediately; work runs on a detached promise.
 *
 * NEVER awaited on the hot path (BE12/§7.2 step 6).
 */
export function maybeAutoName(
  deps: {
    db: Db;
    provider: LLMProvider;
    model: string;
    logger?: { warn: (...args: unknown[]) => void };
  },
  conversationId: string,
): void {
  const { db, provider, model, logger } = deps;

  // Fire-and-forget: detached promise
  void (async () => {
    try {
      // Re-read the conversation row
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));

      if (!conv) return; // Conversation not found — nothing to do
      if (conv.titleSource !== 'default') return; // FR18: never clobber auto/user

      // Read the first user + first assistant message (lowest sequence of each role)
      const rows = await db
        .select({ role: messages.role, content: messages.content, sequence: messages.sequence })
        .from(messages)
        .where(eq(messages.conversationId, conversationId));

      const userMsgs = rows.filter((r) => r.role === 'user').sort((a, b) => a.sequence - b.sequence);
      const asstMsgs = rows.filter((r) => r.role === 'assistant').sort((a, b) => a.sequence - b.sequence);

      const firstUserText = userMsgs[0]?.content ?? '';
      const firstAssistantText = asstMsgs[0]?.content ?? '';

      const title = await generateTitle(provider, model, firstUserText, firstAssistantText);

      // Guarded UPDATE: only sets title when title_source is still 'default' (race-safe)
      await db
        .update(conversations)
        .set({ title, titleSource: 'auto', updatedAt: new Date() })
        .where(and(eq(conversations.id, conversationId), eq(conversations.titleSource, 'default')));
    } catch (err) {
      logger?.warn({ err }, 'auto-naming failed — leaving default title intact');
    }
  })();
}
