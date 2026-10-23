import { cn } from "@/lib/utils";

/** The official Smart Campus mark (docs/smart-campus-logo.svg, served as /logo.svg). */
export function Logo({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="" aria-hidden className={cn("size-7", className)} />;
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="text-[15px] font-semibold tracking-tight">Smart Campus</span>
    </span>
  );
}
