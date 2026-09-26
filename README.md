# QDrop

**AirDrop, without the network.**

QDrop is a file-transfer tool that transfers files between devices using **QR codes displayed on one device and scanned by another device's camera**.

No Wi-Fi. No Bluetooth. No server. No backend.

```
Sender screen → QR codes → Receiver camera → File
```

## How it works

1. **Sender** selects a file. The file is split into chunks, encoded into protocol frames, and continuously displayed as QR codes.
2. **Receiver** opens the app, points their camera at the sender's screen, and scans the QR codes.
3. The receiver reconstructs the file from the scanned frames and verifies integrity using SHA-256.

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

### Frame numbering

Each frame has an absolute frame number. The receiver stores frames by their number, not their arrival order. Frames arriving out of order is expected and handled correctly.

### Integrity

- **Frame level**: CRC32 checksum on every frame. Invalid frames are discarded.
- **File level**: SHA-256 hash comparison between the original file (stored in the manifest) and the reconstructed file. The transfer is only considered complete when all frames are received AND the SHA-256 matches.

## QR Density

| Setting | Description |
|---------|-------------|
| 1 × 1   | One QR code at a time (default) |
| 2 × 2   | Four QR codes simultaneously |

The QR grid density is a **UI/rendering concern**, not a protocol concern. The receiver processes each decoded QR code independently regardless of how many were displayed at once.

## Architecture

```
src/
├── protocol/         Binary frame format, CRC32, SHA-256
│   ├── types.ts      Protocol constants and interfaces
│   ├── frame.ts      Frame encoding/decoding
│   ├── manifest.ts   Manifest encoding/decoding
│   ├── encoder.ts    High-level frame creation
│   ├── decoder.ts    QR data → decoded frame
│   ├── crc.ts        CRC32 implementation
│   └── hash.ts       SHA-256 (Web Crypto API)
│
├── transfer/         Transfer state machines
│   ├── sender.ts     Sender state + frame iteration
│   ├── receiver.ts   Receiver state + frame collection
│   ├── chunker.ts    File → fixed-size chunks
│   └── assembler.ts  [Future: file reconstruction]
│
├── qr/               QR transport layer
│   ├── generator.ts  QR code generation (qrcode)
│   ├── scanner.ts    QR code scanning (jsQR)
│   └── renderer.tsx  Grid rendering component
│
├── hooks/            React hooks
│   ├── use-sender.ts Sender state machine hook
│   └── use-receiver.ts Receiver state machine hook
│
├── components/
│   ├── ui/           shadcn/ui components
│   ├── sender/       [Future: sender sub-components]
│   ├── receiver/     [Future: receiver sub-components]
│   └── common/       Theme provider, theme toggle
│
├── pages/
│   ├── Home.tsx      Landing page
│   ├── Send.tsx      Sender flow
│   └── Receive.tsx   Receiver flow
│
└── App.tsx           Router setup
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

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type check
npx tsc -b

# Production build
npm run build
```

The development server runs at `http://localhost:5173/qdrop/`.

## Deployment (GitHub Pages)

This project is configured for automatic deployment to GitHub Pages.

1. Push to the `main` branch.
2. The GitHub Actions workflow builds and deploys automatically.
3. The app will be available at `https://<username>.github.io/qdrop/`.

### Manual deployment

```bash
npm run build
# Deploy the dist/ directory to your GitHub Pages branch
```

### Configuration

- Vite's `base` is set to `/qdrop/` in `vite.config.ts`
- React Router uses `import.meta.env.BASE_URL` as the basename
- GitHub Actions workflow: `.github/workflows/deploy.yml`

## Protocol Details

### Frame format

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

### Manifest format

| Field | Size | Description |
|-------|------|-------------|
| Transfer ID | 16 bytes | UUID v4 |
| Filename length | 2 bytes | uint16, big-endian |
| Filename | N bytes | UTF-8 encoded filename |
| File size | 8 bytes | uint64, big-endian |
| Total frames | 4 bytes | uint32, big-endian |
| File hash | 32 bytes | SHA-256 of original file |
| Protocol version | 1 byte | |

## State Machines

### Sender

```
IDLE → FILE_SELECTED → PREPARING → READY → TRANSMITTING ⇄ PAUSED → STOPPED
```

### Receiver

```
IDLE → CAMERA_PERMISSION → SCANNING → RECEIVING → RECONSTRUCTING → VERIFYING → COMPLETE
                                                                              ↓
                                                                           FAILED
```

## Testing

```bash
npm test
```

Tests cover:

- CRC32 computation and verification
- Frame encoding/decoding with CRC validation
- Invalid frame rejection (wrong magic, bad CRC, short data)
- Manifest encoding/decoding
- Base64 round-trip
- Out-of-order frame handling
- Duplicate frame detection
- File reconstruction from out-of-order frames
- Empty and edge cases

## Current Limitations

- Files only (no folder selection yet)
- 1×1 and 2×2 QR layouts only
- No adaptive QR density
- jsQR detects one QR code per camera frame (multi-QR detection in a single frame is not supported)
- Chunk size fixed at 800 bytes
- Transmission speed depends on QR density, frame interval, and camera quality
- No compression
- No encryption

## Future Improvements

- 3×3 / 4×4 QR layouts
- Fountain codes (rateless erasure coding)
- Compression (gzip before chunking)
- Encryption (end-to-end)
- Folder transfer (tar before chunking)
- Adaptive QR density based on screen/camera capabilities
- Adaptive frame timing based on scan success rate
- Transfer statistics (throughput, error rate, estimated time)
- Multi-QR detection per camera frame (advanced scanner)
- Native clients (desktop/mobile)
- Progressive enhancement (WebRTC fallback when network is available)

## License

MIT