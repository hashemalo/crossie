import { useState, useEffect, useRef } from "react";
import {
  authService,
  type AuthState,
  type SupabaseConfig,
} from "../shared/authService";
import { supabase } from "../lib/supabaseClient";
import Dashboard from "../Dashboard/dashboard";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

type AuthView = "loading" | "signin" | "signup" | "profile" | "success" | "hub";

export default function AuthView() {
  const [view, setView] = useState<AuthView>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    profile: null,
    authenticated: false,
    loading: true,
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
        console.warn("Could not resize window:", error);
      }
    }
  };

  // Subscribe to auth service
  useEffect(() => {
    const unsubscribe = authService.subscribe((newState) => {
      console.log("Auth service subscription fired:", {
        loading,
        newState: {
          loading: newState.loading,
          authenticated: newState.authenticated,
          profile: newState.profile,
          user: newState.user?.id
        }
      });
      
      setAuthState(newState);

      // Only update view if we're not in a loading state for form submission
      if (!loading) {
        if (newState.loading) {
          console.log("Setting view to loading");
          setView("loading");
        } else if (newState.authenticated && newState.profile) {
          console.log("Setting view to hub");
          setView("hub");
        } else if (newState.authenticated && !newState.profile) {
          console.log("Setting view to profile - user authenticated but no profile");
          setView("profile");
        } else {
          console.log("Setting view to signin - user not authenticated");
          setView("signin");
        }
      } else {
        console.log("Skipping view update because loading is true");
      }
    });

    return unsubscribe;
  }, [loading]); // Keep the loading dependency to prevent view changes during form submission

  // Resize window when view changes
  useEffect(() => {
    const timer = setTimeout(resizeWindow, 100);
    return () => clearTimeout(timer);
  }, [view, error, loading]);

  // Resize on window resize
  useEffect(() => {
    const handleResize = () => setTimeout(resizeWindow, 100);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
      anonKey: SUPABASE_ANON_KEY,
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
          .maybeSingle();

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
        // Don't set view here - let the auth service subscription handle it
        // The subscription will now correctly detect authenticated user with no profile
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

  const renderView = () => {
    switch (view) {
      case "loading":
        return (
          <div className="w-full max-w-md mx-auto p-6 text-center bg-slate-900 text-white">
            <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Loading your account…</p>
          </div>
        );

      case "hub":
        return <Dashboard />;

      case "signin":
        return (
          <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
            <div className="p-6">
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-blue-400 mb-2">
                  Crossie
                </h1>
                <p className="text-slate-400 text-sm">
                  Sign in to your account
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Password
                    </label>
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
            </div>
          </div>
        );

      case "signup":
        return (
          <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
            <div className="p-6">
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-blue-400 mb-2">
                  Crossie
                </h1>
                <p className="text-slate-400 text-sm">Create your account</p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Password
                    </label>
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
            </div>
          </div>
        );

      case "profile":
        return (
          <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
            <div className="p-6">
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-blue-400 mb-2">
                  Crossie
                </h1>
                <p className="text-slate-400 text-sm">Complete your profile</p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

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
            </div>
          </div>
        );

      case "success":
        return (
          <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
            <div className="p-6">
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-blue-400 mb-2">
                  Crossie
                </h1>
                <p className="text-slate-400 text-sm">Welcome to Crossie!</p>
              </div>

              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">All set!</h2>
                  <p className="text-slate-400 mb-6">
                    Your profile has been created successfully. You can now
                    start commenting on websites.
                  </p>
                </div>
                <button
                  onClick={() => window.close()}
                  className="w-full bg-blue-600 hover:bg-blue-500 py-2 px-4 rounded-lg font-medium transition-colors"
                >
                  Get Started
                </button>
                <button
                  onClick={() => setView("hub")}
                  className="px-4 py-2 rounded bg-transparent hover:bg-slate-800 transition"
                >
                  <span className="text-blue-400 hover:text-blue-300 text-sm">
                    Go to Dashboard
                  </span>
                </button>
              </div>
            </div>
          </div>
        );

      default:
        // Fallback - check if user is already authenticated
        if (authState.authenticated && authState.profile && !loading) {
          return (
            <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
              <div className="p-6">
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center">
                    <svg
                      className="w-10 h-10 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold mb-2">
                      Welcome back!
                    </h2>
                    <p className="text-slate-400 mb-6">
                      You're already signed in as {authState.profile.username}.
                    </p>
                  </div>
                  <button
                    onClick={() => setView("hub")}
                    className="w-full bg-blue-600 hover:bg-blue-500 py-2 px-4 rounded-lg font-medium transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          );
        }
        // If not authenticated, default to signin
        return null;
    }
  };

  return <div ref={containerRef}>{renderView()}</div>;
}