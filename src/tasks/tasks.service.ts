import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { Task, TaskDocument } from '../common/schemas/task.schema'
import { User, UserDocument } from '../common/schemas/user.schema'

const XP_TASK_COMPLETE = 20

export interface SuggestResult { priority: string; estimatedMinutes: number; listId?: string; tags: string[] }

// ─── Rule-based heuristics (no API quota consumed) ────────────────────────────

const PRIORITY_RULES: Array<{ words: string[]; priority: string }> = [
  { words: ['urgent', 'asap', 'critical', 'emergency', 'immediately', 'deadline', 'overdue', 'now', 'crisis'], priority: 'urgent' },
  { words: ['important', 'must', 'need', 'required', 'high', 'priority', 'crucial', 'essential', 'major', 'release'], priority: 'high' },
  { words: ['maybe', 'consider', 'sometime', 'eventually', 'low', 'minor', 'nice to have', 'optional', 'backlog', 'someday'], priority: 'low' },
]

const TIME_RULES: Array<{ words: string[]; minutes: number }> = [
  { words: ['quick', 'fast', 'brief', 'tiny', '5 min', '5min', 'short message', 'reply', 'ping', 'check'], minutes: 10 },
  { words: ['email', 'message', 'slack', 'respond', 'confirm', 'review', 'read', 'call', 'chat', '15 min', '15min'], minutes: 20 },
  { words: ['meeting', 'standup', 'sync', 'interview', 'demo', '30 min', '30min', 'half hour'], minutes: 30 },
  { words: ['write', 'draft', 'document', 'report', 'blog', 'article', 'plan', 'design', 'prototype', '1 hour', '1h'], minutes: 60 },
  { words: ['implement', 'build', 'develop', 'code', 'feature', 'module', 'component', 'api', 'integrate', '2 hour', '2h'], minutes: 120 },
  { words: ['refactor', 'migrate', 'audit', 'analysis', 'research', 'investigate', 'large', 'complex', '4 hour', 'half day'], minutes: 240 },
  { words: ['project', 'epic', 'full day', 'all day', 'sprint', '8 hour', '8h', 'major'], minutes: 480 },
]

const TAG_RULES: Array<{ words: string[]; tag: string }> = [
  { words: ['bug', 'fix', 'error', 'issue', 'crash', 'broken', 'regression'], tag: 'bug' },
  { words: ['feature', 'implement', 'build', 'develop', 'add', 'create', 'new'], tag: 'dev' },
  { words: ['design', 'ui', 'ux', 'prototype', 'figma', 'mockup', 'wireframe'], tag: 'design' },
  { words: ['document', 'docs', 'readme', 'write', 'blog', 'article', 'wiki'], tag: 'docs' },
  { words: ['test', 'testing', 'qa', 'unit test', 'e2e', 'coverage'], tag: 'testing' },
  { words: ['meeting', 'call', 'standup', 'sync', 'interview', 'demo', 'review'], tag: 'meeting' },
  { words: ['deploy', 'release', 'ship', 'launch', 'publish', 'production', 'ci', 'cd'], tag: 'devops' },
  { words: ['research', 'investigate', 'explore', 'analyse', 'analysis', 'study', 'learn'], tag: 'research' },
  { words: ['email', 'slack', 'message', 'reply', 'respond', 'notify', 'ping'], tag: 'comms' },
  { words: ['budget', 'cost', 'invoice', 'payment', 'money', 'finance', 'expense'], tag: 'finance' },
]

function heuristicSuggest(
  text: string,
  lists: Array<{ _id: string; name: string }>,
): SuggestResult {
  const lower = text.toLowerCase()

  // Priority — first matching rule wins; default medium
  let priority = 'medium'
  for (const rule of PRIORITY_RULES) {
    if (rule.words.some((w) => lower.includes(w))) { priority = rule.priority; break }
  }

  // Time — highest matching rule wins (longer tasks tend to have more keywords)
  let estimatedMinutes = 30
  let bestMatch = 0
  for (const rule of TIME_RULES) {
    const hits = rule.words.filter((w) => lower.includes(w)).length
    if (hits > bestMatch) { bestMatch = hits; estimatedMinutes = rule.minutes }
  }

  // Tags — collect all matching, max 3
  const tags = TAG_RULES
    .filter((r) => r.words.some((w) => lower.includes(w)))
    .map((r) => r.tag)
    .slice(0, 3)

  // List — fuzzy word-overlap between title words and list name
  let listId: string | undefined
  if (lists.length) {
    const titleWords = lower.split(/\W+/).filter((w) => w.length > 2)
    let bestScore = 0
    for (const list of lists) {
      const listWords = list.name.toLowerCase().split(/\W+/)
      const score = titleWords.filter((w) => listWords.some((lw) => lw.includes(w) || w.includes(lw))).length
      if (score > bestScore) { bestScore = score; listId = list._id }
    }
    if (bestScore === 0) listId = undefined // no meaningful overlap
  }

  return { priority, estimatedMinutes, listId, tags }
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name)

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  async findAll(userId: string, filters?: { status?: string; priority?: string; listId?: string }) {
    const query: Record<string, unknown> = { userId: new Types.ObjectId(userId) }
    if (filters?.status) query.status = filters.status
    if (filters?.priority) query.priority = filters.priority
    if (filters?.listId) {
      if (!Types.ObjectId.isValid(filters.listId)) {
        throw new BadRequestException('Invalid listId format')
      }
      query.listId = new Types.ObjectId(filters.listId)
    }
    return this.taskModel.find(query).sort({ createdAt: -1 }).lean()
  }

  async findOne(id: string, userId: string) {
    const task = await this.taskModel.findOne({ _id: id, userId: new Types.ObjectId(userId) }).lean()
    if (!task) throw new NotFoundException('Task not found')
    return task
  }

  async create(userId: string, data: Partial<Task>) {
    const task = await this.taskModel.create({ ...data, userId: new Types.ObjectId(userId) })
    return task.toObject()
  }

  async update(id: string, userId: string, data: Partial<Task>) {
    const task = await this.taskModel.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: data },
      { new: true },
    )
    if (!task) throw new NotFoundException('Task not found')
    return task.toObject()
  }

  async complete(id: string, userId: string) {
    const task = await this.taskModel.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(userId), status: { $ne: 'done' } },
      { $set: { status: 'done', completedAt: new Date() } },
      { new: true },
    )
    if (!task) {
      const exists = await this.taskModel.exists({ _id: id, userId: new Types.ObjectId(userId) })
      if (!exists) throw new NotFoundException('Task not found')
      return { task: await this.taskModel.findOne({ _id: id, userId: new Types.ObjectId(userId) }).lean(), xpAwarded: 0 }
    }
    await this.awardXp(userId, XP_TASK_COMPLETE)
    return { task: task.toObject(), xpAwarded: XP_TASK_COMPLETE }
  }

  async delete(id: string, userId: string) {
    const result = await this.taskModel.deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
    if (result.deletedCount === 0) throw new NotFoundException('Task not found')
    return { deleted: true }
  }

  async suggest(
    _userId: string,
    title: string,
    description?: string,
    lists: Array<{ _id: string; name: string }> = [],
  ): Promise<SuggestResult> {
    try {
      return await this.aiSuggest(title, description, lists)
    } catch (err) {
      this.logger.warn(`AI suggest failed, using heuristics: ${err}`)
      const text = [title, description ?? ''].join(' ')
      return heuristicSuggest(text, lists)
    }
  }

  private async aiSuggest(
    title: string,
    description: string | undefined,
    lists: Array<{ _id: string; name: string }>,
  ): Promise<SuggestResult> {
    const sanitize = (s: string) => s.replace(/["\\\n\r]/g, ' ').slice(0, 100)
    const listNames = lists.map((l) => `"${sanitize(l.name)}" (id: ${l._id})`).join(', ')
    const systemPrompt = `You are a task assistant. Given a task title and optional description, return ONLY a JSON object with these exact fields:
{
  "priority": "low" | "medium" | "high" | "urgent",
  "estimatedMinutes": number (5-480),
  "tags": string[] (1-3 short lowercase tags relevant to the task),
  "listId": string | null (pick from available lists by id if relevant, else null)
}
Available lists: ${listNames || 'none'}
Rules:
- priority: urgent = deadline/exam/crisis, high = important work, medium = regular tasks, low = nice-to-have
- estimatedMinutes: realistic time to complete the task
- tags: short descriptive tags like "study", "work", "health", "finance", "personal", "dev", "meeting"
- Return ONLY the JSON object, no markdown, no explanation.`

    const userMsg = `Title: ${title}${description ? `\nDescription: ${description}` : ''}`

    const groqKey = this.config.get<string>('GROQ_API_KEY')
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 200,
      },
      { headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, timeout: 10000 },
    )

    const raw = JSON.parse(res.data.choices[0].message.content) as {
      priority?: string
      estimatedMinutes?: number
      tags?: string[]
      listId?: string | null
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent']
    return {
      priority: validPriorities.includes(raw.priority ?? '') ? raw.priority! : 'medium',
      estimatedMinutes: typeof raw.estimatedMinutes === 'number' && raw.estimatedMinutes >= 5 ? Math.min(480, raw.estimatedMinutes) : 30,
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map(String) : [],
      listId: raw.listId && lists.some((l) => l._id === raw.listId) ? raw.listId : undefined,
    }
  }

  private async awardXp(userId: string, xp: number) {
    if (!Types.ObjectId.isValid(userId)) return
    const user = await this.userModel.findById(userId)
    if (!user) return
    user.xp += xp
    const newLevel = Math.floor(user.xp / 500) + 1
    if (newLevel > user.level) user.level = newLevel
    await user.save()
  }
}
