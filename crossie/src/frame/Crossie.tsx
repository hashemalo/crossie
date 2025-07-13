import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { type AuthState, type Profile } from "../shared/authService";
import { supabase, supabaseAuthClient } from "../lib/supabaseClient";
import { canonicalise } from "../lib/canonicalise";

interface Annotation {
  id: string;
  text: string;
  timestamp: Date;
  user: Profile;
  isEditing?: boolean;
  isOptimistic?: boolean; // For optimistic updates
  error?: boolean; // For failed sends
  highlightedText?: string; // For text annotations
  isTextAnnotation?: boolean; // Distinguish text annotations from regular comments
}

// Message protocol for parent window communication
interface ParentMessage {
  type:
    | "CROSSIE_RESIZE"
    | "CROSSIE_MINIMIZE"
    | "CROSSIE_SHOW"
    | "OPEN_AUTH_POPUP"
    | "REQUEST_AUTH_STATE"
    | "AUTH_STATE_UPDATE"
    | "ANNOTATION_REQUEST"
    | "TEXT_SELECTION"
    | "HIGHLIGHT_TEXT";
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
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
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
  const [textAnnotationRequest, setTextAnnotationRequest] = useState<{
    selectedText: string;
    originalText: string;
  } | null>(null);

  // Memoize URL parsing
  const url = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawHost = params.get("host") || "";
    return canonicalise(decodeURIComponent(rawHost));
  }, []);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  const annotationsRef = useRef<HTMLDivElement>(null);
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

      if (event.data?.type === "ANNOTATION_REQUEST") {
        const { selectedText, originalText } = event.data.payload || {};
        setTextAnnotationRequest({ selectedText, originalText });
        // Pre-fill the textarea with the selected text context
        setTxt(`Annotation for: "${selectedText}"\n\n`);
      }

      if (event.data?.type === "TEXT_SELECTION") {
        const { selectedText, originalText } = event.data.payload || {};
        setTextAnnotationRequest({ selectedText, originalText });
        // Pre-fill the textarea with the selected text context
        setTxt(`Annotation for: "${selectedText}"\n\n`);
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
      .channel(`annotations-thread-${tid}`)
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

          // Fetch the user profile for the new annotation
          const { data: profileData } = await supabase
            .from("profiles")
            .select("id, username")
            .eq("id", comment.user_id)
            .single();

          // Parse text annotations
          const body = comment.body;
          const textAnnotationMatch = body.match(/\[TEXT_ANNOTATION\](.*?)\[END_TEXT\](.*)/s);
          
          const newAnnotation: Annotation = {
            id: comment.id,
            text: textAnnotationMatch ? textAnnotationMatch[2] : body,
            timestamp: new Date(comment.created_at),
            user: profileData || {
              id: comment.user_id,
              username: "Anonymous",
            },
            highlightedText: textAnnotationMatch ? textAnnotationMatch[1] : undefined,
            isTextAnnotation: !!textAnnotationMatch,
          };

          setAnnotations((cur) => {
            // Remove matching optimistic annotation and add real annotation
            const filtered = cur.filter((ann) => {
              if (!ann.isOptimistic) return true;

              return !(
                ann.text === comment.body &&
                ann.user.id === comment.user_id &&
                Math.abs(
                  ann.timestamp.getTime() -
                    new Date(comment.created_at).getTime()
                ) < 30000
              );
            });

            // Add new annotation if not already exists
            if (!filtered.find((ann) => ann.id === comment.id)) {
              return [newAnnotation, ...filtered];
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
          setAnnotations((cur) =>
            cur.map((ann) =>
              ann.id === comment.id ? { ...ann, text: comment.body } : ann
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
          setAnnotations((cur) => cur.filter((ann) => ann.id !== comment.id));
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;
    return channel;
  }, []);

  // Function to highlight text on the page
  const highlightTextOnPage = useCallback((text: string) => {
    sendToParent({
      type: "HIGHLIGHT_TEXT",
      payload: { text },
    });
  }, []);

  // Set up subscriptions and fetch existing annotations when thread is available
  useEffect(() => {
    if (!threadId || !authInitialized) {
      return;
    }

    // Only fetch existing annotations if this is NOT a new thread
    if (!newThreadRef.current) {
      // This is an existing thread, so fetch annotations and set up subscription
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
            console.error("Error fetching annotations:", error);
            return;
          }

          if (data) {
            const mapped = data.map((c: any) => {
              // Parse text annotations
              const body = c.body;
              const textAnnotationMatch = body.match(/\[TEXT_ANNOTATION\](.*?)\[END_TEXT\](.*)/s);
              
              if (textAnnotationMatch) {
                // This is a text annotation
                return {
                  id: c.id,
                  text: textAnnotationMatch[2], // The annotation text
                  timestamp: new Date(c.created_at),
                  user: {
                    id: c.user.id,
                    username: c.user.username,
                  },
                  highlightedText: textAnnotationMatch[1], // The highlighted text
                  isTextAnnotation: true,
                };
              } else {
                // This is a regular annotation
                return {
                  id: c.id,
                  text: body,
                  timestamp: new Date(c.created_at),
                  user: {
                    id: c.user.id,
                    username: c.user.username,
                  },
                  isTextAnnotation: false,
                };
              }
            });

            // Preserve optimistic annotations when setting fetched annotations
            setAnnotations((current) => {
              const optimisticAnnotations = current.filter(
                (ann) => ann.isOptimistic
              );
              return [...optimisticAnnotations, ...mapped];
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

  // Send annotation with optimistic updates
  const send = useCallback(async () => {
    if (!txt.trim() || !authState.profile || !authState.user || sending) {
      return;
    }

    setSending(true);

    // Check if this is a text annotation
    const isTextAnnotation = !!textAnnotationRequest;
    const highlightedText = textAnnotationRequest?.selectedText;

    // Create optimistic annotation
    const optimisticId = `optimistic-${Date.now()}-${++optimisticCounterRef.current}`;
    const optimisticAnnotation: Annotation = {
      id: optimisticId,
      text: txt.trim(),
      timestamp: new Date(),
      user: authState.profile,
      isOptimistic: true,
      highlightedText: highlightedText,
      isTextAnnotation: isTextAnnotation,
    };

    // Add optimistic annotation to UI immediately
    setAnnotations((cur) => [optimisticAnnotation, ...cur]);

    // Clear input immediately for better UX
    const annotationText = txt.trim();
    setTxt("");
    
    // Clear text annotation request after sending
    if (isTextAnnotation) {
      setTextAnnotationRequest(null);
    }

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

        // For new threads: Set up subscription BEFORE inserting annotation
        setupRealtimeSubscription(tid);

        // Wait a moment for subscription to be ready
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Mark as new thread and set threadId (but don't fetch existing annotations)
        newThreadRef.current = true;
        setThreadId(tid);
      }

      // Insert the annotation
      const { error: insertErr } = await supabase.from("comments").insert({
        thread_id: tid,
        user_id: authState.user.id,
        body: isTextAnnotation 
          ? `[TEXT_ANNOTATION]${highlightedText}[END_TEXT]${annotationText}`
          : annotationText,
      });

      if (insertErr) {
        throw new Error(`Insert failed: ${insertErr.message}`);
      }

      // Scroll to top
      if (annotationsRef.current) {
        annotationsRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (error) {
      console.error("[Crossie] Send failed:", error);

      // Mark optimistic annotation as failed
      setAnnotations((cur) =>
        cur.map((ann) =>
          ann.id === optimisticId
            ? { ...ann, error: true, isOptimistic: false }
            : ann
        )
      );

      // Show error to user
      let errorMsg = "Failed to send annotation";
      if (error && typeof error === "object" && "message" in error) {
        errorMsg = `Failed to send annotation: ${
          (error as { message: string }).message
        }`;
      }
      alert(errorMsg);
    } finally {
      setSending(false);
    }
  }, [txt, authState, threadId, url, sending, setupRealtimeSubscription]);

  // Retry failed annotation
  const retryAnnotation = useCallback(
    async (failedAnnotation: Annotation) => {
      if (sending) return;

      setAnnotations((cur) => cur.filter((ann) => ann.id !== failedAnnotation.id));
      setTxt(failedAnnotation.text);

      setTimeout(() => send(), 100);
    },
    [sending, send]
  );

  const startEdit = useCallback((annId: string, currentText: string) => {
    setEditingId(annId);
    setEditText(currentText);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  const saveEdit = useCallback(
    async (annId: string) => {
      if (!editText.trim()) return;

      const { error } = await supabase
        .from("comments")
        .update({ body: editText.trim() })
        .eq("id", annId);

      if (error) {
        console.error("Edit failed:", error);
        return;
      }

      setEditingId(null);
      setEditText("");
    },
    [editText]
  );

  const deleteAnnotation = useCallback(
    async (annId: string) => {
      if (!confirm("Are you sure you want to delete this annotation?")) return;

      // Optimistic update - remove from UI immediately
      setAnnotations((cur) => cur.filter((ann) => ann.id !== annId));

      const { error } = await supabase
        .from("comments")
        .delete()
        .eq("id", annId);

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
            setAnnotations(mapped);
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
    (e: React.KeyboardEvent, annId: string) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEdit(annId);
      }
      if (e.key === "Escape") {
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit]
  );



  const isOwnAnnotation = useCallback(
    (ann: Annotation) => {
      return authState.user && ann.user.id === authState.user.id;
    },
    [authState.user]
  );

  // Show loading state
  if (authState.loading) {
    return (
      <div className="w-full h-full bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!authState.authenticated) {
    return (
      <div className="w-full h-full bg-slate-900 text-white flex flex-col">
        <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">Crossie</span>
          </div>
          <div className="flex items-center space-x-3">
            {/* Close button */}
            <button
              onClick={() => sendToParent({ type: "CROSSIE_MINIMIZE" })}
              className="hover:bg-slate-700 rounded p-1 transition-colors"
              title="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
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
              Open the extension and sign in to start annotating and connecting
              with others on any website.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show main interface if profile exists
  return (
    <div className="relative select-none h-full flex flex-col">
      <header className="bg-slate-800 px-4 py-3 text-white font-semibold flex items-center justify-between border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
            style={{
              backgroundColor: stringToColor(
                authState.profile?.username || authState.profile?.email || ""
              ),
            }}
            title={authState.profile?.username}
          >
            {getInitial(
              authState.profile?.username || authState.profile?.email || ""
            )}
          </div>
          <span className="text-sm text-slate-300">
            {authState.profile?.username}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div
              className="w-3 h-3 bg-green-400 rounded-full animate-pulse"
              title="Online"
            ></div>
            {annotations.length > 0 && (
              <span className="text-xs bg-blue-600 px-2 py-1 rounded-full">
                {annotations.length}
              </span>
            )}
          </div>
          
          {/* Close button */}
          <button
            onClick={() => sendToParent({ type: "CROSSIE_MINIMIZE" })}
            className="hover:bg-slate-700 rounded p-1 transition-colors"
            title="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      <section className="flex-1 bg-slate-900 text-white flex flex-col min-h-0">
        {/* Annotations area */}
        <div ref={annotationsRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {annotations.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-0 -mt-4">
              <div className="text-center">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="mx-auto mb-3 text-slate-400"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <path d="M8 10h.01"/>
                  <path d="M12 10h.01"/>
                  <path d="M16 10h.01"/>
                </svg>
                <p className="text-slate-400 text-sm italic">
                  No annotations yet. Start annotating this page!
                </p>
              </div>
            </div>
          ) : (
            annotations.map((ann) => (
              <div
                key={ann.id}
                className={`bg-slate-800 p-3 rounded-lg ${
                  ann.isOptimistic ? "opacity-70" : ""
                } ${ann.error ? "border border-red-500" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
                    style={{
                      backgroundColor: stringToColor(
                        ann.user.username || ann.user.email || ""
                      ),
                    }}
                    title={ann.user.username}
                  >
                    {getInitial(ann.user.username || ann.user.email || "")}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-blue-400">
                        {ann.user.username}
                      </span>
                      <span className="text-xs text-slate-400">
                        {ann.isOptimistic
                          ? "sending..."
                          : getRelativeTime(ann.timestamp)}
                      </span>
                      {ann.error && (
                        <span
                          onClick={() => retryAnnotation(ann)}
                          className="text-xs text-red-400 hover:text-red-300 hover:underline transition-colors cursor-pointer"
                          title="Click to retry"
                        >
                          ⟲ retry
                        </span>
                      )}
                      {isOwnAnnotation(ann) && !ann.isOptimistic && !ann.error && (
                        <div className="flex gap-2 ml-auto">
                          <span
                            onClick={() => startEdit(ann.id, ann.text)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Edit"
                          >
                            ✎
                          </span>
                          <span
                            onClick={() => deleteAnnotation(ann.id)}
                            className="text-xs text-slate-400 hover:text-slate-300 hover:underline transition-colors cursor-pointer"
                            title="Delete"
                          >
                            🗑
                          </span>
                        </div>
                      )}
                    </div>
                    {editingId === ann.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => handleEditKeyPress(e, ann.id)}
                          className="w-full bg-slate-700 text-white p-2 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(ann.id)}
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
                      <div className="space-y-2">
                        {ann.isTextAnnotation && ann.highlightedText && (
                          <div className="bg-yellow-200 text-black px-2 py-1 rounded text-xs font-medium">
                            "{ann.highlightedText}"
                          </div>
                        )}
                        <p className="text-sm break-all">{ann.text}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="p-4 border-t border-slate-700 space-y-2 flex-shrink-0">
          {textAnnotationRequest && (
            <div className="bg-yellow-200 text-black px-3 py-2 rounded text-sm mb-2">
              <div className="font-medium mb-1">Annotating selected text:</div>
              <div className="italic">"{textAnnotationRequest.selectedText}"</div>
            </div>
          )}
          <textarea
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={handleKeyPress}
            rows={3}
            className="w-full bg-slate-800 text-white p-3 rounded-lg resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={textAnnotationRequest ? "Add your annotation..." : "Add an annotation..."}
            disabled={sending}
          />

          <div className="flex space-x-2">
            <button
              onClick={send}
              disabled={!txt.trim() || sending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
            >
              {sending ? "Sending..." : (textAnnotationRequest ? "Add Text Annotation" : "Add Annotation")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
