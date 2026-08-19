import { useQuery, ApolloError, ApolloQueryResult, OperationVariables } from "@apollo/client";
import { GET_CARS } from "@/graphql/queries";
import type { Car } from "@/types";

export interface UseCarsResult {
  cars: Car[];
  loading: boolean;
  error: ApolloError | undefined;
  refetch: (variables?: Partial<OperationVariables>) => Promise<ApolloQueryResult<{ cars: Car[] }>>;
}

export function useCars(): UseCarsResult {
  const { data, loading, error, refetch } = useQuery<{ cars: Car[] }>(GET_CARS);

  return {
    cars: data?.cars ?? [],
    loading,
    error,
    refetch,
  };
}

export default useCars;