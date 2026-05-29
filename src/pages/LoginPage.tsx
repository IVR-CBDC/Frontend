import { useForm } from "react-hook-form";
import { api } from "@/shared/api/axios";
import { useAuthStore } from "@/features/auth.store";
import { useNavigate } from "react-router-dom";
export default function LoginPage() {
  const navigate = useNavigate();
  const { setToken } = useAuthStore();
  const { register, handleSubmit } = useForm();
  const onSubmit = async (data: any) => {
    try { const r = await api.post("/auth/login", data); setToken(r.data.accessToken); navigate("/"); }
    catch (error) { console.error(error); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white p-8 rounded-2xl shadow-lg w-[400px] space-y-4">
        <h1 className="text-3xl font-bold">Login</h1>
        <input {...register("email")} placeholder="Email" className="w-full border p-3 rounded-xl" />
        <input {...register("password")} type="password" placeholder="Password" className="w-full border p-3 rounded-xl" />
        <button className="w-full bg-blue-600 text-white py-3 rounded-xl">Sign In</button>
      </form>
    </div>
  );
}
