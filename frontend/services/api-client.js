const baseUrl = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message || "The API request failed.",
      payload?.error || "api_error",
    );
  }
  return payload;
}

export const api = {
  async getReaders() {
    return (await apiRequest("/api/readers")).readers;
  },
  async getReader(readerId) {
    return (await apiRequest(`/api/readers/${readerId}`)).reader;
  },
  async createReader(values) {
    return (await apiRequest("/api/readers", { method: "POST", body: JSON.stringify(values) })).reader;
  },
  async getLibrary(readerId, sort) {
    const query = new URLSearchParams({ sort });
    return apiRequest(`/api/readers/${readerId}/library?${query}`);
  },
  async searchMedia(query, type) {
    const params = new URLSearchParams({ q: query, type });
    return (await apiRequest(`/api/media/search?${params}`)).results;
  },
  async getMedia(anilistId, type) {
    return (await apiRequest(`/api/media/${type}/${anilistId}`)).media;
  },
  async createReview(readerId, values) {
    return apiRequest(`/api/readers/${readerId}/media`, {
      method: "POST",
      body: JSON.stringify(values),
    });
  },
  async getEntry(readerId, entryId) {
    return (await apiRequest(`/api/readers/${readerId}/media/${entryId}`)).entry;
  },
  async updateEntry(readerId, entryId, values) {
    return apiRequest(`/api/readers/${readerId}/media/${entryId}`, {
      method: "PUT",
      body: JSON.stringify(values),
    });
  },
  async deleteEntry(readerId, entryId) {
    return apiRequest(`/api/readers/${readerId}/media/${entryId}`, { method: "DELETE" });
  },
};
