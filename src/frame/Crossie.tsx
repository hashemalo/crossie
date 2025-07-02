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
  isEditing?: boolean;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true,
  });
  const params = new URLSearchParams(window.location.search);
  const rawHost = params.get("host") || "";
  const url = canonicalise(decodeURIComponent(rawHost));

  const [threadId, setThreadId] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);

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
      .maybeSingle()
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
          id, body, created_at, user_id,
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

    // Realtime subscription
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "comments",
          filter: `thread_id=eq.${threadId}`,
        },
        ({ new: comment }) => {
          if (!comment) return;

          setMsgs((cur) =>
            cur.map((msg) =>
              msg.id === comment.id
                ? { ...msg, text: comment.body }
                : msg
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "comments",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          console.log("DELETE event received:", payload);
          const { old: comment } = payload;
          
          if (!comment) {
            console.log("No comment data in DELETE payload");
            return;
          }

          console.log("Removing comment with ID:", comment.id);
          setMsgs((cur) => {
            const filtered = cur.filter((msg) => msg.id !== comment.id);
            console.log("Messages before filter:", cur.length, "after filter:", filtered.length);
            return filtered;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, authState.profile]);

  useEffect(() => {
    const unsubscribe = authService.subscribe((newState) => {
      setAuthState(newState);
      console.log("Crossie auth state updated:", newState);
    });

    return unsubscribe;
  }, []);

  const send = async () => {
    if (!txt.trim() || !authState.profile || !authState.user) return;

    let tid = threadId;
    if (!tid) {
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

    const { error: insertErr } = await supabase.from("comments").insert({
      thread_id: tid,
      user_id: authState.user.id,
      body: txt.trim(),
    });
    if (insertErr) console.error("insert failed:", insertErr);
    
    if (messagesRef.current) {
      messagesRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setTxt("");
  };

  const startEdit = (msgId: string, currentText: string) => {
    setEditingId(msgId);
    setEditText(currentText);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (msgId: string) => {
    if (!editText.trim()) return;

    const { error } = await supabase
      .from("comments")
      .update({ body: editText.trim() })
      .eq("id", msgId);

    if (error) {
      console.error("Edit failed:", error);
      return;
    }

    setEditingId(null);
    setEditText("");
  };

  const deleteComment = async (msgId: string) => {
    if (!confirm("Are you sure you want to delete this comment?")) return;

    // Optimistic update - remove from UI immediately
    setMsgs((cur) => cur.filter((msg) => msg.id !== msgId));

    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", msgId);

    if (error) {
      console.error("Delete failed:", error);
      // Revert optimistic update on error - refetch messages
      if (threadId) {
        const { data } = await supabase
          .from("comments")
          .select(
            `
              id, body, created_at, user_id,
              user:profiles ( id, username )
            `
          )
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false });
        
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
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleEditKeyPress = (e: React.KeyboardEvent, msgId: string) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit(msgId);
    }
    if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const minimize = () => {
    sendToParent({ type: "CROSSIE_MINIMIZE" });
  };

  const isOwnComment = (msg: Message) => {
    return authState.user && msg.user.id === authState.user.id;
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
                      {isOwnComment(msg) && (
                        <div className="flex gap-1 ml-auto">
                          <button
                            onClick={() => startEdit(msg.id, msg.text)}
                            className="text-slate-400 hover:text-slate-300 transition-colors"
                            title="Edit"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="m18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => deleteComment(msg.id)}
                            className="text-slate-400 hover:text-slate-300 transition-colors"
                            title="Delete"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3,6 5,6 21,6" />
                              <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                    {editingId === msg.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => handleEditKeyPress(e, msg.id)}
                          className="w-full bg-slate-700 text-white p-2 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(msg.id)}
                            className="text-xs bg-blue-600 hover:bg-blue-500 px-2 py-1 rounded transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm break-all">{msg.text}</p>
                    )}
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