/** Owner-approved SCT SVG geometry. One semantic key, one drawing across all surfaces. */
import { forwardRef, type SVGProps } from 'react';
export interface SctIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}
export const SctDashboard = forwardRef<SVGSVGElement, SctIconProps>(function SctDashboard(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dashboard"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="11" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="18" width="7" height="3" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctProjects = forwardRef<SVGSVGElement, SctIconProps>(function SctProjects(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="projects"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M6 12h5v5H6ZM15 12h3M15 16h3" />
      </g>
    </svg>
  );
});
export const SctSummary = forwardRef<SVGSVGElement, SctIconProps>(function SctSummary(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="summary"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 18a10 10 0 1 1 18 0M6 16H4M20 16h-2M12 4v3M6 7l2 2M18 7l-2 2M12 15l5-5" />
        <circle cx="12" cy="15" r="1.5" />
      </g>
    </svg>
  );
});
export const SctTimeline = forwardRef<SVGSVGElement, SctIconProps>(function SctTimeline(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="timeline"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 3v18M5 6h5M5 12h8M5 18h5M13 6h7M16 12h4M13 18h7" />
        <circle cx="5" cy="6" r="1.5" />
        <circle cx="5" cy="18" r="1.5" />
      </g>
    </svg>
  );
});
export const SctScope = forwardRef<SVGSVGElement, SctIconProps>(function SctScope(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="scope"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="4" width="16" height="18" rx="1.5" />
        <rect x="8" y="2" width="8" height="4" rx="1.5" />
        <path d="M8 10h8M8 14h8M8 18h5" />
      </g>
    </svg>
  );
});
export const SctRequirements = forwardRef<SVGSVGElement, SctIconProps>(function SctRequirements(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="requirements"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 6 2 2 3-4M11 6h10m-18 7 2 2 3-4M11 13h10m-18 7 2 2 3-4M11 20h10" />
      </g>
    </svg>
  );
});
export const SctDeliverables = forwardRef<SVGSVGElement, SctIconProps>(function SctDeliverables(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="deliverables"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10" />
        <path d="m8 15 3 3 5-5" />
      </g>
    </svg>
  );
});
export const SctActions = forwardRef<SVGSVGElement, SctIconProps>(function SctActions(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="actions"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="3" width="18" height="18" rx="1.5" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctMeetings = forwardRef<SVGSVGElement, SctIconProps>(function SctMeetings(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="meetings"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M7 2v6M17 2v6M3 10h18" />
        <circle cx="8" cy="14" r="1" />
        <circle cx="16" cy="14" r="1" />
        <path d="M6 18h4M14 18h4" />
      </g>
    </svg>
  );
});
export const SctComments = forwardRef<SVGSVGElement, SctIconProps>(function SctComments(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="comments"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3h18v14H9l-6 5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M3 3h18v14H9l-6 5ZM7 7h10M7 11h7" />
      </g>
    </svg>
  );
});
export const SctContacts = forwardRef<SVGSVGElement, SctIconProps>(function SctContacts(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="contacts"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="2" width="18" height="20" rx="1.5" />
        <circle cx="12" cy="8" r="2.5" />
        <path d="M7 17a5 5 0 0 1 10 0M8 20h8M1 6h4M1 12h4M1 18h4" />
      </g>
    </svg>
  );
});
export const SctLibrary = forwardRef<SVGSVGElement, SctIconProps>(function SctLibrary(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="library"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3h5v18H3ZM10 3h5v18h-5ZM17 4l4-1 3 17-4 1ZM4 7h3M11 7h3" />
      </g>
    </svg>
  );
});
export const SctLuminaires = forwardRef<SVGSVGElement, SctIconProps>(function SctLuminaires(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="luminaires"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M6 8h12l3 5H3Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M12 2v6M6 8h12l3 5H3ZM7 17l-2 3M12 17v5M17 17l2 3" />
      </g>
    </svg>
  );
});
export const SctSystems = forwardRef<SVGSVGElement, SctIconProps>(function SctSystems(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="systems"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="9" y="2" width="6" height="5" rx="1.5" />
        <rect x="1" y="17" width="6" height="5" rx="1.5" />
        <rect x="9" y="17" width="6" height="5" rx="1.5" />
        <rect x="17" y="17" width="6" height="5" rx="1.5" />
        <path d="M12 7v10M4 17v-5h16v5" />
      </g>
    </svg>
  );
});
export const SctAccessories = forwardRef<SVGSVGElement, SctIconProps>(function SctAccessories(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="accessories"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M7 3v5M13 3v5M5 8h10v4a5 5 0 0 1-10 0ZM10 17v2a3 3 0 0 0 6 0v-6h5M19 10v6" />
      </g>
    </svg>
  );
});
export const SctDatasheets = forwardRef<SVGSVGElement, SctIconProps>(
  function SctDatasheets(props, ref) {
    return <SctPdf {...props} ref={ref} />;
  },
);
export const SctTechnicalCheck = forwardRef<SVGSVGElement, SctIconProps>(function SctTechnicalCheck(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="technical-check"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="4" width="16" height="18" rx="1.5" />
        <rect x="8" y="2" width="8" height="4" rx="1.5" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctOutputStudio = forwardRef<SVGSVGElement, SctIconProps>(function SctOutputStudio(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="output-studio"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="18" rx="1.5" />
        <path d="M2 8h20M8 8v13M11 12h7M11 16h4" />
      </g>
    </svg>
  );
});
export const SctSchedule = forwardRef<SVGSVGElement, SctIconProps>(function SctSchedule(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="schedule"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <path d="M3 9h18M9 9v11M15 9v11M3 14h18" />
      </g>
    </svg>
  );
});
export const SctBoq = forwardRef<SVGSVGElement, SctIconProps>(function SctBoq(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="boq"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <path d="M3 9h18M9 9v11M15 9v11M3 14h18" />
        <path d="M5 6h2M11 6h2M17 6h2" />
      </g>
    </svg>
  );
});
export const SctSpecifications = forwardRef<SVGSVGElement, SctIconProps>(function SctSpecifications(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="specifications"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M8 12h8M8 17h8M10 10v4M14 15v4" />
      </g>
    </svg>
  );
});
export const SctRevisions = forwardRef<SVGSVGElement, SctIconProps>(function SctRevisions(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="revisions"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 4h12v13H3ZM8 8h13v13H8M11 12h7m-3-3 3 3-3 3M11 18h7" />
      </g>
    </svg>
  );
});
export const SctPackages = forwardRef<SVGSVGElement, SctIconProps>(function SctPackages(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="packages"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10" />
      </g>
    </svg>
  );
});
export const SctFiles = forwardRef<SVGSVGElement, SctIconProps>(function SctFiles(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="files"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M3 20 6 11h16l-3 9Z" />
      </g>
    </svg>
  );
});
export const SctSmartImport = forwardRef<SVGSVGElement, SctIconProps>(function SctSmartImport(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="smart-import"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M1 12h10m-3-3 3 3-3 3M8 18h8" />
      </g>
    </svg>
  );
});
export const SctReports = forwardRef<SVGSVGElement, SctIconProps>(function SctReports(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="reports"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3v18h19M7 17v-5h3v5M13 17V8h3v9M19 17V4h2v13" />
      </g>
    </svg>
  );
});
export const SctSettings = forwardRef<SVGSVGElement, SctIconProps>(function SctSettings(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="settings"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="3" />
        <path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z" />
      </g>
    </svg>
  );
});
export const SctPdf = forwardRef<SVGSVGElement, SctIconProps>(function SctPdf(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="pdf"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)" style={{ color: '#ef4444' }}>
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path
          d="M6.5 17v-5h1.3a1.25 1.25 0 0 1 0 2.5H6.5M10.7 12v5h1c2.7 0 2.7-5 0-5ZM15 17v-5h2.5M15 14.5h2"
          strokeWidth="1.1"
        />
      </g>
    </svg>
  );
});
export const SctExcel = forwardRef<SVGSVGElement, SctIconProps>(function SctExcel(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="excel"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="m7 11 5 7M12 11l-5 7M14 12h3M14 15h3M14 18h3" />
      </g>
    </svg>
  );
});
export const SctCsv = forwardRef<SVGSVGElement, SctIconProps>(function SctCsv(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="csv"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M7 11h10M7 14h10M7 17h10M10 11v6M14 11v6" />
      </g>
    </svg>
  );
});
export const SctImage = forwardRef<SVGSVGElement, SctIconProps>(function SctImage(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="image"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <circle cx="9" cy="11" r="1" />
        <path d="m7 18 3-4 2 2 2-3 3 5Z" />
      </g>
    </svg>
  );
});
export const SctDwg = forwardRef<SVGSVGElement, SctIconProps>(function SctDwg(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dwg"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="m7 18 5-8 5 8M9 15h6M12 10v9" />
      </g>
    </svg>
  );
});
export const SctDxf = forwardRef<SVGSVGElement, SctIconProps>(function SctDxf(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dxf"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M7 11h10v7H7ZM7 11l10 7M17 11l-10 7" />
      </g>
    </svg>
  );
});
export const SctIes = forwardRef<SVGSVGElement, SctIconProps>(function SctIes(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="ies"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M8 11h8M12 11v8M8 17h8M12 12c-6 5-3 8 0 6 3 2 6-1 0-6Z" />
      </g>
    </svg>
  );
});
export const SctBim = forwardRef<SVGSVGElement, SctIconProps>(function SctBim(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="bim"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="m12 10 5 3v5l-5 3-5-3v-5ZM7 13l5 3 5-3M12 16v5" />
      </g>
    </svg>
  );
});
export const SctZip = forwardRef<SVGSVGElement, SctIconProps>(function SctZip(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="zip"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M11 9h2M13 11h2M11 13h2M13 15h2M11 17h4v3h-4Z" />
      </g>
    </svg>
  );
});
export const SctFile = forwardRef<SVGSVGElement, SctIconProps>(function SctFile(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="file"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M8 12h8M8 16h5" />
      </g>
    </svg>
  );
});
export const SctFolder = forwardRef<SVGSVGElement, SctIconProps>(function SctFolder(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="folder"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
      </g>
    </svg>
  );
});
export const SctAttachment = forwardRef<SVGSVGElement, SctIconProps>(function SctAttachment(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="attachment"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m9 8 5-5c5-3 10 3 6 7L9 21c-5 4-10-2-6-6L14 4M8 15l7-7c2-2 4 1 2 3l-7 7" />
      </g>
    </svg>
  );
});
export const SctLink = forwardRef<SVGSVGElement, SctIconProps>(function SctLink(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="link"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m10 7 3-3c6-5 12 2 7 7l-3 3M14 17l-3 3c-6 5-12-2-7-7l3-3M8 16l8-8" />
      </g>
    </svg>
  );
});
export const SctPresentation = forwardRef<SVGSVGElement, SctIconProps>(function SctPresentation(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="presentation"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="13" rx="1.5" />
        <path d="M12 16v6M8 22l4-3 4 3M6 12l4-4 4 2 4-4" />
      </g>
    </svg>
  );
});
export const SctAdd = forwardRef<SVGSVGElement, SctIconProps>(function SctAdd(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="add"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 7v10M7 12h10" />
      </g>
    </svg>
  );
});
export const SctEdit = forwardRef<SVGSVGElement, SctIconProps>(function SctEdit(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="edit"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m5 15 10-10 4 4L9 19l-5 1Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m5 15 10-10 4 4L9 19l-5 1ZM12 8l4 4M5 15l4 4M15 5l2-2 4 4-2 2" />
      </g>
    </svg>
  );
});
export const SctSave = forwardRef<SVGSVGElement, SctIconProps>(function SctSave(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="save"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-8h10v8M14 5v2" />
      </g>
    </svg>
  );
});
export const SctClose = forwardRef<SVGSVGElement, SctIconProps>(function SctClose(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="close"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m8 8 8 8M16 8l-8 8" />
      </g>
    </svg>
  );
});
export const SctDelete = forwardRef<SVGSVGElement, SctIconProps>(function SctDelete(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="delete"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </g>
    </svg>
  );
});
export const SctRemove = forwardRef<SVGSVGElement, SctIconProps>(function SctRemove(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="remove"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="9" />
        <path d="M7 12h10" />
      </g>
    </svg>
  );
});
export const SctArchive = forwardRef<SVGSVGElement, SctIconProps>(function SctArchive(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="archive"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="5" rx="1.5" />
        <path d="M4 8v13h16V8M9 12h6" />
      </g>
    </svg>
  );
});
export const SctRestore = forwardRef<SVGSVGElement, SctIconProps>(function SctRestore(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="restore"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 4h18v5H3ZM5 9v12h14V9M12 18v-6m-3 3 3-3 3 3" />
      </g>
    </svg>
  );
});
export const SctDuplicate = forwardRef<SVGSVGElement, SctIconProps>(function SctDuplicate(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="duplicate"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="2" width="14" height="15" rx="1.5" />
        <rect x="7" y="7" width="15" height="15" rx="1.5" />
        <path d="M14.5 11v7M11 14.5h7" />
      </g>
    </svg>
  );
});
export const SctCopy = forwardRef<SVGSVGElement, SctIconProps>(function SctCopy(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="copy"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="2" width="14" height="15" rx="1.5" />
        <rect x="7" y="7" width="15" height="15" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctPreview = forwardRef<SVGSVGElement, SctIconProps>(function SctPreview(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="preview"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  );
});
export const SctOpen = forwardRef<SVGSVGElement, SctIconProps>(function SctOpen(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="open"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M10 3H3v18h18v-7M13 2h9v9M22 2 10 14" />
      </g>
    </svg>
  );
});
export const SctReveal = forwardRef<SVGSVGElement, SctIconProps>(function SctReveal(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="reveal"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M3 20 6 11h16l-3 9Z" />
      </g>
    </svg>
  );
});
export const SctDownload = forwardRef<SVGSVGElement, SctIconProps>(function SctDownload(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="download"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2v14m-5-5 5 5 5-5M3 16v5h18v-5" />
      </g>
    </svg>
  );
});
export const SctExport = forwardRef<SVGSVGElement, SctIconProps>(function SctExport(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="export"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M12 13h10m-3-3 3 3-3 3" />
      </g>
    </svg>
  );
});
export const SctUpload = forwardRef<SVGSVGElement, SctIconProps>(function SctUpload(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="upload"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 16V2m-5 5 5-5 5 5M3 16v5h18v-5" />
      </g>
    </svg>
  );
});
export const SctPrint = forwardRef<SVGSVGElement, SctIconProps>(function SctPrint(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="print"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="8" width="20" height="10" rx="1.5" />
        <path d="M6 8V2h12v6M6 14h12v8H6M17 11h2" />
      </g>
    </svg>
  );
});
export const SctRefresh = forwardRef<SVGSVGElement, SctIconProps>(function SctRefresh(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="refresh"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M21 9A9 9 0 0 0 5 5L2 8M2 3v5h5M3 15a9 9 0 0 0 16 4l3-3M22 21v-5h-5" />
      </g>
    </svg>
  );
});
export const SctSearch = forwardRef<SVGSVGElement, SctIconProps>(function SctSearch(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="search"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 7 7" />
      </g>
    </svg>
  );
});
export const SctFilter = forwardRef<SVGSVGElement, SctIconProps>(function SctFilter(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="filter"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 4h20l-8 9v7l-4 2V13Z" />
      </g>
    </svg>
  );
});
export const SctClear = forwardRef<SVGSVGElement, SctIconProps>(function SctClear(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="clear"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 4h20l-8 9v7l-4 2V13M16 16l6 6M22 16l-6 6" />
      </g>
    </svg>
  );
});
export const SctSort = forwardRef<SVGSVGElement, SctIconProps>(function SctSort(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="sort"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M7 21V3m-4 4 4-4 4 4M17 3v18m-4-4 4 4 4-4" />
      </g>
    </svg>
  );
});
export const SctColumns = forwardRef<SVGSVGElement, SctIconProps>(function SctColumns(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="columns"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="18" rx="1.5" />
        <path d="M8 3v18M16 3v18" />
      </g>
    </svg>
  );
});
export const SctMore = forwardRef<SVGSVGElement, SctIconProps>(function SctMore(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="more"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="4" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="20" cy="12" r="1.5" />
      </g>
    </svg>
  );
});
export const SctCompare = forwardRef<SVGSVGElement, SctIconProps>(function SctCompare(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="compare"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="8" height="18" rx="1.5" />
        <rect x="14" y="3" width="8" height="18" rx="1.5" />
        <path d="M5 8h2M17 8h2M5 13h2M17 13h2" />
      </g>
    </svg>
  );
});
export const SctPublish = forwardRef<SVGSVGElement, SctIconProps>(function SctPublish(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="publish"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m2 10 20-8-8 20-3-9ZM11 13l11-11" />
      </g>
    </svg>
  );
});
export const SctIssue = forwardRef<SVGSVGElement, SctIconProps>(function SctIssue(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="issue"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10" />
        <path d="m8 15 3 3 5-5" />
      </g>
    </svg>
  );
});
export const SctGenerate = forwardRef<SVGSVGElement, SctIconProps>(function SctGenerate(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="generate"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="M9 13h6M12 10v6M8 19h8" />
      </g>
    </svg>
  );
});
export const SctVerify = forwardRef<SVGSVGElement, SctIconProps>(function SctVerify(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="verify"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path
          d="M12 2 21 6v7c0 5-9 9-9 9S3 18 3 13V6Z"
          fill="currentColor"
          fillOpacity=".14"
          stroke="none"
        />
        <path d="M12 2 21 6v7c0 5-9 9-9 9S3 18 3 13V6Z" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctCheck = forwardRef<SVGSVGElement, SctIconProps>(function SctCheck(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="check"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctSelectAll = forwardRef<SVGSVGElement, SctIconProps>(function SctSelectAll(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="select-all"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 6 2 2 3-4M11 6h10m-18 7 2 2 3-4M11 13h10m-18 7 2 2 3-4M11 20h10" />
      </g>
    </svg>
  );
});
export const SctFavorite = forwardRef<SVGSVGElement, SctIconProps>(function SctFavorite(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="favorite"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z" />
      </g>
    </svg>
  );
});
export const SctPin = forwardRef<SVGSVGElement, SctIconProps>(function SctPin(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="pin"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m9 2 10 10-4 1-4 5-5-5 5-4ZM8 16l-6 6" />
      </g>
    </svg>
  );
});
export const SctBack = forwardRef<SVGSVGElement, SctIconProps>(function SctBack(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="back"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m15 4-8 8 8 8" />
      </g>
    </svg>
  );
});
export const SctNext = forwardRef<SVGSVGElement, SctIconProps>(function SctNext(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="next"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m9 4 8 8-8 8" />
      </g>
    </svg>
  );
});
export const SctExpand = forwardRef<SVGSVGElement, SctIconProps>(function SctExpand(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="expand"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m4 8 8 8 8-8" />
      </g>
    </svg>
  );
});
export const SctCollapse = forwardRef<SVGSVGElement, SctIconProps>(function SctCollapse(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="collapse"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m4 16 8-8 8 8" />
      </g>
    </svg>
  );
});
export const SctDrag = forwardRef<SVGSVGElement, SctIconProps>(function SctDrag(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="drag"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="8" cy="5" r="1" />
        <circle cx="16" cy="5" r="1" />
        <circle cx="8" cy="12" r="1" />
        <circle cx="16" cy="12" r="1" />
        <circle cx="8" cy="19" r="1" />
        <circle cx="16" cy="19" r="1" />
      </g>
    </svg>
  );
});
export const SctEnable = forwardRef<SVGSVGElement, SctIconProps>(function SctEnable(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="enable"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2v10M7 5a9 9 0 1 0 10 0" />
      </g>
    </svg>
  );
});
export const SctQueue = forwardRef<SVGSVGElement, SctIconProps>(function SctQueue(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="queue"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3h18v5H3ZM3 10h18v5H3ZM3 17h18v5H3M6 5.5h2M6 12.5h2M6 19.5h2" />
      </g>
    </svg>
  );
});
export const SctInspect = forwardRef<SVGSVGElement, SctIconProps>(function SctInspect(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="inspect"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <circle cx="13" cy="14" r="3" />
        <path d="m15 16 5 5" />
      </g>
    </svg>
  );
});
export const SctMapping = forwardRef<SVGSVGElement, SctIconProps>(function SctMapping(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="mapping"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 3h6v5H2ZM16 3h6v5h-6ZM2 16h6v5H2ZM16 16h6v5h-6ZM8 5.5h4v13h4M8 18.5h4V5.5h4" />
      </g>
    </svg>
  );
});
export const SctReconcile = forwardRef<SVGSVGElement, SctIconProps>(function SctReconcile(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="reconcile"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M4 3v5c0 6 12 2 12 8v5M20 3v5c0 6-12 2-12 8v5m5-3 3 3 3-3" />
      </g>
    </svg>
  );
});
export const SctApply = forwardRef<SVGSVGElement, SctIconProps>(function SctApply(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="apply"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 6 2 2 3-4M11 6h10m-18 7 2 2 3-4M11 13h10m-18 7 2 2 3-4M11 20h10" />
      </g>
    </svg>
  );
});
export const SctSkip = forwardRef<SVGSVGElement, SctIconProps>(function SctSkip(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="skip"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 4 12 8-12 8ZM19 4v16" />
      </g>
    </svg>
  );
});
export const SctSources = forwardRef<SVGSVGElement, SctIconProps>(function SctSources(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="sources"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 6c0-5 18-5 18 0s-18 5-18 0ZM3 6v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0" />
      </g>
    </svg>
  );
});
export const SctImportHistory = forwardRef<SVGSVGElement, SctIconProps>(function SctImportHistory(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="import-history"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 3v18M5 6h5M5 12h8M5 18h5M13 6h7M16 12h4M13 18h7" />
        <circle cx="5" cy="6" r="1.5" />
        <circle cx="5" cy="18" r="1.5" />
      </g>
    </svg>
  );
});
export const SctWorkSession = forwardRef<SVGSVGElement, SctIconProps>(function SctWorkSession(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="work-session"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 6.5v6l4 2" />
        <path d="M9 1h6M12 1v3M19 4l2-2" />
      </g>
    </svg>
  );
});
export const SctToolSession = forwardRef<SVGSVGElement, SctIconProps>(function SctToolSession(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="tool-session"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="15" rx="1.5" />
        <path d="M8 22h8M12 18v4M2 7h20M5 5h1" />
      </g>
    </svg>
  );
});
export const SctAutocad = forwardRef<SVGSVGElement, SctIconProps>(function SctAutocad(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="autocad"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M4 21 12 2l8 19M7 15h10M9 10h6M3 21h5M16 21h5" />
      </g>
    </svg>
  );
});
export const SctDialux = forwardRef<SVGSVGElement, SctIconProps>(function SctDialux(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dialux"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </g>
    </svg>
  );
});
export const SctStart = forwardRef<SVGSVGElement, SctIconProps>(function SctStart(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="start"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m6 3 15 9-15 9Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m6 3 15 9-15 9Z" />
      </g>
    </svg>
  );
});
export const SctPause = forwardRef<SVGSVGElement, SctIconProps>(function SctPause(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="pause"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="5" y="3" width="4" height="18" rx="1.5" />
        <rect x="15" y="3" width="4" height="18" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctEnd = forwardRef<SVGSVGElement, SctIconProps>(function SctEnd(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="end"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="4" width="16" height="16" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctCapture = forwardRef<SVGSVGElement, SctIconProps>(function SctCapture(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="capture"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M1 13h12m-3-3 3 3-3 3" />
      </g>
    </svg>
  );
});
export const SctOutputActivity = forwardRef<SVGSVGElement, SctIconProps>(function SctOutputActivity(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="output-activity"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M1 12h5l3-9 5 18 3-9h6" />
      </g>
    </svg>
  );
});
export const SctDuration = forwardRef<SVGSVGElement, SctIconProps>(function SctDuration(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="duration"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 6.5v6l4 2" />
      </g>
    </svg>
  );
});
export const SctWorkload = forwardRef<SVGSVGElement, SctIconProps>(function SctWorkload(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="workload"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 3v18h19M7 17v-5h3v5M13 17V8h3v9M19 17V4h2v13" />
      </g>
    </svg>
  );
});
export const SctProductivity = forwardRef<SVGSVGElement, SctIconProps>(function SctProductivity(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="productivity"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 2v19h19M6 16l5-6 4 3 6-9M17 4h4v4" />
      </g>
    </svg>
  );
});
export const SctDistribution = forwardRef<SVGSVGElement, SctIconProps>(function SctDistribution(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="distribution"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2v10h10A10 10 0 0 0 12 2ZM9 4a9 9 0 1 0 11 11H9Z" />
      </g>
    </svg>
  );
});
export const SctDate = forwardRef<SVGSVGElement, SctIconProps>(function SctDate(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="date"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M7 2v6M17 2v6M3 10h18" />
        <path d="M7 14h3M14 14h3M7 18h3M14 18h3" />
      </g>
    </svg>
  );
});
export const SctDeadline = forwardRef<SVGSVGElement, SctIconProps>(function SctDeadline(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="deadline"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="5" width="18" height="16" rx="1.5" />
        <path d="M7 2v6M17 2v6M3 10h18" />
        <circle cx="15" cy="16" r="5" />
        <path d="M15 13v3l2 1" />
      </g>
    </svg>
  );
});
export const SctOverdue = forwardRef<SVGSVGElement, SctIconProps>(function SctOverdue(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="overdue"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 6.5v6l4 2" />
        <path d="M4 2 1 5M20 2l3 3M6 21l-2 2M18 21l2 2" />
      </g>
    </svg>
  );
});
export const SctNewProjects = forwardRef<SVGSVGElement, SctIconProps>(function SctNewProjects(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="new-projects"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M12 10v8M8 14h8" />
      </g>
    </svg>
  );
});
export const SctCompletedProjects = forwardRef<SVGSVGElement, SctIconProps>(
  function SctCompletedProjects(
    { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
    ref,
  ) {
    return (
      <svg
        data-sct-icon="completed-projects"
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={props['aria-label'] ? undefined : true}
        {...props}
      >
        <g transform="translate(1 1) scale(.916667)">
          <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
          <path d="M2.5 20V6h7l2 2H21v12Z" />
          <path d="m7 12 3.5 3.5L17 8" />
        </g>
      </svg>
    );
  },
);
export const SctManufacturer = forwardRef<SVGSVGElement, SctIconProps>(function SctManufacturer(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="manufacturer"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 22V7h8V2h10v20ZM6 10h2M6 14h2M6 18h2M14 6h3M14 10h3M14 14h3M14 18h3" />
      </g>
    </svg>
  );
});
export const SctFamily = forwardRef<SVGSVGElement, SctIconProps>(function SctFamily(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="family"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10" />
      </g>
    </svg>
  );
});
export const SctOrderingCode = forwardRef<SVGSVGElement, SctIconProps>(function SctOrderingCode(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="ordering-code"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 4v16M5 4v16M9 4v16M11 4v16M16 4v16M19 4v16M22 4v16" />
      </g>
    </svg>
  );
});
export const SctTag = forwardRef<SVGSVGElement, SctIconProps>(function SctTag(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="tag"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 3h11l9 9-10 10L2 12Z" />
        <circle cx="7" cy="8" r="1.5" />
      </g>
    </svg>
  );
});
export const SctCategory = forwardRef<SVGSVGElement, SctIconProps>(function SctCategory(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="category"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
        <circle cx="18" cy="6" r="4" />
        <path d="m6 14 5 8H1ZM15 14h7v8h-7Z" />
      </g>
    </svg>
  );
});
export const SctPower = forwardRef<SVGSVGElement, SctIconProps>(function SctPower(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="power"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M14 1 3 14h8l-1 9 11-14h-8Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 1 3 14h8l-1 9 11-14h-8Z" />
      </g>
    </svg>
  );
});
export const SctLumens = forwardRef<SVGSVGElement, SctIconProps>(function SctLumens(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="lumens"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </g>
    </svg>
  );
});
export const SctCct = forwardRef<SVGSVGElement, SctIconProps>(function SctCct(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="cct"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 8v10M18 5h3M18 9h2" />
        <circle cx="12" cy="18" r="1" />
      </g>
    </svg>
  );
});
export const SctCri = forwardRef<SVGSVGElement, SctIconProps>(function SctCri(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="cri"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2C1 2-1 20 9 22c5 1 2-5 5-6 3-1 8 3 8-4A10 10 0 0 0 12 2Z" />
        <circle cx="8" cy="7" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="15" cy="6" r="1" />
        <circle cx="19" cy="10" r="1" />
      </g>
    </svg>
  );
});
export const SctBeam = forwardRef<SVGSVGElement, SctIconProps>(function SctBeam(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="beam"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M7 3h10v4H7ZM10 7 3 21M14 7l7 14M12 9v11M6 18q6 5 12 0" />
      </g>
    </svg>
  );
});
export const SctIp = forwardRef<SVGSVGElement, SctIconProps>(function SctIp(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="ip"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path
          d="M12 2 21 6v7c0 5-9 9-9 9S3 18 3 13V6Z"
          fill="currentColor"
          fillOpacity=".14"
          stroke="none"
        />
        <path d="M12 2 21 6v7c0 5-9 9-9 9S3 18 3 13V6Z" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctMounting = forwardRef<SVGSVGElement, SctIconProps>(function SctMounting(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="mounting"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M6 8h12l3 5H3Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M12 2v6M6 8h12l3 5H3ZM7 17l-2 3M12 17v5M17 17l2 3" />
      </g>
    </svg>
  );
});
export const SctCutout = forwardRef<SVGSVGElement, SctIconProps>(function SctCutout(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="cutout"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M8 2H2v6M16 2h6v6M2 16v6h6M22 16v6h-6" />
        <circle cx="12" cy="12" r="5" />
      </g>
    </svg>
  );
});
export const SctDimensions = forwardRef<SVGSVGElement, SctIconProps>(function SctDimensions(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dimensions"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 7v14h14M3 7l3 3M3 7 0 10M17 21l-3-3M17 21l-3 3M7 3h14v14H7ZM11 3v3M16 3v3M21 8h-3M21 13h-3" />
      </g>
    </svg>
  );
});
export const SctDriver = forwardRef<SVGSVGElement, SctIconProps>(function SctDriver(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="driver"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M7 3v5M13 3v5M5 8h10v4a5 5 0 0 1-10 0ZM10 17v2a3 3 0 0 0 6 0v-6h5M19 10v6" />
      </g>
    </svg>
  );
});
export const SctControl = forwardRef<SVGSVGElement, SctIconProps>(function SctControl(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="control"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 6h20M2 12h20M2 18h20" />
        <rect x="6" y="3" width="3" height="6" rx="1.5" />
        <rect x="15" y="9" width="3" height="6" rx="1.5" />
        <rect x="8" y="15" width="3" height="6" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctEmergency = forwardRef<SVGSVGElement, SctIconProps>(function SctEmergency(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="emergency"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="6" width="18" height="13" rx="1.5" />
        <path d="M20 10h3v5h-3M12 8l-5 6h4l-1 3 5-6h-4Z" />
      </g>
    </svg>
  );
});
export const SctFinish = forwardRef<SVGSVGElement, SctIconProps>(function SctFinish(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="finish"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 14 11-11 7 7-11 11ZM11 6l7 7M4 18l-2 4 5-1" />
        <path d="m3 14 8-8 7 7-8 8Z" fill="currentColor" fillOpacity=".14" stroke="none" />
      </g>
    </svg>
  );
});
export const SctLifetime = forwardRef<SVGSVGElement, SctIconProps>(function SctLifetime(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="lifetime"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2h14M5 22h14M7 2v5l10 10v5M17 2v5L7 17v5M9 5h6M9 19h6" />
      </g>
    </svg>
  );
});
export const SctEfficacy = forwardRef<SVGSVGElement, SctIconProps>(function SctEfficacy(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="efficacy"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 18a10 10 0 1 1 18 0M6 16H4M20 16h-2M12 4v3M6 7l2 2M18 7l-2 2M12 15l5-5" />
        <circle cx="12" cy="15" r="1.5" />
      </g>
    </svg>
  );
});
export const SctQuantity = forwardRef<SVGSVGElement, SctIconProps>(function SctQuantity(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="quantity"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M9 2 6 22M18 2l-3 20M3 8h19M2 16h19" />
      </g>
    </svg>
  );
});
export const SctLightingDesign = forwardRef<SVGSVGElement, SctIconProps>(function SctLightingDesign(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="lighting-design"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M8 17c0-5-4-5-4-9a8 8 0 0 1 16 0c0 4-4 4-4 9ZM8 20h8M10 23h4M12 17V9m-3-2 3 2 3-2" />
      </g>
    </svg>
  );
});
export const SctLightingLayout = forwardRef<SVGSVGElement, SctIconProps>(function SctLightingLayout(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="lighting-layout"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="2" width="20" height="20" rx="1.5" />
        <path d="M2 13h8V2M15 22V10h7" />
        <circle cx="6" cy="7" r="1.5" />
        <circle cx="17" cy="6" r="1.5" />
        <circle cx="8" cy="18" r="1.5" />
      </g>
    </svg>
  );
});
export const SctCalculations = forwardRef<SVGSVGElement, SctIconProps>(function SctCalculations(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="calculations"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="2" width="16" height="20" rx="1.5" />
        <rect x="7" y="5" width="10" height="4" rx="1.5" />
        <path d="M7 13h3M8.5 11.5v3M14 13h3M7 18h3M14 17h3M14 19h3" />
      </g>
    </svg>
  );
});
export const Sct3d = forwardRef<SVGSVGElement, SctIconProps>(function Sct3d(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="3d"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 9 5v10l-9 5-9-5V7Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10" />
      </g>
    </svg>
  );
});
export const SctSite = forwardRef<SVGSVGElement, SctIconProps>(function SctSite(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="site"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 22S3 13 3 9a9 9 0 0 1 18 0c0 4-9 13-9 13Z" />
        <circle cx="12" cy="9" r="3" />
      </g>
    </svg>
  );
});
export const SctCoordination = forwardRef<SVGSVGElement, SctIconProps>(function SctCoordination(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="coordination"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="7" r="3" />
        <path d="M5 21v-3a7 7 0 0 1 14 0v3M8 20h8" />
        <path d="M3 5a3 3 0 0 0 0 6M21 5a3 3 0 0 1 0 6M1 20v-4l2-2M23 20v-4l-2-2" />
      </g>
    </svg>
  );
});
export const SctCommercial = forwardRef<SVGSVGElement, SctIconProps>(function SctCommercial(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="commercial"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M4 2h16v20l-4-2-4 2-4-2-4 2ZM8 6h8M8 10h8M8 14h4M8 17h8" />
      </g>
    </svg>
  );
});
export const SctNotes = forwardRef<SVGSVGElement, SctIconProps>(function SctNotes(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="notes"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="2" width="17" height="20" rx="1.5" />
        <path d="M1 6h6M1 12h6M1 18h6M10 7h7M10 11h7M10 15h5" />
      </g>
    </svg>
  );
});
export const SctPriority = forwardRef<SVGSVGElement, SctIconProps>(function SctPriority(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="priority"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M4 22V2M4 3h16l-4 5 4 5H4" />
      </g>
    </svg>
  );
});
export const SctExclusion = forwardRef<SVGSVGElement, SctIconProps>(function SctExclusion(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="exclusion"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.5 5.5l13 13" />
      </g>
    </svg>
  );
});
export const SctWorkspace = forwardRef<SVGSVGElement, SctIconProps>(function SctWorkspace(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="workspace"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="15" rx="1.5" />
        <path d="M8 22h8M12 18v4M2 7h20M5 5h1" />
      </g>
    </svg>
  );
});
export const SctFolderProfile = forwardRef<SVGSVGElement, SctIconProps>(function SctFolderProfile(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="folder-profile"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2.5 6h7l2 2H21v12H2.5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M2.5 20V6h7l2 2H21v12Z" />
        <path d="M7 11v6h10M7 14h10M12 11v6" />
      </g>
    </svg>
  );
});
export const SctBranding = forwardRef<SVGSVGElement, SctIconProps>(function SctBranding(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="branding"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 8 4v12l-8 4-8-4V6Z" />
        <path d="M8 15V9l4 3 4-3v6" />
      </g>
    </svg>
  );
});
export const SctProfile = forwardRef<SVGSVGElement, SctIconProps>(function SctProfile(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="profile"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="7" r="3" />
        <path d="M5 21v-3a7 7 0 0 1 14 0v3M8 20h8" />
      </g>
    </svg>
  );
});
export const SctSales = forwardRef<SVGSVGElement, SctIconProps>(function SctSales(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="sales"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="3" y="2" width="18" height="20" rx="1.5" />
        <circle cx="12" cy="8" r="2.5" />
        <path d="M7 17a5 5 0 0 1 10 0M8 20h8M1 6h4M1 12h4M1 18h4" />
      </g>
    </svg>
  );
});
export const SctClient = forwardRef<SVGSVGElement, SctIconProps>(function SctClient(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="client"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 22V7h8V2h10v20ZM6 10h2M6 14h2M6 18h2M14 6h3M14 10h3M14 14h3M14 18h3" />
      </g>
    </svg>
  );
});
export const SctEmail = forwardRef<SVGSVGElement, SctIconProps>(function SctEmail(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="email"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="4" width="20" height="16" rx="1.5" />
        <path d="m2 5 10 8L22 5M2 20l7-8M22 20l-7-8" />
      </g>
    </svg>
  );
});
export const SctPhone = forwardRef<SVGSVGElement, SctIconProps>(function SctPhone(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="phone"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m3 2 5 1 2 6-3 2c1 3 3 5 6 6l2-3 6 2 1 5C10 25-1 14 3 2Z" />
      </g>
    </svg>
  );
});
export const SctTimezone = forwardRef<SVGSVGElement, SctIconProps>(function SctTimezone(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="timezone"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M4 6h16M4 18h16M12 2c-7 7-7 13 0 20 7-7 7-13 0-20Z" />
      </g>
    </svg>
  );
});
export const SctBackup = forwardRef<SVGSVGElement, SctIconProps>(function SctBackup(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="backup"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M3 6c0-5 18-5 18 0s-18 5-18 0ZM3 6v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0" />
        <path d="M12 10v8m-3-3 3 3 3-3" />
      </g>
    </svg>
  );
});
export const SctRetention = forwardRef<SVGSVGElement, SctIconProps>(function SctRetention(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="retention"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="5" rx="1.5" />
        <path d="M4 8v13h16V8M9 12h6" />
      </g>
    </svg>
  );
});
export const SctIntegrations = forwardRef<SVGSVGElement, SctIconProps>(function SctIntegrations(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="integrations"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M7 3v5M13 3v5M5 8h10v4a5 5 0 0 1-10 0ZM10 17v2a3 3 0 0 0 6 0v-6h5M19 10v6" />
      </g>
    </svg>
  );
});
export const SctAppearance = forwardRef<SVGSVGElement, SctIconProps>(function SctAppearance(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="appearance"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2C1 2-1 20 9 22c5 1 2-5 5-6 3-1 8 3 8-4A10 10 0 0 0 12 2Z" />
        <circle cx="8" cy="7" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="15" cy="6" r="1" />
        <circle cx="19" cy="10" r="1" />
      </g>
    </svg>
  );
});
export const SctLight = forwardRef<SVGSVGElement, SctIconProps>(function SctLight(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="light"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </g>
    </svg>
  );
});
export const SctDark = forwardRef<SVGSVGElement, SctIconProps>(function SctDark(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="dark"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M16 2A10 10 0 1 0 22 16 10 10 0 0 1 16 2Z" />
      </g>
    </svg>
  );
});
export const SctSystem = forwardRef<SVGSVGElement, SctIconProps>(function SctSystem(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="system"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="2" y="3" width="20" height="15" rx="1.5" />
        <path d="M8 22h8M12 18v4M12 3v15" />
        <path d="M12 3h10v15H12Z" fill="currentColor" fillOpacity=".14" stroke="none" />
      </g>
    </svg>
  );
});
export const SctCamera = forwardRef<SVGSVGElement, SctIconProps>(function SctCamera(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="camera"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 7h5l2-4h6l2 4h5v14H2Z" />
        <circle cx="12" cy="13" r="4" />
        <path d="M18 9h1" />
      </g>
    </svg>
  );
});
export const SctSuccess = forwardRef<SVGSVGElement, SctIconProps>(function SctSuccess(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="success"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="10" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctWarning = forwardRef<SVGSVGElement, SctIconProps>(function SctWarning(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="warning"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 2 11 20H1ZM12 8v6M12 18v.2" />
      </g>
    </svg>
  );
});
export const SctError = forwardRef<SVGSVGElement, SctIconProps>(function SctError(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="error"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="10" />
        <path d="m8 8 8 8M16 8l-8 8" />
      </g>
    </svg>
  );
});
export const SctInfo = forwardRef<SVGSVGElement, SctIconProps>(function SctInfo(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="info"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 10v7M12 6v.2" />
      </g>
    </svg>
  );
});
export const SctDraft = forwardRef<SVGSVGElement, SctIconProps>(function SctDraft(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="draft"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M5 2.5h9l5 5v14H5Z" fill="currentColor" fillOpacity=".14" stroke="none" />
        <path d="M14 2.5H5v19h14v-14ZM14 2.5v5h5" />
        <path d="m8 17 6-6 2 2-6 6H8ZM13 12l2 2" />
      </g>
    </svg>
  );
});
export const SctPublished = forwardRef<SVGSVGElement, SctIconProps>(function SctPublished(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="published"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="m12 1 3 3 4 1 1 4 3 3-3 3-1 4-4 1-3 3-3-3-4-1-1-4-3-3 3-3 1-4 4-1Z" />
        <path d="m7 12 3.5 3.5L17 8" />
      </g>
    </svg>
  );
});
export const SctLocked = forwardRef<SVGSVGElement, SctIconProps>(function SctLocked(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="locked"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <rect x="4" y="10" width="16" height="12" rx="1.5" />
        <path d="M7 10V6a5 5 0 0 1 10 0v4M12 15v3" />
      </g>
    </svg>
  );
});
export const SctPending = forwardRef<SVGSVGElement, SctIconProps>(function SctPending(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="pending"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 6.5v6l4 2" />
      </g>
    </svg>
  );
});
export const SctLive = forwardRef<SVGSVGElement, SctIconProps>(function SctLive(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="live"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="2" />
        <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M3 3a13 13 0 0 0 0 18M21 3a13 13 0 0 1 0 18" />
      </g>
    </svg>
  );
});
export const SctClosed = forwardRef<SVGSVGElement, SctIconProps>(function SctClosed(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="closed"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="10" />
        <rect x="8" y="8" width="8" height="8" rx="1.5" />
      </g>
    </svg>
  );
});
export const SctDiscarded = forwardRef<SVGSVGElement, SctIconProps>(function SctDiscarded(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="discarded"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <circle cx="12" cy="12" r="9" />
        <path d="M5.5 5.5l13 13" />
      </g>
    </svg>
  );
});
export const SctOffline = forwardRef<SVGSVGElement, SctIconProps>(function SctOffline(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="offline"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M2 7a16 16 0 0 1 20 0M5 11a11 11 0 0 1 14 0M9 15a5 5 0 0 1 6 0M12 19v.2M2 2l20 20" />
      </g>
    </svg>
  );
});
export const SctLoading = forwardRef<SVGSVGElement, SctIconProps>(function SctLoading(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      data-sct-icon="loading"
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <g transform="translate(1 1) scale(.916667)">
        <path d="M12 2a10 10 0 1 1-10 10M2 8v-6h6" />
      </g>
    </svg>
  );
});
export const SctSend = forwardRef<SVGSVGElement, SctIconProps>(function SctSend(
  { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      data-sct-icon="send"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-label'] ? undefined : true}
      {...props}
    >
      <path d="m21 3-7 18-4-7-7-4Z" />
      <path d="m10 14 11-11" />
    </svg>
  );
});
export const sctIcons = {
  send: SctSend,
  dashboard: SctDashboard,
  projects: SctProjects,
  summary: SctSummary,
  timeline: SctTimeline,
  scope: SctScope,
  requirements: SctRequirements,
  deliverables: SctDeliverables,
  actions: SctActions,
  meetings: SctMeetings,
  comments: SctComments,
  contacts: SctContacts,
  library: SctLibrary,
  luminaires: SctLuminaires,
  systems: SctSystems,
  accessories: SctAccessories,
  datasheets: SctDatasheets,
  'technical-check': SctTechnicalCheck,
  'output-studio': SctOutputStudio,
  schedule: SctSchedule,
  boq: SctBoq,
  specifications: SctSpecifications,
  revisions: SctRevisions,
  packages: SctPackages,
  files: SctFiles,
  'smart-import': SctSmartImport,
  reports: SctReports,
  settings: SctSettings,
  pdf: SctPdf,
  excel: SctExcel,
  csv: SctCsv,
  image: SctImage,
  dwg: SctDwg,
  dxf: SctDxf,
  ies: SctIes,
  bim: SctBim,
  zip: SctZip,
  file: SctFile,
  folder: SctFolder,
  attachment: SctAttachment,
  link: SctLink,
  presentation: SctPresentation,
  add: SctAdd,
  edit: SctEdit,
  save: SctSave,
  close: SctClose,
  delete: SctDelete,
  remove: SctRemove,
  archive: SctArchive,
  restore: SctRestore,
  duplicate: SctDuplicate,
  copy: SctCopy,
  preview: SctPreview,
  open: SctOpen,
  reveal: SctReveal,
  download: SctDownload,
  export: SctExport,
  upload: SctUpload,
  print: SctPrint,
  refresh: SctRefresh,
  search: SctSearch,
  filter: SctFilter,
  clear: SctClear,
  sort: SctSort,
  columns: SctColumns,
  more: SctMore,
  compare: SctCompare,
  publish: SctPublish,
  issue: SctIssue,
  generate: SctGenerate,
  verify: SctVerify,
  check: SctCheck,
  'select-all': SctSelectAll,
  favorite: SctFavorite,
  pin: SctPin,
  back: SctBack,
  next: SctNext,
  expand: SctExpand,
  collapse: SctCollapse,
  drag: SctDrag,
  enable: SctEnable,
  queue: SctQueue,
  inspect: SctInspect,
  mapping: SctMapping,
  reconcile: SctReconcile,
  apply: SctApply,
  skip: SctSkip,
  sources: SctSources,
  'import-history': SctImportHistory,
  'work-session': SctWorkSession,
  'tool-session': SctToolSession,
  autocad: SctAutocad,
  dialux: SctDialux,
  start: SctStart,
  pause: SctPause,
  end: SctEnd,
  capture: SctCapture,
  'output-activity': SctOutputActivity,
  duration: SctDuration,
  workload: SctWorkload,
  productivity: SctProductivity,
  distribution: SctDistribution,
  date: SctDate,
  deadline: SctDeadline,
  overdue: SctOverdue,
  'new-projects': SctNewProjects,
  'completed-projects': SctCompletedProjects,
  manufacturer: SctManufacturer,
  family: SctFamily,
  'ordering-code': SctOrderingCode,
  tag: SctTag,
  category: SctCategory,
  power: SctPower,
  lumens: SctLumens,
  cct: SctCct,
  cri: SctCri,
  beam: SctBeam,
  ip: SctIp,
  mounting: SctMounting,
  cutout: SctCutout,
  dimensions: SctDimensions,
  driver: SctDriver,
  control: SctControl,
  emergency: SctEmergency,
  finish: SctFinish,
  lifetime: SctLifetime,
  efficacy: SctEfficacy,
  quantity: SctQuantity,
  'lighting-design': SctLightingDesign,
  'lighting-layout': SctLightingLayout,
  calculations: SctCalculations,
  '3d': Sct3d,
  site: SctSite,
  coordination: SctCoordination,
  commercial: SctCommercial,
  notes: SctNotes,
  priority: SctPriority,
  exclusion: SctExclusion,
  workspace: SctWorkspace,
  'folder-profile': SctFolderProfile,
  branding: SctBranding,
  profile: SctProfile,
  sales: SctSales,
  client: SctClient,
  email: SctEmail,
  phone: SctPhone,
  timezone: SctTimezone,
  backup: SctBackup,
  retention: SctRetention,
  integrations: SctIntegrations,
  appearance: SctAppearance,
  light: SctLight,
  dark: SctDark,
  system: SctSystem,
  camera: SctCamera,
  success: SctSuccess,
  warning: SctWarning,
  error: SctError,
  info: SctInfo,
  draft: SctDraft,
  published: SctPublished,
  locked: SctLocked,
  pending: SctPending,
  live: SctLive,
  closed: SctClosed,
  discarded: SctDiscarded,
  offline: SctOffline,
  loading: SctLoading,
} as const;
export type SctIconKey = keyof typeof sctIcons;
export { SctDashboard as LayoutDashboard };
export { SctProjects as FolderKanban };
export { SctSummary as Gauge };
export { SctTimeline as History };
export { SctScope as ClipboardList };
export { SctRequirements as ListChecks };
export { SctDeliverables as PackageCheck };
export { SctActions as SquareCheck };
export { SctMeetings as CalendarDays };
export { SctComments as MessageSquareText };
export { SctContacts as ContactRound };
export { SctLibrary as Library };
export { SctLuminaires as LampCeiling };
export { SctSystems as Network };
export { SctAccessories as Plug };
export { SctDatasheets as Files };
export { SctTechnicalCheck as ClipboardCheck };
export { SctOutputStudio as PanelsTopLeft };
export { SctSchedule as TableProperties };
export { SctBoq as ListOrdered };
export { SctSpecifications as FileSliders };
export { SctRevisions as GitCompareArrows };
export { SctPackages as Package };
export { SctFiles as FolderOpen };
export { SctSmartImport as FileInput };
export { SctReports as ChartNoAxesCombined };
export { SctSettings as Settings2 };
export { SctPdf as FileText };
export { SctExcel as FileSpreadsheet };
export { SctCsv as Table2 };
export { SctImage as Image };
export { SctDwg as DraftingCompass };
export { SctDxf as Ruler };
export { SctBim as Box };
export { SctZip as FileArchive };
export { SctFile as File };
export { SctFolder as Folder };
export { SctAttachment as Paperclip };
export { SctLink as Link2 };
export { SctPresentation as Presentation };
export { SctAdd as Plus };
export { SctEdit as Pencil };
export { SctSave as Save };
export { SctClose as X };
export { SctDelete as Trash2 };
export { SctRemove as CircleMinus };
export { SctArchive as Archive };
export { SctRestore as ArchiveRestore };
export { SctDuplicate as CopyPlus };
export { SctCopy as Copy };
export { SctPreview as Eye };
export { SctOpen as ExternalLink };
export { SctDownload as Download };
export { SctExport as FileOutput };
export { SctUpload as Upload };
export { SctPrint as Printer };
export { SctRefresh as RefreshCw };
export { SctSearch as Search };
export { SctFilter as ListFilter };
export { SctClear as FilterX };
export { SctSort as ArrowDownUp };
export { SctColumns as Columns3 };
export { SctMore as Ellipsis };
export { SctCompare as Columns2 };
export { SctSend as Send };
export { SctGenerate as FilePlus2 };
export { SctVerify as ShieldCheck };
export { SctCheck as Check };
export { SctFavorite as Star };
export { SctPin as Pin };
export { SctBack as ChevronLeft };
export { SctNext as ChevronRight };
export { SctExpand as ChevronDown };
export { SctCollapse as ChevronUp };
export { SctDrag as GripVertical };
export { SctEnable as Power };
export { SctInspect as FileSearch };
export { SctMapping as Waypoints };
export { SctReconcile as GitMerge };
export { SctSkip as SkipForward };
export { SctSources as Database };
export { SctWorkSession as Timer };
export { SctToolSession as AppWindow };
export { SctDialux as SunMedium };
export { SctStart as Play };
export { SctPause as Pause };
export { SctEnd as Square };
export { SctCapture as FolderInput };
export { SctOutputActivity as Activity };
export { SctDuration as Clock3 };
export { SctWorkload as ChartBar };
export { SctProductivity as ChartLine };
export { SctDistribution as ChartPie };
export { SctDate as CalendarRange };
export { SctDeadline as CalendarClock };
export { SctOverdue as AlarmClock };
export { SctNewProjects as FolderPlus };
export { SctCompletedProjects as FolderCheck };
export { SctManufacturer as Building2 };
export { SctFamily as Boxes };
export { SctOrderingCode as Barcode };
export { SctTag as Tags };
export { SctCategory as Shapes };
export { SctPower as Zap };
export { SctLumens as Sun };
export { SctCct as Thermometer };
export { SctCri as Palette };
export { SctCutout as Scan };
export { SctDriver as Cable };
export { SctControl as SlidersHorizontal };
export { SctEmergency as BatteryCharging };
export { SctFinish as Paintbrush };
export { SctLifetime as Hourglass };
export { SctQuantity as Hash };
export { SctLightingDesign as Lightbulb };
export { SctLightingLayout as LayoutTemplate };
export { SctCalculations as Calculator };
export { SctSite as MapPin };
export { SctCoordination as Users };
export { SctCommercial as ReceiptText };
export { SctNotes as NotebookPen };
export { SctPriority as Flag };
export { SctExclusion as CircleOff };
export { SctWorkspace as Monitor };
export { SctFolderProfile as FolderTree };
export { SctBranding as Badge };
export { SctProfile as UserRound };
export { SctEmail as Mail };
export { SctPhone as Phone };
export { SctTimezone as Globe2 };
export { SctBackup as DatabaseBackup };
export { SctDark as Moon };
export { SctSystem as MonitorCog };
export { SctCamera as Camera };
export { SctSuccess as CircleCheck };
export { SctWarning as TriangleAlert };
export { SctError as CircleX };
export { SctInfo as Info };
export { SctDraft as FilePenLine };
export { SctPublished as BadgeCheck };
export { SctLocked as LockKeyhole };
export { SctLive as Radio };
export { SctClosed as CircleStop };
export { SctOffline as WifiOff };
export { SctLoading as LoaderCircle };
export { SctPdf as FileDown };
export { SctContacts as Contact };
export { SctLuminaires as Lamp };
export { SctLuminaires as LampDesk };
export { SctLightingLayout as LayoutPanelTop };
export { SctReports as FileChartColumn };
export { SctPackages as PackagePlus };
export { SctCoordination as UsersRound };
export { SctActions as CheckSquare };
export { SctSettings as Settings };
export { SctComments as MessageSquare };
export { SctCommercial as Receipt };
export { SctVerify as Shield };
export { SctScope as Target };
export { SctRevisions as Layers };
export { SctIntegrations as Wrench };
export { SctDownload as CloudDownload };
export { SctFolderProfile as FolderCog };

/** Neutral concepts have their own drawings, distinct from file-format badges. */
function conceptIcon(name: string, geometry: React.ReactNode) {
  return forwardRef<SVGSVGElement, SctIconProps>(function ConceptIcon(
    { size = 24, absoluteStrokeWidth = false, strokeWidth = 1.5, ...props },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        data-sct-icon={name}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={props['aria-label'] ? undefined : true}
        {...props}
      >
        {geometry}
      </svg>
    );
  });
}
export const SctDocumentText = conceptIcon(
  'document-text',
  <>
    <path d="M5 3h9l5 5v13H5Z" />
    <path d="M14 3v5h5M8 12h8M8 16h8M8 19h4" />
  </>,
);
export const SctMeasure = conceptIcon(
  'measure',
  <>
    <path d="m3 16 13-13 5 5L8 21Z" />
    <path d="m7 12 2 2m1-5 3 3m0-6 2 2m1-5 2 2" />
  </>,
);
export const SctTargetPoint = conceptIcon(
  'target-point',
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <path d="M12 1v3m0 16v3M1 12h3m16 0h3" />
  </>,
);
export const SctLayerStack = conceptIcon(
  'layer-stack',
  <>
    <path d="m3 7 9-4 9 4-9 4ZM3 12l9 4 9-4M3 17l9 4 9-4" />
  </>,
);
