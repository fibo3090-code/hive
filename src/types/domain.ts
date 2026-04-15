import type { components } from '@/api/generated';

export type Agent = components['schemas']['Agent'];
export type AgentStatus = Agent['status'];
export type Project = components['schemas']['Project'];
export type SovereigntyTier = Project['sovereigntyTier'];
export type SessionInfo = components['schemas']['SessionInfo'];
export type AlertItem = components['schemas']['AlertItem'];
export type AlertSeverity = AlertItem['severity'];
export type TaskItem = components['schemas']['TaskItem'];
export type Notification = components['schemas']['Notification'];
