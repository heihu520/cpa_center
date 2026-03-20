import type {
  ActionResult,
  AccountFilter,
  AccountPage,
  AccountRecord,
  AppSettings,
  BulkAccountActionResult,
  CodexQuotaSnapshot,
  ConnectionResult,
  ConnectionsResponse,
  CreateConnectionResponse,
  ExportResult,
  InventorySyncResult,
  MaintainOptions,
  MaintainResult,
  ScanDetailPage,
  ScanSummary,
  SchedulerStatus,
  DashboardSnapshot,
} from '@/types'

interface ApiErrorPayload {
  error?: string
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as ApiErrorPayload
      if (payload?.error) {
        message = payload.error
      }
    } catch {
      // ignore parse failure
    }
    throw new Error(message)
  }

  return await response.json() as T
}

function withQuery(path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(path, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      return
    }
    url.searchParams.set(key, String(value))
  })
  return `${url.pathname}${url.search}`
}

export const api = {
  downloadExport: (kind: string, format: string) => {
    const url = new URL('/api/accounts/export', window.location.origin)
    url.searchParams.set('kind', kind)
    url.searchParams.set('format', format)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  },
  getConnections: () => request<ConnectionsResponse>('/api/connections'),
  createConnection: (name: string, settings: AppSettings) => request<CreateConnectionResponse>('/api/connections', { method: 'POST', body: JSON.stringify({ name, settings }) }),
  setActiveConnection: (connectionId: string) => request<ConnectionsResponse>('/api/connections/active', { method: 'POST', body: JSON.stringify({ connectionId }) }),
  renameConnection: (connectionId: string, name: string) => request<ConnectionsResponse>('/api/connections/rename', { method: 'POST', body: JSON.stringify({ connectionId, name }) }),
  deleteConnection: (connectionId: string) => request<ConnectionsResponse>('/api/connections/delete', { method: 'POST', body: JSON.stringify({ connectionId }) }),
  getSettings: () => request<AppSettings>('/api/settings'),
  saveSettings: (input: AppSettings) => request<AppSettings>('/api/settings', { method: 'POST', body: JSON.stringify(input) }),
  testConnection: (input: AppSettings) => request<ConnectionResult>('/api/settings/test', { method: 'POST', body: JSON.stringify(input) }),
  testAndSaveSettings: (input: AppSettings) => request<ConnectionResult>('/api/settings/test-and-save', { method: 'POST', body: JSON.stringify(input) }),
  getSchedulerStatus: () => request<SchedulerStatus>('/api/scheduler/status'),
  getDashboardSnapshot: () => request<DashboardSnapshot>('/api/dashboard'),
  getCodexQuotaSnapshot: () => request<CodexQuotaSnapshot>('/api/quotas'),
  listAccountsPage: (filter: AccountFilter, page: number, pageSize: number) => request<AccountPage>(withQuery('/api/accounts', {
    query: filter.query,
    state: filter.state,
    provider: filter.provider,
    type: filter.type,
    planType: filter.planType,
    disabled: filter.disabled,
    page,
    pageSize,
  })),
  syncInventory: () => request<InventorySyncResult>('/api/inventory/sync', { method: 'POST', body: '{}' }),
  deleteScanRun: (runId: number) => request<boolean>('/api/scan/delete', { method: 'POST', body: JSON.stringify({ runId }) }),
  getScanDetailsPage: (runId: number, page: number, pageSize: number) => request<ScanDetailPage>(withQuery('/api/scan/details', { runId, page, pageSize })),
  probeAccount: (name: string) => request<AccountRecord>('/api/accounts/probe-one', { method: 'POST', body: JSON.stringify({ name }) }),
  probeAccounts: (names: string[]) => request<BulkAccountActionResult>('/api/accounts/probe-many', { method: 'POST', body: JSON.stringify({ names }) }),
  setAccountDisabled: (name: string, disabled: boolean) => request<ActionResult>('/api/accounts/disable-one', { method: 'POST', body: JSON.stringify({ name, disabled }) }),
  setAccountsDisabled: (names: string[], disabled: boolean) => request<BulkAccountActionResult>('/api/accounts/disable-many', { method: 'POST', body: JSON.stringify({ names, disabled }) }),
  deleteAccount: (name: string) => request<ActionResult>('/api/accounts/delete-one', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteAccounts: (names: string[]) => request<BulkAccountActionResult>('/api/accounts/delete-many', { method: 'POST', body: JSON.stringify({ names }) }),
  exportAccounts: (kind: string, format: string, path = '') => request<ExportResult>('/api/accounts/export', { method: 'POST', body: JSON.stringify({ kind, format, path }) }),
  runScan: () => request<ScanSummary>('/api/scan/run', { method: 'POST', body: '{}' }),
  cancelScan: () => request<boolean>('/api/scan/cancel', { method: 'POST', body: '{}' }),
  runMaintain: (options: MaintainOptions) => request<MaintainResult>('/api/maintain/run', { method: 'POST', body: JSON.stringify(options) }),
}
