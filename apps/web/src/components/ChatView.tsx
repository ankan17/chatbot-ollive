import React, { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChat } from '../hooks/useChat.js';
import { useSession } from '../state/sessionContext.js';
import { createConversation } from '../api/conversations.js';
import type { SseDoneData } from '../api/types.js';
import MessageList from './MessageList.js';
import Composer from './Composer.js';
import EmptyState from './states/EmptyState.js';
import styles from './ChatView.module.css';

// Imports for Task 7 conversation loading and sidebar (added in-place to avoid re-creating the file)
// useConversation and useConversations are wired in Task 7 below.

interface ChatViewInnerProps {
  conversationId: string | undefined;
  onFirstDone?: (d: SseDoneData) => void;
}

function AuthedChatView({ conversationId, onFirstDone }: ChatViewInnerProps) {
  const navigate = useNavigate();
  const pendingSendRef = useRef<string | null>(null);

  const { state, isStreaming, send, stop, reset } = useChat(
    conversationId ?? '',
    onFirstDone,
  );

  // Load conversation history when conversationId is set (Task 7 wires useConversation here)
  // For now the reset is called by the parent via Task 7's useConversation hook.

  async function handleSend(content: string) {
    if (!conversationId) {
      // No conversation yet — create one, navigate, then send
      pendingSendRef.current = content;
      const conv = await createConversation();
      navigate(`/c/${conv.id}`);
      // After navigation, the route param changes → new ChatView instance → send on mount
      // We store the pending content for the new instance to pick up via sessionStorage
      sessionStorage.setItem('ollive.pendingSend', content);
    } else {
      send(content);
    }
  }

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

  return (
    <>
      <MessageList messages={state.messages} isStreaming={isStreaming} />
      <Composer
        isStreaming={isStreaming}
        onSend={handleSend}
        onStop={stop}
      />
    </>
  );
}

export default function ChatView() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, status } = useSession();

  if (status === 'loading') {
    return null;
  }

  if (!isAuthenticated) {
    // Guest branch — wired in Task 8
    return (
      <div className={styles.chatView}>
        <div className={styles.main}>
          <div className={styles.emptyCenter}>
            <EmptyState
              title="Start chatting"
              description="You have a guest trial available. Sign in to save your conversations."
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatView}>
      <div className={styles.main}>
        {id ? (
          <AuthedChatViewWithHistory conversationId={id} />
        ) : (
          <AuthedChatView conversationId={undefined} />
        )}
      </div>
    </div>
  );
}

// Wrapper that handles conversation history loading (Task 7 fills this in)
function AuthedChatViewWithHistory({ conversationId }: { conversationId: string }) {
  // Task 7 will replace this with a useConversation hook that calls reset()
  return <AuthedChatView conversationId={conversationId} />;
}
