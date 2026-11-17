export default function GuestAvatar({className="h-11 w-11"}:{className?:string}) {
  return <span data-guest-avatar aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 ${className}`}>
    <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg>
  </span>;
}
