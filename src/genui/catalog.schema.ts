import { z } from 'zod'

export const ALLOWED_COMPONENTS = [
  'TaskCard',
  'TaskList',
  'KanbanBoard',
  'Timeline',
  'HabitGrid',
  'CalendarView',
  'CountdownRing',
  'BudgetTracker',
  'ProgressDashboard',
  'ChecklistGroup',
  'FocusTimer',
] as const

export type CatalogComponent = (typeof ALLOWED_COMPONENTS)[number]

type LayoutNodeInput = {
  id: string
  component: CatalogComponent
  props: Record<string, unknown>
  children?: LayoutNodeInput[]
}

const LayoutNodeSchema: z.ZodType<LayoutNodeInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(50),
    component: z.enum(ALLOWED_COMPONENTS),
    props: z.record(z.unknown()),
    children: z.array(LayoutNodeSchema).optional(),
  }),
)

export const LayoutSpecSchema = z.object({
  version: z.union([z.literal('1'), z.string()]).transform(() => '1' as const),
  title: z.string().max(100),
  description: z.string().max(300).optional(),
  layout: z.array(LayoutNodeSchema).min(1).max(8),
})

export type LayoutSpec = z.infer<typeof LayoutSpecSchema>

export function validateLayoutSpec(raw: unknown): LayoutSpec {
  const result = LayoutSpecSchema.safeParse(raw)
  if (result.success) return result.data

  // Best-effort recovery: filter out invalid nodes and retry
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).layout)) {
    const fixed = {
      ...(raw as Record<string, unknown>),
      version: '1',
      layout: ((raw as Record<string, unknown>).layout as unknown[]).filter(
        (node) => node && typeof node === 'object' &&
          ALLOWED_COMPONENTS.includes((node as Record<string, unknown>).component as CatalogComponent)
      ),
    }
    const retry = LayoutSpecSchema.safeParse(fixed)
    if (retry.success) return retry.data
  }

  throw new Error(`Invalid layout spec: ${result.error.message}`)
}
