import { useState } from 'react';
import axios from 'axios';
import { upsertFileDetail, deleteFileDetail, moveFile } from '../components/FileBrowser/fileApi';
import { FileItem } from '../components/FileBrowser/types';

function joinPaths(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
}

const getRelativePath = (absPath: string): string => {
  return absPath;
};

export interface UseFileActionsProps {
  currentPath: string;
  onRename?: (file: FileItem) => void;
  onDeleted?: () => void;
  onModify?: (file: FileItem) => void;
}

export function useFileActions({ currentPath, onRename, onDeleted, onModify }: UseFileActionsProps) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [fileBeingRenamed, setFileBeingRenamed] = useState<FileItem | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fileBeingDeleted, setFileBeingDeleted] = useState<FileItem | null>(null);

  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [fileBeingModified, setFileBeingModified] = useState<FileItem | null>(null);

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveErrorDialogOpen, setMoveErrorDialogOpen] = useState(false);
  const [overwriteDialogOpen, setOverwriteDialogOpen] = useState(false);
  const [fileBeingMoved, setFileBeingMoved] = useState<FileItem | null>(null);
  const [lastMoveAttempt, setLastMoveAttempt] = useState<{targetPath: string} | null>(null);

  const handleRenameClick = (file: FileItem) => {
    setRenameError(null);
    setRenameValue(file.name);
    setFileBeingRenamed(file);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!fileBeingRenamed || !renameValue.trim()) return;
    const file = fileBeingRenamed;
    if (renameValue === file.name) return;

    setRenameLoading(true);
    setRenameError(null);

    let absPath = file.fullPath || file.sourcePath || '';
    let relPath = absPath ? getRelativePath(absPath) : joinPaths(currentPath, file.name).replace(/\/$/, '');

    try {
      await axios.post('/api/rename', {
        oldPath: relPath,
        newName: renameValue.trim(),
      });

      await upsertFileDetail({
        path: joinPaths(currentPath, renameValue.trim()),
        name: renameValue.trim(),
        type: file.type,
        size: file.size,
        modified: file.modified,
        icon: '',
        extra: '',
      });

      setRenameDialogOpen(false);
      setRenameLoading(false);
      setFileBeingRenamed(null);
      if (onRename) onRename(file);
    } catch (error: any) {
      setRenameError(error.response?.data || error.message || 'Failed to rename file');
      setRenameLoading(false);
    }
  };

  const handleDeleteClick = (file: FileItem) => {
    setDeleteError(null);
    setFileBeingDeleted(file);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!fileBeingDeleted) return;
    const file = fileBeingDeleted;

    setDeleting(true);
    setDeleteError(null);

    let absPath = file.fullPath || file.sourcePath || '';
    let relPath = absPath ? getRelativePath(absPath) : joinPaths(currentPath, file.name).replace(/\/$/, '');

    if (!relPath) {
      setDeleteError('Could not determine file path');
      setDeleting(false);
      return;
    }

    try {
      await axios.post('/api/delete', { path: relPath });
      await deleteFileDetail(relPath);
      setDeleteDialogOpen(false);
      setDeleting(false);
      setFileBeingDeleted(null);
      if (onDeleted) onDeleted();
    } catch (error: any) {
      setDeleteError(error.response?.data || error.message || 'Failed to delete file');
      setDeleting(false);
    }
  };

  const handleModifyClick = (file: FileItem) => {
    if (onModify) {
      onModify(file);
    }
    setFileBeingModified(file);
    setModifyDialogOpen(true);
  };

  const handleModifyDialogClose = () => {
    setModifyDialogOpen(false);
    setFileBeingModified(null);
  };

  const handleMoveClick = (file: FileItem) => {
    setMoveError(null);
    setFileBeingMoved(file);
    setMoveDialogOpen(true);
  };

  const handleMoveDialogClose = () => {
    setMoveDialogOpen(false);
    setMoveError(null);
    setFileBeingMoved(null);
    setLastMoveAttempt(null);
  };

  const handleMoveErrorDialogClose = () => {
    setMoveErrorDialogOpen(false);
    setMoveError(null);
    setLastMoveAttempt(null);
  };

  const handleOverwriteDialogClose = () => {
    setOverwriteDialogOpen(false);
    setMoveError(null);
    setMoveErrorDialogOpen(false);
    setLastMoveAttempt(null);
  };

  const handleMoveSubmit = async (targetPath: string, overwrite: boolean = false) => {
    if (!fileBeingMoved) return;
    const file = fileBeingMoved;

    setMoveLoading(true);
    setMoveError(null);
    
    // Use the most reliable path available
    const sourcePath = file.fullPath || file.sourcePath || joinPaths(currentPath, file.name);

    try {
      await moveFile(sourcePath, targetPath, overwrite);
      
      // Update persistent file details DB
      await upsertFileDetail({
        path: targetPath,
        name: file.name,
        type: file.type,
        size: file.size,
        modified: file.modified,
        icon: (file as any).icon || '',
        extra: '',
      });
      
      setMoveDialogOpen(false);
      setMoveLoading(false);
      setFileBeingMoved(null);
      setLastMoveAttempt(null);
      if (onDeleted) onDeleted();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data || error.message || 'Failed to move file';
      const isTargetExistsError = errorMessage.toLowerCase().includes('target already exists') || 
                                 errorMessage.toLowerCase().includes('already exists');
      
      setMoveError(errorMessage);
      setLastMoveAttempt({ targetPath });
      setMoveDialogOpen(false);
      setMoveLoading(false);

      if (isTargetExistsError) {
        setMoveErrorDialogOpen(false);
        setOverwriteDialogOpen(true);
      } else {
        setOverwriteDialogOpen(false);
        setMoveErrorDialogOpen(true);
      }
    }
  };

  const handleOverwriteMove = async () => {
    if (!fileBeingMoved || !lastMoveAttempt) return;
    setMoveError(null);
    setOverwriteDialogOpen(false);
    await handleMoveSubmit(lastMoveAttempt.targetPath, true);
  };

  const handleRenameDialogClose = () => {
    setRenameDialogOpen(false);
    setRenameError(null);
    setRenameValue('');
    setFileBeingRenamed(null);
  };

  const handleDeleteDialogClose = () => {
    setDeleteDialogOpen(false);
    setDeleteError(null);
    setFileBeingDeleted(null);
  };

  return {
    renameDialogOpen,
    renameValue,
    renameError,
    renameLoading,
    fileBeingRenamed,
    handleRenameClick,
    handleRenameSubmit,
    handleRenameDialogClose,
    setRenameValue,
    deleteDialogOpen,
    deleteError,
    deleting,
    fileBeingDeleted,
    handleDeleteClick,
    handleDelete,
    handleDeleteDialogClose,
    modifyDialogOpen,
    fileBeingModified,
    handleModifyClick,
    handleModifyDialogClose,
    setModifyDialogOpen,
    moveDialogOpen,
    moveLoading,
    moveError,
    moveErrorDialogOpen,
    overwriteDialogOpen,
    fileBeingMoved,
    lastMoveAttempt,
    handleMoveClick,
    handleMoveSubmit,
    handleOverwriteMove,
    handleMoveDialogClose,
    handleMoveErrorDialogClose,
    handleOverwriteDialogClose,
  };
}
