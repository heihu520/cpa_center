type EventCallback = (payload: any) => void

interface ServerEnvelope {
  connectionId?: string
  data: any
}

interface ScreenInfo {
  width: number
  height: number
  isCurrent: boolean
  isPrimary: boolean
}

const listeners = new Map<string, Set<EventCallback>>()
const latestEventPayload = new Map<string, any>()
const scheduledEventNames = new Set<string>()
let eventSource: EventSource | null = null

function dispatchEventPayload(eventName: string, payload: any) {
  const handlers = listeners.get(eventName)
  if (!handlers) {
    return
  }
  handlers.forEach((handler) => handler(payload))
}

function queueEventPayload(eventName: string, payload: any) {
  latestEventPayload.set(eventName, payload)
  if (scheduledEventNames.has(eventName)) {
    return
  }
  scheduledEventNames.add(eventName)
  window.requestAnimationFrame(() => {
    scheduledEventNames.delete(eventName)
    const nextPayload = latestEventPayload.get(eventName)
    latestEventPayload.delete(eventName)
    dispatchEventPayload(eventName, nextPayload)
  })
}

function ensureEventSource() {
  if (eventSource) {
    return
  }
  eventSource = new EventSource('/api/events')
  eventSource.onopen = () => {
    // noop
  }
  eventSource.onerror = () => {
    // EventSource reconnects automatically.
  }

  const eventNames = [
    'scan:log',
    'maintain:log',
    'inventory:log',
    'quota:log',
    'scan:progress',
    'maintain:progress',
    'inventory:progress',
    'quota:progress',
    'quota:snapshot',
    'task:finished',
    'scheduler:status',
    'account:update',
  ]

  const throttledEvents = new Set([
    'scan:progress',
    'maintain:progress',
    'inventory:progress',
    'quota:progress',
    'scheduler:status',
    'quota:snapshot',
    'account:update',
  ])

  eventNames.forEach((eventName) => {
    eventSource?.addEventListener(eventName, (event) => {
      const messageEvent = event as MessageEvent<string>
      let payload: any = messageEvent.data
      try {
        payload = JSON.parse(messageEvent.data) as ServerEnvelope
      } catch {
        // keep raw string
      }
      const unwrappedPayload = payload && typeof payload === 'object' && 'data' in payload
        ? {
            ...(payload as ServerEnvelope).data,
            connectionId: (payload as ServerEnvelope).connectionId,
          }
        : payload
      if (throttledEvents.has(eventName)) {
        queueEventPayload(eventName, unwrappedPayload)
        return
      }
      dispatchEventPayload(eventName, unwrappedPayload)
    })
  })
}

export function EventsOn(eventName: string, handler: EventCallback) {
  ensureEventSource()
  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set())
  }
  listeners.get(eventName)?.add(handler)
}

export function EmitScopedContextChange() {
  latestEventPayload.clear()
  scheduledEventNames.clear()
}

export function EventsOff(eventName: string) {
  listeners.delete(eventName)
  latestEventPayload.delete(eventName)
  scheduledEventNames.delete(eventName)
}

export async function ClipboardSetText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export async function ScreenGetAll(): Promise<ScreenInfo[]> {
  return [{
    width: window.screen.availWidth || window.innerWidth,
    height: window.screen.availHeight || window.innerHeight,
    isCurrent: true,
    isPrimary: true,
  }]
}

export function WindowSetLightTheme() {
  document.documentElement.style.colorScheme = 'light'
}

export function WindowSetMinSize(minWidth: number, minHeight: number) {
  document.documentElement.style.setProperty('--app-min-width', `${minWidth}px`)
  document.documentElement.style.setProperty('--app-min-height', `${minHeight}px`)
}

export function LogDebug(message: string) {
  console.debug(message)
}

export function LogError(message: string) {
  console.error(message)
}
