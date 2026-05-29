interface Props { notifications: any[]; }
export default function NotificationCenter({ notifications }: Props) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow">
      <h2 className="text-xl font-bold mb-4">Notifications</h2>
      <div className="space-y-3">
        {notifications.map((n) => <div key={n.id} className="border-b pb-2">{n.message}</div>)}
      </div>
    </div>
  );
}
