# HIVE Security Posture

> What HIVE protects, how, and the **known holes you must understand before
> exposing it beyond loopback.** Open security defects are tracked by ID in
> [`BACKLOG.md`](BACKLOG.md) (§3.1–§3.2, §4.2); this doc is the posture summary,
> not a second tracker.

**Last reviewed:** 2026-06-16 against the 2026-06-15 audit.

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
| **Permission profiles** | `Plan` / `Build` / `Explore` enforced in `ToolRegistry::invoke` before dispatch | `hive-tools::permission` |
| **SSRF baseline** | `web_fetch` rejects private/internal **IP-literal** destinations and IP-literal redirect hops | `hive-tools/src/builtins/web.rs` |
| **Sovereignty gate** | `local`-tier projects reject `git_pull`/`git_push` | `hive-runtime::git_tools` |
| **Tool audit trail** | `audit::append` on lifecycle endpoints (pause/resume/terminate/set-status) | `hive-api` |

## 3. Known open security issues (must-read)

These are confirmed open in the 2026-06-15 audit. Full detail + fix in
[`BACKLOG.md`](BACKLOG.md); IDs given for cross-reference.

### Critical 🔴
- **C026 / C074 — the tool allowlist kill-switch doesn't kill.** A per-agent
  `enabled_tools` list *replaces* the global allowlist instead of intersecting,
  so disabling `shell_exec` project-wide doesn't stop an agent that carries it.
- **C087 — substring domain whitelist.** The MCP-synthesis approval gate matches
  `url.contains(domain)`, so `api.github.com.evil.com` passes.
- **C202 — Gemini API key in URL.** Key sent as `?key=…` → leaks into proxy /
  access logs.
- **C247 — master key not zeroized** in memory after use.

### High 🟠
- **C169–C188 — SSRF via hostname redirect / DNS rebinding.** The redirect
  policy only checks IP literals; a hostname that resolves to `169.254.169.254`
  on reqwest's own DNS still reaches cloud metadata. *(Source comment admits
  this.)*
- **C088 — chat-attachment read path** lacks the canonicalize+bounds check the
  download path has.
- **C251 — git-option injection** (`--git-dir=…`) through unvalidated `git` args.
- **C256 — Windows master-key file** uses default ACLs (readable by other local
  users).
- **C261 — `shell_exec` runs any binary** (`curl`/`nc`/`socat`); no command
  allowlist.
- **C134–C140 — repo-layer credential mutations** bypass audit + allowlist
  validation.
- **C203 / C201 — Gemini** model-name URL injection; null `generationConfig` on
  streaming.
- **Frontend credential lifecycle** — C337/C338/C339 secrets in React state with
  no cleanup; C478/C482 plaintext key transmission; C480/C481 unencoded URL
  segments.

### Audit coverage
- **~30 state-changing endpoints don't write `audit::append`** (C001–C056 +
  medium batch). The "every mutation is auditable" guarantee is not yet met. One
  middleware fix closes the batch.

## 4. Dependency advisories

- **C543** — `vitest 3.2.4` (GHSA-5xrq-8626-4rwp, CVSS 9.8). Bump to ≥3.2.6.
- **C544 / C545** — transitive `esbuild` advisories (dev-server CORS; Deno-binary
  vector). Lower severity; dev-only surface.

Run `just audit` (`cargo audit` + `npm audit`) before any release.

## 5. Before you bind off-loopback

HIVE has **no authentication**. The API can `shell_exec` arbitrary commands,
decrypt stored tokens, and write files. CORS protects browsers only — `curl`
does not care. **Do not set `HIVE_BIND` to anything other than `127.0.0.1`**
without first adding an auth layer (a `HIVE_API_TOKEN` gate is the documented
next step; tracked as a hardening item). On a shared host, also resolve C256
(Windows key ACL) first.

## 6. Reporting

This is a pre-release research codebase with a known, tracked defect surface.
New security findings should be added to [`BACKLOG.md`](BACKLOG.md) with a
file:line anchor and a severity, following the existing C-ID format.
