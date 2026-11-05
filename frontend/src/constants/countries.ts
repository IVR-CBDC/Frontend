














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
