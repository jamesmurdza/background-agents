/** Paddle's "P" mark. Brand color is fixed, so it ignores text color. */
export function PaddleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#1E1C3F" />
      <path
        fill="#FFFFFF"
        d="M8 6h5.2c2.98 0 5.1 2.02 5.1 4.9 0 2.88-2.12 4.9-5.1 4.9H10.6V18H8V6zm2.6 2.3v5.2h2.5c1.6 0 2.6-1.08 2.6-2.6s-1-2.6-2.6-2.6h-2.5z"
      />
    </svg>
  )
}
