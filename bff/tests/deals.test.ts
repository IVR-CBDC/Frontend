import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";
import { quotesCache } from "../src/services/cache.js";

// Upstream (fetch) подменяется целиком — проверяем поведение самого BFF
// (агрегация, маппинг, кеш, обработку ошибок), а не поведение
// service-core/service-commission.
const SESSION_COOKIE = "session=test-token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function coreDealSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    display_id: "DEAL-2026-0001",
    counterparty_name: "ООО Ромашка",
    counterparty_country: "CN",
    operation_type: "import",
    amount: 1000,
    currency: "USD",
    scenario: null,
    stage: "created",
    progress_percent: 10,
    needs_attention: false,
    attention_reason: null,
    commission_total: null,
    version: 1,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function coreDeal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...coreDealSummary(),
    created_at: "2026-01-01T00:00:00Z",
    documents: [],
    timeline: [
      {
        seq: 1,
        step: "Сделка создана",
        actor: "Вы",
        status: "done",
        delay_reason: "",
        started_at: "2026-01-01T00:00:00Z",
        finished_at: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function quotesResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    corridor_id: "RU-CN",
    quotes: [
      {
        scenario: "cbdc",
        title: "CBDC",
        description: "Расчёт цифровым рублём",
        eta_label: "Мгновенно",
        limitations: [],
        available: true,
        unavailable_reason: null,
        commission: {
          base_fee: 10,
          percentage_fee: 0.5,
          percentage_amount: 5,
          fixed_fee: 1,
          subtotal: 16,
          clamped: false,
          multiplier: 1,
          total: 16,
        },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  quotesCache.flushAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/dashboard", () => {
  it("собирает сделки и счётчик непрочитанных уведомлений одним ответом", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals")) {
        return jsonResponse(200, { items: [coreDealSummary()], count: 1 });
      }
      if (url.includes("/api/core/notifications")) {
        return jsonResponse(200, { items: [], unread: 3 });
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/dashboard").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(response.body.unreadNotifications).toBe(3);
    expect(response.body.deals).toHaveLength(1);
    expect(response.body.deals[0]).toMatchObject({
      id: "d1",
      displayId: "DEAL-2026-0001",
      progressPercent: 10,
      needsAttention: false,
    });
  });

  it("не падает целиком, если уведомления недоступны — unreadNotifications: 0", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals")) {
        return jsonResponse(200, { items: [coreDealSummary()], count: 1 });
      }
      if (url.includes("/api/core/notifications")) {
        return jsonResponse(500, { code: "INTERNAL_ERROR", error: "упс" });
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await request(app).get("/api/dashboard").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(response.body.unreadNotifications).toBe(0);
    expect(response.body.deals).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("GET /api/deals/:id/scenarios", () => {
  it("зовёт commission с параметрами сделки (import -> from=RU), а не запроса клиента", async () => {
    let quotesCall: { url: string; body: unknown } | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/core/deals/d1")) {
        return jsonResponse(200, {
          deal: coreDeal({ operation_type: "import", counterparty_country: "CN", currency: "USD", amount: 1000 }),
        });
      }
      if (url.includes("/api/commission/quotes")) {
        quotesCall = { url, body: JSON.parse(init?.body as string) };
        return jsonResponse(200, quotesResponse());
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    // Клиент шлёт свои (издевательские) параметры коридора в query — BFF их
    // должен игнорировать и построить коридор из самой сделки.
    const response = await request(app)
      .get("/api/deals/d1/scenarios?from_country=US&to_country=DE")
      .set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(quotesCall?.body).toMatchObject({
      from_country: "RU",
      to_country: "CN",
      currency: "USD",
      amount: 1000,
    });
    expect(response.body.corridorId).toBe("RU-CN");
    expect(response.body.scenarios[0]).toMatchObject({ id: "cbdc", available: true });
  });

  // F11 (final review): ветка export (to=RU) была не покрыта тестом —
  // corridorParams() решает, в какую сторону считаются реальные деньги
  // (import: RU -> контрагент, export: контрагент -> RU), ошибка здесь
  // молча запросила бы котировки для обратного направления.
  it("зовёт commission с параметрами сделки (export -> to=RU)", async () => {
    let quotesCall: { body: unknown } | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/core/deals/d1")) {
        return jsonResponse(200, {
          deal: coreDeal({ operation_type: "export", counterparty_country: "CN", currency: "USD", amount: 1000 }),
        });
      }
      if (url.includes("/api/commission/quotes")) {
        quotesCall = { body: JSON.parse(init?.body as string) };
        return jsonResponse(200, quotesResponse());
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/deals/d1/scenarios").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(quotesCall?.body).toMatchObject({ from_country: "CN", to_country: "RU" });
  });

  it("повторный вызов в пределах TTL не ходит в commission второй раз, а после смены version — ходит", async () => {
    let dealVersion = 1;
    let quotesCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals/d1")) {
        return jsonResponse(200, { deal: coreDeal({ version: dealVersion }) });
      }
      if (url.includes("/api/commission/quotes")) {
        quotesCalls += 1;
        return jsonResponse(200, quotesResponse());
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    await request(app).get("/api/deals/d1/scenarios").set("Cookie", SESSION_COOKIE);
    await request(app).get("/api/deals/d1/scenarios").set("Cookie", SESSION_COOKIE);
    expect(quotesCalls).toBe(1);

    dealVersion = 2;
    await request(app).get("/api/deals/d1/scenarios").set("Cookie", SESSION_COOKIE);
    expect(quotesCalls).toBe(2);
  });

  it("503 от commission роняет весь ответ, даже если сделка уже загружена", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals/d1")) {
        return jsonResponse(200, { deal: coreDeal() });
      }
      if (url.includes("/api/commission/quotes")) {
        return jsonResponse(500, { code: "INTERNAL_ERROR", error: "упс" });
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/deals/d1/scenarios").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("POST /api/deals/:id/scenario", () => {
  it("409 VERSION_CONFLICT от core доходит до клиента с тем же статусом и кодом", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals/d1/scenario")) {
        return jsonResponse(409, { code: "VERSION_CONFLICT", error: "Сделка изменилась, обновите страницу" });
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/deals/d1/scenario")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173")
      .send({ scenario: "cbdc", version: 1 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("VERSION_CONFLICT");
  });
});

describe("GET /api/deals/:id/tracking", () => {
  it("отдаёт таймлайн и причину блокировки из сделки без лишнего запроса", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/core/deals/d1")) {
        return jsonResponse(200, {
          deal: coreDeal({ needs_attention: true, attention_reason: "Не хватает документа" }),
        });
      }
      throw new Error(`неожиданный fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/deals/d1/tracking").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      displayId: "DEAL-2026-0001",
      hasBlockers: true,
      blockerReason: "Не хватает документа",
    });
    expect(response.body.timeline).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("валидация входа (F11, F12, final review)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // F11: раньше Number("abc") === NaN уходил в core буквально как
  // "?limit=NaN" — теперь это 400 до всякого похода к core.
  it("нечисловой limit в GET /api/deals отвечает 400 VALIDATION_ERROR, не долетая до core", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/deals?limit=abc").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("нечисловой limit в GET /api/notifications тоже отвечает 400, не долетая до core", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/notifications?limit=abc").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("корректный числовой limit по-прежнему доходит до core", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("limit=5");
      return jsonResponse(200, { items: [], count: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/deals?limit=5").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // F12: req.body as ... заменено на валидацию через zod — три места.
  it("POST /api/deals с некорректным телом (без обязательных полей) отвечает 400, не долетая до core", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/deals")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173")
      .send({ counterpartyCountry: "CN" }); // остальные обязательные поля отсутствуют

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST /api/deals/:id/scenario с нечисловым version отвечает 400, не долетая до core", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/deals/d1/scenario")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173")
      .send({ scenario: "cbdc", version: "not-a-number" });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST .../documents/:id/submit без version отвечает 400, не долетая до core", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/deals/d1/documents/doc1/submit")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173")
      .send({});

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
