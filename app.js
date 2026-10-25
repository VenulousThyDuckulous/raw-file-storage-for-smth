(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    token: localStorage.getItem("rfs_token") || "",
    repo: localStorage.getItem("rfs_repo") || "",
    branch: localStorage.getItem("rfs_branch") || "main",
    prefix: localStorage.getItem("rfs_prefix") || "storage",
    chunkSizeMB: Number(localStorage.getItem("rfs_chunk") || 20),
    file: null,
    cancel: false,
    results: null,
  };

  // ---- UI refs ----
  const els = {
    token: $("token"), repo: $("repo"), branch: $("branch"),
    prefix: $("prefix"), chunkSize: $("chunkSize"),
    saveConfig: $("saveConfig"), testConfig: $("testConfig"), configStatus: $("configStatus"),
    dropzone: $("dropzone"), fileInput: $("fileInput"), browseBtn: $("browseBtn"),
    fileInfo: $("fileInfo"), uploadBtn: $("uploadBtn"), cancelBtn: $("cancelBtn"),
    progressBar: $("progressBar"), progressText: $("progressText"),
    resultsCard: $("resultsCard"), resultsSummary: $("resultsSummary"),
    linksList: $("linksList"), manifestPreview: $("manifestPreview"),
    copyAllBtn: $("copyAllBtn"), copyDownloadBtn: $("copyDownloadBtn"), downloadBtn: $("downloadBtn"), newUploadBtn: $("newUploadBtn"),
  };

  // ---- init ----
  els.token.value = state.token;
  els.repo.value = state.repo;
  els.branch.value = state.branch;
  els.prefix.value = state.prefix;
  els.chunkSize.value = state.chunkSizeMB;

  els.saveConfig.addEventListener("click", () => {
    state.token = els.token.value.trim();
    state.repo = els.repo.value.trim();
    state.branch = els.branch.value.trim() || "main";
    state.prefix = els.prefix.value.trim() || "storage";
    state.chunkSizeMB = Math.min(90, Math.max(1, Number(els.chunkSize.value) || 20));
    localStorage.setItem("rfs_token", state.token);
    localStorage.setItem("rfs_repo", state.repo);
    localStorage.setItem("rfs_branch", state.branch);
    localStorage.setItem("rfs_prefix", state.prefix);
    localStorage.setItem("rfs_chunk", state.chunkSizeMB);
    setStatus("Settings saved.", "ok");
  });

  els.testConfig.addEventListener("click", async () => {
    syncConfigFromUI();
    try {
      await apiRepo();
      setStatus("Connection OK.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  function setStatus(msg, type) {
    els.configStatus.textContent = msg;
    els.configStatus.className = "status" + (type ? " " + type : "");
  }

  // ---- drag & drop ----
  els.browseBtn.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("click", (e) => {
    if (e.target === els.dropzone || e.target.tagName === "P") els.fileInput.click();
  });
  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files && els.fileInput.files[0]) selectFile(els.fileInput.files[0]);
  });
  ["dragenter", "dragover"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); })
  );
  els.dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) selectFile(f);
  });

  function selectFile(f) {
    state.file = f;
    els.fileInfo.textContent = `${f.name} — ${formatBytes(f.size)} (${f.type || "unknown type"})`;
    els.uploadBtn.disabled = false;
  }

  // ---- upload flow ----
  els.uploadBtn.addEventListener("click", () => startUpload());
  els.cancelBtn.addEventListener("click", () => { state.cancel = true; });

  function syncConfigFromUI() {
    state.token = els.token.value.trim();
    state.repo = els.repo.value.trim();
    state.branch = els.branch.value.trim() || "main";
    state.prefix = els.prefix.value.trim() || "storage";
    state.chunkSizeMB = Math.min(90, Math.max(1, Number(els.chunkSize.value) || 20));
  }

  async function startUpload() {
    if (!state.file) return;
    syncConfigFromUI();
    if (!state.token || !state.repo) {
      setStatus("Set token and repo first.", "err");
      return;
    }
    state.cancel = false;
    els.uploadBtn.disabled = true;
    els.cancelBtn.disabled = false;
    els.resultsCard.hidden = true;
    setProgress(0, "Preparing…");

    try {
      const { owner, repo } = parseRepo(state.repo);
      const branch = state.branch;
      const chunkBytes = state.chunkSizeMB * 1024 * 1024;
      const file = state.file;
      const totalChunks = Math.max(1, Math.ceil(file.size / chunkBytes));
      const safeName = sanitize(file.name);
      const id = `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const basePrefix = [state.prefix, id].filter(Boolean).join("/");

      // verify repo
      await apiRepo(owner, repo);

      const chunkUrls = [];
      let uploaded = 0;

      for (let i = 0; i < totalChunks; i++) {
        if (state.cancel) throw new Error("Cancelled by user.");
        const start = i * chunkBytes;
        const end = Math.min(file.size, start + chunkBytes);
        const blob = file.slice(start, end);
        const buf = await blob.arrayBuffer();
        const b64 = uint8ToBase64(new Uint8Array(buf));
        const chunkPath = `${basePrefix}/chunk_${String(i).padStart(4, "0")}.bin`;
        setProgress(
          Math.round((i / totalChunks) * 90),
          `Uploading chunk ${i + 1} of ${totalChunks}…`
        );
        await putFile(
          owner, repo, chunkPath, branch,
          `Upload chunk ${i + 1}/${totalChunks} of ${file.name}`,
          b64
        );
        chunkUrls.push(rawUrl(owner, repo, branch, chunkPath));
        uploaded++;
      }

      // manifest
      setProgress(92, "Uploading manifest…");
      const manifest = {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        chunkSize: chunkBytes,
        chunkCount: totalChunks,
        chunks: Array.from({ length: totalChunks }, (_, i) =>
          `chunk_${String(i).padStart(4, "0")}.bin`
        ),
        chunkUrls: chunkUrls.slice(),
        uploadedAt: new Date().toISOString(),
        storageRepo: `${owner}/${repo}`,
        branch,
        prefix: basePrefix,
      };
      const manifestPath = `${basePrefix}/manifest.json`;
      const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2))));
      await putFile(
        owner, repo, manifestPath, branch,
        `Add manifest for ${file.name}`,
        manifestB64
      );
      const manifestUrl = rawUrl(owner, repo, branch, manifestPath);

      state.results = { owner, repo, branch, basePrefix, chunkUrls, manifestUrl, manifest, totalChunks, fileName: file.name };

      setProgress(100, "Done.");
      renderResults();
    } catch (e) {
      setProgress(0, "Error: " + e.message);
    } finally {
      els.uploadBtn.disabled = false;
      els.cancelBtn.disabled = true;
    }
  }

  function renderResults() {
    const r = state.results;
    els.resultsCard.hidden = false;
    els.resultsSummary.textContent =
      `${r.fileName}: ${r.totalChunks} chunk(s). Manifest: ${r.manifestUrl}`;
    els.linksList.innerHTML = "";
    r.chunkUrls.forEach((u, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = u; a.textContent = `Chunk ${i} — ${u}`; a.target = "_blank"; a.rel = "noopener";
      const btn = document.createElement("button");
      btn.textContent = "Copy";
      btn.addEventListener("click", () => copyText(u));
      li.appendChild(a); li.appendChild(btn);
      els.linksList.appendChild(li);
    });
    const mli = document.createElement("li");
    const ma = document.createElement("a");
    ma.href = r.manifestUrl; ma.textContent = `Manifest — ${r.manifestUrl}`; ma.target = "_blank"; ma.rel = "noopener";
    const mb = document.createElement("button");
    mb.textContent = "Copy";
    mb.addEventListener("click", () => copyText(r.manifestUrl));
    mli.appendChild(ma); mli.appendChild(mb);
    els.linksList.appendChild(mli);

    els.manifestPreview.textContent = JSON.stringify(r.manifest, null, 2);
  }

  els.copyAllBtn.addEventListener("click", () => {
    if (!state.results) return;
    const text = [...state.results.chunkUrls, state.results.manifestUrl].join("\n");
    copyText(text);
  });

  els.copyDownloadBtn.addEventListener("click", () => {
    if (!state.results) return;
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("manifest", state.results.manifestUrl);
    copyText(url.toString());
  });

  els.downloadBtn.addEventListener("click", async () => {
    if (!state.results) return;
    try {
      setProgress(0, "Rebuilding file…");
      const r = state.results;
      const parts = [];
      for (let i = 0; i < r.chunkUrls.length; i++) {
        setProgress(Math.round((i / r.chunkUrls.length) * 90), `Fetching chunk ${i + 1}…`);
        const res = await fetch(r.chunkUrls[i]);
        if (!res.ok) throw new Error("Failed to fetch chunk " + i);
        parts.push(await res.arrayBuffer());
      }
      const blob = new Blob(parts, { type: r.manifest.type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      setProgress(100, "Download started.");
    } catch (e) {
      setProgress(0, "Error: " + e.message);
    }
  });

  els.newUploadBtn.addEventListener("click", () => {
    state.file = null;
    els.fileInput.value = "";
    els.fileInfo.textContent = "No file selected.";
    els.uploadBtn.disabled = true;
    els.resultsCard.hidden = true;
    setProgress(0, "");
  });

  async function reconstructFromManifestUrl(manifestUrl) {
    setProgress(0, "Loading manifest…");
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error("Failed to load manifest");
    const manifest = await res.json();
    const urls = Array.isArray(manifest.chunkUrls) && manifest.chunkUrls.length
      ? manifest.chunkUrls
      : (manifest.chunks || []).map((name) => {
          const [owner, repo] = String(manifest.storageRepo).split("/");
          return `https://raw.githubusercontent.com/${owner}/${repo}/${manifest.branch}/${manifest.prefix}/${name}`;
        });
    if (!urls.length) throw new Error("Manifest has no chunks");

    const parts = [];
    for (let i = 0; i < urls.length; i++) {
      setProgress(Math.round((i / urls.length) * 90), `Fetching chunk ${i + 1} of ${urls.length}…`);
      const r = await fetch(urls[i]);
      if (!r.ok) throw new Error("Failed to fetch chunk " + i);
      parts.push(await r.arrayBuffer());
    }
    const blob = new Blob(parts, { type: manifest.type || "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = manifest.name || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    setProgress(100, "Download started.");
  }

  // ---- helpers ----
  function setProgress(pct, text) {
    els.progressBar.style.width = pct + "%";
    els.progressText.textContent = text;
  }

  function parseRepo(s) {
    const parts = s.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Repo must be owner/repo");
    return { owner: parts[0], repo: parts[1] };
  }

  function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "file";
  }

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let i = -1;
    let v = n;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return v.toFixed(2) + " " + units[i];
  }

  function rawUrl(owner, repo, branch, path) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  function encodePath(p) {
    return p.split("/").map(encodeURIComponent).join("/");
  }

  async function apiRepo(owner, repo) {
    const target = owner && repo ? `${owner}/${repo}` : state.repo;
    const { owner: o, repo: r } = parseRepo(target);
    const res = await fetch(`https://api.github.com/repos/${o}/${r}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || "Repo access failed (" + res.status + ")");
    }
    return res.json();
  }

  async function putFile(owner, repo, path, branch, message, contentB64) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}`;
    const body = { message, content: contentB64, branch };
    const res = await fetch(url, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || "Upload failed (" + res.status + ")");
    }
    return res.json();
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function uint8ToBase64(uint8) {
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const sub = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  const __params = new URLSearchParams(location.search);
  const __m = __params.get("manifest");
  if (__m) {
    reconstructFromManifestUrl(__m).catch((e) => setProgress(0, "Error: " + e.message));
  }
})();