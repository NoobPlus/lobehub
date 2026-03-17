# Spotlight UI Design Spec

## Overview

Full UI design for the LobeChat Desktop Spotlight mini-window. Builds on the existing Spotlight shell (window lifecycle, IPC, MPA entry) with a rich input panel, model/plugin selection, and in-window conversation rendering.

## Requirements

- Textarea + Model/Plugin Chips + ShortcutBar layout (Kimi-style)
- Model selection via Electron `Menu.popup()` native menu
- Plugin chips (Web Search, Knowledge Base, etc.) as toggleable tags
- Two view states: input (680×120) → chat (680×480, single-step expand)
- In-window conversation with SpotlightMessage (lightweight, shiki code highlight)
- `type: 'panel'` window for native panel behavior (no NSPanel addon needed in v1)
- Smooth window resize via `setBounds({ animate: true })`
- "Open in main window" to continue conversation in full app

## Architecture

```
Electron BrowserWindow (type: 'panel')
  + setHiddenInMissionControl(true)
  + setVisibleOnAllWorkspaces(true)
  + setAlwaysOnTop(true, 'floating')
  + setBounds({ animate: true }) for resize
       │
       │ renders
       ▼
Spotlight Renderer (MPA entry)
  └─ SpotlightWindow
       ├─ State: 'input' | 'chat'
       │
       ├─ [MessageList]    (chat state only, React.lazy)
       │   - SpotlightMessage (lightweight renderer)
       │   - Internal scroll, fixed height region
       │
       ├─ [InputArea]      (always visible)
       │   - Textarea (auto-grow, 1-4 lines)
       │   - Model Chip (→ Menu.popup())
       │   - Plugin Chips (toggleable)
       │   - Attachment button (paste image)
       │
       └─ [ShortcutBar]    (always visible)
           - Context-aware keyboard hints
```

## Window Configuration

### appBrowsers.ts update

```typescript
spotlight: {
  identifier: 'spotlight',
  path: '/desktop/spotlight',
  keepAlive: true,
  showOnInit: false,
  skipSplash: true,
  skipTaskbar: true,
  type: 'panel',
  width: 680,
  height: 120,
}
```

### Post-creation setup

```typescript
win.setAlwaysOnTop(true, 'floating');
win.setHiddenInMissionControl(true);
win.setVisibleOnAllWorkspaces(true);
```

### Window sizing

| State | Size      | Trigger                                                   |
| ----- | --------- | --------------------------------------------------------- |
| input | 680 × 120 | Initial state                                             |
| chat  | 680 × 480 | First Enter send, one-time `setBounds({ animate: true })` |

Chat state uses internal scrolling for messages; no further window resize after initial expansion.

### Positioning with expand-aware boundary correction

`showAt(cursor)` reserves space for maximum height (480px) when calculating y position:

- If `cursor.y + 480 < screenBottom` → expand downward (normal)
- If `cursor.y + 480 >= screenBottom` → expand upward (window above cursor)

On expand:

- Downward: keep x,y, increase height
- Upward: y -= deltaHeight, window grows upward

### Blur behavior

| State     | Blur action    | Reason                                        |
| --------- | -------------- | --------------------------------------------- |
| input     | blur → hide    | No popups, blur means user clicked outside    |
| chat      | blur → no hide | User may switch to other window for reference |
| menu open | blur → no hide | Menu.popup() callback re-enables              |

Chat state close: `Esc` or re-press global hotkey.

### backgroundThrottling

Set to `true` (revised from original). Heavy components (markdown renderer, shiki) load only when visible + chat state via dynamic import. Hidden window is naturally throttled.

## UI Components

### InputArea

```
┌──────────────────────────────────────────┐
│  Tell me about the architecture...    📎  │  ← Textarea (auto-grow, max 4 lines)
│                                          │
│  [AI Default ▼] [🌐 Web Search] [📚 KB] │  ← Chips row
├──────────────────────────────────────────┤
│  Esc Close    ⌘V Paste Image  Enter Send │  ← ShortcutBar
└──────────────────────────────────────────┘
```

**Textarea:**

- Auto-growing height (1-4 lines), internal scroll beyond 4 lines
- Right-side attachment button (📎) for paste image (⌘V)
- `-webkit-app-region: no-drag`

**Model Chip:**

- Displays current model name + ▼ indicator
- Click: renderer calls `useEnabledChatModels()` to get model list, serializes to `{ label, value, group }[]`, sends via IPC `spotlight.openModelMenu(items)` to main process
- Main process builds `Menu` from the serialized items and calls `Menu.popup()`
- During menu display, blur→hide is suppressed via popup callback
- User selects → main process returns `{ model, provider }` via IPC response → renderer updates `currentModel`
- Note: `useEnabledChatModels()` is a renderer-side React hook reading `useAiInfraStore`; main process has no React environment and cannot call it directly

**Plugin Chips:**

- Toggleable tag buttons (Web Search, Knowledge Base, etc.)
- Active state: highlighted with accent color
- Source: enabled plugins from agent/global config

**ShortcutBar:**

- Fixed at bottom, shows context-aware keyboard hints
- Input state: `Esc Close` / `⌘V Paste` / `Enter Send`
- Chat state: `Esc Close` / `⌘N New Chat` / `Enter Send`

### ChatView (chat state)

```
┌──────────────────────────────────────────┐
│  [↗ Open in main window]                 │
│  ┌── MessageList (scrollable) ────────┐  │
│  │ You: Tell me about the arch...     │  │
│  │                                     │  │
│  │ AI: The project uses Next.js 16... │  │
│  │ ██████ (streaming)                  │  │
│  └─────────────────────────────────────┘  │
│                                          │
│  Continue the conversation...         📎  │  ← InputArea (collapses to single line)
│  [AI Default ▼] [🌐 Web Search]         │
├──────────────────────────────────────────┤
│  Esc Close      ⌘N New Chat  Enter Send  │
└──────────────────────────────────────────┘
```

**MessageList:**

- Uses `SpotlightMessage` component (see below)
- `overflow-y: auto`, fixed height region
- Auto-scroll to bottom on new messages

**"Open in main window" button:**

- Small button at top of MessageList
- Click → IPC `spotlight.expandToMain({ topicId })` → main window navigates to topic → spotlight hides

## SpotlightMessage (Lightweight Renderer)

### Design principle

Pure props-driven component, zero store dependency. Does NOT reuse main window `MessageContent` (which depends on full conversation store, tool UI, plugin rendering).

### Interface

```typescript
interface SpotlightMessageProps {
  content: string;
  loading?: boolean; // streaming indicator
  role: 'user' | 'assistant';
}
```

### Rendering capabilities

| Supported                                       | Not supported (v1)                         |
| ----------------------------------------------- | ------------------------------------------ |
| Markdown (headings, lists, bold, italic, links) | Tool call result custom UI (text fallback) |
| Code blocks + shiki syntax highlighting         | Image preview / gallery                    |
| Inline code                                     | Vote / edit / retry buttons                |
| Tables                                          | File attachment preview                    |
| Blockquotes                                     | Artifacts                                  |

Tool calls in spotlight display as text summary, not full Tool UI.

### Dependencies

- `react-markdown` — already in project
- `shiki` — already in project (`^3.21.0`), load common languages only (ts, js, python, bash, json, css, html)
- Zero store dependency, pure props

### Dynamic import strategy

- InputView components (Textarea, Chips, ShortcutBar): bundled immediately in spotlight entry
- SpotlightMessage + react-markdown + shiki: `React.lazy()` on first entry to chat state
- Loading state: skeleton placeholder during import

## State Management

### Spotlight Zustand slice (independent of main window store)

```typescript
interface SpotlightState {
  // Input
  inputValue: string;

  // View state
  viewState: 'input' | 'chat';

  // Model selection
  currentModel: { model: string; provider: string };

  // Active plugins
  activePlugins: string[];

  // Agent context (needed for topic creation and "open in main window")
  agentId: string; // default agent or last-used agent
  groupId?: string; // if group topic

  // Chat
  topicId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
}
```

### Data flows

**Send message:**

The send flow must be atomic — topic creation, user message, assistant message, and streaming are handled as a single transaction, consistent with the main window's `conversationLifecycle.ts` pattern (`sendMessageInServer` combines newTopic + newUserMessage + newAssistantMessage + runtime start). Spotlight should reuse or mirror this service layer to avoid orphaned topics on failure.

```
Enter pressed
  → viewState: 'input' → 'chat'
  → IPC: spotlight.resize({ width: 680, height: 480 })  // one-time expand
  → Call sendMessage service (atomic: topic + userMsg + assistantMsg + stream)
    - If no topicId yet: creates topic as part of the atomic operation
    - Optimistic: user message shown immediately
    - Stream chunks update assistant message content
  → SpotlightMessage renders stream content
  → Stream ends → notify main window to revalidate (see Cross-window sync)
  → On failure: error shown in chat area, no orphan topic created
```

The spotlight renderer needs access to the same TRPC/service endpoints as the main window. Since both renderers share the same Electron session (cookies, auth), TRPC calls work identically. The spotlight may either:

- Import a minimal subset of the chat service layer (preferred: reuse `chatService.createAssistantMessage` etc.)
- Or implement a thin wrapper that calls the same TRPC endpoints directly

**Model selection:**

```
Click model chip
  → Renderer calls useEnabledChatModels() to get model list
  → Serializes to plain objects: { items: [{ label, value, provider, group }] }
  → IPC: spotlight.openModelMenu({ items })
  → Main process builds Menu from serialized items (provider groups as separators)
  → Menu.popup() with blur suppression
  → User selects → callback returns { model, provider }
  → IPC response → renderer updates currentModel
```

**Open in main window:**

Navigation in the main window requires `agentId` + `topicId` (route: `/agent/:agentId?topic=:topicId`). Group topics additionally need `groupId`. The spotlight store must track the active agent context.

```
Click expand button
  → IPC: spotlight.expandToMain({ agentId, topicId, groupId? })
  → Main process: main window broadcast 'navigate' with full path
    - Agent topic: /agent/{agentId}?topic={topicId}
    - Group topic: /group/{groupId}?topic={topicId}
  → Main process: spotlight.hide()
```

**Cross-window sync:**

- DB as source of truth
- New IPC broadcast event `syncData` must be added to `@lobechat/electron-client-ipc` `MainBroadcastEvents`:

```typescript
// packages/electron-client-ipc/src/events/spotlight.ts
export interface SpotlightBroadcastEvents {
  spotlightFocus: () => void;
  syncData: (data: { keys: string[]; source: string }) => void;
}
```

- After spotlight writes messages to DB → renderer sends IPC `spotlight.notifySync({ keys })` to main process → main process broadcasts `syncData` to all other windows via `broadcastToOtherWindows`
- Receiving window's renderer listens via `useWatchBroadcast('syncData', ({ keys }) => { keys.forEach(k => mutate(k)) })`
- Keys are SWR cache keys (e.g. `['chat/messages', 'chat/topics']`)
- Fallback: SWR periodic revalidation (30s) ensures eventual consistency if broadcast lost
- This same mechanism benefits any future multi-window scenario, not just spotlight

## Error Handling

| Scenario                           | Handling                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Stream request fails               | Error message in chat area, user can retry or switch to main window        |
| No models configured               | Model chip shows "Not configured", click navigates to main window settings |
| Paste image but model lacks vision | Toast: "Current model does not support images"                             |
| Window position off-screen         | Validate `screen.getDisplayNearestPoint()` before each show                |
| Renderer crash                     | `render-process-gone` → resetReady → reload (already implemented)          |
| Rapid hotkey presses               | toggleSpotlight with debounce/lock to prevent show/hide race               |

## Relation to Existing Implementation

This spec builds on the already-committed Spotlight shell:

**Already implemented (keep as-is):**

- `appBrowsers.ts` spotlight definition (update: change height to 120, add `type: 'panel'`)
- `Browser.ts` extensions (showAt, whenReady, skipSplash — update: showAt uses max-height for boundary calc)
- `BrowserManager.ts` extensions (broadcastToOtherWindows, onboarding gate)
- `RendererUrlManager.ts` spotlight.html resolution
- `SpotlightCtr.ts` controller (update: blur strategy, model menu IPC, expand-aware resize)
- `electron-client-ipc` spotlightFocus event
- `spotlight.html` + `entry.spotlight.tsx` MPA entry
- `src/features/Spotlight/` shell (replace: InputBox → full InputArea, add ChatView)

**New in this spec:**

- `type: 'panel'` window configuration
- InputArea with Textarea, Model Chip, Plugin Chips, ShortcutBar
- ChatView with MessageList and SpotlightMessage
- SpotlightMessage lightweight renderer (react-markdown + shiki)
- Spotlight Zustand store slice
- Model selection via Menu.popup() IPC flow
- Expand-aware window positioning
- State-dependent blur behavior
