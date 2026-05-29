interface Props { regulator: string; status: string; eta?: string; }
export default function RegulatorStatus({ regulator, status, eta }: Props) {
  return (
    <div className="bg-white rounded-2xl p-5 border">
      <div className="text-lg font-semibold">{regulator}</div>
      <div className="mt-2 text-gray-600">{status}</div>
      {eta && <div className="mt-2 text-sm text-orange-600">ETA: {eta}</div>}
    </div>
  );
}
