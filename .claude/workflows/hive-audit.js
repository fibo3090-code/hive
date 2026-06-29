export const meta = {
  name: 'hive-audit',
  description: 'Exhaustive multi-agent audit of HIVE: lens x scope finders + real-tool scans, dedup, adversarial anti-hallucination verify, write master report + confirmed issue set',
  phases: [
    { title: 'Discover', detail: '~71 lens x scope finders + 5 real-tool scans' },
    { title: 'Verify', detail: 'adversarial re-read of every candidate (3/2/1 votes)' },
    { title: 'Synthesize', detail: 'write MASTER_AUDIT_REPORT.md' },
  ],
}

const ROOT = '..'
const CODE = ROOT + '/hive-code'
const OUT = ROOT + '/audit-out'
const ORDER = { critical: 3, high: 2, medium: 1, low: 0 }

const DELIBERATE = [
  'DELIBERATE CHOICES — DO NOT FLAG THESE (intentional per CLAUDE.md):',
  '- TypeScript loose mode (strict:false, noImplicitAny:false, strictNullChecks:false) is intentional. You MAY flag a specific null-safety BUG, but never "strict mode is off".',
  '- Both shadcn <Toaster/> and <Sonner/> mounted at once — intentional.',
  '- Both bun.lockb and package-lock.json tracked — intentional.',
  '- src/pages/Index.tsx is intentionally orphaned.',
  '- Sovereignty tier colors (local=green, hybrid=amber, cloud=blue) and agent-status colors are load-bearing semantics — never "fix" for variety.',
  '- HSL CSS vars + hsl(var(--x)) Tailwind pattern IS the design system — not "hardcoded color".',
  '- localStorage persistence of workspace/UI prefs is an intentional prototype choice.',
  '- shadcn/ui files under components/ui/ are owned code, edit freely — not a vendored lib.',
].join('\n')

const SCAN_RULES = [
  'SCOPE & HYGIENE:',
  '- NEVER scan/report on: node_modules, dist, build, target, .git, graphify-out, *.lockb, generated files.',
  '- Cite EVERY finding with an exact filePath (relative to ' + CODE + ') and a real line number you actually read. No citation, no finding.',
  '- Use ripgrep (rg) + open the actual file. Verify the code really says what you claim BEFORE reporting.',
  '- Report only REAL, present-in-code issues. No speculative "could in theory" unless the code path demonstrably allows it.',
  '- Severity: critical=ship-blocker/security/data-loss/crash; high=correctness/security-hardening/major UX or perf; medium=quality/maintainability/moderate perf; low=tidy-up.',
].join('\n')

const BE_CTX = [
  'HIVE BACKEND ARCHITECTURE (for accurate findings):',
  '- Crate dep direction is strict: hive-runtime MUST NOT depend on hive-api (decoupled via mpsc spawn_pipeline_tx). Flag violations.',
  '- TWO sources of truth must stay in sync: DB rows (agents.status etc.) AND in-process ExecutorRegistry (HashMap<agent_id, Arc<AgentExecutor>> + CancellationTokens). EVERY path that flips agents.status MUST also call registry.pause/resume/terminate. "DB paused but executor still running" is the #1 bug class — hunt it hard.',
  '- SandboxLockRegistry uses RAII LockGuard; `let _ = guard` drops it immediately (bug). Must bind to a name for the op duration.',
  '- Drift hook runs after every turn; best-effort (no ? propagation) but must NOT be skipped on early-return paths (cancel/error/budget).',
  '- audit::append must be called by EVERY state-changing endpoint (before/after JSON). Many are known to skip it.',
  '- Per-agent enabled_tools MUST be intersected with the global allowlist; a bypass means operator kill-switch does not kill.',
  '- web_fetch SSRF guard must re-validate on EVERY redirect hop.',
  '- Tools available: cargo, cargo clippy, cargo nextest, rg. Do NOT start the API server.',
].join('\n')

const FE_CTX = [
  'HIVE FRONTEND ARCHITECTURE:',
  '- Exactly ONE EventSource for the whole app via RealtimeProvider singleton. ANY `new EventSource(...)` in a page is a bug (browsers cap 6 SSE/origin -> app freeze). Hunt these.',
  '- Runtime/operational state -> useHiveData (TanStack Query, real backend :8787). Settings/UI prefs -> WorkspaceContext (localStorage). Do not conflate.',
  '- SSE->React Query must invalidate the NARROWEST query key, never keyless qc.invalidateQueries().',
  '- a11y matters: keyboard nav, focus management, ARIA roles/labels, alt text, color contrast on dark theme, focus-visible, semantic elements over div+onClick, no raw <a href> for internal routes (use react-router Link).',
  '- Path alias @/* -> src/*. Imports should use @/, not deep relative ../../.',
  '- Tools: npm run lint, npm run build, npx tsc --noEmit, npm run test, rg. Do NOT start the dev server.',
].join('\n')

const BE_TARGETS = [
  { scope: 'crates/hive-api', label: 'api' },
  { scope: 'crates/hive-runtime', label: 'runtime' },
  { scope: 'crates/hive-db', label: 'db' },
  { scope: 'crates/hive-tools', label: 'tools' },
  { scope: 'crates/hive-llm', label: 'llm' },
  { scope: 'crates/hive-domain crates/hive-git crates/hive-search crates/hive-sandbox crates/hive-crypto crates/hive-seed', label: 'support' },
]
const BE_LENSES = [
  { key: 'correctness', desc: 'logic/correctness bugs, async/concurrency races, the DB-row vs ExecutorRegistry state-sync class, cancellation correctness, deadlocks, wrong error propagation' },
  { key: 'security', desc: 'security vulns: SSRF (incl redirect hops), path traversal/sandbox escape, command injection, secrets, authz/allowlist bypass, unsafe deserialization, audit-log gaps' },
  { key: 'silent-failures', desc: 'silent failures & bad error handling: swallowed errors (let _ = ...), unwrap/expect/panic in hot paths, ? that drops best-effort work, ignored Results' },
  { key: 'performance', desc: 'perf: N+1 queries, missing indexes, list->map->sum in Rust instead of SQL aggregate, needless clones/allocs, blocking calls in async, lock contention' },
  { key: 'quality', desc: 'code quality: dead code, duplication, oversized files/functions, leaky abstractions, inconsistent patterns, refactor opportunities, missing input validation' },
  { key: 'tests', desc: 'test coverage gaps: untested critical paths, missing regression tests for known bug classes, tautological/weak tests' },
]

const FE_TARGETS = [
  { scope: 'src/pages', label: 'pages' },
  { scope: 'src/components/ui', label: 'ui' },
  { scope: 'src/components/layout src/components/shared src/components/CommandPalette.tsx src/components/NavLink.tsx', label: 'components' },
  { scope: 'src/context src/realtime src/api', label: 'state' },
  { scope: 'src/hooks src/lib src/App.tsx src/main.tsx src/data', label: 'core' },
]
const FE_LENSES = [
  { key: 'correctness', desc: 'React correctness bugs: stale closures, wrong/missing effect deps, key misuse, race conditions, unhandled promise rejection, duplicate EventSource, effect cleanup leaks, bad state updates' },
  { key: 'accessibility', desc: 'a11y (WCAG 2.1 AA): missing ARIA roles/labels, non-semantic clickable divs, no keyboard handlers/focus mgmt, missing alt text, poor contrast on dark theme, focus traps, missing focus-visible, unlabeled form controls' },
  { key: 'security', desc: 'frontend security: XSS (dangerouslySetInnerHTML with dynamic data), committed secrets/API keys, unsafe URL handling, sensitive data in localStorage, target=_blank without rel=noopener' },
  { key: 'performance', desc: 'frontend perf: needless re-renders, missing memoization on expensive work, keyless/broad query invalidation, no code-split, layout thrash, unbounded lists' },
  { key: 'quality', desc: 'code quality & type-safety: dead code, duplication, any-typed API responses, prop drilling, deep relative imports instead of @/, inconsistent conventions, refactor opportunities' },
  { key: 'tests', desc: 'test coverage gaps: critical components/flows untested, weak/tautological tests' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          area: { type: 'string', enum: ['backend', 'frontend', 'infra', 'docs'] },
          filePath: { type: 'string' },
          lineStart: { type: 'integer' },
          lineEnd: { type: 'integer' },
          lens: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['title', 'area', 'filePath', 'severity', 'description', 'lens'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    alreadyFixed: { type: 'boolean' },
    correctedFilePath: { type: 'string' },
    correctedLineStart: { type: 'integer' },
    correctedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    rationale: { type: 'string' },
  },
  required: ['confirmed', 'confidence', 'rationale'],
}

function finderPrompt(area, scope, lens, ctx) {
  return [
    'You are a meticulous senior ' + area + ' code auditor for the HIVE project.',
    'Working directory: ' + CODE,
    'SCOPE for this pass: ' + scope,
    'LENS: ' + lens.key + ' — ' + lens.desc,
    '',
    ctx,
    '',
    DELIBERATE,
    '',
    SCAN_RULES,
    '',
    'Exhaustively audit the files in your scope through your lens. Read the actual code. Find as many REAL issues as you can; every one must be verifiable at the cited line. Return findings via the structured schema. If a scope dir does not exist, return an empty findings array.',
  ].join('\n')
}

const TOOL_FINDERS = [
  { label: 'tool:be-clippy-test', prompt: 'Run the REAL backend toolchain and convert output to findings. In ' + CODE + '/back-end run, in order: (1) `cargo clippy --workspace --all-targets --message-format=short 2>&1` (this compiles — allow several minutes). (2) `cargo test --workspace --no-fail-fast 2>&1` (or `cargo nextest run` if available). Convert EACH clippy warning/error and EACH failing test into a finding with the exact file:line the tool reports. Compile errors=critical; correctness/perf clippy lints=high; style warnings=medium; failing tests=high (title = test name, description = the assertion/panic). Ignore passing tests. If cargo is unavailable, return one low finding saying so. Do NOT fix anything.' },
  { label: 'tool:fe-tsc-eslint-build', prompt: 'Run the REAL frontend toolchain and convert output to findings. In ' + CODE + '/front-end run, in order: (1) `npx tsc --noEmit 2>&1` — report EACH type error as a finding (file:line, severity high; these are real bugs even though strict mode is off). (2) `npm run lint 2>&1` — report each eslint error (high) / warning (medium); any jsx-a11y/* rule = high. (3) `npm run build 2>&1` — any build failure = critical. If node_modules is missing, return one low finding noting deps are not installed. Do NOT fix anything.' },
  { label: 'tool:fe-npm-audit', prompt: 'In ' + CODE + '/front-end run `npm audit --json 2>&1` (fall back to plain `npm audit` if json fails). Report each HIGH or CRITICAL advisory as a finding (title = package + advisory id, severity mapped). Skip low/moderate. If it cannot run, one low finding.' },
  { label: 'tool:secrets', prompt: 'Hunt committed secrets. In ' + CODE + ' run `gitleaks detect --no-banner --redact -v 2>&1` if installed; report each leak as a CRITICAL finding (file:line + rule). THEN regardless, run ripgrep for real secret shapes across src and crates (patterns: sk-[A-Za-z0-9], ghp_, github_pat_, AKIA[0-9A-Z], -----BEGIN [A-Z ]*PRIVATE KEY-----). EXCLUDE obvious demo placeholders that are already documented (sk-demo-*, ant-demo-*, gemini-demo-*) — note them as low, not critical. Return findings.' },
  { label: 'tool:trivy', prompt: 'In ' + CODE + ' run `trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --quiet . 2>&1` if trivy is installed. Report each HIGH/CRITICAL result as a finding with the file and rule. If trivy is not installed, return one low finding noting it was unavailable.' },
]

// ---------------- DISCOVER ----------------
phase('Discover')
const finderThunks = []
for (const t of BE_TARGETS) for (const l of BE_LENSES)
  finderThunks.push(() => agent(finderPrompt('backend', t.scope, l, BE_CTX),
    { label: 'find:be:' + t.label + ':' + l.key, phase: 'Discover', schema: FINDINGS_SCHEMA, agentType: 'Explore' }))
for (const t of FE_TARGETS) for (const l of FE_LENSES)
  finderThunks.push(() => agent(finderPrompt('frontend', t.scope, l, FE_CTX),
    { label: 'find:fe:' + t.label + ':' + l.key, phase: 'Discover', schema: FINDINGS_SCHEMA, agentType: 'Explore' }))
for (const tf of TOOL_FINDERS)
  finderThunks.push(() => agent(tf.prompt + '\n\n' + SCAN_RULES + '\nReturn results via the structured schema.',
    { label: tf.label, phase: 'Discover', schema: FINDINGS_SCHEMA, agentType: 'Explore' }))

log('Launching ' + finderThunks.length + ' discovery agents (' + (BE_TARGETS.length * BE_LENSES.length) + ' backend lens, ' + (FE_TARGETS.length * FE_LENSES.length) + ' frontend lens, ' + TOOL_FINDERS.length + ' real-tool)')
const rawResults = (await parallel(finderThunks)).filter(Boolean)
const allFindings = rawResults.flatMap(r => (r && Array.isArray(r.findings)) ? r.findings : [])
log('Discovery complete: ' + allFindings.length + ' raw findings')

// ---------------- DEDUP (deterministic) ----------------
function norm(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function keyOf(f) {
  const file = norm(f.filePath).replace(/\s+/g, '/')
  const lineBucket = f.lineStart ? Math.round(Number(f.lineStart) / 8) : 0
  return file + '|' + lineBucket + '|' + norm(f.lens)
}
const byKey = new Map()
for (const f of allFindings) {
  if (!f || !f.filePath || !f.title) continue
  const k = keyOf(f)
  const ex = byKey.get(k)
  if (!ex) { byKey.set(k, Object.assign({}, f, { dupes: 1 })) }
  else {
    ex.dupes++
    if ((ORDER[f.severity] || 0) > (ORDER[ex.severity] || 0)) ex.severity = f.severity
    if ((f.suggestedFix || '').length > (ex.suggestedFix || '').length) ex.suggestedFix = f.suggestedFix
  }
}
let candidates = [...byKey.values()].map((c, i) => Object.assign({ id: 'C' + String(i + 1).padStart(3, '0') }, c))
candidates.sort((a, b) => (ORDER[b.severity] || 0) - (ORDER[a.severity] || 0) || (b.dupes - a.dupes))
const VERIFY_CAP = 240
let dropped = 0
if (candidates.length > VERIFY_CAP) { dropped = candidates.length - VERIFY_CAP; candidates = candidates.slice(0, VERIFY_CAP) }
log('Dedup: ' + candidates.length + ' unique candidates' + (dropped ? (' (capped; ' + dropped + ' lowest-priority deferred)') : ''))

// ---------------- VERIFY (adversarial, multi-vote) ----------------
phase('Verify')
function verifyPrompt(c, n) {
  return [
    'Independently verify whether this reported issue is REAL and present in the code RIGHT NOW. Be adversarial: your DEFAULT is confirmed=false unless you see the problem with your own eyes.',
    'Repo dir: ' + CODE,
    'Issue ' + c.id + ' [' + c.severity + '/' + c.area + '/' + c.lens + ']: ' + c.title,
    'Claimed location: ' + c.filePath + (c.lineStart ? (' lines ' + c.lineStart + '-' + (c.lineEnd || c.lineStart)) : ''),
    'Description: ' + (c.description || ''),
    'Evidence claimed: ' + (c.evidence || ''),
    '',
    'Open the actual file, read the cited region AND surrounding context. Then decide:',
    '- confirmed=true ONLY if the described problem genuinely exists now at (or very near) the cited location.',
    '- alreadyFixed=true if the code already handles it (=> confirmed should be false).',
    '- If the line drifted, set correctedFilePath/correctedLineStart to the true location.',
    '- If it is actually a deliberate choice, confirmed=false. ' + DELIBERATE.split('\n').slice(1).join(' '),
    '- Adjust correctedSeverity if the claim was mis-rated.',
    'Give a one-paragraph rationale citing what you actually saw. (reviewer ' + n + ')',
  ].join('\n')
}
async function verifyOne(c) {
  const nVotes = c.severity === 'critical' ? 3 : c.severity === 'high' ? 2 : 1
  let votes
  if (nVotes === 1) {
    votes = [await agent(verifyPrompt(c, 1), { label: 'verify:' + c.id, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' })]
  } else {
    const idxs = Array.from({ length: nVotes }, (_, i) => i + 1)
    votes = await parallel(idxs.map(i => () => agent(verifyPrompt(c, i), { label: 'verify:' + c.id + ':' + i, phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' })))
  }
  const v = votes.filter(Boolean)
  if (!v.length) return Object.assign({}, c, { confirmed: false, votes: '0/0', verdictRationale: 'no verdict returned' })
  const yes = v.filter(x => x.confirmed && !x.alreadyFixed).length
  const confirmed = yes >= Math.ceil(v.length / 2)
  const cv = v.find(x => x.confirmed && !x.alreadyFixed) || v[0]
  return Object.assign({}, c, {
    confirmed,
    severity: cv.correctedSeverity || c.severity,
    filePath: cv.correctedFilePath || c.filePath,
    lineStart: cv.correctedLineStart || c.lineStart,
    verdictConfidence: cv.confidence,
    verdictRationale: cv.rationale,
    votes: yes + '/' + v.length,
  })
}
const verified = (await parallel(candidates.map(c => () => verifyOne(c)))).filter(Boolean)
const confirmed = verified.filter(x => x.confirmed)
const rejected = verified.filter(x => !x.confirmed)
confirmed.sort((a, b) => (ORDER[b.severity] || 0) - (ORDER[a.severity] || 0))
log('Verify complete: ' + confirmed.length + ' CONFIRMED, ' + rejected.length + ' rejected/hallucinated/already-fixed')

// ---------------- SYNTHESIZE (write report to disk) ----------------
phase('Synthesize')
const reportData = confirmed.map(c => ({ id: c.id, severity: c.severity, area: c.area, lens: c.lens, file: c.filePath, line: c.lineStart || null, title: c.title, description: c.description, suggestedFix: c.suggestedFix || '', votes: c.votes, confidence: c.verdictConfidence || '', rationale: c.verdictRationale || '' }))
const counts = { critical: confirmed.filter(c => c.severity === 'critical').length, high: confirmed.filter(c => c.severity === 'high').length, medium: confirmed.filter(c => c.severity === 'medium').length, low: confirmed.filter(c => c.severity === 'low').length }
await agent([
  'Write a polished master audit report to the file ' + OUT + '/MASTER_AUDIT_REPORT.md using the Write tool.',
  'This is the result of an exhaustive multi-agent audit of the HIVE codebase that already passed an adversarial anti-hallucination verification gate.',
  'Stats: raw findings=' + allFindings.length + ', unique candidates=' + candidates.length + ', CONFIRMED=' + confirmed.length + ', rejected=' + rejected.length + (dropped ? (', deferred (capped)=' + dropped) : '') + '.',
  'Confirmed counts: critical=' + counts.critical + ', high=' + counts.high + ', medium=' + counts.medium + ', low=' + counts.low + '.',
  'Here is the confirmed issue list as JSON:',
  JSON.stringify(reportData),
  '',
  'Structure the report: (1) Executive summary with the counts. (2) A note that these are post-verification, evidence-cited findings. (3) Sections grouped by area (backend, frontend, infra) then severity, each issue as a markdown subsection with id, file:line, severity, votes/confidence, description, and suggested fix. (4) A short "Relationship to existing backlog" note: the repo already tracks open items A.1-A.36 in HANDOFF_ISSUES.md (SSRF redirect A.1, Modules duplicate EventSource A.2, executor sync let _ A.7, allowlist intersection A.9, drift-hook defer A.5, audit gaps A.6/A.20, etc.) — call out which confirmed issues correspond to those known IDs vs which are NEW. Read HANDOFF_ISSUES.md if helpful. Use clean markdown tables for the index. Do not invent issues beyond the provided list.',
].join('\n'), { label: 'synthesize:report', phase: 'Synthesize' })

return { confirmedCount: confirmed.length, rejectedCount: rejected.length, deferred: dropped, counts, rawFindings: allFindings.length, uniqueCandidates: candidates.length, confirmed, rejected }
