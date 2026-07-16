/**
 * Filters & Labels page (Task D, route `/filters-labels`, `G then V`). Two reorderable
 * sections in the 800px content column: saved filters and labels, each with an Add button,
 * favorite stars, inline reorder, and edit/delete via the shared dialog + undo stores.
 */
import { ViewHeader } from '@/components/view-header'
import { FilterList } from './FilterList'
import { LabelList } from './LabelList'

export default function FiltersLabelsPage() {
  return (
    <div className="mx-auto max-w-[var(--content-max)] px-6 pb-24">
      <ViewHeader title="Filters & Labels" />
      <FilterList />
      <LabelList />
    </div>
  )
}
