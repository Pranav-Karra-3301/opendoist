/**
 * FINAL (phase 6 Task A Step 7) — shared push-state shape consumed by push/index.ts
 * (Task K) and the Notifications settings page (Task L). Do not extend.
 */
export interface PushState {
  supported: boolean
  permission: NotificationPermission
  subscribed: boolean
  ios: boolean
  standalone: boolean
}
