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
import { useAuth } from "./auth/AuthProvider";
import { usePushNotifications } from "./hooks/usePushNotifications";

function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { company } = useAuth();
  const pushNotifications = usePushNotifications(company?.id);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const loadUnreadCount = useCallback(() => {
    api
      .getNotifications()
      .then((d) => setUnreadCount(d.unread))
      .catch((e) => console.error("Не удалось обновить счётчик уведомлений:", messageFor(e)));
  }, []);

  
  
  useEffect(loadUnreadCount, [loadUnreadCount]);

  useWsSubscribe((event) => {
    if (event.type === "connection.ack") {
      loadUnreadCount();
      
      
      
      setRefreshKey((k) => k + 1);
      return;
    }
    if (event.type === "heartbeat") return;

    if (event.type === "notification.created") {
      loadUnreadCount();
      
      
      
      push("info", event.dealId ? "Новое уведомление по сделке" : "Новое уведомление");
    }
    
    
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
          pushSupported={pushNotifications.supported}
          pushEnabled={pushNotifications.subscribed}
          pushBusy={pushNotifications.busy}
          pushMessage={pushNotifications.message}
          onEnablePush={() => void pushNotifications.enable()}
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
