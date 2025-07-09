import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { type AuthState, type Profile } from "../shared/authService";
import { supabase, supabaseAuthClient } from "../lib/supabaseClient";
import { canonicalise } from "../lib/canonicalise";

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  user: Profile;
  isEditing?: boolean;
  isOptimistic?: boolean; // For optimistic updates
  error?: boolean; // For failed sends
}

// Message protocol for parent window communication
interface ParentMessage {
  type:
    | "CROSSIE_RESIZE"
    | "CROSSIE_MINIMIZE"
    | "CROSSIE_SHOW"
    | "OPEN_AUTH_POPUP"
    | "REQUEST_AUTH_STATE"
    | "AUTH_STATE_UPDATE";
  payload?: any;
}

function sendToParent(message: ParentMessage) {
  window.parent.postMessage(message, "*");
}

// Memoized helper functions outside component
const getInitial = (str: string): string => {
  if (!str) return "?";
  return str.trim()[0].toUpperCase();
};

const stringToColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 60%)`;
};

const getRelativeTime = (timestamp: Date): string => {
  const now = Date.now();
  const diff = now - timestamp.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${days}d`;

  return timestamp.toLocaleDateString();
};

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
  const [sending, setSending] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isTabActive, setIsTabActive] = useState(!document.hidden);

  // Memoize URL parsing
  const url = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawHost = params.get("host") || "";
    return canonicalise(decodeURIComponent(rawHost));
  }, []);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const realtimeChannelRef = useRef<any>(null);
  const authCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const optimisticCounterRef = useRef(0);
  const newThreadRef = useRef(false);

  // Initialize auth by requesting from parent
  useEffect(() => {
    sendToParent({ type: "REQUEST_AUTH_STATE" });

    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === "AUTH_STATE_UPDATE") {
        const { authData, profile } = event.data.payload || {};

        if (authData?.access_token) {
          await supabaseAuthClient.setAuth(authData.access_token);
          setAuthState({
            user: authData.user,
            profile: profile,
            authenticated: true,
            loading: false,
          });
          setAuthInitialized(true);
        } else {
          await supabaseAuthClient.setAuth(null);
          setAuthState({
            user: null,
            profile: null,
            authenticated: false,
            loading: false,
          });
          setAuthInitialized(true);
        }
      }

      if (event.data?.type === "CROSSIE_SHOW") {
        setIsVisible(true);
        if (!document.hidden) {
          sendToParent({ type: "REQUEST_AUTH_STATE" });
        }
      }

      if (event.data?.type === "CROSSIE_MINIMIZE") {
        setIsVisible(false);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      if (authCheckIntervalRef.current) {
        clearInterval(authCheckIntervalRef.current);
      }
    };
  }, []);

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isActive = !document.hidden;
      setIsTabActive(isActive);

      if (isActive && isVisible) {
        sendToParent({ type: "REQUEST_AUTH_STATE" });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isVisible]);

  // Manage periodic auth check interval
  useEffect(() => {
    if (authCheckIntervalRef.current) {
      clearInterval(authCheckIntervalRef.current);
      authCheckIntervalRef.current = null;
    }

    if (isVisible && isTabActive) {
      authCheckIntervalRef.current = setInterval(() => {
        sendToParent({ type: "REQUEST_AUTH_STATE" });
      }, 600000); // Every 10 minutes
    }

    return () => {
      if (authCheckIntervalRef.current) {
        clearInterval(authCheckIntervalRef.current);
        authCheckIntervalRef.current = null;
      }
    };
  }, [isVisible, isTabActive]);

  // Load existing thread when URL is available
  useEffect(() => {
    if (!url || !authInitialized) return;

    supabase
      .from("comment_threads")
      .select("id")
      .eq("url", url)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("[Crossie] Error loading thread:", error);
        } else if (data) {
          setThreadId(data.id);
        }
      });
  }, [url, authInitialized]);

  // Set up realtime subscription for a specific thread
  const setupRealtimeSubscription = useCallback((tid: string) => {
    // Clean up previous channel if exists
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
    }

    const channel = supabase
      .channel(`comments-thread-${tid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `thread_id=eq.${tid}`,
        },
        async ({ new: comment }) => {
          if (!comment) return;

          // Fetch the user profile for the new comment
          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, username")
            .eq("id", comment.user_id)
            .single();

          const newMessage: Message = {
            id: comment.id,
            text: comment.body,
            timestamp: new Date(comment.created_at),
            user: profileData || {
              id: comment.user_id,
              username: "Anonymous",
            },
          };

          setMsgs((cur) => {
            // Remove matching optimistic message and add real message
            const filtered = cur.filter((msg) => {
              if (!msg.isOptimistic) return true;

              return !(
                msg.text === comment.body &&
                msg.user.id === comment.user_id &&
                Math.abs(
                  msg.timestamp.getTime() -
                    new Date(comment.created_at).getTime()
                ) < 30000
              );
            });

            // Add new message if not already exists
            if (!filtered.find((msg) => msg.id === comment.id)) {
              return [newMessage, ...filtered];
            }
            return filtered;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "comments",
          filter: `thread_id=eq.${tid}`,
        },
        ({ new: comment }) => {
          if (!comment) return;
          setMsgs((cur) =>
            cur.map((msg) =>
              msg.id === comment.id ? { ...msg, text: comment.body } : msg
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
          filter: `thread_id=eq.${tid}`,
        },
        (payload) => {
          const { old: comment } = payload;
          if (!comment) return;
          setMsgs((cur) => cur.filter((msg) => msg.id !== comment.id));
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;
    return channel;
  }, []);

  // Set up subscriptions and fetch existing comments when thread is available
  useEffect(() => {
    if (!threadId || !authInitialized) {
      return;
    }

    // Only fetch existing comments if this is NOT a new thread
    if (!newThreadRef.current) {
      // This is an existing thread, so fetch comments and set up subscription
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

            // Preserve optimistic messages when setting fetched messages
            setMsgs((current) => {
              const optimisticMessages = current.filter(
                (msg) => msg.isOptimistic
              );
              return [...optimisticMessages, ...mapped];
            });
          }
        });

      // Set up realtime subscription for existing threads
      setupRealtimeSubscription(threadId);
    } else {
      // Reset the flag
      newThreadRef.current = false;
    }

    return () => {
      // Only clean up if this wasn't a new thread (new threads already have subscription set up)
      if (realtimeChannelRef.current && !newThreadRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [threadId, authInitialized, setupRealtimeSubscription]);

  // Send message with optimistic updates
  const send = useCallback(async () => {
    if (!txt.trim() || !authState.profile || !authState.user || sending) {
      return;
    }

    setSending(true);

    // Create optimistic message
    const optimisticId = `optimistic-${Date.now()}-${++optimisticCounterRef.current}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      text: txt.trim(),
      timestamp: new Date(),
      user: authState.profile,
      isOptimistic: true,
    };

    // Add optimistic message to UI immediately
    setMsgs((cur) => [optimisticMessage, ...cur]);

    // Clear input immediately for better UX
    const messageText = txt.trim();
    setTxt("");

    try {
      let tid = threadId;

      // Create thread if it doesn't exist
      if (!tid) {
        const { data, error } = await supabase.rpc("get_or_create_thread", {
          p_url: url,
        });

        if (error) {
          throw new Error(`Couldn't create thread: ${error.message}`);
        }

        tid = data as string;

        // For new threads: Set up subscription BEFORE inserting message
        setupRealtimeSubscription(tid);

        // Wait a moment for subscription to be ready
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Mark as new thread and set threadId (but don't fetch existing comments)
        newThreadRef.current = true;
        setThreadId(tid);
      }

      // Insert the message
      const { error: insertErr } = await supabase.from("comments").insert({
        thread_id: tid,
        user_id: authState.user.id,
        body: messageText,
      });

      if (insertErr) {
        throw new Error(`Insert failed: ${insertErr.message}`);
      }

      // Scroll to top
      if (messagesRef.current) {
        messagesRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (error) {
      console.error("[Crossie] Send failed:", error);

      // Mark optimistic message as failed
      setMsgs((cur) =>
        cur.map((msg) =>
          msg.id === optimisticId
            ? { ...msg, error: true, isOptimistic: false }
            : msg
        )
      );

      // Show error to user
      let errorMsg = "Failed to send message";
      if (error && typeof error === "object" && "message" in error) {
        errorMsg = `Failed to send message: ${
          (error as { message: string }).message
        }`;
      }
      alert(errorMsg);
    } finally {
      setSending(false);
    }
  }, [txt, authState, threadId, url, sending, setupRealtimeSubscription]);

  // Retry failed message
  const retryMessage = useCallback(
    async (failedMsg: Message) => {
      if (sending) return;

      setMsgs((cur) => cur.filter((msg) => msg.id !== failedMsg.id));
      setTxt(failedMsg.text);

      setTimeout(() => send(), 100);
    },
    [sending, send]
  );

  const startEdit = useCallback((msgId: string, currentText: string) => {
    setEditingId(msgId);
    setEditText(currentText);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  const saveEdit = useCallback(
    async (msgId: string) => {
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
    },
    [editText]
  );

  const deleteComment = useCallback(
    async (msgId: string) => {
      if (!confirm("Are you sure you want to delete this comment?")) return;

      // Optimistic update - remove from UI immediately
      setMsgs((cur) => cur.filter((msg) => msg.id !== msgId));

      const { error } = await supabase
        .from("comments")
        .delete()
        .eq("id", msgId);

      if (error) {
        console.error("Delete failed:", error);
        // Revert optimistic update on error
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
              user: { id: c.user.id, username: c.user.username },
            }));
            setMsgs(mapped);
          }
        }
      }
    },
    [threadId]
  );

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const handleEditKeyPress = useCallback(
    (e: React.KeyboardEvent, msgId: string) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEdit(msgId);
      }
      if (e.key === "Escape") {
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit]
  );

  const minimize = useCallback(() => {
    sendToParent({ type: "CROSSIE_MINIMIZE" });
  }, []);

  const isOwnComment = useCallback(
    (msg: Message) => {
      return authState.user && msg.user.id === authState.user.id;
    },
    [authState.user]
  );

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
              <div
                key={msg.id}
                className={`bg-slate-800 p-3 rounded-lg ${
                  msg.isOptimistic ? "opacity-70" : ""
                } ${msg.error ? "border border-red-500" : ""}`}
              >
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
                        {msg.isOptimistic
                          ? "sending..."
                          : getRelativeTime(msg.timestamp)}
                      </span>
                      {msg.error && (
                        <span
                          onClick={() => retryMessage(msg)}
                          className="text-xs text-red-400 hover:text-red-300 hover:underline transition-colors cursor-pointer"
                          title="Click to retry"
                        >
                          ⟲ retry
                        </span>
                      )}
                      {isOwnComment(msg) && !msg.isOptimistic && !msg.error && (
                        <div className="flex gap-2 ml-auto">
                          <span
                            onClick={() => startEdit(msg.id, msg.text)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Edit"
                          >
                            ✎
                          </span>
                          <span
                            onClick={() => deleteComment(msg.id)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Delete"
                          >
                            🗑
                          </span>
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
            disabled={sending}
          />

          <div className="flex space-x-2">
            <button
              onClick={send}
              disabled={!txt.trim() || sending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
