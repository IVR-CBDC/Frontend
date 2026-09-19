import { Router } from "express";

// ВРЕМЕННАЯ ЗАГЛУШКА: моковые данные (src/mock/data.ts) удалены на Task 1
// плана 05, чтобы дерево BFF собиралось без мок-сервера. Реальные маршруты,
// ходящие в service-core/service-auth, появятся в Task 3 того же плана —
// см. /home/legors/Documents/IVR/.superpowers/sdd/2026-09-19-05-frontend-repo-bff/.
// До тех пор любой путь под /api отвечает 501, чтобы подмена была явно видна
// и не выглядела как рабочая реализация.
export const dealsRouter = Router();

dealsRouter.all("*", (_req, res) => {
  res.status(501).json({
    code: "NOT_IMPLEMENTED",
    error: "Маршрут переписывается на реальные сервисы",
  });
});
