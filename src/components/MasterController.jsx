import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { streamChat } from '../lib/api.js';
import { useAuth } from './AuthProvider.jsx';
import Modal from './shared/Modal.jsx';
import { buildSnapshot, executeTool } from '../lib/mcTools.js';

const MAX_TOOL_ITERATIONS = 8; // safety cap on the agentic loop per user message

// Short, human-readable label for a tool call shown as a chip in the thread.
function describeTool(name, input = {}) {
  switch (name) {
    case 'navigate_to':
      return `Opening ${input.page}`;
    case 'query_records':
      return `Looking up ${input.table}${input.search ? ` "${input.search}"` : ''}`;
    case 'create_record':
      return `Adding to ${input.table}`;
    case 'update_record':
      return `Updating ${input.table}`;
    case 'delete_record':
      return `Deleting from ${input.table}`;
    default:
      return name;
  }
}

const MasterControllerContext = createContext(null);

export function useMasterController() {
  const ctx = useContext(MasterControllerContext);
  if (!ctx) throw new Error('useMasterController must be used within MasterControllerProvider');
  return ctx;
}

let idSeq = 0;
const nextId = () => `m${++idSeq}`;

export function MasterControllerProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const navigate = useNavigate();
  const abortRef = useRef(null);
  const { displayName, connectors } = useAuth();
  const apiKeyRef = useRef('');
  // Conversation in Anthropic message format (text + tool_use/tool_result
  // blocks), preserved across turns so the model keeps full context.
  const convoRef = useRef([]);

  // Mirror the user's Anthropic connector key into a ref so send() stays stable.
  useEffect(() => {
    const anth = connectors.find((c) => c.type === 'anthropic' && c.enabled);
    apiKeyRef.current = anth?.config?.key || '';
  }, [connectors]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => {
    setMessages([]);
    convoRef.current = [];
  }, []);

  // Promise-based confirmation surfaced as a modal (used before deletes).
  const requestConfirm = useCallback(
    (message) => new Promise((resolve) => setPendingConfirm({ message, resolve })),
    []
  );
  const answerConfirm = useCallback((ok) => {
    setPendingConfirm((pc) => {
      pc?.resolve(ok);
      return null;
    });
  }, []);

  const send = useCallback(
    async (text) => {
      const trimmed = (text || '').trim();
      if (!trimmed || isStreaming) return;

      setOpen(true);
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: trimmed }]);
      convoRef.current.push({ role: 'user', content: trimmed });

      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Fresh account snapshot for awareness; precise data comes via tools.
        const snapshot = await buildSnapshot(displayName);
        const apiKey = apiKeyRef.current || undefined;

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          let assistantId = null;
          let done = null;
          let errored = false;

          await streamChat(
            { messages: convoRef.current, context: snapshot, apiKey },
            (event) => {
              if (event.type === 'text') {
                if (!assistantId) {
                  assistantId = nextId();
                  setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '' }]);
                }
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + event.text } : m))
                );
              } else if (event.type === 'done') {
                done = event;
              } else if (event.type === 'error') {
                errored = true;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: nextId(),
                    role: 'assistant',
                    text: `⚠️ ${event.message}\n\nMake sure the backend is running (npm run server) and your Anthropic key is set in Settings → Connectors (or ANTHROPIC_API_KEY in .env).`,
                  },
                ]);
              }
            },
            controller.signal
          );

          if (errored || !done) break;

          const assistant = done.assistant?.length ? done.assistant : [{ type: 'text', text: '' }];
          convoRef.current.push({ role: 'assistant', content: assistant });

          const toolUses = assistant.filter((b) => b.type === 'tool_use');
          if (done.stop_reason !== 'tool_use' || toolUses.length === 0) break;

          // Execute each requested tool, show a chip, and collect results.
          const results = [];
          for (const tu of toolUses) {
            const chipId = nextId();
            setMessages((prev) => [
              ...prev,
              { id: chipId, role: 'tool', text: describeTool(tu.name, tu.input), toolName: tu.name, pending: true },
            ]);

            const result = await executeTool(tu.name, tu.input, { navigate, confirm: requestConfirm });

            const failed = /^(Error|User declined|Unknown|Tool error)/.test(String(result));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === chipId
                  ? { ...m, pending: false, failed, text: failed ? String(result) : describeTool(tu.name, tu.input) }
                  : m
              )
            );
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(result) });
          }

          convoRef.current.push({ role: 'user', content: results });
          // Loop: send tool results back so the model can continue.
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: `⚠️ ${err.message}` }]);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, displayName, navigate, requestConfirm]
  );

  const value = { open, setOpen, toggle, close, clear, send, messages, isStreaming };

  return (
    <MasterControllerContext.Provider value={value}>
      {children}
      {open && <MasterControllerPanel />}
      {pendingConfirm && (
        <Modal
          title="Confirm action"
          onClose={() => answerConfirm(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => answerConfirm(false)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => answerConfirm(true)}>Delete</button>
            </>
          }
        >
          <p className="body-text">{pendingConfirm.message}</p>
        </Modal>
      )}
    </MasterControllerContext.Provider>
  );
}

// ---- Slide-in panel ----
function MasterControllerPanel() {
  const { close, clear, send, messages, isStreaming } = useMasterController();
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const messagesRef = useRef(null);
  const recognitionRef = useRef(null);

  // Auto-scroll to newest message
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    if (!input.trim()) return;
    send(input);
    setInput('');
  };

  // Web Speech API voice input (Chrome)
  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join('');
      setInput(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <>
      <div className="mc-panel">
        <div className="mc-panel-header">
          <div className="mc-panel-title">
            <i className="ti ti-sparkles" />
            <span>Master Controller</span>
          </div>
          <div className="row">
            <button className="btn btn--ghost btn--sm" onClick={clear} title="Clear history">
              <i className="ti ti-trash" />
            </button>
            <button className="btn btn--ghost btn--icon" onClick={close} aria-label="Close">
              <i className="ti ti-x" />
            </button>
          </div>
        </div>

        <div className="mc-messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="mc-empty">
              <i className="ti ti-sparkles" style={{ fontSize: 28, color: 'var(--accent)' }} />
              <p style={{ marginTop: 8 }}>
                Ask me to navigate, log expenses, create tasks, summarize your day, and more.
              </p>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'tool') {
              return (
                <div key={m.id} className={`mc-bubble mc-bubble--tool ${m.failed ? 'mc-bubble--tool-failed' : ''}`}>
                  {m.pending ? (
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                  ) : (
                    <i className={`ti ${m.failed ? 'ti-alert-triangle' : 'ti-bolt'}`} />
                  )}
                  {m.text}
                </div>
              );
            }
            if (m.role === 'user') {
              return (
                <div key={m.id} className="mc-bubble mc-bubble--user">
                  {m.text}
                </div>
              );
            }
            return (
              <div key={m.id} className="mc-bubble mc-bubble--assistant">
                {m.text ? <ReactMarkdown>{m.text}</ReactMarkdown> : <span className="spinner" />}
              </div>
            );
          })}
        </div>

        <div className="mc-panel-input">
          <div className="mc-input-wrap master-controller-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Message the Master Controller…"
              autoFocus
            />
            <button
              className={`mc-mic ${listening ? 'listening' : ''}`}
              onClick={toggleVoice}
              title="Voice input"
            >
              <i className="ti ti-microphone" />
            </button>
            <button className="mc-send" onClick={submit} disabled={isStreaming || !input.trim()}>
              <i className="ti ti-arrow-up" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default MasterControllerPanel;
