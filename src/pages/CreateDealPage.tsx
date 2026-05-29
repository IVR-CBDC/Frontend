import { useForm } from "react-hook-form";
export default function CreateDealPage() {
  const { register, handleSubmit } = useForm();
  const onSubmit = (data: any) => console.log(data);
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Create Deal</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white p-6 rounded-2xl shadow space-y-4">
        <input {...register("country")} placeholder="Country" className="w-full border p-3 rounded-xl" />
        <input {...register("company")} placeholder="Company" className="w-full border p-3 rounded-xl" />
        <input {...register("amount")} placeholder="Amount" className="w-full border p-3 rounded-xl" />
        <button className="bg-blue-600 text-white px-5 py-3 rounded-xl">Create</button>
      </form>
    </div>
  );
}
