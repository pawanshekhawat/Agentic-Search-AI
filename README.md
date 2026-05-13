# Atreus

Atreus is a full-stack AI chat application with conversation history, source-aware answers, and configurable system prompt behavior.

Live URL : [Atreus](https://atreus-chat.vercel.app/)

## What You Can Do

- Sign in with Google or GitHub
- Start new chats and continue follow-up conversations
- View saved conversation history
- Rename or delete conversations from sidebar
- Get source links for web-backed answers
- Use a customizable system prompt for assistant behavior/instructions
- Stay within daily request limits with visible usage in UI

## Features

- Auth with Supabase
- Protected backend endpoints per user
- Conversation and message persistence with Prisma + PostgreSQL
- Conditional Tavily usage (web search only when needed)
- Markdown-rendered assistant answers
- Source panel per answer
- Daily request limiting (persisted in database)
- Optimistic UI transitions with loading states

## Tech Stack

- Frontend: React 19, Bun, TypeScript, Tailwind CSS
- Backend: Node/Bun runtime, Express, TypeScript
- Database ORM: Prisma
- Database: PostgreSQL (Supabase)
- Auth: Supabase Auth
- AI model API: Google Gemini via `@ai-sdk/google`
- Web search API: Tavily
- UI libs: Radix primitives + lucide-react + shadcn-style components
- Markdown rendering: `react-markdown`, `remark-gfm`, `rehype-raw`

## Optimization and Architecture Notes

- Tavily is constrained and not called for normal conversational prompts
- Daily request usage is stored in DB, not only memory
- Rate limit metadata is returned via headers and rendered in frontend usage UI
- Conversation route changes are optimistic with skeleton loading
- Sign-out and major actions provide immediate visual feedback
- React `StrictMode` wrapper was removed in app mount to avoid development double-effect confusion for this workflow

## How It Works (Workflow)

1. User signs in (Google/GitHub) through Supabase.
2. Frontend sends JWT in `Authorization: Bearer <token>`.
3. Backend middleware verifies user token and scopes data by `userId`.
4. For new asks:
   - Backend checks daily quota from DB.
   - Backend decides whether web search is needed.
   - If needed, Tavily results are added into prompt context.
   - Gemini streams answer back to frontend.
   - Conversation + messages are stored.
5. For follow-ups:
   - Existing conversation history is used.
   - Quota is checked again.
6. Frontend renders streamed content, markdown, and sources.
7. Usage counters and remaining requests are shown in UI.

## Prompt Configuration

System prompt is configurable using environment variables:

- `SYSTEM_PROMPT`: your custom system prompt
- `PROMPT_TEMPLATE`: prompt template used to inject context and user query

Fallback behavior:

- If `SYSTEM_PROMPT` is missing, backend uses a default prompt from source (`backend/promt.ts`)
- If `PROMPT_TEMPLATE` is missing, backend uses default template from same file

This allows each developer/team to customize assistant behavior safely without changing core code every time.

## Installation

### 1) Clone

```bash
git clone https://github.com/pawanshekhawat/Atreus.git
cd Atreus
```

### 2) Install dependencies

```bash
cd backend
bun install

cd ../frontend
bun install
```

### 3) Configure environment variables

Create `backend/.env`:

```env
# Required AI + search
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_key
TAVILY_API_KEY=your_tavily_key

# Database
DATABASE_URL=your_postgres_pool_url
DIRECT_URL=your_postgres_direct_url

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SECRET_KEY=your_supabase_service_role_key
SUPABASE_PUBLISAHABLE_KEY=your_supabase_publishable_key

# OAuth providers
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret

# Prompt config
SYSTEM_PROMPT=your_custom_system_prompt
PROMPT_TEMPLATE=your_custom_prompt_template

# Optional (default is 10)
RATE_LIMIT_MAX_REQUESTS_PER_DAY=10
```

### 4) Run Prisma

```bash
cd backend
bunx prisma generate
bunx prisma migrate deploy
```

If your provider requires direct DB connection for migrations, ensure `DATABASE_URL` points to direct connection (or set it temporarily to your direct URL).

### 5) Run backend

```bash
cd backend
bun index.ts
```

### 6) Run frontend

```bash
cd frontend
bun dev
```

Frontend default local URL: `http://localhost:3000`
Backend default local URL: `http://localhost:4000`

## API Keys and Services Needed

- Google AI API key (Gemini)
- Tavily API key
- Supabase project (Auth + Postgres)
- Google OAuth app credentials
- GitHub OAuth app credentials

## What To Add Next (Ideas Welcome)

If you use Atreus and have feature ideas, open an issue or discussion.

## Contribution

Contributions are welcome. Please open an issue first for major changes so implementation direction stays aligned.

## License
[MIT License | Open Source Initiative](https://opensource.org/license/mit).
