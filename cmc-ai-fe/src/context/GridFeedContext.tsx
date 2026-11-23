import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_MODE } from '../services';
import { GRID_SNAPSHOT_WIDTH } from '../services/media';
import { GRID_WS_FPS, GridWsSession, type GridFeedStatus } from '../services/http/gridWs';

interface GridFeedCtx {
  status: GridFeedStatus;
  subscribe(cameraId: string, cb: (url: string) => void): () => void;
  frame(cameraId: string): string | undefined;
}

const Ctx = createContext<GridFeedCtx | null>(null);

/** Một WS /ws/grid cho các ô đang hiện. Lỗi / timeout → các ô tự fallback snapshot. */
export function GridFeedProvider({ cameraIds, children }: { cameraIds: string[]; children: ReactNode }) {
  const session = useRef<GridWsSession | null>(null);
  const [status, setStatus] = useState<GridFeedStatus>('connecting');
  const key = cameraIds.join(',');

  useEffect(() => {
    if (API_MODE !== 'real' || !cameraIds.length) {
      session.current?.stop();
      session.current = null;
      setStatus('snapshot');
      return;
    }
    if (!session.current) session.current = new GridWsSession();
    const off = session.current.onStatus(setStatus);
    session.current.resubscribe(cameraIds, GRID_SNAPSHOT_WIDTH, GRID_WS_FPS);
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => {
    session.current?.stop();
    session.current = null;
  }, []);

  const value = useMemo<GridFeedCtx>(
    () => ({
      status,
      subscribe: (id, cb) => session.current?.subscribe(id, cb) ?? (() => {}),
      frame: (id) => session.current?.frame(id),
    }),
    [status],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGridFeed(): GridFeedCtx | null {
  return useContext(Ctx);
}
