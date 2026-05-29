import { LayoutDashboard, PlusCircle, FileText, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
export default function Sidebar() {
  return (
    <aside className="w-[260px] bg-[#111827] text-white min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-10">CBDC Hub</h1>
      <nav className="space-y-4">
        <Link to="/" className="flex items-center gap-3"><LayoutDashboard size={20} /> Dashboard</Link>
        <Link to="/create" className="flex items-center gap-3"><PlusCircle size={20} /> Create Deal</Link>
        <Link to="/documents" className="flex items-center gap-3"><FileText size={20} /> Documents</Link>
        <Link to="/tracking" className="flex items-center gap-3"><Clock3 size={20} /> Tracking</Link>
      </nav>
    </aside>
  );
}
