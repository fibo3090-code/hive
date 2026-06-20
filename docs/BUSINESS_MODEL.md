# HIVE Business Model

> Strategy note for keeping HIVE genuinely open-source while making the project
> commercially sustainable. Last reviewed: 2026-06-20.

## Positioning

HIVE should be sold as:

> Open-source, local-first AI agent workspace. Run it yourself forever. Pay for
> hosted reliability, enterprise governance, managed integrations, and
> production-grade agent observability.

The core promise is sovereignty. The business model must not make the free
local product feel like a crippled demo.

## Recommended Model

Use an open-source core plus paid convenience and enterprise trust.

1. **Community edition**
   - Local-first, self-hostable, usable by a solo developer.
   - Includes agents, local projects, Git, sandboxed tools, basic evals, basic
     logs, local dashboards, and standard integrations.
   - Should remain generous enough that users trust the project.

2. **Commercial license**
   - Offer a paid commercial license for companies that cannot accept a copyleft
     license.
   - Recommended default if legal review agrees: AGPLv3 for the community core,
     with a separate commercial license for proprietary embedding or hosted
     internal deployments that need different terms.
   - If the project instead chooses BSL/FSL/Fair Core, document clearly that the
     license is source-available/fair-source until conversion, not strict OSI
     open-source.

3. **Hive Cloud / Hive Relay**
   - Managed sync, backups, hosted workers, always-on agent runs,
     notifications, webhooks, and Discord/Slack/Linear/GitHub bridges.
   - Monetizes operational convenience without weakening the local version.

4. **Enterprise pack**
   - SSO/SAML/OIDC, SCIM, RBAC, org policies, audit export, approval workflows,
     air-gapped deployment, private cloud, SIEM exports, support SLA, and custom
     integrations.
   - This is the highest-value buyer segment because it converts security,
     compliance, and governance pain into budget.

5. **Marketplace**
   - Paid and free skills, agent templates, workflows, eval suites, connectors,
     and enterprise playbooks.
   - HIVE can take a 20-30% revenue share on paid artifacts while keeping
     community artifacts free.

## Pricing Sketch

| Plan | Suggested price | Buyer |
|---|---:|---|
| Community | Free | Solo devs, OSS users, local-first adopters |
| Pro Cloud | 15-25 EUR/user/month | Individuals and small teams wanting sync and managed workers |
| Team | 49-99 EUR/user/month | Teams sharing projects, approvals, and dashboards |
| Enterprise | 20k-150k EUR/year | Regulated or larger organizations needing governance and support |
| Marketplace | 20-30% commission | Skill, workflow, and connector ecosystem |

Exact pricing should wait until there is evidence from early users. Start with a
simple waitlist and founder-led sales before hardening billing.

## What Must Stay Free

Do not charge for the product's basic usefulness:

- Local solo usage.
- Local agent execution.
- Creating multiple agents.
- Viewing your own agent progress and logs.
- Git operations.
- LLM provider configuration.
- Basic local evals.
- Standard local project workflows.
- Core sandbox/tooling primitives.

Putting these behind a paywall would damage the sovereignty story.

## Good Paid Boundaries

Charge for things that organizations naturally value:

- Multi-user shared projects.
- Enterprise SSO, SCIM, and RBAC.
- Organization-wide policies.
- Approval workflows for risky agent actions.
- Immutable audit logs and compliance exports.
- Hosted workers and uptime.
- Managed backups and sync.
- Managed integrations with Discord, Slack, Linear, GitHub Enterprise, Jira,
  PagerDuty, Datadog, and SIEM systems.
- Air-gapped and private-cloud deployment support.
- Premium workflows, connectors, and eval suites.
- Human support and onboarding.

## Anti-Patterns

Avoid these traps:

- Gating the local-first core.
- Making collaboration paywalled before the solo experience is excellent.
- Building a full Slack/Jira/Notion clone instead of an agent operations room.
- Promising enterprise compliance before audit logs, permissions, and sandboxing
  are stable.
- Changing from a permissive/open license to a restrictive license after broad
  adoption without a clear trust plan.

## Near-Term Action Plan

1. Pick the licensing posture before external launch.
2. Add `COMMERCIAL.md` with contact, licensing intent, and what remains free.
3. Keep paid cloud/enterprise code in clearly separated modules or repos.
4. Start a Hive Cloud waitlist before building billing.
5. Validate willingness to pay with three offers:
   - Managed hosted workers.
   - Enterprise shared-project governance.
   - Premium integrations and support.

