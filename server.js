// const express = require("express");
// const { google } = require("googleapis");
// const fs = require("fs").promises;
// const path = require("path");
// const cors = require('cors');

// const app = express();
// app.use(express.json());
// app.use(cors());

// app.options('/movie.mp4', (req, res) => {
//   res.setHeader('Access-Control-Allow-Origin', '*');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, RANGE');
//   res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Type, Accept, Origin, User-Agent');
//   res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
//   res.setHeader('Access-Control-Allow-Private-Network', 'true');
//   res.setHeader('Access-Control-Max-Age', '86400');
//   res.sendStatus(204);
// });

// const MOVIE_FILE = path.join(__dirname, "movie.json");
// const SERVICE_ACCOUNT_FILE = path.join(__dirname, "service-account-key.json");

// let cachedFileId = null;
// let cacheTimestamp = 0;
// const CACHE_TTL = 5000;

// async function getFileId() {
//   const now = Date.now();
//   if (cachedFileId && (now - cacheTimestamp) < CACHE_TTL) return cachedFileId;
//   try {
//     const data = await fs.readFile(MOVIE_FILE, "utf8");
//     const { fileId } = JSON.parse(data);
//     if (!fileId) throw new Error("fileId missing");
//     cachedFileId = fileId;
//     cacheTimestamp = now;
//     return fileId;
//   } catch (err) {
//     throw new Error("Unable to read movie config: " + err.message);
//   }
// }

// async function getDriveClient() {
//   let auth;
//   if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
//     try {
//       const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
//       auth = new google.auth.GoogleAuth({
//         credentials: key,
//         scopes: ["https://www.googleapis.com/auth/drive.readonly"],
//       });
//       console.log("✅ Authenticated using Environment Variable.");
//     } catch (e) {
//       console.error("❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", e.message);
//       throw e;
//     }
//   } else {
//     try {
//       auth = new google.auth.GoogleAuth({
//         keyFile: SERVICE_ACCOUNT_FILE,
//         scopes: ["https://www.googleapis.com/auth/drive.readonly"],
//       });
//       console.log("✅ Authenticated using local service-account-key.json file.");
//     } catch (e) {
//       console.error("❌ Failed to load local service account file:", e.message);
//       throw e;
//     }
//   }
//   return google.drive({ version: "v3", auth });
// }

// const API_KEY = process.env.API_KEY || "change_me";
// app.post("/update-movie", async (req, res) => {
//   const { fileId, apiKey } = req.body;
//   if (apiKey !== API_KEY) {
//     return res.status(403).json({ success: false, message: "Invalid API key" });
//   }
//   if (!fileId) {
//     return res.status(400).json({ success: false, message: "fileId is required" });
//   }
//   try {
//     await fs.writeFile(MOVIE_FILE, JSON.stringify({ fileId }, null, 2));
//     cachedFileId = fileId;
//     cacheTimestamp = Date.now();
//     res.json({ success: true, message: "Movie updated", fileId });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // ================================================================
// // 🔥 THE SEEKING-GUARANTEED API VERSION (ANY FILE SIZE)
// // ================================================================
// app.get("/movie.mp4", async (req, res) => {
//   try {
//     const fileId = await getFileId();
//     const drive = await getDriveClient();

//     // --- 1. Get total file size from metadata ---
//     const metadata = await drive.files.get({
//       fileId: fileId,
//       fields: 'size'
//     });
//     const totalSize = parseInt(metadata.data.size);
//     console.log(`📦 Total File Size: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);

//     // --- 2. Force a Range request to Google Drive ---
//     // 🔥 CRITICAL: ALWAYS send a Range header to Google Drive
//     // This guarantees we get a 206 response with Content-Range
//     let rangeToGoogle = req.headers.range;
//     if (!rangeToGoogle) {
//       rangeToGoogle = 'bytes=0-';
//       console.log(`📡 Browser sent NO range. Forcing Google Drive range: bytes=0-`);
//     } else {
//       console.log(`📡 Browser sent range: ${rangeToGoogle}`);
//     }

//     // Build the request to Google Drive
//     const requestConfig = {
//       responseType: "stream",
//       headers: { 
//         Range: rangeToGoogle,
//         'Accept-Encoding': 'identity' // Prevents compression which can break range requests
//       }
//     };

//     const response = await drive.files.get(
//       { fileId: fileId, alt: "media" },
//       requestConfig
//     );

//     const stream = response.data;

//     // --- 3. Set ALL headers required for seeking ---
//     // CORS
//     res.setHeader('Access-Control-Allow-Origin', '*');
//     res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
//     res.setHeader('Access-Control-Allow-Private-Network', 'true');
    
//     // SEEKING: These are the critical headers that enable seeking
//     res.setHeader('Accept-Ranges', 'bytes'); // ← Tells browser we support seeking
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
//     res.setHeader('Content-Disposition', 'inline; filename="movie.mp4"');

//     // --- 4. Process Google Drive's response ---
//     let statusCode = 200;
//     let contentLength = null;

//     if (response.headers) {
//       const headers = response.headers;

//       // Content-Type
//       if (headers["content-type"]) {
//         res.setHeader("Content-Type", headers["content-type"]);
//       }

//       // 🔥 SEEKING: Check for Content-Range (this is what enables seeking)
//       if (headers["content-range"]) {
//         statusCode = 206; // Partial Content = SEEKING ENABLED
//         res.setHeader('Content-Range', headers["content-range"]);
        
//         if (headers["content-length"]) {
//           contentLength = parseInt(headers["content-length"]);
//           res.setHeader('Content-Length', headers["content-length"]);
//         }
        
//         console.log(`✅ SEEKING ENABLED: Google Drive returned 206 with Content-Range: ${headers["content-range"]}`);
//       } else {
//         // Fallback: If Google returns 200, we still send the total size
//         statusCode = 200;
//         if (headers["content-length"]) {
//           contentLength = parseInt(headers["content-length"]);
//           res.setHeader('Content-Length', headers["content-length"]);
//         }
//         console.log(`⚠️ SEEKING MAY NOT WORK: Google Drive returned 200 (no Content-Range).`);
//       }
//     }

//     // Fallback content-type
//     if (!res.getHeader("Content-Type")) {
//       res.setHeader("Content-Type", "video/mp4");
//     }

//     // Safety net: If we have totalSize but no contentLength, send totalSize
//     if (!contentLength && totalSize) {
//       res.setHeader('Content-Length', totalSize.toString());
//     }

//     console.log(`🔥 Response: Status ${statusCode}, Content-Length: ${res.getHeader('Content-Length') || 'Unknown'}, Accept-Ranges: ${res.getHeader('Accept-Ranges')}`);

//     res.status(statusCode);

//     // --- 5. Stream the file ---
//     stream.pipe(res);

//     // Handle client disconnect
//     res.on('close', () => {
//       console.log('🛑 Client closed connection.');
//       stream.destroy();
//     });

//     stream.on('error', (err) => {
//       if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
//         console.log('🔌 Client disconnected normally.');
//       } else {
//         console.error('❌ Stream error:', err);
//         if (!res.headersSent) {
//           res.status(500).send('Error streaming file');
//         }
//       }
//     });

//   } catch (err) {
//     console.error("❌ Fatal error:", err.message);
//     if (!res.headersSent) {
//       if (err.code === 404) res.status(404).send("Movie not found");
//       else res.status(500).send("Internal server error");
//     }
//   }
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`🚀 Server running: http://localhost:${PORT}/movie.mp4`);
// });



const express = require("express");
const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.options('/movie.mp4', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, RANGE');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Type, Accept, Origin, User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

const MOVIE_FILE = path.join(__dirname, "movie.json");
const SERVICE_ACCOUNT_FILE = path.join(__dirname, "service-account-key.json");

let cachedFileId = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000;

async function getFileId() {
  const now = Date.now();
  if (cachedFileId && (now - cacheTimestamp) < CACHE_TTL) return cachedFileId;
  try {
    const data = await fs.readFile(MOVIE_FILE, "utf8");
    const { fileId } = JSON.parse(data);
    if (!fileId) throw new Error("fileId missing");
    cachedFileId = fileId;
    cacheTimestamp = now;
    return fileId;
  } catch (err) {
    throw new Error("Unable to read movie config: " + err.message);
  }
}

// --- SMART DRIVE CLIENT (Works locally AND on Render) ---
async function getDriveClient() {
  let auth;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      });
      console.log("✅ Authenticated using Environment Variable.");
    } catch (e) {
      console.error("❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", e.message);
      throw e;
    }
  } else {
    try {
      auth = new google.auth.GoogleAuth({
        keyFile: SERVICE_ACCOUNT_FILE,
        scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      });
      console.log("✅ Authenticated using local service-account-key.json file.");
    } catch (e) {
      console.error("❌ Failed to load local service account file:", e.message);
      throw e;
    }
  }

  return google.drive({ version: "v3", auth });
}

const API_KEY = process.env.API_KEY || "change_me";
app.post("/update-movie", async (req, res) => {
  const { fileId, apiKey } = req.body;
  if (apiKey !== API_KEY) {
    return res.status(403).json({ success: false, message: "Invalid API key" });
  }
  if (!fileId) {
    return res.status(400).json({ success: false, message: "fileId is required" });
  }
  try {
    await fs.writeFile(MOVIE_FILE, JSON.stringify({ fileId }, null, 2));
    cachedFileId = fileId;
    cacheTimestamp = Date.now();
    res.json({ success: true, message: "Movie updated", fileId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// 🏆 STREAM ROUTE — uses the Drive API (not the public uc?export=
// download link). The public link returns an HTML "can't scan for
// viruses" confirmation page instead of the real file for large
// videos, which is why Content-Length/duration looked wrong. The
// authenticated API endpoint streams raw bytes regardless of size.
// ================================================================
app.get("/movie.mp4", async (req, res) => {
  try {
    const fileId = await getFileId();
    const drive = await getDriveClient();

    console.log(`📡 Range header from client: ${req.headers.range || 'None'}`);

    // Params for the Drive API call itself (fileId, alt, etc.)
    const params = { fileId, alt: "media" };

    // Actual HTTP request options — Range headers MUST go here,
    // not in params, or Drive silently ignores them.
    const gaxiosOptions = { responseType: "stream" };
    if (req.headers.range) {
      gaxiosOptions.headers = { Range: req.headers.range };
      console.log(`📤 Forwarding Range to Drive API: ${req.headers.range}`);
    }

    const response = await drive.files.get(params, gaxiosOptions);
    const stream = response.data;
    console.log(`📥 Drive API status: ${response.status}`);

    // --- CORS / response headers ---
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Content-Disposition', 'inline; filename="movie.mp4"');

    // Advertise range support up front regardless of what Drive sends back
    res.setHeader('Accept-Ranges', 'bytes');

    // response.headers may be a WHATWG Headers object (fetch-based gaxios)
    // or a plain object (older gaxios) depending on googleapis version —
    // handle both instead of assuming bracket access works.
    function getHeaderValue(headers, name) {
      if (!headers) return undefined;
      if (typeof headers.get === 'function') return headers.get(name);
      return headers[name] || headers[name.toLowerCase()];
    }

    const contentType = getHeaderValue(response.headers, 'content-type');
    const contentLength = getHeaderValue(response.headers, 'content-length');
    const contentRange = getHeaderValue(response.headers, 'content-range');
    const acceptRanges = getHeaderValue(response.headers, 'accept-ranges');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      console.log(`✅ Drive returned Content-Range: ${contentRange}`);
    }
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    // Trust Drive's actual status (200 or 206) rather than re-deriving it
    const statusCode = response.status || (contentRange ? 206 : 200);

    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'video/mp4');

    res.status(statusCode);
    console.log(`🔥 Sending Status: ${statusCode}`);

    stream.pipe(res);

    res.on('close', () => {
      console.log('🛑 Client closed connection.');
      stream.destroy();
    });

    stream.on('error', (err) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
        console.log('🔌 Client disconnected normally.');
      } else {
        console.error('❌ Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send('Error streaming file');
        }
      }
    });

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    if (!res.headersSent) {
      if (err.code === 404) {
        res.status(404).send('Movie not found');
      } else {
        res.status(500).send('Internal server error');
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}/movie.mp4`);
});