/**
 * Settings page registry — FROZEN by Task A (plan Step 5). Task L renders it in
 * SettingsLayout + SettingsSearch; Task I adds one palette command per entry.
 * Pages are lazy default exports under ./pages/.
 */
import { type ComponentType, type LazyExoticComponent, lazy } from 'react'

export interface SettingsPageDef {
  key: string
  title: string
  keywords: string[]
  Component: LazyExoticComponent<ComponentType>
}
export const SETTINGS_PAGES: SettingsPageDef[] = [
  {
    key: 'account',
    title: 'Account',
    keywords: [
      'password',
      'email',
      'name',
      'totp',
      '2fa',
      'two-factor',
      'oidc',
      'sso',
      'delete account',
      'danger',
    ],
    Component: lazy(() => import('./pages/AccountPage')),
  },
  {
    key: 'general',
    title: 'General',
    keywords: [
      'home view',
      'timezone',
      'date format',
      'time format',
      'week start',
      'next week',
      'weekend',
      'smart date',
      'language',
    ],
    Component: lazy(() => import('./pages/GeneralPage')),
  },
  {
    key: 'theme',
    title: 'Theme',
    keywords: ['dark', 'appearance', 'color', 'kale', 'auto dark', 'sync theme'],
    Component: lazy(() => import('./pages/ThemePage')),
  },
  {
    key: 'sidebar',
    title: 'Sidebar',
    keywords: ['navigation', 'show', 'hide', 'counts', 'views'],
    Component: lazy(() => import('./pages/SidebarPage')),
  },
  {
    key: 'quick-add',
    title: 'Quick Add',
    keywords: ['chips', 'buttons', 'reorder', 'icons', 'labels'],
    Component: lazy(() => import('./pages/QuickAddPage')),
  },
  {
    key: 'productivity',
    title: 'Productivity',
    keywords: ['goal', 'daily', 'weekly', 'streak', 'days off', 'vacation', 'karma'],
    Component: lazy(() => import('./pages/ProductivityPage')),
  },
  {
    key: 'reminders',
    title: 'Reminders',
    keywords: ['automatic', 'offset', 'before', 'test notification'],
    Component: lazy(() => import('./pages/RemindersPage')),
  },
  {
    key: 'notifications',
    title: 'Notifications',
    keywords: ['push', 'ntfy', 'gotify', 'webhook', 'channels'],
    Component: lazy(() => import('./pages/NotificationsPage')),
  },
  {
    key: 'backups',
    title: 'Backups',
    keywords: ['backup', 'restore', 'download', 'retention'],
    Component: lazy(() => import('./pages/BackupsPage')),
  },
  {
    key: 'integrations',
    title: 'Integrations',
    keywords: [
      'api',
      'token',
      'developer',
      'openapi',
      'scalar',
      'calendar feed',
      'ical',
      'voice',
      'ramble',
      'speech',
      'stt',
      'transcription',
      'whisper',
      'deepgram',
      'elevenlabs',
      'llm',
      'ai',
      'extraction',
      'openai',
    ],
    Component: lazy(() => import('./pages/IntegrationsPage')),
  },
  {
    key: 'about',
    title: 'About',
    keywords: ['version', 'changelog', "what's new", 'update', 'release'],
    Component: lazy(() => import('./pages/AboutPage')),
  },
]
