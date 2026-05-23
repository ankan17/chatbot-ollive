import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChat } from '../hooks/useChat.js';
import { useConversations } from '../hooks/useConversations.js';
import { useConversation } from '../hooks/useConversation.js';
import { useSession } from '../state/sessionContext.js';
import { createConversation } from '../api/conversations.js';
import type { SseDoneData } from '../api/types.js';
import MessageList from './MessageList.js';
import Composer from './Composer.js';
import Sidebar from './Sidebar.js';
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

  // On mount with a pending send (from new-conversation flow)
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

// ─── Root ChatView ─────────────────────────────────────────────────────────────

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, status: sessionStatus } = useSession();

  const conversations = useConversations();

  // FE11: after first response done, refresh the conversation title in the sidebar
  const handleFirstDone = useCallback(
    (_d: SseDoneData) => {
      if (id) {
        void conversations.refreshOne(id);
      }
    },
    [id, conversations],
  );

  if (sessionStatus === 'loading') {
    return <Spinner />;
  }

  if (!isAuthenticated) {
    // Guest branch — wired in Task 8; placeholder for now
    return (
      <div className={styles.chatView}>
        <div className={styles.main}>
          <div className={styles.emptyCenter}>
            <EmptyState
              title="Try Ollive"
              description="You have a free guest trial. Sign in to save your conversations."
            />
          </div>
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
        <AuthedChat conversationId={id} onFirstDone={handleFirstDone} />
      </div>
    </div>
  );
}
