import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { authService, type AuthState, type SupabaseConfig } from "../shared/authService";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Create Supabase client for auth operations
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type AuthView = "signin" | "signup" | "profile" | "success";

export default function AuthView() {
  const [view, setView] = useState<AuthView>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true
  });
  
  // Ref for container to measure size
  const containerRef = useRef<HTMLDivElement>(null);

  // Function to resize the popup window
  const resizeWindow = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.max(420, rect.width + 40);
      const newHeight = Math.max(300, rect.height + 60);
      
      try {
        window.resizeTo(newWidth, newHeight);
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const left = (screenWidth - newWidth) / 2;
        const top = (screenHeight - newHeight) / 2;
        window.moveTo(left, top);
      } catch (error) {
        console.warn('Could not resize window:', error);
      }
    }
  };

  // Subscribe to auth service
  useEffect(() => {
    const unsubscribe = authService.subscribe((newState) => {
      setAuthState(newState);
      
      // If user is authenticated and has profile, close popup
      if (newState.authenticated && newState.profile && !loading) {
        setTimeout(() => window.close(), 1000);
      }
    });

    return unsubscribe;
  }, [loading]);

  // Resize window when view changes
  useEffect(() => {
    const timer = setTimeout(resizeWindow, 100);
    return () => clearTimeout(timer);
  }, [view, error, loading]);

  // Resize on window resize
  useEffect(() => {
    const handleResize = () => setTimeout(resizeWindow, 100);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const saveAuthToStorage = async (session: any) => {
    const authData = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: session.user,
      expires_at: session.expires_at,
    };

    const config: SupabaseConfig = {
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY
    };

    await authService.saveAuthData(authData, config);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.session && data.user) {
        await saveAuthToStorage(data.session);
        
        // Check if profile exists
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();

        if (profileError || !profile) {
          setView("profile");
        } else {
          // Profile exists, auth service will handle the rest
          await authService.checkAuthState();
        }
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.session && data.user) {
        await saveAuthToStorage(data.session);
        setView("profile");
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!authState.user) throw new Error("No user found");

      const { error } = await supabase.from("profiles").upsert({
        id: authState.user.id,
        username: username.trim(),
        email: authState.user.email,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      // Save profile to auth service
      const profileData = {
        username: username.trim(),
        email: authState.user.email,
      };

      await authService.saveProfile(profileData);
      setView("success");
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // If already authenticated and has profile, show success
  if (authState.authenticated && authState.profile && !loading) {
    return (
      <div ref={containerRef} className="w-full max-w-md mx-auto bg-slate-900 text-white">
        <div className="p-6">
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-2">Welcome back!</h2>
              <p className="text-slate-400 mb-6">
                You're already signed in as {authState.profile.username}.
              </p>
            </div>
            <button
              onClick={() => window.close()}
              className="w-full bg-blue-600 hover:bg-blue-500 py-2 px-4 rounded-lg font-medium transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full max-w-md mx-auto bg-slate-900 text-white">
      <div className="p-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-400 mb-2">Crossie</h1>
          <p className="text-slate-400 text-sm">
            {view === "signin" && "Sign in to your account"}
            {view === "signup" && "Create your account"}
            {view === "profile" && "Complete your profile"}
            {view === "success" && "Welcome to Crossie!"}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Sign In View */}
        {view === "signin" && (
          <div className="space-y-6">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 py-2 px-4 rounded-lg font-medium transition-colors"
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>
            
            <div className="text-center">
              <button
                onClick={() => setView("signup")}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Don't have an account? Sign up
              </button>
            </div>
          </div>
        )}

        {/* Sign Up View */}
        {view === "signup" && (
          <div className="space-y-6">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 py-2 px-4 rounded-lg font-medium transition-colors"
              >
                {loading ? "Creating account..." : "Sign Up"}
              </button>
            </form>
            
            <div className="text-center">
              <button
                onClick={() => setView("signin")}
                className="text-blue-400 hover:text-blue-300 text-sm"
              >
                Already have an account? Sign in
              </button>
            </div>
          </div>
        )}

        {/* Profile Setup View */}
        {view === "profile" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-2xl font-bold">
                  {username ? username[0]?.toUpperCase() : "?"}
                </span>
              </div>
            </div>
            
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Username <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Choose a unique username"
                  required
                  pattern="^[a-zA-Z0-9_]+$"
                  title="Username can only contain letters, numbers, and underscores"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !username.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 py-2 px-4 rounded-lg font-medium transition-colors"
              >
                {loading ? "Saving..." : "Complete Setup"}
              </button>
            </form>
          </div>
        )}

        {/* Success View */}
        {view === "success" && (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-2">All set!</h2>
              <p className="text-slate-400 mb-6">
                Your profile has been created successfully. You can now start commenting on websites.
              </p>
            </div>
            <button
              onClick={() => window.close()}
              className="w-full bg-blue-600 hover:bg-blue-500 py-2 px-4 rounded-lg font-medium transition-colors"
            >
              Get Started
            </button>
          </div>
        )}
      </div>
    </div>
  );
}