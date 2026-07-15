# OpenDoist Research Dossier

> Consolidated research for building **OpenDoist** — a self-hosted, open-source Todoist alternative (TypeScript monorepo: API + React SPA + CLI + shared core). Merged from five research tracks: Todoist product spec, design tokens, TypeScript stack, self-hosted OSS field study, and notifications/calendar/voice pipelines. All versions, prices, and behaviors verified July 2026 unless noted. Compiled 2026-07-15.

## Contents

1. Todoist product spec (feature-parity target)
2. Design system: Todoist dissection + OpenDoist token spec
3. TypeScript stack (versions verified 2026-07-15)
4. Self-hosted OSS field study (10 projects)
5. Notifications, iCal feeds, voice→tasks
6. Key decisions & recommended defaults

---

## 1. Todoist product spec (feature-parity target)

### 1.1 Quick Add syntax

Quick Add opens with `Q` (global desktop: `Option+Space` / `Ctrl+Space`). Everything is typed into the task-name field; smart recognition highlights tokens as you type; clicking a highlighted token converts it back to plain text. Smart date recognition can be disabled globally ([Settings > General](https://www.todoist.com/help/articles/turn-smart-date-recognition-on-or-off-63WfIr)). Date parsing is unsupported in Czech and Turkish. Source: [Use Task Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz).

| Attribute | Syntax | Official examples / notes |
|---|---|---|
| Due date/time | plain natural language (no prefix) | `tomorrow at 4pm`, `every other Tuesday starting March 3` |
| **Deadline** | **`{natural language date}` in curly brackets** | `{march 30}`, `{next Friday}` |
| Duration | `for <length>` after a time | `Team meeting today 4pm for 45min`, `tomorrow at 10:00 AM for 25 minutes` (max 24h) — [Set a task duration](https://www.todoist.com/help/articles/set-a-task-duration-L1kYkZv8d) |
| Label | `@` + name | `@email` (autocompletes; can create new) |
| Priority | `p1`, `p2`, `p3` (`p4` = default/no priority) | `Submit report p1` |
| Reminder | `!` + time | `!14:00`, `!30 min before`; iOS urgent reminder `!{time}!` (Pro/Business) |
| Project | `#` + name | `#Work` |
| Section | `/` + name, after a project | `#Work /Admin` |
| Assignee | `+` + name (shared projects only; set `#project` first) | `+Lucile` |
| Description | **no inline token** — Quick Add "More actions" (`…`) menu → Description field ([help](https://www.todoist.com/help/articles/add-a-task-description-rOryWIHn)) | |
| Uncompletable task | task name starting with `* ` (asterisk + space) renders without a checkbox — [help](https://www.todoist.com/help/articles/create-an-uncompletable-task-in-todoist-QxQosZuF) | `* Flight check-in` |

Quick Add save keys: `Enter` saves + opens a new task below; `Ctrl+Enter` saves + creates above; `Shift+Enter` (on an existing task) saves and creates a new one below.

### 1.2 Natural-language dates

Source: [Introduction to dates and time](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO).

- **Shortcuts**: `tod`/`today`, `tom`/`tomorrow`, `27th` (this month's 27th), `mid January` (Jan 15), `end of month` (last day).
- **Relative**: `in 5 days` / `+5 days`, `in 3 weeks`, `next Friday`, `this weekend` (upcoming Saturday), `later this week`.
- **Times**: `tomorrow at 4 pm`, bare `6pm` (today if not yet passed, else tomorrow), `Fri @ 7pm` / `Fri at 1900` / `Fri at 19:00`, `in the morning` = 9:00, `in the afternoon` = 12:00, `in the evening` = 19:00, `tom morning`.
- **Compound**: `every 3rd Tuesday starting Aug 29 ending in 6 months`, `50 days before new year's eve`, `6 weeks before 21 Jul`.
- **Three due-date storage types** ([API docs](https://developer.todoist.com/api/v1/)): full-day date; **floating** time (default for times); time with fixed timezone.

### 1.3 Recurring-date grammar

Source: [Introduction to recurring dates](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV).

- `every` = next occurrence computed from the **original schedule**; `every!` = from the **completion date**. `after 10 days` is auto-converted to `every! 10 days`.
- **Basic**: `every day`/`daily`, `every weekday`/`every workday` (Mon–Fri), `every week`/`weekly`, `every month`/`monthly`, `every quarter`/`quarterly`, `every year`/`yearly`, `every hour`; `ev` shorthand (`ev monday, friday`).
- **Intervals**: `every 3 days`, `every 3 workday`, `every other day|week|month|year|fri`, `every! 3 hours`, `every 12 hours starting at 9pm`.
- **Positional**: `every 3rd friday`, `every last day`, `every 1st wed jan, 3rd thu jul`, `every 15th workday, first workday, last workday`.
- **Multiple**: `every mon, fri at 20:00`, `every 2, 15, 27` (days of month), `every 14 jan, 14 apr, 15 jun, 15 sep`.
- **Bounds**: `starting`/`from <date>`, `ending`/`until <date>` (inclusive), `for 3 weeks` — e.g. `everyday from 10 May until 20 May`.
- **Holiday words**: `new year day` (Jan 1), `valentine` (Feb 14), `halloween` (Oct 31), `new year eve` (Dec 31).
- **Not supported**: per-day different times (`every mon at 8pm, tue at 9pm`), "every X months on first Friday", exclusion rules ("except weekends").

### 1.4 Due date vs Deadline vs Reminder — semantics

- **Date (due)**: when you *plan to work* on the task. Drives Today/Upcoming placement, can be recurring, can carry a time + duration (time-blocking). Rolls forward on each recurrence.
- **Deadline**: the *hard completion cutoff* ("dates schedule when you plan to work on a task, deadlines represent the hard cutoff"). Pro/Business only. Date-only (no time): API shape `{"date": "YYYY-MM-DD", "lang": "en"}`. Explicitly recommended *not* to combine with recurring dates. Filterable via `deadline:` queries. ([Introduction to deadlines](https://www.todoist.com/help/articles/introduction-to-deadlines-uMqbSLM6U))
- **Reminder**: a notification (push/desktop/email) at a moment or place; never moves the task or affects views.

### 1.5 Reminders

Source: [Introduction to reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU).

- **Automatic reminders**: added by default whenever a task gets a date *with time*; default offset **30 minutes before**; configurable in Settings > Reminders → "Automatic reminders" (choose how long before, or "No automatic reminder" to disable). User field `auto_reminder` in minutes; 0 = at task time.
- **Custom/relative**: N minutes/hours before due time (requires task time). Sync API stores `type: "relative"` + `minute_offset`.
- **Absolute**: specific date + time (`type: "absolute"`, uses a due object with time; full-day reminders not allowed).
- **Recurring reminders**: `!every 5pm`, `ev Tuesday 7:00`.
- **Location reminders**: trigger `on_enter`/`on_leave` of a saved location (`loc_lat`, `loc_long`, `loc_trigger`, `radius`).
- Quick Add `!` examples: `!14:00`, `!30 min before`.
- In shared projects a reminder can be assigned to a specific collaborator (`notify_uid`).
- Channels: desktop notification, mobile push, email (per Settings > Notifications).
- Plan gating: multiple custom reminders per task = Pro/Business; free plan gets at-due-time reminders (`reminders_at_due: true`, `reminders: false` in free `user_plan_limits`); limits `max_reminders_time: 700`, `max_reminders_location: 300` ([API docs](https://developer.todoist.com/api/v1/)).

### 1.6 Web-app keyboard shortcuts (complete)

Source: [Use keyboard shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2) (full "Web" tables; Cmd on macOS = Ctrl on Windows).

**General**

| Keys | Action |
|---|---|
| `Q` | Quick Add |
| `/` or `F` | Search |
| `Esc` | Dismiss/cancel |
| `M` | Open/close sidebar |
| `?` | Show shortcuts |
| `Cmd/Ctrl+K` | Quick Find (command menu) |
| `Cmd/Ctrl+P` | Print view |
| `Cmd/Ctrl+=` / `Cmd/Ctrl+-` / `Cmd/Ctrl+0` | Zoom in / zoom out / reset zoom |
| `Cmd+Option+0` / `Ctrl+Alt+0` | Collapse/expand all sections & subtasks |

**Navigation**

| Keys | Action |
|---|---|
| `Shift+G` | Open task in its project |
| `Tab` / `Shift+Tab` | Move focus in task view |
| `O then P` | Productivity |
| `O then H` | Help |
| `O then N` | Notifications |
| `O then U` | Profile menu |
| `O then S` | Settings |
| `O then T` | Theme |
| `K` / `↑` | Focus up |
| `J` / `↓` | Focus down |
| `→` / `←` | Focus right / left |
| `H` or `G then H` | Home |
| `G then I` | Inbox |
| `G then T` | Today |
| `G then U` | Upcoming |
| `G then L` | Labels |
| `G then P` | Projects |
| `G then /` | Section |
| `G then A` | Reporting |
| `G then V` | Filters & Labels |
| `Cmd+[`/`Cmd+]` or `Alt+←`/`Alt+→` | Back / forward (desktop app) |

**Create tasks**

| Keys | Action |
|---|---|
| `A` | Add task at bottom of list |
| `Shift+A` | Add task at top |
| `Enter` | Save new task + new below |
| `Shift+Enter` | Save existing task + new below |
| `Ctrl+Enter` | Save + create above |
| `Cmd/Ctrl+V` | In a project: paste a file as new task with attachment |

**Manage tasks**

| Keys | Action |
|---|---|
| `E` | Complete focused task |
| `Shift+Click` checkbox | Complete & archive recurring task |
| `Enter` | Open task view |
| `Cmd/Ctrl+E` or `Option/Alt+Click` | Edit task |
| `Cmd/Ctrl+Enter` | Save edits |
| `Esc` | Close task view |
| `T` | Set date (opens scheduler) |
| `Shift+T` | Remove date |
| `1` `2` `3` `4` | Set priority |
| `Y` | Change priority |
| `C` | Comment |
| `L` | Add label |
| `Shift+R` | Assign/reassign |
| `V` | Move to… (project) |
| `.` | More task actions |
| `X` or `Cmd/Ctrl+Click` | Select task |
| `Cmd/Ctrl+Click` / `Shift+Click` | Multi-select |
| `,` | Focus multi-select toolbar |
| `Cmd+Delete` (mac) / `Shift+Delete` (win) | Delete selected |
| `Shift+Cmd/Ctrl+C` | Copy task link |
| `Cmd/Ctrl+↑` / `Cmd/Ctrl+↓` | Move to task above/below while editing |

**Sort (in view)**: `D` by date · `P` by priority · `N` by name (alphabetical) · `R` by assignee.

**Sub-tasks**: `Ctrl+]` indent · `Ctrl+[` un-indent (needs physical `[`/`]` keys) · `Shift+E` show/hide sub-tasks.

**Project**: `Shift+V` change layout (list/board/calendar; calendar = Pro/Business) · `S` add section · `Shift+S` share project · `W` more project actions · sorting keys as above.

**Upcoming view**: `Option+Shift+Y` (mac) / `Home` (win) go to today · `Shift+→` next week · `Shift+←` previous week.

**Calendar layout**: `T` (or `Shift+Option+Y`) back to today · `Shift+→`/`Shift+←` next/previous week.

**Desktop-only**: global Quick Add `Option+Space` / `Ctrl+Space`; Quick Ramble `Option+Shift+R` / `Alt+Shift+R`; show/hide app `Cmd+Ctrl+T` / `Win+Alt+S`; multi-window: `Shift+Cmd/Ctrl+N` current view in new window, `Shift+Option+Cmd+N` / `Shift+Alt+Ctrl+N` new Home window, `Option+Cmd+F` / `Ctrl+F11` float on top; macOS `Cmd+1/2/3` Inbox/Today/Upcoming, `Cmd+4/5` project/label-filter lists, `Shift+Cmd+P/L/F` new project/label/filter, `Cmd+,` settings, `Cmd+S` manual sync, `Cmd+N` Quick Add.

Note: there are **no** single-key "t = today / w = weekend" scheduler shortcuts; `T` opens the scheduler and you type natural language (scheduler also shows preset buttons Today / Tomorrow / Next week / Next weekend).

### 1.7 Filter query language

Source: [Introduction to filters](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH).

**Operators**: `&` AND · `|` OR · `!` NOT · `()` grouping · `,` splits one filter into multiple list panes ("multiple queries") · `\` escapes literal chars (`#One \& Two`) · `*` wildcard (`@home*`).

- **Dates**: `today`, `tomorrow`, `yesterday` · `date: Jan 3`, `date: 10/5/2022` · `date before: May 5`, `date after: May 5` (aliases `due before:`/`due after:`) · time-of-day comparisons `date: today & date before: today at 2pm` · `no date`, `!no date` · `no time`, `!no time` · `overdue` (alias `od`) · `3 days` / `next 5 days` · `next week`, `date before: next week`, `date before: sat` · `recurring`, `!recurring`.
- **Deadlines**: `deadline: today`, `deadline before: <date>`, `deadline after: <date>`, `no deadline`, `!no deadline`.
- **Created**: `created: Jan 3 2023`, `created: today`, `created before: -365 days`, `created after: -365 days`.
- **Priority**: `p1` `p2` `p3` `p4`, `no priority`.
- **Labels**: `@email`, `no labels`, wildcard `@home*`.
- **Projects/sections**: `#Work` (project only) · `##Work` (project + sub-projects; also matches team folders) · `##School & !#Science` · `/Meetings` section scoping: `#Work & /Meetings`; `/#Meetings` = sections named Meetings across projects · `!/*` tasks not in any section.
- **People**: `assigned` · `assigned to: me` / `assigned to: others` / `assigned to: Denise` · `!assigned to: others` · `assigned by: me` / `assigned by: Steve Gray` · `added by: me` / `added by: Becky` · `shared`.
- **Content/type**: `search: Meeting`, `search: http` (combinable: `search: Meeting & today`) · `subtask`, `!subtask` · `uncompletable` · `view all`.
- **Workspace**: `workspace: My projects`, `workspace: Doist | workspace: Halist`.

**Canonical examples**: `(today | overdue) & #Work` · `(P1 | P2) & 14 days` · `#Inbox & no date, All & !#Inbox & !no date` · `Saturday & @night` · `#Work & assigned to: me`.

Filter objects: `{id, name, query, color, item_order, is_favorite}`; free plan `max_filters: 3`, paid 150.

### 1.8 Views & settings inventory

- **Today** ([help](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs)): all tasks dated today + an Overdue section with a `Reschedule` button; in list layout, dragging a task to the bottom of Today postpones it to tomorrow.
- **Upcoming** ([help](https://www.todoist.com/help/articles/plan-your-week-with-the-upcoming-view-OKOg1mR8)): infinite-scroll day list + week picker at top; drag-and-drop between days to reschedule; overdue block with `Reschedule` at top-right; `Shift+←/→` week paging.
- **Per-view Display menu** ([Customize views](https://www.todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ)): Layouts = **List, Board, Day calendar, Week calendar, Month calendar** (calendar layouts Pro/Business); Group by; Sort by (alphabetical, assignee, date, date added, priority, project); Filter by assignee/date/deadline/priority/label/workspace; completed-tasks toggle; "Save for everyone" in shared projects; orange dot marks unsaved view changes.
- **Filters & Labels** (`G then V`): lists saved filters (favorites pinnable) and labels.
- **Reporting** (`G then A`, [help](https://www.todoist.com/help/articles/view-reporting-in-todoist-oOra6D)): activity log with event types (added/edited/completed/uncompleted/deleted tasks, projects, labels, comments…), filters by project/person/event type/workspace/date range, presets (All activity, My completed tasks, Recently added/completed), markdown export. Free-plan history = 7 days (`activity_log_limit: 7`). Completed tasks also inline per project via Display → Completed tasks ([help](https://www.todoist.com/help/articles/view-completed-tasks-in-todoist-J19h2s)).

**Settings pages**:

- **General**: Language; **Home view** (start page: Inbox/Today/Upcoming or any project/label/filter; mobile has "Sync Home view") ([help](https://www.todoist.com/help/articles/change-your-home-view-OKOgnH4r)); Time zone; Date format (`DD-MM-YYYY` vs `MM-DD-YYYY`, user field `date_format` 0/1); Time format (24h `13:00` vs `1:00pm`, `time_format` 0/1); Week start (`start_day` 1–7); **Next week** day (`next_week`); **Weekend** day (`weekend_start_day`); Smart date recognition toggle.
- **Theme** ([help](https://www.todoist.com/help/articles/change-color-themes-zD0N5K)): 8 themes (§2.5), **Auto Dark Theme** toggle (follows OS), **Sync theme** across devices toggle; Karma "Enlightened" unlocks a mystery theme.
- **Sidebar** ([help](https://www.todoist.com/help/articles/customize-the-sidebar-in-todoist-S9JLTYqZV)): "Show in sidebar" show/hide each view (Inbox, Today, Upcoming, Filters & Labels…), "Show the task count" toggle; below sit Favorites, personal projects, team projects.
- **Quick Add** ([help](https://www.todoist.com/help/articles/customize-quick-add-in-todoist-eqRRlZJNN)): choose which of 8 action buttons show (**priority, date, deadline, assignee, reminders, labels, location, attachment**), reorder them, icons-only vs labeled; hidden ones stay reachable via `…`; syncs across platforms.
- **Productivity / Karma** ([Karma](https://www.todoist.com/help/articles/introduction-to-karma-OgWkWy), [Productivity view](https://www.todoist.com/help/articles/use-the-productivity-view-in-todoist-6S63uAa9)): daily goal (default **5**), weekly goal (default **25**); **days off** (e.g. `days_off: [6,7]` = Sat/Sun, excluded from streaks); **vacation mode** toggle (goals paused, streaks preserved; [help](https://www.todoist.com/help/articles/turn-on-or-off-vacation-mode-in-todoist-pAQmRp)); karma on/off. Karma earned for adding tasks, completing on time, using advanced features (labels/recurring/reminders), hitting goals & streaks; lost when tasks are ≥4 days overdue; exact point values undocumented. Levels: Beginner 0–499, Novice 500–2,499, Intermediate 2,500–4,999, Professional 5,000–7,499, Expert 7,500–9,999, Master 10,000–19,999, Grand Master 20,000–49,999, Enlightened 50,000+. Support can restore streaks (max 3×) or reset karma to 50.
- **Reminders**: "Automatic reminders" offset menu (default 30 min before; `auto_reminder` user field in minutes, 0 = at task time; "No automatic reminder" disables).
- **Notifications** ([help](https://www.todoist.com/help/articles/manage-your-notifications-in-todoist-QxQGXkMu)): desktop/web = single on/off; email + mobile push per activity — shared-project events (comments for you, tasks assigned to you, task completed/uncompleted, project archived, invite accepted/declined, collaborator left/removed), workspace events, mobile-only (morning overview, evening review, goal celebrations), emails (daily digest, what's new, tips, new login alert). No SMS.
- **Backups** ([help](https://www.todoist.com/help/articles/download-or-restore-backups-in-todoist-ywaJeQbN)): paid plans; automatic full backup on each active day; up to **21** retained; ZIP of per-project **CSV** files; downloadable/restorable from Settings > Backups (API: `GET /api/v1/backups`, scope `backups:read`).
- **Calendars** ([Calendar integration](https://www.todoist.com/help/articles/use-the-calendar-integration-rCqwLCt3G), [Calendar feed](https://www.todoist.com/help/articles/add-a-todoist-calendar-feed-pAk3tk)): Google or Outlook (one provider/account at a time). Events show read-only in Today/Upcoming; "sync tasks to calendar" pushes tasks with time/duration (+ optional all-day) into a new **"Todoist" calendar**, rescheduling syncs back. Plus legacy **iCal feeds**: account-wide "Calendar subscription URL" (Settings > Calendars → Copy link) and per-project feed (project `…` → Project calendar feed → Copy link / Generate new feed); one-way, refresh cadence depends on the calendar client.

### 1.9 Todoist API v1 (design reference)

Docs: [https://developer.todoist.com/api/v1/](https://developer.todoist.com/api/v1/) — the 2024+ **unified API v1** merges REST v2 + Sync v9. Base URL `https://api.todoist.com/api/v1`.

- **Auth**: `Authorization: Bearer <token>` (personal token from integrations settings, or OAuth). Scopes: `task:add`, `data:read`, `data:read_write`, `data:delete`, `project:delete`, `backups:read`.
- **IDs**: opaque strings (`"6X7rM8997g3RQmvh"`); v9 numeric IDs deprecated (migration section documents renames).
- **Pagination**: cursor-based on all list endpoints — request `?cursor=&limit=` (limit 1–500, default ~50–100 per endpoint), response `{"results": [...], "next_cursor": "..."}` (null when done; some endpoints also `has_more`).
- **REST resources**: `/tasks` (+ `/tasks/filter` by query, `/tasks/completed`), `/projects` (+ archived), `/sections`, `/labels` (+ shared labels), `/comments`, `/reminders`, `/backups`, `/uploads`, `/activities`, `/user`, `/workspaces`, `/webhooks`. Create-task accepts `content`, `description`, `project_id`, `section_id`, `parent_id`, `order`, `labels` (names), `priority`, `assignee_id`, `due_string`/`due_date`/`due_datetime`/`due_lang`, `deadline_date`, `deadline_lang`, `duration` + `duration_unit`.
- **Task (item) object**: `id, user_id, project_id, content` (markdown), `description, due, deadline, priority` (int 1–4 where **4 = UI p1**: "very urgent is the priority 1 on clients. So, p1 will return 4 in the API"), `parent_id, child_order, section_id, day_order, is_collapsed, labels[], added_by_uid, assigned_by_uid, responsible_uid, checked, is_deleted, added_at, updated_at, completed_at, completed_by_uid, duration`.
- **Due object**: `{date: "YYYY-MM-DD" | RFC3339 datetime, timezone: null | "America/Chicago", string: "every day", lang: "en|da|pl|zh|ko|de|pt|ja|it|fr|sv|ru|es|nl|fi|nb|tw", is_recurring: bool}` — the `string` is re-parsed to compute next occurrences. **Deadline object**: `{date: "YYYY-MM-DD", lang}`. **Duration**: `{amount: int > 0, unit: "minute"|"day"}`.
- **Project object**: `id, name, description, color, parent_id, child_order, is_collapsed, shared, can_assign_tasks, is_deleted, is_archived, is_favorite, view_style ("list"|"board"|"calendar"), inbox_project, folder_id, workspace_id, status, role, created_at, updated_at`. **Section**: `id, name, project_id, section_order, is_collapsed, is_archived, archived_at, added_at`. **Label**: `id, name, color, item_order, is_deleted, is_favorite` (+ shared labels = plain names on tasks). **Filter**: `id, name, query, color, item_order, is_favorite, is_frozen`. **Comment (note)**: content + `file_attachment {file_name, file_size, file_type, file_url, upload_state}`, reactions. **Reminder**: `id, notify_uid, item_id, type: "relative"|"absolute"|"location", due, minute_offset, name, loc_lat, loc_long, loc_trigger: "on_enter"|"on_leave", radius, is_deleted`.
- **Sync API**: `POST /api/v1/sync` with `sync_token` (`*` = full sync, then incremental tokens), `resource_types` (`["all"]` or any of `labels, projects, items, notes, sections, filters, reminders, reminders_location, locations, user, live_notifications, collaborators, user_settings, notification_settings, user_plan_limits, completed_info, stats, workspaces, view_options, …`; `-name` excludes). Writes = `commands` array `{type: "item_add", uuid, temp_id, args}`; response has `sync_status` per-uuid (`"ok"` or error object) + `temp_id_mapping`; up to **100 commands per batch**. Rate limits: **1000 partial-sync + 100 full-sync requests / user / 15 min**; 1 MiB POST body cap; 15 s standard timeout.
- **User object** (settings-relevant fields): `auto_reminder` (minutes, 0 = at due time), `daily_goal` / `weekly_goal`, `days_off [1-7]`, `start_day`, `next_week`, `weekend_start_day`, `start_page` (e.g. `"project?id=…"`), `theme_id`, `date_format`, `time_format`, `lang`, `tz_info {timezone, gmt_string, hours, minutes, is_dst}`, `karma`, `karma_trend`, `premium_status`, `inbox_project_id`.
- **Plan limits** (`user_plan_limits`, free-plan example from docs): `max_projects: 5`, `max_sections: 20`, `max_tasks: 300` (per project), `max_filters: 3`, `max_labels: 500`, `max_collaborators: 5`, `max_reminders_time: 700`, `max_reminders_location: 300`, `upload_limit_mb: 5`, `activity_log_limit: 7`, `automatic_backups: false`, `reminders: false` but `reminders_at_due: true`, plus `deadlines/durations/calendar_layout` flags.
- **Webhooks**: HTTPS callbacks on events (item added/updated/completed etc.) configured per OAuth app.

**Section 1 sources**: [Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz) · [Dates & time](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO) · [Recurring dates](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV) · [Deadlines](https://www.todoist.com/help/articles/introduction-to-deadlines-uMqbSLM6U) · [Durations](https://www.todoist.com/help/articles/set-a-task-duration-L1kYkZv8d) · [Reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU) · [Keyboard shortcuts](https://www.todoist.com/help/articles/use-keyboard-shortcuts-in-todoist-Wyovn2) · [Filters](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH) · [Today](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs) · [Upcoming](https://www.todoist.com/help/articles/plan-your-week-with-the-upcoming-view-OKOg1mR8) · [Customize views](https://www.todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ) · [Reporting](https://www.todoist.com/help/articles/view-reporting-in-todoist-oOra6D) · [Completed tasks](https://www.todoist.com/help/articles/view-completed-tasks-in-todoist-J19h2s) · [Productivity view](https://www.todoist.com/help/articles/use-the-productivity-view-in-todoist-6S63uAa9) · [Karma](https://www.todoist.com/help/articles/introduction-to-karma-OgWkWy) · [Vacation mode](https://www.todoist.com/help/articles/turn-on-or-off-vacation-mode-in-todoist-pAQmRp) · [Home view](https://www.todoist.com/help/articles/change-your-home-view-OKOgnH4r) · [Smart date recognition](https://www.todoist.com/help/articles/turn-smart-date-recognition-on-or-off-63WfIr) · [Themes](https://www.todoist.com/help/articles/change-color-themes-zD0N5K) · [Sidebar](https://www.todoist.com/help/articles/customize-the-sidebar-in-todoist-S9JLTYqZV) · [Quick Add customization](https://www.todoist.com/help/articles/customize-quick-add-in-todoist-eqRRlZJNN) · [Notifications](https://www.todoist.com/help/articles/manage-your-notifications-in-todoist-QxQGXkMu) · [Backups](https://www.todoist.com/help/articles/download-or-restore-backups-in-todoist-ywaJeQbN) · [Calendar integration](https://www.todoist.com/help/articles/use-the-calendar-integration-rCqwLCt3G) · [Calendar feeds](https://www.todoist.com/help/articles/add-a-todoist-calendar-feed-pAk3tk) · [Uncompletable tasks](https://www.todoist.com/help/articles/create-an-uncompletable-task-in-todoist-QxQosZuF) · [Todoist API docs](https://developer.todoist.com/api/v1/)

---

## 2. Design system: Todoist dissection + OpenDoist token spec

Hard values pulled from: (a) Doist's open-source design system [reactist `design-tokens.css`](https://github.com/Doist/reactist/blob/main/src/styles/design-tokens.css) and [`button.module.css`](https://github.com/Doist/reactist/blob/main/src/button/button.module.css); (b) a high-fidelity clone that copied Todoist web's computed theme CSS verbatim ([nickau309/todo-list `globals.css`](https://github.com/nickau309/todo-list/blob/main/src/app/globals.css) — contains all 8 `theme_*` blocks); (c) the official API colors table ([developer.todoist.com/api/v1](https://developer.todoist.com/api/v1/), mirror: [shayonpal/mcp-todoist docs](https://github.com/shayonpal/mcp-todoist/blob/main/docs/todoist-api-v1-documentation.md)); (d) the [Todoist themes help article](https://www.todoist.com/help/articles/change-color-themes-zD0N5K). Items marked **(derived)** are recommendations, not verified Todoist values.

### 2.1 Typography (verified)

- **Font stack** (reactist): `-apple-system, system-ui, "Segoe UI", Roboto, Noto, Oxygen-Sans, Ubuntu, Cantrell, "Helvetica Neue", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`. Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "Liberation Mono", "Courier New", monospace`.
- **Type scale** (reactist): caption **12px**, copy **13px**, body **14px**, subtitle **16px**, header **20px**, header-large **24px**, header-xlarge **32px**.
- **Weights**: regular **400**, medium **600**, strong **700** (Todoist "medium" is semibold 600 — no 500).
- In-app usage (clone): task name 14px; task description 13px; meta/date/labels 12px; sidebar items `14px/17px`; view title `20px` bold (`text-xl/tight`); settings h1 20px/24.8; auth h1 32px/40.8; PRO badge `10px/13px bold uppercase tracking-widest`. Dark theme adds letter-spacing `0.0065em`.

### 2.2 Spacing, radii, layout (verified)

- **Spacing scale** (reactist): **4 / 8 / 12 / 16 / 24 / 32** (xsmall→xxlarge). App layout is a 4px grid with deliberate 5px quirks: sidebar rows `padding: 5px`, task row `padding: 8px 38px 8px 5px`, checkbox→text gap **6px**, name→meta gap **3px**.
- **Radii**: exactly two in reactist — **small 5px** (buttons, inputs, chips, sidebar/task rows, menu items) and **large 10px** (cards, dialogs, dropdowns, quick-add). Badges 3px. Checkbox = full circle. Buttons are **5px**, not 10.
- **Layout metrics**: sidebar default **280px**, resizable **210–420px**, slide transition `300ms cubic-bezier(0.4, 0, 0.2, 1)`; list content column `max-width: 800px`; task-detail modal side panel 260px.

### 2.3 Task row & checkbox (verified)

- Row: min-height **~42px** (skeleton `h-[42px]`), `py-8px`, radius 5px, checkbox column **24px** (hit area) containing an **18px circle**, 1px divider between rows (`#f5f5f5` light).
- **Checkbox circle**: 18px; border **2px** in priority color for P1–P3, **1px** grey for P4; unchecked P1–P3 have priority-color fill at **10% opacity → 20% on hover**; hover previews the check glyph in priority color; checked = solid priority fill + white check; animation **250ms linear** (scale+fade).

### 2.4 Priority colors (verified from app CSS)

| | Light idle | Light disabled | Dark idle |
|---|---|---|---|
| P1 | `#d1453b` | `#edb5b1` | `#ff7066` |
| P2 | `#eb8909` | `#f7d09d` | `#ff9a13` |
| P3 | `#246fe0` | `#a7c5f3` | `#5297ff` |
| P4 | `#999999` (legacy alias `#666666`) | `#d6d6d6` | `#a9a9a9` |

Corroborated by independent codebases, e.g. [BLamy/broken-todolist](https://github.com/BLamy/broken-todolist), [romgrk/todoist.nvim](https://github.com/romgrk/todoist.nvim). Priority *flag* icons use the same colors; product-spec capture listed p4 flag as `#666666`.

### 2.5 The 8 Todoist themes (verified per-theme accent CSS)

**Only "Dark" is a dark scheme.** All 7 others are white-canvas (`--background-base-primary: #fff`) with a tinted sidebar. Free: Todoist, Dark, Moonstone, Tangerine; Pro: Kale, Blueberry, Lavender, Raspberry. Auto-dark = OS-synced switch to the Dark theme ([help](https://www.todoist.com/help/articles/change-color-themes-zD0N5K)).

| Theme | Plan | Scheme | Accent | Accent hover | Sidebar bg | Sidebar hover | Selected bg | Selected text | Accent-soft | Theme-card swatch |
|---|---|---|---|---|---|---|---|---|---|---|
| Todoist | Free | light | `#dc4c3e` | `#c3392c` | `#fcfaf8` | `#f2efed` | `#ffefe5` | `#a81f00` | `#fde7d8` | `#dc4c3e` |
| Dark | Free | dark | `#de4c4a` | `#e36564` | `#262626` | `#322f2a` | `#472525` | `#f07f75` | `#6f2625` | `#bd4337` (app bg `#1e1e1e`) |
| Moonstone | Free | light | `#39485e` | `#323f51` | `#fafafa` | `#efeff1` | `#e0e2e5` | `#39485e` | `#e0e2e5` | `#4a5462` |
| Tangerine | Free | light | `#d68400` | `#995e00` | `#fcfcf8` | `#f4f1eb` | `#fff3d6` | `#995e00` | `#fdecdc` | `#d68400` |
| **Kale** | Pro | light | **`#4c7a45`** | **`#3e6737`** | `#fcfcf8` | `#f2f2e9` | `#f0f6df` | `#3e6737` | `#e8f1d0` | `#4c7a45` |
| Blueberry | Pro | light | `#297abc` | `#246498` | `#f8fafb` | `#eef2f6` | `#dfedfb` | `#1e5480` | `#d6e5f3` | `#3669ba` |
| Lavender | Pro | light | `#766bbd` | `#51459f` | `#f9f9fa` | `#ededf2` | `#e9e5f5` | `#4d447e` | `#e8e3f4` | `#766bbd` |
| Raspberry | Pro | light | `#c5496c` | `#8c213f` | `#fbf8f8` | `#f2ecf0` | `#f8e2e7` | `#8c213f` | `#f8e2e7` | `#c94f71` |

> Variant capture note: an earlier read of the same CSS mirror recorded slightly different sidebar/selected values — Todoist sidebar `#fcf9f9` / selected `#fee6e3`; Dark sidebar `#282828` / selected `#4f2929`; Moonstone sidebar `#f8f9fc`; Tangerine sidebar `#fcf9f8` / selected `#feebe3`; Kale sidebar `#f9faf8` / selected `#ecf2dd`; Blueberry sidebar `#f8fafc` / selected `#e3f2fe`; Lavender sidebar `#f9f9fc` / selected `#f1eeff`; Raspberry sidebar `#fbf9f9` / selected `#ffeaef`. Treat the full theme-block table above as canonical.

Per-theme extras: primary-button disabled fill (Kale `#a5bca2`), unselected radio `#b3b3b3`. **Dark surfaces**: app bg `#1e1e1e`, sidebar `#262626`, raised (menus/cards) `#282828`, tooltip/toast `#404040`; text `#fff` / `#ccc` / `#808080`; dividers `#3d3d3d` / `#282828`; inputs idle `#3d3d3d`, focus `#707070`. **Light**: text `#202020` / `#666` / `#999`; dividers `#eee` / `#f5f5f5`; inputs idle `#e6e6e6`, focus `#b8b8b8`.

Contrast: white on Kale `#4c7a45` = **4.59:1** (passes AA for text and UI) — safe as a filled-button color.

### 2.6 Project/label/filter color palette

**Current official API table** (IDs 30–49; API accepts the `name` string; tuned for readability on white). Appears identically in the API docs and design capture:

| ID | name | hex | ID | name | hex |
|---|---|---|---|---|---|
| 30 | `berry_red` | `#B8255F` | 40 | `light_blue` | `#6988A4` |
| 31 | `red` | `#DC4C3E` | 41 | `blue` | `#4180FF` |
| 32 | `orange` | `#C77100` | 42 | `grape` | `#692EC2` |
| 33 | `yellow` | `#B29104` | 43 | `violet` | `#CA3FEE` |
| 34 | `olive_green` | `#949C31` | 44 | `lavender` | `#A4698C` |
| 35 | `lime_green` | `#65A33A` | 45 | `magenta` | `#E05095` |
| 36 | `green` | `#369307` | 46 | `salmon` | `#C9766F` |
| 37 | `mint_green` | `#42A393` | 47 | `charcoal` | `#808080` |
| 38 | `teal` | `#148FAD` | 48 | `grey` | `#999999` |
| 39 | `sky_blue` | `#319DC0` | 49 | `taupe` | `#8F7A69` |

**Legacy vivid palette** (Sync v9 era; still what most people mean by "Todoist colors"; verified across [todoist-board](https://github.com/propranolol11/todoist-board/blob/main/src/constants.ts), [todoist-api-colors](https://github.com/lkostrowski/todoist-api-colors)): `berry_red #b8256f, red #db4035, orange #ff9933, yellow #fad000, olive_green #afb83b, lime_green #7ecc49, green #299438, mint_green #6accbc, teal #158fad, sky_blue #14aaf5, light_blue #96c3eb, blue #4073ff, grape #884dff, violet #af38eb, lavender #eb96eb, magenta #e05194, salmon #ff8d85, charcoal #808080, grey #b8b8b8, taupe #ccac93`.

**Web-app runtime display values** (what the app actually renders; light → dark override): red `#cf473a` → same; blue `#2a67e2` → same; violet `#ac30cc`; salmon `#b2635c` → `#ff8e84`; berry-red `#b8255f` → `#d62b6f`; orange `#c77100` → `#f48318`; olive `#949c31` → `#aeb83a`; lime `#65a33a` → `#7ecc48`; mint `#42a393` → `#52ccb8`; sky `#319dc0` → `#3ab9e2`; light-blue `#6988a4` → `#96c3eb`; grape `#692ec2` → `#8758ce`; lavender `#a4698c` → `#eb96c8`; taupe `#8f7a69` → `#ccae96`; yellow/green/teal/magenta/charcoal/grey unchanged. **Adopt this pattern: palette tokens get dark-mode overrides.**

### 2.7 States, shadows, focus, motion, dates, z-index, buttons (verified)

- **Hover / selected (light)**: menu/option hover `#f3f3f3`; secondary button idle `#f5f5f5`, hover `#e5e5e5`; focused task row bg `#fafafa` + inset ring `rgba(31,96,194,.4)`. Sidebar item (Kale): hover `#f2f2e9`, selected `#f0f6df` with text `#3e6737`. **Dark**: hover `#363636`, menu-item hover `#3d3d3d`, selected (red theme) `#472525`.
- **Shadows (light | dark)**: dropdown/menu `0 2px 4px rgba(0,0,0,.08)` + 1px border `rgba(0,0,0,.1)` | `0 10px 20px rgba(0,0,0,.19), 0 6px 6px rgba(0,0,0,.23)` + border `#3d3d3d` · popover/scheduler `0 1px 8px rgba(0,0,0,.08), 0 0 1px rgba(0,0,0,.3)` · quick-add dialog `0 15px 50px rgba(0,0,0,.35)` | `0 1px 4px rgba(0,0,0,.08), 0 15px 50px rgba(0,0,0,.6)` + 1px border `#383838` · drag ghost `0 5px 8px rgba(0,0,0,.16)` | `0 5px 8px rgba(0,0,0,.5)` · toast `0 10px 20px rgba(0,0,0,.19), 0 6px 6px rgba(0,0,0,.23)`.
- **Focus ring**: inner `#1f60c2`, outer `#dceaff` (light) / `#2a4c80` (dark); task-row focus ring `rgba(31,96,194,.4)`. Todoist keeps focus **blue in every theme** (never the accent).
- **Motion**: checkbox complete **250ms linear**; button color transitions **300ms cubic-bezier(0.4,0,0.2,1)**; checkbox fill opacity hover **150ms ease-in**; sidebar slide **300ms cubic-bezier(0.4,0,0.2,1)**.
- **Date/schedule semantic colors (light | dark)**: Today `#058527` | `#25b84c` · Tomorrow `#ad6200` | `#ff9a14` · Weekend `#246fe0` | `#5297ff` · Next week `#692ec2` | `#a970ff` · Overdue `#d1453b` | `#ff7066`. Views: Inbox blue, Today green, Upcoming purple.
- **Z-index (reactist)**: modal 1, menu 1 (local stacking contexts), **toast 400, tooltip 1000**.
- **Buttons (reactist)**: heights **28/32/36** (small/normal/large), font 12/13/14, weight 600, radius 5px, h-padding 8/12/16. Primary-destructive fill `#dc4c3e` → hover `#b03d32` (current Todoist brand red; `#d1453b` is the "danger content"/P1 red).

### 2.8 Ready-to-adopt token spec (Tailwind CSS v4, Kale default)

Uses v4 `@theme` (scales → utilities), `:root`/`[data-theme]` runtime vars for theming, `@theme inline` to bridge (per [tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme)), and `@custom-variant` for dark ([docs/dark-mode](https://tailwindcss.com/docs/dark-mode)). Model: `data-theme` absent ⇒ follow OS; explicit `data-theme="light|dark|<accent>"` wins both ways. Accent themes are tiny override blocks, exactly like Todoist's `theme_*` classes.

```css
/* app/tokens.css — OpenDoist design tokens (default: Kale) */
@import "tailwindcss";

/* dark utilities follow the resolved theme attribute OR OS when unset */
@custom-variant dark (&:where(
  [data-theme="dark"], [data-theme="dark"] *,
  .system-dark, .system-dark *
));

/* ---------- static scales (generate utilities) ---------- */
@theme {
  /* type */
  --font-sans: -apple-system, system-ui, "Segoe UI", Roboto, Noto, Oxygen-Sans,
    Ubuntu, Cantrell, "Helvetica Neue", sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco,
    "Cascadia Mono", Consolas, "Liberation Mono", "Courier New", monospace;
  --text-caption: 12px;   --text-caption--line-height: 16px;
  --text-copy: 13px;      --text-copy--line-height: 17px;
  --text-body: 14px;      --text-body--line-height: 20px;  /* task name uses 17px in dense rows */
  --text-subtitle: 16px;  --text-subtitle--line-height: 22px;
  --text-header: 20px;    --text-header--line-height: 25px;
  --text-header-lg: 24px; --text-header-lg--line-height: 30px;
  --text-header-xl: 32px; --text-header-xl--line-height: 41px;
  --font-weight-regular: 400;
  --font-weight-medium: 600;   /* Todoist: medium IS 600 */
  --font-weight-strong: 700;

  /* spacing: keep Tailwind's 4px base (--spacing: .25rem default) */

  /* radii (Todoist: 5 & 10 only) */
  --radius-xs: 3px;    /* badges, tiny chips */
  --radius-sm: 5px;    /* buttons, inputs, rows, menu items */
  --radius-lg: 10px;   /* cards, dialogs, dropdowns, quick-add */
  --radius-full: 9999px;

  /* elevation */
  --shadow-menu: 0 2px 4px rgb(0 0 0 / 0.08);
  --shadow-popover: 0 1px 8px rgb(0 0 0 / 0.08), 0 0 1px rgb(0 0 0 / 0.3);
  --shadow-dialog: 0 15px 50px rgb(0 0 0 / 0.35);
  --shadow-drag: 0 5px 8px rgb(0 0 0 / 0.16);
  --shadow-toast: 0 10px 20px rgb(0 0 0 / 0.19), 0 6px 6px rgb(0 0 0 / 0.23);

  /* motion */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --animate-check: od-check 250ms linear forwards;
  @keyframes od-check {
    0% { transform: scale(1); } 50% { transform: scale(0.9); } 100% { transform: scale(1); }
  }
}

/* ---------- semantic runtime tokens ---------- */
/* LIGHT defaults (OpenDoist = Kale accent) */
:root {
  color-scheme: light;
  /* canvas & surfaces */
  --od-bg: #ffffff;                 /* app canvas */
  --od-surface: #fcfcf8;            /* sidebar / aside (kale-tinted) */
  --od-surface-raised: #ffffff;     /* cards, dropdowns, dialogs */
  --od-surface-overlay: #282828;    /* tooltips/toasts (inverted) */
  --od-hover: #f3f3f3;              /* generic option hover */
  --od-selected: #f0f6df;           /* selected row bg (kale) */
  --od-selected-text: #3e6737;
  --od-sidebar-hover: #f2f2e9;
  /* borders */
  --od-border: #eeeeee;             /* divider primary */
  --od-border-subtle: #f5f5f5;      /* row dividers */
  --od-input-border: #e6e6e6;
  --od-input-border-focus: #b8b8b8;
  /* text */
  --od-text-primary: #202020;
  --od-text-secondary: #666666;
  --od-text-tertiary: #999999;
  /* accent (Kale) */
  --od-accent: #4c7a45;
  --od-accent-hover: #3e6737;
  --od-accent-disabled: #a5bca2;
  --od-on-accent: #ffffff;
  --od-accent-soft: #e8f1d0;        /* soft chip/selection tint */
  /* status */
  --od-danger: #d1453b;             /* == P1 */
  --od-danger-hover: #b03d32;
  --od-success: #058527;
  --od-warning: #eb8909;
  --od-info: #246fe0;
  /* priorities */
  --od-p1: #d1453b; --od-p1-disabled: #edb5b1;
  --od-p2: #eb8909; --od-p2-disabled: #f7d09d;
  --od-p3: #246fe0; --od-p3-disabled: #a7c5f3;
  --od-p4: #999999; --od-p4-disabled: #d6d6d6;
  /* dates */
  --od-date-today: #058527; --od-date-tomorrow: #ad6200;
  --od-date-weekend: #246fe0; --od-date-next-week: #692ec2;
  --od-date-overdue: #d1453b;
  /* focus (always blue, never accent) */
  --od-focus-ring: #1f60c2;
  --od-focus-ring-outer: #dceaff;
  --od-row-focus-ring: rgb(31 96 194 / 0.4);
  /* scrollbar */
  --od-scrollbar-thumb: #c1c1c1;
  /* project palette (light display values) */
  --od-palette-berry-red: #b8255f; --od-palette-red: #cf473a;
  --od-palette-orange: #c77100;    --od-palette-yellow: #b29104;
  --od-palette-olive-green: #949c31; --od-palette-lime-green: #65a33a;
  --od-palette-green: #369307;     --od-palette-mint-green: #42a393;
  --od-palette-teal: #148fad;      --od-palette-sky-blue: #319dc0;
  --od-palette-light-blue: #6988a4; --od-palette-blue: #2a67e2;
  --od-palette-grape: #692ec2;     --od-palette-violet: #ac30cc;
  --od-palette-lavender: #a4698c;  --od-palette-magenta: #e05095;
  --od-palette-salmon: #b2635c;    --od-palette-charcoal: #808080;
  --od-palette-grey: #999999;      --od-palette-taupe: #8f7a69;
}

/* DARK (one block, reused for explicit dark + OS auto) */
[data-theme="dark"], .system-dark {
  color-scheme: dark;
  --od-bg: #1e1e1e;
  --od-surface: #262626;
  --od-surface-raised: #282828;
  --od-surface-overlay: #404040;
  --od-hover: #363636;
  --od-selected: #2c3a28;           /* (derived: kale-tinted; Todoist-red dark uses #472525) */
  --od-selected-text: #a5cf99;      /* (derived) */
  --od-sidebar-hover: #2b302a;      /* (derived; Todoist dark: #322f2a) */
  --od-border: #3d3d3d;
  --od-border-subtle: #282828;
  --od-input-border: #3d3d3d;
  --od-input-border-focus: #707070;
  --od-text-primary: #ffffff;       /* rgba(255,255,255,.87) also used */
  --od-text-secondary: #cccccc;
  --od-text-tertiary: #808080;
  --od-accent: #7ca86f;             /* (derived: kale brightened; 5.9:1 on #1e1e1e) */
  --od-accent-hover: #8fb883;       /* (derived) */
  --od-accent-disabled: #3c4d38;    /* (derived) */
  --od-on-accent: #ffffff;          /* pair with fill #5d8a54 for buttons (derived) */
  --od-accent-soft: #26331f;        /* (derived; Todoist dark red soft: #6f2625) */
  --od-danger: #ff7066; --od-danger-hover: #e36564;
  --od-success: #25b84c; --od-warning: #ff9a14; --od-info: #5297ff;
  --od-p1: #ff7066; --od-p1-disabled: #79403c;
  --od-p2: #ff9a13; --od-p2-disabled: #79511b;
  --od-p3: #5297ff; --od-p3-disabled: #345079;
  --od-p4: #a9a9a9; --od-p4-disabled: #575757;
  --od-date-today: #25b84c; --od-date-tomorrow: #ff9a14;
  --od-date-weekend: #5297ff; --od-date-next-week: #a970ff;
  --od-date-overdue: #ff7066;
  --od-focus-ring: #1f60c2; --od-focus-ring-outer: #2a4c80;
  --od-row-focus-ring: #175bc2;
  --od-scrollbar-thumb: #6b6b6b;
  --shadow-menu: 0 10px 20px rgb(0 0 0 / .19), 0 6px 6px rgb(0 0 0 / .23);
  --shadow-dialog: 0 1px 4px rgb(0 0 0 / .08), 0 15px 50px rgb(0 0 0 / .6);
  --shadow-drag: 0 5px 8px rgb(0 0 0 / .5);
  /* palette dark overrides (Todoist-verified) */
  --od-palette-berry-red: #d62b6f; --od-palette-orange: #f48318;
  --od-palette-olive-green: #aeb83a; --od-palette-lime-green: #7ecc48;
  --od-palette-mint-green: #52ccb8; --od-palette-sky-blue: #3ab9e2;
  --od-palette-light-blue: #96c3eb; --od-palette-grape: #8758ce;
  --od-palette-lavender: #eb96c8; --od-palette-salmon: #ff8e84;
  --od-palette-taupe: #ccae96;
}

/* SYSTEM AUTO-DARK: applies ONLY when no explicit theme is set.
   Explicit data-theme (light or any accent theme) wins over OS dark;
   explicit data-theme="dark" wins over OS light — both ways. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* duplicate the dark block via your CSS build:
    e.g. postcss-mixin, Sass @mixin, or set class="system-dark" on <html>
    with the 3-line head script below (recommended; avoids duplication). */
  }
}
/* head script (Tailwind-recommended pattern):
   document.documentElement.classList.toggle('system-dark',
     !localStorage.theme && matchMedia('(prefers-color-scheme: dark)').matches);
   explicit choice -> set data-theme and remove .system-dark            */

/* ---------- accent themes as [data-theme=X] (Todoist parity) ---------- */
/* light schemes: todoist, moonstone, tangerine, kale(default), blueberry, lavender, raspberry */
[data-theme="todoist"] {
  --od-accent: #dc4c3e; --od-accent-hover: #c3392c; --od-accent-disabled: #eda59e;
  --od-accent-soft: #fde7d8; --od-surface: #fcfaf8;
  --od-sidebar-hover: #f2efed; --od-selected: #ffefe5; --od-selected-text: #a81f00;
}
[data-theme="moonstone"] {
  --od-accent: #39485e; --od-accent-hover: #323f51; --od-accent-disabled: #a4a9b0;
  --od-accent-soft: #e0e2e5; --od-surface: #fafafa;
  --od-sidebar-hover: #efeff1; --od-selected: #e0e2e5; --od-selected-text: #39485e;
}
[data-theme="tangerine"] {
  --od-accent: #d68400; --od-accent-hover: #995e00; --od-accent-disabled: #ebc180;
  --od-accent-soft: #fdecdc; --od-surface: #fcfcf8;
  --od-sidebar-hover: #f4f1eb; --od-selected: #fff3d6; --od-selected-text: #995e00;
}
[data-theme="blueberry"] {
  --od-accent: #297abc; --od-accent-hover: #246498; --od-accent-disabled: #9ab4dd;
  --od-accent-soft: #d6e5f3; --od-surface: #f8fafb;
  --od-sidebar-hover: #eef2f6; --od-selected: #dfedfb; --od-selected-text: #1e5480;
}
[data-theme="lavender"] {
  --od-accent: #766bbd; --od-accent-hover: #51459f; --od-accent-disabled: #bab5de;
  --od-accent-soft: #e8e3f4; --od-surface: #f9f9fa;
  --od-sidebar-hover: #ededf2; --od-selected: #e9e5f5; --od-selected-text: #4d447e;
}
[data-theme="raspberry"] {
  --od-accent: #c5496c; --od-accent-hover: #8c213f; --od-accent-disabled: #f4a0b7;
  --od-accent-soft: #f8e2e7; --od-surface: #fbf8f8;
  --od-sidebar-hover: #f2ecf0; --od-selected: #f8e2e7; --od-selected-text: #8c213f;
}
/* "kale" needs no block — it IS :root. Keep [data-theme="light"] as alias of :root. */

/* ---------- bridge semantic vars into Tailwind utilities ---------- */
@theme inline {
  --color-bg: var(--od-bg);
  --color-surface: var(--od-surface);
  --color-surface-raised: var(--od-surface-raised);
  --color-surface-overlay: var(--od-surface-overlay);
  --color-hover: var(--od-hover);
  --color-selected: var(--od-selected);
  --color-selected-text: var(--od-selected-text);
  --color-sidebar-hover: var(--od-sidebar-hover);
  --color-border: var(--od-border);
  --color-border-subtle: var(--od-border-subtle);
  --color-input-border: var(--od-input-border);
  --color-input-border-focus: var(--od-input-border-focus);
  --color-text-primary: var(--od-text-primary);
  --color-text-secondary: var(--od-text-secondary);
  --color-text-tertiary: var(--od-text-tertiary);
  --color-accent: var(--od-accent);
  --color-accent-hover: var(--od-accent-hover);
  --color-accent-disabled: var(--od-accent-disabled);
  --color-on-accent: var(--od-on-accent);
  --color-accent-soft: var(--od-accent-soft);
  --color-danger: var(--od-danger);
  --color-danger-hover: var(--od-danger-hover);
  --color-success: var(--od-success);
  --color-warning: var(--od-warning);
  --color-info: var(--od-info);
  --color-p1: var(--od-p1); --color-p2: var(--od-p2);
  --color-p3: var(--od-p3); --color-p4: var(--od-p4);
  --color-focus-ring: var(--od-focus-ring);
  --color-focus-ring-outer: var(--od-focus-ring-outer);
  --color-palette-berry-red: var(--od-palette-berry-red);
  --color-palette-red: var(--od-palette-red);
  --color-palette-orange: var(--od-palette-orange);
  --color-palette-yellow: var(--od-palette-yellow);
  --color-palette-olive-green: var(--od-palette-olive-green);
  --color-palette-lime-green: var(--od-palette-lime-green);
  --color-palette-green: var(--od-palette-green);
  --color-palette-mint-green: var(--od-palette-mint-green);
  --color-palette-teal: var(--od-palette-teal);
  --color-palette-sky-blue: var(--od-palette-sky-blue);
  --color-palette-light-blue: var(--od-palette-light-blue);
  --color-palette-blue: var(--od-palette-blue);
  --color-palette-grape: var(--od-palette-grape);
  --color-palette-violet: var(--od-palette-violet);
  --color-palette-lavender: var(--od-palette-lavender);
  --color-palette-magenta: var(--od-palette-magenta);
  --color-palette-salmon: var(--od-palette-salmon);
  --color-palette-charcoal: var(--od-palette-charcoal);
  --color-palette-grey: var(--od-palette-grey);
  --color-palette-taupe: var(--od-palette-taupe);
}

/* ---------- z-index (no @theme namespace in v4; plain vars + z-[var(--z-*)]) ---------- */
:root {
  --z-sticky: 20; --z-sidebar: 30; --z-dropdown: 50;
  --z-overlay: 80; --z-modal: 90; --z-popover: 100;
  --z-toast: 400; --z-tooltip: 1000;   /* toast/tooltip values are Todoist's */
}

/* ---------- layout constants ---------- */
:root {
  --sidebar-width: 280px; --sidebar-min: 210px; --sidebar-max: 420px;
  --content-max: 800px; --detail-panel: 260px;
}
```

### 2.9 Component rules cheatsheet

| Component | Rules |
|---|---|
| **Button** | h 32 (sm 28 / lg 36); px 12 (8/16); `text-copy` 13px, weight 600; `radius-sm` 5px; primary = `bg-accent text-on-accent hover:bg-accent-hover disabled:bg-accent-disabled`; secondary = `#f5f5f5`→`#e5e5e5` (dark `#292929`→`#3d3d3d`); transition colors 300ms `ease-standard` |
| **Input** | h 32; radius 5px; 1px `input-border`, focus → `input-border-focus` (no accent border); error border `danger`; placeholder `text-tertiary` |
| **Task row** | min-h 42px; pad `8px 38px 8px 5px`; radius 5px; checkbox col 24px, gap 6px; name 14px `text-primary` (completed: line-through `text-tertiary`), description 13px `text-secondary` 1-line clamp, meta 12px `text-tertiary`; 1px `border-subtle` divider; hover reveals actions only; focus: bg `#fafafa` + inset 1px ring `--od-row-focus-ring` |
| **Checkbox** | 18px circle in 24px hit area; P1–P3: 2px border in `--color-pN` + same color fill at 10% (20% hover) + hover check glyph preview in priority color; P4: 1px `p4` border, no fill; checked: solid `pN` fill, white 24-grid check; animate 250ms linear scale+fade |
| **Priority flag** | filled flag icon in `--color-pN`; P4 = outline flag, `text-tertiary` |
| **Sidebar** | w 280 (210–420 resizable); bg `surface`; item h ~32 (p 5px, radius 5px, text 14/17); hover `sidebar-hover`; active `selected` + `selected-text` + icon in accent; counts 12px `text-tertiary`; slide 300ms `ease-standard` |
| **Dropdown/menu** | bg `surface-raised`; radius 10px; `shadow-menu` + 1px border (`rgba(0,0,0,.1)` light / `border` dark); item h 32, radius 5px, hover `hover` |
| **Dialog / quick-add** | radius 10px; `shadow-dialog`; dark adds 1px `#383838` border; quick-add width ≤ 560px, top-aligned |
| **Tooltip/toast** | bg `surface-overlay`, white text, radius 5px (toast 10px), `shadow-toast`, z 1000/400 |
| **Focus ring** | `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` (+ optional outer glow `focus-ring-outer`); always blue, all themes; `:focus-visible` only |
| **Icons** | Lucide: 24×24 grid, `stroke: currentColor`, default `stroke-width: 2`, round caps/joins ([defaults](https://github.com/lucide-icons/lucide/blob/main/packages/lucide-react/src/defaultAttributes.ts)). Sizes: 16 inline/meta, 18 row actions, 20 toolbar, 24 sidebar/nav. Use `strokeWidth={1.75}` at 20–24 to match Todoist's lighter line, 2 at 16–18 (or `absoluteStrokeWidth`). Icon color `text-secondary`, hover `text-primary`; never accent except active nav |
| **Labels/projects** | color dot 12px circle in `--color-palette-*`; label chip text 12px in palette color; palette tokens auto-brighten in dark |
| **Dates** | today/tomorrow/weekend/next-week/overdue tokens; 12px + 16px icon |
| **Motion** | hover fades 150ms ease-in; state/color 250–300ms `ease-standard`; checkbox 250ms; respect `prefers-reduced-motion` |

**Section 2 sources**: [Doist reactist design-tokens.css](https://github.com/Doist/reactist/blob/main/src/styles/design-tokens.css) · [nickau309/todo-list globals.css](https://github.com/nickau309/todo-list/blob/main/src/app/globals.css) (all 8 theme blocks, priorities, shadows, rings) · [developer.todoist.com/api/v1](https://developer.todoist.com/api/v1/) + [mcp-todoist mirror](https://github.com/shayonpal/mcp-todoist/blob/main/docs/todoist-api-v1-documentation.md) · [todoist-board constants](https://github.com/propranolol11/todoist-board/blob/main/src/constants.ts) · [todoist-api-colors](https://github.com/lkostrowski/todoist-api-colors) · [themes help](https://www.todoist.com/help/articles/change-color-themes-zD0N5K) · [Tailwind v4 theme](https://tailwindcss.com/docs/theme) / [dark mode](https://tailwindcss.com/docs/dark-mode) · [Lucide defaults](https://github.com/lucide-icons/lucide/blob/main/packages/lucide-react/src/defaultAttributes.ts)

---

## 3. TypeScript stack (versions verified against npm 2026-07-15)

### 3.1 API layer

**Hono over Fastify.** `hono` **4.12.30** vs `fastify` **5.10.0**. Performance is a wash on Node (~4–6k req/s realistic JSON+DB benchmarks for both); Hono wins on end-to-end TS inference (params/query/body/response), runtime portability (WinterCG fetch — Node/Bun/Deno/Workers), and smaller surface; Fastify wins on Node-native plugin ecosystem ([betterstack](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/), [encore.dev](https://encore.dev/articles/nestjs-vs-fastify-vs-hono)). For an app sharing types with SPA + CLI, Hono's `hc` RPC client (free typed fetches) and first-party Node adapter `@hono/node-server` **2.0.9** seal it.

**OpenAPI**: `@hono/zod-openapi` **1.5.1** (first-party in `honojs/middleware`; peers `hono >=4.10.0`, **`zod ^4.0.0`**; zod is at **4.4.3**):

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
const app = new OpenAPIHono()
app.openapi(createRoute({ method: 'get', path: '/users/{id}', request: { params: ParamsSchema },
  responses: { 200: { content: { 'application/json': { schema: UserSchema } }, description: 'Retrieve the user' } } }), handler)
app.doc('/doc', { openapi: '3.0.0', info: { version: '1.0.0', title: 'My API' } })
```

Fastify equivalent `fastify-zod-openapi` **5.6.1** exists (peers `fastify 5`, `@fastify/swagger ^9`, `zod ^3.25.74 || ^4`) but is community-maintained (samchungy) and drags in `@fastify/swagger-ui`.

**Docs UI**: `@scalar/hono-api-reference` **0.11.10** (very active). The export is `Scalar` (older docs show `apiReference` — outdated) ([scalar.com](https://scalar.com/products/api-references/integrations/hono)):

```ts
import { Scalar } from '@scalar/hono-api-reference'
app.get('/scalar', Scalar({ url: '/doc' }))   // options: theme, pageTitle, proxyUrl, cdn
```

**Live updates: SSE, not WebSockets** at tiny scale. One-way server→client (task list changed, sync events) is SSE's lane: plain HTTP, auto-reconnect with `Last-Event-ID`, no proxy/firewall pain, HTTP/2 multiplexing removes the 6-connection limit ([ably](https://ably.com/blog/websockets-vs-sse), [rxdb](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html), [websocket.org](https://websocket.org/comparisons/sse/)). WS only pays off for bidirectional (collab editing, chat). Hono built-in ([helpers/streaming](https://hono.dev/docs/helpers/streaming)):

```ts
import { streamSSE } from 'hono/streaming'
app.get('/sse', (c) => streamSSE(c, async (stream) => {
  while (!stream.aborted) { await stream.writeSSE({ data, event: 'update', id: String(id++) }); await stream.sleep(1000) }
}))
```

Caveat: errors thrown mid-stream don't hit `onError`; check `stream.aborted` for disconnects.

### 3.2 Data layer

**Drizzle ORM + better-sqlite3.** `drizzle-orm` **0.45.2** / `drizzle-kit` **0.31.10** (stable line, 2026-06-27). Drizzle **v1.0.0 is at RC** (`drizzle-orm@rc`, Relational Queries v2: `defineRelations`, object-style `where`, filtering by related tables) — start on 0.45.x, take the v1 migration when stable (`db._query` compat window exists) ([roadmap](https://orm.drizzle.team/roadmap), [v1beta2 notes](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2)).

- `better-sqlite3` **12.11.1**: fastest Node SQLite driver, synchronous API (ideal for SQLite's single-writer model). `@libsql/client` **0.17.4** only earns its async API if you may move to Turso/remote later ([pkgpulse](https://www.pkgpulse.com/guides/better-sqlite3-vs-libsql-vs-sql-js-sqlite-nodejs-2026)). `node:sqlite` works at runtime (`drizzle-orm/node-sqlite`) but **drizzle-kit cannot connect through it** ([issue #5471](https://github.com/drizzle-team/drizzle-orm/issues/5471)).
- **Migrations**: `drizzle-kit generate` (SQL files into `./drizzle`) in dev; apply at app boot — synchronous for SQLite ([get started](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)). Never `drizzle-kit push` in production. Use `drizzle-kit generate --custom` for hand-written SQL (FTS5, triggers).

```ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
migrate(db, { migrationsFolder: './drizzle' })   // sync for SQLite; ship the folder in the image
```

- **FTS5**: no Drizzle bindings; external-content FTS5 table + sync triggers in a custom migration, query via `` sql`...MATCH...` `` ([delucis/astro-db-fts](https://github.com/delucis/astro-db-fts), [trigger gist](https://gist.github.com/HugeLetters/7cce16a0f57b612507c7e17a9b4e688e)):

```sql
CREATE VIRTUAL TABLE tasks_fts USING fts5(title, description, content='tasks', content_rowid='id');
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description); END;
-- + AFTER DELETE / AFTER UPDATE triggers using the FTS5 'delete' command form
```

Gotchas ([sqlite forum](https://sqlite.org/forum/forumpost/acdc2aa30a)): never insert NULL rowid into an external-content index; delete-old-tokens must see the *old* row values.

- **On open**: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`
- **Backups**: **Litestream v0.5.14** (2026-07-06) — the 0.5.0 rewrite (Oct 2025, Fly.io) replaced WAL-shipping with the LTX format: faster, true point-in-time recovery via leveled compaction (30s/5min windows) ([fly.io](https://fly.io/blog/litestream-v050-is-here/), [simonwillison.net](https://simonwillison.net/2025/Oct/3/litestream/)). Caveats: 0.5.x cannot restore pre-0.5 backups; early 0.5.0 had restore bugs ([mtlynch.io](https://mtlynch.io/notes/hold-off-on-litestream-0.5.0/)) — patched through .14, pin a recent 0.5.x. Belt-and-suspenders without S3: nightly `sqlite3 db "VACUUM INTO '/backups/app-$(date +%F).db'"` + gzip — snapshots in one transaction without blocking writers ([litestream.io/alternatives/cron](https://litestream.io/alternatives/cron/), [oldmoe.blog](https://oldmoe.blog/2024/04/30/backup-strategies-for-sqlite-in-production/)). Recommend: VACUUM INTO cron built-in, Litestream optional.

### 3.3 Auth

**better-auth over hand-rolled.** `better-auth` **1.6.23** (1.7.0-rc.1 in flight). Email/password with sessions, verification, reset built in; built-in rate limiting (sign-in 3 req/10s) ([better-auth.com](https://better-auth.com/)). Since 1.5, plugins are scoped packages:

- **API keys**: `@better-auth/api-key` **1.6.23** — creation/verification, per-key rate limits, expiration, refill, metadata, permissions, and "sessions from API keys" so one middleware handles cookie *or* `x-api-key` ([docs](https://better-auth.com/docs/plugins/api-key)). Schema via `npx @better-auth/cli migrate` or `generate` (use `generate` → fold into Drizzle migrations; Drizzle adapter first-class).
- **OIDC later**: `@better-auth/sso` **1.6.23** (OIDC + SAML sign-in); an `oidc-provider` plugin exists if the app must *be* an IdP.
- Lucia v3 was deprecated March 2025; its maintainer points new projects at better-auth ([lucia discussion #1707](https://github.com/lucia-auth/lucia/discussions/1707), [pkgpulse](https://www.pkgpulse.com/guides/better-auth-vs-lucia-vs-nextauth-2026)).
- **Password hashing**: better-auth default is **scrypt** (OWASP-acceptable, zero native deps). For argon2id (OWASP first choice; bcrypt limited to 72 bytes / 4KB memory): override `emailAndPassword.password.{hash,verify}` with **`@node-rs/argon2` 2.0.2** (prebuilt N-API binaries), params `m=64MiB, t=3, p=4` ([better-auth docs](https://better-auth.com/docs/authentication/email-password), [pkgpulse](https://www.pkgpulse.com/guides/bcrypt-vs-argon2-vs-scrypt-password-hashing-2026), [workos](https://workos.com/blog/picking-a-password-hash-argon2-bcrypt-scrypt)). Default scrypt is fine; argon2id is a 10-line upgrade.

### 3.4 Frontend

- **Vite 8.1.4** — Vite 8 (stable 2026-03-12) ships **Rolldown as the only bundler**, 10–30x faster prod builds (Linear 46s→6s); `@vitejs/plugin-react` v6 uses Oxc, Babel gone ([vite.dev](https://vite.dev/blog/announcing-vite8), [infoq](https://www.infoq.com/news/2026/05/vite-v8-rust/)).
- **React 19.2.7** (19.2 line: `<Activity>`, `useEffectEvent`, View Transitions).
- **TanStack Query 5.101.2** — optimistic updates via `onMutate` cache-snapshot/rollback or the simpler `useMutation` `variables`-render approach ([guide](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)).
- **Zustand 5.0.14** for client-only state (selection, dialogs); server state stays in Query.
- **DnD**: `@dnd-kit/core` **6.3.1** — caution: last publish **Dec 2024**; ubiquitous (~2.8M/wk) but effectively frozen; the rewrite (`@dnd-kit/react`) never stabilized. Actively-maintained alternative: `@atlaskit/pragmatic-drag-and-drop` **2.0.1** (June 2026, Atlassian, <5KB headless) ([comparison](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)). dnd-kit's `sortable` preset is still the fastest path; pragmatic-dnd is the safer long-horizon bet.
- **cmdk 1.1.1** (Aug 2025; "done" software, powers shadcn `<Command>`) for the palette.
- **Shortcuts**: `react-hotkeys-hook` **5.3.3** (active, June 2026) — v5 natively does Gmail-style sequences ([docs](https://react-hotkeys-hook.vercel.app/docs/api/use-hotkeys)): `useHotkeys('g>t', () => navigate('/today'), { sequenceTimeoutMs: 1000, description: 'Go to Today' })` (`>` = sequence separator; `sequenceSplitKey` configurable). `@tanstack/react-hotkeys` **0.10.0** (June 2026) is promising but 0.x/too fresh.
- **Virtualization**: `@tanstack/react-virtual` **3.14.6** — the standard; needed once lists hit ~1k rows.
- **Primitives: Base UI over Radix.** `@base-ui/react` **1.6.0** (MUI + ex-Radix engineers, 1.0 Dec 2025, 6M+/wk). As of **July 2026 shadcn/ui defaults new projects to Base UI** (`npx shadcn init`; `-b radix` to opt back); Radix has slowed post-WorkOS acquisition ([shadcn changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default), [analysis](https://www.shadcndeck.com/blog/radix-vs-base-ui)). Use shadcn/ui (Base UI flavor), own the copied code.

### 3.5 NL parsing, recurrence, dates

- **chrono-node 2.10.0** (published 2026-07-12, actively maintained, multi-language) — each `ParsedResult` carries `index` + `text`, exactly what's needed for highlight spans in quick-add ([github](https://github.com/wanasit/chrono)).
- **Token highlighting: input + overlay, not contenteditable.** `rich-textarea` **0.27.1** (inokawa, 2026-07-13): renders a colorized replica behind a transparent textarea; built-in caret-position autocomplete; ~3KB; native input semantics (IME, undo, mobile) survive ([github](https://github.com/inokawa/rich-textarea)). Alternatives: contenteditable (see [basarozcan/todoist-date-identifier-clone](https://github.com/basarozcan/todoist-date-identifier-clone)) — you own caret math and IME bugs; **Lexical 0.47.0** ([lexical.dev](https://lexical.dev/)) only if quick-add grows into rich editing. UX reference: Vikunja's Quick Add Magic ([doc](https://vikunja.io/help/quick-add-magic/)).
- **Recurrence: rrule.js is abandonware** (`rrule` **2.8.1**, last publish **Nov 2023**, TZ/DST bug backlog). Use **`rrule-temporal` 2.0.0** (2026-07-02, Temporal-based, full RFC-5545 + RFC-7529 RSCALE, cross-timezone correct; [github](https://github.com/ggaabe/rrule-temporal)); alternatives `rschedule` (mature, date-lib agnostic), `@rrulenet/rrule` (rrule-compatible API, maintained engine; [github](https://github.com/rrulenet/rrule)). For Todoist-style "every 2 weeks" you need a small NL→RRULE layer either way; **store RFC-5545 strings** so the engine is swappable.
- **Dates: date-fns 4.4.0 + @date-fns/tz 1.5.0** (`TZDate`): tree-shakeable, first-class IANA timezones, plain-Date interop ([pkgpulse](https://www.pkgpulse.com/guides/date-fns-v4-vs-temporal-api-vs-dayjs-date-handling-2026)). dayjs 1.11.21 alive but v2 stalled. **Temporal reached TC39 Stage 4 (March 2026, ES2026); native in Chrome 144 / Firefox 139 / Edge 144, Safari still behind** — usable via `temporal-polyfill` **1.0.1** (fullcalendar), which rrule-temporal rides on. Reasonable split: date-fns for UI formatting + Temporal (polyfilled) for recurrence math.

### 3.6 CLI

- **Framework: commander 15.0.0** (May 2026; ~280M/wk, zero deps, subcommands/env/conflicts built in). `citty` 0.2.2 alive-but-minimal (0.x, UnJS); **clipanion stuck at 4.0.0-rc.4 since Sep 2024 — avoid** ([comparison](https://dev.to/thegdsks/building-a-production-typescript-cli-in-2026-oclif-vs-commander-vs-custom-9ah)).
- **Config/token storage**: `env-paths` **4.0.0** — XDG on Linux (`$XDG_CONFIG_HOME` → `~/.config/<name>`), proper platform dirs on macOS/Windows ([github](https://github.com/sindresorhus/env-paths), [xdg-basedir](https://github.com/sindresorhus/xdg-basedir)). Convention: `~/.config/<app>/config.json` (URL + token, chmod 600), token override via `<APP>_TOKEN` env var. `conf` 15.1.0 if you want get/set handled.
- **Table output**: `cli-table3` 0.6.5 (stable since 2024) or `console.table`; for colors prefer Node built-in **`util.styleText`** (stable since Node 20.12/22) over chalk/picocolors — zero deps.
- **Packaging from the monorepo**: bundle the CLI with **tsdown** so `packages/core` is inlined into `dist/` (no `workspace:*` in the published tarball — pnpm rewrites `workspace:*` at `pnpm publish`, but inlining avoids publishing core at all) ([pnpm workspaces](https://pnpm.io/workspaces)); `"bin": {"myapp": "dist/cli.js"}` + `#!/usr/bin/env node` banner. Ship the same bundled file into the server Docker image (`COPY --from=build /app/packages/cli/dist /usr/local/lib/myapp-cli` + symlink) so `docker exec app myapp ...` works offline.

### 3.7 Monorepo & tooling

- **pnpm workspaces, no Turborepo initially.** For ~3–4 packages (core/api/web/cli), `pnpm -r --filter` + `pnpm.catalogs` for shared dep versions is enough; add `turbo` **2.10.5** later purely for task caching ([guide](https://chenguangliang.com/en/posts/blog193_monorepo-practice-from-zero-to-production/), [turborepo docs](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)).
- **Tailwind CSS 4.3.2** — CSS-first `@theme { --color-accent: oklch(...); }` generates utilities *and* runtime CSS vars; no `tailwind.config.js`; builds 5x/100x faster ([theme docs](https://tailwindcss.com/docs/theme), [v4 blog](https://tailwindcss.com/blog/tailwindcss-v4)).
- **Biome 2 (2.5.4)** replaces ESLint+Prettier: one config, 423+ rules, **type-aware linting without the TS compiler** (v2.x), 10–56x faster; adopted by Vercel, Discord, Slack, Node.js. Residual gap: niche plugins/custom org rules ([pkgpulse](https://www.pkgpulse.com/blog/biome-vs-eslint-prettier-linting-2026), [migration guide](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m)).
- **Vitest 4.1.10** (unit; workspace projects cover all packages) + **@playwright/test 1.61.1** (E2E).
- **tsdown 0.22.8 over tsup** for `core` + `cli` builds: Rolldown-based successor, ESM-first, first-class `.d.ts`; tsup 8.5.1 in maintenance (last publish Nov 2025); Evan You has signaled tsdown as the long-term path; migration is config-rename-level ([tsdown.dev](https://tsdown.dev/guide/), [writeup](https://alan.norbauer.com/articles/tsdown-bundler/)). The Vite-built SPA and tsx-run server don't need it.
- **changesets 2.31.0 over release-please** for a monorepo with independently-versioned publishables (CLI to npm): best-in-class independent versioning, PR-based flow; release-please 17.x better for single-package conventional-commits repos ([comparison](https://oleksiipopov.com/blog/npm-release-automation/), [changesets](https://github.com/changesets/changesets)). (See §4.9 for the countervailing field-study finding.)

### 3.8 Code-health tools

- **react-doctor 0.7.8** (published 2026-07-15), MIT, from **Million.co** (`millionco/react-doctor` — react-scan/Million Lint team; "Your agent writes bad React. This catches it") ([github](https://github.com/millionco/react-doctor)). Deterministic static scanner: state & effects, performance, architecture, security, a11y; works with Next.js/Vite/TanStack/React Native. Run: `npx react-doctor@latest` (audit) · `npx react-doctor@latest install` (wire into Claude Code/Cursor/Codex) · `npx react-doctor@latest ci install` (GitHub Actions/GitLab, new-issues-only on PRs) · `--json`, `--no-telemetry`.
- **fallow 3.6.0** (published 2026-07-15) — **it exists**: `fallow-rs/fallow` (~4.1k stars, 212 releases), docs at [docs.fallow.tools](https://docs.fallow.tools). Rust-built (90%) "codebase intelligence for TS/JS": dead code (unused files/exports/types/enum & class members/deps), circular deps, duplication, complexity/health scoring, architecture + design-system drift; runs without tsc or Node. Commands: `npx fallow` (full pipeline), `fallow audit` (changed-file PR gate), `fallow dead-code`, `fallow dupes`, `fallow health`, `fallow fix --dry-run`. Static layer free; paid **Fallow Runtime** adds production execution evidence. Established overlaps: **knip 6.27.0** (unused exports/deps incumbent), **react-scan 0.5.7** (runtime render profiling), **madge 8.0.0** (circular deps, aging).

### 3.9 Recommended stack table

| Area | Pick (version) | Why (one line) |
|---|---|---|
| API framework | **Hono 4.12.30** + `@hono/node-server` 2.0.9 | Same Node perf as Fastify, better TS inference, first-party zod-openapi + typed `hc` client shared with SPA/CLI |
| OpenAPI | **@hono/zod-openapi 1.5.1** (zod 4.4.3) | First-party, zod-4 native, `app.doc('/doc', ...)` gives spec for free |
| Docs UI | **@scalar/hono-api-reference 0.11.10** | One line: `app.get('/scalar', Scalar({ url: '/doc' }))`; very active project |
| Live updates | **SSE via `hono/streaming` streamSSE** | One-way tiny-scale updates: auto-reconnect, plain HTTP, no WS infra |
| ORM/driver | **Drizzle 0.45.2 + better-sqlite3 12.11.1** | Fastest sync driver for single-box SQLite; libsql only buys a Turso path you don't need |
| Migrations | **drizzle-kit generate + `migrate()` at boot** | SQLite migrator is synchronous — perfect for self-hosted "just start the container" |
| Search | **FTS5 external-content + triggers in custom migration** | No Drizzle bindings; raw SQL migration + `` sql`MATCH` `` is the proven pattern |
| Durability | **WAL + nightly `VACUUM INTO` cron; optional Litestream 0.5.14** | Zero-dep snapshot backup; Litestream adds streaming replication + PITR when S3 exists |
| Auth | **better-auth 1.6.23 + @better-auth/api-key (+ @better-auth/sso later)** | Sessions/email-password/API-keys/OIDC as plugins on your own DB; Lucia is deprecated |
| Password hash | **scrypt default; optional @node-rs/argon2 2.0.2 (argon2id)** | Default is OWASP-fine; argon2id override is a 10-line config if desired |
| SPA | **Vite 8.1.4 + React 19.2.7** | Rolldown-powered builds (10–30x), Babel-free plugin-react v6 |
| Server state | **TanStack Query 5.101.2** | Canonical optimistic-update patterns (`onMutate` rollback) |
| Client state | **Zustand 5.0.14** | Tiny, for UI-only state |
| UI primitives | **shadcn/ui on Base UI (`@base-ui/react` 1.6.0) + Tailwind 4.3.2 `@theme`** | shadcn defaults to Base UI since July 2026; Radix stagnating post-WorkOS |
| DnD | **@dnd-kit/core 6.3.1** (watch @atlaskit/pragmatic-drag-and-drop 2.0.1) | Best sortable-list DX today despite frozen releases; pragmatic-dnd is the maintained fallback |
| Palette / keys / virtual | **cmdk 1.1.1 · react-hotkeys-hook 5.3.3 (`'g>t'` sequences) · @tanstack/react-virtual 3.14.6** | All three are the settled standards; sequences built-in |
| Quick-add NL | **chrono-node 2.10.0 + rich-textarea 0.27.1 overlay** | chrono returns match offsets; overlay keeps native input semantics |
| Recurrence | **rrule-temporal 2.0.0** (store RFC-5545 strings) | rrule.js dead since 2023; Temporal-based engine is TZ/DST-correct |
| Dates | **date-fns 4.4.0 + @date-fns/tz 1.5.0** (+ temporal-polyfill 1.0.1 where needed) | Tree-shaken TZ-aware formatting; Temporal is Stage 4 but Safari lags |
| CLI | **commander 15.0.0 + env-paths 4.0.0 + cli-table3/`util.styleText`** | Boring, huge ecosystem; XDG-correct config at `~/.config/<app>/`; zero-dep colors |
| Monorepo | **pnpm workspaces (+ catalogs); Turborepo only when CI hurts** | 3–4 packages don't need a task graph yet; turbo layers on later |
| Lint/format | **Biome 2.5.4** | One Rust tool, type-aware linting sans tsc, 10–50x faster than ESLint+Prettier |
| Tests | **Vitest 4.1.10 + Playwright 1.61.1** | Default pairing, workspace-aware |
| Package builds | **tsdown 0.22.8** (core + cli only) | Rolldown-based tsup successor, blessed by Vite team; inlines workspace deps for publish |
| Releases | **changesets 2.31.0** (npm-published packages) | Best independent-versioning story for a monorepo publishing a CLI to npm |
| Code health | **react-doctor 0.7.8 (Million) + knip 6.27.0; evaluate fallow 3.6.0** | react-doctor audits React/agent output; knip kills dead exports; fallow is real (fallow-rs, Rust, free static tier) but newer — trial before gating CI on it |

---

## 4. Self-hosted OSS field study (10 projects)

Projects studied: Vikunja, Donetick, Immich, Linkwarden, Karakeep, Vaultwarden, Miniflux, ntfy, Umami, Actual Budget. All facts verified against repos/docs July 2026.

### 4.1 Snapshot matrix

| Project | Stack | License | DB | Deploy shape | Registry/image | Version (7/2026) | Docs |
|---|---|---|---|---|---|---|---|
| Vikunja | Go + Vue | AGPL-3.0-or-later | **SQLite default**; PG/MySQL/MariaDB opt | single container, port 3456 | `vikunja/vikunja` (Docker Hub) | v2.3.0 | vikunja.io/docs (Astro) |
| Donetick | Go + React | AGPL-3.0 | SQLite (`/donetick-data/donetick.db`) | single container, port 2021 | `donetick/donetick` | v0.1.75 | docs.donetick.com |
| Immich | TS (NestJS + SvelteKit) + Flutter | AGPL-3.0 (was MIT) | Postgres + vector ext, required | compose (server, ML, DB) | `ghcr.io/immich-app/immich-server` | v3.0.3 | docs.immich.app (Docusaurus) |
| Linkwarden | TS (Next.js, Prisma, yarn monorepo) | AGPL-3.0 | Postgres 16 required | compose (app, `postgres:16-alpine`, `getmeili/meilisearch:v1.12.8`) | `ghcr.io/linkwarden/linkwarden:latest` | v2.15.1 | docs.linkwarden.app (Docusaurus) |
| Karakeep | TS (Next.js, tRPC, **Drizzle**, pnpm monorepo) | AGPL-3.0 | **SQLite only** (+ optional Meilisearch) | compose (web, chrome, meilisearch) **or documented single-container "minimal install"** | `ghcr.io/karakeep-app/karakeep` | v0.32.0 | docs.karakeep.app (Docusaurus) |
| Vaultwarden | Rust | AGPL-3.0 | **SQLite default**; MySQL/PG opt | single container, `/data` | `vaultwarden/server` + ghcr + quay | 1.36.0 | GitHub wiki (66 pages) |
| Miniflux | Go | Apache-2.0 | Postgres only | single binary/container, port 8080 | `docker.io/miniflux/miniflux`, `ghcr.io/miniflux/miniflux`, `quay.io/miniflux/miniflux` | 2.3.2 | miniflux.app/docs |
| ntfy | Go | Apache-2.0 + GPLv2 dual | SQLite files (PG experimental via `database-url`) | single binary/container | `binwiederhier/ntfy` | v2.26.0 | docs.ntfy.sh (MkDocs Material) |
| Umami | TS (Next.js, Prisma) | MIT | Postgres ≥12.14 (MySQL variant) | app + PG compose | `docker.umami.is/umami-software/umami`, ghcr DB-flavored tags | v3.2.0 | docs.umami.is (Mintlify) |
| Actual | TS (yarn workspaces: `loot-core`, `desktop-client`, sync-server) | MIT | SQLite (all data under `/data`) | single container, port 5006 | `actualbudget/actual-server` + `ghcr.io/actualbudget/actual` | v26.7.0 (**CalVer YY.M.P**) | actualbudget.org/docs (Docusaurus) |

Repos: [Vikunja](https://github.com/go-vikunja/vikunja) · [Immich](https://github.com/immich-app/immich) · [Karakeep](https://github.com/karakeep-app/karakeep) · [Linkwarden](https://github.com/linkwarden/linkwarden) · [Actual](https://github.com/actualbudget/actual) · [Miniflux](https://github.com/miniflux/v2) · [ntfy](https://github.com/binwiederhier/ntfy) · [Vaultwarden](https://github.com/dani-garcia/vaultwarden) · [Umami](https://github.com/umami-software/umami) · [Donetick](https://github.com/donetick/donetick)

### 4.2 Docker packaging

- **The most-loved installs are single-container + SQLite + one `/data` volume**: Vaultwarden (`/data`), Actual (`/data` with `server-files/` + `user-files/`, port 5006), ntfy, Donetick, Vikunja (`docker run -p 3456:3456 -v $PWD/files:/app/vikunja/files -v $PWD/db:/db vikunja/vikunja` — its *two* mounts are a wart to avoid) ([vikunja install](https://vikunja.io/docs/installing/), [actual docker](https://actualbudget.org/docs/install/docker/)).
- Compose-required apps (Immich: server + ML + vector Postgres; Linkwarden: app + Postgres + Meilisearch) pay for it in support burden. Karakeep hedges: full compose (web + `chrome` headless + `meilisearch`) plus a documented **[minimal install](https://docs.karakeep.app/installation/minimal-install/)** — one container, `DATA_DIR=/data`, features degrade gracefully ("without meilisearch, search... completely disabled").
- **Multi-arch**: baseline linux/amd64 + linux/arm64. Karakeep's docker.yml builds natively on `ubuntu-latest` + `ubuntu-24.04-arm` runners (no QEMU), pushes `-amd64`/`-arm64` suffixed tags, then a manifest job merges them; registry build cache at `ghcr.io/karakeep-app/karakeep-build-cache` ([workflow](https://github.com/karakeep-app/karakeep/blob/main/.github/workflows/docker.yml)). Miniflux ships amd64/arm64/arm-v7/arm-v6 (+RISC-V); ntfy amd64/armv6/armv7/arm64 via GoReleaser buildx.
- **Registries**: GHCR primary for the TS apps (`ghcr.io/immich-app/*`, `ghcr.io/karakeep-app/karakeep`, `ghcr.io/linkwarden/linkwarden`, `ghcr.io/actualbudget/actual`); Go/Rust old guard mirror to Docker Hub + Quay. Karakeep dual-publishes to `ghcr.io/hoarder-app/*` post-rename for compatibility.
- **Healthcheck baked into the image**: Karakeep Dockerfile: `HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1`. Immich bundles `server/bin/immich-healthcheck` (curl `/api/server/ping`, expects `{"res":"pong"}`; [PR #9583](https://github.com/immich-app/immich/pull/9583)). Miniflux uses a self-exec subcommand: `CMD "/usr/bin/miniflux" "-healthcheck" "auto"` ([docker docs](https://miniflux.app/docs/docker.html)).

### 4.3 Config conventions

- **Env-var prefix mapping onto nested config** dominates for single-binary apps: `VIKUNJA_SERVICE_PUBLICURL` ↔ `service.publicurl` in optional `config.yml`; ntfy `NTFY_CACHE_FILE` ↔ `cache-file` in `/etc/ntfy/server.yml`, precedence CLI > env > file ([docs.ntfy.sh/config](https://docs.ntfy.sh/config/)); Donetick `DT_*` over `selfhosted.yaml` via viper (`DT_SQLITE_PATH`, 32-char `jwt.secret` required); Actual `ACTUAL_*` env > `config.json` > defaults (`ACTUAL_DATA_DIR`, `ACTUAL_PORT`, `ACTUAL_LOGIN_METHOD=password|header|openid`) ([config docs](https://actualbudget.org/docs/config/)).
- TS/Next.js apps are **env-only, no config file**: Umami's sole required var is `DATABASE_URL` (plus `APP_SECRET`; [env list](https://docs.umami.is/docs/environment-variables)); Linkwarden requires exactly three: `NEXTAUTH_SECRET`, `POSTGRES_PASSWORD`, `MEILI_MASTER_KEY`; Karakeep requires `DATA_DIR` + `NEXTAUTH_SECRET` (`openssl rand -base64 36` in docs).
- Vaultwarden is unique: env vars **plus** an admin panel (`ADMIN_TOKEN`-gated) that persists overrides to `config.json` ([wiki](https://github.com/dani-garcia/vaultwarden/wiki)).
- Recurring vars: a public/base URL (`DOMAIN`, `NEXTAUTH_URL`, `base-url`, `VIKUNJA_SERVICE_PUBLICURL`), a signup toggle (`DISABLE_SIGNUPS`, `NEXT_PUBLIC_DISABLE_REGISTRATION`), a data dir, a session secret.

### 4.4 Database & migrations

- SQLite-default: Vikunja, Vaultwarden, ntfy, Donetick, Karakeep, Actual. Postgres-only: Miniflux ("Works only with PostgreSQL"), Linkwarden, Umami, Immich. **The Prisma-based TS apps ended up Postgres-required, while Drizzle let Karakeep stay SQLite-only** — ORM choice determines the deploy story.
- **Migrations run automatically on startup** almost everywhere: Vikunja ("It will automatically run all necessary database migrations"), Karakeep (on container start), Vaultwarden (embedded Diesel), Linkwarden (`yarn prisma:deploy` in entrypoint), Umami (`check-db`/`prisma migrate deploy`). Miniflux is the only opt-in: `RUN_MIGRATIONS=1`.

### 4.5 Health, version, update-check endpoints

- Health: Immich `GET /api/server/ping` → `{"res":"pong"}`; Karakeep `GET /api/health`; ntfy `GET /v1/health` → `{"healthy":true}`; Umami `GET /api/heartbeat` → 200 (added v1.38.0); Miniflux `/healthcheck` + `-healthcheck auto` subcommand.
- **Vikunja's `GET /api/v1/info` is the best pattern for a task app**: unauthenticated JSON with `version` ("v2.3.0-1014-g2341f559"), `motd`, feature flags (`caldav_enabled`, `link_sharing_enabled`, `webhooks_enabled`, `demo_mode_enabled`), enabled auth providers, and `available_migrators: ["vikunja-file","ticktick","wekan","csv","todoist","trello"]` — the frontend renders itself from this ([try.vikunja.io/api/v1/info](https://try.vikunja.io/api/v1/info)).
- Update checks: Immich has a server-side "Version Check" setting — periodic GitHub-releases polls, announces in the web UI ([system settings](https://docs.immich.app/administration/system-settings/)); Vaultwarden's `/admin` diagnostics shows update availability; Umami checks with opt-out `DISABLE_UPDATES` (separate `DISABLE_TELEMETRY`). Pattern: **server-side GitHub releases poll + in-app banner + env kill-switch**.

### 4.6 First-run / onboarding

- **First registered user becomes admin** — Immich ("The first user to register will be the admin user", web "Getting Started" flow at `:2283`; [post-install](https://docs.immich.app/install/post-install/)). Karakeep/Linkwarden: open signup, lock later via `DISABLE_SIGNUPS` / `NEXT_PUBLIC_DISABLE_REGISTRATION`.
- Env-created admin: Miniflux `CREATE_ADMIN=1` + `ADMIN_USERNAME` + `ADMIN_PASSWORD`.
- Actual: browser prompts to **set a server password on first visit** (bootstrap screen).
- Umami ships default creds `admin`/`umami` (docs say change immediately) — weakest pattern, avoid.

### 4.7 Demos

try.vikunja.io (login demo/demo, `motd` warns of resets, **runs the `unstable` channel as a canary**, one-click `/demo-account-create/`); try.karakeep.app (demo@karakeep.app / demodemo, read-only); demo.immich.app; demo.linkwarden.app; ntfy.sh is itself the demo. Vikunja exposes `demo_mode_enabled: true` via `/info` so the UI can show a banner.

### 4.8 Docs sites & README

- Docusaurus is the plurality choice (Immich, Karakeep, Linkwarden, Actual); ntfy = MkDocs Material; Umami = Mintlify; Vaultwarden = GitHub wiki; vikunja.io = Astro. Common IA (Karakeep): Getting Started → Installation → Configuration (env table) → Integrations → Administration → Community → Development → API.
- Recurring README skeleton (Karakeep order): screenshot/logo → links row (Docs · Demo · Discord) → Features → Installation pointer → Stack → Why I built it → Alternatives → Cloud/Support → License → Star history. Umami's is the minimal effective one: Getting Started, Installing from Source, Installing with Docker, Getting Updates, Support.

### 4.9 Versioning & release engineering

- **Nobody in this cohort uses release-please or changesets.** Observed mechanisms:
  - **Immich**: `prepare-release.yml` on `workflow_dispatch` with bump-type input (patch/minor/prerelease…); bumps via mise task, commits+tags through a "Push-O-Matic" GitHub App, creates a **draft GitHub release with `generate_release_notes: true`** + body template `misc/release/notes.tmpl`, attaches `docker-compose.yml`/`.env` as release artifacts. Conventional-commit **PR titles CI-enforced** (`org-pr-require-conventional-commit.yml`); also zizmor (Actions security lint), CodeQL, docs PR-preview workflows.
  - **Actual**: monthly **CalVer** (`26.7.0`); every PR adds `upcoming-release-notes/{descriptive-name}.md` with frontmatter `category: Features|Enhancements|Bugfix|Maintenance` + `authors: [GitHubUsername]` and a one-line body; changelog compiled at release with PR links auto-resolved ([contributing](https://actualbudget.org/docs/contributing/)).
  - **Vikunja**: conventional commits → git-cliff-style `CHANGELOG.md` (Keep a Changelog headers `## [2.3.0] - 2026-04-09`, sections Features/Bug Fixes/Dependencies…, scoped entries like `*(caldav)*`); channels: **stable (`latest`, `X.Y.Z`) + `unstable`** (every merge to main, version like `v2.3.0-1014-g2341f559`) ([versions doc](https://vikunja.io/docs/versions/)).
  - **ntfy**: GoReleaser one-shot — binary matrix, `.deb`/`.rpm` nfpms with systemd units, buildx docker images tagged `latest`, `v{Major}`, `v{Major}.{Minor}`, `{Tag}`, checksums, changelog excluding docs/test commits.
  - **Karakeep**: hand-written GitHub Release → `release` event triggers docker build; images tagged `:release` (stable channel) + `:X.Y.Z`, `SERVER_VERSION` build-arg = release name (else `nightly`).
- **Docker tag menus**: `latest` + `X.Y.Z` (+`nightly`) is the norm (Miniflux, Actual incl. `-alpine` variants, Vaultwarden adds `testing`); ntfy adds major/minor rolling tags; Karakeep/Immich use a named stable channel (`release`) and tell users to pin versions in `.env` (`KARAKEEP_VERSION=release`, `IMMICH_VERSION`) — one obvious upgrade command: `docker compose pull && docker compose up -d`.

### 4.10 Licenses — why

AGPL-3.0 is the default for apps with a hosted-cloud twin (Vikunja Cloud, Karakeep Cloud, Linkwarden Cloud, Immich): Immich switched MIT→AGPLv3 explicitly "to keep anyone from using the Immich source code without making their changes public or contributing back" ([discussion #7023](https://github.com/immich-app/immich/discussions/7023), [HN](https://news.ycombinator.com/item?id=39336890)); Vaultwarden inherits AGPL via Bitwarden compatibility. Permissive picks (Umami MIT, Actual MIT, Miniflux Apache-2.0, ntfy Apache/GPLv2 dual) correlate with library/embed use-cases and no fear of SaaS resellers. **Every direct Todoist-alternative studied (Vikunja, Donetick) is AGPL-3.0.**

### 4.11 Vikunja deep-dive (closest competitor / benchmark)

- REST API at `/api/v1` with Swagger served by the app itself (`try.vikunja.io/api/v1/docs`); API tokens prefixed `tk_`.
- CalDAV: base `/dav`, principal URL `/dav/principals/<username>/`, projects at `/dav/projects/<id>/`; **VTODO only**, supports UID/SUMMARY/DESCRIPTION/PRIORITY/CATEGORIES/DUE/recurrence/alarms/parent-child; auth via password or dedicated CalDAV token (required for OIDC users); self-described "early alpha, has bugs"; works with DAVx5/Tasks/Evolution, broken in Thunderbird/iOS ([caldav doc](https://vikunja.io/docs/caldav/)).
- Quick Add Magic: `*label @assignee +project !1-5` + natural dates ("tomorrow at 5pm", "every 3 days"), with a **settings toggle "Quick Add Magic Mode → Todoist"** that switches to Todoist's `@label #project p1` keywords ([doc](https://vikunja.io/docs/quick-add-magic/)).
- Importers surfaced via `/info.available_migrators` (todoist, trello, ticktick, csv, wekan) — **a Todoist importer is table stakes**.

### 4.12 Adoption checklist for OpenDoist (solo-maintained TypeScript)

**Product shape**
1. Single container, single `/data` volume (SQLite DB + attachments + generated secrets inside). Copy Karakeep (Drizzle + better-sqlite3), not Linkwarden/Umami (Prisma forced them onto Postgres). Skip optional Postgres until proven demand; Vaultwarden/Karakeep thrive SQLite-only.
2. Pick a distinctive default port (Vikunja 3456, Actual 5006, Donetick 2021 style) and document one canonical `docker run -d -p PORT:PORT -v ./data:/data ghcr.io/…/opendoist` plus a 5-line compose.
3. Zero-required-env boot: auto-generate the session secret into `/data` on first start (beats Karakeep's mandatory `NEXTAUTH_SECRET`); only `OPENDOIST_PUBLIC_URL` needed for full features.
4. Config = env-first with `OPENDOIST_` prefix mapping to nested keys (Vikunja/ntfy pattern); document every var in one table page. Signup control: open on first boot, `OPENDOIST_DISABLE_REGISTRATION=true` after.
5. First registered user becomes admin + web "Getting Started" onboarding (Immich pattern). No default credentials ever (anti-pattern: Umami's admin/umami).

**Runtime endpoints**
6. `GET /api/health` → 200 `{"status":"ok"}`; bake `HEALTHCHECK` into the Dockerfile with wget --spider (Karakeep's exact flags).
7. `GET /api/v1/info` (unauthenticated): `version`, feature flags, auth providers, `demo_mode`, `available_importers` (Vikunja pattern). Frontend footer/settings shows version from it.
8. Server-side update check against GitHub Releases API with in-app banner + release-notes link; opt-out `OPENDOIST_DISABLE_UPDATE_CHECK=true` (Immich Version Check + Umami `DISABLE_UPDATES` pattern).
9. Migrations (Drizzle) run automatically on startup before the server listens — never a manual step (everyone except Miniflux).

**Packaging & CI (GitHub Actions)**
10. GHCR primary: `ghcr.io/<owner>/opendoist`. Tags: `latest`, `X.Y.Z`, `X.Y`, plus `nightly` from main. Multi-arch amd64+arm64 via native runners `ubuntu-latest` + `ubuntu-24.04-arm`, per-arch suffix tags merged by a manifest job, registry build cache (Karakeep's docker.yml is the template).
11. Base image `node:22-alpine` multi-stage; inject version via build-arg (`SERVER_VERSION`, Karakeep) so `/api/v1/info` is truthful for nightlies.
12. Two workflows: `ci.yml` (lint + typecheck + test + build on PR/push) and `docker.yml` (push to main → nightly; release published → versioned tags). Add zizmor for Actions hygiene later (Immich).

**Releases**
13. SemVer 0.x (Vikunja/Karakeep/Donetick all shipped years at 0.x; Actual's CalVer only makes sense with fixed monthly cadence).
14. Enforce Conventional Commit **PR titles** in CI + squash-merge (Immich `org-pr-require-conventional-commit.yml`) → generate `CHANGELOG.md` with git-cliff (Vikunja's exact output format: Keep-a-Changelog headings, scoped `*(caldav)*` entries).
15. Release flow for a solo dev: `workflow_dispatch` "prepare release" that bumps version, tags, and creates a GitHub Release with `generate_release_notes: true` + a template body linking upgrade notes (Immich), which triggers the docker publish. Hand-curate a "highlights" section per release (Karakeep). Skip release-please/changesets for the app — none of the ten use them; tag-driven + generated notes is less machinery. (Changesets still earns its keep if/when the CLI is published to npm independently — see §3.7.)
16. Attach the canonical `docker-compose.yml` + `.env` example as release assets (Immich) so users always get the compose matching that version.

**Docs, README, demo**
17. Docs: Docusaurus (4/10 cohort share; Starlight acceptable if staying Astro-native). IA: Getting Started → Installation (Docker) → Configuration (env table) → Import from Todoist → API → CalDAV → Development.
18. README order: screenshot → Docs/Demo/Discord links → Features → docker one-liner → link to docs → Contributing → License.
19. Public demo `try.opendoist.app` running the `nightly` tag with cron reset + `demo/demo` creds + `demo_mode` flag driving an in-app banner (Vikunja's exact setup — demo doubles as unstable-channel canary).
20. License: **AGPL-3.0** — matches Vikunja/Donetick/Immich/Karakeep/Linkwarden; protects a future cloud offering (Immich's rationale in discussion #7023). Choose MIT only if maximizing embedding/adoption outweighs fork protection.

**Todoist-parity roadmap markers (from Vikunja)**
21. Ship: quick-add with Todoist-compatible syntax mode, `tk_`-prefixed API tokens, Swagger/Scalar at `/api/v1/docs`, Todoist/CSV importers advertised via `/api/v1/info`, CalDAV VTODO at `/dav/principals/<user>/` (label it experimental; Vikunja still does), per-project iCal/link-sharing.

---

## 5. Notifications, iCal feeds, voice→tasks

### 5.1 Web Push (browser + desktop reminders) — `web-push` VAPID flow

**Library**: [`web-push`](https://github.com/web-push-libs/web-push) (npm). Handles VAPID JWT signing + payload encryption (`aes128gcm` default, RFC 8291).

**1. Generate VAPID keys once, store in env/config (never regenerate — existing subscriptions bind to the public key):**

```js
const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();
// { publicKey: 'BGtkbcjr…', privateKey: 'I0_d0vne…' }  (URL-safe base64)
// CLI: npx web-push generate-vapid-keys --json
webpush.setVapidDetails('mailto:admin@yourdomain.com', publicKey, privateKey);
// subject must be mailto: or https: URI
```

**2. Client subscribe (after permission granted):**

```js
const reg = await navigator.serviceWorker.ready;
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,                 // required by Chrome
  applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
});
await fetch('/api/push-subscriptions', { method: 'POST', body: JSON.stringify(sub) });
// serialized subscription = { endpoint, expirationTime, keys: { p256dh, auth } }
```

**3. Storage schema**: one row per browser/device install — a user has N subscriptions. `push_subscriptions(id, user_id, endpoint TEXT UNIQUE, p256dh, auth, user_agent, created_at, last_used_at)`. Upsert on `endpoint` (natural unique key). Delete rows on HTTP `404`/`410` from the push service (410 Gone / 404 = expired/invalid → remove; 201 = accepted; [web-push README](https://github.com/web-push-libs/web-push)).

**4. Server send:**

```js
await webpush.sendNotification(subscription, JSON.stringify({
  title: 'Task due: Renew passport',
  body: 'Due today 17:00',
  url: '/app/task/123',            // deep link, consumed in SW
  tag: 'reminder-123',
}), {
  TTL: 3600,            // seconds push service holds msg if device offline (default 4 weeks)
  urgency: 'high',      // very-low | low | normal | high
  topic: 'reminder-123',// ≤32 chars; replaces undelivered msg with same topic
});
```

**Payload limit**: 4096 bytes max per push; ≈3993 bytes plaintext after encryption overhead ([Chrome blog](https://developer.chrome.com/blog/web-push-encryption), [IETF draft](https://webpush-wg.github.io/webpush-encryption/tls_padding/draft-ietf-webpush-encryption.html)). Send only title/body/URL; fetch details in-app.

**5. Service worker handlers:**

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,               // coalesces duplicates
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',// Android monochrome
    data: { url: data.url },     // carry deep link
  }));
});
// with userVisibleOnly: true you MUST showNotification for every push,
// or Chrome shows a generic "site updated in background" warning.

self.addEventListener('notificationclick', (event) => {   // MDN notificationclick
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.focus();
          return client.navigate ? client.navigate(url) : clients.openWindow(url);
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

**6. Rotation**: handle [`pushsubscriptionchange`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event) in the SW — resubscribe with `event.oldSubscription?.options` and POST old+new endpoint to swap the row. Browser support is inconsistent, so also re-sync the current subscription on every app load (`pushManager.getSubscription()` → upsert).

### 5.2 Web Push platform support (2025–2026)

| Platform | Status | Caveats |
|---|---|---|
| **Android** (Chrome/Firefox/Edge/Samsung) | Full since 2015 | Delivered via FCM even with browser closed; works in tab or installed PWA. |
| **Windows** (Chrome, Edge, Firefox) | Full | Routes into Windows notification center; **browser process must be running** (Chrome keeps a background service by default; [Gravitec](https://gravitec.net/blog/can-you-receive-push-notifications-when-browser-not-running/)). Installed-PWA badging in Chromium. |
| **macOS** (Chrome/Firefox/Edge) | Full | Same "browser must be running" constraint. |
| **macOS Safari** | 16.1+ standard Web Push | Safari 18.5 (May 2025) added Declarative Web Push for tabs + installed web apps ([WebKit 18.5](https://webkit.org/blog/16923/webkit-features-in-safari-18-5/)). |
| **iOS/iPadOS** | 16.4+ (Mar 2023) | **Only for PWAs added to Home Screen** (`display: "standalone"`, HTTPS); no Push API in a Safari tab; all iOS browsers are WebKit; `Notification.requestPermission()` must come from a user gesture ([Apple docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [MagicBell guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)). iOS 18.4 added **Declarative Web Push**: JSON payload `{"web_push": 8030, "notification": {"title": …, "navigate": "https://…", "body": …, "app_badge": …}}` — no service worker needed ([WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)). SW-based push still works on iOS home-screen apps; declarative is an optional enhancement. |

Practical implication: web push is reliable on Android/Windows/macOS; on iOS it requires the A2HS install step — plan an in-app install prompt/instructions screen.

### 5.3 Permission UX best practices

([web.dev Permission UX](https://web.dev/articles/push-notifications-permissions-ux), [permissions best practices](https://web.dev/articles/permissions-best-practices))

- **Never prompt on page load.** Permanent block on dismissal is common (Chrome auto-quiets sites with low grant rates).
- **Two-step pre-prompt (double permission)**: in-app dialog first ("Get a notification when a reminder fires — Enable / Not now"); only call `Notification.requestPermission()` if accepted. Pre-prompts see 2–4x higher grant rates ([greadme](https://www.greadme.com/blog/best-practices/when-to-ask-for-notification-permission-complete-guide), [Pushpad](https://pushpad.xyz/blog/the-double-opt-in-for-web-push-notifications)).
- **Ask in context**: the natural moment is when the user sets their first reminder. Alternatively a settings toggle that triggers the native prompt.
- If pre-prompt declined, back off (~30 days). If native permission is `denied`, show browser-settings instructions (you cannot re-prompt).
- iOS: the native prompt is silently ignored unless triggered synchronously from a tap handler.

### 5.4 Server-side reminder scheduling

**[Croner](https://github.com/hexagon/croner)** v10.x (zero deps, Node ≥18, TS-native): `new Cron('* * * * *', { timezone: 'Europe/Berlin', catch: (e) => log(e), protect: true }, tick)`. Options: `timezone` (IANA), `catch`, `protect` (overrun protection), `maxRuns`, `startAt/stopAt`, `interval`, `paused`, `context`, `name`; also accepts a `Date`/ISO string to fire once. **DST**: jobs in DST gaps are skipped; jobs in overlaps run once at first occurrence; uses Intl for TZ math ([npm](https://www.npmjs.com/package/croner), [comparison](https://www.pkgpulse.com/guides/node-cron-vs-node-schedule-vs-croner-task-scheduling-2026) — node-cron historically skips/repeats the DST hour). **No persistence** — in-memory only.

**Recommended architecture (single node)**: don't schedule one timer per reminder. Persist reminders with a precomputed UTC instant; run **one croner tick** (every 30–60 s) scanning for due rows:

```sql
-- reminders(id, task_id, user_id, fire_at TIMESTAMPTZ, fired_at TIMESTAMPTZ NULL, channel)
SELECT * FROM reminders WHERE fire_at <= now() AND fired_at IS NULL ORDER BY fire_at LIMIT 100;
-- after successful dispatch: UPDATE reminders SET fired_at = now() WHERE id = ?
```

Properties: **misfire/catch-up after restart is automatic** (overdue rows are still due on next tick — optionally suppress/summarize anything older than ~12 h); idempotent via `fired_at` (`UPDATE … WHERE fired_at IS NULL RETURNING`, or `SELECT … FOR UPDATE SKIP LOCKED` for multi-worker). **Timezone/DST**: store the user's IANA zone + local time-of-day on the task; compute each occurrence's concrete UTC `fire_at` with a TZ library (Luxon `DateTime.fromObject({...}, {zone})` or `@date-fns/tz`); recompute the *next* occurrence only after the current one fires.

Heavier alternatives (DB-backed retries built in): [pg-boss](https://github.com/timgit/pg-boss) (Postgres SKIP LOCKED queue; cron, retries w/ exponential backoff, default `retryLimit: 2` since v10, dead-letter queues; Node ≥20, PG ≥13), BullMQ (Redis, delayed jobs), Agenda (Mongo). For SQLite self-hosted, croner-tick + due-scan is the right weight.

### 5.5 Fallback channels for self-hosters

**ntfy** ([publish docs](https://docs.ntfy.sh/publish/)) — pub/sub over HTTP; topic name is the secret. Self-host: `docker run -p 80:80 binwiederhier/ntfy serve` ([install](https://docs.ntfy.sh/install/)).

```bash
# minimal
curl -d "Task 'Renew passport' is due" https://ntfy.sh/my-secret-topic
# full
curl -H "Title: Reminder" -H "Priority: high" -H "Tags: alarm" \
     -H "Click: https://tasks.example.com/task/123" \
     -d "Renew passport — due 17:00" https://ntfy.example.com/reminders
```

JSON variant — POST to server **root**: `{"topic":"reminders","title":…,"message":…,"priority":1-5,"tags":[…],"click":"https://…","actions":[{"action":"view","label":"Open","url":"…"}],"delay":"30m"}`. Headers: `X-Title`, `X-Priority` (1–5 or `min|low|default|high|max/urgent`), `X-Tags`, `X-Click`, `X-Actions`, `X-Delay/At/In` (built-in scheduled delivery, 10 s–3 days), `X-Markdown`, `X-Icon`, `Email`. Auth: `Authorization: Bearer <token>`, Basic, or `?auth=` query param.

**Gotify** ([pushmsg docs](https://gotify.net/docs/pushmsg)) — self-hosted server + Android app + WebSocket clients.

```bash
curl "https://gotify.example.com/message" -H "X-Gotify-Key: <apptoken>" \
  -F "title=Reminder" -F "message=Renew passport" -F "priority=5"
```

JSON body also works (`Content-Type: application/json`; fields `message` (required), `title`, `priority` (int), `extras`). Token via `X-Gotify-Key`, `?token=`, or `Authorization: Bearer`; app tokens shown once on creation/rotation (Gotify 3+). Extras: `extras: {"client::display": {"contentType": "text/markdown"}}` for markdown; `"client::notification": {"click": {"url": "https://…"}}` for click-through ([more](https://gotify.net/docs/more-pushmsg), [msgextras](https://gotify.net/docs/msgextras)).

**Generic webhook** — the escape hatch (covers Discord/Slack/Home Assistant via user glue): POST user-configured URL with JSON `{ "event": "reminder.due", "task": { "id", "title", "due", "url" }, "firedAt": ISO8601 }`, HMAC-SHA256 signature header (`X-Signature: sha256=<hex>` over raw body, per-webhook secret, GitHub-style), 5–10 s timeout, 2–3 retries with backoff, disable after N consecutive failures. ntfy and Gotify are both reachable through this generic shape (ntfy even accepts plain-text POST), but native adapters map priority/click/actions.

### 5.6 iCal subscription feed for tasks

**VEVENT vs VTODO — the deciding fact**: **Google Calendar does not support VTODO** ("doesn't support VTODO or VJOURNAL data" — [Google CalDAV guide](https://developers.google.com/workspace/calendar/caldav/v2/guide)); a VTODO-only feed shows nothing. Apple Calendar also won't render VTODOs from a *subscribed* .ics (VTODO lives in Reminders via CalDAV); iOS behavior is worse than macOS ([obsidian-ical-plugin-pro notes](https://github.com/liuh886/obsidian-ical-plugin-pro), [Apple discussions](https://discussions.apple.com/thread/255073807)). Thunderbird is the main client honoring VTODO.

**Recommendation**: emit **VEVENT only** — tasks with a due date become events (all-day VEVENT on the due date when no time; fixed-length e.g. 30-min timed VEVENT when there is one). Undated tasks omitted. Prefix completed state in SUMMARY ("✓ ") or drop completed tasks after N days. Optionally a VTODO variant behind `?format=vtodo` for Thunderbird/Tasks.org users.

**Library**: [`ical-generator`](https://github.com/sebbo2002/ical-generator) v11.x (TS, ESM+CJS, VEVENT-only — matches the recommendation):

```ts
import ical, { ICalCalendarMethod } from 'ical-generator';

const cal = ical({ name: 'OpenDoist — Tasks', prodId: '//opendoist//tasks//EN', ttl: 3600 }); // ttl → X-PUBLISHED-TTL:PT1H
cal.createEvent({
  id: `task-${task.id}@opendoist.example`,   // stable UID = stable identity across refreshes
  start: task.dueDate, allDay: !task.hasTime,
  end: task.hasTime ? addMinutes(task.dueDate, 30) : undefined,
  summary: task.title,
  description: task.notes,
  url: `https://tasks.example.com/task/${task.id}`,
  categories: task.labels.map(l => ({ name: l })),
});

res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
res.end(cal.toString());
```

Timezones: pass native `Date` in UTC (simplest), or register a VTIMEZONE generator (`cal.timezone({ name: 'Europe/Berlin', generator: getVtimezoneComponent })` from `@touch4it/ical-timezones`) for wall-clock events. Alternatives: [`ts-ics`](https://github.com/Neuvernetzung/ts-ics) (`generateIcsCalendar`, Zod-validated, RFC 5545, VEVENT-focused), [`ical-builder-ts`](https://npmx.dev/package/ical-builder-ts) (fluent builder covering VTODO/VJOURNAL — for the VTODO variant later).

**Secret-token URL + rotation**: calendar clients can't send auth headers for subscriptions, so use a **capability URL** — the token *is* the credential (Google's own "Secret address" is `…/ical/<calendar-id>/private-<token>/basic.ics`; [guide](https://www.usecarly.com/blog/how-to-get-google-calendar-ics-url/)). Design:

- Route `GET /ical/:token/tasks.ics` (or `?token=`), token ≥128-bit random (32-char base64url from `crypto.randomBytes(24)`); store hashed or at least indexed + constant-time compared.
- One token per user (optionally per feed/filter). Offer `webcal://tasks.example.com/ical/<token>/tasks.ics` links — `webcal://` triggers subscribe UI in Apple Calendar/Outlook.
- **Rotation**: "Reset link" button generates a new token, immediately invalidating the old (Google "Reset" / [Teamup regenerate](https://calendar.teamup.com/kb/what-you-need-to-know-about-icalendar-feeds/)); warn that existing subscriptions break. Feeds read-only; exclude sensitive fields.
- Return `404` (not `401`) for bad tokens to avoid oracle behavior; rate-limit by IP.

**Client refresh cadence + caching**:

- **Google Calendar**: fetches URL-subscribed feeds roughly every **8–24 h** (commonly cited 12–24 h); no manual refresh; unsubscribe/resubscribe is the only force ([MoonCal](https://usemooncal.com/en/guides/google-calendar-ics-refresh), [usecarly](https://www.usecarly.com/blog/google-calendar-ics-refresh-rate/), [Google thread](https://support.google.com/calendar/thread/12658899)). Set expectations in UI ("Google may take up to a day").
- **Apple Calendar (macOS)**: per-subscription Auto-refresh: 5 min / 15 min / hourly / daily / weekly; default about hourly ([Apple support](https://support.apple.com/guide/calendar/refresh-calendars-icl1024/mac)). iOS: Settings → Calendar → Accounts → Fetch ([Calfeed](https://calfeed.ai/learn/ics-refresh-rate-apple-google)).
- **In-file hints**: `X-PUBLISHED-TTL:PT1H` (ical-generator `ttl`) + RFC 7986 `REFRESH-INTERVAL;VALUE=DURATION:PT1H` — emit both; most clients (incl. Google) ignore them ([RFC 7986 §5.7](https://icalendar.org/New-Properties-for-iCalendar-RFC-7986/5-7-refresh-interval-property.html), [icscalendar](https://icscalendar.com/faqs-and-tips/)).
- **HTTP**: `Content-Type: text/calendar; charset=utf-8`; strong `ETag` (hash of feed content or max `updated_at`) + `Last-Modified`, answer `304` to `If-None-Match`; `Cache-Control: private, max-age=300` is a sane balance (or `no-cache` + ETag for revalidation every hit; [calen.events guide](https://www.calen.events/blog/ics-file-calendar-integration-guide)). Support `HEAD`.

**Recurring tasks: expand instances, don't emit RRULE.** Expand server-side into concrete VEVENTs over a rolling window (1 month back / 6–12 months forward), each with UID `task-{id}-{occurrenceDate}@domain`:

- Task-app recurrence semantics ("after completion", `every! workday`, skip/reschedule of one occurrence, completion ending the series) do **not** map onto RFC 5545 RRULE; correct RRULE needs DTSTART+RRULE+RDATE+EXDATE plus `RECURRENCE-ID` overrides for every moved/completed instance — a known complexity sink ([Nylas on RRULE](https://www.nylas.com/blog/calendar-events-rrules/), [RFC 5545 §3.3.10](https://icalendar.org/iCalendar-RFC-5545/3-3-10-recurrence-rule.html)).
- Expansion keeps the feed a pure projection of DB state: completing/rescheduling one occurrence changes that row; no EXDATE bookkeeping; identical rendering across Google/Apple/Outlook.
- Cost: bounded window + slightly larger files; cap total events (a few hundred) to stay under Google's ~1 MB fetch comfort zone.
- Only emit literal RRULE if your engine natively stores RFC 5545 strings — then pass through (`repeating` in ical-generator, compatible with the `rrule` npm package).

### 5.7 "Ramble" voice→tasks pipeline

**Browser capture (MediaRecorder):**

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const mimeType = [
  'audio/webm;codecs=opus',   // Chrome, Firefox, Edge, Safari ≥18.4
  'audio/mp4',                // older Safari (AAC in mp4)
  'audio/webm',
].find((t) => MediaRecorder.isTypeSupported(t)) || '';
const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 });
const chunks = [];
rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
rec.onstop = async () => {
  const blob = new Blob(chunks, { type: rec.mimeType });
  const fd = new FormData();
  fd.append('audio', blob, `ramble.${rec.mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
  await fetch('/api/ramble', { method: 'POST', body: fd });
};
rec.start(1000); // 1s timeslice → data survives tab crashes mid-recording
```

Facts: Chromium/Firefox record `audio/webm` + Opus; Safari historically only `audio/mp4` + AAC; **Safari 18.4 (March 2025) added `audio/webm;codecs=opus` recording** — all evergreen browsers now support webm/opus, but keep the `audio/mp4` fallback for older iOS and always feature-detect ([cross-browser recording](https://media-codings.com/articles/recording-cross-browser-compatible-media), [MDN isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static), [WebKit MediaRecorder](https://webkit.org/blog/11353/mediarecorder-api/)). At 48 kbps mono Opus ≈ 0.36 MB/min — OpenAI's 25 MB cap fits 60+ min. Both webm and mp4/m4a are accepted by every provider below → **no server-side transcoding needed** (exception: bare whisper.cpp wants WAV unless run with `--convert`).

**Hosted STT providers (verified July 2026):**

| Provider | Model | Price | API shape |
|---|---|---|---|
| OpenAI | `gpt-4o-transcribe` | $0.006/min | `POST /v1/audio/transcriptions`, multipart `file` + `model`; `response_format` json/text; streaming supported |
| OpenAI | `gpt-4o-mini-transcribe` | $0.003/min | same endpoint; cheapest hosted option per quality |
| OpenAI | `whisper-1` (legacy) | $0.006/min | same endpoint; only model with `verbose_json` + word/segment `timestamp_granularities`; `prompt` param ≤224 tokens to bias vocabulary |
| Deepgram | `nova-3` | $0.0043/min batch (EN), $0.0077/min streaming | `POST https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true`, `Authorization: Token <KEY>`, raw binary or `{"url": …}`; transcript at `.results.channels[0].alternatives[0].transcript`; bills per second; $200 free credit |
| ElevenLabs | `scribe_v1` / `scribe_v2` | $0.22/hr (≈$0.0037/min) | `POST https://api.elevenlabs.io/v1/speech-to-text`, header `xi-api-key`, multipart `file` + `model_id=scribe_v1`; optional `diarize`, `language_code` |

OpenAI constraints: 25 MB upload cap; formats mp3/mp4/mpeg/mpga/m4a/wav/**webm** ([Audio FAQ](https://help.openai.com/en/articles/7031512-audio-api-faq), [STT guide](https://developers.openai.com/api/docs/guides/speech-to-text), [pricing](https://developers.openai.com/api/docs/pricing)). Deepgram: [getting started](https://developers.deepgram.com/docs/pre-recorded-audio), [pricing](https://deepgram.com/pricing), [nova-3 breakdown](https://convertaudiototext.com/blog/deepgram-nova-3-explained). ElevenLabs: [API ref](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [pricing](https://elevenlabs.io/pricing/api) (launched $0.40/hr, now $0.22/hr base; extras like entity detection billed separately).

**Local STT (Docker sidecar):**

- **Speaches** (ex faster-whisper-server) — best fit: OpenAI-compatible `/v1/audio/transcriptions` (+ `/v1/models`, `/v1/audio/speech`), dynamic model download from HuggingFace with TTL unload, "Ollama for STT/TTS" ([speaches.ai](https://speaches.ai/), [install](https://speaches.ai/installation/)). Backed by [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2; up to 4x faster than openai/whisper at equal accuracy; `small`/`medium` fine on CPU for voice notes).

```bash
docker run -d --name speaches -p 8000:8000 \
  -v hf-hub-cache:/home/ubuntu/.cache/huggingface/hub \
  ghcr.io/speaches-ai/speaches:latest-cpu     # or :latest-cuda with --gpus=all
# then: OpenAI SDK with baseURL http://speaches:8000/v1, model "Systran/faster-whisper-small"
```

- **whisper.cpp server** — lighter, single binary, no Python ([whisper.cpp](https://github.com/ggml-org/whisper.cpp), [server README](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server); community image [EvilFreelancer/docker-whisper-server](https://github.com/EvilFreelancer/docker-whisper-server); pattern used by [VoiceMode](https://voice-mode.readthedocs.io/en/stable/whisper.cpp/)):

```bash
./build/bin/whisper-server -m models/ggml-base.en.bin --host 0.0.0.0 --port 8080 --convert \
  --inference-path /v1/audio/transcriptions   # mimic OpenAI route; --convert uses ffmpeg for non-WAV
curl 127.0.0.1:8080/inference -F file=@ramble.webm -F response_format=json   # → {"text": "..."}
```

**LLM post-processing (transcript → structured tasks)**: one chat call with **strict JSON-schema output** (OpenAI Structured Outputs `response_format: { type: "json_schema", json_schema: { strict: true, … } }` or a single forced tool; Gemini `responseSchema`; Anthropic tool-use):

```json
{
  "type": "object", "additionalProperties": false,
  "properties": { "tasks": { "type": "array", "items": {
    "type": "object", "additionalProperties": false,
    "properties": {
      "title":    { "type": "string" },
      "notes":    { "type": ["string", "null"] },
      "due":      { "type": ["string", "null"], "description": "natural-language date phrase as spoken, e.g. 'tomorrow 5pm'; null if none" },
      "priority": { "type": ["integer", "null"], "minimum": 1, "maximum": 4 },
      "labels":   { "type": "array", "items": { "type": "string" } }
    }, "required": ["title", "notes", "due", "priority", "labels"] } } },
  "required": ["tasks"]
}
```

System prompt: "Split this voice-note transcript into discrete actionable tasks; imperative titles; don't invent tasks; keep `due` as the spoken phrase" — then parse `due` with the app's own date parser (chrono-node) so the LLM never fabricates ISO dates/timezones.

**Cheap models** (a 2-min ramble ≈ 350–500 input tokens → all ≪$0.001/ramble): `gpt-4o-mini` $0.15/$0.60 per 1M in/out ([OpenAI pricing](https://developers.openai.com/api/docs/pricing)); `gpt-5-nano` $0.05/$0.40; `gemini-2.5-flash-lite` $0.10/$0.40; `claude-haiku-4.5` $1.00/$5.00 ([BenchLM](https://benchlm.ai/llm-pricing), [cloudidr](https://www.cloudidr.com/llm-pricing)). Make the model string config, defaulting to the provider's mini tier. Local option (Ollama `llama3.1:8b` behind OpenAI-compatible `/v1/chat/completions`) drops in through the same adapter — strict-schema adherence weaker, so validate with Zod and retry once on parse failure. Post-processing must be **optional**: no LLM key → one task per ramble with raw transcript in notes.

**Pluggable provider interface:**

```ts
// stt/provider.ts
export interface SttProvider {
  id: string;                                  // 'openai' | 'openai-compatible' | 'deepgram' | 'elevenlabs'
  transcribe(audio: { data: Buffer; mimeType: string; filename: string },
             opts?: { language?: string; prompt?: string }
  ): Promise<{ text: string; language?: string; durationSec?: number }>;
}

// config (env or per-user BYO-key row, API key encrypted at rest):
// STT_PROVIDER=openai-compatible
// STT_BASE_URL=http://speaches:8000/v1      # or https://api.openai.com/v1
// STT_MODEL=Systran/faster-whisper-small    # or gpt-4o-mini-transcribe
// STT_API_KEY=sk-…                          # optional for local sidecar

export interface TaskExtractor {           // separate axis from STT
  extract(transcript: string, ctx: { now: Date; timezone: string; knownLabels: string[] })
    : Promise<{ tasks: ExtractedTask[] }>;
}
// LLM_PROVIDER=openai-compatible | anthropic | none
// LLM_BASE_URL / LLM_MODEL / LLM_API_KEY   — 'none' → passthrough single task
```

Design points: (1) **`openai-compatible` is the primary adapter** — one implementation covers OpenAI, Speaches, whisper.cpp, Groq, LocalAI purely via `baseUrl`+`model`; Deepgram/ElevenLabs are thin extra adapters (~30 lines: different auth header, different response path). (2) STT and task-extraction are **two independent provider slots** (local Whisper + hosted LLM, or vice versa). (3) BYO-key: keys entered in settings UI, stored server-side encrypted, calls proxied through the server; per-user keys override instance env defaults. (4) Pipeline stages persisted (`ramble.status: uploaded → transcribed → extracted`); raw audio + transcript retained until the user confirms generated tasks, so failed extraction is retryable without re-recording.

---

## 6. Key decisions & recommended defaults

**Identity & license**
- **AGPL-3.0** license — matches every studied Todoist-alternative (Vikunja, Donetick) and the cloud-twin cohort (Immich, Karakeep, Linkwarden); protects a future hosted offering. MIT only if embed/adoption maximization matters more than fork protection.
- SemVer **0.x** releases; monthly-ish cadence; no CalVer (that only fits Actual's fixed schedule).

**Deployment & config**
- **Single container, single `/data` volume, SQLite** (Karakeep/Vaultwarden/Actual pattern; avoid Vikunja's two-mount wart and Prisma's Postgres forcing). Distinctive default port. Canonical one-liner: `docker run -d -p PORT:PORT -v ./data:/data ghcr.io/<owner>/opendoist` + 5-line compose.
- **Zero-required-env first boot**: auto-generate session secret into `/data`; only `OPENDOIST_PUBLIC_URL` for full features. Env-first config with `OPENDOIST_` prefix mapping to nested keys; one docs page listing every var.
- **First registered user = admin**; open signup until `OPENDOIST_DISABLE_REGISTRATION=true`; never default credentials.
- Drizzle migrations run automatically at boot before listening. SQLite PRAGMAs: `journal_mode=WAL, synchronous=NORMAL, busy_timeout=5000, foreign_keys=ON`. Built-in nightly `VACUUM INTO` backup; Litestream ≥0.5.14 optional for S3 replication/PITR.

**Runtime endpoints & release engineering**
- `GET /api/health` (+ Dockerfile `HEALTHCHECK` with Karakeep's wget flags); unauthenticated `GET /api/v1/info` returning `version`, feature flags, auth providers, `demo_mode`, `available_importers` (Vikunja pattern); GitHub-releases update check with in-app banner and `OPENDOIST_DISABLE_UPDATE_CHECK` kill-switch.
- GHCR primary registry; multi-arch amd64+arm64 on native runners with per-arch tags + manifest merge (copy Karakeep's docker.yml); tags `latest`, `X.Y.Z`, `X.Y`, `nightly`; version injected via build-arg. Conventional-commit PR titles enforced in CI; git-cliff changelog; `workflow_dispatch` prepare-release + `generate_release_notes: true` (Immich); attach `docker-compose.yml` + `.env` to releases. **Tag-driven releases for the app** (none of the 10 studied apps use release-please/changesets); **changesets only for npm-published packages** (the CLI).
- Docs on Docusaurus (or Starlight); README: screenshot → Docs/Demo/Discord → Features → docker one-liner → docs link → Contributing → License. Public demo `try.opendoist.app` on the `nightly` tag with cron reset, `demo/demo` creds, `demo_mode` banner.

**Stack (versions = §3.9 table)**
- pnpm workspaces (core/api/web/cli) + catalogs; Turborepo later. Hono + `@hono/node-server`, `@hono/zod-openapi` (Zod 4), Scalar docs UI, **SSE** (not WebSockets) for live updates. Drizzle + better-sqlite3; FTS5 external-content + triggers in a custom migration for search. better-auth (+ `@better-auth/api-key` for `tk_`-style tokens, `@better-auth/sso` later); scrypt default, argon2id optional.
- Web: Vite 8 + React 19 + TanStack Query 5 + Zustand 5; shadcn/ui on Base UI + Tailwind 4 `@theme`; dnd-kit (watch pragmatic-dnd); cmdk palette; react-hotkeys-hook v5 sequences (`'g>t'`); TanStack Virtual for long lists.
- Quick-add: chrono-node (match offsets) + rich-textarea overlay — not contenteditable. Recurrence: rrule-temporal, **store RFC-5545 strings**, plus a small NL→RRULE layer for Todoist grammar (`every` vs `every!` needs app-level "from completion" handling — not expressible in RRULE). Dates: date-fns 4 + @date-fns/tz (+ temporal-polyfill). CLI: commander + env-paths (`~/.config/opendoist/config.json`, `OPENDOIST_TOKEN` override) + `util.styleText`. Biome, Vitest + Playwright, tsdown for published packages. Code health: react-doctor + knip; trial fallow before gating CI.

**Product scope (Todoist parity v1)**
- Quick Add tokens: `#project`, `/section`, `@label`, `p1–p4`, `+assignee`, `{deadline}`, `!reminder`, `for <duration>`, `* ` uncompletable; natural-language dates + full recurring grammar (§1.2–1.3); due ≠ deadline ≠ reminder semantics (§1.4). Support a Vikunja-style syntax-mode toggle if diverging.
- Filter language with `& | ! () , \ *` operators and the full keyword set (§1.7); views Today/Upcoming/label/filter with per-view display options; keyboard-first UX per the full shortcut map (§1.6).
- API: cursor pagination, opaque IDs, priority stored 1–4 with **4 = UI p1** (Todoist quirk — decide early whether to copy or invert, and document it); optional sync-style batch endpoint later (≤100 commands/batch). **Todoist importer is table stakes**; CalDAV (VTODO) later, labeled experimental.
- Reminders: automatic reminder on timed tasks (default 30 min before, configurable/off), relative/absolute/recurring types; croner tick + DB due-scan dispatcher (restart-safe, idempotent via `fired_at`); channels = web push (VAPID, two-step permission pre-prompt, iOS requires A2HS) + ntfy + Gotify + generic HMAC webhook + email.
- Calendar: capability-URL `.ics` feed (`webcal://`), **VEVENT-only**, recurrences expanded server-side (no RRULE emission), ETag/304 + `Cache-Control: private, max-age=300`, per-user token with reset; document Google's 8–24 h refresh lag.
- Ramble: MediaRecorder (webm/opus, mp4 fallback) → pluggable STT (`openai-compatible` adapter covers OpenAI + Speaches + whisper.cpp; Deepgram/ElevenLabs bespoke) → optional LLM task-split with strict JSON schema, `due` kept as spoken phrase and parsed by chrono-node; degrade to raw-transcript task with no LLM key.

**Design defaults**
- **Kale green `#4c7a45`** as default accent (4.59:1 AA on white); full Todoist theme set as `[data-theme]` override blocks; only "Dark" is a dark scheme; explicit theme beats OS auto both ways.
- Radii **5px/10px** only; "medium" weight = **600**; 12/13/14/16/20/24/32 type scale; 4px spacing grid; sidebar 280px (210–420), content max 800px; task row ~42px with 18px priority-ringed checkbox (10%→20% fill, 250ms linear complete animation).
- Priority colors p1 `#d1453b` / p2 `#eb8909` / p3 `#246fe0` / p4 `#999999` with dark variants; 20-color project palette (API ids 30–49) with dark-mode overrides; **focus ring always blue `#1f60c2`**, never the accent; toast z 400 / tooltip z 1000; Lucide icons, strokeWidth 1.75 at 20–24px.


