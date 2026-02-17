const API = "/api";

async function parseErrorResponse(res, fallback) {
  try {
    const body = await res.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/files/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      await parseErrorResponse(res, `Upload failed (${res.status})`),
    );
  }
  return res.json();
}

export async function downloadYouTube(url) {
  const res = await fetch(`${API}/files/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(
      await parseErrorResponse(res, `YouTube download failed (${res.status})`),
    );
  }
  return res.json();
}

export async function createJob(params) {
  const res = await fetch(`${API}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(
      await parseErrorResponse(res, `Job creation failed (${res.status})`),
    );
  }
  return res.json();
}

export function subscribeToJob(jobId) {
  return new EventSource(`${API}/jobs/${jobId}/events`);
}

export async function getJob(jobId) {
  const res = await fetch(`${API}/jobs/${jobId}`);
  return res.json();
}

export async function getApiKeyStatus() {
  const res = await fetch(`${API}/settings/apiKeyStatus`);
  return res.json();
}

export async function getLanguages() {
  const res = await fetch(`${API}/settings/languages`);
  return res.json();
}

export async function selectOutputFolder() {
  const res = await fetch(`${API}/settings/selectOutputFolder`);
  return res.json();
}

export async function getDefaultFolder() {
  const res = await fetch(`${API}/settings/defaultFolder`);
  return res.json();
}
