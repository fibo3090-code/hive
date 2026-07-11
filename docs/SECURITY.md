# HIVE Security Posture

> What HIVE protects, how, and the **known holes you must understand before
> exposing it beyond loopback.** Open security defects are tracked by ID in
> [`BACKLOG.md`](BACKLOG.md) (§3.1–§3.2, §4.2); this doc is the posture summary,
> not a second tracker.

**Last reviewed:** 2026-07-10 (triage batch + PR #16/#23/#24 reconciliation) against the 2026-06-15 audit.

---

## 1. Threat model & deployment assumption

HIVE is **local-first and single-tenant by design**. The intended deployment is
one operator, on one machine, bound to `127.0.0.1`. Under that assumption the
attack surface is: (a) untrusted *agent behaviour* (an LLM that goes off the
rails or follows an injected instruction), and (b) untrusted *content the agent
fetches* (web pages, repos). HIVE is **not** hardened as a multi-user network
service. See §5 before changing the bind address.

## 2. What HIVE does protect (security defaults)

| Control | Mechanism | Source |
|---|---|---|
| **Secrets at rest** | LLM / Tavily / GitHub credentials sealed with ChaCha20-Poly1305 | `hive-crypto` |
| **Master key** | Generated at `~/.hive/master.key`, `0600` on Unix | `hive-crypto::load_or_init` |
| **Filesystem jail** | Per-project sandbox: `..` reject → component normalisation → canonicalise deepest existing ancestor → prefix re-check; `O_NOFOLLOW` on writes | `hive-sandbox`, `hive-tools` |
| **File Protection Zones** | `.env*`, `.git/`, `.hive/`, user-protected paths denied per path-component (catches nested `apps/web/.env`) for `fs_read`/`fs_list`/`fs_write`/`str_replace` and path-like `shell_exec` argv | `ToolContext::check_path_allowed` |
| **Credential isolation in shell** | `shell_exec` HOME → `<root>/.hive/run-home/` so npm/cargo/git cached creds don't leak into the next `fs_read` | `hive-sandbox` |
| **Shell network-command denylist** | `shell_exec` refuses network/exfil binaries (`curl`/`wget`/`nc`/`socat`/`ssh`/…) by basename + a best-effort `sh -c` scan; operator-overridable. Sanctioned egress is `web_fetch`/`web_search` (SSRF-guarded) | `ToolContext::check_command_allowed` |
| **Permission profiles** | `Plan` / `Build` / `Explore` enforced in `ToolRegistry::invoke` before dispatch | `hive-tools::permission` |
| **SSRF baseline** | `web_fetch` rejects private/internal destinations; redirects are walked manually so the async **hostname-resolving** guard runs on every hop (not just IP literals) | `hive-tools/src/builtins/web.rs` |
| **Sovereignty gate** | `local`-tier projects reject `git_pull`/`git_push` | `hive-runtime::git_tools` |
| **Git argument safety** | branch names / refs are rejected if they look like options (leading `-`) or carry control chars, closing git-option injection | `hive-git::ensure_safe_ref` |
| **Tool audit trail** | `audit::append` on **every** state-changing endpoint (lifecycle + notes/tech-debt/session/wires/settings/chat/skills/connectors/spec/assignments/drift/spawn/bindings); 51 call sites | `hive-api` |

## 3. Known open security issues (must-read)

Confirmed open in the 2026-06-15 audit and **still open** on `main`. Full detail
+ fix in [`BACKLOG.md`](BACKLOG.md); IDs given for cross-reference.

### High 🟠
- **C134–C140 — repo-layer credential mutations** bypass audit + allowlist
  validation (the handler-level audit trail is now complete, but direct repo
  callers like `seed.rs` still bypass it).
- **Frontend credential lifecycle** — C337/C338/C339 secrets in React state with
  no cleanup; C478/C482 plaintext key transmission.

### Recently resolved (do not re-report)
- **C261** `shell_exec` unrestricted binaries — 2026-07-10 triage: default
  network/exfil command denylist (`ToolContext::check_command_allowed`),
  operator-overridable, with a best-effort `sh -c` scan. True containment
  (arbitrary binaries, `/dev/tcp`, encoded scripts) still needs the Docker
  sandbox (ZZ6), but the common exfil/pivot path and prompt-injection are now
  blocked by default.
- **C026 / C074** tool-allowlist kill-switch — PR #15 (intersect + authority carve-out).
- **C202 / C203 / C201** Gemini key-in-URL / model-name injection / null `generationConfig` — PR #16.
- **C169–C188** SSRF via hostname redirect / DNS rebinding — PR #23 (redirects
  walked manually; the async guard resolves hostnames on every hop, with tests).
- **C247 / C256** master key not zeroized / Windows key-file ACL — PR #24.
- **C087** substring domain whitelist — 2026-07-10 triage (host/subdomain match via `url::Url`).
- **C088** chat-attachment read-path traversal — 2026-07-10 triage (same canonicalize+bounds check as the download path).
- **C251** git-option injection (`--git-dir=…`) — 2026-07-10 triage (`ensure_safe_ref` + first `hive-git` tests).
- **C151** raw-`format!` SQL in the migration-repair path — 2026-07-10 triage (parameterized).
- **C480 / C481** unencoded URL path segments — 2026-07-10 triage (`encodeURIComponent` across the API layer).
- **Audit coverage** — the C001–C056 cluster: every state-changing endpoint now
  writes `audit::append` (51 sites, up from 15) — 2026-07-10 triage.

## 4. Dependency advisories

- **C543** — `vitest 3.2.4` (GHSA-5xrq-8626-4rwp, CVSS 9.8). **Resolved** —
  floor raised to ^3.2.7; `dompurify` forced to ^3.4.11 via `overrides`
  (monaco-editor pins a vulnerable transitive version).
- **C544 / C545** — transitive `esbuild`/`vite` advisories (dev-server CORS;
  Deno-binary vector). **Resolved (2026-07-11)** — `vite` bumped `^5.4.19` →
  `^7.3.6` and `@vitejs/plugin-react-swc` bumped to `^4.3.1` to match; `vite@8`
  was evaluated but rejected because it defaults to the Rolldown bundler,
  which breaks the object-form `manualChunks` config in `vite.config.ts`.
  `npm audit` (all deps) now reports 0 vulnerabilities.

Run `just audit` (`cargo audit` + `npm audit`) before any release. CI's
`audit` job (`.github/workflows/ci-front-end.yml`) gates merges on
`npm audit --audit-level=high --omit=dev` (production dependencies only);
dev-only advisories are tracked here instead of blocking merges.

## 5. Before you bind off-loopback

HIVE has **no authentication**. The API can `shell_exec` arbitrary commands,
decrypt stored tokens, and write files. CORS protects browsers only — `curl`
does not care. **Do not set `HIVE_BIND` to anything other than `127.0.0.1`**
without first adding an auth layer (a `HIVE_API_TOKEN` gate is the documented
next step; tracked as a hardening item). C256 (Windows key ACL) is resolved as
of PR #24.

## 6. Reporting

This is a pre-release research codebase with a known, tracked defect surface.
New security findings should be added to [`BACKLOG.md`](BACKLOG.md) with a
file:line anchor and a severity, following the existing C-ID format.
