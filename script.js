// ====== ADMIN MODE CONFIGURATION ======
const ADMIN_PASSWORD = "admin123"; // Can be changed later
let isAdminMode = false;

// ====== GOOGLE APPS SCRIPT CONFIGURATION ======
// Replace this with your deployed GAS Web App URL
const GAS_URL = "https://script.google.com/macros/s/AKfycby3cjolj5rzofy2oaicPT8544QHXF5cLziBH56sHLWulniJ3geGdtS4_pszdPVZ_DKy_Q/exec";
let isGASConnected = false; // Will be true if GAS is available

// ====== GOOGLE APPS SCRIPT SYNC FUNCTIONS ======
// No OAuth needed! GAS handles everything server-side

// Check if GAS is available
async function checkGASConnection() {
  if (!GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) {
    console.log("GAS URL not configured");
    isGASConnected = false;
    updateGASSyncStatus("local");
    return false;
  }
  
  try {
    const response = await fetch(`${GAS_URL}?action=getPosts`, {
      method: "GET",
      mode: "cors"
    });
    
    if (response.ok) {
      isGASConnected = true;
      updateGASSyncStatus("synced");
      console.log("✅ GAS connected successfully");
      return true;
    } else {
      throw new Error("GAS not responding");
    }
  } catch (error) {
    console.log("GAS not available:", error.message);
    isGASConnected = false;
    updateGASSyncStatus("local");
    return false;
  }
}

// Save post to GAS (no auth needed!)
async function savePostToGAS(post) {
  if (!GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) {
    return { status: "local", message: "GAS not configured" };
  }

  try {
    updateGASSyncStatus("uploading");
    
    const response = await fetch(GAS_URL, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "savePost",
        post: post
      })
    });

    // GAS returns JSON but we need to handle CORS
    const result = await response.json().catch(() => ({ status: "ok" }));
    
    post.syncStatus = "synced";
    post.syncedAt = new Date().toISOString();
    updateGASSyncStatus("synced");
    
    return { status: "synced", result };
  } catch (error) {
    console.error("GAS save error:", error);
    post.syncStatus = "error";
    updateGASSyncStatus("error");
    
    // Queue for retry
    queueForGASSync(post);
    
    return { status: "error", error: error.message };
  }
}

// Update post in GAS
async function updatePostInGAS(post) {
  if (!GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) {
    return { status: "local", message: "GAS not configured" };
  }

  try {
    updateGASSyncStatus("uploading");
    
    const response = await fetch(GAS_URL, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "updatePost",
        post: post
      })
    });

    const result = await response.json().catch(() => ({ status: "ok" }));
    
    post.syncStatus = "synced";
    post.syncedAt = new Date().toISOString();
    updateGASSyncStatus("synced");
    
    return { status: "synced", result };
  } catch (error) {
    console.error("GAS update error:", error);
    post.syncStatus = "error";
    updateGASSyncStatus("error");
    queueForGASSync(post);
    return { status: "error" };
  }
}

// Delete post from GAS
async function deletePostFromGAS(postId) {
  if (!GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) {
    return { status: "local", message: "GAS not configured" };
  }

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "deletePost",
        postId: postId
      })
    });

    const result = await response.json().catch(() => ({ status: "ok" }));
    return { status: "synced", result };
  } catch (error) {
    console.error("GAS delete error:", error);
    return { status: "error" };
  }
}

// Load all posts from GAS (public - no auth needed!)
async function loadPostsFromGAS() {
  if (!GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) {
    console.log("GAS URL not configured, skipping cloud load");
    return;
  }

  try {
    console.log("Loading posts from GAS...");
    updateGASSyncStatus("uploading");
    
    const response = await fetch(`${GAS_URL}?action=getPosts`, {
      method: "GET",
      mode: "cors"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status === "ok" && data.posts) {
      const db = await dbPromise;
      let newPostsCount = 0;
      
      for (const post of data.posts) {
        // Check if we have this post locally
        const tx = db.transaction(POSTS_STORE, "readonly");
        const store = tx.objectStore(POSTS_STORE);
        const checkReq = store.get(post.id);
        
        const existingPost = await new Promise((resolve) => {
          checkReq.onsuccess = () => resolve(checkReq.result);
          checkReq.onerror = () => resolve(null);
        });

        // If post doesn't exist locally or GAS version is newer
        if (!existingPost || (post.updatedAt && new Date(post.updatedAt) > new Date(existingPost.updatedAt || existingPost.createdAt))) {
          // Save to IndexedDB
          const writeTx = db.transaction(POSTS_STORE, "readwrite");
          const writeStore = writeTx.objectStore(POSTS_STORE);
          writeStore.put(post);
          newPostsCount++;
        }
      }

      if (newPostsCount > 0) {
        console.log(`Loaded ${newPostsCount} new/updated posts from GAS`);
        renderCalendar(currentYear, currentMonth);
      }
      
      isGASConnected = true;
      updateGASSyncStatus("synced");
    }
  } catch (error) {
    console.error("Error loading from GAS:", error);
    isGASConnected = false;
    updateGASSyncStatus("local");
  }
}

// Queue post for GAS sync
async function queueForGASSync(post) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    store.put({ id: post.id, post: post, timestamp: Date.now(), type: "gas" });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Process GAS sync queue
async function processGASSyncQueue() {
  if (!navigator.onLine || !GAS_URL || GAS_URL.includes("YOUR_SCRIPT_ID")) return;

  const db = await dbPromise;
  const tx = db.transaction("syncQueue", "readonly");
  const store = tx.objectStore("syncQueue");
  const request = store.getAll();

  request.onsuccess = async () => {
    const queue = request.result || [];
    const gasQueue = queue.filter(item => item.type === "gas" || !item.type);
    
    for (const item of gasQueue) {
      try {
        const result = await savePostToGAS(item.post);
        if (result.status === "synced") {
          // Remove from queue
          const deleteTx = db.transaction("syncQueue", "readwrite");
          const deleteStore = deleteTx.objectStore("syncQueue");
          deleteStore.delete(item.id);
        }
      } catch (err) {
        console.error("GAS sync queue error:", err);
      }
    }
  };
}

// Update GAS sync status UI
function updateGASSyncStatus(status) {
  const statusEl = document.getElementById("driveSyncStatus");
  const iconEl = document.getElementById("driveSyncIcon");
  const textEl = document.getElementById("driveSyncText");
  const badgeEl = document.getElementById("syncStatusBadge");
  const dotEl = document.getElementById("syncDot");
  const text2El = document.getElementById("syncText");

  if (!statusEl) return;

  statusEl.classList.remove("hidden", "uploading", "synced", "error");
  badgeEl?.classList.remove("local", "uploading", "synced", "error");

  switch (status) {
    case "uploading":
      statusEl.classList.add("uploading");
      if (iconEl) iconEl.textContent = "🔄";
      if (textEl) textEl.textContent = "Syncing...";
      badgeEl?.classList.add("uploading");
      if (dotEl) dotEl.textContent = "●";
      if (text2El) text2El.textContent = "Syncing";
      break;
    case "synced":
      statusEl.classList.add("synced");
      if (iconEl) iconEl.textContent = "☁️";
      if (textEl) textEl.textContent = "Cloud Synced";
      badgeEl?.classList.add("synced");
      if (dotEl) dotEl.textContent = "✓";
      if (text2El) text2El.textContent = "Synced";
      break;
    case "error":
      statusEl.classList.add("error");
      if (iconEl) iconEl.textContent = "⚠️";
      if (textEl) textEl.textContent = "Sync failed";
      badgeEl?.classList.add("error");
      if (dotEl) dotEl.textContent = "✗";
      if (text2El) text2El.textContent = "Error";
      break;
    default: // local
      statusEl.classList.add("hidden");
      badgeEl?.classList.add("local");
      if (dotEl) dotEl.textContent = "●";
      if (text2El) text2El.textContent = "Local";
  }
}

// Initialize GAS when page loads
window.addEventListener("load", () => {
  // Initialize admin mode (login button, modal handlers)
  initAdminMode();
  
  // Check GAS connection and load posts
  setTimeout(async () => {
    await checkGASConnection();
    await loadPostsFromGAS();
  }, 1000);
});

// Process sync queue when coming online
window.addEventListener("online", () => {
  console.log("Back online - syncing to GAS...");
  processGASSyncQueue();
});

// ====== ELEMENT REFERENSI KALENDER ======
const monthDisplay = document.getElementById("monthDisplay");
const calendarGrid = document.getElementById("calendarGrid");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// Layer animasi
const heartLayer = document.getElementById("heartLayer");
const sparkleLayer = document.getElementById("sparkleLayer");

// Login elements
const loginBtn = document.getElementById("loginBtn");
const loginModal = document.getElementById("loginModal");
const loginPassword = document.getElementById("loginPassword");
const submitLogin = document.getElementById("submitLogin");
const cancelLogin = document.getElementById("cancelLogin");
const closeLoginModal = document.getElementById("closeLoginModal");
const loginError = document.getElementById("loginError");
const modeIndicator = document.getElementById("modeIndicator");

const monthNames = [
  "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember"
];

const weekdayNames = [
  "Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"
];

let today = new Date();
let currentMonth = today.getMonth();
let currentYear = today.getFullYear();

// ====== ADMIN MODE FUNCTIONS ======
function initAdminMode() {
  // Check if admin mode was previously enabled in this session
  const savedMode = sessionStorage.getItem("isAdminMode");
  if (savedMode === "true") {
    enableAdminMode();
  } else {
    enableViewMode();
  }
  
  // Event listeners for login
  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      if (isAdminMode) {
        // If already admin, logout
        logout();
      } else {
        // Show login modal
        loginModal.classList.remove("hidden");
        loginPassword.value = "";
        loginError.classList.add("hidden");
        loginPassword.focus();
      }
    });
  }
  
  if (submitLogin) {
    submitLogin.addEventListener("click", attemptLogin);
  }
  
  if (cancelLogin) {
    cancelLogin.addEventListener("click", () => {
      loginModal.classList.add("hidden");
    });
  }
  
  if (closeLoginModal) {
    closeLoginModal.addEventListener("click", () => {
      loginModal.classList.add("hidden");
    });
  }
  
  // Enter key on password field
  if (loginPassword) {
    loginPassword.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        attemptLogin();
      }
    });
  }
}

function attemptLogin() {
  const password = loginPassword.value.trim();
  if (password === ADMIN_PASSWORD) {
    enableAdminMode();
    loginModal.classList.add("hidden");
  } else {
    loginError.classList.remove("hidden");
    loginPassword.value = "";
    loginPassword.focus();
  }
}

function enableAdminMode() {
  isAdminMode = true;
  sessionStorage.setItem("isAdminMode", "true");
  
  // Update UI
  document.body.classList.remove("view-mode");
  document.body.classList.add("admin-mode");
  
  if (loginBtn) {
    loginBtn.innerHTML = "🔓 Logout";
    loginBtn.classList.add("admin-mode");
    loginBtn.title = "Logout Admin";
  }
  
  if (modeIndicator) {
    modeIndicator.innerHTML = "✏️ Admin Mode";
    modeIndicator.classList.remove("view-mode");
    modeIndicator.classList.add("admin-mode");
  }
  
  // Show GAS status (automatic - no button needed)
  showGASStatus();
  
  // Re-render posts to show edit buttons
  if (currentPosts.length > 0 && !postsContainer.classList.contains("hidden")) {
    renderPostsList();
  }
}

// Show/hide GAS status indicator (no connect button needed!)
function showGASStatus() {
  // Remove old connect button if exists
  const existingBtn = document.getElementById("driveConnectBtn");
  if (existingBtn) {
    existingBtn.remove();
  }
  
  // GAS is automatic - no user action needed
  // Just update the status indicator
  if (isGASConnected) {
    updateGASSyncStatus("synced");
  } else {
    updateGASSyncStatus("local");
  }
}

function enableViewMode() {
  isAdminMode = false;
  sessionStorage.setItem("isAdminMode", "false");
  
  // Update UI
  document.body.classList.remove("admin-mode");
  document.body.classList.add("view-mode");
  
  if (loginBtn) {
    loginBtn.innerHTML = "🔐 Login";
    loginBtn.classList.remove("admin-mode");
    loginBtn.title = "Login Admin";
  }
  
  if (modeIndicator) {
    modeIndicator.innerHTML = "👁️ View Mode";
    modeIndicator.classList.remove("admin-mode");
    modeIndicator.classList.add("view-mode");
  }
  
  // No connect button to remove for GAS
}

function logout() {
  if (confirm("Logout from admin mode?")) {
    enableViewMode();
    // Close any open modals
    noteModal.classList.add("hidden");
    miniModal.classList.add("hidden");
  }
}

// ====== HELPER DATE ======
function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ====== RENDER KALENDER ======
function renderCalendar(year, month) {
  calendarGrid.innerHTML = "";
  monthDisplay.textContent = `${monthNames[month]} ${year}`;

  const firstDayOfMonth = new Date(year, month, 1);
  const startingWeekday = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // sel kosong sebelum tanggal 1
  for (let i = 0; i < startingWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "day-card empty";
    calendarGrid.appendChild(empty);
  }

  // tanggal 1 s/d akhir bulan
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const w = date.getDay();

    const card = document.createElement("div");
    card.classList.add("day-card");
    // tag data untuk penanda momen
    card.dataset.day = String(d).padStart(2, "0");
    card.dataset.dateKey = getStorageKey(year, month + 1, d);

    // weekend: Minggu (0) dan Sabtu (6)
    if (w === 0 || w === 6) {
      card.classList.add("weekend");
    }

    // monthsary & anniversary (semua 19 dengan efek anniversary)
    let tagHTML = "";
    
if (d === 19) {
  if (month === 9) {
    card.classList.add("anniversary");
  } else {
    card.classList.add("monthsary");
  }
}

if (isSameDate(date, today)) {
  card.classList.add("today");
}


    card.innerHTML = `
      <div class="day-number">${d}</div>
      <div class="day-name">${weekdayNames[w]}</div>
      ${tagHTML}
    `;

    calendarGrid.appendChild(card);
  }

  // tandai tanggal yang punya momen
  markDaysWithMoments(year, month);
}

// ====== NAVIGASI BULAN ======
prevBtn.addEventListener("click", () => {
  currentMonth--;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar(currentYear, currentMonth);
});

nextBtn.addEventListener("click", () => {
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar(currentYear, currentMonth);
});

// ====== ANIMASI ======
function createHeart() {
  if (!heartLayer) return;

  const heart = document.createElement("div");
  heart.classList.add("heart");
  heart.textContent = "♥";

  const size = 14 + Math.random() * 18;
  const left = Math.random() * 100;
  const duration = 7 + Math.random() * 4;

  heart.style.fontSize = `${size}px`;
  heart.style.left = `${left}%`;
  heart.style.bottom = "-10vh";
  heart.style.animationDuration = `${duration}s`;
  heart.style.opacity = (0.5 + Math.random() * 0.5).toString();

  heartLayer.appendChild(heart);

  setTimeout(() => heart.remove(), duration * 1000 + 500);
}

function createSparkle() {
  if (!sparkleLayer) return;

  const s = document.createElement("div");
  s.classList.add("sparkle");

  const size = 3 + Math.random() * 7;
  const left = Math.random() * 100;
  const duration = 4 + Math.random() * 3;

  s.style.width = `${size}px`;
  s.style.height = `${size}px`;
  s.style.left = `${left}%`;
  s.style.bottom = "-15vh";
  s.style.animationDuration = `${duration}s`;

  sparkleLayer.appendChild(s);

  setTimeout(() => s.remove(), duration * 1000 + 500);
}

function startRomanticAnimations() {
  setInterval(() => {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(createHeart, i * 200);
  }, 1300);

  setInterval(() => {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) setTimeout(createSparkle, i * 250);
  }, 1100);
}

// ====== MODAL MOMENT FEED ======
const noteModal = document.getElementById("noteModal");
const modalDateTitle = document.getElementById("modalDateTitle");
const closeModal = document.getElementById("closeModal");

const postsContainer = document.getElementById("postsContainer");
const addMomentBtn = document.getElementById("addMomentBtn");
const createPanel = document.getElementById("createPanel");
const postTitleInput = document.getElementById("postTitle");
const postLovedByInput = document.getElementById("postLovedBy");
const editor = document.getElementById("editor");
const imageInput = document.getElementById("imageInput");
const emojiPicker = document.getElementById("emojiPicker");
const colorPicker = document.getElementById("colorPicker");
const postBtn = document.getElementById("postBtn");
const cancelCreateBtn = document.getElementById("cancelCreate");

// Mini modal elements (title view-only)
const miniModal = document.getElementById("miniModal");
const miniTitleEl = document.getElementById("miniTitle");
const miniMetaEl = document.getElementById("miniMeta");
const miniContentEl = document.getElementById("miniContent");
const miniCloseBtn = document.getElementById("miniClose");
const miniEditBtn = document.getElementById("miniEdit");
const miniDeleteBtn = document.getElementById("miniDelete");
let miniCurrentIndex = null;



// Storage & Sync configuration
const STORAGE_PREFIX = "loveCalendarPosts:"; // legacy prefix (tidak dipakai lagi untuk localStorage)

const DB_NAME = "LoveCalendarDB";
const DB_VERSION = 1;
const POSTS_STORE = "posts";
const QUEUE_STORE = "syncQueue";

let selectedDateKey = "";
let currentPosts = [];
let editingIndex = null;
let isPlaceholderActive = false;

const PLACEHOLDER_HTML =
  '<span class="placeholder-text"><i>Ceritakan momen…</i></span>';

// ====== INDEXEDDB SETUP ======
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(POSTS_STORE)) {
        const postsStore = db.createObjectStore(POSTS_STORE, { keyPath: "id" });
        postsStore.createIndex("dateKey", "dateKey", { unique: false });
      }

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const dbPromise = openDatabase();

// Helper: dateKey "YYYY-MM-DD"
function getStorageKey(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// Load posts for selectedDateKey from IndexedDB
async function loadPosts() {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(POSTS_STORE, "readonly");
    const store = tx.objectStore(POSTS_STORE);
    const index = store.index("dateKey");
    const req = index.getAll(selectedDateKey);

    req.onsuccess = () => {
      currentPosts = req.result || [];
      resolve(currentPosts);
    };
    req.onerror = () => {
      currentPosts = [];
      reject(req.error);
    };
  });
}

// Save currentPosts for selectedDateKey into IndexedDB
async function savePosts() {
  const db = await dbPromise;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(POSTS_STORE, "readwrite");
    const store = tx.objectStore(POSTS_STORE);
    const index = store.index("dateKey");

    // 1) Hapus semua post lama utk dateKey ini
    const getKeysReq = index.getAllKeys(selectedDateKey);
    getKeysReq.onsuccess = () => {
      const keys = getKeysReq.result || [];
      keys.forEach((key) => store.delete(key));

      // 2) Simpan semua post sekarang
      currentPosts.forEach((p) => {
        if (!p.id) {
          p.id = `${selectedDateKey}-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`;
        }
        const record = { ...p, dateKey: selectedDateKey };
        store.put(record);
      });
    };
    getKeysReq.onerror = () => reject(getKeysReq.error);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// TANDI TANGGAL YANG PUNYA MOMEN DI BULAN TERPILIH
async function markDaysWithMoments(year, month) {
  try {
    const db = await dbPromise;
    const tx = db.transaction(POSTS_STORE, "readonly");
    const store = tx.objectStore(POSTS_STORE);
    const index = store.index("dateKey");

    const mm = String(month + 1).padStart(2, "0");
    const startKey = `${year}-${mm}-01`;
    const endKey = `${year}-${mm}-31`;
    const range = IDBKeyRange.bound(startKey, endKey);

    const datesSet = new Set();

    await new Promise((resolve, reject) => {
      const req = index.openCursor(range);
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const key = cursor.key; // "YYYY-MM-DD"
          const dayStr = key.slice(8, 10);
          datesSet.add(dayStr);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    const cards = calendarGrid.querySelectorAll(".day-card");
    cards.forEach((card) => {
      if (card.classList.contains("empty")) return;
      const dayStr = card.dataset.day;
      if (datesSet.has(dayStr)) {
        card.classList.add("has-moment");
      } else {
        card.classList.remove("has-moment");
      }
    });
  } catch (err) {
    console.error("Gagal menandai tanggal dengan momen:", err);
  }
}


// ====== SYNC STATUS UI ======
let syncStatusEl = null;

function initSyncStatus() {
  const modalHeader = document.querySelector("#noteModal .modal-header");
  const closeBtn = document.getElementById("closeModal");
  if (!modalHeader) return;

  // inject CSS
  if (!document.getElementById("syncStatusStyle")) {
    const style = document.createElement("style");
    style.id = "syncStatusStyle";
    style.textContent = `
      .sync-status {
        font-size: 11px;
        color: #b84071;
        opacity: 0.85;
        margin-left: auto;
        margin-right: 8px;
      }
      .sync-status.success { color: #2f855a; }
      .sync-status.error { color: #e53e3e; }
    `;
    document.head.appendChild(style);
  }

  syncStatusEl = document.createElement("div");
  syncStatusEl.id = "syncStatus";
  syncStatusEl.className = "sync-status";
  syncStatusEl.textContent = "Ready";

  if (closeBtn) {
    modalHeader.insertBefore(syncStatusEl, closeBtn);
  } else {
    modalHeader.appendChild(syncStatusEl);
  }
}

function setSyncStatus(text, type = "") {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = text;
  syncStatusEl.className = "sync-status";
  if (type) syncStatusEl.classList.add(type);
}

// ====== QUEUE & SYNC TO GAS ======
async function queueSync(post) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    store.put({ id: post.id, payload: post });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllQueued() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteQueued(id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// low-level sender (tidak queue ulang)
async function sendToGAS(post) {
  if (!GAS_URL) return { status: "skip" };

  const res = await fetch( GAS_URL, { mode: "no-cors", 
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(post)
  });

  const data = await res.json().catch(() => null) || {};
  return data;
}

// dipanggil saat user Post / Repost
async function syncPostToGAS(post) {
  if (!syncStatusEl) initSyncStatus();

  try {
    setSyncStatus("Syncing…");
    const data = await sendToGAS(post);

    if (data.status === "ok" || data.result === "success") {
      setSyncStatus("Synced ✓", "success");
      return { status: "ok" };
    } else {
      // treat as failure
      await queueSync(post);
      setSyncStatus("Offline — queued 🔄", "error");
      return { status: "queued" };
    }
  } catch (err) {
    await queueSync(post);
    setSyncStatus("Offline — queued 🔄", "error");
    return { status: "queued", error: err };
  }
}

// proses seluruh queue ketika online / saat load
async function processSyncQueue() {
  if (!navigator.onLine) return;
  if (!syncStatusEl) initSyncStatus();

  const queued = await getAllQueued();
  if (!queued.length) return;

  setSyncStatus("Syncing queued…");

  for (const item of queued) {
    try {
      const res = await sendToGAS(item.payload);
      if (res.status === "ok" || res.result === "success") {
        await deleteQueued(item.id);
      }
    } catch (err) {
      // kalau masih gagal, biarkan di queue
    }
  }

  setSyncStatus("Synced ✓", "success");
}

// trigger saat online
window.addEventListener("online", () => {
  processSyncQueue();
});

// panggil juga sekali di awal
processSyncQueue();
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function formatPostTime(iso) {
  const d = new Date(iso);
  if (!d) return "";
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const mon = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${day} ${mon[month]} ${year}, ${hh}:${mm}`;
}


// ===============================
//       MINI MODAL HANDLERS
// ===============================
function openMiniModal(index) {
  const post = currentPosts[index];
  if (!post || !miniModal) return;

  miniCurrentIndex = index;
  miniTitleEl.textContent = post.title || "";

  let meta = formatPostTime(post.createdAt);
  if (post.lovedBy) meta += " · Loved by " + escapeHtml(post.lovedBy);
  if (post.pinned) meta += " · 📌";
  miniMetaEl.innerHTML = meta;

  miniContentEl.innerHTML = post.content || "";
  miniModal.classList.remove("hidden");
  
  // Show/hide edit/delete buttons based on admin mode
  if (miniEditBtn) {
    miniEditBtn.style.display = isAdminMode ? "block" : "none";
  }
  if (miniDeleteBtn) {
    miniDeleteBtn.style.display = isAdminMode ? "block" : "none";
  }
}

function closeMiniModal() {
  if (!miniModal) return;
  miniModal.classList.add("hidden");
  miniCurrentIndex = null;
}

if (miniCloseBtn) {
  miniCloseBtn.addEventListener("click", closeMiniModal);
}

if (miniEditBtn) {
  miniEditBtn.addEventListener("click", () => {
    if (miniCurrentIndex === null) return;
    const post = currentPosts[miniCurrentIndex];
    if (!post) return;

    closeMiniModal();

    editingIndex = miniCurrentIndex;
    postTitleInput.value = post.title || "";
    postLovedByInput.value = post.lovedBy || "";
    editor.innerHTML = post.content || "";
    isPlaceholderActive = false;
    editor.classList.remove("empty");

    enterCreateMode(true);
  });
}

if (miniDeleteBtn) {
  miniDeleteBtn.addEventListener("click", async () => {
    if (miniCurrentIndex === null) return;
    if (!confirm("Hapus momen ini?")) return;

    currentPosts.splice(miniCurrentIndex, 1);
    await savePosts();
    closeMiniModal();

    if (!currentPosts.length) {
      enterCreateMode(false);
    } else {
      renderPostsList();
    }
  });
}

// ===============================
//        RENDER POST LIST
// ===============================
function renderPostsList() {
  postsContainer.innerHTML = "";

  if (!currentPosts.length) {
    postsContainer.innerHTML =
      '<p class="no-posts">Belum ada momen. Yuk tulis yang pertama 💕</p>';
    return;
  }

  // Sort pinned dulu, lalu berdasarkan createdAt desc
  const sorted = [
    ...currentPosts
      .map((p, i) => ({ ...p, _i: i }))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
  ];

  sorted.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-card";
    card.dataset.index = post._i;

    const lovedBy = post.lovedBy ? `Loved by ${escapeHtml(post.lovedBy)}` : "";
    
    // Only show action buttons in admin mode
    const actionsHTML = isAdminMode ? `
      <div class="post-actions">
        <button class="post-pin">${post.pinned ? "💖" : "📌"}</button><span class="post-sync-indicator" data-id="${post.id || ""}">•</span>
        <button class="post-edit">Edit</button>
        <button class="post-delete">Hapus</button>
      </div>
    ` : '';

    card.innerHTML = `
      <div class="post-header">
        <div>
          <div class="post-title">${escapeHtml(post.title)}</div>
          <div class="post-meta">
            ${formatPostTime(post.createdAt)}
            ${lovedBy ? " · " + lovedBy : ""}
            ${post.pinned ? " · 📌" : ""}
          </div>
        </div>
        ${actionsHTML}
      </div>

      <div class="post-content-wrapper">
        <div class="post-content">${post.content}</div>
        <button class="toggle-post hidden">Show More…</button>
      </div>
    `;

    postsContainer.appendChild(card);

    const contentEl = card.querySelector(".post-content");
    const toggleBtn = card.querySelector(".toggle-post");

    // Delay supaya DOM sempat render → scrollHeight akurat
    setTimeout(() => {
      if (contentEl.scrollHeight > 150) {
        contentEl.classList.add("collapsed");
        toggleBtn.classList.remove("hidden");
        toggleBtn.textContent = "Show More…";
      } else {
        toggleBtn.classList.add("hidden");
      }
    }, 0);
  });
}

// ===============================
//   SWITCH MODE (FEED / CREATE)
// ===============================
function enterFeedMode() {
  editingIndex = null;
  postsContainer.classList.remove("hidden");
  createPanel.classList.add("hidden");
  
  // Only show add moment button in admin mode
  if (addMomentBtn) {
    addMomentBtn.classList.toggle("hidden", !isAdminMode);
  }
  
  emojiPicker.classList.add("hidden");
  renderPostsList();
}

function enterCreateMode(isEdit) {
  // Only allow create mode in admin mode
  if (!isAdminMode && !isEdit) {
    return;
  }
  
  createPanel.classList.remove("hidden");
  postsContainer.classList.add("hidden");
  if (addMomentBtn) {
    addMomentBtn.classList.add("hidden");
  }
  emojiPicker.classList.add("hidden");

  if (isEdit) {
    postBtn.textContent = "Re-Post";
  } else {
    postBtn.textContent = "Post";
    postTitleInput.value = "";
    postLovedByInput.value = "";
    setPlaceholder();
  }
}

function setPlaceholder() {
  editor.innerHTML = PLACEHOLDER_HTML;
  editor.classList.add("empty");
  isPlaceholderActive = true;
}

function clearPlaceholderIfNeeded() {
  if (isPlaceholderActive) {
    editor.innerHTML = "";
    editor.classList.remove("empty");
    isPlaceholderActive = false;
  }
}

editor.addEventListener("blur", () => {
  if (editor.textContent.trim() === "") {
    setPlaceholder();
  }
});

editor.addEventListener("focus", clearPlaceholderIfNeeded);
editor.addEventListener("keydown", clearPlaceholderIfNeeded);

// tombol warna preset
const colorButtons = document.querySelectorAll(".color-btn");
colorButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    clearPlaceholderIfNeeded();
    const color = btn.dataset.color;
    if (!color) return;
    document.execCommand("foreColor", false, color);
    editor.focus();
  });
});

// ===============================
//         OPEN MODAL
// ===============================
calendarGrid.addEventListener("click", async (e) => {
  const card = e.target.closest(".day-card");
  if (!card || card.classList.contains("empty")) return;

  const day = Number(card.querySelector(".day-number").textContent);
  const month = currentMonth + 1;
  const year = currentYear;

  selectedDateKey = getStorageKey(year, month, day);
  modalDateTitle.textContent = `Momen ${day}/${month}/${year}`;

  await loadPosts();

  if (!currentPosts.length) {
    if (isAdminMode) {
      // Admin mode: show create panel directly
      postsContainer.classList.add("hidden");
      addMomentBtn.classList.add("hidden");
      createPanel.classList.remove("hidden");
      postBtn.textContent = "Post";
      postTitleInput.value = "";
      postLovedByInput.value = "";
      setPlaceholder();
    } else {
      // View mode: show empty state
      postsContainer.classList.remove("hidden");
      addMomentBtn.classList.add("hidden");
      createPanel.classList.add("hidden");
      postsContainer.innerHTML = '<p class="no-posts">Belum ada momen di tanggal ini 💕</p>';
    }
  } else {
    enterFeedMode();
  }

  noteModal.classList.remove("hidden");
});

// ===============================
//         CLOSE MODAL
// ===============================
closeModal.addEventListener("click", () => {
  noteModal.classList.add("hidden");
});

// ===============================
//    FEED BUTTON ACTIONS
// ===============================
postsContainer.addEventListener("click", async (e) => {
  const del = e.target.closest(".post-delete");
  const edt = e.target.closest(".post-edit");
  const tog = e.target.closest(".toggle-post");
  const pin = e.target.closest(".post-pin");
  const titleEl = e.target.closest(".post-title");

  // Title click -> open mini modal
  if (titleEl) {
    const card = titleEl.closest(".post-card");
    const idx = Number(card.dataset.index);
    openMiniModal(idx);
    return;
  }

  // Delete (admin only)
  if (del && isAdminMode) {
    const card = del.closest(".post-card");
    const idx = Number(card.dataset.index);
    if (!confirm("Hapus momen ini?")) return;
    currentPosts.splice(idx, 1);
    await savePosts();

    if (!currentPosts.length) {
      enterCreateMode(false);
    } else {
      renderPostsList();
    }
    return;
  }

  // Edit (admin only)
  if (edt && isAdminMode) {
    const card = edt.closest(".post-card");
    const idx = Number(card.dataset.index);
    const post = currentPosts[idx];

    editingIndex = idx;

    postTitleInput.value = post.title;
    postLovedByInput.value = post.lovedBy || "";
    editor.innerHTML = post.content;
    isPlaceholderActive = false;
    editor.classList.remove("empty");

    enterCreateMode(true);
    return;
  }

  // Toggle Show More / Less
  if (tog) {
    const card = tog.closest(".post-card");
    const contentEl = card.querySelector(".post-content");

    if (contentEl.classList.contains("collapsed")) {
      contentEl.classList.remove("collapsed");
      tog.textContent = "Show Less";
    } else {
      contentEl.classList.add("collapsed");
      tog.textContent = "Show More…";
    }
    return;
  }

  // PIN / UNPIN (admin only)
  if (pin && isAdminMode) {
    const card = pin.closest(".post-card");
    const idx = Number(card.dataset.index);
    currentPosts[idx].pinned = !currentPosts[idx].pinned;
    await savePosts();
    renderPostsList();
    return;
  }
});

// ===============================
//         ADD MOMENT BTN
// ===============================
addMomentBtn.addEventListener("click", () => {
  if (!isAdminMode) return;
  
  editingIndex = null;
  postBtn.textContent = "Post";
  postTitleInput.value = "";
  postLovedByInput.value = "";
  setPlaceholder();
  enterCreateMode(false);
});

// ===============================
//         CANCEL
// ===============================
cancelCreateBtn.addEventListener("click", () => {
  if (currentPosts.length) enterFeedMode();
  else noteModal.classList.add("hidden");
});

// ===============================
//         EDITOR TOOLS
// ===============================
function formatText(cmd) {
  clearPlaceholderIfNeeded();
  document.execCommand(cmd, false, null);
  editor.focus();
}



function applyFontSize() {
  clearPlaceholderIfNeeded();

  const select = document.getElementById("fontSizeSelect");
  if (!select) return;
  let val = select.value;

  if (val === "custom") {
    const custom = prompt("Font size? contoh: 18px atau 1.2em", "16px");
    if (!custom) return;
    val = custom;
  }

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  const span = document.createElement("span");
  span.style.fontSize = val;
  range.surroundContents(span);

  editor.focus();
}

function toggleEmojiPicker() {
  emojiPicker.classList.toggle("hidden");
}

function insertEmoji(e) {
  clearPlaceholderIfNeeded();
  try {
    document.execCommand("insertText", false, e);
  } catch (err) {
    editor.innerHTML += e;
  }
  editor.focus();
}

function insertImage() {
  imageInput.value = "";
  imageInput.click();
}

imageInput.addEventListener("change", () => {
  const files = Array.from(imageInput.files || []);
  if (!files.length) return;

  clearPlaceholderIfNeeded();

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement("img");
      img.src = reader.result;
      editor.appendChild(img);
    };
    reader.readAsDataURL(file);
  });

  editor.focus();
});

function clearEditor() {
  if (!confirm("Bersihkan semua isi editor?")) return;
  editor.innerHTML = "";
  setPlaceholder();
}

// ===============================
//          POST / RE-POST
// ===============================

postBtn.addEventListener("click", async () => {
  // Only allow posting in admin mode
  if (!isAdminMode) {
    alert("You need to login as admin to add moments 💗");
    return;
  }
  
  const title = postTitleInput.value.trim();
  const lovedBy = postLovedByInput.value.trim();
  const html = editor.innerHTML.trim();

  if (!lovedBy) {
    alert("Loved by wajib diisi ya 💗");
    postLovedByInput.focus();
    return;
  }

  if (!title) {
    alert("Title momen wajib ya 💗");
    postTitleInput.focus();
    return;
  }

  if (!html || isPlaceholderActive || editor.textContent.trim() === "") {
    alert("Isi momennya juga ya 🥹");
    editor.focus();
    return;
  }

  const now = new Date().toISOString();

  if (editingIndex !== null) {
    const p = currentPosts[editingIndex];
    p.title = title;
    p.content = editor.innerHTML;
    p.lovedBy = lovedBy;
    p.updatedAt = now;
  } else {
    currentPosts.push({
      title,
      content: editor.innerHTML,
      lovedBy,
      createdAt: now,
      pinned: false
    });
  }

  await savePosts();

  // SYNC TO GOOGLE APPS SCRIPT (automatic, no auth needed!)
  if (editingIndex === null) {
    // New post - save to GAS
    const newPost = currentPosts[currentPosts.length - 1];
    newPost.dateKey = selectedDateKey;
    await savePostToGAS(newPost);
  } else {
    // Updated post - update in GAS
    const updatedPost = currentPosts[editingIndex];
    await updatePostInGAS(updatedPost);
  }

  // REFRESH KALENDAR SUPAYA ICON MOMEN MUNCUL REALTIME
  renderCalendar(currentYear, currentMonth);
  enterFeedMode();
});

postsContainer.addEventListener("mouseout", (e)=>{
  const pin = e.target.closest(".post-pin");
  if(!pin) return;
  const card = pin.closest(".post-card");
  const idx = Number(card.dataset.index);
  const post = currentPosts[idx];
  if (post) {
    pin.textContent = post.pinned ? "💖" : "📌";
  }
});

// OUR JOURNEY MODAL
const ourJourneyBtn = document.getElementById("ourJourneyBtn");
const ourJourneyModal = document.getElementById("ourJourneyModal");
const closeOurJourneyModal = document.getElementById("closeOurJourneyModal");
const ourJourneyContent = document.getElementById("ourJourneyContent");

// Function to calculate days together
function calculateDaysTogether() {
  const startDate = new Date(2025, 9, 19, 8, 0, 0); // October 19, 2025, 8 AM
  const now = new Date();
  const diffMs = now - startDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffMs < 0) {
    return "Belum dimulai! Mulai dari 19 Oktober 2025 pukul 8 pagi 💕";
  } else {
    return `Days Together: ${diffDays} hari, ${diffHours} jam, ${diffMinutes} menit 💖`;
  }
}

// Function to get full journey content
function getFullJourneyContent() {
  return `
    <div class="journey-full-content">
      <div class="journey-item-full">
        <h4>Days Together</h4>
        <p>${calculateDaysTogether()}</p>
      </div>
      <div class="journey-item-full">
        <h4>Story We've Shared</h4>
        <p>Every moment we've spent together has been a chapter in our beautiful story. From the first hello to the countless memories we've created, each day brings new adventures and deeper love 💕</p>
      </div>
      <div class="journey-item-full">
        <h4>Dates We Keep</h4>
        <p>Our special dates are etched in our hearts - anniversaries, birthdays, and those spontaneous moments that make life exciting. Each date is a reminder of how far we've come and how much we cherish each other 💑</p>
      </div>
      <div class="journey-item-full">
        <h4>The Story We're Writing</h4>
        <p>Our journey is just beginning. With every laugh, every tear, every triumph, we're writing a love story that will inspire generations. Together, we're creating something truly magical ✨</p>
      </div>
    </div>
  `;
}

// Event listeners for Our Journey modal
if (ourJourneyBtn) {
  ourJourneyBtn.addEventListener("click", () => {
    ourJourneyContent.innerHTML = getFullJourneyContent();
    ourJourneyModal.classList.remove("hidden");
  });
}

if (closeOurJourneyModal) {
  closeOurJourneyModal.addEventListener("click", () => {
    ourJourneyModal.classList.add("hidden");
  });
}

// INITIAL RENDER
renderCalendar(currentYear, currentMonth);
startRomanticAnimations();
