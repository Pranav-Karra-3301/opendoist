/**
 * Settings → Quick Add: reorder and show/hide the buttons under the Quick Add field, and choose
 * icons-only vs labeled. Drag + toggles write the FULL `quickAdd.chips` array through the optimistic
 * `useUserSettings` PATCH (the document merges shallow at the top level, so a partial would drop the
 * untouched prefs). The composer chip row (components/quick-add/chip-row.tsx) reads the same prefs;
 * the preview strip renders them with the shared chip visuals. Implements plan Task Q.
 */
import type { QuickAddChipId } from '@opendoist/core'
import { GripVertical } from 'lucide-react'
import {
  type ChipPref,
  moveChip,
  normalizeChips,
  setChipVisible,
} from '@/components/quick-add/chip-prefs'
import { QUICK_ADD_CHIP_META, QuickAddChipsPreview } from '@/components/quick-add/chip-row'
import { Switch } from '@/components/ui/switch'
import {
  CSS,
  closestCenter,
  DndContext,
  type DragEndEvent,
  SortableContext,
  useAppSensors,
  useSortable,
  verticalListSortingStrategy,
} from '@/lib/dnd'
import { cn } from '@/lib/utils'
import { SettingRow, SettingsSection } from '../ui'
import { useUserSettings } from '../useSettings'

function ChipSettingRow({
  id,
  visible,
  onToggle,
}: {
  id: QuickAddChipId
  visible: boolean
  onToggle: (value: boolean) => void
}) {
  const { name, Icon } = QUICK_ADD_CHIP_META[id]
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  return (
    <div
      ref={setNodeRef}
      data-chip-id={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 bg-surface-raised px-4 py-3',
        isDragging && 'z-10 opacity-60 shadow-drag',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${name}`}
        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-tertiary outline-none transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)] active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <Icon size={16} className="shrink-0 text-text-secondary" aria-hidden />
      <span className="flex-1 text-body text-text-primary">{name}</span>
      <Switch checked={visible} onCheckedChange={onToggle} aria-label={`Show ${name} button`} />
    </div>
  )
}

export default function QuickAddPage() {
  const { settings, update } = useUserSettings()
  const chips = normalizeChips(settings.quickAdd.chips)
  const labeled = settings.quickAdd.labeled
  const sensors = useAppSensors()

  const writeChips = (next: ChipPref[]): void =>
    update({ quickAdd: { ...settings.quickAdd, chips: next } })

  const onDragEnd = (event: DragEndEvent): void => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (overId === null || overId === activeId) return
    writeChips(moveChip(chips, activeId, overId))
  }

  return (
    <div className="max-w-2xl">
      <section className="mb-8">
        <h2 className="mb-1 font-medium text-subtitle text-text-primary">Preview</h2>
        <p className="mb-3 max-w-prose text-copy text-text-secondary">
          How the buttons appear beneath the Quick Add field.
        </p>
        <div className="rounded-lg border border-border bg-surface-raised p-4">
          <QuickAddChipsPreview prefs={{ chips, labeled }} />
        </div>
      </section>

      <SettingsSection
        title="Buttons"
        description="Drag to reorder and toggle which buttons appear. Hidden buttons stay reachable from the … menu in the composer. Project is always shown."
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={chips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {chips.map((chip) => (
              <ChipSettingRow
                key={chip.id}
                id={chip.id}
                visible={chip.visible}
                onToggle={(value) => writeChips(setChipVisible(chips, chip.id, value))}
              />
            ))}
          </SortableContext>
        </DndContext>
      </SettingsSection>

      <SettingsSection title="Display">
        <SettingRow
          label="Show labels on buttons"
          description="Turn off to show icons only."
          control={
            <Switch
              checked={labeled}
              onCheckedChange={(value) =>
                update({ quickAdd: { ...settings.quickAdd, labeled: value } })
              }
              aria-label="Show labels on buttons"
            />
          }
        />
      </SettingsSection>
    </div>
  )
}
