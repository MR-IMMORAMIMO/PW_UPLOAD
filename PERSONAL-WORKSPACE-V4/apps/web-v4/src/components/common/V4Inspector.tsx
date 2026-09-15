import type { HTMLAttributes, ReactNode } from 'react';

export interface V4InspectorFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}

export function V4InspectorFrame({
  title,
  description,
  actions,
  footer,
  className,
  children,
  ...props
}: V4InspectorFrameProps) {
  return (
    <aside className={`v4-inspector${className ? ` ${className}` : ''}`} {...props}>
      <header className="v4-inspector__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="v4-inspector__actions">{actions}</div> : null}
      </header>
      <div className="v4-inspector__body">{children}</div>
      {footer ? <footer className="v4-inspector__footer">{footer}</footer> : null}
    </aside>
  );
}

export function V4InspectorSection({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v4-inspector__section${className ? ` ${className}` : ''}`}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}

export function V4InspectorMetadata({ children }: { children: ReactNode }) {
  return <dl className="v4-inspector__metadata">{children}</dl>;
}

export function V4InspectorFooter({ children }: { children: ReactNode }) {
  return <div className="v4-inspector__footer-actions">{children}</div>;
}
