const frontendEnv =
  typeof process !== "undefined" && process.env
    ? (process.env as Record<string, string | undefined>)
    : {};

const isLocalBrowser =
  globalThis.location?.hostname === "localhost" ||
  globalThis.location?.hostname === "127.0.0.1";

export const BACKEND_URL =
  frontendEnv.VITE_BACKEND_URL ||
  frontendEnv.BUN_PUBLIC_BACKEND_URL ||
  (isLocalBrowser ? "http://localhost:4000" : "https://atreus-production.up.railway.app");
export const BUILDER_LINKEDIN_URL =
  frontendEnv.VITE_BUILDER_LINKEDIN_URL || "https://www.linkedin.com/in/pawan2402/";
