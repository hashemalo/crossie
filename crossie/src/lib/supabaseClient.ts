// lib/supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

class SupabaseAuthClient {
  private client: SupabaseClient;
  private url = "https://sxargqkknhkcfvhbttrh.supabase.co";
  private anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k";
  private currentToken: string | null = null;

  constructor() {
    // Create a single client instance with custom fetch
    this.client = createClient(this.url, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        }
      },
      global: {
        fetch: this.customFetch.bind(this)
      }
    });
  }

  // Custom fetch that injects our auth token
  private customFetch(url: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    
    // If we have a token and this is a request to our Supabase instance, add auth header
    if (this.currentToken && url.toString().includes(this.url)) {
      headers.set('Authorization', `Bearer ${this.currentToken}`);
      console.log('[SupabaseAuthClient] Adding auth header to request:', {
        url: url.toString(),
        hasToken: true,
        tokenPrefix: this.currentToken.substring(0, 20) + '...'
      });
    }

    return fetch(url, {
      ...options,
      headers
    });
  }

  // Update the auth token
  async setAuth(accessToken: string | null) {
    console.log('[SupabaseAuthClient] Setting auth token:', accessToken ? 'Token present' : 'No token');
    
    if (accessToken) {
      console.log('[SupabaseAuthClient] Token details:', {
        length: accessToken.length,
        prefix: accessToken.substring(0, 20) + '...',
        isJWT: accessToken.split('.').length === 3
      });
      
      // Store the token
      this.currentToken = accessToken;
      
      console.log('[SupabaseAuthClient] Token stored, will be injected via custom fetch');
      
      // Verify the token works
      try {
        const { data, error } = await this.client
          .from('profiles')
          .select('id')
          .limit(1);
          
        if (error) {
          console.error('[SupabaseAuthClient] Auth verification failed:', error);
        } else {
          console.log('[SupabaseAuthClient] Auth verification successful - token is working');
        }
      } catch (err) {
        console.error('[SupabaseAuthClient] Error verifying auth:', err);
      }
    } else {
      // Clear auth
      console.log('[SupabaseAuthClient] Clearing auth state');
      this.currentToken = null;
    }
  }

  // Get the client instance
  getClient(): SupabaseClient {
    return this.client;
  }

  // Get current token
  getCurrentToken(): string | null {
    return this.currentToken;
  }
}

// Create a singleton instance
const supabaseAuth = new SupabaseAuthClient();

// Export the same client instance always
export const supabase = supabaseAuth.getClient();

// Export the auth client for setting tokens
export const supabaseAuthClient = supabaseAuth;