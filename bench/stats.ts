import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ContainerMetric {
  timestamp: string;
  name: string;
  cpuPerc: number;
  memUsageBytes: number;
  memLimitBytes: number;
  memPerc: number;
}

export interface ContainerSummary {
  name: string;
  avgCpuPerc: number;
  peakCpuPerc: number;
  avgMemMB: number;
  peakMemMB: number;
}

export interface StatsSummary {
  sampleCount: number;
  intervalCount: number;
  durationSeconds: number;
  containers: ContainerSummary[];
  total: {
    avgCpuPerc: number;
    peakCpuPerc: number;
    avgMemMB: number;
    peakMemMB: number;
  };
}

function parseMemoryBytes(memStr: string): number {
  if (!memStr) return 0;
  const str = memStr.trim();
  const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  switch (unit) {
    case 'B':
      return val;
    case 'KIB':
    case 'KB':
      return val * 1024;
    case 'MIB':
    case 'MB':
      return val * 1024 * 1024;
    case 'GIB':
    case 'GB':
      return val * 1024 * 1024 * 1024;
    default:
      return val;
  }
}

export class DockerStatsSampler {
  private intervalMs: number;
  private csvPath: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private records: ContainerMetric[] = [];
  private writeStream: fs.WriteStream | null = null;
  private startTime = 0;
  private enforceMinSamples: boolean;

  constructor(csvPath: string, intervalMs = 2000, enforceMinSamples = true) {
    this.csvPath = csvPath;
    this.intervalMs = intervalMs;
    this.enforceMinSamples = enforceMinSamples;
  }

  public start(): void {
    const dir = path.dirname(this.csvPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.writeStream = fs.createWriteStream(this.csvPath, { flags: 'w' });
    this.writeStream.write('Timestamp,ContainerName,CpuPerc,MemUsageBytes,MemLimitBytes,MemPerc\n');

    this.running = true;
    this.startTime = Date.now();

    // Immediate first sample
    this.sampleSync();

    // Periodic sample interval
    this.timer = setInterval(() => {
      if (this.running) {
        this.sampleSync();
      }
    }, this.intervalMs);
  }

  private sampleSync(): void {
    try {
      const stdout = execSync(
        'docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}"',
        { encoding: 'utf8', timeout: 5000 }
      );
      const lines = stdout.trim().split('\n');
      const now = new Date().toISOString();

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length < 4) continue;

        const name = parts[0].trim();
        if (!name.startsWith('queueless_')) continue;

        const cpuStr = parts[1].replace('%', '').trim();
        const cpuPerc = parseFloat(cpuStr) || 0;

        const memUsageParts = parts[2].split('/');
        const memUsageBytes = parseMemoryBytes(memUsageParts[0]);
        const memLimitBytes = memUsageParts.length > 1 ? parseMemoryBytes(memUsageParts[1]) : 0;

        const memPercStr = parts[3].replace('%', '').trim();
        const memPerc = parseFloat(memPercStr) || 0;

        const metric: ContainerMetric = {
          timestamp: now,
          name,
          cpuPerc,
          memUsageBytes,
          memLimitBytes,
          memPerc,
        };

        this.records.push(metric);
        if (this.writeStream) {
          this.writeStream.write(`${now},${name},${cpuPerc},${memUsageBytes},${memLimitBytes},${memPerc}\n`);
        }
      }
    } catch {
      // Ignore transient errors during container lifecycle
    }
  }

  public stop(): StatsSummary {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.records.length === 0) {
      this.sampleSync();
    }

    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    const durationSeconds = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));

    // Group by container
    const byContainer = new Map<string, ContainerMetric[]>();
    for (const r of this.records) {
      if (!byContainer.has(r.name)) byContainer.set(r.name, []);
      byContainer.get(r.name)!.push(r);
    }

    const containers: ContainerSummary[] = [];
    for (const [name, list] of byContainer.entries()) {
      const avgCpu = list.reduce((acc, m) => acc + m.cpuPerc, 0) / list.length;
      const peakCpu = Math.max(...list.map((m) => m.cpuPerc));
      const avgMem = list.reduce((acc, m) => acc + m.memUsageBytes, 0) / list.length / (1024 * 1024);
      const peakMem = Math.max(...list.map((m) => m.memUsageBytes)) / (1024 * 1024);

      containers.push({
        name,
        avgCpuPerc: Number(avgCpu.toFixed(2)),
        peakCpuPerc: Number(peakCpu.toFixed(2)),
        avgMemMB: Number(avgMem.toFixed(2)),
        peakMemMB: Number(peakMem.toFixed(2)),
      });
    }

    // Group by timestamp to calculate concurrent totals across all containers
    const byTimestamp = new Map<string, { cpu: number; mem: number }>();
    for (const r of this.records) {
      if (!byTimestamp.has(r.timestamp)) {
        byTimestamp.set(r.timestamp, { cpu: 0, mem: 0 });
      }
      const item = byTimestamp.get(r.timestamp)!;
      item.cpu += r.cpuPerc;
      item.mem += r.memUsageBytes;
    }

    const timestampValues = Array.from(byTimestamp.values());
    const intervalCount = timestampValues.length;

    // Sanity check: Fail if fewer than 10 samples exist during benchmark runs
    if (this.enforceMinSamples && intervalCount < 10) {
      throw new Error(
        `❌ Sanity Check Failed: Expected at least 10 stats samples, but only captured ${intervalCount} samples over ${durationSeconds}s. Sampling engine did not collect sufficient data points.`
      );
    }

    const totalAvgCpu = timestampValues.length
      ? timestampValues.reduce((acc, v) => acc + v.cpu, 0) / timestampValues.length
      : 0;
    const totalPeakCpu = timestampValues.length ? Math.max(...timestampValues.map((v) => v.cpu)) : 0;
    const totalAvgMem = timestampValues.length
      ? timestampValues.reduce((acc, v) => acc + v.mem, 0) / timestampValues.length / (1024 * 1024)
      : 0;
    const totalPeakMem = timestampValues.length
      ? Math.max(...timestampValues.map((v) => v.mem)) / (1024 * 1024)
      : 0;

    const summary: StatsSummary = {
      sampleCount: this.records.length,
      intervalCount,
      durationSeconds,
      containers,
      total: {
        avgCpuPerc: Number(totalAvgCpu.toFixed(2)),
        peakCpuPerc: Number(totalPeakCpu.toFixed(2)),
        avgMemMB: Number(totalAvgMem.toFixed(2)),
        peakMemMB: Number(totalPeakMem.toFixed(2)),
      },
    };

    return summary;
  }
}
