import { useState } from "react";

export default function Crossie() {
  const [txt, setTxt] = useState("");
  const [msgs, setMsgs] = useState<string[]>([]);

  const send = () => {
    if (!txt.trim()) return;
    setMsgs([...msgs, txt]);
    setTxt("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="relative select-none">
      <header className="bg-slate-800 rounded-t-xl px-4 py-2 text-white font-semibold flex items-center justify-between">
        <span>Crossie</span>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
          <div className="w-3 h-3 bg-green-400 rounded-full"></div>
        </div>
      </header>
      
      <section className="bg-slate-900 text-white p-4 space-y-3 rounded-b-xl border-t border-slate-700">
        {/* Messages area */}
        <div className="max-h-40 overflow-y-auto space-y-2">
          {msgs.length === 0 ? (
            <p className="text-slate-400 text-sm italic">No messages yet...</p>
          ) : (
            msgs.map((m, i) => (
              <div key={i} className="bg-slate-800 p-3 rounded-lg">
                <p className="text-sm">{m}</p>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <div className="space-y-2">
          <textarea
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyPress={handleKeyPress}
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