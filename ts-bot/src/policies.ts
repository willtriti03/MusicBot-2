function normalizeTrackValue(value) {
  return String(value || "").trim().toLowerCase();
}

function toTrackFingerprint(entryOrSource) {
  if (!entryOrSource) {
    return null;
  }

  if (typeof entryOrSource === "string") {
    const source = normalizeTrackValue(entryOrSource);
    return source
      ? {
          sources: [source],
          title: "",
          artist: ""
        }
      : null;
  }

  const sources = [
    entryOrSource.source,
    entryOrSource.originalUrl,
    entryOrSource.webpageUrl,
    entryOrSource.query
  ]
    .map(normalizeTrackValue)
    .filter(Boolean);

  const title = normalizeTrackValue(entryOrSource.title);
  const artist = normalizeTrackValue(entryOrSource.artist);

  if (sources.length === 0 && !title) {
    return null;
  }

  return {
    sources,
    title,
    artist
  };
}

function isEquivalentTrack(left, right) {
  const leftFingerprint = toTrackFingerprint(left);
  const rightFingerprint = toTrackFingerprint(right);
  if (!leftFingerprint || !rightFingerprint) {
    return false;
  }

  if (
    leftFingerprint.sources.some((source) =>
      rightFingerprint.sources.includes(source)
    )
  ) {
    return true;
  }

  if (!leftFingerprint.title || !rightFingerprint.title) {
    return false;
  }

  if (leftFingerprint.title !== rightFingerprint.title) {
    return false;
  }

  if (leftFingerprint.artist && rightFingerprint.artist) {
    return leftFingerprint.artist === rightFingerprint.artist;
  }

  return true;
}

function chooseNextAutoplayEntry(entries, lastEntry = "") {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  if (!lastEntry) {
    return entries[0];
  }

  return entries.find((entry) => !isEquivalentTrack(entry, lastEntry)) || null;
}

function chooseAutosimilarEntry(entries, lastEntry = null) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  if (!lastEntry) {
    return entries[0];
  }

  return entries.find((entry) => !isEquivalentTrack(entry, lastEntry)) || null;
}

function buildAutosimilarQuery(entry) {
  if (!entry || !entry.title) {
    return null;
  }

  const artist = entry.artist ? `${entry.artist} ` : "";
  return `${artist}${entry.title} audio`;
}

function shuffleEntries(entries) {
  const next = [...entries];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

module.exports = {
  buildAutosimilarQuery,
  chooseAutosimilarEntry,
  chooseNextAutoplayEntry,
  isEquivalentTrack,
  shuffleEntries
};
