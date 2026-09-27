# QDrop

**AirDrop, without the network.**

QDrop is a file-transfer tool that transfers files between devices using **QR codes displayed on one device and scanned by another device's camera**.

No Wi-Fi. No Bluetooth. No server. No backend.

```
Sender screen → QR codes → Receiver camera → File(s)
```

## How it works

1. **Sender** selects a file (or folder). The data is split into chunks, encoded into protocol frames, and continuously displayed as QR codes.
2. **Receiver** opens the app, points their camera at the sender's screen, and scans the QR codes.
3. The receiver reconstructs the file(s) from the scanned frames and verifies integrity using SHA-256.

### Why no network is needed

QDrop uses the camera as the communication channel. The sender displays QR codes. The receiver reads them with their camera. There is no network connection between the two devices.

### Why the sender doesn't need a camera

The sender only outputs visual data (QR codes). It never needs to receive data from the receiver. There is no handshake, no ACK, no feedback loop. This is intentional — it keeps the protocol simple and the sender stateless.

### Cyclic transmission

The sender continuously cycles through all frames:

```
Manifest → Frame 1 → Frame 2 → ... → Frame N → Manifest → Frame 1 → ...
```

If the receiver misses a frame during one cycle, it can catch it on the next cycle. The receiver does not need to start at the beginning — it can join at any point.

### Retransmission

The receiver can request retransmission of specific missing frames. The receiver UI shows a compact range string of missing frames (e.g. `2, 5-7, @manifest`) that can be copied and pasted into the sender, which then enters retransmit mode and cycles only those frames.

### Frame numbering

- **v1 (single-file)**: Each data frame has an absolute 1-indexed frame number. Frame 0 is reserved for the manifest.
- **v2 (folder)**: Each data frame carries a `file_id` and a per-file frame number. Manifest frames carry a fragment index.

Frames arriving out of order is expected and handled correctly.

### Integrity

- **Frame level**: CRC32 checksum on every frame. Invalid frames are discarded.
- **File level**: SHA-256 hash comparison between the original file (stored in the manifest) and the reconstructed file. The transfer is only considered complete when all frames are received AND the SHA-256 matches.

## QR Density

| Setting | Description |
|---------|-------------|
| 1 × 1   | One QR code at a time (default) |
| 2 × 2   | Four QR codes simultaneously |

The QR grid density is a **UI/rendering concern**, not a protocol concern. The receiver processes each decoded QR code independently regardless of how many were displayed at once.

## QR Configuration

The sender allows real-time tuning of:

- **Error correction level**: L (7%), M (15%), Q (25%), H (30%) — higher is more resilient but carries less data per QR.
- **Version**: Auto, v10, v15, v20, v25, v30 — higher versions pack more data per QR but are harder to scan.
- **Transmission speed**: Very Fast (0.8s), Fast (1.5s), Normal (3s), Slow (5s) — frame interval adjustment.

## Folder Transfer

QDrop supports transferring entire folder hierarchies:

1. **Select Folder** uses `webkitdirectory` (Chrome/Edge/Safari) to pick a directory.
2. **Pre-filter**: `.gitignore` rules are automatically detected and applied. Users can also manually remove files/folders via a tree UI with X buttons.
3. **Manifest fragmentation**: The folder manifest (listing all files, their paths, sizes, and SHA-256 hashes) is split across multiple MANIFEST frames. The receiver reconstructs it from fragments before accepting data frames.
4. **Per-file tracking**: Each file has independent frame progress, and the receiver shows a live tree view with per-file completion status.
5. **Download as ZIP**: On completion, all verified files are packaged into a single ZIP archive preserving the original folder structure.

### Always-excluded paths

The `.git` directory (and its entire subtree) is always excluded from transfers, regardless of `.gitignore` rules or user removals.

## Architecture

```
src/
├── protocol/         Binary frame format, CRC32, SHA-256
│   ├── types.ts      Protocol constants and interfaces
│   ├── frame.ts      Frame encoding/decoding
│   ├── manifest.ts   v1 manifest encoding/decoding
│   ├── manifest-v2.ts Folder manifest serialization + fragmentation
│   ├── encoder.ts    High-level frame creation (v1 + v2)
│   ├── decoder.ts    QR data → decoded frame
│   ├── crc.ts        CRC32 implementation
│   ├── hash.ts       SHA-256 (Web Crypto API)
│   └── index.ts      Public re-exports
│
├── transfer/         Transfer state machines
│   ├── sender.ts     Sender state + frame iteration
│   ├── receiver.ts   Receiver state + frame collection + reconstruction
│   ├── chunker.ts    File → fixed-size chunks
│   └── range-parser.ts  Missing frame range computation and formatting
│
├── filter/           Folder filtering
│   ├── gitignore.ts  .gitignore pattern parser and matcher
│   ├── folder-filter.ts  High-level filtering (gitignore + removals)
│   └── index.ts      Public exports
│
├── qr/               QR transport layer
│   ├── generator.ts  QR code generation (qrcode), config, capacity tables
│   ├── scanner.ts    QR code scanning (jsQR), camera management
│   └── renderer.tsx  Grid rendering component
│
├── hooks/            React hooks
│   ├── use-sender.ts Sender state machine hook (file + folder)
│   └── use-receiver.ts Receiver state machine hook (file + folder)
│
├── components/
│   ├── ui/           shadcn/ui components (button, card, badge, dialog,
│   │                 dropdown-menu, label, progress, select, separator,
│   │                 slider, sonner, switch, toggle, toggle-group, tooltip)
│   ├── FolderTree.tsx       Receiver-side folder tree with progress
│   ├── RemovableFileTree.tsx Sender-side pre-filter tree (remove files/folders)
│   └── SenderFolderTree.tsx  Sender-side transmitting tree (auto-scroll)
│
├── pages/
│   ├── Home.tsx      Landing page
│   ├── Send.tsx      Sender flow (file + folder)
│   └── Receive.tsx   Receiver flow (file + folder with scan log)
│
├── __tests__/
│   ├── protocol/     CRC, frame, manifest, encoder-decoder, folder-transfer tests
│   ├── transfer/     receiver, range-parser, retransmission tests
│   ├── filter/       gitignore, folder-filter tests
│   └── components/   FolderTree test
│
├── lib/
│   └── utils.ts      cn() utility (clsx + tailwind-merge)
│
├── App.tsx           Router setup
├── main.tsx          Entry point
└── index.css         Tailwind imports
```

### Separation of concerns

```
UI ↓ Transfer state ↓ Protocol ↓ QR transport ↓ Browser APIs
```

Each layer is independent. The protocol doesn't know about QR codes. The QR renderer doesn't know about transmission logic. The hooks connect everything together.

## Tech Stack

- **React** 19
- **TypeScript** 6
- **Vite** 8
- **shadcn/ui** (base style)
- **Tailwind CSS** v4
- **qrcode** (QR generation)
- **jsQR** (QR scanning)
- **JSZip** (folder ZIP packaging on receiver)
- **sonner** (toast notifications)
- **lucide-react** (icons)
- **Vitest** + **happy-dom** (testing)
- **oxlint** (linting)

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
npm run test:watch    # Watch mode

# Type check
npx tsc -b

# Production build
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

The development server runs at `http://localhost:5173/QDrop/`.

## Deployment (GitHub Pages)

This project is configured for automatic deployment to GitHub Pages.

1. Push to the `main` branch.
2. The GitHub Actions workflow builds and deploys automatically.
3. The app will be available at `https://<username>.github.io/QDrop/`.

### Manual deployment

```bash
npm run build
# Deploy the dist/ directory to your GitHub Pages branch
```

### Configuration

- Vite's `base` is set to `/QDrop/` in `vite.config.ts`
- React Router uses `import.meta.env.BASE_URL` as the basename
- The build command also copies `dist/index.html` to `dist/404.html` for SPA routing
- GitHub Actions workflow: `.github/workflows/deploy.yml`

## Protocol Details

### v1 Frame format (single-file)

| Field | Size | Description |
|-------|------|-------------|
| Magic | 4 bytes | `QDRO` (0x5144524f) |
| Version | 1 byte | Protocol version (1) |
| Transfer ID | 16 bytes | UUID v4 |
| Frame type | 1 byte | 0 = manifest, 1 = data |
| Frame number | 4 bytes | Absolute frame number (uint32, big-endian) |
| Total frames | 4 bytes | Total frames in transfer (uint32, big-endian) |
| Payload length | 4 bytes | Payload size in bytes (uint32, big-endian) |
| Payload | N bytes | Frame payload (chunk data or manifest) |
| CRC32 | 4 bytes | CRC32 of everything before this field |

### v2 Frame format (folder)

| Field | Size | Description |
|-------|------|-------------|
| Magic | 4 bytes | `QDRO` (0x5144524f) |
| Version | 1 byte | Protocol version (2) |
| Transfer ID | 16 bytes | UUID v4 |
| Frame type | 1 byte | 0 = manifest, 1 = data |
| File ID | 4 bytes | For data: file_id; for manifest: fragment index (uint32, big-endian) |
| Frame number | 4 bytes | For data: per-file frame number; for manifest: unused (uint32, big-endian) |
| Total frames | 4 bytes | For data: per-file frame count; for manifest: fragment count (uint32, big-endian) |
| Payload length | 4 bytes | Payload size in bytes (uint32, big-endian) |
| Payload | N bytes | Frame payload (chunk data or manifest fragment) |
| CRC32 | 4 bytes | CRC32 of everything before this field |

### v1 Manifest format

| Field | Size | Description |
|-------|------|-------------|
| Transfer ID | 16 bytes | UUID v4 |
| Filename length | 2 bytes | uint16, big-endian |
| Filename | N bytes | UTF-8 encoded filename |
| File size | 8 bytes | uint64, big-endian |
| Total frames | 4 bytes | uint32, big-endian |
| File hash | 32 bytes | SHA-256 of original file |
| Protocol version | 1 byte | |

### v2 Folder Manifest format (serialized, then fragmented)

| Field | Size | Description |
|-------|------|-------------|
| Root name length | 2 bytes | uint16, big-endian |
| Root name | N bytes | UTF-8 root folder name |
| File count | 4 bytes | uint32, big-endian |
| Files[] (per entry): |
| File ID | 4 bytes | uint32, big-endian |
| Path length | 2 bytes | uint16, big-endian |
| Path | M bytes | UTF-8 relative path |
| Size | 8 bytes | uint64, big-endian |
| Frame count | 4 bytes | uint32, big-endian |
| SHA-256 | 32 bytes | File hash |

## State Machines

### Sender

```
IDLE → PREPARING → READY → TRANSMITTING ⇄ PAUSED → STOPPED
```

Retransmit mode: When missing frames are submitted, the sender cycles only the requested frames until cleared.

### Receiver

```
IDLE → CAMERA_PERMISSION → SCANNING → RECEIVING → RECONSTRUCTING → VERIFYING → COMPLETE
                                                                                ↓
                                                                             FAILED
```

- **Single-file**: After manifest is decoded, switches to RECEIVING. Reconstruction + verification happen atomically.
- **Folder**: Data frames can arrive before the manifest is fully assembled (all fragments received). Per-file progress is tracked independently. On completion, each file is verified independently.

## Testing

```bash
npm test          # Run all tests (vitest)
npm run test:watch  # Watch mode
```

Test files live alongside the source code under `src/__tests__/` and cover:

- CRC32 computation and verification
- Frame encoding/decoding with CRC validation
- Invalid frame rejection (wrong magic, bad CRC, short data)
- v1 and v2 manifest encoding/decoding
- Folder manifest serialization, deserialization, and fragmentation
- Folder transfer end-to-end (manifest → frames → reconstruct → verify)
- Base64 round-trip
- Out-of-order frame handling
- Duplicate frame detection
- File reconstruction from out-of-order frames
- Missing frame range parsing and formatting
- Receiver state machine (v1 + v2)
- Retransmission logic (file + folder modes)
- .gitignore pattern parsing and matching
- Folder filtering (gitignore, removed paths, always-excluded)
- FolderTree component rendering

## Current Limitations

- 1×1 and 2×2 QR layouts only (no 3×3 / 4×4 yet)
- No adaptive QR density
- jsQR detects one QR code per camera frame (multi-QR detection in a single frame is not supported)
- No compression
- No encryption
- Folder selection requires `webkitdirectory` (Chrome/Edge/Safari only)
- Manifest frames use fixed small payload size (800 bytes) regardless of QR capacity
- No transfer statistics display (throughput, error rate are computed but not streamed)

## Future Improvements

- 3×3 / 4×4 QR layouts
- Fountain codes (rateless erasure coding)
- Compression (gzip before chunking)
- Encryption (end-to-end)
- Adaptive QR density based on screen/camera capabilities
- Adaptive frame timing based on scan success rate
- Transfer statistics display (throughput, error rate, estimated time)
- Multi-QR detection per camera frame (advanced scanner)
- Native clients (desktop/mobile)
- Progressive enhancement (WebRTC fallback when network is available)

## License

MIT