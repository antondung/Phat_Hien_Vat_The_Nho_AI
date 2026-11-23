import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocalState } from '../hooks/useLocalState';

type Theme = 'light' | 'dark';
const Ctx = createContext<{ theme: Theme; forced: boolean; toggle(): void }>({ theme: 'light', forced: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocalState<Theme>('theme', 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = 'app';
  }, [theme]);
  return (
    <Ctx.Provider value={{ theme, forced: false, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
