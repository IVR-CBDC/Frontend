import { useQuery } from "@tanstack/react-query";
import { getDeals } from "./deals.api";
export const useDeals = () => useQuery({ queryKey: ["deals"], queryFn: getDeals });
