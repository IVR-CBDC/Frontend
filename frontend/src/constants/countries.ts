// Справочник стран для шага «Страна контрагента» мастера создания сделки.
//
// Почему справочник живёт во фронте, а не приезжает с сервера: набор
// поддерживаемых коридоров (RU↔CN, RU↔AE, RU↔IN, RU↔TR, RU↔KZ, RU↔BY и
// несколько третьих пар) задаёт service-commission — это бизнес-логика
// расчёта комиссии, а не список стран для выбора. Список стран — это
// UX-решение (что можно выбрать в форме) и он намеренно шире набора
// коридоров: пользователь должен увидеть на шаге сценария понятное
// «коридор не поддерживается» (unavailableReason из ScenarioCard), а не
// пустой select без Китая или Турции просто потому, что для какой-то пары
// валют коридора ещё нет.
//
// Код — ISO 3166-1 alpha-2, ровно то, что core ожидает в
// counterparty_country (см. task-2 brief: раньше туда уходило русское
// название вроде «Китай», и сделка создавалась с мусором в поле).
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "CN", name: "Китай" },
  { code: "TR", name: "Турция" },
  { code: "IN", name: "Индия" },
  { code: "AE", name: "ОАЭ" },
  { code: "KZ", name: "Казахстан" },
  { code: "BY", name: "Беларусь" },
  { code: "VN", name: "Вьетнам" },
  { code: "AM", name: "Армения" },
  { code: "UZ", name: "Узбекистан" },
  { code: "KG", name: "Киргизия" },
  { code: "IR", name: "Иран" },
  { code: "EG", name: "Египет" },
];

export const CURRENCIES: string[] = ["RUB", "USD", "CNY", "AED", "INR", "TRY", "KZT", "BYN"];

export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}
