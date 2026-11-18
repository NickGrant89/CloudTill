/**
 * Physical printer integration layer.
 * Drivers turn ESC/POS bytes into device I/O. Mock driver logs jobs for demos;
 * network driver targets raw TCP :9100 ESC/POS printers; usb_bridge is a stub
 * for host agents that consume base64 payloads.
 */

export interface PrintResult {
  ok: boolean;
  driver: string;
  detail: string;
  bytesSent: number;
}

export interface PrinterDriver {
  readonly id: string;
  print(bytes: Uint8Array, meta?: { jobId?: string; type?: string }): Promise<PrintResult>;
  openDrawer?(bytes: Uint8Array): Promise<PrintResult>;
}

export class MockPrinterDriver implements PrinterDriver {
  readonly id = "mock";
  readonly jobs: { at: string; bytes: number; type?: string; hexPreview: string }[] = [];

  async print(bytes: Uint8Array, meta?: { jobId?: string; type?: string }): Promise<PrintResult> {
    const hexPreview = [...bytes.slice(0, 24)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    this.jobs.push({
      at: new Date().toISOString(),
      bytes: bytes.length,
      type: meta?.type,
      hexPreview,
    });
    if (this.jobs.length > 100) this.jobs.shift();
    return {
      ok: true,
      driver: this.id,
      detail: `Mock printed ${bytes.length} bytes${meta?.jobId ? ` (job ${meta.jobId})` : ""}`,
      bytesSent: bytes.length,
    };
  }

  async openDrawer(bytes: Uint8Array): Promise<PrintResult> {
    return this.print(bytes, { type: "drawer" });
  }
}

export class NetworkPrinterDriver implements PrinterDriver {
  readonly id = "network";
  constructor(
    public host: string,
    public port: number = 9100
  ) {}

  async print(bytes: Uint8Array, meta?: { jobId?: string; type?: string }): Promise<PrintResult> {
    // Soft-fail in demo environments without a real printer: attempt TCP, fall back to mock log.
    try {
      const net = await import("node:net");
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: this.host, port: this.port }, () => {
          socket.write(Buffer.from(bytes), (err) => {
            socket.end();
            if (err) reject(err);
            else resolve();
          });
        });
        socket.setTimeout(2500);
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("Network printer timeout"));
        });
        socket.on("error", reject);
      });
      return {
        ok: true,
        driver: this.id,
        detail: `Sent ${bytes.length} bytes to ${this.host}:${this.port}`,
        bytesSent: bytes.length,
      };
    } catch (e) {
      const mock = getMockDriver();
      const fallback = await mock.print(bytes, meta);
      return {
        ok: false,
        driver: this.id,
        detail: `Network failed (${e instanceof Error ? e.message : "error"}); logged to mock. ${fallback.detail}`,
        bytesSent: 0,
      };
    }
  }
}

/** USB/host-bridge: returns payload for an external agent (no socket). */
export class UsbBridgePrinterDriver implements PrinterDriver {
  readonly id = "usb_bridge";
  lastPayload: Uint8Array | null = null;

  async print(bytes: Uint8Array, meta?: { jobId?: string; type?: string }): Promise<PrintResult> {
    this.lastPayload = bytes;
    return {
      ok: true,
      driver: this.id,
      detail: `Queued ${bytes.length} bytes for USB bridge agent${meta?.jobId ? ` job=${meta.jobId}` : ""}`,
      bytesSent: bytes.length,
    };
  }
}

const mockSingleton = new MockPrinterDriver();

export function getMockDriver(): MockPrinterDriver {
  return mockSingleton;
}

export function createDriver(opts: {
  driver: string;
  host?: string | null;
  port?: number | null;
}): PrinterDriver {
  if (opts.driver === "network" && opts.host) {
    return new NetworkPrinterDriver(opts.host, opts.port ?? 9100);
  }
  if (opts.driver === "usb_bridge") return new UsbBridgePrinterDriver();
  return getMockDriver();
}
