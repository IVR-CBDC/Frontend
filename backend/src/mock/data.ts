import { randomUUID } from "node:crypto";
import type { Deal, NotificationItem, ScenarioOption } from "../types.js";

export const scenarioCatalog: ScenarioOption[] = [
  {
    id: "cbdc",
    title: "Расчёт через ЦВЦБ",
    description:
      "Перевод цифрового рубля напрямую между кошельками сторон, минуя корреспондентские счета.",
    etaLabel: "5–20 минут",
    costLabel: "от 0,05% от суммы",
    limitations: ["Доступно только для стран-участниц пилота ЦВЦБ", "Лимит 50 млн ₽ на сделку"],
  },
  {
    id: "bank_transfer",
    title: "Классический банковский перевод",
    description: "SWIFT/корреспондентский перевод через сеть банков-партнёров.",
    etaLabel: "1–3 рабочих дня",
    costLabel: "от 0,3% + комиссия банка-корреспондента",
    limitations: ["Требует полного комплекта валютных документов", "Возможны задержки на стороне банка контрагента"],
  },
  {
    id: "smart_contract",
    title: "Смарт-контракт",
    description: "Условное депонирование в блокчейне: средства списываются при подтверждении поставки.",
    etaLabel: "до 24 часов после подтверждения условий",
    costLabel: "фиксированная комиссия сети + 0,1%",
    limitations: ["Нужна цифровая подпись обеих сторон", "Не поддерживает частичные поставки"],
  },
  {
    id: "trade_finance",
    title: "Торговое финансирование",
    description: "Аккредитив или банковская гарантия для сделок с длинным циклом поставки.",
    etaLabel: "3–10 рабочих дней на оформление",
    costLabel: "от 1,5% годовых от суммы",
    limitations: ["Требуется кредитный лимит в банке", "Подходит для сумм от 5 млн ₽"],
  },
];

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export const deals: Deal[] = [
  {
    id: randomUUID(),
    displayId: "DEAL-2026-0143",
    counterpartyCountry: "Китай",
    counterpartyName: "Shenzhen Bay Trading Co.",
    operationType: "import",
    amount: 12_400_000,
    currency: "RUB",
    scenario: "cbdc",
    stage: "settlement",
    createdAt: iso(6),
    updatedAt: iso(0),
    hasBlockers: false,
    documents: [
      { id: randomUUID(), name: "Контракт", purpose: "Основание для валютного контроля", status: "approved", updatedAt: iso(5) },
      { id: randomUUID(), name: "Инвойс", purpose: "Подтверждает сумму и товар поставки", status: "approved", updatedAt: iso(4) },
      { id: randomUUID(), name: "Паспорт сделки", purpose: "Требуется банком для регистрации операции", status: "under_review", updatedAt: iso(1) },
    ],
    timeline: [
      { id: randomUUID(), label: "Сделка создана", actor: "Вы", timestamp: iso(6), status: "done" },
      { id: randomUUID(), label: "Документы поданы", actor: "Вы", timestamp: iso(4), status: "done" },
      { id: randomUUID(), label: "Комплаенс-проверка", actor: "Банк", timestamp: iso(2), status: "done" },
      { id: randomUUID(), label: "Расчёт через ЦВЦБ", actor: "Банк", timestamp: iso(0), status: "in_progress" },
      { id: randomUUID(), label: "Завершение сделки", actor: "Система", timestamp: "", status: "pending" },
    ],
  },
  {
    id: randomUUID(),
    displayId: "DEAL-2026-0144",
    counterpartyCountry: "Турция",
    counterpartyName: "Anadolu Textile Ltd.",
    operationType: "export",
    amount: 3_150_000,
    currency: "USD",
    scenario: "bank_transfer",
    stage: "compliance_check",
    createdAt: iso(9),
    updatedAt: iso(1),
    hasBlockers: true,
    blockerReason: "Не хватает сертификата происхождения товара",
    documents: [
      { id: randomUUID(), name: "Контракт", purpose: "Основание для валютного контроля", status: "approved", updatedAt: iso(8) },
      { id: randomUUID(), name: "Инвойс", purpose: "Подтверждает сумму и товар поставки", status: "approved", updatedAt: iso(7) },
      { id: randomUUID(), name: "Сертификат происхождения", purpose: "Требуется таможней контрагента", status: "missing", updatedAt: iso(1) },
    ],
    timeline: [
      { id: randomUUID(), label: "Сделка создана", actor: "Вы", timestamp: iso(9), status: "done" },
      { id: randomUUID(), label: "Документы поданы", actor: "Вы", timestamp: iso(7), status: "done" },
      {
        id: randomUUID(),
        label: "Комплаенс-проверка",
        actor: "Банк",
        timestamp: iso(1),
        status: "delayed",
        delayReason: "Ожидание сертификата происхождения от поставщика",
      },
      { id: randomUUID(), label: "Расчёт", actor: "Банк", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Завершение сделки", actor: "Система", timestamp: "", status: "pending" },
    ],
  },
  {
    id: randomUUID(),
    displayId: "DEAL-2026-0145",
    counterpartyCountry: "Индия",
    counterpartyName: "Ganges Pharma Exports",
    operationType: "import",
    amount: 780_000,
    currency: "USD",
    scenario: null,
    stage: "created",
    createdAt: iso(1),
    updatedAt: iso(1),
    hasBlockers: false,
    documents: [
      { id: randomUUID(), name: "Контракт", purpose: "Основание для валютного контроля", status: "uploaded", updatedAt: iso(1) },
      { id: randomUUID(), name: "Инвойс", purpose: "Подтверждает сумму и товар поставки", status: "missing", updatedAt: iso(1) },
    ],
    timeline: [
      { id: randomUUID(), label: "Сделка создана", actor: "Вы", timestamp: iso(1), status: "done" },
      { id: randomUUID(), label: "Выбор сценария расчёта", actor: "Вы", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Документы", actor: "Вы", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Комплаенс-проверка", actor: "Банк", timestamp: "", status: "pending" },
      { id: randomUUID(), label: "Завершение сделки", actor: "Система", timestamp: "", status: "pending" },
    ],
  },
];

export const notifications: NotificationItem[] = [
  {
    id: randomUUID(),
    dealId: deals[1].id,
    severity: "critical",
    message: `Сделка ${deals[1].displayId}: не хватает сертификата происхождения товара`,
    createdAt: iso(1),
    read: false,
  },
  {
    id: randomUUID(),
    dealId: deals[0].id,
    severity: "info",
    message: `Сделка ${deals[0].displayId}: началось исполнение расчёта через ЦВЦБ`,
    createdAt: iso(0),
    read: false,
  },
  {
    id: randomUUID(),
    dealId: deals[2].id,
    severity: "warning",
    message: `Сделка ${deals[2].displayId}: не выбран сценарий расчёта`,
    createdAt: iso(1),
    read: false,
  },
];
