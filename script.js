// ====== ADMIN MODE CONFIGURATION ======
const ADMIN_PASSWORD = "admin123"; // Can be changed later
let isAdminMode = false;

// ====== GOOGLE DRIVE SYNC CONFIGURATION ======
const GOOGLE_CLIENT_ID = "128927562671-oggq3oq7kgvrqs7jj24a47r38co849bp.apps.googleusercontent.com"; // Your OAuth2 client ID
const GOOGLE_API_KEY = "AIzaSyDfQaiM4n5dSSLREmVtciU8nmJHZX3ZYiY"; // Your API key (for public read)
const DRIVE_FOLDER_NAME = "Kalender Cinta";
let isGoogleSignedIn = false;
let googleAccessToken = null;
let driveFolderId = null;
let isDriveFolderPublic = false; // Track if folder is publicly readable

// Google Drive API scope
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";

// ====== GOOGLE DRIVE SYNC FUNCTIONS ======

// Initialize Google Identity Services
function initGoogleAuth() {
  if (typeof google === "undefined") {
    console.log("Google API not loaded yet");
    setTimeout(initGoogleAuth, 1000);
    return;
  }

  // Initialize token client
  window.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: handleGoogleAuthResponse
  });

  // Check if already signed in (persistent across sessions)
  const savedToken = localStorage.getItem("googleAccessToken");
  
  if (savedToken) {
    googleAccessToken = savedToken;
    isGoogleSignedIn = true;
    findOrCreateDriveFolder();
  } else if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes("YOUR_")) {
    // Silent auto-sign in attempt (no UI shown)
    console.log("Attempting silent Google sign-in...");
    // Will trigger on first user interaction that requires sync
  }

  // Setup sign-in button (hidden, for manual trigger if needed)
  const gSignInBtn = document.getElementById("gSignInButton");
  if (gSignInBtn) {
    gSignInBtn.addEventListener("click", () => {
      if (isGoogleSignedIn) {
        signOutFromGoogle();
      } else {
        requestGoogleAuth();
      }
    });
  }
}

// Request Google authentication
function requestGoogleAuth() {
  if (window.tokenClient) {
    window.tokenClient.requestAccessToken({ prompt: "consent" });
  } else {
    showToast("Google Sign-In not initialized", "error");
  }
}

// Handle Google auth response
function handleGoogleAuthResponse(tokenResponse) {
  if (tokenResponse && tokenResponse.access_token) {
    googleAccessToken = tokenResponse.access_token;
    isGoogleSignedIn = true;
    // Save to localStorage for persistence across sessions
    localStorage.setItem("googleAccessToken", googleAccessToken);
    
    updateGoogleSignInUI();
    // Silent success - no toast shown
    
    // Find or create the app folder
    findOrCreateDriveFolder();
  } else {
    console.log("Google sign-in failed or cancelled");
    // Silent fail - no error shown to user
  }
}

// Sign out from Google (hidden function - no UI)
function signOutFromGoogle() {
  if (googleAccessToken) {
    // Revoke token
    google.accounts.oauth2.revoke(googleAccessToken, () => {
      console.log("Token revoked");
    });
  }
  
  googleAccessToken = null;
  isGoogleSignedIn = false;
  driveFolderId = null;
  // Remove from localStorage
  localStorage.removeItem("googleAccessToken");
  
  updateGoogleSignInUI();
  updateDriveSyncStatus("local");
  // Silent sign out - no toast shown
}

// Update Google Sign-In UI (hidden - no visible button)
function updateGoogleSignInUI() {
  // Sign-in UI is hidden - only status indicators are shown
  const gWrapper = document.getElementById("gSignInWrapper");
  if (gWrapper) {
    gWrapper.classList.add("hidden");
  }
}

// Find or create Drive folder
async function findOrCreateDriveFolder() {
  if (!isGoogleSignedIn || !googleAccessToken) return;

  try {
    // Search for existing folder
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive`,
      {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`
        }
      }
    );

    const searchData = await searchResponse.json();
    
    if (searchData.files && searchData.files.length > 0) {
      driveFolderId = searchData.files[0].id;
      console.log("Found Drive folder:", driveFolderId);
    } else {
      // Create new folder
      const createResponse = await fetch(
        "https://www.googleapis.com/drive/v3/files",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: DRIVE_FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder"
          })
        }
      );

      const createData = await createResponse.json();
      driveFolderId = createData.id;
      console.log("Created Drive folder:", driveFolderId);
    }
    
    // Save folder ID to localStorage for public access
    localStorage.setItem("driveFolderId", driveFolderId);
    
    // Make folder publicly readable
    await makeFolderPublic(driveFolderId);
    
    updateDriveSyncStatus("synced");
  } catch (error) {
    console.error("Drive folder error:", error);
    updateDriveSyncStatus("error");
  }
}

// Upload post to Google Drive (silent background sync)
async function uploadPostToDrive(post) {
  if (!isGoogleSignedIn || !googleAccessToken || !driveFolderId) {
    // Try to auto-sign in if not signed in
    if (!isGoogleSignedIn && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.includes("YOUR_")) {
      // Trigger sign-in on first save attempt
      requestGoogleAuth();
      return { status: "pending", message: "Sign-in required" };
    }
    return { status: "local", message: "Not signed in to Google Drive" };
  }

  const fileName = `post_${post.dateKey}_${post.id}.json`;
  const fileContent = JSON.stringify(post, null, 2);
  const blob = new Blob([fileContent], { type: "application/json" });

  try {
    updateDriveSyncStatus("uploading");
    // Silent - no toast shown

    // Create multipart upload
    const metadata = {
      name: fileName,
      parents: [driveFolderId],
      mimeType: "application/json"
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`
        },
        body: form
      }
    );

    if (response.ok) {
      const result = await response.json();
      console.log("Uploaded to Drive:", result.id);
      
      // Update post with Drive file ID
      post.driveFileId = result.id;
      post.syncStatus = "synced";
      post.syncedAt = new Date().toISOString();
      
      updateDriveSyncStatus("synced");
      // Silent success - no toast
      
      return { status: "synced", fileId: result.id };
    } else {
      throw new Error(`Upload failed: ${response.status}`);
    }
  } catch (error) {
    console.error("Drive upload error:", error);
    post.syncStatus = "error";
    updateDriveSyncStatus("error");
    // Silent error - no toast shown
    
    // Queue for retry
    queueForSync(post);
    
    return { status: "error", error: error.message };
  }
}

// Update existing file in Drive (silent background sync)
async function updatePostInDrive(post) {
  if (!isGoogleSignedIn || !googleAccessToken || !post.driveFileId) {
    return uploadPostToDrive(post);
  }

  const fileContent = JSON.stringify(post, null, 2);
  const blob = new Blob([fileContent], { type: "application/json" });

  try {
    updateDriveSyncStatus("uploading");
    // Silent - no toast
    
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${post.driveFileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: blob
      }
    );

    if (response.ok) {
      post.syncStatus = "synced";
      post.syncedAt = new Date().toISOString();
      updateDriveSyncStatus("synced");
      // Silent success
      return { status: "synced" };
    } else {
      throw new Error(`Update failed: ${response.status}`);
    }
  } catch (error) {
    console.error("Drive update error:", error);
    post.syncStatus = "error";
    updateDriveSyncStatus("error");
    queueForSync(post);
    return { status: "error" };
  }
}

// Queue post for sync
async function queueForSync(post) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    store.put({ id: post.id, post: post, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Process sync queue
async function processSyncQueue() {
  if (!isGoogleSignedIn || !navigator.onLine) return;

  const db = await dbPromise;
  const tx = db.transaction("syncQueue", "readonly");
  const store = tx.objectStore("syncQueue");
  const request = store.getAll();

  request.onsuccess = async () => {
    const queue = request.result || [];
    
    for (const item of queue) {
      try {
        const result = await uploadPostToDrive(item.post);
        if (result.status === "synced") {
          // Remove from queue
          const deleteTx = db.transaction("syncQueue", "readwrite");
          const deleteStore = deleteTx.objectStore("syncQueue");
          deleteStore.delete(item.id);
        }
      } catch (err) {
        console.error("Sync queue error:", err);
      }
    }
  };
}

// Update Drive sync status UI
function updateDriveSyncStatus(status) {
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
      if (textEl) textEl.textContent = "Uploading...";
      badgeEl?.classList.add("uploading");
      if (dotEl) dotEl.textContent = "●";
      if (text2El) text2El.textContent = "Uploading";
      break;
    case "synced":
      statusEl.classList.add("synced");
      if (iconEl) iconEl.textContent = "✅";
      if (textEl) textEl.textContent = "Synced to Drive";
      badgeEl?.classList.add("synced");
      if (dotEl) dotEl.textContent = "✓";
      if (text2El) text2El.textContent = "Synced";
      break;
    case "error":
      statusEl.classList.add("error");
      if (iconEl) iconEl.textContent = "❌";
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

// Toast notification system
function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  const icons = {
    success: "✅",
    error: "❌",
    uploading: "🔄",
    info: "ℹ️"
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close">×</button>
  `;

  container.appendChild(toast);

  // Close button
  toast.querySelector(".toast-close").addEventListener("click", () => {
    hideToast(toast);
  });

  // Auto hide
  if (duration > 0) {
    setTimeout(() => hideToast(toast), duration);
  }

  return toast;
}

function hideToast(toast) {
  toast.classList.add("hiding");
  setTimeout(() => toast.remove(), 300);
}

// Initialize Google auth when page loads
window.addEventListener("load", () => {
  // Initialize admin mode (login button, modal handlers)
  initAdminMode();
  
  setTimeout(initGoogleAuth, 1000);
  // Auto-load posts from Drive on startup (for public view)
  // Try API key first (public access), then fallback to OAuth
  setTimeout(() => loadPostsFromDrivePublic(), 2000);
});

// Process sync queue when coming online (silent)
window.addEventListener("online", () => {
  console.log("Back online - syncing to Drive...");
  processSyncQueue();
});

// Load all posts from Google Drive using API key (public access - no sign-in needed)
async function loadPostsFromDrivePublic() {
  // First, we need to find the folder ID
  // Try to get it from localStorage first (saved from previous admin session)
  const savedFolderId = localStorage.getItem("driveFolderId");
  
  if (savedFolderId && GOOGLE_API_KEY && !GOOGLE_API_KEY.includes("YOUR_")) {
    await loadFromFolder(savedFolderId);
  } else if (isGoogleSignedIn && driveFolderId) {
    // Fallback to OAuth if signed in
    await loadFromFolder(driveFolderId);
  } else {
    console.log("No folder ID available - admin needs to sign in first to set up");
  }
}

// Load posts from a specific folder
async function loadFromFolder(folderId) {
  if (!folderId) return;
  
  try {
    console.log("Loading posts from Drive (public)...");
    
    // Use API key for public read access
    const apiKeyParam = GOOGLE_API_KEY && !GOOGLE_API_KEY.includes("YOUR_") 
      ? `&key=${GOOGLE_API_KEY}` 
      : "";
    
    // List all files in the folder
    const listUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/json'+and+trashed=false&fields=files(id,name,modifiedTime)${apiKeyParam}`;
    
    const response = await fetch(listUrl);
    
    if (!response.ok) {
      // If API key fails, might need OAuth
      console.log("Public read failed, may need authentication");
      return;
    }

    const data = await response.json();
    const files = data.files || [];
    
    console.log(`Found ${files.length} posts in Drive`);

    // Download each file
    const db = await dbPromise;
    let newPostsCount = 0;
    
    for (const file of files) {
      try {
        // Check if we already have this post locally
        const tx = db.transaction(POSTS_STORE, "readonly");
        const store = tx.objectStore(POSTS_STORE);
        const checkReq = store.get(file.id);
        
        const existingPost = await new Promise((resolve) => {
          checkReq.onsuccess = () => resolve(checkReq.result);
          checkReq.onerror = () => resolve(null);
        });

        // Download file content using API key
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media${apiKeyParam}`;
        const contentResponse = await fetch(downloadUrl);

        if (!contentResponse.ok) continue;
        
        const post = await contentResponse.json();
        
        // Add Drive file ID if missing
        if (!post.driveFileId) {
          post.driveFileId = file.id;
        }
        
        // If post doesn't exist locally or Drive version is newer
        if (!existingPost || (file.modifiedTime && new Date(file.modifiedTime) > new Date(existingPost.updatedAt || existingPost.createdAt))) {
          // Save to IndexedDB
          const writeTx = db.transaction(POSTS_STORE, "readwrite");
          const writeStore = writeTx.objectStore(POSTS_STORE);
          writeStore.put(post);
          newPostsCount++;
        }
      } catch (err) {
        console.error(`Error loading file ${file.id}:`, err);
      }
    }

    if (newPostsCount > 0) {
      console.log(`Loaded ${newPostsCount} new/updated posts from Drive`);
      // Refresh calendar to show new posts
      renderCalendar(currentYear, currentMonth);
    }
  } catch (error) {
    console.error("Error loading posts from Drive:", error);
  }
}

// Make folder publicly readable (anyone with link can view)
async function makeFolderPublic(folderId) {
  if (!isGoogleSignedIn || !googleAccessToken || !folderId) return;
  
  try {
    // Create permission for anyone to read
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}/permissions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          role: "reader",
          type: "anyone"
        })
      }
    );
    
    if (response.ok) {
      console.log("Folder is now publicly readable");
      isDriveFolderPublic = true;
    } else {
      console.log("Could not make folder public - may already be public or permission denied");
    }
  } catch (error) {
    console.error("Error making folder public:", error);
  }
}

// Legacy function - kept for compatibility
async function loadPostsFromDrive() {
  await loadPostsFromDrivePublic();
}

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
  
  // Re-render posts to show edit buttons
  if (currentPosts.length > 0 && !postsContainer.classList.contains("hidden")) {
    renderPostsList();
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
const GAS_URL = "https://script.google.com/macros/s/AKfycbzXLWAmHqCPch3zKIBcaeok6V547GcsA0y61MW6pTkmw1JXsGqFTpyOJPjjIbvVyExmrA/exec";

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

  // SYNC TO GOOGLE DRIVE
  if (isGoogleSignedIn && editingIndex === null) {
    // New post - upload to Drive
    const newPost = currentPosts[currentPosts.length - 1];
    newPost.dateKey = selectedDateKey;
    await uploadPostToDrive(newPost);
  } else if (isGoogleSignedIn && editingIndex !== null) {
    // Updated post - update in Drive
    const updatedPost = currentPosts[editingIndex];
    if (updatedPost.driveFileId) {
      await updatePostInDrive(updatedPost);
    } else {
      await uploadPostToDrive(updatedPost);
    }
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
