export interface MockCamera {
  id: string;
  name: string;
  cameraId: string;
  sourceType: "device" | "simulated" | "video";
  videoUrl?: string;
}

export const STORAGE_KEY = "eves_eye_cameras";
export const CAMERAS_UPDATED_EVENT = "eves_eye_cameras_updated";

export const INITIAL_CAMERAS: MockCamera[] = [
  {
    id: "cam-webcam",
    name: "Main Browser Cam",
    cameraId: "CAM-01-WEBCAM",
    sourceType: "device",
  },
  {
    id: "cam-north",
    name: "Perimeter North",
    cameraId: "CAM-02-NORTH",
    sourceType: "simulated",
  },
  {
    id: "cam-gate",
    name: "Docking Gate 4",
    cameraId: "CAM-03-GATE",
    sourceType: "simulated",
  },
  {
    id: "cam-corridor",
    name: "Server Corridor",
    cameraId: "CAM-04-SERVER",
    sourceType: "simulated",
  },
];

export function loadCameras(): MockCamera[] {
  if (typeof window === "undefined") return INITIAL_CAMERAS;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return INITIAL_CAMERAS;
  try {
    const parsed = JSON.parse(saved) as MockCamera[];
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_CAMERAS;
    return parsed;
  } catch {
    return INITIAL_CAMERAS;
  }
}

export function saveCameras(cameras: MockCamera[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cameras));
  window.dispatchEvent(new CustomEvent(CAMERAS_UPDATED_EVENT));
}

export function isCameraMonitored(
  camera: MockCamera,
  hasWebcamStream = false,
): boolean {
  if (camera.sourceType === "device") return hasWebcamStream;
  if (camera.sourceType === "video") return !!camera.videoUrl;
  return false;
}
