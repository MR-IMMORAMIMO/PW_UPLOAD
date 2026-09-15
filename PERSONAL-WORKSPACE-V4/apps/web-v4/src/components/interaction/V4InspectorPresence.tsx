import { useEffect, useRef, type ReactNode } from 'react';
import { useV4Presence } from './useV4Presence';

export function useV4InspectorPresence(open: boolean) {
  return useV4Presence(open);
}

export function V4InspectorPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const presence = useV4InspectorPresence(open);
  const containedFocusRef = useRef(false);

  useEffect(() => {
    if (open) containedFocusRef.current = false;
  }, [open]);

  if (!presence.mounted) return null;
  const setPresenceNode = (node: HTMLDivElement | null) => presence.ref(node);
  return (
    <div
      ref={setPresenceNode}
      className="v4-inspector-presence"
      data-v4-presence={presence.state}
      onFocusCapture={() => {
        containedFocusRef.current = true;
      }}
      onTransitionEnd={presence.onTransitionEnd}
      onAnimationEnd={presence.onAnimationEnd}
    >
      {children}
    </div>
  );
}
