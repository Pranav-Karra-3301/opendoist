/**
 * The ONLY module allowed to import @dnd-kit/* (spec risk register: dnd-kit is frozen
 * upstream; pragmatic-dnd is the named replacement — swapping happens here, once).
 * Consumers import every dnd symbol from '@/lib/dnd'.
 */
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core'

export type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core'
export {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
export {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
export { CSS } from '@dnd-kit/utilities'

/** App-standard sensors: pointer drags start after 4px so row clicks stay clicks. */
export function useAppSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
}
