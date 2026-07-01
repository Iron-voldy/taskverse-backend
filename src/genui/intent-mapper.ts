import type { LayoutSpec } from './catalog.schema'

// ─── Intent → Layout rule engine ─────────────────────────────────────────────
// Covers the full component catalog without any API calls.

interface Rule {
  keywords: string[]
  spec: (intent: string) => LayoutSpec
}

function node(
  id: string,
  component: LayoutSpec['layout'][0]['component'],
  props: Record<string, unknown> = {},
) {
  return { id, component, props }
}

const RULES: Rule[] = [
  // ── Focus / deep work / pomodoro ──────────────────────────────────────────
  {
    keywords: ['focus', 'pomodoro', 'deep work', 'concentrate', 'distraction', 'study session', 'work session'],
    spec: (intent) => ({
      version: '1',
      title: 'Focus Session',
      description: `Distraction-free workspace for: "${intent}"`,
      layout: [
        node('focus-timer', 'FocusTimer', { duration: 25, label: intent }),
        node('task-list', 'TaskList', { filter: 'in_progress', title: 'Active Tasks' }),
      ],
    }),
  },

  // ── Habit / routine / daily ───────────────────────────────────────────────
  {
    keywords: ['habit', 'routine', 'daily', 'morning', 'evening', 'ritual', 'streak', 'track', 'consistent'],
    spec: (intent) => ({
      version: '1',
      title: 'Habit Tracker',
      description: `Daily tracking for: "${intent}"`,
      layout: [
        node('habit-grid', 'HabitGrid', { title: intent, weeks: 8 }),
        node('checklist', 'ChecklistGroup', { title: 'Today\'s Checklist', items: [] }),
      ],
    }),
  },

  // ── Budget / money / finance ──────────────────────────────────────────────
  {
    keywords: ['budget', 'money', 'finance', 'expense', 'cost', 'spend', 'invoice', 'payment', 'salary', 'income', 'renovation'],
    spec: (intent) => ({
      version: '1',
      title: 'Budget Tracker',
      description: `Financial overview for: "${intent}"`,
      layout: [
        node('budget', 'BudgetTracker', { title: intent, currency: 'USD' }),
        node('progress', 'ProgressDashboard', { title: 'Budget Progress', showStats: true }),
      ],
    }),
  },

  // ── Kanban / board / sprint / agile ──────────────────────────────────────
  {
    keywords: ['kanban', 'board', 'sprint', 'agile', 'scrum', 'backlog', 'ticket', 'pipeline', 'workflow'],
    spec: (intent) => ({
      version: '1',
      title: 'Kanban Board',
      description: `Project board for: "${intent}"`,
      layout: [
        node('kanban', 'KanbanBoard', { title: intent }),
      ],
    }),
  },

  // ── Timeline / project / roadmap / milestones ─────────────────────────────
  {
    keywords: ['timeline', 'roadmap', 'milestone', 'project', 'phase', 'plan', 'schedule', 'launch', 'release', 'trip', 'travel', 'journey', 'vacation'],
    spec: (intent) => ({
      version: '1',
      title: 'Project Timeline',
      description: `Roadmap for: "${intent}"`,
      layout: [
        node('timeline', 'Timeline', { title: intent }),
        node('progress', 'ProgressDashboard', { title: 'Overall Progress', showStats: true }),
      ],
    }),
  },

  // ── Calendar / event / appointment / meeting ──────────────────────────────
  {
    keywords: ['calendar', 'event', 'appointment', 'meeting', 'schedule', 'date', 'week', 'month', 'upcoming'],
    spec: (intent) => ({
      version: '1',
      title: 'Calendar View',
      description: `Schedule overview for: "${intent}"`,
      layout: [
        node('calendar', 'CalendarView', { title: intent }),
        node('task-list', 'TaskList', { filter: 'upcoming', title: 'Upcoming Tasks' }),
      ],
    }),
  },

  // ── Countdown / deadline / timer / event date ─────────────────────────────
  {
    keywords: ['countdown', 'deadline', 'due', 'days left', 'time left', 'remaining', 'exam', 'interview'],
    spec: (intent) => ({
      version: '1',
      title: 'Countdown',
      description: `Tracking time for: "${intent}"`,
      layout: [
        node('countdown', 'CountdownRing', { label: intent, targetDate: null }),
        node('checklist', 'ChecklistGroup', { title: 'Preparation Checklist', items: [] }),
      ],
    }),
  },

  // ── Study / learn / read / exam ───────────────────────────────────────────
  {
    keywords: ['study', 'learn', 'read', 'course', 'lesson', 'chapter', 'exam', 'test', 'quiz', 'revision', 'notes'],
    spec: (intent) => ({
      version: '1',
      title: 'Study Plan',
      description: `Learning workspace for: "${intent}"`,
      layout: [
        node('focus-timer', 'FocusTimer', { duration: 25, label: 'Study Block' }),
        node('checklist', 'ChecklistGroup', { title: 'Topics to Cover', items: [] }),
        node('progress', 'ProgressDashboard', { title: 'Study Progress', showStats: true }),
      ],
    }),
  },

  // ── Checklist / to-do / grocery / shopping / packing ─────────────────────
  {
    keywords: ['checklist', 'grocery', 'shopping', 'packing', 'list', 'items', 'errands', 'todo', 'to-do', 'to do'],
    spec: (intent) => ({
      version: '1',
      title: 'Checklist',
      description: `Task list for: "${intent}"`,
      layout: [
        node('checklist', 'ChecklistGroup', { title: intent, items: [] }),
        node('task-list', 'TaskList', { title: 'All Tasks', filter: 'all' }),
      ],
    }),
  },

  // ── Progress / dashboard / overview / stats ───────────────────────────────
  {
    keywords: ['progress', 'dashboard', 'overview', 'stats', 'metrics', 'report', 'summary', 'review', 'analytics'],
    spec: (intent) => ({
      version: '1',
      title: 'Progress Dashboard',
      description: `Overview for: "${intent}"`,
      layout: [
        node('progress', 'ProgressDashboard', { title: intent, showStats: true }),
        node('task-list', 'TaskList', { title: 'Recent Tasks', filter: 'recent' }),
      ],
    }),
  },
]

// Default fallback — general task manager layout
const DEFAULT_SPEC = (intent: string): LayoutSpec => ({
  version: '1',
  title: intent.length > 60 ? intent.slice(0, 60) + '…' : intent,
  description: 'Your personalised task workspace',
  layout: [
    node('task-list', 'TaskList', { title: 'Tasks', filter: 'all' }),
    node('progress', 'ProgressDashboard', { title: 'Progress', showStats: true }),
  ],
})

export function mapIntentToSpec(intent: string): LayoutSpec {
  const lower = intent.toLowerCase()

  // Score each rule by number of keyword hits; pick highest score
  let bestRule: Rule | null = null
  let bestScore = 0

  for (const rule of RULES) {
    const score = rule.keywords.filter((kw) => lower.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      bestRule = rule
    }
  }

  return bestRule ? bestRule.spec(intent) : DEFAULT_SPEC(intent)
}
