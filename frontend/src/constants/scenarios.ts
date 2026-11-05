






import type { SettlementScenario } from "../types/api";

export const SCENARIO_TITLES: Record<SettlementScenario, string> = {
  cbdc: "Расчёт через ЦВЦБ",
  bank_transfer: "Банковский перевод",
  smart_contract: "Смарт-контракт",
  trade_finance: "Торговое финансирование",
};
