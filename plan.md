# File Upload Feature Implementation Plan

## Overview
Allow users to drag files onto the prompt bar, preview them, and upload them to the sandbox when sending a message. The agent will be informed of the uploaded file paths.

## Implementation Steps

### 1. Extend Types (`lib/types.ts`)
- Add `PendingFile` interface for files waiting to be uploaded:
  ```typescript
  interface PendingFile {
    id: string
    file: File
    name: string
    size: number
  }
  ```
- No need to extend Message type - we'll inject file paths into the prompt text invisibly

### 2. Create Upload API Endpoint (`app/api/sandbox/upload/route.ts`)
- Accept: `sandboxId`, `files` (as FormData with file blobs)
- Use Daytona SDK `sandbox.fs.uploadFile()` to upload each file
- Upload to `/home/daytona/uploads/` directory in sandbox
- Return: array of uploaded file paths

### 3. Update ChatPanel Component
- Add state: `pendingFiles: PendingFile[]`
- Add drag-and-drop handlers on the input container:
  - `onDragOver` - show drop zone indicator
  - `onDragLeave` - hide indicator
  - `onDrop` - add files to pendingFiles state
- Display pending files as small chips/tags below the textarea
- Each file chip has an X button to remove
- Update `canSend` logic to allow sending with files even if no text

### 4. Update Send Flow
- Modify `handleSend()` in ChatPanel:
  1. If there are pending files, upload them first via `/api/sandbox/upload`
  2. Append file paths to the message content (hidden from display but sent to agent):
     ```
     [User's message]

     ---
     Uploaded files:
     - /home/daytona/uploads/file1.png
     - /home/daytona/uploads/document.pdf
     ```
  3. Clear pendingFiles state
  4. Call onSendMessage with the enhanced prompt

### 5. Update useChat Hook
- Modify `sendMessage` to accept optional `uploadedFilePaths: string[]`
- If files were uploaded, include them in the prompt sent to the agent
- The displayed message shows only the user's text (without file paths suffix)

## UI Design

```
┌─────────────────────────────────────────────────┐
│  [Message...]                              [⬆]  │
│                                                 │
│  📎 image.png (24KB) ✕  📎 data.json (12KB) ✕   │
│                                                 │
│  [Repository ▾]              [Agent ▾] [Model ▾]│
└─────────────────────────────────────────────────┘
```

- Files appear as compact chips with filename, size, and remove button
- Drop zone overlay appears when dragging files over the input

## File Flow

1. User drags `image.png` onto prompt bar
2. File appears as chip: `📎 image.png (24KB) ✕`
3. User types: "Analyze this image"
4. User clicks Send
5. Frontend calls `POST /api/sandbox/upload` with the file
6. API uploads to `/home/daytona/uploads/image.png`
7. Frontend calls `onSendMessage` with:
   - Display text: "Analyze this image"
   - Agent receives: "Analyze this image\n\n---\nUploaded files:\n- /home/daytona/uploads/image.png"

## Files to Modify/Create

| File | Action |
|------|--------|
| `lib/types.ts` | Add PendingFile interface |
| `app/api/sandbox/upload/route.ts` | **Create** - upload endpoint |
| `components/ChatPanel.tsx` | Add drag-drop, file display, upload logic |
| `lib/hooks/useChat.ts` | Minor: handle file paths in message |

## Edge Cases

- No sandbox yet: Create sandbox first, then upload
- Large files: Show progress indicator, consider size limits
- Upload fails: Show error, keep files in pending state
- Mobile: Also support file picker button (not just drag-drop)
