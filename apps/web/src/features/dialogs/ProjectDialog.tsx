/**
 * Project create/edit dialog (Task F). Opened via `useDialogStore` with
 * `{ kind: 'project', mode, projectId? }`. Name + description + 20-color palette +
 * parent-project select (excludes the Inbox, the project itself, and its descendants) +
 * "add to favorites" switch. Create → POST /projects, edit → PATCH /projects/:id, both
 * invalidating the `['projects']` cache. Editing the Inbox is refused server-side (only
 * view prefs may change), so the dialog shows an informational notice instead of a form.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { type ApiError, api, endpoints } from '@/api/client'
import { useProjects } from '@/api/hooks/projects'
import { qk } from '@/api/keys'
import { type Project, ProjectSchema } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ColorPicker, type ProjectColor } from './ColorPicker'
import { useDialogStore } from './store'

const DEFAULT_COLOR: ProjectColor = 'charcoal'

/** `rootId` plus every descendant project id (BFS over parent links). */
export function collectSubtreeIds(
  projects: ReadonlyArray<Pick<Project, 'id' | 'parent_id'>>,
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const p of projects) {
    if (p.parent_id === null) continue
    const list = childrenByParent.get(p.parent_id)
    if (list === undefined) childrenByParent.set(p.parent_id, [p.id])
    else list.push(p.id)
  }
  const result = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child)
        stack.push(child)
      }
    }
  }
  return result
}

/** Projects offerable as a parent: never the Inbox, an archived project, the project
 *  itself, or any of its descendants (which would create a cycle). Sorted by name. */
export function eligibleParents(projects: readonly Project[], selfId?: string): Project[] {
  const excluded = selfId !== undefined ? collectSubtreeIds(projects, selfId) : new Set<string>()
  return projects
    .filter((p) => !p.is_inbox && !p.is_archived && !excluded.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const FIELD_LABEL = 'font-medium text-caption text-text-secondary'
const NO_PARENT = 'none'

function ProjectForm({
  mode,
  project,
  projects,
  onClose,
}: {
  mode: 'create' | 'edit'
  project: Project | undefined
  projects: readonly Project[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [color, setColor] = useState<string>(project?.color ?? DEFAULT_COLOR)
  const [parentId, setParentId] = useState<string | null>(project?.parent_id ?? null)
  const [favorite, setFavorite] = useState(project?.is_favorite ?? false)

  const parents = eligibleParents(projects, project?.id)
  const parentItems: Record<string, ReactNode> = { [NO_PARENT]: 'No parent' }
  for (const p of parents) parentItems[p.id] = p.name

  const save = useMutation<Project, ApiError, void>({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        color,
        parent_id: parentId,
        is_favorite: favorite,
      }
      return mode === 'create'
        ? api(endpoints.projects, { method: 'POST', body, schema: ProjectSchema })
        : api(endpoints.project(project?.id ?? ''), {
            method: 'PATCH',
            body,
            schema: ProjectSchema,
          })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.projects })
      onClose()
    },
  })

  const canSave = name.trim().length > 0 && !save.isPending

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate()
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="project-name" className={FIELD_LABEL}>
          Name
        </label>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          autoFocus
          maxLength={120}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="project-description" className={FIELD_LABEL}>
          Description
        </label>
        <textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          rows={2}
          className="min-h-[56px] w-full resize-none rounded-sm border border-input-border bg-surface-raised px-2 py-1.5 text-body text-text-primary outline-none transition-colors duration-150 ease-standard placeholder:text-text-tertiary focus:border-input-border-focus"
        />
      </div>

      <div className="grid gap-2">
        <span className={FIELD_LABEL}>Color</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div className="grid gap-1.5">
        <span className={FIELD_LABEL}>Parent project</span>
        <Select
          items={parentItems}
          value={parentId ?? NO_PARENT}
          onValueChange={(v: string | null) =>
            setParentId(v !== null && v !== NO_PARENT ? v : null)
          }
        >
          <SelectTrigger aria-label="Parent project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT}>No parent</SelectItem>
            {parents.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span id="project-favorite-label" className="text-body text-text-primary">
          Add to favorites
        </span>
        <Switch
          checked={favorite}
          onCheckedChange={setFavorite}
          aria-labelledby="project-favorite-label"
        />
      </div>

      {save.isError ? <p className="text-caption text-danger">{save.error.message}</p> : null}

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {mode === 'create' ? 'Add project' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function InboxNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid gap-4">
      <p className="max-w-prose text-copy text-text-secondary">
        The Inbox is a system project. You can change how it&rsquo;s displayed from its Display
        options, but it can&rsquo;t be renamed, recolored, moved, or deleted.
      </p>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  )
}

export default function ProjectDialog() {
  const req = useDialogStore((s) => s.open)
  const close = useDialogStore((s) => s.close)
  const { data: projects, isLoading } = useProjects()

  const projReq = req !== null && req.kind === 'project' ? req : null
  const open = projReq !== null
  const editing = projReq?.mode === 'edit'
  const project = editing && projReq ? projects?.find((p) => p.id === projReq.projectId) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {open ? (
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit project' : 'Add project'}</DialogTitle>
          </DialogHeader>
          {editing && project?.is_inbox ? (
            <InboxNotice onClose={close} />
          ) : editing && project === undefined ? (
            <p className="py-4 text-copy text-text-tertiary">
              {isLoading ? 'Loading…' : 'Project not found.'}
            </p>
          ) : (
            <ProjectForm
              key={project?.id ?? 'new'}
              mode={editing ? 'edit' : 'create'}
              project={project}
              projects={projects ?? []}
              onClose={close}
            />
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
