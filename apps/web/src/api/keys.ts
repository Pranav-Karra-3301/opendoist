/** FROZEN TanStack Query key map (Task A). `['user-settings']` is the exact key
 *  phase 5's `useUserSettings` reuses. */
export const qk = {
  tasks: ['tasks'] as const,
  projects: ['projects'] as const,
  sections: ['sections'] as const,
  labels: ['labels'] as const,
  user: ['user'] as const,
  userSettings: ['user-settings'] as const,
  info: ['info'] as const,
  comments: (taskId: string) => ['comments', taskId] as const,
}
