import type { Config } from "../config.js";
import { callUpstream } from "./http.js";

export interface RegisterInput {
  login: string;
  password: string;
  name: string;
  company_name: string;
  inn: string;
}

export interface LoginInput {
  login: string;
  password: string;
}

export interface AuthTokenResponse {
  user_id: string;
  company_id: string;
  token: string;
}

export interface MeResponse {
  user_id: string;
  login: string;
  name: string;
  company: { id: string; name: string; inn: string };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function register(config: Config, input: RegisterInput): Promise<AuthTokenResponse> {
  return callUpstream<AuthTokenResponse>(
    `${config.authUrl}/api/auth/register`,
    jsonInit("POST", input),
    config.upstreamTimeoutMs,
  );
}

export function login(config: Config, input: LoginInput): Promise<AuthTokenResponse> {
  return callUpstream<AuthTokenResponse>(
    `${config.authUrl}/api/auth/login`,
    jsonInit("POST", input),
    config.upstreamTimeoutMs,
  );
}

export function me(config: Config, token: string): Promise<MeResponse> {
  return callUpstream<MeResponse>(
    `${config.authUrl}/api/auth/me`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    config.upstreamTimeoutMs,
  );
}
