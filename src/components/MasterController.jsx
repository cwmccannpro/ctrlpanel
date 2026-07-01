import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { streamChat } from '../lib/api.js';
import { useAuth } from './AuthProvider.jsx';
import { formatLongDate, formatClock } from '../lib/helpers.js';

// ---- Page name → route map for the navigate_to tool ----
const PAGE_ROUTES = {
  dashboard: '/',
  calendar: '/calendar',
  todo: '/todo',
  agents: '/agents',
  projects: '/projects',
  crm: '/crm',
  nutrition: '/health/nutrition',
  supplements: '/health/supplements',
  fitness: '/health/fitness',
  networth: '/finance/networth',
  budget: '/finance/budget',
  investing: '/finance/investing',
  settings: '/settings',
};

// Build the data snapshot sent to Claude with every turn (see MASTER_CONTROLLER_PROMPT.md).
function buildContext(userName) {
  const now = new Date();
  return {
    user: userName,
    date: formatLongDate(now),
    time: formatClock(now),
  };
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
  const navigate = useNavigate();
  const abortRef = useRef(null);
  const { displayName, connectors } = useAuth();
  const apiKeyRef = useRef('');

  // Mirror the user's Anthropic connector key into a ref so send() stays stable.
  useEffect(() => {
    const anth = connectors.find((c) => c.type === 'anthropic' && c.enabled);
    apiKeyRef.current = anth?.config?.key || '';
  }, [connectors]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => setMessages([]), []);

  // Execute a tool the model requested. Most actions are placeholders until
  // Supabase is wired; navigate_to is fully functional.
  const runTool = useCallback(
    (name, input = {}) => {
      switch (name) {
        case 'navigate_to': {
          const route = PAGE_ROUTES[(input.page || '').toLowerCase()];
          if (route) {
            navigate(route);
            return `Navigated to ${input.page}`;
          }
          return `Unknown page: ${input.page}`;
        }
        case 'create_task':
          return `Created task "${input.title || 'Untitled'}"${input.board ? ` on ${input.board}` : ''}`;
        case 'move_task':
          return `Moved task to ${input.column}`;
        case 'log_expense':
          return `Logged ${input.amount ? `$${input.amount}` : 'expense'} → ${input.category || 'uncategorized'}`;
        case 'log_weight':
          return `Logged weight: ${input.weight} lbs`;
        case 'add_crm_contact':
          return `Added contact: ${input.business_name || 'New contact'}`;
        case 'get_summary':
          return `Pulled ${input.module} summary`;
        case 'toggle_agent':
          return `Turned ${input.status === 'running' ? 'on' : 'off'} ${input.agent_name}`;
        default:
          return `Ran ${name}`;
      }
    },
    [navigate]
  );

  const send = useCallback(
    async (text) => {
      const trimmed = (text || '').trim();
      if (!trimmed || isStreaming) return;

      setOpen(true);
      const userMsg = { id: nextId(), role: 'user', text: trimmed };
      const assistantId = nextId();

      // Snapshot the history we send to the API (text turns only).
      let history;
      setMessages((prev) => {
        history = prev
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.text }));
        return [...prev, userMsg, { id: assistantId, role: 'assistant', text: '' }];
      });

      const apiMessages = [...(history || []), { role: 'user', content: trimmed }];

      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          { messages: apiMessages, context: buildContext(displayName), apiKey: apiKeyRef.current || undefined },
          (event) => {
            if (event.type === 'text') {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + event.text } : m))
              );
            } else if (event.type === 'tool_use') {
              const result = runTool(event.name, event.input);
              setMessages((prev) => [
                ...prev,
                { id: nextId(), role: 'tool', text: result, toolName: event.name },
              ]);
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        text:
                          m.text ||
                          `⚠️ ${event.message}\n\nMake sure the backend is running (npm run server) and ANTHROPIC_API_KEY is set in .env.`,
                      }
                    : m
                )
              );
            }
          },
          controller.signal
        );
      } catch (err) {
        if (err.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: m.text || `⚠️ ${err.message}` } : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, runTool, displayName]
  );

  const value = { open, setOpen, toggle, close, clear, send, messages, isStreaming };

  return (
    <MasterControllerContext.Provider value={value}>
      {children}
      {open && <MasterControllerPanel />}
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
      <div className="mc-overlay" onClick={close} />
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
                <div key={m.id} className="mc-bubble mc-bubble--tool">
                  <i className="ti ti-bolt" />
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
