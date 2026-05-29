import { useState } from "react";
const steps = ["Country", "Operation", "Amount", "Counterparty", "Review"];
export default function CreateDealWizard() {
  const [step, setStep] = useState(0);
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Create Deal</h1>
      <div className="flex gap-4 mb-8">
        {steps.map((s, i) => (
          <div key={s} className={`px-4 py-2 rounded-xl ${i === step ? "bg-blue-600 text-white" : "bg-gray-200"}`}>{s}</div>
        ))}
      </div>
      <div className="bg-white p-8 rounded-2xl shadow">
        <h2 className="text-2xl font-semibold">{steps[step]}</h2>
        <div className="mt-8">
          <button onClick={() => setStep(step + 1)} className="bg-blue-600 text-white px-5 py-3 rounded-xl">Next</button>
        </div>
      </div>
    </div>
  );
}
