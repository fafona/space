type ShuangkouToolIconProps = {
  className?: string;
};

const jokerLetters = ["J", "O", "K", "E", "R"];

export default function ShuangkouToolIcon({ className = "" }: ShuangkouToolIconProps) {
  const cardClass =
    "absolute h-10 w-7 rounded-[5px] border border-red-200 bg-white shadow-sm";
  return (
    <span className={`relative block h-12 w-12 ${className}`} aria-hidden="true">
      <span className={`${cardClass} left-1.5 top-2 rotate-[-12deg]`}>
        <span className="absolute left-0.5 top-0.5 z-10 grid gap-0 text-[4.5px] font-black leading-[0.7] text-red-700">
          {jokerLetters.map((letter, index) => (
            <span key={`left-top-joker-${letter}-${index}`}>{letter}</span>
          ))}
        </span>
        <span
          className="absolute left-1/2 top-1/2 block h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/faolla-login-logo.png')" }}
        />
        <span className="absolute bottom-0.5 right-0.5 z-10 grid rotate-180 gap-0 text-[4.5px] font-black leading-[0.7] text-red-700">
          {jokerLetters.map((letter, index) => (
            <span key={`left-bottom-joker-${letter}-${index}`}>{letter}</span>
          ))}
        </span>
      </span>
      <span className={`${cardClass} left-4 top-1 rotate-[10deg]`}>
        <span className="absolute left-0.5 top-0.5 z-10 grid gap-0 text-[4.5px] font-black leading-[0.7] text-red-700">
          {jokerLetters.map((letter, index) => (
            <span key={`right-top-joker-${letter}-${index}`}>{letter}</span>
          ))}
        </span>
        <span
          className="absolute left-1/2 top-1/2 block h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/faolla-login-logo.png')" }}
        />
        <span className="absolute bottom-0.5 right-0.5 z-10 grid rotate-180 gap-0 text-[4.5px] font-black leading-[0.7] text-red-700">
          {jokerLetters.map((letter, index) => (
            <span key={`right-bottom-joker-${letter}-${index}`}>{letter}</span>
          ))}
        </span>
      </span>
    </span>
  );
}
