import { useCallback, useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/Layout/Sidebar";
import { Header } from "./components/Layout/Header";
import { DashboardPage } from "./components/Dashboard/DashboardPage";
import { CreateDealWizard } from "./components/CreateDeal/CreateDealWizard";
import { ScenarioPage } from "./components/ScenarioSelection/ScenarioPage";
import { DocumentsPage } from "./components/Documents/DocumentsPage";
import { TrackingPage } from "./components/Tracking/TrackingPage";
import { NotificationsDrawer } from "./components/Notifications/NotificationsDrawer";
import { ToastContainer } from "./components/Notifications/ToastContainer";
import { useToasts } from "./hooks/useToasts";
import { WsProvider, useWsStatus, useWsSubscribe } from "./hooks/WsProvider";
import { api } from "./api/client";
import { messageFor } from "./api/errors";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { RequireAuth } from "./auth/RequireAuth";

function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  // Счётчик непрочитанных не копится локальными инкрементами по
  // notification.created — событие не несёт данных (см. README «Контракт
  // для SPA»), и локальный счётчик не переживает разрыв соединения:
  // пропущенные во время обрыва notification.created никогда бы его не
  // увеличили. connection.ack (в т.ч. после переподключения) — тоже повод
  // перезапросить счётчик по тому же правилу, что и остальные экраны
  // (см. useRefetch).
  //
  // F14 (final review): раньше счётчик брался из /api/dashboard — целого
  // списка сделок ради одного числа. getNotifications уже отдаёт unread
  // (см. bff/src/routes/notifications.ts) — используем его.
  //
  // F7 (final review): раньше запрос шёл вообще без .catch — неудачный
  // фоновый перезапрос счётчика тихо гас как unhandled rejection, а
  // пользователь просто никогда не видел, что что-то пошло не так. Прямого
  // отображения ошибки счётчику не нужно (это фоновая деталь шапки, а не
  // экран), но проглатывать её молча тоже нельзя — логируем.
  const loadUnreadCount = useCallback(() => {
    api
      .getNotifications()
      .then((d) => setUnreadCount(d.unread))
      .catch((e) => console.error("Не удалось обновить счётчик уведомлений:", messageFor(e)));
  }, []);

  // Обычная загрузка при монтировании — без неё счётчик стоит на 0 до
  // первого connection.ack, даже если непрочитанные уведомления уже были.
  useEffect(loadUnreadCount, [loadUnreadCount]);

  useWsSubscribe((event) => {
    if (event.type === "connection.ack") {
      loadUnreadCount();
      // Дровер уведомлений мог пропустить события во время разрыва —
      // перечитываем его список тем же способом, что и при обычном
      // открытии (см. NotificationsDrawer), бампая refreshKey.
      setRefreshKey((k) => k + 1);
      return;
    }
    if (event.type === "heartbeat") return;

    if (event.type === "notification.created") {
      loadUnreadCount();
      // F14 (final review): dealId: null — уведомление не привязано ни к
      // одной сделке (общесистемное), тост "Новое уведомление по сделке"
      // для него звучит как ложь.
      push("info", event.dealId ? "Новое уведомление по сделке" : "Новое уведомление");
    }
    // Любой DealEvent во время активного соединения — сигнал перезапросить,
    // не патчить состояние из его полей (см. README «Контракт для SPA»).
    setRefreshKey((k) => k + 1);
  });

  const wsStatus = useWsStatus();

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-column">
        <Header
          unreadCount={unreadCount}
          wsStatus={wsStatus}
          onOpenNotifications={() => setDrawerOpen(true)}
        />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/deals/new" element={<CreateDealWizard />} />
            <Route path="/deals/:dealId/scenario" element={<ScenarioPage />} />
            <Route path="/deals/:dealId/documents" element={<DocumentsPage />} />
            <Route path="/deals/:dealId/tracking" element={<TrackingPage />} />
          </Routes>
        </main>
      </div>

      <NotificationsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        refreshKey={refreshKey}
        onRead={() => setUnreadCount((c) => Math.max(0, c - 1))}
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <WsProvider>
              <AppShell />
            </WsProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
