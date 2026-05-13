const env = (import.meta as { env?: Record<string, string | undefined> }).env;

export const BACKEND_URL =
  env?.VITE_BACKEND_URL || "https://atreus-production.up.railway.app";
export const BUILDER_LINKEDIN_URL =
  env?.VITE_BUILDER_LINKEDIN_URL || "https://www.linkedin.com/in/pawan2402/";
