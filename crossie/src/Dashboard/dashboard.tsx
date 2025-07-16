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
          <h2 className="text-2xl text-center text-blue-400 ont-semibold mb-2">crossie</h2>
          <p className="text-blue-500 text-center text-sm">
            Welcome back, {authState.profile?.username}!
          </p>
          <p className="text-blue-500 text-center text-sm">
            You have left <span className="text-bold text-blue-500">{annotations.length}</span> annotation{annotations.length !== 1 ? "s" : ""} across the web
          </p>
        </div>

        {/* Sign Out Button */}
        <div className="mt-8 pt-6 border-t border-slate-700 flex justify-center">
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