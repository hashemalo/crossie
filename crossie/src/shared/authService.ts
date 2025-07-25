// src/shared/authService.ts
import { supabase } from "../lib/supabaseClient";

export interface User {
  id: string;
  email?: string;
}

export interface Profile {
  id: string;       
  username: string;
  email?: string;
}

export interface AuthState {
  user: User | null;
  profile: Profile | null;
  authenticated: boolean;
  loading: boolean;
}

export interface StoredAuthData {
  access_token: string;
  refresh_token: string;
  user: User;
  expires_at: number;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

class AuthService {
  private supabase: any = null;
  private listeners: ((state: AuthState) => void)[] = [];
  private currentState: AuthState = {
    user: null,
    profile: null,
    authenticated: false,
    loading: true
  };
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeStorageListener();
    this.initialize();
    this.startBackgroundRefresh();
  }

  // Initialize the service
  async initialize() {
    try {
      const config = await this.getSupabaseConfig();
      if (config) {
        this.supabase = supabase
      }
      
      await this.checkAuthState();
    } catch (error) {
      console.error('Auth service initialization failed:', error);
      this.updateState({ 
        user: null, 
        profile: null, 
        authenticated: false, 
        loading: false 
      });
    }
  }

  // Start background token refresh
  private startBackgroundRefresh() {
    // Clear any existing interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Check and refresh tokens every 30 minutes
    this.refreshInterval = setInterval(async () => {
      try {
        const result = await chrome.storage.local.get(['crossie_auth']);
        const authData: StoredAuthData = result.crossie_auth;
        
        if (authData && authData.user) {
          const timeUntilExpiry = authData.expires_at - (Date.now() / 1000);
          
          // If token expires in less than 10 minutes, refresh it
          if (timeUntilExpiry < 600) { // 600 seconds = 10 minutes
            const refreshed = await this.refreshToken(authData.refresh_token);
            if (refreshed) {
              // Update auth state with new token
              const profile = await this.fetchProfile(refreshed.user.id, refreshed.access_token);
              this.updateState({
                user: refreshed.user,
                profile,
                authenticated: !!refreshed.user.id,
                loading: false
              });
            } else {
              console.warn('Token refresh failed, user will be logged out');
              // Don't immediately sign out, let it happen naturally on next interaction
            }
          }
        }
      } catch (error) {
        console.error('Background refresh error:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  // Stop background refresh
  private stopBackgroundRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Get Supabase config from storage or fallback
  private async getSupabaseConfig(): Promise<SupabaseConfig> {
  const DEFAULT_CONFIG: SupabaseConfig = {
    url: 'https://sxargqkknhkcfvhbttrh.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k'
  };

  try {
    const result = await chrome.storage.local.get(['supabase_config']);
    if (result.supabase_config) {
      return result.supabase_config;
    } else {
      // save defaults on first run
      await chrome.storage.local.set({ supabase_config: DEFAULT_CONFIG });
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    console.warn('Could not get Supabase config from storage:', error);
    return DEFAULT_CONFIG;
  }
}

  // Check current authentication state
  async checkAuthState(): Promise<AuthState> {
    try {
      const result = await chrome.storage.local.get(['crossie_auth']);
      const authData: StoredAuthData = result.crossie_auth;
      
      if (authData && authData.user) {
        // Check if token is still valid
        const isTokenValid = authData.expires_at > Date.now() / 1000;
        
        if (isTokenValid) {
          // Token is valid, fetch profile
          const profile = await this.fetchProfile(authData.user.id, authData.access_token);
          this.updateState({
            user: authData.user,
            profile,
            authenticated: !!authData.user.id, // ✅ Fixed: user is authenticated regardless of profile
            loading: false
          });
        } else {
          // Token expired, try to refresh
          const refreshed = await this.refreshToken(authData.refresh_token);
          if (refreshed) {
            const profile = await this.fetchProfile(refreshed.user.id, refreshed.access_token);
            this.updateState({
              user: refreshed.user,
              profile,
              authenticated: !!refreshed.user.id, // ✅ Fixed: user is authenticated regardless of profile
              loading: false
            });
          } else {
            // Refresh failed - check how long the token has been expired
            const timeSinceExpiry = (Date.now() / 1000) - authData.expires_at;
            
            // Only sign out if token has been expired for more than 7 days
            // This gives grace period for temporary network issues
            if (timeSinceExpiry > (7 * 24 * 60 * 60)) { // 7 days
              await this.signOut();
            } else {
              // Keep user logged in but mark as unauthenticated for this session
              this.updateState({
                user: authData.user,
                profile: null, // Will be fetched next time
                authenticated: false, // Mark as unauthenticated for this session
                loading: false
              });
            }
          }
        }
      } else {
        // No auth data
        this.updateState({
          user: null,
          profile: null,
          authenticated: false,
          loading: false
        });
      }
    } catch (error) {
      console.error('Auth state check failed:', error);
      this.updateState({
        user: null,
        profile: null,
        authenticated: false,
        loading: false
      });
    }

    return this.currentState;
  }

  // Fetch profile from Supabase
  private async fetchProfile(userId: string, accessToken?: string): Promise<Profile | null> {
    try {
      const config = await this.getSupabaseConfig();
      if (!config) return null;

      // Try authenticated request first
      if (accessToken) {
        const response = await fetch(`${config.url}/rest/v1/profiles?id=eq.${userId}&select=id,username,email`, {
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            return this.formatProfile(data[0]);
          }
        }
      }

      // Fallback to public request
      const response = await fetch(`${config.url}/rest/v1/profiles?id=eq.${userId}&select=id,username,email`, {
        headers: {
          'apikey': config.anonKey,
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          return this.formatProfile(data[0]);
        }
      }

      return null;
    } catch (error) {
      console.error('Profile fetch failed:', error);
      return null;
    }
  }

  // Format profile data consistently
  private formatProfile(profileData: any): Profile {
    return {
      id: profileData.id,           // ✅ Added id field
      username: profileData.username,
      email: profileData.email
    };
  }

  // Refresh expired token
  private async refreshToken(refreshToken: string): Promise<StoredAuthData | null> {
    try {
      if (!this.supabase) return null;

      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (error || !data.session) {
        console.error('Token refresh failed:', error);
        return null;
      }

      const authData: StoredAuthData = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.session.user,
        expires_at: data.session.expires_at
      };

      await this.saveAuthData(authData);
      return authData;
    } catch (error) {
      console.error('Token refresh error:', error);
      return null;
    }
  }

  // Save authentication data to storage
  async saveAuthData(authData: StoredAuthData, config?: SupabaseConfig): Promise<void> {
    const storageData: any = { crossie_auth: authData };

    if (config) {
      storageData.supabase_config = config;
    }

    await chrome.storage.local.set(storageData);
    
    // Restart background refresh when new auth data is saved
    this.startBackgroundRefresh();
    
    // Broadcast auth state change
    this.broadcastAuthChange();
  }

  // Save profile data
  async saveProfile(profileData: Profile): Promise<void> {
    const currentAuth = await chrome.storage.local.get(['crossie_auth']);
    if (currentAuth.crossie_auth) {
      this.updateState({
        ...this.currentState,
        profile: profileData,
        authenticated: !!currentAuth.crossie_auth.user.id,
        loading: false
      });
    }
  }

  // Sign out
  async signOut(): Promise<void> {
    try {
      // Stop background refresh when signing out
      this.stopBackgroundRefresh();
      
      await chrome.storage.local.remove(['crossie_auth']);
      this.updateState({
        user: null,
        profile: null,
        authenticated: false,
        loading: false
      });
      this.broadcastAuthChange();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }

  // Subscribe to auth state changes
  subscribe(callback: (state: AuthState) => void): () => void {
    this.listeners.push(callback);
    
    // Immediately call with current state
    callback(this.currentState);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  // Get current state
  getState(): AuthState {
    return { ...this.currentState };
  }

  // Update state and notify listeners
  private updateState(newState: Partial<AuthState>): void {
    this.currentState = { ...this.currentState, ...newState };
    this.notifyListeners();
  }

  // Notify all listeners
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentState);
      } catch (error) {
        console.error('Auth listener error:', error);
      }
    });
  }

  // Listen for storage changes and messages from other components
  private initializeStorageListener(): void {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.onChanged
    ) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.crossie_auth) {
          setTimeout(() => this.checkAuthState(), 100);
        }
      });
    } else {
      console.warn('⚠️ chrome.storage.onChanged is not available — skipping listener setup');
    }

    // Listen for runtime messages (like SIGN_OUT from background script)
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.onMessage
    ) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'SIGN_OUT') {
          this.handleSignOutMessage();
        }
        return true; // Keep message channel open
      });
    }
  }

  // Handle sign out message from background script
  private async handleSignOutMessage(): Promise<void> {
    
    // Stop background refresh
    this.stopBackgroundRefresh();
    
    // Update state immediately
    this.updateState({
      user: null,
      profile: null,
      authenticated: false,
      loading: false
    });
    
  }

  // Broadcast auth changes to other parts of extension
  private broadcastAuthChange(): void {
    try {
      chrome.runtime.sendMessage({
        type: 'AUTH_STATE_CHANGED',
        authenticated: this.currentState.authenticated
      });
    } catch (error) {
      // Ignore errors if runtime is not available
    }
  }

  // Get Supabase client (for components that need direct access)
  getSupabaseClient() {
    return this.supabase;
  }
}

// Export singleton instance
export const authService = new AuthService();