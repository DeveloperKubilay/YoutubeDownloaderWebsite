import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const INFO_TIMEOUT_MS = 45_000;
const MAX_INFO_BYTES = 24 * 1024 * 1024;
const DOWNLOAD_STARTED_COOKIE = "ytDownloadStarted";
const YTDLP_REFERER = process.env.YTDLP_REFERER || "https://www.youtube.com/";

const modes = new Set(["full", "audio", "video-only"]);
const audioFormats = new Set(["m4a", "mp3"]);
const ytdlpCookiesFile = prepareYtdlpCookiesFile();
const videoEncoder = detectVideoEncoder();
let processingQueue = Promise.resolve();

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (requestUrl.pathname === "/") {
      await sendHome(res);
      return;
    }

    if (requestUrl.pathname === "/api/info") {
      await sendVideoInfo(requestUrl, res);
      return;
    }

    if (requestUrl.pathname === "/stream") {
      await enqueueProcessing(() => downloadProcessedFile(res, requestUrl));
      return;
    }

    sendText(res, 404, "Bulunamadı");
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      message: "Sunucuda beklenmeyen bir hata oldu."
    });
  }
});

server.listen(PORT, () => {
  console.log(`YT Stream hazır: http://localhost:${PORT}`);
  console.log(`Video encoder: ${videoEncoder.label}`);
  console.log(`yt-dlp cookies: ${ytdlpCookiesFile ? "aktif" : "yok"}`);
});

async function sendHome(res) {
  const html = await readFile(join(__dirname, "index.html"), "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

async function sendVideoInfo(requestUrl, res) {
  const targetUrl = cleanUrl(requestUrl.searchParams.get("url"));

  if (!targetUrl) {
    sendJson(res, 400, {
      ok: false,
      message: "Geçerli bir video linki gir."
    });
    return;
  }

  try {
    const info = await loadInfo(targetUrl);
    sendJson(res, 200, {
      ok: true,
      video: summarizeInfo(info)
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      ok: false,
      message: userSafeInfoError(error)
    });
  }
}

function enqueueProcessing(task) {
  const run = processingQueue.catch(() => {}).then(task);
  processingQueue = run.catch(() => {});
  return run;
}

async function downloadProcessedFile(res, requestUrl) {
  const targetUrl = cleanUrl(requestUrl.searchParams.get("url"));
  const mode = normalizeMode(requestUrl.searchParams.get("mode"));
  const quality = normalizeQuality(requestUrl.searchParams.get("quality"));
  const audioFormat = normalizeAudioFormat(requestUrl.searchParams.get("audioFormat"));
  const downloadToken = normalizeDownloadToken(requestUrl.searchParams.get("downloadToken"));

  if (!targetUrl) {
    sendText(res, 400, "Geçerli bir video linki gir.");
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "yt-stream-"));
  const format = buildFormatSelector(mode, quality);
  const sourceTemplate = join(tempDir, "%(title).200B.%(ext)s");
  const outputDir = join(tempDir, "processed");

  try {
    await mkdir(outputDir, { recursive: true });
    await runProcess("yt-dlp", buildYtdlpArgs(format, sourceTemplate, targetUrl, mode), tempDir);
    const sourceFile = await findSourceFile(tempDir);
    const filename = buildFileName(titleFromSourceFile(sourceFile), mode, audioFormat);
    const outputFile = join(outputDir, filename);

    await processWithFfmpeg(sourceFile, outputFile, mode, audioFormat, tempDir);
    await sendDownload(res, outputFile, filename, contentTypeForMode(mode, audioFormat), downloadToken);
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      sendText(res, 500, userSafeDownloadError(error));
    } else {
      res.destroy(error);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function loadInfo(targetUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", buildYtdlpInfoArgs(targetUrl), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Video bilgisi zaman aşımına uğradı."));
    }, INFO_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_INFO_BYTES) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(new Error("Video bilgisi çok büyük."));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp ${code} koduyla kapandı.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function buildYtdlpInfoArgs(targetUrl) {
  return [
    ...buildYtdlpCommonArgs(),
    "--dump-single-json",
    targetUrl
  ];
}

function buildYtdlpArgs(format, outputTemplate, targetUrl, mode) {
  const args = [
    ...buildYtdlpCommonArgs(),
    "--no-progress",
    "-f",
    format
  ];

  if (mode === "full") {
    args.push("--merge-output-format", "mp4");
  }

  args.push("-o", outputTemplate, targetUrl);
  return args;
}

function buildYtdlpCommonArgs() {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--referer",
    YTDLP_REFERER,
    "--add-header",
    "Accept-Language:tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
  ];

  if (process.env.YTDLP_USER_AGENT) {
    args.push("--user-agent", process.env.YTDLP_USER_AGENT);
  }

  if (ytdlpCookiesFile) {
    args.push("--cookies", ytdlpCookiesFile);
  }

  return args;
}

function prepareYtdlpCookiesFile() {
  const candidates = [
    process.env.YTDLP_COOKIES_FILE,
    process.env.YOUTUBE_COOKIES_FILE,
    "/etc/secrets/youtube-cookies.txt",
    "/etc/secrets/cookies.txt",
    join(__dirname, "youtube-cookies.txt"),
    join(__dirname, "cookies.txt")
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) return filePath;
    } catch {
      // Ignore unreadable optional paths and fall back to the next source.
    }
  }

  const rawCookies = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES || "";
  if (!rawCookies.trim()) return "";

  try {
    const cookieDir = join(tmpdir(), "yt-stream");
    const cookieFile = join(cookieDir, "youtube-cookies.txt");
    mkdirSync(cookieDir, { recursive: true });
    writeFileSync(cookieFile, normalizeCookiesText(rawCookies), {
      encoding: "utf8",
      mode: 0o600
    });
    return cookieFile;
  } catch (error) {
    console.error(`yt-dlp cookie env dosyaya yazılamadı: ${error.message}`);
    return "";
  }
}

function normalizeCookiesText(value) {
  let text = String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\r\n/g, "\n")
    .trim();

  const firstLine = text.split("\n", 1)[0] || "";
  if (!/^# (HTTP|Netscape) Cookie File/i.test(firstLine)) {
    text = `# Netscape HTTP Cookie File\n${text}`;
  }

  return `${text}\n`;
}

async function processWithFfmpeg(sourceFile, outputFile, mode, audioFormat, tempDir) {
  if (mode !== "audio" && sourceHasH264Video(sourceFile)) {
    try {
      await runProcess("ffmpeg", buildFfmpegCopyArgs(sourceFile, outputFile, mode), tempDir);
      return;
    } catch (error) {
      console.error(`Kaliteyi koruyan remux başarısız oldu, encode deneniyor.\n${error.message}`);
      await rm(outputFile, { force: true });
    }
  }

  try {
    await runProcess("ffmpeg", buildFfmpegArgs(sourceFile, outputFile, mode, audioFormat), tempDir);
  } catch (error) {
    if (mode === "audio" || videoEncoder.kind === "cpu") {
      throw error;
    }

    console.error(`${videoEncoder.label} başarısız oldu, CPU encode deneniyor.\n${error.message}`);
    await rm(outputFile, { force: true });
    await runProcess("ffmpeg", buildFfmpegArgs(sourceFile, outputFile, mode, audioFormat, cpuEncoder()), tempDir);
  }
}

function buildFfmpegCopyArgs(sourceFile, outputFile, mode) {
  const base = ["-y", "-hide_banner", "-loglevel", "error", "-i", sourceFile];

  if (mode === "video-only") {
    return [
      ...base,
      "-map",
      "0:v:0",
      "-an",
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      outputFile
    ];
  }

  return [
    ...base,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputFile
  ];
}

function buildFfmpegArgs(sourceFile, outputFile, mode, audioFormat, encoder = videoEncoder) {
  const base = ["-y", "-hide_banner", "-loglevel", "error", "-i", sourceFile];

  if (mode === "audio") {
    if (audioFormat === "mp3") {
      return [
        ...base,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputFile
      ];
    }

    return [
      ...base,
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputFile
    ];
  }

  if (mode === "video-only") {
    return [
      ...base,
      "-map",
      "0:v:0",
      "-an",
      ...videoEncodeArgs(encoder),
      "-movflags",
      "+faststart",
      outputFile
    ];
  }

  return [
    ...base,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    ...videoEncodeArgs(encoder),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputFile
  ];
}

function videoEncodeArgs(encoder = videoEncoder) {
  if (encoder.kind === "amd") {
    return [
      "-c:v",
      "h264_amf",
      "-usage",
      "transcoding",
      "-quality",
      "quality",
      "-rc",
      "cqp",
      "-qp_i",
      "14",
      "-qp_p",
      "14",
      "-qp_b",
      "16",
      "-pix_fmt",
      "yuv420p"
    ];
  }

  if (encoder.kind === "nvidia") {
    return [
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p7",
      "-tune",
      "hq",
      "-rc",
      "constqp",
      "-qp",
      "14",
      "-pix_fmt",
      "yuv420p"
    ];
  }

  if (encoder.kind === "intel") {
    return [
      "-c:v",
      "h264_qsv",
      "-preset",
      "veryslow",
      "-global_quality",
      "14",
      "-look_ahead",
      "1",
      "-pix_fmt",
      "nv12"
    ];
  }

  return [
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "14",
    "-pix_fmt",
    "yuv420p"
  ];
}

function sourceHasH264Video(sourceFile) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", sourceFile], {
    encoding: "utf8",
    windowsHide: true
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /Video:\s*h264\b/i.test(output);
}

function cpuEncoder() {
  return {
    kind: "cpu",
    label: "CPU libx264"
  };
}

function detectVideoEncoder() {
  const encoders = commandOutput("ffmpeg", ["-hide_banner", "-encoders"]).toLowerCase();
  const gpuName = commandOutput("powershell", [
    "-NoProfile",
    "-Command",
    "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ' | '"
  ]).toLowerCase();

  if (gpuName.includes("amd") || gpuName.includes("radeon")) {
    if (encoders.includes("h264_amf")) {
      return {
        kind: "amd",
        label: "AMD h264_amf"
      };
    }
  }

  if (gpuName.includes("nvidia")) {
    if (encoders.includes("h264_nvenc")) {
      return {
        kind: "nvidia",
        label: "NVIDIA h264_nvenc"
      };
    }
  }

  if (gpuName.includes("intel")) {
    if (encoders.includes("h264_qsv")) {
      return {
        kind: "intel",
        label: "Intel h264_qsv"
      };
    }
  }

  return cpuEncoder();
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true
  });

  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 10_000) stdout = stdout.slice(-10_000);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${code} koduyla kapandı.\n${stderr || stdout}`));
    });
  });
}

async function findSourceFile(tempDir) {
  const entries = await readdir(tempDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".part") || entry.name.endsWith(".ytdl")) continue;

    const filePath = join(tempDir, entry.name);
    const fileStat = await stat(filePath);
    candidates.push({ filePath, size: fileStat.size });
  }

  candidates.sort((a, b) => b.size - a.size);

  if (!candidates.length) {
    throw new Error("İndirilen kaynak dosya bulunamadı.");
  }

  return candidates[0].filePath;
}

async function sendDownload(res, filePath, filename, contentType, downloadToken) {
  const fileStat = await stat(filePath);
  const headers = {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  if (downloadToken) {
    headers["Set-Cookie"] = `${DOWNLOAD_STARTED_COOKIE}=${encodeURIComponent(downloadToken)}; Path=/; Max-Age=30; SameSite=Lax`;
  }

  res.writeHead(200, headers);

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    res.on("error", reject);
    res.on("finish", resolve);
    stream.pipe(res);
  });
}

function summarizeInfo(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const compatibleVideos = formats.filter((format) => hasVideo(format) && isMp4(format) && isH264(format));
  const fallbackVideos = formats.filter(hasVideo);
  const videoHeights = uniqueHeights(compatibleVideos.length ? compatibleVideos : fallbackVideos);
  const videoOnly = uniqueHeights(
    formats.filter((format) => hasVideo(format) && !hasAudio(format) && isMp4(format) && isH264(format))
  );

  return {
    title: info.title || "Video",
    uploader: info.uploader || info.channel || "",
    duration: formatDuration(info.duration),
    thumbnail: pickThumbnail(info),
    qualities: {
      full: videoHeights,
      videoOnly: videoOnly.length ? videoOnly : videoHeights
    }
  };
}

function hasVideo(format) {
  return format && isKnownCodec(format.vcodec) && Number(format.height) > 0;
}

function hasAudio(format) {
  return format && isKnownCodec(format.acodec);
}

function isMp4(format) {
  return format?.ext === "mp4" || format?.container?.includes("mp4");
}

function isH264(format) {
  return typeof format?.vcodec === "string" && format.vcodec.startsWith("avc1");
}

function isKnownCodec(codec) {
  return Boolean(codec && codec !== "none" && codec !== "unknown");
}

function uniqueHeights(formats) {
  return [...new Set(formats.map((format) => Number(format.height)).filter(Boolean))]
    .sort((a, b) => b - a);
}

function pickThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;

  if (!Array.isArray(info.thumbnails) || !info.thumbnails.length) {
    return "";
  }

  return info.thumbnails
    .filter((thumbnail) => thumbnail?.url)
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0]?.url || "";
}

function buildFormatSelector(mode, quality) {
  if (mode === "audio") {
    return "bestaudio[acodec^=mp4a][ext=m4a]/bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best";
  }

  if (mode === "video-only") {
    if (quality) {
      return [
        `bestvideo[height<=${quality}][vcodec^=avc1][ext=mp4]`,
        `bestvideo[height<=${quality}][vcodec^=avc1]`,
        `bestvideo[height<=${quality}][ext=mp4]`,
        `bestvideo[height<=${quality}]`,
        "bestvideo[vcodec^=avc1][ext=mp4]",
        "bestvideo[ext=mp4]",
        "bestvideo"
      ].join("/");
    }

    return [
      "bestvideo[vcodec^=avc1][ext=mp4]",
      "bestvideo[vcodec^=avc1]",
      "bestvideo[ext=mp4]",
      "bestvideo"
    ].join("/");
  }

  const audio = [
    "bestaudio[acodec^=mp4a][ext=m4a]",
    "bestaudio[ext=m4a]",
    "bestaudio[ext=mp4]",
    "bestaudio"
  ].join("/");
  const single = quality
    ? [
        `best[height<=${quality}][vcodec^=avc1][acodec^=mp4a][ext=mp4]`,
        `best[height<=${quality}][vcodec^=avc1][ext=mp4]`,
        `best[height<=${quality}][ext=mp4]`,
        `best[height<=${quality}]`,
        "best[vcodec^=avc1][acodec^=mp4a][ext=mp4]",
        "best[ext=mp4]",
        "best"
      ].join("/")
    : [
        "best[vcodec^=avc1][acodec^=mp4a][ext=mp4]",
        "best[vcodec^=avc1][ext=mp4]",
        "best[ext=mp4]",
        "best"
      ].join("/");
  const video = quality
    ? [
        `bestvideo[height<=${quality}][vcodec^=avc1][ext=mp4]`,
        `bestvideo[height<=${quality}][vcodec^=avc1]`,
        `bestvideo[height<=${quality}][ext=mp4]`,
        `bestvideo[height<=${quality}]`,
        "bestvideo[vcodec^=avc1][ext=mp4]",
        "bestvideo[ext=mp4]",
        "bestvideo"
      ].join("/")
    : [
        "bestvideo[vcodec^=avc1][ext=mp4]",
        "bestvideo[vcodec^=avc1]",
        "bestvideo[ext=mp4]",
        "bestvideo"
      ].join("/");

  return `(${video})+(${audio})/${single}`;
}

function cleanUrl(value) {
  if (!value || typeof value !== "string") return "";

  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return trimmed;
  } catch {
    return "";
  }
}

function normalizeMode(value) {
  return modes.has(value) ? value : "full";
}

function normalizeQuality(value) {
  if (!value || value === "best") return "";
  return /^\d{3,4}$/.test(value) ? value : "";
}

function normalizeDownloadToken(value) {
  if (!value || typeof value !== "string") return "";
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : "";
}

function titleFromSourceFile(filePath) {
  return sanitizeFileBase(basename(filePath, extname(filePath)));
}

function buildFileName(title, mode, audioFormat) {
  const extension = mode === "audio" ? audioFormat : "mp4";
  return `${sanitizeFileBase(title)}.${extension}`;
}

function sanitizeFileBase(value) {
  let safe = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);

  if (!safe) safe = "video";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) {
    safe = `${safe}-video`;
  }

  return safe;
}

function contentTypeForMode(mode, audioFormat) {
  if (mode === "audio") return audioFormat === "mp3" ? "audio/mpeg" : "audio/mp4";
  return "video/mp4";
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = Math.floor(total % 60);
  const parts = hours > 0
    ? [hours, minutes.toString().padStart(2, "0"), rest.toString().padStart(2, "0")]
    : [minutes, rest.toString().padStart(2, "0")];

  return parts.join(":");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function normalizeAudioFormat(value) {
  return audioFormats.has(value) ? value : "mp3";
}

function userSafeInfoError(error) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("zaman aşım")) {
    return "Video bilgileri zaman aşımına uğradı. Biraz sonra tekrar dene.";
  }

  if (isYoutubeBotChallenge(message)) {
    return "YouTube bu sunucu için oturum doğrulaması istiyor. Render'a youtube-cookies.txt secret file ekleyip tekrar deploy et.";
  }

  return "Video bilgileri alınamadı. Linki kontrol edip tekrar dene.";
}

function userSafeDownloadError(error) {
  const message = error instanceof Error ? error.message : "";

  if (isYoutubeBotChallenge(message)) {
    return "YouTube bu sunucu için oturum doğrulaması istiyor. Render'a youtube-cookies.txt secret file ekleyip tekrar deploy et.";
  }

  return "İndirme işlenemedi. ffmpeg/yt-dlp çıktısını kontrol et.";
}

function isYoutubeBotChallenge(message) {
  return /sign in to confirm (you.?re|you're) not a bot/i.test(message)
    || /use --cookies-from-browser or --cookies/i.test(message);
}
