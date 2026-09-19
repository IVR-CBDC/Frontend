import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// globals: false — testing-library не находит глобальный afterEach сам,
// поэтому размонтирование DOM между тестами регистрируем явно (иначе разметка
// от предыдущего теста остаётся в document и текстовые запросы задваиваются).
afterEach(() => {
  cleanup();
});

// Каждый тест сам подменяет global.fetch — гасим подмену после теста, чтобы
// она не утекала в следующий (иначе моки одного теста молча ловят запросы
// другого).
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
