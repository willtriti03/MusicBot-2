function chooseNextAutoplayEntry(entries, lastSource = "") {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  if (!lastSource) {
    return entries[0];
  }

  const normalized = String(lastSource).toLowerCase();
  return (
    entries.find((entry) => String(entry.source || "").toLowerCase() !== normalized) ||
    entries[0]
  );
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
  chooseNextAutoplayEntry,
  shuffleEntries
};
