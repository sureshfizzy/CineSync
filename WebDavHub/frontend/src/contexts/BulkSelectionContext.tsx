import React, { createContext, useContext, useState, useCallback } from 'react';
import { FileItem } from '../components/FileBrowser/types';

interface BulkSelectionContextType {
  selectedItems: Set<string>;
  isSelectionMode: boolean;
  toggleSelection: (item: FileItem) => void;
  selectAll: (items: FileItem[]) => void;
  clearSelection: () => void;
  toggleSelectionMode: () => void;
  exitSelectionMode: () => void;
  isSelected: (item: FileItem) => boolean;
  getSelectedItems: (allItems: FileItem[]) => FileItem[];
  selectedCount: number;
}

const BulkSelectionContext = createContext<BulkSelectionContextType | undefined>(undefined);

export const useBulkSelection = () => {
  const context = useContext(BulkSelectionContext);
  if (!context) {
    throw new Error('useBulkSelection must be used within a BulkSelectionProvider');
  }
  return context;
};

interface BulkSelectionProviderProps {
  children: React.ReactNode;
}

export const BulkSelectionProvider: React.FC<BulkSelectionProviderProps> = ({ children }) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const toggleSelection = useCallback((item: FileItem) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      const itemKey = `${item.type}-${item.name}-${item.fullPath || item.sourcePath || item.path}`;
      
      if (newSet.has(itemKey)) {
        newSet.delete(itemKey);
      } else {
        newSet.add(itemKey);
      }
      
      return newSet;
    });
  }, []);

  const selectAll = useCallback((items: FileItem[]) => {
    const allKeys = items.map(item => 
      `${item.type}-${item.name}-${item.fullPath || item.sourcePath || item.path}`
    );
    setSelectedItems(new Set(allKeys));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode(prev => {
      if (prev) {
        setSelectedItems(new Set());
      }
      return !prev;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedItems(new Set());
  }, []);

  const isSelected = useCallback((item: FileItem) => {
    const itemKey = `${item.type}-${item.name}-${item.fullPath || item.sourcePath || item.path}`;
    return selectedItems.has(itemKey);
  }, [selectedItems]);

  const getSelectedItems = useCallback((allItems: FileItem[]) => {
    return allItems.filter(item => isSelected(item));
  }, [isSelected]);

  const selectedCount = selectedItems.size;

  const value: BulkSelectionContextType = {
    selectedItems,
    isSelectionMode,
    toggleSelection,
    selectAll,
    clearSelection,
    toggleSelectionMode,
    exitSelectionMode,
    isSelected,
    getSelectedItems,
    selectedCount,
  };

  return (
    <BulkSelectionContext.Provider value={value}>
      {children}
    </BulkSelectionContext.Provider>
  );
};
