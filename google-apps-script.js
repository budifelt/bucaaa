// ============================================
// GOOGLE APPS SCRIPT - Kalender Cinta Backend
// ============================================
// 
// INSTRUCTIONS:
// 1. Go to https://script.google.com
// 2. Create new project
// 3. Paste this entire code
// 4. Save (Ctrl+S)
// 5. Click Deploy > New deployment
// 6. Type: Web app
// 7. Execute as: Me
// 8. Who has access: Anyone
// 9. Click Deploy
// 10. Copy the Web App URL
// 11. Paste that URL in your buccaaa/script.js as GAS_URL
//
// ============================================

const FOLDER_NAME = "Kalender Cinta";
const SHEET_NAME = "Posts";

// ============================================
// CORS HANDLING - Critical for cross-origin requests
// ============================================

// Handle OPTIONS preflight requests
function doOptions(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  // Set CORS headers for preflight
  return output;
}

// Main entry point for GET requests
function doGet(e) {
  const action = e.parameter.action;
  
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    let result;
    
    switch(action) {
      case 'getPosts':
        result = getAllPosts();
        break;
      case 'getPostsByDate':
        result = getPostsByDate(e.parameter.dateKey);
        break;
      default:
        result = { status: 'ok', message: 'Kalender Cinta API Ready', timestamp: new Date().toISOString() };
    }
    
    output.setContent(JSON.stringify(result));
    return output;
    
  } catch (err) {
    output.setContent(JSON.stringify({ 
      status: 'error', 
      message: err.toString(),
      stack: err.stack
    }));
    return output;
  }
}

// Handle POST requests (create/update/delete)
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    // Parse the request data
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      // If JSON parsing fails, try to get parameters from e.parameter
      data = {
        action: e.parameter.action,
        post: e.parameter.post ? JSON.parse(e.parameter.post) : null,
        postId: e.parameter.postId
      };
    }
    
    const action = data.action;
    let result;
    
    switch(action) {
      case 'savePost':
        result = savePost(data.post);
        break;
      case 'updatePost':
        result = updatePost(data.post);
        break;
      case 'deletePost':
        result = deletePost(data.postId);
        break;
      case 'syncPosts':
        result = syncMultiplePosts(data.posts);
        break;
      default:
        result = { status: 'error', message: 'Unknown action: ' + action };
    }
    
    output.setContent(JSON.stringify(result));
    return output;
    
  } catch (err) {
    output.setContent(JSON.stringify({ 
      status: 'error', 
      message: err.toString(),
      stack: err.stack
    }));
    return output;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Get or create the folder
function getOrCreateFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(FOLDER_NAME);
}

// Get or create the spreadsheet
function getOrCreateSheet() {
  const folder = getOrCreateFolder();
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName() === SHEET_NAME) {
      return SpreadsheetApp.openById(file.getId()).getActiveSheet();
    }
  }
  
  // Create new spreadsheet
  const ss = SpreadsheetApp.create(SHEET_NAME);
  const sheet = ss.getActiveSheet();
  
  // Add headers
  sheet.appendRow([
    'id', 'dateKey', 'title', 'content', 'lovedBy', 
    'createdAt', 'updatedAt', 'pinned', 'driveFileId'
  ]);
  
  // Move to folder
  const file = DriveApp.getFileById(ss.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  
  return sheet;
}

// ============================================
// CRUD OPERATIONS
// ============================================

// Save a new post
function savePost(post) {
  if (!post) {
    return { status: 'error', message: 'No post data provided' };
  }
  
  const sheet = getOrCreateSheet();
  
  // Validate required fields
  if (!post.id) {
    post.id = Utilities.getUuid();
  }
  if (!post.dateKey) {
    return { status: 'error', message: 'dateKey is required' };
  }
  
  // Check if post with same ID exists
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === post.id) {
      // Update existing
      return updatePost(post);
    }
  }
  
  // Add new row
  sheet.appendRow([
    post.id,
    post.dateKey,
    post.title || '',
    post.content || '',
    post.lovedBy || '',
    post.createdAt || new Date().toISOString(),
    post.updatedAt || post.createdAt || new Date().toISOString(),
    post.pinned ? 'true' : 'false',
    post.driveFileId || ''
  ]);
  
  return { 
    status: 'ok', 
    message: 'Post saved successfully',
    postId: post.id
  };
}

// Update existing post
function updatePost(post) {
  if (!post || !post.id) {
    return { status: 'error', message: 'Post ID is required for update' };
  }
  
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === post.id) {
      // Update row
      sheet.getRange(i + 1, 2).setValue(post.dateKey || data[i][1]);
      sheet.getRange(i + 1, 3).setValue(post.title || data[i][2]);
      sheet.getRange(i + 1, 4).setValue(post.content || data[i][3]);
      sheet.getRange(i + 1, 5).setValue(post.lovedBy || data[i][4]);
      sheet.getRange(i + 1, 7).setValue(post.updatedAt || new Date().toISOString());
      sheet.getRange(i + 1, 8).setValue(post.pinned ? 'true' : 'false');
      
      return { 
        status: 'ok', 
        message: 'Post updated successfully',
        postId: post.id
      };
    }
  }
  
  // If not found, save as new
  return savePost(post);
}

// Delete a post
function deletePost(postId) {
  if (!postId) {
    return { status: 'error', message: 'Post ID is required' };
  }
  
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === postId) {
      sheet.deleteRow(i + 1);
      return { 
        status: 'ok', 
        message: 'Post deleted successfully',
        postId: postId
      };
    }
  }
  
  return { 
    status: 'error', 
    message: 'Post not found: ' + postId
  };
}

// Get all posts
function getAllPosts() {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const posts = [];
  
  // Skip header row
  for (let i = 1; i < data.length; i++) {
    posts.push({
      id: data[i][0],
      dateKey: data[i][1],
      title: data[i][2],
      content: data[i][3],
      lovedBy: data[i][4],
      createdAt: data[i][5],
      updatedAt: data[i][6],
      pinned: data[i][7] === 'true',
      driveFileId: data[i][8]
    });
  }
  
  return { 
    status: 'ok', 
    posts: posts,
    count: posts.length,
    timestamp: new Date().toISOString()
  };
}

// Get posts by date
function getPostsByDate(dateKey) {
  if (!dateKey) {
    return { status: 'error', message: 'dateKey is required' };
  }
  
  const allPosts = getAllPosts();
  const filtered = allPosts.posts.filter(p => p.dateKey === dateKey);
  
  return {
    status: 'ok',
    posts: filtered,
    dateKey: dateKey,
    count: filtered.length
  };
}

// Sync multiple posts at once
function syncMultiplePosts(posts) {
  if (!posts || !Array.isArray(posts)) {
    return { status: 'error', message: 'Posts array is required' };
  }
  
  const results = [];
  let successCount = 0;
  let failCount = 0;
  
  for (const post of posts) {
    try {
      const result = savePost(post);
      results.push(result);
      if (result.status === 'ok') successCount++;
      else failCount++;
    } catch (err) {
      results.push({ status: 'error', message: err.toString() });
      failCount++;
    }
  }
  
  return {
    status: 'ok',
    message: `Synced ${successCount} of ${posts.length} posts`,
    successCount: successCount,
    failCount: failCount,
    results: results
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Make folder public (optional - for backup files)
function makeFolderPublic() {
  const folder = getOrCreateFolder();
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { status: 'ok', message: 'Folder is now public' };
}

// Test function - call this to verify setup
function testSetup() {
  try {
    const sheet = getOrCreateSheet();
    const info = {
      sheetName: sheet.getName(),
      rowCount: sheet.getLastRow(),
      columnCount: sheet.getLastColumn()
    };
    
    return {
      status: 'ok',
      message: 'Setup test successful',
      info: info
    };
  } catch (err) {
    return {
      status: 'error',
      message: 'Setup test failed: ' + err.toString()
    };
  }
}
