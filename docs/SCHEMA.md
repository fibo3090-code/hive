# HIVE — Schéma ultra-détaillé du fonctionnement de l'app

> Vue à plat de **comment** HIVE est branché, de l'écran jusqu'aux octets sur
> disque. Une vue concrète, pas une promesse marketing. Pour le *quoi* (état,
> features), voir [`FEATURE_STATUS.md`](FEATURE_STATUS.md) ; pour le *à
> venir*, [`ROADMAP.md`](ROADMAP.md). Pour le narratif design,
> [`architecture.md`](architecture.md). Ce document complète ces trois avec
> des diagrammes denses.

## Sommaire

1. [Topologie processus](#1-topologie-processus)
2. [Disposition sur disque](#2-disposition-sur-disque)
3. [Cycle de vie d'une requête](#3-cycle-de-vie-dune-requête)
4. [La boucle de turn (`chat::run_turn`)](#4-la-boucle-de-turn-chatrun_turn)
5. [Catalogue + dispatch des tools](#5-catalogue--dispatch-des-tools)
6. [Modèle d'exécution agent + visibilité](#6-modèle-dexécution-agent--visibilité)
7. [Pipeline auto-MCP-synthesis](#7-pipeline-auto-mcp-synthesis)
8. [Onboarding → `/launch` → décomposition](#8-onboarding--launch--décomposition)
9. [Modèle de données (graphe d'entités)](#9-modèle-de-données-graphe-dentités)
10. [Carte des events SSE → invalidations TanStack Query](#10-carte-des-events-sse--invalidations-tanstack-query)
11. [Frontières de sécurité + défenses](#11-frontières-de-sécurité--défenses)
12. [Le "happy path" raconté](#12-le-happy-path-raconté)

---

## 1. Topologie processus

```
┌─ Navigateur ────────────────────────────────────────────┐
│  React 18 SPA (Vite + SWC), :8080                       │
│                                                         │
│  Routes (canoniques) :                                  │
│   /            Projects             /forge[?tab=...]    │
│   /onboarding  wizard               /stats              │
│   /dashboard   Dashboard            /code   CodeVersion │
│   /chat        ChatCentral          /planning Planning  │
│   /hive-graph  HiveGraph (ReactFlow)/settings           │
│   /session-history                  *-legacy (zombies)  │
│                                                         │
│  Hooks transverses :                                    │
│   useHiveData       (project · agents · tasks · alerts) │
│   useServerData     (insights, blueprints, modules…)    │
│   useSse            (1 EventSource → invalidations TQ)  │
│   useChatStream     (chat.<id>.* → buffer streaming)    │
│                                                         │
│  Composants partagés clés :                             │
│   <AgentFormFields>   (spawn ≡ config ≡ forge)          │
│   <ModelPicker>       (provider/model en cascade)       │
│   <DisabledFeature>   (badge + tooltip "planned/server")│
└───────────────────────┬─────────────────────────────────┘
                        │
                        │  HTTP (REST) + SSE
                        │  par défaut sur 127.0.0.1:8787
                        ▼
┌─ Hôte opérateur — UN process tokio ────────────────────────────────────┐
│                                                                        │
│  hive-api (Axum 0.7)                                                   │
│   ┌─ Router ──────────────────────────────────────────────────────┐    │
│   │ /v1/projects, /v1/agents, /v1/wires, /v1/chat-threads,        │    │
│   │ /v1/spec-documents, /v1/tasks, /v1/notes, /v1/tech-debt,      │    │
│   │ /v1/git/*, /v1/github/*, /v1/llm-providers, /v1/connectors,   │    │
│   │ /v1/skills, /v1/modules, /v1/synthesis, /v1/insights/*,       │    │
│   │ /v1/tools, /v1/audit-log, /v1/events (SSE), /v1/openapi.json  │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                        │
│   AppState (cloné dans les handlers) :                                 │
│     inner: Arc<RwLock<RuntimeState>>  (Db, data_dir, database_url)     │
│     events: broadcast::Sender         (1 channel global)               │
│     executors: Arc<ExecutorRegistry>  (1 AgentExecutor / agent)        │
│     crypto: Crypto                    (master key sealing)             │
│     http: reqwest::Client                                              │
│     chat_jobs: ChatJobRegistry         (annulation des turns)          │
│     model_cache: ... (5 min TTL par provider)                          │
│                                                                        │
│   Background tasks tokio :                                             │
│     · loop_detector::spawn()          → alerts "loop_detected"         │
│     · audit_log purge (24h)           → retention_days (def 90)        │
│     · turn drivers                     (1 par inbox item / chat msg)   │
│                                                                        │
│   ↕  appelle                                                           │
│                                                                        │
│  hive-runtime (lib)                                                    │
│   chat::run_turn  ◄────────── unique chokepoint des turns LLM          │
│   ExecutorRegistry · AgentExecutor (par agent : inbox + cancel scope)  │
│   TurnDriver trait ◄── ApiTurnDriver (installé au boot par hive-api)   │
│   EventBus  (wrap autour de broadcast::Sender)                         │
│   PromptComposer (4 couches : agent · tool catalog · HIVE.md · live)   │
│   loop_detector · drift (scorers, pas encore hookés)                   │
│   spawn/ (auto-MCP pipeline, partiel)                                  │
│   agent_tools.rs : spawn_agent · message_agent · list_visible_agents · │
│                    request_relay · delete_agent · monitor_agent ·      │
│                    delegate_task                                       │
│   db_tools.rs    : hive_mind_* · list_spec_docs · read_spec_doc ·      │
│                    add_task · add_tech_debt · update_tech_debt ·       │
│                    record_drift                                        │
│   git_tools.rs   : git_status · git_diff · git_log · git_commit ·      │
│                    git_pull/push (sovereignty-gated)                   │
│                                                                        │
│   ↕                                                                    │
│                                                                        │
│  hive-tools (sandbox-scoped only)                                      │
│   fs_read · fs_write · fs_list · shell_exec · todo                     │
│   web_fetch · web_search                                               │
│   Tool trait : { manifest(): JSON Schema, invoke(args, ctx) }          │
│                                                                        │
│   ↕  via ctx.sandbox                                                   │
│                                                                        │
│  hive-sandbox (LocalFsSandbox)                                         │
│   read / write / list / exec                                           │
│   defenses : path-jail (string + canonicalise + root-prefix) ·         │
│              refuse symlink target · env_clear + allowlist ·           │
│              fs_read 16MB cap · fs_write 32MB cap ·                    │
│              shell_exec setrlimit (CPU 300s / AS 1GB / NOFILE 1024 /   │
│              NPROC 64) · stdout 256KB · stderr 64KB                    │
│                                                                        │
│  Crates leaf :                                                         │
│   hive-llm  Anthropic/OpenAI/Gemini/Ollama (streaming + native tools)  │
│   hive-search Tavily / SearXNG                                         │
│   hive-git    git CLI wrapper + octocrab pour les PR GitHub           │
│   hive-crypto ChaCha20-Poly1305 master-key (~/.hive/master.key)       │
│                                                                        │
│  hive-db (SeaORM)                                                      │
│   entities/ · repos/ · migration/                                      │
│   ┌──────────┐    ┌──────────────────┐    ┌────────┐                  │
│   │ SQLite   │ OR │ Postgres / MySQL │ OR │ ...    │                  │
│   └──────────┘    └──────────────────┘    └────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
                    ↕
            ┌─ Sidecars (optionnels) ─────────────────────┐
            │  Ollama         :11434  (no-key LLM)        │
            │  SearXNG        :8888   (no-key recherche)  │
            │  Docker         (sandbox alt., planifié)    │
            └─────────────────────────────────────────────┘
```

**Pourquoi un seul process backend.** Toutes les "background tasks" (turns,
loop detector, audit purge, spawn pipeline) tournent comme tâches tokio dans le
même process Axum. Cela évite tout broker externe ; le coût est qu'un crash
du process tue tout — acceptable pour un single-operator localhost.

---

## 2. Disposition sur disque

```
<data_dir>  (par défaut : back-end/data/)
├── hive.db                          ← SQLite (entités + audit + settings + …)
├── hive.db-wal                      ← Write-Ahead Log (mode WAL)
├── hive.db-shm                      ← Shared-Memory (mode WAL)
├── workspaces/
│   └── <project_id>/                ← cwd du shell_exec, racine fs_* du projet
│       ├── .git/                    ← git init au /launch
│       ├── .hive/
│       │   └── todo.json            ← persistence du tool `todo`
│       ├── HIVE.md                  ← (optionnel) mémoire projet lue par
│       │                              PromptComposer.with_hive_memory
│       └── src/, …                  ← le code que les agents éditent
└── attachments/
    └── <project_id>/
        └── <ulid>-<original_name>   ← uploads de la chat (images / texte)

~/.hive/
├── master.key                       ← ChaCha20-Poly1305 (chmod 0600 sur Unix)
                                     ← scelle LLM keys, GitHub tokens,
                                       connector credentials
```

**Path resolution** dans `LocalFsSandbox::resolve` :
1. Refus si la chaîne contient `..` ou commence par `/` ou `\` (string-level).
2. Join sur la racine, puis `tokio::fs::canonicalize`.
3. Re-vérifie que le résultat est sous la racine (anti-symlink-escape).
4. Pour `fs_write`, refuse si la cible est elle-même un symlink.

**Tailles bornées** :
- `fs_read` : hard-cap 16 MiB dans sandbox + soft-cap 256 KiB dans le tool.
- `fs_write` : hard-cap 32 MiB.
- `shell_exec` stdout 256 KiB / stderr 64 KiB (marker `[truncated]`).
- Attachments : sweep d'orphelins au démarrage (voir `cleanup_orphan_attachments`).

---

## 3. Cycle de vie d'une requête

Deux chemins co-existent : (a) un endpoint **synchrone** (la majorité — list,
create, patch) ; (b) un endpoint **asynchrone** qui retourne tout de suite et
streame la suite par SSE (les turns LLM, la synthesis MCP, l'export).

```
                                 (a) Synchrone
Front-end                            hive-api
   │                                    │
   │── HTTP POST /v1/agents/:id ───────►│
   │                                    │  AppState · Db
   │                                    │  → repo call(s)
   │                                    │  → audit::append
   │                                    │  → emit('agent.status', payload)
   │◄─── 200 { agent }                  │     │
   │                                    │     │ ← broadcast::Sender ▶
   │  (TQ refetch déclenché par         │     │
   │   useSse sur agent.status)         │     ▼
   │                                  /v1/events  (autre client / même)


                                 (b) Asynchrone (turn LLM)
Front-end                            hive-api                hive-runtime
   │                                    │                        │
   │── POST .../messages ──────────────►│                        │
   │                                    │ insert user_msg        │
   │                                    │ insert assistant pending│
   │                                    │ spawn(run_turn ───────►│
   │                                    │                        │
   │◄── 200 { messageId, assistantId }  │                        │
   │                                    │                        │
   │ EventSource('/v1/events') OUVERT   │                        │
   │ DEPUIS LE DÉBUT (jamais fermé) :   │                        │
   │                                    │                        │
   │◄═══ chat.<tid>.streaming ══════════│ ◄══════════════════════│
   │◄═══ chat.<tid>.token (×N) ═════════│ ◄══════════════════════│
   │◄═══ chat.<tid>.tool_call ══════════│ ◄══════════════════════│
   │◄═══ chat.<tid>.tool_result ════════│ ◄══════════════════════│
   │◄═══ chat.<tid>.complete ═══════════│ ◄══════════════════════│
   │                                    │                        │
   │  (useChatStream accumule le        │                        │
   │   buffer ; useSse invalide la      │                        │
   │   query chat-messages à `complete`)│                        │
```

Le **single shared SSE stream** (`/v1/events`) couvre tous les events :
chat, agents, tasks, costs, alerts, etc. Le frontend mappe chaque event-name
à une liste de query-keys TanStack à invalider (voir §10).

---

## 4. La boucle de turn (`chat::run_turn`)

L'unique chokepoint pour **tout** travail LLM, qu'il vienne d'une chat user
ou d'un dispatch d'agent (les deux passent par `hive_runtime::chat::run_turn`,
appelé soit par `send_chat_message` soit par `ApiTurnDriver::run`).

```
                run_turn(params : RunTurn)
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Pre-conditions                                                           │
│  - Wrap dans tokio::time::timeout(DEFAULT_TURN_TIMEOUT = 180 s)         │
│  - cancel = Arc<Mutex<bool>>  (polled toutes les 50ms inside collect_)  │
└─────────────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─ BUDGET CHECK ───────────────────────────────────────────────────┐
│ project = projects::get(project_id)                               │
│ if project.budget_total_cents > 0 :                               │
│   spent = cost_events::total_cost_cents_for_project(project_id)   │
│   if spent ≥ budget_total_cents :                                 │
│     finalize(assistant_message, "[budget] …", status='error')     │
│     emit chat.<tid>.error { kind: 'budget_exceeded' }             │
│     return Ok(())                                                 │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─ PROMPT COMPOSER (4 couches, préfixe stable) ───────────────────┐
│ 1. Agent prompt  (l'override system_prompt de l'agent)          │
│ 2. Tool catalog  (manifestes JSON + protocole)                  │
│ 3. Project memory (HIVE.md sous <data_dir>/workspaces/<pid>/)   │
│ 4. Live reminders (état momentané — ne casse pas le caching)    │
│                                                                  │
│ Les 3 premières couches sont identiques tant que l'agent + le   │
│ catalog ne changent pas → la cache de prompt des providers hit. │
└──────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─ PRE-FLIGHT TOKEN BUDGETING ─────────────────────────────────────┐
│ history = chat_messages::list_by_thread()                        │
│ trim_to_fit(model_metadata::context_window_for(model), history)  │
│ if trimmed: emit chat.<tid>.context_trim                         │
└──────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─ ROUND LOOP — répété ≤ MAX_TOOL_ROUNDS = 30 fois ────────────────┐
│                                                                  │
│   ┌─ collect_response (stream LLM) ──────────────────────────┐  │
│   │  tokio::select! biased {                                  │  │
│   │    cancel_poll → drop stream, return cancelled            │  │
│   │    stream.next() →                                        │  │
│   │      Delta(chunk)        → accumulated.push + emit token  │  │
│   │      Start{tokens_in}    → register input tokens          │  │
│   │      Complete{...}       → finalize counts + finish_reason│  │
│   │      ToolCallStart/Delta → buffer tool args               │  │
│   │      ToolCallEnd         → parse JSON args                │  │
│   │  }                                                        │  │
│   │  → CollectOutcome { accumulated, tokens, finish, calls }  │  │
│   └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│   transcript += accumulated  (joinable par \n\n)                 │
│   total_tokens_*, total_cost  accumulés                          │
│   last_non_empty = accumulated.trim_non_empty()                 │
│                                                                  │
│   if outcome.cancelled  → finalize_cancelled, return             │
│                                                                  │
│   if !invocations:      → final_answer = accumulated; break      │
│                                                                  │
│   ┌─ DISPATCH TOOL CALLS ─────────────────────────────────────┐  │
│   │  for each invocation :                                    │  │
│   │    if cancel: finalize_cancelled, return                  │  │
│   │    if total_tool_calls > MAX_TOTAL_TOOL_CALLS = 60 :       │  │
│   │      final_answer = "tool budget exhausted"  → break      │  │
│   │    if repeats[fingerprint] > MAX_REPEAT_CALLS = 3 :        │  │
│   │      final_answer = "loop guard"  → break                  │  │
│   │                                                            │  │
│   │    validate args against manifest.input_schema             │  │
│   │      on fail → emit chat.<tid>.tool_validation_error       │  │
│   │                push synthetic error result                 │  │
│   │                continue                                    │  │
│   │                                                            │  │
│   │    emit chat.<tid>.tool_call { name, args }                │  │
│   │                                                            │  │
│   │    tokio::time::timeout(60s, registry.invoke(...))         │  │
│   │      → ToolResult (JSON)                                   │  │
│   │                                                            │  │
│   │    emit chat.<tid>.tool_result { id, result }              │  │
│   │    messages.push(ToolResult turn)                          │  │
│   │  end for                                                   │  │
│   └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ end loop                                                         │
└──────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─ FINALIZATION ──────────────────────────────────────────────────┐
│ if final_answer.is_empty():                                     │
│   final_answer = last_non_empty OR synthetic fallback           │
│ if final_answer_was_streamed == false:                          │
│   transcript += "\n\n" + final_answer  (will be persisted)      │
│   emit token deltas for the synthetic block (chunked 48 b)      │
│ persist_body = transcript.trim() || final_answer                │
│ chat_messages::finalize(persist_body, tokens, cost, 'done')     │
│ cost_events::insert(...)                                        │
│ chat_threads::touch()                                           │
│ emit chat.<tid>.complete                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Garde-fous récapitulés** : wall-clock 180 s · `MAX_TOOL_ROUNDS=30` ·
`MAX_TOTAL_TOOL_CALLS=60` · repeat-fingerprint ≤ 3 · per-tool 60 s ·
schema-validate avant dispatch · `cancel` polled 50 ms ·
**budget check au début**.

---

## 5. Catalogue + dispatch des tools

```
┌─ Tool sources ──────────────────────────────────────────────────┐
│  hive-tools (sandbox-only) :                                    │
│    fs_read, fs_write, fs_list, shell_exec, todo,                │
│    web_fetch, web_search                                        │
│  hive-runtime (DB / registry-backed) :                          │
│    agent_tools.rs   spawn_agent, message_agent,                 │
│                     list_visible_agents, request_relay,         │
│                     delete_agent, monitor_agent, delegate_task  │
│    db_tools.rs      hive_mind_{write,read,list,delete},         │
│                     list_spec_docs, read_spec_doc,              │
│                     add_task, add_tech_debt, update_tech_debt,  │
│                     record_drift                                │
│    git_tools.rs     git_status, git_diff, git_log, git_commit,  │
│                     git_pull, git_push   (sovereignty-gated)    │
└─────────────────────────────────────────────────────────────────┘

build_tooling(state, project_id, agent_id, message_id, thread_id):

  1. global = enabled_tools_for_turn(state)
       └─ lit setting['tools']['enabledTools'] (par défaut tout sauf
          spawn/message_agent qui sont coordinator-only)

  2. effective =
       if agent_id has per-agent enabled_tools (non-vide) :
         global ∩ agent.enabled_tools
       else :
         global

  3. registry = ToolRegistry::new()
     register_defaults(reg)                  # hive-tools sandbox
     register_web_search(reg, provider)      # tavily | searxng
     hive_runtime::register_agent_tools(reg, db, executors, bus)
     hive_runtime::register_db_tools(reg, db)
     hive_runtime::register_git_tools(reg, db)
     registry = registry.filtered(&effective)

  4. ToolContext::new(project_id, sandbox)
       .with_agent(agent_id)
       .with_thread(thread_id)
       .with_message(message_id)
       .with_protected_files(...)

  → (registry, ctx) prêts pour chat::run_turn


Dispatch d'UN tool call :
                                                                  
  LLM emits  tool_call { name, args_json }                         
        │                                                          
        ▼                                                          
  registry.invoke(name, args, &ctx)                                
        │                                                          
        ├─ unknown name? → ToolError::NotFound                     
        │                  (compté comme "call" mais petit poids) 
        ▼                                                          
  Tool::manifest().input_schema  ─── validate required fields ──── 
        │ fail → ToolError::InvalidArgs → tool_validation_error    
        ▼                                                          
  tokio::time::timeout(60s,                                        
                       Tool::invoke(args, ctx))                    
        │                                                          
        ├─ sandbox-only (hive-tools)   uses ctx.sandbox            
        ├─ DB-backed (db_tools.rs)     uses self.db.conn()         
        ├─ git_tools.rs                 uses GitRepo::new(sandbox  
        │                                                  .root())
        ├─ git pull/push                require_remote_allowed     
        │                                (project.sovereignty_tier)
        ├─ agent_tools                  uses executors + db        
        │                               + agent_wires for visibility
        ▼                                                          
  Ok(Value)  → emit chat.<tid>.tool_result → push to messages
  Err(...)   → emit synth error result      → next round           
```

---

## 6. Modèle d'exécution agent + visibilité

```
─ Spawn lineage (immutable) ────────  agents.parent_agent_id ────
                                                                 
  Coordinator (no parent)                                        
   ├─ Frontend agent       (parent = Coordinator)               
   │   └─ UI Polish agent  (parent = Frontend agent)            
   └─ Backend agent        (parent = Coordinator)               
                                                                 
─ Wires (editable, BFS-acyclic) ─────  agent_wires table ────────
                                                                 
  spawn_agent crée auto une wire parent→child à la création.    
  HiveGraph permet de dessiner aussi des wires non-lineage.     
                                                                 
  Coordinator ─→ Frontend agent ─→ UI Polish                    
       │                                                          
       └─→ Backend agent                                           
                                                                 
  cycle prevention :                                              
    insert(parent, child) refusé si BFS(child) atteint parent    
                                                                 
                                                                 
─ Visibility (dérive des wires) ────────────────────────────────  
                                                                 
  visible(A) = {A}                                                
             ∪ direct_parents(A)   (A's wired-or-spawn parents)   
             ∪ descendants(A)      (BFS via outgoing wires)       
                                                                 
  message_agent(target) :                                         
    if visible(caller).contains(target) → enqueue + dispatch     
    else                                  → reject ("not visible")
                                                                 
  request_relay(via, target) :                                    
    via doit être un direct parent du caller                     
    target doit être dans visible(via)                            
    enqueue → target, from_agent_id=via,                          
              content="[relayed by via on behalf of caller] …"    
                                                                 
  fallback : si le projet n'a AUCUNE wire, message_agent autorise
            n'importe quel agent du même project (mode "open").  


─ AgentExecutor (par agent) ────────────────────────────────────  
                                                                 
  ExecutorRegistry (Arc) tient une HashMap<agent_id, AgentExecutor>
                                                                 
  AgentExecutor a :                                              
    · Inbox: queue de InboxItem { message_id, content, thread,   
                                  from_agent_id }                
    · CancellationToken (cascade : cancel parent → cancel subtree)
    · ExecutorState (pondéré par DriverSlot)                     
                                                                 
  Quand un nouveau InboxItem arrive :                            
    1. Marque agent.status = "working"                           
    2. Appelle driver.drive(turn_request)                        
         → ApiTurnDriver (installé au boot)                      
         → ApiTurnDriver::run construit RunTurn et appelle       
           hive_runtime::chat::run_turn                          
    3. Sur fin (Ok / Err / cancelled), marque le agent_messages  
       row done/error/cancelled                                  
```

---

## 7. Pipeline auto-MCP-synthesis

(état actuel : state machine + REST exists, **pas encore branché end-to-end**.
Voir ROADMAP §B4.)

```
                          POST /v1/projects/:pid/spawn-requests
                                  { description, agentRole, ... }
                                          │
                                          ▼
                          insert agent_spawn_requests
                          { state="queued", description, … }
                                          │
                                          ▼
                          tokio::spawn(run_pipeline(req_id))
                                          │
                                          ▼

         ┌─ STATE MACHINE ────────────────────────────────────┐
         │                                                     │
         │   queued                                             │
         │      │                                              │
         │      ▼                                              │
         │   planning-needs       ← LLM appel: parse desc      │
         │      │                   → liste de capability ids  │
         │      ▼                                              │
         │   matching-existing-mcp                              │
         │      │                                              │
         │      ├─ found → ─────────────────────────────────┐  │
         │      │           materializing-agent             │  │
         │      ▼                                            │  │
         │   researching-api      ← LLM appel: fetch OpenAPI│  │
         │      │                                            │  │
         │      ▼                                            │  │
         │   synthesizing-mcp     ← LLM appel: gen handler  │  │
         │      │                   + manifest               │  │
         │      ▼                                            │  │
         │   composing-prompt     ← LLM appel: forge le      │  │
         │      │                   system prompt du sub     │  │
         │      ▼                                            │  │
         │   awaiting-approval    ← UI: Approve / Reject     │  │
         │      │ (POST .../approve)                         │  │
         │      ▼                                            │  │
         │   materializing-agent  ◄─────────────────────────┘  │
         │      │ agents::create + agent_mcp_bindings          │
         │      ▼                                              │
         │   completed                                          │
         │                                                     │
         │   (error states pareils, persist sur la row)        │
         └─────────────────────────────────────────────────────┘
```

---

## 8. Onboarding → `/launch` → décomposition

(la "boucle produit" — créer un projet → CEO planifie → agents travaillent)

```
StepSource → StepBudget → StepConnectLlms → StepDescribe → StepPlanReview
                                                                 │
                                                                 ▼
                                                       click "Launch"
                                                                 │
   ┌─ Frontend launchProject() ───────────────────────────────────┐
   │  1. project = await addProject({ name, description, tier, … })
   │  2. await setActiveProject(project.id)
   │  3. POST /v1/projects/:id/launch  { description, decompose: true }
   │  4. render overlay <LaunchSteps> avec le report retourné
   │  5. navigate('/dashboard') après 1.5 s
   └───────────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
   ┌─ Backend POST /v1/projects/:pid/launch ──────────────────────┐
   │  steps: [{name, status, detail}, …]   ← report retourné
   │                                                                
   │  Step 1: provision-workspace                                  
   │    sandbox_root_for_project(state, pid)                       
   │    → mkdir <data_dir>/workspaces/<pid>/                       
   │    → upsert project_workspaces row (sandbox_kind=Local)       
   │    GitRepo::new(root).init()                                  
   │                                                                
   │  Step 2: migrate-db  (noop, confirmation)                     
   │                                                                
   │  Step 3: probe-search                                          
   │    if tavily : check setting tavilyMaskedKey                  
   │    else      : reqwest::get(searxng_url) timeout 3 s          
   │                                                                
   │  Step 4: spec-document                                         
   │    if description:                                             
   │      spec_documents::create({title: "Project brief",          
   │                               source: "onboarding",            
   │                               markdown: description})         
   │                                                                
   │  Step 5: decompose-plan  (si description + decompose)          
   │    decompose_brief(state, pid, description) :                 
   │      a. resolve_chat_target → provider+model                  
   │      b. LLM appel : système "Hive planner" + brief            
   │         → JSON { phases: [{name, tasks: [{title, priority,    
   │                                          assignee}, …]}, …] } 
   │      c. for each phase:                                        
   │           sprints::create({name, status:'active'|'planned',   
   │                            position})                          
   │      d. for each task:                                         
   │           role_to_agent = {existing_agents.role → id}         
   │           agent_id = role_to_agent.get(task.assignee)         
   │           tasks::create({title, priority, sprint_id, agent_id})
   │                                                                
   │  emit project.updated · task.status                            
   │  return { steps, specDocumentId, sprintIds, taskIds, taskCount }
   └────────────────────────────────────────────────────────────────┘
```

À venir (ROADMAP §B1) : remplacer `StepDescribe` (textarea + upload) par un
chat live avec le **coordinator** (`/coordinator/converse`) qui produit le
brief + le roster initial, alimentant directement la phase decompose-plan.

---

## 9. Modèle de données (graphe d'entités)

```
                        ┌─────────────────┐
                        │   projects      │
                        │  id (ULID)      │
                        │  name           │
                        │  sovereignty_   │
                        │   tier          │
                        │  budget_total_  │
                        │   cents (i64)   │
                        │  health_score   │
                        │  status         │
                        │  deleted_at     │
                        └────────┬────────┘
                                 │ (FK on_delete CASCADE pour la majorité)
   ┌─────────────────────────────┼──────────────────────────────┐
   │                             │                              │
   ▼                             ▼                              ▼
┌─────────┐                  ┌──────┐                     ┌────────────┐
│ agents  │ ◄─parent_agent── │      │                     │  sessions  │
│ id      │     (lineage)    │      │                     │  active    │
│ slug    │                  │      │                     │  tokens_   │
│ role    │                  │      │                     │   used     │
│ model   │                  │      │                     │  budget_   │
│ status  │                  │      │                     │   used     │
│ enabled │                  │      │                     └────────────┘
│  _tools │                  │      │
│ system_ │                  │      │                     ┌────────────┐
│  prompt │                  │      │                     │ cost_events│
└────┬────┘                  │      │                     │ tokens_in  │
     │                       │      │                     │  /out      │
     ├──◄ agent_messages     │      │                     │ cost_cents │
     │     from / to         │      │                     │  (i64)     │
     │     thread_id         │      │                     │ memo       │
     │     reply_to          │      │                     └────────────┘
     │                       │      │
     ├──◄ agent_wires        │      │                     ┌────────────┐
     │     parent → child    │      │                     │ alerts     │
     │     (acyclic)         │      │                     │ severity   │
     │                       │      │                     │ action_kind│
     ├──◄ agent_task_         │      │                     │  /label    │
     │     assignments       │      │                     └────────────┘
     │                       │      │
     ├──◄ agent_mcp_bindings │      │                     ┌────────────┐
     │     kind: custom|     │      │                     │ drift_     │
     │           connector  │      │                     │  events    │
     │                       │      │                     │ kind       │
     └──◄ (planned) agent_   │      │                     │ subject_   │
         skill_bindings     │      │                     │  id /kind  │
                            │      │                     │ severity   │
                            │      │                     │ evidence_  │
                            │      │                     │  json      │
                            │      │                     └────────────┘
                            │      │
                            │      ▼
                       ┌─────────────────┐                ┌────────────┐
                       │  chat_threads   │                │ tech_debt_ │
                       │  id, project_id │                │  items     │
                       │  agent_id (opt) │                │ severity   │
                       │  title          │                │ position   │
                       └────────┬────────┘                └────────────┘
                                │
                                ▼                          ┌────────────┐
                       ┌─────────────────┐                 │ hive_mind_ │
                       │ chat_messages   │                 │  notes     │
                       │  role           │                 │ category   │
                       │  content        │                 │  (=topic)  │
                       │  tool_calls     │                 │ author     │
                       │  tokens_in /out │                 │ auto       │
                       │  cost_cents     │                 └────────────┘
                       │  status         │
                       └────────┬────────┘                 ┌────────────┐
                                │                          │ skills     │
                                ▼                          │ slug       │
                       ┌─────────────────┐                 │ system_    │
                       │ chat_message_   │                 │  prompt_   │
                       │  attachments    │                 │  fragment  │
                       │  storage_path   │                 │ allowed_   │
                       │  bytes_size     │                 │  tools_    │
                       └─────────────────┘                 │  json      │
                       (PAS de FK ON CASCADE → cleanup     └────────────┘
                       explicite à la suppression — A1)

                                                          ┌────────────┐
                                                          │ connectors │
                                                          │ kind:      │
                                                          │  api|mcp   │
                                                          │ auth_kind  │
                                                          │ ciphertext │
                                                          │  (encrypted│
                                                          │  cred)     │
                                                          └────────────┘

                                                          ┌────────────┐
                                                          │ custom_mcp_│
                                                          │  servers   │
                                                          │ source_api │
                                                          │  _url      │
                                                          │ handler_   │
                                                          │  code      │
                                                          │ reusable   │
                                                          └────────────┘

   spec_documents ──┐    sprints   ──┐     tasks ───┐
     markdown       │    name        │     title    │   ┌────────────┐
     source         │    status      │     status   │   │ spec_      │
     version        │    start_date  │     priority │   │ document_  │
                    │    end_date    │     phase    │   │  sections  │
                    │    points      │     agent_id │   │ anchor     │
                    │    position    │     sprint_  │   │ heading    │
                    │                │      id      │   │ body       │
                    │                │     spec_    │   └────────────┘
                    │                │      sect_id │
                    └────────────────┘     due_at   │
                                           ────────┘

Orthogonaux au project :
  llm_providers   id, kind (anthropic|openai|gemini|ollama),
                  ciphertext (encrypted key), base_url, connected
  settings        scope (global | project:<id> | tools | search | …),
                  key, value (JSON)
  notifications   project_id (opt), kind, title, message, read, dismissed
  audit_log       actor, action, entity_type/id, before/after (JSON)
                  ← purge auto 90d
  agent_spawn_    state machine pour l'auto-MCP pipeline
   requests
  synthesis_jobs  module synthesis (mocked backend)
  module_publish  drafts pour publier vers le marketplace
                  (server-only, désactivé)
```

---

## 10. Carte des events SSE → invalidations TanStack Query

```
─ Per-thread (chat) ──────────────────────────────────────────────
  chat.<tid>.streaming        useChatStream: marque streaming=true
  chat.<tid>.token            useChatStream: streaming[mid].content +=
  chat.<tid>.tool_call        useChatStream: push to toolCalls
  chat.<tid>.tool_result      useChatStream: append result
  chat.<tid>.tool_validation_error
                              (frontend non-câblé spécifiquement)
  chat.<tid>.context_trim     (toast info)
  chat.<tid>.message          invalidate ['chat-messages', tid]
  chat.<tid>.complete         useChatStream: status=complete +
                              invalidate ['chat-messages', tid]
  chat.<tid>.cancelled        idem (status=cancelled)
  chat.<tid>.error            idem (status=error). data.kind peut être
                              'budget_exceeded' → toast spécifique

─ Globaux (useSse EVENT_MAP) ────────────────────────────────────
  project.updated     ['projects'], ['projects', 'active'], ['settings']
  project.deleted     ['projects']
  agent.status        ['agents', pid], ['agent-messages', aid],
                      ['agent-lineage', aid]
  agent.spawned       ['agents', pid], ['wires', pid],
                      ['agent-lineage', parentId]
  wire.changed        ['wires', pid]
  task.status         ['tasks', pid],
                      ['insights', 'task-distribution', pid]
  cost.ingested       ['spend-timeline'],
                      ['insights', 'cost-timeline', pid],
                      ['insights', 'agent-token-usage', pid]
  spec_document.decomposed
                      ['tasks', pid], ['sprints', pid]
  chat.thread.created ['chat-threads', pid]
  chat.thread.cleared ['chat-threads', pid]
  alert.created       ['alerts']
  alert.dismissed     ['alerts']
  notification.created ['notifications']
  session.toggled     ['session', pid]
  session.closed      ['session', pid]
  llm_provider.updated   ['llm-providers']
  llm_provider.tested    ['llm-providers']
  workspace.updated   ['workspace-info', pid], ['git-*', pid]
  synthesis.<jid>.progress|complete|error
                      consumées directement par Modules.tsx (pas EVENT_MAP)
  module.installed    ['modules', pid]
```

---

## 11. Frontières de sécurité + défenses

```
┌─ TRUSTED ───────────────────────────────────────────────────────┐
│  Operator (`local_operator` in audit_log)                       │
│  Le code du frontend qu'on a écrit                              │
│  Le master key (~/.hive/master.key, mode 0600)                  │
│  Les CORS origins listées                                       │
└────────────────────────────────────┬────────────────────────────┘
                                     │ écrit / lit
                                     ▼
┌─ SEMI-TRUSTED ──────────────────────────────────────────────────┐
│  Les réponses du LLM provider (anthropic, openai, …)            │
│  Les agents (et leurs sub-agents)                                │
└────────────────────────────────────┬────────────────────────────┘
                                     │ invoke tools
                                     ▼
┌─ UNTRUSTED ─────────────────────────────────────────────────────┐
│  Tool arguments (JSON validés contre manifest.required)         │
│  Tool outputs (replacés dans le contexte LLM, jamais eval()'d)  │
│  Le contenu des pages fetchées (web_fetch)                      │
│  stdout / stderr de shell_exec                                  │
│  Réponses git remote (GitHub PRs)                               │
└─────────────────────────────────────────────────────────────────┘

Couches de défense, top-down :

┌─ Process ───────────────────────────────────────────────────────┐
│  · Bind 127.0.0.1:8787 (pas d'attaque réseau)                   │
│  · CORS allow-list strict (origines Vite dev)                   │
│  · API sans auth → seul l'opérateur local                       │
│  · API errors opaques (request_id) ; détails dans tracing       │
│  · Master key 0600 (Unix) ; ChaCha20-Poly1305 pour les secrets  │
└─────────────────────────────────────────────────────────────────┘

┌─ Turn loop ─────────────────────────────────────────────────────┐
│  · Wall-clock 180 s par turn                                    │
│  · MAX_TOOL_ROUNDS = 30                                         │
│  · MAX_TOTAL_TOOL_CALLS = 60                                    │
│  · Repeat-fingerprint (tool, args) > 3 → halt                   │
│  · Per-tool timeout 60 s                                        │
│  · Budget enforcement : refuse si spent ≥ budget_total_cents    │
└─────────────────────────────────────────────────────────────────┘

┌─ Tool dispatch ─────────────────────────────────────────────────┐
│  · Schema-validate args avant invoke (manifest.required)        │
│  · Tool::side_effects(): true → tracé differently               │
│  · Per-agent enabled_tools allowlist ∩ global allowlist         │
│  · git_pull / git_push refusés si sovereignty_tier='local'      │
│  · message_agent enforcé par agent_wires::visible_agent_ids     │
└─────────────────────────────────────────────────────────────────┘

┌─ Sandbox (LocalFsSandbox) ──────────────────────────────────────┐
│  · path-jail : refuse ../, absolute paths, escape via symlink   │
│  · canonicalize + root-prefix re-check                          │
│  · fs_write refuse target = symlink                             │
│  · fs_read hard-cap 16 MiB (refuse, pas truncate)               │
│  · fs_write hard-cap 32 MiB                                     │
│  · shell_exec :                                                  │
│      env_clear + small allowlist (PATH, LANG, TZ, …)            │
│      HOME=<workspace_root>                                       │
│      setrlimit (Unix) : CPU 300 s, AS 1 GiB, NOFILE 1024,       │
│                          NPROC 64 (Linux)                       │
│      stdout 256 KiB, stderr 64 KiB tronqués                     │
└─────────────────────────────────────────────────────────────────┘

┌─ web_fetch (réseau sortant) ────────────────────────────────────┐
│  · http(s) only                                                  │
│  · Refuse IPs privés/internes :                                  │
│      loopback (127/8, ::1)                                       │
│      RFC1918 (10/8, 172.16/12, 192.168/16)                       │
│      link-local (169.254/16 — bloque AWS/GCP metadata,           │
│                  fe80::/10)                                      │
│      ULA (fc00::/7)                                              │
│      unspecified, broadcast, multicast, documentation            │
│  · DNS resolve manuellement + check chaque IP avant fetch        │
│  · Body cap streaming hard : 5 MiB (stop dès dépassement)        │
│  · Soft cap (par défaut 256 KiB) dans le tool                    │
│  · Timeout 15 s                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─ Persistence ───────────────────────────────────────────────────┐
│  · Secrets chiffrés (LLM keys, GitHub tokens, connector creds)  │
│  · `mask_key` pour previews UI ("sk-…abcd")                     │
│  · audit_log retention (par défaut 90 j) auto-purgé             │
│  · attachments : cleanup explicite au thread/project delete +   │
│    sweep d'orphelins au démarrage                                │
└─────────────────────────────────────────────────────────────────┘

┌─ Ce qui n'est PAS défendu (par design ou par TODO) ─────────────┐
│  · Multi-utilisateurs (pas d'auth — single-operator localhost)  │
│  · Exécution de "modules" arbitraires (vu comme plugin trusté)  │
│  · Le LLM provider lui-même (donné les clés, on lui fait        │
│    confiance)                                                    │
│  · Side-channel via timing / cache (négligeable en local)       │
│  · Détection de drift auto (scorers existent, pas hookés ; les   │
│    agents peuvent record_drift manuellement)                    │
│  · SSE Lag handling (un client lent peut rater des events sans   │
│    notification — voir W1-A7)                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. Le "happy path" raconté

Une session typique de bout en bout :

```
1.  Démarrage
    ┌────────────────────────────────────────────────────────────┐
    │ just up  (ou make dev-back + dev-front dans deux terms)    │
    │  → hive-api serve : binds 127.0.0.1:8787                   │
    │     · migrations appliquées (SQLite empty → 17 migrations) │
    │     · seed_demo : 3 projets, ~12 agents seedés              │
    │     · Crypto::load_or_init : ~/.hive/master.key existe ou   │
    │       créé (0600)                                           │
    │     · probe Ollama localhost:11434 (succès → flag connecté) │
    │     · loop_detector::spawn                                  │
    │     · audit_log purge (24 h ticker)                         │
    │     · ApiTurnDriver enregistré dans l'ExecutorRegistry      │
    │  → vite dev :8080 sert le SPA, ouvre dans le browser        │
    └────────────────────────────────────────────────────────────┘

2.  Connect a real LLM (optionnel)
    ┌────────────────────────────────────────────────────────────┐
    │ Settings → LLM Providers → Anthropic → "Set key"            │
    │  PATCH /v1/llm-providers/anthropic { apiKey: "sk-ant-…" }   │
    │   · server seal la clé avec Crypto, stocke ciphertext       │
    │   · invalidate model cache pour ce provider                 │
    │ → POST /v1/llm-providers/anthropic/test (test connection)   │
    │   · client.list_models() avec la vraie clé                  │
    │   · update connected=true                                    │
    └────────────────────────────────────────────────────────────┘

3.  Onboarder un nouveau projet
    ┌────────────────────────────────────────────────────────────┐
    │ Click "+ New project" sur Projects                          │
    │  Step Source → "From Scratch"                               │
    │  Step Resources → budget $250, max parallel agents = 4      │
    │  Step Connect LLMs → Anthropic ✓                           │
    │  Step Describe → tape "Build a markdown blog with auth"     │
    │  Step Plan Review → preview généré par                      │
    │    POST /v1/projects/genesis/preview (LLM)                  │
    │  Click "Launch" → launchProject() :                          │
    │    a. addProject({ name, description, tier:'local', $250 }) │
    │    b. setActiveProject(newId)                                │
    │    c. POST /v1/projects/:id/launch { description, decompose } │
    │       → backend :                                            │
    │         · mkdir <data_dir>/workspaces/<id>/                  │
    │         · GitRepo::new(root).init()                          │
    │         · probe SearXNG (échoue → step "warn")               │
    │         · spec_documents::create(brief)                      │
    │         · decompose_brief :                                  │
    │              LLM appel "casse en 3-5 phases, par-task        │
    │              assignee:role"                                  │
    │              for each phase : sprints::create               │
    │              for each task : tasks::create(agent_id=match)  │
    │       → return { steps, sprintIds, taskIds, taskCount: 14 } │
    │    d. Onboarding affiche le report puis nav → /dashboard    │
    └────────────────────────────────────────────────────────────┘

4.  Spawn d'un agent manuel
    ┌────────────────────────────────────────────────────────────┐
    │ HiveGraph → click "Spawn Agent"                             │
    │  <AgentSpawnModal> ouvert                                   │
    │   name: "Auth Specialist"                                   │
    │   role: "Backend"  (preset chip)                            │
    │   model: anthropic / claude-sonnet-4-6                      │
    │   system prompt: "You implement auth flows…"                │
    │   tools: ☑ fs_read ☑ fs_write ☑ shell_exec ☑ git_*           │
    │  POST /v1/projects/:id/agents → backend :                   │
    │   · slug = "ba-<ulid8>"                                      │
    │   · agents::create                                           │
    │   · emit agent.status                                        │
    │  Frontend useSse invalide ['agents', pid]                   │
    │  → l'agent apparaît dans HiveGraph immédiatement            │
    └────────────────────────────────────────────────────────────┘

5.  Chat avec l'agent
    ┌────────────────────────────────────────────────────────────┐
    │ Click sur l'agent dans HiveGraph → drawer → "Message Agent" │
    │  → navigate /chat avec ce thread (auto-créé pour cet agent) │
    │  type "Start by reading the project's HIVE.md if it exists" │
    │  Click Send → POST .../chat-threads/:id/messages            │
    │   · user_msg inserted                                        │
    │   · auto-rename du thread "Start by reading the project's…" │
    │   · assistant_msg pending inserted                           │
    │   · tokio::spawn(run_turn ─→)                                │
    │  /v1/events stream pour ce client :                          │
    │   ◄ chat.<tid>.streaming                                     │
    │   ◄ chat.<tid>.token "Let me check"…                         │
    │   ◄ chat.<tid>.tool_call { fs_read "HIVE.md" }               │
    │   ◄ chat.<tid>.tool_result { content: "…" }                  │
    │   ◄ chat.<tid>.token "Found it — I'll …"                     │
    │   ◄ chat.<tid>.tool_call { fs_write "src/auth.ts" … }        │
    │   ◄ chat.<tid>.tool_result { ok: true }                      │
    │   ◄ chat.<tid>.token "Done. The file is in place."           │
    │   ◄ chat.<tid>.complete { tokensIn, tokensOut, costCents }   │
    │  Backend persiste le transcript COMPLET (rounds joints \n\n) │
    │  cost_events::insert  → emit cost.ingested → Dashboard       │
    │   spend timeline se met à jour automatiquement               │
    └────────────────────────────────────────────────────────────┘

6.  L'agent en sub-spawn
    ┌────────────────────────────────────────────────────────────┐
    │ Si l'agent appelle spawn_agent("Frontend agent", task) :    │
    │  · agents::create(parent_agent_id = caller.id)              │
    │  · agent_wires::create(parent, child)  (auto-wire)          │
    │  · executors.ensure_with_parent(child, project, parent)     │
    │     ─→ cancel-scope hérité                                  │
    │  · agent_messages::enqueue (la task initiale)               │
    │  · executors.dispatch(child, InboxItem)                     │
    │     ─→ ApiTurnDriver.run → chat::run_turn (récursif)        │
    │  · emit agent.spawned                                        │
    │  → HiveGraph affiche le sub avec une wire animée            │
    └────────────────────────────────────────────────────────────┘

7.  Budget atteint
    ┌────────────────────────────────────────────────────────────┐
    │ Au prochain `run_turn`, budget check :                      │
    │   spent = total_cost_cents_for_project >= budget_total_cents│
    │   finalize assistant: "[budget] This project reached its    │
    │   budget ($X of $Y). Raise the budget in Settings."         │
    │   emit chat.<tid>.error { kind: 'budget_exceeded' }         │
    │ Front : toast erreur, UI montre le bloc d'erreur dans la    │
    │ chat ; tous les autres turns vont refuser à leur tour.      │
    │ Raise via Settings → project budget +$100 → reprends.       │
    └────────────────────────────────────────────────────────────┘

8.  Compaction d'un long thread
    ┌────────────────────────────────────────────────────────────┐
    │ User tape `/compact` → POST .../compact                     │
    │  Si messages > 6 : split (older / 6 most recent kept)       │
    │  Transcript des older, cappé 16 KB                          │
    │  LLM appel "Summarise the older chat…"                      │
    │   → 200-400 mots                                             │
    │  chat_messages::delete_ids(olders)                          │
    │  chat_messages::insert_at(role=system,                       │
    │   content="[Conversation summary — N earlier messages       │
    │            compacted]\n\n<summary>",                         │
    │   created_at = oldest.created_at)                            │
    │  chat_threads::touch                                          │
    │  emit chat.<tid>.message → invalidate query                  │
    │  Toast: "Compacted N older message(s)."                      │
    └────────────────────────────────────────────────────────────┘

9.  Suppression du projet
    ┌────────────────────────────────────────────────────────────┐
    │ Settings → Data & Privacy → "Delete project"                │
    │  DELETE /v1/projects/:id → backend :                         │
    │   · list_by_project(threads) → thread_ids                   │
    │   · purge_attachments_for_threads :                          │
    │       for each msg in threads → list_for_message →           │
    │         delete_for_message_ids + unlink files                │
    │   · tokio::fs::remove_dir_all(attachments_root)              │
    │   · projects::delete  → cascades to                          │
    │       agents, agent_wires, agent_messages, chat_threads,     │
    │       chat_messages, tasks, sprints, etc.                    │
    │   · audit::append project.delete                             │
    │   · si project était actif : clear setting global activeProj │
    │   · emit project.deleted                                     │
    │  Frontend : navigate /, refetch ['projects']                 │
    └────────────────────────────────────────────────────────────┘
```

---

## Légende des annotations qui reviennent dans le code

- `// SAFETY: …` — bloc unsafe avec justification (ex: `pre_exec` dans
  `LocalFsSandbox::exec`).
- `// Best-effort:` — chemin qui swallow les erreurs intentionnellement (log
  warn + continue) pour ne pas bloquer un flow plus important.
- `// SSE` — émet un event sur `EventBus` ; chercher dans `useSse.ts`
  l'`EVENT_MAP` correspondant.
- `// Audit` — écrit une ligne `audit_log` (actor, action, before/after).

Toutes les routes sont sous `/v1/...`. L'OpenAPI est à `GET /v1/openapi.json`
(snapshot statique : `back-end/openapi/openapi.json`).

---

*Pour le détail des problèmes restants et leur résolution, voir le méga-plan
à `/root/.claude/plans/fais-un-mega-plan-keen-blossom.md` ou `docs/ROADMAP.md`.*
