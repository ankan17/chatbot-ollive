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
import type { SseDoneData } from '../api/types.js';
import MessageList from './MessageList.js';
import Composer from './Composer.js';
import Sidebar from './Sidebar.js';
import GuestBanner from './GuestBanner.js';
import GuestSignInPrompt from './GuestSignInPrompt.js';
import Spinner from './states/Spinner.js';
import EmptyState from './states/EmptyState.js';
import styles from './ChatView.module.css';

// ─── Authed chat with history load ────────────────────────────────────────────

interface AuthedChatProps {
  conversationId: string | undefined;
  onFirstDone?: (d: SseDoneData) => void;
}

function AuthedChat({ conversationId, onFirstDone }: AuthedChatProps) {
  const navigate = useNavigate();
  const { state, isStreaming, send, stop, reset } = useChat(
    conversationId ?? '',
    onFirstDone,
  );

  // Load history when conversationId is set (FE4 — resume)
  const { data: convData, status: convStatus } = useConversation(conversationId);
  const resetDone = useRef(false);

  useEffect(() => {
    if (convData && !resetDone.current) {
      resetDone.current = true;
      reset(convData.messages);
    }
  }, [convData, reset]);

  // Reset the flag when conversationId changes
  useEffect(() => {
    resetDone.current = false;
  }, [conversationId]);

  // On mount, check if there's a pending send from a just-created conversation
  useEffect(() => {
    if (!conversationId) return;
    const pending = sessionStorage.getItem('ollive.pendingSend');
    if (pending) {
      sessionStorage.removeItem('ollive.pendingSend');
      send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function handleSend(content: string) {
    if (!conversationId) {
      // No conversation yet — create, navigate, then send on mount
      const conv = await createConversation();
      sessionStorage.setItem('ollive.pendingSend', content);
      navigate(`/c/${conv.id}`);
    } else {
      send(content);
    }
  }

  if (conversationId && convStatus === 'loading' && state.messages.length === 0) {
    return <Spinner />;
  }

  return (
    <>
      {state.messages.length === 0 && !isStreaming ? (
        <div className={styles.emptyCenter}>
          <EmptyState
            title="Start a conversation"
            description="Ask anything — your conversation will be saved automatically."
          />
        </div>
      ) : (
        <MessageList messages={state.messages} isStreaming={isStreaming} />
      )}
      <Composer isStreaming={isStreaming} onSend={handleSend} onStop={stop} />
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

  return (
    <>
      <GuestBanner remaining={remaining} limit={limit} />
      {messages.length === 0 && !isStreaming ? (
        <div className={styles.emptyCenter}>
          <EmptyState
            title="Try Ollive for free"
            description="Send a message to start your free trial."
          />
        </div>
      ) : (
        <MessageList messages={messages} isStreaming={isStreaming} />
      )}
      {isCapped ? (
        <GuestSignInPrompt />
      ) : (
        <Composer isStreaming={isStreaming} onSend={send} onStop={stop} />
      )}
    </>
  );
}

// ─── Root ChatView ─────────────────────────────────────────────────────────────

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, status: sessionStatus } = useSession();

  const conversations = useConversations();

  // Single useGuestChat instance — used by both guest rendering AND import-on-login
  const guestChat = useGuestChat();

  // Import-on-login: when session flips to authenticated AND there's a buffered guest conversation
  const importAttempted = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || importAttempted.current) return;
    const savedGuest = loadGuestState();
    if (!savedGuest || savedGuest.conversation.messages.length === 0) return;
    importAttempted.current = true;
    guestChat.importOnLogin().then((conv) => {
      navigate(`/c/${conv.id}`);
    }).catch(() => {
      // If import fails (e.g. idempotent duplicate), just navigate home
      navigate('/');
    });
  // Only re-run when isAuthenticated changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // FE11: after first response done, refresh the conversation title in the sidebar
  const handleFirstDone = useCallback(
    (_d: SseDoneData) => {
      if (id) {
        void conversations.refreshOne(id);
      }
    },
    [id, conversations],
  );

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
    <div className={styles.chatView}>
      <Sidebar
        conversations={conversations.items}
        activeId={id}
        statusFilter={conversations.statusFilter}
        status={conversations.status}
        onSelect={(convId) => navigate(`/c/${convId}`)}
        onNew={() => navigate('/')}
        onToggleFilter={conversations.setStatusFilter}
        onRename={conversations.rename}
        onArchive={conversations.archive}
      />
      <div className={styles.main}>
        {authError && (
          <div className={styles.authError}>
            Sign-in failed. Please try again.
          </div>
        )}
        <AuthedChat conversationId={id} onFirstDone={handleFirstDone} />
      </div>
    </div>
  );
}
