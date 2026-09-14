import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { Circle } from '@/lib/types';

interface CircleContextValue {
  circles: Circle[];
  selectedCircleId: string | null;
  selectedCircle: Circle | null;
  setSelectedCircleId: (id: string) => void;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const CircleContext = createContext<CircleContextValue>({
  circles: [],
  selectedCircleId: null,
  selectedCircle: null,
  setSelectedCircleId: () => {},
  isLoading: true,
  refresh: async () => {},
});

export function CircleProvider({ children }: { children: ReactNode }) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('circles').select('*').order('created_at');
    if (!error) {
      setCircles(data ?? []);
      setSelectedCircleId((current) => current ?? data?.[0]?.id ?? null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedCircle = circles.find((c) => c.id === selectedCircleId) ?? null;

  return (
    <CircleContext.Provider
      value={{ circles, selectedCircleId, selectedCircle, setSelectedCircleId, isLoading, refresh }}
    >
      {children}
    </CircleContext.Provider>
  );
}

export function useCircles() {
  return useContext(CircleContext);
}
