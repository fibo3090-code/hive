# HIVE — Méga-plan : tous les problèmes restants + solutions

> Plan exhaustif de ce qui reste à faire sur HIVE après les multiples sessions
> de fixes/features. Consolide tout ce qui a été identifié (bugs, fuites,
> hazards, features manquantes, dette UI, dette ops) avec une solution concrète
> par item.

## 0. Contexte

**HIVE** est une plateforme locale d'exécution multi-agent : un coordinateur
("CEO") décompose un brief en sprints/tasks, spawne des sous-agents, qui
travaillent dans une sandbox par projet (fichiers, shell, web, git, A2A) sous
les yeux de l'opérateur. Backend Rust/Axum, frontend React/Vite, SQLite local
par défaut, fallbacks Ollama + SearXNG, encryption ChaCha20-Poly1305 pour les
secrets.

**Déjà livré** (sur `main`, PR #7 + #8 mergées) : `tsc`/`clippy`/`cargo test`
verts ; bugs concrets (FileCode import, `seed_demo "demo"`, `chat.rs`
double-emit + chemin projet, `parse_duration_or` panic, migration name) ;
features wired (Code & Versioning réel sur les endpoints git, `/compact`,
`add_task`, `auto-decompose`, AgentSpawnModal réel, Forge Connectors/Skills
create/delete, Command Palette fuzzy, Stats CSV) ; runtime (interleave
persistence, budget enforcement, agent-mgmt tools, thread auto-rename) ;
onboarding `/launch` réel + décomposition LLM en sprints/tasks ; tools agents
(`hive_mind_*`, `list_spec_docs`/`read_spec_doc`/`add_task`/`add_tech_debt`/
`update_tech_debt`/`record_drift`, git tools sovereignty-gated, A2A complet,
agent_wires + cycle prevention + visibility) ; docs réécrites
(`architecture.md`, `ROADMAP.md`, READMEs, `FEATURE_STATUS.md`).

**Reste à faire** : ce document. Il est organisé en **5 vagues** (sequencing
recommandé) puis détaille chaque item avec sa solution, les fichiers à
toucher, et une note de vérification. Sévérités : 🔴 critique (bug,
fuite, hazard) · 🟠 important · 🟡 utile · 🟢 cosmétique/ops.

## 1. Sequencing recommandé (TL;DR)

| Vague | Quoi | Pourquoi en premier |
|---|---|---|
| **W1** | Section A — bugs/fuites/safety | Empêche que l'usage en démo fasse exploser le disque, fuiter, ou crasher. ~3-4 commits. |
| **W2** | Section B1-B2 — coordinator-led onboarding + skill mounting | Débloque la *boucle produit* (créer un projet → CEO planifie → agents travaillent avec leurs skills). Ce qui rend HIVE *useful*. |
| **W3** | Section B3-B5 — autonomous loop + auto-MCP + drift | Transforme "tu pilotes manuellement" en "tu supervises". L'autonomie réelle. |
| **W4** | Section C + D — UI completeness + observabilité | Polish, accessibility, dark mode, mobile, error boundary, lock overlay, eval. |
| **W5** | Section E — DX/ops | Dockerfile, LICENSE, CONTRIBUTING, e2e, backup/restore, audit retention. |

---

## 2. Section A — Bugs, fuites, safety hazards 🔴

### A1. Fuite d'attachments à la suppression d'un thread/projet 🔴

**Problème.** `chat_threads::delete` / `clear_for_project` appelle
`chat_messages::delete_for_thread` (efface les messages), **mais** ni les
lignes `chat_message_attachments` ni les fichiers sur disque sous
`<data_dir>/attachments/<project_id>/` ne sont nettoyés. Idem à la suppression
d'un projet. Disque qui gonfle silencieusement.

**Solution.**
1. `crates/hive-db/src/repos/chat_attachments.rs` : ajouter
   `list_for_thread(db, thread_id) -> Vec<Model>`,
   `delete_for_thread(db, thread_id) -> Vec<String>` (retourne les
   `storage_path` supprimés), `delete_for_project(db, project_id) -> Vec<String>`.
2. `chat_messages::delete_for_thread` (ou un wrapper dans hive-api) appelle
   d'abord `chat_attachments::delete_for_thread` et `unlink` chaque fichier
   sur disque (sous `attachments_root(data_dir, project_id)`).
3. Le handler `delete_chat_thread` et la suppression projet (`DELETE
   /v1/projects/:id`) appellent ce chemin.
4. Migration douce : un job de nettoyage au démarrage qui scanne les fichiers
   sous `attachments_root` et supprime ceux dont l'`id` n'est plus dans la
   table (orphelins existants).

**Fichiers.** `crates/hive-db/src/repos/{chat_attachments,chat_messages,chat_threads}.rs` ;
`crates/hive-api/src/main.rs` (handlers `delete_chat_thread`, `delete_project`,
peut-être `clear_for_project`).

**Vérif.** Test : créer un thread, joindre un fichier, supprimer le thread →
le fichier disparaît du disque et la ligne `chat_message_attachments` n'existe
plus.

### A2. `audit_log` non borné 🔴

**Problème.** Presque toutes les mutations (`agents.create`, `set_status`,
`tech_debt.move`, `notes.create`, `tasks.set_status`, `decompose_spec_document`,
`compact_chat_thread`, etc.) écrivent une ligne `audit_log`. Aucune purge,
aucune UI d'export, aucune retention. La table grossit linéairement avec
l'usage.

**Solution.**
1. Ajouter un setting global `audit.retention_days` (défaut 90) lu par
   `bootstrap_runtime` ; un job tokio au démarrage et toutes les 24 h supprime
   les lignes `audit_log` plus vieilles que ça.
2. UI d'export CSV : `GET /v1/audit-log?since=…&until=…&format=csv` → un
   streaming CSV, plus un bouton "Export audit log" dans Settings → Data
   & Privacy (à la place du select "Audit Log Retention" décoratif actuel,
   qui devient le vrai contrôle de la retention).
3. UI d'inspection : table paginée dans Settings → Audit Log (filtres par
   `actor` / `action` / `entity` / date).

**Fichiers.** `crates/hive-db/src/repos/audit.rs` (ajouter `delete_before`),
`crates/hive-api/src/main.rs` (handler export + handler list paginated +
spawn du job de retention), `front-end/src/pages/Settings.tsx`,
`front-end/src/api/`.

**Vérif.** Insérer manuellement des lignes datées d'il y a >90 j ; redémarrer
→ elles sont supprimées. Export CSV téléchargeable.

### A3. `enabled_tools` est global, pas par projet 🔴

**Problème.** L'allow-list de tools (`enabledTools` dans le setting
`tools` scope=`global`) est partagée entre TOUS les projets. Impossible
d'avoir un projet sandbox avec juste `fs_read`/`web_search` à côté d'un projet
agent-coding avec `shell_exec` + git + spawn.

**Solution.**
1. Lire les settings tools en scope `project:<project_id>` d'abord, fallback
   sur `tools` (global) si absent — déjà la pattern utilisée pour d'autres
   settings.
2. Handler `GET/PATCH /v1/projects/:id/tools-sandbox` (existe en partie via
   le setting endpoint générique) ; UI Settings → Tools & Sandbox lit/écrit le
   scope du projet actif, avec un toggle "Inherit from global" qui supprime
   l'override.
3. `enabled_tools_for_turn(state)` devient `enabled_tools_for_turn(state,
   project_id)`.

**Fichiers.** `crates/hive-api/src/main.rs` (env de
`enabled_tools_for_turn` / `current_tools_sandbox_settings` /
`build_tooling`), `front-end/src/pages/Settings.tsx` section Tools & Sandbox.

**Vérif.** Créer deux projets, activer `shell_exec` dans P1 seulement,
vérifier `/v1/tools` (qui prend l'`Origin` ou un paramètre `project_id`)
montre les bons défauts et qu'une invocation dans P2 est refusée.

### A4. `spawn_agent` slug collision 🔴

**Problème.** `agent_tools.rs:103-107` :
`format!("{}-{}", role[..2].lowercase, Utc::now().timestamp() % 1000)`.
Deux agents même rôle, même seconde-mod-1000 → même slug → l'insert plante
sur la contrainte unique (ou pire, si pas de contrainte, écrase).

**Solution.** Slug = `format!("{}-{}", role_prefix, ulid::Ulid::new().to_string().to_lowercase().chars().take(8).collect::<String>())`
(préfixe rôle 2 lettres + 8 chars ULID). Probabilité de collision négligeable.
Vérifier qu'`agents::create` rejette le doublon avec un message clair (sinon
ajouter un retry une fois).

**Fichiers.** `crates/hive-runtime/src/agent_tools.rs` (SpawnAgent::invoke),
`crates/hive-api/src/main.rs` (`create_agent` qui fait le même format de
fallback ligne 1834).

**Vérif.** Test unitaire : spawner 100 agents en boucle même rôle → 100
slugs distincts.

### A5. `back-end/.env.example` partiellement mensonger 🔴

**Problème.** Documente `HIVE_BIND` / `HIVE_DATABASE_URL` / `HIVE_DATA_DIR` /
`HIVE_OLLAMA_URL` / `HIVE_SANDBOX_PREFER` mais seuls `HIVE_LOG` /
`HIVE_LOG_JSON` sont lus. `bootstrap_runtime` hardcode `workspace_root/data`
et `config/local.toml` pour la DB.

**Solution.** Deux options :
- **Soit câbler les env vars** : `HIVE_DATA_DIR` override `workspace_root/data` ;
  `HIVE_DATABASE_URL` override le `config/local.toml` ; `HIVE_BIND` override
  `[server]` ; `HIVE_OLLAMA_URL` (déjà lu par le client Ollama via le setting,
  mais pas par le bootstrap probe — câbler) ; `HIVE_SANDBOX_PREFER` lu par
  `build_tooling` pour choisir Docker vs Local quand les deux existeront.
- **Soit retirer du `.env.example`** ce qui n'est pas câblé et documenter
  honnêtement (juste `HIVE_LOG`, `HIVE_LOG_JSON`).

Recommandé : **câbler** — l'env-vars override est attendu pour un service.
Précédence : env var > `config/local.toml` > `config/default.toml`.

**Fichiers.** `crates/hive-api/src/main.rs` (`bootstrap_runtime` ~ligne 880).

**Vérif.** `HIVE_DATA_DIR=/tmp/hive-test cargo run -p hive-api -- migrate` →
DB et workspaces créés dans `/tmp/hive-test`.

### A6. Master-key + DB dans deux dossiers différents 🟠

**Problème.** Master key + attachments sous `~/.hive/`, DB + workspaces sous
`back-end/data/`. Non configurable ensemble, déroutant, et impossible de
"déplacer une instance HIVE" proprement.

**Solution.** Réutiliser `HIVE_DATA_DIR` (cf. A5) comme **racine unique** :
- DB : `<data_dir>/hive.db`
- Workspaces : `<data_dir>/workspaces/<project_id>/`
- Attachments : `<data_dir>/attachments/<project_id>/`
- Master key : `<data_dir>/master.key` (avec migration douce — si le fichier
  existe à l'ancien path `~/.hive/master.key`, le déplacer au premier démarrage
  ou continuer à le lire de là tant qu'il existe, pour compatibilité).

**Fichiers.** `crates/hive-crypto/src/lib.rs` (`master_key_path`),
`crates/hive-api/src/main.rs` (`attachments_root` est déjà
`data_dir.join("attachments")` — pas de changement ; `data_dir` lui-même change
via A5).

**Vérif.** Avec `HIVE_DATA_DIR=/tmp/hive-x` un fresh start → tout sous
`/tmp/hive-x/`.

### A7. SSE `tokio::broadcast` peut Lag les clients lents 🟠

**Problème.** Si un client tarde à consommer (onglet en background, throttling
browser), le buffer broadcast (Tokio limite) écarte des events sans le client
en soit informé proprement.

**Solution.**
1. Sur Lag (le receiver retourne `Err(RecvError::Lagged(n))`), envoyer un
   event spécial `sync.required` au client → le frontend invalide *toutes* les
   query keys et refait un fetch propre.
2. Augmenter le buffer (`broadcast::channel(N)` actuel) raisonnablement
   (1024 → 4096).
3. Surfacer un toast "Reconnecting…" pendant la resync côté front (`useSse`).

**Fichiers.** `crates/hive-runtime/src/events.rs`,
`crates/hive-api/src/main.rs` (handler `events_stream`),
`front-end/src/realtime/useSse.ts`.

**Vérif.** Test e2e : ralentir le client artificiellement (ajouter sleep dans
le handler), saturer en émissions, observer l'event `sync.required` et la
récupération.

### A8. `fs_read` / `fs_write` / `shell_exec` sans plafonds 🔴

**Problème.**
- `fs_read` ne plafonne pas la taille du fichier lu → un fichier 500 MB peut
  remplir la mémoire et souffler le contexte LLM.
- `fs_write` ne plafonne pas la taille écrite → remplissage disque.
- `shell_exec` n'a que le timeout de 60 s comme garde-fou. Pas de cgroup, pas
  de `ulimit`. `:(){ :|:& };:` ou un `dd if=/dev/zero of=…` peut épuiser la
  machine avant le timeout.

**Solution.**
1. **`fs_read`** : plafond 1 MB par défaut configurable via setting
   `tools.fs_read_max_bytes` ; retourner une erreur claire au LLM si dépassé,
   ou tronquer + marker "(file truncated after X bytes of Y)" — laisser un
   paramètre `max_bytes` optionnel.
2. **`fs_write`** : plafond 10 MB par défaut configurable
   (`tools.fs_write_max_bytes`).
3. **`shell_exec`** : sur Unix, utiliser `setrlimit` (via `prctl` ou
   `process::Command::pre_exec` + `nix::sys::resource::setrlimit`) pour
   plafonner CPU (300 s), AS/RSS (1 GB), nb fichiers ouverts (1024),
   nb processus fils (32, contre la fork bomb). Tronquer le stdout/stderr à
   256 KB. Optionnel : nicer le process.
4. À terme : sandbox Docker (var existante `HIVE_SANDBOX_PREFER=docker`).

**Fichiers.** `crates/hive-tools/src/builtins/{fs,shell}.rs`,
`crates/hive-sandbox/src/local.rs` (où `exec` est implémenté).

**Vérif.** Test unitaire : `shell_exec yes` (boucle infinie) → terminé par le
timeout *et* CPU limité ; `shell_exec "dd if=/dev/zero of=/tmp/x bs=1G count=10"`
→ tué par rlimit AS bien avant. `fs_read` sur un fichier > plafond → erreur
explicite, pas un OOM.

### A9. `web_fetch` sans allow-list / SSRF 🔴

**Problème.** Un agent peut `web_fetch http://169.254.169.254/...` (metadata
AWS), `http://10.0.0.1`, `http://localhost:8787/v1/agents/...` (auto-RCE :
appel à sa propre API sans auth). Pas de respect `robots.txt`. Pas de
rate-limit. Pas de plafond de réponse.

**Solution.**
1. **Bloquer par défaut** : RFC1918 (10/8, 172.16/12, 192.168/16),
   169.254/16 (link-local + metadata), 127/8 (loopback), ::1, fc00::/7 +
   fe80::/10. Resolver le DNS et vérifier l'IP réelle (pas juste le hostname,
   contre DNS rebinding : faire le `resolve` + `fetch` sur la même IP).
2. Setting global `tools.web_fetch_allowed_hosts` (liste d'allow-list, vide =
   "tout sauf privé"). Setting `tools.web_fetch_max_bytes` (default 5 MB),
   timeout de réponse 15 s déjà existant.
3. Respecter `robots.txt` (cache 1 h) — paramètre `force=true` pour bypasser
   explicitement.
4. Rate-limit : max 30 fetch / min / agent (token bucket en mémoire ou via
   `dashmap`).

**Fichiers.** `crates/hive-tools/src/builtins/web.rs`.

**Vérif.** Test : un agent essayant `web_fetch http://169.254.169.254` →
rejet clair. Un fichier 50 MB → tronqué/rejeté. 100 appels en 10 s → la moitié
rate-limited.

### A10. CORS hardcodé aux origines Vite de dev 🟠

**Problème.** Si l'utilisateur lance le front sur un autre port/host (proxy
nginx local, déploiement custom), tout casse.

**Solution.** Lire `HIVE_CORS_ORIGINS` (CSV) avec un défaut sensé incluant
`http://localhost:8080`, `http://127.0.0.1:8080`. Documenter dans
`.env.example` et `back-end/README.md`.

**Fichiers.** `crates/hive-api/src/main.rs` (config de la CORS layer).

**Vérif.** `HIVE_CORS_ORIGINS=http://localhost:5173 cargo run -p hive-api -- serve`
→ le front sur :5173 fonctionne.

---

## 3. Section B — Roadmap : core product 🟠

> Détails complémentaires à `docs/ROADMAP.md` §1-5.

### B1. Coordinator-led onboarding chat 🟠

**Problème.** L'étape "Describe" de l'onboarding est un textarea + upload de
spec. Pas une conversation avec le CEO comme prévu. `/v1/projects/:id/coordinator/converse`
et `/coordinator/ensure` existent mais sont non utilisés par l'UI.

**Solution.**
1. Backend : finir `/coordinator/converse` si manquant (return un message
   assistant en streaming SSE — pattern de chat existant). Le coordinator
   agent est créé via `/coordinator/ensure` à la création de projet
   (déclencher dans le handler `create_project`).
2. Frontend : remplacer `StepDescribe` (`Onboarding.tsx`) par un mini Chat
   Central minimaliste qui parle au coordinator. Le coordinator a une system
   prompt qui termine la conversation par "Je vais produire le brief" et
   écrit le `spec_documents` row + propose un roster initial via
   `spawn_agent` calls. Côté UI, à la fin de la conversation, on saute à
   "Plan Review" qui montre le spec et le roster, et "Launch" appelle
   `/launch` (déjà fait) avec `decompose: true`.
3. Variante : un bouton "Skip — I'll paste a brief" qui ramène l'ancien
   textarea, pour les flux rapides.
4. Honorer `team_mode` : `coordinator_tools(Some(team_mode))` est déjà câblé.
   La conversation côté UI affiche un badge "Team mode: ON/OFF".

**Fichiers.**
- Backend : `crates/hive-api/src/main.rs` (vérifier/compléter
  `/coordinator/converse`, le faire spawn dans `create_project`).
- Frontend : `src/pages/Onboarding.tsx` (refactor StepDescribe en
  `StepCoordinatorChat`), nouvelle hook `useCoordinatorChat` dans
  `src/api/coordinator.ts`.

**Vérif.** Créer un projet via l'onboarding, chatter avec le CEO, vérifier
que le launch crée un spec_document + des sprints/tasks alignés avec la conv.

### B2. Skill mounting : bindings + `list_skills`/`read_skill` 🟠

**Problème.** Skills existent (table + CRUD UI) mais aucun agent ne peut les
utiliser à l'exécution. Pas de binding agent↔skill, pas de tool agent pour
lister/lire.

**Solution.**
1. **Migration** `m2026MMDD_000001_agent_skill_bindings` :
   `agent_skill_bindings(id, project_id, agent_id, skill_id, created_at)` +
   index unique `(agent_id, skill_id)` + FKs ON DELETE CASCADE.
2. **Repo** `hive-db/src/repos/agent_skill_bindings.rs` : `list_for_agent`,
   `list_skills_for_agent` (join), `bind`, `unbind`.
3. **REST** : `GET/POST /v1/agents/:id/skills`, `DELETE /v1/agents/:id/skills/:skill_id`.
4. **Tool LLM** dans `hive-runtime/src/db_tools.rs` :
   - `list_skills()` → liste les skills bound de l'agent appelant (id, slug,
     name, description).
   - `read_skill(slug)` → renvoie `system_prompt_fragment` + `allowed_tools`
     + `allowed_paths` + (futur) le markdown body / scripts attachés.
5. **System prompt injection** : `PromptComposer` (déjà 4 couches) ajoute une
   5e couche "skills bound to this agent" — juste la liste (slug + 1-line
   description), pas le contenu (lazy-load via `read_skill`). Le composer
   conserve le préfixe stable pour le caching.
6. **Schéma skill** étoffé : ajouter `markdown_body` (TEXT), et plus tard
   `attached_files` (JSON array). Pour l'instant le `system_prompt_fragment`
   tient lieu de body.
7. **UI Forge → Skills** : éditer (en plus de create/delete) — ajouter un
   textarea markdown plus large pour `markdown_body`. **UI agent builder**
   (`AgentFormFields` + `AgentConfigDialog`) : section "Skills" (checklist
   des skills du projet, état bound/unbound).

**Fichiers.** Nouvelle migration ; nouveau repo ; `crates/hive-api/src/main.rs`
(routes) ; `crates/hive-runtime/src/db_tools.rs` (`list_skills` +
`read_skill`) ; `crates/hive-runtime/src/prompt.rs` (PromptComposer 5e couche) ;
`front-end/src/api/agents.ts` (hooks) ; `front-end/src/components/shared/AgentFormFields.tsx`
(section skills) ; `front-end/src/pages/Forge.tsx` (édition skills).

**Vérif.** Bind un skill à un agent, lancer un turn, voir dans le prompt
composé que le skill est listé, le LLM appelle `read_skill('slug')`, le
contenu remonte.

### B3. Autonomous agent task loop 🟠

**Problème.** Aujourd'hui les agents sont réactifs : ils tournent quand on
leur écrit dans la chat ou quand ils reçoivent un `agent_message`. Ils ne
travaillent pas tout seuls leur `tasks` assignées.

**Solution.**
1. **Per-project scheduler** dans hive-runtime : `TaskScheduler` qui loop sur
   les `tasks` du projet (status `pending`, `in_progress` blocked) et pour
   chaque agent idle avec des tasks assignées non terminées, déclenche un
   `dispatch` (équivalent du `delegate_task` mais auto). Bornes :
   `max_parallel_agents` (déjà stocké dans `onboardingDraft.agents`, à
   persister sur `projects` ou settings), respect du budget enforcement
   existant.
2. **Modèle d'arrêt** : un agent marque une task `completed`/`blocked` en
   appelant un nouveau tool `complete_task(taskId, summary, status?)` ou
   `set_task_status` étendu. Le scheduler ne dispatche pas la même task deux
   fois (check `agent_task_assignments`).
3. **Override par parent/CEO** : le CEO peut `reassign_task(taskId,
   new_agent_id)` (un tool LLM) ou via l'UI Planning → Skill Sprint.
4. **Pause/resume du loop par projet** : un toggle "Session" déjà présent
   (BackgroundSessionCard). Quand session OFF → pas de loop autonome.
5. **Visibilité côté UI** : Dashboard "Active tasks" affiche en plus le
   "next task to pick up" par agent ; HiveGraph anime les arêtes des
   wires actifs.

**Fichiers.** Nouveau `crates/hive-runtime/src/scheduler.rs` ; câblage dans
`hive-api::AppState` + spawn d'un job tokio par projet quand une session est
active ; `hive-db/src/repos/tasks.rs` (extension de `set_status` pour émettre
des events), `agent_task_assignments.rs`.

**Vérif.** Onboarder un projet, lancer la session, ne rien faire → les
agents prennent leurs tasks, les marquent done, l'activité feed se remplit
toute seule.

### B4. Finir auto-MCP-synthesis pipeline + agent tool 🟠

**Problème.** `hive-runtime/src/spawn/` a la state machine et les endpoints
REST mais l'`unimplemented!()` dans le test mock et le flow complet n'est pas
exposé comme tool LLM ni invoqué automatiquement.

**Solution.**
1. Compléter `run_pipeline` (vérifier que `LlmPipelineDeps` réel est complet ;
   remplacer l'`unimplemented!()` si dans un chemin de prod).
2. Câbler le handler `create_spawn_request` pour invoquer `run_pipeline` en
   tâche de fond avec progress events SSE (`spawn_request.<id>.progress|
   complete|error`).
3. Nouveau tool LLM `request_capability(description, requires_approval=true)`
   dans `agent_tools.rs` : crée un `spawn_request`, lance le pipeline,
   retourne le `requestId`. L'agent peut ensuite `monitor_spawn_request(id)`.
4. UI : page "Spawn Requests" (réutiliser `src/api/spawn-requests.ts` qui
   existe et n'est pas utilisé) accessible depuis HiveGraph et le Command
   Palette : montre la state machine, le manifest généré, le code du handler,
   un bouton Approve/Reject à l'étape `awaiting-approval`.

**Fichiers.** `crates/hive-runtime/src/spawn/{driver,llm_deps}.rs`,
`crates/hive-api/src/main.rs` (handlers spawn-requests), nouveau
`crates/hive-runtime/src/agent_tools.rs` (RequestCapability,
MonitorSpawnRequest), `front-end/src/pages/SpawnRequests.tsx`.

**Vérif.** Un agent demande "I need a Stripe integration" → spawn request
créé, pipeline tourne, manifest généré, approbation, sub-agent matérialisé
avec custom MCP server bound. End-to-end testable en local-mode (mock
external API calls).

### B5. Drift auto-detection 🟠

**Problème.** `drift.rs` a les scorers, rien ne les appelle.

**Solution.**
1. Hook dans `chat::run_turn` (côté `agent_id.is_some()` = c'est un agent qui
   parle) : après chaque turn, calculer les 3 scores (agent-vs-task,
   code-vs-spec, agent-vs-system-prompt) — l'`outcome.accumulated` + le task
   courant (à pull depuis `tasks` via `agent_task_assignments`) + les diffs
   git récents.
2. **Réponse graduée** par seuil :
   - score < 0.4 → ne rien faire.
   - 0.4 ≤ score < 0.7 → écrire un `drift_events` row (severity `low`).
   - 0.7 ≤ score < 0.9 → `drift_events` (severity `medium`) + `alerts` +
     `notification.created`.
   - score ≥ 0.9 → tout ce qui précède + `agents::set_status(paused)` +
     `executors.pause(agent_id)`. Un humain doit reprendre via Resume.
3. Setting `runtime.drift_thresholds` (JSON `{low, med, high}`) éditable
   dans Settings → un panneau "Runtime Behavior".
4. UI Planning → Drift : déjà branchée à `useDriftEvents` — vérifier qu'elle
   affiche bien le `subjectId` (nom de l'agent), le score, la réponse prise,
   et un bouton "Resume" si l'agent est paused.

**Fichiers.** `crates/hive-runtime/src/chat.rs` (hook après le turn complete),
`crates/hive-runtime/src/drift.rs` (potentiellement compléter les scorers),
`hive-db/src/repos/drift_events.rs`, `front-end/src/pages/Planning.tsx`
(onglet Drift), `front-end/src/pages/Settings.tsx`.

**Vérif.** Un agent qui ignore la task et fait n'importe quoi → après son
turn, un `drift_events` apparaît avec severity proportionnelle, et au-delà du
seuil haut l'agent est paused.

### B6. Modules tab honesty pass + server-only gating 🟡

**Problème.** Modules sont du *code custom qui change le comportement de
l'app entière* — privilèges complets, dangereux. La synthesis est un stub
backend. Marketplace download / publish-to-registry sont server-only.

**Solution.**
1. Bannière au top de la Modules tab : *"Modules are full-privilege app
   extensions — treat installing one like installing a trusted plugin.
   Synthesis is currently a metadata stub; modules don't yet execute custom
   code at runtime."* Avec un lien vers la doc.
2. Wrapper `<DisabledFeature kind="server-only">` autour de :
   - Le bouton "Publish to public registry" (PublishModuleDialog).
   - Les boutons "Download" sur les modules de catégorie `Community`.
3. Garder la flow synthesis (qui hit le backend) telle quelle mais labellisée
   "Local synthesis (stub)".
4. Vérifier que `useInstallModule` install vraiment quelque chose ou n'est
   qu'un métadata flip — si métadata seul, le rendre clair.

**Fichiers.** `front-end/src/pages/Modules.tsx`,
`front-end/src/components/modals/PublishModuleDialog.tsx`.

**Vérif.** Visuel : la bannière est là, les boutons Community/Publish sont
disabled avec le tooltip "Requires Hive central server".

---

## 4. Section C — UI completeness 🟠

### C1. Code & Versioning — fonctionnalités manquantes 🟠

**Problèmes.** Pas d'historique commits, pas de création de branche, pas de
restore par-fichier (Discard est tout-ou-rien), pas de stash, pas de diff
inline dans le viewer.

**Solutions.**
- **Commit history panel** : utiliser `useGitLog` (existe) — liste des
  commits, click sur un commit pour voir son diff (`useGitDiff(ref)`).
- **Branch ops** : un dropdown "Create branch" à côté du `BranchSelector` →
  `useCreateGitBranch`. Pour la fusion (merge), pas d'endpoint backend
  actuellement — soit ajouter `git_merge`/`/git/merge`, soit déléguer aux
  agents (le tool `git_commit` peut commit, mais pas merger).
- **Per-file discard** : un bouton "↺" par ligne dans `GitFileTree` →
  `useRestoreGit([path])`.
- **Inline diff** dans le viewer : si le fichier est modifié, afficher le
  diff (`useGitDiff('WORKTREE')` filtré sur le path) en plus du contenu HEAD.

**Fichiers.** `front-end/src/pages/CodeVersioning.tsx`,
`front-end/src/components/layout/code-versioning/{GitFileTree,GitOperationsPanel,BranchSelector}.tsx`.

**Vérif.** Modifier un fichier, voir le diff inline ; discard par fichier ;
voir l'historique des commits, click sur un commit → diff montré.

### C2. GitHub PR merge / review UI 🟡

**Problème.** `useGitHubPulls` + `useCreateGitHubPull` existent. Pas d'UI de
merge ni review.

**Solution.** Page "Pull Requests" (sous Code & Versioning, ou nouvelle route
`/prs`) : liste des PRs ouvertes du repo connecté, click pour voir le diff
(via GitHub API ou `git fetch && git diff`), boutons Approve/Comment/Merge.
Backend : nouveaux endpoints `POST /v1/projects/:id/github/pulls/:n/merge` et
`POST .../comment` (via `octocrab`).

**Fichiers.** `crates/hive-git/src/lib.rs` (`GitHubClient` extensions),
`crates/hive-api/src/main.rs`, `front-end/src/api/git.ts`,
nouvelle `front-end/src/pages/PullRequests.tsx`.

**Vérif.** Sur un repo GitHub connecté avec une PR ouverte → la voir, la
merger.

### C3. AgentConfigDialog / AgentFormFields — attacher skills + connectors 🟠

**Problème.** L'agent builder annonce "skills + connectors + system prompt"
mais ne propose que system prompt + tool allowlist.

**Solution.** Dépend de B2 (skills bindings) et de `agent_mcp_bindings`
(connectors — déjà existant). Dans `AgentFormFields` :
- Section "Skills" : multi-select des skills du projet, état bound.
- Section "Connectors" : multi-select des connectors du projet.
À la création : POST `/v1/projects/:id/agents` puis pour chaque skill/connector
sélectionné, `POST /v1/agents/:id/skills`, `POST /v1/agents/:id/mcp-bindings`.
À l'édition (AgentConfigDialog) : diff entre l'état initial et final, appel
des bind/unbind correspondants.

**Fichiers.** `front-end/src/components/shared/AgentFormFields.tsx`,
`AgentSpawnModal.tsx`, `AgentConfigDialog.tsx`, `pages/AgentForge.tsx`.

**Vérif.** Créer un agent avec 2 skills + 1 connector, vérifier les bindings
en DB et que le tool catalog de l'agent reflète les `requires_connector_ids`
des skills.

### C4. Keyboard shortcuts annoncés à Settings mais non câblés 🟡

**Problèmes.** Settings annonce ⌘1-8 (Navigate panels), ⌘⇧P (Pause all
agents), ⌘B (Toggle file tree), ⌘/ (Search files). Seuls ⌘K et ⌘Enter
existent.

**Solutions.**
- **⌘1-8** : un `useKeyboardNav` hook qui mappe `Cmd/Ctrl + 1..8` aux 8
  routes principales (Dashboard, HiveGraph, Chat, Code, Planning, Forge,
  Stats, Settings). Wire dans `AppLayout`.
- **⌘⇧P** : "Pause all agents" — appelle `useHiveData.pauseAllAgents` (à
  ajouter — iter les agents `working`, appelle `pause` chacun).
- **⌘B** : "Toggle file tree" — seulement actif sur `/code` ; toggle un
  state via `WorkspaceContext`.
- **⌘/** : "Search files" — sur `/code`, focus sur un input de recherche du
  GitFileTree (à ajouter).

**Fichiers.** Nouveau `front-end/src/hooks/useKeyboardShortcuts.ts`,
`AppLayout.tsx`, `pages/CodeVersioning.tsx`, `api/queries/useHiveData.ts`,
`pages/Settings.tsx` (mettre à jour la liste pour qu'elle reflète ce qui
marche vraiment).

**Vérif.** Tester chaque combo, vérifier que la liste Settings est à jour.

### C5. Settings — panneaux décoratifs : câbler ou wrapper 🟡

**Problèmes.** "Adaptive Router", "HCM Modules" toggles, "Integrations",
"Security & Compliance", "Audit Log Retention" sont du local-state pur.

**Solutions.**
- **Adaptive Router** : si on veut, c'est un router LLM (model-cascade). Le
  backend n'a pas ça. → Wrapper `<DisabledFeature kind="planned">` avec une
  description honnête : "Smart routing across models — planned: pick the
  cheapest provider that can handle the prompt".
- **HCM Modules** : c'est le toggling des modules installés. À câbler quand
  les modules s'exécuteront vraiment (B6 + suite). En attendant
  `<DisabledFeature kind="planned">`.
- **Integrations** : c'est en fait les mêmes connectors gérés dans Forge.
  → Soit retirer cette section (redondante), soit lier au tab Connectors.
- **Security & Compliance** : "Outbound prompt warning", "API risk approval",
  "Secret scanning", "IP allowlist" — chacun a une signification réelle :
  - "Outbound prompt warning" → bannière front avant chaque appel cloud-LLM
    quand sovereignty=cloud. Simple toggle, peut être câblé.
  - "API risk approval" → fait référence à `requires_approval` dans les
    `custom_mcp_servers` (déjà existant). Câbler vers un setting global
    `tools.always_require_approval=true|false`.
  - "Secret scanning" → optionnel, peut wrapper en planned.
  - "IP allowlist" → pour la sandbox web_fetch (cf. A9). Câbler.
- **Audit Log Retention** : devient le vrai contrôle (cf. A2).

**Fichiers.** `front-end/src/pages/Settings.tsx` essentiellement.

**Vérif.** Pour chaque section : soit elle est wrapped, soit elle persiste,
soit elle est retirée.

### C6. ErrorBoundary par route 🟠

**Problème.** Une exception dans une page crashe l'app (écran blanc).

**Solution.** Composer `react-error-boundary` (à ajouter) ou un
ErrorBoundary maison à mettre autour de chaque `<Route>` (ou autour de
`<Outlet />` dans `AppLayout`). Fallback UI minimaliste avec stack trace en
dev et un bouton "Reload page".

**Fichiers.** `front-end/src/App.tsx`, nouveau
`front-end/src/components/shared/ErrorBoundary.tsx`.

**Vérif.** Forcer un throw dans une page → l'autre app reste navigable.

### C7. Code-splitting / bundle plus petit 🟡

**Problème.** `dist/assets/index-*.js` ≈ 1.5 MB minifié.

**Solution.** Lazy-load les pages dans `App.tsx` (`const Onboarding =
lazy(() => import('./pages/Onboarding'))` etc.) + `manualChunks` dans
`vite.config.ts` pour séparer React, Recharts (lourd), Monaco (très lourd),
ReactFlow, framer-motion. Suspense + un fallback global.

**Fichiers.** `front-end/src/App.tsx`, `front-end/vite.config.ts`.

**Vérif.** `npm run build` → chunks < 500 KB chacun, first-load JS réduit.

### C8. Optimistic UI sur les mutations clés 🟢

**Problème.** Latence perceptible sur les toggle d'état d'agent, le DnD
tech-debt, le rename de thread, etc.

**Solution.** TanStack Query `onMutate` + `onError` rollback pour :
`updateTaskStatus`, `setAgentStatus`, `moveTechDebt`, `dismissNotification`,
`markNotificationRead`, `createNote`. Pattern : `qc.setQueryData` pour update
local immédiat, `qc.invalidateQueries` sur succès.

**Fichiers.** `front-end/src/api/queries/useHiveData.ts`,
`front-end/src/api/{drift,notes,spec-documents,tools,…}.ts`.

**Vérif.** Click → UI mise à jour instantanément ; en cas d'erreur, rollback
visible + toast.

### C9. `console.warn`/`console.error` cleanup en prod 🟢

**Problème.** Bruit en prod : 6× dans `api/chat.ts`, `realtime/useSse.ts`,
`context/WorkspaceContext.tsx`, `pages/NotFound.tsx`.

**Solution.** Soit `if (import.meta.env.DEV) console.warn(…)`, soit un
wrapper `logger.warn` qui devient no-op en prod. Ou simplement supprimer ceux
qui n'aident plus.

**Fichiers.** Cités.

**Vérif.** Build prod, ouvrir l'app, console silencieuse en happy path.

### C10. Date formatting consistency 🟢

**Problème.** Mix `date-fns` / `new Date(iso).toLocaleString()` / strings ISO
brutes à l'écran.

**Solution.** Utilitaire `formatDate(iso, mode)` dans `lib/utils.ts` avec
modes `'relative'` (date-fns formatDistanceToNow), `'datetime'`, `'date'`.
Remplacer toutes les occurrences (grep `toLocaleString|toLocaleDateString`).

**Fichiers.** `lib/utils.ts` + usages.

**Vérif.** Sweep visuel des dates : cohérent partout.

### C11. Dark/light theme audit 🟢

**Problème.** `next-themes` installé mais pas de toggle visible ; certains
composants ont des couleurs absolues (`bg-slate-900`) au lieu de tokens
(`bg-card`).

**Solution.** Ajouter un toggle dans Settings → Appearance. Grep
`bg-(slate|gray|zinc|neutral|stone)-` et `text-(black|white)` et remplacer par
les tokens (`bg-surface-1`, `bg-card`, `text-foreground`, etc.). Tester le
mode clair.

**Fichiers.** Tout `front-end/src/`.

**Vérif.** Toggler le thème, naviguer chaque page, ajuster les contrastes
cassés.

### C12. Accessibility audit 🟡

**Problèmes.** Boutons sans aria-label, statuts purement chromatiques (rouge
≠ erreur pour daltoniens), focus rings inconsistants, modals sans focus trap.

**Solution.** Audit avec axe-core (`npm i -D @axe-core/playwright` + un
e2e test qui passe sur chaque page). Corrections :
- aria-label sur tous les buttons icônes (HiveGraph actions, NotificationDropdown).
- StatusDot ajoute une icône ou un letterform (✓ ! ⏸ ●) en plus de la couleur.
- shadcn `Dialog` a déjà le focus trap — vérifier que tous nos modals utilisent
  bien Dialog.
- `:focus-visible` cohérent partout.

**Fichiers.** Sweep front-end.

**Vérif.** axe-core sans violations critical, navigation clavier complète.

### C13. Mobile responsive 🟡

**Problème.** App desktop-first. Sidebars, ReactFlow, Monaco s'affichent mal
sur < 768 px.

**Solution.** Pas tenter de tout responsiver — beaucoup de pages (HiveGraph,
CodeVersioning) n'ont pas de sens en mobile. Plutôt :
- AppLayout : drawer-ifier `HiveSidebar` sur mobile (déjà partiellement —
  vérifier).
- TopBar : compacter sur mobile.
- Pages utilisables mobile (Dashboard, Stats, Notifications) : grids
  responsive.
- Page bloquante (HiveGraph, Code) : afficher un message "Best viewed on
  desktop" avec un bouton "Show anyway".

**Fichiers.** `layout/AppLayout.tsx`, `layout/HiveSidebar.tsx`, `pages/*`.

**Vérif.** Tester à 375 px / 768 px / 1024 px.

### C14. i18n scaffolding 🟢

**Problème.** Toutes les strings en dur, en anglais.

**Solution.** Ajouter `i18next` + `react-i18next`, extraire en un namespace
`common` les ~50 strings les plus utilisées, scaffolder `fr.json` (puisque
l'utilisateur écrit en français). Faire ça **après** le polish UX (sinon on
extrait des chaînes qui vont changer).

**Fichiers.** `front-end/src/i18n.ts` (init), `front-end/src/locales/{en,fr}/common.json`.

**Vérif.** Toggler la langue, vérifier qu'au moins les nav/menu/dashboard
basculent.

### C15. Drop les routes *-legacy + composants morts 🟢

**Problème.** `/spec-legacy`, `/modules-legacy`, `/agent-forge-legacy` +
`SpecPlan.tsx`, `Modules.tsx` (utilisé aussi par Forge), `ModuleDetail.tsx`,
`AgentForge.tsx` (utilisé aussi par Forge) — flou.

**Solution.**
- Confirmer que les pages canoniques (Forge tabs, Planning) couvrent tout ce
  que les legacy faisaient.
- Supprimer les routes `*-legacy` de `App.tsx`.
- `Modules.tsx` et `AgentForge.tsx` restent (lazy-loaded par Forge) mais
  perdent leur route directe.
- `SpecPlan.tsx`, `ModuleDetail.tsx` — soit supprimés, soit gardés pour
  réutilisation (à décider).

**Fichiers.** `App.tsx`, suppression des `pages/SpecPlan.tsx`,
`pages/ModuleDetail.tsx`.

**Vérif.** App ne casse pas, plus de routes orphelines.

### C16. Stats : afficher quand la donnée manque 🟢

**Problème.** `agent.qualityScore ?? 0` etc. → graphes plats sans indication.

**Solution.** Quand la donnée est manquante (toutes les rows à 0/undefined),
afficher un état vide : "No eval data yet — the eval pipeline isn't wired
(planned)." Lien vers FEATURE_STATUS.

**Fichiers.** `pages/Stats.tsx`, surtout les `LeaderboardTab` /
`ProjectMetricsTab` Health Snapshot.

**Vérif.** Sur un projet fresh sans eval data, voir le message au lieu de
zéros.

---

## 5. Section D — Data / observabilité 🟡

### D1. Eval pipeline + leaderboard 🟡

**Problème.** `qualityScore` / `evalScores` viennent des seeds. Le
LeaderboardTab est statique.

**Solution.** Beaucoup d'options ; recommandation minimale viable :
1. Définir un schéma d'eval : pour chaque agent, un score par métrique
   (`correctness`, `style`, `efficiency`, `testQuality`, `docQuality`).
2. Ajouter une migration `agent_eval_runs(id, project_id, agent_id, run_at,
   scores_json, sample_size)`.
3. Tool LLM `record_eval(agent_id, scores)` — un agent eval/judge écrit les
   scores d'un autre agent. Bound au coordinator par défaut.
4. À la fin d'un sprint (ou cron), lancer un eval auto : le coordinator
   évalue chaque sub-agent sur les tasks complétées du sprint.
5. Leaderboard lit les dernières `agent_eval_runs` rows.

**Fichiers.** Nouvelle migration ; nouveau repo ;
`crates/hive-runtime/src/db_tools.rs` ; `pages/Stats.tsx`.

**Vérif.** Après un sprint, voir des scores réels.

### D2. Lock overlay HiveGraph 🟡

**Problème.** `lockedAgents = new Set()` hardcodé.

**Solution.** Exposer les locks de sandbox côté runtime :
1. Sandbox tient un `RwLock<HashMap<path, agent_id>>` des fichiers en cours
   d'écriture (lock pris dans `fs_write` avant l'I/O, relâché après).
2. `GET /v1/projects/:id/sandbox-locks` → `[{agentId, path, takenAt}]`.
3. `useSandboxLocks(projectId)` côté front, alimente le `lockedAgents` Set
   dans HiveGraph + le panel "Lock Overlay".

**Fichiers.** `crates/hive-sandbox/src/local.rs`,
`crates/hive-api/src/main.rs`, `front-end/src/api/agents.ts` (ou nouveau),
`front-end/src/pages/HiveGraph.tsx`.

**Vérif.** Lancer un agent qui écrit pendant 30 s, voir l'overlay marquer cet
agent + son fichier.

### D3. Per-project SSE endpoint 🟢

**Problème/non-problème.** Le global `/v1/events` + `useSse` couvre déjà.

**Solution si vraiment souhaité.** `GET /v1/projects/:id/events` qui filtre
le stream global sur les events dont le payload contient `projectId == :id`.
N'apporte pas grand-chose ; à reporter sauf besoin réel.

### D4. Audit log export + retention (cf. A2) 🔴

Vu en A2.

### D5. Project export/import 🟡

**Problème.** Si l'utilisateur perd `back-end/data/` ou la config, tout part.

**Solution.**
- `POST /v1/projects/:id/export` : zip contenant un dump JSON des rows DB du
  projet (projects, agents, tasks, sprints, spec_documents, agent_wires,
  hive_mind_notes, chat_threads + messages, attachments, …), + le workspace
  (`<data_dir>/workspaces/<project_id>/`), + les attachments (`<data_dir>/
  attachments/<project_id>/`). Le master key n'est PAS inclus : les secrets
  chiffrés sont ré-encryptés à l'import.
- `POST /v1/projects/import` accepte le zip, ré-attribue les ids (UUIDs
  régénérés ou conservés selon une option), ré-encrypt les secrets avec le
  master key du host.

**Fichiers.** Nouveau module `crates/hive-api/src/export.rs`, handlers, UI
sous Settings → Data & Privacy.

**Vérif.** Export un projet, supprimer `back-end/data/`, import → projet
identique.

### D6. UI-driven "reset state" 🟢

**Problème.** Pour repartir de zéro, l'user doit manuellement supprimer
`back-end/data/` et `~/.hive/`.

**Solution.** Settings → Data & Privacy → "Factory reset" (avec
confirmation forte type-the-word + warning) : appelle un `POST
/v1/setup/factory-reset` qui drop la DB, vide les workspaces/attachments,
relance le seed. Optionnellement garde le master key (pour ne pas perdre les
LLM keys si on confirme un import après).

**Fichiers.** `crates/hive-api/src/main.rs`, `pages/Settings.tsx`.

**Vérif.** Reset → app revient au seed initial, plus de traces du projet
courant.

---

## 6. Section E — DX / ops 🟢

### E1. Dockerfile + docker-compose 🟢

**Solution.** Multi-stage build :
- Stage 1: cargo build --release de hive-api.
- Stage 2: npm build du front.
- Stage 3 (final): alpine, copie hive-api + dist statique, sert dist via
  hive-api (ajouter une route catch-all qui sert `dist/` ; sinon nginx).
- docker-compose.yml avec hive-api + ollama + searxng.

**Fichiers.** Nouveau `Dockerfile`, `docker-compose.yml`,
`infra/dev-compose.yml` (réf. par README originale mais supprimée — la
recréer).

**Vérif.** `docker-compose up` → app accessible sur :8080 via le container.

### E2. CONTRIBUTING.md 🟢

**Solution.** Document court : branche `claude/...` (cohérent avec la
convention actuelle), `cargo fmt && cargo clippy && npm run typecheck &&
npm run lint && npm test` doivent passer, structure des commits
(`feat(scope):` / `fix(scope):` / `docs:`), comment ajouter une migration,
comment ajouter un tool LLM, comment ajouter une route.

**Fichiers.** Nouveau `CONTRIBUTING.md`.

### E3. LICENSE 🟢

**Solution.** Créer `LICENSE` à la racine avec le texte MIT (les READMEs le
revendiquent déjà).

### E4. Playwright wiring 🟡

**Solution.** Ajouter scripts npm `test:e2e` / `test:e2e:ui` qui lancent
playwright contre un backend de test (fixture qui spawn `cargo run -p hive-api
-- serve` en background avec `HIVE_DATA_DIR=/tmp/...` et `HIVE_BIND=127.0.0.1:0`
attribué dynamiquement). Écrire ~5 tests "happy path" :
1. Création projet via onboarding → arrive au dashboard.
2. Lancer un agent → voir son turn complete dans un thread.
3. Ajouter une task manuelle dans Planning.
4. Drag pour créer un wire dans HiveGraph.
5. `/compact` un long thread.

**Fichiers.** `front-end/package.json` (scripts), `playwright.config.ts`
(maj), `front-end/tests/e2e/*.spec.ts`.

### E5. CI badges 🟢

**Solution.** Ajouter en haut du README root :
`![CI back-end](.../actions/workflows/ci-back-end.yml/badge.svg)
![CI front-end](.../actions/workflows/ci-front-end.yml/badge.svg)`.

### E6. `generated.ts` : codegen ou rename 🟡

**Solution.** Deux options :
- **Codegen** (préférable) : `openapi-typescript` (npm) génère
  `generated.ts` depuis `back-end/openapi/openapi.json`. Ajouter un script
  `npm run gen:api` et un hook prepush.
- **Rename** : renommer en `schemas.ts`, mettre à jour le commentaire et
  `sonar-project.properties`.

### E7. Pre-commit hook config 🟢

**Solution.** `.husky/pre-commit` ou un fichier `.lefthook.yml` :
`cargo fmt --check && cargo clippy --quiet -- -D warnings && (cd front-end &&
npm run typecheck && npm run lint)`. Optionnel — le projet est petit, CI suffit.

---

## 7. Liste des fichiers critiques (par section)

**Backend (Rust).** `crates/hive-api/src/main.rs` (très gros — la plupart des
nouveaux endpoints/handlers y atterrissent) ; `crates/hive-runtime/src/chat.rs`
(budget enforcement + drift hook) ; `crates/hive-runtime/src/agent_tools.rs` +
`db_tools.rs` (skill tools, request_capability, eval, complete_task) ;
`crates/hive-runtime/src/spawn/` (finir le pipeline) ;
`crates/hive-runtime/src/scheduler.rs` (nouveau, autonomous loop) ;
`crates/hive-tools/src/builtins/{fs,shell,web}.rs` (safety caps) ;
`crates/hive-sandbox/src/local.rs` (rlimits, locks) ;
`crates/hive-db/src/repos/{chat_attachments,audit,agent_skill_bindings}.rs` ;
`crates/hive-db/migration/src/m2026MMDD_*.rs` (agent_skill_bindings + d'autres).

**Frontend.** `src/pages/{Onboarding,Settings,Stats,CodeVersioning,
Modules,HiveGraph}.tsx` ; `src/components/shared/{AgentFormFields,
DisabledFeature,ErrorBoundary}.tsx` ; `src/api/agents.ts` (wire skill +
spawn-request hooks) ; `src/realtime/useSse.ts` (Lag handling) ;
`src/App.tsx` (lazy routes + ErrorBoundary + drop *-legacy) ;
`src/api/queries/useHiveData.ts` (pauseAllAgents, optimistic) ;
`vite.config.ts` (manualChunks).

**Docs.** `docs/{architecture,ROADMAP,FEATURE_STATUS}.md` à mettre à jour à
chaque ship ; `.env.example`, READMEs, `CONTRIBUTING.md`, `LICENSE`,
`Dockerfile`.

## 8. Plan de vérification global

Pour chaque vague :

1. **Backend** : `cargo check --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` · `cargo test --workspace` (tous les groupes verts).
2. **Migrations** : `rm back-end/data/hive.db && cargo run -p hive-api -- migrate` bootstraps cleanly (3 demo projects + agents seedés sans erreur).
3. **Frontend** : `npm run typecheck` · `npm run lint` · `npm run build` · `npm test`.
4. **E2E** (après E4 livré) : `npm run test:e2e` couvre les happy paths.
5. **Smoke manuel** par vague :
   - **W1 (safety)** : créer un thread avec attachments, le supprimer, vérifier `du -sh back-end/data/attachments/<pid>/` = 0. Lancer un `shell_exec` fork-bomb → tué. Lancer un `web_fetch http://169.254.169.254` → refusé.
   - **W2 (coordinator + skills)** : onboarder via la conv CEO, créer un skill, le bind à un agent, voir le LLM appeler `read_skill`.
   - **W3 (auto loop)** : lancer la session, ne rien faire, voir les tasks consommées.
   - **W4 (UI)** : naviguer chaque page, tester chaque shortcut, mode clair, mobile.
   - **W5 (ops)** : `docker-compose up` fonctionne, export/import d'un projet round-trip.

## 9. Décisions à revisiter pendant l'exécution

- **A8 plafonds** : valeurs concrètes (1 MB / 10 MB / 1 GB AS) à valider en
  conditions réelles.
- **A9 allow-list** : faut-il un *deny-by-default* avec un setting d'allow,
  ou *allow-by-default* sauf private nets ? Recommandé : *allow tout sauf
  private nets* + setting deny.
- **B5 thresholds drift** : 0.4/0.7/0.9 sont des points de départ ; à
  recalibrer avec des données réelles.
- **B6 modules execution** : à long terme, comment exécuter du code custom en
  sandbox WASM ? Out of scope du plan, mais à anticiper.
- **D1 eval auto** : un coordinator qui évalue ses sub-agents pose des
  questions de biais (le juge a un intérêt à dire que tout va bien). Peut-être
  utiliser un *juge* indépendant (un autre LLM, ou un agent dédié).
- **C13 mobile** : combien d'effort réellement ? Probablement viser tablette
  (>= 768 px) plutôt que téléphone.

## 10. Hors scope (volontairement)

- Auth multi-utilisateurs — single-operator localhost est une décision de
  design, pas un manque.
- Cloud sovereignty tier — bloqué par "Hive central server" non bâti
  (planned).
- Marketplace / template gallery / public registry — server-only.
- Migration TypeScript front → un autre framework — pas nécessaire.
- Réécriture du backend en un autre langage — non.

---

*Ce plan est le consolidé des observations cumulées de toutes les sessions de
travail sur HIVE. Tout est dans `docs/FEATURE_STATUS.md` (état) +
`docs/ROADMAP.md` (forward plan) + ce document (problèmes additionnels &
solutions). À mettre à jour à chaque vague livrée.