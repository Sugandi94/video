const express = require('express');
const multer  = require('multer');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Tambahkan baris ini
ffmpeg.setFfmpegPath(ffmpegPath); // Dan ini

const app = express();
const PORT = 3100;
const UPLOAD_DIR = './uploads';
const DB_FILE = './database.json';
const PASSWORD_FILE = './password.json';
const ALLOWED_EXT = ['.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi'];
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PASSWORD_FILE)) fs.writeFileSync(PASSWORD_FILE, JSON.stringify({password: "MrSoe94"}));

const upload = multer({ 
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed!'));
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// Helper functions
function loadDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function findVideoById(id) {
  const db = loadDB();
  return db.find(v => v.id === id);
}
function getPassword() {
  try {
    return JSON.parse(fs.readFileSync(PASSWORD_FILE)).password;
  } catch {
    return "MrSoe94";
  }
}

// ==== UPLOAD ENDPOINT DENGAN AUTO THUMBNAIL ====
app.post('/upload', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  if (!req.files || !req.files.video) return res.status(400).send('No video uploaded!');
  const videoFile = req.files.video[0];
  const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

  const ext = path.extname(videoFile.originalname).toLowerCase();
  const mimetype = videoFile.mimetype || 'video/mp4';
  const id = videoFile.filename + ext;
  const newPath = path.join(UPLOAD_DIR, id);

  fs.renameSync(videoFile.path, newPath);

  let thumbnailName = '';
  if (thumbnailFile) {
    const thumbExt = path.extname(thumbnailFile.originalname).toLowerCase();
    thumbnailName = videoFile.filename + thumbExt;
    fs.renameSync(thumbnailFile.path, path.join(UPLOAD_DIR, thumbnailName));
    finish();
  } else {
    // Jika tidak ada thumbnail, generate otomatis dengan ffmpeg
    thumbnailName = videoFile.filename + ".jpg";
    ffmpeg(newPath)
      .on('end', finish)
      .on('error', function(err) {
        console.error('FFmpeg error:', err);
        finish(); // tetap simpan walau gagal generate thumb
      })
      .screenshots({
        timestamps: ['1'],
        filename: thumbnailName,
        folder: UPLOAD_DIR,
        size: '480x?'
      });
  }

  function finish() {
    const title = req.body.title || videoFile.originalname;
    const description = req.body.description || '';
    const db = loadDB();
    db.push({
      id,
      title,
      description,
      filename: id,
      mimetype,
      uploaded_at: new Date().toISOString(),
      thumbnail: thumbnailName
    });
    saveDB(db);
    res.status(200).send('OK');
  }
});

// ==== TAMPILAN VIDEO DENGAN POSTER DAN DELETE BUTTON SATU BARIS DENGAN JUDUL ====
// PAGINATION ditambahkan
app.get('/', (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page || "1", 10);
  const pageSize = parseInt(req.query.pageSize || "8", 10); // Bisa diubah sesuai kebutuhan

  // Get filtered videos
  let videos = loadDB().filter(
    v => v.title.toLowerCase().includes(search.toLowerCase()) ||
         v.description.toLowerCase().includes(search.toLowerCase())
  ).reverse();

  const totalVideos = videos.length;
  const totalPages = Math.max(1, Math.ceil(totalVideos / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));

  // Pagination slice
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  videos = videos.slice(startIdx, endIdx);

  const baseUrl = req.protocol + '://' + req.get('host');

  // Pagination HTML
  let paginationHtml = '';
  if (totalPages > 1) {
    paginationHtml = `<nav aria-label="Halaman video" style="margin-top:1em;">
      <ul class="pagination justify-content-center" style="flex-wrap:wrap;">
        <li class="page-item${currentPage === 1 ? ' disabled' : ''}">
          <a class="page-link" href="?search=${encodeURIComponent(search)}&page=${currentPage - 1}&pageSize=${pageSize}" aria-label="Sebelumnya">‹</a>
        </li>`;
    // Show max 5 page links, center current
    let minPage = Math.max(1, currentPage - 2);
    let maxPage = Math.min(totalPages, minPage + 4);
    if (maxPage - minPage < 4) minPage = Math.max(1, maxPage - 4);
    for (let i = minPage; i <= maxPage; i++) {
      paginationHtml += `
        <li class="page-item${i === currentPage ? ' active' : ''}">
          <a class="page-link" href="?search=${encodeURIComponent(search)}&page=${i}&pageSize=${pageSize}">${i}</a>
        </li>`;
    }
    paginationHtml += `
        <li class="page-item${currentPage === totalPages ? ' disabled' : ''}">
          <a class="page-link" href="?search=${encodeURIComponent(search)}&page=${currentPage + 1}&pageSize=${pageSize}" aria-label="Berikutnya">›</a>
        </li>
      </ul>
    </nav>`;
  }

  let html = `
  <html>
  <head>
    <meta charset="utf-8">
    <title>Powerful Video Uploader</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <!-- Bootstrap 5 CSS & Bootstrap Icons CDN -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <style>
      /* ...[style tidak berubah, sama seperti sebelumnya]... */
      :root {
        --main-blue: #2563eb;
        --main-cyan: #36d1c4;
        --bg: #f9fafb;
        --card-bg: #fff;
        --desc: #555;
        --meta: #aaa;
        --danger: #e74c3c;
        --danger-hover: #c0392b;
        --copy-bg: #edeff3;
      }
      body {
        font-family: 'Roboto', Arial, sans-serif;
        background: var(--bg);
        margin: 0;
        color: #222;
      }
      header {
        background: linear-gradient(90deg, #5b86e5 0%, #36d1c4 100%);
        color: white;
        padding: 2rem 1rem 1.5rem 1rem;
        text-align: center;
        box-shadow: 0 2px 8px rgba(44,62,80,0.08);
      }
      header h1 {
        margin: 0 0 0.5rem 0;
        font-size: 2.3rem;
        font-weight: 700;
        letter-spacing: 1px;
      }
      .container {
        width: 96vw;
        max-width: 1200px;
        margin: -2.2rem auto 2rem auto;
        background: var(--card-bg);
        border-radius: 16px;
        box-shadow: 0 6px 24px rgba(52,152,219,0.09);
        padding: 1.2rem 1vw 1.5rem 1vw;
      }
      form {
        margin-bottom: 1.3rem;
      }
      input[type="text"], textarea, input[type="file"], input[type="password"] {
        width: 100%;
        padding: 0.7rem;
        margin-bottom: 1rem;
        border: 1px solid #e3e6ea;
        border-radius: 6px;
        font-size: 1rem;
        background: #f8fafc;
      }
      input[type="text"]:focus, textarea:focus, input[type="password"]:focus {
        border: 1.5px solid var(--main-blue);
        outline: none;
      }
      textarea {
        min-height: 60px;
        resize: vertical;
      }
      button {
        background: linear-gradient(90deg, #5b86e5 0%, #36d1c4 100%);
        color: white;
        font-weight: bold;
        border: none;
        border-radius: 6px;
        padding: 0.7rem 2rem;
        cursor: pointer;
        font-size: 1.08rem;
        box-shadow: 0 2px 6px rgba(52,152,219,0.08);
        transition: background 0.3s, transform 0.2s;
      }
      button:hover {
        background: linear-gradient(90deg, #36d1c4 0%, #5b86e5 100%);
        transform: translateY(-2px) scale(1.03);
      }
      #notif { margin-bottom: 1rem; }
      .success { color: #27ae60; font-weight: 600; }
      .error { color: #e74c3c; font-weight: 600; }
      .search-box {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.3rem;
        align-items: center;
      }
      .search-box input[type="text"] {
        flex: 1;
        margin-bottom: 0;
      }
      .video-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.7rem;
        margin-top: 2rem;
      }
      .yt-card {
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(44, 62, 80, 0.07);
        padding: 0.7rem 0.7rem 1rem 0.7rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        position: relative;
        min-width: 0;
        max-width: 100%;
        height: 100%;
      }
      .yt-thumb {
        width: 100%;
        background: #222;
        border-radius: 8px;
        margin-bottom: 0.7rem;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        aspect-ratio: 16 / 9;
        position: relative;
      }
      .yt-thumb video {
        width: 100%;
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        background: #222;
        aspect-ratio: 16 / 9;
        object-fit: contain;
        background: #000;
        max-height: 320px;
        display: block;
      }
      /* Judul & delete 1 baris */
      .yt-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.7em;
        margin-bottom: 0.1em;
        margin-top: 0.2em;
      }
      .yt-title {
        font-size: 1.12rem;
        font-weight: bold;
        color: var(--main-blue);
        line-height: 1.2em;
        word-break: break-word;
        margin: 0;
        flex: 1;
        display: block;
      }
      .delete-btn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: var(--danger);
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.18s;
      }
      .delete-btn:hover, .delete-btn:focus {
        color: var(--danger-hover);
        background: none;
        outline: none;
        box-shadow: none;
      }
      .delete-btn i {
        font-size: 1.35em;
        vertical-align: -2px;
      }
      .yt-desc {
        color: var(--desc);
        font-size: 0.98rem;
        margin-bottom: 0.1em;
        line-height: 1.4em;
        word-break: break-word;
      }
      .yt-meta {
        font-size: 0.89rem;
        color: var(--meta);
        margin-bottom: 0.2em;
      }
      #loading-overlay {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: rgba(255,255,255,0.8);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        display: none;
      }
      .spinner {
        border: 8px solid #e3e6ea;
        border-top: 8px solid #36d1c4;
        border-radius: 50%;
        width: 65px;
        height: 65px;
        animation: spin 1s linear infinite;
        margin-bottom: 1.2rem;
      }
      @keyframes spin {
        0% { transform: rotate(0deg);}
        100% { transform: rotate(360deg);}
      }
      .loading-text {
        font-size: 1.15rem;
        color: #36d1c4;
        font-weight: 700;
        letter-spacing: 1px;
      }
      .modal {
        display: none; 
        position: fixed; 
        z-index: 10000;
        padding-top: 120px; 
        left: 0; top: 0;
        width: 100vw; height: 100vh;
        overflow: auto; background: rgba(0,0,0,0.20);
      }
      .modal-content {
        background: #fff;
        margin: auto;
        padding: 2em 1.5em 1.5em 1.5em;
        border-radius: 10px;
        max-width: 340px;
        box-shadow: 0 6px 16px rgba(52, 152, 219, 0.14);
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .modal-content label { font-weight: bold; }
      .modal-content input[type="password"] {
        margin-top: 0.7em;
        margin-bottom: 1em;
      }
      .modal-content .modal-btns {
        display: flex; 
        gap: 1em;
        justify-content: flex-end;
      }
      .modal-content .modal-btns button {
        padding: 0.55em 1.2em;
        font-size: 1em;
      }
      .modal-error {
        color: #e74c3c;
        margin-bottom: 0.5em;
        font-size: 0.98em;
      }
      .pagination {
        margin-top: 1.3em;
      }
      @media (max-width: 900px) {
        .container { max-width: 99vw; }
        .video-list { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      }
      @media (max-width: 600px) {
        header h1 {font-size:1.3rem;}
        .container { padding: 0.3rem; }
        .yt-meta { font-size:0.98rem;}
        .yt-title { font-size: 1.05rem;}
        .yt-desc { font-size: 0.98rem;}
        .modal-content { max-width: 98vw;}
        .yt-thumb video { max-height: 180px; }
      }
    </style>
  </head>
  <body>
    <div id="loading-overlay">
      <div class="spinner"></div>
      <div class="loading-text">Uploading...</div>
    </div>
    <!-- Modal Password -->
    <div id="modalDelete" class="modal">
      <div class="modal-content">
        <div style="font-weight:bold;margin-bottom:0.6em;font-size:1.1em;">Konfirmasi Hapus Video</div>
        <form id="deleteForm">
          <label for="deletePassword">Masukkan Password:</label>
          <input type="password" id="deletePassword" name="password" placeholder="Password" required autocomplete="current-password"/>
          <input type="hidden" id="deleteVideoId" name="videoId"/>
          <div class="modal-error" id="modalError"></div>
          <div class="modal-btns">
            <button type="button" onclick="closeModal()">Batal</button>
            <button type="submit" style="background:linear-gradient(90deg,#e74c3c,#c0392b);color:white;">Hapus</button>
          </div>
        </form>
      </div>
    </div>
    <header>
      <h1>Powerful Video Uploader</h1>
      <div style="font-size:1.18rem;font-weight:400;">Upload, cari, dan kelola video kamu dengan mudah!</div>
    </header>
    <div class="container">
      <form id="upload-form" action="/upload" method="POST" enctype="multipart/form-data">
        <input type="text" name="title" placeholder="Judul Video" required/>
        <textarea name="description" placeholder="Deskripsi Video"></textarea>
        <input type="file" name="video" accept="video/*" required/>
        <input type="file" name="thumbnail" accept="image/*"/>
        <button type="submit">Upload</button>
      </form>
      <div id="notif"></div>
      <form class="search-box" method="GET" action="/">
        <input type="text" name="search" placeholder="Cari judul/deskripsi video..." value="${search}">
        <button type="submit">Cari</button>
      </form>
      <h2 style="margin-top:0.5em;">Daftar Video</h2>
      <div class="video-list">
        ${videos.length === 0 ? '<i style="color:#aaa;">Tidak ada video.</i>' : ''}
        ${videos.map(v => `
          <div class="yt-card">
            <div class="yt-thumb">
              <video controls poster="${v.thumbnail ? (baseUrl+'/uploads/'+v.thumbnail) : ''}" preload="none">
                <source src="${baseUrl}/video/${v.id}" type="${v.mimetype}">
                Browser tidak mendukung video.
              </video>
            </div>
            <div class="yt-header-row">
              <div class="yt-title">${v.title}</div>
              <button class="delete-btn" onclick="showModal('${v.id}')" title="Hapus">
                <i class="bi bi-trash-fill"></i>
              </button>
            </div>
            <div class="yt-desc">${v.description}</div>
            <div class="yt-meta">Upload: ${dayjs(v.uploaded_at).format('YYYY-MM-DD HH:mm')}</div>
          </div>
        `).join('')}
      </div>
      ${paginationHtml}
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script>
      // Loading overlay
      const loadingOverlay = document.getElementById('loading-overlay');
      document.getElementById('upload-form').onsubmit = async function(e){
        e.preventDefault();
        var form = e.target;
        var data = new FormData(form);
        var notif = document.getElementById('notif');
        notif.textContent = '';
        loadingOverlay.style.display = "flex";
        try {
          let r = await fetch('/upload', { method:'POST', body:data });
          let t = await r.text();
          loadingOverlay.style.display = "none";
          if(r.status === 200) {
            notif.innerHTML = '<div class="success">Upload berhasil!</div>';
            setTimeout(()=>{ window.location.reload(); }, 1000);
          } else {
            notif.innerHTML = '<div class="error">'+t+'</div>';
          }
        } catch(e) {
          loadingOverlay.style.display = "none";
          notif.innerHTML = '<div class="error">Error saat upload</div>';
        }
      }
      // Delete modal logic
      function showModal(videoId) {
        document.getElementById('deleteVideoId').value = videoId;
        document.getElementById('deletePassword').value = '';
        document.getElementById('modalError').textContent = '';
        document.getElementById('modalDelete').style.display = 'block';
        document.getElementById('deletePassword').focus();
      }
      function closeModal() {
        document.getElementById('modalDelete').style.display = 'none';
      }
      document.getElementById('deleteForm').onsubmit = async function(e){
        e.preventDefault();
        var videoId = document.getElementById('deleteVideoId').value;
        var password = document.getElementById('deletePassword').value;
        var modalError = document.getElementById('modalError');
        modalError.textContent = '';
        try {
          let res = await fetch('/delete/'+encodeURIComponent(videoId), {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({password})
          });
          let txt = await res.text();
          if(res.status === 200) {
            closeModal();
            window.location.reload();
          } else {
            modalError.textContent = txt || 'Password salah!';
          }
        } catch(e) {
          modalError.textContent = 'Terjadi error!';
        }
      }
      window.onclick = function(event) {
        let modal = document.getElementById('modalDelete');
        if(event.target == modal) modal.style.display = "none";
      }
    </script>
  </body>
  </html>`;
  res.send(html);
});

// Stream video by ID
app.get('/video/:id', (req, res) => {
  const vid = findVideoById(req.params.id);
  if (!vid) return res.status(404).send("Not found");
  const filePath = path.join(UPLOAD_DIR, vid.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");

  const stat = fs.statSync(filePath);
  let range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Type': vid.mimetype,
      'Content-Length': stat.size
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size-1;
  const chunksize = (end-start)+1;
  const file = fs.createReadStream(filePath, {start, end});
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunksize,
    'Content-Type': vid.mimetype
  });
  file.pipe(res);
});

// Hapus video (dengan password, POST)
app.post('/delete/:id', (req, res) => {
  const { password } = req.body;
  const truePassword = getPassword();
  if (!password || password !== truePassword) {
    return res.status(401).send('Password salah!');
  }
  let db = loadDB();
  const idx = db.findIndex(v => v.id === req.params.id);
  if(idx === -1) return res.status(404).send("Video tidak ditemukan!");
  // Hapus file
  const filePath = path.join(UPLOAD_DIR, db[idx].filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  // Hapus thumbnail jika ada
  if (db[idx].thumbnail) {
    const thumbPath = path.join(UPLOAD_DIR, db[idx].thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  // Hapus metadata
  db.splice(idx,1);
  saveDB(db);
  res.status(200).send('OK');
});

// REST API: get all video metadata, with pagination
app.get('/api/videos', (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page || "1", 10);
  const pageSize = parseInt(req.query.pageSize || "8", 10);
  let videos = loadDB().filter(
    v => v.title.toLowerCase().includes(search.toLowerCase()) ||
         v.description.toLowerCase().includes(search.toLowerCase())
  ).reverse();

  const total = videos.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const items = videos.slice(startIdx, endIdx);

  res.json({
    total,
    totalPages,
    currentPage,
    pageSize,
    items
  });
});

// REST API: get one video metadata
app.get('/api/video/:id', (req, res) => {
  const vid = findVideoById(req.params.id);
  if (!vid) return res.status(404).json({error:'Not found'});
  res.json(vid);
});

// REST API: delete video
app.delete('/api/video/:id', (req, res) => {
  const password = req.body && req.body.password;
  const truePassword = getPassword();
  if (!password || password !== truePassword) {
    return res.status(401).json({error:'Password salah!'});
  }
  let db = loadDB();
  const idx = db.findIndex(v => v.id === req.params.id);
  if(idx === -1) return res.status(404).json({error:'Not found'});
  const filePath = path.join(UPLOAD_DIR, db[idx].filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  // Hapus thumbnail jika ada
  if (db[idx].thumbnail) {
    const thumbPath = path.join(UPLOAD_DIR, db[idx].thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  db.splice(idx,1);
  saveDB(db);
  res.json({success:true});
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});