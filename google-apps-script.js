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

// Main entry point
function doGet(e) {
  const action = e.parameter.action;
  
  // Set CORS headers
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
        result = { status: 'ok', message: 'Kalender Cinta API Ready' };
    }
    
    output.setContent(JSON.stringify(result));
    return output;
    
  } catch (err) {
    output.setContent(JSON.stringify({ 
      status: 'error', 
      message: err.toString() 
    }));
    return output;
  }
}

// Handle POST requests (create/update/delete)
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    const data = JSON.parse(e.postData.contents);
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
      message: err.toString() 
    }));
    return output;
  }
}

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

// Save a new post
function savePost(post) {
  const sheet = getOrCreateSheet();
  
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
    post.title,
    post.content,
    post.lovedBy || '',
    post.createdAt,
    post.updatedAt || post.createdAt,
    post.pinned ? 'true' : 'false',
    post.driveFileId || ''
  ]);
  
  return { 
    status: 'ok', 
    message: 'Post saved',
    postId: post.id
  };
}

// Update existing post
function updatePost(post) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === post.id) {
      // Update row
      sheet.getRange(i + 1, 2).setValue(post.dateKey);
      sheet.getRange(i + 1, 3).setValue(post.title);
      sheet.getRange(i + 1, 4).setValue(post.content);
      sheet.getRange(i + 1, 5).setValue(post.lovedBy || '');
      sheet.getRange(i + 1, 7).setValue(post.updatedAt || new Date().toISOString());
      sheet.getRange(i + 1, 8).setValue(post.pinned ? 'true' : 'false');
      
      return { 
        status: 'ok', 
        message: 'Post updated',
        postId: post.id
      };
    }
  }
  
  // If not found, save as new
  return savePost(post);
}

// Delete a post
function deletePost(postId) {
  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === postId) {
      sheet.deleteRow(i + 1);
      return { 
        status: 'ok', 
        message: 'Post deleted',
        postId: postId
      };
    }
  }
  
  return { 
    status: 'error', 
    message: 'Post not found' 
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
    count: posts.length
  };
}

// Get posts by date
function getPostsByDate(dateKey) {
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
  const results = [];
  
  for (const post of posts) {
    const result = savePost(post);
    results.push(result);
  }
  
  return {
    status: 'ok',
    message: `Synced ${posts.length} posts`,
    results: results
  };
}

// Make folder public (optional - for backup files)
function makeFolderPublic() {
  const folder = getOrCreateFolder();
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { status: 'ok', message: 'Folder is now public' };
}
