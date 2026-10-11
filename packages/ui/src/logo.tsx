export function NaiaIcon({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <img
      src="/brand/naia-mark.png"
      alt=""
      width={Math.round(size * 1.77)}
      height={size}
      className={`h-auto shrink-0 object-contain ${className}`}
      aria-hidden="true"
    />
  )
}

export function NaiaLogo({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <img
      src="/brand/naia-logo-dark.png"
      alt="Naia"
      width={Math.round(size * 5.16)}
      height={size}
      className={`h-auto w-auto object-contain ${className}`}
    />
  )
}

export function ProductBrand({
  product,
  size = 24,
  className = '',
}: {
  product: string
  size?: number
  className?: string
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
      <NaiaIcon size={size} />
      <span className="font-sans text-lg font-bold tracking-tight text-dark-800">
        {product}
      </span>
    </span>
  )
}
