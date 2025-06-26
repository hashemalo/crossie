import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface User {
  id: string;
  email?: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  view: "signin" | "signup" | "profile" | "complete";
}

export default function Auth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    loading: true,
    view: "signin",
  });

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Error states
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setAuthState((prev) => ({ ...prev, user: session.user }));
        await checkUserProfile(session.user);
      } else {
        setAuthState((prev) => ({ ...prev, loading: false, view: "signin" }));
      }
    } catch (error) {
      console.error("Auth check error:", error);
      setAuthState((prev) => ({ ...prev, loading: false, view: "signin" }));
    }
  };

  const checkUserProfile = async (user: any) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error && error.code !== "PGRST116") {
        throw error;
      }

      if (profile && profile.username) {
        // User has completed setup
        await saveAuthToStorage();
        setAuthState((prev) => ({ ...prev, loading: false, view: "complete" }));
        setTimeout(() => window.close(), 1500);
      } else {
        // User needs to complete profile
        setAuthState((prev) => ({ ...prev, loading: false, view: "profile" }));
        // Set suggested values
        const suggestedUsername = user.email
          .split("@")[0]
          .replace(/[^a-zA-Z0-9]/g, "");
        setUsername(suggestedUsername);
        setDisplayName(suggestedUsername);
      }
    } catch (error) {
      console.error("Profile check error:", error);
      setError("Failed to load profile. Please try again.");
      setAuthState((prev) => ({ ...prev, loading: false, view: "signin" }));
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (error) throw error;

      setAuthState((prev) => ({ ...prev, user: data.user }));
      await checkUserProfile(data.user);
    } catch (error: any) {
      setError(error.message || "Failed to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password || !passwordConfirm) {
      setError("Please fill in all fields.");
      return;
    }

    if (password !== passwordConfirm) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
      });

      if (error) throw error;

      if (data.user) {
        setAuthState((prev) => ({ ...prev, user: data.user, view: "profile" }));
        // Set suggested values
        const suggestedUsername = email
          .split("@")[0]
          .replace(/[^a-zA-Z0-9]/g, "");
        setUsername(suggestedUsername);
        setDisplayName(suggestedUsername);
      }
    } catch (error: any) {
      setError(error.message || "Failed to create account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!username.trim()) {
      setError("Please enter a username.");
      return;
    }

    if (username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username can only contain letters, numbers, and underscores.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // Check username availability
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("username")
        .eq("username", username.trim())
        .single();

      if (existingUser) {
        setError("Username already taken. Please choose another.");
        return;
      }

      // Create/update profile
      const { error } = await supabase.from("profiles").upsert({
        id: authState.user!.id,
        username: username.trim(),
        full_name: displayName.trim() || username.trim(),
        email: authState.user!.email,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      await saveAuthToStorage();
      setSuccess("Profile created successfully!");
      setAuthState((prev) => ({ ...prev, view: "complete" }));

      setTimeout(() => window.close(), 1500);
    } catch (error: any) {
      setError(error.message || "Failed to save profile. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveAuthToStorage = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      await chrome.storage.local.set({
        crossie_auth: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: session.user,
          expires_at: session.expires_at,
        },
      });

      // Notify content scripts about auth state change
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs
              .sendMessage(tab.id, {
                type: "AUTH_STATE_CHANGED",
                authenticated: true,
                user: session.user,
              })
              .catch(() => {});
          }
        });
      });
    }
  };

  const clearError = () => setError("");

  if (authState.loading) {
    return (
      <div className="w-80 min-h-96 p-6 bg-gradient-to-br from-slate-900 to-blue-900 text-white">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Crossie</div>
          <div className="text-sm opacity-80 mb-8">
            Connect and comment on any website
          </div>
          <div className="flex justify-center">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
          <p className="mt-4 text-sm opacity-80">Loading...</p>
        </div>
      </div>
    );
  }

  if (authState.view === "complete") {
    return (
      <div className="w-80 min-h-96 p-6 bg-gradient-to-br from-slate-900 to-blue-900 text-white">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">Crossie</div>
          <div className="text-sm opacity-80 mb-8">
            Connect and comment on any website
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20,6 9,17 4,12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Welcome to Crossie!</h3>
            <p className="text-sm opacity-80">
              {success || "Setup complete! You can now start commenting."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authState.view === "profile") {
    return (
      <div className="w-80 min-h-96 p-6 bg-gradient-to-br from-slate-900 to-blue-900 text-white">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold mb-2">Crossie</div>
          <div className="text-sm opacity-80">Complete your profile</div>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
          <div className="mb-4">
            <div className="text-sm opacity-80 text-center">Welcome!</div>
            <div className="text-center font-medium">
              {authState.user?.email}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Choose a username..."
                maxLength={20}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Your display name..."
                maxLength={30}
              />
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-400/30 text-red-100 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSaveProfile}
              disabled={isSubmitting}
              className="w-full bg-white text-blue-600 py-2 px-4 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Saving..." : "Complete Setup"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 min-h-96 p-6 bg-gradient-to-br from-slate-900 to-blue-900 text-white">
      <div className="text-center mb-6">
        <div className="text-2xl font-bold mb-2">Crossie</div>
        <div className="text-sm opacity-80">
          Connect and comment on any website
        </div>
      </div>

      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6">
        {authState.view === "signin" ? (
          <>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearError();
                  }}
                  className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Enter your email"
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
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError();
                  }}
                  className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Enter your password"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-400/30 text-red-100 px-3 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-white text-blue-600 py-2 px-4 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <div className="mt-4 text-center text-sm">
              Don't have an account?{" "}
              <button
                onClick={() => {
                  setAuthState((prev) => ({ ...prev, view: "signup" }));
                  clearError();
                }}
                className="text-blue-200 hover:text-white underline"
              >
                Sign up
              </button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearError();
                  }}
                  className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Enter your email"
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
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError();
                  }}
                  className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Create a password"
                  required
                  minLength={6}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => {
                    setPasswordConfirm(e.target.value);
                    clearError();
                  }}
                  className="w-full px-3 py-2 bg-white text-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Confirm your password"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-400/30 text-red-100 px-3 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-white text-blue-600 py-2 px-4 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? "Creating account..." : "Create Account"}
              </button>
            </form>

            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <button
                onClick={() => {
                  setAuthState((prev) => ({ ...prev, view: "signin" }));
                  clearError();
                }}
                className="text-blue-200 hover:text-white underline"
              >
                Sign in
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
