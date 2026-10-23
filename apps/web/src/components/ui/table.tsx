import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-xl border bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
const TableHeader = (p: React.ComponentProps<"thead">) => <thead {...p} className={cn("border-b bg-secondary/40", p.className)} />;
const TableBody = (p: React.ComponentProps<"tbody">) => <tbody {...p} className={cn("[&_tr:last-child]:border-0", p.className)} />;
const TableRow = (p: React.ComponentProps<"tr">) => <tr {...p} className={cn("border-b transition-colors hover:bg-accent/30", p.className)} />;
const TableHead = (p: React.ComponentProps<"th">) => (
  <th {...p} className={cn("h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground", p.className)} />
);
const TableCell = (p: React.ComponentProps<"td">) => <td {...p} className={cn("px-4 py-3 align-middle", p.className)} />;

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
