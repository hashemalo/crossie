import { useState, useEffect, useRef } from "react";
import {
  authService,
  type AuthState,
} from "../shared/authService";
import Dashboard from "../Dashboard/dashboard";

const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || "http://localhost:3000";

type AuthView = "loading" | "signin" | "waiting" | "success" | "hub";

export default function AuthView() {
  const [view, setView] = useState<AuthView>("loading");
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

      setAuthState(newState);

      if (!loading) {
        if (newState.loading) {
          setView("loading");
        } else if (newState.authenticated && newState.profile) {
          setView("hub");
        } else if (newState.authenticated && !newState.profile) {
          setError(
            "Profile setup required. Please complete sign-in on the website."
          );
          setView("signin");
        } else {
          setView("signin");
        }
      }
    });


    return unsubscribe;
  }, [loading]);


  // Check for auth completion while waiting
  useEffect(() => {
    if (view !== "waiting") return;


    // Force a manual auth check every 2 seconds while waiting
    const intervalId = setInterval(() => {
      authService.checkAuthState();
    }, 2000);

    // Add a timeout to go back to signin if nothing happens after 5 minutes
    const timeoutId = setTimeout(() => {
      if (view === "waiting") {
        setError("Authentication timed out. Please try again.");
        setView("signin");
        setLoading(false);
      }
    }, 300000); // 5 minutes

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [view]);

  const handleSignInClick = () => {
    setLoading(true);
    setError("");
    setView("waiting");

    // Open website in new tab
    const authUrl = `${WEBSITE_URL}/auth`;
    const newWindow = window.open(authUrl, "_blank");

    if (!newWindow) {
      console.error("Failed to open new window");
      setError("Please allow popups for this extension");
      setView("signin");
      setLoading(false);
    }
  };

  const handleBackToSignIn = () => {
    setView("signin");
    setLoading(false);
    setError("");
  };

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
                  Sign in to comment everywhere
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <button
                  onClick={handleSignInClick}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-700 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      <span>Sign in with Google</span>
                    </>
                  )}
                </button>

                <div className="text-center">
                  <p className="text-slate-400 text-xs">
                    By signing in, you agree to our privacy policy and terms of service.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case "waiting":
        return (
          <div className="w-full max-w-md mx-auto bg-slate-900 text-white">
            <div className="p-6">
              <div className="text-center">
                <div className="animate-pulse w-16 h-16 bg-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold mb-2">
                  Waiting for authentication...
                </h2>
                <p className="text-slate-400 mb-6">
                  Complete the sign-in process in the tab that just opened. This
                  window will update automatically.
                </p>
                <button
                  onClick={handleBackToSignIn}
                  className="text-blue-400 hover:text-blue-300 text-sm underline"
                >
                  Back to sign in
                </button>
              </div>
            </div>
          </div>
        );

      case "success":
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
                    Authentication successful!
                  </h2>
                  <p className="text-slate-400">
                    Redirecting to your dashboard...
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return <div ref={containerRef}>{renderView()}</div>;
}
