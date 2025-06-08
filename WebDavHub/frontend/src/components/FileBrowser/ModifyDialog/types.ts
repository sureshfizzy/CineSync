export interface ModifyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (selectedOption: string, selectedIds: Record<string, string>) => void;
  currentFilePath?: string;
  mediaType?: 'movie' | 'tv';
  onNavigateBack?: () => void;
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
}

export interface MovieOptionCardProps {
  option: MovieOption;
  onClick: (optionNumber: string) => void;
}

export interface PosterSkeletonProps {
  sx?: any;
}
