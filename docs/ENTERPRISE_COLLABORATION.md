# HIVE Enterprise Collaboration

> Product and business evaluation for enterprise-only collaboration features:
> multiple employees sharing one project, watching shared agents live, approving
> actions, and governing agent work as a team. Last reviewed: 2026-06-20.

## Verdict

Enterprise collaboration is a strong business direction, but it should be framed
as **agent operations and governance**, not generic workplace chat.

Current score:

| Dimension | Rating | Rationale |
|---|---:|---|
| Business value | 8/10 | Enterprises pay for shared visibility, compliance, and control. |
| Immediate priority | 6/10 | Runtime, eval, sandbox, and audit foundations still need stabilization. |
| Mid-term differentiation | 9/10 | A governed shared control plane for agents is a real wedge. |
| Maintenance risk | High | Auth, realtime, permissions, audit, comments, and notifications form a full product surface. |

## Why It Fits HIVE

HIVE already has the right primitives:

- Persistent projects and agents.
- Agent task assignments.
- Shared project DB state.
- EventBus and SSE stream.
- Cost events.
- Drift events.
- Agent tools and sandbox permissions.
- Planned autonomous agent task loop.
- Existing audit-log direction, though coverage is incomplete.

The enterprise story is not "more chat". It is:

> Let a team safely operate a fleet of coding/research/build agents on shared
> projects, with visibility, approvals, auditability, and policy control.

## What Should Be Enterprise-Only

These are fair paid features because they solve organization problems:

- Organizations and shared workspaces.
- Multiple employees connected to the same project.
- Live shared agent operations dashboard.
- Shared run timelines and agent activity replay.
- Human approvals for risky actions.
- Comments and annotations on runs, tasks, drift events, and tool calls.
- Roles: owner, admin, operator, reviewer, viewer.
- Project-level, agent-level, tool-level, folder-level, and secret-level
  permissions.
- Organization policies for shell, Git, network, connectors, spend, and model
  usage.
- SSO/SAML/OIDC.
- SCIM user and group provisioning.
- Immutable audit logs.
- Audit export to CSV/JSON/SIEM.
- Private cloud, VPC, and air-gapped deployment.
- Enterprise integrations: Linear, Jira, GitHub Enterprise, Slack, Discord,
  PagerDuty, Datadog, Sentry, SIEM.

## What Should Not Be Enterprise-Only

Keep these in Community:

- Seeing live progress for your own local agents.
- Basic local logs.
- Running multiple agents locally.
- Local project dashboards.
- Local Git operations.
- Basic eval runs.
- Single-user approval prompts.
- Basic local notifications.

If these are gated, the community edition will feel artificially limited.

## First Paid Slice: Agent Operations Room

Do not start with a broad collaboration suite. Start with a narrow, sellable
surface:

1. Several employees can open the same project.
2. Everyone sees shared agents, tasks, cost, status, tool calls, and failures in
   real time.
3. Operators can approve or reject risky actions.
4. Reviewers can comment on runs and tasks.
5. Every human and agent action creates an audit event.
6. Permissions are initially simple: admin, operator, reviewer, viewer.

This gives enterprise buyers the control plane they want without building a
full Slack/Jira replacement.

## Suggested Data Model Foundations

Add these before a full UI if enterprise collaboration is planned:

- `organizations`
- `organization_members`
- `organization_roles`
- `project_members`
- `project_permissions`
- `agent_permissions`
- `tool_policies`
- `approval_requests`
- `approval_decisions`
- `run_comments`
- `audit_events`
- `presence_sessions`

The key design rule: every enterprise-visible action should have a durable
actor, subject, operation, timestamp, and before/after payload where practical.

## Permission Shape

Start simple and grow:

| Role | Capabilities |
|---|---|
| Owner | Billing, license, org policies, all project controls |
| Admin | Manage users, projects, agents, policies |
| Operator | Start/stop agents, approve common actions, assign tasks |
| Reviewer | View runs, comment, approve review-only gates |
| Viewer | Read-only dashboard and audit access |

Later, add ABAC/ReBAC-like policy conditions for:

- project sensitivity;
- path patterns;
- tool category;
- model/provider;
- spend threshold;
- network destination;
- connector kind;
- branch/environment.

## Enterprise Approval Gates

High-value approval gates:

- `shell_exec` with network-capable commands.
- Git push, force push, release tag, branch deletion.
- Connector creation or credential update.
- External HTTP/API calls outside allowlisted domains.
- File writes outside expected project paths.
- Budget extension.
- Model/provider changes on regulated projects.
- Public sharing, export, or marketplace publishing.

These gates turn agent risk into an enterprise feature.

## Risks

- **Scope creep:** Collaboration can become a full workplace suite.
- **Security burden:** Multi-user means real authentication, authorization,
  tenancy boundaries, audit integrity, and incident response.
- **Realtime complexity:** Presence and shared live state can create hard race
  conditions.
- **Support load:** Enterprise customers will expect reliability and migration
  support.
- **Community trust:** If too much basic visibility is paid-only, the OSS
  edition loses credibility.

## Build Order

1. Stabilize runtime, sandbox, evals, and audit coverage.
2. Add org/user/role schema behind a feature flag.
3. Add immutable `audit_events` as a first-class table.
4. Build `approval_requests` for risky actions.
5. Ship the Agent Operations Room with admin/operator/reviewer/viewer.
6. Add SSO/SCIM and SIEM exports.
7. Add comments, presence, and richer collaboration.

## Product Line Boundary

Recommended packaging:

- **Community:** solo local workspace.
- **Pro Cloud:** personal sync and hosted workers.
- **Team:** shared projects, comments, live dashboard.
- **Enterprise:** SSO, SCIM, RBAC, policies, approvals, audit exports, private
  deployment, and SLA.

This preserves the open-source core while making the enterprise value obvious.

