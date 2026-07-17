export function NaiaIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* ondas estilizadas — mensagens em movimento */}
      <path
        d="M4 20c4-7 8-7 12 0s8 7 12 0"
        stroke="#DD5973"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M4 12c4-7 8-7 12 0s8 7 12 0"
        stroke="#3D4355"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  )
}

export function NaiaLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <NaiaIcon size={size} />
      <span
        className="font-sans font-bold tracking-tight text-dark-800"
        style={{ fontSize: size * 0.82 }}
      >
        na<span className="relative">
          ı<span
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-brand-500"
            style={{
              width: size * 0.14,
              height: size * 0.14,
              top: -size * 0.02,
            }}
          />
        </span>a
      </span>
    </span>
  )
}
