import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { authService, type AuthState } from "../shared/authService";

interface Comment {
  id: string;
  body: string;
  created_at: string;
  thread: {
    id: string;
    url: string;
  };
}

export default function Dashboard() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true,
  });

  // Subscribe to auth state
  useEffect(() => {
    const unsubscribe = authService.subscribe((newState) => {
      setAuthState(newState);
    });
    return unsubscribe;
  }, []);

  // Fetch user's comments
  useEffect(() => {
    const fetchComments = async () => {
      if (!authState.user?.id) return;

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("comments")
          .select(`
            id,
            body,
            created_at,
            thread:comment_threads (
              id,
              url
            )
          `)
          .eq("user_id", authState.user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setComments(
          (data || []).map((comment: any) => ({
            ...comment,
            thread: Array.isArray(comment.thread) ? comment.thread[0] : comment.thread,
          }))
        );
      } catch (error: any) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    if (authState.authenticated && !authState.loading) {
      fetchComments();
    }
  }, [authState.authenticated, authState.loading, authState.user?.id]);

  const handleSignOut = async () => {
    try {
      await authService.signOut();
      // The auth service will handle updating the state and redirecting
    } catch (error: any) {
      setError(error.message);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getDomainFromUrl = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return domain.replace("www.", "");
    } catch {
      return url;
    }
  };

  const truncateComment = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  if (authState.loading) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 bg-slate-900 text-white">
        <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto bg-slate-900 text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-slate-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-blue-400 mb-1">Dashboard</h1>
            <p className="text-slate-400 text-sm">
              Welcome back, {authState.profile?.username}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="m-6 bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Your Comments</h2>
          <p className="text-slate-400 text-sm">
            {comments.length} comment{comments.length !== 1 ? "s" : ""} across the web
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
            <span className="ml-3 text-slate-400">Loading your comments...</span>
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-700 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">No comments yet</h3>
            <p className="text-slate-400 mb-4">
              Start commenting on websites to see them here!
            </p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors text-sm font-medium"
            >
              Close Dashboard
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors"
              >
                {/* Comment Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <svg
                        className="w-4 h-4 text-slate-400 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                        />
                      </svg>
                      <span className="text-blue-400 text-sm font-medium truncate">
                        {getDomainFromUrl(comment.thread.url)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate" title={comment.thread.url}>
                      {comment.thread.url}
                    </p>
                  </div>
                  <div className="text-xs text-slate-400 flex-shrink-0 ml-4">
                    {formatDate(comment.created_at)}
                  </div>
                </div>

                {/* Comment Body */}
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-sm leading-relaxed" title={comment.body}>
                    {truncateComment(comment.body)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end mt-3 space-x-2">
                  <button
                    onClick={() => window.open(comment.thread.url, "_blank")}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View Page
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer Actions */}
        {comments.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-700 text-center">
            <button
              onClick={() => window.close()}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm font-medium"
            >
              Close Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}