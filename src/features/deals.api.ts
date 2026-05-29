import { api } from "@/shared/api/axios";
export const getDeals = async () => { const r = await api.get("/deals"); return r.data; };
