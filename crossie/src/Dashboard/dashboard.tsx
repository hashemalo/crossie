import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { authService, type AuthState } from "../shared/authService";

interface Annotation {
  id: string;
  content: string;
  created_at: string;
  project: {
    id: string;
    name: string;
  };
  page: {
    id: string;
    url: string;
    title?: string;
  };
}

export default function Dashboard() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
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

  // Fetch user's annotations
  useEffect(() => {
    const fetchAnnotations = async () => {
      if (!authState.user?.id) return;

      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("annotations")
          .select(`
            id,
            content,
            created_at,
            project:projects (
              id,
              name
            ),
            page:pages (
              id,
              url,
              title
            )
          `)
          .eq("user_id", authState.user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;
        setAnnotations(
          (data || []).map((annotation: any) => ({
            ...annotation,
            project: Array.isArray(annotation.project) ? annotation.project[0] : annotation.project,
            page: Array.isArray(annotation.page) ? annotation.page[0] : annotation.page,
          }))
        );
      } catch (error: any) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    if (authState.authenticated && !authState.loading) {
      fetchAnnotations();
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

  const truncateAnnotation = (text: string, maxLength: number = 150) => {
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

  if (!authState.authenticated) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 bg-slate-900 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Welcome to crossie</h1>
          <p className="text-slate-400 mb-6">
            Sign in to view your annotations across the web
          </p>
          <button
            onClick={() => window.open("/auth", "_blank")}
            className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto bg-slate-900 text-white min-h-screen">
      <div className="p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Your Annotations</h2>
          <p className="text-slate-400 text-sm">
            {annotations.length} annotation{annotations.length !== 1 ? "s" : ""} across the web
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full"></div>
            <span className="ml-3 text-slate-400">Loading your annotations...</span>
          </div>
        ) : annotations.length === 0 ? (
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
            <h3 className="text-lg font-medium mb-2">No annotations yet</h3>
            <p className="text-slate-400 mb-4">
              Start annotating on websites to see them here!
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
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors"
              >
                {/* Annotation Header */}
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
                      <span className="text-sm text-slate-400">
                        {getDomainFromUrl(annotation.page.url)}
                      </span>
                      <span className="text-xs text-slate-500">•</span>
                      <span className="text-xs text-slate-500">
                        {formatDate(annotation.created_at)}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-white truncate">
                      {annotation.project.name}
                    </h3>
                    <p className="text-xs text-slate-400 truncate">
                      {annotation.page.title || annotation.page.url}
                    </p>
                  </div>
                  <button
                    onClick={() => window.open(annotation.page.url, "_blank")}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Visit →
                  </button>
                </div>

                {/* Annotation Content */}
                <div className="text-sm text-slate-300 leading-relaxed">
                  {truncateAnnotation(annotation.content)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sign Out Button */}
        <div className="mt-8 pt-6 border-t border-slate-700">
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}