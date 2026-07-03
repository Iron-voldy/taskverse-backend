# TaskVerse Backend

> NestJS REST API for TaskVerse — JWT auth, MongoDB, Gemini AI, generative UI, email digests

**Live API:** http://72.62.255.113:3001  
**Swagger docs:** http://72.62.255.113:3001/api/docs (development only)  
**Frontend repo:** https://github.com/Iron-voldy/taskverse-frontend  
**Deployed on:** Hostinger VPS via PM2 cluster mode

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Modules](#modules)
- [Authentication](#authentication)
- [Tasks & XP System](#tasks--xp-system)
- [Generative UI (GenUI)](#generative-ui-genui)
- [Email Service](#email-service)
- [Database Schemas](#database-schemas)
- [Security](#security)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)

---

## Overview

The TaskVerse backend is a NestJS application that powers the AI todo platform. It provides:

- **JWT + Google OAuth authentication** with argon2 password hashing and daily streak tracking
- **Tasks CRUD** with priority, tags, due dates, estimated time, and list organisation
- **XP gamification** — completing tasks awards experience points based on priority
- **AI task suggestions** — Gemini AI analyses task titles and suggests priority, due date, tags, and estimated time
- **Generative UI** — AI generates complete widget layout specifications from natural language, streamed via SSE
- **Email digests** — automated daily task plan emails sent at midnight per user timezone
- **Rate limiting** — per-route throttling on all auth endpoints
- **Input validation** — global ValidationPipe with whitelist mode rejects unknown fields

---

## Tech Stack

| Category | Library | Purpose |
|---|---|---|
| Framework | NestJS | Modular Node.js framework with DI |
| Language | TypeScript | Strict typing throughout |
| Database | MongoDB + Mongoose | Document store via `@nestjs/mongoose` |
| Auth | Passport JWT | JWT strategy with `@nestjs/passport` |
| Password hashing | argon2 | Memory-hard hashing (more secure than bcrypt) |
| Google OAuth | google-auth-library | Verify Google ID tokens server-side |
| AI | @google/generative-ai | Gemini 2.0 Flash for AI features |
| AI fallback | axios (OpenRouter/Groq) | Fallback AI providers if Gemini fails |
| Rate limiting | @nestjs/throttler | Per-route request throttling |
| Validation | class-validator + class-transformer | DTO validation |
| API docs | @nestjs/swagger | Auto-generated OpenAPI docs |
| Security | helmet | HTTP security headers |
| Email | nodemailer | SMTP email sending |
| Cache/Queue | ioredis | Redis client (for future queues) |
| Process manager | PM2 | Cluster mode, restart on crash |

---

## Project Structure

```
src/
├── main.ts                    # Bootstrap — CORS, ValidationPipe, Helmet, Swagger
├── app.module.ts              # Root module — imports all feature modules
├── auth/
│   ├── auth.controller.ts     # POST /auth/register, /login, /google, GET /me
│   ├── auth.service.ts        # Business logic — register, login, googleAuth, streak
│   ├── auth.module.ts         # Imports JwtModule, PassportModule, ConfigModule
│   ├── guards/
│   │   └── jwt-auth.guard.ts  # Extends AuthGuard('jwt') — protects routes
│   ├── strategies/
│   │   └── jwt.strategy.ts    # Validates JWT, attaches user to request
│   └── dto/
│       ├── register.dto.ts    # Email, password (strength regex), name validation
│       ├── login.dto.ts       # Email + password
│       └── google-auth.dto.ts # idToken string
├── tasks/
│   ├── tasks.controller.ts    # CRUD + /complete + /suggest endpoints
│   ├── tasks.service.ts       # Business logic — XP, AI suggest, atomic queries
│   └── tasks.module.ts
├── lists/
│   ├── lists.controller.ts    # CRUD for task lists
│   └── lists.module.ts
├── genui/
│   ├── genui.controller.ts    # POST /compose, /clarify, /suggest-tasks, canvas CRUD
│   ├── genui.service.ts       # AI orchestration, SSE streaming, canvas persistence
│   ├── genui.module.ts
│   ├── intent-mapper.ts       # Maps user intents to widget types
│   └── catalog.schema.ts      # Mongoose schema for saved canvases
├── mail/
│   ├── mail.controller.ts     # POST /mail/send-plan
│   ├── mail.service.ts        # SMTP transport, digest scheduler, HTML templates
│   └── mail.module.ts
├── users/
│   ├── users.controller.ts    # GET/PATCH /users/me, PATCH /notifications
│   └── users.module.ts
└── common/
    └── schemas/
        ├── user.schema.ts     # User — email, passwordHash, xp, level, streak
        ├── task.schema.ts     # Task — title, status, priority, dueDate, tags, userId
        └── canvas.schema.ts   # GenUI canvas — userId, nodes, pinned
```

---

## Modules

### AppModule
The root module wires everything together:

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),        // env vars available everywhere
    MongooseModule.forRootAsync({                    // MongoDB connection from env
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),  // global 60 req/min default
    AuthModule,
    TasksModule,
    ListsModule,
    GenUIModule,
    MailModule,
    UsersModule,
  ],
})
```

### Bootstrap (`main.ts`)
```ts
app.use(helmet())                          // Adds X-Frame-Options, X-Content-Type-Options etc.
app.enableCors({ origin: FRONTEND_URL })   // Only allows requests from the frontend domain
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,                         // Strips unknown fields from request bodies
  forbidNonWhitelisted: true,              // Returns 400 if unknown fields are present
  transform: true,                         // Auto-converts strings to numbers/booleans
}))
```

---

## Authentication

### Registration (`POST /auth/register`)
```
1. Check if email already exists → 409 if so
2. Hash password with argon2 (memory-hard, 64MB default)
3. Create user document in MongoDB
4. Sign JWT with user._id and email
5. Return sanitised user (no passwordHash) + token
```

Password requirements (enforced by DTO):
- Minimum 8 characters
- At least one uppercase letter
- At least one digit

```ts
// src/auth/dto/register.dto.ts
@Matches(/^(?=.*[A-Z])(?=.*\d).{8,}$/, {
  message: 'Password must be 8+ chars with at least one uppercase and one number',
})
password: string
```

### Login (`POST /auth/login`)
```
1. Find user by email (case-insensitive — stored lowercase)
2. Verify argon2 hash
3. Update login streak (see Streak Tracking below)
4. Return user + JWT
```

### Google OAuth (`POST /auth/google`)
```
1. Receive Google ID token from frontend
2. Verify with google-auth-library OAuth2Client
3. Extract email, name, picture, sub (Google user ID)
4. Find or create user
5. Update streak + return user + JWT
```

The Google client ID is loaded via `ConfigService.getOrThrow('GOOGLE_CLIENT_ID')` — the app **crashes at startup** if this env var is missing, preventing silent auth failures.

### JWT Strategy
```ts
// src/auth/strategies/jwt.strategy.ts
JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_SECRET'),  // crashes if missing
    })
  }
  validate(payload: { sub: string; email: string }) {
    return { _id: payload.sub, email: payload.email }  // attached to req.user
  }
}
```

### Streak Tracking
On every login, `updateStreak()` runs:

```ts
const today = new Date(); today.setHours(0,0,0,0)
const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)

if (lastActiveDate < yesterday) {
  user.streak = 1              // streak broken — reset
} else if (lastActiveDate === yesterday) {
  user.streak += 1             // consecutive day — increment
}
// if lastActiveDate === today: no change (already counted today)
user.lastActiveDate = new Date()
```

---

## Tasks & XP System

### Task Schema
```ts
{
  title: string           // max 255 chars
  description?: string    // max 2000 chars
  status: 'todo' | 'in_progress' | 'done' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: Date
  estimatedMinutes?: number  // 1–1440
  tags?: string[]
  listId?: ObjectId
  userId: ObjectId        // owner — all queries filter by this
  completedAt?: Date
  xpAwarded?: number
}
```

Compound indexes for fast filtered queries:
```ts
{ userId: 1, status: 1 }
{ userId: 1, dueDate: 1 }
```

### Complete Task (`PATCH /tasks/:id/complete`)
```ts
// Atomic — single query, prevents double-completion
const task = await taskModel.findOneAndUpdate(
  { _id: id, userId, status: { $ne: 'done' } },   // only matches if not already done
  { status: 'done', completedAt: new Date() },
  { new: true }
)
if (!task) {
  const exists = await taskModel.exists({ _id: id, userId })
  if (!exists) throw new NotFoundException()
  return { task: existingTask, xpAwarded: 0 }     // already done — no XP
}
await awardXp(userId, XP_BY_PRIORITY[task.priority])
```

XP awarded by priority:
| Priority | XP |
|---|---|
| urgent | 100 |
| high | 60 |
| medium | 30 |
| low | 10 |

### findOne — Atomic Ownership Check
```ts
// Single query — no separate ownership check needed
const task = await taskModel.findOne({ _id: id, userId: new Types.ObjectId(userId) })
if (!task) throw new NotFoundException()
```

This replaced a two-round-trip pattern (findById → check userId) that had a race window between the fetch and the ownership check.

### AI Task Suggestions (`POST /tasks/suggest`)
Sends task title, description, and existing lists to Gemini. Returns:
```json
{
  "priority": "high",
  "dueDate": "2026-07-10",
  "estimatedMinutes": 45,
  "tags": ["work", "deadline"],
  "listId": "existing-list-object-id"
}
```

List names are sanitised before embedding in the AI prompt (strips `"`, `\`, newlines) to prevent prompt injection.

---

## Generative UI (GenUI)

### Compose Endpoint (`POST /genui/compose`)
Streams an AI-generated widget layout back to the client via **Server-Sent Events (SSE)**:

```ts
@Post('compose')
async compose(@Body() dto: ComposeDto, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    await this.genuiService.compose(userId, dto, res)
  } finally {
    res.end()   // always close the stream, even on AI exception
  }
}
```

The `try/finally` ensures the SSE connection is always closed, even if the AI throws — without it, the client hangs indefinitely waiting for more data.

### AI Provider Cascade
The service tries providers in order until one succeeds:

```
1. Gemini 2.0 Flash (primary — fastest, cheapest)
2. OpenRouter (fallback — claude-3-haiku or gpt-4o-mini)
3. Groq (fallback — llama-3.1-8b-instant)
4. Rule-based intent mapper (final fallback — no AI needed)
```

`JSON.parse` failures from AI responses are caught and logged with the model name before rethrowing, making it easy to debug which provider returned malformed JSON.

### Layout Spec Format
```json
{
  "nodes": [
    {
      "type": "KanbanBoard",
      "props": { "title": "Sprint Tasks", "columns": ["Todo", "In Progress", "Done"] }
    },
    {
      "type": "FocusTimer",
      "props": { "duration": 25, "breakDuration": 5 }
    }
  ]
}
```

### Canvas Persistence
Canvases (generated layouts) can be saved and pinned:

- `POST /genui/canvases` — save a canvas with its layout spec and associated taskIds
- `PATCH /genui/canvases/:id/pin` — toggle pinned status
- `GET /genui/canvases` — list all user's canvases

`togglePin` uses `NotFoundException` (not a plain `Error`) so NestJS exception filters return 404 correctly instead of 500.

---

## Email Service

### SMTP Transport
```ts
nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  requireTLS: SMTP_PORT !== 465,   // STARTTLS for port 587, direct TLS for 465
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: true },  // never accept invalid certs
})
```

If `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` are missing, `transporter` is set to `null` and send calls are skipped with a warning log (rather than crashing at first send).

### Midnight Digest Scheduler
The mail service schedules a daily digest email for all users at midnight:

```ts
private scheduleMidnightDigest() {
  const now = new Date()
  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 0)       // next midnight exactly
  const msUntilMidnight = nextMidnight.getTime() - now.getTime()

  setTimeout(async () => {
    await this.sendAllNextDayDigests()
    this.scheduleMidnightDigest()           // reschedule for next midnight
  }, msUntilMidnight)
}
```

Using a recursive `setTimeout` (not `setInterval`) ensures the timer always anchors to the actual next midnight. `setInterval(fn, 86400000)` drifts because it counts from "when the server started", not from midnight.

### HTML Injection Prevention
All user-provided content (task titles, descriptions, names, tags) is escaped before being placed in HTML email templates:

```ts
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
```

Without this, a task title like `<script>alert(1)</script>` would execute in the recipient's email client (some clients render HTML without sandboxing).

### N+1 Query Fix
The digest loop previously called `userModel.findById(userId)` inside a `for...of` loop — one database round-trip per user. Fixed with a single batch query:

```ts
// Before (N+1):
for (const userId of allUserIds) {
  const user = await userModel.findById(userId)  // N queries
}

// After (1 query):
const users = await userModel.find({ _id: { $in: allUserIds } })
const userMap = new Map(users.map(u => [u._id.toString(), u]))
for (const userId of allUserIds) {
  const user = userMap.get(userId)               // O(1) lookup
}
```

---

## Database Schemas

### User
```ts
{
  email: string           // unique, lowercase, indexed
  name: string
  passwordHash?: string   // undefined for Google-only accounts
  googleId?: string
  image?: string
  xp: number             // default 0
  level: number          // default 1
  streak: number         // consecutive login days
  lastActiveDate?: Date
  emailVerified: boolean
  notifyDigest: boolean  // receive daily email digest
  notifyReminders: boolean
}
```

### Task
```ts
{
  userId: ObjectId        // indexed, all queries scoped by this
  title: string
  description?: string
  status: enum            // 'todo' | 'in_progress' | 'done' | 'archived'
  priority: enum          // 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: Date
  estimatedMinutes?: number
  tags: string[]
  listId?: ObjectId
  completedAt?: Date
  xpAwarded?: number
}
```

### TaskList
```ts
{
  userId: ObjectId
  name: string
  color?: string           // hex color for UI display
  icon?: string
}
```

### Canvas (GenUI)
```ts
{
  userId: ObjectId
  title: string
  intent: string           // the original user prompt
  nodes: Array<{ type: string; props: Record<string, any> }>
  taskIds: ObjectId[]      // tasks associated with this canvas
  pinned: boolean
  createdAt: Date
}
```

---

## Security

### Input Validation (All Endpoints)
Every controller uses DTOs with `class-validator` decorators. `ValidationPipe` with `whitelist: true` strips any fields not declared in the DTO — no extra fields reach the service layer.

```ts
// Example: ObjectId validation on all :id params
function validateObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID format')
}
```

Without this guard, passing a non-ObjectId string to Mongoose would throw an unhandled `CastError`, leaking stack traces.

### Rate Limiting
Auth endpoints have per-route `@Throttle` decorators:

```ts
@Throttle({ default: { limit: 5, ttl: 60000 } })   // 5 requests/minute
@Post('register')

@Throttle({ default: { limit: 10, ttl: 60000 } })  // 10 requests/minute
@Post('login')
```

This prevents brute-force attacks on login and spam signups.

### JWT Security
- `JWT_SECRET` loaded via `ConfigService.getOrThrow()` — app **will not start** if the variable is missing
- Tokens signed with HS256, expiry set to 7 days
- Tokens sent as `Authorization: Bearer <token>` headers (not cookies on the backend side)

### Password Security
- **argon2** used instead of bcrypt: memory-hard algorithm resistant to GPU brute-force
- Password strength enforced in DTO: 8+ chars, uppercase + digit required

### Prompt Injection Prevention
List names embedded in AI prompts are sanitised:
```ts
function sanitize(s: string): string {
  return s.replace(/["\\n\r]/g, '').slice(0, 100)
}
```

### Image URL Validation
User profile image URLs must be HTTPS:
```ts
@IsUrl({ protocols: ['https'], require_protocol: true })
image?: string
```

Prevents `javascript:` URIs being stored and rendered as image `src` attributes.

### Swagger Disabled in Production
```ts
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('api/docs', app, document)
}
```

The API schema is never exposed publicly in production.

### Security Issues Fixed During Review

| Issue | Fix |
|---|---|
| `findOne` used two queries with race window | Single atomic `findOne({ _id, userId })` |
| Re-completing tasks awarded XP multiple times | Added `status: { $ne: 'done' }` filter |
| `awardXp` threw `CastError` on invalid userId | `isValid()` guard before DB call |
| `listId` filter threw `CastError` on non-ObjectId | `isValid()` guard → `BadRequestException` |
| `saveCanvas` `taskIds` passed unvalidated | `validateObjectId()` called per ID in controller |
| SSE stream stayed open on AI exception | `try/finally { res.end() }` |
| `togglePin` threw plain `Error` → HTTP 500 | `NotFoundException` used instead |
| HTML injection in email templates | `escapeHtml()` applied to all user content |
| N+1 query in digest loop | Single batch `find({ _id: { $in: [...] } })` |
| `setInterval` digest drift in PM2 cluster | Recursive `scheduleMidnightDigest()` |

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register with email + password |
| POST | `/auth/login` | — | Login with email + password |
| POST | `/auth/google` | — | Login/register with Google ID token |
| GET | `/auth/me` | JWT | Get current user profile |

### Tasks
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tasks` | JWT | List tasks (filter: status, priority, listId) |
| POST | `/tasks` | JWT | Create task |
| GET | `/tasks/:id` | JWT | Get single task |
| PATCH | `/tasks/:id` | JWT | Update task fields |
| PATCH | `/tasks/:id/complete` | JWT | Mark done + award XP |
| DELETE | `/tasks/:id` | JWT | Delete task |
| POST | `/tasks/suggest` | JWT | AI field suggestions for a task |

### Lists
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/lists` | JWT | Get all lists for current user |
| POST | `/lists` | JWT | Create list |
| PATCH | `/lists/:id` | JWT | Update list |
| DELETE | `/lists/:id` | JWT | Delete list |

### GenUI
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/genui/compose` | JWT | Stream AI-generated layout (SSE) |
| POST | `/genui/clarify` | JWT | Ask AI a clarifying question |
| POST | `/genui/suggest-tasks` | JWT | Suggest tasks for an intent |
| GET | `/genui/canvases` | JWT | List saved canvases |
| POST | `/genui/canvases` | JWT | Save a canvas |
| PATCH | `/genui/canvases/:id/pin` | JWT | Toggle pinned status |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | JWT | Get profile |
| PATCH | `/users/me` | JWT | Update name/image |
| PATCH | `/users/me/notifications` | JWT | Update notification preferences |

### Mail
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/mail/send-plan` | JWT | Send task plan email immediately |

---

## Environment Variables

```env
PORT=3001
NODE_ENV=production

# MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://...

# Upstash Redis (for future queue support)
REDIS_URL=rediss://...

# JWT — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET=

# Google OAuth client ID (same value as frontend GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_ID=

# AI providers
GEMINI_API_KEY=        # aistudio.google.com
OPENROUTER_API_KEY=    # openrouter.ai
GROQ_API_KEY=          # console.groq.com

# Frontend URL for CORS allowlist
FRONTEND_URL=https://taskverse-frontend.vercel.app

# SMTP for email digests
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=             # Gmail App Password (not your account password)
```

---

## Local Development

```bash
# Install dependencies
npm install

# Start in watch mode (hot reload)
npm run start:dev

# Build for production
npm run build

# Start production build
npm run start:prod
```

API runs at http://localhost:3001  
Swagger docs at http://localhost:3001/api/docs

---

## Deployment

Deployed on a **Hostinger VPS** using PM2 cluster mode:

```bash
# On the server
git clone https://github.com/Iron-voldy/taskverse-backend.git
cd taskverse-backend
npm install
npm run build
pm2 start ecosystem.config.js --env production
pm2 save
```

### PM2 Config (`ecosystem.config.js`)
```js
{
  name: 'taskverse-api',
  script: 'dist/main.js',
  instances: 2,               // two processes for redundancy
  exec_mode: 'cluster',
  max_memory_restart: '512M',
  kill_timeout: 5000,         // 5s graceful shutdown
  exp_backoff_restart_delay: 100,
}
```

### Update Deploy
```bash
cd /root/taskverse-backend
git pull
npm run build
pm2 restart taskverse-api
```
