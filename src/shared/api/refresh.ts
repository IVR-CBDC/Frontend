import { api } from "./axios";
import { useAuthStore } from "@/features/auth.store";
export const refreshToken = async () => {
  try {
    const response = await api.post("/auth/refresh");
    useAuthStore.getState().setToken(response.data.accessToken);
    return response.data.accessToken;
  } catch (error) {
    useAuthStore.getState().logout();
    return null;
  }
};
