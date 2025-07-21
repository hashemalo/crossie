import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { authService, type AuthState } from "../shared/authService";
import nosignIcon from "../assets/nosign.webp";

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

interface BlacklistedSite {
  id: string;
  domain: string;
  created_at: string;
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
  
  // Blacklist state
  const [blacklistedSites, setBlacklistedSites] = useState<BlacklistedSite[]>([]);
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState<{ url: string; domain: string } | null>(null);
  const [isCurrentSiteBlacklisted, setIsCurrentSiteBlacklisted] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

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
      fetchBlacklistedSites();
      checkCurrentSiteBlacklistStatus();
    }
  }, [authState.authenticated, authState.loading, authState.user?.id]);

  // Fetch user's blacklisted sites
  const fetchBlacklistedSites = async () => {
    if (!authState.user?.id) return;

    try {
      setBlacklistLoading(true);
      const response = await chrome.runtime.sendMessage({
        type: 'GET_BLACKLISTED_SITES'
      });

      if (response && response.sites) {
        setBlacklistedSites(response.sites);
      } else if (response.error) {
        setError(response.error);
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setBlacklistLoading(false);
    }
  };

  // Get current active tab
  const getCurrentTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].url) {
        const url = tabs[0].url;
        const domain = new URL(url).hostname;
        setCurrentTab({ url, domain });
        return { url, domain };
      }
    } catch (error) {
      console.error('Failed to get current tab:', error);
    }
    return null;
  };

  // Check if current site is blacklisted
  const checkCurrentSiteBlacklistStatus = async () => {
    const tab = await getCurrentTab();
    if (!tab) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_BLACKLIST',
        url: tab.url
      });
      
      if (response) {
        setIsCurrentSiteBlacklisted(response.isBlacklisted || false);
      }
    } catch (error) {
      console.error('Failed to check blacklist status:', error);
    }
  };

  // Toggle current site blacklist status
  const toggleCurrentSiteBlacklist = async () => {
    if (!currentTab) return;
    
    setToggleLoading(true);
    try {
      if (isCurrentSiteBlacklisted) {
        // Remove from blacklist
        const response = await chrome.runtime.sendMessage({
          type: 'REMOVE_FROM_BLACKLIST',
          domain: currentTab.domain
        });
        
        if (response && response.success) {
          setIsCurrentSiteBlacklisted(false);
          fetchBlacklistedSites(); // Refresh the list
        } else {
          setError(response.error || "Failed to remove site from blacklist");
        }
      } else {
        // Add to blacklist
        const response = await chrome.runtime.sendMessage({
          type: 'ADD_TO_BLACKLIST',
          domain: currentTab.domain
        });
        
        if (response && response.success) {
          setIsCurrentSiteBlacklisted(true);
          fetchBlacklistedSites(); // Refresh the list
        } else {
          setError(response.error || "Failed to add site to blacklist");
        }
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setToggleLoading(false);
    }
  };

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

        {/* Blacklist Management Section */}
        <div className="mt-8 pt-6 border-t border-slate-700">
          
          {/* Current site toggle */}
          <div className="mb-6">
            {currentTab ? (
              <div className="flex items-center justify-between bg-slate-800 p-4 rounded-lg">
                <div>
                  <div className="text-white text-sm font-medium mb-1">
                    Current Site: {currentTab.domain}
                  </div>
                  <div className="text-slate-400 text-xs">
                    {isCurrentSiteBlacklisted ? "Blacklisted" : "Active"}
                  </div>
                </div>
                <div className="relative group">
                  <button
                    onClick={toggleCurrentSiteBlacklist}
                    disabled={toggleLoading}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isCurrentSiteBlacklisted 
                        ? 'bg-red-600 hover:bg-red-500 text-white' 
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    } disabled:bg-slate-600`}
                  >
                    {toggleLoading ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <img 
                        src={nosignIcon} 
                        alt="No sign" 
                        width="16" 
                        height="16" 
                        className="w-4 h-4"
                      />
                    )}
                  </button>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                    {isCurrentSiteBlacklisted ? "Unblacklist site" : "Blacklist site"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-slate-400 text-sm">Unable to detect current site</p>
              </div>
            )}
          </div>
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