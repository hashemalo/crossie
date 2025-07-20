'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Chrome extension types
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (extensionId: string, message: any, callback?: (response: any) => void) => void;
        lastError?: any;
      };
    };
  }
}

const supabase = createClient(
  "https://sxargqkknhkcfvhbttrh.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k"
);

interface User {
  id: string;
  username: string;
  email?: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Fetch user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, email')
        .eq('id', session.user.id)
        .single();
      
      if (profile) {
        setUser(profile);
      }
    }
    setLoading(false);
  };

  const handleSignIn = () => {
    window.location.href = '/auth';
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleTryCrossie = () => {
    // Check if extension is installed
    if (typeof window !== 'undefined' && window.chrome?.runtime) {
      try {
        window.chrome?.runtime?.sendMessage('hfcbcikkdedakcklfikiblmpphmamfal', { type: 'PING' }, (response: any) => {
          if (window.chrome?.runtime?.lastError) {
            // Extension not installed, redirect to Chrome Web Store
            window.open('https://chromewebstore.google.com/detail/crossie/hfcbcikkdedakcklfikiblmpphmamfal', '_blank');
          } else {
            // Extension is installed, try to open it
            window.chrome?.runtime?.sendMessage('hfcbcikkdedakcklfikiblmpphmamfal', { type: 'OPEN_SIDEBAR' });
          }
        });
      } catch (error) {
        // Fallback to Chrome Web Store
        window.open('https://chromewebstore.google.com/detail/crossie/hfcbcikkdedakcklfikiblmpphmamfal', '_blank');
      }
    } else {
      // Not in Chrome, redirect to Chrome Web Store
      window.open('https://chromewebstore.google.com/detail/crossie/hfcbcikkdedakcklfikiblmpphmamfal', '_blank');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-blue-400">crossie</h1>
            </div>
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  <span className="text-sm text-slate-400">
                    Welcome, {user.username}
                  </span>
                  <a
                    href="/dashboard"
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Dashboard
                  </a>
                  <button
                    onClick={handleSignOut}
                    className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={handleSignIn}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-6">
            Annotate <span className="text-blue-400">everywhere</span> on the web
          </h1>
          <p className="text-xl text-slate-400 mb-8 max-w-3xl mx-auto">
            crossie is a powerful browser extension that lets you highlight text, add comments, 
            and collaborate on any website. Perfect for research, feedback, and team collaboration.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <button
              onClick={handleTryCrossie}
              className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-lg font-medium text-lg transition-colors"
            >
              Try crossie
            </button>
            {!user && (
              <a
                href="/auth"
                className="bg-slate-700 hover:bg-slate-600 text-white px-8 py-4 rounded-lg font-medium text-lg transition-colors"
              >
                Get Started
              </a>
            )}
          </div>
        </div>

        {/* Features Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Highlight & Comment</h3>
            <p className="text-slate-400">
              Select any text on any website and add your thoughts, feedback, or notes.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Team Collaboration</h3>
            <p className="text-slate-400">
              Share annotations with your team and collaborate on projects together.
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-blue-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Organize Projects</h3>
            <p className="text-slate-400">
              Keep your annotations organized with projects and pages for easy management.
            </p>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-20">
          <h2 className="text-3xl font-bold text-white text-center mb-12">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">1. Install the Extension</h3>
              <p className="text-slate-400 mb-4">
                Add crossie to your Chrome browser with one click from the Chrome Web Store.
              </p>
              <button
                onClick={handleTryCrossie}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Install Now
              </button>
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">2. Start Annotating</h3>
              <p className="text-slate-400 mb-4">
                Visit any website, select text, and click the crossie sidebar to add your annotations.
              </p>
              <div className="text-slate-400 text-sm">
                • Highlight any text on any website<br/>
                • Add comments and notes<br/>
                • Organize with projects
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}