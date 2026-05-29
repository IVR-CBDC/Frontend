import Sidebar from "@/widgets/Sidebar";
import Topbar from "@/widgets/Topbar";
export default function DashboardLayout({ children }: any) {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1"><Topbar /><main>{children}</main></div>
    </div>
  );
}
