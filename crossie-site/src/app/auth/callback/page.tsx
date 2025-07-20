'use client'

import { useEffect, useState } from 'react'
import { supabase, generateExtensionToken, sendTokenToExtension } from '../../lib/supabase'
import { sanitizeUsername, validateUsername, USERNAME_PATTERN, USERNAME_REQUIREMENTS } from '../../lib/username'
import type { User, Session } from '@supabase/supabase-js'

type AuthStatus = 'loading' | 'profile' | 'success' | 'error' | 'signed_out'

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [error, setError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  useEffect(() => {
    let hasProcessed = false

    const processAuthOnce = async (currentSession: Session | null) => {
      if (hasProcessed) {
        console.log('Auth already processed, skipping...')
        return
      }
      
      if (!currentSession) {
        console.log('No session found')
        setStatus('signed_out')
        return
      }

      hasProcessed = true
      console.log('Processing auth for user:', currentSession.user.id)
      
      setSession(currentSession)
      setUser(currentSession.user)

      try {
        // Quick profile check
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('username, email, id')
          .eq('id', currentSession.user.id)
          .single()

        if (profileError && profileError.code === 'PGRST116') {
          // No profile found
          console.log('No profile found, showing profile creation')
          const displayName = currentSession.user.user_metadata?.full_name || 
                             currentSession.user.user_metadata?.name || 
                             currentSession.user.email?.split('@')[0] || ''
          
          setUsername(sanitizeUsername(displayName))
          setStatus('profile')
        } else if (profileError) {
          // Database error
          console.error('Database error:', profileError)
          setError(`Database error: ${profileError.message}`)
          setStatus('error')
        } else {
          // Profile exists - go straight to success
          console.log('Profile found, going to success')
          await sendAuthToExtension(currentSession, profile)
          setStatus('success')
        }
      } catch (error: any) {
        console.error('Auth processing error:', error)
        setError(error.message || 'Authentication failed')
        setStatus('error')
      }
    }

    // Only check initial auth state - ignore the auth state listener for now
    const checkAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        await processAuthOnce(session)
      } catch (error: any) {
        console.error('Initial auth check error:', error)
        setError(error.message || 'Authentication failed')
        setStatus('error')
      }
    }

    checkAuth()

    // Minimal auth listener just for sign out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setStatus('signed_out')
        setSession(null)
        setUser(null)
        hasProcessed = false
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      if (!user || !session) throw new Error('No user or session found')

      console.log('Creating profile for user:', user.id)
      
      // Validate and sanitize username
      const sanitizedUsername = sanitizeUsername(username);
      const validation = validateUsername(sanitizedUsername);
      
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      const { data, error } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          username: sanitizedUsername,
          email: user.email,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        console.error('Profile creation error:', error)
        throw error
      }

      console.log('Profile created successfully:', data)
      
      // Send to extension
      await sendAuthToExtension(session, data)
      setStatus('success')
    } catch (error: any) {
      console.error('Save profile error:', error)
      setError(error.message)
    }
  }

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      setError('')
      
      // Send sign out message to extension first
      const { sendSignOutToExtension } = await import('../../lib/supabase');
      await sendSignOutToExtension();
      
      // Then sign out from Supabase
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      
    } catch (error: any) {
      console.error('Sign out error:', error)
      setError(error.message || 'Sign out failed')
    } finally {
      setIsSigningOut(false)
    }
  }

  const sendAuthToExtension = async (currentSession: Session, profile: any) => {
    console.log('Attempting to send auth to extension...');
    
    try {
      const token = generateExtensionToken(currentSession.user.id)
      
      const authData = {
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token,
        user: currentSession.user,
        profile: profile,
        expires_at: currentSession.expires_at,
        supabase_config: {
          url: "https://sxargqkknhkcfvhbttrh.supabase.co",
          anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k"
        }
      }

      console.log('Auth data prepared:', { userId: currentSession.user.id, profile: profile.username });

      const sent = await sendTokenToExtension(token, authData)
      if (!sent) {
        console.warn('Could not send token to extension directly')
      } else {
        console.log('Token sent to extension successfully');
      }
    } catch (error) {
      console.error('Error sending auth to extension:', error)
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3-3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
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
            <p className="text-slate-400">Choose a username to complete your profile {session?.user?.email}</p>
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
                onChange={(e) => {
                  const sanitized = sanitizeUsername(e.target.value);
                  setUsername(sanitized);
                  
                  // Validate in real-time
                  if (sanitized) {
                    const validation = validateUsername(sanitized);
                    setUsernameError(validation.isValid ? '' : validation.error || '');
                  } else {
                    setUsernameError('');
                  }
                }}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="username.example_123"
                required
                pattern={USERNAME_PATTERN}
                title={USERNAME_REQUIREMENTS}
              />
              <p className="text-xs text-slate-400 mt-1">
                {USERNAME_REQUIREMENTS}
              </p>
              {usernameError && (
                <p className="text-xs text-red-400 mt-1">
                  {usernameError}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={!username.trim() || !!usernameError}
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
              Your crossie extension is now connected.
            </p>
            <div className="flex justify-center space-x-4">
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-6 rounded-lg font-medium transition-colors"
              >
                Go to Dashboard
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