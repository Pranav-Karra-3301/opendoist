/**
 * Task-detail comments (Task H). Plain-text list + composer — markdown is NOT rendered in
 * v1 (the dossier defers rich comment rendering to a later phase). The composer auto-focuses
 * when the ui-store `detailCommentFocus` flag is set (keyboard `c`), then clears the flag.
 */
import { useEffect, useRef, useState } from 'react'
import { useCommentMutations, useComments } from '@/api/hooks/comments'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui'

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Comments({ taskId }: { taskId: string }) {
  const { data: comments } = useComments(taskId)
  const { create } = useCommentMutations(taskId)
  const detailCommentFocus = useUiStore((s) => s.detailCommentFocus)
  const setDetailCommentFocus = useUiStore((s) => s.setDetailCommentFocus)
  const [draft, setDraft] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (detailCommentFocus) {
      composerRef.current?.focus()
      setDetailCommentFocus(false)
    }
  }, [detailCommentFocus, setDetailCommentFocus])

  const submit = () => {
    const content = draft.trim()
    if (content === '' || create.isPending) return
    create.mutate({ content }, { onSuccess: () => setDraft('') })
  }

  const list = comments ?? []

  return (
    <section aria-label="Comments">
      <h2 className="mb-3 font-medium text-caption text-text-secondary">Comments</h2>
      {list.length > 0 && (
        <ul className="mb-4 flex flex-col gap-4">
          {list.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1">
              <span className="text-caption text-text-tertiary">
                {formatTimestamp(comment.created_at)}
              </span>
              <p className="whitespace-pre-wrap break-words text-copy text-text-primary">
                {comment.content}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col items-end gap-2">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Comment"
          rows={2}
          className="w-full resize-y rounded-sm border border-input-border bg-surface-raised px-2 py-1.5 text-copy text-text-primary outline-none transition-colors duration-150 ease-standard placeholder:text-text-tertiary focus:border-input-border-focus"
        />
        <Button size="sm" onClick={submit} disabled={draft.trim() === '' || create.isPending}>
          Comment
        </Button>
      </div>
    </section>
  )
}
