import { tavily } from "@tavily/core"
import express from "express";
import { streamText } from "ai";
import { google } from '@ai-sdk/google';
import { SYSTEM_PROMPT, PROMPT_TEMPLATE } from "./promt";
import z from "zod";
import { prisma } from "./db";
import { middleware } from "./auth-middleware";
import cors from "cors";
import { createSupabaseClient } from "./client";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
const supabase = createSupabaseClient();
const app = express();
const PORT = Number(process.env.PORT || 4000);

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, "");
}

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const envAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);

const allowedOrigins = new Set([...defaultAllowedOrigins.map(normalizeOrigin), ...envAllowedOrigins]);

app.use(express.json());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

const authHeaderSchema = z.object({
  authorization: z.string().startsWith("Bearer "),
});

const userIdParamSchema = z.object({
  id: z.string().min(1),
});

const renameConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
});

const followupBodySchema = z.object({
  conversationId: z.string().min(1),
  query: z.string().trim().min(1).max(1200),
});

const askBodySchema = z.object({
  query: z.string().trim().min(1).max(1200),
});

type UserDailyUsage = {
  dailyRequestLimit: number;
  dailyRequestsUsed: number;
  dailyRequestsUsedDate: string | null;
};

type DailyUsageStatus = {
  limit: number;
  used: number;
  remaining: number;
  dayKey: string;
  limited: boolean;
  retryAfterSeconds: number;
};

const RATE_LIMIT_MAX_REQUESTS_PER_DAY = Number(process.env.RATE_LIMIT_MAX_REQUESTS_PER_DAY ?? 10);
const MAX_HISTORY_MESSAGES_FOR_FOLLOWUP = 20;
const MAX_HISTORY_CHARS_FOR_FOLLOWUP = 12000;

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function getRetryAfterSeconds() {
  const now = new Date();
  const tomorrowUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  );
  return Math.max(1, Math.ceil((tomorrowUtc - now.getTime()) / 1000));
}

function normalizeDailyUsage(usage: UserDailyUsage): DailyUsageStatus {
  const dayKey = getUtcDayKey();
  const limit = usage.dailyRequestLimit || RATE_LIMIT_MAX_REQUESTS_PER_DAY;
  const used = usage.dailyRequestsUsedDate === dayKey ? usage.dailyRequestsUsed : 0;
  const remaining = Math.max(0, limit - used);

  return {
    limit,
    used,
    remaining,
    dayKey,
    limited: remaining <= 0,
    retryAfterSeconds: remaining <= 0 ? getRetryAfterSeconds() : 0,
  };
}

async function getDailyUsageStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dailyRequestLimit: true,
      dailyRequestsUsed: true,
      dailyRequestsUsedDate: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return normalizeDailyUsage(user);
}

async function consumeDailyRequest(userId: string) {
  const dayKey = getUtcDayKey();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        dailyRequestLimit: true,
        dailyRequestsUsed: true,
        dailyRequestsUsedDate: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const limit = user.dailyRequestLimit || RATE_LIMIT_MAX_REQUESTS_PER_DAY;

    await tx.user.updateMany({
      where: {
        id: userId,
        OR: [
          { dailyRequestsUsedDate: null },
          { dailyRequestsUsedDate: { not: dayKey } },
        ],
      },
        data: {
          dailyRequestLimit: limit,
          dailyRequestsUsed: 0,
          dailyRequestsUsedDate: dayKey,
        },
    });

    const consume = await tx.user.updateMany({
      where: {
        id: userId,
        dailyRequestsUsedDate: dayKey,
        dailyRequestsUsed: {
          lt: limit,
        },
      },
      data: {
        dailyRequestLimit: limit,
        dailyRequestsUsed: {
          increment: 1,
        },
      },
    });

    const updated = await tx.user.findUnique({
      where: { id: userId },
      select: {
        dailyRequestLimit: true,
        dailyRequestsUsed: true,
        dailyRequestsUsedDate: true,
      },
    });

    if (!updated) {
      throw new Error("User not found");
    }

    const normalized = normalizeDailyUsage(updated);
    if (consume.count === 0) {
      return {
        ...normalized,
        limited: true,
        remaining: 0,
        retryAfterSeconds: getRetryAfterSeconds(),
      };
    }

    return normalized;
  });
}

async function getUserFromAuthHeader(authorizationHeader: string) {
  const token = authorizationHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

function makeConversationSlug(query: string) {
  const base = query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48);

  const fallback = base || "conversation";
  return `${fallback}-${Date.now().toString(36)}`;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

function trimConversationHistory(messages: Array<{ role: string; content: string }>) {
  let remainingChars = MAX_HISTORY_CHARS_FOR_FOLLOWUP;
  const selected: Array<{ role: string; content: string }> = [];

  for (const message of messages.slice(-MAX_HISTORY_MESSAGES_FOR_FOLLOWUP).reverse()) {
    if (remainingChars <= 0) break;
    const content = message.content.slice(0, remainingChars);
    selected.unshift({ role: message.role, content });
    remainingChars -= content.length;
  }

  return selected;
}

function isSimpleGreetingQuery(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  const compact = normalized.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const greetingSet = new Set([
    "hi",
    "hii",
    "hello",
    "hey",
    "yo",
    "sup",
    "hola",
    "whats up",
    "what's up",
    "how are you",
    "who are you",
    "what is your name",
    "what's your name",
  ]);
  if (greetingSet.has(compact)) return true;
  const conversationalPatterns = [
    "whats your name",
    "what is your name",
    "who built you",
    "who is your developer",
    "who made you",
    "hello whats your name",
    "hello what is your name",
    "how are you",
  ];
  if (conversationalPatterns.some((p) => compact.includes(p))) return true;
  return compact.split(/\s+/).length <= 5 && greetingSet.has(compact);
}

function shouldUseTavilySearch(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized || isSimpleGreetingQuery(query)) return false;

  const compact = normalized.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = compact.split(/\s+/).filter(Boolean).length;

  const freshInfoPatterns = [
    /\b(today|tonight|tomorrow|yesterday|this week|this month|this year|right now|currently|current|latest|recent|new|news|breaking|live|real time|updated)\b/,
    /\b(price|stock|share price|crypto|bitcoin|weather|forecast|score|fixture|schedule|release date|version|changelog|docs|documentation)\b/,
    /\b(who is the current|president|prime minister|ceo|founder of|head of)\b/,
    /\b(best|top|compare|alternatives|reviews|near me|where to buy)\b/,
    /\b(source|sources|cite|citation|link|links|references|verify|fact check)\b/,
  ];

  if (freshInfoPatterns.some((pattern) => pattern.test(compact))) {
    return true;
  }

  const conversationalPatterns = [
    /\b(how are you|what are you doing|are you there|can you help|thanks|thank you|ok|okay|nice|cool|lol|lmao)\b/,
    /\b(tell me a joke|roast me|motivate me|give me advice|what should i do)\b/,
    /\b(explain|teach|summarize|write|draft|rewrite|improve|fix|debug|plan|brainstorm)\b/,
    /\b(my name is|remember that|do you know me|who am i)\b/,
  ];

  if (conversationalPatterns.some((pattern) => pattern.test(compact))) {
    return false;
  }

  if (/^what is\b/.test(compact) || /^who is\b/.test(compact) || /^where is\b/.test(compact)) {
    return wordCount >= 5;
  }

  return false;
}

function getCachedConversationalReply(query: string) {
  const compact = query.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact === "hi" || compact === "hii" || compact === "hello" || compact === "hey") {
    return "Hello! I am Atreus. How can I help you today?";
  }
  if (compact.includes("whats your name") || compact.includes("what is your name")) {
    return "My name is Atreus.";
  }
  if (compact.includes("who built you") || compact.includes("who made you") || compact.includes("who is your developer")) {
    return "I am Atreus. My developer is Pawan Shekhawat.";
  }
  if (compact.includes("how are you")) {
    return "I am doing well and ready to help. What do you want to work on?";
  }
  return null;
}

// Signup
app.post("/signup", async (req, res) => {
  try {
    const parsedHeaders = authHeaderSchema.safeParse({
      authorization: req.headers.authorization,
    });

    if (!parsedHeaders.success) {
      return res.status(401).json({
        error: "Missing or invalid Authorization header",
      });
    }

    const user = await getUserFromAuthHeader(parsedHeaders.data.authorization);
    if (!user || !user.email) {
      return res.status(401).json({
        error: "Invalid token",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { id: user.id },
    });

    if (existing) {
      return res.status(200).json({
        message: "User already exists",
        user: existing,
      });
    }

    const createdUser = await prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        provider:
          user.app_metadata.provider === "google" ? "Google" : "Github",
        name: user.user_metadata.full_name ?? user.email,
      },
    });

    return res.status(201).json({
      message: "User created successfully",
      user: createdUser,
    });
  } catch (error) {
    console.error("Signup failed:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }

})

//Signin
app.post("/signin", async (req, res) => {
  try {
    const parsedHeaders = authHeaderSchema.safeParse({
      authorization: req.headers.authorization,
    });

    if (!parsedHeaders.success) {
      return res.status(401).json({
        error: "Missing or invalid Authorization header",
      });
    }

    const user = await getUserFromAuthHeader(parsedHeaders.data.authorization);
    if (!user) {
      return res.status(401).json({
        error: "Invalid token",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!existing) {
      return res.status(404).json({
        error: "User not found. Please sign up first.",
      });
    }

    return res.status(200).json({
      message: "Sign in successful",
      user: existing,
    });
  } catch (error) {
    console.error("Signin failed:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }

})

// Past conversations get
app.get("/conversations", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: req.userId,
      },
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        slug: true,
        title: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const usage = await getDailyUsageStatus(req.userId);

    return res.status(200).json({
      conversations,
      usage,
    });
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
})

app.get("/me/usage", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const usage = await getDailyUsageStatus(req.userId);
    return res.status(200).json({ usage });
  } catch (error) {
    console.error("Failed to fetch usage:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

// Past conversation get by id
app.get("/conversations/:id", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const parsedParams = userIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({
        error: "Invalid conversation id",
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parsedParams.data.id,
        userId: req.userId,
      },
      select: {
        id: true,
        slug: true,
        title: true,
        messages: {
          orderBy: {
            CreatedAt: "asc",
          },
          select: {
            id: true,
            role: true,
            content: true,
            CreatedAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    return res.status(200).json({
      conversation,
    });
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
})

app.get("/avatar", async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!rawUrl) {
      return res.status(400).send("Missing url");
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).send("Invalid url");
    }

    const allowedHosts = [
      "googleusercontent.com",
      "githubusercontent.com",
      "avatars.githubusercontent.com",
      "gravatar.com",
    ];

    const host = parsed.hostname.toLowerCase();
    const isAllowed = allowedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!isAllowed) {
      return res.status(403).send("Host not allowed");
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      return res.status(upstream.status).send("Upstream fetch failed");
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Avatar proxy failed:", error);
    return res.status(500).send("Avatar proxy error");
  }
});

app.patch("/conversations/:id", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedParams = userIdParamSchema.safeParse(req.params);
    const parsedBody = renameConversationBodySchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        id: parsedParams.data.id,
        userId: req.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const updated = await prisma.conversation.update({
      where: { id: parsedParams.data.id },
      data: { title: parsedBody.data.title },
      select: { id: true, title: true },
    });

    return res.status(200).json({ conversation: updated });
  } catch (error) {
    console.error("Failed to rename conversation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/conversations/:id/rename", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedParams = userIdParamSchema.safeParse(req.params);
    const parsedBody = renameConversationBodySchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        id: parsedParams.data.id,
        userId: req.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const updated = await prisma.conversation.update({
      where: { id: parsedParams.data.id },
      data: { title: parsedBody.data.title },
      select: { id: true, title: true },
    });

    return res.status(200).json({ conversation: updated });
  } catch (error) {
    console.error("Failed to rename conversation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/conversations/:id", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedParams = userIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        id: parsedParams.data.id,
        userId: req.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await prisma.message.deleteMany({
      where: { conversationId: parsedParams.data.id },
    });

    await prisma.conversation.delete({
      where: { id: parsedParams.data.id },
    });

    return res.status(200).json({ message: "Conversation deleted" });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/conversations/:id/delete", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedParams = userIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        id: parsedParams.data.id,
        userId: req.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await prisma.message.deleteMany({
      where: { conversationId: parsedParams.data.id },
    });

    await prisma.conversation.delete({
      where: { id: parsedParams.data.id },
    });

    return res.status(200).json({ message: "Conversation deleted" });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/atreus_ask", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }
    const parsedBody = askBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        error: "Invalid request body",
      });
    }

    const rateLimitResult = await consumeDailyRequest(req.userId);
    if (rateLimitResult.limited) {
      res.setHeader("Retry-After", rateLimitResult.retryAfterSeconds.toString());
      res.setHeader("X-RateLimit-Limit", rateLimitResult.limit.toString());
      res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
      res.setHeader("X-RateLimit-Used", rateLimitResult.used.toString());
      return res.status(429).json({
        error: `Rate limit exceeded. Max ${rateLimitResult.limit} requests per day.`,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        usage: rateLimitResult,
      });
    }
    res.setHeader("X-RateLimit-Limit", rateLimitResult.limit.toString());
    res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
    res.setHeader("X-RateLimit-Used", rateLimitResult.used.toString());

    const query = parsedBody.data.query;
    const slug = makeConversationSlug(query);
    const title = query.length > 80 ? `${query.slice(0, 80)}...` : query;

    const conversation = await prisma.conversation.create({
      data: {
        slug,
        title,
        userId: req.userId,
      },
      select: {
        id: true,
      },
    });

    await prisma.message.create({
      data: {
        content: query,
        role: "User",
        conversationId: conversation.id,
      },
    });

    const cachedReply = getCachedConversationalReply(query);
    const shouldUseWebSearch = !cachedReply && shouldUseTavilySearch(query);
    const webSearchResponse = shouldUseWebSearch
      ? await client.search(query, { searchDepth: "advanced" })
      : null;

    const webSearchResults = webSearchResponse?.results ?? [];

    const prompt = shouldUseWebSearch
      ? PROMPT_TEMPLATE.replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResponse)).replace(
        "{{USER_QUERY}}",
        query
      )
      : `## USER_QUERY\n${query}\n\n## Context\nThis is simple conversational input. Respond briefly as Atreus without citing web sources.`;

    const result = cachedReply
      ? null
      : streamText({
        model: google("gemini-2.5-flash"),
        prompt,
        system: SYSTEM_PROMPT,
      });

    let assistantResponse = cachedReply ?? "";

    res.header("Cache-Control", "no-cache");
    res.header("Content-Type", "text/event-stream");
    if (cachedReply) {
      res.write(cachedReply);
    } else if (result) {
      for await (const textPart of result.textStream) {
        assistantResponse += textPart;
        res.write(textPart);
      }
    }
    if (webSearchResults.length > 0) {
      res.write("\n<SOURCES>\n");
      res.write(JSON.stringify(webSearchResults.map((result) => ({ url: result.url }))));
      res.write("\n</SOURCES>\n");
    }
    res.write(`\n<CONVERSATION_ID>${conversation.id}</CONVERSATION_ID>\n`);
    res.end();

    if (assistantResponse.trim()) {
      await prisma.message.create({
        data: {
          content:
            webSearchResults.length > 0
              ? `${assistantResponse.trim()}\n<SOURCES>\n${JSON.stringify(webSearchResults.map((result) => ({ url: result.url })))}\n</SOURCES>`
              : assistantResponse.trim(),
          role: "Assistant",
          conversationId: conversation.id,
        },
      });
    }
  } catch (error) {
    console.error("Failed to process /atreus_ask:", error);
    const message = safeErrorMessage(error);
    if (!res.headersSent) {
      return res.status(502).json({
        error: message,
      });
    }
    res.write(`\n<ERROR>${message}</ERROR>\n`);
    res.end();
  }
})

app.post("/atreus_ask/followups", middleware, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }
    const parsedBody = followupBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        error: "Invalid request body",
      });
    }

    const rateLimitResult = await consumeDailyRequest(req.userId);
    if (rateLimitResult.limited) {
      res.setHeader("Retry-After", rateLimitResult.retryAfterSeconds.toString());
      res.setHeader("X-RateLimit-Limit", rateLimitResult.limit.toString());
      res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
      res.setHeader("X-RateLimit-Used", rateLimitResult.used.toString());
      return res.status(429).json({
        error: `Rate limit exceeded. Max ${rateLimitResult.limit} requests per day.`,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        usage: rateLimitResult,
      });
    }
    res.setHeader("X-RateLimit-Limit", rateLimitResult.limit.toString());
    res.setHeader("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
    res.setHeader("X-RateLimit-Used", rateLimitResult.used.toString());

    const { conversationId, query } = parsedBody.data;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: req.userId,
      },
      select: {
        id: true,
        messages: {
          orderBy: {
            CreatedAt: "asc",
          },
          select: {
            role: true,
            content: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    const conversationHistory = trimConversationHistory(conversation.messages)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const shouldUseWebSearch = shouldUseTavilySearch(query);
    const webSearchResponse = shouldUseWebSearch
      ? await client.search(query, { searchDepth: "advanced" })
      : null;
    const webSearchResults = webSearchResponse?.results ?? [];

    const followupPrompt = [
      "You are continuing an existing conversation.",
      "Use the chat history below and answer the latest user follow-up query.",
      "",
      "## Chat History",
      conversationHistory || "No prior messages.",
      "",
      "## Web Search Results",
      shouldUseWebSearch ? JSON.stringify(webSearchResponse) : "No web search used for this query.",
      "",
      "## Latest User Follow-up Query",
      query,
    ].join("\n");

    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM_PROMPT,
      prompt: followupPrompt,
    });

    await prisma.message.create({
      data: {
        content: query,
        role: "User",
        conversationId,
      },
    });

    let assistantResponse = "";

    res.header("Cache-Control", "no-cache");
    res.header("Content-Type", "text/event-stream");

    for await (const textPart of result.textStream) {
      assistantResponse += textPart;
      res.write(textPart);
    }

    if (webSearchResults.length > 0) {
      res.write("\n<SOURCES>\n");
      res.write(JSON.stringify(webSearchResults.map((result) => ({ url: result.url }))));
      res.write("\n</SOURCES>\n");
    }

    res.end();

    if (assistantResponse.trim()) {
      await prisma.message.create({
        data: {
          content:
            webSearchResults.length > 0
              ? `${assistantResponse.trim()}\n<SOURCES>\n${JSON.stringify(webSearchResults.map((result) => ({ url: result.url })))}\n</SOURCES>`
              : assistantResponse.trim(),
          role: "Assistant",
          conversationId,
        },
      });
    }
  } catch (error) {
    console.error("Failed to generate follow-up response:", error);
    const message = safeErrorMessage(error);
    if (!res.headersSent) {
      return res.status(502).json({
        error: message,
      });
    }
    res.write(`\n<ERROR>${message}</ERROR>\n`);
    res.end();
  }
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
