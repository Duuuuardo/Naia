// Carregado só no cliente via lazy() em charts.tsx — não importar direto.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const BRAND = '#DD5973'
const FAILED = '#94a3b8'

export default function SendsAreaChart({
  rows,
  showFailed,
}: {
  rows: Array<{ label: string; sent: number; failed: number }>
  showFailed: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="sends-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={46}
        />
        <Tooltip
          cursor={{ stroke: BRAND, strokeOpacity: 0.25 }}
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          formatter={(value, name) => [
            Number(value).toLocaleString('pt-BR'),
            name === 'sent' ? 'Enviadas' : 'Falhas',
          ]}
        />
        <Area
          type="monotone"
          dataKey="sent"
          stroke={BRAND}
          strokeWidth={2}
          fill="url(#sends-fill)"
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        {showFailed && (
          <Area
            type="monotone"
            dataKey="failed"
            stroke={FAILED}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="transparent"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
