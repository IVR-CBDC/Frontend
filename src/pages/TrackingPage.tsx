import { useEffect, useState } from "react";
import { socket } from "@/websocket/socket";
export default function TrackingPage() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    socket.on("deal-status-updated", (payload) => setEvents((prev) => [payload, ...prev]));
    return () => { socket.off("deal-status-updated"); };
  }, []);
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Tracking</h1>
      <div className="space-y-4">
        {events.map((event) => (
          <div key={event.id} className="bg-white p-4 rounded-xl border">
            <div className="font-semibold">{event.stage}</div>
            <div className="text-sm text-gray-500">{event.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
