import { createBrowserRouter } from "react-router-dom";
import DashboardPage from "@/pages/DashboardPage";
import TrackingPage from "@/pages/TrackingPage";
import CreateDealPage from "@/pages/CreateDealPage";
import LoginPage from "@/pages/LoginPage";
import DocumentsPage from "@/pages/DocumentsPage";
import CreateDealWizard from "@/pages/CreateDealWizard";
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <DashboardPage /> },
  { path: "/tracking", element: <TrackingPage /> },
  { path: "/create", element: <CreateDealPage /> },
  { path: "/create-wizard", element: <CreateDealWizard /> },
  { path: "/documents", element: <DocumentsPage /> }
]);
