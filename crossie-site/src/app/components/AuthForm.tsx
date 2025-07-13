'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError('')

    try {
      console.log('Starting Google sign in...') 
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          }
        }
      })

      if (error) {
        console.error('OAuth error:', error)
        throw error
      }
      
      if (!data.url) {
        throw new Error('No OAuth URL received')
      }
      
      console.log('Redirecting to:', data.url)
    } catch (error: any) {
      console.error('Sign in error:', error)
      setError(error.message || 'Failed to sign in with Google')
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-800 rounded-lg shadow-xl p-8">
      {/* Logo */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-blue-400 mb-2">Crossie</h1>
        <p className="text-slate-400">Sign in to enable annotations everywhere</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Sign In Button */}
      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-3"
      >
        {loading ? (
          <div className="animate-spin w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full"></div>
        ) : (
          <>
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Continue with Google</span>
          </>
        )}
      </button>

      {/* Terms */}
      <p className="text-center text-slate-400 text-xs mt-6">
        By continuing, you agree to our Terms of Service and Privacy Policy
      </p>

      {/* Extension info */}
      <div className="mt-8 pt-6 border-t border-slate-700">
        <p className="text-center text-slate-400 text-sm">
          Make sure the Crossie extension is installed in your browser
        </p>
      </div>
    </div>
  )
}