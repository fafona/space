type TankBattleIconProps = {
  className?: string;
};

export default function TankBattleIcon({ className = "h-8 w-8" }: TankBattleIconProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden="true">
      <rect x="6" y="14" width="52" height="40" rx="10" fill="currentColor" opacity="0.18" />
      <path
        d="M16 40h31c5 0 9 4 9 9v1H8v-1c0-5 3-9 8-9Z"
        fill="currentColor"
        opacity="0.42"
      />
      <path
        d="M18 24h26c4.4 0 8 3.6 8 8v12H10V32c0-4.4 3.6-8 8-8Z"
        fill="currentColor"
      />
      <path d="M36 28h22a4 4 0 0 1 0 8H36v-8Z" fill="currentColor" />
      <rect x="18" y="18" width="19" height="18" rx="6" fill="white" opacity="0.9" />
      <path d="M23 27h9M27.5 22.5v9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M14 48h36"
        stroke="white"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="4 7"
        opacity="0.92"
      />
    </svg>
  );
}
