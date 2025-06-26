import { useState, useEffect } from "react";

interface User {
  id: string;
  email?: string;
}

interface Profile {
  username: string;
  full_name: string;
  avatar_url: string;
}

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  user: Profile;
}

export default function Crossie() {
  const [txt, setTxt] = useState("");
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);

  useEffect(() => {
    // Listen for auth state updates from inject.ts
    const messageListener = (event: MessageEvent) => {
      if (event.data?.type === 'AUTH_STATE_UPDATE') {
        setAuthenticated(event.data.authenticated);
        setCurrentUser(event.data.user);
        setCurrentProfile(event.data.profile);
      }
    };
    
    window.addEventListener('message', messageListener);
    
    // Request initial auth state
    window.parent.postMessage({ type: 'REQUEST_AUTH_STATE' }, '*');
    
    return () => {
      window.removeEventListener('message', messageListener);
    };
  }, []);

  const send = () => {
    if (!txt.trim() || !authenticated || !currentProfile || !currentUser) return;
    
    const newMessage: Message = {
      id: Date.now().toString(),
      text: txt.trim(),
      timestamp: new Date(),
      user: currentProfile
    };
    
    setMsgs([...msgs, newMessage]);
    setTxt("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const minimize = () => {
    window.parent.postMessage({ type: "CROSSIE_MINIMIZE" }, "*");
  };

  const openAuth = () => {
    window.parent.postMessage({ type: "OPEN_AUTH_POPUP" }, "*");
  };

  const signOut = () => {
    window.parent.postMessage({ type: "SIGN_OUT" }, "*");
  };

  if (!authenticated) {
    return (
      <div className="relative select-none">
        <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
          <span>Crossie</span>
          <button
            onClick={minimize}
            className="hover:bg-slate-700 rounded transition-colors"
            title="Minimize"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </header>

        <section className="bg-slate-900 text-white p-6 rounded-b-xl border-t border-slate-700 text-center">
          <div className="mb-4">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-3 text-slate-400">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <h3 className="text-lg font-semibold mb-2">Welcome to Crossie</h3>
            <p className="text-slate-400 text-sm mb-4">Sign in to start commenting and connecting with others on any website.</p>
          </div>
          
          <button
            onClick={openAuth}
            className="w-full bg-blue-600 hover:bg-blue-500 py-3 px-4 rounded-lg text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10,17 15,12 10,7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
            Sign In / Sign Up
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="relative select-none">
      <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>Crossie</span>
          {currentProfile && (
            <div className="flex items-center gap-2">
              <img 
                src={currentProfile.avatar_url} 
                alt="Profile" 
                className="w-6 h-6 rounded-full"
              />
            </div>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-400 rounded-full" title="Online"></div>
            {msgs.length > 0 && (
              <span className="text-xs bg-blue-600 px-2 py-1 rounded-full">
                {msgs.length}
              </span>
            )}
          </div>
          
          <button
            onClick={minimize}
            className="hover:bg-slate-700 rounded transition-colors"
            title="Minimize"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </header>

      <section className="bg-slate-900 text-white p-4 space-y-3 rounded-b-xl border-t border-slate-700">
        {/* Messages area */}
        <div className="max-h-40 overflow-y-auto space-y-2">
          {msgs.length === 0 ? (
            <p className="text-slate-400 text-sm italic">No messages yet...</p>
          ) : (
            msgs.map((msg) => (
              <div key={msg.id} className="bg-slate-800 p-3 rounded-lg">
                <div className="flex items-start gap-2">
                  <img 
                    src={msg.user.avatar_url} 
                    alt={msg.user.username} 
                    className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-blue-400">
                        {msg.user.username}
                      </span>
                      <span className="text-xs text-slate-400">
                        {msg.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm">{msg.text}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="space-y-2">
          <textarea
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={handleKeyPress}
            rows={2}
            className="w-full bg-slate-800 text-white p-3 rounded-lg resize-none placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Type your message..."
          />

          <div className="flex space-x-2">
            <button
              onClick={send}
              disabled={!txt.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 py-2 px-4 rounded-lg text-white font-medium transition-colors"
            >
              Send
            </button>
            
            <button
              onClick={() => setMsgs([])}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title="Clear messages"
            >
              Clear
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}