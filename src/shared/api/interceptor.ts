import { api } from "./axios";
import { useAuthStore } from "@/features/auth.store";
import { refreshToken } from "./refresh";
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const orig = error.config;
    if (error.response?.status === 401 && !orig._retry) {
      orig._retry = true;
      const token = await refreshToken();
      if (token) { orig.headers.Authorization = `Bearer ${token}`; return api(orig); }
    }
    return Promise.reject(error);
  }
);
