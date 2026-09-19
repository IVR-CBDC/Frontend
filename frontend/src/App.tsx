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
import { useWebSocket } from "./hooks/useWebSocket";
import { api } from "./api/client";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { RequireAuth } from "./auth/RequireAuth";

function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  // Счётчик непрочитанных берём из /api/dashboard (там он уже есть) вместо
  // того, чтобы копить его локальными инкрементами по notification.created —
  // событие не несёт данных (см. README «Контракт для SPA»), и локальный
  // счётчик не переживает разрыв соединения: пропущенные во время обрыва
  // notification.created никогда бы его не увеличили. connection.ack
  // (в т.ч. после переподключения) — тоже повод перезапросить счётчик по
  // тому же правилу, что и остальные экраны (см. useRefetch).
  const loadUnreadCount = useCallback(() => {
    api.getDashboard().then((d) => setUnreadCount(d.unreadNotifications));
  }, []);

  // Обычная загрузка при монтировании — без неё счётчик стоит на 0 до
  // первого connection.ack, даже если непрочитанные уведомления уже были.
  useEffect(loadUnreadCount, [loadUnreadCount]);

  const isLive = useWebSocket((event) => {
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
      push("info", "Новое уведомление по сделке");
    }
    // Любой DealEvent во время активного соединения — сигнал перезапросить,
    // не патчить состояние из его полей (см. README «Контракт для SPA»).
    setRefreshKey((k) => k + 1);
  });

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-column">
        <Header
          unreadCount={unreadCount}
          isLive={isLive}
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
            <AppShell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
