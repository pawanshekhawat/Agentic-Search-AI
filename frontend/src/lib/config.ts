declare const __BACKEND_URL__: string | undefined;
declare const __BUILDER_LINKEDIN_URL__: string | undefined;

const buildBackendUrl = typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__ : "";
const buildBuilderLinkedinUrl =
  typeof __BUILDER_LINKEDIN_URL__ === "string" ? __BUILDER_LINKEDIN_URL__ : "";
const frontendEnv =
  typeof process !== "undefined" && process.env
    ? (process.env as Record<string, string | undefined>)
    : {};

const isLocalBrowser =
  globalThis.location?.hostname === "localhost" ||
  globalThis.location?.hostname === "127.0.0.1";

export const BACKEND_URL =
  frontendEnv.VITE_BACKEND_URL ||
  "https://backend-7y28.onrender.com" ||
  buildBackendUrl ||
  (isLocalBrowser ? "http://localhost:4000" : "https://backend-7y28.onrender.com");

export const BUILDER_LINKEDIN_URL =
  frontendEnv.VITE_BUILDER_LINKEDIN_URL ||
  buildBuilderLinkedinUrl ||
  "https://www.linkedin.com/in/pawan2402/";
