export interface ModifyDialogProps {
  open: boolean;
  onClose: () => void;
  currentFilePath?: string;
  bulkFilePaths?: string[];
  onNavigateBack?: () => void;
  useBatchApply?: boolean;
  useManualSearch?: boolean;
}

export interface ModifyOption {
  value: string;
  label: string;
  description: string;
  icon: string;
}

export interface IDOption {
  value: string;
  label: string;
  placeholder: string;
  icon: string;
  helperText: string;
}

export interface MovieOption {
  number: string;
  title: string;
  year?: string;
  tmdbId: string;
  mediaType?: 'tv' | 'movie' | null; // Media type extracted from backend output
  posterUrl?: string;
  tmdbData?: {
    id: number;
    title?: string;
    name?: string;
    poster_path?: string;
    media_type?: string;
    [key: string]: any;
  };
}

export interface SeasonOption {
  id: number;
  season_number: number;
  name: string;
  overview?: string;
  poster_path?: string;
  air_date?: string;
  episode_count: number;
}

export interface EpisodeOption {
  id: number;
  episode_number: number;
  name: string;
  overview?: string;
  still_path?: string;
  air_date?: string;
  runtime?: number;
  vote_average?: number;
}

export interface ForceConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  filePath?: string;
}

export interface ActionOptionsProps {
  selectedOption: string;
  onOptionSelect: (option: string) => void;
  options: ModifyOption[];
}

export interface IDOptionsProps {
  selectedIds: Record<string, string>;
  onIdsChange: (ids: Record<string, string>) => void;
  options: IDOption[];
}

export interface ExecutionDialogProps {
  open: boolean;
  onClose: () => void;
  execOutput: string;
  execInput: string;
  onInputChange: (input: string) => void;
  onInputSubmit: () => void;
  onInputKeyPress: (e: React.KeyboardEvent) => void;
  waitingForInput: boolean;
  movieOptions: MovieOption[];
  isLoadingNewOptions: boolean;
  previousOptions: MovieOption[];
  operationComplete: boolean;
  operationSuccess: boolean;
  isClosing: boolean;
  onOptionClick: (optionNumber: string) => void;
  selectedIds?: Record<string, string>;
  manualSearchEnabled?: boolean;
  selectionInProgress?: boolean;
}

export interface MovieOptionCardProps {
  option: MovieOption;
  onClick: (optionNumber: string) => void;
}

export interface PosterSkeletonProps {
  sx?: any;
}
