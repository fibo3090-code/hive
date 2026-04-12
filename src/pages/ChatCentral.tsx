import { useState, useRef, useEffect } from 'react';
import { mockAgents } from '@/data/mockData';
import { StatusDot } from '@/components/shared/StatusDot';
import { Send, Paperclip, AtSign, Hexagon, Copy, Eye, Code, AlertTriangle, ArrowDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'widget';
  agentId?: string;
  content: string;
  timestamp: string;
  tokens?: number;
  widgetType?: 'deployment' | 'cost' | 'architecture';
  codeBlock?: { language: string; code: string };
}

const mockMessages: Message[] = [
  { id: 'm1', type: 'system', content: 'Session started — 4 agents active', timestamp: '01:00:00' },
  { id: 'm2', type: 'agent', agentId: 'pe-001', content: 'Sprint 3 planning complete. I\'ve assigned tasks to all active agents based on their eval scores and current workload. Frontend Architect will handle the dashboard components while Backend Engineer works on auth middleware.', timestamp: '01:02:15', tokens: 245 },
  { id: 'm3', type: 'user', content: 'What\'s the status on the API documentation?', timestamp: '01:05:30' },
  { id: 'm4', type: 'agent', agentId: 'pe-001', content: 'Doc Writer is currently **blocked** — waiting on the API type definitions from Backend Engineer. I\'ve bumped the priority. Expected unblock in ~15 minutes.', timestamp: '01:05:45', tokens: 180 },
  { id: 'm5', type: 'widget', content: 'Deployment Checklist', timestamp: '01:08:00', widgetType: 'deployment' },
  { id: 'm6', type: 'agent', agentId: 'qa-001', content: 'Integration test suite progress update:', timestamp: '01:12:00', tokens: 320, codeBlock: { language: 'text', code: '✓ Auth flow tests (12/12 passed)\n✓ CRUD operations (8/8 passed)\n✗ WebSocket connections (2/5 failed)\n⏳ Rate limiting (pending)' } },
  { id: 'm7', type: 'widget', content: 'Cost Tracker', timestamp: '01:14:00', widgetType: 'cost' },
  { id: 'm8', type: 'system', content: 'Alert: Budget at 71% — $142/$200 consumed', timestamp: '01:15:00' },
  { id: 'm9', type: 'agent', agentId: 'fe-001', content: 'Dashboard summary tiles are implemented. Here\'s the component:', timestamp: '01:18:00', tokens: 450, codeBlock: { language: 'tsx', code: `export function SummaryTile({ label, value, icon }: TileProps) {\n  return (\n    <div className="rounded-lg border p-4">\n      <div className="flex items-center justify-between">\n        <span className="text-xs">{label}</span>\n        <Icon className="h-4 w-4" />\n      </div>\n      <span className="text-xl font-mono">{value}</span>\n    </div>\n  );\n}` } },
  { id: 'm10', type: 'agent', agentId: 'be-001', content: 'Auth middleware is ready for review. JWT validation, refresh token rotation, and rate limiting are all implemented. PR #11 is up.', timestamp: '01:20:30', tokens: 210 },
];

/* ─── Widget Cards ─── */
function DeploymentWidget() {
  const items = [
    { label: 'Build passes', done: true },
    { label: 'Tests passing (87/94)', done: false },
    { label: 'Security scan clean', done: true },
    { label: 'PR approved', done: false },
    { label: 'Preview deployed', done: true },
  ];
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-sm">
      <h4 className="text-xs font-semibold mb-3 text-primary">📋 Deployment Checklist</h4>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={cn('h-4 w-4 rounded-sm border flex items-center justify-center', item.done ? 'bg-success/20 border-success text-success' : 'border-border')}>
              {item.done && <Check className="h-3 w-3" />}
            </div>
            <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-micro text-muted-foreground">3/5 complete — not ready for deploy</div>
    </div>
  );
}

function CostWidget() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-sm">
      <h4 className="text-xs font-semibold mb-3 text-primary">💰 Session Cost Tracker</h4>
      <div className="space-y-1.5 text-xs">
        {[
          { agent: 'Planning Engine', cost: '$42.50', tokens: '125K' },
          { agent: 'Frontend Architect', cost: '$33.20', tokens: '98K' },
          { agent: 'Backend Engineer', cost: '$38.10', tokens: '112K' },
          { agent: 'QA Sentinel', cost: '$15.30', tokens: '45K' },
          { agent: 'Others', cost: '$12.90', tokens: '62K' },
        ].map(row => (
          <div key={row.agent} className="flex items-center justify-between">
            <span className="text-muted-foreground">{row.agent}</span>
            <div className="flex gap-3">
              <span className="font-mono text-muted-foreground">{row.tokens}</span>
              <span className="font-mono font-medium">{row.cost}</span>
            </div>
          </div>
        ))}
        <div className="border-t border-border pt-1.5 flex justify-between font-medium">
          <span>Total</span>
          <span className="font-mono text-primary">$142.00</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Code Block ─── */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-md border border-border bg-surface-2 mt-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 border-b border-border">
        <span className="text-micro font-mono text-muted-foreground">{language}</span>
        <div className="flex gap-1">
          <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground p-0.5">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
          <button className="text-muted-foreground hover:text-foreground p-0.5"><Eye className="h-3 w-3" /></button>
          <button className="text-muted-foreground hover:text-foreground p-0.5"><Code className="h-3 w-3" /></button>
        </div>
      </div>
      <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto scrollbar-thin"><code>{code}</code></pre>
    </div>
  );
}

/* ─── Inline Alert ─── */
function InlineAlert() {
  return (
    <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2 mx-4 mb-2">
      <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
      <span className="text-xs text-warning">Budget at 71% — consider pausing non-critical agents</span>
    </div>
  );
}

export default function ChatCentral() {
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(mockMessages);
  const [showNewPill, setShowNewPill] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tokenEstimate = Math.round(input.length * 1.3);

  const handleSend = () => {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: `m${Date.now()}`,
      type: 'user',
      content: input,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowNewPill(scrollHeight - scrollTop - clientHeight > 100);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Agent selector tabs */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-2 overflow-x-auto scrollbar-thin">
        <button
          onClick={() => setSelectedAgent('all')}
          className={cn('rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors',
            selectedAgent === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Coordinator
        </button>
        {mockAgents.map((agent) => (
          <button key={agent.id} onClick={() => setSelectedAgent(agent.id)}
            className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors',
              selectedAgent === agent.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <StatusDot status={agent.status} size="sm" />
            {agent.name}
          </button>
        ))}
      </div>

      {/* Message thread */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto scrollbar-thin p-4 space-y-4 relative">
        {messages.map((msg) => {
          if (msg.type === 'system') {
            return (
              <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
                <span className="rounded-full bg-surface-2 px-3 py-1 text-micro text-muted-foreground">{msg.content}</span>
              </motion.div>
            );
          }
          if (msg.type === 'widget') {
            return (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
                {msg.widgetType === 'deployment' && <DeploymentWidget />}
                {msg.widgetType === 'cost' && <CostWidget />}
              </motion.div>
            );
          }
          const agent = msg.agentId ? mockAgents.find(a => a.id === msg.agentId) : null;
          const isUser = msg.type === 'user';
          return (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className={cn('flex gap-3 max-w-[80%]', isUser ? 'ml-auto flex-row-reverse' : '')}
            >
              {!isUser && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Hexagon className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className={cn('rounded-lg px-4 py-2.5', isUser ? 'bg-primary/10 text-foreground' : 'bg-card border border-border')}>
                {!isUser && agent && <span className="text-micro font-medium text-primary block mb-1">{agent.name}</span>}
                <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                {msg.codeBlock && <CodeBlock language={msg.codeBlock.language} code={msg.codeBlock.code} />}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-micro text-muted-foreground font-mono">{msg.timestamp}</span>
                  {msg.tokens && <span className="text-micro text-muted-foreground font-mono">{msg.tokens} tok</span>}
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* New messages pill */}
        <AnimatePresence>
          {showNewPill && (
            <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg z-10"
            >
              <ArrowDown className="h-3 w-3" /> New messages
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Inline alert */}
      <InlineAlert />

      {/* Input area */}
      <div className="border-t border-border p-4">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"><AtSign className="h-4 w-4" /></button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"><Paperclip className="h-4 w-4" /></button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the hive... (⌘Enter to send)"
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[120px]"
            rows={1}
          />
          <div className="flex items-center gap-2">
            <span className="text-micro text-muted-foreground font-mono">{tokenEstimate} tok</span>
            <button onClick={handleSend} className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 transition-colors">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
