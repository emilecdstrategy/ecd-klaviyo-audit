import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, Loader2, Check, Wand2, RefreshCw } from 'lucide-react';
import type { AuditSection } from '../../lib/types';
import { parseWebSectionDetail } from '../../lib/web-report-details';
import { updateAuditSection } from '../../lib/db';
import { generateSectionAfter } from '../../lib/web-pipeline-status';
import {
  sendWebAuditAgentMessage,
  regenerateWebSection,
  applyEditsToFindings,
  describeEditOp,
  listWebAuditAgentMessages,
  insertWebAuditAgentMessage,
  markWebAuditAgentMessageApplied,
  type WebAuditEditSet,
  type WebAuditRegenerate,
  type WebAuditAgentQuestion,
} from '../../lib/web-audit-agent';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  question?: WebAuditAgentQuestion;
  edits?: WebAuditEditSet;
  regenerate?: WebAuditRegenerate;
  applied?: boolean;
  busy?: string; // status text while applying (empty = not busy)
};

const PRESETS = [
  'Make the findings more concise',
  'Make the recommendations more CRO-focused',
  'Regenerate the homepage findings',
];

const GREETING =
  "Hi! Tell me how to adjust this audit's findings, for example \"make the cart findings about trust\", \"add a homepage finding about the hero\", or \"redo the product page findings.\" I'll target the right section (and ask if it's unclear), you review and apply, and I'll refresh the after images.";

export default function WebAuditAgentPanel({
  auditId,
  sections,
  onReload,
}: {
  auditId: string;
  sections: AuditSection[];
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'greeting', role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the latest sections for apply, even across reloads, without stale closures.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const lastMsg = messages[messages.length - 1];
  const awaitingChoice = !sending && lastMsg?.role === 'assistant' && Boolean(lastMsg.question);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  // Load persisted chat history for this audit (one thread per audit).
  useEffect(() => {
    let cancelled = false;
    listWebAuditAgentMessages(auditId)
      .then(rows => {
        if (cancelled || rows.length === 0) return;
        setMessages(rows.map(r => ({
          id: r.id,
          role: r.role,
          content: r.content,
          question: r.payload?.question,
          edits: r.payload?.edits,
          regenerate: r.payload?.regenerate,
          applied: r.applied,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [auditId]);

  const setMsg = (id: string, patch: Partial<ChatMessage>) =>
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError('');
    const history = messages.filter(m => m.id !== 'greeting' && m.content).map(m => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const res = await sendWebAuditAgentMessage({ auditId, message: trimmed, history });
      let content = res.assistant_text || '';
      if (res.question?.question) content = content ? `${content}\n\n${res.question.question}` : res.question.question;
      if (!content && res.edits) content = res.edits.summary;
      if (!content && res.regenerate) content = res.regenerate.summary;
      // Persist the turn (best effort); use the DB id so apply-marking sticks.
      let assistantId = `a${Date.now()}`;
      try {
        await insertWebAuditAgentMessage({ auditId, role: 'user', content: trimmed });
        assistantId = await insertWebAuditAgentMessage({
          auditId,
          role: 'assistant',
          content,
          payload: { question: res.question, edits: res.edits, regenerate: res.regenerate },
        });
      } catch { /* non-fatal: keep the chat working even if persistence fails */ }
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content, question: res.question, edits: res.edits, regenerate: res.regenerate }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant request failed.');
    } finally {
      setSending(false);
    }
  };

  // Regenerate both after images for a section (best effort) then refresh the report.
  const regenAfters = async (sectionKey: string) => {
    await Promise.allSettled([
      generateSectionAfter(auditId, sectionKey, 'desktop'),
      generateSectionAfter(auditId, sectionKey, 'mobile'),
    ]);
  };

  const applyEdits = async (msgId: string, edits: WebAuditEditSet) => {
    const section = sectionsRef.current.find(s => s.section_key === edits.section_key);
    if (!section) { setError('That section is no longer available.'); return; }
    setMsg(msgId, { busy: 'Applying changes…' });
    try {
      if (edits.operations.length > 0) {
        const current = parseWebSectionDetail(section.section_details).findings;
        const nextFindings = applyEditsToFindings(current, edits.operations);
        const raw = section.section_details && typeof section.section_details === 'object' && !Array.isArray(section.section_details)
          ? { ...(section.section_details as Record<string, unknown>) }
          : {};
        const web = raw.web && typeof raw.web === 'object' ? { ...(raw.web as Record<string, unknown>) } : {};
        web.findings = nextFindings;
        raw.web = web;
        await updateAuditSection(section.id, {
          section_details: raw,
          ...(edits.section_summary != null ? { summary_text: edits.section_summary } : {}),
        });
      } else if (edits.section_summary != null) {
        await updateAuditSection(section.id, { summary_text: edits.section_summary });
      }
      onReload();
      setMsg(msgId, { busy: 'Refreshing after images…' });
      await regenAfters(edits.section_key);
      onReload();
      void markWebAuditAgentMessageApplied(msgId).catch(() => {});
      setMsg(msgId, { applied: true, busy: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the change.');
      setMsg(msgId, { busy: undefined });
    }
  };

  const applyRegenerate = async (msgId: string, regen: WebAuditRegenerate) => {
    setMsg(msgId, { busy: 'Regenerating section…' });
    try {
      await regenerateWebSection(auditId, regen.section_key, regen.instruction);
      onReload();
      setMsg(msgId, { busy: 'Refreshing after images…' });
      await regenAfters(regen.section_key);
      onReload();
      void markWebAuditAgentMessageApplied(msgId).catch(() => {});
      setMsg(msgId, { applied: true, busy: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate the section.');
      setMsg(msgId, { busy: undefined });
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full gradient-bg px-4 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 print:hidden"
      >
        <Sparkles className="h-4 w-4" /> AI assistant
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setOpen(false)} />
      <div className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[420px] flex-col border-l border-gray-200 bg-white shadow-2xl print:hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <Sparkles className="h-4 w-4 text-brand-primary" />
          <p className="flex-1 text-sm font-semibold text-gray-900">Web audit assistant</p>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map(m => (
            <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
              {m.role === 'user' ? (
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-primary px-3 py-1.5 text-sm text-white [overflow-wrap:anywhere]">{m.content}</div>
              ) : (
                <div className="max-w-[92%]">
                  {m.content && <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{m.content}</p>}
                  {m.question && awaitingChoice && lastMsg?.id === m.id && (
                    <div className="mt-2 space-y-1.5">
                      {m.question.options.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => void send(opt)}
                          className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.edits && (
                    <div className="mt-2 rounded-xl border border-brand-primary/20 bg-brand-primary/[0.04] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">{m.edits.section_title} · proposed change</p>
                      <p className="mt-1 text-xs text-gray-600">{m.edits.summary}</p>
                      <ul className="mt-2 space-y-1">
                        {m.edits.section_summary != null && <li className="text-xs text-gray-600">• Update the section summary</li>}
                        {m.edits.operations.map((op, i) => <li key={i} className="text-xs text-gray-600">• {describeEditOp(op)}</li>)}
                      </ul>
                      {m.applied ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Applied</div>
                      ) : m.busy ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.busy}</div>
                      ) : (
                        <button type="button" onClick={() => void applyEdits(m.id, m.edits!)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary-dark">
                          <Wand2 className="h-3.5 w-3.5" /> Apply
                        </button>
                      )}
                    </div>
                  )}
                  {m.regenerate && (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{m.regenerate.section_title} · regenerate</p>
                      <p className="mt-1 text-xs text-gray-600">{m.regenerate.summary}</p>
                      {m.regenerate.instruction && <p className="mt-1 text-[11px] text-gray-500">Focus: {m.regenerate.instruction}</p>}
                      {m.applied ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Done</div>
                      ) : m.busy ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {m.busy}</div>
                      ) : (
                        <button type="button" onClick={() => void applyRegenerate(m.id, m.regenerate!)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
                          <RefreshCw className="h-3.5 w-3.5" /> Regenerate section
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {messages.length === 1 && !sending && (
            <div className="space-y-1.5 pt-1">
              {PRESETS.map(p => (
                <button key={p} type="button" onClick={() => void send(p)} className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-gray-50">
                  {p}
                </button>
              ))}
            </div>
          )}
          {sending && <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</div>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        </div>

        <form onSubmit={e => { e.preventDefault(); void send(input); }} className="flex items-end gap-2 border-t border-gray-100 p-2.5">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            rows={1}
            placeholder={awaitingChoice ? 'Pick an option above, or type…' : 'Tell me what to adjust…'}
            className="max-h-28 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
          />
          <button type="submit" disabled={!input.trim() || sending} className="rounded-lg bg-brand-primary p-2 text-white hover:bg-brand-primary-dark disabled:opacity-40" aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </>
  );
}
