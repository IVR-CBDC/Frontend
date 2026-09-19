import { Router, type Request } from "express";
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

// F12 (final review): применяем zod (был в зависимостях, не использовался)
// вместо непроверенных `req.body as ...` — заодно даёт единообразное
// VALIDATION_ERROR вместо того, чтобы core первым обнаружил кривое тело и
// вернул своё сообщение об ошибке.
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

// ---- Мапперы core -> контракт BFF/SPA (types.ts) --------------------------

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

// Направление коридора для запроса котировок берём из параметров самой
// сделки (operation_type, counterparty_country), а не из query/body запроса
// клиента — иначе пользователь мог бы запросить котировки для чужого
// коридора, подделав параметры запроса. import — деньги идут из RU
// контрагенту, export — наоборот.
function corridorParams(deal: CoreDeal): { from_country: string; to_country: string } {
  return deal.operation_type === "import"
    ? { from_country: "RU", to_country: deal.counterparty_country }
    : { from_country: deal.counterparty_country, to_country: "RU" };
}

export const dealsRouter = Router();

// F4 (final review): requireSession раньше висел на всём роутере через
// dealsRouter.use(requireSession) — а роутер смонтирован в app.ts на
// "/api" целиком, поэтому requireSession срабатывал на ЛЮБОЙ /api/* путь,
// включая несуществующие (GET /api/nope без cookie отвечал 401, а не
// доходил до финального 404). requireSession навешивается на каждый
// маршрут отдельно — так несуществующие пути проваливаются мимо него к
// installErrorHandler().

// ---- Экран 1: Дашборд -------------------------------------------------

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
      // Счётчик непрочитанных уведомлений — второстепенный виджет
      // дашборда, список сделок — главное содержимое экрана. Если
      // сервис уведомлений недоступен, дашборд всё равно должен
      // показать сделки, а не упасть целиком из-за смежной фичи;
      // 0 — безопасное значение по умолчанию (не создаёт ложной тревоги).
      console.warn("dashboard: не удалось получить счётчик непрочитанных уведомлений", err);
    }

    res.json({ deals: items.map(toDashboardCard), unreadNotifications });
  } catch (err) {
    next(err);
  }
});

// ---- Экран 2: Список / создание сделки ------------------------------------

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

// ---- Экран 3: Выбор сценария расчёта --------------------------------------

dealsRouter.get("/deals/:id/scenarios", requireSession, async (req, res, next) => {
  try {
    const config = getConfig(req);
    const token = readToken(req) as string;
    // Сделку берём свежую при каждом запросе (не кешируем) — она дешёвая
    // (один запрос к core) и нужна, чтобы знать актуальную version для
    // ключа кеша котировок и актуальные параметры коридора.
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
