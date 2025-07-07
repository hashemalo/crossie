// lib/supabaseClient.ts
import { createClient, SupabaseClient, type Session, type User } from '@supabase/supabase-js';

class SupabaseAuthClient {
  private client: SupabaseClient;
  private url = "https://sxargqkknhkcfvhbttrh.supabase.co";
  private anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k";

  constructor() {
    this.client = createClient(this.url, this.anonKey, {
      auth: {
        persistSession: false, // Don't persist in iframe context
        autoRefreshToken: false, // We'll handle refresh through extension
        detectSessionInUrl: false // Don't check URL for sessions
      }
    });
  }

  // Decode JWT to extract user info
  private decodeJWT(token: string): any {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('[SupabaseAuthClient] Failed to decode JWT:', error);
      return null;
    }
  }

  // Update the client with a new access token and user data
  async setAuth(accessToken: string | null, userData?: { id: string; email?: string }) {
    console.log('[SupabaseAuthClient] Setting auth token:', accessToken ? 'Token present' : 'No token');
    
    if (accessToken) {
      console.log('[SupabaseAuthClient] Token details:', {
        length: accessToken.length,
        prefix: accessToken.substring(0, 20) + '...',
        isJWT: accessToken.split('.').length === 3
      });
      
      try {
        // Decode the JWT to get claims
        const jwtPayload = this.decodeJWT(accessToken);
        console.log('[SupabaseAuthClient] JWT payload:', {
          sub: jwtPayload?.sub,
          email: jwtPayload?.email,
          exp: jwtPayload?.exp,
          role: jwtPayload?.role
        });

        // Create user object from JWT claims and provided data
        const user: User = {
          id: userData?.id || jwtPayload?.sub || '',
          aud: jwtPayload?.aud || 'authenticated',
          role: jwtPayload?.role || 'authenticated',
          email: userData?.email || jwtPayload?.email || '',
          email_confirmed_at: jwtPayload?.email_confirmed_at || new Date().toISOString(),
          phone: jwtPayload?.phone || '',
          confirmed_at: jwtPayload?.confirmed_at || new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          app_metadata: jwtPayload?.app_metadata || {},
          user_metadata: jwtPayload?.user_metadata || {},
          identities: jwtPayload?.identities || [],
          created_at: jwtPayload?.created_at || new Date().toISOString(),
          updated_at: jwtPayload?.updated_at || new Date().toISOString()
        };

        // Create a complete session object
        const session: Session = {
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: jwtPayload?.exp ? jwtPayload.exp - Math.floor(Date.now() / 1000) : 3600,
          expires_at: jwtPayload?.exp || Math.floor(Date.now() / 1000) + 3600,
          refresh_token: '', // We don't have refresh token in iframe
          user: user
        };

        console.log('[SupabaseAuthClient] Setting session with user:', {
          userId: user.id,
          email: user.email
        });

        // Set the session
        const { data, error } = await this.client.auth.setSession(session);
        
        if (error) {
          console.error('[SupabaseAuthClient] Error setting session:', error);
        } else {
          console.log('[SupabaseAuthClient] Session set successfully');
          
          // Verify the session was set
          const { data: { user: currentUser } } = await this.client.auth.getUser();
          console.log('[SupabaseAuthClient] Verified current user:', {
            hasUser: !!currentUser,
            userId: currentUser?.id,
            email: currentUser?.email
          });
        }
        
      } catch (error) {
        console.error('[SupabaseAuthClient] Error in setAuth:', error);
      }
    } else {
      // Clear auth if no token
      console.log('[SupabaseAuthClient] Clearing auth state');
      await this.client.auth.signOut();
    }
  }

  // Get the client instance
  getClient(): SupabaseClient {
    return this.client;
  }
}

// Create a singleton instance
const supabaseAuth = new SupabaseAuthClient();

// Export the client getter for backward compatibility
export const supabase = supabaseAuth.getClient();

// Export the auth client for setting tokens
export const supabaseAuthClient = supabaseAuth;