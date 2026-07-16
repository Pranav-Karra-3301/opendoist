/**
 * Dialog host — FROZEN by Task A (plan Step 5). Mounted ONCE in the app layout.
 * Renders every dialog unconditionally: each component reads `useDialogStore`
 * internally and renders nothing unless its `kind` is the open request.
 */
import FilterDialog from './FilterDialog'
import LabelDialog from './LabelDialog'
import ProjectConfirms from './ProjectConfirms'
import ProjectDialog from './ProjectDialog'

export default function DialogHost() {
  return (
    <>
      <ProjectDialog />
      <ProjectConfirms />
      <LabelDialog />
      <FilterDialog />
    </>
  )
}
