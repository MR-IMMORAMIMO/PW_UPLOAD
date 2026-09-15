import { C } from '../tokens';

// Shared table header background — used by both LuminaireLibrary and SmartImport
export const TABLE_HEADER_BG = C.tableHeader; // #f8fafc
export const TABLE_ROW_BORDER = C.borderLight; // #f3f4f6
export const TABLE_SEL_BG = C.selectedRow; // #eff6ff

interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}

export function Th({ children, className = '', ...rest }: ThProps) {
  return (
    <th
      className={`py-2 px-2 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{ color: C.textMuted }}
      {...rest}
    >
      {children}
      <span data-resize-host="" />
    </th>
  );
}

interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  children: React.ReactNode;
}

export function Tr({ selected, children, style, ...rest }: TrProps) {
  return (
    <tr
      style={{
        borderBottom: `1px solid ${TABLE_ROW_BORDER}`,
        background: selected ? TABLE_SEL_BG : 'transparent',
        borderLeft: selected ? `3px solid ${C.teal}` : '3px solid transparent',
        ...style,
      }}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}

export function Td({ children, className = '', ...rest }: TdProps) {
  return (
    <td className={`py-2 px-2 text-[11px] ${className}`} {...rest}>
      {children}
    </td>
  );
}
