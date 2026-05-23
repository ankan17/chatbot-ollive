# Edit Messages & Conversation Branching — Design Spec

**Date:** 2026-05-24
**Status:** Awaiting review
**Branch:** off `feat/ui-dark-premium`
**Scope:** `packages/db` (schema + migration), `packages/shared` (DTOs/validation), `apps/api` (conversations + chat routes, repository, context builder), `apps/web` (chat state, hooks, message UI).
**Reference visuals:** `.superpowers/brainstorm/8662-1779560872/content/tree-model.html` (tree model + fork types) and `…/ui-affordances.html` (message controls + pager + edit mode).

---

## 1. Goal

Let signed-in users **edit an earlier prompt** or **regenerate an assistant reply** without losing the original. Each edit or regeneration creates an alternative *branch*; the prior version and everything under it is preserved and navigable via a per-message **‹ n / m ›** pager. The conversation remembers which branch you're on — at every fork — so reloading or opening on another device restores the exact path you were viewing.

This replaces the current strictly-linear message model (a `(conversation_id, sequence)` unique index) with a **message tree**: every message points to its parent, and the active path is resolved by descending per-fork "active child" pointers from an active root.

**Success criteria**
- Editing a user message forks a new branch from that point and generates a fresh reply; the original branch remains, reachable via the pager.
- Regenerating an assistant message adds a sibling reply under the same prompt; both are reachable via the pager.
- The active branch selection is persisted per fork and restored on reload / other devices.
- The LLM only ever receives the **active path** (root → current leaf), never off-path branches.
- Existing linear conversations migrate to single-path trees with identical rendering.
- New behavior is covered by tests; existing API, streaming, guest, and metrics behavior is unaffected.

**Non-goals**
- Branching in **guest** (signed-out) conversations — the guest flow stays linear; edit/branch controls are hidden when signed out. The import contract is unchanged.
- **Editing assistant messages in place** — assistant content changes only via regenerate.
- **Deleting** messages or branches.
- Per-branch model overrides (regenerate uses the conversation's current model).

---

## 2. Data model

### `messages` (changes)
- **Add** `parent_id uuid` — nullable, self-references `messages.id`, `ON DELETE CASCADE`. `NULL` = a root message. A message's *siblings* are rows sharing its `parent_id` (for roots, `parent_id IS NULL`), ordered by `sequence`.
- **Add** `active_child_id uuid` — nullable, references `messages.id`, `ON DELETE SET NULL`. The currently-selected child among this message's children. `NULL` = leaf of the active path (or no children).
- **Drop** the `uq_msg_conv_seq` unique index. Conversation-wide sequence uniqueness is incompatible with siblings.
- **Keep** `sequence` as a per-conversation monotonic insert counter (still assigned `max(sequence)+1` on every insert). Its only remaining job is to order siblings deterministically (v1 before v2). The `Message` DTO and frontend keep using it, minimizing churn.

### `conversations` (changes)
- **Add** `active_root_id uuid` — nullable, references `messages.id`, `ON DELETE SET NULL`. Which root is active (editing the first message produces sibling roots, so this can't be implicit).

### Source of truth & path resolution
The active path is **derived**, not stored as a leaf:

```
start at conversation.active_root_id
while message.active_child_id is not null:
    message = message.active_child_id
# the path is the chain of messages visited; the last is the active leaf
```

Storing pointers per fork (rather than a single leaf) means switching an upper fork lands you back wherever you last were in that subtree — full per-fork memory.

### Tree behaviors
- **New turn:** insert user message as child of the active leaf, then assistant child of that. Set leaf→user and user→assistant `active_child_id`.
- **Edit a prompt:** insert a new user message with the **same `parent_id`** as the edited one, then its assistant child. Repoint the parent's `active_child_id` (or `active_root_id` if the edited message was a root) to the new user message, and chain down — you land on your new edit.
- **Regenerate:** insert a new assistant message with the same `parent_id` (the user turn) as the existing reply. Repoint that user message's `active_child_id` to the new assistant — you land on the new reply.
- **Forest case:** editing the very first message creates a second root. The `parent_id IS NULL` sibling query and `active_root_id` handle this with no special-casing.

### Migration (backfill)
For each conversation, ordered by `sequence`:
1. Set each message's `parent_id` to its predecessor's id; the first message → `NULL`.
2. Set each message's `active_child_id` to its successor's id; the last → `NULL`.
3. Set the conversation's `active_root_id` to the first message's id.

Existing linear threads become single-path trees — identical rendering, now branchable. Drop `uq_msg_conv_seq` in the same migration.

---

## 3. API & backend logic

All routes remain user-scoped (SE8): a conversation or message not owned by the requester returns `not_found`.

### `POST /v1/conversations/:id/messages` *(extend)*
Handles both new turns **and** edits.
- Body: `{ content: string, parentId?: string }`. `parentId` defaults to the conversation's active leaf (descend `active_root_id`/`active_child_id` server-side) — i.e. today's "append to the end."
- **New turn:** client omits `parentId`.
- **Edit:** client sends new `content` + `parentId` = the edited message's own `parentId`. For a normal nested message that's the message above it (a string); for the first message it's `null`.
- `parentId` is three-valued: **omitted** = attach under the active leaf (new turn); **`"<id>"`** = attach as a child of that message; **`null`** = attach as a root sibling. Editing therefore needs no special endpoint — the client always forwards `editedMessage.parentId` as-is.
- Server, in one transaction: insert user message (child of `parentId`, `sequence = max+1`), pre-create assistant child (`sequence = max+2`, `status='partial'`), repoint the parent's `active_child_id` (or `active_root_id` when `parentId` is `null`) to the new user message and the user's `active_child_id` to the assistant. Then stream (existing `runChatStream`). Context fed to the LLM = the **active path from root down to the new user turn** (not the whole tree).
- Validation: `parentId`, when a string, must reference a message in this conversation → else `validation_error`.

### `POST /v1/conversations/:id/messages/:messageId/regenerate` *(new)*
- `:messageId` is the assistant message to redo (validated `role === 'assistant'`, belongs to conversation).
- Server inserts a new assistant message under the same `parent_id`, repoints that parent's `active_child_id` to it, streams. No request body (uses the conversation's model).

### `POST /v1/conversations/:id/active-branch` *(new)*
- Body: `{ messageId: string }` — "make this message the active choice among its siblings."
- Server: if the message has a parent, set `parent.active_child_id = messageId`; if it's a root, set `conversation.active_root_id = messageId`. Validates ownership + membership. One fork pointer per call; the path below is whatever that branch already remembers.

### `GET /v1/conversations/:id` *(extend response)*
- Returns **all** messages (each with `parentId` and `activeChildId`), ordered by `sequence`, plus the conversation's `activeRootId`. The client descends to resolve the active path and computes sibling pagers from the full set. Payloads are chat-sized, so no server-side path filtering.

### Shared DTO / validation changes (`packages/shared`)
- `Message`: add `parentId: string | null`, `activeChildId: string | null`.
- `Conversation` / `ConversationDetail`: add `activeRootId: string | null`.
- `chatMessageSchema`: add `parentId: string | null` (optional; omitted = active leaf, `null` = root sibling).
- New `regenerate` route (no body) and `activeBranchSchema = { messageId: string }`.

### Context builder
`buildContext` is fed the **active path** to the attach point, not the full ordered history. The budget/trim logic is otherwise unchanged.

### Auto-naming
Unchanged. It fires only when the conversation's first response completes (`maxSeq === 0` today). Edits/regens never occur at `maxSeq === 0`, so no accidental renames.

---

## 4. Frontend (`apps/web`)

### State (`chatReducer` / `useChat`)
Replace the flat `messages[]` with:
- `messagesById: Record<id, ChatMessage>` (each carries `parentId`, `activeChildId`), plus `activeRootId`.
- A **selector** that descends from `activeRootId` via `activeChildId` to produce the ordered *visible path*, and for each message on it computes sibling info `{ index, count, prevSiblingId, nextSiblingId }` (siblings = same `parentId`, ordered by `sequence`).

### Actions
- `send(content)` → new turn under the active leaf (UX unchanged).
- `edit(messageId, content)` → `send` with `parentId = message.parentId`; optimistically insert the new user sibling + assistant child and repoint local `active_child_id`/`active_root_id`.
- `regenerate(assistantId)` → call the regenerate route; insert a new assistant sibling, stream into it, repoint the parent's `activeChildId`.
- `switchBranch(messageId, dir)` → choose prev/next sibling, set the fork pointer **optimistically**, and `POST /active-branch` to persist. The path below follows the remembered `activeChildId` pointers (no recomputation needed).

### Optimistic streaming with temp ids
Keep the existing temp-user-id + assistant-id-from-`start` approach, additionally threading the `parentId` that was sent so the local subtree can be built immediately (`newUser(tempId, parent=sent) → assistant(startId, parent=tempId)`; regenerate attaches the streamed assistant under the existing parent). Real ids reconcile on the next `GET`.

### Components
- `MessageBubble`: hover toolbar — **✎ Edit** on user messages, **↻ Regenerate** / **⧉ Copy** on assistant; an inline **‹ n / m ›** pager when the message has siblings (placement per `ui-affordances.html`).
- Edit mode swaps the bubble for an inline textarea with **Cancel** / **Save & submit**.
- All edit / regenerate / switch controls are **disabled while a stream is in flight** (`phase === 'sending' | 'streaming'`).
- `Composer` is unchanged for normal new turns.

---

## 5. Edge cases & error handling

- **Invalid `parentId` / regenerate target / `active-branch` `messageId`** → `validation_error` (or route `not_found`) before any DB write. Regenerate validates `role === 'assistant'`.
- **Ownership scoping** unchanged: another user's conversation/message → `not_found` on every path.
- **Editing the first message** creates a sibling root (forest); handled by `parent_id IS NULL` + `active_root_id`.
- **Cancel / error mid-stream** keeps today's behavior: the partial/error assistant remains on the active path as the active leaf (it was already repointed at insert time).
- **Concurrency:** edit/regenerate/switch are disabled in the UI while streaming; the server validates each request independently.
- **Dangling pointers:** `active_child_id` / `active_root_id` use `ON DELETE SET NULL`; `parent_id` uses `ON DELETE CASCADE` (a subtree can't outlive its parent). Deletion isn't exposed in v1, but the constraints keep integrity.

---

## 6. Testing

Follows the repo's existing TDD layout (`apps/api/test`, `apps/web/src/test`, `packages/db/test`).

- **Repository / DB:** insert sibling (edit + regenerate), descend the active path, sibling ordering by `sequence`, repoint fork pointers, root-sibling (forest) case. **Migration backfill:** a seeded linear conversation produces the correct `parent_id` chain, `active_child_id` chain, and `active_root_id`.
- **Routes:** `POST /messages` with `parentId` (new turn vs. edit vs. root edit), `regenerate` (rejects non-assistant target), `POST /active-branch` (sets parent vs. root pointer), scoping → `not_found`, validation errors. `GET` returns the full tree + `activeRootId` + per-message `activeChildId`.
- **Context builder:** feeds only the active path to the attach point, not off-path branches.
- **Frontend:** selector path-descent + sibling-pager math; `edit` / `regenerate` / `switchBranch` actions and optimistic tree updates; component tests for edit mode and pager visibility; controls disabled while streaming.
- **No regression:** existing API, streaming, guest, and metrics suites stay green.
