import type { Command } from 'commander'
import type { ProjectDto } from '../lib/api'
import { createContext, io, runAction } from '../lib/context'
import { CliError, UsageError } from '../lib/errors'
import { jsonOut, projectTable, sectionTable } from '../lib/format'

interface ProjectAddOpts {
  color?: string
  parent?: string
}
interface SectionListOpts {
  project?: string
}

/**
 * Orders projects for display and stable JSON: inbox first, then root projects by
 * `child_order`, with each project's children (also by `child_order`) depth-first
 * beneath it. A project whose parent is absent from the set (e.g. an archived parent
 * already filtered out) is promoted to a root so it is never dropped.
 */
function orderProjectTree(projects: ProjectDto[]): ProjectDto[] {
  const present = new Set(projects.map((p) => p.id))
  const childrenOf = new Map<string, ProjectDto[]>()
  for (const project of projects) {
    if (project.parent_id !== null && present.has(project.parent_id)) {
      const siblings = childrenOf.get(project.parent_id) ?? []
      siblings.push(project)
      childrenOf.set(project.parent_id, siblings)
    }
  }
  const roots = projects
    .filter((p) => p.parent_id === null || !present.has(p.parent_id))
    .sort((a, b) => {
      if (a.is_inbox !== b.is_inbox) return a.is_inbox ? -1 : 1
      return a.child_order - b.child_order
    })
  const ordered: ProjectDto[] = []
  const seen = new Set<string>()
  const visit = (node: ProjectDto): void => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    ordered.push(node)
    const children = [...(childrenOf.get(node.id) ?? [])].sort(
      (a, b) => a.child_order - b.child_order,
    )
    for (const child of children) visit(child)
  }
  for (const root of roots) visit(root)
  return ordered
}

/** Resolves a project reference: exact id first, else a unique case-insensitive name. */
function resolveProjectRef(projects: ProjectDto[], ref: string): ProjectDto {
  const byId = projects.find((p) => p.id === ref)
  if (byId !== undefined) return byId
  const lowered = ref.toLowerCase()
  const byName = projects.filter((p) => p.name.toLowerCase() === lowered)
  if (byName.length === 1) return byName[0] as ProjectDto
  if (byName.length === 0) {
    throw new CliError(`no project named "${ref}"`, {
      hint: 'run `opentask projects` to list projects',
    })
  }
  throw new CliError(`multiple projects named "${ref}" — pass the project id instead`)
}

export function registerProjectCommands(program: Command): void {
  const projects = program
    .command('projects')
    .description('list projects in tree order, or manage them')
    .action(
      runAction(async (_opts: Record<string, never>, command: Command) => {
        const ctx = createContext(command)
        const active = (await ctx.api.listProjects()).filter((p) => !p.is_archived)
        const ordered = orderProjectTree(active)
        if (ctx.json) {
          io.out(jsonOut(ordered))
          return
        }
        io.out(projectTable(ordered, ctx.fmt))
      }),
    )

  projects
    .command('add <name>')
    .description('create a project')
    .option('--color <color>', 'color name (e.g. green, berry_red)')
    .option('--parent <projectRef>', 'parent project (id or exact name)')
    .action(
      runAction(async (name: string, opts: ProjectAddOpts, command: Command) => {
        const ctx = createContext(command)
        const body: { name: string; color?: string; parent_id?: string } = { name }
        if (opts.color !== undefined) body.color = opts.color
        if (opts.parent !== undefined) {
          const all = await ctx.api.listProjects()
          body.parent_id = resolveProjectRef(all, opts.parent).id
        }
        const created = await ctx.api.createProject(body)
        if (ctx.json) {
          io.out(jsonOut(created))
          return
        }
        io.out(`✓ created project ${created.name} (${created.id})`)
      }),
    )

  const sections = program
    .command('sections')
    .description('list sections (optionally scoped to a project), or manage them')
    // `--project` lives on the parent so `sections` (list) and `sections add` can share the
    // same flag without commander's parent/child option collision; `add` reads it via
    // optsWithGlobals(). (Program-level positional options would fix the collision too, but
    // they break the global `--json` flag after a subcommand, so this is the safe route.)
    .option(
      '--project <projectRef>',
      'scope to this project by id or exact name (also used by `sections add`)',
    )
    .action(
      runAction(async (opts: SectionListOpts, command: Command) => {
        const ctx = createContext(command)
        // Projects are needed to resolve --project and to label the human table; skip the
        // fetch only for an unscoped --json listing where neither is required.
        const needProjects = opts.project !== undefined || !ctx.json
        const projectList = needProjects ? await ctx.api.listProjects() : []
        const projectId =
          opts.project !== undefined ? resolveProjectRef(projectList, opts.project).id : undefined
        const list = await ctx.api.listSections(
          projectId !== undefined ? { project_id: projectId } : {},
        )
        if (ctx.json) {
          io.out(jsonOut(list))
          return
        }
        const projectNames = new Map(projectList.map((p) => [p.id, p.name]))
        io.out(sectionTable(list, projectNames, ctx.fmt))
      }),
    )

  sections
    .command('add <name>')
    .description('create a section within a project (pass --project on `sections`)')
    .action(
      runAction(async (name: string, _opts: Record<string, never>, command: Command) => {
        // --project is declared on the parent `sections`; read it through the ancestor chain.
        const projectRef = command.optsWithGlobals<{ project?: string }>().project
        if (projectRef === undefined || projectRef === '') {
          throw new UsageError(
            "missing required option '--project <projectRef>'",
            'e.g. opentask sections add "Admin" --project Work',
          )
        }
        const ctx = createContext(command)
        const projectList = await ctx.api.listProjects()
        const projectId = resolveProjectRef(projectList, projectRef).id
        const created = await ctx.api.createSection({ name, project_id: projectId })
        if (ctx.json) {
          io.out(jsonOut(created))
          return
        }
        io.out(`✓ created section ${created.name} (${created.id})`)
      }),
    )
}
