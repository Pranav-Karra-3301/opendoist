/** FROZEN TanStack Query key map (Task A). `['user-settings']` is the exact key
 *  phase 5's `useUserSettings` reuses. Phase 6 adds the reminder/push/channel/ical keys. */
export const qk = {
  tasks: ['tasks'] as const,
  projects: ['projects'] as const,
  sections: ['sections'] as const,
  labels: ['labels'] as const,
  user: ['user'] as const,
  userSettings: ['user-settings'] as const,
  info: ['info'] as const,
  comments: (taskId: string) => ['comments', taskId] as const,
  reminders: ['reminders'] as const,
  pushSubscriptions: ['push-subscriptions'] as const,
  channels: ['channels'] as const,
  icalToken: ['ical-token'] as const,
}
