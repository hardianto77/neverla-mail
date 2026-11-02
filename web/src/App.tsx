import { useState, useEffect } from 'react';
import { Mail, RefreshCw, Copy, Check, ShieldCheck, Inbox, ExternalLink } from 'lucide-react';

interface Message {
  id: string;
  from_address: string;
  subject: string;
  otp_code?: string;
  created_at: string;
}

export default function App() {
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('neverla.web.id');
  const [username, setUsername] = useState('agent-' + Math.random().toString(36).substring(2, 8));
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeMessage, setActiveMessage] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentAddress = `${username}@${selectedDomain}`;

  // Fetch Domains
  useEffect(() => {
    fetch('/v1/domains')
      .then(res => res.json())
      .then(data => {
        if (data.domains && data.domains.length > 0) {
          setDomains(data.domains);
          setSelectedDomain(data.domains[0]);
        }
      })
      .catch(console.error);
  }, []);

  // Poll Mailbox
  const fetchMailbox = () => {
    setLoading(true);
    fetch(`/v1/mailbox?address=${encodeURIComponent(currentAddress)}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchMailbox();
    const timer = setInterval(fetchMailbox, 4000);
    return () => clearInterval(timer);
  }, [currentAddress]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(currentAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateRandom = () => {
    setUsername('user-' + Math.random().toString(36).substring(2, 8));
    setActiveMessage(null);
  };

  const viewMessage = (id: string) => {
    fetch(`/v1/message/${id}`)
      .then(res => res.json())
      .then(data => setActiveMessage(data))
      .catch(console.error);
  };

  return (
    <div className="min-h-screen bg-[#071529] text-slate-100 flex flex-col font-sans">
      {/* Navigation Header */}
      <header className="border-b border-blue-950/80 bg-[#0C2340]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-800 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-900/40 border border-blue-500/30 text-xl">
              N
            </div>
            <div>
              <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-blue-400 to-indigo-200 bg-clip-text text-transparent">
                Neverla Mail
              </span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-900/60 border border-blue-700/50 text-blue-300 font-mono">
                Go + React + SQLite
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-6 text-sm font-medium">
            <a href="/docs/api" className="text-slate-300 hover:text-white transition">API Docs</a>
            <a href="/guides/temp-mail-for-ai-agents" className="text-slate-300 hover:text-white transition">AI MCP</a>
            <a href="https://github.com/hardianto77/neverla-mail" target="_blank" rel="noreferrer" className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-700/50 hover:bg-blue-800/40 transition text-blue-300">
              <span>GitHub</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero / Address Bar */}
      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full">
        <div className="bg-[#0C2340] border border-blue-900/60 rounded-2xl p-6 shadow-2xl shadow-blue-950/40 mb-8">
          <div className="max-w-3xl mx-auto text-center mb-6">
            <h1 className="text-3xl font-bold tracking-tight mb-2 text-white">
              Disposable High-Speed Temp Mailbox
            </h1>
            <p className="text-slate-400 text-sm">
              Instant keyless REST API, multi-domain .com support, built on Go & SQLite WAL engine.
            </p>
          </div>

          <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-3 items-center bg-[#071529]/80 p-2.5 rounded-xl border border-blue-800/50">
            <div className="flex items-center flex-1 w-full px-3 gap-2">
              <Mail className="w-5 h-5 text-blue-400 shrink-0" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="bg-transparent border-none text-white focus:outline-none w-full font-mono text-sm"
                placeholder="custom-name"
              />
              <span className="text-slate-500 font-mono">@</span>
              <select
                value={selectedDomain}
                onChange={e => setSelectedDomain(e.target.value)}
                className="bg-[#0C2340] text-blue-300 border border-blue-700/60 rounded-lg px-2.5 py-1 text-sm font-mono focus:outline-none"
              >
                {domains.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={copyToClipboard}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-md shadow-blue-600/30"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={generateRandom}
                className="px-3 py-2 rounded-lg bg-blue-950/60 border border-blue-700/50 hover:bg-blue-900/60 text-slate-300 text-sm transition flex items-center gap-1.5"
                title="Random Name"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline">Random</span>
              </button>
            </div>
          </div>
        </div>

        {/* Inbox / Split Viewer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Inbox List */}
          <div className="lg:col-span-5 bg-[#0C2340] border border-blue-900/60 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-blue-900/60 flex items-center justify-between bg-[#0C2340]/90">
              <div className="flex items-center space-x-2">
                <Inbox className="w-5 h-5 text-blue-400" />
                <h2 className="font-semibold text-white">Inbox ({messages.length})</h2>
              </div>
              <button
                onClick={fetchMailbox}
                className={`p-1.5 rounded-lg text-slate-400 hover:text-white transition ${loading ? 'animate-spin' : ''}`}
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-blue-950/80 max-h-[550px] overflow-y-auto">
              {messages.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                  <Mail className="w-10 h-10 text-slate-600 mb-3 animate-pulse" />
                  <p className="font-medium text-slate-300">Listening for incoming emails...</p>
                  <p className="text-xs text-slate-500 mt-1">Send a verification code or email to test live delivery.</p>
                </div>
              ) : (
                messages.map(m => (
                  <div
                    key={m.id}
                    onClick={() => viewMessage(m.id)}
                    className={`p-4 cursor-pointer transition hover:bg-blue-950/40 flex flex-col gap-1.5 ${activeMessage?.id === m.id ? 'bg-blue-900/30 border-l-4 border-blue-500' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-200 truncate max-w-[200px]">
                        {m.from_address}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-white truncate">
                      {m.subject || '(No Subject)'}
                    </div>
                    {m.otp_code && (
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold w-fit mt-1">
                        <span>OTP:</span>
                        <span className="tracking-widest text-white">{m.otp_code}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Message Reader */}
          <div className="lg:col-span-7 bg-[#0C2340] border border-blue-900/60 rounded-2xl overflow-hidden shadow-xl min-h-[500px]">
            {activeMessage ? (
              <div className="flex flex-col h-full">
                <div className="p-6 border-b border-blue-900/60 bg-[#091C34]">
                  <h3 className="text-xl font-bold text-white mb-2">
                    {activeMessage.subject || '(No Subject)'}
                  </h3>
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
                    <div>
                      <span className="text-slate-500">From:</span> <span className="text-slate-200 font-mono">{activeMessage.from_address}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Received:</span> <span className="text-slate-300">{new Date(activeMessage.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {activeMessage.otp_code && (
                  <div className="mx-6 my-4 p-4 rounded-xl bg-gradient-to-r from-blue-950/80 to-indigo-950/80 border border-blue-500/40 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-blue-300 font-medium">Verification Code Detected</div>
                      <div className="text-2xl font-mono font-black tracking-widest text-white mt-0.5">
                        {activeMessage.otp_code}
                      </div>
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(activeMessage.otp_code)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Code</span>
                    </button>
                  </div>
                )}

                <div className="p-6 flex-1 overflow-auto text-slate-300 text-sm leading-relaxed">
                  {activeMessage.body_html ? (
                    <div
                      className="prose prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: activeMessage.body_html }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-slate-200">
                      {activeMessage.body_text || '(Empty email body)'}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-16 text-center text-slate-500 flex flex-col items-center justify-center h-full min-h-[450px]">
                <ShieldCheck className="w-12 h-12 text-slate-600 mb-4" />
                <h4 className="text-slate-300 font-medium text-base">No message selected</h4>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Select an email from the left panel to inspect raw text, HTML preview, or parsed OTP tokens.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-blue-950/80 bg-[#0C2340]/60 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© 2026 Neverla Mail. High-Performance Disposable Inbox Engine.</p>
          <div className="flex items-center space-x-4">
            <span className="text-slate-400">Go 1.27 + React 19 + TypeScript + Tailwind CSS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
