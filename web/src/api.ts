import { getApiKey } from "./apiKey";
import type { AnalysisData, Lyrics, Meta, ProcessStatus, Project, ProjectSummary, RenderStatus, Scene, Settings, Storyboard, StylePlan, StyleSection } from "../../shared/types";

const BASE = "/api";

// The backend rejects writes without this header; cross-site pages can't set it without a CORS preflight.
function request(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-MVM-Client", "web");
  return fetch(url, { ...init, headers });
}

// Claude calls run on the user's own key, sent only with requests that need it.
function claudeRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = getApiKey();
  if (key) headers.set("X-Anthropic-Key", key);
  return request(url, { ...init, headers });
}

/** Message text for display; String(e) would add a redundant "Error: " prefix. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      // FastAPI errors are {"detail": "..."} (or a list of validation errors).
      const detail = JSON.parse(body).detail;
      if (detail !== undefined) message = typeof detail === "string" ? detail : JSON.stringify(detail);
    } catch {
      // not JSON (e.g. a proxy error page): show it as-is
    }
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json();
}

export const audioUrl = (id: string) => `${BASE}/projects/${id}/audio`;

export async function createProject(audio: File, lyricsText: string, location = ""): Promise<Project> {
  const form = new FormData();
  form.append("audio", audio);
  form.append("lyrics_text", lyricsText);
  if (location) form.append("location", location);
  return json(await request(`${BASE}/projects`, { method: "POST", body: form }));
}

export async function saveLyrics(id: string, lyrics: Lyrics): Promise<Lyrics> {
  return json(
    await request(`${BASE}/projects/${id}/lyrics`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lyrics),
    }),
  );
}

export async function importLrc(id: string, text: string): Promise<Lyrics> {
  return json(
    await request(`${BASE}/projects/${id}/lyrics/import-lrc`, { method: "POST", headers: { "content-type": "text/plain" }, body: text }),
  );
}

export const lrcUrl = (id: string, enhanced: boolean) => `${BASE}/projects/${id}/lyrics.lrc?enhanced=${enhanced}`;

const put = (url: string, body: unknown) =>
  request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function saveDetails(id: string, meta: Meta, settings: Settings): Promise<void> {
  await json(await put(`${BASE}/projects/${id}/meta`, meta));
  await json(await put(`${BASE}/projects/${id}/settings`, settings));
}

export async function createStylePlan(id: string): Promise<StylePlan> {
  return json(await claudeRequest(`${BASE}/projects/${id}/style-plan`, { method: "POST" }));
}

export async function saveStylePlan(id: string, plan: StylePlan): Promise<StylePlan> {
  return json(await put(`${BASE}/projects/${id}/style-plan`, plan));
}

export async function regenerateSection(id: string, index: number): Promise<StyleSection> {
  return json(await claudeRequest(`${BASE}/projects/${id}/style-plan/sections/${index}/regenerate`, { method: "POST" }));
}

export async function startRender(id: string, seconds?: number): Promise<RenderStatus> {
  const q = seconds ? `?seconds=${seconds}` : "";
  return json(await request(`${BASE}/projects/${id}/render${q}`, { method: "POST" }));
}

export async function renderStatus(id: string): Promise<RenderStatus | null> {
  const res = await request(`${BASE}/projects/${id}/render`);
  return res.status === 404 ? null : json(res);
}

export const videoUrl = (id: string, clip: boolean) => `${BASE}/projects/${id}/render/video?clip=${clip}`;

// 404 means "not created yet" for the optional artifacts, which is a normal state rather than an error.
async function orNull<T>(res: Response): Promise<T | null> {
  return res.status === 404 ? null : json<T>(res);
}

export const listProjects = async (): Promise<ProjectSummary[]> => json(await request(`${BASE}/projects`));
export const getProject = async (id: string): Promise<Project> => json(await request(`${BASE}/projects/${id}`));
export const getAnalysis = async (id: string) => orNull<AnalysisData>(await request(`${BASE}/projects/${id}/analysis`));
export const getLyrics = async (id: string) => orNull<Lyrics>(await request(`${BASE}/projects/${id}/lyrics`));
export const getStylePlan = async (id: string) => orNull<StylePlan>(await request(`${BASE}/projects/${id}/style-plan`));

export async function setLyricsText(id: string, text: string): Promise<void> {
  await json(await request(`${BASE}/projects/${id}/lyrics-text`, { method: "PUT", headers: { "content-type": "text/plain" }, body: text }));
}

export const startProcess = async (id: string): Promise<ProcessStatus> => json(await request(`${BASE}/projects/${id}/process`, { method: "POST" }));
export const processStatus = async (id: string) => orNull<ProcessStatus>(await request(`${BASE}/projects/${id}/process`));

export const getStoryboard = async (id: string) => orNull<Storyboard>(await request(`${BASE}/projects/${id}/storyboard`));
export const saveStoryboard = async (id: string, board: Storyboard): Promise<Storyboard> => json(await put(`${BASE}/projects/${id}/storyboard`, board));
export const generateStoryboard = async (id: string): Promise<Storyboard> => json(await claudeRequest(`${BASE}/projects/${id}/storyboard/generate`, { method: "POST" }));
export const regenerateScene = async (id: string, index: number): Promise<Scene> =>
  json(await claudeRequest(`${BASE}/projects/${id}/storyboard/scenes/${index}/regenerate`, { method: "POST" }));

export async function startIllustration(id: string, target?: { scenes?: number[]; characters?: string[]; objects?: string[] }): Promise<ProcessStatus> {
  const q = new URLSearchParams();
  target?.objects?.forEach((o) => q.append("object", o));
  target?.scenes?.forEach((n) => q.append("scene", String(n)));
  target?.characters?.forEach((c) => q.append("character", c));
  const qs = q.toString();
  return json(await claudeRequest(`${BASE}/projects/${id}/storyboard/illustrate${qs ? `?${qs}` : ""}`, { method: "POST" }));
}

export const illustrationStatus = async (id: string) => orNull<ProcessStatus>(await request(`${BASE}/projects/${id}/storyboard/illustrate`));

export const saveSectionDescriptions = async (id: string, descriptions: string[]): Promise<Project> => json(await put(`${BASE}/projects/${id}/section-descriptions`, descriptions));

const post = (url: string, body: unknown) => request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const openFolder = async (path: string): Promise<Project> => json(await post(`${BASE}/projects/open`, { path }));
export const saveProjectAs = async (id: string, location: string, name: string): Promise<Project> => json(await post(`${BASE}/projects/${id}/save-as`, { location, name }));
export const forgetProject = async (id: string): Promise<void> => {
  const res = await request(`${BASE}/projects/${id}/recent`, { method: "DELETE" });
  if (!res.ok) await json(res);
};
export const exportUrl = (id: string) => `${BASE}/projects/${id}/export`;

export async function importBundle(bundle: File, location = ""): Promise<Project> {
  const form = new FormData();
  form.append("bundle", bundle);
  if (location) form.append("location", location);
  return json(await request(`${BASE}/projects/import`, { method: "POST", body: form }));
}

export type FolderListing = { path: string; parent: string | null; home: string; is_project: boolean; dirs: { name: string; is_project: boolean }[] };
export const listFolder = async (path = ""): Promise<FolderListing> => json(await request(`${BASE}/fs/list?path=${encodeURIComponent(path)}`));
export const makeFolder = async (path: string): Promise<{ path: string }> => json(await post(`${BASE}/fs/mkdir`, { path }));
