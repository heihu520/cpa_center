import { defineStore } from 'pinia'
import { api } from '@/lib/web-api'
import type {
  AccountFilter,
  AccountPage,
  AccountRecord,
  BulkAccountActionResult,
  DashboardSnapshot,
  DashboardSummary,
  ExportResult,
  InventorySyncResult,
  ScanDetailPage,
  ScanSummary,
} from '@/types'
import { toErrorMessage } from '@/utils/errors'
import { useSettingsStore } from '@/stores/settings'

interface AccountsState {
  records: AccountRecord[]
  totalRecords: number
  providerOptions: string[]
  planOptions: string[]
  query: string
  stateFilter: string
  providerFilter: string
  planFilter: string
  disabledFilter: boolean | null
  page: number
  pageSize: number
  summary: DashboardSummary
  history: ScanSummary[]
  scanDetail: ScanDetailPage | null
  loading: boolean
  pageLoading: boolean
}

function emptySummary(): DashboardSummary {
  return {
    totalAccounts: 0,
    filteredAccounts: 0,
    pendingCount: 0,
    normalCount: 0,
    invalid401Count: 0,
    quotaLimitedCount: 0,
    recoveredCount: 0,
    errorCount: 0,
    lastScanAt: '',
  }
}

function updateCurrentPageRecord(records: AccountRecord[], record: AccountRecord) {
  const index = records.findIndex((item) => item.name === record.name)
  if (index >= 0) {
    const next = [...records]
    next[index] = record
    return next
  }
  return records
}

function normalizeFilterText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export const useAccountsStore = defineStore('accountsStore', {
  state: (): AccountsState => ({
    records: [],
    totalRecords: 0,
    providerOptions: [],
    planOptions: [],
    query: '',
    stateFilter: '',
    providerFilter: '',
    planFilter: '',
    disabledFilter: null,
    page: 1,
    pageSize: 20,
    summary: emptySummary(),
    history: [],
    scanDetail: null,
    loading: false,
    pageLoading: false,
  }),
  getters: {
    hasInventory: (state) => state.summary.totalAccounts > 0,
    needsInitialScan: (state) => state.summary.filteredAccounts > 0 && !state.summary.lastScanAt,
    currentFilter: (state): AccountFilter => ({
      query: normalizeFilterText(state.query),
      state: normalizeFilterText(state.stateFilter),
      provider: normalizeFilterText(state.providerFilter),
      type: '',
      planType: normalizeFilterText(state.planFilter),
      ...(state.disabledFilter === null ? {} : { disabled: state.disabledFilter }),
    }),
  },
  actions: {
    async refreshDashboard() {
      const snapshot = await api.getDashboardSnapshot()
      this.summary = snapshot.summary
      this.history = Array.isArray(snapshot.history) ? snapshot.history : []
      return snapshot
    },
    async loadAccountsPage(options?: { page?: number; pageSize?: number; resetPage?: boolean }) {
      const settingsStore = useSettingsStore()
      if (options?.pageSize) {
        this.pageSize = options.pageSize
      }
      if (options?.resetPage) {
        this.page = 1
      }
      if (options?.page) {
        this.page = options.page
      }

      this.pageLoading = true
      try {
        const page = await api.listAccountsPage(
          {
            ...this.currentFilter,
            type: settingsStore.settings.targetType || '',
          },
          this.page,
          this.pageSize,
        ) as unknown as AccountPage
        this.records = Array.isArray(page.records) ? page.records : []
        this.totalRecords = page.totalRecords
        this.page = page.page
        this.pageSize = page.pageSize
        this.providerOptions = Array.isArray(page.providerOptions) ? page.providerOptions : []
        this.planOptions = Array.isArray(page.planOptions) ? page.planOptions : []
        return page
      } finally {
        this.pageLoading = false
      }
    },
    async refreshAll() {
      this.loading = true
      try {
        await this.refreshDashboard()
        await this.loadAccountsPage()
      } finally {
        this.loading = false
      }
    },
    async syncInventory() {
      return await api.syncInventory()
    },
    async loadScanDetail(runId: number, page = 1, pageSize = 20) {
      const detail = await api.getScanDetailsPage(runId, page, pageSize)
      this.scanDetail = {
        ...detail,
        records: Array.isArray(detail.records) ? detail.records : [],
      }
      return this.scanDetail
    },
    async probeAccount(name: string) {
      try {
        const record = await api.probeAccount(name)
        this.records = updateCurrentPageRecord(this.records, record)
        await this.refreshDashboard()
        await this.loadAccountsPage()
        return record
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async probeAccounts(names: string[]) {
      try {
        return await api.probeAccounts(names)
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async setAccountDisabled(name: string, disabled: boolean) {
      try {
        return await api.setAccountDisabled(name, disabled)
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async setAccountsDisabled(names: string[], disabled: boolean) {
      try {
        return await api.setAccountsDisabled(names, disabled)
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async deleteAccount(name: string) {
      try {
        return await api.deleteAccount(name)
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async deleteAccounts(names: string[]) {
      try {
        return await api.deleteAccounts(names)
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async deleteScanRun(runId: number) {
      try {
        await api.deleteScanRun(runId)
        if (this.scanDetail?.summary.runId === runId) {
          this.scanDetail = null
        }
        await this.refreshDashboard()
        return true
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
    async exportRecords(kind: 'invalid401' | 'quotaLimited', format: 'json' | 'csv') {
      try {
        api.downloadExport(kind, format)
        return { kind, format, path: '', exported: 0 }
      } catch (error) {
        throw new Error(toErrorMessage(error))
      }
    },
  },
})
