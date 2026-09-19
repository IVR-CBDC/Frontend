import type { Config } from "../config.js";
import { callUpstream } from "./http.js";

export interface QuoteRequest {
  from_country: string;
  to_country: string;
  currency: string;
  amount: number;
}

export interface CommissionBreakdown {
  base_fee: number;
  percentage_fee: number;
  percentage_amount: number;
  fixed_fee: number;
  subtotal: number;
  clamped: boolean;
  multiplier: number;
  total: number;
}

export interface CommissionQuote {
  scenario: string;
  title: string;
  description: string;
  eta_label: string;
  limitations: string[];
  available: boolean;
  unavailable_reason: string | null;
  commission: CommissionBreakdown | null;
}

export interface QuotesResponse {
  corridor_id: string | null;
  quotes: CommissionQuote[];
}

// Токен сессии прокидывается в Authorization так же, как в upstream/core.ts —
// для единообразия обёрток, даже если сегодня service-commission его не
// проверяет: котировки не персональные данные компании, а параметры,
// заданные явно в теле запроса.
export function getQuotes(config: Config, token: string, input: QuoteRequest): Promise<QuotesResponse> {
  return callUpstream(
    `${config.commissionUrl}/api/commission/quotes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    config.upstreamTimeoutMs,
  );
}
