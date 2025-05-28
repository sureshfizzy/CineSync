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
 */
export function extractFolderNameFromPath(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  // Look for the media folder (usually contains movie/show name with year)
  // Start from the end and work backwards to find the most specific folder
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    if (part && part.trim() !== '') {
      // Skip common folder names that aren't media folders
      const skipFolders = ['Season', 'Extras', 'Specials', 'Bonus', 'Behind the Scenes'];
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
 * Processes structured messages from the Python API
 */
export function processStructuredMessage(message: any): void {
  if (!message || !message.structuredData) return;

  const { type, data } = message.structuredData;

  if (type === 'symlink_created' && data.force_mode) {
    // For force mode, we need to determine what the old folder was
    // Since we're moving from one folder to another, we should trigger for any current folder
    const newFolderName = data.new_folder_name;

    if (newFolderName) {
      // Extract the old folder name from the destination path to see what changed
      const oldFolderFromDest = extractFolderNameFromPath(data.destination_file);

      // Trigger update with a special flag to update any current MediaDetails page
      triggerFolderNameUpdate({
        oldFolderName: '*', // Special wildcard to match any current folder
        newFolderName,
        newPath: data.new_path,
        tmdbId: data.tmdb_id,
        timestamp: Date.now()
      });

      // Also trigger with the specific old folder name if we can determine it
      if (oldFolderFromDest && oldFolderFromDest !== newFolderName) {
        triggerFolderNameUpdate({
          oldFolderName: oldFolderFromDest,
          newFolderName,
          newPath: data.new_path,
          tmdbId: data.tmdb_id,
          timestamp: Date.now()
        });
      }
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
