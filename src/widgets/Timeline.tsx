interface Props { events: any[]; }
export default function Timeline({ events }: Props) {
  return (
    <div className="space-y-4">
      {events.map((event) => (
        <div key={event.id} className="bg-white p-5 rounded-2xl border">
          <div className="flex justify-between">
            <div><div className="font-semibold">{event.stage}</div><div className="text-sm text-gray-500">{event.participant}</div></div>
            <div>{event.status}</div>
          </div>
          {event.delayReason && <div className="mt-3 text-sm text-orange-600">{event.delayReason}</div>}
        </div>
      ))}
    </div>
  );
}
