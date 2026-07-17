import type { SVGProps } from 'react'

const brandColor = '#DD5973'
const darkColor = '#3D4355'
const whiteColor = '#ffffff'

/** Logotipo completo (ícone + wordmark) — mesma marca de docs/design.md, portado de packages/ui do legado. */
export function NaiaLogo({
  color = 'brand',
  ...props
}: SVGProps<SVGSVGElement> & { color?: 'default' | 'white' | 'brand' }) {
  const wordmarkFill = color === 'white' ? whiteColor : darkColor

  return (
    <svg viewBox="0 0 260 80" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M8 62 C8 62 8 18 34 18 C52 18 52 44 52 44 C52 44 52 62 70 62 C88 62 96 44 96 26"
        stroke={brandColor}
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text
        x="110"
        y="58"
        fontFamily="Plus Jakarta Sans, Inter, sans-serif"
        fontWeight="700"
        fontSize="52"
        fill={wordmarkFill}
        letterSpacing="-1"
      >
        Naia
      </text>
      <circle cx="193" cy="15" r="5" fill={brandColor} />
    </svg>
  )
}
