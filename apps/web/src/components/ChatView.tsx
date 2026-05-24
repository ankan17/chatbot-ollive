import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useChat } from '../hooks/useChat.js';
import { useGuestChat } from '../hooks/useGuestChat.js';
import type { UseGuestChatResult } from '../hooks/useGuestChat.js';
import { useConversations } from '../hooks/useConversations.js';
import { useConversation } from '../hooks/useConversation.js';
import { useSession } from '../state/sessionContext.js';
import { createConversation } from '../api/conversations.js';
import { loadGuestState } from '../state/guestMachine.js';
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
}

function AuthedChat({ conversationId, onTitle }: AuthedChatProps) {
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

  const handleSend = useCallback(async (content: string) => {
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
  const { state, remaining, limit, isStreaming, isCapped, send, stop } = guestChat;
  const messages = state.conversation.messages;
  const composerRef = useRef<ComposerHandle>(null);

  return (
    <>
      <GuestBanner remaining={remaining} limit={limit} />
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
        <GuestSignInPrompt />
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
  useEffect(() => {
    if (!isAuthenticated || importAttempted.current) return;
    const savedGuest = loadGuestState();
    if (!savedGuest || savedGuest.conversation.messages.length === 0) return;
    importAttempted.current = true;
    importOnLoginRef.current().then((conv) => {
      navigate(`/c/${conv.id}`);
    }).catch(() => {
      // If import fails (e.g. idempotent duplicate), just navigate home
      navigate('/');
    });
  }, [isAuthenticated, navigate]);

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
      <AuthedChat conversationId={id} onTitle={handleTitle} />
    </AppShell>
  );
}
