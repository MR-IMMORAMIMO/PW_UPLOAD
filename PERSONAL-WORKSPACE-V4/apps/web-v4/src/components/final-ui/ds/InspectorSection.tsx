import { C, TYPE } from '../tokens';

interface InspectorSectionProps {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export function InspectorSection({ title, right, children }: InspectorSectionProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <div
          className="font-bold uppercase tracking-widest"
          style={{ fontSize: TYPE.tiny, color: C.textMuted }}
        >
          {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

interface InspectorRowProps {
  label: string;
  value: string | React.ReactNode;
  labelWidth?: number;
}

export function InspectorRow({ label, value, labelWidth = 80 }: InspectorRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] shrink-0" style={{ color: C.textMuted, minWidth: labelWidth }}>
        {label}
      </span>
      <span className="text-[10px] font-medium" style={{ color: C.text }}>
        {value}
      </span>
    </div>
  );
}

export function InspectorDivider() {
  return <div className="border-t" style={{ borderColor: C.borderLight }} />;
}
