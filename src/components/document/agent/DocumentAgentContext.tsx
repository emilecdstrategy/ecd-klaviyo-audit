import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DocAgentError,
  sendDocAgentMessage,
  type DocDraftPayload,
  type DocEditPayload,
  type DocumentSnapshot,
} from '../../../lib/document-agent';
import {
  deleteDocConversation,
  getDocConversationMessageCounts,
  getLatestDocConversation,
  listDocConversationMessages,
  listDocConversations,
  markDocAgentMessageApplied,
} from '../../../lib/document-agent-db';
import { useAuth } from '../../../contexts/AuthContext';
import type { DocumentAgentConversation, DocumentAgentMessage, ProposalAgentAttachment } from '../../../lib/types';

export type ConversationSummary = DocumentAgentConversation & { messageCount: number };

export type DocAgentChatMessage = Pick<
  DocumentAgentMessage,
  'id' | 'role' | 'content' | 'payload' | 'payload_kind' | 'applied_at'
> & { pending?: boolean; actorName?: string | null; attachments?: ProposalAgentAttachment[] };

export type DocumentAgentHostConfig = {
  documentId: string | null;
  getSnapshot?: () => DocumentSnapshot | null;
  onApplyDraft?: (draft: DocDraftPayload, conversationId: string) => Promise<void>;
  onApplyEdits?: (edits: DocEditPayload) => Promise<void>;
};

type DocumentAgentContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  messages: DocAgentChatMessage[];
  conversationId: string | null;
  sending: boolean;
  loadingHistory: boolean;
  error: string | null;
  applyingMessageId: string | null;
  canApply: boolean;
  sendMessage: (text: string, attachments?: ProposalAgentAttachment[]) => Promise<void>;
  applyMessage: (message: DocAgentChatMessage) => Promise<void>;
  resetChat: () => void;
  historyView: boolean;
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
};

const Ctx = createContext<DocumentAgentContextValue | null>(null);

export function useDocumentAgent(): DocumentAgentContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDocumentAgent must be used inside DocumentAgentProvider');
  return ctx;
}

function tempId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}

export function DocumentAgentProvider({ config, children }: { config: DocumentAgentHostConfig; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DocAgentChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const historyLoadedFor = useRef<string | null>(null);

  const { user: currentUser } = useAuth();
  const configRef = useRef(config);
  configRef.current = config;

  const rowsToMessages = (rows: Array<DocumentAgentMessage & { actor_name?: string | null }>): DocAgentChatMessage[] =>
    rows
      .filter(r => r.role !== 'tool')
      .map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        payload: r.payload,
        payload_kind: r.payload_kind,
        applied_at: r.applied_at,
        actorName: r.actor_name,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
      }));

  useEffect(() => {
    if (!isOpen) return;
    const key = config.documentId ?? '__new__';
    if (historyLoadedFor.current === key) return;
    historyLoadedFor.current = key;
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      try {
        const conv = await getLatestDocConversation(config.documentId);
        if (cancelled) return;
        if (conv) {
          setConversationId(conv.id);
          const rows = await listDocConversationMessages(conv.id);
          if (cancelled) return;
          setMessages(rowsToMessages(rows));
        }
      } catch {
        /* history is a convenience */
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, config.documentId]);

  const sendMessage = useCallback(
    async (text: string, attachments?: ProposalAgentAttachment[]) => {
      const trimmed = text.trim();
      const atts = attachments ?? [];
      if ((!trimmed && atts.length === 0) || sending) return;
      setError(null);
      const userMsg: DocAgentChatMessage = {
        id: tempId(),
        role: 'user',
        content: trimmed,
        payload: null,
        payload_kind: null,
        applied_at: null,
        pending: true,
        actorName: currentUser?.name ?? null,
        attachments: atts,
      };
      setMessages(prev => [...prev, userMsg]);
      setSending(true);
      try {
        const cfg = configRef.current;
        const res = await sendDocAgentMessage({
          conversation_id: conversationId,
          document_id: cfg.documentId,
          message: trimmed,
          attachments: atts,
          snapshot: cfg.getSnapshot?.() ?? null,
        });
        setConversationId(res.conversation_id);
        setMessages(prev => [
          ...prev.map(m => (m.id === userMsg.id ? { ...m, pending: false } : m)),
          {
            id: res.assistant_message_id,
            role: 'assistant',
            content: res.assistant_text,
            payload: res.question ?? res.draft ?? res.edits ?? null,
            payload_kind: res.question ? 'question' : res.draft ? 'draft' : res.edits ? 'edits' : null,
            applied_at: null,
          },
        ]);
      } catch (e) {
        setError(e instanceof DocAgentError || e instanceof Error ? e.message : 'The assistant request failed');
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, currentUser?.name],
  );

  const resetChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setHistoryView(false);
  }, []);

  const loadConversationList = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const list = await listDocConversations(configRef.current.documentId);
      const counts = await getDocConversationMessageCounts(list.map(c => c.id));
      setConversations(list.map(c => ({ ...c, messageCount: counts[c.id] ?? 0 })));
    } catch {
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  const openHistory = useCallback(() => {
    setHistoryView(true);
    void loadConversationList();
  }, [loadConversationList]);
  const closeHistory = useCallback(() => setHistoryView(false), []);

  const deleteConversation = useCallback(async (id: string) => {
    await deleteDocConversation(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    setConversationId(current => {
      if (current === id) {
        setMessages([]);
        return null;
      }
      return current;
    });
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setHistoryView(false);
    setError(null);
    setConversationId(id);
    setLoadingHistory(true);
    try {
      const rows = await listDocConversationMessages(id);
      setMessages(rowsToMessages(rows));
    } catch {
      setMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const applyMessage = useCallback(
    async (message: DocAgentChatMessage) => {
      if (!message.payload || message.applied_at || applyingMessageId) return;
      const cfg = configRef.current;
      setApplyingMessageId(message.id);
      setError(null);
      try {
        if (message.payload_kind === 'draft' && cfg.onApplyDraft) {
          await cfg.onApplyDraft(message.payload as DocDraftPayload, conversationId ?? '');
        } else if (message.payload_kind === 'edits' && cfg.onApplyEdits) {
          await cfg.onApplyEdits(message.payload as DocEditPayload);
        } else {
          return;
        }
        await markDocAgentMessageApplied(message.id).catch(() => {});
        setMessages(prev => prev.map(m => (m.id === message.id ? { ...m, applied_at: new Date().toISOString() } : m)));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not apply the changes');
      } finally {
        setApplyingMessageId(null);
      }
    },
    [applyingMessageId, conversationId],
  );

  const value = useMemo<DocumentAgentContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen(v => !v),
      messages,
      conversationId,
      sending,
      loadingHistory,
      error,
      applyingMessageId,
      canApply: Boolean(config.onApplyDraft || config.onApplyEdits),
      sendMessage,
      applyMessage,
      resetChat,
      historyView,
      conversations,
      conversationsLoading,
      openHistory,
      closeHistory,
      selectConversation,
      deleteConversation,
    }),
    [
      isOpen, messages, conversationId, sending, loadingHistory, error, applyingMessageId,
      config.onApplyDraft, config.onApplyEdits, sendMessage, applyMessage, resetChat,
      historyView, conversations, conversationsLoading, openHistory, closeHistory, selectConversation, deleteConversation,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
