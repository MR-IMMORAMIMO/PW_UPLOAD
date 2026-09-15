import * as FinalGlyphs from '../../common/SctIcons';
import { C, RADIUS, BORDER, ICON } from '../tokens';

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerStyle?: React.CSSProperties;
}

const SearchIcon = () => (
  <FinalGlyphs.SctSearch
    className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
    width={ICON.md}
    height={ICON.md}
  />
);

export default function SearchInput({
  containerStyle,
  style,
  className = '',
  ...rest
}: SearchInputProps) {
  return (
    <div className="relative" style={containerStyle}>
      <SearchIcon />
      <input
        className={`pl-8 pr-3 py-1.5 text-[12px] outline-none w-full transition-all ${className}`}
        style={{
          borderRadius: RADIUS.control,
          border: `${BORDER.width}px solid ${BORDER.color}`,
          color: C.text,
          background: C.white,
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}
