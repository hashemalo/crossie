import { createClient } from '@supabase/supabase-js'

declare const chrome: any

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Generate a secure token for the extension
export function generateExtensionToken(userId: string): string {
  // In production, use a proper JWT or signed token
  // For now, we'll use a simple format
  const timestamp = Date.now()
  const token = btoa(JSON.stringify({
    userId,
    timestamp,
    type: 'extension_auth'
  }))
  return token
}

// Send message to extension
export async function sendTokenToExtension(token: string, sessionData: any) {
  const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID
  
  if (!extensionId) {
    console.error('Extension ID not configured')
    // During development, try using broadcast channel as fallback
    const channel = new BroadcastChannel('crossie_auth')
    channel.postMessage({
      type: 'AUTH_SUCCESS',
      token,
      session: sessionData
    })
    channel.close()
    return true
  }

  try {
    // Try Chrome extension messaging
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(extensionId, {
        type: 'AUTH_SUCCESS',
        token,
        session: sessionData
      })
      return true
    }
    
    // Fallback: PostMessage (if extension opens website in iframe/popup)
    if (window.opener) {
      window.opener.postMessage({
        type: 'AUTH_SUCCESS',
        token,
        session: sessionData
      }, '*')
      return true
    }

    // Another fallback: Broadcast channel
    const channel = new BroadcastChannel('crossie_auth')
    channel.postMessage({
      type: 'AUTH_SUCCESS',
      token,
      session: sessionData
    })
    channel.close()
    return true
    
  } catch (error) {
    console.error('Failed to send token to extension:', error)
    return false
  }
}