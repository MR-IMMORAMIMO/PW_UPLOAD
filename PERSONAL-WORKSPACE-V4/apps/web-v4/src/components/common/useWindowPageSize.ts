import { useEffect, useState } from 'react';

/** Retains the requested maximum while allowing more rows again when the window grows. */
export function useWindowPageSize(
  requested: number,
  enabled: boolean,
  reservedHeight: number,
  rowHeight: number,
) {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return enabled
    ? Math.max(
        1,
        Math.min(
          requested || Number.POSITIVE_INFINITY,
          Math.floor((height - reservedHeight) / rowHeight),
        ),
      )
    : requested;
}
