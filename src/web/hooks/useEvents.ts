import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export function useEvents(queryKeys: QueryKey[]): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return;
    }

    const source = new EventSource('/api/events');
    source.onopen = () => {
      for (const queryKey of queryKeys) {
        queryClient.invalidateQueries({ queryKey });
      }
    };

    return () => {
      source.close();
    };
  }, [queryClient, queryKeys]);
}
