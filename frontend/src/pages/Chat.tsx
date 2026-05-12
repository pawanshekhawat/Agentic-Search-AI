import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/auth-js/dist/module/lib/types";
import { useEffect, useRef, useState, type JSX } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { BACKEND_URL, BUILDER_LINKEDIN_URL } from "@/lib/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Copy, Ellipsis, Eraser, ExternalLink, Github, LoaderCircle, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Search, SendHorizontal, Sparkles, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

type Conversation = {
    id: string;
    slug: string;
    title: string | null;
    _count: {
        messages: number;
    };
};

type ConversationMessage = {
    id: number;
    role: "User" | "Assistant";
    content: string;
    CreatedAt: string;
};

type ConversationDetail = {
    id: string;
    slug: string;
    title: string | null;
    messages: ConversationMessage[];
};

type DailyUsage = {
    limit: number;
    used: number;
    remaining: number;
    dayKey: string;
    limited: boolean;
    retryAfterSeconds: number;
};

type ChatMessage = {
    id: string;
    role: "User" | "Assistant";
    content: string;
    isStreaming?: boolean;
};

const DEFAULT_STARTER_QUESTIONS = [
    "How to drink water?",
    "Teach me something genuinely useful!",
    "How do I become rich overnight?",
    "How to become mysterious?",
];

const MAX_QUERY_LENGTH = 1200;

const supabase = createClient();

async function getJwt() {
    const {
        data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
        throw new Error("No active session found");
    }

    return session.access_token;
}

function extractSourceUrls(streamedText: string): string[] {
    const sourceMatch = streamedText.match(/<SOURCES>\s*([\s\S]*?)\s*<\/SOURCES>/);
    if (!sourceMatch?.[1]) return [];

    try {
        const parsed = JSON.parse(sourceMatch[1]) as Array<{ url?: string }>;
        return parsed.map((item) => item.url).filter((url): url is string => Boolean(url));
    } catch {
        return [];
    }
}

function removeSourcesBlock(streamedText: string) {
    return streamedText.replace(/\n?<SOURCES>[\s\S]*?<\/SOURCES>\n?/g, "").trim();
}

function extractConversationId(streamedText: string): string | null {
    const match = streamedText.match(/<CONVERSATION_ID>(.*?)<\/CONVERSATION_ID>/);
    return match?.[1]?.trim() || null;
}

function removeConversationIdBlock(streamedText: string) {
    return streamedText.replace(/\n?<CONVERSATION_ID>[\s\S]*?<\/CONVERSATION_ID>\n?/g, "").trim();
}

function extractErrorBlock(streamedText: string): string | null {
    const match = streamedText.match(/<ERROR>([\s\S]*?)<\/ERROR>/);
    return match?.[1]?.trim() || null;
}

function removeErrorBlock(streamedText: string) {
    return streamedText.replace(/\n?<ERROR>[\s\S]*?<\/ERROR>\n?/g, "").trim();
}

function extractAnswerText(streamedText: string) {
    const answerMatch = streamedText.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/i);
    if (answerMatch?.[1]) {
        return answerMatch[1].trim();
    }

    const openTagIndex = streamedText.indexOf("<ANSWER>");
    if (openTagIndex >= 0) {
        return streamedText.slice(openTagIndex + "<ANSWER>".length).trim();
    }

    return streamedText.trim();
}

function stripXmlLikeTags(text: string) {
    return text
        .replace(/\n?<SOURCES>[\s\S]*?<\/SOURCES>\n?/gi, "\n")
        .replace(/<\/?ANSWER>/gi, "")
        .replace(/\n?<FOLLOW_UPS>[\s\S]*?<\/FOLLOW_UPS>\n?/gi, "\n")
        .replace(/<\/?FOLLOW_UPS>/gi, "")
        .replace(/<\/?question>/gi, "")
        .replace(/<\/?[A-Z_]+>/g, "")
        .trim();
}

function normalizeAssistantText(streamedText: string) {
    return stripXmlLikeTags(extractAnswerText(streamedText));
}

async function getApiErrorMessage(response: Response) {
    const body = await response.json().catch(() => null) as { error?: string; retryAfterSeconds?: number; usage?: DailyUsage } | null;
    if (body?.retryAfterSeconds) {
        const hours = Math.ceil(body.retryAfterSeconds / 3600);
        return `${body.error || "Rate limit exceeded"} Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
    }
    return body?.error || `Request failed with status ${response.status}`;
}

function queryLooksWebWorthy(query: string) {
    const compact = query.trim().toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
    if (!compact) return false;
    if (/\b(hi|hello|hey|yo|thanks|thank you|how are you|what is your name|who built you|who made you)\b/.test(compact)) {
        return false;
    }
    return /\b(today|current|currently|latest|recent|news|live|price|stock|weather|score|version|docs|documentation|source|sources|cite|verify|fact check|best|top|compare|reviews|near me)\b/.test(compact);
}

function updateUsageFromHeaders(response: Response, setDailyUsage: (usage: DailyUsage) => void) {
    const limit = Number(response.headers.get("X-RateLimit-Limit"));
    const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
    const used = Number(response.headers.get("X-RateLimit-Used"));

    if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(used)) {
        return;
    }

    setDailyUsage({
        limit,
        used,
        remaining,
        dayKey: new Date().toISOString().slice(0, 10),
        limited: remaining <= 0,
        retryAfterSeconds: 0,
    });
}

function renderAssistantContent(text: string) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
                h1: ({ children }) => <h1 className="mb-3 mt-5 text-2xl font-semibold text-white">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-2 mt-4 text-xl font-semibold text-white">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-2 mt-3 text-lg font-semibold text-white">{children}</h3>,
                h4: ({ children }) => <h4 className="mb-1 mt-3 text-base font-semibold text-white">{children}</h4>,
                h5: ({ children }) => <h5 className="mb-1 mt-2 text-sm font-semibold text-white">{children}</h5>,
                h6: ({ children }) => <h6 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-200">{children}</h6>,
                p: ({ children }) => <p className="mb-3 whitespace-pre-wrap leading-7 text-slate-100">{children}</p>,
                a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-cyan-300 underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-200">
                        {children}
                    </a>
                ),
                ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6 text-slate-100">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6 text-slate-100">{children}</ol>,
                li: ({ children }) => <li className="leading-7">{children}</li>,
                table: ({ children }) => (
                    <div className="mb-4 overflow-x-auto">
                        <table className="w-full border-collapse text-sm text-slate-100">{children}</table>
                    </div>
                ),
                thead: ({ children }) => <thead className="border-b border-white/15">{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr className="border-b border-white/10">{children}</tr>,
                th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-white">{children}</th>,
                td: ({ children }) => <td className="px-3 py-2 align-top text-slate-200">{children}</td>,
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                em: ({ children }) => <em className="italic text-slate-100">{children}</em>,
                code: ({ children }) => <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-cyan-100">{children}</code>,
                hr: () => <hr className="my-4 border-white/15" />,
            }}
        >
            {stripXmlLikeTags(text)}
        </ReactMarkdown>
    );
}

function ConversationSkeleton() {
    return (
        <div className="space-y-5">
            <div className="flex justify-end">
                <div className="h-12 w-[58%] max-w-md animate-pulse rounded-2xl bg-cyan-400/20" />
            </div>
            <div className="space-y-3">
                <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[92%] animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[84%] animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[68%] animate-pulse rounded bg-white/10" />
            </div>
            <div className="flex justify-end">
                <div className="h-10 w-[42%] max-w-sm animate-pulse rounded-2xl bg-cyan-400/20" />
            </div>
            <div className="space-y-3">
                <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[88%] animate-pulse rounded bg-white/10" />
                <div className="h-4 w-[76%] animate-pulse rounded bg-white/10" />
            </div>
        </div>
    );
}

export const Chat = () => {
    const navigate = useNavigate();
    const params = useParams<{ conversationId?: string }>();
    const initialConversationIdFromUrl = params.conversationId ?? null;

    const [user, setUser] = useState<User | null>(null);
    const [authResolved, setAuthResolved] = useState(false);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [dailyUsage, setDailyUsage] = useState<DailyUsage | null>(null);

    const [askQuery, setAskQuery] = useState("");
    const [isStreamingAsk, setIsStreamingAsk] = useState(false);
    const [latestSources, setLatestSources] = useState<string[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [conversationMessageSources, setConversationMessageSources] = useState<Record<string, string[]>>({});
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
    const [editingConversationTitle, setEditingConversationTitle] = useState("");
    const [pendingDeleteConversation, setPendingDeleteConversation] = useState<Conversation | null>(null);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [toastTone, setToastTone] = useState<"default" | "destructive">("default");
    const [hiddenConversationIds, setHiddenConversationIds] = useState<string[]>([]);
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);
    const [welcomeChecked, setWelcomeChecked] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const conversationLoadSeq = useRef(0);
    const userScopedHiddenKey = user?.id ? `atreus:hidden:${user.id}` : null;

    useEffect(() => {
        let mounted = true;

        async function init() {
            const { data } = await supabase.auth.getUser();
            if (!mounted) return;
            setUser(data.user ?? null);
            setAuthResolved(true);
        }

        init();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUser = session?.user ?? null;
            setUser((prevUser) => {
                if (prevUser?.id === nextUser?.id && prevUser?.email === nextUser?.email) {
                    return prevUser;
                }
                return nextUser;
            });
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    async function loadConversations() {
        if (!user) return;
        setErrorMessage(null);

        try {
            const jwt = await getJwt();
            const response = await fetch(`${BACKEND_URL}/conversations`, {
                headers: {
                    Authorization: `Bearer ${jwt}`,
                },
            });

            if (!response.ok) {
                throw new Error("Failed to load conversations");
            }

            const data = await response.json() as { conversations?: Conversation[]; usage?: DailyUsage };
            const visible = (data.conversations ?? []).filter((c) => !hiddenConversationIds.includes(c.id));
            setConversations(visible);
            if (data.usage) {
                setDailyUsage(data.usage);
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to load conversations");
        }
    }

    async function loadDailyUsage() {
        if (!user) return;

        try {
            const jwt = await getJwt();
            const response = await fetch(`${BACKEND_URL}/me/usage`, {
                headers: {
                    Authorization: `Bearer ${jwt}`,
                },
            });

            if (!response.ok) {
                throw new Error("Failed to load usage");
            }

            const data = await response.json() as { usage?: DailyUsage };
            if (data.usage) {
                setDailyUsage(data.usage);
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to load usage");
        }
    }

    async function loadConversationById(id: string, options?: { syncUrl?: boolean; optimistic?: boolean }) {
        const requestId = ++conversationLoadSeq.current;
        setErrorMessage(null);
        setLoadingConversationId(id);
        setSelectedConversationId(id);
        setSelectedConversation(null);
        setChatMessages([]);
        setLatestSources([]);
        setIsSourcesPanelOpen(false);
        setConversationMessageSources({});

        if (options?.syncUrl !== false) {
            navigate(`/c/${id}`, { replace: false });
        }

        try {
            const jwt = await getJwt();
            const response = await fetch(`${BACKEND_URL}/conversations/${id}`, {
                headers: {
                    Authorization: `Bearer ${jwt}`,
                },
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error("Conversation not found or this conversation doesn't belong to you");
                }
                throw new Error("Failed to load conversation");
            }

            const data = await response.json() as { conversation: ConversationDetail };
            if (requestId !== conversationLoadSeq.current) return;
            setSelectedConversation(data.conversation);
            setSelectedConversationId(id);
            const mappedMessages = data.conversation.messages.map((message) => ({
                id: `history-${message.id}`,
                role: message.role,
                content: message.content,
            }));
            setChatMessages(mappedMessages);

            const sourcesMap: Record<string, string[]> = {};
            mappedMessages.forEach((message) => {
                if (message.role === "Assistant") {
                    const sources = extractSourceUrls(message.content);
                    if (sources.length > 0) {
                        sourcesMap[message.id] = sources;
                    }
                }
            });
            setConversationMessageSources(sourcesMap);

            const lastAssistantWithSources = [...mappedMessages]
                .reverse()
                .find((msg) => msg.role === "Assistant" && (sourcesMap[msg.id]?.length ?? 0) > 0);
            const nextSources = lastAssistantWithSources ? sourcesMap[lastAssistantWithSources.id] ?? [] : [];
            setLatestSources(nextSources);
            setIsSourcesPanelOpen(false);
        } catch (error) {
            if (requestId !== conversationLoadSeq.current) return;
            setErrorMessage(error instanceof Error ? error.message : "Failed to load conversation");
        } finally {
            if (requestId === conversationLoadSeq.current) {
                setLoadingConversationId(null);
            }
        }
    }

    useEffect(() => {
        if (user?.id) {
            loadConversations();
        } else {
            setConversations([]);
            setSelectedConversation(null);
            setSelectedConversationId(null);
            setChatMessages([]);
            setLoadingConversationId(null);
            setDailyUsage(null);
        }
    }, [user?.id, hiddenConversationIds]);

    useEffect(() => {
        if (
            user?.id &&
            initialConversationIdFromUrl &&
            initialConversationIdFromUrl !== selectedConversationId &&
            initialConversationIdFromUrl !== loadingConversationId
        ) {
            loadConversationById(initialConversationIdFromUrl, { syncUrl: false });
        }
    }, [user?.id, initialConversationIdFromUrl, selectedConversationId, loadingConversationId]);

    useEffect(() => {
        if (!userScopedHiddenKey) return;
        try {
            const hidden = localStorage.getItem(userScopedHiddenKey);
            setHiddenConversationIds(hidden ? (JSON.parse(hidden) as string[]) : []);
        } catch {
            setHiddenConversationIds([]);
        }
    }, [userScopedHiddenKey]);

    useEffect(() => {
        if (!chatScrollRef.current) return;
        const container = chatScrollRef.current;
        const animation = requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
        return () => cancelAnimationFrame(animation);
    }, [chatMessages, isStreamingAsk]);

    useEffect(() => {
        if (!hiddenConversationIds.length) return;
        setConversations((prev) => prev.filter((c) => !hiddenConversationIds.includes(c.id)));
    }, [hiddenConversationIds]);

    useEffect(() => {
        if (!user?.id || welcomeChecked) return;
        const key = `atreus:welcome-seen:${user.id}`;
        const seen = localStorage.getItem(key) === "1";
        if (!seen) {
            setShowWelcomeModal(true);
        }
        setWelcomeChecked(true);
    }, [user?.id, welcomeChecked]);

    useEffect(() => {
        if (!toastMessage) return;
        const timer = setTimeout(() => setToastMessage(null), 1800);
        return () => clearTimeout(timer);
    }, [toastMessage]);

    function showToast(message: string, tone: "default" | "destructive" = "default") {
        setToastTone(tone);
        setToastMessage(message);
    }

    async function askNewQuestion(query: string) {
        if (!query.trim()) return;
        setErrorMessage(null);
        setIsStreamingAsk(true);
        setLatestSources([]);

        try {
            const jwt = await getJwt();
            const userMessageId = `user-${Date.now()}`;
            const assistantMessageId = `assistant-${Date.now()}`;
            setSelectedConversation(null);
            setSelectedConversationId(null);
            setChatMessages([
                { id: userMessageId, role: "User", content: query.trim() },
                { id: assistantMessageId, role: "Assistant", content: "", isStreaming: true },
            ]);

            const response = await fetch(`${BACKEND_URL}/atreus_ask`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({ query }),
            });

            if (!response.ok) {
                await loadDailyUsage().catch(() => undefined);
                throw new Error(await getApiErrorMessage(response));
            }
            updateUsageFromHeaders(response, setDailyUsage);

            if (!response.body) {
                throw new Error("No stream response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += decoder.decode(value, { stream: true });
                const withoutSources = removeSourcesBlock(fullText);
                const assistantText = removeConversationIdBlock(withoutSources);
                const cleanedAssistantText = removeErrorBlock(assistantText);
                const answerText = normalizeAssistantText(cleanedAssistantText);
                setChatMessages((prev) =>
                    prev.map((message) =>
                        message.id === assistantMessageId
                            ? { ...message, content: answerText, isStreaming: true }
                            : message
                    )
                );
            }

            const streamError = extractErrorBlock(fullText);
            if (streamError) {
                setErrorMessage(streamError);
            }
            const sources = extractSourceUrls(fullText);
            setLatestSources(sources);
            if (sources.length > 0) {
                setConversationMessageSources((prev) => ({ ...prev, [assistantMessageId]: sources }));
            }
            const conversationId = extractConversationId(fullText);
            setChatMessages((prev) =>
                prev.map((message) =>
                    message.id === assistantMessageId ? { ...message, isStreaming: false } : message
                )
            );
            await loadConversations();
            if (conversationId) {
                await loadConversationById(conversationId);
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to fetch answer");
        } finally {
            setIsStreamingAsk(false);
        }
    }

    async function askFollowup(query: string) {
        if (!query.trim()) return;
        if (!selectedConversationId) {
            setErrorMessage("Select a saved conversation to ask follow-ups.");
            return;
        }

        setErrorMessage(null);
        setIsStreamingAsk(true);
        setLatestSources([]);

        try {
            const jwt = await getJwt();
            const userMessageId = `user-${Date.now()}`;
            const assistantMessageId = `assistant-${Date.now()}`;
            setChatMessages((prev) => [
                ...prev,
                { id: userMessageId, role: "User", content: query.trim() },
                { id: assistantMessageId, role: "Assistant", content: "", isStreaming: true },
            ]);

            const response = await fetch(`${BACKEND_URL}/atreus_ask/followups`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                    conversationId: selectedConversationId,
                    query,
                }),
            });

            if (!response.ok) {
                await loadDailyUsage().catch(() => undefined);
                throw new Error(await getApiErrorMessage(response));
            }
            updateUsageFromHeaders(response, setDailyUsage);

            if (!response.body) {
                throw new Error("No stream response body");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += decoder.decode(value, { stream: true });
                const cleanedText = removeErrorBlock(fullText);
                const answerText = normalizeAssistantText(cleanedText);
                setChatMessages((prev) =>
                    prev.map((message) =>
                        message.id === assistantMessageId
                            ? { ...message, content: answerText, isStreaming: true }
                            : message
                    )
                );
            }

            const streamError = extractErrorBlock(fullText);
            if (streamError) {
                setErrorMessage(streamError);
            }
            setIsSourcesPanelOpen(false);
            setChatMessages((prev) =>
                prev.map((message) =>
                    message.id === assistantMessageId ? { ...message, isStreaming: false } : message
                )
            );
            await loadConversationById(selectedConversationId);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to fetch follow-up");
        } finally {
            setIsStreamingAsk(false);
        }
    }

    async function handleSend(forcedQuery?: string) {
        const query = (forcedQuery ?? askQuery).trim();
        if (!query) return;

        setAskQuery("");

        if (selectedConversationId) {
            await askFollowup(query);
            return;
        }

        await askNewQuestion(query);
    }

    async function handleDeleteConversation(conversationId: string) {
        const next = Array.from(new Set([...hiddenConversationIds, conversationId]));
        setHiddenConversationIds(next);
        if (userScopedHiddenKey) {
            localStorage.setItem(userScopedHiddenKey, JSON.stringify(next));
        }
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        if (selectedConversationId === conversationId) {
            handleNewChat();
        }
        setToastTone("destructive");
        setToastMessage("Conversation deleted.");
    }

    function startInlineRename(conversationId: string, currentTitle: string | null) {
        setEditingConversationId(conversationId);
        setEditingConversationTitle(currentTitle || "Untitled conversation");
    }

    async function submitInlineRename(conversationId: string) {
        const trimmed = editingConversationTitle.trim();
        if (!trimmed) {
            setEditingConversationId(null);
            return;
        }
        try {
            const jwt = await getJwt();
            let response = await fetch(`${BACKEND_URL}/conversations/${conversationId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({ title: trimmed }),
            });
            if (response.status === 404 || response.status === 405) {
                response = await fetch(`${BACKEND_URL}/conversations/${conversationId}/rename`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${jwt}`,
                    },
                    body: JSON.stringify({ title: trimmed }),
                });
            }
            if (!response.ok) {
                const err = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(err?.error || "Failed to rename conversation");
            }
            setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, title: trimmed } : c)));
            if (selectedConversation?.id === conversationId) {
                setSelectedConversation((prev) => (prev ? { ...prev, title: trimmed } : prev));
            }
            setEditingConversationId(null);
            showToast("Conversation renamed.");
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Failed to rename conversation");
        }
    }

    function handleNewChat() {
        setSelectedConversation(null);
        setSelectedConversationId(null);
        setChatMessages([]);
        setLatestSources([]);
        setIsSourcesPanelOpen(false);
        setConversationMessageSources({});
        setErrorMessage(null);
        setAskQuery("");
        setEditingConversationId(null);
        navigate("/", { replace: false });
    }

    async function handleCopyResponse(messageId: string, content: string) {
        try {
            await navigator.clipboard.writeText(stripXmlLikeTags(content));
            setCopiedMessageId(messageId);
            setTimeout(() => setCopiedMessageId((current) => (current === messageId ? null : current)), 1500);
            showToast("Copied to clipboard.");
        } catch {
            setErrorMessage("Failed to copy response");
        }
    }

    async function handleSignOut() {
        if (isSigningOut) return;
        setIsSigningOut(true);
        setErrorMessage(null);
        try {
            await supabase.auth.signOut();
            setUser(null);
            navigate("/auth", { replace: true });
        } catch {
            setIsSigningOut(false);
            setErrorMessage("Failed to sign out. Please try again.");
        }
    }

    if (!authResolved) {
        return (
            <main className="flex min-h-screen items-center justify-center">
                <p className="text-sm text-slate-600">Checking session...</p>
            </main>
        );
    }

    if (!user) {
        return <Navigate to="/auth" replace />;
    }

    const isNewChatMode = !selectedConversationId && chatMessages.length === 0 && !isStreamingAsk;
    const displayName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email?.split("@")[0] ||
        "there";
    const identityAvatarUrl =
        (user.identities?.[0]?.identity_data as { avatar_url?: string; picture?: string } | undefined)?.avatar_url ||
        (user.identities?.[0]?.identity_data as { avatar_url?: string; picture?: string } | undefined)?.picture;
    const avatarUrl =
        identityAvatarUrl ||
        (user.user_metadata?.avatar_url as string | undefined) ||
        (user.user_metadata?.picture as string | undefined);
    const proxiedAvatarUrl = avatarUrl ? `${BACKEND_URL}/avatar?url=${encodeURIComponent(avatarUrl)}` : undefined;
    const authProvider = ((user.app_metadata?.provider as string | undefined) || "").toLowerCase();
    const queryModeIsWeb = !selectedConversationId && queryLooksWebWorthy(askQuery);
    const remainingChars = MAX_QUERY_LENGTH - askQuery.length;
    const isLoadingSelectedConversation = Boolean(loadingConversationId);
    const isRequestLimitReached = (dailyUsage?.remaining ?? 1) <= 0;

    return (
        <TooltipProvider delayDuration={120}>
            <main className="h-screen overflow-hidden bg-[#0b0d12] text-slate-100">
                {isSigningOut && (
                    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-4">
                        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-[#12161f]/95 px-4 py-2 text-sm text-slate-100 shadow-lg">
                            <LoaderCircle className="h-4 w-4 animate-spin text-cyan-300" />
                            Signing out...
                        </div>
                    </div>
                )}
                <div className="flex h-full">
                    <aside
                        className={`overflow-hidden border-r border-white/10 bg-[#0f1218] transition-[width,opacity,transform] duration-300 ease-out ${isSidebarOpen ? "w-[280px] opacity-100 translate-x-0" : "w-0 opacity-0 -translate-x-2 border-r-0"
                            }`}
                    >
                        <div
                            className={`flex h-full w-[280px] flex-col transition-opacity duration-200 ${isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                                }`}
                        >
                            <div className="border-b border-white/10 p-4">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <p className="text-lg font-semibold tracking-tight text-white">Atreus</p>
                                        <p className="mt-1 text-xs text-slate-400">Turning your <b>'wtf is this'</b> into answers.</p>
                                    </div>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Close sidebar"
                                                className="h-9 w-9 rounded-lg border border-white/15 bg-[#1a1f2b]/90 text-slate-100 hover:bg-[#232a38] hover:text-white"
                                                onClick={() => setIsSidebarOpen(false)}
                                            >
                                                <PanelLeftClose className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Close sidebar</TooltipContent>
                                    </Tooltip>
                                </div>
                            </div>
                            <div className="p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-9 w-9 rounded-lg border border-white/15 bg-[#1a1f2b]/90 text-slate-100 hover:bg-[#232a38] hover:text-white"
                                                onClick={handleNewChat}
                                            >
                                                <MessageSquarePlus className="h-4 w-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>New chat</TooltipContent>
                                        </Tooltip>
                                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                            <span>{conversations.length} chat{conversations.length === 1 ? "" : "s"}</span>
                                            <span className="h-1 w-1 rounded-full bg-slate-600" />
                                            <span>
                                                {dailyUsage ? `${dailyUsage.remaining} left today` : "10/day"}
                                            </span>
                                        </div>
                                    </div>
                                {dailyUsage && (
                                    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                                        <div className="mb-2 flex items-center justify-between">
                                            <span>Request usage</span>
                                            <span>{dailyUsage.used}/{dailyUsage.limit}</span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                            <div
                                                className={`h-full rounded-full transition-all ${dailyUsage.limited ? "bg-red-400" : "bg-cyan-400"}`}
                                                style={{ width: `${Math.min(100, (dailyUsage.used / dailyUsage.limit) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="atreus-scrollbar flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                                {conversations.map((conversation) => (
                                    <div
                                        key={conversation.id}
                                        className={`group rounded-lg border ${selectedConversationId === conversation.id
                                                ? "border-cyan-400/40 bg-cyan-500/10"
                                                : "border-white/10 hover:bg-white/5"
                                            }`}
                                    >
                                        <div className="flex items-start gap-2 p-2">
                                            {editingConversationId === conversation.id ? (
                                                <input
                                                    autoFocus
                                                    value={editingConversationTitle}
                                                    onChange={(e) => setEditingConversationTitle(e.target.value)}
                                                    onBlur={() => void submitInlineRename(conversation.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            void submitInlineRename(conversation.id);
                                                        }
                                                        if (e.key === "Escape") {
                                                            setEditingConversationId(null);
                                                        }
                                                    }}
                                                    className="h-9 min-w-0 flex-1 rounded-md border border-cyan-400/40 bg-[#0e1420] px-2 text-sm text-cyan-100 outline-none"
                                                />
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className={`h-auto min-w-0 flex-1 justify-start rounded-md px-2 py-1 text-left transition ${selectedConversationId === conversation.id
                                                            ? "text-cyan-200 hover:bg-cyan-500/20 hover:text-cyan-100"
                                                            : "text-slate-300 hover:bg-white/5 hover:text-slate-100"
                                                        }`}
                                                    onClick={() => loadConversationById(conversation.id)}
                                                >
                                                    <div className="min-w-0 w-full">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <p className="truncate text-sm font-medium">
                                                                {conversation.title || "Untitled conversation"}
                                                            </p>
                                                            {loadingConversationId === conversation.id && (
                                                                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-200" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </Button>
                                            )}
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        type="button"
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white"
                                                    >
                                                        <Ellipsis className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent className="border-white/15 bg-[#12161f] text-slate-100">
                                                    <DropdownMenuItem
                                                        className="focus:bg-white/10 focus:text-white"
                                                        onClick={() => startInlineRename(conversation.id, conversation.title)}
                                                    >
                                                        Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-300 focus:bg-red-500/20 focus:text-red-200"
                                                        onClick={() => setPendingDeleteConversation(conversation)}
                                                    >
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                ))}
                                {conversations.length === 0 && (
                                    <p className="px-2 py-3 text-sm text-slate-500">Your research history starts here.</p>
                                )}
                            </div>
                            <div className="border-t border-white/10 p-4">
                                <p className="mb-2 line-clamp-1 text-xs text-slate-400">{user.email}</p>
                                <Button
                                    variant="outline"
                                    disabled={isSigningOut}
                                    className="w-full border-white/20 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-60"
                                    onClick={() => void handleSignOut()}
                                >
                                    {isSigningOut ? (
                                        <>
                                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                            Signing out
                                        </>
                                    ) : (
                                        "Sign out"
                                    )}
                                </Button>
                            </div>
                        </div>
                    </aside>

                    <section className="relative min-w-0 flex-1 transition-all duration-300 ease-out">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.15),transparent_35%)]" />
                        <div className="absolute right-4 top-4 z-30 md:right-6">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-10 rounded-full border border-white/15 bg-[#1a1f2b]/90 px-2 text-slate-100 hover:bg-[#232a38] hover:text-white"
                                    >
                                        {avatarUrl ? (
                                            <img
                                                src={proxiedAvatarUrl}
                                                alt={displayName}
                                                className="h-6 w-6 rounded-full object-cover"
                                                onError={(e) => {
                                                    const target = e.currentTarget;
                                                    if (target.dataset.fallbackTried === "1") return;
                                                    target.dataset.fallbackTried = "1";
                                                    target.src = avatarUrl;
                                                }}
                                            />
                                        ) : authProvider === "github" ? (
                                            <Github className="h-4 w-4" />
                                        ) : (
                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-xs font-semibold text-black">
                                                G
                                            </span>
                                        )}
                                        <span className="ml-2 max-w-[120px] truncate text-xs">{displayName}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="border-white/15 bg-[#12161f] text-slate-100">
                                    <div className="px-2 py-1 text-xs text-slate-400">{user.email}</div>
                                    <DropdownMenuItem
                                        className="focus:bg-white/10 focus:text-white"
                                        onClick={() => void handleSignOut()}
                                    >
                                        {isSigningOut ? "Signing out..." : "Sign out"}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        {!isSidebarOpen && (
                            <div className="absolute left-4 top-4 z-30 md:left-6">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label="Open sidebar"
                                            className="h-10 w-10 rounded-xl border border-white/15 bg-[#1a1f2b]/90 text-slate-100 shadow-[0_6px_20px_rgba(0,0,0,0.35)] hover:bg-[#232a38] hover:text-white"
                                            onClick={() => setIsSidebarOpen(true)}
                                        >
                                            <PanelLeftOpen className="h-5 w-5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open sidebar</TooltipContent>
                                </Tooltip>
                            </div>
                        )}
                        <div className="relative mx-auto flex h-full w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8">

                            {errorMessage && (
                                <Card className="border-red-500/40 bg-red-500/10">
                                    <CardContent className="pt-6">
                                        <p className="text-sm text-red-300">{errorMessage}</p>
                                    </CardContent>
                                </Card>
                            )}

                            <div className="relative flex-1 min-h-0">
                                <div
                                    className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-out ${isNewChatMode ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-6 opacity-0"
                                        }`}
                                >
                                    <h1 className="mb-3 text-5xl font-semibold tracking-tight text-white md:text-6xl">Atreus</h1>
                                    <p className="mb-6 text-sm text-slate-400">Welcome {displayName}!</p>
                                    <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs">
                                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            Chat first
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                                            <Search className="h-3.5 w-3.5" />
                                            Tavily only when needed
                                        </span>
                                    </div>
                                    <div className="mb-4 flex w-full max-w-3xl flex-wrap gap-2 justify-center">
                                        {DEFAULT_STARTER_QUESTIONS.map((question) => (
                                            <Button
                                                key={question}
                                                type="button"
                                                variant="outline"
                                                className="border-white/20 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white"
                                                onClick={() => void handleSend(question)}
                                            >
                                                {question}
                                            </Button>
                                        ))}
                                    </div>
                                    <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#12161f]/95 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur">
                                        <Textarea
                                            value={askQuery}
                                            maxLength={MAX_QUERY_LENGTH}
                                            onChange={(e) => setAskQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    void handleSend();
                                                }
                                            }}
                                            placeholder={isRequestLimitReached ? "Daily request limit reached." : "Ask Atreus anything..."}
                                            disabled={isRequestLimitReached}
                                            className="min-h-24 border-white/10 bg-transparent text-slate-100 placeholder:text-slate-500"
                                        />
                                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                                <span className="inline-flex items-center gap-1">
                                                    {queryModeIsWeb ? <Search className="h-3.5 w-3.5 text-emerald-300" /> : <Sparkles className="h-3.5 w-3.5 text-cyan-300" />}
                                                    {queryModeIsWeb ? "Web search likely" : "Chat mode"}
                                                </span>
                                                <span className="hidden sm:inline">Shift + Enter for a new line</span>
                                                {dailyUsage && <span>{dailyUsage.remaining} left</span>}
                                                <span className={remainingChars < 120 ? "text-amber-300" : ""}>{remainingChars}</span>
                                            </div>
                                            <div className="flex items-center justify-end gap-2">
                                                {askQuery && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-9 w-9 border border-white/15 bg-[#1a1f2b]/80 text-slate-200 hover:bg-white/10 hover:text-white"
                                                                onClick={() => setAskQuery("")}
                                                            >
                                                                <Eraser className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Clear prompt</TooltipContent>
                                                    </Tooltip>
                                                )}
                                                <Button
                                                    onClick={() => handleSend()}
                                                    disabled={isStreamingAsk || !askQuery.trim() || isRequestLimitReached}
                                                    className="gap-2 bg-cyan-500 text-black hover:bg-cyan-400"
                                                >
                                                    {isStreamingAsk ? "Streaming..." : "Send"}
                                                    {!isStreamingAsk && <SendHorizontal className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className={`flex h-full min-h-0 flex-col gap-4 transition-all duration-500 ease-out ${isNewChatMode ? "pointer-events-none translate-y-8 opacity-0" : "translate-y-0 opacity-100"
                                        }`}
                                >
                                    <div className="flex min-h-0 flex-1 gap-3">
                                        <section ref={chatScrollRef} className="atreus-scrollbar min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-[#12161f]/80 p-4 md:p-6">
                                            <div className="mb-4">
                                                <p className="text-sm text-slate-400">
                                                    {isLoadingSelectedConversation ? "Loading conversation..." : selectedConversation ? selectedConversation.title || "Conversation" : "Start a new conversation"}
                                                </p>
                                            </div>
                                            <div className="space-y-3">
                                                {isLoadingSelectedConversation ? (
                                                    <ConversationSkeleton />
                                                ) : chatMessages.length === 0 && (
                                                    <p className="text-sm text-slate-500">No messages loaded.</p>
                                                )}
                                                {!isLoadingSelectedConversation && chatMessages.map((message) => (
                                                    <div key={message.id} className={`flex ${message.role === "User" ? "justify-end" : "justify-start"}`}>
                                                        <div className="max-w-[85%]">
                                                            <div
                                                                className={`text-sm ${message.role === "User"
                                                                    ? "rounded-2xl bg-cyan-500 px-4 py-3 text-black"
                                                                    : "px-1 py-1 text-slate-100"
                                                                    }`}
                                                            >
                                                                {message.content ? (
                                                                    message.role === "Assistant" ? (
                                                                        renderAssistantContent(message.content)
                                                                    ) : (
                                                                        <p className="whitespace-pre-wrap">{message.content}</p>
                                                                    )
                                                                ) : message.isStreaming ? (
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300" />
                                                                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 [animation-delay:120ms]" />
                                                                        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-300 [animation-delay:240ms]" />
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                            {message.role === "Assistant" && message.content && (
                                                                <div className="mt-2 flex items-center gap-2">
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Button
                                                                                type="button"
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-8 border border-white/15 bg-[#12161f] px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                                                                                onClick={() => handleCopyResponse(message.id, message.content)}
                                                                            >
                                                                                {copiedMessageId === message.id ? (
                                                                                    <>
                                                                                        <Check className="mr-1 h-4 w-4 text-emerald-300" />
                                                                                        Copied
                                                                                    </>
                                                                                ) : (
                                                                                    <>
                                                                                        <Copy className="mr-1 h-4 w-4" />
                                                                                        Copy
                                                                                    </>
                                                                                )}
                                                                            </Button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>Copy answer</TooltipContent>
                                                                    </Tooltip>
                                                                    {(conversationMessageSources[message.id]?.length ?? 0) > 0 && (
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <Button
                                                                                    type="button"
                                                                                    size="sm"
                                                                                    variant="ghost"
                                                                                    className="h-8 border border-white/15 bg-[#12161f] px-2 text-slate-200 hover:bg-white/10 hover:text-white"
                                                                                    onClick={() => {
                                                                                        setLatestSources(conversationMessageSources[message.id] ?? []);
                                                                                        setIsSourcesPanelOpen(true);
                                                                                    }}
                                                                                >
                                                                                    <ExternalLink className="mr-1 h-4 w-4" />
                                                                                    Sources
                                                                                </Button>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent>Open sources for this answer</TooltipContent>
                                                                        </Tooltip>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                {isStreamingAsk && (
                                                    <div className="max-w-[60%] animate-pulse rounded-2xl border border-white/10 bg-black/20 p-4" />
                                                )}
                                            </div>
                                        </section>

                                        <aside
                                            className={`atreus-scrollbar overflow-y-auto rounded-2xl border border-white/10 bg-[#12161f]/95 transition-all duration-300 ${isSourcesPanelOpen && latestSources.length > 0 ? "w-[320px] opacity-100" : "w-0 border-transparent opacity-0"
                                                }`}
                                        >
                                            <div className={`${isSourcesPanelOpen && latestSources.length > 0 ? "block" : "hidden"} p-4`}>
                                                <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
                                                    <p className="text-sm font-semibold text-slate-100">Sources</p>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 text-slate-300 hover:bg-white/10 hover:text-white"
                                                                onClick={() => setIsSourcesPanelOpen(false)}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Close sources</TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <div className="space-y-2">
                                                    {latestSources.map((url) => (
                                                        <a
                                                            key={url}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="block rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-200 hover:border-cyan-400/40 hover:bg-white/5 hover:text-white"
                                                        >
                                                            <div className="flex items-start justify-between gap-2">
                                                                <span className="line-clamp-3 break-all">{url}</span>
                                                                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                                                            </div>
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        </aside>
                                    </div>

                                    <div className="z-20 mt-2 shrink-0 rounded-2xl border border-white/10 bg-[#12161f]/95 p-3 backdrop-blur">
                                        <Textarea
                                            value={askQuery}
                                            maxLength={MAX_QUERY_LENGTH}
                                            onChange={(e) => setAskQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && !e.shiftKey) {
                                                    e.preventDefault();
                                                    void handleSend();
                                                }
                                            }}
                                            placeholder={isRequestLimitReached ? "Daily request limit reached." : selectedConversationId ? "Ask a follow-up..." : "Ask Atreus anything..."}
                                            disabled={isRequestLimitReached}
                                            className="min-h-20 border-white/10 bg-transparent text-slate-100 placeholder:text-slate-500"
                                        />
                                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                                <span className="inline-flex items-center gap-1">
                                                    {queryModeIsWeb ? <Search className="h-3.5 w-3.5 text-emerald-300" /> : <Sparkles className="h-3.5 w-3.5 text-cyan-300" />}
                                                    {selectedConversationId ? "Follow-up" : "New chat"}
                                                </span>
                                                <span>{queryModeIsWeb ? "web search likely" : "chat first"}</span>
                                                {dailyUsage && <span>{dailyUsage.remaining} left</span>}
                                                <span className={remainingChars < 120 ? "text-amber-300" : ""}>{remainingChars}</span>
                                            </div>
                                            <div className="flex items-center justify-end gap-2">
                                                {askQuery && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-9 w-9 border border-white/15 bg-[#1a1f2b]/80 text-slate-200 hover:bg-white/10 hover:text-white"
                                                                onClick={() => setAskQuery("")}
                                                            >
                                                                <Eraser className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Clear prompt</TooltipContent>
                                                    </Tooltip>
                                                )}
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="ghost"
                                                            disabled={latestSources.length === 0}
                                                            className="h-9 w-9 border border-white/15 bg-[#1a1f2b]/80 text-slate-200 hover:bg-white/10 hover:text-white disabled:opacity-40"
                                                            onClick={() => setIsSourcesPanelOpen((prev) => !prev)}
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Toggle sources panel</TooltipContent>
                                                </Tooltip>
                                                <Button
                                                    onClick={() => handleSend()}
                                                    disabled={isStreamingAsk || !askQuery.trim() || isRequestLimitReached}
                                                    className="gap-2 bg-cyan-500 text-black hover:bg-cyan-400 hover:text-black"
                                                >
                                                    {isStreamingAsk ? "Streaming..." : "Send"}
                                                    {!isStreamingAsk && <SendHorizontal className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="pb-1 text-center text-xs text-slate-500">
                                        Built for practice and experimentation by{" "}
                                        <a
                                            href={BUILDER_LINKEDIN_URL}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-slate-300 underline underline-offset-2 hover:text-white"
                                        >
                                            Pawan Shekhawat
                                        </a>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
                <style>{`
        .atreus-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .atreus-scrollbar::-webkit-scrollbar {
          width: 0px;
          height: 0px;
        }
      `}</style>
                <Dialog open={Boolean(pendingDeleteConversation)} onOpenChange={(open) => { if (!open) setPendingDeleteConversation(null); }}>
                    <DialogContent className="border-white/15 bg-[#12161f] text-slate-100">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15 text-red-300">
                                    <Trash2 className="h-4 w-4" />
                                </span>
                                Delete conversation?
                            </DialogTitle>
                            <DialogDescription className="text-slate-400">
                                This conversation will be permanently deleted. This action cannot be undone.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                className="border-white/20 bg-transparent text-slate-200 hover:bg-white/10 hover:text-white"
                                onClick={() => setPendingDeleteConversation(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                className="bg-red-500 text-white hover:bg-red-400"
                                onClick={() => {
                                    if (!pendingDeleteConversation) return;
                                    void handleDeleteConversation(pendingDeleteConversation.id);
                                    setPendingDeleteConversation(null);
                                }}
                            >
                                Delete
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog
                    open={showWelcomeModal}
                    onOpenChange={(open) => {
                        setShowWelcomeModal(open);
                        if (!open && user?.id) {
                            localStorage.setItem(`atreus:welcome-seen:${user.id}`, "1");
                        }
                    }}
                >
                    <DialogContent className="border-white/15 bg-[#12161f] text-slate-100">
                        <DialogHeader>
                            <DialogTitle>Welcome {displayName}!</DialogTitle>
                            <DialogDescription className="space-y-2 text-slate-300">
                                <p>This is a learning project built for practice and experimentation.</p>
                                <p>Your account has a rate limit of <strong>{dailyUsage?.limit ?? 10} requests per day</strong>.</p>
                                <p>Current model experience is <strong>text-based only</strong>.</p>
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                className="bg-cyan-500 text-black hover:bg-cyan-400"
                                onClick={() => {
                                    setShowWelcomeModal(false);
                                    if (user?.id) {
                                        localStorage.setItem(`atreus:welcome-seen:${user.id}`, "1");
                                    }
                                }}
                            >
                                Got it
                            </Button>
                        </DialogFooter>
                        <p className="text-center text-[11px] text-slate-500">Built by Pawan Shekhawat</p>
                    </DialogContent>
                </Dialog>

                {toastMessage && (
                    <div
                        className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-lg ${toastTone === "destructive" ? "bg-red-600" : "bg-[#33401f]"
                            }`}
                    >
                        {toastMessage}
                    </div>
                )}
            </main>
        </TooltipProvider>
    );
};
