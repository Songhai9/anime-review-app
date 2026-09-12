const ANILIST_URL = "https://graphql.anilist.co";
const ALLOWED_TYPES = new Set(["ANIME", "MANGA"]);

function assertMediaType(type) {
  const normalizedType = type?.toUpperCase();
  if (!ALLOWED_TYPES.has(normalizedType)) {
    throw new Error("Media type must be ANIME or MANGA.");
  }
  return normalizedType;
}

function decodeHtmlEntities(text = "") {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function cleanSynopsis(description) {
  if (!description) return "";
  return decodeHtmlEntities(
    description
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function chooseTitle(title) {
  return title?.english || title?.romaji || title?.native || "Untitled";
}

function findMangaAuthor(staffEdges = []) {
  const preferredRole = staffEdges.find((edge) =>
    /(story|original creator|creator|art)/i.test(edge.role || ""),
  );
  return preferredRole?.node?.name?.full || staffEdges[0]?.node?.name?.full || null;
}

function normalizeMedia(item) {
  const studio = item.studios?.nodes?.[0]?.name || null;
  const author = item.type === "MANGA" ? findMangaAuthor(item.staff?.edges) : null;
  return {
    anilistId: item.id,
    mediaType: item.type,
    title: chooseTitle(item.title),
    romajiTitle: item.title?.romaji || "",
    nativeTitle: item.title?.native || "",
    author,
    studio: item.type === "ANIME" ? studio : null,
    creator: item.type === "ANIME" ? studio : author,
    creatorLabel: item.type === "ANIME" ? "Studio" : "Author",
    synopsis: cleanSynopsis(item.description),
    coverUrl: item.coverImage?.extraLarge || item.coverImage?.large || "",
    siteUrl: item.siteUrl || "",
  };
}

async function requestAniList(query, variables) {
  const response = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errors?.length) {
    const message = payload?.errors?.[0]?.message || `AniList returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data;
}

const MEDIA_FIELDS = `
  id type
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large }
  siteUrl
  studios(isMain: true) { nodes { name } }
  staff(perPage: 12) { edges { role node { name { full } } } }
`;

export async function searchMedia(search, type) {
  const normalizedSearch = search?.trim();
  const normalizedType = assertMediaType(type);
  if (!normalizedSearch) return [];
  const query = `
    query SearchMedia($search: String!, $type: MediaType!) {
      Page(page: 1, perPage: 12) {
        media(search: $search, type: $type, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }
  `;
  const data = await requestAniList(query, { search: normalizedSearch, type: normalizedType });
  return (data.Page?.media || []).map(normalizeMedia);
}

export async function getMediaById(anilistId, type) {
  const id = Number.parseInt(anilistId, 10);
  const normalizedType = assertMediaType(type);
  if (!Number.isInteger(id) || id < 1) return null;
  const query = `
    query MediaById($id: Int!, $type: MediaType!) {
      Media(id: $id, type: $type) { ${MEDIA_FIELDS} }
    }
  `;
  const data = await requestAniList(query, { id, type: normalizedType });
  return data.Media ? normalizeMedia(data.Media) : null;
}
