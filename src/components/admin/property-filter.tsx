"use client";

import type { Id } from "@convex/_generated/dataModel";
import { usePropertyScope } from "@/components/app/property-scope";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

/**
 * A "Property" filter for list screens. It's the same choice as the picker
 * at the top of the screen (they always agree), so every screen follows it.
 * Hidden when the organisation has a single property.
 */
export function PropertyFilter({ className }: { className?: string }) {
  const { properties, current, choose } = usePropertyScope();
  if (properties.length <= 1) return null;
  return (
    <div className={cn("sm:w-52", className)}>
      <NativeSelect
        aria-label="Property"
        value={current?.propertyId ?? ""}
        onChange={(e) =>
          choose(
            e.target.value === "" ? null : (e.target.value as Id<"properties">),
          )
        }
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.propertyId} value={p.propertyId}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
