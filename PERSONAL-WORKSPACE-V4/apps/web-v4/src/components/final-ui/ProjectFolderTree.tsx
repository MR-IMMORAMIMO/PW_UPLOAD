import { useState } from 'react';
import { SctExpand, SctFolder } from '../common/SctIcons';

/** Read-only representation of the exact reviewed paths, never a filesystem browser. */
export function ProjectFolderTree({ paths, root }: { paths: string[]; root: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const branches = paths.filter((path) => paths.some((child) => child.startsWith(`${path}/`)));
  const toggle = (path: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <div className="project-folder-tree">
      <div className="flex justify-between gap-2 mb-2">
        <button type="button" onClick={() => setClosed(new Set())}>
          Expand all
        </button>
        <button type="button" onClick={() => setClosed(new Set(['', ...branches]))}>
          Collapse all
        </button>
      </div>
      <button
        type="button"
        aria-expanded={!closed.has('')}
        onClick={() => toggle('')}
        className="flex items-center gap-2 py-2"
      >
        <SctExpand
          aria-hidden="true"
          width={14}
          height={14}
          style={{ transform: closed.has('') ? 'rotate(-90deg)' : undefined }}
        />
        <SctFolder aria-hidden="true" width={16} height={16} />
        <strong>{root}</strong>
      </button>
      {!closed.has('') &&
        paths.map((path) => {
          const parts = path.split('/');
          if (
            parts.slice(0, -1).some((_, index) => closed.has(parts.slice(0, index + 1).join('/')))
          )
            return null;
          const hasChildren = branches.includes(path);
          const content = (
            <>
              <SctFolder aria-hidden="true" width={16} height={16} />
              <span>{parts.at(-1)}</span>
            </>
          );
          return (
            <div key={path} style={{ paddingLeft: parts.length * 18, paddingBlock: 3 }}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={path}
                  aria-expanded={!closed.has(path)}
                  className="flex items-center gap-2"
                  onClick={() => toggle(path)}
                >
                  <SctExpand
                    aria-hidden="true"
                    width={14}
                    height={14}
                    style={{ transform: closed.has(path) ? 'rotate(-90deg)' : undefined }}
                  />
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-2" style={{ paddingLeft: 22 }}>
                  {content}
                </div>
              )}
            </div>
          );
        })}
      {!paths.length && <p>No folders are enabled.</p>}
    </div>
  );
}
