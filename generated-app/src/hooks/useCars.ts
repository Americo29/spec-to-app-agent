import { useQuery, ApolloError } from "@apollo/client";
import { GET_CARS } from "@/graphql/queries";
import type { Car } from "@/types";

export interface UseCarsResult {
  cars: Car[];
  loading: boolean;
  error: ApolloError | undefined;
  refetch: () => void;
}

export function useCars(): UseCarsResult {
  const { data, loading, error, refetch } = useQuery<{ cars: Car[] }>(GET_CARS);

  return {
    cars: data?.cars ?? [],
    loading,
    error,
    refetch: () => {
      refetch();
    },
  };
}

export default useCars;