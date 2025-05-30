/**
 * Utility functions for handling symlink updates and folder name changes
 */

export interface SymlinkUpdateData {
  oldFolderName: string;
  newFolderName: string;
  newPath: string;
  tmdbId?: number;
  timestamp: number;
}

/**
 * Triggers a folder name update that will be picked up by MediaDetails components
 */
export function triggerFolderNameUpdate(updateData: SymlinkUpdateData): void {
  try {
    // Dispatch a custom event immediately (primary method)
    window.dispatchEvent(new CustomEvent('symlink-folder-update', {
      detail: updateData
    }));

    // Also use localStorage for cross-tab communication (secondary method)
    const storageKey = `symlink_folder_update_${Date.now()}`;
    localStorage.setItem(storageKey, JSON.stringify(updateData));

    // Remove the storage item after a brief delay
    setTimeout(() => {
      localStorage.removeItem(storageKey);
    }, 1000);

    // Also trigger a storage event manually for same-tab communication
    window.dispatchEvent(new StorageEvent('storage', {
      key: storageKey,
      newValue: JSON.stringify(updateData),
      oldValue: null,
      storageArea: localStorage
    }));
  } catch (error) {
    console.error('Failed to trigger folder name update:', error);
  }
}

/**
 * Extracts folder name from a file path
 * Looks for media folder patterns like "Movie Name (Year)" or "Show Name"
 * For TV shows, returns the show name, not the season folder name
 */
export function extractFolderNameFromPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  // Look for the media folder (usually contains movie/show name with year)
  // Start from the end and work backwards to find the most specific folder
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    if (part && part.trim() !== '') {
      // Check if this is a season folder
      if (part.toLowerCase().startsWith('season ')) {
        // For season folders, return the parent folder (show name) if available
        if (i > 0 && parts[i - 1] && parts[i - 1].trim() !== '') {
          return parts[i - 1];
        }
      }

      // Skip other common folder names that aren't media folders
      const skipFolders = ['Extras', 'Specials', 'Bonus', 'Behind the Scenes'];
      const isSkipFolder = skipFolders.some(skip =>
        part.toLowerCase().includes(skip.toLowerCase())
      );

      if (!isSkipFolder) {
        return part;
      }
    }
  }

  return '';
}

/**
 * Triggers a page refresh to update the file browser
 */
export function triggerPageRefresh(): void {
  try {
    // Dispatch a custom event for page refresh
    window.dispatchEvent(new CustomEvent('symlink-page-refresh', {
      detail: { timestamp: Date.now() }
    }));
  } catch (error) {
    console.error('Failed to trigger page refresh:', error);
  }
}

/**
 * Processes structured messages from the Python API
 */
export function processStructuredMessage(message: any): void {
  if (!message || !message.structuredData) return;

  const { type, data } = message.structuredData;

  if (type === 'symlink_created' && data.force_mode) {
    // For force mode, we need to determine what the old folder was
    // Since we're moving from one folder to another, we should trigger for any current folder

    // For TV shows, extract the show name from the destination path instead of using new_folder_name
    // which might be just the season folder
    const extractedFolderName = extractFolderNameFromPath(data.destination_file);



    // Use the extracted folder name, but fallback to new_folder_name if extraction fails
    const newFolderName = extractedFolderName || data.new_folder_name;

    if (newFolderName) {
      // Trigger update with a special flag to update any current MediaDetails page
      triggerFolderNameUpdate({
        oldFolderName: '*', // Special wildcard to match any current folder
        newFolderName,
        newPath: data.new_path,
        tmdbId: data.tmdb_id,
        timestamp: Date.now()
      });
    }
  } else if (type === 'symlink_cleanup' && data.force_mode) {
    // Handle cleanup of old folders - trigger a page refresh to update the file browser
    if (data.old_folder_removed || data.old_season_folder_removed) {
      // Add a small delay to ensure cleanup is complete before refreshing
      setTimeout(() => {
        triggerPageRefresh();
      }, 500);
    }
  }
}

/**
 * Sets up a listener for structured messages from the Python API
 * This should be called when the Python command is being executed
 */
export function setupStructuredMessageListener(): void {
  // This would be called from the component that handles Python command execution
  // For now, it's a placeholder for future WebSocket or EventSource implementation
}

/**
 * Adds smooth transition classes to elements during folder name changes
 */
export function addTransitionClasses(element: HTMLElement): void {
  element.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
  element.style.willChange = 'opacity, transform';
}

/**
 * Removes transition classes after animation completes
 */
export function removeTransitionClasses(element: HTMLElement): void {
  setTimeout(() => {
    element.style.transition = '';
    element.style.willChange = '';
  }, 300);
}
