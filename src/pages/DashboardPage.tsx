import DealCard from "@/widgets/DealCard";
import { useDeals } from "@/features/useDeals";
export default function DashboardPage() {
  const { data, isLoading } = useDeals();
  if (isLoading) return <div className="p-8">Loading...</div>;
  return (
    <div className="min-h-screen p-8 bg-gray-100">
      <h1 className="text-4xl font-bold mb-8">Alfa Global CBDC Hub</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {data?.map((deal: any) => <DealCard key={deal.id} deal={deal} />)}
      </div>
    </div>
  );
}
