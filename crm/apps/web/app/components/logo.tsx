import { ProductBrand } from '@naia/ui'

export function CrmLogo({ className = '', size = 26 }: { className?: string; size?: number }) {
  return <ProductBrand product="CRM" size={size} className={className} />
}
