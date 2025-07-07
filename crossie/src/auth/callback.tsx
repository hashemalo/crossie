// AuthCallback.tsx
import { useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuthCallback() {
  useEffect(() => {
    const handleAuthCallback = async () => {
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Auth callback error:', error);
      }
      
      // Close the popup window
      window.close();
    };

    handleAuthCallback();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
        <p>Completing sign in...</p>
      </div>
    </div>
  );
}