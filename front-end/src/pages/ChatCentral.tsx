import { useEffect, useRef, useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';
import { StatusDot } from '@/components/shared/StatusDot';
import { Send, Paperclip, AtSign, Hexagon, Copy, Eye, Code, AlertTriangle, ArrowDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspace } from '@/context/WorkspaceContext';

interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'widget';
  agentId?: string;
  content: string;
  timestamp: string;
  tokens?: number;
  widgetType?: 'deployment' | 'cost';
  codeBlock?: { language: string; code: string };
}

const initialMessages: Message[] = [
  { id: 'm1', type: 'system', content: 'Session started — 4 agents active', timestamp: '01:00:00' },
  { id: 'm2', type: 'agent', agentId: 'pe-001', content: 'Sprint 3 planning complete. I have assigned tasks to all active agents based on their current workload and eval scores.', timestamp: '01:02:15', tokens: 245 },
  { id: 'm3', type: 'user', content: 'What is the status on the API documentation?', timestamp: '01:05:30' },
  { id: 'm4', type: 'agent', agentId: 'pe-001', content: 'Doc Writer is blocked waiting on API type definitions from Backend Engineer. Expected unblock in ~15 minutes.', timestamp: '01:05:45', tokens: 180 },
  { id: 'm5', type: 'widget', content: 'Deployment Checklist', timestamp: '01:08:00', widgetType: 'deployment' },
  { id: 'm6', type: 'widget', content: 'Cost Tracker', timestamp: '01:14:00', widgetType: 'cost' },
];

const fileSuggestions = ['src/components/Dashboard.tsx', 'src/lib/auth.ts', 'src/lib/api.ts', 'docs/architecture.md'];

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
      <h4 className="text-xs font-semibold mb-3 text-primary">Deployment Checklist</h4>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <div className={cn('h-4 w-4 rounded-sm border flex items-center justify-center', item.done ? 'bg-success/20 border-success text-success' : 'border-border')}>
              {item.done && <Check className="h-3 w-3" />}
            </div>
            <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostWidget() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 max-w-sm">
      <h4 className="text-xs font-semibold mb-3 text-primary">Session Cost Tracker</h4>
      <div className="space-y-1.5 text-xs">
        {[
          { agent: 'Planning Engine', cost: '$42.50', tokens: '125K' },
          { agent: 'Frontend Architect', cost: '$33.20', tokens: '98K' },
          { agent: 'Backend Engineer', cost: '$38.10', tokens: '112K' },
          { agent: 'QA Sentinel', cost: '$15.30', tokens: '45K' },
        ].map((row) => (
          <div key={row.agent} className="flex items-center justify-between">
            <span className="text-muted-foreground">{row.agent}</span>
            <div className="flex gap-3">
              <span className="font-mono text-muted-foreground">{row.tokens}</span>
              <span className="font-mono font-medium">{row.cost}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface-2 mt-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 border-b border-border">
        <span className="text-micro font-mono text-muted-foreground">{language}</span>
        <div className="flex gap-1">
          <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} className="text-muted-foreground hover:text-foreground p-0.5">
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

function TypingIndicator({ agentName }: { agentName: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 max-w-[80%]">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Hexagon className="h-4 w-4 text-primary" />
      </div>
      <div className="rounded-lg px-4 py-3 bg-card border border-border">
        <span className="text-micro font-medium text-primary block mb-1">{agentName}</span>
        <div className="flex gap-1">
          {[0, 1, 2].map((index) => <span key={index} className="h-2 w-2 rounded-full bg-primary/60 animate-status-pulse" style={{ animationDelay: `${index * 120}ms` }} />)}
        </div>
      </div>
    </motion.div>
  );
}

export default function ChatCentral() {
  const { state } = useHiveData();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const [showNewPill, setShowNewPill] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [typingAgentId, setTypingAgentId] = useState<string | null>(null);
  const { chatTargetAgentId, setChatTargetAgentId } = useWorkspace();

  useEffect(() => {
    if (chatTargetAgentId) {
      setSelectedAgent(chatTargetAgentId);
      setChatTargetAgentId(null);
    }
  }, [chatTargetAgentId, setChatTargetAgentId]);

  const tokenEstimate = Math.max(1, Math.round((input.length + attachments.join('').length) * 1.3));
  const mentionMatch = input.match(/(?:^|\s)@([\w-]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? '';
  const mentionOptions = mentionMatch ? state.agents.filter((agent) => agent.name.toLowerCase().includes(mentionQuery) || agent.id.toLowerCase().includes(mentionQuery)) : [];

  const activeAgent = selectedAgent === 'all' ? state.agents[0] : state.agents.find((agent) => agent.id === selectedAgent) ?? state.agents[0];

  const appendResponse = (author = activeAgent) => {
    setTypingAgentId(author.id);
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: `m-${Date.now()}`,
          type: 'agent',
          agentId: author.id,
          content: attachments.length > 0
            ? `Received ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}. I will use ${attachments.join(', ')} as context while reviewing your request.`
            : `Acknowledged. I am prioritizing this request for ${author.name}.`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          tokens: 110,
        },
      ]);
      setTypingAgentId(null);
      setAttachments([]);
      window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }, 900);
  };

  const handleSend = () => {
    if (!input.trim() && attachments.length === 0) {
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        type: 'user',
        content: input.trim() || `Uploaded ${attachments.join(', ')}`,
        timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
      },
    ]);
    setInput('');
    appendResponse();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSend();
    }
  };

  const handleMentionInsert = (agentId: string, agentName: string) => {
    setInput((current) => current.replace(/(?:^|\s)@([\w-]*)$/, ` @${agentName} `).trimStart());
    setSelectedAgent(agentId);
  };

  const handleScroll = () => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowNewPill(scrollHeight - scrollTop - clientHeight > 100);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border px-4 py-2 overflow-x-auto scrollbar-thin">
        <button onClick={() => setSelectedAgent('all')} className={cn('rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors', selectedAgent === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
          Coordinator
        </button>
        {state.agents.map((agent) => (
          <button key={agent.id} onClick={() => setSelectedAgent(agent.id)} className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors', selectedAgent === agent.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
            <StatusDot status={agent.status} size="sm" />
            {agent.name}
          </button>
        ))}
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto scrollbar-thin p-4 space-y-4 relative">
        {messages.map((message) => {
          if (message.type === 'system') {
            return <motion.div key={message.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center"><span className="rounded-full bg-surface-2 px-3 py-1 text-micro text-muted-foreground">{message.content}</span></motion.div>;
          }
          if (message.type === 'widget') {
            return <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">{message.widgetType === 'deployment' ? <DeploymentWidget /> : <CostWidget />}</motion.div>;
          }
          const agent = message.agentId ? state.agents.find((candidate) => candidate.id === message.agentId) : null;
          const isUser = message.type === 'user';
          return (
            <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-3 max-w-[80%]', isUser ? 'ml-auto flex-row-reverse' : '')}>
              {!isUser && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10"><Hexagon className="h-4 w-4 text-primary" /></div>}
              <div className={cn('rounded-lg px-4 py-2.5', isUser ? 'bg-primary/10 text-foreground' : 'bg-card border border-border')}>
                {!isUser && agent && <span className="text-micro font-medium text-primary block mb-1">{agent.name}</span>}
                <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
                {message.codeBlock && <CodeBlock language={message.codeBlock.language} code={message.codeBlock.code} />}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-micro text-muted-foreground font-mono">{message.timestamp}</span>
                  {message.tokens && <span className="text-micro text-muted-foreground font-mono">{message.tokens} tok</span>}
                </div>
              </div>
            </motion.div>
          );
        })}

        {typingAgentId && <TypingIndicator agentName={state.agents.find((agent) => agent.id === typingAgentId)?.name ?? 'Coordinator'} />}

        <AnimatePresence>
          {showNewPill && (
            <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })} className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg z-10">
              <ArrowDown className="h-3 w-3" />
              New messages
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2 mx-4 mb-2">
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-xs text-warning">Budget at 71% — consider pausing non-critical agents</span>
      </div>

      <div className="border-t border-border p-4 relative">
        {showFilePicker && (
          <div className="absolute bottom-full mb-2 left-4 right-4 rounded-lg border border-border bg-card p-3 shadow-xl">
            <div className="text-xs font-semibold text-foreground mb-2">Mock file picker</div>
            <div className="space-y-1">
              {fileSuggestions.map((file) => (
                <button key={file} onClick={() => { setAttachments((current) => current.includes(file) ? current : [...current, file]); setShowFilePicker(false); }} className="w-full text-left rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                  {file}
                </button>
              ))}
            </div>
          </div>
        )}

        {mentionOptions.length > 0 && (
          <div className="absolute bottom-full mb-2 left-14 w-72 rounded-lg border border-border bg-card p-2 shadow-xl">
            {mentionOptions.map((agent) => (
              <button key={agent.id} onClick={() => handleMentionInsert(agent.id, agent.name)} className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs text-left hover:bg-surface-2">
                <StatusDot status={agent.status} size="sm" />
                <span className="flex-1">{agent.name}</span>
                <span className="text-micro text-muted-foreground font-mono">{agent.role}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"><AtSign className="h-4 w-4" /></button>
          <button onClick={() => setShowFilePicker((open) => !open)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"><Paperclip className="h-4 w-4" /></button>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${selectedAgent === 'all' ? 'the hive' : activeAgent.name}... (⌘Enter to send)`}
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
        {attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{attachments.map((file) => <button key={file} onClick={() => setAttachments((current) => current.filter((entry) => entry !== file))} className="rounded-full bg-primary/10 px-2 py-1 text-micro text-primary">{file}</button>)}</div>}
      </div>
    </div>
  );
}
