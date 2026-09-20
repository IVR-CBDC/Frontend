import { test as base, expect as baseExpect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Адреса стенда (см. README.md «Локальный запуск против стенда Backend»).
//
// План 08 (Task 4): адрес ОДИН. nginx образа SPA проксирует `/api` и `/ws`
// на BFF (frontend/nginx.conf), то есть ровно тот путь, которым в BFF
// ходит настоящий браузер, — значит и запросы, которые фикстуры шлют мимо
// браузера, должны идти туда же. Два следствия:
//
//  * `Origin` совпадает по построению. BFF проверяет Origin на CSRF (см.
//    README «Контракт для SPA», FORBIDDEN_ORIGIN); пока адресов было два,
//    их совпадение держалось на том, что кто-то не забыл выставить обе
//    переменные согласованно — а расхождение давало 403 в середине теста.
//  * прогон проверяет тот же периметр, что видит пользователь. План 08
//    (Task 1) убрал наружу всё, кроме frontend и bff; e2e, ходившие в BFF
//    по прямому host-порту, обходили бы это изменение и не заметили бы его
//    поломки.
//
// E2E_BFF_URL оставлен рычагом для нестандартного стенда (BFF на отдельном
// домене); в обычном прогоне его задавать не нужно.
//
// CORE_URL — единственный настоящий особый случай: `POST
// /internal/emulator/tick` внутренняя, наружу не публикуется ни в compose,
// ни в k3s (спека §4.3), BFF её не проксирует. Она доступна только по
// host-порту service-core, который открывает dev-оверлей compose-стенда —
// и именно поэтому e2e живут на compose-стенде, а не в кластере (решение
// записано в спеку, §4.3).
export const SPA_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8090";
export const BFF_URL = process.env.E2E_BFF_URL ?? SPA_URL;
export const CORE_URL = process.env.E2E_CORE_URL ?? "http://127.0.0.1:18081";

// Черновик мастера создания сделки (см. CreateDealWizard.tsx) — переживает
// перезагрузку и переживает пере-монтирование компонента, поэтому тянется
// из localStorage сохранённого профиля браузера в новый тест, если его не
// стереть явно (план 06).
export const DRAFT_KEY = "draft:new-deal";

export interface Company {
  login: string;
  password: string;
  inn: string;
  companyName: string;
}

// F8 (final fix wave): раньше дублировалась дословно между fixtures/stand.ts
// (фикстура company) и isolation.spec.ts (компания B регистрируется во
// втором browser-контексте, отдельно от фикстуры company) — вынесена сюда,
// единственный источник.
export function randomInn(): string {
  let digits = "";
  for (let i = 0; i < 10; i++) digits += Math.floor(Math.random() * 10);
  return digits;
}

export async function clearDraft(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.removeItem(key), DRAFT_KEY);
}

type TickFn = (times?: number) => Promise<void>;

interface Fixtures {
  company: Company;
  tick: TickFn;
}

export const test = base.extend<Fixtures>({
  // Регистрирует уникальную компанию через API BFF (не через UI — форма
  // регистрации проверяется отдельным тестом, здесь нужна быстрая и
  // надёжная подготовка данных, см. task-1-brief.md). context.request
  // делит cookie-хранилище с браузерным контекстом — Set-Cookie из ответа
  // регистрации осядет в context и браузер откроется уже авторизованным.
  company: async ({ context }, use) => {
    const company: Company = {
      login: `e2e-${randomUUID()}`,
      password: "E2e-Test-Passw0rd!",
      inn: randomInn(),
      companyName: `E2E Trading ${randomUUID().slice(0, 8)}`,
    };

    const res = await context.request.post(`${BFF_URL}/api/auth/register`, {
      headers: { Origin: SPA_URL },
      data: {
        login: company.login,
        password: company.password,
        company_name: company.companyName,
        inn: company.inn,
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Не удалось зарегистрировать тестовую компанию через ${BFF_URL}/api/auth/register ` +
          `(${res.status()}): ${await res.text()}`,
      );
    }

    await use(company);
  },

  // Двигает ручной эмулятор service-core на `times` тиков подряд. 404
  // значит, что стенд поднят без EMULATOR_MANUAL=true — тест должен упасть
  // сразу с понятным сообщением, а не молча таймаутиться в ожидании
  // прогресса, которого никогда не будет (см. implementer-rules.md).
  tick: async ({ request }, use) => {
    const doTick: TickFn = async (times = 1) => {
      for (let i = 0; i < times; i++) {
        const res = await request.post(`${CORE_URL}/internal/emulator/tick`);
        if (res.status() === 404) {
          throw new Error(
            `POST ${CORE_URL}/internal/emulator/tick вернул 404 — стенд поднят в автоматическом ` +
              "режиме эмулятора (ручка регистрируется только при EMULATOR_MANUAL=true).\n" +
              "Штатно сюда дойти уже нельзя: режим проверяет globalSetup по полю emulator_manual " +
              "в /health service-core (план 08, Task 4). Если этот текст всё-таки виден — значит " +
              "core пересоздали ПОСЛЕ старта прогона.\n" +
              "Чинить (из /home/legors/Documents/IVR): make e2e-stand-up",
          );
        }
        if (!res.ok()) {
          throw new Error(`POST ${CORE_URL}/internal/emulator/tick ответил ${res.status()}: ${await res.text()}`);
        }
      }
    };
    await use(doTick);
  },

  // Переопределяем встроенную page-фикстуру: любой тест, запросивший page,
  // неявно тянет company (порядок гарантирован — cookie должна лечь в
  // context ДО первой навигации), затем сразу открывает SPA и чистит
  // черновик мастера, прежде чем тест увидит страницу. Так «протечка»
  // черновика между тестами (см. DRAFT_KEY выше) невозможна в принципе, а
  // не «настолько, насколько тест сам не забыл почистить».
  page: async ({ page, company }, use) => {
    void company;
    await page.goto("/");
    await clearDraft(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";

// F8 (final fix wave): дублировалась дословно между happy-path.spec.ts и
// recovery.spec.ts — оба гоняют один и тот же цикл "тикнуть, если
// 'Отклонён' — переподать, ждать 'Подтверждён'" на строке документа.
// F5 (final fix wave): раньше локатор строки — `row.locator("span.mono")`,
// общий CSS-класс с другими .mono-элементами карточки/страницы (см.
// ScenarioPage.tsx StatBlock, DashboardPage.tsx SummaryStat) — теперь
// `data-testid="document-status"` (DocumentsPage.tsx), однозначный и
// нечувствительный к появлению второго .mono в той же строке.
export async function waitForDocumentApproved(
  row: Locator,
  tick: (times?: number) => Promise<void>,
): Promise<void> {
  const statusBadge = row.getByTestId("document-status");
  await baseExpect
    .poll(
      async () => {
        await tick();
        const status = await statusBadge.textContent();
        if (status === "Отклонён") {
          const resubmit = row.getByRole("button", { name: /Отправить на проверку/ });
          if (await resubmit.isVisible()) await resubmit.click();
        }
        return status;
      },
      { timeout: 60_000, message: "документ не дошёл до 'Подтверждён'" },
    )
    .toBe("Подтверждён");
}
