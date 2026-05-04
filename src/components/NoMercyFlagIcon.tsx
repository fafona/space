type NoMercyFlagIconProps = {
  className?: string;
};

export default function NoMercyFlagIcon({ className = "h-8 w-8" }: NoMercyFlagIconProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="16" fill="#0f766e" />
      <path d="M20 14v36" stroke="#f8fafc" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 16h24l-4 8 4 8H22V16Z" fill="#f8fafc" />
      <path d="M27 21h12M27 27h9" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
      <rect x="23" y="39" width="24" height="9" rx="4.5" fill="#facc15" />
      <path d="M28 43.5h14" stroke="#14532d" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
