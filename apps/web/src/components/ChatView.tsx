import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useChat } from '../hooks/useChat.js';
import { useGuestChat } from '../hooks/useGuestChat.js';
import type { UseGuestChatResult } from '../hooks/useGuestChat.js';
import { useConversations } from '../hooks/useConversations.js';
import { useConversation } from '../hooks/useConversation.js';
import { useSession } from '../state/sessionContext.js';
import { createConversation } from '../api/conversations.js';
import { IMPORT_DRAFT_KEY } from '../state/guestMachine.js';
import type { SseTitleData } from '../api/types.js';
import MessageList from './MessageList.js';
import Composer, { type ComposerHandle } from './Composer.js';
import ChatHero from './ChatHero.js';
import Sidebar from './Sidebar.js';
import AppShell from './AppShell.js';
import ModelSwitcher from './ModelSwitcher.js';
import { getStoredModel } from '../api/models.js';
import GuestBanner from './GuestBanner.js';
import GuestSignInPrompt from './GuestSignInPrompt.js';
import Spinner from './states/Spinner.js';
import styles from './ChatView.module.css';

// ─── Authed chat with history load ────────────────────────────────────────────

interface AuthedChatProps {
  conversationId: string | undefined;
  onTitle?: (d: SseTitleData) => void;
  /** Bumped by the root when an import resolves without a route change, to re-trigger the composer pre-fill. */
  draftSignal?: number;
}

function AuthedChat({ conversationId, onTitle, draftSignal }: AuthedChatProps) {
  const navigate = useNavigate();
  const { state, isStreaming, send, stop, reset } = useChat(
    conversationId ?? '',
    onTitle,
  );

  // Load history when conversationId is set (FE4 — resume)
  const { data: convData, status: convStatus } = useConversation(conversationId);
  const resetDone = useRef(false);
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (convData && !resetDone.current) {
      resetDone.current = true;
      // Only reset when there are messages — never clobber an in-progress fresh chat with an empty load
      if (convData.messages.length > 0) {
        reset(convData.messages);
      }
    }
  }, [convData, reset]);

  // Reset the flag when conversationId changes
  useEffect(() => {
    resetDone.current = false;
  }, [conversationId]);

  // On mount, check if there's a pending send from a just-created conversation
  useEffect(() => {
    if (!conversationId || convStatus === 'loading') return;
    const pending = sessionStorage.getItem('ollive.pendingSend');
    if (pending) {
      sessionStorage.removeItem('ollive.pendingSend');
      // Mark reset as done so the resume effect won't clobber this in-progress send
      resetDone.current = true;
      send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, convStatus]);

  // Pre-fill the composer with a message carried over from a capped guest import
  // (the message the user tried to send before signing in). Wait until history
  // has loaded so the composer is mounted.
  // Pre-fill the composer with a message carried over from a capped guest import
  // (the message the user tried to send before signing in). The draft is NOT
  // removed here — it stays in sessionStorage until the user actually sends, so a
  // remount (incl. React StrictMode's dev double-mount, or the post-import route
  // change) re-fills a fresh composer instead of losing it. `draftFilledRef`
  // keeps it to once per mount; `draftSignal` re-triggers it when no navigation
  // happens (orphan-only: the only guest message was the capped one).
  useEffect(() => {
    if (conversationId && convStatus === 'loading') return;
    const draft = sessionStorage.getItem(IMPORT_DRAFT_KEY);
    // fillIfEmpty (not fill) so a remount/StrictMode double-mount re-fills a fresh
    // composer, but a composer the user has already typed into is left untouched.
    // The draft stays in sessionStorage until send (see handleSend).
    if (draft) composerRef.current?.fillIfEmpty(draft);
  }, [conversationId, convStatus, draftSignal]);

  const handleSend = useCallback(async (content: string) => {
    // The carried-over guest draft (if any) has now been acted on — drop it so a
    // later remount doesn't re-fill it.
    sessionStorage.removeItem(IMPORT_DRAFT_KEY);
    if (!conversationId) {
      // No conversation yet — create with the selected model, navigate, then send on mount
      const conv = await createConversation({ model: getStoredModel() });
      sessionStorage.setItem('ollive.pendingSend', content);
      navigate(`/c/${conv.id}`);
    } else {
      send(content);
    }
  }, [conversationId, send, navigate]);

  if (conversationId && convStatus === 'loading' && state.messages.length === 0) {
    return <Spinner />;
  }

  return (
    <>
      {state.messages.length === 0 && !isStreaming ? (
        <ChatHero
          title="How can I help?"
          subtitle="Ask anything, or pick up where you left off. Start a conversation below."
          onPickPrompt={(p) => composerRef.current?.fill(p)}
        />
      ) : (
        <MessageList
          messages={state.messages}
          isStreaming={isStreaming}
          streamFinishing={state.phase === 'done'}
        />
      )}
      <Composer ref={composerRef} isStreaming={isStreaming} onSend={handleSend} onStop={stop} />
    </>
  );
}

// ─── Guest chat (prop-driven — single useGuestChat instance in root) ──────────

interface GuestChatProps {
  guestChat: UseGuestChatResult;
}

function GuestChat({ guestChat }: GuestChatProps) {
  const { state, remaining, limit, isStreaming, isCapped, send, stop, beginSignIn } = guestChat;
  const messages = state.conversation.messages;
  const composerRef = useRef<ComposerHandle>(null);

  return (
    <>
      <GuestBanner remaining={remaining} limit={limit} onSignIn={beginSignIn} />
      {messages.length === 0 && !isStreaming ? (
        <ChatHero
          title="Try Ollive AI Chat for free"
          subtitle="Send a message to start your free trial."
          onPickPrompt={(p) => composerRef.current?.fill(p)}
        />
      ) : (
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          streamFinishing={state.phase === 'awaiting'}
        />
      )}
      {isCapped ? (
        <GuestSignInPrompt onSignIn={beginSignIn} />
      ) : (
        <Composer ref={composerRef} isStreaming={isStreaming} onSend={send} onStop={stop} />
      )}
    </>
  );
}

// ─── Root ChatView ─────────────────────────────────────────────────────────────

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, status: sessionStatus, user, signOut } = useSession();

  const conversations = useConversations();

  // Single useGuestChat instance — used by both guest rendering AND import-on-login
  const guestChat = useGuestChat();

  // Import-on-login: when session flips to authenticated AND there's a buffered guest conversation
  const importAttempted = useRef(false);
  const importOnLoginRef = useRef(guestChat.importOnLogin);
  importOnLoginRef.current = guestChat.importOnLogin;
  // Bumped when an import resolves WITHOUT a route change (orphan-only / error),
  // so the already-mounted AuthedChat re-runs its composer pre-fill.
  const [draftSignal, setDraftSignal] = useState(0);
  useEffect(() => {
    if (!isAuthenticated || importAttempted.current) return;
    // The guest conversation was rehydrated into memory from the sign-in handoff
    // buffer (if we just returned from sign-in). Import it if non-empty.
    if (guestChat.state.conversation.messages.length === 0) return;
    importAttempted.current = true;
    importOnLoginRef.current().then((conv) => {
      // conv is null when the only guest message was a capped (unanswered) one —
      // nothing to import, so stay on the new chat and signal the pre-fill.
      if (conv) navigate(`/c/${conv.id}`);
      else setDraftSignal((n) => n + 1);
    }).catch(() => {
      // Import failed (e.g. idempotent duplicate) — stay put and still restore the draft.
      setDraftSignal((n) => n + 1);
    });
  }, [isAuthenticated, navigate, guestChat.state]);

  // FE11: the backend pushes a `title` event once the auto-generated title is
  // persisted (after the first response). Refresh the list then so the sidebar
  // reliably picks up the new name — refreshing on `done` would race the
  // still-default title.
  const handleTitle = useCallback(
    (_d: SseTitleData) => {
      void conversations.refreshOne();
    },
    [conversations],
  );

  // The model switcher targets the open conversation (if any); its model is the source of truth.
  const activeConversation = conversations.items.find((c) => c.id === id);

  const authError = searchParams.get('auth_error');

  if (sessionStatus === 'loading') {
    return <Spinner />;
  }

  if (!isAuthenticated) {
    return (
      <div className={styles.chatView}>
        <div className={styles.main}>
          {authError && (
            <div className={styles.authError}>
              Sign-in failed. Please try again.
            </div>
          )}
          <GuestChat guestChat={guestChat} />
        </div>
      </div>
    );
  }

  return (
    <AppShell
      user={user!}
      onSignOut={() => void signOut()}
      topbar={
        <ModelSwitcher
          key={id ?? 'new'}
          conversationId={id}
          conversationModel={activeConversation?.model}
          onModelChange={() => void conversations.refreshOne()}
        />
      }
      sidebar={
        <Sidebar
          conversations={conversations.items}
          activeId={id}
          statusFilter={conversations.statusFilter}
          status={conversations.status}
          onSelect={(convId) => navigate(`/c/${convId}`)}
          onToggleFilter={conversations.setStatusFilter}
          onRename={conversations.rename}
          onArchive={conversations.archive}
        />
      }
    >
      {authError && (
        <div className={styles.authError}>
          Sign-in failed. Please try again.
        </div>
      )}
      <AuthedChat conversationId={id} onTitle={handleTitle} draftSignal={draftSignal} />
    </AppShell>
  );
}
