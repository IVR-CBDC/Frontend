import { useState } from "react";
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

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const { toasts, push, dismiss } = useToasts();

  useWebSocket((event) => {
    if (event.type === "connection.ack") setIsLive(true);
    if (event.type === "deal.updated") {
      setRefreshKey((k) => k + 1);
    }
    if (event.type === "notification.created") {
      setUnreadCount((c) => c + 1);
      push("info", "Новое уведомление по сделке");
    }
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

      <NotificationsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} refreshKey={refreshKey} />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
