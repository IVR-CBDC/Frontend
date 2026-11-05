import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";

const SESSION_COOKIE = "session=test-token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/notifications", () => {
  it("список проксируется вместе со счётчиком unread", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            id: "n1",
            deal_id: "d1",
            severity: "warning",
            message: "Проверьте документы",
            read: false,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        unread: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app).get("/api/notifications").set("Cookie", SESSION_COOKIE);

    expect(response.status).toBe(200);
    expect(response.body.unread).toBe(1);
    expect(response.body.notifications).toEqual([
      {
        id: "n1",
        dealId: "d1",
        severity: "warning",
        message: "Проверьте документы",
        createdAt: "2026-01-01T00:00:00Z",
        read: false,
      },
    ]);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("отмечает уведомление прочитанным и отвечает 204", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/core/notifications/n1/read");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/notifications/n1/read")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(204);
  });

  it("404 от core доходит как 404", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, { code: "NOT_FOUND", error: "Уведомление не найдено" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp(testConfig());

    const response = await request(app)
      .post("/api/notifications/missing/read")
      .set("Cookie", SESSION_COOKIE)
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });
});
