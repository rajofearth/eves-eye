import { join } from "node:path";
import Database from "better-sqlite3";

const dbPath = join(process.cwd(), "eves_eye.db");

// Global caching to prevent multiple database connections during hot reloads
const globalForDb = globalThis as unknown as {
  db: Database.Database | undefined;
};

export const db = globalForDb.db ?? new Database(dbPath);

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

// Initialize SQLite tables
db.exec(`
  CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    label TEXT NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    confidence REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS threats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    is_harm INTEGER NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT NOT NULL,
    raw_json TEXT,
    snapshot_path TEXT
  );
`);

// Handle migration for existing databases missing the snapshot_path column
try {
  db.exec("ALTER TABLE threats ADD COLUMN snapshot_path TEXT");
} catch (_e) {
  // Column already exists, safe to ignore
}

// Prepared statements for fast inserts
const insertDetectionStmt = db.prepare(`
  INSERT INTO detections (timestamp, camera_id, label, x1, y1, x2, y2, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertThreatStmt = db.prepare(`
  INSERT INTO threats (timestamp, camera_id, is_harm, severity, reason, raw_json, snapshot_path)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function logDetections(
  cameraId: string,
  detections: {
    label: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
  }[],
) {
  const timestamp = new Date().toISOString();

  // Batch inserts in a transaction for speed
  const runTransaction = db.transaction((items) => {
    for (const d of items) {
      insertDetectionStmt.run(
        timestamp,
        cameraId,
        d.label,
        d.x1,
        d.y1,
        d.x2,
        d.y2,
        d.confidence,
      );
    }
  });

  runTransaction(detections);
}

export function logThreat(
  cameraId: string,
  threat: {
    isHarm: boolean;
    severity: string;
    reason: string;
    rawJson: string;
    snapshotPath?: string;
  },
) {
  const timestamp = new Date().toISOString();
  insertThreatStmt.run(
    timestamp,
    cameraId,
    threat.isHarm ? 1 : 0,
    threat.severity,
    threat.reason,
    threat.rawJson,
    threat.snapshotPath || null,
  );
}
