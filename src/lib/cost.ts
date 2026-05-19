import type { BillingBreakdown, Session, Stage, ToolCall } from '@/types'
import { formatCost } from './format'

type CostTranslator = (key: string, params?: Record<string, string | number>) => string

export function apiEquivalentFor(item: Session | Stage | ToolCall): number {
  if ('costEstimate' in item && item.costEstimate) return item.costEstimate.apiEquivalentUsd
  if ('apiEquivalentUsd' in item && typeof item.apiEquivalentUsd === 'number') return item.apiEquivalentUsd
  return item.costUsd ?? 0
}

export function billableFor(item: Session | Stage | ToolCall): number {
  if ('billing' in item && item.billing) return item.billing.actualBillableUsd
  if ('billableUsd' in item && typeof item.billableUsd === 'number') return item.billableUsd
  return item.costUsd ?? 0
}

export function billingTitle(billing?: BillingBreakdown, t?: CostTranslator): string {
  if (!billing) return t ? t('cost.unknown_billing') : 'cost.unknown_billing'
  const key = (() => {
    switch (billing.payer) {
      case 'subscription':
        return 'cost.included_in_subscription'
      case 'api':
        return 'cost.api_billed'
      case 'extra-usage':
        return 'cost.extra_usage'
      case 'mixed':
        return 'cost.mixed_billing'
      default:
        return 'cost.unknown_billing'
    }
  })()
  return t ? t(key) : key
}

export function billingValue(billing?: BillingBreakdown, t?: CostTranslator): string {
  if (!billing) return t ? t('cost.unknown') : 'cost.unknown'
  if (billing.actualBillableUsd > 0) return formatCost(billing.actualBillableUsd)
  if (billing.payer === 'subscription') return t ? t('cost.included') : 'cost.included'
  if (billing.payer === 'unknown') return t ? t('cost.unknown') : 'cost.unknown'
  if (billing.unknownUsdEquivalent > 0) return t ? t('cost.unknown') : 'cost.unknown'
  return formatCost(0)
}

export function billingSubtext(billing?: BillingBreakdown, t?: CostTranslator): string {
  if (!billing) return t ? t('cost.no_billing_metadata') : 'cost.no_billing_metadata'
  const parts: string[] = []
  if (billing.includedUsdEquivalent > 0) {
    const value = formatCost(billing.includedUsdEquivalent)
    parts.push(t ? t('cost.plan_value', { value }) : `${value} plan value`)
  }
  if (billing.extraUsageUsd > 0) {
    const value = formatCost(billing.extraUsageUsd)
    parts.push(t ? t('cost.extra_value', { value }) : `${value} extra`)
  }
  if (billing.apiBilledUsd > 0) {
    const value = formatCost(billing.apiBilledUsd)
    parts.push(t ? t('cost.api_value', { value }) : `${value} API`)
  }
  if (billing.unknownUsdEquivalent > 0) {
    const value = formatCost(billing.unknownUsdEquivalent)
    parts.push(t ? t('cost.unknown_value', { value }) : `${value} unknown`)
  }
  if (parts.length === 0) {
    parts.push(t ? t('cost.confidence', { confidence: billing.confidence }) : `${billing.confidence} confidence`)
  }
  return parts.join(' · ')
}

export function billingTitleKey(billing?: BillingBreakdown): string {
  if (!billing) return 'cost.unknown_billing'
  switch (billing.payer) {
    case 'subscription':
      return 'cost.included_in_subscription'
    case 'api':
      return 'cost.api_billed'
    case 'extra-usage':
      return 'cost.extra_usage'
    case 'mixed':
      return 'cost.mixed_billing'
    default:
      return 'cost.unknown_billing'
  }
}
