import React, { useEffect, useRef, useState } from "react";
import { ChatCircleDots, PaperPlaneTilt, X, Sparkle } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { useFilters } from "@/lib/filters";
import { api } from "@/lib/api";

const STORAGE_KEY = "vivo_chat_session_id";
const STORAGE_LOG = "vivo_chat_log_v1";

const ChatBubble = ({ msg }) => {
  const mine = msg.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`chat-msg-${msg.role}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
          mine
            ? "bg-brand text-white rounded-br-sm"
            : "bg-[#fff7ed] border border-[#fdba74] text-foreground rounded-bl-sm"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
};

const SUGGESTIONS = [
  "Which location has the highest conversion rate?",
  "What does ABV mean?",
  "Summarize this period's sales performance",
  "Which subcategories are understocked?",
];

const ChatWidget = () => {
  const { user } = useAuth();
  const { applied } = useFilters();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const listRef = useRef(null);

  useEffect(() => {
    if (sessionId) localStorage.setItem(STORAGE_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_LOG, JSON.stringify(messages.slice(-40))); } catch { /* noop */ }
  }, [messages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  if (!user) return null;

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput("");
    const nextMsgs = [...messages, { role: "user", content: msg }];
    setMessages(nextMsgs);
    setSending(true);
    try {
      const { data } = await api.post("/chat", {
        message: msg,
        session_id: sessionId,
        context: {
          date_from: applied.dateFrom,
          date_to: applied.dateTo,
          countries: applied.countries,
          pos_locations: applied.channels,
          compare_mode: applied.compareMode,
          page: window.location.pathname,
        },
      });
      setSessionId(data.session_id);
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (err) {
      const detail = err?.response?.data?.detail || err.message || "Something went wrong";
      setMessages((prev) => [...prev, { role: "assistant", content: `Sorry, I hit an error: ${detail}` }]);
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setSessionId(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_LOG);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="chat-open-btn"
          className="fixed bottom-5 right-5 z-[60] shadow-lg rounded-full bg-brand text-white w-14 h-14 grid place-items-center hover:bg-brand-deep transition-transform hover:scale-105"
          aria-label="Open assistant"
        >
          <ChatCircleDots size={26} weight="fill" />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-x-2 bottom-2 top-14 sm:inset-auto sm:bottom-5 sm:right-5 sm:top-auto z-50 sm:w-[min(380px,calc(100vw-2.5rem))] sm:h-[min(560px,calc(100vh-2.5rem))] card-white shadow-xl flex flex-col overflow-hidden"
          data-testid="chat-panel"
          style={{ borderColor: "#fdba74" }}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-gradient-to-br from-brand to-brand-deep text-white">
            <div className="w-8 h-8 rounded-full bg-white/15 grid place-items-center">
              <Sparkle size={16} weight="fill" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[14px] leading-tight">Vivo BI Assistant</div>
              <div className="text-[11px] opacity-80">Ask me anything about your data</div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] opacity-80 hover:opacity-100 px-1.5"
              title="New conversation"
              data-testid="chat-reset-btn"
            >
              new
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="opacity-80 hover:opacity-100 p-1"
              data-testid="chat-close-btn"
              aria-label="Close"
            >
              <X size={16} weight="bold" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5" data-testid="chat-messages">
            {messages.length === 0 && (
              <div className="text-center py-3">
                <div className="text-[12.5px] text-muted mb-3">
                  Hi {user?.name?.split(" ")[0] || "there"} — try one of these:
                </div>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      data-testid="chat-suggestion"
                      className="text-left text-[12px] bg-[#fff7ed] hover:bg-[#ffedd5] border border-[#fdba74] rounded-lg px-3 py-2 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
            {sending && (
              <div className="flex justify-start" data-testid="chat-typing">
                <div className="bg-[#fff7ed] border border-[#fdba74] rounded-2xl rounded-bl-sm px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-pulse" style={{ animationDelay: "0.15s" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand/60 animate-pulse" style={{ animationDelay: "0.3s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t border-border px-2.5 py-2.5 flex items-end gap-2 bg-white"
            data-testid="chat-form"
          >
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about sales, inventory, KPIs…"
              data-testid="chat-input"
              className="flex-1 resize-none bg-[#fff7ed] border border-[#fdba74] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-brand"
              style={{ maxHeight: 100 }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              data-testid="chat-send-btn"
              className="bg-brand text-white rounded-xl w-10 h-10 grid place-items-center hover:bg-brand-deep disabled:opacity-50 shrink-0"
              aria-label="Send"
            >
              <PaperPlaneTilt size={16} weight="fill" />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
