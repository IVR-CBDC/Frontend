import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";

describe("BFF", () => {
  it("отвечает на /health без сети (только живость процесса, F10 final review)", async () => {
    const response = await request(createApp(testConfig())).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
