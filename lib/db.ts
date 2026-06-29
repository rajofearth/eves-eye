import { join } from "node:path";
import Database from "better-sqlite3";

const dbPath = join(process.cwd(), "eves_eye.db");

// Global caching to prevent multiple database connections during hot reloads
const globalForDb = globalThis as unknown as {
  db: Database.Database | undefined;
};

const connection = globalForDb.db ?? new Database(dbPath);

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = connection;
}

// Export the raw connection for dynamic API operations (like /api/threats)
export const db = connection;

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

  CREATE TABLE IF NOT EXISTS video_jobs (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,
    total_frames INTEGER NOT NULL DEFAULT 0,
    completed_frames INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    frame_index INTEGER NOT NULL,
    timestamp_sec REAL NOT NULL,
    label TEXT NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    confidence REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    frame_index INTEGER NOT NULL DEFAULT 0,
    face_id TEXT NOT NULL,
    avatar_path TEXT NOT NULL,
    timestamp_sec REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_threats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    time_sec REAL NOT NULL,
    cls TEXT NOT NULL,
    conf REAL NOT NULL,
    note TEXT NOT NULL,
    tone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    video_job_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    created_at TEXT NOT NULL
  );
`);

// Handle migration for existing databases missing the snapshot_path column
try {
  db.exec("ALTER TABLE threats ADD COLUMN snapshot_path TEXT");
} catch (_e) {
  // Column already exists, safe to ignore
}

// Handle migration for existing databases missing frame_index on video_faces
try {
  db.exec("ALTER TABLE video_faces ADD COLUMN frame_index INTEGER NOT NULL DEFAULT 0");
} catch (_e) {
  // Column already exists, safe to ignore
}

// Handle migration for existing databases missing performance on chat_messages
try {
  db.exec("ALTER TABLE chat_messages ADD COLUMN performance TEXT");
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

export interface ThreatDbRepository {
  logDetections(
    cameraId: string,
    detections: {
      label: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      confidence: number;
    }[],
  ): void;
  logThreat(
    cameraId: string,
    threat: {
      isHarm: boolean;
      severity: string;
      reason: string;
      rawJson: string;
      snapshotPath?: string;
    },
  ): void;
  getThreatHistory(limit?: number): unknown[];
}

class SQLiteThreatRepository implements ThreatDbRepository {
  logDetections(
    cameraId: string,
    detections: {
      label: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      confidence: number;
    }[],
  ): void {
    const timestamp = new Date().toISOString();
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

  logThreat(
    cameraId: string,
    threat: {
      isHarm: boolean;
      severity: string;
      reason: string;
      rawJson: string;
      snapshotPath?: string;
    },
  ): void {
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

  getThreatHistory(limit = 100): unknown[] {
    return db
      .prepare("SELECT * FROM threats ORDER BY timestamp DESC LIMIT ?")
      .all(limit);
  }
}

export const threatDb: ThreatDbRepository = new SQLiteThreatRepository();

// Backward-compatible exports to avoid breaking existing calls
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
  threatDb.logDetections(cameraId, detections);
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
  threatDb.logThreat(cameraId, threat);
}
