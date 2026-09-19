import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { deals, notifications, scenarioCatalog } from "../mock/data.js";
import { bffCache, invalidate } from "../services/cache.js";
import { broadcast } from "../ws/hub.js";
import type { Deal, DealStage, DocumentStatus } from "../types.js";

export const dealsRouter = Router();

// ---- Screen 1: Dashboard -------------------------------------------------
// Aggregates each deal down to what the dashboard actually needs: stage,
// a coarse progress percentage, and whether it needs attention.

const stageProgress: Record<DealStage, number> = {
  created: 10,
  documents: 30,
  compliance_check: 55,
  settlement: 80,
  completed: 100,
  blocked: 40,
};

function toDashboardCard(deal: Deal) {
  return {
    id: deal.id,
    displayId: deal.displayId,
    counterpartyName: deal.counterpartyName,
    counterpartyCountry: deal.counterpartyCountry,
    operationType: deal.operationType,
    amount: deal.amount,
    currency: deal.currency,
    stage: deal.stage,
    progressPercent: stageProgress[deal.stage],
    needsAttention: deal.hasBlockers,
    attentionReason: deal.blockerReason ?? null,
    updatedAt: deal.updatedAt,
  };
}

dealsRouter.get("/dashboard", (_req, res) => {
  const cacheKey = "dashboard:summary";
  const cached = bffCache.get(cacheKey);
  if (cached) return res.json(cached);

  const payload = {
    deals: deals.map(toDashboardCard),
    unreadNotifications: notifications.filter((n) => !n.read).length,
  };
  bffCache.set(cacheKey, payload);
  res.json(payload);
});

dealsRouter.get("/notifications", (_req, res) => {
  res.json({ notifications });
});

dealsRouter.post("/notifications/:id/read", (req, res) => {
  const item = notifications.find((n) => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Уведомление не найдено" });
  item.read = true;
  res.json({ notification: item });
});

// ---- Screen 2: Create deal wizard ----------------------------------------

const createDealSchema = z.object({
  counterpartyCountry: z.string().min(1, "Выберите страну контрагента"),
  counterpartyName: z.string().min(1, "Укажите название контрагента"),
  operationType: z.enum(["import", "export"]),
  amount: z.number().positive("Сумма должна быть больше нуля"),
  currency: z.string().min(1, "Выберите валюту"),
});

dealsRouter.post("/deals", (req, res) => {
  const parsed = createDealSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Проверьте заполненные поля", details: parsed.error.flatten() });
  }

  const nextNumber = 143 + deals.length;
  const now = new Date().toISOString();
  const deal: Deal = {
    id: randomUUID(),
    displayId: `DEAL-2026-0${nextNumber}`,
    ...parsed.data,
    scenario: null,
    stage: "created",
    createdAt: now,
    updatedAt: now,
    hasBlockers: false,
    documents: [
      { id: randomUUID(), name: "Контракт", purpose: "Основание для валютного контроля", status: "missing", updatedAt: now },
      { id: randomUUID(), name: "Инвойс", purpose: "Подтверждает сумму и товар поставки", status: "missing", updatedAt: now },
    ],
    timeline: [
      { id: randomUUID(), label: "Сделка создана", actor: "Вы", timestamp: now, status: "done" },
      { id: randomUUID(), label: "Выбор сценария расчёта", actor: "Вы", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Документы", actor: "Вы", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Комплаенс-проверка", actor: "Банк", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Завершение сделки", actor: "Система", timestamp: "", status: "pending" },
    ],
  };

  deals.unshift(deal);
  invalidate("dashboard:");
  broadcast({ type: "deal.updated", dealId: deal.id });
  res.status(201).json({ deal });
});

dealsRouter.get("/deals/:id", (req, res) => {
  const deal = deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: "Сделка не найдена" });
  res.json({ deal });
});

// ---- Screen 3: Scenario selection -----------------------------------------

dealsRouter.get("/scenarios", (_req, res) => {
  res.json({ scenarios: scenarioCatalog });
});

const scenarioSchema = z.object({
  scenario: z.enum(["cbdc", "bank_transfer", "smart_contract", "trade_finance"]),
});

dealsRouter.post("/deals/:id/scenario", (req, res) => {
  const deal = deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: "Сделка не найдена" });

  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Выберите сценарий расчёта" });

  deal.scenario = parsed.data.scenario;
  deal.stage = "documents";
  deal.updatedAt = new Date().toISOString();
  const step = deal.timeline.find((t) => t.label === "Выбор сценария расчёта");
  if (step) {
    step.status = "done";
    step.timestamp = deal.updatedAt;
  }

  invalidate("dashboard:");
  broadcast({ type: "deal.updated", dealId: deal.id });
  res.json({ deal });
});

// ---- Screen 4: Documents ----------------------------------------------

const documentStatusSchema = z.object({
  status: z.enum(["missing", "uploaded", "under_review", "approved", "rejected"] as [DocumentStatus, ...DocumentStatus[]]),
});

dealsRouter.patch("/deals/:dealId/documents/:documentId", (req, res) => {
  const deal = deals.find((d) => d.id === req.params.dealId);
  if (!deal) return res.status(404).json({ error: "Сделка не найдена" });

  const doc = deal.documents.find((d) => d.id === req.params.documentId);
  if (!doc) return res.status(404).json({ error: "Документ не найден" });

  const parsed = documentStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Некорректный статус документа" });

  doc.status = parsed.data.status;
  doc.updatedAt = new Date().toISOString();
  deal.updatedAt = doc.updatedAt;

  invalidate("dashboard:");
  broadcast({ type: "deal.updated", dealId: deal.id });
  res.json({ document: doc });
});

// ---- Screen 5: Tracking ----------------------------------------------------
// The timeline is already embedded on the deal, so tracking reuses GET /deals/:id.
// This endpoint exists separately to keep the tracking screen's contract
// independent from the rest of the deal payload as the product evolves.

dealsRouter.get("/deals/:id/tracking", (req, res) => {
  const deal = deals.find((d) => d.id === req.params.id);
  if (!deal) return res.status(404).json({ error: "Сделка не найдена" });
  res.json({
    displayId: deal.displayId,
    stage: deal.stage,
    hasBlockers: deal.hasBlockers,
    blockerReason: deal.blockerReason ?? null,
    timeline: deal.timeline,
  });
});
