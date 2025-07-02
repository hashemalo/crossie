import { useState, useEffect, useRef } from "react";
import {
  authService,
  type AuthState,
  type Profile,
} from "../shared/authService";
import { supabase } from "../lib/supabaseClient";
import { canonicalise } from "../lib/canonicalise";

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  user: Profile;
}

// Message protocol for parent window communication
interface ParentMessage {
  type:
    | "CROSSIE_RESIZE"
    | "CROSSIE_MINIMIZE"
    | "CROSSIE_SHOW"
    | "OPEN_AUTH_POPUP";
  payload?: any;
}

function sendToParent(message: ParentMessage) {
  window.parent.postMessage(message, "*");
}

export default function Crossie() {
  const [txt, setTxt] = useState("");
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true,
  });
  const params = new URLSearchParams(window.location.search); // Get URL parameters
  const rawHost = params.get("host") || "";
  const url = canonicalise(decodeURIComponent(rawHost));

  const [threadId, setThreadId] = useState<string | null>(null);


  const messagesRef = useRef<HTMLDivElement>(null); // Ref for messages container

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [msgs]);

  function getInitial(str: string): string {
    if (!str) return "?";
    return str.trim()[0].toUpperCase();
  }

  function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 60%, 60%)`;
  }

  // on mount:
  useEffect(() => {
    if (!url) return;
    supabase
      .from("comment_threads")
      .select("id")
      .eq("url", url)
      .maybeSingle() // returns { data: null } if no row
      .then(({ data }) => {
        if (data) setThreadId(data.id);
      });
  }, [url]);

  useEffect(() => {
    if (!threadId) return;

    // Fetch existing comments with joined profile info
    supabase
      .from("comments")
      .select(
        `
          id, body, created_at,
          user:profiles ( id, username )
        `
      )

      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("Error fetching comments:", error);
          return;
        }

        if (data) {
          const mapped = data.map((c: any) => ({
            id: c.id,
            text: c.body,
            timestamp: new Date(c.created_at),
            user: {
              id: c.user.id,
              username: c.user.username,
            },
          }));
          setMsgs(mapped);
        }
      });

    //Realtime subscription (Supabase doesn't join here, so enrich manually)
    const channel = supabase
      .channel(`comments-thread-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `thread_id=eq.${threadId}`,
        },
        ({ new: comment }) => {
          if (!comment) return;

          // Use profile from current auth state if available
          setMsgs((cur) => [
            {
              id: comment.id,
              text: comment.body,
              timestamp: new Date(comment.created_at),
              user: {
                id: comment.user_id,
                username: authState.profile?.username || "Anonymous",
              },
            },
            ...cur,
          ]);
        }
      )
      .subscribe();

    //Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, authState.profile]);

  useEffect(() => {
    // Subscribe to auth state changes
    const unsubscribe = authService.subscribe((newState) => {
      setAuthState(newState);
      console.log("Crossie auth state updated:", newState);
    });

    // Cleanup subscription on unmount
    return unsubscribe;
  }, []);

  const send = async () => {
    if (!txt.trim() || !authState.profile || !authState.user) return;

    let tid = threadId;
    if (!tid) {
      // first comment on this URL → now create the thread
      const { data, error } = await supabase.rpc("get_or_create_thread", {
        p_url: url,
      });
      if (error) {
        console.error("couldn't make thread:", error);
        return;
      }
      tid = data as string;
      setThreadId(tid);
    }

    // then insert the comment into the (newly created or existing) thread
    const { error: insertErr } = await supabase.from("comments").insert({
      thread_id: tid,
      user_id: authState.user.id,
      body: txt.trim(),
    });
    if (insertErr) console.error("insert failed:", insertErr);

    setTxt("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const minimize = () => {
    sendToParent({ type: "CROSSIE_MINIMIZE" });
  };

  // Show loading state
  if (authState.loading) {
    return (
      <div className="relative select-none">
        <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
          <span>Crossie</span>
          <button
            onClick={minimize}
            className="hover:bg-slate-700 rounded p-1 transition-colors"
            title="Minimize"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </header>

        <section className="bg-slate-900 text-white p-6 rounded-b-xl border-t border-slate-700 text-center">
          <div className="mb-4">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3"></div>
            <h3 className="text-lg font-semibold mb-2">Loading...</h3>
            <p className="text-slate-400 text-sm">
              Checking authentication status
            </p>
          </div>
        </section>
      </div>
    );
  }

  // Show sign-in prompt if no profile exists
  if (!authState.profile) {
    return (
      <div className="relative select-none">
        <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
          <span>Crossie</span>
          <button
            onClick={minimize}
            className="hover:bg-slate-700 rounded p-1 transition-colors"
            title="Minimize"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </header>

        <section className="bg-slate-900 text-white p-6 rounded-b-xl border-t border-slate-700 text-center">
          <div className="mb-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="mx-auto mb-3 text-slate-400"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <h3 className="text-lg font-semibold mb-2">Welcome to Crossie</h3>
            <p className="text-slate-400 text-sm mb-4">
              Open the extension and sign in to start commenting and connecting
              with others on any website.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // Show main interface if profile exists
  return (
    <div className="relative select-none">
      <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>Crossie</span>
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
              style={{
                backgroundColor: stringToColor(
                  authState.profile.username || authState.profile.email || ""
                ),
              }}
              title={authState.profile.username}
            >
              {getInitial(
                authState.profile.username || authState.profile.email || ""
              )}
            </div>
            <span className="text-xs text-slate-300">
              {authState.profile.username}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div
              className="w-3 h-3 bg-green-400 rounded-full animate-pulse"
              title="Online"
            ></div>
            {msgs.length > 0 && (
              <span className="text-xs bg-blue-600 px-2 py-1 rounded-full">
                {msgs.length}
              </span>
            )}
          </div>

          <button
            onClick={minimize}
            className="hover:bg-slate-700 rounded p-1 transition-colors"
            title="Minimize"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </header>

      <section className="bg-slate-900 text-white p-4 space-y-3 rounded-b-xl border-t border-slate-700">
        {/* Messages area */}
        <div ref={messagesRef} className="max-h-40 overflow-y-auto space-y-2">
          {msgs.length === 0 ? (
            <p className="text-slate-400 text-sm italic">
              No messages yet. Start a conversation!
            </p>
          ) : (
            msgs.map((msg) => (
              <div key={msg.id} className="bg-slate-800 p-3 rounded-lg">
                <div className="flex items-start gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
                    style={{
                      backgroundColor: stringToColor(
                        msg.user.username || msg.user.email || ""
                      ),
                    }}
                    title={msg.user.username}
                  >
                    {getInitial(msg.user.username || msg.user.email || "")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-blue-400">
                        {msg.user.username}
                      </span>
                      <span className="text-xs text-slate-400">
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm break-words">{msg.text}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="space-y-2">
          <textarea
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={handleKeyPress}
            rows={2}
            className="w-full bg-slate-800 text-white p-3 rounded-lg resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Type your message..."
          />

          <div className="flex space-x-2">
            <button
              onClick={send}
              disabled={!txt.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
