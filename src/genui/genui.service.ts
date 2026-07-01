import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import axios from 'axios'
import { Canvas, CanvasDocument } from '../common/schemas/canvas.schema'
import { TasksService } from '../tasks/tasks.service'
import { validateLayoutSpec } from './catalog.schema'
import { mapIntentToSpec } from './intent-mapper'

export interface SuggestedTask {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  estimatedMinutes: number
  tags: string[]
  dueDate?: string  // ISO date string YYYY-MM-DD
}

// Gemini models tried in order on 429
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-1.5-flash-8b', 'gemini-1.5-flash']

// OpenRouter free models (verified 2026-07-01 via /api/v1/models)
const OR_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
  'qwen/qwen3-coder:free',
  'openai/gpt-oss-20b:free',
]

const OR_BASE = 'https://openrouter.ai/api/v1'

async function sleepMs(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

const SYSTEM_PROMPT = `You are a UI layout engine for TaskVerse. Given a user's intent, return ONLY a valid JSON object — nothing else, no markdown fences, no explanation.

ALLOWED COMPONENTS (use ONLY these exact names):
TaskCard, TaskList, KanbanBoard, Timeline, HabitGrid, CalendarView, CountdownRing, BudgetTracker, ProgressDashboard, ChecklistGroup, FocusTimer

REQUIRED JSON SCHEMA:
{
  "version": "1",
  "title": "string (max 100 chars)",
  "description": "string (optional, max 300 chars)",
  "layout": [
    {
      "id": "unique-kebab-string",
      "component": "ALLOWED_COMPONENT_NAME",
      "props": {},
      "children": []
    }
  ]
}

RULES:
- 1–4 layout nodes maximum
- Pick the component(s) that BEST match the user's intent
- NEVER invent component names outside the allowed list
- Return raw JSON only — no backticks, no "json" prefix`

@Injectable()
export class GenUIService {
  private readonly genAI: GoogleGenerativeAI
  private readonly logger = new Logger(GenUIService.name)

  constructor(
    @InjectModel(Canvas.name) private readonly canvasModel: Model<CanvasDocument>,
    private readonly tasksService: TasksService,
    private readonly config: ConfigService,
  ) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('GEMINI_API_KEY') ?? '')
  }

  async compose(intent: string, userId: string, res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // ── Step 1: instant rule-based spec (always works, zero latency) ─────────
    const ruleSpec = mapIntentToSpec(intent)
    res.write(`data: ${JSON.stringify({ chunk: '⚡ Building layout…' })}\n\n`)

    // ── Step 2: try to enhance with AI (best-effort, silent on failure) ───────
    try {
      const aiSpec = await this.tryAiEnhance(intent, userId)

      const finalSpec = aiSpec ?? ruleSpec
      res.write(`data: ${JSON.stringify({ done: true, spec: finalSpec, aiEnhanced: !!aiSpec })}\n\n`)
    } finally {
      res.end()
    }
  }

  private async tryAiEnhance(intent: string, userId: string) {
    const tasks = await this.tasksService.findAll(userId, {})
    const context = tasks.slice(0, 10).map((t) => ({
      title: t.title, priority: t.priority, status: t.status,
    }))
    const prompt = `User intent: "${intent}"\nContext tasks: ${JSON.stringify(context)}\nGenerate the layout spec JSON:`

    // Try Gemini models
    for (const modelName of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const model = this.genAI.getGenerativeModel({ model: modelName })
          const streamResult = await model.generateContentStream([SYSTEM_PROMPT, prompt])
          let accumulated = ''
          for await (const chunk of streamResult.stream) accumulated += chunk.text()
          const jsonMatch = accumulated.match(/\{[\s\S]*\}/)
          if (!jsonMatch) throw new Error('no json')
          let parsed: unknown
          try {
            parsed = JSON.parse(jsonMatch[0])
          } catch (parseErr) {
            this.logger.warn(`Gemini ${modelName} returned malformed JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
            throw new Error('malformed json')
          }
          return validateLayoutSpec(parsed)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')
          if (is429 && attempt === 0) {
            this.logger.warn(`Gemini 429 on ${modelName}, retrying…`)
            const secs = msg.match(/retry in ([\d.]+)s/i)
            await sleepMs(secs ? Math.min(parseFloat(secs[1]) * 1000, 10_000) : 8_000)
            continue
          }
          break
        }
      }
    }

    // Try OpenRouter models
    const orKey = this.config.get<string>('OPENROUTER_API_KEY')
    if (orKey) {
      for (const model of OR_MODELS) {
        try {
          const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
            `${OR_BASE}/chat/completions`,
            { model, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }], max_tokens: 512, temperature: 0.2 },
            { headers: { Authorization: `Bearer ${orKey}`, 'HTTP-Referer': 'https://taskverse.app', 'X-Title': 'TaskVerse' } },
          )
          const text = data.choices?.[0]?.message?.content ?? ''
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (!jsonMatch) throw new Error('no json from OR')
          let parsed: unknown
          try {
            parsed = JSON.parse(jsonMatch[0])
          } catch (parseErr) {
            this.logger.warn(`OR ${model} returned malformed JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
            throw new Error('malformed json from OR')
          }
          return validateLayoutSpec(parsed)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const is429 = msg.includes('429') || msg.includes('rate')
          this.logger.warn(`OR ${model} ${is429 ? 'rate-limited' : 'failed'}: ${msg.slice(0, 120)}`)
        }
      }
    }

    // All AI paths failed — return null so caller uses the rule-based spec
    this.logger.log('All AI paths exhausted — using rule-based layout')
    return null
  }

  async getCanvases(userId: string) {
    return this.canvasModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ pinned: -1, updatedAt: -1 })
      .lean()
  }

  async saveCanvas(userId: string, intent: string, layoutSpec: unknown, taskIds: string[], source: 'ui' | 'task-plan' = 'ui') {
    const validated = validateLayoutSpec(layoutSpec)
    return this.canvasModel.create({
      userId: new Types.ObjectId(userId),
      intent,
      layoutSpec: validated,
      taskIds: taskIds.map((id) => {
        if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`Invalid task ID: ${id}`)
        return new Types.ObjectId(id)
      }),
      source,
    })
  }

  async clarifyIntent(intent: string): Promise<string[]> {
    const systemPrompt = `You are a task planning assistant. Given a user's goal, return 2-4 short clarifying questions that will make the task list more specific and useful.
Return ONLY a JSON array of question strings. No markdown, no explanation.
Example: ["What subjects do you need to study?", "How many hours can you dedicate per day?"]`

    const userPrompt = `Goal: "${intent}"\nReturn clarifying questions JSON array:`

    const groqKey = this.config.get<string>('GROQ_API_KEY')
    if (groqKey) {
      try {
        const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
          'https://api.groq.com/openai/v1/chat/completions',
          { model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], response_format: { type: 'json_object' }, max_tokens: 256, temperature: 0.5 },
          { headers: { Authorization: `Bearer ${groqKey}` } },
        )
        const text = data.choices?.[0]?.message?.content ?? ''
        const parsed = JSON.parse(text)
        const arr = Array.isArray(parsed) ? parsed : (parsed.questions ?? Object.values(parsed)[0])
        if (Array.isArray(arr) && arr.length > 0) return arr as string[]
      } catch (err) {
        this.logger.warn(`Groq clarify failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const orKey = this.config.get<string>('OPENROUTER_API_KEY')
    if (orKey) {
      try {
        const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
          `${OR_BASE}/chat/completions`,
          { model: 'openai/gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 256, temperature: 0.5 },
          { headers: { Authorization: `Bearer ${orKey}`, 'HTTP-Referer': 'https://taskverse.app', 'X-Title': 'TaskVerse' } },
        )
        const text = data.choices?.[0]?.message?.content ?? ''
        const match = text.match(/\[[\s\S]*\]/)
        if (match) return JSON.parse(match[0]) as string[]
      } catch (err) {
        this.logger.warn(`OR clarify failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    throw new Error('AI unavailable — please try again')
  }

  async suggestTasks(intent: string, userId: string, clarifications?: Record<string, string>): Promise<SuggestedTask[]> {
    const tasks = await this.tasksService.findAll(userId, {})
    const context = tasks.slice(0, 5).map((t) => ({ title: t.title, priority: t.priority }))

    const clarificationBlock = clarifications && Object.keys(clarifications).length > 0
      ? '\nUser clarifications:\n' + Object.entries(clarifications).map(([q, a]) => `- ${q}: ${a}`).join('\n')
      : ''

    const today = new Date().toISOString().split('T')[0]

    const systemPrompt = `You are a task planning assistant. Today is ${today}.
Given a user's goal and clarifications, return a JSON array of 4-8 concrete, specific tasks to accomplish it.
Return ONLY valid JSON array, no markdown, no explanation.
Each task: { "title": string, "description": string, "priority": "low"|"medium"|"high"|"urgent", "estimatedMinutes": number, "tags": string[], "dueDate": "YYYY-MM-DD" }
RULES:
- estimatedMinutes must be a realistic integer between 15 and 480
- dueDate is REQUIRED for every task — assign realistic future dates spread across the timeline
- If the user mentions a deadline (e.g. "next week", "exam on Friday"), distribute tasks leading up to it
- If no deadline mentioned, spread tasks over the next 7–14 days starting from today
- Earlier tasks get sooner dates, later tasks get later dates — create a logical progression`

    const userPrompt = `Goal: "${intent}"${clarificationBlock}
Today: ${today}
Existing tasks context: ${JSON.stringify(context)}
Generate task list JSON array with dueDate on every task:`

    // Try Groq first (fast, reliable)
    const groqKey = this.config.get<string>('GROQ_API_KEY')
    if (groqKey) {
      try {
        const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
          'https://api.groq.com/openai/v1/chat/completions',
          { model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], response_format: { type: 'json_object' }, max_tokens: 1024, temperature: 0.4 },
          { headers: { Authorization: `Bearer ${groqKey}` } },
        )
        const text = data.choices?.[0]?.message?.content ?? ''
        const parsed = JSON.parse(text)
        const arr = Array.isArray(parsed) ? parsed : (parsed.tasks ?? parsed.result ?? Object.values(parsed)[0])
        if (Array.isArray(arr) && arr.length > 0) return arr as SuggestedTask[]
      } catch (err) {
        this.logger.warn(`Groq suggestTasks failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Fallback: OpenRouter gpt-4o-mini
    const orKey = this.config.get<string>('OPENROUTER_API_KEY')
    if (orKey) {
      try {
        const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
          `${OR_BASE}/chat/completions`,
          { model: 'openai/gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 1024, temperature: 0.4 },
          { headers: { Authorization: `Bearer ${orKey}`, 'HTTP-Referer': 'https://taskverse.app', 'X-Title': 'TaskVerse' } },
        )
        const text = data.choices?.[0]?.message?.content ?? ''
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const arr = JSON.parse(jsonMatch[0])
          if (Array.isArray(arr) && arr.length > 0) return arr as SuggestedTask[]
        }
      } catch (err) {
        this.logger.warn(`OR suggestTasks failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    throw new Error('All AI providers failed — please try again later')
  }

  async togglePin(canvasId: string, userId: string) {
    const canvas = await this.canvasModel.findOne({
      _id: canvasId,
      userId: new Types.ObjectId(userId),
    })
    if (!canvas) throw new NotFoundException('Canvas not found')
    canvas.pinned = !canvas.pinned
    return canvas.save()
  }
}
