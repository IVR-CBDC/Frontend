interface Props { deal: any; }
export default function DealCard({ deal }: Props) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-md border">
      <div className="flex justify-between">
        <h2 className="text-xl font-bold">{deal.company}</h2>
        <span className="px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-700">{deal.status}</span>
      </div>
      <p className="mt-2">{deal.country}</p>
      <div className="mt-4">
        <div className="bg-gray-200 h-2 rounded-full">
          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${deal.progress}%` }} />
        </div>
      </div>
      <div className="mt-4 font-semibold">{deal.amount} {deal.currency}</div>
    </div>
  );
}
