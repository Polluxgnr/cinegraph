"use client";

import { useState } from "react";

/** Half-star rating input, 0.5–5, like Letterboxd. */
export default function Stars({
  value,
  onChange,
  size = 28,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = shown >= i ? 1 : shown >= i - 0.5 ? 0.5 : 0;
        return (
          <div key={i} className="relative" style={{ width: size, height: size }}>
            <svg viewBox="0 0 24 24" width={size} height={size} className="text-line">
              <path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" />
            </svg>
            <div className="absolute inset-0 overflow-hidden text-accent" style={{ width: `${fill * 100}%` }}>
              <svg viewBox="0 0 24 24" width={size} height={size}>
                <path fill="currentColor" d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5L2.5 9.3l6.6-.8z" />
              </svg>
            </div>
            {onChange && (
              <>
                <button
                  aria-label={`${i - 0.5} stars`}
                  className="absolute inset-y-0 left-0 w-1/2"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={() => onChange(i - 0.5)}
                />
                <button
                  aria-label={`${i} stars`}
                  className="absolute inset-y-0 right-0 w-1/2"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onChange(i)}
                />
              </>
            )}
          </div>
        );
      })}
      {value != null && <span className="ml-2 text-sm text-muted">{value}</span>}
    </div>
  );
}
