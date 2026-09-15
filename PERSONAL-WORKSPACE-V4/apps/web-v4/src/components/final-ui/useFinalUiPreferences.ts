import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/environment';
import type { UpdateFinalUiPreference } from '@scli/contracts';

const key = ['v4', 'final-ui', 'preferences'] as const;
export function useFinalUiPreferences() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api.finalUiPreferences() });
  const update = useMutation({
    mutationFn: (input: UpdateFinalUiPreference) => api.updateFinalUiPreference(input),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return {
    items: query.data?.items ?? [],
    loading: query.isLoading,
    error: query.error ?? update.error,
    update: update.mutate,
  };
}
