import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";




export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  
  
  
  
  
  
  return (
    <div data-app-status={status} style={{ display: "contents" }}>
      {status === "anonymous" && (
        
        <Navigate to="/login" replace state={{ from: location }} />
      )}
      {status === "authenticated" && children}
    </div>
  );
}
