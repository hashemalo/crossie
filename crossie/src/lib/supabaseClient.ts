// lib/supabaseClient.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

class SupabaseAuthClient {
  private client: SupabaseClient;
  private url = "https://sxargqkknhkcfvhbttrh.supabase.co";
  private anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k";

  constructor() {
    // Create a standard client instance with proper auth configuration
    this.client = createClient(this.url, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true, // Enable automatic token refresh
        detectSessionInUrl: false,
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        }
      }
    });
  }

  // Update the auth token by setting the session properly
  async setAuth(authData: any) {

    
    if (authData && authData.access_token) {
      try {
        // Set the session using Supabase's built-in method
        const { data, error } = await this.client.auth.setSession({
          access_token: authData.access_token,
          refresh_token: authData.refresh_token || ''
        });
        
        if (error) {
          console.error('[SupabaseAuthClient] Failed to set session:', error);
          throw error;
        }
        
        
        // Verify the session is working
        const { data: user, error: userError } = await this.client.auth.getUser();
        if (userError) {
          console.error('[SupabaseAuthClient] User verification failed:', userError);
        } 
        
      } catch (err) {
        console.error('[SupabaseAuthClient] Error setting auth:', err);
        throw err;
      }
    } else {
      // Clear the session
      await this.client.auth.signOut();
    }
  }

  // Get the client instance
  getClient(): SupabaseClient {
    return this.client;
  }

  // Get current session
  async getCurrentSession() {
    return await this.client.auth.getSession();
  }

  // Get current user
  async getCurrentUser() {
    return await this.client.auth.getUser();
  }
}

// Create a singleton instance
const supabaseAuth = new SupabaseAuthClient();

// Export the same client instance always
export const supabase = supabaseAuth.getClient();

// Export the auth client for setting tokens
export const supabaseAuthClient = supabaseAuth;