import { useBulkSelection } from '../contexts/BulkSelectionContext';

export const useBulkSelectionSafe = () => {
  try {
    return useBulkSelection();
  } catch (error) {
    return {
      selectedItems: new Set(),
      isSelectionMode: false,
      toggleSelection: () => {},
      selectAll: () => {},
      clearSelection: () => {},
      toggleSelectionMode: () => {},
      exitSelectionMode: () => {},
      isSelected: () => false,
      getSelectedItems: () => [],
      selectedCount: 0,
    };
  }
};
