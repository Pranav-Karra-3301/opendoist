import { Link } from '@tanstack/react-router'
import { CalendarCheck, CalendarDays, Inbox, type LucideIcon, Plus } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useState } from 'react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import { useViewCounts } from './counts'
import { SidebarProjects } from './sidebar-projects'

const SIDEBAR_DEFAULT = 280

const NAV_LINK_CLASS =
  'flex h-8 items-center gap-2 rounded-sm px-[5px] text-body outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const NAV_ACTIVE = { className: 'bg-selected font-medium text-selected-text' }
const NAV_INACTIVE = { className: 'text-text-primary hover:bg-sidebar-hover' }

function NavRowContent({
  icon: Icon,
  label,
  count,
  isActive,
}: {
  icon: LucideIcon
  label: string
  count?: number
  isActive: boolean
}) {
  return (
    <>
      <Icon
        size={20}
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn('shrink-0', isActive ? 'text-accent' : 'text-text-secondary')}
      />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-caption text-text-tertiary tabular-nums">{count}</span>
      )}
    </>
  )
}

function ResizeHandle({
  onResize,
  onReset,
  onDragChange,
}: {
  onResize: (px: number) => void
  onReset: () => void
  onDragChange: (dragging: boolean) => void
}) {
  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault()
    onDragChange(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent): void => onResize(ev.clientX)
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      onDragChange(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <button
      type="button"
      aria-label="Resize sidebar"
      tabIndex={-1}
      onPointerDown={startDrag}
      onDoubleClick={onReset}
      className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40"
    />
  )
}

/** Resizable, collapsible sidebar: Add task, Inbox/Today/Upcoming nav, project tree. */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const width = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen)
  const [dragging, setDragging] = useState(false)
  const counts = useViewCounts()

  return (
    <aside
      aria-label="Sidebar"
      aria-hidden={collapsed || undefined}
      data-collapsed={collapsed}
      style={{ width: collapsed ? 0 : width }}
      className={cn(
        'group/sidebar relative h-full shrink-0 overflow-hidden bg-surface',
        !dragging && 'transition-[width] duration-300 ease-standard',
      )}
    >
      <div
        inert={collapsed || undefined}
        style={{ width }}
        className="flex h-full flex-col transition-transform duration-300 ease-standard group-data-[collapsed=true]/sidebar:-translate-x-full"
      >
        <div className="px-2 pt-3">
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-[5px] font-medium text-accent text-body outline-none transition-colors hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
              <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
            </span>
            Add task
          </button>
          <nav className="mt-1 flex flex-col gap-px">
            <Link
              to="/inbox"
              className={NAV_LINK_CLASS}
              activeProps={NAV_ACTIVE}
              inactiveProps={NAV_INACTIVE}
            >
              {({ isActive }) => (
                <NavRowContent
                  icon={Inbox}
                  label="Inbox"
                  count={counts.inbox}
                  isActive={isActive}
                />
              )}
            </Link>
            <Link
              to="/today"
              className={NAV_LINK_CLASS}
              activeProps={NAV_ACTIVE}
              inactiveProps={NAV_INACTIVE}
            >
              {({ isActive }) => (
                <NavRowContent
                  icon={CalendarCheck}
                  label="Today"
                  count={counts.today}
                  isActive={isActive}
                />
              )}
            </Link>
            <Link
              to="/upcoming"
              className={NAV_LINK_CLASS}
              activeProps={NAV_ACTIVE}
              inactiveProps={NAV_INACTIVE}
            >
              {({ isActive }) => (
                <NavRowContent icon={CalendarDays} label="Upcoming" isActive={isActive} />
              )}
            </Link>
          </nav>
        </div>
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          <SidebarProjects />
        </div>
      </div>
      <ResizeHandle
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        onDragChange={setDragging}
      />
    </aside>
  )
}
