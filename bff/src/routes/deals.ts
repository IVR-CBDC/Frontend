import { Router, type Request } from "express";
import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeJwt } from "jose";
import { ApiError } from "../errors.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { readToken, requireSession } from "../session.js";
import * as coreUpstream from "../upstream/core.js";
import * as commissionUpstream from "../upstream/commission.js";
import type { CoreDeal, CoreDealSummary, CoreDocument, CoreTimelineStep } from "../upstream/core.js";
import type { CommissionQuote } from "../upstream/commission.js";
import { quotesCache } from "../services/cache.js";
import { parseLimit, validateBody } from "../validation.js";
import type {
  CreateDealInput,
  Deal,
  DealStage,
  DocumentStatus,
  DashboardCard,
  RequiredDocument,
  ScenarioCard,
  SettlementScenario,
  TimelineEvent,
} from "../types.js";





const createDealBodySchema = z.object({
  counterpartyCountry: z.string().min(1),
  counterpartyName: z.string().min(1),
  operationType: z.enum(["import", "export"]),
  amount: z.number().positive(),
  currency: z.string().min(1),
}) satisfies z.ZodType<CreateDealInput>;

const chooseScenarioBodySchema = z.object({
  scenario: z.string().min(1),
  version: z.number().int(),
});

const submitDocumentBodySchema = z.object({
  version: z.number().int(),
});

function getConfig(req: Request): Config {
  return req.app.get("config") as Config;
}



function toDashboardCard(deal: CoreDealSummary): DashboardCard {
  return {
    id: deal.id,
    displayId: deal.display_id,
    counterpartyName: deal.counterparty_name,
    counterpartyCountry: deal.counterparty_country,
    operationType: deal.operation_type,
    amount: deal.amount,
    currency: deal.currency,
    stage: deal.stage as DealStage,
    progressPercent: deal.progress_percent,
    needsAttention: deal.needs_attention,
    attentionReason: deal.attention_reason,
    updatedAt: deal.updated_at,
  };
}

function toRequiredDocument(doc: CoreDocument): RequiredDocument {
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.title,
    purpose: doc.purpose,
    status: doc.status as DocumentStatus,
    rejectReason: doc.reject_reason || undefined,
  };
}

function toTimelineEvent(step: CoreTimelineStep): TimelineEvent {
  return {
    seq: step.seq,
    label: step.step,
    actor: step.actor,
    status: step.status as TimelineEvent["status"],
    delayReason: step.delay_reason || undefined,
    startedAt: step.started_at || null,
    finishedAt: step.finished_at || null,
  };
}

function toDeal(deal: CoreDeal): Deal {
  return {
    id: deal.id,
    displayId: deal.display_id,
    counterpartyCountry: deal.counterparty_country,
    counterpartyName: deal.counterparty_name,
    operationType: deal.operation_type,
    amount: deal.amount,
    currency: deal.currency,
    scenario: deal.scenario as SettlementScenario | null,
    stage: deal.stage as DealStage,
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
    hasBlockers: deal.needs_attention,
    blockerReason: deal.attention_reason ?? undefined,
    version: deal.version,
    commissionTotal: deal.commission_total,
    documents: deal.documents.map(toRequiredDocument),
    timeline: deal.timeline.map(toTimelineEvent),
  };
}

function toScenarioCard(quote: CommissionQuote): ScenarioCard {
  return {
    id: quote.scenario as SettlementScenario,
    title: quote.title,
    description: quote.description,
    etaLabel: quote.eta_label,
    limitations: quote.limitations,
    available: quote.available,
    unavailableReason: quote.unavailable_reason,
    commission: quote.commission
      ? {
          baseFee: quote.commission.base_fee,
          percentageFee: quote.commission.percentage_fee,
          percentageAmount: quote.commission.percentage_amount,
          fixedFee: quote.commission.fixed_fee,
          subtotal: quote.commission.subtotal,
          clamped: quote.commission.clamped,
          multiplier: quote.commission.multiplier,
          total: quote.commission.total,
        }
      : null,
  };
}






function corridorParams(deal: CoreDeal): { from_country: string; to_country: string } {
  return deal.operation_type === "import"
    ? { from_country: "RU", to_country: deal.counterparty_country }
    : { from_country: deal.counterparty_country, to_country: "RU" };
}

export const dealsRouter = Router();











dealsRouter.get("/dashboard", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const { items } = await coreUpstream.listDeals(config, token);

    let unreadNotifications = 0;
    try {
      const notifications = await coreUpstream.listNotifications(config, token);
      unreadNotifications = notifications.unread;
    } catch (err) {
      
      
      
      
      
      console.warn("dashboard: не удалось получить счётчик непрочитанных уведомлений", err);
    }

    res.json({ deals: items.map(toDashboardCard), unreadNotifications });
  } catch (err) {
    next(err);
  }
});



dealsRouter.get("/deals", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const limit = parseLimit(req.query.limit);
    const { items } = await coreUpstream.listDeals(config, token, limit);
    res.json({ deals: items.map(toDashboardCard) });
  } catch (err) {
    next(err);
  }
});

dealsRouter.post("/deals", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const input = validateBody(createDealBodySchema, req.body);
    const { deal } = await coreUpstream.createDeal(config, token, {
      counterparty_country: input.counterpartyCountry,
      counterparty_name: input.counterpartyName,
      operation_type: input.operationType,
      amount: input.amount,
      currency: input.currency,
    });
    res.status(201).json({ deal: toDeal(deal) });
  } catch (err) {
    next(err);
  }
});

dealsRouter.get("/deals/:id", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const { deal } = await coreUpstream.getDeal(config, token, req.params.id);
    res.json({ deal: toDeal(deal) });
  } catch (err) {
    next(err);
  }
});



dealsRouter.get("/deals/:id/scenarios", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    
    
    
    const { deal } = await coreUpstream.getDeal(config, token, req.params.id);

    const cacheKey = `${deal.id}:${deal.version}`;
    let quotes = quotesCache.get<commissionUpstream.QuotesResponse>(cacheKey);
    if (!quotes) {
      // Не оборачиваем в try/catch: если commission недоступен, честнее
      // вернуть 503 на весь ответ, чем притвориться, что сценарии
      // "навсегда недоступны" карточками available:false — пользователь
      // должен видеть, что это временная ошибка, а не характеристика
      // коридора.
      quotes = await commissionUpstream.getQuotes(config, token, {
        ...corridorParams(deal),
        currency: deal.currency,
        amount: deal.amount,
      });
      quotesCache.set(cacheKey, quotes);
    }

    res.json({
      corridorId: quotes.corridor_id,
      scenarios: quotes.quotes.map(toScenarioCard),
    });
  } catch (err) {
    next(err);
  }
});

dealsRouter.post("/deals/:id/scenario", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const { scenario, version } = validateBody(chooseScenarioBodySchema, req.body);
    const { deal } = await coreUpstream.chooseScenario(config, token, req.params.id, {
      scenario,
      version,
    });
    res.json({ deal: toDeal(deal) });
  } catch (err) {
    next(err);
  }
});

// ---- Экран 4: Документы ----------------------------------------------

dealsRouter.post(
  "/deals/:dealId/documents/:documentId/upload",
  requireSession,
  express.raw({ type: "application/octet-stream", limit: "15mb" }),
  async (req, res, next) => {
    try {
      const config = getConfig(req);
      const token = readToken(req) as string;
      const claims = decodeJwt(token);
      const companyId = typeof claims.company_id === "string" ? claims.company_id : "";
      if (!companyId) throw new ApiError(403, "FORBIDDEN", "Не удалось определить компанию пользователя");
      const dealId = req.params.dealId;
      const documentId = req.params.documentId;
      if (![companyId, dealId, documentId].every((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value))) {
        throw new ApiError(400, "VALIDATION_ERROR", "Некорректный идентификатор");
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Выберите файл для загрузки");
      const filenameHeader = req.header("x-file-name");
      const contentType = req.header("x-file-type") || "application/octet-stream";
      const filename = path.basename(decodeURIComponent(filenameHeader || "document")).replace(/[^\p{L}\p{N}._-]/gu, "_");
      const allowedTypes = new Set([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]);
      if (!allowedTypes.has(contentType)) {
        throw new ApiError(415, "UNSUPPORTED_FILE_TYPE", "Поддерживаются PDF, JPG, PNG, DOCX и XLSX");
      }
      const validSignature =
        (contentType === "application/pdf" && body.subarray(0, 5).toString() === "%PDF-") ||
        (contentType === "image/jpeg" && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) ||
        (contentType === "image/png" && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (contentType.startsWith("application/vnd.openxmlformats-officedocument") && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04);
      if (!validSignature) {
        throw new ApiError(415, "INVALID_FILE_CONTENT", "Содержимое файла не соответствует его формату");
      }
      const { deal } = await coreUpstream.getDeal(config, token, dealId);
      if (!deal.documents.some((doc) => doc.id === documentId)) {
        throw new ApiError(404, "NOT_FOUND", "Документ не найден в этой сделке");
      }
      const directory = path.join(config.uploadDir ?? "/app/data/uploads", companyId, dealId, documentId);
      await mkdir(directory, { recursive: true });
      const filePath = path.join(directory, "document.bin");
      await writeFile(filePath, body, { mode: 0o600 });
      await writeFile(
        path.join(directory, "metadata.json"),
        JSON.stringify({ filename, contentType, size: body.length, uploadedAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
      res.status(201).json({ filename, contentType, size: body.length });
    } catch (err) {
      next(err);
    }
  },
);

dealsRouter.get("/deals/:dealId/documents/:documentId/file", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const claims = decodeJwt(token);
    const companyId = typeof claims.company_id === "string" ? claims.company_id : "";
    if (![companyId, req.params.dealId, req.params.documentId].every((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value))) {
      throw new ApiError(400, "VALIDATION_ERROR", "Некорректный идентификатор");
    }
    const { deal } = await coreUpstream.getDeal(config, token, req.params.dealId);
    if (!deal.documents.some((doc) => doc.id === req.params.documentId)) {
      throw new ApiError(404, "NOT_FOUND", "Документ не найден в этой сделке");
    }
    const directory = path.join(config.uploadDir ?? "/app/data/uploads", companyId, req.params.dealId, req.params.documentId);
    const metadata = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as {
      filename: string;
      contentType: string;
      size: number;
      uploadedAt: string;
    };
    const contents = await readFile(path.join(directory, "document.bin"));
    res.setHeader("Content-Type", metadata.contentType);
    res.setHeader("Content-Length", contents.length);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(metadata.filename)}`);
    res.send(contents);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      next(new ApiError(404, "NOT_FOUND", "Файл ещё не загружен"));
      return;
    }
    next(err);
  }
});

dealsRouter.post("/deals/:dealId/documents/:documentId/submit", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const { version } = validateBody(submitDocumentBodySchema, req.body);
    const { deal } = await coreUpstream.submitDocument(
      config,
      token,
      req.params.dealId,
      req.params.documentId,
      { version },
    );
    res.json({ deal: toDeal(deal) });
  } catch (err) {
    next(err);
  }
});

// ---- Экран 5: Трекинг ----------------------------------------------------
// Таймлайн и причина блокировки уже есть в полной сделке — отдельного
// запроса к core, кроме getDeal, не делаем.

dealsRouter.get("/deals/:id/tracking", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    const { deal } = await coreUpstream.getDeal(config, token, req.params.id);
    res.json({
      displayId: deal.display_id,
      stage: deal.stage as DealStage,
      hasBlockers: deal.needs_attention,
      blockerReason: deal.attention_reason,
      timeline: deal.timeline.map(toTimelineEvent),
    });
  } catch (err) {
    next(err);
  }
});
