import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { gemmaVisionJson } from "./cerebras-client";
import { PIPELINE, runBatchedConcurrent, runConcurrent } from "./concurrency";
import type { FrameEntry } from "./frame-scanner";

interface BatchFace {
  temp_id: string;
  description: string;
  frame_index: number;
  box_2d: [number, number, number, number];
}

interface FaceCandidate {
  temp_id: string;
  description: string;
  frame_index: number;
  timestamp_sec: number;
  box_2d: [number, number, number, number];
  crop_base64: string;
}

interface UniquePerson {
  person_id: string;
  description: string;
  frame_index: number;
  timestamp_sec: number;
  crop_base64: string;
}

interface DedupGroup {
  member_ids: string[];
  best_id: string;
  description: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeFaceBox(
  box: [number, number, number, number],
): [number, number, number, number] {
  let [ymin, xmin, ymax, xmax] = box.map((v) =>
    Math.max(0, Math.min(1000, v)),
  ) as [number, number, number, number];

  if (xmax - xmin > ymax - ymin && ymax - ymin < 350) {
    [ymin, xmin, ymax, xmax] = [xmin, ymin, xmax, ymax];
  }
  if (xmax <= xmin) [xmin, xmax] = [Math.min(xmin, xmax), Math.max(xmin, xmax)];
  if (ymax <= ymin) [ymin, ymax] = [Math.min(ymin, ymax), Math.max(ymin, ymax)];

  const padY = (ymax - ymin) * 0.04;
  const padX = (xmax - xmin) * 0.04;
  return [
    Math.max(0, ymin - padY),
    Math.max(0, xmin - padX),
    Math.min(1000, ymax + padY),
    Math.min(1000, xmax + padX),
  ];
}

async function identifyFacesInBatch(
  framesDir: string,
  batch: FrameEntry[],
  batchIndex: number,
): Promise<BatchFace[]> {
  const images: { base64: string; label: string }[] = [];
  for (const f of batch) {
    const buf = await sharp(join(framesDir, f.file))
      .resize(640, null, { withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    images.push({ base64: buf.toString("base64"), label: `frame_${f.frameIndex}` });
  }

  const mapping = batch
    .map(
      (f, i) =>
        `  image ${i + 1} = frame_index ${f.frameIndex} (${f.timestampSec}s)`,
    )
    .join("\n");

  const prompt = `Detect human FACES in these surveillance frames.
${mapping}

Rules:
- Return ONLY tight face bounding boxes (forehead to chin, ear to ear) — NOT body or portrait.
- One entry per distinct face in this batch.

Return JSON:
{
  "faces": [
    {
      "temp_id": "b${batchIndex}_f1",
      "description": "man, dark hair",
      "frame_index": 12,
      "box_2d": [ymin, xmin, ymax, xmax]
    }
  ]
}
box_2d: 0–1000 [ymin, xmin, ymax, xmax]. Return ONLY raw JSON.`;

  const result = await gemmaVisionJson<{ faces?: BatchFace[] }>(prompt, images);
  return result.faces ?? [];
}

async function cropFaceToBase64(
  framePath: string,
  box: [number, number, number, number],
): Promise<string | null> {
  const metadata = await sharp(framePath).metadata();
  const width = metadata.width || 1280;
  const height = metadata.height || 720;

  const [ymin, xmin, ymax, xmax] = normalizeFaceBox(box);
  let left = Math.round((xmin / 1000) * width);
  let top = Math.round((ymin / 1000) * height);
  let w = Math.round(((xmax - xmin) / 1000) * width);
  let h = Math.round(((ymax - ymin) / 1000) * height);

  if (w < 20 || h < 20) return null;

  const size = Math.max(w, h);
  const cx = left + w / 2;
  const cy = top + h / 2;
  left = Math.round(cx - size / 2);
  top = Math.round(cy - size / 2);
  w = size;
  h = size;

  left = Math.max(0, Math.min(width - 1, left));
  top = Math.max(0, Math.min(height - 1, top));
  w = Math.max(1, Math.min(width - left, w));
  h = Math.max(1, Math.min(height - top, h));

  const buf = await sharp(framePath)
    .extract({ left, top, width: w, height: h })
    .resize(256, 256, { fit: "cover", position: "centre" })
    .jpeg({ quality: 92 })
    .toBuffer();

  return buf.toString("base64");
}

async function buildCandidates(
  framesDir: string,
  allFrames: FrameEntry[],
  batchFaces: BatchFace[],
): Promise<FaceCandidate[]> {
  const slots: (FaceCandidate | null)[] = new Array(batchFaces.length).fill(null);
  const indices = Array.from({ length: batchFaces.length }, (_, i) => i);

  await runConcurrent(indices, PIPELINE.FACE_CROP_CONCURRENCY, async (i) => {
    const face = batchFaces[i]!;
    const frameEntry = allFrames.find((f) => f.frameIndex === face.frame_index);
    if (!frameEntry) return;

    const cropBase64 = await cropFaceToBase64(
      join(framesDir, frameEntry.file),
      face.box_2d,
    );
    if (!cropBase64) return;

    slots[i] = {
      temp_id: face.temp_id,
      description: face.description,
      frame_index: face.frame_index,
      timestamp_sec: frameEntry.timestampSec,
      box_2d: face.box_2d,
      crop_base64: cropBase64,
    };
  });

  return slots.filter((c): c is FaceCandidate => c !== null);
}

async function dedupeChunkVisually(
  chunk: FaceCandidate[],
): Promise<DedupGroup[]> {
  if (chunk.length === 0) return [];
  if (chunk.length === 1) {
    const c = chunk[0]!;
    return [{ member_ids: [c.temp_id], best_id: c.temp_id, description: c.description }];
  }

  const prompt = `Compare these ${chunk.length} face crops from surveillance footage.
Group faces that are THE SAME PERSON (different angle/lighting still counts as same).

Return JSON:
{
  "groups": [
    { "member_ids": ["id1", "id2"], "best_id": "id1", "description": "man, dark hair" }
  ]
}
Every id must appear once. best_id = clearest face. Return ONLY raw JSON.`;

  const result = await gemmaVisionJson<{ groups?: DedupGroup[] }>(
    prompt,
    chunk.map((c) => ({ base64: c.crop_base64, label: c.temp_id })),
  );

  return result.groups ?? [];
}

class UnionFind {
  parent = new Map<string, string>();

  find(id: string): string {
    if (!this.parent.has(id)) this.parent.set(id, id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = id;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

function applyGroups(uf: UnionFind, groups: DedupGroup[]): void {
  for (const g of groups) {
    const ids = g.member_ids.filter(Boolean);
    for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!);
  }
}

function clusterCandidates(
  candidates: FaceCandidate[],
  uf: UnionFind,
): Map<string, FaceCandidate[]> {
  const clusters = new Map<string, FaceCandidate[]>();
  for (const c of candidates) {
    const root = uf.find(c.temp_id);
    const list = clusters.get(root) ?? [];
    list.push(c);
    clusters.set(root, list);
  }
  return clusters;
}

function pickClusterRep(members: FaceCandidate[]): FaceCandidate {
  return members.reduce((a, b) =>
    a.crop_base64.length >= b.crop_base64.length ? a : b,
  );
}

async function mergeRepresentativesVisually(
  reps: FaceCandidate[],
  uf: UnionFind,
): Promise<void> {
  const chunks = chunk(reps, PIPELINE.PEOPLE_BATCH_SIZE);
  await runConcurrent(chunks, PIPELINE.FACE_DEDUP_CONCURRENCY, async (batch) => {
    const groups = await dedupeChunkVisually(batch);
    applyGroups(uf, groups);
  });
}

async function dedupeAllCandidates(
  candidates: FaceCandidate[],
): Promise<UniquePerson[]> {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    const c = candidates[0]!;
    return [
      {
        person_id: "PERSON-1",
        description: c.description,
        frame_index: c.frame_index,
        timestamp_sec: c.timestamp_sec,
        crop_base64: c.crop_base64,
      },
    ];
  }

  const uf = new UnionFind();
  for (const c of candidates) uf.find(c.temp_id);

  // Pass 1: dedupe within chunks (parallel)
  const chunks = chunk(candidates, PIPELINE.PEOPLE_BATCH_SIZE);
  await runConcurrent(chunks, PIPELINE.FACE_DEDUP_CONCURRENCY, async (batch) => {
    const groups = await dedupeChunkVisually(batch);
    applyGroups(uf, groups);
  });

  // Pass 2–3: compare cluster representatives across chunks
  for (let round = 0; round < 2; round++) {
    const clusters = clusterCandidates(candidates, uf);
    const reps = [...clusters.values()].map(pickClusterRep);
    if (reps.length <= 1) break;

    const sizeBefore = clusters.size;
    await mergeRepresentativesVisually(reps, uf);
    const sizeAfter = clusterCandidates(candidates, uf).size;
    if (sizeAfter >= sizeBefore) break;
  }

  const finalClusters = clusterCandidates(candidates, uf);
  const people: UniquePerson[] = [];
  let idx = 1;
  for (const members of finalClusters.values()) {
    const best = pickClusterRep(members);
    people.push({
      person_id: `PERSON-${idx++}`,
      description: best.description,
      frame_index: best.frame_index,
      timestamp_sec: best.timestamp_sec,
      crop_base64: best.crop_base64,
    });
  }
  return people;
}

async function saveFaceAvatar(
  jobId: string,
  personId: string,
  cropBase64: string,
): Promise<string> {
  const facesDir = join(process.cwd(), "public", "uploads", "videos", jobId, "faces");
  await mkdir(facesDir, { recursive: true });
  const filename = `${personId.toLowerCase().replace(/\s+/g, "_")}.jpg`;
  const outputPath = join(facesDir, filename);
  await sharp(Buffer.from(cropBase64, "base64"))
    .jpeg({ quality: 92 })
    .toFile(outputPath);
  return `/uploads/videos/${jobId}/faces/${filename}`;
}

/** Parallel face detect → crop → Gemma visual dedup. */
export async function runPeopleIdentification(
  jobId: string,
  framesDir: string,
  allFrames: FrameEntry[],
): Promise<number> {
  db.prepare("DELETE FROM video_faces WHERE job_id = ?").run(jobId);

  // Query database for frames where a human was actually detected
  const personFrames = db
    .prepare(`
      SELECT DISTINCT frame_index FROM video_detections 
      WHERE job_id = ? 
        AND (label LIKE '%PERSON%' 
             OR label LIKE '%MAN%' 
             OR label LIKE '%WOMAN%' 
             OR label LIKE '%BOY%' 
             OR label LIKE '%GIRL%' 
             OR label LIKE '%SUBJECT%')
    `)
    .all(jobId) as { frame_index: number }[];

  const personFrameIndices = new Set(personFrames.map((f) => f.frame_index));

  // Filter allFrames to only include those containing humans
  const framesToScan = allFrames.filter((f) => personFrameIndices.has(f.frameIndex));

  if (framesToScan.length === 0) {
    return 0;
  }

  const batchFaceSlots: BatchFace[][] = [];

  await runBatchedConcurrent(
    framesToScan,
    PIPELINE.PEOPLE_BATCH_SIZE,
    PIPELINE.PEOPLE_BATCH_CONCURRENCY,
    async (batch, batchIndex) => {
      const found = await identifyFacesInBatch(framesDir, batch, batchIndex);
      batchFaceSlots[batchIndex] = found;
    },
  );

  const batchFaces = batchFaceSlots.flat();

  if (batchFaces.length === 0) return 0;

  const candidates = await buildCandidates(framesDir, allFrames, batchFaces);
  if (candidates.length === 0) return 0;

  const uniquePeople = await dedupeAllCandidates(candidates);

  await runConcurrent(uniquePeople, PIPELINE.FACE_CROP_CONCURRENCY, async (person) => {
    const avatarPath = await saveFaceAvatar(
      jobId,
      person.person_id,
      person.crop_base64,
    );
    db.prepare(`
      INSERT INTO video_faces (job_id, frame_index, timestamp_sec, face_id, avatar_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      jobId,
      person.frame_index,
      person.timestamp_sec,
      person.person_id,
      avatarPath,
    );
  });

  return uniquePeople.length;
}
