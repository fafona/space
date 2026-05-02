type ToolboxIconProps = {
  className?: string;
};

export default function ToolboxIcon({ className = "h-5 w-5" }: ToolboxIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="4.5" y="7" width="15" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 11.2h15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M10.1 11.2v1.1a1.1 1.1 0 0 0 1.1 1.1h1.6a1.1 1.1 0 0 0 1.1-1.1v-1.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
