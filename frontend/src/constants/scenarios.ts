// Человекочитаемые названия сценариев расчёта для мест, куда SCENARIO не
// приходит вместе со своей ScenarioCard (title там уже есть) — например,
// TrackingPage получает только Deal.scenario (голый code, см. types/api.ts).
//
// F5 (final review): TrackingPage раньше рендерил code напрямую
// ("bank_transfer" вместо «Банковский перевод») — та же регрессия задачи 2,
// что и с counterpartyCountry (см. DealCard).
import type { SettlementScenario } from "../types/api";

export const SCENARIO_TITLES: Record<SettlementScenario, string> = {
  cbdc: "Расчёт через ЦВЦБ",
  bank_transfer: "Банковский перевод",
  smart_contract: "Смарт-контракт",
  trade_finance: "Торговое финансирование",
};
