import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import * as nodemailer from 'nodemailer'
import { Task, TaskDocument } from '../common/schemas/task.schema'
import { User, UserDocument } from '../common/schemas/user.schema'

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#ff4d00',
  medium: '#eab308',
  low:    '#22c55e',
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high:   'High',
  medium: 'Mid',
  low:    'Low',
}

interface SimpleTask {
  title: string
  description?: string
  priority: string
  dueDate?: string | Date
  estimatedMinutes?: number
  tags?: string[]
}

@Injectable()
export class MailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name)
  private transporter: nodemailer.Transporter | null = null

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    const smtpHost = this.config.get<string>('SMTP_HOST')
    const smtpUser = this.config.get<string>('SMTP_USER')
    const smtpPass = this.config.get<string>('SMTP_PASS')
    if (!smtpHost || !smtpUser || !smtpPass) {
      this.logger.warn('SMTP env vars (SMTP_HOST, SMTP_USER, SMTP_PASS) are missing — mail sending disabled')
      return
    }
    const smtpPort = Number(this.config.get('SMTP_PORT') ?? 587)
    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,   // true for port 465 (TLS), false for 587 (STARTTLS)
      requireTLS: smtpPort !== 465, // enforce STARTTLS upgrade on port 587
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: { rejectUnauthorized: true }, // reject self-signed certs
    })
  }

  // ── Lifecycle: start midnight scheduler on boot ──────────────────────────────
  onApplicationBootstrap() {
    this.scheduleMidnightDigest()
  }

  private scheduleMidnightDigest() {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5) // 00:00:05 next day
    const msUntilMidnight = nextMidnight.getTime() - now.getTime()

    this.logger.log(`Next digest scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`)

    setTimeout(async () => {
      await this.sendAllNextDayDigests()
      // Re-schedule by computing the next midnight from the current time,
      // avoiding cumulative drift and ensuring only one schedule chain per instance.
      this.scheduleMidnightDigest()
    }, msUntilMidnight)
  }

  // ── Send next-day digest + streak-at-risk to all users ──────────────────────
  async sendAllNextDayDigests() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0)
    const tomorrowEnd   = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59)
    const dateLabel = tomorrowStart.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    // Fetch all users with streak > 0 or tasks tomorrow
    const tasks = await this.taskModel.find({
      dueDate: { $gte: tomorrowStart, $lte: tomorrowEnd },
      status: { $nin: ['done', 'archived'] },
    }).lean()

    const byUser = new Map<string, typeof tasks>()
    for (const t of tasks) {
      const uid = t.userId.toString()
      if (!byUser.has(uid)) byUser.set(uid, [])
      byUser.get(uid)!.push(t)
    }

    // All users who have a streak (for streak-at-risk reminder)
    const usersWithStreak = await this.userModel.find({ streak: { $gt: 0 } }).lean()
    const allUserIds = new Set([
      ...byUser.keys(),
      ...usersWithStreak.map(u => u._id.toString()),
    ])

    const allUserIdsArray = [...allUserIds]
    const allUsers = await this.userModel.find({ _id: { $in: allUserIdsArray } }).lean()
    const userMap = new Map(allUsers.map(u => [u._id.toString(), u]))

    for (const userId of allUserIds) {
      try {
        const user = userMap.get(userId)
        if (!user?.email) continue
        const prefs = user.notificationPrefs ?? { dailyDigest: true, streakReminder: true, planCreated: true }

        const userTasks = byUser.get(userId) ?? []

        // Daily digest
        if (prefs.dailyDigest && userTasks.length > 0) {
          await this.sendTaskListEmail({
            to: user.email,
            name: user.name ?? 'there',
            subject: `📋 Tomorrow's Tasks — ${dateLabel}`,
            heading: 'Your tasks for tomorrow',
            subheading: dateLabel,
            tasks: userTasks.map(t => ({
              title: t.title,
              description: t.description,
              priority: t.priority,
              dueDate: t.dueDate,
              estimatedMinutes: t.estimatedMinutes,
              tags: t.tags,
            })),
          })
          this.logger.log(`Digest sent to ${user.email} (${userTasks.length} tasks)`)
        }

        // Streak-at-risk reminder (user has a streak but no tasks done today)
        if (prefs.streakReminder && user.streak > 0) {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
          const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)
          const todayDone = await this.taskModel.countDocuments({
            userId: user._id,
            status: 'done',
            completedAt: { $gte: todayStart, $lte: todayEnd },
          })
          if (todayDone === 0) {
            await this.sendStreakReminderEmail(user.email, user.name ?? 'there', user.streak)
            this.logger.log(`Streak reminder sent to ${user.email} (streak: ${user.streak})`)
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to send midnight email to userId ${userId}: ${err}`)
      }
    }
  }

  // ── Send plan-created email ───────────────────────────────────────────────────
  async sendPlanEmail(userId: string, tasks: SimpleTask[]) {
    try {
      const user = await this.userModel.findById(userId).lean()
      if (!user?.email) return
      const prefs = user.notificationPrefs ?? { dailyDigest: true, streakReminder: true, planCreated: true }
      if (!prefs.planCreated) return
      await this.sendTaskListEmail({
        to: user.email,
        name: user.name ?? 'there',
        subject: `✅ Your task plan is ready — ${tasks.length} tasks created`,
        heading: 'Your new task plan',
        subheading: `${tasks.length} task${tasks.length !== 1 ? 's' : ''} have been added to TaskVerse`,
        tasks,
      })
      this.logger.log(`Plan email sent to ${user.email}`)
    } catch (err) {
      this.logger.warn(`Failed to send plan email: ${err}`)
    }
  }

  // ── Streak-at-risk email ─────────────────────────────────────────────────────
  private async sendStreakReminderEmail(to: string, name: string, streak: number) {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a08;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a08;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px">
        <tr>
          <td style="padding-bottom:24px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#ff4d00">TaskVerse</div>
          </td>
        </tr>
        <tr>
          <td style="background:#111110;border:1px solid #1e1e1a;border-radius:16px;overflow:hidden">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:32px 28px;text-align:center">
                  <div style="font-size:48px;margin-bottom:16px">🔥</div>
                  <div style="font-size:22px;font-weight:700;color:#eee8de;margin-bottom:8px">Don't break your streak, ${escapeHtml(name)}!</div>
                  <div style="font-size:14px;color:#888;margin-bottom:24px">You have a <strong style="color:#ff4d00">${Number(streak)}-day streak</strong> — complete at least one task today to keep it alive.</div>
                  <a href="${this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'}/app/tasks"
                     style="display:inline-block;background:#ff4d00;color:#050505;font-weight:700;font-size:14px;padding:14px 36px;border-radius:8px;text-decoration:none">
                    Complete a Task →
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 28px;border-top:1px solid #1e1e1a;text-align:center">
                  <div style="font-size:11px;color:#444">You're receiving this because streak reminders are on in your TaskVerse settings.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    if (!this.transporter) return
    await this.transporter.sendMail({
      from: `"TaskVerse" <${this.config.get('SMTP_USER')}>`,
      to,
      subject: `🔥 Your ${streak}-day streak is at risk!`,
      html,
    })
  }

  // ── Core HTML email builder ───────────────────────────────────────────────────
  private async sendTaskListEmail(opts: {
    to: string
    name: string
    subject: string
    heading: string
    subheading: string
    tasks: SimpleTask[]
  }) {
    const taskRows = opts.tasks.map(t => {
      const color = PRIORITY_COLOR[t.priority] ?? '#eab308'
      const label = PRIORITY_LABEL[t.priority] ?? t.priority
      const due = t.dueDate
        ? new Date(t.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : ''
      const est = t.estimatedMinutes
        ? (t.estimatedMinutes < 60 ? `${t.estimatedMinutes}m` : `${Math.floor(t.estimatedMinutes / 60)}h${t.estimatedMinutes % 60 ? ` ${t.estimatedMinutes % 60}m` : ''}`)
        : ''
      const tags = (t.tags ?? []).slice(0, 3).map(tag =>
        `<span style="display:inline-block;background:#1e1e1a;color:#aaa;font-size:11px;padding:2px 8px;border-radius:99px;margin-right:4px;border:1px solid #333">${escapeHtml(String(tag))}</span>`
      ).join('')

      const safeTitle = escapeHtml(t.title)
      const safeDesc = t.description ? escapeHtml(t.description) : ''
      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #1e1e1a;vertical-align:top">
            <div style="display:flex;align-items:flex-start;gap:12px">
              <div style="width:3px;min-height:40px;background:${color};border-radius:2px;flex-shrink:0;margin-top:2px"></div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:600;color:#eee8de;margin-bottom:3px">${safeTitle}</div>
                ${safeDesc ? `<div style="font-size:12px;color:#888;margin-bottom:6px;line-height:1.4">${safeDesc}</div>` : ''}
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="display:inline-block;background:${color}20;color:${color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid ${color}40;text-transform:uppercase;letter-spacing:0.05em">${label}</span>
                  ${due ? `<span style="font-size:11px;color:#666">📅 ${due}</span>` : ''}
                  ${est ? `<span style="font-size:11px;color:#666">⏱ ${est}</span>` : ''}
                  ${tags}
                </div>
              </div>
            </div>
          </td>
        </tr>
      `
    }).join('')

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a08;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a08;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:560px">

        <!-- Logo / Brand -->
        <tr>
          <td style="padding-bottom:28px;text-align:center">
            <div style="font-size:20px;font-weight:800;color:#ff4d00;letter-spacing:-0.02em">TaskVerse</div>
            <div style="font-size:11px;color:#555;font-family:monospace;margin-top:4px;letter-spacing:0.1em;text-transform:uppercase">Productivity Platform</div>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#111110;border:1px solid #1e1e1a;border-radius:16px;overflow:hidden">

            <!-- Header -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#ff4d0010;border-bottom:1px solid #ff4d0020;padding:24px 28px">
                  <div style="font-size:11px;color:#ff4d00;font-family:monospace;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px">${opts.subheading}</div>
                  <div style="font-size:22px;font-weight:700;color:#eee8de;letter-spacing:-0.02em">Hey ${escapeHtml(opts.name)} 👋</div>
                  <div style="font-size:14px;color:#666;margin-top:6px">${opts.heading}</div>
                </td>
              </tr>
            </table>

            <!-- Summary bar -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:14px 28px;border-bottom:1px solid #1e1e1a;background:#0d0d0b">
                  <span style="font-size:12px;color:#888">
                    <strong style="color:#eee8de">${opts.tasks.length}</strong> task${opts.tasks.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
                    <strong style="color:#ef4444">${opts.tasks.filter(t => t.priority === 'urgent').length}</strong> urgent &nbsp;·&nbsp;
                    <strong style="color:#ff4d00">${opts.tasks.filter(t => t.priority === 'high').length}</strong> high
                  </span>
                </td>
              </tr>
            </table>

            <!-- Task list -->
            <table width="100%" cellpadding="0" cellspacing="0">
              ${taskRows}
            </table>

            <!-- Footer CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:24px 28px;text-align:center;border-top:1px solid #1e1e1a">
                  <a href="${this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'}/app/tasks"
                     style="display:inline-block;background:#ff4d00;color:#050505;font-weight:700;font-size:13px;padding:12px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.05em">
                    Open TaskVerse →
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding-top:24px;text-align:center">
            <div style="font-size:11px;color:#444">You're receiving this because you have tasks on TaskVerse.</div>
            <div style="font-size:11px;color:#333;margin-top:4px">© 2026 TaskVerse</div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

    if (!this.transporter) return
    await this.transporter.sendMail({
      from: `"TaskVerse" <${this.config.get('SMTP_USER')}>`,
      to: opts.to,
      subject: opts.subject,
      html,
    })
  }
}
