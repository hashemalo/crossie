'use client'

import { useEffect, useState } from 'react'
import { supabase, generateExtensionToken, sendTokenToExtension } from '../../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

type AuthStatus = 'loading' | 'profile' | 'success' | 'error' | 'signed_out'

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  useEffect(() => {
    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log('Auth state changed:', event, currentSession?.user?.id)
      
      if (event === 'SIGNED_OUT' || !currentSession) {
        setSession(null)
        setUser(null)
        setStatus('signed_out')
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSession(currentSession)
        setUser(currentSession.user)
        
        // Only process initial sign-in, not token refreshes
        if (event === 'SIGNED_IN') {
          await handleAuthCallback(currentSession)
        }
      }
    })

    // Handle initial auth state
    handleInitialAuth()

    // Cleanup subscription on unmount
    return () => subscription.unsubscribe()
  }, [])

  const handleInitialAuth = async () => {
    try {
      const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        throw sessionError
      }

      if (!initialSession) {
        setStatus('signed_out')
        return
      }

      setSession(initialSession)
      setUser(initialSession.user)
      await handleAuthCallback(initialSession)
    } catch (error: any) {
      console.error('Initial auth error:', error)
      setError(error.message || 'Authentication failed')
      setStatus('error')
    }
  }

  const handleAuthCallback = async (currentSession: Session) => {
    try {
      setStatus('loading')

      // Check if profile exists
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentSession.user.id)
        .maybeSingle()

      if (profileError && profileError.code !== 'PGRST116') {
        throw profileError
      }

      if (!profile) {
        // Need to create profile
        const displayName = currentSession.user.user_metadata?.full_name || 
                           currentSession.user.user_metadata?.name || 
                           currentSession.user.email?.split('@')[0] || ''
        
        setUsername(displayName.replace(/[^a-zA-Z0-9_]/g, ''))
        setStatus('profile')
      } else {
        // Profile exists, send token to extension
        await sendAuthToExtension(currentSession, profile)
        setStatus('success')
      }
    } catch (error: any) {
      console.error('Auth callback error:', error)
      setError(error.message || 'Authentication failed')
      setStatus('error')
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      if (!user || !session) throw new Error('No user or session found')

      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          username: username.trim(),
          email: user.email,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error

      // Send to extension
      await sendAuthToExtension(session, data)
      setStatus('success')
    } catch (error: any) {
      setError(error.message)
    }
  }

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      setError('')
      
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      
      // The auth state listener will handle the UI update
    } catch (error: any) {
      console.error('Sign out error:', error)
      setError(error.message || 'Sign out failed')
    } finally {
      setIsSigningOut(false)
    }
  }

  const sendAuthToExtension = async (currentSession: Session, profile: any) => {
    console.log('Attempting to send auth to extension...');
    const token = generateExtensionToken(currentSession.user.id)
    
    const authData = {
      access_token: currentSession.access_token,
      refresh_token: currentSession.refresh_token,
      user: currentSession.user,
      profile: profile,
      expires_at: currentSession.expires_at,
      // Include Supabase config for the extension
      supabase_config: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      }
    }

    console.log('Auth data prepared:', { userId: currentSession.user.id, profile: profile.username });

    const sent = await sendTokenToExtension(token, authData)
    if (!sent) {
      console.warn('Could not send token to extension directly')
    } else {
      console.log('Token sent to extension successfully');
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="animate-spin w-12 h-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-white">Setting up your account...</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="w-20 h-20 bg-red-500 rounded-full mx-auto flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Authentication Failed</h2>
            <p className="text-red-400 mb-6">{error}</p>
            <button
              onClick={() => window.location.href = '/auth'}
              className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'signed_out') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="w-20 h-20 bg-slate-600 rounded-full mx-auto flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Signed Out</h2>
            <p className="text-slate-400 mb-6">
              You have been signed out successfully. You can close this tab or sign in again.
            </p>
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => window.location.href = '/auth'}
                className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
              >
                Sign In Again
              </button>
              <button
                onClick={() => window.close()}
                className="bg-slate-600 hover:bg-slate-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
              >
                Close Tab
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'profile') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-blue-400 mb-2">Almost there!</h1>
            <p className="text-slate-400">Choose a username to complete your profile</p>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Username <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Choose a unique username"
                required
                pattern="^[a-zA-Z0-9_]+$"
                title="Username can only contain letters, numbers, and underscores"
              />
            </div>
            <button
              type="submit"
              disabled={!username.trim()}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Complete Setup
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-700">
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="w-full bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 text-white py-2 px-4 rounded-lg font-medium transition-colors"
            >
              {isSigningOut ? 'Signing Out...' : 'Sign Out'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg shadow-xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Success!</h2>
            <p className="text-slate-400 mb-6">
              Your Crossie extension is now connected. You can close this tab and start commenting on any website!
            </p>
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => window.close()}
                className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
              >
                Close Tab
              </button>
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="bg-red-600 hover:bg-red-500 disabled:bg-red-700 text-white py-2 px-6 rounded-lg font-medium transition-colors"
              >
                {isSigningOut ? 'Signing Out...' : 'Sign Out'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}